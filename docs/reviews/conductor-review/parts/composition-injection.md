# Enforcement Review Part — Composition Root, Injection, Doctrine Delivery

**Scope:** `conductor/plugin/index.ts`, `conductor/adapter/inject.ts`, `conductor/adapter/chat-message.ts`, `conductor/doctrine/*`.
**Charter:** every one of the 7 roles must receive its §4.1 pack EVERY request (§6.4/G9); P6 applied — verify the doctrine ARRIVES at the sub-session, not merely that a guard refuses when absent. Verify the per-call gate snapshot derivation (fileScope/testScope/verifyInFlightTree) for every role and both tree modes, and that every failure path derives NO scope rather than a permissive default.
**Date:** 2026-08-15
**Reviewer:** enforcement sub-reviewer (composition-injection lens)

---

## 1. ISSUE register

### COMPOSITION-INJECTION-001 — The §6.4 injection layer is never wired: no session ever receives doctrine, the state block, sampling params, or router headers through it (CRITICAL)

**Pattern:** P6 at system scale (the guarded thing never arrives), plus P12 (a path nothing has walked — in production, ever).
**Where:** `conductor/plugin/index.ts` (the returned hooks object, lines 1260–1426); `conductor/adapter/inject.ts` (all four exported functions).
**Spec clauses violated:** plan §6.4:1892–1903 (`experimental.chat.system.transform` "appends to every request's system array"; `chat.params` "role-appropriate sampling per §4.1's table — recorded in the journal"; `chat.headers` "the §4.4 router tags"); §0 line 180 ("injected into EVERY request — process re-stated every turn, never remembered"); G9; §4.1:1519–1527 (the roles table's Doctrine pack and Sampling columns); §4.4:1641–1645 (tagging).

**The defect.** `ConductorPlugin` returns exactly four hooks: `tool`, `chat.message`, `tool.execute.before`, and `event` (index.ts:1260–1426). It registers **no** `experimental.chat.system.transform`, **no** `chat.params`, and **no** `chat.headers` hook. Consequently `buildSystemAppend`, `paramsForRole`, `headersFor`, and `initPlugin` — the entire §6.4 injection layer built by Task 8.2 — are **dead code in production**: a repo-wide grep finds them referenced outside `inject.ts` only in comments (`chat-message.ts:28`, `fanout.ts:69`, `tools.ts:5562/5926`) and in tests (`inject.test.ts`, `tools-9.5a.test.ts`). The only production import from inject.ts is `loadPacks` (index.ts:75).

This is not an upstream limitation: `wire-notes.md:24/27/28` records that all three hooks **fire and work at opencode 1.18.15** — `system.transform` strings arrive as their own `role:"system"` messages; `chat.headers` output reaches the provider as HTTP headers. The mechanisms were verified in Task 0.2 and then never used.

**Concrete consequences, each independently a spec violation:**
1. **Doctrine packs do not arrive per §4.1 for any role.** What arrives instead: (a) the orchestrator gets `core.md` only via the opencode-fragment agent prompt (`conductor/opencode-fragment.json:15`, `{file:…core.md}`) — and only when the session actually runs under the `conductor-orchestrator` agent; (b) implementer/testWriter get the *name* "doctrine tdd.md" in their dispatch prompts (`tools.ts:4111–4120`, `tools.ts:2868`), never tdd.md's content; (c) planner/reviewer/skeptic get hand-inlined *paraphrases* of decompose/plan/review/skeptic doctrine as string literals in tools.ts (lines 1267, 1471, 1755, 1787) — not the packs; (d) `debug.md` alone is delivered verbatim, via `debugFixPrompt` (`tools.ts:4132–4154`); (e) `receive-review.md` is never delivered at all (see -002); (f) `test-vet.md` and the mechanical role's `core.md` — never delivered (vet-critic and mechanical dispatch prompts carry inline text only).
2. **The live state block** (run state, active item, the recommended next tool from `legalTools(...).recommended`, taint count, overrides remaining — §6.4(b)) **reaches no session, ever**. The plan's own §0 table calls this the load-bearing mechanism ("process re-stated every turn, never remembered"). A small model inside this harness never sees the recommended next tool unless it thinks to call `conductor_status`.
3. **Sampling params are never applied.** §4.1's temperature column (0.1–0.7 by role) governs nothing; every role samples at opencode's defaults. The §6.4 "recorded in the journal" record does not exist.
4. **Router tags are never sent.** `X-Conductor-Role`/`-Priority`/`-Group`/`-Schema` never reach llama-router, so: priority scheduling degrades to FIFO over uniformly `interactive` requests; group affinity (the router's "principal wall-clock lever" §4.4:1654) never engages; schema observation (`X-Conductor-Schema: required`) can never trigger, so the router's `schemaMissing`/`schemaConformed` POC dataset — "a POC deliverable" per §4.4:1668 — will be structurally empty. This also silently trivializes G5 router/no-router equivalence (cf. C-089/P9: the two arms really are nearly identical, because conductor sends the router nothing distinctive).
5. **`initPlugin` is never called**, so its documented property — "the beacon's ABSENCE proves init failed" (inject.ts:9–13, plan §3.8) — is not in force. See -005.

**Why every gate stayed green.** `inject.test.ts` unit-tests the pure functions; `tools-9.5a.test.ts` proves delivery *by calling `buildSystemAppend` itself in the test* (line 1934) — the P6/P2 shape: the expected behavior is derived by invoking the very function whose production reachability is the question. `doctrine.test.ts` proves the packs' content. `fragment.test.ts` guards the fragment. Nothing anywhere asserts the plugin's returned hook set includes the injection hooks, and no e2e drives a provider request whose system array is inspected. The C-028 Phase 8 completeness lens existed to catch "loaded ≠ delivered" and caught two *inner* instances (debug.md, receive-review.md keyed wrongly inside buildSystemAppend) while missing the *outer* one: buildSystemAppend itself is not delivered.

**Plan-level root cause (P8-adjacent).** The §8 manifest has no task that registers these hooks. Task 8.2 builds the pure functions ("Interfaces: buildSystemAppend… paramsForRole… headersFor…", plan 2542–2557); Task 5.3 wires only the gate hooks (plan 2375–2390). The build faithfully implemented all 52 tasks and the wiring exists in none of them. Fifty tasks COMMITTED and the doctrine-injection thesis of the whole system (§0 line 241: "doctrine injection … injected into every request") is unimplemented.

**Attempted refutation (failed).** (a) "The fan-out prompt carries the doctrine" — only debug.md, verbatim; every other role gets names or paraphrases (see -003, -004). (b) "The fragment's agent prompts deliver it" — only the orchestrator's core.md, statically, agent-selection permitting; sub-sessions are created by `fanout.ts:257` with `body:{title}` only — no agent, no prompt file. (c) "It's a recorded deviation" — no correction (C-001…C-092), no STATE.json deviation, no known-open entry names it; C-028 explicitly *deferred receive-review.md delivery to buildSystemAppend*, presupposing buildSystemAppend is live. (d) "13.2/14.2 will catch it live" — 13.2's smoke may notice model quality, but nothing in its checklist inspects the provider request's system array.

**Fix direction (not applied).** Register the three hooks in the plugin's returned object: `experimental.chat.system.transform` composing `buildSystemAppend(registry.get(sessionID) ?? ORCH, run, items, questions, ensurePacks(...), ctx)`; `chat.params` from `paramsForRole(entry.role)`; `chat.headers` from `headersFor(entry, job)`. Add a wire-level test asserting a stub provider sees the doctrine system message and headers per role (the Task 0.2 fixture already demonstrates the technique).

---

### COMPOSITION-INJECTION-002 — receive-review.md still governs nothing: C-028's "deferred binding" was closed with half the wiring (MAJOR)

**Pattern:** P6 exactly (C-091's own words: the guard fires; the doctrine does not arrive), and a recurrence of C-028's "loaded ≠ delivered" in the very place C-028 deferred it to.
**Where:** `conductor/adapter/tools.ts:6438–6447` (the presence guard), `tools.ts:5788–5845` (the two fix prompts), `fanout.ts:286–291` (the flag threading), `inject.ts:193–195` (the dead delivery arm).

**The defect.** C-028 recorded: "the Phase 9 review-receipt/fix-round task must thread a 'receiving-review' signal to buildSystemAppend so it appends receive-review.md." What shipped: the fan-out engine sets `receivingReview: true` on the §3.5 registry entry (fanout.ts:290) — and buildSystemAppend honors it (inject.ts:193) — but since no production code calls buildSystemAppend (-001), the flag drives nothing. The review-fix dispatch prompts say "Work under doctrine receive-review.md: VERIFY each claim…" (tools.ts:5803, 5831) — the pack's *name* and a one-line paraphrase of its charge, never its content (the forbidden-responses table, the no-performative-agreement rule, the verify-then-fix protocol). Meanwhile `handleItemReview` refuses to dispatch when the pack is *absent from the loaded set* (tools.ts:6438–6447, citing "§3.3/C-028") — a guard that checks presence in a cache nothing reads from.

**The false comfort is named in its own test title.** `[9.5a-receive-review-pack-delivered]` (tools-9.5a.test.ts:1906) claims "asserted on the DELIVERED system append … Loaded is not delivered: that was the whole C-028 finding" — and then computes "delivered" by calling `buildSystemAppend` in the test (line 1934). The test proves inject.ts *would* deliver if it were ever invoked. It is not. This is simultaneously P13 (a named test that does not prove its row: the row claims session delivery; the assertion covers a pure function) and P2-adjacent (the oracle is the subject's sibling, not the seam).

**A lying model gets away with:** ignoring review findings politely. The fix-dispatch implementer never sees the pack's "no performative agreement / verify before implementing / never thank the reviewer" tables; the only delivered fragments are two sentences of paraphrase. The mustFix loop still re-verifies mechanically, but the receive-review *doctrine* — the §6.1 port of receiving-code-review — governs zero sessions.

**Fix direction.** Either wire -001 (which makes the existing flag + buildSystemAppend arm live), or inline the pack verbatim into `reviewImplementerFixPrompt`/`reviewTestWriterFixPrompt` exactly as `debugFixPrompt` does for debug.md, and convert the presence guard into the delivery site.

---

### COMPOSITION-INJECTION-003 — tdd.md is delivered to no testWriter and no implementer; the packs that §4.1 assigns to five of seven roles arrive nowhere (MAJOR)

**Pattern:** P6 / C-028's class ("a pack that is loaded but never delivered governs nothing"), distinct from -001 because it persists even under -001's fix direction (b): the dispatch prompts *reference* packs they do not carry.
**Where:** `tools.ts:2868` (testWriter prompt: "…working under the TDD doctrine: the test must FAIL first…", a one-line paraphrase), `tools.ts:4111–4120` (implementer prompt: "doctrine tdd.md, minimal-code section" — a citation, not content), planner prompts (decompose inlined ~1267, plan inlined ~1471), reviewer lens prompt (~1755, review.md "inlined at plan level"), skeptic prompt (~1787), vet-critic prompt (test-vet.md never included), mechanical dispatches (core.md never included).

**Verdict per role (the §4.1 table, column 2, applied with P10 discipline — identifier positions):**

| Role | §4.1 pack | Arrives verbatim? | What actually arrives |
|---|---|---|---|
| orchestrator | core.md | YES, if the `conductor-orchestrator` agent is active (fragment `{file:}`) | agent system prompt |
| planner | decompose.md / plan.md | NO | tools.ts paraphrase literals |
| testWriter | tdd.md | NO | one sentence naming "the TDD doctrine" |
| implementer | tdd.md (+debug.md in DEBUG) | tdd.md NO; debug.md YES (verbatim, tools.ts:4141) | citation of "tdd.md, minimal-code section" |
| reviewer | review.md / test-vet.md | NO | lens-prompt paraphrases |
| skeptic | skeptic.md | NO | refute-this-finding paraphrase |
| mechanical | core.md (lite) | NO | schema-bound task prompt only |

tdd.md's anchor content — "NO PRODUCTION CODE WITHOUT A FAILING TEST", "delete means delete", the excuse table (Task 8.1's authoring constraints, anchor-tested in doctrine.test.ts) — is proven present *in the file* and delivered to *nobody*. The RED-before-GREEN property survives because the harness re-derives reds mechanically, but the doctrine's behavioral half (what the model should do when tempted to weaken a test) governs no session.

---

### COMPOSITION-INJECTION-004 — Doctrine exists in two unguarded spellings: the anchor-tested packs, and the tools.ts prompt literals that actually ship (MAJOR)

**Pattern:** P3 (two spellings of one fact, no drift guard), the codebase's most frequent class.
**Where:** `conductor/doctrine/*.md` (the owner — Task 8.1, ≤120 lines each, content anchor-tested) vs. `tools.ts` prompt literals at ~1267 (decompose), ~1471/1535/1854 (plan), ~1755/5688 (review), ~1787/5727 (skeptic), 2868 (tdd), 5788–5845 (receive-review paraphrase).

**The defect.** The .md packs are the OWNED doctrine: doctrine.test.ts pins their anchors; C-028 fixed their content against the §6.1 port map; the operator can even repoint them via `LLAMA_HARNESS_DOCTRINE_DIR` (index.ts:149–156). But the doctrine that sub-sessions actually receive is a *separate hand-written restatement* inside tools.ts, with **no drift guard in either direction**: edit review.md's severity triad and every reviewer still gets the old inlined triad; edit the tools.ts literal and doctrine.test.ts stays green. Every future doctrine improvement (a whole R3 theme) lands in files that govern nothing.

**Corollary — the ENV_DOCTRINE_DIR override is ~95% theater.** index.ts:142–156 documents an operator-pointable doctrine directory, re-read per call, fail-closed. Because only debug.md's *content* is ever read out of the pack map (tools.ts:4132) — everything else is a presence check — an operator who overrides the directory changes exactly one dispatch prompt (DEBUG fixes) plus which failures throw. Eight of nine packs in the override are load-checked and discarded.

**Fix direction.** One spelling: prompts compose pack content from the loaded map (the debugFixPrompt pattern), or — under -001's hook fix — drop the inlined paraphrases entirely and let the transform own doctrine. Add a drift guard if any paraphrase must remain.

---

### COMPOSITION-INJECTION-005 — In default main-tree mode the composed system denies EVERY write by every dispatched sub-session: the registry tree is the slug "main", the edit gate needs a path (CRITICAL)

**Pattern:** P3 (two spellings of tree identity — C-037 ruling 5's own class, half-fixed) composed with P12 (the composed main-tree dispatch+gate path is walked by no test), producing a fail-CLOSED total write lockout.
**Where:** `tools.ts:2362-2364` (`sessionTreeOf` = `item.worktree ?? "main"`), every write-capable dispatch site (`tools.ts:3185`, `3836-3841`, `4214-4219`, `4611-4616`, `6239`), `fanout.ts:286-291` (registers `tree: job.tree` verbatim), `plugin/index.ts:1356` (`resolveSessionTree` keeps a non-empty tree as-is), `core/gates-edit.ts:128-134/171-177` (`normalizeUnderTree` needs a path prefix).

**The defect.** Under `parallel.writes: "off"` (the shipped default), an item has no worktree, so `sessionTreeOf(item)` returns the evidence-layer SLUG `"main"`. That slug becomes the fan-out job's `tree`, hence the sub-session's §3.5 registry entry's `tree`, hence — via `resolveSessionTree`, which only fills EMPTY trees — the `sessionTree` the edit gate normalizes against. `normalizeUnderTree("<root>/src/a.ts", "main")` is null → deny "the path is outside this session's tree", for every path, absolute or relative, edit tool or bash write shape.

**Reproduced end-to-end through the real plugin** (scratch harness driving `ConductorPlugin` + fake SDK, no test files touched): a fixture repo, one queue item at TEST_VETTED with `worktree: null`, `conductor_mark_green` kicked; the run journal's own `subsession.dispatched` record shows `role=implementer tree=main`; the real `tool.execute.before` hook then denies the implementer's in-scope edit of `<root>/src/beta.ts` AND the bash `echo hi > <root>/src/beta.ts` with exactly the tree deny. In a live run this means: no testWriter can write a test, no implementer can write code, no review fix can apply — the pipeline stalls at its first write in the default configuration. (Fail-closed, so not a security hole — an operability hole: the harness cannot do work at all in default mode with a real model.)

**Why 1,382 tests stay green.** (a) The e2e drives a FAKE SDK whose scripted responder writes fixture files directly on disk — no dispatched session ever makes a gated edit call. (b) `composition-root.test.ts` [13.1-cr2-freeze-denies-only-its-own-tree] and [13.1-cr2-gate-scope-derived-from-registry] compose the real dispatch with the real gate — but `scopeItemOnDisk` gives every item a WORKTREE, so `sessionTreeOf` returns a path and the seam works. The one case production defaults to — no worktree — is composed by no test. (c) `gates-edit.test.ts` drives `decideEdit` with test-chosen consistent inputs.

**The near-miss in the record.** C-037 ruling 5 named tree identity as "TWO DIFFERENT THINGS" and observed "in worktree mode the fanout tree is the worktree PATH" — fixing the marker→gate direction (`verifyInFlightTreeFor`) and leaving the session-tree direction untranslated in the mode it did not examine. `plugin/index.ts:694-697` even documents that "a fan-out job's tree is the PATH the edit gate compares by string equality" — while the jobs carry slugs — and index.ts's own freeze view (`isFrozen`: `slug === tree || pathOf(slug) === tree`, line 748-753) silently TOLERATES both spellings on the admission seam, which is precisely what kept the split invisible.

**Also broken by the same slug, live (main mode):** the gate-side freeze comparison for sub-sessions (freezeTreeFor translates the marker slug to `store.root`, sessionTree is `"main"`, never equal — moot only because every edit is already denied); the `X-Conductor-Group` affinity id would have been the slug (moot under -001).

**Attempted refutation (failed).** Looked for any slug→path fix-up between fan-out registration and the gate: `resolveSessionTree` keeps non-empty trees; nothing else writes `entry.tree`. Checked whether opencode might hand tree-relative paths that start with "main/": it hands absolute canonicalized paths (wire-notes:35). Checked whether write sub-sessions exist in main mode at all: §4.3's table says implementation runs "1, or wave-wide under worktrees" — dispatched either way.

**Fix direction.** `sessionTreeOf` (or the dispatch sites) must hand the gate seam a PATH: `item.worktree ?? store.root`, with the marker slug derived separately (`itemTreeOf` already keeps the two apart for `runVerify`). Then add the missing composition test: a no-worktree item's dispatched implementer edit inside fileScope is ALLOWED, outside is denied by SCOPE (not by tree).

---

### COMPOSITION-INJECTION-006 — `runActive: true` is hardcoded at the gate seam: branch movement under the default "pin" policy is denied forever, including with no run at all (MINOR, spec-conformance MAJOR by the rubric)

**Pattern:** P4 (a parameter name asserting a derivation the caller does not perform) / the inverse of C-054's "config read then ignored".
**Where:** `plugin/index.ts:1384` (`runActive: true`), `core/gates-git.ts:179-189` (movement allowed when `!runActive`).

Plan §3.5:1380: branch movement is denied "**while a run is non-terminal** under `git.branchPolicy:"pin"`". The composition root owns the only live derivation of that fact (`store.currentRun()` + `isTerminal`) and instead passes the literal `true` on every call. Consequences: (a) with no run, or after the run terminates, `git switch <br>`/`git checkout -b` from the session is still denied; (b) the deny reason core emits — "it is allowed once the run terminates" — is a promise the composed system can never keep; (c) `gates-git.ts`'s `runActive:false` arms are reachable only from tests (P12). Fail-closed direction, so no enforcement hole — but it is a composed behavior the spec explicitly says the opposite of, and it will bite the first live operator who lets the model manage branches between runs. Fix direction: derive `runActive = run !== null && !isTerminal(run)` beside the other per-call derivations at the same seam.

---

### COMPOSITION-INJECTION-007 — §6.4's "fail-closed at init" is actually fail-closed at first conductor tool call: the beacon is written before packs load, and `initPlugin`'s ordering guarantee is dead code (MAJOR)

**Pattern:** P4 (the documented property "the beacon's ABSENCE proves init failed" is not implemented by the composition) + P12.
**Where:** `plugin/index.ts:419-455` (`ensureWorkspace` → `openWorkspace` writes `.conductor/state/alive.json` unconditionally, state.ts:738-739), `index.ts:664-684` (`ensurePacks`, called only from `assemble`), `inject.ts:290-304` (`initPlugin`, never called in production).

Plan §6.4:1902 ("Pack content is loaded once at plugin init... a missing pack file is a startup error (fail-closed at init, before any work)") and §3.8 ("§6.4's 'fail-closed at init' is only a real property if somebody can observe it having failed"). inject.ts's own header states the designed ordering: packs load FIRST, "the beacon is written... only once they all load", "so the beacon's ABSENCE proves init failed". The composition inverts it:
1. The plugin factory does no I/O (construction-safety, deliberately). Fine.
2. First hook use calls `ensureWorkspace`, which writes the §3.8 beacon — **before any pack is read**.
3. `chat.message` and `tool.execute.before` and `event` NEVER call `ensurePacks`. Delete the entire doctrine directory: the plugin loads, the beacon appears, a run is created on the first prompt, edits are gated, INTAKE state persists — "work" has begun in every observable sense — and the pack failure surfaces only when the first `conductor_*` stage tool is invoked.
4. `initPlugin` — the function whose whole contract is this ordering, unit-tested in inject.test.ts and named by Task 8.2's manifest step ("missing pack file at init throws AND the throw is journaled + the liveness beacon is NOT written, so §3.8's absence signal is real") — has zero production callers.

So the operator diagnostic OPERATIONS.md builds on ("the corroborating check is the §3.8 liveness beacon") cannot distinguish "conductor loaded with doctrine" from "conductor loaded and doctrine is missing/unreadable". Not a model-trust hole (tools do refuse), but the §3.8 observability contract — the only defense this design claims against its own absence — is weaker than documented. Fix direction: make `ensureWorkspace` (or a first-hook init step) call `ensurePacks` before `openWorkspace` writes the beacon, or stamp the beacon with a `doctrineLoaded` field a doctor can read.

---

### COMPOSITION-INJECTION-008 — The §3.8 conductor banner exists in OPERATIONS.md and nowhere else: the operator's "first rule" tests for a signal nothing emits (MAJOR)

**Pattern:** P9-adjacent (documentation asserting an observable no code produces); consequence of -001.
**Where:** plan §3.8:1487-1493 ("the orchestrator's first response in a session includes a one-line conductor banner (version + run id + model)"); `conductor/docs/OPERATIONS.md:7-12` ("**First rule: no banner, no conductor.**") and §9 troubleshooting ("the session has no banner" heads the list); no production source emits or instructs a banner — repo-wide grep for "banner" hits only OPERATIONS.md, ops-docs.test.ts (which pins the DOC, not the behavior), and the plan.

The banner could only reach "the orchestrator's first response" via injected instruction (the §6.4 system append telling the model to print it) or doctrine — core.md contains no banner instruction, and the injection layer is unwired (-001). Net effect today: **every session, healthy or broken, has no banner**, so an operator following OPERATIONS.md's first rule must conclude the plugin never loads. The doc's own test (`ops-docs.test.ts` [15.1-banner-entry-is-first]) is P13 in miniature: it proves the troubleshooting entry is well-formed and first, not that a banner can exist. Fix direction: wire -001 and put the banner line in the state block (or core.md), or rewrite OPERATIONS.md's first rule around the beacon + a real signal.

---

### COMPOSITION-INJECTION-009 — Registered sub-sessions may call every conductor_* tool: an implementer can answer its own blocking question, defer its own item, or amend the queue (MAJOR, shared with the tools/gates lens)

**Pattern:** enforcement gap at the composition seam (Part A: "what a lying model would get away with"), rooted in a plan-level gap (§3.5's table restricts `conductor_*` only for UNREGISTERED sessions).
**Where:** `core/gates-edit.ts:49-83` (`decideSession`: any registered session passes for any non-spawn class), `plugin/index.ts:1071-1185` (the bindings thread no caller identity except for `conductor_surface`'s `askedBy` and `conductor_override`'s itemId), `tools.ts:1057` (`handleAnswer` — no caller check).

Fan-out sub-sessions are real opencode sessions offered ALL registered tools (the fragment's per-agent `tools` restrictions do not apply — fan-out sessions are created with no `agent`, fanout.ts:257; and the fragment never disables `conductor_*` for sub-agents anyway). The registry gate allows any non-spawn call from a registered session; the handlers check phase legality, not caller role. So a dispatched implementer, mid-turn, may:
- `conductor_answer {questionId, answer}` — minting a §2.7 record attributed as a HUMAN answer no human gave, unblocking every item that named the question;
- `conductor_defer {itemId, reason}` — a "valid final disposition" for the very item it was asked to implement (the lazy model's cheapest exit);
- `conductor_queue_amend` — including an `update` op widening its own item's fileScope (the ops are validated for SHAPE by parseAmendOps, not for provenance);
- `conductor_mark_green`/`conductor_validate` — mostly harmless (the handlers re-derive mechanically), but each burns budgets and mutates attempt counters outside the driver's control.

The composition root demonstrably knows how to thread caller identity — it does so for `conductor_surface` ("Caller identity, not a model-supplied argument", index.ts:1095-1097) and reads the registry for `conductor_override` — and threads none for the others. Because the plan's own §3.5 table only restricts unregistered sessions, this is simultaneously a design finding: the closed table needs a row for "conductor_* from a non-orchestrator registered session" (probably: deny all except the receipt-adjacent ones, or all outright — sub-sessions communicate via receipts, not tools). Cross-filed as a pointer to the tools/handlers lens for the handler-side check.

**Not fully adversarially verified live** (would need a live model or a scripted sub-session tool call through the hook): but every link is verified in source — the gate's allow (`registered → ALLOW`), the binding's lack of identity threading, `handleAnswer`'s lack of caller checks — and the wire-contract proves custom tools are offered and executable in any session. Confidence high. The one unpinned link: whether `tool.execute.before` fires for PLUGIN-registered tools at 1.18.15 at all — wire-contract asserts it for `bash` only (see -010).

---

### COMPOSITION-INJECTION-010 — Nothing pins that `tool.execute.before` fires for plugin-registered tools, and the registry rule for conductor_* rests on exactly that (MINOR, evidence gap)

**Pattern:** P1 (a wire-contract suite that inspects less than the contract needs).
**Where:** `conductor/tests/wire-contract.test.ts:498-546` — the deny test asserts the before-hook fired for `bash`; the custom-tool test asserts registration + execution of `conductor_probe` but never asserts a `tool.execute.before` record for it.

§3.5's "any conductor_* tool [from an unregistered session] → deny" is enforced only if opencode dispatches the before-hook for custom plugin tools. Probably it does (the hook is tool-agnostic upstream), but this repo's discipline is that probable wire behavior is pinned behavior, and it is pinned for built-ins only. If 1.18.15 skipped the hook for plugin tools, every conductor_* call from every session would bypass `decideSession` — silently, with the suite green. Fix direction: one assertion in the existing custom-tool scenario (`findRecord(r => r.kind === "tool.execute.before" && r.data.tool === "conductor_probe")`).

---

### COMPOSITION-INJECTION-011 — The write-classified tool set and the editPath derivation disagree: `patch`/`apply_patch` calls carry no `filePath`, so a registered write-capable session's patch is scope-checked against nothing (MINOR, contingent)

**Pattern:** P1 (the gate inspects less than it appears: `classifyTool` names four write tools; the path derivation serves two).
**Where:** `plugin/index.ts:1330-1337` (`editPath` = `args.filePath ?? args.path`, only when `classifyTool(hook.tool) === "write"`), `tools.ts:136` (`WRITE_TOOLS = ["edit","write","patch","apply_patch"]`), `gateBeforeToolCall` (c)-arm runs only `if (input.editPath !== undefined)`.

For `edit`/`write`, opencode supplies `filePath` and the scope gate runs. For `patch`/`apply_patch` — present in 1.18.15's tool registry per wire-notes:37 — the paths live inside the patch TEXT, `filePath` is absent, `editPath` is undefined, and the (c)-arm never runs: the only check applied is `decideSession`, which ALLOWS any registered session. An implementer that can invoke `apply_patch` writes arbitrary repo paths — fileScope, testScope, `.conductor/**`, frozen trees — unchecked. Contingent on whether the tool is offered/invocable to sessions at 1.18.15 (wire-notes says it "exists in the tool registry" but is not in the offered list; a forced call to an unavailable tool redirects to `invalid`). Fail direction if invocable: OPEN. Fix direction: deny write-classified tools whose edit path cannot be derived (fail closed at the seam), and pin apply_patch's availability in the wire contract. The settling evidence: one live probe forcing `apply_patch` in a gated session.

---

### COMPOSITION-INJECTION-012 — The full parallel test gate is nondeterministically red on an unmutated HEAD tree, and the failing assertions are enforcement-load-bearing (MAJOR, cross-cutting — reproduced here, owned jointly with the tools/evidence lens and the macro review)

**Pattern:** new class, proposed name **P14 — enforcement that holds only when the machine is idle**: a check (or the enforcement it guards) whose verdict depends on system load.
**Evidence (all on the restored, byte-identical HEAD tree, sequential runs, no background processes):**
- Full run 1 (`node --test conductor/tests/*.test.ts`, 1382 tests): **fail 1** — `[C032-D2-stale-red] a vet re-entered after a repair cannot advance a PASSING test on the pre-repair red` (tools-9.4a-review.test.ts:494; the assertion shows the item ADVANCED to TEST_VETTED — i.e. the product advanced a passing test on a stale red).
- Full run 2: **fail 6** — `[13.1-non-behavioral]` plus five `9.2-decompose-*` rows (dag, size, behavioral-false-reject, behavioral-testscope, ponytail).
- Full run 3: **fail 1** — `[9.4b-fix-amend-validates-record-before-persist]`, "Missing expected exception: the refusal names the record it would not write" — i.e. under load, `conductor_queue_amend` ACCEPTED a §2.7 record that fails the DecisionRecord schema.
- `tools-9.4a-review.test.ts` standalone: **10/10 runs green.** Scoped `scripts/test-conductor.sh <file>` runs during this review: uniformly stable.
- The committed gate (`bash scripts/test-conductor.sh`, full) itself produced fail=1 and fail=6 runs on this tree, so the gate — not just bare `node --test` — is the flaky artifact.

**Why it matters beyond flakiness.** Two of the three observed failure shapes are not test-timing artifacts — they show the PRODUCT enforcing differently under parallel load (a stale-red guard missing; a schema refusal not thrown). Every recorded "GATE PASS" is a sample from a distribution; every mutation-goes-red verdict in any review (including this one — see the mutation table's method note) is polluted unless run scoped. Cause undiagnosed here (outside my subsystem); candidates include same-millisecond `Date.now()`/mtime collisions in freshness/stale-red comparisons. **Settling evidence:** loop the failing tests under artificial parallel load and read which comparison flips.

---

### COMPOSITION-INJECTION-013 — The doctrine anchor tests pin keywords, not claims: a pack asserting the OPPOSITE of its doctrine stays green (MINOR)

**Pattern:** P13-lite (a named test proving less than its title).
**Reproduced:** mutated `core.md`'s heading "Exhaustion stops the run" → "Exhaustion continues the run"; `doctrine.test.ts` 15/15 green. The anchors are `has(core, "exhaustion")` / `has(core, "env stop")` (doctrine.test.ts:286-292) — keyword presence, which a negated sentence ("exhaustion is never an env stop") satisfies equally. The test's title — "core.md states the override budget and that exhaustion stops the run" — claims a proposition; the assertions check vocabulary. Low severity while packs are hand-authored (and currently undelivered, -001), but these anchors are the only drift guard the doctrine has. Fix direction: anchor on the full normative sentences including their polarity.

---

### COMPOSITION-INJECTION-014 — The chat.message part-type filter is unpinned: including non-text parts in the prompt breaks nothing in the suite (MINOR)

**Pattern:** P11 (untested-but-correct).
**Reproduced by mutation:** replaced the `part.type === "text"` selection (plugin/index.ts:1274-1277) with push-everything; `composition.test.ts` + `composition-root.test.ts` + `gate-wiring.test.ts` all green. The adjacent comment claims "the builder selects by part TYPE, never by position" — nothing enforces it. A file-attachment or agent-marker part would silently join `run.json`'s recorded prompt (the durable §2.3 record of what the user asked). Fix direction: one test handing the hook a mixed-part message and asserting run.json's prompt is the text parts alone.

---

## 2. IDEA register

### IDEA-001 — Delete or pin `requireDeclaredArgs`
Origin: mutation M6 — disabling it entirely left composition-root/composition/gate-wiring/tool-binding green; every property it guards is re-enforced by `stringArg`/`stringsArg`/`amendOpsArg`/core `requireTwoOptions` refusals downstream.
Kind: test-maintainability / simplification.
Value: either it earns a test that distinguishes its refusal (its C-047 message is better than a raw wrongType message), or it is a second spelling of required-ness and can go.
Cost: small. Relates to: mutation table M6.

### IDEA-002 — core.md's `[[decompose]]` wiki-link resolves to nothing a model can follow
Origin: reading the nine packs. core.md:72 "The full reuse ladder lives in [[decompose]]" — model-facing text; the orchestrator (the only role that would ever receive core.md) is never given decompose.md nor told what `[[…]]` means.
Kind: docs/doctrine polish. Value: removes a dangling reference from the highest-traffic pack. Cost: one line. Relates to: -001, -003.

### IDEA-003 — Stamp `doctrineLoaded` (or a pack digest) into the §3.8 beacon
Origin: -007. `alive.json` says the plugin loaded; it cannot say doctrine did. A digest would also let a doctor detect a stale doctrine override.
Kind: tooling/observability. Cost: one field + one test. Relates to: -007, -008.

### IDEA-004 — Pre-run journal correlation uses `input.project.id` as `runId`
Origin: reading index.ts:385-389 and 1372. Pre-run gate denials and workspace events are journaled with `runId: prj_…`, which downstream tooling will group as if it were a run. A reserved sentinel would be more honest.
Kind: polish. Cost: trivial. Relates to: standalone.

### IDEA-005 — `ensurePacks` never re-reads changed pack CONTENT
Origin: index.ts:662-666 ("loaded ONCE PER DIRECTORY"). An operator editing doctrine mid-session (OPERATIONS.md §6 "Editing doctrine" implies support) is served the stale cache until the directory PATH changes. §6.4 says "loaded once at init", so conformant — but the OPERATIONS.md workflow and the cache disagree about what an edit does.
Kind: docs/ergonomics. Cost: document, or invalidate on mtime. Relates to: -004's override-theater corollary.

### IDEA-006 — Surface each live sub-session's `tree` in conductor_status/replay
Origin: the -005 reproduction leaned on the `subsession.dispatched` journal record's `tree` field; an operator debugging a wedged live run would too, and the slug/path split would have been visible on first live contact.
Kind: observability. Cost: small. Relates to: -005.

---

## 3. CROSS-LENS POINTERS

- **Tools/handlers lens:** `handleAnswer` (tools.ts:1057) takes no caller identity; conductor_answer/defer/queue_amend callable by registered sub-sessions (-009 has the composition half; the handler-side check is yours).
- **Tools/evidence lens:** the load-dependent enforcement lapses in -012 — `[C032-D2-stale-red]` (vet advanced a passing test on the pre-repair red under load) and `[9.4b-fix-amend-validates-record-before-persist]` (schema refusal not thrown under load) — need root-causing in the vet freshness re-derivation and the queue-amend validation path.
- **Gates lens:** write-classified TOOLS with underivable paths (`patch`/`apply_patch`, -011) skip the edit gate at the hook seam; separately, `python -c 'open(...,"w")'` / `node -e` fs writes / `xargs`-mediated writes are invisible to the bash write-shape extractor by design — confirm G7 documents these residuals.
- **Fanout lens:** fan-out sub-sessions are created with NO `agent` (fanout.ts:257), so the fragment's per-agent `edit: deny` / `question: "ask"` / `tools.task:false` protections apply to NO dispatched session; the registry gate is the only layer, though wire-notes discovery (iii) designed the per-agent denial as "the second layer".
- **Macro review:** the §8 manifest omits the task that registers the §6.4 hooks (-001) — a plan-completeness finding; the gate's run-to-run nondeterminism (-012) as a build-process reliability question; inject.ts as a fully-built, fully-tested module with zero production callers (dead-subsystem cost).
- **Capability review:** the state block (recommended-next-tool, §6.4(b)) is the single highest-leverage mechanism for a lazy 32k model and it currently reaches nobody (-001); per-role doctrine delivery likewise (-002/-003); per-role temperatures never applied (skeptics sample at the same temperature as planners).
- **Meta-audit (Part E):** C-028's completeness lens caught two inner "loaded ≠ delivered" instances and missed the outer one (buildSystemAppend itself undelivered); C-037 ruling 5 fixed one direction of the tree-identity split and the phase-9 gate accepted the theme as closed (-005). Both belong in the false-negative catalogue.
- **Wire-contract lens:** before-hook firing for plugin-registered tools is unpinned (-010).
- **Router lens:** with no `chat.headers` hook (-001), all conductor traffic reaches llama-router untagged — priority/affinity/schema-observation features observe nothing; the router's conformance dataset (a POC deliverable) will be structurally empty, and G5 router/no-router equivalence is trivially true rather than meaningfully proven (P9/C-089 adjacent).

---

## 4. Mutation table

Method note: all verdicts from SCOPED `bash scripts/test-conductor.sh <files>` runs — scoped runs proved stable; FULL-suite runs are nondeterministic at HEAD (-012), so no verdict below rests on one. Every file restored from a `cp` snapshot and proven byte-identical with `cmp` after each mutation.

| # | Mutation | File | Expectation | Result | Verdict |
|---|---|---|---|---|---|
| M1 | `gateScopesFor` returns `{fileScope:["**"],testScope:["**"]}` | plugin/index.ts | red | composition-root: 25/27, **2 fail** ([cr2-gate-scope-derived-from-registry], [cr2-widening-the-scope-goes-red]) | **BINDS** |
| M2 | `freezeTreeFor` returns null always | plugin/index.ts | red | composition-root: **1 fail** ([cr2-freeze-denies-only-its-own-tree]) | **BINDS** |
| M3 | `doctrineDirOf` ignores `LLAMA_HARNESS_DOCTRINE_DIR` | plugin/index.ts | red | composition-root: **1 fail** ([cr2-packs-missing-fails-closed]) | **BINDS** |
| M4 | `ensurePacks` returns `{}` (loadPacks never called) | plugin/index.ts | red | composition-root: **2 fail** (incl. [cr-packs-loaded-fail-closed]) | **BINDS** |
| M6 | `requireDeclaredArgs` body replaced with `return` | plugin/index.ts | red in [cr-args-passed-not-invented] | composition-root + composition + gate-wiring + tool-binding: **all green** (refusals re-enforced downstream by stringArg/amendOpsArg/core rules) | **SURVIVES** — seam unpinned, property held by deeper layers (IDEA-001) |
| M7 | `registryView.register` stores caller's object (copy dropped) | plugin/index.ts | red | composition.test.ts: **1 fail** ([5.4a-registration-reaches-the-gate] — the shared ORCHESTRATOR constant aliases trees across plugin instances) | **BINDS** |
| M8 | fanout `registry.set` drops `receivingReview` | adapter/fanout.ts | red | tools-9.5a: **1 fail** ([9.5a-receive-review-pack-delivered]) | **BINDS** at the registry-flag level (the flag drives nothing in production — -002) |
| M9 | inject.ts receive-review append arm disabled | adapter/inject.ts | red | tools-9.5a + inject: **1 fail** | **BINDS at unit level only** — the function has no production caller (-001) |
| M10 | chat-message `hasLiveRun` forced false (every prompt creates a run) | adapter/chat-message.ts | red | chat-message.test.ts: **2 fail** ([5.4-midrun], [5.4-registry]) | **BINDS** |
| M12 | chat.message part-TYPE filter removed (all parts join the prompt) | plugin/index.ts | red | composition + composition-root + gate-wiring: **all green** | **SURVIVES** → -014 |
| M13 | `seedOrchestratorEntry` body replaced with `return` | plugin/index.ts | red | continuation.test.ts: **1 fail** ([10.1-plugin-event-hook-routes]) | **BINDS** |
| M14 | core.md "Exhaustion stops the run" heading inverted to "continues" | doctrine/core.md | red | doctrine.test.ts: **15/15 green** | **SURVIVES** → -013 (keyword anchors admit negation) |
| E2E-1 (probe) | Real `ConductorPlugin` + fake SDK; item with `worktree:null` at TEST_VETTED; `conductor_mark_green` kicked; real gate hook driven with the dispatched implementer's in-scope edit AND a bash redirect | scratch harness (no repo files touched) | allow per §3.5 | **DENY both** — "the path is outside this session's tree"; run journal shows `role=implementer tree=main` | **-005 reproduced end-to-end** |
| E2E-2 (probe) | `decideEdit` direct: implementer/testWriter with `sessionTree:"main"` vs `"/repo"` | scratch | — | slug denies everything (abs and rel paths); path allows in-scope | **-005 mechanism isolated** |

Not mutated (recorded for honesty): `sameTree` trailing-slash tolerance (read-verified against gates-edit.ts:196-198's identical strip); `originOf` URL fallback; `stateCoordinates` XDG branch; PROVISIONAL_CLASSIFICATION shape (pinned by [5.4-create] per its assertions; not re-mutated); `runSetup`'s env plumbing (read only).

---

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion / IDs |
|---|---|---|---|
| `conductor/plugin/index.ts` (1427 ln) | Read in full; 8 mutations; e2e probe through the real factory | 100% read | -001, -005 (seam), -006, -007, -009 (binding half), -011, -014; M1-M4, M6, M7, M12, M13 |
| `conductor/adapter/inject.ts` (305 ln) | Read in full; production-caller census (repo-wide grep); M9 | 100% read | -001 (dead in production), -002, -003; ROLE_PACKS/TEMPERATURE/PRIORITY verified column-by-column against §4.1:1519-1527 — the tables are FAITHFUL, they are just never consulted |
| `conductor/adapter/chat-message.ts` (133 ln) | Read in full; M10; test census | 100% read | Sound. Run creation, midrun routing, idempotent registration, no-git coercion, stale report all pinned by chat-message.test.ts |
| `conductor/doctrine/core.md` | Read in full; M14 | 100% | -013, IDEA-002; content meets Task 8.1 constraints |
| `conductor/doctrine/{tdd,debug,decompose,plan,review,test-vet,skeptic,receive-review}.md` | Read in full | 100% | Content sound, ≤120 lines, client-agnostic, anchors present; delivery is the defect (-001/-002/-003), not authorship |
| `conductor/adapter/fanout.ts` (446 ln) | Read in full (delivery + registry seams); M8 | 100% read | No system/params/headers/agent on create/prompt (-001 evidence; agent pointer to fanout lens); registry-before-first-prompt verified in source |
| `conductor/adapter/tools.ts` (9253 ln) | Targeted: 91-520 (inventory, classifyTool, gateBeforeToolCall, override grants), doctrine-literal census (grep + spot reads at 1267/1471/1755/1787/2868), 2330-2420 (tree identity), 2986-3030, 3660-3690, 3830-3935, 4100-4230, 4485-4500, 4605-4620, 5780-5850, 6000-6050, 6190-6500, 7010-7070, 9005-9220 (setup answers + validation) | ~20% read — all seams my charter names | -002, -003, -004, -005 (sessionTreeOf), -009 (handleAnswer census); the rest belongs to the tools lens |
| `conductor/core/gates-edit.ts` (433 ln) | Read in full (the gate my snapshot feeds); direct-call probes | 100% | Empty-scope-denies verified by execution; normalize/`..`/freeze/`.conductor`/role order sound |
| `conductor/core/gates-git.ts` | Targeted: movement/runActive arms | ~15% | -006; the matrix belongs to the gates lens |
| `conductor/adapter/continuation.ts` | Targeted: resolveSessionTree, activeInlineClaimScope (270-400) | ~10% | SG-8/SG-9 derivations fail closed; verified in source |
| `conductor/adapter/evidence.ts` | Targeted: liveVerifyTrees/readMarker (640-729) | ~10% | Liveness rule (parse + pidAlive + age) matches the C-081 fix; read-only enumeration confirmed |
| `conductor/adapter/state.ts` | Targeted: beacon write (78, 251-260, 733-740) | ~5% | Beacon written unconditionally at openWorkspace (-007) |
| `conductor/adapter/config-io.ts` | Targeted: DEFAULT_CONFIG | ~10% | Fallback config is read-only/pin — restrictive direction confirmed |
| `conductor/opencode-fragment.json` | Read in full | 100% | Orchestrator core.md via `{file:}`; sub-agent definitions unused by fan-out (pointer) |
| `conductor/adapter/wire-notes.md` | Read in full | 100% | All three §6.4 hooks verified working at 1.18.15 — -001 is not an upstream limitation; grounds -010, -011 |
| `conductor/docs/OPERATIONS.md` | Targeted: banner + doctrine sections | ~15% | -008, IDEA-005 |
| `conductor/tests/composition-root.test.ts` (3235 ln) | Read ~40%: helpers (169-683), scope/freeze block (2421-2843), all 27 titles | high for my seams | cr2 block is real and binding (M1-M4); its worktree-only fixtures are exactly why -005 escaped |
| `conductor/tests/{inject,tools-9.5a,chat-message,doctrine,ops-docs,wire-contract}.test.ts` | Targeted reads | — | -002's P13 test identified (9.5a:1906/1934); -010 (wire-contract:498-546); -013 (doctrine:286-292) |
| Plan §0/§3.5/§3.8/§4.1/§4.2/§4.4/§6.4 + Tasks 5.3/8.1/8.2/12.2/13.1 | Read | the clauses my charter cites | Clause citations throughout |
| NOT examined | tools.ts handlers outside the seams above; gates-git full matrix; shell-parse.ts; state.ts store internals; journal.ts; evidence.ts beyond markers; quarantine.ts; worktrees.ts; router-client.ts; questions.ts; gitio.ts; config-io.ts beyond defaults; `router/`; `scripts/` | — | Other reviewers' scopes |

### Per-role gate-snapshot verdict (the charter's table), both tree modes

| Role | Scope derivation | Main mode (`writes:"off"`, default) | Worktree mode |
|---|---|---|---|
| orchestrator | no itemId → NO_GATE_SCOPE; edits only via inlineClaimScope; tree = store.root (resolveSessionTree) | correct (M1/M2 red; override-grant end-to-end pinned) | correct |
| implementer | itemId → persisted §2.4 fileScope | **broken — registry tree is the slug "main"; every write denied (-005)** | correct ([cr2] composition tests) |
| testWriter | itemId → persisted §2.4 testScope | **broken (-005)** | correct |
| reviewer / skeptic / planner / mechanical | scopes derived but READER_ROLES denies all edits | correct (deny) | correct (deny) |
| unregistered session | NO_GATE_SCOPE + registry-gate deny | correct | correct |
| failure paths (ws null / no run / queue unreadable / entry missing / slug untranslatable) | NO scope, or freeze on untranslatable slug | verified fail-closed (source + M1/M2 + direct decideEdit probes) | same |

---

## 6. Cleared areas — attacked and could not break

- **Fail-open on scope-derivation failure.** Tried: ws null, no registry entry, no itemId, currentRun throwing, queue.json unreadable, queue entry missing, marker slug untranslatable — every path derives NO scope or a freeze, and `decideEdit` with empty scopes DENIES (proven by direct call). The permissive-constant regression is pinned red by [13.1-cr2-widening-the-scope-goes-red] (M1).
- **The freeze derivation (worktree mode).** M2 red; deny-own-tree / allow-other-tree / lift-on-clear proven with real markers through the real hook. No freeze bypass constructible for a session whose tree is a real path.
- **The override grant seam.** One map, mint-and-spend proven end-to-end ([cr-override-grant-spendable]); no itemId → cannot mint ([cr-override-needs-registered-item]) nor spend (consumeOverrideGrant requires the entry's itemId); grant key includes sessionID, so no cross-session spend.
- **Doctrine load fail-closed at the TOOL seam.** M3/M4 red: a missing or overridden-away pack directory refuses conductor tools naming the absent pack. (The INIT-time half is -007; the tool-time half holds.)
- **The registry copy boundary.** M7 red — the cross-session aliasing the copy prevents is caught.
- **chat.message run-creation discipline.** M10 red in both directions (midrun never creates; terminal always creates); no-git coercion pinned by [5.4-nogit].
- **conductor_setup's `answers` cast.** Attacked the unvalidated `args.answers as SetupInput["answers"]` cast with an out-of-vocabulary gitMode in mind — cleared: `handleSetup` validates the whole candidate against the §2.1 Config schema (`validate("Config", candidate)`, tools.ts ~9212) before any write, and a refusal writes nothing.
- **DEFAULT_CONFIG fallback direction.** `git.mode:"read-only"`, `branchPolicy:"pin"`, `behavioralPaths:["**"]` — an unopenable workspace is gated MORE strictly, not less.
- **The tool inventory loop.** Keys exactly the 22 CONDUCTOR_TOOL_NAMES ([cr-inventory-still-exact]); a name missing from `specs` degrades to an argument-free definition whose handler-side refusals still hold (M6).
- **`sameTree` tolerance.** Strips exactly what gates-edit.ts:196-198 strips (trailing slashes); no divergent normalization found on either side.
- **Marker single-sourcing.** `verify-running-` lives in one non-test source file ([cr-marker-enumeration-single-source]); liveVerifyTrees applies the verify path's own liveness rule, dead/over-age markers absent from the result and untouched on disk ([cr-live-means-live-not-present]).

---

## 7. Post-review hygiene

- All snapshotted files (`plugin/index.ts`, `adapter/inject.ts`, `adapter/chat-message.ts`, `adapter/fanout.ts`, `doctrine/core.md`) restored and proven byte-identical with `cmp` after every mutation.
- No spawned processes left: `ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\.sleep"` clean at finish (re-checked below).
- Scratch artifacts (repro scripts, TAP captures, snapshots) live in the session scratchpad only; nothing written into the repo besides this register.
