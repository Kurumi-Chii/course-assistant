import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BrowserBridge, mcpArguments } from "../src/browser.js";
import { SiteAdapter } from "../src/site.js";
import { extractPage, actionEvidence } from "../src/dom.js";
import { playbackState, playbackEvidence } from "../src/playback.js";
test("official MCP executes the real fixed-code select, close and playback path", async (t) => {
  const server = await chromium.launchServer({
    channel: "msedge",
    headless: true,
  });
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent(await readFile("tests/fixtures/course.html", "utf8"));
  await page.evaluate(() => showQuiz());
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: mcpArguments(
      path.resolve("data/verification/mcp-test"),
      server.wsEndpoint(),
    ),
    stderr: "pipe",
  });
  const bridge = new BrowserBridge();
  bridge.client = new Client(
    { name: "MCP fixture regression", version: "1" },
    { capabilities: {} },
  );
  t.after(async () => {
    await bridge.disconnect();
    await browser.close();
    await server.close();
  });
  await bridge.client.connect(transport);
  await bridge.call("browser_tabs", { action: "list" });
  await bridge.call("browser_run_code_unsafe", {
    code:
      "async page => { await page.setContent(" +
      JSON.stringify(await readFile("tests/fixtures/course.html", "utf8")) +
      "); }",
  });
  await bridge.call("browser_evaluate", {
    function:
      "() => { showQuiz(); const stem = document.querySelector('.stem'); stem.textContent = stem.textContent.replace('】', '】　 '); }",
  });
  const state = await bridge.rawRead(extractPage);
  bridge.bound = { url: state.url, documentKey: state.documentKey };
  const site = new SiteAdapter(bridge);
  const q = (await site.read()).quiz;
  assert.ok(q);
  try {
    await site.select(q, ["A"], () => {});
    await site.close(q, () => {});
    await site.resumeOnce(() => {});
  } catch (e) {
    throw new Error(e.message + " " + e.cause);
  }
  assert.equal(
    (await bridge.rawRead(() => ({ clicks: playerClicks }))).clicks,
    1,
  );
  assert.equal((await site.read()).quiz, null);
  await bridge.call("browser_evaluate", { function: "() => showQuiz()" });
  const wrong = (await site.read()).quiz;
  await site.select(wrong, ["B"], () => {});
  assert.equal((await site.feedback(wrong, () => {})).result, "incorrect");
  await site.close(wrong, () => {});
  await site.resumeOnce(() => {});
  assert.equal(
    (await bridge.rawRead(() => ({ clicks: playerClicks }))).clicks,
    2,
  );
  assert.equal((await site.read()).quiz, null);
  for (const mutation of ["replace", "selected"]) {
    await bridge.call("browser_evaluate", { function: "() => showQuiz()" });
    const fresh = (await site.read()).quiz;
    await bridge.call("browser_evaluate", {
      function: `() => {const el=document.querySelector('li');el.style.pointerEvents='none';setTimeout(()=>{${mutation === "replace" ? "const ul=el.parentElement; const replacement=ul.cloneNode(true);replacement.querySelector('li').style.pointerEvents='auto';ul.replaceWith(replacement);" : "el.setAttribute('aria-checked','true');el.style.pointerEvents='auto';"}},1200);}`,
    });
    await assert.rejects(
      bridge.click(fresh.options[0].selector, actionEvidence(fresh)),
      "stale " + mutation + " must not click",
    );
  }
  await bridge.call("browser_run_code_unsafe", {
    code:
      "async page => { await page.setContent(" +
      JSON.stringify(
        await readFile("tests/fixtures/video-course.html", "utf8"),
      ) +
      "); await page.evaluate(() => boot()); }",
  });
  const paused = (await site.read()).playback;
  assert.equal(playbackState(paused), "paused");
  await assert.rejects(
    site.nextVideo(paused, () => {}),
    /状态|入口/,
  );
  await bridge.call("browser_run_code_unsafe", {
    code: "async page => { await page.evaluate(() => finishVideo()); }",
  });
  const ended = (await site.read()).playback;
  assert.equal(playbackState(ended), "ended");
  assert.equal(ended.next.disabled, false);
  await bridge.call("browser_evaluate", {
    function: "() => {document.querySelector('video').currentTime=0;}",
  });
  await assert.rejects(
    bridge.click(ended.next.selector, "", playbackEvidence(ended)),
    "a restarted video cannot use stale ended evidence",
  );
  assert.equal((await bridge.rawRead(() => ({ nextClicks }))).nextClicks, 0);
  await bridge.call("browser_run_code_unsafe", {
    code: "async page => { await page.evaluate(() => finishVideo()); }",
  });
  await bridge.call("browser_evaluate", {
    function:
      "() => {surfaceClicks=0;const v=document.querySelector('video'),n=document.querySelector('#next');n.hidden=true;v.onmousemove=()=>n.hidden=false;v.onclick=()=>surfaceClicks++;}",
  });
  const hiddenFirst = (await site.read()).playback;
  assert.equal(hiddenFirst.next, null);
  const revealedFirst = await site.revealNextVideo(hiddenFirst, () => {});
  assert.ok(revealedFirst.next);
  assert.equal(
    (await bridge.rawRead(() => ({ surfaceClicks }))).surfaceClicks,
    0,
  );
  const second = await site.nextVideo(revealedFirst, () => {});
  await site.playNextVideo(second.playback, () => {});
  assert.equal((await bridge.rawRead(() => ({ playClicks }))).playClicks, 1);
  await bridge.call("browser_run_code_unsafe", {
    code: "async page => { await page.evaluate(async () => {autoplayNext=true;await finishVideo();}); }",
  });
  await bridge.call("browser_evaluate", {
    function: `() => {
      const v=document.querySelector('video'),n=document.querySelector('#next');
      n.hidden=true;
      v.onmousemove=null;
      v.onclick=null;
      const player=v.parentElement;
      player.style.position='relative';
      const cover=document.createElement('div');
      cover.className='videoArea';
      Object.assign(cover.style, {
        position:'absolute', left:v.offsetLeft+'px', top:v.offsetTop+'px',
        width:v.offsetWidth+'px', height:v.offsetHeight+'px',
      });
      cover.onclick=()=>{surfaceClicks++;void v.play();};
      player.append(cover);
      const controls=document.createElement('div');
      controls.className='controlsBar';
      controls.hidden=true;
      const next=document.createElement('div');
      next.id='nextBtn';
      next.className='nextButton';
      next.style.cssText='width:80px;height:30px;cursor:pointer';
      next.onclick=async()=>{await n.onclick();next.setAttribute('aria-disabled',String(n.disabled));};
      controls.append(next);
      player.append(controls);
    }`,
  });
  const hiddenSecond = (await site.read()).playback;
  await bridge.call("browser_evaluate", {
    function:
      "() => {document.querySelector('.videoArea').className='unrecognized-cover';}",
  });
  await assert.rejects(
    bridge.click(
      hiddenSecond.surfaceSelector,
      "",
      playbackEvidence(hiddenSecond, "reveal-controls"),
      "reveal-controls",
    ),
    (error) => /video changed or already playing/.test(error.cause),
  );
  assert.equal(
    (await bridge.rawRead(() => ({ surfaceClicks }))).surfaceClicks,
    0,
  );
  await bridge.call("browser_evaluate", {
    function:
      "() => {document.querySelector('.unrecognized-cover').className='videoArea';}",
  });
  await assert.rejects(
    site.revealNextVideo(hiddenSecond, () => {}),
    /下一节/,
  );
  assert.equal(
    (await bridge.rawRead(() => ({ surfaceClicks }))).surfaceClicks,
    0,
  );
  assert.equal(playbackState((await site.read()).playback), "ended");
  await bridge.call("browser_evaluate", {
    function: `() => {
      const cover=document.querySelector('.videoArea');
      cover.onmousemove=(event)=>{
        if(event.offsetY>cover.clientHeight*.8)
          document.querySelector('.controlsBar').hidden=false;
      };
    }`,
  });
  // Move off the cover between attempts so the next hover sends mousemove.
  await bridge.call("browser_run_code_unsafe", {
    code: "async page => { await page.mouse.move(0, 0); }",
  });
  const revealedSecond = await site.revealNextVideo(hiddenSecond, () => {});
  assert.ok(revealedSecond.next);
  const third = await site.nextVideo(revealedSecond, () => {});
  await site.playNextVideo(third.playback, () => {});
  assert.equal(
    (await bridge.rawRead(() => ({ playClicks, nextClicks }))).playClicks,
    1,
  );
  assert.equal((await bridge.rawRead(() => ({ nextClicks }))).nextClicks, 2);
  await bridge.call("browser_run_code_unsafe", {
    code: "async page => { await page.evaluate(() => finishVideo()); }",
  });
  const last = (await site.read()).playback;
  assert.equal(last.next.disabled, true);
  await assert.rejects(
    site.nextVideo(last, () => {}),
    /状态|入口/,
  );
});
