import { test } from "node:test";
import assert from "node:assert/strict";
import { playbackState } from "../src/playback.js";
const video = {
  mediaKey: "one",
  paused: false,
  ended: false,
  seeking: false,
  readyState: 4,
  currentTime: 5,
  duration: 60,
  error: false,
};
test("only native ended with a finite reached duration counts as completed", () => {
  assert.equal(playbackState(video), "playing");
  assert.equal(playbackState({ ...video, paused: true }), "paused");
  assert.equal(playbackState({ ...video, readyState: 2 }), "buffering");
  assert.equal(
    playbackState({ ...video, ended: true, currentTime: 60 }),
    "ended",
  );
  for (const bad of [
    { currentTime: 20 },
    { duration: null },
    { duration: Infinity },
    { seeking: true },
  ])
    assert.notEqual(
      playbackState({ ...video, ended: true, currentTime: 60, ...bad }),
      "ended",
    );
});
