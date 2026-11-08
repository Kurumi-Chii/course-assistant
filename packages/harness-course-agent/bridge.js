import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { APP, validateQuestion, validateResult } from "./protocol.js";

export async function startBridge({ file, solve, metadata = () => ({}) }) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let token;
  try {
    const old = JSON.parse(await readFile(file, "utf8"));
    if (
      old.app !== APP ||
      old.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(old.token)
    )
      throw new Error("invalid_pairing");
    token = old.token;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    token = randomBytes(32).toString("hex");
  }
  const running = new Set();
  const send = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const expected = "127.0.0.1:" + server.address().port;
    const candidate = Buffer.from(String(req.headers.authorization || "")),
      secret = Buffer.from("Bearer " + token);
    if (
      req.headers.host !== expected ||
      req.headers.origin ||
      req.headers["sec-fetch-site"] === "cross-site" ||
      candidate.length !== secret.length ||
      !timingSafeEqual(candidate, secret)
    ) {
      send(res, 403, { error: "forbidden" });
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      try {
        send(res, 200, { app: APP, version: 1, ...metadata() });
      } catch {
        send(res, 503, { error: "harness_not_ready" });
      }
      return;
    }
    if (req.method !== "POST" || req.url !== "/solve") {
      send(res, 404, { error: "not_found" });
      return;
    }
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
      send(res, 415, { error: "invalid_request" });
      return;
    }
    if (running.size) {
      send(res, 429, { error: "busy" });
      return;
    }
    const ac = new AbortController();
    running.add(ac);
    const timer = setTimeout(() => ac.abort(), 120000);
    res.once("close", () => {
      if (!res.writableEnded) ac.abort();
    });
    try {
      const parts = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 196608) throw new Error("invalid_question");
        parts.push(chunk);
      }
      let payload;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(parts, bytes),
          ),
        );
      } catch {
        throw new Error("invalid_question");
      }
      const question = validateQuestion(payload.question);
      ac.signal.throwIfAborted();
      const answer = validateResult(question, await solve(question, ac.signal));
      ac.signal.throwIfAborted();
      send(res, 200, { answer });
    } catch (e) {
      const error = ac.signal.aborted
        ? "cancelled"
        : e instanceof SyntaxError
          ? "invalid_question"
          : ["invalid_question", "invalid_answer"].includes(e.message)
            ? e.message
            : "model_failed";
      send(
        res,
        error === "cancelled"
          ? 504
          : error === "invalid_answer"
            ? 422
            : error === "invalid_question"
              ? 400
              : 502,
        { error },
      );
    } finally {
      clearTimeout(timer);
      running.delete(ac);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const tmp = file + ".tmp";
    await writeFile(
      tmp,
      JSON.stringify({
        app: APP,
        version: 1,
        endpoint: "http://127.0.0.1:" + server.address().port + "/solve",
        token,
      }),
      { mode: 0o600 },
    );
    await rename(tmp, file);
  } catch (e) {
    server.closeAllConnections();
    server.close();
    throw e;
  }
  return {
    server,
    get active() {
      return running.size;
    },
    async close() {
      for (const ac of running) ac.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
