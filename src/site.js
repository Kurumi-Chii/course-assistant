import { extractPage, actionEvidence } from "./dom.js";
import { normalizeQuestion, identity } from "./question.js";
import { playbackState, playbackEvidence, videoKey } from "./playback.js";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class SiteAdapter {
  constructor(bridge) {
    this.bridge = bridge;
  }
  async read() {
    const state = await this.bridge.read(extractPage);
    if (state.problem) throw new Error(state.problem);
    if (state.quiz) {
      const q = normalizeQuestion(state.quiz);
      state.quiz = {
        ...state.quiz,
        ...q,
        options: q.options.map((x, i) => ({
          ...x,
          selector: state.quiz.options[i].selector,
        })),
      };
    }
    return state;
  }
  async current(q, guard) {
    guard();
    const state = await this.read();
    guard();
    if (state.blocked) throw new Error("检测到异常脚本或安全验证，已停止操作");
    if (!state.quiz || identity(q) !== identity(state.quiz))
      throw new Error("题目已经变化，请重新确认");
    return state.quiz;
  }
  async select(q, ids, guard, waitForForeground) {
    let current = await this.current(q, guard);
    if (current.result) throw new Error("题目已由其他操作处理，请手动确认");
    if (current.options.some((x) => x.selected && !ids.includes(x.id)))
      throw new Error("已有不匹配的已选答案，请手动处理");
    let clickedAny = false;
    for (const id of ids) {
      while (true) {
        current = await this.current(q, guard);
        if (current.result) {
          if (clickedAny) return;
          throw new Error("题目已由其他操作处理，请手动确认");
        }
        if (current.options.some((x) => x.selected && !ids.includes(x.id)))
          throw new Error("已有不匹配的已选答案，请手动处理");
        const option = current.options.find((x) => x.id === id);
        if (!option) throw new Error("选项已改变");
        if (option.selected) break;
        guard();
        try {
          await this.bridge.click(option.selector, actionEvidence(current));
        } catch (error) {
          guard();
          if (
            error.code !== "COURSE_BACKGROUND_BEFORE_CLICK" ||
            !waitForForeground
          )
            throw error;
          await waitForForeground();
          guard();
          continue;
        }
        guard();
        clickedAny = true;
        if (q.type === "multi") {
          const deadline = performance.now() + 3000;
          while (true) {
            const confirmed = await this.current(q, guard);
            if (
              confirmed.result ||
              confirmed.options.find((x) => x.id === id)?.selected
            )
              break;
            if (performance.now() >= deadline)
              throw new Error(
                "点击后未确认选项 " + id + " 已勾选，请手动检查；不会重复点击",
              );
            await delay(100);
          }
        }
        break;
      }
    }
    current = await this.current(q, guard);
    while (!current.result && current.submit) {
      if (
        q.type === "multi" &&
        (current.options.filter((x) => x.selected).length !== ids.length ||
          current.options.some((x) => x.selected !== ids.includes(x.id)))
      )
        throw new Error("提交前选项选择已经变化，请手动检查");
      try {
        guard();
        await this.bridge.click(current.submit, actionEvidence(current));
        guard();
        break;
      } catch (error) {
        guard();
        if (
          error.code !== "COURSE_BACKGROUND_BEFORE_CLICK" ||
          !waitForForeground
        )
          throw error;
        await waitForForeground();
        guard();
        current = await this.current(q, guard);
      }
    }
  }
  async feedback(q, guard) {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const current = await this.current(q, guard);
      if (current.result) return current;
      await delay(150);
    }
    throw new Error("未收到明确答题反馈，请手动确认");
  }
  async close(q, guard) {
    const current = await this.current(q, guard);
    if (!["correct", "incorrect"].includes(current.result) || !current.close)
      throw new Error("没有明确答题结果或可用的关闭按钮");
    guard();
    await this.bridge.click(current.close, actionEvidence(current));
    guard();
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const s = await this.read();
      guard();
      if (s.blocked) throw new Error("检测到异常脚本，已暂停");
      if (!s.quiz) return;
      if (identity(s.quiz) !== identity(q))
        throw new Error("关闭后出现新题，已暂停");
      await delay(150);
    }
    throw new Error("答题弹窗未关闭，请手动处理");
  }
  async resumeOnce(guard) {
    guard();
    const state = await this.read();
    guard();
    if (state.blocked) throw new Error("检测到异常脚本，已暂停");
    if (state.quiz) throw new Error("仍有题目，不能点击播放器");
    if (!state.player) throw new Error("无法确认播放器位置");
    await this.bridge.click(state.player, "");
    guard();
  }
  async revealNextVideo(before, guard) {
    if (playbackState(before) !== "ended" || !before.surfaceSelector)
      throw new Error("无法确认已结束的视频区域，未唤出控件");
    const read = async (afterClick = false) => {
      guard();
      const s = await this.read();
      guard();
      const p = s.playback;
      if (
        s.blocked ||
        s.quiz ||
        !p ||
        videoKey(p) !== videoKey(before) ||
        p.duration !== before.duration ||
        p.error ||
        p.seeking ||
        (!afterClick && playbackState(p) !== "ended") ||
        (afterClick && !p.ended && p.currentTime > 3)
      )
        throw new Error("唤出控件时视频或页面已变化，已停止");
      return s;
    };
    let state = await read();
    if (state.playback.next)
      return { playback: state.playback, completion: null };
    guard();
    await this.bridge.hover(
      state.playback.surfaceSelector,
      "",
      playbackEvidence(state.playback),
    );
    guard();
    let deadline = performance.now() + 600;
    while (performance.now() < deadline) {
      state = await read();
      if (state.playback.next)
        return { playback: state.playback, completion: null };
      await delay(100);
    }
    guard();
    await this.bridge.click(
      state.playback.surfaceSelector,
      "",
      playbackEvidence(state.playback),
    );
    guard();
    deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      state = await read(true);
      if (state.playback.next)
        return {
          playback: state.playback,
          completion: {
            key: videoKey(before),
            duration: before.duration,
            revealClicked: true,
          },
        };
      await delay(100);
    }
    throw new Error("唤出控制栏后仍未找到唯一下一节按钮；未重复点击视频");
  }
  async nextVideo(before, guard, completion = null) {
    guard();
    const state = await this.read();
    guard();
    const p = state.playback;
    const confirmedCompleted =
      completion?.revealClicked === true &&
      completion.key === videoKey(before) &&
      completion.duration === before.duration;
    if (
      state.blocked ||
      state.quiz ||
      !p ||
      videoKey(p) !== videoKey(before) ||
      (playbackState(p) !== "ended" &&
        !(
          confirmedCompleted &&
          p.duration === completion.duration &&
          !p.error &&
          !p.seeking &&
          p.currentTime <= 3
        )) ||
      !p.next ||
      p.next.disabled ||
      p.next.selector !== before.next?.selector
    )
      throw new Error("视频状态或下一节入口已经变化，已暂停");
    if (p.next.href) {
      const target = new URL(p.next.href, state.url);
      const current = new URL(state.url);
      if (
        !["javascript:", "https:", "http:"].includes(target.protocol) ||
        (target.protocol !== "javascript:" &&
          (target.origin !== current.origin ||
            target.pathname !== current.pathname ||
            target.search !== current.search))
      )
        throw new Error("下一节链接离开当前课程，请手动切换");
    }
    const mode = confirmedCompleted ? "completed-next" : "exact";
    await this.bridge.click(
      p.next.selector,
      "",
      playbackEvidence(p, mode),
      mode,
    );
    guard();
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const next = await this.read();
      guard();
      if (next.blocked) throw new Error("切换后出现安全提示，已暂停");
      if (
        next.playback?.mediaKey &&
        videoKey(next.playback) !== videoKey(p) &&
        next.playback.readyState >= 2 &&
        !next.playback.error
      )
        return next;
      await delay(150);
    }
    throw new Error("未确认下一视频已载入，未重复点击；请手动检查");
  }
  async playNextVideo(before, guard) {
    const deadline = performance.now() + 10000;
    let clicked = false;
    while (performance.now() < deadline) {
      guard();
      const state = await this.read();
      guard();
      const p = state.playback;
      if (state.blocked || !p || videoKey(p) !== videoKey(before) || p.error)
        throw new Error("新视频状态发生变化，请手动检查");
      if (
        state.quiz ||
        playbackState(p) === "playing" ||
        playbackState(p) === "ended"
      )
        return;
      if (
        !clicked &&
        p.paused &&
        !p.seeking &&
        p.readyState >= 2 &&
        p.playSelector
      ) {
        await this.bridge.click(p.playSelector, "", playbackEvidence(p));
        clicked = true;
        guard();
      }
      await delay(150);
    }
    throw new Error("未确认新视频开始播放，未重复点击；请手动检查");
  }
}
