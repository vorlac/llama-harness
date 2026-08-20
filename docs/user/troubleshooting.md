# Troubleshooting

Symptom-driven fixes for the model harness and for conductor. Every entry names the symptom you
see, the cause behind it, and a command or edit that resolves it. When you are unsure what state
the machine is in, `scripts/fetch_models.py status` reports what is installed, built, and
configured.

## Install and build

### `llama-server` (or another `llama-*` binary) is missing

Nine `llama-*` binaries are built from the pinned `extern/llama-cpp` submodule into
`.data/tools/`; nothing ships them prebuilt, and `status` reports `not built yet (N/9 binaries
missing)`. Lookup order is `.data/tools/`, then `$LLAMA_SERVER` (for `llama-server` only), then
`PATH`. Build them with `scripts/fetch_models.py build --check`. `serve.py` and `benchmark.py`
run the same check and rebuild on submodule drift; `--no-build-check` skips it.

### `extern/llama-cpp is empty`, or `not a git checkout (submodule not initialized?)`

The llama.cpp submodule was never fetched. The vcpkg submodule is different —
`cmake/vcpkg-init.cmake` initializes and bootstraps `extern/vcpkg` itself at configure time.

```bash
git submodule update --init --recursive extern/llama-cpp
```

### `cmake not found on PATH` / `ninja not found on PATH`

Both are required to build llama.cpp. Run `brew install cmake ninja`, then re-run
`scripts/fetch_models.py build`.

### The first CMake configure appears to hang

It is not hung. `cmake --preset clang-relwdebinfo` bootstraps vcpkg on its first run and builds
every port in [`vcpkg.json`](../../vcpkg.json) from source — `cpp-httplib`, `nlohmann-json`,
`json-schema-validator`, `doctest`, `spdlog`, `ftxui`, `pkgconf` — roughly 45 minutes on the
reference host. Run it in the background and poll; killing it leaves a partial port tree that
has to be rebuilt anyway.

### `cmake --build` spends minutes inside `extern/llama-cpp`

`CMakeLists.txt` adds `extern/llama-cpp` as a subdirectory so its configure is exercised, but
nothing in this project links it — `llama-router` proxies to a separately-launched
`llama-server`, so it needs neither `llama` nor `ftxui`. A bare `cmake --build` descends into
that tree and compiles all of it for nothing. Always build a named target.

```bash
cmake --build .out/build/clang-relwdebinfo --target llama-router
cmake --build .out/build/clang-relwdebinfo --target router-tests
cmake --build .out/build/clang-relwdebinfo --target membench
```

### `find_package(... CONFIG REQUIRED)` fails for httplib, nlohmann_json, the schema validator, doctest, or spdlog

The configure ran without the vcpkg toolchain, so the `vcpkg.json` manifest was never installed.
The presets set `toolchainFile` for you — configure through `cmake --preset clang-relwdebinfo`,
not by hand.

## Models

### `sha256 mismatch for <file>`

The bytes on disk do not match the LFS oid HuggingFace published. The manifest is still written,
with `validated: false` and the problem list, so a broken install is recorded rather than hidden.
A corrupt file usually has the *right* size, so a plain re-run would keep it; `--force` deletes
the `.gguf`, `.part`, and `.part.json` and refetches.

```bash
scripts/fetch_models.py install <id> --force
scripts/fetch_models.py verify <id>
```

### `HuggingFace returned 401` or `403 … This repo is gated or private`

The repo needs its terms accepted and an authenticated request. Accept them on the model's
HuggingFace page, then export a token. `HF_ENDPOINT` points the same commands at a mirror.

```bash
export HF_TOKEN=hf_xxxxxxxxxxxxxxxx
scripts/fetch_models.py install <id>
```

### A download was interrupted

Downloads are ranged and resume at 32 MB granularity, with progress in `<file>.part` and a
`<file>.part.json` chunk map. Re-run the identical command and it continues from the last
completed chunk; the resume state is discarded if the remote size changed.

### `too big` in `list`, or the server dies loading weights

`list` labels every quant against this machine's usable budget as `fits`, `tight`, or `too big`.
On Apple Silicon that budget is `iogpu.wired_limit_mb` when the sysctl is set, otherwise about
75% of physical RAM; `comfortable` subtracts headroom for KV cache and compute buffers, which
grow with context length. Take a smaller quant, or serve less context.

```bash
scripts/fetch_models.py info <id> --remote        # quant tokens actually in the repo
scripts/fetch_models.py install <id> --quant Q4_K_M
scripts/fetch_models.py config --serve-ctx 16384  # lower served context for every model
```

### A model is `tight` and you want it anyway

Raise the Metal wired limit. The sysctl resets on reboot, and `list` re-reads it, so the fit
labels recompute immediately. `--vram-budget GB` overrides only the *detected* budget used for
planning output — it changes what the tool tells you, not what Metal will wire.

```bash
sudo sysctl iogpu.wired_limit_mb=57344    # 56 GB
scripts/fetch_models.py list
```

### A vision model cannot see images

The multimodal projector is a separate file, fetched only when asked for. Without
`--with-mmproj` the install warns `no mmproj found in <repo>; continuing without vision`, and
the generated opencode config reports `vision: false`. Reinstall with
`scripts/fetch_models.py install <id> --with-mmproj`; the manifest then records the projector
under `mmproj`, and `serve.py`'s picker tags the model `vision`.

## Serving

### `serve.py` cannot find `llama-server`

The tools are not built, or the build is stale against the submodule. Build them, or point at a
binary you already have.

```bash
scripts/fetch_models.py build
LLAMA_SERVER=/path/to/llama-server scripts/serve.py
```

### `port 8080 is already in use`

Usually a `llama-server` from an earlier session that outlived its shell. `serve.py` scans the
next 40 ports and offers the first free one; accept it, or reclaim the port.

```bash
pgrep -fl llama-server
kill <pid>
scripts/serve.py --port 8090
```

### The server is up but opencode offers no models

Three causes, in the order worth checking:

1. `.data/configs/opencode.json` does not exist — `serve.py` refuses with *no opencode config
   yet*. Run `scripts/fetch_models.py config`.
2. The model was installed after that config was generated, so it is absent from
   `provider.llamacpp.models` and the session config leaves the default model untouched. Run
   `scripts/fetch_models.py config` again.
3. `opencode` is running in a terminal that never got `OPENCODE_CONFIG` — only the subshell
   `serve.py` execs has it exported.

```bash
llama_status                  # in the session shell: the served model list from /v1/models
scripts/serve.py --print-env  # the exact env a scripted caller must export
```

Embedding and reranker models are excluded from the picker because opencode cannot use one as an
agent model; `--include-utility` offers them anyway.

### The first request after switching models is slow

One `llama-server` runs in router mode over `.data/configs/llama-models.ini` with
`--models-autoload` and `--models-max 1`, so weights load on first use and switching evicts the
resident model — the first request after a switch pays a full load from disk. Raise the resident
count with `scripts/fetch_models.py config --models-max 2`, but only for models that genuinely
fit side by side, such as a small coder plus an embedder. At startup `serve.py` polls `/health`
for up to 600 seconds; if the process dies first it prints the last 15 lines of the server log.

### A model is still resident after the terminal closed

The session shell's `EXIT`/`HUP`/`INT`/`TERM` trap kills the server, but bash defers traps until
the current foreground command returns — so a terminal closed while `opencode` is running can
leave the model in memory. A detached watchdog polls the shell's pid every second and reaps the
server regardless, including after a `SIGKILL` no trap could catch. To intervene sooner:

```bash
kill $LLAMA_HARNESS_SERVER_PID       # exported into the session shell
pkill -f 'llama-server --models-preset'
```

## opencode and conductor

### You cannot tell whether conductor is loaded

There is no startup banner to look for — no conductor module emits one, so nothing in the
model's first response confirms or denies that the plugin is running. That matters because
the failure is silent in the worst way: opencode logs a plugin factory throw and then
continues with zero hooks installed, so the session looks completely normal and every gate is
absent.

The signal is the liveness beacon, written out of band when the plugin opens the workspace:

```bash
cat .conductor/state/alive.json      # {pid, startMs, version, sessionID}
```

The ordering makes the check meaningful. The doctrine packs load *before* the workspace is
opened, so the commonest startup failure — a missing or unreadable pack — happens before the
beacon is written. An absent or stale beacon is evidence that initialization did not
complete. The second signal is stderr: until a run directory exists, every journal record
goes there as one JSON object per line, unfiltered, so an open failure shows up as a
`hook.failed` record naming the root and the errno.

If the beacon is missing, find the `failed to load plugin` line in opencode's log, fix the
underlying error, and start a new session. Do not keep working in an ungated one.

### `the conductor workspace at <root> is held by another live conductor`

A second conductor opening a workspace a live one already holds is **refused**. It does not
fall back to a read-only mode; it simply does no conductor-side work in that workspace, and
logs `lock.contended` at `error` level naming the holder's pid, its start time, and its
session id. Two conductors sharing one workspace would mint colliding evidence sequence
numbers and publish one item's green on another item's verify, which is why the second
session does not open at all.

Close the named session, or wait for it to release the workspace, and try again. Confirm
which process holds it:

```bash
cat .conductor/state/run.lock        # {pid, startMs, sessionID?, token?}
ps -p <pid>
```

### `could not be acquired within the retry budget`

A different refusal from the one above, and it means something different: the retry budget
ran out without a claim being made. The lock in the way may be **stale** — its pid is not
alive — and the reclaim may itself be blocked by a stuck break right. The message reports
whether the named pid is actually alive, so read that clause before doing anything.

Reclaiming a stale lock is a three-part compare-and-delete: an exclusive
`run.lock.break.<key>` file grants the right to break one particular lock, the lock is
re-read under that right, and the broken lock is set aside as `run.lock.stale.<key>`. A
process killed mid-reclaim can leave the break right behind, and then nothing can claim the
workspace.

With no conductor running, clear them by hand:

```bash
pgrep -fl opencode                                   # confirm nothing is running first
rm -f .conductor/state/run.lock .conductor/state/run.lock.break.*
```

### `the conductor config at <path> is not valid JSON` / `is not a valid §2.1 Config`

A malformed or schema-invalid `.conductor/config.json` throws and names the file. It is never
silently replaced by the built-in default, because a repo whose `git.mode` reverts under it is
a security downgrade nobody asked for. Fix the file — the message names the parse error or
the failing schema path — or delete it and re-run `conductor_setup`.

An unknown key is a validation error too: the schema sets `additionalProperties: false` at
every level, so `gitMode` typed for `git.mode` is refused rather than ignored.

### The run is stopped and answering the question does not resume it

Two cases, and the messages differ.

If the question is **human territory** under the decision protocol, answering it through
`conductor_answer` records the answer but does not un-stop the run: a human-territory
question is released by the operator's own answer file and by nothing else. `conductor_status`
shows it under standing questions, with the path you owe. Write the file:

```bash
echo 'your answer' > .conductor/runs/<runId>/answers/Q-0001.md
```

An empty or whitespace-only file is not an answer — the question stays open — so make sure
the redirect actually wrote something.

If the run is terminal by **state** rather than by a stop record — closed by
`conductor_report`, so it has its report — it is not resumable at all. Start a new run with a
fresh prompt.

### An item is released and immediately blocked again

That is the hand-off rule, not a bug. An item carries exactly one `blocked` annotation, so if
two open questions both name it, the first one owns the block. Answering that one re-blocks
the item on the oldest still-open question that also names it, and the item is listed in the
journal as blocked on the successor rather than cleared. Answer the remaining questions —
`conductor_status` lists them all with their ids.

### `is not a gate an override can bypass`

`conductor_override` accepts exactly three gate names: `session`, `git` and `edit`. Anything
else is refused before the budget is consulted, and the refusal costs nothing at all — no
budget meter moved, no taint was recorded, no anomaly was appended, and the run did not stop.
Re-issue naming one of the three, or take the refusal the gate actually gave you as the
answer.

### `TypeError: Plugin export is not a function`

The loader iterates every export of a plugin module and throws on the first one that is not a
plugin function, skipping the *whole* plugin — a single exported constant is enough to ungate
the session. `conductor/plugin/index.ts` therefore exports exactly `ConductorPlugin`; shared
constants live in sibling modules such as `adapter/tools.ts`.

### `ConfigInvalidError`, or the config endpoint returns 400 and no session starts

opencode scans **every** string in the config for `{file:...}` references, descriptions included,
and one that does not resolve is a hard error rather than a warning. The conductor fragment uses
`{file:${LLAMA_HARNESS_ROOT}/conductor/doctrine/core.md}`, so an unset or wrong
`LLAMA_HARNESS_ROOT` breaks the whole config. Check that every braced path in the merged config
exists as an absolute path.

### In-project edits ask for `external_directory` instead of `edit`

opencode canonicalizes session directories — on macOS `/var/...` becomes `/private/var/...` — so
a non-canonical directory makes files in your own project look external. Hand opencode a
realpath'd directory.

```bash
cd "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' .)"
```

## Tests

Two Node v26.7.0 behaviors make raw `node --test` unusable as a gate, and both look exactly like
an ordinary result. `scripts/test-conductor.sh` exists to close them, which is why it is the only
gate that counts.

### `MODULE_NOT_FOUND` from a test run with no missing module

You passed a directory to `node --test`. A directory positional resolves as a module, and the
resulting failure is indistinguishable from a real red. The wrapper turns a directory argument
into a glob before Node ever sees it.

```bash
bash scripts/test-conductor.sh                                    # whole suite
bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'  # quote the glob
```

### A test command exits 0 but nothing ran

A glob matching zero files exits 0 under `node --test` — a vacuous green. The wrapper rejects it
with `GATE FAIL: zero tests ran (wrong glob or empty suite)`. Fix the glob, and quote it so your
shell does not expand it first.

### The gate failed — what each leg means

| Message                                 | Meaning                                                    | Fix                                          |
| --------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| `zero tests ran`                        | the glob matched nothing                                   | correct and quote the glob                   |
| `N test(s) failing`                     | a genuine red                                              | fix the code or the test                     |
| `N test(s) cancelled`                   | the run aborted mid-suite                                  | re-run; investigate a hang or crash          |
| `N test(s) skipped` / `N todo test(s)`  | a hard test was turned into a skip                         | restore the test                             |
| `N SKIP/TODO directive(s)`              | a describe-level skip, invisible to the TAP trailer counts | restore the suite                            |
| `tsc is not installed`                  | `conductor/tsconfig.json` exists, dependencies do not      | `npm install` in `conductor/`                |
| `typecheck (tsc --noEmit)`              | a type error                                               | fix it; the gate stops here                  |
| `bun leg … G14 dual-runtime divergence` | the smoke test passes on Node, not on Bun                  | fix the runtime-dependent code               |
| `GATE WARN: bun absent`                 | Bun disappeared from the machine                           | reinstall Bun; the leg is meant to be active |
| `export-schemas.ts failed to run`       | the schema exporter itself is broken                       | fix the exporter, then re-run                |
| `python leg`                            | a `scripts/test_*.py` unittest failed                      | fix the script or the test                   |
| `python leg discovered ZERO tests`      | the `scripts/test_*.py` files moved or were renamed        | restore the naming the discovery expects     |
| `python leg reported skipped/expected-failure tests` | a Python test was skipped                     | restore the test                             |

The run ends with `GATE PASS`. Anything else is a fail, including a nonzero Node exit with
otherwise clean TAP counts.

### `M5 FAIL: stub marker in <file>`

`scripts/conductor-gate.sh` is the separate mechanical stub scan, not part of the test gate. It
rejects `TODO`, `FIXME`, `XXX`, `not implemented`, `placeholder`, and the bare word `stub` in
production source; and `test.skip` / `it.skip` / `describe.skip` / `.todo(`, trivially-true
assertions, and empty catch blocks everywhere, tests included. Marker scanning is
production-scoped because test files carry those tokens legitimately as data. Pass one or more
paths to scan them alone; with no argument it scans every tracked source.

## Benchmark

### A model scores 0% on every objective task

Almost always a reasoning model that never reached an answer: reasoning models emit
`reasoning_content` before any answer tokens, and on a normal budget they spend all of it
thinking and return an empty answer. `.data/configs/benchmark.json` sets
`run.max_tokens_reasoning` (8000 by default) and applies it to catalog entries flagged
`reasoning`. Check the captured output first — `keep_outputs` writes `output.txt` and
`reasoning.txt` per cell.

```bash
cat .data/benchmark/<model>/<preset>/reasoning.txt
scripts/benchmark.py --model <id> --resume     # after raising max_tokens_reasoning
```

### Later models in a sweep look slower than earlier ones

Thermal or power state changed mid-run. The report's *Machine state (throttling check)* table
records power source, low-power mode, battery, and thermal keys before and after. Only the
thermal rows carry a `**changed**` flag, and the note that later results may be throttled fires
on a thermal change alone — so a power-source or low-power-mode change has to be spotted by
reading the two columns. Put the machine on AC, turn off low-power mode, and re-run only the
affected models.

```bash
scripts/benchmark.py --model <id> --resume
scripts/benchmark.py --report-only             # rebuild the report from existing results
```

### The run dies with `not enough free disk space`

The install pre-flight refuses when free space is under 105% of the planned download. Under
eviction mode that pressure is expected: `delete_after_each` removes each model as soon as its
results are recorded, which frees the disk for the next one. The plan itself is built from what
is already installed under `.data/models/`, so a catalog-sized sweep is done in batches: install
a batch, run with `delete_after_each`, install the next batch, and re-run with `--resume`.
`--dry-run` prints the plan and estimate without running anything, and `--resume` picks up an
interrupted sweep at the first cell with no `result.json`.

```jsonc
// .data/configs/benchmark.json
"eviction": { "delete_after_each": true }
```

## Getting more detail

| Source             | Where                                   | What it gives                                                                            |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CONDUCTOR_LOG`    | environment                             | raises the log level; wins over `logging.level` and `logging.components`                 |
| Journal            | `.conductor/runs/<runId>/journal.jsonl` | every gate denial, FSM refusal, fan-out dispatch, and retry, with its correlation triple |
| `conductor_status` | in-session                              | the live run state, every item, open and standing questions, and each session's doctrine delivery |
| Replay             | `node conductor/tools/replay.ts <run dir>` | the journal rendered in order: swimlanes, denials, fan-out durations, review rounds    |
| `llama_log`        | session shell                           | tails `.data/configs/server.log`                                                         |
| `llama_status`     | session shell                           | the served model list from `/v1/models`                                                  |

`CONDUCTOR_LOG` takes either a bare level or per-component settings, over the components `fsm`,
`gates`, `fanout`, `evidence`, `continuation`, `inject`, `router-client`, and `state`:

```bash
CONDUCTOR_LOG=debug opencode
CONDUCTOR_LOG=fanout:trace,gates:debug opencode
```

`error` and `warn` records are journaled regardless of the configured level, so a denial is never
lost to a low setting. `trace` includes full sub-session prompts and outputs — large, and meant
for debugging the harness itself rather than for everyday runs.

## See also

- [Installation](installation.md) — the guided first-time install
- [Models](models.md) — the catalog, validation, and sizing
- [Serving](serving.md) — router mode and the session shell
- [Observability](observability.md) — journals, ledgers, and reports
- [`scripts/README.md`](../../scripts/README.md) — the deep reference for the model harness
