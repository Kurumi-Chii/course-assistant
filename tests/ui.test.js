import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../src/server.js";
import { AgentRouter } from "../src/providers.js";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
test("Chinese dashboard controls, narrow layout, keyboard focus and untrusted text", async (t) => {
  let phase = "ready",
    connected = true,
    pending = null,
    message = "已连接",
    attention = "",
    attentionKind = "",
    playback = null;
  const c = {
    status: () => ({
      phase,
      connected,
      pending,
      message,
      attention,
      attentionKind,
      playback,
      history: [],
      current: {
        type: "single",
        stem: '<img src=x onerror="window.pwned=1">题目',
        options: [{ id: "A", text: "<script>bad</script>" }],
      },
    }),
    start: async () => {
      phase = "running";
      message = "等待课程题目";
    },
    pause: () => {
      phase = "paused";
    },
    stop: async () => {
      connected = false;
      phase = "stopped";
    },
    connect: async () => {},
    acknowledge: async () => {
      pending = null;
    },
    retry: async () => {
      pending = null;
      phase = "running";
    },
  };
  const dataDir = await mkdtemp(path.join(tmpdir(), "course-ui-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const app = await createApp({
    dataDir,
    controller: c,
    provider: new AgentRouter({
      providers: {
        codex: {
          name: "Codex",
          check: async () => ({ ok: true, message: "Codex 通过" }),
        },
        harness: {
          name: "DeepSeek Harness",
          check: async () => ({ ok: true, message: "Harness 通过" }),
        },
      },
    }),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  t.after(async () => {
    await browser.close();
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
  });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.testNotices = [];
    window.Notification = class {
      static permission = "granted";
      static async requestPermission() {
        return "granted";
      }
      constructor(title, options) {
        this.record = { title, ...options, closed: false };
        window.testNotices.push(this.record);
      }
      close() {
        this.record.closed = true;
      }
    };
  });
  await page.goto("http://127.0.0.1:" + app.server.address().port);
  const randomFallback = page.getByRole("checkbox", {
    name: "模型无法确定时随机选择",
  });
  assert.equal(await randomFallback.isChecked(), false);
  const randomSaved = page.waitForResponse(
    (response) => response.url().endsWith("/api/action") && response.ok(),
  );
  await randomFallback.click();
  await randomSaved;
  await page.reload();
  await page.locator("#random-fallback:checked").waitFor();
  await page.getByRole("button", { name: "开始处理", exact: true }).click();
  await page.getByRole("heading", { name: "正在自动处理" }).waitFor();
  assert.equal(phase, "running");
  assert.equal(await randomFallback.isDisabled(), true);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("heading", { name: "已暂停", exact: true }).waitFor();
  await page.locator("#agent-select").selectOption("harness");
  await page.waitForFunction(() =>
    document
      .querySelector("#agent-label")
      .textContent.includes("DeepSeek Harness"),
  );
  await page
    .getByRole("button", { name: "检查 Agent 连接", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#model-message").textContent === "Harness 通过",
  );
  attention = "课程页在后台，请手动切回课程页";
  phase = "running";
  await page.reload();
  await page.getByRole("heading", { name: "等待你切回课程页" }).waitFor();
  assert.equal(await page.locator("#alert").isVisible(), true);
  assert.match(await page.locator("#error").textContent(), /切回/);
  await page.waitForFunction(() => document.title.includes("请切回课程页"));
  assert.equal(await page.evaluate(() => testNotices.length), 1);
  assert.equal(
    await page.evaluate(() => testNotices[0].tag),
    "course-assistant-attention",
  );
  attention = "";
  phase = "paused";
  await page.getByRole("heading", { name: "已暂停", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => testNotices.length), 1);
  assert.equal(await page.evaluate(() => testNotices[0].closed), true);
  playback = { state: "paused", currentTime: 12, duration: 60 };
  attention = "视频已暂停，请手动查看课程页；不会跳到下一节。";
  attentionKind = "playback";
  await page.getByRole("heading", { name: "视频需要你处理" }).waitFor();
  assert.match(
    await page.locator("#playback-message").textContent(),
    /已暂停.*0:12.*1:00/,
  );
  attention = "";
  attentionKind = "";
  await page.getByRole("heading", { name: "已暂停", exact: true }).waitFor();
  assert.equal(await page.locator("#question img").count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  pending = { stage: "solving", key: "test" };
  phase = "ready";
  await page.reload();
  await page.getByRole("heading", { name: "有未完成题目" }).waitFor();
  assert.equal(await page.locator("#start").isDisabled(), true);
  await page.getByRole("button", { name: "重试本题", exact: true }).click();
  await page.getByRole("heading", { name: "正在自动处理" }).waitFor();
  pending = { stage: "resume-intent", key: "test" };
  phase = "paused";
  await page.reload();
  await page.getByRole("heading", { name: "有未完成题目" }).waitFor();
  assert.equal(await page.locator("#retry").isHidden(), true);
  await page.getByRole("button", { name: "连接 Edge", exact: true }).focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), "connect");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mkdir("data/verification", { recursive: true });
  await page.screenshot({
    path: "data/verification/panel-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.screenshot({
    path: "data/verification/panel-desktop.png",
    fullPage: true,
  });
});
