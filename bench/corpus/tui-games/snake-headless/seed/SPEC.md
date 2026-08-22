# `snake` — headless replay specification

A game of Snake, driven entirely by a script of directives and reported as one
line of JSON. There is no terminal, no timing and no input device anywhere in
this specification: a replay is a pure function of a seed and a script, so two
implementations that both follow this document produce the same bytes.

Numbered requirements are the contract. Where a constant or a formula is given,
that constant or that formula is the one to use.

## 1. Modules

The work tree is flat and every module is imported, never executed. `src/board.py`
and `src/summary.py` are written and must not change. The four modules below are
what this task is.

| Module | Exports |
|---|---|
| `src/rng.py` | `Lcg` |
| `src/food.py` | `place(snake, rng)` |
| `src/engine.py` | `Game` |
| `src/replay.py` | `ScriptError`, `parse(text)`, `replay(seed, text)`, `fields(game)` |

Cells are `(x, y)` tuples throughout the Python API. They become two-element
lists only in the JSON summary, which `src/summary.py` already handles.

## 2. Board

1. The playfield is **40 columns by 20 rows**. `x` runs `0..39` left to right and
   `y` runs `0..19` top to bottom, so `[0, 0]` is the top-left cell and the
   row-major index of a cell is `y * 40 + x`. `src/board.py` holds both sizes.
2. The board does not wrap. Leaving the playfield in any direction is a wall
   collision.

## 3. Initial state

3. A new game's snake has **length 3**, laid out horizontally with the head at
   `(20, 10)` and the body at `(19, 10)` and `(18, 10)`, in that order. The snake
   is always stored head-first, tail-last.
4. The committed direction is `RIGHT`, the pending direction is `RIGHT`, the
   score is `0`, ticks elapsed is `0`, food eaten is `0`, the status is `alive`
   and the game is not paused.
5. Exactly one food item exists at all times while the game is running. The first
   food is placed during initialisation, before any tick runs, by section 4.

## 4. Randomness and food placement

6. The only source of randomness is a 32-bit linear congruential generator.
   `src/rng.py` exports `Lcg`. `Lcg(seed)` sets the state to `seed mod 2**32`,
   and each `next()` call performs, with wrapping 32-bit arithmetic:

   ```
   state = (state * 1664525 + 1013904223) mod 2**32
   return state
   ```

   For `seed = 1` the first six outputs are exactly

   ```
   1015568748, 1586005467, 2165703038, 3027450565, 217083232, 1587069247
   ```

   and for `seed = 42` they are exactly

   ```
   1083814273, 378494188, 2479403867, 955863294, 1613448261, 110225632
   ```

   Both sequences must reproduce.
7. `next()` is called for **food placement only**. Nothing else in the program
   may consume the generator; that is what makes a replay reproducible.
8. `src/food.py` exports `place(snake, rng)`. It builds the free cells —
   `src.board.free_cells` already does this, in the ascending row-major order
   the placement depends on — and returns `free[rng.next() % len(free)]`.
   Exactly one `next()` call is consumed per placement. Rejection sampling is
   forbidden: it would consume a seed-dependent number of draws.
9. When there are no free cells `place` returns `None` and consumes no draw.
10. Worked example. At the start of a game the snake occupies 3 cells, so the
    free list has 797 entries. With `seed = 42` the first `next()` returns
    `1083814273`, `1083814273 mod 797` is `274`, and free cell 274 is `(34, 6)`.
    With `seed = 1` the first food is `(25, 6)`; with `seed = 7` it is `(8, 5)`.

## 5. The game

`src/engine.py` exports `Game`. `Game(seed)` builds a new game per section 3,
places its first food per section 4, and sets `restarts` to `0`.

11. A `Game` carries exactly these attributes, and the summary of section 8
    reads them: `seed`, `snake` (a list of `(x, y)`, head first), `direction`,
    `pending`, `score`, `ticks`, `food_eaten`, `paused`, `status`, `food`
    (a cell or `None`) and `restarts`.
12. Directions are the strings `UP`, `DOWN`, `LEFT` and `RIGHT`, with deltas
    `(0, -1)`, `(0, +1)`, `(-1, 0)` and `(+1, 0)`.
13. `turn(direction)` sets the **pending** direction if and only if `direction`
    is not the exact opposite of the **committed** direction. It is validated
    against the committed direction and never against the pending one, so two
    opposing directives between two ticks cannot reverse the snake into itself.
    A `turn` while paused, and a `turn` after the game has ended, follow the
    same rule; neither is special.
14. `pause()` toggles `paused`.
15. `tick()` does nothing at all when the status is not `alive` or the game is
    paused — in particular `ticks` does not advance. Otherwise it runs, in this
    order: commit the pending direction, compute the new head cell, increment
    `ticks`, test collisions, then apply growth or the ordinary move.
16. **Wall collision.** If the new head cell is outside the playfield the status
    becomes `dead_wall`. The snake is not moved, and the tick still counts.
17. **Self collision.** If the new head cell equals any snake segment except the
    current tail segment, the status becomes `dead_self`, under the same "the
    tick still counts, the snake is not moved" rule. Moving into the cell the
    tail vacates on this same tick is legal and must not end the game. The tail
    is excluded only when the snake is not growing this tick; food never spawns
    on a snake cell, so a growth tick can never target the tail cell.
18. **Growth.** If the new head cell is the food cell, prepend the new head, do
    **not** remove the tail, add `10` to the score, increment `food_eaten`, and
    then place new food per section 4.
19. **Ordinary move.** Otherwise prepend the new head and remove the last
    segment.
20. **Win.** If after a growth tick the snake's length reaches `40 * 20 = 800`
    the status becomes `won`, `food` becomes `None`, and no food is placed.
21. Statuses are exactly `alive`, `dead_wall`, `dead_self`, `won` and `quit`.
22. `restart()` resets everything in section 3, **re-seeds the generator to the
    original seed** so a restarted game replays the same food sequence, places
    the first food again, and increments `restarts`. It does nothing at all —
    not even to `restarts` — while the status is `alive`.

## 6. Script format

`src/replay.py` exports `parse(text)`, which turns the text of a script into a
list of `(token, count)` pairs in order.

23. A script is UTF-8 text, one directive per line. Leading and trailing
    whitespace on a line is ignored, as is repeated whitespace between a token
    and its count. Blank lines, and lines whose first non-whitespace character
    is `#`, are ignored entirely.
24. Tokens are case-sensitive and are exactly `UP`, `DOWN`, `LEFT`, `RIGHT`,
    `PAUSE`, `QUIT`, `RESTART` and `TICK`. Only `TICK` takes a count: `TICK`
    means one tick and `TICK <n>` means `n` ticks, where `n` is a positive
    decimal integer. `parse` returns a count of `1` for every other token.
25. An unrecognised token, a count on a token that takes none, and a `TICK`
    count that is not a positive decimal integer are each a hard error:
    `parse` raises `ScriptError`. `ScriptError` is defined in `src/replay.py`
    and derives from `Exception`.

## 7. Replay

`replay(seed, text)` builds a `Game(seed)`, applies the parsed script to it, and
returns the game.

26. `UP`, `DOWN`, `LEFT` and `RIGHT` call `turn`. `PAUSE` calls `pause`.
    `RESTART` calls `restart`. `TICK <n>` calls `tick` `n` times.
27. While paused a `TICK` is consumed and ignored and the tick counter does not
    advance — which requirement 15 already gives.
28. After the game has ended, `TICK` directives are consumed and ignored, and a
    `TICK <n>` whose game ends partway through discards the rest of that
    directive's ticks.
29. `QUIT` stops the replay immediately. It sets the status to `quit` only if
    the game was still `alive`; a script that dies into a wall and then quits
    still reports `dead_wall`. Directives after a `QUIT` are not applied.
30. When the script is exhausted the replay stops with whatever status the game
    holds, which is `alive` if the game is still running.

## 8. Summary

`fields(game)` returns the summary as a `dict`, which `src.summary.to_line`
serialises. `to_line` owns the key order and the compaction; `fields` owns the
values.

| Key | Type | Value |
|---|---|---|
| `schema` | string | always `src.summary.SCHEMA` |
| `seed` | int | the seed the game was built with |
| `width` | int | `40` |
| `height` | int | `20` |
| `ticks` | int | ticks executed in the current game; `restart` resets it to 0 |
| `status` | string | one of the five of requirement 21 |
| `score` | int | 10 per food eaten in the current game |
| `length` | int | number of snake segments |
| `food_eaten` | int | food eaten in the current game |
| `paused` | bool | whether the game is paused |
| `restarts` | int | restarts honoured |
| `direction` | string | the committed direction |
| `head` | `[int,int]` | the head cell |
| `food` | `[int,int]` or `null` | the food cell, or `null` when there is none |
| `snake` | array of `[int,int]` | every segment, head first, tail last |
| `board` | string | `src.board.render`, 819 characters |

31. Every cell in the summary is a two-element **list**, never a tuple: a tuple
    serialises as a JSON array too, but `fields` is compared as a dict by the
    checks, so the types have to match as well as the bytes.
32. Every number is an integer. Never emit a float, an exponent or a `+` sign.

## 9. Worked example

`replay(42, "TICK\n")` serialised by `to_line(fields(game))` is exactly this one
line, 1061 bytes, shown wrapped here only for legibility — the real line has no
breaks in it:

```
{"schema":"tui-snake/1","seed":42,"width":40,"height":20,"ticks":1,"status":"alive","score":0,"length":3,"food_eaten":0,"paused":false,"restarts":0,"direction":"RIGHT","head":[21,10],"food":[34,6],"snake":[[21,10],[20,10],[19,10]],"board":"......................................../......................................../......................................../......................................../......................................../......................................../..................................*...../......................................../......................................../......................................../...................##@................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../........................................"}
```

If that line does not reproduce byte for byte, something in sections 2 to 5 or
section 8 is wrong.

## 10. Out of scope

There is no interactive mode, no terminal handling, no rendering to a screen, no
signal handling, no pacing and no clock. The tick interval, the alternate
screen, raw mode and the too-small-terminal message belong to the interactive
game this specification deliberately does not describe. Nothing in the work tree
may sleep, read the wall clock, read a real random source, or open a socket.
