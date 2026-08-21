# Launch runbook — the 13.2 live smoke and the 14.2 campaign

Both are **owner-attended**. Everything up to the launch is prepared and verified;
what remains needs a real model and a person watching it.

Authoring `conductor/SMOKE.md` or `docs/build/artifacts/conductor-report.md`
without a real run is fabrication, and `scripts/verify-acceptance.sh:143-147`
treats it as such — it requires a command transcript, not prose.

---

## Preflight — run this first, both times

Measured 2026-08-20 on this machine; re-check before each launch.

| Check                   | Command                                                                                                             | Last observed                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test gate               | `bash scripts/test-conductor.sh`                                                                                    | `GATE PASS`, 1916 tests                                                                                                                                                                                                                                                                                                  |
| Mechanical scan         | `bash scripts/conductor-gate.sh`                                                                                    | `M5 PASS`, 192 files                                                                                                                                                                                                                                                                                                     |
| C++ side                | `cmake --build .out/build/clang-relwdebinfo --target router-tests && ctest --test-dir .out/build/clang-relwdebinfo` | 1/1 passed                                                                                                                                                                                                                                                                                                               |
| Acceptance              | `bash scripts/verify-acceptance.sh`                                                                                 | 17 PASS, 4 FAIL — all four are 13.2/14.2                                                                                                                                                                                                                                                                                 |
| opencode                | `opencode --version`                                                                                                | `1.18.15` (the version the wire contract is pinned against)                                                                                                                                                                                                                                                              |
| Model on disk           | `ls .data/models`                                                                                                   | `qwen3.6-27b` present                                                                                                                                                                                                                                                                                                    |
| llama.cpp tools current | `python3 -c 'import sys; sys.path.insert(0,"scripts"); import fetch_models as fm; print(fm.tools_state())'`         | `(True, 'up to date with submodule …')` — otherwise `serve.py` rebuilds nine binaries at launch and the llama-server under test is not the one the contract was measured on (the 13.2 smoke launched into exactly that: build 10298 on disk, submodule at 521a64cd0197, rebuilt to build 10542 before the model started) |
| Disk                    | `df -h .`                                                                                                           | 376 GiB free                                                                                                                                                                                                                                                                                                             |
| Port                    | `lsof -nP -iTCP:8080 -sTCP:LISTEN`                                                                                  | free — `llama-server` is not running                                                                                                                                                                                                                                                                                     |
| Hidden-test floor       | `python3 scripts/conductor_bench.py --verify-tasks --work-root <scratch>`                                           | every hidden test exits non-zero on its unmodified seed                                                                                                                                                                                                                                                                  |
| Seed-green floor        | `python3 scripts/conductor_bench.py --seed-green --work-root <scratch>`                                             | every seeded repo passes its own visible suite                                                                                                                                                                                                                                                                           |

**Never run a bare `cmake --build` with no `--target`** — the default target
reaches vendored llama.cpp, which `scripts/verify-acceptance.sh` records as
pre-broken in this configuration.

---

## The per-slot window is the opencode model limit

`serve.py` serves every slot `PER_SLOT_CONTEXT_TOKENS` (32768; `--ctx N` overrides it) and
writes that same window into the session config as every model's `limit` — opencode compacts
against the slot it actually has. The bench driver probes the window from llama-server's
`/props?model=<name>` before its first cell and writes the same limit into every arm. The 13.2
smoke found the 8192-token default refusing the orchestrator's first request (11,441 tokens) and
opencode looping through compaction against a catalog limit of 65,536 it had no way to know was
wrong; see `router/UPSTREAM_CONTRACT.md` (d).

## Set the logging level to `debug` before either run

This is not optional and it is easy to miss.

Every allowed call is journaled, but a read allow is `debug` and the default
`logging.level` is `info`. A run gathered at `info` records the denies and the
network allows and nothing else — which looks like a complete record and is not.
The campaign's central question is *what did each arm reach, and did reaching it
correlate with passing*, and at `info` there is no data behind it.

In the workspace's `.conductor/config.json`:

```json
{ "logging": { "level": "debug", "components": {} } }
```

---

## 13.2 — the live smoke

The next action `docs/build/HANDOFF.md` has named for some time. Its purpose is to
prove the harness works end to end against a real model once, with the record to
show it.

1. Start the server: `python3 scripts/serve.py` (see `conductor/docs/OPERATIONS.md`
   §1 for the router and no-router forms).
2. Confirm the beacon appears at `.conductor/state/alive.json` and its `pid` is the
   live plugin process. **No beacon, no conductor.**
3. Confirm the banner. It rides the session's **first tool result** and reads
   `[conductor 0.1.0 · pid <pid> · <runId> · <model>]`. It is conditional on a tool
   running — a session that calls no tool shows none, which is measured behaviour
   and not a fault.
4. Drive one small task through INTAKE → report.
5. **Watch it with the observer**, in a second terminal:
   `node conductor/tools/observe.ts .conductor/runs/<runId>` — it only reads, so
   polling a live run is the intended use. `docs/developer/observing-a-run.md`
   carries the six questions to read it by.
6. Confirm the sub-agent view. opencode's own session browser must list every
   dispatched sub-session **under the orchestrator**, labelled by its role agent
   (`conductor-reviewer`, `conductor-implementer`, …) and titled `role[lens]:item`.
   This is Task 21.1's end-to-end acceptance and it is the one part of it a test
   cannot reach — the automated rows prove the API accepts and echoes `parentID`
   and `agent` and that conductor sends both; only a human can confirm the client
   renders it.
7. Write `conductor/SMOKE.md` **from the transcript**, in the house style
   `conductor/docs/RUNNER-DISCOVERY.md` sets: the question under test, tool
   versions verbatim, every command echoed with its exit code, and the journal
   lines quoted rather than paraphrased.
8. Commit with the message `conductor: 13.2 live smoke` — row 12 matches
   `docs/build/STATE.json`'s `commitMessage` for the task exactly, and counts it once.

---

## 14.2 — the campaign

**Do not start this until 13.2 has run and the owner has authorized it.**

### Take the sweep decision first

The full crossing is not runnable. The shape recorded in
`bench/conductor-tasks.json`'s `sweep` block is: **sweep models across T0/T1,
run T2–T4 on the primary model only.**

|                                  | cells | ceiling (every cell times out) | expected |
| -------------------------------- | ----- | ------------------------------ | -------- |
| Primary model, all tiers, 3 reps | 207   | 180 h                          | ~60 h    |
| Each extra swept model (T0+T1)   | 126   | 72 h                           | ~24 h    |
| Two models                       | 333   | 252 h                          | ~84 h    |

**Recommended: run a reps=1 pilot on the primary model first — 69 cells, ~20 h —
and calibrate `TIER_TIMEOUT_SEC` from the observed medians before committing to
reps=3.** The plan asks for timeouts "calibrated from a pilot run", and 60 hours
is not an overnight.

### Second model

`qwen3.8-27b` is in the catalog with every field verified against the real
repository, but **its weights are not on disk**. Adding it to the sweep means
`python3 scripts/fetch_models.py` first — roughly 22 GB for the default
`UD-Q6_K`. The manifest names the model in three places
(`defaults.model`, `sweep.primaryModel`, `sweep.models[0]`) plus `DEFAULT_MODEL`
in `scripts/conductor_bench.py`.

### Read it against the thresholds, not against itself

The breakdown thresholds in `conductor/tools/observation.ts`
`BREAKDOWN_THRESHOLDS` were committed **before** this campaign, deliberately, so
the analysis cannot be fitted to the result afterwards. They are reproduced in the
hand-off. A crossed threshold is a finding to investigate, never a stop.

### Then

1. Report to `docs/build/artifacts/conductor-report.md` — three arms, three reps,
   per-task spread, and the §23.4 transcript answer as its own section: *does the
   baseline arm use `webfetch` or read-shaped `bash` in ways the conductor arm
   does not, and does that use correlate with passing?*
2. Commit with the message `conductor: 14.2 POC run` — row 12 matches
   `docs/build/STATE.json`'s `commitMessage` for the task exactly, and counts it once.
3. `bash scripts/verify-acceptance.sh` should then reach 21/21.

**It is a legitimate outcome of this campaign that Phases 24–27 are not built.**
