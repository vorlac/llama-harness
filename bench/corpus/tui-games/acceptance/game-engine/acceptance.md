# Acceptance — `game-engine` (tui-games, size XXL)

Operator-facing companion to `tui-games/tui-game-engine-prompt.md`. That prompt is what the model
under evaluation receives; this file is what you use to seed, run and judge the result. Section
references of the form §4.B, §6.2 point into the prompt. Repository-wide rules (run IDs, workspace
layout, `run.json`, the three-script contract, read-only task material) are in `CONVENTIONS.md`.

This is the largest task in the corpus and the only one whose primary criterion is architectural
rather than behavioural. Budget time accordingly: a full evaluation of one language takes roughly
20–30 minutes of operator attention on top of the build.

---

## 1. Seeding a workspace

```sh
tools/new_workspace.sh <run-id> game-engine <language>
# e.g.
tools/new_workspace.sh qwen3.6-27B__llama-harness game-engine rust
```

Resulting path (`CONVENTIONS.md` §4):

```
tui-games/solutions/<run-id>/game-engine/<language>/
```

`starting_material` is `null` — this is greenfield. Nothing is copied in. The model creates
everything under that one directory; anything it writes elsewhere, and in particular any edit under
`tui-games/tasks/`, is a protocol violation worth recording in the run notes.

Languages in scope: `rust`, `go`, `cpp`, `python`, `ts`.

---

## 2. Running the verification

From the language folder:

```sh
cd tui-games/solutions/<run-id>/game-engine/<language>

./build.sh                        # must succeed offline
./test.sh                         # the scored gate: exit 0 iff everything passes
```

Then the checks `test.sh` cannot be trusted to make against itself:

```sh
# 2.1 Engine standalone (the architectural gate)
rm -rf /tmp/eng-check && cp -R . /tmp/eng-check
rm -rf /tmp/eng-check/games /tmp/eng-check/assets
( cd /tmp/eng-check && ./build.sh --engine-only && ./test.sh --engine-only )

# 2.2 No game names inside the engine
grep -rniE 'snake|tetris|tetromino' engine/ ; echo "exit=$?"    # expect exit=1, no matches

# 2.3 Determinism, same run twice
./run.sh --headless --script scripts/snake-eat.txt --seed 1 > /tmp/a.json
./run.sh --headless --script scripts/snake-eat.txt --seed 1 > /tmp/b.json
cmp /tmp/a.json /tmp/b.json

# 2.4 Independent oracles (section 4 below) — not the model's own recorded scripts
printf 'TICK 24\n'  > /tmp/oracle-snake-basic.txt
printf 'TICK 72\n'  > /tmp/oracle-snake-eat.txt
./run.sh --headless --script /tmp/oracle-snake-basic.txt --seed 1
./run.sh --headless --script /tmp/oracle-snake-eat.txt   --seed 1

# 2.5 Benchmark
./run.sh --bench-render

# 2.6 Capability degradation
TUIE_COLOR=mono TUIE_UNICODE=0 ./run.sh --capabilities
NO_COLOR=1 ./run.sh --capabilities
COLORTERM=truecolor ./run.sh --capabilities

# 2.7 Selftests
./run.sh --selftest ; echo "exit=$?"
./run.sh --engine-selftest ; echo "exit=$?"

# 2.8 stdout hygiene in headless mode
./run.sh --headless --script scripts/snake-basic.txt --seed 1 2>/dev/null | wc -l   # expect 1
```

Cross-language determinism (run once you have two or more languages for the same run ID):

```sh
for L in rust go python; do
  ( cd tui-games/solutions/<run-id>/game-engine/$L \
    && ./run.sh --headless --script /tmp/oracle-snake-eat.txt --seed 1 )
done | sort -u | wc -l          # expect 1
```

Interactive smoke test (needs a real terminal; not scriptable, do it by hand once per language):

```sh
./run.sh --game snake     # play a few seconds, press F3, press p, press q
./run.sh --game tetris    # same, plus rotate and hard drop
./run.sh --game snake     # then kill it with Ctrl+C mid-frame
reset -Q ; echo "if the shell was already sane before this line, terminal restore is fine"
```

---

## 3. Headless JSON schema

One line of compact JSON on stdout, `\n`-terminated, no whitespace outside strings, keys in exactly
this order, all values integers/strings/booleans/`null` as shown. Diagnostics go to stderr (§5.9).

### 3.1 Snake

```
{"game":"snake","seed":<int>,"ticks":<int>,"steps":<int>,"status":"alive|dead|won","paused":<bool>,"score":<int>,"length":<int>,"head":[<x>,<y>],"dir":"U|D|L|R","food":[<x>,<y>]|null,"board":"<rows>"}
```

| Key | Meaning |
|---|---|
| `seed` | The `--seed` value as given. |
| `ticks` | Fixed updates in which the simulation advanced. Paused updates and updates after a terminal status do not count. |
| `steps` | Snake moves performed. One step per 8 counted ticks (§4.J3). |
| `status` | `alive`, `dead` (wall or self collision), `won` (board full). |
| `paused` | Whether the pause overlay is on top at exit. |
| `score` | 10 per food. |
| `length` | Number of occupied snake cells. |
| `head` | `[x, y]` of the head. |
| `dir` | Direction in effect at the last step. |
| `food` | `[x, y]`, or `null` only when the board is full. |
| `board` | 12 rows of 20 chars joined by `/`; `.` empty, `H` head, `o` body, `*` food. 251 characters total. |

### 3.2 Tetris

```
{"game":"tetris","seed":<int>,"ticks":<int>,"status":"playing|over","paused":<bool>,"score":<int>,"lines":<int>,"level":<int>,"piece":{"kind":"<K>","rot":<0-3>,"x":<int>,"y":<int>}|null,"hold":"<K>"|null,"hold_used":<bool>,"next":["<K>","<K>","<K>"],"board":"<rows>"}
```

| Key | Meaning |
|---|---|
| `ticks` | As above. |
| `status` | `playing`, or `over` when a spawned piece overlaps locked cells. |
| `score` | Line clears `[0,100,300,500,800][n] × (level+1)`, soft drop +1/cell, hard drop +2/cell. |
| `lines` | Total rows cleared. |
| `level` | `min(9, floor(lines / 10))`. |
| `piece` | Active piece: kind letter, rotation `0..3`, bounding-box top-left `x`,`y`. Never drawn into `board`. |
| `hold` / `hold_used` | Held kind or `null`; whether hold has been consumed for the current piece. |
| `next` | Exactly 3 upcoming kinds. |
| `board` | 20 rows of 10 chars joined by `/`; `.` empty, kind letter for a locked cell. 219 characters total. |

### 3.3 Benchmark and capabilities lines

```
{"bench":"render","frames":600,"cols":80,"rows":24,"full_redraw_bytes":<int>,"damage_bytes":<int>,"ratio":<float>,"elapsed_ms":<int>}
{"color":"truecolor|256|16|mono","unicode":<bool>,"cols":<int>,"rows":<int>,"term":"<TERM or empty>"}
```

---

## 4. Independent oracles

The model ships its own recorded scripts and its own expected files, so `test.sh` passing proves
only self-consistency. These two oracles are derived from the rules in the prompt and are *not*
under the model's control. Use them as the primary correctness evidence for Snake.

### Oracle A — `TICK 24`, seed 1

Three steps to the right from the fixed start, no food eaten, no RNG consumed.

```sh
printf 'TICK 24\n' > /tmp/oracle-snake-basic.txt
./run.sh --headless --script /tmp/oracle-snake-basic.txt --seed 1
```

Expected, byte for byte:

```
{"game":"snake","seed":1,"ticks":24,"steps":3,"status":"alive","paused":false,"score":0,"length":3,"head":[8,6],"dir":"R","food":[14,6],"board":"..................../..................../..................../..................../..................../..................../......ooH.....*...../..................../..................../..................../..................../...................."}
```

### Oracle B — `TICK 72`, seed 1

Nine steps: the head reaches the fixed food at `(14,6)`, the snake grows to length 4, and exactly one
RNG draw places the next food. With 236 free cells and `next_u32()` returning `270369`,
`270369 % 236 = 149`, and free cell 149 in row-major order is `(13,7)`.

```sh
printf 'TICK 72\n' > /tmp/oracle-snake-eat.txt
./run.sh --headless --script /tmp/oracle-snake-eat.txt --seed 1
```

Expected, byte for byte:

```
{"game":"snake","seed":1,"ticks":72,"steps":9,"status":"alive","paused":false,"score":10,"length":4,"head":[14,6],"dir":"R","food":[13,7],"board":"..................../..................../..................../..................../..................../..................../...........oooH...../.............*....../..................../..................../..................../...................."}
```

### Oracle C — RNG conformance vector

With `seed = 1` the first five `next_u32()` values are `270369`, `67634689`, `2647435461`,
`307599695`, `2398689233`. The prompt requires these to be recorded in `NOTES.md` and checked by
`--selftest`. Compare the `NOTES.md` figures against this list; a mismatch means the summaries are
not cross-language comparable even if the model's own tests pass.

### Oracle D — Tetris structural properties

Exact Tetris expectations depend on the bag shuffle, so check properties instead. §4.K0 requires
the first piece and the `next` queue to exist before any update runs, and §6.1 makes `TICK 0` legal,
so a zero-update script is a valid probe of the spawn state:

```sh
printf 'TICK 0\n' > /tmp/oracle-tetris-spawn.txt
./run.sh --headless --script /tmp/oracle-tetris-spawn.txt --seed 7 --game tetris
```

- `ticks` is 0, `score` 0, `lines` 0, `level` 0, `status` `playing`, `hold` `null`,
  `hold_used` `false`.
- `board` is 20 rows of 10 dots.
- `piece.rot` is 0, `piece.y` is 0, and `piece.x` is 4 iff `piece.kind` is `O`, otherwise 3.
- `piece.kind` and the three entries of `next` are four **distinct** kinds — they are the first four
  of one 7-bag.

Then a hard drop onto an empty board:

```sh
printf 'KEY space\nTICK 1\n' > /tmp/oracle-tetris-drop.txt
./run.sh --headless --script /tmp/oracle-tetris-drop.txt --seed 7 --game tetris
```

- Exactly 4 non-`.` cells appear in `board`, all of the previous piece's kind letter.
- They sit at the bottom: for `I` all four are in row 19; for every other kind the lowest occupied
  row is 19.
- `score` equals `2 ×` the number of rows the piece fell, which is `19 − (lowest filled row index of
  the piece within its box at spawn)` — for `I`, 18; for `O`, `S`, `Z`, `J`, `L`, `T`, 18 as well
  (all spawn with their lowest filled cell in box row 1). So expect `score == 36` for every kind
  under this ruleset. A different value means gravity, spawn `y`, or hard-drop scoring is wrong.
- `hold_used` is `false` again (the lock cleared it) and `next` still has 3 entries.

---

## 5. Scored criteria and how to check them

Weights are from §9 of the prompt. "Mechanical" checks can be scripted; "inspection" checks need a
human read of the source.

| # | Criterion | W | How to check |
|---|---|---|---|
| 1 | Architectural separation | 20 | **Mechanical:** §2.1 (engine builds and tests with `games/`+`assets/` deleted) and §2.2 (`grep -rniE 'snake|tetris|tetromino' engine/` finds nothing). **Inspection:** `games/shared/` is permitted by §4.N4 for non-engine code both games need, and must be justified in `NOTES.md` — it is not a violation, but engine-general code hiding there is a design smell worth a note. Read the engine's public types for game concepts wearing generic names — a `Grid` with `wrap` and `food` fields, a `Piece` type, a scoring table, a "cell letter" enum. Read each game for reaches into engine internals (private modules, `pub(crate)` escapes, `# type: ignore`, C++ `friend`, direct field access documented as internal). Confirm `ENGINE-API.md` lists every entry point the games actually call. |
| 2 | Engine subsystems | 25 | **Mechanical:** engine test suite names should map onto §4.A–§4.I; `./run.sh --capabilities` under the env matrix in §2.6; debug overlay reachable via `F3` in the interactive smoke test. **Inspection:** roughly 2 points each for renderer diffing (§4.B), scene tree with z-order and clipping (§4.C), input decode/chord/repeat (§4.D), fixed-timestep loop with catch-up cap and interpolation (§4.E), event bus (§4.F), ECS with generational handles (§4.G), resource loader with both formats and the error class list (§4.H), tweens with the four easings (§4.I1–I2), audio seam (§4.I3), scene stack lifecycle (§4.I4), capability detection and quantisation (§4.I5–I7), debug overlay (§4.I8). Score a stub — a type that exists but is unused or does nothing — as zero for that subsystem. |
| 3 | Headless determinism | 15 | **Mechanical:** §2.3 (repeat run identical), §2.8 (exactly one stdout line), all seven recorded scripts matching their `expected/` files, oracles A and B byte-identical, cross-language diff when two or more languages exist, `--selftest` and `--engine-selftest` exit 0. **Inspection:** confirm `--selftest` really asserts the §6.3 list rather than printing "ok"; confirm no language RNG, no hash-map iteration and no wall-clock reads feed game logic. |
| 4 | Game correctness | 15 | **Mechanical:** oracles A, B and D. **Inspection:** Snake against §4.J (fixed first food, row-major spawn index, tail-vacates-before-collision, reversal ignored, one step per 8 ticks); Tetris against §4.K (spawn boxes and `x` values, CW rotation formula, the six-offset kick order, 7-bag Fisher-Yates, immediate lock with no lock delay, scoring table, hold-once-per-piece). ~7.5 points each. |
| 5 | Renderer efficiency | 10 | **Mechanical:** `./run.sh --bench-render`; require `ratio ≤ 0.25` (full marks at `≤ 0.10`), both counters `> 0`, `elapsed_ms ≤ 10000`. Then verify honesty: capture a real frame stream and count clears with `./run.sh --headless ... 2>/dev/null` plus whatever debug hook the model exposes, or read the present path. **Inspection:** confirm `full_redraw_bytes` comes from the same emitter with damage tracking off, not from a hand-computed estimate; confirm no `ESC[2J` after frame 0 and one write per frame. |
| 6 | Engine test suite | 8 | **Mechanical:** `./test.sh --engine-only` in the stripped tree; count assertions (≥ 30). **Inspection:** mutation-test two or three of them by hand — break the SGR delta logic or the clipping guard and confirm a test actually fails. Tests that assert nothing but "did not crash" score low. |
| 7 | Documentation | 7 | **Inspection:** `ENGINE-API.md` complete enough that you could write a third game from it alone (spot-check five API calls used in `games/` and confirm each is documented with a signature); `PORTING-NOTES.md` names specific APIs that changed and specific call sites — a generic essay about "the importance of abstraction" scores zero; `README.md` bindings match §4.J8/§4.K11; `NOTES.md` justifies every dependency and states where interpolation `alpha` is used. |

**Gate.** Criterion 1 is pass/fail first. If `engine/` names a game, or the engine will not build and
test with `games/` removed, criterion 1 scores 0 and the total is capped at 60 no matter how good the
rest is. Record the gate outcome explicitly in the run notes — for this task it is the headline
result, more informative than the total.

---

## 6. Known failure modes to watch for

Specific to this task, roughly in order of how often they are worth checking first.

1. **The engine is a namespace, not a boundary.** Game logic lives in `engine/` under generic names:
   an `engine/board.rs` that knows about food, an `engine/piece.go` with tetromino tables, an ECS
   component set that is exactly Snake's. §2.2's grep misses this because nothing is *called* snake.
   Read the engine's public types before anything else.
2. **The second game is a shell.** Snake is complete and Tetris is a stub that spawns pieces but
   never clears lines, or vice versa. Oracle D and `scripts/tetris-clear.txt` catch it. This is the
   most common way an XXL submission fails while still passing its own `test.sh`.
3. **Copied game code.** Files lifted from an earlier `snake/` or `tetris/` workspace in this repo,
   with the engine wrapped around them or bypassed entirely. Diff against
   `tui-games/solutions/*/snake/<lang>/` and `.../tetris/<lang>/` if those exist; look for a game
   that never mentions the engine's scene, widget or ECS types.
4. **Expected files regenerated from the implementation.** `expected/*.json` written by running the
   program, so `test.sh` is a tautology. Always run oracles A and B; they are the only Snake evidence
   that does not come from the model.
5. **Fake determinism.** The summary is stable per language but not across languages, usually from a
   language built-in RNG, hash-map iteration order, float accumulation in the tick counter, or
   `time()` leaking into gameplay. Oracle C and the cross-language diff catch it.
6. **Wall-clock in headless mode.** The replay driver sleeps for real, or uses the system clock for
   chord/repeat timing, making headless runs slow and occasionally flaky. Symptom: `test.sh` takes
   minutes, or a rerun differs. §4.E6 requires a virtual clock.
7. **A benchmark that measures nothing.** `full_redraw_bytes` computed as `cols × rows × k` instead
   of emitted by the same code path, or the "damage" run given a workload where nothing changes.
   Verify both totals come from the emitter and that frame 0 is a full paint in both.
8. **Renderer that only looks incremental.** Per-cell cursor positioning and a full SGR reset before
   every cell — the diff is real but the byte cost is not. Shows up as `ratio` between 0.25 and 0.6.
9. **Terminal left broken.** Panic path or `Ctrl+C` skips restore; the operator's shell is left in
   raw mode with a hidden cursor. Test all three exit paths by hand; a `SIGINT` handler that only
   sets a flag checked at the top of the loop will not fire if the loop is blocked on a read.
10. **Busy-wait frame limiter.** `while now() < deadline {}` burns a core. Check with
    `time ./run.sh --bench-render` — user time far above the frame budget — or read the limiter.
11. **Capability detection that never degrades.** `--capabilities` reports `mono` but the renderer
    still emits colour SGR. Capture output with `TUIE_COLOR=mono ... | cat -v` and grep for `[3` /
    `[38;` sequences; expect none.
12. **Tick accounting drift.** `ticks` counts paused updates, or keeps counting after `dead`/`over`.
    `scripts/snake-pause.txt` should prove it; if that script's expected file was generated rather
    than reasoned about, construct your own: `TICK 8`, `KEY p`, `TICK 40`, `KEY p`, `TICK 8` must
    report `ticks == 16` and `steps == 2`.
13. **Docs written before the port.** `PORTING-NOTES.md` claims the first API design was perfect.
    Either the port was trivial because the engine was designed around these two games (criterion 1
    problem) or the document is fiction (criterion 7 problem). Cross-check against the API: if
    `ENGINE-API.md` has a call that only Snake would ever need, the notes should say so.
14. **Script vocabulary borrowed from the earlier rungs.** The snake and tetris tasks lower on the
    ladder use game-specific tokens (`UP`, `PAUSE`) and count `TICK` as one game step. This task uses
    `KEY <name>` and counts `TICK` as one *fixed update* — a snake step is every 8th. A submission
    that accepts the old vocabulary, or that reports `steps` where `ticks` is asked for, fails
    oracles A and B by a factor of 8. Check the reported `ticks` against the oracle before concluding
    the game logic is wrong.
15. **`self_reported_status: complete` on a partial submission.** Record the divergence per
    `CONVENTIONS.md` §5; on a task this large it is one of the more interesting signals in the
    comparison.
