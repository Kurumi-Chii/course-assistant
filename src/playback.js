import { createHash } from "node:crypto";

export function playbackState(p) {
  if (!p?.mediaKey) return "unavailable";
  if (p.error) return "error";
  if (
    p.ended &&
    Number.isFinite(p.duration) &&
    p.duration > 0 &&
    Number.isFinite(p.currentTime) &&
    p.currentTime >= p.duration - 0.75 &&
    !p.seeking
  )
    return "ended";
  if (p.ended || p.seeking || p.readyState < 2) return "buffering";
  if (p.paused) return "paused";
  return p.readyState >= 3 ? "playing" : "buffering";
}
export function videoKey(p) {
  return (
    "video:" + createHash("sha256").update(String(p.mediaKey)).digest("hex")
  );
}
// Serialized into the browser, so keep this function self-contained.
export function playbackEvidence(p, mode = "exact") {
  if (p && mode === "completed-next")
    return JSON.stringify([
      p.mediaKey,
      p.duration,
      p.error,
      p.seeking,
      p.next?.selector ?? null,
      p.next?.disabled ?? null,
    ]);
  return p
    ? JSON.stringify([
        p.mediaKey,
        p.paused,
        p.ended,
        p.seeking,
        p.currentTime,
        p.duration,
        p.error,
        p.next?.selector ?? null,
        p.playSelector,
      ])
    : "";
}
