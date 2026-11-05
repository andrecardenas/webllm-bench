import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CANDIDATES = {
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

export function findBrowser(override = process.env.CHROME_PATH, platform = process.platform, exists = existsSync) {
  if (override) return override;
  const found = (CANDIDATES[platform] || []).find((file) => exists(file));
  if (!found) throw new Error("No Chrome or Edge found. Set CHROME_PATH to its executable.");
  return found;
}

export function browserFlags({ gpu = false, profile, url }) {
  const device = gpu
    ? ["--enable-unsafe-webgpu", "--force_high_performance_gpu"]
    : ["--disable-gpu", "--disable-webgpu"];
  return ["--headless=new", ...device, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", url];
}

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1 << 24 }, (error, stdout) => resolve(error ? "" : String(stdout)));
  });
}

// Sum of working sets across the browser's processes. Shared pages count more
// than once, so treat this as an upper bound on memory use.
export async function sampleMemory(profile) {
  if (process.platform === "win32") {
    const script = `$t=0;Get-CimInstance Win32_Process | ?{$_.CommandLine -like '*${profile}*'} | %{$t+=$_.WorkingSetSize};$t`;
    return Number((await run("powershell.exe", ["-NoProfile", "-Command", script])).trim()) || 0;
  }
  const output = await run("ps", ["-axo", "rss=,command="]);
  return output
    .split("\n")
    .filter((line) => line.includes(profile))
    .reduce((sum, line) => sum + (Number.parseInt(line.trim(), 10) || 0) * 1024, 0);
}

async function killProfile(child, profile) {
  child.kill();
  if (process.platform === "win32") {
    const script = `Get-CimInstance Win32_Process | ?{$_.CommandLine -like '*${profile}*'} | %{Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}`;
    await run("powershell.exe", ["-NoProfile", "-Command", script]);
  } else {
    await run("pkill", ["-f", profile]);
  }
}

export async function launchBrowser({ url, gpu }) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "webllm-bench-"));
  const child = spawn(findBrowser(), browserFlags({ gpu, profile, url }), { stdio: "ignore" });
  let peakBytes = 0;
  let live = true;
  const sampler = (async () => {
    while (live) {
      peakBytes = Math.max(peakBytes, await sampleMemory(profile));
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  })();
  return {
    async stop() {
      live = false;
      await sampler;
      await killProfile(child, profile);
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }).catch(() => {});
      return { peakBytes };
    },
  };
}
