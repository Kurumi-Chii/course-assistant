import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPanelPort } from "../src/settings.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.join(root, "data");
try {
  const info = JSON.parse(
    await readFile(path.join(data, "runtime.json"), "utf8"),
  );
  if (info.base !== "http://127.0.0.1:" + (await getPanelPort(data)))
    throw new Error("运行信息不匹配");
  const response = await fetch(info.base + "/api/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": info.token,
    },
    body: JSON.stringify({ action: "shutdown" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("停止请求未完成");
  console.log("课程助手已停止，Edge 和课程页面保持打开。");
} catch (e) {
  if (e.code === "ENOENT") console.log("课程助手没有运行。");
  else {
    console.error("无法停止：" + e.message);
    process.exitCode = 1;
  }
}
