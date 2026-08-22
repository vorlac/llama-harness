# TUI Games — Task 3: `tetris-enhanced` (size M+)

## 0. Preconditions — read this first

This task is **not greenfield**. Your workspace has already been seeded with a
**complete, working Tetris implementation** produced by an earlier run of the
`tetris` task in this same category. That code is your starting point and your
constraint.

If your workspace does **not** contain a working Tetris implementation, stop and
report `self_reported_status: "failed"` with the note `no seed material`. This
task is **skipped**, never attempted from scratch — a from-scratch build is not a
valid submission and scores zero, because the thing being measured here is the
ability to operate inside code you did not design.

---

## 1. Objective

Take the existing Tetris implementation in your workspace and extend it into a
full-featured game: persistent high scores, deterministic replay record and
playback, three game modes behind a menu, user-configurable keybindings, a
heuristic AI autoplay, T-spin detection and scoring, a garbage-line attack mode,
and correct handling of terminal resize. You must work **with** the architecture
that is already there — read it, understand its seams, extend it at those seams,
and refactor only where the existing structure genuinely blocks a feature. A
rewrite is an automatic fail. You will additionally produce
`ARCHITECTURE-NOTES.md`, a scored artifact that accounts for every pre-existing
source file and justifies every structural change you made.

---

## 2. Substitution variables

The harness substitutes these before this prompt is handed to you. If you see a
literal `{{...}}` token anywhere below, treat it as a harness bug and report it in
`NOTES.md` rather than guessing.

| Variable       | Meaning                                                                 | Example                |
| -------------- | ----------------------------------------------------------------------- | ---------------------- |
| `{{LANGUAGE}}` | Language slug for this run, from the fixed list in `CONVENTIONS.md` §4  | `rust`                 |
| `{{RUN_ID}}`   | Run identifier, `<model-slug>__<harness-variant>` (`CONVENTIONS.md` §3) | `qwen3.6-27B__vanilla` |

---

## 3. Workspace

Write everything under, and only under, the four-level workspace path defined in
`CONVENTIONS.md` §4:

```
tui-games/solutions/{{RUN_ID}}/tetris-enhanced/{{LANGUAGE}}/
```

Resolved example for `{{RUN_ID}} = qwen3.6-27B__vanilla`, `{{LANGUAGE}} = rust`:

```
tui-games/solutions/qwen3.6-27B__vanilla/tetris-enhanced/rust/
```

All scripts are invoked **with that directory as the working directory**
(`CONVENTIONS.md` §6). Never hardcode an absolute path. Do not touch
`tui-games/solutions/{{RUN_ID}}/tetris/` — the seed run stays pristine. Do not
touch anything under `tui-games/tasks/` (`CONVENTIONS.md` §10). Fill in
`run.json` per `CONVENTIONS.md` §5 before you finish.

---

## 4. Rules you inherit vs. rules you must conform to

The seeded solution already defines a working game. Two categories of rule:

**Inherited — keep exactly as the seed has it.** Do not "improve" these; changing
them invalidates the comparison against the seed run.

- Piece geometry, spawn positions and orientations, board dimensions
  (10 columns × 20 visible rows plus a spawn buffer above).
- Gravity table, lock delay, DAS/ARR or equivalent input repeat behaviour.
- Hold rules, next-queue length, ghost piece, soft/hard drop mechanics.
- Base line-clear scoring, level progression, existing rendering layout.

If the seed genuinely lacks one of these (for example it has no lock delay), keep
its behaviour and say so in `ARCHITECTURE-NOTES.md`; do not invent a replacement.

**Conformed — the new features depend on these being identical everywhere, so
implement them exactly as specified in this prompt even if the seed differs.**
Every divergence you had to correct goes in `ARCHITECTURE-NOTES.md` under
"conformance changes".

- The PRNG and 7-bag randomiser (§5.1).
- The SRS wall-kick tables (Appendix A) — T-spin detection depends on them.
- T-spin detection, T-spin/back-to-back/combo scoring (§5.6).
- The garbage attack and defence tables and the opponent schedule (§5.7).
- The AI heuristic, its weights and its tie-break order (§5.5).
- The headless CLI, the input-script grammar, the replay file format and the
  JSON summary schema (§6).
- The keybinding config file grammar (§5.4).
- The high-score file schema and ordering (§5.2).

---

## 5. Functional requirements

Each numbered requirement is independently checkable. Implement all of them.

### 5.1 Deterministic core (F1–F4)

**F1 — Seeded PRNG.** All randomness in the game comes from SplitMix64. There is
no other source of entropy in the engine. All arithmetic is on unsigned 64-bit
integers, wrapping:

```
state ← seed
next():
    state ← state + 0x9E3779B97F4A7C15
    z ← state
    z ← (z XOR (z >> 30)) * 0xBF58476D1CE4E5B9
    z ← (z XOR (z >> 27)) * 0x94D049BB133111EB
    return z XOR (z >> 31)

rand_below(n) = next() mod n          -- n > 0, modulo bias accepted deliberately
```

Reference vectors, seed `0`, first four `next()` outputs:
`0xE220A8397B1DCDAF`, `0x6E789E6AA1B965F4`, `0x06C45D188009454F`,
`0xF88BB8A8724C81EC`.

**F2 — 7-bag.** Two independent SplitMix64 streams exist: the **piece stream**,
initialised with `seed`, and the **opponent stream** (§5.7), initialised with
`seed XOR 0xDEADBEEFCAFEBABE`. Nothing else draws from either.

The piece bag starts as the ordered array `[I, J, L, O, S, T, Z]` and is shuffled
by downward Fisher–Yates using the piece stream:

```
for i from 6 down to 1:
    j ← rand_below(i + 1)
    swap bag[i], bag[j]
```

Pieces are dispensed from index 0 upward; a new bag is shuffled when the old one
empties. Reference vectors — the first three bags for a given seed:

| seed  | bag 1     | bag 2     | bag 3     |
| ----- | --------- | --------- | --------- |
| 0     | `ZOJTSIL` | `OIZTSLJ` | `ZSITLOJ` |
| 1     | `TZSOIJL` | `JTSLZOI` | `LTZOJSI` |
| 12345 | `JZSLIOT` | `JITSOZL` | `OSJLZTI` |

**F3 — Fixed-timestep loop.** The simulation advances in discrete ticks of
1/60 s. Every rule that mentions time is expressed in ticks. In headless mode the
engine must **never read the system clock** — not for timing, not for seeding,
not for the high-score table, not for logging. In interactive mode the render
loop is decoupled from the simulation: accumulate elapsed wall time, step the
simulation a whole number of ticks, render at most once per frame.

**F4 — Determinism guarantee.** Given the same seed, mode, flags and input
script, the engine must produce a byte-identical JSON summary (§6.3) on every
run, on every machine, and regardless of how fast the host is. Any iteration over
an unordered container that can affect game state must be made order-stable.

### 5.2 Persistent high-score table (F5)

**F5.** High scores persist to disk as JSON at `<data-dir>/highscores.json`,
where `<data-dir>` is `--data-dir` if given, else the environment variable
`TETRIS_DATA_DIR` if set and non-empty, else `./data` relative to the working
directory. Create the directory if absent.

Exact file schema — object, keys in this order, one array per mode:

```json
{
  "schema": "tui-tetris-enhanced/highscores/1",
  "marathon": [
    {"name": "SAL", "score": 18400, "lines": 47, "level": 5, "ticks": 4212, "seed": 12345, "mode": "marathon"}
  ],
  "sprint": [],
  "ultra": []
}
```

- Each mode array holds at most **10** entries.
- Ordering is per mode, each key applied in turn until a difference is found. The
  comparator must be a **total order** — no tie may be resolved by insertion
  accident.
  - `marathon`, `ultra`: `score` descending, `lines` descending, `ticks`
    ascending, `seed` ascending, `name` ascending by byte value.
  - `sprint`: `lines` descending, `ticks` ascending, `score` descending, `seed`
    ascending, `name` ascending by byte value. (Sprint ranks by speed, so a
    completed 40-line run always outranks an incomplete one.)
- `name` is 1–8 characters drawn from `[A-Z0-9 ]` (uppercase letters, digits,
  space). Leading and trailing spaces are stripped; an empty result becomes
  `AAA`. Entry is via an on-screen name prompt after a game ends in interactive
  mode; in headless mode the name comes from `--name` (default `AAA`).
- Writes are atomic: write to `<data-dir>/highscores.json.tmp`, flush, then
  rename over the target. A crash must never leave a truncated table.
- A missing file means an empty table. A malformed or unparsable file must be
  treated as empty and the program must continue; it must not crash, and it must
  print one warning line to **stderr**. Never write a diagnostic to stdout.
- **Headless runs do not write high scores unless `--persist` is passed.** This
  is required: without it, repeated headless runs would mutate state and break
  the byte-identical summary guarantee.

### 5.3 Replay record and playback (F6–F8)

**F6 — Replay file format.** A replay is a UTF-8 text file, LF line endings:

- Line 1, exactly: `#!tetris-replay 1`
- Line 2: a single-line JSON object, compact separators (`,` and `:`, no spaces),
  keys in this exact order:
  `{"seed":<int>,"mode":"<marathon|sprint|ultra>","attack":<0|1>,"ai":<0|1>,"ticks":<int>,"score":<int>,"lines":<int>,"summary_sha256":"<64 lowercase hex>"}`
  where `summary_sha256` is the SHA-256 of the exact bytes of the JSON summary
  line (§6.3) that the recorded run printed, **including its trailing newline**.
  `attack` and `ai` are the integers `0` or `1` here too — never JSON booleans,
  matching the summary schema.
- Lines 3+: the input log, in the **exact same grammar as an input script**
  (§6.2). A replay's input section, extracted verbatim, must be usable as a
  `--script` file.

**F7 — Recording.** `--record <path>` records the session that is being played —
interactive, scripted or AI — and writes the replay on exit, on every exit path
including top-out, `QUIT`, and SIGINT. Every input that reaches the engine is
logged with its tick, including inputs synthesised by the AI (§5.5).

The input section is written in **canonical form**, and that is what makes a
recording byte-reproducible:

- no comment lines and no blank lines;
- one §6.2 action token per input, in tick order;
- every input-free tick accounted for exactly once, collapsed maximally — a run
  of input-free ticks becomes a single `TICK <n>`, split into further `TICK`
  lines only when `n` would exceed 100000;
- only the ticks the run actually executed — a run that tops out, hits its goal
  or hits `--max-ticks` part-way through a script records just the prefix it
  played.

So the canonical log is a function of seed, mode, flags and input alone: two runs
of the same session write byte-identical input sections, and replaying a
recording reproduces the recording's own log. `input_sha256` (§6.3) digests this
log, which is what makes the bit-exactness requirement in F8 achievable.

**F8 — Playback and verification.**

- `--replay <path>` plays a replay back: interactively with rendering by default,
  headlessly under `--headless`. Seed, mode and flags come from the replay
  header; conflicting command-line flags are an error (exit code 2).
- `--verify-replay <path>` replays headlessly, recomputes the SHA-256 of its own
  summary line, compares it to `summary_sha256` in the header, prints
  `replay ok <path>` or `replay MISMATCH <path>` to stdout, and exits 0 on match,
  1 on mismatch.
- **Bit-exactness is the requirement**: the summary produced by replaying a
  recording must be byte-identical to the summary produced by the original run.
  Any nondeterminism — clock reads, hash-order iteration, unseeded randomness,
  frame-rate-dependent input handling — will show up here as a mismatch.

### 5.4 Modes, menu, and configurable keybindings (F9–F11)

**F9 — Modes.** Three modes, selected by `--mode` or from the menu:

| Mode       | Level                                              | Ends when                              | Ranked by        |
| ---------- | -------------------------------------------------- | -------------------------------------- | ---------------- |
| `marathon` | starts at 1, +1 every 10 lines cleared, caps at 15 | 150 lines cleared (`goal`) or top-out  | score            |
| `sprint`   | fixed at 1                                         | 40 lines cleared (`goal`) or top-out   | ticks, ascending |
| `ultra`    | fixed at 1                                         | tick 10800 reached (`goal`) or top-out | score            |

Attack mode (§5.7) is an orthogonal toggle (`--attack`) that can be combined with
any of the three.

**F10 — Menu screen.** A menu is shown before play in interactive mode. Items, in
this order: `Marathon`, `Sprint`, `Ultra`, `Attack: on/off`, `AI autoplay:
on/off`, `High Scores`, `Replays`, `Quit`. Navigation moves the selection with
wrap-around; selecting a mode starts a game with the current toggles; `High
Scores` shows the table for each mode; `Replays` lists `*.rply` files in
`<data-dir>/replays/` and plays the selected one; `Quit` exits cleanly. The menu
must be drivable headlessly: with `--start-at-menu`, the run begins on the menu
and the script's `UP`, `DOWN` and `SELECT` commands drive it. Ticks spent in the menu
count toward the summary's `ticks`.

**F11 — Keybindings from a config file.** Bindings load from `--config` if given,
else `TETRIS_CONFIG` if set and non-empty, else `./config/keys.conf`. A missing
file is not an error — defaults apply silently. Ship the default file at
`config/keys.conf` in your workspace.

Grammar, one binding per line:

```
# comment to end of line; blank lines ignored
<action> = <key>[, <key>]*
```

Actions, all of which must be bindable: `move_left`, `move_right`, `soft_drop`,
`hard_drop`, `rotate_cw`, `rotate_ccw`, `rotate_180`, `hold`, `pause`, `restart`,
`quit`, `menu_up`, `menu_down`, `menu_select`.

Key names: a single printable ASCII character (case-sensitive), or one of
`Left`, `Right`, `Up`, `Down`, `Space`, `Enter`, `Escape`, `Tab`, `Backspace`,
`F1`–`F12`, or `Ctrl+<char>`.

Defaults, which are also the exact contents your shipped `config/keys.conf` must
express:

```
move_left   = Left, a
move_right  = Right, d
soft_drop   = Down, s
hard_drop   = Space
rotate_cw   = Up, x
rotate_ccw  = z
rotate_180  = c
hold        = Tab, Ctrl+c
pause       = p
restart     = r
quit        = q, Escape
menu_up     = Up, k
menu_down   = Down, j
menu_select = Enter
```

(`Ctrl+c` bound to `hold` is intentional — see F17: the raw-mode layer owns
Ctrl-C and must not let it kill the process without restoring the terminal.)

Error handling, exactly:

- Unknown action name, unknown key name, or malformed line: print
  `config: line <n>: <reason>` to stderr, keep the default binding for any action
  the bad line was meant to set, and continue.
- The same key bound to two different actions: this is fatal. Print
  `config: duplicate binding for key <key>` to stderr and exit with code **2**.
- An action bound to zero keys after parsing keeps its default.

The config is parsed and validated at startup in **every** mode, headless
included, so that a broken config is caught by `test.sh` and not only by a human
at a terminal. Headless input scripts still bypass the binding layer entirely
(§6.2) — the parse happens for validation, and its result is unused there.

### 5.5 AI autoplay (F12)

**F12.** `--ai` (menu toggle `AI autoplay`) makes the engine play itself. The AI
must drive the game **through the same input path a human uses** — it synthesises
the same action tokens, which means an AI game is recordable and replayable like
any other (F7). It must not reach into the board and place pieces directly.

Candidate generation: for the current piece, enumerate every final placement
reachable by (a) rotating at spawn altitude to one of the 4 rotation states,
(b) translating horizontally to a target column, (c) hard-dropping. Placements
requiring tucks or slides under an overhang are out of scope and must not be
generated. A candidate is legal only if the piece is unobstructed at spawn
altitude across the full horizontal path.

Evaluation: for each candidate, compute the board that would result **after** the
piece locks and any completed lines clear, then score it over the 20 visible rows:

- `column_height[c]` = `20 - r` where `r` is the index of the topmost filled cell
  in column `c` counting from the top (0-based); `0` if the column is empty.
- `aggregate_height` = Σ `column_height[c]` for c in 0..9.
- `complete_lines` = number of rows this placement cleared.
- `holes` = number of empty cells that have at least one filled cell above them
  in the same column.
- `bumpiness` = Σ |`column_height[c]` − `column_height[c+1]`| for c in 0..8.

```
score = -0.510066 * aggregate_height
        + 0.760666 * complete_lines
        - 0.356630 * holes
        - 0.184483 * bumpiness
```

Pick the highest-scoring candidate. Ties break deterministically: lowest rotation
state index (0, R=1, 2, L=3) first, then lowest target column. Use the hold piece
only if you also evaluate it under the identical rule set and tie-break; a
one-piece lookahead with no hold is acceptable.

**Threshold — this is a pass/fail gate.**

```
./run.sh --headless --ai --seed 12345 --mode marathon --max-ticks 200000
```

must terminate with `"lines"` **≥ 40** in its summary. For robustness, the same
command must also reach ≥ 40 lines on at least two of the three seeds `1`, `777`,
`20260820`.

### 5.6 T-spin detection and scoring (F13–F14)

**F13 — Detection.** Maintain a flag `last_action_was_rotation` on the active
piece: set **true** by any successful rotation (including one that used a kick);
set **false** by any successful translation — horizontal move, soft-drop step,
gravity step, or a hard drop that moved the piece one or more cells. A hard drop
of zero cells does not clear it.

At lock time, a placement is a T-spin candidate iff the piece is `T` **and**
`last_action_was_rotation` is true. For a candidate, examine the four cells
diagonally adjacent to the centre of the T's 3×3 bounding box. A corner counts as
**occupied** if it holds a filled cell or lies outside the playfield (past the
left wall, right wall, floor, or above the buffer ceiling).

Front corners, by rotation state — the two corners on the side the T points
toward:

| State | Points | Front corners             |
| ----- | ------ | ------------------------- |
| 0     | up     | top-left, top-right       |
| R (1) | right  | top-right, bottom-right   |
| 2     | down   | bottom-left, bottom-right |
| L (3) | left   | top-left, bottom-left     |

Classification:

- **Full T-spin**: ≥ 3 of the 4 corners occupied **and both** front corners
  occupied.
- **Mini T-spin**: ≥ 3 of the 4 corners occupied and **exactly one** front corner
  occupied.
- **Override**: if the rotation that set the flag used kick index 5 (the last
  entry of the applicable row in Appendix A), the result is a **full** T-spin
  regardless of the front-corner count.
- A 180° rotation (`rotate_180`) uses only the `(0,0)` offset — if that is
  blocked the rotation fails — and participates in detection through the normal
  corner rule, never through the kick-index-5 override.
- Otherwise: not a T-spin.

**F14 — Scoring.** With `L` = current level, the points awarded at lock:

| Event                | Points               |
| -------------------- | -------------------- |
| single               | 100 × L              |
| double               | 300 × L              |
| triple               | 500 × L              |
| tetris (4 lines)     | 800 × L              |
| T-spin, 0 lines      | 400 × L              |
| T-spin single        | 800 × L              |
| T-spin double        | 1200 × L             |
| T-spin triple        | 1600 × L             |
| T-spin mini, 0 lines | 100 × L              |
| T-spin mini single   | 200 × L              |
| T-spin mini double   | 400 × L              |
| soft drop            | 1 per cell descended |
| hard drop            | 2 per cell descended |
| combo                | 50 × combo × L       |

- **Back-to-back**: a *difficult* clear is a tetris or any line-clearing T-spin
  (mini included). When a difficult clear immediately follows another difficult
  clear with no non-difficult line clear between them, its **line-clear value**
  from the table above is multiplied by 1.5 and floored — compute it as the
  integer `(value * 3) / 2` rounded down, not in floating point. Soft-drop,
  hard-drop and combo points are never part of the multiplied value. A clear
  that awards no lines (a 0-line T-spin) neither extends nor breaks the chain.
  The chain counter is the number of consecutive difficult clears; `b2b_max` in
  the summary is the highest value it reached.
- **Combo**: the combo counter starts at −1, increments on any lock that clears
  ≥ 1 line, and resets to −1 on any lock that clears none. Combo points are
  awarded only while the counter is ≥ 1. `max_combo` in the summary is the
  highest value the counter reached.
- There is **no** perfect-clear bonus. Do not add one.

### 5.7 Garbage attack mode (F15)

**F15.** Under `--attack`, an automated opponent sends garbage, and your clears
send garbage back.

Lines you send, per lock:

| Clear              | Lines sent |
| ------------------ | ---------- |
| single             | 0          |
| double             | 1          |
| triple             | 2          |
| tetris             | 4          |
| T-spin single      | 2          |
| T-spin double      | 4          |
| T-spin triple      | 6          |
| T-spin mini single | 1          |
| T-spin mini double | 2          |
| any 0-line clear   | 0          |

Plus `+1` if the clear was back-to-back, plus a combo bonus by the current combo
counter: `0 → +0`, `1–2 → +1`, `3–4 → +2`, `5–6 → +3`, `7–9 → +4`, `10+ → +5`.

Opponent schedule, drawn **only** from the opponent stream (§5.1 F2), first event
at tick 600, and at each event, in this exact draw order:

```
n        ← 1 + rand_below(3)              -- 1..3 lines queued as incoming
interval ← 300 + rand_below(301)          -- next event is `interval` ticks later
```

Cancellation and insertion:

- Lines you send first cancel queued incoming lines one-for-one; the remainder is
  discarded (there is no opponent board to model).
- Remaining queued incoming lines are inserted **after** the next piece locks and
  after its line clears resolve — never mid-piece.
- A batch of `k` rows is inserted at the bottom; the stack shifts up by `k`. All
  `k` rows in one batch share a single hole column `h = rand_below(10)`, drawn
  once per batch from the opponent stream at insertion time. Garbage cells render
  and encode as `#`, are indistinguishable from stack cells for line-clear
  purposes, and clear normally.
- If the shift pushes any filled cell above the buffer ceiling, the game
  top-outs.
- The summary counts `garbage_sent` (total after bonuses, before cancellation)
  and `garbage_received` (total rows actually inserted into the board).

### 5.8 Terminal resize and minimum size (F16–F17)

**F16 — Resize.** The renderer adapts to terminal size changes at runtime
(SIGWINCH where the platform provides it, polling the size otherwise). The
playfield stays centred; side panels (next queue, hold, score, mode, incoming
garbage meter) reflow rather than clip or wrap.

Minimum usable size is **60 columns × 24 rows**. Below that, in either dimension,
the game **pauses** — the simulation clock stops, no ticks elapse — and the screen
shows, centred:

```
Terminal too small
need 60x24, have <cols>x<rows>
```

Play resumes at the exact tick it paused on when the terminal is large enough
again. The check also runs at startup: launching in a too-small terminal shows
the same screen rather than drawing a corrupt frame or exiting.

**F17 — Terminal restoration.** Raw mode, alternate screen and hidden cursor must
be restored on **every** exit path: normal exit, `quit`, top-out, an unhandled
panic/exception, `SIGINT`, `SIGTERM`, and `SIGHUP`. After any of those, a plain
`stty sane`-free shell must be usable — no swallowed echo, no stuck alternate
screen, no invisible cursor. Because `Ctrl+c` is bound to `hold` by default
(F11), the raw-mode layer owns that byte; a real interrupt must still arrive via
`SIGINT` from the terminal driver or via the `quit` binding, and must still
restore state.

---

## 6. Headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven
without a terminal. Every task in `tui-games` shares this contract; yours extends
it with replay flags.

### 6.1 Command-line surface

`run.sh` must accept, in any order:

```
--headless              run with no terminal, no rendering, no clock reads
--script <path>         newline-delimited input script (§6.2)
--seed <n>              unsigned 64-bit decimal seed; default 0 in headless
--mode <m>              marathon | sprint | ultra; default marathon
--attack                enable garbage attack mode (§5.7)
--ai                    AI autoplay (§5.5)
--start-at-menu         begin on the menu screen; script drives it (F10)
--record <path>         write a replay of this session (§5.3)
--replay <path>         play a replay back
--verify-replay <path>  replay and check the recorded summary digest; exit 1 on mismatch
--max-ticks <n>         hard tick cap; default 100000 in headless, unlimited otherwise
--name <name>           high-score name in headless; default AAA
--persist               allow headless runs to write the high-score table
--config <path>         keybinding config (§5.4)
--data-dir <path>       data directory for high scores and replays (§5.2)
--selftest              run built-in invariant checks and exit
--help                  usage to stdout, exit 0
```

With no arguments, `run.sh` launches the interactive game at the menu. An unknown
flag, a missing required value, or a conflicting flag combination prints a
diagnostic to stderr and exits with code **2**.

### 6.2 Input script grammar

The base `tetris` task already defines a headless input-script grammar (its
section 7.2). **Keep it exactly and extend it** — the grammar below is a strict
superset, so every script the seeded solution accepted must still parse and mean
the same thing.

UTF-8 text, LF line endings, lines processed in order. A line is one of:

| Line                    | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `L`                     | move left, then advance 1 tick                               |
| `R`                     | move right, then advance 1 tick                              |
| `CW`                    | rotate clockwise, then advance 1 tick                        |
| `CCW`                   | rotate counter-clockwise, then advance 1 tick                |
| `SD`                    | soft drop one row, then advance 1 tick                       |
| `HD`                    | hard drop and lock, then advance 1 tick                      |
| `HOLD`                  | hold, then advance 1 tick                                    |
| `TICK <n>`              | advance exactly `n` ticks with no input, `1 <= n <= 100000`  |
| `FLIP`                  | *(new)* rotate 180°, then advance 1 tick                     |
| `PAUSE`                 | *(new)* toggle pause, then advance 1 tick                    |
| `RESTART`               | *(new)* restart the current mode, then advance 1 tick        |
| `QUIT`                  | *(new)* end the run with status `quit`; consumes 1 tick      |
| `UP`                    | *(new)* menu selection up, then advance 1 tick               |
| `DOWN`                  | *(new)* menu selection down, then advance 1 tick             |
| `SELECT`                | *(new)* activate the selected menu item, then advance 1 tick |
| *(empty line)*          | ignored entirely; advances nothing                           |
| line beginning with `#` | comment; ignored entirely; advances nothing                  |

Commands are uppercase and exact, one per line. These are **actions**, not
keystrokes — the script bypasses the keybinding layer entirely, so a script's
meaning never depends on `keys.conf`. Any other line, including an unknown
command, a lowercase variant, or a malformed `TICK`, is a fatal error: print
`error: line <N>: <message>` to stderr and exit with status **3** — the same
diagnostic and status the base task specifies.

When the script is exhausted, the run ends immediately with status `script_end`.
Use `TICK <n>` to let gravity run.

Exit statuses for the whole program: `0` normal, `1` a `--verify-replay`
mismatch, `2` a usage or configuration error, `3` a malformed input script.

### 6.3 The JSON summary

This **supersedes** the base task's summary object. The base emits
`{"schema":1,...}` with booleans and nulls; the enhanced schema is a new version
with a string `schema`, no booleans, no nulls, and additional counters. Renames
you must apply: the base's `board_hash` becomes `board_sha256` (same
computation), and the base's boolean `hold_used` becomes the integer counter
`holds`. Report the change in `ARCHITECTURE-NOTES.md` under conformance changes.

On exit, a headless run prints **exactly one** line to stdout: a JSON object,
compact separators (`,` and `:`, no spaces), keys in the order below, all values
integers or strings — **no floats, no nulls, no booleans, no nested objects or
arrays** — terminated by a single `\n`. Nothing else may be written to stdout in
headless mode; diagnostics go to stderr.

```
{"schema":"tui-tetris-enhanced/1","mode":"marathon","seed":12345,"attack":1,"ai":0,"status":"topout","ticks":4212,"pieces":213,"score":18400,"lines":47,"level":5,"singles":10,"doubles":6,"triples":3,"tetrises":4,"tspins":2,"tspin_minis":1,"max_combo":5,"b2b_max":3,"garbage_sent":21,"garbage_received":18,"holds":31,"hold":"T","next":"IJOSZ","active":"","board":"........../........../........../........../........../........../........../........../........../........../........../........../........../....T...../...TTT..../ZZ...LLL../IZZ..L..OO/IJJJSS..OO/#J..SS.###/##.#######","board_sha256":"351a4fca01d38d1dd23499369b654821468b3914b7b053af7e3b2426c0733fcb","input_sha256":"13fb7c9d338c0850ce3ce4e104cdc258505e23b0f378977cae575e5e3022bc86"}
```

(The values above are illustrative; the `board` string is a real, well-formed
example — 20 rows of 10 characters joined by `/`, 219 characters total — and
`board_sha256` is its actual digest.)

Key definitions:

| Key                                | Type   | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                           | string | literally `tui-tetris-enhanced/1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mode`                             | string | `marathon`, `sprint` or `ultra`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `seed`                             | int    | the seed actually used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `attack`, `ai`                     | int    | `0` or `1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `status`                           | string | see below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ticks`                            | int    | simulation ticks elapsed, menu ticks included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pieces`                           | int    | pieces locked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `score`, `lines`, `level`          | int    | final values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `singles`…`tetrises`               | int    | count of locks clearing exactly 1/2/3/4 lines; T-spin clears are counted here as well                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tspins`                           | int    | locks classified as a full T-spin, 0-line ones included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `tspin_minis`                      | int    | locks classified as a mini T-spin, 0-line ones included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `max_combo`                        | int    | highest value the combo counter reached, `0` if never ≥ 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `b2b_max`                          | int    | highest back-to-back chain length reached, `0` if never                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `garbage_sent`, `garbage_received` | int    | §5.7; both `0` outside attack mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `holds`                            | int    | successful hold swaps over the run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `hold`                             | string | the held piece's letter, or `""` if the hold slot is empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `next`                             | string | the next queue as letters in order, one character per queued piece, using the seed's inherited queue length                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `active`                           | string | the live piece as `TYPE:ROT:ROW:COL` using the seed's own coordinate convention (e.g. `T:0:-1:4`), or `""` when no piece is active                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `board`                            | string | 20 visible rows, top row first, joined by `/` — exactly 219 characters; each row 10 chars from `.` (empty), `IJLOSTZ` (locked tetromino), `#` (garbage). The active piece and the ghost are **excluded**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `board_sha256`                     | string | lowercase hex SHA-256 of `board`'s UTF-8 bytes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `input_sha256`                     | string | lowercase hex SHA-256 of this run's **canonical input log** (§5.3 F7) — the exact bytes this run would write as lines 3+ of a replay file — whatever drove it: `--script`, `--replay`, the AI, or a human. It is deliberately *not* a digest of the `--script` file as written, because a script may carry comments, blank lines and uncollapsed `TICK`s, and a run may end before consuming all of it; digesting the canonical log is what lets a recording and a replay of it agree byte for byte (F8). A run that executed no input logs nothing, and the digest is that of the empty byte string, `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. |

`status`, evaluated in this precedence order:

1. `topout` — the game ended by topping out.
2. `goal` — the mode's goal was reached (the F9 table).
3. `quit` — a `QUIT` command or the `quit` binding ended the run.
4. `tick_limit` — `--max-ticks` was reached.
5. `script_end` — the script ran out with the game still live.

**Byte-identical requirement**: the same seed + mode + flags + script must
produce the same summary bytes on every run, on every machine, and at any host
speed. Note that byte-identity **across languages** is *not* required for this
task — unlike the base `tetris` task — because the inherited rules of §4
(gravity table, lock delay, queue length) legitimately differ between seed
implementations. Determinism is per-implementation here.

### 6.4 `--selftest`

`./run.sh --selftest` runs built-in invariant checks with no terminal, prints one
line per check — `ok <name>` or `FAIL <name>: <detail>` — then a final line
`selftest: <passed> passed, <failed> failed`, and exits non-zero if any check
failed. At minimum these checks, named as given:

1. `prng_vectors` — the seed-0 vectors in F1.
2. `bag_vectors` — the three bag vectors in F2.
3. `bag_fairness` — over 700 pieces from seed 7, each type appears exactly 100
   times; every **aligned** block of seven (pieces `7k` through `7k+6`) contains
   each of the seven types exactly once; and no two occurrences of the same type
   are separated by more than 12 intervening pieces. Do **not** assert that every
   *sliding* window of seven is duplicate-free — a correct 7-bag violates that
   across bag boundaries (a type may end one bag and start the next).
4. `kick_tables` — all 8 transitions × 5 offsets present for both the JLSTZ and I
   tables (Appendix A), and each transition row is the exact negation-mirror of
   its reverse row — `0→R`/`R→0`, `R→2`/`2→R`, `2→L`/`L→2`, `L→0`/`0→L` — in
   both tables.
5. `rotation_identity` — in an empty field, four successive CW rotations return
   every piece to its original cells and rotation state.
6. `line_clear` — a constructed board with rows 17 and 19 full clears exactly
   those two rows and shifts the remainder down correctly.
7. `tspin_double` — the canonical T-spin double setup detects a **full** T-spin
   and awards `1200 × L`, and the same setup entered by translation rather than
   rotation awards a plain double.
8. `tspin_mini` — a constructed setup detects a **mini**.
9. `garbage_insert` — inserting a 3-row batch shifts the stack up 3, all three
   rows share one hole column, and cancellation subtracts correctly.
10. `highscore_order` — inserting 20 synthetic entries keeps exactly the top 10 in
    the F5 order, including every tie-break level.
11. `config_parse` — the default config in F11 parses to the default bindings, and
    a config with a duplicate key is rejected.
12. `replay_roundtrip` — run a fixed script, record, replay, and assert the two
    summary lines are byte-identical.

---

## 7. Technical constraints

- **No game engine.** No SDL, no ncurses-based game framework, no Bevy/Pygame/
  Raylib/Unity-alike, nothing that supplies a game loop, a sprite system or
  collision handling. A **thin terminal library** is allowed — one that only does
  raw mode, cursor movement, key decoding and screen buffers (`crossterm`,
  `termbox`, `tcell`, `blessed`, `curses` from the Python standard library). If in
  doubt, write it against the platform primitives (`termios` + ANSI escapes,
  `ioctl(TIOCGWINSZ)`).
- **No new heavy dependencies.** Prefer what the seeded solution already uses.
  Every dependency you add must be listed in `ARCHITECTURE-NOTES.md` with a
  one-line justification. Implement SHA-256 yourself or use the language's
  standard library — do not add a crypto crate for it if the stdlib has one.
- **No network access** at build or run time (`CONVENTIONS.md` §6). `build.sh`
  must succeed offline; vendor or lock anything the seed already pulled in.
- **Terminal state restored on every exit path** — see F17. This is the single
  most common way these submissions fail an operator's manual check.
- **No busy-wait loops.** The interactive loop sleeps or blocks on input with a
  timeout; it must not spin at 100% CPU. The headless loop does not sleep at all.
- **60 fps render budget.** One rendered frame must cost well under 16 ms on a
  standard 80×24 terminal. Render by diffing against the previous frame buffer
  and emitting only changed cells; do not clear and redraw the whole screen every
  frame.
- **Scripts follow `CONVENTIONS.md` §6**: `#!/usr/bin/env bash`, `set -euo
  pipefail`, `chmod +x`, working directory is the language folder.
- **UTF-8 output only where it degrades gracefully.** If you draw with block
  characters, keep an ASCII fallback selectable by `TETRIS_ASCII=1`.

---

## 8. Deliverables

Everything below must exist under the workspace path in §3.

| Path                       | Contents                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------ |
| source files               | the extended implementation, in `{{LANGUAGE}}`                                       |
| `build.sh`                 | compiles/installs; offline; exit 0 on success                                        |
| `run.sh`                   | the CLI in §6.1; no args ⇒ interactive menu                                          |
| `test.sh`                  | the suite described below; exit 0 iff all pass                                       |
| `config/keys.conf`         | the default bindings from F11, verbatim                                              |
| `tests/scripts/basic.txt`  | a recorded input script exercising movement, rotation, hold and hard drop            |
| `tests/scripts/tspin.txt`  | a script that sets up and executes at least one full T-spin                          |
| `tests/scripts/attack.txt` | a script run under `--attack` that both receives and cancels garbage                 |
| `tests/replays/basic.rply` | a replay recorded from `tests/scripts/basic.txt`                                     |
| `README.md`                | how to build, run and play; the full CLI surface; keybindings; where data files live |
| `NOTES.md`                 | what you built, what you did not, known bugs, anything the scorer should know        |
| `ARCHITECTURE-NOTES.md`    | §9 — a scored artifact                                                               |
| `run.json`                 | filled per `CONVENTIONS.md` §5                                                       |

`test.sh` must, at minimum:

1. Run `./run.sh --selftest` and require exit 0.
2. Run `./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --mode marathon`
   and assert the summary line equals a literal expected string embedded in
   `test.sh`. Not a substring match, not a key-subset match — the whole line.
3. Run the same command a second time and assert the two outputs are
   byte-identical.
4. Run `./run.sh --verify-replay tests/replays/basic.rply` and require exit 0.
5. Run `./run.sh --headless --script tests/scripts/tspin.txt --seed 1 --mode marathon`
   and assert `"tspins"` ≥ 1 and that the score reflects the T-spin table.
6. Run `./run.sh --headless --script tests/scripts/attack.txt --seed 99 --mode marathon --attack`
   and assert `garbage_received` > 0.
7. Run `./run.sh --headless --ai --seed 12345 --mode marathon --max-ticks 200000`
   and assert `"lines"` ≥ 40.
8. Assert that a headless run without `--persist` does not create or modify
   `<data-dir>/highscores.json`.

---

## 9. `ARCHITECTURE-NOTES.md` — the scored artifact

This is where you show that you read the code before you changed it. Required
sections, in this order:

1. **Seed inventory.** A table with one row for **every source file that existed
   in the seeded solution**: path, one of `KEPT` / `EXTENDED` / `REFACTORED` /
   `REPLACED` / `DELETED`, and a one-line reason. `KEPT` means byte-identical.
   No file may be omitted.
2. **New files.** A table of every file you added, with what it holds and why it
   was a new file rather than an extension of an existing one.
3. **Seams used.** For each of the eight feature areas (F5, F6–F8, F9–F11, F12,
   F13–F14, F15, F16–F17, and the headless contract), name the existing
   abstraction you hooked into and quote the function or type signature you
   extended. If you had to create a seam that did not exist, say so here.
4. **Refactors and their justification.** For each `REFACTORED` or `REPLACED`
   file: what the old structure was, precisely which requirement it blocked, what
   you changed it to, and what you did to keep the pre-existing behaviour
   identical. "It was cleaner this way" is not a justification and will be scored
   as a rewrite.
5. **Conformance changes.** Every place the seed diverged from §4's conformed
   rules and what you changed to make it conform.
6. **Determinism audit.** Every source of nondeterminism you found or could have
   introduced — clock reads, hash iteration order, floating point, unordered
   collections, thread scheduling, environment lookups — and how each is
   neutralised in headless mode.
7. **Dependencies added**, with one-line justifications.
8. **What you deliberately left alone**, and why.

---

## 10. Definition of done

Verify each of these yourself before you declare completion.

- [ ] The workspace is at `tui-games/solutions/{{RUN_ID}}/tetris-enhanced/{{LANGUAGE}}/` and nothing outside it was modified.
- [ ] The seeded implementation is recognisably still the implementation: its module boundaries, its type names, and its inherited rules (§4) survive.
- [ ] `./build.sh` exits 0 with no network access.
- [ ] `./run.sh --help` prints the §6.1 surface and exits 0.
- [ ] `./run.sh --selftest` prints all twelve checks and exits 0.
- [ ] `./run.sh` with no arguments opens the menu, plays, restores the terminal on quit, and restores it on Ctrl-C-driven `SIGINT`.
- [ ] Running the game in a 50×20 terminal shows the too-small screen and resumes at the same tick when the terminal is enlarged.
- [ ] A headless scripted run prints exactly one JSON line matching the §6.3 schema and key order, with no floats, nulls or booleans.
- [ ] Two identical headless runs produce byte-identical stdout.
- [ ] `./run.sh --verify-replay tests/replays/basic.rply` prints `replay ok ...` and exits 0.
- [ ] A replay recorded from an AI game replays to a byte-identical summary.
- [ ] `./run.sh --headless --ai --seed 12345 --mode marathon --max-ticks 200000` reports `lines` ≥ 40, and does so on at least two of seeds `1`, `777`, `20260820`.
- [ ] `tspin.txt` produces a full T-spin, scored from the F14 table, with back-to-back applied where it applies.
- [ ] Attack mode both sends and receives garbage; cancellation reduces the incoming queue; garbage rows share a hole column per batch.
- [ ] `config/keys.conf` exists, parses to the F11 defaults, and a duplicate-key config exits 2 with the specified stderr message.
- [ ] The high-score table survives a process restart, is capped at 10 per mode, is ordered by the F5 comparator, is written atomically, and is **not** written by headless runs lacking `--persist`.
- [ ] A corrupt `highscores.json` is tolerated: one stderr warning, empty table, no crash.
- [ ] `./test.sh` exits 0 and covers all eight items in §8.
- [ ] `ARCHITECTURE-NOTES.md` contains all eight sections in §9 and accounts for every seeded file by name.
- [ ] `README.md`, `NOTES.md` and `run.json` are complete; `run.json` has all required fields from `CONVENTIONS.md` §5.

---

## 11. Scoring rubric

Weights sum to 100. Partial credit is awarded per criterion.

| #   | Criterion                                                                                                                                                                                                               | Weight | How it is judged                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| 1   | **Architectural integration** — the submission extends the seed rather than replacing it; seed module boundaries, type names and inherited rules survive; changes are localised to the seams the features actually need | 18     | Diff against the pristine seed snapshot; a rewrite scores 0 here and caps the total at 40 |
| 2   | **Determinism and the headless contract** — §6.1 flags, §6.2 grammar, §6.3 exact schema and key order, byte-identical repeat runs, no clock reads in headless, `--selftest` with all twelve checks                      | 16     | Mechanical: repeat runs, schema validation, key-order check                               |
| 3   | **Replay record and playback** — format per F6, records every input including AI-synthesised, replays bit-exact, `--verify-replay` correct                                                                              | 9      | Mechanical: record → replay → compare summaries                                           |
| 4   | **AI autoplay** — correct feature definitions, specified weights, deterministic tie-break, drives the normal input path, meets the 40-line gate                                                                         | 9      | Mechanical: the four seeded runs; inspection of the eval function against §5.5            |
| 5   | **T-spin detection and scoring** — flag semantics, 3-corner rule, front-corner classification, kick-index-5 override, the F14 table, back-to-back and combo                                                             | 8      | `tspin.txt`, the selftest cases, and inspection                                           |
| 6   | **`ARCHITECTURE-NOTES.md`** — all eight sections, every seeded file accounted for, refactors genuinely justified, determinism audit real rather than boilerplate                                                        | 7      | Inspection against the seed inventory                                                     |
| 7   | **Garbage attack mode** — send table, combo and B2B bonuses, cancellation before insertion, per-batch hole column, opponent schedule drawn in the specified order                                                       | 6      | `attack.txt`, selftest, inspection                                                        |
| 8   | **Modes and menu** — the three modes with correct goals and level rules, the eight menu items, headless menu driving under `--start-at-menu`                                                                            | 6      | Mechanical for modes; scripted for the menu                                               |
| 9   | **Build and test hygiene** — `build.sh`/`run.sh`/`test.sh` per `CONVENTIONS.md` §6, `test.sh` covers all eight items in §8, README/NOTES/run.json complete                                                              | 6      | Mechanical: run them                                                                      |
| 10  | **Keybinding config** — grammar, defaults, shipped `keys.conf`, error handling including the fatal duplicate case                                                                                                       | 5      | Mechanical: three config fixtures                                                         |
| 11  | **High-score persistence** — schema, cap, total-order comparator, atomic write, corruption tolerance, `--persist` gating                                                                                                | 5      | Mechanical: fixtures and restart test                                                     |
| 12  | **Resize and terminal restoration** — minimum-size guard, clock stops while too small, resume at the same tick, restoration on all exit paths including panic and SIGINT                                                | 5      | Operator inspection in a real terminal                                                    |

Two hard gates override the table:

- **Rewrite gate.** If the submission is a from-scratch reimplementation — the
  seed's files replaced wholesale, its module structure discarded, its type names
  gone — criterion 1 scores 0 and the total is capped at 40, however good the
  features are.
- **Determinism gate.** If two identical headless invocations produce different
  stdout, criteria 2 and 3 score 0.

---

## Appendix A — SRS wall-kick tables

Offsets are `(x, y)` with **x positive right and y positive up**. If your board
indexes rows downward, negate `y`. Rotation states: `0` spawn, `R` = 1 (one CW
from spawn), `2`, `L` = 3. Kick index is the **1-based** position in the row —
the column headings below are those indices — so index 5 is the fifth and last
offset listed, the one the T-spin override in F13 refers to.

**J, L, S, T, Z**

| Transition | 1     | 2      | 3       | 4      | 5       |
| ---------- | ----- | ------ | ------- | ------ | ------- |
| 0→R        | (0,0) | (−1,0) | (−1,+1) | (0,−2) | (−1,−2) |
| R→0        | (0,0) | (+1,0) | (+1,−1) | (0,+2) | (+1,+2) |
| R→2        | (0,0) | (+1,0) | (+1,−1) | (0,+2) | (+1,+2) |
| 2→R        | (0,0) | (−1,0) | (−1,+1) | (0,−2) | (−1,−2) |
| 2→L        | (0,0) | (+1,0) | (+1,+1) | (0,−2) | (+1,−2) |
| L→2        | (0,0) | (−1,0) | (−1,−1) | (0,+2) | (−1,+2) |
| L→0        | (0,0) | (−1,0) | (−1,−1) | (0,+2) | (−1,+2) |
| 0→L        | (0,0) | (+1,0) | (+1,+1) | (0,−2) | (+1,−2) |

**I**

| Transition | 1     | 2      | 3      | 4       | 5       |
| ---------- | ----- | ------ | ------ | ------- | ------- |
| 0→R        | (0,0) | (−2,0) | (+1,0) | (−2,−1) | (+1,+2) |
| R→0        | (0,0) | (+2,0) | (−1,0) | (+2,+1) | (−1,−2) |
| R→2        | (0,0) | (−1,0) | (+2,0) | (−1,+2) | (+2,−1) |
| 2→R        | (0,0) | (+1,0) | (−2,0) | (+1,−2) | (−2,+1) |
| 2→L        | (0,0) | (+2,0) | (−1,0) | (+2,+1) | (−1,−2) |
| L→2        | (0,0) | (−2,0) | (+1,0) | (−2,−1) | (+1,+2) |
| L→0        | (0,0) | (+1,0) | (−2,0) | (+1,−2) | (−2,+1) |
| 0→L        | (0,0) | (−1,0) | (+2,0) | (−1,+2) | (+2,−1) |

In both tables each transition row is the exact negation of its reverse row —
`0→R` negates to `R→0`, `R→2` to `2→R`, `2→L` to `L→2`, and `L→0` to `0→L`.
The `kick_tables` selftest (§6.4) checks that property.

**O** does not kick: its only offset is `(0,0)`, in every transition.

Offsets are tried in order 1 through 5; the first that places the piece in an
unobstructed position wins, and the index of that offset is what the T-spin
kick-index-5 override in F13 refers to. If all five fail, the rotation fails and
`last_action_was_rotation` is left unchanged.
