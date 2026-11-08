import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Controller } from "../src/controller.js";
import { Journal } from "../src/store.js";
import { identity, validateAnswer } from "../src/question.js";
const question = () => ({
  type: "single",
  stem: "测试题",
  options: [
    { id: "A", text: "对" },
    { id: "B", text: "错" },
  ],
});
async function setup(
  t,
  { solve, onAction, resumeError, result = "correct" } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "course-controller-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new Journal(dir);
  await journal.load();
  const actions = [];
  let q = question();
  const site = {
    read: async () => ({ quiz: q, blocked: false }),
    select: async () => {
      actions.push("select");
      await onAction?.("select");
    },
    feedback: async () => ({ result }),
    close: async () => {
      actions.push("close");
      q = null;
      await onAction?.("close");
    },
    resumeOnce: async () => {
      actions.push("resume");
      if (resumeError) throw new Error("uncertain click");
    },
  };
  const bridge = {
    connect: async () => ({
      title: "课程",
      url: "https://studyvideoh5.zhihuishu.com/stuStudy",
    }),
    disconnect: async () => {},
  };
  const provider = {
    solve:
      solve ??
      (async () => ({
        status: "answered",
        selectedOptionIds: ["A"],
        reason: "明确",
      })),
  };
  const c = new Controller({ bridge, site, provider, journal, pollMs: 600000 });
  t.after(() => c.stop());
  await c.connect();
  return {
    c,
    journal,
    actions,
    site,
    setQuestion: (x) => {
      q = x;
    },
  };
}
test("one complete quiz runs select-close-resume once despite repeated polling", async (t) => {
  const { c, actions, setQuestion } = await setup(t);
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
  setQuestion({ ...question(), result: "correct" });
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
  assert.equal(c.status().phase, "paused");
});
test("completed history retains separate model and browser durations", async (t) => {
  const { c, journal } = await setup(t);
  await c.start();
  await c.tick();
  const timing = journal.history.at(-1).timings;
  assert.equal(typeof timing?.modelMs, "number");
  assert.equal(typeof timing?.browserMs, "number");
  assert.ok(timing.totalMs >= timing.modelMs);
});
test("random fallback handles explicit uncertainty from a validating provider", async (t) => {
  const { c, journal, actions } = await setup(t, {
    solve: async (q) =>
      validateAnswer(q, {
        status: "uncertain",
        selectedOptionIds: [],
        reason: "",
      }),
  });
  c.randomOnUncertain = true;
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
  const entry = journal.history.at(-1);
  assert.equal(entry.selectedOptionIds.length, 1);
  assert.ok(["A", "B"].includes(entry.selectedOptionIds[0]));
  assert.match(entry.reason, /随机/);
});
test("random fallback can retry an unresolved multi-select quiz", async (t) => {
  const { c, journal, actions, setQuestion } = await setup(t, {
    solve: async () => ({
      status: "uncertain",
      selectedOptionIds: [],
      reason: "",
    }),
  });
  setQuestion({ ...question(), type: "multi" });
  await c.start();
  await c.tick();
  assert.equal(journal.pending.stage, "solving");
  c.randomOnUncertain = true;
  await c.retry();
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
  const ids = journal.history.at(-1).selectedOptionIds;
  assert.ok(ids.length > 0 && ids.every((id) => ["A", "B"].includes(id)));
  assert.equal(new Set(ids).size, ids.length);
});
test("random fallback leaves a retryable pause when disabled or the model fails", async (t) => {
  for (const [enabled, solve] of [
    [
      false,
      async () => ({ status: "uncertain", selectedOptionIds: [], reason: "" }),
    ],
    [
      true,
      async () => ({
        status: "uncertain",
        selectedOptionIds: ["A"],
        reason: "",
      }),
    ],
    [
      true,
      async () => {
        throw new Error("Harness 调用超时");
      },
    ],
  ]) {
    const { c, journal, actions } = await setup(t, { solve });
    c.randomOnUncertain = enabled;
    await c.start();
    await c.tick();
    assert.deepEqual(actions, []);
    assert.equal(c.status().phase, "paused");
    assert.equal(journal.pending.stage, "solving");
  }
});
test("late model response after pause produces no clicks", async (t) => {
  let release;
  const wait = new Promise((r) => (release = r));
  const { c, actions } = await setup(t, { solve: () => wait });
  await c.start();
  const task = c.tick();
  await new Promise((r) => setTimeout(r, 5));
  c.pause();
  release({ status: "answered", selectedOptionIds: ["A"], reason: "" });
  await task;
  assert.deepEqual(actions, []);
});
test("changed question while model runs discards response", async (t) => {
  let release;
  const entered = Promise.withResolvers();
  const { c, actions, setQuestion } = await setup(t, {
    solve: () =>
      new Promise((r) => {
        release = r;
        entered.resolve();
      }),
  });
  await c.start();
  const task = c.tick();
  await entered.promise;
  setQuestion({ ...question(), stem: "新题" });
  release({ status: "answered", selectedOptionIds: ["A"], reason: "" });
  await task;
  assert.deepEqual(actions, []);
  assert.equal(c.status().phase, "paused");
});
test("pause during option click prevents close and playback toggle", async (t) => {
  let c;
  const setupResult = await setup(t, { onAction: async () => c.pause() });
  c = setupResult.c;
  await c.start();
  await c.tick();
  assert.deepEqual(setupResult.actions, ["select"]);
});
test("incorrect grading closes and resumes once while recording the wrong answer", async (t) => {
  const { c, actions, journal } = await setup(t, { result: "incorrect" });
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
  assert.equal(c.status().phase, "running");
  assert.equal(journal.history.at(-1).outcome, "incorrect");
  assert.equal(journal.pending, null);
});

test("unknown grading still pauses before close or playback", async (t) => {
  const { c, actions } = await setup(t, { result: null });
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["select"]);
  assert.equal(c.status().phase, "paused");
});
test("legacy wrong-answer stop can finish closing without solving or selecting again", async (t) => {
  const { c, actions, journal, setQuestion } = await setup(t, {
    solve: async () => {
      throw new Error("must not solve again");
    },
  });
  await journal.begin({ key: identity(question()), stem: "测试题" });
  await journal.step("select-intent");
  await journal.finish({
    outcome: "incorrect",
    reason: "之前已判错",
    selectedOptionIds: ["A"],
  });
  c.provider.name = "DeepSeek Harness";
  setQuestion({ ...question(), result: "incorrect" });
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["close", "resume"]);
  assert.equal(journal.history.at(-1).stage, "resume-intent");
  assert.equal(journal.history.at(-1).provider, "Codex");
  setQuestion({ ...question(), result: "incorrect" });
  await c.tick();
  assert.deepEqual(actions, ["close", "resume"]);
});
test("uncertain playback request is durable and never automatically replayed", async (t) => {
  const { c, actions, journal } = await setup(t, { resumeError: true });
  await c.start();
  await c.tick();
  assert.equal(c.status().phase, "paused");
  assert.equal(journal.pending.stage, "resume-intent");
  await assert.rejects(c.start(), /确认|未完成/);
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
});
test("abnormal script stops before model or clicks", async (t) => {
  const { c, actions, site } = await setup(t);
  site.read = async () => ({ blocked: true, quiz: question() });
  await c.start();
  await c.tick();
  assert.deepEqual(actions, []);
  assert.equal(c.status().phase, "paused");
});

test("pause during initial disconnect cannot be undone by a late connection", async (t) => {
  const { c } = await setup(t);
  let release,
    connections = 0;
  c.bridge.disconnect = () => new Promise((r) => (release = r));
  c.bridge.connect = async () => {
    connections++;
    return { title: "late" };
  };
  const run = c.connect();
  c.pause();
  release();
  const error = await run.then(
    () => null,
    (e) => e,
  );
  c.bridge.disconnect = async () => {};
  assert.match(error?.message ?? "", /取消/);
  assert.equal(connections, 0);
  assert.equal(c.status().phase, "paused");
});
test("acknowledging an uncertain action never replays the same quiz", async (t) => {
  const { c, actions, setQuestion } = await setup(t, { resumeError: true });
  await c.start();
  await c.tick();
  await c.acknowledge();
  setQuestion(question());
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
});

test("an unsent answer may be explicitly retried and completed once", async (t) => {
  let attempts = 0;
  const { c, journal, actions } = await setup(t, {
    solve: async () => {
      if (++attempts === 1) throw new Error("Codex 调用超时");
      return { status: "answered", selectedOptionIds: ["A"], reason: "明确" };
    },
  });
  await c.start();
  await c.tick();
  assert.equal(journal.pending.stage, "solving");
  assert.deepEqual(actions, []);
  await c.retry();
  await c.tick();
  assert.equal(attempts, 2);
  assert.deepEqual(actions, ["select", "close", "resume"]);
  assert.equal(journal.history[0].retryCount, 1);
});

test("retry refuses changed, graded or blocked questions and all click-intent stages", async (t) => {
  const { c, journal, site, actions } = await setup(t);
  await journal.begin({ key: identity(question()), stem: "测试题" });
  for (const state of [
    { quiz: { ...question(), stem: "新题" } },
    { quiz: { ...question(), result: "incorrect" } },
    { blocked: true, quiz: question() },
  ]) {
    site.read = async () => state;
    await assert.rejects(c.retry());
    assert.equal(journal.pending.stage, "solving");
  }
  site.read = async () => ({ quiz: question() });
  for (const stage of ["select-intent", "close-intent", "resume-intent"]) {
    await journal.step(stage);
    await assert.rejects(c.retry(), /点击|手动/);
    assert.equal(journal.pending.stage, stage);
  }
  assert.deepEqual(actions, []);
});

test("pausing during retry validation cannot restart processing", async (t) => {
  const { c, journal, site } = await setup(t);
  await journal.begin({ key: identity(question()), stem: "测试题" });
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  site.read = async () => {
    entered.resolve();
    return release.promise;
  };
  const retry = c.retry();
  await entered.promise;
  await assert.rejects(c.retry(), /进行中|结束/);
  c.pause();
  release.resolve({ quiz: question() });
  await assert.rejects(retry, /取消/);
  assert.equal(c.phase, "paused");
  assert.equal(journal.pending.stage, "solving");
});

test("failed retry journal write retains the pending record and sends no clicks", async (t) => {
  const { c, journal, actions } = await setup(t);
  const key = identity(question());
  await journal.begin({ key, stem: "测试题" });
  c.seen.add(key);
  journal.step = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(c.retry(), /disk full/);
  assert.equal(journal.pending.stage, "solving");
  assert.equal(c.seen.has(key), true);
  assert.equal(c.phase, "paused");
  assert.deepEqual(actions, []);
});

test("pause during retry journal save preserves the unfinished question", async (t) => {
  const { c, journal } = await setup(t);
  const key = identity(question());
  await journal.begin({ key, stem: "测试题" });
  c.seen.add(key);
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const save = journal.save.bind(journal);
  journal.save = async (next) => {
    entered.resolve();
    await release.promise;
    await save(next);
  };
  const retry = c.retry();
  await entered.promise;
  c.pause();
  release.resolve();
  await assert.rejects(retry, /取消/);
  assert.equal(journal.pending?.stage, "solving");
  assert.equal(c.seen.has(key), true);
  assert.equal(c.phase, "paused");
});

test("a background quiz only requests manual focus without solving or clicking", async (t) => {
  let solves = 0;
  const { c, site, actions, journal } = await setup(t, {
    solve: async () => {
      solves++;
      throw new Error("must wait");
    },
  });
  site.read = async () => ({ quiz: question(), foreground: false });
  await c.start();
  await c.tick();
  assert.equal(solves, 0);
  assert.equal(journal.pending, null);
  assert.match(c.status().attention, /切回/);
  assert.equal(c.phase, "running");
  assert.deepEqual(actions, []);
});

test("a ready answer waits for foreground and is not solved again", async (t) => {
  const waiting = Promise.withResolvers();
  let solves = 0,
    foreground = true;
  const { c, site, actions } = await setup(t, {
    solve: async () => {
      solves++;
      foreground = false;
      return { status: "answered", selectedOptionIds: ["A"], reason: "明确" };
    },
  });
  const read = site.read;
  site.read = async () => {
    if (!foreground) waiting.resolve();
    return { ...(await read()), foreground };
  };
  await c.start();
  const task = c.tick();
  await waiting.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actions, []);
  assert.match(c.status().attention, /切回/);
  foreground = true;
  await task;
  assert.equal(solves, 1);
  assert.deepEqual(actions, ["select", "close", "resume"]);
  assert.equal(c.status().attention, "");
});

test("pause while waiting for foreground cancels all browser actions", async (t) => {
  const waiting = Promise.withResolvers();
  let foreground = true;
  const { c, site, actions } = await setup(t, {
    solve: async () => {
      foreground = false;
      return { status: "answered", selectedOptionIds: ["A"], reason: "明确" };
    },
  });
  site.read = async () => {
    if (!foreground) waiting.resolve();
    return { quiz: question(), foreground };
  };
  await c.start();
  const task = c.tick();
  await waiting.promise;
  c.pause();
  foreground = true;
  await task;
  assert.deepEqual(actions, []);
  assert.equal(c.phase, "paused");
});

for (const leaveAfter of ["select", "close"]) {
  test(`leaving after ${leaveAfter} waits before the next click`, async (t) => {
    let foreground = true;
    const waiting = Promise.withResolvers();
    const { c, site, actions } = await setup(t, {
      onAction: async (action) => {
        if (action === leaveAfter) foreground = false;
      },
    });
    const read = site.read;
    site.read = async () => {
      if (!foreground) waiting.resolve();
      return { ...(await read()), foreground };
    };
    await c.start();
    const task = c.tick();
    await waiting.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      actions,
      leaveAfter === "select" ? ["select"] : ["select", "close"],
    );
    foreground = true;
    await task;
    assert.deepEqual(actions, ["select", "close", "resume"]);
  });
}

test("changing a quiz during focus wait discards the retained answer", async (t) => {
  let foreground = true;
  const waiting = Promise.withResolvers();
  const { c, site, actions, setQuestion } = await setup(t, {
    solve: async () => {
      foreground = false;
      return { status: "answered", selectedOptionIds: ["A"], reason: "明确" };
    },
  });
  const read = site.read;
  site.read = async () => {
    if (!foreground) waiting.resolve();
    return { ...(await read()), foreground };
  };
  await c.start();
  const task = c.tick();
  await waiting.promise;
  await new Promise((resolve) => setImmediate(resolve));
  setQuestion({ ...question(), stem: "已更换的题目" });
  foreground = true;
  await task;
  assert.deepEqual(actions, []);
  assert.equal(c.phase, "paused");
  assert.match(c.error, /题目已经变化/);
});

const endedVideo = () => ({
  mediaKey: "fixture/one",
  label: "第一节",
  paused: true,
  ended: true,
  seeking: false,
  readyState: 4,
  currentTime: 60,
  duration: 60,
  error: false,
  next: { selector: "#next", disabled: false },
  playSelector: "#play",
});

test("ended video requires repeated confirmation then advances and starts only once", async (t) => {
  const { c, site, journal, actions } = await setup(t);
  const old = endedVideo(),
    next = {
      ...endedVideo(),
      mediaKey: "fixture/two",
      label: "第二节",
      ended: false,
      currentTime: 0,
    };
  let current = old;
  site.read = async () => ({ quiz: null, foreground: true, playback: current });
  site.nextVideo = async () => {
    assert.equal(journal.pending.stage, "video-next-intent");
    actions.push("next");
    current = next;
    return { quiz: null, playback: next };
  };
  site.playNextVideo = async () => {
    assert.equal(journal.pending.stage, "video-play-intent");
    actions.push("play");
    current = { ...next, paused: false };
  };
  await c.start();
  await c.tick();
  assert.deepEqual(actions, []);
  await c.tick();
  assert.deepEqual(actions, ["next", "play"]);
  await c.tick();
  assert.deepEqual(actions, ["next", "play"]);
  assert.equal(journal.history.at(-1).outcome, "video-next");
});

test("a next video already playing is never toggled", async (t) => {
  const { c, site, actions } = await setup(t);
  let current = endedVideo();
  site.read = async () => ({ quiz: null, foreground: true, playback: current });
  site.nextVideo = async () => {
    actions.push("next");
    current = {
      ...current,
      mediaKey: "two",
      ended: false,
      paused: false,
      currentTime: 1,
    };
    return { playback: current, quiz: null };
  };
  site.playNextVideo = async () => {
    throw new Error("must not toggle");
  };
  await c.start();
  await c.tick();
  await c.tick();
  assert.deepEqual(actions, ["next"]);
});

test("paused, buffering and background videos never cause a next click", async (t) => {
  const { c, site, actions } = await setup(t);
  let playback = { ...endedVideo(), ended: false, currentTime: 12 };
  site.read = async () => ({ quiz: null, foreground: false, playback });
  site.nextVideo = async () => actions.push("next");
  await c.start();
  for (const item of [
    playback,
    { ...playback, paused: false, readyState: 2 },
    endedVideo(),
  ]) {
    playback = item;
    await c.tick();
    await c.tick();
  }
  assert.deepEqual(actions, []);
  assert.match(c.attention, /切回/);
});

test("an uncertain next click is durable and cannot be automatically retried", async (t) => {
  const { c, site, journal, actions } = await setup(t);
  site.read = async () => ({
    quiz: null,
    foreground: true,
    playback: endedVideo(),
  });
  site.nextVideo = async () => {
    actions.push("next");
    throw new Error("uncertain next click");
  };
  await c.start();
  await c.tick();
  await c.tick();
  assert.equal(journal.pending?.stage, "video-next-intent");
  assert.equal(c.phase, "paused");
  await assert.rejects(c.start(), /未完成/);
  await assert.rejects(c.retry(), /点击|手动/);
  assert.deepEqual(actions, ["next"]);
});

test("sustained pause or buffering raises a playback reminder and never skips", async (t) => {
  const { c, site, actions } = await setup(t);
  let playback = { ...endedVideo(), ended: false, currentTime: 12 };
  site.read = async () => ({ quiz: null, foreground: true, playback });
  await c.start();
  for (const item of [
    playback,
    { ...playback, paused: false, readyState: 2 },
  ]) {
    playback = item;
    await c.tick();
    await c.tick();
    await c.tick();
    assert.equal(c.status().attentionKind, "playback");
    assert.match(c.attention, /暂停|缓冲/);
    assert.deepEqual(actions, []);
  }
});

test("a quiz takes priority over an ended video", async (t) => {
  const { c, site, actions } = await setup(t);
  const read = site.read;
  site.read = async () => ({
    ...(await read()),
    foreground: true,
    playback: endedVideo(),
  });
  site.nextVideo = async () => {
    throw new Error("quiz must take priority");
  };
  await c.start();
  await c.tick();
  assert.deepEqual(actions, ["select", "close", "resume"]);
});

test("pause during video switch prevents a subsequent play click", async (t) => {
  const { c, site, journal, actions } = await setup(t);
  site.read = async () => ({
    quiz: null,
    foreground: true,
    playback: endedVideo(),
  });
  site.nextVideo = async () => {
    actions.push("next");
    c.pause();
    return { playback: { ...endedVideo(), mediaKey: "two" } };
  };
  site.playNextVideo = async () => actions.push("play");
  await c.start();
  await c.tick();
  await c.tick();
  assert.deepEqual(actions, ["next"]);
  assert.equal(journal.pending.stage, "video-next-intent");
});

test("early multi grading saves observed choices before a later close failure", async (t) => {
  const { c, site, setQuestion, journal } = await setup(t, {
    solve: async () => ({
      status: "answered",
      selectedOptionIds: ["B", "C"],
      reason: "明确",
    }),
  });
  const q = {
    ...question(),
    type: "multi",
    options: [
      { id: "A", text: "2" },
      { id: "B", text: "3" },
      { id: "C", text: "4" },
    ],
  };
  setQuestion(q);
  site.feedback = async () => ({
    ...q,
    result: "incorrect",
    options: q.options.map((x) => ({ ...x, selected: x.id === "B" })),
  });
  site.close = async () => {
    throw new Error("close failed");
  };
  await c.start();
  await c.tick();
  assert.equal(journal.pending.stage, "close-intent");
  assert.deepEqual(journal.pending.selectedOptionIds, ["B"]);
  assert.match(journal.pending.lastFailure.message, /close failed/);
  await c.acknowledge();
  assert.deepEqual(journal.history.at(-1).selectedOptionIds, ["B"]);
});

test("hidden next controls are revealed before the next intent and click", async (t) => {
  const { c, site, journal, actions } = await setup(t);
  let p = { ...endedVideo(), next: null, surfaceSelector: "video" };
  site.read = async () => ({ quiz: null, foreground: true, playback: p });
  site.revealNextVideo = async () => {
    assert.equal(journal.pending.stage, "video-controls-intent");
    actions.push("reveal");
    p = { ...endedVideo(), surfaceSelector: "video" };
    return p;
  };
  site.nextVideo = async () => {
    assert.equal(journal.pending.stage, "video-next-intent");
    actions.push("next");
    p = { ...p, mediaKey: "two", ended: false, paused: false, currentTime: 0 };
    return { playback: p, quiz: null };
  };
  await c.start();
  await c.tick();
  await c.tick();
  assert.deepEqual(actions, ["reveal", "next"]);
});
