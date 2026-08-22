# TUI task: minesweeper

## 1. Objective

Implement a complete terminal Minesweeper in {{LANGUAGE}}: a cursor-driven, raw-mode TUI with a
guaranteed-safe first click, iterative flood-fill reveal, flag/question-mark cycling, chording, a
remaining-mine counter, a timer, three difficulty presets plus custom board sizes, and full
win/loss board reveal — plus a constraint-propagation solver exposed both as a hint command and as
an autoplay mode, and a board generator that can emit boards solvable without guessing. The program
must additionally run headless, replaying a recorded input script under a fixed seed and printing a
single deterministic JSON line describing the final game state, so that a script can score it
without a terminal. Read `CONVENTIONS.md` at the repository root before you start; it defines run
IDs, the workspace layout, the `build.sh` / `run.sh` / `test.sh` contract, and how your work is
scored. This prompt does not restate those rules, it depends on them.

## 2. Substitution variables

| Variable       | Meaning                                                                   | Example                             |
| -------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| `{{LANGUAGE}}` | Implementation language slug, from the fixed list in `CONVENTIONS.md` §4  | `rust`, `go`, `cpp`, `python`, `ts` |
| `{{RUN_ID}}`   | Run identifier, `<model-slug>__<harness-variant>` per `CONVENTIONS.md` §3 | `qwen3.6-27B__llama-harness`        |

## 3. Workspace

All of your output goes in exactly one directory:

```
tui-games/solutions/{{RUN_ID}}/minesweeper/{{LANGUAGE}}/
```

Resolved example, for `{{RUN_ID}}` = `qwen3.6-27B__llama-harness` and `{{LANGUAGE}}` = `rust`:

```
tui-games/solutions/qwen3.6-27B__llama-harness/minesweeper/rust/
```

Create it with `tools/new_workspace.sh {{RUN_ID}} minesweeper {{LANGUAGE}}` and fill in `run.json`
as described in `CONVENTIONS.md` §5. Write nothing outside this directory. Everything under
`tui-games/tasks/` is read-only reference material (`CONVENTIONS.md` §10).

## 4. Functional requirements

Each requirement is numbered so it can be checked independently. Where a rule is given with exact
constants, implement those constants — two implementations of this task are compared against the
same numbers, so "a reasonable equivalent" scores as a miss.

### 4.1 Board model

1. The board is a rectangular grid of `width` columns by `height` rows. Coordinates are
   `(col, row)`, zero-indexed, origin at the **top-left**. Cell index in row-major order is
   `row * width + col`. Every ordering rule in this prompt ("first", "lowest", "smallest") means
   lowest row-major index unless stated otherwise.
2. Each cell has exactly one *content* — mine or a neighbour count 0..8 — and exactly one *marker
   state* from `HIDDEN`, `FLAGGED`, `QUESTION`, `REVEALED`.
3. The neighbour count of a non-mine cell is the number of mines among its up-to-8 orthogonal and
   diagonal neighbours. Cells outside the grid are not neighbours; the grid does not wrap.

### 4.2 Difficulty presets and custom boards

4. Three presets, selected by `--difficulty`:

    | Name         | Flag value     | Width | Height | Mines | Mine density |
    | ------------ | -------------- | ----- | ------ | ----- | ------------ |
    | Beginner     | `beginner`     | 9     | 9      | 10    | 12.3%        |
    | Intermediate | `intermediate` | 16    | 16     | 40    | 15.6%        |
    | Expert       | `expert`       | 30    | 16     | 99    | 20.6%        |

   `beginner` is the default when `--difficulty` is not given.
5. `--difficulty custom` enables `--width`, `--height`, `--mines`. Valid ranges: `5 <= width <= 60`,
   `5 <= height <= 40`, `1 <= mines <= width * height - 9`. Any value outside those ranges, a
   non-integer, or `--width` / `--height` / `--mines` supplied without `--difficulty custom` is a
   usage error: print a one-line diagnostic to **stderr** and exit with status `2`. Do not clamp
   silently.
6. The upper mine bound `width * height - 9` exists so requirement 10 (a mine-free 3x3 block around
   the first click) is always satisfiable. Do not relax it.

### 4.3 Deterministic random number generation

Board layouts must be reproducible from a seed, in every language, so that a Rust run and a Go run
of the same seed can be compared byte for byte. Implement exactly this generator.

7. **SplitMix64.** State is a single unsigned 64-bit integer, initialised to the seed value.
   All arithmetic is modulo 2^64; `>>` is a logical (unsigned) shift.

   ```
   next_u64():
       state = (state + 0x9E3779B97F4A7C15) mod 2^64
       z = state
       z = ((z XOR (z >> 30)) * 0xBF58476D1CE4E5B9) mod 2^64
       z = ((z XOR (z >> 27)) * 0x94D049BB133111EB) mod 2^64
       return z XOR (z >> 31)
   ```

   In languages with arbitrary-precision integers (Python), mask with `& 0xFFFFFFFFFFFFFFFF` after
   every addition, multiplication and shift so the result matches fixed-width arithmetic.

   ```
   rand_below(n):            # n >= 1, returns a value in [0, n)
       threshold = (2^64 - n) mod n      # this equals 2^64 mod n
       loop:
           r = next_u64()
           if r >= threshold:
               return r mod n
   ```

8. The generator is constructed once at process start from `--seed` (default `0`) and is the only
   source of randomness in the program. It is **not** reseeded on `restart` or on a no-guess
   regeneration attempt: its state carries forward, so a session's sequence of boards is a
   deterministic function of the seed alone.

### 4.4 Guaranteed-safe first click

9. No mines exist until the player's first reveal. The first `reveal` (or the first `chord`, or the
   first `auto`/`autoplay` step, whichever comes first) fixes the *first-click cell* `(fc, fr)` and
   only then generates the layout.
10. The **forbidden set** is `(fc, fr)` together with all of its in-grid neighbours — at most 9
    cells. No mine may be placed in the forbidden set. Because of requirement 5 this is always
    possible, so the first reveal always opens a zero cell and therefore always triggers a flood
    fill.
11. Mine placement is a partial Fisher-Yates shuffle over the allowed cells, in this exact form:

    ```
    A = [every cell index not in the forbidden set], in ascending row-major order
    L = len(A)
    for i in 0 .. mines-1:
        j = i + rand_below(L - i)
        swap A[i], A[j]
    mine cells = A[0 .. mines-1]
    ```

    Do not substitute a rejection-sampling placement loop or a full shuffle; the draw sequence is
    part of the specification.
12. Neighbour counts are computed after placement, for every non-mine cell.

### 4.5 Revealing, flood fill, markers, chording

13. `reveal` on a `HIDDEN` cell reveals it. `reveal` on a `FLAGGED` cell is a no-op (this is the
    point of flags). `reveal` on a `QUESTION` cell reveals it. `reveal` on a `REVEALED` cell is a
    no-op.
14. Revealing a mine ends the game in a loss (requirement 20).
15. Revealing a cell whose neighbour count is `0` triggers a flood fill: every reachable cell in the
    zero-region and its numbered border becomes `REVEALED`. Precisely — push the origin cell on a
    worklist; while the worklist is non-empty, pop a cell, reveal it if hidden or question-marked
    (never a flagged cell), and if its count is `0` push each of its non-revealed, non-flagged
    neighbours. Each cell is processed at most once.
16. The flood fill **must be iterative**, using an explicit stack or queue on the heap. Recursive
    implementations are a scored failure: a 60x40 board with one mine floods roughly 2,398 cells in
    one call and must not risk a stack overflow, and the selftest exercises exactly that.
17. `flag` cycles the marker state of a non-revealed cell: `HIDDEN` -> `FLAGGED` -> `QUESTION` ->
    `HIDDEN`. On a `REVEALED` cell it is a no-op. Flags may be placed before the board is generated;
    if a flagged cell later receives a mine that is coincidence, not a rule — flagging never
    influences generation.
18. **Chording**: `chord` on a `REVEALED` cell with neighbour count `N >= 1` counts the `FLAGGED`
    cells among its neighbours. If that count equals `N`, every neighbour that is `HIDDEN` or
    `QUESTION` is revealed **in ascending row-major order**, each one individually subject to
    requirements 14 and 15. If one of them is a mine the game is lost at that moment: that mine is
    the detonated one (requirement 20) and the remaining neighbours are left untouched, so a chord
    detonates at most one mine and the board carries exactly one `X`. If the flag count does not
    equal `N`, the chord is a no-op. `chord` on a cell that is not revealed, or whose count is `0`,
    is a no-op. `QUESTION` marks never count as flags, so chording over one can lose the game — that
    behaviour is required, not a bug.
19. **Win** occurs the moment every non-mine cell is `REVEALED`. On winning, every mine cell that is
    not already `FLAGGED` (including `QUESTION` and `HIDDEN` mines) becomes `FLAGGED`, the timer
    stops, and the status becomes `won`.
20. **Loss** occurs when a mine is revealed. On losing: the revealed mine becomes the *detonated*
    mine and is marked as such (rendered `X`, requirement 53); every other mine cell that is not
    `FLAGGED` becomes `REVEALED` (rendered `*`); every mine cell that *is* `FLAGGED` stays `FLAGGED`
    (rendered `F`), because a correct flag is not a mistake; every `FLAGGED` cell that is *not* a
    mine stays `FLAGGED` but is marked as a wrong flag (rendered `!`); the timer stops; and the
    status becomes `lost`. A lost board therefore shows every one of the `mines` mines, as exactly
    one `X` plus some mix of `*` and `F`. Marking a wrong flag does not change the marker state, so
    it does not change `flags` or `mines_remaining` (requirements 21 and 52). After a win or a loss
    the only commands that do anything are `restart` and `quit`.

### 4.6 Counters and timer

21. The remaining-mine counter is `mines - (number of FLAGGED cells)`. It may go negative and must
    be displayed as a signed value; do not clamp it.
22. The timer starts on the first reveal and stops on win or loss. In the interactive TUI it shows
    whole elapsed seconds, clamped for display at `999`.
23. In headless mode the timer is a **virtual clock**: it starts at `0` and advances only via the
    `wait <n>` script command (§6.2, requirement 48). Wall-clock time must never enter the headless
    summary — that is what makes the summary reproducible.

### 4.7 The solver

The solver is a fixed set of deduction rules. Implement exactly these and no more: a stronger
solver changes which boards pass the no-guess filter and which cell a hint names, and the scorer
compares those across implementations.

24. **Constraint extraction.** Let `known_mine` be the set of cells the solver has proven to be
    mines (seeded with the player's `FLAGGED` cells) and `known_safe` the set it has proven safe.
    Build the constraint set:
    - For every `REVEALED` non-mine cell `c` with count `N`, let `U` be its neighbours that are
      neither `REVEALED` nor in `known_mine` nor in `known_safe`, and let `k = N - |neighbours of c
      in known_mine|`. If `U` is non-empty, emit the constraint `(U, k)`.
    - Emit exactly one **global constraint** `(U_all, R)` where `U_all` is every cell that is not
      `REVEALED`, not in `known_mine` and not in `known_safe`, and `R = mines - |known_mine|`. The
      global constraint is what lets the solver finish endgames by counting.
25. **Rule 1 — trivial resolution.** For a constraint `(U, k)`: if `k == 0`, every cell of `U` is
    safe; if `k == |U|`, every cell of `U` is a mine.
26. **Rule 2 — pairwise counting (subsumes subset elimination).** For any two constraints `(A, ka)`
    and `(B, kb)`: if `kb - ka == |B \ A|` then every cell of `B \ A` is a mine and every cell of
    `A \ B` is safe. Apply in both directions for each unordered pair. The classic subset rule
    (`A subset-of B` giving the residual constraint `(B \ A, kb - ka)`) is the special case where
    `A \ B` is empty; you may implement it either way as long as the deductions match.
27. **Fixpoint.** Whenever a deduction adds to `known_mine` or `known_safe`, rebuild the constraint
    set and repeat rules 1 and 2 until a full pass adds nothing. The resulting deduction sets are
    order-independent; the *order in which you apply the rules must not change the final result*.
28. **`hint`** runs the fixpoint without mutating the board, then reports:
    - If the board has not been generated yet, `safe:<cursor col>,<cursor row>` — any first click is
      safe by requirement 9.
    - Otherwise, if `known_safe` minus the player's already-revealed cells is non-empty, the lowest
      row-major such cell as `safe:<col>,<row>`.
    - Otherwise, if `known_mine` minus the player's already-flagged cells is non-empty, the lowest
      row-major such cell as `mine:<col>,<row>`.
    - Otherwise `none`.

    In the TUI a hint highlights the named cell and prints the string in the status bar. `hint`
    never changes the board and never ends the game. Every `hint` increments the hint counter.
29. **`auto` and `autoplay`.** `auto` performs one solver step: if the board is not yet generated it
    reveals the cursor cell; otherwise it runs the fixpoint and then applies **all** deductions —
    flagging every cell in `known_mine` that is not already flagged, then revealing every cell in
    `known_safe` that is not already revealed, both in ascending row-major order. If the fixpoint
    produced no new deduction and the game is still `playing`, the step is a *stall*: set the
    stalled flag and change nothing. `autoplay` repeats `auto` until the status is `won` or `lost`
    or a stall occurs. The solver never guesses.

### 4.8 No-guess generation

30. `--no-guess` changes generation (requirement 11) into a retry loop. After placing mines and
    computing counts, run the first reveal on `(fc, fr)` against a scratch copy of the board and
    then run `autoplay` on that copy. Accept the layout if and only if autoplay reaches status
    `won` with no stall. Otherwise discard it and generate again — reusing the same forbidden set
    and the same, still-advancing generator state — up to **1000** attempts.
31. Count every layout produced, accepted or not, in `gen_attempts` (so a board accepted on the
    first try reports `1`). `gen_attempts` is `0` until the board is generated — that is, until the
    first reveal fixes the first-click cell (requirement 9) — and `restart` resets it to `0`.
    Once the board is generated it is exactly `1` without `--no-guess`, and `1..1000` with it.
32. If all 1000 attempts fail, keep the 1000th layout, start the game with it, and report
    `no_guess:true` with `gen_attempts:1000` — the summary is still well-defined and the failure is
    visible in the attempt count. Do not abort and do not loop forever.
33. The scratch simulation must not consume generator draws beyond mine placement and must leave no
    trace on the real game: `revealed`, `ticks`, `hints_used` and the stalled flag all reflect the
    player's actions only.

### 4.9 Interactive interface

34. Keys: arrow keys **and** `h`/`j`/`k`/`l` move the cursor one cell (clamped at the edges, no
    wrapping); `space` or `Enter` reveals; `f` cycles the marker; `c` chords; `?` requests a hint;
    `a` performs one `auto` step; `A` runs `autoplay`; `r` restarts with the same settings; `1`,
    `2`, `3` switch to beginner/intermediate/expert and restart; `q` or `Ctrl-C` quits.
35. The screen shows the board, a status bar carrying at least the four values *remaining mines*
    (signed, requirement 21), *elapsed seconds*, *difficulty name* and *game status*, and a key
    legend listing every binding of requirement 34. Each cell state renders as a distinct glyph, not
    by colour alone, so the states stay distinguishable under `NO_COLOR`: hidden, flagged,
    question-marked, revealed mine and detonated mine each get their own character, and a revealed
    `0` renders as blank space rather than the digit `0`.
36. Numbers 1..8 are colourised with the classic palette using exactly these ANSI SGR foreground
    codes, so the choice is checkable rather than a matter of taste:

    | Number | 1    | 2     | 3    | 4    | 5      | 6    | 7     | 8    |
    | ------ | ---- | ----- | ---- | ---- | ------ | ---- | ----- | ---- |
    | Colour | blue | green | red  | navy | maroon | teal | white | grey |
    | SGR    | `94` | `32`  | `91` | `34` | `31`   | `36` | `37`  | `90` |

    Reset with `0` after each cell. Colour must degrade to plain text — no SGR bytes at all — when
    `NO_COLOR` is set to any value in the environment or when stdout is not a TTY.
37. Mouse support is optional but, if implemented, must use SGR mouse reporting (`CSI ?1006h` with
    `CSI ?1000h`), map left button to reveal, right button to marker cycle, middle button to chord,
    and be disabled again on every exit path. A `--mouse` flag gates it; default off.

## 5. Technical constraints

38. **No game engine.** No dependency that supplies a game loop, scene graph, sprite system, ECS or
    a ready-made Minesweeper/board-game module. A thin terminal library that only does termios/
    console-mode handling, key decoding and cursor addressing is allowed (`crossterm`, `termbox`,
    `tcell`, `blessed`, `curses`/`ncurses`, or direct `termios` + ANSI escapes). Anything that would
    also implement the solver, the board, or the flood fill for you is out.
39. **No solver dependency.** The constraint propagation in §4.7 is the point of the task. No SAT
    solver, ILP solver, CSP framework or third-party Minesweeper-solver package.
40. **Raw mode, restored on every exit path.** Entering the TUI switches to raw mode, hides the
    cursor and (recommended) uses the alternate screen buffer. The terminal must be restored —
    cooked mode, cursor visible, alternate screen left, mouse reporting off — on normal exit, on
    `q`, on `SIGINT` and `SIGTERM`, and on an unhandled panic/exception/error. Use the language's
    scope-guard mechanism (`Drop`, `defer`, RAII, `try/finally`, `atexit`) rather than hoping the
    happy path runs. A run that leaves the terminal wedged scores zero on TUI quality regardless of
    how the game plays.
41. **No busy-wait.** The main loop blocks on input with a timeout (a poll interval of 16-50 ms is
    appropriate) so the timer can tick. Spinning on a non-blocking read, or a bare
    `sleep(0)`/`yield` loop, is a scored failure. Measured over 10 seconds of idle interactive play
    with no key pressed, combined user+system CPU time must stay under 0.5 s.
42. **60 fps render budget.** A full redraw of the largest board (60x40) must complete in under
    16 ms. Redraw only when state changed or the displayed second changed, write the frame with a
    single buffered write, and never clear-and-repaint the whole screen per keystroke.
43. **No network access** at build time or run time. Vendor or avoid dependencies
    (`CONVENTIONS.md` §6).
44. `build.sh`, `run.sh` and `test.sh` follow `CONVENTIONS.md` §6: executable, `#!/usr/bin/env bash`
    plus `set -euo pipefail`, run with the language folder as the working directory, no absolute
    paths. `run.sh` forwards all of its arguments to the program.
45. Headless mode must not require a TTY: it must run correctly with stdin, stdout and stderr all
    redirected to files or pipes, and must not emit a single escape sequence.

## 6. Headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven without a terminal.
Every task in `tui-games/` therefore supports the same two modes.

```
./run.sh --headless --script <path> --seed <n>     replay an input script, print one JSON line
./run.sh --selftest                                 run built-in invariant checks, non-zero on failure
```

**Given the same seed and the same input script, the JSON summary must be byte-identical across
runs, across machines, and across languages.**

### 6.1 Command-line surface

```
run.sh [--difficulty beginner|intermediate|expert|custom]
       [--width W] [--height H] [--mines M]
       [--seed N] [--no-guess] [--mouse]
       [--headless --script PATH]
       [--selftest]
       [--help]
```

46. Flags may appear in any order. `--headless` requires `--script`; either without the other is a
    usage error (exit `2`). A `--script` path that does not exist or cannot be read is the same
    usage error: one line on stderr, exit `2`. An unrecognised flag is also a usage error, exit `2`.
    `--seed` defaults to `0` and must be a non-negative integer that fits in 64 bits. `--selftest`
    ignores every other flag. `--help` writes the usage block above to stdout and exits `0`.
47. In headless mode **stdout carries exactly one line**: the JSON summary, terminated by a single
    `\n`. Diagnostics, warnings and progress go to stderr. Exit status is `0` when the whole script
    replayed without a malformed command, regardless of whether the game was won or lost.

### 6.2 Input script format

48. UTF-8 text, one command per line. Blank lines and lines whose first non-space character is `#`
    are ignored and do not count as ticks. Leading and trailing whitespace is stripped; arguments
    are separated by single spaces. Commands are case-sensitive and lowercase.

    | Command                          | Effect                                                                   |
    | -------------------------------- | ------------------------------------------------------------------------ |
    | `up` / `down` / `left` / `right` | Move the cursor one cell, clamped at the edge                            |
    | `move <col> <row>`               | Set the cursor absolutely; out-of-range values are clamped into the grid |
    | `reveal`                         | Reveal at the cursor (§4.5)                                              |
    | `flag`                           | Cycle the marker at the cursor (§4.5)                                    |
    | `chord`                          | Chord at the cursor (§4.5)                                               |
    | `hint`                           | Run the solver read-only; increment `hints_used`; record `last_hint`     |
    | `auto`                           | One solver step (§4.7 requirement 29)                                    |
    | `autoplay`                       | Repeat `auto` until won, lost or stalled                                 |
    | `wait <n>`                       | Advance the virtual clock by `n` whole seconds, `n >= 0`                 |
    | `restart`                        | Rebuild the game with the same settings; see requirement 50              |
    | `quit`                           | Stop replaying; all remaining lines are ignored                          |

49. Every executed command — including `quit` and `restart`, excluding comments and blank lines —
    increments `ticks` by exactly one. `ticks` is a session counter and is **not** reset by
    `restart`. Commands that are no-ops under the game rules still count.
50. `restart` clears the board, marker states, `revealed`, `flags`, `questions`, `chords`,
    `first_click`, `gen_attempts` (back to `0`), `layout_digest` (back to sixteen `0`s), the stalled
    flag and the virtual clock, sets the status back to `playing`, and forces the next reveal to
    generate a fresh layout from the generator's *current* state. `hints_used`, `ticks` and `seed`
    survive a restart.
51. An unrecognised command, a command with the wrong argument count, or a non-integer argument is a
    hard error: write `line <n>: <message>` to stderr and exit with status `3`. No JSON is printed.

### 6.3 JSON summary schema

52. On exit from headless mode, print one compact JSON object with **these keys, in this order**:

    | Key               | Type                         | Meaning                                                                                                                                                                   |
    | ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `schema`          | string                       | Always `"minesweeper.v1"`                                                                                                                                                 |
    | `seed`            | integer                      | The `--seed` value                                                                                                                                                        |
    | `width`           | integer                      | Board width                                                                                                                                                               |
    | `height`          | integer                      | Board height                                                                                                                                                              |
    | `mines`           | integer                      | Total mines                                                                                                                                                               |
    | `difficulty`      | string                       | `"beginner"`, `"intermediate"`, `"expert"` or `"custom"`                                                                                                                  |
    | `no_guess`        | boolean                      | Whether `--no-guess` was requested                                                                                                                                        |
    | `gen_attempts`    | integer                      | Layouts generated for the current board (§4.8); `0` if never generated                                                                                                    |
    | `layout_digest`   | string                       | 16 lowercase hex digits, see requirement 54; `"0000000000000000"` if never generated                                                                                      |
    | `status`          | string                       | `"playing"`, `"won"` or `"lost"`                                                                                                                                          |
    | `board`           | array of strings             | `height` strings of `width` characters each, top row first, see requirement 53                                                                                            |
    | `revealed`        | integer                      | Number of **non-mine** cells in state `REVEALED`                                                                                                                          |
    | `flags`           | integer                      | Number of cells in state `FLAGGED`, counting a wrong flag exposed by a loss (rendered `!`) and a correct flag on a mine (rendered `F`) — a loss never changes this number |
    | `questions`       | integer                      | Number of cells in state `QUESTION`. A question-marked mine becomes `REVEALED` on a loss (requirement 20) and so stops counting                                           |
    | `mines_remaining` | integer                      | `mines - flags`; may be negative                                                                                                                                          |
    | `first_click`     | array of 2 integers, or null | `[col, row]` of the first-click cell, `null` before generation                                                                                                            |
    | `ticks`           | integer                      | Commands executed (requirement 49)                                                                                                                                        |
    | `elapsed_seconds` | integer                      | Virtual clock (requirement 23)                                                                                                                                            |
    | `hints_used`      | integer                      | Number of `hint` commands executed                                                                                                                                        |
    | `last_hint`       | string or null               | The last hint string (`"safe:c,r"`, `"mine:c,r"`, `"none"`); `null` if never hinted                                                                                       |
    | `chords`          | integer                      | Number of `chord` commands that actually revealed at least one cell                                                                                                       |
    | `solver_stalled`  | boolean                      | True if any `auto`/`autoplay` step stalled since the last `restart`                                                                                                       |

53. Board characters:

    | Char     | Meaning                                          |
    | -------- | ------------------------------------------------ |
    | `.`      | Hidden, unmarked                                 |
    | `F`      | Flagged                                          |
    | `?`      | Question-marked                                  |
    | `0`..`8` | Revealed non-mine cell with that neighbour count |
    | `*`      | Revealed mine (shown after a loss)               |
    | `X`      | The mine the player detonated                    |
    | `!`      | A flag on a non-mine cell, exposed after a loss  |

    Exactly one `X` appears in a `lost` board and none in any other. `F` and `!` are both the
    `FLAGGED` state and both count toward `flags`; they are drawn differently only so a scorer can
    see which flags were right. In a `lost` board the characters `X`, `*` and `F` together account
    for exactly `mines` cells (requirement 20). A `won` board contains only digits and `F`.
54. `layout_digest` is FNV-1a 64 over the mine bitmap: start with `h = 0xCBF29CE484222325`; for each
    cell in ascending row-major order take the byte `0x31` if it is a mine else `0x30`, set
    `h = ((h XOR byte) * 0x100000001B3) mod 2^64`; format `h` as exactly 16 lowercase hex digits,
    zero-padded. This lets a scorer compare layouts between two languages even mid-game, when the
    board string still hides them.
55. Serialisation is compact and canonical: no whitespace outside string values, `,` and `:` with no
    padding, keys in the order of the table, booleans as `true`/`false`, `null` unquoted, integers
    with no sign for non-negatives and no leading zeros. Do not use a library setting that sorts
    keys alphabetically or pretty-prints.

### 6.4 Selftest

56. `--selftest` runs built-in invariant checks with no terminal and no script, writes one
    `PASS <name>` or `FAIL <name>` line per check to stdout, then a final
    `selftest: <passed> passed, <failed> failed`, and exits `0` if and only if nothing failed. It
    must include at least these named checks:

    | Name                   | Assertion                                                                                                                                                                                   |
    | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `rng_vector`           | The first four `next_u64()` values for seed `0`, and for seed `42`, are stable across runs and are printed to stderr so they can be diffed between languages                                |
    | `rand_below_range`     | 10,000 draws of `rand_below(7)` all land in `[0,7)` and every value occurs at least once                                                                                                    |
    | `first_click_safe`     | For seeds 1..200 on `expert`, generating after a first click at `(0,0)` and again at `(15,8)` never places a mine in the forbidden set                                                      |
    | `mine_count`           | Generated layouts contain exactly `mines` mines, for all three presets                                                                                                                      |
    | `neighbour_counts`     | For a generated `intermediate` board, every non-mine cell's stored count equals a freshly recomputed count                                                                                  |
    | `flood_iterative`      | On a 60x40 custom board with 1 mine, revealing a far corner reveals at least 2,390 cells and the fill uses an explicit worklist (assert the worklist's peak depth is recorded and non-zero) |
    | `flood_respects_flags` | A flood fill never reveals a `FLAGGED` cell                                                                                                                                                 |
    | `marker_cycle`         | `flag` applied four times to one hidden cell returns it to `HIDDEN`, passing through `FLAGGED` and `QUESTION`                                                                               |
    | `chord_noop`           | Chording with a flag count different from the cell's number changes nothing                                                                                                                 |
    | `win_flags_all_mines`  | After a forced win, every mine is `FLAGGED` and `mines_remaining` is `0`                                                                                                                    |
    | `solver_sound`         | Over seeds 1..200 on `intermediate`, no cell the solver deduced safe is a mine and no cell it deduced a mine is safe                                                                        |
    | `no_guess_solvable`    | Ten `--no-guess` beginner boards are each solved to `won` by `autoplay` with no stall                                                                                                       |
    | `json_stable`          | The summary of one fixed script under one fixed seed is byte-identical when produced twice in the same process                                                                              |

## 7. Deliverables

Every path below is relative to `tui-games/solutions/{{RUN_ID}}/minesweeper/{{LANGUAGE}}/`.

57. Source files for the implementation, organised into modules with at minimum a separation between
    board/rules, solver, terminal/render, and headless replay.
58. `build.sh` — compiles or installs. A no-op `exit 0` is fine for an interpreted language, but it
    must still exist and be executable.
59. `run.sh` — launches the program, forwarding all arguments.
60. `test.sh` — exits `0` if and only if everything passes. It must at minimum:
    (a) run `./run.sh --selftest`;
    (b) replay **every** script in `scripts/` and compare stdout byte for byte against the matching
        file in `expected/`, failing on any difference;
    (c) replay at least one script twice and assert the two outputs are identical;
    (d) assert that a malformed script exits with status `3` and a bad `--width` exits with
        status `2`.
61. `scripts/` and `expected/` — recorded input scripts and the exact summaries they produce. These
    three pairs are required, under exactly these names:

    | Script                     | Expected summary             | Must end in                                                                    |
    | -------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
    | `scripts/loss.txt`         | `expected/loss.json`         | `status:"lost"`, with `X`, at least one `*`, and at least one `!` on the board |
    | `scripts/win-autoplay.txt` | `expected/win-autoplay.json` | `status:"won"` reached via `autoplay`, `solver_stalled:false`                  |
    | `scripts/no-guess.txt`     | `expected/no-guess.json`     | a `--no-guess` board, `status:"won"`, `no_guess:true`                          |

    Additional pairs are welcome. Record the invocation of every pair in `scripts/MANIFEST.tsv`, a
    tab-separated file with a header row and the columns `name`, `flags`, `expected` — for example
    `loss<TAB>--difficulty beginner --seed 7<TAB>expected/loss.json`. `test.sh` reads the manifest
    rather than hardcoding invocations, so adding a pair requires no change to `test.sh`.
62. `README.md` — how to build and run, the key bindings, the CLI surface, and the script format.
63. `NOTES.md` — three non-empty sections under these headings: **Design decisions** (at least the
    board representation, the flood-fill worklist, and how terminal restoration is guaranteed),
    **Known gaps** (every requirement of §4-§7 you did not fully implement, named by its number, or
    the sentence "None." if there are none), and **With more time**. A `NOTES.md` that claims no
    gaps while `test.sh` or `--selftest` fails is scored as a false claim, not as a gap.
64. `SOLVER.md` — the task-specific document: which deduction rules you implemented and how you
    reached the fixpoint, worked examples of a rule-1 and a rule-2 deduction on a small board drawn
    in ASCII, how the global constraint is folded in, and the measured no-guess retry statistics
    (mean and maximum `gen_attempts` over at least 100 seeds per preset, with the numbers you
    actually observed).
65. `run.json` — filled in per `CONVENTIONS.md` §5, with `self_reported_status` honestly set.

## 8. Definition of done

Verify each of these yourself before you declare completion.

- [ ] The workspace is exactly `tui-games/solutions/{{RUN_ID}}/minesweeper/{{LANGUAGE}}/` and nothing
      was written outside it.
- [ ] `./build.sh` exits `0` from a clean checkout with no network access.
- [ ] `./run.sh` with no arguments starts a playable beginner game in a real terminal.
- [ ] `./run.sh --selftest` prints the `PASS`/`FAIL` lines, includes every check named in
      requirement 56, and exits `0`.
- [ ] `./run.sh --headless --script scripts/<name>.txt --seed <n>` prints exactly one line of
      compact JSON on stdout and nothing else.
- [ ] Running that same command twice produces byte-identical stdout.
- [ ] The JSON has all 22 keys of requirement 52, in that order, with the documented types.
- [ ] `layout_digest` is 16 lowercase hex digits and matches the FNV-1a definition.
- [ ] The first reveal never hits a mine, and always opens a region — checked over at least 200
      seeds by `first_click_safe`.
- [ ] Flood fill is iterative; there is no recursive reveal function anywhere in the source.
- [ ] `flag` cycles hidden -> flag -> question -> hidden, and flagged cells cannot be revealed.
- [ ] Chording reveals neighbours only when the flag count equals the number.
- [ ] `mines_remaining` goes negative when the player over-flags.
- [ ] A loss shows every mine — exactly one `X`, the unflagged rest as `*`, correctly flagged ones
      left as `F` — and marks wrong flags `!` without changing `flags` or `mines_remaining`.
- [ ] A win flags every mine and leaves no `.`, `?` or `!` on the board.
- [ ] All three presets and a custom `5x5/1` and `60x40/500` board are playable; out-of-range sizes
      exit `2`.
- [ ] `hint` never mutates the board and returns `safe:`/`mine:`/`none` in the documented format.
- [ ] `autoplay` on a `--no-guess` board reaches `won` with `solver_stalled` false.
- [ ] `gen_attempts` is `1` without `--no-guess` and `>= 1` with it, never `0` after a first click.
- [ ] The terminal is restored after `q`, after `Ctrl-C`, and after a deliberately induced panic.
- [ ] The process is idle at ~0% CPU when no key is pressed.
- [ ] `./test.sh` exits `0` and covers requirement 60 (a) through (d).
- [ ] All three required script/expected pairs of requirement 61 exist under exactly those names,
      and `expected/*.json` was produced by this program rather than written by hand.
- [ ] `scripts/MANIFEST.tsv`, `README.md`, `NOTES.md`, `SOLVER.md` and `run.json` all exist and are
      complete — no `TODO`, no placeholders.

## 9. Scoring rubric

Total 100 points.

| #   | Criterion                                  | Weight | What earns the points                                                                                                                                                                              |
| --- | ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Headless determinism and JSON contract     | 18     | One compact line, exact key set and order, exact board alphabet, byte-identical across repeated runs; correct exit codes `0`/`2`/`3`                                                               |
| 2   | Core gameplay rules                        | 22     | Reveal/flood/marker cycle/chord semantics, win and loss reveal behaviour, mine counter, virtual timer, three presets and custom bounds, cursor clamping                                            |
| 3   | Safe first click and generator conformance | 10     | Board generated only on first reveal, 9-cell forbidden set, SplitMix64 + `rand_below` + partial Fisher-Yates implemented exactly; `layout_digest` reproducible                                     |
| 4   | Solver correctness                         | 20     | Rules 1 and 2 plus the global constraint, run to a fixpoint; sound on every tested seed; `hint` selection order and format; `auto`/`autoplay` apply-all semantics and stall detection              |
| 5   | No-guess generation                        | 10     | Retry loop with scratch simulation, 1000-attempt cap with the documented fallback, accurate `gen_attempts`, generated boards actually solvable without guessing                                    |
| 6   | TUI quality and terminal hygiene           | 10     | Raw mode restored on every exit path including panic and SIGINT, no busy-wait, buffered redraw within the 16 ms budget, legible colourised board with a working status bar and `NO_COLOR` fallback |
| 7   | Tests                                      | 6      | `test.sh` covers requirement 60 (a)-(d); the selftest implements every named check                                                                                                                 |
| 8   | Documentation                              | 4      | `README.md`, `NOTES.md` and a `SOLVER.md` with real worked examples and real measured retry statistics                                                                                             |

Partial credit is given per criterion. A criterion whose behaviour cannot be exercised because the
program fails to build, or because headless mode does not run, scores zero for that criterion — it
is not estimated from reading the source.
