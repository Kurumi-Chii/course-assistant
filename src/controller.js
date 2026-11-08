import {
  identity,
  randomAnswer,
  UncertainAnswerError,
  validateAnswer,
} from "./question.js";
import { playbackState, videoKey } from "./playback.js";
export class Controller {
  constructor({
    bridge,
    site,
    provider,
    journal,
    pollMs = 3000,
    randomOnUncertain = false,
  }) {
    this.bridge = bridge;
    this.site = site;
    this.provider = provider;
    this.journal = journal;
    this.pollMs = pollMs;
    this.randomOnUncertain = randomOnUncertain;
    this.phase = "stopped";
    this.error = "";
    this.attention = "";
    this.attentionKind = "";
    this.playback = null;
    this.playbackObservation = null;
    this.message = "先连接 Edge，再开始";
    this.connected = false;
    this.generation = 0;
    this.busy = false;
    this.seen = new Set(journal.history.map((x) => x.key));
    if (journal.pending?.key) this.seen.add(journal.pending.key);
    this.connecting = false;
    this.ac = null;
    this.course = null;
    this.current = null;
  }
  status() {
    return {
      phase: this.phase,
      error: this.error,
      attention: this.attention,
      attentionKind: this.attentionKind,
      playback: this.playback,
      message: this.message,
      connected: this.connected,
      busy: this.busy || this.connecting,
      course: this.course,
      current: this.current,
      history: [...this.journal.history].reverse(),
      pending: this.journal.pending,
      provider: this.provider.name ?? "Codex",
    };
  }
  async connect() {
    if (this.busy || this.connecting) throw new Error("已有操作进行中");
    this.pause();
    this.connecting = true;
    this.connected = false;
    this.phase = "connecting";
    this.error = "";
    const token = ++this.generation;
    this.ac = new AbortController();
    const signal = this.ac.signal;
    try {
      await this.bridge.disconnect();
      if (token !== this.generation || signal.aborted)
        throw new Error("连接已取消");
      const course = await this.bridge.connect(signal);
      if (token !== this.generation) throw new Error("连接已取消");
      this.course = course;
      this.connected = true;
      this.phase = "ready";
      this.message = "已连接，点击开始后等待题目";
    } catch (e) {
      if (token === this.generation) {
        this.phase = "paused";
        this.error = e.message;
        this.message = "连接未完成";
      }
      throw e;
    } finally {
      this.connecting = false;
    }
  }
  async start() {
    if (!this.connected) throw new Error("请先连接 Edge");
    if (this.busy) throw new Error("上一项操作仍在结束，请稍候");
    if (this.journal.pending) throw new Error("上次处理未完成，请先手动确认");
    if (this.phase === "running") return;
    this.#run();
  }
  #run(retryKey = null) {
    this.retryKey = retryKey;
    this.error = "";
    this.phase = "running";
    this.message = "等待课程题目";
    this.generation++;
    this.ac = new AbortController();
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref?.();
  }
  pause() {
    this.attention = "";
    this.attentionKind = "";
    this.playbackObservation = null;
    this.retryKey = null;
    this.generation++;
    this.ac?.abort();
    clearInterval(this.timer);
    this.timer = null;
    this.phase = "paused";
    this.message = "已暂停，后续动作已取消";
  }
  async stop() {
    this.pause();
    this.connected = false;
    this.phase = "stopped";
    this.message = "已停止";
    await this.bridge.disconnect();
  }
  async acknowledge() {
    if (this.busy) throw new Error("请等待当前操作结束");
    if (this.journal.pending?.key) this.seen.add(this.journal.pending.key);
    await this.journal.finish({
      outcome: "manual",
      reason: "用户已手动检查，未重放未完成动作",
    });
    this.error = "";
    this.message = "已确认，可重新开始";
  }
  async retry() {
    if (this.busy || this.connecting)
      throw new Error("上一项操作仍在结束，请稍候");
    if (!this.connected) throw new Error("请先连接 Edge");
    const pending = this.journal.pending;
    if (!pending || pending.stage !== "solving")
      throw new Error("已经进入点击步骤或没有待重试题目，请手动确认");
    if (this.journal.history.some((x) => x.key === pending.key))
      throw new Error("这道题已有处理记录，请手动确认");
    this.pause();
    const token = this.generation;
    const valid = () => {
      if (token !== this.generation) throw new Error("重试已取消");
    };
    this.busy = true;
    try {
      const state = await this.site.read();
      valid();
      if (
        state.blocked ||
        !state.quiz ||
        state.quiz.result ||
        identity(state.quiz) !== pending.key
      )
        throw new Error("题目已变化、已显示结果或出现安全提示，请手动确认");
      await this.journal.step("solving", {
        retryRequestedAt: new Date().toISOString(),
        retryCount: (pending.retryCount ?? 0) + 1,
      });
      valid();
      this.seen.delete(pending.key);
      this.error = "";
    } finally {
      this.busy = false;
    }
    this.#run(pending.key);
  }
  guard(token) {
    if (
      token !== this.generation ||
      this.phase !== "running" ||
      this.ac?.signal.aborted
    )
      throw new Error("操作已取消");
  }
  requestFocus() {
    this.attentionKind = "focus";
    this.attention = "课程页在后台，请手动切回课程标签页；切回后自动继续。";
    this.message = "等待你切回课程页";
  }
  async waitForForeground(guard) {
    while (true) {
      guard();
      const state = await this.site.read();
      guard();
      if (state.blocked) throw new Error("检测到异常脚本或安全验证，已暂停");
      if (state.foreground !== false) {
        this.attention = "";
        return state;
      }
      this.requestFocus();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async monitorPlayback(state, guard) {
    const p = state.playback;
    const kind = playbackState(p);
    this.playback = {
      state: kind,
      label: p?.label ?? "当前视频",
      currentTime: p?.currentTime ?? 0,
      duration: p?.duration ?? null,
    };
    this.attention = "";
    this.attentionKind = "";
    if (kind === "unavailable") {
      this.playbackObservation = null;
      this.message = "等待可读取的视频或课程题目";
      return;
    }
    const key = videoKey(p);
    const old = this.playbackObservation;
    this.playbackObservation = {
      key,
      kind,
      count: old?.key === key && old.kind === kind ? old.count + 1 : 1,
    };
    if (kind === "playing") {
      this.message = "视频正在播放，不操作播放器";
      return;
    }
    if (kind !== "ended") {
      this.message = {
        paused: "视频已暂停",
        buffering: "视频正在缓冲或载入",
        error: "视频播放出错",
      }[kind];
      if (kind === "error" || this.playbackObservation.count >= 3) {
        this.attentionKind = "playback";
        this.attention = this.message + "，请手动查看课程页；不会跳到下一节。";
      }
      return;
    }
    this.message = "视频播放结束，正在确认";
    if (this.playbackObservation.count < 2) return;
    if (state.foreground === false) {
      this.requestFocus();
      return;
    }
    if (p.next?.disabled) {
      this.pause();
      this.attentionKind = "playback";
      this.attention = p.next
        ? "下一视频按钮不可用，可能已到最后一节；请手动确认。"
        : "未找到唯一的下一节按钮，请手动切换视频。";
      this.message = "本节已结束，自动切换已停止";
      return;
    }
    if (this.seen.has(key))
      throw new Error("本视频已有切换记录，请手动确认，不重复点击下一节");
    await this.journal.begin({
      key,
      stem: "切换视频：" + p.label,
      kind: "video",
      stage: p.next ? "video-next-intent" : "video-controls-intent",
    });
    guard();
    this.seen.add(key);
    let ready = p;
    if (!p.next) {
      this.message = "正在唤出播放器控制栏";
      ready = await this.site.revealNextVideo(p, guard);
      guard();
      if (!ready.next || ready.next.disabled)
        throw new Error(
          "控制栏已显示，但下一视频按钮不可用，请手动确认是否已到最后一节",
        );
      await this.journal.step("video-next-intent", { controlsRevealed: true });
      guard();
    }
    this.message = "正在切换下一视频";
    const next = await this.site.nextVideo(ready, guard);
    guard();
    const fresh = await this.waitForForeground(guard);
    guard();
    if (
      !fresh.playback?.mediaKey ||
      videoKey(fresh.playback) !== videoKey(next.playback)
    )
      throw new Error("新视频已经变化，请手动确认");
    if (
      !fresh.quiz &&
      !["playing", "ended"].includes(playbackState(fresh.playback))
    ) {
      await this.journal.step("video-play-intent", {
        toLesson: fresh.playback.label,
      });
      guard();
      this.message = "正在启动下一视频";
      await this.site.playNextVideo(fresh.playback, guard);
      guard();
    }
    await this.journal.finish({
      outcome: "video-next",
      reason: fresh.quiz
        ? "已切换新视频，等待处理随堂题"
        : "已切换下一视频；已播放时不重复点击",
    });
    guard();
    this.playbackObservation = null;
    this.message = "已切换下一视频，继续监测";
  }
  async tick() {
    if (this.phase !== "running" || this.busy) return;
    this.busy = true;
    const token = this.generation;
    const guard = () => this.guard(token);
    try {
      let state = await this.site.read();
      guard();
      if (state.blocked) throw new Error("检测到异常脚本或安全验证，已暂停");
      const q = state.quiz;
      if (!q) {
        if (this.retryKey) throw new Error("待重试题目已消失，请手动确认");
        await this.monitorPlayback(state, guard);
        return;
      }
      this.playbackObservation = null;
      if (state.foreground === false) {
        this.requestFocus();
        return;
      }
      this.attention = "";
      const key = identity(q);
      const previous = this.journal.history.findLast(
        (entry) => entry.key === key,
      );
      const recoverWrong =
        q.result === "incorrect" &&
        previous?.outcome === "incorrect" &&
        previous.stage === "select-intent";
      if (!recoverWrong && (this.seen.has(key) || q.result))
        throw new Error("这道题已经处理或已显示答案，请手动确认");
      this.seen.add(key);
      this.current = {
        stem: q.stem,
        type: q.type,
        options: q.options.map(({ id, text }) => ({ id, text })),
      };
      const started = performance.now();
      let modelMs = 0,
        browserStarted = started;
      this.message = recoverWrong
        ? "继续处理上次已判错的题目"
        : (this.provider.name ?? "Codex") + " 正在判断答案";
      if (
        this.retryKey === key &&
        this.journal.pending?.key === key &&
        this.journal.pending.stage === "solving"
      ) {
        this.retryKey = null;
      } else {
        await this.journal.begin({
          key,
          stem: q.stem,
          provider: recoverWrong
            ? (previous.provider ?? "Codex")
            : (this.provider.name ?? "Codex"),
        });
      }
      guard();
      let answer, result;
      if (recoverWrong) {
        answer = validateAnswer(q, {
          status: "answered",
          selectedOptionIds: previous.selectedOptionIds,
          reason: previous.reason ?? "继续处理旧版已判错的结果",
        });
        result = q;
      } else {
        const modelStarted = performance.now();
        if (this.journal.pending.provider !== (this.provider.name ?? "Codex")) {
          await this.journal.step("solving", {
            provider: this.provider.name ?? "Codex",
          });
          guard();
        }
        try {
          answer = validateAnswer(
            q,
            await this.provider.solve(q, this.ac.signal, (message) => {
              if (token === this.generation) this.message = message;
            }),
          );
        } catch (error) {
          if (
            !this.randomOnUncertain ||
            !(error instanceof UncertainAnswerError)
          )
            throw error;
          guard();
          answer = randomAnswer(q);
        }
        modelMs = Math.round(performance.now() - modelStarted);
        guard();
        state = await this.waitForForeground(guard);
        guard();
        if (state.blocked || !state.quiz || identity(state.quiz) !== key)
          throw new Error("题目已经变化，已丢弃迟到的答案");
        this.message = "正在选择答案";
        browserStarted = performance.now();
        await this.journal.step("select-intent", {
          selectedOptionIds: answer.selectedOptionIds,
        });
        guard();
        await this.site.select(q, answer.selectedOptionIds, guard, () =>
          this.waitForForeground(guard),
        );
        guard();
        result = await this.site.feedback(q, guard);
        guard();
        if (q.type === "multi" && Array.isArray(result.options)) {
          const selected = result.options
            .filter((x) => x.selected)
            .map((x) => x.id);
          if (selected.length)
            answer = { ...answer, selectedOptionIds: selected };
        }
      }
      if (!["correct", "incorrect"].includes(result.result))
        throw new Error("未收到明确答题反馈，请手动确认");
      await this.waitForForeground(guard);
      guard();
      this.message =
        result.result === "correct"
          ? "答案正确，正在关闭弹窗"
          : "答案错误，正在关闭弹窗";
      await this.journal.step("close-intent", {
        outcome: result.result,
        selectedOptionIds: answer.selectedOptionIds,
      });
      guard();
      await this.site.close(q, guard);
      guard();
      await this.waitForForeground(guard);
      guard();
      this.message = "正在点击播放器";
      await this.journal.step("resume-intent");
      guard();
      await this.site.resumeOnce(guard);
      guard();
      await this.journal.finish({
        outcome: result.result,
        ...answer,
        timings: {
          modelMs,
          browserMs: Math.round(performance.now() - browserStarted),
          totalMs: Math.round(performance.now() - started),
        },
      });
      this.seen.add(key);
      this.current = null;
      this.message = "本题完成，等待下一题";
    } catch (e) {
      if (token === this.generation) {
        this.pause();
        this.error = e.message;
        this.message = "需要你处理";
        if (this.journal.pending) {
          try {
            await this.journal.step(this.journal.pending.stage, {
              lastFailure: {
                message: String(e.message).slice(0, 2000),
                code: [
                  "COURSE_BACKGROUND_BEFORE_CLICK",
                  "COURSE_QUIZ_CHANGED_BEFORE_CLICK",
                ].includes(e.code)
                  ? e.code
                  : "OPERATION_FAILED",
                at: new Date().toISOString(),
              },
            });
          } catch {
            this.error += "；错误记录未能保存";
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
