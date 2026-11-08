import { createHash, randomInt } from "node:crypto";
export const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
export function normalizeQuestion(raw) {
  if (!raw || !["single", "multi", "judgement"].includes(raw.type))
    throw new Error("暂不支持这种题型，请手动处理");
  const stem = clean(raw.stem);
  if (!stem || stem.length > 12000 || raw.hasImages)
    throw new Error("题目文字不完整或包含图片，请手动处理");
  const options = (raw.options ?? []).map((x) => ({
    id: clean(x.id),
    text: clean(x.text),
    selected: Boolean(x.selected),
  }));
  if (
    options.length < 2 ||
    options.length > 12 ||
    options.some(
      (x) => !x.text || x.text.length > 3000 || !/^[A-L]$/.test(x.id),
    ) ||
    new Set(options.map((x) => x.id)).size !== options.length
  )
    throw new Error("题目选项无法可靠识别");
  return { type: raw.type, stem, options };
}
export function identity(q) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        q.type,
        clean(q.stem),
        q.options.map((x) => [x.id, clean(x.text)]),
      ]),
    )
    .digest("hex");
}
export class UncertainAnswerError extends Error {
  constructor() {
    super("模型无法确定答案，请手动处理");
  }
}
export function validateAnswer(q, result) {
  if (!["answered", "uncertain"].includes(result?.status))
    throw new Error("模型返回的答案格式不合法");
  const ids = result.selectedOptionIds;
  if (result.status === "uncertain") {
    if (!Array.isArray(ids) || ids.length)
      throw new Error("模型返回的答案格式或选项不合法");
    if (typeof result.reason !== "string" || result.reason.length > 4000)
      throw new Error("模型返回的解释格式不合法");
    throw new UncertainAnswerError();
  }
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !q.options.some((x) => x.id === id)) ||
    (q.type !== "multi" && ids.length !== 1)
  )
    throw new Error("模型返回的答案格式或选项不合法");
  if (typeof result.reason !== "string" || result.reason.length > 4000)
    throw new Error("模型返回的解释格式不合法");
  return {
    status: "answered",
    selectedOptionIds: q.options
      .filter((x) => ids.includes(x.id))
      .map((x) => x.id),
    reason: result.reason,
  };
}
export function randomAnswer(raw) {
  const q = normalizeQuestion(raw);
  let selectedOptionIds;
  if (q.type === "multi") {
    // Each nonempty subset corresponds to one bit mask.
    const mask = randomInt(1, 2 ** q.options.length);
    selectedOptionIds = q.options
      .filter((_, index) => mask & (1 << index))
      .map((option) => option.id);
  } else {
    selectedOptionIds = [q.options[randomInt(q.options.length)].id];
  }
  return {
    status: "answered",
    selectedOptionIds,
    reason: "模型无法确定，已随机选择",
  };
}
