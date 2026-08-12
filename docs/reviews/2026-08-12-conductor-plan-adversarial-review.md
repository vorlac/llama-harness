# Adversarial review — conductor harness plan

**Target:** [docs/plans/2026-08-07-conductor-harness-plan.md](../plans/2026-08-07-conductor-harness-plan.md) (2,325 lines, revision after 4 internal review rounds)
**Reviewer:** Claude Opus 5, single-pass full-document read
**Date:** 2026-08-12
**Mandate:** recon only. Nothing in the plan has been changed. This document records findings and a proposed remediation order; it applies none of it.

---

## How to read this

The plan has already survived four internal adversarial rounds (§14: 29 → 9 → 3 → 4 upheld findings), and it shows — the easy inconsistencies are gone. What is left is a different class of defect:

- **things the plan assumes about the outside world** (Node's test discovery, opencode's streaming behaviour, llama-server's slot count) that no task verifies before something depends on them;
- **things that are specified everywhere except where they are defined** — states, ledgers and tools that are referenced by four sections and created by none;
- **claims that two sections make in mutually exclusive ways**, where each section reads fine in isolation.

The plan's own §14 closing note is relevant here and I want to reinforce it: *"the Round-4 fixes have not themselves been re-reviewed."* Several of my highest-severity findings land squarely on the Round-3/Round-4 quarantine and targeting machinery, which is exactly where the plan's author predicted residual risk.

**Severity meanings used below:**

| Level | Meaning |
|---|---|
| **CRITICAL** | The system as specified cannot complete an ordinary task, or a core safety mechanism does not work. Must be resolved before the affected phase is built. |
| **HIGH** | Real correctness, safety, or measurement-validity problem. The build proceeds, but the result is wrong, unsafe, or unmeasurable. |
| **MEDIUM** | Genuine gap or ambiguity that will cost the implementing agent a wrong guess and a rework cycle. |
| **LOW** | Cosmetic, editorial, or minor inconsistency. |

**Confidence** is stated per finding. Where a finding depends on runtime behaviour I have not executed (marked *needs verification*), I say so rather than asserting it. Those are still worth reading — an unverified assumption load-bearing in a plan is itself the finding.

---

## Summary of findings

| ID | Severity | Area | One-line |
|---|---|---|---|
| C1 | CRITICAL | §3.3, Task 6.1 | Greenfield TDD is structurally impossible: the first red for a new module is an import error, which the plan classifies as an illegal red |
| C2 | CRITICAL | §2.3–2.5, §2.9, §3.4 | "Blocked", "deferred", and "surfaced question" are load-bearing everywhere and defined nowhere — no schema, no field, no writer, and one stuck item guarantees a report-less run |
| C3 | CRITICAL | §3.5, §4.2 | Freeze gate and wave overlap contradict each other: the quarantine's safety argument requires blocking exactly the concurrent test-writing that §4.2 sells as the main parallelism win |
| C4 | CRITICAL | §4.2, §4.3, Task 6.1/9.6 | Quarantined test files and worktree checkouts stay *inside the repo*, so a whole-tree test runner re-discovers them — defeating the quarantine and double-running worktree tests |
| C5 | CRITICAL | §3.3, §3.5 | The test-adequacy review lens is mandatory, but the only agent allowed to act on its findings cannot edit test files — the fix loop deadlocks by construction |
| C6 | CRITICAL | §3.4, §4.2, §4.3 | The central execution loop is ambiguous: what `conductor_dispatch_wave` actually dispatches, who advances item stages, and how cross-item overlap happens without the model emitting parallel tool calls |
| C7 | CRITICAL | §2.4, §2.10, §3.2 | The trivial path synthesizes an item that cannot satisfy the queue schema; and no classification produces a legal path for a non-testable change (docs, comments, renames) |
| H1 | HIGH | §1.2, §3.2, §4.2 | Runs are per-prompt but the repo is not: a previous run's abandoned red tests poison every subsequent run's verify, and nothing cleans them up |
| H2 | HIGH | §3.5 | The git deny matrix has no default disposition and omits several file-writing / destructive subcommands, including `git apply` |
| H3 | HIGH | §3.5, §5.1, §6.4 | Three silent-bypass paths: unregistered sessions, plugin init failure, and a plain `opencode` session in the same repo |
| H4 | HIGH | §3.3, Task 9.5 | No clean-tree precondition: publish stages by glob and will sweep the user's unrelated uncommitted work into a conductor commit |
| H5 | HIGH | §3.5, §2.6 | Branch movement is explicitly allowed and never re-checked, so an item can be validated on one branch and published on another |
| H6 | HIGH | §3.6 | `conductor_override` has no per-run cap, so a weak model can degrade every gate to advisory while leaving only a paper trail |
| H7 | HIGH | Phase 14 | The POC comparison is confounded (different model mixes), unreplicated (n=1 per cell), and has no doctrine-only control — it cannot support the conclusion it exists to produce |
| H8 | HIGH | §4.1, §4.4, serve.py | Role→model config is never validated against what is actually served; sequential-stage swap thrash is unaddressed; read fan-out may be serialized by a slot count `serve.py` never sets |
| H9 | HIGH | §0.3, §4.4, G5 | The router's schema guard is fail-*closed* inside a layer declared fail-soft, and is inert for streaming traffic — weakening both of layer 2's stated justifications |
| H10 | HIGH | G1/G2, Phases 1–12 | Every adapter is tested only under Node, but runs in production under opencode's Bun runtime; first real Bun execution is Phase 13 of 15 |
| M1 | MEDIUM | §3.3, §2.5 | `DEBUG` and `BLOCKED` appear in the item diagram and prose but not in the item state vocabulary or the item schema |
| M2 | MEDIUM | §2.5, §2.6, §7.2 | `evidence.red.seq` conflates two independent sequence spaces (journal seq vs evidence seq) |
| M3 | MEDIUM | Task 1.1, Task 11.6 | Two different JSON-Schema validators (hand-rolled TS subset vs full C++ validator) judge the same payloads with different strictness |
| M4 | MEDIUM | §4.3, Task 6.1 | "Validate is serial per tree" has no enforcement — the behaviour of a second `conductor_validate` against a live marker is unspecified |
| M5 | MEDIUM | §3.3, Task 9.5 | Publish's auto re-verify has no failure path |
| M6 | MEDIUM | §2.9, §3.2 | Non-`done` stops write no report; the only human-readable artifact is produced by the one exit path a stuck run cannot reach |
| M7 | MEDIUM | §2.10, Task 1.1 | The classification skeptic-check output has no named schema |
| M8 | MEDIUM | Tasks 9.4, 9.5 | Two tasks bundle 6 and 5 tools respectively with ~15 asserted behaviours each — violating the bite-size rule the plan imposes on the model |
| M9 | MEDIUM | §1.2, §3.2, Task 12.2 | Non-git workspaces are unhandled, though opencode is routinely run in them |
| M10 | MEDIUM | §4.2 | Quarantining an item's whole test *file* silently deletes unrelated passing coverage from that verify — a false green |
| M11 | MEDIUM | §3.4, Task 12.2 | `conductor_setup` is legal only while config is absent, so there is no supported way to reconfigure a repo |
| M12 | MEDIUM | §2.1, §2.2, §7.1 | No retention policy for `.conductor/`; `trace` journals include full sub-session transcripts, in the user's repo, forever |
| M13 | MEDIUM | §4.1, §2.1 | `config.models` holds bare model ids; the SDK needs `{providerID, modelID}` and the mapping is never specified |
| L1–L8 | LOW | various | Editorial and consistency nits, listed at the end |

---

# CRITICAL findings

## C1 — Greenfield TDD cannot produce a legal red

**Where:** §3.3 (PENDING→RED), §2.6 (`failureClass`), Task 6.1 (failure classification regex), Task 13.2 (the live smoke prompt).
**Confidence:** Very high for Node/Python; high for Go/C++ by the same mechanism.

**What the plan says.** `conductor_submit_test` requires the harness's own run of the new test to exit non-zero **with `failureClass: "assertion"`**. §3.3 is explicit that "an import error, collection error, or syntax error is NOT red (the test never evaluated the behavior)". Task 6.1 pins the classifier's default: stderr matching `SyntaxError|Cannot find|ImportError|collection error` ⇒ `"error"`. A test that produces `"error"` is bounced back to the test-writer, bounded at 3 attempts, then the item is BLOCKED.

**Why this is a problem.** For any item that creates a *new* module — the most common shape of TDD work — the first failing test necessarily imports something that does not exist yet:

```js
import { slugify } from '../src/slugify.ts';   // ERR_MODULE_NOT_FOUND: Cannot find module …
```

Node emits `Cannot find module`. Python emits `ModuleNotFoundError` (a subclass of `ImportError`, and pytest reports it as a collection error). Go fails to build the package. C++ fails to compile. In every one of these the plan's own default regex classifies the result as `"error"`, i.e. **not a legal red**.

The test-writer cannot fix it, because the fix is to create the production module — and the edit-scope gate confines the test-writer to the item's `testScope` (§3.5). So the repair loop runs three impossible attempts and blocks the item.

**Concrete failure.** Task 13.2's own live-smoke prompt is *"add a slugify util with tests"*. That is a greenfield item. Under the spec as written, it blocks at the first state transition and the smoke test cannot pass.

**Why it survived four review rounds.** The rule is correct in the case it was written for — a test that fails because someone broke an import is not evidence about behaviour. The rule is only wrong for the *subject-does-not-exist-yet* case, which is the normal case in TDD, and the two are easy to conflate when reading the rule in isolation.

**Shape of a fix (not applied).** Introduce a third failure class, e.g. `failureClass: "missing-subject"`, which is a **legal** red if and only if the unresolved module/symbol named in the failure output resolves to a path inside the item's declared `fileScope`. Everything else stays illegal. This preserves the rule's intent exactly (the failure must be *about this item's subject*) while unblocking greenfield work. Alternative, weaker: let the test-writer create empty stub files inside `fileScope` — but that leaks production-file authorship into the test-writer role and muddies who wrote what.

---

## C2 — "Blocked", "deferred" and "surfaced question" have no representation

**Where:** §2.3 (run.json), §2.4 (queue.json), §2.5 (item.json), §2.9 (stop kinds), §3.2 (plan-review cap), §3.3 (test-repair exhaustion, BLOCKED escalation), §3.4 (`conductor_surface`), Task 1.3 (`shouldTerminate`'s `itemsSummary`), Task 9.5 (report refusal rule).
**Confidence:** Very high — this is a pure document-internal check.

**What the plan says.** Blocked-ness and surfaced questions are referenced constantly:

- §2.9: stop kind `blocked` = "every remaining item blocked"; stop kind `surfaced` = "only human-territory questions remain".
- Task 1.3: `shouldTerminate(run, counters, itemsSummary, config)` where `itemsSummary = {open, blocked, surfacedQuestions}`.
- §3.2: at the plan-review round cap, "surviving majors become surfaced questions — the run proceeds only on items no major touches; **the rest block**".
- §3.3: test repair exhausted "then BLOCKED"; implementer escalation ends "surfaced to the human".
- §3.4: `conductor_surface {question, blocksItems[]}` "records question, blocks items, continues rest".
- Task 9.5: report "refuses while an item is unpublished-and-unblocked".
- §3.2 REPORTED: report requires every item "PUBLISHED, or blocked/deferred with reason".

**What is missing.** All three concepts are undefined:

1. **No item field.** §2.5's item schema has `state`, `assignee`, `worktree`, `attempts`, `evidence`, `taint`, `inlineClaim`. There is no `blocked` flag, no `blockReason`, no `deferred`. §3.3's item state vocabulary (`PENDING…PUBLISHED`) contains no BLOCKED state, and §14 explicitly refutes making it one ("blockage lives on the run/queue").
2. **But it does not live on the run or queue either.** §2.3's run.json has `state`, `classification`, `planReviewRounds`, `stop`, `counters` — no blocked set. §2.4's queue.json is a list of items with no status fields.
3. **No surfaced-question ledger exists.** §1.2 lists the run directory contents: `run.json`, `queue.json`, `items/`, `plan.md`, `report.md`, `journal.jsonl`, `evidence.jsonl`, `decisions.jsonl`, `anomalies.jsonl`, `reviews/`. There is no `questions.jsonl`. §2 defines no surfaced-question schema. Task 1.1's schema list (Config, RouterConfig, Run, Queue, Item, Evidence, Decision, Anomaly, Findings, Verdict, Classification, TestVet, ImplementerResult, JournalRecord) does not include one.
4. **No tool marks an item deferred.** `conductor_surface` blocks items; nothing defers them, yet report accepts "deferred with reason" as a terminal disposition.

**Why this is critical, not merely untidy.** It creates a guaranteed deadlock with no exit that produces a report:

1. An item blocks (say, via C1, or a genuine BLOCKED escalation).
2. `conductor_report` refuses, because the item is "unpublished-and-unblocked" — the handler has no field to read that would tell it the item *is* blocked.
3. The continuation engine re-prompts. The run-state signature does not change, because nothing can change it.
4. Three futile re-prompts → stop `noop` + `disengage` anomaly.
5. Stop `noop` writes **no report** (see M6). The user gets a silent run, a half-modified repo, and a journal.

`shouldTerminate` is also uncomputable as specified: it takes `itemsSummary.blocked` and `itemsSummary.surfacedQuestions` as inputs, and nothing in the state store can produce either number.

**Shape of a fix.** Add to §2.5: `"blocked": null | {reason, sinceMs, questionId?}` and `"deferred": null | {reason}`. Add `runs/<runId>/questions.jsonl` to §1.2 with a schema in §2 (id, question, askedBy, blocksItems[], humanTerritory verdict, answeredIso?, answer?) and to Task 1.1's list. Give `conductor_surface` and the BLOCKED escalation an explicit writer role for both. Add a `conductor_defer {itemId, reason}` tool or state that report accepts. Then Task 1.3's `itemsSummary` becomes derivable and the report deadlock disappears.

---

## C3 — The freeze gate and the wave-overlap story are mutually exclusive

**Where:** §3.5 (edit-scope gate, freeze bullet), §4.2 (`parallel.writes: "off"` paragraph and the quarantine rule), §4.3 (parallelism table).
**Confidence:** High — this is an internal contradiction, though which side is "intended" is genuinely unclear.

**Side A — §4.2 sells concurrent test-writing as the main payoff of the default mode:**

> `parallel.writes: "off"` (POC default): one item holds write access at a time; **other wave members may still run their RED stage (test-writing touches disjoint test paths)** and all read stages. This alone yields large overlap: item B's test is being written and vetted while item A implements.

§4.3's table repeats it: test-writing (RED) fans out wave-wide.

**Side B — the quarantine's safety argument requires the opposite.** §4.2's quarantine rule moves *other items' testScope files* aside for the duration of a verify, and justifies the safety of that move like this:

> the freeze gate already denies edits during the verify, so the move cannot race a writer.

That argument is only sound if the freeze gate blocks **test-file** edits. But if freeze blocks test-file edits, then item B's test-writer is denied for the entire duration of item A's `conductor_validate` — which is precisely the overlap Side A advertises.

**Additionally, §3.5's own wording is ambiguous on the point:** it says "deny any **source** edit while a verify is in flight in the same tree". Whether a test file is a "source edit" is never defined anywhere in the document. The word "source" is used elsewhere (G8: "the orchestrator does not write code"; §3.5: "Orchestrator session: deny ALL source edits") in a sense that reads like *production code*, which would exclude tests — and that reading breaks the quarantine's safety proof.

**Concrete failure (either way you resolve it):**

- *If freeze excludes tests:* item A's `runVerify` moves item B's `tests/b.test.ts` into the quarantine directory at the same moment B's test-writer sub-session writes to that path. Outcomes range from the writer recreating the file mid-verify (poisoning A's verify — the exact hazard the quarantine exists to prevent) to the restore step clobbering B's newly written test with the stale quarantined copy. Silent data loss of model-generated work, and a non-deterministic verify.
- *If freeze includes tests:* the sub-session is dispatched, works for a while, and gets an exception on its first write. Nothing in the plan queues or retries a freeze denial, and nothing in the fan-out engine consults freeze state before dispatching. The dispatch is simply wasted, and the item's `attempts` counter burns. Meanwhile the advertised overlap does not exist, and the default mode's parallelism claim in §4.2/§4.3 is wrong.

**Third, unaddressed hazard.** The fan-out engine (Task 7.1) has no notion of freeze at all. Even in the "freeze includes tests" reading, nothing *prevents* a test-writer being dispatched into a frozen window; the gate just denies it later. Scheduling and gating are not connected.

**Shape of a fix.** Decide explicitly and state it in one place: (a) the freeze gate covers *all* edits in the tree including tests, (b) the fan-out engine must not dispatch write-capable sub-sessions into a tree with a live verify marker (it should hold the job until the marker clears), and (c) §4.2/§4.3's overlap claims must be rewritten to describe what actually overlaps under that rule (read stages across items, plus test-writing only outside verify windows). Alternatively, make the quarantine copy-and-restore-by-content with a hash check rather than move-and-restore, and allow test edits — but then §4.2's safety sentence must be replaced with a real argument.

---

## C4 — Quarantined files and worktrees stay inside the repo, where the test runner finds them

**Where:** §4.2 (quarantine), §1.2 (`.conductor/` layout), §4.2/Task 9.6 (worktrees at `.conductor/state/worktrees/<itemId>`), Task 6.1 (`runs/<id>/quarantine/`).
**Confidence:** High on the mechanism; *needs verification* on the exact discovery behaviour of each runner.

**What the plan does.** Two mechanisms relocate or duplicate test files *within the repository working tree*:

1. **Quarantine** — `runVerify` moves other items' deliberately-red test files into `.conductor/runs/<runId>/quarantine/` for the duration of the verify, then restores them.
2. **Worktrees** — under `parallel.writes: "worktrees"`, each implementer gets a full second checkout of the repo at `.conductor/state/worktrees/<itemId>/`.

**Why both are hazardous.** The verify command is the *target repo's own* test command (§9.7: "Verify trusts the target repo's own test command"), and the plan's own defaults are whole-tree discovery commands: `node --test`, `pytest`, `go test`, `ctest`. These discover tests by walking the tree from the working directory.

- **The quarantine may not quarantine anything.** If the runner walks into `.conductor/`, the moved-aside red test is still discovered and still fails — the verify is poisoned exactly as before, and the whole Round-3/Round-4 centrepiece is a no-op. Node's runner skips `node_modules`; whether it skips dot-directories is version-dependent and I have not verified it for the Node 26 in use here. `pytest` collects from dot-directories only in some configurations; `go test ./...` skips directories beginning with `.` or `_` (so Go is probably safe); `ctest` runs a registered test list and is unaffected. **The mechanism's correctness is currently a per-runner accident, and no task tests it.**
- **Worktrees are worse and more certain.** A worktree is a complete second copy of the repo, including *every* test file. A whole-tree runner in the main tree will discover and execute the worktree's copies — doubling runtime at best, and at worst failing the main tree's verify because the worktree copy contains item I2's deliberately-red, in-progress test. This is not an edge case: it is what happens on the first `conductor_validate` after any worktree is created.

**Compounding:** `.conductor/` is registered in `.git/info/exclude`, so **git** ignores it. Nothing tells the *test runner*, the linter, the formatter, or the build system to ignore it. The plan treats git-invisibility as if it were tool-invisibility.

**Concrete failure.** Repo with `node --test` as the unit scope. Item I1 validates; item I2 sits at RED with `tests/i2.test.ts` deliberately failing. Quarantine moves it to `.conductor/runs/r-…/quarantine/i2.test.ts`. If Node's discovery descends into dot-directories, `node --test` finds it there and I1's validate goes red anyway — with a confusing failure path that names a directory the user has never seen.

**Shape of a fix.** Put the quarantine **outside the repository** (a temp dir keyed by run id) so no in-repo runner can see it; the restore manifest already handles crash recovery and works identically. For worktrees, either place them outside the repo (`git worktree add` accepts any path — this is the cheap fix) or require the verify command to exclude them and prove it in Task 9.6. Add a Task 6.1 test that asserts a quarantined file is *provably not executed* under each supported default runner — the plan already asks for a "witness" test but only in the abstract, not per runner.

---

## C5 — Mandatory test-adequacy findings are unfixable by the only agent allowed to fix them

**Where:** §3.3 (VALIDATED→REVIEWED lens list and fix routing), §3.5 (edit-scope gate role rules).
**Confidence:** Very high — both halves are stated explicitly.

**Half one.** §3.3 lists the item-review lenses and marks the first five **mandatory, never truncated by configuration**. The fourth is **test-adequacy**: "does the test still honestly pin the change now that the impl exists". Its findings, by definition, require editing *test* files.

**Half two.** §3.3 routes surviving findings this way: "surviving findings go back to the **implementer** (doctrine `receive-review.md` …)". And §3.5's edit gate says: "Implementer/test-writer sessions: allow only paths matching the assigned item's `fileScope` (test-writer: the item's `testScope` only)."

An implementer therefore cannot touch test files. A surviving test-adequacy finding routes to an agent that is gated out of fixing it.

**Concrete failure.** Reviewer (test-adequacy lens) finds: "the test asserts `result != null` but the acceptance criterion requires the specific `ParseError` type — the test would pass against a wrong implementation." Two skeptics uphold. The finding routes to the implementer. The implementer tries to strengthen the assertion in `tests/parser.test.ts` → **denied by the edit gate, naming `fileScope`**. Its only legal moves are to change production code (which cannot satisfy the finding) or to report BLOCKED. The review loop re-runs, the same finding is re-derived, `reviewMaxRounds` is exhausted, and the item exits to a surfaced question — which, per C2, has nowhere to live.

**Aggravating factor.** This burns three full review rounds (six-lens fan-out plus skeptics each time) before failing — the most expensive failure mode in the system, on a mandatory lens, for a class of finding that will be common precisely because the test was written before the implementation existed.

**Shape of a fix.** Route findings by lens: test-adequacy (and any finding whose `suggestedFix` touches a path in `testScope`) goes to a **test-writer** dispatch, not the implementer; and after any test change, the item must re-enter the vet/red discipline rather than jumping straight back to validate (otherwise a reviewer can quietly weaken a test to make an item pass — the exact shortcut §0.1(6) exists to prevent). This needs its own small sub-loop specified in §3.3.

---

## C6 — The central execution loop is ambiguous: nobody knows who drives an item

**Where:** §3.4 (`conductor_dispatch_wave` row), §4.2, §4.3, §3.1 ("the ONE legal next tool"), §0.2 (the anti-dependency on parallel tool calls), Task 3.2, Task 9.4.
**Confidence:** High. Two readings are each supported by different parts of the document and they imply very different implementations.

**The two readings.**

- *Reading A — dispatch_wave is a marker.* §3.4 says it "computes next wave (§4.2), dispatches items" and moves items "PENDING→(in flight)". The per-stage tools (`conductor_submit_test`, `conductor_vet_test`, `conductor_mark_green`, `conductor_validate`, `conductor_item_review`, `conductor_publish`) each take `{itemId}` and are called by the orchestrator model, one per turn. Under this reading, dispatch_wave just tells the orchestrator which items it may work on.
- *Reading B — dispatch_wave owns the lifecycle.* §4.2 and Task 9.6 have dispatch_wave creating worktrees for wave implementers, which is a lifecycle responsibility, and §4.2's claim that "item B's test is being written and vetted while item A implements" requires *something* to be running two item pipelines concurrently.

**Why the ambiguity is fatal rather than cosmetic.**

1. **Under Reading A, the advertised overlap cannot happen.** A single opencode session executes its tool calls sequentially within a turn-based loop. For item B's test-writing to overlap item A's implementation, the orchestrator model must emit concurrent tool calls — and §0.2 states plainly that the design deliberately does *not* depend on that: "fan-out does not depend on the model emitting parallel task calls." Item-level overlap, under Reading A, depends on exactly the thing the design says it refuses to depend on. So §4.2's headline benefit for the default mode ("this alone yields large overlap") is unsupported.
2. **Under Reading B, the tool inventory is wrong.** If dispatch_wave drives items to completion internally, then `conductor_submit_test`/`vet_test`/`mark_green`/`validate`/`item_review` are not orchestrator-callable state-machine steps at all — they are internal functions, and §3.4's inventory, §3.1's FSM-advanced-only-by-tool-calls claim, and Task 3.2's legality tests all describe a different system.
3. **Either way, "the ONE legal next tool" breaks.** §3.1, §6.4, and Task 8.2 all assert that the injection names *the one legal next tool*, derived from `legalTools`. With a two-item wave, `legalTools` legalizes at least `conductor_submit_test {I2}` and `conductor_mark_green {I1}` simultaneously — plus `conductor_decide`, `conductor_surface`, and `conductor_status`, which Task 3.2 says are legal in every non-terminal state. There is no "one legal next tool"; there is a set. The injection's most important line is under-specified, and Task 8.2's test ("next-tool line matches gates-phase for three run states") is written as if a single value exists.
4. **Interleaving policy is entirely absent.** Given a legal set, nothing says whether the orchestrator should depth-first one item to PUBLISHED or breadth-first across the wave. This materially changes model-swap counts (see H8), quarantine membership, and wall-clock — the three things the POC measures.

**Shape of a fix.** Choose Reading B for anything that must overlap, and say so: `conductor_dispatch_wave` runs an internal per-item driver loop (the fan-out engine already has the concurrency machinery), while the per-item tools remain callable for the single-item and inline-claim cases. Then rewrite §3.1's "one legal next tool" as "the next legal action set, with a recommended action" and update Task 8.2/3.2's tests accordingly. Whatever is chosen, §3.4, §4.2, §4.3, §6.4 and Tasks 3.2/8.2/9.4 must all be updated together — this is currently the single largest coherence risk in the document.

---

## C7 — The trivial path cannot build a valid item, and non-testable work has no path at all

**Where:** §3.2 (INTAKE, trivial branch), §2.10 (CLASSIFICATION schema), §2.4 (queue item schema), §3.3 (item FSM), §2.1 (`behavioralPaths`).
**Confidence:** Very high on part (a); very high on part (b).

### (a) The synthesized trivial item cannot satisfy the queue schema

§3.2: on a `trivial` verdict, "the handler synthesizes a one-item queue from the classifier's `proposedFileScope`/`proposedTestScope`".

The CLASSIFICATION schema (§2.10) carries exactly: `kind`, `rationale`, `confidence`, `proposedFileScope`, `proposedTestScope`.

The queue item schema (§2.4) *requires*: `id`, `title`, `rationale`, `fileScope`, `testScope`, `acceptance` (observable checks), `dependsOn`, and a `ponytail` block with `necessary`, `reuse`, and `ladderRung`.

So the handler is asked to synthesize `title`, `acceptance`, `necessary`, `reuse`, and `ladderRung` out of nothing. Either it fabricates them — which makes the ponytail record (whose entire purpose per §6.3 is "you must show you looked") a lie on every trivial run, and makes `acceptance` unusable by the TEST_VET lens "pins THIS item's acceptance" — or the synthesized item fails Task 1.1's own schema validation and the trivial path dies at its first write. Task 9.1's test only asserts that the item is synthesized with scopes, so the gap would survive into implementation.

### (b) There is no legal path for a change that cannot have a test

Every item, trivial or not, must pass PENDING→RED, which requires a test that fails with `failureClass: "assertion"` (§3.3). Consider ordinary prompts:

- "fix the typo in this comment"
- "rename `cfg` to `config` in this module"
- "update the README install section"
- "reformat this file"

None can produce a failing assertion. The classifier's only categories are `question`, `trivial`, `work` — and `trivial` does not skip the item FSM (§3.2 is emphatic: "the item FSM itself … is NEVER skipped; trivial compresses fan-out width, not process"). So all four prompts run three impossible test-writing attempts, block the item, and land in the C2 deadlock. The only escape is `conductor_override` — which taints the item and pollutes the report for work that was never suspect.

**The plan half-knows this.** §2.1 defines `verify.behavioralPaths` ("globs whose changes owe verification"), which presupposes that non-behavioural changes exist and are exempt from something. But `behavioralPaths` is consumed only by the freshness rule (§2.6). Nothing in the item FSM consults it. The concept exists in the config and is missing from the state machine.

**Shape of a fix.** Add a fourth classification, or an item-level flag `behavioral: false`, whose FSM path is `PENDING → GREEN → VALIDATED → REVIEWED → PUBLISHED` (skipping RED/TEST_VETTED, keeping full verify and review). Gate it mechanically: an item may be non-behavioural only if *every* path in its `fileScope` falls outside `behavioralPaths` — so the model cannot use it as a TDD escape hatch for real code. That is a small, checkable rule that closes the hole without weakening the iron law where it matters. Separately, the trivial-synthesis gap needs either a richer CLASSIFICATION schema (title/acceptance/ponytail fields required for a trivial verdict) or a cheap `mechanical`-role synthesis dispatch that produces a real §2.4 item.

---

# HIGH findings

## H1 — Runs are ephemeral; the repository is not

**Where:** §0.5 ("The queue is per-prompt and ephemeral"), §1.2, §3.2 (run creation), §4.2 (quarantine membership).
**Confidence:** High.

The quarantine rule was widened in Round 4 to cover "the testScope files of every OTHER **queue item** whose state is below GREEN" — i.e. every item *in the current run's queue*. But the abandoned red tests of a **previous** run are still sitting in the working tree, and they are not in the current run's queue.

**Concrete failure.** Run 1 decomposes into I1, I2. I1 publishes. I2 blocks at RED with `tests/i2.test.ts` failing on purpose. Run 1 stops (`noop` or `blocked`). The user types a new prompt. Run 2 is created, decomposes, gets to `conductor_validate` for its own first item — and the full scope verify runs the *previous run's* deliberately-red test. Verify goes red. The item drops to the DEBUG protocol, which will chase a "bug" that is a stale artifact of run 1, burn `debugFixCap` fixes, and escalate an architecture question about code it never wrote.

**Related gaps:** nothing cleans up abandoned red tests; nothing warns the user they exist; nothing reports them (per M6, a non-`done` stop writes no report at all); and `current-run.json` archival on non-`done` stops is unspecified. The system is designed as if each prompt starts from a clean repo, and after the first blocked item it never does again.

**Shape of a fix.** Persist a cross-run "known deliberately-red test files" list at `.conductor/state/`, populated when an item is abandoned below GREEN and cleared when the item's test is eventually satisfied or the user discards it; feed it into every `excludeTestFiles` computation. Surface it loudly at the start of each new run ("3 test files from earlier runs are still red and are being excluded from verification") — because silently excluding them is its own hazard.

---

## H2 — The git deny matrix has no default and omits file-writing subcommands

**Where:** §3.5 (git policy table), Task 5.1 (the test matrix).
**Confidence:** High.

The table enumerates dispositions for status/log/diff/show/branch/ls-files/rev-parse, add/mv/rm/stash-push, commit, push, reset/rebase/filter-branch/config/clean/merge/cherry-pick/revert/am, checkout/switch/restore forms, branch deletions, and force-push refspecs. It never states **what happens to a git subcommand that is not in the table**.

For a gate that is the enforcement mechanism for a documented safety property, a missing default is a hole, not a detail. The implementing agent will pick one, and both choices are bad:

- *Default allow* → the following are permitted, and several of them write files or destroy state: `git apply` (**writes arbitrary files, completely bypassing the edit-scope gate** — this is the serious one), `git worktree remove --force`, `git update-ref`, `git symbolic-ref`, `git sparse-checkout` (can empty the working tree), `git reflog expire`, `git gc --prune=now`, `git notes`, `git bisect` (moves HEAD), `git tag -d`, `git fetch`/`git remote` (network + ref updates), `git submodule` (checkouts anywhere).
- *Default deny* → ordinary read-only work stops (`git blame`, `git shortlog`, `git describe`, `git cat-file`, `git grep`, `git stash list`), which will drive the model straight to `conductor_override` (see H6) and train it to treat the hatch as routine.

**Shape of a fix.** State an explicit default (deny is right, given G5's fail-closed posture), then add an explicit **allow-list** of read-only subcommands so the default does not strangle normal work, and add `apply`, `worktree`, `update-ref`, `symbolic-ref`, `sparse-checkout`, `submodule`, `bisect`, `reflog`, `gc`, `fetch`, `remote`, `tag -d` as named deny rows in Task 5.1's table. `git apply` in particular deserves the same treatment as an edit tool, since that is what it is.

**Minor related defect in the same table:** the `git add` row says "allow for the publishing handler's own session; DENY from model sessions". But `conductor_publish` executes git through `$`/execFile *from inside the plugin*, which is not a tool call and therefore never reaches `tool.execute.before`. The "allow" half of that row describes a path that does not exist and will confuse the implementer of Task 5.1. It should simply read "deny".

---

## H3 — Three silent enforcement-bypass paths

**Where:** §3.5 ("every tool call in every conductor-managed session"), §5.1 (plugin loading), §6.4 (pack loading is a startup error), §9 (honest limits), scripts/serve.py (OPENCODE_CONFIG in the session subshell).
**Confidence:** High on all three; the third is partially acknowledged in §9.8 but for a different scenario.

The plan's honesty section (§9.1) discloses the obvious bypass — a human at a raw terminal. These three are *not* disclosed and are more likely in practice, because they look like normal operation.

**(a) Unregistered sessions.** Gates dispatch on the session registry (sessionID → role/item), populated by the fan-out engine (Task 7.1). Nothing specifies the disposition for a tool call from a session **not in the registry**. This matters because opencode ships its own agent/task-spawning tool: if an implementer sub-session invokes it, the child session is not in conductor's registry, has no item assignment, and — depending on the unspecified default — is either fully ungated (can edit anything, anywhere) or fully blocked. The plan never disables opencode's built-in task tool for conductor sessions, and never states the default. §5.4's gap table says "A sub-session's tool calls also hit our hooks … this is a feature" — true for *registered* sessions, and silent about the rest.

**(b) Plugin init failure = silent ungated session.** §6.4 says a missing doctrine pack is "a startup error (fail-closed at init, before any work)". But *fail-closed at init* is only meaningful if opencode refuses to run when a plugin throws during initialization. If opencode instead logs the error and continues without the plugin — which is the common design for plugin hosts — the user gets a session that looks completely normal, with no gates, no FSM, no injection, and no indication anything is missing. That is the worst possible failure mode for an enforcement system, and Task 0.2's contract test does not check it.

**(c) A second, plain opencode session.** The harness travels via `OPENCODE_CONFIG`, exported only in the subshell `serve.py` spawns. Any other terminal running `opencode` in the same repo gets no plugin at all. §9.8 covers *two conductor sessions* (advisory run-dir lock, second one read-only) — but a plain session takes no lock and is invisible to the lock-holder, so the conductor session's freshness stamps, quarantine moves, and freeze windows are all silently racing an unmanaged writer.

**Shape of a fix.** (a) Specify default-deny for unregistered sessions and explicitly deny opencode's task/agent-spawn tool in conductor sessions (or register spawned children). (b) Add a Task 0.2 assertion for plugin-init-failure behaviour, and if opencode continues without the plugin, add a visible liveness signal — e.g. conductor writes a heartbeat into `.conductor/state/` and `conductor_status` / the session banner reports "conductor ACTIVE"; absence is then observable. (c) Add both to §9.

---

## H4 — No clean-tree precondition; publish will commit the user's unrelated work

**Where:** §3.3 (REVIEWED→PUBLISHED), Task 4.2 (`dirtyFiles`, `unstagedDrift` exist), Task 9.5.
**Confidence:** High.

`conductor_publish` "stages the item's fileScope ∪ testScope changes" — i.e. it stages *by glob*, not by a recorded list of files the harness itself changed. Nothing anywhere establishes that the working tree was clean when the run started.

**Concrete failure.** You have half-finished work in `src/parser/` (uncommitted, deliberately). You ask conductor to fix an unrelated bug whose item declares `fileScope: ["src/parser/**"]`. At publish, `git add src/parser/**` sweeps your WIP into the item's commit, with a generated message describing the bug fix and a "red proof" that has nothing to do with your changes. The verify that "proved" the commit also ran against your WIP, so the evidence record is describing a tree state nobody intended.

Task 4.2 already builds `dirtyFiles` and `unstagedDrift(paths)` — the primitives exist and are never consumed by a rule. This is exactly the "specified but unconsumed" shape the plan's own Round-1 review caught for `requirePathspecCommits`.

**Shape of a fix.** At run creation, record the set of dirty paths. At publish, stage only files that changed *within* the item's scope *since the run started* (or at minimum refuse to stage paths that were already dirty at run start, and disclose them). Make it a hard precondition or a recorded decision — but not silence.

---

## H5 — Branch movement is allowed and never re-checked

**Where:** §3.5 (git matrix: "branch movement (`switch <br>`, `checkout <br>`, `checkout -b`) allow"), §2.6 (freshness), §3.3 (publish).
**Confidence:** High.

Freshness is defined purely over file mtimes versus a verify start-stamp. Nothing records or re-checks `HEAD`. Meanwhile the git policy explicitly *allows* branch switching and branch creation from model sessions.

**Concrete failure.** Item validates green on `main`. The orchestrator (or any sub-session with bash) runs `git switch feature-x` — allowed. `conductor_publish` runs: the staged files' mtimes are unchanged by a checkout of the *same* content, so the freshness check passes, and the commit lands on `feature-x`. The evidence record says the item was verified; it was, on a different branch, against a different tree.

A checkout that *does* change file content will change mtimes and trip staleness — so the failure is intermittent, which is worse than consistent.

**Shape of a fix.** Record `HEAD` (and branch name) in the verify evidence record; make `verifyFreshFor` require the current HEAD to match. Optionally deny branch movement outright during a non-terminal run — the model has no legitimate reason to switch branches mid-run, and worktree mode already covers isolation.

---

## H6 — `conductor_override` is uncapped, so enforcement is ultimately advisory

**Where:** §3.6, §0.5, §9.3.
**Confidence:** High. This is a design judgement, not a contradiction — but the judgement looks wrong for the stated threat model.

The hatch is deliberately expensive in *bookkeeping* terms: a reason string, an anomaly record, a permanent item taint, and prominence in the report. It is not expensive in any way the model experiences during the run. There is no cap — no per-item limit, no per-run limit, no escalating cost, no requirement that a human sees it before the next one is granted.

§0.5's rationale is: "A model that learns to reach for it leaves a visible trail." That is a *detection* argument, and it holds. But the system's premise (G9) is that local models are weak at prose compliance and will take shortcuts under difficulty (§0.1(6)). A model in a repair loop it cannot escape — which C1, C5, and H2 all produce — will find `conductor_override` because the doctrine and the deny messages both mention it. Once it is used routinely, every gate in the system is advisory, and the POC's quality numbers measure a mostly-unenforced pipeline while the report records a long taint list nobody reads until afterwards.

The plan already accepts caps everywhere else: `debugFixCap`, `reviewMaxRounds`, `planReviewMaxRounds`, 3 test-repair attempts, 2 schema retries, 3 futile re-prompts. Override is the only unbounded loop in the design, and it is the one that disables the safety properties.

**Shape of a fix.** Add `workflow.maxOverridesPerRun` (suggest 2) and `maxOverridesPerItem` (suggest 1). Exceeding it is an `env`-class stop with a surfaced question, not another override. Optionally require that a second override in the same run be human-approved via the sanctioned interactive ask.

---

## H7 — The POC comparison cannot support its conclusion

**Where:** Phase 14 (Tasks 14.1, 14.2), §0.5, §12, G12.
**Confidence:** High. This is a methodology finding, not a bug.

The entire justification for the system is "measure how much process enforcement improves quality at what token/wall-clock cost" (§0). Task 14.1 specifies: 10 tasks, run twice — **baseline** (plain opencode, same model, no plugin) and **conductor** (full pipeline) — collecting hidden-test pass/fail, wall-clock, tokens, findings caught, overrides used.

Four problems, each sufficient to invalidate the comparison:

1. **The arms use different models.** Baseline is "same model" (singular). Conductor routes across three models (`qwen3-coder-next` for planner/reviewer, `qwen3-coder-30b` for orchestrator/implementer/testWriter/skeptic, `ornith-9b` for mechanical). Any measured quality delta is a mixture of *process* and *a bigger model doing the judging*, and the design cannot tell you which. The POC's headline claim ("process enforcement improves local-model coding") would be unsupported by its own data.
2. **n = 1 per cell.** Sampling temperature is 0.7 for planners, 0.7 by default in the model presets. One run per task per arm, on 10 tasks, gives a pass/fail delta with no error estimate. A 6/10 vs 4/10 result is indistinguishable from noise, and that is exactly the resolution the experiment will produce.
3. **No doctrine-only control.** The design has two independent interventions: *doctrine injection* (better prompting, cheap) and *gates + fan-out + review* (expensive). A two-arm test cannot separate them — and the cheap intervention plausibly captures a large share of the benefit. Without a third arm (same model mix, doctrine injected, no gates/fan-out), the plan cannot answer the question a reader will immediately ask: "how much of this did I need to build?"
4. **Token accounting is asymmetric.** Tokens come from the router ledger. It is unspecified whether the baseline arm runs through the router; if it does not, the baseline has no token count and the cost side of the comparison is missing.

**Shape of a fix.** Add arms and repetitions: (a) baseline, (b) baseline + doctrine, (c) full conductor — each ≥3 repetitions per task (30 runs/arm), all through the router so token accounting is uniform; and either pin all conductor roles to one model for the primary comparison or add a matched multi-model baseline. Report per-task pass rates with the spread, not a single aggregate delta. This raises Phase 14's cost substantially, which is itself worth knowing before the build starts rather than after.

---

## H8 — Model routing is unvalidated, swap thrash is under-addressed, and read fan-out may be serialized upstream

**Where:** §4.1, §4.2, §2.1 (`models`), §2.2 (`maxInflightPerModel`), §4.4, `scripts/serve.py` `build_server_command`.
**Confidence:** High on (a) and (b); (c) *needs verification* against the vendored llama.cpp.

**(a) No validation that the configured role models exist or are servable.** `config.models` names seven role→model bindings. `conductor_setup` (Task 12.2) validates test commands by smoke-spawning them — nothing validates model ids against `llama-models.ini` / the provider's model list / the running server. A typo, or a model in the config that is not installed, surfaces as a failed sub-session at the first dispatch (mid-run, after decomposition), retried twice by the schema-retry path, then an `env` failure. The plan's own "unspawnable command fails at setup, not at first verify" principle (§2.1) is not applied to models.

**(b) Per-model waves do not address sequential-stage swaps.** §4.1's guard batches *concurrently queued* jobs by model. But a single item's stages alternate models by design:

| Stage | Role | Model |
|---|---|---|
| submit_test | testWriter | 30b |
| vet_test (3 critics) | reviewer | next |
| mark_green | implementer | 30b |
| item_review (6 lenses) | reviewer | next |
| skeptics | skeptic | 30b |
| fix | implementer | 30b |

Under `--models-max 1`, that is four model swaps per item per review round — the plan's own figure is ~30 s per swap for a 30 GB model. A two-item run with one fix round each is on the order of 10–16 swaps ≈ 5–8 minutes of pure weight reloading, before any tokens are generated. Nothing batches the same *stage* across items (e.g. running both items' vet critics in one reviewer wave), and the interleaving policy that would enable it is exactly what C6 leaves unspecified.

**(c) The read fan-out may not be parallel at all.** `maxInflightPerModel: 4` carries the comment "≤ llama-server's slot count for that model". Nothing sets that slot count: `build_server_command` in `scripts/serve.py:228` passes `--models-preset`, `--models-max`, `--models-autoload`, `--host`, `--port`, `--jinja`, and optionally `--ctx-size`. No `--parallel`/`-np`. If the server's effective slot count in router mode is 1, then all six reviewers serialize at the server regardless of what admission control permits, and the plan's parallelism benefits — the justification for the fan-out design and half the justification for the C++ layer — do not materialize. §14 records a refuted claim here ("the vendored llama.cpp's router mode does not pin n_parallel=1"), but *not pinned to 1* is a different statement from *defaults to more than 1*, and no task measures it.

**Shape of a fix.** Validate `config.models` against `/v1/models` at setup and at run start (fail fast, name the missing model). Add stage-level cross-item batching to the fan-out engine, or default all roles to a single model for the POC and make role→model routing an explicitly measured variable rather than an always-on cost. Add a Task 11.1 measurement step for effective concurrent slot count and have `serve.py` set `--parallel` from `maxInflightPerModel` — otherwise admission control is tuned against a number nobody knows.

---

## H9 — The router's schema guard is fail-closed inside a fail-soft layer, and inert for the traffic it will actually see

**Where:** §0.3 (layer table, "fail-soft"), §4.4 (schema guard), G5, §9.4, §5.2.
**Confidence:** High on the contradiction; high on the streaming point *pending* verification of opencode's request mode.

**(a) The contradiction.** G5 and §0.3 state the dependency direction as load-bearing: "layer 2 fail-soft, layer 1 fail-closed. Process integrity NEVER depends on the router being up. `serve.py --no-router` must always work and run the identical process."

But §4.4's schema guard **rejects requests with 400** when a request tagged `X-Conductor-Schema: required` carries no `response_format`/`grammar`. That is the router changing the outcome of a request the direct path would have served. The plan calls this a feature ("the plugin bug surfaces loudly") — and it is a reasonable feature — but it directly falsifies "identical process with and without the router". A run that succeeds with `--no-router` can fail with the router, which is the precise dependency direction the design forbids.

**(b) The guard is probably inert anyway.** Response validation is explicitly non-streaming only (§4.4, §9.4). Whether opencode's `session.prompt` issues streaming or non-streaming requests to the provider is not established anywhere — §5.2 documents the SDK call shape but not its wire mode — and interactive coding agents stream by default. If fan-out requests stream, the router validates nothing, and one of the two headline justifications for building a C++ layer ("wire-level schema enforcement — the claimant would validate its own claim", §0.3's table) evaporates. The plugin's own receipt-validation still runs, so nothing breaks — but the C++ work is then buying only scheduling, and that should be an explicit decision rather than a discovery in Phase 11.

**(c) "Fail-soft" is also overstated operationally.** §4.4 admits: "while the router is down, requests fail visibly until the restart lands." A router crash mid-run therefore kills in-flight sub-sessions and produces `env` failures — the process does not continue unharmed, it stops and needs re-dispatch. Nothing falls back to the direct upstream on repeated router failure, even though the plugin knows both URLs.

**Shape of a fix.** Either make the schema guard log-and-pass (true fail-soft, with the plugin's receipt validation as the real enforcement), or amend G5 to say the router is fail-soft *except* for the deliberate schema tripwire, and drop the "identical process" claim. Establish opencode's streaming mode in Task 0.2, before Phase 11 is scoped — if it streams, either force non-streaming for fan-out requests or explicitly de-scope response validation and re-justify the router on scheduling alone.

---

## H10 — Everything is tested under Node, and runs under Bun

**Where:** G1, G2, §1.1, Tasks 1.x–12.x (all `node --test`), Task 13.2 (first live run).
**Confidence:** High on the structural risk; the specific incompatibilities are unpredictable, which is the point.

The plugin executes inside opencode's embedded **Bun** runtime — `PluginInput` hands the plugin `$` (Bun shell). Every unit test in Phases 1–12 runs the same files under **Node** type-stripping (`node --test`), which G2 exists to make possible.

That is a good trick for the pure core (G3 forbids any I/O there, so runtime differences cannot bite). It is a real risk for `adapter/`, which is where all the I/O lives: `node:fs` atomic tmp+rename, `appendFileSync` semantics under concurrency, `node:child_process.execFile` with `shell:false`, `process.pid` for lockfiles, timers/watchdogs, and — importantly — whichever of `$` (Bun-only) vs `execFile` (Node-compatible) each adapter actually uses. The plan specifies `$`/execFile as alternatives in several places (§3.3 publish: "executed by the handler via `$`/execFile") without ever picking one, and `$` cannot run under `node --test` at all.

The first time any adapter code executes under Bun is **Task 13.2**, the second-to-last phase. If something is wrong at that boundary — a `$` call that was never exercised, a filesystem-timing assumption, a stream API difference — it is discovered after 12 phases of work built on top of it.

**Shape of a fix.** Two cheap additions: (1) state a normative rule that adapters use only Node-compatible APIs (`node:child_process`, `node:fs`) and never `$`, with a purity-style test enforcing it (the plan already has the Task 1.4 pattern to copy); (2) add a small Bun smoke task early — Phase 2 or 3 — that runs the state store and journal under Bun against a fixture dir, so the runtime boundary is proven before 30 modules depend on it.

---

# MEDIUM findings

**M1 — `DEBUG` and `BLOCKED` are drawn as states but are not in the vocabulary.**
§3.3's item FSM diagram shows an arrow into `DEBUG`, and the prose says a test-repair failure ends "then BLOCKED". Neither appears in the item state list, in §2.5's item schema, or in Task 3.1's `ITEM_STATES`. §14 refutes making them states (deliberate design), but the diagram and prose were not updated to match, and §2.5 has no field marking an item as *in* debug (only `attempts.debugFixes`, a counter that cannot distinguish "3 fixes attempted, now resolved" from "currently debugging"). The implementing agent will have to guess. Related to C2, which is the same gap with worse consequences.

**M2 — `evidence.red.seq` conflates two sequence spaces.**
§2.5's item records `evidence: {red: {seq: 12}, green: {seq: 18}, validated: {seq: 25}}` and §2.6 describes them as "journal/evidence seq refs". But `journal.jsonl` (§7.2) and `evidence.jsonl` (§2.6) each carry their own independent `seq`. A bare `{seq: 12}` is ambiguous — the reader cannot tell which file to look in, and the two counters will collide at low numbers. Fix: `{ledger: "evidence", seq: 12}` or separate field names.

**M3 — Two validators, one schema set, different strictness.**
Task 1.1 builds a hand-written ~120-line JSON Schema *subset* validator in TS ("NOT a general validator"). Task 11.6 uses the full `json-schema-validator` C++ library on the same exported schemas. So the same model response can be accepted by one layer and rejected by the other — most likely the router rejecting something the plugin would have accepted (formats, numeric bounds, `oneOf`, patterns the TS subset ignores). Because the router's rejection wraps the response in an error envelope, the fan-out engine sees a validation failure it cannot reproduce locally, and the retry will produce the same output. The "single source, two consumers" claim in §2 covers the schemas, not the semantics. Fix: constrain the exported schemas to the TS subset mechanically (a test), or use the same validator both sides.

**M4 — "Validate is serial per tree" has no enforcement.**
§4.3 says validate is serial per tree because "parallel verifies in ONE tree lie". The only mechanism is the `verify-running-<treeKey>.json` marker, whose stated purpose is feeding the freeze gate. What a *second* `conductor_validate` does when it finds a **live** marker is unspecified — deny, queue, or proceed. Stale-marker healing (dead pid) is specified; the live case is not. Under C6's Reading B (dispatch_wave drives items concurrently) this happens on the first two-item wave.

**M5 — Publish's auto re-verify has no failure path.**
§3.3: "re-checks verify freshness … stale ⇒ auto re-verify". If that re-verify fails, the item is at REVIEWED with a red tree and no specified transition. Does it drop to GREEN? To DEBUG? Does publish deny and leave the item REVIEWED (which would loop forever, since the tree stays red)? Unspecified, and Task 9.5's test list only covers the passing case.

**M6 — Only `done` produces a report.**
§3.2's REPORTED stage is the sole writer of `report.md`. The other five stop kinds (`noop`, `blocked`, `surfaced`, `env`, `interrupt`) record a stop and nothing else. So the runs the user most needs to understand — the wedged ones — produce no human-readable artifact, and OPERATIONS.md's troubleshooting guidance ("run disengaged ⇒ read the futile re-prompt journal entries") sends the user to raw JSONL. Fix: every terminal stop writes a report, with the stop kind and the outstanding state as its headline.

**M7 — The classification cross-check has no schema.**
§3.2 dispatches "ONE `skeptic`-role check of that classification", and §2.3 embeds `check: {agreed, note}` in run.json. §2.10 lists FINDINGS, VERDICT, CLASSIFICATION, DECOMPOSITION, TEST_VET, IMPLEMENTER RESULT — no classification-check schema. Task 1.1's schema list likewise omits it. Since every fan-out dispatch is schema-constrained by design (G9), this dispatch has nothing to constrain it.

**M8 — Tasks 9.4 and 9.5 violate the plan's own bite-size rule.**
The plan requires bite-sized plan steps and makes oversized items a plan-review finding class (§3.2, `plan.md` doctrine, decomposition size checks). Task 9.4 creates six tools; Task 9.5 creates five tools with roughly fifteen distinct asserted behaviours in a single red→green→commit cycle. These are the two most complex tasks in the build and they are the two least decomposed. It is also a practical risk: a task that large will not have a single clean red state, which is what G4 requires. Fix: split each into 3–4 tasks along tool boundaries.

**M9 — Non-git workspaces are unhandled.**
Run creation, `.git/info/exclude` registration, `git.mode`, publish, freshness (index mtime), and worktrees all assume a git repository. `gitio.isRepo` exists (Task 4.2) but no rule consumes it. opencode is routinely run in scratch directories that are not repos. Behaviour there is undefined: probably a crash in `conductor_setup` or run creation, at the first prompt, with no guidance.

**M10 — Quarantining a whole file can produce a false green.**
The quarantine moves *files*, but `testScope` is a glob that may name **existing** test files (an item adding a case to `tests/parser.test.ts`). Quarantining that file removes all of its *pre-existing, passing* assertions from the verify — so the verify that "proves" another item is green has silently lost coverage, and nothing records what was excluded (report disclosure is specified only for the closing verify, §3.2). The design implicitly assumes one item ↔ its own new test files, which decomposition does not guarantee.

**M11 — No supported way to reconfigure a repo.**
`conductor_setup` is "legal ONLY while `.conductor/config.json` is absent" (§3.4). Once written, changing `git.mode`, model routing, verify scopes, or parallelism requires hand-editing JSON — with no validation pass (the smoke-spawn check only runs at setup). At minimum OPERATIONS.md must say so; better, allow re-running setup with an explicit confirmation.

**M12 — No retention policy for `.conductor/`.**
Every run keeps its full journal, evidence, decisions, anomalies, review sets, plan, and report inside the user's repo, forever. At `trace` level the journal includes sub-session prompts and raw structured outputs (§7.2) — i.e. large chunks of the repo's source, duplicated per review lens, per round, per item. Nothing prunes, caps, or archives. `.git/info/exclude` keeps it out of git, which also means nothing ever notices it growing.

**M13 — Model ids lack their provider prefix.**
`config.models` holds bare ids (`qwen3-coder-30b`), matching the `llama-models.ini` section names. The SDK call (§5.2) needs `model: {providerID, modelID}`, and the opencode config uses `"<provider>/<model>"` (as `serve.py:221` writes it). The mapping from bare id → providerID is never stated. Trivial to fix; easy to get wrong once, silently, in the fan-out engine.

---

# LOW findings

**L1** — §2.2's router config lives at `.data/configs/conductor-router.json` but writes its metrics ledger to `.data/router-metrics.jsonl` (root, not `configs/`). Harmless, inconsistent.

**L2** — §1.1's layout block has a misaligned comment column on `receive-review.md`.

**L3** — §2.7 decision records use ids like `D-0007` with no generator specified (per-run counter? global?).

**L4** — §2.1's `verify.behavioralPaths` defaults to `["src/**"]`, but Task 12.2's detection matrix produces test commands only — it never proposes `behavioralPaths` per language, so the default will be wrong for most repos (e.g. Go, or `lib/`, or a monorepo).

**L5** — `parallel.subSessionTimeoutMs` (600 000) and `admission.queueTimeoutMs` (600 000) are equal, so a request that waits out the router queue and the plugin watchdog fire simultaneously, producing two different error stories for one event. The watchdog should exceed the queue timeout.

**L6** — §3.3 says publish uses "a generated message naming the item + red proof" without saying *who* generates it (template vs. a `mechanical`-role dispatch). Task 9.5's test is "generator-side", implying a template; worth stating, since a model-generated message is another gated dispatch.

**L7** — `reviewMaxRounds` is used for two distinct loops (the item review fix loop and the TEST_VETTED critic loop, §3.3). One knob, two meanings; either is defensible, but it should be deliberate.

**L8** — §9's honest-limits list omits in-session interpreter bypass (`node -e "require('fs').writeFileSync(...)"`, `python -c`), which the write-shape extractor (Task 5.2) cannot catch by design. G7 covers the philosophy; the specific hole deserves a line, next to the raw-terminal one.

---

# What I checked and found sound

Recording these so the review is honest about its own coverage, and so nobody re-litigates them:

- **The finding-survival rule** (`upholds ≥ ⌈K/2⌉`, ties uphold) is stated identically in §2.1, §3.3, and Task 1.3. Round 2 fixed it properly.
- **The freshness rule** (§2.6) is well-formed, including the staged-deletion/index-mtime term, and its start-stamp-before-everything ordering in Task 6.1 is correct. My concerns about it are external (branch movement, H5) not internal.
- **The parsed-token git policy** is the right mechanism, and the false-positive guards in Task 5.1 (`git add src/config.ts`, `git log --grep config`, `git stash push -m drop`) show real care. My H2 finding is about coverage, not approach.
- **Layer separation and the pure-core/thin-adapter split** (G3 + Task 1.4's purity guard) is genuinely good design and makes every gate replay-testable, exactly as claimed.
- **The evidence-re-derivation principle** (G6) is applied consistently: every FSM-advancing handler runs the command itself. This is the strongest part of the design.
- **The two-stage review adjudication ordering** (spec findings first, quality findings re-derived after) is correct and correctly justified.
- **The trivial-path compression rule** (merge lenses, never drop mandatory ones) is sound — my C7 finding is about item *synthesis*, not about the compression rule.
- **The wave scheduler's conservative `scopesIntersect` bias** (false positives serialize, never corrupt) is the right trade and is honestly documented in §9.6.
- **The disengage/noop unification** (Round 2) leaves one wedge detector with one threshold, consistently specified in §2.3, §2.9, §3.7, and Tasks 1.3/10.1.
- **§9 (honest limits) and §14 (review record)** are unusually candid, including the closing admission that Round-4 fixes are unreviewed. That candour is what made this review tractable.

---

# Remediation plan

Critical findings exist, so this section is included. It is ordered by *when the fix must land*, not by severity, because several critical items are cheap if fixed before Phase 0 and very expensive after Phase 9.

## Stage 0 — Before Task 0.1 (document-only edits, no code)

These are pure specification changes. They cost a day of editing and they unblock or de-risk everything downstream.

| # | Finding | Edit required |
|---|---|---|
| 1 | **C1** | Add `failureClass: "missing-subject"` to §2.6, define it as a legal red iff the unresolved module/symbol resolves inside the item's `fileScope`, and update §3.3's PENDING→RED rule, Task 6.1's classifier spec, and Task 3.1's transition-context tests. **Nothing else in the plan works until this is fixed.** |
| 2 | **C2** | Add `blocked`/`deferred` fields to §2.5; add `runs/<runId>/questions.jsonl` to §1.2 with a schema in §2 and an entry in Task 1.1's list; name the writers (`conductor_surface`, the BLOCKED escalations); add a `conductor_defer` tool or an explicit defer disposition to §3.4; re-derive `itemsSummary` in Task 1.3 from real fields. |
| 3 | **C6** | Decide who drives item stages. Write it once, normatively, in §3.4 and §4.2. Update §3.1/§6.4/Task 8.2's "one legal next tool" to "next legal action set + recommended action". Add an explicit interleaving policy (depth-first per item vs. breadth-first per stage) — this choice also determines H8(b)'s swap counts, so make it deliberately. |
| 4 | **C7** | (a) Either extend the CLASSIFICATION schema with the fields §2.4 requires, or specify a `mechanical` synthesis dispatch that produces a valid item. (b) Add the non-behavioural item path (`PENDING → GREEN → …`), gated on `fileScope ∩ behavioralPaths = ∅`, and wire `behavioralPaths` into the item FSM. |
| 5 | **C3** | Rule that the freeze gate covers **all** edits in the tree (tests included); require the fan-out engine to hold write-capable dispatches while a tree has a live verify marker; rewrite §4.2/§4.3's overlap claims to match what actually overlaps. |
| 6 | **C5** | Route findings by target path: `testScope`-touching findings dispatch a test-writer, and any test change re-enters the vet discipline before re-validate. Add to §3.3 and Task 9.5's test list. |
| 7 | **H2** | State a default disposition for unlisted git subcommands (deny), add the read-only allow-list, and add `apply`, `worktree`, `update-ref`, `symbolic-ref`, `sparse-checkout`, `submodule`, `bisect`, `reflog`, `gc`, `fetch`, `remote` as named rows in §3.5 and Task 5.1's matrix. Correct the misleading `git add` "allow for the handler's session" row. |
| 8 | **H6** | Add `workflow.maxOverridesPerRun` / `maxOverridesPerItem` to §2.1 and the exceed-behaviour to §3.6. |
| 9 | **H5** | Add `head` to the verify evidence record (§2.6) and to `verifyFreshFor`'s inputs (Task 1.3). |
| 10 | **H4** | Add a run-start dirty-path snapshot and a publish rule that will not stage pre-existing dirty files without disclosure (§3.3, Task 9.5). |
| 11 | **M1, M2, M7, M13, L5–L7** | Small consistency edits in §2.5, §2.6, §2.10, §3.3, §4.1, Task 1.1. |

## Stage 1 — Fold into Phase 0 (verification before anything depends on it)

Task 0.2 already exists as the wire-contract discovery test. Extend it, and extend Task 11.1's upstream-contract step, rather than adding new phases:

| # | Finding | Verification to add |
|---|---|---|
| 12 | **H3(b)** | Assert what opencode does when a plugin throws during init. If the session survives ungated, design the liveness signal now (heartbeat file + banner + `conductor_status`), because fail-closed-at-init is otherwise a false claim. |
| 13 | **H9(b)** | Determine whether `session.prompt` issues streaming or non-streaming provider requests. This decides whether the router's schema guard has any function, which is a Phase 11 scoping input. |
| 14 | **C4** | Empirically test, per supported default runner (`node --test`, `pytest`, `go test`, `ctest`), whether a test file under a dot-directory inside the repo is discovered. Then place the quarantine directory **outside** the repo regardless — the test exists to confirm the hazard, not to justify keeping it inside. |
| 15 | **H8(c)** | Measure the served model's effective concurrent slot count in router mode, and have `serve.py` set `--parallel` explicitly from `maxInflightPerModel`. Record it in `UPSTREAM_CONTRACT.md`. |
| 16 | **H10** | Add a Bun smoke task at Phase 2/3 covering the state store and journal, plus the "adapters use Node-compatible APIs only, never `$`" rule with a purity-style test. |

## Stage 2 — Before Phase 9 (the pipeline tasks)

| # | Finding | Action |
|---|---|---|
| 17 | **C4** (worktrees) | Move worktrees outside the repo, or prove the verify command excludes them, in Task 9.6. |
| 18 | **H1** | Add the cross-run stale-red-test registry and the start-of-run disclosure. |
| 19 | **H3(a)** | Specify default-deny for unregistered sessions; deny opencode's task/agent-spawn tool in conductor sessions. |
| 20 | **M8** | Split Tasks 9.4 and 9.5 into 3–4 tasks each. |
| 21 | **M4, M5, M10** | Specify: second-validate-against-live-marker behaviour; publish re-verify failure transition; per-verify quarantine disclosure (not just the closing one). |
| 22 | **H8(a)** | Validate `config.models` against `/v1/models` at setup and run start. |
| 23 | **M6, M9, M11, M12** | Report on every terminal stop; non-git workspace behaviour; setup re-run path; `.conductor/` retention policy. |

## Stage 3 — Before Phase 14 (or the POC produces an unusable number)

| # | Finding | Action |
|---|---|---|
| 24 | **H7** | Redesign the benchmark: three arms (baseline / baseline+doctrine / full conductor), ≥3 repetitions per task per arm, uniform routing through the router for token accounting, and either single-model conductor roles or a matched multi-model baseline. Report spreads, not point deltas. Re-estimate Phase 14's cost with the new run count before committing to it. |
| 25 | **H9(a)** | Resolve the fail-soft contradiction: either the schema guard logs and passes, or G5 is amended to carve it out and the "identical process" claim is dropped. |
| 26 | **H8(b)** | Implement stage-level cross-item batching, or pin all roles to one model for the POC and treat role→model routing as a separately measured variable. |
| 27 | **L1–L4, L8** | Editorial cleanup; add the interpreter-bypass line to §9. |

## Suggested sequencing note

Stage 0 items 1–6 are the ones I would not start Phase 1 without. They are all specification edits — no code is invalidated by doing them now, and items 1, 2, 5 and 6 each independently prevent the pipeline from completing an ordinary task. Items 3 (C6) and 4 (C7) are the two that will cause the most rework if deferred, because they change the tool inventory and the state machines that Phases 3, 8 and 9 are built directly on top of.

---

*Recon complete; no plan changes made. Awaiting review.*
