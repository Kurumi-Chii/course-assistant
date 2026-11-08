import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCourseUrl, BrowserBridge } from "../src/browser.js";
test("only known embedded course URLs and explicit local demo are accepted", () => {
  assert.doesNotThrow(() =>
    assertCourseUrl("https://studyvideoh5.zhihuishu.com/stuStudy?a=1"),
  );
  for (const url of [
    "https://evil.example/stuStudy",
    "https://studyvideoh5.zhihuishu.com/exam",
    "https://studyvideoh5.zhihuishu.com.evil.com/stuStudy",
    "file:///x",
    "http://127.0.0.1:9/demo",
  ])
    assert.throws(() => assertCourseUrl(url));
  assert.doesNotThrow(() =>
    assertCourseUrl(
      "http://127.0.0.1:18767/demo",
      "http://127.0.0.1:18767/demo",
    ),
  );
});
test("one page read validates the same snapshot without a second browser roundtrip", async () => {
  const bridge = new BrowserBridge();
  bridge.bound = {
    url: "https://studyvideoh5.zhihuishu.com/stuStudy?a=1",
    documentKey: "123",
  };
  let calls = 0;
  bridge.rawRead = async () => {
    calls++;
    return { ...bridge.bound, quiz: null };
  };
  const value = await bridge.read(() => {});
  assert.equal(value.quiz, null);
  assert.equal(calls, 1);
  bridge.rawRead = async () => ({ ...bridge.bound, documentKey: "reloaded" });
  await assert.rejects(
    bridge.read(() => {}),
    /刷新|改变/,
  );
});

test("only the actual pre-click background error is eligible for safe waiting", async () => {
  const bridge = new BrowserBridge();
  bridge.client = {
    callTool: async () => ({
      isError: true,
      content: [
        { type: "text", text: "### Error\nError: course page background\n" },
      ],
    }),
  };
  await assert.rejects(
    bridge.call("browser_run_code_unsafe", {}),
    (e) => e.code === "COURSE_BACKGROUND_BEFORE_CLICK",
  );
  bridge.client.callTool = async () => ({
    isError: true,
    content: [
      {
        type: "text",
        text: "### Error\nError: click timeout\n### Ran Playwright code\nthrow new Error('course page background');",
      },
    ],
  });
  await assert.rejects(
    bridge.call("browser_run_code_unsafe", {}),
    (e) => e.code !== "COURSE_BACKGROUND_BEFORE_CLICK",
  );
});

test("a rejected quiz state check reports why the browser skipped the click", async () => {
  const bridge = new BrowserBridge();
  bridge.client = {
    callTool: async () => ({
      isError: true,
      content: [
        { type: "text", text: "### Error\nError: quiz or selection changed\n" },
      ],
    }),
  };
  await assert.rejects(bridge.call("browser_run_code_unsafe", {}), {
    code: "COURSE_QUIZ_CHANGED_BEFORE_CLICK",
    message: /题目或已选项发生变化/,
  });
});
