# Verification Commands Reference

Standard commands for building, testing and mechanically checking this repository
(llama-harness: the `conductor` TypeScript harness, the `llama-router` C++ proxy, the
Python model-serving scripts, and the standalone tools under `tools/`).

Every command is written to be run from the repository root.

---

## Build Verification

The CMake tree covers the C++ half only: `router/`, `dashboard/` and `tools/`. The
TypeScript harness under `conductor/` and the Python scripts under `scripts/` are not
compiled and are verified by the test gate below.

### Configure and build

```bash
# Configure. CMakePresets.json puts the build tree at .out/build/<presetName>.
cmake --preset clang-relwdebinfo

# Build a named target. NEVER a bare `cmake --build <dir>` with no --target: the
# default target reaches the vendored llama.cpp subdirectory, which
# scripts/verify-acceptance.sh records as pre-broken in this configuration.
cmake --build .out/build/clang-relwdebinfo --target llama-router
cmake --build .out/build/clang-relwdebinfo --target router-tests

# Run the C++ suite. CMake registers one ctest test, which runs the whole
# doctest binary.
ctest --test-dir .out/build/clang-relwdebinfo
```

### Available presets

Three usable configure presets, all clang, all gated on `hostSystemName == macOS`
(`CMakePresets.json`). `default`, `verbose` and `clang` are hidden bases and cannot be
selected directly.

| Preset | Build type |
|--------|------------|
| `clang-debug` | `Debug` |
| `clang-release` | `Release` |
| `clang-relwdebinfo` | `RelWithDebInfo` |

`clang-relwdebinfo` is the preset the acceptance script assumes
(`scripts/verify-acceptance.sh`), so prefer it unless a debug build is the point.

### Targets

| Target | What it is | Built by default |
|--------|------------|------------------|
| `llama-router` | The proxy/scheduler binary in front of `llama-server` | yes |
| `router-tests` | The doctest suite over `router/` and `dashboard/ledger_view.hpp` | yes |
| `membench` | Dependency-free memory-bandwidth probe (`tools/membench`) | yes |
| `conductor-dashboard` | Optional ftxui TUI over the router's metrics ledger | no — `-DCONDUCTOR_DASHBOARD=ON` |

```bash
cmake --preset clang-relwdebinfo -DCONDUCTOR_DASHBOARD=ON
cmake --build .out/build/clang-relwdebinfo --target conductor-dashboard
```

### Configure-time formatting

`AUTOFORMAT_SRC_ON_CONFIGURE` defaults to `ON`, and `cmake/clang-format.cmake` then
rewrites every `router/`, `tools/` and `dashboard/` source in place during configure.
Configuring can therefore leave the working tree dirty. Turn it off with
`-DAUTOFORMAT_SRC_ON_CONFIGURE=OFF` when that matters.

---

## The Test Gate

`scripts/test-conductor.sh` is the canonical gate. It has five legs and prints
`GATE PASS` on success; anything else is a red.

```bash
bash scripts/test-conductor.sh                      # the whole conductor suite
bash scripts/test-conductor.sh 'conductor/tests/doctrine.test.ts'   # one file
bash scripts/test-conductor.sh 'conductor/tests/fsm-*.test.ts'   # a glob
```

A directory argument is rewritten to `<dir>/**/*.test.ts`; the suite is flat, so
`conductor/tests` is the only directory that holds tests.

The five legs, in order:

1. **node TAP** — `node --test --test-timeout=120000 --test-reporter=tap` over the glob.
2. **typecheck** — `conductor/node_modules/.bin/tsc -p conductor/tsconfig.json --noEmit`.
3. **bun smoke** — `bun test conductor/tests/bun-smoke.test.ts`, the one runtime-agnostic file.
4. **schema export** — `node conductor/tools/export-schemas.ts router/tests/schemas`, a
   generation step so the C++ suite validates against the same JSON Schemas the
   TypeScript side uses.
5. **python** — `/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'`.

Two things the wrapper exists to prevent, and the reason to never call `node --test`
directly: a directory positional resolves as a module and produces a bogus
`MODULE_NOT_FOUND` failure indistinguishable from a real one, and a glob matching zero
files exits 0 — a vacuous green. The wrapper also fails on a zero test count, on any
skipped/todo test, and on any `# SKIP`/`# TODO` TAP directive at any depth.

A red gate moves its scratch directory to
`${TMPDIR:-/tmp}/conductor-gate-failed.<timestamp>.<pid>` and prints the path, so leg
output survives for inspection.

The typecheck leg is a hard failure when `tsc` is absent, not a skip. Install it once:

```bash
npm install --prefix conductor
```

`conductor/package.json` has no `scripts` block, so there is no `npm test`,
`npm run build` or `npm run typecheck` — the gate script is the entry point.

### Running a single leg

```bash
conductor/node_modules/.bin/tsc -p conductor/tsconfig.json --noEmit
/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'
node conductor/tools/export-schemas.ts router/tests/schemas
bun test conductor/tests/bun-smoke.test.ts
```

The Python leg pins `/usr/bin/python3` (the system interpreter) deliberately: the
harness scripts are standard-library-only and must keep working on a bare macOS
Python. The two discovered suites are `scripts/test_conductor_wiring.py` and
`scripts/test_conductor_bench.py`.

---

## Mechanical Source Scan

`scripts/conductor-gate.sh` scans committed sources for stub markers, skipped or todo
tests, trivially-true assertions and empty catch blocks.

```bash
bash scripts/conductor-gate.sh                       # all tracked sources
bash scripts/conductor-gate.sh conductor/core/fsm-run.ts  # a specific file
```

With no arguments it scans `conductor/**/*.ts`, `router/**`, `tools/**` and
`scripts/*.py`. It does not scan `scripts/*.sh`, `dashboard/`, `cmake/` or JSON. In
no-argument mode it also enforces file-count floors per language, so a glob that stops
matching (because a tree moved) fails loudly instead of reporting a clean scan over an
empty set.

---

## Acceptance

`scripts/verify-acceptance.sh` runs the plan's acceptance checklist as executable
rows plus a set of hollowness detectors, and prints one PASS/FAIL line per row.

```bash
bash scripts/verify-acceptance.sh           # the real run
bash scripts/verify-acceptance.sh --quick   # skips the node suite and the C++ build
```

`--quick` is for iterating on the script itself and never counts as acceptance; the
script says so in its own output. The real run drives `scripts/test-conductor.sh`,
builds `router-tests` and runs `ctest`, so it needs a configured build tree at
`.out/build/clang-relwdebinfo`.

---

## Source Layout

Knowing where code lives is a prerequisite for every grep below.

| Tree | Language | Notes |
|------|----------|-------|
| `router/` | C++23, header-only plus `main.cpp` | `router/tests/` holds the doctest suite |
| `dashboard/` | C++23 | `ledger_view.hpp` is pure and compiled into `router-tests` |
| `tools/membench/` | C++23 | No project dependencies |
| `conductor/` | TypeScript | `core/`, `adapter/`, `plugin/`, `tools/`, `tests/` are the TS trees `tsconfig.json` includes; `doctrine/` and `docs/` are Markdown |
| `scripts/` | Python 3.9 + bash | Model fetch/serve/benchmark, gate scripts |
| `extern/` | vendored | llama.cpp and vcpkg submodules — never scanned or edited |

There is no `include/` directory. The repository root is the only user-code include
root, so every in-workspace header is included by its full path from the root
(`#include "router/config.hpp"`, `#include "dashboard/ledger_view.hpp"`).

---

## Code Quality Checks

These are lead generators for a human reading a diff, not verdicts. The mechanized
checks are the gate scripts above.

### Include spelling

Every in-workspace include must be rooted at the repository root. This prints nothing
when the rule holds:

```bash
grep -rn '#include "' router/ dashboard/ tools/ \
  | grep -v '#include "\(router\|dashboard\|tools\)/'
```

### Incomplete-work markers

```bash
grep -rnE '\b(TODO|FIXME|XXX|HACK)\b' router/ dashboard/ tools/ conductor/core conductor/adapter conductor/plugin scripts/
```

`scripts/conductor-gate.sh` covers the same ground with the exemptions the test trees
legitimately need; prefer it for a verdict.

### Prohibited comment language

The vocabulary rule (see [patterns-and-conventions.md](patterns-and-conventions.md))
is mechanized for TypeScript only, by `conductor/tests/comment-hygiene.test.ts`, which
scans comment text under `conductor/core`, `conductor/adapter` and `conductor/plugin`.
It runs as part of the node leg of the gate.

The C++ and Python trees are reviewed by hand. These greps generate candidates and do
produce false positives, because "fixed", "new" and "now" are ordinary words:

```bash
# Change narration
grep -rnE '//.*\b(changed|updated|previously|formerly|refactored)\b' router/ dashboard/ tools/

# Attribution. The only legitimate hits name scripts/watch-agents.sh, which reads
# Claude Code transcripts; anything else is a comment to reword.
grep -rniE '(claude|ai-generated|authored by)' router/ dashboard/ tools/ scripts/
```

### C-style casts

Prefer `static_cast` and friends. This prints nothing when the rule holds:

```bash
grep -rnE '\(\s*(int|unsigned|char|std::size_t|double|float)\s*\)' router/ dashboard/ tools/
```

### Unwired test files

A `router/tests/*.cpp` that is not named in `CMakeLists.txt` is never compiled, so its
cases silently do not run. This prints nothing when every file is wired:

```bash
for f in router/tests/*.cpp; do
  grep -q "$(basename "$f")" CMakeLists.txt || echo "not in CMakeLists.txt: $f"
done
```

---

## Include Graph Analysis

```bash
# Includes per header, heaviest first
for f in router/*.hpp dashboard/*.hpp; do echo "$f: $(grep -c '#include' "$f")"; done \
  | sort -t: -k2 -rn

# Which headers pull in the vcpkg dependencies
grep -rn '#include <\(httplib\|nlohmann\|spdlog\|doctest\|ftxui\)' router/ dashboard/ tools/
```

`tools/membench` must stay dependency-free: the second command finding a hit under
`tools/` is a regression, because `scripts/hostinfo.py` compiles that translation unit
itself — `$CXX`, else `c++`, else `clang++`, at `-std=c++23` with a `-std=c++20` retry —
whenever no preset-built binary newer than `membench.cpp` is found.

---

## TypeScript Purity Checks

`conductor/core` imports nothing but relative `.ts` modules that resolve inside
`conductor/core` — no node built-ins, no packages — which is what makes it testable
without any runtime. `adapter/` and `plugin/` may reach for node built-ins but must
stay runtime-agnostic so the bun leg passes. Both properties are mechanized by
`conductor/tests/purity.test.ts`. To look by hand:

```bash
# Every non-relative import in core. Must print nothing.
grep -rn "^import .* from \"" conductor/core/ | grep -v 'from "\./'

# Runtime-specific globals in the dual-runtime trees
grep -rnE '\b(Bun|Deno)\b' conductor/adapter/ conductor/plugin/
```
