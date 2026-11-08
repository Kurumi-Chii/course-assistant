export const APP = "course-assistant-harness";
export function validateQuestion(q) {
  if (
    !q ||
    !["single", "multi", "judgement"].includes(q.type) ||
    typeof q.stem !== "string" ||
    !q.stem.trim() ||
    q.stem.length > 12000 ||
    q.hasImages ||
    !Array.isArray(q.options) ||
    q.options.length < 2 ||
    q.options.length > 12
  )
    throw new Error("invalid_question");
  const ids = new Set();
  for (const x of q.options) {
    if (
      !x ||
      !/^[A-L]$/.test(x.id) ||
      ids.has(x.id) ||
      typeof x.text !== "string" ||
      !x.text.trim() ||
      x.text.length > 3000
    )
      throw new Error("invalid_question");
    ids.add(x.id);
  }
  return {
    type: q.type,
    stem: q.stem,
    options: q.options.map(({ id, text }) => ({ id, text })),
  };
}
export function validateResult(q, a) {
  if (
    !a ||
    !["answered", "uncertain"].includes(a.status) ||
    !Array.isArray(a.selectedOptionIds) ||
    typeof a.reason !== "string" ||
    a.reason.length > 4000 ||
    new Set(a.selectedOptionIds).size !== a.selectedOptionIds.length ||
    a.selectedOptionIds.some((id) => !q.options.some((x) => x.id === id)) ||
    (a.status === "answered" &&
      (!a.selectedOptionIds.length ||
        (q.type !== "multi" && a.selectedOptionIds.length !== 1))) ||
    (a.status === "uncertain" && a.selectedOptionIds.length)
  )
    throw new Error("invalid_answer");
  return {
    status: a.status,
    selectedOptionIds: a.selectedOptionIds,
    reason: a.reason,
  };
}
