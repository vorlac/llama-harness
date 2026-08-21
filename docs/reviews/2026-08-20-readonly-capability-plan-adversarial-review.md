# Adversarial review — read-only capability plan (Phases 20–27)

**Target:** [docs/plans/readonly-capability-plan.md](../plans/readonly-capability-plan.md) (194 lines, proposed addendum, unsigned)
**Reviewer:** Claude Opus 5, orchestrating a 22-agent audit fleet (8 ground-truth passes, 7 skeptic re-checks, 5 red-team lines, 1 completeness critic)
**Date:** 2026-08-20
**Mandate:** recon only. The plan is unchanged. Nothing in the repository was modified.
**Method:** every load-bearing factual claim in the plan was checked against HEAD, then each ground-truth report was re-checked by an independent skeptic before being admitted here. Findings that a skeptic corrected are stated in their corrected form.

---

## How to read this

The plan asks a good question and answers it in the right architectural idiom. Its refusals are
correct, its choke-point instinct is correct, and its maturation doctrine is copied from a
precedent that genuinely exists in this repository. If it were judged on design taste alone it
would pass.

It does not survive contact with the code. The problem is not the design — it is that the plan
was written from the *documentation* of this system rather than from the system. That single
methodological fact explains almost every defect below: the founding premise, four wrong module
citations, two capabilities proposed that already ship, and a measurement harness proposed that
largely exists.

The consequence is not "reject the plan". It is that the plan describes a **different, smaller,
and more valuable change** than the one it thinks it describes — and until the premise is
restated, the phase ordering, the sizing and two of the four lanes are pointed at the wrong
target.

**Severity meanings:**

| Level        | Meaning                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL** | The plan's stated justification or a whole phase rests on something the code contradicts. Must be resolved before any implementation begins. |
| **HIGH**     | A named invariant, mechanism, or safety device does not work as described. The phase can be built, but not as written.                       |
| **MEDIUM**   | Real cost, correctness or measurement problem that changes sizing or sequencing.                                                             |
| **LOW**      | Bookkeeping and convention defects that will cost a fix round if they land as written.                                                       |

---

## Summary of findings

| #     | Severity | Finding                                                                                                                                                                 |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1    | CRITICAL | The capability-starvation premise is contradicted by the code. Conductor sessions already reach the web and the linters.                                                |
| C2    | CRITICAL | The head-to-head bench's vanilla arm already exists and has never been run. Six phases are ordered ahead of the measurement that justifies them.                        |
| C3    | CRITICAL | `conductor_mechanize` re-implements a shipped mechanism in a strictly less safe form, and its two safety devices are unsound.                                           |
| H1    | HIGH     | Phase 21 as specified revokes capability rather than granting it, names the wrong module, and needs a rule the closed phase vocabulary cannot express.                  |
| H2    | HIGH     | I2 is a new restriction, not a preserved invariant. The freeze is a write-path rule; fan-out admits readers into frozen trees by design.                                |
| H3    | HIGH     | I3 holds only under a constraint the plan omits: real diagnostic runners write caches into the tree.                                                                    |
| H4    | HIGH     | "R3 off by default" is not an off. `bash curl` is read-classified and allowed; the egress proxy is the only load-bearing control and the plan marks it optional.        |
| H5    | HIGH     | The prompt-injection chain terminates at `conductor_override`, which stays sub-session callable, and the provenance envelope has no implementation seam.                |
| H6    | HIGH     | `conductor_docs` is query-on-demand, which assumes the model can detect its own ignorance — the exact deficit it exists to fix.                                         |
| H7    | HIGH     | Four module citations are wrong and three vocabulary collisions are introduced. An implementing agent following the plan literally lands in the wrong files.            |
| M1    | MEDIUM   | Cost accounting is absent. Seven files per tool, four tools, into the one file the build's own review flagged as its worst structural defect.                           |
| M2    | MEDIUM   | The bench cannot separate the arms at its current power, and three asymmetries survive the parity contract.                                                             |
| M3    | MEDIUM   | Retrieved content enters context outside the only token budget the system has.                                                                                          |
| M4    | MEDIUM   | Phases 25 and 26 specify Python standard library for handlers that must be dual-runtime TypeScript.                                                                     |
| M5    | MEDIUM   | Phase 20 partly duplicates an existing measured contract, and its "expected surface" list is already contradicted by that contract.                                     |
| M6    | MEDIUM   | Machine findings have no ingestion channel; the review pipeline builds findings exclusively from lens replies.                                                          |
| M7    | MEDIUM   | `verify.scopes.buildCommand` is documented and implemented but rejected by its own schema — the cheapest route to enforced diagnostics is three lines, not a subsystem. |
| L1–L3 | LOW      | `DECISIONS.md` is lettered not numbered; the `HONEST-LIMITS` numbered section is verbatim-pinned; a tenth doctrine pack is a five-site edit, not a file drop.           |

---

# Part I — What the plan proposes, and the reasoning behind each choice

This part is reconstruction, not criticism. Every argument below is the plan's own, stated as
strongly as it can honestly be stated, because a plan is only worth attacking once it has been
understood at its best. Criticism starts in Part II.

## I.0 The chain of reasoning the plan is running

The document is one argument in six steps, and every phase hangs off it:

1. **Goal.** A credible head-to-head benchmark: vanilla opencode versus conductor, same weights,
   same server, same prompts, same machine.
2. **Observation.** If the two arms differ in anything other than governance, the comparison is
   worthless. This is the same logic `DECISIONS.md` (d) already used to reject role-tiered model
   routing — "it confounds the POC's quality delta with model size — the POC exists to measure
   what process alone buys". The plan applies that argument to capability instead of to weights.
3. **Diagnosis.** Conductor's arm lacks documentation, diagnostics and web access; the vanilla arm
   has them. The comparison therefore measures *process minus capability*, not process.
4. **Prescription.** Add the missing capability — but only through the choke points that already
   exist, in the grain the system already has.
5. **Guard.** Enumerate seven invariants (I1–I7) so the addition cannot erode what the harness
   already proves, and enumerate permanent non-goals (§13) so the document can never be cited to
   justify them later.
6. **Sequencing.** Measure the client first (20), make legality expressible (21), then build the
   lanes in increasing order of risk (22 diagnostics → 23 mechanical fixes → 24 review integration
   → 25 offline docs → 26 network), and benchmark last (27).

Steps 4, 5 and 6 are the parts worth learning from. Steps 2 and 3 are where the document breaks,
and Part II starts there.

## I.1 The three-part design thesis, and why each part is the right instinct

**Thesis 1 — typed `conductor_*` tools whose handlers own execution.** The model never composes a
command line. The handler runs the linter, searches the corpus, performs the fetch, and returns a
structured result the handler itself derived.

This is the strongest idea in the document. It extends **G6 — handler-derived evidence** from
verdicts to insight. The README states the principle plainly: *"every one of those handlers
re-derives its own evidence: it runs the test command, reads the git state, and computes the
verdict, so the model's claim is never the record"* (README.md:57-60). If the model writes
`eslint --format json src/` itself and reports what it saw, the finding is the model's claim
again — which is precisely the failure mode the whole system exists to eliminate. The plan sees
this and says so.

There is a second, larger benefit the plan never claims and probably did not notice. `classifyTool`
maps any `conductor_`-prefixed name to class `"conductor"` (conductor/adapter/tools.ts:214), and
`gateBeforeToolCall` computes its fail-closed `guarded` flag from that class
(tools.ts:441-446): `conductor`, `write` and `spawn` fail closed on a gate crash; `read` fails
open. So a typed `conductor_fetch` inherits **fail-closed posture for free**, while an enabled
built-in `webfetch` would remain fail-open. D3 is more correct than its own argument.

**Thesis 2 — legality decided by the existing gate, with "no rule ⇒ refused".** The growth
property is real and is the best thing about `core/tool-legality.ts`. Its header states it: *"a
name with no row is REFUSED rather than run (the growth property: a tool cannot be born guarded by
nothing)"* (tool-legality.ts:9-12), and `conductor/tests/tool-legality.test.ts:366-370` pins the
table's keys to `CONDUCTOR_TOOL_NAMES` by `deepEqual`, in both directions. Reusing that property
for new capability is exactly right — for `conductor_*` names. Part II, H1 shows what happens when
the same sentence is applied to built-ins.

**Thesis 3 — maturation: observe → report → enforce.** No new signal becomes a gate criterion
until run-report evidence says it should. The precedent named is real: the router's schema guard
*records* rather than rejects — HONEST-LIMITS limit 9, *"The router observes; it never enforces.
Its schema check is a recorded observation, not a rejection (§4.4)"*. Applying that to diagnostics
(D4) is the correct conservative call: a linter whose findings do not correlate with defects
should not be able to block a publish before anyone has measured whether they do.

## I.2 The invariants, and what each one is defending

| Invariant                                         | What it defends                                                                        | Where the concern comes from                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 — reviewers and planners write nothing         | The anchored-review failure mode. A reviewer with authorship stake agrees with itself. | `core/gates-edit.ts:110` `READER_ROLES = ["reviewer","skeptic","planner","mechanical"]`; `opencode-fragment.json` sets `"edit": "deny"` on four sub-agents. |
| I2 — the verify freeze is absolute                | A verify judging a tree that moved underneath it.                                      | `core/gates-edit.ts:207-215`, the freeze deny inside `decideEdit`.                                                                                          |
| I3 — freshness stamps cannot be voided by reads   | A green produced against a tree state no verify described.                             | `core/freshness.ts:51-108`, mtime + HEAD arithmetic.                                                                                                        |
| I4 — the model's claim is never the record        | G6. The entire enforcement premise.                                                    | README.md:166-190, the "what is actually enforced" table.                                                                                                   |
| I5 — `patch`/`apply_patch` refused, `task` denied | Un-boundable writes and unregistered child sessions.                                   | `tools.ts:211, 448-460`; `gates-edit.ts:57-63`.                                                                                                             |
| I6 — same weights for every role                  | The POC's attributability.                                                             | `DECISIONS.md` (d).                                                                                                                                         |
| I7 — llama-router untouched                       | The fail-soft/fail-closed layer split.                                                 | `DECISIONS.md` (b).                                                                                                                                         |

Three of these (I5, I6, I7) hold exactly as written. Two (I2, I3) do not — see H2 and H3. I1 holds
in the code but the plan itself creates a path around it — see H5.

## I.3 The side-effect taxonomy, and the argument that separates R3 from X

The taxonomy (§1) sorts every tool into R0 (pure repo-local read), R1 (derived repo-local read —
linters), R2 (machine-local read outside the repo — docsets, man pages), R3 (network read), W
(write), X (structurally unboundable — `patch`), S (session-spawning — `task`).

The interesting move is the argument at line 47 that R3 is *gateable in principle* where `patch` is
not: a `webfetch`-shaped call names its target in a parseable argument, whereas a patch body names
its targets in a form no gate parses. That is the correct reading of the committed patch rationale
(tools.ts:448-455) and it is the right way to decide whether a class is *bound-able* at all. R3
then defaults off for posture reasons — egress and determinism — not structural ones.

This is a genuinely useful piece of thinking, and the taxonomy is the plan's most portable
contribution. Part II's H4 shows where its coverage is incomplete (`bash` has no home in it), but
the frame is sound.

## I.4 D2 — why reviewer-applied fixes are rejected

This is the best-argued paragraph in the document and it should not be reopened. The plan gives
four independent reasons a reviewer must not apply the fixes it finds:

- **(a) authorship stake.** A reviewer that edits re-opens the anchored-review failure mode it was
  created to avoid.
- **(b) no scope discipline.** Review findings are not scoped edits; an item's `fileScope` is the
  unit the whole write-gate stack adjudicates against.
- **(c) freeze and freshness.** A reviewer-timed edit can fire inside or across a verify window.
- **(d) unvetted diffs.** A model-authored change that never faced RED is the exact class the item
  FSM exists to prevent.

Every clause checks out against the code (`gates-edit.ts:110, 207-215, 270-284`;
`freshness.ts:51-55`). The two-lane split that follows — behavioral fixes ride the existing
receive-review → implementer → TDD loop with **zero new code**, and only deterministic,
idempotent, semantics-preserving transforms get a separate lane — is the right decomposition of the
problem. Lane 1 is free and correct. Lane 2 is where C3 lives.

## I.5 The rest of the argument, briefly

- **Enumerated allow, everywhere.** Registry entries, domain allowlists, transform ids, phase rows
  — all enumerated rather than pattern-matched. This mirrors the git gate's default-deny posture
  and the plan is consistent about it.
- **Fix flags structurally excluded (22.1).** The args template is repository code, never model
  input, and a registry-shape test rejects templates containing `--fix`/`--write`. Making the
  exclusion a *test* rather than a *convention* is the correct instinct and is the pattern the
  repository already uses everywhere else.
- **Baseline-and-delta (22.3).** Legacy noise would make raw findings useless in a real repository,
  so all reporting is delta against a run-start snapshot. Correct and necessary.
- **Record/replay (26.2).** Cache-only replay makes retrieval time-invariant so a benchmark cell is
  repeatable.
- **Doc honesty coupled to the flip (26.4).** Any default flip amends README and HONEST-LIMITS in
  the same change. This is the repository's standing honesty culture applied to a new surface, and
  it is the right reflex.
- **§13 permanent non-goals.** Naming what the document may never be cited for is a discipline most
  plans skip. Keep it.

## I.6 What the plan's method actually was, and why it matters

Read the citations as a set and a pattern appears. The plan cites `legalTools` for a table that
lives in `tool-legality.ts`; `RUNNER-DISCOVERY.md` for a mechanism that lives in `evidence.ts`;
`provenance.ts` for a concept that module does not hold; `disposition.ts` and `review-witness.ts`
for a refuter path that lives in `verdict.ts`. Every one of those names is a name that *sounds*
right — and every one of them appears in the README, the developer docs, or a file listing.

The plan was written from this system's documentation, which is unusually good, rather than from
this system's code. That is why its architecture is sound and its facts are not. It also explains
the founding premise: the README's enforcement table is an accurate description of what conductor
*gates*, and someone reading only that table would reasonably conclude that a governed session is
a narrow one. The table does not say what conductor *allows*, because allowing is not what the
table is about.

---

# Part II — Findings

# CRITICAL

## C1 — The capability-starvation premise is contradicted by the code

**The claim.** Plan line 11: *"Today conductor's sessions are capability-starved relative to a
vanilla opencode session: a vanilla run can consult docs, diagnostics and the web while a conductor
run cannot."*

**What the code does.** Four independent layers decline to impose that restriction.

1. **`classifyTool` ends in a catch-all `return "read"`.** conductor/adapter/tools.ts:213-226:
   `task` → `spawn`; `conductor_*` → `conductor`; `edit`/`write`/`patch`/`apply_patch` → `write`;
   `bash` → `write` only if `writeShapedPaths(text)` is non-empty or the program text names
   `.conductor`; **everything else → `"read"`**. `webfetch` is "everything else".
2. **The session gate allows every read.** conductor/core/gates-edit.ts:67-75. A registered session
   "passes the registry gate for any non-spawn call"; even an *unregistered* one is allowed if the
   class is read, under the comment *"A stray reader is harmless and not worth a confusing
   failure."*
3. **Nothing downstream touches it.** `gateBeforeToolCall` (tools.ts:425-500) runs the patch
   refusal, the session gate, then the git gate and the edit-scope gate — the last two only for
   `bash` and for write-shaped targets. A non-bash read-class tool reaches its handler unexamined.
4. **The pinned client offers it.** conductor/adapter/wire-notes.md, final verified point:
   *"built-in tool names offered to the model at 1.18.15: `bash, edit, glob, grep, read, skill,
   task, todowrite, webfetch, write`"*. `conductor/opencode-fragment.json` denies exactly one of
   them — `task` — for every agent, and sets `"bash": {"*": "allow"}` for the orchestrator with
   only `git commit`/`git push` denied.

**The one honest hedge.** Two fences were checked and neither closes this, but one is unmeasured:

- conductor's **ask-gate** default-denies every permission kind other than `edit` and `question`
  (conductor/adapter/continuation.ts:1405-1424, *"A permission vocabulary that grows upstream must
  not silently widen what the orchestrator may do"* → `sendReply(input, "reject", …)`). That fence
  only fires **if opencode raises a permission ask**.
- Whether opencode 1.18.15 raises a permission ask for `webfetch`, or for `bash` in a sub-agent
  with no `bash` permission row, **is not determinable from this repository**. The vendored SDK
  types make every permission key optional.

So the precise statement is: **conductor's tool-call gate allows web fetch and every read-shaped
bash command; whether opencode's own permission layer intervenes for sub-agents is unmeasured; and
for the orchestrator — the agent the benchmark actually selects (`ARM_AGENTS`,
scripts/conductor_bench.py:73) — the fragment grants `bash: {"*": "allow"}` explicitly, so no ask
is raised and the lane is definitely open.**

**Therefore.** `curl https://…`, `man 3 printf`, `npx tsc --noEmit`, `ruff check`, `eslint .` — and,
uncomfortably, `eslint --fix`, `prettier --write` and `clang-format -i`, none of which match any
write shape the extractor enumerates (HONEST-LIMITS "Edit detection matches an enumerated set of
write shapes") — all pass conductor's gates today.

**Why this is CRITICAL rather than a correction.** The premise is not decoration; it is the
document's entire justification, its phase ordering, and its sizing. With the premise corrected,
the plan's real contribution changes shape:

> Conductor sessions are not capability-starved. They are **capability-ungoverned**. The
> capabilities exist, are reachable by every role at every phase, are composed by the model rather
> than by a handler, produce no journal record, are invisible to the freeze, and fail **open** on a
> gate crash.

That is a *better* justification than the one the plan gives, and it survives every objection in
this review. It is also a different project: the work is to bring an existing surface under
governance, not to add a missing one. Two consequences follow immediately —

- **Phase 21 is a tightening, not a loosening** (H1), which inverts its risk profile and its
  acceptance tests.
- **Phase 26 is the highest-value lane, not the lowest** (H4), because it is the only one that
  closes a live egress path — and its "optional" proxy is the only part of it that actually closes
  anything.

**One asymmetry that IS real — and the plan refuses to close it.** `task` sub-agent spawning is
denied in every conductor session, registered or not (gates-edit.ts:57-63), and is offered to a
vanilla session (wire-notes.md:37). That is the only confirmed, deliberate capability gap between
the arms — and §13 declares it permanently out of scope. Whatever else Phases 20–27 achieve, the
arms remain asymmetric on the one axis that is actually established. That is a defensible choice
(the spawn deny is load-bearing: *"a child session conductor never registered would perform exactly
the writes this session is scoped out of"*), but the plan should say so where it discusses parity
rather than only in its non-goals.

**Remedy.** Rewrite §0 from the governance premise. Restate the objective as *"bring the read and
network surface a conductor session already reaches under typed, journaled, handler-executed,
fail-closed control, and give the benchmark a declared capability dimension"*. Then re-derive D1
and the phase order from that sentence, because both change.

---

## C2 — The vanilla arm already exists, and the measurement justifying six phases has never been run

**The claim.** Plan 27.1: *"`scripts/conductor_bench.py` gains a `vanilla-opencode` runner"*, sized
(M), scheduled last.

**What the code does.** scripts/conductor_bench.py:69 — `ARMS = ("baseline", "doctrine",
"conductor")`. `build_arm_config` (:513-545) merges the conductor fragment **only** for the
`conductor` arm; the `baseline` arm receives no plugin, no fragment, no agent prompt — plain
opencode with the same provider, base URL and model, built through the same code path. The
docstring states the design intent verbatim: *"The arms differ in exactly one thing: what process
the model is running inside … so the experiment keeps its control."* `build_opencode_argv`
(:571-597) differs across arms only in `--agent`.

The three-arm driver, the hidden acceptance tests, the objective scorer, the cell hermeticity and
the manifest are all built. What 27.1 actually adds is the **capability dimension** and the
symmetry rule — real work, but a fraction of what the task implies.

**The sequencing problem.** `docs/build/STATE.json` holds 55 tasks; exactly two are NOT_STARTED,
and they are **13.2** (the attended live smoke) and **14.2** (the 90-run POC campaign).
`docs/build/HANDOFF.md` is explicit that both are live measurements the owner is holding back
deliberately, and that authoring either would be fabrication.

So: the plan corrects a confound in a measurement **that has never been taken**, using an
instrument that **has never produced a datum**, and orders the correction *before* the measurement
that would size the problem. Phases 20 → 26 are six phases of capability built on a predicted
confound.

**The steelman, stated fairly.** There is a real argument on the other side and it deserves to be
written down: a 90-cell campaign is expensive, and discovering the confound *after* spending it
means spending it twice. Fixing a known confound before the expensive measurement is ordinary
experimental hygiene.

**Why the steelman does not carry.** It would carry if the confound were established. It is not —
C1 shows the asymmetry claimed does not exist at the gate layer, and the residual (whether opencode
asks permission for `webfetch` in a sub-agent) is one measurement away. The cheap ordering is
available and the plan does not take it:

> The `baseline` arm is plain opencode **today**. Run the existing three-arm bench and read the
> per-cell tool-call records. If the baseline arm's transcripts show `webfetch`/`bash`-linter use
> that the conductor arm's do not, the confound is real and measured. If they do not, six phases
> were about to be built to close a gap that is not there.

**The plan's own phase gate cannot pass.** §12 requires that *"`conductor-gate.sh` and
`verify-acceptance.sh` must be green at every phase boundary"*. `scripts/verify-acceptance.sh` row
8 requires `docs/build/artifacts/conductor-report.md` and fails explicitly when it is absent — that
file is 14.2's output and does not exist, and hollowness detector E requires the same set. So the
plan mandates a boundary gate that is **unsatisfiable until 14.2 runs**. The document's own
sequencing rule therefore agrees with this finding: the campaign has to come first.

**Remedy.** Move a measurement to the front. Concretely: run 13.2 (live smoke) and a reduced 14.2
pilot on the existing three arms with tool-call transcripts retained, and gate Phases 22–26 on what
that shows. Keep Phase 20 in front of it — it is what makes the transcripts interpretable.

---

## C3 — `conductor_mechanize` re-implements a shipped mechanism, less safely

**The claim.** Phase 23 builds a new model-callable write lane for deterministic, idempotent,
semantics-preserving transforms: a transform registry (23.1), a handler that runs the fixer over
the item's `fileScope`, captures the diff, checks idempotency by running it twice, aborts and
restores byte-identically otherwise, and voids the freshness stamp to force a re-verify (23.2).

**What the code already does.** `conductor_publish` runs the operator-configured formatter over the
item's staged scope today:

- `Config.format = { rules: Array<{pattern, mode: "stdin"|"check", command}> }`
  (conductor/core/types.ts:143, 227), documented as *"Applied to an item's staged files at publish,
  before the final freshness check"* (docs/user/configuration.md).
- The publish handler resolves the first matching rule per staged file (`formatRuleFor`,
  tools.ts:7864-7869; applied at :8143), spawns it with an argv array and `shell:false`
  (:8148-8153), and in `stdin` mode **writes the formatted bytes back**:
  `if (formatted !== before) writeFileSync(abs, formatted);` (:8188).
- A formatter that could not run, exited non-zero, or produced empty output for non-empty input is
  a **publish denial**, with the reasoning spelled out in the source: *"a crashed formatter's
  stdout is not a formatting verdict"* (:8168-8186).
- It then stages, re-checks freshness, and pays **at most one** bounded auto re-verify
  (:8192-8272).

That is the plan's Phase 23 — registry-driven, handler-owned, fail-closed on tool failure,
freshness-aware, re-verify-bounded — already built and already tested.

**Correction, applied.** `DEFAULT_CONFIG` ships `format: { rules: [] }`
(conductor/adapter/config-io.ts:99), so the lane is **operator opt-in and empty by default**. The
mechanism exists; the behaviour does not fire unless configured. This weakens "conductor already
formats your tree" and does not weaken "Phase 23 is a second implementation".

**Why the incumbent is strictly better on the repository's own ladder-5 criteria.** From
`DECISIONS.md:9-11`: capability superset, earlier/more-mechanical validation, testability,
single-source-of-truth, fewer moving parts for equal capability — *"a strictly better option wins
automatically; effort is never a tiebreaker."*

| Property                   | `format.rules` at publish (incumbent)                                      | 23.1/23.2 `conductor_mechanize`                                                          |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Who writes the file        | the **handler**, exactly once, to a path it chose                          | the **fixer process**, in place, to paths it chooses                                     |
| Blast radius               | zero — the tool gets stdin and emits stdout, never touching the filesystem | a subprocess with `cwd = treeRoot` may write anything: siblings, config, dot-directories |
| Write when output == input | none — no write, no mtime move, **no re-verify**                           | unconditional freshness void by design                                                   |
| Failure posture            | crashed/non-zero/empty ⇒ publish denial                                    | abort + restore, with no substrate (below)                                               |
| Model involvement          | none — the model does not choose the moment or the tool                    | the model picks the moment and the `transformId`                                         |

The incumbent's containment property is the important one: **the fixer never touches the
filesystem**. Handing the write back to the fixer, as 23.1's args-template registry does, gives up
the one structural guarantee the existing design bought.

**The two safety devices do not work.**

- **Idempotency-by-double-run tests the wrong property.** `f(f(x)) == f(x)` is fixpoint, not
  semantics preservation. The plan's own admissible example is the counterexample: `ruff check
  --select F401 --fix-only` (unused-import removal) is perfectly idempotent and silently
  destructive on a registration-side-effect import. It is also not a determinism proof — a fixer
  whose output depends on file order, on a cache it writes on the first run, or on locale passes
  this check and still varies across runs.
- **"Aborts and restores byte-identically" has no substrate.** `conductor/adapter/gitio.ts:1`
  declares itself *"read-only git queries"* and its export surface is queries. There is no
  snapshot/restore path in the adapter, and `git stash`/`git checkout` are exactly what the git
  gate's default-deny is there to prevent. The acceptance row at plan line 124 also tests the
  wrong case: it tests abort on a non-idempotent fixer, not abort on a **crash between the two
  runs**, which is the state that leaves the tree half-transformed with no record.

**Additional hazards the plan does not address** (each from a separate ground-truth pass):

- **TOCTOU with the verify marker.** `liveVerifyTrees` is a read (adapter/evidence.ts:842) and
  `runVerify` writes its marker after its own check (:972-990). A mechanize that checks markers,
  then spends seconds running a fixer, can have a verify start underneath it.
- **Worktree silent revert.** Under `parallel.writes: "worktrees"`, running the fixer against the
  main tree — the naive reading of "the item's `fileScope`" — formats content the item never
  touched while the item's real work sits on its own tree; `mergeBack` (adapter/worktrees.ts:253)
  then has to reconcile two edits nobody recorded.
- **No `run.startDirty` carve-out.** Publish has one and converts a collision into a surfaced
  question (tools.ts:8075-8125). A sweep over raw `fileScope` would reformat the operator's
  uncommitted work with no question and no record.

**What survives.** D2's *rejection* half is correct and should be treated as settled. Lane 1
(behavioral fixes ride the existing receive-review → implementer → TDD loop) is correct and costs
nothing. The pre-review formatting *goal* — reviewer attention on substance, not style — is
legitimate.

**Remedy.** Do not build Phase 23 as specified. The goal is reachable with the incumbent:

1. Configure `format.rules` in the target repos (this is what the block is for, and it is empty
   only because nobody has filled it in).
2. If pre-review formatting is wanted, add a **second invocation point for the existing
   `format.rules` path** at post-GREEN, reusing `formatRuleFor` and the stdin contract verbatim.
   That is a handful of lines, no new tool, no new legality row, no new journal event, no
   idempotency checker, and no new model-visible surface.
3. Treat rule-id-scoped autofixers as a separate, later question, gated on diagnostics evidence —
   which is what the plan's own thesis 3 requires and Phase 23 abandons.

---

# HIGH

## H1 — Phase 21 revokes capability, names the wrong module, and needs a rule the vocabulary cannot express

Three separate defects sit in one phase.

**(a) It is a tightening, not a grant.** §1 says *"an unclassified tool is refused by default, which
is the current behavior restated"* (line 35). That is true of `conductor_*` names and false of
built-ins — C1 shows the built-in default is silent allow. An enumerated-allow table over built-ins
therefore **inverts** today's posture: `read`, `grep`, `glob`, `todowrite`, `skill` and read-shaped
`bash` all become default-deny and must each be re-granted per (tool × role × phase) or conductor
sessions lose the ability to read files. That is a defensible design — it is arguably the right
one — but it is the opposite of what the plan says it is doing, and its acceptance tests, its risk
profile and its rollback story all change accordingly.

There is a second-order consequence: `undeclaredToolWhy` (tool-legality.ts:230-239) is written for
*a conductor tool whose author forgot to declare a row*. Pointed at an upstream built-in that
appeared after an opencode bump, that message tells an operator to go declare a row in conductor's
source for a tool conductor does not own.

**(b) It names the wrong module, and the module it names has six call sites.** 21.2 says
*"`tool-legality.ts` extension (M). `legalTools` derivation gains per-phase, per-role read-tool
rows."* Those are two different modules:

- `core/gates-phase.ts` `legalTools` is a pure derivation over run FSM position, item positions,
  open questions and repo-configured state. It emits **18** hardcoded `conductor_*` constants
  (gates-phase.ts:29-46) — not the 22-name inventory — and has **no role parameter and no role
  concept**.
- `core/tool-legality.ts` `TOOL_LEGALITY` is the row table, keyed on caller **kind**
  (`orchestrator` | `sub-session`), not role, and it covers `conductor_*` names only.

`legalTools` has **six** production call sites (core/mechanics.ts:87, adapter/inject.ts:124,
adapter/continuation.ts:673, adapter/tools.ts:3163, :3292, :5979) — the README's "three consumers"
is itself a simplification. Two of those sites structurally cannot supply a role, and
`mechanics.ts` regenerates doctrine text from the derivation, so a signature change there
propagates into nine committed doctrine packs that `doctrine-mechanics.test.ts` asserts byte-equal.

The `callers` collapse to two kinds is also deliberate and documented: *"Roles multiply
(implementer, testWriter, reviewer, skeptic, planner, mechanical, critic, …) but the legality
question only ever splits one way"* (tool-legality.ts:35-38). 21.3's own matrix does not actually
need per-role rows — it needs per-*window* rows (planning, implement, verify), which the existing
phase vocabulary can nearly express. Adding a role dimension buys nothing the matrix uses and
costs the simplification the module was built around.

**(c) "post-GREEN inside the implement window" is not expressible.** `PHASE_RULES` is a closed
five-set — `["always","verdict","non-terminal","once-at-intake","stage"]` (tool-legality.ts:90-97)
— introduced with the warning *"Kept small deliberately: a rule per tool is a second implementation
of the FSM, and a free-form predicate per row is a place for the next escape to hide."* 23.2's
phase condition needs a sixth rule, and 21.3's verify-freeze condition needs the phase gate to read
a **filesystem marker**, which `legalTools` cannot do (it is pure by construction, G3). The freeze
input does exist at the choke point — `plugin/index.ts:1709` computes `freezeTreeFor(...)` and
:1726 passes `verifyInFlightTree` into `gateBeforeToolCall` — so the check is implementable, but in
the **adapter's** legality step, not in the pure phase gate the plan names.

One further pin the plan would trip: `tool-legality.test.ts` pins the set of `stage`-rule rows to an
exact list of ten named tools by `deepEqual`, so a new tool declaring `phase: "stage"` goes red
unless that literal list is edited too.

**Remedy.** Split 21.2 into (i) `TOOL_LEGALITY` rows for the new `conductor_*` tools — cheap,
in-grain, keeps the growth property; and (ii) a **separate, explicitly-scoped** built-in
classification check inside `gateBeforeToolCall`, which is the only path a built-in call takes.
State plainly that (ii) is a fail-closed inversion of a currently fail-open path, and give it its
own rollback flag. Drop the role dimension; use windows. Put the freeze check in the adapter.

---

## H2 — I2 is a new restriction, not a preserved invariant

Plan line 21: *"The verify freeze is absolute. No R-class or mechanize action is legal while a
verify marker is live."* Line 90 says this is *"enforced in the phase gate, not by convention"*.

The freeze that exists is a **write-path** rule. It lives inside `decideEdit`
(core/gates-edit.ts:207-215) and denies *"every edit here — source, test, or config"*. A read-class
call never reaches `decideEdit` at all.

More than that, the system **deliberately admits readers into frozen trees**. The fan-out engine's
job type documents it: *"`writeCapable` is the freeze-admission discriminator: a write-capable job
may not enter a frozen tree; **a reader always may**"* (adapter/fanout.ts:59-60), and `pump()`
holds only write-capable jobs (:414).

So I2 is not inherited; it is a policy change, and it contradicts an existing, reasoned design
choice. That does not make it wrong — but it must be argued, not asserted, and the argument
differs by class:

- **R1 should be refused during a freeze**, and for a reason the plan does not give: a linter
  subprocess is not filesystem-pure (H3). Running one against a frozen tree is the very hazard the
  freeze exists to prevent.
- **R0/R2/R3 have no such argument.** They touch neither the tree nor HEAD, and refusing them
  contradicts the reader-admission design for no benefit.

**Remedy.** Replace I2 with a per-class rule: *"no tool that executes a subprocess with the target
tree as its working directory is legal while a verify marker is live for that tree."* That is
narrower, defensible, derived from the actual hazard, and it covers `conductor_mechanize` and
`conductor_diag` without breaking reader admission.

---

## H3 — I3 holds only under a constraint the plan omits

Plan line 22: *"Freshness stamps are tree+`HEAD`-based; no R-class tool may void one, **by
construction** (they touch neither)."*

The arithmetic half is right and was confirmed: `verifyFreshFor` reads only staged behavioral file
mtimes, the index mtime on deletions, and the HEAD term (core/freshness.ts:51-108). A tool that
writes nothing into the tree cannot move any of those.

**But the R1 runners the plan names write into the tree by default.** `ruff check` creates
`.ruff_cache/`; `tsc` writes `.tsbuildinfo` under `--incremental`/`composite`; `mypy` writes
`.mypy_cache/`; `clang-tidy` can emit fix YAML. 22.1's only structural exclusion is fix flags.
The consequences, each traced to a code path:

- A cache directory landing **inside an item's `fileScope`** and not gitignored is **staged and
  committed as the item's work**, under the item's commit message — nothing in the staging path
  consults `.gitignore` (tools.ts:8139) and the item's own pathspec is what the commit carries
  (:8326).
- If it *is* gitignored, `git add` fails and the publish is denied — with a message that names a
  file no human created.
- A cache left from an earlier run becomes `run.startDirty` (adapter/state.ts:894-899) and, under
  the default `preexistingDirty: "refuse"`, blocks the item with a human-territory question naming
  files nobody touched.
- None of this is visible to any gate. A handler-run diagnostic never passes through
  `gateBeforeToolCall`, and a model-run one via `bash` produces no write-shaped target, so
  `decideEdit` is never invoked.

**Correction, applied.** One ground-truth pass called the `bash eslint --fix` case a silent
freshness void. A skeptic corrected the direction and the correction is right: a bumped mtime makes
a record **stale**, forcing re-verification. That is the conservative direction. The finding stands
as a *cost and correctness* problem, not a *soundness* one.

**Remedy.** Two additions to 22.1, both cheap and both in the plan's own idiom:

1. The registry entry must carry cache/output suppression in its args template (`--cache-dir`
   redirected under the state home, `--no-incremental`, `TMPDIR` overrides), and a registry-shape
   test must assert it — exactly parallel to the fix-flag exclusion the plan already specifies.
2. Add a **footprint check**: the handler snapshots the tree's untracked set before and after the
   run and journals any delta. This is detection where prevention is not available, which is G7,
   and it converts an invisible failure into a recorded one.

Then I3 can be stated truthfully: *"no R-class tool may void a freshness stamp, because the
registry forbids runners from writing into the tree and the handler verifies it."*

---

## H4 — "R3 off by default" is not an off

D1 makes R3 off by default and 26.4 defers the README/HONEST-LIMITS amendment until R3 is enabled.
Both treat network access as something Phase 26 would *introduce*.

It is already there, through a lane the taxonomy has no row for. `bash` is class-polymorphic: `ls`
is R0, `eslint` is R1, `man` is R2, `curl` is R3, `sed -i` is W. §1 assigns `bash` a single row —
"write-shaped bash" under W — and leaves read-shaped bash unclassified, which is the same catch-all
that produced C1. Meanwhile the write-shape extractor's vocabulary is redirects, `tee`, `sed -i`,
`perl -i`, `gawk -i`, `ex`/`ed`, `dd of=`, `mv`/`cp`/`rm` — no `curl`, no `wget`, no `nc`
(HONEST-LIMITS, "Edit detection matches an enumerated set of write shapes").

**Consequences that follow directly:**

- Turning `retrieval.enabled` off closes the lane the *compliant* model uses and leaves the lane a
  confused or injected one would use. A flag that only binds cooperative behaviour is not a
  posture.
- **26.3's egress proxy is therefore not optional — it is the only load-bearing control in the
  phase.** The plan marks it "(M, optional but recommended)". That grading is exactly inverted.
- Even the proxy is not sufficient on its own: `curl --noproxy '*'` ignores `HTTP(S)_PROXY`. Real
  containment on macOS needs either a deny of network binaries in the shell-parse gate or an OS
  sandbox — and the honest answer may be that only detection is available, which is fine as long as
  it is *written down* rather than assumed away.
- README.md:24 — *"opencode talks to that endpoint and nothing else"* — is **already** inaccurate
  at HEAD for the orchestrator, independent of anything this plan does. (README.md:25's *"No cloud
  provider is involved and no API key is required"* stays true and is a narrower claim than D5
  assumes; the clause that breaks is the one nobody flagged.)

**Remedy.** Reclassify: give `bash` a row that says it is class-polymorphic and adjudicated by
command, and add a network-shape extractor beside the existing write-shape extractor. Promote
26.3 to required and to the front of Phase 26. Amend README.md:24 **now**, as a correction of a
present inaccuracy, not later as a consequence of a flag flip.

---

## H5 — The injection chain terminates at `conductor_override`, and the envelope has no seam

The plan concedes the provenance envelope is advisory and routes injection resistance to G7
detection. That concession is honest. Two things it does not trace:

**(a) Where the chain actually ends.** Of the 22 rows in `TOOL_LEGALITY`, exactly three carry
`callers: EITHER` — `conductor_surface`, `conductor_override`, `conductor_status`
(tool-legality.ts:174-176, 204-206, 209-211). A prompt-injected sub-session cannot advance the FSM,
cannot forge a verdict, cannot publish, and cannot spawn. The gate stack genuinely holds against
almost everything, and that is worth stating plainly.

It can, however, spend a `conductor_override`, and that chain was traced end to end and verified:

1. `TOOL_LEGALITY.conductor_override` carries `callers: EITHER` — sub-session callable
   (tool-legality.ts:204-206).
2. `handleOverride` (tools.ts:9393+) checks **gate-name validity, item existence, and budget**.
   There is no role predicate anywhere in it.
3. `consumeOverrideGrant` (tools.ts:400-407) keys a grant on `(sessionID, gate, itemId)` — a
   dispatched reviewer has all three — and has no role predicate either. It is consulted at both
   edit-deny points (tools.ts:539, :555).

So a reviewer sub-session can mint an `edit` grant and spend it on the very write the edit gate
denies it. **I1 as the plan states it — "Reviewers and planners write nothing … no write path of
any kind" — is not true at HEAD.**

This is not a defect the plan introduced; `DECISIONS.md` (c) designed the hatch to be universal,
budgeted (1 per item, 2 per run), permanently tainting and loudly reported, and argued that case
well. The correct statement of I1 is *"reviewers and planners write nothing except through one
budgeted, tainted, journaled hatch"*. What the plan **does** change is who is holding that hatch
while reading attacker-influenced text: R2/R3 content lands in the context of exactly the sessions
that can spend it, and the plan leaves the `EITHER` row untouched.

**(b) There is no wrapping seam.** §11 puts "mechanical wrapping" in `adapter/inject.ts`. That
module is the `experimental.chat.system.transform` composer and nothing else — `buildSystemAppend`,
`paramsForRole`, `headersFor`, `composeDelivery`. Tool *results* do not pass through it. There is
no tool-result envelope point anywhere in the adapter; it would have to be built inside each
handler's return path.

**(c) Detection has a timing problem.** The journal is read by a human *after* the run. A run that
publishes and pushes has already acted. G7's posture is correct as a philosophy and is stated
correctly in HONEST-LIMITS; it is weaker here than elsewhere because the other detections
(overrides, taints, denials) are about the *model's* behaviour, while this one is about a *third
party's* content reaching a model that then behaves normally.

**Remedy.** (i) Make R2/R3 content and `conductor_override` mutually exclusive within a session:
once retrieved external content has entered a session's context, that session's override row
becomes orchestrator-only. This is a one-row change and it closes the only live chain. (ii) Put the
envelope where results are produced and say so. (iii) Add a HONEST-LIMITS entry that states the
timing gap explicitly.

---

## H6 — `conductor_docs` assumes the model can detect its own ignorance

§0 names the failure mode the diagnostics lane targets: *"hallucinated API surfaces discovered only
at RED time"* on a ~27B model. Phase 25 then offers `conductor_docs(query, source?)` — retrieval on
demand.

A model that hallucinates an API believes it knows the API. On-demand retrieval fires only when the
model decides it does not know something, so the population of calls it will actually make excludes
the population of errors the lane exists to prevent. The tool helps a model that is *aware* it is
uncertain; the documented failure mode is a model that is *not*.

This is the sharpest design objection in the review and it does not depend on any code fact.

**Remedy.** Make the docs lane **push**, not pull, at least to start: at dispatch time the handler
resolves the item's `fileScope` and declared dependencies to a small set of reference sections and
injects them into the brief. That needs no model-callable tool, no legality row, no verify-freeze
question, and no query-formulation ability from a 27B. Keep the query tool as a later addition if
the pushed form proves insufficient. (The same argument applies to `conductor_diag` and is why the
diagnostics-as-injection rival in Part IV scores well.)

---

## H7 — Four wrong module citations and three vocabulary collisions

An implementing agent following the plan literally opens the wrong files four times.

| Plan says                                                                                           | Reality                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21.2 — *"`tool-legality.ts` extension. `legalTools` derivation…"*                                   | Two modules; `legalTools` is `gates-phase.ts` and has no role dimension (H1).                                                                                                                                                                                                                                                                                                                  |
| 22.1 — *"the RUNNER-DISCOVERY mechanism (`conductor/docs/RUNNER-DISCOVERY.md` + its adapter)"*      | That file is a 601-line Task 6.2 **probe report** about quarantine reachability. No `.ts` consumes it. The real mechanism is `setupDetect` (tools.ts), `RUNNER_PROFILES` + `detectRunner` (adapter/evidence.ts), `RunnerRules`/`classifyFailure` (core/freshness.ts:127-215), and the `verify.scopes` config block — with a written extension recipe at `docs/developer/extending.md:389-438`. |
| 23.2 / §11 — provenance `mechanical`                                                                | `core/provenance.ts` owns that word for one thing: which artifacts carry **a human's authority** (`AnswerChannel`, `isHumanProvenance`). A second unrelated `provenance` violates G10.                                                                                                                                                                                                         |
| 24.2 — *"`core/review-witness.ts` / `disposition.ts`: findings carry provenance `machine \| lens`"* | `review-witness.ts` is the **read-witness** proof (`CitedRange`, `DiffContact`, `witnessNonce`). `disposition.ts` already exports `DISPOSITIONS = ["actionable","waiting-human","stuck","settled"]` for **item/run** disposition and stop kinds. The refuter aggregation the task is actually about is `core/verdict.ts` (`verdictKind`, `findingSurvives`).                                   |

Collisions introduced: `provenance` (above); `mechanize` against the existing **`mechanical` role**,
which is one of the four `READER_ROLES` that may never write (gates-edit.ts:110); and `preset` in
27.2 against `scripts/bench_presets.py`'s existing meaning — llama.cpp sampling and runtime presets
(`author-default`, `deterministic`, `metal-throughput`, `kv-q8`, …). G10 is explicit: *"Do not
improvise names; tests hardcode them."*

There is also a factual point where the plan is behind its own repository: 22.1 promises per-finding
pinned versions and §11 leans on that for the HONEST-LIMITS entry about linters as trusted oracles —
but **no version-capture code exists**. `setupSmokeProbe` spawns `[argv0, "--version"]` and discards
the output (tools.ts:9746-9764); it answers spawnability only.

**Remedy.** Re-cite every task against the code before sign-off. This is mechanical work and it is
the single highest-leverage edit to the document: it is what separates a plan an agent can execute
from a plan an agent will get lost in.

---

# MEDIUM

## M1 — Cost accounting is absent, and the cost lands where the build already hurts

The plan sizes tasks (S/M/L) but never totals them, and never states the per-tool cost this
repository has already measured.

`docs/developer/extending.md:38-77` documents adding one `conductor_*` tool as **seven files, in
order**, with the note that *"the last three are the ones people forget"*, plus four guards that go
red if any is missed. The Phase 16–19 addendum's A5 map gives five of those seven from the other
direction. Four new tools is therefore ~28 file touches before a single test is written.

They land in `conductor/adapter/tools.ts`, which is **10,940 lines**. The build's own review record
flagged this (MACRO-010, MAJOR·HIGH), and `docs/build/HANDOFF.md` still lists *"the D2
tools.ts-split (Phase-16 planning)"* as an **open owner decision**. The plan adds four handlers to
that file without mentioning the pending split.

Surface growth, measured:

| Surface                                  | Today                         | After 20–27 | With 16–19 too |
| ---------------------------------------- | ----------------------------- | ----------- | -------------- |
| `conductor_*` inventory                  | 22                            | 26          | 28             |
| **Sub-session-callable** conductor tools | **3**                         | **6–7**     | 6–7            |
| Doctrine packs                           | 9                             | 10          | 10+            |
| Top-level config blocks                  | 8                             | 12          | 12+            |
| Journal event names                      | closed 8-component vocabulary | +4          | +4             |

The sub-session row is the one that matters. A dispatched implementer or reviewer currently sees
exactly three conductor tools (`conductor_status`, `conductor_surface`, `conductor_override`). The
plan doubles that. The repository's own doctrine-efficacy review measured the relevant constraint
and it is not context size: *"the real failure mode is attention, not truncation"*. Every
additional legal tool is a competitor for a 27B's instruction-following, and conductor's edge over
a vanilla session may be partly *constituted by* that narrowness.

Additional pins the plan would trip, none of which it mentions: `conductor/tests/atlas.test.ts`
pins the conductor tool set by `deepEqual` (each new tool needs an atlas node) and turns each
journal event into a documentation obligation; `docs/build/specs/*.assertions.json` is 60 files
that `ops-docs.test.ts` reads; roughly 14 user and developer docs describe the tool surface.

**Remedy.** Add a cost table to the plan. Take the `tools.ts` split decision before Phase 22, as
A5 already requires (*"if the split lands, it lands before Phase 17's tool additions"* — the same
logic binds here). Prefer designs that add **no** model-visible tool where a handler-side injection
or an existing config block will do (H6, C3, and Part IV).

## M2 — The bench cannot separate the arms, and three asymmetries survive the parity contract

Power, measured from the driver: `ARMS` × `EXPECTED_TASK_COUNT = 10` × 3 reps = 90 cells
(conductor_bench.py:69, 79). Separability is an overlap test on the min and max of per-rep pass
flags (:1310-1315). With binary flags at 3 reps, only a 3/3-versus-0/3 split is reported as
separable; a real 60%-versus-40% effect is reported as noise on every task. 27.x adds arms and axes
but not trials — and 4–6 arms × more tasks × 3 reps on one machine with a 21 GB model is a
multi-day run before any of it is repeated.

D6's "win/tie/loss per task" is a regression against the harness's own honesty rule: at 3 reps,
2/3-versus-1/3 would be reported as a "win", which is exactly what `within_noise` exists to flag as
unseparable.

Asymmetries that survive the parity work as specified:

- **Sampling parity is false as written and cannot be made true without changing conductor.** D6
  promises "same sampling defaults". The plugin **overrides temperature per request, per role**
  through the `chat.params` hook — `ROLE_TEMPERATURE` runs orchestrator 0.4, planner 0.7,
  testWriter 0.5, implementer 0.4, reviewer 0.3, skeptic 0.3, mechanical 0.1
  (adapter/inject.ts:53-61) — while the plugin-absent arms run at the server default (0.7, from the
  model catalog's preset ini). The arms therefore differ in sampling by construction. This is
  arguably *correct* (per-role sampling is part of the process under test) but it must be
  **declared** rather than described as parity.

- **Timeout censoring, biased against conductor.** `DEFAULT_TIMEOUT_SEC = 1800` (:66) and
  `score_cell` maps a timeout to `{"passed": False, "outcome": "timeout"}` (:901-902) — scored
  identically to a wrong answer. The conductor arm runs a multi-role pipeline (4 plan reviewers, 6
  item reviewers, 2 skeptics per finding) against the same single model server. Phases 22–26 add
  diagnostics runs, retrieval round-trips and mechanize re-verifies to that same fixed budget.
- **One-sided exclusion.** `pluginAbsent` cells are dropped (:1372-1375) with no arm-symmetric
  counterpart. If plugin absence correlates with load, the conductor arm's pass rate is biased
  upward.
- **Non-identical seed trees.** The conductor arm gets an extra `.conductor/config.json`
  materialized *before* the single seed commit, so its `startHead` and file listing differ from the
  other arms'. Small, but it is a declared-parity violation.
- **Selection on the hypothesis.** 27.4 defines the new task stratum as *"multi-file programs from
  scratch where API-surface knowledge matters (i.e., where retrieval can actually move the
  needle)"*. The existing manifest documents a deliberate `difficultySpread` — *"five one-function
  tasks and five small multi-file tasks, so a process whose cost is fixed per run is measured
  against both the work it can help and the work it cannot"*. 27.4 would replace a balanced design
  with one chosen to favour the treatment.

**Remedy.** Fix power before adding arms: raise reps, or switch the per-task readout to a
continuous score, or reduce the arm count. Report `within_noise` rather than win/tie/loss. Make
exclusions arm-symmetric. Keep `difficultySpread` and *add* the API-heavy stratum as a labelled
subset rather than replacing the balance. Separate wall-clock from quality in the scorer so
conductor's process cost is *reported*, not converted into measured quality loss.

## M3 — Retrieved content is unbudgeted

`core/planning.ts:57` sets `DEFAULT_READ_SET_TOKEN_BUDGET = 20000` and an item whose `fileScope`
measures more than that is **refused at queue acceptance** (:559) — *"a model that cannot read the
scope cannot be dispatched into it."* Meanwhile `adapter/inject.ts` has no budget, cap or
truncation logic at all, and `conductor_wiring.py:96` sets `PER_SLOT_CONTEXT_TOKENS = 8192`.

That 8192 is the number that matters, and it is worse than it looks: `parallel_server_args` emits
`--ctx-size per_slot * count` whenever slots > 1 (conductor_wiring.py:196-197), so the **effective
per-sub-session window is 8192 tokens**, not the 65536 the model preset declares. A 20,000-token
read-set budget cannot fit in an 8,192-token window in the first place, and doctrine already sits
in system position ahead of everything else.

Diagnostics deltas, doc excerpts and fetched page text enter the model's context entirely outside
the only token accounting the system has. The plan caps excerpts handler-side but never relates
that cap to the read-set budget, to the slot context, or to the doctrine payload already in system
position. On a local 27B, a marginal doc excerpt **displaces** source the model needs — so the lane
can degrade quality while looking like it adds capability, and nothing in the design would notice.

**Remedy.** Bring retrieval under the same budget: charge diagnostics/docs/fetch excerpts against
`readSetTokenBudget` (or a sibling `retrievalTokenBudget` derived from it), and make the handler's
cap a function of the item's remaining budget rather than a constant.

## M4 — Phases 25 and 26 specify the wrong language

25.2 specifies *"SQLite FTS5 (stdlib `sqlite3`)"* and 26.2 specifies *"extract text (stdlib
`html.parser`-based)"*. Both are **Python** standard library. 22.2 explicitly places its handler in
`conductor/adapter/tools.ts`, so by symmetry `conductor_docs` and `conductor_fetch` are TypeScript
handlers — and adapters are bound by G14 (dual-runtime: Node type-stripping in tests, Bun in
production) and G1 (zero runtime dependencies). Neither an FTS5 index nor an HTML parser is
available under that constraint without either a Python sidecar (a new process boundary the plan
never mentions) or a hand-written parser.

**Remedy.** State the language boundary explicitly per task. If a Python sidecar is the answer —
and for the corpus installer, `scripts/fetch_docs.py`, it plainly is, matching `fetch_models.py` —
say where the boundary sits and how the TypeScript handler talks across it.

## M5 — Phase 20 partly duplicates an existing contract, and contradicts it

`conductor/adapter/wire-notes.md` is already the measured client contract: 117 lines of
`WIRE_CONTRACT_VERIFIED` assertions against opencode 1.18.15, pinned by
`conductor/tests/wire-contract.test.ts` (36 KB), with `[observed]` tags marking exactly what no
test pins. Proposing a second contract document risks the single-source-of-truth failure this
repository has been burned by more than once.

It also contradicts it. 20.1's "expected surface to confirm, not assume" lists `list`, `todoread`
and `patch` — but the measured offered set is `bash, edit, glob, grep, read, skill, task,
todowrite, webfetch, write`. `list` and `todoread` are **not offered**; `patch` is in the registry
but not offered; and `skill` and `websearch` — both real — appear nowhere in the plan's list.

What Phase 20 *should* be is narrower and genuinely needed. `wire-notes.md`'s own
assertion-coverage notes name the gap: *"built-in tool list: membership/absence of specific names
asserted, never the full list."* That is precisely the drift test 20.1 wants. And the one
unmeasured fact C1 leaves open — opencode's **default permission posture** for `webfetch` and for
`bash` in a sub-agent with no permission row — is exactly what a Phase 20 probe would settle.

**Remedy.** Recast Phase 20 as *"extend `wire-notes.md` and `wire-contract.test.ts` with a full-set
tool-inventory assertion and a measured default-permission posture per built-in"*. Same value, one
source of truth, a fraction of the work — and it converts C1's hedge into a fact.

## M6 — Machine findings have no ingestion channel

24.2 says machine findings *"skip refuters"* and ride the normal receive-review flow. The review
pipeline builds its finding set exclusively from lens replies: `raised` is constructed from
`findings.findings` off sub-session replies (tools.ts:7407), each entry carrying a real `sessionID`
and a key derived from it. A harness-produced finding has no session, so it needs a synthetic
identity and a new entry point that does not exist.

Two adjacent facts the plan should absorb: the skeptic aggregation it wants to bypass is
`findingSurvives(verdicts, k)` with a tie-upholds rule (core/verdict.ts), and
`workflow.skepticsPerFinding` defaults to **2** — so skipping refuters for machine findings saves
two sub-sessions per finding, which on a local 27B is a real and quantifiable saving. The idea is
good; the wiring is unspecified.

One §11 claim runs the other way and should be *removed* rather than corrected: the wiring manifest
needs no extension. It carries a single `toolBinding` row — `{ name: "conductor-tools", kind:
"toolBinding", registration: "CONDUCTOR_TOOL_NAMES" }` (core/wiring-manifest.ts:75) — and its test
asserts set-equality against the constructed tool map with every entry carrying a real (non-
fallback) `ToolSpec`. A new tool is caught by the manifest **already**, in both directions, with no
edit at all. That is the plan's own "fails on any half-wired tool" property, already delivered.

Note also that 24.1's *"structured data (not prose)"* is not what the transport supports:
`FanoutJob.prompt` is a `string` (adapter/fanout.ts:69) delivered as one text part. Structured
findings become JSON inside a prompt string — which is fine, but the plan should say so rather than
imply a typed channel.


## M7 — `buildCommand` is documented, implemented, and unusable

`adapter/evidence.ts` implements build-before-test in full: `runWithBuild` spawns the build command
first and, on failure, reds the scope with `phase: "build"` without running the tests (:495-510,
:582, :629). `docs/user/configuration.md` documents the key. And the setup path refuses to ever
write one, for a reason the source states in its own comment (tools.ts:10814-10816):

> *"No buildCommand, ever: §2.1 describes the field and adapter/evidence.ts implements it, but
> SCHEMAS.Config omits it under `additionalProperties:false`, so a config carrying one fails its own
> registered schema."*

`Config["verify"]["scopes"]` (core/types.ts:223) carries `command`, `timeoutMs` and `itemTest?` and
nothing else. An operator following the committed documentation writes a config that fails
validation.

This is not a defect of the plan — it is a standing defect the plan walks past, and it is directly
relevant to Phase 22's sizing: the cheapest route to enforced diagnostics is **three lines in a
schema**, not a diagnostics subsystem. It is also a documentation-honesty defect of exactly the
class `ops-docs.test.ts` exists to catch and did not.

**Remedy.** Add `buildCommand?: string[]` to the Config type and the registered schema, delete the
setup-path exclusion, and add a test that a config carrying one validates.

# LOW

- **L1 — `DECISIONS.md` is lettered, not numbered.** §11 proposes *"new entries: 8 … 9 … 10 … 11"*.
  The file's seven standing decisions are `## (a)` through `## (g)`. Read as ordinals the numbering
  is right (the 8th entry is `(h)`), but written literally it produces a file with both schemes.
- **L2 — the numbered part of `HONEST-LIMITS.md` is verbatim-pinned to the immutable plan.** New
  limits belong in the "limits the build itself discovered" section, which uses prose headings, not
  numbers. Writing the four proposed limits in the numbered style breaks `ops-docs.test.ts` and
  `verify-acceptance.sh` row 11b at once, with a failure message that does not point at the cause.
  (`HANDOFF.md` already records an open plan-immutability collision on limits 8 and 11 — this plan
  would add to it.)
- **L3 — a tenth doctrine pack is a five-site edit.** `conductor/doctrine/` holds nine packs.
  Adding one requires: the pack file; a `REQUIRED_PACKS` entry (fail-closed load); a delivery path
  — and `ROLE_PACKS` is not the only one, since two of the nine are delivered by conditional
  branches inside `buildSystemAppend`; a tenth row in the hand-maintained mirror table at
  `docs/developer/doctrine-system.md:320-331`; and edits to the inline nine-filename enumerations
  in `docs/user/conductor-overview.md:203` and elsewhere. Dropping the file in first turns the gate
  red before any TypeScript is written, because `ops-docs.test.ts` reads the directory rather than
  a list. Adding it to `REQUIRED_PACKS` without a delivery path reproduces defect **C-028**
  exactly — a pack loaded, validated, fail-closed on, and injected into zero sessions
  (`docs/build/GATES.json`).

---

# Part III — What I checked and found sound

Adversarial review is worth nothing if it does not also say what survives. These held up under
attack, and several are better than the plan claims for them.

- **D2's rejection of reviewer-applied fixes.** Four independent reasons, every one confirmed
  against the code. This is the strongest paragraph in the document. Do not reopen it.
- **D3's typed tools over built-in enablement.** Correct, and *more* correct than argued: a
  `conductor_*` name classifies as `"conductor"`, which sets `gateBeforeToolCall`'s fail-closed
  `guarded` flag (tools.ts:441-446). An enabled built-in stays fail-open. The plan gets a G5 posture
  upgrade for free and never claims it.
- **The "no row ⇒ refused" growth property**, for `conductor_*` names. Real, pinned by
  `tool-legality.test.ts:366-370` in both directions, and the right thing to build on.
- **Handler-owned execution as the extension of G6.** The single most important call in the
  document. A model-composed linter command line reduces a finding to a model claim, which is the
  failure the entire system exists to prevent.
- **The observe → report → enforce maturation (D4).** The precedent is real (HONEST-LIMITS limit
  9), and keeping diagnostics advisory until evidence justifies promotion is the conservative,
  correct call.
- **Baseline-and-delta reporting (22.3).** Without it, diagnostics are unusable in any repository
  with history.
- **Fix flags excluded by a registry-shape *test*, not a convention (22.1).** Exactly the right
  mechanism, and the model for the two additional exclusions H3 recommends.
- **I5, I6, I7.** The patch refusal and spawn denial are real and unconditional (tools.ts:211,
  448-460; gates-edit.ts:57-63). One model for every role is `DECISIONS.md` (d). Nothing in Phase 26
  goes near `router/`.
- **§13's permanent non-goals.** Writing down what a document may never be cited for is a
  discipline worth keeping.
- **The R3-versus-X classification argument (line 47).** The right test for whether a class is
  bound-able at all, correctly derived from the committed patch rationale.
- **`.data/` placement for the corpus and cache.** Consistent with the repository's conventions —
  `.data/` is gitignored, so no docset or cache can dirty a tracked tree.
- **The infrastructure 22.1 wants to mirror genuinely exists**, even though the plan cites the wrong
  artifact for it: `setupDetect`, `RUNNER_PROFILES` + `detectRunner`, `RunnerRules`, the
  `verify.scopes` block, and a written recipe at `docs/developer/extending.md:389-438`. 22.1's
  *premise* is sound; only its citation is wrong.

## One standing fact the review surfaced, unrelated to the plan

`adapter/fanout.ts` creates every sub-session with `client.session.create({ body: { title } })` —
**no `agent`, no `parentID`** (fanout.ts:262-264) — and prompts it with `{ parts, model }` and no
agent (:307-311). The six subagent blocks in `conductor/opencode-fragment.json` are therefore
**never selected for a fan-out sub-session**. Their `"edit": "deny"` and `"tools": {"task": false}`
rows bind the orchestrator only.

Nothing is broken by this: the registry gate's unconditional spawn deny and the edit-scope gate's
`READER_ROLES` both bind regardless of which agent a session runs under, so the enforcement holds.
But it means fragment-level permissions are **not** a lever for sub-session capability, which
changes the shape of the cheapest remedy in Part V, and it is worth an `OPERATIONS.md` line so that
nobody later "hardens" a sub-agent block that no sub-session ever reads.

---

# Part IV — Is this a general and clear improvement?

The honest answer has two halves, and they point in opposite directions.

## The direction is a clear improvement. The document is not yet the way to get there.

**What is genuinely, generally better about the idea.** Strip away the premise and the citations,
and the plan is arguing for something the harness needs and does not have:

> Every capability a conductor session reaches should be typed, handler-executed, journaled,
> phase-scoped and fail-closed — including the ones nobody decided to grant.

Today the system has two postures. `conductor_*` calls pass a choke point with a declaration table,
a caller rule, a phase rule, and a refusal message that names the rule it violated. Everything else
— `read`, `grep`, `glob`, `webfetch`, `skill`, `todowrite`, and every read-shaped `bash` command —
passes a single `return "read"` and an unconditional `ALLOW` with the comment *"A stray reader is
harmless."* One half of the tool surface is governed to an unusually high standard. The other half
is governed by an assumption that was true when it was written and is not true of `webfetch`,
`curl`, or a linter that writes a cache into the tree.

Closing that gap is the improvement, and it is a *general* one: it does not depend on the bench, on
retrieval being useful, or on any hypothesis about 27B models. It makes the system's story about
itself true. That is worth doing on its own terms.

**Why the document is not yet the way to get there.** Three reasons, in order of weight:

1. **It is aimed at the wrong problem.** "Add missing capability" and "govern existing capability"
   produce different phase orders, different default postures, different acceptance tests and
   different risk profiles. Under the correct framing, Phase 21 is a *tightening* whose main risk is
   breaking working sessions, and Phase 26 is the *highest-value* lane rather than the one deferred
   behind a flag.
2. **Two of its four lanes propose execution paths that already exist.** Mechanical fixes are
   `format.rules` at publish (C3). Diagnostics as an enforced criterion is a named `verify.scopes`
   entry — a scope called `types` whose `command` is `["npx","tsc","--noEmit"]`, mapped through
   `requiredScopes`, runs today as handler-derived, timeout-bounded, quarantine-protected,
   freshness-stamped evidence with **zero new code**. The purpose-built form,
   `verify.scopes.<name>.buildCommand`, is implemented in `adapter/evidence.ts` (`runWithBuild`,
   :495-510) and documented in `docs/user/configuration.md` — and is **unusable**, for a reason the
   source states itself (M7). Both blocks ship empty and nobody has filled them in. A plan that does
   not know this is sizing greenfield work where configuration would do.
3. **Its facts do not survive contact.** Four wrong module citations, three vocabulary collisions, a
   surface list contradicted by the repository's own measurement, two invariants that misdescribe
   HEAD, two safety devices without substrate, and a phase-boundary gate that cannot pass. An
   implementing agent following this document literally would spend its first day in the wrong
   files.

## The three questions the operator should actually be asking

**Does conductor need more capability?** Unknown, and cheaply knowable. The three-arm bench exists,
the `baseline` arm is plain opencode, and 14.2 has never run. One campaign with tool-call
transcripts retained answers it.

**Does conductor need more *governance* of the capability it has?** Yes, and this does not depend
on the answer above. The evidence is in Part II: an ungoverned egress lane, a fail-open read class,
linters that can dirty a tree no gate watches, and an override hatch reachable from a session that
just read attacker-controlled text.

**Is the plan's architecture the right one for that governance?** Mostly yes. The taxonomy, the
handler-owned execution, the enumerated-allow posture and the maturation doctrine are all right. It
is the framing, the sequencing, the citations and two of the four lanes that need to change.

---

# Part V — Recommended remediation, in order

Five stages. Stages 0 and 1 are cheap and should happen regardless of what is decided about the
rest. Stage 2 is the decision point.

## Stage 0 — Document corrections, before any code

Free, and they change what everything else costs.

1. **Rewrite §0 from the governance premise** (C1). The objective becomes: bring the read and
   network surface a conductor session already reaches under typed, journaled, handler-executed,
   fail-closed control.
2. **Re-cite every task against the code** (H7). Specifically: 21.2 → `core/tool-legality.ts`
   rows + an adapter-side built-in check, not `legalTools`; 22.1 → `adapter/evidence.ts`
   `RUNNER_PROFILES`/`detectRunner` + `core/freshness.ts` `RunnerRules` + `verify.scopes`, with the
   recipe at `docs/developer/extending.md:389-438`; 24.2 → `core/verdict.ts`; drop `provenance` and
   `mechanical` as names (G10 collisions), and rename 27.2's "presets" to "arms".
3. **Restate I2 as a subprocess rule and I3 with its missing constraint** (H2, H3).
4. **Correct I1 to name the override hatch** (H5), and add the R2/R3-versus-override exclusion.
5. **Delete the §1 R0 examples that do not exist** (`list`) and add the ones that do (`skill`,
   `websearch` as registry-only) — the repository already measured this (M5).
6. **Add a cost table** (M1) and take the `tools.ts` split decision before any tool lands.
7. **Fix the bookkeeping**: lettered `DECISIONS.md` entries, `HONEST-LIMITS` discovered-section
   placement, the five-site doctrine pack edit (L1–L3).

## Stage 1 — Close the governance holes that exist today (no new tools)

Small, self-contained, and valuable whatever happens to Phases 22–27. **Note the lever:** because
fan-out selects no agent (Part III), `opencode-fragment.json` binds only the orchestrator. Every
change below must live in conductor's own gate, which binds every session.

1. **Give the network its own tool class.** Add `webfetch` (and `websearch`, registry-only today but
   one upstream flip from offered) to a `NETWORK_TOOLS` set in `adapter/tools.ts` and classify them
   as their own class rather than `"read"`. That makes them `guarded` — fail-closed on a gate crash
   — and gives them a deny point. Default: deny, with the refusal naming `conductor_fetch` as the
   sanctioned path once it exists.
2. **Add a network-shape extractor for `bash`**, beside the existing write-shape extractor and
   reusing the same tokenizer: `curl`, `wget`, `nc`, `ssh`, `scp`, `ftp`, and the proxy-defeating
   flags. Classify a matching command as network class. This is the lane the plan's `retrieval.
   enabled: false` does not close (H4).
3. **Journal allowed reads.** Today `gates: allow` is emitted only when an override grant is spent,
   so an allowed read or network call leaves **no record at all**. At minimum, journal every
   network-class call at `warn` and every read-class call at `debug`. This is detection where
   prevention is not chosen, which is the repository's own G7 posture, and it is what makes the
   Stage 2 measurement readable.
4. **Fix README.md:24.** *"opencode talks to that endpoint and nothing else"* is inaccurate at HEAD
   for the orchestrator. Correct it as a present inaccuracy, not later as a consequence of a flag.
5. **Close the override chain** (H5): once a session has received R2/R3 content, its
   `conductor_override` row becomes orchestrator-only. One row, one test.

## Stage 2 — Measure, before building any lane

This is the decision point, and the plan's own §12 gate requires it (C2: `verify-acceptance.sh` row
8 cannot pass until 14.2 produces its report).

1. Run **13.2** (attended live smoke), which is already instrumented and is the owner's next action
   per `HANDOFF.md`.
2. Run **14.2** — or a reduced pilot of it — on the existing three arms, with **tool-call
   transcripts retained** (Stage 1.3 is what makes them complete).
3. Read the transcripts for the actual question: *does the `baseline` arm use `webfetch` or
   read-shaped `bash` in ways the `conductor` arm does not, and does that use correlate with
   passing?* That measurement sizes the capability gap that Phases 22–26 exist to close, and it
   costs no new code.

Extend Phase 20 into this stage, recast as M5 recommends: a full-set tool-inventory assertion in
`wire-contract.test.ts` plus a measured **default permission posture** per built-in. That converts
C1's one remaining hedge into a fact.

## Stage 3 — Use what already exists, then measure again

Before building `conductor_diag` and `conductor_mechanize`, fill in the blocks that already do
most of what they promise:

1. **Diagnostics as an enforced criterion, two ways.** *(a) Today, zero code:* add a named
   `verify.scopes` entry per checker — `types` → `["npx","tsc","--noEmit"]`, `lint` →
   `["ruff","check"]` — and map them in `requiredScopes`. They run as handler-derived,
   quarantine-protected, freshness-stamped evidence immediately. The one loss is failure
   classification: with no `RunnerRules` entry a type error classifies as `error` rather than
   `assertion` (`core/freshness.ts` `classifyFailure`), so use these as *validate* scopes, not as
   the RED proof. *(b) Three lines:* unblock `buildCommand` in `SCHEMAS.Config` (M7) for
   build-before-test ordering and the `phase: "build"` failure class the implementation already
   produces.
2. **`format.rules`** — configure the formatters. If pre-review formatting is wanted, add a second
   invocation point for the **existing** `formatRuleFor` path at post-GREEN, reusing the stdin
   contract verbatim (C3).
3. Re-run the pilot. If the enforced pass/fail form proves too blunt — legacy noise, or findings
   the item cannot act on — *that* is the measured justification for `conductor_diag`'s advisory
   delta lane, and the plan's thesis-3 maturation story is finally being followed rather than
   asserted.

## Stage 4 — Build only the lanes that survived, in the corrected order

If Stages 2 and 3 justify them:

| Lane                              | Verdict           | Shape                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 22 — diagnostics**        | Build, reduced    | Injection-first: the handler runs the registered diagnostics at dispatch and attaches the delta to the brief. No model-callable tool, no legality row, no verify-freeze question, no query-formulation demand on a 27B (H6). Add cache-suppression to the registry and a footprint check (H3). |
| **Phase 23 — mechanize**          | Do not build      | Extend `format.rules` to a second invocation point instead (C3). Revisit rule-id autofixers only on diagnostics evidence.                                                                                                                                                                      |
| **Phase 24 — review integration** | Build, after 22   | Needs the ingestion channel M6 names. The refuter skip is worth 2 sub-sessions per machine finding.                                                                                                                                                                                            |
| **Phase 25 — docs**               | Build push-first  | Resolve reference sections from the item's `fileScope` at dispatch and inject them. Add the query tool only if the pushed form proves insufficient (H6). Settle the Python/TypeScript boundary first (M4).                                                                                     |
| **Phase 26 — fetch**              | Build, promoted   | This is the lane that closes a live hole. The **proxy is required, not optional** (H4), and honest limits must record that a determined `--noproxy` defeats it.                                                                                                                                |
| **Phase 27 — bench**              | Fold into Stage 2 | The vanilla arm exists. What is left is the capability dimension, symmetric exclusions, `within_noise` reporting instead of win/tie/loss, and a declared — not denied — sampling asymmetry (M2).                                                                                               |

Every lane stays behind its own config flag, as §12 already specifies. Retrieval must be charged
against a token budget (M3) before any of it reaches an 8,192-token sub-session window.

---

# Part VI — The plan's own decision gates and open questions

## D1 — Which classes are enabled by default?

**Amend.** The class frame is right; the posture question is mis-framed because the baseline is
wrong. R0 on (it already is). R1 on, but handler-executed only — the value is version pinning,
normalized findings, journaled provenance and baseline/delta, none of which a `bash` invocation
gives you. R2 on. **R3 closed at the gate rather than off behind a flag**, because a flag does not
close the `bash` lane (Stage 1.1–1.2), then reopened as `conductor_fetch` when Phase 26 lands.

## D2 — How do detected issues get fixed?

**Accept the rejection; reject the adoption.** Reviewer-applied fixes stay refused — the four-part
argument is correct and confirmed. Lane 1 (behavioral fixes through the existing TDD loop) is right
and free. Lane 2 should be a second invocation point for `format.rules`, not `conductor_mechanize`
(C3).

## D3 — Typed tools or enabled built-ins?

**Accept, with a stronger argument than the plan gives.** Typed tools inherit fail-closed posture
from `classifyTool`; built-ins stay fail-open. Add the corollary the plan misses: built-ins that
are *not* wrapped still need a class and a deny point, which is Stage 1.

## D4 — Do diagnostics join the VALIDATED bar?

**Accept — and note the enforced form already exists.** `buildCommand` is the enforced lane
whenever an operator wants it. Advisory-first for the *new* delta lane is correct; the promotion
decision should be made on Stage 3 evidence.

## D5 — Network posture and search

**Amend.** Fetch-only with an allowlist is right. The proxy is required, not recommended. Web
search is genuinely deferred — `websearch` exists in opencode's registry but is not offered
(wire-notes.md:37), so it is not the free lever it might appear to be. The README amendment is
owed **now** (H4), and it should name the clause that actually breaks (line 24), not the one that
does not (line 25).

## D6 — Bench parity contract

**Amend substantially.** The vanilla arm exists (C2). "Same sampling defaults" is false and cannot
be made true without changing conductor — declare the per-role temperature asymmetry as part of the
process under test (M2). Replace win/tie/loss with the existing `within_noise` separability test,
or raise the trial count until win/tie/loss means something. Make exclusions arm-symmetric, and
seed all arms identically.

## Q1 — Initial linter set

**Trim to the bench languages.** `LANGUAGES = ("ts", "python", "cpp")` already exists in the bench
driver; match it. `tsc --noEmit`, `ruff check`, `clang-tidy`. Drop `pyright` and `eslint` from v1 —
two Python type checkers and two JS linters is two parsers each for no measured gain.

## Q2 — Mechanize sweep default

**Moot as asked.** With C3's remedy there is no mechanize lane; the question becomes whether the
existing `format.rules` gets a post-GREEN invocation point, and the answer is: build it, default
off, turn it on when a reviewer round is observed to be spent on style.

## Q3 — Docset selection

**Secondary to the delivery decision.** Settle push-versus-pull first (H6). If the corpus is
pushed at dispatch, the v1 set is whatever covers the bench languages — the same three.

## Q4 — Should `vanilla-net` get a shim or opencode's native `webfetch`?

**Native `webfetch`, pointed at the replay proxy.** The question contains its own answer once C1 is
absorbed: the vanilla arm *already has* `webfetch`, so a shim would be modelling a vanilla session
that does not exist. Purer parity here is purer vanilla.

---

# Appendix — Method, and what this review did not do

**Method.** The plan was read in full, then eight ground-truth passes each verified one load-bearing
factual claim against HEAD with line-ranged reads. Each pass was then re-checked by an independent
skeptic instructed to assume the first agent misread scope, missed a guard, or generalized from a
fixture; every correction a skeptic supplied is reflected above, and several reversed the original
finding. Five red-team lines attacked the thesis, the mechanize lane, the network lane, the bench,
and the design space of rivals. A completeness critic resolved six contradictions between agents by
reading the code itself. The orchestrator independently verified the load-bearing claims — the
capability premise, the publish formatter, the freeze semantics, the override chain, the bench arms
— before admitting them here.

**What this review did not do.** No code was run, no test was executed, and no tree was modified.
The claim in C1 that opencode's default permission posture for `webfetch` and for sub-agent `bash`
is unmeasured is a real gap in this review as much as in the plan; only a live probe settles it,
and Stage 2 is where it belongs. The MEDIUM findings about statistical power are arithmetic on the
existing design, not a simulation. The plan's §11 doctrine and schema obligations were sampled, not
exhaustively enumerated.

**One methodological observation worth keeping.** Every defect in Part II traces to the same root:
the plan was written from this repository's documentation rather than from its code. The
documentation is unusually good, which is exactly why it was trusted. The lesson generalizes to the
harness being built here — a planning agent reading `README.md`'s enforcement table will conclude
that a governed session is a narrow one, because that table describes what conductor *denies* and
is silent about what it *allows*. If conductor is to plan changes to itself, that asymmetry in its
own documentation is a defect worth fixing on its own.
