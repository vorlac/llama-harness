# User guide

How to install the model harness, serve an open-weight model locally, and run real work
through conductor. These pages are written for people *using* llama-harness; the internals
are in the [developer guide](../developer/README.md).

The workspace has two halves, and the guide is ordered to match. The **model harness** is a
set of Python scripts plus a pinned `llama.cpp` submodule that download, verify, serve, and
benchmark GGUF models, and point [opencode](https://opencode.ai) at them. **conductor** sits
on top: an opencode plugin, a C++ request router, and the wiring that carries both into
whatever workspace you are working in. You can use the first half without the second; the
second assumes the first is already serving a model.

## Reading order

1. **[Quickstart](quickstart.md)** — *What is the shortest path from a fresh clone to a
   local model answering a prompt?*
   `./setup.sh`, one model install, `scripts/serve.py`, and a ready shell.

2. **[Installation](installation.md)** — *What does this machine need, and what gets put
   where?*
   Prerequisites, the guided installer, building the `llama-*` binaries from the pinned
   submodule, the conductor and C++ development environments, and the layout of the gitignored
   `.data/` and `.out/` directories.

3. **[Models](models.md)** — *Which model should I install, and how do I know the download
   is intact?*
   The catalog of 24 models, what fits the machine, and the `scripts/fetch_models.py`
   subcommands — including the four-step validation every install runs.

4. **[Serving](serving.md)** — *How do I get one endpoint that serves every installed
   model?*
   `llama-server` in router mode, on-demand weight swapping, the `llama-router` proxy in front
   of it, and the session-scoped opencode config that `scripts/serve.py` generates.

5. **[conductor overview](conductor-overview.md)** — *What is conductor, and why does it
   exist?*
   The three layers, what each one is allowed to do, and the case for enforcing process
   mechanically rather than asking a local model to behave.

6. **[Run lifecycle](run-lifecycle.md)** — *What actually happens between a request and a
   report?*
   Classification, decomposition, planning and plan review, waves of items through the TDD
   discipline, adversarial review, and the stop kinds that end a run.

7. **[Tool reference](tool-reference.md)** — *What does each `conductor_*` tool do, and when
   is it legal to call?*
   One entry per tool: arguments, the state it advances, and the evidence its handler
   re-derives.

8. **[Gates and hatches](gates-and-hatches.md)** — *Why was that denied, and what are my
   legal ways out?*
   The gate stack in evaluation order, plus the two escape hatches — the scoped inline claim
   and the budgeted, taint-recording override.

9. **[Configuration](configuration.md)** — *Which knobs exist, and what do they change?*
   The conductor config file key by key, the harness config it reads, and the settings that
   are deliberately not adjustable.

10. **[Observability](observability.md)** — *How do I see what a run did?*
    The liveness beacon, `conductor_status`, the journal and the evidence, decision, anomaly
    and question ledgers, and the report a terminal path always writes.

11. **[Benchmarking](benchmarking.md)** — *How good is this model on this machine?*
    `scripts/benchmark.py`, the ten named presets, the three scoring tiers, why the
    interesting number is the gap between a model's self-assessment and its objective score,
    and the separate three-arm bench that measures conductor itself.

12. **[Troubleshooting](troubleshooting.md)** — *It is not doing what I expect. Now what?*
    The common failures in order of likelihood, each with the check that confirms it and the
    fix.

## If you only read three pages

| Page                                  | Why                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Quickstart](quickstart.md)           | It is the whole install-to-prompt path in one screen, and everything else assumes you have done it once.                                               |
| [Run lifecycle](run-lifecycle.md)     | Conductor's behavior is only surprising until you know which state the run is in; this page is that map.                                               |
| [Troubleshooting](troubleshooting.md) | Its conductor section states the first rule of operations — no beacon, no conductor — which explains a whole class of "the gates did nothing" reports. |

Read them in that order. The other nine pages are reference material you can reach for when
a specific question comes up, not prerequisites.

## See also

- [Developer guide](../developer/README.md) — architecture, invariants, and the reasoning
  behind each enforcement layer.
- [FAQ](../faq/README.md) — short answers to the questions that come up most.
- [scripts/README.md](../../scripts/README.md) — the deep reference for the model harness:
  every subcommand, flag, environment variable, and scoring rule.
- [Documentation hub](../README.md) — the index for everything else, including the plan and
  the build records.
- [Project status](../developer/project-status.md) — these pages describe the system as
  designed; this one records what is built today.
