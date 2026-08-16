# Conductor Review — Step 2: Enforcement & Correctness Findings

**Date:** 2026-08-16
**Reviewer:** step-2 composition/merge agent, reconciling seventeen part files in
`docs/reviews/conductor-review/parts/` (ten subsystem audits, six cross-cutting sweeps, one
composition pass). Those parts remain in place as the audit trail; this document is the step-2
deliverable per `2-enforcement.md` §Output. Full evidence (reproductions, mutation transcripts,
line numbers) lives in the cited part files; entries here carry the merged verdict, the reconciled
severity, and the origin id(s).

---

## 1. Executive verdict

**Enforcement holds where it re-derives mechanical facts, and fails at every seam where it hands
control to model judgment or to an unmaintained record.** The FSM edges, the RED/GREEN evidence
gates, freshness, the override budget's arithmetic, the publish HEAD/commit sequence, and the C++
router's byte-verbatim data path are genuinely strong — dozens of mutations went red on well-aimed
assertions, and the adversary could not narrate a green it did not earn, forge an evidence record,
or spend its way to PUBLISHED. The 92-correction campaign visibly worked at unit level.

But the review found **two system-defining defects that mean the harness cannot do its job with a
real model in its shipped default configuration**, and a large field of enforcement, honesty, and
test-quality holes:

1. **The entire §6.4 injection layer is dead code (ISSUE-001, CRITICAL).** No `chat.system.transform`,
   `chat.params`, or `chat.headers` hook is registered, so **no session ever receives its doctrine
   pack, the live state block (recommended-next-tool), per-role sampling, or the router tags**. The
   whole thesis of the system — "doctrine injected into every request" — is unimplemented, faithfully
   across all 52 tasks, because no task wired it. Every downstream advisory defense rests on a channel
   that does not exist, and G5 router/no-router equivalence is trivially true because conductor sends
   the router nothing distinctive.
2. **In the default `parallel.writes:"off"` mode, the composed system denies EVERY sub-session write
   (ISSUE-002, CRITICAL).** The registry hands the edit gate the evidence-layer slug `"main"`; the gate
   needs a path; `normalizeUnderTree(path,"main")` is null → deny. Reproduced end-to-end: no testWriter
   can write a test, no implementer can write code. Green only because every test drives a fake SDK that
   writes files directly.

Beyond those two: the phase-order gate covers only stage tools, so **every meta tool and
`conductor_classify` is guarded by nothing** (a lazy model closes a run `done` from DECOMPOSED,
reproduced); **RED-before-GREEN is defeatable by declaration** two independent ways (a test file inside
`fileScope`, and a `rootLevelOnly` glob hole that lets root-level production files skip TDD entirely —
both reproduced); the **git gate is walked around by common wrappers/keywords and by `git -c
core.pager=<cmd>`** (arbitrary command execution, reproduced); **`blocked`/`surfaced` stop kinds are
computed by core and written by nothing**, so an unattended run waiting on a human is mislabeled `done`
or lost to `noop` with the resume path dead (reproduced); and the build record has stopped being
maintained — STATE.json still narrates a G5 tautology C-089 retracted, 14 of 21 promoted G5 rows and 2
live 11.8 rows are unmet-but-COMMITTED, and one recorded `revertAssertion` does not reproduce.

**Is the evidence strong enough for a careful reader to accept without re-deriving? Frequently no.**
The acceptance meter's live-artifact rows accept a fabricated file in ~15 seconds; the G5 gate proves
shape not provenance; the source-audit `stripComments` blanks ~240 lines of `tools.ts` (including a
real journal call site) so the repo's best drift guard is partly blind (reproduced); and one full-gate
run is nondeterministically red on unmutated HEAD, so every "GATE PASS" and every mutation verdict is a
sample from a distribution (COMP-INJ-012 / ISSUE-134).

**Coverage: complete within the mandated scope.** Every production file under
`conductor/{core,adapter,plugin,tools}/`, `router/` and `scripts/` (excluding `conductor/tests/`)
appears in at least one part's coverage ledger — the UNOWNED FILES list for that scope is **empty**.
The one real gap is **`dashboard/ledger_view.hpp` and `dashboard/main.cpp`**, which sit outside the
named scope and were examined by nobody (see MERGE NOTES §12.5). Confidence is high on all reproduced
findings; the honesty and vocabulary findings are grep-and-read verified; a handful (marked) are argued
across a seam and not independently reproduced.

**Totals:** 138 ISSUEs (2 CRITICAL, ~40 MAJOR, ~45 MEDIUM/MODERATE, ~51 MINOR/LOW), consolidated from
~175 part-local findings (≈37 were duplicates merged across parts). See §12 MERGE NOTES for the full
mapping, severity reconciliations, and one contradiction resolved (C-030 E12). Step 4 later minted
ISSUE-139…-142 from this register's §12.2 DROPPED rows and one macro pointer; stub records sit at the
end of §2, full records in findings-capability §4/§5.1.

---

## 2. The ISSUE register

Entries are clustered by theme, related issues adjacent, roughly severity-ordered within cluster.
Each entry: **severity · pattern · location · defect · status · origin part-id(s) · fix direction.**

### Cluster A — The doctrine / injection collapse (the system thesis)

#### ISSUE-001 — The §6.4 injection layer is never wired: no session receives doctrine, the state block, sampling params, or router headers
- **CRITICAL · P6-at-scale + P12 · origin COMPOSITION-INJECTION-001 (also -002/-003/-004/-008 as facets)**
- **Where:** `plugin/index.ts` returned hooks (1260–1426) register `tool`, `chat.message`,
  `tool.execute.before`, `event` only — **no** `experimental.chat.system.transform`, **no** `chat.params`,
  **no** `chat.headers`. `adapter/inject.ts` (`buildSystemAppend`, `paramsForRole`, `headersFor`,
  `initPlugin`) is dead in production (grep: referenced only in comments + tests).
- **Defect:** the plan's load-bearing mechanism ("process re-stated every turn, never remembered") reaches
  no session. Consequences, each an independent spec violation: (a) doctrine packs do not arrive per §4.1 for
  any role — orchestrator gets `core.md` only via the fragment agent prompt; implementer/testWriter get the
  *name* "tdd.md"; planner/reviewer/skeptic get hand-inlined paraphrases in `tools.ts`; only `debug.md`
  arrives verbatim; `receive-review.md`/`test-vet.md` never; (b) the live state block with the recommended
  next tool reaches nobody — a small model never sees which tool is legal unless it calls `conductor_status`;
  (c) per-role sampling (§4.1 temperatures 0.1–0.7) is never applied; (d) `X-Conductor-*` router tags never
  sent, so priority/affinity/schema-observation observe nothing and the router's POC conformance dataset is
  structurally empty; (e) `initPlugin`'s "beacon absence proves init failed" ordering is not in force.
  wire-notes confirms all three hooks work at opencode 1.18.15 — this is not an upstream limit; the §8
  manifest simply has no task that registers them.
- **Status:** grep-verified; tests stay green because `tools-9.5a.test.ts` computes "delivered" by calling
  `buildSystemAppend` itself (the P6/P2 shape). No production wiring anywhere.
- **Fix:** register the three hooks; add a wire-level test asserting a stub provider sees the doctrine
  system message + headers per role.

#### ISSUE-002 — Default main-tree mode denies EVERY dispatched sub-session write (registry tree is the slug "main"; the edit gate needs a path)
- **CRITICAL (operability; fail-closed so not a security hole) · P3 + P12 · origin COMPOSITION-INJECTION-005**
- **Where:** `tools.ts:2362` (`sessionTreeOf = item.worktree ?? "main"`), fan-out registers `tree` verbatim,
  `plugin/index.ts:1356` `resolveSessionTree` keeps non-empty trees, `core/gates-edit.ts:128` `normalizeUnderTree`.
- **Defect:** under `parallel.writes:"off"` (shipped default), an item has no worktree, so the fan-out job's
  `tree` is the evidence-layer slug `"main"`. `normalizeUnderTree("<root>/src/a.ts","main")` is null → the
  edit gate denies every path, absolute or relative, edit tool or bash write shape. The pipeline stalls at its
  first write. Reproduced end-to-end through the real plugin + fake SDK (`role=implementer tree=main`, in-scope
  edit AND `echo > src/beta.ts` both denied). Green only because e2e's fake SDK writes fixture files directly
  and `composition-root.test.ts` gives every item a *worktree*, so the one shape production defaults to is
  composed by no test. C-037 ruling 5 fixed the marker→gate direction and left this one.
- **Fix:** `sessionTreeOf` (or the dispatch sites) must hand the gate a PATH (`item.worktree ?? store.root`)
  with the marker slug derived separately; add the missing no-worktree composition test.

#### ISSUE-003 — Doctrine lives in two unguarded spellings (packs vs. tools.ts prompt literals); the ENV_DOCTRINE_DIR override is ~95% theater
- **MAJOR · P3 · origin COMPOSITION-INJECTION-004 (see also SWEEP-VOCABULARY on role vocab)**
- The `.md` packs are anchor-tested and operator-repointable, but the doctrine sub-sessions actually receive
  is a separate hand-written restatement inside `tools.ts` (decompose ~1267, plan ~1471, review ~1755,
  skeptic ~1787, tdd 2868) with **no drift guard either direction**. Only `debug.md`'s *content* is ever read
  from the pack map, so an operator overriding `LLAMA_HARNESS_DOCTRINE_DIR` changes exactly one dispatch
  prompt. **Fix:** compose prompt content from the loaded pack map (the debugFixPrompt pattern), or drop the
  paraphrases under ISSUE-001's fix and add a drift guard for any that remain.

#### ISSUE-004 — §6.4 "fail-closed at init" is actually fail-closed at first tool call; `initPlugin` is dead; the beacon cannot say doctrine loaded
- **MAJOR · P4 + P12 · origin COMPOSITION-INJECTION-007**
- First hook use writes the §3.8 liveness beacon (`openWorkspace`) **before any pack is read**; `chat.message`/
  `tool.execute.before`/`event` never call `ensurePacks`. Delete the doctrine dir: the plugin loads, the beacon
  appears, a run is created, edits are gated — "work" has begun — and the pack failure surfaces only at the
  first stage tool. The §3.8 observability contract (the only defense the design claims against its own
  absence) is weaker than documented. **Fix:** load packs before the beacon write, or stamp `doctrineLoaded`
  into the beacon.

### Cluster B — The enforcement locus (who owns "is this tool legal now?")

#### ISSUE-005 — Meta tools and `conductor_classify` are guarded by NEITHER the phase gate NOR the (dead) advisory state block
- **MAJOR · P7 (two layers each assumed the other) · origin COMPOSITION-004 = unifies TOOLS-HANDLERS-A-001 + TOOLS-HANDLERS-B-001**
- `legalTools` has exactly two production call sites (`requireStageTool`, `waveVerdict`), covering only the 6
  stage tools + `dispatch_wave`. Every meta tool (`classify/decide/surface/answer/defer/queue_amend/inline_claim/
  override/report/status`) routes through none. The compensating control was the advisory state block, which
  ISSUE-001 proves is dead. Reproduced consequences: (a) `conductor_classify` on an advanced run clobbers
  `queue.json`, resets a GREEN item to PENDING, and moves the run FSM along edges §3.1 lacks (PLANNED→EXECUTING,
  or any state→terminal ANSWERED); classification-shopping re-rolls the classifier until it says "question"
  (A-001, reproduced); (b) classify→decompose→defer-all→report closes a run `done`/REPORTED from DECOMPOSED,
  skipping PLANNED/PLAN_REVIEWED/EXECUTING, because `handleReport` feeds `legalRunTransition` a hardcoded
  from-state `"EXECUTING"` (B-001, reproduced R1); (c) `inline_claim`/`queue_amend`/`decide`/`override` operate
  on terminal runs — inline_claim reopens G8 edit permission on a REPORTED run (B-001, reproduced R2). **Fix:**
  one `requireMetaTool(tool, store, runId)` choke point in `runTool` consulting `legalTools`, and `handleReport`
  passing `run.state`.

#### ISSUE-006 — Registered sub-sessions may call every `conductor_*` tool: an implementer can answer its own blocking question, defer its own item, or amend its own scope
- **MAJOR · enforcement gap at the composition seam · origin COMPOSITION-INJECTION-009**
- Fan-out sub-sessions are created with no `agent` (so the fragment's per-agent tool restrictions apply to no
  dispatched session), and `decideSession` allows any registered session any non-spawn call. Handlers check
  phase legality, not caller role. The root builds `askedBy`/itemId identity for `surface`/`override` but
  threads none for `answer`/`defer`/`queue_amend`. A dispatched implementer can self-answer (forging a human
  answer), self-defer, or widen its own `fileScope`. Also a design finding: §3.5's table only restricts
  *unregistered* sessions. **Fix:** thread caller identity; a `conductor_*`-from-non-orchestrator-registered
  row in §3.5.

#### ISSUE-007 — The §3.6 override `gate` argument is a free string; no phase-order consumption point exists; a misspelled gate burns the budget and can kill the run
- **MAJOR · P3 + P12 · origin TOOLS-HANDLERS-B-002 (reproduced R3)**
- Only `"session"`, `"git"`, `"edit"` are ever spendable (the three `consumeOverrideGrant` literals); no closed
  vocabulary validates the argument and neither doctrine nor any deny message names them. The phase-order gate
  cannot be overridden at all — yet §2.8's own worked example is `{"gate":"phase-order",...}`. A granted-but-
  unspendable override still taints the item, appends the anomaly, increments **both** budget meters, and
  returns `granted:true`; two such calls exhaust the default run budget and the third records an `env` stop and
  terminates the run. Honest use of the hatch as documented is punished. **Fix:** closed `OVERRIDE_GATES`
  vocabulary validated at mint time (refuse before spending); a phase-order consumption point or an explicit
  deviation.

### Cluster C — RED-before-GREEN / TDD defeat

#### ISSUE-008 — A behavioral item may declare its own test file inside `fileScope`: the implementer rewrites the vetted test, and `mark_green` re-runs it with no re-vet
- **MAJOR · P7 · origin TOOLS-HANDLERS-A-002 + SWEEP-ADVERSARY-001 (both reproduced at gate + queue level)**
- `validateQueue` has no `fileScope ∩ testScope = ∅` rule; `decideEdit`'s implementer arm allows any
  `fileScope` match and never subtracts `testScope`; `handleMarkGreen` re-runs whatever is at `testScope` now,
  never re-vetting or hashing. So an item with colocated tests (`src/**` + `src/foo.test.ts`) lets the
  implementer overwrite the vetted test with `assert(true)` and earn a GREEN the vet never approved — no
  override, no taint, no scar. The freeze covers only live verify markers, and `mark_green` sets none. **Fix:**
  reject `fileScope ∩ testScope` in `validateQueue`; subtract `testScope` from the implementer's writable set;
  belt-and-braces re-establish the captured red in `mark_green`.

#### ISSUE-009 — The `rootLevelOnly` glob optimization lets a root-level production file escape the `behavioralPaths` TDD-skip guard (skips RED + vet entirely)
- **MAJOR · P1 · origin SWEEP-ADVERSARY-002 (reproduced; one-line fix confirmed to close it)**
- `rootLevelOnly("**")` returns false (it contains `**`), so `firstIntersectingGlob(["config.ts"],["**"])`
  short-circuits to `null` while `globMatch("**","config.ts")` is true — the disjoint-path guard declares them
  disjoint and `validateQueue` accepts a `behavioral:false` item for a root-level production file. A
  non-behavioral item runs PENDING→GREEN with no test at all. Bites under the **safe default**
  `behavioralPaths:["**"]` and under ordinary `["**/*.ts"]`/`["**/*.go"]`. Invisible in dogfooding because
  conductor's own source is all under directories. **Fix:** treat any `**`-containing glob as "can match root
  level" (never skip it), or drop the optimization and rely on `scopesIntersect`.

#### ISSUE-010 — `handleMarkGreen` discards the zero-test/fallback facts: a green from a zero-test or full-suite-fallback run is admitted as the item's GREEN
- **MAJOR · P1 · origin TOOLS-HANDLERS-A-003**
- The red side (`redAdmission`) refuses a red that fell back or ran zero tests; the green side has no
  counterpart. `runTest`'s zero-test guard silently re-runs the FULL scope; if that exits 0, `mark_green`
  admits TEST_VETTED→GREEN though the item's own test **provably executed zero times**. A `fileScope`
  containing any collection-affecting file (conftest, vitest config, package.json — unconstrained per ISSUE-008)
  reaches it; `validate` inherits the same deselection. The green §2.6 record carries no `targeted`/`fellBack`
  field, so a forensic reader can't tell a targeted green from a fallback green. **Fix:** refuse (or journal +
  record) `ranZeroTests || !targeted` on the green path; add `targeted` to the green record.

#### ISSUE-011 — `classifyFailure` "missing-subject" is vacuous under a wildcard-headed `fileScope`: any unresolved import becomes a legal RED
- **MAJOR (the vet backstop is the untrusted surface) · P1 · origin CORE-LOGIC-005 (reproduced twice)**
- §2.6.1 makes `missing-subject` "not a loophole" by requiring the specifier resolve inside the item's
  `fileScope`. `globMatch("**", anySpecifier)` is true, so with `fileScope:["**"]` a test that merely imports a
  nonexistent module produces a harness-blessed legal RED asserting nothing — and `validateQueue` accepts `["**"]`
  for a behavioral item (no breadth cap, no wildcard-head rejection). Same root as C-055 in an unpatched consumer.
  The only backstop is the vet critics — model judgment. **Fix:** reject wildcard-headed globs in `validateQueue`
  (reuse `isDegenerateScope`), or require a non-empty literal head in `classifyFailure`.

#### ISSUE-012 — The §3.2 item size budget counts fileScope ENTRIES, so one broad glob evades it (C-030 E12 was wrongly refuted)
- **MEDIUM · enforcement-advisory + P10 · origin SWEEP-CORRECTIONS-004 (re-litigated; refutation does not discriminate)**
- `core/planning.ts:378` is `item.fileScope.length > ITEM_MAX_FILES` and the module is pure, so it counts list
  entries; `["src/**"]` counts 1 and grants edit permission over the whole subtree. §2.4 permits glob entries
  (publish was fixed to expand them). The recorded refutation was procedural ("the stronger panel governs"),
  not substantive. **Fix:** at queue-accept time in the adapter (which owns `expandScopeEntry`), expand globs and
  count files, or refuse globs in fileScope at decompose.

#### ISSUE-013 — The §2.10 vet criteria verdicts gate nothing: a critic that fails `wouldCatchWrongImpl` with an empty `mustFix` advances the test
- **MEDIUM · P13 · origin TOOLS-HANDLERS-A-004**
- `handleVetTest` advances when the `mustFix` union is empty; the five criteria verdicts are tallied and never
  consulted. A schema-valid `{verdictsByCriterion:{wouldCatchWrongImpl:{pass:false}}, mustFix:[]}` is
  self-contradictory and advances anyway, and the ambiguity resolves in the less-strict direction (the prompt's
  last word: "An EMPTY mustFix is the approval"). Contrast `handleClassify`, which normalizes the analogous
  contradiction. **Fix:** treat any `pass:false` as an implicit mustFix entry, or refuse and re-dispatch.

### Cluster D — Security / gates

#### ISSUE-014 — Common command wrappers and shell keywords hide a git write from the git gate (undocumented; also strips the fail-closed guard)
- **MAJOR · P1/P3 · origin GATES-SECURITY-001 (reproduced end-to-end)**
- `GIT_WRAPPERS` unwraps only `env/command/sudo/builtin/exec`. Any other tail-passing prefix — `nice`, `nohup`,
  `time`, `xargs`, `stdbuf`, `setsid`, `ionice`, `taskset` — or any shell keyword that precedes a command —
  `if`, `while`, `until`, `do`, `!`, `{`, `for … do` — makes the git verb invisible: `nice git apply x`,
  `if git apply x; then :; fi` all ALLOW while bare `git apply x` denies. `hasGitSegment` uses the same blind
  detection, so a gate crash on these commands fails OPEN. Not in the G7 residual disclosure, and
  `HONEST-LIMITS.md:119` falsely claims a wrapper "cannot hide one". No hand-written prefix list can be
  complete. **Fix:** fail-safe when any token basename-resolves to `git` in an unattributable position, or
  reject compound/keyword-prefixed bash the parser cannot fully attribute.

#### ISSUE-015 — `git -c core.pager=<cmd>` / `diff.external=<cmd>` executes arbitrary commands with a clean `git` word and a read-only subcommand; the disclosure falsely claims this class is closed
- **MAJOR (real arbitrary-command execution) + honesty · P9-adjacent · origin GATES-SECURITY-002**
- `gitSubcommand` skips `-c k=v` and lands on `log` (READ_ONLY_SIMPLE → ALLOW); git then runs the configured
  pager/external-diff. `git -c core.pager=touch\ pwned log`, `git -c diff.external=id diff`, `git -c
  sequence.editor=id log` all ALLOW. The sigil-deny (`hasUnresolvedExpansion`) never fires because the command
  word is the literal `git`. `HONEST-LIMITS.md:144` asserts the alias route is closed; task-15.1 assertion
  makes that closure a requirement. **Fix:** DENY `-c <config>=<value>` for the exec-triggering config keys, or
  disclose the open residual.

#### ISSUE-016 — Case-fold bypass of the `.conductor/**` state-area deny on a case-insensitive filesystem: `.Conductor/…` writes the real state area
- **MAJOR (forges the machine truth) · P1 · origin GATES-SECURITY-008 (reproduced)**
- `globMatch`/`segMatch` is byte-exact; `headsOverlap` deliberately folds case "because darwin is
  case-insensitive" — so the authors know the target FS. `globMatch(".conductor/**",".Conductor/state/x")` is
  false while the two are the same file on macOS/Windows. A session whose role scope admits the path (an
  orchestrator `**` claim, or an item whose `verifyScopePathsOf` yields `**`) can write
  `.Conductor/runs/<id>/state.json` — direct forgery of run state / evidence / journal. **Fix:** fold case in the
  `.conductor` deny on case-insensitive platforms, or canonicalize case before the deny check.

#### ISSUE-017 — `apply_patch`/`patch` (registered WRITE tools) bypass the edit-scope gate entirely: the snapshot reads one `args.filePath`, but patch bodies carry none
- **MAJOR if reachable / LATENT-HIGH · P1 · origin GATES-SECURITY-007 + COMPOSITION-INJECTION-011**
- `classifyTool` marks them "write" (so the registry gate denies unregistered), but `gateBeforeToolCall`'s edit
  branch runs only when `editPath = args.filePath ?? args.path` is defined, and a multi-file patch body carries
  neither. No patch-body path extractor exists anywhere. A registered implementer can `apply_patch` outside
  `fileScope`, in a sibling tree, or under `.conductor/**` with only the registry gate. wire-notes says the tool
  exists in the registry but is not in the offered set at 1.18.15 — a config flip from reachable. **Fix:** parse
  the patch body into targets and run `decideEdit` over each, or remove it from `WRITE_TOOLS` and record the
  decision; pin its availability in the wire contract.

#### ISSUE-018 — Write-shape extractor mis-parses the enumerated tools it claims to handle (`cp -t`, `--target-directory=`, `sed --expression=`) and is blind behind keyword/wrapper prefixes
- **MINOR (interpreter catch-all limits delta) + doc-accuracy · P1 · origin GATES-SECURITY-004**
- `cp -t /outside file.ts` surfaces the source (dest unchecked); `cp --target-directory=/outside file.ts`
  skips the gate; `sed --expression='…' -i secret.ts` surfaces nothing. The per-command arm skips only one
  wrapper and no keyword, so `if rm -rf /outside; then :; fi`/`nice rm /outside` surface no target — and because
  `writeShapedPaths` returns `[]`, the tool classifies as "read", so an *unregistered* session's out-of-repo
  delete passes the registry gate. Only the redirect scan is robust. `honest-limits-pending.md:53` names these
  tools as handled. **Fix:** honor `-t`/`--target-directory[=]`; don't assume operand 0 is the sed script;
  attribute compound/prefixed bash or fail safe.

#### ISSUE-019 — Hyphenated git plumbing binaries (`git-apply`, `git-push`, `git-reset`) are not detected as git
- **MINOR-to-MAJOR (depends on git-core on PATH) · P1 · origin GATES-SECURITY-003**
- `gitCommandWordIndex` compares basename `=== "git"`; `git-apply` basename is `git-apply`. Where these live on
  PATH, `git-apply p.diff` writes files as the denied `git apply` would. **Fix:** match a `git-<subcommand>`
  basename shape too.

#### ISSUE-020 — `git branch` allow arm is wider than "list forms": bare branch CREATION is allowed and `--set-upstream-to=<x>` bypasses the mutating-flag deny
- **MINOR · P3 · origin GATES-SECURITY-005**
- `decideBranch` allows anything not in `BRANCH_MUTATING`, so `git branch newbranch` (a ref write) ALLOWs;
  and `includesAny` matches exact tokens, so the `=`-glued `--set-upstream-to=origin/x` slips through while the
  space form and `-u` deny. **Fix:** default-deny non-list branch forms; normalize `--flag=value` before the
  comparison (the gate already does this for `--git-dir=`).

#### ISSUE-021 — `git checkout -p` / `--patch` (a worktree-discard form) ALLOWs under `branchPolicy:"check-only"`
- **MINOR-MODERATE (non-default policy) · P8-ish · origin GATES-SECURITY-006**
- `decideCheckout`'s unconditional worktree-discard list omits `-p`/`--patch`; under `check-only` it falls to
  `movement()` and ALLOWs, discarding uncommitted work the HEAD-check backstop can't see (checkout -p moves no
  HEAD). Sibling `restore -p` correctly denies. **Fix:** add `-p`/`--patch` to the unconditional discard denies.

#### ISSUE-022 — `runActive: true` is hardcoded at the gate seam: pin-policy branch movement is denied forever, and the deny reason is an unkeepable promise
- **MINOR (fail-closed) / spec-MAJOR by the rubric · P4 · origin COMPOSITION-INJECTION-006**
- `plugin/index.ts:1384` passes the literal `true`; §3.5 says movement is denied only *while a run is
  non-terminal*. With no run or after termination, `git switch`/`checkout -b` is still denied and core emits
  "allowed once the run terminates" — a promise the composed system can never keep. `gates-git.ts`'s
  `runActive:false` arms are reachable only from tests. **Fix:** derive `runActive = run !== null && !isTerminal(run)`.


### Cluster E — State store, locks, evidence, crash-safety

#### ISSUE-023 — "Read-only conductor" guards 2 of ~12 mutating store methods, and nothing consults the flag; the second session also overwrites the live writer's beacon
- **MAJOR · P4 + P7 · origin STATE-CRASH-001 (reproduced, E3)**
- Only `createRun`/`removeItem` throw on `readOnly`; `saveRun`/`saveItem`/`setBlocked`/`clearBlocked`/
  `setDeferred`/`setDebugging`/`addStaleRed`/`removeStaleRed`/`archiveRun` write unguarded, and
  `grep -rn "\.readOnly"` finds zero consumers outside `state.ts` — no handler or composition root refuses work.
  The `alive.json` beacon is written unconditionally before `acquireLock`, so the demoted second session names
  the wrong process in §3.8's liveness signal. The plan's task-4.1 "read-only conductor for the second session"
  holds only for creating runs and removing items. **Fix:** guard every mutating method (or refuse handler
  registration when `store.readOnly`); write the beacon after winning the lock.

#### ISSUE-024 — Stale-lock break is a naked read-then-overwrite: two racers on one stale lock both become writers (TOCTOU)
- **MAJOR (mechanically confirmed by widening the window; real window small) · TOCTOU · origin STATE-CRASH-002 (E2)**
- The fresh-claim path was hardened with `flag:"wx"`; the stale-break path has the identical read→decide→plain-
  overwrite shape with no exclusivity — two processes that both read a dead-pid lock both decide "stale", both
  overwrite, both return `readOnly:false`. The corrupt-lock path has the same hole. Post-crash simultaneous
  restarts are exactly what see stale locks. **Fix:** break-then-claim exclusively via the same `wx` path.

#### ISSUE-025 — `release()` deletes whoever's lock is present, handing the workspace to a third writer
- **MODERATE · ordinary-correctness/P7 · origin STATE-CRASH-003 (E4, deterministic)**
- `release()` checks only its own `readOnly` flag then `rmSync(lockPath)`; it never verifies `lock.pid === pid`.
  A >24h session whose lock was legitimately over-age-broken deletes the NEW writer's lock; a third opener then
  fresh-claims beside the second. **Fix:** re-read the lock and delete only when the pid matches.

#### ISSUE-026 — Evidence `nextSeq` is a read-max-plus-one with no cross-process guard, and `evidence.jsonl` is per-RUN: two writers mint duplicate seqs and `readEvidenceAt` returns the wrong record
- **MODERATE (conditional on 023/024) · P1-adjacent + misattribution · origin STATE-CRASH-005**
- Single-process is safe (synchronous appends), but the ledger is shared by every item, so the double-writer
  states ISSUE-023/024/025 make reachable let both processes mint the same seq; `readEvidenceAt` returns the
  first match, so `validated.seq` can resolve to another item's/session's verify record and freshness is checked
  against the wrong record. **Fix:** single-writer (primary); an O_APPEND-reserved or lock-guarded seq;
  itemId/tree assertion in resolvers.

#### ISSUE-027 — Publish resolves its verify record by seq alone and never checks the record's `itemId` or `tree`
- **LOW (latent; single-process correct) · P4-adjacent · origin STATE-CRASH-006**
- Publish step 1 checks only `record.head`; `readEvidenceAt` matches seq only, while `capturedRedOf` DOES filter
  `itemId` — an inconsistent attribution check. Any mechanism that mis-points `validated.seq` (ISSUE-026 or a
  future bug) is not caught. **Fix:** assert `record.itemId === itemId` and, in worktree mode, `record.tree`.

#### ISSUE-028 — The composed double-writer → seq-collision → wrong-record-publish chain crosses three subsystems and is owned by no single lens
- **MEDIUM · P7 · origin COMPOSITION-005 (chained from STATE-CRASH-001/002/003/005/006; not separately reproduced)**
- The reachability (023/024/025) and the consequence (026/027) live in different subsystems; the chain is the
  reachable corruption path: two processes mint the same seq → publish ships one item's green on another's
  verify. **Fix:** single-writer (OS `flock` held for process lifetime) as primary; itemId/tree check in
  `readEvidenceAt`'s security-relevant callers as cheap defense-in-depth that closes the composition regardless.

#### ISSUE-029 — A quarantine partial-move crash leaks its dir forever and is re-scanned on every verify
- **LOW (no data loss; unbounded dir accumulation + per-verify rescan) · resource-leak · origin STATE-CRASH-004 (E7)**
- The manifest is written once (all `restored:false`) and never re-persisted; `restoreEntries` flips
  `restored` in memory only. A crash after moving A but before B leaves B in the repo → treated as a §F2
  "conflict" → the whole `<runId>` dir preserved and re-walked by every future `replayPendingRestores`. **Fix:**
  re-persist the manifest after restore, or distinguish "never moved" (src absent, dst present) from "refilled".

#### ISSUE-030 — The abandonment fence covers only the StateStore: an abandoned stage still appends evidence, mints questions/decisions, and dispatches sub-sessions
- **MEDIUM · P4 · origin TOOLS-HANDLERS-A-005 + TOOLS-HANDLERS-B-014 (merged)**
- `fenceStore` proxies StateStore methods only; `evidence.runTest/runVerify`, `appendQuestion`,
  `appendDecision`, `appendAnomaly`, and `fanout` all bypass it. An abandoned `handleMarkGreen` still appends
  its record (which `capturedRedOf` later treats as authoritative); `blockAndAsk` can leave an ORPHAN OPEN
  question whose `blocksItems` names an item not actually blocked; the abandoned stage keeps burning fan-out
  budget. The message/comment claim "may no longer read or write the run's state" — false for the ledgers.
  **Fix:** thread an abort signal into the executor context, or fence at the run-dir layer; correct the message.

### Cluster F — Concurrency, liveness, fan-out

#### ISSUE-031 — A `journal.log` throw inside the fan-out watchdog callback (or the error catch) skips `finish()`: the wave barrier never resolves and the exception escapes as an uncaught timer error
- **MAJOR (liveness + G5; low per-call likelihood, permanent wedge) · P7/crash-safety · origin FANOUT-CONCURRENCY-005**
- `journal.log` does unguarded `appendFileSync`/rotation `writeFileSync` (ENOSPC/EACCES/dev-mode unknown-event
  throw); the watchdog `setTimeout` calls it BEFORE `finish` and outside any try, and the plugin's journal
  wrapper adds no catch — so a throw both escapes the detached timer (process-fatal) and skips `finish`, hanging
  the wave, `dispatchWave`, and the awaiting tool call forever. `continuation.ts` orders its equivalent path
  defensively; the fan-out engine has no outer net. **Fix:** wrap the watchdog body + catch-path journal call in
  try/catch (finish regardless), or a catch-and-stderr journal wrapper.

#### ISSUE-032 — The test gate has no `--test-timeout`: a hang-shaped fan-out regression wedges the gate forever instead of failing it
- **MAJOR (the gate is the enforcement backbone; a wedge is worse than a red) · new class · origin FANOUT-CONCURRENCY-006 (measured twice)**
- `scripts/test-conductor.sh` sets no timeout (`--test-timeout=0`). MUT-5 (arm watchdog only after create) made
  the create-hang test deadlock — node never exits, the gate never reports; MUT-3's red left un-unref'd 900s
  timers stalling the runner ~15 min. `fanout.test.ts:447` cites a "suite's --test-timeout" that does not
  exist. The single most valuable regression signal (a wedged wave) becomes an infinite hang. **Fix:** pass
  `--test-timeout` (e.g. 120000); fix the comment; add a small `subSessionTimeoutMs` in `makeConfig()`.

#### ISSUE-033 — A re-prompt whose promise never settles raises the one-in-flight latch forever: the idle engine goes permanently silent and no floor can fire
- **MAJOR-shaped, MINOR-rated (needs a hanging transport) · P7 · origin FANOUT-CONCURRENCY-010**
- `rePromptInFlight` handles settle-ok, settle-reject, and sync-throw, but a never-settling promise is the
  fourth outcome: the latch stays raised, every `handleSessionIdle` returns at the latch check, counters freeze,
  §3.7's only wedge detector never fires. The fan-out engine already bounds its prompts with a watchdog; the idle
  engine's has none. The header comment names this exact danger. **Fix:** watchdog the re-prompt at
  `subSessionTimeoutMs`, or count latch-skipped passes toward a floor.

#### ISSUE-034 — A deterministic throw early in `handleSessionIdle` (reconcile/currentRun/loadRun) makes the idle engine permanently silent through the G5 catch; no floor converts it to a stop
- **MINOR · P7 · origin FANOUT-CONCURRENCY-011**
- A corrupt run.json / schema-invalid item throws before the halt/wedge/re-prompt checks; `handlePluginEvent`
  journals `hook.failed` and returns, every pass, forever — no `noop`, no report. The transport floor exists for
  exactly this shape but doesn't cover the store seam. **Fix:** wrap the pre-decision section so a throw still
  reaches the halt/terminality checks, or extend the failure floor.

#### ISSUE-035 — The watchdog-fired-then-create/prompt-completes paths are proven by nothing: MUT-2 (delete the late-create abort) survives the FULL gate — a leaked live sub-session per race
- **MINOR (resource leak on a rare race) · P11/P12 · origin FANOUT-CONCURRENCY-007**
- Deleting the abort of a session created after its watchdog already timed out leaves the whole 1382-test gate
  green. Watchdog-vs-completion double-*resolve* is structurally prevented (the `done` flag + promise-resolve
  idempotence), but the post-abort tail's economy/telemetry (leaked session; false `subsession.complete ok:true`
  on a re-prompt) is untested. **Fix:** two tests for the create-after-watchdog and prompt-after-watchdog arms.

#### ISSUE-036 — An undelivered NEEDS_CONTEXT conversion is reported "lost" TWICE, and the test that claims "exactly once" samples before the second record lands; a retention leak besides
- **MINOR · P13 + small real defect · origin FANOUT-CONCURRENCY-008 (reproduced)**
- `cleanupAndArchive` logs each pending conversion as lost but does not remove it; `takeConversionsFor` later
  drains and logs it again ("discarded"). The committed test's `lost.length === 1` runs before the second idle.
  Dead conversions stay in `state.pendingConversions` for the process life. **Fix:** filter the queue in
  `cleanupAndArchive`; move the test's count assertion after the second idle.

#### ISSUE-037 — The ask-gate's wildcard screen covers `patterns` but not `metadata.filePath`/`metadata.path`: a wildcard riding metadata is adjudicated as one concrete file and `decideEdit` allows it
- **MINOR-to-MAJOR (fail-closed asymmetry at an SG-10 "unrecognized payload fails closed" boundary) · P1-adjacent · origin FANOUT-CONCURRENCY-009 (reproduced)**
- `hasWildcard` is applied only to `event.patterns`; `metadata.filePath`/`metadata.path` are returned unscreened
  and win the extraction precedence, so a wildcard in metadata (patterns absent) matches the claim glob and
  is replied `"once"` — the exact `**`-on-one-file grant SG-10 forbids. **Fix:** apply `hasWildcard` to the
  metadata fields (return null).

### Cluster G — Router-metrics wiring, failover, C++ router

#### ISSUE-038 — Production never wires `fetchMetricsSummary` into `conductor_report`: the §4.4 metrics ledger is unreachable in every production report
- **MAJOR · P12 + P3 · origin FANOUT-CONCURRENCY-001 (grep-verified)**
- The one `deps` bundle every bound tool spreads has no `metrics` field, so `input.metrics` is always undefined
  and the router-metrics section is permanently "unavailable". Only e2e and the g5 tool pass the real function.
  The seam is already fail-soft. **Fix:** compose `metrics: () => fetchMetricsSummary(...)` into the report deps,
  or record the deviation.

#### ISSUE-039 — `FailoverState.metricsPartial` is written and read by nothing: the §4.4 "mark the run's metrics partial" clause is unimplemented
- **MAJOR · P4 + P12 · origin FANOUT-CONCURRENCY-002 (grep-verified)**
- `noteRouterFailure` sets it; the comment names Task 9.5b as the reader; no report/journal/artifact ever reads
  it. Combined with ISSUE-038, a run whose router died mid-way is indistinguishable from full coverage. **Fix:**
  thread `failoverState` into `ReportInput` and render partial-ness; correct the comment.

#### ISSUE-040 — §4.4 failover protects only conductor's own setup-probe HTTP requests; the run's MODEL traffic cannot fail over at all, and `routerHealthy` has no production caller
- **MAJOR (spec/honesty gap; structural) · P12 + P4 · origin FANOUT-CONCURRENCY-012 (grep-verified)**
- Model traffic flows opencode → fixed provider baseURL → router; the plugin cannot re-point opencode
  mid-session and nothing tries, so when the router dies mid-run in-flight sub-sessions die and the run takes
  `env` failures — the exact outcome the plan says failover prevents. The latch diverts only setup proofs;
  `routerHealthy`/probingDisabled have zero production callers. router-client's header repeats the plan's claim
  verbatim; no deviation recorded. **Fix:** record the deviation (failover = setup probes only; mid-run
  resilience = supervisor restart); correct the header; delete or wire `routerHealthy`.

#### ISSUE-041 — §4.4's "503 the fan-out engine understands (backs off and retries; bounded)" has no consumer anywhere, and no recorded deviation
- **MAJOR (spec conformance) · P12 · origin FANOUT-CONCURRENCY-003 + CPP-ROUTER-004 (merged)**
- The router's half (SG-1 envelope, three string codes) is implemented and tested; the fan-out half does not
  exist and structurally cannot see the 503 (it reaches the router through opencode's provider fetch). On an
  admission 503, opencode surfaces an error, `extractReplyText` returns "", and the engine burns its ≤2 *schema*
  retries with zero backoff. `queue_timeout` vs `queue_overflow` inform nobody. The C++ comment asserts "the
  discriminator the fan-out side acts on" — a consumer never built. **Fix:** implement envelope-aware backoff,
  or amend the comments/HONEST-LIMITS to say the codes are diagnostic only.

#### ISSUE-042 — Router pool sizing implements `maxInflightPerModel` as a single addend while admission caps per client-controlled model KEY: distinct model strings exhaust the pool and starve `/conductor/health`
- **MAJOR as a liveness inversion (reproduced live) / MINOR in the shipped single-model deployment · origin CPP-ROUTER-002 (probe P-02)**
- The pool is `maxQueued + maxInflightPerModel + 8` (one addend), but admission grants `maxInflightPerModel`
  slots to every distinct model string from the (unvalidated) request body. 10 concurrent slow POSTs naming 10
  distinct models exhausted the 9-thread pool and made `GET /conductor/health` time out (curl exit 28); the
  same load with one model gave 9 immediate 503s and health answered throughout. The STATE.json 11.4 deviation
  records the scalar reduction as sound but not the liveness consequence; the supervisor would read a healthy
  router as down. Also a slow unbounded `AffinityPolicy` leak under adversarial names. **Fix:** bound distinct
  in-flight model keys, admit non-configured models under the "" bucket, or size the pool from a declared list.

#### ISSUE-043 — No automated check ever runs the C++ config parser against the CURRENT exported schema; the CMake export step was deferred at 11.1 and never landed; the schemas dir is gitignored
- **MAJOR (the layer-1↔layer-2 schema contract is guarded by nothing automatic) / MINOR blast radius · P7 + P1 · origin CPP-ROUTER-003 + ADAPTER-REMAINDER-TOOLS-004 (merged)**
- The node gate regenerates `router/tests/schemas/*.json` but runs no C++; ctest runs the C++ against whatever
  was last exported. A change to `RouterConfig` sails through the full gate green while `llama-router` could
  refuse to start in production; and a fresh clone following the briefing's build steps has an EMPTY schemas dir
  (config_test fails on the missing file). `exportSchemas` also never prunes a removed/renamed schema (planted
  `Zombie.schema.json` survives export). The 11.1 deviation promised the step at 11.6; 11.6 never mentioned it.
  **Fix:** add the pre-build `add_custom_command` invoking `export-schemas.ts`; make `exportSchemas` prune;
  give the gate an optional ctest leg.

#### ISSUE-044 — MetricsLedger's wait-sample vector grows without bound, and every `/conductor/metrics` poll copies-and-sorts it under the ledger mutex
- **MINOR (POC-scale) · resource-envelope · origin CPP-ROUTER-001**
- `waits_.push_back` per request forever; `summary()` does O(N log N) under `mutex_` on every poll, blocking all
  response completions in proportion to uptime. **Fix:** reservoir-sample or bucket the waits.

#### ISSUE-045 — `config_test`/`admission_test` schema-path fallback walks to a directory that no longer exists (`src/tests/schemas/`): dead code that resolves WRONG if the primary resolution ever fails
- **MINOR (latent, test-infra) · P12 + P3 · origin CPP-ROUTER-005**
- The `__FILE__`-based primary always succeeds under CMake absolute paths, so the fallback (searching a
  post-hoist-stale `src/` path) has never run; `schema_observer_test` does it correctly. **Fix:** use the
  `repoPath` idiom, or delete the fallback.

### Cluster H — Publish, report, item-review, setup handlers

#### ISSUE-046 — Publish freshness hardcodes `hasStagedDeletion: false`: a post-validate deletion ships on a verify that never judged it
- **MAJOR · P4/P11 · origin TOOLS-HANDLERS-B-004 (mutation M2: flipping the literal leaves the suite green — unenforced AND untested)**
- `verifyFreshFor` consults `indexMtimeMs` only when `hasStagedDeletion` is true; publish deliberately SHIPS
  deletions but computes freshness over `staged.filter(existsSync)` only. A change whose only post-validate edit
  deletes a staged file passes freshness (surviving mtimes older than `startedMs`, HEAD unmoved) and commits a
  tree state no verify describes. The handler detectably KNOWS which paths are deletions. **Fix:**
  `hasStagedDeletion: staged.some((rel) => !existsSync(join(treeRoot, rel)))`.

#### ISSUE-047 — §2.1 `{file}` substitution for format rules is unimplemented; check-mode rules deny every publish; the format test is vacuous
- **MAJOR (latent — setup proposes no rules; §2.1's own example is broken) · P12 + P13 · origin TOOLS-HANDLERS-B-005 (experiment M1)**
- `handlePublish` spawns `rule.command` with no `{file}` substitution and no appended path. A `["prettier",
  "--stdin-filepath","{file}"]` rule gets the literal `{file}`; a check-mode rule that needs the filename fails
  on every file → publish permanently denied. The test's fixture reads `process.argv[2]` (always undefined,
  publish passes nothing), so it throws for every input and the "denies on non-zero exit" test passes for the
  wrong reason — indistinguishable from a clean file. **Fix:** substitute `{file}` across `rule.command`; fix
  the fixture to read the path and add the clean-file counter-case.

#### ISSUE-048 — `conductor_setup` accepts `answers.behavioralPaths: []` from the model: one tool call turns the TDD law off for the whole repo
- **MAJOR · enforcement + P8 · origin TOOLS-HANDLERS-B-006**
- The only gate is `answers.behavioralPaths === undefined`; `[]` passes and writes. With `behavioralPaths:[]`,
  `behavioral:false` is legal for every item (∅-intersection vacuously true), so decompose can mark everything
  non-behavioral and skip RED→vet→GREEN repo-wide, silently. On a fresh repo the model relays the human's setup
  answers, so the fabrication is indistinguishable; `reconfigure:true` reopens the door on a configured repo.
  **Fix:** refuse `behavioralPaths:[]` (and a list intersecting no detected source glob) unless an explicit
  `acknowledgeNoTdd`; journal the answered values.

#### ISSUE-049 — Item-review skeptic adjudication keys on model-authored finding ids: cross-session id collisions collapse distinct findings onto one verdict (an upheld security finding is dropped)
- **MAJOR · P1/correctness · origin TOOLS-HANDLERS-B-003 (reproduced R4, discriminated by R4b)**
- Panels are built positionally (correct) but the outcome is `outcome.set(finding.id, …)` and consumed by
  `survivesById.get(finding.id)`; six independent lens sessions numbering findings F1, F2… collide with
  near-certainty. When two findings share an id, `outcome.set` overwrites — a finding upheld by its own panel is
  dropped when its id-twin is refuted (reproduced: a real security hole dropped, item advances REVIEWED).
  Pushback matching is substring (`concern.includes(id)`, so F10 matches F1). **Fix:** key on the entry
  identity; namespace ids `<sessionID>:<id>`; exact-token pushback matching.

#### ISSUE-050 — Worktree-mode publish recovery wedges: after a merge-back conflict (or red integrated verify) the re-publish finds "nothing to commit" and the item can never publish
- **MAJOR under `parallel.writes:"worktrees"` · P7 + P12 · origin TOOLS-HANDLERS-B-009 (traced; no test walks a second publish)**
- The conflict path demotes to GREEN expecting "re-validate and try again", but the item's changes were already
  committed on its worktree branch; the second publish's step-6 `git commit -- <paths>` on a now-clean tree
  exits 1 ("nothing to commit") → `publishDenial` forever. The member env-fails each wave; the run ends `noop`.
  **Fix:** treat "clean tree, branch ahead of base" as "commit already exists — proceed to merge-back".

#### ISSUE-051 — `conductor_answer` is the model's own tool and answered questions vanish from the report: the human-in-the-loop can be fully simulated
- **MAJOR (evidence-strength) · enforcement · origin TOOLS-HANDLERS-B-007**
- `handleAnswer` checks no author; any string clears the block; `reportQuestionLines` filters to
  `answeredIso === null`, so answered questions appear in no report mode. Every blocked item and human-territory
  refusal funnels to a §2.11 question the model may answer with fabricated text; a lazy model surfaces →
  self-answers → proceeds, invisibly. **Fix:** a "Questions answered during this run" report section;
  optionally gate `answer` on message provenance for `humanTerritory` questions.

#### ISSUE-052 — `conductor_defer` is freely model-callable and forges `kind:"human"` decision provenance, contradicting the C-044 ruling one file over
- **MAJOR · P3 + honesty · origin TOOLS-HANDLERS-B-008 escalated by SWEEP-ADVERSARY-003 (merged)**
- `handleDefer` writes `kind:"human"` (comment: "exempt from requireTwoOptions"); `tool-bindings.ts:201`
  records the C-044 ruling that a tool-call decision "was not asked of a human, so kind is always 'derived'".
  Every model deferral fabricates a human-authority record. Composed with the settled-report machinery, a lazy
  run defers the hard items and closes `done` with a green closing verify and forged human decisions — and the
  honest waiting run is punished (ISSUE-065). **Fix:** record `kind:"derived"` (or `orchestrator-deferred`)
  unless the defer carries an answered human question's id; optionally flag a defer-dominated settled set.

#### ISSUE-053 — `conductor_report` closes a run `done` on a RED closing verify (and §2.9's `done` row disagrees with §3.2 on blocked items)
- **MEDIUM · enforcement + P8-flavored · origin TOOLS-HANDLERS-B-010 (see also ISSUE-064)**
- The closing verify's result is rendered but not consulted; a run whose blocked item left broken production
  edits closes REPORTED/`done` with reasonDisplay "closing verify RED". §3.2 calls this "verification-before-
  completion made mechanical" — a law that cannot fail the completion is advisory. **Fix:** a red closing verify
  records `blocked`/`env`, or an explicit deviation; reconcile §2.9's done row with §3.2.

#### ISSUE-054 — Review-fix routing matches raw scope strings inside `suggestedFix`: glob scopes route test findings to the implementer (the guaranteed-deny path §3.3 warns about)
- **MEDIUM · P1 · origin TOOLS-HANDLERS-B-011**
- `routeOf` does `fix.includes(rel)` over raw `testScope`/`fileScope` ENTRIES, which are globs; a fix naming a
  concrete test file doesn't contain the literal `tests/parser/**`, so `namesTest` is false and it routes to the
  implementer (edit gate bound to fileScope) — "a guaranteed deny, three wasted rounds, a surfaced question".
  Tests pass because every fixture uses literal-path scopes. `finding.lens` is also model self-declared and
  never checked against the session's group. **Fix:** extract path tokens and `globMatch` against scopes;
  validate `finding.lens ∈ session.group`.

#### ISSUE-055 — A red re-validate inside `item_review` throws into a state no tool can service (VALIDATED + broken tree): the run ends `noop` instead of entering DEBUG
- **MEDIUM · P7 · origin TOOLS-HANDLERS-B-012 + COMPOSITION-003 (merged)**
- `revalidate` throws when red; publish's sibling path demotes to GREEN + debugging instead. `conductor_validate`
  is offered only to GREEN items, so the named remedy is illegal; `legalTools` recommends `item_review` for the
  VALIDATED item, which re-throws over the still-broken tree — three futile passes end `noop`, burning up to
  three review fan-outs and never arming DEBUG. The only escape requires the reviewers to fail at their job.
  **Fix:** on a red re-validate, `demoteReviewedToGreen` with `debugging` set (the publish precedent).

#### ISSUE-056 — `probeReverted` swallows a failed `git stash pop`: the item's implementation can be silently left in the stash
- **MEDIUM-LOW · P11/crash-safety · origin TOOLS-HANDLERS-B-013**
- `finally { runReviewGit(tree.root, ["stash","pop"]); }` discards the status; a test-run that writes into
  `fileScope` makes the pop conflict, git leaves the changes stashed, the re-validate goes red, and item_review
  misdiagnoses the fixer while the code sits in `refs/stash` unmentioned. **Fix:** check pop status; on failure
  journal at error with the stash ref and block the item.

#### ISSUE-057 — §3.6 inline-claim expiry ("until the item leaves its current state") is not implemented and §2.5 cannot represent it
- **MEDIUM · P8 (self-documented) · origin TOOLS-HANDLERS-B-018**
- `activeInlineClaimScope` explicitly leaves the mid-FSM half unimplemented; §2.5 `inlineClaim` stores no
  claimed-at state, so a claim grants orchestrator edit rights over the item's fileScope until PUBLISHED, not
  for the one state §3.6 scopes it to. Combined with ISSUE-005(c) (claims mintable on terminal runs) the hatch
  is materially wider than the plan. **Fix:** widen §2.5 with `stateAtClaim` (plan-level), or clear the claim on
  every FSM transition of the item.

#### ISSUE-058 — `item_review`'s re-validates never update `item.evidence.validated`; publish re-verifies work it already has a fresher record for
- **LOW (inefficiency + small honesty gap) · origin TOOLS-HANDLERS-B-015**
- After any fix round the freshest verify exists only as a ledger line; the item points at the pre-fix record,
  so publish finds freshness stale and re-runs the whole suite per reviewed-with-fixes item; report.md's evidence
  refs point at superseded records. **Fix:** update the ref after each green re-validate.

#### ISSUE-059 — `setupLiveRunId` fails open on an unreadable current-run pointer; it also restates the state-store layout by hand
- **LOW · P4 + P3 · origin TOOLS-HANDLERS-B-016 + SWEEP-VOCABULARY-016 (merged)**
- A torn `current-run.json` → `return null` (= "no live run"), while a run.json read failure THROWS — so
  `reconfigure:true` can proceed under a possibly-live run. The path is composed independently of `state.ts`'s
  owner (a layout rename leaves the guard reading nothing → null → reconfigure under a live run). **Fix:** treat
  an unreadable pointer like an unreadable run.json (throw); export `currentRunPointerPath`/`runJsonPath` helpers.

#### ISSUE-060 — Publish advances an item to PUBLISHED having staged zero files, silently
- **LOW-MEDIUM (posture) · origin TOOLS-HANDLERS-B-017**
- An item whose scope globs match nothing publishes with `files:[]`, no commit, `ok:true`. For a
  `behavioral:false` item the whole pipeline can complete having changed nothing. **Fix:** deny (or warn +
  report) a publish whose staged set is empty while its fileScope names uncreated paths.

#### ISSUE-061 — Over-budget override writes the stop before the stop-report; a throwing report writer leaves a stopped run with no artifact
- **LOW · P7 (narrow) · origin TOOLS-HANDLERS-B-019**
- `run.stop = stop; saveRun` then `await handleReport(...)`, whose stop mode still reads `queue.json`/items
  unguarded; a torn file makes the report throw after the env stop is persisted — a terminal run with no
  report.md, violating §2.9. **Fix:** stop-report mode should fail soft per section.

#### ISSUE-062 — `handleAnswer` swallows a question-ledger read failure and reports items cleared
- **LOW · P11/fail-open · origin TOOLS-HANDLERS-B-020**
- `try { ledger = readQuestions } catch { ledger = [] }` → the C-056 successor rule degrades to "release
  everything" exactly when the ledger is torn (its answer least trustworthy). Contrast requireStageTool, which
  turns the same torn file into a named refusal. **Fix:** rethrow with the named-repair message.

#### ISSUE-063 — dispatch_wave's freeze-hold bound applies only when the freeze was observed BEFORE dispatch: a marker going live in the check-to-admit window makes the wave await unbounded
- **LOW (narrow race) · P7/TOCTOU · origin TOOLS-HANDLERS-A-006**
- `awaitHeld` wraps settlement only when `isFrozen` was true at the driver's check; a marker created after (a
  concurrent validate member) but before the engine admits produces a held job the driver awaits with no budget.
  The escape is a sibling's `notifyClear`. **Fix:** always race against the budget when `SERIAL_STAGES.includes(tool)`.

#### ISSUE-064 — `assertDecisionValid` is a decorative check: no test proves the DecisionRecord validator can refuse
- **LOW · P5 · origin TOOLS-HANDLERS-A-007 (mutation M24: no-op survives 10 suites incl. e2e)**
- Every caller constructs the record internally from typed fields, so the schema validation never fires in
  production and no test exercises its refusal; `requireTwoOptions` does the load-bearing work. **Fix:** add a
  refusal test, or drop the check.


### Cluster I — Terminal disposition / the wedge composition

#### ISSUE-065 — Two members of the closed §2.9 stop vocabulary — `blocked` and `surfaced` — are computed by core but written by NOTHING
- **MAJOR · P7 in its purest form · origin COMPOSITION-006 (root of ISSUE-066; enumerated exhaustively)**
- Every `run.stop =` writer in non-test source emits only `done` (report, hardcoded), `noop`/`env`/`interrupt`
  (continuation), `env` (override). `shouldTerminate` computes `{kind:"blocked"}`/`{kind:"surfaced"}` but its
  only consumer (continuation) records neither and defers them to `conductor_report`, which hardcodes `done`. A
  delegation ring with no writer. So a run where every remaining item is blocked reaches report (blocked =
  settled) → stamped `done` "the run completed" though nothing was published and every item waits on a human.
  The stop-report renderer is built for both kinds; only the writer is missing. **Fix:** give `handleReport` a
  stop-kind selection from the settled dispositions (all published → `done`; any blocked, none open → `blocked`;
  human-territory questions pending → `surfaced`).

#### ISSUE-066 — A blocked item WITH a dependent ends the run `noop`, never `blocked`/`surfaced`; after the noop archives, the documented `conductor_answer` resume path cannot revive the dependent
- **MAJOR (the primary unattended use case loses committed work) · P7 · origin CORE-LOGIC-006 + COMPOSITION-001 (reproduced end-to-end, PROBE-A)**
- `cannotEverPublish` deliberately excludes a *blocked* dependency (a question can be answered), so the dependent
  I2 stays `open` and `settledForReport` refuses report; `shouldTerminate` short-circuits on `open>0`, so
  `blocked`/`surfaced` are unreachable and only `noop` (the futile-wedge kind) can fire; the engine then
  archives the run and clears the pointer. Reproduced: answering the question after the noop clears I1's block
  but I2 stays PENDING forever — resume is dead. The incentive gradient runs backwards: the honest waiting model
  gets `noop` + lost work; the lazy model deferring I1 (ISSUE-052) closes clean `done`. **Fix:** classify
  "every open item dependency-stalled behind a blocked item with a pending question" as `surfaced`, not gated by
  the futile counter; and/or revive a `noop` run on `conductor_answer`; and/or don't archive a `noop` run that
  still carries an open question.

#### ISSUE-067 — A blocked item WITHOUT a live question (plus a dependent) is a permanently SILENT, undetectable wedge, and a committed test enshrines it as correct
- **MEDIUM (latent — production always mints a question first) · P7 + P13 · origin COMPOSITION-002 (reproduced, PROBE-B)**
- With no open question, `legalTools` offers no `conductor_answer`, `nextWave` is empty, so `actionable=false`
  and the engine prompts nothing; the futile counter never moves, `blocked`/`surfaced` are unreachable, the run
  sits in EXECUTING forever undetected. `[10.1-idle-null-recommendation]` constructs exactly this fixture and
  asserts "prompts NOTHING", certifying the silent wedge. Reachable today only via a future block-without-
  question site (SWEEP-CORRECTIONS-001 shows the reconciler leaves 5 of 7 origins un-reconciled). **Fix:** treat
  "unfinished items but no position-specific lever" as a detectable condition (a floor → recorded `blocked`/`env`
  stop with a report); re-point the test to a detectable outcome.

#### ISSUE-068 — `legalTools` recommends `null` (and its `why` lies) for a schedulable, legal no-git item when a REVIEWED item sorts first — a liveness wedge
- **MAJOR (a supported mode can silently wedge) · P7 + self-inconsistent verdict · origin CORE-LOGIC-004 (reproduced)**
- `nextWave` has no notion of `publishEnabled`, so under no-git a REVIEWED (terminal) item stays a wave
  candidate and sorts to `parallel[0]`; the recommendation path inspects only `parallel[0]`, whose tool is
  publish-suppressed to null, and never falls through to the schedulable `I2`. Result: `recommended:null` while
  the `legal` set contains `conductor_validate`/`conductor_dispatch_wave`, and `why` says "no item is
  schedulable" — contradicting its own legal set. Under scope conflict `I1` occupies slot 0 forever → permanent
  wedge. **Fix:** skip wave candidates whose effective tool is publish-suppressed, or exclude publish-terminal
  no-git REVIEWED items from `nextWave` candidacy.

### Cluster J — Core-logic correctness

#### ISSUE-069 — `requireTwoOptions` exempts `kind:"human"` from the ≥2-option rule, not just the scoring rule
- **MINOR-to-MEDIUM · P4 · origin CORE-LOGIC-001**
- §2.7 exempts only the *scoring* for human records; the code returns ok immediately for `kind:"human"` without
  checking `options.length`, so a human decision with 0 options passes the gate whose name promises two, and a
  model can skip the alternatives work by marking a decision `human`. **Fix:** check `options.length >= 2` for
  both kinds; keep only the score exemption.

#### ISSUE-070 — `isHumanTerritory` bare-word patterns misclassify common software vocabulary as human territory
- **MINOR (conservative direction; a liveness cost) · over-broad guard · origin CORE-LOGIC-002**
- `/\bsubscription\b/`, `/\bpublish/`, `/\bsecrets?\b/`, the delete/destroy pattern match ordinary technical
  questions (pub/sub, publisher, secrets schema), stalling runs on questions a human must answer. **Fix:** narrow
  the patterns to shapes only human-territory questions take.

#### ISSUE-071 — commit-message template embeds model-authored `item.id` and `fileScope` entries without newline neutralization
- **MINOR (requires degenerate decompose output) · P1-adjacent · origin CORE-LOGIC-003**
- `id` (subject) and `fileScope.join(", ")` are embedded raw; a `\n` in a glob injects a fabricated red-proof
  line, or a `#`-led line git silently drops, or a `Co-Authored-By` line the handler refuses (availability
  failure). Reachable only if nothing upstream rejects newlines in id/glob strings (the schema types them as
  bare `string`). **Fix:** fold `id` like the title (or validate `^[A-Za-z0-9_-]+$` at decompose); fold each
  fileScope entry before joining.

### Cluster K — Review-layer trust

#### ISSUE-072 — The review layer is accept-on-trust and the skeptic doctrine's "default refuted" biases the panel toward making real findings disappear
- **MINOR-to-MAJOR (the enforcement boundary; partly the known limit) · origin SWEEP-ADVERSARY-004**
- Empty findings is indistinguishable from never-looked: the blind-spot guard fires only when a lens returns no
  valid `Findings` object; a schema-valid `{"findings":[]}` advances the item with no forcing function that the
  reviewer read the diff. And `skeptic.md:20` instructs "uncertain ⇒ refuted", so an honest finding is reliably
  extinguished by a lazy panel (two lazy skeptics at k=2, one at k=1) — the C-032/P10 failure, here as the
  doctrine's stated default. **Fix (structural upgrade):** require each lens to emit evidence it read the diff (a
  cited range / handler nonce); flip the skeptic default to "uncertain ⇒ uphold, let the fix round decide".


### Cluster L — Build-record honesty (P9)

> **Overall honesty verdict (reconciled from sweep-honesty + adapter-remainder + cpp-router):** NO fabricated
> evidence was found. Every recorded commitSha exists and carries its message; the acceptance headline (17
> PASS / 4 FAIL) reproduces exactly; two sampled `revertAssertion`s reproduce their reds precisely; the two
> unbuilt live artifacts (SMOKE.md, conductor-report.md) never existed in git history — the "authoring either
> is fabrication" line was honored in fact. The honesty failures are of a quieter kind: **record surfaces have
> stopped being maintained**, and a cold-boot reader trusting the prescribed order inherits retracted claims.

#### ISSUE-073 — STATE.json still records the discredited G5 tautology (C-089) as real evidence, with no supersession pointer
- **MAJOR (record honesty) · P9 sealed into the ledger · origin SWEEP-HONESTY-001 + ADAPTER-REMAINDER-TOOLS-006 (merged)**
- Task rows `12.1` and `12.1-G5` still describe the two-identical-baseURL commands as "a real two-arm run" and
  cite the superseded 194-line artifact (shipped is 213), though C-089 proved the arms differed only by a var no
  source reads and the e2e had no router touchpoint. `revertAssertion` still argues the discredited record's
  case. STATE.json is "per-task machine truth" per the boot order. **Fix:** amend both rows to name C-089 and the
  superseding commit; add a `supersededBy` field.

#### ISSUE-074 — The G5 anti-tautology guard proves consistency, not provenance: an internally-consistent hand-fabricated artifact passes the full gate, and this residual is disclosed nowhere
- **MEDIUM (undocumented residual) · P9-adjacent · origin ADAPTER-REMAINDER-TOOLS-005 + SWEEP-HONESTY-002 + SWEEP-ROWS-AND-TESTS-004 (merged; reproduced)**
- The five rules operate on the markdown text: flattened arms, a WITHOUT-summary, and a provenance mismatch each
  go red, but setting both `ROUTER-SERVED-SUMMARY` and `REPORT-METRICS-WITH` to the same invented numbers keeps
  it GREEN — the checker compares the artifact's lines to each other, never to an event. Rule 3 is per-SET, so
  renaming the router-distinguishing var to an unread name still passes (the always-differing bookkeeping var
  `CONDUCTOR_E2E_FACTS` satisfies it forever); `envNamesReadBySource` counts a comment mention as "read". A
  six-line fabricated artifact returns `ok:true`. **Fix:** disclose the residual in the checker header +
  HONEST-LIMITS; special-case the seam var; have the driver emit facts the checker can independently re-derive.

#### ISSUE-075 — task-12.1-G5: 14 of 21 promoted ledger rows are unmet, with no supersession record; STATE.json says COMMITTED and acceptance row 9b passes anyway
- **MAJOR · P13 + P8 + honesty · origin SWEEP-ROWS-AND-TESTS-002 (every row read vs the shipped code)**
- The 21-row spec is the build's own definition of "G5 holds". The shipped fix is real but built against its own
  narrower 6-row `fix-phase12-g5` spec; the 21-row spec was left in place, all `coveredByTest:null`, zero ids
  named, no waiver. UNMET rows include the whole "leg B" (real provider traffic through the router,
  status-equivalence, schema-tagged-never-rejected, stream-relay-equivalent) and "leg C" (router killed mid-run,
  hostile-router, supervisor-restart), plus the comparator anti-vacuity self-check. `12.1-G5-acceptance-record`'s
  tick condition ("row 9 ticked only when legs A/B/C all passed") is violated by the meter that ticks it. A
  reader trusting the ledger believes G5 is proven at the promoted strength; it is proven at the fix-spec's.
  **Fix:** author a per-row disposition (met / superseded-by / deferred-with-owner), or implement the legs; make
  row 9b check something leg-B/C-shaped; register the failover-not-proven and non-v1-404 honesty notes.

#### ISSUE-076 — task-11.8 live-smoke: two LIVE rows (`11.8-streaming-live`, `11.8-failsoft-equivalence`) are discharged by nothing and NOT disclosed as undischarged; M7/M8 recorded PASS
- **MAJOR (build-record honesty) · P13 + P9 · origin CPP-ROUTER-006 + SWEEP-ROWS-AND-TESTS-003 (merged; every row read vs the artifact)**
- The artifact drove three requests; the streaming probe (`"stream":true` through the router) and the load-
  bearing live G5 fail-soft equivalence (direct-vs-router replay) appear nowhere, and the "does NOT discharge"
  section omits both. `11.8-models-and-404`, `11.8-binding-not-discharged` (no `## Task 11.8` section ever
  existed in UPSTREAM_CONTRACT.md), and `11.8-m8-artifact` (missing router sha + curl version) are partial. M8
  passed on artifact form; nothing adjudicated rows vs evidence. **Fix:** run the two probes and append, or add
  both to the not-discharged section AND STATE.json, and correct M7.

#### ISSUE-077 — UPSTREAM_CONTRACT's WIRE_CONTRACT_VERIFIED stamp cites "SSE chunk framing observed at 11.8" to an artifact that contains no streamed request; the guarding test checks only that the cited PATH exists
- **MAJOR (evidence integrity) / MINOR practical · P9 + P1 · origin CPP-ROUTER-007**
- `STEP2_ITEM_4` (SSE framing) is green while pointing at a file with zero streamed requests; the "items 1-4"
  phrasing appears inherited from C-041's pre-run *expectation* (prose matched against prose, the P10 lesson).
  A future engineer consulting the contract for llama-server's real framing has no recorded live observation.
  **Fix:** observe SSE live once; make the STEP2_ITEM check grep the cited artifact for the item's load-bearing
  marker (`text/event-stream` + `[DONE]`).

#### ISSUE-078 — C-075's mandated 14.2 spec revision never landed: a flawless POC campaign still fails acceptance, and the spec file is self-contradictory with the meter
- **MAJOR for the 14.2 campaign (tracked in HANDOFF, so MEDIUM overall) · P8 + recorded-obligation-never-scheduled · origin SWEEP-CORRECTIONS-002**
- `verify-acceptance.sh:163` hardcodes `POC=docs/build/artifacts/conductor-report.md`; `task-14.2.assertions.json`
  fixes the committed copy at `bench/conductor-report.md` only, and `conductor_bench.py:45` emits to
  `.data/benchmark/` — a three-way conflict. HANDOFF carries the obligation but the spec file itself is
  self-contradictory; the fix is a text edit owed across two corrections and one handoff without landing.
  **Fix:** add the second-path clause to `14.2-committed-copy` now, as C-075 specified.

#### ISSUE-079 — Refuted review findings are recorded without their refutation evidence, making P10 auditing impossible from the record
- **MEDIUM (process; the exact mechanism C-032 F1's false negative survived through) · P10 · origin SWEEP-CORRECTIONS-005 + SWEEP-HONESTY-005 (merged)**
- The three refuted phase-13 findings carry one line each (title, location, "both refuted"); upheld findings
  carry pages. Re-litigating them required re-running mutations from scratch, and one refutation elsewhere
  (C-030 E12 → ISSUE-012) turned out not to discriminate. Phase 8's four and C-027's one refuted findings are
  un-re-litigatable. **Fix:** record a refutation with the same evidence obligations as an uphold (the
  discriminating input, the run, the reading under which the finding fails).

#### ISSUE-080 — HONEST-LIMITS.md never received the Task-11.6 pending item; limit 9 still frames as conditional what the build measured as fact
- **MEDIUM (deferred-item disclosure) · P1 applied to a docs fold · origin SWEEP-HONESTY-004**
- Five of six pending items were folded; the 11.6 item ("router schema observation is request-side only on real
  fan-out traffic") was not, and limit 9 still reads "if opencode streams … that dataset is empty" though
  wire-notes recorded opencode 1.18.15 DOES stream — so the response-side dataset IS empty and every fan-out
  request records `schemaMissing`. **Fix:** append the 11.6 entry; reword limit 9 to the measured fact.

#### ISSUE-081 — `coveredByTest` is dead ledger weight: null on 548 of 795 rows, yet read as evidence by a phase adjudicator
- **MEDIUM (record trustworthiness) · P1 applied to the record layer · origin SWEEP-HONESTY-006**
- 26 ledgers fully populated (0.1–9.1); 34 entirely null (9.2 onward). The phase-13 adjudicator inferred "nothing
  tests them" from nullness for task-15.1 — true and corroborated there, false for task-14.1 (33/33 covered) or
  13.1-composition-root. A field authoritative for the first half of the build and noise for the second invites
  the frequency-over-position mistake C-082 documents. **Fix:** maintain it mechanically (grep row ids in test
  titles), or delete it and let M7 be the single source.

#### ISSUE-082 — The four record surfaces describe four different presents; only CORRECTIONS.md is current, and it is last in the reading order
- **MEDIUM (cold-boot honesty) · new class · origin SWEEP-HONESTY-007**
- JOURNAL.jsonl ends 2026-08-14 (and switches key vocab in its last entry); NOW.md frozen 2026-08-14 against its
  own "never a summary after the fact" promise; HANDOFF frozen 2026-08-15 CR-1 ("Do CR-2 next", done that
  night; gate 1326 not 1382); STATE.json 2026-08-15 with the stale G5 narrative. The prescribed cold boot
  (HANDOFF→STATE→NOW) delivers instructions to redo finished work and evidence already retracted. **Fix:** a
  single "record currency" stamp, or one refresh pass.

#### ISSUE-083 — The M1–M9 task-gate ledger silently ends at 11.8: eleven COMMITTED rows have no task-gate record
- **MEDIUM (record completeness) · P1 applied to the gate ledger · origin SWEEP-HONESTY-008**
- Tasks 12.1, 12.2, 13.1, 14.1, 15.0–15.2, 5.4a, 12.1-G5, 13.1-composition-root, CR-2 are COMMITTED with no
  `taskGates` row; `15.0` appears zero times in GATES.json. The uniform per-task gate record stops exactly when
  tasks started failing their phase gates; the late tasks' evidence lives in free-form STATE.json prose of
  varying shape. **Fix:** backfill terse taskGates rows, or record that the ledger's scope ends at 11.8.

#### ISSUE-084 — filesTouched/commitSha imprecision across nine STATE.json rows: the named commit does not contain what the row claims
- **MINOR overall (11.8 instance borders MAJOR) · P3-adjacent · origin SWEEP-HONESTY-003**
- e.g. 11.8's sha 2e3dd96 contains only the artifact; the four CLI files live in 6b732a3 under pre-hoist `src/`.
  15.1's ops-docs.test.ts arrived in a fix-round commit the row folds silently. Nine of 55 rows can't be
  mechanically replayed from commitSha+filesTouched. **Fix:** allow commitSha to be a list / add fixRoundShas; a
  checker asserting filesTouched ⊆ the named commits.

#### ISSUE-085 — Row `11.8-upstream-recorded` anticipates serve.py/qwen3.6-27b; the smoke ran a hand-started ornith-9b with flags serve.py never emits
- **MINOR (disclosed in substance, unreconciled in form) · P8-lite · origin CPP-ROUTER-008**
- Provenance was recorded but the row's named model/vehicle are not what ran, and F1-CONFIRMED later showed the
  G13 model behaves worse (1024 tokens of thinking, empty content) — exactly the divergence the model pin
  existed to catch. **Fix:** a deviation note reconciling row and record.

#### ISSUE-086 — The G5 driver's "the counter is live, and it moved" artifact claim is asserted by nothing; a live run showed the count drifting (4 where 5 requests were sent)
- **LOW-MEDIUM · P11/P9-lite · origin ADAPTER-REMAINDER-TOOLS-008 (reproduced live)**
- The two post-arm POSTs' results are discarded; `afterArmSummary` is read and printed, never compared to the
  fingerprint. A fresh run showed `totalRequests:4` after the arm where 5 were answered — a count-visible-after-
  response ordering that could also spuriously FAIL a WITH-arm provenance compare. **Fix:** assert
  `after.totalRequests === fingerprint.totalRequests + 2` (retry briefly); prove or drop the sentence.

#### ISSUE-087 — A stale prunable git worktree is again left registered by the gate (C-074 F3 recurrence, second instance)
- **LOW · hygiene · origin SWEEP-CORRECTIONS-006**
- `git worktree list` at review start showed `…/wt14 … prunable`; C-074 recorded the identical shape for wt12,
  cleaned it, and the next gate repeated the leak. The cleanup is manual and the claim "worktree removed
  afterwards" keeps entering records unverified. **Fix:** the fresh-worktree gate leg should end with
  `git worktree remove` + a `git worktree list` assertion in-script.

### Cluster M — Gate / scanner / meta-check mutation holes (verification audit)

#### ISSUE-088 — `stripComments` in both source audits treats `/*` inside STRING LITERALS as a comment opener: ~240 lines of tools.ts + ~227 of gates-edit.ts are invisible, including one real journal call site
- **CRITICAL for the audit layer · P1 in its purest form · origin SWEEP-GATE-MUTATION-007 + SWEEP-VOCABULARY-001 (merged; reproduced both directions)**
- The quote-blind stripper reaches `/*` inside a glob string (`**/*.go`, `.conductor/**`) and blanks everything
  to the next `*/` — for tools.ts, lines 9104–9254 (to EOF) and 8405–8488; for gates-edit.ts, lines 208–434.
  The real call site `tools.ts:9233 input.journal.log(…,"config.updated",…)` sits in the blanked span, so
  removing `"config.updated"` from the closed vocabulary stays 7/7 green (control on a visible site fails). New
  handlers appended after 9104 are born unaudited by both the journal-vocab and legaltools-callsites audits —
  the repo's best drift guard. The anti-vacuity floors can't see it (75 sites survive, above the floor of 60).
  **Fix:** make `stripComments` string-aware (~15 lines), hoist one shared copy, add a sentinel canary that the
  audit still sees the file's tail; then re-run.

#### ISSUE-089 — Deleting `conductor/tsconfig.json` silently disables the M3 typecheck leg (GATE PASS); `bun-smoke.test.ts` / `export-schemas.ts` legs vanish silently the same way
- **MAJOR (M3) / MINOR (bun-smoke) · P1 · origin SWEEP-GATE-MUTATION-001 + 002 + SWEEP-VOCABULARY-009 (merged; reproduced)**
- The leg-activation conditionals double as leg-disabling switches; the bootstrap window that justified them
  closed 50 tasks ago. Deleting tsconfig prints GATE PASS with no `typecheck: OK` line; nothing else asserts the
  file exists. A missing export-schemas.ts leaves router schemas stale on every gate run. Contrast
  verify-acceptance row 4, which hard-FAILS on a missing named guard file. **Fix:** invert the conditionals —
  after bootstrap a missing expected file is a FAIL.

#### ISSUE-090 — Task 11.5's recorded `revertAssertion` does not reproduce: the mutation it names is mutation-EQUIVALENT, and was at record time too
- **MAJOR (evidence integrity — a recorded proof that cannot be replayed) · P9-adjacent · origin SWEEP-GATE-MUTATION-009 (reproduced; verified against the 11.5 commit)**
- Dropping `burst_->priority == eligible` (as the record names) leaves ctest 100% green because
  `oldestBurstMember` already skips lower-priority entries — verified via `git show` that the inner filter
  existed at the 11.5 commit. Dropping the INNER filter DOES go red (also contradicting the record's "alone").
  revertAssertions are prose no gate ever replays; 7 of 8 others sampled reproduced exactly. **Fix:** correct
  11.5's entry to name the inner-filter mutation; note the outer guard as redundant.

#### ISSUE-091 — The whole 13.1 e2e passes 35/35 with a gate that denies EVERYTHING: no e2e row asserts an ALLOW through the real hook
- **MAJOR (the file's ledger calls itself "END-TO-END ACCEPTANCE, the whole system") · P5 in mirror image · origin SWEEP-ROWS-AND-TESTS-005 (measured; corroborated by sweep-corrections §6.1)**
- Every gate-shaped e2e row asserts a DENY; the fake-SDK responders write files directly, so no legitimate write
  ever needs the hook's permission. A harness whose gate bricked every session is invisible to the entire
  end-to-end suite. Contained one seam below (composition-root fails 5/27, gate-wiring 9/12 under the same
  mutation). **Fix:** one e2e row asserting a registered implementer's in-scope write is ALLOWED through the real
  hook, and one asserting an unregistered session's READ is allowed.

#### ISSUE-092 — M5's empty-catch scan cannot match the multi-line form (the only formatting anyone writes), and reports PASS over an explicit list of nonexistent files
- **MAJOR (near-decorative CATCH leg) · P1 · origin SCRIPTS-PYTHON-009 + SCRIPTS-PYTHON-010 + SWEEP-GATE-MUTATION-003 (merged; reproduced)**
- `PAT_CATCH` is line-based, so `} catch (e) {` + `}` on the next line never matches (single-line control does).
  Separately, `conductor-gate.sh` in explicit-list mode does `[ -f "$f" ] || continue` and reports "M5 PASS (2
  file(s) scanned)" over two nonexistent paths — the mode task gates actually used (C-078). **Fix:** a
  newline-tolerant scan for the empty-catch pattern; in explicit-list mode a named path that is not a file is an
  M5 FAIL naming it.

#### ISSUE-093 — verify-acceptance's live-artifact rows accept any fenced/prose file as a "command transcript": a fabricated SMOKE.md (~15s of work) flips row 6 FAIL→PASS
- **MEDIUM (evidence-strength; the two artifacts it matters for are the two not yet written) · P1/P9 · origin SWEEP-GATE-MUTATION-006 + SWEEP-HONESTY-009 + adversary CLP-2 (merged; reproduced)**
- `check_artifact`'s `grep -qE '^\s*\$ |^\s*```'` accepts a bare fence as a transcript; rows 6/7/8/9b need only a
  fence + a couple of substrings. For row 9b defense-in-depth held (the g5-artifact node guard rejected the
  fabrication), but rows 6 (SMOKE.md) and 8 (conductor-report.md) have no standing node guard — when 13.2/14.2
  are built, this shape + a 20-line floor is the only barrier, and exit 0 (the runbook's completion criterion) is
  nearly costless to fabricate. **Fix:** require at least one real `^\s*\$ ` command line; for 13.2/14.2 ship a
  standing node-suite checker BEFORE the artifacts; require artifacts to embed a runId + verify seq that
  re-validates.

#### ISSUE-094 — Acceptance row 10 passes with `derive_slots` collapsed to a constant 1: the row's expected values are derived from the subject it checks
- **MEDIUM · P2 + P13 · origin SWEEP-GATE-MUTATION-004 (reproduced)**
- Both sides of the row's comparison flow through `derive_slots`, so a constant-1 collapse (which serializes the
  whole fan-out) keeps internal consistency and passes; the `slots>1` guard skips the argv assertions. The row
  never checks that the number is a function of `maxReaders`. The python unit leg catches the collapse, but the
  *named* §11 acceptance check does not. **Fix:** assert against a restated literal (`derive_slots(readers) ==
  max(1, readers)`).

#### ISSUE-095 — Detector F accepts a prose mention of `WIRE_CONTRACT_VERIFIED` as a "real stamp"
- **MEDIUM · P1 (in the detector whose purpose is P9-adjacent) · origin SWEEP-GATE-MUTATION-005 (reproduced)**
- The check is "token present AND not `NAME: <pending`", so a sentence discussing the stamp, or `…: TBD`/`: no`,
  passes. The python stamp test (colon + date + task id) is the real guard. **Fix:** anchor on the stamped
  shape (`^\`?WIRE_CONTRACT_VERIFIED: \d{4}-\d{2}-\d{2}`).

#### ISSUE-096 — The purity guard's subprocess rule enforces only the IMPORT, so a shell-string `exec()` in an adapter passes every scan
- **MEDIUM · P4 · origin SWEEP-GATE-MUTATION-008 (reproduced)**
- The assertion text claims "every subprocess goes through execFile … with shell:false (G14)"; the body checks
  only that a subprocess-shaped file imports the sanctioned module. A live `exec("echo owned > /tmp/zz")` added
  to an adapter passes 4/4 — a G7-relevant security property whose one guard cannot fail for its violation
  (production code currently complies). **Fix:** forbid `exec(`/`execSync(` in adapter/plugin files; flag any
  spawn options containing `shell`.

#### ISSUE-097 — Acceptance row 3 passes vacuously if router test registration breaks: ctest exits 0 on "No tests were found"
- **MEDIUM · P1 (the zero-tests class a third time) · origin SCRIPTS-PYTHON-011 (verified)**
- The node leg guards `TESTS==0` and the python leg guards `Ran 0`; the C++ leg trusts ctest's exit and greps
  the summary for display only, so a `file(GLOB)` matching nothing or a dropped `add_test` records "row 3: ctest
  green — " with an empty summary. **Fix:** `ctest --no-tests=error`, or require the `N% tests passed` summary to
  parse a nonzero total.

#### ISSUE-098 — The gate's bun leg has no test-count floor: `bun test` exits 0 on a file with zero tests
- **MINOR (single file, currently populated) · P1 in the gate itself · origin SWEEP-CORRECTIONS-010 (verified)**
- The node and python legs both guard "zero tests ran"; the bun leg (the G14 dual-runtime proof) takes its
  verdict from the exit code and greps "N pass" for display only, so a bun upgrade breaking node:test interop
  passes vacuously. **Fix:** fail unless the captured "N pass" has N ≥ 1.

#### ISSUE-099 — Detector C's "is each router header exercised by a test" loop is dead code: it ends in `|| true` and its result is discarded
- **MINOR (misleading enforcement surface) · P1 · origin SCRIPTS-PYTHON-012 + SWEEP-GATE-MUTATION-011 (merged)**
- The loop computes a boolean and throws it away, sets no variable; a router header with no matching test file
  can never fail detector C (today every header has one). **Fix:** collect misses into a variable and fail on
  it, or delete the loop.

#### ISSUE-100 — The C-032 E7 crash-window class covers 7 blocking sites; the prevention half covers 2 and the repair half's origin filter excludes 4 of them
- **MINOR-to-MAJOR by site · CL-CRASHORD · origin SWEEP-CORRECTIONS-001 (verified at HEAD)**
- `reuseOrAppendBlockingQuestion` is called at 2 of 7 question-first/setBlocked-second sites; bare
  `appendQuestion`+`setBlocked` remains at 5 (mark_green stuck, blockReviewAndAsk, review-round-cap ×2,
  debug-architecture, scope-conflict, plan-review-cap). `reconcileOrphanQuestions` filters
  `origin !== "implementer-blocked"` → a crash in the window at the cap/scope-conflict/plan-review origins leaves
  an open question naming items with no disposition, un-reconciled. C-067(a) recorded two of these as owed; the
  wiring never happened across ≥3 subsequent tools.ts rounds. **Fix:** route all seven through
  `reuseOrAppendBlockingQuestion`; widen the reconciler's origin filter.

#### ISSUE-101 — The C-032 E12 torn-questions fix covers 2 of 4 reader sites: `conductor_status` and `conductor_report` still die with a raw SyntaxError
- **MEDIUM · CL-TORNLINE · origin SWEEP-CORRECTIONS-007 (reproduced)**
- `readQuestions` is a bare per-line `JSON.parse`; two callers (tools.ts:2609, dispatch_wave) wrap it in the
  named-refusal pattern, but `handleStatus` (the always-legal diagnostic) and `reportQuestionLines` (the STOP-
  REPORT writer) do not — a torn `questions.jsonl` makes the run unclosable with an error naming neither tool nor
  file. **Fix:** heal at the reader (skip unparseable lines the way journal.ts/evidence.ts do) — strictly better,
  makes the class unrepresentable.

#### ISSUE-102 — The C-032 E13 "floor fractional knobs at the read" rule is applied at eight sites and skipped at three
- **MINOR · CL-KNOB · origin SWEEP-CORRECTIONS-008 (verified)**
- Not floored: `planReviewMaxRounds` (2.5 grants a third revision), plan-review `skepticsPerFinding` (k=1.5 →
  fractional read-back stride → `undefined` verdicts → the "no skeptic verdict came back" throw, a transport
  error message for a config-shape error, C-031 E10's exact prediction), and `readFanout`'s raw min at some
  callers. The §2.1 schema types these `number` with no integer constraint. **Fix:** floor once in a shared
  `readKnob`/config-load normalization.

#### ISSUE-103 — The POC report's noise-honesty sentence can be inverted to a lie with every test green
- **MEDIUM-MAJOR (the exact honesty surface C-077 named) · P2 · origin SWEEP-CORRECTIONS-003 (reproduced)**
- `NOISE_NOTE = "…not separable."` is asserted only via `assertIn(cb.NOISE_NOTE, report)` — both sides read the
  module constant, so rewording it to "fully separable and statistically significant" survives 33/33. C-077's
  own fix (pin the literal in the test) was applied to the five formatters and not to `NOISE_NOTE`. **Fix:**
  `assertEqual(cb.NOISE_NOTE, "<full literal>")`.

#### ISSUE-104 — The "review findings upheld" bench metric reads a run-dir file nothing writes; its test fabricates the shape
- **MEDIUM-HIGH (a flagship-report column structurally 0) · P2/P4 · origin SCRIPTS-PYTHON-007**
- `_count_upheld_findings(run_dir/"reviews")` reads a `reviews/<id>-r<N>.json` that `replay.ts:18` states
  outright "nothing writes"; the metric is 0 for every live cell, rendered as a real measured zero. The test
  hand-writes the invented shape and asserts 3, proving only that the reader parses the test's invention. **Fix:**
  count upheld verdicts from a source that exists (journal review events / evidence), or land the §1.2 reviews
  writer first and pin the reader to its real shape.


### Cluster N — scripts / serve.py robustness (first live-contact failures)

#### ISSUE-105 — Ctrl-C at the session prompt kills the 20+GB model while the shell survives
- **HIGH · origin SCRIPTS-PYTHON-003 (reproduced under a pty, twice)**
- The generated rcfile traps `EXIT HUP INT TERM`; interactive bash executes an INT trap at the readline prompt
  and carries on living, so Ctrl-C at the prompt (the ordinary way to abandon a half-typed command) runs the
  cleanup — model dead, shell alive, `LLAMA_HARNESS_URL` points at nothing, the router proxies a dead upstream,
  opencode 502s. No test executes the generated rcfile under a pty. **Fix:** trap `EXIT HUP` only (EXIT covers
  exit/Ctrl-D, HUP the closing terminal; the detached watchdog covers SIGKILL); a TERM handler must `exit`.

#### ISSUE-106 — serve.main()'s router "launch" leg is executed by no test; two survived mutations prove it
- **HIGH · P12 (the C-087 class recurring on the branch every real router session takes) · origin SCRIPTS-PYTHON-004**
- Every main()-driven test passes `--no-router` or `--print-env`; the launch leg is called only directly, never
  through main(). M3 (swap `router_port`/`port` in main's `write_router_config` — every real router session
  self-proxies) and M4 (delete the fallback `stop_router_supervisor` — a failed router restarts forever) both
  survived the full 80-test python leg. The source-text pin greps the *resolve* call, not the
  `write_router_config` call two statements later. **Fix:** extend `ServeMainCase` with a launch-leg scenario
  (the helpers exist) asserting the written config's halves, the supervisor spawn args, and the fallback stop.

#### ISSUE-107 — The "hermetic" cell environment omits PATH, so every live 14.2 cell spawn-fails; the preflight checks a different environment than the spawn uses
- **HIGH (blocks 14.2's stated purpose on first contact) · P1 + P7 · origin SCRIPTS-PYTHON-006 (reproduced with the production functions)**
- `build_cell_env` returns seven vars, no `PATH`; `run_command` passes that as the child's entire env, so a bare
  `opencode` resolves against `os.defpath` and fails `[Errno 2] No such file or directory`. Every one of the 90
  cells records `harness-error` and the driver writes a complete report over zero real cells. `check_commands_
  spawnable` uses `shutil.which` with the DRIVER's PATH — approving commands the cell cannot spawn. **Fix:**
  include an explicit PATH in `build_cell_env`; make the preflight resolve against the cell's env.

#### ISSUE-108 — serve.wait_until_ready is reached by no test (the C-090 class recurring one function over)
- **MEDIUM · P11 · origin SCRIPTS-PYTHON-015**
- Every main()-driven test stubs it; a `return True` stub survives (readiness gate gone → rcfile/exec runs
  against a dead server, surfacing as an opencode 502); the `proc.poll()` early-exit could be dropped; a
  non-raising non-200 skips the sleep (busy-loop). The RouterHealthProbe pattern already in the suite applies.
  **Fix:** a real-listener test with a proc-dead leg.

#### ISSUE-109 — The entire download/validate half of fetch_models.py (and all of benchmark.py) has zero test coverage; serve.py depends on the untested half
- **MEDIUM in aggregate · P11 · origin SCRIPTS-PYTHON-016**
- The python gate discovers only `test_conductor_wiring.py`/`test_conductor_bench.py`. serve.py calls
  `installed_models`/`manifest_intact`/`read_manifest` (only ever stubbed) on every run — an inverted size
  comparison in `manifest_intact` empties the model list with no gate moving. Lower-confidence latent defects
  read out: `_download_range` trusts the server honored the Range header (a 200-full-body overwrites completed
  chunks; validates by size under `--no-hash-check`); mmproj files size-checked but never hash-verified while the
  manifest reads `validated:true`; `cmd_verify` and `installed_models` can disagree about health;
  `cmd_serve --models-max/--serve-ctx` pass nothing through. **Fix:** a targeted leg for the functions serve.py
  depends on and the resume/validation state machine.

#### ISSUE-110 — README documents an eviction workflow whose download half does not exist (`download_missing` read by nothing; `fetch_model` no callers); the destructive half IS implemented
- **LOW-MEDIUM (documentation promising an unimplemented workflow whose failure deletes 20-40 GB) · origin SCRIPTS-PYTHON-017**
- `grep download_missing` hits only the config generator's default; `fetch_model()` is dead code; structurally
  `discover_models()` only enumerates installed models. An operator who sets the documented `{download_missing,
  delete_after_each}` pair gets models deleted after each run without the restorative fetch. **Fix:** implement
  the fetch, or delete the knob + dead function + config comment + README section together.

#### ISSUE-111 — A mid-file `unittest.main()` makes direct invocation a silent partial pass: 35 of 47 tests
- **LOW-MEDIUM · P1 · origin SCRIPTS-PYTHON-005 (measured)**
- `if __name__ == "__main__": unittest.main()` sits before the eight `p12-` classes (the C-087 fix coverage), so
  `python3 scripts/test_conductor_wiring.py` runs 35 and prints an unqualified OK. The gate uses `unittest
  discover` (unaffected), but a human iterating with the natural invocation gets a green from a suite blind to the
  recently-fixed area. **Fix:** move the guard to the file's end; optionally assert a minimum count.

### Cluster O — Cross-language / vocabulary drift (P3)

> Reconciliation note: the repo's exemplary drift guard is `composition.test.ts:823`, which reads
> `conductor_wiring.py` source and asserts equality for `DEFAULT_MAX_READERS`. The findings below are the
> restatements that did NOT get that treatment. The single highest-severity vocabulary hole is ISSUE-088
> (stripComments blinding the two source audits) and ISSUE-114 (a pack in ROLE_PACKS but not REQUIRED_PACKS).

#### ISSUE-112 — Bench cell config restates the fan-out and workflow defaults with no drift guard; the cell-config test leaves parallel/workflow unpinned (maxReaders/git.mode)
- **MEDIUM · P3 + P13 · origin SCRIPTS-PYTHON-001 + SCRIPTS-PYTHON-002 (merged; mutation M1: maxReaders→60 AND git.mode→read-only both green)**
- `build_conductor_cell_config` is a third spelling of `maxReaders:6`/`subSessionTimeoutMs:900000` and a
  12-literal restatement of the workflow block, in a file that already imports `conductor_wiring`; the test's
  purity assertion is `cfg == build_conductor_cell_config(task)` (both the subject, P2). If `maxReaders` drifts,
  the 90-run campaign asks for 6 readers against a server sized differently (the serialize-upstream failure the
  composition guard prevents); a `read-only` git.mode would make every run score as a failure. **Fix:** derive
  from `conductor_wiring` constants; assert `git.mode == "commit"`; pin `parallel.*`.

#### ISSUE-113 — bench restates STOP_KINDS and terminal states with a same-language pin while the derivable exported schema sits unused; a new TS stop kind crashes the campaign
- **MEDIUM · P3 cross-language · origin SCRIPTS-PYTHON-008 + SWEEP-VOCABULARY-007 (merged; mutation MUT-4 caught python-side, TS-side widening unguarded)**
- `conductor_bench.py` STOP_KINDS/TERMINAL_RUN_STATES are pinned against a fourth hand copy in the test; a
  seventh stop kind added to `core/types.ts` changes neither python file, and `validate_result` then hard-errors
  the first time a live run ends that way — during the 14.2 campaign. **Fix:** derive python STOP_KINDS from the
  gate-exported `Run.schema.json` (the technique `test_conductor_wiring` already uses for RouterConfig).

#### ISSUE-114 — A doctrine pack listed in ROLE_PACKS but absent from REQUIRED_PACKS is silently never delivered, and no test can see it
- **MAJOR · P3 + silent-skip · origin SWEEP-VOCABULARY-002 (reproduced, MUT-1b)**
- Both maps are module-private (no test can compare them); `buildSystemAppend` silently skips any pack absent
  from the cache. Adding `extra-governance.md` to `ROLE_PACKS.planner` is caught by nothing — in production the
  planner runs with silently-partial doctrine forever. The nine-pack list is restated four ways (REQUIRED_PACKS,
  doctrine.test, inject.test PACK_FILES, verify-acceptance detector B), none derivable. (Currently moot only
  because ISSUE-001 means nothing is delivered at all.) **Fix:** derive REQUIRED_PACKS as
  `union(ROLE_PACKS) ∪ {debug, receive-review}`; export both; fail closed on a missing pack.

#### ISSUE-115 — §2.3 terminality has three hand copies, and the file claiming to be "the ONLY definition" is not
- **MEDIUM · P3 + P4 · origin SWEEP-VOCABULARY-003 (mutations MUT-2/MUT-3 pin each copy but nothing binds them)**
- `stops.ts:65 TERMINAL_STATES` (comment: "the ONLY definition — legalTools calls it"), `gates-phase.ts:113
  TERMINAL_RUN_STATES` (deliberately inlined, so legalTools does NOT call stops' isTerminal — contradicting the
  comment), `conductor_bench.py:83`. A §2.3 change to one copy leaves the gate and the continuation engine
  disagreeing about whether a run is finished — the C-085 wedge's neighborhood. **Fix:** import `isTerminal`, or
  an equality test over the two exported arrays + derive the python copy.

#### ISSUE-116 — FanoutJob.priority is written at every dispatch site, read by nothing, and uniformly contradicts the wire truth
- **MEDIUM · P3 + C-089 shape (a field with no reader) · origin SWEEP-VOCABULARY-004**
- `adapter/fanout.ts:66` declares it; no reader anywhere; every dispatch site fills `"interactive"` while the
  actual §4.4 wire priority comes from `inject.ts ROLE_PRIORITY` (review/batch by role). Recorded intent and wire
  behavior disagree for most dispatches, untested. **Fix:** delete the field, or make `headersFor` consume it.

#### ISSUE-117 — The affinity/schema header names are config on the router side and constants on the sender side
- **MEDIUM · P3 across a language boundary, fail-soft-absorbed · origin SWEEP-VOCABULARY-005**
- RouterConfig owns `affinity.header`/`schema.observeHeader` as data (the C++ router derives them); the TS sender
  hardcodes all four in `inject.ts:239`. §2.2 calls the config "hand-editable" — an operator editing
  `affinity.header` desyncs sender and router, and affinity/observation silently degrade with no error. **Fix:**
  the sender reads the same RouterConfig, or the docs state these keys are not hand-editable; a python-leg parity
  test grepping inject.ts.

#### ISSUE-118 — The python→TS env-var contract is hand-spelled on both sides and drift is absorbed silently
- **MEDIUM · P3 cross-language · origin SWEEP-VOCABULARY-006**
- Writer `conductor_wiring.py:612` sets `LLAMA_HARNESS_MODEL/URL/ROUTER_URL`; reader `plugin/index.ts:138`
  spells them as ENV_* constants; no shared source, no test spans the boundary. A rename doesn't error —
  `originOf` falls back to §2.2 default ports, so setup silently probes the wrong ports. **Fix:** a TS test
  grepping the three `env["…"] =` assignments and asserting name equality (the composition.test:823 technique).

#### ISSUE-119 — The M5 stub-scan patterns and core/planning.ts's placeholder patterns are a confessed one-rule-in-two-places, and the mirror is already partial
- **MEDIUM · P3, self-documented · origin SWEEP-VOCABULARY-008**
- `conductor-gate.sh:63` says "If you change one, change both: this is the one-rule-in-two-places pattern that has
  already drifted six times." No guard exists, and the mirror is already inexact (planning's TODO comment-lead is
  optional where M5's requires one; each carries arms the other lacks). Nothing records which differences are
  intended. **Fix:** extract the shared shapes, or a test diffing both pattern sets against a committed
  intended-divergence list.

#### ISSUE-120 — One-directional compile guards (`satisfies`, derived-key loops) mistaken for two-directional: STOP_KINDS, SCORE_KEYS, AMENDABLE_ITEM_STATES catch extras, never omissions
- **LOW (each), systemic · P3 · origin SWEEP-VOCABULARY-010**
- `stops.ts STOP_KINDS as const satisfies` — a missing member compiles clean; `decide.ts SCORE_KEYS` — a sixth
  DecisionRecord score key silently under-sums every decision; `queue-amend.ts AMENDABLE_ITEM_STATES` plain
  strings — an ITEM_STATES rename silently starts refusing a legal state. **Fix:** a runtime equality test
  against the schema enum (single-source.test's treatment, extended); a length-equality static assert for
  SCORE_KEYS; type the amendable list `readonly ItemState[]`.

#### ISSUE-121 — The seven-role vocabulary has no owner anywhere; typo-absorbing fallbacks
- **LOW today (copies agree) but C-082's home ground, highest restatement count in the repo · P3 · origin SWEEP-VOCABULARY-011**
- inject.ts has three private maps with silent fallbacks (`?? ["core.md"]`, `?? 0.4`, `?? "interactive"`) that
  absorb a key typo; gates-edit READER_ROLES restates four + literal arms (C-082's exact site); ~15 tools.ts
  dispatch literals; every role-typed field is `string`. **Fix:** `export const ROLES = [...] as const`; type the
  inject maps `Record<Role, …>`; type FanoutJob.role/RegistryEntry.role as `Role`.

#### ISSUE-122 — The gate subsets are stringly-typed, so the compiler checks none of the restated state literals in the two files that dispatch on them
- **LOW · P3 enabling the C-082 shape · origin SWEEP-VOCABULARY-012**
- `GateRun.state`/`GateItem.state`/`RunLike.state` are `string`, so `nextStageTool`'s switch, `isSettled`,
  `cannotEverPublish`, `legalTools`' state switch compare `string` to hand-typed literals — a typo'd case arm is
  silently unreachable, caught only if a behavioral test drives that exact arm. **Fix:** `state: RunState`/
  `ItemState` with fixtures using the exported arrays; or an exhaustiveness probe.

#### ISSUE-123 — Nothing structurally binds the 18 tool-name literals gates-phase emits to the 22-name inventory tools.ts owns
- **LOW (pins exist; structural guard absent) · P3 · origin SWEEP-VOCABULARY-013**
- gates-phase restates 18 tool names as local consts, pinned by its own test's third copy; a drift applied to
  gates-phase AND its test is caught only downstream. No test asserts `emitted ⊆ CONDUCTOR_TOOL_NAMES` (~5
  lines). **Fix:** that subset assertion (also closes ISSUE-122 mechanically).

#### ISSUE-124 — The closed journal vocabulary is not enforced in production at all
- **LOW (vocab lens; pointed to enforcement) · origin SWEEP-VOCABULARY-014**
- `journal.ts:168 isProd = NODE_ENV === "production"` makes the unlisted-event THROW dev/test-only; in production
  an unlisted name is accepted, so §7.4's "caught at its source" holds only where NODE_ENV is unset, and the
  static audit (holed by ISSUE-088) is the sole guard. Nothing sets NODE_ENV=production today; the risk activates
  when someone "hardens" the deployment. **Fix:** weigh whether prod should refuse or the audit should be the
  authority.

#### ISSUE-125 — "Which failure classes are a legal red" is spelled three times
- **LOW · P3 on a RULE · origin SWEEP-VOCABULARY-015**
- `fsm-item.ts:85`, `evidence.ts:421`, `tools.ts:3474` each spell the assertion/missing-subject disjunction; plus
  `fsm-item.ts:28` restates the FailureClass union. **Fix:** `export function isLegalRedClass(fc)` in core, three
  call sites.

#### ISSUE-126 — serve.py restates the router-config filename that conductor_wiring owns
- **LOW · P3 · origin SCRIPTS-PYTHON-018**
- serve.py spells `fm.CONFIGS_DIR / "conductor-router.json"`; the owner is
  `conductor_wiring.ROUTER_CONFIG_RELPATH`. Rename either and serve writes/reports one file while bench reads
  another, all tests green (the launch leg is untested, ISSUE-106). **Fix:** derive from `cw.ROUTER_CONFIG_RELPATH`.

#### ISSUE-127 — merge_router_config treats `metrics.ledgerPath` as machine-owned while two comments describe it as hand-editable
- **LOW (operator surprise) · P3 · origin SCRIPTS-PYTHON-019**
- `ROUTER_MACHINE_KEYS` includes `ledgerPath` (clobbered on every non-`--fresh` run, pinned by a test), while
  two supervisor comments are written to make hand-editing it safe. **Fix:** drop it from the machine keys, or
  fix the two comments.

### Cluster P — adapter-remainder / worktrees / questions / replay

#### ISSUE-128 — Both refusal arms in questions.ts are decorative: the QuestionRecord validator AND the Item validator can be deleted and the full gate stays green
- **MEDIUM · P5 · origin ADAPTER-REMAINDER-TOOLS-001 (mutations Q-1/Q-2 both full-gate PASS)**
- `assertValidQuestion` and the `validate("Item")` refusal in `answerQuestion` are never fed input they must
  refuse; the module header sells them as its contract. Six handler sites reach `appendQuestion` with
  model-influenced input (`origin`, `blocksItems`), and this is the only line refusing a corrupt ledger line.
  **Fix:** an out-of-vocabulary-`origin` refusal test and a corrupt-item.json refusal test.

#### ISSUE-129 — `removeWorktree` silently no-ops on a locked worktree: the admin entry AND branch survive, no error, no signal
- **MEDIUM-LOW · P4 + silent-failure · origin ADAPTER-REMAINDER-TOOLS-002 (reproduced)**
- `remove --force` fails on a locked worktree (git wants `--force --force`); the fallback `prune` prunes nothing
  (the dir exists); `branch -D` fails (checked out) and `tryGit` swallows it. `git worktree add` locks during
  populate, so a crash inside `createWorktree` leaves exactly this state. The Task-10.1 janitor believes cleanup
  happened; worktrees accumulate silently. **Fix:** re-derive `isRegisteredWorktree` after prune; throw naming
  the lock or retry with `--force --force`.

#### ISSUE-130 — createWorktree's foreign-branch refusal is decorative: deleting it leaves the full gate green
- **LOW-MEDIUM · P5/P12 · origin ADAPTER-REMAINDER-TOOLS-003 (mutation W-1 full-gate PASS)**
- The reuse-happy side is pinned; the refusal side (a foreign branch at the path is REFUSED rather than adopted)
  is proven by nothing. A crashed-and-rewired worktree would be adopted silently and every stage up to
  merge-back would run against the wrong branch (mergeBack's own identity check backstops the worst outcome, but
  only after the item's edits/tests/verify ran in the wrong tree). **Fix:** one refusal test.

#### ISSUE-131 — replay.ts restates nine journal event/component literals and every producer data-key spelling with no drift guard, while its guard-test title claims it "reuses the core vocabulary rather than restating"
- **LOW-MEDIUM (observability tool; failure mode is silently empty sections) · P3 + P13 · origin ADAPTER-REMAINDER-TOOLS-007**
- A coordinated rename (EVENTS + producers + their tests) passes everything because no test pins EVENTS to the
  §7.4 text and replay's fixtures hand-write the same strings; the data keys (`survivingMajors`, `stage`,
  `round`) have no vocabulary at all — renaming one makes deriveReviewRounds return `[]` and the REVIEW ROUNDS
  section render `(none)`, a silently-lying timeline for the §7.3 audience. `[15.0-builtins-only]` asserts only
  that two import specifiers exist. `ARCHIVE_PATTERN`/`ACTIVE_JOURNAL` restate journal.ts's rotation naming.
  **Fix:** export the event names from journal-events.ts and import them; a fixture produced by running the
  committed producer; retitle/extend the guard test.


### Cluster Q — Test-quality, row-naming, reachability, meta-robustness

#### ISSUE-132 — task-13.1 42-row audit: 20 of 42 rows are untraceable by id, and 4 load-bearing "the handler measured it" properties are still e2e-invisible
- **MINOR as a defect (coverage is materially better than the recorded floor) / MAJOR as ledger-navigability · P13 · origin SWEEP-ROWS-AND-TESTS-006 (e2e read in full)**
- 22 rows are title-named (12 honestly `// NOT proven here`), 16 are proven-but-unnamed (their proofs can't be
  found from the ledger because no test title carries their id), and the four known "proven by nothing" rows now
  all have real unit-level guards (two broken and confirmed red) — but at the e2e level MUT-1 (mark_green ignores
  exit code, e2e 35/35 green) shows the four are still invisible. `13.1-canned-outputs-pass-real-schemas` is
  UNPROVEN as written (its "first CLASSIFICATION reply is malformed, the validator rejects it" mechanism exists
  nowhere in e2e — every canned reply is well-formed). **Fix:** split scenarios 2–5 into per-row `it()`s (the
  pattern and rationale are written at e2e.test.ts:1330); add the malformed-first-reply leg; cross-reference the
  four rows' coveredByTest.

#### ISSUE-133 — Coverage-ledger linkage is unreliable: `5.3-direct-drive`'s coverage claim is false, 19 rows are linked only by prose comments, and tests carry orphan ids with no ledger row
- **MINOR · P13/P3-lite · origin SWEEP-ROWS-AND-TESTS-001 + SWEEP-ROWS-AND-TESTS-007 (merged)**
- `5.3-direct-drive` claims "names carry 5.3-direct-drive" but the id appears in no test; 19 rows (0.3, 1.1,
  6.1) are mapped only by header comments no tool checks, some under a different id than the test title; and
  `5.3-edit-deny`/`5.3-fail-open` are ids in tests with no ledger row. Every mapping verified honest by reading;
  the defect is that the links are uncheckable and drift-prone. **Fix:** a mechanical row-id→test-title checker
  in the gate (IDEA-ROW-1), or put mapped titles in `coveredByTest`.

#### ISSUE-134 — The full parallel test gate is nondeterministically red on an unmutated HEAD tree, and the failing assertions are enforcement-load-bearing (proposed new class P14 — "enforcement that holds only when the machine is idle")
- **MAJOR (cross-cutting; it pollutes every mutation verdict in this whole review) · P14 · origin COMPOSITION-INJECTION-012 (reproduced on the byte-identical HEAD tree)**
- Sequential full runs on the restored HEAD tree produced fail=1 (`[C032-D2-stale-red]` — the item ADVANCED a
  passing test on a stale red), fail=6 (`[13.1-non-behavioral]` + five `9.2-decompose-*`), and fail=1
  (`[9.4b-fix-amend-validates-record-before-persist]` — a schema refusal not thrown). Scoped runs are stable.
  Two of the three shapes show the PRODUCT enforcing differently under parallel load, not test timing. The
  committed gate itself is the flaky artifact, so every recorded "GATE PASS" and every "mutation goes red"
  verdict is a sample from a distribution. Independently, sweep-vocabulary and sweep-rows-and-tests both hit
  spurious e2e failures under concurrent-agent load, and the gate-mutation sweep saw the node count drift 1382 vs
  1386. Likely cause: same-millisecond `Date.now()`/mtime collisions in freshness/stale-red comparisons. **Fix:**
  loop the failing tests under artificial parallel load and read which comparison flips; pass `--test-timeout`
  and consider `--concurrency=1` for the enforcement suites, or inject a monotonic clock.

#### ISSUE-135 — The doctrine anchor tests pin keywords, not claims: a pack asserting the OPPOSITE of its doctrine stays green
- **MINOR · P13-lite · origin COMPOSITION-INJECTION-013 (reproduced, MUT-14)**
- Inverting core.md's "Exhaustion stops the run" → "continues" leaves doctrine.test.ts 15/15 green; the anchors
  are `has(core, "exhaustion")` (keyword presence, which a negated sentence satisfies). These anchors are the
  only drift guard the doctrine has (and, per ISSUE-001, the packs govern nothing). **Fix:** anchor on the full
  normative sentences including polarity.

#### ISSUE-136 — The chat.message part-type filter is unpinned: including non-text parts in the prompt breaks nothing in the suite
- **MINOR · P11 · origin COMPOSITION-INJECTION-014 (reproduced, MUT-12)**
- Replacing the `part.type === "text"` selection with push-everything leaves composition/composition-root/
  gate-wiring green; a file-attachment or agent-marker part would silently join run.json's recorded §2.3 prompt.
  **Fix:** one test handing the hook a mixed-part message and asserting run.json's prompt is the text parts alone.

#### ISSUE-137 — Nothing pins that `tool.execute.before` fires for plugin-registered tools, and the registry rule for `conductor_*` rests on exactly that
- **MINOR (evidence gap) · P1 · origin COMPOSITION-INJECTION-010**
- The wire-contract deny test asserts the before-hook fired for `bash`; the custom-tool test asserts registration
  + execution of `conductor_probe` but never a `tool.execute.before` record for it. If 1.18.15 skipped the hook
  for plugin tools, every `conductor_*` call would bypass `decideSession` silently. **Fix:** one assertion in the
  existing custom-tool scenario.

#### ISSUE-138 — The §3.8 conductor banner exists in OPERATIONS.md and nowhere else: the operator's "first rule" tests for a signal nothing emits
- **MINOR (consequence of ISSUE-001) · P9-adjacent · origin COMPOSITION-INJECTION-008**
- OPERATIONS.md's "First rule: no banner, no conductor" and its troubleshooting head test for a one-line banner
  that could only reach the model via the (unwired) §6.4 injection or doctrine (core.md has no banner
  instruction). Every session, healthy or broken, has no banner, so an operator following the doc concludes the
  plugin never loads. **Fix:** wire ISSUE-001 and put the banner in the state block/core.md, or rewrite the
  first rule around the beacon.

#### ISSUE-139 … ISSUE-142 — minted post-merge by step 4 (stubs; added by the step-5 preflight pass, 2026-08-16)

Step 4 (findings-capability §4) recovered this register's §12.2 DROPPED findings and one macro pointer as
four new ISSUEs. Their full records live outside this section; these stubs keep the `ISSUE-` ID space
traceable from the register that owns it.

- **ISSUE-139** — `fetchMetricsSummary` returns an unvalidated cast: any JSON object (or `[]`) becomes a
  `MetricsSummary`. MINOR today, **MAJOR the moment ISSUE-038 wires it into the report**. Full record:
  §12.2 row 1 (origin FANOUT-CONCURRENCY-004). The §6 mutation row "delete metrics-body-object guard →
  DECORATIVE" is this finding's evidence, not ISSUE-040's.
- **ISSUE-140** — `verify-acceptance.sh` still uses fixed `/tmp/accept-*.out` scratch paths — the C-078
  concurrency class recurring in the build's outermost check. Full record: §12.2 row 2 (origin
  SWEEP-CORRECTIONS-009 / SCRIPTS-PYTHON-013).
- **ISSUE-141** — two weak acceptance detectors: row 2's `SKIPPED_UNMET` fallback matches any task's skip
  record; row 5's scenario check is `grep -qi` substring-anywhere. Full record: §12.2 row 3 (origin
  SCRIPTS-PYTHON-014).
- **ISSUE-142** — `sameTree` in plugin/index.ts:829 is an unguarded cross-layer restatement of
  gates-edit.ts:196-198, coupled by comment only (P3, MINOR; closed by GAP-002's `deriveGateFacts`).
  Origin: a step-3 pointer, findings-macro §6; promoted by step 4.

(The fourth §12.2 row, SWEEP-GATE-MUTATION-010, was folded into ISSUE-134 as a facet rather than minted.)

---

## 3. The IDEA register

Merged and deduped across all parts; the low bar is deliberate. Grouped by kind.

**Structural / capability upgrades (highest leverage):**
- **IDEA-STRUCT-1** — A structural single-writer: an OS advisory lock (`flock`/`O_EXCL` held for the process
  lifetime) instead of a read-reason-rewrite pid file, making ISSUE-023/024/025/028 impossible by construction.
  [state-crash CAPABILITY pointer]
- **IDEA-STRUCT-2** — Run write-capable sub-sessions inside a filesystem sandbox/overlay confined to the tree,
  making out-of-scope writes impossible instead of detected (closes the whole advisory-gate class:
  ISSUE-014/018/017/016). [gates-security CAPABILITY pointer]
- **IDEA-STRUCT-3** — Replace "detection by enumerating prefixes/tools" (`GIT_WRAPPERS`, `WRITE_TOOLS`,
  `BRANCH_MUTATING`, the write-shape command set) with a fail-safe attribution posture. [gates-security IDEA-001]
- **IDEA-STRUCT-4** — Require each review lens to emit proof it read the diff (a cited range / handler nonce), so
  a no-op reviewer is detectable; flip the skeptic default to "uncertain ⇒ uphold". [sweep-adversary IDEA-1/2]
- **IDEA-STRUCT-5** — A single `run.stop` closer that computes the kind from the settled dispositions, making the
  §2.9 vocabulary exhaustive-by-construction; plus a resumable-after-stop path. [composition IDEA-COMP-1/3]
- **IDEA-STRUCT-6** — A generic "vocabulary registry + parity harness" so the next cross-language vocabulary is
  safe by default rather than by artisanal test-writing (the repo's strongest guards are all hand-built).
  [sweep-vocabulary CAPABILITY pointer]
- **IDEA-STRUCT-7** — A `revert-probe` runner: each task carries a machine-applicable patch + expected failing
  test ids, re-run on demand, so `revertAssertion` proof claims become durable (ISSUE-090 proved one rotted).
  [sweep-gate-mutation CAPABILITY pointer]
- **IDEA-STRUCT-8** — A "live-artifact checker ships before the artifact" mechanism (as G5 got one) for
  SMOKE.md/conductor-report.md, plus binding live artifacts to run ledgers (runId + evidence seq that
  re-validate). [sweep-honesty / sweep-gate-mutation]

**Tooling / test-maintainability:**
- **IDEA-ROW-1** — A mechanical row-id→test-title checker in the gate (would have caught ISSUE-075/076/132/133).
  [sweep-rows IDEA-001]
- **IDEA-ROW-2** — A `disposition` field on assertion rows (met / superseded-by / waived / covered-elsewhere) so
  a fix task that narrows scope must write it. [sweep-rows IDEA-002]
- **IDEA-GATE-1** — Pass `--test-timeout` (ISSUE-032) and a small `subSessionTimeoutMs` in test config so leaked
  timers can't stall the runner; on gate failure copy the leg scratch dir somewhere durable before the trap fires.
  [fanout IDEA-FC-1, sweep-gate-mutation IDEA-005]
- **IDEA-GATE-2** — Make M5 scan `scripts/*.sh` (the four enforcement shell scripts are outside every scanner);
  widen `PAT_TRIV` past three literal spellings; make `git ls-files` floors count the worktree not the index.
  [sweep-corrections IDEA-002, sweep-gate-mutation IDEA-001/002]
- **IDEA-GATE-3** — A string-aware `stripComments` hoisted into one shared helper + a sentinel assertion
  (ISSUE-088). [sweep-vocabulary IDEA-004]
- **IDEA-JSONL-1** — One shared `readJsonlTolerant` that heals torn lines for ALL ledgers (questions.jsonl is the
  only per-line-parsed reader that still throws; ISSUE-101). [sweep-corrections IDEA-003]
- **IDEA-DEDUP-1** — Centralize the five `Math.floor` knob reads into one `readKnob` accessor (ISSUE-102).
  [tools-handlers-a IDEA-A-04]
- **IDEA-MANIFEST-1** — A `docs/build/artifacts/MANIFEST.json` (path, generator, generating commit, sha256) so a
  reviewer can distinguish regenerated from hand-edited in one command. [sweep-honesty IDEA-001]
- **IDEA-PROC-1** — Record refutations with evidence symmetrically with upholds; an "owed items" ledger with
  owners distinct from the 4,610-line CORRECTIONS.md prose (recorded-debt-never-scheduled is the dominant
  meta-pattern). [sweep-corrections IDEA-005/006]
- **IDEA-PROC-2** — The stray-process check needs an ownership signal (`pgrep -g`/session id): two reviewers
  following the briefing's `ps | grep` killed each other's test children. [sweep-honesty IDEA-002]
- **IDEA-PROC-3** — End every mutation-running session with a `git status --porcelain` sweep (a cp+cmp restore
  printed "restored" yet a mutation was later found live in the tree). [sweep-corrections IDEA-007]

**Observability / ergonomics / docs:**
- **IDEA-OBS-1** — Stamp `doctrineLoaded` (or a pack digest) into the §3.8 beacon (ISSUE-004). [composition-injection]
- **IDEA-OBS-2** — Surface the intended stop kind and each live sub-session's `tree` in `conductor_status`/replay
  (the slug/path split, ISSUE-002, would have been visible on first live contact). [composition IDEA-COMP-3,
  composition-injection IDEA-006]
- **IDEA-OBS-3** — Report should render answered questions (ISSUE-051); callout empty-staged/zero-file publishes
  (ISSUE-060). [tools-handlers-b IDEA-B-03/B-06]
- **IDEA-ERG-1** — serve.py: refuse (don't shift) an explicit busy `--port`; verify port identity via `/health`;
  notice a non-executable `$LLAMA_ROUTER`; the readiness-fallback notice should name router.log.
  [scripts-python IDEA-SP-01..04]
- **IDEA-DOC-1** — Mandatory §8-style "what I'm least confident about, worst first" epistemic-status sections in
  gate/closeout records (COMPLETION-REPORT §8 pre-empted two honesty findings). [sweep-honesty IDEA-005]
- **IDEA-MISC** — Prune/cap the unbounded `ContinuationState.adjudicated` set and dead `pendingConversions`
  (fanout IDEA-FC-2); reservoir-bound the C++ MetricsLedger waits (cpp IDEA-CPP-02); bind the router's
  no-re-encoding relay with one Accept-Encoding header assertion (cpp IDEA-CPP-01); `decompose.md` should tell
  the planner scopes must be disjoint (tools-a IDEA-A-03); watch-agents.sh is pinned to one dead session id
  (scripts IDEA-SP-09); README calls `.data/` the only gitignored dir (`.out/` is too, IDEA-SP-13).

> **Note (raised by tools-handlers-b IDEA-B-07):** the step-2 charter's "structured per briefing §10 conventions"
> references a §10 the briefing does not have (it ends at §8) — a P3 inside the review machinery's own documents.
> This merge used the state-crash reviewer's field list.

---

## 4. CROSS-LENS POINTERS

**To the MACRO review (step 3 — shape, organization, design coherence):**
- **The stop-vocabulary is over-specified for the recorders that exist** — §2.9 defines 6 kinds; the composed
  system can write 4 (ISSUE-065). Whether `blocked`/`surfaced` should be separate kinds or the closer should learn
  to write them is a design-coherence question. [composition]
- **The enforcement locus is diffuse** — no single choke point asks "is this tool legal now?"; a `requireMetaTool`
  in `runTool` is a structural simplification (ISSUE-005). [composition, tools-handlers]
- **"Detection by enumeration" is a recurring shape** — `GIT_WRAPPERS`, `WRITE_TOOLS`, `SHELLS`, `BRANCH_MUTATING`,
  the role/pack/priority maps; the macro review should weigh a fail-safe posture vs N hand-lists. [gates-security,
  sweep-vocabulary]
- **`conductor/adapter/tools.ts` is 9,253 lines carrying ~15 handlers [macro M.5 re-measured: 22] + setup + HTTP plumbing**; several seam
  defects are invisible partly because the three files involved are far apart. Navigability for a 32k model.
  [tools-handlers-a/b, composition]
- **`continuation.ts` (1,382 lines) carries three separable engines**; `inject.ts` is a fully-built, fully-tested
  module with zero production callers (dead-subsystem cost, ISSUE-001). [fanout, composition-injection]
- **The build maintains five status surfaces with no freshness contract** (ISSUE-082); GATES.json phase records
  are shape-inconsistent per phase; the assertion-ledger convention silently changed three times over the build.
  [sweep-honesty, sweep-rows]
- **scripts/ mixes two products** (the conductor harness vs the pre-existing model-benchmark tooling) under one
  test gate covering only the former; `conductor/tools/` sits outside every hygiene guard; the M5 scan covers no
  `*.sh`. [scripts-python, adapter-remainder]
- **types.ts's interface + hand-written-JSON-schema duality** is a plan-mandated two-spellings pattern (every §2
  schema exists twice); whether one side should be generated is a shape question. [sweep-vocabulary]
- **UPSTREAM_CONTRACT.md doubles as a findings ledger** (F1/F3/F4 wiring decisions live in a router contract file);
  the top-level CMake project is still named `myprogram` while DECISIONS.md documents its removal. [cpp-router,
  sweep-rows]
- **The gate's own availability failure mode** (no timeout, ISSUE-032; nondeterministic red, ISSUE-134) is a
  gate-regime design point, not just a bug. [fanout, composition-injection]

**To the CAPABILITY review (step 4 — missing mechanisms that raise the floor):**
- Every IDEA-STRUCT-* above is capability input, grounded in a specific reproduced failure.
- **The single highest-leverage mechanism for a lazy 32k model — the live state block with the recommended next
  tool — reaches nobody** (ISSUE-001); per-role doctrine and temperatures likewise. [composition-injection]
- **The honest "waiting on a human" disposition is a missing mechanism** — for an unattended run the difference
  between "done", "waiting on you", and "wedged" is the most load-bearing operator signal, collapsed onto
  `done`/`noop` (ISSUE-065/066). [composition]
- **The incentive gradient runs backwards** — the defer-escape gets a clean `done`, honest waiting gets `noop`
  with work lost; doctrine-efficacy analysis must account for the harness structurally rewarding the lazy exit.
  [composition, sweep-adversary]
- **No mechanism converts "the idle engine threw on every pass for an hour" or "the transport hangs" into an
  operator-visible artifact** (ISSUE-033/034); the journal is the only trace and nothing watches it. [fanout]
- **No size measure exists for glob-scoped items** anywhere in the pipeline (ISSUE-012); a refutation-evidence
  field in the skeptic-panel schema (ISSUE-079). [sweep-corrections]

**Within enforcement (noted for the register's own cross-references):**
- ISSUE-005 unifies A-001 + B-001 + COMPOSITION-004 — treat as one hole with one fix.
- ISSUE-028 chains ISSUE-023/024/025/026/027 — the cheap defense-in-depth (itemId/tree check) closes the
  composition even before single-writer lands.
- The `noop`-wedge (ISSUE-055/066; ISSUE-050; the idle-engine liveness holes ISSUE-033/034) is the common
  terminal sink for several separate defects; ISSUE-065 is the shared root.


---

## 5. The enforcement table (Part A) — where the harness knows vs. believes

At every point where a model reports something, does the harness re-derive it or accept it? Merged from the
tools-handlers-b enforcement table and the other parts. **RE-DERIVED / PARTIALLY / ACCEPTED-ON-TRUST.**

| # | Claimed | Claimant | What the harness does | Verdict | What a lying model gets away with | Issue |
|---|---|---|---|---|---|---|
| E1 | test went RED | model (submit_test) | `evidence.runTest` runs it; redAdmission refuses fallback/zero-test/off-scope | RE-DERIVED | legal-red *content* is vacuous under `**` fileScope | ISSUE-011 |
| E2 | test went GREEN | model (mark_green) | handler re-runs the on-disk test, reads real exit | **PARTIALLY** | rewrite the vetted test (fileScope∩testScope); a zero-test/fallback green | ISSUE-008, -010 |
| E3 | the full verify is GREEN | — (validate) | handler runs verify itself, quarantined, HEAD/start-stamped, vacuity double-guarded | RE-DERIVED | — (cleared) | — |
| E4 | classification | model (classifier) | two sub-sessions dispatched; skeptic; disagreement normalized | RE-DERIVED (dispatch) but **no legality/re-entry gate** | re-classify to reset state / shop for "question" | ISSUE-005 |
| E5 | a decision was derived | model (decide) | requireTwoOptions + human-territory refusal; binding forces `kind:"derived"` | PARTIALLY (shape enforced, scores are fiction) | mark a 0-option decision `human` (ISSUE-069) | ISSUE-069 |
| E6 | the plan was revised | model (plan_review) | survival ⌈k/2⌉ + lens-coverage floor re-derived | RE-DERIVED | — (cleared) | — |
| E7 | a finding was refuted | skeptic panels | positional panels + core findingSurvives; missing seats = uphold | **PARTIALLY** | id collision drops an upheld finding | ISSUE-049 |
| E8 | the review found nothing | reviewer sub-sessions | empty findings = approval; no diligence floor; lens attribution self-declared | **ACCEPTED-ON-TRUST (by design)** | lazy `[]` advances every item | ISSUE-072 |
| E9 | the fix was implemented | fixer receipt | receipt accepted; deferred to next round's lenses + re-validate | PARTIALLY | a DONE that did nothing survives if next round misses it | ISSUE-072 |
| E10 | item may publish | — | HEAD equality + mtime freshness re-derived; auto re-verify on stale | **PARTIALLY** | a deletion-only post-validate edit ships unverified | ISSUE-046 |
| E11 | the commit contains the item's work | — | pathspec-confined commit, startDirty subtraction, denylist re-check | RE-DERIVED | zero-file publish "succeeds" silently | ISSUE-060 |
| E12 | the run is finished (report) | model (report) | settledForReport re-derived; closing verify re-run | **PARTIALLY** | defer-all → REPORTED/done from DECOMPOSED; done on RED verify | ISSUE-005, -052, -053 |
| E13 | a stage was skipped legitimately | recorded stop | stop-report selects from persisted run.stop | RE-DERIVED | — | — |
| E14 | the human answered Q | model (answer) | any string clears the block; answered questions vanish from report | **ACCEPTED-ON-TRUST** | full human-in-the-loop simulation, invisible | ISSUE-051 |
| E15 | this deferral is a human disposition | model (defer) | records `kind:"human"` unconditionally | **MISATTRIBUTED** | model deferrals wear human authority | ISSUE-052 |
| E16 | I need this gate overridden | model (override) | budget re-derived from both meters; refusal atomic; exhaustion = env stop | RE-DERIVED (budget) / **BROKEN (spend)** | a free-string gate burns budget; can pierce freeze via "edit" grant | ISSUE-007 |
| E17 | setup's answers are the human's | model relaying chat | mechanical checks on shape only; `[]` behavioralPaths accepted | **ACCEPTED-ON-TRUST** | TDD off repo-wide in one call | ISSUE-048 |
| E18 | setup's environment claims hold | — | live proofs re-derived against the running origin | RE-DERIVED | — (cleared) | — |
| E19 | doctrine reached the sub-session | design | **nothing** — no injection hook is registered | **ACCEPTED-ON-TRUST (unwired)** | any role runs with no doctrine, no state block | ISSUE-001 |
| E20 | a conductor_* call is legal now (meta tools) | — | no meta tool routes through legalTools | **ACCEPTED-ON-TRUST** | classify/defer/report/inline_claim at any position | ISSUE-005 |
| E21 | this caller may call this tool (sub-session) | registry gate | allows any registered session any non-spawn call | **ACCEPTED-ON-TRUST** | an implementer answers its own question / defers its item | ISSUE-006 |
| E22 | a sub-session's write is in scope (main mode) | gate snapshot | derives tree = slug "main"; gate denies all | RE-DERIVED but **fail-CLOSED to a total lockout** | (operability: no work can happen) | ISSUE-002 |
| E23 | the router metrics in the report | router | never composed into report deps | **ACCEPTED-ON-TRUST (absent)** | report can't carry or mark-partial router metrics | ISSUE-038, -039 |
| E24 | every number the router reports | — (router) | derived from traffic it relayed itself | RE-DERIVED | — (cleared; the router's enforcement findings are all build-record) | — |

**The charter's central question, answered:** *If a competent-but-lazy local model ran inside this harness today,
at which specific points could it produce plausible-looking but unverified work the harness would accept as real?*
The spine holds where it re-derives mechanical facts (E1/E3/E6/E11/E13/E18/E24) — a model cannot narrate a green
it did not earn, forge an evidence record, or spend override around an FSM gate. It fails at **E2** (weaken/skip
the test — ISSUE-008/009/010/011), **E8/E9/E19** (review is accept-on-trust and doctrine never arrives), **E12/E14/
E15/E17** (close a run `done` from the wrong state, simulate the human, forge human provenance, kill TDD in one
call), and **E20/E21** (no phase gate on meta tools; any registered session calls anything). And separately, **E22**
means that in the default config the harness cannot do work at all with a real model.

---

## 6. The mutation table (Part B, merged)

Every source mutation applied across the seventeen parts, restored + `cmp`-verified unless noted. **BINDS** = a
well-aimed assertion caught it; **SURVIVES/DOES-NOT-BIND** = decorative or a hole (→ issue). Verdicts marked
`*` were run under the nondeterministic-gate caveat (ISSUE-134) — scoped runs used where possible.

| Mutation | File | Expected | Result | Verdict | Issue |
|---|---|---|---|---|---|
| exit-0 accepted as red | fsm-item.ts | red | 1 fail | BINDS | — |
| tie-upholds threshold `>=`→`>` | verdict.ts | red | 5 fail | BINDS | — |
| disable HEAD freshness term | freshness.ts | red | 1 fail | BINDS | — |
| default-deny → ALLOW | gates-git.ts | red | 5 fail | BINDS | — |
| remove `"apply"` from DESTRUCTIVE | gates-git.ts | red | **GREEN** (default-deny still denies) | list is decorative for the decision | IDEA (assert reason) |
| add `"apply"` to READ_ONLY_SIMPLE | gates-git.ts | red | 3 fail | BINDS | — |
| REDIRECT_TO_FILE = /ZZZNEVER/ | gates-edit.ts | red | 7 fail | BINDS | — |
| out-of-tree → return absPath (re-C-055) | gates-edit.ts | red | 1 fail | BINDS | — |
| disable per-tree verify FREEZE | gates-edit.ts | red | 1 fail | BINDS | — |
| settledForReport always allSettled | gates-phase.ts | red | 1 fail | BINDS | — |
| add bogus RUN_STATE | fsm-run.ts | red | 1 fail | BINDS (drift guard) | — |
| decideEdit implementer edits vetted test in fileScope | gates-edit.ts (direct) | deny | **ALLOW** | HOLE | ISSUE-008 |
| validateQueue accepts fileScope∩testScope | planning.ts (direct) | reject | **ok:true** | HOLE | ISSUE-008 |
| firstIntersectingGlob(["config.ts"],["**"]) | planning.ts (direct) | hit | **null** | HOLE | ISSUE-009 |
| validateQueue behavioral:false root file under `**` | planning.ts (direct) | reject | **ok:true** | HOLE | ISSUE-009 |
| mark_green admits testExit:0 regardless | tools.ts | red | 1 fail | BINDS | — |
| mark_green ignores zero-test/fallback facts | tools.ts (analysis) | — | admitted | HOLE | ISSUE-010 |
| classify on advanced run (scratch repro) | tools.ts | refuse | **accepted, state clobbered** | HOLE | ISSUE-005 |
| defer-all at DECOMPOSED → report (repro R1) | tools.ts | refuse | **REPORTED/done** | HOLE | ISSUE-005 |
| inline_claim/queue_amend on terminal run (R2) | tools.ts | refuse | **granted / item added** | HOLE | ISSUE-005 |
| override {gate:"phase-order"} then denied edit (R3) | tools.ts | convert/refuse | **budget burned, run killed** | HOLE | ISSUE-007 |
| item_review two "F1" findings (R4) | tools.ts | fix dispatched | **upheld finding dropped** | HOLE | ISSUE-049 |
| hasStagedDeletion false→true | tools.ts | some red | **GREEN** (unenforced+untested) | HOLE | ISSUE-046 |
| 9.5b CHECK_FORMATTER standalone (M1) | fixture | clean→exit0 | **exit1 for every input** | vacuous | ISSUE-047 |
| assertDecisionValid → no-op | tools.ts | red | **0 fail** | DECORATIVE | ISSUE-064 |
| fanout `inFlight < maxReaders` → `<=` | fanout.ts | red | red + 15min stall | BINDS (with stall) | ISSUE-032 |
| arm watchdog only after create | fanout.ts | red | **suite deadlocks forever** | CAUGHT-BY-HANG | ISSUE-032 |
| delete late-create abort | fanout.ts | uncaught | **FULL gate PASS** | SURVIVES | ISSUE-035 |
| delete metrics-body-object guard | router-client.ts | red | **FULL gate PASS** | DECORATIVE | ISSUE-139 (mis-cited as ISSUE-040 by the predecessor; see §12.2) |
| decideEdit `/repo/src/**` literal vs claim `src/**` | gates-edit.ts (probe) | deny | **allow** | DEFECT | ISSUE-037 |
| plugin main-tree dispatch + real gate (E2E-1) | scratch | allow | **DENY both** | reproduced | ISSUE-002 |
| gateScopesFor → `{**,**}` | plugin/index.ts | red | 2 fail | BINDS | — |
| freezeTreeFor → null | plugin/index.ts | red | 1 fail | BINDS | — |
| ignore LLAMA_HARNESS_DOCTRINE_DIR | plugin/index.ts | red | 1 fail | BINDS | — |
| ensurePacks → {} | plugin/index.ts | red | 2 fail | BINDS | — |
| requireDeclaredArgs → return | plugin/index.ts | red | **all green** | SURVIVES (re-enforced downstream) | IDEA-001(comp-inj) |
| chat.message part-filter → push-all | plugin/index.ts | red | **all green** | SURVIVES | ISSUE-136 |
| core.md heading "stops"→"continues" | doctrine/core.md | red | **15/15 green** | SURVIVES (keyword anchors) | ISSUE-135 |
| add extra-governance.md to ROLE_PACKS | inject.ts | red | **green everywhere** | SURVIVES | ISSUE-114 |
| remove "config.updated" from EVENTS.state | journal-events.ts | audit red | **7/7 green** | SURVIVES (stripComments blanked the site) | ISSUE-088 |
| new dynamic `.log` at tools.ts tail | tools.ts | audit red | **7/7 green** | SURVIVES | ISSUE-088 |
| drop "ANSWERED" from stops / gates-phase | stops.ts / gates-phase.ts | red | red each (no cross-copy guard) | BINDS per-copy | ISSUE-115 |
| drop "env" from python STOP_KINDS | conductor_bench.py | red | red (TS-side widening unguarded) | BINDS one-way | ISSUE-113 |
| maxReaders→60 AND git.mode→read-only | conductor_bench.py | red | **33/33 OK** | SURVIVES | ISSUE-112 |
| swap router_port/port in serve.main | serve.py | red | **80 tests OK** | SURVIVES | ISSUE-106 |
| delete stop_router_supervisor fallback | serve.py | red | **80 tests OK** | SURVIVES | ISSUE-106 |
| build_cell_env spawn opencode | conductor_bench.py | spawn | **[Errno 2] no PATH** | live blocker | ISSUE-107 |
| mv tsconfig.json aside | test-conductor.sh | red/warn | **GATE PASS silent** | SURVIVES | ISSUE-089 |
| mv bun-smoke.test.ts aside | test-conductor.sh | red/warn | **GATE PASS silent** | SURVIVES | ISSUE-089 |
| multi-line empty catch | conductor-gate.sh | M5 red | **M5 PASS** | SURVIVES | ISSUE-092 |
| M5 explicit list of nonexistent files | conductor-gate.sh | FAIL | **M5 PASS (2 scanned)** | SURVIVES | ISSUE-092 |
| ctest on zero-test project | (scratch cmake) | nonzero | **exit 0** | vacuous-green | ISSUE-097 |
| derive_slots → constant 1 | conductor_wiring.py | row-10 red | **PASS row 10** | SURVIVES | ISSUE-094 |
| stamp line → prose mention | UPSTREAM_CONTRACT.md | detector F red | **PASS** | SURVIVES | ISSUE-095 |
| shell-string exec() in adapter | gitio.ts | purity red | **4/4 pass** | SURVIVES | ISSUE-096 |
| drop burst priority==eligible guard (11.5 record) | affinity.hpp | ctest red | **100% pass** | RECORD WRONG | ISSUE-090 |
| fabricated 26-line SMOKE.md | conductor/SMOKE.md | (probe) | **PASS row 6** | fabricable | ISSUE-093 |
| G5 arms byte-identical | 12.1-g5 artifact | red | red | BINDS | — |
| G5 both metric blocks → same invented nums | 12.1-g5 artifact | red? | **GREEN** | consistency-only | ISSUE-074 |
| G5 rule-3 unread-var rename | 12.1-g5 artifact | red | **6/6 pass** | SURVIVES | ISSUE-074 |
| NOISE_NOTE reworded to opposite | conductor_bench.py | red | **33/33 OK** | SURVIVES | ISSUE-103 |
| blanket-deny gate, message="registry" | tools.ts | e2e red | **e2e 35/35 green** | SURVIVES at e2e level | ISSUE-091 |
| C++ router data-path suite | router.hpp/admission/metrics/affinity/schema/config | red | 9 of 11 red (M-01 compression + M-03 redundant-scan survive, both analyzed) | BINDS (data path strong) | — |
| questions.ts both validators → no-op | questions.ts | red | **FULL gate PASS** | DECORATIVE | ISSUE-128 |
| removeWorktree on locked worktree | worktrees.ts | loud fail | **silent void** | LIVE BUG | ISSUE-129 |
| delete createWorktree foreign-branch refusal | worktrees.ts | red | **FULL gate PASS** | DECORATIVE | ISSUE-130 |
| plant Zombie.schema.json, run exporter | export-schemas.ts | pruned | **survives** | no pruning | ISSUE-043 |
| hand-typed 6-line G5 artifact | g5-artifact-check.ts | object | **ok:true, []** | shape-only | ISSUE-074 |
| replay level threshold / pairing | replay.ts | red | red each | BINDS | — |
| sampled 8 revertAssertions re-run | STATE.json | reproduce | 7/8 reproduce; 11.5 does not | mostly honest | ISSUE-090 |

**Flake sweeps:** fanout.test.ts 20×, continuation.test.ts 5×, router doctest 10× — zero flakes in-suite. But
the FULL parallel gate on unmutated HEAD is nondeterministically red (ISSUE-134), so every full-gate verdict
above is a distribution sample; scoped runs are stable and were preferred.

---

## 7. The nine Part G enumerations (merged, every row with a verdict)

Reading finds what you thought to look for; enumerating with a per-item verdict finds what you did not. Each
inventory below is merged across the seventeen parts, with a verdict for every row. "Not examined" is recorded
where true. Where two parts disagreed on a row, the code was checked and the correct side recorded.

### 7.1 Enumeration 1 — every conductor tool (22 in `CONDUCTOR_TOOL_NAMES`)

Question per tool: bound? reaches a committed handler? are the declared args the shape the handler needs? is
there a test that drives it? plus the legality verdict (does anything gate WHEN it may be called). Merged from
core-logic Enum#1, tools-handlers-a/b, composition (LEGAL-SITES), sweep-gate-mutation (tool-binding.test.ts),
composition-injection (tool inventory).

| # | Tool | Bound → committed handler | Args shape ↔ handler | Driven by a test | Legality gate | Verdict / Issue |
|---|---|---|---|---|---|---|
| 1 | conductor_classify | yes → handleClassify | ok | yes (9.1) | **NONE** (no legality-first step; not in a phase gate) | HOLE — ISSUE-005 (re-entry clobbers state) |
| 2 | conductor_decompose | yes → handleDecompose | ok | yes (9.2, M22 binds) | legalRunTransition | sound |
| 3 | conductor_plan | yes → handlePlan | ok | yes (9.2, M6 binds) | legalRunTransition | sound |
| 4 | conductor_plan_review | yes → handlePlanReview | ok | yes (9.3, M7/M19 bind) | edge probe | sound |
| 5 | conductor_dispatch_wave | yes → handleDispatchWave | ok | yes (9.4c/9.6) | waveVerdict → legalTools (passes run.state) | sound |
| 6 | conductor_submit_test | yes | ok | yes (9.4a, M4/M16 bind) | requireStageTool | sound; legal-red content vacuous under `**` (ISSUE-011) |
| 7 | conductor_vet_test | yes → handleVetTest | ok | yes (9.4a, M9/M17 bind) | requireStageTool | criteria verdicts advisory (ISSUE-013) |
| 8 | conductor_mark_green | yes → handleMarkGreen | ok | yes (9.4b, M3/M10 bind) | requireStageTool | re-runs on-disk test, no re-vet (ISSUE-008/010) |
| 9 | conductor_validate | yes → handleValidate | ok | yes (9.4b) | requireStageTool | vacuity double-guarded — cleared |
| 10 | conductor_item_review | yes → handleItemReview | ok | yes (9.5a) | requireStageTool | id-collision drops findings (ISSUE-049); red-revalidate wedge (ISSUE-055) |
| 11 | conductor_publish | yes → handlePublish | ok | yes (9.5b/9.6) | requireStageTool | deletion-freshness (ISSUE-046); zero-file publish (ISSUE-060); worktree wedge (ISSUE-050) |
| 12 | conductor_report | yes → handleReport | ok | yes (9.5c) | **hardcoded from-state "EXECUTING"** (not run.state) | HOLE — ISSUE-005 (defer-all→done); done on RED verify (ISSUE-053); can't write blocked/surfaced (ISSUE-065) |
| 13 | conductor_decide | yes → handleDecide | ok | yes (9.1/decide) | ad-hoc only (no phase gate) | requireTwoOptions binds; human-kind 0-option escape (ISSUE-069) |
| 14 | conductor_surface | yes → handleSurface | ok (askedBy threaded) | yes | ad-hoc only | first-block-wins cleared |
| 15 | conductor_answer | yes → handleAnswer | ok | yes | **NONE** (any string clears block; legal on terminal runs) | HOLE — ISSUE-051 (human sim; answered Qs vanish from report) |
| 16 | conductor_defer | yes → handleDefer | ok | yes | **NONE** (legal every non-terminal state) | HOLE — ISSUE-052 (forges kind:"human") |
| 17 | conductor_queue_amend | yes → handleQueueAmend | ok (ops parsed) | yes | **NONE** (operable on terminal runs) | HOLE — ISSUE-005(R2); parseAmendOps refusal untested at the seam |
| 18 | conductor_inline_claim | yes → handleInlineClaim | ok | yes | **NONE** (mintable on terminal runs) | HOLE — ISSUE-005(R2) reopens G8; expiry unimplemented (ISSUE-057) |
| 19 | conductor_override | yes → handleOverride | ok (itemId from registry) | yes (9.5c/cr) | budget re-derived (both meters) | budget binds; free-string gate burns it (ISSUE-007) |
| 20 | conductor_status | yes → handleStatus | ok | yes | always-legal by design | read-only; torn-questions SyntaxError (ISSUE-101) |
| 21 | conductor_setup | yes → handleSetup | ok (answers are model args) | yes (setup/12.2) | pre-write proofs | `behavioralPaths:[]` accepted (ISSUE-048) |
| 22 | conductor_forget_stale | **null handler** (guard-tested) | n/a | yes (binding guard) | n/a | intentional null; TOOL_BINDINGS maps it null — per §3.4 |

**Verdict:** all 22 are bound and 21 reach a committed handler; the arg-shape↔handler equality is structurally
guarded (`tool-binding.test.ts`, TB1–TB3 bind). The systemic hole is legality: **only the 6 stage tools +
dispatch_wave route through `legalTools`** (two production call sites); the 11 meta tools and classify are
guarded by nothing when-callable (ISSUE-005, the unifying finding).

### 7.2 Enumeration 2 — every role in §4.1 (7 roles)

Which doctrine pack, params, headers, gate arm; is that arm reachable with the role name production registers?
Merged from composition-injection (per-role table + gate-snapshot verdict), sweep-vocabulary (V7).

| Role | §4.1 pack | Pack ARRIVES verbatim? | Sampling applied | Router header sent | Edit-gate arm | Verdict / Issue |
|---|---|---|---|---|---|---|
| orchestrator | core.md | only via fragment `{file:}` if agent active | NO | NO | inlineClaim scope; tree=store.root | doctrine channel dead (ISSUE-001) |
| planner | decompose.md / plan.md | NO (tools.ts paraphrase) | NO | NO | READER_ROLES → deny | ISSUE-001/-003 |
| testWriter | tdd.md | NO (one sentence) | NO | NO | testScope arm | **main-mode: EVERY write denied (ISSUE-002)**; worktree ok |
| implementer | tdd.md (+debug.md in DEBUG) | tdd.md NO; debug.md YES | NO | NO | fileScope arm | **main-mode: EVERY write denied (ISSUE-002)**; can edit own test (ISSUE-008) |
| reviewer | review.md / test-vet.md | NO | NO | NO | READER_ROLES → deny | ISSUE-001; accept-on-trust (ISSUE-072) |
| skeptic | skeptic.md | NO | NO | NO | READER_ROLES → deny | ISSUE-001; refuted-default kills findings (ISSUE-072) |
| mechanical (classifier) | core.md (lite) | NO | NO | NO | READER_ROLES → deny | dispatched as role "mechanical" (per §3.2:1077, not a drift) |

**Verdict:** the §4.1 pack/sampling/priority columns are FAITHFULLY encoded in `inject.ts` and never consulted
(ISSUE-001). The role vocabulary has no owner (ISSUE-121); typos are absorbed by silent fallbacks. Every reader
role correctly denies edits; the two writer roles are correctly scoped in worktree mode and **totally locked
out in the default main mode** (ISSUE-002).

### 7.3 Enumeration 3 — every closed vocabulary (owner · restatements · drift guard)

The complete inventory is the sweep-vocabulary V1–V35 table (§7 of `parts/sweep-vocabulary.md`), read in full
and reproduced here in condensed form. Legend: G = guarded (real drift guard), G± = pin-only / one-directional /
partial, G✗ = none.

| Vocabulary | Owner | Guard | Issue |
|---|---|---|---|
| Run states (8) | fsm-run.ts | G (single-source deepEqual) | — |
| Terminal-state subset (3) | **none** | G± per-copy | ISSUE-115 |
| Item states (7) | fsm-item.ts | G arrays / G± switches | ISSUE-122 |
| Stop kinds (6) | types.ts | G± satisfies / python pin | ISSUE-120, -113 |
| Journal components+events | journal-events.ts | G (best in repo) minus the stripComments hole | ISSUE-088, -124 |
| Question origins (6) | types.ts | G (runtime validate) | — |
| Failure classes (3) + legal-red rule | types.ts | G± type, G✗ rule ×3 | ISSUE-125 |
| Roles (7) | **none** | G± behavioral; typo-absorbing | ISSUE-121 |
| Tool names (22) | tools.ts | G mostly; emitted-⊆-inventory gap | ISSUE-123 |
| Doctrine pack filenames (9) | inject.ts REQUIRED_PACKS | G one direction only | ISSUE-114 |
| X-Conductor-* headers (4) | RouterConfig / none | G✗ cross-language | ISSUE-117 |
| Priority wire values (3) | none | G✗; dead FanoutJob.priority | ISSUE-116, -117 |
| Env vars (python↔TS) | writer/reader split | G✗ cross-language, silent fallback | ISSUE-118 |
| Run-dir & state filenames | state/journal/evidence/tools | mixed | ISSUE-059, -126 |
| verify-running-<tree>.json | evidence.ts | G (single point, C-081 held) | — |
| Agent names (7 kebab) | opencode-fragment.json | G (both sides read fragment) | — |
| Decision score keys (5) | types.ts | G± | ISSUE-120 |
| Amend ops / amendable states | queue-amend.ts | ops exhaustive; states G✗ | ISSUE-120 |
| Git verb classes | gates-git.ts | owner-only | — (attack surface: ISSUE-014–021) |
| Bench cell config (maxReaders/workflow) | conductor_wiring.py | G✗ (third spelling) | ISSUE-112 |
| M5/planning placeholder patterns | confessed pair | G✗ self-documented | ISSUE-119 |
| Gate-leg filenames | the files | G± (vanish silently) | ISSUE-089 |
| RouterConfig keys / schema names | types.ts SCHEMAS | G (regeneration) | — |
| DEFAULT_MAX_READERS pair | conductor_wiring.py | **G (composition.test:823 — exemplary)** | — |
| e2e scenario names / §1.1 module list | plan / e2e | G± (loose grep) | (cross-lens) |
| Log levels / Config enums | types.ts | G (typed+schema) | — |

**Verdict:** the repo's strongest guards are the runtime schema-enum equality tests (single-source.test.ts) and
the one cross-language source-grep (composition.test:823) — both hand-built. The unguarded restatements above
are flagged even where copies currently agree (P3 doctrine). The single most damaging vocabulary hole is
ISSUE-088 (stripComments blinding the two source audits).

### 7.4 Enumeration 4 — every gate/check with the mutation that kills it (none named = decorative)

Consolidated from the merged mutation table (§6) and every part's mutation runs. A check with **no** killing
mutation is decorative — those are named explicitly.

| Gate / check | Killing mutation | Binds? | Issue |
|---|---|---|---|
| RED-before-GREEN (exit-0 as red) | fsm-item.ts accept exit0 | YES | — |
| tie-upholds threshold | verdict.ts `>=`→`>` | YES | — |
| HEAD freshness | freshness.ts disable term | YES | — |
| git default-deny | gates-git.ts deny→allow | YES | — |
| DESTRUCTIVE list membership | remove "apply" | **NO (default-deny still denies)** | decorative for decision → IDEA |
| edit redirect scan | REDIRECT_TO_FILE=/never/ | YES | — |
| per-tree verify freeze | disable freeze | YES | — |
| settledForReport | always allSettled | YES | — |
| FSM vocab drift | add bogus RUN_STATE | YES | — |
| implementer-may-edit-vetted-test | (probe) | **NO — allows** | HOLE ISSUE-008 |
| behavioral root-file TDD-skip guard | (probe) | **NO — accepts** | HOLE ISSUE-009 |
| mark_green zero-test/fallback refusal | (analysis) | **NO — admitted** | HOLE ISSUE-010 |
| meta-tool legality | classify/defer/report on wrong state | **NO — accepted** | HOLE ISSUE-005 |
| override gate vocabulary | {gate:"phase-order"} | **NO — burns budget** | HOLE ISSUE-007 |
| item-review adjudication by id | two "F1" findings | **NO — drops upheld** | HOLE ISSUE-049 |
| publish deletion freshness | flip hasStagedDeletion | **NO — GREEN** | HOLE ISSUE-046 |
| assertDecisionValid | no-op | **NO — 0 fail** | DECORATIVE ISSUE-064 |
| test gate `--test-timeout` | arm watchdog late | **deadlocks forever** | HOLE ISSUE-032 |
| late-create abort (fanout) | delete it | **NO — full gate PASS** | HOLE ISSUE-035 |
| metrics-body-object guard | delete it | **NO — full gate PASS** | DECORATIVE ISSUE-139 (minted by step 4; see §12.2) |
| main-tree dispatch write | E2E-1 | **DENY both (fail-closed lockout)** | ISSUE-002 |
| chat.message part filter | push-all | **NO — all green** | ISSUE-136 |
| doctrine anchor polarity | invert core.md heading | **NO — 15/15 green** | ISSUE-135 |
| ROLE_PACKS delivered-set | add extra-governance.md | **NO — green** | ISSUE-114 |
| journal-vocab audit (blanked span) | remove config.updated | **NO — 7/7 green** | HOLE ISSUE-088 |
| tsconfig / bun-smoke leg presence | mv aside | **NO — GATE PASS silent** | ISSUE-089 |
| M5 multi-line empty catch | (probe) | **NO — M5 PASS** | ISSUE-092 |
| M5 explicit nonexistent files | (probe) | **NO — M5 PASS(2 scanned)** | ISSUE-092 |
| ctest zero-test | (scratch) | **NO — exit 0** | ISSUE-097 |
| acceptance row 10 (derive_slots) | collapse to 1 | **NO — PASS** | ISSUE-094 |
| detector F stamp | prose mention | **NO — PASS** | ISSUE-095 |
| purity subprocess rule | shell-string exec() | **NO — 4/4 pass** | ISSUE-096 |
| detector C header-test loop | (analysis) | **NO — `\|\| true` discards** | ISSUE-099 |
| G5 anti-tautology (byte-identical) | flatten arms | YES | — |
| G5 anti-tautology (consistency) | both blocks same fake nums | **NO — GREEN** | ISSUE-074 |
| G5 rule-3 unread var | rename to unread | **NO — 6/6 pass** | ISSUE-074 |
| NOISE_NOTE honesty | reword to opposite | **NO — 33/33 OK** | ISSUE-103 |
| e2e gate hook (allow-side) | blanket-deny w/ "registry" msg | **NO — e2e 35/35** | ISSUE-091 |
| questions.ts validators | both no-op | **NO — full gate PASS** | DECORATIVE ISSUE-128 |
| createWorktree foreign-branch refusal | delete | **NO — full gate PASS** | DECORATIVE ISSUE-130 |
| removeWorktree cleanup | locked worktree | **silent void** | LIVE BUG ISSUE-129 |
| export-schemas pruning | plant Zombie schema | **NO — survives** | ISSUE-043 |
| revertAssertion 11.5 | drop outer burst guard | **NO — ctest 100%** | RECORD WRONG ISSUE-090 |
| C++ data-path suite (9 mutations) | M-02..M-13 | YES (9/11; 2 analyzed) | — |
| revertAssertions (7 of 8 sampled) | replay | YES | — |
| serve.py launch leg (M3/M4) | swap ports / delete fallback | **NO — 80 tests OK** | ISSUE-106 |
| bench cell config pin | maxReaders→60 + read-only | **NO — 33/33** | ISSUE-112 |
| detector F prose (5th copy) etc. | — | — | ISSUE-114/117/118 |

**Verdict:** the mechanical enforcement spine binds; the audit/gate LAYER carries a disproportionate share of
decorative or blind checks — ISSUE-088 (source audits blinded), ISSUE-089/092/097 (silent-skip / vacuous-green
gate legs), and the whole acceptance-meter shape-not-substance cluster (ISSUE-093/094/095/099).

### 7.5 Enumeration 5 — every assertion row across `docs/build/specs/*.assertions.json`

60 spec files, **795 rows** (mechanical baseline from sweep-rows-and-tests §0). `coveredByTest` is null on 548
of 795. Row-id presence: 658 rows named in a test title; 19 comment-only; 118 named nowhere. Per-file verdicts
below merge sweep-rows-and-tests §5.1 (all 60 files) with cpp-router (router tasks) and sweep-honesty (14.1/15.1).

| Spec (rows) | Verdict | Issue |
|---|---|---|
| task-0.1 (8) … task-8.2 (25), task-9.1 (…) | named+proven where sampled; early convention populates coveredByTest | — |
| task-0.3 / 1.1 / 1.3 / 6.1 (19 rows) | proven, linked only by prose comments | ISSUE-133 |
| task-5.3 (7) | 6 named; `5.3-direct-drive` coverage claim FALSE (id in no test) | ISSUE-133 |
| task-9.2–9.6, 12.x, 13.x, 14.x, 15.x | coveredByTest null; title-naming convention | ISSUE-081 |
| task-11.2–11.7 (60) + 15.2 (17) | every row has a same-named TEST_CASE | — (cpp strong) |
| task-11.8 (12) | 6 met, 3 partial, **2 LIVE rows discharged by nothing & undisclosed** | ISSUE-076 |
| task-12.1-G5 (21) | **14 UNMET, 5 partial, 2 met-in-spirit; no supersession; row 9b ticked anyway** | ISSUE-075 |
| task-13.1 (42) | 22 named (12 honestly partial), 16 proven-unnamed, 4 e2e-blind (now unit-covered) | ISSUE-132 |
| task-13.2 (19), task-14.2 (18) | NOT_STARTED — disclosed | (known-open) |
| task-14.1 (33) | 33/33 covered, high quality | — |
| task-15.1 (25) | named; G5 honesty content gap | ISSUE-075/-080 |
| fix-phase12-g5 (6) | 5 proven (1 by mutation), rule-3 hole | ISSUE-074 |
| P8 self-contradiction sweep (~230 texts) | no new self-contradictory rows; 2 prior fixed | (clear — SWEEP-ROWS-008) |

**Verdict:** at unit level the row→proof coverage is materially better than the recorded floor; the systemic
defects are (a) navigability — 118 rows traceable to no test, `coveredByTest` dead on 69% (ISSUE-081/-132/-133);
(b) the promoted-then-superseded G5 ledger read as discharged (ISSUE-075); (c) two live 11.8 rows proven by
nothing and not disclosed (ISSUE-076).

### 7.6 Enumeration 6 — every correction C-001…C-092 (does the class recur, unfixed?)

The full 92-row recurrence table is in `parts/sweep-corrections.md` §5 (all 92 read). It produced the class
inventory (CL-SCAN, CL-ORACLE, CL-TWOSPELL, CL-CRASHORD, CL-TORNLINE, CL-KNOB, CL-FIXEDTMP, CL-STALEWT, …) and
found these classes STILL LIVE at HEAD:

| Correction / class | Recurrence found at HEAD | Issue |
|---|---|---|
| C-020/C-029/C-031/C-067 CL-CRASHORD | question-first/setBlocked-second at 5 of 7 sites; reconciler filter excludes 4 | ISSUE-100 |
| C-017/C-032-E12 CL-TORNLINE | questions.ts reader throws; handleStatus + handleReport unwrapped | ISSUE-101 |
| C-032-E13 CL-KNOB | 3 knobs still un-floored (planReviewMaxRounds, plan-review k, readFanout) | ISSUE-102 |
| C-030-E12 (refuted) enforcement-advisory | file budget counts entries; one glob evades | ISSUE-012 |
| C-077 CL-ORACLE | NOISE_NOTE content unpinned; opposite-meaning survives | ISSUE-103 |
| C-074-F3 CL-STALEWT | wt14 prunable left registered again | ISSUE-087 |
| C-074-F2/C-078 CL-FIXEDTMP | verify-acceptance.sh still fixed /tmp | **DROPPED (see §12)** |
| C-005/C-015/C-062 CL-SCAN (bun leg) | bun leg no zero-test floor | ISSUE-098 |
| C-032-E7/C-045 CL-SCAN (audit blind) | stripComments blanks spans | ISSUE-088 |
| C-032-F1/C-082 CL-FALSEREF (P10) | refutations recorded without evidence | ISSUE-079 |
| C-075 CL-BADROW | 14.2 spec revision never landed | ISSUE-078 |
| C-089 CL-TAUTEV | STATE.json still narrates the tautology | ISSUE-073 |
| C-087 CL-LEAK | serve.py log_handle fd still open (recorded-deliberate) | (noted; not re-filed) |
| C-063 R11-004 | percentile-zeros still live (metrics.hpp:137) | ISSUE-044 (envelope) |
| C-088 new-extension residual | briefing known-open, unchanged | (known-open) |
| C-091 §3.3 reverted-behavior probe | now unit-covered both branches (BETTER than recorded) | (improved) |
| C-092 four unproven rows | still zero tests; better at unit level | ISSUE-132 |

C-001…C-016 are process/preflight entries with no product recurrence surface (verdict: no class). The dominant
meta-pattern is **recorded-debt-never-scheduled** (ISSUE-078/-100, IDEA-PROC-1).

### 7.7 Enumeration 7 — every branch requiring an unusual precondition (P12), with the reaching test

Merged from core-logic Enum#3, fanout-concurrency, sweep-rows-and-tests §9 (the exhaustive P12 pass),
adapter-remainder §4b, scripts-python.

| Branch (unusual precondition) | Test reaches it? | Issue |
|---|---|---|
| redEvidenceGate reject exit-0/error class | yes | — |
| verifyFreshFor NaN / HEAD-moved | yes | — |
| classifyFailure error for out-of-scope import | yes — but `**`-scope hole NOT reached | ISSUE-011 |
| cannotEverPublish blocked-dep path | **NO** | ISSUE-066 |
| legalTools no-git multi-item recommendation | **NO** | ISSUE-068 |
| EXDEV / crash-manifest replay (quarantine) | yes | — |
| merge-conflict abort + GREEN demotion | yes | — (but 2nd publish NOT walked → ISSUE-050) |
| watchdog / retry / freeze-hold / failover latch | yes | — |
| watchdog-fired-then-create/prompt completes | **NO** | ISSUE-035 |
| never-settling re-prompt latch | **NO** | ISSUE-033 |
| deterministic throw early in handleSessionIdle | **NO** | ISSUE-034 |
| journal.log throw in watchdog callback | **NO** | ISSUE-031 |
| schema-invalid re-prompt | yes ([7.1-retry]) | — |
| journal rotation / truncation / unknown-event | yes | — |
| torn-line reads (questions/journal/replay/state) | yes for most; questions.ts reader throws | ISSUE-101 |
| supervisor restart/backoff/SIGKILL/readiness-fallback | yes (p12 tests) | — |
| serve.main() router LAUNCH leg | **NO** (M3/M4 survive) | ISSUE-106 |
| serve.wait_until_ready | **NO** | ISSUE-108 |
| build_cell_env spawn (PATH-less) | **NO** (live blocker) | ISSUE-107 |
| fetch_models download/validate/resume | **NO** (zero coverage) | ISSUE-109 |
| admission queue-timeout / overflow / health-at-full-queue | yes; multi-model starvation NOT | ISSUE-042 |
| mid-stream upstream death (buffered & streamed) | yes | — |
| worktrees foreign-branch refusal / locked-remove | **NO** | ISSUE-130 / -129 |
| questions.ts validator refusals | **NO** | ISSUE-128 |
| createWorktree/mergeBack spawn-failure rethrows | **NO** | (noted in ARTools §4b) |
| override exhaustion env-stop | yes | — |
| §3.3 reverted-behavior probe | unit yes; e2e never fires | (improved / known-open) |
| DEBUG loop end-to-end | e2e scenario present | — |

**Verdict:** at unit level the unusual branches are exceptionally well chased (the 92-correction campaign
visibly worked); the remaining unwalked branches cluster in three places: **the idle-engine liveness doors**
(ISSUE-031/033/034), **serve.py's live launch/readiness/download half** (ISSUE-106/107/108/109), and **the
live/system G5 legs** already owed by unmet rows (ISSUE-075/076).

### 7.8 Enumeration 8 — every enforcement point (Part A)

The merged enforcement table is section 5 above (E1–E24). It records, for every point where the model reports
something, whether the harness RE-DERIVES / PARTIALLY / ACCEPTS-ON-TRUST, with the lying-model consequence and
the owning issue per row. This enumeration is satisfied by that table; see §5. Summary: the spine re-derives
mechanical facts (E1/E3/E6/E11/E13/E18/E24); it believes rather than knows at E2 (test weakening),
E8/E9/E19 (review + doctrine), E12/E14/E15/E17 (report/answer/defer/setup), E20/E21 (meta-tool + caller
legality); and E22 (main-mode write lockout) means the default config cannot do work with a real model.

### 7.9 Enumeration 9 — every file in `conductor/`, `router/`, `scripts/` (covered or not)

Satisfied by the coverage ledger, section 10 below, which lists every production file under
`conductor/{core,adapter,plugin,tools}/`, `router/` and `scripts/` (excluding `conductor/tests/`) with the
part(s) that covered it and the depth. The mechanical UNOWNED-FILES check (§12) confirms the union of the
seventeen ledgers leaves that scope's list **empty**.

---

## 8. The adversary log (Part F, merged)

Playing the competent-but-lazy local model with the doctrine packs as the only instructions, across
sweep-adversary (§1b), tools-handlers-b (§8), and the reproductions in composition, tools-handlers-a and
sweep-corrections. Each objective: what was attempted, what broke, what held.

**(a) Reach PUBLISHED with the least real work — SUCCEEDED, three independent ways.**
- **Skip TDD on root-level production files (ISSUE-009, reproduced M3/M4).** Declare every root-level file
  (`config.ts`, `index.ts`, `main.go`) a `behavioral:false` item. `rootLevelOnly("**")` treats `**` as
  directory-rooted, so `firstIntersectingGlob(["config.ts"],["**"])` returns null and `validateQueue` accepts
  it under the SAFE DEFAULT `behavioralPaths:["**"]` and under ordinary `["**/*.ts"]`. Each item runs
  PENDING→GREEN with no test, no RED, no vet. Invisible in dogfooding because conductor's own source is all
  under directories.
- **Kill TDD wholesale (ISSUE-048).** `conductor_setup` with `answers.behavioralPaths:[]` passes (only
  `=== undefined` is gated). Every item is then legally `behavioral:false` repo-wide. On a fresh repo the model
  relays the human's answers, so the fabrication is indistinguishable.
- **Defer the hard items, close `done` (ISSUE-052, reproduced R1).** `conductor_defer` is legal in every
  non-terminal state, needs no human, stamps `kind:"human"`. classify→decompose→defer-all→report closes a run
  REPORTED/`done` from DECOMPOSED, skipping PLANNED/PLAN_REVIEWED/EXECUTING, with a green closing verify and
  forged human-decision provenance.

**(b) Make a review finding disappear rather than fixing it — SUCCEEDED.**
- As reviewer: return `{"findings":[]}` — sanctioned, indistinguishable from a diligent empty review; no
  forcing function proves the diff was read (ISSUE-072).
- As skeptic: return `upheld:false` per `skeptic.md`'s "uncertain ⇒ refuted" default. One lazy skeptic kills a
  finding at k=1; two kill it at the k=2 default (ISSUE-072).
- By id collision (ISSUE-049, reproduced R4): two lens sessions both number a finding "F1"; `outcome.set`
  overwrites, so an upheld security finding is silently dropped when its id-twin is refuted. No action needed.
- As implementer: weaken the vetted test (ISSUE-008) if its path is in `fileScope`; `mark_green` re-runs it
  with no re-vet. `receive-review.md:51` forbids this — but it is doctrine, not a gate, and (ISSUE-001) never
  reaches the session anyway.

**(c) Satisfy an acceptance row's letter while violating its intent — SUCCEEDED.**
- ISSUE-009 satisfies "behavioral:false ⟹ disjoint" while skipping TDD on production code.
- The operator meter `check_artifact` accepts a transcript SHAPE, not a real run (ISSUE-093): a 26-line
  fabricated SMOKE.md (~15 s of work) flips row 6 FAIL→PASS; exit 0 (the runbook's completion criterion) is
  nearly costless to fabricate for the two artifacts (13.2/14.2) it will matter for.

**(d) Produce a plausible artifact for a step you did not perform — SUCCEEDED (with one containment).**
- The G5 standing gate proves consistency, not provenance (ISSUE-074, reproduced): a six-line hand-fabrication
  whose two metric blocks agree returns `ok:true, violations:[]`.
- `kind:"human"` defer records (ISSUE-052) are in-harness forged human artifacts.
- CONTAINMENT: for row 9b, defense-in-depth held — the node g5-artifact guard rejected a prose-only
  fabrication that the operator meter accepted (ISSUE-093), so the fabrication cost is higher there than for
  rows 6/8 which have no standing node guard.

**(e) Get a test to pass without the behaviour it names — SUCCEEDED.**
- Weaken the vetted test (ISSUE-008); skip the test entirely as non-behavioral (ISSUE-009); ride a
  zero-test/full-suite fallback green (ISSUE-010); assert nothing via a `**`-scope missing-subject legal RED
  (ISSUE-011). All reproduced or read against real code.

**(f) Spend the override budget to route around a gate — CONTAINED.**
- Override reaches only the session/git/edit gates (three `consumeOverrideGrant` literals), never the FSM
  evidence gates. Each grant taints the item, writes an anomaly, is one-shot for one gate; exhaustion is an
  `env` stop that halts the run and writes a report; it is never converted to another override. The adversary
  could NOT spend to a GREEN, VALIDATED, or PUBLISHED without the underlying evidence (verified R3). The
  perverse residual: a misspelled/undocumented gate name (the plan's own `phase-order` example) burns the
  budget on nothing and the third attempt kills the run (ISSUE-007) — honest use of the hatch is punished.

**What could NOT be done (the spine held):**
- Forge an evidence record or narrate a color the handler did not observe — `evidence.runTest`/`runVerify` are
  the sole writers and the FSM consumes only them (R2, cleared).
- Reach VALIDATED without the verify running (E1, cleared); publish on a moved HEAD/foreign tree (freshness +
  HEAD check, cleared); commit outside the item's pathspec or sweep startDirty WIP (cleared); make setup write
  an unproven config (cleared).

**The through-line (and the incentive inversion).** Mechanical enforcement holds; the two points where control
passes to model judgment — **scope declaration at decompose time** and **correctness judgment at review time**
— are where unverified work is accepted. And the composition rewards it backwards (ISSUE-066/COMPOSITION-001):
the honest model that waits on a human gets `noop` and lost work; the lazy model that defers gets a clean
`done`.

---

## 9. Honesty audit (P9) — fabricated or unverifiable evidence

**No fabricated evidence was found.** This is the reconciled verdict of the three lenses that audited the build
record directly — sweep-honesty (the primary P9 sweep), cpp-router §7 (router tasks), and adapter-remainder §6
(G5 artifacts) — cross-checked against gates-security §4a and tools-handlers-b §9.

**What was mechanically checked and held:**
- **Every recorded commitSha exists and carries its recorded message** — all 55 STATE.json rows, scripted
  cross-check, byte-for-byte subject match (sweep-honesty cleared area 1).
- **The acceptance headline reproduces exactly** — 17 PASS / 4 FAIL, the same four rows, all owed by 13.2/14.2;
  the embedded full gate reports 1382/1382 (sweep-honesty cleared area 2).
- **Sampled recorded reds reproduce** — 8 of 8 `revertAssertion`s sampled by sweep-honesty and 7 of 8 by
  sweep-gate-mutation replay their claimed red (8.1 even to the exact failing-test count). The **one exception**
  is task 11.5, whose recorded mutation is mutation-equivalent and produces no red — an evidence-integrity
  defect (ISSUE-090), not a fabricated measurement: the property IS covered by a different mutation.
- **The two unbuilt live artifacts never existed** — history-wide `--diff-filter=A` for `conductor/SMOKE.md`
  and `conductor-report.md` finds nothing; the "authoring either is fabrication" line was honored in fact
  (sweep-honesty cleared area 6).
- **The G5 artifact's two-identical-arms shape is absent** from the shipped version and present only in the
  retracted, superseded C-089 record; the shipped arms differ in variables genuinely read by source
  (grep-verified). The 11.8 artifact's internal arithmetic reconciles (462=120+342, rate 0.5).
- **Corrections numbering is contiguous** C-001…C-092, no gaps or renumbering; 14.1's 33/33 coverage claim
  re-derived true.
- **The router accepts nothing from a model on trust** — every number it reports is derived from traffic it
  relayed itself (cpp-router §6 enforcement posture); its honesty findings are all about the build record, not
  the data path.

**The honesty failures found are of a quieter kind — record surfaces that stopped being maintained, not
invented outputs.** Each is filed:
- STATE.json still narrates the discredited G5 tautology (C-089) as real evidence, unmarked (ISSUE-073).
- The G5 anti-tautology guard proves consistency, not provenance; the residual is disclosed nowhere
  (ISSUE-074).
- Two 11.8 LIVE rows (streaming, fail-soft equivalence) discharged by nothing and NOT in the artifact's own
  "does NOT discharge" section; M7/M8 recorded PASS (ISSUE-076); the WIRE_CONTRACT_VERIFIED stamp cites an SSE
  observation that never happened (ISSUE-077).
- 14 of 21 promoted G5 ledger rows unmet with no supersession record; acceptance row 9b ticks anyway
  (ISSUE-075).
- filesTouched/commitSha imprecision on 9 of 55 rows (ISSUE-084); the M1–M9 gate ledger silently ends at 11.8
  (ISSUE-083); `coveredByTest` dead on 548/795 rows yet read as evidence (ISSUE-081); the four record surfaces
  describe four different presents (ISSUE-082); HONEST-LIMITS.md never received the 11.6 pending item
  (ISSUE-080); refuted findings recorded without their refutation evidence (ISSUE-079).
- Two shipped operator-facing security claims are falsified: HONEST-LIMITS.md's "a wrapper cannot hide" a git
  write (ISSUE-014) and its "the sigil-deny covers the alias route" (ISSUE-015); the case-fold `.conductor`
  bypass is undisclosed (ISSUE-016). These are honesty defects in the one document "whose only job is honest
  disclosure."

**What was checked and could not be settled from the record:** the three unanimously-refuted phase-13 findings
carry one line each and no refutation evidence, so P10 re-litigation required re-running the mutations from
scratch (ISSUE-079) — the record itself cannot discriminate a sound refutation from C-032's sealed false
negative.

**Scope note:** the plan's clause-by-clause conformance was judged by the subsystem lenses, not re-derived by
the honesty sweep. Historical per-task suite counts were validated for internal consistency (monotone in commit
time) but not re-executed at historical shas.

---

## 10. The coverage ledger (union of all seventeen part ledgers)

Every production file under `conductor/{core,adapter,plugin,tools}/`, `router/` and `scripts/` (excluding
`conductor/tests/`) — the `git ls-files` scope enumerated in §12's assertion. "Depth" is the deepest treatment
any part gave it (full = read whole + mutated; read = read whole; targeted = the file's relevant regions;
scanned = grep/import-level). Where two parts examined one file, the deepest owner is named first.

### 10.1 `conductor/core/` (17 files — all read in full by core-logic)

| File | Covering part(s) | Depth | Issues produced |
|---|---|---|---|
| commit-message.ts | core-logic; sweep-vocabulary | full | ISSUE-071 |
| decide.ts | core-logic; sweep-vocabulary | full | ISSUE-069, -070, -120 |
| freshness.ts | core-logic; sweep-adversary; gates-security(via consumers) | full | ISSUE-011 |
| fsm-item.ts | core-logic; sweep-adversary; sweep-vocabulary | full | ISSUE-125 |
| fsm-run.ts | core-logic; sweep-vocabulary; sweep-gate-mutation(SS1) | full | — (drift guard binds) |
| gates-edit.ts | gates-security; core-logic(M6/M7); sweep-adversary(M1); composition-injection; tools-handlers-a | full | ISSUE-008, -016, -017, -018 |
| gates-git.ts | gates-security; core-logic(M4); composition-injection(runActive) | full | ISSUE-014, -015, -019, -020, -021, -022 |
| gates-phase.ts | core-logic(M8); composition; sweep-vocabulary; gates-security(M4/M5) | full | ISSUE-005, -065, -066, -068, -115, -122, -123 |
| journal-events.ts | core-logic; sweep-vocabulary(MUT-7); adapter-remainder(owner) | full | ISSUE-088, -124 |
| planning.ts | core-logic; sweep-adversary(M2–M5); sweep-corrections; tools-handlers-a | full | ISSUE-009, -012, -119 |
| queue-amend.ts | core-logic; sweep-vocabulary; sweep-corrections | full | ISSUE-120 |
| schedule.ts | core-logic; sweep-corrections(readFanout); sweep-vocabulary | full | ISSUE-068(consumer), -102 |
| shell-parse.ts | gates-security; core-logic | full | ISSUE-014, -016, -018, -019 |
| stops.ts | core-logic; composition; sweep-vocabulary(MUT-2); sweep-rows(MUT-3) | full | ISSUE-065, -113, -115, -120 |
| tool-bindings.ts | core-logic; sweep-adversary; sweep-vocabulary | full | ISSUE-052(contrast) |
| types.ts | core-logic; sweep-vocabulary | full | ISSUE-010(schema), -120 |
| verdict.ts | core-logic(M2); sweep-adversary; sweep-vocabulary | full | — (tie-upholds binds) |

### 10.2 `conductor/adapter/` (14 files)

| File | Covering part(s) | Depth | Issues produced |
|---|---|---|---|
| chat-message.ts | composition-injection(M10); sweep-vocabulary | read | ISSUE-136(part-filter is plugin) |
| config-io.ts | adapter-remainder(CFG-1/2); sweep-adversary; sweep-gate-mutation; sweep-vocabulary | full | ISSUE-112(guard exemplar) |
| continuation.ts | fanout-concurrency(full); composition(high); sweep-corrections; sweep-vocabulary(MUT-8); gates-security(skim) | full | ISSUE-033, -034, -036, -037, -057, -100 |
| evidence.ts | state-crash(full); tools-handlers-a; fanout-concurrency; sweep-vocabulary; sweep-adversary | full | ISSUE-010, -026, -125 |
| fanout.ts | fanout-concurrency(full); composition-injection(M8); sweep-vocabulary | full | ISSUE-031, -032, -035, -116 |
| gitio.ts | state-crash(full); sweep-gate-mutation(PU2 subject); sweep-vocabulary(scan) | full | ISSUE-096(via purity) |
| inject.ts | composition-injection(full); sweep-vocabulary(MUT-1/1b); sweep-gate-mutation(LA1/LA2) | full | ISSUE-001, -003, -114, -116, -117, -121 |
| journal.ts | state-crash(full); fanout-concurrency(for -005); sweep-vocabulary; sweep-corrections | full | ISSUE-031, -124 |
| quarantine.ts | state-crash(full); sweep-vocabulary(layout) | full | ISSUE-029 |
| questions.ts | adapter-remainder(Q-1/2/3); sweep-corrections; sweep-vocabulary; composition | full | ISSUE-101, -128 |
| router-client.ts | fanout-concurrency(full R-MUT-2); cpp-router(cross-lens); sweep-vocabulary(scan) | full | ISSUE-038, -039, -040 (+ dropped FANOUT-004, §12) |
| state.ts | state-crash(full); sweep-gate-mutation(JV1 subject); sweep-vocabulary; fanout-concurrency | full | ISSUE-023, -024, -025, -027, -059(counterpart) |
| tools.ts (9,253 ln) | tools-handlers-a(1–5515 full) + tools-handlers-b(5517–end full); gates-security(gate seam); composition-injection(~20%); sweep-adversary(~60%); sweep-corrections/vocabulary/gate-mutation(regions) | full (split across two lenses) | ISSUE-005, -007, -008, -010, -013, -030, -046–-064, -071, -088, -100, -101, -102, -116, -121, -125, -126 |
| worktrees.ts | adapter-remainder(W-1/2/3); sweep-vocabulary(layout) | full | ISSUE-050(publish side), -129, -130 |

### 10.3 `conductor/plugin/` (1 file)

| File | Covering part(s) | Depth | Issues produced |
|---|---|---|---|
| index.ts (1,427 ln) | composition-injection(full, 8 mutations); gates-security(gate snapshot full); fanout-concurrency(~35%); sweep-gate-mutation(TB decl sites); sweep-vocabulary; sweep-corrections | full | ISSUE-001, -002, -004, -006, -017, -022, -038, -136, -137, -138 |

### 10.4 `conductor/tools/` (4 files — all read in full by adapter-remainder)

| File | Covering part(s) | Depth | Issues produced |
|---|---|---|---|
| export-schemas.ts | adapter-remainder(ES-1); cpp-router(P-07); sweep-vocabulary | full | ISSUE-043 |
| g5-artifact-check.ts | adapter-remainder(G5C-1/3/F); sweep-gate-mutation(G5A/B); sweep-honesty(full); sweep-adversary; sweep-rows | full | ISSUE-074 |
| g5-equivalence.ts | adapter-remainder(G5D-1 live run); sweep-rows(full); sweep-honesty; sweep-vocabulary | full | ISSUE-086 |
| replay.ts | adapter-remainder(R-1/R-2); sweep-vocabulary; sweep-gate-mutation(RA5) | full | ISSUE-104(reader), -131 |

### 10.5 `router/` (9 files — all read in full by cpp-router)

| File | Covering part(s) | Depth | Issues produced |
|---|---|---|---|
| main.cpp | cpp-router | full | — (thin adapter, clean) |
| router.hpp (1,389) | cpp-router(6 mutations, 5 probes) | full | ISSUE-041, -042(context), -044(context) |
| admission.hpp | cpp-router(M-03, P-02); sweep-corrections; sweep-vocabulary | full | ISSUE-042 |
| affinity.hpp | cpp-router(M-10); sweep-gate-mutation(RA6/RA6b) | full | ISSUE-042(leak), -090 |
| config.hpp | cpp-router(M-13) | full | ISSUE-043 |
| metrics.hpp | cpp-router(M-05); sweep-corrections; sweep-gate-mutation | full | ISSUE-044 |
| schema-observer.hpp | cpp-router(M-11) | full | — (observe-never-enforce sound) |
| cli.hpp | cpp-router | full | — (refusal contract complete) |
| version.hpp | cpp-router | full | — |

### 10.6 `scripts/` (15 files — all read in full by scripts-python)

| File | Covering part(s) | Depth | Issues produced |
|---|---|---|---|
| serve.py | scripts-python(M3/M4); sweep-vocabulary(env); sweep-honesty(log_handle); sweep-gate-mutation(R9a) | full | ISSUE-105, -106, -108, -126 |
| conductor_wiring.py | scripts-python; sweep-vocabulary; sweep-gate-mutation(R10a/b); composition | full | ISSUE-094(consumer), -127 |
| conductor_bench.py | scripts-python(M1/M6); sweep-corrections(M1–M4); sweep-vocabulary(MUT-4); sweep-honesty(14.1); sweep-gate-mutation(RA4) | full | ISSUE-103, -104, -107, -112, -113 |
| fetch_models.py | scripts-python | full (read; not executed — network-bound) | ISSUE-109, -110 |
| benchmark.py | scripts-python | full (read; not executed — needs models) | ISSUE-109, -110 |
| bench_presets.py | scripts-python | full | — (pure data) |
| models_catalog.py | scripts-python | full | — (pure data) |
| hostinfo.py | scripts-python | full | IDEA-SP-14 (unused import) |
| ui.py | scripts-python | full | — (presentation only) |
| test-conductor.sh | scripts-python(subject); sweep-gate-mutation(M1–M9); sweep-vocabulary; fanout-concurrency(for -006) | full | ISSUE-032, -089, -098 |
| conductor-gate.sh | scripts-python(M7/M8); sweep-gate-mutation(M10–M16); sweep-vocabulary | full | ISSUE-092, -119 |
| verify-acceptance.sh | scripts-python(21 rows); sweep-gate-mutation(21 rows); sweep-honesty(full run); sweep-corrections; sweep-vocabulary | full | ISSUE-093, -094, -095, -097, -099 (+ dropped SP-013/014, §12) |
| test_conductor_wiring.py | scripts-python(M5); sweep-gate-mutation(RA/R10); sweep-honesty | full | ISSUE-111 |
| test_conductor_bench.py | scripts-python; sweep-honesty(14.1); sweep-gate-mutation(RA4) | full | ISSUE-112(pin), -104(fixture) |
| watch-agents.sh | scripts-python | full | IDEA-SP-09 (dead session id) |

### 10.7 UNOWNED-FILES verdict

Every production file in the mandated scope appears in at least one part's coverage ledger above. **The UNOWNED
FILES list for `conductor/{core,adapter,plugin,tools}/`, `router/` and `scripts/` (excluding
`conductor/tests/`) is EMPTY** — the predecessor's executive-verdict claim is confirmed mechanically (§12). The
one real gap sits OUTSIDE the named scope: `dashboard/ledger_view.hpp` (659 ln) and `dashboard/main.cpp`
(418 ln), examined by nobody (cpp-router read `router/tests/dashboard_test.cpp` at title depth only). These are
under top-level `dashboard/`, not `router/`, so they fall outside the scope the assertion governs; they are
recorded here and in §12 so the gap is visible.

### 10.8 What each lens explicitly did NOT examine (from the part ledgers)

- **tools.ts**: no single lens read all 9,253 lines end-to-end; tools-handlers-a owns 1–5515, tools-handlers-b
  owns 5517–end; the union is full, but seam defects between distant regions are why several findings
  (ISSUE-005, -008, -088) were invisible to single-region reads.
- **fetch_models.py / benchmark.py**: read but not executed (network/model-bound); five latent defects in
  fetch_models are flagged lower-confidence inside ISSUE-109.
- **The immutable plan (3,399 ln)**: read in full by the subsystem lenses for conformance; the sweeps consulted
  cited ranges only.
- **`dashboard/`**: not examined (outside scope, §10.7).

---

## 11. Cleared areas (attacked and could not be broken)

Merged and deduped across the seventeen parts. Each entry names the specific attack. A cleared area is a valid
result: it is evidence the property holds.

**The enforcement spine (the RE-DERIVED core):**
- **RED-before-GREEN sequence (structural).** Attacks: exit-0-as-red mutation (fsm-item M1, binds), non-assertion
  class as red (M4/M16, bind), stale-red pairing (M17, binds), queue_amend to reborn PENDING (core-logic). No
  pure-FSM path from PENDING to GREEN skipping RED exists. (The weaknesses found are in what counts as a legal
  red — ISSUE-011 — and in test identity — ISSUE-008 — not in the sequence.)
- **Evidence forgery / color narration.** `evidence.runTest`/`runVerify` are the sole writers; the FSM consumes
  only them; a sub-session's DONE receipt is never an advance (sweep-adversary, tools-handlers). Could not forge.
- **The full-verify validate.** Vacuity double-guarded before and after the run; quarantined; HEAD/start-stamped
  (tools-handlers-b, cleared). Could not construct a VALIDATED-on-nothing path.
- **Publish HEAD/freshness/commit sequence.** HEAD equality checked before staging; pathspec-confined commit;
  startDirty subtraction; denylist re-check on the built message (tools-handlers-b). Could not publish on a
  moved HEAD or outside the pathspec. (Residual: deletion-only freshness ISSUE-046; zero-file publish ISSUE-060.)
- **The override budget.** Checked FIRST against both meters; a refused override writes nothing; grant one-shot,
  keyed `{sessionID,gate,itemId}`, foreign-proof; exhaustion is an atomic `env` stop (gates-security, tools-b,
  sweep-adversary — all three cleared it). Could not spend around an FSM evidence gate.
- **Skeptic aggregation arithmetic.** Tie-upholds at k=2, strict majority at k=3 (verdict.ts M2, binds). Could
  not break the survival count. (The doctrine BIAS toward refutation is ISSUE-072, a separate matter.)

**Security / gates (the DENY set that held):**
- **Operator-separated compound git** (`&&`, `||`, `|`, `;`, `( )`, newline) — the git verb becomes its own
  segment and is correctly denied. (The exceptions are keyword/wrapper PREFIXES → ISSUE-014.)
- **Quote-glue and ANSI-C evasion** (`g"i"t`, `$'git'`, backticks, `$'\x67it'`) — all resolve to `git` and deny,
  or trip `hasUnresolvedExpansion` and deny fail-safe.
- **Listed-wrapper-with-flags** (`sudo -u bob git push`, `env -i git push`, `command -p git commit`, two-level
  `sudo env git`) — the value-flag skip finds the git word and denies.
- **Separate-value globals** (`git --namespace foo apply`, `git -C /x apply`, `git --git-dir /x apply`) — deny.
- **Edit-gate traversal / tree escape** — absolute out-of-tree → deny (normalizeUnderTree null); any `..`
  segment → deny; `.conductor/**` exact-case → deny; worktree session cannot reach the main-root state area.
  (The case-fold spelling slips → ISSUE-016.)
- **decideSession registry gate** — spawn (`task`) denied unconditionally; unregistered write/conductor denied;
  unregistered read allowed by design. Could not manufacture a registered session or route a write through an
  unregistered one.
- **Gate-snapshot fail-closed derivation** — every missing precondition (no ws / no registry entry / no itemId /
  no run / unloadable queue / untranslatable slug) yields NO_GATE_SCOPE (denies) or a freeze; no permissive
  default found (composition-injection M1/M2 bind).

**State store, crash-safety, evidence:**
- **Atomic tmp+rename crash-safety** — real SIGKILL inside the rename window (E5); the old target survives
  byte-for-byte; only an orphan `.tmp` remains (IDEA-SC-1).
- **Out-of-repo quarantine isolation + crash replay** — partial-move crash replayed (E7); data never lost or
  clobbered; a live owner's quarantine never stolen (residual: dir leak ISSUE-029).
- **Path-id trust boundary** — `assertSafeId`/`assertSafeRelPath` guard `/ \ . .. ` leading-`..`, absolute,
  non-slug against every id composed into a `.conductor/` path.
- **Marker over-age / dead-pid lifecycle** — `liveVerifyTrees` honors the same rule `runVerify` does (C-081
  genuinely fixed; single-sourced).
- **Timeout-kill authority** — SIGKILL (uncatchable), not SIGTERM; a hung test that traps SIGTERM cannot read
  as a false green.
- **Journal torn-line healing + rotation** — crash-torn partial last line isolated and skipped; rotation probes
  upward so a restart never clobbers an archive.
- **Git env hygiene** — GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR stripped, GIT_OPTIONAL_LOCKS=0.

**Concurrency / fan-out (fanout-concurrency §6):**
- **Watchdog-vs-completion double-resolve** — structurally prevented (the `done` flag + promise-resolve
  idempotence + onDone once per job). Could not double-count `inFlight`/`remaining`.
- **The concurrency cap, wave barrier, freeze-hold** — off-by-one (MUT-3) caught; hold-release re-pumps through
  the same cap; a held job cannot double-dispatch; the strand requires a foreign live-pid sub-24h marker.
- **The §3.7 futile/restart/transport-floor accounting** — signature weakening (C-MUT-A) and restart charging
  (C-MUT-B) both caught; the floor-discovery test derives the limit from the machine (P2-clean).
- **Leak hunt** — no leaked fds (per-call appendFileSync; sockets destroyed on timeout; unref'd timers); the
  lane's three files spawn no children. (Residuals: `adjudicated`/`pendingConversions` retention — IDEA-FC-2.)

**C++ router (cpp-router §6):**
- **Byte-verbatim relay** — re-serialization mutation (M-08) red across 8 cases; query strings + percent-encoding
  survive (P-01); no minted Content-Encoding (P-05). (Only unbound corner: compression re-encoding, IDEA-CPP-01.)
- **Observe-never-enforce** — the only router-minted statuses are the two 502 shapes, admission 503s, and the
  opt-in 400 (default false); no request the direct path serves becomes an error under the shipped config.
- **Mid-body truncation honesty, admission ordering laws, exactly-once ledger accounting, config validation,
  crash/teardown lifetimes** — all attacked by mutation (M-06/M-10/M-05/M-13) and swept property-style; clean.
- **Single-model pool exhaustion** — health/metrics answer at a full queue (P-02b). (The MULTI-model shape is
  NOT cleared → ISSUE-042.)

**Vocabulary / drift guards that held (sweep-vocabulary §6):**
- Run/Item state single-source (schema-enum equality, both directions); tool inventory (22, plugin derives its
  map); `verify-running-<tree>` (single composition point, C-081 held); UNIVERSAL_META_TOOLS (now derived from
  legalTools, C-086 held); DEFAULT_MAX_READERS cross-language pair (composition.test:823 reads python source —
  the exemplary guard); RouterConfig keys (all three languages converge on the regenerated schema); kebab agent
  names (both sides read the fragment); every persisted enum VALUE validated at write time.

**Build record (sweep-honesty §6, adapter-remainder §6, sweep-gate-mutation §6):**
- Every commitSha exists and attributes correctly; the acceptance headline reproduces; the G5 guard binds
  against its recorded forgery class (G5-M1/M2/M3); 7–8 of 8 sampled revertAssertions reproduce; the two live
  artifacts never existed; corrections numbering is contiguous; the WIRE_CONTRACT_VERIFIED stamp is triply
  pinned; forged TAP trailers cannot spoof the gate (fail-closed).

**Composition seams that held (composition §"Cleared seams"):**
- The deferred-dependency exit (correctly reaches report and closes — the correctly-handled sibling of the
  blocked case); the lone-blocked-item exit (reaches report — mislabeled `done` but not a wedge); the
  silent-wedge production reachability (all 8 setBlocked sites mint a question first, clear-first ordering, so
  COMPOSITION-002's exact state is a latent landmine, not a live wedge); the futile-counter mechanics (the noop
  is not a false wedge — the run genuinely made no progress).

---

## 12. MERGE NOTES

### 12.0 Provenance of this document

This document was **completed by a continuation agent** after the original merge agent was killed by an API
failure mid-write. Because the predecessor wrote skeleton-first and appended continuously, its work survived:
**sections 1–6 (executive verdict, ISSUE register ISSUE-001…-138, IDEA register, cross-lens pointers, the
enforcement table, and the merged mutation table) are the predecessor's**, and the continuation agent did not
rewrite or reorder them. The boundary is the **end of section 6** — everything from section 7 onward
(the nine enumerations, the adversary log, the honesty audit, the coverage ledger, cleared areas, and these
merge notes) was written by the continuation agent from the same seventeen part files. The ISSUE-NNN /
IDEA-NNN numbering is inherited and final; nothing was renumbered.

### 12.1 The id mapping table (part-local id → final id)

Every part-local id maps to its final `ISSUE-NNN` (or is recorded DROPPED in §12.2). Later reviews cite through
this table. A `+` means the final entry merged multiple origins.

**state-crash:** 001→ISSUE-023 · 002→024 · 003→025 · 004→029 · 005→026 · 006→027 · (001/002/003/005/006 also
chain into ISSUE-028)

**gates-security:** 001→ISSUE-014 · 002→015 · 003→019 · 004→018 · 005→020 · 006→021 · 007→017(+COMP-INJ-011) ·
008→016

**core-logic:** 001→ISSUE-069 · 002→070 · 003→071 · 004→068 · 005→011 · 006→066(+COMPOSITION-001)

**cpp-router:** 001→ISSUE-044 · 002→042 · 003→043(+ADAPTER-REMAINDER-004) · 004→041(+FANOUT-003) · 005→045 ·
006→076(+SWEEP-ROWS-003) · 007→077 · 008→085

**fanout-concurrency:** 001→ISSUE-038 · 002→039 · 003→041(+CPP-ROUTER-004) · **004→DROPPED (§12.2)** · 005→031 ·
006→032 · 007→035 · 008→036 · 009→037 · 010→033 · 011→034 · 012→040

**tools-handlers-a:** 001→ISSUE-005(+TOOLS-B-001, via COMPOSITION-004) · 002→008(+SWEEP-ADV-001) · 003→010 ·
004→013 · 005→030(+TOOLS-B-014) · 006→063 · 007→064

**tools-handlers-b:** 001→ISSUE-005 · 002→007 · 003→049 · 004→046 · 005→047 · 006→048 · 007→051 ·
008→052(+SWEEP-ADV-003) · 009→050 · 010→053 · 011→054 · 012→055(+COMPOSITION-003) · 013→056 · 014→030 · 015→058 ·
016→059(+SWEEP-VOCAB-016) · 017→060 · 018→057 · 019→061 · 020→062

**composition-injection:** 001→ISSUE-001 · 002→001(facet, receive-review — no distinct entry) · 003→001(facet,
tdd.md-to-nobody) · 004→003 · 005→002 · 006→022 · 007→004 · 008→138 · 009→006 · 010→137 · 011→017(+GATES-SEC-007) ·
012→134 · 013→135 · 014→136
  *(Note: ISSUE-001's header lists "-002/-003/-004/-008 as facets"; that is imprecise — only -002/-003 are
  folded into ISSUE-001; -004 is ISSUE-003's origin and -008 is ISSUE-138's origin. A labeling wrinkle, not a
  lost finding.)*

**adapter-remainder-tools:** 001→ISSUE-128 · 002→129 · 003→130 · 004→043(+CPP-ROUTER-003) · 005→074(+SWEEP-HON-002
+SWEEP-ROWS-004) · 006→073(+SWEEP-HON-001) · 007→131 · 008→086

**scripts-python:** 001→ISSUE-112 · 002→112 · 003→105 · 004→106 · 005→111 · 006→107 · 007→104 ·
008→113(+SWEEP-VOCAB-007) · 009→092 · 010→092 · 011→097 · 012→099(+SWEEP-GM-011) · **013→DROPPED (§12.2)** ·
**014→DROPPED (§12.2)** · 015→108 · 016→109 · 017→110 · 018→126 · 019→127

**composition:** 001→ISSUE-066(+CORE-LOGIC-006) · 002→067 · 003→055(+TOOLS-B-012) · 004→005(unifies TOOLS-A-001+
TOOLS-B-001) · 005→028 · 006→065

**sweep-adversary:** 001→ISSUE-008(+TOOLS-A-002) · 002→009 · 003→052(+TOOLS-B-008) · 004→072

**sweep-corrections:** 001→ISSUE-100 · 002→078 · 003→103 · 004→012 · 005→079(+SWEEP-HON-005) · 006→087 ·
007→101 · 008→102 · **009→DROPPED (§12.2)** · 010→098

**sweep-gate-mutation:** 001→ISSUE-089 · 002→089 · 003→092(+SCRIPTS-009/010) · 004→094 · 005→095 · 006→093 ·
007→088(+SWEEP-VOCAB-001) · 008→096 · 009→090 · **010→DROPPED (§12.2)** · 011→099(+SCRIPTS-012)

**sweep-honesty:** 001→ISSUE-073 · 002→074 · 003→084 · 004→080 · 005→079 · 006→081 · 007→082 · 008→083 · 009→093

**sweep-rows-and-tests:** 001→ISSUE-133 · 002→075 · 003→076 · 004→074 · 005→091 · 006→132 · 007→133 ·
008→(result record, P8-clear — no defect) · 009→(result record, P12-residue — no defect)

**sweep-vocabulary:** 001→ISSUE-088 · 002→114 · 003→115 · 004→116 · 005→117 · 006→118 · 007→113 · 008→119 ·
009→089 · 010→120 · 011→121 · 012→122 · 013→123 · 014→124 · 015→125 · 016→059

### 12.2 DROPPED / UNMERGED part-local ids

These part-local findings appear in **no** register entry. They were verified absent by grep against the ISSUE
register. The predecessor either silently lost them mid-write or judged them out; either way, per the charter,
this is a finding about the merge itself. **They should be triaged into the register by a later pass.**

> **Triage completed by step 4 (findings-capability §4):** FANOUT-CONCURRENCY-004 → **ISSUE-139**;
> SWEEP-CORRECTIONS-009 / SCRIPTS-PYTHON-013 → **ISSUE-140**; SCRIPTS-PYTHON-014 → **ISSUE-141**;
> SWEEP-GATE-MUTATION-010 → folded into **ISSUE-134** as a facet. Stub records sit at the end of §2.

| Dropped id | Finding | Why it matters | Likely cause |
|---|---|---|---|
| **FANOUT-CONCURRENCY-004** | `fetchMetricsSummary` returns an unvalidated cast: any JSON object (or `[]`) becomes a `MetricsSummary`, contradicting the file's "a malformed body never reaches a consumer" comment. MINOR today (only e2e + g5 tool call it), **MAJOR the moment ISSUE-038 wires it into the report**. | A P5/P4 gap on a check that becomes load-bearing under ISSUE-038's own fix. | **Mis-attribution, not pure loss:** the merged mutation table (§6) row "delete metrics-body-object guard → DECORATIVE → ISSUE-040" is the evidence for FANOUT-004, but it is cited to ISSUE-040 (which is FANOUT-012, failover). The predecessor folded the mutation into the wrong issue and dropped the finding text. |
| **SWEEP-CORRECTIONS-009 / SCRIPTS-PYTHON-013** (one finding, filed by two parts) | `verify-acceptance.sh` still uses fixed `/tmp/accept-*.out` scratch paths — the exact concurrency class C-078 fixed in `test-conductor.sh` with `mktemp -d`+trap. Two concurrent meter runs cross-contaminate the quoted PASS/FAIL evidence. MINOR (verdicts ride exit codes; the corrupted surface is the displayed reason). | A confirmed C-074-F2/C-078 class recurrence in the build's OUTERMOST check, filed independently by two lenses and still lost. | Silent loss during merge; both origin ids record it clearly. |
| **SCRIPTS-PYTHON-014** | Two weak acceptance detectors: row 2's `SKIPPED_UNMET` fallback matches ANY task's skip record (an unrelated skip excuses a vanished bun/G14 leg); row 5's scenario check is `grep -qi` substring-anywhere (`trivial` ⊂ "non-trivial", `worktree` in dozens of titles), so a DELETED scenario whose name survives elsewhere still passes. LOW each. | P1 in the acceptance meter — the row-5 half is noted as a cross-lens pointer by two other parts but never given an ISSUE. | Silent loss during merge. |
| **SWEEP-GATE-MUTATION-010** | `test_12_1_live_stamp_and_m8` failed intermittently 3× then resisted 9+ reproduction attempts — unexplained. LOW confidence, root cause not established. | Possibly a second facet of the nondeterministic-gate finding (ISSUE-134); worth folding there or dismissing on evidence. | Plausibly INTENTIONAL (the origin marked it LOW-confidence/unexplained), but it was never dispositioned in the register — record it so the decision is explicit. |

**Not dropped, recorded for completeness:** SWEEP-ROWS-AND-TESTS-008 and -009 are explicit *sweep-result
records* (P8-clear; P12-residue = the live legs already owed by ISSUE-075/076), not defects — correctly absent
from the ISSUE register. Also `C-087`'s serve.py `log_handle` fd leak is a recorded-deliberate known-open
carried by the build; sweep-corrections/scripts-python noted it but did not re-file it, which is correct.

### 12.3 Deduplication, severity reconciliation, and contradictions resolved

**What was deduped** (≈37 part-local findings merged into fewer register entries — the register's own count):
the largest merges are ISSUE-005 (unifies TOOLS-A-001 + TOOLS-B-001 + COMPOSITION-004 — one meta-tool-legality
hole, one fix), ISSUE-028/COMPOSITION-005 (chains STATE-CRASH-001/002/003/005/006 into the reachable
double-writer→seq-collision→wrong-publish path), ISSUE-088 (SWEEP-GM-007 + SWEEP-VOCAB-001, the stripComments
blinding found from two directions), ISSUE-030 (TOOLS-A-005 + TOOLS-B-014, the abandonment fence), ISSUE-066
(CORE-LOGIC-006 + COMPOSITION-001, blocked-dep noop), ISSUE-052 (TOOLS-B-008 + SWEEP-ADV-003, defer forges
human), ISSUE-074 (three parts on the G5 consistency-not-provenance residual), ISSUE-076 (CPP-ROUTER-006 +
SWEEP-ROWS-003, the two undischarged 11.8 rows), ISSUE-092 (SCRIPTS-009/010 + SWEEP-GM-003, the M5 holes).

**Severities reconciled.** Where a subsystem lens and a sweep rated the same finding differently, the register
took the sharper reachability framing: ISSUE-042 (cpp-router MAJOR-as-liveness-inversion / MINOR-in-shipped —
kept as MAJOR with the shipped-config caveat named); ISSUE-002 (rated CRITICAL for operability but explicitly
"fail-closed so not a security hole"); ISSUE-072 (minor-to-major kept as a range because impact depends on
model behavior — the point of the finding); ISSUE-050 (MAJOR under `worktrees`, default is `off` — scoped in
the title). The two CRITICALs (ISSUE-001, -002) were rated so by their origin lens and unchanged.

**Factual contradictions resolved:**
- **C-030 E12 (ISSUE-012).** The build recorded this refuted 2/2; sweep-corrections re-litigated at HEAD and
  showed the refutation was procedural ("the stronger panel governs"), not substantive — `planning.ts:378`
  counts `fileScope.length`, a pure module cannot count expanded files, and `["src/**"]` counts 1. **Side
  taken: the finding is live; the refutation does not discriminate.** Recorded as P10 in ISSUE-012.
- **Task 11.5 revertAssertion (ISSUE-090).** The record names the outer `burst_->priority==eligible` guard as
  the killing mutation; sweep-gate-mutation applied it exactly and ctest stayed 100% green, and `git show`
  proved the inner filter subsumed it at the 11.5 commit. **Side taken: the record is wrong; the property is
  covered by the INNER-filter mutation, which does go red.**
- **e2e blanket-deny (ISSUE-091).** sweep-corrections and sweep-rows both hit the "e2e 35/35 under a
  deny-everything gate" result; sweep-corrections' refutation showed the property IS caught one seam below
  (composition-root 5/27, gate-wiring 9/12). **Side taken: true at e2e scope, contained at repo scope — filed
  as MINOR-to-MAJOR per the weight the 13.1 ledger puts on "the e2e proves the whole system".**
- **stripComments blast radius (ISSUE-088).** sweep-gate-mutation and sweep-vocabulary independently measured
  the blanked spans (tools.ts 9104–9254 and 8405–8488; gates-edit.ts 208–434) and agreed the real
  `config.updated` call site at tools.ts:9233/9236 is invisible; the two line numbers (9233 vs 9236) are the
  same call site read at statement vs argument line. No contradiction; merged.

### 12.4 What the seventeen parts did NOT cover between them

- **`dashboard/ledger_view.hpp` and `dashboard/main.cpp`** — examined by nobody (§10.7). Outside the named
  scope, so they do not fail the UNOWNED-FILES assertion, but they are genuinely unreviewed production C++
  (1,077 lines) whose only touchpoint is `dashboard_test.cpp`, read at title depth. **The single real coverage
  gap in the whole review.**
- **fetch_models.py / benchmark.py download-validate-resume half** — read but not executed (ISSUE-109); five
  latent defects flagged lower-confidence, none reproduced.
- **The live/system G5 legs** — leg B (real provider traffic through the router) and leg C (mid-run kill,
  hostile router, supervisor restart) are covered by unit stubs only; the live rows are owed by ISSUE-075/076
  and cannot be discharged without a live model (13.2/14.2, deliberately unscheduled).
- **opencode's provider error path** — the runtime behavior on an admission 503 (ISSUE-041) is argued
  structurally, not observed against a live opencode.
- **Clause-by-clause plan conformance for §5 (the wire contract) and §7 (logging)** — sampled via the cited
  ranges each finding needed, not swept exhaustively; the sweeps deferred full plan conformance to the
  subsystem lenses.

### 12.5 Coverage-assertion outcome (mechanical)

Performed as the charter mandates, not by impression:
1. `git ls-files` over `conductor/{core,adapter,plugin,tools}/`, `router/`, `scripts/`, excluding
   `conductor/tests/`, `router/tests/` (the router's analog of `conductor/tests/`, 9 `.cpp` files — excluded
   from the "production file" count but explicitly in the cpp-router part's scope and read by it), and
   non-source (`.md`/`.json`), yields **60 production files** (17 core + 14 adapter + 1 plugin + 4 tools +
   9 router + 15 scripts; the two test_*.py are counted here as scripts and ARE covered by scripts-python).
   [Preflight correction 2026-08-16: was "59", contradicting this line's own breakdown; `git ls-files`
   re-verified 60, and the router/tests/ exclusion was previously silent.]
2. The union of the seventeen part coverage ledgers (§10) touches every one of those 60 files.
3. **UNOWNED FILES = ∅.** The predecessor's executive-verdict claim ("the UNOWNED FILES list for that scope is
   empty") is therefore **correct**; no edit to sections 1–6 is required, and none was made.

The only unreviewed production code (`dashboard/*`) sits outside the asserted scope and is disclosed in §10.7
and §12.4 so the gap between reviewers is visible rather than hidden.

