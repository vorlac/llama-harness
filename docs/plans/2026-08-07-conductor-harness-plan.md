# Conductor — a TDD-enforcing, adversarially-reviewed orchestration harness for opencode + llama.cpp

> **Revision 5 (2026-08-12).** Incorporates the full adversarial audit recorded in
> `docs/reviews/2026-08-12-conductor-plan-adversarial-review.md` (7 critical, 10 high,
> 13 medium, 8 low — all applied) and the decision to serve **one model for every role**
> (G13, `qwen3.6-27b`). §14 records what changed and why. If you are looking for the
> mechanisms most likely to still be wrong, §14's closing paragraph names four.
>
> **For the implementing agent:** Execute this plan task-by-task, in order, checking off each
> `- [ ]` step as it completes. Each task is a strict red→green→commit TDD cycle; never start
> a task before the previous task's green step passed.
>
> **THIS DOCUMENT IS FULLY SELF-CONTAINED.** It assumes zero knowledge of any prior
> conversation. Every schema, rule, state machine, decision function, and test it references
> is defined inside this document. The repository it lands in is `llama-harness` — a
> workspace that installs curated GGUF models, serves them through a llama.cpp
> `llama-server` in router mode, and wires [opencode](https://opencode.ai) at whichever
> model the user picked (`scripts/serve.py`). You are building ON TOP of that plumbing; do
> not rebuild it.

**Goal:** Build **conductor** — an enforcement + orchestration harness for opencode that
imposes a test-driven, adversarially-reviewed development workflow on EVERY prompt,
automatically decomposes work into small verifiable items, runs as many parallel subagents
as the local model server can profitably serve, and behaves as an orchestrator (the main
session coordinates; subagents implement/review) while retaining the ability to work inline
when that is objectively cheaper. It is a POC measuring how much process enforcement +
parallel adversarial review improves the quality and accuracy of local-model coding at the
cost of tokens/wall-clock — with the wall-clock cost clawed back by a C++ scheduling layer
in front of `llama-server`.

**Architecture:** Three layers, strictly separated. (1) **conductor-core** — a TypeScript
opencode plugin: the workflow state machine, all gates (deny = throw inside
`tool.execute.before`), `conductor_*` custom tools that are the ONLY way to advance the
machine, sub-session fan-out via the opencode SDK, evidence/decision/anomaly ledgers, and
live state injection into every request's system prompt. All process enforcement lives
here, because only the plugin can see tool calls and session lifecycle. (2)
**llama-router** — a C++ reverse proxy in front of `llama-server` (this repo's `src/`,
building on the deps already in `vcpkg.json`): admission control, prefix-affinity
grouping, wire-level JSON-schema observation on gated requests, and a per-request metrics
ledger. It buys wall-clock and measurement; it is **fail-soft** — if it is not running,
the identical process is enforced, just slower (G5). (3) **wiring** — the existing
`scripts/serve.py` grows the ability to launch llama-router and to inject the conductor
plugin + agents + permissions into the session-scoped opencode config it already
generates, so the harness travels into whatever workspace the user `cd`s into.

**Serving model (normative, G13):** ONE model serves every role — orchestrator, planner,
implementer, test-writer, reviewer, skeptic, mechanical — `qwen3.6-27b` by default. Roles
remain a first-class concept (they select doctrine, sampling, gate posture, and router
tags), but they do not select weights. This removes model-swap cost from the design
entirely and removes the largest confound from the POC measurement (§8 Phase 14). Per-role
model overrides exist in the config schema and are OUT of the base build's supported
surface (§10 stretch).

**Tech Stack:** TypeScript executed by opencode's embedded runtime (plugin) and by Node ≥ 24
type-stripping (`node --test` for the plugin's own tests; Node 26 is installed) — zero npm
runtime dependencies, `@opencode-ai/plugin` as a dev-time types-only dependency. C++23 +
CMake + vcpkg for llama-router (`cpp-httplib`, `nlohmann-json`, `json-schema-validator`,
`spdlog`, `doctest`; `ftxui` for the optional dashboard — `spdlog` and `ftxui` are already
in `vcpkg.json`). Python 3.9 for the wiring (matching the existing scripts). git ≥ 2.30.
macOS/Apple Silicon is the only supported platform for the POC (this workspace's stated
scope); nothing may *gratuitously* break Linux, but no task verifies it.

---

## Global constraints

These bind every task in this plan. Re-read them at each phase boundary.

- **G1 — Zero runtime dependencies in the plugin.** The TS layer uses only standard
  runtime built-ins plus the objects opencode hands the plugin (`client`, `$`, `directory`,
  `worktree`). `@opencode-ai/plugin` is a types-only dev dependency. No bundler, no build
  step: opencode loads `.ts` source directly.
- **G2 — Erasable TypeScript only.** Node's type stripping runs the same files under
  `node --test`, so: no `enum`, no `namespace`, no parameter properties, no `const enum`.
  Imports between our files use explicit `.ts` extensions. One `tsconfig.json` with
  `"erasableSyntaxOnly": true` pins this mechanically.
- **G3 — Pure-core / thin-adapter.** Every policy decision is a pure function
  `(parsedInput, stateSnapshot) → decision` in `conductor/core/`. Core modules import ONLY
  other core modules — never `node:fs`, `node:child_process`, the opencode client, or
  `Bun`. All I/O lives in `conductor/adapter/`. A purity test enforces the split
  mechanically (Task 1.4). This is what makes every gate deterministic and replay-testable.
- **G4 — TDD for the harness itself, no exceptions.** Every module lands ONLY as: failing
  test written and observed to fail for the real reason → minimal implementation → test
  observed to pass → commit. A module without an executing test does not exist. No stubs,
  no TODOs, no placeholder bodies in committed code. The same law applies to the C++ layer
  (doctest) and the Python wiring (pytest-style via `unittest`, stdlib-only).
- **G5 — Fail-closed on enforcement, fail-open on convenience.** A crash inside a gate
  while a git command or file write is being judged must DENY the action. A crash inside an
  injector, logger, or metrics writer must never block work. llama-router is fail-soft by
  design (layer 2 dies ⇒ layer 1 still enforces everything). **The router never returns a
  status the direct path would not have returned**: its schema guard OBSERVES and records,
  it does not reject (§4.4). "`--no-router` runs the identical process" is a literal
  requirement, tested in Task 12.1, not an aspiration.
- **G13 — One model, many roles.** Every sub-session and the orchestrator run the same
  served model (`config.models.default`). Roles select doctrine pack, sampling, priority
  tag, and gate posture — never weights. Any design that only pays off under multi-model
  routing (swap batching, per-model waves as a wall-clock lever) is either inert-by-
  construction under this constraint or lives in §10 stretch. The fan-out engine still
  groups jobs by resolved model so that a future multi-model config is a config change,
  not a redesign — under the default config that grouping is the identity function.
- **G14 — Dual-runtime adapters.** Adapter code runs under opencode's Bun runtime in
  production and under Node type-stripping in tests. Adapters therefore use ONLY
  Node-compatible built-ins (`node:fs`, `node:child_process`, `node:path`, `node:crypto`).
  The Bun-only shell `$` handed to the plugin is NEVER used — every subprocess goes
  through `execFile` with `shell:false`. A guard test enforces this (Task 1.4), and a Bun
  smoke task (Task 2.2) proves the state store and journal actually run under Bun before
  thirty modules depend on them.
- **G6 — Records over assertions.** A claim (test went red, review passed, decision was
  derived) counts only when a machine-checkable record exists, AND the harness itself
  produced or re-derived the evidence — the model's say-so is never the record. Every
  record format in this plan names its writer, its reader, and the test that exercises
  both. A ledger only the distrusted party writes, that nothing cross-checks, is process
  theater and is rejected at design time.
- **G7 — Detection over prevention, honestly documented.** Gates fire on tool calls made
  through opencode; a human at a raw terminal is ungated. Every known bypass is written in
  HONEST-LIMITS.md, never papered over.
- **G8 — The orchestrator does not write code by default.** The primary agent's `edit`
  permission is `"ask"`, and the plugin rejects every ask not covered by an active
  `conductor_inline_claim` (§3.6), which scopes edit permission to one item's declared
  files; implementation happens in dispatched sub-sessions.
- **G9 — Local models are assumed weak at prose compliance.** Every workflow obligation is
  (a) a schema-constrained output, (b) a tool the model must call, or (c) a gate that
  denies the wrong action — never only an instruction. Instructions exist to make the
  legal path obvious, not to carry enforcement.
- **G10 — Naming.** The system is **"conductor"**. Custom tools are `conductor_*`. Run
  state in a target workspace lives under `.conductor/` (ignored via
  `.git/info/exclude`, never by editing the target's tracked `.gitignore`). Source lives
  in this repo under `conductor/` (TS), `src/router/` (C++), `scripts/` (wiring). Do not
  improvise names; tests hardcode them.
- **G11 — Wire contracts are verified at build time, not assumed.** The opencode plugin
  API, SDK method shapes, config keys, and llama-server endpoints specified in §5 were
  verified against opencode 1.18.10 docs/source and this repo's live server on 2026-08-07.
  Tasks 0.2 and 11.1 re-verify them against the installed binaries before the adapter and
  router are written, and record `WIRE_CONTRACT_VERIFIED: <date> <what>` comments at the
  top of the affected files. Any drift updates the adapter constants, never the core.
- **G12 — Token cost is accepted; wall-clock is engineered.** No gate or review stage may
  be weakened to save tokens (the POC exists to measure the quality/cost trade honestly).
  Wall-clock optimizations live in the scheduler and llama-router, never in skipping
  process.

---

## §0. Orientation — what you are building and why (read once, fully)

### 0.1 The problem

A local LLM (here: a single ~27B dense model served by llama.cpp on this machine)
developing software has the same chronic failure modes as any LLM, amplified by smaller
capacity:

1. **Optimistic self-reporting** — "all tests pass" without running them.
2. **Process amnesia** — forgetting the workflow mid-session, especially near context
   limits (32–64k here, not 200k).
3. **Test-after theater** — writing the implementation, then a test that passes
   immediately and proves nothing.
4. **Anchored review** — reviewing its own work with the same context that produced it.
5. **Over-building** — speculative abstractions, unrequested features, the 400-line
   solution to the 12-line problem.
6. **Shortcut-taking under difficulty** — weakening an assertion, deleting a failing
   test, skipping the reviewer.

Prose instructions do not survive these failure modes because the failure modes ARE
failures to follow prose (G9). The fix is mechanical: a state machine the model can only
advance by calling typed tools whose handlers *re-derive the evidence themselves*, gates
that deny out-of-order actions, schema-constrained outputs that are parseable by
construction, and adversarial review by fresh-context sub-sessions that never saw the
implementation happen.

### 0.2 What opencode gives us (and what it doesn't)

The enforcement center of gravity differs from hook-based harnesses (Claude Code, Cursor):
opencode's plugin API cannot *refuse a turn-end pre-emptively* — but it CAN do five things
those systems cannot, and the design leans on all five:

| Capability | Used for |
|---|---|
| `tool` hook — plugin-defined, schema-typed custom tools | The workflow is a state machine advanced ONLY by `conductor_*` tool calls; handlers run the tests/diffs themselves (G6) |
| `tool.execute.before` — throw to deny any tool call | Git policy, edit-scope gate, freeze gate, phase-order gate |
| SDK: `client.session.create()` + `client.session.prompt()` with `format: {type:"json_schema"}` | Programmatic parallel sub-sessions with structured, schema-constrained results — fan-out does not depend on the model emitting parallel task calls |
| `experimental.chat.system.transform` | Live harness state (phase, active item, the recommended next tool call) injected into EVERY request — process re-stated every turn, never remembered |
| `permission.asked` bus event + SDK `permission.reply` + per-agent `question`/`edit` permissions + `session.idle` | A real ask-gate; continuation by re-prompting on idle (the "refusal" becomes "re-entry", with a disengage backstop) |

What it takes away: no pre-emptive stop hook (continuation is `session.idle` → SDK
re-prompt — see §3.7), and deny is an exception (`throw` in `tool.execute.before`), not a
structured response. Both are workable; §5 records the contract.

### 0.3 The three layers

```
  opencode session (any workspace the user cd's into)
        │  tool calls · session lifecycle · chat params
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ LAYER 1 — conductor (TS plugin)      ALL enforcement     │
  │  run/item state machines · gates · conductor_* tools     │
  │  fan-out engine · ledgers · doctrine injection · logs    │
  └──────────────────────────────────────────────────────────┘
        │  HTTP /v1/* (OpenAI-compatible), tagged with
        │  X-Conductor-Role / -Group / -Schema headers
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ LAYER 2 — llama-router (C++)      wall-clock + measure   │
  │  admission control · group affinity                      │
  │  schema observation (record, never reject) · metrics     │
  └──────────────────────────────────────────────────────────┘
        ▼
  llama-server --models-preset … --models-max 1 --parallel <slots>   (existing + Task 12.1)
```

Layer 1 is the only layer that can see a tool call, so every gate lives there. Layer 2
gets exactly the jobs the plugin structurally cannot do:

| Router job | Why the plugin can't | Payoff |
|---|---|---|
| Admission control (cap in-flight, priority queue) | Plugin doesn't own the server; concurrent sub-sessions would thrash a 20 GB model and exceed its slot count | 6 parallel reviewers don't grind generation to a halt |
| Group affinity (requests sharing a declared prefix group run contiguously) | Plugin can't influence server slot reuse timing | N reviewers share one huge prefix (diff+plan+rubric); keeping it KV-hot is the largest single wall-clock lever available under G13 |
| Schema OBSERVATION (gated request should carry a schema; non-stream responses checked against it) | The claimant would validate its own claim | A second, independent record of how often local-model structured output actually conforms — the POC's schema-compliance dataset |
| Metrics ledger (tokens, timings, queue wait per request) | Plugin sees only its own requests | The POC's cost numbers are measured, not estimated |

Swap-cost batching is deliberately NOT here: under G13 there is one model, so there are
no swaps to batch. It lives in §10 stretch, where per-role model routing also lives.

**Dependency direction is load-bearing:** layer 2 fail-soft, layer 1 fail-closed. Process
integrity NEVER depends on the router being up (G5), and the router never converts a
request the direct path would have served into a failure — a missing schema is journaled
and metered, not 400'd (§4.4). `serve.py --no-router` runs the identical workflow, and
Task 12.1 tests that claim rather than asserting it.

### 0.4 The enforcement inventory

| Mechanism | Fires on | Enforces |
|---|---|---|
| **phase-order gate** | every `conductor_*` tool call | FSM transitions only in legal order (§3); handler re-derives evidence before advancing |
| **session-registry gate** | every tool call | a session the plugin did not create and register has NO role, and every write-shaped or `conductor_*` call from it is DENIED (§3.5); sub-agent spawning tools are denied outright, so an unregistered session cannot be manufactured |
| **git-policy gate** | `tool.execute.before` (bash) | destructive git denied in every spelling; commit only via `conductor_publish`; parsed-token matching, never substring; **deny is the default for unlisted subcommands** |
| **edit-scope gate** | `tool.execute.before` (edit/write/patch/bash-writes) | orchestrator can't write code (G8); implementers write only inside their item's declared file scope; nobody — not even a test-writer — edits any file in a tree with a live verify |
| **evidence engine** | `conductor_*` handlers | RED/GREEN/VALIDATED derive from the harness running the commands itself; start-stamped freshness (an edit after a verify started voids it) |
| **review engine** | `conductor_item_review` / plan review | parallel fresh-context reviewers with distinct lenses → findings → parallel skeptic refutation → only surviving findings block |
| **ask-gate** | `permission.asked` event + SDK `permission.reply` + static agent permissions | subagent questions become surfaced questions on the run, not session stalls; human-territory questions reach the human batched |
| **continuation engine** | `session.idle` event | a run with actionable work re-prompts the orchestrator with the exact next action; disengage backstop after N futile re-prompts |
| **doctrine injection** | `experimental.chat.system.transform` + `chat.params` | phase-scoped doctrine (§6) + current state + the recommended next tool call, injected into every request |
| **override hatch** | `conductor_override` tool | records an anomaly, taints the item (taint reaches the final report), then permits exactly one gated action — **budgeted**: `maxOverridesPerItem`/`maxOverridesPerRun`, exhaustion ⇒ `env` stop, never another override (§3.6) |
| **ledgers + journal** | everywhere | every event as structured JSONL with runId/itemId correlation at configurable verbosity (§7); replayable |

### 0.5 The operating model

**Every prompt** (no invocation needed): the plugin classifies the prompt (question /
trivial / work — itself a recorded, adversarially-checked decision). Questions get
answered; trivial changes take a short path (§3.2); work enters the full pipeline:
decompose → plan → adversarial plan review (iterate until no majors) → execute items
(TDD + test-vet + validate + adversarial code review, parallel where profitable) → report.
The queue is **per-prompt and ephemeral** — created for the run, archived with it; no
global backlog.

Two item shapes exist, and the classifier/decomposer must choose one per item (§2.4
`behavioral`): a **behavioral** item walks the full TDD machine; a **non-behavioral** item
(comments, docs, formatting, pure renames) skips RED/TEST_VETTED and walks
GREEN→VALIDATED→REVIEWED→PUBLISHED. Non-behavioral is not a shortcut the model may take
for real code: an item may declare it only if EVERY path in its `fileScope` falls outside
`verify.behavioralPaths`, and the decompose handler enforces that mechanically (§3.2).
Without this path, "fix the typo in this comment" has no legal trajectory at all — the
test-writer cannot make a comment fail an assertion.

**The run is not the repository.** Runs are ephemeral, but the tree they touch is not: an
item abandoned below GREEN leaves a deliberately-red test behind. Those files are recorded
in a workspace-level registry (§2.11) and excluded from every later run's verification
until they are resolved, with the exclusion disclosed at run start and in every report.
A run that forgets this diagnoses the previous run's leftovers as its own bug.

**The orchestrator posture** (G8): the main session coordinates. It cannot edit source.
Sub-sessions implement, review, and critique — each freshly created, given exactly the
context it needs, returning schema-constrained results. Inline work happens only via the
recorded claim tool.

**Escape hatch:** `conductor_override` exists because gates are sometimes wrong. It is
deliberately expensive: a reason is required, an anomaly is recorded, the item is tainted,
and the taint is listed in the final report. A model that learns to reach for it leaves a
visible trail.

### 0.6 Doctrine, not skills

The superpowers skill library and the ponytail ruleset are carried over — but NOT as
opt-in skills. A local model will self-activate an optional skill approximately never
(ponytail's own README documents exactly this failure). Instead they are compiled into
**doctrine packs** (§6): short, phase-scoped rule slices injected by the plugin into the
system prompt of exactly the session that needs them (the test-writer gets the TDD iron
law and the anti-pattern gates; the planner gets ponytail's decision ladder and the
writing-plans rules; the debugger gets systematic-debugging's phase protocol) — and every
doctrine obligation that can be a gate IS one (G9). The mapping from each source skill to
its enforcement point is normative and lives in §6.

### 0.7 Provenance

This design generalizes two proven systems: (a) a production hook-enforced autonomous
harness (months of unattended development; the start-stamp freshness rule, parsed-token
git policy, records-over-assertions doctrine, disengage backstop, and stop-kind taxonomy
survive from it), and (b) the superpowers workflow library (TDD, systematic-debugging,
subagent-driven development with two-stage review, verification-before-completion) plus
ponytail's minimality ladder. Where those systems relied on frontier-model prose
compliance, this design substitutes tools, schemas, and gates (G9). Where the production
harness was single-writer by doctrine, this design adds scheduled parallelism with
declared file scopes and worktree isolation (§4), because the fan-out engine — not the
model — decides what runs concurrently.

---

## §1. Repository layout (what exists after the full build)

### 1.1 This repository (the harness's home)

```
llama-harness/
├── conductor/
│   ├── plugin/
│   │   └── index.ts                # THE opencode plugin entry: hook wiring ONLY —
│   │                               #   every hook body is one call into adapter/
│   ├── core/                       # PURE decision + state-machine modules (G3)
│   │   ├── fsm-run.ts              # run-level FSM: states, legal transitions (§3.1)
│   │   ├── fsm-item.ts             # item-level FSM (§3.3)
│   │   ├── gates-git.ts            # git-policy decision (parsed tokens) (§3.5)
│   │   ├── gates-edit.ts           # edit-scope + freeze decisions (§3.5)
│   │   ├── gates-phase.ts          # tool-legality decision per FSM state (§3.4)
│   │   ├── decide.ts               # decision-protocol helpers: option scoring,
│   │   │                           #   human-territory classifier (§6.2)
│   │   ├── schedule.ts             # wave computation: dependency DAG + scope
│   │   │                           #   disjointness → parallel waves (§4.2)
│   │   ├── shell-parse.ts          # quote/operator-aware tokenizer + git segment
│   │   │                           #   parser (ported semantics, §3.5)
│   │   ├── freshness.ts            # start-stamp freshness rule + evidence matching
│   │   ├── verdict.ts              # review-finding survival rule (K-skeptic vote)
│   │   ├── stops.ts                # stop-kind taxonomy + terminality + shouldTerminate
│   │   │                           #   (§2.9)
│   │   ├── journal-events.ts       # closed journal event vocabulary (§7.2, Task 2.1)
│   │   └── types.ts                # every schema in §2 as TS types + JSON Schemas
│   │                               #   (single source; adapter + router tests import)
│   ├── adapter/                    # ALL I/O (G3)
│   │   ├── state.ts                # .conductor/ state store: atomic writes, locks
│   │   ├── journal.ts              # leveled JSONL journal + console sink (§7)
│   │   ├── evidence.ts             # runs test/verify commands, captures red/green,
│   │   │                           #   writes evidence ledger (THE writer, G6)
│   │   ├── fanout.ts               # sub-session pool over the opencode SDK:
│   │   │                           #   create → prompt(format:json_schema) → collect,
│   │   │                           #   with per-model wave dispatch (§4)
│   │   ├── tools.ts                # conductor_* tool definitions (thin: parse args,
│   │   │                           #   call core decision, execute adapter effects)
│   │   ├── inject.ts               # system.transform + chat.params doctrine injection
│   │   ├── continuation.ts         # session.idle re-prompt engine + disengage
│   │   ├── worktrees.ts            # git worktree create/merge/remove for parallel
│   │   │                           #   implementers, OUTSIDE the repo (§4.2, Task 9.6)
│   │   ├── quarantine.ts           # move-aside/restore of foreign red tests into an
│   │   │                           #   OUT-OF-REPO dir, crash-safe manifest (§4.2)
│   │   ├── questions.ts            # surfaced-question ledger writer/reader (§2.11)
│   │   ├── gitio.ts                # read-only git queries (staged, diff, mtimes)
│   │   └── router-client.ts        # health/metrics client for llama-router (fail-soft)
│   ├── doctrine/                   # doctrine packs (§6) — markdown, versioned here
│   │   ├── core.md                 # always-on: honesty, records, ask policy, ponytail lite
│   │   ├── decompose.md            # decomposition rules + ponytail ladder (full)
│   │   ├── plan.md                 # writing-plans rules (bite-size, no placeholders)
│   │   ├── tdd.md                  # TDD iron law + anti-pattern gate functions
│   │   ├── test-vet.md             # test critique lenses (§3.3 TEST_VETTED)
│   │   ├── debug.md                # systematic-debugging four-phase protocol
│   │   ├── review.md               # reviewer calibration + severity rubric
│   │   ├── skeptic.md              # refutation posture for finding verification
│   │   └── receive-review.md       # no performative agreement; verify-then-fix
│   ├── tools/
│   │   ├── replay.ts               # journal → human timeline renderer (§7.3, Task 15.0)
│   │   └── export-schemas.ts       # writes the §2 JSON Schemas to
│   │                               #   src/router-tests/schemas/ (dev/test-time
│   │                               #   script, Task 11.1 — NOT a plugin build step; G1)
│   ├── docs/
│   │   ├── OPERATIONS.md           # ops guide (Task 15.1)
│   │   └── HONEST-LIMITS.md        # §9 verbatim (Task 15.1)
│   ├── opencode-fragment.json      # config fragment serve.py merges into the session
│   │                               #   opencode config: agent defs, permissions, plugin
│   ├── tests/                      # *.test.ts, run by `node --test` (Node ≥ 24)
│   │   ├── bun-smoke.test.ts       # the SAME state/journal assertions, run by `bun test`
│   │   │                           #   (G14 — Task 2.2; the only dual-runtime test file)
│   │   └── fixtures/               # fixture repos, fake SDK, canned model outputs
│   └── tsconfig.json               # erasableSyntaxOnly, allowImportingTsExtensions
├── src/
│   ├── router/
│   │   ├── main.cpp                # llama-router entry (arg parse, wire-up only)
│   │   ├── router.hpp/.cpp         # http server + proxy pass-through (streaming)
│   │   ├── admission.hpp/.cpp      # in-flight accounting, priority queue, caps
│   │   ├── affinity.hpp/.cpp       # prefix-group contiguous dequeue (§4.4)
│   │   │                           #   (no batcher: G13 ⇒ no swaps to batch, §10)
│   │   ├── schema-observer.hpp/.cpp # schema presence + response check, RECORD only
│   │   ├── metrics.hpp/.cpp        # per-request JSONL ledger + /conductor/metrics
│   │   └── config.hpp/.cpp         # router config load/validate
│   ├── router-tests/               # doctest suites (one per module above)
│   │   └── schemas/                # §2 JSON Schemas, exported by export-schemas.ts
│   └── dashboard/                  # OPTIONAL ftxui TUI reading the metrics ledger
│       └── main.cpp
├── scripts/
│   ├── serve.py                    # EXISTING — grows: --router/--no-router, plugin
│   │                               #   injection into the session opencode config
│   ├── conductor_wiring.py         # pure config-generation/merge functions (Task 12.1)
│   ├── conductor_bench.py          # POC evaluation driver (§8 Phase 14)
│   ├── test-conductor.sh           # runs export-schemas + node --test + bun smoke
│   │                               #   (Tasks 0.3, 2.2)
│   └── (existing scripts unchanged)
├── bench/
│   └── conductor-tasks.json        # POC task manifest (authored in Task 14.1)
├── docs/plans/2026-08-07-conductor-harness-plan.md   # this document
└── CMakeLists.txt                  # EXISTING — grows llama-router + router-tests +
                                    #   dashboard targets (replaces the stock example
                                    #   target `myprogram`; decision recorded §8 Task 0.1)
```

### 1.2 A target workspace (any repo the user cd's into)

```
<target repo>/
├── .conductor/                     # runtime state — ignored via .git/info/exclude
│   ├── config.json                 # per-repo config (verify scopes etc.), §2.1;
│   │                               #   created on first run by detection + questions
│   ├── state/
│   │   ├── current-run.json        # pointer {runId} | null
│   │   ├── alive.json              # liveness beacon {pid, startMs, version} rewritten
│   │   │                           #   at plugin init — absence means conductor is NOT
│   │   │                           #   loaded in this session (§3.8, H-limit 11)
│   │   ├── stale-red.json          # cross-run registry of abandoned red tests (§2.11)
│   │   ├── halt                    # OWNER-ONLY halt file (presence = halt;
│   │   │                           #   the model never creates/edits/deletes it)
│   │   └── run.lock                # advisory single-writer lock {pid, startMs}
│   └── runs/<runId>/               # one dir per prompt-run, self-contained
│       ├── run.json                # run FSM state + metadata (§2.3)
│       ├── queue.json              # decomposed items + DAG (§2.4)
│       ├── items/<itemId>.json     # per-item FSM state + evidence refs (§2.5)
│       ├── plan.md                 # the plan document (§3.2 PLANNED)
│       ├── report.md               # final report — written on EVERY terminal stop,
│       │                           #   not only `done` (§2.9, §3.2)
│       ├── journal.jsonl           # the full structured event journal (§7)
│       ├── evidence.jsonl          # red/green/verify records (§2.6)
│       ├── decisions.jsonl         # decision-protocol ledger (§2.7)
│       ├── anomalies.jsonl         # overrides, gate crashes, disengages (§2.8)
│       ├── questions.jsonl         # surfaced questions (§2.11) — the blocked-set source
│       └── reviews/<itemId|plan>-r<N>.json   # finding sets + verdicts (§2.10)
└── (the target project's own files)

OUTSIDE the repo (this is normative, not an implementation detail — §4.2/§4.3):
  <stateHome>/conductor/<workspaceKey>/
  ├── quarantine/<runId>/           # foreign red tests moved aside during a verify,
  │                                 #   plus manifest.json for crash-safe restore
  └── worktrees/<runId>/<itemId>/   # parallel-implementer worktrees
```

The `.conductor/` prefix is registered in the target's `.git/info/exclude` (not its
tracked `.gitignore`) the first time conductor touches a repo — the harness must never
dirty a target's tracked files with its own presence.

**Why quarantine and worktrees live outside the repo.** `.git/info/exclude` hides a
directory from *git*. It hides it from nothing else. The verify command is the target
repo's own test command, and every default the plan ships (`node --test`, `pytest`,
`go test ./...`, `ctest`) discovers tests by walking the tree — so a red test file parked
under `.conductor/` can still be collected and executed by the very verify it was moved
aside to protect, and a worktree (a complete second checkout of every test file in the
repo) is guaranteed to be. Per-runner discovery behaviour for dot-directories is a
version-dependent accident and MUST NOT be relied on; Task 6.2 measures it and records
the result, but correctness comes from the files being outside the walked tree entirely.
`<stateHome>` = `$XDG_STATE_HOME` when set, else `~/.local/state` (macOS included — the
POC does not use `~/Library`, so the path is identical on both platforms);
`<workspaceKey>` = the repo root's absolute path hashed (sha256, first 16 hex chars) plus
its basename, so two checkouts of the same project never collide.

---

## §2. Schemas (exact; tests hardcode these)

All JSON written UTF-8 without BOM; all reads BOM-tolerant. Timestamps are epoch
milliseconds (`number`) unless the field name ends in `Iso`. Every schema below exists
once, as both a TS type and a JSON Schema object, in `conductor/core/types.ts`; the
fan-out engine passes the JSON Schemas to `session.prompt({format})`, and llama-router's
tests reuse the same schemas (exported to `src/router-tests/schemas/` by
`conductor/tools/export-schemas.ts`, a dev/test-time script wired in Task 11.1 — single
source, two consumers).

### 2.1 `.conductor/config.json` — per-target-repo manifest

```jsonc
{
  "version": 1,
  "verify": {
    // Named scopes; argv arrays ONLY (spawned shell:false). buildCommand optional and
    // runs first; if it fails the scope is red with phase:"build" and the test command
    // is NOT run (tests against a stale artifact are a false green).
    "scopes": {
      "unit": { "command": ["node", "--test"], "timeoutMs": 600000,
                // OPTIONAL per-scope targeted-test template: substituted and run by
                // conductor_submit_test / conductor_mark_green (Tasks 6.1/9.4).
                // When absent, those handlers fall back to the FULL scope command —
                // run with the §4.2 quarantine (the FOREIGN RED SET: every other
                // queue item's testScope below GREEN, plus every entry in the
                // workspace stale-red registry §2.11; the item's own tests are
                // never excluded) — and additionally require the failure excerpt
                // to name a file in the item's testScope, otherwise the red is
                // ILLEGAL (a suite failure elsewhere must not impersonate this
                // item's red).
                // Task 12.2's detection defaults: node --test {files};
                // pytest {files}; go test {dirs}; ctest -R {name}.
                // Substitutions (all implemented in evidence.runTest, Task 6.1):
                //   {files} = the item's testScope files as argv entries;
                //   {dirs}  = the unique parent dirs of the testScope files in
                //             ./dir form (go's package targeting — `-run` with file
                //             basenames matches nothing and lies with exit 0);
                //   {name}  = an alternation regex over the BASENAMES (extensions
                //             stripped) of the testScope files — valid ONLY where
                //             the runner's registered test names contain them (the
                //             ctest default assumes the file-named-test convention).
                // Zero-test guard: a targeted run that executed NO tests (per-runner
                // zeroTestPatterns; defaults "no tests to run", "No tests were
                // found", "no tests ran") is NEITHER a legal red NOR a pass — the
                // handler falls back to the quarantined full-scope run + excerpt
                // rule and journals a targeting warning.
                "itemTest": ["node", "--test", "{files}"] }
    },
    // Globs whose changes owe verification. LOAD-BEARING IN TWO PLACES, not one:
    //   (a) the freshness rule (§2.6) — only staged behavioral files can go stale;
    //   (b) the non-behavioral item path (§2.4 `behavioral`, §3.3) — an item may
    //       declare behavioral:false ONLY if every fileScope glob is disjoint from
    //       these. That makes "skip the failing test" mechanically impossible for
    //       real code and trivially legal for a comment fix.
    // Task 12.2 detection proposes these per ecosystem (node: src/**, lib/**;
    // python: <pkg>/**; go: **/*.go minus **/*_test.go; cmake: src/**, include/**)
    // and the user confirms — a wrong value here is the difference between an
    // enforced TDD law and an optional one, so it is asked, never silently defaulted.
    "behavioralPaths": ["src/**"],
    "requiredScopes": [ { "pattern": "**", "scopes": ["unit"] } ]
  },
  "format": {
    // Rules the conductor_publish handler applies to the item's staged files before
    // the final freshness check. First matching rule per file wins.
    //   mode "stdin": file content is piped to `command` ({file} substituted for
    //     --stdin-filepath-style flags); when stdout differs byte-wise the handler
    //     writes it back and restages. Non-zero exit, spawn failure, or empty stdout
    //     on non-empty input = "formatter FAILED": publish is denied naming the
    //     formatter, and the file is NEVER overwritten (a crashed formatter's stdout
    //     is not a formatting verdict — failure and dirty are distinct outcomes).
    //   mode "check": `command` runs with {file} substituted; non-zero exit = dirty ⇒
    //     publish denied naming the file and rule (no auto-fix in check mode).
    "rules": []                         // e.g. [{ "pattern": "**/*.ts", "mode": "stdin",
                                        //   "command": ["prettier", "--stdin-filepath", "{file}"] }]
  },
  "git": {
    "mode": "commit",                   // "read-only" | "commit" | "commit-and-push";
                                        //   asked on first run in a repo, NEVER defaulted
    // Branch discipline. HEAD is captured at run start and recorded in every verify
    // record (§2.6); publish REFUSES if HEAD moved since the verify it is publishing
    // (a green on one branch is not a green on another). "pin" additionally denies all
    // branch-movement commands for the duration of a non-terminal run.
    "branchPolicy": "pin",              // "pin" | "check-only"
    // Publish stages ONLY files the harness itself changed since run start; paths that
    // were already dirty at run start are never swept into a conductor commit (§3.3).
    // "refuse" = a dirty path inside an item's fileScope blocks that item's publish with
    // a surfaced question; "exclude" = publish proceeds, staging only harness-changed
    // paths, and lists the skipped paths in the report.
    "preexistingDirty": "refuse"        // "refuse" | "exclude"
  },
  "workflow": {
    "trivialMaxFiles": 2,               // §3.2 trivial-path ceiling
    "planReviewers": 4,                 // parallel plan-review lenses per round
    "planReviewMaxRounds": 3,
    "itemReviewers": 6,                 // §3.3 lens sessions per item; the mandatory
                                        //   lens set (§3.3) is never truncated away
    "skepticsPerFinding": 2,            // K; a finding survives iff upholds ≥ ⌈K/2⌉
                                        //   (a tie upholds — a split finding earns a fix round)
    "reviewMaxRounds": 3,               // per item: review → fix → re-review cap
    "vetCritics": 3,                    // TEST_VETTED critics
    "vetMaxRounds": 3,                  // RED: vet → repair → re-vet cap (distinct knob
                                        //   from reviewMaxRounds; different loop, different
                                        //   cost, tuned independently)
    "testRepairAttempts": 3,            // submit_test: illegal-red repair attempts
    "debugFixCap": 3,                   // failed fixes before architecture escalation
    // The override budget (§3.6). Every gate in this system is advisory to a model that
    // can call conductor_override without limit, and a struggling local model WILL find
    // it — the deny messages name it. Exhaustion is an `env` stop, never another override.
    "maxOverridesPerItem": 1,
    "maxOverridesPerRun": 2
  },
  "parallel": {
    "writes": "off",                    // "off" | "worktrees" (§4.2/§4.3, Task 9.6)
    "maxImplementers": 2,
    "maxReaders": 6,                    // reviewer/critic fan-out ceiling; MUST be ≤ the
                                        //   server's slot count or the fan-out serializes
                                        //   upstream and the parallelism is imaginary —
                                        //   serve.py derives --parallel from this
                                        //   (Task 12.1) and setup verifies it (Task 12.2)
    "subSessionTimeoutMs": 900000       // fan-out watchdog per sub-session (Task 7.1);
                                        //   deliberately > router queueTimeoutMs so a
                                        //   queue timeout reports as a queue timeout and
                                        //   not as two simultaneous unrelated failures
  },
  "models": {
    // G13: ONE model serves every role. `default` is the served model id (a section name
    // in .data/configs/llama-models.ini, as exposed by /v1/models). Setup and every run
    // start validate it against the live /v1/models list and fail loudly if absent — the
    // same "unspawnable command fails at setup, not at first verify" law applied to
    // weights (Task 12.2).
    "default": "qwen3.6-27b",
    // Per-role overrides. Base build: MUST be empty. A non-empty roles map is accepted by
    // the schema (so multi-model experiments need no code change) but logs a warning at
    // init and is out of the supported/tested surface — swap batching, per-model wave
    // wall-clock, and the POC's arm design all assume it is empty (§10 stretch).
    "roles": {}
  },
  "ponytail": "full",                   // "lite" | "full" | "ultra" (§6.3)
  "retention": {
    // .conductor/ lives inside the user's repo and is invisible to git, which means
    // nothing ever notices it growing. At `trace` the journal contains full sub-session
    // prompts and outputs — i.e. large slices of the repo, once per lens, per round, per
    // item. Pruning runs at run creation, never mid-run.
    "keepRuns": 20,                     // archived run dirs retained, newest first
    "maxRunDirBytes": 268435456,        // 256 MiB: journal rotates to journal.1.jsonl.gz
    "pruneOnRunCreate": true
  },
  "logging": { "level": "info", "components": {} }   // §7
}
```

On first run in a repo, conductor detects what it can (test command from package.json /
CMakeLists+ctest / pyproject / Cargo.toml / go.mod), asks the user the two questions it
may not default (git access mode; the proposed `behavioralPaths`, confirmed or corrected),
and writes this file. Setup then proves every assumption it just recorded, because each
one is otherwise discovered mid-run as a confusing failure:

| Checked at setup | Failure mode it prevents |
|---|---|
| every configured command is smoke-spawned | an unspawnable test command surfaces at first verify, mid-item |
| `models.default` appears in the live `/v1/models` | every sub-session dispatch fails after decomposition, retried twice each, then `env` |
| the served model answers one tiny schema-constrained request | GBNF/`response_format` unsupported for this model — discovered before the pipeline depends on it |
| observed concurrent slot count ≥ `parallel.maxReaders` (probe: N concurrent trivial completions, measure whether they overlap) | the entire read fan-out silently serializes upstream and every parallelism claim in §4 is false |
| the repo is a git repo (`isRepo`) | publish, freshness, worktrees, and `.git/info/exclude` all assume one — see §3.9 for the non-repo path |

A failed check is a setup failure with a named remedy, not a warning.

### 2.2 Router config — `.data/configs/conductor-router.json` (this repo; generated by
serve.py, hand-editable)

```jsonc
{
  "version": 1,
  "listen": { "host": "127.0.0.1", "port": 8088 },
  "upstream": { "host": "127.0.0.1", "port": 8080 },
  "admission": {
    "maxInflightPerModel": 4,          // MUST be ≤ llama-server's slot count (--parallel);
                                       //   serve.py generates both from one number
    "maxQueued": 64,
    "queueTimeoutMs": 600000           // < parallel.subSessionTimeoutMs (§2.1) so a queue
                                       //   timeout is reported as itself
  },
  // No batching block: under G13 there is one model, so there are no swaps to batch.
  // Swap batching + per-role model routing are §10 stretch and share a config key when
  // they land ("batching": {swapWindowMs, maxBatchHoldMs}).
  "priorities": { "interactive": 0, "review": 1, "batch": 2 },   // lower = first
  "affinity": { "header": "X-Conductor-Group", "contiguousDequeue": true },
  "schema": {
    // OBSERVE, never enforce (G5). A tagged request missing its schema field is journaled,
    // metered (`schemaMissing: true`), and PROXIED UNCHANGED — the router must never turn
    // a request the direct path would have served into a 400, or "--no-router runs the
    // identical process" becomes false and layer 2 stops being fail-soft.
    "observeHeader": "X-Conductor-Schema",
    "validateResponses": true,         // non-stream only; result recorded, body untouched
    "rejectOnMissing": false           // MUST be false in the base build; present so the
                                       //   stricter posture is a config change, not a fork
  },
  "metrics": { "ledgerPath": ".data/router/metrics.jsonl" },
  "logging": { "level": "info" }
}
```

### 2.3 `runs/<runId>/run.json`

```jsonc
{
  "runId": "r-20260807-a1b2",
  "createdIso": "2026-08-07T12:00:00Z",
  "prompt": "<the user's prompt, verbatim>",
  "sessionID": "<orchestrator session id>",
  "state": "EXECUTING",                // §3.1 vocabulary, nothing else
  "classification": {                  // INTAKE output (§3.2)
    "kind": "work",                    // "question" | "trivial" | "work"
    "rationale": "…",
    "check": { "agreed": true, "note": "" }   // the skeptic cross-check, embedded
  },
  "startHead": "3f9a1c7",              // HEAD at run creation; branch discipline (§2.1 git)
  "startBranch": "main",
  "startDirty": ["src/parser/wip.ts"], // paths dirty BEFORE conductor touched anything.
                                       //   Publish never stages these (§3.3) — without
                                       //   this list, `git add <fileScope glob>` sweeps
                                       //   the user's unrelated WIP into a conductor
                                       //   commit whose message and red-proof describe
                                       //   something else entirely.
  "excludedStaleRed": ["tests/i2.test.ts"],  // §2.11 entries active for this run,
                                       //   disclosed at run start and in report.md
  "planReviewRounds": 2,
  "stop": null,                        // terminal only: {kind, reasonDisplay, tsMs} (§2.9)
  "counters": { "idleRePrompts": 0,
                "futileRePrompts": 0,  // consecutive idle re-prompts whose resulting
                                       //   run-state signature was unchanged; the noop
                                       //   stop fires when this reaches 3 (§2.9, §3.7)
                "overridesUsed": 0 }   // §2.1 workflow.maxOverridesPerRun budget
}
```

**Terminality (one definition, referenced everywhere).** A run is TERMINAL iff
`state ∈ {ANSWERED, REPORTED, TRIVIAL_DONE}` **or** `stop !== null`. `core/stops.ts`
exports `isTerminal(run)` and it is the ONLY definition: the continuation engine
(§3.7), `legalTools` (§3.4 — a terminal run legalizes `conductor_status` and nothing
else), and run creation (§3.2 — a new prompt starts a new run iff the current one is
terminal) all call it. Without a single definition, "EXECUTING with a stop recorded"
is a state three subsystems each interpret differently.

### 2.4 `runs/<runId>/queue.json`

```jsonc
{
  "items": [
    {
      "id": "I1",
      "title": "…",
      "rationale": "…",
      "fileScope": ["src/parser/**"],   // DECLARED source write scope — the edit-scope
                                        //   gate and the wave scheduler both consume it
      "testScope": ["tests/parser/**"], // the item's test paths — the ONLY paths the
                                        //   test-writer may edit; conductor_decompose
                                        //   REJECTS an item with an empty testScope
      "acceptance": ["parser rejects empty input with ParseError"],
      "behavioral": true,              // TRUE ⇒ the full TDD machine (PENDING→RED→…).
                                       //   FALSE ⇒ RED/TEST_VETTED are skipped
                                       //   (PENDING→GREEN→VALIDATED→REVIEWED→PUBLISHED)
                                       //   for changes that cannot fail an assertion:
                                       //   comments, docs, formatting, pure renames.
                                       //   MECHANICALLY GATED: the decompose handler
                                       //   REJECTS behavioral:false unless every
                                       //   fileScope glob is disjoint from
                                       //   verify.behavioralPaths (§2.1). testScope MAY
                                       //   be empty iff behavioral is false, and only
                                       //   then. This is the one place the TDD law bends,
                                       //   and it bends by path arithmetic the model
                                       //   cannot argue with — not by its own say-so.
      "dependsOn": [],                 // item ids; must form a DAG
      "ponytail": {                    // minimality check, recorded at decompose time
        "necessary": "why this must exist",
        "reuse": "what existing code was checked and why it doesn't cover this",
        "ladderRung": "minimal-code"   // "skip" | "reuse" | "stdlib" | "platform"
                                       //   | "dependency" | "one-liner" | "minimal-code"
      }
    }
  ]
}
```

A decomposition that returns one item covering everything, or items without disjoint-able
file scopes where the change plainly separates, is itself a plan-review finding class
(§3.2). The queue is immutable after PLAN_REVIEWED except through
`conductor_queue_amend`, which records a decision and re-runs affected-item scheduling.

### 2.5 `runs/<runId>/items/<itemId>.json`

```jsonc
{
  "id": "I1",
  "state": "GREEN",                    // §3.3 vocabulary — the FSM position, nothing else
  "assignee": null,                    // sub-session id while dispatched
  "worktree": null,                    // path when parallel.writes = "worktrees"
  "attempts": { "green": 1, "reviewRounds": 0, "vetRounds": 0,
                "testRepairs": 0, "debugFixes": 0, "overridesUsed": 0 },
  // Dispositions. These are ANNOTATIONS, not FSM states (§14 refuted making them states,
  // and that decision stands) — but an annotation with no field to live in is a concept
  // the code cannot represent. Every one of these is read by shouldTerminate (§2.9),
  // conductor_report's completeness check (§3.2), and legalTools (§3.4).
  "blocked": null,                     // | {reason, sinceMs, questionId?, stage}
                                       //   set by: test-repair exhaustion, implementer
                                       //   BLOCKED escalation, plan-review round cap,
                                       //   conductor_surface {blocksItems}. Cleared by
                                       //   conductor_unblock (answer supplied) or
                                       //   conductor_queue_amend.
  "deferred": null,                    // | {reason, decisionId} — an explicit "not this
                                       //   run" disposition that report accepts as final
  "debugging": null,                   // | {sinceMs, hypothesis} while the §6 debug
                                       //   protocol is active; distinguishes "3 fixes
                                       //   tried, resolved" from "currently stuck"
  "evidence": {                        // ledger-qualified refs — evidence.jsonl and
    "red":   { "ledger": "evidence", "seq": 12 },   // journal.jsonl carry INDEPENDENT
    "green": { "ledger": "evidence", "seq": 18 },   // seq counters; a bare {seq} does not
    "validated": { "ledger": "evidence", "seq": 25 } //  say which file to open
  },
  "taint": [],                         // override records that touched this item (§3.6)
  "inlineClaim": null                  // {reason, decisionId} when worked inline (§3.6)
}
```

An item is **open** iff `state !== "PUBLISHED" && blocked === null && deferred === null`.
`itemsSummary` (§2.9, Task 1.3) is `{open, blocked, deferred, surfacedQuestions}` computed
from these fields plus `questions.jsonl` — every input it needs now exists on disk.

### 2.6 `runs/<runId>/evidence.jsonl` — writer: `adapter/evidence.ts` ONLY

```jsonc
{ "seq": 12, "ts": 1754560000000, "kind": "red", "itemId": "I1",
  "command": ["node", "--test", "tests/parser.test.ts"],
  "exitCode": 1, "failureExcerpt": "AssertionError: expected ParseError… (≤300 chars)",
  "failureClass": "assertion",         // §2.6.1 vocabulary
  "targeted": true }                   // false ⇒ full-scope fallback ran (§2.1)
{ "seq": 18, "ts": 1754560200000, "kind": "green", "itemId": "I1",
  "command": ["node", "--test", "tests/parser.test.ts"], "exitCode": 0 }
{ "seq": 25, "ts": 1754560400000, "kind": "verify", "itemId": "I1",
  "startedMs": 1754560300000,          // START stamp, taken after quarantine, before
                                       //   the first scope ran
  "head": "3f9a1c7", "branch": "main", // the tree this verify actually judged
  "tree": "main",                      // "main" | "<itemId>" (worktree)
  "excluded": ["tests/i2.test.ts"],    // foreign red set quarantined for this run
  "green": true,
  "scopes": { "unit": { "green": true, "exitCode": 0, "durationMs": 41876 } } }
```

#### 2.6.1 Failure classes (closed vocabulary; `core/freshness.ts` + Task 6.1)

| `failureClass` | Means | Legal red? |
|---|---|---|
| `assertion` | the test ran, evaluated the behavior, and the behavior was wrong | **yes** |
| `missing-subject` | the test could not resolve the module/symbol it is testing, AND the unresolved path resolves inside **this item's declared `fileScope`** | **yes** |
| `error` | anything else that prevented evaluation: syntax error in the test, an unresolved import pointing OUTSIDE the item's fileScope, collection/build failure elsewhere | no |

**Why `missing-subject` exists, and why it is not a loophole.** The first failing test of
any new module cannot possibly assert-fail: it fails to import a file that does not exist
yet (`Cannot find module`, `ModuleNotFoundError`, an unresolved symbol at compile time).
Classifying that as an illegal red makes greenfield TDD — the most common shape of work —
structurally impossible: the test-writer is scope-confined to `testScope` and so cannot
create the missing module, and the item dies after `testRepairAttempts`. The original rule
("an import error is not a red") is right about the case it was written for — a test
broken by unrelated breakage proves nothing — and the resolution path is what separates
the two cases. `missing-subject` requires the unresolved thing to be *the subject this
item is contracted to build*; a test that fails to import `lodash`, or a module belonging
to another item, is still `error`. Task 6.1 encodes the resolver rule and its
counterexamples.

Freshness rule (core/freshness.ts, pure): a `verify` record is fresh for a commit iff
**both**

1. `startedMs >= max(worktree mtimes of the staged behavioral files that exist,
   index mtime when any staged behavioral entry is a deletion/rename)`, and
2. `record.head === currentHead` — the verify judged the tree at this commit.

Any edit after the run STARTED was never verified; and a green produced on one branch is
not a green on another. Condition 2 exists because a `git switch` between validate and
publish changes the tree without necessarily changing any staged file's mtime, so
condition 1 alone passes and the evidence record silently describes a different tree. The
reader is `conductor_publish`; the writer is `evidence.ts`; Task 6.x tests exercise both
(G6), including the branch-switch case.

### 2.7 `runs/<runId>/decisions.jsonl`

```jsonc
{ "id": "D-0007", "tsIso": "2026-08-07T12:00:00Z",
  "question": "HTTP client for router health: cpp-httplib client vs raw sockets?",
  "options": [
    { "name": "cpp-httplib", "score": { "capability": 2, "testability": 2,
        "movingParts": 2, "validationEarliness": 1, "singleSource": 2 } },
    { "name": "raw sockets", "score": { "capability": 1, "testability": 1,
        "movingParts": 0, "validationEarliness": 1, "singleSource": 2 } }
  ],
  "choice": "cpp-httplib",
  "why": "strict superset on scored criteria; already a dependency",
  "kind": "derived",                   // "derived" | "human" — human ⇒ was asked (§6.2)
  "appliedWhere": "src/router/router-client note" }
```

Every non-trivial judgment call gets a record with ≥2 real options and scores on the
§6.2 criteria (the brainstorming skill's "propose 2-3 approaches with trade-offs and a
recommendation", made mechanical). The human reviews the ledger asynchronously; an
overrule becomes a correcting entry. Options may omit numeric scores only for `kind:
"human"` questions (taste has no objective score).

### 2.8 `runs/<runId>/anomalies.jsonl`

```jsonc
{ "ts": 1754560000000, "kind": "override", "itemId": "I3",
  "gate": "phase-order", "reason": "<model-supplied>", "grantedAction": "conductor_mark_green" }
{ "ts": 1754560100000, "kind": "gate-crash", "gate": "git-policy",
  "disposition": "denied", "error": "…" }
{ "ts": 1754560200000, "kind": "disengage", "detail": "3 futile idle re-prompts; stop noop recorded" }
```

Written BEFORE the triggering handler returns (write-ahead), so a killed process still
leaves its trace.

### 2.9 Stop-kind taxonomy (closed vocabulary)

| kind | Meaning |
|---|---|
| `done` | report written; every item PUBLISHED or explicitly deferred with reason |
| `noop` | 3 consecutive futile idle re-prompts (run-state signature unchanged, §3.7 — the single wedge detector; the continuation engine records it with a `disengage` anomaly and stops re-prompting) |
| `blocked` | every remaining item blocked; surfaced questions pending |
| `surfaced` | only human-territory questions remain; nothing actionable |
| `env` | tooling broken (verify cannot run, server down, fan-out env-failure, override budget exhausted) |
| `interrupt` | human aborted / halt file present |

A run may only leave EXECUTING via `conductor_report` (→ `done`) or a recorded stop of
one of these kinds. `core/stops.ts` exports the vocabulary, `isTerminal(run)` (§2.3), and
`shouldTerminate(run, counters, itemsSummary, config)` (Task 1.3); the continuation engine
and the report tool are its only consumers.

**Every stop writes a report (normative).** Recording a stop is not a terminal action on
its own: the recorder — the continuation engine for `noop`/`interrupt`, the fan-out engine
for `env`, the report tool for the rest — MUST invoke the report writer in
**stop-report** mode before the run goes quiet. A stop-report is `report.md` with the stop
kind and its reason as the headline, the per-item disposition table, the outstanding
blocked set and surfaced questions, any abandoned red tests newly added to the §2.11
registry, and whatever metrics exist. It does NOT re-run the full verify (a wedged or
interrupted run has no claim to prove and may be mid-edit).

This closes the worst failure shape in the original design: `conductor_report` refuses
while an item is unpublished-and-unblocked → the continuation engine re-prompts → nothing
changes → `noop` → **and the run ends with no human-readable artifact at all**, which is
precisely the run the human most needs to read. The runs that end well were never the
problem.

### 2.10 Review schemas (fan-out structured outputs)

```jsonc
// FINDINGS — what every reviewer/critic session must return
{ "findings": [
    { "id": "F1", "severity": "major",     // "major" | "minor" | "nit"
      "lens": "correctness",
      "claim": "…one-sentence defect statement…",
      "evidence": "file:line + why (what breaks, when)",
      "suggestedFix": "…" } ] }

// VERDICT — what every skeptic session must return for one finding
{ "findingId": "F1", "upheld": false,
  "reasoning": "…the claim mis-reads the guard on line 42; the case is handled…" }

// CLASSIFICATION — INTAKE output
{ "kind": "work", "rationale": "…", "confidence": "high",
  "trivialItem": null }
// trivialItem: REQUIRED (non-null) when kind = "trivial", null otherwise. It is a
// COMPLETE §2.4 queue item minus `id` and `dependsOn` — title, rationale, fileScope,
// testScope, acceptance, behavioral, ponytail{necessary,reuse,ladderRung} — because the
// §3.2 trivial path synthesizes the run's only item directly from it and that item must
// satisfy the queue schema like any other. The earlier form (bare proposedFileScope /
// proposedTestScope) could not: the handler would have had to invent `acceptance` (which
// the TEST_VET lens "pins THIS item's acceptance" then checks against) and the whole
// ponytail minimality record (whose entire purpose is showing that reuse was actually
// considered) — i.e. fabricate the evidence, on every trivial run.
// The handler still re-checks: fileScope count ≤ trivialMaxFiles, non-empty testScope
// unless behavioral is false, and the behavioral/behavioralPaths arithmetic (§2.4).
// Any violation escalates to "work" — the classifier proposes, the handler disposes.

// CLASSIFICATION_CHECK — the skeptic cross-check of a classification (§3.2)
{ "agreed": true, "correctedKind": null, "note": "…" }
// correctedKind: null when agreed; otherwise "question"|"trivial"|"work". Disagreement
// escalates to the STRICTER of the two kinds (work > trivial > question) — a schema, not
// prose, because this dispatch is the only one that was previously unconstrained.

// DECOMPOSITION — items per §2.4 (the queue schema IS the format)

// TEST_VET — per-lens critic output
{ "verdictsByCriterion": {
    "observableBehavior": { "pass": true,  "note": "" },
    "wouldCatchWrongImpl": { "pass": false, "note": "tautological: asserts the mock" },
    "rightLevel": { "pass": true, "note": "" },
    "pinsAcceptance": { "pass": true, "note": "" },
    "antiPatterns": { "pass": true, "note": "" } },
  "mustFix": ["…"] }

// IMPLEMENTER RESULT — what an implementer sub-session returns
{ "status": "DONE",                    // "DONE" | "DONE_WITH_CONCERNS"
                                       //   | "NEEDS_CONTEXT" | "BLOCKED"
  "summary": "…", "concerns": [], "neededContext": null, "blockReason": null }
```

Schema conformance is checked in two places with two different jobs: the **fan-out engine
validates on receipt and is the enforcement** — it re-prompts with the validation error
appended, up to 2 retries, then marks the sub-task `env`-failed; **llama-router observes
and records** (§4.4), producing an independent conformance dataset for the POC without
ever changing a request's outcome (G5).

### 2.11 Question ledger and the workspace stale-red registry

**`runs/<runId>/questions.jsonl`** — writer: `adapter/questions.ts`; readers:
`conductor_report`, `shouldTerminate`, `legalTools`, the injection state block.

```jsonc
{ "id": "Q-0001", "tsMs": 1754560000000, "runId": "r-…",
  "question": "Should unknown config keys fail the whole load, or collect and report all?",
  "askedBy": { "role": "planner", "sessionID": "ses_…" },
  "humanTerritory": true,              // core/decide.ts isHumanTerritory verdict (§6.2)
  "origin": "plan-review-cap",         // "surface-tool" | "plan-review-cap"
                                       //   | "debug-architecture" | "implementer-blocked"
                                       //   | "review-round-cap" | "scope-conflict"
  "blocksItems": ["I2"],               // items set blocked:{questionId} by this question
  "answeredIso": null, "answer": null }
```

A question is **open** until answered. `conductor_answer {questionId, answer}` (§3.4)
records the answer, unblocks every item that named it, and journals — that is how a human
resumes a `blocked`/`surfaced` run without hand-editing state.

**`.conductor/state/stale-red.json`** — workspace-level, survives runs.

```jsonc
{ "version": 1,
  "entries": [
    { "path": "tests/i2.test.ts", "itemId": "I2", "runId": "r-20260807-a1b2",
      "sinceMs": 1754560000000, "reason": "item blocked at RED (test-repair exhausted)" }
  ] }
```

Written when a run terminates with any item below GREEN whose test files exist; entries
are removed when the file is deleted, when a later run drives that test green, or by
`conductor_forget_stale {path}`. Every quarantine computation unions this registry with
the current run's sub-GREEN testScopes (§4.2), and every run start and every report
discloses the active entries.

**Why a workspace-level registry is required.** Runs are per-prompt and ephemeral; the
working tree is not. A blocked item leaves a deliberately-red test file behind. The next
prompt creates a new run whose queue knows nothing about it, so the first
`conductor_validate` of run 2 runs run 1's red test, goes red, enters the DEBUG protocol,
and spends `debugFixCap` fix attempts hunting a "bug" that is a leftover — then escalates
an architecture question about code it never wrote. Excluding those files silently would
be its own hazard, which is why every exclusion is disclosed at run start and in the
report rather than quietly applied.

---

## §3. The workflow state machines

### 3.1 Run FSM (per prompt)

```
INTAKE ──► DECOMPOSED ──► PLANNED ──► PLAN_REVIEWED ──► EXECUTING ──► REPORTED
   │                                         │              │
   │            (the majors⇒revise⇒re-review loop is        └──► TRIVIAL_DONE
   │             INTERNAL to the conductor_plan_review        (trivial runs only:
   │             handler — the run state never regresses;      report-lite, §3.2)
   │             PLAN_REVIEWED is reached only on a clean
   │             round or at planReviewMaxRounds)
   ├──► ANSWERED   (classification: question — no pipeline)
   └──► EXECUTING  (classification: trivial — enters EXECUTING directly, flagged
                    trivial, with ONE synthesized item; DECOMPOSED/PLANNED/
                    PLAN_REVIEWED are skipped)
```

Transitions happen ONLY inside `conductor_*` tool handlers (§3.4). `gates-phase.ts`
holds the legality table `legalTools(run, items, repoConfigured) → {legal: Map<toolName,
argsHint>, recommended: {tool, args} | null, why: string}`; the phase-order gate denies
every conductor tool not in `legal`, with a reason naming what IS legal and what is
recommended. The injected system prompt (§6.4) states the same — the gate is the
enforcement, the injection is the courtesy (G9).

**On "the one legal next tool".** Earlier drafts of this plan asserted that exactly one
tool is legal at any moment, and three subsystems were specified against that claim.
It is false whenever the run has more than one item in flight (`conductor_mark_green
{I1}` and `conductor_submit_test {I2}` are simultaneously legal), and it was never true
of `conductor_status`/`decide`/`surface`, which are legal in every non-terminal state.
The honest contract is a **legal set plus a single recommended action**: the recommended
action is deterministic (§4.2's wave order — lowest DAG depth, then item id, then the
item's own stage order), so the injection and the continuation engine still speak with
one voice, and the model still gets one unambiguous instruction. `legalTools` is the
single source for all three consumers (gate, injection, continuation), which is what
keeps them from disagreeing.

### 3.2 Run stages, normatively

**INTAKE.** Run creation: the `chat.message` hook, on a user prompt arriving while no
run is live (`isTerminal(currentRun)` or none — §2.3's single definition), creates
`runs/<runId>/run.json` (state INTAKE), points `current-run.json` at it, and captures the
run's starting facts in one place because four later rules read them: `startHead`,
`startBranch`, `startDirty` (the tree's already-dirty paths — H4's defence), and
`excludedStaleRed` (the §2.11 registry entries now in force, which the handler also
reports to the user in its first response: *"3 test files from earlier runs are still red
and are excluded from verification"*). A prompt arriving DURING a live run is routed into
it as orchestrator context (journaled as `user.midrun-prompt`) and never starts a new run.

Then (the orchestrator's first legal tool is `conductor_classify`): the handler dispatches
a `mechanical`-role sub-session with the CLASSIFICATION schema, then ONE `skeptic`-role
check with the CLASSIFICATION_CHECK schema (cheap; prevents "everything is trivial"
drift). Disagreement escalates to the stricter kind. Then:

- `question` ⇒ the orchestrator answers; state ANSWERED, run archived. If answering turns
  out to require a change, the orchestrator says so and the user re-prompts — a question
  run has no items, so there is nothing an inline claim could scope to, and silently
  mutating the repo during a "question" is exactly the drift the classification exists to
  prevent.
- `trivial` ⇒ the handler synthesizes the run's single item from `classification.trivialItem`
  (§2.10 — a complete §2.4 item, so the synthesized queue satisfies the same schema as any
  decomposed one), re-checks `trivialMaxFiles`, testScope non-emptiness, and the
  behavioral/`behavioralPaths` arithmetic, escalating to `work` on any violation. The run
  enters EXECUTING flagged trivial: DECOMPOSED/PLANNED/PLAN_REVIEWED are skipped and item
  review runs with MERGED lenses (§3.3's trivial rule) — but the item FSM is NEVER skipped;
  trivial compresses fan-out width, not process.
- `work` ⇒ the run stays in INTAKE with the classification recorded; `conductor_decompose`
  is the recommended and only pipeline-advancing legal tool.

**DECOMPOSED.** `conductor_decompose` dispatches the `planner` role with the queue schema
and doctrine pack `decompose.md` (ponytail ladder at configured intensity: every item
carries its ladder rung + reuse note, §2.4). Handler validates, and every one of these is
a rejection with a named reason, not a warning:

| Check | Rejects |
|---|---|
| DAG acyclicity | a cycle in `dependsOn` |
| non-empty `fileScope` per item | an item that writes nothing |
| non-empty `testScope` **iff `behavioral`** | a behavioral item with no test paths; a non-behavioral item that claims test paths it will never write |
| `behavioral: false` ⇒ `fileScope ∩ behavioralPaths = ∅` | the TDD-skip loophole: an item cannot declare itself untestable while editing production code (§2.4) |
| acceptance criteria phrased as observable checks | "make it better" |
| ponytail rung + reuse note under `full` | a `minimal-code` rung with no evidence reuse was considered (§6.3) |
| item size (scope > ~5 files or > 1 acceptance cluster) | one bounded re-split re-prompt round, then rejection |

**PLANNED.** `conductor_plan` dispatches the `planner` with `plan.md` doctrine
(writing-plans rules: exact paths, bite-sized steps, complete code for non-obvious steps,
no placeholders — "TBD", "add error handling", "similar to task N" are plan defects by
name) plus the ponytail guardrails (never lazy about security/validation/data-loss).
Output is `plan.md`: per-item test strategy, design alternatives considered (≥2 for every
consequential fork, recorded into decisions.jsonl via the handler), risks, and the
execution order proposal.

**PLAN_REVIEWED.** `conductor_plan_review` fans out `planReviewers` fresh sub-sessions
(role `reviewer`), each with ONE lens over the whole plan+queue: (a) correctness/design
soundness, (b) completeness vs the user's prompt, (c) decomposition quality (item size,
scope disjointness, DAG honesty), (d) minimality (ponytail: unrequested abstractions,
skipped reuse), plus placeholder scan folded into (b). Findings → each `major` gets
`skepticsPerFinding` refuters; surviving majors ⇒ handler re-prompts the planner with the
findings, plan revised, round++. Exit when a round yields zero surviving majors, or
`planReviewMaxRounds` reached — then each surviving major is written to
`questions.jsonl` (§2.11, `origin: "plan-review-cap"`) and every item its
`blocksItems` names is set `blocked: {questionId, reason, stage:"plan-review"}`. The run
proceeds on the remaining items. This is the concrete meaning of "the rest block on the
human": a field on the item, a row in a ledger, and an unblock path
(`conductor_answer`), not an English sentence.

**EXECUTING.** `conductor_dispatch_wave` (§3.4, §4.2) drives the wave. It is the run's
work engine, not a marker: it computes the wave, creates worktrees under
`parallel.writes:"worktrees"`, and runs each wave member's item pipeline concurrently
through the fan-out engine, returning when the wave is drained or blocked. Per-item tools
(`conductor_submit_test` … `conductor_publish`) remain first-class and orchestrator-callable
for single-item work, inline claims, and recovery — they are the same handlers the driver
calls. See §4.2 for why the driver, and not the orchestrator model, owns cross-item
concurrency.

**REPORTED.** `conductor_report` requires every item to be PUBLISHED, `blocked`, or
`deferred` — all three now being fields it can actually read (§2.5). The handler re-runs
the full verify itself (fresh, start-stamped — the verification-before-completion law made
mechanical), then writes `report.md`: what shipped (per item: red proof, review rounds,
taint), what was blocked/deferred and why, open surfaced questions with their ids, the
decision-ledger summary, any test files newly added to the §2.11 stale-red registry, the
exclusions the closing verify applied, and metrics (tokens, wall-clock, parallelism
achieved — via Task 7.2's fail-soft router client when the router is up). Then records
stop `done`. The closing verify applies the §4.2 foreign-red-set exclusion (every
non-PUBLISHED item below GREEN, plus the workspace registry), because a report is legal
with blocked items whose red tests linger. For trivial runs the same handler runs
report-lite and advances EXECUTING→TRIVIAL_DONE instead of REPORTED.

The report writer has three modes, one implementation: **full** (above), **lite**
(trivial runs), and **stop-report** (§2.9 — any non-`done` terminal stop; same content,
no closing verify, stop kind as the headline). Every terminal path in the system reaches
one of the three; no terminal path writes nothing.

### 3.3 Item FSM

```
behavioral: true
  PENDING ─► RED ─► TEST_VETTED ─► GREEN ─► VALIDATED ─► REVIEWED ─► PUBLISHED
                (test exists,   (impl     (full        (surviving
                 failed for      passes    verify       findings = 0)
                 the RIGHT       its       green,
                 reason,         test)     fresh)
                 critics
                 passed)

behavioral: false        (§2.4 — fileScope proven disjoint from behavioralPaths)
  PENDING ──────────────► GREEN ─► VALIDATED ─► REVIEWED ─► PUBLISHED
```

`blocked`, `deferred`, and `debugging` are annotations on the item (§2.5), not states:
any state may carry them. A verify failure that resists `debugFixCap` fixes sets
`debugging` and applies the systematic-debugging protocol (§6.2); if architecture is
questioned it writes a question (§2.11, `origin:"debug-architecture"`) and sets
`blocked`.

Normative details, each enforced by the named mechanism:

- **PENDING→RED** (`conductor_submit_test`; behavioral items only): the test-writer
  sub-session (role `testWriter`, doctrine `tdd.md`) writes ONLY test files (the
  edit-scope gate restricts it to the item's `testScope`, §2.4). The handler — not the
  model — runs the test via `evidence.ts` and requires exit≠0 with
  `failureClass ∈ {"assertion", "missing-subject"}` (§2.6.1): the behavior was evaluated
  and was wrong, or the subject this item is contracted to build does not exist yet.
  Class `error` — a syntax error in the test, a failure to resolve something OUTSIDE the
  item's fileScope, a collection failure elsewhere — is NOT red; the handler returns the
  failure to the writer for repair, bounded at `testRepairAttempts`, then sets
  `blocked: {stage:"RED", reason}` and writes a question. A test that PASSES immediately
  is rejected: either the behavior already exists (recorded as a decision — the item may
  be unnecessary, ponytail rung "skip") or the test is wrong.
- **PENDING→GREEN** (`conductor_mark_green`; **non-behavioral items only**): no test
  exists and none is owed, so the implementer works directly under the same edit-scope
  gate, and the handler's evidence is the full verify at VALIDATED rather than an item
  test. Everything downstream — validate, the full mandatory review lens set, publish —
  is unchanged. The one weakened obligation (a proven red) is weakened only where a red
  is not constructible, and only where §2.4's path arithmetic proves it.
- **RED→TEST_VETTED** (`conductor_vet_test`): `vetCritics` parallel critics (role
  `reviewer`, doctrine `test-vet.md`), fresh contexts, given the item spec + the test
  diff + the captured red output — NOT the implementation (none exists; that is the
  point: critics can't be anchored by code that already passes). Lenses per §2.10
  TEST_VET: asserts observable behavior not internals; would fail for a subtly-wrong
  implementation (tautology/mock-testing check — the testing-anti-patterns iron laws);
  right level (unit vs integration); pins THIS item's acceptance; anti-pattern scan
  (mock-behavior assertions, test-only production methods, incomplete mocks).
  `mustFix` items → back to the test-writer, re-vet; bounded by `vetMaxRounds`.
- **TEST_VETTED→GREEN** (`conductor_mark_green`): the implementer sub-session (role
  `implementer`, doctrine `tdd.md` minimal-code section) may now edit the item's
  fileScope. The handler re-runs the item test itself; exit 0 required. The implementer
  never runs "done" by assertion — the tool call fails until the test actually passes.
  Implementer statuses (`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`) are handled per
  the subagent-driven-development protocol: concerns are read and triaged (correctness
  concerns block; observations are noted); missing context is supplied and re-dispatched;
  BLOCKED escalates in order: more context → stronger model → item re-split via
  `conductor_queue_amend` (recorded decision) → surfaced to the human.
- **GREEN→VALIDATED** (`conductor_validate`): `evidence.ts` quarantines the foreign red
  set (§4.2), start-stamps, records HEAD, and runs the full required scopes (build first
  where configured; a failed build never runs tests). While the verify is in flight the
  freeze gate denies **every** edit in that tree — production files and test files alike
  (§3.5) — and the fan-out engine will not dispatch a write-capable sub-session into a
  frozen tree at all, so a denial is not how a test-writer discovers the freeze. A second
  `conductor_validate` against a tree with a live marker is DENIED naming the running
  verify (two verifies in one tree produce two records that each describe a tree the
  other was mutating). Failure drops to the DEBUG protocol: doctrine `debug.md` is
  injected, `debugging` is set, the four-phase protocol applies (root cause before fix;
  one hypothesis at a time; `debugFixCap` failed fixes ⇒ architecture question written
  and the item blocked, per systematic-debugging's 3-fix rule).
- **VALIDATED→REVIEWED** (`conductor_item_review`): fresh reviewers over the item's
  diff + spec + test, one lens each. The lens set: **spec/contract** (spec compliance —
  missing requirements, unrequested extras — plus API/contract soundness),
  **correctness**, **guardrail** (security, trust-boundary validation, data-loss — the
  ponytail never-lazy list), **test-adequacy** (does the test still honestly pin the
  change now that the impl exists), **minimality/simplification**, **perf**. The first
  five are MANDATORY and are never truncated by configuration; `itemReviewers` ≥ 6 adds
  perf. The general session-count rule (one statement, referenced by Task 9.5a and the
  trivial path): sessions = clamp(`itemReviewers`, 3, 6); at 6 each lens is its own
  session; below 6, lenses MERGE pairwise from the tail of the priority list into
  fewer sessions (5 ⇒ minimality+perf; 4 ⇒ +test-adequacy joins spec/contract; 3 ⇒
  spec+correctness, guardrail+minimality, test-adequacy+perf — the trivial-run
  composition); values < 3 clamp to 3 with a journal warning. Merging never drops a
  mandatory lens. All lenses dispatch in
  parallel (wall-clock), and adjudication preserves subagent-driven-development's
  two-stage ordering: surviving spec/contract findings are fixed FIRST, and quality-lens
  findings from a round with surviving spec findings are discarded and re-derived after
  the fix (judging not-yet-spec-compliant code is wasted judgment). Findings → skeptic
  refutation (K per finding; a finding survives iff upholds ≥ ⌈K/2⌉, ties uphold) →
  surviving findings are routed **by the paths their fix touches**, not by a fixed
  recipient (doctrine `receive-review.md`: verify the claim against the code before
  implementing the fix; a wrong finding is answered with reasoning, which the handler
  routes back through one more skeptic round rather than accepting silently):

  | Finding's fix touches | Dispatched to | Then |
  |---|---|---|
  | `fileScope` only | `implementer` | re-validate ⇒ re-review |
  | `testScope` (any test-adequacy finding, and any other finding whose `suggestedFix` names a test path) | `testWriter` | the changed test **re-enters the test discipline**: the handler re-runs it and requires it to still fail against a reverted-behavior probe where cheap, then re-vets it with `vetCritics` — before re-validate ⇒ re-review |
  | both | `testWriter` first, then `implementer` | as above, sequentially |

  The routing rule is not bookkeeping. The implementer is gated to `fileScope` (§3.5), so
  routing a test-adequacy finding to it produces a guaranteed deny, three wasted review
  rounds, and a surfaced question — on a MANDATORY lens whose findings are common
  precisely because the test was written before the implementation existed. And the
  re-vet requirement on the other side is what stops the cheapest possible "fix": a
  reviewer's finding being resolved by quietly weakening the assertion that produced it
  (§0.1(6)'s shortcut, arriving through the review door).

  Fix ⇒ re-validate ⇒ re-review (bounded `reviewMaxRounds`; cap ⇒ question written with
  the finding list, item `blocked`).
- **REVIEWED→PUBLISHED** (`conductor_publish`): under git.mode `commit`/
  `commit-and-push`, in this order:

  1. **Branch check** — `HEAD` must equal the verify record's `head` (§2.6). Mismatch ⇒
     deny naming both commits; the item re-validates. A green on another branch is not a
     green here, and a checkout can move the tree without touching a single staged file's
     mtime, so the mtime rule alone would pass.
  2. **Stage** — the item's `fileScope ∪ testScope` changes (the tests ARE the
     deliverable's proof — they ship in the same commit), **minus every path in
     `run.startDirty`**. Under `git.preexistingDirty: "refuse"` a dirty pre-existing path
     inside the item's scope denies publish and writes a question; under `"exclude"` it is
     skipped and listed in the report. Staging by raw glob is how a user's unrelated WIP
     ends up inside a conductor commit whose message and red-proof describe something
     else.
  3. **Format** — the §2.1 format rules; a crashing formatter denies publish and never
     overwrites the file.
  4. **Freshness** — re-check §2.6 (both conditions) against the staged set; stale ⇒ auto
     re-verify with the same foreign-red-set exclusion. **If that re-verify fails, the
     item drops to GREEN** (its own test still passes; the tree does not), `debugging` is
     set, and the DEBUG protocol applies — publish does not loop.
  5. **Commit** — generated message naming the item + red proof, built by a pure template
     in `core/` (not a model dispatch: a message is not a judgment, and a template cannot
     hallucinate a red proof), with NO attribution trailers (normative denylist,
     case-insensitive: `Co-Authored-By`, `Signed-off-by`, `Generated with`, and the 🤖
     emoji). Push only under `commit-and-push`.

  Under `read-only`: writes the prepared batch (file list, diff, suggested message,
  verify verdict) into the report instead. The commit is executed by the handler via
  `execFile` (G14 — never the Bun shell) — the model never runs `git commit` itself (the
  git-policy gate denies it; publishing IS the tool).

### 3.4 The `conductor_*` tool inventory

| Tool | Args (schema-typed) | Handler re-derives | Advances |
|---|---|---|---|
| `conductor_classify` | none | dispatches classifier + skeptic check | INTAKE→{ANSWERED, EXECUTING(trivial, one synthesized item)}; a `work` classification stays in INTAKE with `classification` recorded — `conductor_decompose` is then the recommended next tool (`legalTools` reads `run.classification`) |
| `conductor_decompose` | none | queue validity (DAG, scopes, sizes) | INTAKE(classified work)→DECOMPOSED |
| `conductor_plan` | none | plan.md written; decision records extracted | →PLANNED |
| `conductor_plan_review` | none | full fan-out, verdicts, revision loop | →PLAN_REVIEWED |
| `conductor_dispatch_wave` | none | computes the wave (§4.2) AND drives each member's item pipeline to completion or block, concurrently | PLAN_REVIEWED→EXECUTING on its first call; items advance through the item FSM |
| `conductor_submit_test` | {itemId} | runs test; asserts legal red (§2.6.1) | PENDING→RED (behavioral) |
| `conductor_vet_test` | {itemId} | critic fan-out + verdicts | RED→TEST_VETTED |
| `conductor_mark_green` | {itemId} | runs test; exit 0 (non-behavioral: no test run) | TEST_VETTED→GREEN, or PENDING→GREEN (non-behavioral) |
| `conductor_validate` | {itemId} | full verify, quarantined, start-stamped, HEAD-stamped | GREEN→VALIDATED |
| `conductor_item_review` | {itemId} | reviewer+skeptic fan-out, path-routed fix loop | VALIDATED→REVIEWED |
| `conductor_publish` | {itemId} | branch/stage/format/freshness/commit (§3.3) | REVIEWED→PUBLISHED |
| `conductor_report` | none | fresh full verify; report.md; stop `done` | EXECUTING→REPORTED (trivial runs: →TRIVIAL_DONE, report-lite) |
| `conductor_surface` | {question, blocksItems[], humanTerritory?} | writes `questions.jsonl` (§2.11), sets `blocked` on named items, continues rest | — |
| `conductor_answer` | {questionId, answer} | records the answer, clears `blocked` on every item that named it, journals | — (the human's resume path) |
| `conductor_defer` | {itemId, reason} | sets `deferred` + decision record; report accepts it as a final disposition | — |
| `conductor_decide` | {question, options[], choice, why} | appends decision record (§2.7) | — |
| `conductor_queue_amend` | {ops[]} | DAG/scope/behavioral re-validation + decision record | — |
| `conductor_inline_claim` | {itemId, reason} | records claim; scopes edit perm to item | — (§3.6) |
| `conductor_override` | {gate, reason} | budget check (§2.1) → anomaly + taint + one-shot bypass; over budget ⇒ `env` stop | — (§3.6) |
| `conductor_status` | none | prints run/item/question/ledger summary (read-only) | — (legal in EVERY state, terminal included) |
| `conductor_setup` | {reconfigure?} | first-run detection + questions + the §2.1 setup proofs (Task 12.2); legal while `.conductor/config.json` is absent, or with `reconfigure:true` (which requires no live run and journals a config diff) | — |
| `conductor_forget_stale` | {path} | removes a §2.11 stale-red entry after the human resolved it | — |

Every handler: (1) checks `gates-phase.ts` legality, (2) re-derives its evidence, (3)
writes state + journal atomically, (4) returns a compact result the orchestrator can
narrate. Handlers are the ONLY writers of run/item state (G6).

### 3.5 The tool.execute.before gates

Fired for every tool call in every conductor-managed session (orchestrator and
sub-sessions alike; the plugin sees `sessionID` and knows each session's role and item
assignment). Deny = `throw new Error(reason)` — the reason text names the violated rule
and the legal alternative. Decision logic is pure (`gates-*.ts`); the hook body only
parses input and gathers the snapshot. A crash inside gate evaluation while the tool is
`bash` (with any git segment) or an edit/write tool ⇒ DENY with the crash attached
(fail-closed, G5); crashes elsewhere log and allow.

**Session-registry gate** (first, before every other gate). Every gate below dispatches on
the session's registry entry (`sessionID → {role, itemId, tree}`), written by the fan-out
engine when it creates a session and by the `chat.message` hook for the orchestrator.
A call from a session with NO entry gets:

| Tool class | Disposition for an unregistered session |
|---|---|
| read-only (read, grep, glob, list, `bash` with no write shape and no git write) | allow (harmless, and a stray reader is not worth a confusing failure) |
| any edit/write/patch tool, any write-shaped bash, any git write | **deny**, naming conductor and the fact that this session has no item assignment |
| any `conductor_*` tool | **deny** (state is advanced only from registered sessions) |
| sub-agent spawning (opencode's `task`/agent tool) | **deny in every session, registered or not** |

The spawn deny is the load-bearing half. Without it an implementer can create a child
session that conductor never registered — no role, no item, no scope — and then have that
child perform exactly the writes the implementer is gated out of. A registry-based gate
whose registry can be bypassed by a tool call is not a gate. Conductor's own fan-out is
unaffected: it creates sessions through the SDK, not through a model-visible tool.

**Git policy** (bash commands; parsed-token matching over quote-aware split — NEVER
substring regex, which false-positives on paths and message words). **The default for any
`git` subcommand not named below is DENY**, with the reason naming the subcommand and
inviting `conductor_surface` if it is genuinely needed — an enumerated-allow, default-deny
posture, because the failure mode of a missing allow row (an annoyed model surfaces a
question) is trivial next to the failure mode of a missing deny row (`git apply` writes
arbitrary files, bypassing the edit-scope gate entirely).

| Command class | Disposition |
|---|---|
| **Read-only allow-list** (exhaustive): `status`, `log`, `diff`, `show`, `branch` (list forms), `ls-files`, `ls-tree`, `rev-parse`, `rev-list`, `cat-file`, `blame`, `shortlog`, `describe`, `grep`, `stash list`, `worktree list`, `remote -v`, `config --get`/`--list`, `reflog show` | allow |
| `git add`/`mv`/`rm`/`stash push` | deny from every model session (staging is `conductor_publish`'s job). *(The handler does not appear here: it runs git through `execFile` inside the plugin, which is not a tool call and never reaches this gate.)* |
| `git commit` in any spelling | deny — "publishing is `conductor_publish`" |
| `git push` | deny (handler-only, mode-gated) |
| `reset`/`rebase`/`filter-branch`/`filter-repo`/`clean`/`merge`/`cherry-pick`/`revert`/`am`/`apply`/`update-ref`/`symbolic-ref`/`sparse-checkout`/`submodule`/`bisect`/`gc`/`prune`/`reflog expire`/`notes`/`replace`/`fetch`/`pull`/`remote add|set-url|remove`/`tag -d`/`config --unset`/`config <k> <v>` | deny (destructive, history-manipulating, network-mutating, or a write path around the edit gate — human territory) |
| `git worktree add|remove|move|prune` | deny (worktrees are `adapter/worktrees.ts`'s, §4.3) |
| `checkout`/`switch`/`restore` worktree-discarding forms (`checkout --`, `checkout .`, multi-operand checkout, `restore` without `--staged`, `switch -C`, `checkout -B`) | deny |
| `branch -d/-D/-M`, `stash drop/clear`, force/`--delete`/`+refspec`/`:refspec` push | deny |
| branch movement (`switch <br>`, `checkout <br>`, `checkout -b`) | **deny while a run is non-terminal** under `git.branchPolicy:"pin"` (the default); allow under `"check-only"`, where publish's HEAD check (§3.3) catches the consequence instead |

The full deny matrix from the production harness is normative here, including the
false-positive guards: `git add src/config.ts` (path containing a verb word) parses as
`add`; `git log --grep config` allows; `git stash push -m drop` parses as `stash push`.
Task 5.1 encodes the complete matrix as its test table, the default-deny rule included.

**Edit-scope gate** (edit/write/patch tools + bash write-shaped commands — redirects,
`tee`, `sed -i`, `mv`/`cp` destinations):

- Orchestrator session: deny ALL source edits (G8) unless an active `inlineClaim`
  scopes the path.
- Implementer/test-writer sessions: allow only paths matching the assigned item's
  fileScope (test-writer: the item's `testScope` only); deny otherwise, naming the scope.
- Reviewer/skeptic/planner/mechanical sessions: deny all edits (they are readers).
- Everyone: deny edits to `.conductor/**` (state is handler-written only).
- **Freeze — everyone, every file, per tree.** While a verify marker is live for a tree,
  EVERY edit in that tree is denied: production files, test files, config, all of it. Two
  earlier readings of this rule ("source edits only" vs "all edits") were load-bearing in
  opposite directions — §4.2's quarantine safety argument requires that a foreign test
  file cannot be written while it is moved aside, which only holds under the strict
  reading. The strict reading is normative. Freeze is per tree (Task 6.1), so a worktree
  implementer is never frozen by another tree's validate.
- **Freeze is scheduling, not just denial.** The fan-out engine MUST NOT dispatch a
  write-capable sub-session (implementer, test-writer) into a tree with a live verify
  marker; it holds the job until the marker clears (§4.2). A gate denial mid-session is
  the backstop, not the mechanism — a sub-session that works for two minutes and then
  gets an exception on its first write has burned a dispatch and an attempt counter for
  nothing.
- Path normalization: every path is evaluated relative to the session's tree
  (`sessionTree`), and item scopes are tree-relative — so a worktree implementer's legal
  surface under `<stateHome>/…/worktrees/<runId>/<itemId>/src/…` normalizes to `src/…`,
  and the `.conductor/**` deny applies to the NORMALIZED path (the state area of the
  current tree), never to the worktree root prefix itself.

**Ask-gate** (two mechanisms, because opencode 1.18.10 declares a `permission.ask`
plugin hook in its types but does NOT dispatch it — verified and pinned in Task 0.2):
(a) statically, every conductor sub-agent definition carries `question: "ask"` in its
permission block (§5.3) — an agent-level hard deny would never raise a permission
request for the plugin to see, the same reasoning that made the orchestrator's edit
permission `"ask"` (§3.6); (b) the plugin subscribes to the `permission.asked` bus
event in its `event` hook and adjudicates via the SDK's
`client.permission.reply({requestID, reply})` — a sub-session ask is rejected and the
fan-out engine converts the blocked state into `NEEDS_CONTEXT` (orchestrator supplies
context) or a surfaced question. The orchestrator's own questions to the human are
allowed but counted and journaled with the §6.2 human-territory verdict; the decision
protocol defines what may be asked at all.

### 3.6 Inline claim and override (the deliberate hatches)

`conductor_inline_claim {itemId, reason}`: for work where dispatch is objectively more
expensive than doing (one-line fixes surfaced by review, mechanical renames). Grants the
orchestrator edit permission scoped to that item's fileScope until the item leaves its
current state. Mechanically: the orchestrator agent's `edit` permission is `"ask"`
(§5.3), and the plugin adjudicates each ask via the `permission.asked` event +
`permission.reply` — allow iff an active claim's fileScope covers the path; no claim, no
edit (G8 survives). Records a decision entry (`kind:"derived"`, the reason is the why). The
item FSM still applies in full — inline work goes through RED/vet/green/validate/review
like any other; the claim changes WHO edits, never WHAT is enforced.

`conductor_override {gate, reason}`: checks the budget (`maxOverridesPerItem`,
`maxOverridesPerRun` — §2.1), records an anomaly (§2.8), appends the override to the
item's `taint[]`, then disables the named gate for exactly ONE next action in the same
session. Taint is permanent for the run and listed prominently in report.md. There is
deliberately no bulk or timed override.

**Over budget is an `env` stop, not another override.** The bookkeeping cost of an
override — a reason string, a ledger line, a taint — is a cost the *human* pays at
reading time, not one the model feels during the run. An uncapped hatch that the deny
messages themselves advertise is a hatch a struggling local model will find and keep
using, and at that point every gate in this system is advisory while the report still
claims a process was followed. The budget is what makes "the trail is visible" into "the
trail is short enough to read, and the run stops before it gets longer". A gate that
needs overriding twice in one run is a bug in conductor, and stopping is the correct
response to it.

### 3.7 Continuation (the idle engine)

opencode has no pre-emptive turn-end refusal; continuation is re-entry:

1. `session.idle` fires for the orchestrator session while `run.state` is non-terminal
   and actionable work exists (items not PUBLISHED/blocked, or a legal next run
   transition) ⇒ `continuation.ts` re-prompts the orchestrator via
   `client.session.prompt` with a minimal message naming the exact next tool call
   (derived from `gates-phase.ts` — the same single source as the injection).
2. Each re-prompt increments `counters.idleRePrompts`. A re-prompt whose resulting
   run-state signature (hash of run.json + item states + dispositions) is identical to
   the previous one increments `futileRePrompts`; any state change resets it.
   `futileRePrompts` reaching 3 ⇒ the engine consults `shouldTerminate`, records stop
   `noop` plus a `disengage` anomaly, **writes the stop-report (§2.9)**, and stops
   re-prompting (a wedged loop must end loudly, not burn tokens forever). This counter is
   the ONLY wedge detector — §2.9's noop row and Task 1.3 encode the identical rule;
   there is no separate disengage threshold.
3. Halt file present ⇒ never re-prompt; record `interrupt` and write the stop-report.
4. The engine debounces (no re-prompt within 2s of the last; one in flight at a time)
   and never re-prompts a terminal run (`isTerminal`, §2.3 — which covers
   ANSWERED/TRIVIAL_DONE/REPORTED *and* any run with a recorded stop).

### 3.8 Liveness — proving conductor is actually loaded

Every gate in this design assumes the plugin is running. If opencode logs a plugin
initialization failure and continues (a missing doctrine pack, a syntax error, a bad
config path), the user gets a session that looks entirely normal and enforces nothing —
the worst possible failure mode for an enforcement system, and one that no gate can
detect because no gate exists. §6.4's "fail-closed at init" is only a real property if
somebody can observe it having failed.

So: at init the plugin writes `.conductor/state/alive.json` `{pid, startMs, version,
sessionID}`, and the orchestrator's first response in a session includes a one-line
conductor banner (version + run id + model). Task 0.2 determines what opencode actually
does with a throwing plugin and records it; if the session survives, the banner and the
beacon are how a human tells the difference, and OPERATIONS.md's first troubleshooting
entry is *"no conductor banner ⇒ the plugin did not load; run `scripts/serve.py` again
and check the opencode log"*. This does not prevent the failure; it makes it visible,
which is the honest limit of what layer 1 can do about its own absence (§9.11).

### 3.9 Workspaces that are not git repositories

opencode is routinely run in scratch directories. Run creation, `.git/info/exclude`
registration, `git.mode`, publish, the freshness index term, and worktrees all assume a
repo, and none of them said what to do without one. Normative: `conductor_setup` calls
`gitio.isRepo`; if false it offers exactly one interactive choice — initialize a repo
here, or run in **no-git mode**. No-git mode sets `git.mode: "read-only"`, disables
publish (items terminate at REVIEWED with their diff recorded in the report), disables
worktree mode, and drops the HEAD term from the freshness rule. Everything else — the
FSM, gates, evidence, review — is unchanged. State still lives in `.conductor/`, and the
`.git/info/exclude` registration is simply skipped.

---

## §4. Parallelism & scheduling

### 4.1 Roles under one model (G13)

Every sub-session runs `config.models.default` — `qwen3.6-27b`. There is no role→weights
mapping in the base build, and therefore no model-swap cost anywhere in the design.

What a role still selects, and why each matters more than the weights did:

| Role | Doctrine pack | Sampling | Gate posture | Priority tag |
|---|---|---|---|---|
| orchestrator | `core.md` | 0.4 | edit: ask (inline claims only) | interactive |
| planner | `decompose.md` / `plan.md` | 0.7 | edit: deny | interactive |
| testWriter | `tdd.md` | 0.5 | edit: `testScope` only | review |
| implementer | `tdd.md` (+`debug.md` in DEBUG) | 0.4 | edit: `fileScope` only | review |
| reviewer | `review.md` / `test-vet.md` | 0.3 | edit: deny | review |
| skeptic | `skeptic.md` | 0.3 | edit: deny | review |
| mechanical | `core.md` (lite) | 0.1 | edit: deny | batch |

**What the single-model decision bought.** The earlier multi-model design paid a full
weight unload+reload (~30 s for a 30 GB model) at every role boundary. Roles alternate
per *stage*, not per wave, so a single item's walk (testWriter → reviewer critics →
implementer → reviewer lenses → skeptics → implementer) crossed the boundary four to six
times per review round; the per-model wave grouping batched *concurrent* jobs but could
do nothing about sequential stages. A two-item run could spend five to eight minutes
reloading weights before generating a token of useful work. Under G13 that cost is
identically zero, and the POC gains something it could not otherwise have had: a quality
delta attributable to *process*, not to a bigger model doing the reviewing (§8 Phase 14).

The fan-out engine still groups jobs by resolved model and drains one group before the
next (Task 7.1). Under the default config that is the identity function on a single
group; it stays because it costs one `groupBy` and it is the difference between a future
multi-model config being a config change and being a redesign (G13).

### 4.2 The wave scheduler (items)

`core/schedule.ts` — pure: `nextWave(queue, items, config) → {parallel: itemId[],
rationale}`. A wave is a maximal set of items that are (a) dependency-ready (all
`dependsOn` PUBLISHED), (b) pairwise fileScope-disjoint (glob-intersection check), (c)
not `blocked`/`deferred`, and (d) within `parallel.maxImplementers`.

**Who drives the wave.** `conductor_dispatch_wave`'s handler runs an internal driver: one
async pipeline per wave member, each walking that item's FSM by calling the same handlers
the per-item tools call, all sharing the fan-out engine's concurrency budget. The
orchestrator model does not interleave items.

This is deliberate and it is the only arrangement that works. A single opencode session
executes tool calls sequentially, so under a marker-only `dispatch_wave` the advertised
overlap ("item B's test is written while item A implements") would require the
orchestrator model to emit concurrent tool calls — exactly the dependency §0.2 refuses
("fan-out does not depend on the model emitting parallel task calls"). Concurrency lives
in the engine, which is deterministic, testable against the fake SDK, and cannot forget.
The per-item tools remain callable for single-item runs, inline claims, and recovery; the
driver and the model reach the same handlers, so there is one implementation and one set
of gates either way.

**Stage batching across items.** Within a wave the driver batches like stages: all
members' vet critics dispatch together, all members' review lenses dispatch together.
Under G13 this no longer saves model swaps (there are none) but it still shares KV prefix
locality through the router's group affinity and keeps the read fan-out saturated.

**Ordering guarantees the driver owns:** writes serialize per tree (`writes: "off"`);
`conductor_publish` runs serially in item order (the git index is a singleton); no
write-capable dispatch enters a tree with a live verify marker (§3.5's freeze-as-
scheduling rule).

**The foreign red set (quarantine).** A deliberately-red test that does not belong to the
item being verified must not poison that verify. Before start-stamping, `runVerify` (and
`runTest`'s no-template fallback, and publish's auto re-verify, and `conductor_report`'s
closing verify) quarantines:

  the testScope files of every OTHER queue item below GREEN
  ∪ every path in the workspace stale-red registry (§2.11)

The item's OWN tests are never excluded. Quarantine = move the files to
`<stateHome>/conductor/<workspaceKey>/quarantine/<runId>/` — **outside the repository** —
with a manifest that replays pending restores after a crash, and restore them when the
verify completes. Freeze denies every edit in the tree for the duration (§3.5), so the
move cannot race a writer.

Why outside the repository: the verify command is the target repo's own test command, and
every default this plan ships walks the tree. A red test parked at `.conductor/runs/…/`
is invisible to *git* and perfectly visible to `node --test`, `pytest`, and friends —
the quarantine would move a failing test from one collected path to another collected
path and change nothing. Dot-directory discovery behaviour differs per runner and per
version; Task 6.2 measures it, but correctness comes from being outside the walked tree,
not from a runner's incidental skip list.

Quarantine granularity is the file. When an item's `testScope` names a file that already
exists and holds *other* tests, quarantining it removes that coverage from the verify —
a real, if narrow, false-green risk. The handler therefore journals every quarantined
path with its test count where the runner reports one, and every report lists the
exclusions that were in force (§3.2). Decomposition is instructed (`decompose.md`) to
prefer new test files per item, which makes the case rare rather than merely undisclosed.

**Worktree mode** (`parallel.writes: "worktrees"`): each wave implementer gets
`git worktree add <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId>` —
**also outside the repository**, and for the same reason with more force: a worktree is a
complete second copy of every test file in the project, so a whole-tree runner in the
main tree would discover and execute all of them, including another item's in-progress
red test. (using-git-worktrees, made mechanical; built and tested in Task 9.6 — `gitio`
and `evidence.runVerify` take an explicit `cwd`/tree argument and verify markers are
per-tree from day one, Tasks 4.2/6.1.) Edit-scope gates bind each session to its worktree
path. Merge-back is serial in item order: `git merge --ff-only` where possible, else a
normal merge by the handler; after each merge the item re-validates against the
integrated tree before PUBLISHED (integration honesty — a green in isolation is not a
green in company). Scope disjointness makes conflicts structurally rare; a conflict
anyway ⇒ the later item drops to GREEN and re-validates.

### 4.3 What parallelizes, summarized

| Stage | Fan-out | Isolation |
|---|---|---|
| plan review, item review, test vet, skeptics | up to `maxReaders`, across items | none needed (read-only) |
| implementation | 1, or wave-wide under worktrees | worktree per item |
| test-writing (RED) | wave-wide, **except into a tree with a live verify marker** | test paths are disjoint by scope; freeze holds the dispatch |
| validate (full verify) | serial per tree — a second validate in a tree with a live marker is DENIED, not queued (worktree mode may validate different trees concurrently) | verify marker per tree (Task 6.1); parallel verifies in ONE tree lie |
| publish | serial in item order | git index is a singleton |

Honest note on the default mode: with freeze covering test files (§3.5), test-writing and
validation of different items no longer overlap inside one tree. What still overlaps is
substantial — every read stage across every item (six review lenses × two items × their
skeptics), plus test-writing while another item's implementer is thinking rather than
verifying. Worktree mode is where full write concurrency lives, and it is the honest
answer for wanting more.

### 4.4 llama-router semantics (normative for Phase 11)

- **Proxy:** transparent pass-through of `/v1/*` (chat/completions, embeddings, models)
  to the upstream, including SSE streaming (`text/event-stream` chunks forwarded
  unbuffered). Everything else 404s except `/conductor/*`.
- **Tagging:** conductor adds headers per request via `chat.headers`:
  `X-Conductor-Role`, `X-Conductor-Priority` (interactive|review|batch),
  `X-Conductor-Group` (prefix-affinity group id, e.g. `run:r-…:review:I3`),
  `X-Conductor-Schema: required` on structured-output requests. Untagged requests are
  priority `interactive` and bypass nothing (admission still applies).
- **Admission:** per-model in-flight counter (the router infers the model from the
  request body's `model` field; under G13 there is one). At cap: enqueue (priority, then
  FIFO). Queue overflow or timeout ⇒ 503 with a JSON error the fan-out engine understands
  (it backs off and retries; bounded). `maxInflightPerModel` MUST be ≤ the server's
  `--parallel` slot count — serve.py derives both from `parallel.maxReaders` (Task 12.1)
  so they cannot drift apart.
- **Group affinity:** among queued requests, dequeue same-`X-Conductor-Group` requests
  contiguously (llama-server's slot reuse then keeps the shared prefix KV-hot). Under
  G13 this is the router's principal wall-clock lever, since there are no swaps to batch.
- **Schema observation (NOT enforcement):** requests tagged `X-Conductor-Schema:
  required` are expected to carry `response_format` (json_schema) or a
  `grammar`/`json_schema` body field — llama-server natively converts JSON schema to GBNF
  and constrains sampling. A tagged request WITHOUT one is journaled, counted
  (`schemaMissing`), and **proxied unchanged**. For non-streaming tagged responses the
  body is validated against the declared schema (nlohmann json-schema-validator) and the
  verdict is recorded in the metrics line — the body is returned **verbatim** either way.

  The earlier design 400'd on a missing schema field and wrapped non-conforming bodies in
  an error envelope. Both make the router able to fail a request the direct path would
  have served, which contradicts G5 and makes "`--no-router` runs the identical process"
  false — a plugin bug that is survivable without the router becomes fatal with it, and
  the fail-soft dependency direction inverts. Enforcement belongs to the fan-out engine's
  receipt validation (§2.10), which runs in both configurations. What the router
  uniquely provides is an *independent* record of how often real local-model output
  actually conforms, which is a POC deliverable and needs no authority to produce.
  `schema.rejectOnMissing` exists in the config, defaults false, and must stay false in
  the base build.

  Note also what response validation can and cannot see: it applies to non-streaming
  responses only. Whether opencode's `session.prompt` issues streaming or non-streaming
  provider requests is determined in Task 0.2 **before Phase 11 is scoped** — if fan-out
  traffic streams, this check observes nothing, the router is justified by scheduling and
  metrics alone, and Task 11.6 shrinks accordingly. That is a scoping input, not a
  discovery to make while writing C++.
- **Metrics:** one JSONL line per request: model, role, group, priority, queue-wait ms,
  upstream ms, prompt/completion tokens + timings (from llama-server's `usage` and
  `timings` response fields), `schemaMissing`, `schemaConformed` (true/false/null for
  streamed), status. `/conductor/metrics` serves aggregates; the ledger is the POC's cost
  and conformance dataset.
- **Fail-soft:** the router never enforces process (that is layer 1's job). Because
  serve.py execs into the session shell and cannot supervise anything directly, the
  router runs under a small supervisor loop process (restart with capped exponential
  backoff; dies with the shell like the existing server watchdog — Task 12.1). While the
  router is down, requests to it fail; the plugin's router client detects this
  (Task 7.2) and **fails over to the upstream base URL for the remainder of the session**,
  journaling a `router.failover` warning and marking the run's metrics as partial. Two
  failovers in one session stop retrying the router entirely. Without failover, "layer 2
  is fail-soft" means only "the process would have been fine if the crash had happened at
  a different time" — in-flight sub-sessions still die and the run still takes `env`
  failures. `--no-router` runs everything direct (G5) and is the same code path.

---

## §5. The opencode wire contract (verified against 1.18.10 on 2026-08-07; Tasks 0.2/11.1 re-verify)

Source of record: opencode.ai/docs (plugins, sdk, agents, permissions, config) and the
`sst/opencode` `packages/plugin/src/index.ts` Hooks interface, cross-checked against the
installed binary (`/opt/homebrew/bin/opencode`, 1.18.10).

### 5.1 Plugin surface

- Plugin: `(input: PluginInput) => Promise<Hooks>`; `PluginInput` carries `project`,
  `client` (SDK), `$` (Bun shell), `directory`, `worktree`.
- Loading: project `.opencode/plugins/`, global `~/.config/opencode/plugins/`, or the
  `"plugin": [...]` array in an opencode config file (npm names or file paths).
  Conductor travels via the **session config** serve.py already generates
  (`OPENCODE_CONFIG` env var), adding `"plugin": ["<abs path to
  llama-harness/conductor/plugin/index.ts>"]` — nothing is written into target repos.
  Task 0.2 verifies a config-listed absolute file path loads on 1.18.10; fallback if
  not: serve.py symlinks into the global plugins dir for the session's lifetime and
  removes it on exit (both paths behind one function; the test pins whichever works).
- Hooks used (exact names): `tool` (custom tool defs), `tool.execute.before`,
  `tool.execute.after`, `chat.message`, `chat.params`, `chat.headers` (outbound request
  headers — carries the §4.4 tags; Task 0.2 verifies it and pins the fallback: embed
  the tags in a body vendor field `x_conductor` that the router strips before
  proxying), `event` (for `session.idle`, `permission.asked`, `session.error`,
  `session.created`), `experimental.chat.system.transform` (system prompt array
  transform). Deny mechanics: `tool.execute.before` throws. The `permission.ask` hook
  exists in the plugin types but is NOT dispatched by the 1.18.10 runtime (verified in
  Task 0.2, asserted so an upstream fix is noticed); permission adjudication instead
  uses the `permission.asked` bus event plus
  `client.permission.reply({requestID, reply: "reject" | "once" | "always"})`, layered
  over static agent-permission blocks (§5.3).
- Custom tools: `tool({description, args: tool.schema…, execute})` under the `tool` hook
  key — this is how every `conductor_*` tool is defined.

### 5.2 SDK surface (the fan-out engine's contract)

- `client.session.create({body:{title}})` → Session (child sessions: Task 0.2 verifies
  whether `parentID` is accepted on create in 1.18.10; if yes, sub-sessions nest under
  the orchestrator in the UI — cosmetic either way).
- `client.session.prompt({path:{id}, body:{model:{providerID,modelID}, agent?, parts:[{type:"text",text}], format?:{type:"json_schema", schema}}})`
  → assistant message with parts; with `format`, the message's structured output is the
  validated object. The fan-out engine ALWAYS validates independently (G5).
- `client.session.abort({path:{id}})` — used by the watchdog (per-sub-session wall-clock
  cap; default 10 min, config-able) and by halt handling.
- `client.session.messages({path:{id}})` — used by the journal to capture sub-session
  transcript refs (paths only, not content, at `info` level; full at `trace`).
- `client.permission.reply({requestID, reply})` — the ask-gate's and inline-claim's
  adjudication call (§3.5, §3.6); Task 0.2 verifies it against the binary.
- Agents: defined in the session config fragment under `"agent": {…}` (§5.3); a
  sub-session is bound to an agent by passing `agent: "<name>"` in the prompt body.

### 5.3 Config fragment (what serve.py merges into the session config)

`conductor/opencode-fragment.json` — merged (deep, conductor keys win) into the
session-scoped config `serve.py` already writes:

```jsonc
{
  "plugin": ["${LLAMA_HARNESS_ROOT}/conductor/plugin/index.ts"],
  "agent": {
    "conductor-orchestrator": {
      "mode": "primary",
      "description": "Coordinates the conductor workflow; does not edit source",
      "permission": { "edit": "ask",
                       "bash": { "*": "allow", "git commit *": "deny",
                                 "git push *": "deny" } },
      "prompt": "{file:${LLAMA_HARNESS_ROOT}/conductor/doctrine/core.md}"
    },
    "conductor-implementer": { "mode": "subagent", "description": "Implements one item",
                               "permission": { "question": "ask" } },
    "conductor-test-writer": { "mode": "subagent", "description": "Writes one item's failing test",
                               "permission": { "question": "ask" } },
    "conductor-reviewer":    { "mode": "subagent", "description": "Reviews with one lens",
                               "permission": { "question": "ask", "edit": "deny" } },
    "conductor-skeptic":     { "mode": "subagent", "description": "Refutes one finding",
                               "permission": { "question": "ask", "edit": "deny" } },
    "conductor-planner":     { "mode": "subagent", "description": "Decomposes and plans",
                               "permission": { "question": "ask", "edit": "deny" } },
    "conductor-mechanical":  { "mode": "subagent", "description": "Small schema-bound tasks",
                               "permission": { "question": "ask", "edit": "deny" } }
  }
}
```

Agent-level `model` is set at runtime by the fan-out engine from `config.models.default`
(passing `model` in the prompt body overrides the agent default — verified in Task 0.2),
so the fragment stays model-agnostic; under G13 every dispatch passes the same id.
Permission blocks on the subagent defs mirror §3.5 (the plugin gates are the enforcement;
agent permissions are defense-in-depth — the same two-layer posture as the production
harness). The orchestrator's `edit: "ask"` is the inline-claim mechanism: the plugin
adjudicates each ask via `permission.asked`/`permission.reply`, allowing iff an active
claim covers the path (§3.6). There is no separate `write` permission key in opencode
1.18.10 — the write/patch tools are governed by `edit`.

**Sub-agent spawning is disabled for every conductor agent**, at both layers: the fragment
sets each agent's built-in task/agent tool to `"deny"` via the config's tool-permission
key (exact key pinned by Task 0.2 — opencode 1.18.10 exposes per-agent tool enablement),
and the session-registry gate (§3.5) denies the call regardless. A model-spawned session
is a session conductor never registered: no role, no item, no scope — and therefore an
un-gated writer reachable by any gated one. Two layers here because the config key is a
version-dependent detail and the gate is not.

`config.models.roles` being non-empty (multi-model, §10 stretch) changes only the `model`
the fan-out engine passes per dispatch; no fragment change is required, which is what
keeps that experiment cheap.

`${LLAMA_HARNESS_ROOT}` is substituted by serve.py at generation time (this repo's
absolute path). The `{file:…}` prompt reference is the documented opencode syntax for
loading a system prompt from a file; Task 0.2 verifies it resolves absolute paths, else
serve.py inlines the file content at generation time (both behind one function).

### 5.4 Known gaps, designed around (not hoped away)

| Gap | Design consequence |
|---|---|
| No pre-emptive stop/turn-end hook | Continuation is `session.idle` → SDK re-prompt with disengage backstop (§3.7); upstream FR (sst/opencode #16626) noted in HONEST-LIMITS |
| `tool.execute.before` deny is an exception, not a typed response | Gate reasons are the Error message; tests assert the thrown text |
| Plugin hooks are async but not transactional | State writes are atomic (tmp+rename) and journaled write-ahead; a crashed handler leaves a consistent last state |
| A sub-session's tool calls also hit our hooks | Session registry maps sessionID→role/item; gates dispatch on that (this is a feature: implementers are gated too) |
| A session the plugin did not create has no registry entry | Session-registry gate (§3.5): reads allowed, all writes and all `conductor_*` denied; sub-agent spawning denied everywhere so unregistered sessions cannot be manufactured |
| A plugin that throws at init may leave a normal-looking, ungated session | Liveness beacon + banner (§3.8); Task 0.2 records opencode's actual behaviour; disclosed in HONEST-LIMITS (§9.11) |
| `experimental.chat.system.transform` is explicitly experimental | Task 0.2 pins it; if it disappears upstream the fallback is prepending the state block to the first user part of each prompt (worse, workable) — recorded in wire-notes |
| `permission.ask` plugin hook is typed but never dispatched at 1.18.10 | Ask-gate uses static agent permissions + the `permission.asked` bus event + `client.permission.reply` (§3.5/§3.6); Task 0.2 asserts the hook's non-dispatch so an upstream fix is noticed |

---

## §6. The doctrine system (superpowers + ponytail, always-on)

### 6.1 The port map (normative)

Each source skill maps to an enforcement point first and doctrine text second. "Doctrine"
below means the pack file's content distills the source skill's iron laws, gate
functions, rationalization tables, and red-flag lists — compressed for a 32k-context
local model (each pack ≤ 120 lines), not quoted wholesale.

| Source | Enforcement (mechanical) | Doctrine (injected) |
|---|---|---|
| test-driven-development | item FSM order (RED before GREEN is structurally impossible to skip); handler-run red/green; `failureClass:"assertion"` legality; evidence ledger | `tdd.md`: iron law, minimal-code rule, red-flag rationalizations table |
| testing-anti-patterns | TEST_VETTED critic lenses (§2.10); test-adequacy review lens post-impl | `test-vet.md`: the 5 anti-patterns as checkable questions |
| verification-before-completion | every FSM advance re-derives evidence in the handler; `conductor_report` re-runs full verify itself | `core.md`: evidence-before-claims, forbidden satisfaction phrases |
| systematic-debugging | DEBUG sub-state entered on validate failure; `debugFixCap` ⇒ architecture escalation surfaced | `debug.md`: four phases, one-hypothesis rule, 3-fix architecture question |
| brainstorming | INTAKE classification + skeptic check; decision records require ≥2 options + scores; human-territory classifier gates AskUser | `core.md` §decisions + §6.2 protocol |
| writing-plans | plan schema + placeholder scan lens in plan review; bite-size enforced by decomposition size checks | `plan.md`: exact-paths, complete-code, no-placeholder patterns by name |
| subagent-driven-development | executor loop IS this skill: fresh sub-session per item; spec-before-quality preserved as ADJUDICATION order (§3.3 — lenses dispatch in parallel for wall-clock; quality findings from a round with surviving spec findings are discarded and re-derived); implementer status protocol incl. re-split escalation | `review.md` ordering section |
| dispatching-parallel-agents | wave scheduler independence criteria (deps + scope disjointness) | `decompose.md` §independence |
| requesting-code-review | reviewer lens prompts derive from the code-reviewer template (severity calibration, file:line specificity; an empty findings array IS the approval verdict — §2.10 has no separate verdict field by design) | `review.md` |
| receiving-code-review | surviving findings routed to implementer with verify-first protocol; pushback goes through one more skeptic round, never silent acceptance | `receive-review.md`: no performative agreement, no gratitude, verify-then-fix |
| using-git-worktrees | `adapter/worktrees.ts` (§4.2) | — (fully mechanical) |
| finishing-a-development-branch | `conductor_publish` + `conductor_report` handlers | — (fully mechanical) |
| executing-plans | superseded by the run FSM itself | — |
| using-superpowers / writing-skills | obsolete: doctrine is always-on by injection (the "skills self-activate zero times" failure is designed out) | — |
| **ponytail** | ladder rung + reuse note required per item (§2.4 schema); minimality lens in plan review AND item review; guardrail lens (security/validation/data-loss/a11y) exempt from laziness | `decompose.md`: the 7-rung ladder; `core.md`: lite reminder |

### 6.2 The decision protocol (`core.md` §decisions + `core/decide.ts`)

The brainstorming skill's collaborative dialogue becomes, for autonomous operation, a
recorded derivation with an explicit ask boundary:

**Precedence ladder** (first source that answers, decides): (1) the user's words this
run; (2) committed project decisions (ADRs, config, this ledger's prior entries);
(3) code + green tests; (4) objective law (determinism, security, license, measurable
budgets); (5) objective design quality — capability superset, earlier/more-mechanical
validation, testability, single-source-of-truth, fewer moving parts for equal
capability; a strictly better option WINS AUTOMATICALLY, effort is never a tiebreaker;
(6) ecosystem convention.

**Multi-option requirement:** every non-trivial fork records ≥2 real options scored on
the ladder-5 criteria (§2.7 schema). `core/decide.ts` scores are the model's, but the
RECORD is mandatory and the plan-review minimality lens re-examines consequential ones.

**Human territory (the only legal asks):** taste/aesthetics; money/paid services;
irreversible externally-visible commitments; secrets; genuine ladder-5 ties on
consequential choices. `decide.ts` (built in Task 1.5) exports
`isHumanTerritory(question) → boolean` as a conservative keyword/shape classifier used
by the ask-gate; misclassification fails
toward surfacing (asking) only at run boundaries, batched in the report or as surfaced
questions — mid-run interactive interruption is reserved for the interactive session's
explicit prompts (the user typing) and for `git.mode` first-run setup.

**Never ask:** "shall I proceed?" (the prompt was authorization); confirmation of a
derivable answer; "the better design is more work, still do it?" (yes — ladder 5).

### 6.3 Ponytail intensity

`config.ponytail`: `lite` = ladder recorded, advisory; `full` (default) = decomposition
handler REJECTS items whose ladder rung is `minimal-code` with an empty `reuse` note
(you must show you looked); minimality findings at plan review are `major` by default;
`ultra` = additionally, the planner is instructed to challenge requirements and ship
minimal versions, and unrequested-abstraction findings block publish. Guardrails are
intensity-independent: security, input validation at trust boundaries, data-loss
handling, and accessibility are never lazy-able; the review guardrail lens enforces
this regardless of mode, and the guardrail + minimality lenses are in the §3.3
MANDATORY set that no configuration or trivial-mode compression removes.

### 6.4 Injection mechanics (`adapter/inject.ts`)

- `experimental.chat.system.transform`: appends to every request's system array:
  (a) the session's doctrine pack(s) — orchestrator: `core.md`; sub-sessions: their
  role pack; (b) a live state block ≤ 30 lines: run state, active item + state, **the
  recommended next tool call with its args** (from `legalTools(...).recommended`, §3.1)
  plus a count of other legal tools, open question count, blocked/deferred counts, taint
  count, overrides remaining. Re-stated every request — never remembered (G9).
- `chat.params`: role-appropriate sampling per §4.1's table — recorded in the journal.
- `chat.headers`: the §4.4 router tags.
- Pack content is loaded once at plugin init and cached; a missing pack file is a
  startup error (fail-closed at init, before any work).

---

## §7. Logging & observability

### 7.1 Levels and sinks

Five levels: `error` > `warn` > `info` > `debug` > `trace`. Config: `logging.level`
global + `logging.components` per-component override (`fsm`, `gates`, `fanout`,
`evidence`, `continuation`, `inject`, `router-client`, `state`), env
`CONDUCTOR_LOG=debug` / `CONDUCTOR_LOG=fanout:trace,gates:debug` wins over config.

Retention is configured, not hoped for (§2.1 `retention`): run dirs are pruned to
`keepRuns` at run creation, and a journal exceeding `maxRunDirBytes` rotates to
`journal.N.jsonl.gz`. At `trace` the journal contains full sub-session prompts and
outputs — large slices of the repo, once per lens, per round, per item — inside the
user's repository, in a directory git has been told to ignore, which means nothing else
will ever notice it growing.

| Sink | Gets | Purpose |
|---|---|---|
| `runs/<runId>/journal.jsonl` | EVERYTHING at or above `trace` filtering per component — the journal is always complete at the configured level; `error`/`warn` records are written regardless of level | machine-readable truth; replay |
| stderr (opencode log surface via `client.app.log`) | ≥ configured console level (default `warn`) | live debugging without opening files |
| `report.md` | curated summary | the human's read |
| router: `spdlog` + metrics ledger | router-side per §2.2 | wire truth |

### 7.2 Journal record shape

```jsonc
{ "seq": 141, "ts": 1754560000000, "level": "info", "component": "fanout",
  "runId": "r-…", "itemId": "I3", "sessionID": "ses_…",
  "event": "subsession.dispatched",
  "data": { "role": "reviewer", "lens": "correctness", "model": "qwen3.6-27b" } }
```

Every record carries the correlation triple (runId, itemId?, sessionID?). Event names
are a closed, tested vocabulary per component (`journal-events.ts` in core exports them;
a test asserts no adapter emits an unlisted event — logs you can't grep by name are
logs you can't debug with). At `debug`, gate decisions log their full input snapshot; at
`trace`, sub-session prompts and raw structured outputs are included (large; the level
exists for harness debugging, the default keeps journals reviewable).

### 7.3 Replay and inspection

`conductor/tools/replay.ts` (built in Task 15.0; run via `node
conductor/tools/replay.ts <run dir> [--component …] [--level …] [--item I3]`): renders
a journal into a human timeline —
per-item swimlanes, gate denials highlighted, fan-out durations, review verdict tables.
`conductor_status` (§3.4) serves the live equivalent in-session. The router dashboard
(`src/dashboard/`, ftxui) tails the metrics ledger: in-flight/queued, group-affinity
hits, schema-conformance rate, token throughput — optional build, no runtime coupling.

### 7.4 The debuggability law

Every deny, every FSM refusal, every disengage, and every schema-validation retry MUST
appear in the journal with enough input context to reproduce the decision through the
pure core function in a test. When a bug report is "conductor did something weird", the
journal + fixtures must be sufficient to write the failing test — that is the bar Task
2.x's tests enforce (a gate that denies without journaling its snapshot fails its test).

---

## §8. Implementation phases

Commit convention: `conductor: <task id> <summary>` after each task's green step. Never
commit red. From Phase 1 on, every green step runs the full TS suite
(`node --test conductor/tests/`); from Phase 11 on, also the C++ suite (`ctest` on the
router-tests target). TS tests use `node:test` + `node:assert/strict`; C++ tests use
doctest; Python tests use `unittest`. Readiness polls, never fixed sleeps.

---

### Phase 0 — Decisions, wire verification, scaffold

#### Task 0.1: Record the standing decisions

- [ ] **Step 1:** Create `runs`-independent repo doc `conductor/DECISIONS.md` recording,
  with alternatives and why (the §6.2 record shape in prose): (a) name = conductor;
  (b) enforcement substrate = TS plugin (all gates) + C++ router (wall-clock/metrics) +
  serve.py wiring, per §0.3; (c) gates hard-deny with the BUDGETED `conductor_override`
  hatch (§3.6 — alternatives considered: uncapped hatch, no hatch, human-approved hatch);
  (d) **one model for every role** (G13, `qwen3.6-27b`) — alternatives: role-tiered
  routing (rejected: 4–6 weight reloads per item per review round under `--models-max 1`,
  and it confounds the POC's quality delta with model size), two-tier judge/worker
  (rejected: same confound, smaller saving); (e) the stock example target
  `myprogram`/`src/main.cpp` is REPLACED by the router targets (it is the unmodified
  llama.cpp simple-chat example; zero project value; git history preserves it);
  (f) plugin tests run under Node type-stripping, with one Bun smoke test (G14) —
  alternatives: all-Bun tests (rejected: no `node --test` ergonomics, and the pure core
  gains nothing), Node-only (rejected: production runtime never exercised until Phase 13);
  (g) `.conductor/` state excluded via `.git/info/exclude` in targets, while quarantine
  and worktrees live OUTSIDE the repo (§1.2 — alternatives: in-repo with runner-exclusion
  flags, rejected as per-runner and per-version fragile).
- [ ] **Step 2:** Commit: `conductor: 0.1 standing decisions`.

#### Task 0.2: Verify the opencode wire contract against the installed binary

- [ ] **Step 1:** Write `conductor/tests/wire-contract.test.ts` — an INTEGRATION test,
  tagged so it can be skipped when opencode is absent (`describe.skip` on missing
  binary), that: starts `opencode serve` (headless server mode) against a throwaway
  fixture dir with a config that (a) lists a file-path plugin exporting every §5.1 hook
  as a recorder, (b) defines a test agent. Through the SDK (HTTP): create session,
  prompt with `format:{type:"json_schema"}` against the served fixture model — for the
  contract test a fake OpenAI-compatible stub server (30 lines, `node:http`, canned
  responses) stands in for llama-server so the test is model-free and fast. Assert:
  plugin loaded from config path; `tool.execute.before` throw DENIES the call and the
  error text reaches the transcript; custom tool registers and executes;
  `chat.headers` output reaches the stub as HTTP headers; `system.transform` content
  reaches the stub's request body; `session.idle` fires after the reply;
  `format` produces the schema'd body field llama-server expects
  (`response_format`/`json_schema` — record WHICH); `model` override in prompt body
  reaches the stub; `{file:…}` prompt refs resolve (or record the fallback); the typed
  `permission.ask` hook is NOT dispatched at 1.18.10 (asserted, so an upstream fix is
  noticed) while the `permission.asked` bus event fires and
  `client.permission.reply({requestID, reply})` adjudicates an agent-level `"ask"`
  permission (the §3.6 inline-claim mechanism, proven here before anything depends on
  it); on `chat.headers` failure, the body-field fallback (`x_conductor` vendor field,
  stripped by the router) is pinned instead. **Four additional discoveries, each of which
  a later phase is designed against and none of which may be assumed:**
  (i) **streaming mode** — does `session.prompt` issue a streaming or non-streaming
  provider request (inspect the stub's received body `stream` field)? This decides
  whether the router's response observation sees anything at all and is a Phase 11
  scoping input (§4.4);
  (ii) **plugin-init failure behaviour** — load a plugin that throws in its factory and
  record what opencode does: refuse the session, or log and continue ungated? The answer
  determines how loud §3.8's liveness beacon has to be;
  (iii) **per-agent tool disablement** — the exact config key that denies an agent the
  built-in task/agent-spawn tool (§5.3), asserted by attempting a spawn from a
  restricted agent;
  (iv) **session `parentID`** on create, and whether a plugin-created session's tool
  calls carry a distinguishable id shape (belt and braces for the registry gate).
- [ ] **Step 2:** Run it — this is discovery: fix §5's constants in
  `conductor/adapter/wire-notes.md` with `WIRE_CONTRACT_VERIFIED: 2026-08-07 <findings>`
  for every checked point, including any that FAILED and the fallback chosen (§5.1's
  symlink fallback, §5.3's inline fallback). This task's "green" = the test passes with
  the recorded reality, not the hoped one.
- [ ] **Step 3:** Commit: `conductor: 0.2 wire contract pinned`.

#### Task 0.3: Scaffold + tsconfig + test runner proof

- [ ] **Step 1:** Create the §1.1 conductor tree (empty dirs as needed),
  `conductor/tsconfig.json` (`erasableSyntaxOnly`, `allowImportingTsExtensions`,
  `noEmit`, `strict`), and one trivial `conductor/tests/smoke.test.ts` asserting
  `1 === 1` plus importing a trivial `conductor/core/types.ts` export (proves .ts
  imports run under `node --test`). Also author `conductor/opencode-fragment.json`
  with the §5.3 content verbatim, plus a test asserting it parses and contains the
  seven agent definitions (its consumer is Task 12.1's merge).
- [ ] **Step 2:** `node --test conductor/tests/` green. Add npm-less runner script
  `scripts/test-conductor.sh` (two lines; the command above) for humans.
- [ ] **Step 3:** Commit: `conductor: 0.3 scaffold`.

---

### Phase 1 — Core library and schemas

#### Task 1.1: `core/types.ts` — every §2 schema, once

**Interfaces:** TS types AND exported JSON Schema objects (hand-written, no generator —
zero deps) for: Config, RouterConfig, Run, Queue, Item, EvidenceRecord, DecisionRecord,
AnomalyRecord, QuestionRecord (§2.11), StaleRedRegistry (§2.11), Findings, Verdict,
Classification, ClassificationCheck, TestVet, ImplementerResult, JournalRecord. Plus
`validate(schemaName, value) → {ok, errors[]}` — a minimal JSON Schema subset validator
(type/required/enum/properties/items/additionalProperties; ~120 lines) sufficient for our
schemas; NOT a general validator, and a test pins the subset by rejecting a schema
feature outside it.

**Schema-subset discipline (single source, two validators).** The router validates the
same exported schemas with the full `json-schema-validator` (Task 11.6). If a schema uses
a keyword the TS subset ignores, the two layers disagree about the same payload and the
fan-out engine sees rejections it cannot reproduce locally. So: a test asserts every
exported schema uses ONLY subset keywords, and `export-schemas.ts` fails on violation.
The schemas are constrained to the weaker validator on purpose.

- [ ] **Step 1:** Failing tests: each schema accepts its §2 example verbatim; rejects a
  missing required field, a wrong enum (e.g. item state "DONE"), an extra property where
  additionalProperties is false; validator subset rejection; **every exported schema is
  subset-clean** (the discipline above); a CLASSIFICATION with `kind:"trivial"` and a
  null/partial `trivialItem` is rejected.
- [ ] **Step 2:** Red. **Step 3:** Implement. **Step 4:** Green.
  **Step 5:** Commit: `conductor: 1.1 schemas`.

#### Task 1.2: `core/shell-parse.ts`

**Interfaces:** `shellTokens(command) → string[]` (quote-aware; operator runs `;&|<>()`
and newlines emit as standalone tokens); `splitOnOperators(tokens) → string[][]`;
`isGitCommand(seg)`, `gitSubcommand(seg)` (skips `-c k=v`, `-C dir`, `--git-dir=`);
`globMatch(pattern, path)` (`**`, `*`, `{a,b}`, `dir/**` matches `dir`);
`scopesIntersect(globsA, globsB)` (conservative: any literal-prefix overlap of the
non-wildcard heads ⇒ true — used by the wave scheduler where a false positive only
serializes, never corrupts).

- [ ] Steps: failing tests (glued metachars `a.cpp;git` split; quoted spaces; newline as
  separator; subcommand skips global options; glob truth table incl. `src` vs
  `src2/a.ts` boundary; scopesIntersect over/under cases with the conservative bias
  asserted) → red → implement → green → commit `conductor: 1.2 shell/glob parse`.

#### Task 1.3: `core/freshness.ts` + `core/stops.ts` + `core/verdict.ts`

**Interfaces:**
- `verifyFreshFor(record, {stagedMtimes, indexMtimeMs, hasStagedDeletion, currentHead,
  noGit}) → {fresh, why}` (§2.6's TWO conditions; `startedMs === ref` counts fresh; the
  HEAD term is skipped when `noGit` — §3.9).
- `classifyFailure(stderr, stdout, exitCode, itemFileScope, runnerRules) →
  "assertion" | "missing-subject" | "error"` (§2.6.1) — pure, so the resolution rule is
  a truth table and not a regex someone tweaks in an adapter.
- `shouldTerminate(run, counters, itemsSummary, config) → {stop:boolean, kind?}`
  (§2.9; `noop` when `futileRePrompts` reaches 3 — the single wedge detector,
  identical to §3.7's rule; `blocked`/`surfaced` derived from `itemsSummary` = {open,
  blocked, deferred, surfacedQuestions} counts; `env` when the override budget is
  exhausted; `interrupt` recorded directly by halt handling, never computed here).
- `isTerminal(run) → boolean` (§2.3's single definition: terminal state OR `stop !== null`).
- `findingSurvives(verdicts[], k) → boolean` (survives iff upholds ≥ ⌈k/2⌉ — a tie
  upholds; a finding two skeptics split on is worth a fix round).
- [ ] Steps: truth-table tests for each — freshness boundary, deletion term, **HEAD
  mismatch fails freshness while every mtime term passes** (the branch-switch case), the
  `noGit` skip; `classifyFailure` over a table with at least: Node `Cannot find module
  '../src/slugify.ts'` where `src/**` IS the item's fileScope ⇒ `missing-subject`, the
  same error where it is NOT ⇒ `error`, `Cannot find module 'lodash'` ⇒ `error`,
  `SyntaxError` in the test file ⇒ `error`, pytest `ModuleNotFoundError` for the item's
  package ⇒ `missing-subject`, a Go build failure naming the item's package ⇒
  `missing-subject`, a plain assertion ⇒ `assertion`; every computed stop kind incl.
  blocked/surfaced/deferred from itemsSummary counts and `env` from budget exhaustion;
  `isTerminal` for EXECUTING-with-stop; verdicts at k=2: 0 upholds dies, 1 uphold (tie)
  survives, 2 upholds survives; k=3 majority cases → red → implement → green → commit
  `conductor: 1.3 freshness/failure-class/stops/verdict`.

#### Task 1.4: Purity guard

- [ ] **Step 1:** `conductor/tests/purity.test.ts`: read every file under
  `conductor/core/`; assert imports name only `./…​.ts` core siblings, and source
  contains none of: `node:fs`, `node:child_process`, `Bun`, `fetch(`, `process.env`,
  `Date.now` (core takes `nowMs` as input). Trivially green now; bites later.
- [ ] **Step 2:** Same file, the G14 adapter guard: read every file under
  `conductor/adapter/` and `conductor/plugin/` and assert none references `Bun`, the
  shell tag `` $` ``, `Bun.spawn`, or `bun:` imports — adapters must run under BOTH
  runtimes, and the plugin's Bun-only `$` is the one API that silently works in
  production and cannot run in any test (G14). Assert also that subprocess use goes
  through `node:child_process`.
- [ ] **Step 3:** Commit: `conductor: 1.4 purity + dual-runtime guards`.

#### Task 1.5: `core/decide.ts`

**Interfaces:** `scoreOptions(options[]) → {winner: string|null, tie: boolean}` — sums
the §2.7 score keys per option; a strictly greater total wins; equal totals tie.
`isHumanTerritory(question) → boolean` — conservative keyword/shape classifier for the
§6.2 categories (taste/aesthetics, money/paid services, irreversible/publish/delete,
secrets/credentials); exported for the ask-gate (Task 10.1) and `conductor_decide`.
`requireTwoOptions(record) → {ok, why}` — a `kind:"derived"` decision needs ≥2 options
with scores (Task 9.1's rejection rule).

- [ ] Steps: failing tests (score comparison incl. tie; isHumanTerritory truth table —
  ≥10 cases, both polarities, incl. a derivable-sounding question containing the word
  "delete" inside a file path [false] vs "delete the production data" [true];
  two-option rule) → red → implement → green → commit `conductor: 1.5 decision helpers`.

---

### Phase 2 — Journal

#### Task 2.1: `core/journal-events.ts` + `adapter/journal.ts`

**Interfaces:** core: the closed event-name vocabulary per component + level defaults.
adapter: `createJournal(runDir, config, env) → {log(level, component, event, data,
corr), flushSync()}` — JSONL append with seq/ts/correlation, level filtering per §7.1
(error/warn always written), env override parsing (`CONDUCTOR_LOG=fanout:trace,…`),
console sink via injected `consoleFn` (tests capture), atomic append (single
`appendFileSync` per record; records ≤ 32 KiB, larger data truncated with
`"truncated":true`).

- [ ] Steps: failing tests (level filtering matrix incl. always-written error; env
  override beats config; unknown event name THROWS in dev/test (asserted) and warns in
  prod; seq monotonic across two journal instances on the same dir (re-read last seq);
  truncation; rotation at `retention.maxRunDirBytes`) → red → implement → green →
  commit `conductor: 2.1 journal`.

#### Task 2.2: Bun runtime smoke (G14) — the earliest possible dual-runtime proof

**Files:** `conductor/tests/bun-smoke.test.ts`, `scripts/test-conductor.sh` (extended).

The plugin runs under opencode's Bun runtime; every other test in this plan runs under
Node. For the pure core that gap is harmless (G3 forbids I/O there). For adapters it is
not: atomic tmp+rename, `appendFileSync` under concurrent appends, `execFile` with
`shell:false`, `process.pid`, and timer behaviour are all runtime-observable. Discovering
a divergence at Task 13.2 means discovering it under thirty modules.

- [ ] **Step 1:** Write `bun-smoke.test.ts` — the SAME assertions as the state-store and
  journal tests (atomic write survives an injected throw; lock claim/stale-break; JSONL
  append ordering; one `execFile` round-trip), written so it runs under BOTH
  `bun test` and `node --test`.
- [ ] **Step 2:** Run under both. Any divergence is fixed in the adapter (never by
  branching on runtime) or recorded in `adapter/wire-notes.md` with the constraint it
  imposes. Extend `scripts/test-conductor.sh` to run both runtimes, and skip the Bun leg
  with a loud notice if `bun` is absent.
- [ ] **Step 3:** Commit: `conductor: 2.2 bun runtime smoke`.

> Task 2.2 has a dependency inversion by design: it is written after Task 4.1's state
> store exists. Sequence it as the FIRST step of Phase 4's green, not as a Phase 2
> prerequisite — it lives here so the plan reads in runtime order, and its commit lands
> immediately after `conductor: 4.1 state store`.

---

### Phase 3 — State machines

#### Task 3.1: `core/fsm-run.ts` + `core/fsm-item.ts`

**Interfaces:** `RUN_STATES`, `ITEM_STATES` (exact §3 vocabularies — note that `blocked`,
`deferred`, and `debugging` are item ANNOTATIONS, not members of `ITEM_STATES`, and the
transition table is orthogonal to them: a blocked item makes no transitions at all until
unblocked, which is one rule rather than a parallel state space);
`legalRunTransition(from, to, context) → {ok, why?}`;
`legalItemTransition(from, to, context) → {ok, why?}` where context carries the
evidence the transition claims (GREEN requires `{testExit:0}` for behavioral items,
RED requires `{testExit:≠0, failureClass ∈ {"assertion","missing-subject"}}`,
PLAN_REVIEWED requires `{survivingMajors:0}` or `{round:>=max}`); transitions not in the
table are illegal.

- [ ] Steps: failing tests — full transition matrices (legal set exactly as §3.1/§3.3
  draw them; every illegal pair rejected with a why naming the legal successor;
  evidence-context requirements: GREEN with testExit 1 rejected, RED with
  failureClass "error" rejected, **RED with failureClass "missing-subject" ACCEPTED**;
  **PENDING→GREEN legal iff `item.behavioral === false`, rejected otherwise; PENDING→RED
  rejected for a non-behavioral item**; a `blocked` item rejects every transition with a
  why naming the question id; the trivial trajectory: INTAKE→EXECUTING with
  classification trivial legal, EXECUTING→TRIVIAL_DONE legal ONLY for trivial runs,
  rejected for work runs — and EXECUTING→REPORTED rejected for trivial runs;
  INTAKE→DECOMPOSED requires classification work; PLAN_REVIEWED→EXECUTING requires
  the context `{survivingMajors:0}` or `{round:>=max}` — same context rule as
  PLANNED→PLAN_REVIEWED) → red → implement → green → commit `conductor: 3.1 FSMs`.

#### Task 3.2: `core/gates-phase.ts`

**Interfaces:** `legalTools(run, items, questions, repoConfigured) → {legal:
Map<toolName, argsHint>, recommended: {tool, args} | null, why}` — the single source the
phase-order gate, the injection, and the continuation engine consume (one derivation,
three consumers — they can never disagree). `recommended` is deterministic: the wave
order of §4.2 (DAG depth, then item id), then that item's next stage tool.
`repoConfigured: false` ⇒ the ONLY legal tools are `conductor_setup` and
`conductor_status`.

- [ ] Steps: failing tests (`conductor_status` legal in EVERY state including terminal;
  `conductor_decide`/`conductor_surface`/`conductor_defer` legal in every non-terminal
  state; `conductor_answer` legal whenever an open question exists, terminal runs
  included; UNCLASSIFIED INTAKE ⇒ only `conductor_classify`; INTAKE with
  `classification.kind === "work"` ⇒ `conductor_decompose` recommended; PLAN_REVIEWED ⇒
  `conductor_dispatch_wave` (which performs PLAN_REVIEWED→EXECUTING on first call);
  **a two-item wave yields a legal SET containing both items' next tools and exactly ONE
  `recommended`, deterministic under item reordering** (the §3.1 rule — this is the test
  that would have caught "the one legal next tool" being false); EXECUTING with item I1
  at TEST_VETTED ⇒ `conductor_mark_green {itemId:I1}` legal and `conductor_publish
  {itemId:I1}` illegal; a `blocked` item contributes NO tools to the legal set; a
  non-behavioral PENDING item offers `conductor_mark_green`, not `conductor_submit_test`;
  EXECUTING flagged trivial legalizes the item tools and `conductor_report`; unconfigured
  repo ⇒ only setup+status; `isTerminal` run ⇒ status (+`conductor_answer` when questions
  are open) and nothing else) → red → implement → green →
  commit `conductor: 3.2 phase legality`.

#### Task 3.3: `core/schedule.ts`

**Interfaces:** `nextWave(queue, items, config) → {parallel: string[], rationale}` per
§4.2 (dependency-ready ∧ pairwise scope-disjoint ∧ ≤ maxImplementers; deterministic
order: DAG depth then id); `readFanout(stage, config) → number`.

- [ ] Steps: failing tests (diamond DAG waves; scope overlap forces serialization —
  and the conservative `scopesIntersect` bias shows up here as a test; maxImplementers
  cap; PUBLISHED deps unlock) → red → implement → green →
  commit `conductor: 3.3 wave scheduler`.

---

### Phase 4 — State store + git I/O

#### Task 4.1: `adapter/state.ts`

**Interfaces:** run lifecycle (`createRun` — which also captures `startHead`,
`startBranch`, `startDirty`, and the active §2.11 stale-red entries, and prunes per
`retention`; `loadRun`, `saveRun`, `currentRun`, `archiveRun`), item CRUD **including the
disposition setters** (`setBlocked`, `clearBlocked`, `setDeferred`, `setDebugging`),
queue read/write, the question ledger (§2.11, via `adapter/questions.ts`), the workspace
stale-red registry (read/add/remove), ledger appends (evidence via evidence.ts only —
state.ts exposes the raw append but a test asserts no other adapter imports it), the
liveness beacon (§3.8), halt detection, `.git/info/exclude` registration, atomic
tmp+rename writes (pid-suffixed tmp), BOM-tolerant reads, an advisory lockfile per
workspace (single-writer: the plugin instance; the lock guards against two opencode
sessions sharing a workspace — second session gets read-only conductor with a loud
journal warning).

- [ ] Steps: failing tests on fixture dirs (round-trips; atomicity — a write interrupted
  by injected throw leaves the old file; exclude registration idempotent and SKIPPED in
  no-git mode (§3.9); `createRun` records startHead/startBranch/startDirty from a fixture
  repo with a dirty file, and carries the stale-red entries into `excludedStaleRed`;
  retention prunes to `keepRuns` oldest-first and never touches the live run; blocked/
  deferred setters round-trip and `itemsSummary` computes from them; question append +
  answer clears every item that named the question; stale-red add/remove; beacon written
  at init; LIVE foreign lock ⇒ read-only mode flag; STALE lock — the lockfile carries
  `{pid, startMs}` and a dead pid or over-age lock is broken with an anomaly record and
  single-writer claimed, mirroring Task 6.1's marker rule, so an opencode crash never
  wedges a workspace) → red → implement → green → commit `conductor: 4.1 state store`.
- [ ] Then run Task 2.2's Bun smoke against this module and commit it
  (`conductor: 2.2 bun runtime smoke`) before Phase 5 begins.

#### Task 4.2: `adapter/gitio.ts`

**Interfaces (execFile, shell:false; every function takes an explicit `cwd` — the
workspace root or a worktree path, which is what makes Task 9.6's worktree mode
possible without interface breaks):** `stagedFiles`, `stagedNameStatus`, `dirtyFiles`,
`unstagedDrift(paths)`, `indexMtimeMs`, `worktreeMtimes(paths)`, `headShortSubject`,
**`headSha`** (the freshness rule's HEAD term, §2.6, and `run.startHead`),
`currentBranch`, `isRepo`.

- [ ] Steps: failing tests against throwaway fixture repos built by the test (incl.
  NUL-splitting a filename with a space; zero-commit repo — where `headSha` is null and
  the freshness HEAD term is vacuous rather than crashing; staged deletion; `dirtyFiles`
  distinguishing tracked-modified from untracked, since publish's `startDirty` rule
  (§3.3) consumes both) → red → implement → green → commit `conductor: 4.2 gitio`.

---

### Phase 5 — Gates

#### Task 5.1: `core/gates-git.ts`

**Interfaces:** `decideGit(command, sessionRole, gitMode, runActive, branchPolicy) →
{action:"allow"|"deny", reason?}` implementing the §3.5 matrix over parsed tokens,
**default-deny for any subcommand not in the read-only allow-list or an explicit row**.

- [ ] **Step 1:** Failing test — the FULL matrix as a table, one test per row, including
  every §3.5 row and the false-positive guards verbatim: `git add src/config.ts` deny
  with reason naming conductor_publish, `git log --grep config` allow, `git stash push -m
  drop` deny (staging is publish's), `git stash list` allow, `git commit -m "fix reset
  logic"` deny-with-publish-reason (not a destructive-verb false positive), compound
  `echo hi && git reset --hard` deny (every segment scanned), newline-separated compound
  deny, `+refspec`/`:refspec` push denies, `restore --staged` allow vs
  `restore --staged --worktree` deny. **Plus the coverage this matrix previously lacked,
  one test each:** `git apply patch.diff` deny (it writes files around the edit gate — the
  most important single row here), `git worktree add /tmp/x` deny, `git update-ref`,
  `git symbolic-ref`, `git sparse-checkout set`, `git submodule update`, `git bisect
  start`, `git gc --prune=now`, `git reflog expire`, `git fetch`, `git remote set-url`,
  `git tag -d v1`, `git config user.email x` all deny; `git blame`, `git shortlog`,
  `git describe`, `git cat-file -p HEAD`, `git rev-list --count HEAD`, `git worktree
  list`, `git config --get user.name` all allow; **an invented subcommand
  (`git frobnicate`) denies by default with a reason naming the subcommand** — the rule
  that makes the table's completeness a non-issue; `git switch feature` deny under
  `branchPolicy:"pin"` with a run active, allow under `"check-only"`, allow under `"pin"`
  with no active run.
- [ ] Steps 2–5: red → implement → green → commit `conductor: 5.1 git policy`.

#### Task 5.2: `core/gates-edit.ts`

**Interfaces:** `decideEdit({sessionRole, registered, fileScope, testScope, path,
verifyInFlightTree, sessionTree, inlineClaimScope}) → decision`;
`writeShapedPaths(command) → string[]` (bash write-target extraction: redirects, tee,
sed -i, mv/cp destinations, rm targets — reads NEVER match);
`decideSession({registered, role, toolName, toolClass}) → decision` (§3.5's
session-registry gate, including the unconditional sub-agent-spawn deny).

- [ ] Steps: failing tests (orchestrator denied on src, allowed with matching inline
  claim; implementer allowed in fileScope, denied out with the scope named;
  test-writer allowed ONLY inside `testScope`, denied on fileScope source paths with
  the testScope named; reviewer/skeptic/planner denied everywhere; **unregistered
  session: a read allowed, an edit denied, a `conductor_*` call denied, a spawn denied —
  and a spawn denied from a REGISTERED implementer too**; anyone denied on
  `.conductor/**` AFTER tree-relative normalization — an edit at
  `<stateHome>/…/worktrees/<runId>/I2/src/a.ts` from the I2 implementer session
  normalizes to `src/a.ts` and is ALLOWED, while `…/I2/.conductor/…` is denied;
  **freeze denies EVERY edit in a tree with a live verify — a test-writer editing a file
  inside its own `testScope` is denied, which is the case the two earlier readings of
  this rule disagreed about** — and allows the same edit in a different tree;
  write-shape matrix incl. read counterexamples `cat`, `grep`) → red → implement →
  green → commit `conductor: 5.2 edit + session gates`.

#### Task 5.3: Gate wiring in the plugin + fail-closed proof

**Files:** `conductor/adapter/tools.ts` (gate hookup half), `conductor/plugin/index.ts`
(hook bodies).

- [ ] Steps: failing tests driving the exported hook functions directly with synthetic
  inputs + a fixture session registry (no opencode needed): bash git deny throws with
  the core's reason; edit deny throws; **the registry gate runs FIRST — an unregistered
  session's edit is denied by the registry rule, not by a scope rule, and the reason
  says so**; a spawn attempt throws in every session; an injected crash in `decideGit`
  during a git command still throws (fail-closed) and journals `gate-crash`; the same
  crash during `ls` allows and journals; every deny journals its input snapshot (the
  §7.4 law — the test greps the journal); the plugin's `tool` hook registers exactly the
  §3.4 tool names (asserted against the inventory, so a renamed or forgotten tool fails
  here rather than at runtime) → red → implement → green →
  commit `conductor: 5.3 gate wiring`.

---

### Phase 6 — Evidence engine

#### Task 6.1: `adapter/evidence.ts`

**Interfaces:** `runTest(runDir, itemId, {scope, testFiles, cwd, fileScope,
excludeTestFiles}) → EvidenceRecord` — derives the command from the scope's `itemTest`
template (§2.1 substitutions: `{files}`, `{dirs}`, `{name}`), applies the §2.1 zero-test
guard (a targeted run that executed no tests is neither red nor pass — falls back);
when no template exists (or the guard fires), runs the full scope command under the
§4.2 quarantine (`excludeTestFiles`) and marks the record `targeted:false` so callers can
apply the §2.1 fallback rule (the failure excerpt must name a testScope file, else the
red is illegal). Spawns, then classifies the failure by calling **`core.classifyFailure`**
(Task 1.3) with the item's `fileScope` — the three-way §2.6.1 verdict, where the
`missing-subject` case is decided by whether the unresolved module/symbol resolves inside
that scope. Per-runner resolution rules (how to extract the unresolved specifier from a
Node/pytest/go/ctest failure) live in a table beside the runner defaults and are data,
not code.

`runVerify(runDir, itemId, config, scopePattern, {cwd, excludeTestFiles}) →
EvidenceRecord`: quarantine FIRST, then start-stamp, then record HEAD/branch, then run;
build-before-test per scope; timeout kills; runs in `cwd` — workspace or worktree.
`excludeTestFiles` is the §4.2 foreign red set: the named files are moved to
`<stateHome>/conductor/<workspaceKey>/quarantine/<runId>/` — **outside the repository, so
no whole-tree runner can reach them** — for the duration and restored afterward, with a
manifest replaying pending restores after a crash. Writes
`verify-running-<treeKey>.json {pid,startMs}` inside the run dir (treeKey = "main" or the
worktree's item id), removed on completion — the freeze gate's per-tree
`verifyInFlightTree` source; a second `runVerify` against a LIVE marker for the same tree
returns a refusal record rather than running (§4.3). Both append to evidence.jsonl and
journal.

- [ ] Steps: failing tests with fixture commands (`node -e` exit 0/1, stderr shapes;
  timeout; build-fail ⇒ test provably not run (witness file); start-stamp ≤ a mid-run
  mtime; HEAD/branch recorded; marker created/removed; **a second runVerify against a
  live marker refuses**; killed run leaves marker → next runVerify breaks a stale marker
  (dead pid) with an anomaly; itemTest template substitution for BOTH `{files}` and
  `{name}` (basename-alternation case: `tests/parser_test.go` ⇒ `parser_test`);
  no-template fallback marks `targeted:false` and the illegal-red rule fires when the
  excerpt names no testScope file; **failure classification end-to-end: a fixture test
  importing a not-yet-existing module inside fileScope yields `missing-subject` and is a
  legal red; the same import pointing outside fileScope yields `error`**; quarantine:
  `runVerify` with `excludeTestFiles` moves the named files OUT OF THE REPO before the
  start-stamp and restores them after — a quarantined deliberately-red file provably not
  executed (witness file written by the fixture test if it runs), restoration on
  completion AND on the next run after a mid-verify kill (the manifest replays pending
  restores, mirroring the stale-marker healing); a quarantined file's mtime survives the
  round-trip (rename, not copy — otherwise every quarantine invalidates freshness)) →
  red → implement → green → commit `conductor: 6.1 evidence engine`.

#### Task 6.2: Runner discovery probe (manual-run, documented) — prove the quarantine

The quarantine is only sound if a moved-aside test is genuinely unreachable by the verify
command. Being outside the repository is what makes that true; this task confirms it and
measures the counterfactual, so nobody later "simplifies" the quarantine back inside
`.conductor/`.

- [ ] **Step 1:** For each supported default runner (`node --test`, `pytest`,
  `go test ./...`, `ctest`), on a fixture project: (a) place a failing test at
  `.conductor/runs/x/quarantine/` and record whether the runner collects it;
  (b) place it at the out-of-repo quarantine path and record that it does not;
  (c) create a `git worktree` inside the repo and record whether the main tree's runner
  collects the worktree's copies. Write results to `conductor/docs/RUNNER-DISCOVERY.md`
  with versions and exact commands.
- [ ] **Step 2:** Commit: `conductor: 6.2 runner discovery probe`. Any runner that
  collects in-repo dot-directories is a citation in HONEST-LIMITS for why the
  out-of-repo location is normative.

---

### Phase 7 — Fan-out engine

#### Task 7.1: `adapter/fanout.ts` (against a FAKE SDK)

**Interfaces:** `createFanout(client, config, journal, registry, treeState)` →
`dispatch({role, lens?, itemId?, tree?, writeCapable?, prompt, schemaName, priority}) →
Promise<result>` and `dispatchWave(jobs[]) → Promise<results[]>`. Behavior: model
grouping (§4.1 — jobs grouped by resolved model, next group awaits the current one's
drain; the identity function under G13's single model, and the seam a multi-model config
would use); concurrency ≤ maxReaders; **freeze-aware admission — a `writeCapable` job for
a tree with a live verify marker is HELD, not dispatched and not denied** (§3.5), and
released when the marker clears; per-job watchdog (abort via SDK after
`parallel.subSessionTimeoutMs`); schema validation on receipt with ≤2 re-prompt retries
(validation errors appended to the retry prompt); session registry entries (sessionID →
{role, itemId, tree}) for the gates, written BEFORE the prompt is sent so no sub-session
can make a tool call while unregistered; journal events for dispatch/hold/complete/retry/
abort; results carry {sessionID, value|error, timings}.

The FAKE SDK (`tests/fixtures/fake-sdk.ts`) implements create/prompt/abort/messages
with canned, per-test-programmable responses and records every call — the unit tests
never need opencode or a model.

- [ ] Steps: failing tests (model grouping: mixed-model jobs dispatch AABB not ABAB —
  asserted on the fake's call order, and a single-model job set dispatches in one group
  with no barrier; **a writeCapable job for a frozen tree is held and dispatches only
  after the marker clears, while a read job for the same tree dispatches immediately**;
  **the registry entry exists before the first prompt is sent** (the fake asserts
  ordering — a sub-session must never be able to call a tool while unregistered); retry
  on schema-invalid then success; two failures ⇒ env-failed result; watchdog aborts;
  registry populated and cleaned) → red → implement → green →
  commit `conductor: 7.1 fanout engine`.

#### Task 7.2: `adapter/router-client.ts`

**Interfaces:** `routerHealthy(routerCfg) → Promise<boolean>`;
`fetchMetricsSummary(routerCfg) → Promise<summary|null>` — strictly fail-soft: never
throws, null on any failure, journals at `debug`;
`resolveBaseUrl(routerCfg, upstreamCfg, failoverState) → url` — the §4.4 failover: after
a router request failure the plugin uses the upstream base URL for the remainder of the
session, journals `router.failover`, and marks the run's metrics partial; after two
failovers it stops probing the router entirely. Consumers: the fan-out engine (base URL)
and `conductor_report`'s metrics section (Task 9.5b).

- [ ] Steps: failing tests against a stub `node:http` server (healthy 200; 404;
  connection refused; hang past a 2 s internal timeout — each yields false/null
  without throwing; **failover: after a refused request `resolveBaseUrl` returns the
  upstream and keeps returning it; the run's metrics are marked partial; a second
  failover disables probing**) → red → implement → green →
  commit `conductor: 7.2 router client + failover`.

---

### Phase 8 — Doctrine packs + injection

#### Task 8.1: Write the doctrine packs

**Files:** the nine `conductor/doctrine/*.md` files per §1.1, each ≤ 120 lines,
distilling per the §6.1 port map. Authoring constraints (tested where testable): every
pack that names an enforced behavior names its enforcing mechanism ("the handler runs
the test; your claim is not the record"); rationalization tables are carried over
compressed (TDD's excuse table, debugging's excuse table, verification's red-flag
phrases, receiving-review's forbidden responses); ponytail's ladder verbatim with the
guardrail list; no pack references opencode, Claude, Cursor, or any client by name
(model-facing text is client-agnostic).

- [ ] **Step 1:** Failing test `doctrine.test.ts`: every §1.1 pack file exists,
  non-empty, ≤ 120 lines, contains its required anchor strings (e.g. `tdd.md` contains
  "NO PRODUCTION CODE WITHOUT A FAILING TEST" and "delete means delete"; `debug.md`
  contains the four phase names and the 3-fix rule; `review.md` contains the severity
  triad and "file:line"; `test-vet.md` names the five anti-patterns; `decompose.md`
  contains the seven ladder rungs **and the behavioral/non-behavioral rule with its
  path test, plus the "prefer a new test file per item" guidance that keeps §4.2's
  file-granular quarantine from removing unrelated coverage**; `core.md` states the
  override budget and that exhaustion stops the run; `receive-review.md` contains
  "verify before implementing" and bans "You're absolutely right"); no pack contains
  "TBD"/"TODO".
- [ ] Steps 2–4: red → write the packs → green.
  **Step 5:** Commit: `conductor: 8.1 doctrine packs`.

#### Task 8.2: `adapter/inject.ts`

**Interfaces:** `buildSystemAppend(registryEntry, run, items, questions, packs) →
string[]` (role pack + ≤30-line state block naming the RECOMMENDED next tool call from
`gates-phase.ts` plus the count of other legal tools, open questions, blocked/deferred
counts, overrides remaining); `paramsForRole(role) → {temperature, topP?}` per §4.1;
`headersFor(registryEntry, job?) → Record<string,string>` (§4.4 tags).

- [ ] Steps: failing tests (orchestrator gets core.md + state block; implementer gets
  tdd.md + its item block; state block stays ≤30 lines with 40 items (summarization
  asserted); the recommended-tool line matches `legalTools(...).recommended` for three
  run states AND names `conductor_setup` on an unconfigured repo; **with a two-item wave
  the block names one recommendation and reports the others as a count, never a list of
  contradictory instructions**; header set per role; missing pack file at init throws AND
  the throw is journaled + the liveness beacon is NOT written, so §3.8's absence signal
  is real) → red → implement → green → commit `conductor: 8.2 injection`.

---

### Phase 9 — Tools + stage logic (the pipeline itself)

Each task: tool handler(s) in `adapter/tools.ts`, driven by unit tests through the FAKE
SDK + fixture repos. Handlers follow the invariant loop: legality → derive → persist →
journal → compact return.

#### Task 9.1: `conductor_classify` + `conductor_status` + `conductor_decide` + `conductor_surface` + `conductor_answer` + `conductor_defer`

- [ ] Steps: failing tests (classify dispatches classifier + skeptic on the fake, both
  schema-constrained (CLASSIFICATION and CLASSIFICATION_CHECK), disagreement escalates to
  the stricter kind, run.json embeds the check; **a trivial classification synthesizes
  its one item from `classification.trivialItem` and the result validates against the
  §2.4 item schema — title, acceptance, and the ponytail block included** (the earlier
  design had no source for those fields and would have had to fabricate them); trivial
  with a fileScope over `trivialMaxFiles`, an empty testScope on a behavioral item, or a
  behavioral:false item whose fileScope intersects `behavioralPaths` escalates to work
  (handler re-check, one test each); status renders including questions and dispositions;
  decide appends the §2.7 record rejecting <2 scored options for kind:derived (Task 1.5's
  rule); **surface writes `questions.jsonl` and sets `blocked:{questionId}` on every named
  item, and the run continues on the rest; answer clears exactly those items and journals;
  defer sets `deferred` + a decision record and report later accepts it**) → red →
  implement → green → commit `conductor: 9.1 intake + question tools`.

#### Task 9.2: `conductor_decompose` + `conductor_plan`

- [ ] Steps: failing tests (decompose validates DAG/scopes/sizes per §3.2's table, one
  test per row; cycle rejected with re-prompt (fake returns a cycle then a fix); **an
  item with `behavioral:false` whose fileScope intersects `behavioralPaths` is REJECTED
  with the intersecting glob named; the same item with a docs-only fileScope is accepted
  and may carry an empty testScope; a behavioral item with an empty testScope is
  rejected**; ponytail full-mode rejects minimal-code rung with empty reuse note; plan
  writes plan.md, extracts ≥2-option decisions into the ledger; placeholder strings in
  the fake's plan output are rejected with one bounded re-prompt) → red → implement →
  green → commit `conductor: 9.2 planning tools`.

#### Task 9.3: `conductor_plan_review` (the adversarial loop, plan-level)

- [ ] Steps: failing tests (4 lenses dispatched with lens-specific prompts (asserted on
  the fake); majors → K skeptics each; surviving major ⇒ planner re-prompted with
  findings, round increments; zero surviving majors ⇒ PLAN_REVIEWED; **round cap ⇒ each
  surviving major is WRITTEN to questions.jsonl with `origin:"plan-review-cap"`, every
  item it names is set `blocked:{questionId}`, and the untouched items proceed — the
  blocked set asserted by reading the item files, not by inspecting a log line**) → red →
  implement → green → commit `conductor: 9.3 plan review`.

> **Why Phase 9 is six tasks and not two.** The earlier draft bundled six tools into one
> task and five into another, each with ~15 asserted behaviours — the two largest,
> least-decomposed steps in a plan whose own doctrine (`plan.md`, §3.2) makes oversized
> steps a review finding, and whose G4 requires a single clean red per task. Each task
> below is one coherent red→green→commit.

#### Task 9.4a: `conductor_submit_test` + `conductor_vet_test`

- [ ] Steps: failing tests, one per enforced behaviour: submit_test runs the test via
  evidence.ts and rejects failureClass `"error"` (fixture stderr) with a repair loop
  bounded by `testRepairAttempts`, then sets `blocked` + writes a question;
  **`missing-subject` on a greenfield fixture (the test imports a module inside fileScope
  that does not exist) is accepted as a legal RED** — the case that makes ordinary TDD
  possible at all; an immediately-passing test is rejected and records the ponytail-skip
  decision; submit_test is ILLEGAL for a non-behavioral item; vet_test fans out
  `vetCritics` with spec+test+red (and NOT impl — asserted absent from the fake's received
  prompt); mustFix loops bounded by `vetMaxRounds` → red → implement → green →
  commit `conductor: 9.4a test submission + vetting`.

#### Task 9.4b: `conductor_mark_green` + `conductor_validate` + `conductor_queue_amend`

- [ ] Steps: mark_green re-runs the item test and denies on exit 1; **mark_green from
  PENDING is legal for a non-behavioral item and runs no item test**; validate
  quarantines the foreign red set, start-stamps, records HEAD, sets the per-tree marker
  (freeze integration asserted through the gates test), and refuses against a live marker;
  **a wave sibling at RED, a blocked prior-wave item at RED, and a stale-red registry
  entry from an earlier run all provably fail to break item A's validate** (three fixture
  cases — the third is the one no in-run rule could have caught), while item A's own red
  test still does; two no-template fallback items in one wave reach GREEN without
  livelocking; DEBUG entry on failure sets `debugging`, injects debug.md into the
  implementer's next dispatch (asserted), and at `debugFixCap` writes an architecture
  question + blocks; queue_amend re-validates DAG/scopes/behavioral and records a
  decision → red → implement → green → commit `conductor: 9.4b green/validate/amend`.

#### Task 9.4c: `conductor_dispatch_wave` (the wave driver)

- [ ] Steps: failing tests against the fake SDK + fixture repo: wave membership matches
  `core/schedule.nextWave` (blocked/deferred items excluded); **the driver runs two wave
  members' pipelines concurrently and the fake's call log proves interleaving** — the
  behaviour §4.2 promises and that no orchestrator-driven design could deliver; like
  stages batch across members (both items' vet critics in one dispatch group); writes
  serialize per tree; publish order is item order; a member that blocks does not stall
  the other; the driver returns a compact per-item disposition summary; first call
  performs PLAN_REVIEWED→EXECUTING → red → implement → green →
  commit `conductor: 9.4c wave driver`.

#### Task 9.5a: `conductor_item_review` (lenses, skeptics, path-routed fixes)

- [ ] Steps: the §3.3 MANDATORY lens set always dispatches (a config of `itemReviewers:
  3` still covers all five mandatory lenses via merging — asserted); trivial-run lens
  merging keeps the guardrail lens (asserted); surviving spec/contract findings ⇒ that
  round's quality-lens findings are discarded and re-derived after the fix (adjudication
  ordering asserted); skeptic verdicts per Task 1.3's `findingSurvives` rule (k=2 tie
  upholds); **routing by path (§3.3): a finding whose fix touches `fileScope` dispatches
  an implementer; a test-adequacy finding dispatches a TEST-WRITER and the changed test
  is re-run and re-vetted before re-validate — asserted, because routing it to the
  implementer produces a guaranteed edit-gate denial and burns every remaining review
  round on a mandatory lens**; implementer pushback routes through one extra skeptic
  round; fix ⇒ re-validate ⇒ re-review bounded, cap ⇒ question + blocked → red →
  implement → green → commit `conductor: 9.5a item review`.

#### Task 9.5b: `conductor_publish` + `conductor_report`

- [ ] Steps: publish in §3.3's order, one test per step: **HEAD mismatch denies** (fixture
  switches branch after validate; every mtime term still passes — the case mtimes cannot
  see); stages `fileScope ∪ testScope` MINUS `run.startDirty` (fixture with a pre-existing
  dirty file inside the item's scope: `"refuse"` denies + writes a question, `"exclude"`
  commits without it and reports it — the resulting commit asserted to contain the item's
  test file and NOT the user's WIP); §2.1 format rules (stdin-mode fixture: dirty file
  rewritten + restaged; crashing formatter ⇒ publish denied, file untouched); auto
  re-verify on stale freshness with the same exclusion rule as validate, **and a FAILING
  re-verify drops the item to GREEN with `debugging` set rather than looping**; the
  generated message is template-built and rejected if it carries any §3.3 denylist trailer
  (generator-side test); read-only and no-git modes write the batch into the report
  instead. Report: re-runs the full verify fresh WITH the exclusion list, accepts
  PUBLISHED/blocked/deferred items and REFUSES only on an item that is none of the three,
  writes report.md containing taints + blocked + deferred + open questions + exclusions +
  metrics (via Task 7.2's router client, stubbed), records stop `done`; trivial run ⇒
  report-lite → TRIVIAL_DONE → red → implement → green →
  commit `conductor: 9.5b publish + report`.

#### Task 9.5c: stop-reports + `conductor_inline_claim` + `conductor_override`

- [ ] Steps: **the stop-report path (§2.9): a run that records `noop`, `blocked`,
  `surfaced`, `env`, or `interrupt` writes report.md in stop-report mode with the stop
  kind as its headline, the per-item dispositions, the open questions, and any newly
  registered stale-red files — and runs NO closing verify** (five tests, one per kind;
  this is the artifact the wedged runs previously did not produce); inline_claim scopes
  edit permission (gate integration asserted) and records the decision; override records
  anomaly + taint + one-shot bypass, the second action in the same session is re-denied,
  **and exceeding `maxOverridesPerItem`/`maxOverridesPerRun` records an `env` stop with a
  stop-report instead of granting** → red → implement → green →
  commit `conductor: 9.5c stop reports + hatches`.

#### Task 9.6: `adapter/worktrees.ts` + parallel-writes integration

**Interfaces:** `createWorktree(workspace, runId, itemId) → path` (`git worktree add
<stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId>` — **outside the repo**,
§4.2: a worktree inside the repo is a second copy of every test file, which the main
tree's whole-tree runner then discovers and executes, including other items' in-progress
red tests); `mergeBack(workspace, itemId) → {ok, conflict}`
(ff-only first, else a normal merge, executed by the handler); `removeWorktree(…)`.
Integration (per §4.2): under `parallel.writes: "worktrees"`, `conductor_dispatch_wave`
creates a worktree per wave implementer; the session registry binds that implementer's
edit scope to paths under its worktree; `evidence.runVerify` runs with `cwd` = the
worktree (per-tree markers, Task 6.1); `conductor_publish` under worktree mode runs its
stage/format/freshness/commit sequence with `cwd` = the item's worktree (same generated
message + trailer denylist), then merges back serially in item order and re-validates
each item against the integrated tree (`cwd` = workspace) before PUBLISHED; a merge
conflict demotes the later item to GREEN for re-validation.

- [ ] Steps: failing tests on fixture repos (create/remove round-trip; **the worktree
  path is outside the repo root and the main tree's verify provably does not execute the
  worktree's copy of a test** — witness file, the Task 6.2 hazard closed by construction;
  disjoint-scope ff merge; contrived conflict ⇒ demotion to GREEN asserted; post-merge
  re-validate provably runs in the integrated tree (witness file written by the fixture
  verify command); per-tree verify markers — a running verify in tree A does not freeze
  edits in tree B (gate integration); registry scope binding to worktree paths;
  worktree cleanup on run archive, and `git worktree prune` after a crashed run) → red →
  implement → green → commit `conductor: 9.6 worktree mode`.

---

### Phase 10 — Continuation + ask-gate

#### Task 10.1: `adapter/continuation.ts` + ask-gate wiring

- [ ] Steps: failing tests (idle on active run with a recommended action ⇒ exactly one
  re-prompt naming that action (fake SDK asserts prompt text matches
  `legalTools(...).recommended`); debounce; identical state signature ⇒ futile counter
  increments, any state change resets it; `futileRePrompts` reaching 3 ⇒ stop `noop` +
  `disengage` anomaly + **stop-report written** and re-prompting stops (the single wedge
  detector — Task 1.3's rule, no separate env path); halt file ⇒ interrupt + stop-report,
  no re-prompt; **`isTerminal` runs are never re-prompted, including EXECUTING-with-stop**
  (§2.3 — the earlier list of three terminal states missed exactly this case); a
  sub-session `permission.asked` event ⇒ `permission.reply` reject + NEEDS_CONTEXT
  conversion surfaced to the orchestrator; an orchestrator edit ask WITH an active inline
  claim covering the path ⇒ replied allow, WITHOUT ⇒ replied reject (§3.6); an
  orchestrator question journaled with Task 1.5's isHumanTerritory verdict)
  → red → implement → green → commit `conductor: 10.1 continuation + ask gate`.

---

### Phase 11 — llama-router (C++)

CMake restructure first, then module-by-module TDD with doctest. All router unit tests
run against in-process fakes (a stub upstream `httplib::Server` started by the test on
an ephemeral port); no model, no llama-server needed until the smoke task.

#### Task 11.1: Build scaffold + upstream contract check

- [ ] **Step 1:** CMakeLists: remove target `myprogram`; add `llama-router` (src/router —
  `main`, `router`, `admission`, `affinity`, `schema-observer`, `metrics`, `config`;
  links cpp-httplib nlohmann-json json-schema-validator spdlog), `router-tests`
  (doctest, registered with ctest), optional `conductor-dashboard` (ftxui, OFF by
  default). vcpkg.json += `cpp-httplib`, `nlohmann-json`, `json-schema-validator`,
  `doctest`. A trivial doctest case builds and runs green via ctest. Also add
  `conductor/tools/export-schemas.ts` — a dev/test-time script (NOT a plugin build
  step; G1 untouched) that writes the §2 JSON Schemas from `core/types.ts` into
  `src/router-tests/schemas/`; invoked by `scripts/test-conductor.sh` and as a
  pre-build step of the router-tests CMake target, with a TS test asserting the
  exported files parse and match the schema names Task 11.6 consumes.
- [ ] **Step 2:** Against the LIVE llama-server this repo serves (`scripts/serve.py
  --no-shell` in a test harness, `qwen3.6-27b`), verify and record in
  `src/router/UPSTREAM_CONTRACT.md` (`WIRE_CONTRACT_VERIFIED: <date> …`): the
  `/v1/models` shape in router mode; `response_format`/`json_schema` acceptance and
  GBNF constraining (send a schema'd request, confirm conforming output); `usage` +
  `timings` fields present in non-stream responses; SSE chunk framing for streamed;
  behavior on requesting a non-resident model (router-mode autoload semantics — load
  latency visible); **the effective concurrent slot count** — issue N concurrent trivial
  completions for N ∈ {1,2,4,8} with and without `--parallel`, and record where latency
  starts scaling linearly with N. That number is what `parallel.maxReaders` and
  `admission.maxInflightPerModel` must respect; if it is 1, every "6 reviewers in
  parallel" claim in §4 is false and serve.py must set `--parallel` (Task 12.1) before
  any of this matters. This is a MANUAL-run task step (documented command lines), not a
  ctest.
- [ ] **Step 3:** Commit: `conductor: 11.1 router scaffold + upstream contract`.

#### Task 11.2: `config` + logging

- [ ] Steps: doctest red (config parse of §2.2 verbatim; defaults; reject unknown keys,
  bad ports; spdlog level applied) → implement → green →
  commit `conductor: 11.2 router config`.

#### Task 11.3: `router` — proxy pass-through

- [ ] Steps: doctest red against stub upstream (POST /v1/chat/completions body+headers
  forwarded verbatim, response verbatim incl. status; SSE: chunks arrive incrementally
  (stub emits two chunks with a delay; test asserts first chunk observed before second
  sent — readiness poll, no sleeps); non-/v1 404; upstream down ⇒ 502 JSON error; IF
  Task 0.2 pinned the `x_conductor` body-field fallback for tagging, the router
  extracts the tags from that field and STRIPS it before proxying — doctest for
  extraction + stripping; with working `chat.headers` the field never appears and the
  header path is the only one exercised) →
  implement (httplib server + client, streaming via content provider/receiver) →
  green → commit `conductor: 11.3 proxy`.

#### Task 11.4: `admission`

- [ ] Steps: doctest red (cap 2: third request queues (stub upstream holds requests
  open until released by the test); priority dequeue order interactive<review<batch;
  FIFO within class; queue timeout ⇒ 503 envelope; maxQueued overflow ⇒ 503;
  per-model independence: model B request passes while A is capped; at a FULL queue
  the `/conductor/health` endpoint still answers — the pool-exhaustion test) →
  implement (mutex+condvar around per-model counters and a priority queue; queued
  requests block their handler thread, so the server's task queue is explicitly sized
  at startup via `svr.new_task_queue`: threads ≥ maxQueued + Σ maxInflightPerModel +
  8 margin, and config validation clamps `maxQueued` when the arithmetic exceeds a
  sane thread budget — httplib's default pool would starve under exactly the fan-out
  load this system generates) → green → commit `conductor: 11.4 admission`.

#### Task 11.5: `affinity` — prefix-group ordering

Swap batching is **not** built: under G13 one model serves every role, so there is
nothing to batch and a batcher would be untestable dead weight carrying a fake clock.
It moves to §10 stretch alongside per-role model routing, which is the only thing that
would make it pay.

- [ ] Steps: doctest red (same-`X-Conductor-Group` requests dequeue contiguously among
  queued requests; groups interleave fairly rather than starving — a low-priority group
  still drains; ordering is stable under arrival jitter; untagged requests never jump the
  queue) → implement → green → commit `conductor: 11.5 group affinity`.

#### Task 11.6: `schema-observer`

Scope depends on Task 0.2's streaming finding (§4.4). If fan-out traffic streams, response
observation sees nothing and this task shrinks to the request-side counter plus a recorded
note; that is a scoping decision made before the C++ is written, not discovered during it.

- [ ] Steps: doctest red (**a tagged request WITHOUT response_format/grammar is proxied
  unchanged and counted `schemaMissing` — it is NOT rejected**, which is the whole point:
  the router must never fail a request the direct path would have served, or G5's
  fail-soft direction inverts and `--no-router` stops being equivalent; untagged passes
  untouched; tagged non-stream response validated with the verdict recorded in metrics and
  the body returned **verbatim** whether it conformed or not; streaming tagged responses
  pass through with the verdict recorded as null — stream validation is out of scope and
  recorded in HONEST-LIMITS; `rejectOnMissing:true` (non-default) does 400, and a test
  asserts the shipped default config has it false) → implement (json-schema-validator) →
  green → commit `conductor: 11.6 schema observer`.

#### Task 11.7: `metrics`

- [ ] Steps: doctest red (one JSONL line per request with §4.4's fields incl.
  queue-wait, usage token counts parsed from the upstream body, and the
  `schemaMissing`/`schemaConformed` observations from Task 11.6; /conductor/metrics
  aggregates (count, p50/p95 wait, token totals, schema-conformance rate — the POC's
  second dataset); /conductor/health) → implement → green →
  commit `conductor: 11.7 metrics`.

#### Task 11.8: Live smoke (manual-run, documented)

- [ ] **Step 1:** With serve.py's server up: run llama-router against it; drive one
  schema'd request through `curl`; confirm constrained output, a metrics line, and
  the dashboard (if built) rendering. Record results in UPSTREAM_CONTRACT.md.
- [ ] **Step 2:** Commit: `conductor: 11.8 router live smoke`.

---

### Phase 12 — Wiring (serve.py travel)

#### Task 12.1: Router launch + config generation in serve.py

- [ ] Steps: `unittest` red (pure functions extracted into
  `scripts/conductor_wiring.py` so they're testable without serving: router config
  generation from chosen host/port; **`--parallel` derivation — the llama-server command
  gains `--parallel <slots>` computed from `parallel.maxReaders`, and the generated
  router config's `maxInflightPerModel` is derived from the SAME number so the two can
  never drift** (without this the whole read fan-out may serialize upstream while
  admission control cheerfully admits four at a time); opencode fragment merge — deep
  merge, conductor keys win, `${LLAMA_HARNESS_ROOT}` substitution, baseURL rewrite to
  the router port when router enabled; `--no-router` leaves baseURL direct; supervisor
  backoff policy — a pure function: restart delays capped-exponential, reset on a healthy
  run) → implement: serve.py gains `--router/--no-router` (default: router when the
  binary exists) and launches llama-router under a small supervisor loop process
  (serve.py itself execs into the session shell and cannot supervise; the supervisor dies
  with the shell like the existing server watchdog), merges the fragment into the session
  opencode config it already writes; fetch_models' `config` subcommand regenerates the
  fragment-aware base config → green → commit `conductor: 12.1 serve wiring`.
- [ ] **G5 equivalence step (do not skip):** run Task 13.1's scripted e2e twice — once
  with the router in the loop, once with `--no-router` — and assert the same terminal
  state, the same item dispositions, and the same commit set. "The identical process
  runs without the router" is a claim this plan makes in five places; this is the one
  test that makes it true rather than aspirational.

#### Task 12.2: First-run repo setup flow

- [ ] Steps: red (unit: detection matrix package.json/CMake+ctest/pyproject/Cargo/go →
  proposed scopes, each detected runner carrying its default `itemTest` template
  (§2.1: `node --test {files}`; `pytest {files}`; `ctest -R {name}`; **`go test {dirs}`**
  — package-dir targeting, since `-run` matches test *function* names and silently exits
  0 with zero tests when handed file basenames; §2.1 was corrected for this and this task
  had not been) **and its proposed `behavioralPaths`**; smoke-spawn check fails on
  unspawnable command; **the §2.1 setup proof table, one test each: `models.default`
  absent from a stubbed `/v1/models` fails setup naming the model; a schema-constrained
  probe request that comes back unconstrained fails setup; an observed slot count below
  `parallel.maxReaders` fails setup with the `--parallel` remedy named**; the two
  questions with NO default (git mode, `behavioralPaths` confirmation) are surfaced as
  the sanctioned interactive asks; **`isRepo` false ⇒ the no-git-mode offer (§3.9), and a
  no-git config disables publish and worktrees and skips exclude registration**;
  `.git/info/exclude` registration otherwise; `reconfigure:true` re-runs setup only with
  no live run and journals a config diff) → implement (plugin-side: `adapter/state.ts`
  first-run path + the `conductor_setup` tool — already in the §3.4 inventory, legal
  while config is absent via Task 3.2's `repoConfigured` input or with `reconfigure`, and
  named by the Task 8.2 injection as the next action) → green →
  commit `conductor: 12.2 first-run setup`.

---

### Phase 13 — End-to-end acceptance

#### Task 13.1: Scripted e2e (no model): the full pipeline on a fixture repo

- [ ] **Step 1:** `conductor/tests/e2e.test.ts` — drives the REAL plugin hooks + REAL
  handlers + REAL state/evidence/journal against a fixture git repo with a real (tiny)
  Node test suite, using the FAKE SDK programmed with realistic canned outputs for
  every sub-session in sequence: classify(work) → decompose(2 items, disjoint scopes)
  → plan → plan review (1 major, refuted; 1 major upheld → revision → clean round) →
  wave dispatch → I1 (**greenfield**: its first test imports a module that does not exist
  yet ⇒ `missing-subject` ⇒ legal red, exercising §2.6.1 end-to-end; a later attempt with
  a genuine syntax error ⇒ `error` ⇒ repaired) → vetted (1 mustFix → fixed) → green →
  validated → review (1 spec finding upheld → fix; 1 test-adequacy finding upheld →
  **routed to the test-writer, re-vetted** → re-validate → clean) → published (REAL git
  commit in the fixture; message asserted trailer-free; commit content asserted to
  include the item's test file and to EXCLUDE a pre-existing dirty file inside the item's
  scope) → I2 same compressed → report (REAL full verify runs; report content asserted:
  taints/deferred/exclusions/questions, metrics present) → stop done. Along the way: an
  out-of-order tool call denied; an orchestrator edit denied; an edit during validate
  denied (including a test-file edit — the freeze reading that matters); a sub-agent
  spawn denied; an unregistered session's write denied; an override exercised once and
  visible in the report.

  **Scenario 2 — trivial:** classifies trivial (with a full `trivialItem`) and rides
  EXECUTING(trivial) through the full item FSM (merged lenses, guardrail lens present) to
  report-lite → TRIVIAL_DONE.

  **Scenario 3 — worktrees:** a two-item wave under `parallel.writes: "worktrees"`
  (Task 9.6 integration: both implement concurrently in OUT-OF-REPO worktrees, serial
  merge-back, post-merge re-validation), with the wave driver's interleaving asserted.

  **Scenario 4 — non-behavioral:** a docs-only item (`behavioral:false`) walks
  PENDING→GREEN→VALIDATED→REVIEWED→PUBLISHED with no test ever written; a second item
  attempting `behavioral:false` over `src/**` is REJECTED at decompose naming the
  intersecting glob. The change shape that previously had no legal trajectory, plus the
  arithmetic that keeps it from becoming a TDD bypass.

  **Scenario 5 — the bad ending:** an item blocks (test repair exhausted), report refuses,
  the continuation engine re-prompts three times futilely, the run stops `noop` — and a
  **stop-report is written** naming the blocked item, its question id, and the test file
  newly added to the stale-red registry. Then a SECOND run in the same fixture repo runs
  and its first validate **passes**, proving the leftover red test was excluded and
  disclosed. Previously this scenario produced silence and a repo that poisoned every
  later run.
- [ ] **Step 2:** Red → glue fixes → green (this is the harness proving itself).
- [ ] **Step 3:** Commit: `conductor: 13.1 e2e scripted`.

#### Task 13.2: Live smoke (real opencode + smallest real model; manual-run, documented)

- [ ] **Step 1:** `scripts/serve.py` (router on, `qwen3.6-27b`), `cd` to a scratch repo,
  run opencode with a toy prompt ("add a slugify util with tests" — deliberately
  greenfield, the shape that the pre-`missing-subject` design could not complete at all).
  Observe and record in `conductor/SMOKE.md`: the conductor banner (§3.8), classification,
  decomposition, plan review round-trip, item TDD cycle with real model outputs surviving
  schema validation (note retry counts — this is the local-model-vs-schema stress test),
  publish commit, report, idle continuation firing at least once, `conductor_status`
  output. Then a deliberately non-testable second prompt ("fix the typo in the README")
  to exercise the non-behavioral path against a real model.
- [ ] **Step 2:** Fix what breaks (each fix lands as its own red→green task-let with a
  test at the layer that failed). Commit: `conductor: 13.2 live smoke`.

---

### Phase 14 — POC evaluation (the point of all this)

#### Task 14.1: `scripts/conductor_bench.py`

- [ ] Steps: red (unit tests on the pure parts: task manifest load; result schema;
  scoring pass-through; arm construction; aggregation incl. per-task spread; every
  manifest entry parses and its hidden test command is spawnable) → implement:

  **(a)** author `bench/conductor-tasks.json` — 10 tasks with stated selection criteria:
  language mix (TS, Python, C++), difficulty spread from one-function to small-multi-file,
  at least two non-behavioral (docs/comment) tasks so that path is measured too, each with
  a hidden test command that FAILS on an unmodified repo and is never shown to the model.

  **(b)** the driver: **three arms × 3 repetitions × 10 tasks = 90 headless runs**
  (`opencode run`), all through the router so token accounting is uniform:

  | Arm | What it isolates |
  |---|---|
  | `baseline` | plain opencode, same model, no plugin |
  | `doctrine` | the doctrine packs injected as a system prompt, no gates, no fan-out, no FSM |
  | `conductor` | the full pipeline |

  Collects per run: hidden-test pass/fail, wall-clock, total tokens, schema-retry counts,
  review findings caught, overrides used, terminal stop kind. Emits
  `.data/benchmark/conductor-report.md` with per-task pass rates **and their spread across
  repetitions**, never a bare aggregate delta → green → commit `conductor: 14.1 bench
  driver`.

  **Why three arms and three repetitions.** Two arms measured process-plus-model-mix
  against a single model and called the difference "process"; G13 removes that confound
  by construction (every arm now runs `qwen3.6-27b`), and the `doctrine` arm removes the
  other one — the cheap intervention (better prompting) and the expensive one (gates,
  FSM, adversarial fan-out) are separable, and the honest question a reader will ask is
  "how much of this did I need to build?". Repetitions exist because sampling at
  temperature 0.4–0.7 makes a single 6/10-vs-4/10 comparison indistinguishable from noise
  at exactly the resolution this experiment produces. 90 runs is the cost of an answer
  rather than an anecdote; it is a known, budgeted cost, decided before the build rather
  than discovered after it.

#### Task 14.2: The POC run (manual)

- [ ] **Step 1:** Execute the three-arm comparison on this machine with `qwen3.6-27b`;
  commit the report. This number — quality delta vs token/wall-clock cost, with the
  doctrine-only arm separating prompting from enforcement — is the POC's deliverable.
  Report per-task pass rates with spread, and state plainly where the arms are within
  noise of each other. Commit: `conductor: 14.2 POC run`.

---

### Phase 15 — Ops docs, dashboard, closeout

#### Task 15.0: `conductor/tools/replay.ts`

- [ ] Steps: failing tests on a fixture journal (pure render functions: journal lines →
  per-item swimlane rows; gate denials highlighted; fan-out duration table; review
  verdict table; `--component`/`--level`/`--item` filtering) → red → implement (pure
  renderers in the module, a thin argv/stdout shell at the bottom) → green →
  commit `conductor: 15.0 replay tool`.

#### Task 15.1: `conductor/docs/OPERATIONS.md` + `HONEST-LIMITS.md`

- [ ] Steps: write OPERATIONS (how to serve with/without router; read a run dir; drive
  replay.ts; halt a run (create `.conductor/state/halt`); tune verbosity; edit
  doctrine; exit-code and error-envelope tables; troubleshooting: "publish denied
  stale" ⇒ edits after verify started, re-validate; "sub-session env-failed" ⇒ check
  schema retries in journal; "run disengaged" ⇒ read the futile re-prompt journal
  entries) and HONEST-LIMITS verbatim from §9 → commit `conductor: 15.1 ops docs`.

#### Task 15.2: `src/dashboard` (ftxui, optional target)

- [ ] Steps: doctest red on the pure ledger-aggregation functions → implement the TUI
  (tail metrics ledger; in-flight/queue lanes; group-affinity and schema-conformance
  markers) → green →
  commit `conductor: 15.2 dashboard`.

---

## §9. Honest limits (normative; copied into HONEST-LIMITS.md by Task 15.1)

1. **Gates fire inside opencode.** A human terminal, or any process outside the plugin's
   sight, is ungated. Operational security is out of scope.
2. **No pre-emptive turn-end gate exists in opencode.** Continuation is idle-driven
   re-entry (§3.7); between the turn ending and the re-prompt, the model has "stopped".
   The disengage backstop bounds the failure mode; upstream FR noted.
3. **Ledgers are records, not proofs** — but every FSM-advancing record is written by a
   handler that re-derived the evidence itself (G6); the model's only fabrication path
   is `conductor_override`, which is loud, tainted, and reported.
4. **The schema guard validates non-streaming JSON only.** Streamed structured outputs
   pass with a warning; the fan-out engine's receipt-validation covers them (G5's
   two-layer posture).
5. **Model quality is a floor, not a gate.** A 27B reviewer upholding garbage findings
   costs fix-loop rounds; the skeptic layer and round caps bound the damage, and the
   bench (Phase 14) measures it instead of assuming it away.
6. **`scopesIntersect` is conservative.** False positives serialize work that could
   have parallelized; they never corrupt. Declared scopes can still LIE (an implementer
   editing outside its scope is denied, but a scope declared too wide serializes
   honestly).
7. **Verify trusts the target repo's own test command.** Vacuous tests get vacuous
   protection; the TEST_VETTED stage exists to raise exactly this floor for tests the
   pipeline itself writes.
8. **Two opencode sessions sharing one workspace**: the second gets read-only conductor
   (run-dir lock, Task 4.1; a dead holder's lock is broken automatically); the lock is
   advisory and a human deleting it lies to both sessions.
9. **The router observes; it never enforces.** Its schema check is a recorded
   observation, not a rejection (§4.4) — a request the direct path would have served is
   never failed by the router. Response observation covers non-streaming bodies only, so
   if opencode streams (Task 0.2 determines this), that dataset is empty and the router
   is justified by scheduling and metrics alone.
10. **macOS/Apple Silicon only for the POC** (G12 note); nothing gratuitously breaks
    Linux, nothing verifies it.
11. **Conductor cannot detect its own absence.** If opencode fails to load the plugin,
    every gate in this document is silently absent and the session looks normal. The
    liveness beacon and the session banner (§3.8) make it *visible*; nothing can make it
    *impossible*. First rule of the ops guide: no banner, no conductor.
12. **A second, plain opencode session in the same repo is ungated.** The harness travels
    via `OPENCODE_CONFIG` in the shell `serve.py` spawns; any other terminal running
    `opencode` in that repo has no plugin, takes no lock, and is invisible to the
    conductor session — whose freshness stamps, quarantine moves, and freeze windows are
    then racing an unmanaged writer. (Limit 8 covers two *conductor* sessions, which is
    the benign case.)
13. **In-session interpreters bypass the write-shape extractor.** `node -e`,
    `python -c`, and friends can write files without matching any redirect/tee/sed
    pattern. The edit gate catches shapes, not intent; G7's detection-over-prevention
    posture applies, and the journal records the command either way.
14. **`behavioral:false` is only as honest as `behavioralPaths`.** The path arithmetic is
    mechanical, but the path list is human-confirmed at setup (§2.1). A repo that lists
    `src/**` while keeping logic in `lib/**` has handed the model a legal TDD bypass.
    Setup asks rather than defaults for exactly this reason.
15. **Single-model routing is a POC constraint, not a finding.** G13 makes the quality
    delta attributable to process, and costs whatever a larger reviewer would have added.
    §10's multi-model stretch is how that question gets asked separately.

## §10. Stretch (explicitly OUT of the base build)

- **Per-role model routing + swap batching** (the pair, since neither pays off alone):
  `config.models.roles` populated, the router's `batching` block and batcher module,
  per-model wave barriers made meaningful. Prerequisite: a POC number from Phase 14 to
  compare against, so the added quality is measured rather than assumed. Note the cost
  it re-introduces (§4.1): under `--models-max 1` a role switch is a full weight reload,
  and roles alternate per *stage*, not per wave.
- Mutation-smoke on TEST_VETTED (kill an injected mutant before vetting passes).
- Seal/tamper-evidence over conductor's own files (lower value single-user; the git
  history of this repo is the audit trail).
- Cross-run memory (decision-ledger reuse across runs in a repo).
- Linux support + CI.
- Streaming schema observation in the router.
- Multi-machine fan-out (a second Mac serving a second model).

## §11. Final acceptance checklist

- [ ] `node --test conductor/tests/` — all green, ≥ 24 test files.
- [ ] `bun test conductor/tests/bun-smoke.test.ts` green (G14) — the production runtime
      is exercised, not assumed.
- [ ] `ctest` on router-tests — all green.
- [ ] Purity guard + dual-runtime guard + doctrine tests green (G3, G14, §6 enforced
      mechanically).
- [ ] Scripted e2e (13.1) green — all FIVE scenarios: full pipeline with a greenfield
      red, trivial, worktree wave, non-behavioral item, and the blocked/stop-report/
      next-run-unpoisoned ending.
- [ ] Live smoke (13.2) recorded in SMOKE.md — schema validation survived real
      local-model outputs; retry counts noted; the non-behavioral path exercised.
- [ ] Runner discovery probe (6.2) recorded — the quarantine's out-of-repo location is
      justified by measurement.
- [ ] POC report (14.2) committed: three arms, three repetitions, per-task spread.
- [ ] serve.py: `--router` and `--no-router` both produce working sessions AND the
      e2e equivalence step (12.1) passes (G5).
- [ ] `--parallel` is set from `parallel.maxReaders` and setup's slot probe passes —
      the fan-out is actually parallel upstream.
- [ ] OPERATIONS.md + HONEST-LIMITS.md exist and match §9 (all 15 limits).
- [ ] `git log --oneline` shows one commit per task, each on a green suite.

## §12. Effort & reliability estimate

**Size:** ~37 TS modules+tests, ~6 C++ modules+tests (the batcher is out — §10), 2 Python
modules+tests, 9 doctrine packs, ~70 bite-sized tasks.

**Effort:** a strong frontier agent executing task-by-task: 4–6 focused days; order
8–14M tokens (the increase over the earlier estimate is the Phase 9 split, the extra e2e
scenarios, and the disposition/question machinery — all of which were previously implied
work with nowhere to land). Human involvement: the setup answers (git mode,
`behavioralPaths`), the four manual-run steps (6.2, 11.8, 13.2, 14.2), and reading the
POC report.

**Phase 14 is now the single largest wall-clock line item:** 90 headless runs (3 arms ×
3 repetitions × 10 tasks) on a local 27B. Budget it as its own overnight, and expect the
run to surface bugs the scripted e2e could not — that is what it is for.

**Reliability, honestly:** TS core+gates+pipeline against the fake SDK: ~90% first-pass
(the wire contract is pinned by Task 0.2 before anything depends on it). Live-opencode
behavior: ~75–85% first-pass — the risk concentrates in plugin-loading via config path,
`{file:…}` prompt resolution, structured-output field naming, per-agent tool disablement,
and plugin-init failure semantics, ALL routed through Task 0.2's discovery test so drift
fails loudly at build time, not silently at runtime. Router: ~85% (httplib streaming edge
cases are the residue). Local-model schema compliance under GBNF constraint is the POC's
open question — that is what Phase 14 measures rather than promises. The two mechanisms
carrying the most residual risk are the ones with the least prior art here: the wave
driver's concurrency (Task 9.4c) and the quarantine/restore lifecycle (Task 6.1) — both
now have out-of-repo simplifications and witness-file tests that make their failures
loud rather than subtle.

## §13. Self-review record (authoring time)

- **Requirement coverage:** TDD-per-change with test-correctness vetting (§3.3
  RED/TEST_VETTED), adversarial parallel reviews after each item (§3.3 REVIEWED) and of
  the plan (§3.2), orchestrator-not-agent posture with inline escape (§0.5, G8, §3.6),
  automatic decomposition on every prompt with per-prompt ephemeral queue (§3.2, §2.4),
  parallelism wherever profitable with wall-clock engineering (§4, router), full
  task-breakdown/analysis/design/plan/iterative-plan-review frontloading (§3.2
  DECOMPOSED→PLAN_REVIEWED), logging with verbosity for debuggability (§7),
  multi-option decision records à la brainstorming (§6.2, §2.7), superpowers carried
  over as always-on doctrine+enforcement (§6.1), ponytail carried over with intensity
  modes and guardrails (§6.3), C++ layer on llama.cpp for scheduling/wire integrity
  (§4.4), POC measurement (Phase 14). — covered.
- **Consistency:** state vocabularies identical in §2.3/§2.5, §3.1/§3.3, fsm tests
  (3.1), gates-phase (3.2), injection (8.2); tool inventory identical in §3.4 and Phase
  9 tasks; schema names identical in §2.10, types.ts (1.1), fan-out (7.1), router
  schema-observer (11.6); config keys in §2.1 consumed by named tasks only. *(Revision 5
  extends this audit: every §2.1 config key added in Round 5 — the override budget,
  `branchPolicy`, `preexistingDirty`, `retention`, `vetMaxRounds`, `testRepairAttempts`,
  `models.default` — names its consuming task above, and every ledger added in §2.11
  names its writer, its reader, and its test.)*
- **G6 audit:** every ledger names writer + reader + exercising test (evidence: 6.1
  writer, publish/report readers, 9.5 tests; decisions: 9.1 writer, report reader;
  anomalies: gates/override writers, report reader; journal: all, replay reader).
- **Known-weak points, routed to discovery rather than assumed:** opencode plugin-path
  loading, `{file:}` refs, structured-output field name (Task 0.2); llama-server
  router-mode autoload + schema fields (Task 11.1); local-model schema compliance
  (Phase 14 measures).

## §14. Adversarial review record (authoring time, 2026-08-07)

The draft of this plan was reviewed by 7 parallel independent reviewers with distinct
lenses (internal consistency; opencode API correctness against the installed 1.18.10
binary and docs; C++/llama.cpp feasibility against this repo's real build files and
scripts; process fidelity against the actual superpowers/ponytail sources;
completeness against the commissioning requirements; plan-quality/placeholder scan;
scheduling & concurrency hazards), with every major finding independently attacked by
2 skeptics before counting (83 agents total). Results: 29 upheld majors (deduplicating
to 14 distinct defects), 21 minors, 9 claims refuted. All upheld findings were fixed in
this revision:

1. **Trivial path was unimplementable** (4 independent confirmations) — now: trivial
   enters EXECUTING flagged trivial with one synthesized item; `conductor_report`
   report-lites to TRIVIAL_DONE; FSM/legality/test matrices updated (§3.1/§3.2/§3.4,
   Tasks 3.1/3.2/9.1/13.1).
2. **Finding-survival rule self-contradictory at K=2** (4×) — now one rule everywhere:
   survives iff upholds ≥ ⌈K/2⌉, ties uphold (§2.1, §3.3, Task 1.3).
3. **`permission.ask` hook is typed but never dispatched by opencode 1.18.10** —
   ask-gate and inline-claim redesigned onto static agent permissions + the
   `permission.asked` bus event + `client.permission.reply`; Task 0.2 asserts the
   non-dispatch (§3.5, §3.6, §5.1–§5.4, Task 10.1).
4. **Inline claim could not lift an agent-level hard deny** — orchestrator `edit` is
   now `"ask"`, adjudicated by the plugin against active claims (§3.6, §5.3).
5. **Four specified modules had no creating task** — added Task 1.5 (decide.ts), Task
   7.2 (router-client.ts), Task 9.6 (worktrees.ts + integration), Task 15.0
   (replay.ts).
6. **noop vs disengage metered the same counter, one unreachable** (4×) — collapsed to
   a single wedge detector: futileRePrompts ≥ 3 ⇒ stop `noop` + `disengage` anomaly
   (§2.3, §2.8, §2.9, §3.7, Tasks 1.3/10.1).
7. **Format-rule semantics and the trailer denylist were dangling references** — both
   defined normatively (§2.1 format block; §3.3 denylist).
8. **Test paths were undefined** — items now carry `testScope`, decompose rejects
   empty ones, the edit gate consumes it (§2.4, Tasks 1.1/5.2/9.4).
9. **Guardrail/minimality lenses truncated away at defaults; trivial dropped them
   entirely** (2×) — mandatory five-lens set never truncated; trivial merges lenses
   instead of dropping; `itemReviewers` default 6 (§2.1, §3.2, §3.3, §6.3, Task 9.5).
10. **Router thread-pool starvation under its own defaults** — explicit
    `svr.new_task_queue` sizing from config arithmetic + pool-exhaustion doctest
    (Task 11.4).
11. **Run-dir lock had no stale-holder recovery** — dead-pid takeover with anomaly,
    mirroring the verify-marker rule (Task 4.1).
12. **Worktree mode's interfaces were workspace-rooted** — gitio and runVerify take
    explicit `cwd`; verify markers are per-tree; freeze is per-tree (Tasks 4.2/6.1/
    5.2/9.6).
13. **`conductor_setup` was absent from the tool inventory and legality source** —
    added to §3.4; `legalTools` gained `repoConfigured` (Tasks 3.2/8.2/12.2).
14. **Implementer BLOCKED protocol dropped the source's re-split escalation** —
    restored: context → model → re-split via queue_amend → human (§3.3, Task 9.4).

All 21 minors were also applied (layout omissions: journal-events.ts, tools/, bench/,
router-tests/schemas/; Task 14.2 promoted to a real task; `requirePathspecCommits`
deleted as unconsumed; inert `"write"` permission key removed; serve.py supervision
respecified honestly as a supervisor loop; two-stage review wording made honest
(parallel dispatch, staged adjudication); FINDINGS verdict semantics stated (empty
array = approval); classification check embedded in run.json; `subSessionTimeoutMs`
added; schema-export script named and wired; chat.headers fallback pinned; bench
manifest authoring step added with selection criteria).

**Round 2** (3 focused lenses + 2 skeptics per major, 21 agents) re-reviewed the fixed
document and found 9 upheld majors (7 distinct) plus 15 minors — all applied in this
revision: classify(work) now stays in INTAKE with the classification recorded and
`conductor_decompose` owns INTAKE→DECOMPOSED (`legalTools` reads run.classification);
`conductor_dispatch_wave`'s first call owns PLAN_REVIEWED→EXECUTING;
`conductor_queue_amend` moved to Task 9.4 (its consumer's task) fixing a forward
dependency; sub-agent `question` permission changed from `"deny"` to `"ask"` so the
`permission.asked` adjudication path actually fires (the same hard-deny-never-asks
logic as the orchestrator's edit permission); publish now stages fileScope ∪ testScope
so the tests ship in the item's commit (asserted in 9.5/13.1); the CLASSIFICATION
schema gained proposedFileScope/proposedTestScope as the trivial synthesis data source;
per-item test commands are derived from a per-scope `itemTest` template with a
per-runner detection default and an illegal-red fallback rule; plus the minors
(tree-relative path normalization for worktree edit gating; x_conductor router-side
extraction task; fragment authoring step; §1.1 layout completions; run-creation and
mid-run-prompt rules; the general lens-merging rule; shouldTerminate's itemsSummary
input; G8 rewording; worktree publish composition; diagram back-edge removed in favor
of the handler-internal revision loop).

**Round 3** (2 lenses, both-skeptics-must-uphold bar, 8 agents) found 3 residual
majors, all applied: the `{name}` template placeholder got its substitution rule
(basename-alternation regex over the item's testScope files — §2.1, Task 6.1);
§2.9's `shouldTerminate` signature caught up with Task 1.3's `itemsSummary` form; and
the shared-tree wave-overlap hazard — a sibling item's deliberately-red test poisoning
another item's full verify — is closed by the quarantine rule (`runVerify
excludeTestFiles`: sub-GREEN wave siblings' testScope files are moved aside for the
verify and restored, crash-safe via manifest; §4.2, Tasks 6.1/9.4/9.5).

**Round 4** (closeout verification, 9 agents) found 4 residual defects in the Round-3
fixes, all applied in this final revision: quarantine membership widened from wave
siblings to every OTHER queue item below GREEN (a blocked prior-wave item's red test
lingers too); `conductor_report`'s closing verify gained the same exclusion with
disclosure in report.md (report is legal with blocked items); the quarantine now also
covers `runTest`'s no-template fallback (two fallback items in one wave would
otherwise livelock each other's GREEN); and the go default was corrected to
package-dir targeting (`go test {dirs}` — `-run` matches test function names, not
file basenames; empirically reproduced exiting 0 with zero tests run) with a
zero-test guard added for all targeted runs (ctest has the same silent-zero failure
mode). **Iteration was stopped here by the commissioning user after four rounds
(29 → 9 → 3 → 4 upheld findings); the Round-4 fixes have not themselves been
re-reviewed** — the implementing agent should treat the quarantine/targeting
machinery (§2.1 itemTest block, §4.2 quarantine rule, Tasks 6.1/9.4/9.5) with
proportionate suspicion during its own red→green cycles.

Notable refuted claims (kept as designed, with the refutation reasoning): item-FSM
BLOCKED/DEBUG as annotations rather than states (deliberate — blockage lives on the
run/queue, DEBUG is a doctrine sub-state); llama-server single-slot concern (the
vendored llama.cpp's router mode does not pin n_parallel=1 as claimed); freeze-scope
"three incompatible specs" (the specs interlock); admission/batcher composed livelock
(priority is per-model-queue; the batcher owns cross-model order); watchdog-abort
cleanup gap (dispatch never mutates FSM state, so there is nothing to roll back —
the item simply re-dispatches).

**Round 5** (2026-08-12) — a full-document adversarial audit (recorded separately in
`docs/reviews/2026-08-12-conductor-plan-adversarial-review.md`) plus the commissioning
user's decision to serve **one model for all roles**. Findings were graded 7 critical,
10 high, 13 medium, 8 low; all are applied in this revision. The critical seven, and what
each actually was:

1. **Greenfield TDD was impossible.** RED demanded `failureClass:"assertion"`, but the
   first test for any new module fails to *import* that module — classified `error` by
   the plan's own default regex — and the test-writer is scope-barred from creating it.
   Task 13.2's own smoke prompt ("add a slugify util") would have deadlocked. Fixed by
   the third failure class `missing-subject` (§2.6.1), legal only when the unresolved
   subject resolves inside the item's `fileScope` (§3.3, Tasks 1.3/6.1/9.4a/13.1).
2. **"Blocked", "deferred" and "surfaced question" had no representation.** Six
   subsystems read them; no schema, field, or ledger held them — and the report's
   refusal rule plus the futile-re-prompt detector turned one stuck item into a silent
   `noop` with no artifact at all. Fixed by §2.5's disposition fields, §2.11's question
   ledger, `conductor_answer`/`conductor_defer`, and §2.9's rule that **every** stop
   writes a report (Tasks 1.3/4.1/9.1/9.3/9.5c/10.1/13.1).
3. **Freeze and wave overlap contradicted each other.** §4.2's quarantine safety argument
   required freeze to block test-file writes; §4.2's parallelism claim required it not
   to. Resolved strictly (freeze covers every file in the tree) and made *scheduling* —
   the fan-out engine holds write-capable dispatches for a frozen tree rather than
   letting them fail on first write (§3.5, §4.2, Tasks 5.2/7.1).
4. **Quarantine and worktrees lived inside the repo**, where the target's own whole-tree
   test runner re-discovers them — defeating the quarantine and double-running worktree
   tests. Both moved outside the repository (§1.2, §4.2, Tasks 6.1/9.6), with Task 6.2
   measuring per-runner discovery so the choice is documented rather than folkloric.
5. **Test-adequacy findings were unfixable.** A mandatory lens routed its findings to the
   implementer, which the edit gate bars from test files — three wasted review rounds,
   then a question. Fixed by routing findings by the paths their fix touches, with
   re-vetting of any changed test so the routing cannot become a way to weaken a test
   (§3.3, Task 9.5a).
6. **The execution loop was ambiguous.** Whether `conductor_dispatch_wave` was a marker
   or a driver was unresolvable from the text, and the marker reading made cross-item
   overlap depend on the model emitting parallel tool calls — the exact dependency §0.2
   refuses. `dispatch_wave` is now normatively the driver (§3.2, §4.2, Task 9.4c), and
   "the ONE legal next tool" — false for any multi-item wave, and specified against in
   three subsystems — is replaced by a legal set plus one deterministic recommendation
   (§3.1, Tasks 3.2/8.2).
7. **The trivial path could not build a valid item, and non-testable work had no path.**
   CLASSIFICATION carried scopes but not `acceptance` or the ponytail record, so trivial
   synthesis had to fabricate the evidence it then checked; and every item required a
   failing assertion, which "fix this typo" cannot produce. Fixed by CLASSIFICATION's
   full `trivialItem` (§2.10) and the `behavioral:false` path gated on
   `fileScope ∩ behavioralPaths = ∅` (§2.4, §3.3, Tasks 9.1/9.2/13.1).

The ten highs, in one line each: cross-run stale red tests poisoning later runs (§2.11
registry); the git matrix's missing default and missing `apply`/`worktree`/`update-ref`/…
rows (§3.5, Task 5.1); three silent-bypass paths — unregistered sessions, model-spawned
sub-agents, and a plugin that fails to load (§3.5's registry gate, §3.8's beacon, §9.11);
publish sweeping the user's pre-existing dirty files into a conductor commit (§2.3
`startDirty`, §3.3); a branch switch between validate and publish passing every mtime
check (§2.6's HEAD term); an uncapped `conductor_override` reducing every gate to
advisory (§2.1's budget, §3.6); a POC design that confounded process with model size and
ran n=1 (three arms × three repetitions, §8 Phase 14 — G13 removes the confound outright);
role→model config never validated against what is served, and a read fan-out that could
serialize upstream because nothing set `--parallel` (§2.1's setup proofs, Task 12.1); a
router schema guard that was fail-*closed* inside a fail-soft layer and inert for
streaming traffic (§4.4 — it now observes and records, never rejects, and Task 0.2
determines the streaming question before Phase 11 is scoped); and adapters tested only
under Node while running under Bun, with first contact at Phase 13 (G14, Task 2.2).

Mediums and lows applied: `DEBUG`/`BLOCKED` reconciled with the state vocabulary; evidence
refs ledger-qualified; the two JSON-Schema validators reconciled by constraining exports
to the TS subset; second-validate-in-one-tree specified as a refusal; publish's failed
re-verify given a transition; the classification cross-check given a schema;
Tasks 9.4/9.5 split into six; non-git workspaces given a mode (§3.9); `conductor_setup`
given a reconfigure path; `.conductor/` given a retention policy; model ids given their
provider mapping; `vetMaxRounds` split from `reviewMaxRounds`; the watchdog raised above
the router's queue timeout; the commit message pinned to a template rather than a model;
the metrics ledger path made consistent; `behavioralPaths` detection added to setup; and
Task 12.2's stale `go test -run {name}` corrected to `{dirs}` (Round 4 fixed §2.1 and had
missed its consumer).

**Not re-reviewed:** these Round-5 changes are as unverified as Round 4's were. The
mechanisms carrying the most new surface are the wave driver (Task 9.4c), the
out-of-repo quarantine lifecycle (Task 6.1), the disposition/question machinery
(§2.5/§2.11), and the `missing-subject` resolution rule (§2.6.1) — the implementing agent
should treat all four with proportionate suspicion during its own red→green cycles, and
should expect the first live smoke (13.2) to find something in them.

*(End of plan.)*
