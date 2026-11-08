import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPage, actionEvidence } from "./dom.js";
import { playbackEvidence } from "./playback.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function mcpArguments(dataDir = path.join(root, "data"), endpoint) {
  return [
    path.join(root, "node_modules/@playwright/mcp/cli.js"),
    ...(endpoint
      ? ["--endpoint", endpoint]
      : ["--extension", "--browser", "msedge"]),
    "--output-dir",
    path.join(dataDir, "browser"),
    "--output-max-size",
    "20000000",
    "--snapshot-mode",
    "none",
    "--timeout-settle",
    "50",
  ];
}
export function assertCourseUrl(value, demoUrl) {
  const u = new URL(value);
  if (demoUrl && u.href === new URL(demoUrl).href) return;
  if (
    u.protocol === "https:" &&
    ((u.hostname === "studyvideoh5.zhihuishu.com" &&
      u.pathname === "/stuStudy") ||
      (u.hostname === "fusioncourseh5.zhihuishu.com" && u.pathname === "/"))
  )
    return;
  throw new Error("请选择智慧树课程视频页，而不是作业、考试或其他网页");
}
export class BrowserBridge {
  constructor({ dataDir = path.join(root, "data"), demoUrl } = {}) {
    this.dataDir = dataDir;
    this.demoUrl = demoUrl;
    this.client = null;
    this.bound = null;
  }
  async connect(signal) {
    if (this.client) throw new Error("已连接，请先停止后重新连接");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: mcpArguments(this.dataDir),
      cwd: root,
      stderr: "pipe",
    });
    const client = new Client(
      { name: "课程助手", version: "1.0.0" },
      { capabilities: {} },
    );
    this.client = client;
    this.transport = transport;
    const cancel = () => void this.disconnect(client);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await client.connect(transport);
      await this.call("browser_tabs", { action: "list" }, 180000);
      signal?.throwIfAborted();
      const state = await this.rawRead(extractPage);
      assertCourseUrl(state.url, this.demoUrl);
      if (this.client !== client) throw new Error("连接已取消");
      this.bound = {
        url: state.url,
        documentKey: state.documentKey,
        title: state.title,
      };
      return {
        title: state.title,
        url: new URL(state.url).origin + new URL(state.url).pathname,
      };
    } catch (e) {
      await this.disconnect(client);
      throw e;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  async call(name, args, timeout = 15000) {
    if (!this.client) throw new Error("浏览器连接已断开");
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout },
    );
    if (result.isError) {
      this.lastErrorDetail = (result.content ?? [])
        .filter((x) => x.type === "text")
        .map((x) => x.text)
        .join("\n");
      const cause = this.lastErrorDetail;
      const preClickReason =
        name === "browser_run_code_unsafe"
          ? cause
              .split("### Ran")[0]
              .match(
                /^(?:Error:\s*)?(course page background|quiz or selection changed)\s*$/m,
              )?.[1]
          : undefined;
      const messages = {
        "course page background": {
          code: "COURSE_BACKGROUND_BEFORE_CLICK",
          message: "课程页在点击前切到后台，已暂停；请手动检查课程页后确认记录",
        },
        "quiz or selection changed": {
          code: "COURSE_QUIZ_CHANGED_BEFORE_CLICK",
          message: "点击前发现题目或已选项发生变化，已暂停，请检查课程页",
        },
      };
      const reason = messages[preClickReason];
      const error = new Error(
        reason?.message ?? "浏览器操作未完成，已暂停；请检查页面和连接",
        { cause },
      );
      if (reason) error.code = reason.code;
      throw error;
    }
    return result;
  }
  async rawRead(fn) {
    const r = await this.call("browser_evaluate", {
      function: "(" + fn.toString() + ")",
    });
    const text = (r.content ?? [])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("\n");
    const match = text.match(/### Result\s*\n([\s\S]*?)(?:\n### |$)/);
    if (!match) throw new Error("浏览器返回格式无法识别");
    return JSON.parse(match[1].trim());
  }
  async assertTarget() {
    const state = await this.rawRead(() => ({
      url: location.href,
      documentKey: String(performance.timeOrigin),
    }));
    this.assertState(state);
  }
  assertState(state) {
    if (
      !this.bound ||
      state.url !== this.bound.url ||
      state.documentKey !== this.bound.documentKey
    )
      throw new Error("课程页已刷新、关闭或改变，请重新连接");
  }
  async read(fn) {
    const state = await this.rawRead(fn);
    this.assertState(state);
    return state;
  }
  async hover(
    selector,
    expectedQuiz,
    expectedPlayback = null,
    mediaMode = "exact",
  ) {
    return this.click(
      selector,
      expectedQuiz,
      expectedPlayback,
      mediaMode,
      "hover",
    );
  }
  async click(
    selector,
    expectedQuiz,
    expectedPlayback = null,
    mediaMode = "exact",
    action = "click",
  ) {
    if (
      !["click", "hover"].includes(action) ||
      !["exact", "reveal-controls"].includes(mediaMode)
    )
      throw new Error("不支持的播放器操作");
    if (typeof selector !== "string" || selector.length > 5000)
      throw new Error("页面按钮无法定位");
    const bound = this.bound;
    if (!bound) throw new Error("浏览器未连接");
    const pointerOptions =
      action === "hover" && mediaMode === "reveal-controls"
        ? "await handle.evaluate(el=>el.matches('div.videoArea')?{position:{x:el.clientWidth/2,y:el.clientHeight*0.9}}:{})"
        : "{}";
    const code = `async (page) => {
      if(!await page.evaluate(()=>document.visibilityState==='visible'&&document.hasFocus()))throw new Error('course page background');
      const handle=await page.$(${JSON.stringify(selector)}); if(!handle)throw new Error('target missing');
      const panel=await handle.evaluateHandle(el=>el.closest('[role="dialog"],.el-dialog')||el);
      try {
        const pointerOptions=${pointerOptions};
        await handle.${action}({...pointerOptions,trial:true,timeout:3000});
        const state=await page.evaluate(${extractPage.toString()});
        if(state.url!==${JSON.stringify(bound.url)}||state.documentKey!==${JSON.stringify(bound.documentKey)})throw new Error('target changed');
        if(state.blocked||state.problem)throw new Error('page blocked');
        const evidence=${actionEvidence.toString()};
        if(${JSON.stringify(expectedQuiz ?? null)}!==null&&evidence(state.quiz)!==${JSON.stringify(expectedQuiz ?? null)})throw new Error('quiz or selection changed');
        const mediaEvidence=${playbackEvidence.toString()};
        if(${JSON.stringify(expectedPlayback)}!==null&&mediaEvidence(state.playback,${JSON.stringify(mediaMode)})!==${JSON.stringify(expectedPlayback)})throw new Error('video changed or already playing');
        if(!await panel.evaluate(el=>el.isConnected)||!await handle.evaluate(el=>el.isConnected))throw new Error('original node detached');
        if(!await page.evaluate(()=>document.visibilityState==='visible'&&document.hasFocus()))throw new Error('course page background');
        await handle.${action}({...pointerOptions,timeout:1000});return {performed:${JSON.stringify(action)}};
      } finally {await panel.dispose();await handle.dispose();}
    }`;
    await this.call("browser_run_code_unsafe", { code }, 10000);
  }
  async disconnect(client = this.client) {
    if (this.client === client) {
      this.client = null;
      this.bound = null;
    }
    await client?.close().catch(() => {});
  }
}
