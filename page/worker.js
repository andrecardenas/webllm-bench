import { Wllama } from "/engine/index.js";

const STOP = "<|im_end|>";
const say = (event) => self.postMessage(event);
const logger = {
  debug() {},
  log() {},
  warn() {},
  error(...args) {
    say({ type: "error", message: args.join(" ").slice(0, 400) });
  },
};

// The included models use ChatML. A model with another template needs its own formatter.
function systemTurn(system) {
  return `<|im_start|>system\n${system}${STOP}\n`;
}

function fullPrompt(config, prompt) {
  return `${systemTurn(config.system)}<|im_start|>user\n${prompt}${STOP}\n<|im_start|>assistant\n${config.assistantPrefix}`;
}

function textOf(chunk) {
  const choice = chunk?.choices?.[0];
  const text = choice?.text ?? choice?.delta?.content;
  if (typeof text !== "string") return "";
  const cut = text.indexOf(STOP);
  return cut >= 0 ? text.slice(0, cut) : text;
}

try {
  const config = await (await fetch("/config.json")).json();
  const blob = await (await fetch("/model.gguf")).blob();
  const engine = new Wllama(
    { default: new URL("/wllama.wasm", self.location.origin).href },
    { suppressNativeLog: true, logger },
  );

  let started = performance.now();
  await engine.loadModel([blob], {
    n_ctx: 4096,
    n_batch: 512,
    n_ubatch: 512,
    n_threads: config.threads,
    n_gpu_layers: config.gpu ? 99 : 0,
    embeddings: false,
    warmup: true,
    cache_type_k: "q8_0",
    cache_type_v: "q8_0",
    n_parallel: 1,
    flash_attn: true,
  });
  say({ type: "loaded", ms: performance.now() - started, threads: engine.getNumThreads?.() });

  const warm = () =>
    engine.createCompletion({
      prompt: systemTurn(config.system),
      stream: false,
      max_tokens: 1,
      temperature: 0,
      cache_prompt: true,
    });

  started = performance.now();
  await warm();
  say({ type: "warm", ms: performance.now() - started });

  for (let run = 1; run <= config.runs; run += 1) {
    for (const item of config.cases) {
      // Trim the cache back so every prompt starts from the same state.
      await warm();
      const begin = performance.now();
      let first = 0;
      let reply = "";
      let pieces = 0;
      let nativeSpeed = 0;
      let nativeTokens = 0;
      let cached = 0;
      const stream = await engine.createCompletion({
        prompt: fullPrompt(config, item.prompt),
        stream: true,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        max_tokens: config.maxTokens,
        stop: [STOP],
        cache_prompt: true,
      });
      for await (const chunk of stream) {
        const piece = textOf(chunk);
        if (piece) {
          pieces += 1;
          if (!first) first = performance.now();
          reply += piece;
        }
        const timings = chunk?.timings;
        if (timings && Number(timings.predicted_n) > 0) {
          nativeSpeed = Number(timings.predicted_per_second) || nativeSpeed;
          nativeTokens = Number(timings.predicted_n) || nativeTokens;
          cached = Number(timings.cache_n) || cached;
        }
      }
      const end = performance.now();
      const tokens = nativeTokens || pieces;
      const measured = first && tokens > 1 ? (tokens - 1) / ((end - first) / 1000) : 0;
      say({
        type: "run",
        id: item.id,
        run,
        ttftMs: first ? first - begin : null,
        totalMs: end - begin,
        tokens,
        tokensPerSecond: nativeSpeed || measured,
        cachedTokens: cached,
        reply,
      });
    }
  }
  say({ type: "done" });
} catch (error) {
  say({ type: "fatal", message: String(error?.message || error) });
}
