# Quickstart

Install the harness, put a model on disk, and get opencode talking to it. This page is
meant to be executed top to bottom; every command works on a fresh checkout.

## Requirements

The harness targets macOS on Apple Silicon, where llama.cpp runs on Metal against unified
memory. The scripts are Python 3.9+ and use the standard library only — no virtualenv, no
`requirements.txt`. Everything else is a build toolchain for the pinned `llama.cpp`
submodule.

| Requirement          | Why                                                         |
| -------------------- | ----------------------------------------------------------- |
| macOS, Apple Silicon | Metal inference against unified memory                      |
| Python 3.9+          | runs every script in `scripts/`                             |
| `git`                | clones the repo and tracks the `extern/llama-cpp` submodule |
| `cmake`, `ninja`     | build the `llama-*` binaries                                |
| `curl`               | downloads model weights                                     |
| `opencode`           | the coding agent this harness serves models to              |
| `rich` (optional)    | live progress bars and color-coded benchmark tables         |

Without `rich` the benchmark still runs and prints aligned plain text. Install it if you
want the nicer output:

```bash
pip3 install --user rich
```

Budget disk space for the weights themselves. A capable coding model is 25–30 GB; the
`recommended` starter set is two of them, about 52 GB. The smallest embedder is 0.3 GB,
and the largest catalog entry, `qwen3-coder-next`, is 48 GB on its own. The
`llama.cpp` submodule checkout adds a few hundred megabytes on top. Everything generated
lives under `.data/`, which is gitignored and entirely disposable.

## Install

`setup.sh` is the guided path. It is bash-only on purpose: everything it starts runs in
bash regardless of your login shell, so it behaves identically from fish, zsh, or bash.

```bash
./setup.sh
```

End to end, it:

- **Checks dependencies** and prints a pacman-style transaction summary of what is
  missing, then installs approved items through the detected package manager (`brew` on
  macOS). Approval is per item: `y` / `n` / `a` for all / `q` to quit.
- **Initializes the `extern/llama-cpp` submodule** if the checkout does not have it yet.
- **Builds the llama.cpp tools** into `.data/tools/`, pinned to the current submodule
  commit, by calling `fetch_models.py build`.
- **Shows the model catalog** as a numbered menu annotated with size and fit, takes your
  selection, and downloads plus validates each chosen model.
- **Generates the configuration** — `.data/configs/opencode.json`,
  `llama-models.ini`, and `benchmark.json` — then offers an optional benchmark and prints
  a status summary.

Five flags change how much it asks:

```bash
./setup.sh --dry-run                 # show the plan, change nothing
./setup.sh --yes                     # accept every step, installs the recommended set
./setup.sh --models ornith-35b       # preselect models, still confirms
./setup.sh --benchmark               # run the benchmark without asking
./setup.sh --no-benchmark            # skip the optional benchmark
```

The script can also run before the repo exists — it offers to clone it for you:

```bash
curl -fsSL https://raw.githubusercontent.com/vorlac/llama-harness/main/setup.sh | bash
```

## Choose a model

`fetch_models.py list` prints the catalog grouped by category, with a header line giving
the machine's total RAM, how much of it is usable for weights, and the *comfortable*
figure left once KV cache and compute buffers are reserved. The last column is the fit
verdict for this machine, recomputed on every run.

```bash
scripts/fetch_models.py list          # catalog + what fits this machine
scripts/fetch_models.py list --long   # quants, license, context, notes
scripts/fetch_models.py info ornith-35b --remote
```

```text
Coding & agentic software engineering (primary focus)
  ornith-35b             Ornith 1.0 35B (MoE)              26.5 GB  fits
  qwen3-coder-30b        Qwen3-Coder 30B-A3B Instruct      25.1 GB  fits
  qwen3-coder-next       Qwen3-Coder-Next 80B-A3B          48.0 GB  tight
```

The three verdicts (shown above for the 64 GiB reference host) mean:

| Verdict   | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| `fits`    | weights plus headroom fit inside the Metal budget                                     |
| `tight`   | weights fit, but headroom is thin — reduce the context size, or raise the wired limit |
| `too big` | will not load                                                                         |

macOS caps Metal at roughly 75% of RAM by default. Raising the wired limit makes the
`tight` tier viable; the setting resets on reboot, and `list` reads the sysctl back and
recalculates automatically.

```bash
sudo sysctl iogpu.wired_limit_mb=57344   # 56 GiB
```

One model per category, if you want to stop reading and start working:

| Category   | Start with             |    Size | Why                                                                   |
| ---------- | ---------------------- | ------: | --------------------------------------------------------------------- |
| coding     | `ornith-35b`           | 26.5 GB | strongest all-round agentic coder that fits comfortably; MIT licensed |
| general    | `qwen3.6-27b`          | 22.5 GB | the model conductor serves to every role                              |
| writing    | `gemma-4-26b-a4b`      | 26.9 GB | near-31B prose quality at 4B-active speed                             |
| vision     | `qwen3-vl-30b`         | 32.5 GB | reads mockups and screenshots; needs `--with-mmproj`                  |
| embeddings | `qwen3-embedding-0.6b` |  1.2 GB | retrieval; served, but never offered as an agent model                |

The full catalog, with licenses and per-category notes, is in
[`scripts/README.md`](../../scripts/README.md) and in [Models](models.md).

## Install a model

`install` takes explicit ids, a whole category, or everything non-experimental. It
downloads, validates, and regenerates the configs in one pass.

```bash
scripts/fetch_models.py install ornith-35b
scripts/fetch_models.py install ornith-35b qwen3-coder-30b
scripts/fetch_models.py install --category coding
scripts/fetch_models.py install qwen3-vl-30b --with-mmproj
```

Downloads are not trusted. Every install validates in this order, and a failure at any
step marks the model unvalidated rather than half-installed:

1. **Exact byte size** against the HuggingFace file tree.
2. **SHA-256** against the LFS `oid` HuggingFace publishes — the authoritative content
   hash, not a size heuristic.
3. **GGUF magic and version**, read out of the file header.
4. **Shard-count consistency** — the `split.count` field in the GGUF metadata must match
   the number of files actually on disk.

Architecture, tensor count, and context length come out of the GGUF metadata and are
recorded in `.data/models/<id>/.manifest.json` next to the file hashes.

Downloads resume at 32 MB chunk granularity. Interrupt an install at any point and re-run
the same command — completed chunks are tracked in a sidecar and skipped. Useful flags:

| Flag              | Effect                                          |
| ----------------- | ----------------------------------------------- |
| `--quant Q`       | override the default quant (single model only)  |
| `--with-mmproj`   | also fetch the vision projector                 |
| `-j N`            | parallel range connections per file (default 8) |
| `--no-hash-check` | skip SHA-256 — faster, weaker                   |
| `--force`         | redownload even if already validated            |
| `-y`              | skip the confirmation prompt                    |

## Serve it

`serve.py` is the everyday entry point. It picks a model, starts one `llama-server` in
router mode behind it, and leaves you in an interactive bash subshell that opencode is
already wired to. Run it with no arguments to get the picker, or name a model to skip
straight through.

```bash
scripts/serve.py                 # pick a model, land in a ready shell
scripts/serve.py ornith-35b      # skip the picker
scripts/serve.py --fresh         # ignore saved settings, ask everything
scripts/serve.py --no-shell      # run the server in the foreground instead
```

The picker lists installed chat-capable models only — embedding and reranker models are
still served, but opencode cannot use one as an agent model, so offering them would only
produce a broken session. Pass `--include-utility` to see them anyway. Port, host, and
context size are remembered in `.data/configs/serve-session.json` and reused on the next
run, so a repeat launch is one keypress.

The shell you land in prints what it set up:

```text
model served: qwen3.6-27b
  endpoint     : http://127.0.0.1:8080
  opencode cfg : .../.data/configs/opencode.session.json

cd into any workspace and run: opencode
llama_status / llama_log to inspect; exit to stop the model
```

Three things come with that shell:

- The prompt is prefixed with the served model, `(qwen3.6-27b) ~/project $`, so a
  forgotten session is obvious.
- `llama_status` curls `/v1/models` on the endpoint and pretty-prints the reply.
- `llama_log` tails the server log at `.data/configs/server.log`.

Type `exit` and the model stops. The server is a child of that subshell, an `EXIT`/`HUP`
trap kills it, and a detached watchdog polls the shell's pid and reaps the server even
after a `SIGKILL` no trap could catch. Nothing is left resident in the background.

## Use it from opencode

`serve.py` writes a session-scoped opencode config beside — never over — the main
`.data/configs/opencode.json`, points its `baseURL` at the endpoint it just started, and
sets `model` and `small_model` to the model you picked. That path is exported as
`OPENCODE_CONFIG` in the session shell, so opencode picks it up from any directory.

```bash
cd ~/your/project
opencode
```

The served model is already selected. Every installed chat model still appears in opencode's
picker — embedding and reranker models are served but deliberately absent from
`opencode.json` — and switching in the TUI transparently swaps which weights are resident,
because one `llama-server` in router mode serves them all with `--models-max 1`.

*Not yet wired: `serve.py` gains the conductor plugin, agent, and permission wiring at
task 12.1.* Once it does, the same session config also carries
[`conductor/opencode-fragment.json`](../../conductor/opencode-fragment.json) — the
`conductor-orchestrator` primary agent plus six subagents — so the harness travels into
whatever workspace you `cd` into. See [Conductor overview](conductor-overview.md).

## Check what you got

`status` is the one-command answer to "is this machine set up". It lists installed models
with size and fit, the total on disk, whether each was hash-checked or only size-checked,
the llama.cpp tool state, and whether each generated config file is present.

```bash
scripts/fetch_models.py status
```

`verify` re-runs the full validation against everything installed, or against the ids you
name. Run it after an interrupted download, a disk scare, or a submodule bump.

```bash
scripts/fetch_models.py verify
scripts/fetch_models.py verify ornith-35b
scripts/fetch_models.py verify --no-hash-check   # size and header checks only
```

## Benchmark it (optional)

`benchmark.py` runs ten named presets per model and writes `.data/benchmark/report.md`.
Always start with `--dry-run`: it prints the full plan — model, category, task, size,
preset count, and how many distinct model loads the run needs — plus a rough wall-clock
estimate, and then executes nothing.

```bash
scripts/benchmark.py --dry-run
scripts/benchmark.py --model ornith-35b
scripts/benchmark.py --resume        # skip cells already completed
scripts/benchmark.py --report-only   # rebuild the report from existing results
```

The estimate matters because wall clock is dominated by model loads, not by generation, so
a plan that looks small can take hours on large weights. `--resume` makes an interrupted
multi-hour run continue where it stopped. Scoring, presets, and the eviction mode that
benchmarks more models than fit on disk are covered in [Benchmarking](benchmarking.md).

## Concepts at a glance

Everything above is the model harness. The other half of this workspace is **conductor**,
an orchestration harness that runs on top of opencode and enforces a TDD workflow with
adversarial review. These are the terms the rest of the documentation uses.

| Term              | Definition                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **run**           | One user request tracked end to end, from `INTAKE` to a terminal state such as `REPORTED` or `ANSWERED`.                        |
| **item**          | One unit of work inside a run, with its own `fileScope` and `testScope`, advanced through the item state machine.               |
| **wave**          | The maximal set of items that are dependency-ready and pairwise scope-disjoint, so they can be worked in parallel.              |
| **gate**          | A check that runs before a tool call and denies it by throwing; gates are the only enforcement mechanism, and they fail closed. |
| **doctrine pack** | A markdown file in `conductor/doctrine/` that is injected into a role's system prompt on every request, never opt-in.           |
| **evidence**      | A command result the tool handler ran itself and stamped against a `HEAD`, not a claim the model made about a command.          |
| **ledger**        | An append-only record of what happened — evidence, decisions, anomalies, and open questions each have one.                      |
| **lens**          | The single angle one reviewer is asked for: spec/contract, correctness, guardrail, test adequacy, minimality, or performance.   |
| **skeptic**       | A fresh session that tries to refute one review finding; the finding survives only if enough skeptics uphold it.                |
| **taint**         | A permanent mark on an item recording that a gate was overridden; it is headlined in the run's report.                          |
| **stop kind**     | Why a run ended, from a closed vocabulary: `done`, `noop`, `blocked`, `surfaced`, `env`, `interrupt`.                           |

## Where next

- [Conductor overview](conductor-overview.md) — what conductor is, why enforcement lives
  in a plugin, and what a run looks like from the outside.
- [Serving](serving.md) — router mode, ports, context sizes, and the full `serve.py`
  flag list.
- [Troubleshooting](troubleshooting.md) — what to do when a model will not load, a port is
  taken, or opencode does not see the endpoint.
