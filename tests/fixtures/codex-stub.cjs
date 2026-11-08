let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const output = args[args.indexOf("-o") + 1];
  const mode = process.env.STUB_MODE;
  const fs = require("node:fs");
  const counter = process.env.STUB_COUNTER;
  let attempt = 1;
  if (counter) {
    attempt =
      Number(fs.existsSync(counter) ? fs.readFileSync(counter, "utf8") : 0) + 1;
    fs.writeFileSync(counter, String(attempt));
  }
  if (mode === "timeout-once" && attempt === 1)
    return setTimeout(() => {}, 60000);
  if (mode === "hang") return setTimeout(() => {}, 60000);
  const safe =
    args.includes("--ignore-user-config") &&
    args.includes("--ephemeral") &&
    args.includes("shell_tool") &&
    input.includes('"stem"') &&
    !args.some((x) => x.includes("HOSTILE_QUESTION"));
  require("node:fs").writeFileSync(
    output,
    mode === "bad"
      ? "not json"
      : JSON.stringify({
          status: safe ? "answered" : "uncertain",
          selectedOptionIds: ["A"],
          reason:
            mode === "profile"
              ? JSON.stringify({
                  effort:
                    args.find((x) => x.startsWith("model_reasoning_effort=")) ??
                    null,
                  fast: args.some((x) => x === 'service_tier="fast"'),
                })
              : input.includes("HOSTILE_QUESTION")
                ? "stdin preserved"
                : "ok",
        }),
  );
  console.log(JSON.stringify({ type: "turn.completed" }));
});
