# tui-games and docs-generation: what is not built yet, and why

This file covers two categories of material under `bench/corpus/`:
`tui-games` and `docs-generation`. The other categories there are not its
subject.

It is the record of what that material is, what has not been built from it, and
why. Everything named below sits in `bench/corpus/` as source material, and
none of it is a task in `bench/corpus-games.json`. A task that cannot be scored
without the model supplying part of its own answer key does not belong in an
A/B comparison: both arms pass it, the cell cannot fail, and it dilutes every
real task it is averaged with. That failure mode looks exactly like completed
work, which is why it is written down rather than left implicit.

Two tasks were authored and are in the manifest: `snake-headless-py` and
`grid2048-headless-py`. Six tui-games tasks and all five docs-generation tasks
are not.

---

## Why the tui-games tasks cannot be ported as written

The corpus's tui-games category is **self-graded by construction**. Every one of
its eight `task.json` files lists both the input scripts and their expected
outputs under `artifacts`, which is the list of things the model is asked to
produce:

| task | expected files the model writes |
|---|---|
| `snake` | `scripts/demo.expected.json`, `scripts/eat.expected.json`, `scripts/crash-wall.expected.json`, `scripts/crash-self.expected.json` |
| `tetris` | `expected/conformance-a.seed12345.json`, `expected/conformance-b.seed777.json` |
| `minesweeper` | `expected/loss.json`, `expected/win-autoplay.json`, `expected/no-guess.json` |
| `roguelike` | `tests/expected/smoke.json`, `tests/expected/descend.json`, `tests/expected/combat.json` |
| `game-engine` | `expected/snake-basic.json` and five more |
| `netplay-arena` | `scripts/clean.expected.json`, `scripts/lossy.expected.json` |
| `2048-solver` | `scripts/vector-01.expected.json` … `vector-04.expected.json` |

The snake prompt says so outright: "Generate these files by running your program;
never hand-write one." The scorer then runs the model's own `test.sh`, which
compares the model's output against those files. `tools/score.py` carries answer
keys for `advent-of-code` and `project-euler` only and returns an empty map for
every other category, and its own module docstring states the limitation:
"Nothing here judges code quality. The rubric-scored categories
(docs-generation, tui-games, concurrency-bottlenecks) get their mechanical half
from this tool and their judged half from a separate review pass."

`tui-games/solutions/` and `docs-generation/solutions/` each contain a single
`.gitkeep`, so there is no reference implementation to grade against either.

The corpus's actual defence is a **cross-language majority vote** over five
language implementations plus a human reviewer. The tetris prompt is explicit:
"They are cross-language conformance vectors: the operator compares your
summaries against those produced by other language implementations of this same
task." With one language that collapses to self-consistency, and the tetris
acceptance file concedes it: "If only one language was run, this criterion is
scored on repeat-run determinism and script/expected-file fidelity alone."

A conductor bench cell runs one language, has no human in the loop, and no
existing bench task uses a Rust or Go toolchain. So the vote is unavailable, and
the only honest port is to author a hidden gauge from scratch.

## What authoring a gauge requires, and where it stops

An authored reference implementation is only usable as an oracle if the
specification pins enough ground truth to prove the reference itself correct. A
reference that is subtly wrong fails every arm identically, and the result reads
as a model regression rather than a harness defect.

That test is what separated the two tasks that were authored from the six that
were not.

- **snake** pins two full generator sequences, three first-food cells, a speed
  table, and a 1061-byte worked summary line. A reference written from the
  specification alone reproduced all of them, plus the two seed-independent
  operator vectors in the corpus's own acceptance file. Authored.
- **2048** pins three generator vector rows, five initial boards, a twelve-row
  merge table, and three complete summary lines the prompt calls authoritative:
  "The expected values below are authoritative — they are what a correct
  implementation of R3 through R14 produces. If yours disagrees, yours is
  wrong." A reference reproduced all three byte for byte. Authored, mechanics
  only — see below.

---

## Declined: `tetris`

**Reason.** The only whole-output oracle in the prompt is one SHA-256 of an
empty board. Everything that carries the difficulty — the SRS wall-kick tables,
the thirty-tick lock-delay budget, back-to-back, combo scoring — is specified in
prose with no pinned summary to check a reference against. The two conformance
files the prompt pins "byte for byte" are the *input* scripts, not the answer
keys; the answer keys are model artifacts.

**What would have to be authored.** A 600 to 900 line reference tetris covering
SRS rotation with all four kick tables, lock delay with its move-reset budget,
line-clear scoring with back-to-back and combo, and the seven-bag randomiser —
and then, because there is no golden to check it against, a second independent
implementation to cross-check it, which is the corpus's own method. Plus the
seed, the visible suite and the hidden gauge.

**Note.** `bench/conductor-tasks.json` already carries `tetris-py`, a smaller
falling-block task in the same shape. A full-fidelity tetris would add a fourth
terminal-game task to a family that already has three.

## Declined: `tetris-enhanced`

**Reason.** Structurally incoherent under A/B, not merely expensive. Its
`task.json` carries `"seed_from_task": "tetris"` with the note "Seeded by
copying this same run's completed 'tetris' workspace for the same language. If
that workspace does not exist or did not pass, the task is SKIPPED rather than
attempted from scratch." Each arm would therefore be seeded from its own prior
output, so the three arms would not be solving the same problem and the
comparison is void by construction.

**What would have to be authored.** Nothing that would fix it. A fixed seed
workspace shared by all three arms would make it a different task — an
enhancement task over one frozen tetris — which is a reasonable task to write
but is not this one. It is called out here because it has a `task.json`, a
prompt and an acceptance file, so it reads like a normal task to anyone
skimming.

## Declined: `2048-solver`, the solver half

**Reason.** The game half is in the manifest. The solver half is not, because it
cannot be specified to a fixed answer: "You may tune them. Whatever you end up
with must be reported in `BENCHMARK.md`." Its bar is statistical — reach 2048 in
at least 18 of 20 fixed-seed games, average at least 20000 points, inside a
per-move time budget — which is a measurement of search quality under a wall
clock, not a conformance check, and it would put a multi-minute compute
benchmark inside a cell whose cost is the other thing being measured. The
fourth recorded vector, the only one exercising the solver, has no authoritative
value in the prompt for exactly this reason.

**What would have to be authored.** A benchmark harness with its own wall-clock
budget and a per-arm statistical threshold, and a decision about how a timed
search interacts with the cost side of the A/B. Both are real design questions,
not transcription.

## Declined: `minesweeper`

**Reason.** No pinned whole-output oracle. The prompt pins the generator
("Implement exactly this generator") and nothing else at summary level, so an
authored reference could be validated on its first-board layout and on nothing
downstream of it. The no-guess board generator is a solver in disguise — it
must prove a board logically solvable — and a reference for it is unfalsifiable
work against this corpus.

**What would have to be authored.** A reference minesweeper including the
constraint-propagation no-guess generator, and an independent oracle for it,
since the prompt supplies none.

## Declined: `roguelike`

**Reason.** The prompt pins an FNV-1a digest function with test vectors
(`""` → `cbf29ce484222325`) but no complete summary. The digest being right
proves the hash is right, not that the map, the field of view, the combat
resolution or the level generation are. Reference cost runs to days with no
oracle at the end of it.

**What would have to be authored.** A reference roguelike — level generation,
field of view, combat, descent — plus an independent cross-check, plus the seed
and gauge.

## Declined: `game-engine`

**Reason.** No pinned ground truth of any kind in the prompt, and the task is to
build an engine that then hosts two games, so a gauge would have to pin an
engine API the corpus deliberately leaves to the implementer.

**What would have to be authored.** An engine API specification that does not
exist yet, then a reference against it, then the gauge. That is designing a new
task, not porting one.

## Declined: `netplay-arena`

**Reason.** Two reasons, either sufficient. It needs real sockets — a headless
authoritative server plus clients over TCP — which a hermetic cell should not be
opening, and the seeding path writes no execute bits so its
`build.sh`/`run.sh`/`test.sh` contract cannot run as written. And it has no
pinned summary oracle: the prompt pins orderings and a digest scheme, not
values.

**What would have to be authored.** A reference server and client, a
deterministic transport that is not a socket, and an oracle for the
reconciliation the task is actually about.

---

## Declined: all five docs-generation tasks

`adr-reconstruction`, `api-reference`, `architecture-overview`,
`onboarding-guide`, `subsystem-deepdive`.

Three independent reasons, each sufficient on its own.

### 1. The mechanical check is a lint that filler passes

`docs-generation/check_docs.py` was run against a document built for the purpose:
one filler sentence repeated, carrying deliberately false claims — "Wibble
frobnicates the zorch table on every startup", "The garble subsystem is entirely
imaginary and has no code" — each cited to an arbitrary in-range line of a file
in a throwaway checkout. Under the `architecture-overview` verify arguments it
reported

```
citations: 32 total, 32 valid, 0 invalid, validity rate 100.00%
sections: 8 required, 0 missing
words: 2119 outside fenced blocks (2134 including them), allowed range 2000..4000
mermaid blocks: 2 (minimum 2)
open questions section: yes

PASS
```

and exited 0. The same document with every citation stripped also exited 0, with
"no citations found in the document" recorded as a *warning*.

`check_citations` resolves the path and checks that the line number is within the
file's length. It never reads the cited line. The failure set is exactly four
items — invalid citations, missing sections, word count out of range, mermaid
problems — and fabricated paths, over-long ranges, a missing Open-questions
section and having no citations at all are warnings that do not fail the run.

A cell whose hidden test passes on filler cannot distinguish arm A from arm B.

### 2. Sixty per cent of the score is an LLM judge that does not exist here

`docs-generation/rubric.md` states: "Each task scores out of 100: 40 mechanical,
60 judged." The judged axes are J1 Accuracy, J2 Completeness, J3 Usefulness, J4
Structure and J5 Honest uncertainty. Part of the mechanical 40 is unimplemented
as well — the rubric describes front-matter agreement, per-entry sub-structure,
`symbols.txt`-versus-index consistency, commit-hash resolution and command
executability as checks "the scorer layers on top", and none of them exists in
`check_docs.py` or `tools/score.py`.

`scripts/conductor_bench.py` scores a cell by the hidden test command's exit
status, with no partial credit and nothing model-graded. There is no place in
that lane for a judged 60.

### 3. It is not runnable offline

`docs-generation/targets/checkouts/` does not exist and is gitignored.
`tools/fetch_docs_targets.sh` git-fetches six repositories from github.com at
pinned SHAs — roughly 1.2M lines between duckdb, etcd, valkey, vite, fastapi and
ripgrep — with an unshallow-to-full-history fallback when a server refuses a raw
SHA fetch. The pins sit on moving branches (`unstable`, `master`, `main`), so a
force-push or a garbage collection upstream makes a pin unreachable and the
fetch dies. Building a bench task on that makes a supposedly reproducible
comparison depend on six third parties' branch hygiene.

Even with the checkouts pre-warmed, `check_docs.py` consults the filesystem when
deciding whether an extensionless token looks like a path, so the same document
scores differently against different checkouts. Any number quoted from a docs
run is meaningful only alongside the exact checkout SHAs.

### Where a docs task would be scored instead

Not by exit status. The bench already carries a hand-scored lane — a stratified
review sample, one rubric record per reviewed cell, per-arm medians in the
report — and that is the only lane in the driver that reads a judgement.
`bench/corpus/docs-generation/RUBRIC-LANE.md` documents exactly how a
docs-generation deliverable would be routed through it, what the sample would
be, what the five criteria would mean for prose, and the one thing that would
have to change in the driver first.

### What would have to be authored to make it mechanical instead

A hidden checker that reads the cited lines rather than counting them: for each
citation, fetch the cited span from the checkout and test that the claim it
supports is entailed by it. That is either an LLM judge — the thing this bench
deliberately excludes — or a hand-built answer key of claim-to-span pairs per
target, per task, which is the corpus's missing 60 points written out by hand.
Plus a vendored or content-addressed checkout so the cell is hermetic.

---

## What is here

| Path | What it is |
|---|---|
| `tui-games/prompts/` | All eight tui-games prompts, verbatim |
| `tui-games/acceptance/<task>/` | The `task.json` and `acceptance.md` for each of the eight |
| `tui-games/snake-headless/` | Authored seed and hidden gauge, in the manifest |
| `tui-games/grid2048-headless/` | Authored seed and hidden gauge, in the manifest |
| `docs-generation/prompts/` | All five docs-generation prompts, verbatim |
| `docs-generation/rubric.md` | The corpus's scoring rubric, verbatim |
| `docs-generation/README-corpus.md` | The corpus's own category README, verbatim |
| `docs-generation/check_docs.py` | The mechanical checker, verbatim, as the evidence for section 1 above |
| `docs-generation/task-definitions/` | The five `task.json` files |
| `docs-generation/targets/targets.json` | The pinned target manifest |
| `docs-generation/targets/.gitignore` | The corpus's own rule: `checkouts/` is never committed |
| `docs-generation/fetch_docs_targets.sh` | The fetch script, which is versioned material under that same rule |
| `docs-generation/RUBRIC-LANE.md` | How a docs task would be scored through the existing human rubric lane |

Every file in `tui-games/prompts/`, `tui-games/acceptance/`,
`docs-generation/prompts/`, `docs-generation/rubric.md`,
`docs-generation/README-corpus.md`, `docs-generation/check_docs.py`,
`docs-generation/task-definitions/` and `docs-generation/targets/targets.json`
is byte-identical to its source, which was checked with `cmp` rather than
assumed. They are archival copies and are not edited here, so their
`{{RUN_ID}}` examples still name `qwen3.6-27B` — a model this campaign does not
serve. Rewriting them would make the copy diverge from the thing it exists to
preserve. The manifest, the two seeds, the two gauges and the two documents in
this list name only `llamacpp/qwen3.8-27b`.

Third-party source is not here and must not be: the corpus's non-redistribution
policy versions the fetch script and never the fetched trees, and
`docs-generation/targets/.gitignore` carries that rule in a form that survives
being copied under any prefix. The fetch script is reference material at this
path — it resolves its paths against the corpus's own root and would need
re-rooting to run.
