# Step 2 — Enforcement & Correctness Review

**Read `docs/reviews/conductor-review/1-briefing.md` in full first.** It carries the orientation, the
environment and its traps, the rules of engagement, the P1–P13 defect taxonomy, the method, the
exhaustiveness doctrine, and what is already known. This prompt does not repeat any of it.

You are **step 2**, the first of three sequential reviews. You produce the factual substrate the other two
consume: the enumerations, the mutation table, and the reproduced defects. The macro review (step 3) and the capability review (step 4) will read your register and argue from it — so its completeness determines theirs.

**Output:** `docs/reviews/conductor-review/findings-enforcement.md` — the only file you may create outside scratch.

---

## Your question

> **Does the enforcement hold?** At every point where this harness could either *know* something or
> merely *believe* a model that told it, which is it? And is every check that enforces this capable
> of failing?

Plus the same question asked from outside, which matters because the system's whole value is that
somebody else can rely on its output:

> **Is the evidence conductor produces strong enough that a careful reader could accept it without
> re-deriving the work?** Where a verify record, a green, a review verdict or a published commit
> would not survive that scrutiny, say so — even if the harness is internally consistent.

Everything below serves those two questions.

---

## Part A — The enforcement enumeration

For **every** point where the model reports something, determine whether the harness independently
re-derives it or accepts the claim. At minimum: test went red · test went green · review passed ·
classification · decision · plan revised · finding refuted · item published · run complete · setup
succeeded · a stage was skipped legitimately.

For each, produce a row: **what is claimed · who claims it · what the harness does with it · file:line
· verdict (RE-DERIVED / PARTIALLY / ACCEPTED ON TRUST) · what a lying model would get away with.**

Where enforcement is merely **advisory** — the model could route around it — that is the finding
that matters most. Then answer explicitly:

> **If a competent-but-lazy local model were run inside this harness today, at which specific points
> could it produce plausible-looking but unverified work the harness would accept as real?**

Attack these specifically:

- **RED-before-GREEN.** The plan claims skipping is *structurally* impossible. Try to construct a
  path to GREEN without a genuine harness-observed RED: a test that errors instead of failing, a
  stub satisfying one assertion, a test weakened so a finding disappears, a red observed against a
  different subject than the one that goes green, a red from a previous attempt reused as proof.
- **Doctrine delivery (§6.4 / G9).** Each of the 7 roles must receive its §4.1 pack *every request*.
  Nine packs live in `conductor/doctrine/`. Apply **P6**: verify the doctrine ARRIVES at the
  sub-session, not merely that a guard refuses when it is absent.
- **The override hatch (§3.6).** Can a model spend its way around a gate? Is the budget bounded, and
  does exhaustion truly stop the run rather than converting into another override?
- **The gate snapshot.** `plugin/index.ts`'s `tool.execute.before` derives `fileScope`, `testScope`
  and `verifyInFlightTree` per call (recently changed — C-082). Verify the derivation for every role
  and both tree modes, and that every failure path derives NO scope (which denies) rather than a
  permissive default.
- **The evidence ledger.** Can a record be forged, reused, or attributed to the wrong item, run or
  tree? Does anything check a record's freshness against the call that claims it?

---

## Part B — The verification audit (mutate every check)

Turn the review on the checks themselves. This is the highest-yield activity in the whole review;
budget accordingly.

For every gate, scanner, guard, source-audit test and acceptance meter:

1. **Can it fail?** Mutate what it checks. If nothing goes red, it is decorative — that is a finding.
2. **Does it inspect what it claims?** (P1) Make it report its own coverage; compare to intent.
3. **Is its expected value independent of its subject?** (P2)
4. **Does it test refusal, not just acceptance?** (P5)
5. **Which assertion caught the mutation?** (P6) A precondition guard catching it leaves the
   downstream property unproven.

Named targets, not exhaustive: `scripts/test-conductor.sh` · `scripts/conductor-gate.sh` (M5) ·
`scripts/verify-acceptance.sh` (all 21 rows — mutate each row's subject and confirm the row fails) ·
the M1–M9 task gate as recorded in `GATES.json` · `legaltools-callsites.test.ts` ·
`journal-vocab.test.ts` · `tool-binding.test.ts` · `composition.test.ts` · `g5-artifact-check.ts` ·
every `*-vocab`/`*-callsites`/`*-binding` source audit.

**Re-derive a sample of the build's own gate claims.** Pick several tasks from `STATE.json`, apply
each one's recorded `revertAssertion`, and confirm the suite goes red exactly as claimed. Pick
security tests and confirm they fail when you weaken the gate. A `revertAssertion` that does not
produce the claimed red is a serious finding — it means the recorded evidence is wrong.

Produce a **mutation table**: every mutation applied, the file, what you expected, what happened,
and whether the check binds. This table is a required deliverable; the macro and capability reviews use it.

---

## Part C — Correctness, security, concurrency, crash-safety

Not every defect is about model trust. Ordinary bugs are yours too.

- **Security** (`core/gates-git.ts`, `gates-edit.ts`, `shell-parse.ts`): try to get a destructive git
  command or an out-of-scope edit past the gate. Attack the tokenizer — wrappers (`env`, `sudo`,
  `bash -c`), quoting (`$'…'`, backticks, `${}`), redirects (`>`, `>|`, `tee`, `sed -i`, `perl -pi`,
  `dd of=`), traversal (`..`), alias injection (`git -c`). The build claims to DENY the dangerous
  shapes and DOCUMENT the residuals (G7) — verify both, and hunt for an *undocumented* bypass.
- **State store & crash recovery** (`adapter/state.ts`, `journal.ts`, `evidence.ts`,
  `quarantine.ts`): torn writes, the advisory lock (dead-pid, over-age, TOCTOU), atomic tmp+rename,
  cross-filesystem `EXDEV`, crash-safe quarantine replay, no-clobber restore, out-of-repo isolation.
  **Simulate crashes rather than reasoning about them** — kill a write between tmp and rename in a
  scratch harness and see whether the next read heals or corrupts.
- **Fan-out concurrency** (`adapter/fanout.ts`, `router-client.ts`): the concurrency cap, the wave
  barrier, the per-job watchdog (does it bound `session.create` AND the prompt?), watchdog-vs-
  completion double-resolve, the freeze-hold (can a held write-capable job double-dispatch or
  strand?), the failover latch. Run the fan-out tests 10–20× as a flake sweep.
- **Resource handling:** leaked fds, leaked child processes, unbounded growth in any ledger or
  in-memory structure. One fd leak is already recorded (C-087, `serve.py`'s `log_handle`) — find the
  others.
- **The C++ router** (`router/`): build it, run ctest, read it against §4.4 — proxy pass-through
  verbatim including SSE, admission (cap → queue → 503 envelope), schema OBSERVATION never
  enforcement (never a 400 the direct path would not return — the G5 fail-soft direction), the
  metrics ledger. It is explicitly in scope and has had the least review attention of anything here.
- **Spec conformance**, clause by clause, for §2 schemas and closed vocabularies, §3 FSMs and gates,
  §4/§5/§6/§7. Apply **P10's** lesson: when checking against an identifier, count only identifier
  positions — the English form of a concept usually outnumbers it in prose.
- **Build-record honesty** (P9): do the recorded `commitSha`s exist and contain what is claimed? Is
  every "COMMITTED / PASS" true? Are the deferred and live-manual items disclosed honestly? Hunt
  specifically for fabricated evidence — the build's stated worst failure. Check every artifact under
  `docs/build/artifacts/` for the two-identical-arms shape.

---

## Part D — Vocabulary, reachability, composition

- **Vocabulary (P3).** Build the inventory: every closed enum, role name, tool name, journal event,
  stop kind, anomaly kind, failure class, filename, path, glob, schema key, env var. For each: name
  the OWNER and list every other site. Flag every restatement without a drift guard — *even where the
  copies currently agree*.
- **Reachability (P12).** Enumerate every branch requiring an unusual precondition — a failure, a
  cap, a timeout, a retry, a degraded mode, a second attempt, a crash — and find the test that
  reaches it. Report every one with none.
- **Composition (P7).** For every terminal, exit and escalation path, construct the state where each
  guard says "not mine" and ask who is left holding it. Does the run end with an artifact a human
  receives, or go quiet? The wedge (C-085) was exactly this and nothing else found it.
- **Acceptance rows (P8, P13).** Read every `docs/build/specs/*.assertions.json` row against the
  tests. Which are unreachable? Self-contradictory? Named by a title that does not prove them?

---

## Part E — The meta-audit

The build's quality rests on task gates, phase gates, blind lens fan-out, and skeptic panels with a
tie-upholds ladder. **That machinery has produced at least one confirmed false negative and sealed
it** (P10).

- Re-open every refuted finding in `GATES.json` and `artifacts/phase-gates-12-13-15-findings.md`.
  For each: what evidence settled it, and does that evidence actually discriminate?
- Can "empty findings = approval" be gamed? What does a lens that found nothing look like versus one
  that never ran?
- The ladder upholds on a tie. What happens when both skeptics share a blind spot, as they did in
  C-032 where both matched prose for contract?
- Do the phase gates verify that a fix round's author is not also the agent closing the gate?

---

## Part F — Simulate the adversary

Be the lazy model. With the doctrine packs as your only instructions, try to:
- reach PUBLISHED with the least real work,
- make a review finding disappear rather than fixing it,
- satisfy an acceptance row's letter while violating its intent,
- produce a plausible artifact for a step you did not perform,
- get a test to pass without the behaviour it names.

Record what you got away with, step by step, with `file:line`.

---

## Part G — Mandatory enumerations (the completeness forcing function)

Reading finds what you thought to look for; **enumerating with a per-item verdict finds what you did
not.** Produce each inventory **in full**, as a table, with a verdict for **every** row. "Not
examined" is permitted and is far better than silent omission — it marks where coverage ends.

1. **Every conductor tool** (22 in `CONDUCTOR_TOOL_NAMES`) — bound? reaches a committed handler? are
   its declared args the shape the handler needs? is there a test that drives it?
2. **Every role** (7 in §4.1) — which doctrine pack, params, headers, gate arm; is that arm reachable
   with the role name production actually registers?
3. **Every closed vocabulary** — owner, restatements, drift guard.
4. **Every gate and check** — what mutation makes it fail? If you cannot name one, it is decorative.
5. **Every assertion row** across `docs/build/specs/*.assertions.json` — named? proven? reachable?
6. **Every correction C-001…C-092** — does the same defect CLASS exist elsewhere, unfixed? This is
   mechanical and high-yield: the corrections are a map of how this system fails.
7. **Every branch requiring an unusual precondition** (P12).
8. **Every enforcement point** (Part A), as a table.
9. **Every file in `conductor/`, `router/`, `scripts/`** — covered or not, in the coverage ledger.

---

## Output

Write `docs/reviews/conductor-review/findings-enforcement.md`, structured per briefing §10 conventions:

1. **Executive verdict** (≤1 page) — does enforcement hold; where does the harness believe rather
   than know; is its evidence strong enough for someone else to rely on; your confidence and what
   most affects it.
2. **The ISSUE register** — every defect, full record per the briefing's field list, written
   explanatorily. This is the primary deliverable.
3. **The IDEA register** — every improvement thought, however small.
4. **CROSS-LENS POINTERS** — one line each for anything you noticed that belongs to the macro review (shape,
   organisation, design coherence) or the capability review (missing mechanisms). Do not chase them; do not drop
   them. The macro and capability reviews begin by reading these.
5. **The enforcement table** (Part A) and **the mutation table** (Part B) in full.
6. **All nine enumerations** (Part G) with per-item verdicts.
7. **The adversary log** (Part F).
8. **Honesty audit** — fabricated evidence found, or an explicit statement that you found none,
   naming what you checked.
9. **The coverage ledger** — every subsystem and file: what you did to it, how much you covered, what
   you concluded, which ids it produced. "Not examined" entries are expected and required.
10. **Cleared areas** — what you attacked and could not break, with the specific attacks named.

There is no length limit and no token budget. Write findings to the file incrementally as you go so
the work survives a context exhaustion. **The review is complete when every enumeration has a verdict
for every row and the coverage ledger accounts for every file in scope** — not when you have "enough"
findings.
