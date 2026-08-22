# TUI task 5 of 8 — `2048-solver`

## 1. Objective

Build a complete terminal implementation of 2048 in **{{LANGUAGE}}**, and an
automated player strong enough to beat the game reliably. The game half is a
precision exercise: exact merge semantics, an exactly specified pseudo-random
spawn distribution, strict move legality, undo, and score. The solver half is
the real test: a depth-adapting **expectimax** search over the game's chance
nodes, driven by a tuned board heuristic (monotonicity, smoothness, empty cells,
max-tile placement), accelerated by a bitboard representation with precomputed
row tables and a transposition table. The bar is measured, not asserted: over 20
games on fixed seeds, your solver must reach the 2048 tile in at least 18 of
them and average at least 20000 points, inside a per-move time budget. Read
`CONVENTIONS.md` at the repository root before you write any code — it defines
the workspace layout, `run.json`, the `build.sh` / `run.sh` / `test.sh`
contract, and how your work is scored. This prompt does not restate it.

---

## 2. Substitution variables

| Variable       | Meaning                                                                  | Example                      |
| -------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `{{LANGUAGE}}` | Implementation language slug, from the fixed list in `CONVENTIONS.md` §4 | `rust`                       |
| `{{RUN_ID}}`   | Run identifier, `<model-slug>__<harness-variant>` (`CONVENTIONS.md` §3)  | `qwen3.6-27B__llama-harness` |

---

## 3. Workspace

Write everything under the four-level path defined in `CONVENTIONS.md` §4:

```
tui-games/solutions/{{RUN_ID}}/2048-solver/{{LANGUAGE}}/
```

Resolved example for `{{RUN_ID}}` = `qwen3.6-27B__llama-harness`, `{{LANGUAGE}}` = `rust`:

```
tui-games/solutions/qwen3.6-27B__llama-harness/2048-solver/rust/
```

All paths below are relative to that directory. All three scripts are invoked
with that directory as the working directory. Do not write anything outside it.
`tui-games/tasks/2048-solver/` is read-only reference material
(`CONVENTIONS.md` §10).

Fill in `run.json` with `task_id` = `2048-solver`, `category` = `tui-games`, and
the remaining required fields from `CONVENTIONS.md` §5.

---

## 4. Functional requirements

Every requirement below is independently checkable. Numbers, tables and formulas
are normative: implement them exactly as written unless a requirement explicitly
grants latitude.

### 4.1 Board and coordinates

**R1.** The board is 4×4. `grid[r][c]` uses row index `r` = 0..3 top to bottom
and column index `c` = 0..3 left to right. `grid[0][0]` is the top-left cell. A
cell holds either `0` (empty) or a power of two ≥ 2.

**R2.** Wherever the board is serialised as JSON it is a 4-element array of
4-element arrays, outer index `r`, inner index `c`, values as plain integers
(tile face values, not exponents).

### 4.2 Random number generator — exact algorithm

**R3.** All randomness comes from a **SplitMix64** generator seeded with the
64-bit seed supplied on the command line. No other source of randomness may
influence game state. The generator is exactly:

```
state : u64  = seed
next() -> u64:
    state = (state + 0x9E3779B97F4A7C15) mod 2^64
    z = state
    z = ((z XOR (z >> 30)) * 0xBF58476D1CE4E5B9) mod 2^64
    z = ((z XOR (z >> 27)) * 0x94D049BB133111EB) mod 2^64
    return z XOR (z >> 31)
```

All shifts are logical (zero-filling) on unsigned 64-bit values; all arithmetic
wraps mod 2^64.

**R4.** Your implementation must reproduce these test vectors exactly (first four
`next()` outputs, hexadecimal, most significant digit first):

| seed | out 1              | out 2              | out 3              | out 4              |
| ---- | ------------------ | ------------------ | ------------------ | ------------------ |
| 0    | `E220A8397B1DCDAF` | `6E789E6AA1B965F4` | `06C45D188009454F` | `F88BB8A8724C81EC` |
| 1    | `910A2DEC89025CC1` | `BEEB8DA1658EEC67` | `F893A2EEFB32555E` | `71C18690EE42C90B` |
| 42   | `BDD732262FEB6E95` | `28EFE333B266F103` | `47526757130F9F52` | `581CE1FF0E4AE394` |

### 4.3 Spawning — exact protocol

**R5.** A spawn consumes exactly **two** `next()` draws, always both, always in
this order:

1. Build the list `E` of empty cells in **row-major order** (`(0,0)`, `(0,1)`,
   …, `(0,3)`, `(1,0)`, …, `(3,3)`). Let `k = len(E)`, which is always ≥ 1 at a
   spawn point. Draw `a = next()`; the spawn cell is `E[a mod k]`.
2. Draw `b = next()`; the spawned tile value is `4` if `b mod 10 == 0`, else
   `2`. This yields the required 90 % / 10 % distribution.

The second draw is taken even when `k == 1`. No other operation may consume
draws from the generator.

**R6.** A new game starts from an all-zero board and performs exactly two spawns
using R5. Reference initial boards (verify these before going further):

| seed | initial grid                                |
| ---- | ------------------------------------------- |
| 1    | `[[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]` |
| 2    | `[[0,0,0,0],[0,0,2,0],[0,0,0,0],[0,0,2,0]]` |
| 3    | `[[0,0,0,0],[0,0,0,0],[0,2,0,0],[0,2,0,0]]` |
| 7    | `[[0,0,0,0],[0,0,2,2],[0,0,0,0],[0,0,0,0]]` |
| 20   | `[[0,2,0,0],[0,0,0,0],[0,0,0,0],[2,0,0,0]]` |

After a legal move is applied, exactly one spawn (R5) occurs. No spawn occurs on
a rejected move, on an undo, or at any other time.

### 4.4 Move semantics — exact merge rules

**R7.** A move in direction `LEFT` transforms each row independently, rows
processed in index order 0..3:

1. Collect the row's non-zero values into a list `v`, preserving left-to-right
   order.
2. Walk `v` from index 0 with a cursor `i`. If `v[i] == v[i+1]`, emit the single
   tile `2 * v[i]`, add `2 * v[i]` to the score, and advance `i` by 2.
   Otherwise emit `v[i]` and advance `i` by 1.
3. Right-pad the emitted list with zeros to length 4; that is the new row.

This gives leftmost-pair-first merging, at most one merge per tile per move, and
no tile produced by a merge may merge again in the same move.

**R8.** `RIGHT` is `LEFT` applied to the reversed row, then reversed back. `UP`
is `LEFT` applied to each column read top-to-bottom (column index order 0..3).
`DOWN` is `UP` applied to the reversed column, then reversed back. Merge
direction therefore always favours the pair nearest the direction of travel.

**R9.** Your implementation must reproduce this table exactly. Each row is a
single line before and after; "gain" is the score added by that line.

| line        | after `LEFT` | gain | after `RIGHT` | gain |
| ----------- | ------------ | ---- | ------------- | ---- |
| `[2,2,2,2]` | `[4,4,0,0]`  | 8    | `[0,0,4,4]`   | 8    |
| `[4,4,4,4]` | `[8,8,0,0]`  | 16   | `[0,0,8,8]`   | 16   |
| `[2,2,4,0]` | `[4,4,0,0]`  | 4    | `[0,0,4,4]`   | 4    |
| `[4,4,8,0]` | `[8,8,0,0]`  | 8    | `[0,0,8,8]`   | 8    |
| `[4,4,2,2]` | `[8,4,0,0]`  | 12   | `[0,0,8,4]`   | 12   |
| `[2,0,2,4]` | `[4,4,0,0]`  | 4    | `[0,0,4,4]`   | 4    |
| `[4,2,2,4]` | `[4,4,4,0]`  | 4    | `[0,4,4,4]`   | 4    |
| `[8,4,4,2]` | `[8,8,2,0]`  | 8    | `[0,8,8,2]`   | 8    |
| `[8,8,8,0]` | `[16,8,0,0]` | 16   | `[0,0,8,16]`  | 16   |
| `[2,4,2,4]` | `[2,4,2,4]`  | 0    | `[2,4,2,4]`   | 0    |
| `[0,0,2,2]` | `[4,0,0,0]`  | 4    | `[0,0,0,4]`   | 4    |
| `[0,2,0,2]` | `[4,0,0,0]`  | 4    | `[0,0,0,4]`   | 4    |

The `[4,4,8,0]` and `[8,8,8,0]` rows are the no-double-merge cases; get them
wrong and every downstream number in this task is wrong.

**R10.** A move is **legal** iff applying R7/R8 changes at least one cell of the
grid. An illegal move is **rejected**: the grid, the score and the move counter
are unchanged, no spawn occurs, and the session's `rejected` counter increments
by one. This single rule also covers the dead-board case — when no direction is
legal, every move command is a rejection.

**R11.** Score starts at 0 and increases only by merge gains (R7 step 2).
Spawning adds nothing.

**R12.** The game is **over** when none of the four directions is legal.
Reaching 2048 does **not** end the game; play continues so larger tiles can be
built.

### 4.5 Undo

**R13.** Undo is a full state rewind with a stack of at least **20** entries,
LIFO. Immediately before a legal move is applied, push a snapshot of
`(grid, score, move counter, RNG state)`. Undo pops the most recent snapshot and
restores all four fields, **including the RNG state**. If the stack is at
capacity, discard the oldest entry.

**R14.** Undo on an empty stack is a no-op that changes no game state. Undo is
not a move: it does not spawn and does not increment `rejected`. Because the RNG
state is restored, replaying the same direction after an undo must reproduce the
identical spawn — undo may not be used to re-roll a spawn.

### 4.6 Interactive TUI

**R15.** With a TTY on stdin and no mode flag, `./run.sh` launches the
interactive game: the 4×4 board with per-tile-value colouring, the current
score, the move count, the number of empty cells, and a status line
(`playing` / `2048 reached` / `game over`).

**R16.** Key bindings, all required: arrow keys **and** `w`/`a`/`s`/`d` **and**
`k`/`h`/`j`/`l` for up/left/down/right; `u` undo; `n` new game (re-seeded from
the current seed + 1, displayed); `p` toggle solver autoplay; `.` single solver
step while paused; `+` / `-` change autoplay speed across at least 4 steps from
about 2 moves/second to as fast as the budget allows; `q` quit.

**R17.** An illegal move must be visibly rejected (a brief status message or a
shake/flash), not silently ignored.

**R18.** When solver autoplay is on, the UI shows the solver's chosen direction,
the search depth used for that move, and the milliseconds it took.

**R19.** If the terminal is smaller than 40 columns × 16 rows, render a single
readable "terminal too small" message instead of a corrupted board, and recover
when it is resized.

### 4.7 The solver

**R20.** The solver is **expectimax** over the game's real chance structure:

- **Max node** (player to move): value = max over the legal directions of the
  value of the resulting chance node. If no direction is legal, the node is
  terminal and its value is the constant `-500000.0`.
- **Chance node** (spawn to occur): value = the probability-weighted mean over
  all `k` empty cells and both tile values — cell probability `1/k`, tile
  probability `0.9` for a 2 and `0.1` for a 4 — of the value of the resulting
  max node.
- **Leaf** (remaining depth 0): value = the static heuristic of R23.

**R21.** Chance-branch probability pruning is required and is specified exactly
so that two implementations search the same tree: carry the cumulative
probability `p` of the path from the root (root `p = 1.0`; a branch multiplies
`p` by `1/k` times `0.9` or `0.1`). When a chance node is reached with
`p < 1e-4`, do not recurse — evaluate that node with the static heuristic and
return.

**R22.** Search depth is a **pure function of the board**, so play is fully
deterministic. The required default policy, in player plies:

```
e = number of empty cells
if   e >= 10: depth = 3
elif e >= 7:  depth = 4
elif e >= 4:  depth = 5
else:         depth = 6
t = number of distinct non-zero tile values on the board
if t >= 8: depth = depth + 1
depth = min(depth, 8)
```

You may substitute a different depth policy **only** if it is still a pure,
deterministic function of the board, is documented in `NOTES.md` with the reason
and the measurement that motivated it, and the R31 bar is still met. Time-based
iterative deepening that can abort a search mid-way is **not** permitted as the
normal path, because it makes play depend on machine load and destroys
run-to-run reproducibility. A wall-clock safety valve is permitted only as a
last-resort guard that must never fire during the benchmark, and
`BENCHMARK.md` must report the number of times it fired (which must be 0).

**R23.** The static heuristic operates on exponents (`x = log2(tile)`, `0` for
empty) and is evaluated over all 8 lines — the 4 rows and the 4 columns — plus
one whole-board term. For a line `x[0..3]`:

- `empty`   = `W_EMPTY  * (count of zeros in the line)`
- `merges`  = `W_MERGE  * (count of adjacent equal non-zero pairs, counted greedily left to right, each tile used at most once)`
- `mono`    = `-W_MONO * min(D_left, D_right)` where
  `D_left  = sum over i in 0..2 of max(0, x[i]^P_MONO - x[i+1]^P_MONO)` and
  `D_right = sum over i in 0..2 of max(0, x[i+1]^P_MONO - x[i]^P_MONO)`
- `sum`     = `-W_SUM * sum over i of x[i]^P_SUM`
- `smooth`  = `-W_SMOOTH * sum over adjacent pairs where both are non-zero of |x[i] - x[i+1]|`

Board value = sum of the five terms over the 8 lines, plus `corner`:

- `corner`  = `+W_CORNER` if the board's maximum tile occupies one of the four
  corner cells, else `0`.

All five line terms and the corner term must be present and must contribute.
These reference weights are known to clear the R31 bar and are a sound starting
point:

```
W_EMPTY  = 270.0    W_MERGE = 700.0    W_MONO   = 47.0    P_MONO = 4.0
W_SUM    = 11.0     P_SUM   = 3.5      W_SMOOTH = 3.0     W_CORNER = 1000.0
```

You may tune them. Whatever you end up with must be reported in `BENCHMARK.md`
as an explicit weight vector, alongside the measured result it produced.

**R24.** The solver must be a **pure deterministic function of the grid**: same
grid in, same direction out, every time, with no RNG, no wall-clock input, no
hidden state carried between calls other than caches that cannot change the
returned direction.

**R25.** A **transposition table** is required. Key on the packed 64-bit board
value. Each entry stores the value and the remaining depth at which it was
computed; a probe hits only when the stored depth is greater than or equal to
the remaining depth of the current query. The table must be cleared or
generation-tagged at the start of every solver decision so a stale entry can
never leak between moves. `BENCHMARK.md` reports the hit rate.

**R26.** The board must be represented as a **bitboard**: a single 64-bit value
in which cell `(r,c)` occupies bits `4*(4*r+c)` through `4*(4*r+c)+3`, holding
the exponent (`0` = empty, `1` = tile 2, `2` = tile 4, …, `15` = tile 32768).
The least significant nibble is cell `(0,0)`; row `r` occupies bits `16r`
through `16r+15`.

**R27.** Moves must be executed through **precomputed 65536-entry row tables**,
built at program start (not hardcoded as literals in the source): for every
possible 16-bit row value, store the row after a left move, the row after a
right move, and the score gained. Column moves are performed either by
transposing the bitboard or via equivalent precomputed column tables. Languages
without a native 64-bit integer type may use the closest faithful equivalent
(Python's arbitrary-precision `int`, TypeScript `BigInt` or a pair of 32-bit
halves or a `Uint16Array` of 4 rows) — the nibble layout of R26 and the row
tables of R27 remain mandatory, and `NOTES.md` must state which representation
was used and why.

**R28.** The naive representation cannot hit the R30 budget at the depths R22
demands. `BENCHMARK.md` must report measured mean nodes evaluated per move and
nodes per second as evidence the optimisation is real.

### 4.8 The measured bar

**R29.** `./run.sh --benchmark` plays complete games with the solver, headlessly.
Flags: `--games <n>` (default 20), `--seed-start <n>` (default 1),
`--max-moves <n>` (default 0 = unlimited). Game `i` (0-based) uses seed
`seed_start + i`. The canonical benchmark is:

```
./run.sh --benchmark --games 20 --seed-start 1
```

— that is, complete games on seeds 1 through 20 inclusive, each played to game
over.

**R30.** Per-move solver time budget, measured as the wall clock spent inside a
single decision:

| language            | budget |
| ------------------- | ------ |
| `rust`, `cpp`, `go` | 100 ms |
| `ts`                | 300 ms |
| `python`            | 500 ms |

The p99 move time over the whole canonical benchmark must be at or under the
budget, and no single move may exceed 2.5× the budget.

**R31.** Over the canonical benchmark, all three must hold:

1. **Win rate ≥ 90 %** — the final grid contains a tile ≥ 2048 in at least
   **18 of the 20** games.
2. **Mean final score ≥ 20000** across the 20 games.
3. The R30 timing bound.

A 4096 tile in at least 8 of the 20 games is a bonus, not a requirement.

**R32.** `--benchmark` prints one line per finished game to stdout, in game
order, in exactly this shape (single spaces, `key=value`, integers plain,
milliseconds with 3 decimal places):

```
game <seed> score=<int> moves=<int> max_tile=<int> won=<0|1> ms_mean=<f.3> ms_p99=<f.3> ms_max=<f.3>
```

and then one final line of compact JSON (no spaces, keys in this order):

```json
{"schema":"tui-2048/bench-1","games":<int>,"seed_start":<int>,"wins":<int>,"win_rate":<f.3>,"mean_score":<f.1>,"median_score":<f.1>,"min_score":<int>,"max_score":<int>,"tile_histogram":{"<tile>":<count>},"ms_mean":<f.3>,"ms_p99":<f.3>,"ms_max":<f.3>,"budget_aborts":<int>}
```

`tile_histogram` maps the final maximum tile of each game, as a decimal string
key, to the number of games that ended there; keys are ordered by ascending
numeric tile value. The **game** fields (`score`, `moves`, `max_tile`, `won`,
`wins`, `win_rate`, `mean_score`, `median_score`, `min_score`, `max_score`,
`tile_histogram`) are deterministic for a given seed range and must be identical
across runs and across machines. The **timing** fields and `budget_aborts` are
not comparable between machines and are excluded from any equality check.

**R33.** `BENCHMARK.md` is a required deliverable and must contain: the exact
command run; the machine (CPU model, core count, OS, toolchain version); a
20-row table of seed, score, moves, max tile, won, `ms_mean`, `ms_p99`,
`ms_max`; the aggregate JSON line verbatim; the score distribution (win rate,
mean, median, min, max, tile histogram); mean nodes/move and nodes/second; the
transposition-table hit rate; `budget_aborts`; the final heuristic weight vector;
and the depth policy actually used. Report what you measured. A fabricated or
unreproducible benchmark scores zero on the AI-strength criterion even if the
code would have passed.

---

## 5. Technical constraints

**C1.** No game engine, no 2048 library, no search library, no AI framework. The
game rules, the terminal layer, the bitboard, the heuristic and the search are
all yours.

**C2.** The terminal layer is raw-mode input and cursor/colour output written
against the platform primitives (`termios` + ANSI escapes, or the equivalent) or
a **thin** terminal library only — `crossterm`, `termion`, `tcell`, `termbox`,
`ncurses`, `blessed`, `curses`, or similar. Full TUI widget/layout frameworks
(`ratatui`, `bubbletea`, `textual`, `ink`, `FTXUI`) are not permitted: laying out
the board is part of the task.

**C3.** Terminal state must be restored on **every** exit path: normal quit,
`q`, end of script, error, uncaught exception or panic, and `SIGINT`/`SIGTERM`.
After any exit the terminal must be back in cooked mode with the cursor visible,
alternate screen left, and colours reset. A destructor/`defer`/`finally`/
`Drop`-style guard plus a signal handler is the expected shape. A session that
leaves the terminal unusable fails the TUI criterion outright.

**C4.** No busy-wait loops anywhere. Waiting for input blocks with a timeout or
polls an event source; a spin loop burning CPU while idle is a defect. Measured
with `top` or `ps` over a 10-second window, the process must sit **below 2 % of
one core** both at the interactive prompt with autoplay off and with autoplay
paused.

**C5.** The interactive render path must fit a 60 fps budget: a full frame
(compute + emit) under 16 ms, and the screen must be redrawn only when something
changed. Do not clear-and-redraw the whole screen every frame if a diff will do.

**C6.** No network access at build time or run time. No downloads in `build.sh`.
Vendor or avoid third-party dependencies; if the language's package manager is
used, the dependency set must resolve from a lockfile committed in the
workspace and must contain nothing outside C2's allowance.

**C7.** `build.sh`, `run.sh`, `test.sh` are executable, start with
`#!/usr/bin/env bash` and `set -euo pipefail`, use no absolute paths, and work
from the language directory as CWD (`CONVENTIONS.md` §6).

**C8.** Everything the program writes to stdout in a headless, selftest or
benchmark mode is part of its contract. Diagnostics, progress and timings that
are not specified above go to **stderr**.

---

## 6. Headless verification contract

An interactive TUI cannot be scored by a script unless it can be driven without
a terminal. This contract is shared by every task in the `tui-games` ladder and
is mandatory.

### 6.1 Modes

```
./run.sh --headless --script <path> --seed <n>    replay an input script, print one JSON summary line
./run.sh --selftest                               run built-in invariant checks
./run.sh --benchmark [--games n] [--seed-start n] [--max-moves n]   run the solver benchmark (R29)
./run.sh                                          interactive game (TTY) / default demo (no TTY)
```

- `--seed <n>` accepts an unsigned 64-bit decimal integer; if omitted in
  headless mode it defaults to `0`.
- `--selftest` exits `0` when every check passes and non-zero when any check
  fails, printing the failing check names to stderr.
- With **no arguments and no TTY on stdin** (how the scorer invokes it),
  `run.sh` must not block: it runs a fixed default demo — seed 1, solver
  autoplay, `--max-moves 100` — prints the same one-line JSON summary as
  headless mode, and exits 0 within 120 seconds. This is what keeps `score.py`
  from hanging.
- Exit codes: `0` success; `1` a selftest check failed or a headless run hit an
  internal invariant violation; `2` usage error, unreadable script, or an
  unrecognised script token.

### 6.2 Script format

A script is a UTF-8 text file, one command per line, LF line endings.

- A `#` begins a comment; the rest of the line is discarded. Blank lines and
  whitespace-only lines are ignored.
- A command line is a token, optionally followed by whitespace and a positive
  decimal repeat count: `L` means one left move, `L 3` means three.
- Tokens are case-insensitive:

| token | meaning                                           |
| ----- | ------------------------------------------------- |
| `L`   | move left                                         |
| `R`   | move right                                        |
| `U`   | move up                                           |
| `D`   | move down                                         |
| `Z`   | undo                                              |
| `A`   | let the solver choose and play one move           |
| `Q`   | stop processing immediately and print the summary |

- `A` on a board with no legal move is ignored entirely: it increments neither
  `ai_moves` nor `rejected`. A direction token on such a board is a rejection
  (R10).
- Any other token is a usage error: exit `2` with a message on stderr naming the
  line number.
- Reaching end of file stops processing, exactly as `Q` does, except for the
  resulting `status` value.

### 6.3 The summary line

On exit from `--headless`, and on exit from the default no-TTY demo, print
**exactly one line** to stdout: compact JSON, no spaces anywhere outside string
values, keys in exactly this order, terminated by a single `\n` and nothing
else. `--benchmark` does **not** print this line: its stdout is the per-game
`game <seed> score=<int> moves=<int> max_tile=<int> won=<0|1> ms_mean=<f.3>
ms_p99=<f.3> ms_max=<f.3>` lines plus the single `tui-2048/bench-1` aggregate
line, exactly as R32 specifies.

```json
{"schema":"tui-2048/1","seed":<u64>,"grid":[[<int>,<int>,<int>,<int>],[<int>,<int>,<int>,<int>],[<int>,<int>,<int>,<int>],[<int>,<int>,<int>,<int>]],"score":<int>,"moves":<int>,"rejected":<int>,"undos":<int>,"ai_moves":<int>,"max_tile":<int>,"empty":<int>,"won":<bool>,"status":"<string>","rng_state":"<16 hex>"}
```

| key         | type      | meaning                                                                          |
| ----------- | --------- | -------------------------------------------------------------------------------- |
| `schema`    | string    | always the literal `tui-2048/1`                                                  |
| `seed`      | integer   | the seed the run was started with                                                |
| `grid`      | int[4][4] | final board, tile face values, row-major (R2)                                    |
| `score`     | integer   | final score (R11)                                                                |
| `moves`     | integer   | move counter **of the current state** — a legal move adds 1, an undo subtracts 1 |
| `rejected`  | integer   | cumulative rejected move commands for the whole session; **not** rewound by undo |
| `undos`     | integer   | cumulative undo commands issued, including no-ops on an empty stack              |
| `ai_moves`  | integer   | cumulative moves chosen by the solver; not rewound by undo                       |
| `max_tile`  | integer   | largest tile face value on the final grid                                        |
| `empty`     | integer   | count of zero cells on the final grid                                            |
| `won`       | boolean   | `true` iff `max_tile >= 2048`                                                    |
| `status`    | string    | one of `game_over`, `quit`, `script_end`                                         |
| `rng_state` | string    | the generator's `state` word at exit, 16 **uppercase** hex digits, zero-padded   |

`status` is resolved in this order: if no direction is legal on the final board
it is `game_over`, regardless of how processing ended; otherwise, if processing
stopped on a `Q` token it is `quit`; otherwise it is `script_end`.

Given the same seed and the same script, this line must be **byte-identical**
across repeated runs, across machines, and across languages. `rng_state` is in
the summary precisely so a drifting generator is caught immediately rather than
50 moves later.

### 6.4 Required recorded vectors

Create these three scripts under `scripts/` and store each expected summary line
beside it as `scripts/vector-NN.expected.json`. The expected values below are
authoritative — they are what a correct implementation of R3 through R14
produces. If yours disagrees, yours is wrong.

**`scripts/vector-01.txt`** — moves, one rejection, one undo, explicit quit.
Seed **7**. File contents, verbatim:

```
# vector-01
L
L
U
R
D
L
U
R
D
L
Z
L
D
Q
```

Expected summary for `--headless --script scripts/vector-01.txt --seed 7`:

```json
{"schema":"tui-2048/1","seed":7,"grid":[[0,0,0,2],[0,0,0,0],[0,8,2,0],[8,2,4,2]],"score":28,"moves":10,"rejected":1,"undos":1,"ai_moves":0,"max_tile":8,"empty":9,"won":false,"status":"quit","rng_state":"D5336963EEFBA1FF"}
```

**`scripts/vector-02.txt`** — heavy rejection, ends with moves still available.
Seed **20250820**. 60 lines, the two-line cycle `L`, `D` repeated 30 times.
Generate it exactly with:

```sh
for i in $(seq 30); do printf 'L\nD\n'; done > scripts/vector-02.txt
```

Expected summary for `--headless --script scripts/vector-02.txt --seed 20250820`:

```json
{"schema":"tui-2048/1","seed":20250820,"grid":[[0,0,0,0],[2,0,0,0],[4,2,0,0],[16,8,2,0]],"score":60,"moves":13,"rejected":47,"undos":0,"ai_moves":0,"max_tile":16,"empty":10,"won":false,"status":"script_end","rng_state":"8A8043BCEBEF8B3A"}
```

**`scripts/vector-03.txt`** — plays to a real game over. Seed **3**. 800 lines,
the four-line cycle `U`, `R`, `D`, `L` repeated 200 times. Generate it exactly
with:

```sh
for i in $(seq 200); do printf 'U\nR\nD\nL\n'; done > scripts/vector-03.txt
```

Expected summary for `--headless --script scripts/vector-03.txt --seed 3`:

```json
{"schema":"tui-2048/1","seed":3,"grid":[[128,2,4,8],[2,4,16,2],[16,8,64,8],[4,16,4,2]],"score":1260,"moves":133,"rejected":667,"undos":0,"ai_moves":0,"max_tile":128,"empty":0,"won":false,"status":"game_over","rng_state":"DE8261A4408EDE29"}
```

Add at least one vector of your own, `scripts/vector-04.txt`, that exercises the
solver (`A` with a repeat count, e.g. `A 300`) on a fixed seed, with its
expected summary recorded next to it. Because the solver is deterministic (R24),
that summary is stable too — and it is the check that catches accidental
non-determinism in your search.

### 6.5 What `test.sh` must do

`test.sh` exits 0 only if all of the following pass, and prints a one-line
`PASS`/`FAIL` per check to stdout:

1. `--selftest` exits 0.
2. Each of `vector-01`, `vector-02`, `vector-03` and your `vector-04` is
   replayed and its stdout compared **byte for byte** against the recorded
   `.expected.json`. A diff is a failure; report the expected and actual lines.
3. Each vector is replayed a second time and the two outputs compared, proving
   run-to-run determinism.
4. A short solver smoke benchmark:
   `--benchmark --games 3 --seed-start 1 --max-moves 400`. Assert every game
   reaches `max_tile >= 512` and that the aggregate JSON parses. Assert the game
   fields are identical when the same smoke benchmark is run twice. Do **not**
   assert on timing fields.
5. `test.sh` must not run the full 20-game benchmark — it will not fit the test
   timeout. That run is the operator's, from `BENCHMARK.md`.

`test.sh` must complete within the `test` timeout in
`tui-games/tasks/2048-solver/task.json`.

### 6.6 Required `--selftest` checks

At minimum, and each named in output:

1. `splitmix64` — the three seed vectors of R4.
2. `spawn_init` — the five initial boards of R6.
3. `row_tables` — for all 65536 row values, the precomputed left/right results
   and score gains agree with an independent, straightforward implementation of
   R7 written for this test.
4. `merge_table` — the twelve lines of R9, both directions.
5. `legality` — a full board with no equal orthogonal neighbours has no legal
   move; a board with at least one equal orthogonal pair has at least one.
6. `undo_rewind` — after a legal move and an undo, grid, score, move counter and
   RNG state equal the pre-move snapshot; replaying the same direction produces
   a byte-identical state (R14).
7. `spawn_distribution` — from seed 12345, perform 100000 spawns onto a board
   cleared after each spawn; the count of 4s lands in `[9500, 10500]` and every
   one of the 16 cells is selected at least once.
8. `heuristic_order` — a monotone "snake" board evaluates strictly higher than
   the same multiset of tiles arranged in a checkerboard.
9. `expectimax_depth1` — take a hand-built board with exactly two empty cells
   and a direction `d` that is legal on it and produces **no merges**, so the
   post-move board still has exactly two empty cells. The value the search
   assigns to `d`'s chance node at depth 1 must equal a direct enumeration of
   its four spawn outcomes (2 cells × tile values 2 and 4), each scored with the
   R23 static heuristic and weighted `1/2 × 0.9` for a 2 and `1/2 × 0.1` for a
   4. Compare with a tolerance of `1e-6` relative. Fix the direction for this
   check — do not take the max over all directions, whose post-move boards have
   different empty-cell counts.
10. `solver_pure` — calling the solver 5 times on the same board returns the
    same direction and the same value every time.

---

## 7. Deliverables

At the root of the workspace directory:

| Path                                      | Contents                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source files                              | Idiomatic layout for `{{LANGUAGE}}`; separate the game rules, the bitboard/tables, the heuristic, the search and the terminal layer into distinct modules                                                                                                                                                                           |
| `build.sh`                                | Compiles/prepares. Exit 0. No network. May be a no-op for interpreted languages, but must still validate that the interpreter and any vendored deps are present                                                                                                                                                                     |
| `run.sh`                                  | All four modes of §6.1                                                                                                                                                                                                                                                                                                              |
| `test.sh`                                 | Everything in §6.5                                                                                                                                                                                                                                                                                                                  |
| `scripts/vector-01.txt` … `vector-04.txt` | The recorded input scripts of §6.4                                                                                                                                                                                                                                                                                                  |
| `scripts/vector-0N.expected.json`         | One expected summary line per vector                                                                                                                                                                                                                                                                                                |
| `README.md`                               | How to build, run and play; key bindings; the CLI surface; what each mode does                                                                                                                                                                                                                                                      |
| `NOTES.md`                                | Design decisions and their reasons: board representation and why, table construction, search structure, pruning, transposition-table design, depth policy (and any deviation from R22 with its justification), what you tuned and what you measured, what you would do next, and every known limitation or shortcut, stated plainly |
| `BENCHMARK.md`                            | Everything R33 requires                                                                                                                                                                                                                                                                                                             |
| `run.json`                                | Per `CONVENTIONS.md` §5                                                                                                                                                                                                                                                                                                             |

---

## 8. Definition of done

Verify each of these yourself before declaring the task complete.

- [ ] The workspace is exactly `tui-games/solutions/{{RUN_ID}}/2048-solver/{{LANGUAGE}}/` and nothing was written outside it.
- [ ] `./build.sh` exits 0 from a clean checkout with no network access.
- [ ] `./run.sh` with a TTY starts the interactive game; every key binding in R16 works; `q` exits cleanly.
- [ ] `./run.sh` with no arguments and stdin not a TTY runs the default demo, prints one summary line, and exits 0 in under 120 s.
- [ ] `./run.sh --selftest` exits 0 and all ten checks of §6.6 are named in its output.
- [ ] `./run.sh --headless --script scripts/vector-01.txt --seed 7` prints exactly the line recorded in §6.4, byte for byte. Same for vectors 02 and 03.
- [ ] Every vector produces an identical line on a second run.
- [ ] `./run.sh --benchmark --games 20 --seed-start 1` reaches a 2048 tile in at least 18 games and averages at least 20000 points.
- [ ] The benchmark's p99 move time is within the R30 budget for `{{LANGUAGE}}` and no move exceeded 2.5× the budget; `budget_aborts` is 0.
- [ ] `./test.sh` exits 0 and every check prints `PASS`.
- [ ] The search is expectimax with real chance nodes (R20), pruned exactly as R21 specifies, over a bitboard with 65536-entry row tables (R26, R27), with a transposition table (R25).
- [ ] The solver is a pure deterministic function of the board (R24); no wall clock and no RNG influence which direction it returns.
- [ ] Terminal state is restored after a normal quit, after `SIGINT` (`Ctrl-C` mid-game), and after a forced panic/exception. Confirm by running `stty -a` — or just typing — afterwards.
- [ ] No busy-wait: the process is at essentially 0 % CPU while sitting idle at the interactive prompt.
- [ ] `README.md`, `NOTES.md` and `BENCHMARK.md` all exist and are filled in with real measured values; `BENCHMARK.md` covers every item of R33.
- [ ] `run.json` is complete, with `self_reported_status` set honestly. If you did not clear the R31 bar, say `partial` and record in `NOTES.md` what you measured and where you think it fell short. An honest `partial` is worth more to this evaluation than an inflated `complete`.

---

## 9. Scoring rubric

100 points total. Every criterion is judged from the workspace as delivered.

| Weight | Criterion                             | What earns the points                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20     | **Game-rule correctness**             | R7–R14 exactly: merge direction, one merge per tile, no double merge, legality rejection, score accounting, spawn protocol and 90/10 distribution, undo with RNG rewind. Measured by the recorded vectors and the selftest. Any vector mismatch caps this criterion at half.                                                                                                                                                                                                                            |
| 15     | **Headless contract and determinism** | All four modes present and behaving; summary line byte-exact in key order, formatting and `rng_state`; identical across repeated runs; the no-TTY default demo does not hang; `test.sh` genuinely compares against recorded expectations rather than regenerating them.                                                                                                                                                                                                                                 |
| 25     | **Solver strength**                   | The measured R31 bar. Full marks at ≥ 18/20 games reaching 2048 **and** mean score ≥ 20000. Partial credit scales down through 15/20 and 12/20; a solver that cannot reliably pass 1024 earns nothing here. Bonus consideration (within the 25) for 4096 in ≥ 8 games. Requires a `BENCHMARK.md` an evaluator can reproduce.                                                                                                                                                                            |
| 15     | **Search implementation quality**     | Genuine expectimax over chance nodes with correct 0.9/0.1 weighting and `1/k` cell weighting; the R21 pruning rule; the R22 depth policy or a documented deterministic alternative; a correct transposition table with depth-aware probing and no cross-move leakage; the R23 heuristic with all five line terms and the corner term actually contributing. A greedy one-ply evaluator, a hand-tuned move-priority table, or a Monte-Carlo rollout player scores at most 4 here regardless of win rate. |
| 8      | **Performance**                       | Bitboard per R26, 65536-entry row tables built at startup per R27, p99 inside the R30 budget with no move over 2.5×, and nodes/move plus nodes/second reported as evidence.                                                                                                                                                                                                                                                                                                                             |
| 8      | **TUI quality and terminal hygiene**  | R15–R19: readable coloured board, live solver readout, illegal-move feedback, small-terminal handling, all key bindings; terminal fully restored on every exit path including `SIGINT` and panic; no busy-wait; redraw only on change.                                                                                                                                                                                                                                                                  |
| 5      | **Build and script hygiene**          | The three scripts per `CONVENTIONS.md` §6 and C7; no absolute paths; no network; no forbidden dependency; builds clean from scratch; the five modules of §7 (game rules, bitboard/tables, heuristic, search, terminal layer) are separate source units.                                                                                                                                                                                                                                                 |
| 4      | **Documentation honesty**             | `README.md`, `NOTES.md`, `BENCHMARK.md` complete, specific and accurate. Limitations stated rather than hidden. A benchmark whose numbers cannot be reproduced from the workspace scores zero here **and** zeroes the solver-strength criterion.                                                                                                                                                                                                                                                        |
