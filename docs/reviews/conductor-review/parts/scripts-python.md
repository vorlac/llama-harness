# Enforcement Review — Part: scripts/ (Python + shell)

**Scope:** every file under `scripts/` (16 tracked files, per `git ls-files scripts/`):
`README.md`, `bench_presets.py`, `benchmark.py`, `conductor-gate.sh`, `conductor_bench.py`,
`conductor_wiring.py`, `fetch_models.py`, `hostinfo.py`, `models_catalog.py`, `serve.py`,
`test-conductor.sh`, `test_conductor_bench.py`, `test_conductor_wiring.py`, `ui.py`,
`verify-acceptance.sh`, `watch-agents.sh`.

`test-conductor.sh`, `conductor-gate.sh`, `verify-acceptance.sh` audited as SUBJECTS (their own
correctness); their mutation-audit belongs to the cross-cutting sweep in step 2b.

**Date:** 2026-08-15
**Reviewer:** enforcement sub-reviewer (scripts scope)
**Status:** COMPLETE. 19 ISSUEs (3 HIGH: -003, -004, -006; 1 MEDIUM-HIGH: -007; 7 MEDIUM:
-001, -002, -008, -009, -011, -015, -016; 8 LOW-range), 16 IDEAs, 7 cross-lens pointers,
9 mutation-table rows, all 16 files covered, final gate re-run GATE PASS, no stray processes.

---

## 1. ISSUE register (SCRIPTS-PYTHON-NNN)

### SCRIPTS-PYTHON-001 — bench cell config restates the fan-out and workflow defaults with no drift guard (P3)

- **Where:** `scripts/conductor_bench.py:744-793` (`build_conductor_cell_config`), specifically
  `"maxReaders": 6` and `"subSessionTimeoutMs": 900000` at lines 786-787, plus the whole
  `workflow` block (lines 770-782).
- **Claim:** `conductor_wiring.py:68` owns `DEFAULT_MAX_READERS = 6` as "ONE literal", and
  `conductor/adapter/config-io.ts:55` restates it *with* a drift guard —
  `conductor/tests/composition.test.ts:816-835` reads `conductor_wiring.py` source at test time and
  asserts equality, precisely because "a drift makes the fan-out serialize upstream while both
  tasks' tests stay green." `build_conductor_cell_config` is a THIRD spelling of the same two
  numbers, in a file that already imports `conductor_wiring` (line 52 uses
  `conductor_wiring.ROUTER_CONFIG_RELPATH`), and it is guarded by nothing. The `workflow` block
  (trivialMaxFiles 2, planReviewers 4, itemReviewers 6, skepticsPerFinding 2, reviewMaxRounds 3,
  vetCritics 3, vetMaxRounds 3, testRepairAttempts 3, debugFixCap 3, maxOverridesPerItem 1,
  maxOverridesPerRun 2) is byte-identical to `DEFAULT_CONFIG.workflow` in `config-io.ts:102-115`
  — a 12-literal restatement with no guard either.
- **What a drift does:** serve.py sizes llama-server's `--parallel` and the router's admission cap
  from `cw.DEFAULT_MAX_READERS`. If that number moves (the guarded pair moves with it), the 90-run
  POC campaign's cells still ask for 6 readers against a server sized for the new number — the
  exact serialize-upstream failure the composition guard exists to prevent, now reintroduced one
  file away. A workflow-number drift is quieter: the campaign measures a different process
  (different reviewer counts, caps) than the product ships, and the report's numbers silently stop
  describing the product.
- **Refutation attempted:** a benchmark arguably *wants* pinned parameters for reproducibility.
  That defends the workflow block only if the pinning is declared — it is not; the docstring calls
  the dict "a pure function of the manifest task" and says nothing about diverging from the
  product default. And it cannot defend `maxReaders`, which must track the served slot count to
  mean anything. Refutation fails.
- **Severity:** MEDIUM. **Fix direction:** derive `maxReaders`/`subSessionTimeoutMs` from
  `conductor_wiring` constants (already imported); either derive the workflow block from the
  product default (schema-export or source-read, as composition.test.ts does) or declare the
  pinning in the docstring and add a drift test that fails when config-io's default moves.

### SCRIPTS-PYTHON-003 — Ctrl-C at the session prompt kills the 20+GB model while the shell survives (reproduced)

- **Where:** `scripts/serve.py:384-402` (`make_rcfile`'s generated trap:
  `trap __llama_harness_cleanup EXIT HUP INT TERM`).
- **What happens:** interactive bash *executes* an INT trap when SIGINT arrives while it sits at
  the readline prompt — and then carries on living. Pressing Ctrl-C at the session prompt (the
  ordinary way to abandon a half-typed command) is exactly that delivery: the terminal sends
  SIGINT to the foreground process group, which at the prompt is the shell itself. The trap runs
  `kill <server-pid>`, waits up to 5s, then `kill -9`. Result: the model is dead, the session
  shell is alive, `LLAMA_HARNESS_URL` points at nothing, the router (if launched) proxies to a
  dead upstream and its supervisor keeps it alive against that dead upstream, and opencode 502s
  on its next prompt. The operator's remedy is to exit and re-run serve.py — a full model reload.
- **Reproduced, not reasoned:** two experiments on this machine (bash resolved the same way
  serve.py resolves it, `shutil.which("bash")`):
  1. minimal rcfile with `trap 'echo TRAP-FIRED ...' EXIT HUP INT TERM`, SIGINT to the
     interactive shell at its prompt → `TRAP-FIRED` logged, shell still alive.
  2. the exact generated trap block from `make_rcfile` verbatim, a detached `/bin/sleep 300`
     standing in for llama-server → after one SIGINT at the prompt: **server alive: False,
     shell alive: True.**
- **The TERM sibling:** interactive bash also survives a trapped SIGTERM, so `kill <shell-pid>`
  produces the same broken half-state (model dead, shell alive, watchdog never fires because the
  shell it polls never died). Lower frequency, same shape.
- **Why nothing caught it:** the rcfile's docstring claims the trap "fires on normal exit, on
  Ctrl-D, and on the SIGHUP a closing terminal sends" — all correct — but INT and TERM are also
  in the list and neither terminates an interactive shell. No test executes the generated rcfile
  under a pty (the C-087 lesson — "main() was executed by nothing" — one layer further out:
  the *rcfile* is executed by nothing).
- **Refutation attempted:** "Ctrl-C while `opencode` runs goes to opencode's process group, not
  bash" — true, and that is the common case; but Ctrl-C at the *prompt* goes to bash, and that is
  an everyday keystroke. Also tried: "bash resets INT traps in interactive mode" — empirically
  false on this machine's bash. Refutations fail.
- **Severity: HIGH.** **Fix direction:** trap `EXIT HUP` only (EXIT covers `exit`/Ctrl-D; HUP
  covers the closing terminal; the detached watchdog already covers SIGKILL and any path where
  no trap runs). If TERM coverage is wanted, its handler must `exit` after cleanup rather than
  leave a zombie session.

### SCRIPTS-PYTHON-002 — the cell-config test pins the verify block but leaves parallel/workflow entirely unpinned (P13-adjacent, partial P2)

- **Where:** `scripts/test_conductor_bench.py:853-883` (`test_conductor_cell_preconfigured`).
- **What it does prove:** behavioralPaths == task's, the visible runner is configured, the hidden
  command does not leak, at least one verify scope exists. Those assertions are real and their
  expected values come from the manifest task, outside the subject. Good.
- **What it does not:** the purity assertion is `cfg == build_conductor_cell_config(task)` — both
  sides the subject (P2 shape; it can only catch nondeterminism, never wrong content). And
  *nothing anywhere* pins `parallel.maxReaders`, `parallel.subSessionTimeoutMs`, any `workflow`
  number, or even `git.mode == "commit"` (only membership in the full enum is asserted —
  a cell config that said `read-only` would pass, and a read-only cell cannot commit its work, so
  every campaign run would score as a failure for a config reason). Mutating `maxReaders` to 60
  or `git.mode` to `read-only` keeps this suite green (verified by inspection of the assertions;
  see mutation table row M2 for the executed check).
- **Severity:** MEDIUM — this is the only enforcement surface for -001's restatements.
- **Fix direction:** assert `git.mode == "commit"` (the docstring's own claim: "answered here from
  the manifest" — commit mode is the answer), and pin `parallel.*` to `conductor_wiring`'s
  constants.


### SCRIPTS-PYTHON-004 — serve.main()'s router "launch" leg is executed by no test; two survived mutations prove it (P12, the C-087 class recurring)

- **Where:** `scripts/serve.py:721-745` (main's `decision.action == "launch"` branch:
  `write_router_config` → `start_router_supervisor` → `finalize_routing` → the
  `stop_router_supervisor` fallback).
- **Context:** C-087's headline was "no test executed serve.py's main()", and the fix built a
  main()-driving harness (`ServeMainCase`). But every main()-driven test passes `--no-router`
  (`test_p12_main_is_driven_at_all`, both orphan legs, the window test) or is `--print-env`
  (which starts nothing). The supervisor and `stop_router_supervisor` ARE executed — but only
  called directly (`test_conductor_wiring.py:1251`, `:1311`), never through main(). So the exact
  class C-087 fixed — defects living in main()'s ordering/argument-passing — persists on the one
  branch its harness did not drive: the branch every real router session takes.
- **Mutations run (both survived the full 80-test python leg):**
  - **M3:** swapped `router_port` and `port` in main's `write_router_config` call
    (`serve.py:724-726`) — every real router session would write a config proxying llama-server's
    port to the router's own listen address, the exact self-proxy defect `resolve_router_port`'s
    docstring warns about. `Ran 80 tests ... OK`.
  - **M4:** deleted the `cw.stop_router_supervisor(supervisor)` call on the fallback leg
    (`serve.py:743`) — a router that fails readiness leaves its supervisor restarting it forever
    against a port the session stopped pointing at, the exact defect
    `test_12_1_readiness_fallback_stops_the_supervisor` exists to prevent (it tests the callee,
    not the call). `Ran 80 tests ... OK`.
- **Note on the source-text pin:** `test_12_1_router_port_never_equals_server_port` pins the
  *resolve* call with `assertIn("router_port = resolve_router_port(host, router_port, port)",
  source)` — a source-grep, which the file itself admits, and which does not reach the
  `write_router_config` call two statements later. (P1: the check inspects less than the property
  needs.)
- **Severity: HIGH** (a whole production branch with zero executed coverage, demonstrated by two
  green mutations of session-breaking defects).
- **Fix direction:** extend `ServeMainCase` with a launch-leg scenario: plant the fake router
  binary + schema under the temp root (the helpers exist — `plant_router_under_temp_root`,
  `start_router_health`), drive main() without `--no-router`, and assert (a) the written router
  config's listen/upstream halves, (b) supervisor spawn args, (c) the fallback leg calls
  stop_router_supervisor when the probe says no.

### SCRIPTS-PYTHON-005 — a mid-file `unittest.main()` makes direct invocation a silent partial pass: 35 of 47 tests (P1)

- **Where:** `scripts/test_conductor_wiring.py:1567-1568` — `if __name__ == "__main__":
  unittest.main()` sits at the file's pre-p12 midpoint; the eight `p12-` classes (~500 lines,
  the C-087 fix coverage) were appended after it.
- **Measured:** `/usr/bin/python3 scripts/test_conductor_wiring.py` → `Ran 35 tests ... OK`;
  `/usr/bin/python3 -m unittest scripts.test_conductor_wiring` → `Ran 47 tests ... OK`.
  `unittest.main()` runs at the moment the interpreter reaches line 1568, before the p12 classes
  are even defined, and then `sys.exit`s — so a direct run executes 35 tests, skips the 12 that
  guard C-087's fixes, and prints an unqualified OK.
- **Why it matters:** the gate (`test-conductor.sh`) uses `unittest discover`, which imports the
  module (guard false) and is unaffected — so the GATE binds. But a human or an agent iterating
  with `python3 scripts/test_conductor_wiring.py` — the most natural invocation — gets a green
  verdict from a suite that cannot see regressions in exactly the recently-fixed area. This is
  the briefing's P1 signature ("a check that passes while inspecting less than it appears to")
  in the suite's own front door, and the same family as the briefing's `node --test` trap.
- **Severity: LOW-MEDIUM.** **Fix direction:** move the guard to the end of the file (one-line
  move); optionally assert a minimum test count somewhere the gate checks.

### SCRIPTS-PYTHON-006 — the "hermetic" cell environment omits PATH, so every live 14.2 cell spawn-fails; the preflight checks a different environment than the spawn uses (reproduced; P1 + P7)

- **Where:** `scripts/conductor_bench.py:590-608` (`build_cell_env`), used at `:955` via
  `default_cell_invocation_runner` → `run_command(..., env=invocation.env)`;
  preflight at `:415-442` (`command_is_spawnable` / `check_commands_spawnable`).
- **What happens:** `build_cell_env` returns exactly seven variables — no `PATH`. `run_command`
  passes that dict as the child's ENTIRE environment. POSIX `execvpe` then resolves a bare
  `opencode` against the new env's PATH, falling back to `os.defpath` (`:/bin:/usr/bin`).
  opencode on this machine is `/opt/homebrew/bin/opencode`.
- **Reproduced with the production functions, unmodified:**
  `cb.run_command(["opencode","--version"], cwd=…, timeout_sec=10, env=cb.build_cell_env(…))`
  → `CommandOutcome(exit_code=None, timed_out=False, spawn_error="[Errno 2] No such file or
  directory: 'opencode'", wall_clock_ms=1)`.
  In the live campaign every one of the 90 cells records `outcome: "harness-error"`; the driver
  then happily writes a complete report over zero real cells.
- **The P1 half:** `check_commands_spawnable` — the driver's own preflight, run before anything
  else in `main()` — uses `shutil.which(program)` with the *driver's* PATH, so it approves
  commands the cells cannot spawn. A check that inspects a different environment than the one
  the property lives in. (It also only checks the *test* commands, which run env-inherited and
  are fine — the one spawn that uses the hermetic env, opencode itself, is exactly the one it
  does not model.)
- **The deeper half:** even with opencode found (say, an absolute argv[0]), its child processes
  — the bash tool, git, every verify command conductor runs *inside* the session — inherit the
  7-variable env and lose PATH too. So a working fix needs a deliberate PATH (pinned, for
  hermeticity), not just an absolute opencode path.
- **Why no test sees it:** every offline test injects `runner`/`test_runner`; the live spawn
  seam is Task 14.2's, which is unbuilt. This is precisely the kind of first-contact failure
  the briefing asks to be found before the campaign burns a night.
- **Severity: HIGH** (blocks 14.2's stated purpose on first contact).
- **Fix direction:** include an explicit `PATH` in `build_cell_env` (e.g. the resolved dirname
  of the opencode binary plus `/usr/bin:/bin`), and make `check_commands_spawnable` resolve
  against the env the cell will actually receive.

### SCRIPTS-PYTHON-007 — the "review findings upheld" metric reads a run-dir file nothing writes; its test fabricates the shape (P2/P13, P4)

- **Where:** `scripts/conductor_bench.py:1220-1238` (`_count_upheld_findings(run_dir /
  "reviews")`), fed into every conductor cell's result at `:990` and the report's
  process-metrics table.
- **The fact:** `conductor/tools/replay.ts:18` states it outright: *"The §1.2 layout lists
  reviews/<itemId|plan>-r<N>.json, but nothing writes that file."* A repo-wide search confirms
  no production code creates a `reviews/` directory under a run dir, and nothing anywhere writes
  the `{"verdicts": [{"upheld": …}]}` shape the reader parses. In the live campaign the metric
  is structurally **0 for every cell** — rendered in the report as a real measured zero
  ("review findings upheld: 0"), indistinguishable from "the review machinery upheld nothing",
  which is exactly the kind of plausible-but-unverified number this benchmark exists to avoid.
- **The test half (P2/P13):** `test_conductor_bench.py:1364-1375` *fabricates*
  `reviews/item-1-r1.json` / `plan-r1.json` with that invented shape and asserts the counter
  reads 3. The test proves the reader parses the test's own invention; it cannot notice that
  production never produces the input. (The docstring of `collect_conductor_metrics` even says
  "read the plugin's own record of the run; recompute nothing it wrote" — the plugin wrote no
  such record.)
- **Refutation attempted:** "the reviews/ writer is simply an unbuilt part of §1.2 and will
  exist by 14.2." Possible — but nothing tracks that dependency: no task, no TODO, no
  cross-reference; and if it lands with a different shape (e.g. keyed by criterion, as the
  actual verdict schema in `core/types.ts:421` `verdictsByCriterion` suggests), the counter
  still reads 0 silently. Refutation fails as a defense of the current state.
- **Severity: MEDIUM-HIGH** (a flagship-report column that cannot ever be non-zero today).
- **Fix direction:** count upheld verdicts from a source that exists — the journal
  (review events) or evidence records — or land the §1.2 reviews writer first and pin the
  bench reader to its real shape with a fixture generated by the writer, not hand-typed.

### SCRIPTS-PYTHON-008 — bench restates the TS stop vocabulary and terminal states with no cross-language drift guard; a new stop kind crashes the campaign (P3)

- **Where:** `scripts/conductor_bench.py:79` (`STOP_KINDS`, "conductor/core/stops.ts STOP_KINDS,
  verbatim"), `:83` (`TERMINAL_RUN_STATES`, from fsm-run.ts), enforced by `validate_result`
  at `:1033-1038`.
- **The gap:** the precedent for this exact situation exists in this repo —
  `conductor/tests/composition.test.ts:816-835` reads `conductor_wiring.py` source at test time
  to pin the python/TS `DEFAULT_MAX_READERS` equality. The bench's copies have no such guard in
  either direction: `test_conductor_bench.py:1169` pins `cb.STOP_KINDS` against a *third*
  hand-typed literal set in the test itself, which moves nothing when `stops.ts` moves.
- **Consequence of drift:** a stop kind added to `stops.ts` (a closed vocabulary, but one this
  project has extended before) appears in a live run.json; `collect_conductor_metrics` returns
  it; `validate_result` raises `BenchError`; `run_cell` propagates; the overnight campaign dies
  mid-flight on the first cell that stops that way — the exact failure mode `run_benchmark`'s
  resume machinery exists to survive, triggered by the driver's own validator.
- **Severity: MEDIUM.** **Fix direction:** a test that reads `conductor/core/stops.ts` (and the
  fsm-run terminal states) and asserts set equality, mirroring composition.test.ts; or have the
  gate's schema-export leg emit the vocabulary for python to consume.

### SCRIPTS-PYTHON-009 — M5 reports PASS over an explicit file list of files that do not exist (reproduced; P1)

- **Where:** `scripts/conductor-gate.sh:125-127` — the scan loop opens with
  `[ -f "$f" ] || continue`; the only emptiness check (`line 45`) fires for an empty *array*,
  not for an array of paths that resolve to nothing.
- **Reproduced:** `bash scripts/conductor-gate.sh no/such/file.ts also-missing.py` →
  `M5 PASS (2 file(s) scanned, 6 line exemption(s) all live)`, exit 0. It scanned zero files and
  reported a count of two.
- **Why this matters here specifically:** C-078's own inline comment in this file records that
  "passing the files explicitly was the standing workaround" through phases 12 and 14 — i.e. the
  explicit-list mode is the mode task gates actually used. A typo'd path, or a file renamed
  after the gate command was written down, produces a PASS that names the missing file as
  scanned. This is the file's own headline lesson (its comment block: "the scan was correct only
  when someone remembered it was not") recurring in its other input mode.
- **Severity: MEDIUM.** **Fix direction:** in explicit-list mode, a named path that is not a
  file is an M5 FAIL naming it (mirror of the stale-exemption rule already in this script).

### SCRIPTS-PYTHON-010 — a multi-line empty catch evades M5's empty-catch scan (reproduced; P1-lite)

- **Where:** `scripts/conductor-gate.sh:75` — `PAT_CATCH` is applied by line-based grep, so
  `catch (e) {` + `}` on the next line never matches.
- **Reproduced:** a scratch file with `try { x(); } catch (e) {\n}` → `M5 PASS`; the same catch
  on one line → `M5 FAIL: empty catch block`. Since formatters commonly split braces, the
  evading form is the *likelier* spelling of the defect the scan exists to catch, and the
  header comment claims coverage of "empty catch blocks" without qualification.
- **Severity: LOW** (M5 is defense-in-depth; reviews also read diffs). **Fix direction:** scan
  with `grep -Pzo` / a multiline-aware pass for `catch` followed by an empty brace pair, or
  note the limitation in the header the way empty function bodies are noted.

### SCRIPTS-PYTHON-011 — acceptance row 3 passes vacuously if router test registration breaks: ctest exits 0 on "No tests were found" (P1, the zero-tests class a third time)

- **Where:** `scripts/verify-acceptance.sh:83-88` — row 3 is
  `cmake --build … --target router-tests && ctest --test-dir …`.
- **Verified semantics:** in a scratch cmake project with `enable_testing()` and no tests,
  `ctest --test-dir build` prints `No tests were found!!!` and **exits 0** (this machine's
  ctest). So if the router's test registration regressed (a `file(GLOB …)` matching nothing, a
  renamed test target, an `add_test` dropped), row 3 still records
  "PASS row 3: ctest green — " with an empty summary, because the `grep '% tests passed'` is
  display-only.
- **The class:** this exact vacuous-green shape has been fixed **twice** in this repo already —
  `test-conductor.sh` guards node's zero-match glob (`TESTS -eq 0 → FAIL`) and the python leg's
  `Ran 0 tests` (`PY_RAN -lt 1 → FAIL`). The C++ leg is the one runner without the guard.
  (Part G enumeration 6: same defect class, elsewhere, unfixed — instance found.)
- **Severity: MEDIUM.** **Fix direction:** `ctest --test-dir "$BUILD_DIR" --no-tests=error`, or
  require the `N% tests passed` summary to exist and parse a nonzero total.

### SCRIPTS-PYTHON-012 — hollowness detector C contains a loop that checks nothing (P1: dead code shaped like a check)

- **Where:** `scripts/verify-acceptance.sh:340-343`:
  ```bash
  for m in $(git ls-files 'router/*.hpp'); do
    base="$(basename "$m" .hpp)"
    ls router/tests/ 2>/dev/null | grep -q "$base" || true
  done
  ```
- **The defect:** the loop's result is discarded — `|| true` swallows the grep verdict, nothing
  sets a variable, nothing can ever fail. It reads as "every router header has a matching test
  file" and enforces nothing; detector C's PASS line ("every §1.1 router module exists and is
  non-empty") is produced solely by the existence loop above it. A reader auditing the script
  counts one more property than it checks.
- **Severity: LOW-MEDIUM** (misleading enforcement surface in the acceptance meter itself).
- **Fix direction:** either wire it into `CPP_MISSING`-style reporting or delete it; a check
  that cannot fail is worse than its absence (briefing Part B rule 1).

### SCRIPTS-PYTHON-013 — verify-acceptance.sh still uses fixed /tmp scratch paths, the exact concurrency defect test-conductor.sh fixed (class recurrence)

- **Where:** `scripts/verify-acceptance.sh` — `/tmp/accept-bun.out` (line 64),
  `/tmp/accept-cmake.out`, `/tmp/accept-ctest.out` (83-87), `/tmp/accept-guards.out` (103),
  `/tmp/accept-m5.out` (352).
- **The class:** `test-conductor.sh:17-21` documents why its own fixed /tmp paths were replaced
  with a per-invocation `mktemp -d`: "two gates run at the same time overwrite each other's leg
  output and read each other's counts". Two concurrent acceptance runs (or an acceptance run
  concurrent with anything else using these names) interleave the same way: row 2's PASS
  message and row 3's verdict-decoration read another process's output. Verdicts themselves
  mostly ride exit codes, but detector D's FAIL detail (`grep 'M5 FAIL' /tmp/accept-m5.out`)
  and row 2's pass/fail (reads `bun test`'s exit — fine — but its detail line and, worse,
  `tail -3` on a foreign file) can misreport.
- **Severity: LOW.** **Fix direction:** the same `mktemp -d` + `trap rm -rf` pattern one file
  over.

### SCRIPTS-PYTHON-014 — two weak acceptance detectors: row 2's SKIPPED_UNMET matches any task's record, and row 5's scenario check is substring-anywhere (P1-lite)

- **Where:** `scripts/verify-acceptance.sh:69-73` and `:121-133`.
- **Row 2:** if bun disappears, the fallback `grep -q 'SKIPPED_UNMET' docs/build/STATE.json`
  passes on ANY task's SKIPPED_UNMET record anywhere in STATE.json — not one about bun or G14.
  An unrelated task's skip record would excuse a silently-vanished dual-runtime leg.
- **Row 5:** the five scenario names are checked with `grep -qi "$s"` over the whole TAP
  output. `trivial` is a substring of "non-trivial", `worktree` appears in dozens of unrelated
  test titles — a deleted scenario whose name survives in any other title (or in a failure
  message) still satisfies the detector. The suite-green requirement (`E2E_EC -eq 0`) catches a
  *failing* scenario but not a *deleted* one, which is exactly what the row says it exists to
  catch ("implement scenario 1, commit, and leave four acceptance-critical paths unexercised").
- **Severity: LOW each.** **Fix direction:** row 2 — grep for a bun/G14-scoped record; row 5 —
  match TAP `ok` lines whose titles carry the scenario tags, e.g.
  `grep -E '^ok .*<scenario>'`.

### SCRIPTS-PYTHON-015 — serve.wait_until_ready is reached by no test: the C-090(1) class recurring one function over (P11)

- **Where:** `scripts/serve.py:356-370`. Every main()-driven test stubs it
  (`test_conductor_wiring.py:1744` `patch_attr(serve, "wait_until_ready", …)`); nothing else
  references it. C-090's first finding was exactly this shape for `wait_for_router_health` —
  "its only callers were production; a `return True` stub survived the whole suite" — and the
  fix pinned that function both directions against a real listener. Its sibling in serve.py,
  which gates the entire post-readiness path of every session, has the same zero coverage the
  correction fixed one function away.
- **What could silently break:** a `return True` stub survives (readiness gate gone: the
  rcfile/exec path runs against a dead server, the failure surfacing as an opencode 502 instead
  of the log-tail error message this function exists to produce); the `proc.poll()` early-exit
  could be dropped (a crashed llama-server waits the full 600s timeout before erroring); the
  200-only check could be loosened. None of these turns anything red.
- **A latent quirk in the same function:** a non-raising non-200 response (any 2xx/3xx other
  than 200) skips the `time.sleep(0.5)` — the sleep lives in the `except` arm only — producing
  a busy-loop. llama-server's /health returns 200/503 so this is theoretical today; it is the
  kind of thing the missing test would pin.
- **Severity: MEDIUM** (class recurrence of a correction made three days ago).
- **Fix direction:** the RouterHealthProbe pattern already in the suite (real listener answering
  200/503/nothing) applies verbatim; add a `proc`-dead leg.

### SCRIPTS-PYTHON-016 — the entire download/validate half of fetch_models.py (and all of benchmark.py) has zero test coverage (P11 / the C-087 "executed by nothing" class at file scale)

- **Where:** `scripts/fetch_models.py` (2,176 lines) — `download_file`'s chunked resume
  bookkeeping, `_download_range`, `match_quant`'s four-layout selection, `read_gguf_header`'s
  binary parser, `validate_files`, `manifest_intact`, `install_model`, every `cmd_*`;
  `scripts/benchmark.py` (1,634 lines) — `ServerSession`, all four scorers, the report
  builder; plus `ui.py`, `hostinfo.py`, `models_catalog.py`, `bench_presets.py`.
  The python gate leg discovers `test_conductor_wiring.py` and `test_conductor_bench.py` only
  — nothing else in scripts/ is executed by any test.
- **Why it belongs in this review even though the files predate conductor:** serve.py —
  conductor's session front door — calls into the untested half on every run:
  `fm.installed_models()` (via `manifest_intact`, `read_manifest`), `fm.ensure_tools()`,
  `fm.write_json`, `fm.tool_path`. `installed_models` is only ever *stubbed* by the p12 tests
  (`test_conductor_wiring.py:1804`). A regression in `manifest_intact` (say, inverted size
  comparison) empties the model list and no gate moves.
- **Specific latent defects found by reading (none executable-verified, flagged lower-confidence):**
  1. `_download_range` (fetch_models.py:482-498) trusts the server honoured the Range header;
     a 200-full-body response is written from `start` onward, overwriting other chunks'
     completed bytes before the short-read check raises. With `--no-hash-check`, or for a
     non-LFS file whose `sha256` is None, the corruption validates by size. Cheap hardening:
     require status 206 before writing.
  2. `validate_files`' comment "the rest are proven by sha256" overstates when `sha256` is
     None (non-LFS): the rest are proven by size only.
  3. mmproj files are excluded from `validate_files` in both `install_model` (line 984) and
     `cmd_verify` (line 1782) — downloaded-size-checked but never hash-verified, while the
     manifest's `validated: true` reads as covering them.
  4. `cmd_verify` can report `ok` for a model whose mmproj was deleted, while
     `installed_models()` (via `manifest_intact`, which checks ALL files) simultaneously
     treats it as not installed — two answers to "is this model healthy" that can disagree.
  5. `cmd_serve` accepts `--models-max`/`--serve-ctx` but passes neither through to serve.py
     (fetch_models.py:1910-1918) — the flags do nothing unless the ini happened to be missing.
- **Severity: MEDIUM** in aggregate. **Fix direction:** not blanket coverage — a targeted leg
  for the functions serve.py depends on (`manifest_intact`, `installed_models`,
  `read_manifest`) and the resume/validation state machine, which is the highest-consequence
  untested code in scripts/.

### SCRIPTS-PYTHON-017 — README.md documents an eviction workflow whose download half does not exist (`download_missing` is read by nothing; `fetch_model` has no callers)

- **Where:** `scripts/README.md:390-398` ("Running more models than fit on disk":
  `"eviction": { "download_missing": true, "delete_after_each": true }` — "Each model is
  fetched, benchmarked, then deleted... the whole catalog can be benchmarked on a machine that
  could never hold it at once"); `scripts/benchmark.py:974-980` (`fetch_model`, zero callers);
  `scripts/fetch_models.py:1397` (the only other occurrence of `download_missing` — the
  generated config's default).
- **The fact:** `grep -rn download_missing scripts/*.py` hits exactly one line: the config
  generator's default. No code reads the key. `fetch_model()` is dead code. And structurally
  the promise cannot hold anyway: `discover_models()` only enumerates installed models, so an
  absent model never enters the plan to be "fetched when its turn comes"
  (the config's own `_comment` at fetch_models.py:1393-1396 repeats the promise).
  `delete_after_each` IS implemented — so an operator who sets the documented pair gets the
  destructive half (models deleted after each run) without the restorative half.
- **Severity: LOW-MEDIUM** (documentation promising an unimplemented workflow whose failure
  mode deletes 20-40 GB downloads). **Fix direction:** implement the fetch in `plan_runs`/the
  main loop, or delete the knob, the dead function, the config comment and the README section
  together.

### SCRIPTS-PYTHON-018 — serve.py restates the router-config filename that conductor_wiring owns (P3, no drift guard on the value)

- **Where:** `scripts/serve.py:642` and `:721` spell `fm.CONFIGS_DIR / "conductor-router.json"`;
  the owner is `conductor_wiring.ROUTER_CONFIG_RELPATH = ".data/configs/conductor-router.json"`
  (conductor_wiring.py:43), which `conductor_bench.py:52` and every test fixture derive from.
- **Drift consequence:** rename either spelling and serve.py writes/reports one file while
  conductor_bench reads another (`ROUTER_CONFIG_PATH` is the bench's default `--router-config`),
  and every test keeps passing — the main()-driven tests never assert the written path (the
  launch leg is untested, SCRIPTS-PYTHON-004) and the print-env tests assert
  `LLAMA_HARNESS_ROUTER_URL` but not `LLAMA_HARNESS_ROUTER_CONFIG`'s value on the main() path.
  Today the two spellings agree (`fm.CONFIGS_DIR` is `.data/configs`); the briefing's P3 rule:
  a restatement with no drift guard is a defect even while the copies agree.
- **Severity: LOW.** **Fix direction:** `router_config_path = REPO_ROOT / cw.ROUTER_CONFIG_RELPATH`
  (serve.py already imports cw), or a constant on cw that serve derives both sites from.

### SCRIPTS-PYTHON-019 — merge_router_config treats `metrics.ledgerPath` as machine-owned while two comments describe it as hand-editable (P3: two spellings of one intent)

- **Where:** `conductor_wiring.py:79-89` (`ROUTER_MACHINE_KEYS` includes
  `("metrics","ledgerPath")`, under the comment "every other key … is a hand edit and survives
  regeneration") vs `generate_router_config`'s docstring ("The supervisor also launches with cwd
  at the repo root, so a hand-edited relative path lands in the same file") and
  `start_router_supervisor`'s ("cwd is the repo root so a hand-edited relative ledgerPath
  resolves to the same file the generated absolute one names").
- **The contradiction:** two comments are written to make hand-editing `ledgerPath` safe, but
  the merge clobbers any hand edit of it on the next non-`--fresh` serve.py run — the test
  `test_12_1_router_config_preserves_hand_edits` even pins the clobbering
  (`merged["metrics"]["ledgerPath"] == generated…`). Whichever behavior is intended, one of the
  two spellings is wrong; an operator following the supervisor comment gets their ledger path
  silently reset.
- **Severity: LOW** (operator-facing surprise, not a correctness break). **Fix direction:**
  either drop `ledgerPath` from `ROUTER_MACHINE_KEYS` (respect the edit) or fix the two
  comments to say the path is machine-owned.

---

## 2. IDEA register

### IDEA-SP-01 — refuse, don't shift, when an explicit `--port` is busy
Origin: reading `resolve_port` (serve.py:182-201). Kind: ergonomics.
Value: `serve.py --port 8080` with 8080 busy silently serves on 8081 (one info line); a
scripted caller that pinned the port now has a session elsewhere. An explicitly-passed port
deserves a refusal with the pid holding it. Cost: small. Relates to: standalone.

### IDEA-SP-02 — `reported_port` verifies something listens, not that it is *this* session
Origin: serve.py:228-243. Kind: ergonomics/honesty.
Value: `--print-env` confirms the port answers a connect; any foreign process on that port
produces a confident session report. A GET to `/health` (llama-server answers distinctively)
would verify identity nearly as cheaply. Cost: small. Relates to: standalone.

### IDEA-SP-03 — a non-executable `$LLAMA_ROUTER` override falls through silently
Origin: `find_router_binary` (conductor_wiring.py:389-393). Kind: ergonomics.
Value: an operator's explicit env override that names a missing/non-executable path is ignored
without a word, and some other build is launched instead. A notice ("$LLAMA_ROUTER set but not
executable; using …") preserves fail-soft while surfacing the mistake. Cost: small.
Relates to: standalone.

### IDEA-SP-04 — the readiness-fallback notice should name router.log
Origin: `finalize_routing`'s timeout notice (conductor_wiring.py:587-592). Kind: ergonomics.
Value: when the router never answers, the supervisor's give-up reason (C-087 made it carry
`verdict.message`) sits in `.data/configs/router.log`, which the fallback notice never names —
the operator sees "did not answer within the readiness budget" and has to know where to look.
Cost: one string. Relates to: standalone.

### IDEA-SP-05 — resume path in run_benchmark should validate reused results
Origin: conductor_bench.py:1705-1708 (`rows.append(json.loads(recorded.read_text()))`, no
`validate_result`) vs `load_results` which validates. Kind: robustness.
Value: a truncated/hand-edited result file enters aggregation unvalidated on the resume path
only. Cost: one call. Relates to: standalone.

### IDEA-SP-06 — `derive_slots` has a floor and no ceiling (the C-090(2) shape, milder)
Origin: conductor_wiring.py:159-171. Kind: robustness.
Value: `--max-readers 600` → `--parallel 600` and `--ctx-size 4.9M`; llama-server fails loudly,
so unlike C-090's grace this is not silent — but a ceiling tied to the measured
EFFECTIVE_SLOT_COUNT would turn a nonsense value into a named refusal. Cost: small.
Relates to: SCRIPTS-PYTHON-015's file.

### IDEA-SP-07 — pin `bun test` against a zero-test vacuous pass
Origin: test-conductor.sh:83-88; the node and python legs both guard "zero tests ran", the bun
leg trusts bun's exit code and greps "N pass" for display only. Kind: test-maintainability.
Value: symmetry with the gate's own zero-tests doctrine. Cost: small.
Relates to: SCRIPTS-PYTHON-011 (same class, ctest).

### IDEA-SP-08 — the python leg's test-count floor is 1
Origin: test-conductor.sh:120-126 (`PY_RAN -lt 1`). Kind: test-maintainability.
Value: discovery that silently loses one of the two test modules (47 or 33 of 80 tests) still
passes; M5's glob floors show the pattern (a floor near the current count, loose enough for
deletions). Cost: one number. Relates to: standalone.

### IDEA-SP-09 — watch-agents.sh is pinned to one dead session id
Origin: watch-agents.sh:6 hardcodes `…/02ee96d7-…/subagents`. Kind: tooling polish.
Value: the observability helper silently reports "no agent transcript found" for every session
after the one it was written in; globbing the project dir would keep it alive. Also `[ "$1" = … ]`
errors under `set -u` shells when run bare. Cost: small. Relates to: standalone.

### IDEA-SP-10 — benchmark.py fixed ports (8199, 8137) and a foreign /health
Origin: ServerSession/_wait_ready and score_embeddings. Kind: robustness.
Value: if anything else answers /health on the fixed port during the bind-failure window, the
bench chats with the wrong server; BENCH_PORT is env-overridable but collision is silent.
Port-0 + parse, or an identity check, closes it. Cost: moderate. Relates to: standalone.

### IDEA-SP-11 — wrap ServerSession.__enter__ in a reap guard
Origin: benchmark.py:269-302; the C-087 orphan-window shape. Attempted to make it bite:
the realistic interrupt (Ctrl-C) also SIGINTs the same-process-group llama-server, so the
window self-heals in the foreground case and I could not name a realistic raiser — filed as
defense-in-depth, not a defect. Kind: robustness. Cost: small. Relates to: standalone.

### IDEA-SP-12 — score_embeddings hardcodes `--pooling mean` against catalog models that declare `pooling: last`
Origin: benchmark.py:604-615 vs models_catalog qwen3-embedding entries. Kind: bench fidelity.
Value: recall@1 measured under a pooling the model authors advise against; scores read low for
a config reason. Cost: small. Relates to: standalone.

### IDEA-SP-13 — README calls .data/ "the only gitignored dir"; .out/ is gitignored too
Origin: scripts/README.md:28. Kind: docs. Cost: one line. Relates to: standalone.

### IDEA-SP-14 — unused `import ctypes` in hostinfo.py
Origin: hostinfo.py:15. Kind: polish. Cost: one line. Relates to: standalone.

### IDEA-SP-15 — DEFAULT_BASE_CONFIG in conductor_bench restates the provider block with a bare "llamacpp" literal
Origin: conductor_bench.py:146-162; cw.PROVIDER_ID is imported one line away. Kind: naming/P3
hygiene. Value: fourth spelling of the provider id in scripts/. Cost: trivial.
Relates to: SCRIPTS-PYTHON-001.

### IDEA-SP-16 — fetch_models.py:1285 writes a baseURL literal that apply_conductor_wiring immediately overwrites
Origin: generate_opencode_config. Kind: polish. Value: the literal misleads readers into
thinking it is load-bearing; deriving it from `cw.openai_base_url` (or dropping it) removes a
false lead. Cost: trivial. Relates to: standalone.

---

## 3. CROSS-LENS POINTERS

- **Step 2b (checks-sweep) / R1:** the §1.2 run-dir layout names `reviews/<id>-r<N>.json` and
  nothing writes it (replay.ts:18 admits this) — SCRIPTS-PYTHON-007 found it from the bench
  side; the plugin/evidence side (should the writer exist per plan §1.2?) is a conductor/
  finding someone should own.
- **Step 2b:** verify-acceptance row 9b consumes `docs/build/artifacts/12.1-g5-equivalence.md`
  — C-089 already found that artifact once fabricated-by-tautology; the artifact's *current*
  content honesty belongs to the artifact sweep (P9).
- **Step 2b:** my mutation duty excluded the three shell scripts' *checked properties*
  (charter); rows I did NOT mutate: each of verify-acceptance's 21 rows against its subject.
- **R1/conductor:** `_count_schema_retries` keys on journal `component=fanout`,
  `event=subsession.retry` and run.json `counters.overridesUsed`/`stop.kind` — restatements of
  TS-side vocabulary with no cross-language guard beyond STOP_KINDS (SCRIPTS-PYTHON-008);
  whoever owns conductor/ vocab should list python readers as consumers.
- **R2 (macro):** scripts/ mixes two products — the conductor harness (serve/wiring/bench) and
  the pre-existing model-benchmark tooling (fetch_models/benchmark/presets/ui/hostinfo) — with
  one shared test gate that covers only the former; the boundary is invisible to a newcomer.
- **R2 (macro):** the M5 scan covers `scripts/*.py` but no `*.sh` — the three enforcement
  shell scripts are outside every scanner's scope; where should shell live in the gate regime?
- **R3 (capability):** SCRIPTS-PYTHON-006 (PATH-less cell env) would have been caught by a
  "spawn one trivial cell end-to-end against a fake opencode binary" smoke — a missing
  mechanism: no preflight in conductor_bench exercises the real spawn seam before a 90-run
  night.
- **R3 (capability):** -003/-015 both stem from "generated artifacts (rcfile, readiness loop)
  executed by nothing" — a pty-based session-shell smoke would raise the floor on the whole
  serve.py surface.

---

## 4. Mutation table

| # | File | Mutation | Expectation | Result | Verdict |
|---|------|----------|-------------|--------|---------|
| M1 | conductor_bench.py | `"maxReaders": 6` → `60` AND `git.mode "commit"` → `"read-only"` in `build_conductor_cell_config` | some test red if cell config content is pinned | `Ran 33 tests ... OK` — fully green | **DOES NOT BIND** → SCRIPTS-PYTHON-001/-002 confirmed. Restored, `cmp` identical. |
| M2 | (experiment, not a code mutation) generated rcfile trap block | SIGINT to interactive bash at its prompt | trap should NOT fire if INT belongs in the list | trap fired; stand-in server killed; shell survived | **Behavioral repro** → SCRIPTS-PYTHON-003. |
| M3 | serve.py:724-726 | swap `router_port`/`port` in main's `write_router_config` call | red if the launch leg of main() is covered | `Ran 80 tests ... OK` | **DOES NOT BIND** → SCRIPTS-PYTHON-004. Restored, `cmp` identical. |
| M4 | serve.py:743 | delete `cw.stop_router_supervisor(supervisor)` on the fallback leg | red if main's fallback leg is covered | `Ran 80 tests ... OK` | **DOES NOT BIND** → SCRIPTS-PYTHON-004. Restored, `cmp` identical. |
| M5 | (invocation experiment) test_conductor_wiring.py | run directly vs via unittest module | equal counts if the main guard is placed correctly | 35 direct vs 47 module, both "OK" | **P1 confirmed** → SCRIPTS-PYTHON-005. |
| M6 | (production code, unmodified) conductor_bench.build_cell_env + run_command | spawn `opencode --version` under the hermetic cell env | should spawn if the env is viable | `spawn_error="[Errno 2] No such file or directory: 'opencode'"` | **Live-run blocker confirmed** → SCRIPTS-PYTHON-006. |
| M7 | conductor-gate.sh (invocation) | explicit args naming two nonexistent files | should FAIL naming the missing files | `M5 PASS (2 file(s) scanned…)`, exit 0 | **DOES NOT BIND** → SCRIPTS-PYTHON-009. |
| M8 | conductor-gate.sh (scratch input) | `catch (e) {\n}` across two lines vs one line | both should FAIL if the scan covers empty catches | multiline PASS, oneline FAIL | **Partial bind** → SCRIPTS-PYTHON-010. |
| M9 | (semantics experiment) scratch cmake project, zero tests | `ctest --test-dir build` | acceptance row 3 assumes nonzero exit | `No tests were found!!!`, exit **0** | **Vacuous-green class confirmed** → SCRIPTS-PYTHON-011. |

---

## 5. Coverage ledger

All 16 tracked files under scripts/ (`git ls-files scripts/`) are accounted for.

| File | What was done | Coverage | Conclusion |
|------|---------------|----------|------------|
| serve.py (779) | read whole; trap behavior reproduced under pty (twice); two mutations (M3, M4) run through the full python leg | 100% read; launch-leg + rcfile + wait_until_ready attacked | -003 (HIGH), -004 (HIGH), -015, -018; log_handle fd leak confirmed still present (known-open per C-087, "owed a row") |
| conductor_wiring.py (955) | read whole incl. embedded supervisor source; cross-referenced every constant's consumers; policy/backoff/preflight traced | 100% read | -019; IDEA-SP-03/-04/-06; supervisor lifecycle could not be broken (see cleared) |
| fetch_models.py (2176) | read whole; downloader/resume/GGUF-parse traced by hand; drift guards for PROVIDER_ID traced to indirect test coverage | 100% read; no execution (network-bound) | -016, -017 (doc half); IDEA-SP-16; five lower-confidence latent defects listed inside -016 |
| conductor_bench.py (1847) | read whole; M1 mutation; production run_command+build_cell_env executed unmodified (M6); metric readers cross-checked against TS writers | 100% read; spawn seam executed | -001, -006 (HIGH), -007, -008; IDEA-SP-05/-15 |
| test_conductor_wiring.py (2622) | read whole; direct-vs-module invocation counted (M5); asserted-property inventory for the p12 harness | 100% read | -002's sibling checks are here and sound; -005 (mid-file main guard); confirmed no test drives serve.main's launch leg |
| test_conductor_bench.py (1969) | read whole; fixture-shape audit against production writers | 100% read | -002 (partial P2), -007's fabricated reviews/ fixture; otherwise strong (PATTERN-based oracles are genuinely independent) |
| test-conductor.sh (136) | read whole as SUBJECT; TAP-count forging reasoned through (trailer-last wins); zero-test guards verified present for node+python | 100% read; property-mutations deferred to step 2b per charter | sound; IDEA-SP-07/-08 |
| conductor-gate.sh (172) | read whole as SUBJECT; two direct invocations with adversarial inputs (M7, M8) | 100% read + executed | -009 (nonexistent explicit files → PASS), -010 (multi-line catch evasion) |
| verify-acceptance.sh (400) | read whole as SUBJECT; ctest zero-test semantics verified in a scratch cmake project (M9); every row's verdict logic traced | 100% read; row-subject mutations deferred to step 2b | -011, -012 (dead detector-C loop), -013 (fixed /tmp), -014 |
| watch-agents.sh (34) | read whole | 100% | IDEA-SP-09; no enforcement role |
| benchmark.py (1634) | read whole; eviction/resume/scoring traced; orphan-window attack attempted and refuted (IDEA-SP-11) | 100% read; not executed (needs models) | -016 (zero coverage), -017 (dead fetch_model); IDEA-SP-10/-12 |
| bench_presets.py (481) | read whole | 100% | pure data; no findings |
| models_catalog.py (581) | read whole | 100% | pure data; sizes unverifiable offline (documented as measured); no findings |
| hostinfo.py (478) | read whole | 100% | IDEA-SP-14; note: builds membench into .out/build/ by design (product behavior, not reviewer action) |
| ui.py (518) | read whole | 100% | presentation only; no enforcement role; no findings |
| README.md (440) | read whole; every claim checked against the code | 100% | -017 (eviction section), IDEA-SP-13; "rebuilds automatically" claims verified true |

Post-review hygiene: `git status --porcelain scripts/` clean; full gate re-run after all
restorations: **GATE PASS** (1382 node / 80 python / typecheck / bun 8 / schema export).
Process check before finishing: no stray `llama-router`/`fake-llama`/`time.sleep` children
(see §6 note).

---

## 6. Cleared areas

Attacks attempted that did NOT produce a finding — recorded as evidence the property holds.

1. **TAP-trailer forgery against test-conductor.sh.** Attack: a test printing counterfeit
   `# tests/# fail` lines to smuggle a green verdict. Cleared: `count()`'s awk takes the LAST
   occurrence and node prints its real trailer at the end, after all test output; a test cannot
   print after it. The DIRECTIVES grep can be false-POSITIVED by a test title containing
   "# SKIP" — fail-closed, acceptable.
2. **Supervisor lifecycle (conductor_wiring).** Attacks considered: backoff sleep outliving a
   dead shell (bounded at 30s lag, then exits — no leak); policy-load failure (router never
   starts; serve.py's readiness fallback catches it — fail-soft holds); negative returncode
   from a signal-killed router (restartable, correct); killpg on a reaped supervisor
   (`getpgid` OSError → falls back to pid, and with `start_new_session` pid==pgid). The one
   residual: a supervisor SIGKILLed externally while its router lives makes
   `stop_router_supervisor`'s early `poll()` return skip the group kill — but no in-product
   path produces that state.
3. **merge_router_config hand-edit destruction.** Attack: hand edits clobbered or machine keys
   surviving stale. Cleared: deep-merge direction and ROUTER_MACHINE_KEYS forcing verified by
   reading and by the existing preserves-hand-edits test — except the ledgerPath *intent*
   contradiction filed as -019.
4. **_parse_file_map path traversal.** Attack: absolute paths, `..` segments, `~` — absolute
   and dot-dot refused by name; `~` is not expanded by Path/materialize_files (no expanduser),
   so it lands as a literal directory inside the tree. Windows drive-letter paths are not
   os.path.isabs on macOS but the bench only runs here. Cleared.
5. **run_command group-kill.** The bench test proves the grandchild dies (executed, not
   mocked). Read for double-resolve/zombie: `_kill_process_group` falls back to direct kill
   when the group is gone, reaps with a bounded wait. Cleared.
6. **Ledger-window accounting.** Attacks: rotation/truncation mid-cell (start_line beyond EOF →
   empty window → partial=True, honest); bool-typed token counts (excluded by explicit
   isinstance-bool checks); negative statuses. Cleared — with the caveat (pointer filed) that
   window exclusivity assumes no foreign traffic on the router during a cell.
7. **print_env_report stdout purity.** Attack: a notice or ANSI escape reaching stdout —
   pinned by tests that assert NAME=value-only and no `\x1b`; the decision.notice dedup path
   read for a leak; none found. Cleared.
8. **ServerSession orphan window (benchmark.py).** Attack: exception between Popen and
   readiness leaving a 30GB server. Refuted for the realistic trigger — Ctrl-C SIGINTs the
   same process group, killing the child too; no other realistic raiser exists in the window.
   Filed as IDEA-SP-11 (defense-in-depth), not a defect.
9. **`substitute_harness_root` escaping.** Attack: token surviving in dict KEYS (keys are not
   substituted) — checked the fragment: no key carries the token, and opencode config keys are
   fixed vocabulary; a fragment edit introducing one would fail verify_file_references only if
   it is a file ref. Residual risk negligible; noted, not filed.
10. **Process hygiene.** After all pty/supervisor/mutation experiments:
    `ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\.sleep" | grep -v grep`
    → empty (verified at the end of the session; the two pty bashes and the sleep stand-in
    were explicitly killed inside their experiments).
