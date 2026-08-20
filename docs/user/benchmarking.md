# Benchmarking

How to measure the models installed in this workspace: what the benchmark asks, how to run
it, how the scoring works, and how to read what it writes. The full script reference is
[`scripts/README.md`](../../scripts/README.md).

## What the benchmark answers

A model card gives you a parameter count, a quantization, and leaderboard scores produced on
somebody else's hardware. It cannot answer the two questions that decide whether a model is
usable here:

1. **How fast is this model on this machine?** Tokens per second for generation and for
   prompt processing, on your chip, at your Metal budget, with your KV-cache setting, on AC
   or on battery.
2. **Is its output actually correct?** Not "does it look plausible" — does the code it wrote
   pass tests it has never seen.

`scripts/benchmark.py` answers both for every installed model under a fixed set of named
configurations, and writes everything to `.data/benchmark/report.md`.

```bash
scripts/benchmark.py --dry-run     # plan + time estimate, runs nothing
scripts/benchmark.py               # every enabled model
scripts/benchmark.py --model ornith-35b
```

## Always dry-run first

`--dry-run` builds the full plan, prints it with a time estimate, and executes nothing. Run it
before every sweep — it is the cheap way to discover that you just asked for six models and
56 generations.

```text
──────────────────────────────── Benchmark plan ────────────────────────────────
┏━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━┓
┃model               ┃ category ┃ task            ┃    size ┃ presets ┃ loads┃
┡━━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━┩
│embeddinggemma-300m │ utility  │ retrieval       │  0.3 GB │       6 │     6│
│ornith-9b           │ coding   │ merge-ranges    │  5.6 GB │      10 │     6│
│qwen3-coder-30b     │ coding   │ merge-ranges    │ 25.1 GB │      10 │     6│
│qwen3-coder-next    │ coding   │ merge-ranges    │ 48.0 GB │      10 │     6│
│qwen3.6-27b         │ general  │ reasoning-audit │ 22.5 GB │      10 │     6│
│qwen3.6-35b-a3b     │ general  │ reasoning-audit │ 26.5 GB │      10 │     6│
└────────────────────┴──────────┴─────────────────┴─────────┴─────────┴──────┘
  56 runs across 6 model(s); rough estimate 72-300 minutes. Wall clock is
  dominated by model loads, so large models push the upper bound.

  dry run - nothing executed
```

`loads` is the number of distinct runtime configurations, and it is the column that sets the
wall clock. Five models at ten presets plus one embedding model at six is 56 generations but
only 36 model loads, and loading a 48 GB model costs far more than sampling from one already
resident. The embedding model gets six because embedding and audio tasks never sample, so their
sampling-only presets collapse into the runtime configuration they share. The estimate is
a deliberately wide band — roughly 1.5 minutes per run plus 1 minute per load, reported from
0.6x to 2.5x that figure. It is wide because a reasoning model on a hard task can spend
minutes thinking before it emits an answer token, and because loads dominate everything else.
A full sweep of the catalog is an overnight job.

## Running it

Every flag `benchmark.py` accepts. There are no tuning flags: the CLI selects *what* runs,
never *how*. Everything else lives in `.data/configs/benchmark.json`.

| Flag               | Effect                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `--model ID`       | Restrict the run to this model. Repeatable. An id that matches nothing is a hard error, so a typo cannot look like an empty plan. |
| `--config PATH`    | Use an alternate config instead of `.data/configs/benchmark.json`.                                                                |
| `--dry-run`        | Print the plan and the time estimate, run nothing.                                                                                |
| `--resume`         | Skip any cell that already has a `result.json`, and replay it into the report.                                                    |
| `--report-only`    | Rebuild `report.md` from the previous `session.json`. Runs no models.                                                             |
| `--quick-host`     | Skip the measured host throughput pass. Static specs and machine state are still recorded.                                        |
| `--no-build-check` | Do not re-verify `.data/tools/` against the pinned llama.cpp submodule first.                                                     |

Without `--no-build-check` the runner shells out to `scripts/fetch_models.py build` first,
for the same reason `scripts/serve.py` does, so the binaries cannot silently drift from the
pinned submodule. That build is a no-op unless the stamp under `.data/tools/` disagrees with
the submodule. Three environment variables matter: `BENCH_PORT` (default `8199`) is the port for
the benchmark's own `llama-server`, `MEMBENCH_BIN` points at a prebuilt `membench`, and any
value of `NO_COLOR` disables color. `rich` is optional — install it with
`pip3 install --user rich` for live progress and colored tables.

## Presets, not parameter sweeps

The obvious design is a cross-product: five temperatures times four top-p values times three
KV-cache types. Do not do this. It produces hundreds of cells, most differing by less than
run-to-run noise, and answers no question anyone asked. Instead there are ten named presets,
each a configuration that answers **one** question, drawn from what model authors publish and
what the local-inference community has converged on for Apple Silicon. Every preset reads as
a delta from `author-default`, the control.

| Preset             | The question it answers                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `author-default`   | The model author's own published sampling settings on a stock Metal runtime — the control.              |
| `deterministic`    | Greedy decoding (`temp 0`, `top-k 1`). The standard for code and for anything that must reproduce.      |
| `metal-throughput` | Flash attention forced on with a 4096 batch / 1024 micro-batch. Peak tok/s on M-series GPUs.            |
| `flash-attn-off`   | Identical to `metal-throughput` with flash attention off — isolates what FA is worth here.              |
| `kv-q8`            | An 8-bit KV cache halves cache memory. Is the "it's free" consensus true on real output?                |
| `kv-q4`            | A 4-bit KV cache is a quarter of the memory. How much quality does that actually cost?                  |
| `long-context`     | 131072 context with a q8 KV cache — the usual recipe for large-repo work. Degradation as context grows. |
| `balanced-chat`    | `temp 0.7 / top-p 0.8 / top-k 20`, the general-purpose middle ground and Qwen's published chat default. |
| `min-p`            | `min-p 0.05` with top-p/top-k disabled. Does min-p beat top-p for coherence at equal diversity?         |
| `high-creative`    | `temp 1.0 / top-p 0.95 / top-k 64`, Gemma's published default. Expected to help prose and hurt code.    |

All ten are defined in [`scripts/bench_presets.py`](../../scripts/bench_presets.py) and
reproduced verbatim in the report, so a report carries the definitions of what it measured.

## Runtime versus sampling

Every preset key falls into one of two cost classes, and the difference organizes the run:

- **Runtime** keys map to `llama-server` flags fixed at load time — `n-gpu-layers`,
  `flash-attn`, `cache-type-k`, `cache-type-v`, `batch-size`, `ubatch-size`, `ctx-size`.
  Changing one forces a full model reload, tens of seconds on a 30 GB model.
- **Sampling** keys vary per request and cost nothing — `temp`, `top-p`, `top-k`, `min-p`,
  `repeat-penalty`, `seed`.

A preset's runtime signature is its sorted runtime dictionary flattened to a string, and
presets sharing a signature can reuse one loaded model. The runner groups by it: each distinct
runtime configuration loads exactly once, and every sampling variant sharing it runs against
that single load. That is why ten presets cost six loads.

```text
for each model in the plan, one at a time:
    for each runtime group (a distinct set of load-time flags):
        load the model once
        for each preset sharing that runtime config:
            generate -> score -> record
        perplexity pass for the group
    render the per-model table
    optionally delete the model before moving on
```

Generation goes through `llama-server`'s HTTP API rather than `llama-cli` for three reasons:
the response is clean JSON instead of a banner that has to be scraped, llama.cpp reports
exact per-request timings in that JSON, and — decisively — the model stays loaded while
sampling varies. `llama-cli` would reload the weights for every single run. The perplexity
pass is per runtime group, not per preset, because perplexity depends on the KV-cache and
context configuration and not on sampling at all.

## Tasks

There is **one shared task per catalog category**, so every model in a category competes on
identical work. A model is matched to its task by the category in `scripts/models_catalog.py`.

| Category | Task                                                           | Scoring                                |
| -------- | -------------------------------------------------------------- | -------------------------------------- |
| coding   | `merge-ranges` — merge overlapping integer ranges              | executed against 12 hidden tests       |
| general  | `reasoning-audit` — fix a subtly broken `median()`             | executed against 6 hidden tests        |
| writing  | `ratelimiter-docs` — document a `RateLimiter` class            | symbol coverage parsed from the source |
| vision   | `chart-critique` — describe and critique a generated bar chart | self-judge only                        |
| utility  | `retrieval` — rank four documents against four queries         | recall@1                               |
| audio    | `tts-render` — speak a fixed sentence                          | needs a `qwen3tts`/OuteTTS model       |

The coding problem is deliberately **not** a LeetCode classic. Those are memorized verbatim
from training data, so a benchmark built on them measures recall rather than coding ability.
`merge_ranges` instead carries edge cases that require reasoning: ranges that merely *touch*
must merge (`(1, 3)` and `(4, 6)` become `(1, 6)`), input may be unsorted or contain
duplicates, empty input returns empty, and the input list must not be mutated — each checked
by a hidden test the model never sees. The vision task's image is generated rather than
committed, a deterministic four-bar PNG written with `zlib` and `struct`, so its ground truth
is known to the scorer.

## Scoring: three tiers

**1. Objective.** The only column to trust.

| Kind      | How it is scored                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exec`    | The code block is extracted from the output and executed in a subprocess against hidden tests. Subprocess isolation is deliberate: generated code can hang, exhaust memory, or call `sys.exit`, and none of that should take the benchmark down. A timeout counts as a failure with the reason recorded. |
| `symbols` | The generated documentation is checked against the public symbols parsed out of the source file. Objective coverage, no judge required.                                                                                                                                                                  |
| `embed`   | Retrieval recall@1 over a fixed probe set of four queries against four documents, scored by cosine similarity through `/v1/embeddings`.                                                                                                                                                                  |

**2. Perplexity.** Measured by `llama-perplexity` over a fixed corpus built from this repo's
own sources, so it reproduces without downloading wikitext. Lower is better. Objective and
judge-free, it answers one specific question: how much did this quantization or KV-cache
setting damage the model?

**3. Self-graded.** The model is shown its own answer and asked to score it 0–100 and name its
worst flaw. This is **not** an independent quality signal and is never mixed into the objective
score. Every surface — console table, `result.json`, `report.md` — labels it `SELF_GRADED`.
The reason to collect it anyway is **calibration**, `self_score - (objective_ratio * 100)`.
Positive means the model over-rated itself; near zero means it can tell when it is wrong. That
is arguably the more interesting property: a model that knows it failed can be asked to try
again, and a model that confidently scores its own broken code 100 cannot be trusted to review
anything, including its own work.

## Reading the report

Results land under `.data/benchmark/`, one directory per model and one per preset inside it:

```text
.data/benchmark/
  report.md                     the readable report
  session.json                  the whole run, machine-readable
  _corpus.txt                   fixed perplexity corpus (generated once)
  _server.log                   last llama-server log, for load failures
  _assets/barchart.png          generated vision-task image
  qwen3.6-27b/
    author-default/
      result.json               metrics + score + perplexity for this cell
      output.txt                the model's answer      (keep_outputs)
      reasoning.txt             its reasoning trace, if any
    kv-q8/ ...
```

`result.json` is the unit of resumption: `--resume` skips any cell that already has one. Each
row is rewritten after its group's perplexity pass, so a resumed run never replays a result
missing its perplexity figure. `report.md` opens with the host profile, then a summary by
model, then one table per model, then that model's perplexity table — which is where the
KV-cache presets earn their keep:

```text
| preset           | objective | gen tok/s | prompt tok/s | wall s | SELF-graded | calibration |
| ---------------- | --------: | --------: | -----------: | -----: | ----------: | ----------: |
| `author-default` |  0% (0/0) |      18.2 |        175.3 |  335.8 |         100 |        +100 |
| `kv-q8`          |  0% (0/0) |      18.1 |        176.9 |  183.3 |         100 |        +100 |
| `flash-attn-off` |  0% (0/0) |      17.7 |        174.0 |  417.3 |         100 |        +100 |

| preset           | perplexity |
| ---------------- | ---------: |
| `author-default` |     2.3894 |
| `kv-q8`          |     2.3901 |
| `kv-q4`          |     2.3963 |
```

Two cells need explaining when you meet them. **`0% (0/0)`** is not `0% (0/12)`: a zero
*total* means the scoring harness never produced test results at all, and the reason is in
that cell's `result.json` under `score.error`. **`truncated: true`** means the answer hit the
token cap, and the cell carries a `truncation_note` saying whether the whole budget went to
reasoning or the answer was cut off mid-way — a truncated trace and a wrong answer are
otherwise indistinguishable. Catalog entries marked `reasoning: true` get the
`max_tokens_reasoning` floor (8000 by default) precisely so a model is not scored 0% for
running out of room to think.

## The measured host profile

A benchmark that reports part numbers is nearly useless. Two machines with the same chip name
produce very different numbers depending on power source, thermal state, and how much memory
Metal is allowed to wire. So `scripts/hostinfo.py` measures what it can, records machine
state before the run, and re-checks it afterwards.

```text
chip            Apple M4 Max (40 GPU cores)
memory          64 GiB total, Metal budget 52 GB (macOS default (75% of RAM))
cpu             16 cores (12P + 4E)
mem bandwidth   154.3 GB/s single-thread, 332.9 GB/s at 16 threads (CPU-side ceiling; see llama-bench tg for what predicts tok/s)
disk read       25.5 GB/s [page cache warm] (measured)
power           AC
```

| Measurement             | Why it is here                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory copy bandwidth   | Decoding is memory-bound, so tok/s tracks bandwidth far more closely than FLOPS. Reported single-threaded and at the multi-threaded peak.                                           |
| Disk sequential read    | Sets the floor on model load time, which dominates any sweep that swaps models. Run as root to purge the page cache for a cold number; otherwise the report says `page cache warm`. |
| CPU single-thread       | A proxy for per-core speed, which governs tokenization, sampling, and the CPU side of prompt building.                                                                              |
| GPU cores, Metal family | Read from the display driver.                                                                                                                                                       |
| Metal budget            | `iogpu.wired_limit_mb` if set, otherwise 75% of RAM. The single most important number for "will this model load".                                                                   |

The volatile half — power source, low-power mode, battery, and thermal pressure — is captured
**twice**, before and after the run, and rendered side by side. If the thermal keys changed,
the report prints a warning above the results saying later numbers may be throttled relative to
earlier ones, and marks each changed thermal row. Power source, low-power mode, and battery are
recorded before and after but are not themselves flagged, so read those two columns yourself. A
throttled run says so instead of quietly skewing the numbers.

Bandwidth is measured by `membench`, a dependency-free C++ probe in
[`tools/membench/`](../../tools/membench/), invoked with `--sweep-threads --json`.
Point `MEMBENCH_BIN` at a built binary, or build one with
`cmake --build .out/build/clang-relwdebinfo --target membench`. With no binary available,
`hostinfo.py` falls back to a Python buffer copy that labels itself a fallback and carries a
caveat: it reads roughly 3x low, because the destination is allocated inside the timed region
and the copy pays a first-touch page fault on every page it writes. Even the real figure is a
CPU-side ceiling below the chip's spec sheet, which assumes the GPU driving every channel at
once. The methodology is in [`tools/README.md`](../../tools/README.md).

## Benchmarking more models than fit on disk

The catalog is larger than most disks. Eviction lets a sweep proceed anyway, one model at a
time. The key lives under `run.eviction` in `.data/configs/benchmark.json`:

```jsonc
"eviction": {
  "delete_after_each": false   // remove each model once its results are recorded
}
```

With `delete_after_each` set, a model is removed the moment its per-model table renders, via
`fetch_models.py remove <id> --no-config` — the results are already on disk in `result.json`,
so nothing is lost. Eviction is strictly one-way: nothing re-downloads a model the sweep
deleted, and you install whatever you want to measure next yourself. The plan itself is built
from what is installed under `.data/models/` when the sweep starts, so the working pattern for
a catalog-sized sweep is: install a batch, run with eviction on, install the next batch, re-run
with `--resume`. `--resume` reads back every
completed cell and rebuilds the full report around the new work, which is also what makes an
interrupted overnight run recoverable rather than restartable. Two more keys in the same file:
`enabled: false` skips a model entirely, and trimming a model's `presets` list shortens its
share of the run. `fetch_models.py config` regenerates the file to match exactly what is
installed and preserves no hand edits, so keep a customized copy elsewhere and use `--config`.

## What cannot be benchmarked

Two catalog categories have no runnable task. Both appear in `report.md` under **Categories
not benchmarked** with the reason spelled out, rather than being silently omitted:

- **Music and beat generation.** No music generation model exists in the GGUF ecosystem, and
  llama.cpp has no music architecture. The MusicGen GGUF repositories on HuggingFace target
  other runtimes and are unmaintained. Speech synthesis *is* supported — that is the audio
  category, architecture `qwen3tts`.
- **Image generation.** llama.cpp cannot generate images. FLUX.1/FLUX.2, SD3.5, and
  Qwen-Image all ship GGUF weights, but they run in `stable-diffusion.cpp`, a separate
  engine. Adding it as a second submodule would make the category real; until then vision
  models are scored on interpretation, not generation.

A category with a stated gap is worth more than one quietly missing, which reads as oversight.

## Adding a preset or a task

Both live in [`scripts/bench_presets.py`](../../scripts/bench_presets.py).

**A preset** is a `Preset` appended to `PRESETS`: a `name`, a `focus` sentence saying which
question it answers (the report prints it verbatim), a `runtime` dict, and either a `sampling`
dict or `use_author_sampling=True` to take the model's own published settings. Build the
runtime from the shared `_rt(**overrides)` helper so a new preset differs from the baseline
Metal runtime only where you mean it to. Mind the cost class: a sampling-only preset is nearly
free, while a new runtime signature adds a full model load for every model it runs against.

**A task** is a `Task` appended to `TASKS`: an `id`, a `category`, a `scoring` kind (`exec`,
`symbols`, `judge`, `embed`, or `audio`), a `prompt`, and whatever its scorer needs — `tests`
for `exec`, `expect_symbols` for `symbols`, `judge_rubric` for the self-grade pass.
`TASKS_BY_CATEGORY` maps one task per category, so adding a second task to an existing
category replaces the first rather than adding to it. For an `exec` task, write tests that
fail on plausible-but-wrong implementations, and keep them out of the prompt. After editing
either file, regenerate the config with `scripts/fetch_models.py config`: each model entry in
`benchmark.json` carries its own copy of the preset name list, and a preset that list does not
name will not run.

## The conductor POC bench

The benchmark above measures models. A separate driver,
[`scripts/conductor_bench.py`](../../scripts/conductor_bench.py), measures **process** — the
quality delta attributable to enforcement alone, with the model held constant. Every arm runs
`llamacpp/qwen3.6-27b`, so no part of the difference can be a model mix.

This is a benchmark you run; it has no results until you do. No completed campaign is recorded
anywhere in the repository, and the report described here is what a run produces, not a
document sitting on disk waiting to be read.

| Arm         | What it isolates                                                              |
| ----------- | ----------------------------------------------------------------------------- |
| `baseline`  | plain opencode on its own `build` agent, same model, no plugin                |
| `doctrine`  | the doctrine packs injected as that agent's system prompt — no gates, no fan-out, no FSM |
| `conductor` | the full pipeline, through the `conductor-orchestrator` agent                 |

Three arms times three repetitions times ten tasks is 90 headless runs, all through
llama-router so token accounting is uniform. The plan is repetition-major and interleaves the
arms within each repetition, so an interrupted campaign still leaves the arms balanced to
within one cell. The task manifest [`bench/conductor-tasks.json`](../../bench/conductor-tasks.json)
holds a language mix (TypeScript, Python, C++), a difficulty spread from one function to a
small multi-file change, two non-behavioral tasks so that path is measured too, and for each
task a hidden test command that fails on an unmodified repo and is never shown to the model.
Hidden files are materialized only after opencode exits, so no arm can read the test it is
being graded by.

Each cell records its outcome from a closed set — `pass`, `fail`, `timeout`, `harness-error` —
plus wall clock, token totals, router errors, schema retries, review findings upheld, overrides
used, and the terminal stop kind. The four process metrics are `null` rather than `0` for the
`baseline` and `doctrine` arms, because those arms have no mechanism to produce them; a zero
would read as "the pipeline found nothing" instead of "there was no pipeline". A `conductor`
cell that produced no `.conductor/runs/` directory at all is flagged `pluginAbsent` and
reported separately as an *ungated* cell, since it measured the baseline by accident.

### Running it

Unlike the other harness scripts, `conductor_bench.py` is not executable, so invoke it through
the interpreter:

```bash
python3 scripts/conductor_bench.py --verify-tasks   # check the task set, run no models
python3 scripts/conductor_bench.py                  # the full 90-cell campaign
python3 scripts/conductor_bench.py --report-only    # rebuild the report from recorded cells
```

| Flag                   | Default                                | Effect                                                             |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `--manifest PATH`      | `bench/conductor-tasks.json`           | the task set to run                                                |
| `--verify-tasks`       | off                                    | run each hidden test against its unmodified seed and report; exits non-zero if any passed, because a hidden test that passes unmodified measures nothing |
| `--report-only`        | off                                    | render the report from cells already on disk, execute nothing      |
| `--work-root PATH`     | `.data/benchmark/conductor/work`       | where each cell's throwaway repository is built                    |
| `--results-dir PATH`   | `.data/benchmark/conductor/runs`       | one JSON file per cell, named `<arm>__<task>__r<rep>.json`         |
| `--report PATH`        | `.data/benchmark/conductor-report.md`  | the rendered report                                                |
| `--model ID`           | `llamacpp/qwen3.6-27b`                 | the model every arm runs                                           |
| `--reps N`             | `3`                                    | repetitions per (arm, task) cell                                   |
| `--router-config PATH` | `.data/configs/conductor-router.json`  | read for the router address every arm is pointed at                |

The report path sits *beside* `benchmark.py`'s own `report.md`, never on top of it. A cell whose
result file already exists is reused verbatim, so a campaign resumes by being re-run. Each cell
gets a per-cell timeout of 1800 seconds, and the whole process group is killed on expiry,
because opencode spawns children of its own.

### Reading the report

`.data/benchmark/conductor-report.md` opens with `# Conductor three-arm benchmark` and carries
these sections in order: **Method**, **Per-task pass rates**, **Arm totals**, **Cost**,
**Process metrics**, **Router-error cells**, **Ungated conductor cells**, **Missing cells**. The
per-task table comes before any arm-level line by design — a bare aggregate delta over ten
tasks is exactly the number this benchmark exists not to produce. Where two arms differ on a
task but their per-repetition ranges overlap, the report says so in plain words rather than
reporting the difference as a result.

The `doctrine` arm is what makes the experiment honest: it separates the cheap intervention —
better prompting — from the expensive one — gates, state machines, and adversarial fan-out —
and answers the question a reader will actually ask, which is how much of this needed building
at all. Repetitions exist because the served model samples rather than decoding greedily, which
makes a single 6/10-versus-4/10 comparison indistinguishable from noise at exactly the
resolution this experiment produces. The report is therefore per-task pass rates **and their spread across
repetitions**, never a bare aggregate delta, and it states plainly where arms sit within noise
of each other.

## See also

- [`scripts/README.md`](../../scripts/README.md) — the authoritative script reference
- [Models](models.md) — the catalog, categories, and what fits this machine
- [Serving](serving.md) — router mode, and how a served model differs from a benchmarked one
- [`tools/README.md`](../../tools/README.md) — membench methodology
- [Project status](../developer/project-status.md) — what is built and what is next
