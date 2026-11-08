import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { SiteAdapter } from "../src/site.js";
import { identity } from "../src/question.js";
let browser;
before(async () => {
  browser = await chromium.launch({ channel: "msedge", headless: true });
});
after(async () => {
  await browser?.close();
});
async function setup(t) {
  const page = await browser.newPage();
  await page.setContent(await readFile("tests/fixtures/course.html", "utf8"));
  const bridge = {
    read: (fn) => page.evaluate(fn),
    click: (selector) => page.locator(selector).click(),
    assertTarget: async () => {},
  };
  t.after(() => page.close());
  return { page, site: new SiteAdapter(bridge), guard: () => {} };
}

async function svgMulti(page, preselected = []) {
  await page.evaluate((selected) => {
    showQuiz("multi");
    const panel = document.querySelector(".el-dialog");
    panel.querySelector(".submit").remove();
    const items = [...panel.querySelectorAll("li")];
    items.forEach((el, i) => {
      el.removeAttribute("role");
      el.removeAttribute("aria-checked");
      el.className = "topic-item";
      el.innerHTML =
        '<svg class="icon topic-option"><use xlink:href="' +
        (selected.includes(i) ? "#iconfuxuanzhong" : "#iconfuxuan") +
        '"></use></svg><span>' +
        String.fromCharCode(65 + i) +
        '.</span><div class="item-topic">' +
        ["2", "3", "4"][i] +
        "</div>";
      el.onclick = () => {
        const use = el.querySelector("use");
        use.setAttribute(
          "xlink:href",
          use.getAttribute("xlink:href") === "#iconfuxuan"
            ? "#iconfuxuanzhong"
            : "#iconfuxuan",
        );
        const ids = items
          .map((node, j) =>
            node.querySelector("use").getAttribute("xlink:href") ===
            "#iconfuxuanzhong"
              ? j
              : -1,
          )
          .filter((j) => j >= 0);
        panel.querySelector(".result").textContent = ids.includes(1)
          ? "错误 正确答案：A,C"
          : JSON.stringify(ids) === "[0,2]"
            ? "正确 正确答案：A,C"
            : "";
      };
    });
  }, preselected);
}

test("WisdomTree SVG checkbox state is recognized and a preselected choice is preserved", async (t) => {
  const { page, site, guard } = await setup(t);
  await svgMulti(page, [0]);
  const q = (await site.read()).quiz;
  assert.equal(q.options[0].selected, true);
  await site.select(q, ["A", "C"], guard);
  assert.equal((await site.feedback(q, guard)).result, "correct");
});

test("a proven pre-click background failure waits and then selects without replaying previous choices", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz("multi"));
  const q = (await site.read()).quiz;
  const click = site.bridge.click;
  let attempts = 0,
    waits = 0;
  site.bridge.click = async (...args) => {
    if (++attempts === 2)
      throw Object.assign(new Error("background before click"), {
        code: "COURSE_BACKGROUND_BEFORE_CLICK",
      });
    return click(...args);
  };
  await site.select(q, ["A", "C"], guard, async () => {
    waits++;
  });
  assert.equal(waits, 1);
  assert.equal((await site.feedback(q, guard)).result, "correct");
  assert.equal((await site.read()).quiz.options[0].selected, true);
});

test("early multi-choice grading returns for close rather than abandoning the dialog", async (t) => {
  const { page, site, guard } = await setup(t);
  await svgMulti(page);
  const q = (await site.read()).quiz;
  await site.select(q, ["B", "C"], guard);
  assert.equal((await site.feedback(q, guard)).result, "incorrect");
  assert.equal((await site.read()).quiz.options[2].selected, false);
  await site.close(q, guard);
  assert.equal((await site.read()).quiz, null);
});

test("a changed selection during submit focus wait is never submitted", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz("multi"));
  const q = (await site.read()).quiz;
  const click = site.bridge.click;
  let attempts = 0;
  site.bridge.click = async (...args) => {
    if (args[0] === q.submit) {
      attempts++;
      throw Object.assign(new Error("background"), {
        code: "COURSE_BACKGROUND_BEFORE_CLICK",
      });
    }
    return click(...args);
  };
  await assert.rejects(
    site.select(q, ["A", "C"], guard, async () => {
      await page.locator("li").nth(1).click();
      if (attempts > 1) throw new Error("unexpected repeat");
    }),
    /选项|选择/,
  );
  assert.equal(attempts, 1);
  assert.equal((await site.read()).quiz.result, null);
});

test("when the controls stay hidden, revealing them never clicks a replay surface", async () => {
  const p = {
    mediaKey: "same",
    label: "一",
    paused: true,
    ended: true,
    seeking: false,
    readyState: 4,
    currentTime: 30,
    duration: 30,
    error: false,
    next: null,
    surfaceSelector: "video",
    playSelector: "#play",
  };
  let current = { ...p };
  const actions = [];
  const site = new SiteAdapter({
    read: async () => ({ quiz: null, foreground: true, playback: current }),
    hover: async () => {
      actions.push("hover");
    },
    click: async () => {
      actions.push("click");
      current = {
        ...p,
        ended: false,
        paused: false,
        currentTime: 0,
        next: { selector: "#next", disabled: false },
      };
    },
  });
  await assert.rejects(
    site.revealNextVideo(p, () => {}),
    /下一节/,
  );
  assert.deepEqual(actions, ["hover"]);
  assert.equal(current.ended, true);
});

test("hover alone revealing next never clicks the video surface", async () => {
  const p = {
    mediaKey: "same",
    paused: true,
    ended: true,
    seeking: false,
    readyState: 4,
    currentTime: 30,
    duration: 30,
    error: false,
    next: null,
    surfaceSelector: "video",
  };
  let current = p;
  const site = new SiteAdapter({
    read: async () => ({ quiz: null, foreground: true, playback: current }),
    hover: async () => {
      current = { ...p, next: { selector: "#next", disabled: false } };
    },
    click: async () => {
      throw new Error("must not click");
    },
  });
  const ready = await site.revealNextVideo(p, () => {});
  assert.equal(ready.next.selector, "#next");
});

test("a changed video aborts the control reveal", async () => {
  const p = {
    mediaKey: "one",
    paused: true,
    ended: true,
    seeking: false,
    readyState: 4,
    currentTime: 30,
    duration: 30,
    error: false,
    next: null,
    surfaceSelector: "video",
  };
  let current = p,
    clicks = 0;
  const site = new SiteAdapter({
    read: async () => ({ quiz: null, foreground: true, playback: current }),
    hover: async () => {
      current = { ...p, mediaKey: "two" };
    },
    click: async () => clicks++,
  });
  await assert.rejects(
    site.revealNextVideo(p, () => {}),
    /变化/,
  );
  assert.equal(clicks, 0);
});

test("pausing during the hover wait aborts the control reveal", async () => {
  const p = {
    mediaKey: "one",
    paused: true,
    ended: true,
    seeking: false,
    readyState: 4,
    currentTime: 30,
    duration: 30,
    error: false,
    next: null,
    surfaceSelector: "video",
  };
  let hovered = false,
    cancelled = false,
    clicks = 0;
  const site = new SiteAdapter({
    read: async () => {
      if (hovered) {
        await new Promise((resolve) => setTimeout(resolve, 650));
        setTimeout(() => {
          cancelled = true;
        }, 0);
      }
      return { quiz: null, foreground: true, playback: p };
    },
    hover: async () => {
      hovered = true;
    },
    click: async () => {
      clicks++;
    },
  });
  await assert.rejects(
    site.revealNextVideo(p, () => {
      if (cancelled) throw new Error("cancelled");
    }),
    /cancelled/,
  );
  assert.equal(clicks, 0);
});
test("single-choice grades, closes and toggles player once without playback inspection", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz());
  const q = (await site.read()).quiz;
  assert.equal(q.type, "single");
  await site.select(q, ["A"], guard);
  assert.equal((await site.feedback(q, guard)).result, "correct");
  await site.close(q, guard);
  assert.equal((await site.read()).quiz, null);
  await site.resumeOnce(guard);
  assert.equal(await page.evaluate(() => playerClicks), 1);
});
test("multi-choice preserves required preselected options and submits once", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz("multi", [0]));
  const q = (await site.read()).quiz;
  await site.select(q, ["A", "C"], guard);
  assert.equal((await site.feedback(q, guard)).result, "correct");
  assert.equal(await page.locator('[aria-checked="true"]').count(), 2);
});
test("wrong answer result closes and permits one player click", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz());
  const q = (await site.read()).quiz;
  await site.select(q, ["B"], guard);
  assert.equal((await site.feedback(q, guard)).result, "incorrect");
  await site.close(q, guard);
  await site.resumeOnce(guard);
  assert.equal(await page.evaluate(() => playerClicks), 1);
  assert.equal((await site.read()).quiz, null);
});
test("ungraded quiz is never closed", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz());
  const q = (await site.read()).quiz;
  await assert.rejects(site.close(q, guard), /结果|反馈/);
  assert.equal(await page.locator(".el-dialog").count(), 1);
});
test("delayed grading remains supported after browser roundtrips become faster", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => {
    showQuiz();
    document.querySelector("li").onclick = () => {
      setTimeout(
        () =>
          (document.querySelector(".result").textContent = "正确 正确答案：A"),
        4000,
      );
    };
  });
  const q = (await site.read()).quiz;
  await site.select(q, ["A"], guard);
  assert.equal((await site.feedback(q, guard)).result, "correct");
});
test("preselected wrong option stops before any multi-choice clicks", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz("multi", [1]));
  const q = (await site.read()).quiz;
  await assert.rejects(site.select(q, ["A", "C"], guard), /已选|手动/);
  assert.equal(await page.locator('[aria-checked="true"]').count(), 1);
});
test("new question, unknown type and abnormal-script dialog never accept stale actions", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz());
  const q = (await site.read()).quiz;
  await page
    .locator(".stem")
    .evaluate((el) => (el.textContent = "【单选题】另一道题"));
  await assert.rejects(site.select(q, ["A"], guard), /变化|改变/);
  await page.evaluate(() => {
    document.querySelector(".el-dialog").textContent =
      "检测到异常脚本，请关闭插件";
  });
  assert.equal((await site.read()).blocked, true);
  await assert.rejects(site.resumeOnce(guard), /异常脚本/);
});
test("judgement and graded identity remain stable, hidden dialog is ignored", async (t) => {
  const { page, site, guard } = await setup(t);
  await page.evaluate(() => showQuiz("judgement"));
  const q = (await site.read()).quiz;
  await site.select(q, ["A"], guard);
  assert.equal(identity((await site.read()).quiz), identity(q));
  await page
    .locator(".el-dialog")
    .evaluate((el) => (el.style.display = "none"));
  assert.equal((await site.read()).quiz, null);
});
test("cancellation immediately before action prevents clicking", async (t) => {
  const { page, site } = await setup(t);
  await page.evaluate(() => showQuiz());
  const q = (await site.read()).quiz;
  await assert.rejects(
    site.select(q, ["A"], () => {
      throw new Error("cancelled");
    }),
    /cancelled/,
  );
  assert.equal(await page.locator('[aria-checked="true"]').count(), 0);
});

test("only explicit grading feedback determines correctness, never options or answer references", async (t) => {
  const { page, site } = await setup(t);
  await page.evaluate(() => showQuiz());
  await page
    .locator(".result")
    .evaluate((el) => (el.textContent = "回答错误 正确答案：B"));
  assert.equal((await site.read()).quiz.result, "incorrect");
  await page
    .locator(".result")
    .evaluate((el) => (el.textContent = "参考答案：B"));
  assert.equal((await site.read()).quiz.result, null);
  await page
    .locator("li")
    .last()
    .evaluate((el) => (el.textContent = "B. 错误"));
  await page
    .locator(".result")
    .evaluate((el) => (el.textContent = "回答正确 正确答案：A"));
  assert.equal((await site.read()).quiz.result, "correct");
});
test("root is-checked classes are respected and non-practice quizzes are rejected", async (t) => {
  const { page, site } = await setup(t);
  await page.evaluate(() => showQuiz("multi", [0]));
  await page
    .locator("li")
    .first()
    .evaluate((el) => {
      el.removeAttribute("aria-checked");
      el.className = "is-checked";
    });
  assert.equal((await site.read()).quiz.options[0].selected, true);
  await page.locator("h2").evaluate((el) => (el.textContent = "期末考试"));
  await page
    .locator(".el-dialog")
    .evaluate((el) => el.setAttribute("aria-label", "期末考试"));
  await assert.rejects(site.read(), /随堂|练习/);
});
test("same course page with exam dialog is refused", async (t) => {
  const { page, site } = await setup(t);
  await page.evaluate(() => showQuiz());
  await page.locator("h2").evaluate((el) => (el.textContent = "期末考试"));
  await page
    .locator(".el-dialog")
    .evaluate((el) => el.setAttribute("aria-label", "期末考试"));
  await assert.rejects(site.read(), /随堂|练习/);
});
