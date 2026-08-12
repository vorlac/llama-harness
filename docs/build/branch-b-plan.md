# Branch B (C++ llama-router) — ready-to-execute scaffold plan

Unblocked (needs 1.1 schemas ✓ + 0.2 streaming finding ✓). Run parallel to the TS spine.
This file de-risks the 11.1 scaffold so it can be picked up cleanly (I read CMakeLists.txt,
Task 11.1 lines 2755–2783, §4.4 lines 1636–1695, §1.1 src layout 380–393 to write it).

## GROUNDWORK CONFIRMED (2026-08-13, before 11.1 execution)

- Submodules ARE populated on main (`git submodule status`: extern/vcpkg @ aae277acf4,
  extern/llama-cpp @ 89e0aa6fd3 — both checked out, no `-` prefix).
- All 4 vcpkg ports present in extern/vcpkg/ports/: cpp-httplib, nlohmann-json,
  json-schema-validator, doctest.
- CMakePresets binaryDir = `${sourceDir}/.out/build/${presetName}`; preset
  `clang-relwdebinfo` exists → build dir `.out/build/clang-relwdebinfo`. `.out` is 879M
  now (gitignored; NEVER rm -rf).
- CMakeLists.txt confirmed to match the surgery description below (myprogram block at
  lines 42-68; `include(vcpkg-init)` line 8; `add_subdirectory(extern/llama-cpp)` line 39;
  `find_package(spdlog)` line 40; `add_subdirectory(tools)` line 72).
- vcpkg.json dependencies currently `[pkgconf, ftxui, spdlog]` — add the 4 ports.
- **DECISION: run Branch B ON MAIN (not a worktree).** Submodules already populated;
  worktree submodule-init is the flagged gotcha; C++ files never overlap conductor/*.ts;
  test-conductor.sh is cmake-independent so the TS spine stays green regardless. Commit
  each 11.x task only at ctest-green; stage Branch B files separately from spine commits.
- Execute 11.1 as ONE focused sequence (surgery + scaffold sources + configure + ctest),
  NOT interleaved with a delicate spine edit.

## The submodule+worktree gotcha (read FIRST)

`git worktree add $TMPDIR/branch-b` does NOT populate submodules. Both `include(vcpkg-init)`
(needs `extern/vcpkg`) and `add_subdirectory(extern/llama-cpp)` (CMakeLists line 39) require
them. In the worktree you MUST run `git submodule update --init` (or symlink/point
`extern/*` at the main checkout's populated submodules) BEFORE `cmake --preset`. If that
proves painful, an acceptable alternative given the TS/C++ files never overlap: do Branch B
ON `main` (its src/router + CMakeLists + vcpkg.json edits don't touch conductor/*.ts), and
just add the `ctest` leg to the green gate from 11.1 on — the TS `test-conductor.sh` is
independent of cmake, so the TS spine stays green regardless of C++ build state. The
worktree's only real benefit here is keeping intermediate non-compiling C++ off `main`.

## CMakeLists.txt surgery (11.1 Step 1) — ORCHESTRATOR-ONLY file

Current state: `project(myprogram)`; a `GLOB_RECURSE src/*.[hc]pp` → `add_executable(myprogram ...)`
linking `spdlog::spdlog ftxui llama` (lines 42–68); `add_subdirectory(tools)` (line 72,
KEEP — membench etc.). `CMAKE_CXX_STANDARD 23` at line 10 — DO NOT lower (llama-router needs
C++23); `add_subdirectory(extern/llama-cpp)` line 39 — KEEP (configure of llama.cpp is fine;
only its BUILD is pre-broken, and the router never links `llama` so its target is never built).

Edits:
1. REMOVE the myprogram block (the GLOB_RECURSE `project_sources`, `add_executable(${PROJECT_NAME} ...)`,
   its `target_compile_features`/`target_include_directories`/`target_link_libraries`). Decision 0.1(e).
2. `find_package(httplib CONFIG REQUIRED)`, `find_package(nlohmann_json CONFIG REQUIRED)`,
   `find_package(nlohmann_json_schema_validator CONFIG REQUIRED)`, `find_package(doctest CONFIG REQUIRED)`
   (spdlog already found at line 40). Verify exact package/target names against the vcpkg ports
   (`httplib::httplib`, `nlohmann_json::nlohmann_json`, `nlohmann_json_schema_validator`,
   `doctest::doctest`) — grep the port's usage or vcpkg_installed share/*/*Config.cmake.
3. `add_executable(llama-router)` from explicit src/router sources (main.cpp, router.cpp,
   admission.cpp, affinity.cpp, schema-observer.cpp, metrics.cpp, config.cpp — add as TDD builds
   them; start with main.cpp + config.cpp). Link httplib + nlohmann_json + the validator + spdlog.
   NO llama, NO ftxui. `target_compile_features cxx_std_23`.
4. `add_executable(router-tests)` from src/router-tests/*.cpp; link doctest + the same libs +
   the router sources under test. `include(doctest)` + `doctest_discover_tests(router-tests)` so
   ctest sees each case. A trivial `TEST_CASE` must build + run green via ctest (11.1 Step 1).
5. Add a router-tests PRE_BUILD step that runs `node conductor/tools/export-schemas.ts` writing
   §2 JSON Schemas into `src/router-tests/schemas/` (add_custom_command). G1 untouched (dev-time only).
6. Optional `conductor-dashboard` (ftxui) target, `option(CONDUCTOR_DASHBOARD ... OFF)`.

## vcpkg.json — ORCHESTRATOR-ONLY
Add to `dependencies` (PRESERVE the existing `pkgconf`, `ftxui`, `spdlog`):
`cpp-httplib`, `nlohmann-json`, `json-schema-validator`, `doctest`. All four confirmed present
in `extern/vcpkg/ports/`.

## Configure (the ~45-min long pole) — BACKGROUND + POLL (§2.7)
`cmake --preset clang-relwdebinfo` (NOT `--build --preset` — presets are configure-only). Run
backgrounded, poll for completion; verify port 8080 untouched (irrelevant here but habitual).
Then `cmake --build .out/build/clang-relwdebinfo --target router-tests` and
`ctest --test-dir .out/build/clang-relwdebinfo` for the doctest leg. Build ONLY the router
targets — never a bare `--build` (would hit the pre-broken llama target).

## export-schemas.ts (Task 11.1) — conductor/tools/, a dev script (subagent may write it)
Reads SCHEMAS from conductor/core/types.ts, writes each as `<name>.schema.json` into
src/router-tests/schemas/. A TS test (conductor/tests/) asserts the emitted files parse and
cover the schema names Task 11.6 consumes. Wire it into scripts/test-conductor.sh too (11.1).

## Step 2 (LIVE, manual — §8.4, attempt once): src/router/UPSTREAM_CONTRACT.md
Against live llama-server (serve.py --no-shell, qwen3.6-27b): /v1/models shape;
response_format/json_schema acceptance + GBNF constraining; usage+timings in non-stream; SSE
framing; non-resident-model autoload latency; **effective concurrent slot count** for N∈{1,2,4,8}
with/without --parallel — that number feeds parallel.maxReaders / admission.maxInflightPerModel /
serve.py --parallel (12.1) / acceptance row 10. M8 rules: verbatim commands + raw output only;
BLOCKED+commands if it can't run. FABRICATION IS THE WORST OUTCOME.

## 11.6 scope (pinned by 0.2): responses STREAM (SSE), requests carry NO schema field.
So schema-observer's response-validation sees nothing on the fan-out path → 11.6 shrinks to the
request-side `schemaMissing` counter + a recorded note (§4.4 lines 1674–1679). Non-stream
response validation still implemented for completeness but is inert on streamed traffic.
