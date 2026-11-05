import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function loadRegistry(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

// Downloads resume from a .part file, and nothing is trusted until its hash matches.
export async function ensureModel(model, dir, log = () => {}) {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, model.file);
  if (!existsSync(target)) {
    const part = `${target}.part`;
    const have = existsSync(part) ? statSync(part).size : 0;
    log(`Downloading ${model.file} (${(model.bytes / 1e9).toFixed(2)} GB)`);
    const response = await fetch(model.url, { headers: have ? { Range: `bytes=${have}-` } : {} });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    const append = have > 0 && response.status === 206;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part, { flags: append ? "a" : "w" }));
    await rename(part, target);
  }
  const actual = await sha256File(target);
  if (actual !== model.sha256) {
    throw new Error(`Hash mismatch for ${model.file}: expected ${model.sha256}, got ${actual}`);
  }
  return target;
}
