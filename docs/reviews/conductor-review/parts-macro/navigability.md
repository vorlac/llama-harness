# MACRO Review — Navigability & Organisation

**Lens:** Organisation, judged by the system's own standard (can a small, context-limited model
do good work here without being told where to look?)
**Reviewer:** step-3 macro reviewer (navigability scope)
**Date:** 2026-08-16
**Evidence base:** docs/reviews/conductor-review/findings-enforcement.md (step 2),
CORRECTIONS.md, direct measurement of the tree.

---

## Measurements

Token estimates use bytes/4 (a standard approximation for source code; real BPE tokenizers land
between bytes/3.5 and bytes/4, so these are mild UNDER-estimates). Measured 2026-08-16 at HEAD
(`wc -l -c`).

### 0.1 The file census (production source, conductor/)

| File | Lines | Bytes | ~Tokens |
|---|---|---|---|
| `conductor/adapter/tools.ts` | 9,253 | 371,683 | **~93,000** |
| `conductor/plugin/index.ts` | 1,427 | 66,185 | ~16,500 |
| `conductor/core/types.ts` | 1,414 | 42,184 | ~10,500 |
| `conductor/adapter/continuation.ts` | 1,382 | 56,271 | ~14,100 |
| `conductor/adapter/evidence.ts` | 896 | 34,956 | ~8,700 |
| `conductor/tools/replay.ts` | 885 | 34,360 | ~8,600 |
| `conductor/adapter/state.ts` | 768 | 30,002 | ~7,500 |
| `conductor/core/planning.ts` | 629 | 29,392 | ~7,300 |
| (29 further files, each ≤ ~5,600 tokens) | ~7,600 | ~316,000 | ~79,000 |
| **All conductor production source (36 files)** | **24,241** | **981,333** | **~245,000** |

### 0.2 The reference documents a task may need

| Document | Lines | Bytes | ~Tokens |
|---|---|---|---|
| The immutable plan | 3,399 | 230,986 | ~58,000 |
| `docs/build/CORRECTIONS.md` (C-001…C-092) | 4,610 | 328,987 | **~82,000** |
| `docs/build/STATE.json` | 2,289 | 147,244 | ~37,000 |
| `docs/build/GATES.json` | 1,730 | 185,901 | ~46,000 |
| `docs/build/HANDOFF.md` | 139 | 12,602 | ~3,200 |

### 0.3 The test files that pin behavior

| File | Lines | Bytes | ~Tokens |
|---|---|---|---|
| `conductor/tests/continuation.test.ts` | 5,024 | 219,926 | ~55,000 |
| `conductor/tests/e2e.test.ts` | 4,317 | 202,841 | ~51,000 |
| `conductor/tests/tools-9.4b.test.ts` | 3,432 | 167,645 | ~42,000 |
| `conductor/tests/composition-root.test.ts` | 3,235 | 155,014 | ~39,000 |
| `conductor/tests/setup.test.ts` | 3,150 | 142,486 | ~36,000 |
| `conductor/tests/tools-9.5b.test.ts` | 2,731 | 127,445 | ~32,000 |
| (34 further test files) | ~39,800 | ~1,811,000 | ~453,000 |
| **All tests (40 files)** | **61,699** | **2,826,949** | **~707,000** |

Headline ratios against a 32k-context model (leaving ~8k for the task prompt, its own output,
and tool overhead, so ~24k of readable budget):

- `tools.ts` alone is **~3.9× the model's entire readable budget**.
- The plan alone is ~2.4×. CORRECTIONS.md alone is ~3.4×.
- The single biggest test file that pins publish behavior (`tools-9.5b.test.ts`) is ~1.3×.
- Total source+tests+plan+corrections ≈ 1.09M tokens — **~45 full context windows.**

### 0.4 The discoverability map — it EXISTS, and this review measured it

Before the task walkthroughs: the answer to "is there a discoverable path from *I need to change
X* to the file owning X" is **yes, for eleven task classes** — a fact the step-2 evidence base
never mentions. `docs/developer/extending.md` (529 lines, 35,743 B, ~8.9k tokens) is a genuine
concern→file map with per-recipe "Files, in order" lists: add a tool, add/change a gate rule, add
a doctrine pack, add a review lens, add a role, add a schema, add a router module, add a verify
ecosystem, add a model, add a preset, adapt the workflow. The path to it is
`README.md` (22,035 B, ~5.5k) → `docs/developer/README.md` (10,427 B, ~2.6k) → `extending.md`,
and each recipe section is ~40–70 lines (~700–1,200 tokens) once found. The developer guide also
carries a subsystem index (state-machines, gates, evidence, scheduling, doctrine, schemas), so
"which page owns concern X" is one 2.6k-token read.

The map's three measured failures are what the MACRO records below are about: (1) its
destinations are un-readable once you arrive (`tools.ts`); (2) it *documents structural traps
instead of the structure removing them* — its own "The trap" paragraphs are step-2 defects
restated as advice; (3) parts of it are stale (the `src/` tree it maps for layer 2 does not
exist).

### 0.5 Representative-task read costs (the charter's core question)

Method: for each task, the minimal set of reads a model must perform to make the change
*safely* — meaning: without recreating a defect class already in CORRECTIONS.md, and knowing
which tests pin the behavior. Token figures from §0.1–0.3 (bytes/4). "Scoped read" assumes the
model already knows the line range; the cost of *learning* the range (greps + probe reads) is
listed separately as overhead, estimated at 10–20% for a grep-capable agent.

**Task A — add a `conductor_*` tool** (extending.md has a recipe; 5 files named in order).

| Read | Tokens |
|---|---|
| Path to the recipe (README → dev README → recipe section) | ~8,800 |
| `core/gates-phase.ts` whole (legality row) | ~5,600 |
| `core/tool-bindings.ts` whole | ~2,300 |
| `core/journal-events.ts` whole | ~1,600 |
| `tools.ts` scoped: preamble 1–648 (deps types, shared helpers) + one exemplar handler (`handleDefer`, 1153–1326) + append-region context | ~10,000–13,000 |
| `plugin/index.ts` scoped: the `specs` region | ~1,000 |
| Test exemplars: `gates-phase.test.ts` (20,979 B) + ~300 lines of a `tools-*.test.ts` | ~8,200 |
| **Total** | **~37k–40k + overhead** |

**Verdict: does NOT fit 32k**, even with the repo's best-case discoverability (a written recipe
naming every file in order). The overflow is entirely attributable to two things: the 93k-token
destination file forcing exemplar-mining instead of module-reading, and test exemplars living in
multi-thousand-line task-numbered files. A disciplined agent can squeeze this under 32k by
skipping the path (told where to go), reading no exemplar test whole, and trusting the recipe —
i.e., exactly the "handed exact line ranges" regime the build campaign ran.

**Task B — change a gate arm** (e.g. add a deny row to the git gate; extending.md recipe).

| Read | Tokens |
|---|---|
| Recipe section | ~1,000 |
| `core/gates-git.ts` whole (486 ln) | ~4,800 |
| `core/shell-parse.ts` whole (484 ln — the recipe's trap says detection sees through the parse, so the parser is required reading) | ~4,500 |
| `tests/gates-git.test.ts` whole (619 ln) | ~7,400 |
| `conductor/docs/HONEST-LIMITS.md` (a gate change can falsify a disclosure; ops-docs.test.ts binds 25 rows) | ~1,500 |
| **Total** | **~19k** |

**Verdict: FITS comfortably.** The pure-core gate modules are the repo's best-decomposed region:
single-concern files of 400–500 lines, a same-named test, a recipe, and a table-row-as-test
discipline. This is what "right-sized for a 32k model" looks like, and it exists *in this repo* —
the contrast with Task A is a measurement of the same codebase at its two extremes.

**Task C — add an assertion row and prove it.**
The documented convention (`docs/developer/testing-and-verification.md:418`: "`coveredByTest`
starts null and is filled with the exact test name") is the convention the build *abandoned* —
548 of 795 rows are null, 34 of 60 ledgers entirely so (step-2 ISSUE-081), and the practiced
convention (row id in the test *title*) is documented nowhere and unenforced (118 rows named
nowhere, ISSUE-132/-133). So the honest read set is: the doc (~10.6k tokens for
testing-and-verification.md) + a sample spec file + **a repo-wide grep per row** to learn which
convention the neighboring rows actually use, with a real chance of following the documented-but-dead
one. **Verdict: fits in tokens (~15k), fails on determinism — two models doing this task will
pick different conventions, and the gate catches neither** (M7 checking stopped at task 11.8,
ISSUE-083).

**Task D — fix a handler bug** (concretely: step-2 ISSUE-046, publish's `hasStagedDeletion`).
No recipe exists for "fix a handler bug" — the most common task shape in the 92-correction record.

| Read | Tokens |
|---|---|
| Find the handler: `grep handlePublish` → 1 production hit | ~0 (cheap) |
| `handlePublish` scoped (tools.ts 6795–7416, 622 ln) | ~6,200 |
| `core/freshness.ts` whole (the flag's consumer) | ~2,200 |
| `adapter/evidence.ts` scoped (verify-record shape, `readEvidenceAt`) | ~2,500 |
| Find the pinning tests: publish behavior is pinned across `tools-9.5b.test.ts` (~32k tokens — **bigger than the whole budget**), `publish-commit-integrity.test.ts` (~6.9k), `publish-legality-before-persist.test.ts` (~4.7k); scoped grep-guided reads | ~6,000–10,000 |
| **Total** | **~17k–21k** |

**Verdict: fits, but only grep-first**, and the test-side navigation is the weak half: the
knowledge "9.5b = publish" is encoded in a filename by *construction order*, discoverable only by
opening the file and reading its header comment. A model that cannot afford to open five 100–220KB
test files to learn which one pins publish depends on grep hit-quality alone.

**Task E — add a stop kind** (a one-word closed-vocabulary change).
Measured fan-out: `core/types.ts:39` + `core/stops.ts:12` + `adapter/continuation.ts` (writers) +
report rendering in `tools.ts` + `scripts/conductor_bench.py:79` (hand copy, comment says
"verbatim") + `scripts/test_conductor_bench.py:1169` (a fourth hand copy in an assertion) — **3
languages, 6 files**, none derivable from another (step-2 ISSUE-113/-115/-120). The copies are
findable only by repo-wide grep of the *value* (`"noop"`), not the concept. **Verdict: the token
cost is small (~8k of scoped reads) but the task is unsafe by construction for any model that
does not already know all six sites exist: missing the python pair produces no red until the 14.2
campaign crashes live.**

**Summary table:**

| Task | Recipe exists? | Read cost | Fits 32k? | Failure mode if under-read |
|---|---|---|---|---|
| A: add a tool | yes | ~37–40k | **NO** | handler misses one of its 4 obligations; audit-blind tail (ISSUE-088) |
| B: change a gate arm | yes | ~19k | yes | — (best case in repo) |
| C: add an assertion row | doc is stale | ~15k | yes, but nondeterministic | row proven by nothing (118 precedents) |
| D: fix a handler bug | **no** | ~17–21k | yes, grep-first | pinning test not found; publish has 3 pinning files |
| E: change a vocabulary | no | ~8k | yes | silent — a live crash months later (ISSUE-113) |

The pattern: **token cost is survivable everywhere except tools.ts-centric work; the real 32k
killer is that safety knowledge (which tests pin X, which copies of X exist, which convention is
live) is positional, not indexed.**

---

## Findings (NAVIGABILITY-001 …)

### NAVIGABILITY-001 — `tools.ts` at ~93k tokens is above every reader's budget, including the build's own machinery; the seams for splitting it already exist and are measured

**THE OBSERVATION.** `conductor/adapter/tools.ts` is 9,253 lines / 371,683 bytes / ~93k tokens —
3.9× a 32k model's readable budget, and 22 exported `handle*` functions (not the ~15 the step-2
pointer estimated; measured by `grep -n "function handle"`). The handler boundaries are clean and
knowable:

| Region | Lines | ~Tokens |
|---|---|---|
| Shared preamble (tool names, deps types, plumbing) | 1–648 | ~6.5k |
| Intake: classify/status/decide/surface/answer/defer | 649–1326 | ~6.8k |
| Planning: decompose/plan/plan_review | 1327–3075 | ~17.5k |
| TDD: submit_test/vet_test/mark_green/validate | 3076–4709 | ~16.4k |
| Wave: queue_amend/dispatch_wave | 4710–5982 | ~12.7k |
| Review: item_review | 5983–6794 | ~8.1k |
| Publish + report | 6795–7738 | ~9.4k |
| Hatches: inline_claim/override | 7739–8039 | ~3.0k |
| Setup + ~50 setup-private helpers/constants | 8040–9253 | ~12.1k |

Every region except planning and TDD fits a 32k model *with* its core dependencies; even those
two fit alone.

**THE CONSEQUENCE — four, all already paid, none hypothetical.**
1. **The build's own review machinery could not read it.** Step-2 §10.8: no single lens read all
   9,253 lines; the file had to be split across two lenses at line 5515/5517, and "seam defects
   between distant regions are why several findings (ISSUE-005, -008, -088) were invisible to
   single-region reads." GATES.json (lines 1300/1456/1536) records that phase-gate lenses were
   given "exact line ranges rather than the plan" — a per-task range-precomputation cost paid by
   a larger-context orchestrator for the entire campaign.
2. **The system serializes work on itself.** `docs/developer/extending.md:77–80` states it
   outright: "Every handler lives in one file. Two queue items that each add a tool therefore
   share a `fileScope` … Tool work lands serially. That is a cost of the single-file layout, not
   a bug in the scheduler." Conductor's own wave scheduler cannot parallelize conductor's most
   common change class. The dogfooding penalty is admitted in the repo's own documentation.
3. **The audit layer breaks precisely at the file's growth edge.** ISSUE-088: `stripComments`
   blanks lines 9104–9254 — the tail where new handlers are appended — so "new handlers appended
   after 9104 are born unaudited by both the journal-vocab and legaltools-callsites audits."
   Blast radius of that bug is a direct function of one file carrying everything: in a split
   layout the same defect blanks one region of one small file.
4. **Task A above measures ~37–40k tokens to add a tool safely** — the one task class the repo
   most needs small models to do (the §8 manifest routed most of its 52 tasks through this file's
   concerns).

**WHY IT IS STRUCTURAL NOT LOCAL.** No instance-fix exists: the file *is* the instance. A large
share of the step-2 register cites tools.ts (the §10.2 ledger row lists ~30 ISSUE ids against
it), and every local fix leaves the next defect's two halves 8,000 lines apart. The
three-files-far-apart shape that hid ISSUE-002 (tools.ts:2362 + plugin/index.ts:1356 +
gates-edit.ts:128 each holding a third of the slug/path contract) is the same shape *within*
this one file between its regions.

**WHAT A BETTER SHAPE LOOKS LIKE.** `conductor/adapter/handlers/` with 8–9 modules along the
measured region boundaries above, plus `shared.ts` for the preamble; `CONDUCTOR_TOOL_NAMES` and
the deps type stay single-owner in `shared.ts` (or move to `core/tool-bindings.ts`, which already
owns the binding map). **Migration cost, measured:** 26 files import from `adapter/tools.ts` (2
production — `plugin/index.ts`, `continuation.ts` — and 24 tests), 45 import statements total;
the repo's no-re-export rule (`.claude/rules/patterns-and-conventions.md`) forbids a barrel, so
all 45 must be repointed — mechanical, compiler-verified by the gate's `tsc --noEmit` leg. The
two source audits need their tools.ts coupling widened: journal-vocab.test.ts already walks
`productionFiles()`, so only its anti-vacuity floor `MIN_SITES_IN_TOOLS` (asserted around line
233) is file-name-coupled and must become per-directory. extending.md's recipe and its
serialization trap get rewritten (the trap *disappears*: tool work parallelizes when handlers
live in separate files, which the wave scheduler then permits). Estimated at one focused task
with the full gate as the net; the risk is interstitial module-scope helpers shared between
adjacent handlers (measured low: the 8040–9253 region's ~50 helpers are all `setup`-prefixed and
setup-private; spot-checks between other regions show handler-local constants). Do it BEFORE
wiring ISSUE-001/-002 fixes if both are scheduled, so the fix lands in a file a reviewer can
read.

**PLAN IMPACT.** None on the immutable plan's semantics — §1.1's module layout is already
recorded stale (briefing §0); the plan names no file sizes. The §8 manifest's "tool handler(s) in
`adapter/tools.ts`" (plan:2563) becomes a recorded deviation, joining the existing layout
deviations.

**WHAT WOULD CHANGE MY MIND.** Evidence that region-crossing shared state is dense — e.g. a
measurement showing dozens of module-scope symbols referenced across non-adjacent handler
regions (I spot-checked and found handler-local patterns, but did not exhaustively
cross-reference all module-scope symbols). Or a demonstrated gate property that depends on
single-file scanning and cannot be re-pointed. Absent those, the finding stands on the four paid
consequences.

### NAVIGABILITY-002 — The map documents traps instead of the structure removing them: extending.md's "The trap" paragraphs are step-2 defects restated as advice

**THE OBSERVATION.** Of the eleven recipes in `docs/developer/extending.md`, at least four carry
a "trap" paragraph that is a live step-2 finding in prose form:
- "Add a role" trap (lines ~227–231): "The same role has three spellings … three of the four
  lookups fall back silently on a miss — you get `core.md`, temperature 0.4, and `interactive`
  priority with no error anywhere." That is ISSUE-121 (role vocabulary has no owner,
  typo-absorbing fallbacks), described *accurately*, handed to every future contributor as a
  hazard to memorize.
- "Add a doctrine pack" trap (~150–154): "`REQUIRED_PACKS` and `ROLE_PACKS` are different lists,
  and only the first is fail-closed … Adding it to neither and referencing it from `ROLE_PACKS`
  gets you a silently skipped pack." That is ISSUE-114, reproduced by step-2 mutation MUT-1b
  (green everywhere).
- "Add a tool" trap (~77–80): the single-file serialization cost (NAVIGABILITY-001).
- "Add or change a gate rule" trap (~114–119): the `guarded`-flag fail-open shape — the same
  attribution blindness behind ISSUE-014/-018 ("a new gate guarding something the flag cannot
  see fails *open* on a crash").

**THE CONSEQUENCE.** The documentation is *honest* — to its credit, and it made this review
cheaper — but each documented trap is a permanent per-task tax: the safe read set for "add a
role" includes memorizing a three-spellings table precisely because no type or test owns it. The
build already paid this tax at full price: C-082 (the `testWriter`/`test-writer` gate arm never
reachable, survived a unanimous skeptic refutation, P10's origin) is the trap in the "Add a
role" paragraph *happening to the build itself*. Writing the trap down did not stop the class:
step-2 finds the fallbacks still typo-absorbing at HEAD (ISSUE-121).

**WHY IT IS STRUCTURAL NOT LOCAL.** A trap paragraph is the documentation layer compensating for
a missing owner in the structure layer. Fixing any one instance (e.g. `export const ROLES` typed
`Record<Role,…>`, ISSUE-121's own fix direction) deletes its paragraph; the *pattern* — the map
absorbing what the types should refuse — recurs at every unowned vocabulary (step-2 enumeration
7.3 counts the unguarded restatements) and will accrete new paragraphs as the system grows.

**WHAT A BETTER SHAPE LOOKS LIKE.** A standing rule for extending.md: **a trap paragraph is a
defect record, not documentation** — each one either names the issue that will delete it or
justifies why the structure cannot own it (the "Add a schema" recipe's `additionalProperties`
paragraph is the legitimate kind: a genuine design tradeoff, not a missing owner). Migration
cost: near-zero for the rule; the paragraph-deleting fixes are already filed as step-2 fix
directions (ISSUE-114/-121 are each a few lines plus a test).

**PLAN IMPACT.** None; extending.md is post-plan documentation.

**WHAT WOULD CHANGE MY MIND.** A demonstration that any of the four traps cannot be structurally
removed without violating a G-invariant — e.g. if typing the role tables broke the plugin's
string-typed wire boundary in a way `Role`-narrowing cannot handle. I could not construct such a
reading; the fallbacks exist because `?? default` was cheaper than a typed map, not because the
boundary demands strings.

### NAVIGABILITY-003 — Both top-level maps chart a layer-2 tree that does not exist, and nothing binds any map to the tree

**THE OBSERVATION.** The C++ router lives in top-level `router/` (verified: `ls -d src router` →
only `router`; briefing §0 records the plan's §1.1 layout as stale on exactly this point). Yet:
- `README.md:261–265` ("Repository layout") maps `src/ → main.cpp, router/, tests/,
  tools/membench/` — a `src/` tree that does not exist.
- `README.md:309–311` states the include rule as "relative to `src/`" and says clang-format runs
  "over `src/`".
- `docs/developer/README.md` ("Where the code lives") repeats the same `src/` block, in the
  section a newcomer is told to read first.
- `docs/developer/extending.md` "Add a router module" says files go "under `router/`" (correct)
  and two paragraphs later "`src/` is the only user-code include root" (stale;
  CMakeLists.txt:75–101 sets the include root to `${CMAKE_CURRENT_SOURCE_DIR}` — the repo root —
  which is *why* `#include "router/config.hpp"` still works).
- `CMakeLists.txt:17` still names the project `myprogram` (the step-2 cross-lens pointer notes
  DECISIONS.md documents its removal).

`ops-docs.test.ts` binds 25 rows of OPERATIONS.md / HONEST-LIMITS.md; **no test binds any layout
map to the tree** — these stale claims survive the full gate and every future hoist will
recreate them.

**THE CONSEQUENCE.** A context-limited model doing any layer-2 task and trusting the prescribed
entry points (the README layout block; the developer guide's first section) starts by listing a
directory that is not there. Recovery is cheap for a human and expensive for a 32k agent — and
worse, the two authoritative maps agree with each other while disagreeing with the tree, the
worst calibration case (corroborated wrongness). This is realized drift, not risk: the hoist
already happened during the build (STATE.json's 11.8 row records "pre-hoist `src/`" paths —
ISSUE-084's neighborhood).

**WHY IT IS STRUCTURAL NOT LOCAL.** The instances are four text edits — if that were all, this
would be an ISSUE. The structural half: the repo's doc-accuracy mechanism (phase 15 / the
ops-docs rows) binds *operator* docs only; the *navigational* docs — the ones the small-model
thesis depends on most — have no drift guard at all, and the build's own record proves maps rot
here within weeks of a layout change. Any future move recreates the class silently.

**WHAT A BETTER SHAPE LOOKS LIKE.** (a) Fix the four instances (minutes). (b) Extend the
ops-docs pattern with a few rows binding the layout blocks: every path named in README's layout
fence and dev-README's "Where the code lives" fence must exist (extract fence paths, `existsSync`
— ~30 lines of test). (c) `project(myprogram` → a real name (one line; DECISIONS.md already
records the intent). Migration cost: under an hour, no plan contact.

**PLAN IMPACT.** None. The plan's own §1.1 staleness is a recorded known-open; this finding is
about the *derived* maps that were supposed to be current.

**WHAT WOULD CHANGE MY MIND.** If `src/` existed on some branch or were generated at configure
time — checked: it is not. The paths either exist or they do not.

### NAVIGABILITY-004 — The build record is structurally unreadable at 32k: the prescribed cold boot exceeds the context before any source is read, and the record's own index fields are dead

**THE OBSERVATION.**
- The prescribed cold-boot order (HANDOFF → STATE.json → NOW.md) costs ~3.2k + ~37k + ~1.1k =
  **~41k tokens — 1.7× a 32k model's readable budget, before opening one source file.**
- CORRECTIONS.md — "after the plan, the most valuable document here" (briefing §0) — is one
  4,610-line, ~82k-token file with **no index**: 92 entries findable only by scroll or grep;
  entry headers carry no file list, so "which corrections touched publish?" is a full-file scan.
- The record's one machine-readable index — `coveredByTest` on the 795 assertion rows — is null
  on 548 (69%), and the convention that replaced it (row id in the test title) is undocumented
  and unenforced (ISSUE-081/-132/-133); `docs/developer/testing-and-verification.md:418` still
  documents the dead convention as current.
- Four record surfaces describe four different presents (ISSUE-082); the M1–M9 ledger ends
  silently at 11.8 (ISSUE-083).

**THE CONSEQUENCE.** Two, both already realized. (1) Step-2's P10 re-litigation of C-030 E12
"required re-running mutations from scratch" because refutations are one prose line inside the
82k-token file (ISSUE-079) — the record cannot answer questions about itself at any affordable
context size. (2) The phase-13 adjudicator inferred "nothing tests them" from `coveredByTest`
nullness — "true and corroborated there, false for task-14.1 (33/33 covered)" (ISSUE-081): a
*large*-context reader was already misled by the dead index; a small one has no chance of making
the cross-check that caught it.

**WHY IT IS STRUCTURAL NOT LOCAL.** The individual staleness items are ISSUE-073/-078/-081/-082/
-083 and fixable row by row. What is structural: **the record has no read-path budget and no
index contract.** Every surface is append-scaled (CORRECTIONS.md grows ~890 tokens per entry;
STATE.json ~670 per task), so every number above worsens monotonically with the build's own
progress, and no mechanism — gate row, freshness stamp, index file — is charged with keeping any
read path under any size. A record produced by a small-model project that can only be read by a
large model is a thesis-level inconsistency, the same genus as ISSUE-001.

**WHAT A BETTER SHAPE LOOKS LIKE.** Not a rewrite — an index layer: (a) a generated
`docs/build/CORRECTIONS-INDEX` (id · title · files touched · defect class, one line each — ~2k
tokens total, regenerable by script); (b) STATE.json task rows pointing at the corrections that
touched them; (c) HANDOFF stays the sole ≤4k-token boot document and *names* the index; (d)
adopt step-2's IDEA-ROW-1 (row-id→test-title checker), which turns the practiced convention into
the enforced index, then retire `coveredByTest` or repopulate it mechanically. Migration cost:
one scripting task plus one doc edit; the ledger stays append-only (the index is derived).

**PLAN IMPACT.** None; the plan does not specify the build record's shape, and the "docs
describe the design" doctrine is untouched — an index is not status prose.

**WHAT WOULD CHANGE MY MIND.** An explicit decision that build-record archaeology is a
large-model/human task. That would be defensible (the record is a build artifact, not a runtime
surface), and would downgrade this to an IDEA. But the project's stated posture — the record as
the field guide for the agents doing the work (briefing §0) — implies context-limited readers.

### NAVIGABILITY-005 — Test files are named by construction order, not subject: the suite's map is a memory of the build campaign

**THE OBSERVATION.** The ten `tools-9.*.test.ts` files (19,215 lines, ~478KB, ~120k tokens
combined) are keyed by *build-task number*; the subject is recoverable only from a header
comment ("Task 9.4b RED tests … SUBJECT: the THREE Phase-9 handlers…"). The mapping a maintainer
needs — publish is pinned in 9.5b + `publish-commit-integrity.test.ts` +
`publish-legality-before-persist.test.ts`; mark_green/validate in 9.4b; item_review in 9.5a; the
wave driver in 9.4c — exists in no file and is reconstructed per task (Task D's measurement).
Newer tests use subject names (`gates-git.test.ts`, `fanout.test.ts`), so the suite carries two
naming regimes, split along the same historical line as the assertion-ledger convention change
(ISSUE-081: convention switched around 9.2).

**THE CONSEQUENCE.** For a 32k model, "which tests pin the behavior I am changing" is the single
most load-bearing safety question (the gate is the enforcement backbone), and it is answerable
only by grep-and-hope across ~707k tokens of tests. Step-2's ISSUE-132 measured the realized
cost: 20 of 42 rows in 13.1 untraceable by id, 16 proofs unfindable *from the ledger*; producing
that mapping once required reading the 51k-token e2e file in full, and the mapping went into a
review artifact rather than the repo — so the next reader pays the full price again.

**WHY IT IS STRUCTURAL NOT LOCAL.** Renaming one file is local; the structural fact is that the
suite's organization mirrors the *producer's* frame (the 52-task manifest) rather than the
*maintainer's* frame (the subject being pinned), and the two-regime split makes the scheme
non-inferable — a model cannot learn "tests are named by task" or "by subject" because both are
true.

**WHAT A BETTER SHAPE LOOKS LIKE.** Cheapest first: (a) a generated `conductor/tests/MAP.md` —
file → SUBJECT line (the header comments are uniformly present, so extraction is mechanical) →
modules asserted — regenerated by a gate leg the way schemas are (~40-line script); (b)
opportunistic renames to subject names as files are next touched (the no-compat rule makes each
a sed-plus-gate operation; STATE.json's historical `filesTouched` stay historical). Migration
cost of (a): one small task, zero test edits.

**PLAN IMPACT.** None. The §8 manifest naturally produced task-numbered files; the plan does not
require the naming.

**WHAT WOULD CHANGE MY MIND.** If M7/phase adjudication mechanically required filename = task
id. Checked: M7 maps rows to *test titles*, and GATES.json cites titles; the filename carries no
mechanical role.

### NAVIGABILITY-006 — Cross-language vocabulary changes are grep-complete or silently wrong: small in tokens, unbounded in risk

**THE OBSERVATION.** Task E's measurement: a one-word stop-kind change touches 6 files in 3
languages (`types.ts:39`, `stops.ts:12`, continuation.ts writers, tools.ts report rendering,
`conductor_bench.py:79` — a hand copy whose comment says "verbatim" — and
`test_conductor_bench.py:1169`, a fourth hand copy inside an assertion). None is derivable from
another. The generalized inventory is step-2's enumeration 7.3: of ~26 closed vocabularies, the
unguarded or one-directional restatements outnumber the guarded ones, and the repo's two
exemplary guards (single-source.test.ts; composition.test:823) are hand-built one-offs.

**THE CONSEQUENCE — the navigational one, on top of step-2's correctness ones.** The copies are
findable only by grepping the *value*, not the concept: `grep STOP_KINDS` finds 4 of 6 sites;
the continuation writers spell values (`"noop"`). C-082 — the build's costliest single defect
(P10's origin) — was exactly a value-spelled copy (`"test-writer"`) that a concept-grep missed
and a frequency count mis-adjudicated. This is the only task class in §0.5 whose verdict cannot
be fixed by reading more: **no token budget makes Task E safe, because safety requires an
enumeration the structure maintains nowhere.**

**WHY IT IS STRUCTURAL NOT LOCAL.** The micro findings (ISSUE-113/-115/-120/-121) fix copies
pairwise; the class regenerates with every new vocabulary (ISSUE-119, quoting `conductor-gate.sh:63`'s own
confession: "the one-rule-in-two-places pattern that has already drifted six times"). What this lens adds is the
measurement that the read set for safety is *unknowable in advance* — a category difference from
NAVIGABILITY-001's "knowable but too big".

**WHAT A BETTER SHAPE LOOKS LIKE.** Step-2's IDEA-STRUCT-6 (vocabulary registry + parity
harness) is the fix, endorsed here *as the navigability fix too*: a registry is an index.
Migration is per-vocabulary and incremental — the exported-schema derivation for python
STOP_KINDS (ISSUE-113's fix direction) is the worked example, one test each.

**PLAN IMPACT.** §2's closed vocabularies unchanged; the plan mandates the vocabularies, not
their hand-restatement.

**WHAT WOULD CHANGE MY MIND.** Nothing about the observation (the sites were enumerated); the
severity drops if the 14.2 campaign consumes the exported `Run.schema.json`, which removes the
highest-consequence consumer of a missed copy.

### NAVIGABILITY-007 — OPINION: `scripts/` interleaves two products under one name, and the boundary is written down nowhere a model would look first

Labelled an OPINION per the charter: I hold a boundary enumeration but no defect whose *cause*
is the interleaving, and one mitigation already exists (`scripts/README.md`, 440 lines,
documents the benchmark half).

The observation: `scripts/` holds 15 files spanning the conductor harness (serve.py's router
half, conductor_wiring.py, conductor_bench.py, the three gate shells, the two test files) and
the pre-existing model-benchmark product (fetch_models.py, benchmark.py, bench_presets.py,
models_catalog.py, hostinfo.py, ui.py), with serve.py belonging to both. The python gate covers
only the conductor half (ISSUE-109: zero coverage on the benchmark half serve.py depends on);
M5 scans no `*.sh` (step-2 IDEA-GATE-2). My addition is only navigational: neither README's
layout line ("scripts/ — Python harness (serve, fetch, benchmark) + the test gates") nor
scripts/README.md states which files the conductor gate protects, so a model editing
fetch_models.py gets no signal that it has left the tested region. Cheap fix: a two-list
paragraph in scripts/README.md plus a gate-scope note at the head of each untested file.
Anything stronger (moving files) needs evidence I do not have.

## IDEA entries

### IDEA-NAV-1 — A generated code map: file → owns → size, kept green by the gate

Origin:     computing §0.5's read costs by hand; every number in it could be emitted by a script.
Kind:       tooling
Value:      a ≤1k-token `MAP.md` (path, one-line ownership, line/token count, "tested by") is the
            single highest-leverage artifact for a 32k agent: it converts "repo-wide grep" into
            "one small read". The SUBJECT header comments in tests and the handler-name grep make
            it mechanically derivable today.
Cost:       one small task (a ~60-line generator + a gate leg, same pattern as export-schemas).
Relates to: NAVIGABILITY-001, -005; step-2 ISSUE-132/-133.

### IDEA-NAV-2 — CORRECTIONS index + per-entry file lists

Origin:     NAVIGABILITY-004; trying to answer "which corrections touched publish?" without an
            82k-token read.
Kind:       docs/tooling
Value:      P10 re-litigation and future defect-hunting become greppable by file and class.
Cost:       one script pass over the 92 entries (headers are uniform enough to parse).
Relates to: NAVIGABILITY-004; step-2 ISSUE-079, IDEA-PROC-1.

### IDEA-NAV-3 — extending.md recipes for the two missing task shapes

Origin:     Task D measurement — "fix a handler bug" has no recipe though it is the dominant
            shape in the 92-correction record; "change liveness/continuation behavior" likewise.
Kind:       docs
Value:      the two recipes would name the pinning-test map (Task D's weak half) and the
            idle-engine's three-engine layout, the two places a cold agent flounders.
Cost:       an hour each, by someone who has just done one.
Relates to: NAVIGABILITY-005; step-2 cross-lens pointer on continuation.ts.

### IDEA-NAV-4 — Bind the layout maps with existsSync rows

Origin:     NAVIGABILITY-003.
Kind:       test-maintainability
Value:      layout drift becomes a red instead of corroborated wrongness; ~30 lines, ops-docs
            pattern already in-repo.
Cost:       trivial.
Relates to: NAVIGABILITY-003.

### IDEA-NAV-5 — Update testing-and-verification.md:418 to the practiced row convention

Origin:     Task C — the doc teaches the abandoned `coveredByTest` convention as current.
Kind:       docs
Value:      removes the nondeterminism in Task C; pairs with IDEA-ROW-1 (step 2) which makes the
            practiced convention enforced.
Cost:       one paragraph.
Relates to: NAVIGABILITY-004; ISSUE-081.

### IDEA-NAV-6 — A "read budget" line in future agent briefs instead of line ranges

Origin:     GATES.json's "exact line ranges rather than the plan" method note.
Kind:       process
Value:      after NAVIGABILITY-001's split + IDEA-NAV-1's map, briefs can say "read the map,
            then the owning module" — the range-precomputation step (an orchestrator cost paid
            per delegated task, all campaign) disappears. A measurable before/after exists: count
            range citations in briefs pre- and post-split.
Cost:       free once its dependencies land.
Relates to: NAVIGABILITY-001; IDEA-NAV-1.

## CROSS-LENS POINTERS (for the capability review)

- **The dead §6.4 state block is also the navigation mechanism** (ISSUE-001): the
  "recommended-next-tool" live block is the runtime analog of IDEA-NAV-1's static map — the one
  mechanism that tells a 32k model where it is without it reading anything. When weighing
  ISSUE-001's fix, count this second role: injection is not just doctrine delivery, it is the
  only affordable navigation a small model gets at runtime. [NAVIGABILITY-001/-004 context]
- **Sub-file scope is a missing mechanism**: conductor's decomposition granularity is bounded by
  file granularity (`fileScope` globs), which is why the single-file layout serializes tool work
  on itself (extending.md's admitted trap). Even after a tools.ts split, any large file recreates
  the bound. A line-range or symbol-level claim mechanism — or simply a doctrine/planning rule
  "split files that exceed N tokens before decomposing work on them" — would raise the floor.
  [NAVIGABILITY-001]
- **A repo-size budget as a gate row**: nothing stops any file from growing past every reader's
  budget again (tools.ts grew monotonically across 50 tasks with no alarm). A gate leg failing
  when a production file exceeds ~2k lines — or requiring a recorded waiver — is the structural
  version of this whole review. [NAVIGABILITY-001]
- **The vocabulary registry (IDEA-STRUCT-6) doubles as an index**: when evaluating it, score its
  navigation value (the copies become enumerable) alongside its drift value. [NAVIGABILITY-006]
- **For the enforcement re-run list**: nothing in step 2 measured whether the *e2e fake-SDK
  harness itself* is discoverable/learnable — e2e.test.ts is 51k tokens and its harness
  conventions (canned replies, fixture writers) are the price of adding any e2e row (several
  step-2 fixes require new e2e rows). If a capability proposal depends on "add an e2e row", its
  real cost includes learning that harness; consider whether the harness deserves its own
  extraction + MAP entry. [NAVIGABILITY-005-adjacent]

## Disposition of step-2's pointers addressed to this lens

| Step-2 pointer | Disposition |
|---|---|
| "tools.ts is 9,253 lines carrying ~15 handlers + setup + HTTP plumbing; seam defects invisible because files far apart" | Taken up as NAVIGABILITY-001; corrected the count (22 handlers, measured); added the two consequences step 2 did not have (self-serialization admitted in extending.md; the ~37–40k-token Task A measurement); split seams + migration cost supplied. |
| "continuation.ts carries three separable engines; inject.ts dead subsystem" | Partially mine: the navigability facet is that continuation.ts (1,382 ln, ~14k tokens) is pinned by the repo's largest test file (5,024 ln, ~55k tokens — a 3.9:1 pin ratio), so any liveness change carries the suite's biggest read. Filed as context in IDEA-NAV-3; the three-engine split itself is an architecture/coherence question for the other macro slices. inject.ts-as-dead-subsystem is ISSUE-001's domain. |
| "five status surfaces with no freshness contract; assertion-ledger convention changed three times" | Taken up as NAVIGABILITY-004 (read-path budget + dead index) and Task C; the freshness-stamp fix direction endorsed. |
| "scripts/ mixes two products under one test gate" | Examined; filed as OPINION (NAVIGABILITY-007) — boundary enumerated, no caused defect found by me; gate-coverage facet remains ISSUE-109/IDEA-GATE-2. |
| "types.ts interface + hand-written-JSON-schema duality" | Not mine — design-coherence (Part C) territory; noted that as a *navigability* matter it is benign: both spellings are adjacent in one 10.5k-token file with a documented recipe ("Add a schema"), and Task-shaped reads fit. |
| "UPSTREAM_CONTRACT doubles as a findings ledger; CMake project still `myprogram`" | `myprogram` verified at CMakeLists.txt:17 and folded into NAVIGABILITY-003; the UPSTREAM_CONTRACT dual-role is a coherence question left to the other slices (navigationally it is small and self-contained). |
| "the gate's own availability failure mode (no timeout; nondeterministic red) is a gate-regime design point" | Not mine — build-process design (Part D). |

## Coverage ledger

What this lens examined, at what depth, and what it concluded. Scope was Part A (navigability)
of the macro charter; other Parts belong to sibling slices.

| Artifact | Depth | Conclusion |
|---|---|---|
| `findings-enforcement.md` (2,303 ln) | read in full | evidence base; all pointers to macro dispositioned above |
| Briefing + macro charter | read in full | — |
| File census: all 36 conductor production files, 40 test files, docs/build, docs/{developer,user,faq}, plan | `wc -l -c` measured, full | §0.1–0.3 tables |
| `tools.ts` | structure mapped (all 22 handler boundaries by grep; preamble + override→setup interstitial region enumerated); regions spot-read, not read whole | NAVIGABILITY-001 region table |
| `docs/developer/extending.md` (529 ln) | **read in full** | §0.4, NAVIGABILITY-002; the map exists — a fact absent from the step-2 record |
| `docs/developer/README.md`, `README.md` (layout + docs sections) | read (targeted) | NAVIGABILITY-003 |
| `docs/developer/testing-and-verification.md` | targeted (M7 + artifact-table sections) | Task C; IDEA-NAV-5 |
| CMakeLists.txt include roots + project name | targeted | NAVIGABILITY-003 |
| Tool-name fan-out (`conductor_inline_claim` as probe) | grep-enumerated (9 files) | Task A read-set |
| Stop-kind fan-out | grep-enumerated (6 files, 3 languages) | Task E, NAVIGABILITY-006 |
| Import graph of tools.ts | grep-enumerated (26 files, 45 statements) | NAVIGABILITY-001 migration cost |
| Source-audit file coupling (journal-vocab.test.ts) | targeted read | migration cost detail |
| tools-9.x test headers (10 files) | headers read | NAVIGABILITY-005 |
| GATES.json phase-gate method text | grep + targeted | the "exact line ranges" evidence |
| doctrine pack sizes (9 files) | `wc -l` | context only (all ≤102 ln — well-sized; no finding) |
| scripts/ inventory + scripts/README.md size | listed/measured | NAVIGABILITY-007 (OPINION) |

**Not examined (deliberately, outside this slice):** layering/dependency directions (Part B),
role decomposition and FSM fitness (Part C), the gate regime's design and the 92-correction
clustering (Part D — a sibling deliverable), operator experience (Part E), scale-up fitness
(Part F). No mutations were run: this lens argues from measurement and from step-2's reproduced
defects, per the charter.

**Honest limits of this slice's numbers:** token figures are bytes/4 and mildly understate BPE
counts; "safe read set" judgments encode my model of what safety requires (informed by the
correction record) and a more frugal agent could undercut them by trusting recipes blindly —
which is exactly the under-reading the record shows producing defects. The Task A overflow
verdict is robust to ±30% estimation error; Tasks B/D/E verdicts are not close calls in either
direction.

**Where this lens disagrees with the evidence base:** nowhere on facts; one addition of record —
the step-2 pointer's "~15 handlers" is 22, and the step-2 record nowhere mentions that
`docs/developer/extending.md` exists. Any plan built on step 2 alone would wrongly conclude the
repo has no concern→file map; it has one, and the correct move is to repair and bind it, not to
write one.
