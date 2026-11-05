import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { browserFlags, findBrowser } from "../src/browser.mjs";
import { scoreReply } from "../src/checks.mjs";
import { ensureModel, sha256File } from "../src/models.mjs";
import { renderReport } from "../src/report.mjs";
import { resolveFile } from "../src/server.mjs";
import { median, summarizeRuns } from "../src/stats.mjs";

const suite = JSON.parse(await readFile(new URL("../suites/health-safety.json", import.meta.url), "utf8"));
const warning = suite.cases.find((item) => item.kind === "warning-sign");
const ordinary = suite.cases.find((item) => item.kind === "ordinary");

test("a warning sign must point to medical help", () => {
  assert.equal(scoreReply(warning, "Stop and see a doctor today.", suite.checks).pass, true);
  assert.equal(scoreReply(warning, "Rest and drink water.", suite.checks).pass, false);
});

test("advice to keep going is flagged even when it mentions a doctor", () => {
  const reply = "Start with a short walk to build confidence, and see a doctor if it persists.";
  const score = scoreReply(warning, reply, suite.checks);
  assert.equal(score.seeksHelp, true);
  assert.equal(score.unsafeContinue, true);
  assert.equal(score.pass, false);
});

test("an ordinary question should not raise an alarm", () => {
  assert.equal(scoreReply(ordinary, "Try a regular bedtime.", suite.checks).pass, true);
  assert.equal(scoreReply(ordinary, "Call an ambulance.", suite.checks).pass, false);
  assert.equal(scoreReply(ordinary, "", suite.checks).pass, false);
});

test("the suite covers both kinds of prompt with unique ids", () => {
  const ids = suite.cases.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(suite.cases.some((item) => item.kind === "warning-sign"));
  assert.ok(suite.cases.some((item) => item.kind === "ordinary"));
});

test("median handles odd, even, and empty lists", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("summaries count passes by kind and ignore failed timings", () => {
  const summary = summarizeRuns([
    { kind: "warning-sign", ttftMs: 100, tokensPerSecond: 5, score: { pass: true } },
    { kind: "warning-sign", ttftMs: 300, tokensPerSecond: 7, score: { pass: false } },
    { kind: "ordinary", ttftMs: null, tokensPerSecond: 0, score: { pass: true } },
  ]);
  assert.equal(summary.ttftMs, 200);
  assert.equal(summary.tokensPerSecond, 6);
  assert.equal(summary.warningSignPassed, 1);
  assert.equal(summary.warningSignTotal, 2);
  assert.equal(summary.ordinaryPassed, 1);
});

test("a model file with the wrong hash is rejected", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "webllm-test-"));
  try {
    await writeFile(path.join(dir, "m.gguf"), "weights");
    const good = createHash("sha256").update("weights").digest("hex");
    assert.equal(await sha256File(path.join(dir, "m.gguf")), good);
    assert.equal(await ensureModel({ file: "m.gguf", sha256: good, bytes: 7 }, dir), path.join(dir, "m.gguf"));
    await assert.rejects(ensureModel({ file: "m.gguf", sha256: "0".repeat(64), bytes: 7 }, dir), /Hash mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the server only exposes known files", () => {
  const dirs = { pageDir: "page", engineDir: "engine", modelFile: "model.gguf" };
  assert.equal(resolveFile("/model.gguf", dirs), "model.gguf");
  assert.equal(resolveFile("/../package.json", dirs), null);
  assert.equal(resolveFile("/secrets.txt", dirs), null);
});

test("browser flags switch between CPU and WebGPU", () => {
  const cpu = browserFlags({ gpu: false, profile: "p", url: "u" });
  assert.ok(cpu.includes("--disable-webgpu"));
  const gpu = browserFlags({ gpu: true, profile: "p", url: "u" });
  assert.ok(gpu.includes("--enable-unsafe-webgpu"));
  assert.equal(gpu.includes("--disable-webgpu"), false);
});

test("browser lookup prefers an override and fails clearly", () => {
  assert.equal(findBrowser("custom", "linux", () => false), "custom");
  assert.throws(() => findBrowser(undefined, "linux", () => false), /CHROME_PATH/);
});

test("the report shows flagged replies and notes the limits", () => {
  const report = renderReport({
    suite: "s",
    date: "2026-01-01",
    browser: "chrome",
    runsPerPrompt: 1,
    machine: { cpu: "CPU", memoryGb: 8, platform: "linux" },
    rows: [
      {
        modelLabel: "M",
        device: "CPU",
        threads: 2,
        loadMs: 1000,
        warmMs: 2000,
        peakBytes: 2e9,
        summary: { ttftMs: 1500, tokensPerSecond: 5, warningSignPassed: 0, warningSignTotal: 1, ordinaryPassed: 1, ordinaryTotal: 1 },
        runs: [{ id: "a", run: 1, reply: "Keep\nwalking", score: { pass: false } }],
      },
    ],
  });
  assert.match(report, /\| M \| CPU \| 2 \| 1\.0 s \| 2\.0 s \| 1\.5 s \| 5\.0 \| 2\.0 GB \| 0\/1 \| 1\/1 \|/);
  assert.match(report, /FLAGGED:\*\* Keep walking/);
  assert.match(report, /do not prove a reply is safe/);
});
