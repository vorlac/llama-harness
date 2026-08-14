# Operating conductor

How to serve it, how to read what it produced, how to stop it, and what to do when one of
the four failures an operator actually meets shows up.

**First rule: no banner, no conductor.** The §3.8 session banner is the only thing that
distinguishes a gated session from an ungated one. opencode loads a plugin by iterating
the module's exports; a plugin that throws at construction is skipped whole and the
session comes up looking completely normal, with every gate in this repository silently
absent. If the banner is not there, stop and fix the load before trusting anything the
session does. See [HONEST-LIMITS.md](HONEST-LIMITS.md), limit 11.

---

## 1. Serving

`scripts/serve.py` picks the model, starts `llama-server`, optionally starts
`llama-router` under a supervisor, writes a session `opencode.json` with the conductor
plugin merged in, and execs into a shell with `OPENCODE_CONFIG` pointing at it.

```
$ python3 scripts/serve.py qwen3.6-27b
$ python3 scripts/serve.py qwen3.6-27b --no-router
$ python3 scripts/serve.py qwen3.6-27b --max-readers 6 --router-port 8088
$ python3 scripts/serve.py qwen3.6-27b --print-env
```

| Flag | Effect |
|---|---|
| `--router` / `--no-router` | force the router in or out of the loop. The default is *router when the binary exists*, so a machine that never built it degrades to the direct path instead of failing. |
| `--router-port N` | the port the router listens on; opencode's `baseURL` is rewritten to it when the router is enabled. |
| `--max-readers N` | the reader fan-out width. **One number, three consumers**: it derives the llama-server `--parallel <slots>` argument, the router config's `admission.maxInflightPerModel`, and the total `--ctx-size` (per-slot context × slots, because llama-server divides its total context among slots). They cannot drift because nothing else computes them. |
| `--ctx N` | per-slot context. At `slots > 1` the derived `--ctx-size` overrides it — `--ctx 4096 --max-readers 6` serves 8192 per slot. At one slot your value is left alone. |
| `--host` / `--port` | where `llama-server` itself binds. |
| `--fresh` | ignore any already-running server and start a new one. |
| `--no-shell` | set everything up and print, but do not exec into a session shell. |
| `--print-env` | print the environment the session shell would get, and exit. |

**With the router versus without.** The router is an observer (§4.4): it schedules,
records metrics, and notices when a schema-constrained request came back unconstrained.
It never rejects. Anything the direct path would have served, the router serves. So
`--no-router` is always a legitimate fallback — it costs you the metrics ledger and
prefix-group ordering, not correctness. The G5 equivalence artifact
(`docs/build/artifacts/12.1-g5-equivalence.md`) is where that claim is measured rather
than asserted.

**Router lifetime.** `serve.py` execs into the session shell and therefore cannot itself
supervise anything. The router runs under a small supervisor process that restarts it on
non-fatal exits with capped-exponential backoff, gives up on a fatal exit, and dies with
the session shell — so the router never outlives the session that started it.

---

## 2. Reading a run directory

Every run is a directory under the target repo:

```
<repo>/.conductor/
├── config.json          the §2.1 manifest (written by conductor_setup)
├── state/
│   ├── current-run      the live runId
│   ├── halt             present ⇒ the workspace is halted (see §4)
│   └── alive.json       the §3.8 liveness beacon
└── runs/<runId>/
    ├── run.json         §2.3 — stage, classification, stop record
    ├── queue.json       §2.4 — the item DAG, scopes, sizes
    ├── items/<itemId>.json   §2.5 — per-item FSM state and dispositions
    ├── evidence.jsonl   §2.6 — the ONLY file adapter/evidence.ts writes
    ├── decisions.jsonl  §2.7 — scored decision records
    ├── anomalies.jsonl  §2.8 — overrides, taints, refusals
    ├── journal.jsonl    §7.1 — the append-only event log (+ rotated journal.N.jsonl.gz)
    └── report.md        written by conductor_report at the end of a done run
```

Read them in this order when something went wrong:

1. **`run.json`** — what stage did the run reach, and what stop kind ended it? The stop
   kinds are a closed vocabulary: `done`, `noop`, `blocked`, `surfaced`, `env`,
   `interrupt`. Anything other than `done` means the report was refused, and the reason
   is in the stop record.
2. **`items/<itemId>.json`** — which item is not `PUBLISHED`, and what is its
   disposition? A `blocked` item names the question id that blocks it.
3. **`evidence.jsonl`** — the re-derived truth. Every FSM-advancing record here was
   written by a handler that ran the command itself; nothing in it is the model's word.
   A failing test carries a `failureClass` from the §2.6.1 closed vocabulary:

   | `failureClass` | Means | Legal red? |
   |---|---|---|
   | `assertion` | the test ran, evaluated the behaviour, and the behaviour was wrong | yes |
   | `missing-subject` | the test could not resolve the module it is testing, and that path is inside this item's declared `fileScope` | yes |
   | `error` | anything else that prevented evaluation — a syntax error, an import outside the item's scope, a build failure elsewhere | no |

4. **`journal.jsonl`** — everything else, through `replay.ts` rather than by eye.

---

## 3. Driving `replay.ts`

```
$ node conductor/tools/replay.ts .conductor/runs/<runId>
$ node conductor/tools/replay.ts .conductor/runs/<runId> --item I3
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component gates --level warn
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component fanout,fsm
```

It renders per-item swimlanes, highlights gate denials, and prints the fan-out duration
and review-verdict tables. It reads the journal and its rotated archives and **nothing
else**, writes nothing, and reads no clock — two machines render one journal identically.

| Flag | Values |
|---|---|
| `--component` | `fsm`, `gates`, `fanout`, `evidence`, `continuation`, `inject`, `router-client`, `state` (comma-separated) |
| `--level` | `error`, `warn`, `info`, `debug`, `trace` — the minimum severity shown |
| `--item` | one or more item ids (comma-separated); filters to those swimlanes |

Exit codes: `0` rendered, `1` no readable journal source in that directory, `2` usage
error (unknown flag, missing value, more than one run dir).

---

## 4. Halting a run

Create the halt file in the target repo:

```
$ touch .conductor/state/halt
```

The continuation engine checks it on every idle re-entry and stops the run rather than
re-prompting. A halt is a human decision, not an anomaly — it is not written to
`anomalies.jsonl`. Remove the file to allow runs again:

```
$ rm .conductor/state/halt
```

The check is state-independent: it applies whether the run is mid-wave, waiting on a
question, or idle.

---

## 5. Tuning verbosity

Two sources, env beats config, and within each a per-component level beats the global
one.

```
$ CONDUCTOR_LOG=debug opencode
$ CONDUCTOR_LOG=gates:trace,fanout:debug opencode
$ CONDUCTOR_LOG=info,evidence:trace opencode
```

`CONDUCTOR_LOG` is comma-separated segments, each either a bare level (global) or
`component:level`. An unrecognised level is **ignored**, not obeyed — a typo cannot
silence a component. In the config file the same thing lives under `logging.level` and
`logging.components`.

`error` and `warn` are always written regardless of threshold, so lowering verbosity can
never hide a failure.

---

## 6. Editing doctrine

The nine packs are plain markdown in `conductor/doctrine/`:

```
$ ls conductor/doctrine/
core.md  decompose.md  plan.md  tdd.md  test-vet.md
debug.md  review.md  skeptic.md  receive-review.md
```

`adapter/inject.ts` composes them per sub-session role (§6.1's port map) at dispatch
time, so an edit takes effect on the **next** sub-session — no rebuild, no restart. Keep
edits inside the packs: role-to-pack routing is the port map's job, and a pack that
starts addressing a different role than its port map entry makes the injection unreadable.

---

## 7. Exit codes and error envelopes

**Tooling exit codes**

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `scripts/test-conductor.sh` | GATE PASS | any leg red | — |
| `conductor/tools/replay.ts` | rendered | no readable journal source | usage error |
| `conductor/tools/export-schemas.ts` | schemas written | an unwritable output directory (the throw's own exit) | — |
| `llama-router` | clean SIGTERM shutdown | startup or config failure | — |

`export-schemas.ts` has no usage errors of its own: its one optional argument is an
output directory, defaulting to `router/tests/schemas`.

**Gate denials.** A denied tool call is a *thrown error inside the plugin hook*, and
opencode reads the thrown message back to the model as the refusal reason. That is the
whole envelope: there is no separate error object and no silent no-op. A denial always
names the gate that fired and the state that made the call illegal, because that message
is the model's only route back to a legal action.

**Handler refusals** are different from gate denials: the tool was legal to call, and the
handler re-derived the evidence and found it wanting (a stale verify, an item not in the
required stage). These return a refusal result and journal it; they do not throw.

**Fail-soft (G5).** A throw from inside a hook body is caught, journaled once at `error`
under a §7.4 event name, and swallowed. Conductor failing must not take the user's
session down. The journal record is the only trace, which is why `--level error` over the
journal is the first thing to check when conductor seems to have stopped participating.

---

## 8. Troubleshooting

### "publish denied stale"

**What it means:** files inside the item's scope were edited *after* the verify run
started, so the green evidence describes a tree that no longer exists. Freshness needs
both `startedMs >= max(mtime of the staged behavioral files)` **and**
`record.head === currentHead`; the second condition catches a `git switch` between
validate and publish, which changes the tree without touching any file's mtime.

**What to do:** re-validate. Do not re-publish, and do not override — an override here
buys a commit whose green was measured on different bytes, and it is tainted and reported
for exactly that reason.

```
$ node conductor/tools/replay.ts .conductor/runs/<runId> --item I2 --component evidence
```

The verify record's `startedMs` and `head` against the current head is the whole
diagnosis.

### "sub-session env-failed"

**What it means:** a fan-out sub-session never produced a valid structured result. The
usual cause is schema retries: structured output is prompt-shaped and independently
validated (there is no native `format` field at opencode 1.18.15), so a small model that
keeps emitting prose exhausts the retry budget and the session is recorded `env`-failed.

**What to do:** read the schema retry counts in the journal.

```
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component fanout --level debug
```

Repeated retries on one role point at the doctrine pack for that role, not at the engine.
A single retry is normal for a 27B model; a wall of them means the prompt is not making
the shape obvious enough.

### "run disengaged"

**What it means:** the continuation engine re-prompted the model, the re-prompt changed
nothing, and after the futility cap the run stopped `noop`. Between the turn ending and
the re-prompt the model has genuinely stopped — opencode has no pre-emptive turn-end hook
(limit 2), so idle-driven re-entry is the only lever, and the disengage backstop is what
keeps a wedged run from re-prompting forever.

**What to do:** read the futile re-prompt records.

```
$ node conductor/tools/replay.ts .conductor/runs/<runId> --component continuation
```

They carry the futility signature — the thing that did not change between attempts. A run
that disengaged with a blocked item is usually waiting on a surfaced question that nobody
answered; `conductor_answer` unblocks it and the next run proceeds.

### "the session has no banner"

**What it means:** the plugin did not load. Every gate is absent and the session is a
plain opencode session (limit 11).

**What to do:** check that `OPENCODE_CONFIG` points at the session config `serve.py`
wrote, and that the config's plugin path resolves. A plugin module that throws at
construction, or that exports anything which is not a plugin function, is skipped
whole — opencode reports `TypeError: Plugin export is not a function` and carries on.

```
$ echo $OPENCODE_CONFIG
$ node --input-type=module -e 'import("./conductor/plugin/index.ts").then(m => console.log(Object.keys(m)))'
```

The second command must print exactly `[ 'ConductorPlugin' ]`.

---

## 9. What this does not cover

Operational security, multi-machine deployment, and Linux are all out of scope; so is any
guarantee about a *second* terminal in the same repo. Read
[HONEST-LIMITS.md](HONEST-LIMITS.md) before drawing conclusions from a green run — limits
7, 11 and 12 in particular change what an operator should do, not merely what they should
expect.
