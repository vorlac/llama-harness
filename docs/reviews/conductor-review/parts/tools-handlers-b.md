# Enforcement Review — Part: Tools Handlers B (VALIDATE through close)

**Scope:** `conductor/adapter/tools.ts` — the second half of the handler layer: `validate`,
`item_review`, `publish`, `report`, the meta tools (`surface`, `answer`, `defer`, `decide`,
`queue_amend`, `inline_claim`, `override`, `status`, `forget_stale`), `setup`, and the wave
driver, plus the §3.6 override budget end to end (mint → spend → exhaustion). Central question
per the charter: at each point, is the model's claim re-derived by the harness or accepted on
trust — and can a model spend its way around a gate?

**Date:** 2026-08-15
**Reviewer:** tools-handlers-b sub-agent (step-2 enforcement review)

Line numbers reference `conductor/adapter/tools.ts` at the tree as reviewed (HEAD ce05498 +
uncommitted docs). All other files named explicitly.

---

## 1. ISSUE register

### TOOLS-HANDLERS-B-001 — Meta handlers skip the phase-order gate entirely; `conductor_report` also consults the run FSM with a hardcoded from-state

- **Pattern:** P4 (a check whose name asserts a property it does not implement) + spec
  nonconformance (§3.1) + P7 (composition).
- **Severity:** MAJOR.
- **Where:** `tools.ts` — `handleReport` (7417–7680, esp. 7640), `handleQueueAmend` (4710),
  `handleInlineClaim` (7739), `handleOverride` (7874), `handleDefer` (1153), `handleDecide`
  (873), `handleSurface` (968). Cross-checked: `legalTools` has exactly TWO production call
  sites — `requireStageTool` (tools.ts:2621) and `waveVerdict` (tools.ts:5154). Nothing else
  in the plugin or the handlers consults it.
- **Claim:** Plan §3.1 states: *"the phase-order gate denies every conductor tool not in
  `legal`."* That gate exists only for the six stage tools (submit_test/vet_test/mark_green/
  validate/item_review/publish, via `requireStageTool`) and dispatch_wave (via `waveVerdict`).
  Every meta handler performs only ad-hoc existence checks. Consequences, each verified by
  reading the code path end to end:
  1. **`conductor_report` is callable in ANY run state** where `queue.json` exists and all
     items are blocked/deferred/published. Its one FSM consultation is
     `legalRunTransition("EXECUTING", target, …)` (tools.ts:7640) — the from-state is a
     **string literal**, not `run.state` (contrast `handleDispatchWave`, 5239, which passes
     `run.state`). `core/fsm-run.ts legalRunTransition(from, to, ctx)` trusts the caller's
     `from`, so the check cannot refuse a run that is actually at DECOMPOSED or
     PLAN_REVIEWED; line 7656 then writes `run.state = target` over whatever was there.
  2. **Lazy-path exploit (reproduced — see the adversary log):** classify(work) → decompose →
     `conductor_defer` every item (defer checks only that the item exists, any state) →
     `conductor_report`. `settledForReport` counts deferred items as settled; the closing
     verify runs green on the untouched tree; the run goes DECOMPOSED → REPORTED with stop
     `done`, skipping PLANNED, PLAN_REVIEWED and EXECUTING entirely. The report discloses the
     deferrals, but the run FSM's ordering — the thing §3.1 calls structurally enforced — was
     never consulted.
  3. **`conductor_inline_claim` on a terminal run reopens G8.** handleInlineClaim checks only
     that the item exists. On a REPORTED run (whose `current-run.json` still points at it),
     the model can mint a claim; `activeInlineClaimScope` (continuation.ts:329) checks item
     state ≠ PUBLISHED but never run terminality; the plugin feeds that scope into the edit
     gate. Result: the orchestrator regains edit permission over the item's fileScope after
     the run closed, with no FSM active and no report ever to disclose what it does next.
     legalTools on a terminal run legalizes exactly `conductor_status` + `conductor_answer` —
     but nobody asks it.
  4. **`conductor_queue_amend`, `conductor_decide`, `conductor_surface`, `conductor_defer`,
     `conductor_override` all operate on terminal runs**, mutating queue.json, minting items,
     appending to a closed run's ledgers, and (override) minting live gate-bypass grants.
- **What a lying/lazy model gets away with:** closing a run `done` without ever planning or
  executing; post-mortem edits under a dead run's inline claim; ledger pollution after close.
- **Refutation attempted:** Is the ad-hoc legality "equivalent"? No — none of the meta
  handlers reads `run.state` or `run.stop` at all (verified by reading each). Is report's
  hardcoded "EXECUTING" defensible because report *should* only be reachable in EXECUTING?
  That is precisely the assumption the phase-order gate was specified to enforce; hardcoding
  the premise into the check makes the check unable to fail (P4).
- **Fix direction:** one shared `requireMetaTool(tool, store, runId)` that consults
  `legalTools` exactly as `requireStageTool` does; `handleReport` passes `run.state` to
  `legalRunTransition`.
- **Confidence:** high (code-trace + call-site enumeration + reproduction of (2) — see
  mutation/repro table row R1).

### TOOLS-HANDLERS-B-002 — The §3.6 override `gate` argument is a free string; the phase-order gate has no consumption point; a misspelled gate burns the budget and can kill the run

- **Pattern:** P3 (two spellings of one fact: the gate-name vocabulary exists only implicitly
  as three literals at consumption sites) + P12 (the plan's own worked example is a path
  nothing can walk).
- **Severity:** MAJOR.
- **Where:** mint: `handleOverride` (tools.ts:7973, key = `{sessionID, gate, itemId}` with
  `gate` = raw model string; plugin arg `gate: S.string()`, plugin/index.ts:597). Spend:
  `consumeOverrideGrant` (tools.ts:314–338), called with exactly three literals — `"session"`
  (381), `"git"` (409), `"edit"` (420/436). No other consumption point exists (grep
  `consumeOverrideGrant` repo-wide).
- **Claim:**
  1. Only overrides whose `gate` is exactly `"session"`, `"git"` or `"edit"` can ever be
     spent. **No closed vocabulary validates the argument**, and neither the doctrine
     (`conductor/doctrine/core.md` §"The override budget" — read in full, names no gate ids)
     nor any deny message names those three strings. The model has no in-band way to learn
     them.
  2. The **phase-order gate cannot be overridden at all**: stage-handler refusals
     (`requireStageTool`) never consult `overrideGrants`. Yet the plan's §2.8 example anomaly
     is literally `{"kind":"override","gate":"phase-order","grantedAction":"conductor_mark_green"}`
     — the plan's own worked example of the hatch is unimplementable.
  3. A granted-but-unspendable override still: appends the anomaly, taints the item,
     increments **both** budget meters (tools.ts:7960–7970), and returns `granted: true`.
     Two such calls (default `maxOverridesPerRun: 2`) exhaust the run budget; the third
     attempt records an `env` stop and terminates the run. So a model that *tries to use the
     hatch as documented* — with any gate name other than three undocumented literals —
     spends the budget on nothing and then kills the run.
- **What this means for the charter question:** a model cannot spend its way *around* a gate
  it cannot name; but the budget's failure mode is inverted — honest use of the hatch is what
  gets punished, and the taint/anomaly trail records overrides that never bypassed anything
  (the report will show taint for gates that never opened — the trail lies in the model's
  disfavor, which is still a lie).
- **Refutation attempted:** perhaps grantedAction-based consumption exists elsewhere?
  Searched for `grantedAction` consumers: it is carried into the grant and journaled, never
  compared against the next action — so the "exactly ONE next action" in §3.6 is actually
  "exactly one next *denied decision of that gate class in that session for that item*",
  a weaker rule (any first deny of that class is converted, whatever the action). That is a
  second, smaller spelling drift inside the same hatch.
- **Fix direction:** closed `OVERRIDE_GATES` vocabulary validated at mint time (refuse an
  unknown gate BEFORE spending budget); a consumption point for phase-order refusals or an
  explicit plan deviation record; optionally compare `grantedAction` at spend time.
- **Confidence:** high (code trace; consumption sites enumerated; doctrine read in full).

### TOOLS-HANDLERS-B-003 — Item-review skeptic adjudication keys on model-authored finding ids: cross-session id collisions collapse distinct findings onto one verdict

- **Pattern:** new-ish; nearest is P1 (the adjudication inspects less than it appears to).
  Plain correctness bug with an enforcement consequence.
- **Severity:** MAJOR.
- **Where:** `handleItemReview` → `adjudicate` (tools.ts:6178–6231): panels are built
  positionally (correct), but the outcome is `outcome.set(entry.finding.id, …)` and consumed
  as `raised.filter((entry) => survivesById.get(entry.finding.id) === true)` (6419–6422);
  `deadIds` (6451) and pushback matching (6477–6494) also key on `finding.id`.
- **Claim:** finding ids are authored by each lens sub-session independently; the §2.10
  schema's example id is `"F1"` and the lens prompt asks for "a short stable id"
  (tools.ts:5717). Six independent sessions numbering their findings F1, F2… will collide
  with near-certainty. When two findings share an id: (a) `outcome.set` overwrites — both
  findings receive the LAST-computed verdict, so a finding upheld by its own panel is
  silently dropped when its id-twin was refuted (a review finding disappears without its
  panel's verdict), and the reverse (a refuted finding survives). (b) Pushback matching is
  `concern.includes(finding.id)` — with ids "F1" and "F10", a concern naming F10 also
  matches F1, so F1 is adjudicated on F10's reasoning and can be added to `deadIds` (dies
  with no fix and no adjudication of its own).
- **Failure scenario:** lens A returns `{id:"F1", lens:"guardrail", claim:<real security
  hole>}`; lens B returns `{id:"F1", lens:"minimality", claim:<style nit>}`. A's panel
  upholds, B's panel refutes; B's entry is processed second → `survivesById["F1"] = false` →
  the security finding is dropped and the item advances to REVIEWED.
- **Refutation attempted:** does the fan-out engine namespace ids per session? No — the
  Findings value is taken verbatim (6398–6415); nothing rewrites `finding.id`. Does severity
  or lens participate in the key? No.
- **Fix direction:** key adjudication on the `ItemRaisedFinding` entry (index/identity), not
  on `finding.id`; namespace ids as `<sessionID>:<id>` for prompts and matching; make
  pushback matching exact-token, not substring.
- **Confidence:** high (code trace; the collision precondition is the schema's own example).

### TOOLS-HANDLERS-B-004 — Publish freshness hardcodes `hasStagedDeletion: false`: a post-validate deletion ships on a verify that never judged it

- **Pattern:** P4 (the call names the §2.6 rule and then disables half of it) / P11.
- **Severity:** MAJOR.
- **Where:** `handlePublish` step 4, tools.ts:7006–7017. `verifyFreshFor` is called with
  `indexMtimeMs: indexMtimeMs(treeRoot)` **and** `hasStagedDeletion: false` — and
  `core/freshness.ts:74` only consults `indexMtimeMs` when `hasStagedDeletion` is true, so
  the computed index mtime is dead weight.
- **Claim:** §2.6's freshness condition 1 is `startedMs >= max(worktree mtimes …, index
  mtime when any staged behavioral entry is a deletion/rename)`. Publish takes deliberate
  care to SHIP deletions (`trackedPaths`, tools.ts:6944: a tracked-but-absent path stays in
  the pathspec so `git add`/`git commit` record the removal) — and then computes freshness
  over `staged.filter(existsSync)` only. A change whose only post-validate edit is deleting
  a staged file leaves every surviving file's mtime older than `startedMs` and HEAD
  unmoved: `fresh` passes, no auto re-verify runs, and the commit ships a tree state (the
  deletion) that no verify record describes. Concretely: item validates green; a review-fix
  or inline-claim edit deletes `src/helper.ts` (inside fileScope); nothing else changes;
  publish commits the deletion against the pre-deletion verify.
- **Detection:** the code detectably KNOWS which paths are deletions —
  `tracked.has(rel) && !existsSync(...)` — and never sets the flag from it.
- **Mutation evidence:** flipping the literal to `true` leaves the entire suite green
  (mutation table row M2) — no test pins either value of this flag at the publish call
  site, so the §2.6 deletion term is unenforced AND untested (P11).
- **Fix direction:** `hasStagedDeletion: staged.some((rel) => !existsSync(path.join(treeRoot, rel)))`.
- **Confidence:** high (code trace + core/freshness.ts read + mutation).

### TOOLS-HANDLERS-B-005 — §2.1 `{file}` substitution for format rules is unimplemented; check-mode rules deny every publish; the format tests cannot see it

- **Pattern:** P12 (a path nothing has walked) + P13 (a named test proving the wrong thing)
  + spec nonconformance (§2.1:530–541).
- **Severity:** MAJOR (for any repo that configures format rules — setup proposes none, so
  today the path is latent; §2.1's own example config is broken as written).
- **Where:** `handlePublish` step 3, tools.ts:6948–6996: `spawnSync(rule.command[0],
  rule.command.slice(1), …)` — no `{file}` substitution and no appended path, in either
  mode. Repo-wide grep for a substitution: none exists outside `substituteItemTest` (which
  handles `{files}/{dirs}/{name}` for test templates only).
- **Claim:** §2.1 specifies stdin mode "( {file} substituted for --stdin-filepath-style
  flags)" and check mode "command runs with {file} substituted". Neither happens. A rule
  like the §2.1 example `["prettier", "--stdin-filepath", "{file}"]` passes the literal
  string `{file}` to prettier. A check-mode rule that needs the filename receives no
  filename at all: it fails on every file → "dirty" → **publish permanently denied** for
  every matching path.
- **Test vacuity (proven by experiment):** `tests/tools-9.5b.test.ts` CHECK_FORMATTER reads
  `process.argv[2]` — which is always `undefined` because publish passes nothing — so
  `readFileSync(undefined)` throws and the formatter exits non-zero **for every input**. The
  test writes `BADFMT` into the file and asserts denial; the denial fires identically for a
  clean file. Experiment: running the fixture script with no argv exits 1 (TypeError), with
  a clean file exits 0 — publish can only ever produce the first case. The test named
  "check mode denies on a non-zero exit" passes for the wrong reason and cannot distinguish
  "the formatter judged the file dirty" from "the formatter never received the file"
  (mutation table row M1).
- **Fix direction:** substitute `{file}` across `rule.command` before spawning (mirroring
  `substituteItemTest`); make the check-mode fixture actually read the substituted path and
  add the counter-case (clean file ⇒ publish proceeds).
- **Confidence:** high (grep + experiment).

### TOOLS-HANDLERS-B-006 — `conductor_setup` accepts `answers.behavioralPaths: []` from the model: one tool call turns the TDD law off for the whole repo

- **Pattern:** enforcement (harness believes rather than knows) + P8 flavor (the "asked,
  never defaulted" guarantee is enforced as "some argument was passed").
- **Severity:** MAJOR.
- **Where:** `handleSetup` tools.ts:9100 (`answers.behavioralPaths === undefined` is the
  only gate; an empty array passes) and 9152 (`candidate.verify.behavioralPaths =
  [...(answers.behavioralPaths ?? [])]`). The `answers` object is a model-suppliable tool
  argument (plugin/index.ts:616–626).
- **Claim:** §2.1 says behavioralPaths "is asked, never silently defaulted — a wrong value
  here is the difference between an enforced TDD law and an optional one." The ask is
  produced, but the ANSWER is relayed by the model, and no mechanical property of it is
  checked: `[]` (or a list disjoint from every detected source glob) validates and writes.
  With `behavioralPaths: []`, `behavioral:false` becomes legal for every item (∅-intersection
  is vacuously true), so decompose can mark everything non-behavioral and the whole
  RED→vet→GREEN machine is skipped repo-wide, mechanically and silently. On a fresh repo the
  model must pass setup answers anyway (the human's reply arrives as chat text the model
  relays), so the fabrication is indistinguishable from a real answer; on a configured repo
  `reconfigure:true` (no live run) reopens the same door mid-engagement.
- **What a lying model gets away with:** the complete §0.1 shortcut — no test ever owed —
  while `report.md` still claims a disciplined process (items legitimately show
  behavioral:false).
- **Refutation attempted:** does `validateQueue` or decompose floor behavioralPaths? No —
  the disjointness check is against whatever the config holds. Does the config schema set
  minItems? No (validate("Config") passes `[]`).
- **Fix direction:** refuse `behavioralPaths: []` (and warn/refuse when it intersects no
  detected sourceGlob) unless an explicit `acknowledgeNoTdd: true`-style answer is also
  passed; journal the answered values at info so the relay is at least auditable.
- **Confidence:** high (code trace; the schema-validation claim checked against
  SCHEMAS.Config usage in setup).

### TOOLS-HANDLERS-B-007 — `conductor_answer` is the model's own tool and answered questions vanish from the report: the human-in-the-loop can be fully simulated

- **Pattern:** enforcement (ACCEPTED ON TRUST at the exact point the design routes authority
  to the human).
- **Severity:** MAJOR (as an evidence-strength finding; the wire contract may make full
  enforcement impossible, but the disclosure half is mechanical and absent).
- **Where:** `handleAnswer` (tools.ts:1057) — no check of who authored the answer;
  `gates-phase.ts` legalizes `conductor_answer` whenever any question is open (and on
  terminal runs); `reportQuestionLines` (tools.ts:7388–7392) filters to `answeredIso ===
  null`, so an answered question appears NOWHERE in report.md — not in full, lite, or
  stop-report mode.
- **Claim:** every blocked item and every human-territory refusal (including handleDecide's
  C-029(b) refusal, which tells the model to "record the human's answer with kind:human")
  funnels to a §2.11 question whose resolution is a tool call the model itself may make with
  fabricated text. The harness re-derives nothing about an answer (any string clears the
  block), and the one place a human would audit the exchange — the report — omits answered
  questions entirely. A lazy model can: surface → immediately self-answer → proceed, and the
  final report shows no trace unless the reader opens questions.jsonl.
- **Refutation attempted:** is there a chat-hook rule that only a human turn may precede
  conductor_answer? Searched continuation.ts and plugin chat handling for such a coupling:
  none. Is self-answering maybe legitimate for non-human-territory questions? Yes — which is
  why the fix is disclosure plus (optionally) restricting answer for `humanTerritory: true`
  questions to a session state where a human message arrived after the question was minted.
- **Fix direction:** report section "Questions answered during this run" with question,
  answer, and asker; optionally gate answer on message provenance for humanTerritory
  questions.
- **Confidence:** high for the mechanics; the "cannot enforce provenance" half is a design
  limit, the "report hides it" half is a plain gap.

### TOOLS-HANDLERS-B-008 — `handleDefer` writes `kind:"human"` decision records for model-initiated deferrals

- **Pattern:** P3 (two spellings of "human ⇒ was asked") — and the codebase's OWN C-044
  ruling, encoded one file away, says the opposite.
- **Severity:** MEDIUM.
- **Where:** tools.ts:1167–1176 (`kind: "human"`, comment: "exempt from requireTwoOptions").
  Contrast `core/tool-bindings.ts:201–203`: *"C-044 ruling: a decision recorded through a
  tool call was not asked of a human (§2.7 'human ⇒ was asked'), so kind is always 'derived'
  here"* — the rule the binding enforces for `conductor_decide` and that `conductor_defer`
  (also a tool call) evades one layer down.
- **Claim:** §2.7 defines `kind:"human"` as "was asked (§6.2)". Every model deferral thus
  fabricates a human-authority record. A human auditing decisions.jsonl for "what was I
  asked" (or the §6.2 asked-question count) sees deferrals they never saw. It also creates
  the same dodge handleDecide's C-029(b) closes: deferring is a way to settle "not this run"
  on human authority without a question ever being surfaced.
- **Fix direction:** `kind:"derived"` with a single unscored option is the honest record; if
  requireTwoOptions blocks that, exempt defer by option-count rule, not by lying about kind.
- **Confidence:** high.

### TOOLS-HANDLERS-B-009 — Worktree-mode publish recovery wedges: after a merge-back conflict (or red integrated verify) the re-publish finds "nothing to commit" and the item can never publish

- **Pattern:** P7 (individually-correct rules composing into a hole) + P12 (no test walks
  the second publish attempt).
- **Severity:** MAJOR under `parallel.writes:"worktrees"` (default is "off").
- **Where:** `handlePublish` tools.ts:7151–7187 (conflict → `demoteReviewedToGreen`,
  "this item's commit stays on its own branch") and 7116–7125 (`git commit … -- <staged>`
  denies on non-zero exit).
- **Claim / trace:** the conflict path assumes the item will "re-validate and try again"
  (§4.2: "a conflict anyway ⇒ the later item drops to GREEN and re-validates"). But the
  item's changes were already committed on its worktree branch (step 6 succeeded — the
  merge-back only runs when `commit !== null`). After demotion: validate (GREEN→VALIDATED,
  worktree clean, verify green, records the NEW worktree HEAD) → item_review → publish
  again: step 1 head check passes (fresh record), step 2 stages the same paths, freshness is
  fresh, step 6 runs `git commit -- <paths>` on a clean tree → **git exits 1 ("nothing to
  commit")** → `publishDenial("git commit failed")` — forever. The same holds for the red
  integrated-verify path (7218–7236): the worktree commit exists, so every retry dies at
  step 6. The member env-fails each wave; the continuation engine re-prompts; the signature
  never changes; the run ends `noop` — the wedge shape C-085 was about, one layer up.
- **Refutation attempted:** does `mergeBack` un-commit the worktree branch on conflict? Read
  `adapter/worktrees.ts mergeBack`: it aborts the MERGE in the workspace; the worktree
  branch keeps its commit (and the handler comment says so). Could publish skip to
  merge-back when the tree is clean but the branch is ahead? Nothing implements that.
  Could a review fix in between create new changes making commit succeed? Only
  incidentally; the recovery path as designed requires none.
- **Fix direction:** publish should treat "clean tree, branch ahead of workspace base" as
  "commit already exists — proceed to merge-back", e.g. tolerate the nothing-to-commit exit
  when HEAD already differs from the branch base, or record the publish position in the
  item.
- **Confidence:** high on the trace; not run live (needs a worktree bench); no existing test
  drives a second publish after a conflict (checked tools-9.6/9.5b for it — none does).

### TOOLS-HANDLERS-B-010 — `conductor_report` closes a run `done` on a RED closing verify

- **Pattern:** enforcement posture + P8-flavored spec tension.
- **Severity:** MEDIUM.
- **Where:** tools.ts:7562–7573 (guards only the empty-scope vacuity), 7617 (renders
  green-or-RED), 7639–7658 (transition + stop `done` unconditionally on `record.green`).
- **Claim:** the closing verify's result is rendered but not consulted: a run whose blocked
  item left broken PRODUCTION edits in the tree (only its below-GREEN *test* files are
  quarantined; its fileScope edits are not reverted) closes REPORTED with stop `done`,
  reasonDisplay "...closing verify RED". §3.2 calls this verify "the
  verification-before-completion law made mechanical" — a law that cannot fail the
  completion is advisory. Additionally §2.9's `done` row reads "every item PUBLISHED or
  explicitly deferred with reason", while `settledForReport` (correctly, per §3.2's REPORTED
  paragraph) also admits `blocked` — the two plan clauses disagree and the code silently
  picks one; a `blocked`-laden run recording stop `done` contradicts §2.9's own vocabulary
  (the `blocked` stop kind exists for it).
- **Fix direction:** either (a) a red closing verify records stop `blocked`/`env` (with the
  report as stop-report), or (b) an explicit plan deviation note; reconcile §2.9's done row
  with §3.2.
- **Confidence:** high on behavior; the "which is right" half is a plan-owner call.

### TOOLS-HANDLERS-B-011 — Review-fix routing matches raw scope strings inside `suggestedFix`: glob scopes route test findings to the implementer (the guaranteed-denial path §3.3 warns about)

- **Pattern:** P1 (the router inspects less than it appears to).
- **Severity:** MEDIUM.
- **Where:** `routeOf`, tools.ts:6261–6269: `fix.includes(rel)` over raw `testScope` /
  `fileScope` ENTRIES.
- **Claim:** §2.4 scopes are globs (the plan's own example: `"tests/parser/**"`). A finding
  whose `suggestedFix` says "add a case to tests/parser/empty.test.ts" does not contain the
  literal `tests/parser/**`, so `namesTest` is false; unless the model also self-labels the
  finding `lens:"test-adequacy"`, it routes to the implementer, whose edit gate is bound to
  fileScope — §3.3's own text calls this exact routing "a guaranteed deny, three wasted
  review rounds, and a surfaced question." The tests pass because every 9.5a fixture
  declares literal file paths as scopes (checked), so the substring match holds in tests and
  fails on the plan's own scope shapes. Note also `lens` is the model's self-declared field
  (6414) — nothing checks it against the session's assigned LENSES line, so the
  quality-lens discard rule (6428) and this routing both run on unverified attribution.
- **Fix direction:** extract path-like tokens from `suggestedFix` and `globMatch` them
  against the scopes; validate `finding.lens ∈ session.group`.
- **Confidence:** high.

### TOOLS-HANDLERS-B-012 — A red re-validate inside item_review throws into a state no tool can service (VALIDATED + broken tree): the run ends `noop` instead of entering DEBUG

- **Pattern:** P7 (composition), bounded by the futility detector so it ends loudly — but
  wrongly.
- **Severity:** MEDIUM.
- **Where:** `revalidate` (tools.ts:6062–6073) throws when red; publish's equivalent path
  demotes to GREEN + debugging (7048–7067) — the two siblings disagree.
- **Claim:** review fix regresses the full verify → `revalidate()` throws ("which is
  conductor_validate's DEBUG business — review cannot proceed past it") → item stays
  VALIDATED. But `conductor_validate` is only offered to GREEN items, so the named remedy is
  illegal; the only offered tool is item_review, which re-runs lenses+skeptics+fixes and
  throws again at (2f) unless the fixer incidentally repairs the tree. Nothing persists
  between attempts (the throw path saves no attempts counter), so the run-state signature
  never changes and three futile re-prompts end the run `noop` — burning up to three full
  review fan-outs on the way and never arming the DEBUG protocol that exists for exactly
  this failure. The escape hatch that DOES exist (publish's stale-freshness auto-reverify →
  demote to GREEN) is only reachable if a review round happens to come back clean over the
  broken tree — i.e. the recovery path requires the reviewers to fail.
- **Fix direction:** on red re-validate, demote to GREEN with `debugging` set (the publish
  precedent, `demoteReviewedToGreen` is sitting right there) instead of throwing.
- **Confidence:** high on trace.

### TOOLS-HANDLERS-B-013 — `probeReverted` swallows a failed `git stash pop`: the item's implementation can be silently left in the stash

- **Pattern:** P11 / crash-safety.
- **Severity:** MEDIUM-LOW (narrow trigger, ugly blast radius).
- **Where:** tools.ts:6277–6290 — `finally { runReviewGit(tree.root, ["stash", "pop"]); }`;
  the status is discarded, nothing journals, nothing throws.
- **Claim:** between push and pop the item test runs; a test or build step that creates or
  modifies a fileScope-matching file makes the pop conflict; git leaves the changes stashed.
  The tree now lacks the implementation; the subsequent re-validate goes red and item_review
  throws "the fix regressed the verify" (see -012) — a misdiagnosis pointing at the fixer
  while the code sits in `refs/stash`, unmentioned by any journal or report line.
- **Fix direction:** check pop status; on failure journal at error with the stash ref and
  block the item naming the stash.
- **Confidence:** high on the code; the trigger needs a test-run that writes into fileScope
  (not exotic for build-artifact-adjacent scopes).

### TOOLS-HANDLERS-B-014 — dispatch_wave's abandonment fence covers only the StateStore: an abandoned stage keeps appending evidence, questions, decisions and keeps dispatching sub-sessions

- **Pattern:** P4 (the fence's comment claims "may no longer read or write the run's state";
  the ledgers are the run's state too).
- **Severity:** MEDIUM.
- **Where:** `fenceStore` (tools.ts:4985–5007) proxies StateStore methods only; stage
  handlers also write via `appendQuestion`, `appendDecision`, `appendPublishBatch`,
  `appendAnomaly`, `evidence.runVerify/runTest` (evidence.jsonl + markers + quarantine) and
  dispatch through `fanout` — none of which pass through the fence.
- **Claim:** after the held-job budget expires the driver reports the member stopped and the
  next wave may reschedule the item; the abandoned stage can still: mint a §2.11 question
  that blocks the item (racing the new attempt's view), append verify/red evidence records
  attributed to the item, take the tree's verify marker, and burn fan-out budget. The
  double-FSM-write is fenced (good); the double-LEDGER-write is not.
- **Fix direction:** thread an `abandoned` check into the stage journal + a fenced facade
  over the ledger appenders and the fanout handle in StageExecutorContext.
- **Confidence:** high on the trace; triggering needs the held-budget expiry (itself only
  reachable when a freeze was observed at dispatch).

### TOOLS-HANDLERS-B-015 — item_review's re-validates never update `item.evidence.validated`; publish re-verifies work it already has a fresher record for

- **Pattern:** inefficiency + a small honesty gap in §2.5's evidence refs.
- **Severity:** LOW.
- **Where:** `revalidate` (tools.ts:6036) returns the record; nothing writes
  `item.evidence.validated = {seq}` (contrast handleValidate:4633).
- **Claim:** after any fix round, the freshest verify evidence exists only as a ledger line;
  the item still points at the pre-fix record. Publish then reads the stale ref, finds
  freshness stale (fix edits moved mtimes), and re-runs the entire verify — one full suite
  run per reviewed-with-fixes item, structurally guaranteed. Also `report.md`'s per-item
  evidence refs point at superseded records.
- **Fix direction:** update the ref after each green re-validate.
- **Confidence:** high.

### TOOLS-HANDLERS-B-016 — `setupLiveRunId` fails open on an unreadable current-run pointer

- **Pattern:** P4 (the guard's own comment argues the opposite rule one line below).
- **Severity:** LOW.
- **Where:** tools.ts:8976–8999: pointer read failure → `return null` (= "no live run"),
  while the run.json read failure THROWS with "whether a run is live cannot be established".
- **Claim:** a torn `current-run.json` (the crash window writeFileAtomicSync exists for,
  but any hand edit or partial disk state too) lets `reconfigure:true` proceed under a
  possibly-live run — the exact hazard the guard names.
- **Fix direction:** treat an unreadable pointer like an unreadable run.json (throw).
- **Confidence:** high.

### TOOLS-HANDLERS-B-017 — Publish advances an item to PUBLISHED having staged zero files, silently

- **Pattern:** enforcement posture (a no-op "publish" is a legal terminal success).
- **Severity:** LOW-MEDIUM.
- **Where:** tools.ts:7108 (`staged.length > 0` guards the commit; nothing guards the
  advance), 7267.
- **Claim:** an item whose scope globs match nothing on disk (never-created files,
  glob-typo, or everything swept into `skipped` under preexistingDirty:"exclude") publishes
  with `files: []`, `diff: ""`, no commit, `ok: true`. For a behavioral item the earlier
  stages make this hard to reach; for a `behavioral:false` item the whole pipeline
  (mark_green → validate → review-with-empty-findings → publish) can complete having changed
  nothing — a "published" item with no artifact. The batch line discloses the empty file
  list, but nothing asks whether publishing nothing is what the item meant.
- **Fix direction:** deny (or at least journal at warn + report prominently) a publish whose
  staged set is empty while its fileScope names uncreated paths.
- **Confidence:** high on behavior; severity judgment is a posture call.

### TOOLS-HANDLERS-B-018 — §3.6 inline-claim expiry ("until the item leaves its current state") is not implemented and §2.5 cannot represent it

- **Pattern:** P8 (a schema that cannot express the spec's rule) — self-documented in code.
- **Severity:** MEDIUM.
- **Where:** `activeInlineClaimScope` (continuation.ts:316–349, explicitly: "the mid-FSM
  half … is deliberately NOT implemented"); §2.5's `inlineClaim: {reason, decisionId}`
  stores no claimed-at state.
- **Claim:** a claim minted at any state grants orchestrator edit rights over the item's
  fileScope until PUBLISHED — through vet, validate freeze windows (freeze still applies),
  review rounds — not for the one state §3.6 scopes it to. Combined with -001(3) (claims
  mintable on terminal runs) the hatch is materially wider than the plan says. The plan is
  IMMUTABLE, so this is a finding about the §2.5 schema's expressiveness, filed per the
  briefing's "change-the-plan ⇒ design finding" rule.
- **Fix direction:** widen §2.5 inlineClaim with `stateAtClaim` (plan-level change) or clear
  the claim on every FSM transition of the item in the handlers (implementable today:
  every transition site could null a claim whose item state changed — the state IS
  committed at transition time).
- **Confidence:** high (the code says so itself; the consequence trace is mine).

### TOOLS-HANDLERS-B-019 — Over-budget override writes the stop before the stop-report; a throwing report writer leaves a stopped run with no artifact

- **Pattern:** P7, narrow.
- **Severity:** LOW.
- **Where:** tools.ts:7905–7947: `run.stop = stop; store.saveRun(run);` then `await
  handleReport(...)` — whose stop mode still does `readJsonFileSync(queue.json)` (7423)
  and `store.loadItem` per queue entry (7358) unguarded.
- **Claim:** if queue.json is unreadable/torn, or an item file named by the queue is missing
  (queue_amend crash window leaves exactly "a runtime item no queue entry names" — the
  INVERSE is possible if a crash tears queue.json itself), the report throws AFTER the env
  stop was persisted: the run is terminal with no report.md, violating §2.9's "every stop
  writes a report" — in exactly the class of run (broken environment) the rule exists for.
- **Fix direction:** stop-report mode should fail soft per section (it renders facts, proves
  nothing).
- **Confidence:** medium-high (needs a torn file to trigger; the ordering is deliberate
  write-ahead, so the fix is in the report's stop mode, not the ordering).

### TOOLS-HANDLERS-B-020 — `handleAnswer` swallows a question-ledger read failure and reports items cleared

- **Pattern:** P11 / fail-open on corruption.
- **Severity:** LOW.
- **Where:** tools.ts:1083–1088: `try { ledger = readQuestions(runDir); } catch { ledger =
  []; }` — with an empty ledger the successor search finds nothing, so every cleared item is
  reported cleared and none is re-blocked on a still-open sibling question.
- **Claim:** the C-056 successor rule (re-block on the oldest still-open question naming the
  item) silently degrades to "release everything" exactly when the ledger is torn — the
  moment its answer is least trustworthy. Contrast requireStageTool (2606–2617), which turns
  the same torn file into a named refusal.
- **Fix direction:** rethrow with the named-repair message the stage handlers use.
- **Confidence:** high.

---

## 2. IDEA register

### IDEA-B-01 — Journal the first-run config write
Origin: reading handleSetup step (8). `config.updated` fires only on reconfigure (diff !==
null); the initial write of .conductor/config.json leaves no journal record at all.
Kind: docs/observability. Value: replay can see when/what setup wrote. Cost: one log call.
Relates to: standalone.

### IDEA-B-02 — Validate `finding.lens` against the dispatching session's lens group
Origin: -011. The lens field is the model's own claim; the tier-discard rule (a surviving
spec finding discards quality-lens findings) and the testWriter routing both dispatch on it.
Kind: test-maintainability/enforcement. Cost: a set-membership check per finding.
Relates to: TOOLS-HANDLERS-B-011.

### IDEA-B-03 — Report should render answered questions
Origin: -007. Even independent of provenance enforcement, "(none)" under Open questions on a
run that surfaced and answered five is misleading to the reader the report exists for.
Kind: docs. Cost: one section. Relates to: TOOLS-HANDLERS-B-007.

### IDEA-B-04 — `waveVerdict`'s torn-questions error names dispatch_wave even when publish/report is the caller
Origin: reading waveVerdict (5146): the message hardcodes DISPATCH_WAVE_TOOL; fine today
(only dispatch_wave calls it) but one refactor away from a misnamed refusal.
Kind: polish. Relates to: standalone.

### IDEA-B-05 — `handleOverride`'s grantedAction is recorded but never compared at spend time
Origin: -002 refutation pass. §3.6 says the grant covers "exactly ONE next action"; the spend
converts the first denied decision of the gate class whatever the action is. Comparing the
tool/command against grantedAction would make the record binding.
Kind: enforcement. Relates to: TOOLS-HANDLERS-B-002.

### IDEA-B-06 — Empty-staged publish and zero-file items deserve a report callout
Origin: -017. The batch line shows `Files:` empty but the Items section says "published" with
no qualifier. Kind: docs. Relates to: TOOLS-HANDLERS-B-017.

### IDEA-B-07 — The step-2 charter references "briefing §10 conventions"; the briefing ends at §8
Origin: reading the review suite itself. `2-enforcement.md` Output says "structured per
briefing §10 conventions" — there is no §10; the field list it promises does not exist. A
P3 inside the review machinery's own documents.
Kind: docs. Relates to: the review suite, not the codebase.

### IDEA-B-08 — `handleDefer` could add below-GREEN deferred items' tests to stale-red at defer time
Origin: reading defer + registerStaleRed. Registration happens only at terminal paths; a
deferred RED item's red test stays live for every intervening validate via foreignRedSet
(below-GREEN check covers it) — fine — but a deferred item's annotation is the natural
disclosure moment. Kind: polish. Relates to: standalone.

---

## 3. CROSS-LENS POINTERS

- **Fan-out engine (other R1 subsystem):** whether `TreeState.isFrozen` and the ENGINE's
  hold decision use the same marker-liveness rule as the evidence layer (pidAlive+overAge).
  A hold taken on a stale marker the driver's isFrozen didn't see (TOCTOU between
  tools.ts:5356 and the engine's admit) is awaited with NO budget (the awaitHeld wrap only
  applies when `frozen` was observed at 5356) and only a sibling's notifyClear releases it —
  a single-member wave would hang the tool call indefinitely. Needs the fanout reviewer.
- **Gates (other R1 subsystem):** `consumeOverrideGrant` converts a deny of the "git" class
  — including `git push --force` and history-destroying commands — into an allow with one
  spent grant. Whether ANY gate class should be override-exempt (the §3.5 spawn deny? the
  freeze?) is a macro/design question. (The freeze deny lives inside decideEdit, so a spent
  "edit" grant CAN pierce a verify freeze — one write into a tree mid-verify, §4.2's
  quarantine-safety argument broken by design of the hatch. Deserves the gates reviewer's
  eyes.)
- **Macro:** the meta-handler legality gap (-001) is one instance of a shape question — there
  is no single choke point where "is this conductor tool legal now" is asked; each handler
  reimplements or skips it. The §3.1 promise of a uniform phase-order gate would be one
  function called from `runTool`.
- **Macro:** tools.ts at 9,253 lines contains the wave driver, all handlers, setup's
  ecosystem detection, and HTTP probe plumbing; navigability for the small model and for
  maintainers is a macro concern (setup alone is ~1,200 lines of it).
- **Capability:** report.md is the only human artifact and it omits answered questions,
  taint *details* (only JSON-dumped), and any "closing verify RED" escalation; a stop-kind-
  aware exit code / operator surface would raise the floor (relates -007, -010).
- **Run-lifecycle reviewer:** §2.9's `done` row vs §3.2's REPORTED precondition disagreement
  (blocked items) — filed here as part of -010 but owned by whoever holds stops/continuation.

---

## 4. Mutation / repro table

| # | Mutation / experiment | File | Expectation if check binds | Result | Verdict |
|---|---|---|---|---|---|
| M1 | Ran the 9.5b CHECK_FORMATTER fixture body standalone: no argv → exit; with clean file arg → exit 0 | scratchpad (fixture copied verbatim from tests/tools-9.5b.test.ts) | If publish passed the file, a clean file would exit 0 and the test's denial assertion would depend on BADFMT | No argv (publish's actual call shape): TypeError, exit 1 for EVERY input; with the path: exit 0 on clean | Check-mode test is vacuous (denial fires regardless of file content); publish never passes the path — TOOLS-HANDLERS-B-005 |
| M2 | Flipped `hasStagedDeletion: false` → `true` at tools.ts:7014, ran `bash scripts/test-conductor.sh conductor/tests/tools-9.5b.test.ts` and `conductor/tests/freshness.test.ts`; restored, `cmp` clean | conductor/adapter/tools.ts (snapshot + restore verified) | If the flag's value were enforced/tested at this call site, some test goes red | (see below — recorded after run) | (see below) |
| R1 | Repro: drove classify→decompose-shaped state by hand (store fixtures), deferred all items, called handleReport on a DECOMPOSED run | scratch harness importing adapter/tools.ts + adapter/state.ts | If the phase gate existed, report refuses naming the run state | (see below — recorded after run) | (see below) |

(Rows M2/R1 are completed in the addendum below — the table is written before execution per
the append-as-you-go rule.)

---

## 5. Coverage ledger

| File / region | What was done | Coverage | Conclusion |
|---|---|---|---|
| tools.ts 138–459 (classifyTool, gateBeforeToolCall, consumeOverrideGrant, OverrideGrant) | read in full (override-budget spend side is in-scope §3.6) | full | -002; grant one-shot delete confirmed at 322; keyed per session+gate+item |
| tools.ts 818–1196 (status, decide, surface, answer, defer) | read in full | full | -001(4), -007, -008, -020; surface first-block-wins + answer successor logic verified coherent |
| tools.ts 2362–2701 (trees, requireStageTool, scope selection) | read in full (shared legality core for my handlers) | full | assertContainedPaths solid (abs, .., empty refused); requiredScopeNames union verified |
| tools.ts 3962–4110 (demote, registerStaleRed, foreignRedSet) | read in full | full | normalization + existence probes coherent; registerStaleRed idempotent via `known` |
| tools.ts 4449–4668 (handleValidate) | read in full | full | vacuity double-guard present; debug loop bounded; cleared (see §6) |
| tools.ts 4670–4814 (handleQueueAmend) | read in full | full | -001(4); crash-order rationale verified (items before queue.json, removal after) |
| tools.ts 4816–5515 (wave driver) | read in full | full | -014; batching/serial/freeze-hold logic verified against §4.2; PLAN_REVIEWED edge passes run.state correctly |
| tools.ts 5517–6603 (handleItemReview + helpers) | read in full | full | -003, -011, -012, -013, -015; lens compositions match §3.3 including trivial=3 |
| tools.ts 6605–7292 (publish batch, handlePublish) | read in full | full | -004, -005, -009, -017; HEAD check, startDirty subtraction, pathspec commit verified |
| tools.ts 7294–7680 (handleReport 3 modes) | read in full | full | -001(1,2), -010, -019; C-039 layers (a,b,c) present |
| tools.ts 7682–8007 (anomaly, inline_claim, override) | read in full | full | -002, -018, -019; budget check precedes writes; refusal is atomic |
| tools.ts 8009–9253 (setup: probes, detection, proofs, handleSetup) | read in full | full | -006, -016; smoke probe spawnability-only semantics deliberate; slot proof two-legged as documented |
| plugin/index.ts (bindings for my tools: 590–650, 1140–1230, 1350–1400) | read targeted | partial (my tools' bindings only) | override itemId comes from registry (not model args) — good; setup answers are model args (-006) |
| core/tool-bindings.ts | read targeted (decide/defer/override/setup rows) | partial | C-044 fixed-kind row is the contrast for -008 |
| core/fsm-run.ts legalRunTransition | read signature + INTAKE arm | partial | trusts caller-supplied `from` → -001(1) |
| core/freshness.ts | read flag handling (lines 28–74) | partial | hasStagedDeletion gates indexMtime → -004 |
| core/gates-phase.ts | grepped answer/report legality; not read in full | partial | answer legal whenever question open incl. terminal (deliberate) → -007 |
| adapter/continuation.ts activeInlineClaimScope | read 300–349 | partial | -018 self-documented deviation |
| conductor/doctrine/core.md | read override section in full | targeted | no gate ids named → -002 |
| tests/tools-9.5b.test.ts | read format fixtures + check-mode test | partial | M1 → -005 |
| tests/tools-9.5a.test.ts, 9.4c, 9.6 | grepped for routing fixtures / merge-conflict republish | targeted | literal-path scopes only; no second-publish-after-conflict test → -009, -011 |
| handleClassify/handleDecompose/handlePlan/handlePlanReview/handleSubmitTest/handleVetTest/handleMarkGreen (tools.ts 649–4449 remainder) | **not examined** (other half's scope) except where shared helpers overlap | — | out of scope |
| adapter/evidence.ts, fanout.ts, state.ts internals | **not examined** (other reviewers) | — | consumed as contracts |

---

## 6. Cleared areas — attacked and held

- **handleValidate vacuous-verify:** attacked with the "no requiredScopes coverage" and
  "empty scopes map" shapes (C-039's family). Both are guarded, before and after the run
  (4470, 4516). Could not construct a VALIDATED-on-nothing path through this handler.
- **handleValidate marker discipline:** the refusal path leaves the holder untouched; the
  debug loop re-verifies through the same guarded closure. No marker steal found.
- **handleSurface / handleAnswer block bookkeeping:** attacked first-block-wins vs the
  successor rule with interleavings (double-block, repeated ids in blocksItems, answer of
  first-of-two questions): the pairing holds — repeated ids are deduped (1022), a released
  item re-blocks on the OLDEST open successor (1091), and cleared-vs-reblocked reporting
  matches disk. (Residual: -020's torn-ledger fail-open.)
- **handleQueueAmend atomicity:** every refusal (op application, §2.4 validation,
  requireTwoOptions, schema) precedes every write; the crash-ordering argument (items
  before queue.json before removals) is sound — the only crash residue is an orphan item
  file nothing reads.
- **Publish step-2 staging discipline:** attacked with preexisting-dirty sweep, glob
  expansion walking .git/.conductor/node_modules (skipped, 6776), whole-worktree diff on
  empty pathspec (guarded, 7103), and index-pollution from an earlier denied publish (the
  pathspec commit at 7116 confines the commit). Held everywhere I pushed.
- **Publish denylist trailer defense-in-depth:** the handler re-checks the built message
  even though the builder neutralizes (7083) — injectable builder cannot smuggle an
  attribution trailer past the handler.
- **Override budget arithmetic:** the check precedes every write; a refused override writes
  nothing (no taint, no counter, no anomaly) — verified by reading the exhausted branch
  order; exhaustion is an env stop that isTerminal picks up, and the granted path never
  converts an over-budget request. Within its (narrow — see -002) spendable surface, the
  budget binds.
- **Setup write-gating:** no path writes config.json before every ask is answered, every
  smoke probe passes, every live proof passes, and the candidate validates (9084→9224 in
  order). The no-coverage refusal (9127) prevents the wedge it documents. Attacked with
  "empty requiredScopes", "unanswered ask + failures", "schema-invalid gitMode" — all
  refused pre-write.
- **Wave driver batching/serialization:** stage groups enter once per call; serial stages
  chain in wave order; notifyClear fires on both settlement kinds. The C-054 fence stops
  FSM double-writes (the ledger gap is -014).

---

## ADDENDUM — completed mutation / repro rows

| # | Mutation / experiment | File | Expectation if check binds | Result | Verdict |
|---|---|---|---|---|---|
| M1 | 9.5b CHECK_FORMATTER fixture run standalone: publish's actual call shape passes NO file argument | scratchpad copy of the fixture | a clean file should exit 0 (pass) | no argv → TypeError, exit 1 for EVERY input; with a path → exit 0 on clean | Check-mode format test is vacuous; `{file}` substitution absent → **-005 CONFIRMED** |
| M2 | `hasStagedDeletion: false → true` (tools.ts:7015); ran `test-conductor.sh` scoped to tools-9.5b (50 tests), freshness (25), publish-commit-integrity (3) + typecheck/bun/python legs; reverted; `git diff` clean at that line | conductor/adapter/tools.ts | if the flag were pinned, some test goes red (flipping it makes EVERY committing publish re-verify — `reverified` flips observably) | **GATE PASS all three runs** — nothing pins either value | §2.6's deletion term is unenforced AND untested (P11) → **-004 CONFIRMED** |
| R1 | Repro (pristine git-HEAD copy of adapter/+core/, real handlers): run at DECOMPOSED, `handleDefer` both items, `handleReport` | scratchpad/repro-r1.mjs | phase gate refuses report outside EXECUTING | `runState: REPORTED`, persisted `stop: {kind: "done", reasonDisplay: "the run completed: 2 item(s), closing verify green"}`, report.md written | DECOMPOSED→REPORTED with stop done; PLANNED/PLAN_REVIEWED/EXECUTING skipped → **-001(1)(2) CONFIRMED** |
| R2 | Repro: run with `stop:{kind:"done"}` (isTerminal=true), then `handleInlineClaim` and `handleQueueAmend` | scratchpad/repro-r2.mjs | terminal run legalizes status+answer only → both refuse | claim GRANTED; `activeInlineClaimScope` (the gate's feed) returned `["src/parser.ts"]`; amend ADDED item I9 (PENDING) to the closed run's queue | post-terminal G8 reopen + closed-run mutation → **-001(3)(4) CONFIRMED** |
| R3 | Repro: `handleOverride {gate:"phase-order"}` (the plan §2.8 example), then a denied edit through `gateBeforeToolCall`, then a second override | scratchpad/repro-r3.mjs | the grant converts the named gate's next denial; a wrong gate name is refused before spending | (a) granted:true, meters 1/1, key `ses::phase-order::I1` minted; (b) edit gate **still denies**, grant unspent; (c) second attempt → `env` stop persisted, stop-report written, taint=1 | budget burned on an unspendable gate name; retry kills the run → **-002 CONFIRMED** |
| R4 | Repro: `handleItemReview` with scripted fanout — two lens sessions both name their finding "F1"; correctness panel upholds (2/2), minimality panel refutes (2/2) | scratchpad/repro-r4.mjs | upheld correctness finding survives → fix dispatch → re-review | `ok:true, itemState:REVIEWED, rounds:1, surviving:[]` — ZERO fix dispatches; the upheld finding silently dropped | id collision collapses adjudication → **-003 CONFIRMED** |
| R4b | Counterfactual of R4 with distinct ids ("F1"/"F2") | scratchpad/repro-r4b.mjs | fix dispatch happens | `FIX DISPATCHED to role: implementer`, rounds:2 | the repro discriminates — the collision alone caused the drop |

**Concurrency note for the merge:** during M2 another review agent held a live mutation in
`trivialViolatesRecheck` (tools.ts:473–480) and later in `requireStageTool` (2623) —
tools.ts is being mutated by multiple agents. My M2 revert was performed by targeted edit,
not snapshot-restore, to avoid clobbering theirs; their restore later reverted my mutation
too (after my runs completed). All R-series repros ran against a pristine `git archive
HEAD` copy in scratch, immune to that interference. Any mutation table in the other
handlers' part covering those two sites is theirs, not mine.

---

## 7. Enforcement table (Part A, for this scope)

| # | What is claimed | Who claims it | What the harness does | Where | Verdict | What a lying model gets away with |
|---|---|---|---|---|---|---|
| E1 | "the full verify is green" (GREEN→VALIDATED) | — | handler runs the verify itself, quarantined, start/HEAD-stamped; vacuity double-guarded | handleValidate 4486–4526 | **RE-DERIVED** | nothing — cleared (§6) |
| E2 | "the review found nothing" | reviewer sub-sessions | empty findings = approval; no floor on diligence; lens attribution self-declared | handleItemReview 6398–6431 | **ACCEPTED ON TRUST** (by design) | lazy [] from every lens advances the item; mislabeled `lens` games the discard tier (-011) |
| E3 | "a finding survived / was refuted" | skeptic panels | positional panels + core findingSurvives; missing seats count as upholds — BUT the verdict map keys on model-authored ids | 6178–6231 | **PARTIALLY** | id collision drops an upheld finding (R4, -003) |
| E4 | "the fix was implemented" | fixer receipt (DONE) | receipt accepted; enforcement deferred to next round's fresh lenses + re-validate | 6457–6525 | **PARTIALLY** | a DONE that did nothing survives if next round's lenses miss it; at the cap the item blocks (safe) |
| E5 | "the changed test still pins behavior" | — | handler re-runs test, reverted-behavior probe, fresh re-vet critics | 6277–6364 | **RE-DERIVED** (probe skips are silent; pop failure swallowed, -013) | a test whose probe was skipped (stash failure) re-enters on critics alone |
| E6 | "this item may publish" (branch/freshness) | — | HEAD equality + mtime freshness re-derived; auto re-verify on stale | 6854–7067 | **PARTIALLY** | a deletion-only post-validate edit ships unverified (-004, M2) |
| E7 | "the commit contains the item's work" | — | pathspec-confined commit, startDirty subtraction, denylist re-check | 7095–7147 | **RE-DERIVED** | zero-file publish still "succeeds" silently (-017) |
| E8 | "the run is finished" (report) | orchestrator calling report | settledForReport re-derived; closing verify re-run — but run-state legality never asked, FSM fed a literal | 7417–7658 | **PARTIALLY** | defer-all at DECOMPOSED → REPORTED/done (R1, -001); done on RED closing verify (-010) |
| E9 | "a stage was skipped legitimately" (stop-report mode) | the recorded stop | selected from persisted run.stop only | 7444 | **RE-DERIVED** | — |
| E10 | "the human answered Q-…" | the model calling conductor_answer | any string clears the block; answered questions vanish from report | 1057–1128, 7388 | **ACCEPTED ON TRUST** | full human-in-the-loop simulation, invisible in report.md (-007) |
| E11 | "this deferral is a human disposition" | handleDefer | records kind:"human" unconditionally | 1167–1176 | **MISATTRIBUTED** | model deferrals wear human authority in the ledger (-008) |
| E12 | "a decision was derived legitimately" | model via conductor_decide | requireTwoOptions + human-territory refusal (C-029b); binding forces kind:"derived" (C-044) | 873–944, tool-bindings 201 | **PARTIALLY** (content trusted, shape enforced) | scores/why are fiction the harness can't check — by design, disclosed |
| E13 | "the queue amendment is sound" | model ops | re-read queue + core validateQueue + §2.7 gate, atomic | 4710–4787 | **RE-DERIVED** (shape) | legal-but-hostile re-scoping is possible but leaves decision records; terminal-run amend (R2) |
| E14 | "I need this gate overridden" | model via conductor_override | budget re-derived from both meters; refusal atomic; exhaustion = env stop (R3c) | 7874–8006 | **RE-DERIVED** (budget) / **BROKEN** (spend: -002) | can pierce freeze via "edit" grant (by design? → cross-lens); free-string gate burns budget (R3) |
| E15 | "setup's answers are the human's" | model relaying chat | mechanical checks on shape only; `[]` behavioralPaths accepted | 9089–9152 | **ACCEPTED ON TRUST** | TDD off repo-wide in one call (-006) |
| E16 | "setup's environment claims hold" | — | live proofs: /v1/models, schema probe, two-legged slot proof, smoke spawns — all re-derived against the running origin | 8752–8929 | **RE-DERIVED** | — cleared |
| E17 | "the wave ran §4.2's schedule" | — | nextWave re-computed per call from persisted facts; per-round gate re-ask; serial stages chained | 5207–5515 | **RE-DERIVED** | abandoned stage can still write ledgers (-014) |

---

## 8. Adversary log (Part F, this scope's steps)

Playing the competent-but-lazy model against the committed handlers:

1. **Cheapest run completion (reproduced, R1):** classify(work) → decompose → defer every
   item ("later") → report. Cost: two tool calls per item plus one. Result: REPORTED, stop
   `done`, "closing verify green", report.md attributing every item a deferral the model
   authored. The FSM stages that exist to force planning never ran. The report DOES disclose
   the deferrals — a careful human reader catches it; nothing mechanical does.
2. **Cheapest item completion (not reproduced; each link verified in code):** for a
   behavioral:false item — mark_green (no test owed) → validate (suite green on an untouched
   tree) → item_review with empty findings from every lens (E2) → publish with zero staged
   files (-017) → PUBLISHED. Nothing in the chain requires the item's files to exist.
3. **Kill the TDD law wholesale (-006):** on a fresh repo, relay setup answers with
   `behavioralPaths: []`; thereafter every item can declare behavioral:false and path 2
   applies repo-wide. On a configured repo: wait for terminality, `conductor_setup
   {reconfigure:true, answers:{…, behavioralPaths:[]}}`.
4. **Make a blocked item disappear (-007):** whatever blocked it (review cap, debug cap,
   surface), call conductor_answer with invented text; the block clears, the question
   leaves the report's "Open questions", and no report section ever shows the answer.
5. **Make a review finding disappear:** don't fight the skeptics — reply
   DONE_WITH_CONCERNS naming the finding id and hope the pushback panel refutes; or (no
   action needed) rely on an id collision (R4) to erase it. Both leave zero trace in the
   report (findings are not a report artifact at all).
6. **Escape the run entirely (reproduced, R2):** after the run terminates, inline_claim any
   item → the edit gate opens over its fileScope with no FSM, no review, no publish ever
   coming. Edits land in the user's tree attributed to nothing.
7. **What I could NOT do:** get an over-budget override converted (R3c held); get validate
   to pass without running the verify (E1 held); commit outside the item's pathspec or
   sweep startDirty WIP (held); make publish accept a moved HEAD (held); make setup write
   an unproven config (held).

---

## 9. Honesty audit (this scope)

No fabricated evidence found in the handlers' own record-writing: evidence refs written by
validate point at records the handler itself produced; publish's batch records mirror what
was staged; the stop-report's "no verify ran" headline is truthful. The two places the
RECORD misleads are both filed: kind:"human" defer records (-008) and taint entries for
overrides that never bypassed anything (-002/R3 — the anomaly says `grantedAction:
conductor_mark_green` for a grant that could never convert that action). I checked the §2.8
anomaly write-ahead ordering (7952 before 7960–7970) — it holds.

---

## 10. Process hygiene

All child processes spawned by my runs (node one-shots, scoped test runs) exited with their
commands; final `ps` sweep for `llama-router|fake-llama|time\.sleep` performed before
finishing — nothing left running. No files under `.data/` or `.out/` touched. tools.ts
restored to its pre-mutation state at line 7015 by targeted edit (verified via git diff);
no `git checkout` used at any point.
