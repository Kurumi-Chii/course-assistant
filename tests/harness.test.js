import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startBridge } from "../packages/harness-course-agent/bridge.js";
import { HarnessProvider } from "../src/harness.js";
import { solveWithHarness } from "../packages/harness-course-agent/index.js";
import http from "node:http";
const q = {
  type: "multi",
  stem: "哪些是偶数？",
  options: [
    { id: "A", text: "2" },
    { id: "B", text: "3" },
    { id: "C", text: "4" },
  ],
};
async function setup(
  t,
  solve = async () => ({
    status: "answered",
    selectedOptionIds: ["A", "C"],
    reason: "偶数",
  }),
) {
  const dir = await mkdtemp(path.join(tmpdir(), "course-harness-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "connection.json");
  const bridge = await startBridge({ file, solve });
  t.after(() => bridge.close());
  const connection = JSON.parse(await readFile(file, "utf8"));
  return {
    bridge,
    file,
    connection,
    provider: new HarnessProvider({ connectionFile: file, timeoutMs: 1000 }),
  };
}
test("Harness bridge and Provider validate multi answers and use local pairing", async (t) => {
  const { provider, bridge } = await setup(t);
  assert.deepEqual((await provider.solve(q)).selectedOptionIds, ["A", "C"]);
  assert.equal(provider.name, "DeepSeek Harness");
  assert.equal(bridge.active, 0);
});
test("bridge rejects missing authentication and hostile origins", async (t) => {
  const { connection: c } = await setup(t);
  for (const headers of [
    {},
    { Authorization: "Bearer " + c.token, Origin: "https://evil.example" },
  ]) {
    const r = await fetch(c.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ question: q }),
    });
    assert.equal(r.status, 403);
  }
});
test("Provider rejects invalid choices and uncertainty before any browser action", async (t) => {
  for (const answer of [
    { status: "answered", selectedOptionIds: ["Z"], reason: "bad" },
    { status: "uncertain", selectedOptionIds: [], reason: "unknown" },
  ]) {
    const { provider } = await setup(t, async () => answer);
    await assert.rejects(provider.solve(q), /答案|选项|确定/);
  }
});
test("cancelling a request aborts the matching Harness model call", async (t) => {
  const entered = Promise.withResolvers(),
    cancelled = Promise.withResolvers();
  const { provider } = await setup(t, async (question, signal) => {
    entered.resolve();
    await new Promise((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          cancelled.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    throw new Error("aborted");
  });
  const ac = new AbortController(),
    run = provider.solve(q, ac.signal);
  await entered.promise;
  ac.abort();
  await assert.rejects(run, /取消|abort/i);
  await cancelled.promise;
});
test("Harness native adapter uses current model with no tool declarations or chat submission", async () => {
  let request;
  const answer = {
    status: "answered",
    selectedOptionIds: ["A", "C"],
    reason: "偶数",
  };
  const ctx = {
    agentDefaultModel: {
      currentSelection: () => ({
        provider: "native-account",
        model: "native-model",
      }),
    },
    llm: {
      stream: async function* (options) {
        request = options;
        yield { type: "reasoning-delta", text: "not an answer" };
        yield { type: "text-delta", text: JSON.stringify(answer) };
        yield { type: "finish", reason: { kind: "stop" } };
      },
    },
  };
  assert.deepEqual(
    await solveWithHarness(ctx, q, new AbortController().signal),
    answer,
  );
  assert.equal(request.provider, "native-account");
  assert.equal(request.model, "native-model");
  assert.deepEqual(request.tools, []);
  assert.deepEqual(JSON.parse(request.messages[0].content[0].text), q);
});

test("Chinese question bytes split across HTTP chunks arrive intact", async (t) => {
  let seen;
  const { connection: c } = await setup(t, async (question) => {
    seen = question;
    return {
      status: "answered",
      selectedOptionIds: ["A", "C"],
      reason: "偶数",
    };
  });
  const data = Buffer.from(JSON.stringify({ question: q })),
    cut = data.indexOf(Buffer.from("哪")) + 1;
  await new Promise((resolve, reject) => {
    const req = http.request(
      c.endpoint,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + c.token,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.write(data.subarray(0, cut));
    setTimeout(() => req.end(data.subarray(cut)), 20);
  });
  assert.equal(seen.stem, q.stem);
});
