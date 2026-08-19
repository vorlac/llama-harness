# Local model harness

`fetch_models.py` downloads, assembles and validates open-weight GGUF models,
then wires every installed model into opencode through a single llama.cpp
router server.

Standard library only — Python 3.9+, no virtualenv required.

The one optional extra is [`rich`](https://rich.readthedocs.io), which upgrades
the benchmark's output to live progress bars and colour-coded tables. Without it
everything still runs and prints aligned plain text:

```bash
pip3 install --user rich
```

`setup.sh` offers to install it.

```
setup.sh              guided first-time install (bash)
scripts/
  serve.py            start a model + a ready-to-use shell
  fetch_models.py     download / validate / configure
  models_catalog.py   the model catalog (edit this to add models)
  benchmark.py        the benchmark runner
  bench_presets.py    presets + task suites (edit to add either)
  hostinfo.py         measured host profile
.data/                everything generated       (the only gitignored dir)
  models/<id>/          weights + .manifest.json
  tools/                llama-* binaries built from the pinned submodule
  scripts/              generated helpers (launch.sh)
  configs/              opencode.json, llama-models.ini, benchmark.json,
                        serve-session.json (remembered serve settings)
  benchmark/            results + report.md
```

`.data/` is entirely disposable: delete it and re-run `install` to rebuild.

---

## Quick start

```bash
scripts/fetch_models.py list                 # catalog + what fits this machine
scripts/fetch_models.py install ornith-35b   # download, validate, reconfigure
scripts/fetch_models.py build                # build llama-* from the submodule
scripts/fetch_models.py serve                # start the llama.cpp router
```

Then, in another shell:

```bash
OPENCODE_CONFIG=$PWD/.data/configs/opencode.json opencode
```

Every installed model shows up in opencode's model picker. Switching models in
the TUI transparently swaps which weights are resident.

---

## How serving works

`scripts/serve.py` is the normal entry point; the detail below is what it sets
up for you.

All models are served by **one** `llama-server` process in *router mode*:

```
llama-server --models-preset .data/configs/llama-models.ini --models-max 1 --models-autoload
```

The router reads the generated INI, publishes every model at `/v1/models`, and
loads/unloads weights on demand as requests come in. `--models-max 1` means only
one model is resident at a time — essential when a single model can occupy 30 GB+
of a 64 GB machine. Raise it only for combinations that genuinely fit side by
side (e.g. a 12 GB coder plus a 0.3 GB embedder):

```bash
scripts/fetch_models.py config --models-max 2
```

`.data/configs/opencode.json` talks to that one endpoint via
`@ai-sdk/openai-compatible`, so llama.cpp is the only path between opencode and
any model.

---

## Sizing: what actually fits in 64 GB

This is an **Apple M4 Max with 64 GiB (68.7 GB) of unified memory**. Two things
make the usable number smaller than the sticker number:

1. **macOS caps Metal at ~75% of RAM** by default → about **52 GB** for weights.
2. **KV cache and compute buffers** are on top of the weights, and grow with
   context length. The tool reserves ~18% as headroom and calls the remainder
   *comfortable*.

So the practical tiers are:

| label | meaning |
|---|---|
| `fits` | weights + headroom fit inside the Metal budget |
| `tight` | weights fit, but headroom is thin — reduce `ctx-size`, or raise the wired limit |
| `too big` | will not load |

To use more than the default 75%, raise the wired limit (resets on reboot):

```bash
sudo sysctl iogpu.wired_limit_mb=57344   # 56 GB
```

`fetch_models.py list` reads that sysctl and recalculates automatically. This is
what makes `qwen3-coder-next` (48 GB) viable.

Sizes throughout are **decimal GB**, matching HuggingFace. 64 GiB = 68.7 GB.

---

## Model catalog

⚠️ = experimental: exotic quant formats or very new architectures that may need a
newer llama.cpp than the pinned submodule. Excluded from `--all` and `--category`.

### Coding & agentic software engineering (primary focus)

| id | model | params | default quant | size | fit | license | caps |
|---|---|---|---|--:|---|---|---|
| `ornith-35b` | Ornith 1.0 35B (MoE) | 35B MoE | `UD-Q5_K_M` | 26.5 GB | fits | MIT | tools, reasoning, vision |
| `ornith-35b-official` | Ornith 1.0 35B (first-party GGUF) | 35B MoE | `Q5_K_M` | 24.7 GB | fits | MIT | tools, reasoning |
| `ornith-9b` | Ornith 1.0 9B (dense) | 9B | `Q8_0` | 9.5 GB | fits | MIT | tools, reasoning |
| `qwen3-coder-next` | Qwen3-Coder-Next 80B-A3B | 80B MoE / 3B active | `MXFP4_MOE` | 48.0 GB | **tight** | Apache-2.0 | tools |
| `qwen3-coder-30b` | Qwen3-Coder 30B-A3B Instruct | 30B MoE / 3B active | `Q6_K` | 25.1 GB | fits | Apache-2.0 | tools |
| `kat-coder-v2.5` | KAT-Coder V2.5 Dev | ~32B | `Q6_K` | 30.1 GB | fits | Custom (Kwaipilot) | tools |
| `devstral-small-2` | Devstral Small 2 24B | 24B | `Q8_0` | 25.1 GB | fits | Apache-2.0 | tools, vision |
| `qwen2.5-coder-32b` | Qwen2.5-Coder 32B Instruct | 32B | `q6_k` | 26.9 GB | fits | Apache-2.0 | tools |
| `gpt-oss-20b` | gpt-oss 20B | 21B MoE / 3.6B active | `Q8_0` | 12.1 GB | fits | Apache-2.0 | tools, reasoning |
| `laguna-s-2.1` ⚠️ | Laguna-S 2.1 (poolside) | Large MoE | `UD-IQ3_XXS` | 44.3 GB | **tight** | Custom (poolside) | tools |

**Where to start.** `ornith-35b` is the strongest all-round agentic coder that
fits comfortably — MIT licensed, SOTA for its size on Terminal-Bench 2.1 and
SWE-Bench. `qwen3-coder-30b` is the fast daily driver (3B active params).
`ornith-9b` and `gpt-oss-20b` are quick enough for tight edit/test loops.

`qwen3-coder-next` is the most capable coder here but needs the raised wired
limit; `laguna-s-2.1` only fits at sub-4-bit, which materially degrades it.

For the adversarial-review workflow you described, pair models from *different
families* — e.g. `ornith-35b` writing and `kat-coder-v2.5` or `qwen3.6-27b`
reviewing. Two checkpoints from the same family tend to share blind spots.

### General reasoning, analysis & instruction following

| id | model | params | default quant | size | fit | license | caps |
|---|---|---|---|--:|---|---|---|
| `qwen3.6-27b` | Qwen3.6 27B (dense) | 27B | `Q6_K` | 22.5 GB | fits | Apache-2.0 | tools, reasoning, vision |
| `qwen3.6-35b-a3b` | Qwen3.6 35B-A3B (MoE) | 35B MoE / 3B active | `UD-Q5_K_M` | 26.5 GB | fits | Apache-2.0 | tools, reasoning, vision |
| `qwen3.5-35b-a3b` | Qwen3.5 35B-A3B (MoE) | 35B MoE / 3B active | `Q6_K` | 28.9 GB | fits | Apache-2.0 | tools, reasoning, vision |
| `olmo-3.1-32b-think` | Olmo 3.1 32B Think | 32B | `Q6_K` | 26.4 GB | fits | Apache-2.0 | tools, reasoning |

`olmo-3.1-32b-think` is the only model here with fully auditable provenance —
open weights, data *and* training code.

### Prose, documentation & long-form writing

| id | model | params | default quant | size | fit | license | caps |
|---|---|---|---|--:|---|---|---|
| `gemma-4-31b` | Gemma 4 31B Instruct | 31B | `Q8_0` | 32.6 GB | fits | Gemma Terms of Use | tools, vision |
| `gemma-4-26b-a4b` | Gemma 4 26B-A4B (MoE) | 26B MoE / 4B active | `Q8_0` | 26.9 GB | fits | Gemma Terms of Use | tools, vision |
| `gemma-4-12b` | Gemma 4 12B Instruct | 12B | `Q8_0` | 12.7 GB | fits | Gemma Terms of Use | tools, vision |

**A note on the writing category.** These are general models chosen for prose
quality, not "creative writing" finetunes. The finetune scene for writing is
dominated by unaudited community merges with unclear provenance and licensing,
which is a poor fit for a reproducible setup. The Gemma line is the strongest
local option for natural prose — READMEs, design docs, commit messages.
`gemma-4-26b-a4b` gives near-31B quality at 4B-active speed.

### Vision / multimodal — image understanding & art critique

| id | model | params | default quant | size | fit | license | caps |
|---|---|---|---|--:|---|---|---|
| `qwen3-vl-30b` | Qwen3-VL 30B-A3B Instruct | 30B MoE / 3B active | `Q8_0` | 32.5 GB | fits | Apache-2.0 | tools, vision |
| `nemotron-3-nano-omni` | Nemotron 3 Nano Omni 30B-A3B | 30B MoE / 3B active | `Q6_K` | 33.5 GB | fits | NVIDIA Open Model License | tools, reasoning, vision |
| `ternary-bonsai-27b` ⚠️ | Ternary Bonsai 27B | 27B (ternary weights) | `Q2_0` | 7.2 GB | fits | Check model card | tools, vision |

**These understand images; they do not generate them.** llama.cpp is a text/LLM
runtime — image *generation* is a different stack (`stable-diffusion.cpp`,
ComfyUI) and is out of scope for this script. What these give you is critique and
analysis: reading design mockups and UI screenshots, describing composition,
writing and refining prompts for an external image generator.

Vision requires a projector: add `--with-mmproj`.

```bash
scripts/fetch_models.py install qwen3-vl-30b --with-mmproj
```

Without it the model loads as text-only, and the generated `opencode.json`
honestly reports `attachment: false` for it.

`ternary-bonsai-27b` is natively ternary-trained — a 27B multimodal model in
7.2 GB, which is a genuinely different thing from a 27B crushed to 2 bits. It
uses non-standard quant types (`Q2_0`/`PQ2_0`); verify llama.cpp support before
relying on it.

### Embeddings & rerankers

| id | model | params | default quant | size | fit | license | caps |
|---|---|---|---|--:|---|---|---|
| `qwen3-embedding-8b` | Qwen3 Embedding 8B | 8B | `Q8_0` | 8.1 GB | fits | Apache-2.0 | embed |
| `qwen3-embedding-0.6b` | Qwen3 Embedding 0.6B | 0.6B | `f16` | 1.2 GB | fits | Apache-2.0 | embed |
| `embeddinggemma-300m` | EmbeddingGemma 300M | 300M | `Q8_0` | 0.3 GB | fits | Gemma Terms of Use | embed |
| `qwen3-reranker-0.6b` | Qwen3 Reranker 0.6B | 0.6B | `q8_0` | 0.6 GB | fits | Apache-2.0 | rerank |

These are served by the router but deliberately **not** offered as opencode agent
models — they are not chat models. They are here for the retrieval side of the
harness you plan to build.

---

## Commands

```
list      show the catalog and what fits        --long for full detail
info      detail for one model                  --remote for live HF listing
install   download + validate + reconfigure
verify    re-validate installed models
remove    delete installed models
status    what is installed and configured
config    regenerate .data/configs/ only
serve     launch the llama.cpp router
```

### Selecting models

```bash
scripts/fetch_models.py install ornith-35b qwen3-coder-30b   # explicit ids
scripts/fetch_models.py install --category coding            # a whole category
scripts/fetch_models.py install --all                        # everything non-experimental
```

### Useful flags

| flag | effect |
|---|---|
| `--quant Q` | override the default quant (single model only) |
| `--with-mmproj` | also fetch the vision projector |
| `-j N` | parallel range connections per file (default 8) |
| `--no-hash-check` | skip SHA-256 (faster, weaker) |
| `--force` | redownload even if already validated |
| `--vram-budget GB` | override the detected budget |
| `--port` / `--host` | where the router listens |
| `--serve-ctx N` | override served context for every model |
| `-y` | skip the confirmation prompt |

### Environment

| var | purpose |
|---|---|
| `HF_TOKEN` | token for gated repos |
| `HF_ENDPOINT` | mirror instead of `https://huggingface.co` |
| `LLAMA_SERVER` | explicit path to the `llama-server` binary |

---

## What "validate" actually checks

Downloads are not trusted. Every install verifies, in order:

1. **Exact byte size** against the HuggingFace file tree.
2. **SHA-256** against the LFS `oid` published by HuggingFace — the authoritative
   content hash, not a size heuristic.
3. **GGUF magic and version**, by parsing the header.
4. **Shard-count consistency** — the `split.count` field inside the GGUF metadata
   must match the number of files actually downloaded.

Architecture, tensor count and context length are read out of the GGUF metadata
and recorded in `.data/models/<id>/.manifest.json` alongside the file hashes.

Downloads are resumable at 32 MB chunk granularity. Interrupt an install at any
point and re-run it — completed chunks are tracked in a sidecar and skipped.

Re-check everything at any time:

```bash
scripts/fetch_models.py verify
```

---

## Tools: always built, always current

`scripts/fetch_models.py build` compiles every binary the harness needs from
`extern/llama-cpp` into `.data/tools/`:

`llama-server` `llama-bench` `llama-perplexity` `llama-cli` `llama-mtmd-cli`
`llama-tts` `llama-batched-bench` `llama-tokenize` `llama-quantize`

The build records the submodule commit it came from in
`.data/tools/.build-stamp.json`. Every `serve` and every `benchmark` run
re-checks that stamp against `git -C extern/llama-cpp rev-parse HEAD` and
rebuilds automatically if the submodule has moved or the cmake flags changed, so
the tools can never silently drift from the pinned llama.cpp.

```bash
scripts/fetch_models.py build            # build if stale (a no-op when current)
scripts/fetch_models.py build --force    # rebuild unconditionally
scripts/fetch_models.py status           # shows the tool state
```

---

## Benchmarking

Install `rich` first for live progress and colour-coded tables (optional):

```bash
pip3 install --user rich
```

```bash
scripts/benchmark.py --dry-run     # plan + time estimate, runs nothing
scripts/benchmark.py               # every enabled model
scripts/benchmark.py --model ornith-35b
scripts/benchmark.py --resume      # skip completed cells
scripts/benchmark.py --report-only # rebuild the report from existing results
```

Everything else is configured in `.data/configs/benchmark.json`, regenerated by
`fetch_models.py config` so it always lists exactly what is installed. Set
`enabled: false` to skip a model; trim `presets` to shorten a run.

### Presets, not parameter sweeps

A cross-product of sampling values mostly produces noise. Instead there are ten
named presets, each answering one question, drawn from what model authors publish
and what the Apple-Silicon community has settled on:

| preset | question it answers |
|---|---|
| `author-default` | the model author's own published settings — the control |
| `deterministic` | greedy decoding, the standard for code and reproducibility |
| `metal-throughput` | flash-attn on + large ubatch — peak tok/s on M-series |
| `flash-attn-off` | what is flash attention actually worth here? |
| `kv-q8` | is the "8-bit KV is free" consensus true on real output? |
| `kv-q4` | how much quality does a 4-bit KV cache actually cost? |
| `long-context` | 4x context + q8 KV — degradation as context grows |
| `balanced-chat` | temp 0.7 / top-p 0.8 — the general-purpose middle ground |
| `min-p` | does min-p beat top-p for coherence at equal diversity? |
| `high-creative` | temp 1.0 / top-p 0.95 — helps prose, expected to hurt code |

Presets split into **runtime** flags (fixed at load time — changing one forces a
model reload) and **sampling** flags (per request, free). The runner groups by
runtime signature so each distinct runtime config is loaded exactly once and all
its sampling variants run against that single load. Generation goes through
`llama-server`'s HTTP API rather than `llama-cli`, which would reload the model
for every single run.

### Tasks

One shared task per category, so models within a category compete on identical
work. Add or edit them in `bench_presets.py`.

| category | task | scoring |
|---|---|---|
| coding | merge overlapping integer ranges | **executed** against 12 hidden tests |
| general | fix a subtly broken `median()` | **executed** against 6 hidden tests |
| writing | document a `RateLimiter` class | symbol coverage parsed from the source |
| vision | describe + critique a generated bar chart | self-judge only |
| utility | retrieval over a fixed probe set | recall@1 |
| audio | TTS render | needs a `qwen3tts`/OuteTTS model |

The coding problem is deliberately not a LeetCode classic — those are memorized
verbatim from training data, which measures recall rather than coding ability.

### Scoring tiers

1. **Objective** — generated code is *executed* against hidden tests; docs are
   checked against symbols parsed from the source; retrieval is recall@1. This is
   the only column to trust.
2. **Perplexity** — via `llama-perplexity`, objectively measuring how much a
   given quant / KV-cache config degrades the model. No judge involved.
3. **SELF-graded** — the model scoring **its own** output. This is *not* an
   independent quality measure and is never mixed into the objective score. Every
   surface labels it as self-graded.

The interesting number is **calibration**: `self_score − objective`. Positive
means the model over-rated itself; near zero means it can tell when it is wrong.

### Running more models than fit on disk

```jsonc
"eviction": { "delete_after_each": true }
```

Each model is benchmarked, then deleted before the next one, so a sweep can
cover more of the catalog than fits on disk at once. The plan is built from the
models installed under `.data/models/` when the sweep starts: install a batch,
run with eviction on, install the next batch, and continue with `--resume`,
which makes an interrupted multi-hour run pick up where it stopped.

### Host profile

Every run records the machine, measured rather than merely named: memory copy
bandwidth, disk sequential read, single-thread CPU throughput, GPU core count,
and the Metal wired limit. It also captures power source, low-power mode and
thermal pressure **before and after** the run — if the machine throttled partway
through, the report says so instead of quietly skewing the numbers.

Memory bandwidth is measured by [`tools/membench`](../tools/membench), which
`hostinfo.py` builds on demand. It reports both a single-threaded copy and the
multi-threaded peak. Both are CPU-side ceilings and still sit below the chip's
spec sheet, because that number assumes the GPU driving every channel at once —
the figure that actually predicts tok/s is the `llama-bench` generation result.

### Categories that cannot be benchmarked

- **music / beat generation** — nothing exists. llama.cpp has no music
  architecture, and the MusicGen GGUF repos target other runtimes. Speech
  synthesis *is* supported (`qwen3tts`, `wavtokenizer-dec`), which is what the
  audio task uses.
- **image generation** — llama.cpp cannot generate images. FLUX.1/FLUX.2, SD3.5
  and Qwen-Image all ship GGUF weights but run in `stable-diffusion.cpp`, a
  separate engine. Adding it as a second submodule would make this category real;
  until then vision models are scored on interpretation.

Both are listed in the report as explicitly not benchmarked, rather than silently
omitted.

---

## Adding a model

Append a `Model` to `CATALOG` in `models_catalog.py`. Quant sizes are only used
for the offline `list` view — the real file list is resolved live at download
time, so you never hard-code filenames. Check your entry with:

```bash
scripts/fetch_models.py info <id> --remote
```

which prints every quant token the repo actually publishes, with real sizes.
