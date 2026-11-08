import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexProvider } from "../src/codex.js";
const q = {
  type: "single",
  stem: "HOSTILE_QUESTION `$(echo nope)`",
  options: [
    { id: "A", text: "2" },
    { id: "B", text: "3" },
  ],
};
async function setup(t, mode, extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "course-codex-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new CodexProvider({
    command: [process.execPath, path.resolve("tests/fixtures/codex-stub.cjs")],
    dataDir: dir,
    timeoutMs: 10000,
    env: { ...process.env, STUB_MODE: mode },
    ...extra,
  });
}
test("Codex receives question through stdin and validated JSON through output file", async (t) => {
  const p = await setup(t);
  const a = await p.solve(q);
  assert.deepEqual(a.selectedOptionIds, ["A"]);
  assert.equal(a.reason, "stdin preserved");
});
test("quick reasoning uses low effort without enabling a higher billing service tier", async (t) => {
  const p = await setup(t, "profile");
  const result = JSON.parse((await p.solve(q)).reason);
  assert.equal(result.effort, 'model_reasoning_effort="low"');
  assert.equal(result.fast, false);
});
test("default reasoning remains selectable for complex questions", async (t) => {
  const p = await setup(t, "profile", { reasoningEffort: "default" });
  const result = JSON.parse((await p.solve(q)).reason);
  assert.equal(result.effort, null);
});
test("malformed model output is rejected before browser actions", async (t) => {
  const p = await setup(t, "bad");
  await assert.rejects(p.solve(q), /JSON|格式/);
});
test("cancellation terminates a hanging model process promptly", async (t) => {
  const p = await setup(t, "hang");
  const ac = new AbortController();
  const run = p.solve(q, ac.signal);
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(run, /取消|abort/i);
});

test("a timed out process exits before one fresh model attempt succeeds", async (t) => {
  const p = await setup(t, "timeout-once", { timeoutMs: 500 });
  const counter = path.join(p.dataDir, "counter");
  p.env = { ...p.env, STUB_COUNTER: counter };
  const progress = [];
  const answer = await p.solve(q, undefined, (message) =>
    progress.push(message),
  );
  assert.deepEqual(answer.selectedOptionIds, ["A"]);
  assert.equal(await readFile(counter, "utf8"), "2");
  assert.match(progress.join(" "), /重试/);
});

test("two timeouts stop; invalid output and cancellation never auto retry", async (t) => {
  for (const mode of ["hang", "bad", "cancel"]) {
    const p = await setup(t, mode === "cancel" ? "hang" : mode, {
      timeoutMs: 500,
    });
    const counter = path.join(p.dataDir, "counter");
    p.env = { ...p.env, STUB_COUNTER: counter };
    const ac = new AbortController();
    const promise = p.solve(q, ac.signal);
    if (mode === "cancel") setTimeout(() => ac.abort(), 200);
    await assert.rejects(
      promise,
      mode === "hang"
        ? (e) => e.code === "MODEL_TIMEOUT"
        : /取消|abort|JSON|格式/i,
    );
    assert.equal(await readFile(counter, "utf8"), mode === "hang" ? "2" : "1");
  }
});

test("pause at the retry boundary prevents the second request", async (t) => {
  const p = await setup(t, "hang", { timeoutMs: 500 });
  const counter = path.join(p.dataDir, "counter");
  p.env = { ...p.env, STUB_COUNTER: counter };
  const ac = new AbortController();
  await assert.rejects(
    p.solve(q, ac.signal, () => ac.abort()),
    /abort/i,
  );
  assert.equal(await readFile(counter, "utf8"), "1");
});
