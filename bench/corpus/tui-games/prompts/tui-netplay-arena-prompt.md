# TUI task 7 of 8 — `netplay-arena` (size XL)

## 1. Objective

Build a networked, real-time, server-authoritative multiplayer arena game that runs entirely in the
terminal: one headless authoritative server simulating a 64x24 tile arena at a fixed 50 Hz tick, and
TUI clients for 2 to 8 players who move, aim, and shoot projectiles at each other across a documented
binary wire protocol. The game itself is deliberately small — eight-way movement, one weapon, walls,
respawns, a round timer, and a scoreboard — because this task measures distributed-systems
engineering, not game design. What is being graded is the network stack: a versioned handshake over
length-prefixed frames, client-side prediction with server reconciliation and input replay, entity
interpolation for remote players, lag-compensated hit detection, delta-encoded snapshots that keep
bandwidth bounded, and correct behaviour under packet loss, reordering, duplication, and
disconnect/reconnect. You must ship a network simulator that injects configurable latency, jitter,
and loss; the game must stay playable and consistent at 150 ms RTT with 5% loss, and you must prove
it with a headless soak test that asserts every client converges to a world state identical to the
server's.

Read `CONVENTIONS.md` at the repository root before you write any code. It defines run IDs, the
workspace layout, `run.json`, the `build.sh` / `run.sh` / `test.sh` contract, and how your work is
scored. This prompt does not restate it.

---

## 2. Substitution variables

| Variable       | Meaning                                                                | Example                      |
| -------------- | ---------------------------------------------------------------------- | ---------------------------- |
| `{{LANGUAGE}}` | Language slug for this run; one of `rust`, `go`, `cpp`, `python`, `ts` | `rust`                       |
| `{{RUN_ID}}`   | Run identifier, `<model-slug>__<harness-variant>`                      | `qwen3.6-27B__llama-harness` |

---

## 3. Workspace

Write everything under, and only under:

```
tui-games/solutions/{{RUN_ID}}/netplay-arena/{{LANGUAGE}}/
```

Resolved example for `{{RUN_ID}}` = `qwen3.6-27B__llama-harness`, `{{LANGUAGE}}` = `rust`:

```
tui-games/solutions/qwen3.6-27B__llama-harness/netplay-arena/rust/
```

The three scripts (`build.sh`, `run.sh`, `test.sh`) live at the root of that directory and are
invoked with that directory as the working directory. Nothing outside it may be created or modified.
Task material under `tui-games/tasks/` is read-only.

---

## 4. Functional requirements

Every requirement below is independently checkable. Numbers, tables, and formulas are normative: do
not substitute your own. Where a value is given in "units", it is a fixed-point world unit as defined
in 4.2.

### 4.1 Process modes and CLI surface

`run.sh` is the single entry point and dispatches on flags. All of these must work:

| Invocation                                                               | Behaviour                                                                                                                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./run.sh`                                                               | Local session: start a server on an ephemeral loopback port, join one interactive TUI client, and fill the arena with 3 bots. This is the "just play it" path. |
| `./run.sh --server --port <p> [--max-players <n>] [--round-ticks <n>]`   | Headless authoritative server only. Prints `listening: 127.0.0.1:<p>` to stderr and nothing to stdout.                                                         |
| `./run.sh --client --host <h> --port <p> [--name <s>]`                   | Interactive TUI client only.                                                                                                                                   |
| `./run.sh --bot --host <h> --port <p> --count <n> --seed <s>`            | Spawn `n` bot clients (4.17) in one process.                                                                                                                   |
| `./run.sh --headless --script <path> --seed <n>`                         | Deterministic scripted session; see section 6.                                                                                                                 |
| `./run.sh --soak --players <n> --ticks <t> --seed <s> [--netsim <spec>]` | Headless load/convergence run; see 4.19.                                                                                                                       |
| `./run.sh --selftest`                                                    | Built-in invariant checks; see section 6.                                                                                                                      |

`--max-players` defaults to 8 and must be clamped to `[2, 8]`. `--name` defaults to `p<id>` and is
truncated to 16 bytes of printable ASCII (0x20-0x7E); non-conforming bytes are replaced with `?`.

Two modifiers are accepted alongside any mode in the table and default to off: `--netsim <spec>`
applies the network simulator (4.18) to that process's transport, and `--no-lagcomp` disables lag
compensation (4.16). Both must be accepted by every mode, not only by `--soak`.

### 4.2 Coordinate system and the arena

- The arena is exactly 64 tiles wide by 24 tiles tall. One tile is 256 world units on a side.
  The world spans x in `[0, 16384)`, y in `[0, 6144)`.
- All simulation state is **integer**. Positions and velocities are signed 32-bit integers in world
  units. Floating point is forbidden anywhere in the simulation, the protocol codec, the network
  simulator, or the bot policy. It is permitted only for wall-clock timing, frame pacing, and
  rendering-time smoothing that never feeds back into simulation state.
- The tile containing a position is `(x >> 8, y >> 8)` using arithmetic shift.
- `+x` is east (right), `+y` is south (down). Aim is a byte `a` in `[0, 255]` measuring
  `a * 360 / 256` degrees clockwise on screen from east.
- The map is fixed and embedded in the binary as the following 24 rows of 64 characters. `#` is
  wall, `.` is floor, and the digits `0`-`7` are spawn points (they are floor tiles).

```
################################################################
#..............................................................#
#..............................................................#
#..0................##..........4...........................2..#
#.......######......##.........................................#
#.......######......##.........................................#
#...................##......############.......................#
#...................##......############................###....#
#...................##..................................###....#
#...................##......................###.........###....#
#.............................####..........###................#
#.............####............####..........######..........7..#
#..6..........######..........####............####.............#
#................###..........####.............................#
#....###.........###......................##...................#
#....###..................................##...................#
#....###................############......##...................#
#.......................############......##...................#
#.........................................##......######.......#
#.........................................##......######.......#
#..3...........................5..........##................1..#
#..............................................................#
#..............................................................#
################################################################
```

- `MAP_HASH` is the FNV-1a 32 hash (offset basis `0x811c9dc5`, prime `0x01000193`) over the 1536
  ASCII bytes formed by concatenating the 24 rows in order with no separators. It must equal
  `0x6d955427`. Compute it at startup and assert it; a mismatch is a hard error.
- Spawn point `k` is at the centre of its tile: `x = tile_x * 256 + 128`, `y = tile_y * 256 + 128`.

### 4.3 The direction table

Build, once at startup, two 256-entry signed integer tables:

```
DIR_X[a] = round_half_away_from_zero(256 * cos(2 * pi * a / 256))
DIR_Y[a] = round_half_away_from_zero(256 * sin(2 * pi * a / 256))
```

They may be hardcoded instead of computed. Either way they must be verified at startup: the FNV-1a 32
hash over the 1024 bytes formed by emitting, for `a` = 0..255 in order, `DIR_X[a]` then `DIR_Y[a]`
each as a little-endian signed 16-bit integer, must equal `0x43d19f4d`. Spot values:
`DIR[0] = (256, 0)`, `DIR[32] = (181, 181)`, `DIR[64] = (0, 256)`, `DIR[128] = (-256, 0)`,
`DIR[192] = (0, -256)`.

### 4.4 Simulation constants

| Constant                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `TICK_HZ`                 | 50 (tick period exactly 20000 microseconds)                            |
| `MOVE_STRAIGHT`           | 15 units/tick on the moving axis                                       |
| `MOVE_DIAGONAL`           | 11 units/tick on **each** axis when two perpendicular buttons are held |
| `PLAYER_RADIUS`           | 96 units                                                               |
| `PROJ_RADIUS`             | 24 units                                                               |
| `HIT_RADIUS`              | 120 units (`PLAYER_RADIUS + PROJ_RADIUS`)                              |
| `PROJ_SPEED`              | 60 units/tick                                                          |
| `PROJ_TTL`                | 100 ticks                                                              |
| `FIRE_COOLDOWN`           | 15 ticks                                                               |
| `DAMAGE`                  | 34                                                                     |
| `MAX_HEALTH`              | 100                                                                    |
| `RESPAWN_TICKS`           | 150                                                                    |
| `ROUND_TICKS`             | 9000 (180 s) unless overridden by `--round-ticks` or a script          |
| `SNAPSHOT_INTERVAL`       | 2 ticks (25 Hz)                                                        |
| `HISTORY_TICKS`           | 64 (server keeps this many past world states)                          |
| `MAX_REWIND_TICKS`        | 50                                                                     |
| `INPUT_REDUNDANCY`        | up to 12 commands per input packet                                     |
| `CLIENT_TIMEOUT_TICKS`    | 250 (5 s of silence drops a client to `zombie`)                        |
| `RECONNECT_GRACE_TICKS`   | 500 (10 s after which a zombie is destroyed)                           |
| `PREDICTION_BUFFER_TICKS` | 256                                                                    |

Opposing buttons cancel: holding `UP|DOWN` produces no vertical component, and if both axes cancel
the player does not move. Movement is applied only when the player state is `alive`.

### 4.5 Input model

A client command is exactly 2 bytes:

```
byte 0: buttons  bit0 UP  bit1 DOWN  bit2 LEFT  bit3 RIGHT  bit4 FIRE  bits5-7 reserved, must be 0
byte 1: aim      0..255 as defined in 4.2
```

One command is produced per simulation tick by every client, including ticks where nothing is held
(buttons = 0). Commands are numbered by the client tick they belong to.

Key bindings for the interactive TUI: `W`/`A`/`S`/`D` or arrow keys set the movement buttons for the
frame; `,` and `.` rotate aim by -4 and +4; `Space` sets FIRE; `Tab` toggles the scoreboard overlay;
`q` or `Ctrl-C` quits cleanly. A held key is a key seen down within the last 120 ms — terminals do
not deliver key-up, so you must implement this decay and document it in `NOTES.md`.

### 4.6 Simulation step order

The server, the client's prediction, and the soak harness must all call the **same** step function.
For tick `T`, in exactly this order:

1. `T := T + 1`.
2. For each player id in ascending order, if `state == alive`:
   a. Apply movement (4.7) using the command for tick `T`.
   b. Store the command's aim byte in the player.
   c. If `FIRE` is set and `fire_cooldown == 0`, spawn a projectile (4.8) and set
      `fire_cooldown := FIRE_COOLDOWN`.
3. For each player in ascending order: decrement `fire_cooldown` toward 0; if `state == dead`,
   decrement `respawn_timer` and, when it reaches 0, respawn (4.9).
4. Advance projectiles (4.8) in ascending entity id order and decrement each one's `ttl` by 1.
   Only projectiles that already existed at the start of the tick take part: one spawned by step 2c
   during this tick stays at its spawn position with its full `ttl` until tick `T + 1`.
5. Expire projectiles whose `ttl` reached 0.
6. Append the resulting world state to the server's 64-tick history ring.

### 4.7 Movement and wall collision

Movement is axis-separated and non-sliding:

1. Compute `dx`, `dy` from the buttons: a single axis gives `+/-MOVE_STRAIGHT`; two perpendicular
   axes give `+/-MOVE_DIAGONAL` on each.
2. Tentatively set `x' = x + dx`. If the player circle of radius `PLAYER_RADIUS` centred at
   `(x', y)` overlaps any wall tile, discard the change (`x' = x`).
3. Then tentatively set `y' = y + dy` and apply the same test at `(x', y')`; discard on overlap.

A circle at `(px, py)` overlaps wall tile `(tx, ty)` when the squared distance from `(px, py)` to the
closest point of the tile rectangle `[tx*256, tx*256+256] x [ty*256, ty*256+256]` is strictly less
than `PLAYER_RADIUS * PLAYER_RADIUS`. Test only the tiles overlapping the circle's bounding box.
Positions are additionally clamped so the circle stays inside the world rectangle.

### 4.8 Projectiles

- Spawn position: `x + DIR_X[a] * HIT_RADIUS / 256`, `y + DIR_Y[a] * HIT_RADIUS / 256`, using
  division that truncates toward zero, where `a` is the firing command's aim.
- Velocity: `vx = round_half_away_from_zero(DIR_X[a] * PROJ_SPEED / 256)`, likewise `vy`. Concretely
  `a = 0` gives `(60, 0)` and `a = 32` gives `(42, 42)`.
- Entity ids: players own entity ids equal to their player id, `0`-`7`. Projectiles are allocated
  from a counter starting at 8, incremented by 1 per spawn, wrapping back to 8 after 65535. Within a
  tick, allocation follows ascending firing player id.
- Each tick a projectile advances in **2 substeps** of `vx/2`, `vy/2` (truncating toward zero, with
  the second substep receiving the remainder so the two substeps sum exactly to `(vx, vy)`). After
  each substep, in order:
  1. If the projectile centre lies in a wall tile, or outside the world rectangle, destroy it.
  2. Otherwise test players in ascending id order, skipping the owner. A player is hit when the
     squared distance between the projectile centre and the player's **lag-compensated** position
     (4.16) is less than `HIT_RADIUS * HIT_RADIUS`, and that player is `alive` both at the
     compensation tick and now. The first hit resolves: apply damage, destroy the projectile, stop.
- `ttl` decrements once per tick, not per substep.
- Damage: `health -= DAMAGE`. At `health <= 0` the victim becomes `dead` with
  `respawn_timer = RESPAWN_TICKS`, `deaths += 1`, and the projectile owner gets `kills += 1` and
  `score += 1`. Score is never decremented. Self-damage is impossible because the owner is skipped.

### 4.9 Spawning

On join and on respawn, a player is placed at the spawn point maximising the minimum squared distance
to every currently `alive` player other than itself; ties are broken by the lowest spawn index. When
no other player is `alive`, every spawn point ties and spawn point `0` is used. The spawn point is
chosen before `state` is set to `alive`, so an arriving player never influences its own placement.
Reset `health` to `MAX_HEALTH`, `fire_cooldown` to 0, `state` to `alive`, and keep `score`, `kills`,
and `deaths`.

### 4.10 Round lifecycle

The server counts ticks from 1. At `tick == ROUND_TICKS` the round ends: no further input is
simulated, an `EVENT_ROUND_END` is broadcast reliably, and the terminating status is `round_complete`.
Clients render a final scoreboard sorted by `score` descending, then `kills` descending, then player
id ascending.

### 4.11 Wire protocol

The protocol is datagram-oriented and must run over two interchangeable transports selected at
runtime:

- `udp` — real UDP sockets bound to loopback only (`127.0.0.1`). This is the default for
  `--server`, `--client`, and `--bot`.
- `sim` — an in-process transport used by `--headless`, `--soak`, and `--selftest`. It moves frames
  between endpoints through the network simulator (4.18) on a virtual clock, with no OS sockets
  involved. Determinism of the headless modes depends on this.

Both transports carry the identical byte stream. All integers are little-endian; signed integers are
two's complement.

**Frame:**

```
offset  size  field
0       2     frame_len : u16   number of bytes that follow this field
2       N     body
```

One UDP datagram carries exactly one frame; a stream transport would carry frames back to back. A
frame with `frame_len` disagreeing with the remaining bytes is discarded, counted, and never fatal.

**Body header (10 bytes), present on every message:**

```
offset  size  field
0       1     proto_version : u8   = 0x01
1       1     msg_type      : u8
2       2     seq           : u16  sender's own packet sequence, wrapping
4       2     ack           : u16  highest sender-observed sequence from the peer
6       4     ack_bits      : u32  bit i set => sequence (ack - 1 - i) was also received
```

**Message types:**

| Value  | Name             | Direction | Payload                                                                                                                                                       |
| ------ | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x01` | `HELLO`          | C -> S    | `u8 client_proto`, `u32 client_nonce`, `u32 session_id` (0 for a fresh join, non-zero to resume), `u8 name_len`, `name_len` bytes of name                     |
| `0x02` | `WELCOME`        | S -> C    | `u8 player_id`, `u8 max_players`, `u16 tick_hz`, `u32 map_hash`, `u32 session_id`, `u32 server_tick`, `u8 resumed` (0 fresh, 1 resumed)                       |
| `0x03` | `REJECT`         | S -> C    | `u8 reason`, `u8 msg_len`, message bytes. Reasons: `1` version mismatch, `2` server full, `3` bad name, `4` unknown or expired session, `5` map hash mismatch |
| `0x04` | `INPUT`          | C -> S    | `u32 first_tick`, `u32 render_tick`, `u32 ack_snapshot_tick`, `u8 count`, then `count` 2-byte commands for ticks `first_tick .. first_tick + count - 1`       |
| `0x05` | `SNAPSHOT`       | S -> C    | see 4.13                                                                                                                                                      |
| `0x06` | `EVENT`          | S -> C    | `u32 event_seq` of the first event, `u8 count`, then `count` events, each `u8 kind`, `u8 len`, `len` payload bytes                                            |
| `0x07` | `EVENT_ACK`      | C -> S    | `u32 highest_contiguous_event_seq`                                                                                                                            |
| `0x08` | `PING`           | both      | `u32 ping_id`, `u64 send_time_us`                                                                                                                             |
| `0x09` | `PONG`           | both      | echo of the `PING` payload                                                                                                                                    |
| `0x0A` | `DISCONNECT`     | both      | `u8 reason` (`0` user quit, `1` timeout, `2` protocol error, `3` server shutdown)                                                                             |
| `0x0B` | `RESYNC_REQUEST` | C -> S    | no payload; asks for the next snapshot to be a full one                                                                                                       |

Event kinds: `1` player joined (`u8 id`, name), `2` player left (`u8 id`, `u8 reason`), `3` kill
(`u8 killer`, `u8 victim`), `4` round end (`u8 player_count`, then per player `u8 id`, `i16 score`),
`5` respawn (`u8 id`).

Rules:

- A body shorter than 10 bytes, an unknown `msg_type`, or a payload shorter than its fixed part is
  discarded and counted as `malformed`. It must never crash, panic, or disconnect a healthy session.
- A `HELLO` whose `client_proto != 0x01` is answered with `REJECT` reason 1 and nothing else.
- The server accepts an inbound datagram from an unknown address only if it is a `HELLO`.
- Bounds-check every length field against the remaining buffer before reading. Treat every inbound
  frame as hostile input.

### 4.12 Reliability, ordering, duplication

The transport is unreliable and may lose, duplicate, reorder, and delay frames. Handle it:

- Each endpoint maintains its own outgoing `seq` counter and, for the peer, a received-sequence
  bitmask covering the last 32 sequences. A frame whose `seq` was already recorded is dropped as a
  duplicate and counted. Sequence comparison uses wrap-safe arithmetic:
  `is_newer(a, b) = ((a > b) && (a - b <= 32768)) || ((b > a) && (b - a > 32768))`.
- `SNAPSHOT` and `INPUT` are unreliable and idempotent. A snapshot whose `tick` is not newer than the
  last applied snapshot tick is discarded. An input packet is applied per command tick: commands for
  ticks the server already simulated are discarded, never re-applied.
- Input loss is covered by redundancy, not retransmission: every `INPUT` packet carries the newest
  command plus every unacknowledged older command, capped at `INPUT_REDUNDANCY = 12` (oldest
  dropped first).
- If a command for tick `T` never arrives, the server **repeats the last command it did receive** for
  that player and marks the tick as extrapolated. It must never stall the tick loop waiting on input.
- `EVENT` is a reliable ordered channel: events carry a monotonically increasing `event_seq`, the
  client acks the highest contiguous seq via `EVENT_ACK`, and the server retransmits unacked events
  attached to the next outbound packet, at most every 100 ms per event, until acked. Duplicate events
  must be idempotent on the client (dedupe by `event_seq`).
- Ping/RTT: each side sends a `PING` every 500 ms and computes a smoothed RTT
  `rtt := (rtt * 7 + sample) / 8` (integer microseconds). The client HUD shows RTT in milliseconds.

### 4.13 Snapshots and delta encoding

`SNAPSHOT` payload:

```
u32 tick                     server tick this snapshot describes
u32 baseline_tick            0 for a full snapshot, else the tick this delta is against
u32 last_input_tick          the newest command tick from THIS client that the server has simulated
u16 changed_count
  repeated changed_count times:
    u16 entity_id
    u16 field_mask
    fields, in ascending bit order, for each set bit
u8  removed_count
  repeated removed_count times: u16 entity_id
```

Field mask bits:

| Bit | Field         | Encoding                                               |
| --- | ------------- | ------------------------------------------------------ |
| 0   | create        | `u8 kind` (0 player, 1 projectile), `u8 owner_id`      |
| 1   | pos_x         | `i32`                                                  |
| 2   | pos_y         | `i32`                                                  |
| 3   | aim           | `u8` (players) / `i16 vx`,`i16 vy` (projectiles)       |
| 4   | health        | `u8`                                                   |
| 5   | score         | `i16`                                                  |
| 6   | state         | `u8` (0 alive, 1 dead, 2 zombie/disconnected)          |
| 7   | respawn_timer | `u16`                                                  |
| 8   | kills_deaths  | `u16 kills`, `u16 deaths`                              |
| 9   | cooldown_ttl  | `u8 fire_cooldown` (players) / `u16 ttl` (projectiles) |

Requirements:

- Bits 1-9 cover, between them, every field of the canonical world serialization in 4.20 — that is
  the point of the mask. A client that applies snapshots correctly can therefore reconstruct the
  server's world exactly and compute an identical `world_hash`. A field the mask cannot carry is a
  field on which the two can never converge, so do not drop a bit and do not invent one.
- The server keeps, per client, the last snapshot that client acknowledged (via `ack_snapshot_tick`
  in `INPUT`) and encodes against it. A field bit is set only when that field's value differs from
  the baseline. Bit 0 is set when the entity did not exist in the baseline.
- A full snapshot (`baseline_tick = 0`, every existing entity, every field) is sent when: the client
  has just joined, the client sent `RESYNC_REQUEST`, the client has acknowledged nothing for 2
  seconds, or the acknowledged baseline has aged out of the 64-tick history. Otherwise deltas.
- Snapshots are sent every `SNAPSHOT_INTERVAL` ticks. A snapshot carrying no changes and no removals
  is still sent (it carries `last_input_tick`, and it is the reconciliation heartbeat), but must
  encode to at most 32 bytes including frame and header.
- Bandwidth ceiling, measured over any 5-second window of a full 8-player game: server -> client
  mean rate must not exceed **24 KiB/s** per client, client -> server must not exceed **4 KiB/s**.
  The soak summary reports these; exceeding them fails the soak.

### 4.14 Client-side prediction and reconciliation

- The client runs the same simulation at the same 50 Hz. On producing the command for its local tick
  `T`, it immediately applies that command to its own player through the shared step function and
  stores `(T, command, resulting_local_player_state)` in a ring buffer of `PREDICTION_BUFFER_TICKS`
  entries.
- The client's tick is kept ahead of the server: on `WELCOME` it starts at `server_tick + 2`, and it
  adjusts by at most 1 tick per 20 ticks so that the newest command arrives at the server roughly
  `rtt/2 + 20 ms` before it is needed. Document your clock-sync rule in `NOTES.md`.
- On applying a snapshot with `last_input_tick = L`:
  1. Overwrite the local player's authoritative state with the snapshot's values for tick
     `snapshot.tick`.
  2. Discard buffered commands for ticks `<= L`.
  3. Replay commands `L+1 .. current_tick` through the same step function, against the world as
     reconstructed from the snapshot, to recompute the predicted local state.
  4. Compare the replayed state at tick `L` against what was originally predicted for `L`. If either
     coordinate differs, increment `mispredictions`.
- Error smoothing is a **render-only** correction: if the corrected position differs from the
  previously displayed position by less than 512 units, move the displayed position 1/8 of the
  remaining error per rendered frame; at 512 units or more, snap. The smoothing offset must never be
  written back into simulation state.
- Prediction covers only the local player and the projectiles it fires. Remote players are never
  predicted; they are interpolated (4.15).

### 4.15 Entity interpolation

- The client buffers received snapshots with their ticks. Remote players and remote projectiles are
  rendered at `render_tick = newest_snapshot_tick - INTERP_DELAY_TICKS` where
  `INTERP_DELAY_TICKS = 6` (120 ms), linearly interpolating each coordinate between the two buffered
  snapshots bracketing that time.
- If the buffer starves (no snapshot newer than `render_tick`), extrapolate along the last known
  velocity for at most 5 ticks (100 ms), then freeze the entity in place and mark it stale in the
  HUD. Never extrapolate a player through a wall.
- The `render_tick` the client actually used for the current frame is what it reports in the
  `render_tick` field of its `INPUT` packets.

### 4.16 Lag compensation

- The server keeps the last `HISTORY_TICKS = 64` world states.
- When the server simulates a client's FIRE command belonging to command tick `C`, it computes the
  compensation delay from that client's most recent `INPUT` packet:
  `comp_delay = clamp(newest_cmd_tick_in_packet - render_tick - (newest_cmd_tick_in_packet - C), 0, MAX_REWIND_TICKS)`.
  This value is stored on the spawned projectile and does not change afterwards.
- Every hit test performed by that projectile compares against candidate players' positions taken
  from the history ring at tick `current_tick - comp_delay`, falling back to the current tick when
  that entry is unavailable. A player must be `alive` both at the compensation tick and at the
  current tick to be hit.
- Bots (4.17) report a `render_tick` too and are subject to the same path.
- `--selftest` must contain a case proving lag compensation: with a scripted 150 ms delay, a shot
  aimed at where the target *was* on the shooter's screen registers a hit, and the same shot with
  compensation disabled (`--no-lagcomp`, which must exist) misses.

### 4.17 Bot client

Bots are full protocol clients — same handshake, same prediction, same interpolation — driven by a
deterministic policy instead of a keyboard. The policy, for bot with player id `p` and session seed
`S`:

- PRNG is SplitMix64, seeded with `S + 0x9E3779B97F4A7C15 * (p + 1)`:

  ```
  state += 0x9E3779B97F4A7C15
  z = state
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
  z = (z ^ (z >> 27)) * 0x94D049BB133111EB
  return z ^ (z >> 31)
  ```

  All arithmetic is unsigned 64-bit with wrapping multiplication.
- If the bot's player is not `alive`, it emits `buttons = 0` and keeps its last aim.
- Target selection: among other players believed `alive` by the bot's local view, choose the one with
  the smallest squared distance; ties by lowest player id. With no target, emit `buttons = 0`.
- Aim: choose the `a` in `[0, 255]` maximising `dx * DIR_X[a] + dy * DIR_Y[a]` (64-bit arithmetic),
  ties by lowest `a`, where `(dx, dy)` is the vector to the target.
- Movement mode is re-rolled every 16 ticks as `next_u64() % 4`: `0` approach, `1` retreat, `2` strafe
  clockwise, `3` strafe counter-clockwise. The desired direction vector is, respectively, `(dx, dy)`,
  `(-dx, -dy)`, `(-dy, dx)`, `(dy, -dx)`. Buttons are derived from that vector `(ux, uy)`:
  set `RIGHT` if `2*ux > |uy|`, `LEFT` if `-2*ux > |uy|`, `DOWN` if `2*uy > |ux|`, `UP` if
  `-2*uy > |ux|`.
- Fire when `fire_cooldown == 0`, the squared distance to the target is `<= 4096*4096`, and the
  target is in line of sight. Line of sight is sampled at 65 points: for `k` in `0..=64`,
  `x = px + (tx - px) * k / 64` and likewise `y`, computed in 64-bit with division truncating toward
  zero; if any sampled tile `(x >> 8, y >> 8)` is a wall, there is no line of sight.

### 4.18 Network simulator

A transport decorator, usable on both `sim` and `udp` transports, configured by a `--netsim` spec of
comma-separated `key=value` pairs:

```
--netsim latency=150,jitter=30,loss=5,dup=1,reorder=2,seed=7
```

`latency` and `jitter` are milliseconds (one-way; RTT is roughly `2 * latency`), `loss`, `dup`, and
`reorder` are percentages, `seed` seeds the simulator's own PRNG. Prefixing a key with `up.` or
`down.` sets it for one direction only; unprefixed keys set both. Defaults are all zero.

Per frame handed to the simulator, draw from a SplitMix64 stream seeded `2*seed + 1` for the
client-to-server direction and `2*seed + 2` for the other, in **exactly this order**:

1. `loss`: if `next_u64() % 10000 < loss_percent * 100`, drop the frame and stop.
2. `dup`: `duplicate = next_u64() % 10000 < dup_percent * 100`.
3. primary delay: `d = latency_ms * 1000`; if `jitter_ms > 0`,
   `d += (i64)(next_u64() % (2 * jitter_ms * 1000 + 1)) - jitter_ms * 1000`; clamp `d >= 0`.
4. if `reorder_percent > 0` and `next_u64() % 10000 < reorder_percent * 100`, add
   `latency_ms * 1000` to `d`.
5. if `duplicate`, draw a second delay by repeating steps 3 and 4 for the copy.

Frames are delivered when the virtual (headless/soak) or monotonic (live) clock reaches their
delivery time; a delivery queue must not reorder frames with equal delivery times relative to their
enqueue order.

### 4.19 Soak test and convergence

`./run.sh --soak --players <n> --ticks <t> --seed <s> [--netsim <spec>]` runs, in one process on the
`sim` transport and a virtual clock: one server, `n` bot clients, no terminal output except the final
summary line. On completion it prints one line of compact JSON to stdout with the schema in section
6 plus these additional keys before `"status"`:

```
"bytes_down_per_client_per_sec": <int>, "bytes_up_per_client_per_sec": <int>,
"snapshots_full": <int>, "snapshots_delta": <int>,
"frames_sent": <int>, "frames_dropped": <int>, "frames_duplicated": <int>, "frames_malformed": <int>
```

The process exits non-zero if any of these fail:

- Any client's `world_hash` at the final commonly-acknowledged tick differs from the server's
  `world_hash` at that tick (convergence failure).
- A bandwidth ceiling from 4.13 is exceeded.
- Any client ended in state `disconnected` without a scripted cause.

`test.sh` must include at least one soak run at `latency=75,jitter=25,loss=5,dup=1,reorder=2` (150 ms
RTT, 5% loss) with 6 players for at least 3000 ticks, and assert convergence.

### 4.20 World state hash

`world_hash` is FNV-1a 64 (offset basis `0xcbf29ce484222325`, prime `0x100000001b3`) over this exact
canonical little-endian serialization of the world at a tick:

```
u32 tick
u8  player_count                       number of joined players
  for each player, ascending player id:
    u8  player_id
    u8  state                          0 alive, 1 dead, 2 zombie
    u8  health
    u8  aim
    i32 x
    i32 y
    i16 score
    u16 kills
    u16 deaths
    u16 respawn_timer
    u8  fire_cooldown
u16 projectile_count
  for each projectile, ascending entity id:
    u16 entity_id
    u8  owner_id
    i32 x
    i32 y
    i16 vx
    i16 vy
    u16 ttl
```

It is rendered as exactly 16 lowercase hex digits. This definition is shared by the server, every
client, and the selftest; a client computes it over its reconciled authoritative view, excluding
render-only smoothing offsets.

### 4.21 Disconnect, reconnect, resync

- A client that receives nothing for 1 s shows `RECONNECTING` in the HUD and resends `HELLO` with its
  `session_id` every 250 ms for up to 10 s, then exits with status `disconnected`.
- A server that receives nothing from a client for `CLIENT_TIMEOUT_TICKS` marks that player `zombie`:
  the entity stays in the world at its last position, takes no input, cannot be hit, and cannot fire.
  After `RECONNECT_GRACE_TICKS` more, the player leaves (broadcast event kind 2) and its slot frees.
- A `HELLO` with a matching `session_id` and `client_nonce` for a `zombie` (or live) player resumes
  that player: same player id, same score/kills/deaths, `resumed = 1` in `WELCOME`, followed by a
  full snapshot. A `session_id` that is unknown or expired is answered with `REJECT` reason 4, and
  the client must then fall back to a fresh join.
- Reconnect must be exercised by the headless script language (`netsplit` and `reconnect`, section 6)
  and covered by `--selftest`.

### 4.22 TUI

- The arena renders one tile per terminal cell: `#` for wall, a dim `.` or space for floor. Players
  render as their player id digit, the local player highlighted (colour or reverse video);
  projectiles as `*`; a dead player's tile shows nothing and its scoreboard row is dimmed.
- A HUD of at most 5 lines shows: round time remaining (mm:ss), local health and ammo cooldown, RTT
  in ms, packet loss percentage observed over the last 5 s, down/up bandwidth in KiB/s, and the
  scoreboard (id, name, score, kills, deaths, ping) for all connected players.
- Minimum terminal size is 80x30. Below that, render a single centred message and keep running; do
  not crash or corrupt the screen.
- Colour is optional. When `NO_COLOR` is set in the environment, or the terminal reports no colour
  support, the client must emit no colour escape sequences at all, and every element above must stay
  distinguishable without them: walls `#`, floor `.` or space, each player its own id digit,
  projectiles `*`, and the local player in reverse video.

---

## 5. Technical constraints

- **No game engine, no networking framework that does the work for you.** Forbidden: any engine
  (Bevy, Ebiten, Godot bindings, pygame, SDL-based engines), any ECS/netcode library that ships
  prediction/reconciliation/snapshot-delta (for example `renet`, `laminar`, `naia`, `lightyear`,
  `GGPO`/`GGRS`, `nakama`, `colyseus`, `geckos.io`), and any RPC/serialization framework that
  defines the wire format for you (gRPC, protobuf, Cap'n Proto, MessagePack, `serde_json` for the
  wire, `bincode`). You write the byte layout, the reliability layer, and the delta encoder yourself.
- Terminal handling may use the platform primitives (`termios`/`tcsetattr`, `ioctl(TIOCGWINSZ)`, ANSI
  escapes) or a **thin** terminal library that only does raw mode, key decoding, and cursor/colour
  output (`crossterm`, `termbox`, `tcell`, `termios`/`curses` bindings, `blessed`). A library that
  provides widgets and layout (`ratatui`, `bubbletea`, `textual`, `ink`) is acceptable **only** for
  rendering; it must not supply any part of the netcode or simulation.
- UDP sockets may bind and connect to loopback (`127.0.0.1`/`::1`) only. No other network access at
  build, test, or run time. Dependencies must be vendored or already present; `build.sh` must succeed
  with networking disabled.
- Terminal state must be restored on **every** exit path: normal quit, `q`, `Ctrl-C`/SIGINT, SIGTERM,
  an unhandled panic/exception, and an error return from any subsystem. Use RAII/`defer`/`finally`
  plus a panic hook or equivalent; a crashed process must never leave the terminal in raw mode, with
  the alternate screen active, or with the cursor hidden. Test this by killing the process.
- No busy-wait. The tick loop and the render loop sleep or block on a timer/poll with a timeout;
  a spinning loop that burns a core is a defect. A `--server` holding two connected but idle clients
  must average under 5% of one core over a 10-second sample.
- Render budget: 60 fps. The render path must not be coupled to the 50 Hz tick; decouple them and
  interpolate. Redraw only what changed, or diff frames before writing: in steady state, where only
  the players and projectiles have moved, one frame must write fewer than a fifth of the bytes a
  full 80x30 repaint would write.
- Simulation, protocol codec, netsim, and bot policy must be integer-only and endian-explicit
  (4.2). Do not rely on host endianness, on `char` signedness, or on unspecified shift behaviour.
- `--headless`, `--soak`, and `--selftest` must run with no controlling terminal, no `TERM` set, and
  stdin closed, and must never emit ANSI escapes.

---

## 6. Headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven without a terminal.
Both of the following are mandatory.

### 6.1 `./run.sh --headless --script <path> --seed <n>`

Replays a newline-delimited input script against a full in-process session (server + scripted client
0 + bots for the remaining slots, all on the `sim` transport and a virtual clock) and, on exit,
prints a deterministic one-line JSON summary of final state to stdout. Nothing else goes to stdout.
Diagnostics go to stderr.

**Given the same seed and the same script, the JSON summary must be byte-identical across runs**,
across machines, and regardless of host load or wall-clock timing. Any dependence on wall-clock time,
address-space layout, map/dict iteration order, or thread scheduling in the simulation path is a
defect.

Script grammar — one command per line, `#` starts a comment, blank lines ignored, tokens separated by
single spaces:

| Line                | Meaning                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `players <n>`       | Total players including client 0; `2 <= n <= 8`. Must appear before `step`.                                    |
| `netsim <spec>`     | Same spec syntax as `--netsim` (4.18). The `seed` key defaults to `--seed`.                                    |
| `round_ticks <n>`   | Override `ROUND_TICKS`.                                                                                        |
| `lagcomp <on\|off>` | Enable/disable lag compensation.                                                                               |
| `hold <list>`       | Set client 0's held buttons, comma-separated from `up,down,left,right,fire`, or `none`.                        |
| `aim <0-255>`       | Set client 0's aim byte.                                                                                       |
| `step <n>`          | Advance the virtual clock by `n` server ticks, producing one command per tick from the current hold/aim.       |
| `netsplit <n>`      | Drop 100% of client 0's frames in both directions for `n` ticks.                                               |
| `reconnect`         | Force client 0 to restart its handshake using its stored `session_id`.                                         |
| `resync`            | Force client 0 to send `RESYNC_REQUEST`.                                                                       |
| `assert_converged`  | Immediately fail (exit 3) if client and server world hashes disagree at the newest commonly acknowledged tick. |
| `end`               | Stop; anything after this line is ignored.                                                                     |

An unknown command, a malformed argument, or a missing script file exits non-zero with a message on
stderr.

**JSON summary** — compact (no spaces outside strings), keys in exactly this order:

```json
{"schema":"netplay-arena/v1","seed":1234,"ticks":1800,"players":2,"map_hash":"6d955427","server_world_hash":"0123456789abcdef","converged":true,"clients":[{"id":0,"name":"p0","state":"alive","health":66,"x":4224,"y":3200,"aim":32,"score":2,"kills":2,"deaths":1,"world_hash":"0123456789abcdef","mispredictions":3,"resyncs":1,"rtt_ms":150},{"id":1,"name":"p1","state":"dead","health":0,"x":9856,"y":1472,"aim":128,"score":1,"kills":1,"deaths":2,"world_hash":"0123456789abcdef","mispredictions":0,"resyncs":0,"rtt_ms":150}],"projectiles":4,"events_delivered":37,"status":"round_complete"}
```

Key semantics:

- `seed` — the `--seed` value exactly as given.
- `ticks` — the server tick at exit.
- `players` — the session's configured player count, 2-8: the script's `players` line, or
  `--players` under `--soak`.
- `map_hash` — 8 lowercase hex digits, always `6d955427`.
- `server_world_hash`, `clients[].world_hash` — 16 lowercase hex digits, per 4.20, computed at the
  newest tick the client in question has authoritative state for.
- `converged` — true iff every connected client's `world_hash` at the newest commonly acknowledged
  tick equals the server's hash at that tick.
- `clients` — one object per player slot ever used, ascending `id`, including disconnected ones
  (`state` is `alive`, `dead`, `zombie`, or `disconnected`).
- `clients[].name` — the name as the server accepted it, at most 16 printable ASCII bytes (4.1).
- `clients[].mispredictions` — that client's count of reconciliation divergences, per 4.14.
- `clients[].resyncs` — how many full snapshots that client requested or was forced into, counting
  every trigger listed in 4.13.
- `clients[].rtt_ms` — that client's smoothed RTT (4.12) at exit, in whole milliseconds, truncated
  toward zero.
- `projectiles` — count of live projectiles at exit.
- `events_delivered` — the number of distinct reliable events, counted by `event_seq`, that client 0
  delivered to its game layer; retransmitted duplicates are not counted twice.
- `status` — exactly one of `round_complete` (round timer elapsed), `script_end` (script ran out or
  hit `end`), `disconnected` (client 0 could not re-establish), `error`.

Exit codes: `0` normal, `2` bad arguments or unreadable script, `3` `assert_converged` failed,
`4` internal invariant violation.

### 6.2 `./run.sh --selftest`

Runs built-in invariant checks with no arguments and exits non-zero on the first failure, printing
which check failed to stderr. It must cover at least:

1. `MAP_HASH` and direction-table hash match section 4.2/4.3.
2. Codec round-trip: every message type encodes and decodes to an equal value; truncated, oversized,
   and unknown-type frames are rejected without panicking.
3. Delta encoding: a random-but-seeded sequence of world states encoded as deltas against rolling
   baselines and re-applied reproduces the original states exactly.
4. Wrap-safe sequence comparison across the u16 wrap point.
5. The reliability layer discards duplicates and stale snapshots and delivers the reliable event
   channel in order under 20% loss.
6. Determinism: the same seed and command stream stepped twice yields identical world hashes.
7. Prediction: with zero latency and zero loss, a client's predicted local state equals the server's
   for 500 consecutive ticks and `mispredictions == 0`.
8. Lag compensation as described in 4.16.
9. Reconnect: a client dropped for 3 s resumes with the same player id and score, then converges.
10. Terminal restore: a simulated panic on the render path runs the restore handler.

---

## 7. Deliverables

At the root of the workspace directory:

| File          | Contents                                                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.sh`    | Compiles everything. Exit 0 on success. No network.                                                                                                                                                                                                         |
| `run.sh`      | Entry point implementing every mode in 4.1. Must work from any caller with the workspace as cwd.                                                                                                                                                            |
| `test.sh`     | Runs `--selftest`, at least two recorded headless scripts (one clean, one lossy) asserting byte-identical expected summaries, the required soak run (4.19), and a byte-identical-across-two-runs check. Exit 0 iff all pass.                                |
| `PROTOCOL.md` | The normative wire-format document (see below).                                                                                                                                                                                                             |
| `README.md`   | How to build, run a server, join clients, run bots, controls, and the meaning of every HUD field.                                                                                                                                                           |
| `NOTES.md`    | Design decisions and trade-offs: clock sync rule, key-hold decay, prediction/reconciliation structure, delta-encoding scheme and measured bandwidth, lag-compensation window, what you would do with more time, and anything you knowingly left incomplete. |
| `scripts/`    | The recorded headless scripts used by `test.sh` plus their expected summary files.                                                                                                                                                                          |
| source tree   | Organised into clear modules: at minimum `sim` (rules + step function), `proto` (codec), `net` (transports, reliability, netsim), `server`, `client` (prediction, interpolation, render), `bot`.                                                            |

`PROTOCOL.md` must be complete enough that a second implementation could interoperate without reading
your code: byte-level tables for the frame, the header, and every message type; the state machine for
connect/resume/disconnect with a diagram or explicit table; the delta encoding rules including the
field mask and baseline selection; the reliability, ack, and event-retransmission rules; the exact
send cadences; and a worked hexdump example of a `HELLO`/`WELCOME` exchange and of one delta
snapshot.

Also fill in `run.json` per `CONVENTIONS.md` (section 5), including `self_reported_status`.

---

## 8. Definition of done

Check every line yourself before declaring completion.

- [ ] Everything lives under `tui-games/solutions/{{RUN_ID}}/netplay-arena/{{LANGUAGE}}/`; nothing
      else in the repository was created or modified.
- [ ] `build.sh`, `run.sh`, `test.sh` are executable, start with `#!/usr/bin/env bash` and
      `set -euo pipefail`, and need no network.
- [ ] `./build.sh` exits 0 from a clean checkout.
- [ ] `./run.sh --selftest` exits 0 and covers all ten checks in 6.2.
- [ ] `./run.sh --headless --script scripts/<name>.txt --seed <n>` prints exactly one line of compact
      JSON to stdout, with the keys of 6.1 in the specified order, and nothing else on stdout.
- [ ] Running that command twice with the same seed produces byte-identical stdout; `test.sh` proves
      it with `diff`.
- [ ] `./run.sh --soak --players 6 --ticks 3000 --seed 7 --netsim latency=75,jitter=25,loss=5,dup=1,reorder=2`
      exits 0, reports `"converged":true`, and stays inside the bandwidth ceilings of 4.13.
- [ ] `./test.sh` exits 0 and exercises selftest, both recorded scripts, the soak, and the
      determinism diff.
- [ ] A human can run `./run.sh` and play against bots; `./run.sh --server` plus two `./run.sh --client`
      instances in separate terminals produce a shared, consistent game.
- [ ] Terminal is restored on quit, `Ctrl-C`, `SIGTERM`, and panic. Verified by killing the process
      mid-game and confirming the shell is usable without `reset`.
- [ ] `MAP_HASH == 0x6d955427` and the direction-table hash `== 0x43d19f4d` are asserted at startup.
- [ ] The simulation, codec, netsim, and bot policy contain no floating-point arithmetic.
- [ ] Server and client call the same step function; there is exactly one implementation of the game
      rules in the source tree.
- [ ] Prediction replays unacknowledged inputs after every snapshot; `mispredictions` is 0 on a
      zero-latency lossless run.
- [ ] Remote entities are interpolated with a 6-tick delay and degrade to bounded extrapolation.
- [ ] Hit detection rewinds to the shooter's reported `render_tick`, clamped to 50 ticks.
- [ ] Snapshots are delta-encoded against per-client acknowledged baselines, with full-snapshot
      fallback on the four conditions in 4.13.
- [ ] Malformed, duplicated, reordered, and stale frames are counted and ignored, never fatal.
- [ ] Disconnect/reconnect resumes the same player id and score and resyncs with a full snapshot.
- [ ] No busy-wait loop anywhere; idle server CPU is a small fraction of a core.
- [ ] `PROTOCOL.md`, `README.md`, and `NOTES.md` are present and match the shipped behaviour.
- [ ] `run.json` is filled in.

---

## 9. Scoring rubric (total 100)

| Weight | Criterion                                                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12     | **Wire protocol and `PROTOCOL.md`.** Frame and header exactly as specified, every message type implemented, hostile input rejected safely, and a document a second implementer could build against.                          |
| 10     | **Authoritative simulation.** Fixed 50 Hz loop that never stalls on input, integer-only rules matching section 4.4-4.10 (movement, collision, projectiles, damage, spawn selection, round end), one shared step function.    |
| 13     | **Prediction and reconciliation.** Local input applied immediately, ring-buffered, replayed after every snapshot; zero mispredictions on a clean link; render-only error smoothing that never contaminates simulation state. |
| 7      | **Entity interpolation.** 6-tick delay, correct bracketing interpolation, bounded extrapolation and freeze on starvation, `render_tick` reported upstream.                                                                   |
| 7      | **Lag compensation.** History ring, per-projectile compensation delay clamped to 50 ticks, alive-at-both-ticks rule, and a selftest that demonstrates hit-with vs miss-without.                                              |
| 9      | **Delta snapshots and bandwidth.** Per-client baselines, correct field masks, correct full-snapshot fallback, measured bandwidth inside the 24/4 KiB/s ceilings.                                                             |
| 12     | **Robustness.** Loss, duplication, reordering, and stale frames handled and counted; input redundancy; reliable ordered event channel; timeout, zombie, reconnect, and resync all behaving per 4.21.                         |
| 10     | **Netsim and soak.** Faithful, seeded, deterministic simulator with the specified draw order; soak converges at 150 ms RTT and 5% loss with 6 players and reports the required counters.                                     |
| 8      | **Headless determinism.** Script grammar implemented, JSON schema exact, byte-identical across runs, correct exit codes, virtual clock with no wall-clock dependence.                                                        |
| 6      | **Terminal engineering.** Raw-mode layer per section 5, restore on every exit path, no busy-wait, 60 fps decoupled render with diffed output, readable HUD, graceful small-terminal handling.                                |
| 6      | **Build and documentation hygiene.** The three scripts behave per `CONVENTIONS.md`, `test.sh` is a real gate, module structure is clear, `README.md`/`NOTES.md` honest and matching behaviour, `run.json` complete.          |

Partial credit is awarded per criterion. A criterion whose evidence cannot be produced mechanically
(because the mode does not exist, the script grammar is unimplemented, or the build fails) scores
zero for that criterion — a plausible-looking implementation that cannot be driven headlessly is
worth less than a smaller one that can. Honest reporting matters: a `NOTES.md` that names a missing
piece scores better than silence about it, and `self_reported_status` in `run.json` diverging from
observed behaviour is recorded against the run.
