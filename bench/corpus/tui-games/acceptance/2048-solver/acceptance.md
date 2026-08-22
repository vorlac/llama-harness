# Acceptance — `2048-solver`

Operator-facing companion to `tui-games/tui-2048-solver-prompt.md`. That prompt
is the normative text handed to the model; this file tells you how to seed,
drive and judge a run. Requirement identifiers (`R7`, `C3`, …) refer to it.
Repository-wide rules — run IDs, workspace layout, `run.json`, the script
contract, read-only task material, scoring — are in `CONVENTIONS.md`.

Task material in this directory is pristine reference (`CONVENTIONS.md` §10).
Nothing here is copied into the workspace: `starting_material` is `null` and this
is a greenfield build.

---

## 1. Seeding a workspace

```sh
tools/new_workspace.sh <run-id> 2048-solver <language>
# e.g.
tools/new_workspace.sh qwen3.6-27B__llama-harness 2048-solver rust
```

Produces `tui-games/solutions/qwen3.6-27B__llama-harness/2048-solver/rust/` with
a seeded `run.json`. Hand the model `tui-games/tui-2048-solver-prompt.md`
verbatim, with `{{LANGUAGE}}` and `{{RUN_ID}}` substituted. The expected language
set is `rust`, `go`, `cpp`, `python`, `ts`; run each in its own workspace so the
scorer compares like with like.

---

## 2. Running verification

From the language directory:

```sh
./build.sh                                                   # exit 0, no network
./run.sh --selftest                                          # exit 0, ten named checks
./run.sh --headless --script scripts/vector-01.txt --seed 7  # one JSON line
./test.sh                                                    # the gate: exit 0
```

Timeouts are in `task.json`: build 300 s, run 300 s, test 900 s. `test.sh`
deliberately does **not** run the 20-game benchmark. That is a separate,
operator-driven step:

```sh
time ./run.sh --benchmark --games 20 --seed-start 1
```

Budget an hour of wall clock for a slow language; there is no timeout on this
step because it is not part of `score.py`'s automated pass. Compare its output
against the workspace's `BENCHMARK.md`.

Scorer safety: `score.py` calls `run.sh` with no arguments and no TTY. Per §6.1
of the prompt, that must run a bounded default demo (seed 1, solver autoplay,
100 moves) and exit 0 within 120 s. A workspace whose bare `run.sh` blocks on
terminal input hangs the scorer — treat that as an automatic failure of the
headless-contract criterion and kill the run.

---

## 3. Headless JSON schema

One line on stdout, compact (no whitespace outside string values), keys in
exactly this order, terminated by a single `\n`:

```json
{"schema":"tui-2048/1","seed":7,"grid":[[0,0,0,2],[0,0,0,0],[0,8,2,0],[8,2,4,2]],"score":28,"moves":10,"rejected":1,"undos":1,"ai_moves":0,"max_tile":8,"empty":9,"won":false,"status":"quit","rng_state":"D5336963EEFBA1FF"}
```

| key | type | meaning | rewound by undo? |
|---|---|---|---|
| `schema` | string | literal `tui-2048/1` | n/a |
| `seed` | u64 | seed the run started with | n/a |
| `grid` | int[4][4] | final board, tile face values, row-major, `grid[0][0]` top-left | n/a |
| `score` | int | sum of merge gains | yes |
| `moves` | int | move counter of the current state | yes (undo subtracts 1) |
| `rejected` | int | illegal move commands, whole session | no |
| `undos` | int | undo commands issued, including empty-stack no-ops | no |
| `ai_moves` | int | moves chosen by the solver, whole session | no |
| `max_tile` | int | largest tile on the final grid | n/a |
| `empty` | int | zero cells on the final grid | n/a |
| `won` | bool | `max_tile >= 2048` | n/a |
| `status` | string | `game_over` \| `quit` \| `script_end` | n/a |
| `rng_state` | string | generator `state` word at exit, 16 uppercase hex digits | yes |

`status` precedence: `game_over` if no direction is legal on the final board,
whatever ended processing; else `quit` if a `Q` token stopped it; else
`script_end`.

`rng_state` exists so a generator that has drifted by a single draw is caught at
once instead of showing up as a mysteriously different board 50 moves later. If
a submission's `grid` matches but `rng_state` does not, the spawn protocol (R5)
is wrong — usually a missing second draw when only one empty cell remained.

### Benchmark schema

Per-game lines then one aggregate line:

```
game 1 score=31572 moves=1543 max_tile=2048 won=1 ms_mean=12.400 ms_p99=61.220 ms_max=94.008
{"schema":"tui-2048/bench-1","games":20,"seed_start":1,"wins":19,"win_rate":0.950,"mean_score":31204.6,"median_score":30118.0,"min_score":11020,"max_score":68344,"tile_histogram":{"1024":1,"2048":11,"4096":8},"ms_mean":12.400,"ms_p99":61.220,"ms_max":94.008,"budget_aborts":0}
```

Deterministic (must match across runs and machines): `score`, `moves`,
`max_tile`, `won`, `wins`, `win_rate`, `mean_score`, `median_score`,
`min_score`, `max_score`, `tile_histogram`. Not comparable across machines:
`ms_mean`, `ms_p99`, `ms_max`, `budget_aborts`. Never diff the timing fields
between two runs.

### Authoritative vectors

These three summary lines are computed from the specification and are the
ground truth for R3–R14. Every language implementation must reproduce them
byte for byte; they are how you tell a correct implementation from a
self-consistent wrong one.

| vector | invocation | expected line |
|---|---|---|
| 01 | `--headless --script scripts/vector-01.txt --seed 7` | `{"schema":"tui-2048/1","seed":7,"grid":[[0,0,0,2],[0,0,0,0],[0,8,2,0],[8,2,4,2]],"score":28,"moves":10,"rejected":1,"undos":1,"ai_moves":0,"max_tile":8,"empty":9,"won":false,"status":"quit","rng_state":"D5336963EEFBA1FF"}` |
| 02 | `--headless --script scripts/vector-02.txt --seed 20250820` | `{"schema":"tui-2048/1","seed":20250820,"grid":[[0,0,0,0],[2,0,0,0],[4,2,0,0],[16,8,2,0]],"score":60,"moves":13,"rejected":47,"undos":0,"ai_moves":0,"max_tile":16,"empty":10,"won":false,"status":"script_end","rng_state":"8A8043BCEBEF8B3A"}` |
| 03 | `--headless --script scripts/vector-03.txt --seed 3` | `{"schema":"tui-2048/1","seed":3,"grid":[[128,2,4,8],[2,4,16,2],[16,8,64,8],[4,16,4,2]],"score":1260,"moves":133,"rejected":667,"undos":0,"ai_moves":0,"max_tile":128,"empty":0,"won":false,"status":"game_over","rng_state":"DE8261A4408EDE29"}` |

Vector `04` is authored by the model (solver-driven, `A` with a repeat count) and
is checked only for self-consistency across repeated runs.

Regenerate the vector script files independently if you suspect tampering:

```sh
for i in $(seq 30);  do printf 'L\nD\n';       done > /tmp/v02.txt   # 60 lines
for i in $(seq 200); do printf 'U\nR\nD\nL\n'; done > /tmp/v03.txt   # 800 lines
diff /tmp/v02.txt scripts/vector-02.txt && diff /tmp/v03.txt scripts/vector-03.txt
```

Cross-language check, worth running once the second language lands:

```sh
for lang in rust go cpp python ts; do
  d=tui-games/solutions/$RUN_ID/2048-solver/$lang
  [ -d "$d" ] && (cd "$d" && ./run.sh --headless --script scripts/vector-03.txt --seed 3)
done | sort -u | wc -l    # must print 1
```

---

## 4. Scored criteria and how to check them

Weights match §9 of the prompt and sum to 100.

| Wt | Criterion | How to check |
|---|---|---|
| 20 | Game-rule correctness (R7–R14) | **Mechanical.** Vectors 01–03 byte-exact; `--selftest` checks `row_tables`, `merge_table`, `spawn_init`, `spawn_distribution`, `undo_rewind`, `legality` all pass. Any vector mismatch caps this at 10. |
| 15 | Headless contract and determinism | **Mechanical.** All four modes exist; each vector replayed twice gives identical bytes; bare `run.sh` with `</dev/null` exits 0 under 120 s; exit codes 0/1/2 behave per §6.1. **Inspection:** read `test.sh` and confirm it diffs against committed `.expected.json` files rather than writing them at test time — see failure mode F1. |
| 25 | Solver strength (R31) | **Mechanical.** Run the canonical benchmark yourself: `wins >= 18` and `mean_score >= 20000`. Score partial credit by `wins`: 18–20 full, 15–17 about two thirds, 12–14 about a third, below 12 or `max_tile < 1024` typical, zero. Bonus consideration if `tile_histogram` shows ≥ 8 games at 4096 or above. Zero this criterion if `BENCHMARK.md` cannot be reproduced. |
| 15 | Search implementation quality | **Inspection.** Read the search: chance nodes must weight cells `1/k` and tiles `0.9`/`0.1`; pruning must be the cumulative-probability `< 1e-4` rule of R21, not an arbitrary node cap; depth must come from the R22 table or a documented deterministic alternative; the transposition table must probe on stored-depth ≥ remaining-depth and be cleared or generation-tagged per decision; the heuristic must have all five line terms plus the corner term with non-zero weights. **Mechanical:** `--selftest` `expectimax_depth1` and `solver_pure` pass. Cap at 4 for a greedy one-ply evaluator, a fixed move-priority table, or a Monte-Carlo rollout player, whatever the win rate. |
| 8 | Performance (R26–R28, R30) | **Mechanical.** `ms_p99` within the language budget (100 ms rust/cpp/go, 300 ms ts, 500 ms python), `ms_max` ≤ 2.5× budget, `budget_aborts == 0`. **Inspection:** 65536-entry row tables built at startup, nibble layout per R26, nodes/move and nodes/second reported in `BENCHMARK.md`. |
| 8 | TUI quality and terminal hygiene | **Inspection.** Play it. Every binding in R16; illegal move gives feedback; solver readout shows direction, depth and ms; resize below 40×16 degrades gracefully. **Mechanical:** the `SIGINT` and panic checks in §5 below; `top`/`ps` over a 10 s window shows the process below 2 % of one core while idle at the prompt and while autoplay is paused (C4). |
| 5 | Build and script hygiene | **Mechanical.** `./build.sh` from a clean tree with networking disabled; `grep -rn '/Users/\|/home/\|/tmp/' build.sh run.sh test.sh` finds nothing; scripts are `chmod +x` and start with the required two lines. **Inspection:** dependency manifest contains no forbidden framework (C2) — `ratatui`, `bubbletea`, `textual`, `ink`, `FTXUI`; game rules, bitboard/tables, heuristic, search and terminal layer are separate source units (§7 of the prompt). |
| 4 | Documentation honesty | **Inspection.** `README.md`, `NOTES.md`, `BENCHMARK.md` present; `BENCHMARK.md` covers every item of R33 including the weight vector and the depth policy actually used; stated limitations match what you observed. Zero here **and** on solver strength if the numbers are fabricated. |

---

## 5. Terminal-hygiene checks (C3)

Run all three; each must leave a usable terminal.

```sh
# normal quit
./run.sh            # press q

# SIGINT mid-game
./run.sh & sleep 3; kill -INT %1; wait; stty -a | head -1

# forced abnormal exit
./run.sh & sleep 3; kill -TERM %1; wait; stty -a | head -1
```

After each, `stty -a` must show `echo` and canonical mode enabled, the cursor
must be visible, and typing must echo. If a check leaves the terminal wedged,
`reset` recovers it — and that criterion fails.

---

## 6. Known failure modes for this game

Watch for these specifically; they are what goes wrong on this task.

**F1 — self-certifying tests.** `test.sh` regenerates the `.expected.json` files
from the program's own output and then compares, so it always passes. Check that
the expected files are committed content matching §3's table, and that `test.sh`
only reads them. This is the single most common way this task is faked.

**F2 — merge direction and double merges.** `[4,4,8,0]` moved left must be
`[8,8,0,0]`, not `[16,0,0,0]`; `[8,8,8,0]` must be `[16,8,0,0]`, not `[8,16,0,0]`.
A right move must merge the rightmost pair first. Vector 03 catches all of these,
but the selftest `merge_table` check localises them.

**F3 — spawn draw drift.** Skipping the second `next()` draw when only one empty
cell remains, drawing the value before the cell, using `next() % 100 < 10` for
the 90/10 split (a different consumption pattern), or reseeding per game inside
the benchmark loop. Signature: `grid` right early, `rng_state` wrong, boards
diverging after 20–40 moves. Vector 01 catches it immediately.

**F4 — empty-cell ordering.** Building the empty-cell list in column-major order
or in whatever order a hash set iterates. Row-major is normative (R5). This
produces a plausible-looking but non-reproducible game.

**F5 — undo without RNG rewind.** Undo restores the grid and score but leaves the
generator advanced, so replaying the same move spawns somewhere else. Vector 01
includes a `Z` specifically to catch it; `undo_rewind` in the selftest localises
it. Also check `moves` is decremented by undo while `rejected` and `undos` are
not.

**F6 — rejection accounting.** Not counting a move command on a dead board as a
rejection (R10 is a single uniform rule), or counting an undo or an `A` on a dead
board as one. Vector 02 pins `rejected` at 47 and vector 03 at 667; both are
sensitive to this.

**F7 — timing-based search.** Iterative deepening that aborts on a wall-clock
deadline makes play depend on machine load: the same seed then produces different
scores on a busy machine, and vector 04 stops reproducing. R22 forbids it as the
normal path. Symptom: vector 04 replays differ, or benchmark `score` values move
between runs.

**F8 — fake expectimax.** An "expectimax" that samples one random spawn per
chance node (that is a rollout, not an expectation), that averages over tile
values but not over cells, or that treats the chance node as a min node. Read the
code; the win rate alone will not distinguish a good heuristic plus greedy search
from real search, and R20 is 15 points on its own.

**F9 — transposition-table leakage.** Entries carried across moves without
generation tags, or probed without comparing stored depth. Produces occasional
absurd moves that are hard to reproduce, and often a suspiciously high hit rate
(> 90 %) reported in `BENCHMARK.md`.

**F10 — benchmark shortcuts.** `--max-moves` silently applied to the canonical
run so games end early with inflated apparent stability; games counted as won on
"reached 2048 at some point" while the reported `max_tile` is lower; fewer than
20 games; a seed range other than 1–20. Re-run the canonical command yourself
rather than trusting `BENCHMARK.md`.

**F11 — score inflation.** Adding the spawned tile value to the score, or adding
both the merged value and the operands. Vector 01 pins the score at 28 and
vector 03 at 1260.

**F12 — terminal left in raw mode after a panic.** Common where cleanup lives at
the end of `main` rather than in a guard that runs on unwinding. The `kill -INT`
check in §5 finds it.

**F13 — busy-wait autoplay.** A `while true` poll loop with no sleep or blocking
read, which pegs a core and makes every timing number in `BENCHMARK.md`
meaningless. Check idle CPU in both interactive and autoplay-paused states.
