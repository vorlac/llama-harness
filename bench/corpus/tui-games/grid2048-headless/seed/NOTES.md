# Notes

## What this workspace is

A headless 2048, specified by `SPEC.md`. The generator, the board, the spawn
protocol, the counters, the script parser, the replay loop and the summary are
written and pass the visible suite. Two modules are partial.

## Requirement index

| Requirement | Where | State |
|---|---|---|
| R1, R2 | `src/board.py` | done |
| R3, R4 | `src/rng.py` | done |
| R5, R6 | `src/session.py` | done |
| R7 step 1, R7 step 3, R8 | `src/moves.py` | done |
| R7 step 2 | `src/moves.py` | **not implemented** |
| R9 | `src/moves.py` | fails wherever a line merges |
| R10, R11, R12 | `src/session.py` | done, and correct only once R7 is |
| R13 grid and score | `src/undo.py` | done |
| R13 move counter, R13 generator state, R13 capacity | `src/undo.py` | **not implemented** |
| R14 empty stack, R14 not-a-move | `src/undo.py` | done |
| R14 identical spawn after an undo | `src/undo.py` | **not implemented** |
| R15 | `src/session.py`, `src/replay.py` | done |
| R16, R17 | `src/replay.py` | done |
| R18, R19 | `src/replay.py`, `src/summary.py` | done |

## The two gaps, stated plainly

`src/moves.py` slides but never merges. `slide_left` gathers a row's non-zero
values, pads back to four, and reports a gain of zero, so `[2,2,2,2]` comes back
as `[2,2,2,2]` rather than `[4,4,0,0]`, no tile ever combines, and the score
never leaves zero. R7 step 2 is the whole of what is missing; R8 already routes
all four directions through `slide_left`, so the fix lands once for all of them.

`src/undo.py` snapshots the board and the score and writes both back. It does
not snapshot the move counter or the generator's state, so `moves` keeps
climbing across an undo and a direction replayed after an undo draws fresh
numbers and spawns a different tile in a different cell. The stack is also
unbounded, and `CAPACITY` is declared but not enforced.

The two files share nothing. Neither imports the other, and `src/session.py`
calls into both without either knowing the other exists.

## Visible suite

`python3 tools/run_tests.py tests` covers the written modules and the parts of
the two partial ones that are done. It passes as the tree stands and must keep
passing.
