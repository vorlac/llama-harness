# Acceptance: `tui-games/snake`

Operator-facing companion to `tui-games/tui-snake-impl-prompt.md`. That prompt is the
authoritative specification; this file tells you how to seed a workspace, how to verify a
submission, and what to look for by hand. Section references of the form §4.3 point into
the prompt. Repository-wide rules (run IDs, workspace layout, `run.json`, the three-script
contract, scoring) are in `CONVENTIONS.md`.

- **Task id**: `snake`  **Size**: S  **Difficulty**: 2/10
- **Languages**: `rust`, `go`, `cpp`, `python`, `ts`
- **Starting material**: none. This is a greenfield task.
- **Verify command**: `./test.sh` in the workspace directory.

## 1. Seeding a workspace

```sh
tools/new_workspace.sh <run-id> snake <language>
# e.g.
tools/new_workspace.sh qwen3.6-27B__vanilla snake rust
```

That creates `tui-games/solutions/<run-id>/snake/<language>/` and seeds `run.json`. There
is no starting code to copy. Hand the model the contents of
`tui-games/tui-snake-impl-prompt.md` verbatim with `{{LANGUAGE}}` and `{{RUN_ID}}`
substituted. Everything under `tui-games/tasks/` stays read-only (`CONVENTIONS.md` §10).

## 2. Running the verification

From the workspace directory:

```sh
./build.sh                 # must exit 0, offline
./test.sh                  # must exit 0; this is what score.py reads
./run.sh --selftest        # must print "selftest: PASS" and exit 0
./run.sh < /dev/null       # must print scripts/demo.expected.json and exit 0 (prompt §6.5)
```

Every recorded script is replayed at `--seed 42` (prompt §6.7), so each expected file can
be regenerated and re-checked directly:

```sh
for s in eat crash-wall crash-self demo; do
  ./run.sh --headless --script scripts/$s.txt --seed 42 \
    | cmp - scripts/$s.expected.json && echo "$s OK"
done
./run.sh < /dev/null | cmp - scripts/demo.expected.json && echo "no-TTY OK"
```

Timeouts from `task.json`: build 300 s, run 60 s, test 300 s.

The single most useful smoke check — it isolates the board, the LCG, the movement rules and
the serializer in one command:

```sh
printf 'TICK\n' > /tmp/one.txt
cat > /tmp/one.expected.json <<'EOF'
{"schema":"tui-snake/1","seed":42,"width":40,"height":20,"ticks":1,"status":"alive","score":0,"length":3,"food_eaten":0,"paused":false,"restarts":0,"direction":"RIGHT","head":[21,10],"food":[34,6],"snake":[[21,10],[20,10],[19,10]],"board":"......................................../......................................../......................................../......................................../......................................../......................................../..................................*...../......................................../......................................../......................................../...................##@................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../......................................../........................................"}
EOF
./run.sh --headless --script /tmp/one.txt --seed 42 > /tmp/one.actual.json
cmp /tmp/one.expected.json /tmp/one.actual.json && echo "golden OK"
```

The expected line is 1061 bytes plus a trailing newline. It is reproduced verbatim in
prompt §6.4, so a submission has no excuse for missing it.

**Cross-language golden.** Every rule that affects the summary is pinned — board size,
start position, the LCG constants, the free-cell ordering, the single `next()` call per
placement, collision semantics, key order in the JSON. Therefore the same script and seed
must yield the identical summary in *all five* languages. Once two languages of a run
agree, diff every other language against them:

```sh
for l in rust go cpp python ts; do
  d=tui-games/solutions/<run-id>/snake/$l
  [ -d "$d" ] && (cd "$d" && ./run.sh --headless --script /tmp/one.txt --seed 42)
done | sort -u | wc -l     # expect 1
```

More than one distinct line means at least one implementation misread §4. Identify the
majority and inspect the outlier rather than assuming the majority is right.

## 3. Headless JSON schema

One line on stdout, compact (no space after `:` or `,`), keys in exactly this order,
terminated by a single `\n`. Nothing else may be written to stdout.

| # | Key | Type | Constraint |
|---:|---|---|---|
| 1 | `schema` | string | exactly `"tui-snake/1"` |
| 2 | `seed` | int | the value passed to `--seed` |
| 3 | `width` | int | `40` |
| 4 | `height` | int | `20` |
| 5 | `ticks` | int | ticks executed in the current game; `RESTART` resets it to 0 |
| 6 | `status` | string | `alive` \| `dead_wall` \| `dead_self` \| `won` \| `quit` |
| 7 | `score` | int | `10 * food_eaten` |
| 8 | `length` | int | `3 + food_eaten` in a game with no restarts |
| 9 | `food_eaten` | int | food eaten in the current game |
| 10 | `paused` | bool | lowercase `true`/`false` |
| 11 | `restarts` | int | `RESTART` tokens honoured |
| 12 | `direction` | string | `UP` \| `DOWN` \| `LEFT` \| `RIGHT`, committed direction at exit |
| 13 | `head` | `[int,int]` | `[x, y]`, equals `snake[0]` |
| 14 | `food` | `[int,int]` or `null` | `null` only when the board is full |
| 15 | `snake` | array of `[int,int]` | head first, tail last, length == `length` |
| 16 | `board` | string | 20 rows of 40 chars joined by `/` = 819 chars; `.` empty, `#` body, `@` head, `*` food |

Structural invariants a checker can assert without knowing the game:

- `len(board) == 819` and `board.count('/') == 19`.
- `board.count('@') == 1`; `board.count('#') == length - 1`; `board.count('*') == (0 if food is null else 1)`.
- `head == snake[0]`, `len(snake) == length`, all cells distinct, all within `0..39 × 0..19`.
- `score == 10 * food_eaten`.
- Every number is an integer literal: `grep -E '[0-9]+\.[0-9]|e[+-]?[0-9]|"[0-9]'` on the line must find nothing.
- Byte-for-byte stability: replay the same script and seed twice, `cmp` the two outputs.

## 4. Scored criteria and how to check them

Weights match prompt §9 and sum to 100. "Mechanical" checks can be scripted; "inspection"
checks need a human or a recorded terminal session.

| Pts | Criterion | How to check |
|---:|---|---|
| 30 | Game rule correctness (§4) | Mechanical. `./run.sh --selftest` must pass all twelve named checks of §6.6 — read its per-check lines, do not trust only the exit code. Then replay the operator scripts of §5 below and compare against the majority/golden summary. Confirm `dead_wall` and `dead_self` are distinguished, that tail-chase does not kill, that reversal is blocked, and that the speed table is exact. |
| 20 | Headless contract and determinism (§6) | Mechanical. §6.4 example byte-identical; all structural invariants of §3 above; `run.sh --headless/--selftest/no-arg` all present; `./run.sh < /dev/null` exits 0 with one JSON line; two identical replays `cmp` clean; unknown token exits 2 with an empty stdout. Read `test.sh`: it must compare whole summaries (`diff`/`cmp` against a checked-in `.expected.json`), cover the three pinned scripts of §6.7 (`scripts/eat.txt`, `scripts/crash-wall.txt`, `scripts/crash-self.txt`), and include a determinism repeat. A `test.sh` that only greps for `"status"` scores near zero on this row. |
| 15 | Terminal hygiene (§4.8, §5) | Mostly mechanical, see §6 below. `stty -g` before and after a `SIGINT`-killed session must match; cursor visible and normal screen restored; a forced panic must restore too; resize must not corrupt or crash, and a 30×10 terminal must print exactly `terminal too small: need 42x24, have 30x10` and recover when enlarged (prompt requirement 34). |
| 15 | Loop discipline (§4.5, §4.7, §5) | Mixed. Mechanical: CPU time under 0.5 s over 10 s idle, and again over 10 s paused. Inspection: read the main loop for a real blocking wait with a deadline-derived timeout, for input drained per pass, and for a renderer that diffs or writes one buffer per frame. Flicker is judged by watching a session. |
| 10 | Build and script contract | Mechanical. `build.sh` exits 0 offline; all three scripts are executable, start with `#!/usr/bin/env bash` and `set -euo pipefail`, and contain no absolute paths (`grep -n '/Users/\|/home/\|/tmp/[a-z]*/' *.sh`). Build with the network disabled to confirm no fetch. |
| 5 | Code structure | Inspection. Game state and rules must be usable without a terminal — that is what makes `--selftest` possible. Look for a pure step function, a separate renderer, a separate terminal layer. Penalise rules embedded in the draw loop. |
| 5 | Documentation | Inspection. `README.md` covers build, play, keys, headless CLI, JSON schema. `NOTES.md` explains the tick loop, the anti-flicker strategy, the measured mean full-frame render time (prompt requirement 33) and the restoration guarantee. `run.json` complete per `CONVENTIONS.md` §5; note any divergence between `self_reported_status` and the measured result. |

## 5. Operator replay scripts

Keep these three under your evaluation harness (not in the workspace) and run them against
every submission in addition to the submission's own recorded scripts. They cover the
behaviours most often broken.

`walk.txt` — straight-line movement and the speed/score path:

```
TICK 5
DOWN
TICK 3
RIGHT
TICK 4
```

`wall.txt` — must end `dead_wall` with `direction` `UP` and `ticks` 11:

```
UP
TICK 20
```

`east-wall.txt` — must end `dead_wall` with `direction` `RIGHT` and `ticks` 20, at every
seed, because a straight run east from `[20, 10]` leaves the board on tick 20 whether or
not food was eaten on the way:

```
TICK 40
```

There is no seed-independent self-collision script: a length-3 snake cannot hit itself, so
any `dead_self` case depends on where food lands. Take the `dead_self` path from the
submission's own `scripts/crash-self.txt` (prompt §6.7 pins that name and `--seed 42`) and
corroborate it with the `self` and `tail-chase` checks in `--selftest`. The `walk.txt`,
`wall.txt` and `east-wall.txt` scripts above live in your harness, not the workspace, and
their names deliberately do not collide with the `scripts/*.txt` pinned by §6.7.

A pause/restart probe worth running by hand:

```
TICK 3
PAUSE
TICK 5
PAUSE
TICK 2
```

`ticks` must be 5, not 10, and `paused` must be `false`.

## 6. Terminal-hygiene recipes

Signal restoration (Linux/macOS, run in a real terminal):

```sh
before=$(stty -g)
./run.sh & pid=$!
sleep 2; kill -INT $pid; wait $pid || true
after=$(stty -g)
[ "$before" = "$after" ] && echo "termios restored" || echo "TERMIOS LEAKED"
```

Then confirm by eye that the cursor is visible, typing echoes, and the shell scrollback is
back (alternate screen exited). Repeat with `kill -TERM`.

Idle CPU:

```sh
./run.sh & pid=$!
sleep 10
ps -o time=,etime= -p $pid   # sample while it is still alive: CPU < 0.5 s for ~10 s elapsed
kill -INT $pid; wait $pid || true
```

Repeat with the game paused (press `p` first); requirement 37 covers both states.

Panic path: a terminal smaller than 42×24 is **not** a fault — requirement 34 makes it a
handled state — so force a real one instead: patch a deliberate panic/abort into the draw
path behind a temporary edit, rebuild, and confirm the terminal still comes back clean.
Failing that, send an enormous paste to stdin, or read the code for a scope guard /
`defer` / `try-finally` / destructor rather than a single cleanup call on the happy path.

## 7. Known failure modes for this game

Watch for these specifically; they are the recurring ways `snake` submissions fail.

1. **Busy-wait disguised as a game loop.** A `while true` that checks `now >= deadline` and
   otherwise loops, or a 1 ms sleep spin. Catch it with the idle-CPU measurement, not by
   reading the sleep call alone.
2. **Sleep-then-read input.** `sleep(120ms)` followed by a non-blocking read drops keys
   pressed during the sleep and makes the game feel unresponsive. The wait must be the
   input read, with a timeout derived from the tick deadline.
3. **Clear-screen flicker.** `\x1b[2J` plus a full repaint every tick. Visible as tearing
   or a strobing board. Grep for `2J` and check it is not in the per-tick path.
4. **Terminal left in raw mode after `Ctrl-C`.** The single most common failure. Cleanup on
   the happy path only, or a `SIGINT` handler that calls `exit()` before restoring.
5. **Reversal through the neck.** Validating the new direction against the *pending*
   direction instead of the *committed* one, so `UP` then `LEFT` while moving `RIGHT` — or
   two opposing presses within one tick — folds the snake into itself.
6. **Tail-chase false collision.** Treating the current tail cell as occupied, so following
   your own tail is an instant death. Requirement 14 forbids this; `--selftest` check 8 covers it.
7. **Off-by-one growth.** Removing the tail on the food tick, so the snake never grows, or
   growing by two. Check `length == 3 + food_eaten`.
8. **Rejection-sampled food.** Drawing repeatedly until a free cell is found consumes a
   state-dependent number of `next()` calls, so replays diverge from the golden output even
   though the game plays correctly. Requirement 8 requires the free-cell-list method.
9. **Extra generator consumers.** Using the same RNG to jitter colours, pick a start
   position, or shuffle anything else. Requirement 7 reserves it for food placement only.
10. **Wall death that moves the snake.** Advancing the head out of bounds before the check,
    producing a summary with a head at `[40, 10]`. The failed tick must leave the snake
    where it was while still counting the tick.
11. **JSON drift.** Pretty-printed output, reordered keys, `true`/`false` capitalised,
    floats from a language that stores numbers as doubles (notably `ts` — force integer
    formatting), a trailing newline missing or doubled, or diagnostics leaking onto stdout
    and corrupting the single-line contract.
12. **`ticks` semantics.** Counting paused ticks, counting a `TICK <n>` token as 1, or not
    resetting `ticks` on `RESTART`.
13. **Restart without re-seeding.** Requirement 23 requires the generator to return to the original
    seed, so a restarted game replays the same food sequence.
14. **Interactive `run.sh` under the scorer.** `run.sh` with no arguments blocking on a TTY
    that does not exist, which hangs until the 60 s run timeout. §6.5 exists to prevent this.
15. **A `test.sh` that cannot fail.** Asserting only exit codes, or grepping for a field
    name. Perturb the expected file by one byte and confirm `test.sh` turns red.
16. **Hand-written expected files.** A `.expected.json` typed out rather than captured from
    the program passes `cmp` against nothing real. Regenerate each one at `--seed 42` and
    confirm it is byte-identical to what is checked in.
17. **Speed curve off by one bucket.** `interval_ms` uses integer division, so 29 food
    still gives 70 ms; 60 ms is first reached at 30. `--selftest` check 10 pins the table.
