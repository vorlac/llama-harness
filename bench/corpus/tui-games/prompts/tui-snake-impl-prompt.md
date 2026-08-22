# TUI game task: `snake`

## 1. Objective

Implement a complete, playable terminal Snake game in {{LANGUAGE}}, plus a headless
replay mode that makes the game scriptable and mechanically verifiable. This is the
smallest task in the `tui-games` ladder and it exists to establish a floor: a fixed-rate
game loop that does not busy-wait, a flicker-free renderer, keyboard input decoupled from
rendering, a terminal that is always restored no matter how the process exits, and a
deterministic headless mode whose output is byte-identical across runs. The game rules
below are fully pinned — board size, starting position, random number generator, food
placement, collision semantics, scoring and tick pacing — so that two independent
implementations, in the same or different languages, must produce the same headless
summary for the same seed and input script. Read `CONVENTIONS.md` at the repository root
before you write any code; it defines the workspace layout, `run.json`, and the
`build.sh` / `run.sh` / `test.sh` contract that this task builds on.

## 2. Substitution variables

| Variable       | Meaning                                                                     | Example                |
| -------------- | --------------------------------------------------------------------------- | ---------------------- |
| `{{LANGUAGE}}` | Language slug for this run; one of `rust`, `go`, `cpp`, `python`, `ts`      | `rust`                 |
| `{{RUN_ID}}`   | Run identifier, `<model-slug>__<harness-variant>` (see `CONVENTIONS.md` §3) | `qwen3.6-27B__vanilla` |

## 3. Workspace

Write everything into, and only into:

```
tui-games/solutions/{{RUN_ID}}/snake/{{LANGUAGE}}/
```

Resolved example for `{{RUN_ID}}` = `qwen3.6-27B__vanilla`, `{{LANGUAGE}}` = `rust`:

```
tui-games/solutions/qwen3.6-27B__vanilla/snake/rust/
```

All three scripts are invoked with that directory as the working directory. Never write
outside it. Everything under `tui-games/tasks/` is read-only reference material
(`CONVENTIONS.md` §10).

## 4. Functional requirements

Each requirement is independently checkable. Implement all of them exactly as written;
where a constant or formula is given, use that constant or formula.

### 4.1 Board

1. The playfield is **40 columns by 20 rows**. Cell coordinates are `[x, y]` with `x` in
   `0..=39` (left to right) and `y` in `0..=19` (top to bottom). `[0, 0]` is the top-left
   cell. Row-major cell index is `y * 40 + x`.
2. The board does not wrap. Leaving the playfield in any direction is a wall collision.

### 4.2 Initial state

3. At the start of a game the snake has **length 3**, laid out horizontally with the head
   at `[20, 10]` and the body at `[19, 10]` and `[18, 10]`, in that order. The snake is
   always stored head-first, tail-last.
4. The committed direction is `RIGHT`. Score is `0`. Ticks elapsed is `0`. Food eaten is
   `0`. The game is not paused.
5. Exactly one food item exists at all times while the game is running. The first food is
   placed during game initialisation, before any tick runs, using the algorithm in §4.3.

### 4.3 Randomness and food placement

6. The only source of randomness is a 32-bit linear congruential generator. Its state is
   an unsigned 32-bit integer initialised to `seed mod 2^32`. Each call to `next()`
   performs, with wrapping 32-bit arithmetic:

   ```
   state = (state * 1664525 + 1013904223) mod 2^32
   return state
   ```

   For `seed = 1` the first six outputs are exactly:
   `1015568748, 1586005467, 2165703038, 3027450565, 217083232, 1587069247`.
   For `seed = 42` the first six outputs are exactly:
   `1083814273, 378494188, 2479403867, 955863294, 1613448261, 110225632`.
   Your implementation must reproduce both sequences.

7. `next()` is called for **food placement only**. Nothing else in the program may consume
   the generator. This is what makes replays reproducible.

8. To place food: build the list of **free cells** — every cell not currently occupied by
   any snake segment — ordered by ascending row-major index. Let `n` be its length. The
   food is placed at `free[next() mod n]`. Exactly one `next()` call is consumed per
   placement; rejection sampling is forbidden because it would consume a
   seed-dependent number of draws.
9. If `n == 0` no food is placed (see §4.6, win condition).
10. Worked example: at the start of a game the snake occupies 3 cells, so `n = 797`. With
    `seed = 42` the first `next()` returns `1083814273`; `1083814273 mod 797 = 274`; free
    cell 274 is `[34, 6]`. With `seed = 1` the first food is `[25, 6]`. With `seed = 7`
    the first food is `[8, 5]`.

### 4.4 Movement and collisions

11. On each tick, in this order: (a) commit the pending direction, (b) compute the new
    head cell, (c) test collisions, (d) apply growth or move.
12. Direction deltas: `UP` = `(0, -1)`, `DOWN` = `(0, +1)`, `LEFT` = `(-1, 0)`,
    `RIGHT` = `(+1, 0)`.
13. **Wall collision**: if the new head cell has `x < 0`, `x > 39`, `y < 0` or `y > 19`,
    the game ends with status `dead_wall`. The snake is not moved; the summary reports the
    state as of the failed tick, and that tick still counts (`ticks` is incremented).
14. **Self collision**: if the new head cell equals any snake segment **except the current
    tail segment** (the last element of the snake list), the game ends with status
    `dead_self`, under the same "tick still counts, snake not moved" rule as requirement 13.
    Moving into the cell the tail is vacating on this same tick is legal and must not end
    the game. The tail segment is excluded only when the snake is not growing this tick;
    because food never spawns on a snake cell, a growth tick can never target the tail
    cell, so no special case is needed.
15. **Growth**: if the new head cell is the food cell, prepend the new head, do **not**
    remove the tail, add `10` to the score, increment food eaten, then place new food per
    §4.3.
16. **Ordinary move**: otherwise prepend the new head and remove the last segment.

### 4.5 Pacing

17. Interactive mode runs at a fixed tick rate. The tick interval in milliseconds is:

    ```
    interval_ms = max(60, 120 - 10 * (food_eaten / 5))      # integer division
    ```

    So: 120 ms for the first 5 food, 110 ms for the next 5, and so on, floored at 60 ms
    once 30 or more food have been eaten. `food_eaten` is read after the growth for the
    current tick has been applied.
18. The loop must be a fixed-tick loop: compute the deadline for the next tick and wait
    until it, absorbing input during the wait. **No busy-wait.** The process must spend
    its idle time blocked in a syscall with a timeout (`poll`, `select`, a read with a
    timeout, or the equivalent in your terminal library), not spinning on a clock. An
    idle or paused game must consume negligible CPU (§5).

### 4.6 Game states

19. Statuses are exactly: `alive`, `dead_wall`, `dead_self`, `won`, `quit`.
20. **Win**: if after a growth tick the snake length reaches `40 * 20 = 800`, the game
    ends with status `won` and no food is placed.
21. **Pause**: `p` and the space bar toggle pause. While paused, no ticks run, the tick
    counter does not advance, the board is still displayed, and a visible `PAUSED`
    indicator is shown. Direction keys received while paused are accepted into the pending
    direction under the normal validity rule (§4.7).
22. **Quit**: `q` and `Ctrl-C` exit the program. On a clean quit the exit code is `0`.
23. **Restart**: after the game has ended (`dead_wall`, `dead_self`, or `won`), `r`
    starts a new game. A restart resets everything in §4.2 **and re-seeds the generator to
    the original seed**, so a restarted game replays the same food sequence. The cumulative
    restart count is reported in the summary. `r` does nothing while a game is alive.
24. When the game has ended, a game-over overlay must be shown giving the final score,
    the final length, the cause of death, and the keys to restart or quit. Ticks must stop.

### 4.7 Input

25. Recognised keys: arrow keys **and** `w` `a` `s` `d` (both cases) for direction, `p`
    and space for pause, `q` for quit, `r` for restart. Unrecognised keys are ignored
    silently.
26. Direction changes use a committed/pending pair. A direction key sets the **pending**
    direction if and only if it is not the exact opposite of the **committed** direction.
    It is validated against the committed direction, never against the pending one, so
    that two fast key presses within one tick cannot make the snake reverse into itself.
    The pending direction becomes the committed direction at the start of the next tick.
27. Multiple key presses may arrive between two ticks. Drain all pending input each pass;
    the last accepted direction wins.
28. Input must be decoupled from rendering: a keypress must never be dropped because a
    frame was being drawn, and reading input must never block past the next tick deadline.

### 4.8 Rendering

29. Interactive mode uses the alternate screen buffer, hides the cursor while playing, and
    restores both on exit.
30. Layout, top to bottom: one status line, the bordered playfield, one key-hint line. The
    status line shows at least `SCORE`, `LEN`, `TICK`, and the current tick interval in ms.
    The playfield is drawn inside a single-line box border.
31. Cell glyphs on screen: head `@`, body `#`, food `*`, and a space for an empty cell.
    The headless `board` string of §6.3 uses those same three glyphs but `.` for an empty
    cell, so the two representations differ in exactly that one character and a screenshot
    can otherwise be read against a headless board string cell for cell.
32. **No flicker.** Do not clear the screen and repaint every tick. Either diff against the
    previously rendered frame and emit escape sequences only for cells that changed, or
    compose a full frame into an off-screen buffer and write it in a single `write` call.
    A full-screen clear is permitted only on the first frame and on a terminal resize.
33. A full frame must compose and write in under 16 ms (a 60 fps budget) at the 40x20
    board size. Measure it rather than asserting it: time 1000 consecutive full-frame
    composes and record the mean per-frame time in milliseconds in `NOTES.md`; the
    recorded mean must be below 16 ms. The renderer must run only when game state has
    changed or the terminal was resized — a frame identical to the one already on screen
    must emit zero bytes, which includes every frame while paused and after game over.
34. If the terminal is smaller than 42 columns or 24 rows, draw no board, no border and
    no status line. Display instead one line naming both sizes, in exactly this form:

    ```
    terminal too small: need 42x24, have <cols>x<rows>
    ```

    Resume normal rendering on the first resize that reaches 42x24 or larger. A too-small
    terminal is a handled state, never an error exit: handle `SIGWINCH` (or the platform
    equivalent) without crashing and without leaving raw mode.

## 5. Technical constraints

35. **No game engine, no TUI framework that trivialises the task.** You may use a thin
    terminal layer only: `termios`/`ioctl`/ANSI escapes written directly, or a minimal
    crate/module such as Rust `crossterm` or `termion`, Go `golang.org/x/term`, C++ raw
    `termios`, Python `curses`/`termios` from the standard library, Node `process.stdin`
    raw mode. Anything that supplies a game loop, sprites, collision detection, an entity
    system, or a widget framework is out of bounds.
36. **Terminal state must be restored on every exit path**: normal quit, `q`, `SIGINT`,
    `SIGTERM`, an uncaught exception or panic, and an error return from `main`. Restoration
    means: leave the alternate screen, show the cursor, restore the original `termios`
    settings captured at startup, and reset any attributes set. Use a scope guard,
    `defer`, `try/finally`, a destructor, or an atexit hook — not a single cleanup call on
    the happy path. After `Ctrl-C` the shell must be fully usable with no `stty sane`
    needed.
37. **No busy-wait loops** anywhere, including the pause state and the game-over state.
    Measured over 10 seconds of idle interactive play, combined user+system CPU time must
    be under 0.5 s.
38. **No network access** at build time or run time. Vendor or avoid dependencies; the
    build must succeed offline (`CONVENTIONS.md` §6).
39. Headless mode must not sleep and must not read the wall clock. It is driven entirely
    by the input script, so it runs as fast as the CPU allows and is immune to timing.
40. All three scripts start with `#!/usr/bin/env bash` and `set -euo pipefail`, are
    `chmod +x`, and use paths relative to the workspace directory. No absolute paths.

## 6. Headless verification contract

An interactive TUI cannot be scored by a script unless it can be driven without a
terminal. Every task in `tui-games` therefore shares this contract, and yours must
implement it exactly.

### 6.1 Command-line interface

```
./run.sh --headless --script <path> --seed <n>   # replay a script, print one JSON line, exit 0
./run.sh --selftest                              # run built-in invariant checks, non-zero on failure
./run.sh [--seed <n>]                            # interactive game (see §6.5 for the no-TTY case)
```

Given the same `--seed` and the same script file, the printed JSON summary must be
**byte-identical** across runs, machines and rebuilds.

### 6.2 Input script format

A newline-delimited UTF-8 text file. One directive per line — a single token, or `TICK`
followed by a count. Leading and trailing whitespace on a line is ignored, as is repeated
whitespace between `TICK` and its count. Blank lines and lines whose first non-whitespace
character is `#` are ignored. Tokens are case-sensitive and are exactly:

| Token                      | Effect                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `UP` `DOWN` `LEFT` `RIGHT` | Same as pressing that direction key (§4.7 validity rules apply)                                               |
| `PAUSE`                    | Toggle pause                                                                                                  |
| `QUIT`                     | Terminate the replay immediately; sets status `quit` only if the game was still running (see the rules below) |
| `RESTART`                  | Same as pressing `r` (only effective when the game has ended)                                                 |
| `TICK`                     | Advance exactly one tick                                                                                      |
| `TICK <n>`                 | Advance exactly `n` ticks, where `n` is a positive decimal integer                                            |

Rules: while paused, a `TICK` token is consumed and ignored and the tick counter does not
advance. After the game has ended, `TICK` tokens are consumed and ignored, and a `QUIT`
token stops the replay but does **not** overwrite the terminal status — a script that dies
into a wall and then quits still reports `dead_wall`. `TICK <n>` stops early if the game
ends partway through, and the remaining ticks of that token are discarded. An unknown token
is a hard error: write a diagnostic to stderr and exit with code `2` without printing a
summary. When the script is exhausted, or a `QUIT` token is read, print the summary and
exit `0`.

### 6.3 JSON summary

Exactly one line on **stdout**, followed by a single `\n`, and nothing else on stdout.
Diagnostics go to stderr (`CONVENTIONS.md` §7). The JSON must be compact — no spaces after
`:` or `,` — with keys in exactly this order:

| Key          | Type                  | Meaning                                                         |
| ------------ | --------------------- | --------------------------------------------------------------- |
| `schema`     | string                | Always the literal `"tui-snake/1"`                              |
| `seed`       | int                   | The seed passed on the command line                             |
| `width`      | int                   | Always `40`                                                     |
| `height`     | int                   | Always `20`                                                     |
| `ticks`      | int                   | Ticks executed in the **current** game; reset to 0 by `RESTART` |
| `status`     | string                | One of `alive`, `dead_wall`, `dead_self`, `won`, `quit`         |
| `score`      | int                   | 10 per food eaten in the current game                           |
| `length`     | int                   | Number of snake segments                                        |
| `food_eaten` | int                   | Food eaten in the current game                                  |
| `paused`     | bool                  | `true` if paused at exit                                        |
| `restarts`   | int                   | Number of `RESTART` tokens actually honoured                    |
| `direction`  | string                | Committed direction at exit: `UP`, `DOWN`, `LEFT` or `RIGHT`    |
| `head`       | `[int,int]`           | Head cell as `[x, y]`                                           |
| `food`       | `[int,int]` or `null` | Food cell, or `null` when no food exists                        |
| `snake`      | array of `[int,int]`  | All segments, head first, tail last                             |
| `board`      | string                | 20 row strings joined by `/`; 819 characters total              |

`board` uses one character per cell: `.` empty, `#` body, `@` head, `*` food. All numbers
are integers; never emit a float, an exponent, or a `+` sign. Booleans are lowercase.

`status` is `quit` when a `QUIT` token ended a replay whose game was still running,
`alive` when the script ran to completion with the game still running, and the terminal
status (`dead_wall`, `dead_self` or `won`) whenever the game has ended, however the replay
was stopped.

### 6.4 Worked example

Script file containing the single line `TICK`, replayed with `--seed 42`, must print
exactly this (one line, shown wrapped here only for legibility — there are no line breaks
inside the actual output):

```
{"schema":"tui-snake/1","seed":42,"width":40,"height":20,"ticks":1,"status":"alive","score":0,"length":3,"food_eaten":0,"paused":false,"restarts":0,"direction":"RIGHT","head":[21,10],"food":[34,6],"snake":[[21,10],[20,10],[19,10]],"board":"......................................../......................................../......................................../......................................../......................................../......................................../..................................*...../......................................../......................................../......................................../...................##@................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../........................................"}
```

That output is 1061 bytes plus the trailing newline. If your implementation does not
reproduce it byte for byte, something in §4.1–§4.4 or §6.3 is wrong.

### 6.5 `run.sh` with no arguments

If stdin is a TTY, `./run.sh` starts the interactive game. If stdin is **not** a TTY,
`./run.sh` with no arguments must behave exactly as
`./run.sh --headless --script scripts/demo.txt --seed 42`, print the summary and exit `0`.
This is required because the scorer executes `run.sh` unattended; an interactive game that
blocks there is scored as a run failure.

### 6.6 `--selftest`

`--selftest` runs in-process invariant checks with no terminal and no timing dependence.
It must print one line per check in the form `ok <name>` or `FAIL <name> <detail>`, end
with a final line `selftest: PASS` or `selftest: FAIL <count>`, and exit `0` only if every
check passed. It must cover at least:

1. `prng` — both seed sequences in requirement 6 reproduce exactly.
2. `initial-state` — length 3, head `[20,10]`, direction `RIGHT`, score 0, ticks 0.
3. `first-food` — per requirement 10, seeds 1, 42 and 7 give `[25,6]`, `[34,6]` and `[8,5]`.
4. `move` — an ordinary tick prepends the head and drops the tail; length unchanged.
5. `grow` — eating food adds 10 to the score, adds one segment, keeps the tail.
6. `wall` — driving the head past each of the four edges yields `dead_wall`.
7. `self` — driving the head into a non-tail segment yields `dead_self`.
8. `tail-chase` — the head entering the cell the tail vacates this tick is **not** a
   collision.
9. `reversal` — the opposite of the committed direction is rejected, and two opposing keys
   within one tick cannot reverse the snake.
10. `speed` — `interval_ms` for `food_eaten` = 0, 4, 5, 9, 29, 30 and 50 is
    120, 120, 110, 110, 70, 60, 60. (29 food gives `29 / 5 = 5`, hence 70 ms; the 60 ms
    floor is first reached at 30.)
11. `food-placement` — over at least 1000 placements from varied states, food never lands
    on a snake segment and always lands inside the board.
12. `summary` — the serialised summary for the §6.4 example matches the expected string,
    and `board` is 819 characters.

### 6.7 `test.sh`

`test.sh` must, in this order, and exit non-zero if any step fails:

1. Run `./run.sh --selftest`.
2. Replay these three recorded scripts, each at `--seed 42`, and compare each summary
   against its checked-in expected file **byte for byte** (for example `cmp` on the raw
   bytes). A substring or field-subset check is not acceptable.

    | Script                   | Expected file                      | Must end with                                |
    | ------------------------ | ---------------------------------- | -------------------------------------------- |
    | `scripts/eat.txt`        | `scripts/eat.expected.json`        | `status` `alive` and `food_eaten` at least 2 |
    | `scripts/crash-wall.txt` | `scripts/crash-wall.expected.json` | `status` `dead_wall`                         |
    | `scripts/crash-self.txt` | `scripts/crash-self.expected.json` | `status` `dead_self`                         |

   Additional pairs are welcome and are checked the same way.
3. Replay one of those scripts twice and assert the two outputs are identical, proving
   determinism.
4. Run `./run.sh` with stdin redirected from `/dev/null` and assert it exits `0` and prints
   exactly the bytes of `scripts/demo.expected.json` — §6.5 pins both the script and the
   seed, so the two must be identical.

Every recorded script `scripts/<name>.txt`, `scripts/demo.txt` included, is replayed at
`--seed 42` and has its expected output in `scripts/<name>.expected.json` — one line, no
trailing whitespace, terminated by a single newline. Fixing the seed is what lets anyone
regenerate an expected file with
`./run.sh --headless --script scripts/<name>.txt --seed 42`. Generate these files by
running your program; never hand-write one.

## 7. Deliverables

All paths are relative to the workspace directory of §3.

| Path                                                                  | Content                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| source files                                                          | The implementation, idiomatic for {{LANGUAGE}}, with game state, rendering, input and the terminal layer in separate modules/files                                                                                                         |
| `build.sh`                                                            | Compile or install. Exit 0. Offline. May be a no-op for interpreted languages                                                                                                                                                              |
| `run.sh`                                                              | The four modes of §6.1 and §6.5                                                                                                                                                                                                            |
| `test.sh`                                                             | The checks of §6.7                                                                                                                                                                                                                         |
| `scripts/eat.txt`, `scripts/crash-wall.txt`, `scripts/crash-self.txt` | The three recorded input scripts of §6.7                                                                                                                                                                                                   |
| `scripts/demo.txt`                                                    | The script `run.sh` replays when stdin is not a TTY (§6.5)                                                                                                                                                                                 |
| `scripts/*.expected.json`                                             | One expected summary per recorded script, generated at `--seed 42`                                                                                                                                                                         |
| `README.md`                                                           | How to build, run and play; key bindings; the headless CLI; the JSON schema                                                                                                                                                                |
| `NOTES.md`                                                            | Design notes: how the tick loop avoids busy-wait, how the renderer avoids flicker, the measured mean full-frame render time (requirement 33), how terminal restoration is guaranteed on every exit path, and anything you could not finish |
| `run.json`                                                            | Filled in per `CONVENTIONS.md` §5, with `self_reported_status` honestly set                                                                                                                                                                |

## 8. Definition of done

Verify each of these yourself before declaring the task complete.

- [ ] Everything is under `tui-games/solutions/{{RUN_ID}}/snake/{{LANGUAGE}}/` and nothing outside it was modified.
- [ ] `./build.sh` exits 0 from a clean checkout with no network access.
- [ ] `./run.sh` in a real terminal plays: the snake moves at a fixed rate, arrows and WASD steer, food is eaten, the snake grows, the score rises, `p`/space pauses, walls and self kill, the game-over overlay appears, `r` restarts, `q` quits.
- [ ] Reversing directly into the snake's own neck is impossible, including with two key presses inside one tick.
- [ ] The head can safely enter the cell the tail is vacating on the same tick.
- [ ] `Ctrl-C` during play leaves the terminal usable: cursor visible, echo on, normal screen, no `stty sane` required.
- [ ] Forcing a panic or uncaught exception also restores the terminal.
- [ ] An idle or paused game uses under 0.5 s of CPU over 10 seconds of wall time.
- [ ] The screen does not flicker; only changed cells or one buffered write per frame, and an unchanged frame writes nothing.
- [ ] A terminal narrower than 42 columns or shorter than 24 rows shows the exact `terminal too small: need 42x24, have <cols>x<rows>` line and recovers on resize.
- [ ] `./run.sh --selftest` prints `selftest: PASS` and exits 0, and covers all twelve checks of §6.6.
- [ ] The §6.4 worked example reproduces byte for byte.
- [ ] `scripts/eat.txt`, `scripts/crash-wall.txt`, `scripts/crash-self.txt` and `scripts/demo.txt` each match their `.expected.json` byte for byte at `--seed 42`, and a repeated replay is identical.
- [ ] `./run.sh < /dev/null` prints exactly `scripts/demo.expected.json` and exits 0.
- [ ] `./test.sh` exits 0 and fails loudly if any assertion is broken.
- [ ] All three scripts are executable, start with `#!/usr/bin/env bash` and `set -euo pipefail`, and use no absolute paths.
- [ ] `README.md`, `NOTES.md` and `run.json` exist and are accurate.

## 9. Scoring rubric

Total 100 points.

| Weight | Criterion                         | What earns the points                                                                                                                                                                                                                                    |
| -----: | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     30 | Game rule correctness             | §4 implemented exactly: board, initial state, LCG and food placement, growth, wall and self collision including the tail-chase case, reversal blocking, scoring, speed curve, pause, restart, win. Judged mostly by headless summaries and `--selftest`. |
|     20 | Headless contract and determinism | Exact CLI of §6.1 and §6.5, exact JSON schema, key order and compaction of §6.3, the §6.4 example byte-identical, repeated replays identical, `test.sh` asserting whole-summary equality on at least three scripts.                                      |
|     15 | Terminal hygiene                  | Raw mode entered and left correctly; alternate screen and cursor restored; state restored on normal exit, `q`, `SIGINT`, `SIGTERM` and panic; resize and too-small terminal handled.                                                                     |
|     15 | Loop discipline                   | Fixed-tick loop with a real blocking wait, no busy-wait in play, pause or game over; input drained and decoupled from render; flicker-free diff or single-write rendering; render only on state change.                                                  |
|     10 | Build and script contract         | `build.sh` / `run.sh` / `test.sh` per `CONVENTIONS.md` §6: executable, correct shebang and `set -euo pipefail`, offline, relative paths, correct exit codes.                                                                                             |
|      5 | Code structure                    | Game logic pure and testable, independent of the terminal layer; clear separation of model, view and input; no dead code, no unused dependencies.                                                                                                        |
|      5 | Documentation                     | `README.md` and `NOTES.md` accurate and specific, `run.json` complete and honest.                                                                                                                                                                        |

Partial credit is given per row. A submission that does not build, or whose `run.sh` blocks
when stdin is not a TTY, scores zero on the rows that cannot be evaluated.
