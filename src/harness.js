import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { normalizeQuestion, validateAnswer } from "./question.js";
import { APP } from "../packages/harness-course-agent/protocol.js";
export class HarnessProvider {
  name = "DeepSeek Harness";
  constructor({
    connectionFile = path.join(
      process.env.DSH_HOME || path.join(homedir(), ".dsh"),
      "course-assistant",
      "connection.json",
    ),
    timeoutMs = 120000,
  } = {}) {
    this.connectionFile = connectionFile;
    this.timeoutMs = timeoutMs;
  }
  async connection() {
    let c;
    try {
      c = JSON.parse(await readFile(this.connectionFile, "utf8"));
    } catch {
      throw new Error(
        "未找到 Harness 连接，请启动 Harness 并启用课程助手连接插件",
      );
    }
    let u;
    try {
      u = new URL(c.endpoint);
    } catch {
      throw new Error("Harness 配对文件无效");
    }
    if (
      c.app !== APP ||
      c.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(c.token) ||
      u.protocol !== "http:" ||
      u.hostname !== "127.0.0.1" ||
      !u.port ||
      u.pathname !== "/solve" ||
      u.search ||
      u.hash ||
      u.username ||
      u.password
    )
      throw new Error("Harness 配对文件无效，请使用课程助手连接插件");
    return c;
  }
  async solve(raw, signal) {
    signal?.throwIfAborted();
    const q = normalizeQuestion(raw),
      c = await this.connection();
    const timeout = AbortSignal.timeout(this.timeoutMs),
      combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(c.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + c.token,
        },
        body: JSON.stringify({ question: q }),
        signal: combined,
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "Harness 配对失效，请重新启用连接插件"
            : response.status === 429
              ? "Harness 正在处理另一项请求，请稍后再试"
              : response.status === 422
                ? "Harness 返回的答案格式或选项不合法"
                : "Harness 模型调用失败，请检查登录和模型设置",
        );
      if (Number(response.headers.get("content-length")) > 32000)
        throw new Error("Harness 答案过长");
      let body = "",
        bytes = 0;
      const decoder = new TextDecoder();
      for await (const part of response.body) {
        bytes += part.length;
        if (bytes > 32000) throw new Error("Harness 答案过长");
        body += decoder.decode(part, { stream: true });
      }
      body += decoder.decode();
      combined.throwIfAborted();
      return validateAnswer(q, JSON.parse(body).answer);
    } catch (e) {
      if (signal?.aborted) throw new Error("模型调用已取消");
      if (timeout.aborted) throw new Error("Harness 调用超时，尚未选择答案");
      if (e instanceof TypeError)
        throw new Error("无法连接 Harness，请确认应用和连接插件正在运行");
      throw e;
    }
  }
  async check(signal) {
    const a = await this.solve(
      {
        type: "single",
        stem: "连接检查：1+1等于多少？",
        options: [
          { id: "A", text: "2" },
          { id: "B", text: "3" },
        ],
      },
      signal,
    );
    if (a.selectedOptionIds.join("") !== "A")
      throw new Error("Harness 连接检查答案异常");
    return {
      ok: true,
      provider: this.name,
      message: "DeepSeek Harness 连接检查通过",
    };
  }
}
