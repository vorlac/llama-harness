# Acceptance: `tui-games/roguelike`

Operator-facing companion to `tui-games/tui-roguelike-impl-prompt.md`. The prompt is what the
model under evaluation reads; this file is what you read when you score the result. Section
references of the form R*n*, T*n*, H*n* point at the numbered requirements in that prompt.
Repository-wide rules (run IDs, workspace layout, `run.json`, the three-script contract) are in
`CONVENTIONS.md` — this file does not restate them.

- **Task id:** `roguelike` · **Category:** `tui-games` · **Size:** L · **Difficulty:** 8/10
- **Languages:** `rust`, `go`, `cpp`, `python`, `ts`
- **Starting material:** none. This is greenfield.
- **Verify command:** `./test.sh` in the language workspace.
- **Timeouts:** build 300 s, run 300 s, test 900 s.

---

## 1. Seeding a workspace

```sh
tools/new_workspace.sh <run-id> roguelike <language>
# e.g.
tools/new_workspace.sh qwen3.6-27B__vanilla roguelike rust
```

This creates `tui-games/solutions/<run-id>/roguelike/<language>/` and seeds `run.json`. There
is no starting code to copy: `starting_material` is `null`. Hand the model the prompt file
verbatim with `{{LANGUAGE}}` and `{{RUN_ID}}` substituted; substitute nothing else.

Nothing under `tui-games/tasks/roguelike/` is ever modified by a run. If a solution writes
there, that is a rule violation, not a bug — record it and score the run's build/invocation
criterion at zero.

---

## 2. Running the verification

```sh
cd tui-games/solutions/<run-id>/roguelike/<language>

./build.sh                                   # must exit 0, offline
./run.sh --selftest; echo "exit=$?"          # must exit 0, prints one line per H7 check
./test.sh; echo "exit=$?"                    # the scored gate

# reproduce the headless contract by hand
SEED=$(sed -n 's/^# seed: *//p' tests/scripts/smoke.keys | head -1)
./run.sh --headless --script tests/scripts/smoke.keys --seed "$SEED" > /tmp/rg-a.json
./run.sh --headless --script tests/scripts/smoke.keys --seed "$SEED" > /tmp/rg-b.json
cmp /tmp/rg-a.json /tmp/rg-b.json && echo "deterministic across processes"
cmp /tmp/rg-a.json tests/expected/smoke.json && echo "matches committed baseline"
wc -l < /tmp/rg-a.json                        # must be exactly 1
```

Run the whole thing with no TTY to catch code that secretly needs one:

```sh
./run.sh --headless --script tests/scripts/smoke.keys --seed "$SEED" < /dev/null | cat
./run.sh --selftest < /dev/null | cat
```

Both must still work. A solution that opens `/dev/tty`, emits escape sequences, or blocks
waiting for a key in headless mode fails H1.

Interactive spot-check (needs a real 80×24 terminal):

```sh
./run.sh --seed 12345
# play a few turns, then Ctrl-C
stty -a | grep -q icanon && echo "cooked mode restored"   # T3
```

---

## 3. The headless JSON schema

One line, compact separators, keys in exactly this order (H4). Any deviation in key set,
order, or spacing is a contract failure regardless of whether the values are right.

```json
{"schema":"tui-roguelike/1","seed":12345,"turns":812,"depth":3,"max_depth":3,"status":"alive","player":{"level":4,"xp":72,"hp":21,"max_hp":34,"nutrition":947,"accuracy":8,"evasion":3,"armor":5},"equipment":{"weapon":"short sword +1","body":"leather armor +0","head":"none","ring":"none"},"inventory":["a) 2 food rations","b) potion of healing","c) scroll labelled XYZZY"],"statuses":["poisoned:7"],"gold":140,"kills":17,"has_amulet":false,"monsters_alive":9,"items_on_floor":6,"explored":812,"map_digest":"9f13c0a8b5d24e71","view":["#########","#.......#","#..!....#","#...r...#","#...@...#","#.......#","#####+###","         ","         "],"messages_tail":["You hit the giant rat.","The giant rat dies."],"death":null}
```

| Key | Type | Constraint |
|---|---|---|
| `schema` | string | exactly `tui-roguelike/1` |
| `seed` | int | equals the `--seed` argument |
| `turns` | int | scheduler `turn_counter` (R17), monotonic, ≥ 0 |
| `depth` | int | 1–8 |
| `max_depth` | int | 1–8, ≥ `depth` |
| `status` | string | `alive` \| `dead` \| `escaped` \| `quit` \| `saved` |
| `player` | object | keys in order `level`, `xp`, `hp`, `max_hp`, `nutrition`, `accuracy`, `evasion`, `armor`; all int |
| `equipment` | object | keys in order `weapon`, `body`, `head`, `ring`; display names per R30 or `"none"` |
| `inventory` | array[string] | letter order, `"a) 2 food rations"` form, ≤ 26 entries |
| `statuses` | array[string] | `"kind:remaining"`, sorted by kind ascending |
| `gold` | int | ≥ 0 |
| `kills` | int | ≥ 0 |
| `has_amulet` | bool | |
| `monsters_alive` | int | living monsters on the current level, ≤ 20 |
| `items_on_floor` | int | item stacks on the current level's floor, gold piles included |
| `explored` | int | explored tiles on the current level, ≤ 3200 |
| `map_digest` | string | 16 lowercase hex digits, FNV-1a 64 per H5 |
| `view` | array[9] of 9-char strings | 9×9 window, player at `view[4][4]` |
| `messages_tail` | array[string] | ≤ 5 entries, oldest first |
| `death` | object\|null | on death: keys in order `cause`, `killer`, `depth`, `turn` |

Structural check, independent of the implementation's own baselines:

```sh
python3 - "$PWD/tests/expected/smoke.json" <<'PY'
import json, sys, re
line = open(sys.argv[1], 'rb').read()
assert line.endswith(b'\n') and line.count(b'\n') == 1, "must be exactly one line"
assert b', ' not in line and b'": ' not in line, "must use compact separators"
d = json.loads(line, object_pairs_hook=lambda kv: kv)
keys = [k for k, _ in d]
assert keys == ["schema","seed","turns","depth","max_depth","status","player","equipment",
                "inventory","statuses","gold","kills","has_amulet","monsters_alive",
                "items_on_floor","explored","map_digest","view","messages_tail","death"], keys
o = dict(d)
assert o["schema"] == "tui-roguelike/1"
assert [k for k, _ in o["player"]] == ["level","xp","hp","max_hp","nutrition","accuracy","evasion","armor"]
assert [k for k, _ in o["equipment"]] == ["weapon","body","head","ring"]
assert re.fullmatch(r"[0-9a-f]{16}", o["map_digest"])
view = o["view"]
assert len(view) == 9 and all(len(r) == 9 for r in view), "view must be 9x9"
assert view[4][4] == "@", "player must be at the centre of the view"
assert o["status"] in ("alive","dead","escaped","quit","saved")
print("schema ok")
PY
```

Independent digest check — the FNV-1a implementation is verifiable without the game:

```sh
python3 - <<'PY'
M=(1<<64)-1
def fnv(b):
    h=0xcbf29ce484222325
    for c in b: h=((h^c)*0x100000001b3)&M
    return format(h,'016x')
print(fnv(b""), fnv(b"hello"), fnv(b"the quick brown fox"))
# cbf29ce484222325 a430d84680aabd0b 59aeb7b40bd8c122
PY
```

If the solution ships a helper that hashes a file, feed it those three strings. If it does not,
have it print the canonical map string for one seed/depth to stderr and hash it yourself, then
compare with `map_digest`.

---

## 4. Scored criteria and how to check them

Weights match §9 of the prompt and sum to 100. "Mechanical" means a command or script settles
it; "inspection" means you read code or play the game. Award partial credit per sub-item.

| Pts | Criterion | How to check |
|---|---|---|
| 10 | **Build and invocation** (T2, T6, T8, deliverables) | Mechanical: `./build.sh` exits 0 with the network off (`unshare -n` / offline VM). `./run.sh --selftest`, `--headless`, `--save`, `--load` all accepted. Force each exit code: no args in a 40×10 terminal → 2; a save file with `"format_version": 99` → 3; a deliberately failing selftest build → 4. Inspection: all seven required files (`build.sh`, `run.sh`, `test.sh`, `README.md`, `NOTES.md`, `MODULES.md`, `run.json`) present and non-empty. |
| 12 | **Headless determinism and JSON contract** (H1–H6) | Mechanical: the §3 structural checker on all three expected files; run each script twice and `cmp`; run under `env -i` and from a different working directory and `cmp` again; `./run.sh --headless --script tests/scripts/smoke.keys --seed "$SEED" 2>/dev/null \| wc -l` is 1. Grep the source for language RNG (`rand::`, `math/rand`, `random.`, `Math.random`, `std::rand`), `time(`/`now()`, and unordered-map iteration in game logic. |
| 10 | **Dungeon generation** (R5–R13) | Mechanical: `map-connectivity` and `map-determinism` selftests; `map_digest` differs for two seeds with the same script; dump depth 1–8 for one seed and confirm 80×40, border walls, `<` present, `>` present except depth 8. Inspection: BSP with the stated constants and split rule, the door predicate of R9, the R11 repair loop — a generator that *retries* generation until a flood fill passes is not R11 (it yields a different map for the same `(seed, depth)` than a spec-exact implementation), so award nothing for connectivity and note it. |
| 10 | **Field of view** (R14–R16) | Mechanical: `fov-symmetry` and `fov-radius` selftests. Inspection: it is an octant shadowcast, not a ray cast to every perimeter tile and not a flood fill; explored tiles are stored per level and survive save/load; `view` shows remembered items but never remembered monsters. |
| 12 | **Pathfinding and AI** (R22–R24) | Mechanical: `astar-optimal` selftest. Inspection + play: an archer at range 5 fires and at range 1 retreats; a cave imp at ≤ 30% HP runs; a zombie ignores the player until adjacent or a 25% wake roll fires; the open-set tie-break is `(f,h,y,x)`; diagonal corner-cutting is blocked. Cross-check by scripting a run that walks into an archer's line and confirming the summary's `hp` drop. |
| 8 | **Turn scheduler** (R17–R19) | Mechanical: `scheduler-rates` selftest — the numbers 1500/1000/600 are exact, not approximate. Inspection: energy accrual is a single pass in actor-id order and the actor chosen is highest-energy with lowest-id tie-break; reject any `for actor in actors: take_turn()` round-robin with a speed counter bolted on. |
| 10 | **Items, inventory, equipment** (R25–R31) | Mechanical: `inventory-invariants` selftest; a script that picks up two identical potions and shows one stack of 2; a script that equips a cursed item and then attempts `T` (the summary's `equipment` must be unchanged). Inspection: the R28 tables reproduced exactly; generation weights 30/25/15/12/12/6; appearance permutation shuffled per game with Fisher–Yates; identification is per type, not per instance. |
| 10 | **Rules fidelity** (R32–R37) | Mechanical: `xp-table` and `status-expiry` and `hunger-thresholds` selftests. Inspection: the R33 formula verbatim — `d(20)`, natural 1 always misses, natural 20 always hits and doubles the pre-armor total, `max(1, …)` floor; statuses are one generic mechanism applicable to monsters, not seven bespoke booleans on the player. |
| 8 | **Save/load, permadeath, death log** (R38–R40) | Mechanical: `save-roundtrip` selftest; the H8.4 split-script equivalence in `test.sh`; the save file is gone after `--load`; a mutated `format_version` exits 3. Kill the player with a scripted run and validate `deaths.log` with `python3 -c "import json,sys;[json.loads(l) for l in open('deaths.log')]"`, then check the key order and that `timestamp` appears in the log but **not** in the summary. |
| 6 | **Module structure** (T7) | Mechanical: `find . -name '*.<ext>' -not -path './target/*' \| wc -l` ≥ 16 (T7 names sixteen concerns, one file each); `wc -l` on each source file ≤ 600; grep the rules modules for imports of the render/input modules — zero hits required. Inspection: `MODULES.md` maps every file to one concern and the map matches reality. |
| 4 | **Interface quality** (R41–R43, T3–T5) | Inspection + play: layout rows/columns as specified, every key in R43 bound, `m` scrolls history, duplicate messages collapse with `(xN)`. `Ctrl-C` mid-game then `stty -a` shows `icanon` restored; kill -TERM likewise; force a panic (e.g. `--load` a truncated save) and confirm the terminal is restored. Watch CPU with `top` while idle at a prompt — it must be ~0%. |

### Automatic zeros

- `test.sh` exits 0 but runs none of the five H8 items (read it before trusting it).
- `--selftest` prints `ok` lines for checks whose bodies are empty, `return true`, or wrapped in
  a `try/except: pass`. Diff the check names against H7 and read each body.
- Expected files under `tests/expected/` were hand-written rather than produced by the program;
  detect by regenerating them and comparing.
- Headless mode prints anything to stdout besides the single summary line.

---

## 5. Known failure modes for this game

Watch for these specifically; they recur in roguelike implementations and several of them
produce a green `test.sh` while the requirement is unmet.

1. **Round-robin wearing an energy costume.** Every actor gets one turn per tick and `speed`
   only scales damage or a movement counter. `scheduler-rates` catches it only if it is a real
   simulation of the scheduler rather than of a re-derived formula — read the check's body.
2. **Asymmetric FOV.** A ray-cast-to-perimeter or naive Bresenham FOV passes casual play and
   fails `fov-symmetry` on ~1 pair in 50. If the check samples only wide-open rooms it will pass
   anyway; confirm the sampled pairs include tiles near walls and doorways.
3. **Non-deterministic iteration order.** Monsters, items, or effects stored in a hash map and
   iterated during a turn. Symptom: `--headless` output differs between processes but not within
   one process, or differs only under a different hash seed
   (`PYTHONHASHSEED=1` vs `PYTHONHASHSEED=2`, Go map iteration). Always run the determinism
   comparison in two separate processes, and for python run it under two different
   `PYTHONHASHSEED` values.
4. **RNG state not saved.** Save/load looks fine because a fresh RNG still produces *plausible*
   play; the split-script test is the only thing that catches it. Verify `test.sh` really
   performs H8.4 and does not compare a summary against itself.
5. **A save key that costs a turn.** `S`, `Q` and the overlay keys are zero-cost by R18; if
   any of them accrues or spends energy, the H8.4 split run gains a turn the unsplit run never
   had and the two summaries differ in `turns` — which looks like broken save/load and is not.
6. **Save-scum survives.** The save file is not deleted on load, or death does not delete it.
   Check with `ls` after each.
7. **Levels regenerate on revisit.** Going `>` then `<` produces a different map or resurrects
   monsters. Script a descend/ascend pair and compare `map_digest` before and after; it must be
   identical apart from doors opened in between.
8. **Connectivity by luck.** The generator retries generation until a flood fill passes instead
   of running R11's repair loop, and with no bound some seed hangs. Run `map-connectivity`
   over seeds 1–50 under `timeout 120`.
9. **Identification leaks.** The summary's `inventory` or `equipment` shows the true name of an
   unquaffed potion or the enchantment of an unidentified weapon. Read a fresh-start summary:
   with the R37 kit the only identified consumable is the potion of healing, and only the
   starting `dagger +0` and `leather armor +0` legitimately show an enchantment.
10. **Curse escape hatches.** Dropping a cursed equipped item, or equipping over it, silently
    removes it. Script both and check `equipment`.
11. **Off-by-one hunger and status boundaries.** `Weak` at 150 instead of 149, or an effect that
    lasts 6 turns because the countdown happens before the effect applies. R34 fixes the order:
    poison damage first, then decrement, then expire at 0.
12. **`view` window wrong at map edges or on stairs.** Out-of-map cells must be a single space,
    not `#` and not omitted; the row strings must always be exactly 9 characters.
13. **Terminal left in raw mode on panic.** Common when the restore lives only in the normal
    exit path. Force a panic and check `stty -a`.
14. **One 3000-line file with section-comment "modules".** T7 is about files and dependency
    direction, not comments; check with `wc -l` and grep for cross-imports.
15. **`--headless` implemented as a separate simplified simulation.** The headless driver must
    run the same game code as interactive play; if the two diverge, the summary measures nothing.
    Read the entry point: the difference should be an input source and a renderer, nothing more.
