import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentRouter } from "../src/providers.js";
import { createApp } from "../src/server.js";
test("switching agent persists before publishing and never falls back on failure", async () => {
  const calls = [],
    saved = [];
  const router = new AgentRouter({
    providers: {
      codex: { name: "Codex", solve: async () => calls.push("codex") },
      harness: {
        name: "DeepSeek Harness",
        solve: async () => {
          calls.push("harness");
          throw new Error("offline");
        },
      },
    },
    save: async (id) => saved.push(id),
  });
  await router.select("harness");
  assert.equal(router.name, "DeepSeek Harness");
  assert.deepEqual(saved, ["harness"]);
  await assert.rejects(router.solve({}), /offline/);
  assert.deepEqual(calls, ["harness"]);
  await assert.rejects(router.select("unknown"), /支持/);
});
test("failed settings write retains original agent", async () => {
  const router = new AgentRouter({
    providers: { codex: { name: "Codex" }, harness: { name: "Harness" } },
    save: async () => {
      throw new Error("disk full");
    },
  });
  await assert.rejects(router.select("harness"), /disk full/);
  assert.equal(router.selected, "codex");
});
test("agent selection API is persisted only while the controller is idle", async (t) => {
  let phase = "paused";
  const saved = [];
  const provider = new AgentRouter({
    providers: {
      codex: { name: "Codex" },
      harness: { name: "DeepSeek Harness" },
    },
    save: async (id) => saved.push(id),
  });
  const app = await createApp({
    provider,
    controller: {
      status: () => ({ phase, busy: false, connected: true }),
      stop: async () => {},
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    app.server.closeAllConnections();
    return new Promise((resolve) => app.server.close(resolve));
  });
  const base = "http://127.0.0.1:" + app.server.address().port,
    token = (await (await fetch(base + "/api/bootstrap")).json()).token;
  const select = (id) =>
    fetch(base + "/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": token },
      body: JSON.stringify({ action: "select-provider", provider: id }),
    });
  assert.equal((await select("harness")).status, 200);
  assert.equal(provider.selected, "harness");
  phase = "running";
  assert.equal((await select("codex")).ok, false);
  assert.deepEqual(saved, ["harness"]);
});
