import path from "node:path";
import { CodexProvider } from "./codex.js";
import { HarnessProvider } from "./harness.js";
import { readSettings, updateSettings } from "./settings.js";
export class AgentRouter {
  constructor({ providers, selected = "codex", save = async () => {} }) {
    if (!Object.hasOwn(providers, selected))
      throw new Error("保存的 Agent 不受支持");
    this.providers = providers;
    this.selected = selected;
    this.save = save;
    this.changing = false;
  }
  get name() {
    return this.providers[this.selected].name;
  }
  list() {
    return Object.entries(this.providers).map(([id, p]) => ({
      id,
      name: p.name,
    }));
  }
  async select(id) {
    if (!Object.hasOwn(this.providers, id)) throw new Error("不支持这个 Agent");
    if (this.changing) throw new Error("正在保存 Agent 设置");
    this.changing = true;
    try {
      await this.save(id);
      this.selected = id;
    } finally {
      this.changing = false;
    }
  }
  solve(...args) {
    if (this.changing) throw new Error("正在保存 Agent 设置");
    return this.providers[this.selected].solve(...args);
  }
  check(...args) {
    if (this.changing) throw new Error("正在保存 Agent 设置");
    return this.providers[this.selected].check(...args);
  }
}
export async function loadAgentRouter(dataDir) {
  const settings = await readSettings(dataDir);
  const timeoutMs = Math.max(
    10000,
    Math.min(Number(settings.modelTimeoutMs) || 120000, 300000),
  );
  const codex = new CodexProvider({
    dataDir: path.join(dataDir, "model"),
    ...(settings.codexPath ? { command: [settings.codexPath] } : {}),
    model: settings.model ?? "",
    reasoningEffort: settings.reasoningEffort ?? "low",
    timeoutMs,
  });
  return new AgentRouter({
    providers: {
      codex,
      harness: new HarnessProvider({
        ...(settings.harnessConnectionFile
          ? { connectionFile: settings.harnessConnectionFile }
          : {}),
        timeoutMs,
      }),
    },
    selected: settings.agentProvider ?? "codex",
    save: (id) => updateSettings(dataDir, { agentProvider: id }),
  });
}
