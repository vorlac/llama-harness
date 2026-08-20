# Local model harness

`fetch_models.py` downloads, assembles and validates open-weight GGUF models,
then wires every installed model into opencode through a single llama.cpp
router server.

Standard library only — Python 3.9+, no virtualenv required. The repository's test gate
pins the system interpreter, `/usr/bin/python3`, so no `.py` file here may depend on a
Homebrew or pyenv Python. The one exception is outside the gate: `watch-agents.sh`, a
developer transcript viewer, invokes `/opt/homebrew/bin/python3` directly.

```bash
/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'
```

That discovers `test_conductor_wiring.py` (the router-wiring functions `serve.py` and
`fetch_models.py` share) and `test_conductor_bench.py` (the three-arm benchmark
driver). Both are pure: they start no server, open no socket and write nothing under
`.data/`. `bash scripts/test-conductor.sh` runs the same command as its final leg.

The one optional extra is [`rich`](https://rich.readthedocs.io), which upgrades
the benchmark's output to live progress bars and colour-coded tables. Without it
everything still runs and prints aligned plain text:

```bash
pip3 install --user rich
```

`setup.sh` offers to install it.

```
setup.sh                    guided first-time install (bash)
scripts/
  serve.py                  start a model + a ready-to-use shell
  fetch_models.py           download / validate / configure
  models_catalog.py         the model catalog (edit this to add models)
  benchmark.py              the model benchmark runner
  bench_presets.py          presets + task suites (edit to add either)
  hostinfo.py               measured host profile
  ui.py                     console output; uses rich when installed
  conductor_wiring.py       pure functions serve.py uses to launch llama-router
  conductor_bench.py        the three-arm conductor benchmark driver
  test_conductor_wiring.py  unit suite for conductor_wiring.py
  test_conductor_bench.py   unit suite for conductor_bench.py
  test-conductor.sh         the canonical test gate
  conductor-gate.sh         mechanical stub/defect scan over tracked sources
  verify-acceptance.sh      the acceptance checklist, as executable rows
  watch-agents.sh           renders a Claude Code subagent transcript
.data/                everything the harness generates       (gitignored)
  models/<id>/          weights + .manifest.json
  tools/                llama-* binaries built from the pinned submodule
  build/                the llama.cpp build tree those binaries come from
  scripts/              generated helpers (launch.sh)
  configs/              opencode.json, llama-models.ini, benchmark.json,
                        serve-session.json (remembered serve settings),
                        opencode.session.json (this session's config),
                        conductor-router.json + router.log (llama-router)
  router/               metrics.jsonl, the router's request ledger
  benchmark/            results + report.md
```

`.data/` is entirely disposable: delete it and re-run `install` to rebuild. It is not
the only ignored directory — `.out/` (the CMake build trees) and
`conductor/node_modules/` are ignored too, and are equally disposable.

`ui.py`, `models_catalog.py`, `bench_presets.py` and `conductor_wiring.py` are imported
modules with no command line of their own. `hostinfo.py` is normally imported too, but
running it directly prints the measured host profile and its JSON. The four shell
scripts belong to the conductor harness rather than the model harness.
`test-conductor.sh` is the canonical gate and `conductor/docs/OPERATIONS.md` records the
verdict it must print; `conductor-gate.sh` and `verify-acceptance.sh` are the stub scan
and the acceptance checklist; `watch-agents.sh` gates nothing — it renders a subagent
transcript.

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

Or do both in one step — `scripts/serve.py` starts the server (and `llama-router`, if
it is built) and drops you into a shell where `OPENCODE_CONFIG` is already set:

```bash
scripts/serve.py                             # pick a model interactively
scripts/serve.py ornith-35b                  # skip the picker
```

Every installed model shows up in opencode's model picker. Switching models in
the TUI transparently swaps which weights are resident.

---

## How serving works

`scripts/serve.py` is the normal entry point; the detail below is what it sets
up for you.

All models are served by **one** `llama-server` process in *router mode* — llama.cpp's
own term for a parent process that spawns a child server per model and proxies to it:

```
llama-server --models-preset .data/configs/llama-models.ini \
    --models-max 1 --models-autoload \
    --host 127.0.0.1 --port 8080 --jinja \
    --parallel 6 --ctx-size 49152
```

The parent reads the generated INI, publishes every model at `/v1/models`, and
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

### Slots and context

`--parallel N` gives llama-server N concurrent request slots, and `--ctx-size` is the
**total** context divided among them — not the per-slot window. Passing `--parallel 6`
without raising `--ctx-size` would silently cut every slot to a sixth of the intended
window, so `serve.py` derives both from one number:

```
slots      = max(1, --max-readers)      # default 6
--parallel = slots
--ctx-size = 8192 * slots               # 49152 at the default
```

`--ctx N` overrides the per-slot window, not the total, so `--ctx 16384 --max-readers 6`
asks for `--ctx-size 98304`. At one slot there is nothing to divide and no `--ctx-size`
is emitted unless `--ctx` asked for one.

### llama-router

`llama-router` is this repository's own C++ proxy (built from `router/`), and it is a
different thing from llama-server's preset router mode. When the binary is present,
`serve.py` starts it in front of llama-server and points opencode at it instead; it
adds per-model admission control, priority queueing and a request ledger, and it
forwards `/v1/*` otherwise untouched. Build it with:

```bash
cmake --preset clang-relwdebinfo
cmake --build .out/build/clang-relwdebinfo --target llama-router
```

The router also needs its config schema, which is generated rather than committed:

```bash
node conductor/tools/export-schemas.ts router/tests/schemas
```

`serve.py` looks for the binary at `$LLAMA_ROUTER`, then under
`.out/build/{clang-relwdebinfo,clang-release,clang-debug}/`, then `.data/tools/`, then
on `$PATH`. With no binary, or no schema, the session talks to llama-server directly and
says which of the two is missing; `--router` turns that quiet fallback into a refusal
that names the remedy. `--router` cannot be combined with `--no-shell`, because
`--no-shell` leaves no session process to supervise the router.

The router's own config is `.data/configs/conductor-router.json`. `serve.py` refreshes
only the machine-derived keys in it — the listen and upstream addresses, the version,
`admission.maxInflightPerModel` and the ledger path — so every other key survives
regeneration as a hand edit. `--fresh` discards those edits.

### serve.py flags

| flag                       | effect                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| `MODEL` (positional)       | model id, skipping the picker                                         |
| `--fresh`                  | ignore saved settings and ask for everything                          |
| `--host` / `--port`        | llama-server bind address                                             |
| `--ctx N`                  | per-slot served context override                                      |
| `--models-max N`           | models resident at once (default 1)                                   |
| `--router` / `--no-router` | force the router on (refusing if absent) or off                       |
| `--router-port N`          | router listen port (default 8088)                                     |
| `--max-readers N`          | concurrent sub-sessions; sizes `--parallel` and admission (default 6) |
| `--no-shell`               | run the server in the foreground, open no shell                       |
| `--print-env`              | print the session environment and exit; starts and writes nothing     |
| `--include-utility`        | also offer embedding/reranker models in the picker                    |
| `--no-build-check`         | skip verifying `.data/tools/` against the submodule                   |

A session shell exports `LLAMA_HARNESS_MODEL`, `LLAMA_HARNESS_URL`,
`LLAMA_HARNESS_SERVER_PID`, `LLAMA_HARNESS_ROUTER` (`1`/`0`), and — with the router up
— `LLAMA_HARNESS_ROUTER_URL` and `LLAMA_HARNESS_ROUTER_CONFIG`, alongside
`OPENCODE_CONFIG`.

---

## Sizing: what actually fits in 64 GB

This is an **Apple M4 Max with 64 GiB (68.7 GB) of unified memory**. Two things
make the usable number smaller than the sticker number:

1. **macOS caps Metal at ~75% of RAM** by default → about **52 GB** for weights.
2. **KV cache and compute buffers** are on top of the weights, and grow with
   context length. The tool reserves 18% as headroom — never less than 6 GB — and
   calls the remainder *comfortable*.

So the practical tiers are:

| label     | meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `fits`    | weights + headroom fit inside the Metal budget                                  |
| `tight`   | weights fit, but headroom is thin — reduce `ctx-size`, or raise the wired limit |
| `too big` | will not load                                                                   |

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

| id                    | model                             | params                | default quant |    size | fit       | license            | caps                     |
| --------------------- | --------------------------------- | --------------------- | ------------- | ------: | --------- | ------------------ | ------------------------ |
| `ornith-35b`          | Ornith 1.0 35B (MoE)              | 35B MoE               | `UD-Q5_K_M`   | 26.5 GB | fits      | MIT                | tools, reasoning, vision |
| `ornith-35b-official` | Ornith 1.0 35B (first-party GGUF) | 35B MoE               | `Q5_K_M`      | 24.7 GB | fits      | MIT                | tools, reasoning         |
| `ornith-9b`           | Ornith 1.0 9B (dense)             | 9B                    | `Q8_0`        |  9.5 GB | fits      | MIT                | tools, reasoning         |
| `qwen3-coder-next`    | Qwen3-Coder-Next 80B-A3B          | 80B MoE / 3B active   | `MXFP4_MOE`   | 48.0 GB | **tight** | Apache-2.0         | tools                    |
| `qwen3-coder-30b`     | Qwen3-Coder 30B-A3B Instruct      | 30B MoE / 3B active   | `Q6_K`        | 25.1 GB | fits      | Apache-2.0         | tools                    |
| `kat-coder-v2.5`      | KAT-Coder V2.5 Dev                | ~32B                  | `Q6_K`        | 30.1 GB | fits      | Custom (Kwaipilot) | tools                    |
| `devstral-small-2`    | Devstral Small 2 24B              | 24B                   | `Q8_0`        | 25.1 GB | fits      | Apache-2.0         | tools, vision            |
| `qwen2.5-coder-32b`   | Qwen2.5-Coder 32B Instruct        | 32B                   | `q6_k`        | 26.9 GB | fits      | Apache-2.0         | tools                    |
| `gpt-oss-20b`         | gpt-oss 20B                       | 21B MoE / 3.6B active | `Q8_0`        | 12.1 GB | fits      | Apache-2.0         | tools, reasoning         |
| `laguna-s-2.1` ⚠️      | Laguna-S 2.1 (poolside)           | Large MoE             | `UD-IQ3_XXS`  | 44.3 GB | **tight** | Custom (poolside)  | tools                    |

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

| id                   | model                 | params              | default quant |    size | fit  | license    | caps                     |
| -------------------- | --------------------- | ------------------- | ------------- | ------: | ---- | ---------- | ------------------------ |
| `qwen3.6-27b`        | Qwen3.6 27B (dense)   | 27B                 | `Q6_K`        | 22.5 GB | fits | Apache-2.0 | tools, reasoning, vision |
| `qwen3.6-35b-a3b`    | Qwen3.6 35B-A3B (MoE) | 35B MoE / 3B active | `UD-Q5_K_M`   | 26.5 GB | fits | Apache-2.0 | tools, reasoning, vision |
| `qwen3.5-35b-a3b`    | Qwen3.5 35B-A3B (MoE) | 35B MoE / 3B active | `Q6_K`        | 28.9 GB | fits | Apache-2.0 | tools, reasoning, vision |
| `olmo-3.1-32b-think` | Olmo 3.1 32B Think    | 32B                 | `Q6_K`        | 26.4 GB | fits | Apache-2.0 | tools, reasoning         |

`olmo-3.1-32b-think` is the only model here with fully auditable provenance —
open weights, data *and* training code.

### Prose, documentation & long-form writing

| id                | model                 | params              | default quant |    size | fit  | license            | caps          |
| ----------------- | --------------------- | ------------------- | ------------- | ------: | ---- | ------------------ | ------------- |
| `gemma-4-31b`     | Gemma 4 31B Instruct  | 31B                 | `Q8_0`        | 32.6 GB | fits | Gemma Terms of Use | tools, vision |
| `gemma-4-26b-a4b` | Gemma 4 26B-A4B (MoE) | 26B MoE / 4B active | `Q8_0`        | 26.9 GB | fits | Gemma Terms of Use | tools, vision |
| `gemma-4-12b`     | Gemma 4 12B Instruct  | 12B                 | `Q8_0`        | 12.7 GB | fits | Gemma Terms of Use | tools, vision |

**A note on the writing category.** These are general models chosen for prose
quality, not "creative writing" finetunes. The finetune scene for writing is
dominated by unaudited community merges with unclear provenance and licensing,
which is a poor fit for a reproducible setup. The Gemma line is the strongest
local option for natural prose — READMEs, design docs, commit messages.
`gemma-4-26b-a4b` gives near-31B quality at 4B-active speed.

### Vision / multimodal — image understanding & art critique

| id                     | model                        | params                | default quant |    size | fit  | license                   | caps                     |
| ---------------------- | ---------------------------- | --------------------- | ------------- | ------: | ---- | ------------------------- | ------------------------ |
| `qwen3-vl-30b`         | Qwen3-VL 30B-A3B Instruct    | 30B MoE / 3B active   | `Q8_0`        | 32.5 GB | fits | Apache-2.0                | tools, vision            |
| `nemotron-3-nano-omni` | Nemotron 3 Nano Omni 30B-A3B | 30B MoE / 3B active   | `Q6_K`        | 33.5 GB | fits | NVIDIA Open Model License | tools, reasoning, vision |
| `ternary-bonsai-27b` ⚠️ | Ternary Bonsai 27B           | 27B (ternary weights) | `Q2_0`        |  7.2 GB | fits | Check model card          | tools, vision            |

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

| id                     | model                | params | default quant |   size | fit  | license            | caps   |
| ---------------------- | -------------------- | ------ | ------------- | -----: | ---- | ------------------ | ------ |
| `qwen3-embedding-8b`   | Qwen3 Embedding 8B   | 8B     | `Q8_0`        | 8.1 GB | fits | Apache-2.0         | embed  |
| `qwen3-embedding-0.6b` | Qwen3 Embedding 0.6B | 0.6B   | `f16`         | 1.2 GB | fits | Apache-2.0         | embed  |
| `embeddinggemma-300m`  | EmbeddingGemma 300M  | 300M   | `Q8_0`        | 0.3 GB | fits | Gemma Terms of Use | embed  |
| `qwen3-reranker-0.6b`  | Qwen3 Reranker 0.6B  | 0.6B   | `q8_0`        | 0.6 GB | fits | Apache-2.0         | rerank |

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
build     build llama-* from the submodule into .data/tools/
serve     launch the llama.cpp router
```

### Selecting models

```bash
scripts/fetch_models.py install ornith-35b qwen3-coder-30b   # explicit ids
scripts/fetch_models.py install --category coding            # a whole category
scripts/fetch_models.py install --all                        # everything non-experimental
```

### Useful flags

| flag                       | effect                                                                            |
| -------------------------- | --------------------------------------------------------------------------------- |
| `--quant Q`                | `install`: override the default quant (single model only)                         |
| `--with-mmproj`            | `install`: also fetch the vision projector                                        |
| `-j N` / `--connections N` | `install`: parallel range connections per file (default 8)                        |
| `--no-hash-check`          | `install`, `verify`: skip SHA-256 (faster, weaker)                                |
| `--force`                  | `install`: redownload even if already validated; `build`: rebuild even if current |
| `--no-config`              | `install`, `remove`: leave `.data/configs/` alone                                 |
| `--vram-budget GB`         | override the detected budget (every subcommand)                                   |
| `--port` / `--host`        | where the server listens (`install`, `remove`, `config`, `serve`)                 |
| `--models-max N`           | models resident at once (default 1)                                               |
| `--serve-ctx N`            | override served context for every model                                           |
| `-y` / `--yes`             | `install`: skip the confirmation prompt                                           |
| `--long`                   | `list`: full detail per model                                                     |
| `--json`                   | `list`: machine-readable catalog (what `setup.sh` reads)                          |
| `--remote`                 | `info`: also query HuggingFace for the live file listing                          |
| `-j N` / `--jobs N`        | `build`: parallel build jobs                                                      |
| `--check`                  | `build`: report the tool state afterwards                                         |

### Environment

| var            | purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `HF_TOKEN`     | token for gated repos (`HUGGING_FACE_HUB_TOKEN` is read as a fallback) |
| `HF_ENDPOINT`  | mirror instead of `https://huggingface.co`                             |
| `LLAMA_SERVER` | explicit path to the `llama-server` binary                             |
| `LLAMA_ROUTER` | explicit path to the `llama-router` binary (read by `serve.py`)        |
| `MEMBENCH_BIN` | explicit path to `membench` (read by `hostinfo.py`)                    |
| `BENCH_PORT`   | port `benchmark.py` starts its own `llama-server` on (default 8199)    |
| `NO_COLOR`     | disable coloured output everywhere                                     |

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
scripts/benchmark.py --dry-run        # plan + time estimate, runs nothing
scripts/benchmark.py                  # every enabled model
scripts/benchmark.py --model ornith-35b   # repeatable
scripts/benchmark.py --resume         # skip cells that already have a result.json
scripts/benchmark.py --report-only    # rebuild the report from existing results
scripts/benchmark.py --config PATH    # an alternate benchmark config
scripts/benchmark.py --quick-host     # skip the host throughput measurement
scripts/benchmark.py --no-build-check # do not verify tools against the submodule
```

Everything else is configured in `.data/configs/benchmark.json`, regenerated by
`fetch_models.py config` so it always lists exactly what is installed. Set
`enabled: false` to skip a model; trim `presets` to shorten a run. The runner starts
its own `llama-server` on port 8199 (`$BENCH_PORT`), so it does not disturb a session.

### Presets, not parameter sweeps

A cross-product of sampling values mostly produces noise. Instead there are ten
named presets, each answering one question, drawn from what model authors publish
and what the Apple-Silicon community has settled on:

| preset             | question it answers                                        |
| ------------------ | ---------------------------------------------------------- |
| `author-default`   | the model author's own published settings — the control    |
| `deterministic`    | greedy decoding, the standard for code and reproducibility |
| `metal-throughput` | flash-attn on + large ubatch — peak tok/s on M-series      |
| `flash-attn-off`   | what is flash attention actually worth here?               |
| `kv-q8`            | is the "8-bit KV is free" consensus true on real output?   |
| `kv-q4`            | how much quality does a 4-bit KV cache actually cost?      |
| `long-context`     | 4x context + q8 KV — degradation as context grows          |
| `balanced-chat`    | temp 0.7 / top-p 0.8 — the general-purpose middle ground   |
| `min-p`            | does min-p beat top-p for coherence at equal diversity?    |
| `high-creative`    | temp 1.0 / top-p 0.95 — helps prose, expected to hurt code |

Presets split into **runtime** flags (fixed at load time — changing one forces a
model reload) and **sampling** flags (per request, free). The runner groups by
runtime signature so each distinct runtime config is loaded exactly once and all
its sampling variants run against that single load. Generation goes through
`llama-server`'s HTTP API rather than `llama-cli`, which would reload the model
for every single run.

### Tasks

One shared task per category, so models within a category compete on identical
work. Add or edit them in `bench_presets.py`.

| category | task                                      | scoring                                |
| -------- | ----------------------------------------- | -------------------------------------- |
| coding   | merge overlapping integer ranges          | **executed** against 12 hidden tests   |
| general  | fix a subtly broken `median()`            | **executed** against 6 hidden tests    |
| writing  | document a `RateLimiter` class            | symbol coverage parsed from the source |
| vision   | describe + critique a generated bar chart | self-judge only                        |
| utility  | retrieval over a fixed probe set          | recall@1                               |
| audio    | TTS render                                | needs a `qwen3tts`/OuteTTS model       |

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
spec sheet, because that number assumes the GPU driving every channel at once. Read
them as context for the machine, not as a throughput prediction: the tok/s figures in
the report come from each request's own `timings` block, returned by `llama-server`
alongside the completion.

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

## The conductor benchmark

`scripts/benchmark.py` measures models. `scripts/conductor_bench.py` measures the
*harness*: it runs the same ten coding tasks three times each through three arms —
plain opencode, opencode carrying the doctrine packs, and opencode carrying the
conductor plugin — against the same model through the same router. Ninety headless
runs.

Scoring is the hidden test command's exit status, passed straight through. There is no
partial credit and nothing model-graded anywhere in it.

```bash
scripts/conductor_bench.py --verify-tasks   # every hidden test must FAIL on its seed
scripts/conductor_bench.py                  # the full ninety-cell run
scripts/conductor_bench.py --report-only    # rebuild the report from existing cells
```

`--verify-tasks` is the honesty check: a task whose hidden test passes on the
unmodified seed measures nothing, so it exits nonzero and names the offenders.

| flag                   | default                               |
| ---------------------- | ------------------------------------- |
| `--manifest PATH`      | `bench/conductor-tasks.json`          |
| `--model ID`           | `llamacpp/qwen3.6-27b`                |
| `--reps N`             | `3`                                   |
| `--results-dir PATH`   | `.data/benchmark/conductor/runs`      |
| `--work-root PATH`     | `.data/benchmark/conductor/work`      |
| `--report PATH`        | `.data/benchmark/conductor-report.md` |
| `--router-config PATH` | `.data/configs/conductor-router.json` |

The task set lives in `bench/conductor-tasks.json`; each entry carries its seed files,
its prompt, and the hidden files and test command the model never sees. The per-cell
timeout defaults to 1800 seconds. Everything the driver does that is not a process spawn or a file write is a
pure function, which is why `test_conductor_bench.py` can exercise the manifest load,
the arm construction, the run plan, the scoring and the report without starting
opencode or a model.

---

## Adding a model

Append a `Model` to `CATALOG` in `models_catalog.py`. Quant sizes are only used
for the offline `list` view — the real file list is resolved live at download
time, so you never hard-code filenames. Check your entry with:

```bash
scripts/fetch_models.py info <id> --remote
```

which prints every quant token the repo actually publishes, with real sizes.
