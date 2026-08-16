# Step 4 — Capability Lens: Doctrine Efficacy

**Scope:** Will a 32k-context weak-instruction model actually follow the nine doctrine packs in
`conductor/doctrine/` (core, debug, decompose, plan, receive-review, review, skeptic, tdd,
test-vet)? Read as if I were that model. Per-pack judgement on length/budget, first-dropped
instruction, abstract-vs-procedural, cross-pack contradictions, uncovered situations, and
stuck-state guidance. Grounded in step-2 (findings-enforcement.md) and step-3
(findings-macro.md) evidence and the build record.

**Date:** 2026-08-16
**Author:** step-4 capability reviewer (doctrine-efficacy part)

---

## 0. Method note, and the one fact that frames everything

**Doctrine has never reached a session.** ISSUE-001 (CRITICAL, grep-verified by step 2): no
`chat.system.transform` hook is registered, so no sub-session has ever received a pack, the live
state block, or per-role sampling. The doctrine sub-sessions *actually* receive is the set of
hand-written paraphrases inside `tools.ts` dispatch prompts (ISSUE-003, no drift guard either
direction). Step 3's cross-lens pointer 10 states it plainly: **all doctrine-efficacy claims are
counterfactual until 13.2** — the packs' only tested consumers are keyword anchors that stay green
when a pack asserts the opposite of its doctrine (ISSUE-135).

So this assessment answers two questions, and keeps them separate:

- **(a) As shipped:** what governs a session today is the paraphrase layer, and the packs govern
  nothing. Every judgement below about a pack is therefore a judgement about the post-ISSUE-001
  world — the world 13.2/14.2 are supposed to run in.
- **(b) As designed:** once wired, would a small, lazy, weak-instruction model follow these packs?
  Judged by structural reading (position, length, imperative density, procedural specificity,
  named mechanisms) plus the closest empirical analogs in the build record. **No live 32k model
  was run against the packs** — none is available to this review — and every retention claim
  below is marked as structural judgement, not measurement. The measurement belongs to 14.2
  (MACRO-032's per-role doctrine-citation rates; endorsed).

**Empirical anchors from the build record (models not following instruction-prose they were
given).** The build's own agents were *stronger* models than the 32k target, given explicit
briefs, and the record still shows prose failing as an instruction channel:

1. **C-082 / P10:** skeptic panels given adjudication instructions matched the plan's identifier
   by *frequency in prose* rather than *identifier position*, unanimously refuted a true finding,
   and sealed it. `skeptic.md` contains no identifier-position rule to this day (MACRO-015:
   "currently in no pack").
2. **MACRO-015:** panel kill rates swung 12%→71% across gates under the same skeptic doctrine;
   two audited refutations were wrong; `skeptic.md`'s "uncertain ⇒ refuted" is named as the
   biasing instruction. Step 2's adversary *used the pack's own default* as an exploit
   (adversary log (b): "One lazy skeptic kills a finding at k=1").
3. **MACRO-017:** obligations recorded in prose measurably failed to land (2 lost : 1 landed
   over the sampled set) even under the most correction-hungry process on record. Prose does not
   enforce — for strong models. A weak-instruction model raises that floor's cost, not lowers it.
4. **Adversary log (b)/(e):** `receive-review.md:51` forbids weakening the vetted test; step 2
   weakened it anyway (ISSUE-008), noting "it is doctrine, not a gate, and (ISSUE-001) never
   reaches the session anyway" — the canonical advisory-vs-structural datum for this lens.

**Reading method.** All nine packs read in full (they are small). Delivery mapping read from
`conductor/adapter/inject.ts` (ROLE_PACKS, REQUIRED_PACKS, debug/receive-review conditional
delivery, state block). Spot verifications against `tools.ts` (vet-critic prompt criteria at
2929–2957, fixer reply protocol at 5806/5837, NEEDS_CONTEXT at 3201/3852/4272), `core/gates-git.ts`
(commit deny at 383), `core/planning.ts` (ponytail reuse-note enforcement at 390–397),
`plugin/index.ts` (tool descriptions at 492–630), and the plan (line 1873 on question batching).

---

## 1. Token/length ledger — length is NOT the problem

Measured (`wc -c`, tokens ≈ bytes/4; cross-checked against words×1.35, within ±10%):

| Pack | Bytes | Words | ~Tokens | Delivered to (per ROLE_PACKS + conditionals) |
|---|---|---|---|---|
| core.md | 4,483 | 735 | ~1,120 | orchestrator, mechanical (incl. classifier) |
| decompose.md | 5,197 | 832 | ~1,299 | planner (primary) |
| plan.md | 4,376 | 721 | ~1,094 | planner (secondary) |
| tdd.md | 3,605 | 656 | ~901 | testWriter, implementer (primary) |
| debug.md | 3,212 | 567 | ~803 | implementer, only in DEBUG posture (secondary) |
| receive-review.md | 2,775 | 466 | ~693 | any fixer dispatch with `receivingReview` (secondary) |
| review.md | 3,596 | 605 | ~899 | reviewer (primary) — includes vet critics |
| test-vet.md | 3,220 | 552 | ~805 | reviewer (secondary) |
| skeptic.md | 3,278 | 568 | ~819 | skeptic |

**Per-role worst-case doctrine load** (pack(s) + the ≤30-line state block, ~250 tokens):

| Role | Packs | ~Tokens | % of 32k |
|---|---|---|---|
| orchestrator | core | ~1,370 | 4.3% |
| planner | decompose + plan | ~2,640 | 8.3% |
| testWriter (worst: receiving review) | tdd + receive-review | ~1,840 | 5.8% |
| implementer (worst: DEBUG + receiving review) | tdd + debug + receive-review | ~2,650 | 8.3% |
| reviewer / vet critic | review + test-vet | ~1,950 | 6.1% |
| skeptic | skeptic | ~1,070 | 3.3% |
| mechanical / classifier | core | ~1,370 | 4.3% |

**Verdict on length:** every role's doctrine fits in ≤8.3% of a 32k window. The packs are
well-sized; none is "too long to survive truncation." What actually eats the window is the
**payload**, which scales with the work, not the doctrine: dispatch prompts embed the full item
spec, THE TEST AS WRITTEN, captured red output, review diffs, finding lists (`tools.ts`
vetCriticPrompt, reviewFix prompts), plus the tool schemas — and fan-out sub-sessions are created
with **no agent** (ISSUE-006), so per-agent tool restriction applies to none of them and the full
tool-schema surface rides along. **What gets truncated first is nothing structural** — §6.4's
design re-states doctrine every request precisely so history-trimming cannot lose it — the real
failure mode is *attention*, not truncation: the packs sit in system position (furthest from the
generation point) while the paraphrases and payload sit at the end of the prompt. A
weak-instruction model weights the end. **Consequence: wherever the tools.ts paraphrase and the
pack disagree (ISSUE-003, five sites, no drift guard), the paraphrase wins even after ISSUE-001
is fixed.** That makes the two-spellings defect load-bearing for efficacy, not just hygiene —
see GAP-DOCTRINE-EFFICACY-001.

---

## 2. Per-pack assessments

Format per pack: **Length/budget · What arrives with it · First instruction dropped under
pressure (structural judgement) · Abstract-where-procedural · Contradictions · Uncovered
situations · Stuck guidance · Verdict.**

### 2.1 core.md — "always on," delivered to two roles out of seven

- **Length:** ~1,120 tokens; fine.
- **Delivery reality:** the title says "always on" and line 5 says "These principles bind every
  session," but ROLE_PACKS delivers core.md to **orchestrator and mechanical only**. The pack
  acknowledges this ("each role's pack carries the slice its work needs"), and tdd.md does carry
  the claim-is-not-the-record slice — but the **ask policy, the decision-record protocol, the
  override budget, and the forbidden-completion-claims list reach five of seven roles never**.
  ISSUE-006 makes this concrete: any registered sub-session can call `conductor_answer`,
  `conductor_defer`, `conductor_override` — the tools whose *only* governing doctrine lives in a
  pack those sessions do not receive.
- **First dropped:** "Every consequential fork records at least two real options scored on the
  ladder-5 criteria" — the highest-clerical-effort instruction, buried mid-pack, naming no tool.
  What breaks: the decision ledger becomes fiction — which E5 already records ("shape enforced,
  scores are fiction"). Second casualty: "Check the budget before you reach for the hatch"
  (nothing tells the model *how* — no tool named; `conductor_status` shows it, unnamed here).
- **Abstract-where-procedural:** the opening imperative — "Work the legal next action" — is
  unfollowable as written: the pack never says what the legal next action *is* or how to learn it.
  The design's answer was the live state block ("the single recommended tool"), which is dead
  (ISSUE-001). The pack also says "the override tool" without its name and never names the three
  spendable gate ids (`session`/`git`/`edit`) — ISSUE-007 verified that *nothing* names them, and
  that a misspelled gate burns the budget and can kill the run. The pack tells the orchestrator to
  guard a budget it can waste by spelling, against a vocabulary it is never shown.
- **Contradiction (verified against the plan):** "Questions are batched at run boundaries, not
  fired mid-run" vs. the system's own `conductor_surface` ("Surface a blocking question, mark
  named items blocked, and continue the rest" — plugin/index.ts:541) and plan line 1873, which
  says "surfacing (asking) only at run boundaries, batched in the report **or as surfaced**
  [questions]". The pack's compression drops the "or as surfaced" arm. A weak orchestrator
  following core.md literally holds blockers until report time — feeding exactly the mislabeled
  terminal states (ISSUE-065) and the self-answer path (ISSUE-051) that step 2 reproduced.
- **Uncovered situations:** what a gate DENY means and what to do about it (certain-hit; see
  GAP-003); when deferral is legitimate (`conductor_defer` has *no* doctrine anywhere —
  MACRO-007's free escape); the FSM tool order (GAP-002).
- **Stuck guidance:** "surface it and stop" exists for budget exhaustion only. Nothing else.
- **Verdict:** the strongest *epistemology* in the set ("your say-so is not the record" is exactly
  right) attached to the weakest *procedure*. Its enforceable edge (forbidden phrases) is
  checkable and well-shaped for a weak model (a concrete banned-string list). Its load-bearing
  procedural content assumes a state block that does not arrive.

### 2.2 debug.md — the best pack in the set

- **Length:** ~803 tokens; fine. Also the only pack whose *content* is actually read from the
  pack map in production today (`debugFixPrompt`, per ISSUE-003) — the one pack that governs
  anything as shipped.
- **First dropped:** Phase 2 (Pattern Analysis). Models under pressure jump from symptom to fix;
  the search-for-siblings pass is the classic omission. What breaks: single-instance fixes on
  systemic faults — precisely the shape the build's own correction record shows (the two-spellings
  family recurring after being named, MACRO-017).
- **Abstract-where-procedural:** least afflicted of all nine. "State the root cause in one
  sentence. If you cannot, you are still in phase 1" is a followable self-test; the 3-fix rule is
  a counter a model can keep. Two genuinely procedural gaps: it never says *where to record* the
  phase-3 hypothesis (no ledger/tool named), and it does not mention `debugFixCap` — the harness
  will cut the loop off at a bound the doctrine never warns about, so a model at cap experiences
  an unexplained refusal (ISSUE-091 territory: the DEBUG loop had never executed end-to-end).
- **Contradictions:** none found against other packs or gates.
- **Stuck guidance:** the 3-fix rule IS stuck guidance, and it is the only real stuck protocol in
  the entire doctrine set. It ends "surface that question" — again without naming the mechanism
  (NEEDS_CONTEXT? `conductor_surface`? — neither named).
- **Verdict:** followable, well-ordered, right-sized. Its virtues (numbered phases, one-sentence
  self-tests, a countable stop rule) are exactly what the other packs lack.

### 2.3 decompose.md — teaches units the harness does not measure

- **Length:** ~1,299 tokens, the largest; still fine (planner combo 8.3%).
- **First dropped:** the per-item `necessary`/`reuse` notes (clerical, per-item, easy to
  boilerplate). The harness enforces non-emptiness for the `minimal-code` rung under full/ultra
  intensity (planning.ts:390–397, verified) but any non-empty string passes — so the dropped
  instruction degrades to boilerplate that satisfies the gate. The minimality record becomes
  noise, invisibly.
- **Abstract-where-procedural:** mostly good — the disjoint-path test, the DAG rule, and the
  rejection checklist are concrete. The checklist is the right shape for a weak model.
- **The efficacy problem — the pack overstates its gates (MACRO-021's docs-falsehood class,
  inside doctrine):**
  - "≤ ~5 files … Oversized items … are rejected outright" — the enforcement counts fileScope
    **entries**, not files (ISSUE-012, re-litigated and confirmed by step 2); `["src/**"]` counts
    as 1. The pack teaches "files," the gate measures list length, and nothing in the pack says
    "no globs in fileScope" — so an honest weak model that writes globs (shorter!) silently
    escapes the size law, and a lazy one exploits it.
  - "The law bends by path arithmetic the model cannot argue with, not by say-so" — true except
    ISSUE-009 (`rootLevelOnly` hole: root-level production files escape the disjoint-path guard
    under the safe default) and ISSUE-048 (`behavioralPaths:[]` turns the law off repo-wide).
  - Nothing forbids `fileScope ∩ testScope ≠ ∅` for behavioral items — the pack says a
    non-behavioral item "MUST NOT claim test paths," but is silent on the behavioral item whose
    fileScope *contains* its own test file, which is ISSUE-008's reproduced TDD defeat.
- **Uncovered situations:** what to do when validateQueue rejects the queue (the bounded re-split
  round is mentioned for oversize only); how to handle a request that is genuinely one atomic
  >5-file change.
- **Stuck guidance:** none beyond the one re-split round.
- **Verdict:** well-structured, but its confidence statements are falsified by step-2 issues, and
  its sizing vocabulary diverges from what the harness measures. The pack and the gate must teach
  the same unit (see GAP-009).

### 2.4 plan.md — good rules, highest-effort rule will be the casualty

- **Length:** ~1,094 tokens; fine.
- **First dropped:** Rule 3, "complete code for non-obvious steps" — the single
  highest-effort instruction in any pack. A weak model will emit sketches and rationalize them as
  "obvious." What breaks: the implementer inherits the judgment calls the plan existed to settle,
  and burns review rounds — plan-review (E6, one of the few RE-DERIVED rows) partially
  compensates, so the failure is cost, not corruption.
- **Abstract-where-procedural:** strong — "Placeholders are plan defects" names the three
  banned shapes ("to-be-determined," "add error handling," "similar to task N") concretely, which
  is the followable form. The self-check list is good.
- **Contradiction (minor, duplication not conflict):** "Alternatives considered … at least two
  real options" restates core.md's decision protocol — but the planner never receives core.md,
  so the duplication is *necessary* under the slice model. Noted as the pattern working, not
  failing; it is however a second unguarded spelling of the ≥2-options rule (P3).
- **Uncovered situations:** what to do when the plan discovers the queue item is wrong (too big,
  wrongly scoped, already satisfied). The plan-review loop exists for plan *quality*; queue
  *amendment* (`conductor_queue_amend`) has no doctrine anywhere and is a tool the planner's
  packs never mention.
- **Stuck guidance:** none.
- **Verdict:** followable; its failure mode is effort-shedding on Rule 3, which the plan-review
  fan-out is positioned to catch (at the cost of rounds).

### 2.5 receive-review.md — right philosophy, unfollowable protocol

- **Length:** ~693 tokens, the smallest; fine.
- **Delivery:** secondary pack on `receivingReview` dispatches — a signal only the dead channel
  reads (MACRO-008); as shipped, **no fixer has ever seen this pack.** The paraphrase at
  tools.ts:5806/5837 carries the actual protocol.
- **First dropped:** "Verify the claim against the code before you change anything" — the entire
  point of the pack, and its most expensive instruction. The cheap, memorable parts (the banned
  phrase list — "You're absolutely right," "Good catch") will be retained; a weak model complies
  with tone rules and skips verification work, producing polite unverified implementation — the
  exact failure the pack exists to prevent.
- **Unfollowable as written (verified against tools.ts):**
  - "Claim unclear → **ask** exactly what is meant before touching code" names no mechanism. The
    actual mechanism is a structured `NEEDS_CONTEXT` reply (tools.ts:3201/3852/4272,
    continuation.ts:1199) — never mentioned in any pack.
  - "Claim wrong → do NOT implement it. Refute it with evidence" maps to the
    `DONE_WITH_CONCERNS` receipt with a `concerns[]` naming the finding id (tools.ts:5806: "If a
    finding is WRONG, do not implement it: reply DONE_WITH_CONCERNS…") — never mentioned in any
    pack. And step 2 found the concern-matching is substring-based (ISSUE-049: F10 matches F1),
    so a weak model's loosely-worded concern can be mis-adjudicated even when it follows doctrine.
  - "Never weaken or delete an assertion just to make a finding disappear" — doctrine, not a
    gate: ISSUE-008 reproduces the implementer doing exactly this through `mark_green` with no
    re-vet. The pack's strongest "never" is its least enforced.
- **Contradiction (system-level):** "ask exactly what is meant before touching code" vs. core.md
  "Everything else is derivable — derive it. Never ask…". The two packs are never co-delivered,
  so no prompt carries both — but the system's posture is incoherent across them: the fixer is
  told to ask; the ask policy (which the fixer never sees) forbids asks outside human territory.
  The resolution (NEEDS_CONTEXT is not a human ask; it converts to a surfaced question) exists in
  the machinery and in no doctrine.
- **Verdict:** the pack teaches the right behavior in words a strong model would honor and gives
  a weak model no lever to actually do it. Protocol names are the missing 20 lines (GAP-007).

### 2.6 review.md — blesses the zero-effort output; one paragraph is addressed to the wrong reader

- **Length:** ~899 tokens; fine.
- **First dropped:** the adjudication-order paragraph (spec-before-quality, discard-stale-quality
  bookkeeping across rounds). It is also the paragraph least *appropriate* to drop-proof: it
  reads as machinery policy (who carries findings between rounds — the harness's job), not
  reviewer instruction. A weak model cannot execute cross-round bookkeeping anyway; if the
  harness does not implement this discard rule mechanically, the doctrine is aimed at the wrong
  reader entirely.
- **The efficacy problem:** "An empty findings list is a valid, complete review — it IS the
  approval. Do not invent findings to look thorough." Correct as calibration for a strong model;
  for a lazy or weak model it is a *sanctioned* zero-effort exit, and E8 is ACCEPTED-ON-TRUST by
  design — no diligence floor, no evidence the diff was read (ISSUE-072; adversary log (b):
  "return `{"findings":[]}` — sanctioned, indistinguishable from a diligent empty review"). The
  pack could demand cheap evidence-of-reading (files opened, hunks quoted) and does not — see
  GAP-005.
- **Abstract-where-procedural:** the severity rubric is genuinely good — impact-anchored, with
  the inflation/deflation rules stated in both directions. `file:line` citation is a concrete,
  checkable demand (and the harness could enforce its presence mechanically; it does not).
- **Contradictions:** none internal. Alignment note: review.md and skeptic.md *compound* — the
  reviewer's silence is sanctioned and the skeptic's default kills survivors, so both packs at
  the review layer bias the same direction (toward "nothing is wrong"), which is ISSUE-072's
  finding restated at the doctrine layer.
- **Uncovered situations:** what a reviewer does when it cannot see the whole diff (context
  overflow on a large item — certain for a 32k model on a multi-file diff; no "declare partial
  coverage" protocol exists anywhere).
- **Verdict:** well-written calibration doctrine for the model that does not need it; missing the
  diligence-evidence demand that would make it bite for the model that does.

### 2.7 skeptic.md — instructs the bias the record already convicted

- **Length:** ~819 tokens; fine. Skeptic sessions are the leanest (3.3%).
- **First dropped:** "If you can construct the failing case yourself, uphold and state it
  plainly" — the balancing clause. What survives is the headline: "Default toward refuted when
  uncertain." For a weak model, "uncertain" is the *resting state* — it includes every case where
  the model failed to read the cited lines, lost the diff to context, or simply cannot follow the
  argument. The pack converts capability failure into a refutation verdict.
- **The empirical record is unusually direct here (the one place this review has real data):**
  - C-082/P10: a unanimous wrong refutation under exactly this default, sealed with a
    do-not-re-litigate note.
  - MACRO-015: kill rates 12%→71% across panels; two audited refutations wrong; refutations cost
    one unaudited line while upholds cost a fix round — the pack's default rides an evidence
    asymmetry in the record schema.
  - ISSUE-072 / adversary log (b): the default is exploitable as-is ("One lazy skeptic kills a
    finding at k=1; two kill it at the k=2 default").
- **Abstract-where-procedural:** "Attack the reproduction" is decently procedural (read the
  cited lines, trace the path, demand specifics). What is missing is the **evidence obligation**:
  the pack requires "reasoning naming the line and the reproduction — or the failed reproduction"
  but the schema does not (ISSUE-079: no refutation-evidence field), so a one-line "not
  convinced" is recorded indistinguishably from a real failed reproduction. Doctrine demands what
  the record cannot hold.
  Also missing: the identifier-position rule (P10's generalized lesson — "when checking code
  against a spec identifier, count only identifier positions") is in no pack (MACRO-015,
  IDEA-PD-8).
- **Contradictions:** "Never invent a new defect the reviewer did not raise — that is not your
  seat" is correct role hygiene, and no other pack conflicts.
- **Uncovered situations:** what to do when the skeptic *cannot access* what it needs (the cited
  file missing from context, a transport-truncated finding) — the record shows panels repeatedly
  under-delivered by transport deaths (C-030: 9 skeptics, C-031, C-038); a skeptic in that state
  following this pack returns `upheld:false`. The correct verdict for "I could not evaluate" is
  an abstention, which neither the pack nor the schema has.
- **Verdict:** the single most consequential doctrine defect in the set, because it is the one
  with a conviction record. The default should be conditioned on *evaluation having occurred*:
  "could not refute after a real attempt" upholds; "could not evaluate" abstains (and an
  abstention upholds, per MACRO-015's fail-closed direction). See GAP-004.

### 2.8 tdd.md — one step of its headline cycle is an action the harness denies

- **Length:** ~901 tokens; fine.
- **First dropped:** step 2, "Observe the red for the real reason" (the subtle, judgment-heavy
  step). Mechanically compensated: `classifyFailure`/redAdmission refuse typo-reds and
  off-scope reds (E1 RE-DERIVED) — except under a wildcard-headed fileScope (ISSUE-011), where
  the missing-subject class becomes a harness-blessed vacuous red. So the dropped instruction is
  survivable *except* exactly where the gate is weakest — doctrine and gate share a blind spot.
- **The contradiction (verified):** the cycle is "red → green → **commit**", and step 5 says
  "**Commit** — one behavior, tested, at green." `gates-git.ts:383` denies `git commit` for
  every model session ("git commit publishes changes — publishing is conductor_publish's job,
  not a model session's"). The pack's headline procedure ends in an action the harness always
  refuses. A weak implementer following its primary doctrine will attempt the commit, be denied,
  and either retry/burn rounds, spend an `edit`/`git` override (ISSUE-007's budget-burn shape),
  or learn the general lesson that *doctrine is unreliable* — the worst outcome, since this is
  the same pack that carries "your claim is not the record." The deny message is good (it names
  conductor_publish); the pack should never have created the collision. See GAP-006.
- **Abstract-where-procedural:** the rationalization table is the best weak-model artifact in
  the set — excuse → reality pairs are exactly the retrieval shape a small model can use. The
  enforcement section ("the handler runs the test … RED before GREEN is structurally ordered")
  correctly teaches the model it cannot lie — but names no tool: `conductor_submit_test`,
  `conductor_mark_green` appear nowhere. As shipped the testWriter paraphrase carries the
  procedure; the pack floats free of it (ISSUE-003).
- **Uncovered situations (certain-hit):** the behavior that is *already implemented* — the
  testWriter writes the test, it passes immediately, and redAdmission refuses it as not-red. No
  pack tells the writer what this means (the item may be mis-scoped or already satisfied) or what
  to do (NEEDS_CONTEXT exists for exactly this; unnamed). This is the routine case of a stale
  queue item, not an edge case.
- **Stuck guidance:** none (debug.md has it, but debug.md arrives only in DEBUG posture, which
  requires having *reached* GREEN-and-regressed; the stuck testWriter has no doctrine).
- **Verdict:** strong voice, right law, one denied action in its headline, zero harness nouns.

### 2.9 test-vet.md — five anti-patterns for a job that is scored on five *different* criteria

- **Length:** ~805 tokens; fine.
- **The mismatch (verified):** vet critics are dispatched as role `reviewer` (so they receive
  review.md + test-vet.md once wired) and are instructed to return `verdictsByCriterion` over the
  §2.10 criteria: `observableBehavior`, `wouldCatchWrongImpl`, `rightLevel`, `pinsAcceptance`,
  `antiPatterns` (tools.ts:2939–2947). test-vet.md's five sections are: testing mock behavior,
  test-only methods, mocking without understanding, incomplete mocks, integration-as-afterthought.
  The overlap is partial (the pack ≈ one criterion, `antiPatterns`, plus half of
  `wouldCatchWrongImpl`); `observableBehavior`, `rightLevel`, and `pinsAcceptance` — three of the
  five things the critic must score — have **no doctrine at all**. A weak model holding two
  five-item lists that don't match will conflate them. And ISSUE-013 completes the picture: the
  criteria verdicts *gate nothing* (only the mustFix union is consulted), so the half of the job
  the pack does not cover is also the half the harness does not check.
- **First dropped:** anti-pattern 4 (incomplete mocks) — it demands knowing the real dependency's
  complete shape, the most expensive check. Consequence contained: mock-shape gaps surface at
  integration, and the vet criteria never asked about it anyway.
- **Contradictions:** none; it is complementary to review.md.
- **Verdict:** a good pack ported for a different job than the one the harness scores. Either the
  pack gains the §2.10 criteria (with the criteria list derived from one source into both pack
  and prompt — the P3-proof form), or the criteria prompt absorbs the anti-patterns. See GAP-008.

### 2.10 Cross-pack matrix summary

| Axis | Worst offender | Best |
|---|---|---|
| Length vs 32k budget | none — all fine | — |
| Procedural specificity | core.md (orchestrator: zero tool names, dead state block) | debug.md |
| Names its reply protocol | none of nine (NEEDS_CONTEXT / DONE_WITH_CONCERNS / schemas live in prompts only) | skeptic.md (names id/upheld/reasoning shape) |
| Pack-vs-gate contradiction | tdd.md ("commit" — denied at gates-git.ts:383) | — |
| Pack-vs-pack tension | receive-review "ask" vs core "derive, never ask"; core "batched at boundaries" vs surface design | — |
| Pack-vs-scoring mismatch | test-vet.md vs §2.10 criteria | — |
| Overstates its gates | decompose.md ("~5 files… rejected outright" vs entries-counting, ISSUE-012) | — |
| Lazy-model exploit surface | skeptic.md ("uncertain ⇒ refuted") + review.md ("empty = approval") | tdd.md (enforcement section is honest) |
| Stuck-state guidance | absent everywhere except debug.md's 3-fix rule | debug.md |

---

## 3. GAP records

Every record traces to a specific ISSUE, MACRO, correction, or observed behaviour per the
grounding rule. Form: the harness cannot re-derive X, so a model can assert/omit X freely, so
here is the mechanism. `STRUCTURAL OR ADVISORY?` is the field that matters most.

### DOCTRINE-EFFICACY-001 — Doctrine and procedure live in two channels, and the one the model weights is the unguarded one

- **GROUNDING:** ISSUE-001 (packs never arrive), ISSUE-003 (five hand-inlined paraphrases, no
  drift guard, ENV override ~95% theater), MACRO-008 (two mechanisms, one concern), plus the
  attention argument in §1: packs land in system position, paraphrases + payload at the prompt
  tail, and a weak-instruction model weights the tail. Reply protocols (NEEDS_CONTEXT,
  DONE_WITH_CONCERNS, JSON schemas, criteria lists) exist ONLY in the paraphrase channel
  (verified: tools.ts 3201/5806/2939); philosophy exists mostly in the pack channel.
- **WHAT THE HARNESS CANNOT RE-DERIVE:** that the doctrine a session acted under is the doctrine
  that was reviewed and anchor-tested. After ISSUE-001's fix the two channels will CONFLICT in
  the same context window (MACRO-008 says exactly this), and whichever the model followed is
  unrecorded and unrecoverable.
- **MECHANISM:** one composition point — dispatch prompts compose their doctrine slice FROM the
  loaded pack map (the existing debugFixPrompt pattern, per ISSUE-003's fix direction), and each
  pack gains a short MECHANICS section (tool names, reply statuses, gate names, criteria)
  GENERATED from the closed vocabularies so it cannot drift (the schema-export pattern the repo
  already has). A delivered-doctrine digest goes into the §3.8 beacon (IDEA-OBS-1) and the
  session registry, so "what doctrine governed this session" becomes a recorded fact 14.2 can
  measure.
- **STRUCTURAL OR ADVISORY?** Structural (single-source composition makes divergence
  impossible; the digest makes delivery a record, not a belief).
- **COST:** rides ISSUE-001/-003's fixes; the generated-mechanics section is ~1 day; digest ~2h.

### DOCTRINE-EFFICACY-002 — The orchestrator has no playbook: the FSM order exists in no doctrine and its compensating mechanism is dead

- **GROUNDING:** ISSUE-001 (state block — "the single highest-leverage mechanism for a lazy 32k
  model" per step 2's cross-lens pointer — reaches nobody); ISSUE-005 (meta tools guarded by
  neither the phase gate nor the dead advisory block; classify-shopping, defer-all-from-DECOMPOSED
  reproduced). core.md (the orchestrator's ONLY pack) says "work the legal next action" and never
  says what that is; the only ordering signal that arrives today is the one-line tool
  descriptions (plugin/index.ts:492–630, which do carry FSM edges — "PENDING to RED").
- **WHAT THE HARNESS CANNOT RE-DERIVE:** nothing re-derives that the orchestrator's next call is
  phase-legal for meta tools (E20 ACCEPTED-ON-TRUST); doctrine was the compensating control and
  it is (a) dead and (b) silent on ordering even as written.
- **MECHANISM:** three layers, cheapest first: (1) wire the state block (ISSUE-001's fix — its
  recommended-next-tool line IS the playbook, re-derived per request by `legalTools`); (2)
  `requireMetaTool` in `runTool` (ISSUE-005's fix — makes order structural, not advisory); (3) a
  ~15-line "run shape" section in core.md naming the stage tools in order and the meta tools'
  legality conditions — generated from `legalTools`' table, not hand-written (else it is a new
  P3 spelling).
- **STRUCTURAL OR ADVISORY?** (2) is structural and is the floor; (1) and (3) are advisory but
  are what makes a weak model *productive* rather than merely contained.
- **COST:** owned by step-2 fixes; the doctrine section ~2h once generated.

### DOCTRINE-EFFICACY-003 — No doctrine anywhere covers a gate DENY, the situation every session will certainly hit

- **GROUNDING:** ISSUE-002 (as shipped, EVERY sub-session write is denied in default mode — the
  first thing a live model meets is a deny loop); ISSUE-007 (misspelled override gate burns
  budget, "neither doctrine nor any deny message names them" — verified quote); MACRO-022 (the
  deny snapshot journals at `debug`, below default verbosity, so the operator can't see the loop
  either); adversary log (f) (honest use of the documented hatch is punished).
- **WHAT THE HARNESS CANNOT RE-DERIVE:** the harness denies correctly but cannot make the model
  respond correctly; there is no doctrine for "you were refused," so a weak model's responses are
  unbounded: silent retry loops (burning fan-out budget), override spends (mis-aimed, per
  ISSUE-007), or giving up into NEEDS_CONTEXT-less silence.
- **MECHANISM:** (1) a "When the harness refuses you" section, delivered to every role (it is
  ~12 lines: a deny is a fact, not an obstacle; never retry the same write; check the deny reason
  for the gate name; the legal ladder is narrow-your-edit → NEEDS_CONTEXT → override as last
  resort, and the ONLY spendable gate names are `session`, `git`, `edit`); (2) the deny messages
  already carry reasons — pin the gate-name vocabulary into them (ISSUE-007's fix direction:
  closed OVERRIDE_GATES vocabulary, refused at mint time for unknown names); (3) deny-loop
  detection: N consecutive denies for one session converts to a surfaced question/anomaly
  (extends the continuation floor pattern; MACRO-022's shape).
- **STRUCTURAL OR ADVISORY?** (2) and (3) structural; (1) advisory but certain-hit.
- **COST:** (1) ~2h; (2) owned by ISSUE-007; (3) ~1 day.

### DOCTRINE-EFFICACY-004 — skeptic.md's "uncertain ⇒ refuted" converts weak-model failure into finding-killing verdicts, and the record cannot hold the evidence the pack demands

- **GROUNDING:** the best-evidenced doctrine defect in the system: C-082/P10 (unanimous wrong
  refutation, sealed), MACRO-015 (two wrong refutations of those audited; kill rate 12%→71%;
  refutation costs one unaudited line), ISSUE-072 (adversary exploited the default as written),
  ISSUE-079 (no refutation-evidence field in the schema), C-030/-031/-038 (panels under-delivered
  by transport deaths — the "could not evaluate" state occurs in practice and the pack maps it
  to refuted).
- **WHAT THE HARNESS CANNOT RE-DERIVE:** whether a refutation was an evaluated failed
  reproduction or a blank stare. Both record as one line of `upheld:false`.
- **MECHANISM:** (1) pack change: split "could not refute after a real attempt" (refutes) from
  "could not evaluate" (abstains; an abstention upholds — the fail-closed direction MACRO-015
  endorses and the missing-seats rule already implements for transport deaths); (2) schema
  change: a required refutation-evidence field (the discriminating input, the lines read, the
  reading under which the finding fails) — a refutation without it is recorded as an abstention
  (ISSUE-079's fix); (3) add the identifier-position rule to the pack (P10's generalized lesson,
  IDEA-PD-8 — currently in no pack); (4) kill the "do not re-litigate" note as a category
  (MACRO-015 (2)).
- **STRUCTURAL OR ADVISORY?** (2) structural (the schema refuses the empty refutation); (1)/(3)
  advisory riding on it. Together they price refutation and uphold symmetrically — the same
  gradient-repair MACRO-007 prescribes for the escape hatches.
- **COST:** doctrine paragraphs + one schema field (~1 day, MACRO-015's estimate).

### DOCTRINE-EFFICACY-005 — review.md sanctions the zero-effort review and no diligence evidence exists for E8/E9

- **GROUNDING:** ISSUE-072 (E8 "the review found nothing" and E9 "the fix was implemented" are
  ACCEPTED-ON-TRUST; reproduced: `{"findings":[]}` advances every item); adversary log (b);
  review.md's own text ("An empty findings list … IS the approval").
- **WHAT THE HARNESS CANNOT RE-DERIVE:** that the reviewer read anything at all. Empty-and-lazy
  is byte-identical to empty-and-diligent.
- **MECHANISM:** the "delivery receipt" family (step 2's ISSUE-072 fix direction; IDEA-PD-9):
  each lens must return machine-checkable evidence it read the diff — the hunk headers or
  file:line spans it examined — and the harness cross-checks those against the actual diff
  (cheap string containment against something the model cannot know without the diff). The pack
  then says so ("your approval is the coverage list plus the empty findings"), which turns
  review.md's correct calibration line into a priced statement instead of a free exit. Same
  receipt on the fixer (E9): the DONE receipt names the lines changed; harness checks they
  intersect the finding's cited span.
- **STRUCTURAL OR ADVISORY?** Structural (the empty review without a valid coverage list is
  refused mechanically).
- **COST:** ~1–2 days (schema field + containment check + prompt/pack line).

### DOCTRINE-EFFICACY-006 — tdd.md's headline cycle ends in an action the git gate always denies

- **GROUNDING:** gates-git.ts:383 (`git commit` → deny, verified this review); tdd.md steps
  ("red → green → commit"; "Commit — one behavior, tested, at green"); ISSUE-007 (the
  budget-burn shape a mis-aimed recovery takes); ISSUE-003 (the paraphrase channel that
  currently hides this collision from every session will stop hiding it when ISSUE-001 is fixed).
- **WHAT BREAKS:** a weak implementer follows its primary doctrine into a guaranteed deny at the
  end of every green; recovery is unguided (see -003); worst case it spends overrides; the
  subtle cost is doctrine-credibility — the pack that teaches "your claim is not the record" also
  teaches a procedure the harness forbids.
- **MECHANISM:** rewrite the cycle as red → green → *hand back* ("the harness publishes;
  `conductor_publish` commits; you never run git commit/push — a publish you attempt yourself
  will be denied by design"). One paragraph. Keep the deny message as the backstop (it is
  already good — it names conductor_publish).
- **STRUCTURAL OR ADVISORY?** Advisory (the gate is already structural; this removes the
  doctrine-vs-gate collision so the structure stops being spent on doctrine-following models).
- **COST:** ~30 minutes + anchor-test update (which, per ISSUE-135, should anchor the full
  sentence, not a keyword).

### DOCTRINE-EFFICACY-007 — receive-review.md's protocol verbs have no named mechanism; the packs never name NEEDS_CONTEXT or DONE_WITH_CONCERNS

- **GROUNDING:** verified: NEEDS_CONTEXT (tools.ts:3201/3852/4272, continuation.ts:1199) and
  DONE_WITH_CONCERNS (tools.ts:5806/5837, adjudicated at 6453–6476) exist only in dispatch
  prompts; no pack mentions either. ISSUE-049 (substring pushback matching mis-adjudicates
  loosely-worded concerns); ISSUE-036 (lost conversions — the mechanism is fragile exactly where
  doctrine-following traffic would use it); receive-review.md "ask exactly what is meant" /
  "refute it with evidence" name no channel.
- **WHAT THE HARNESS CANNOT RE-DERIVE:** whether a fixer that disagreed followed protocol or
  went silent; a doctrine-following fixer with no named channel improvises, and improvised
  pushback fails the substring matcher.
- **MECHANISM:** the generated MECHANICS section from -001 covers this (the reply statuses and
  the exact concern format including the finding id token); fix the matcher to exact-token
  (ISSUE-049's fix); pack text keeps the philosophy and points at the mechanics by name.
- **STRUCTURAL OR ADVISORY?** The matcher fix is structural; the naming is advisory but is what
  makes the structural channel reachable by a weak model.
- **COST:** covered by -001 + ISSUE-049's fix.

### DOCTRINE-EFFICACY-008 — test-vet.md and the §2.10 criteria are two different five-item lists; three of five scored criteria have no doctrine

- **GROUNDING:** verified this review: vetCriticPrompt (tools.ts:2939–2947) scores
  observableBehavior / wouldCatchWrongImpl / rightLevel / pinsAcceptance / antiPatterns; the
  reviewer-role pack test-vet.md teaches five mock anti-patterns ≈ one of those criteria.
  ISSUE-013 (the criteria verdicts gate nothing — only mustFix is consulted, and a
  self-contradictory pass:false-with-empty-mustFix advances).
- **WHAT THE HARNESS CANNOT RE-DERIVE:** that a criterion verdict reflects an evaluation of that
  criterion. With no doctrine for three criteria and no enforcement consuming any of the five
  verdicts, the per-criterion structure is decoration a weak model fills by pattern.
- **MECHANISM:** (1) derive the criteria list from ONE source into both the pack's mechanics
  section and the prompt (the P3-proof form; today it is spelled at tools.ts:2942 and again at
  5884); (2) give each criterion two sentences of doctrine (what a failing test for it looks
  like — the followable form test-vet.md already uses for mocks); (3) land ISSUE-013's fix
  (pass:false implies a mustFix entry) so the verdicts bite.
- **STRUCTURAL OR ADVISORY?** (3) structural; (1) structural against drift; (2) advisory.
- **COST:** ~half a day plus ISSUE-013's fix.

### DOCTRINE-EFFICACY-009 — decompose.md teaches units and guarantees the enforcement does not hold

- **GROUNDING:** ISSUE-012 (size budget counts fileScope ENTRIES; pack says "~5 files …
  rejected outright"); ISSUE-011 (wildcard-headed fileScope makes missing-subject vacuous; pack
  never says "no globs"); ISSUE-008 (no fileScope∩testScope=∅ rule; pack silent on behavioral
  items containing their own test files); ISSUE-009 + ISSUE-048 (the pack's "the law bends by
  path arithmetic the model cannot argue with" is falsified two ways).
- **WHAT THE HARNESS CANNOT RE-DERIVE:** item size in files (only in entries), scope
  concreteness, test-scope disjointness — so a model can assert a "small" item that is the whole
  repo. The pack *invites* the honest version of the exploit by teaching a unit ("files") the
  gate does not measure.
- **MECHANISM:** enforcement first (owned by step 2: expand-and-count or refuse globs
  [ISSUE-012], reject wildcard heads [ISSUE-011], reject fileScope∩testScope [ISSUE-008], close
  rootLevelOnly [ISSUE-009], refuse behavioralPaths:[] [ISSUE-048]); THEN align the pack's
  vocabulary to whatever the gate actually measures, and delete the pack's enforcement claims
  that remain false (the MACRO-021 rule applied to doctrine: a pack claim about a gate names the
  gate that proves it or does not appear).
- **STRUCTURAL OR ADVISORY?** Structural (the five enforcement fixes); the pack alignment is
  advisory hygiene that stops training the model on a false unit.
- **COST:** owned by step-2 fixes; pack edit ~1h.

### DOCTRINE-EFFICACY-010 — There is no stuck-state doctrine outside debug.md, and debug.md only arrives after GREEN

- **GROUNDING:** debug.md's 3-fix rule is the only stuck protocol in nine packs and is
  delivery-conditional on DEBUG posture (inject.ts:182–187), which requires having reached GREEN
  and regressed; the certain-hit stuck states occur EARLIER: the testWriter whose test passes
  immediately (redAdmission refuses it — E1's refusal path, routine for a stale queue item), the
  fixer whose finding is wrong (covered only by unfollowable -007), the session in a deny loop
  (-003), the skeptic who cannot evaluate (-004). ISSUE-036 shows the NEEDS_CONTEXT path itself
  loses conversions when the run ends first.
- **WHAT THE HARNESS CANNOT RE-DERIVE:** the difference between a session that is working and
  one that is flailing; today flailing shows up only as burned fan-out budget and eventual
  noop/env stops (ISSUE-065/-066 — and the incentive gradient then REWARDS the flail-exit,
  per the enforcement pointer: "doctrine-efficacy analysis must account for the harness
  structurally rewarding the lazy exit").
- **MECHANISM:** (1) a uniform ~8-line "when you are stuck" section in every pack: bounded
  attempts (the 3-fix counter generalized), then NEEDS_CONTEXT with a named-what-you-need
  payload — never silence, never a workaround outside your scope; (2) the harness side already
  half-exists (NEEDS_CONTEXT → surfaced question) — fix its leaks (ISSUE-036) and make
  stuck-exits visible in the report so they are not free (MACRO-007's pricing point: doctrine
  telling a model not to defer is advisory; a defer that costs budget is structural — the same
  applies to stuck-exits).
- **STRUCTURAL OR ADVISORY?** (1) advisory; (2) structural. Pricing is the part that binds a
  lazy model; the doctrine is what lets an honest weak model take the priced path correctly.
- **COST:** (1) ~2h across nine packs; (2) rides ISSUE-036/-065 fixes + MACRO-007's schema.

### DOCTRINE-EFFICACY-011 — core.md's ask policy contradicts the mid-run surface design and starves the one honest channel

- **GROUNDING:** core.md: "Questions are batched at run boundaries, not fired mid-run." Plan
  line 1873: surfacing "only at run boundaries, batched in the report **or as surfaced**" —
  the pack's compression drops the second arm. conductor_surface's description
  (plugin/index.ts:541) is explicitly mid-run ("mark named items blocked, and continue the
  rest"). Composed with ISSUE-051 (self-answer invisible) and ISSUE-065 (blocked runs mislabel
  as done/noop): the orchestrator that follows core.md literally never surfaces mid-run, so
  blockers resolve by fabrication or by lost work — both reproduced by step 2.
- **MECHANISM:** one-sentence pack fix: "A blocking question is surfaced the moment it blocks an
  item (conductor_surface) — the *human* sees questions batched, you do not sit on them." Plus
  the ISSUE-051/-052 fixes (answered-questions section in the report; derived provenance) that
  make the honest channel auditable.
- **STRUCTURAL OR ADVISORY?** Advisory (the contradiction is textual); the auditability halves
  are structural and owned by step 2.
- **COST:** ~15 minutes + anchor update.

### DOCTRINE-EFFICACY-012 — The cheapest escape hatches have no doctrine at all: defer and inline_claim are governed by nothing a session ever reads

- **GROUNDING:** MACRO-007 (three hatches, three price tags, cheapest = defer: free, untainted,
  forges kind:"human" [ISSUE-052], full-run escape reproduced in adversary log (a)); core.md
  documents ONLY the override hatch, and core.md reaches only orchestrator/mechanical;
  ISSUE-006 (any registered sub-session can call defer/inline_claim/answer). Step 3's pointer 5
  states the priority: "The backwards incentive gradient is a *pricing* problem before it is a
  doctrine problem."
- **WHAT THE HARNESS CANNOT RE-DERIVE:** whether a defer was a legitimate disposition or the
  lazy exit — nothing in the record distinguishes them (until MACRO-007's shortcut schema).
- **MECHANISM:** pricing first (MACRO-007's one shortcut schema: budget + taint + honest
  provenance for ALL THREE hatches — structural, needs a recorded plan deviation); then ~6 lines
  of doctrine in core.md naming when a defer is legitimate (a genuine dependency on an
  unanswered human question, or an explicitly descoped item — anything else is work avoidance
  and is priced), delivered wherever the tools are callable (which, after ISSUE-006's fix, is
  the orchestrator only — making the doctrine placement finally coherent).
- **STRUCTURAL OR ADVISORY?** Pricing structural; doctrine advisory; sequence matters (pricing
  without doctrine confuses the honest model; doctrine without pricing is ignored by the lazy
  one).
- **COST:** owned by MACRO-007 (~2 days + deviation record); doctrine ~1h.

### DOCTRINE-EFFICACY-013 — Nothing re-derives that the packs still say what was reviewed, or that delivery happened: anchors pin keywords, ROLE_PACKS drifts silently, the beacon cannot say doctrine loaded

- **GROUNDING:** ISSUE-135 (inverting core.md's "Exhaustion stops the run" → "continues" leaves
  doctrine.test.ts 15/15 green — the anchors are keyword greps); ISSUE-114 (a pack added to
  ROLE_PACKS but not REQUIRED_PACKS is silently never delivered; both maps module-private; the
  nine-pack list restated four ways, none derivable); ISSUE-004 (beacon written before packs
  load; "fail-closed at init" is actually at first tool call); MUT table rows "core.md heading
  → SURVIVES", "add extra-governance.md → SURVIVES".
- **WHAT THE HARNESS CANNOT RE-DERIVE:** (a) that a pack still asserts its doctrine (a pack
  asserting the OPPOSITE stays green); (b) that every role-mapped pack is actually deliverable;
  (c) that doctrine was loaded before work began.
- **MECHANISM:** (a) anchor full normative sentences (or a content hash per section) instead of
  keywords — ISSUE-135's fix; (b) derive REQUIRED_PACKS = union(ROLE_PACKS) ∪ {debug,
  receive-review}, export both, fail closed on a missing pack — ISSUE-114's fix; (c) load packs
  before the beacon write and stamp a doctrineLoaded digest into the beacon — ISSUE-004's fix +
  IDEA-OBS-1. All three are prerequisites for 14.2's doctrine-vs-no-doctrine arms meaning
  anything (MACRO's arm-inversion finding: at HEAD the conductor arm delivers LESS doctrine than
  the arm it must superset).
- **STRUCTURAL OR ADVISORY?** All structural.
- **COST:** each is small and specced by its issue; ~1 day total.

### DOCTRINE-EFFICACY-014 — SPECULATIVE: no doctrine (or mechanism) covers partial-context work — a 32k model reviewing a diff bigger than its window

- **GROUNDING (why only speculative):** no step-2 ISSUE reproduces it (no live model has run).
  But the arithmetic is step 3's: MACRO-010 measures a 32k reader's budget at ~24k usable
  tokens, e2e.test.ts alone is 51k tokens, and review payloads embed full diffs + test text.
  A reviewer/skeptic whose payload exceeds its window will silently judge a truncated view —
  and per -004/-005, silence and emptiness are currently free.
- **MECHANISM:** (1) doctrine: "if you could not read everything, say what you did not read" —
  paired with -005's coverage receipt so partiality is recorded rather than asserted; (2)
  mechanism: the dispatcher knows payload sizes — it can refuse to dispatch a review payload
  over a configured token bound and split it (per-file lenses), the same shape as the item size
  budget. (2) is the structural version.
- **STRUCTURAL OR ADVISORY?** (2) structural, (1) advisory.
- **COST:** (1) free with -005; (2) ~1–2 days.
- Ranked below every grounded entry per the charter.

---

## 4. IDEA entries

### IDEA-DE-1 — Fix the dangling `[[decompose]]` wiki-link in core.md
Origin: reading core.md as the orchestrator, which never receives decompose.md; the link renders
as literal `[[decompose]]` in a system prompt.
Kind: docs/polish. Value: removes an unresolvable reference from delivered doctrine (weak models
chase or mimic broken syntax). Cost: minutes. Relates to: DOCTRINE-EFFICACY-001.

### IDEA-DE-2 — Stamp a pack name + content-hash header line into each delivered pack
Origin: 14.2 needs per-role doctrine-citation rates (MACRO-032) and today a transcript cannot
show which doctrine version governed a session.
Kind: tooling. Value: makes doctrine efficacy measurable at 14.2; turns "which doctrine did this
session have" into a grep. Cost: ~1h. Relates to: DOCTRINE-EFFICACY-001/-013.

### IDEA-DE-3 — Front-load every pack with a ≤10-line imperative summary; keep qualifiers below
Origin: the per-pack "first dropped" analysis — in every pack the headline survives and the
balancing qualifier dies (skeptic.md's uphold clause, tdd.md's observe-the-red, core.md's
decision records). Kind: docs. Value: puts the load-bearing clause in the position a weak model
retains; the current packs bury their most important sentence mid-paragraph roughly half the
time. Cost: ~half a day across nine packs, no semantic change. Relates to: all per-pack entries.

### IDEA-DE-4 — The state block should carry a deny-recovery hint when the session's last action was denied
Origin: GAP-003; the state block is re-rendered every request and the registry knows a deny just
happened. One conditional line ("your last write was denied by the <gate> gate: <reason>; do not
retry it — narrow scope or reply NEEDS_CONTEXT") is the cheapest possible deny doctrine, delivered
exactly when relevant. Kind: ergonomics. Cost: ~2h once ISSUE-001 is wired.
Relates to: DOCTRINE-EFFICACY-002/-003.

### IDEA-DE-5 — Anchor tests should quote the sentence, not the keyword — and each GAP fix above should land with its anchor
Origin: ISSUE-135 (inverted doctrine stays green) plus the observation that several fixes here
are one-sentence pack edits that a keyword anchor cannot protect.
Kind: test-maintainability. Cost: rides ISSUE-135's fix. Relates to: DOCTRINE-EFFICACY-006/-011/-013.

### IDEA-DE-6 — Endorse MACRO-032's measurement plan as the acceptance test for this whole lens
Origin: every retention judgement above is structural, not measured. 14.2 should record, per
role: doctrine-citation rate, deny-recovery behavior after a deny, NEEDS_CONTEXT usage vs
silence, skeptic abstention rate. Those four numbers falsify or confirm the per-pack verdicts in
§2. Kind: tooling/process. Cost: folds into the 14.2 campaign design. Relates to: all.

---

## 5. Coverage ledger

| Item | Read/verified | Verdict summary |
|---|---|---|
| doctrine/core.md (92 ln) | full | strong epistemology, dead procedure; ask-policy contradiction (GAP-011); override vocabulary unnamed (GAP-003) |
| doctrine/debug.md (69 ln) | full | best pack; only one governing anything as shipped; missing debugFixCap warning |
| doctrine/decompose.md (102 ln) | full | overstates gates; unit mismatch with enforcement (GAP-009) |
| doctrine/plan.md (87 ln) | full | followable; Rule 3 is the effort-shed casualty; queue_amend undoctrined |
| doctrine/receive-review.md (56 ln) | full | right philosophy, no named mechanism (GAP-007); "never weaken test" unenforced (ISSUE-008) |
| doctrine/review.md (65 ln) | full | sanctions zero-effort review (GAP-005); adjudication paragraph aimed at wrong reader |
| doctrine/skeptic.md (66 ln) | full | convicted by the record; default converts incapacity to refutation (GAP-004) |
| doctrine/tdd.md (75 ln) | full | headline cycle ends in a denied action (GAP-006); zero harness nouns |
| doctrine/test-vet.md (73 ln) | full | wrong five-list for the scored job (GAP-008) |
| adapter/inject.ts | lines 1–244 (maps, buildSystemAppend, params, headers) | delivery mapping + conditional packs verified; core.md not universal |
| adapter/tools.ts | targeted: vetCriticPrompt 2920–2980, fixer prompts 5789–5850, NEEDS_CONTEXT sites, role assignments grep | reply protocols live in prompts only; criteria list spelled twice (2942, 5884) |
| core/gates-git.ts | commit/push deny reasons (140–150, 383) | tdd.md "commit" collision verified |
| core/planning.ts | ponytail enforcement 281–397 | decompose.md's reuse-note claim is honest (minimal-code rung, full/ultra) |
| plugin/index.ts | tool descriptions 492–630, hook returns (via step-2 record) | descriptions carry FSM edges — the one ordering signal that arrives today |
| plan (immutable) | targeted: line 1873 (question batching), §4.1/§6.4 via step-2/3 records | core.md batching compression verified against source |
| findings-enforcement.md (2,303 ln) | executive verdict, full ISSUE clusters A–H (1–569), cross-lens pointers, enforcement table, adversary log, mutation rows re doctrine; remainder via targeted greps | all doctrine-relevant ISSUEs worked: 001, 003, 004, 005, 006, 007, 008, 011, 012, 013, 036, 048, 049, 051, 052, 065, 066, 072, 079, 114, 135 |
| findings-macro.md (1,255 ln) | executive verdict, MACRO-001/-002/-003/-005/-006/-007/-008/-009/-010/-011/-012/-015/-016/-017/-021/-022/-032/-033, correction clustering, IDea list, cross-lens pointers §6, pointer dispositions §7 | pointers 5 and 10 (addressed to this lens) worked into GAP-012/-013/-001; MACRO-015 → GAP-004; MACRO-022 → GAP-003/IDEA-DE-4 |

**Cross-lens pointers addressed to this lens, dispositioned:**
- Enforcement pointer "incentive gradient runs backwards … doctrine-efficacy analysis must
  account for the harness structurally rewarding the lazy exit" → worked into GAP-010/-012 (and
  the through-line of §2.6/§2.7: the packs at the review layer *align with* the lazy gradient
  rather than opposing it).
- Enforcement pointer "the live state block … reaches nobody" → GAP-002 (and IDEA-DE-4).
- Macro pointer 5 (escape-hatch pricing before doctrine) → GAP-012 adopts the pricing-first
  ordering explicitly.
- Macro pointer 10 (doctrine efficacy counterfactual; keyword anchors; arm inversion) → framing
  of §0 and GAP-013.

**Cleared / negative results (stated per briefing §5.1):**
- Pack LENGTH is not a problem for any role at 32k (≤8.3% worst case, measured) — the charter's
  "too long to survive truncation" concern does not materialize; the risk is attention position,
  not size.
- debug.md and plan.md contain no contradictions against any other pack or gate (checked
  pairwise against the gate behaviors verified this review).
- decompose.md's "empty reuse note is rejected" claim is honest (enforced at planning.ts:390–397
  for the minimal-code rung under full/ultra) — one pack enforcement claim that checks out.
- No missing-pack case was found for the classifier beyond GAP-002's general orchestrator gap:
  classification is skeptic-checked and disagreement-normalized mechanically (E4), so a classify
  pack would add little; recorded as considered-and-cleared.
- I could not construct a pack-vs-pack contradiction between review.md and test-vet.md, nor
  between decompose.md and plan.md (the planner's co-delivered pair) — their overlap
  (minimality) is consistent.

**Honest limits of this assessment:** no live weak-instruction model was run against the packs;
"first dropped" judgements are structural (position, effort, imperative density) plus build-record
analogs from stronger models, and are falsifiable by IDEA-DE-6's measurements at 14.2.
