# llama-harness

A self-contained workspace for running open-weight LLMs locally on Apple Silicon
and driving them from [opencode](https://opencode.ai), with llama.cpp as the only
inference path.

It does four things:

1. **Installs** curated GGUF models, verified by checksum rather than trusted.
2. **Serves** them through a single llama.cpp router that swaps models on demand.
3. **Wires** opencode to whichever model you picked, so you just `cd` and work.
4. **Benchmarks** them objectively — by executing the code they generate.

Everything it downloads, builds or generates lives under one gitignored `.data/`
directory. Delete that directory and the workspace is back to a clean checkout.

---

## Quickstart

```bash
./setup.sh
```

That single command is interactive and handles everything: missing dependencies,
the llama.cpp submodule, building the tools, picking models, downloading and
validating them, and writing the configs.

Then start working:

```bash
scripts/serve.py       # pick a model, land in a ready shell
cd ~/your/project
opencode               # already pointed at the served model
```

Type `exit` in that shell to stop the model. That's the whole loop.

> Requires Python 3.9+ (macOS ships this), plus `git`, `cmake` and `ninja`.
> `setup.sh` offers to install anything missing, including the optional
> [`rich`](https://rich.readthedocs.io) package for live progress bars and
> colour-coded benchmark tables (`pip3 install --user rich`). Everything works
> without it — output falls back to aligned plain text.

---

## How it works

```
                    ┌────────────────────────────────────┐
   opencode ───────►│  llama-server  (router mode)       │
   (any workspace)  │    ├── ornith-35b     [loaded]     │
                    │    ├── qwen3-coder-30b             │
                    │    └── gemma-4-31b                 │
                    └────────────────────────────────────┘
                              reads .data/configs/llama-models.ini
```

**One server, many models.** Rather than a process per model, a single
`llama-server` runs in *router mode*. It publishes every installed model at
`/v1/models` and loads or unloads weights on demand as requests arrive. Because
`--models-max` defaults to `1`, switching models transparently evicts the
previous one — which matters when a single model can occupy 30 GB of a 64 GB
machine.

**opencode talks to exactly one endpoint.** The generated `opencode.json` defines
a provider using `@ai-sdk/openai-compatible` pointed at that router, so llama.cpp
is the only path between opencode and any model. No cloud provider is involved
and no API key is required.

**`serve.py` ties it together.** It starts the server, writes a session-scoped
opencode config whose default model is the one you picked, and drops you into an
interactive bash subshell with `OPENCODE_CONFIG` already exported. The model
lives exactly as long as that shell.

### Repository layout

```
setup.sh                guided first-time install
scripts/
  serve.py              start a model + a ready-to-use shell
  fetch_models.py       download / validate / configure / build
  models_catalog.py     the model catalog — edit to add models
  benchmark.py          the benchmark runner
  bench_presets.py      presets and task suites
  hostinfo.py           measured host profile
  README.md             deep reference for all of the above
src/main.cpp            minimal C++ llama.cpp chat client
extern/llama-cpp        pinned llama.cpp submodule

.data/                  everything generated (the only gitignored dir)
  models/<id>/            weights + .manifest.json
  tools/                  llama-* binaries built from the pinned submodule
  configs/                opencode.json, llama-models.ini, benchmark.json
  benchmark/              results + report.md
  scripts/                generated helpers
```

---

## Choosing a model

```bash
scripts/fetch_models.py list
```

```
Host  64 GiB RAM  |  usable for weights: 52 GB (macOS default (75% of RAM))  |  comfortable: 42 GB

Coding & agentic software engineering (primary focus)
  ornith-35b             Ornith 1.0 35B (MoE)                  26.5 GB  fits
  ornith-9b              Ornith 1.0 9B (dense)                  9.5 GB  fits
  qwen3-coder-next       Qwen3-Coder-Next 80B-A3B              48.0 GB  tight
  qwen3-coder-30b        Qwen3-Coder 30B-A3B Instruct          25.1 GB  fits
  kat-coder-v2.5         KAT-Coder V2.5 Dev                    30.1 GB  fits
  ...
```

The catalog holds **24 models across five categories**. Sizes are measured from
the HuggingFace file tree, not estimated.

| category | good starting point | why |
|---|---|---|
| coding | `ornith-35b` | MIT, SOTA agentic coding for its size |
| coding (fast) | `qwen3-coder-30b` | 3B active params, very fast |
| general | `qwen3.6-27b` | strong reasoning, also multimodal |
| writing / docs | `gemma-4-26b-a4b` | best local prose, MoE speed |
| vision | `qwen3-vl-30b` | reads mockups and screenshots |
| embeddings | `embeddinggemma-300m` | tiny, for retrieval |

**On sizing.** macOS caps Metal at ~75% of RAM, so a 64 GiB machine has about
52 GB for weights, and KV cache sits on top of that. `fits` means weights plus
headroom are comfortable; `tight` means it loads but you should reduce context.
To go higher:

```bash
sudo sysctl iogpu.wired_limit_mb=57344   # 56 GB, resets on reboot
```

`list` reads that sysctl and recalculates automatically.

See [`scripts/README.md`](scripts/README.md) for the full catalog with every
quant, license and note.

---

## Everyday commands

```bash
# models
scripts/fetch_models.py list --long              # full detail per model
scripts/fetch_models.py info ornith-35b --remote # live quant listing from HF
scripts/fetch_models.py install ornith-35b       # download + validate + configure
scripts/fetch_models.py install --category coding
scripts/fetch_models.py install gemma-4-31b --with-mmproj   # vision projector
scripts/fetch_models.py verify                   # re-check every installed model
scripts/fetch_models.py remove ornith-9b
scripts/fetch_models.py status                   # what is installed and configured

# serving
scripts/serve.py                                 # numbered picker
scripts/serve.py ornith-35b                      # skip the picker
scripts/serve.py --fresh                         # ignore saved settings
scripts/serve.py --no-shell                      # plain foreground server

# tools
scripts/fetch_models.py build                    # build llama-* from the submodule
scripts/fetch_models.py config --models-max 2    # regenerate configs
```

Inside a `serve.py` session shell, the prompt is prefixed with the model name and
two helpers are available: `llama_status` (what the router is serving) and
`llama_log` (tail the server log).

### Downloads are verified, not trusted

Every install checks, in order: exact byte size, **SHA-256 against the LFS oid
published by HuggingFace**, GGUF magic and version, and shard-count consistency
read from the GGUF metadata itself. Architecture and tensor count are recorded in
`.data/models/<id>/.manifest.json`.

Downloads resume at 32 MB granularity — interrupt an install and re-run it.

### Tools stay in lockstep with the submodule

`scripts/fetch_models.py build` compiles nine binaries (`llama-server`,
`llama-bench`, `llama-perplexity`, `llama-cli`, `llama-mtmd-cli`, `llama-tts`,
`llama-batched-bench`, `llama-tokenize`, `llama-quantize`) into `.data/tools/`,
recording the submodule commit they came from. Every `serve` and `benchmark` run
re-checks that stamp and rebuilds if the submodule moved, so the tools can never
silently drift from the pinned llama.cpp.

---

## Advanced: benchmarking

Serving is only half of it. The benchmark answers two questions the model cards
cannot: *how fast is this model on this machine*, and *is its output actually
correct*.

```bash
scripts/benchmark.py --dry-run     # plan + time estimate, runs nothing
scripts/benchmark.py               # every enabled model
scripts/benchmark.py --model ornith-35b
scripts/benchmark.py --resume      # skip completed cells
scripts/benchmark.py --report-only # rebuild the report from existing results
```

Always start with `--dry-run` — a full sweep is hours, and it tells you the cost
before you commit:

```
Plan
  ornith-9b              coding     task=merge-ranges       10 presets in 6 load group(s)

  10 runs total, rough estimate 13-52 minutes
  (dominated by model loads; large models push the upper bound)
```

Everything else is configured in `.data/configs/benchmark.json`, regenerated by
`fetch_models.py config` so it always matches what is installed. Set
`enabled: false` to skip a model, or trim `presets` to shorten a run.

### Presets, not parameter sweeps

A cross-product of sampling values mostly produces noise. Instead there are ten
named presets, each answering one question, drawn from what model authors publish
and what the Apple-Silicon community has settled on:

| preset | question it answers |
|---|---|
| `author-default` | the author's own published settings — the control |
| `deterministic` | greedy decoding, the standard for code |
| `metal-throughput` | flash-attn on + large ubatch — peak tok/s |
| `flash-attn-off` | what is flash attention actually worth here? |
| `kv-q8` | is the "8-bit KV is free" consensus true on real output? |
| `kv-q4` | how much quality does a 4-bit KV cache actually cost? |
| `long-context` | 4× context + q8 KV — degradation as context grows |
| `balanced-chat` | temp 0.7 / top-p 0.8 — general-purpose middle ground |
| `min-p` | does min-p beat top-p at equal diversity? |
| `high-creative` | temp 1.0 / top-p 0.95 — helps prose, hurts code |

Presets split into **runtime** flags (fixed at load time — changing one forces a
model reload) and **sampling** flags (per request, free). The runner groups by
runtime signature so each distinct config is loaded exactly once and all its
sampling variants run against that single load. On a 30 GB model this is the
difference between minutes and hours.

### Scoring: three tiers, only one of them trustworthy

1. **Objective.** Generated code is *executed* against hidden tests. Docs are
   checked against symbols parsed from the source. Retrieval is recall@1.
2. **Perplexity**, via `llama-perplexity` — objectively measures how much a
   given quant or KV-cache config degrades the model. No judge involved.
3. **Self-graded.** The model scores **its own** output. This is *not* an
   independent quality measure and is never mixed into the objective score.

The interesting number is **calibration**: `self_score − objective`. Positive
means the model over-rated itself; near zero means it can tell when it is wrong.

Tasks are shared per category so models compete on identical work — the coding
task is deliberately not a LeetCode classic, since those are memorized verbatim
from training data and measure recall rather than ability.

### Example results

Results land in `.data/benchmark/<model>/<preset>/` (`result.json`,
`output.txt`, `reasoning.txt`) with an aggregate `report.md`:

```
### `ornith-9b`

| preset | objective | gen tok/s | prompt tok/s | wall s | SELF-graded | calibration |
|---|--:|--:|--:|--:|--:|--:|
| `deterministic` | 100% (12/12) | 68.0 | 614.7 | 22.8 | 100 | +0 |

Perplexity (lower is better):

| preset | perplexity |
|---|--:|
| `deterministic` | 2.4399 |
```

Read that as: all 12 hidden tests passed, 68 tokens/sec generation on this
machine, and the model rated itself 100 — perfectly calibrated, since it was in
fact correct.

The report also records the **measured** host profile — memory bandwidth, disk
read, CPU throughput, GPU cores, Metal budget — plus power source and thermal
state **before and after** the run, so a thermally throttled run says so rather
than quietly skewing the numbers.

### Benchmarking more models than fit on disk

```jsonc
"eviction": { "download_missing": true, "delete_after_each": true }
```

Each model is fetched, benchmarked, then deleted before the next. The whole
catalog can be benchmarked on a machine that could never hold it at once, and
`--resume` lets an interrupted overnight run continue where it stopped.

### What cannot be benchmarked

- **Music / beat generation** — nothing exists. llama.cpp has no music
  architecture. Speech synthesis *is* supported (`qwen3tts`), which the audio
  task uses.
- **Image generation** — llama.cpp cannot generate images. FLUX, SD3.5 and
  Qwen-Image ship GGUF weights but run in `stable-diffusion.cpp`, a separate
  engine. Vision models here are scored on *interpretation* instead.

Both appear in the report as explicitly not benchmarked, rather than silently
omitted.

---

## Building the C++ client

The repo also builds a minimal native llama.cpp chat client from `src/main.cpp`,
independent of the Python tooling:

```bash
cmake -B .out -S . -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build .out
.out/myprogram -m .data/models/ornith-9b/*.gguf -c 4096 -ngl 99
```

This is the starting point for the eventual custom harness — enforced TDD,
adversarial review after each change, workspace lockdown — rather than a
finished tool.

---

## Troubleshooting

| symptom | fix |
|---|---|
| `llama-server not found` | `scripts/fetch_models.py build` |
| model fails to load / OOM | it is `tight` — lower `ctx-size`, or raise `iogpu.wired_limit_mb` |
| `sha256 mismatch` on verify | `scripts/fetch_models.py install <id> --force` |
| gated repo (401/403) | accept the terms on the model page, then `export HF_TOKEN=...` |
| port already in use | `serve.py` detects this and offers the next free port |
| opencode sees no models | `scripts/fetch_models.py config`, then re-run `serve.py` |
| benchmark scores 0% | check `truncated` in `result.json` — a reasoning model may have run out of token budget rather than been wrong |

Useful environment variables: `HF_TOKEN`, `HF_ENDPOINT` (mirror),
`LLAMA_SERVER` (explicit binary path), `NO_COLOR`.

---

## Further reading

[`scripts/README.md`](scripts/README.md) is the full reference: the complete
24-model catalog with quants and licenses, VRAM sizing in detail, every CLI flag,
the validation and benchmark internals, and how to add your own models, presets
or tasks.

## License

MIT — see [LICENSE](LICENSE). Individual models carry their own licenses, listed
per model in the catalog; several are Apache-2.0 or MIT, but Gemma models are
under the Gemma Terms of Use and a few are vendor-specific.
