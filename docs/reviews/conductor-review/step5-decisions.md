# Conductor Review — Step 5: Delegation Design Decisions

**Date:** 2026-08-18 (interactive session, repo owner deciding)
**Inputs:** `findings-capability.md` §1/§8/§9, `findings-enforcement.md` §1/§5 (E1–E24),
`findings-macro.md` §1/§3, `step5-preflight-review.md` (corrections-applied state).
**Output:** this decision record, plus the executable plan at `docs/build/fix-campaign-plan.md`,
which supersedes both the capability register's §8 provisional ordering and HANDOFF.md's
2026-08-14 "Do these in this order" list.

Every decision below was made by the owner against the evidence cited. Where a decision is
deliberately deferred, its re-open condition is named in §4.

---

## 1. The design premise (governs everything below)

**Trust lives in the harness, not the orchestrator.** Any orchestrator — a human typing a
request, a Claude-class model handing off a task, any other LLM — is a thin, untrusted client.
Everything between the prompt and the result runs on local models, and the result must arrive
self-defending: evidence the harness re-derived, an honest disposition
(`done` / `blocked` / waiting-on-human / stuck), a terminal report that does not require reading
the run's internals to believe. The orchestrator's competence is never a load-bearing part of
work quality.

Consequences:
- **No role is kept outside the local pipeline.** Classify, decompose, test-writing, vet,
  implementation, review, and disposition all run on local models. Every role whose output the
  harness currently accepts on trust gets its witness on the critical path — none is waived on
  the grounds that "a stronger model holds that seat."
- **The campaign's acceptance criterion:** a naive prompter can accept the returned result
  without re-verifying the work. This generalizes the agenda's charter question ("can a
  Claude-class orchestrator delegate and not redo the work?") to any prompter.
- **The terminal report and run disposition are the orchestrator-facing contract** — the only
  surface an arbitrary prompter touches. GAP-021/GAP-022 (honest stop kinds) and GAP-024
  (guaranteed terminal report) carry it.

---

## 2. The agenda's five framing decisions

### 2.1 The delegation primitive
**Decided:** the unit of behavioral work stays **red-test→green** — a vetted failing test the
implementer must turn green without touching it — executed by the full local pipeline
(testWriter writes it, the vet admits it, the implementer answers it). It is the only work
shape whose acceptance sits on the enforcement table's re-derived spine (E1 red admission,
E3 full verify), and it is the shape where briefing cost and verification cost collapse into
one artifact. Non-behavioral items keep their existing path, bounded by the same scope gates
and the now-witnessed review layer.

### 2.2 The trust boundary
**Decided:** v1 operation is **attended** (the human operator watches; runs are not left
alone). The trust floor — what must be machine-checked before a returned result is accepted —
is everything in the plan's Phases I–V: composition witnessed (ISSUE-001/-002, GAP-001/-003/
-004), meta-tool legality and caller identity (GAP-006), the TDD/scope seam closed (GAP-007/
-008/-009/-010/-015, ISSUE-009/-046), the vet criteria biting (GAP-041), the review layer
priced and witnessed (GAP-011/-012/-036/-040), honest disposition (GAP-021/-022 under D5),
and the human-provenance boundary (GAP-013, ISSUE-052).

Rows consciously accepted on trust for v1: E5 (decision option scores are fiction — shape is
enforced), E17 (setup relays — the operator runs setup personally). Every other
accepted-on-trust row in enforcement §5 has its witness scheduled.

### 2.3 Triage
**Decided:** **mechanical floor only; no competence model before live data.** Pre-dispatch
checks: the GAP-009 scope-size/shape measure, a read-set token bound (refuse dispatch when an
item's files exceed the local model's context budget — the macro §4 measurement makes
tools.ts-shaped work refusable a priori), and a hard per-item attempt cap, after which the item
takes a `blocked`/stuck disposition in the report. Under the red-test primitive an incompetent
model fails visibly (the test stays red); triage misjudgment costs bounded local attempts, not
corrupted work. Competence thresholds get set from 13.2's recorded outcomes — correction
cluster G (every live measurement overturned an assumption; zero live runs so far) rules out
inventing them now.

### 2.4 Failure economics
**Decided:** wrong work costs bounded attempts plus one re-brief; the detection instruments
(vetted test, full verify) are already re-derived. The record-level half is D5 (§3): a red
closing verify can never be `done`. An exhausted attempt cap surfaces as an honest disposition,
not a silent retry loop and not a forged completion.

### 2.5 Briefing supplied by the harness
**Decided:** the harness supplies briefing **structurally, with no new mechanism invented
pre-data**: doctrine delivery + the live state block (the ISSUE-001 wiring), a generated
MECHANICS section in every pack (GAP-005), the tdd.md deny-loop fix (GAP-039), scope
boundaries as machine-enforced `fileScope`, and the failing test itself as the specification.
GAP-005 and GAP-039 ride the wiring (plan Phase I), not the late doctrine pass. Read-set
assembly (GAP-045, SPECULATIVE) stays unscheduled; 13.2 records whether briefing is still the
bottleneck (re-open condition in §4).

---

## 3. The open decisions D1–D15

| # | Decision | Ruling | Rationale / consequence |
|---|---|---|---|
| D1 | Overall scope | **Trust-floor-first** (the seven-phase plan): floor + judgment seams + hygiene + doctrine + pre-live → attended 13.2 (~6–6.5 wks) → data-driven closures → 14.2 → build floor **before the addendum executes**. | Closes every reproduced escape before live contact; defers exactly the work whose design inputs are live data (posture flip, competence thresholds, read-set assembly). MACRO-030's constraint binds at addendum execution, not at 13.2. |
| D2 | tools.ts split | **Canary now, split re-decided at Phase 16.** GAP-017's stripComments fix is a hard prerequisite of the ISSUE-001 wiring; the full split is re-decided at Phase 16 planning, recorded in the D14 amendment. | ISSUE-002's fix is outside the audit-blind spans (preflight correction to chain 2); the wiring's new code is not — the canary makes it visible without churning 45 imports pre-live. |
| D3 | Defer pricing | **Split.** Defer stays free but **provenance-honest now**: ISSUE-052's fix (derived provenance only — model deferrals stop wearing human authority) lands pre-live. Full escape-hatch pricing (GAP-014) waits for the unattended milestone. | A weak local orchestrator forging human provenance is a day-one channel under the §1 premise; pricing economics can wait, honesty cannot. |
| D4 | answeredVia / answer file | **Yes, pre-live.** GAP-013's answer-file channel through the state area the model cannot write lands in plan Phase III. | E14 is a full human-in-the-loop simulation, invisible; with no trusted orchestrator in the loop, human provenance must be structural before first live contact. |
| D5 | RED closing verify | **Strict: never `done`.** Maps to `blocked`/`env`; §2.9's done row amended to match §3.2; sequenced after GAP-035 de-flakes the gate; all six stop kinds kept. | The final verdict is the one thing a prompter must trust blind. ISSUE-134's nondeterministic red is why GAP-035 must land first. |
| D6 | Second sessions | **Flock + attribution.** Evidence attribution immediately, OS single-writer lock at its plan slot; the false "read-only conductor" claim withdrawn. | The declaration alternative is a paragraph, and the correction record shows paragraphs don't hold (cluster B; MACRO-017). Accidental second sessions are this operator's actual working style. |
| D7 | GAP-025 posture flip | **Measure first.** XS enumeration closures land pre-live; IDEA-LC-9 deny-rate recording rides 13.2; the flip lands **together with GAP-038's deny-recovery doctrine** after 13.2, before 14.2. | MACRO-009's measurement favors the flip; zero live data on benign-deny friction favors waiting. Attended v1 makes the interim a watched risk. Settles D15(a). |
| D8 | apply_patch / patch | **Remove + pin.** Gate denies both WRITE tools; a wire-contract pin test goes red if opencode ever offers them. | Latent hole, one config flip from reachable; body-parsing serves no current role's tool shape. |
| D9 | Failover / backoff | **Record the deviations** (ISSUE-040: failover = setup probes only, supervisor restart is the resilience story; ISSUE-041: 503 codes are diagnostic-only), correct the lying headers, delete-or-wire `routerHealthy`, add MACRO-031's "single upstream, single model" disclosure. **ISSUE-042's cheap key-bounding fix** rides pre-live. Implement the halves only when a second backend is actually scheduled. | Failover is structurally impossible without re-pointing opencode mid-session; both halves serve a fleet that doesn't exist. ISSUE-042 has a live reproduction and a cheap fix. |
| D10 | Zero-test green | **Refuse.** The green path refuses what the red path refuses (zero-test, fallback); flake becomes a visible retry, not an admitted vacuous green. | Symmetry (GAP-008's name), consistency with D5. |
| D11 | Skeptic default | **Abstention-upholds** (GAP-036 as specced). A refutation needs evidence; a no-evidence skeptic abstains, and abstention upholds. | Prices lazy skepticism in both directions; the blanket "uncertain ⇒ uphold" makes findings unkillable. MACRO-015/P10 is the grounding. |
| D12 | Journal vocabulary | **Static audit is the authority; no production throw.** Sound once the D2 canary lands (it fixes ISSUE-088's blindness); widened by GAP-017's full inversion later. | A novel journal event must never kill a live run; the journal is observability, not a gate. |
| D13 | Leave-unfixed list | **Split.** Cheap-fix now: ISSUE-070 (human-territory pattern narrowing — a liveness tax on every run), ISSUE-071 (id/glob shape validation, rides GAP-009), ISSUE-110 (**delete** the eviction knob + dead `fetch_model` + README section — the destructive half must not outlive the missing restorative half). Leave, recorded: ISSUE-044/-045/-127, MACRO-034. GAP-048: recorded risk acceptance now, one-agent read pass at Phase 16. GAP-045/-047: unscheduled (§4). | Costs stated per entry in the registers; the three cheap fixes touch the delegation path or the operator's disk. |
| D14 | Amend the addendum | **Amend before executing.** Six corrections: the two silent-seam files added to its file lists (MACRO-025); 17.4 gated on GAP-021; 17.5's ISSUE-001 dependency stated; the D2 split re-decision rider; the MACRO-030 sequencing constraint (build floor lands first); the §1 orchestrator-agnostic premise. | Executing into known-unsatisfiable acceptance rows is the MACRO-020 failure the review just catalogued. The addendum is still uncommitted — this is its cheapest moment to amend. |
| D15 | Conflict registry | **(a)** settled by D7 — flip and GAP-038 land together. **(b)** GAP-011 prices the empty review; review.md's "do not invent findings" calibration line is kept verbatim. **(c)** the GAP-016 registry **pins** plan-frozen spellings, never replaces them. **(d)** settled by D5 — six stop kinds kept; no vocabulary collapse. | — |

---

## 4. Parked decisions and their re-open conditions

| Parked item | Re-open when |
|---|---|
| GAP-014 full escape-hatch pricing (rest of D3) | The unattended milestone: first run left alone. |
| GAP-023 operator health surface (absent from the provisional plan's positions; given a home here) | The unattended milestone. |
| GAP-045 read-set assembly (SPECULATIVE) | 13.2's briefing-bottleneck observation shows briefs still dominate orchestration cost. |
| GAP-047 waiting-human doctrine pack (SPECULATIVE) | Never, absent new evidence — its own record says the structural fixes (GAP-013/-014/-021) are strictly better. |
| tools.ts full split (D2) | Phase 16 planning, via the D14 amendment rider. |
| Competence thresholds (triage) | 13.2's recorded per-item outcomes. |
| GAP-025 flip calibration (D7) | 13.2's deny-rate data. |

---

## 5. New work items minted by this session

1. **Read-set token bound** — pre-dispatch refusal when an item's file set exceeds the local
   model's context budget (rider on GAP-009).
2. **Per-item attempt cap** — bounded implementer attempts; exhaustion → `blocked`/stuck
   disposition in the report, never a silent loop.
3. **apply_patch/patch wire-contract pin** (D8).
4. **ISSUE-071 shape validation** — `^[A-Za-z0-9_-]+$` on item ids, newline-folded fileScope
   entries (rider on GAP-009).
5. **13.2 instrumentation additions** — per-item competence-outcome recording and a
   briefing-bottleneck observation, alongside the already-planned GAP-046 probes and
   IDEA-LC-9 deny-rate recording.
6. **Deviation and disclosure records** (D9) and the GAP-048 risk-acceptance record (D13).
7. **The D14 addendum amendment** (six corrections, §3).

---

## 6. Supersessions

- `findings-capability.md` §8 (provisional ordered plan) is superseded by
  `docs/build/fix-campaign-plan.md`. The register itself remains the evidence authority.
- HANDOFF.md's 2026-08-14 "Do these in this order" list is superseded; the mapping of its
  items into the new plan is in the plan doc's "absorbed queue" section.
- The capability register's §9 header ("deliberately NOT made") is now historical: D1–D15 are
  decided or parked per §3/§4 above.
