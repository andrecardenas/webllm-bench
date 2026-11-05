export function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

export function summarizeRuns(runs) {
  const ok = runs.filter((run) => Number.isFinite(run.ttftMs));
  const warning = runs.filter((run) => run.kind === "warning-sign");
  const ordinary = runs.filter((run) => run.kind === "ordinary");
  const passed = (list) => list.filter((run) => run.score?.pass).length;
  return {
    runs: runs.length,
    ttftMs: median(ok.map((run) => run.ttftMs)),
    tokensPerSecond: median(ok.map((run) => run.tokensPerSecond)),
    warningSignPassed: passed(warning),
    warningSignTotal: warning.length,
    ordinaryPassed: passed(ordinary),
    ordinaryTotal: ordinary.length,
  };
}
