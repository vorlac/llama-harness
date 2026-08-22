# Acceptance: `minesweeper` (tui-games, size M)

Operator-facing companion to `tui-games/tui-minesweeper-impl-prompt.md`. The prompt is what the
model under evaluation reads; this file is what you read while scoring a run. Section numbers in
square brackets, like `[4.7 r26]`, point at the numbered requirement in that prompt. Repository-wide
rules (run IDs, workspace depth, the three-script contract, read-only task material) live in
`CONVENTIONS.md` and are not repeated here.

- Task material: `tui-games/tasks/minesweeper/` — read-only, `CONVENTIONS.md` §10.
- Starting material: **none**. This is a greenfield task; the model writes every file.
- Verify command: `test.sh`, per `task.json`.

---

## 1. Seeding a workspace

```sh
tools/new_workspace.sh <run-id> minesweeper <language>
# ->  tui-games/solutions/<run-id>/minesweeper/<language>/
```

Concretely, for a two-configuration comparison across the expected language set:

```sh
for lang in rust go cpp python ts; do
  tools/new_workspace.sh qwen3.6-27B__vanilla       minesweeper "$lang"
  tools/new_workspace.sh qwen3.6-27B__llama-harness minesweeper "$lang"
done
```

Each leaf gets a seeded `run.json`; the agent fills in the rest. Nothing is copied in — there is no
starting material — so a workspace that is not empty before the run is a contaminated workspace.

## 2. Running the verification

```sh
cd tui-games/solutions/<run-id>/minesweeper/<language>
./build.sh          # <= 300 s
./run.sh --selftest # <= 120 s, exit 0
./test.sh           # <= 420 s, exit 0
```

or, for a whole run at once, `tools/score.py <run-id>` followed by
`tools/compare.py <run-id-a> <run-id-b>` (`CONVENTIONS.md` §9). Correctness for this category comes
from `test.sh`'s exit code, not from parsed stdout (`CONVENTIONS.md` §7).

The run must ship three named script/expected pairs — `scripts/loss.txt`, `scripts/win-autoplay.txt`
and `scripts/no-guess.txt` with the matching `expected/*.json` — plus `scripts/MANIFEST.tsv` giving
the flags for each. Every example below uses those names.

Run everything with stdin, stdout and stderr redirected — `./test.sh < /dev/null > out 2> err` — to
catch implementations that quietly require a TTY [5 r45].

## 3. The headless contract

Interactive TUI programs cannot be scored by a script unless they can be driven without a terminal.
Every `tui-games` task therefore exposes the same two modes:

```
./run.sh --headless --script <path> --seed <n>    replay a newline-delimited input script and, on
                                                  exit, print a deterministic one-line JSON summary
                                                  of final game state to stdout
./run.sh --selftest                               run built-in invariant checks, exit non-zero on failure
```

Given the same seed and the same input script, the JSON summary must be byte-identical across runs.

### 3.1 Input script commands

One command per line; `#` comments and blank lines are ignored and do not tick.

```
up | down | left | right        cursor by one, clamped
move <col> <row>                absolute cursor, clamped into the grid
reveal                          reveal at cursor
flag                            cycle HIDDEN -> FLAGGED -> QUESTION -> HIDDEN
chord                           reveal neighbours when flag count == number
hint                            read-only solver query; bumps hints_used, sets last_hint
auto                            one solver step: deduce to fixpoint, apply all deductions
autoplay                        repeat auto until won, lost, or stalled
wait <n>                        advance the virtual clock by n whole seconds
restart                         same settings, fresh board, generator state carries forward
quit                            stop replaying; remaining lines ignored
```

Malformed command or argument: stderr `line <n>: <message>`, exit `3`, no JSON [6.2 r51].

### 3.2 Exact JSON summary schema

One compact line on stdout, terminated by `\n`, keys in exactly this order, no whitespace outside
string values [6.3 r52-r55]:

```json
{"schema":"minesweeper.v1","seed":7,"width":9,"height":9,"mines":10,"difficulty":"beginner","no_guess":false,"gen_attempts":1,"layout_digest":"75c3b759537f23c7","status":"lost","board":["..*...*..",".......*.","*...*....","111.....*","001F.!...","112111*.?",".F10012..","1110001X.","0000001.."],"revealed":31,"flags":3,"questions":1,"mines_remaining":7,"first_click":[3,8],"ticks":17,"elapsed_seconds":3,"hints_used":1,"last_hint":"safe:1,4","chords":1,"solver_stalled":false}
```

*(A shape illustration. The layout was placed by hand rather than by the §4.3/§4.4 generator, so it
is **not** a reference answer for seed 7 — but everything inside it is genuinely consistent and every
assertion in §3.3 passes against it: every row string is exactly `width` characters and there are
exactly `height` of them; the ten mines all appear on the lost board as one `X`, seven `*` and two
correct `F`; every displayed digit equals the neighbour count of the displayed layout;
`layout_digest` is the real FNV-1a 64 of that mine bitmap; `flags:3` counts the two `F` plus the one
`!`; `revealed:31` is the digit count; and `last_hint` is what the §4.7 solver actually deduces at
that point in the game.)*

| Key | Type | Constraint to check |
|---|---|---|
| `schema` | string | exactly `"minesweeper.v1"` |
| `seed` | int | equals the `--seed` argument |
| `width` | int | 5..60 |
| `height` | int | 5..40 |
| `mines` | int | 1..`width*height-9` |
| `difficulty` | string | one of `beginner`, `intermediate`, `expert`, `custom` |
| `no_guess` | bool | mirrors the `--no-guess` flag |
| `gen_attempts` | int | `0` before generation, `1` without `--no-guess`, `1..1000` with it |
| `layout_digest` | string | `^[0-9a-f]{16}$`, FNV-1a 64 over the mine bitmap [6.3 r54] |
| `status` | string | `playing` \| `won` \| `lost` |
| `board` | string[] | `height` entries, each exactly `width` chars from `.F?012345678*X!` |
| `revealed` | int | count of non-mine cells in state REVEALED |
| `flags` | int | count of `F` **plus** `!` — a wrong flag exposed by a loss is still `FLAGGED` [6.3 r52] |
| `questions` | int | count of `?` on the board |
| `mines_remaining` | int | `mines - flags`, may be negative |
| `first_click` | [int,int] \| null | `null` iff `gen_attempts == 0` |
| `ticks` | int | executed commands, not reset by `restart` |
| `elapsed_seconds` | int | sum of `wait` arguments since the last `restart` |
| `hints_used` | int | count of `hint` commands |
| `last_hint` | string \| null | `safe:c,r` \| `mine:c,r` \| `none` \| `null` |
| `chords` | int | chords that revealed at least one cell |
| `solver_stalled` | bool | any stalled `auto` step since the last `restart` |

Board alphabet: `.` hidden, `F` flagged, `?` question, `0`-`8` revealed count, `*` revealed mine,
`X` the detonated mine, `!` a flag on a non-mine exposed by the loss. `F` and `!` are the same
marker state and both count toward `flags`; a correctly flagged mine stays `F` after a loss, so a
lost board's `X` + `*` + `F` add up to exactly `mines` [4.5 r20].

### 3.3 Mechanical schema check

Drop this next to the workspace and pipe a summary through it. It is the same check the scorer
applies; it belongs in your hands too, because a summary that fails it invalidates criteria 1-5.

```sh
cat > /tmp/check_summary.py <<'PY'
import json, re, sys
KEYS = ["schema","seed","width","height","mines","difficulty","no_guess","gen_attempts",
        "layout_digest","status","board","revealed","flags","questions","mines_remaining",
        "first_click","ticks","elapsed_seconds","hints_used","last_hint","chords","solver_stalled"]
raw = sys.stdin.read()
assert raw.endswith("\n") and raw.count("\n") == 1, "stdout must be exactly one line"
d = json.loads(raw)
assert list(d.keys()) == KEYS, f"key order/set wrong: {list(d.keys())}"
assert json.dumps(d, separators=(",", ":")) == raw.strip(), "not canonical compact JSON"
assert d["schema"] == "minesweeper.v1"
assert re.fullmatch(r"[0-9a-f]{16}", d["layout_digest"])
assert d["status"] in ("playing", "won", "lost")
b = d["board"]
assert len(b) == d["height"] and all(len(r) == d["width"] for r in b), "board dimensions"
assert set("".join(b)) <= set(".F?012345678*X!"), "bad board character"
flat = "".join(b)
assert flat.count("F") + flat.count("!") == d["flags"], "F and ! are both FLAGGED"
assert flat.count("?") == d["questions"]
assert d["mines_remaining"] == d["mines"] - d["flags"]
assert flat.count("X") == (1 if d["status"] == "lost" else 0), "X only on a loss, exactly one"
if d["status"] == "lost":
    assert flat.count("X") + flat.count("*") + flat.count("F") == d["mines"], "loss hides a mine"
if d["status"] == "won":
    assert set(flat) <= set("012345678F") and flat.count("F") == d["mines"], "won board"
    assert d["mines_remaining"] == 0
if d["status"] != "lost":
    assert "!" not in flat and "*" not in flat, "loss-only markers leaked"
assert (d["first_click"] is None) == (d["gen_attempts"] == 0), "first_click/gen_attempts disagree"
assert d["revealed"] == sum(flat.count(c) for c in "012345678")
print("summary OK")
PY
./run.sh --headless --script scripts/loss.txt --seed 7 | python3 /tmp/check_summary.py
```

### 3.4 Determinism and cross-language agreement

```sh
# same run twice -> identical bytes
./run.sh --headless --script scripts/loss.txt --seed 7 > a.json
./run.sh --headless --script scripts/loss.txt --seed 7 > b.json
cmp a.json b.json

# same seed in two languages -> identical layout_digest and, for the same script, identical summary
for l in rust go python; do
  (cd ../$l && ./run.sh --headless --script ../rust/scripts/loss.txt --seed 7)
done | sort -u | wc -l     # expect 1
```

Cross-language agreement is the strongest signal available for this task: the PRNG, the forbidden
set and the placement shuffle are specified exactly [4.3, 4.4], so two conforming implementations
*must* produce the same `layout_digest` for the same seed and first click. A run whose digest
disagrees with the other languages of the same task has deviated from the generator spec even if its
own tests pass. Note that this comparison is only valid when the scripts *and the flags* are
identical (take both from `scripts/MANIFEST.tsv`) and both implementations reach the same
first-click cell.

---

## 4. Scored criteria

Weights come from the prompt's §9 rubric and sum to 100.

| # | Criterion | Wt | How to check |
|---|---|---|---|
| 1 | Headless determinism and JSON contract | 18 | **Mechanical.** §3.3 checker on every recorded script; §3.4 double-run `cmp`; `./run.sh --headless` with no `--script` exits `2`; a script with a garbage line exits `3` and prints nothing on stdout; `--width 4 --difficulty custom` exits `2`; `--headless --script does-not-exist.txt` exits `2`; `--help` prints the usage block on stdout and exits `0` [6.1 r46]. Confirm stdout carries no ANSI bytes: `LC_ALL=C grep -c $'\033' out` returns 0. |
| 2 | Core gameplay rules | 22 | **Mostly mechanical.** Purpose-built scripts (§5) for: flood fill size, flag-blocks-reveal, marker cycle of four, chord match and mismatch, over-flagging driving `mines_remaining` negative, win auto-flagging, loss revealing `X`/`*`/`!`, cursor clamping at all four edges, `wait` driving `elapsed_seconds`, `restart` semantics [6.2 r50]. Presets by reading `width`/`height`/`mines` from the summary. **By inspection:** that a revealed `0` renders blank in the TUI [4.9 r35]. |
| 3 | Safe first click and generator conformance | 10 | **Mechanical.** `first_click_safe` and `mine_count` selftest checks; cross-language `layout_digest` agreement (§3.4); the first reveal always opens a region, because the forbidden set makes the first-click cell a zero [4.4 r10] — so `revealed` after one reveal is at least the size of the forbidden set: `>= 9` for an interior first click, `>= 6` on an edge, `>= 4` in a corner (use an interior cell when you want the strong form). **By inspection:** the source implements SplitMix64 with the stated constants and a partial Fisher-Yates, not a rejection loop [4.3 r7, 4.4 r11]. |
| 4 | Solver correctness | 20 | **Mechanical.** `solver_sound` selftest; scripted `hint` calls whose `last_hint` is compared against a hand-derived expected cell on a fixed seed; `auto` on a board with a rule-1 deduction available reveals every deducible cell in one step [4.7 r29]; a board with only a rule-2 deduction available (the 1-2-1 wall pattern) still progresses; `hint` leaves the board byte-identical. **By inspection:** `SOLVER.md` shows a worked rule-1 and rule-2 example and explains the global constraint [4.7 r24]. |
| 5 | No-guess generation | 10 | **Mechanical.** `no_guess_solvable` selftest; for 20 seeds, `--no-guess` + a script of `move`/`reveal`/`autoplay` must end `status:"won"` with `solver_stalled:false`; `gen_attempts` is `1` without the flag and `>= 1` with it; the same seed and first click reproduce the same `gen_attempts`. **By inspection:** the retry loop simulates on a scratch copy and caps at 1000 [4.8 r30-r33], and `SOLVER.md` reports real measured retry statistics. |
| 6 | TUI quality and terminal hygiene | 10 | **Semi-mechanical.** `stty -g` before and after a real interactive session, after `q`, after `SIGINT`, and after an induced panic — all three must restore the saved settings (§6). idle CPU under 0.5 s combined user+system over 10 s of wall time, measured with `ps -o time= -p <pid>` (or `/usr/bin/time`) before and after the wait [5 r41]. Time a full redraw of a 60x40 board under 16 ms if the implementation exposes a timing hook. Colour palette is now mechanical too: `grep -o $'\033\[9\?[0-9]*m'` a captured frame and confirm the eight number colours use the SGR codes fixed in [4.9 r36] (`94 32 91 34 31 36 37 90`), and that `NO_COLOR=1 ./run.sh` emits no SGR bytes at all. **By inspection:** status bar carries all four required values, key legend covers every binding of r34, no clear-and-repaint per keystroke. |
| 7 | Tests | 6 | **Mechanical.** `./test.sh` exits `0`; grep it for the four required behaviours [7 r60a-d]; confirm the three required pairs `scripts/{loss,win-autoplay,no-guess}.txt` and `expected/{loss,win-autoplay,no-guess}.json` exist under exactly those names [7 r61]; confirm `scripts/MANIFEST.tsv` has the `name`/`flags`/`expected` columns and that `test.sh` reads it rather than hardcoding invocations; confirm all thirteen named selftest checks appear in `--selftest` output. |
| 8 | Documentation | 4 | **By inspection.** `README.md` (build, run, keys, CLI, script format); `NOTES.md` carrying all three headings of [7 r63] — **Design decisions**, **Known gaps** (numbered requirements, or "None."), **With more time** — with a `Known gaps` section that matches what `test.sh` actually does; `SOLVER.md` (rules, ASCII worked examples, measured statistics — not placeholders). |

Partial credit per criterion. A criterion that cannot be exercised because the build fails or
headless mode does not run scores **zero** for that criterion; do not estimate it from the source.

### 4.1 Adversarial deliverable checks

Run these before trusting any of the above:

```sh
grep -rniE 'TODO|FIXME|placeholder|not implemented|unimplemented|\.\.\.$' --include='*' . | grep -v '^./expected/'
```

and confirm that `expected/*.json` was produced by the submitted program rather than hand-written to
match a broken implementation — regenerate one and `cmp` it:

```sh
./run.sh --headless --script scripts/loss.txt --seed 7 | cmp - expected/loss.json
```

A `test.sh` that regenerates `expected/` before comparing is self-certifying and scores zero on
criterion 7. Check for it explicitly.

---

## 5. Suggested probe scripts

These are evaluator-side probes, not deliverables; the run supplies its own `scripts/`. Write them
into the workspace under a scratch name that does not collide with `scripts/`.

```
# probe-cursor-clamp.txt  -- cursor must not wrap or escape the grid
move 0 0
up
up
left
left
reveal
```
Expect `first_click:[0,0]` and `revealed >= 4` — `(0,0)` is a corner, so its forbidden set is four
cells, not nine. Repeat the probe with `move 4 4` instead of `move 0 0` for the `revealed >= 9`
form; both must hold.

```
# probe-markers.txt  -- four cycles return to hidden; a flag blocks reveal
move 4 4
reveal
move 0 0
flag
reveal
```
Expect the summary board's `(0,0)` to be `F`, `flags:1`, `mines_remaining: mines-1`, and the flagged
cell never revealed.

```
# probe-overflag.txt  -- the counter is signed
# beginner has 10 mines; plant 12 flags along the top two rows
move 4 4
reveal
move 0 0
flag
right
flag
right
flag
right
flag
right
flag
right
flag
right
flag
move 0 1
flag
right
flag
right
flag
right
flag
right
flag
```
Some of those cells may already be revealed by the opening, in which case `flag` is a no-op there;
choose a first-click cell far from row 0 so at least 11 of the targets stay hidden. Expect
`flags` >= 11 and `mines_remaining` negative, and expect the TUI to display the negative value
rather than clamping it at zero [4.6 r21].

```
# probe-hint-purity.txt  -- hint must not mutate
move 4 4
reveal
hint
hint
hint
```
Compare the `board`, `revealed` and `flags` fields against the same script with the `hint` lines
removed: everything except `ticks`, `hints_used` and `last_hint` must be identical.

---

## 6. Terminal-restore probe

```sh
saved=$(stty -g)
./run.sh &            # real TTY required
pid=$!
sleep 1; kill -INT $pid; wait $pid || true
[ "$(stty -g)" = "$saved" ] && echo "restore OK" || echo "TERMINAL LEFT MODIFIED"
```

Repeat for `q` (send it on stdin) and for a panic path if the implementation offers one (many expose
a hidden `--crash-test` or you can force one with an out-of-range `move` in interactive mode). All
three paths must restore [5 r40].

---

## 7. Known failure modes for this game

Watch for these specifically. Each has been seen in practice and each is invisible unless probed.

1. **Board generated before the first click.** The classic shortcut: mines placed at startup, then
   "if the first click is a mine, move that one mine elsewhere." That passes a naive safety test but
   changes `layout_digest`, breaks cross-language agreement, and usually fails to guarantee a zero
   opening. Check that the summary reports `gen_attempts:0` and `first_click:null` for a script that
   only moves the cursor and quits.
2. **Forbidden set of one cell instead of nine.** The first click is safe but does not open a
   region. Detect it with `revealed` after a single reveal at an **interior** cell (all nine
   forbidden cells in the grid): it must be `>= 9`. A corner first click only guarantees `>= 4` and
   an edge one `>= 6`, so a one-cell forbidden set hides there — always probe from the middle.
3. **Recursive flood fill.** Works on beginner, dies or nearly dies on 60x40. Grep for a reveal
   function that calls itself; run the `flood_iterative` selftest under a reduced stack
   (`ulimit -s 512`) and confirm it still passes.
4. **Flood fill revealing flagged cells.** A frequent off-by-one in the worklist guard; it silently
   destroys the flag count and makes chording unsound.
5. **Question marks treated as flags.** They must not count toward chording or `mines_remaining`
   [4.5 r18, 4.6 r21]. Implementations that skip the `QUESTION` state entirely also fail the
   `marker_cycle` selftest.
6. **Chording without the equality guard**, revealing neighbours whenever any flag is adjacent.
   Probe with one flag next to a `2`.
7. **Wall-clock time in the headless summary.** Any `elapsed_seconds` that varies between two
   identical runs fails criterion 1 outright. The virtual clock [4.6 r23] exists for this reason.
8. **Non-canonical JSON.** Pretty-printing, alphabetically sorted keys (the default in several
   languages' encoders), a trailing newline count other than one, `1.0` where an integer is
   required, or an escaped `/`. All are caught by §3.3.
9. **A solver that is stronger or weaker than specified.** Full enumeration over the frontier solves
   boards the specified rules cannot, which changes which layouts pass the no-guess filter and makes
   `gen_attempts` disagree across languages. Missing the global constraint makes endgames stall.
   Compare `gen_attempts` and `last_hint` across languages for the same seed.
10. **A `hint` that mutates.** Applying the deduction as a side effect of asking for it. Probe with
    `probe-hint-purity.txt`.
11. **`auto` applying one deduction instead of all of them.** Requirement 29 is apply-all; a
    one-at-a-time `auto` produces the same eventual `autoplay` result but different intermediate
    summaries and different `ticks`-to-win.
12. **No-guess implemented as "retry until autoplay wins" without a scratch copy**, leaking revealed
    cells or generator draws into the real game [4.8 r33]. Symptom: `revealed` is non-zero before
    the player has revealed anything, or `gen_attempts` differs between two identical runs.
13. **No-guess retry loop with no cap**, hanging on a dense custom board (try `--difficulty custom
    --width 8 --height 8 --mines 50 --no-guess`, which is effectively unsolvable without guessing).
    It must terminate at 1000 attempts and still print a summary.
14. **`restart` reseeding the generator**, producing the same board twice. Probe with a script that
    reveals, restarts, reveals at the same cell, and check the two `layout_digest` values differ.
15. **Terminal left in raw mode after `SIGINT`** — the single most common defect in this category.
    §6 catches it; nothing else does.
