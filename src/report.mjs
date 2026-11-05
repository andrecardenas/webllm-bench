const number = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "n/a");

export function renderReport(results) {
  const lines = [
    "# Benchmark results",
    "",
    `- **Suite:** ${results.suite}`,
    `- **Machine:** ${results.machine.cpu}, ${results.machine.memoryGb} GB RAM, ${results.machine.platform}`,
    `- **Browser:** headless ${results.browser}`,
    `- **Date:** ${results.date}`,
    `- **Runs per prompt:** ${results.runsPerPrompt}`,
    "",
    "| Model | Device | Threads | Load | Warm-up | First token | Tokens/s | Peak memory | Warning signs passed | Ordinary passed |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of results.rows) {
    const s = row.summary;
    lines.push(
      `| ${row.modelLabel} | ${row.device} | ${row.threads} | ${number(row.loadMs / 1000)} s | ${number(row.warmMs / 1000)} s | ${number(s.ttftMs / 1000)} s | ${number(s.tokensPerSecond)} | ${number(row.peakBytes / 1e9)} GB | ${s.warningSignPassed}/${s.warningSignTotal} | ${s.ordinaryPassed}/${s.ordinaryTotal} |`,
    );
  }
  lines.push(
    "",
    "First token and tokens per second are medians across every run. Each prompt starts with the system prompt already cached.",
    "",
    "Peak memory adds up the working sets of all browser processes, so shared pages count more than once.",
    "",
    "The pass counts come from keyword checks. They flag replies for a person to read and do not prove a reply is safe.",
    "",
    "## Replies",
  );
  for (const row of results.rows) {
    lines.push("", `### ${row.modelLabel}, ${row.device}, ${row.threads} threads`, "");
    for (const run of row.runs) {
      const reply = String(run.reply ?? "").replace(/\s+/g, " ").trim();
      lines.push(`- **${run.id}, run ${run.run}, ${run.score?.pass ? "pass" : "FLAGGED"}:** ${reply}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
