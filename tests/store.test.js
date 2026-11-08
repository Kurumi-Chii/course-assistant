import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Journal } from "../src/store.js";
test("journal remembers unfinished clicks and limits history on disk", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "course-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const j = new Journal(dir, { limit: 2 });
  await j.load();
  await j.begin({ key: "one", stem: "题目" });
  await j.step("resume-intent");
  const reopened = new Journal(dir, { limit: 2 });
  await reopened.load();
  assert.equal(reopened.pending.stage, "resume-intent");
  await reopened.finish({ outcome: "uncertain" });
  for (let i = 0; i < 3; i++) {
    await reopened.begin({ key: String(i), stem: "题" });
    await reopened.finish({ outcome: "correct" });
  }
  const again = new Journal(dir, { limit: 2 });
  await again.load();
  assert.equal(again.history.length, 2);
  assert.equal(again.pending, null);
});
test("corrupt journal fails closed instead of silently replaying actions", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "course-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "journal.json"), "{oops");
  const j = new Journal(dir);
  await assert.rejects(j.load(), /记录|损坏/);
});

test("manual acknowledgement preserves the model choices and original failure", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "course-store-manual-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const j = new Journal(dir);
  await j.load();
  await j.begin({ key: "multi", stem: "题目" });
  await j.step("select-intent", {
    selectedOptionIds: ["A", "C"],
    lastFailure: { message: "未确认选中" },
  });
  await j.finish({ outcome: "manual", reason: "用户确认" });
  assert.deepEqual(j.history[0].selectedOptionIds, ["A", "C"]);
  assert.equal(j.history[0].lastFailure.message, "未确认选中");
});

for (const failure of ["write", "rename"])
  test("failed " + failure + " retains pending intent in memory", async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "course-store-fail-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const j = new Journal(dir);
    await j.load();
    await j.begin({ key: "pending", stem: "题" });
    await j.step("resume-intent");
    if (failure === "write") await mkdir(j.file + ".tmp");
    else {
      await rm(j.file);
      await mkdir(j.file);
    }
    await assert.rejects(j.finish({ outcome: "correct" }));
    assert.equal(j.pending?.stage, "resume-intent");
    assert.equal(j.history.length, 0);
  });
