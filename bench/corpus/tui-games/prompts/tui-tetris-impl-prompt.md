# TUI game task: `tetris`

## 1. Objective

Implement a complete, correct, playable Tetris in {{LANGUAGE}} as a terminal
application, and make it mechanically verifiable. "Complete and correct" here
means the guideline ruleset spelled out in section 5 of this document — the seven
tetrominoes in their standard spawn orientations, the Super Rotation System with
the standard wall-kick tables, a 7-bag randomiser, a gravity curve driven by
level, lock delay with move-reset, soft drop and hard drop, a hold slot limited
to one use per drop, a five-piece preview queue, line-clear scoring with
back-to-back and combo bonuses, level progression, and top-out detection — plus a
10x20 playfield with a ghost piece and a side panel. This is a greenfield task:
there is no starting material. Because an interactive TUI cannot be scored by a
script, your program must also implement the headless verification contract in
section 7, which replays a recorded input script against a seeded deterministic
engine and prints a single-line JSON summary that must be byte-identical across
repeated runs and across implementations in different languages. Read
`CONVENTIONS.md` at the repository root before you write any code; it defines the
workspace layout, `run.json`, and the `build.sh` / `run.sh` / `test.sh` contract
that this task builds on, and it is the authority wherever this document is
silent.

## 2. Substitution variables

| Variable       | Meaning                                                                                             | Example                |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| `{{LANGUAGE}}` | Language slug you are implementing in. One of the fixed slugs listed in `CONVENTIONS.md` section 4. | `rust`                 |
| `{{RUN_ID}}`   | The run identifier for this evaluation run, `<model-slug>__<harness-variant>`.                      | `qwen3.6-27B__vanilla` |

Both are substituted before this prompt reaches you. Wherever they appear below,
they are already concrete values.

## 3. Workspace

All of your work goes in exactly one directory:

```
tui-games/solutions/{{RUN_ID}}/tetris/{{LANGUAGE}}/
```

Resolved example, for `{{RUN_ID}}` = `qwen3.6-27B__vanilla` and `{{LANGUAGE}}` = `rust`:

```
tui-games/solutions/qwen3.6-27B__vanilla/tetris/rust/
```

Rules about this directory:

- Every path in this document is relative to it unless it starts with
  `tui-games/` or is called out as repository-relative.
- `build.sh`, `run.sh`, and `test.sh` are invoked with this directory as the
  working directory. Never hardcode an absolute path.
- Create it with `tools/new_workspace.sh {{RUN_ID}} tetris {{LANGUAGE}}` if it
  does not already exist, and fill in `run.json` as described in `CONVENTIONS.md`
  section 5 before you finish.
- Everything under `tui-games/tasks/` is read-only reference material. Do not
  edit it.

## 4. Coordinate system and terminology

Fix these definitions; the rest of the document depends on them.

- The **grid** is 10 columns wide and 22 rows tall. Column 0 is leftmost, column
  9 is rightmost. Row 0 is the topmost row, row 21 is the bottom row.
- Rows 0 and 1 are the **hidden spawn buffer**. Rows 2 through 21 are the
  **visible playfield**, the 20 rows the player sees.
- A piece has a **type** (one of `I J L O S T Z`), a **rotation state**
  (`0`, `1`, `2`, `3`, also written `0`, `R`, `2`, `L`), and a **position**
  `(row, col)` which is the grid coordinate of the top-left cell of the piece's
  bounding box. The bounding box is 4x4 for `I` and `O`, and 3x3 for
  `J L S T Z`. The bounding box may extend outside the grid; only occupied cells
  are tested for collision.
- Rotation state `1` (`R`) is one 90-degree clockwise turn from state `0`; state
  `3` (`L`) is one counter-clockwise turn from state `0`.
- A **tick** is one step of the logical simulation. The logical tick rate is
  exactly 60 Hz.

## 5. Functional requirements

Each requirement is independently checkable. Implement all of them.

### 5.1 Piece geometry

**FR-1.** The seven tetrominoes occupy exactly these cells, given as
`(row, col)` offsets inside the piece's bounding box. Implement these tables
literally; do not derive rotations by matrix transposition unless the result is
identical to what is written here.

`I` (4x4 bounding box):

| State | Cells                   |
| ----- | ----------------------- |
| 0     | (1,0) (1,1) (1,2) (1,3) |
| 1     | (0,2) (1,2) (2,2) (3,2) |
| 2     | (2,0) (2,1) (2,2) (2,3) |
| 3     | (0,1) (1,1) (2,1) (3,1) |

`O` (4x4 bounding box, identical in all four states):

| State   | Cells                   |
| ------- | ----------------------- |
| 0,1,2,3 | (0,1) (0,2) (1,1) (1,2) |

`T` (3x3 bounding box):

| State | Cells                   |
| ----- | ----------------------- |
| 0     | (0,1) (1,0) (1,1) (1,2) |
| 1     | (0,1) (1,1) (1,2) (2,1) |
| 2     | (1,0) (1,1) (1,2) (2,1) |
| 3     | (0,1) (1,0) (1,1) (2,1) |

`S` (3x3 bounding box):

| State | Cells                   |
| ----- | ----------------------- |
| 0     | (0,1) (0,2) (1,0) (1,1) |
| 1     | (0,1) (1,1) (1,2) (2,2) |
| 2     | (1,1) (1,2) (2,0) (2,1) |
| 3     | (0,0) (1,0) (1,1) (2,1) |

`Z` (3x3 bounding box):

| State | Cells                   |
| ----- | ----------------------- |
| 0     | (0,0) (0,1) (1,1) (1,2) |
| 1     | (0,2) (1,1) (1,2) (2,1) |
| 2     | (1,0) (1,1) (2,1) (2,2) |
| 3     | (0,1) (1,0) (1,1) (2,0) |

`J` (3x3 bounding box):

| State | Cells                   |
| ----- | ----------------------- |
| 0     | (0,0) (1,0) (1,1) (1,2) |
| 1     | (0,1) (0,2) (1,1) (2,1) |
| 2     | (1,0) (1,1) (1,2) (2,2) |
| 3     | (0,1) (1,1) (2,0) (2,1) |

`L` (3x3 bounding box):

| State | Cells                   |
| ----- | ----------------------- |
| 0     | (0,2) (1,0) (1,1) (1,2) |
| 1     | (0,1) (1,1) (2,1) (2,2) |
| 2     | (1,0) (1,1) (1,2) (2,0) |
| 3     | (0,0) (0,1) (1,1) (2,1) |

**FR-2.** Every piece spawns in rotation state `0` at position `(row=0, col=3)`.
With the tables above this places `J L S T Z` across columns 3-5, `I` across
columns 3-6, and `O` across columns 4-5, and it places every occupied spawn cell
inside the hidden buffer (rows 0-1). A piece is never spawned anywhere else and
never spawns in a rotation state other than `0`, including after a hold swap.

### 5.2 Rotation and wall kicks

**FR-3.** Rotation uses the Super Rotation System. A rotation request from state
`a` to state `b` tries five candidate offsets in order. Each offset is a
`(dcol, drow)` pair applied to the piece's bounding-box position; `dcol` positive
is rightward, `drow` positive is **downward** (row index increasing). The first
candidate whose four resulting cells are all inside the grid and all unoccupied
is accepted, and the piece moves there in state `b`. If all five fail, the
rotation is rejected and nothing changes — not the position, not the state, not
the lock timer.

**FR-4.** For `J`, `L`, `S`, `T`, and `Z`, the kick table is:

| Transition | Test 1 | Test 2 | Test 3  | Test 4 | Test 5  |
| ---------- | ------ | ------ | ------- | ------ | ------- |
| 0 -> 1     | (0,0)  | (-1,0) | (-1,-1) | (0,+2) | (-1,+2) |
| 1 -> 0     | (0,0)  | (+1,0) | (+1,+1) | (0,-2) | (+1,-2) |
| 1 -> 2     | (0,0)  | (+1,0) | (+1,+1) | (0,-2) | (+1,-2) |
| 2 -> 1     | (0,0)  | (-1,0) | (-1,-1) | (0,+2) | (-1,+2) |
| 2 -> 3     | (0,0)  | (+1,0) | (+1,-1) | (0,+2) | (+1,+2) |
| 3 -> 2     | (0,0)  | (-1,0) | (-1,+1) | (0,-2) | (-1,-2) |
| 3 -> 0     | (0,0)  | (-1,0) | (-1,+1) | (0,-2) | (-1,-2) |
| 0 -> 3     | (0,0)  | (+1,0) | (+1,-1) | (0,+2) | (+1,+2) |

**FR-5.** For `I`, the kick table is:

| Transition | Test 1 | Test 2 | Test 3 | Test 4  | Test 5  |
| ---------- | ------ | ------ | ------ | ------- | ------- |
| 0 -> 1     | (0,0)  | (-2,0) | (+1,0) | (-2,+1) | (+1,-2) |
| 1 -> 0     | (0,0)  | (+2,0) | (-1,0) | (+2,-1) | (-1,+2) |
| 1 -> 2     | (0,0)  | (-1,0) | (+2,0) | (-1,-2) | (+2,+1) |
| 2 -> 1     | (0,0)  | (+1,0) | (-2,0) | (+1,+2) | (-2,-1) |
| 2 -> 3     | (0,0)  | (+2,0) | (-1,0) | (+2,-1) | (-1,+2) |
| 3 -> 2     | (0,0)  | (-2,0) | (+1,0) | (-2,+1) | (+1,-2) |
| 3 -> 0     | (0,0)  | (+1,0) | (-2,0) | (+1,+2) | (-2,-1) |
| 0 -> 3     | (0,0)  | (-1,0) | (+2,0) | (-1,-2) | (+2,+1) |

**FR-6.** For `O`, rotation never changes the occupied cells and no kicks are
tried. A rotation request on an `O` piece always succeeds, changes only the
recorded rotation state, and counts as a successful rotation for lock-delay reset
purposes.

**FR-7.** Only the eight transitions listed are reachable. There is no 180-degree
rotation input in this task.

### 5.3 Randomiser

**FR-8.** Piece order comes from a 7-bag randomiser. A bag is the array
`[I, J, L, O, S, T, Z]` in exactly that order, shuffled, then consumed front to
back. When the bag is exhausted a fresh bag is generated and shuffled.

**FR-9.** The shuffle must be reproducible from the seed across languages.
Use SplitMix64. Given a 64-bit unsigned `state` initialised to the seed, `next()`
is:

```
state = (state + 0x9E3779B97F4A7C15) mod 2^64
z     = state
z     = ((z XOR (z >> 30)) * 0xBF58476D1CE4E5B9) mod 2^64
z     = ((z XOR (z >> 27)) * 0x94D049BB133111EB) mod 2^64
return  z XOR (z >> 31)
```

All shifts are logical (unsigned) right shifts. All arithmetic wraps at 64 bits.

**FR-10.** The shuffle is Fisher-Yates over the seven-element array, descending:

```
for i = 6 down to 1:
    j = next() mod (i + 1)
    swap a[i], a[j]
```

`next()` is called exactly six times per bag, in that order, and for no other
purpose anywhere in the engine. Nothing else in the simulation consumes
randomness.

**FR-11.** The preview queue is a FIFO holding exactly 5 upcoming piece types.
At game start, five pieces are drawn from the bag into the queue. Spawning takes
the front of the queue and immediately draws one replacement from the bag, so the
queue is always length 5 while the game is running.

### 5.4 Gravity, lock delay, and drops

**FR-12.** Gravity is measured in ticks per row and is a function of level:

| Level         | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13+ |
| ------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ticks per row | 60  | 48  | 37  | 28  | 21  | 16  | 11  | 8   | 6   | 4   | 3   | 2   | 1   |

(These are the guideline curve `(0.8 - 0.007*(L-1))^(L-1)` seconds per row,
sampled at 60 Hz and rounded to nearest. Use the integer table, not the formula.)

**FR-13.** A gravity counter increments once per tick. When it reaches the value
for the current level, it resets to 0 and the piece attempts to move down one
row. If that move is blocked, the piece stays put; the counter still resets.

**FR-14.** Lock delay is 30 ticks. While the piece is **resting** (it cannot move
down one row), a lock timer increments once per tick; when it reaches 30, the
piece locks. Whenever the piece is not resting, the lock timer is 0.

**FR-15.** While resting, any successful move or successful rotation resets the
lock timer to 0. This move-reset is limited to 15 resets per piece. Once 15
resets have been used, further moves and rotations still take effect but no
longer reset the lock timer. The reset budget is restored to 15, and the lock
timer set to 0, whenever the piece reaches a bounding-box row strictly greater
than any row it has previously occupied during this drop.

**FR-16.** Soft drop moves the piece down exactly one row if unobstructed and
awards 1 point. It resets the gravity counter to 0. If obstructed it does
nothing and awards nothing.

**FR-17.** Hard drop moves the piece down to the lowest position where all four
cells are unoccupied and in-grid, awards 2 points per row travelled, and locks
the piece **immediately** in that tick, bypassing lock delay entirely.

### 5.5 Hold

**FR-18.** The hold slot starts empty. On a hold request:
- if the slot is empty, the active piece's type goes into the slot and a new
  active piece is taken from the front of the preview queue (with the queue
  refilled from the bag);
- if the slot is occupied, the active piece's type and the held type are
  swapped, and the incoming piece becomes active.

In both cases the incoming piece spawns per FR-2: rotation state `0`, position
`(0, 3)`. Score, level, lines, combo, and back-to-back are unaffected.

**FR-19.** Hold may be used at most once per drop. A second hold request before
the active piece locks is rejected and has no effect at all — including no
lock-timer reset. The hold lock is released when a piece locks, not when a piece
spawns.

**FR-20.** If the incoming piece from a hold swap cannot be placed at its spawn
position because a spawn cell is occupied, the game tops out (see FR-29).

### 5.6 Line clears, scoring, level

**FR-21.** After a piece locks, every row in which all 10 cells are occupied is
cleared. Rows above a cleared row shift down by the number of cleared rows below
them (naive gravity); rows shifted in at the top are empty. Line clears are only
evaluated after a lock, never mid-flight.

**FR-22.** Base line-clear score, where `L` is the level **at the moment of the
clear**, before any level increase caused by that clear:

| Lines cleared | Score   |
| ------------- | ------- |
| 1 (single)    | 100 * L |
| 2 (double)    | 300 * L |
| 3 (triple)    | 500 * L |
| 4 (tetris)    | 800 * L |

**FR-23.** Back-to-back. A 4-line clear is a *difficult* clear; 1-, 2-, and
3-line clears are not. Maintain a boolean `b2b`, initially false.
- If a 4-line clear happens while `b2b` is true, its base score is multiplied by
  1.5 (so 1200 * L), then `b2b` stays true.
- If a 4-line clear happens while `b2b` is false, it scores 800 * L and `b2b`
  becomes true.
- Any clear of 1, 2, or 3 lines sets `b2b` to false.
- A lock that clears no lines leaves `b2b` unchanged.

There is no T-spin detection or T-spin scoring in this task. T-spins belong to
the `tetris-enhanced` task; do not implement them here, because doing so changes
the scores the conformance summaries must produce.

**FR-24.** Combo. Maintain an integer `combo`, initially -1. On each lock:
- if lines were cleared, `combo` increases by 1, and if `combo` is then greater
  than 0, award an additional `50 * combo * L` points, with `L` the level at the
  moment of the clear;
- if no lines were cleared, `combo` is reset to -1.

**FR-25.** `lines` accumulates the total number of rows cleared. Level is
`min(15, 1 + floor(lines / 10))`. The game starts at level 1. Level never
decreases.

**FR-26.** All arithmetic on `score` is exact integer arithmetic. The 1.5
back-to-back multiplier is applied as `base * 3 / 2` on integers, which is exact
because every base value is even. Score never decreases and is never negative.

### 5.7 Board, ghost, top-out

**FR-27.** A cell is either empty or occupied by a locked block that remembers
the type letter of the piece it came from. That letter is what the board encoding
in section 7 emits, so it must be preserved through line clears and row shifts.

**FR-28.** The ghost piece is the active piece projected to its hard-drop
destination. It is rendered distinctly from both empty cells and locked blocks,
and it never appears where the active piece already is. The ghost is display-only
and never appears in the board encoding.

**FR-29.** Top-out. The game ends, with status `topout`, when either:
- **block out**: a piece is spawned (at game start, after a lock, or from a hold
  swap) and at least one of its four spawn cells is already occupied; or
- **lock out**: a piece locks with all four of its cells in rows 0-1, entirely
  inside the hidden buffer.

Once the game has topped out, the simulation stops: no further ticks are
counted, no further input is processed, and no further state changes occur.

### 5.8 Interactive mode

**FR-30.** With no arguments and with **both stdin and stdout attached to a
TTY**, `./run.sh` starts an interactive game on a seed derived from the clock.
`./run.sh --seed <n>`, under the same TTY condition, starts an interactive game
on seed `<n>`.

With no arguments and with stdin or stdout **not** a TTY, `./run.sh` must behave
exactly as `./run.sh --headless --script scripts/conformance-a.txt --seed 12345`:
print that one summary line to stdout and exit 0. This fallback is required
across `tui-games/` because `tools/score.py` executes `run.sh` unattended with
its stdio on pipes; an interactive game that blocks or refuses there is recorded
as a run failure on every run of this task.

**FR-31.** Key bindings:

| Key              | Action                   |
| ---------------- | ------------------------ |
| Left arrow       | Move left                |
| Right arrow      | Move right               |
| Down arrow       | Soft drop one row        |
| Space            | Hard drop                |
| Up arrow, or `x` | Rotate clockwise         |
| `z`              | Rotate counter-clockwise |
| `c`              | Hold                     |
| `p`              | Pause / unpause          |
| `q`, or Escape   | Quit                     |

**FR-32.** Held left/right uses delayed auto-shift: the first repeat fires
167 ms after the initial press, subsequent repeats every 33 ms. Held soft drop
repeats every 33 ms with no initial delay. Releasing or switching direction
resets the DAS state.

**FR-33.** The screen shows the 20 visible rows of the playfield, drawn two
character cells wide per grid cell, with a drawn border, and a side panel showing
at minimum: `HOLD` (the held piece, rendered as a mini-grid, or empty),
`NEXT` (all 5 queued pieces as mini-grids, in order), `SCORE`, `LEVEL`, and
`LINES`. The hidden buffer rows are not drawn.

**FR-34.** On top-out, the interactive mode displays a game-over state showing
the final score and waits for a key before exiting cleanly with status 0.

**FR-35.** Interactive mode requires a terminal of at least 80 columns by 24
rows. If the terminal is smaller, or if interactive mode is requested
**explicitly** (`./run.sh --seed <n>`) while stdin or stdout is not a TTY, print
a one-line diagnostic to stderr and exit with a non-zero status **without**
having entered raw mode. This clause does not apply to the bare `./run.sh`
no-TTY case, which falls back to the headless replay of FR-30, nor to
`--headless` and `--selftest`, which never require a terminal at all.

## 6. Technical constraints

- **TC-1.** No game engine, no game framework, no curses-replacement that
  supplies a game loop, sprite system, or scene graph. The terminal layer must be
  written directly against platform primitives (`termios`/`ioctl` and ANSI escape
  sequences, or the Windows console API) or against a thin terminal library that
  provides only raw mode, key decoding, and cursor/colour output. `ncurses`,
  `crossterm`, `termbox`, `tcell`, `blessed`, and equivalents are acceptable;
  anything that implements Tetris rules, collision, or a tick loop for you is
  not. Name every third-party dependency in `NOTES.md` and justify it in one
  line.
- **TC-2.** Terminal state must be restored on **every** exit path: normal quit,
  top-out, an unhandled panic/exception/unwind, `SIGINT`, `SIGTERM`, and
  `SIGHUP`. That means leaving raw mode, restoring the original `termios` (or
  equivalent), showing the cursor, and leaving the alternate screen if you
  entered it. A run that leaves the operator's terminal in raw mode with a hidden
  cursor is a hard failure of this task regardless of how well the game plays.
- **TC-3.** No busy-wait loops. The main loop must sleep or block on input with a
  timeout until the next frame deadline. A loop that spins on a clock check,
  or a nonblocking read in a tight `while(true)`, fails this constraint. Headless
  mode must not sleep at all — it runs the simulation as fast as it can.
- **TC-4.** The interactive frame loop runs at 60 Hz and must not repaint the
  whole screen every frame. Keep the previously rendered frame and emit output
  only for the cells that changed. Two concrete consequences, both checked by
  reading the draw routine: a full-screen clear (`CSI 2J`, `clear`, or
  equivalent) is emitted at most once, at startup, never once per frame; and
  while the game is paused, with no cell changing, a frame emits zero bytes to
  stdout.
- **TC-5.** No network access at build time or run time. Vendor dependencies or
  avoid them. `build.sh` must succeed with the network disabled.
- **TC-6.** The rules engine must be a separate module (or package, or file) from
  the rendering and input layers, and must not import or reference them. Headless
  mode drives the same engine as interactive mode — not a reimplementation. This
  is checked by inspection and is part of the rubric.
- **TC-7.** `build.sh`, `run.sh`, and `test.sh` are executable, start with
  `#!/usr/bin/env bash` and `set -euo pipefail`, and follow `CONVENTIONS.md`
  section 6.
- **TC-8.** Determinism: given the same seed and the same input script, the
  engine must produce identical state. Do not consult wall-clock time, thread
  scheduling, hash iteration order, address values, or any RNG other than the one
  in FR-9 anywhere in the engine.

## 7. Headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven
without a terminal. Every game task in `tui-games/` therefore shares this
contract, and your solution must implement it exactly.

### 7.1 Command-line interface

```
./run.sh --headless --script <path> --seed <n>
./run.sh --selftest
```

- `--headless` requires both `--script` and `--seed`. If either is missing,
  print usage to stderr and exit with status 2.
- `<n>` is a non-negative decimal integer that fits in 64 bits unsigned. It is
  the SplitMix64 seed of FR-9.
- Headless mode must never open a terminal, never enter raw mode, and must work
  with stdin, stdout, and stderr all redirected to files or pipes.
- Any unrecognised flag: usage to stderr, exit status 2.

### 7.2 Input script format

A script is a UTF-8 text file, newline-delimited, LF endings. Lines are processed
in order. A line is one of:

| Line                    | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `L`                     | Move left, then advance 1 tick                                |
| `R`                     | Move right, then advance 1 tick                               |
| `CW`                    | Rotate clockwise, then advance 1 tick                         |
| `CCW`                   | Rotate counter-clockwise, then advance 1 tick                 |
| `SD`                    | Soft drop one row, then advance 1 tick                        |
| `HD`                    | Hard drop and lock, then advance 1 tick                       |
| `HOLD`                  | Hold, then advance 1 tick                                     |
| `TICK <n>`              | Advance exactly `<n>` ticks with no input, `1 <= n <= 100000` |
| (empty line)            | Ignored entirely; advances nothing                            |
| line beginning with `#` | Comment; ignored entirely; advances nothing                   |

Commands are uppercase and exact. `TICK` takes exactly one decimal integer
argument separated by a single space. Any other line, including unknown
commands, lowercase variants, or a malformed `TICK`, is a fatal error: print
`error: line <N>: <message>` to stderr and exit with status 3.

The whole file is parsed and validated **before** replay begins. A malformed
line anywhere in the file therefore exits 3 whether or not the game would have
topped out before reaching it, and a script that fails validation prints no
summary line on stdout at all. `<N>` is the 1-based line number of the offending
line in the file. If more than one line is malformed, report the first.

### 7.3 Tick pipeline

Every tick executes these phases in this exact order. Getting the order wrong
changes the summaries and will be caught.

1. If the game status is not `running`, do nothing and do not increment the tick
   counter. (The remaining script lines are discarded; they were already
   validated per section 7.2, so discarding them cannot change the exit status.)
2. Apply the tick's input command, if any. A hard drop (FR-17) runs the **lock
   procedure** below here, in phase 2, and phases 3 and 4 are then skipped for
   this tick.
3. Gravity, per FR-13.
4. Lock delay, per FR-14 and FR-15. If the lock timer reaches 30, run the lock
   procedure now.
5. Increment the tick counter by 1.

The **lock procedure** is a single routine with a single implementation. Phase 2
and phase 4 both call it, and it always runs these steps in this order:

1. Write the four cells of the active piece into the board, each remembering the
   piece's type letter (FR-27), and increment `pieces`.
2. Clear every completed row and shift the rows above down (FR-21).
3. Apply scoring at the pre-clear level: base value (FR-22), back-to-back
   (FR-23), combo (FR-24), then update `lines` and `level` (FR-25).
4. Release the hold lock, so hold is available again for the next drop (FR-19).
5. Check **lock out** (FR-29) against the four cells written in step 1. If it
   fires, the game tops out and step 6 does not run.
6. Take the front of the preview queue as the new active piece and refill the
   queue from the bag (FR-2, FR-11), then check **block out** (FR-29).

There is no second copy of these steps anywhere. A hard drop that falls through
into phases 3 and 4 and locks twice is the single most common cause of a
conformance summary that disagrees with every other language.

### 7.4 Output summary

On exit — whether the script ran to completion or the game topped out partway
through — print **exactly one line** to stdout: a JSON object, compact (no space
after `:` or `,`), with these keys in exactly this order, followed by a single
`\n`. Nothing else may be written to stdout in headless mode. Diagnostics go to
stderr.

| Key          | Type               | Meaning                                                                                                                     |
| ------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `schema`     | integer            | Always `1`.                                                                                                                 |
| `status`     | string             | `"running"` if the script ended with the game still live, `"topout"` if the game ended.                                     |
| `ticks`      | integer            | Number of ticks simulated.                                                                                                  |
| `pieces`     | integer            | Number of pieces **locked**, not spawned.                                                                                   |
| `score`      | integer            | Final score.                                                                                                                |
| `lines`      | integer            | Total rows cleared.                                                                                                         |
| `level`      | integer            | Final level, 1..15.                                                                                                         |
| `combo`      | integer            | Final combo counter, -1 when no combo is active.                                                                            |
| `b2b`        | boolean            | Final back-to-back flag.                                                                                                    |
| `hold`       | string or null     | Held piece type letter, or `null` if the slot is empty.                                                                     |
| `hold_used`  | boolean            | Whether hold is currently locked for the active drop. `false` when `status` is `"topout"`.                                  |
| `next`       | array of 5 strings | The preview queue, front first. Empty array `[]` when `status` is `"topout"`.                                               |
| `active`     | object or null     | The falling piece as `{"type":"L","rot":0,"row":0,"col":3}` with keys in that order, or `null` when `status` is `"topout"`. |
| `board`      | string             | Encoding of locked cells only, defined below.                                                                               |
| `board_hash` | string             | Lowercase hex SHA-256 of the UTF-8 bytes of `board`.                                                                        |

Board encoding: the 20 **visible** rows (grid rows 2..21), top row first, joined
by `/`. Each row is exactly 10 characters; `.` for an empty cell, otherwise the
uppercase type letter of the locked block in that cell. The active piece and the
ghost piece are never included. The full string is therefore always 219
characters.

Example of a well-formed summary line — this is the summary of a game at tick 0,
seed-dependent values aside, and is shown to fix the exact shape; it is not the
expected answer for any script:

```json
{"schema":1,"status":"running","ticks":0,"pieces":0,"score":0,"lines":0,"level":1,"combo":-1,"b2b":false,"hold":null,"hold_used":false,"next":["I","J","O","S","Z"],"active":{"type":"L","rot":0,"row":0,"col":3},"board":"........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../..........","board_hash":"5e8679b0947339eb3f54bca347264e60f4c007b3924846e47e011366782d6d1d"}
```

Note that the empty board encodes as 20 groups of ten `.` joined by `/`, is 219
characters long, and hashes to `5e8679b0947339eb3f54bca347264e60f4c007b3924846e47e011366782d6d1d`.
Use that as your first sanity check.

Exit status is 0 whenever the script was replayed successfully, including when
the game topped out. Non-zero exit statuses are reserved for usage errors (2),
malformed scripts (3), and internal failures (1).

**Determinism requirement.** Given the same seed and the same script file, the
summary line must be byte-identical across repeated runs on the same machine,
across machines, and across implementations of this task in different languages.
This is the primary objective signal for this task.

### 7.5 Mandatory conformance scripts

Create these two files with exactly this content, byte for byte, including
comments and the trailing newline. They are cross-language conformance vectors:
the operator compares your summaries against those produced by other language
implementations of this same task.

`scripts/conformance-a.txt`:

```
# conformance-a
# Exercises spawn, horizontal movement, gravity, hard drop, and line clears.
TICK 10
L
L
L
L
HD
TICK 3
L
L
HD
TICK 3
HD
TICK 3
R
R
HD
TICK 3
R
R
R
R
HD
TICK 30
SD
SD
SD
HD
TICK 3
CW
L
L
L
HD
TICK 3
CCW
R
R
R
HD
TICK 120
```

`scripts/conformance-b.txt`:

```
# conformance-b
# Exercises hold and the one-use-per-drop rule, rotation in both directions,
# wall kicks against both walls, and soft-drop scoring.
TICK 5
HOLD
TICK 5
HOLD
TICK 5
CW
CW
CW
CW
L
L
L
L
L
L
CW
CW
HD
TICK 5
HOLD
R
R
R
R
R
R
CCW
CCW
HD
TICK 5
SD
SD
SD
SD
SD
HD
TICK 5
CW
HOLD
TICK 40
HD
TICK 200
```

Run each once and record its summary line verbatim:

- `expected/conformance-a.seed12345.json` — output of
  `./run.sh --headless --script scripts/conformance-a.txt --seed 12345`
- `expected/conformance-b.seed777.json` — output of
  `./run.sh --headless --script scripts/conformance-b.txt --seed 777`

Each expected file contains exactly the one summary line and its trailing
newline.

### 7.6 Self-test mode

`./run.sh --selftest` runs built-in invariant checks against the engine, with no
terminal and no external files. It prints one line per check to stderr in the
form `PASS <name>` or `FAIL <name>: <detail>`, prints exactly one line to stdout
in the form `selftest: <passed>/<total>`, and exits 0 if and only if every check
passed. It must include at least these checks, each named:

| Name                      | Check                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `geometry-cell-count`     | All 7 types in all 4 states have exactly 4 distinct in-box cells.                                                               |
| `geometry-rotation-cycle` | Applying clockwise rotation four times to every type in an empty grid returns it to state 0 at its original position.           |
| `kick-table-shape`        | Both kick tables define all 8 transitions with exactly 5 tests each, and every table's first test is `(0,0)`.                   |
| `bag-uniform`             | Generating 700 pieces from seed 1 yields each type exactly 100 times, and every consecutive block of 7 contains all 7 types.    |
| `bag-deterministic`       | Two independently constructed randomisers seeded 42 produce the same first 100 pieces.                                          |
| `clear-cell-count`        | For a constructed board, clearing `k` lines reduces the occupied-cell count by exactly `10*k` and leaves no fully-occupied row. |
| `ghost-equals-harddrop`   | For 100 pseudo-random reachable states, the ghost position equals the position the piece reaches under hard drop.               |
| `lock-delay-budget`       | A resting piece moved left and right alternately locks after at most 15 resets rather than never locking.                       |
| `score-monotonic`         | Replaying `scripts/conformance-a.txt` in-process, score is non-decreasing at every tick and level never decreases.              |
| `replay-determinism`      | Replaying the same in-memory script twice from the same seed yields identical summary lines.                                    |

## 8. Required deliverables

Every one of these must exist in the workspace directory and be complete.

| Path                                    | Contents                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source files                            | The implementation, idiomatic for {{LANGUAGE}}, with the engine separated from render and input per TC-6.                                                                                                                                                                           |
| `build.sh`                              | Compiles or prepares the program. Exit 0 on success. No network. May be a no-op for interpreted languages, but must still validate that the interpreter and any deps are present.                                                                                                   |
| `run.sh`                                | Entry point implementing section 7.1 and FR-30.                                                                                                                                                                                                                                     |
| `test.sh`                               | Test suite, section 9. Exit 0 iff everything passes.                                                                                                                                                                                                                                |
| `scripts/conformance-a.txt`             | Exact content from section 7.5.                                                                                                                                                                                                                                                     |
| `scripts/conformance-b.txt`             | Exact content from section 7.5.                                                                                                                                                                                                                                                     |
| `expected/conformance-a.seed12345.json` | Recorded summary line.                                                                                                                                                                                                                                                              |
| `expected/conformance-b.seed777.json`   | Recorded summary line.                                                                                                                                                                                                                                                              |
| `README.md`                             | How to build, how to play, key bindings, how to run headless and selftest, and the dependency list.                                                                                                                                                                                 |
| `NOTES.md`                              | Design decisions, what you would do differently, any rule you were unsure about and how you resolved it, and any requirement you did **not** implement. Honesty here is scored; a NOTES.md that claims completeness the code does not have scores worse than one that admits a gap. |
| `CONFORMANCE.md`                        | A table with one row per functional requirement `FR-1` .. `FR-35` and per technical constraint `TC-1` .. `TC-8`, each mapping to the file and function/symbol that implements it, and to the test that covers it, or the word `unimplemented`.                                      |
| `run.json`                              | Filled in per `CONVENTIONS.md` section 5.                                                                                                                                                                                                                                           |

## 9. `test.sh` requirements

`test.sh` must, at minimum:

1. Run `./run.sh --selftest` and require exit 0.
2. Run `./run.sh --headless --script scripts/conformance-a.txt --seed 12345` and
   compare stdout byte-for-byte against `expected/conformance-a.seed12345.json`.
   Any difference fails the suite and prints a diff to stderr.
3. Do the same for `scripts/conformance-b.txt` at seed 777 against
   `expected/conformance-b.seed777.json`.
4. Run conformance-a twice and assert the two outputs are byte-identical
   (determinism across processes).
5. Run conformance-a at a *different* seed and assert the summary differs from
   the seed-12345 summary (proves the seed is actually wired to the randomiser).
6. Assert that a malformed script exits with status 3, and that
   `--headless` without `--seed` exits with status 2.
7. Include unit tests of the rules engine covering, at minimum: each of the eight
   SRS transitions for a non-`O` piece including at least one that succeeds only
   on a non-first kick test; the four line-clear score values; the back-to-back
   multiplier; the combo award; level progression across a level boundary; the
   one-use-per-drop hold rule; block-out and lock-out top-out.
8. Print a final summary line and exit non-zero if any check failed.

`test.sh` must not require a TTY, must not require network access, and must
complete well within the task's test timeout.

## 10. Definition of done

Verify each of these yourself before you declare the task complete.

- [ ] The workspace is exactly
      `tui-games/solutions/{{RUN_ID}}/tetris/{{LANGUAGE}}/` and nothing outside it
      was created or modified.
- [ ] `run.json` exists and every required field from `CONVENTIONS.md` section 5
      is filled in, including an honest `self_reported_status`.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, begin with
      `#!/usr/bin/env bash` and `set -euo pipefail`.
- [ ] `./build.sh` exits 0 from a clean checkout with the network disabled.
- [ ] `./run.sh --selftest` exits 0 and prints `selftest: N/N` with all checks
      passing.
- [ ] `./run.sh --headless --script scripts/conformance-a.txt --seed 12345`
      prints exactly one line of compact JSON with the 15 keys of section 7.4 in
      the specified order, and nothing else on stdout.
- [ ] That line is byte-identical when the command is run a second time.
- [ ] `board` is exactly 219 characters and `board_hash` is the SHA-256 of it.
- [ ] `expected/conformance-a.seed12345.json` and
      `expected/conformance-b.seed777.json` match live output byte for byte.
- [ ] `./test.sh` exits 0 and covers all eight items in section 9.
- [ ] Piece geometry matches the tables in FR-1 cell for cell; spawn is state 0
      at `(0,3)` for every type (FR-2).
- [ ] Both kick tables match FR-4 and FR-5 entry for entry, including sign and
      order, and a failed rotation changes nothing (FR-3).
- [ ] The randomiser is SplitMix64 per FR-9 with exactly six `next()` calls per
      bag per FR-10, and nothing else consumes randomness.
- [ ] Gravity uses the integer table in FR-12; lock delay is 30 ticks with a
      15-reset budget per FR-14 and FR-15.
- [ ] Hard drop scores 2/row and locks in the same tick; soft drop scores 1/row.
- [ ] Hold is one-use-per-drop and the lock releases on lock, not on spawn.
- [ ] Scoring matches FR-22 through FR-26, with no T-spin logic present.
- [ ] Level is `min(15, 1 + lines/10)` and clears score at the pre-clear level.
- [ ] Both block-out and lock-out end the game, and the simulation freezes after.
- [ ] Interactive mode renders the 10x20 field, a ghost piece, and a side panel
      with hold, five next pieces, score, level, and lines, and every key binding
      in FR-31 acts.
- [ ] `./run.sh` with no arguments and stdout on a pipe prints the conformance-a
      summary and exits 0 (FR-30), while `./run.sh --seed 1` on a pipe refuses
      with a non-zero status without entering raw mode (FR-35).
- [ ] Terminal state is restored after a normal quit, after a `SIGINT`, and after
      a forced panic. Test all three by hand; describe the result in `NOTES.md`.
- [ ] The main loop sleeps or blocks; there is no spin loop (TC-3).
- [ ] The engine module does not import the render or input modules (TC-6).
- [ ] `README.md`, `NOTES.md`, and `CONFORMANCE.md` all exist, and
      `CONFORMANCE.md` has a row for every `FR-*` and every `TC-*`.
- [ ] No file under `tui-games/tasks/` was modified.

## 11. Scoring rubric

Weights sum to 100. Points are awarded by an operator running the checks in
`tui-games/tasks/tetris/acceptance.md`.

| Weight | Criterion                       | What earns the points                                                                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30     | Rules conformance               | Piece tables, spawn, both SRS kick tables, 7-bag with the specified PRNG, gravity table, lock delay with reset budget, hold semantics, line clears, scoring including back-to-back and combo, level progression, both top-out conditions. Scored per-requirement against FR-1..FR-29; partial credit is proportional to requirements met.         |
| 20     | Headless determinism            | Summary line present, exact key set and order, compact form, valid 219-character board, correct hash, byte-identical across repeat runs, byte-identical against other language implementations at the mandated seeds, selftest exits 0 with all listed checks present. Cross-language mismatch of a conformance summary costs most of this block. |
| 15     | TUI quality and terminal safety | Correct layout, ghost piece, full side panel, readable at 80x24, every FR-31 binding and the FR-32 DAS timings working, and — weighted heavily inside this block — terminal state restored on normal exit, `SIGINT`, and panic.                                                                                                                   |
| 10     | Build and script contract       | `build.sh`/`run.sh`/`test.sh` present, executable, correct shebang and flags, offline build, correct exit statuses including 2 and 3, correct CWD assumptions, `run.json` complete.                                                                                                                                                               |
| 10     | Code structure                  | Engine separated from render and input, no back-references, one shared engine driving both modes, no dead or duplicated rule logic, readable and idiomatic for {{LANGUAGE}}.                                                                                                                                                                      |
| 8      | Test suite                      | All eight items of section 9 present and meaningful; unit tests actually assert rule behaviour rather than smoke-testing; tests fail when a rule is broken.                                                                                                                                                                                       |
| 7      | Documentation                   | `README.md` usable by someone who has not read this prompt; `NOTES.md` substantive and honest about gaps; `CONFORMANCE.md` complete and accurate, with rows that point at real symbols.                                                                                                                                                           |
