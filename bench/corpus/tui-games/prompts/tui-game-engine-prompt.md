# TUI task 8 of 8 — `game-engine` (size XXL)

## 1. Objective

Build a reusable terminal game engine as a standalone, separately buildable and independently
testable unit, and then prove that the engine is genuinely reusable by implementing **two complete
games — Snake and Tetris — on top of it**, with zero game-specific code inside the engine. The
engine must supply a double-buffered damage-tracking renderer, a layered scene/widget tree with
z-ordering and clipping, an input system with key mapping, chords and repeat handling, a
fixed-timestep loop with interpolated rendering and frame-time budgeting, an event bus, an
entity-component store, a resource loader for sprite and level data, a tween/animation system, an
audio-cue seam, a scene stack, terminal capability detection with graceful degradation, and a debug
overlay. This is the architecture test: the score is dominated by whether the engine/game boundary
is real, whether both games are expressible purely through the public engine API, and whether the
whole thing is deterministic enough to be replayed and diffed byte-for-byte. Read
`CONVENTIONS.md` (sections 4, 5, 6 and 10) before you write any code; everything below assumes it.

---

## 2. Substitution variables

| Variable       | Meaning                                                                                | Example                      |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| `{{LANGUAGE}}` | Implementation language slug for this run. One of `rust`, `go`, `cpp`, `python`, `ts`. | `rust`                       |
| `{{RUN_ID}}`   | Run identifier, `<model-slug>__<harness-variant>` (`CONVENTIONS.md` §3).               | `qwen3.6-27B__llama-harness` |

Every path below that contains `{{LANGUAGE}}` or `{{RUN_ID}}` is to be resolved with the values you
were given for this run before you touch the filesystem.

---

## 3. Workspace

All of your work goes in exactly one directory:

```
tui-games/solutions/{{RUN_ID}}/game-engine/{{LANGUAGE}}/
```

Resolved example for `{{RUN_ID}} = qwen3.6-27B__llama-harness`, `{{LANGUAGE}} = rust`:

```
tui-games/solutions/qwen3.6-27B__llama-harness/game-engine/rust/
```

Create it with `tools/new_workspace.sh {{RUN_ID}} game-engine {{LANGUAGE}}` if it does not exist,
and fill in `run.json` per `CONVENTIONS.md` §5. Write nothing outside this directory. In
particular, `tui-games/tasks/` is read-only reference material (`CONVENTIONS.md` §10).

The required layout inside the workspace:

```
build.sh  run.sh  test.sh  run.json
README.md  NOTES.md  ENGINE-API.md  PORTING-NOTES.md
engine/                     the engine unit: no game code, no game names
games/snake/                Snake, written only against the public engine API
games/tetris/               Tetris, written only against the public engine API
games/shared/               optional; only non-engine code both games need (§4.N4)
assets/sprites/*.sprite     sprite data, loaded through the engine resource loader
assets/levels/*.level       level/config data, loaded through the engine resource loader
scripts/*.txt               recorded headless input scripts
expected/*.json             the expected one-line summary for each recorded script
```

Language build files (`Cargo.toml`, `go.mod`, `CMakeLists.txt`, `package.json`, `pyproject.toml`,
…) go wherever your toolchain needs them, but the engine must be its own compilation/packaging unit
(crate, module, package, library target) that the games depend on — not a set of files the games
happen to `#include` or copy.

If earlier rungs of this ladder exist in this repository
(`tui-games/solutions/{{RUN_ID}}/snake/{{LANGUAGE}}/` and
`tui-games/solutions/{{RUN_ID}}/tetris/{{LANGUAGE}}/`), you may read them **as a reference for game
rules only**. Do not copy code out of them. The entire point of this task is that the engine API can express these games; pasted game
code proves nothing and will be scored as a failure of the architectural criterion.

---

## 4. Functional requirements

Each requirement is independently checkable. Implement all of them.

### 4.A Terminal backend

- **A1.** A terminal backend module owns raw mode, the alternate screen buffer, cursor visibility,
  and reading raw bytes from the tty. It exposes `enter()` / `leave()` and byte-level read/write. No
  other part of the engine talks to the tty directly.
- **A2.** Terminal state is restored on **every** exit path: normal return, error propagation,
  language-level panic/exception/abort, and `SIGINT` / `SIGTERM` / `SIGHUP`. Restoration means: leave
  alternate screen, show cursor, reset SGR (`ESC[0m`), disable raw mode. Restoration must be
  idempotent and safe to run twice.
- **A3.** The backend is abstracted behind an interface with at least two implementations: the real
  tty backend and a **headless backend** that reads input from a script and writes rendered output to
  an in-memory sink. Headless mode must never open the tty or require `isatty()`.
- **A4.** Terminal size is queried at startup and on `SIGWINCH`; a resize produces an engine event
  (`E4`) and forces a full redraw on the next frame.

### 4.B Renderer

- **B1.** A cell buffer is a `cols × rows` grid of cells. A cell is `{ glyph, fg, bg, attrs }` where
  `glyph` is one Unicode scalar value (plus an explicit continuation marker for the second column of
  a double-width glyph), `fg`/`bg` are colours (default, indexed 0–255, or 24-bit RGB), and `attrs`
  is a bitset over `bold, dim, italic, underline, reverse`.
- **B2.** The renderer holds two buffers (front = what the terminal shows, back = what the frame
  painted) and, on present, emits **only the differences**. Cells equal in both buffers must produce
  no output.
- **B3.** Diffing is per row. Within a row, consecutive changed cells are emitted as one run. A
  cursor-position sequence is emitted only when the next changed cell is not where the cursor already
  is; when the gap between two changed runs on the same row is smaller than the byte cost of a
  reposition, the renderer may bridge the gap by re-emitting the unchanged cells instead. Either
  choice is acceptable; emitting an unconditional reposition per cell is not.
- **B4.** SGR output is stateful: the renderer tracks the attributes currently in effect on the
  terminal and emits only the deltas. It must not prefix every cell with a full attribute reset.
- **B5.** A full-screen clear (`ESC[2J` or equivalent) may only be emitted on the first frame, after
  a resize, or on an explicit `force_redraw()`. Never once per frame.
- **B6.** The renderer exposes a byte counter (`bytes_written_last_frame`, `bytes_written_total`) and
  a switch that disables damage tracking (forcing full redraw), used by the benchmark in §4.M.
- **B7.** All writes for one frame are assembled into a single buffer and issued as one write to the
  sink. No per-cell syscalls.

### 4.C Scene / widget tree

- **C1.** A node has: a stable id, a rect `(x, y, w, h)` in parent coordinates, a `z` value, a
  `visible` flag, a `clip` flag, and an ordered list of children.
- **C2.** Painting is depth-first. Siblings are painted in ascending `z`; ties break on insertion
  order. Higher `z` therefore paints over lower `z`.
- **C3.** Clipping is cumulative: a node with `clip = true` intersects the active clip rect with its
  own rect for itself and its whole subtree. A draw call landing outside the active clip rect is
  silently discarded — never an error, never an out-of-bounds write, never a panic, including for
  negative coordinates and for rects larger than the terminal.
- **C4.** The engine ships at least these widgets, all game-agnostic: `Panel` (border style `none`,
  `ascii` — `+ - |` — or `unicode` — `┌ ┐ └ ┘ ─ │` — plus an optional title drawn on the top border),
  `Text` (wrap on/off, align left/center/right), `Canvas` (direct addressable cell access within its
  rect), `List` (items, selected index, scrolling viewport), and `Gauge` (a 0.0–1.0 bar filling
  `round(value × w)` of its `w` cells).
- **C5.** Widgets draw through a clipped drawing surface handed to them by the tree, not by writing
  to the cell buffer directly at absolute coordinates.

### 4.D Input

- **D1.** A decoder turns a raw byte stream into key events. It must handle, at minimum: printable
  ASCII; multi-byte UTF-8 scalars; `Ctrl+A`..`Ctrl+Z` (`0x01`..`0x1A`); `Enter` (`0x0D`), `Tab`
  (`0x09`), `Backspace` (`0x7F`), `Esc` (`0x1B`); arrows `ESC[A/B/C/D`; `Home`/`End` as `ESC[H`,
  `ESC[F`, `ESC[1~`, `ESC[4~`; `Insert` `ESC[2~`, `Delete` `ESC[3~`, `PageUp` `ESC[5~`, `PageDown`
  `ESC[6~`; `F1`–`F4` as `ESC O P/Q/R/S`; `F5`–`F12` as `ESC[15~`, `ESC[17~`, `ESC[18~`, `ESC[19~`,
  `ESC[20~`, `ESC[21~`, `ESC[23~`, `ESC[24~`; and `Alt+<key>` as an `ESC`-prefixed sequence.
- **D2.** A lone `ESC` is resolved as the `Esc` key when no further byte arrives within an escape
  timeout (default 25 ms) or when the following byte cannot begin a recognised sequence. An
  unrecognised escape sequence is consumed and dropped, never partially re-interpreted as printable
  text.
- **D3.** Mouse reporting and bracketed paste are explicitly out of scope. Do not implement them.
- **D4.** A `KeyMap` binds key events to **named actions** (strings or an enum). Games never switch
  on raw keys; they react to actions. Key maps are layered per scene: the top scene's map is
  consulted first, then maps below it in the stack, and an unbound key falls through.
- **D5.** Chords: a binding may be a sequence of two keys (e.g. `g` then `g`). A chord in progress
  times out after a configurable interval (default 500 ms), after which the buffered prefix is
  discarded. A prefix key that begins a chord must not also fire a single-key action.
- **D6.** Repeat: a binding may be marked repeatable. While the key is held (i.e. while the terminal
  keeps delivering it), the action fires once immediately, then after an initial delay (default
  250 ms) at a repeat interval (default 30 ms). Non-repeatable actions fire exactly once per press.
- **D7.** All four timing constants in D2, D5 and D6 are configurable at engine construction and are
  driven from the engine clock, so headless replay is unaffected by wall-clock speed.

### 4.E Game loop

- **E1.** Fixed-timestep update with an accumulator. Default update rate 60 Hz (`dt = 16.6667 ms`),
  configurable.
- **E2.** Catch-up is capped at 5 updates per frame; surplus accumulated time is discarded and
  counted as dropped updates (spiral-of-death guard).
- **E3.** Rendering happens at most once per frame and receives an interpolation alpha
  `alpha = accumulator / dt` in `[0, 1)`. At least one visible element in each game must actually use
  `alpha` for sub-tick smoothing (state it in `NOTES.md`).
- **E4.** Per frame the loop measures, in microseconds: input decode time, update time, render (paint
  + diff) time, and present (write) time. It exposes last, rolling mean over 60 frames, and p95 over
  120 frames for each.
- **E5.** Frame budgeting: the loop targets 60 fps (16.667 ms). After finishing a frame early it
  sleeps the remainder using a blocking primitive (a timed poll/select on the input fd, a timed
  condition wait, or a sleep). **Busy-wait spin loops are forbidden** — no `while now() < deadline {}`.
- **E6.** The engine clock is an injectable abstraction. In headless mode it is a virtual clock
  advanced deterministically by the replay driver, never the system clock.

### 4.F Event bus

- **F1.** Typed publish/subscribe. Subscribing returns a handle; the handle unsubscribes.
- **F2.** Delivery within one drain is FIFO by publish order; for one event, handlers run in
  subscription order.
- **F3.** Events published while the bus is draining are queued for the next drain — no re-entrant
  dispatch, no unbounded recursion. A drain processes at most 4096 events, then stops and records an
  overflow counter.
- **F4.** Engine-level events at minimum: `Resize`, `Key`, `Action`, `Quit`, `SceneChanged`,
  `Tick`. Games may define their own event types without engine changes.

### 4.G Entity-component store

- **G1.** Entity handles are generational: `(index, generation)`. A handle to a destroyed entity must
  be detectable as stale, and a recycled index must not resurrect an old handle.
- **G2.** Components are stored per type. Adding, replacing, getting and removing a component are all
  supported.
- **G3.** Queries iterate the entities that have a given set of components, in ascending entity index
  order. Iteration order must be deterministic and must not depend on hash-map ordering.
- **G4.** Entity destruction requested during an update is applied at the end of that update, so
  iteration is never invalidated mid-pass.

### 4.H Resource loader

- **H1.** A resource manager loads resources by logical name from a data root, caches them, and
  returns typed handles. Loading the same name twice must not re-read the file.
- **H2.** Sprite format (`*.sprite`), UTF-8 text:

  ```
  # comments start with '#' and blank lines are ignored
  name: snake-head
  size: 2x1
  palette: G=green
  palette: g=#2b7a2b,black,bold
  rows:
  GG
  ```

  - `size: <w>x<h>` and exactly `h` row lines of exactly `w` glyphs must follow `rows:`.
  - `palette: <ch>=<fg>[,<bg>[,<attrs>]]`, where a colour is a name (`black`, `red`, `green`,
    `yellow`, `blue`, `magenta`, `cyan`, `white`, `bright-black` … `bright-white`, `default`), `@N`
    for indexed 0–255, or `#RRGGBB`; `attrs` is a `+`-joined subset of
    `bold+dim+italic+underline+reverse`.
  - The space character is always transparent and needs no palette entry.
- **H3.** Level format (`*.level`), UTF-8 text: `#` comments, then `key: value` header lines, then a
  literal `grid:` line followed by the grid rows. Keys are lowercase identifiers; values are integers,
  `<int>,<int>` pairs, or bare tokens.
- **H4.** Malformed input is an error, not a crash: an unknown key, a duplicate key, a row of the
  wrong width, a glyph with no palette entry, a bad colour literal, or a missing file must produce an
  error value whose message contains the file name and the 1-based line number.
- **H5.** Required assets, all loaded through the loader at runtime (no hardcoded duplicates in game
  code): `assets/sprites/snake.sprite`, `assets/sprites/tetromino.sprite`,
  `assets/levels/snake-classic.level`, `assets/levels/tetris-standard.level`. The level files are the
  source of truth for the board geometry and timing constants given in §4.J and §4.K.

### 4.I Tweens, audio seam, scene stack, capabilities, debug overlay

- **I1.** Tween: animates a scalar from `a` to `b` over a duration in engine ticks, with easing,
  a mode (`once`, `loop`, `ping-pong`), a `value()` accessor and an on-complete callback. Required
  easings, with `t` normalised to `[0,1]`:
  - `linear`: `t`
  - `ease-in-quad`: `t²`
  - `ease-out-quad`: `1 − (1 − t)²`
  - `ease-in-out-cubic`: `4t³` for `t < 0.5`, else `1 − (−2t + 2)³ / 2`
- **I2.** A `Timeline` sequences tweens with per-entry start offsets and reports completion when all
  entries have completed. Tweens are advanced by the fixed update, never by the render.
- **I3.** Audio is an interface (`cue(name: string)`, `set_enabled(bool)`) with two implementations:
  `BellAudio` (emits `\a`) and `NullAudio` (does nothing). The backend is selected by configuration
  or the `TUIE_AUDIO=bell|null` environment variable, defaulting to `null` in headless mode. Games
  only ever call named cues; no game may write `\a` itself.
- **I4.** Scene stack: `push`, `pop`, `replace`, `top`. Only the top scene receives input. A scene
  declares `update_below` and `render_below`; a pause overlay uses `render_below = true`,
  `update_below = false`. Lifecycle callbacks fire in this order and are observable in tests:
  `on_enter`, `on_pause` (when something is pushed above), `on_resume` (when that is popped),
  `on_exit`.
- **I5.** Capability detection at startup: colour depth from `NO_COLOR` (→ `mono`), `COLORTERM`
  (`truecolor`/`24bit` → `truecolor`), then `TERM` (`*-256color*` → `256`, `dumb` → `mono`, otherwise
  `16`); Unicode support from `LC_ALL`/`LC_CTYPE`/`LANG` containing `UTF-8`/`utf8`
  (case-insensitive). Both are overridable by `TUIE_COLOR=truecolor|256|16|mono` and
  `TUIE_UNICODE=1|0`, which take precedence over detection.
- **I6.** Degradation is performed by the renderer, not by callers. A 24-bit colour is quantised to
  the target depth:
  - to 256: greys where `r == g == b` map to the 24-step ramp `232 + round(v * 23 / 255)` (with
    `v = r`), everything else to `16 + 36·round(r·5/255) + 6·round(g·5/255) + round(b·5/255)`;
  - to 16: nearest of the standard 16 ANSI colours by squared RGB distance, using the palette
    `#000000 #800000 #008000 #808000 #000080 #800080 #008080 #c0c0c0 #808080 #ff0000 #00ff00
    #ffff00 #0000ff #ff00ff #00ffff #ffffff`;
  - to mono: luminance `0.2126r + 0.7152g + 0.0722b` normalised to `[0,1]`; `≥ 0.5` renders as
    default foreground, `< 0.5` as `reverse`. No colour SGR codes may be emitted in mono mode.
- **I7.** When Unicode is unavailable, glyphs are substituted by an engine table, at minimum:
  `─ → -`, `│ → |`, `┌ ┐ └ ┘ → +`, `├ ┤ ┬ ┴ ┼ → +`, `█ → #`, `▓ ▒ ░ → #`, `● → o`, `▲ → ^`,
  `▼ → v`, `◄ → <`, `► → >`. Any glyph outside ASCII with no table entry becomes `?`.
- **I8.** Debug overlay: an engine widget toggled by the action `debug.toggle` (bound to `F3`),
  drawn above everything at the highest `z`. It shows: instantaneous fps; last / mean / p95 frame
  time in ms split into input, update, render and present; dropped updates (E2); live entity count;
  events published and delivered in the last drain; bytes written by the last present; and a
  60-sample frame-time sparkline. It must live in `engine/` and must be usable by both games with no
  game-side code beyond binding the action.

### 4.J Game one — Snake

Implemented in `games/snake/`, purely against the public engine API. Geometry and timing come from
`assets/levels/snake-classic.level`, whose values are fixed as:

```
cols: 20
rows: 12
step_updates: 8
start: 5,6
start_dir: R
start_len: 3
food: 14,6
```

- **J0.** Initialisation completes **before** the first fixed update: the level file is loaded and
  the snake, direction, food, score, status and the step counter are set to the values above. A
  script that runs no updates therefore reports that initial state, with `ticks: 0` and `steps: 0`.
- **J1.** Board is `cols × rows`, coordinates `(x, y)` with `(0,0)` top-left. There are no interior
  walls; leaving the board is death.
- **J2.** The snake is stored head-first. At start: head `(5,6)`, body `(4,6)`, `(3,6)`, direction
  `R`. The first food is at `(14,6)` — fixed, not random.
- **J3.** A **step** happens on every `step_updates`-th fixed update: a counter starts at 0, is
  incremented at each update, and when it equals `step_updates` the snake steps and the counter
  resets to 0. So with `step_updates: 8` the first step occurs on update 8.
- **J4.** A step moves the head one cell in the current direction. If the head leaves the board, the
  status becomes `dead` and no further steps occur. Otherwise, if the head cell holds food, the score
  increases by 10, the snake grows (the tail is not removed this step) and a new food is spawned
  (J6); if not, the tail cell is vacated before self-collision is tested, so moving into the current
  tail cell is legal.
- **J5.** Self-collision after the tail move is death. A step that ends in death — by J4's board
  test or by this one — is itself counted in `steps`, and the update it happened in is counted in
  `ticks`; no update after that counts.
- **J6.** Food spawn: enumerate all cells not occupied by the snake in row-major order (`y` outer,
  `x` inner) into a list of length `n`; the new food is at index `rand_below(n)` using the RNG in
  §4.L. If `n == 0` the status becomes `won`.
- **J7.** Direction input applies to the next step. An input that exactly reverses the current
  direction is ignored. Multiple direction inputs between two steps: the last non-reversing one wins,
  where "reversing" is judged against the direction actually in effect at the last step.
- **J8.** Actions: `move.up`, `move.down`, `move.left`, `move.right`, `pause`, `quit`, `restart`,
  `debug.toggle`. Bindings: `Up`/`w` → `move.up`; `Down`/`s` → `move.down`; `Left`/`a` →
  `move.left`; `Right`/`d` → `move.right`; `p` → `pause`; `q` → `quit`; `r` → `restart`; `F3` →
  `debug.toggle`.
- **J9.** `pause` pushes a pause overlay scene; while paused, updates do not advance the simulation
  and do not increment the tick counter. `pause` again pops it. `quit` requests exit.
- **J10.** Action timing, which fixes the tick accounting exactly: queued keys are consumed at the
  start of the update that processes them, **before** that update's simulation. An update that begins
  by pausing is therefore a paused update and is not counted; an update that begins by unpausing is
  counted. Worked example: `TICK 8`, `KEY p`, `TICK 40`, `KEY p`, `TICK 8` must report `ticks: 16`
  and `steps: 2`. The same rule applies to Tetris.

### 4.K Game two — Tetris

Implemented in `games/tetris/`, purely against the public engine API. Geometry and timing come from
`assets/levels/tetris-standard.level`, whose values are fixed as:

```
cols: 10
rows: 20
gravity_base: 30
```

- **K0.** Initialisation completes **before** the first fixed update: the level file is loaded, the
  first bag is shuffled (K9), the active piece is spawned (K5) and the queue is filled. A script that
  runs no updates therefore reports that initial state, with `ticks: 0`, `score: 0`, `lines: 0`,
  `level: 0`, `status: "playing"`, `hold: null`, `hold_used: false` and an empty board.
- **K1.** Playfield is 10 wide, 20 tall. `(0,0)` is top-left.
- **K2.** Piece kinds are `I J L O S T Z`, each defined in a square bounding box of size `N` at
  rotation state 0 (`N = 4` for `I`, `2` for `O`, `3` for the rest):

  ```
  I (4x4)   J (3x3)   L (3x3)   O (2x2)   S (3x3)   T (3x3)   Z (3x3)
  ....      J..       ..L       OO        .SS       .T.       ZZ.
  IIII      JJJ       LLL       OO        SS.       TTT       .ZZ
  ....      ...       ...                 ...       ...       ...
  ....
  ```

- **K3.** Rotation is a rotation of the bounding box. Clockwise maps box cell `(col c, row r)` to
  `(col N−1−r, row c)`; counter-clockwise is its inverse. Rotation states are numbered `0..3`, `0`
  being spawn state, increasing clockwise.
- **K4.** Kicks: on rotation, try box offsets in this exact order: `(0,0)`, `(−1,0)`, `(+1,0)`,
  `(0,−1)`, `(−2,0)`, `(+2,0)`. The first offset at which every filled cell is inside the playfield
  horizontally, not below the floor, and not overlapping a locked cell is taken. If none fits, the
  rotation is refused and nothing changes.
- **K5.** Spawn: the bounding box top-left goes to `x = floor((10 − N) / 2)` (so `x = 3` for `I` and
  the 3×3 pieces, `x = 4` for `O`), `y = 0`, rotation `0`. If any filled cell of the spawned piece
  overlaps a locked cell, the status becomes `over` immediately and the piece is still reported in
  the summary.
- **K6.** Gravity: `level = min(9, floor(lines / 10))`, `gravity_ticks = max(1, gravity_base − 3 ×
  level)`. A counter increments each non-paused fixed update; when it reaches `gravity_ticks` it
  resets and the piece attempts to move down one row. If that move is blocked, the piece **locks
  immediately** at the current position. There is no lock delay. Soft-dropping does not reset the
  gravity counter.
- **K7.** On lock: write the piece cells into the board as its kind letter, clear any full rows
  (rows above shift down by the number of rows cleared), update `lines`, award score, reset the hold
  lock (K10), and spawn the next piece from the queue.
- **K8.** Scoring: line clears award `[0, 100, 300, 500, 800][n] × (level + 1)` where `level` is
  computed **before** adding the cleared lines. Each successful soft-drop move awards 1. A hard drop
  awards 2 per row dropped and locks the piece immediately, without waiting for a gravity step.
- **K9.** Piece supply: 7-bags feeding one FIFO queue. The bag base order is `I J L O S T Z`; it is
  shuffled by Fisher-Yates using the RNG in §4.L — `for i = 6 down to 1: j = rand_below(i + 1);
  swap(bag[i], bag[j])` — and appended to the queue in shuffled order. The queue is seeded at K0 with
  one shuffled bag. Taking a piece pops the front; immediately after any pop, if fewer than 3 kinds
  remain, exactly one freshly shuffled bag is appended. `next` is therefore always the 3 kinds at the
  front of the queue, and the first four kinds of a run — the spawned piece plus `next` — are four
  distinct kinds from one bag.
- **K10.** Hold: `hold` swaps the active piece with the held piece (taking from the queue if the hold
  slot is empty). The incoming piece is placed at its spawn position and rotation. Hold may be used
  at most once per piece; the restriction lifts when a piece locks.
- **K11.** Actions: `left`, `right`, `soft_drop`, `hard_drop`, `rot_cw`, `rot_ccw`, `hold`, `pause`,
  `quit`, `restart`, `debug.toggle`. Bindings: `Left`/`a` → `left`; `Right`/`d` → `right`; `Down`/`s`
  → `soft_drop`; `Space` → `hard_drop`; `Up`/`x` → `rot_cw`; `z` → `rot_ccw`; `c` → `hold`; `p` →
  `pause`; `q` → `quit`; `r` → `restart`; `F3` → `debug.toggle`. `left`, `right` and `soft_drop` are
  repeatable bindings (D6).
- **K12.** `pause` behaves as in J9.

### 4.L Determinism and the RNG

- **L1.** All randomness in both games comes from one engine-provided PRNG, seeded from `--seed`.
  The algorithm is fixed so that every language produces the same stream:

  ```
  state: unsigned 32-bit
  seed_rng(s):  state = (s == 0) ? 0x9E3779B9 : (s & 0xFFFFFFFF)
  next_u32():   x = state
                x ^= (x << 13);  x &= 0xFFFFFFFF
                x ^= (x >> 17)
                x ^= (x << 5);   x &= 0xFFFFFFFF
                state = x
                return x
  rand_below(n): return next_u32() % n      # n > 0
  ```

  Conformance vector: with `seed = 1`, the first five `next_u32()` values are exactly
  `270369`, `67634689`, `2647435461`, `307599695`, `2398689233`. If your implementation does not
  reproduce these, your arithmetic is wrong — check that every shift is masked back to 32 bits and
  that `>>` is a logical shift.

- **L2.** The PRNG is consumed only where these rules say it is: Snake food respawn (J6) and Tetris
  bag shuffles (K9). Nothing else — not animation, not the menu, not the debug overlay — may draw
  from it, and no game may use a language built-in RNG or a hash-map iteration order for logic.
- **L3.** Consequence, and a scored requirement: **for the same seed and the same input script, the
  headless summary must be byte-identical across repeated runs and across languages.**

### 4.M Renderer benchmark

- **M1.** `./run.sh --bench-render` runs a fixed synthetic workload and prints exactly one line of
  compact JSON to stdout, then exits 0.
- **M2.** The workload, exactly: an 80×24 buffer; 600 frames; on every frame the whole scene is
  repainted from scratch (a bordered `Panel` filling the screen, a static 8-line text block at
  `(2,2)`, a 3-cell horizontal sprite at `(f mod 70, 8)` where `f` is the 0-based frame index, and a
  status line at row 22 reading `frame ` followed by `f` zero-padded to 6 digits). Only the sprite
  and the status line differ between consecutive frames.
- **M3.** Two totals are measured with the *same* emitter over the *same* painted frames:
  `full_redraw_bytes` with damage tracking disabled (B6), and `damage_bytes` with it enabled. Frame
  0 is a full paint in both cases.
- **M4.** Output shape, keys in this exact order:

  ```
  {"bench":"render","frames":600,"cols":80,"rows":24,"full_redraw_bytes":N,"damage_bytes":M,"ratio":R,"elapsed_ms":E}
  ```

  `ratio` is `damage_bytes / full_redraw_bytes` rounded to 4 decimal places.
- **M5.** Required thresholds: `ratio ≤ 0.25`, both byte counters `> 0`, and `elapsed_ms ≤ 10000`
  (600 frames of paint + diff + emit within a 60 fps budget). `test.sh` asserts all of these.

### 4.N The architectural constraint — pass/fail

- **N1.** No file under `engine/` may import, reference, or name anything belonging to either game.
  The mechanical check is exactly `grep -rniE 'snake|tetris|tetromino' engine/`, which must produce
  no matches. (Those strings may of course appear in the games' own code and asset files.) The same
  rule covers game vocabulary wearing a generic name: no type, field, constant or table under
  `engine/` may enumerate the seven piece kinds `I J L O S T Z`, hold a piece shape or kick table,
  model food or a snake body, or carry a line-clear score table. That half is checked by reading the
  engine's public types, not by grep.
- **N2.** `./build.sh --engine-only` and `./test.sh --engine-only` must succeed in a tree from which
  `games/` and `assets/` have been deleted. The engine's own tests may not depend on any game asset.
- **N3.** Each game may use only the public engine API documented in `ENGINE-API.md`. No reaching
  into engine internals, no editing engine files to special-case a game, no copies of engine source
  under `games/`.
- **N4.** Anything shared by the two games that is *not* engine-general (score formatting, a "press
  any key" screen, the menu scene) goes either in the game that needs it or in `games/shared/`, never
  in `engine/`. If `games/shared/` exists, `NOTES.md` lists what it holds and why each item is not
  engine-general.

### 4.O Engine test suite

- **O1.** The engine has its own test suite, runnable in isolation by `./test.sh --engine-only`,
  using the language's standard test runner.
- **O2.** At minimum, named test cases covering: renderer diff minimality (a one-cell change on an
  otherwise identical frame emits fewer than 32 bytes); no full-screen clear after the first frame;
  SGR delta emission; clipping of out-of-bounds and negative-coordinate draws; z-order painting;
  input decode for every sequence listed in D1; lone-`ESC` timeout; chord timeout; repeat timing;
  fixed-timestep catch-up cap; event-bus FIFO order and no re-entrancy; ECS stale-handle detection
  and deterministic query order; deferred destruction; resource-loader success and each error class
  in H4; tween easing values at `t = 0, 0.5, 1`; scene lifecycle callback order; colour quantisation
  for a table of known RGB inputs at each depth; and the Unicode fallback table.
- **O3.** The suite must contain at least 30 assertions in total and must not require a tty.

---

## 5. Technical constraints

1. **No game engine, TUI framework, or curses-style widget library.** Forbidden as dependencies:
   ncurses/PDCurses, tui-rs/ratatui, crossterm's event/widget layers, bubbletea/lipgloss/tcell,
   blessed, ink, prompt-toolkit, textual, urwid, FTXUI, notcurses, SDL, and anything equivalent. You
   are building this layer; importing it defeats the task.
2. Raw mode may be obtained from platform primitives (`termios` via the standard library or a direct
   syscall/FFI binding) **or** a thin terminal-primitives library that does nothing but raw mode,
   size query and signal plumbing (e.g. Python's stdlib `termios`/`tty`, Go's
   `golang.org/x/term`, Rust's `libc`/`nix`, Node's `process.stdin.setRawMode`). Escape sequence
   generation, parsing, buffering, diffing and layout must be your code. Declare every dependency and
   why it qualifies in `NOTES.md`.
3. Terminal state must be restored on every exit path (A2). A run that leaves the terminal in raw
   mode or on the alternate screen is a failure regardless of anything else.
4. No busy-wait loops anywhere (E5).
5. 60 fps render budget: the frame pipeline (input decode + update + paint + diff + emit) must fit in
   16.7 ms on the benchmark workload, evidenced by `--bench-render`'s `elapsed_ms`.
6. No network access at build time or run time. Vendor or avoid dependencies; the build must succeed
   offline.
7. No unbounded memory growth: buffers, event queues and metric ring buffers are fixed-capacity or
   explicitly bounded.
8. Scripts follow `CONVENTIONS.md` §6: executable, `#!/usr/bin/env bash`, `set -euo pipefail`,
   invoked with the language folder as the working directory, no absolute paths.
9. In headless mode, **stdout carries the summary line and nothing else.** All logging, timing and
   diagnostics go to stderr.

---

## 6. The headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven without a terminal.
Every solution in this category must therefore support:

```
./run.sh --headless --script <path> --seed <n>    # replay an input script, print one JSON summary line
./run.sh --selftest                               # built-in invariant checks, non-zero exit on failure
```

and this task adds:

```
./run.sh                                          # interactive; starts at the menu scene
./run.sh --game <snake|tetris>                    # interactive; starts in that game
./run.sh --headless --script <path> --seed <n> [--game <snake|tetris>]
./run.sh --engine-selftest                        # engine-only invariants; works with games/ deleted
./run.sh --bench-render                           # §4.M benchmark line
./run.sh --capabilities                           # one JSON line describing detected capabilities
./build.sh [--engine-only]
./test.sh  [--engine-only]
```

`--game` defaults to `snake` when omitted, so the two-argument form above stays literally valid.

**Given the same seed and the same input script, the JSON summary must be byte-identical across
runs** — and, per L3, across languages.

### 6.1 Input script format

UTF-8 text, newline-delimited, one command per line. Blank lines and lines whose first non-space
character is `#` are ignored. Leading and trailing spaces are ignored. Commands:

| Command                | Meaning                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KEY <name>`           | Enqueue one key press. Names: `up`, `down`, `left`, `right`, `space`, `enter`, `esc`, `tab`, `backspace`, `home`, `end`, `pgup`, `pgdn`, `ins`, `del`, `f1`..`f12`, `ctrl-<char>`, `alt-<char>`, or a single printable character. |
| `TICK [n]`             | Advance the virtual clock by `n` fixed updates (default 1) and run the loop for each. `n` is a non-negative integer; `TICK 0` is legal and runs no updates. Queued keys are consumed at the start of the next update.             |
| `RESIZE <cols> <rows>` | Deliver a resize event with the new size.                                                                                                                                                                                         |
| `QUIT`                 | Deliver the quit request, as if `quit` had been actioned.                                                                                                                                                                         |

Note the deliberate difference from earlier rungs of this ladder: because this task runs two games
through one generic input layer, scripts speak in **key presses and fixed updates**, not in
game-specific tokens. `TICK` here is one *fixed update* (§4.E1), not one snake step — a snake step is
every 8th of them (§4.J3). Scripts and `expected/` files from earlier tasks are therefore not
portable into this one; write fresh ones.

Unknown commands, and a `TICK` argument that is not a non-negative integer, are a hard error: exit
non-zero with a message on stderr naming the line number. After the last line, the program exits and
prints the summary.

Once the game reaches a terminal status (`dead`, `won`, `over`) or quits, the rest of the script is
still parsed for validity but nothing further happens: `TICK` runs no updates, the tick counter stops
advancing, and queued keys are never consumed — so `restart` cannot be triggered from a headless
script after a terminal status. The summary reports the terminal state.

### 6.2 Summary format

Exactly one line of compact JSON on stdout, terminated by a single `\n`: no whitespace outside
strings, no trailing content, keys in exactly the order given, all numbers integers (except `ratio`
in the benchmark line), booleans as `true`/`false`, absent values as `null`.

**Snake:**

```
{"game":"snake","seed":<int>,"ticks":<int>,"steps":<int>,"status":"alive|dead|won","paused":<bool>,"score":<int>,"length":<int>,"head":[<x>,<y>],"dir":"U|D|L|R","food":[<x>,<y>]|null,"board":"<rows>"}
```

- `seed` — the `--seed` value exactly as given on the command line.
- `ticks` — fixed updates in which the simulation advanced: paused updates and updates after a
  terminal status are excluded.
- `steps` — snake moves performed, including a final step that ended in death (J5).
- `paused` — whether the pause overlay is on top of the scene stack when the script ends.
- `score` — 10 per food eaten. `length` — occupied snake cells. `head` — `[x, y]` of the head.
- `dir` — the direction in effect at the last step, or the level's `start_dir` if no step has
  happened.
- `food` — `[x, y]`, or `null` only when the board is full (J6).
- `board` — 12 rows of 20 characters joined by `/`, using `.` empty, `H` head, `o` body, `*` food:
  251 characters.

**Tetris:**

```
{"game":"tetris","seed":<int>,"ticks":<int>,"status":"playing|over","paused":<bool>,"score":<int>,"lines":<int>,"level":<int>,"piece":{"kind":"<K>","rot":<0-3>,"x":<int>,"y":<int>}|null,"hold":"<K>"|null,"hold_used":<bool>,"next":["<K>","<K>","<K>"],"board":"<rows>"}
```

- `seed`, `ticks`, `paused` — as above.
- `score`, `lines`, `level` — per K8 and K6.
- `piece` — the active piece: kind letter, rotation state, and bounding-box top-left in board
  coordinates. The active piece is **not** drawn into `board`. On `over` the offending spawned piece
  is still reported (K5), so `piece` is non-null in every summary these rules can produce.
- `hold` — the held kind, or `null` if nothing is held. `hold_used` — whether hold has already been
  consumed for the active piece (K10).
- `next` — exactly the 3 kinds at the front of the piece queue (K9).
- `board` — 20 rows of 10 characters joined by `/`, using `.` for empty and the kind letter for a
  locked cell: 219 characters.

### 6.3 `--selftest`

Runs built-in invariant checks and exits non-zero on the first failure, printing the failing check's
name to stderr. It must cover at least: terminal restore is idempotent; the renderer emits nothing
for an unchanged frame; clipping rejects out-of-bounds writes without error; the fixed-timestep
accumulator never advances more than the catch-up cap; the event bus does not dispatch re-entrantly;
stale ECS handles are rejected; every required asset loads and validates; snake board invariants
(length equals the number of body cells, no duplicate cells, food never under the snake); tetris
board invariants (no floating full rows after a clear, the active piece never overlaps a locked
cell, `next` always holds 3 kinds); and that the RNG produces the documented first five values for
seed 1 (record them in `NOTES.md`).

### 6.4 `--capabilities`

One compact JSON line, keys in this order:

```
{"color":"truecolor|256|16|mono","unicode":<bool>,"cols":<int>,"rows":<int>,"term":"<TERM or empty>"}
```

It must honour `TUIE_COLOR`, `TUIE_UNICODE`, `NO_COLOR`, `COLORTERM` and `TERM` per I5, and must work
with stdout redirected to a file.

### 6.5 Recorded scripts and `test.sh`

Ship at least these recorded scripts with matching expected summaries:

| Script                     | Seed | What it must exercise                                               |
| -------------------------- | ---- | ------------------------------------------------------------------- |
| `scripts/snake-basic.txt`  | 1    | Movement with no food eaten.                                        |
| `scripts/snake-eat.txt`    | 1    | At least two food pickups, hence at least two RNG draws.            |
| `scripts/snake-death.txt`  | 1    | A wall or self collision, terminating in `dead`.                    |
| `scripts/snake-pause.txt`  | 1    | A pause/resume cycle proving paused updates do not advance `ticks`. |
| `scripts/tetris-basic.txt` | 7    | Movement, rotation with at least one kick, and a hard drop.         |
| `scripts/tetris-clear.txt` | 7    | At least one completed line clear with the correct score.           |
| `scripts/tetris-hold.txt`  | 7    | A hold, and a second hold attempt on the same piece being refused.  |

Each script `scripts/<name>.txt` has its expected output in `expected/<name>.json` — the exact
summary line. `test.sh` must, at minimum:

1. run every recorded script and compare stdout byte-for-byte with the expected file;
2. re-run one script and confirm the two outputs are identical;
3. run `--selftest` and `--engine-selftest` and require exit 0;
4. run the engine unit tests;
5. run `--bench-render` and assert the §4.M5 thresholds;
6. assert §4.N1 mechanically (grep `engine/` for game names) and fail if it matches.

`test.sh` exits 0 only if all of that passes.

---

## 7. Required deliverables

| Path                                | Content                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/`                           | The engine, its public API, and its test suite. No game names anywhere.                                                                                                                                                                                                                            |
| `games/snake/`                      | Snake per §4.J, engine API only.                                                                                                                                                                                                                                                                   |
| `games/tetris/`                     | Tetris per §4.K, engine API only.                                                                                                                                                                                                                                                                  |
| `assets/sprites/`, `assets/levels/` | The four assets in H5, in the documented formats.                                                                                                                                                                                                                                                  |
| `scripts/`, `expected/`             | The seven recorded scripts and their expected summary lines.                                                                                                                                                                                                                                       |
| `build.sh`                          | Builds everything; `--engine-only` builds just the engine. No network.                                                                                                                                                                                                                             |
| `run.sh`                            | All modes in §6.                                                                                                                                                                                                                                                                                   |
| `test.sh`                           | The six checks in §6.5; `--engine-only` runs only the engine suite.                                                                                                                                                                                                                                |
| `README.md`                         | How to build, run and play both games; the key bindings; how to run the headless modes and the benchmark.                                                                                                                                                                                          |
| `NOTES.md`                          | Design decisions, dependency justification (constraint 2), where interpolation `alpha` is actually used (E3), the first five RNG values for seed 1, known limitations, and anything you could not finish.                                                                                          |
| `ENGINE-API.md`                     | Reference for the **public** engine API: every type and function a game may use, grouped by subsystem, each with a signature, a one-line description, and the ownership/lifetime rules. It must be complete enough that a third game could be written from it without reading engine source.       |
| `PORTING-NOTES.md`                  | An honest account of what porting the two games exposed: which API calls turned out to be missing, wrong, or awkward in your first design; what you changed in response; and which awkwardnesses you knowingly left. Name specific APIs and specific call sites. A generic essay scores zero here. |
| `run.json`                          | Per `CONVENTIONS.md` §5, with `self_reported_status` set honestly.                                                                                                                                                                                                                                 |

---

## 8. Definition of done

Verify each of these yourself before declaring completion.

- [ ] Everything lives under `tui-games/solutions/{{RUN_ID}}/game-engine/{{LANGUAGE}}/`; nothing outside it was created or modified.
- [ ] `build.sh`, `run.sh`, `test.sh` exist, are executable, start with `#!/usr/bin/env bash` and `set -euo pipefail`, and work from the language folder with no absolute paths.
- [ ] `./build.sh` succeeds offline from a clean checkout.
- [ ] `./build.sh --engine-only` and `./test.sh --engine-only` succeed in a copy of the tree with `games/` and `assets/` deleted.
- [ ] A case-insensitive grep of `engine/` for `snake`, `tetris`, `tetromino` returns nothing.
- [ ] No forbidden dependency (constraint 1) appears in any manifest or lock file; every dependency is justified in `NOTES.md`.
- [ ] `./run.sh --game snake` and `./run.sh --game tetris` are playable in a real terminal, and both restore the terminal on quit, on `Ctrl+C`, and on a forced panic.
- [ ] `./run.sh --headless --script scripts/snake-basic.txt --seed 1` prints exactly one JSON line matching `expected/snake-basic.json` byte-for-byte, and nothing else on stdout.
- [ ] The same holds for all seven recorded scripts.
- [ ] Running any script twice produces identical bytes.
- [ ] `./run.sh --selftest` and `./run.sh --engine-selftest` exit 0 and cover every check in §6.3.
- [ ] `./run.sh --capabilities` reflects `TUIE_COLOR`, `TUIE_UNICODE` and `NO_COLOR` overrides.
- [ ] `./run.sh --bench-render` prints the §4.M4 line with `ratio ≤ 0.25` and `elapsed_ms ≤ 10000`.
- [ ] The engine test suite has at least 30 assertions and covers every item in O2.
- [ ] Every engine subsystem in §4.A–§4.I is implemented, not stubbed; anything reduced in scope is stated explicitly in `NOTES.md`.
- [ ] Snake obeys §4.J exactly, including the fixed first food at `(14,6)` and the row-major free-cell spawn rule.
- [ ] Tetris obeys §4.K exactly, including the kick order, the 7-bag shuffle, the scoring table, and immediate lock with no lock delay.
- [ ] Neither game reads a raw key directly; both go through the `KeyMap` action layer.
- [ ] No busy-wait loop exists anywhere in the codebase.
- [ ] `ENGINE-API.md` documents every public entry point a game uses; `PORTING-NOTES.md` names specific APIs that changed during the port.
- [ ] `run.json` is filled in per `CONVENTIONS.md` §5.
- [ ] `./test.sh` exits 0.

---

## 9. Scoring rubric

Total 100 points.

| #   | Criterion                                    | Weight | What earns the points                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Architectural separation                     | 20     | `engine/` contains no game reference (N1); the engine builds and tests standalone with `games/` deleted (N2); both games are written purely against the documented public API (N3); nothing game-specific has leaked into engine abstractions (N4).                                            |
| 2   | Engine subsystem completeness and quality    | 25     | All of §4.A–§4.I present and functional, not stubbed. Renderer diffing, clipping/z-order, input decode/chord/repeat, fixed timestep with catch-up cap, event bus, ECS, resource loader, tweens, audio seam, scene stack, capability degradation and debug overlay each carry roughly 2 points. |
| 3   | Headless determinism and summary correctness | 15     | Exact JSON shape and key order for both games; identical bytes on repeat runs; scripts and expected files present and matching; stdout clean; `--selftest` and `--engine-selftest` meaningful and passing.                                                                                     |
| 4   | Game correctness                             | 15     | Snake per §4.J and Tetris per §4.K, judged against the stated rules — spawn positions, kick order, bag shuffle, scoring table, pause semantics, tick accounting. Roughly 7.5 each.                                                                                                             |
| 5   | Renderer efficiency                          | 10     | `--bench-render` present and honest; `ratio ≤ 0.25` (full marks at `≤ 0.10`); `elapsed_ms ≤ 10000`; no full-screen clear after frame 0; single write per frame.                                                                                                                                |
| 6   | Engine test suite                            | 8      | Independently runnable, ≥ 30 assertions, covers every item in O2, no tty required, tests that actually fail when the behaviour is broken.                                                                                                                                                      |
| 7   | Documentation                                | 7      | `ENGINE-API.md` complete enough to write a third game from; `PORTING-NOTES.md` specific and self-critical; `README.md` and `NOTES.md` accurate, including the dependency justification.                                                                                                        |

**Gate.** Criterion 1 is pass/fail before it is scored. If `engine/` references either game, or the
engine cannot build and test with `games/` removed, criterion 1 scores 0 and the total is capped at
60 regardless of the other criteria. A submission whose two games share an engine only nominally —
by putting game logic in the engine, or by parameterising an engine type on game concepts — is
exactly the failure mode this task exists to detect.

**Partial credit.** A working engine with one complete game and one partial game scores better than
two games glued together with no engine. Say plainly in `NOTES.md` what is incomplete; an accurate
`self_reported_status` of `partial` costs nothing, while a false `complete` is itself a measured
signal.
