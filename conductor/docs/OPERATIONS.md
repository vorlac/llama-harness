# Operating conductor

How to serve it, how to read what it produced, how to stop it, what every exit code and
error envelope means, and what to do when one of the four failures an operator actually
meets shows up.

**First rule: no beacon, no conductor.** The liveness beacon at
`.conductor/state/alive.json` is what actually distinguishes a gated session from an
ungated one. It is written the first time the plugin opens the workspace — on the first
opencode bus event, chat message or tool call handled by this plugin process — and only
after the doctrine
packs have all loaded and the workspace lock has been won, so its presence means a plugin
that loaded, found its doctrine and owns this workspace. The visible §3.8 session banner is the
at-a-glance version of that check — "no banner, no conductor": conductor prefixes `[conductor <version> · pid <pid> ·
<runId or "no run"> · <model>]` to the session's FIRST tool result, and follows it with the
§2.11 stale-red exclusions when the run carries any. It is CONDITIONAL — opencode offers no
unconditional channel for operator-visible text, so a session that calls no tool shows no
banner, and a `conductor_*` result is never decorated because those are payloads the
orchestrator parses. The beacon is therefore still the check that does not depend on a tool
running, and it is the one to reach for when a session has produced no tool output yet. opencode loads a plugin by
iterating the module's exports; a plugin that throws at construction is skipped whole and
the session comes up looking completely normal, with every gate in this repository silently
absent. If the beacon is missing — or names a `pid` that is not running — stop and fix the
load before trusting anything the session does. A second conductor session in a workspace
another one already holds also leaves no beacon, because the lock is claimed before the
beacon is written; [Degraded modes](#10-degraded-modes) tells that case apart from a plugin
that never loaded. See [HONEST-LIMITS.md](./HONEST-LIMITS.md), limit 11.

**Second rule: the agent blocks in `opencode-fragment.json` bind the orchestrator only.**
The fragment defines six subagent blocks — implementer, test-writer, reviewer, skeptic,
planner, mechanical — and `conductor/adapter/fanout.ts` creates every fan-out sub-session
without naming an agent, so nothing selects them. Their `"edit": "deny"` and
`tools: {"task": false}` rows are not in force for the sessions that do the work.
Enforcement is unaffected, because conductor's registry and edit gates bind on the session
registry rather than on the agent; but tightening one of those blocks changes nothing an
operator can observe, and an operator reading the fragment should not conclude otherwise.
The measured detail is in `conductor/adapter/wire-notes.md` under "20.3".

**Contents**

1. [Serving with and without the router](#1-serving-with-and-without-the-router)
2. [Reading a run directory](#2-reading-a-run-directory)
3. [Driving replay](#3-driving-replay)
4. [Halting a run](#4-halting-a-run)
5. [Tuning verbosity](#5-tuning-verbosity)
6. [Editing doctrine](#6-editing-doctrine)
7. [Exit codes](#7-exit-codes)
8. [Error envelopes](#8-error-envelopes)
9. [Troubleshooting](#9-troubleshooting)
10. [Degraded modes](#10-degraded-modes)

---

## 1. Serving with and without the router

`scripts/serve.py` picks the model, starts `llama-server`, optionally starts
`llama-router` under a supervisor, writes a session `opencode.json` with the conductor
plugin merged in, and execs into a shell with `OPENCODE_CONFIG` pointing at it.

```
$ python3 scripts/serve.py qwen3.6-27b
$ python3 scripts/serve.py qwen3.6-27b --no-router
$ python3 scripts/serve.py qwen3.6-27b --max-readers 6 --router-port 8088
$ python3 scripts/serve.py qwen3.6-27b --print-env
```

| Flag                       | Effect                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--router` / `--no-router` | force the router in or out of the loop. The default is *router when the binary exists*, so a machine that never built it degrades to the direct path instead of failing.                                                                                                                                         |
| `--router-port N`          | the port the router listens on; opencode's `baseURL` is rewritten to it when the router is enabled.                                                                                                                                                                                                              |
| `--max-readers N`          | the reader fan-out width. **One number, three consumers**: the llama-server slot count, the router config's `admission.maxInflightPerModel`, and the total context handed to llama-server. They cannot drift because nothing else computes them.                                                                 |
| `--ctx N`                  | the **per-slot** window, matching the flag's own help. It is honoured at every slot count: the derivation multiplies it by the slot count to get llama-server's total, so `--ctx 4096 --max-readers 6` serves 4096 tokens per sub-session. With no `--ctx`, the per-slot window is the recorded default of 8192. |
| `--host` / `--port`        | where `llama-server` itself binds.                                                                                                                                                                                                                                                                               |
| `--models-max N`           | how many models stay resident at once.                                                                                                                                                                                                                                                                           |
| `--fresh`                  | ignore saved settings and ask for everything again.                                                                                                                                                                                                                                                              |
| `--no-shell`               | run the server in the foreground; do not open a session shell.                                                                                                                                                                                                                                                   |
| `--print-env`              | print the environment the session shell would get, and exit.                                                                                                                                                                                                                                                     |
| `--include-utility`        | also offer embedding and reranker models in the picker.                                                                                                                                                                                                                                                          |
| `--no-build-check`         | skip verifying the built tools against the submodule.                                                                                                                                                                                                                                                            |

**Why the context arithmetic is one derivation.** llama-server's `--ctx-size` is the
TOTAL context it divides among its slots, not the per-slot window
(`router/UPSTREAM_CONTRACT.md` finding F3, measured on llama-server 10298: a total of
8192 across six slots served 1536 tokens each). `scripts/conductor_wiring.py` therefore
emits the slot count and the total together, from the one number you gave it, and emits
the total exactly once — llama-server honours the LAST such argument it is handed, so a
second one would silently discard an intent. At one slot there is nothing to divide.

**With the router versus without.** The conductor code path is **identical** either way:
the same plugin, the same gates, the same handlers, the same sub-session dispatch. The
only thing `--no-router` changes is the base URL the client resolves — straight to
`llama-server` instead of through the router. So `--no-router` is always a legitimate
fallback; it costs you the metrics ledger and prefix-group ordering, not correctness. The
G5 equivalence artifact (`docs/build/artifacts/12.1-g5-equivalence.md`) is where that
claim is measured rather than asserted.

**Failover, if the router is up but sick.** The `router-client` component owns the
in-session failover latch. The first failed router request latches the whole session onto
the **upstream** base URL (`upstream.host:upstream.port` — the direct `llama-server`
origin), marks the run's metrics partial, and journals a `failover` record at `warn`.
After a **second failover** in one session the client stops addressing the router
entirely: `resolveBaseUrl` names the upstream unconditionally, so every later
conductor-issued request goes direct without a round trip to the router. Two `failover`
records at `warn` in one run therefore mean the rest of that run was served direct, and
the metrics ledger for it is incomplete by construction.

**What the latch does not cover.** The latch diverts the HTTP the *conductor* issues —
the §2.1 setup proofs and the closing metrics read. It does not divert the run's model
traffic: that flows opencode → the provider base URL baked into the session config →
the router, and the plugin cannot re-point a live opencode session. A router that dies
mid-run therefore kills the sub-sessions in flight and the run takes their `env`
failures; the recovery for that is the supervisor restarting the router, not this latch.

**Router lifetime.** `serve.py` execs into the session shell and therefore cannot itself
supervise anything. The router runs under a small supervisor process that restarts it on
non-fatal exits with capped-exponential backoff, gives up on a fatal exit, and dies with
the session shell — so the router never outlives the session that started it.

---

## 2. Reading a run directory

State lives in two places, and only one of them is inside your repo.

```
<target repo>/
├── .conductor/                     runtime state — git-ignored via .git/info/exclude
│   ├── config.json                 the §2.1 manifest (written by conductor_setup)
│   ├── state/
│   │   ├── current-run.json        pointer {runId}, or null when no run is live
│   │   ├── alive.json              the §3.8 liveness beacon
│   │   ├── stale-red.json          the cross-run registry of abandoned red tests (§2.11)
│   │   ├── halt                    present ⇒ the workspace is halted (see "Halting a run")
│   │   └── run.lock                the single-writer lock {pid, startMs, sessionID?, token?}
│   └── runs/<runId>/               one directory per prompt-run, self-contained
│       ├── run.json                §2.3 — run FSM state, classification, stop record
│       ├── queue.json              §2.4 — the item DAG, scopes, sizes
│       ├── items/<itemId>.json     §2.5 — per-item FSM state and evidence refs
│       ├── plan.md                 §3.2 — the plan document written at PLANNED
│       ├── report.md               the final report — written on EVERY terminal stop
│       ├── journal.jsonl           §7.1 — the event log (+ rotated journal.N.jsonl.gz)
│       ├── evidence.jsonl          §2.6 — the ONLY file adapter/evidence.ts writes
│       ├── decisions.jsonl         §2.7 — scored decision records
│       ├── anomalies.jsonl         §2.8 — overrides, gate crashes, disengages
│       ├── questions.jsonl         §2.11 — surfaced questions; the blocked-set source
│       └── reviews/<itemId|plan>-r<N>.json   §2.10 — finding sets and verdicts
└── (the target project's own files)

OUTSIDE the repo — normative, not an implementation detail (§4.2 / §4.3):
  <stateHome>/conductor/<workspaceKey>/
  ├── quarantine/<runId>/           foreign red tests moved aside during a verify,
  │                                 plus manifest.json for crash-safe restore
  └── worktrees/<runId>/<itemId>/   parallel-implementer worktrees
```

`<stateHome>` is `$XDG_STATE_HOME` when set, else `~/.local/state`; `<workspaceKey>` is
the repo root's absolute path hashed. The **quarantine and worktree trees live out of
repo on purpose**: `.git/info/exclude` hides a directory from git and from nothing else,
and every default verify command walks the tree looking for tests — a red test parked
under `.conductor/` would still be collected by the very verify it was moved aside to
protect, and a worktree (a second checkout of every test file) certainly would be.

`.conductor/` itself is git-ignored, but not through the target's tracked `.gitignore`:
the first time conductor touches a repo it registers the `.conductor/` prefix in
`.git/info/exclude` under the common gitdir, so the harness never dirties a target's
tracked files with its own presence.

Two things about that map are worth knowing before you go looking for a file:

- **`report.md` exists for every terminal stop**, not only for `done`. The writer is one
  helper guarded on `run.stop !== null`, so a `noop`, `blocked`, `surfaced`, `env` or
  `interrupt` run has a `report.md` too — a stop-report rather than a completion report.
  Its absence means the run has not terminated yet, never that a report was withheld.
- **`reviews/` is a §1.2 layout slot with no writer at HEAD.** The path is reserved for
  §2.10 finding sets; nothing in this build creates it, and `replay` deliberately does not
  read it. Review verdicts reach you through the journal and `report.md`.

**Which run is live.** `.conductor/state/current-run.json` holds `{runId}` while a run is
live and `null` once it is archived — that pointer, not a directory listing, is the entry
point. Run directories live at `.conductor/runs/<runId>/`. An older run's directory may
simply be gone: while `retention.pruneOnRunCreate` is on, creating a run **prunes**
`runs/` down to `config.retention.keepRuns`, oldest by creation time first and never the
live run. So an absent run dir means pruned at least as often as it means never existed.
Pruning happens at run creation and never mid-run.

Read a finished run in this order:

1. **`report.md`** — the curated human read, and the only artifact written for you rather
   than for a machine. Start here on every stop kind; it names the stop, the reason, the
   items and their settled positions, the open questions and the decisions.
2. **`run.json` and `items/<itemId>.json`** — what stage did the run reach, which item is
   not `PUBLISHED`, and what is its disposition. A blocked item names the question id
   blocking it.
3. **`journal.jsonl`** — everything else, through `replay` rather than by eye. It is the
   machine-readable truth and it is long; the renderer is what makes it a timeline.
4. **`evidence.jsonl`** — the re-derived truth, in three record kinds: `red`, `green` and
   `verify`. Every FSM-advancing record here was written by a handler that ran the command
   itself; nothing in it is the model's word. A failing test carries a `failureClass` from
   the §2.6.1 closed vocabulary:

    | `failureClass`    | Means                                                                                                                   | Legal red? |
    | ----------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- |
    | `assertion`       | the test ran, evaluated the behaviour, and the behaviour was wrong                                                      | yes        |
    | `missing-subject` | the test could not resolve the module it is testing, and that path is inside this item's declared `fileScope`           | yes        |
    | `error`           | anything else that prevented evaluation — a syntax error, an import outside the item's scope, a build failure elsewhere | no         |

5. **`questions.jsonl`** — the surfaced questions, and therefore the blocked set: an item
   that will not move is usually waiting on one of these that nobody answered.
6. **`anomalies.jsonl`** — the loud things: every `conductor_override` that was granted,
   every gate-crash the fail-closed path recorded, and the `disengage` record a wedged run
   leaves behind.

---

## 3. Driving replay

```
$ node conductor/tools/replay.ts .conductor/runs/<runId>
$ node conductor/tools/replay.ts .conductor/runs/<runId> --item I3
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component gates --level warn
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component fanout,fsm
```

It renders six sections: the journal sources it read, per-item swimlanes, every
gate denial, a fan-out table with each sub-session's duration and outcome, a review-round
table, and any malformed records. The review table reports **rounds** — what each round
raised, how many majors survived, which lenses ran, who was dispatched — and no per-finding
uphold/overturn column, because the journal records no per-finding verdict. It reads the
journal and its rotated archives and **nothing else**, writes nothing, and reads no clock —
two machines render one journal identically.

| Flag          | Values                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `--component` | `fsm`, `gates`, `fanout`, `evidence`, `continuation`, `inject`, `router-client`, `state` (comma-separated) |
| `--level`     | `error`, `warn`, `info`, `debug`, `trace` — the minimum severity shown                                     |
| `--item`      | one or more item ids (comma-separated); filters to those swimlanes                                         |

Each flag takes its value either as the next argument (`--level warn`) or glued on
(`--level=warn`), and a repeated `--component` or `--item` unions its values, so
`--item I1 --item I2` and `--item I1,I2` are the same request; a repeated `--level` keeps
the last one given. `--item` selects records that carry an item id, which
means it also drops the run-level lane — use it to read one item, not to read the run.

Those three are the whole flag surface; anything else is a usage error, and so is an
unknown `--component` or `--level` value, because a typo must never render a silently empty
timeline. `conductor_status` is the live in-session equivalent: same run, same facts, from
inside the session rather than from a finished directory.

---

## 4. Halting a run

Create the halt file in the target repo:

```
$ touch .conductor/state/halt
```

**Presence alone halts.** The check is `existsSync` on `.conductor/state/halt` — the
file's *existence* is the entire signal, and its content is never read. Write whatever you
like in it, or nothing at all; an empty file halts exactly as hard as a full one, and
nothing in the harness will ever quote it back to you.

The halt file is **owner-only** (§1.2): it is yours, and the model never creates, edits or
deletes it. No tool exposes it, and no gate lets a session write it.

The continuation engine checks it on every idle re-entry, ahead of the debounce, the gate
recommendation and the futility rule alike, and stops the run with stop kind `interrupt`
rather than re-prompting. A halt is a human decision, not an anomaly — nothing is appended
to `anomalies.jsonl`, though the engine does journal one `continuation` / `disengage`
record naming the stop. A **stop-report** is still written before the run goes quiet,
through the same single writer every other stop uses, so you are left with `report.md` on
disk explaining where it stopped and why. The check is state-independent: it applies
whether the run is mid-wave, waiting on a question, or idle.

Delete the file to resume normal operation:

```
$ rm .conductor/state/halt
```

---

## 5. Tuning verbosity

Two sources — environment and config file — and **env wins over config**. Within each, a
per-component level beats the global one.

```
$ CONDUCTOR_LOG=debug opencode
$ CONDUCTOR_LOG=gates:trace,fanout:debug opencode
$ CONDUCTOR_LOG=info,evidence:trace opencode
```

`CONDUCTOR_LOG` is comma-separated segments, each either a bare level (global) or
`component:level`. An unrecognised level is **ignored**, not obeyed — a typo cannot
silence a component. In the config file the same two knobs live under `logging.level`
(global) and `logging.components` (the per-component map).

The five levels, most to least severe, are `error`, `warn`, `info`, `debug` and `trace`.
The eight components are `fsm`, `gates`, `fanout`, `evidence`, `continuation`, `inject`,
`router-client` and `state`.

The journal default level is `info`, and the stderr/console default level is `warn` — both
pinned in `core/journal-events.ts` as `DEFAULT_LEVEL` and `DEFAULT_CONSOLE_LEVEL`. On top
of that, `error` and `warn` records are **always written regardless of** the configured
level, so lowering verbosity can never hide a failure.

**The cost of `trace`.** At `trace` the journal holds full sub-session prompts and raw
structured outputs — large slices of the repo, once per lens, per round, per item — inside
the user's own repository, in a **git-ignored** directory, which means nothing else will
ever notice it growing. Two `retention` bounds in `.conductor/config.json` are the only
things that stop it: `keepRuns` prunes older run directories at run creation, and
`maxRunDirBytes` rotates a journal that outgrows it to `journal.N.jsonl.gz` and starts a
fresh `journal.jsonl`. Turn `trace` on for a component and a session, not for a config
file you forget about.

---

## 6. Editing doctrine

The nine packs are plain markdown in `conductor/doctrine/`:

```
$ ls conductor/doctrine/
core.md    decompose.md  receive-review.md  skeptic.md  test-vet.md
debug.md   plan.md       review.md          tdd.md
```

`adapter/inject.ts` composes them per sub-session role (§6.1's port map) at dispatch time.
There is nothing to rebuild — the packs are plain files read at run time — but they are
read **once per pack directory, per plugin process**: the plugin loads all nine on the
first hook or tool call that needs a workspace and serves that cached copy to every session
that opencode process handles. An edit therefore takes effect only after opencode is
restarted — not in the sub-session after the save, and not merely in a different session of
the same process. Keep edits inside the packs: role-to-pack routing is the port
map's job, and a pack that starts addressing a different role than its port map entry makes
the injection unreadable.

**Loading fails closed.** A required pack that is missing, unreadable, or present but empty
stops the load with an error naming the offending file, reported at `error` level on the
session's stderr sink. The session then opens no workspace: no beacon is written, no run
starts, no stage tool works — rather than dispatching sub-sessions carrying no doctrine.
Adjudication does not go permissive with it: the gate hook still runs, and with no
workspace it derives no scope, which denies every edit.

**Pointing at a different pack directory.** Setting `LLAMA_HARNESS_DOCTRINE_DIR` in the
session environment makes the plugin read the packs from that directory instead of
`conductor/doctrine/`. It is read at call time, so a directory that changes between two
tool calls is honoured by the second, and a directory missing any of the nine required
packs fails closed exactly as a missing shipped pack does. Unset (or empty) means the
packs that ship beside the plugin.

Two hard rules survive every edit:

- **A pack stays at or under 120 lines.** The injected system prompt is the sum of the
  packs a role gets; the line ceiling is what keeps that sum reviewable.
- **A model-facing pack never names a client.** No pack may say opencode, Claude or
  Cursor. The packs describe the work, not the tool the work happens in, and a pack that
  names one is wrong in every other client.

After ANY doctrine edit, run `bash scripts/test-conductor.sh`. `doctrine.test.ts` anchors
the required content of every pack — the line ceiling, the forbidden client names, the
per-pack required sections — and it is the only thing standing between a well-meant edit
and a role that silently lost its instructions.

---

## 7. Exit codes

**How a run ends (§2.9).** The stop kind is recorded in `run.json`; it is not a process
exit code, because a run ends inside a live opencode session that keeps running.

| Stop kind   | What it means                                                                                                    | Who records it                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `done`      | the report tool ran and the run completed                                                                        | `conductor_report`                                                                                             |
| `noop`      | the run made no observable progress across consecutive re-prompts, or it settled without advancing a single item | the continuation engine on the futile re-prompt limit, or `conductor_report` on a settle that advanced nothing |
| `blocked`   | no open item remains and blocked items remain, or a closing verify came back red                                 | the continuation engine on idle re-entry, or `conductor_report` on settle                                      |
| `surfaced`  | no open and no blocked item remains, and human-territory questions are pending                                   | the continuation engine on idle re-entry, or `conductor_report` on settle                                      |
| `env`       | a closing verify's runner could not run, or the override budget is exhausted                                     | `conductor_report`, the override hatch, or the continuation engine                                             |
| `interrupt` | the halt file was present at an idle re-entry                                                                    | the continuation engine                                                                                        |

**Every stop kind writes `report.md`** — the same single writer, selecting stop-report
content for the five non-`done` kinds and full-report content for `done`. Two engines reach
that writer through one total stop-closer (`stopKindOf`): the **continuation engine** runs
it on an idle re-entry, and the **report tool** (`conductor_report`) runs it when a run
settles. `interrupt` is the continuation engine's alone — only an idle re-entry sees the
halt file — and `done` is `conductor_report`'s alone. The other four are written by
**whichever** reaches the closer first: `blocked` and `surfaced` when an idle re-entry
finds the run out of moves or when the model settles it over blocked or question-bearing
work; `noop` from the continuation engine on the futile re-prompt limit and from
`conductor_report` on a settle that advanced no item (the defer-everything-with-a-green-verify
case); and `env` from `conductor_report` on a closing verify that came back red because its
runner could not run, from the override hatch the moment a request meets an exhausted
budget, and from the continuation engine on the next idle re-entry after a granted override
took the run's meter to `workflow.maxOverridesPerRun`. The **fan-out engine** never records
a run stop at all — what it produces on a failed sub-session is a per-job error of kind
`env` on that job's result (see [Error envelopes](#8-error-envelopes)), which the caller
reads; the run-level `env` stop is one of the three above.

**What a process returns.** These are the things an operator runs by hand.

| Command                             | 0                                                                   | 1                                                                                                                                                                                                             | 2                                                                                          | 3                                                                                                                     | 4                                                 |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `scripts/test-conductor.sh`         | GATE PASS                                                           | any leg red — a failing or cancelled test, a test the suite declined to execute (G4 forbids those), a glob that matched no tests at all, a typecheck failure, a bun leg, the schema export, or the python leg | —                                                                                          | —                                                                                                                     | —                                                 |
| `conductor/tools/replay.ts`         | rendered                                                            | no readable journal source in that directory                                                                                                                                                                  | usage error: unknown flag, missing value, more than one run dir                            | —                                                                                                                     | —                                                 |
| `conductor/tools/export-schemas.ts` | schemas written                                                     | an unwritable output directory (the throw's own exit)                                                                                                                                                         | —                                                                                          | —                                                                                                                     | —                                                 |
| `scripts/serve.py`                  | exec'd into the session shell, or printed and exited                | a fatal setup error, named on stderr                                                                                                                                                                          | —                                                                                          | —                                                                                                                     | —                                                 |
| `llama-router`                      | clean shutdown on SIGINT or SIGTERM, and the help and version paths | —                                                                                                                                                                                                             | usage error: stderr carries the parse error naming the offending flag, then the usage text | config error: stderr carries the offending field, and a config file that cannot be read lands here too, named by path | listen bind failure: stderr carries host and port |

`export-schemas.ts` has no usage errors of its own: its one optional argument is an output
directory, defaulting to `router/tests/schemas`. `scripts/serve.py` additionally exits 130
when you interrupt it during setup, which is the shell's own Ctrl-C convention rather than
a conductor code. `llama-router` returns nothing else — there is no code 1 anywhere in its
entry point.

---

## 8. Error envelopes

**The router's 503.** In the configuration it ships with, the router is an observer (§4.4)
and rejects nothing for what a request *says*: an untagged priority, an unknown priority
and an unusable `model` field are all admitted normally. Its only two refusals of a
request out of the box are about **capacity**, and both are a `503` in one pinned envelope, the
OpenAI-compatible shape `llama-server` itself emits:

```json
{ "error": { "message": "llama-router queue is full for model 'qwen3.6-27b'; the request was not queued",
             "type": "unavailable_error",
             "code": "queue_overflow" } }
```

The `code` is the discriminator. `queue_overflow` means the queue already held
`admission.maxQueued` entries, so the request was refused immediately and never queued —
retrying now will do the same thing. `queue_timeout` means the request *was* queued and
its wait expired past `admission.queueTimeoutMs`; the queue moved too slowly, and retrying
may well work. The `type` is `unavailable_error` in both cases. The router's other error
status, a `502`, is not a refusal of the request at all but the upstream being unreachable
or truncating mid-body — same envelope shape, with `code` `502`.

Both codes are **diagnostic only**. Nothing on the conductor side reads them: the fan-out
reaches the router through opencode's provider fetch, which hands back an error string
rather than the envelope, so a `503` here becomes a failed sub-session and not a bounded
backoff. Read the codes in the router log and in the metrics ledger; do not expect a run
to have acted on them.

**The router's one opt-in refusal.** The router config carries
`schema.rejectOnMissing`, and the base build ships it `false`. Turned on by hand it adds a
`400` — the only refusal the router makes for what a request *says* — to a `POST /v1/*`
that carries the schema header tagged `required` while its body declares no schema. The
envelope has the same shape as the 503, and the message names both the header it resolved
and the literal `schema.rejectOnMissing`, so the answer says which key produced it. It is
decided before admission, so it consumes no slot and no queue entry. `serve.py` refreshes
only the machine-derived keys of `conductor-router.json` on each run, so this one survives
regeneration once you set it; `--fresh` drops it back to the shipped `false`.

`/conductor/health` is registered outside admission on purpose, so it answers `200` even
while every slot and every queue entry is held. If the router is refusing traffic, that
route is how you tell "saturated" from "dead".

**A gate denial is a thrown error, not a body.** A denied tool call is an `Error` **thrown**
inside the plugin hook. There is no separate error object, no JSON body and no silent
no-op: the thrown message *is* the gate's `reason` string, and opencode relays it straight
back to the model as the refusal reason. That is why every deny names the gate that fired
and the state that made the call illegal — that message is the model's only route back to
a legal action.

The same decision is journaled under the `gates` component as a `deny` record at `warn`,
and the record's own data is the gate's input `snapshot` — the tool name, the raw arguments,
the command or edit path, and the reason — so a denial can be reconstructed exactly. `warn`
is one of the two levels written regardless of the configured verbosity, so lowering the log
level never hides a refusal.

Should a gate itself throw while judging a guarded call, the harness fails **closed**: the
call is denied with a `gate-crash` anomaly and a reason beginning

> a security gate crashed while judging a guarded call — denied (fail-closed, G5)

followed by the crash message. The `gate-crash` record is journaled at `error` either way,
but the *disposition* follows what was at stake: a crash while judging a call that could
write fails closed as above, and a crash while judging a harmless read fails **open** and
allows it. A crash is never invisible in either direction — read the `gate-crash` records
before concluding a gate approved something.

**Handler refusals** are different from gate denials: the tool was legal to call, and the
handler re-derived the evidence and found it wanting (a stale verify, an item not in the
required stage). These return a refusal result and journal it; they do not throw.

**The fan-out engine's `env` result.** A sub-session that never produces a valid
structured result finishes as a completion, not a crash. The engine has a fixed budget of
3 attempts. Attempts 1 and 2 that fail validation journal `fanout` /
`subsession.retry` with their attempt number and the validation `errors`, and re-prompt
with the errors appended. When the third fails, the engine journals
`subsession.complete` with `{ok: false}` and reason `schema-invalid`, and hands its caller

```json
{ "kind": "env",
  "reason": "sub-session output failed schema validation after retries",
  "errors": [ "…the last validation errors…" ] }
```

Two other failures produce the same `kind: "env"` result shape with their own reason: a
sub-session opencode would not create at all (`sub-session could not be created`, journaled
as `subsession.complete` with reason `session-create-failed`), and a throw from the SDK
mid-job (`sub-session engine error: …`, reason `engine-error`). Both are environment
faults rather than model faults, and neither is worth re-prompting.

Four `fanout` event names carry that lifecycle: `subsession.dispatched` when the job goes
out, `subsession.retry` once per failed attempt, `subsession.complete` on either outcome,
and `subsession.abort`. Note the last one: a **watchdog** abort is a genuinely different
terminal path — the job ran out of wall clock rather than out of schema attempts — and it
emits `subsession.abort` at `warn` with reason `watchdog-timeout` instead of a
`subsession.complete`. Retry exhaustion never emits `subsession.abort`, so the two are
distinguishable by name in the journal. (The component owns one more name,
`subsession.hold`, for a job parked behind a tree another job is writing; a hold is not a
failure and always releases.)

**Fail-soft (G5).** A throw from inside a hook body is caught, journaled once at `error`
under a §7.4 event name, and swallowed. Conductor failing must not take the user's session
down. The journal record is the only trace, which is why `--level error` over the journal
is the first thing to check when conductor seems to have stopped participating.

---

## 9. Troubleshooting

### "the session has no banner"

**What it means:** the plugin did not load. Every gate is absent and the session is a
plain opencode session (limit 11). This is first in this list because nothing downstream
distinguishes an ungated session from a gated one — a green suite and a clean report look
identical either way.

**What to do:** run `scripts/serve.py` again and check the **opencode log**. A plugin
module that throws at construction, or that exports anything which is not a plugin
function, is skipped whole — opencode reports `TypeError: Plugin export is not a function`
and carries on. Check also that `OPENCODE_CONFIG` points at the session config the script
wrote, and that the config's plugin path resolves.

```
$ echo $OPENCODE_CONFIG
$ node --input-type=module -e 'import("./conductor/plugin/index.ts").then(m => console.log(Object.keys(m)))'
```

The second command must print exactly `[ 'ConductorPlugin' ]`.

The heading is a mnemonic: the §3.8 visible banner is not yet wired, so the check that
actually works is the liveness beacon at `.conductor/state/alive.json`, which the plugin
writes when it first opens the workspace. It holds four fields — `pid`, `startMs`,
`version` and `sessionID`. A beacon whose `pid` is not running, or whose `sessionID` is not
the session you are sitting in, means the conductor you are reading about is not the one in
front of you. No beacon at all means no conductor has opened this workspace: the
plugin never loaded, its doctrine failed to load, the workspace lock was refused, or the
workspace itself would not open — an unreadable root, or a `.conductor/config.json` that
cannot be read, is not JSON, or fails the §2.1 schema. All but the first report themselves
at `error` level on stderr — the doctrine failure and the open failure as
`state/hook.failed`, the lock refusal as `state/lock.contended` — and a plugin that never
loaded says nothing at all.

### "publish denied stale"

**What it means:** the green evidence describes a tree that no longer exists. A verify
record is fresh for a commit only if BOTH conditions hold: the verify's `startedMs` is not
behind the newest reference `mtime` — the staged behavioral files that still exist, plus the
index's own `mtime` when one of the staged entries is a deletion — **and** the record's
`head` equals the current HEAD. (The second condition is skipped entirely in **no-git**
mode, where there is no HEAD to compare — see [Degraded modes](#10-degraded-modes).)

The exact-tie case is decided by what the stamp can prove. Conductor stamps `startedMs`
from a strictly increasing clock whose values carry a fraction of a millisecond, and such a
stamp *can* order two events inside one tick — so an edit stamped at the same instant as
the verify reads **stale**. A record left by an earlier process with a whole-millisecond
stamp cannot order them, and there the tie counts fresh rather than making every
coarse-timestamp repository unpublishable. A record whose timestamps are not finite numbers
at all is treated as stale outright (see [HONEST-LIMITS.md](./HONEST-LIMITS.md)).

**Two ordinary causes.** Either an **edit** landed inside the item's scope after the verify
started, which trips the first condition; or HEAD moved under it, which trips the second.
HEAD moves two ways in practice: a **branch switch** (`git switch` between validate and
publish changes the tree without necessarily touching any file's mtime), or a **sibling**
item's publish landing its own commit while this one was being reviewed.

**What to do:** re-run **validate** to produce a fresh verify, then publish. Do not
override — an override here buys a commit whose green was measured on different bytes, and
it is tainted and reported for exactly that reason.

```
$ node conductor/tools/replay.ts .conductor/runs/<runId> --item I2 --component evidence
```

The verify record's `startedMs` and `head` against the current head is the whole
diagnosis.

**What publish does on its own.** Publish auto-re-verifies **once** on a stale verdict —
exactly once, never in a loop. If that auto re-verify comes back red, the item's own test
is not being blamed: the tree moved under it, so the item drops back to `GREEN` with the
debug protocol armed and `debugging` set, and publish stops there rather than trying
again.

### "sub-session env-failed"

**What it means:** a fan-out sub-session never produced a valid structured result.
Structured output is prompt-shaped and independently validated (there is no native
`format` field at opencode 1.18.15), so a small model that keeps emitting prose exhausts
the fixed budget of 3 attempts and the job finishes `env`-failed.

**What to do:** read the records in `journal.jsonl`. Grep two event names:
`subsession.retry`, one per failed attempt, carrying its `attempt` number and the
validation `errors` that were fed back into the re-prompt; and `subsession.complete`,
which on exhaustion carries `{ok: false}` with reason `schema-invalid`.

```
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component fanout --level debug
```

This path is a **completion**, not a **watchdog** abort — the job answered three times and
was wrong three times, rather than running out of wall clock. Repeated retries on one role
point at the doctrine pack for that role, not at the engine: a single retry is normal for
a 27B model, a wall of them means the prompt is not making the shape obvious enough.

A sub-session that ends this way contributes an `env` error to whatever asked for it; if
the run itself stops, the stop still writes its **stop-report** through the one writer, so
`report.md` will be there with the reason.

### "run disengaged"

**What it means:** the continuation engine re-prompted the model, the re-prompt changed
nothing, and the §3.7 cap of 3 **consecutive** futile idle re-prompts was reached, so the
run stopped `noop`. Futile has a precise meaning here: the run-state **signature** the
engine computes did not change between attempts, so the re-prompt provably moved nothing.
A signature that differs is progress and resets the counter to zero — the three must be
consecutive.

**What to do:** read the `continuation` component's records. It owns exactly three event
names: `reprompt` (a re-prompt actually left the process), `idle` (an idle re-entry where
the gate offered no next step, so nothing was prompted and nothing was counted) and
`disengage` (the stop itself).

```
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component continuation
```

A `disengage` anomaly is also appended to `anomalies.jsonl`, write-ahead, before the stop
and the report — so a process killed mid-disengagement still leaves the trace. The run
still writes its **stop-report**.

Between the turn ending and the re-prompt the model has genuinely stopped: opencode has no
pre-emptive turn-end hook (limit 2), so idle-driven re-entry is the only lever available.
The disengage backstop is therefore a **bound on the failure mode, not a fix** for it — it
keeps a wedged run from re-prompting forever, and that is all it claims to do. A run that
disengaged with a blocked item is usually waiting on a surfaced question nobody answered;
`conductor_answer` unblocks it and the next run proceeds.

---

## 10. Degraded modes

**No-git mode (§3.9).** opencode is routinely run in scratch directories, so conductor
must work in one. `conductor_setup` calls `isRepo`; when it is false it offers exactly one
interactive choice — **initialize a repo here**, or run in **no-git** mode. Choosing no-git
sets `git.mode` to `read-only`, turns parallel writes off, and changes four things:

- **publish is disabled** — there is nothing to commit to. Items terminate at `REVIEWED`
  with their diff recorded in the report, and the phase gate stops offering
  `conductor_publish` at that stage rather than handing out a tool that cannot work.
- **worktree mode is disabled** — creating a worktree throws before touching anything.
- **the HEAD term is dropped from the freshness rule** — condition 2 is skipped, so
  freshness is the mtime comparison alone.
- **the `.git/info/exclude` registration is skipped** — there is no gitdir to register in.
  State still lives in `.conductor/`, and still needs to be kept out of anything you later
  commit.
Everything else — the FSM, the gates, the evidence ledger, the review layer — is
**unchanged**. No-git is a narrower conductor, not a weaker one.

**A second session in the same workspace.** `.conductor/state/run.lock` is an **OS-level
single-writer** lock — claimed with `linkSync`, which the kernel refuses to let a second
caller overwrite — holding the holder's `pid`, `startMs` and `sessionID`. The first
conductor session claims it; a **second** conductor session in the same workspace is
**refused**, not downgraded. `openWorkspace` throws `WorkspaceLockedError`, the plugin
catches it and returns a **null workspace**, and that session does **no conductor-side
work at all** — it takes no lock, mints no evidence, writes no state. The refusal is loud:
it journals a `lock.contended` record at **error** level naming the holder (its `pid`,
`startMs` and `sessionID`), which the console sink surfaces to stderr, so a blocked second
session is never silent.

A held lock is **broken automatically** on the next open in three situations: the holder's
`pid` is no longer alive, the lock is older than 24h (`DEFAULT_STALE_LOCK_MS`, measured from
the holder's `startMs`), or the lock file cannot be parsed at all — an unreadable lock is
evidence of nothing, and breaking it is the only way the workspace becomes usable again.
All three are the ordinary path back in — a crashed session leaves a lock its own dead pid
invalidates, and an abandoned one ages out — so there is nothing to delete by hand. If a
stale lock is genuinely in your way, let the staleness rule break it, or stop the holding
process and let the next open break it on the dead pid.

Claiming is retried a bounded number of times, and exhausting that budget is itself a
refusal rather than a silent claim. Its message is deliberately different from the
live-holder one: it reports the pid the lock names **together with whether that pid is
actually alive**, and it names the break-right files (`run.lock.break.*`) as the other thing
that can be in the way. That is the only shape in which removing `.conductor/state/run.lock`
by hand is the right move, and the message says so.

Neither of these is a guarantee about a *second, plain* opencode session — one started
without the harness. That one takes no lock at all and is invisible to conductor. Read
[HONEST-LIMITS.md](./HONEST-LIMITS.md) before drawing conclusions from a green run; limits
7, 11 and 12 in particular change what an operator should do, not merely what they should
expect.

Operational security, multi-machine deployment, and Linux are all out of scope.
