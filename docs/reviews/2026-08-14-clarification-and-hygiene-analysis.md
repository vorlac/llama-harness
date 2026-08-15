# Analysis — proactive clarification, artifact discipline, cleanup, and activity audit

**Date:** 2026-08-14
**Scope reviewed:** `docs/plans/2026-08-07-conductor-harness-plan.md` (the immutable build plan, 3,399 lines),
`conductor/core/`, `conductor/adapter/`, `conductor/DECISIONS.md`, `docs/build/HANDOFF.md`,
`docs/prompt-lifecycle.md`.
**Question asked:** does anything in this workspace force the model to come back to the user with
questions when it finds gaps, ambiguity, or conflicting information — before it starts planning and
building? If not, how should that be added, as a toggle?
**Companion plan:** [2026-08-14-conductor-addendum-phases-16-19.md](../plans/2026-08-14-conductor-addendum-phases-16-19.md)

---

## 1. The direct answer

**No. Nothing in the plan or the built code makes the model ask you anything about your prompt
before it commits to a decomposition and a plan.**

There is a question mechanism, and it is well built — but every one of its trigger points is
*post-hoc*. The closed vocabulary of question origins is the proof
([conductor/core/types.ts:87-95](../../conductor/core/types.ts#L87-L95)):

| Origin | Fires when |
|---|---|
| `plan-review-cap` | plan review burned all 3 rounds and majors still survive |
| `debug-architecture` | 3 failed fix attempts inside DEBUG |
| `implementer-blocked` | an implementer escalated past context and model bumps |
| `review-round-cap` | item review burned all 3 rounds |
| `scope-conflict` | two items collided over the same files |
| `surface-tool` | the model voluntarily called `conductor_surface` |

Five of the six are **exhaustion signals**. The sixth is voluntary, ungated, and unprompted — under
G9's own assumption ("local models are assumed weak at prose compliance") a voluntary tool with no
gate forcing it is a tool that will not be called.

The closest thing to ambiguity detection is plan-review lens (b), *"completeness vs the user's
prompt"* (plan §3.2, lines 1119-1131). It is real, but it lands in the wrong place and produces the
wrong artifact:

- **Wrong place.** It runs at `PLAN_REVIEWED` — *after* `conductor_decompose` and `conductor_plan`,
  the two most expensive planning stages. By the time it looks at your prompt, the model has
  already resolved every ambiguity by guessing, and the guesses are baked into the item scopes,
  the DAG, and the acceptance criteria.
- **Wrong artifact.** Its output is a *finding against the plan*, which loops back to the planner.
  It becomes a question to you only if it survives 3 full revision rounds.

And `conductor_setup` does ask you two questions — git mode and `behavioralPaths` (plan §2.1, lines
620-624) — but those are questions about the **repository**, asked once, ever. Never about the
prompt.

## 2. The gap is deliberate, not an oversight

This matters for how to add the feature. The plan does not merely omit clarification; it argues
*against* it in three separate places:

- **§6.2, the decision protocol** (lines 1851-1879) is a six-rung precedence ladder built to
  *derive* answers instead of asking. It defines "human territory" as a narrow whitelist — taste,
  money, irreversible external commitments, secrets, genuine ladder-5 ties — and then names three
  things the model may **never** ask: *"shall I proceed?"*, confirmation of a derivable answer, and
  *"the better design is more work, still do it?"*.
- **§3.5, the ask-gate** (lines 1415-1426) actively *rejects* sub-session questions at the
  permission bus and converts them into `NEEDS_CONTEXT` or a surfaced question.
- **`DECISIONS.md` entry (c)** rejects a human-approved override hatch on the explicit ground that
  gating on a human "would break the autonomous operation the recorded-derivation protocol exists
  to serve."

So the design's stance is coherent: **autonomy first, ask only on exhaustion.** That is exactly why
your instinct to make this a toggle is right, and it is also why the toggle must default to *off*.
Turning it on unconditionally would contradict a documented standing decision and would change what
Phase 14's POC actually measures.

## 3. Do I agree it should be added? Yes — and here is the specific reason

Not because "asking is good practice." Because of a **cost asymmetry** that the current design gets
backwards.

Today, an underspecified prompt takes this path:

```
prompt → classify(work) → decompose (guess) → plan (guess harder) → plan review ×3 rounds
       → maybe a question, ~4 sub-session fan-outs and two planner passes later
```

The guess is not even recorded as a guess. §6.2's ladder tells the model to *derive*, so
"the user probably meant X" gets written into `decisions.jsonl` as a derived decision with a
rationale — which reads, at report time, exactly like a decision that was actually determined by
evidence. That is the real defect: **ambiguity is silently converted into a confident-looking
decision record.**

An intake clarification round costs one cheap fan-out — call it 2-4 sub-sessions on a prompt-sized
context, seconds of wall-clock. Getting the answer wrong costs a decompose, a plan, up to three
plan-review rounds at 4 lenses each, and potentially a full item cycle before anyone notices. The
asymmetry is roughly two orders of magnitude, and it runs entirely in your favour.

The feature is therefore not a hedge against model weakness. It is moving an existing check
(completeness vs the prompt) from after the expensive stage to before it, and changing its output
from "a finding the planner argues with" to "a question you answer."

**Where I'd push back on the framing:** the goal should not be "ask when uncertain." A weak local
model is uncertain about nearly everything, and an interrogation loop is a worse failure than a
wrong guess — it converts an autonomous harness into a chat client. The design has to enforce a
much sharper bar:

> A question is legal only if **no reviewer, given the repo, the config, and the prompt, can answer
> it.**

That bar is testable with machinery this harness already has. Every candidate question goes to
refuters whose job is to *answer it from the codebase*. If a refuter answers it, the question dies
and the answer is recorded as a derived decision instead. Only genuinely underdetermined questions
survive to reach you. This is the same skeptic-refutation pattern the plan already uses for review
findings (§2.10, `skepticsPerFinding`), pointed at a different target — so it is a reuse, not a new
mechanism.

**Honest risks, stated plainly:**

1. **Question spam.** Mitigated by the refutation bar above, plus a hard `maxQuestions` cap and
   exactly one clarification round per run — never a dialogue.
2. **A run that waits forever.** If you walk away, the run must not sit burning re-prompts. The
   continuation engine must treat "intake questions open" as *not actionable* and stop with the
   existing `surfaced` stop kind. This is already representable — `shouldTerminate` has a
   `surfaced` case (§2.9).
3. **It changes what the POC measures.** Phase 14's three arms must be run with clarification off.
   A clarification-on arm is a separate, later measurement.

## 4. The three afterthoughts

### 4.1 File organization — the framing needs correcting first

You described the model spraying temp files, scratchpads, and log dumps, and asked for enforced
organization. In a conductor-governed run, **the opposite problem exists**: the model cannot write
a scratch file at all, anywhere.

[conductor/core/gates-edit.ts:185-244](../../conductor/core/gates-edit.ts#L185-L244) is total
default-deny. Every role is enumerated and every path outside a narrow allowance is refused:
orchestrator denied all edits without an inline claim; implementer confined to `fileScope`;
test-writer confined to `testScope`; reviewer/skeptic/planner/mechanical denied all edits; everyone
denied `.conductor/**`; everyone frozen during a verify. Bash write-shapes (redirects, `tee`,
`sed -i`, `mv`/`cp` destinations) are covered too, so `echo … > notes.md` is denied on the same
path.

So the accurate statement of the gap is:

> **There is no legal place for the model to put a deep analysis, a captured stdout dump, or a
> throwaway probe script — so any such work is either not done, or smuggled into a file that is
> part of the deliverable.**

That second failure mode is the one worth fixing. It is how a 300-line "analysis" comment ends up
at the top of a source file, or how a debugging script gets committed as a test.

The right shape is what you described — a sanctioned, dated, categorized artifact tree — but the
motivation is *enabling* structured output, not *restraining* sprawl:

```
.conductor/artifacts/<runId>/<kind>/<YYYYMMDD-HHMMSS>-<kind>-<slug>.<ext>
                              ├── analysis/    deep audits, investigation reports
                              ├── scratch/     working notes, one-shot probes
                              ├── logs/        harness-captured process logs
                              ├── stdout/      raw command output dumps
                              ├── plans/       model-authored planning documents
                              └── reports/     generated summaries
```

Root and per-kind directory names configurable; that layout the default. Writes go through a tool
(`conductor_artifact`), not a raw file write — which means the naming law is enforced by the
handler rather than requested in prose, per G9, and every artifact gets a journal record for free.

**This needs no change to the edit gate at all** — which is the part worth noticing. The obvious
design is a narrow allow row for `<artifactRoot>/<runId>/<kind>/`, but carving a hole in the most
security-sensitive function in the codebase is avoidable: because writes go through a `conductor_*`
tool rather than a raw file write, the `.conductor/**` deny stays completely intact. The tool is
adjudicated by the phase gate instead. Strictly fewer moving parts, and one fewer place a path-prefix
bug could become a scope escape.

**One thing that can be fixed today, separately.** The sprawl you are actually feeling is in *this*
repository, from the build harness that is constructing conductor — `staging/task-*/` at the repo
root, `.data/temp/generic-autonomous-harness-plan.md` (a plan document parked in a temp directory),
`docs/build/artifacts/`, and a `HANDOFF.md` that refers to `scratchpad/staging/` while the tree has
`staging/`. None of that is governed by conductor's gates. That is a convention-and-janitor-script
problem, it carries zero risk to the POC, and it does not need to wait for the addendum.

### 4.2 Cleanup — make it mechanical, and make it recoverable

Asking a model to remember to clean up is a prose instruction, which G9 says is not enforcement.
The mechanism should be a **declared lifetime at creation time**:

| Lifetime | Swept when |
|---|---|
| `ephemeral` (default) | the item closes |
| `run` | the run closes, unless `report.md` references it |
| `keep` | never; must be referenced by the report or the sweep flags it as an orphan |

Undeclared means `ephemeral`, so forgetting to declare produces cleanup rather than accumulation.

**Sweeping should move, not delete.** Default mode moves swept artifacts to
`.conductor/trash/<runId>/`, pruned by the existing `retention.keepRuns` policy. A mistaken sweep is
then recoverable for N runs, at the cost of one rename. `delete` and `report-only` modes exist for
people who want them. Two absolute laws: the sweep never touches a git-tracked file, and it never
resolves a path outside the artifact root. Both are assertions, not comments.

The sweep result belongs in `report.md` — *"removed 14 ephemeral artifacts, kept 3, 1 orphan"* —
because a silent cleanup and a cleanup that deleted the wrong thing look identical from outside.

### 4.3 Activity audit — most of the substrate already exists

This is the cheapest of the three, because the plan already built almost all of it:

- Five log levels with per-component overrides and an env override (§7.1, lines 1911-1914).
- `gates: allow` and `gates: snapshot` are **already in the closed event vocabulary**
  ([conductor/core/journal-events.ts:37](../../conductor/core/journal-events.ts#L37)) — so recording
  every adjudicated call needs no vocabulary widening.
- The gate hook already fires on **every tool call in every session**, read-only ones included
  (§3.5, lines 1336-1353). The observation point is in place; only the recording is optional.
- `trace` level already captures full sub-session prompts and outputs.
- Retention and rotation already exist (§2.1 `retention`, §7.1).

What is missing is a **volume dial that is independent of log level** — you may well want a complete
audit trail while keeping the journal at `info`. Four tiers:

| Tier | Records |
|---|---|
| `off` | nothing beyond the existing journal |
| `operations` (default) | every tool call: name, role, item, verdict, duration |
| `paths` | the above, plus every path read, written, globbed, or grepped |
| `full` | the above, plus prompt and response bodies, truncated to a byte cap |

Written to a **separate `audit.jsonl`**, not mixed into `journal.jsonl`, so the journal stays
reviewable and the two can be pruned on different policies.

Two honest caveats that must be documented rather than glossed:

- **`full` is enormous.** Six review lenses × three rounds × N items means the repository's relevant
  contents pass through the audit many times over, into a file inside your repo that git has been
  told to ignore. It needs a hard `maxBytesPerRun` with a loud stop, and redaction globs for
  `.env`, keys, and secrets directories.
- **Audit is not a security boundary.** It records what conductor sees. A human or script at a raw
  terminal is still invisible to it — this is G7 / honest-limit 7, and the audit documentation must
  repeat it rather than let a complete-looking log imply completeness.

## 5. Where this work should land

**Not in the current build.** Three reasons:

1. `HANDOFF.md` states the plan is **immutable**; the build tracks 55 ledger rows against it with
   48 committed, and phase gates 0-9 and 11 already recorded PASS against a specific scope.
2. The remaining critical path is 12.2 → 13.1 → 13.2 → 14.1 → **14.2** → 15.1. Phase 14.2 is the
   POC — 90 headless runs, measured in hours, and the entire point of the project. Editing
   `tools.ts`, `gates-phase.ts`, `gates-edit.ts`, and `types.ts` before that measurement would
   invalidate gate results already recorded and change the thing being measured.
3. The `Config` schema is `additionalProperties: false` with every top-level block in `required`
   ([conductor/core/types.ts:659-673](../../conductor/core/types.ts#L659-L673)). New blocks are
   safe *only* if added to `properties` and left out of `required`, with `DEFAULT_CONFIG` supplying
   them — otherwise every existing config and fixture breaks at once. That is a deliberate,
   test-heavy change, not something to slip in mid-phase.

**Recommendation:** a separate addendum plan — **Phases 16-19**, executed after Phase 15 closeout,
with the same per-task ledger discipline the current build uses. The companion document
[2026-08-14-conductor-addendum-phases-16-19.md](../plans/2026-08-14-conductor-addendum-phases-16-19.md)
specifies it.

**The one exception:** §4.1's repo-hygiene half (conventions for this repository's own build
artifacts, plus a janitor script and a gate leg) touches no conductor source and can land whenever
you want it. It is Phase 16 in the addendum precisely so it can be pulled forward.

## 6. Configuration surface, all four features

All four default to preserving today's behaviour. Clarification is the only one that is off by
default; the other three default to on because they only add structure and records, and change no
decision the harness makes.

```jsonc
"clarify": {
  "enabled": false,           // OFF by default — autonomy is the documented stance (§6.2)
  "maxQuestions": 5,          // hard cap per run
  "refuters": 2,              // a question dies if a refuter answers it from the repo
  "onUnanswered": "block"     // "block" = stop with `surfaced` | "proceed" = record assumptions and continue
},
"artifacts": {
  "enabled": true,
  "root": ".conductor/artifacts",
  "dirs": { "analysis": "analysis", "scratch": "scratch", "logs": "logs",
            "stdout": "stdout", "plans": "plans", "reports": "reports" },
  "naming": "{ts}-{kind}-{slug}{ext}",
  "tsFormat": "YYYYMMDD-HHMMSS"
},
"janitor": {
  "enabled": true,
  "defaultLifetime": "ephemeral",
  "mode": "trash",            // "trash" | "delete" | "report-only"
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

## 7. Decisions — settled 2026-08-14

All four open questions this analysis raised are answered. The full text and rationale live in the
addendum plan's *Owner decisions* section; in brief:

1. **`clarify.enabled` defaults to `false`.** Autonomy wins, on the argument that a suboptimal
   autonomous decision still has adversarial plan review, six-lens item review, and the TDD gates
   left to catch it — the harness is a net of independent checks, not a single point of judgment.
2. **`onUnanswered` defaults to `block`**, with `proceed` available.
3. **`audit.level` defaults to `operations`.**
4. **Phase 16 is not pulled forward** — it shares no code with Phases 17-19, so its position changes
   nothing about the result, and landing it during the live build risks sweeping a deliberately
   staged deliverable and halting the shared gate.

---

## Appendix — evidence index

| Claim | Source |
|---|---|
| Six question origins, all post-hoc | [types.ts:87-95](../../conductor/core/types.ts#L87-L95) |
| Question ledger schema and unblock path | plan §2.11, lines 979-998 |
| Question ledger implementation | [adapter/questions.ts](../../conductor/adapter/questions.ts) |
| Plan-review lens (b), completeness vs prompt | plan §3.2, lines 1119-1131 |
| Human-territory whitelist and "Never ask" | plan §6.2, lines 1868-1879 |
| Ask-gate rejects sub-session questions | plan §3.5, lines 1415-1426 |
| Autonomy rationale for rejecting human approval | `conductor/DECISIONS.md` entry (c) |
| INTAKE legal-tool branch (insertion point) | [gates-phase.ts:341-362](../../conductor/core/gates-phase.ts#L341-L362) |
| Edit gate is total default-deny | [gates-edit.ts:185-244](../../conductor/core/gates-edit.ts#L185-L244) |
| `gates: allow` already in the vocabulary | [journal-events.ts:37](../../conductor/core/journal-events.ts#L37) |
| Config schema closed to new keys | [types.ts:659-673](../../conductor/core/types.ts#L659-L673) |
| Logging levels, sinks, retention | plan §7.1, lines 1907-1928 |
| Plan immutable; 48/55 committed; remaining path | [docs/build/HANDOFF.md](../build/HANDOFF.md) |
