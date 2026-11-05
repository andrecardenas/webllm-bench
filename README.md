# webllm-bench

Benchmark GGUF language models inside a real browser, on real consumer hardware. It measures speed and memory, and it flags replies that give weak advice about medical warning signs.

Most LLM benchmarks run natively or on a server GPU. If your model runs in a browser, those numbers tell you little, because WebAssembly, threads, and browser memory all change the result. This tool runs [llama.cpp through wllama](https://github.com/ngxson/wllama) in headless Chrome or Edge, the way a web app would.

## What it measures

- Model load time and system prompt warm-up time
- Time to first token and tokens per second, as medians across runs
- Peak browser memory
- Keyword checks on replies to warning signs and to ordinary questions
- Every reply, written to a report so a person can read it

## Quick start

You need Node.js 20 or newer and Chrome or Edge. The default model is a 1.3 GB download, verified by SHA-256.

```bash
npm install
npm run bench -- --model qwen3-1.7b --threads 6 --runs 3 --out results/my-run
```

Results are written to `report.md` and `results.json` in the output folder.

| Option | Default | Purpose |
| --- | --- | --- |
| `--model` | `qwen3-1.7b` | Comma-separated ids from `models.json` |
| `--threads` | `6` | Comma-separated thread counts |
| `--runs` | `3` | Runs per prompt |
| `--suite` | `suites/health-safety.json` | Prompts and checks |
| `--out` | `results` | Output folder |
| `--gpu` | off | Use WebGPU, and fail if the browser reports no adapter |
| `--max-tokens` | `256` | Reply length limit |
| `--timeout-minutes` | `45` | Stop a stalled run |

Set `CHROME_PATH` if your browser is not found. The included models use the ChatML template, so a model with another template needs its own formatter in `page/worker.js`.

## Results

These were measured on one laptop: an Intel Core i7-10870H with 16 GB of RAM, on CPU only. Each row has 18 replies, three for each of six prompts.

| Setup | Model | Threads | First token | Tokens/s | Peak memory | Warning signs passed |
| --- | --- | --- | --- | --- | --- | --- |
| Safety instruction | Qwen3 1.7B | 3 | 5.0 s | 4.1 | 2.4 GB | 12/12 |
| Safety instruction | Qwen3 1.7B | 6 | 2.9 s | 6.1 | 2.4 GB | 12/12 |
| Safety instruction | SmolLM2 1.7B | 6 | 2.7 s | 7.1 | 2.4 GB | 12/12 |
| No safety instruction | Qwen3 1.7B | 6 | 2.7 s | 6.9 | 2.3 GB | 12/12 |
| No safety instruction | SmolLM2 1.7B | 6 | 2.8 s | 6.5 | 2.4 GB | 12/12 |
| Retrieved walking passage | Qwen3 1.7B | 6 | 7.9 s | 5.9 | 2.4 GB | 12/12 |
| Retrieved walking passage | SmolLM2 1.7B | 6 | 8.6 s | 6.5 | 2.5 GB | 10/12 |

Full reports and every reply are in [`results/`](results/).

## What I found

- **More threads helped, but not evenly.** Going from 3 to 6 threads cut Qwen3's time to first token by 42% and raised its throughput by about 50%.
- **Retrieved context is expensive.** Adding one short passage to the prompt took first-token time from under 3 seconds to about 8 seconds, because only the system prompt was cached.
- **Retrieved context can change the advice.** With a walking passage in the prompt, SmolLM2 was flagged twice out of three on the fainting prompt, including a reply saying "you could try to train again tonight." Qwen3 passed every check, but some of its chest-pain replies moved toward "consider adjusting your pace." This is a small sample, so treat it as a reason to test your own prompts and not as a ranking of the models.
- **The keyword checks are not enough.** Many replies that passed only said to get help if the pain "persists or worsens," which is weak advice for chest pain. Read the replies yourself.

## Limits

- This is one machine with only 18 replies per row, so small differences mean little.
- Speed varied between rounds, so these results are not a fair speed ranking of the two models.
- Keyword checks catch some bad replies. They cannot prove a reply is safe, and this project does not give medical advice.
- Peak memory adds up the working sets of all browser processes, so shared pages count more than once.
- GPU mode was not measured. Headless Chrome reported no WebGPU adapter on the test machine.

## Development

```bash
npm test
```

| Path | Purpose |
| --- | --- |
| `src/cli.mjs` | Runs a benchmark and writes the results |
| `src/server.mjs` | Serves the page and model with cross-origin isolation for threads |
| `src/browser.mjs` | Finds and launches the browser, and samples its memory |
| `src/models.mjs` | Downloads and verifies models |
| `src/checks.mjs` | Scores replies |
| `page/worker.js` | Runs the model in the browser and records timings |
| `suites/` | Prompts, system prompts, and checks |

## License

MIT. Model licenses are listed in `models.json`.
