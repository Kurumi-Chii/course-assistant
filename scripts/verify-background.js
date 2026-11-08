// An isolated native-window check. Never attaches to the user's course session.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { BrowserBridge } from "../src/browser.js";
import { extractPage } from "../src/dom.js";

const browser = await chromium.launch({ channel: "msedge", headless: false });
try {
  const page = await browser.newPage();
  await page.setContent(
    '<title>课程助手：独立后台检查</title><button id="target">仅测试</button><script>window.clicks=0;document.querySelector("button").onclick=()=>window.clicks++;</script>',
  );
  const cdp = await page.context().newCDPSession(page);
  // The real MCP extension uses noDefaults; reproduce native focus rather than
  // Playwright's usual focus emulation in this isolated test browser.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  const bridge = new BrowserBridge();
  const initial = await page.evaluate(extractPage);
  bridge.bound = { url: initial.url, documentKey: initial.documentKey };
  bridge.client = {
    async callTool({ name, arguments: args }) {
      assert.equal(name, "browser_run_code_unsafe");
      try {
        await new Function("return (" + args.code + ")")()(page);
        return { content: [] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error.message }],
        };
      }
    },
  };
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "minimized" },
  });
  await page.waitForFunction(() => !document.hasFocus(), null, { timeout: 5000 });
  const background = await page.evaluate(extractPage);
  assert.equal(background.foreground, false);
  await assert.rejects(bridge.click("#target"), /后台/);
  assert.equal(await page.evaluate(() => window.clicks), 0);
  console.log(
    JSON.stringify({
      minimizedForeground: background.foreground,
      backgroundClickBlocked: true,
      clicks: 0,
    }),
  );
} finally {
  await browser.close();
}
