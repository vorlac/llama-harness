# Conductor addendum — Phases 16-19: intake clarification, artifact discipline, cleanup, activity audit

**Status:** amended per the step-5 decisions (D14, 2026-08-18 —
`docs/reviews/conductor-review/step5-decisions.md` §3). Nothing here is started; execution is
gated on the fix campaign's build-floor pass (constraint A4 below).
**Relationship to the base plan:** this is an **addendum**, not an edit.
`docs/plans/2026-08-07-conductor-harness-plan.md` is immutable (`HANDOFF.md`, standing rules) and
stays immutable. Its Phases 0-15 and its §11 acceptance checklist are untouched. This document adds
Phases 16-19, executed **after** Phase 15 closeout.
**Rationale and evidence:** [docs/reviews/2026-08-14-clarification-and-hygiene-analysis.md](../reviews/2026-08-14-clarification-and-hygiene-analysis.md)

---

## Inherited constraints

Every global constraint of the base plan binds every task here without restatement: G1 (zero runtime
deps), G2 (erasable TS), G3 (pure core / thin adapter), G4 (TDD, no exceptions), G5 (fail-closed on
enforcement, fail-open on convenience), G6 (records over assertions), G7 (detection over prevention,
documented), G8 (orchestrator does not write code), G9 (obligations are schemas, tools, or gates —
never only prose), G10 (naming is fixed; tests hardcode it), G11 (wire contracts verified),
G12 (token cost accepted, wall-clock engineered), G13 (one model, many roles), G14 (dual-runtime
adapters).

Two addendum-specific constraints:

- **A1 — Default behaviour is unchanged.** With a `.conductor/config.json` written before this
  addendum, and with no new keys added, the harness must behave **identically** to Phase 15. This is
  a test (Task 17.1), not an intention.
- **A2 — Phase 14's POC arms are measured with `clarify.enabled: false`.** A clarification-on arm is
  a separate future measurement and is explicitly out of scope here. Any POC re-run that enables it
  must say so in its report.

Four step-5 amendments (D14, 2026-08-18):

- **A3 — Orchestrator-agnostic trust.** Trust lives in the harness, not the orchestrator: any
  prompter (human or LLM) must get a self-defending result produced entirely by local models. No
  task here may assume a stronger-model orchestrator compensates for a missing witness
  (`docs/reviews/conductor-review/step5-decisions.md` §1).
- **A4 — Sequencing.** No addendum task starts before the fix campaign's build-floor pass
  (Phase VII of `docs/build/fix-campaign-plan.md`) is complete — these ~12 tasks must land on the
  new audit floor, not the regime that stopped scaling at ~task 40 of 52 (MACRO-030). Phase 16
  planning also re-takes the tools.ts split decision (the D2 rider); if the split lands, it lands
  before Phase 17's tool additions.
- **A5 — The tool-addition map.** A new `conductor_*` tool touches FIVE files: `tools.ts`
  (handler + input + `CONDUCTOR_TOOL_NAMES`); `types.ts` (schema, twice — interface + JSON schema);
  `tool-bindings.ts` (binding); `plugin/index.ts` (ToolSpec — a missing entry silently falls back
  to an argument-free definition); `gates-phase.ts` (legality via `requireMetaTool`'s declaration
  table, landed by the fix campaign's GAP-006 — never bespoke). Every task file list below means
  all five even where it predates this map (MACRO-025).
- **A6 — Dependency gates on Phase 17.** Task 17.4's `recommended: null` acceptance (stop kind
  `surfaced`) is unsatisfiable before GAP-021's total stop closer (fix campaign Phase III.2).
  Task 17.5's delivery assertions presuppose the §6.4 injection layer is wired (ISSUE-001, fix
  campaign Phase I.4). Neither task may be accepted before its dependency lands.

---

## Phase 16 — Repository hygiene (this repo only; no conductor source touched)

This phase governs **this repository's own build artifacts**, not conductor's runtime behaviour. It
touches no file under `conductor/` or `router/`, so it carries no risk to the remaining base-plan
tasks or to the recorded phase gates, and **may be pulled forward** ahead of Phase 15 at the owner's
discretion.

The problem it solves: build-time scratch currently lands in at least four unrelated places —
`staging/task-*/` at the repo root, `.data/temp/`, `docs/build/artifacts/`, and a `HANDOFF.md` that
names `scratchpad/staging/` while the tree has `staging/`.

### Task 16.1 — Sanctioned roots, documented

- **Write** `docs/build/ARTIFACT-POLICY.md`: the exhaustive list of directories the build harness may
  write outside tracked source, what each is for, and each one's retention rule.
- Proposed roots (one line each, no others legal):

  | Root | Holds | Retention |
  |---|---|---|
  | `docs/build/` | the build ledger: `STATE.json`, `GATES.json`, `HANDOFF.md`, `JOURNAL.jsonl`, `CORRECTIONS.md`, `specs/` | permanent, tracked |
  | `docs/build/artifacts/<YYYYMMDD-HHMMSS>-<kind>-<slug>/` | gate transcripts, review outputs, measurement dumps | tracked when cited by a correction; otherwise swept |
  | `staging/task-<id>/` | pre-verified test files awaiting move-in | deleted when the task commits |
  | `.data/`, `.out/` | model weights, build trees | never touched by any tooling (standing rule) |

- Reconcile `HANDOFF.md`'s `scratchpad/staging/` reference with the on-disk `staging/`; one spelling
  wins and the other is deleted.
- Relocate `.data/temp/generic-autonomous-harness-plan.md` to `docs/plans/` or delete it — a plan
  document in a temp directory is neither.

### Task 16.2 — `scripts/janitor.py`

- **Red first:** `scripts/test_janitor.py` asserting each rule below against a throwaway fixture tree.
- `--check` (default): exit non-zero listing every untracked, non-ignored path outside the sanctioned
  roots, and every `staging/task-<id>/` whose task is `COMMITTED` in `STATE.json`.
- `--sweep`: moves — never deletes — offending paths to `.trash/<YYYYMMDD-HHMMSS>/`, keeping the last
  5 sweeps.
- **Absolute laws, each its own assertion:** never touches a git-tracked file; never resolves a path
  outside the repo root after `realpath`; never touches `.data/`, `.out/`, `extern/`, or `.git/`.

### Task 16.3 — Gate leg

- Add a `janitor --check` leg to `scripts/test-conductor.sh` so a dirty tree fails the gate the same
  way a failing test does.
- The leg reports **how many paths it inspected** (the recurring defect class from `HANDOFF.md`: a
  check that passes while inspecting less than it appears to).

**Phase 16 acceptance:** `scripts/janitor.py --check` exits 0 on a clean tree; `test_janitor.py` green;
the gate leg present and reporting its inspection count; `ARTIFACT-POLICY.md` matches the tree.

---

## Phase 17 — Config surface + intake clarification

### Task 17.1 — Config surface extension (one task, all four blocks)

The `Config` schema is `additionalProperties: false` with every top-level block in `required`
([types.ts:659-673](../../conductor/core/types.ts#L659-L673)). All four blocks are therefore added to
`properties` and **left out of `required`**, with `DEFAULT_CONFIG` supplying them. A config written
before this addendum stays valid; a config written after round-trips unchanged.

```jsonc
"clarify": {
  "enabled": false,           // A2: OFF by default
  "maxQuestions": 5,
  "readers": 3,               // gap / conflict / design-fork lenses
  "refuters": 2,              // a candidate dies if ⌈K/2⌉ refuters answer it from the repo
  "onUnanswered": "block"     // "block" | "proceed"
},
"artifacts": {
  "enabled": true,
  "root": ".conductor/artifacts",
  "dirs": { "analysis": "analysis", "scratch": "scratch", "logs": "logs",
            "stdout": "stdout", "plans": "plans", "reports": "reports" },
  "naming": "{ts}-{kind}-{slug}{ext}",
  "tsFormat": "YYYYMMDD-HHMMSS",
  "maxBytesPerArtifact": 4194304
},
"janitor": {
  "enabled": true,
  "defaultLifetime": "ephemeral",   // "ephemeral" | "run" | "keep"
  "mode": "trash",                  // "trash" | "delete" | "report-only"
  "trashKeepRuns": 5
},
"audit": {
  "level": "operations",      // "off" | "operations" | "paths" | "full"
  "sink": "audit.jsonl",
  "maxBytesPerRun": 134217728,
  "bodyMaxBytes": 8192,
  "redact": ["**/.env*", "**/*.pem", "**/*.key", "**/secrets/**"]
}
```

- **Files:** `conductor/core/types.ts` (interface + JSON schema + three new closed vocabularies:
  `CLARIFY_UNANSWERED_MODES`, `ARTIFACT_LIFETIMES`, `JANITOR_MODES`, `AUDIT_LEVELS`),
  `conductor/adapter/config-io.ts` (`DEFAULT_CONFIG` + fill-on-load).
- **Tests (`conductor/tests/addendum-config.test.ts`):**
  - **A1 regression:** a fixture `config.json` captured from Phase 15 loads, validates, and produces
    a config whose every pre-existing field is byte-identical, with the four new blocks filled from
    defaults.
  - A config that *names* the new blocks round-trips unchanged.
  - Each enum rejects an out-of-vocabulary value with a named error.
  - `additionalProperties: false` still rejects a genuinely unknown key.

### Task 17.2 — `core/clarify.ts` (pure)

Pure functions, no I/O, per G3:

- `classifyCandidate(candidate) → "gap" | "conflict" | "design-fork" | "illegal"` — `illegal` covers
  §6.2's never-ask shapes: *"shall I proceed"*, confirmation of a derivable answer, *"the better
  design is more work, still do it"*.
- `survives(candidate, refuterVerdicts, k) → boolean` — a candidate **dies** when
  `answeredCount ≥ ⌈k/2⌉`. Note the polarity is inverted relative to review findings: here the
  refuter's job is to *answer* the question from the repository, and success kills it.
- `rank(candidates) → candidates` — deterministic ordering: `conflict` > `gap` > `design-fork`, then
  by first-seen index. Truncation to `maxQuestions` happens after ranking so the cut is stable.
- `nextIntakeTool(run, config, questions) → ToolId | null` — the branch Task 17.4 wires in.

**Tests:** table-driven over each classifier shape, each refuter tally including the exact tie
boundary, rank stability under permutation, and the full `nextIntakeTool` truth table.

### Task 17.3 — `conductor_clarify` tool

**Legality:** `INTAKE` ∧ `run.classification.kind === "work"` ∧ `config.clarify.enabled` ∧
`run.clarification === null`. Exactly one round per run; a second call is denied naming the first.

**Handler, in order:**

1. Dispatch `clarify.readers` fresh `reviewer`-role sub-sessions, one lens each — **gap**
   (what the prompt requires but does not specify), **conflict** (contradictions inside the prompt,
   or between the prompt and the repo / config / `DECISIONS.md`), **design-fork** (consequential
   forks with ≥2 real options that the §6.2 ladder does not settle) — each constrained to a new
   `CLARIFY_CANDIDATES` schema (§2.10 style): `{candidates: [{question, why, lens, proposedDefault}]}`.
2. Drop every candidate `classifyCandidate` returns `illegal` for; journal each drop with its reason.
3. Fan out `clarify.refuters` refuters per surviving candidate, instructed to **answer it from the
   repository**, returning `{answered, answer, evidence[]}` where `evidence` must cite real paths.
   A refuter that answers with no evidence path counts as not-answered.
4. Kill every candidate that `survives()` rejects — and **record its refuter answer to
   `decisions.jsonl`** as a derived decision. The derivation is preserved rather than discarded.
5. `rank()`, truncate to `maxQuestions`, and append each survivor to `questions.jsonl` with
   `origin: "intake-clarify"` (a new value in `QUESTION_ORIGINS`), `blocksItems: []` — the run has no
   items yet, so these block the **run**, and Task 17.4's `legalTools` branch is what enforces that.
6. Write `run.clarification = {round: 1, candidates, refuted, asked, tsMs}`.
7. Return the question list so the orchestrator narrates it in its turn — that is the delivery
   channel to the user; `conductor_status` and `report.md` are the durable copies.

**Files:** `conductor/adapter/tools.ts`, `conductor/core/types.ts` (`origin` value, `run.clarification`
optional field, `CLARIFY_CANDIDATES` + `CLARIFY_REFUTATION` schemas),
`conductor/core/journal-events.ts` (widen per the rule at
[journal-events.ts:101-109](../../conductor/core/journal-events.ts#L101-L109): add
`clarify.candidates`, `clarify.dropped`, `clarify.refuted`, `clarify.asked` under a new `clarify`
component, each with a grepping test in the same commit),
`conductor/adapter/tool-bindings.ts` (binding), `conductor/plugin/index.ts` (ToolSpec — the
silent-fallback seam), `conductor/core/gates-phase.ts` (legality row in `requireMetaTool`'s table)
— the last three added per A5 (MACRO-025's two omitted files plus the legality seam).

### Task 17.4 — INTAKE gate branch

Replace the `INTAKE` case at [gates-phase.ts:341-362](../../conductor/core/gates-phase.ts#L341-L362).
No new run FSM state — `RUN_STATES` stays the closed eight-value vocabulary it is today, and INTAKE
keeps discriminating on run fields exactly as it already does for `classification`:

| Condition | Legal | Recommended |
|---|---|---|
| `classification === null` | `classify` | `classify` |
| `work` ∧ clarify enabled ∧ `clarification === null` | `clarify` | `clarify` |
| `work` ∧ `clarification !== null` ∧ open `intake-clarify` questions ∧ `onUnanswered === "block"` | `answer`, `status` | **null** |
| `work` ∧ otherwise | `decompose` | `decompose` |
| `trivial` / `question` | meta tools only | null |

The **`recommended: null`** row is load-bearing: the continuation engine must not re-prompt a run
that is waiting on a human. Its assertion is explicit — *given a run in that row, `continuation.ts`
emits no re-prompt and `shouldTerminate` yields stop kind `surfaced`*. Per A6, this acceptance is
unsatisfiable until GAP-021's total stop closer gives `surfaced` a writer (fix campaign
Phase III.2) — 17.4 is gated on it.

Under `onUnanswered: "proceed"`, unanswered questions are instead written to `decisions.jsonl` as
explicit **assumptions** (option A "assume X", option B "ask", choice A, why "clarify.onUnanswered =
proceed") before `decompose` becomes legal — so a proceeding run still leaves a readable record of
every guess it made.

### Task 17.5 — Answers reach the planner

An answered clarification is worthless if `conductor_decompose` never sees it.

- `conductor_decompose` and `conductor_plan` prompts include every answered `intake-clarify`
  question and its answer, ahead of the doctrine pack.
- `report.md` gains a **Clarifications** section: asked, answered, unanswered, and every candidate
  killed by refutation with the evidence path that killed it.
- **Test:** an end-to-end fixture where the answer text is a distinctive token, asserting the token
  appears in the dispatched planner prompt. A wired-but-undelivered pack is the exact defect class
  `HANDOFF.md` records as C-028; this test is the guard against repeating it.
- Per A6: "ahead of the doctrine pack" and the C-028 guard both presuppose the §6.4 injection
  layer is wired (ISSUE-001, fix campaign Phase I.4) — 17.5 is gated on it.

**Phase 17 acceptance:** A1 regression green; a clarify-enabled fixture run asks ≥1 question on an
ambiguous prompt and **zero** on an unambiguous one; a candidate answerable from the repo is killed
and appears in `decisions.jsonl`; a blocked run emits no re-prompt and stops `surfaced`;
`conductor_answer` resumes it into `decompose`; the answer token reaches the planner prompt.

---

## Phase 18 — Artifact tree + janitor

### Task 18.1 — `conductor_artifact` tool

`conductor_artifact {kind, slug, content, lifetime?}` → `{path}`.

**Design note — why a tool and not an edit-gate allow row.** The edit gate
([gates-edit.ts:185-244](../../conductor/core/gates-edit.ts#L185-L244)) is total default-deny, and
`.conductor/**` is denied to every role. Routing artifact writes through a `conductor_*` tool means
that deny stays **completely intact** — no new allow row, no glob widening, no path-prefix carve-out
in the most security-sensitive function in the codebase. It also enforces the naming law
mechanically rather than in prose (G9) and produces a journal record for free (G6).

**Handler:**

- Validate `kind` against the configured `dirs` keys; validate `slug` as `[a-z0-9][a-z0-9-]{0,47}`;
  reject `content` over `maxBytesPerArtifact`.
- Mint `<root>/<runId>/<kind>/<ts>-<kind>-<slug><ext>` from `artifacts.naming` and `tsFormat`,
  timestamp from the injected clock. Collisions get a `-2`, `-3` suffix — never an overwrite.
- Write atomically (the temp+rename+`wx` pattern `questions.ts` already uses).
- Append to `artifacts.jsonl`: `{path, kind, slug, lifetime, runId, itemId, sessionID, bytes, tsMs,
  sweptIso: null}`.
- Journal `artifact.written`.

**Legality:** every non-terminal run state, every registered session. It advances no FSM state.

**Files:** the full A5 five-file map (`tools.ts`, `types.ts`, `tool-bindings.ts`,
`plugin/index.ts`, `gates-phase.ts`) plus the artifact ledger module this task introduces.

### Task 18.2 — Lifetimes and the sweep

| Lifetime | Swept |
|---|---|
| `ephemeral` (default when omitted) | when the owning item reaches `PUBLISHED` or `deferred` |
| `run` | at `conductor_report`, unless `report.md` references the path |
| `keep` | never; an unreferenced `keep` is reported as an orphan |

`mode: "trash"` (default) **moves** to `.conductor/trash/<runId>/`, pruned to `trashKeepRuns`.
`"delete"` unlinks. `"report-only"` lists and touches nothing.

**Two absolute laws, each its own assertion, each with a test that tries to violate it:**

1. The sweep never touches a git-tracked file.
2. Every path is `realpath`-resolved and must remain under the artifact root — a symlink planted
   inside the artifact tree pointing at `src/` must not get swept.

The sweep result goes into `report.md` — *"removed 14 ephemeral, kept 3, 1 orphan"* — because a
silent cleanup and a cleanup that removed the wrong thing are indistinguishable from outside.

### Task 18.3 — Doctrine

Add the artifact rule to `conductor/doctrine/core.md` and the role packs: **deep analyses, captured
output, and one-shot probe scripts go through `conductor_artifact`; they never go into a source file,
a test file, or a comment.** Per G9 this is the *legal path made obvious*, not the enforcement — the
enforcement is that every other write location is already denied.

**Phase 18 acceptance:** an artifact written through the tool lands at the exact minted path;
a raw write to the same path is still denied by the unmodified edit gate; the ledger records it; the
item-close sweep removes `ephemeral` and keeps `run`; the report sweep honours references; both
absolute laws hold under a test that actively attempts the violation; `trash` is recoverable and
prunes at `trashKeepRuns`.

---

## Phase 19 — Activity audit

### Task 19.1 — `adapter/audit.ts` + the `audit` component

Widen `COMPONENTS` in `journal-events.ts` with `audit`, and its events with `tool.call`,
`path.read`, `path.write`, `body.captured`, `redacted`, `budget.exceeded` — following the widening
rule already written into that file: names added here, in the same commit as the call sites, with a
test that greps for each.

Written to a **separate `runs/<runId>/audit.jsonl`**, not `journal.jsonl`, so the journal stays
reviewable and the two prune on different policies.

| Level | Records |
|---|---|
| `off` | nothing beyond today's journal |
| `operations` (default) | every adjudicated tool call: name, role, itemId, sessionID, verdict, duration |
| `paths` | + every path read, written, globbed, or grepped, resolved and tree-relative |
| `full` | + prompt and response bodies, truncated to `bodyMaxBytes` |

The observation point already exists: `tool.execute.before` fires on **every** tool call in every
conductor-managed session, read-only ones included (base plan §3.5), and `gates: allow` is already in
the closed vocabulary. This task adds recording, not observation.

**G5 applies without exception:** the audit writer is a logger. A crash inside it must never block
work — it degrades to a single `warn` and the run continues.

### Task 19.2 — Budget and redaction

- `maxBytesPerRun` is enforced by the writer. On exceed: one `budget.exceeded` record, one `warn` to
  the console sink, and the audit **downgrades to `operations`** for the rest of the run rather than
  stopping silently or growing without bound.
- `redact` globs are matched against every recorded path; a matching path records its *name* and a
  `redacted` marker, never its content, at any level including `full`.
- **Test the cap by exceeding it**, not by reasoning about it (`HANDOFF.md`: *run the consequence,
  don't reason it*).

### Task 19.3 — Replay and honest limits

- `conductor/tools/replay.ts` gains `--audit` rendering a chronological access log, filterable by
  item, role, and path.
- `HONEST-LIMITS.md` gains one entry, worded so a complete-looking log cannot imply completeness:
  **the audit records what conductor adjudicates. A human or a script at a raw terminal is invisible
  to it (G7, honest-limit 7). An empty audit is not evidence that nothing happened.**
- Ops documentation states the measured size of a `full`-level run before anyone is invited to enable
  it — measured on a real run, not estimated.

**Phase 19 acceptance:** each of the four levels records exactly its tier and nothing above it; a
crashing audit writer does not block a tool call; the byte cap downgrades under a test that actually
exceeds it; a redact-matched path never yields content at `full`; `replay.ts --audit` renders; the
honest-limits entry exists.

---

## Addendum acceptance checklist

- [ ] **A1** — a pre-addendum config produces byte-identical behaviour, proven by fixture.
- [ ] **A2** — POC arms documented as measured with `clarify.enabled: false`.
- [ ] `node --test conductor/tests/` green, including ≥5 new test files.
- [ ] `bun test conductor/tests/bun-smoke.test.ts` green (G14 — the new adapters run under Bun).
- [ ] Purity guard green (G3 — `core/clarify.ts` imports no I/O).
- [ ] `scripts/janitor.py --check` exits 0 and is a gate leg.
- [ ] Every new journal event name has a test that greps for it (the §7.4 debuggability law).
- [ ] The edit gate is **unmodified** — verified by diff, not by claim.
- [ ] `RUN_STATES` is unmodified — no new run FSM state was introduced.
- [ ] `HONEST-LIMITS.md` carries the audit-completeness entry.
- [ ] Each of the four features toggles cleanly off, tested at the off setting as well as on.

## Owner decisions (recorded 2026-08-14)

All four are settled. They are transcribed into `conductor/DECISIONS.md` as a §6.2 entry when Task
17.1 starts — not before, because that file is the active build's standing ledger and is being
written concurrently.

1. **`clarify.enabled` defaults to `false`.** Autonomy is the priority for this setup. The reasoning
   is worth preserving because it is the load-bearing argument for the whole default: *a suboptimal
   decision made autonomously is expected to be caught downstream* — by adversarial plan review, by
   the six-lens item review, or by the TDD validation gates. The harness is a net of independent
   checks, so a wrong guess has several places left to fail loudly. Flipping the toggle later is a
   one-line config change, which makes `false` the cheap default to be wrong about.
2. **`onUnanswered` defaults to `block`.** A run with open intake questions stops with stop kind
   `surfaced` and emits no re-prompts; `proceed` remains available and records each unanswered
   question as an explicit assumption in `decisions.jsonl`.
3. **`audit.level` defaults to `operations`.**
4. **Phase 16 is NOT pulled forward.** It executes in order, after Phase 15 closeout.

**Why Phase 16 stays in order.** It shares no code with Phases 17-19, so its position changes nothing
about the final implementation — but pulling it forward crosses the live build in three places:
Task 16.2's janitor would flag `staging/task-<id>/` directories for committed tasks, and
`HANDOFF.md` records task-14.1's bench driver as *deliberately held in staging* precisely so the gate
stays green — a sweep there destroys a pre-verified deliverable; Task 16.3 adds a leg to
`scripts/test-conductor.sh`, the gate every remaining task and phase gate runs through, so a dirty
in-flight tree would halt the build; and Task 16.1 edits `HANDOFF.md`, which the build orchestrator
rewrites continuously. On the merits it is also better late: `ARTIFACT-POLICY.md` should describe the
finished tree, and `staging/` is empty only once every task has committed.
