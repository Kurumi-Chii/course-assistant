// This function is serialized and executed as a read-only page query.
export function extractPage() {
  const text = (x) =>
    String(x ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const visible = (el) => {
    if (!el?.isConnected) return false;
    for (let x = el; x && x.nodeType === 1; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (
        x.hidden ||
        x.getAttribute("aria-hidden") === "true" ||
        s.display === "none" ||
        s.visibility === "hidden" ||
        s.opacity === "0"
      )
        return false;
    }
    return el.getClientRects().length > 0;
  };
  const css = (el) => {
    const parts = [];
    while (el && el !== document.documentElement) {
      const parent = el.parentElement;
      if (!parent) break;
      parts.unshift(
        el.tagName.toLowerCase() +
          ":nth-child(" +
          ([...parent.children].indexOf(el) + 1) +
          ")",
      );
      el = parent;
    }
    return "html > " + parts.join(" > ");
  };
  const panels = [
    ...document.querySelectorAll(
      '[role="dialog"],.el-dialog,.el-message-box,dialog,.layui-layer',
    ),
  ].filter(visible);
  const blocked = panels.some((el) =>
    /异常脚本|安全验证|访问异常|验证码/.test(el.innerText),
  );
  const info = {
    url: location.href,
    title: document.title,
    documentKey: String(performance.timeOrigin),
    foreground: document.visibilityState === "visible" && document.hasFocus(),
    blocked,
    quiz: null,
    player: null,
  };
  const player = [
    ...document.querySelectorAll('[role="region"][aria-label="video player"]'),
  ].filter(visible);
  if (player.length === 1) info.player = css(player[0]);
  const videos = [...document.querySelectorAll("video")].filter(visible);
  info.playback = null;
  if (videos.length === 1) {
    const video = videos[0];
    const videoPlayer =
      player.length === 1 && player[0].contains(video) ? player[0] : null;
    let surface = video;
    if (videoPlayer) {
      const bounds = video.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      if (
        hit?.matches("div.videoArea") &&
        hit.parentElement === video.parentElement
      ) {
        const cover = hit.getBoundingClientRect();
        if (
          ["x", "y", "width", "height"].every(
            (key) => Math.abs(cover[key] - bounds[key]) <= 3,
          )
        )
          surface = hit;
      }
    }
    const nextLabel =
      /^(?:下一(?:节|集|讲|课|视频|课时)|下一个视频|next(?: video| lesson)?)[\s»›>]*$/i;
    const nextNodes = [
      ...new Set(
        [
          ...document.querySelectorAll(
            'button,a,[role="button"],[title],[aria-label]',
          ),
        ]
          .filter(visible)
          .filter((el) =>
            [
              text(el.innerText),
              text(el.getAttribute("title")),
              text(el.getAttribute("aria-label")),
            ].some((x) => nextLabel.test(x)),
          )
          .map((el) => el.closest('button,a,[role="button"]') || el),
      ),
    ];
    for (const button of videoPlayer?.querySelectorAll(
      ".controlsBar > div#nextBtn.nextButton",
    ) ?? []) {
      if (visible(button) && !nextNodes.includes(button))
        nextNodes.push(button);
    }
    const next = nextNodes.length === 1 ? nextNodes[0] : null;
    const playNodes =
      player.length === 1
        ? [...player[0].querySelectorAll('button,[role="button"]')]
            .filter(visible)
            .filter((el) =>
              /^(?:播放|开始播放|play)$/i.test(
                text(
                  el.getAttribute("aria-label") ||
                    el.getAttribute("title") ||
                    el.innerText,
                ),
              ),
            )
        : [];
    let mediaKey = "";
    if (video.currentSrc) {
      const source = new URL(video.currentSrc, location.href);
      mediaKey = source.origin + source.pathname;
    }
    info.playback = {
      mediaKey,
      label: text(
        document.querySelector(".video-title,.videoTitle,.lesson-title")
          ?.textContent || "当前视频",
      ).slice(0, 300),
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      readyState: video.readyState,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      error: Boolean(video.error),
      surfaceSelector: css(surface),
      next: next
        ? {
            selector: css(next),
            disabled: Boolean(
              next.disabled ||
                next.getAttribute("aria-disabled") === "true" ||
                next.matches(".disabled,.is-disabled"),
            ),
            href: next.getAttribute("href") || "",
          }
        : null,
      playSelector:
        playNodes.length === 1 ? css(playNodes[0]) : info.player || css(video),
    };
  }
  const candidates = panels.filter((el) =>
    /【\s*(?:单选题|多选题|判断题|填空题|问答题)\s*】/.test(el.innerText),
  );
  const quizzes = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.contains(el)),
  );
  if (quizzes.length > 1) {
    info.problem = "发现多个答题窗口，请手动处理";
    return info;
  }
  if (!quizzes.length) return info;
  const panel = quizzes[0];
  const titles = [
    ...panel.querySelectorAll('h1,h2,h3,h4,[role="heading"],.el-dialog__title'),
  ]
    .filter(visible)
    .map((el) => text(el.innerText));
  if (
    !titles.some(
      (value) => value === "弹题测验" || /^AI助教小智给你出题/.test(value),
    )
  ) {
    info.problem = "无法确认这是已支持的随堂练习弹窗，请手动处理";
    return info;
  }
  const all = text(panel.innerText);
  const marker = /【\s*(单选题|多选题|判断题|填空题|问答题)\s*】/;
  const stems = [
    ...panel.querySelectorAll('p,[class*="stem"],[class*="subject"]'),
  ]
    .filter(visible)
    .filter((el) => marker.test(el.innerText));
  const stemNode = stems.find(
    (el) => !stems.some((other) => other !== el && el.contains(other)),
  );
  if (!stemNode) {
    info.problem = "无法确认题干区域，请手动处理";
    return info;
  }
  const m = text(stemNode.innerText).match(marker);
  const stem = text(stemNode.innerText)
    .slice(m.index + m[0].length)
    .trim();
  const options = [
    ...panel.querySelectorAll('li,label,[role="radio"],[role="checkbox"]'),
  ]
    .filter(visible)
    .filter((el) => /^[A-L]\s*[.．、]/.test(text(el.innerText)));
  const unique = options.filter(
    (el) => !options.some((other) => other !== el && other.contains(el)),
  );
  const opts = unique.map((el) => {
    const match = text(el.innerText).match(/^([A-L])\s*[.．、]\s*(.*)$/);
    return {
      id: match[1],
      text: match[2],
      selector: css(el),
      selected:
        (m[1] === "多选题" &&
          el.matches(".topic-item") &&
          [...el.querySelectorAll("svg.topic-option use")].some((use) =>
            /#iconfuxuanzhong(?:bukegai)?$/.test(
              use.getAttribute("href") || use.getAttribute("xlink:href") || "",
            ),
          )) ||
        el.matches(
          'input:checked,[aria-checked="true"],.is-checked,.checked',
        ) ||
        el.getAttribute("aria-checked") === "true" ||
        Boolean(
          el.querySelector(
            'input:checked,[aria-checked="true"],.is-checked,.checked',
          ),
        ) ||
        /(?:^|\s)(?:active|selected|checked|on)(?:\s|$)/.test(el.className),
    };
  });
  const buttons = [
    ...panel.querySelectorAll('button,[role="button"],div,span'),
  ].filter(visible);
  const submit = buttons
    .filter((el) => /^(提交|提交答案|确认|确定)$/.test(text(el.innerText)))
    .find(
      (el) =>
        !buttons.some(
          (other) =>
            other !== el &&
            el.contains(other) &&
            /^(提交|提交答案|确认|确定)$/.test(text(other.innerText)),
        ),
    );
  const close =
    buttons
      .filter((el) => /^关闭$/.test(text(el.innerText)))
      .find(
        (el) =>
          !buttons.some(
            (other) =>
              other !== el &&
              el.contains(other) &&
              /^关闭$/.test(text(other.innerText)),
          ),
      ) ?? panel.querySelector('button[aria-label="Close"]');
  let result = null;
  const beforeType = text(stemNode.innerText).slice(0, m.index).trim();
  const gradeTexts = [
    beforeType,
    ...[...panel.querySelectorAll("*")]
      .filter(visible)
      .filter(
        (el) =>
          !el.contains(stemNode) &&
          !stemNode.contains(el) &&
          !unique.some((option) => option.contains(el) || el.contains(option)),
      )
      .map((el) => text(el.innerText)),
  ];
  for (const value of gradeTexts) {
    const verdict = value.match(/^(?:回答|答题)?(正确|错误)(?=$|\s|[!！。])/);
    if (verdict) {
      result = verdict[1] === "正确" ? "correct" : "incorrect";
      break;
    }
  }
  info.quiz = {
    type:
      { 单选题: "single", 多选题: "multi", 判断题: "judgement" }[m[1]] ??
      "unsupported",
    stem,
    options: opts,
    hasImages:
      (visible(stemNode) &&
        Boolean(stemNode.querySelector("img,canvas,svg"))) ||
      unique.some((el) => Boolean(el.querySelector("img,canvas"))),
    result,
    submit: submit ? css(submit) : null,
    close: close ? css(close) : null,
  };
  return info;
}
export function canonicalQuiz(q) {
  return q
    ? JSON.stringify([q.type, q.stem, q.options.map((x) => [x.id, x.text])])
    : "";
}
export function actionEvidence(q) {
  return q
    ? JSON.stringify([
        q.type,
        q.stem,
        q.options.map((x) => [x.id, x.text, Boolean(x.selected)]),
        q.result ?? null,
      ])
    : "";
}
