# Installation

The complete installation reference: what lands on disk, what has to be present first, and how
to bring up each of the workspace's three build surfaces — the model harness, the conductor
plugin, and the C++ router. The guided path is `./setup.sh`, which installs the model harness;
the other two are developer environments, set up separately further down this page. For the
shortest path to a working model, read [Quickstart](quickstart.md) instead.

## What gets installed where

Everything the workspace generates is gitignored or a submodule pointer. Nothing generated is
ever committed.

| Path                      | What lives there                                                                                                                | Written by                           | In git?      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------ |
| `.data/models/<id>/`      | GGUF weights and `.manifest.json`                                                                                               | `fetch_models.py install`            | no           |
| `.data/tools/`            | the nine `llama-*` binaries, their dylibs and Metal shader libraries, and `.build-stamp.json`                                   | `fetch_models.py build`              | no           |
| `.data/configs/`          | `opencode.json`, `llama-models.ini`, `benchmark.json`, `conductor-router.json`, saved session state, `server.log`, `router.log` | `fetch_models.py config`, `serve.py` | no           |
| `.data/scripts/`          | `launch.sh`, the generated entry point                                                                                          | `fetch_models.py config`             | no           |
| `.data/benchmark/`        | per-model results and `report.md`                                                                                               | `benchmark.py`                       | no           |
| `.data/build/`            | the llama.cpp CMake tree the tools are built in                                                                                 | `fetch_models.py build`              | no           |
| `.out/build/<preset>/`    | the CMake build tree for `llama-router`, `router-tests` and `membench`                                                          | `cmake --preset <preset>`            | no           |
| `.out/install/<preset>/`  | the install prefix, if you ever run `cmake --install`                                                                           | `cmake --install`                    | no           |
| `.data/router/`           | `metrics.jsonl`, the router's append-only metrics ledger                                                                        | `llama-router`                       | no           |
| `conductor/node_modules/` | types-only dev dependencies                                                                                                     | `npm install` in `conductor/`        | no           |
| `router/tests/schemas/`   | the exported JSON Schemas the C++ tests validate against                                                                        | `scripts/test-conductor.sh`          | no           |
| `extern/llama-cpp/`       | the pinned llama.cpp submodule                                                                                                  | `git submodule update`               | pointer only |
| `extern/vcpkg/`           | the vcpkg submodule and its bootstrapped `vcpkg` binary                                                                         | `cmake/vcpkg-init.cmake`             | pointer only |

The split is deliberate. `.data/` is the working set of the *model harness* and is safe to
delete wholesale; `.out/` is the working set of the *C++ build*; `extern/` is two submodule
pointers, so the commit is versioned but the contents are not. `hostinfo.py`'s on-demand
`membench` build also lands under `.out/build/`, so there is exactly one directory C++
binaries are written to.

## Prerequisites

Versions below are the ones verified on the reference host: macOS (Darwin 25.6.0) on Apple
Silicon, an M4 Max with 64 GiB. Other versions generally work.

| Tool       | Reference version                       | Needed for                                                | `setup.sh` offers it |
| ---------- | --------------------------------------- | --------------------------------------------------------- | -------------------- |
| `git`      | 2.50.1                                  | clone the repo, track the llama.cpp submodule             | yes, required        |
| `cmake`    | 4.4.2                                   | build llama.cpp and the router                            | yes, required        |
| `ninja`    | 1.13.2                                  | the generator both builds use                             | yes, required        |
| `python3`  | 3.9.6 at `/usr/bin/python3`             | every harness script                                      | yes, required        |
| `curl`     | system                                  | model downloads                                           | yes, required        |
| `opencode` | 1.18.15 at `/opt/homebrew/bin/opencode` | the coding agent the harness serves models to             | yes, optional        |
| `rich`     | any                                     | nicer benchmark tables and live progress                  | yes, optional        |
| `node`     | v26.7.0                                 | the conductor test suite, typecheck, and type stripping   | no                   |
| `bun`      | 1.3.14                                  | opencode's own runtime; the dual-runtime smoke test       | no                   |
| `clang`    | Apple clang 21.0.0                      | the C++23 router                                          | no                   |
| `go`       | 1.26.5                                  | only if a target repo's verify command is `go test ./...` | no                   |

The harness scripts are Python 3.9 standard library only — there is nothing to `pip install`
except the optional `rich`. `setup.sh` covers the model-harness half exclusively; it does not
touch `conductor/` or the C++ build. It detects a package manager and uses it: `brew` on macOS,
`apt-get`, `dnf`, `pacman` or `zypper` on Linux. The C++ presets are macOS-only — the shared
`clang` preset in [`CMakePresets.json`](../../CMakePresets.json) carries a
`hostSystemName equals macOS` condition.

## Running setup.sh

`setup.sh` is bash-only on purpose: everything it starts runs in bash regardless of your login
shell, so its behavior is identical from fish, zsh or bash.

```bash
./setup.sh                     # guided install
./setup.sh --yes               # accept every step, unattended
./setup.sh --models a,b,c      # preselect models, still confirms
./setup.sh --no-benchmark      # skip the optional benchmark
./setup.sh --dry-run           # print the plan, change nothing
```

Under `--dry-run` every action is printed with a `[dry-run]` prefix and nothing is executed.
Under `--yes`, and with no `--models`, the model selection defaults to `recommended`.

The script runs in phases. Each one asks before it spends time, bandwidth or disk.

**0. Locate the repository.** It walks up from its own path looking for a directory holding
both `scripts/fetch_models.py` and `CMakeLists.txt`. If there is none — the case when you pipe
it from `curl` before cloning — it offers to clone into `$PWD/llama-leash`, trying SSH first
and falling back to HTTPS, always with `--recurse-submodules`.

**1. Check dependencies.** It probes the seven tools in the table above (`rich` by attempting
the import, the rest with `command -v`). Anything missing is listed in a summary table of NAME,
REQUIRED and REASON, then installed one at a time with per-item approval
(`[Y/n/a=all/q=quit]`). A failed required dependency aborts the run; a failed optional one warns
and continues. `rich` installs as `python3 -m pip install --user --quiet rich`, which keeps it
out of the site-packages macOS manages. opencode prefers `brew install opencode`, then
`npm install -g opencode-ai`, and falls back to the `https://opencode.ai/install` script.

**2. Fetch the llama.cpp submodule.** Skipped when `extern/llama-cpp/CMakeLists.txt` already
exists. Otherwise it asks to run `git submodule update --init --recursive extern/llama-cpp` and
warns that this is a few hundred megabytes. Declining is fatal — llama.cpp is not optional.

**3. Build the llama.cpp tools.** Runs `python3 scripts/fetch_models.py build`, compiling the
binaries into `.data/tools/` pinned to the current submodule commit. Declining warns that
serving and benchmarking will not work until you run the build yourself.

**4. Choose models.** It reads the catalog with `fetch_models.py list --json` and renders a
numbered menu grouped by category, showing each model's size in GB, whether it *fits*, is
*tight* or is *too big* for this machine's measured budget, and `installed` / `experimental`
flags. Answer with numbers, model ids, a category name to take that whole category minus its
experimental entries, `recommended` for a small starter set (`ornith-35b` and
`qwen3-coder-30b`), or `none` to skip. The selection is then shown as a transaction summary —
name, quant, size, fit, and a total download figure — before a single confirmation, and each
model is approved individually. Each install runs `fetch_models.py install <id> -y --no-config`.

**5. Generate configuration.** Runs `fetch_models.py config`, writing
`.data/configs/opencode.json`, `.data/configs/llama-models.ini` and
`.data/configs/benchmark.json`, plus `.data/scripts/launch.sh`. The opencode config it writes
already carries the conductor plugin and agent definitions merged in from
[`conductor/opencode-fragment.json`](../../conductor/opencode-fragment.json), so regenerating
it later cannot strip conductor back out.

**6. Benchmark (optional).** Defaults to no. If accepted, the run is scoped with one
`--model <id>` per model just selected, because `benchmark.py` otherwise defaults to every model
under `.data/models/` and would quietly benchmark leftovers from earlier runs. It prints
`benchmark.py --dry-run` first and asks you to approve that plan before running it for real.

**7. Finish.** It prints `fetch_models.py status` and the three commands that start real work:
`./scripts/serve.py`, `cd` into your project, then `opencode`.

## The pinned llama.cpp submodule

[`.gitmodules`](../../.gitmodules) pins two submodules: `extern/llama-cpp` from
`https://github.com/ggml-org/llama.cpp.git` and `extern/vcpkg` from
`https://github.com/microsoft/vcpkg`. The reference host is pinned to llama.cpp build 10298.

Initialize them with a recursive clone, or after the fact:

```bash
git submodule update --init --recursive extern/llama-cpp
```

`fetch_models.py build` configures that submodule into `.data/build/` with Ninja and a fixed
flag set — `-DCMAKE_BUILD_TYPE=Release`, `-DGGML_METAL=ON`, `-DLLAMA_BUILD_SERVER=ON`,
`-DLLAMA_BUILD_TESTS=OFF`, `-DLLAMA_BUILD_EXAMPLES=OFF`, `-DLLAMA_CURL=OFF` — and builds nine
targets: `llama-server`, `llama-bench`, `llama-perplexity`, `llama-cli`, `llama-mtmd-cli`,
`llama-tts`, `llama-batched-bench`, `llama-tokenize` and `llama-quantize`. The binaries are
copied into `.data/tools/` alongside every `*.metallib` and `*.dylib` the build produced —
Metal needs its shader library beside the binaries when it is not embedded.

The build then writes `.data/tools/.build-stamp.json` recording the submodule `sha`, the
`built_at` timestamp, the exact `cmake_flags`, the `targets` that produced a binary, and the
`host` platform string. That stamp is what keeps tools and library versions from drifting
apart: both `serve` and `benchmark` re-check it before they do anything, and rebuild when any
of four conditions holds.

| Condition                                 | What it means                                                        |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `extern/llama-cpp` is not a git checkout  | the submodule was never initialized; this is an error, not a rebuild |
| a binary is missing                       | the tools were never built, or `.data/tools/` was partly deleted     |
| the stamp's `sha` is not the submodule's  | the pin moved — you updated the submodule                            |
| `cmake_flags` differ from the current set | the build recipe itself changed                                      |

`scripts/serve.py` runs this check on startup unless you pass `--no-build-check`;
`scripts/benchmark.py` re-runs `fetch_models.py build` for the same reason. To force a rebuild
yourself:

```bash
python3 scripts/fetch_models.py build --force        # rebuild regardless of the stamp
python3 scripts/fetch_models.py build --check        # report the state afterwards
python3 scripts/fetch_models.py build -j 8           # limit parallel jobs
```

## Optional: rich

[`scripts/ui.py`](../../scripts/ui.py) uses [rich](https://rich.readthedocs.io) when it is
importable and falls back to plain aligned text when it is not. With rich you get real tables,
live progress bars with elapsed and remaining time, and themed output; without it you get the
same information from a hand-rolled renderer.

```bash
pip3 install --user rich
```

Nothing here is a hard dependency, and the fallback is not a stub: it measures column widths by
*visible* length, discounting ANSI escapes, which is the bug that motivated writing it. Setting
`NO_COLOR` disables color on either path.

## Setting up the conductor development environment

Conductor is a TypeScript opencode plugin with **zero runtime dependencies** (G1). Everything
in [`conductor/package.json`](../../conductor/package.json) is a `devDependency` — types and
tooling that never ship:

```bash
cd conductor && npm install
```

| Dev dependency        | Version   | Why                             |
| --------------------- | --------- | ------------------------------- |
| `@opencode-ai/plugin` | `1.18.10` | plugin and SDK type definitions |
| `@types/node`         | `^26`     | Node type definitions           |
| `typescript`          | `^5.9`    | `tsc --noEmit` typecheck only   |

The plugin and its tests are `.ts` files that Node v26.7.0 runs directly through type
stripping — no build step, no emitted JavaScript.
[`conductor/tsconfig.json`](../../conductor/tsconfig.json) enforces what makes that possible:
`erasableSyntaxOnly` rejects any syntax that would require a real emit,
`allowImportingTsExtensions` lets imports name the `.ts` file that actually exists, and `noEmit`
makes `tsc` a checker rather than a compiler. The rest is `strict`, `nodenext` modules and an
`es2023` target.

Bun 1.3.14 is opencode's own runtime, so one test — `conductor/tests/bun-smoke.test.ts` — is
authored to be runtime-agnostic and runs under both engines. It is the only file Bun executes;
the rest of the suite is Node-only.

The canonical gate is one command, and it is the only correct way to ask whether conductor is
green:

```bash
bash scripts/test-conductor.sh                              # the whole suite
bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'
```

None of the three gate scripts — `test-conductor.sh`, `conductor-gate.sh` and
`verify-acceptance.sh` — is executable, so always invoke them with `bash`. There is no `npm test`:
[`conductor/package.json`](../../conductor/package.json) declares no `scripts` block at all,
and the only npm command this repository needs is `npm install` inside `conductor/`.

Never run `node --test` directly for a gate decision. On Node v26.7.0 a directory positional
resolves as a module and produces a bogus `MODULE_NOT_FOUND` that looks exactly like a real
failure, and a glob matching zero files exits 0 — a vacuous green. The wrapper parses the TAP
trailer and fails unless `tests > 0` and `fail`, `cancelled`, `skipped` and `todo` are all
zero, and unless no `# SKIP` or `# TODO` directive appears at any subtest depth.

That is one of five legs, run in this order:

| Leg           | Command                                                               | Failure mode                                                   |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| node TAP      | `node --test --test-timeout=120000 --test-reporter=tap <glob>`        | any non-zero count, or zero tests                              |
| typecheck     | `conductor/node_modules/.bin/tsc -p conductor/tsconfig.json --noEmit` | a missing `tsc` is a hard fail, not a skip — run `npm install` |
| bun smoke     | `bun test conductor/tests/bun-smoke.test.ts`                          | a missing `bun` is a loud warning, not a failure               |
| schema export | `node conductor/tools/export-schemas.ts router/tests/schemas`         | non-zero exit; correctness is checked by its own test          |
| python        | `/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'`     | zero discovered tests, or any skip / expected failure          |

The schema export is a generation step, not an assertion, and it runs before the python leg
precisely so the exported `RouterConfig.schema.json` is fresh for the python test that checks
it against `scripts/conductor_wiring.py`. A clean run ends with `GATE PASS`. A failing run
moves its per-leg scratch output to a timestamped directory and prints the path, so a red gate
leaves something to read.

`bash scripts/conductor-gate.sh` is the separate mechanical stub scan. It reads the tracked
TypeScript, C++ and Python sources and fails on stub markers, skipped tests, trivially-true
assertions and empty catch blocks.

## Setting up the C++ toolchain

Dependencies come from vcpkg in manifest mode, and the bootstrap is automatic.
[`cmake/vcpkg-init.cmake`](../../cmake/vcpkg-init.cmake) runs at configure time: it initializes
`extern/vcpkg` if the ports tree is missing, points `CMAKE_TOOLCHAIN_FILE` at
`extern/vcpkg/scripts/buildsystems/vcpkg.cmake` when nothing else set it, and runs
`bootstrap-vcpkg.sh` if the `vcpkg` binary is not there yet. `CMakePresets.json` names the same
toolchain file, so a preset configure works from a bare checkout.

[`vcpkg.json`](../../vcpkg.json) declares seven ports: `pkgconf`, `ftxui`, `spdlog`,
`cpp-httplib`, `nlohmann-json`, `json-schema-validator` and `doctest`. The router links spdlog,
httplib, nlohmann_json and the schema validator; `router-tests` adds doctest. `ftxui` is used
only by the terminal dashboard, which is a separate optional target and is deliberately *not*
linked into the router.

Three presets are configurable directly, all Ninja, all macOS-only, all writing to
`.out/build/<preset>/`. They inherit a hidden `clang` preset, which in turn inherits a hidden
`default` preset. `default` carries the Ninja generator, the vcpkg toolchain file and the
`.out/build/<preset>` binary directory; `clang` adds the clang/clang++ compilers and the
`hostSystemName equals macOS` condition. A third hidden preset, `verbose`, exists but nothing
inherits it.

| Preset              | Build type       |
| ------------------- | ---------------- |
| `clang-debug`       | `Debug`          |
| `clang-release`     | `Release`        |
| `clang-relwdebinfo` | `RelWithDebInfo` |

`clang-relwdebinfo` is the one the project uses:

```bash
cmake --preset clang-relwdebinfo
cmake --build .out/build/clang-relwdebinfo --target llama-router
cmake --build .out/build/clang-relwdebinfo --target router-tests
ctest --test-dir .out/build/clang-relwdebinfo
```

Building `llama-router` is what turns it on for everyday sessions. `scripts/serve.py` looks
first at `$LLAMA_ROUTER` if it is set, then in `.out/build/clang-relwdebinfo/`,
`clang-release/`, `clang-debug/`, `.data/tools/`, and finally on `PATH`. It
also needs the exported `router/tests/schemas/RouterConfig.schema.json`, which any run of the
gate produces. With both present, a session starts the router by default; with either missing,
the session runs directly against `llama-server` and says so.

**Always name a target.** The root `CMakeLists.txt` calls `add_subdirectory(extern/llama-cpp)`
so the vendored tree's CMake surface stays exercised, but no target here links it —
`llama-router` proxies to a separately-launched `llama-server` and needs neither `llama` nor
`ftxui`. A bare `cmake --build` walks into that subtree and compiles all of it for nothing. The
workspace's own targets are `llama-router`, `router-tests` and `membench`; a fourth,
`conductor-dashboard`, is behind `option(CONDUCTOR_DASHBOARD)` and is `OFF` unless you ask for
it. Its doctest cases live inside `router-tests` regardless, so the aggregation code is always
compiled and run. The harness's own llama.cpp binaries come from `fetch_models.py build`, in a
completely separate tree.

Two more build-time facts. The **repository root** is the only user-code include root, so every
in-workspace header is included by its full path from the root
(`#include "router/version.hpp"`) — an include names where the header actually lives no matter
which file includes it. And `AUTOFORMAT_SRC_ON_CONFIGURE`, which defaults to **ON**, runs
`clang-format --style=file -i` across `router/`, `tools/` and `dashboard/` at configure time —
so configuring rewrites tracked C++ files in place. Turn it off with
`cmake --preset clang-relwdebinfo -DAUTOFORMAT_SRC_ON_CONFIGURE=OFF` if you do not want that.

## Credentials and mirrors

Nothing is stored on disk. All three are read from the environment at run time.

| Variable       | Effect                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `HF_TOKEN`     | bearer token sent with every HuggingFace request; required for gated or private repos. `HUGGING_FACE_HUB_TOKEN` is accepted as an alias |
| `HF_ENDPOINT`  | base URL for both the metadata API and the file downloads; defaults to `https://huggingface.co`, trailing slash stripped                |
| `LLAMA_SERVER` | explicit path to a `llama-server` binary, used only when `.data/tools/llama-server` is absent                                           |
| `LLAMA_ROUTER` | explicit path to a `llama-router` binary; checked before the build trees `serve.py` otherwise searches                                  |

```bash
export HF_TOKEN=hf_...
export HF_ENDPOINT=https://hf-mirror.example.com
python3 scripts/fetch_models.py install ornith-35b
```

A 401 or 403 from the metadata API stops the install with a message naming the URL and telling
you to accept the model's terms on its HuggingFace page and export `HF_TOKEN`. Binary
resolution order for the llama.cpp tools is `.data/tools/` first, then `LLAMA_SERVER` for
`llama-server` only, then whatever is on `PATH` — so a submodule-pinned build always wins over
a system one. `llama-router` uses its own order, described above, because CMake writes it into
`.out/build/<preset>/` rather than `.data/tools/`.

## Resetting

Everything the model harness generates lives under `.data/`, so one delete returns the
workspace to a clean checkout:

```bash
rm -rf .data/
```

What that costs: every model must be re-downloaded and re-validated (tens of gigabytes), the
nine llama.cpp binaries must be rebuilt from the submodule, configs must be regenerated, and
all benchmark results and saved session choices are gone. The submodules under `extern/`, the
bootstrapped vcpkg binary and `conductor/node_modules/` are untouched — as is any `.conductor/`
state, which lives with the target workspace being worked on, not here.

Narrower resets are usually what you want:

| Goal                              | Command                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| Drop one model                    | `python3 scripts/fetch_models.py remove <id>`                  |
| Rebuild the llama.cpp tools       | `python3 scripts/fetch_models.py build --force`                |
| Regenerate configs only           | `python3 scripts/fetch_models.py config`                       |
| Re-validate every installed model | `python3 scripts/fetch_models.py verify`                       |
| Clean the C++ build tree          | `rm -rf .out/`                                                 |
| Reinstall conductor dev deps      | `rm -rf conductor/node_modules && cd conductor && npm install` |

## Verifying the install

Four checks, one per surface. Run them in this order after a fresh setup.

```bash
python3 scripts/fetch_models.py status     # 1. installed models, configs, tool build stamp
python3 scripts/fetch_models.py verify     # 2. re-validate every model on disk
bash scripts/test-conductor.sh             # 3. the conductor half
cmake --preset clang-relwdebinfo && \
  cmake --build .out/build/clang-relwdebinfo --target router-tests && \
  ctest --test-dir .out/build/clang-relwdebinfo   # 4. the C++ half
```

1. `status` lists every installed model with its manifest details, the generated config files,
   and the state of the build stamp. It is the single best answer to "did setup actually work".
2. `verify` re-checks exact byte size, SHA-256 against the LFS oid published by HuggingFace,
   GGUF magic and version, and shard-count consistency. Slow, but it is the only thing that
   proves the weights on disk are the weights upstream published.
3. `test-conductor.sh` ends with `GATE PASS` when the TAP counts are clean, `tsc --noEmit`
   passes, the Bun smoke test passes, the JSON Schemas export, and the python suite discovers
   and passes its tests.
4. The CMake block proves vcpkg bootstrapped, the ports resolved, the C++23 toolchain works,
   and the doctest suite passes under ctest.

If any of the four fails, [Troubleshooting](troubleshooting.md) covers the failures that
actually happen.

## See also

- [Quickstart](quickstart.md) — the shortest path from clone to a served model
- [`scripts/README.md`](../../scripts/README.md) — the deep reference for every harness script
- [Models](models.md) — the catalog, quant selection, and what fits your machine
- [Build system](../developer/build-system.md) — CMake targets, presets, and the include rule
- [Testing and verification](../developer/testing-and-verification.md) — what the gate checks and why
