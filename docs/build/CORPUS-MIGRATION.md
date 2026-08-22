# Corpus migration

The conductor bench measures three arms against the same seeded repository and
scores each by the exit status of a test the model never sees. This page
describes the task corpus that measurement runs on: how a task states its files,
how a run is narrowed, what every manifest holds, what was declined and why, how
to run a comparison, and what is proven about the set as it stands.

Everything here targets one model. `llamacpp/qwen3.8-27b` is the only id any
manifest names, in all three of the places a manifest names one — `defaults.model`,
`sweep.primaryModel` and `sweep.models` — and the driver holds no model id of its
own, so a run with neither `--sweep` nor `--model` plans `defaults.model`.

---

## 1. What the corpus migration delivers

### 1.1 A task states its files once: inline, or by directory

`scripts/conductor_bench.py` accepts a task's seed and hidden file sets in either
of two spellings, and exactly one per side:

| Field | What it is |
|---|---|
| `seedFiles` / `hiddenFiles` | An inline `{relative path: body}` map, for a handful of small files |
| `seedDir` / `hiddenDir` | A repo-relative directory, walked at manifest load |

`_parse_file_source` dispatches on which is present. Declaring both for one side
is a refusal naming the task and both spellings; declaring neither is the same.
Both spellings produce the identical validated `Dict[str, str]`, so nothing below
that function can tell them apart — the directory comes back beside the map only
so the seed/hidden containment check has something to compare.

The walk is sorted by relative path, so two loads seed byte-identical trees. It
refuses, each refusal naming the task and the file: an absolute or `..` directory;
a directory that is a symlink, does not exist, is not a directory, or resolves
outside the repository root; a symlink, non-regular file or `.git` component
inside the walk; an entry resolving outside its own directory; an empty directory;
a file over `MAX_SOURCE_FILE_BYTES` (1 MiB) or a set over `MAX_SOURCE_DIR_BYTES`
(8 MiB); and a file that is not UTF-8 text.

Build artifacts named by the walked tree's own `.gitignore` are skipped, along
with a fixed universal set (`__pycache__`, `.pytest_cache`, `.mypy_cache`,
`.ruff_cache`, `.DS_Store`, `Thumbs.db`, `*.pyc`, `*.pyo`). Without that, a
`__pycache__` left by running a seed in place would fail every manifest load with
a decode refusal, and the artifacts are invisible to `git status` because the same
`.gitignore` files hide them.

The seed/hidden overlap guard carries two clauses, because two directories walked
from different roots produce relpaths that never collide as keys: paths are
checked for collision, and the resolved directories are checked for containment
in either direction.

**Directory sourcing is what makes the corpus portable at all.** `bytecode-vm-py`
seeds 35 files and grades against 1045; no inline JSON map holds that.

**Non-UTF-8 material is refused, not carried.** The whole seeding path is text —
the inline form is a JSON string, `materialize_files` writes with `write_text` —
so a byte-exact binary cannot survive it, and decoding with replacement would seed
a file that silently differs from the committed one. The two tasks with binary
material carry it base64-encoded beside a seeded decoder: `knn-search-cpp`'s
`sample/base.bin` and `queries.bin`, and `json-parser-py`'s `session-02.request`.
Round-trip byte-identity against the source corpus is verified in each case.

**Execute bits do not survive seeding.** `materialize_files` writes 0644. Every
ported task invokes its scripts through an interpreter (`bash run.sh`,
`/usr/bin/python3 gauge/run.py`), and every seeded `SPEC.md` and `README.md` says
so. Two tasks whose runners must spawn an executable — `resp-server-py` and
`bytecode-vm-py` — carry a `gauge/graded.sh` that chmods the workspace script
before exec'ing the runner.

### 1.2 `--task` and `--tier` narrow a run

Both flags are repeatable. Values union inside a dimension and the two dimensions
intersect, so `--task euler-cli-py --tier T1` is that task if it sits in T1 and
nothing otherwise.

`select_tasks` runs after `load_manifest`'s full validation and before both plan
builders, and both empty-set cases are loud refusals with exit 2:

- an unknown id names every unknown id with `difflib` near matches
  (`did you mean slugify-ts?`) or `no id in the manifest is close to it`;
- a selection matching zero tasks names both flag values, and fires **before**
  `write_run_manifest`, so a refused selection never overwrites a real campaign's
  design record.

A narrowed run is recorded as narrowed rather than inferred to be one. The run
manifest carries `filters` (`taskIds`, `tiers`, `selectedTaskIds`, `partial`), a
top-level `partial`, `taskIdsByTier` for what was planned and
`manifestTaskIdsByTier` for the full declared set. The report opens with a
`## Run scope` section above Method and everything Method qualifies; a narrowed
run states **"This run is a selection out of the declared task set, not the
campaign"** and names the tasks and the flags, and a whole-set run states its
coverage positively and names the flags that selected it. A report rendered
without a scope record makes no coverage claim at all rather than fabricating one.

`--sweep` refuses a selection, and refuses `--model`, `--capability` and `--reps`
with it, naming the flag it refused: the sweep block is the manifest's own
declared campaign shape, and composing the two yields a plan that is neither.

`--plan-only`, `--verify-tasks`, `--seed-green`, `--review-sample` and
`--report-only` all consume the filtered task list, so all five honour the
selection.

### 1.3 `expectedTaskCounts` is an optional per-tier pin

A manifest may declare, as a top-level object, the number of tasks it holds per
tier:

```json
"expectedTaskCounts": {"T0": 10, "T1": 4, "T2": 3, "T3": 3, "T4": 3}
```

The pin is per tier and not a scalar total, because a scalar cannot tell a lost T3
task from a gained T2 one. When declared it must name every tier — an omitted tier
is a refusal, not a silent zero. Precedence is: an explicit `expected_counts=`
argument, then the document field, then no pin. The field is optional so a
manifest assembled from a corpus is held to no shape it did not state; an empty
`tasks` array is refused independently of the pin, so "no pin" never opens a
vacuous green over zero tasks.

### 1.4 Every manifest

| Manifest | Tasks | Cells at `--sweep` | What it measures |
|---|---|---|---|
| `bench/conductor-tasks.json` | 23 | 207 | The POC ladder authored for this bench. T0×10, T1×4, T2×3, T3×3, T4×3 across ts, python and cpp — the set the scope ladder was designed against, from a task inside the plugin's trivial path up to work needing a file no plan would have scoped. |
| `bench/corpus-systems.json` | 4 | 36 | Build-from-specification conformance. Each seed is a near-complete implementation with two named unimplemented requirements; each hidden test is the corpus's own multi-hundred-case conformance suite. T2×3, T3×1, all python. |
| `bench/corpus-repair.json` | 5 | 45 | Fault repair and migration. Three debugging tasks (four independent faults each, reported as symptoms) and two migrations whose gate is the specification's own stated end state. T2×3, T3×2, across ts, python and cpp. |
| `bench/corpus-perf.json` | 3 | 27 | Optimization against a measured ratio. Each gate checks pristine integrity, then correctness, then a median speedup over interleaved timed pairs. T1×1, T3×1, T4×1, across cpp and python. |
| `bench/corpus-euler.json` | 20 | 60 (reps 1) | Registry plumbing, two-file instruction-following and one computed integer, generated by `scripts/generate_euler_tasks.py`. All T1, all python. |
| `bench/corpus-games.json` | 2 | 18 | Headless game rules against recorded whole-output summaries. T2×1, T3×1, both python. |

393 cells across all six at their declared sweep shapes. `--sweep` honours each
manifest's own `reps`; a plain run uses `--reps` (default 3), which is why
`corpus-euler.json` plans 60 cells under `--sweep` and 180 without it.

`bench/corpus/` holds the seed and hidden trees, plus the archival source material
for what was declined. It is committed rather than fetched: the material is
authored and copied, not downloaded, so the non-redistribution policy that governs
fetched trees does not apply. It also sits outside all seven `scripts/conductor-gate.sh`
globs, so it adds nothing to the mechanical scan.

---

## 2. Every ported task

34 tasks across five manifests. `timeout` is `runTimeoutSec` where the task states
one, otherwise the tier default from `defaults.tierTimeoutSec`
(T0 1800, T1 2700, T2 3600, T3 7200, T4 3600).

### 2.1 systems-implementation — `bench/corpus-systems.json`

| id | tier | lang | What the hidden test proves | timeout |
|---|---|---|---|---|
| `json-parser-py` | T2 | python | The corpus's 627-scored-case JSON conformance suite. The unmodified seed scores 604/627; every one of the 23 failures is R-11 (per-lead UTF-8 continuation ranges — the seed accepts overlongs, encoded surrogates and CESU-8) or R-16 (the maximal numeric run). A cell passes only at 627/627. | 3600 |
| `regex-engine-py` | T2 | python | An 884-case regex conformance suite run at `--max-restarts 60`. The seed scores 840/884: 13 failures are the whole `pathological` group, wanting the linear-time thread-list simulation; the other 31 are every case whose pattern carries a lazy quantifier. | 5400 |
| `resp-server-py` | T3 | python | An 869-case RESP2 server conformance suite, driven over a loopback socket on a gate-chosen ephemeral port. The seed scores 752/869 and every one of the 117 failures runs a transaction or a pub/sub command — the two families that stand on connection state the seed does not carry. | 7200 |
| `bytecode-vm-py` | T2 | python | A 1077-case suite across 1045 hidden files. The seed scores 1039/1077: 16 failures want the §13 per-instruction module validation, 22 want a string inside an array rendered quoted and escaped. | 5400 |

### 2.2 debugging and migration — `bench/corpus-repair.json`

| id | tier | lang | What the hidden test proves | timeout |
|---|---|---|---|---|
| `date-range-scheduler-ts` | T2 | ts | The complete 54-test suite, of which the visible suite holds 45. The nine carved tests prove the four independent scheduling faults, each with a named regression guard beside it. | 3600 |
| `ledger-rounding-py` | T2 | python | The complete 74-case `unittest` suite, of which the visible suite holds 58. The 30 pytest-granularity failures partition exactly across the four faults — no case fails for two reasons — and three of the four have a cheap wrong repair the suite carries a guard against. | 3600 |
| `lru-cache-eviction-cpp` | T2 | cpp | The complete 29-test suite, compiled and run by `gauge/build.py`, of which the visible suite holds 21. Four independent faults in four functions of one header. | 3600 |
| `config-schema-migration-ts` | T3 | ts | 76 frozen behaviour tests that must stay green, plus four structural checks: the two greps `MIGRATION-SPEC.md` §2 states must print nothing (15 and 29 hits on the seed), §5's zero-dependency rule, and a byte floor on the decision log the spec requires. | 7200 |
| `http-client-v2-py` | T3 | python | The 64-test frozen suite re-run with `legacy_http` poisoned unimportable — the gate runs the shipped checker's STRICT branch unconditionally, which is what makes an untouched tree fail — plus a legacy-reference count (14 on the seed) and a `MIGRATION-NOTES.md` check. | 7200 |

### 2.3 optimization — `bench/corpus-perf.json`

Each gate decides in three phases: **integrity** (every read-only file byte-matches
`gauge/pristine/`), then **correctness**, then **speed** — one discarded warmup plus
four timed runs per side, alternating which side leads each pair and reading the
inputs through the page cache before each pair, median over four. A fast wrong
answer fails as a wrong answer.

| id | tier | lang | What the hidden test proves | timeout |
|---|---|---|---|---|
| `knn-search-cpp` | T1 | cpp | Exact correctness against a reference compiled from pristine sources with fixed flags, then a median speedup of at least **40x**. The gate deletes `data/golden`, `data/probes` and `data/bench-cache.json` first and times on a workload with a gate-only seed. | 5400 |
| `log-aggregation-py` | T3 | python | A byte-exact report against the frozen reference — exact nearest-rank percentiles and tie-broken orderings, so approximation and a reversed tie-break both change the bytes — then at least **6.0x**. The gate pins the interpreter twice: `LOGAGG_PYTHON` and a `python3` shim at the head of PATH. | 7200 |
| `etl-pipeline-py` | T4 | python | Two correctness properties: byte-exactness against an independent oracle on a freshly generated workload, and identical bytes at 1 worker and at 8 (SPEC §6), so a careless parallelisation is caught as a wrong answer rather than as a fast pass. Then at least **4.0x** against the frozen baseline, spawned from `gauge/pristine/baseline` so `python -m etl` cannot resolve the workspace package. | 7200 |

### 2.4 Project Euler — `bench/corpus-euler.json`

All 20 share one seed tree, one gauge shape and one timeout. Each task asks for
exactly one new module `src/solvers/pNNN.py` plus one import line in
`src/solvers/__init__.py`; the target module is **absent** from the seed rather
than present as a sentinel, which is what makes the seed green and the gauge red
without the visible test having to look away. The gauge runs seven checks: the
solver collection is the two worked solvers plus the target, the target answers
the verified integer inside a 60-second budget, the worked solvers still answer,
the module registers under its own name, `run all` covers the collection, and two
anti-recall checks — a constant folder over every module under `src/` that refuses
any value coming to the answer, and an import/IO allowlist that refuses `open`,
`input`, `eval`, `exec`, `compile`, `__import__` and any import outside `src/` plus
a stated computation list. **Tier T1, language python, timeout 2700 for every row.**

| id | Problem |
|---|---|
| `euler-001-py` | 1 — Multiples of 3 or 5 |
| `euler-002-py` | 2 — Even Fibonacci Numbers |
| `euler-003-py` | 3 — Largest Prime Factor |
| `euler-004-py` | 4 — Largest Palindrome Product |
| `euler-005-py` | 5 — Smallest Multiple |
| `euler-006-py` | 6 — Sum Square Difference |
| `euler-007-py` | 7 — 10001st Prime |
| `euler-009-py` | 9 — Special Pythagorean Triplet |
| `euler-010-py` | 10 — Summation of Primes |
| `euler-012-py` | 12 — Highly Divisible Triangular Number |
| `euler-014-py` | 14 — Longest Collatz Sequence (the one row on the corpus's brute-force-proof subset) |
| `euler-015-py` | 15 — Lattice Paths |
| `euler-016-py` | 16 — Power Digit Sum |
| `euler-017-py` | 17 — Number Letter Counts |
| `euler-019-py` | 19 — Counting Sundays |
| `euler-020-py` | 20 — Factorial Digit Sum |
| `euler-021-py` | 21 — Amicable Numbers |
| `euler-023-py` | 23 — Non-Abundant Sums |
| `euler-024-py` | 24 — Lexicographic Permutations |
| `euler-025-py` | 25 — 1000-digit Fibonacci Number |

The generator never reads `project-euler/problems/`. Statement text is copyright
Project Euler and gitignored in the source corpus, so the prompt's question comes
from `bench/corpus/project-euler/restatements.json`, written in this repository's
own words. Generation is byte-identical on a machine that has fetched nothing.
`--audit-statements DIR` is the one mode that reads real statements: it writes
nothing when paired with `--check`, names every absent statement and succeeds
anyway, and refuses a restatement sharing a run of ten or more consecutive words
with the statement it replaces.

### 2.5 headless games — `bench/corpus-games.json`

| id | tier | lang | What the hidden test proves | timeout |
|---|---|---|---|---|
| `grid2048-headless-py` | T2 | python | 24 graded cases over material the seed does not contain. Calibrated: the unmodified seed fails 14, the merge rule alone leaves 7, the rewind alone leaves 13, both leave 0 — so the two blocks are separable and each is genuinely required. | 3600 |
| `snake-headless-py` | T3 | python | 35 graded cases driving four modules the model writes in a strict chain, compared as whole recorded summaries — so an arm that welds the rules into the replay loop still passes and an arm that gets the generator draw order wrong does not. Every expectation was proved against a reference written from the seeded specification alone. | 7200 |

---

## 3. What was declined, and why

A task that cannot be scored without the model supplying part of its own answer
key does not belong in an A/B comparison: both arms pass, the cell cannot fail,
and it dilutes every real task it is averaged with. That failure mode looks
exactly like completed work, which is why the declines are written down.

`bench/corpus/DEFERRED.md` is the long-form record for the tui-games and
docs-generation categories. The declines below cover every category.

### 3.1 Advent of Code — blocked on per-account inputs and an earned answer key

**No Advent of Code task exists in any manifest, and none can be built from
committed material.** The source corpus carries 262 problems across 2015–2025 and
ships the category almost empty by design.

- **Puzzle statements are not committed.** `*/problems/` is gitignored. The text
  is copyright Eric Wastl, who asks that it not be republished.
- **Puzzle inputs are per-account.** `*/inputs/` is gitignored. An input is
  generated per logged-in account and is not the same for any two users, so the
  correct answer depends on *whose* input file it is.
- **The answer key is empty, and must be.** `expected-answers.json` holds all 262
  entries with `part1` and `part2` both `null` — verified: zero non-null entries.
  Its own comment states why: "the correct answer depends on YOUR input file, so
  no answer key can be shipped."
- **Part Two is gated behind having solved Part One.** adventofcode.com serves
  Part Two only to an account that has solved Part One, and serves inputs only to
  a logged-in account, so an anonymous fetch gets Part One of all 262 puzzles and
  no inputs at all.

The consequence for this bench is exact. **No answer key can be shipped**, so the
only way an AoC task becomes scoreable here is for an operator to hold an
adventofcode.com session cookie, fetch their own inputs, solve each puzzle
themselves, and fill the key in by hand — an *earned* key, one problem at a time,
valid only for that account's inputs. A campaign run against such a key is not
reproducible by anyone else, because nobody else's inputs match it. Fabricating
entries is worse than leaving them null: the corpus scores `null` as
**unverified** and excludes it from every head-to-head, so an unfilled key
degrades coverage but can never manufacture a false regression, while a guessed
key silently corrupts every comparison made against it.

Nothing from `advent-of-code/` is copied into `bench/corpus/`.

### 3.2 Declined for language — the vocabulary is ts, python and cpp

`LANGUAGES` in `scripts/conductor_bench.py` is `("ts", "python", "cpp")` and
`_parse_task` refuses anything else by name. Three corpus tasks are outside it and
are named here rather than relabelled as something they are not:

| Task | Language | Note |
|---|---|---|
| `graph-scheduler-race` | Go | Its first bug is observable only under `-race`, and its third bug's test hangs rather than failing under a wrong fix, so its gauge would need a timeout of its own rather than an exit code. |
| `error-taxonomy-migration` | Go | — |
| `substring-index` | Rust | Its 25x target was measured against a **Rust** reference at 79.18 s, so a C++ port invalidates the calibration outright. `src/reference.rs` *is* the definition of correctness and is sha256-frozen alongside the generator, the workload and all three sample files; `sample/expected.txt` was produced by that reference and a port would have to reproduce it byte for byte across four query kinds. |

Widening `LANGUAGES` is not a one-line change: `bench/conductor-tasks.json`'s
`selectionCriteria.languageMix` asserts "ts, python and cpp each appear at every
tier", and the error-path tests pin the closed set.

### 3.3 Declined for an unusable gate — `raft-node`

A complete deterministic Raft implementation was built against the specification
and scored 467/497 with all six reference-io streams replaying byte for byte.
It is **not** in the manifest because three groups of its conformance suite
contradict each other, so no conforming implementation can reach an all-pass gate:

1. `partition/total-isolation-then-heal` asserts `no_leader` after twenty rounds
   with every node isolated **and** that node 1's term reaches 2.
   `timer/leader-never-runs-an-election-timer` pins the opposite: after
   `tick ticks=20` a leader is still `role=leader, election_elapsed=0`. An
   isolated leader receives nothing, so nothing can raise its term.
2. `membership/remove-a-server` requires the removed node to converge on the
   configuration that removed it. `member/second-change-after-commit-allowed`
   pins that removing node 4 sends AppendEntries to 2 and 3 only. With §5.8's
   "delete its nextIndex and matchIndex", the removed node can never learn.
3. `fuzz/3-node-seed-1001` and `fuzz/5-node-seed-3003` assert `logs_match` after a
   heal and a restart with no proposal in between, over a state where the leader
   holds `[(1,3),(2,3),(3,3)]` and a follower holds a legitimate uncommitted tail.
   §5.3.4 forbids truncating a tail without a term conflict and §12 pin 2 forbids
   the no-op entry on election, so nothing converges them until a new entry is
   proposed — which the script does only *after* the assertion. That makes the
   gate luck-dependent rather than unreachable, which is just as bad.

Restricting the graded run to the 13 groups that are neither partition nor fuzz
was considered and rejected: excluding groups until only the satisfiable cases
remain is authoring a grader, not porting one. `raft-node` needs a pass-rate gate,
or three of its cases need fixing upstream.

### 3.4 Declined: six tui-games tasks

The category is **self-graded by construction**. Every one of its eight `task.json`
files lists the `expected/*.json` answer keys under `artifacts` — the list of
things the model is asked to produce — and the corpus's own scorer returns an
empty answer map for every category except advent-of-code and project-euler. Both
`tui-games/solutions/` and `docs-generation/solutions/` hold only a `.gitkeep`.
The corpus's real defence is a cross-language majority vote over five
implementations plus a human reviewer, which collapses to self-consistency at one
language with no human in the loop.

An authored reference is usable as an oracle **only** if the specification pins
enough ground truth to prove the reference itself right; a subtly wrong reference
fails every arm identically and reads as a model regression. That test is what
separated the two authored tasks from the six declined:

| Declined | Why |
|---|---|
| `tetris` | The only whole-output oracle is one SHA-256 of an empty board. SRS kick tables, lock delay, back-to-back and combo scoring are prose with nothing to check a reference against. |
| `tetris-enhanced` | Structurally void under A/B: `"seed_from_task": "tetris"` means each arm is seeded from its own prior output, so the three arms are not solving the same problem. |
| `2048-solver` (solver half) | Its bar is statistical over a wall clock — 2048 in 18 of 20 seeded games, average 20000 points, per-move budget — which puts a multi-minute compute benchmark inside a cell whose cost is the other thing being measured. The game half **is** in the manifest. |
| `minesweeper` | No pinned whole-output oracle. The no-guess generator is a solver in disguise and a reference for it is unfalsifiable against this corpus. |
| `roguelike` | Pins an FNV-1a digest and its vectors, and nothing above it. A correct hash proves nothing about the map, the field of view or combat. |
| `game-engine` | Pins no ground truth of any kind, and a gauge would have to pin an engine API the corpus deliberately leaves to the implementer. |
| `netplay-arena` | Needs real sockets, needs execute bits the seeding path does not carry, and pins orderings and a digest scheme rather than values. |

### 3.5 Declined: all five docs-generation tasks

`adr-reconstruction`, `api-reference`, `architecture-overview`,
`onboarding-guide`, `subsystem-deepdive`. Three independent reasons, each
sufficient:

1. **The mechanical check is a lint that filler passes.** `check_docs.py` run
   against a document of one repeated filler sentence carrying deliberately false
   claims, each cited to an arbitrary in-range line, reported
   `citations: 32 total, 32 valid, 0 invalid, validity rate 100.00%` and `PASS`,
   exit 0. `check_citations` resolves the path and checks the line number is
   within the file's length; it never reads the cited line. The same document with
   every citation stripped also exits 0, with "no citations found" as a *warning*.
2. **Sixty per cent of the score is a judge that does not exist in this lane.**
   The corpus rubric states "40 mechanical, 60 judged", and the driver scores a
   cell by exit status with no partial credit and nothing model-graded.
3. **It is not runnable offline.** `targets/checkouts/` is gitignored and the
   fetch script pulls roughly 1.2M lines from six GitHub repositories at SHAs
   pinned on moving branches. `check_docs.py` also consults the filesystem when
   deciding whether a token looks like a path, so the same document scores
   differently against different checkouts.

`bench/corpus/docs-generation/RUBRIC-LANE.md` documents how a docs deliverable
would route through the existing hand-scored rubric lane instead, with
`check_docs.py` demoted to an **admissibility** gate (does a reviewable document
exist) and never a score.

---

## 4. Running a comparison

Every command below names `llamacpp/qwen3.8-27b` explicitly. It is also each
manifest's `defaults.model`, so omitting `--model` plans the same thing.

### 4.1 Preflight — run both floors once per manifest that will run

Both floors default to `bench/conductor-tasks.json`, so a floor run without
`--manifest` checks the 23 POC tasks whichever set is about to run.

```bash
SCRATCH=$(mktemp -d)   # must be outside this repository; a work root inside it is refused

for set in bench/conductor-tasks.json bench/corpus-systems.json \
           bench/corpus-repair.json bench/corpus-perf.json \
           bench/corpus-euler.json bench/corpus-games.json; do
  python3 scripts/conductor_bench.py --verify-tasks --manifest "$set" \
      --work-root "$SCRATCH/verify" --verify-timeout 2400 || break
  python3 scripts/conductor_bench.py --seed-green  --manifest "$set" \
      --work-root "$SCRATCH/green" || break
done
```

`--verify-tasks` proves every hidden test fails on its unmodified seed;
`--seed-green` proves every seeded repository passes its own visible suite. The
corpus speed gates compile a reference and run interleaved timed workloads, so
raise `--verify-timeout` (default 600 s) for `bench/corpus-perf.json` rather than
reading a killed gate as a failure — a killed gate is reported as its own
`timedOut` outcome and refuses either way.

### 4.2 First light — the cheapest run that still proves the mechanism

```bash
python3 scripts/conductor_bench.py \
    --manifest bench/corpus-euler.json \
    --model llamacpp/qwen3.8-27b \
    --task euler-001-py \
    --reps 1 \
    --work-root "$SCRATCH/work" \
    --results-dir "$SCRATCH/results" \
    --report "$SCRATCH/report.md" \
    --run-manifest "$SCRATCH/run-manifest.json"
```

Three cells — one per arm. `euler-001-py` is directory-sourced, so this exercises
the `seedDir`/`hiddenDir` path; it is T1, so the clock is 2700 s per cell; and it
scores on a single integer with no rubric anywhere in the path.

**Measured cost: 61 minutes wall clock for all three arms** (§7.4). The timeout
ceiling for the same three cells is 3 × 2700 s = 2.25 h.

Inspect the plan without running anything by adding `--plan-only`.

### 4.3 One manifest

```bash
python3 scripts/conductor_bench.py --manifest bench/corpus-systems.json --sweep \
    --work-root "$SCRATCH/work" --results-dir "$SCRATCH/results" \
    --report "$SCRATCH/report.md" --run-manifest "$SCRATCH/run-manifest.json"
```

`--sweep` uses the manifest's own declared campaign shape — its `sweep.models`,
`sweep.capabilities` and `sweep.reps` — and refuses any flag that would overwrite
one.

### 4.4 The full campaign, and what it costs

There is no single command: each manifest is its own `--sweep`, run one at a time.

```bash
for set in bench/conductor-tasks.json bench/corpus-systems.json \
           bench/corpus-repair.json bench/corpus-perf.json \
           bench/corpus-euler.json bench/corpus-games.json; do
  name=$(basename "$set" .json)
  python3 scripts/conductor_bench.py --manifest "$set" --sweep \
      --work-root    "$SCRATCH/work/$name" \
      --results-dir  "$SCRATCH/results/$name" \
      --report       "$SCRATCH/report-$name.md" \
      --run-manifest "$SCRATCH/run-manifest-$name.json" || break
done
```

**Wall-clock ceiling, computed from each task's own `runTimeoutSec` (or its tier
default) times its cell count:**

| Manifest | Cells | Ceiling |
|---|---|---|
| `bench/conductor-tasks.json` | 207 | 180.0 h |
| `bench/corpus-systems.json` | 36 | 54.0 h |
| `bench/corpus-repair.json` | 45 | 63.0 h |
| `bench/corpus-perf.json` | 27 | 49.5 h |
| `bench/corpus-euler.json` | 60 | 45.0 h |
| `bench/corpus-games.json` | 18 | 27.0 h |
| **Total** | **393** | **418.5 h — 17.4 days** |

The five ported manifests alone are 186 cells and 238.5 h (9.9 days). Running
`bench/corpus-euler.json` at `--reps 3` instead of its declared 1 makes it 180
cells and 135.0 h, taking the total to 513 cells and 508.5 h.

**This is a ceiling, not an estimate.** It is what the campaign costs if every
single cell burns its full clock. The one measured datum — the three-arm first
light in §7.4 — came in at 61 minutes against a 2.25 h ceiling, so cells that
finish are well under. No mean cost per tier has been measured, so no honest
midpoint can be quoted; a campaign should be planned against the ceiling and
watched against the observed rate.

**`bench/corpus-perf.json` must not run beside anything else, its own cells
included.** Its gates measure a ratio on a live machine, so a neighbour loading
the box while one side is being timed corrupts the number rather than adding noise
to it. The manifest states this in `selectionCriteria.concurrency`; nothing in the
driver enforces it. Budget roughly 80 minutes of pure measurement across its 27
cells on top of the model runs.

---

## 5. The three arms

Every cell runs one arm against one task at one repetition. The arms differ in
exactly one thing — what process the model is running inside. Provider, base URL,
model selection, the served per-slot limit and every other config key are built
from the same code path, and every arm's work tree is seeded from the same file
set and the same commit, `.conductor/config.json` included.

| Arm | What it is | What it isolates |
|---|---|---|
| `baseline` | Plain opencode, opencode's own `build` agent, no prompt of ours. | The model, unassisted. Every number the other two arms produce is read against this. |
| `doctrine` | Plain opencode, same agent, with all nine doctrine packs injected as one prompt file. | **Whether the advice alone is what helps.** |
| `conductor` | The plugin loaded from the committed opencode fragment: FSM, gates, sub-sessions, journal, run directory. | The process — decomposition, gating, wave scheduling — on top of the same advice. |

### Why the middle arm is what makes a win attributable

Without `doctrine`, a conductor win has two explanations and no way to separate
them: the process might be doing the work, or the doctrine text riding along
inside it might be. Those are different products. Doctrine is a prompt file; the
conductor is a plugin with a state machine, a gate layer and sub-session
orchestration, and it costs far more to build and far more to run.

`doctrine` holds the advice constant and removes the machinery. So:

- **conductor > doctrine > baseline** — the process adds something the advice
  alone does not. That is the finding the conductor is built to produce.
- **conductor ≈ doctrine > baseline** — the advice is doing the work and the
  machinery is buying wall clock and tokens for nothing.
- **conductor < doctrine** — the machinery is costing more than it returns.

Only the first is a win for the conductor, and only the middle arm can tell the
three apart.

**Two declared asymmetries** are part of the process under test and cannot be
removed without changing what `conductor` is, so they qualify every number:

- **sampling** — the plugin sets temperature per request from its own role table
  (implementer 0.4, mechanical 0.1, orchestrator 0.4, planner 0.7, reviewer 0.3,
  skeptic 0.3, testWriter 0.5); a plugin-absent arm gets the server default for
  every request.
- **sub-agent availability** — conductor spawns its own sub-sessions and denies
  the built-in `task` tool; a vanilla session keeps it.

The report renders both under `## Declared asymmetries` above every table.

---

## 6. Scoring

### 6.1 Mechanical — the hidden test's exit status, passed through

`score_cell` is the whole of it:

| Condition | Outcome |
|---|---|
| spawn failure | `harness-error` — the harness failing, never the model failing, so it is kept out of the fail bucket even when an exit code is present |
| killed on the clock | `timeout` — process cost, not a wrong answer |
| exit 0 | `pass` |
| any other exit | `fail` |

No partial credit, no output parsing, nothing model-graded. Hidden files are
materialized **after** opencode exits, so no ordering accident can put the
measurement inside the tree the model reads.

Every gate in this corpus is therefore **binary**. Each seed's failure set is
calibrated and each all-pass state is proved reachable by implementing exactly
the named blocks (§7.3), so the gates discriminate rather than flooring every arm
at zero — but an arm that lands one block and misses the other scores identically
to one that lands neither. `regex-engine-py` is the sharpest case: its missing
thread-list simulation is genuinely hard and its lazy-preference bug is two lines,
so a cell can be 97% of the way there and score the same as a cell that did
nothing. Partial credit belongs in a gate that parses each suite's own summary
line, inside `hidden/gauge/` where it leaks nothing. No such gate exists.

The report states **whether two arms are separable, never who won**: at three
repetitions of a binary outcome, calling 2/3 against 1/3 a result would be reading
noise as a finding.

### 6.2 Judged — the hand-scored rubric lane

The driver carries one lane that reads a judgement, and it is separate from pass
and fail:

- **`stratified_review_sample(plan, tasks, per_stratum)`** picks which cells a
  human reads. It strata by (tier, arm) and takes the first `per_stratum` cells of
  each. It is a **pure function of the plan**, so two people asking for it get the
  same cells, and it is drawn from the plan — before anyone knows which cells
  passed. `--review-sample 1` prints it.
- **`RUBRIC_CRITERIA`** is the closed set `structure`, `decomposition`,
  `testQuality`, `deadCode`, `overBuilding`, each scored on `RUBRIC_SCORES`
  `(0, 1, 2, 3)`.
- **`write_rubric` / `validate_rubric`** hold the record shape: a `cellId`, a named
  `reviewer`, a score for every criterion and no criterion outside the set, a
  `findings` list of strings and a `notes` string. One file per reviewed cell.
- **`aggregate_rubrics`** renders per-arm medians in the report's `## Rubric`
  section, beside the pass rates and never folded into them.

### 6.3 If an LLM is ever put in the judging seat, it must be blinded

**Requirement: a judge must see the produced artifact and nothing that identifies
which arm produced it.**

This is not a general caution about model bias. It is structural. A conductor-arm
workspace is **identifiable by inspection**, because the plugin leaves its own
records in the tree it worked in:

- `.conductor/runs/<run-id>/` — one directory per run, created by the plugin;
- `.conductor/runs/<run-id>/journal.jsonl` — the run journal, which the driver
  itself reads back to count sub-sessions, waves and schema retries;
- `.conductor/state/alive.json` — the beacon, carrying a pid, a start time, a
  plugin version and an opencode session id.

None of those exists in a `baseline` or `doctrine` tree. (`.conductor/config.json`
is deliberately seeded into all three, so the trees the arms are compared on are
the same tree; the run directory and the journal are what the plugin writes when
it actually runs.) A `doctrine` tree is identifiable too — it carries
`doctrine-prompt.md`.

So an unblinded judge is not judging output. It is reading a label and then
scoring the label. Any effect the labels carry — expectation, deference to the
more elaborate process, a preference against it — lands directly on the number
the campaign exists to produce, and it lands invisibly, because a labelled judge's
scores look exactly like an unlabelled judge's scores.

A blinded lane therefore has to strip `.conductor/`, `doctrine-prompt.md` and any
arm-named config file from the artifact before it reaches the judge, present cells
in an order that does not encode the arm, and be checked by scoring a set of
deliberately mislabelled cells to confirm the judge is reading the work.

**No such lane exists.** The rubric lane as built is for a human reviewer, and the
same identifiability applies to a human — with the difference that a human can be
told to disregard it and an LLM's compliance with that instruction is the thing in
question. Nothing in the driver strips or shuffles anything today, so the current
lane is unblinded by construction.

---

## 7. The verified state

All of it against the working tree as it stands. Nothing is committed.

### 7.1 The gate

```
$ bash scripts/test-conductor.sh
TAP: tests=1940 pass=1940 fail=0 cancelled=0 skipped=0 todo=0 skipdirectives=0 (node exit=0)
typecheck: OK
bun leg: OK (8 pass)
schema export: OK (router/tests/schemas/)
python leg: OK (Ran 156 tests)
GATE PASS
```

### 7.2 The mechanical scan

```
$ bash scripts/conductor-gate.sh
M5 PASS (192 file(s) scanned, 6 line exemption(s) all live)
```

`scripts/generate_euler_tasks.py` and `scripts/test_generate_euler_tasks.py` are
untracked, and `conductor-gate.sh` collects files with `git ls-files`, so the
repo-wide count of 192 does not include them. They were scanned explicitly and
pass; **re-run `conductor-gate.sh` after the commit** to get them into the
repo-wide count.

`bench/corpus/` sits outside all seven M5 globs and is not scanned.

### 7.3 Both preflight floors, all six manifests

```
$ python3 scripts/conductor_bench.py --verify-tasks --manifest <set> --work-root <scratch>
$ python3 scripts/conductor_bench.py --seed-green   --manifest <set> --work-root <scratch>
```

| Manifest | Tasks | `--verify-tasks` | `--seed-green` |
|---|---|---|---|
| `bench/conductor-tasks.json` | 23 | 23/23 hidden tests exited 1 on the unmodified seed | 23/23 visible suites exited 0 |
| `bench/corpus-euler.json` | 20 | 20/20 | 20/20 |
| `bench/corpus-games.json` | 2 | 2/2 | 2/2 |
| `bench/corpus-perf.json` | 3 | 3/3 (at `--verify-timeout 2400`) | 3/3 |
| `bench/corpus-repair.json` | 5 | 5/5 | 5/5 |
| `bench/corpus-systems.json` | 4 | 4/4 | 4/4 |
| **Total** | **57** | **57/57**, every manifest printing `every hidden test failed on its unmodified seed`, exit 0 | **57/57**, every manifest printing `every seeded repository starts green`, exit 0 |

**Reachability, proved per task rather than argued.** For every ported task, an
implementation of exactly the named unimplemented blocks — and nothing else — was
written in a throwaway copy and run through the real gate:

| Task | Seed score | With the named blocks implemented |
|---|---|---|
| `json-parser-py` | 604/627 | 627/627, gate exit 0 |
| `regex-engine-py` | 840/884 | 884/884, `RESULT PASS` in 0.8 s |
| `resp-server-py` | 752/869 | 869/869, exit 0 |
| `bytecode-vm-py` | 1039/1077 | 1077/1077, exit 0 |
| `date-range-scheduler-ts` | 45/54 | 54/54, hidden exit 0, visible exit 0 |
| `ledger-rounding-py` | 79/109 (pytest granularity) | 109/109, hidden exit 0, visible exit 0 |
| `lru-cache-eviction-cpp` | 21/29 | 29/29, warning-free under `-Wall -Wextra -Wpedantic -Wshadow -Wnon-virtual-dtor` |
| `grid2048-headless-py` | 10/24 | 24/24 |
| `knn-search-cpp` | x1.02 | **x221.72**, correctness exact, gate exit 0 |
| all 20 euler tasks | gauge red | 20/20 gauges exit 0, slowest 1.0 s (problem 14); a `return 1 + 1` solver fails with two named failures |

**Not proved end to end:** `config-schema-migration-ts` and `http-client-v2-py`
(performing the migration *is* the task, and neither was performed —
see §8), `log-aggregation-py` and `etl-pipeline-py` (no optimised implementation
was written for either), and `snake-headless-py` (its expectations were proved
against a reference, but no arm-shaped solve was run through the gate).

### 7.4 The live three-arm result

One driver process, one task, one repetition, three arms, against the real
`llamacpp/qwen3.8-27b` served at a 32768-token per-slot window through
llama-router. `euler-001-py`, directory-sourced, T1. Total 61 minutes.

```
$ python3 scripts/conductor_bench.py --manifest bench/corpus-euler.json \
      --model llamacpp/qwen3.8-27b --task euler-001-py --reps 1 \
      --work-root <scratch>/work --results-dir <scratch>/results \
      --report <scratch>/report.md --run-manifest <scratch>/run-manifest.json

cells executed 3, reused 0, recorded 3
```

| Arm | outcome | exit | wall clock | tokens (prompt / completion / total) | router errors |
|---|---|---|---|---|---|
| `baseline` | **pass** | 0 | 163,113 ms (2.7 min) | 58,835 / 2,083 / 60,918 | 0 |
| `doctrine` | **pass** | 0 | 841,352 ms (14.0 min) | 251,482 / 10,861 / 262,343 | 0 |
| `conductor` | **fail** | 1 | 2,631,521 ms (43.9 min) | 299,522 / 37,530 / 337,052 *(partial)* | 0 |

Conductor process metrics: `schemaRetries` 4, `subSessions` 4, `waves` 4,
`overridesUsed` 0, `pluginAbsent` false. 43.9 min is **under** the T1 ceiling of
2700 s, so this is a fail and not a timeout; `timeouts=0` across the run.

Report, verbatim:

```
| Task         | baseline   | doctrine   | conductor  |
|---|---|---|---|
| euler-001-py | 1/1 (pass) | 1/1 (pass) | 0/1 (fail) |

| Task         | Arm pair               | ranges      | separable |
|---|---|---|---|
| euler-001-py | baseline vs conductor  | 1/1 vs 0/1  | yes       |
| euler-001-py | doctrine vs conductor  | 1/1 vs 0/1  | yes       |
```

**Why the conductor arm failed.** It never left INTAKE and wrote no `p001.py`. Its
mechanical classifier sub-session failed four times: twice schema-invalid —
verbatim, `response was not parseable JSON: JSON Parse error: Expected '}'` — and
once on the 900-second watchdog (`subsession.abort`, `watchdog-timeout`). When it
finally returned valid JSON the FSM rejected it:

```
item "I1" is too large: its acceptance spans 7 clusters
(src/solvers/p001.py, p001.py, src/solvers/__init__.py, solve, module,
 src/registry.py, tests/check_visible.py), over the one-cluster item budget
- split it into one item per cluster (§3.2)
```

Four of those seven are not distinct files: `p001.py` duplicates
`src/solvers/p001.py`, `solve` is a function name, `module` is a generic noun, and
`src/registry.py` and `tests/check_visible.py` are do-not-change files. **The
cluster extractor treats free-text acceptance tokens as file clusters.** The
orchestrator itself behaved correctly downstream of that: it bounded its attempts,
refused to spend override budget on a run-stage gate, and named the blocker. The
defect is reported here and is **not fixed**.

**Two preflight defects were found by that run and both are fixed:**

1. The running `llama-server` held a stale in-memory preset list from before
   `[qwen3.8-27b]` was added to `.data/configs/llama-models.ini`, so the model was
   not servable. Repaired in place with the designed mechanism — `GET /models?reload=1`,
   then `POST /models/load` — with no restart and no kill.
2. `build_conductor_cell_config` wrote `logging.level: "info"` into every cell's
   `.conductor/config.json`, contradicting the runbook. `conductor/adapter/tools.ts`
   journals a read-shaped allow at `debug` and only an R3 side effect at `warn`, so
   at `info` the campaign's central question — what did each arm reach — has no data
   behind it. Corrected to `"debug"`, test-first (10 subtests red on
   `'info' != 'debug'`). **Proved load-bearing at runtime:** the conductor cell's
   journal holds 56 lines, 14 of them `debug`, and all 14 are `gates:allow` —
   `bash/read/R0` ×2 and `read/R0` ×5 among them. At `info` this run would have
   recorded zero reach data.

The run manifest recorded the narrowing correctly: `filters.partial` true,
`filters.taskIds` `["euler-001-py"]`, `taskIdsByTier.T1` one selected against
`manifestTaskIdsByTier.T1` of twenty, top-level `partial` true, and the report
opened with the selection banner.

### 7.5 The acceptance checklist

```
$ bash scripts/verify-acceptance.sh
18 PASS   3 FAIL
 failing rows:
   - row 8: docs/build/artifacts/conductor-report.md missing
   - row 12: manifest commits — missing: 14.2; duplicated: none
   - detector E: live artifact(s) missing: docs/build/artifacts/conductor-report.md
```

All three trace to one root cause and **predate this work**: `docs/build/STATE.json`
records task 14.2 as `NOT_STARTED`, so the 14.2 POC report has never been produced
and its commit is not in the log. `git log --all -- docs/build/artifacts/conductor-report.md`
is empty, proving the file was never committed and nothing deleted it. No
acceptance row went red because of the corpus migration.

### 7.6 Working tree

```
$ git status --short
 M README.md
 M bench/conductor-tasks.json
 M docs/build/HANDOFF.md
 M docs/build/LAUNCH-RUNBOOK.md
 M docs/user/benchmarking.md
 M scripts/README.md
 M scripts/conductor_bench.py
 M scripts/test_conductor_bench.py
?? bench/corpus-euler.json
?? bench/corpus-games.json
?? bench/corpus-perf.json
?? bench/corpus-repair.json
?? bench/corpus-systems.json
?? bench/corpus/
?? scripts/generate_euler_tasks.py
?? scripts/test_generate_euler_tasks.py
```

Nothing is committed. No `docs/build/STATE.json` or `GATES.json` entry exists for
this work: a `commitMessage` written into `STATE.json` becomes a
`verify-acceptance` row-12 obligation the moment it is written, and a `COMMITTED`
task with no `GATES.json` M1–M9 record reds gate-record-completeness. Both belong
to whoever lands this.

### 7.7 Corpus hygiene

- **Model.** Every manifest declares `llamacpp/qwen3.8-27b` in `defaults.model`,
  `sweep.primaryModel` and `sweep.models`, and `defaults.model` must be one of
  `sweep.models` or the manifest is refused at load. `bench/corpus/` carries 40
  occurrences of `qwen3.6-27B` across 22 files — `{{RUN_ID}}` substitution examples
  inside archival copies under `docs-generation/` and
  `tui-games/{prompts,acceptance}/`, byte-identical to their source by design,
  plus `DEFERRED.md` recording that fact. **None sits inside any task's `seedDir`
  or `hiddenDir`**: a grep for `qwen3.6`, `qwen3-coder`, `ornith` and
  `embeddinggemma` over all 49 distinct seed and hidden directories the six
  manifests name, and over all 57 prompts, returns zero hits. None can reach a
  seeded work tree or a live run.
- **Leakage.** All 57 tasks are path-disjoint, and this is enforced at load
  rather than audited afterwards: `_parse_task` refuses a task whose hidden file
  set shares a relative path with its seed ("a hidden test the model can read
  measures nothing") and refuses a `hiddenDir` that is, contains, or sits inside
  its `seedDir`. Every manifest that loads is disjoint by construction. Every task
  carries hidden material found nowhere in its seed. The 30 content duplications a
  first pass flagged are all benign and were each opened: a shared test runner
  (`gauge/run.py` is byte-identical to the seed's `tools/run_tests.py`, which is a
  unittest loader carrying no expected values), a `gauge/pristine/**` frozen copy
  of the seed's baseline that the perf gates diff against, and repair tasks' visible
  tests re-run by the hidden gauge alongside carved ones. The actual graders —
  `check_spec.py`, `spec.cpp`, `spec.test.ts`, `gate.py`, `cases/**` — appear in no
  seed. **The load-bearing proof is §7.3: a seed holding answer material could not
  produce a hidden test that exits 1.**
- **Cell isolation.** The default work root is `<tmpdir>/llama-harness-conductor-work`,
  outside the repository, and any work root resolving inside `REPO_ROOT` is refused
  in every mode. Without that, a cell's cwd sits a constant number of `..` segments
  from every graded gauge under `bench/corpus/**/hidden/**`.

---

## 8. Known limits, and the honest next actions

### 8.1 The measurement

- **Every gate is binary.** Partial credit exists nowhere. Calibration data exists
  for each seed (§7.3), so a threshold gate parsing each suite's summary line would
  be cheap and belongs in `hidden/gauge/`. **Next:** build one for the four
  systems tasks and `grid2048-headless-py`, whose summary lines already carry a
  pass rate.
- **`etl-pipeline-py`'s 4.0x is the one threshold not calibrated against a real
  solve.** No reference solution to that task exists in the source material. The
  evidence for 4.0 is its rubric's band table and one measurement here — the
  corpus's own deliberately-most-obvious single-threaded implementation runs at
  x2.3 — so 4.0 is above "transcribe the obvious implementation" and nothing
  stronger is claimed. If the first real solve lands at 3.5x the gate floors every
  arm; at 9x it does not discriminate. It is one named constant pinned against the
  prompt by a test. **Next:** write one genuine solve and re-check the number
  before running a campaign on that task.
- **`knn-search-cpp`'s calibration is half-reproduced.** The reference wall clock
  (36–38 s here against a published 37.43 s) and the threaded upper end (x221 here
  against a published x206) were measured. The ~22x single-threaded datum — the one
  that makes 40x discriminating rather than merely passable — is the source
  corpus's own README figure and was **not** re-measured. `bench/corpus-perf.json`'s
  `selectionCriteria.whereTheThresholdsComeFrom` currently reads as if it were.
  **Next:** measure it, or reword that field.
- **The euler set has a recall ceiling the gauge cannot close.** All 20 problems sit
  in 1–25, the most reproduced set in existence. The constant folder catches every
  mechanical shape of recall — a literal, a sum of literals, concatenated digits
  through `int()`, name-bound halves, a constant parked in a helper module — and
  the import allowlist catches reading it from a file or the environment. What it
  cannot see is a derivation recalled whole and written out as working code. Only
  1 of the 20 (problem 14) is on the corpus's brute-force-proof subset. **Read a
  high pass rate here as a statement about the harness, not about mathematics.**
- **`config-schema-migration-ts` and `http-client-v2-py` measure completeness, not
  quality.** Both reduce to reference counts plus a frozen suite plus a byte floor
  on a decision log. A thin typed view satisfying the two greps scores identically
  to the declarative schema the spec asks for, and a 1000-byte
  `MIGRATION-NOTES.md` of boilerplate scores the same as twelve resolved decisions.
  Neither gauge reads the twelve open questions. The corpus scored those with a
  human rubric; the rubrics were not carried across.
- **`DIAGNOSIS.md` is asked for by all three repair prompts and graded by nothing.**
  It costs tokens and wall clock and contributes zero to pass or fail. It is kept
  because dropping it changes the corpus task (15 of its 100 rubric points), and
  each task's rationale says so — but it inflates the cost datum relative to a task
  whose deliverables are all measured.

### 8.2 The tasks

- **The repair carve destroys the corpus's own premise, deliberately.** All three
  repair prompts say "The failing test suite is the specification." The
  fault-proving tests were moved into `gauge/` because a red visible suite fails
  `--seed-green` **and** wedges every conductor item at RED — `build_conductor_cell_config`
  uses `repoTestCommand` as both the scope command and the per-item `itemTest`. An
  authored `BUGS.md` of four symptom reports per task replaces the premise, so the
  measurement is "repair a fault from a symptom report", not "localise a fault
  from a failing test". Those are different capabilities. **Next:** anyone who wants
  the corpus's original measurement has to change one of those two invariants
  first, not the port.
- **Each repair task has a visible suite smaller than its graded one**
  (45 vs 54, 58 vs 74, 21 vs 29). A conductor item can mark green having repaired
  nothing the graded suite measures. That is the intended shape, but it means the
  conductor arm's own green signal is materially weaker on these three than on a
  task whose two suites agree.
- **Three ported tasks are narrowings of their corpus originals.** `json-parser-py`
  is difficulty 8 / XL / build-from-spec in the corpus; here it is "implement R-11
  and R-16 without regressing anything". Same shape for `regex-engine-py`,
  `bytecode-vm-py` and `grid2048-headless-py`. This is forced, not chosen:
  `--seed-green` requires the seed to pass its own visible suite, the only visible
  suite each corpus task ships is its reference-io exchanges, and a seed passing
  those is necessarily most of the way to conforming. The alternatives were a
  weaker seed-green signal or authored sabotage. Each manifest's `rationale` states
  the scope.
- **Roughly 3% of `snake-headless-py`'s gate and 12% of `grid2048-headless-py`'s is
  readable from the seed,** as are nine of `json-parser-py`'s 627 expected canonical
  forms. Every one is a worked example in the seeded specification's own tables —
  the corpus publishes them deliberately — and removing them would gut the normative
  document the task is built against. Disclosed in each manifest's
  `preAnsweredMaterial` / `hiddenTests`.
- **`snake-headless-py` measures the pure-rules half only.** Terminal hygiene (15
  points), loop discipline (15) and code structure (5) of the corpus's rubric need
  a TTY, signals and CPU-time sampling — around a third of it, unmeasurable
  headlessly.
- **`regex-engine-py`'s graded run is wall-clock sensitive.** Thirteen `pathological`
  cases fail on a per-case limit and each restarts the harness, so the seed spends
  ~40 s there and the run's duration depends on machine load. A correct Pike VM has
  roughly 10x headroom on the five throughput floors, so the risk is to a
  nearly-correct arm, not a correct one.
- **`resp-server-py` needs loopback bind permission and can leak a port.** Its
  runner picks a free ephemeral port, launches with `start_new_session=True` and
  kills the process group on the way out; a cell killed between those points leaves
  an orphan server. Its `MAX_RESTARTS` of 10 is deliberate signal — a badly broken
  arm reports fewer than 869 attempted cases.
- **`bytecode-vm-py` writes 1045 files per cell,** against roughly 20 for every
  other task. 550 KB, far under the 8 MiB ceiling, but if cell setup time ever
  matters this is where it shows.
- **The perf gates leave large workloads behind if killed.** Each generates its
  timing workload under `gauge/work` and deletes it in a `finally` block —
  log-aggregation 275 MiB plus two 15 MiB reports, etl ~120 MiB, knn 51 MiB. A gate
  killed by the harness timeout skips the `finally`. Across 27 cells a run of
  timeouts could leave several GiB.
- **Three seeds were calibrated against the hidden suites,** which is the only way
  to calibrate them, but it means each is tuned to pass everything it was meant to
  pass. No input is special-cased by bytes, length or identifier, and no seed
  contains case data or a case identifier. Three real bugs surfaced in that loop and
  were fixed; any bug neither the visible check nor the hidden suite catches is
  still in there.
- **The corpus tier ladder is narrow and the language mix skews hard to python.**
  Of the 34 ported tasks, 30 are python, 2 ts and 2 cpp; by tier they are T1×21, T2×7, T3×5, T4×1, and T0 is empty.
  `bench/conductor-tasks.json`'s `languageMix` claim is about that manifest;
  combining the sets skews the mix.

### 8.3 The harness

- **The conductor arm's cluster extractor treats free-text acceptance tokens as
  file clusters,** which is what failed the one live conductor cell (§7.4). A
  function name, a generic noun and a duplicated path each counted as a cluster
  against a one-cluster item budget. **This is the highest-value open defect: it is
  not a task problem, it is in the process under test, and it will recur on any
  task whose acceptance text names anything other than a bare path.**
- **Cell isolation is a work-root move, not a sandbox.** The default work root sits
  outside the repository and an inside-repo root is refused, which closes the
  accidental vector — an arm walking up looking for a project root lands among
  other cells' work trees. But opencode's permission vocabulary has no read-path
  deny, and the conductor arm's own per-cell config names this repository's
  absolute path (the fragment loads the plugin from
  `${LLAMA_HARNESS_ROOT}/conductor/plugin/index.ts`), so an arm that goes looking
  for the corpus on purpose can still find it. **Read a corpus lane's pass rate with
  that in mind.** Closing it means vendoring `conductor/{plugin,core,adapter}` into
  each cell home and repointing the fragment, then proving a conductor cell still
  gates — which needs a live opencode run.
- **`--report-only` under a selection has no dedicated test.** The path is coherent
  (results are filtered by the selected tasks and the rubric lane does not leak
  out-of-selection cells), but only the unfiltered `report_only` path is covered.
- **`_missing_lines` does not hold the plan.** Under a selection its sentence is
  true, but a cell dropped from the plan for any other reason is still
  indistinguishable from one that ran and left no row.
- **No task depends on `pytest`.** `ledger-rounding-py` runs on standard-library
  `unittest` precisely because a cell's `HOME` is redirected and
  CPython derives the user site directory from it, so a per-user `pytest` install
  is invisible inside a cell. `default_test_runner` runs hidden and visible
  commands under the same scrubbed homes the model's process gets, so
  `--verify-tasks` and `--seed-green` cannot report green on a task that only
  runs on the operator's machine.

### 8.4 Immediate next actions

1. **Fix the cluster extractor** (§8.3). It is the only defect standing between the
   conductor arm and a scored T1 result.
2. **Commit this work**, then add its `docs/build/STATE.json` and `GATES.json`
   entries together, and re-run `scripts/conductor-gate.sh` so the two untracked
   scripts enter the repo-wide count.
3. **Run both preflight floors over all six manifests** immediately before any
   campaign, not once and then trusted — the seeds are directory-sourced and a
   stray artifact under `bench/corpus/` changes what loads.
4. **Write one genuine solve for `etl-pipeline-py`** and re-check its 4.0x, or drop
   that task from the first campaign.
5. **Decide whether a threshold gate is wanted** before the campaign, not after: it
   changes what the numbers mean and cannot be applied retroactively to binary
   results.
6. **Do not put an LLM in the judging seat without building the blinding lane
   first** (§6.3). The rubric lane as it stands is unblinded by construction.
