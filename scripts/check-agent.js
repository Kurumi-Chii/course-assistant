import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentRouter } from "../src/providers.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = await loadAgentRouter(path.join(root, "data"));
try {
  console.log(JSON.stringify(await provider.check()));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
