# Acceptance — `tetris-enhanced` (tui-games, size M+)

Operator-facing companion to `tui-games/tui-tetris-enhancements-prompt.md`. The
prompt is what the model sees; this file is what the person running and scoring
the task uses. Sections marked **§n** refer to the prompt; `CONVENTIONS.md`
references are to the repository contract at the tree root.

This is the **modify-an-existing-codebase** rung of the `tui-games` ladder. The
measurement is whether the model can operate inside code it did not design.
Everything below exists to keep that measurement honest.

---

## 1. Seeding the workspace

The workspace is **not** empty at hand-off. It starts as a copy of a completed
`tetris` solution from the *same run*.

### 1.1 Precondition

A completed `tetris` solution must already exist for this run and language:

```
tui-games/solutions/<run-id>/tetris/<lang>/
```

**If it does not exist, the task is skipped — not attempted from scratch.**
Record the skip in the run's results as `skipped: no seed material`. A
from-scratch submission is not comparable to a modification submission and must
never be scored as one. The prompt states the same rule in §0, so a model that is
handed an unseeded workspace should refuse rather than build.

Normally the seed is the *same run's own* vanilla tetris output. Cross-seeding
(handing run B the tetris solution produced by run A) is a legitimate experiment
— it isolates "can you modify unfamiliar code" from "can you modify your own
code" — but it must be recorded explicitly in `run.json`'s `notes`, because the
two are not comparable to each other.

### 1.2 Steps

```sh
# 1. create the workspace at the canonical four-level path (CONVENTIONS.md §4)
tools/new_workspace.sh <run-id> tetris-enhanced <lang>

# 2. copy the completed tetris solution in as the starting point
SRC=tui-games/solutions/<run-id>/tetris/<lang>
DST=tui-games/solutions/<run-id>/tetris-enhanced/<lang>
cp -a "$SRC"/. "$DST"/

# 3. the copied run.json belongs to the tetris task - re-point it
#    (task_id must become tetris-enhanced; keep model/harness_variant/run_id)

# 4. snapshot the pristine seed BEFORE the model touches anything.
#    This snapshot is the diff baseline for scoring criterion 1.
mkdir -p results/baselines
( cd "$DST" && find . -type f -not -path './.git/*' -print0 \
    | sort -z | xargs -0 shasum -a 256 ) \
  > results/baselines/<run-id>__tetris-enhanced__<lang>.sha256
cp -a "$DST" results/baselines/<run-id>__tetris-enhanced__<lang>.seed

# 5. hand the model tui-games/tui-tetris-enhancements-prompt.md
#    with {{RUN_ID}} and {{LANGUAGE}} substituted
```

Step 4 is mandatory. Without the baseline there is no mechanical way to tell an
extension from a rewrite, and criterion 1 is worth 18 points plus a total cap.

Do **not** copy build outputs into the snapshot comparison. Exclude the usual
per-language build directories when diffing: `target/`, `node_modules/`, `dist/`,
`build/`, `__pycache__/`, `*.o`, `bin/`, `obj/`.

### 1.3 Pristine material

`tui-games/tasks/tetris-enhanced/` is read-only reference material
(`CONVENTIONS.md` §10). Neither operator nor model edits it. The seeded tetris
solution under `tui-games/solutions/<run-id>/tetris/<lang>/` is likewise
untouched — the model works only in the `tetris-enhanced` workspace.

---

## 2. Running the verification

From the repository root, with `WS` set to the workspace:

```sh
WS=tui-games/solutions/<run-id>/tetris-enhanced/<lang>
cd "$WS"

./build.sh                       # timeout 300s, must exit 0, must work offline
./run.sh --help                  # must exit 0 and print the §6.1 flag surface
./run.sh --selftest              # must exit 0, must print all twelve checks
./test.sh                        # timeout 900s, must exit 0
```

Timeouts come from `task.json`: build 300s, run 300s, test 900s. The test budget
is generous because the AI gate (§5.5) simulates up to 200 000 ticks.

Offline check — run the build with the network removed, not merely unused:

```sh
# macOS / Linux, whichever isolation you have available
unshare -rn ./build.sh          # linux
# or run the whole scoring pass on a host with no route
```

`score.py` records build/run/test status per `CONVENTIONS.md` §9. Correctness for
this category comes from `test.sh`'s exit code plus the manual criteria in §5
below, not from parsed stdout — but the JSON summary line is still parsed, so it
must be clean.

---

## 3. The headless verification contract

Interactive TUI programs cannot be scored by a script unless they can be driven
without a terminal. Every task in this category therefore requires:

```
./run.sh --headless --script <path> --seed <n>
```

replays a newline-delimited input script and, on exit, prints a deterministic
one-line JSON summary of final game state to stdout, and

```
./run.sh --selftest
```

runs built-in invariant checks and exits non-zero on failure.

**Given the same seed and the same input script, the JSON summary must be
byte-identical across runs.** `test.sh` must exercise at least one recorded
script and assert the exact expected summary line.

### 3.1 Input script grammar (prompt §6.2)

A strict superset of the base `tetris` task's grammar (its §7.2), so any script
the seeded solution accepted must still parse identically. UTF-8, LF endings, one
command per line, uppercase and exact:

| Line | Effect |
|---|---|
| `L` `R` | move left / right, then advance 1 tick |
| `CW` `CCW` `FLIP` | rotate CW / CCW / 180°, then advance 1 tick |
| `SD` `HD` | soft drop one row / hard drop and lock, then advance 1 tick |
| `HOLD` | hold, then advance 1 tick |
| `PAUSE` `RESTART` | toggle pause / restart the mode, then advance 1 tick |
| `QUIT` | end the run with status `quit`; consumes 1 tick |
| `UP` `DOWN` `SELECT` | menu navigation, 1 tick each |
| `TICK <n>` | advance `n` ticks with no input, `1 <= n <= 100000` |
| *(blank)* | ignored; advances nothing |
| `# ...` | comment; ignored; advances nothing |

Commands are **actions**, not keystrokes — scripts bypass the keybinding layer,
so a script's meaning never depends on `config/keys.conf`. A malformed line is
fatal: `error: line <N>: <message>` on stderr, exit **3**. Script exhaustion ends
the run with status `script_end`.

Program exit statuses: `0` normal, `1` `--verify-replay` mismatch, `2` usage or
configuration error, `3` malformed input script.

### 3.2 Exact JSON summary schema

This supersedes the base task's summary: string `schema`, no booleans, no nulls,
no nested objects or arrays; `board_hash` renamed to `board_sha256`; the base's
boolean `hold_used` replaced by the integer counter `holds`.

One line on stdout, compact separators (`,` and `:`, no spaces), keys in exactly
this order, all values integers or strings, a single trailing `\n`, and nothing
else on stdout.

```
{"schema":"tui-tetris-enhanced/1","mode":"marathon","seed":12345,"attack":1,"ai":0,"status":"topout","ticks":4212,"pieces":213,"score":18400,"lines":47,"level":5,"singles":10,"doubles":6,"triples":3,"tetrises":4,"tspins":2,"tspin_minis":1,"max_combo":5,"b2b_max":3,"garbage_sent":21,"garbage_received":18,"holds":31,"hold":"T","next":"IJOSZ","active":"","board":"........../........../........../........../........../........../........../........../........../........../........../........../........../....T...../...TTT..../ZZ...LLL../IZZ..L..OO/IJJJSS..OO/#J..SS.###/##.#######","board_sha256":"351a4fca01d38d1dd23499369b654821468b3914b7b053af7e3b2426c0733fcb","input_sha256":"13fb7c9d338c0850ce3ce4e104cdc258505e23b0f378977cae575e5e3022bc86"}
```

(Values are illustrative; the `board` string is a real 219-character example and
`board_sha256` is its actual digest.)

| Key | Type | Meaning |
|---|---|---|
| `schema` | string | literal `tui-tetris-enhanced/1` |
| `mode` | string | `marathon` \| `sprint` \| `ultra` |
| `seed` | int | seed actually used |
| `attack` | int | `0` or `1` |
| `ai` | int | `0` or `1` |
| `status` | string | `topout` \| `goal` \| `quit` \| `tick_limit` \| `script_end`, in that precedence order |
| `ticks` | int | simulation ticks elapsed, menu ticks included |
| `pieces` | int | pieces locked |
| `score` | int | final score |
| `lines` | int | total lines cleared |
| `level` | int | final level |
| `singles` `doubles` `triples` `tetrises` | int | locks clearing exactly 1/2/3/4 lines; T-spin clears counted here too |
| `tspins` | int | locks classified full T-spin, 0-line included |
| `tspin_minis` | int | locks classified mini T-spin, 0-line included |
| `max_combo` | int | highest combo counter reached, `0` if never ≥ 1 |
| `b2b_max` | int | highest back-to-back chain reached, `0` if never |
| `garbage_sent` | int | attack lines generated after bonuses, before cancellation; `0` outside `--attack` |
| `garbage_received` | int | garbage rows actually inserted; `0` outside `--attack` |
| `holds` | int | successful hold swaps over the run |
| `hold` | string | held piece letter, or `""` when the slot is empty |
| `next` | string | next queue as letters in order, using the seed's inherited queue length |
| `active` | string | live piece as `TYPE:ROT:ROW:COL` in the seed's coordinate convention, or `""` when none |
| `board` | string | 20 visible rows, top first, joined by `/`, exactly 219 characters; each row 10 chars from `.` `I` `J` `L` `O` `S` `T` `Z` `#`; active piece and ghost **excluded** |
| `board_sha256` | string | lowercase hex SHA-256 of `board`'s UTF-8 bytes |
| `input_sha256` | string | lowercase hex SHA-256 of the run's canonical input log (prompt §5.3 F7) — the bytes this run would write as lines 3+ of a replay — not of the `--script` file as written. Same value for a recording and any replay of it; digest of the empty string, `e3b0c442…b7852b855`, when the run executed no input. |

Byte-identity is required across repeat runs of one implementation, at any host
speed. It is **not** required across languages for this task — unlike the base
`tetris` task — because the inherited rules of prompt §4 (gravity table, lock
delay, queue length) legitimately differ between seed implementations. Do not
score a cross-language summary mismatch as a defect here.

Validator:

```sh
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --mode marathon \
  | python3 -c '
import json,sys,re
raw = sys.stdin.buffer.read()
assert raw.endswith(b"\n") and raw.count(b"\n") == 1, "not exactly one line"
assert b", " not in raw and b": " not in raw, "non-compact separators"
line = raw.decode().rstrip("\n")
pairs = json.loads(line, object_pairs_hook=lambda p: p)
keys = [k for k, _ in pairs]
want = ["schema","mode","seed","attack","ai","status","ticks","pieces","score",
        "lines","level","singles","doubles","triples","tetrises","tspins",
        "tspin_minis","max_combo","b2b_max","garbage_sent","garbage_received",
        "holds","hold","next","active","board","board_sha256","input_sha256"]
assert keys == want, f"key order/set wrong: {keys}"
d = dict(pairs)
for k, v in d.items():
    assert isinstance(v, (int, str)) and not isinstance(v, bool), f"{k} is {type(v)}"
assert d["schema"] == "tui-tetris-enhanced/1"
assert d["status"] in {"topout","goal","quit","tick_limit","script_end"}
assert len(d["board"]) == 219, "board must be 219 chars"
rows = d["board"].split("/")
assert len(rows) == 20 and all(re.fullmatch(r"[.IJLOSTZ#]{10}", r) for r in rows)
import hashlib
assert d["board_sha256"] == hashlib.sha256(d["board"].encode()).hexdigest(), "bad board digest"
assert re.fullmatch(r"[0-9a-f]{64}", d["input_sha256"])
assert d["hold"] == "" or re.fullmatch(r"[IJLOSTZ]", d["hold"])
assert re.fullmatch(r"[IJLOSTZ]*", d["next"])
assert d["active"] == "" or re.fullmatch(r"[IJLOSTZ]:[0-3]:-?\d+:-?\d+", d["active"])
print("summary schema OK")
'
```

### 3.3 Replay file format (prompt §5.3)

```
#!tetris-replay 1
{"seed":12345,"mode":"marathon","attack":1,"ai":0,"ticks":4212,"score":18400,"lines":47,"summary_sha256":"<64 hex>"}
<canonical input log, exactly the §6.2 grammar, lines 3 onward>
```

`attack` and `ai` are the integers `0`/`1`, never JSON booleans. `summary_sha256`
is the SHA-256 of the recorded run's summary line **including its trailing
newline**. Lines 3+ are the canonical input log (prompt §5.3 F7): no comments, no
blank lines, input-free ticks collapsed maximally, only the ticks the run
actually executed — so they are usable verbatim as a `--script` file, and running
them reproduces the recorded summary byte for byte, `input_sha256` included.

---

## 4. Mechanical checks

Run these from inside the workspace after `./build.sh`. Every one of them is
scriptable; the numbered results feed the rubric table in §5.

### C1 — determinism, twice

```sh
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --mode marathon > /tmp/a
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --mode marathon > /tmp/b
cmp /tmp/a /tmp/b && echo "C1 pass"
```

Any difference fails the **determinism gate**: rubric criteria 2 and 3 score 0.

### C2 — determinism under load and under a slow host

```sh
# same run with the process artificially starved; output must not change
nice -n 19 ./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --mode marathon > /tmp/c
cmp /tmp/a /tmp/c && echo "C2 pass"
```

A mismatch means the simulation is coupled to wall-clock time in headless mode
(prompt F3).

### C3 — no clock reads in headless

```sh
# Linux
strace -f -e trace=clock_gettime,gettimeofday,time \
  ./run.sh --headless --script tests/scripts/basic.txt --seed 12345 2>&1 >/dev/null \
  | grep -c 'clock_gettime\|gettimeofday' 
# macOS
sudo dtruss -f ./run.sh --headless --script tests/scripts/basic.txt --seed 12345 2>&1 >/dev/null | grep -i 'gettime'
```

Runtime startup will make some clock calls in most languages; what matters is
that no clock value reaches game state. If C1 and C2 pass, treat this as
informational and confirm by inspecting the tick source.

### C4 — replay round trip

```sh
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --mode marathon \
         --record /tmp/rt.rply > /tmp/orig
./run.sh --headless --replay /tmp/rt.rply > /tmp/back
cmp /tmp/orig /tmp/back && echo "C4 pass"
./run.sh --verify-replay /tmp/rt.rply          # must print 'replay ok ...' and exit 0
tail -n +3 /tmp/rt.rply > /tmp/extracted.txt   # input section must be a valid script
./run.sh --headless --script /tmp/extracted.txt --seed 12345 --mode marathon | cmp - /tmp/orig
```

Then corrupt the header digest and confirm the tool notices:

```sh
sed '2s/"summary_sha256":"[0-9a-f]*"/"summary_sha256":"'"$(printf '0%.0s' $(seq 64))"'"/' \
  /tmp/rt.rply > /tmp/bad.rply
./run.sh --verify-replay /tmp/bad.rply; test $? -eq 1 && echo "C4 mismatch detected"
```

### C5 — AI gate

```sh
for s in 12345 1 777 20260820; do
  ./run.sh --headless --ai --seed $s --mode marathon --max-ticks 200000 \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sys.argv[1], d["lines"], d["status"])' $s
done
```

Seed `12345` must report `lines` ≥ 40 — that is a hard pass/fail gate. At least
two of `1`, `777`, `20260820` must also reach 40.

Also confirm the AI is recordable, which proves it goes through the normal input
path rather than placing pieces directly:

```sh
./run.sh --headless --ai --seed 12345 --mode marathon --max-ticks 200000 --record /tmp/ai.rply > /tmp/ai1
./run.sh --headless --replay /tmp/ai.rply > /tmp/ai2
cmp /tmp/ai1 /tmp/ai2 && echo "C5 AI replay pass"
```

### C6 — T-spins

```sh
./run.sh --headless --script tests/scripts/tspin.txt --seed 1 --mode marathon \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["tspins"]>=1, d; print("C6 pass", d["tspins"], d["score"])'
```

Then read the scoring code against the prompt §5.6 F14 table. The three things
that are almost always wrong: the kick-index-5 override, the mini-vs-full
front-corner rule, and back-to-back flooring (`floor(value * 1.5)`, applied to
the line-clear value only, never to drop points or combo points).

### C7 — attack mode

```sh
./run.sh --headless --script tests/scripts/attack.txt --seed 99 --mode marathon --attack \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["garbage_received"]>0, d; print("C7 pass", d["garbage_sent"], d["garbage_received"])'
```

Confirm from the summary `board` that garbage rows appear as `#` and that rows
inserted in one batch share a hole column. The opponent schedule is fully
determined by `seed XOR 0xDEADBEEFCAFEBABE` and the draw order in prompt §5.7
(first `n`, then `interval`, and `h` at insertion time) — reimplement those three
draws in ten lines of Python and check the first event's `n` against the
submission if a value looks suspicious.

### C8 — high scores

```sh
rm -rf /tmp/hsdata

# headless without --persist must not create the file
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --data-dir /tmp/hsdata > /dev/null
test ! -f /tmp/hsdata/highscores.json && echo "C8a pass"

# headless with --persist must create it
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --data-dir /tmp/hsdata \
         --persist --name OPER > /dev/null
python3 -m json.tool /tmp/hsdata/highscores.json > /dev/null && echo "C8b pass"

# corrupt file must be tolerated: one stderr warning, empty table, exit 0
printf '{ not json' > /tmp/hsdata/highscores.json
./run.sh --headless --script tests/scripts/basic.txt --seed 12345 --data-dir /tmp/hsdata \
         --persist > /tmp/hs.out 2> /tmp/hs.err
echo "exit=$?"; test -s /tmp/hs.err && echo "C8c warned on stderr"
test "$(wc -l < /tmp/hs.out)" -eq 1 && echo "C8d stdout still clean"
```

Cap and ordering: write a fixture with 20 entries into `highscores.json`, run one
persisting game, and confirm exactly 10 remain per mode in the prompt §5.2 order
(marathon/ultra: score ↓, lines ↓, ticks ↑, seed ↑, name ↑; sprint: lines ↓,
ticks ↑, score ↓, seed ↑, name ↑). Atomicity: `strace`/`dtruss` for a
`rename(2)`, or simply confirm no `highscores.json.tmp` survives a normal exit.

### C9 — keybinding config

```sh
# defaults parse
./run.sh --headless --config config/keys.conf --script tests/scripts/basic.txt --seed 12345 >/dev/null && echo "C9a pass"

# duplicate key is fatal with exit 2
printf 'move_left = a\nhold = a\n' > /tmp/dup.conf
./run.sh --config /tmp/dup.conf --headless --script tests/scripts/basic.txt --seed 12345; test $? -eq 2 && echo "C9b pass"

# unknown action/key warns but continues
printf 'no_such_action = a\nmove_left = NotAKey\n' > /tmp/bad.conf
./run.sh --config /tmp/bad.conf --headless --script tests/scripts/basic.txt --seed 12345 2>/tmp/cfg.err >/dev/null \
  && grep -q '^config: line ' /tmp/cfg.err && echo "C9c pass"

# missing file is silently fine
./run.sh --config /tmp/definitely-absent.conf --headless --script tests/scripts/basic.txt --seed 12345 >/dev/null 2>/tmp/none.err \
  && test ! -s /tmp/none.err && echo "C9d pass"
```

### C10 — CLI hygiene

```sh
./run.sh --help >/dev/null && echo "help ok"
./run.sh --not-a-flag; test $? -eq 2 && echo "unknown flag exits 2"
./run.sh --headless --replay /tmp/rt.rply --seed 999; test $? -eq 2 && echo "conflicting flags exit 2"
```

### C11 — seed diff, for criterion 1

```sh
BASE=results/baselines/<run-id>__tetris-enhanced__<lang>.seed
WS=tui-games/solutions/<run-id>/tetris-enhanced/<lang>
diff -ru --exclude=target --exclude=node_modules --exclude=dist --exclude=build \
         --exclude=__pycache__ --exclude=.git "$BASE" "$WS" > /tmp/seed.diff
# how many seeded files survive at all
comm -12 <(cd "$BASE" && find . -type f | sort) <(cd "$WS" && find . -type f | sort) | wc -l
# how many are byte-identical
( cd "$WS" && shasum -a 256 -c "../../../../../results/baselines/<run-id>__tetris-enhanced__<lang>.sha256" 2>/dev/null ) | grep -c ': OK$'
```

Guideline for criterion 1: at least **60 %** of the seeded source files should
still exist and be classified `KEPT` or `EXTENDED` in `ARCHITECTURE-NOTES.md`,
with the seed's module boundaries and principal type names intact. Below that,
inspect closely — a submission that deletes most of the seed and reintroduces
equivalent code under new names is a rewrite wearing the seed's directory
structure, and the rewrite gate applies.

---

## 5. Scored criteria

Weights are the prompt's §11 rubric. "How to check" is mechanical where a command
exists and inspection where it does not.

| # | Criterion | Wt | How to check |
|---|---|---|---|
| 1 | Architectural integration — extends the seed, does not replace it | 18 | **C11** for the diff and survival ratio; then read `ARCHITECTURE-NOTES.md` §1 against the diff. Mechanical signal, judged conclusion. |
| 2 | Determinism and the headless contract | 16 | **C1**, **C2**, **C3**; the §3.2 schema validator; `./run.sh --selftest` prints all twelve named checks and exits 0 |
| 3 | Replay record and playback | 9 | **C4** end to end, including the corrupted-digest case and the AI replay in **C5** |
| 4 | AI autoplay | 9 | **C5** for the gate; inspect the eval function for the four features and the exact weights `-0.510066 / 0.760666 / -0.356630 / -0.184483` and the (rotation, column) tie-break |
| 5 | T-spin detection and scoring | 8 | **C6**; selftest checks `tspin_double` and `tspin_mini`; inspect against the §5.6 tables |
| 6 | `ARCHITECTURE-NOTES.md` | 7 | Inspection: eight sections present; every seeded file from the baseline listing appears by name; refactors justified by a named blocked requirement, not by taste; determinism audit names real mechanisms |
| 7 | Garbage attack mode | 6 | **C7**; selftest `garbage_insert`; inspect the send table, the combo bonus tiers, cancel-before-insert ordering, per-batch hole column |
| 8 | Modes and menu | 6 | Run each mode headlessly and confirm the goal conditions and `status`; drive the menu with `--start-at-menu` and a script of `DOWN`/`SELECT`; inspect the eight menu items in a real terminal |
| 9 | Build and test hygiene | 6 | `./build.sh` offline, `./test.sh` exit 0, `test.sh` covers all eight items in prompt §8; `run.json` has every required field from `CONVENTIONS.md` §5; README documents the full CLI |
| 10 | Keybinding config | 5 | **C9** (four cases); `config/keys.conf` matches the prompt F11 defaults verbatim |
| 11 | High-score persistence | 5 | **C8** (four cases) plus the cap/ordering fixture |
| 12 | Resize and terminal restoration | 5 | Inspection in a real terminal — see §6 |

### Two hard gates

- **Rewrite gate.** Seed files replaced wholesale, module structure discarded,
  principal type names gone ⇒ criterion 1 scores 0 and the **total is capped at
  40**, regardless of feature completeness. Record the evidence (the C11 numbers)
  in the result notes.
- **Determinism gate.** Two identical headless invocations producing different
  stdout ⇒ criteria 2 and 3 score 0.

### Manual terminal pass (criterion 12)

```sh
./run.sh                                   # menu appears, arrow keys move selection
                                           # play a game, quit; then:
stty -a | head -1                          # echo/icanon must be back to normal
printf 'test\n'                            # typing must be visible, cursor visible
```

- Resize the window mid-game: playfield stays centred, panels reflow, nothing
  clips or wraps.
- Shrink below 60×24: the too-small screen appears, **the clock stops**. Wait ten
  seconds, enlarge, and confirm play resumes at the tick it paused on — the piece
  has not fallen and the tick counter has not advanced.
- Launch directly in a 50×20 terminal: the too-small screen, not a corrupt frame
  and not an exit.
- Send `SIGINT`, `SIGTERM`, and `SIGHUP` to a running game; after each, the shell
  must be usable with no `stty sane`.
- Force a panic if you can (a deliberately corrupt config, a replay file
  truncated mid-line) and confirm the terminal is still restored.

---

## 6. Known failure modes for this task

Ordered roughly by how often they appear.

1. **The quiet rewrite.** The model reads nothing, writes a fresh well-structured
   implementation, and leaves the seed's file names in place so the tree looks
   familiar. Tell-tales: `ARCHITECTURE-NOTES.md` §1 lists everything as
   `REFACTORED` with generic reasons; the diff shows near-total replacement of
   every file's body; the seed's idiosyncratic names (its odd helper, its
   unusual enum spelling) have vanished. Check **C11** before reading anything
   else.
2. **Terminal left in raw mode after a panic or SIGINT.** Passes every scripted
   check, ruins the operator's shell. Always run the §5 manual pass.
3. **Clock leaking into headless.** The submission renders or steps against wall
   time and the headless path shares that loop, so summaries drift on a loaded
   machine. **C2** catches it; **C1** alone often does not.
4. **Replay bit-inexactness from container iteration order.** Hash maps used for
   per-tick input dispatch or for scoring event aggregation reorder between runs
   in Go, Python (pre-insertion-order sets), Rust `HashMap`, and JS `Set` of
   objects. Shows up as an occasional **C4** mismatch — run C4 five times before
   passing it.
5. **Replay records keystrokes instead of actions.** The replay then depends on
   `keys.conf` and breaks the moment the config differs. Check that the input
   section of a `.rply` uses the §6.2 action tokens.
6. **AI that bypasses the input path.** Places pieces by writing the board
   directly; fast and effective, and completely unrecordable. The AI-replay half
   of **C5** is the check.
7. **AI weights re-derived instead of used.** The model "improves" the heuristic
   with its own weights. The threshold may still pass, but criterion 4 requires
   the specified weights and feature definitions so that two submissions are
   compared on the same function.
8. **T-spin over-detection.** The commonest bug: treating any 3-corner T lock as
   a T-spin without checking `last_action_was_rotation`, or without the
   front-corner split, inflating `tspins` and `score`. Second commonest: clearing
   the rotation flag on gravity but not on hard drop, or vice versa. Verify
   against the selftest cases *and* the F13 flag rules.
9. **Back-to-back applied to the wrong quantity.** Multiplying the total lock
   award (including soft/hard drop and combo points) by 1.5 instead of the
   line-clear value alone; or rounding rather than flooring.
10. **Garbage inserted mid-piece.** Inserting queued rows the instant they arrive
    rather than after the next lock, which shifts the active piece and makes
    replays diverge from the recording.
11. **Cancellation applied after insertion**, so the player never actually cancels
    anything and `garbage_received` is always the full queue.
12. **Headless writing high scores.** Without the `--persist` gate the second
    identical run differs from the first, or the data directory accumulates state
    that changes menu screens. **C8a** catches it.
13. **Non-atomic high-score writes.** Truncate-then-write leaves a zero-byte file
    if the process dies during a save; a later run then crashes on parse instead
    of warning.
14. **Summary key order or types drift.** Booleans for `attack`/`ai`, a float
    score, a `null` level, pretty-printed JSON, or a stray progress line on
    stdout. The §3.2 validator catches all of these; it is the cheapest check in
    this document, so run it first.
15. **`TICK <n>` semantics off by one**, so a script means something different to
    the recorder than to the player and replays drift after the first `TICK`.
    Also watch for the recorder emitting the new commands (`FLIP`, `UP`, `DOWN`,
    `SELECT`) where the base grammar's commands would do, breaking replay
    compatibility with scripts written against the seed.
16. **Modes implemented, menu faked.** The three modes work under `--mode` but the
    menu is a static screen that always starts marathon. Drive it with
    `--start-at-menu` and a `DOWN DOWN SELECT` script.
17. **Minimum-size guard that exits instead of pausing**, or that pauses but keeps
    the tick counter running so the piece has fallen when the window is enlarged.
18. **`build.sh` reaching the network** to fetch the dependency the model added
    for SHA-256 or TOML parsing. Build offline, always.
19. **`ARCHITECTURE-NOTES.md` as boilerplate.** Sections present, content generic
    ("improved separation of concerns"). Criterion 6 requires each refactor to
    name the specific requirement the old structure blocked; if it does not, that
    refactor also counts against criterion 1.
20. **`run.json` still saying `task_id: "tetris"`**, copied in with the seed and
    never updated — which silently files the result under the wrong task in
    `score.py`. Operators should fix this at seed time (step 3 in §1.2) and check
    it again at scoring time.
