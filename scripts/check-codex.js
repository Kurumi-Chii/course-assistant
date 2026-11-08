import { CodexProvider } from "../src/codex.js";
import path from "node:path";
const provider = new CodexProvider({ dataDir: path.resolve("data/model") });
const started = Date.now();
try {
  console.log(
    JSON.stringify(
      { ...(await provider.check()), elapsedMs: Date.now() - started },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
