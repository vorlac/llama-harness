# Observability

Every decision conductor makes leaves a record on disk. This page is the map: where the
records live, what each one holds, how to turn the volume up, and how to tell whether
conductor is running at all.

## The state directory

Conductor keeps all of its state in a `.conductor/` directory at the root of the workspace
you are working in. It is registered in that repo's `.git/info/exclude` — not its tracked
`.gitignore` — the first time conductor touches the repo, so the harness never dirties a
project's tracked files with its own presence.

```text
<your repo>/
├── .conductor/
│   ├── config.json                 # per-repo manifest: verify scopes, behavioralPaths,
│   │                               #   git mode, workflow caps, retention, logging
│   ├── state/                      # workspace-level, survives runs
│   │   ├── current-run.json        # pointer {runId}, or null
│   │   ├── alive.json              # liveness beacon {pid, startMs, version, sessionID}
│   │   ├── stale-red.json          # registry of abandoned red tests, across runs
│   │   ├── halt                    # owner-only halt file; presence stops the run
│   │   └── run.lock                # advisory single-writer lock {pid, startMs}
│   └── runs/<runId>/               # one self-contained directory per prompt
│       ├── run.json                # run FSM state + metadata
│       ├── queue.json              # decomposed items + their DAG
│       ├── items/<itemId>.json     # per-item FSM state, counters, evidence refs
│       ├── plan.md                 # the plan document
│       ├── report.md               # the final report
│       ├── journal.jsonl           # the structured event journal
│       ├── evidence.jsonl          # red / green / verify records
│       ├── decisions.jsonl         # the decision-protocol ledger
│       ├── anomalies.jsonl         # overrides, gate crashes, disengages
│       ├── questions.jsonl         # surfaced questions — the blocked-set source
│       └── reviews/<itemId|plan>-r<N>.json   # finding sets and skeptic verdicts
└── (your project's own files)
```

Run ids are minted as `r-<yyyymmdd>-<4hex>` — for example `r-20260807-a1b2`.

Two things deliberately live **outside** the repository, under a state home keyed to the
workspace:

```text
<stateHome>/conductor/<workspaceKey>/
├── quarantine/<runId>/    # foreign red tests moved aside during a verify,
│                          #   plus manifest.json for crash-safe restore
└── worktrees/<runId>/<itemId>/    # parallel-implementer worktrees
```

`<stateHome>` is `$XDG_STATE_HOME` when set, otherwise `~/.local/state` (the same path on
macOS). `<workspaceKey>` is the repo root's absolute path hashed with SHA-256, first 16 hex
characters, plus its basename, so two checkouts of one project never collide.

Being outside the repo is load-bearing, not tidiness. `.git/info/exclude` hides a directory
from git and from nothing else, and every default verify runner conductor ships with
(`node --test`, `pytest`, `go test ./...`, `ctest`) discovers tests by walking the tree — so
a red test parked under `.conductor/` would still be collected and run by the very verify it
was moved aside to protect. Measured, not assumed:
[`conductor/docs/RUNNER-DISCOVERY.md`](../../conductor/docs/RUNNER-DISCOVERY.md).

## report.md

`report.md` is the human's read of a run. A full report — the one
[`conductor_report`](tool-reference.md) writes when a work run finishes — is assembled
after the handler re-runs the full verify itself, fresh and start-stamped, and contains:

| Section        | What it holds                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| What shipped   | per published item: the red proof (the failing test and its failure class), how many review rounds it took, and any taint the item carries |
| What did not   | every blocked or deferred item with its reason; a deferral names the decision record that justified it                                     |
| Open questions | each surfaced question still unanswered, with its `Q-` id, so you can answer it by id                                                      |
| Decisions      | a summary of the run's decision ledger — the forks taken and why                                                                           |
| New stale reds | test files newly added to the workspace stale-red registry because their item never reached GREEN                                          |
| Exclusions     | the paths the closing verify quarantined: every non-PUBLISHED item below GREEN, plus the workspace registry                                |
| Metrics        | tokens, wall-clock, and parallelism actually achieved (from the router client when the router is up)                                       |

Taint is headlined rather than buried. If the model spent a `conductor_override`, the item
it touched carries that record permanently for the run, and the report says so first.

The exclusions section exists because a report is legal with blocked items whose red tests
are still on disk. Excluding those files silently would be its own hazard, so every
exclusion is disclosed — at run start in `run.json`, and again here.

### The three modes

One report writer, three modes:

| Mode        | Written when                                                          | Difference from full                                                              |
| ----------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| full        | `conductor_report` on a work run: `EXECUTING → REPORTED`, stop `done` | —                                                                                 |
| lite        | `conductor_report` on a trivial run: `EXECUTING → TRIVIAL_DONE`       | shorter; one synthesized item to describe                                         |
| stop-report | any non-`done` terminal stop                                          | the stop kind and its reason are the headline, and there is **no** closing verify |

A stop-report skips the closing verify on purpose: a wedged or interrupted run has no claim
to prove and may be mid-edit.

**Every terminal path writes a report.** Recording a stop is not, on its own, a terminal
action — the recorder must invoke the report writer before the run goes quiet. Otherwise the
run that wedges and gives up leaves behind no human-readable artifact at all, which is
precisely the run you most need to read. The stop kinds a stop-report can headline are a
closed set: `noop`, `blocked`, `surfaced`, `env`, and `interrupt`; see
[Run lifecycle](run-lifecycle.md) for what each one means.

## conductor_status

`conductor_status` is the live, in-session equivalent of the report. It takes no arguments,
mutates nothing, and is legal in **every** run state including terminal ones. On a stopped
run it is the only tool still legal, except that `conductor_answer` stays legal while a
question is open — that is the human's resume path. Ask for it whenever you want to know
where a run stands without opening a file. It returns:

- the run id and its FSM state;
- the classification (`question`, `trivial`, or `work`), once one has been recorded;
- every item, sorted by id, with its FSM position and its `blocked` / `deferred`
  annotations;
- every open question with its id and text.

## The ledgers

Nine files carry the run's record. Each has exactly one writer — that is the rule that
makes them trustworthy, because the writer is always the handler that re-derived the
evidence itself, never the model.

| File                  | Writer                                                                                                          | What it records                                                                                                                                                                                         | When you read it                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `evidence.jsonl`      | [`adapter/evidence.ts`](../../conductor/adapter/evidence.ts), and nothing else                                  | `red` / `green` / `verify` records: the argv actually spawned, exit code, failure excerpt, failure class, the verify start stamp, the HEAD and branch judged, the exclusions applied, per-scope results | to check a claim — what really ran, and against which tree                 |
| `decisions.jsonl`     | the `conductor_decide` and `conductor_defer` handlers in [`adapter/tools.ts`](../../conductor/adapter/tools.ts) | every non-trivial fork: at least two real options with scores, the choice, the reasoning, `derived` vs `human`, and where it was applied                                                                | to audit judgment calls after the fact; an overrule is a correcting entry  |
| `anomalies.jsonl`     | the override, gate-crash and disengage paths, write-ahead                                                       | overrides granted (with gate, reason, and the one action they unlocked), gate evaluation crashes, disengagements                                                                                        | first stop when a run behaved strangely                                    |
| `questions.jsonl`     | [`adapter/questions.ts`](../../conductor/adapter/questions.ts)                                                  | surfaced questions: id, asker role and session, human-territory verdict, origin, the items they block, the answer                                                                                       | to see what conductor is waiting for, and to answer it by id               |
| `reviews/`            | the plan-review and item-review handlers                                                                        | one file per review round, `<itemId \| plan>-r<N>.json`: the finding set and the skeptic verdicts on each finding                                                                                    | to see why a finding survived or was refuted                               |
| `journal.jsonl`       | [`adapter/journal.ts`](../../conductor/adapter/journal.ts)                                                      | every event, one JSON line, in order                                                                                                                                                                    | to reconstruct exactly what happened                                       |
| `run.json`            | [`adapter/state.ts`](../../conductor/adapter/state.ts), on behalf of the handlers                               | run FSM state, the verbatim prompt, classification, HEAD/branch/dirty paths at run start, active stale-red exclusions, plan-review rounds, the stop record, and the counters                            | to see where the run is and why it ended                                   |
| `queue.json`          | `conductor_decompose`, amended only by `conductor_queue_amend`                                                  | the items and their DAG: title, rationale, `fileScope`, `testScope`, acceptance criteria, `behavioral`, `dependsOn`, and the minimality record                                                          | to see how the prompt was split and what each item is allowed to touch     |
| `items/<itemId>.json` | `adapter/state.ts`, on behalf of the handlers                                                                   | per-item FSM position, attempt counters, the `blocked` / `deferred` / `debugging` annotations, ledger-qualified evidence refs, taint, inline claim                                                      | to find which item is stuck, and at which stage                            |

Anomalies are written *before* the handler that triggered them returns, so a process killed
mid-decision still leaves its trace. Ledgers are records, not proofs — what makes them worth
trusting is that every record which advances an FSM was written by a handler that ran the
command itself. The model's only path to a fabricated record is `conductor_override`, which
is budgeted, loud, tainted, and reported.

## The journal

`journal.jsonl` is one complete JSON object per line, appended synchronously.

```jsonc
{ "seq": 141, "ts": 1754560000000, "level": "info", "component": "fanout",
  "runId": "r-20260807-a1b2", "itemId": "I3", "sessionID": "ses_...",
  "event": "subsession.dispatched",
  "data": { "role": "reviewer", "lens": "correctness", "model": "qwen3.6-27b" } }
```

Every record carries the **correlation triple**: `runId` always, `itemId` and `sessionID`
when they apply. That is what lets you filter a whole run down to one item, or to one
sub-session, without guessing. `seq` is monotonic within a run directory and continues
across a restart rather than resetting.

A record is bounded to roughly 32 KiB. Anything larger has its `data` replaced by
`{ "truncated": true, "preview": "..." }` — the flag lives inside `data`, never as a
top-level key, so the record shape is invariant.

### The event vocabulary

Event names are a closed, tested vocabulary, one list per component, exported from
[`core/journal-events.ts`](../../conductor/core/journal-events.ts). An adapter that tries to
log a name outside the list throws in development and test; in production the record is
still written and pushed to the console rather than dropped. The rule behind this: logs you
cannot grep by name are logs you cannot debug with.

| Component       | Events                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `fsm`           | `transition`, `refusal`, `guard-reject`, `invalid-transition`                                                                  |
| `gates`         | `deny`, `allow`, `snapshot`, `gate-crash`, `override-granted`                                                                  |
| `fanout`        | `subsession.dispatched`, `subsession.hold`, `subsession.complete`, `subsession.retry`, `subsession.abort`                      |
| `evidence`      | `red`, `green`, `verify`                                                                                                       |
| `continuation`  | `reprompt`, `idle`, `disengage`                                                                                                |
| `inject`        | `system-append`                                                                                                                |
| `router-client` | `request`, `response`, `failover`, `retry`                                                                                     |
| `state`         | `run.created`, `lock.acquired`, `lock.released`, `lock.stale-break`, `lock.contended`, `item.updated`, `user.midrun-prompt`, `decision.recorded`, `question.surfaced`, `run.stop-report` |

### Levels and what they cost

Five levels, most severe first: `error`, `warn`, `info`, `debug`, `trace`. A record is
written when its level is at or above the resolved threshold — and `error` and `warn` are
written **regardless** of the threshold. You cannot configure a failure into silence.

| Level   | Adds                                                                                                                                 | Cost                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `error` | failures only                                                                                                                        | nothing                        |
| `warn`  | degraded conditions that did not stop the run: a broken stale lock, a router failover, a gate crash                                  | nothing                        |
| `info`  | the default. The run's narrative: FSM transitions, run creation, lock lifecycle, gate decisions, sub-session dispatch and completion | small                          |
| `debug` | gate decisions carry their full input snapshot, enough to reproduce the decision in a test                                           | moderate                       |
| `trace` | full sub-session prompts and raw structured outputs                                                                                  | large — read the warning below |

At `trace` the journal contains complete sub-session prompts and outputs: large slices of
your repository, once per lens, per round, per item. That sits inside your repository, in a
directory git has been told to ignore, which means nothing else will ever notice it growing.
`trace` exists for debugging the harness itself; leave it off otherwise.

### Sinks

| Sink                                           | Gets                                                                                           | Purpose                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| `runs/<runId>/journal.jsonl`                   | everything at or above the configured level, filtered per component; `error` and `warn` always | machine-readable truth; replay       |
| stderr, via opencode's log surface             | records at or above the console level, default `warn`, independent of the file threshold       | live debugging without opening files |
| `report.md`                                    | the curated summary                                                                            | the human's read                     |
| llama-router: `spdlog` plus its metrics ledger | router-side traffic                                                                            | wire truth                           |

## Turning up the volume

Two config keys and one environment variable.

```jsonc
// .conductor/config.json
"logging": {
  "level": "info",                 // the global threshold
  "components": {                  // per-component overrides
    "fanout": "debug",
    "gates": "debug"
  }
}
```

`CONDUCTOR_LOG` overrides the config file and takes two forms, which can be mixed in one
comma-separated value:

```bash
CONDUCTOR_LOG=debug                        # bare level: raise the global threshold
CONDUCTOR_LOG=fanout:trace,gates:debug     # per-component
CONDUCTOR_LOG=info,fanout:trace            # both: global info, fanout at trace
```

Resolution order for any given component: an env per-component level wins, then the env
global level, then a config per-component level, then `logging.level`. A segment naming a
level that does not exist is ignored rather than applied, so a typo cannot silence a
component by accident.

The router has its own `logging.level` in
`.data/configs/conductor-router.json`, which accepts the same five names and is applied to
`spdlog` at startup. See [Configuration](configuration.md) for the full key reference.

## Retention

`.conductor/` lives inside your repository and is invisible to git, so nothing ever notices
it growing. Retention is therefore configured, not hoped for:

```jsonc
"retention": {
  "keepRuns": 20,                  // run directories kept, newest first
  "maxRunDirBytes": 268435456,     // 256 MiB before the journal rotates
  "pruneOnRunCreate": true
}
```

**Pruning** happens at run creation, never mid-run — no run ever has its own directory
pulled out from under it. The store orders existing run directories by `createdIso` and
removes the oldest until `keepRuns` remain. The run being created is never a prune target,
and a directory whose `run.json` cannot be read is skipped rather than ordered blindly.

**Rotation** happens on write. When `journal.jsonl` grows past `maxRunDirBytes` it is
gzipped to `journal.N.jsonl.gz` — with `N` probed upward so a restart never clobbers an
existing archive — and a fresh `journal.jsonl` starts. Nothing is deleted; the history is
still there, just compressed.

The defaults are sized for the failure mode they prevent. Twenty runs is enough history to
compare this week's behavior against last week's; 256 MiB is small enough that a `trace`
session cannot quietly eat a disk before you notice.

## Is conductor even loaded?

Every gate in this system assumes the plugin is running. If opencode fails to initialize the
plugin, it logs the failure and continues — completely ungated. The session looks entirely
normal and enforces nothing, and no gate can catch it because no gate exists. Two things
make it visible:

1. **The liveness beacon.** At init the plugin writes `.conductor/state/alive.json` with
   `{pid, startMs, version, sessionID}`. Startup errors — a missing doctrine pack, for
   instance — happen *before* the beacon is written, so the beacon's absence is proof that
   init failed.
2. **The session banner.** The orchestrator's first response in a session carries a one-line
   conductor banner: version, run id, model.

```bash
cat .conductor/state/alive.json    # present and current => the plugin initialized
```

**First rule of operations: no banner, no conductor.** If the banner is missing, the plugin
did not load; run `scripts/serve.py` again and check the opencode log.

This is honest about its own limit. The beacon and the banner make the failure *visible*.
Nothing can make it *impossible* — conductor cannot detect its own absence, and a second,
plain `opencode` session in the same repository has no plugin, takes no lock, and is
invisible to the conductor session entirely. See
[Gates and hatches](gates-and-hatches.md) for the rest of the honest limits.

## Replay, metrics and the dashboard

*These three arrive with tasks 15.0, 11.7 and 15.2; see
[project status](../developer/project-status.md).*

`conductor/tools/replay.ts` renders a journal into something a human reads in order. Run it
over a run directory:

```bash
node conductor/tools/replay.ts .conductor/runs/r-20260807-a1b2 --item I3 --level debug
```

It produces per-item swimlanes, gate denials highlighted, a fan-out duration table, and a
review verdict table, with `--component`, `--level` and `--item` filtering.

The router writes its own ledger: one JSONL line per request carrying model, role, group,
priority, queue-wait milliseconds, upstream milliseconds, prompt and completion token counts
with their timings, `schemaMissing`, `schemaConformed`, and status. `/conductor/metrics`
serves the aggregates over that ledger — request count, p50 and p95 queue wait, token
totals, and schema-conformance rate — alongside `/conductor/health`. The ledger path is
`metrics.ledgerPath` in the router config.

`src/dashboard/` is an optional ftxui build target that tails the metrics ledger live:
in-flight and queued lanes, group-affinity hits, schema-conformance markers, token
throughput. It has no runtime coupling to anything else — the router does not know or care
whether it is running.

## See also

- [Configuration](configuration.md) — every `logging` and `retention` key in context
- [Run lifecycle](run-lifecycle.md) — the states and stop kinds the report headlines
- [Tool reference](tool-reference.md) — `conductor_status`, `conductor_report`, and the rest
- [Troubleshooting](troubleshooting.md) — reading a run directory when something went wrong
- [Observability internals](../developer/observability-internals.md) — the journal writer,
  the event vocabulary, and how records are kept parseable across a crash
