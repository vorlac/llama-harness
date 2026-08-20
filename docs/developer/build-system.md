# Build system

How the two halves of this repo are built: CMake plus vcpkg for the C++ router and tools, and
nothing at all for the TypeScript plugin. For developers who need to configure, build, test, or
change a target.

## Two build systems, one repo

The C++ half is a normal CMake project. [`CMakeLists.txt`](../../CMakeLists.txt) at the repo root
declares the executables, [`CMakePresets.json`](../../CMakePresets.json) supplies the
configurations, and [`vcpkg.json`](../../vcpkg.json) declares the third-party ports. Everything it
produces lands under the gitignored `.out/`.

The TypeScript half has no build system at all — no bundler, no transpile step, no output
directory — because nothing ever consumes compiled JavaScript:

- **opencode loads `.ts` source directly.** The plugin entry in
  [`conductor/opencode-fragment.json`](../../conductor/opencode-fragment.json) is
  `${LLAMA_HARNESS_ROOT}/conductor/plugin/index.ts` — a TypeScript path. opencode runs on Bun,
  which executes TypeScript natively, so a build step would only insert a stale artifact between
  the source and the runtime.
- **Node strips types for the tests.** [`scripts/test-conductor.sh`](../../scripts/test-conductor.sh)
  runs `node --test --test-reporter=tap conductor/tests/**/*.test.ts` against the `.ts` files
  themselves. Node v26 erases the annotations and runs what is left.

TypeScript is therefore only a *checker* here, never a compiler: `tsc` runs with `--noEmit` and
produces no files. The plugin you edit is the plugin that runs, in both runtimes.

## CMake targets

Four executables. Three are declared at the top level, one of them behind an option;
`membench` arrives through `add_subdirectory(tools)`.

| Target                | Sources                          | Links                                                                                                                       | Purpose                                           |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `llama-router`        | `router/main.cpp`                | `spdlog`, `httplib`, `nlohmann_json`, `nlohmann_json_schema_validator`                                                      | The fail-soft proxy in front of `llama-server`    |
| `router-tests`        | nine files under `router/tests/` | the above plus `doctest`                                                                                                    | The router's doctest suite, registered with ctest |
| `conductor-dashboard` | `dashboard/main.cpp`             | `spdlog`, `nlohmann_json`, `nlohmann_json_schema_validator`, plus `ftxui::screen/dom/component` — no httplib and no doctest | Optional ftxui TUI over the metrics ledger        |
| `membench`            | `tools/membench/membench.cpp`    | `Threads::Threads`                                                                                                          | Standalone memory-bandwidth probe                 |

All four set `cxx_std_23` explicitly with `target_compile_features`, on top of the project-wide
`CMAKE_CXX_STANDARD 23`. The three that are not `membench` each add the **repo root** as their
single private include directory and nothing else — see [the include rule](#the-include-rule).

`router-tests` compiles `scaffold_test.cpp`, `config_test.cpp`, `proxy_test.cpp`,
`admission_test.cpp`, `affinity_test.cpp`, `schema_observer_test.cpp`, `metrics_test.cpp`,
`cli_test.cpp` and `dashboard_test.cpp`. Source lists are explicit rather than globbed, so a new
`.cpp` under `router/` or `router/tests/` is compiled only once it is added to the relevant
`add_executable` call.

**`conductor-dashboard` is `OFF` by default**, behind `option(CONDUCTOR_DASHBOARD …)`, so no
ordinary build pays for ftxui and neither default target ever links it:

```bash
cmake --preset clang-relwdebinfo -D CONDUCTOR_DASHBOARD=ON
cmake --build .out/build/clang-relwdebinfo --target conductor-dashboard
```

Its *pure* half — the aggregation header `dashboard/ledger_view.hpp`, which links nothing — is
exercised by `router/tests/dashboard_test.cpp`, which is in the `router-tests` source list rather
than a target of its own. So the dashboard's logic is always built and always run even when the
terminal UI is not. The
binary itself links `nlohmann_json_schema_validator` as well, because it reuses `router/config.hpp`
to read `metrics.ledgerPath` from the same config the router does, and that header validates
through a compiled library rather than a header-only one.

Test registration is two lines:

```cmake
enable_testing()
add_test(NAME router-tests COMMAND router-tests)
```

`enable_testing()` runs at the top level so `ctest` works from the binary directory root, and the
whole doctest binary is registered as one ctest entry. doctest's `doctest_discover_tests` can later
split it into one ctest case per doctest case without changing anything else — a reporting choice,
not a correctness one, since doctest already reports each case individually inside the run.

## The build-only-named-targets rule

**Always build a named target. Never run a bare `cmake --build`.** The root `CMakeLists.txt` calls
`add_subdirectory(extern/llama-cpp)` so the vendored tree's CMake surface stays exercised, but no
target in this project depends on it: `llama-router` links neither `llama` nor `ftxui`, because it
proxies to a separately-launched `llama-server` and needs neither library. A bare `cmake --build`
walks the whole default target set and compiles all of llama.cpp — minutes of work producing
artifacts nothing here consumes.

```bash
# safe
cmake --build .out/build/clang-relwdebinfo --target llama-router
cmake --build .out/build/clang-relwdebinfo --target router-tests
cmake --build .out/build/clang-relwdebinfo --target membench
cmake --build .out/build/clang-relwdebinfo --target conductor-dashboard   # needs -D CONDUCTOR_DASHBOARD=ON at configure

# not safe - also builds all of extern/llama-cpp
cmake --build .out/build/clang-relwdebinfo
```

### Why the submodule is scoped to C++17

`CMAKE_CXX_STANDARD` is inherited across `add_subdirectory`, and llama.cpp pins itself to C++17 and
marks it "don't bump" in `src/CMakeLists.txt` and `ggml/src/CMakeLists.txt`. Left at 23, the
vendored sources compile at a standard upstream never builds against: under C++23 `std::make_unique`
is `constexpr`, which instantiates `llama_model_dflash::graph<>` and `llama_model_eagle3::graph<>`
before the explicit specializations further down those files, and the build fails. So the root
tree drops the standard to 17 across the `add_subdirectory` call and restores it afterwards:

```cmake
set(CMAKE_CXX_STANDARD 17)
add_subdirectory(extern/llama-cpp)
set(CMAKE_CXX_STANDARD 23)
```

This costs the project nothing, because every target here requests `cxx_std_23` individually
through `target_compile_features` rather than relying on the directory default.

The llama.cpp binaries this workspace actually runs do not come from this tree at all. They are
built out-of-tree by `scripts/fetch_models.py build` — see
[the llama.cpp submodule](#the-llamacpp-submodule).

## Presets

[`CMakePresets.json`](../../CMakePresets.json) is schema version 5 and defines three hidden bases
plus three concrete presets.

| Preset              | Hidden | Inherits  | Adds                                                                                             |
| ------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------ |
| `default`           | yes    | —         | Ninja generator, vcpkg toolchain file, `.out/` layout, `NINJA_STATUS` format                     |
| `verbose`           | yes    | `default` | `VERBOSE=true` in the environment                                                                |
| `clang`             | yes    | `default` | `CMAKE_C_COMPILER=clang`, `CMAKE_CXX_COMPILER=clang++`; conditional on `hostSystemName == macOS` |
| `clang-debug`       | no     | `clang`   | `CMAKE_BUILD_TYPE=Debug`                                                                         |
| `clang-release`     | no     | `clang`   | `CMAKE_BUILD_TYPE=Release`                                                                       |
| `clang-relwdebinfo` | no     | `clang`   | `CMAKE_BUILD_TYPE=RelWithDebInfo`                                                                |

Only the build type distinguishes the three concrete presets; `clang-relwdebinfo` is the one this
project uses, and it is the preset every gate record and every command on this page names. The
`clang` base is conditional on `hostSystemName == macOS`, so on any other host all three concrete
presets are unavailable — this is a macOS-on-Apple-Silicon project and the preset file says so
rather than failing later. Both directories are derived from the preset name, so every
configuration is self-contained and no two ever share a cache:

```text
.out/build/<presetName>      # binaryDir
.out/install/<presetName>    # installDir
```

Hence `.out/build/clang-relwdebinfo` in every build command on this page.

## vcpkg

Dependencies are declared in manifest mode. [`vcpkg.json`](../../vcpkg.json) lists seven ports:

| Port                    | `find_package` name              | Used by                                                   |
| ----------------------- | -------------------------------- | --------------------------------------------------------- |
| `pkgconf`               | —                                | build-time dependency resolution for other ports          |
| `spdlog`                | `spdlog`                         | `llama-router`, `router-tests`                            |
| `cpp-httplib`           | `httplib`                        | `llama-router`, `router-tests`                            |
| `nlohmann-json`         | `nlohmann_json`                  | `llama-router`, `router-tests`                            |
| `json-schema-validator` | `nlohmann_json_schema_validator` | `llama-router`, `router-tests`                            |
| `doctest`               | `doctest`                        | `router-tests`                                            |
| `ftxui`                 | `ftxui`                          | `conductor-dashboard`, only when `CONDUCTOR_DASHBOARD=ON` |

The validator's imported target is `nlohmann_json_schema_validator::validator`, not a repeat of the
package name. The toolchain wiring lives in [`cmake/vcpkg-init.cmake`](../../cmake/vcpkg-init.cmake),
`include`d before `project()` — the only place a toolchain file can still take effect. It runs
`git submodule update --init extern/vcpkg` if `extern/vcpkg/ports` is missing; points
`CMAKE_TOOLCHAIN_FILE` at `extern/vcpkg/scripts/buildsystems/vcpkg.cmake` if it is unset, warning
rather than failing when that path does not exist; and runs `bootstrap-vcpkg.sh`
(`bootstrap-vcpkg.bat` on Windows) if the `vcpkg` binary is missing, hard-erroring if it still is
not there. The presets set `toolchainFile` directly too, so the second step is the fallback for a
configure that does not go through a preset.

**The first configure is expensive.** vcpkg builds every port from source into a local binary
cache; adding the four router ports to a fresh tree took about 45 minutes on the reference host
(recorded in [`docs/build/HANDOFF.md`](../../docs/build/HANDOFF.md)). Run it in the background and
poll. Subsequent configures hit the cache and take seconds.

## The include rule

The **repo root** is the only user-code include root: `llama-router`, `router-tests` and
`conductor-dashboard` each get exactly one top-level
`target_include_directories(... PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")` and no other, and
`membench` — one self-contained translation unit that includes nothing from the workspace —
sets none at all. So every in-workspace header is included by its full path from the root:

```cpp
#include "router/version.hpp"   // right
#include "router/config.hpp"    // right

#include "version.hpp"          // wrong
#include "../router/config.hpp" // wrong
```

What it buys: an include names where the header actually lives, no matter which file is doing the
including. `router/main.cpp` sits inside `router/` and `router/tests/config_test.cpp` one level
down, yet both spell a router header the same way, and `dashboard/main.cpp` reuses
`router/config.hpp` with the identical line. There are no per-directory include paths to keep in
sync, no relative-path chains that break when a file moves, and no ambiguity about which
`config.hpp` a bare name resolves to — and a new top-level source directory needs no include
change at all.

## Formatting

C++ style is defined by [`.clang-format`](../../.clang-format) at the repo root: four-space indent,
`ColumnLimit: 0` (no automatic wrapping — line breaks are the author's choice), LF line endings,
`BreakBeforeBraces: Custom` with same-line braces except before `else` and after `extern` blocks,
`SortIncludes: true`, and `IncludeBlocks: Regroup` with categories that sort system headers ahead
of quoted project headers. It is never applied on build — only at *configure* time, governed by
one option:

```bash
cmake --preset clang-relwdebinfo -D AUTOFORMAT_SRC_ON_CONFIGURE=OFF
```

`AUTOFORMAT_SRC_ON_CONFIGURE` **defaults to `ON`**, so an ordinary `cmake --preset` reformats. The
root `CMakeLists.txt` then includes [`cmake/clang-format.cmake`](../../cmake/clang-format.cmake),
which globs `router/`, `tools/` and `dashboard/` for `*.[hc]` and `*.[hc]pp` — never `extern/` —
and runs `clang-format --style=file -i` over every match, printing each file as it goes. If
`clang-format` is not on `PATH` the module does nothing rather than failing the configure.

Two consequences follow. It rewrites the **working tree**, not the build tree — the reformatted
files are your source files and show up in `git status` immediately. And if a diff contains C++
reformatting nobody typed, that is this option, not a hand edit; review it as its own format-only
change rather than folding it into a behavioral commit.

## cmake/ modules

Four modules live in `cmake/`, found via `CMAKE_MODULE_PATH`.

| Module                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`vcpkg-init.cmake`](../../cmake/vcpkg-init.cmake)               | Initializes the vcpkg submodule, bootstraps the `vcpkg` binary, and sets `CMAKE_TOOLCHAIN_FILE` if it is unset. Included before `project()`.                                                                                                                                                                                                                                                                                                                                                            |
| [`clang-format.cmake`](../../cmake/clang-format.cmake)           | Finds `clang-format` and formats `router/`, `tools/` and `dashboard/` in place. Included when `AUTOFORMAT_SRC_ON_CONFIGURE` is `ON`, which is the default.                                                                                                                                                                                                                                                                                                                                              |
| [`cmake-utils.cmake`](../../cmake/cmake-utils.cmake)             | Diagnostics: `print_project_variables()` (called on include, prints the compiler/toolchain/path banner you see at configure), and `dump_cmake_variables()`. The banner calls `dump_cmake_variables(".*")` on every configure, though its output is `message(DEBUG ...)` and stays hidden under the root's `CMAKE_MESSAGE_LOG_LEVEL STATUS`. |

## Standalone tools

[`tools/`](../../tools/README.md) holds measurement tools that carry **no project
dependencies**, deliberately: `tools/CMakeLists.txt` is the single line
`add_subdirectory(membench)`, and `membench` links only `Threads::Threads`. That constraint exists
so the tool builds two ways — through the tree, or with one compiler invocation and no CMake, no
vcpkg, no configure:

```bash
cmake --build .out/build/clang-relwdebinfo --target membench
mkdir -p .out/build && c++ -std=c++23 -O3 tools/membench/membench.cpp -o .out/build/membench
```

`membench` forces `-O3` even in a Debug configuration, because an `-O0` build measures loop
overhead rather than the memory system, and its warning flags are spelled out locally instead of
reusing the root scope's generator expressions, so the directory stays self-contained.

`scripts/hostinfo.py` is the consumer. It honors a `MEMBENCH_BIN` override, then globs every
configured preset tree for `.out/build/*/tools/membench/membench`, newest first, rejecting any
binary older than the source so a stale one never silently measures old code. If no usable binary
exists it compiles the source on demand with `$CXX` (or `c++`, or `clang++`) at `-O3`, trying
`c++23` then `c++20`, and writes the result to `.out/build/membench` — beside the preset trees, so
there is exactly one place binaries land. Only if that fails does it fall back to a pure-Python
bandwidth estimate, a figure that includes page-fault cost and reads roughly a third low. The full
methodology — what the tool was built to answer, and why absolute alignment turned out not to
matter — is in [`tools/README.md`](../../tools/README.md).

## The llama.cpp submodule

`.gitmodules` declares two submodules: `extern/vcpkg` from `microsoft/vcpkg`, and
`extern/llama-cpp` from `ggml-org/llama.cpp`. `extern/llama-cpp` is pinned to a specific commit,
and the root CMake tree only configures it. The binaries this workspace runs are built separately
by `scripts/fetch_models.py build`, which configures llama.cpp into `.data/build` with a fixed flag
set and copies nine binaries into `.data/tools/`:

```text
-DCMAKE_BUILD_TYPE=Release  -DGGML_METAL=ON       -DLLAMA_BUILD_SERVER=ON
-DLLAMA_BUILD_TESTS=OFF     -DLLAMA_BUILD_EXAMPLES=OFF  -DLLAMA_CURL=OFF
```

The targets are `llama-server`, `llama-bench`, `llama-perplexity`, `llama-cli`, `llama-mtmd-cli`,
`llama-tts`, `llama-batched-bench`, `llama-tokenize`, and `llama-quantize`. The build then writes
`.data/tools/.build-stamp.json` recording `sha` (the submodule commit the binaries came from),
`built_at`, `cmake_flags`, `targets`, and `host`.

**Rebuild on drift.** Before anything that needs a binary, `ensure_tools()` compares that stamp
against reality and rebuilds if `extern/llama-cpp` is not a git checkout, if any of the nine
binaries is missing from `.data/tools/`, if the stamp's `sha` differs from the submodule's current
`HEAD`, or if the stamp's `cmake_flags` differ from the set above. Moving the pin is therefore
enough on its own: the next `serve` or `benchmark` rebuilds without being asked.

## The TypeScript side

[`conductor/package.json`](../../conductor/package.json) declares `"private": true`,
`"type": "module"`, and three **dev-only** dependencies. There are no runtime dependencies at all:

| Dependency            | Version   | Why                             |
| --------------------- | --------- | ------------------------------- |
| `@opencode-ai/plugin` | `1.18.10` | Plugin and SDK type definitions |
| `@types/node`         | `^26`     | Node type definitions           |
| `typescript`          | `^5.9`    | `tsc --noEmit` typechecking     |

All three exist to type-check and nothing else; the shipped plugin imports none of them at runtime.
The `@opencode-ai/plugin` pin is a **types** pin, not the runtime contract: the installed opencode
binary is 1.18.15, and where the two disagree the code is written against 1.18.15's observed
behavior. [`conductor/adapter/wire-notes.md`](../../conductor/adapter/wire-notes.md) records which
behaviors those are.

`conductor/package.json` has **no `scripts` block**, so `npm test`, `npm run build` and
`npm run typecheck` do not exist. `npm install` is the only npm command this repo needs, and the
typecheck is reached through the gate wrapper or by invoking `tsc` directly.
[`conductor/tsconfig.json`](../../conductor/tsconfig.json) is `strict`, `noEmit`, `nodenext` module
and resolution, targeting `es2023`. Two options carry the no-build design:

- **`erasableSyntaxOnly: true`** rejects any TypeScript syntax that cannot be removed by simply
  deleting it — `enum`, `namespace` with runtime members, constructor parameter properties. Node
  erases annotations; it does not *compile*. This flag makes `tsc` fail on exactly the constructs
  that would make the source unrunnable under Node, so the typechecker keeps the tests runnable.
- **`allowImportingTsExtensions: true`** permits `import { globMatch } from "./shell-parse.ts"` —
  importing the file that actually exists on disk, rather than a `.js` file that is never emitted.
  That is what both runtimes resolve.

`npm install` in `conductor/` exists only to populate `conductor/node_modules/` with those three
packages. Nothing it installs is deployed, imported at runtime, or committed;
[`scripts/test-conductor.sh`](../../scripts/test-conductor.sh) reaches into
`conductor/node_modules/.bin/tsc` for its typecheck leg and fails loudly if the tree is absent.

## What is gitignored

| Path                      | Why                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.out/`                   | CMake build and install trees, one subdirectory per preset                                                    |
| `.data/`                  | Everything the harness generates: models, llama.cpp build, `.data/tools/` binaries, configs                   |
| `build/`, `out/`          | Ad-hoc CMake trees. Ignored to *catch* a stray `cmake -B build`, not to sanction one — both should stay empty |
| `conductor/node_modules/` | Dev-only type tooling; reproducible from `package.json`                                                       |
| `router/tests/schemas/`   | The JSON Schemas regenerated from `core/types.ts` on every test run                                           |
| `__pycache__/`, `*.pyc`   | Python bytecode                                                                                               |
| `staging/`                | The build's scratch area for a red test file parked until the task that owns it starts                        |

One deliberate exception: `.gitignore` matches `build/` at any depth, which would swallow
`docs/build/` — so the next line re-includes it with `!docs/build/`. `docs/build/` is not a build
tree. It holds `HANDOFF.md`, `STATE.json`, `CORRECTIONS.md`, and the rest of the durable build
state; losing it would lose the record of what was built and why. The generated schemas, by
contrast, are ignored for the same reason the plugin has no build step: they are derived from
`conductor/core/types.ts`, and a committed copy could disagree with its source.

## Common commands

| Command                                                               | What it does                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `cmake --preset clang-relwdebinfo`                                    | Configure into `.out/build/clang-relwdebinfo` (slow on the first run)  |
| `cmake --build .out/build/clang-relwdebinfo --target llama-router`    | Build the router binary                                                |
| `cmake --build .out/build/clang-relwdebinfo --target router-tests`    | Build the doctest suite                                                |
| `ctest --test-dir .out/build/clang-relwdebinfo --output-on-failure`   | Run the registered C++ test                                            |
| `cmake --build .out/build/clang-relwdebinfo --target membench`        | Build the bandwidth probe                                              |
| `cd conductor && npm install`                                         | Populate the dev-only type tooling                                     |
| `bash scripts/test-conductor.sh`                                      | The canonical gate: TAP suite, `tsc`, Bun smoke, schema export, Python |
| `bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'`    | Same gate over a subset                                                |
| `bash scripts/conductor-gate.sh`                                      | Mechanical stub scan over tracked TypeScript, C++ and Python sources   |
| `conductor/node_modules/.bin/tsc -p conductor/tsconfig.json --noEmit` | Typecheck alone, for a fast edit loop                                  |
| `scripts/fetch_models.py build`                                       | Rebuild the llama.cpp binaries into `.data/tools/`                     |
| `bash scripts/verify-acceptance.sh`                                   | The §11 acceptance checklist as an executable artifact                 |

Never run `node --test` directly for a pass/fail decision: the wrapper exists because raw
`node --test` produces both false reds and vacuous greens on this Node version. The reasoning is in
[testing and verification](testing-and-verification.md).

## See also

- [Testing and verification](testing-and-verification.md) — what the canonical gate checks and why
- [llama-router](llama-router.md) — what the `llama-router` target is being built into
- [Project status](project-status.md) — what is built, what is next
- [`tools/README.md`](../../tools/README.md) — membench methodology and results
- [`scripts/README.md`](../../scripts/README.md) — the model-harness scripts in full
