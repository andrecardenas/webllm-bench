#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { launchBrowser, findBrowser } from "./browser.mjs";
import { scoreReply } from "./checks.mjs";
import { ensureModel, loadRegistry } from "./models.mjs";
import { renderReport } from "./report.mjs";
import { startServer } from "./server.mjs";
import { summarizeRuns } from "./stats.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (message) => console.log(message);

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "qwen3-1.7b" },
    threads: { type: "string", default: "6" },
    runs: { type: "string", default: "3" },
    suite: { type: "string", default: path.join(root, "suites", "health-safety.json") },
    out: { type: "string", default: path.join(root, "results") },
    gpu: { type: "boolean", default: false },
    "max-tokens": { type: "string", default: "256" },
    "timeout-minutes": { type: "string", default: "45" },
  },
});

function engineDir() {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("@wllama/wllama/package.json")), "esm");
}

async function benchOne({ model, modelFile, threads, suite, runsPerPrompt, gpu, maxTokens, timeoutMs }) {
  const events = [];
  let finish;
  const finished = new Promise((resolve) => (finish = resolve));
  const config = {
    system: suite.system,
    cases: suite.cases,
    runs: runsPerPrompt,
    maxTokens,
    assistantPrefix: model.assistantPrefix,
    gpu,
    threads,
  };
  const server = await startServer({
    pageDir: path.join(root, "page"),
    engineDir: engineDir(),
    modelFile,
    config,
    onEvent(event) {
      events.push(event);
      if (event.type === "run") {
        log(`  ${event.id} run ${event.run}: first token ${(event.ttftMs / 1000).toFixed(1)} s, ${event.tokensPerSecond.toFixed(1)} tokens/s`);
      } else if (event.type === "error") {
        log(`  error: ${event.message}`);
      }
      if (event.type === "done" || event.type === "fatal") finish();
    },
  });
  const browser = await launchBrowser({ url: server.url, gpu });
  const timer = setTimeout(() => {
    events.push({ type: "fatal", message: "Timed out" });
    finish();
  }, timeoutMs);
  await finished;
  clearTimeout(timer);
  const { peakBytes } = await browser.stop();
  server.close();

  const fatal = events.find((event) => event.type === "fatal");
  if (fatal) throw new Error(fatal.message);
  const env = events.find((event) => event.type === "env");
  if (gpu && !env?.webgpu) throw new Error("GPU run requested, but this browser reported no WebGPU adapter.");
  const byId = new Map(suite.cases.map((item) => [item.id, item]));
  const runs = events
    .filter((event) => event.type === "run")
    .map((event) => ({
      ...event,
      kind: byId.get(event.id).kind,
      score: scoreReply(byId.get(event.id), event.reply, suite.checks),
    }));
  return {
    modelLabel: model.label,
    device: gpu ? `WebGPU (${env.adapter?.description || env.adapter?.vendor || "unknown adapter"})` : "CPU",
    threads,
    isolated: env?.isolated ?? false,
    loadMs: events.find((event) => event.type === "loaded")?.ms,
    warmMs: events.find((event) => event.type === "warm")?.ms,
    peakBytes,
    summary: summarizeRuns(runs),
    runs,
  };
}

const registry = await loadRegistry(path.join(root, "models.json"));
const suite = JSON.parse(await readFile(values.suite, "utf8"));
const modelIds = values.model.split(",");
const threadCounts = values.threads.split(",").map(Number);
const runsPerPrompt = Number(values.runs);
const rows = [];
for (const id of modelIds) {
  const model = registry[id];
  if (!model) throw new Error(`Unknown model "${id}". Known: ${Object.keys(registry).join(", ")}`);
  const modelFile = await ensureModel(model, path.join(root, "models"), log);
  for (const threads of threadCounts) {
    log(`${model.label}, ${threads} threads${values.gpu ? ", GPU" : ""}`);
    rows.push(
      await benchOne({
        model,
        modelFile,
        threads,
        suite,
        runsPerPrompt,
        gpu: values.gpu,
        maxTokens: Number(values["max-tokens"]),
        timeoutMs: Number(values["timeout-minutes"]) * 60_000,
      }),
    );
  }
}

const results = {
  suite: suite.name,
  date: new Date().toISOString().slice(0, 10),
  browser: path.basename(findBrowser()),
  runsPerPrompt,
  machine: {
    cpu: os.cpus()[0]?.model?.trim() || "unknown CPU",
    memoryGb: Math.round(os.totalmem() / 1e9),
    platform: process.platform,
  },
  rows,
};
await mkdir(values.out, { recursive: true });
await writeFile(path.join(values.out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(path.join(values.out, "report.md"), renderReport(results));
log(`Wrote ${path.join(values.out, "report.md")}`);
process.exit(0);
