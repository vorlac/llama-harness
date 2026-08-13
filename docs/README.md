# llama-harness documentation

This is the documentation set for `llama-harness`: a self-contained macOS/Apple-Silicon
workspace that installs, serves and benchmarks open-weight GGUF models locally, and
**conductor**, the TDD-enforcing orchestration harness for [opencode](https://opencode.ai)
built on top of them. Every page in the set appears in the tables below, grouped by who it
is for, with one line saying what it answers.

## Where to start

| If you want to                                      | Open                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Run a local model and point a coding agent at it    | [User quickstart](user/quickstart.md)                                                         |
| Understand and use conductor on your own repo       | [Conductor overview](user/conductor-overview.md), then [Run lifecycle](user/run-lifecycle.md) |
| Change conductor, add a tool, or work on the router | [Architecture](developer/architecture.md), then [Extending](developer/extending.md)           |
| Fix something that just went wrong                  | [Troubleshooting](user/troubleshooting.md), then the [FAQ](faq/README.md)                     |
| Know what is built today and what is not            | [Project status](developer/project-status.md)                                                 |

## Getting started

- [Quickstart](user/quickstart.md) — install a model, start the server, get a working
  opencode session, in that order.
- [Installation](user/installation.md) — what `./setup.sh` does, what it needs on the
  machine first, and what it writes where.
- [FAQ](faq/README.md) — the short answers to the questions people ask before reading
  anything else.

## User guide

Task-shaped pages for running the harness. Index: [docs/user/](user/README.md).

| Page                                             | Answers                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [Quickstart](user/quickstart.md)                 | How do I get from a fresh clone to a model answering prompts?                                  |
| [Installation](user/installation.md)             | What does the guided install do, and what does it require?                                     |
| [Models](user/models.md)                         | Which of the 24 catalog models fit this machine, and how do I install, verify and remove them? |
| [Serving](user/serving.md)                       | How does `scripts/serve.py` start `llama-server` and hand opencode a ready shell?              |
| [Conductor overview](user/conductor-overview.md) | What is conductor, what does it enforce, and why is it split into three layers?                |
| [Run lifecycle](user/run-lifecycle.md)           | What happens between typing a prompt and reading `report.md`?                                  |
| [Configuration](user/configuration.md)           | Which keys live in `.conductor/config.json`, and what does each one change?                    |
| [Tool reference](user/tool-reference.md)         | What does each `conductor_*` tool do, when is it legal, and what does it return?               |
| [Gates and hatches](user/gates-and-hatches.md)   | Why was that call denied, and what are the two legal ways around a gate?                       |
| [Observability](user/observability.md)           | Where are the logs, ledgers and reports, and which one answers my question?                    |
| [Benchmarking](user/benchmarking.md)             | How do I score a model with the 10 presets, and what do the scoring tiers mean?                |
| [Troubleshooting](user/troubleshooting.md)       | The symptom I am looking at, and the fix for it.                                               |

## Developer guide

How the system is built and why it is shaped this way. Index:
[docs/developer/](developer/README.md).

### Foundations

| Page                                                  | Answers                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Architecture](developer/architecture.md)             | What are the three layers, what does each one own, and which way do the dependencies point?        |
| [Design constraints](developer/design-constraints.md) | Which global constraints bind every module, and what do they forbid?                               |
| [Core and adapters](developer/core-and-adapters.md)   | Why is `conductor/core/` pure and `conductor/adapter/` the only I/O, and where does the line fall? |

### Subsystems

| Page                                                            | Answers                                                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [State machines](developer/state-machines.md)                   | What are the run and item FSM positions, and which transitions are legal?                                      |
| [Gates](developer/gates.md)                                     | How does the gate stack decide to deny a tool call, in what order, and why is it fail-closed?                  |
| [Evidence and quarantine](developer/evidence-and-quarantine.md) | How is a verify result derived, start-stamped and voided, and why does quarantine move files outside the repo? |
| [Scheduling and fanout](developer/scheduling-and-fanout.md)     | How is a wave computed, and how does one session drive parallel sub-sessions?                                  |
| [Doctrine system](developer/doctrine-system.md)                 | What is in the nine doctrine packs, and how does injection put them in front of the model every request?       |
| [Schemas](developer/schemas.md)                                 | What is the exact shape of every persisted record, and how are the JSON Schemas exported?                      |
| [llama-router](developer/llama-router.md)                       | What does the C++ proxy do for admission, affinity, schema observation and metrics, and why is it fail-soft?   |
| [opencode integration](developer/opencode-integration.md)       | Which opencode hooks and endpoints does conductor rely on, and where does the binary drift from the plan?      |
| [Observability internals](developer/observability-internals.md) | How are journal events, levels and sinks structured, and what makes a run replayable?                          |

### Platform and process

| Page                                                              | Answers                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Testing and verification](developer/testing-and-verification.md) | Why is `bash scripts/test-conductor.sh` the only gate, and what does it check that `node --test` cannot? |
| [Extending](developer/extending.md)                               | How do I add a tool, a gate, a doctrine pack or a router route without breaking the invariants?          |
| [Build system](developer/build-system.md)                         | How are the CMake targets, presets and vcpkg ports laid out, and which targets are safe to build?        |
| [Project status](developer/project-status.md)                     | What is committed and green today, what is next, and what is deferred?                                   |

## Reference and design records

These files predate this documentation set and remain authoritative for their own subject.
Where a guide page and one of these disagree, these win.

| Document                                                                    | Authoritative for                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Conductor harness plan](plans/2026-08-07-conductor-harness-plan.md)        | The full specification — 3399 lines, revision 5, **immutable**. Every schema, state machine, gate rule and phase task is defined here; guide pages cite it as `plan §N.N`.                                           |
| [conductor/DECISIONS.md](../conductor/DECISIONS.md)                         | The standing decisions, append-only: what was decided, which options lost, and why. Entries sit at rung 2 of the decision ladder and bind later work.                                                                |
| [conductor/adapter/wire-notes.md](../conductor/adapter/wire-notes.md)       | What opencode 1.18.15 actually does — verified hooks, endpoints, and the drifts from the plan's wire contract. Read before touching adapter or router code.                                                          |
| [conductor/docs/RUNNER-DISCOVERY.md](../conductor/docs/RUNNER-DISCOVERY.md) | The measured proof behind quarantine: whether `node --test`, `pytest`, `go test ./...` and `ctest` reach a file in `.conductor/`, outside the repo, or in a nested worktree.                                         |
| [src/router/UPSTREAM_CONTRACT.md](../src/router/UPSTREAM_CONTRACT.md)       | `llama-server`'s `/v1` contract and the effective concurrent slot count the router's admission limits must respect. The live measurement is a recorded obligation of task 12.1; the file states the exact procedure. |
| [scripts/README.md](../scripts/README.md)                                   | The deep reference for the model harness: catalog, sizing, every `fetch_models.py` subcommand, what validation checks, and how benchmark scoring works.                                                              |
| [src/tools/README.md](../src/tools/README.md)                               | `membench`, the memory-bandwidth probe, and the measured answer it produced about alignment, first-touch faults and core placement.                                                                                  |
| [docs/build/HANDOFF.md](build/HANDOFF.md)                                   | The build's current position: what just landed, what is next, and the deviations in force.                                                                                                                           |
| [docs/build/STATE.json](build/STATE.json)                                   | Machine truth for the build — one row per task, with its gate result and commit.                                                                                                                                     |
| [docs/build/CORRECTIONS.md](build/CORRECTIONS.md)                           | Every deviation from the plan, append-only as `C-NNN`, each with the plan quote, the observed reality, and the blast radius.                                                                                         |
| [docs/reviews/](reviews/)                                                   | The adversarial reviews of the plan itself, including the audit that produced revision 5.                                                                                                                            |

## Conventions used in these docs

**Pages describe the system as designed.** Guides are written in the present tense against
the specification, so they read as one coherent description rather than a construction
report. Build state lives in exactly one place —
[developer/project-status.md](developer/project-status.md) — which carries the per-task
table of what is committed, what is next, and what is deferred. A page whose whole subject
has no working code behind it yet says so in a single italic line at the top and then gets
on with describing it.

**Where the code and the plan disagree, the code wins.** The plan is immutable, so a
deviation is never edited into it; it is recorded in
[docs/build/CORRECTIONS.md](build/CORRECTIONS.md) and carried in
[docs/build/HANDOFF.md](build/HANDOFF.md), and these pages describe the code. The known
cases are the `src/` layout (`src/tests/` and `src/tools/`, not the plan's
`src/router-tests/` and root `tools/`) and the opencode wire drifts recorded in
[wire-notes.md](../conductor/adapter/wire-notes.md).

**File references are links to the real file.** When a page names a source file, config
file or script, it links to it by a relative path — `conductor/core/schedule.ts`,
`scripts/serve.py`, `src/router/config.hpp` — so you can click through from the
description to the thing described. Files named as part of the design but not yet on disk
appear as plain code spans, never as links.

**Diagrams are Mermaid and render on GitHub.** State machines are drawn with `flowchart`
rather than `stateDiagram-v2`, whose theming does not survive GitHub's renderer. The
palette is deliberately flat: mostly neutral grey, one accent family, and semantic green,
amber or red only where the color carries meaning. A diagram appears only where it shows a
mechanism a table cannot; most pages need none.

**No emoji, no marketing voice.** Code fences always name their language. American English,
sentence case headings, Oxford comma.

## See also

- [Repository README](../README.md) — the one-page introduction to both halves of the
  workspace.
- [Conductor harness plan](plans/2026-08-07-conductor-harness-plan.md) — the specification
  everything here describes.
- [Project status](developer/project-status.md) — what is actually built right now.
