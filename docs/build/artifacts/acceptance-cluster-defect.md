# The acceptance-cluster count

The §3.2 item-size row asks whether a queue item covers more than one thing. Half of it
counts files; the other half counts *acceptance clusters*, and that half answers a
question about prose style. Two live runs are refused for items that cover exactly one
thing, and one of those refusals stands in this repository's own findings register as the
design working as written.

This is the record of what the row measures, where the count is wrong, what the repair
is, and what it still gets wrong in both directions.

**Subject:** `acceptanceClusters` and the item-size row that reads it, both in
`conductor/core/planning.ts`. **Pinned by:** `conductor/tests/planning-clusters.test.ts`,
and by the five older rows in `conductor/tests/tools-9.2.test.ts` that fence the two
earlier repairs.

---

## 1. What the guard is for

The plan states the row once, at `docs/plans/2026-08-07-conductor-harness-plan.md:1109`,
and this is the whole of it:

```
| item size (scope > ~5 files or > 1 acceptance cluster) | one bounded re-split re-prompt round, then rejection |
```

The smell it targets is stated in §2.4 (`plan:750-752`):

> A decomposition that returns one item covering everything, or items without
> disjoint-able file scopes where the change plainly separates, is itself a plan-review
> finding class (§3.2).

Two facts about that row govern everything below.

**The plan fixes the threshold and leaves the unit undefined.** `> 1` is explicit. The
word *cluster* appears exactly once in the plan, zero times in the addendum, and is
defined in neither. The build's own ledger says so: `docs/build/STATE.json:1069` records
that `"'> 1 acceptance cluster' has no spec definition; approximated by the criterion's
subject token after skipping determiners"`. So the defect is in the interpretation, not
in the row — and re-cutting the unit is faithful to the plan in a way that raising the
threshold would not be.

**The row is the only acceptance check that gates both doors.** A `trivial`
classification's synthesized item goes through the same `validateQueue` a decomposed queue
does — deliberately, so a trivial item cannot walk past the size and scope rules, and
pinned by `conductor/tests/scope-seams.test.ts` (`[scope-classify-uses-one-acceptance-authority]`).
The §2.10 trivial route skips DECOMPOSED, PLANNED and PLAN_REVIEWED entirely, so
PLAN_REVIEWED lens (c) — "decomposition quality (item size, scope disjointness, DAG
honesty)", `plan:1119` — never sees a trivial item. Deleting the row would leave that
route with no acceptance-size check at all.

The row is also not redundant with the file budget beside it. `ITEM_MAX_FILES = 5` counts
files; two functions in one file pass it, and a one-file item is exactly where the
two-things smell is invisible to every other row in the table.

---

## 2. Where the count breaks

The scan the row read took each criterion's first whitespace token that is not a
determiner, stripped non-identifier runs off both ends, took the leading identifier,
case-folded it, and de-duplicated. That token was the criterion's *subject*. Distinct
subjects were distinct clusters.

A token's position in an English sentence is not its subject. Three independent causes
follow from that, and they stack.

### Cause 1 — one file spelled two ways counts twice

A path and the bare filename under it are the same file, and the scan compares strings.

```
fileScope ["src/solvers/p001.py"]
  · src/solvers/p001.py exports solve() taking no arguments
  · p001.py returns 233168 when called
        -> ["src/solvers/p001.py", "p001.py"]   2 clusters, REJECT
```

The same shape covers `./src/a.ts` against `src/a.ts`, `src/**` against `src/a.ts` (which
yields the fragment `src/`, a name that exists nowhere), and a file against the symbol it
holds:

```
fileScope ["src/backoff.ts"]
  · src/backoff.ts exports backoffDelays(attempts, baseMs)
  · backoffDelays(3, 100) === [100, 200]
        -> ["src/backoff.ts", "backoffdelays"]   2 clusters, REJECT
```

### Cause 2 — the word at the front of a sentence is not the subject

English opens a sentence with a passive's patient, a gerund, an existential, a
preposition or a generic noun as readily as with a subject, and each of those became a
cluster named for a word that names nothing in the item.

```
fileScope ["src/slugify.ts"]
  · slugify lowercases the input
  · leading hyphens are removed              -> ["slugify", "leading"]        REJECT

fileScope ["src/duration.py"]
  · parse_duration("1h30m") returns 5400
  · calling parse_duration("") raises ValueError
  · passing an unknown unit raises ValueError -> ["parse_duration", "calling", "passing"]  REJECT

fileScope ["src/solvers/p001.py"]
  · solve() returns 233168
  · module registers itself with the registry on import -> ["solve", "module"]  REJECT
```

The threshold is therefore a criterion COUNT, not a subject count. One subject survives at
one and two criteria and is refused from the third onward, as soon as one criterion is
phrased in ordinary English rather than opening with the identifier.

The determiner list cannot close this. It is a whole-word lookup that walks PAST its
members, so adding `module` to it lands the scan on `registers` — a worse subject than the
noun was. That is why the repair ends the scan on these forms rather than advancing it.

### Cause 3 — a regression guard counts as a subject, so the row punishes discipline

`src/registry.py is not modified` and `tests/check_visible.py still passes` are promises
not to break things. Counting them as subjects means the more carefully a planner promises
not to break things, the likelier its item is refused as too large.

```
fileScope ["src/level.ts"]
  · levelFor(3) === 2
  · src/state.ts is not changed
  · tests/visible.test.ts still passes
        -> ["levelfor", "src/state.ts", "tests/visible.test.ts"]   3 clusters, REJECT
```

This one is not reachable by any improvement to subject extraction, and that is the point
worth keeping: `src/registry.py is not modified` and `src/registry.py is rewritten` have
the identical subject. The discriminator is the predicate and the item's declared write
scope, neither of which a subject scan reads.

The proof that a guard cannot divide an item is structural rather than statistical:
splitting an item does not divide such a criterion — every half still owes it — so it can
never be a reason the item is two items.

---

## 3. The two live manifestations

### (A) The 13.2 smoke, run `r-20260821-47df`, task slugify-ts

The campaign's first `trivial` classification. Journal seq 32:

```
seq 32 fsm guard-reject {"stage": "classify", "violations": ["item \"I1\" is too large: its acceptance spans 3 clusters
                          (slugify, leading, export), over the one-cluster item budget — split it into one item per cluster (§3.2)"]}
```

All three criteria assert about the one `slugify` function. `leading` and `export` are
sentence-leading words. The item spans one cluster.

The refusal threw before the run was persisted, so nothing was recorded, `run.classified`
stayed false, and the orchestrator's next call — `conductor_decompose` — was allowed. That
is F22, and it is a real finding on its own evidence; see §5.

### (B) The corpus campaign's three-arm run, task euler-001-py, conductor arm

```
item "I1" is too large: its acceptance spans 7 clusters
(src/solvers/p001.py, p001.py, src/solvers/__init__.py, solve, module,
 src/registry.py, tests/check_visible.py), over the one-cluster item budget
- split it into one item per cluster (§3.2)
```

All three causes stack here. `p001.py` duplicates `src/solvers/p001.py`; `solve` is a
function and `module` a generic noun; `src/registry.py` and `tests/check_visible.py` are
regression guards.

The cost: the arm spends **43.9 minutes and 337,052 tokens**, never leaves INTAKE, and
writes no solution. euler-001-py is a T1 task — the cheapest tier anywhere in the corpus —
whose solution is one function returning a constant sum. For scale, the plugin-free
baseline arm on the same task, measured in the post-repair three-arm run of §9, passes in
270.0 seconds and 84,656 tokens.

The refusal alone did not cost that. `handleClassify` threw before `store.saveRun`, so
nothing persisted; the phase gate then offered `conductor_classify` as the sole legal
pipeline tool, with no attempt counter and no violation feedback in the prompt, so every
re-roll was byte-identical input against a verdict that is a function of that input. The
miscount was the trigger; an unbounded non-learning re-roll was the trap. §6 repairs both.

Both manifestations reproduce byte-identically off a bare `node` import with no model.

---

## 4. The third instance of a class repaired twice

The scan carries two earlier repairs of this same class, both of them a token that is not
a subject being read as one.

|       | what read as a subject                                                                                                                                                                                                       | repair                                                                                                 | landed                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Fix 1 | a leading article: `the parser rejects X` and `the router retries Y` collapsed to one cluster `the`, while `parser rejects` beside `the parser preserves` split into two and was refused as `spans 2 clusters (parser, the)` | skip determiners when choosing the subject token                                                       | `75a2531`, recorded as C-030 |
| Fix 2 | call syntax: `pad("a")` reduced to `pad("a` while `pad("")` reduced to `pad`, so two checks on one function counted as two clusters and the name `pad("a` was quoted back at the planner                                     | take the token's leading identifier run, stopping at the first character that cannot appear inside one | `6082c5f`, recorded as C-086 |

Both are word-level patches, and the ORDER of the two reductions is load-bearing: the
determiner test is a whole-word lookup, so `"the,"` is not `"the"`, and extracting the
identifier before stripping the ends revives fix 1's defect. Both invariants survive the
repair below and are pinned unchanged.

`conductor/tests/tools-9.2.test.ts:1218` states the boundary the second repair drew:

> the one SIZE rule itself (> 1 cluster is too large) is not in scope and is not touched.

That fence is what makes this a third instance rather than a second. Each repair fixed the
token the last corpus produced and left the reading that produces such tokens intact, so
the next English construction walked past it. A third word list would have done the same:
a measured probe of "fold basenames and drop generic nouns" takes manifestation (B) from
seven clusters to four, still over budget, still refusing the item.

---

## 5. Why the campaign recorded the refusal as correct behaviour

`docs/build/artifacts/13.2-findings-register.md` observed manifestation (A) live, quoted
the journal record accurately, and concluded that it was "refused on a genuine violation
(3 acceptance clusters against a 1-cluster budget)" and that this was "the ONE ACCEPTANCE
AUTHORITY design working exactly as written, on its first live exercise". Both sentences
are corrected there. The reason they were easy to write is the useful part of this
document, because the same conditions will hold the next time a guard is wrong.

**A refusal is the shape of a guard working.** The campaign was hunting for defects that
let bad things THROUGH — a gate that allows a call it should refuse, a placeholder read as
a receipt. Against that lens a refusal reads as the control group. A guard that refuses is
doing the visible half of its job, and the question "is this verdict true?" is a different
question from the one the campaign was asking.

**The finding it was attached to is real, and the refusal was the occasion for it.** F22 —
`conductor_decompose` is legal on an unclassified run — is carried by
`core/tool-legality.ts:130-133` delegating the whole phase check to an FSM edge that was
handed `run.classification.kind` and never `run.classified`. That mechanism needs only
that nothing was recorded at classify; it does not care why. Three earlier runs in the
same campaign (`d156`, `b8de`, `c82b`) took the same edge with no cluster refusal anywhere
near them. When a correct finding and a false characterisation arrive in the same
paragraph, the finding's strength lends the characterisation credibility it did not earn.

**The subject line was true.** §2.10's synthesis really did compose with the one acceptance
authority for the first time in that run, and that composition really does hold. The
refusal was read as the evidence for a claim that is true, so it was not examined as a
claim of its own.

**The first cluster name was right.** `slugify` is the function. The eye stops at a name it
recognises, and `leading` and `export` are plausible-looking words in a criterion about a
TypeScript module. A count is also self-authenticating in a way prose is not: "3 clusters"
reads as a measurement.

**There was no definition to check the count against.** A cluster is undefined in the plan,
in the addendum and in the doctrine. `conductor/doctrine/decompose.md` names the cap three
times and never says how it is computed. When a rule has no statement, a verdict cannot be
compared against it, and the only remaining test is whether the verdict looks reasonable —
which is precisely the test a plausible-sounding wrong answer passes.

**The disconfirming fact was already on the record and went unread.** `validateQueue`
returns EVERY violation it finds; its own docstring says so. The seq 32 record carries
exactly ONE violation. So the rest of the §3.2 table admitted that item, and the only
thing standing between the trivial route and EXECUTING was the size row's count. That was
visible in the quoted record at the time.

The reading rule that follows is cheap and general: **a verdict that quotes names is
making a claim about its input, and every name it quotes should exist in that input.** Two
of the three names in (A) exist nowhere in the item, and four of the seven in (B) are not
distinct files. That check takes one pass over the record and does not require knowing
what the rule was supposed to mean.

---

## 6. The repair

### The unit

The threshold stays at `> 1`, because the plan states it. The unit is the SUBJECT a
criterion asserts about, resolved against the files the item declares wherever the
criterion names one. `acceptanceClusters(acceptance, context?)` takes the item as an
optional context; without it the reading is prose-only, which is what makes the function
answerable on an acceptance list alone.

Four properties carry it, and each answers a measured refusal of an item that covers one
thing:

- a criterion that PRESERVES rather than delivers contributes nothing;
- a criterion whose grammar puts no subject at its front contributes nothing, rather than
  contributing the word that happens to be there;
- a file the item declares is ONE cluster however a criterion spells it, and a symbol a
  criterion introduces beside its file belongs to that file;
- the count never RISES for anything a planner adds out of discipline: a guard costs
  nothing wherever it appears, including in the fallback.

Every one of those is also a shape a planner under re-prompt pressure can reach for, so
each is paired with the property that keeps the row's teeth:

| loosening                                                               | the teeth beside it                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a preservation claim contributes nothing                                | it is dropped at its own CLAUSE, not at the sentence, and the half of the vocabulary that is also ordinary runtime English (`still runs`, `is not removed`) holds only over a criterion that NAMES the artifact it preserves. An adversative carve-out (`unchanged apart from the added retry`) is a deliverable.                         |
| a symbol belongs to the file beside it                                  | it is homed only within the subject window of the file token, and the scan stops at a negation, so `… and never calls telemetry.send()` does not adopt another component's function                                                                                                                                                       |
| a passive contributes no subject                                        | the passive is read at the MAIN clause, so a subordinate `when … is dropped` cannot suppress an active head; and where the passive names an agent (`is retried by the router`), the agent is the subject                                                                                                                                  |
| a declared file folds every spelling of itself                          | a directory glob folds nothing — `src/**` is a territory, not a file — so the row is not weakest where the item declares the most                                                                                                                                                                                                         |
| two declared files fold into one piece of work                          | only where a criterion RELATES them, with the verb between the two mentions; listing them side by side folds nothing                                                                                                                                                                                                                      |
| an unremarkable opening word could be dropped for want of corroboration | it STANDS. `parser rejects an unknown key` and `router retries on 502` name nothing the item declares and carry no mark, and they are the smell the row exists for. A criterion is refused a subject only when the GRAMMAR says its opening word is not one — a closed set of forms, where "words that happen not to be subjects" is not. |

When nothing in an acceptance resolves — no name, no path, no call, no token the item's
own scope corroborates — the count falls back to the positional reading rather than to
silence. Acceptance that names nothing is exactly the prose in which a two-things item
hides best, and a row that went silent there would be a guard nobody can see failing. The
floor is strict and sometimes wrong in the direction a journal records. It reads what the
acceptance delivers and never the guards, so the count cannot rise on discipline even
there.

### The remedy text

The refusal's advice belongs to the rule, and it has to name a move the rest of the table
permits. "Split it into one item per cluster" collides with the inter-item
scope-disjointness row whenever the clusters share a file: obeying it on manifestation (A)
produces three fresh `claim overlapping write territory` violations, so that advice
prescribes nothing. The row names the three legal moves instead:

```
item "I1" is too large: its acceptance spans 2 clusters (src/parser.ts, src/router.ts),
over the one-cluster item budget — give each subject its own item with its own files,
declare a path in fileScope if this item really writes it, or phrase a criterion about a
file it must not change as a preservation guard ("… is not modified") (§3.2)
```

The message PREFIX is byte-preserved, because a test parses it, and because the cluster
name alphabet (`[\w./-]` plus declared scope entries) structurally cannot carry the `", "`
the names are joined with or an unbalanced delimiter.

### The disposition, which is the half that matters more

A repaired heuristic removes today's trigger. It does not remove the trap. So the trivial
route's disposition follows §2.10's own words — *"Any violation escalates to `work` — the
classifier proposes, the handler disposes"* (`plan:947`) — for the whole §3.2 acceptance
table, not just the three §2.4 bounds it already covered. A size-row refusal on a
synthesized trivial item records the classification, journals the violations under
`disposition: "escalate-to-work"`, returns them to the caller, and lets the run advance to
decompose, where a bounded re-prompt exists. `conductor_classify` is then illegal rather
than merely wasteful, so the same verdict cannot be re-rolled against the same prompt
forever.

No attempt counter is needed for it and none is added: a re-check verdict is a function of
the prompt, so the escalation is what makes the loop terminate. The two dispatch throws on
that path — a classifier or skeptic returning no valid receipt — are a different failure,
because a further roll can genuinely differ.

### The designs not taken

| rejected                                                                                   | why                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A third word list** — add gerunds, generic nouns and adjectives to the determiner set    | The instrument is wrong twice over: it is an open-ended English list masquerading as a closed vocabulary, and walking PAST such a word lands the scan on the verb that follows it. Measured on (B): seven clusters become four. Still refused.                                                                                                                                                                                                     |
| **Delete the cluster half; leave item size to the file budget and PLAN_REVIEWED lens (c)** | Defensible on the decompose route, and the plan supports it. It is not defensible on the trivial route, which skips PLAN_REVIEWED entirely — and a one-file, two-function item is invisible to the file budget, which is the case the row uniquely sees.                                                                                                                                                                                           |
| **Count the item's declared fileScope entries as the clusters**                            | Measured: it refuses manifestation (B) when the item declares BOTH files it writes, i.e. it works only on an under-declared scope; it flips five pinned REJECT verdicts to ACCEPT, including both rows written to certify the row is not loosened into uselessness; and it goes silent (zero clusters) on any acceptance that names no declared file. A budget of 1 on declared files also contradicts `ITEM_MAX_FILES = 5` twenty lines above it. |
| **Drop every path-shaped subject, and let the file rows govern file spread**               | Closes (B) most robustly of any candidate, and makes path-led acceptance permanently unclusterable under every scope declaration — a one-phrase, learnable evasion, in the exact phrasing style of the corpus that produced (B). Measured teeth fall below the defective scan's.                                                                                                                                                                   |
| **A `preserves: string[]` field on the item schema**                                       | Recognition works retroactively on prose models already write; a field does not. Both live manifestations came from models that had never seen it. `itemCoreProperties` is `additionalProperties: false`, so adding it regenerates `router/tests/schemas/*.json`, which the C++ suite reads byte-for-byte.                                                                                                                                         |
| **Return a typed partition (`clusters`, `guards`, `unresolved`) instead of names**         | It would read better in a violation, and it would move every assertion that pins this scan's answers — the assertions that certify the row is neither loosened nor re-broken in the ways it has been broken already. The legibility is bought in the violation text instead.                                                                                                                                                                       |

---

## 7. What it does not catch

Every guard has a blind side. These are named so a later repair rewrites them
deliberately, and each is pinned as a test row.

**A single criterion joining several checks is at most one cluster, always.** No
per-criterion scheme can split one string, so a planner that concatenates escapes the row
entirely. The repair removes the PRESSURE to do it — the old row taught concatenation as
the only reachable escape — but the hole is structural and open.

**Two subjects behind one repeated generic noun collapse.** `the module registers itself
with the registry` beside `the module prints the report table` is one cluster, because the
row cannot tell a repeated real subject from a repeated generic one.

**Two independent clauses jammed into one criterion read as a relation.** `src/lexer.ts is
formatted and src/parser.ts is formatted` puts a word between the two mentions, so it folds
a lexer and a parser into one cluster. It is the jammed-criterion hole above wearing the
fold's clothes and closes with it, not separately.

**The abstention grammar is itself learnable.** Whatever makes a criterion uncounted is a
rule a planner can follow to stop being counted. This is true of every design considered
here, and it is the reason the two-things corpus is asserted as a RATE against the scan it
replaces rather than as a set of individual verdicts: a future loosening reds a row instead
of drifting.

**The row is not the whole answer to item size, and is not meant to be.** `plan:750-752`
makes "one item covering everything" a plan-review finding class, and PLAN_REVIEWED lens
(c) is where decomposition quality lives on the work route. A mechanical row that fires on
the clear cases and abstains on the ambiguous ones is the correct division of labour.

## 8. What it still wrongly refuses

**Verb-leading acceptance.** `rejects empty input with a parse error` beside `accepts a
well-formed document` is two clusters and is refused. The first string is
`conductor/doctrine/decompose.md`'s own worked example of a good criterion. `rejects` and
`accepts` are string-indistinguishable from `parser` and `router`, which the teeth rows
require to stay two clusters, so no string rule separates them. The doctrine is the repair:
the generated mechanics block tells the planner to open each criterion with what it is
about (`parse rejects empty input`, not `rejects empty input`), and naming the subject
passes.

**Acceptance in which every criterion abstains.** The floor reports the positional reading,
so `the total is computed by summing the values` beside `the report is generated by writing
the rows` is refused for its prose. This is the price of the floor being strict rather than
silent, and it is deliberate.

**Two spellings of one file under a directory glob.** A glob is not the canonical spelling
of any one file, so nothing exists to canonicalize `parser.ts` onto under `fileScope
["src/**"]`. Declaring the path folds them.

**Non-ASCII identifiers.** The subject alphabet is ASCII-only, so `nörmalize` truncates to
`n`, and two distinct non-ASCII identifiers sharing a first ASCII letter collapse to that
letter. Untouched by this repair and worth its own row.

**The sibling acceptance row is not on this list, because it is repaired alongside.**
`vagueAcceptance` — the only other row in the §3.2 table that reads free text — carried the
identical identifier-versus-English confusion: `refactor(ast) preserves the token count`
and `cleanup() removes the temp dir` refused as quality wishes, and `make it less than
200ms` refused against the rule's own docstring. It feeds the same violations array, the
same re-prompt and the same disposition, so leaving it would leave a second identical
trigger for the same wedge.

---

## 9. Verified state

### Gate and scan

```
bash scripts/test-conductor.sh
  TAP: tests=1963 pass=1963 fail=0 cancelled=0 skipped=0 todo=0 skipdirectives=0 (node exit=0)
  typecheck: OK
  bun leg: OK (8 pass)
  schema export: OK (router/tests/schemas/)
  python leg: OK (Ran 156 tests)
  GATE PASS

bash scripts/conductor-gate.sh
  M5 PASS (195 file(s) scanned, 6 line exemption(s) all live)
```

The scan enumerates tracked sources, so its file count follows what git tracks rather than
what this row touches; `conductor/tests/planning-clusters.test.ts` is one of the three that
join the set.

1940 tests before the repair, 1963 after: +20 in `conductor/tests/planning-clusters.test.ts`,
+2 in `tools-9.1.test.ts` for the escalation, +1 in `doctrine-mechanics.test.ts` for the
file-cap row. No test is deleted, skipped or weakened, and
`conductor/tests/tools-9.2.test.ts` is unmodified — all five rows that fence the two
earlier repairs pass with their assertions untouched, including the `config.load` versus
`config` near miss that forecloses basename folding.

### Both manifestations, measured against the module

The BEFORE column is the positional scan, transcribed verbatim from
`git show c750d9a:conductor/core/planning.ts`, and reproduces each live journal record
byte-identically.

|                                                 | BEFORE                                                                                                              | AFTER                     | verdict         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------- |
| (A) slugify-ts, `fileScope ["src/slugify.ts"]`  | 3 — `slugify, leading, export`                                                                                      | 1 — `src/slugify.ts`      | REJECT → ACCEPT |
| (B) euler-001-py, one file declared             | 7 — `src/solvers/p001.py, p001.py, src/solvers/__init__.py, solve, module, src/registry.py, tests/check_visible.py` | 1 — `src/solvers/p001.py` | REJECT → ACCEPT |
| (B) euler-001-py, both files it writes declared | 7 — same                                                                                                            | 1 — `src/solvers/p001.py` | REJECT → ACCEPT |

(B) is measured under both scope declarations on purpose: a repair that closes it only when
the item under-declares the files it writes has not closed it.

Each cause in isolation, same before/after: one file spelled two ways `2 → 1`; a file and
the symbol it holds `2 → 1`; a passive's patient `2 → 1`; gerund openers `3 → 1`; a generic
noun `2 → 1`; one guard `2 → 1`; two guards on a one-function item `3 → 1`. Every one goes
to zero cluster violations through `validateQueue`.

### Anti-toothless

Eight constructed genuinely-two-things items, run end to end through `validateQueue`, each
chosen for a shape the repair could plausibly have leaked. All eight are still REJECTED,
each with exactly one cluster violation and no other violation, so the refusal is
attributable to the size row:

```
REJECTED  two components, two declared files            ["src/parser.ts","src/router.ts"]
REJECTED  the pinned near miss                          ["config.load","src/config.ts"]
REJECTED  a deliverable beside an undeclared component  ["src/solvers/p001.py","src/telemetry.ts"]
REJECTED  a guard CLAUSE carrying a deliverable behind it ["solve","src/telemetry.ts"]
REJECTED  a preservation claim with an adversative      ["src/slugify.ts","src/router.ts"]
REJECTED  two declared files a criterion LISTS          ["backoffdelays","src/client.ts"]
REJECTED  a passive behind a subordinate clause         ["src/parser.ts","src/router.ts"]
REJECTED  a symbol mentioned in passing                 ["src/a.ts","telemetry.send"]

anti-toothless: 8/8 still rejected, 0 leaked
```

The suite carries the same property as a rate: over the checked-in two-things corpus, the
repaired row rejects at least as many items as the positional scan it replaces, asserted as
an executable comparison against a transcription of that scan.

### Live

Run `r-20260821-0a31`, euler-001-py, conductor arm, `llamacpp/qwen3.8-27b`
(build `b10542-521a64cd0`), opencode 1.18.15. The arm leaves INTAKE:

```
seq 19 info fsm transition {"to":"EXECUTING","classification":"trivial","agreed":true}
```

There is no `guard-reject` anywhere in that run's 64-line journal. The item it classified
on carries seven acceptance criteria over `fileScope ["src/solvers/p001.py",
"src/solvers/__init__.py"]` and `testScope ["tests/check_visible.py"]`, including two
regression guards; the positional scan makes five clusters of it and the repaired row makes
one.

**The arm still fails the task, and the failure is not the guard's.** It timed out at the
2700-second T1 cap while in EXECUTING, spending 370,861 tokens over three waves and three
sub-sessions, and wrote no `p001.py` — the seeded repository came back clean. Before the
repair the same arm spent 2,632 seconds in INTAKE; after it, 2,700 seconds in EXECUTING.
The blocker moved rather than disappearing. The run reached `conductor_inline_claim`,
recorded decision `D-0001`, was correctly denied an edit to `tests/check_visible.py` for
want of an inline claim scoping that path, and had dispatched the testWriter wave sixty
seconds before the cap, with orchestrator turns running three to seven minutes apart. That
is a throughput property of this model at this context size, not a gate property, and it is
open.

**A separate defect surfaced in the same session and is not repaired.** An earlier attempt
died at 156 seconds with exit 1, before `conductor_classify` was ever called and with zero
`fsm` records. The model issued an absolute-path read and mis-transcribed the temp-directory
segment; opencode classified the result as `external_directory`, and the ask-gate refused
it:

```
the ask-gate adjudicates only "edit" (by inline claim) and "question" (allowed and
counted); every other permission kind is refused: external_directory
```

opencode then aborted the whole session on the rejected tool call. One mistyped path costs an entire run.
Whether the ask-gate should refuse a read of a path outside the workspace by aborting the
session is a design question, not a defect with an obvious repair.

---

## 10. Where the record lives

- The rule and its consumer: `conductor/core/planning.ts`.
- The disposition: `handleClassify` in `conductor/adapter/tools.ts`.
- The planner-facing statement: `renderLimits` in `conductor/core/mechanics.ts`, generated
  into all nine `conductor/doctrine/*.md` packs and pinned equal to a fresh derivation.
- The contract: `conductor/tests/planning-clusters.test.ts` — both live refusals verbatim
  as regression fixtures, one row per cause, the teeth corpus as a rate, and the residuals
  of §7 and §8 pinned as known behaviour.
- The two earlier repairs' invariants: `conductor/tests/tools-9.2.test.ts`, unmodified.
- The observation and its correction: `docs/build/artifacts/13.2-findings-register.md`
  (F22 and the trivial-synthesis section), and `conductor/SMOKE.md`.
