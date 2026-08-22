# Watching a run

A conductor cell can run for forty-five minutes. For most of that time the only
thing on screen is the orchestrator's own output, which tells you a model is
generating and nothing about whether the run is getting anywhere. This page is
about the second terminal: a read-only console that tails the run's journal and
answers the question the first terminal cannot — **is it still advancing, and if
not, what is it doing instead?**

The console is `conductor/tools/observe.ts`. It opens files for reading and
nothing else: no handler, no store, no lock, no hook. There is no code path by
which watching a run can perturb it.

---

## If you just want to start a benchmark and watch it

`scripts/run_and_watch.py` starts the benchmark and prints this console beside
two feeds it cannot supply on its own — the driver's own output, and a
scoreboard of every arm's outcome as each cell is scored. It takes no arguments;
every setting is a documented constant at the top of the file.

```bash
/usr/bin/python3 scripts/run_and_watch.py
```

Reach for the rest of this page when you want the console against a run you did
not start from there: one already in flight, one that has finished, or a
preserved journal you are reading after the fact.

---

## The command

While a bench cell is running, in a second terminal at the repository root:

```bash
RUN=$(find "${TMPDIR:-/tmp}/llama-leash-conductor-work" -type d -name 'r-*' -path '*/.conductor/runs/*' -prune \
      | xargs ls -dt | head -1)

node conductor/tools/observe.ts "$RUN" --follow
```

`--follow` polls every two seconds and prints each new row once. It is an
append-only stream, not a repainted screen, so `| tee watch.log` gives you a log
you can read afterwards and paste into a bug report. Stop it with ctrl-C; the run
does not notice either way.

A cell's run directory is
`<work-root>/<model>/<capability>/<arm>/<task>/r<rep>/repo/.conductor/runs/<runId>`,
and the work root defaults to `${TMPDIR}/llama-leash-conductor-work`
(`scripts/conductor_bench.py --work-root` overrides it). If you already know the
run directory, pass it directly.

### The flags

| Flag | What it does |
|------|--------------|
| `--follow` | Tail the journal as it grows. The stall clock runs to **now**. |
| `--console` | Render the whole console once and exit. The stall clock runs to the **newest record**, so an archived run is not reported as stalled by however long ago it ran. |
| `--interval <ms>` | Poll period for `--follow`. Default 2000. |
| `--ledger <path>` | The router's per-request ledger. Default `.data/router/metrics.jsonl`, relative to where you run the command. Optional: absent or unreadable means a timeline with no cost column, never a crash. |
| `--json` | The strain-signal report as JSON (no console). |
| `--bundle <dir>` | Copy the run's files plus the derived report into a directory that survives retention pruning. |

### Turn on the gate records first

The tool-call column is derived from `gates: allow` records, which are journaled
at **debug**. At the default logging level of `info` they are not written at all,
and every turn will read `no-tool-call`. Start the run with:

```bash
CONDUCTOR_LOG=gates:debug
```

That raises the gates component alone, which is the smallest change that fills
the column. `CONDUCTOR_LOG=debug` raises everything and is considerably noisier.

---

## Reading the screen

The header, as `--follow` renders it against a live wall clock:

```
== LIVE CONSOLE r-20260821-0a31 — EXECUTING ==
STALL 36m10s   [ALARM] !!!!!!!!! since fsm/transition -> state EXECUTING at t+465.6s
waiting on turn #23 testWriter (ses_fd99cb8e6ffePg9gPtUWK8hbjZ) — generating for 3m12s
elapsed 43m56s  turns 23  mismatches (unrecorded)  refusals 1  sub-sessions 3
COMPACTION suspected 2 costing 7m53s  tokens 281292 in / 33739 out  (PARTIAL — mechanical, skeptic: …)
```

### The stall clock — the line to read first

`STALL` is the time since the run last **advanced**. An advance is an
`fsm/transition`, or a `state/item.updated` carrying an FSM state the item was
not already in. Generating tokens is not an advance. Reading files is not an
advance. Calling tools is not an advance. A model can do all three continuously
for half an hour without the run moving, and that is precisely the failure this
line exists to name.

Two records that look like movement are deliberately not counted.
`state/decision.recorded` is a note in the §2.7 ledger, and a `state/item.updated`
that carries an annotation rather than a state — an inline claim, a taint entry —
is an item exactly where it was. The preserved run below wrote both, one second
apart, over an item that stayed at `PENDING` for its whole life; a clock that took
them for movement read 28 minutes on a 36-minute stall and reached `[ALARM]` ten
minutes late.

| Level | From | Means |
|-------|------|-------|
| `[OK]` | 0 | Something moved in the last two minutes. |
| `[NOTICE]` | 2 min | A long generation, or a sub-session out. Normal. |
| `[WARN]` | 5 min | Long enough to look at the turn rows. |
| `[ALARM]` | 15 min | The run is not advancing. Read the recommended-vs-actual column. |

The banner names what last moved and when, labelled by kind — `-> state EXECUTING`
for a transition, `-> item I3` for an item — so `since fsm/transition -> state
EXECUTING at t+465.6s` tells you the run entered EXECUTING at t+465.6s and has
done nothing since. Under `--follow` it repeats on a fifteen-second heartbeat even when the
journal is silent, so the number on screen is never stale.

`waiting on turn #N` names the session whose response has not come back and how
long it has been generating. A stall with nobody waiting is a run that has
stopped asking; a stall with somebody waiting is a run that is slow. Under
`--console` the newest record is usually the very request being waited on, so
there is nothing to measure the wait against and the line says `unsettled; no
record has arrived since the request was built` rather than printing a
reassuring `0s` for a sub-session that never came back.

### The turn rows

One row per request built for a session:

```
t+956.4s    #15   orchestrator  rec=conductor_submit_test/I1       -> edit            gen=1m32s   tok=23705/1520 up=1m32s  MISMATCH REFUSED
```

| Column | Meaning |
|--------|---------|
| `t+956.4s` | Offset from the run's first record. |
| `#15` | Turn number, in the order requests were built. |
| `orchestrator` | Whose turn — the orchestrator or a sub-session role. |
| `rec=…` | The single next tool the injected state block recommended, and the item it named. `rec=(unrecorded)` means the journal does not carry it (see the note below). |
| `-> edit` | The tool actually called. `+3 more` means the turn called several. `no-tool-call` means the request produced no tool call at all. |
| `gen=1m32s` | From the request being built to the first tool call — the time the model spent generating. |
| `tok=23705/1520` | Prompt tokens / completion tokens for that request, from the router ledger. |
| `up=1m32s` | The router's own upstream latency for it. |
| `MISMATCH` | The model called something other than what was recommended. |
| `REFUSED` | The call was refused — by a gate, or past the gates by a handler. |
| `COMPACTION?` | See below. |

A row is printed only once the turn has **settled** — it called something, or the
next request for that session proved it called nothing, or the sub-session ended.
A row in an append-only stream can never be corrected afterwards, so the console
would rather show you nothing for a minute than show you a turn as a
`no-tool-call` it was not. The turn in flight is on the `waiting on` line instead.

### Recommended versus actual

The injected state block names exactly one recommended next tool per request. When
that recommendation is in the journal, the console renders it against the tool the
model actually called and marks the disagreement `MISMATCH`. This is the single
most diagnostic line on the screen: a run whose every turn is a mismatch is a run
arguing with its own instructions, and sixteen of them in a row is a deadlock you
can see in seconds rather than reconstruct in an hour.

The recommendation rides the delivery receipt: `composeDelivery` carries it as a
field (`conductor/adapter/inject.ts` `recommendedToolOf`, the same `legalTools`
call the state block renders its sentence from) and the plugin writes
`recommended` and `recommendedItem` onto the `inject/system-append` record. A
journal written before that field existed — the preserved run below is one —
reads `rec=(unrecorded)` on every row, and the header then prints
`mismatches (unrecorded)` rather than `0`: a confident zero beside a column
nothing measured reads as "the model did what it was told" on precisely the run
where it did not.

### Refusals

```
t+1048.6s   !! REFUSED deny gate=edit tool=edit reason=the orchestrator may not edit source without an active inline claim scoping this path (G8) at=/…/tests/check_visible.py
```

Three shapes are rendered under one unmissable marker:

- `deny` — the gate stack refused, naming the gate.
- `refused` — the gate stack allowed the call and something past it refused:
  an illegal FSM transition, a queue amendment `validateQueue` rejected, a
  handler's own legality step. These are the failures that used to leave the
  journal saying only that the call was permitted.
- `gate-crash` — a gate threw, and the fail-closed decision nobody chose stood.

The reason text is verbatim: it is exactly what the model was told, which is what
you need in order to judge whether the refusal was right.

### Sub-session communication

A sub-session streams twice, so you can see a job go out without waiting minutes
for it to come back:

```
t+2635.7s   >> testWriter on I1 ses_fd99cb8e… brief=2769chars
               ask: Author the failing test for I1 …
t+2906.7s   << testWriter on I1 dur=4m31s attempts=1 ok
               say: tests/test_p001.py fails on import …
```

`>>` is the dispatch and the brief it was handed; `<<` is the answer, how long it
took, how many attempts the receipt needed, and how it ended. When the journal
carries no `prompt`/`response` payload the `ask:`/`say:` lines are simply absent
and the rest of the row still renders — the console never invents a brief.

### Compaction

An opencode auto-compaction writes nothing to the journal, but it has a
signature: a request built, no tool call, and then another request for the same
session. When that silent gap exceeds thirty seconds the row is marked
`COMPACTION?` and its cost is added to the header total. In the preserved
45-minute run two of them cost 472.9 seconds — 17.5% of the budget — and nothing
in the system would otherwise have mentioned them. The token column corroborates
it: prompt tokens fall sharply on the flagged turn itself — 23,705 to 13,706 on the
first of them — because the request that turn carried is the compacted one.

### Per-turn cost

Tokens and latency come from the router's append-only ledger
(`.data/router/metrics.jsonl`), which carries no timestamp and no run id. The join
is therefore positional: the run's traffic is the entries whose `group` is the run
root, and within that, a role's Nth request is that role's Nth turn. A turn the
entries run out before at the tail keeps an empty cost column rather than a
guessed one, and no ledger at all is a timeline without the column.

Positional is fragile in one direction, and the console says so instead of
absorbing it. The `X-Conductor-Group` header is a §4.4 prefix-affinity key, not a
run id: `groupOf` sends the session's worktree, failing that its item id, and for
a session with neither — the ordinary shape of a planning-phase mechanical or
skeptic sub-session — it sends no group at all. Every request the filter drops
shifts that role's remaining turns by one, so a role holding fewer group-tagged
entries than it took settled turns has its **whole cost column withheld** and is
named in a `PARTIAL` caveat beside the header total. Withheld beats shifted: a
shifted column prints one turn's tokens against another turn's row and looks
perfectly healthy doing it.

---

## Healthy versus stalled

A healthy run looks like this: `STALL` sits at `[OK]` or `[NOTICE]` and keeps
resetting, because item states and FSM transitions keep landing. Generation times
are seconds to a couple of minutes. Prompt tokens climb steadily as context
accumulates. Sub-sessions go out and come back. Refusals are occasional and each
one is followed by a turn that does something different.

The preserved run in `.data/analysis/evidence` looks like this — render it
yourself with:

```bash
node conductor/tools/observe.ts \
  .data/analysis/evidence/conductor-state/runs/r-20260821-0a31 --console
```

```
STALL 36m10s   [ALARM] !!!!!!!!! since fsm/transition -> state EXECUTING at t+465.6s
elapsed 43m56s  turns 23  mismatches (unrecorded)  refusals 1  sub-sessions 3
COMPACTION suspected 2 costing 7m53s  tokens 281292 in / 33739 out  (PARTIAL — mechanical, skeptic: …)
```

Everything that is wrong with that run is in those three lines. It advanced once,
at t+465.6s, and then not at all for the remaining thirty-six minutes. It spent at
least 281,292 prompt tokens to produce 33,739 — at least, because two of its
requests reached the router untagged and their cost is withheld rather than
misattributed. Two compactions ate eight minutes. One
refusal — the `edit` deny at t+1048.6s — is the moment the orchestrator tried to
write a test file it had no claim on, and the twenty minutes after it are the
model failing to find another way through. The turn rows show the shape: reads
and bashes and status calls, four-minute generations, and no state change at the
end of any of them.

Two of that run's three tool failures were not in the journal at all when it was
recorded. They are now: `gates/refused` exists precisely so that a console built
on these records cannot show cheerful allows at the moment a run is dying.

---

## Related

- [observability.md](observability.md) — the ledger, the metrics and what the router records.
- `conductor/docs/OPERATIONS.md` — the post-mortem reading order, and `replay.ts`
  for the full record-by-record timeline of a finished run.
