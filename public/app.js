const $ = (id) => document.getElementById(id);
let token = "",
  localError = "",
  lastAlert = "",
  lastBeepAt = 0,
  desktopNotice,
  noticeTimer,
  focusAttention = false,
  busyAction = "",
  audio;
let agentName = "Codex";
const labels = {
  stopped: "尚未连接",
  connecting: "等待 Edge 连接确认",
  ready: "已连接，准备就绪",
  running: "正在自动处理",
  paused: "已暂停",
};
function beep() {
  if (!$("sound").checked || !audio) return;
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.connect(g);
  g.connect(audio.destination);
  o.frequency.value = 780;
  g.gain.value = 0.15;
  o.start();
  o.stop(audio.currentTime + 0.35);
}
$("sound").addEventListener("change", () => {
  if ($("sound").checked) {
    audio ??= new AudioContext();
    void audio.resume();
    beep();
  }
});
function notify(message) {
  desktopNotice?.close();
  clearTimeout(noticeTimer);
  desktopNotice = null;
  if (
    !message ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  )
    return;
  try {
    desktopNotice = new Notification("课程助手：需要你处理", {
      body: message,
      tag: "course-assistant-attention",
      requireInteraction: false,
      silent: true,
    });
    const notice = desktopNotice;
    noticeTimer = setTimeout(() => notice.close(), 10000);
  } catch {
    /* Title and optional sound remain available. */
  }
}
$("notifications").addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  try {
    const permission = await Notification.requestPermission();
    $("notifications").textContent =
      permission === "granted" ? "桌面提醒已启用" : "桌面提醒未获允许";
    if (permission === "granted") notify(lastAlert);
  } catch {
    $("notifications").textContent = "无法启用桌面提醒";
  }
});
if (!("Notification" in window)) {
  $("notifications").disabled = true;
  $("notifications").textContent = "浏览器不支持桌面提醒";
} else if (Notification.permission === "granted") {
  $("notifications").textContent = "桌面提醒已启用";
}
setInterval(() => {
  document.title =
    lastAlert && Math.floor(Date.now() / 1000) % 2
      ? focusAttention
        ? "【请切回课程页】课程助手"
        : "【需要你处理】课程助手"
      : "课程助手 · " + agentName;
  if (lastAlert && Date.now() - lastBeepAt >= 8000) {
    beep();
    lastBeepAt = Date.now();
  }
}, 1000);
function render(s) {
  const error = localError || s.error || s.attention || "";
  agentName = s.provider || "Codex";
  $("agent-label").textContent = "Agent · " + agentName;
  const agents = s.agents ?? [{ id: "codex", name: "Codex" }];
  if (
    JSON.stringify(
      [...$("agent-select").options].map((x) => [x.value, x.text]),
    ) !== JSON.stringify(agents.map((x) => [x.id, x.name]))
  )
    $("agent-select").replaceChildren(
      ...agents.map((x) => new Option(x.name, x.id)),
    );
  $("agent-select").value = s.selectedAgent ?? "codex";
  const settingsDisabled = Boolean(
    busyAction ||
      s.busy ||
      s.agentChanging ||
      s.settingsChanging ||
      ["running", "connecting"].includes(s.phase),
  );
  $("agent-select").disabled = settingsDisabled || Boolean(s.modelChecking);
  $("random-fallback").checked = s.randomOnUncertain === true;
  $("random-fallback").disabled =
    settingsDisabled || typeof s.randomOnUncertain !== "boolean";
  focusAttention = Boolean(s.attention && s.attentionKind !== "playback");
  const unfinished =
    s.pending && s.phase !== "running" && s.phase !== "connecting";
  const unfinishedVideo = unfinished && s.pending.kind === "video";
  $("phase").textContent = s.attention
    ? s.attentionKind === "playback"
      ? "视频需要你处理"
      : "等待你切回课程页"
    : unfinished
      ? unfinishedVideo
        ? "有未完成的视频切换"
        : "有未完成题目"
      : (labels[s.phase] ?? "状态待确认");
  $("message").textContent = unfinished
    ? unfinishedVideo
      ? ({
          "video-controls-intent":
            "上次在唤出播放器控制栏时中断，请检查课程页后确认记录。",
          "video-next-intent":
            "上次在切换下一节时中断，请检查课程页后确认记录。",
          "video-play-intent":
            "上次在启动新视频时中断，请检查课程页后确认记录。",
        }[s.pending.stage] ?? "请检查课程页后确认视频切换记录。")
      : s.pending.stage === "solving"
        ? "尚未选择答案。连接原课程页后，可重试本题；已手动处理请确认记录。"
        : "上次已进入点击步骤，请手动检查课程页后确认记录。"
    : (s.message ?? "");
  $("error").textContent = error;
  $("alert").hidden = !error;
  $("dot").className =
    "status-dot" + (error ? " error" : s.phase === "running" ? " running" : "");
  $("course").textContent = s.course?.title ?? "尚未连接";
  const media = s.playback;
  const clock = (value) =>
    Number.isFinite(value) && value >= 0
      ? Math.floor(value / 60) +
        ":" +
        String(Math.floor(value % 60)).padStart(2, "0")
      : "--:--";
  $("playback-message").textContent =
    "视频状态：" +
    ({
      playing: "播放中",
      ended: "播放结束",
      paused: "已暂停",
      buffering: "缓冲或载入中",
      error: "播放出错",
      unavailable: "暂未识别播放器",
    }[media?.state] ?? "等待检测") +
    (media && media.state !== "unavailable"
      ? " · " + clock(media.currentTime) + " / " + clock(media.duration)
      : "");
  $("model-message").textContent = s.modelMessage ?? "尚未检查";
  $("pending-note").hidden = s.phase !== "connecting";
  $("connect").disabled = Boolean(
    busyAction || s.busy || s.phase === "connecting" || s.phase === "running",
  );
  $("start").disabled = Boolean(
    busyAction || !s.connected || s.busy || s.pending || s.phase === "running",
  );
  $("pause").disabled = !["running", "connecting"].includes(s.phase);
  $("stop").disabled = s.phase === "stopped" && !busyAction;
  $("check").disabled = Boolean(
    busyAction || s.busy || s.modelChecking || s.phase === "running",
  );
  $("acknowledge").hidden = !s.pending;
  $("acknowledge").disabled = s.busy || Boolean(busyAction);
  $("retry").hidden = !unfinished || s.pending.stage !== "solving";
  $("retry").disabled = Boolean(
    !s.connected || s.busy || busyAction || s.modelChecking,
  );
  $("question").textContent = s.current?.stem ?? "开始后，新题目会显示在这里。";
  $("kind").textContent =
    { single: "单选题", multi: "多选题", judgement: "判断题" }[
      s.current?.type
    ] ?? "等待发现";
  $("options").replaceChildren(
    ...(s.current?.options ?? []).map((x) => {
      const li = document.createElement("li");
      li.textContent = x.id + ". " + x.text;
      return li;
    }),
  );
  const history = s.history ?? [];
  $("count").textContent = history.length + " 条";
  $("empty").hidden = history.length > 0;
  $("records").replaceChildren(
    ...history.map((x) => {
      const article = document.createElement("article");
      article.className = "record";
      const time = document.createElement("time");
      time.textContent = new Date(x.finishedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const body = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = x.stem;
      const result = document.createElement("span");
      result.className = "result" + (x.outcome === "correct" ? "" : " bad");
      result.textContent =
        {
          correct: "回答正确",
          incorrect:
            x.stage === "resume-intent"
              ? "回答错误，已继续"
              : "回答错误（旧记录）",
          uncertain: "动作结果待确认",
          manual: "已手动确认",
          "video-next": "已切换下一视频",
        }[x.outcome] ?? "处理中";
      const info = document.createElement("p");
      info.textContent =
        (x.selectedOptionIds?.length
          ? "选择 " + x.selectedOptionIds.join("、") + " · "
          : "") + (x.reason ?? "");
      if (x.lastFailure?.message)
        info.textContent += " · 此前失败：" + x.lastFailure.message;
      if (x.provider !== "page")
        info.textContent += " · Agent：" + (x.provider ?? "Codex");
      if (x.timings)
        info.textContent +=
          " · 判断 " +
          (x.timings.modelMs / 1000).toFixed(1) +
          "秒 / 操作 " +
          (x.timings.browserMs / 1000).toFixed(1) +
          "秒";
      body.append(title, result, info);
      article.append(time, body);
      return article;
    }),
  );
  if (error !== lastAlert) {
    lastAlert = error;
    if (error) {
      beep();
      lastBeepAt = Date.now();
    }
    notify(error);
  }
}
async function refresh() {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) throw new Error("控制面板连接已失效，请刷新");
    render(await r.json());
  } catch (e) {
    $("error").textContent = e.message;
    $("alert").hidden = false;
    $("phase").textContent = "本机程序未连接";
  }
}
async function action(name, extra = {}) {
  if (busyAction && !["pause", "stop"].includes(name)) return;
  localError = "";
  if (!["pause", "stop"].includes(name)) busyAction = name;
  await refresh();
  try {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-Token": token },
      body: JSON.stringify({ action: name, ...extra }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "操作未完成");
  } catch (e) {
    localError = e.message;
  } finally {
    busyAction = "";
    await refresh();
  }
}
$("agent-select").addEventListener(
  "change",
  () => void action("select-provider", { provider: $("agent-select").value }),
);
$("random-fallback").addEventListener(
  "change",
  (event) =>
    void action("set-random-fallback", {
      enabled: event.currentTarget.checked,
    }),
);
for (const name of [
  "connect",
  "start",
  "pause",
  "stop",
  "check",
  "acknowledge",
  "retry",
])
  $(name).addEventListener("click", () => void action(name));
try {
  const r = await fetch("/api/bootstrap");
  if (!r.ok) throw new Error("无法连接本机程序");
  token = (await r.json()).token;
  await refresh();
  setInterval(() => void refresh(), 1500);
} catch (e) {
  localError = e.message;
  $("error").textContent = e.message;
  $("alert").hidden = false;
}
