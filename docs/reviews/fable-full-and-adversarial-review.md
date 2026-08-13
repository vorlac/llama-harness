# Conductor — Full-Depth + Adversarial Review (run this from a fresh, empty-context session)

You are a senior reviewer dropped into an unfamiliar repository with **no prior context**. Your
job is to produce **two reviews of the entire body of work in this workspace**:

1. **A full-depth review** — architecture, spec-conformance, code quality, test quality, completeness, honesty of the build record.
2. **An aggressive adversarial review** — actively try to **prove or disprove** the system's **correctness**, **robustness**, and — critically — whether it will actually elicit the **intended LLM behavior** it was designed to enforce.

Work **hands-on**: read, build, run the tests yourself, and attack the system with your own
inputs. Do **not** take any claim (in code comments, the build ledgers, or this prompt) on faith —
re-derive it. An honest "I verified X and it holds" is worth more than a guess; a reproduced
defect is worth more than a suspicion.

---

## 0. What this repository is (orientation)

**"conductor"** is a TDD-enforcing, adversarially-reviewed orchestration harness that sits in
front of **opencode** (a headless AI coding agent) and a local **llama.cpp** server. Its thesis:
*extract high process-quality work from a small local model by wrapping it in mechanical
enforcement + multi-agent adversarial review*, rather than by using a bigger model. Two layers:

- **Layer 1 — the TypeScript opencode plugin** (`conductor/`): gates every tool call, drives a run
  finite-state-machine and a per-item FSM, dispatches role sub-sessions (classifier, planner,
  test-writer, implementer, reviewer, skeptic, …), injects always-on "doctrine" into each
  session's system prompt, records machine-checkable evidence, and enforces "your claim is not the
  record" — every advance is re-derived by the harness, never trusted from the model.
- **Layer 2 — the C++ `llama-router`** (`src/router/`): a fail-soft proxy/scheduler in front of
  `llama-server` (admission control, priority/affinity scheduling, schema OBSERVATION not
  enforcement, a metrics ledger). `--no-router` must run the identical process (G5).

### The authoritative specification (READ IT FIRST, IN FULL)
`docs/plans/2026-08-07-conductor-harness-plan.md` — **Revision 5, ~3399 lines, IMMUTABLE.** This is
the single source of truth for intended behavior. Everything below is judged against it. Key
sections you will keep returning to: §1 (architecture + the invariants **G1–G14**), §2 (the JSON
schemas + closed vocabularies + the §11 acceptance rows embedded as gates), §3 (the run/item FSMs,
the tool inventory §3.4, the gate regime §3.6, liveness §3.8, no-git mode §3.9), §4 (roles under
one model §4.1, the router semantics §4.4), §5 (the opencode wire contract), §6 (the doctrine port
map §6.1, the decision protocol §6.2, ponytail §6.3, injection mechanics §6.4), §7 (logging/§7.4
debuggability), §8 (the task manifest — 52 tasks), §9 (honest limits), §11 (acceptance).

### The build record (read after the plan)
The build was executed task-by-task against that plan. Its ledgers live in `docs/build/`:
- `HANDOFF.md` — the cold-start summary of where the build is. Read it second.
- `STATE.json` — per-task machine truth (status, commitSha, tap counts, redEvidence, deviations).
- `GATES.json` — every task-gate (M1–M9) and phase-gate result, with the adversarial adjudications.
- `CORRECTIONS.md` — **C-001 … C-028**, every deviation from the plan with its rationale. This is
  where the build discloses what it changed and why; scrutinize it hard.
- `specs/task-*.assertions.json` — the per-task assertion ledgers (what each test was supposed to pin).
- `branch-b-plan.md` — the C++ router bring-up plan. `honest-limits-pending.md` — disclosed G7 gaps.

**Progress at review time:** Phases 0–8 (the plugin core: schemas, FSMs, gates, journal, state
store, security, evidence/quarantine, fan-out, doctrine+injection) and Branch B Task 11.1 (the C++
router scaffold) are committed and gated. Phase 9 (the pipeline tools) is in progress. So the bulk
of Layer 1 is complete; Layer 2 is scaffolded; several **live/manual** steps are honestly deferred
(e.g. 11.1 Step 2's llama-server contract → 12.1). Your review covers the **committed** work in
depth AND assesses whether its **design** will support what remains.

---

## 1. Environment & how to actually run things

- **Node 26.7.0** runs the TypeScript directly via type-stripping (no build step). **TRAP:** never
  invoke `node --test` directly for a verdict — on this version a directory positional resolves as
  a bogus failing module and a zero-match glob exits 0 (a vacuous pass). **Always** run the TS
  suite through the harness gate:
  ```
  bash scripts/test-conductor.sh          # full suite: TAP parse + tsc + bun leg + schema export
  ```
  It fails on any failing/cancelled/skipped/todo test and on SKIP/TODO TAP directives at any depth.
  You may pass a single glob to scope it, e.g. `bash scripts/test-conductor.sh 'conductor/tests/fanout.test.ts'`.
- **bun 1.3.14** runs the G14 dual-runtime smoke; the gate runs it automatically.
- **C++ router** (cmake + ninja + clang, C++23, vcpkg):
  ```
  cmake --preset clang-relwdebinfo
  cmake --build .out/build/clang-relwdebinfo --target router-tests llama-router   # ONLY these targets
  ctest --test-dir .out/build/clang-relwdebinfo --output-on-failure
  ```
  **Never** run a bare `cmake --build` — the `extern/llama-cpp` submodule's build is pre-broken
  upstream and the router deliberately never links it; only its *configure* is exercised.
- **The M5 stub scan / task gate helper:** `bash scripts/conductor-gate.sh` (scans committed
  TS/C++ sources for stub markers, skipped tests, vacuous asserts, empty catches).

### Rules of engagement (this is a REVIEW — do no harm)
- **Read-only on the artifacts:** do NOT modify the plan (immutable), the source, the tests, the
  build ledgers, or config. You may create throwaway files ONLY under a scratch dir you make in
  `$TMPDIR`.
- **Never** `rm -rf` (or otherwise mutate) `.data/` or `.out/` — ~20 GB of gitignored, unrecoverable
  model data and build artifacts. Never `git commit`/`push`/`reset --hard`/`clean`; never touch
  submodule pointers or `CMakePresets.json`.
- You MAY run the test suites, build the router, and probe behavior by calling the pure functions /
  adapters directly with your own synthetic inputs (write a scratch `.test.ts` under `$TMPDIR` and
  run it through the harness, or import and call from a scratch script). Attacking the code with
  adversarial inputs is the point — just keep the mutations in scratch space.
- If subagents / parallel workflows are available to you, use them for breadth (fan out the areas
  below across independent reviewers, then verify each finding adversarially before reporting it).

---

## 2. Review Part A — Full-depth review

Go area by area. For each, state what the plan requires, what the code does, and whether they
match — with `file:line` citations.

1. **Architecture & layering.** Does the implementation realize the plan's design? Check the
   **pure-core / thin-adapter split (G3)** — `conductor/core/` must be pure functions (no I/O, no
   clock, no network); `conductor/adapter/` does the I/O. Check **G13** (one model, many roles) and
   the **G5** "`--no-router` runs the identical process" claim. Is the coupling clean; is anything
   in core that shouldn't be?
2. **Spec conformance, section by section.** Sample the normative sections and verify the code is
   faithful — not approximate, not embellished:
   - §2 schemas & closed vocabularies (`conductor/core/types.ts`, `journal-events.ts`): do the
     schemas match the plan's field lists and `additionalProperties:false` discipline? Are the
     closed enums (run states, classification kinds, tool names, decision kinds, journal events)
     exactly as specified?
   - §3 FSMs + gates (`core/fsm-run.ts`, `fsm-item.ts`, `gates-*.ts`, `gates-phase.ts`,
     `decide.ts`, `verdict.ts`, `schedule.ts`): are the transitions, the tool-legality derivation
     (`legalTools`), the git/edit/session deny matrices, and the decision precedence ladder correct?
   - §4/§5/§6/§7: roles→params/headers/packs injection (`adapter/inject.ts`), the wire contract
     (`adapter/wire-notes.md`, `router-client.ts`), the doctrine packs (`conductor/doctrine/*.md`)
     vs the §6.1 port map, the journal/levels (`adapter/journal.ts`).
   - §4.4 router semantics vs the C++ (`src/router/`, currently scaffold).
3. **The G1–G14 invariants.** Take each one and verify it's actually upheld by the code (not just
   asserted in a comment): G1 zero runtime deps, G2 erasable TS, G3 pure-core, G4 no stubs, G5
   router-optional identity, G6 single-writer-of-state, G7 detection-over-prevention (honestly
   documented), G8 orchestrator-doesn't-author, G9 stateless re-statement, G11 core-untouched-by-
   adapters, G13 one-model, G14 dual-runtime. Flag any that are claimed but not enforced.
4. **Test quality.** Run the full suite. Then judge the tests themselves against the plan's own
   `test-vet.md` anti-patterns (are they testing mock behavior? trivially-true? incomplete mocks?).
   Do the tests actually *pin* behavior such that a wrong implementation would fail, or are they
   permissive? Spot-check by mentally (or actually) mutating a handler and asking whether a test
   would catch it.
5. **Code quality & maintainability.** Readability, naming, idiom-consistency, error handling,
   dead code, the zero-dep / erasable-TS constraints, comment honesty (do comments describe what
   the code does, or what someone hoped?). Run `bash scripts/conductor-gate.sh`.
6. **Completeness & honesty of the build record.** Cross-check `STATE.json` / `GATES.json` /
   `CORRECTIONS.md` against the actual tree: is every "COMMITTED / PASS" claim true? Do the recorded
   `commitSha`s exist and contain what's claimed (`git log --grep='^conductor: '`)? Are deferred /
   blocked / "live-manual" items disclosed honestly, or is any evidence **fabricated**? (The build's
   stated worst-case failure is fabricating a live artifact — hunt for it specifically.) Are the
   C-001…C-028 deviations reasonable, or do any of them quietly weaken a plan invariant?

---

## 3. Review Part B — Adversarial review (prove or DISPROVE)

Assume the build may have cut corners, misread the spec, or papered over a hole. Your posture is
**refutation**: for every safety/correctness/behavior claim, try hard to break it, and only
concede when you cannot. Cite `file:line` + a **concrete reproduction** for every finding, and
classify each as **major** (real defect / wrong output / security hole / unmet requirement),
**minor** (real but bounded), **nit**, or **documented-limit** (a G7-disclosed gap — verify the
disclosure is accurate and the residual risk is as stated).

### B1. Correctness & robustness — attack each subsystem
- **Security gates** (`core/gates-git.ts`, `gates-edit.ts`, `shell-parse.ts`): try to get a
  destructive git command or an out-of-scope edit past the gate. Attack the shell tokenizer:
  wrappers (`env`, `sudo`, `bash -c`), quoting (`$'…'`, backticks, `${}`), redirects (`>`, `>|`,
  `tee`, `sed -i`, `perl -pi`, `dd of=`), path traversal (`..`), alias injection (`git -c`). The
  build claims to DENY the dangerous shapes and DOCUMENT the residuals (G7) — verify both, and try
  to find an *undocumented* bypass. Re-run the red-team-by-data tests and add your own spellings.
- **State store & crash-recovery** (`adapter/state.ts`, `journal.ts`, `evidence.ts`,
  `quarantine.ts`): torn writes, the advisory lock (dead-pid / over-age break, TOCTOU), atomic
  tmp+rename, cross-filesystem `EXDEV`, the crash-safe quarantine manifest replay, no-clobber
  restore, out-of-repo isolation. Simulate a crash mid-write (kill the write between tmp and
  rename in a scratch harness) and see if the next read heals or corrupts.
- **Fan-out concurrency** (`adapter/fanout.ts`, `router-client.ts`): the concurrency cap, the
  wave barrier, the per-job watchdog (does it bound `session.create` AND the prompt?),
  watchdog-vs-completion double-resolve, the freeze-hold (a write-capable job held while a tree is
  frozen — can it double-dispatch or strand?), the failover latch. Look for races and leaks; a
  flake sweep (run the fan-out tests 10–20×) is fair game.
- **The pipeline tools** (`adapter/tools.ts`, Phase 9 — may be partially complete): classify's
  stricter-kind escalation + the §2.4 handler re-check (can a model sneak a too-big or untestable
  "trivial" item through?), decide's `requireTwoOptions` (can a `kind:derived` record with <2
  scored options persist?), surface/answer/defer (does answer clear exactly the bound items;
  does defer's disposition actually satisfy report's precondition?). Read-only handlers must
  mutate nothing.
- **The C++ router** (`src/router/`, scaffold): build it, run ctest, and read what exists against
  §4.4 — proxy pass-through verbatim (incl. SSE), admission (cap → queue → 503 envelope), schema
  OBSERVATION (never a 400 the direct path wouldn't return — the G5 fail-soft direction), the
  metrics ledger. Much is pending; assess whether the scaffold + the plan's design are sound.

### B2. Proper LLM behavior — does the design actually get the model to do what's intended? (KEY)
This system's entire premise is *mechanically enforcing good process on a fallible local model*.
Judge whether it will actually work when a real model runs inside it. Be specific and skeptical:
- **Is enforcement mechanical or cooperative?** The plan's core doctrine is "your claim is not the
  record" — every FSM advance must be **re-derived by the harness**, never trusted from the model's
  say-so. For each place the model reports success (test went red, test went green, review passed,
  classification, decision), verify the harness **independently re-derives** it (runs the test,
  parses TAP, re-checks the diff, validates the schema, re-runs the skeptic) rather than believing
  the model. Where enforcement is merely *advisory* (the model could route around it), say so —
  that is the failure mode that matters most.
- **TDD can't be skipped:** the plan claims RED-before-GREEN is *structurally* impossible to skip
  (the item FSM ordering + handler-run evidence). Try to construct a path where a model gets to
  GREEN without a genuine, harness-observed RED (e.g. a test that errors instead of failing, a
  stub that satisfies one assertion, a test disabled/weakened to make a finding disappear). Does
  the harness's evidence ledger + freshness check + stub scan actually close these?
- **Doctrine actually reaches the model:** the §6.4 injection must deliver the right doctrine pack
  to each role every request (G9, re-stated never remembered). Verify each of the 7 roles receives
  its §4.1 pack (note: the build's own Phase-8 gate already caught two packs that were loaded but
  never delivered — confirm those are truly fixed, and check receive-review.md's deferred delivery
  binding is honestly pending, not silently dropped). Would a 32k-context local model plausibly
  parse and follow these packs, or are they too long / abstract / contradictory?
- **The adversarial-review machinery is real:** the plan leans on skeptic panels, spec-before-
  quality adjudication, k-vote refutation, red-team-by-data. Verify these are wired such that a
  finding actually gets independently verified and can't be waved through — and that "empty
  findings = approval" can't be gamed.
- **The override / ask budgets and honest limits:** can a model spend its way around a gate via
  the override hatch? Is the budget actually bounded and does exhaustion truly stop the run
  (never convert to another override)? Are the §9 / G7 documented limits the *real* limits, or is
  something undisclosed?
- **The overarching question to answer explicitly:** *If a competent-but-lazy local model were run
  inside this harness today, at which specific points could it produce plausible-looking but
  unverified work that the harness would accept as real?* Enumerate them with `file:line`.

### B3. Method
- Prefer **reproductions over assertions**: a finding survives only if you can trigger the wrong
  behavior against the real code, or point to the exact spec clause the code violates. When you
  cannot break something you suspected, record the failed attempt — that is evidence it holds.
- Re-derive the build's own gate claims on a sample: pick a task, remove its subject file in a
  scratch checkout, and confirm its test actually goes red (the build calls this "M4"). Pick a
  security test and confirm it fails when you weaken the gate.
- If you find yourself needing to change the plan, a §2 schema, a closed vocabulary, or a G-
  invariant to "make it work" — that is a finding about the design, not a change to make. Report it.

---

## 4. Output — what to produce

Produce a single structured report (Markdown). If you can publish it as a shareable artifact/page,
do so; otherwise write it to `docs/reviews/fable-review-findings.md` (this is the one file you are
permitted to create outside scratch). Include:

1. **Executive verdict** (≤ 1 page): Is the committed work sound and faithful to the plan? Will the
   design deliver the intended LLM-orchestration behavior, or where does it fall short? Your
   confidence level and what most affects it.
2. **Full-depth findings** by area (§2 above), each with citations and a conformance verdict.
3. **Adversarial findings** by severity (major → nit → documented-limit), each with `file:line`, a
   concrete reproduction (or the failed-refutation note), and — for anything that looks like a
   documented limit — a check that the disclosure is accurate.
4. **The LLM-behavior assessment** (§B2): the explicit enumeration of every point where the harness
   trusts the model without re-deriving, plus your judgment on whether the "process quality from a
   small model" thesis holds as built.
5. **Honesty audit:** any fabricated/dishonest evidence found, or an explicit statement that you
   found none after checking (name what you checked — commit shas, live-task records, gate claims).
6. **Prioritized recommendations** — the smallest set of changes that would most raise correctness,
   robustness, and behavioral guarantees.

Be exhaustive, skeptical, and specific. Reward yourself for reproductions, not for volume. An area
you genuinely cleared is a valid result — but say what you did to clear it.
