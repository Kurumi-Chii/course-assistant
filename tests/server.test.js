import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../src/server.js";
async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "course-http-"));
  let starts = 0;
  const controller = {
    status: () => ({
      phase: "ready",
      connected: true,
      history: [],
      message: "<script>alert(1)</script>",
    }),
    start: async () => {
      starts++;
    },
    pause() {},
    stop: async () => {},
    connect: async () => {},
    acknowledge: async () => {},
  };
  const app = await createApp({
    controller,
    provider: { check: async () => ({ ok: true }) },
    dataDir: dir,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + app.server.address().port;
  return {
    ...app,
    base,
    get starts() {
      return starts;
    },
  };
}
test("dashboard API requires same-origin token for writes", async (t) => {
  const app = await setup(t);
  const token = (await (await fetch(app.base + "/api/bootstrap")).json()).token;
  assert.equal(
    (
      await fetch(app.base + "/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"action":"start"}',
      })
    ).status,
    403,
  );
  assert.equal(app.starts, 0);
  assert.equal(
    (
      await fetch(app.base + "/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": token,
        },
        body: '{"action":"start"}',
      })
    ).status,
    200,
  );
  assert.equal(app.starts, 1);
});
test("dashboard persists the random fallback setting across restarts", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "course-settings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settingsFile = path.join(dir, "settings.json");
  await writeFile(
    settingsFile,
    JSON.stringify({ panelPort: 18768, agentProvider: "harness" }),
  );
  const app = await createApp({ dataDir: dir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + app.server.address().port;
    const state = async () => (await fetch(base + "/api/state")).json();
    const update = (enabled) =>
      fetch(base + "/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": app.token,
        },
        body: JSON.stringify({ action: "set-random-fallback", enabled }),
      });
    assert.equal((await state()).randomOnUncertain, false);
    assert.equal((await update("true")).status, 400);
    assert.equal((await update(true)).status, 200);
    assert.equal((await state()).randomOnUncertain, true);
    assert.deepEqual(JSON.parse(await readFile(settingsFile, "utf8")), {
      panelPort: 18768,
      agentProvider: "harness",
      randomOnUncertain: true,
    });
    const reopened = await createApp({ dataDir: dir });
    assert.equal(reopened.controller.randomOnUncertain, true);
    assert.equal((await update(false)).status, 200);
    assert.equal((await state()).randomOnUncertain, false);
  } finally {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
  }
});
test("foreign origin, hostile Host and oversized bodies cannot control session", async (t) => {
  const app = await setup(t);
  for (const headers of [
    { Origin: "https://evil.example" },
    { Host: "evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    const code = await new Promise((resolve, reject) => {
      const req = http.get(app.base + "/api/bootstrap", { headers }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
    });
    assert.equal(code, 403, JSON.stringify(headers));
  }
  const token = (await (await fetch(app.base + "/api/bootstrap")).json()).token;
  assert.equal(
    (
      await fetch(app.base + "/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": token,
        },
        body: "x".repeat(20000),
      })
    ).status,
    413,
  );
  assert.equal(app.starts, 0);
});
test("state is JSON, pages have restrictive CSP, unknown actions fail", async (t) => {
  const app = await setup(t);
  const state = await fetch(app.base + "/api/state");
  assert.match(state.headers.get("content-type"), /application\/json/);
  assert.equal((await state.json()).message, "<script>alert(1)</script>");
  const page = await fetch(app.base);
  assert.match(
    page.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  const token = (await (await fetch(app.base + "/api/bootstrap")).json()).token;
  assert.equal(
    (
      await fetch(app.base + "/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": token,
        },
        body: '{"action":"arbitrary"}',
      })
    ).status,
    400,
  );
});

test("malformed URL returns 400 and server remains available", async (t) => {
  const app = await setup(t);
  const base = new URL(app.base);
  const status = await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port,
        path: "http://[",
        method: "GET",
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", () => resolve(0));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
  assert.equal(status, 400);
  assert.equal((await fetch(app.base + "/api/state")).status, 200);
});
