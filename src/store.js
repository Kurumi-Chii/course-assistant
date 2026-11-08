import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
export class Journal {
  constructor(dir, { limit = 200 } = {}) {
    this.dir = dir;
    this.file = path.join(dir, "journal.json");
    this.limit = limit;
    this.history = [];
    this.pending = null;
    this.writes = Promise.resolve();
  }
  async load() {
    await mkdir(this.dir, { recursive: true });
    let value;
    try {
      value = JSON.parse(await readFile(this.file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw new Error("处理记录已损坏，请备份后检查，程序未继续运行");
    }
    if (!Array.isArray(value.history) || typeof value.pending !== "object")
      throw new Error("处理记录格式损坏");
    this.history = value.history.slice(-this.limit);
    this.pending = value.pending;
  }
  async save(next = { pending: this.pending, history: this.history }) {
    const value = JSON.stringify({
      version: 1,
      pending: next.pending,
      history: next.history,
    });
    const job = this.writes.then(async () => {
      const tmp = this.file + ".tmp";
      await writeFile(tmp, value, "utf8");
      await rename(tmp, this.file);
      this.pending = next.pending;
      this.history = next.history;
    });
    this.writes = job.catch(() => {});
    await job;
  }
  async begin({
    key,
    stem,
    kind = "quiz",
    stage = "solving",
    provider = kind === "video" ? "page" : "Codex",
  }) {
    if (this.pending) throw new Error("存在未完成处理，需要手动确认");
    const pending = {
      key,
      stem: stem.slice(0, 1200),
      kind,
      provider,
      stage,
      startedAt: new Date().toISOString(),
    };
    await this.save({ pending, history: this.history });
  }
  async step(stage, extra = {}) {
    if (!this.pending) throw new Error("处理记录缺失");
    await this.save({
      pending: { ...this.pending, ...extra, stage },
      history: this.history,
    });
  }
  async finish({ outcome, reason = "", selectedOptionIds, timings }) {
    if (this.pending) {
      const entry = {
        ...this.pending,
        finishedAt: new Date().toISOString(),
        outcome,
        reason: reason.slice(0, 2000),
        selectedOptionIds:
          selectedOptionIds ?? this.pending.selectedOptionIds ?? [],
        provider:
          this.pending.kind === "video"
            ? "page"
            : (this.pending.provider ?? "Codex"),
        ...(timings ? { timings } : {}),
      };
      await this.save({
        pending: null,
        history: [...this.history, entry].slice(-this.limit),
      });
    }
  }
}
