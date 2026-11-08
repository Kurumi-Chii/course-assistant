import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPanelPort } from "../src/settings.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.join(root, "data");
const port = await getPanelPort(data);
const base = "http://127.0.0.1:" + port;
async function healthy() {
  try {
    return (
      (
        await (
          await fetch(base + "/api/bootstrap", {
            signal: AbortSignal.timeout(1000),
          })
        ).json()
      ).appId === "course-assistant-v1"
    );
  } catch {
    return false;
  }
}
function openPage() {
  if (process.argv.includes("--no-open")) return;
  const p = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", base], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  p.on("error", () => console.log("请在 Edge 打开 " + base));
  p.unref();
}
if (!(await healthy())) {
  await mkdir(data, { recursive: true });
  const out = await open(path.join(data, "server.log"), "a"),
    err = await open(path.join(data, "server-error.log"), "a");
  const child = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: { ...process.env, COURSE_PORT: String(port) },
    detached: true,
    stdio: ["ignore", out.fd, err.fd],
    windowsHide: true,
  });
  child.unref();
  await out.close();
  await err.close();
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await healthy()) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    console.error("启动未完成，请查看 data/server-error.log。");
    process.exitCode = 1;
  } else {
    console.log("课程助手已启动：" + base);
    openPage();
  }
} else {
  console.log("课程助手已经在运行：" + base);
  openPage();
}
