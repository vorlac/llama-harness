# Acceptance — `netplay-arena` (tui-games, size XL)

Operator-facing companion to `tui-games/tui-netplay-arena-prompt.md`. That prompt is the normative
spec; this file says how to seed a run, how to verify it, and what to distrust. Layout, run IDs, and
the script contract come from `CONVENTIONS.md` and are not restated here.

Rung 7 of 8 in the tui-games ladder (snake, tetris, tetris-enhanced, minesweeper, 2048-solver,
roguelike, **netplay-arena**, game-engine). This is the distributed-systems rung: the game rules are
deliberately trivial and almost all the signal lives in the netcode. Expect a wide quality spread and
expect most failures to be *silent* — a build that runs and renders a plausible arena while the
network layer is a fiction.

---

## 1. Seeding a workspace

```sh
tools/new_workspace.sh <run-id> netplay-arena <language>
# -> tui-games/solutions/<run-id>/netplay-arena/<language>/
```

`starting_material` is `null`: the workspace starts empty apart from the seeded `run.json`. Hand the
model `tui-games/tui-netplay-arena-prompt.md` verbatim with `{{LANGUAGE}}` and `{{RUN_ID}}`
substituted. Nothing under `tui-games/tasks/` may be written by the run.

Languages in scope: `rust`, `go`, `cpp`, `python`, `ts`. Python and TS runs are the ones most likely
to miss the CPU budget in `--soak`; that is a legitimate result, not an excuse to relax the timeout.

---

## 2. Running verification

From the workspace directory:

```sh
./build.sh                                             # exit 0
./run.sh --selftest                                    # exit 0
./run.sh --headless --script scripts/clean.txt --seed 1234    # one JSON line on stdout
./run.sh --soak --players 6 --ticks 3000 --seed 7 \
         --netsim latency=75,jitter=25,loss=5,dup=1,reorder=2 # exit 0, "converged":true
./test.sh                                              # exit 0, the scored gate
```

Determinism gate — run it yourself, do not trust `test.sh` to have run it:

```sh
./run.sh --headless --script scripts/clean.txt --seed 1234 > /tmp/a.json
./run.sh --headless --script scripts/clean.txt --seed 1234 > /tmp/b.json
diff /tmp/a.json /tmp/b.json && echo DETERMINISTIC
# and a different seed must produce different output
./run.sh --headless --script scripts/clean.txt --seed 999 > /tmp/c.json
diff -q /tmp/a.json /tmp/c.json || echo "SEED IS LIVE"
```

Timeouts from `task.json`: build 600 s, run 300 s, test 900 s.

Live smoke test, three terminals — this is the only check that catches a "networked" game whose two
halves are actually one process sharing memory:

```sh
./run.sh --server --port 45123          # terminal 1
./run.sh --client --host 127.0.0.1 --port 45123 --name a   # terminal 2
./run.sh --client --host 127.0.0.1 --port 45123 --name b   # terminal 3
```

Both clients must see each other move, shoot, die, and respawn, and the scoreboards must agree.

---

## 3. Headless JSON schema

Exactly one line on stdout, compact (no spaces outside strings), keys in this order. Anything else on
stdout fails the task.

| Key | Type | Meaning |
|---|---|---|
| `schema` | string | Always `"netplay-arena/v1"` |
| `seed` | int | The `--seed` value as given |
| `ticks` | int | Server tick at exit |
| `players` | int | Player count for the session, 2-8 |
| `map_hash` | string | 8 lowercase hex digits, always `"6d955427"` |
| `server_world_hash` | string | 16 lowercase hex digits, FNV-1a 64 over the canonical world serialization (prompt 4.20) |
| `converged` | bool | Every connected client's hash equals the server's at the newest commonly acknowledged tick |
| `clients` | array | One object per player slot ever used, ascending `id` |
| `clients[].id` | int | Player id 0-7 |
| `clients[].name` | string | <= 16 printable ASCII |
| `clients[].state` | string | `alive` / `dead` / `zombie` / `disconnected` |
| `clients[].health` | int | 0-100 |
| `clients[].x`, `.y` | int | World units, `[0,16384)` and `[0,6144)` |
| `clients[].aim` | int | 0-255 |
| `clients[].score`, `.kills`, `.deaths` | int | Non-negative; `score` never decreases |
| `clients[].world_hash` | string | 16 lowercase hex digits, that client's authoritative view |
| `clients[].mispredictions` | int | Reconciliation divergences observed (prompt 4.14) |
| `clients[].resyncs` | int | Full-snapshot resyncs requested or forced |
| `clients[].rtt_ms` | int | Smoothed RTT at exit |
| `projectiles` | int | Live projectiles at exit |
| `events_delivered` | int | Reliable events delivered to client 0 |
| `status` | string | `round_complete` / `script_end` / `disconnected` / `error` |

`--soak` prints the same schema plus, immediately before `status`:
`bytes_down_per_client_per_sec`, `bytes_up_per_client_per_sec`, `snapshots_full`,
`snapshots_delta`, `frames_sent`, `frames_dropped`, `frames_duplicated`, `frames_malformed`
(all ints).

Exit codes: `0` normal, `2` bad arguments or unreadable script, `3` `assert_converged` failed,
`4` internal invariant violation.

Schema check:

```sh
./run.sh --headless --script scripts/clean.txt --seed 1234 | python3 -c '
import sys,json
line=sys.stdin.read()
assert line.count("\n")==1 and line.endswith("\n"), "not exactly one line"
d=json.loads(line)
assert list(d)[:7]==["schema","seed","ticks","players","map_hash","server_world_hash","converged"], list(d)[:7]
assert list(d)[-1]=="status"
assert d["schema"]=="netplay-arena/v1" and d["map_hash"]=="6d955427"
assert len(d["server_world_hash"])==16 and all(c in "0123456789abcdef" for c in d["server_world_hash"])
assert json.dumps(d,separators=(",",":"))==line.strip(), "not compact / key order differs"
print("SCHEMA OK", d["status"], d["converged"])'
```

---

## 4. Scored criteria and how to check them

Weights are the rubric in prompt section 9. "Mechanical" checks should be run; "inspection" checks
need a human reading code or watching a terminal.

| Wt | Criterion | Check |
|---|---|---|
| 12 | Wire protocol and `PROTOCOL.md` | Mechanical: `./run.sh --selftest` covers codec round-trip and hostile-frame rejection; fuzz it by hand with a tiny UDP sender that emits random 1-64 byte datagrams at a running server and confirm the server survives and keeps serving. Inspection: `PROTOCOL.md` must contain byte-offset tables for the frame, the 10-byte header, and all 11 message types, the connect/resume state machine, and two worked hexdumps. Cross-check the tables against the encoder source — divergence between doc and code is the most common defect here. |
| 10 | Authoritative simulation | Mechanical: constants from prompt 4.4 should be greppable as named constants; `MAP_HASH`/direction-table assertions must fire (corrupt one map row in a scratch copy and confirm startup aborts). Inspection: one step function, called by server, client prediction, and soak alike — `grep -rn "fn step\|func Step\|def step"` should find exactly one rules implementation. Two copies of the rules is a major deduction even if they agree today. |
| 13 | Prediction and reconciliation | Mechanical: selftest check 7 (`mispredictions == 0` over 500 clean ticks). Then prove prediction is real: run a headless script that holds `right` for 100 ticks with `netsim latency=150`; the client's reported `x` must lead the position the server had acked ~150 ms earlier by roughly `15 units/tick * 7 ticks`. A client that only renders received state will show no lead. Inspection: a ring buffer of unacked commands and a replay loop must exist; replay must go through the shared step function, not a bespoke "reapply velocity" shortcut. |
| 7 | Entity interpolation | Inspection primarily: look for the snapshot buffer, the 6-tick delay, and the bracketing lerp. Mechanical proxy: at `latency=150,jitter=30`, remote players must move smoothly on screen; snapping/teleporting every 40 ms means interpolation is missing. Confirm the starvation path freezes after 5 ticks of extrapolation rather than flying off. |
| 7 | Lag compensation | Mechanical: selftest check 8 must demonstrate hit-with vs miss-without, and `--no-lagcomp` must exist. Compare two soaks at `latency=75`: total kills with compensation on should be materially higher than with `--no-lagcomp`. Zero difference means the rewind is not wired to hit detection. |
| 9 | Delta snapshots and bandwidth | Mechanical: the soak summary must report `snapshots_delta` >> `snapshots_full`, and `bytes_down_per_client_per_sec` <= 24576 and `bytes_up_per_client_per_sec` <= 4096. A run where `snapshots_full` roughly equals total snapshots is a full-snapshot implementation wearing a delta label. |
| 12 | Robustness | Mechanical: soak counters `frames_dropped`, `frames_duplicated`, `frames_malformed` must all be non-zero under the lossy netsim and the run must still converge; a headless script with `netsplit 200` then `reconnect` must end `converged:true` with the same player id and preserved score. Inspection: wrap-safe seq comparison, a 32-bit received bitmask, input redundancy capped at 12, event retransmit until acked with client-side dedupe. |
| 10 | Netsim and soak | Mechanical: the required soak (`--players 6 --ticks 3000 --seed 7 --netsim latency=75,jitter=25,loss=5,dup=1,reorder=2`) exits 0 with `converged:true`; the same soak twice must be byte-identical; a different `--seed` must change `frames_dropped`. Inspection: the draw order in prompt 4.18 (loss, dup, delay, reorder, duplicate delay) must match the code exactly, else results are not reproducible across implementations. |
| 8 | Headless determinism | Mechanical: the section 3 schema check plus the two-run `diff`. Also run eight copies concurrently (`for i in $(seq 8); do ./run.sh --headless --script scripts/clean.txt --seed 1234 > /tmp/par-$i.json & done; wait; md5sum /tmp/par-*.json`) and confirm every output is identical — this catches wall-clock leakage that a quiet machine hides. |
| 6 | Terminal engineering | Inspection: play it. Then `./run.sh` in one terminal and `kill -9` the process from another; the shell must be usable with no `reset`. Repeat with `Ctrl-C` and `kill -TERM`. Mechanical: `top`/`time` during `--server` with two idle clients — CPU must average under 5% of one core over 10 s (prompt section 5), not 100%. |
| 6 | Build and documentation hygiene | Mechanical: `./build.sh` from clean with networking off; `test.sh` must actually assert (read it — see failure mode 12); `run.json` complete per `CONVENTIONS.md` section 5. Inspection: module split into `sim`/`proto`/`net`/`server`/`client`/`bot`, and `NOTES.md` naming real trade-offs rather than restating the prompt. |

Score each criterion on evidence produced, not on intent. A criterion whose evidence cannot be
produced — the mode is missing, the script grammar is unimplemented, the build fails — scores zero
for that criterion.

---

## 5. Known failure modes for this task

Ordered by how often they are expected and how well they hide.

1. **The fake network.** Server and clients run in one process and share a world object by
   reference; the "protocol" is only exercised by the selftest, or not at all. Tell: the live smoke
   test in section 2 fails, or `--server`/`--client` exist but only the all-in-one `./run.sh` path
   works. Also look for a client that reads any server-owned structure directly.
2. **Prediction that is not prediction.** The client renders whatever the last snapshot said and
   calls it prediction. At 150 ms this is instantly visible as input lag but headless output can look
   fine. Use the "lead distance" check in the table above.
3. **Reconciliation without replay.** The client snaps to the authoritative state on every snapshot
   and discards its unacked commands. Symptom: at high loss the local player stutters backward;
   `mispredictions` is either always 0 (never compared) or enormous.
4. **Lag compensation as a constant.** A fixed rewind (or none) instead of the shooter's reported
   `render_tick` clamped to 50 ticks. Check that `render_tick` is transmitted, stored on the
   projectile, and read at hit time — all three, not just the first.
5. **Deltas against the wrong baseline.** Encoding against the last snapshot *sent* rather than the
   last one *acknowledged*. Everything works at 0% loss and diverges permanently the first time a
   snapshot is dropped, usually without a resync ever firing. This is the single most likely cause of
   `converged:false` in the lossy soak.
6. **Nondeterminism through container iteration.** Entities held in a hash map and iterated in
   map order (Go maps randomize deliberately; Rust `HashMap` is seeded per process; Python `set`
   ordering shifts with insertion history). Symptom: repeated headless runs differ in one hex digit
   of `world_hash`. Requires ordered iteration by entity id everywhere the prompt says "ascending".
7. **Floating point in the simulation.** Positions as `f32`/`f64`, or a `sin`/`cos` call per tick.
   Often survives a single-language run and destroys cross-language comparability.
   `grep -rniE "float|f32|f64|double|math\.(sin|cos|sqrt)"` over the sim and proto modules; hits
   outside rendering and frame pacing are defects.
8. **Wall-clock in the headless path.** `--headless` sleeps in real time, or ticks are derived from
   the system clock, so output varies with machine load and a 3000-tick soak takes 60 s. A virtual
   clock is mandatory; a headless soak should finish in seconds.
9. **`converged` computed dishonestly.** The client hash is read from the server's world, or
   `converged` is a literal `true`, or convergence is compared at a tick where nothing has happened
   yet. Verify by injecting a deliberate divergence (e.g. temporarily disable delta application in a
   scratch copy) and confirming the soak then fails.
10. **u16 sequence wrap.** Naive `>` comparisons on `seq`/`ack` work for the first 65535 packets and
    then permanently reject everything. At 50 Hz a client sends ~65535 packets in ~22 minutes, so a
    3000-tick soak never reaches it. Selftest check 4 is the only guard; read it.
11. **Bots that are not clients.** Bots simulated inside the server, bypassing the protocol. This
    voids the load test entirely — bandwidth, loss handling, and convergence all become meaningless.
    Confirm `--bot --host --port` connects over a real socket to a separately started server.
12. **`test.sh` that asserts nothing.** Runs the commands, ignores exit codes and output, exits 0.
    Read it. It must compare headless output against the recorded `scripts/*.expected.json` with
    `diff`, and must fail if the soak's `converged` is false. `set -euo pipefail` alone does not make
    a pipeline that ends in `| head` fail.
13. **Terminal left in raw mode after a panic.** Restore handler installed for clean exit only.
    Check `Ctrl-C`, `SIGTERM`, and a forced crash.
14. **Busy-wait tick loop.** A `while true` with no sleep, or a 1 ms spin, pegging a core. Common in
    Go and Rust submissions and invisible unless you watch CPU.
15. **Snapshot heartbeat dropped.** Skipping snapshots with no changes saves bytes but starves
    `last_input_tick`, so reconciliation stalls and the client drifts. The prompt requires the empty
    snapshot to still be sent within 32 bytes.
16. **Bounds checks missing in the codec.** Length fields trusted, so a truncated frame indexes past
    the buffer. Fuzz it (failure mode 1's check); a crash here is a hard fail of the protocol
    criterion regardless of how good the rest is.

---

## 6. Recording notes

Record in the run's result entry, beyond pass/fail: `converged` for both the clean and lossy
headless scripts; `mispredictions` and `resyncs` from the lossy run; the soak's
`bytes_down_per_client_per_sec`, `snapshots_full`/`snapshots_delta` ratio, and
`frames_dropped`/`frames_duplicated`; soak wall-clock; and whether the live three-terminal smoke test
passed. Those numbers are the comparison axis between the vanilla and llama-harness runs for this
task — a pass/fail bit alone throws away most of what this rung measures.
