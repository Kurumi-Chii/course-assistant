import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { BrowserBridge } from "../src/browser.js";
import { SiteAdapter } from "../src/site.js";
import { CodexProvider } from "../src/codex.js";
import { Journal } from "../src/store.js";
import { Controller } from "../src/controller.js";
const runLabel = String(Date.now()).slice(-6);
const pageTitle = "课程助手模拟页 · 验证 " + runLabel;
const html = (await readFile("tests/fixtures/course.html", "utf8")).replace(
  "<title>课程助手模拟页</title>",
  "<title>" + pageTitle + "</title>",
);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port + "/demo";
const dataDir = path.resolve("data/verification");
await mkdir(dataDir, { recursive: true });
const bridge = new BrowserBridge({ dataDir, demoUrl: url });
const provider = new CodexProvider({ dataDir: path.join(dataDir, "model") });
const journal = new Journal(path.join(dataDir, "integration-" + Date.now()));
await journal.load();
const controller = new Controller({
  bridge,
  site: new SiteAdapter(bridge),
  provider,
  journal,
  pollMs: 600000,
});
let state;
try {
  const edge =
    process.env.EDGE_PATH ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const p = spawn(edge, [url], { windowsHide: true, stdio: "ignore" });
  p.on("error", () => console.log("请手动在 Edge 打开 " + url));
  p.unref();
  console.log("请在 Playwright 连接页中选择“" + pageTitle + "”：" + url);
  await controller.connect();
  console.log("EDGE_CONNECTED");
  for (const type of ["single", "judgement", "multi"]) {
    await bridge.call("browser_evaluate", {
      function: "() => window.showQuiz(" + JSON.stringify(type) + ")",
    });
    await controller.start();
    await controller.tick();
    state = controller.status();
    if (state.phase === "paused" || state.pending)
      throw new Error(state.error || "流程未完成", {
        cause: bridge.lastErrorDetail,
      });
    controller.pause();
    console.log("VERIFIED " + type);
  }
  const result = await bridge.rawRead(() => ({
    playerClicks: window.playerClicks,
    quizVisible: Boolean(document.querySelector(".el-dialog")),
  }));
  if (result.playerClicks !== 3 || result.quizVisible)
    throw new Error("播放器点击次数或弹窗关闭结果不符");
  await bridge.call("browser_take_screenshot", {
    scale: "css",
    filename: path.join(dataDir, "edge-integration.png"),
  });
  const report = {
    verifiedAt: new Date().toISOString(),
    transport: "Official Playwright extension / Microsoft Edge",
    model: "Actual saved-login Codex CLI",
    types: ["single", "judgement", "multi"],
    ...result,
    coursePlatformTested: false,
  };
  await writeFile(
    path.join(dataDir, "edge-integration.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("验证未完成：" + e.message);
  if (e.cause) console.error(String(e.cause));
  process.exitCode = 1;
} finally {
  await controller.stop();
  server.closeAllConnections();
  server.close();
}
