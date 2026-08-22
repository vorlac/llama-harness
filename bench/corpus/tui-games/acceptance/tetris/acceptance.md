# Acceptance: `tui-games/tetris`

Operator-facing companion to `tui-games/tui-tetris-impl-prompt.md`. That prompt
is what the model under evaluation sees; this file is what you use to score the
result. Requirement identifiers (`FR-1` .. `FR-35`, `TC-1` .. `TC-8`) refer to
sections 5 and 6 of the prompt. Workspace layout, `run.json`, and the three-script
contract are defined in `CONVENTIONS.md` sections 4, 5, and 6.

- Task id: `tetris`
- Category: `tui-games`, rung 2 of 8 (after `snake`, before `tetris-enhanced`)
- Size: M, difficulty 4
- Languages: `rust`, `go`, `cpp`, `python`, `ts`
- Starting material: none. This is greenfield.

---

## 1. Seeding a workspace

There is nothing to copy in; the task ships no starting code. Create the leaf
workspace and let the agent fill it:

```sh
tools/new_workspace.sh <run-id> tetris <language>
# e.g.
tools/new_workspace.sh qwen3.6-27B__vanilla tetris rust
```

That produces:

```
tui-games/solutions/<run-id>/tetris/<language>/
  run.json          # seeded, agent completes it
```

Hand the agent `tui-games/tui-tetris-impl-prompt.md` with `{{LANGUAGE}}` and
`{{RUN_ID}}` substituted. Nothing under `tui-games/tasks/` is copied into the
workspace and nothing under it may be modified by the run — verify with
`git status tui-games/tasks/` after the run and treat any modification as a
protocol violation that invalidates the run.

Run the same task at the same seeds across every language you are evaluating.
The cross-language summary comparison in section 4 is the strongest single
signal this task produces and it only exists if at least two languages ran.

---

## 2. Running the verification

From the leaf workspace directory:

```sh
cd tui-games/solutions/<run-id>/tetris/<language>/

./build.sh                                   # must exit 0, offline
./run.sh --selftest                          # must exit 0, prints "selftest: N/N"
./test.sh                                    # must exit 0

./run.sh --headless --script scripts/conformance-a.txt --seed 12345
./run.sh --headless --script scripts/conformance-b.txt --seed 777
```

Standard checks to run by hand, beyond `test.sh`:

```sh
# Build must not touch the network.
( unshare -rn ./build.sh )            # Linux
# macOS: run under a network-denying sandbox profile, or disable the interface.

# Determinism across processes.
A=$(./run.sh --headless --script scripts/conformance-a.txt --seed 12345)
B=$(./run.sh --headless --script scripts/conformance-a.txt --seed 12345)
[ "$A" = "$B" ] && echo DETERMINISTIC || echo NONDETERMINISTIC

# Recorded expectation matches live output, byte for byte.
./run.sh --headless --script scripts/conformance-a.txt --seed 12345 \
  | diff - expected/conformance-a.seed12345.json && echo MATCH

# Seed is actually wired to the randomiser.
./run.sh --headless --script scripts/conformance-a.txt --seed 999 \
  | diff -q - expected/conformance-a.seed12345.json && echo "BUG: seed ignored"

# Headless must work with no TTY anywhere.
./run.sh --headless --script scripts/conformance-a.txt --seed 12345 \
  < /dev/null > /tmp/out.json 2> /tmp/err.txt

# Unattended `run.sh`, exactly as tools/score.py invokes it: no arguments, stdio
# on pipes. FR-30 requires the conformance-a fallback here, not a refusal.
./run.sh < /dev/null | diff - expected/conformance-a.seed12345.json && echo "FALLBACK OK"

# An *explicit* interactive request with no TTY must still refuse (FR-35).
./run.sh --seed 1 < /dev/null > /dev/null ; echo "want non-zero, got $?"

# Exit statuses.
./run.sh --headless --script scripts/conformance-a.txt ; echo "want 2, got $?"
printf 'BOGUS\n' > /tmp/bad.txt
./run.sh --headless --script /tmp/bad.txt --seed 1 ; echo "want 3, got $?"

# Board shape.
python3 -c "
import json,sys,hashlib
s=json.load(open('/tmp/out.json'))
b=s['board']
assert len(b)==219, len(b)
assert b.count('/')==19
assert all(len(r)==10 for r in b.split('/'))
assert set(b) <= set('./IJLOSTZ')
assert s['board_hash']==hashlib.sha256(b.encode()).hexdigest()
assert list(s)==['schema','status','ticks','pieces','score','lines','level','combo','b2b','hold','hold_used','next','active','board','board_hash']
print('board ok')
"
```

Interactive checks require a real terminal and are done by hand; see section 5.

---

## 3. Headless JSON schema for this game

Exactly one line on stdout, compact JSON (no space after `:` or `,`), keys in
this order, terminated by a single `\n`. Nothing else may appear on stdout in
headless mode.

| # | Key | Type | Value |
|---|---|---|---|
| 1 | `schema` | integer | Always `1`. |
| 2 | `status` | string | `"running"` if the script ended with the game live, `"topout"` if it ended. No other value. |
| 3 | `ticks` | integer | Ticks simulated. Frozen at the top-out tick if the game ended. |
| 4 | `pieces` | integer | Pieces **locked**, not spawned. |
| 5 | `score` | integer | Final score, exact integer arithmetic. |
| 6 | `lines` | integer | Total rows cleared. |
| 7 | `level` | integer | `min(15, 1 + lines/10)`, 1..15. |
| 8 | `combo` | integer | Combo counter, `-1` when no combo is active. |
| 9 | `b2b` | boolean | Back-to-back flag. |
| 10 | `hold` | string or null | Held type letter, `null` if the slot is empty. |
| 11 | `hold_used` | boolean | Hold locked for the current drop. `false` when `status` is `"topout"`. |
| 12 | `next` | array | Exactly 5 type-letter strings, front first. `[]` when `status` is `"topout"`. |
| 13 | `active` | object or null | `{"type":"L","rot":0,"row":0,"col":3}`, keys in that order. `null` when `status` is `"topout"`. |
| 14 | `board` | string | Locked cells only. 20 visible rows, top first, each 10 characters of `.` or a type letter, joined by `/`. Always 219 characters. Excludes the active and ghost pieces. |
| 15 | `board_hash` | string | Lowercase hex SHA-256 of the UTF-8 bytes of `board`. |

Reference value for an empty board:

```
board      = "........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../........../.........."
board_hash = "5e8679b0947339eb3f54bca347264e60f4c007b3924846e47e011366782d6d1d"
```

Exit statuses: `0` replay completed (including a top-out), `1` internal failure,
`2` usage error, `3` malformed script.

Self-test mode prints `PASS <name>` / `FAIL <name>: <detail>` lines to stderr,
one line `selftest: <passed>/<total>` to stdout, and exits 0 only if all checks
passed. The ten named checks it must contain are listed in prompt section 7.6.

---

## 4. Cross-language conformance

Both conformance scripts are fixed byte-for-byte by the prompt (section 7.5), and
the seeds are fixed. Two correct implementations in different languages must
therefore emit **identical** summary lines. Check it:

```sh
cd tui-games/solutions/<run-id>/tetris
for lang in */; do
  printf '%-8s %s\n' "${lang%/}" \
    "$(cat "$lang/expected/conformance-a.seed12345.json")"
done | sort -k2 | uniq -f1 -c
```

Any group with count 1 is an outlier. Investigate before scoring: the divergence
is usually in one of four places, in decreasing order of frequency — tick-phase
ordering (prompt 7.3), the lock-delay reset budget (FR-15), the SplitMix64
implementation (FR-9, usually a signed shift or a non-wrapping multiply), or the
hard-drop-locks-in-phase-2 rule (7.3 step 2).

If only one language was run, this criterion is scored on repeat-run determinism
and script/expected-file fidelity alone, and you should record in the results
notes that the cross-language check was unavailable.

The scripts themselves must also be verified as unmodified — they are mandated
content, not something the agent may adjust to make its output pretty:

```sh
cd tui-games/solutions/<run-id>/tetris
shasum -a 256 */scripts/conformance-a.txt | awk '{print $1}' | sort -u | wc -l  # must be 1
shasum -a 256 */scripts/conformance-b.txt | awk '{print $1}' | sort -u | wc -l  # must be 1
```

With a single language, compare against the block in prompt section 7.5 by eye,
or extract it once into a reference copy of your own and diff against that.

All `conformance-a.txt` hashes must match each other; likewise `conformance-b.txt`.
A modified script is a rules violation: score the headless-determinism block at 0
for that language.

---

## 5. Scored criteria

Weights sum to 100 and mirror prompt section 11. "Mechanical" means a script or
one-line command decides it; "inspection" means you read the code or watch the
screen.

### 5.1 Rules conformance — 30 points

Award proportionally: `30 * (requirements met / 29)` over `FR-1` .. `FR-29`,
rounded to the nearest point.

| Requirement | How to check | Method |
|---|---|---|
| FR-1 piece geometry | Grep the source for the cell tables and compare against the prompt tables cell for cell. `selftest` `geometry-cell-count` and `geometry-rotation-cycle` catch gross errors only. | Inspection + mechanical |
| FR-2 spawn state and position | Neither conformance script yields a tick-0 summary, so make one: a comment-only script advances nothing. `printf '# spawn probe\n' > /tmp/spawn.txt`, then for each of seeds 1 2 3 5 8 run `./run.sh --headless --script /tmp/spawn.txt --seed $s` and require `"ticks":0` with `active` exactly `{"type":<t>,"rot":0,"row":0,"col":3}`. Those seeds do not cover all seven types; the FR-2 unit test in `test.sh` must assert state 0 at `(0,3)` for every type, including the piece arriving from a hold swap. | Mechanical + inspection of test |
| FR-3 rotation rejection is total | Unit test in `test.sh` must assert a fully blocked rotation leaves position, state, and lock timer unchanged. | Inspection of test |
| FR-4 JLSTZ kick table | Compare the literal table in source against the prompt. Watch the sign of `drow`: the prompt uses row-index-down convention, the common wiki table uses y-up. An implementation that copied the wiki table without flipping will have `0->1` test 3 as `(-1,+1)` instead of `(-1,-1)`. | Inspection |
| FR-5 I kick table | Same, against the I table. | Inspection |
| FR-6 O rotation | Unit test: rotating O never moves its cells but does count as a lock-delay reset. | Inspection of test |
| FR-7 no 180 rotation | Grep for a 180 or `rot += 2` path. Presence is a defect here (it belongs to `tetris-enhanced`). | Inspection |
| FR-8 7-bag | `selftest` `bag-uniform`. | Mechanical |
| FR-9 SplitMix64 | Compare constants `0x9E3779B97F4A7C15`, `0xBF58476D1CE4E5B9`, `0x94D049BB133111EB` and confirm shifts are unsigned. Cross-language summary match (section 4) is the real proof. | Inspection + mechanical |
| FR-10 six `next()` per bag | Grep every call site of the RNG; there must be exactly one, inside the shuffle. | Inspection |
| FR-11 preview length 5 | `next` array length is 5 in every `running` summary. | Mechanical |
| FR-12 gravity table | Compare the integer table against the prompt. A float `pow()` implementation is a defect even if it rounds to the same values. | Inspection |
| FR-13 gravity counter | Unit test: a piece with no input falls exactly one row per `ticks_per_row` ticks at each of levels 1, 5, 13. | Inspection of test |
| FR-14 lock delay 30 ticks | Unit test: an untouched resting piece locks on the 30th resting tick, not the 29th or 31st. | Inspection of test |
| FR-15 15-reset budget | `selftest` `lock-delay-budget`, plus inspection that the budget resets on reaching a new lowest row. | Mechanical + inspection |
| FR-16 soft drop scoring | Unit test: N successful soft drops add exactly N points; a blocked soft drop adds 0. | Inspection of test |
| FR-17 hard drop scoring and immediate lock | Unit test: 2 points per row, lock in the same tick, lock delay skipped. | Inspection of test |
| FR-18 hold swap | Unit test covering both the empty-slot and occupied-slot branches, incoming piece at `(0,3)` state 0. | Inspection of test |
| FR-19 one hold per drop | `conformance-b.txt` issues two `HOLD` five ticks apart at the start; the second must be a no-op. Compare `hold` and `next` in the summary against a peer language. | Mechanical (cross-language) + inspection of test |
| FR-20 hold-swap block out | Unit test. | Inspection of test |
| FR-21 line clear and naive gravity | `selftest` `clear-cell-count`, plus a unit test that a hole under a cleared row is preserved (naive gravity, not sticky). | Mechanical + inspection |
| FR-22 base score values | Unit test asserting 100/300/500/800 times level. | Inspection of test |
| FR-23 back-to-back | Unit test: tetris, tetris => 800L then 1200L; tetris, single, tetris => 800L, 100L, 800L; tetris, no-clear lock, tetris => 800L then 1200L. | Inspection of test |
| FR-24 combo | Unit test: three consecutive clearing locks award 0, 50L, 100L of combo bonus; a non-clearing lock resets to -1. | Inspection of test |
| FR-25 level progression and cap | Unit test across the 10-line boundary and at the 15 cap. | Inspection of test |
| FR-26 integer arithmetic | Grep for float in the scoring path. Any float there is a defect. | Inspection |
| FR-27 colour/type preserved through clears | Unit test: after a clear, surviving blocks in shifted rows keep their original type letters, visible in `board`. | Inspection of test |
| FR-28 ghost | `selftest` `ghost-equals-harddrop`, plus visual check that ghost is distinct and absent from `board`. | Mechanical + inspection |
| FR-29 both top-out conditions | Unit tests for block out and lock out; plus confirm `ticks` freezes (run a script that tops out early and append `TICK 1000`; `ticks` must not include them). | Inspection of test + mechanical |

### 5.2 Headless determinism — 20 points

| Check | Method | Points |
|---|---|---|
| Summary line present, single line, nothing else on stdout | `wc -l` is 1; stdout has no other content | 3 |
| Key set and order exactly the 15 of section 3 | the `list(s) == [...]` assertion above | 3 |
| Compact form, valid 219-character board, correct SHA-256 | the board-shape script above | 3 |
| Byte-identical across two runs of the same seed and script | the `A = B` check | 3 |
| Recorded `expected/*.json` files match live output | `diff` | 3 |
| Different seed gives a different summary | `diff -q` returns non-zero | 2 |
| Cross-language byte-identity at both mandated seeds | section 4 | 3 |
| `--selftest` exits 0 with all ten named checks present | read the stderr `PASS` lines | (gate) |

`--selftest` is a gate rather than a scored line: if it does not exist or does
not exit 0, cap this whole block at 5.

### 5.3 TUI quality and terminal safety — 15 points

| Check | Method | Points |
|---|---|---|
| Terminal restored after `q` quit | run interactively, quit, then `stty -a` shows the original mode and the cursor is visible | 3 |
| Terminal restored after `SIGINT` | run interactively, `Ctrl-C`, check `stty -a` and cursor | 3 |
| Terminal restored after a panic | force one (e.g. resize to 1x1 mid-game, or run with a deliberately corrupt state if the code exposes a hook) and check `stty -a` | 3 |
| 10x20 field, drawn border, two cells wide per block | look at it | 2 |
| Ghost piece present and visually distinct | look at it | 1 |
| Side panel with hold, five next, score, level, lines | look at it | 1 |
| Controls: every FR-31 binding acts, held left/right and soft drop repeat per the FR-32 DAS timings, and the FR-34 game-over screen shows the final score and waits for a key | play a game to a top-out | 1 |
| Interactive mode refuses below 80x24 and on an explicit no-TTY request, without entering raw mode (FR-35); bare `./run.sh` on a pipe falls back to the headless replay and exits 0 (FR-30) | resize the terminal under 80x24 and run `./run.sh` — expect one stderr line, a non-zero status, and an untouched terminal; then run the two unattended commands in section 2 | 1 |

If any of the three restoration checks fails, the whole block caps at 6 —
a game that wrecks the operator's terminal is not shippable regardless of looks.

### 5.4 Build and script contract — 10 points

| Check | Method | Points |
|---|---|---|
| `build.sh`, `run.sh`, `test.sh` exist, executable, correct shebang and `set -euo pipefail` | `head -2` each, `test -x` each | 2 |
| `./build.sh` exits 0 offline from a clean tree | network-disabled run | 3 |
| Scripts work with the language dir as CWD and use no absolute paths | `grep -n '^/\|=/' *.sh` | 1 |
| Exit statuses 0 / 2 / 3 as specified | the exit-status commands in section 2 | 2 |
| `run.json` present with all required fields from `CONVENTIONS.md` section 5 | JSON key check | 2 |

### 5.5 Code structure — 10 points

| Check | Method | Points |
|---|---|---|
| Engine is a separate module from render and input | file layout | 3 |
| Engine has no import of / reference to render or input | grep the engine module's imports | 3 |
| Headless and interactive drive the same engine, not two copies | grep for duplicated rule constants (e.g. two gravity tables, two kick tables) | 3 |
| Idiomatic and readable for the language | inspection | 1 |

### 5.6 Test suite — 8 points

One point for each of the eight items in prompt section 9, awarded only if the
check is real. Verify the tests actually bite by mutating the solution and
re-running `./test.sh`; each mutation below must turn the suite red:

| Mutation | Suite must fail |
|---|---|
| Change tetris base score 800 -> 700 | yes |
| Delete kick test 5 from the JLSTZ table | yes |
| Change lock delay 30 -> 20 | yes |
| Change the SplitMix64 increment constant's last hex digit | yes |
| Remove the one-use-per-drop hold lock | yes |
| Swap phases 3 and 4 of the tick pipeline | yes |

An agent that recorded `expected/*.json` from a buggy engine will pass its own
conformance check, which is why the mutation sweep and the cross-language
comparison both matter.

### 5.7 Documentation — 7 points

| Check | Method | Points |
|---|---|---|
| `README.md` lets someone build, play, and run headless without the prompt | read it | 2 |
| `NOTES.md` substantive; gaps and unimplemented requirements stated honestly | compare its claims against what you measured | 3 |
| `CONFORMANCE.md` has a row for every `FR-1`..`FR-35` and `TC-1`..`TC-8`, pointing at real symbols | spot-check five rows against the source | 2 |

Score `NOTES.md` honesty explicitly: a run that says "back-to-back is not
implemented" and is right scores the full 3; a run that claims full conformance
while failing the conformance check scores 0 for that line. Divergence between
`self_reported_status` in `run.json` and the measured outcome is recorded
separately per `CONVENTIONS.md` section 5 and is itself a reportable metric.

---

## 6. Known failure modes in this specific game

Watch for these; they are the ones that recur and several of them produce a
program that looks entirely correct while playing.

1. **Wiki kick tables copied without flipping the vertical sign.** The published
   SRS tables use y-up; the prompt specifies row-index-down. A straight copy
   makes every vertical kick go the wrong way. It is almost invisible in casual
   play (most rotations succeed on test 1) but changes conformance summaries and
   breaks the T-spin-triple-shaped kick.
2. **Rotation implemented by transposing a matrix instead of using the tables.**
   Generic transposition puts `S`, `Z`, and `I` in the wrong place in at least
   one state. Check `S` state 3 and `I` state 3 specifically.
3. **`I` and `O` rotated in a 3x3 box.** Both need the 4x4 box for the kick
   offsets to mean what the table says.
4. **SplitMix64 with a signed right shift** (Java/JS/Go `int64` traps) or a
   multiply that does not wrap. Produces a valid-looking but different bag order.
   Diagnostic: seed 0 first bag should be identical across languages; if one
   language differs on the very first bag, it is the PRNG.
5. **`Math.random()` / `rand()` used anywhere** — commonly for a tie-break or a
   "randomised" starting level. Destroys determinism. Grep for it.
6. **Bag drawn lazily with a different call order** — for instance shuffling with
   an ascending Fisher-Yates, or calling `next()` seven times per bag. Both give
   a legal 7-bag with a different sequence.
7. **Tick-phase ordering.** The most common divergence between two otherwise
   correct implementations: applying gravity before input, or checking lock delay
   before gravity, or letting a hard drop fall through to phases 3-4 and lock
   twice. Symptom is summaries that agree on `board` but differ on `ticks` or
   `score`.
8. **Lock delay implemented as "reset on any input"** instead of "reset on a
   *successful* move or rotation, capped at 15". Gives infinite stalling; the
   `lock-delay-budget` selftest is meant to catch it, so check that the selftest
   itself is real.
9. **Lock timer not cleared when the piece stops resting.** A piece that slides
   off a ledge keeps a stale timer and locks in mid-air a few ticks later.
10. **Line clear implemented with sticky gravity** (connected-group falling)
    instead of naive row shifting. Looks nicer, is wrong here, and changes every
    board after the first clear with an overhang.
11. **Scoring at the post-clear level.** A clear that crosses a 10-line boundary
    must score at the old level. Off-by-one shows up only at lines 10, 20, 30.
12. **Back-to-back applied to triples**, or broken by a non-clearing lock. Both
    are wrong per FR-23.
13. **Combo starting at 0 instead of -1**, awarding a bonus on the first clear.
14. **Hold lock released on spawn rather than on lock**, letting a player hold
    twice per piece after a hard drop.
15. **Top-out detected only by "a locked cell in row 2"**, missing lock out
    entirely, or missing block out on a hold swap (FR-20).
16. **Simulation keeps ticking after top-out**, inflating `ticks` by however many
    ticks the script had left. Detect by appending `TICK 1000` to a topping-out
    script: `ticks` must not change.
17. **The active or ghost piece leaking into the `board` string.** Board is
    locked cells only. Symptom: `board` differs between languages while `score`
    and `lines` agree.
18. **Trailing newline or pretty-printed JSON.** The summary must be one compact
    line plus exactly one `\n`. A `json.dumps` with default separators inserts
    `", "` and fails byte-identity even though the object is equal.
19. **Key order from a hash map.** Python dicts and JS objects preserve insertion
    order; Go maps and Rust `HashMap` do not. Serialise from an ordered struct.
20. **Headless mode that opens a terminal**, calls `tcgetattr`, or sleeps between
    ticks. Fails under redirection and blows the test timeout.
21. **Terminal left in raw mode after a panic.** Most common in languages where
    the restore is a `defer`/`Drop` that a hard abort skips, or where the signal
    handler is installed after raw mode is entered.
22. **Busy-wait main loop** (TC-3). Symptom: 100% CPU during interactive play.
    Check with `top` while the game is idle at level 1.
23. **T-spin logic present.** Not part of this rung; it changes scores and makes
    summaries incomparable with peers that followed the prompt.
24. **Modified conformance scripts.** If the agent edited `scripts/*.txt` the
    whole cross-language comparison is void. Hash them (section 4) before trusting
    any summary.
