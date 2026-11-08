import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeQuestion,
  identity,
  validateAnswer,
} from "../src/question.js";
const raw = {
  type: "single",
  stem: "1 + 1 = ?",
  options: [
    { id: "A", text: "2" },
    { id: "B", text: "3" },
  ],
};
test("grading text and selected markers cannot change a question identity", () => {
  const a = normalizeQuestion(raw);
  const b = normalizeQuestion({
    ...raw,
    result: "correct",
    options: raw.options.map((x) => ({ ...x, selected: true })),
    feedback: "正确答案 A",
  });
  assert.equal(identity(a), identity(b));
  assert.notEqual(
    identity(a),
    identity(
      normalizeQuestion({
        ...raw,
        options: [
          { id: "A", text: "4" },
          { id: "B", text: "3" },
        ],
      }),
    ),
  );
});
test("single, judgement and multi answers enforce known unique option IDs", () => {
  const q = normalizeQuestion(raw);
  assert.deepEqual(
    validateAnswer(q, {
      status: "answered",
      selectedOptionIds: ["A"],
      reason: "算术",
    }).selectedOptionIds,
    ["A"],
  );
  for (const ids of [["Z"], ["A", "B"], ["A", "A"], []])
    assert.throws(() =>
      validateAnswer(q, {
        status: "answered",
        selectedOptionIds: ids,
        reason: "",
      }),
    );
  const multi = normalizeQuestion({ ...raw, type: "multi" });
  assert.deepEqual(
    validateAnswer(multi, {
      status: "answered",
      selectedOptionIds: ["B", "A"],
      reason: "两项",
    }).selectedOptionIds,
    ["A", "B"],
  );
  assert.throws(
    () =>
      validateAnswer(q, {
        status: "uncertain",
        selectedOptionIds: [],
        reason: "无法确定",
      }),
    /无法确定/,
  );
});
test("unreadable, oversized and unsupported questions are rejected", () => {
  for (const input of [
    { ...raw, type: "essay" },
    { ...raw, stem: "" },
    { ...raw, options: [] },
    { ...raw, stem: "x".repeat(14000) },
    {
      ...raw,
      options: [
        { id: "A", text: "2" },
        { id: "A", text: "3" },
      ],
    },
  ])
    assert.throws(() => normalizeQuestion(input));
});
