import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readSettings(dataDir) {
  try {
    return JSON.parse(
      await readFile(path.join(dataDir, "settings.json"), "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("settings.json 格式无效");
  }
}

export async function updateSettings(dataDir, changes) {
  const file = path.join(dataDir, "settings.json");
  const current = await readSettings(dataDir);
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify({ ...current, ...changes }, null, 2));
  await rename(tmp, file);
}

export async function getPanelPort(dataDir) {
  const configured =
    process.env.COURSE_PORT ?? (await readSettings(dataDir)).panelPort ?? 18767;
  const port = Number(configured);
  if (
    !/^\d+$/.test(String(configured)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("控制面板端口必须是 1 到 65535 之间的整数");
  return port;
}
