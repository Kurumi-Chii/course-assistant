import { CodexProvider } from "../src/codex.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const question = {
  type: "single",
  stem: "哪位美国总统于1972年首次访问中华人民共和国？",
  options: [
    { id: "A", text: "约翰·肯尼迪" },
    { id: "B", text: "理查德·尼克松" },
  ],
};
const results = [];
await mkdir("data/verification", { recursive: true });
for (const reasoningEffort of ["default", "low"]) {
  const provider = new CodexProvider({
    reasoningEffort,
    dataDir: path.resolve("data/verification/speed-model"),
  });
  const started = performance.now();
  const answer = await provider.solve(question);
  if (answer.selectedOptionIds.join("") !== "B")
    throw new Error("速度样例答案不正确");
  const result = {
    reasoningEffort,
    elapsedMs: Math.round(performance.now() - started),
    correct: true,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  "data/verification/codex-speed.json",
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      sampleCountPerMode: 1,
      warning: "一次同题对比，受缓存、网络和服务负载影响，不能作为总体性能承诺",
      results,
    },
    null,
    2,
  ),
);
