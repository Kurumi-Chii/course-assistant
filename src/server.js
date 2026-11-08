import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserBridge } from "./browser.js";
import { SiteAdapter } from "./site.js";
import { Controller } from "./controller.js";
import { Journal } from "./store.js";
import { loadAgentRouter } from "./providers.js";
import { getPanelPort, readSettings, updateSettings } from "./settings.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function createApp({
  controller,
  provider,
  dataDir = path.join(root, "data"),
  onShutdown,
} = {}) {
  const token = randomBytes(32).toString("hex");
  let checking = false,
    savingSettings = false,
    modelMessage = "尚未检查",
    checkAbort;
  if (!controller) {
    const journal = new Journal(dataDir);
    await journal.load();
    const bridge = new BrowserBridge({
      dataDir,
      demoUrl: process.env.COURSE_DEMO_URL,
    });
    provider ??= await loadAgentRouter(dataDir);
    controller = new Controller({
      bridge,
      site: new SiteAdapter(bridge),
      provider,
      journal,
      randomOnUncertain:
        (await readSettings(dataDir)).randomOnUncertain === true,
    });
  }
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const localHost = "127.0.0.1:" + server.address().port;
    if (
      req.headers.host !== localHost ||
      (req.headers.origin && req.headers.origin !== "http://" + localHost) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      json(res, 403, { error: "仅允许本机控制面板访问" });
      return;
    }
    try {
      const url = new URL(req.url, "http://" + localHost);
      if (req.method === "GET" && url.pathname === "/api/bootstrap") {
        json(res, 200, { token, appId: "course-assistant-v1" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        json(res, 200, {
          ...controller.status(),
          provider: provider?.name ?? controller.status().provider ?? "Codex",
          agents: provider?.list?.() ?? [{ id: "codex", name: "Codex" }],
          selectedAgent: provider?.selected ?? "codex",
          agentChanging: provider?.changing ?? false,
          settingsChanging: savingSettings,
          randomOnUncertain: controller.randomOnUncertain === true,
          modelChecking: checking,
          modelMessage,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        const candidate = Buffer.from(
          String(req.headers["x-session-token"] ?? ""),
        );
        const expected = Buffer.from(token);
        if (
          candidate.length !== expected.length ||
          !timingSafeEqual(candidate, expected)
        ) {
          json(res, 403, { error: "控制面板会话已失效，请刷新" });
          return;
        }
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")
        ) {
          json(res, 415, { error: "请求格式错误" });
          return;
        }
        let body = "";
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16384) {
            json(res, 413, { error: "请求过大" });
            return;
          }
          body += chunk;
        }
        let action, payload;
        try {
          payload = JSON.parse(body);
          action = payload.action;
        } catch {
          json(res, 400, { error: "请求格式错误" });
          return;
        }
        if (
          (provider?.changing || savingSettings) &&
          !["pause", "stop", "shutdown"].includes(action)
        )
          throw new Error("正在保存控制面板设置，请稍候");
        if (action === "set-random-fallback") {
          if (typeof payload.enabled !== "boolean")
            throw new Error("随机选择设置格式无效");
          const { busy, phase } = controller.status();
          if (busy || ["running", "connecting"].includes(phase))
            throw new Error("请先暂停，等待当前操作结束后再更改设置");
          savingSettings = true;
          try {
            await updateSettings(dataDir, {
              randomOnUncertain: payload.enabled,
            });
            controller.randomOnUncertain = payload.enabled;
          } finally {
            savingSettings = false;
          }
          json(res, 200, { ok: true });
          return;
        }
        if (action === "select-provider") {
          if (
            checking ||
            controller.status().busy ||
            ["running", "connecting"].includes(controller.status().phase)
          )
            throw new Error("请先暂停，等待当前操作结束后再切换 Agent");
          if (!provider?.select) throw new Error("当前后端不支持切换");
          await provider.select(payload.provider);
          modelMessage = "尚未检查";
          json(res, 200, { ok: true });
          return;
        }
        if (action === "check") {
          if (
            checking ||
            controller.status().busy ||
            controller.status().phase === "running"
          )
            throw new Error("请先暂停，再检查模型");
          checking = true;
          checkAbort = new AbortController();
          modelMessage = "正在连接 " + (provider.name ?? "Codex");
          try {
            const result = await provider.check(checkAbort.signal);
            modelMessage = result.message;
            json(res, 200, result);
          } catch (e) {
            modelMessage = e.message;
            throw e;
          } finally {
            checking = false;
          }
          return;
        }
        const actions = {
          connect: () => controller.connect(),
          start: () => controller.start(),
          pause: () => controller.pause(),
          stop: () => controller.stop(),
          acknowledge: () => controller.acknowledge(),
          retry: () => controller.retry(),
        };
        if (action === "shutdown") {
          checkAbort?.abort();
          await controller.stop();
          json(res, 200, { ok: true });
          setTimeout(() => void onShutdown?.(), 30);
          return;
        }
        if (!Object.hasOwn(actions, action)) {
          json(res, 400, { error: "不支持的操作" });
          return;
        }
        if (["pause", "stop"].includes(action)) checkAbort?.abort();
        await actions[action]();
        json(res, 200, { ok: true });
        return;
      }
      if (req.method !== "GET") {
        json(res, 405, { error: "不支持的请求" });
        return;
      }
      const assets = {
        "/": ["public/index.html", "text/html"],
        "/app.js": ["public/app.js", "text/javascript"],
        "/style.css": ["public/style.css", "text/css"],
        "/demo": ["tests/fixtures/course.html", "text/html"],
      };
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      const asset = assets[url.pathname];
      if (!asset) {
        json(res, 404, { error: "页面不存在" });
        return;
      }
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'" +
          (url.pathname === "/demo" ? " 'unsafe-inline'" : "") +
          "; style-src 'self'" +
          (url.pathname === "/demo" ? " 'unsafe-inline'" : "") +
          "; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      res.writeHead(200, { "Content-Type": asset[1] + "; charset=utf-8" });
      res.end(await readFile(path.join(root, asset[0])));
    } catch (e) {
      if (!res.headersSent)
        json(res, 400, { error: String(e.message).slice(0, 300) });
      else res.end();
    }
  });
  return { server, controller, token };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = path.join(root, "data");
  await mkdir(dir, { recursive: true });
  const port = await getPanelPort(dir);
  const provider = await loadAgentRouter(dir);
  const shutdown = async () => {
    await app.controller.stop();
    app.server.closeAllConnections();
    app.server.close();
    await unlink(path.join(dir, "runtime.json")).catch(() => {});
    process.exit(0);
  };
  const app = await createApp({ provider, dataDir: dir, onShutdown: shutdown });
  app.server.on("error", (e) => {
    console.error(
      e.code === "EADDRINUSE"
        ? "课程助手端口已占用，请先打开现有控制面板"
        : "课程助手启动失败",
    );
    process.exitCode = 1;
  });
  app.server.listen(port, "127.0.0.1", async () => {
    await writeFile(
      path.join(dir, "runtime.json"),
      JSON.stringify({
        pid: process.pid,
        base: "http://127.0.0.1:" + port,
        token: app.token,
      }),
    );
    console.log("课程助手已启动：http://127.0.0.1:" + port);
  });
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, () => void shutdown());
}
