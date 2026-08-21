# Observing a run

How to watch conductor work — live or after the fact — and how to read what you
see. Written so that every observation session starts from the same questions
instead of re-deriving where the evidence lives.

The audience is a stronger model reviewing a campaign cell, or a human doing the
same. It assumes no familiarity with the run directory's layout.

---

## The one command

```bash
node conductor/tools/observe.ts .conductor/runs/<runId>
node conductor/tools/observe.ts .conductor/runs/<runId> --json
node conductor/tools/observe.ts .conductor/runs/<runId> --bundle /tmp/obs-<runId>
```

The first form is the human read. The second is the same derivation as JSON. The
third packages the run — its records and the derivation over them — into a
directory you can hand to someone else, which matters because retention prunes
run directories and a bundle survives that.

**It only reads.** `conductor/tools/observe.ts` opens files, imports no handler,
holds no store, takes no lock and registers no hook. There is no code path by
which observing perturbs the run being observed, which is a stronger guarantee
than a rule about being careful. Pointing it at a *live* run is the intended use:
poll it.

---

## The protocol: six questions, in this order

Answer them in order. Each one decides whether the next matters.

### 1. Where is the run, and is it stopped?

The first line. A `STOPPED` run has a `stop` record in `run.json` naming its kind
— `done`, `noop`, `blocked`, `surfaced`, `env` or `interrupt` — and the report at
`report.md` explains it. If the run is stopped, read that first and stop guessing.

### 2. What is each item's state, and what is blocking?

Items advance `PENDING → RED → TEST_VETTED → GREEN → VALIDATED → REVIEWED →
PUBLISHED`. An item that has not moved is either blocked (it says so), waiting on
a wave, or held behind a frozen tree.

An item marked **tainted** has spent an override. That is not a failure, but it
means a gate said no and the run went ahead anyway, and the item's work should be
read with that in mind.

### 3. Is anything in flight, and is it making progress?

`in flight` lists the sub-sessions dispatched and not yet settled, by role and
item. Most of conductor's work happens in these, and since Task 21.1 they are
also children of the orchestrator session, so opencode's own sub-agent view lists
them.

An in-flight session that never settles is the watchdog's problem and will
surface as `subsession.abort`. A wave with nothing in flight and nothing
progressing is the interesting case: check for a frozen tree.

### 4. Is the run waiting on a human?

`open questions` names each one and the path the answer is dropped at. A run that
looks stalled and has an open question is not stalled — it is doing exactly what
it should, and nobody has answered.

### 5. What is straining?

The strain block. Read it as a set of ratios rather than counts:

| Signal | What a high value means |
|---|---|
| `denies` / rate, by gate | The session is spending turns arguing with the gates rather than working. Which gate is the finding: `edit` means the scopes are wrong, `git` means the model is reaching for commits it may not make, `session` means something is calling from an unregistered session. |
| `overrides minted / spent` | The plan's scopes do not match the work. A spend is a deny that was bypassed, and it taints the item permanently. |
| `waves` and how many carried one job | A wave of one is the scheduler finding nothing it could run alongside. Against items with disjoint scopes that is `scopesIntersect` over-approximating, which is a conductor cost, not a task property. |
| `receipt retries` | Sub-sessions are not producing the shape the protocol asked for. That is a briefing failure, not a capability one. |
| `aborts` | The watchdog killed a hung sub-session. Never routine. |
| `idle` / `reprompts` / `disengages` | The continuation engine is having to push. A local model stopping mid-run is the normal case, but repeated disengagement is the model losing the thread. |
| `gate crashes` | A defect in conductor, not in the work. Always worth a bug. |
| `largest brief` as a window fraction | A brief filling more than half the effective per-slot window (`scripts/conductor_wiring.py` `PER_SLOT_CONTEXT_TOKENS`, 32,768 by default; pass the served value if `serve.py --ctx` changed it) leaves the sub-session too little room for the source it is supposed to read. |

### 6. Did any declared threshold cross?

The last block. Thresholds live in `conductor/core/observation.ts`
`BREAKDOWN_THRESHOLDS` and were **written before the campaign**, so a crossing is
a hypothesis meeting evidence rather than a line drawn around a result.

**A crossed threshold is a finding to investigate, never a stop.** Nothing acts on
it. The question it poses is always the same: *is this the process failing, or
the task being hard?* — and the answer usually comes from comparing the same cell
across arms.

---

## Where the evidence lives

Everything below is under `.conductor/runs/<runId>/`.

| File | What it answers |
|---|---|
| `run.json` | Run state, classification, stop, counters |
| `queue.json` | The items and their dependency edges |
| `items/<id>.json` | Per-item state, scopes, attempts, taint |
| `journal.jsonl` | Every gate decision, FSM transition, sub-session event, verify and injection — the spine |
| `questions.jsonl` | Every §2.11 question and its answer |
| `decisions.jsonl` | The decide/defer ledger |
| `anomalies.jsonl` | §2.8 anomalies, including every override |
| `report.md` | The terminal artifact, if the run stopped |

Sub-session transcripts are **not** here. They live in opencode's own storage,
keyed by the `sessionID` in each `fanout` record. The journal is how you get from
"item I3's reviewer said something odd" to the transcript that says it.

---

## What an observer cannot see

Recorded rather than discovered, because a gap you know about is a different
thing from one you do not.

- **Anything the gates never adjudicated leaves no record at all.** Git-command
  detection reaches the enumerated globals only, and a `git` write the matrix
  never decided is invisible here — not denied and not journaled. The same holds
  for any network program outside the enumeration in
  `core/gates-edit.ts` `NETWORK_PROGRAMS`.
- **Anything in a second, ungated session.** If the operator opened another
  opencode session in the same tree, its work is not in this run's journal, and
  the workspace lock means that session got no store at all.
- **Allowed reads, unless the run was gathered at `debug`.** Every allowed call
  is journaled, but a read allow is `debug` and the default `logging.level` is
  `info`. A transcript gathered at `info` shows denies and network allows only,
  which looks like a complete record and is not. The report says so when it sees
  no gate decisions at all, but it cannot tell a quiet run from a filtered one in
  general. **A campaign that intends to answer "what did this arm reach" must run
  at `debug`.**
- **Why a model did something.** The journal records what the harness decided,
  not what the model was thinking. That is what the transcripts are for, and they
  are one indirection away.
- **The rubric.** Structure, decomposition, test quality, dead code and
  over-building are not derivable from records. They are a human or model
  judgement made against the produced artifact, and the bench driver carries them
  as their own lane for that reason.

---

## Reading a campaign rather than a run

The bench driver writes one cell per (model, capability, arm, task, rep). Each
cell's run directory can be observed with the command above, and the interesting
comparison is almost never one cell — it is the same task across arms.

Two habits worth keeping:

- **Compare the strain signals, not the pass rate, when the pass rates agree.**
  Two arms that both passed a task can have spent very different amounts of
  process doing it, and that difference is the thing the campaign exists to size.
- **Pull the bundle for every cell that failed in an interesting way**, and for
  the stratified review sample. A full campaign is too large to hand-review; the
  bundle is what makes a spot check cheap enough to actually do.
