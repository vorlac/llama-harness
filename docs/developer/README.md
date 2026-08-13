# Developer guide

This guide is for anyone who is going to change conductor: its state machines, its gates, its
evidence engine, the C++ router in front of `llama-server`, or the wiring that carries all of
it into a target workspace. It explains why each piece is shaped the way it is, because most
of conductor's design is a deliberate refusal of an easier option, and a change that does not
know which refusal it is undoing will quietly reopen it.

## Where the code lives

```text
conductor/                     TypeScript opencode plugin — layer 1, all enforcement
  plugin/index.ts              plugin entry: hook registration and tool registration
  core/                        pure decision and state-machine modules (G3), no I/O
  adapter/                     all I/O: state store, journal, evidence, quarantine, fan-out
  doctrine/                    nine prompt packs, injected into every request
  tools/export-schemas.ts      emits the JSON Schemas derived from core/types.ts
  tests/                       the suite; run it through scripts/test-conductor.sh
src/                           C++23 — layer 2
  main.cpp                     llama-router entry point
  router/                      router config, version, upstream contract notes
  tests/                       doctest suite; CMake target is named router-tests
  tools/membench/              standalone memory-bandwidth probe
scripts/                       Python 3 harness and wiring — layer 3
```

The include rule for C++ is absolute: every in-workspace header is included by its full path
relative to `src/` — `#include "router/version.hpp"`, never `#include "version.hpp"`.

## Read these first

Read these three in order. They are the only pages that assume nothing.

1. [architecture.md](architecture.md) — the three layers, what each one can and cannot see,
   and why the dependency arrow only ever points one way. Nothing else makes sense until you
   know that layer 1 is the only layer that can observe a tool call.
2. [design-constraints.md](design-constraints.md) — the global constraints G1–G14 in full,
   with the rationale each one carries. Read it second because it explains why architecture is
   the shape it is, and it is the document your change will be reviewed against.
3. [core-and-adapters.md](core-and-adapters.md) — the pure-core / thin-adapter split, the
   purity test that enforces it, and where your new code is allowed to go. Read it last of the
   three because it turns the previous two into a rule about which directory you edit.

## Subsystems

| Page                                                     | What it covers                                                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [state-machines.md](state-machines.md)                   | The run FSM and the item FSM, their legal transitions, and why `blocked`, `deferred`, and `debugging` are annotations rather than positions.  |
| [gates.md](gates.md)                                     | The four-stage gate stack — session registry, git policy, edit scope, ask-gate — its evaluation order, and its fail-closed behavior.          |
| [evidence-and-quarantine.md](evidence-and-quarantine.md) | Start-stamped verifies, the closed failure-class vocabulary, freshness voiding, and why the foreign red set moves outside the repository.     |
| [scheduling-and-fanout.md](scheduling-and-fanout.md)     | Wave construction, conservative glob intersection, intrinsic ordering, and the fan-out engine that drives sub-sessions over the opencode SDK. |
| [doctrine-system.md](doctrine-system.md)                 | The nine packs, always-on injection, the live state block, and why doctrine is never an opt-in skill.                                         |
| [schemas.md](schemas.md)                                 | The types in `core/types.ts`, the JSON Schemas exported from them, and the validation the fan-out engine performs on every structured reply.  |

## Platform and process

| Page                                                       | What it covers                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [llama-router.md](llama-router.md)                         | The C++23 reverse proxy: admission control, prefix affinity, wire-level schema observation, per-request metrics, and its fail-soft contract. |
| [opencode-integration.md](opencode-integration.md)         | The verified wire contract, the drifts against opencode 1.18.15, plugin loader rules, and the realpath requirement.                          |
| [observability-internals.md](observability-internals.md)   | The ledgers — evidence, decision, anomaly, question — the journal format, and the liveness beacon.                                           |
| [testing-and-verification.md](testing-and-verification.md) | The canonical test gate, what its TAP trailer parsing rejects, the stub scan, and the dual-runtime smoke.                                    |
| [build-system.md](build-system.md)                         | CMake presets, the three buildable targets, the `src/` include root, and why a bare `cmake --build` is wrong here.                           |
| [extending.md](extending.md)                               | How to add a `conductor_*` tool, a gate, a doctrine pack, or a role without breaking the invariants above.                                   |
| [project-status.md](project-status.md)                     | The single authoritative record of what is built, what is next, and what is deferred. Check it before you plan work.                         |

## The rules that bind every change

These are the global constraints from the plan. They bind every task, in both languages, and
a change that violates one is rejected regardless of how well it works.
[design-constraints.md](design-constraints.md) gives each one its full treatment.

| Id  | Constraint                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Zero runtime dependencies in the plugin: standard built-ins plus what opencode hands it, no bundler, no build step.                             |
| G2  | Erasable TypeScript only: no `enum`, no `namespace`, no parameter properties, and `.ts` extensions on internal imports.                         |
| G3  | Pure core, thin adapter: every policy decision is a pure function in `core/`; all I/O lives in `adapter/`.                                      |
| G4  | TDD for the harness itself: failing test observed first, then minimal implementation; no stubs or TODOs in committed code.                      |
| G5  | Fail-closed on enforcement, fail-open on convenience: a gate crash denies, and the router never rejects what the direct path would have served. |
| G6  | Records over assertions: a claim counts only when the harness produced or re-derived the evidence itself.                                       |
| G7  | Detection over prevention, honestly documented: gates fire on opencode tool calls only, and every known bypass is written down.                 |
| G8  | The orchestrator does not write code by default: its `edit` permission is `ask`, granted only by an active inline claim.                        |
| G9  | Local models are assumed weak at prose compliance: every obligation is a schema, a tool, or a gate — never only an instruction.                 |
| G10 | Naming is fixed: the system is conductor, tools are `conductor_*`, workspace state is `.conductor/`; tests hardcode these.                      |
| G11 | Wire contracts are verified against installed binaries, not assumed; drift updates the adapter constants, never the core.                       |
| G12 | Token cost is accepted, wall-clock is engineered: no gate or review stage may be weakened to save tokens.                                       |
| G13 | One model, many roles: a role selects doctrine pack, sampling, priority tag, and gate posture — never weights.                                  |
| G14 | Dual-runtime adapters: Node-compatible built-ins only, the Bun shell `$` is never used, every subprocess goes through `execFile`.               |

## Before you commit

```bash
bash scripts/test-conductor.sh                                    # whole suite: TAP gate, tsc --noEmit, Bun smoke, schema export
bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'  # one slice, quoted so the shell does not expand it
bash scripts/conductor-gate.sh                                    # mechanical stub scan: stub markers, skipped/todo tests, trivially-true assertions, empty catch blocks
```

Never run `node --test` directly for a gate decision: on Node v26.7.0 a directory positional
resolves as a module and produces a bogus `MODULE_NOT_FOUND` that looks exactly like a real
failure, and a glob matching zero files exits 0 — a vacuous green. The wrapper parses the TAP
trailer and fails unless `tests > 0` and every one of `fail`, `cancelled`, `skipped`, and
`todo` is zero, with no `# SKIP` or `# TODO` directive at any subtest depth.

## See also

- [design-constraints.md](design-constraints.md) — the constraints above, in full
- [../user/README.md](../user/README.md) — the user guide, for how the system behaves from the outside
- [../plans/2026-08-07-conductor-harness-plan.md](../plans/2026-08-07-conductor-harness-plan.md) — the immutable design authority
- [../../conductor/DECISIONS.md](../../conductor/DECISIONS.md) — recorded design decisions and their rationale
- [../build/HANDOFF.md](../build/HANDOFF.md) — where the build stands and the deviations currently in force
- [../build/CORRECTIONS.md](../build/CORRECTIONS.md) — every deviation from the plan, append-only as `C-NNN`
