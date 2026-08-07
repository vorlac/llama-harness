# Conductor — a TDD-enforcing, adversarially-reviewed orchestration harness for opencode + llama.cpp

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
building on the deps already in `vcpkg.json`): admission control, model-swap batching,
prefix-affinity grouping, wire-level JSON-schema enforcement on gated requests, and a
per-request metrics ledger. It buys wall-clock and output integrity; it is **fail-soft** —
if it is not running, the identical process is enforced, just slower. (3) **wiring** — the
existing `scripts/serve.py` grows the ability to launch llama-router and to inject the
conductor plugin + agents + permissions into the session-scoped opencode config it already
generates, so the harness travels into whatever workspace the user `cd`s into.

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
  design (layer 2 dies ⇒ layer 1 still enforces everything).
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

A local LLM (9B–80B, served by llama.cpp on this machine) developing software has the same
chronic failure modes as any LLM, amplified by smaller capacity:

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
| `experimental.chat.system.transform` | Live harness state (phase, active item, the one legal next tool) injected into EVERY request — process re-stated every turn, never remembered |
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
  │ LAYER 2 — llama-router (C++)      wall-clock + wire      │
  │  admission control · swap batching · group affinity      │
  │  schema presence+validity enforcement · metrics ledger   │
  └──────────────────────────────────────────────────────────┘
        ▼
  llama-server --models-preset … --models-max N   (existing)
```

Layer 1 is the only layer that can see a tool call, so every gate lives there. Layer 2
gets exactly the jobs the plugin structurally cannot do:

| Router job | Why the plugin can't | Payoff |
|---|---|---|
| Admission control (cap in-flight per model, priority queue) | Plugin doesn't own the server; concurrent sub-sessions would thrash a 30 GB model | 6 parallel reviewers don't grind generation to a halt |
| Swap-cost batching (drain model A's queue before loading B) | Plugin can't reorder across sessions | Role-based model routing stays affordable under `--models-max 1` (a swap is a full weight reload) |
| Group affinity (requests sharing a declared prefix group run contiguously) | Plugin can't influence server slot reuse timing | N reviewers share one huge prefix (diff+plan+rubric); keeping it KV-hot is the largest single wall-clock lever |
| Wire-level schema enforcement (gated request MUST carry a schema; non-stream response validated against it) | The claimant would validate its own claim | Review verdicts parseable by construction, even from a 9B |
| Metrics ledger (tokens, timings, queue wait, swaps per request) | Plugin sees only its own requests | The POC's cost numbers are measured, not estimated |

**Dependency direction is load-bearing:** layer 2 fail-soft, layer 1 fail-closed. Process
integrity NEVER depends on the router being up (G5). `serve.py --no-router` must always
work and run the identical workflow.

### 0.4 The enforcement inventory

| Mechanism | Fires on | Enforces |
|---|---|---|
| **phase-order gate** | every `conductor_*` tool call | FSM transitions only in legal order (§3); handler re-derives evidence before advancing |
| **git-policy gate** | `tool.execute.before` (bash) | destructive git denied in every spelling; commit only via `conductor_publish`; parsed-token matching, never substring |
| **edit-scope gate** | `tool.execute.before` (edit/write/patch/bash-writes) | orchestrator can't write code (G8); implementers write only inside their item's declared file scope; nobody edits during a live verify |
| **evidence engine** | `conductor_*` handlers | RED/GREEN/VALIDATED derive from the harness running the commands itself; start-stamped freshness (an edit after a verify started voids it) |
| **review engine** | `conductor_item_review` / plan review | parallel fresh-context reviewers with distinct lenses → findings → parallel skeptic refutation → only surviving findings block |
| **ask-gate** | `permission.asked` event + SDK `permission.reply` + static agent permissions | subagent questions become surfaced questions on the run, not session stalls; human-territory questions reach the human batched |
| **continuation engine** | `session.idle` event | a run with actionable work re-prompts the orchestrator with the exact next action; disengage backstop after N futile re-prompts |
| **doctrine injection** | `experimental.chat.system.transform` + `chat.params` | phase-scoped doctrine (§6) + current state + the one legal next tool, injected into every request |
| **override hatch** | `conductor_override` tool | records an anomaly, taints the item (taint reaches the final report), then permits exactly one gated action (§3.6) |
| **ledgers + journal** | everywhere | every event as structured JSONL with runId/itemId correlation at configurable verbosity (§7); replayable |

### 0.5 The operating model

**Every prompt** (no invocation needed): the plugin classifies the prompt (question /
trivial / work — itself a recorded, adversarially-checked decision). Questions get
answered; trivial changes take a short path (§3.2); work enters the full pipeline:
decompose → plan → adversarial plan review (iterate until no majors) → execute items
(TDD + test-vet + validate + adversarial code review, parallel where profitable) → report.
The queue is **per-prompt and ephemeral** — created for the run, archived with it; no
global backlog.

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
│   │   ├── stops.ts                # stop-kind taxonomy + shouldTerminate (§2.9)
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
│   │   │                           #   implementers (§4.2, Task 9.6)
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
│   │   └── receive-review.md      # no performative agreement; verify-then-fix
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
│   │   └── fixtures/               # fixture repos, fake SDK, canned model outputs
│   └── tsconfig.json               # erasableSyntaxOnly, allowImportingTsExtensions
├── src/
│   ├── router/
│   │   ├── main.cpp                # llama-router entry (arg parse, wire-up only)
│   │   ├── router.hpp/.cpp         # http server + proxy pass-through (streaming)
│   │   ├── admission.hpp/.cpp      # in-flight accounting, priority queue, caps
│   │   ├── batcher.hpp/.cpp        # swap-cost batching + group affinity ordering
│   │   ├── schema-guard.hpp/.cpp   # schema presence + response validation
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
│   ├── test-conductor.sh           # runs export-schemas + node --test (Task 0.3)
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
│   │   ├── halt                    # OWNER-ONLY halt file (presence = halt;
│   │   │                           #   the model never creates/edits/deletes it)
│   │   └── worktrees/              # parallel-implementer worktrees (§4.3)
│   └── runs/<runId>/               # one dir per prompt-run, self-contained
│       ├── run.json                # run FSM state + metadata (§2.3)
│       ├── queue.json              # decomposed items + DAG (§2.4)
│       ├── items/<itemId>.json     # per-item FSM state + evidence refs (§2.5)
│       ├── plan.md                 # the plan document (§3.2 PLANNED)
│       ├── report.md               # final report (§3.2 REPORTED)
│       ├── journal.jsonl           # the full structured event journal (§7)
│       ├── evidence.jsonl          # red/green/verify records (§2.6)
│       ├── decisions.jsonl         # decision-protocol ledger (§2.7)
│       ├── anomalies.jsonl         # overrides, gate crashes, disengages (§2.8)
│       └── reviews/<itemId|plan>-r<N>.json   # finding sets + verdicts (§2.10)
└── (the target project's own files)
```

The `.conductor/` prefix is registered in the target's `.git/info/exclude` (not its
tracked `.gitignore`) the first time conductor touches a repo — the harness must never
dirty a target's tracked files with its own presence.

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
                // run with the §4.2 quarantine (sub-GREEN other items' testScope
                // files moved aside; the item's own tests never excluded) — and
                // additionally require the failure excerpt to name a file in the
                // item's testScope, otherwise the red is ILLEGAL (a suite failure
                // elsewhere must not impersonate this item's red).
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
    "behavioralPaths": ["src/**"],      // globs whose changes owe verification
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
    "mode": "commit"                    // "read-only" | "commit" | "commit-and-push";
                                        //   asked on first run in a repo, NEVER defaulted
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
    "debugFixCap": 3                    // failed fixes before architecture escalation
  },
  "parallel": {
    "writes": "off",                    // "off" | "worktrees" (§4.2/§4.3, Task 9.6)
    "maxImplementers": 2,
    "maxReaders": 6,                    // reviewer/critic fan-out ceiling
    "subSessionTimeoutMs": 600000       // fan-out watchdog per sub-session (Task 7.1)
  },
  "models": {                           // role → model id (as served); §4.1
    "orchestrator": "qwen3-coder-30b",
    "planner": "qwen3-coder-next",
    "implementer": "qwen3-coder-30b",
    "testWriter": "qwen3-coder-30b",
    "reviewer": "qwen3-coder-next",
    "skeptic": "qwen3-coder-30b",
    "mechanical": "ornith-9b"
  },
  "ponytail": "full",                   // "lite" | "full" | "ultra" (§6.3)
  "logging": { "level": "info", "components": {} }   // §7
}
```

On first run in a repo, conductor detects what it can (test command from package.json /
CMakeLists+ctest / pyproject / Cargo.toml / go.mod), asks the user the git-access question
(no default), and writes this file. Every configured command is smoke-spawned at write
time so an unspawnable command fails at setup, not at first verify.

### 2.2 Router config — `.data/configs/conductor-router.json` (this repo; generated by
serve.py, hand-editable)

```jsonc
{
  "version": 1,
  "listen": { "host": "127.0.0.1", "port": 8088 },
  "upstream": { "host": "127.0.0.1", "port": 8080 },
  "admission": {
    "maxInflightPerModel": 4,          // ≤ llama-server's slot count for that model
    "maxQueued": 64,
    "queueTimeoutMs": 600000
  },
  "batching": {
    "swapWindowMs": 2000,              // collect same-model work before allowing a swap
    "maxBatchHoldMs": 30000            // no request waits longer than this for batching
  },
  "priorities": { "interactive": 0, "review": 1, "batch": 2 },   // lower = first
  "schema": { "enforceHeader": "X-Conductor-Schema", "validateResponses": true },
  "metrics": { "ledgerPath": ".data/router-metrics.jsonl" },
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
  "planReviewRounds": 2,
  "stop": null,                        // terminal only: {kind, reasonDisplay} (§2.9)
  "counters": { "idleRePrompts": 0,
                "futileRePrompts": 0 } // consecutive idle re-prompts whose resulting
                                       //   run-state signature was unchanged; the noop
                                       //   stop fires when this reaches 3 (§2.9, §3.7)
}
```

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
  "state": "GREEN",                    // §3.3 vocabulary
  "assignee": null,                    // sub-session id while dispatched
  "worktree": null,                    // path when parallel.writes = "worktrees"
  "attempts": { "green": 1, "reviewRounds": 0, "debugFixes": 0 },
  "evidence": {
    "red":   { "seq": 12 },            // journal/evidence seq refs (writer: evidence.ts)
    "green": { "seq": 18 },
    "validated": { "seq": 25 }
  },
  "taint": [],                         // override records that touched this item (§3.6)
  "inlineClaim": null                  // {reason, decisionId} when worked inline (§3.6)
}
```

### 2.6 `runs/<runId>/evidence.jsonl` — writer: `adapter/evidence.ts` ONLY

```jsonc
{ "seq": 12, "ts": 1754560000000, "kind": "red", "itemId": "I1",
  "command": ["node", "--test", "tests/parser.test.ts"],
  "exitCode": 1, "failureExcerpt": "AssertionError: expected ParseError… (≤300 chars)",
  "failureClass": "assertion" }        // "assertion" | "error" — an import/collection
                                       //   error is NOT a legal red (§3.3)
{ "seq": 18, "ts": 1754560200000, "kind": "green", "itemId": "I1",
  "command": ["node", "--test", "tests/parser.test.ts"], "exitCode": 0 }
{ "seq": 25, "ts": 1754560400000, "kind": "verify", "itemId": "I1",
  "startedMs": 1754560300000,          // START stamp, taken before the first scope ran
  "green": true,
  "scopes": { "unit": { "green": true, "exitCode": 0, "durationMs": 41876 } } }
```

Freshness rule (core/freshness.ts, pure): a `verify` record is fresh for a commit iff
`startedMs >= max(worktree mtimes of the staged behavioral files that exist,
index mtime when any staged behavioral entry is a deletion/rename)`. Any edit after the
run STARTED was never verified. The reader is `conductor_publish`; the writer is
`evidence.ts`; Task 6.x tests exercise both (G6).

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
| `env` | tooling broken (verify cannot run, server down, fan-out env-failure) |
| `interrupt` | human aborted / halt file present |

A run may only leave EXECUTING via `conductor_report` (→ `done`) or a recorded stop of
one of these kinds. `core/stops.ts` exports the vocabulary and `shouldTerminate(run,
counters, itemsSummary, config)` (Task 1.3); the continuation engine and the report
tool are its only consumers.

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
  "proposedFileScope": [], "proposedTestScope": [] }
// proposedFileScope/proposedTestScope: REQUIRED non-empty when kind = "trivial" —
// they are the data source for the §3.2 one-item synthesis and the trivialMaxFiles
// re-check (the handler counts them; over the ceiling or empty ⇒ escalate to "work").

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

Schema-required fields are enforced twice: llama-router rejects a gated request whose
body carries no schema and validates non-streaming responses against the declared schema
(§4.4); the fan-out engine validates on receipt regardless (router fail-soft, G5) and
re-prompts with the validation error appended, up to 2 retries, before marking the
sub-task `env`-failed.

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
holds the legality table `legalTools(run, items, repoConfigured) → Map<toolName,
argsHint>`; the phase-order gate denies every conductor tool not in the map, with a
reason naming the one that IS legal. The injected system prompt (§6.4) states the same next action — the
gate is the enforcement, the injection is the courtesy (G9).

### 3.2 Run stages, normatively

**INTAKE.** Run creation: the `chat.message` hook, on a user prompt arriving with NO
active run, creates `runs/<runId>/run.json` (state INTAKE) and points
`current-run.json` at it; a prompt arriving DURING a non-terminal run is routed into
the current run as orchestrator context (journaled as `user.midrun-prompt`) and never
starts a new run — a new run requires the previous one terminal. Then (the
orchestrator's first legal tool is `conductor_classify`): the handler dispatches a `mechanical`-role
sub-session with the CLASSIFICATION schema, then ONE `skeptic`-role check of that
classification (cheap; prevents "everything is trivial" drift). Disagreement escalates to
`work`. `question` ⇒ the orchestrator just answers (state ANSWERED, run archived).
`trivial` ⇒ the handler synthesizes a one-item queue from the classifier's
`proposedFileScope`/`proposedTestScope` (§2.10 — required non-empty for a trivial
verdict; the handler re-counts them against `trivialMaxFiles` and escalates to `work`
on violation or emptiness) and the run enters EXECUTING directly, flagged trivial: DECOMPOSED/PLANNED/
PLAN_REVIEWED are skipped, and item review runs with MERGED lenses (§3.3's trivial
rule) — but the item FSM itself (RED→TEST_VETTED→…→REVIEWED) is NEVER skipped; trivial
compresses fan-out width, not process. `trivial` is denied by the classifier schema when
the prompt implies > `trivialMaxFiles` files or any behavioral ambiguity.

**DECOMPOSED.** `conductor_decompose` dispatches the `planner` role with the queue schema
and doctrine pack `decompose.md` (ponytail ladder at configured intensity: every item
carries its ladder rung + reuse note, §2.4). Handler validates: DAG acyclicity, non-empty
fileScope per item, acceptance criteria phrased as observable checks. Oversized items
(scope > ~5 files or > 1 acceptance cluster) are re-split by one bounded re-prompt round.

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
`planReviewMaxRounds` reached (then: surviving majors become surfaced questions —
the run proceeds only on items no major touches; the rest block on the human).

**EXECUTING.** The wave scheduler (§4.2) dispatches items through the item FSM (§3.3).

**REPORTED.** `conductor_report` requires: every item PUBLISHED, or blocked/deferred with
reason. The handler re-runs the full verify itself (fresh, start-stamped — the
verification-before-completion law made mechanical), then writes `report.md`: what
shipped (per item: red proof, review rounds, taint), what was deferred and why, surfaced
questions, decision-ledger summary, metrics (tokens, wall-clock, parallelism achieved,
model swaps — via Task 7.2's fail-soft router client when the router is up). Then
records stop `done`. The closing verify applies the §4.2 quarantine exclusion for
every non-PUBLISHED item below GREEN (report is legal with blocked items, whose red
tests linger), and the exclusions are disclosed in report.md's blocked/deferred
section. For trivial runs the same handler runs report-lite (the same fresh verify
plus a compact report) and advances EXECUTING→TRIVIAL_DONE instead of REPORTED.

### 3.3 Item FSM

```
PENDING ─► RED ─► TEST_VETTED ─► GREEN ─► VALIDATED ─► REVIEWED ─► PUBLISHED
              (test exists,   (impl     (full        (surviving
               failed for      passes    verify       findings = 0)
               the RIGHT       its       green,
               reason,         test)     fresh)
               critics
               passed)
                     ↑ any later failure that resists `debugFixCap` fixes drops the
                       item into DEBUG (systematic-debugging protocol, §6.2) and, if
                       architecture is questioned, to a surfaced question
```

Normative details, each enforced by the named mechanism:

- **PENDING→RED** (`conductor_submit_test`): the test-writer sub-session (role
  `testWriter`, doctrine `tdd.md`) writes ONLY test files (the edit-scope gate restricts
  it to the item's `testScope`, §2.4). The handler — not the model — runs the test via
  `evidence.ts` and requires exit≠0 with `failureClass:"assertion"`: an import error,
  collection error, or syntax error is NOT red (the test never evaluated the behavior);
  the handler returns the failure to the writer for repair, bounded at 3 attempts, then
  BLOCKED. A test that PASSES immediately is rejected: either the behavior exists
  (surfaced as a decision: item may be unnecessary — ponytail rung "skip") or the test is
  wrong.
- **RED→TEST_VETTED** (`conductor_vet_test`): `vetCritics` parallel critics (role
  `reviewer`, doctrine `test-vet.md`), fresh contexts, given the item spec + the test
  diff + the captured red output — NOT the implementation (none exists; that is the
  point: critics can't be anchored by code that already passes). Lenses per §2.10
  TEST_VET: asserts observable behavior not internals; would fail for a subtly-wrong
  implementation (tautology/mock-testing check — the testing-anti-patterns iron laws);
  right level (unit vs integration); pins THIS item's acceptance; anti-pattern scan
  (mock-behavior assertions, test-only production methods, incomplete mocks).
  `mustFix` items → back to the test-writer, re-vet; bounded by `reviewMaxRounds`.
- **TEST_VETTED→GREEN** (`conductor_mark_green`): the implementer sub-session (role
  `implementer`, doctrine `tdd.md` minimal-code section) may now edit the item's
  fileScope. The handler re-runs the item test itself; exit 0 required. The implementer
  never runs "done" by assertion — the tool call fails until the test actually passes.
  Implementer statuses (`DONE_WITH_CONCERNS`/`NEEDS_CONTEXT`/`BLOCKED`) are handled per
  the subagent-driven-development protocol: concerns are read and triaged (correctness
  concerns block; observations are noted); missing context is supplied and re-dispatched;
  BLOCKED escalates in order: more context → stronger model → item re-split via
  `conductor_queue_amend` (recorded decision) → surfaced to the human.
- **GREEN→VALIDATED** (`conductor_validate`): `evidence.ts` runs the full required
  scopes (build first where configured; a failed build never runs tests). Start-stamped;
  the freeze gate denies ANY source edit while a verify is in flight (racing edits void
  freshness). Failure drops to DEBUG protocol: doctrine `debug.md` is injected, the
  four-phase protocol applies (root cause before fix; one hypothesis at a time;
  `debugFixCap` failed fixes ⇒ architecture question surfaced, per systematic-debugging's
  3-fix rule).
- **VALIDATED→REVIEWED** (`conductor_item_review`): fresh reviewers over the item's
  diff + spec + test, one lens each. The lens set: **spec/contract** (spec compliance —
  missing requirements, unrequested extras — plus API/contract soundness),
  **correctness**, **guardrail** (security, trust-boundary validation, data-loss — the
  ponytail never-lazy list), **test-adequacy** (does the test still honestly pin the
  change now that the impl exists), **minimality/simplification**, **perf**. The first
  five are MANDATORY and are never truncated by configuration; `itemReviewers` ≥ 6 adds
  perf. The general session-count rule (one statement, referenced by Task 9.5 and the
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
  surviving findings go back to the implementer (doctrine
  `receive-review.md`: verify the claim against the code before implementing the fix; a
  wrong finding is answered with reasoning, which the handler routes back through one
  more skeptic round rather than accepting silently). Fix ⇒ re-validate ⇒ re-review
  (bounded `reviewMaxRounds`; cap ⇒ surfaced question with the finding list).
- **REVIEWED→PUBLISHED** (`conductor_publish`): under git.mode `commit`/
  `commit-and-push`: the handler stages the item's fileScope ∪ testScope changes (the
  tests ARE the deliverable's proof — they ship in the same commit), runs format rules,
  re-checks verify freshness (start-stamp vs staged mtimes; stale ⇒ auto re-verify),
  commits with a generated message naming the item + red proof — with NO attribution
  trailers (normative denylist, case-insensitive: `Co-Authored-By`, `Signed-off-by`,
  `Generated with`, and the 🤖 emoji) — and pushes only under `commit-and-push`.
  Under `read-only`: writes the prepared batch (file list, diff, suggested message,
  verify verdict) into the report instead. The commit is executed by the handler via
  `$`/execFile — the model never runs `git commit` itself (the git-policy gate denies
  it; publishing IS the tool).

### 3.4 The `conductor_*` tool inventory

| Tool | Args (schema-typed) | Handler re-derives | Advances |
|---|---|---|---|
| `conductor_classify` | none | dispatches classifier + skeptic check | INTAKE→{ANSWERED, EXECUTING(trivial, one synthesized item)}; a `work` classification stays in INTAKE with `classification` recorded — `conductor_decompose` is then the one legal next tool (`legalTools` reads `run.classification`) |
| `conductor_decompose` | none | queue validity (DAG, scopes, sizes) | INTAKE(classified work)→DECOMPOSED |
| `conductor_plan` | none | plan.md written; decision records extracted | →PLANNED |
| `conductor_plan_review` | none | full fan-out, verdicts, revision loop | →PLAN_REVIEWED |
| `conductor_dispatch_wave` | none | computes next wave (§4.2), dispatches items | PLAN_REVIEWED→EXECUTING on its first call; items PENDING→(in flight) |
| `conductor_submit_test` | {itemId} | runs test; asserts legal red | PENDING→RED |
| `conductor_vet_test` | {itemId} | critic fan-out + verdicts | RED→TEST_VETTED |
| `conductor_mark_green` | {itemId} | runs test; exit 0 | TEST_VETTED→GREEN |
| `conductor_validate` | {itemId} | full verify, start-stamped | GREEN→VALIDATED |
| `conductor_item_review` | {itemId} | reviewer+skeptic fan-out, fix loop | VALIDATED→REVIEWED |
| `conductor_publish` | {itemId} | stage/format/freshness/commit | REVIEWED→PUBLISHED |
| `conductor_report` | none | fresh full verify; report.md; stop `done` | EXECUTING→REPORTED (trivial runs: →TRIVIAL_DONE, report-lite) |
| `conductor_surface` | {question, blocksItems[]} | records question, blocks items, continues rest | — |
| `conductor_decide` | {question, options[], choice, why} | appends decision record (§2.7) | — |
| `conductor_queue_amend` | {ops[]} | DAG/scope re-validation + decision record | — |
| `conductor_inline_claim` | {itemId, reason} | records claim; scopes edit perm to item | — (§3.6) |
| `conductor_override` | {gate, reason} | anomaly + taint + one-shot bypass | — (§3.6) |
| `conductor_status` | none | prints run/item/ledger summary (read-only) | — |
| `conductor_setup` | none | first-run detection + questions (Task 12.2); legal ONLY while `.conductor/config.json` is absent (Task 3.2's `repoConfigured` input) | — |

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

**Git policy** (bash commands; parsed-token matching over quote-aware split — NEVER
substring regex, which false-positives on paths and message words):

| Command class | Disposition |
|---|---|
| status/log/diff/show/branch(list)/ls-files/rev-parse | allow |
| `git add`/`mv`/`rm`/`stash push` | allow for the publishing handler's own session; DENY from model sessions (staging is `conductor_publish`'s job) |
| `git commit` in any spelling | deny — "publishing is `conductor_publish`" |
| `git push` | deny (handler-only, mode-gated) |
| reset/rebase/filter-branch/config/clean/merge/cherry-pick/revert/am | deny (destructive or history-manipulating; human territory) |
| `checkout`/`switch`/`restore` worktree-discarding forms (`checkout --`, `checkout .`, multi-operand checkout, `restore` without `--staged`, `switch -C`, `checkout -B`) | deny |
| `branch -d/-D/-M`, `stash drop/clear`, force/`--delete`/`+refspec`/`:refspec` push | deny |
| branch movement (`switch <br>`, `checkout <br>`, `checkout -b`) | allow |

The full deny matrix from the production harness is normative here, including the
false-positive guards: `git add src/config.ts` (path containing a verb word) allows;
`git log --grep config` allows; `git stash push -m drop` allows. Task 5.1 encodes the
complete matrix as its test table.

**Edit-scope gate** (edit/write/patch tools + bash write-shaped commands — redirects,
`tee`, `sed -i`, `mv`/`cp` destinations):

- Orchestrator session: deny ALL source edits (G8) unless an active `inlineClaim`
  scopes the path.
- Implementer/test-writer sessions: allow only paths matching the assigned item's
  fileScope (test-writer: the item's `testScope` only); deny otherwise, naming the scope.
- Everyone: deny edits to `.conductor/**` (state is handler-written only) and deny any
  source edit while a verify is in flight in the same tree (freeze — scoped per tree,
  Task 6.1, so a worktree implementer is never frozen by another tree's validate).
  Path normalization: every path is evaluated relative to the session's tree
  (`sessionTree`), and item scopes are tree-relative — so a worktree implementer's
  legal surface under `.conductor/state/worktrees/<id>/src/…` normalizes to `src/…`,
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

`conductor_override {gate, reason}`: records an anomaly (§2.8), appends the override to
the item's `taint[]`, then disables the named gate for exactly ONE next action in the
same session. Taint is permanent for the run and listed prominently in report.md. There
is deliberately no bulk or timed override; a wedged gate that needs repeated overriding
is an `env` stop and a bug to fix in conductor itself.

### 3.7 Continuation (the idle engine)

opencode has no pre-emptive turn-end refusal; continuation is re-entry:

1. `session.idle` fires for the orchestrator session while `run.state` is non-terminal
   and actionable work exists (items not PUBLISHED/blocked, or a legal next run
   transition) ⇒ `continuation.ts` re-prompts the orchestrator via
   `client.session.prompt` with a minimal message naming the exact next tool call
   (derived from `gates-phase.ts` — the same single source as the injection).
2. Each re-prompt increments `counters.idleRePrompts`. A re-prompt whose resulting
   run-state signature (hash of run.json + item states) is identical to the previous
   one increments `futileRePrompts`; any state change resets it. `futileRePrompts`
   reaching 3 ⇒ the engine consults `shouldTerminate`, records stop `noop` plus a
   `disengage` anomaly, and stops re-prompting (a wedged loop must end loudly, not burn
   tokens forever). This counter is the ONLY wedge detector — §2.9's noop row and Task
   1.3 encode the identical rule; there is no separate disengage threshold.
3. Halt file present ⇒ never re-prompt; record `interrupt`.
4. The engine debounces (no re-prompt within 2s of the last; one in flight at a time)
   and never re-prompts ANSWERED/TRIVIAL_DONE/REPORTED runs.

---

## §4. Parallelism & scheduling

### 4.1 Roles, models, and the swap-cost reality

Every sub-session is created with an agent whose `model` comes from `config.models[role]`
(§2.1). The catalog on this machine spans a 9B dense to an 80B-A3B MoE; the serving
reality under `--models-max 1` is that a model switch is a full weight unload+load
(~30 s for a 30 GB model — the existing `scripts/benchmark.py` groups runs by runtime
flags for exactly this reason, and the scheduler inherits that discipline):

| Role | Default | Why |
|---|---|---|
| planner, reviewer | largest coding model (`qwen3-coder-next`) | judgment-heavy; wrong here is expensive downstream |
| orchestrator, implementer, testWriter, skeptic | mid (`qwen3-coder-30b`) | volume work; good enough with gates + schemas |
| mechanical (classification, formatting nits, summaries) | smallest (`ornith-9b`) | trivial with a schema; latency matters |

**The swap-cost guard is a scheduler property, not a router-only property:** the fan-out
engine (`adapter/fanout.ts`) dispatches work **in per-model waves** — all queued jobs for
model M are launched together (bounded by `parallel.maxReaders`) and the next model's
wave waits until M's wave drains. llama-router's batcher (§4.4) enforces the same
ordering at the wire for requests it can see queued, so even interleaved arrivals don't
thrash. When `--models-max > 1` and the host has headroom (serve.py knows both), the
scheduler treats co-resident models as one super-wave.

### 4.2 The wave scheduler (items)

`core/schedule.ts` — pure: `nextWave(queue, items, config) → {parallel: itemId[],
rationale}`. A wave is a maximal set of items that are (a) dependency-ready (all
`dependsOn` PUBLISHED), (b) pairwise fileScope-disjoint (glob-intersection check), and
(c) within `parallel.maxImplementers`. Item stages parallelize independently of this:
**reads always fan out** (vet critics, reviewers, skeptics are read-only and run
concurrently up to `maxReaders`, across items too); **writes serialize unless isolated**:

- `parallel.writes: "off"` (POC default): one item holds write access at a time; other
  wave members may still run their RED stage (test-writing touches disjoint test paths)
  and all read stages. This alone yields large overlap: item B's test is being written
  and vetted while item A implements. **Shared-tree quarantine rule:** a wave sibling's
  deliberately-red test file must not poison another item's full verify — so
  `conductor_validate` (and publish's auto re-verify) passes `runVerify` an
  `excludeTestFiles` list: the testScope files of every OTHER queue item whose state
  is below GREEN — not just wave siblings, because a blocked earlier-wave item's red
  test lingers in the tree too (a testScope glob matching no existing file is a
  no-op: PENDING items have no tests yet). `runVerify` quarantines those files (moves
  them into the run dir, restores after — Task 6.1); the freeze gate already denies
  edits during the verify, so the move cannot race a writer. The item's OWN tests are
  never excluded. The same rule applies to `runTest`'s no-template fallback (§2.1) —
  without it, two fallback-mode items in one wave livelock each other's GREEN — and
  to `conductor_report`'s closing verify (§3.2).
- `parallel.writes: "worktrees"`: each wave implementer gets `git worktree add
  .conductor/state/worktrees/<itemId>` (using-git-worktrees, made mechanical; built and
  tested in Task 9.6 — `gitio` and `evidence.runVerify` take an explicit `cwd`/tree
  argument and verify markers are per-tree from day one, Tasks 4.2/6.1); edit-scope
  gates bind each session to its worktree path. Merge-back is serial in item order:
  cherry-less `git merge --ff-only` where possible, else a normal merge by the handler;
  after each merge the item re-validates against the integrated tree before PUBLISHED
  (integration honesty — a green in isolation is not a green in company). Scope
  disjointness makes conflicts structurally rare; a conflict anyway ⇒ the later item
  drops to GREEN and re-validates.

### 4.3 What parallelizes, summarized

| Stage | Fan-out | Isolation |
|---|---|---|
| plan review, item review, test vet, skeptics | up to `maxReaders`, across items | none needed (read-only) |
| implementation | 1, or wave-wide under worktrees | worktree per item |
| test-writing (RED) | wave-wide | test paths are disjoint by scope |
| validate (full verify) | serial per tree (worktree mode may validate different trees concurrently) | verify marker per tree (Task 6.1); parallel verifies in ONE tree lie |
| publish | serial in item order | git index is a singleton |

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
  request body's `model` field). At cap: enqueue (priority, then FIFO). Queue overflow
  or timeout ⇒ 503 with a JSON error the fan-out engine understands (it backs off and
  retries; bounded).
- **Swap batching:** when the upstream would have to load a different model (router
  tracks which model(s) it believes are resident from its own dispatch history +
  `/v1/models` metadata where available), hold cross-model dispatch for up to
  `swapWindowMs` while same-model work exists, hard-capped by `maxBatchHoldMs` per
  request. Result: ABAB arrival order dispatches as AABB.
- **Group affinity:** among same-model queued requests, dequeue same-group requests
  contiguously (llama-server's slot reuse then keeps the shared prefix KV-hot).
- **Schema guard:** requests with `X-Conductor-Schema: required` must carry
  `response_format` (json_schema) or a `grammar`/`json_schema` body field — llama-server
  natively converts JSON schema to GBNF and constrains sampling; the router 400s if the
  field is absent (the plugin bug surfaces loudly). For non-streaming tagged responses,
  validate the response body against the declared schema (nlohmann
  json-schema-validator); on mismatch return the upstream body wrapped in a structured
  validation-error envelope so the fan-out engine's retry sees WHY.
- **Metrics:** one JSONL line per request: model, role, group, priority, queue-wait ms,
  upstream ms, swap-triggered flag, prompt/completion tokens + timings (from
  llama-server's `usage` and `timings` response fields), status. `/conductor/metrics`
  serves aggregates; the ledger is the POC's cost dataset.
- **Fail-soft:** the router never enforces process (that is layer 1's job). Because
  serve.py execs into the session shell and cannot supervise anything directly, the
  router runs under a small supervisor loop process (restart with capped exponential
  backoff; dies with the shell like the existing server watchdog — Task 12.1); while
  the router is down, requests fail visibly until the restart lands. `--no-router` runs
  everything direct (G5).

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

Agent-level `model` is set at runtime by the fan-out engine per `config.models` (passing
`model` in the prompt body overrides the agent default — verified in Task 0.2), so the
fragment stays model-agnostic. Permission blocks on the subagent defs mirror §3.5 (the
plugin gates are the enforcement; agent permissions are defense-in-depth — the same
two-layer posture as the production harness). The orchestrator's `edit: "ask"` is the
inline-claim mechanism: the plugin adjudicates each ask via
`permission.asked`/`permission.reply`, allowing iff an active claim covers the path
(§3.6). There is no separate `write` permission key in opencode 1.18.10 — the
write/patch tools are governed by `edit`.

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
  role pack; (b) a live state block ≤ 30 lines: run state, active item + state, the ONE
  legal next tool with its args, open surfaced questions count, taint count. Re-stated
  every request — never remembered (G9).
- `chat.params`: role-appropriate sampling (reviewers/skeptics: temperature ~0.3;
  planners 0.7; mechanical 0.1) — recorded in the journal.
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
  "data": { "role": "reviewer", "lens": "correctness", "model": "qwen3-coder-next" } }
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
(`src/dashboard/`, ftxui) tails the metrics ledger: per-model in-flight/queued, swap
events, token throughput — optional build, no runtime coupling.

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
  (b) enforcement substrate = TS plugin (all gates) + C++ router (wall-clock/wire) +
  serve.py wiring, per §0.3; (c) gates hard-deny with the `conductor_override` hatch;
  (d) role→model routing with wave-based swap guarding; (e) the stock example target
  `myprogram`/`src/main.cpp` is REPLACED by the router targets (it is the unmodified
  llama.cpp simple-chat example; zero project value; git history preserves it);
  (f) plugin tests run under Node type-stripping, not Bun (Node 26 present, zero new
  toolchain); (g) `.conductor/` state excluded via `.git/info/exclude` in targets.
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
  stripped by the router) is pinned instead.
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
AnomalyRecord, Findings, Verdict, Classification, TestVet, ImplementerResult,
JournalRecord. Plus `validate(schemaName, value) → {ok, errors[]}` — a minimal JSON
Schema subset validator (type/required/enum/properties/items/additionalProperties;
~120 lines) sufficient for our schemas; NOT a general validator, and a test pins the
subset by rejecting a schema feature outside it.

- [ ] **Step 1:** Failing tests: each schema accepts its §2 example verbatim; rejects a
  missing required field, a wrong enum (e.g. item state "DONE"), an extra property where
  additionalProperties is false; validator subset rejection.
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
- `verifyFreshFor(record, stagedMtimes, indexMtimeMs, hasStagedDeletion) → boolean`
  (§2.6 rule; `startedMs === ref` counts fresh).
- `shouldTerminate(run, counters, itemsSummary, config) → {stop:boolean, kind?}`
  (§2.9; `noop` when `futileRePrompts` reaches 3 — the single wedge detector,
  identical to §3.7's rule; `blocked`/`surfaced` derived from `itemsSummary` = {open,
  blocked, surfacedQuestions} counts; `env` and `interrupt` are recorded directly by
  the fan-out engine / halt handling, never computed here).
- `findingSurvives(verdicts[], k) → boolean` (survives iff upholds ≥ ⌈k/2⌉ — a tie
  upholds; a finding two skeptics split on is worth a fix round).
- [ ] Steps: truth-table tests for each (freshness boundary, deletion term, every
  computed stop kind incl. blocked/surfaced from itemsSummary counts; verdicts at k=2:
  0 upholds dies, 1 uphold [tie] survives, 2 upholds survives; k=3 majority cases) →
  red → implement → green → commit `conductor: 1.3 freshness/stops/verdict`.

#### Task 1.4: Purity guard

- [ ] **Step 1:** `conductor/tests/purity.test.ts`: read every file under
  `conductor/core/`; assert imports name only `./…​.ts` core siblings, and source
  contains none of: `node:fs`, `node:child_process`, `Bun`, `fetch(`, `process.env`,
  `Date.now` (core takes `nowMs` as input). Trivially green now; bites later.
- [ ] **Step 2:** Commit: `conductor: 1.4 purity guard`.

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
  truncation) → red → implement → green → commit `conductor: 2.1 journal`.

---

### Phase 3 — State machines

#### Task 3.1: `core/fsm-run.ts` + `core/fsm-item.ts`

**Interfaces:** `RUN_STATES`, `ITEM_STATES` (exact §3 vocabularies);
`legalRunTransition(from, to, context) → {ok, why?}`;
`legalItemTransition(from, to, context) → {ok, why?}` where context carries the
evidence the transition claims (e.g. GREEN requires `{testExit:0}`, RED requires
`{testExit:≠0, failureClass:"assertion"}`, PLAN_REVIEWED requires
`{survivingMajors:0}` or `{round:>=max}`); transitions not in the table are illegal.

- [ ] Steps: failing tests — full transition matrices (legal set exactly as §3.1/§3.3
  draw them; every illegal pair rejected with a why naming the legal successor;
  evidence-context requirements: GREEN with testExit 1 rejected, RED with
  failureClass "error" rejected; the trivial trajectory: INTAKE→EXECUTING with
  classification trivial legal, EXECUTING→TRIVIAL_DONE legal ONLY for trivial runs,
  rejected for work runs — and EXECUTING→REPORTED rejected for trivial runs;
  INTAKE→DECOMPOSED requires classification work; PLAN_REVIEWED→EXECUTING requires
  the context `{survivingMajors:0}` or `{round:>=max}` — same context rule as
  PLANNED→PLAN_REVIEWED) → red → implement → green → commit `conductor: 3.1 FSMs`.

#### Task 3.2: `core/gates-phase.ts`

**Interfaces:** `legalTools(run, items, repoConfigured) → Map<toolName, argsHint>` —
the single source the phase-order gate and the injection/continuation engines consume
(one derivation, three consumers — they can never disagree). `repoConfigured: false` ⇒
the ONLY legal tools are `conductor_setup` and `conductor_status`.

- [ ] Steps: failing tests (`conductor_status` always legal; `conductor_decide`/
  `conductor_surface` legal in every non-terminal state; UNCLASSIFIED INTAKE ⇒ only
  `conductor_classify`; INTAKE with `classification.kind === "work"` ⇒ only
  `conductor_decompose` (legalTools reads run.classification); PLAN_REVIEWED ⇒
  `conductor_dispatch_wave` (which performs PLAN_REVIEWED→EXECUTING on first call);
  EXECUTING with item I1 at TEST_VETTED ⇒ `conductor_mark_green {itemId:I1}` legal and
  `conductor_publish {itemId:I1}` illegal; EXECUTING flagged trivial legalizes the item
  tools and `conductor_report`; unconfigured repo ⇒ only setup+status; REPORTED ⇒ only
  status) → red → implement → green → commit `conductor: 3.2 phase legality`.

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

**Interfaces:** run lifecycle (`createRun`, `loadRun`, `saveRun`, `currentRun`,
`archiveRun`), item CRUD, queue read/write, ledger appends (evidence via evidence.ts
only — state.ts exposes the raw append but a test asserts no other adapter imports it),
halt detection, `.git/info/exclude` registration, atomic tmp+rename writes (pid-suffixed
tmp), BOM-tolerant reads, an advisory lockfile per run dir (single-writer: the plugin
instance; the lock guards against two opencode sessions sharing a workspace —
second session gets read-only conductor with a loud journal warning).

- [ ] Steps: failing tests on fixture dirs (round-trips; atomicity — a write interrupted
  by injected throw leaves the old file; exclude registration idempotent; LIVE foreign
  lock ⇒ read-only mode flag; STALE lock — the lockfile carries `{pid, startMs}` and a
  dead pid or over-age lock is broken with an anomaly record and single-writer claimed,
  mirroring Task 6.1's marker rule, so an opencode crash never wedges a workspace) →
  red → implement → green → commit `conductor: 4.1 state store`.

#### Task 4.2: `adapter/gitio.ts`

**Interfaces (execFile, shell:false; every function takes an explicit `cwd` — the
workspace root or a worktree path, which is what makes Task 9.6's worktree mode
possible without interface breaks):** `stagedFiles`, `stagedNameStatus`, `dirtyFiles`,
`unstagedDrift(paths)`, `indexMtimeMs`, `worktreeMtimes(paths)`, `headShortSubject`,
`currentBranch`, `isRepo`.

- [ ] Steps: failing tests against throwaway fixture repos built by the test (incl.
  NUL-splitting a filename with a space; zero-commit repo; staged deletion) → red →
  implement → green → commit `conductor: 4.2 gitio`.

---

### Phase 5 — Gates

#### Task 5.1: `core/gates-git.ts`

**Interfaces:** `decideGit(command, sessionRole, gitMode) → {action:"allow"|"deny",
reason?}` implementing the §3.5 matrix over parsed tokens.

- [ ] **Step 1:** Failing test — the FULL matrix as a table, one test per row, including
  every §3.5 row and the false-positive guards verbatim: `git add src/config.ts`
  (allow for handler-role, deny for model sessions with reason naming
  conductor_publish), `git log --grep config` allow, `git stash push -m drop` allow,
  `git commit -m "fix reset logic"` deny-with-publish-reason (not a destructive-verb
  false positive), compound `echo hi && git reset --hard` deny (every segment scanned),
  newline-separated compound deny, `+refspec`/`:refspec` push denies,
  `restore --staged` allow vs `restore --staged --worktree` deny.
- [ ] Steps 2–5: red → implement → green → commit `conductor: 5.1 git policy`.

#### Task 5.2: `core/gates-edit.ts`

**Interfaces:** `decideEdit({sessionRole, fileScope, testScope, path,
verifyInFlightTree, sessionTree, inlineClaimScope}) → decision`;
`writeShapedPaths(command) → string[]` (bash write-target extraction: redirects, tee,
sed -i, mv/cp destinations, rm targets — reads NEVER match).

- [ ] Steps: failing tests (orchestrator denied on src, allowed with matching inline
  claim; implementer allowed in fileScope, denied out with the scope named;
  test-writer allowed ONLY inside `testScope`, denied on fileScope source paths with
  the testScope named; anyone denied on `.conductor/**` AFTER tree-relative
  normalization — an edit at `.conductor/state/worktrees/I2/src/a.ts` from the I2
  implementer session normalizes to `src/a.ts` and is ALLOWED, while
  `.conductor/state/worktrees/I2/.conductor/…` is denied; freeze denies an edit while a
  verify is in flight in the SAME tree and allows it in a different tree; write-shape
  matrix incl. read counterexamples `cat`, `grep`) → red → implement → green →
  commit `conductor: 5.2 edit gates`.

#### Task 5.3: Gate wiring in the plugin + fail-closed proof

**Files:** `conductor/adapter/tools.ts` (gate hookup half), `conductor/plugin/index.ts`
(hook bodies).

- [ ] Steps: failing tests driving the exported hook functions directly with synthetic
  inputs + a fixture session registry (no opencode needed): bash git deny throws with
  the core's reason; edit deny throws; an injected crash in `decideGit` during a git
  command still throws (fail-closed) and journals `gate-crash`; the same crash during
  `ls` allows and journals; every deny journals its input snapshot (the §7.4 law — the
  test greps the journal) → red → implement → green →
  commit `conductor: 5.3 gate wiring`.

---

### Phase 6 — Evidence engine

#### Task 6.1: `adapter/evidence.ts`

**Interfaces:** `runTest(runDir, itemId, {scope, testFiles, cwd, excludeTestFiles}) →
EvidenceRecord` — derives the command from the scope's `itemTest` template (§2.1
substitutions: `{files}`, `{dirs}`, `{name}`), applies the §2.1 zero-test guard
(a targeted run that executed no tests is neither red nor pass — falls back);
when no template exists (or the guard fires), runs the full scope command under the
§4.2 quarantine (`excludeTestFiles`)
and marks the record `targeted:false` so callers can apply the §2.1 fallback rule (the
failure excerpt must name a testScope file, else the red is illegal). Spawns, classifies
failure: exit≠0 with assertion-shaped output vs collection/import error — classification
by configurable regexes per runner with safe default: stderr containing
`SyntaxError|Cannot find|ImportError|collection error` ⇒ `"error"`;
`runVerify(runDir, itemId, config, scopePattern, {cwd, excludeTestFiles}) →
EvidenceRecord` (start-stamp AFTER quarantine, then everything else; build-before-test
per scope; timeout kills; runs in `cwd` — workspace or worktree; `excludeTestFiles` —
the shared-tree quarantine, §4.2: the named files are moved to `runs/<id>/quarantine/`
for the duration of the run and restored afterward, with a manifest replaying pending
restores after a crash; writes `verify-running-<treeKey>.json {pid,startMs}` inside the run dir
(treeKey = "main" or the worktree's item id), removed on completion — the freeze
gate's per-tree `verifyInFlightTree` source); both append to evidence.jsonl and
journal.

- [ ] Steps: failing tests with fixture commands (`node -e` exit 0/1, stderr shapes;
  timeout; build-fail ⇒ test provably not run (witness file); start-stamp ≤ a mid-run
  mtime; marker created/removed; killed run leaves marker → next runVerify breaks a
  stale marker (dead pid) with an anomaly; itemTest template substitution for BOTH
  `{files}` and `{name}` (basename-alternation case: `tests/parser_test.go` ⇒
  `parser_test`); no-template fallback marks `targeted:false` and the illegal-red rule
  fires when the excerpt names no testScope file; quarantine: `runVerify` with
  `excludeTestFiles` moves the named files into `runs/<id>/quarantine/` BEFORE the
  start-stamp and restores them after — a quarantined deliberately-red file provably
  not executed (witness), restoration on completion AND on the next run after a
  mid-verify kill (a quarantine manifest replays pending restores, mirroring the
  stale-marker healing)) → red → implement → green →
  commit `conductor: 6.1 evidence engine`.

---

### Phase 7 — Fan-out engine

#### Task 7.1: `adapter/fanout.ts` (against a FAKE SDK)

**Interfaces:** `createFanout(client, config, journal, registry)` →
`dispatch({role, lens?, itemId?, prompt, schemaName, priority}) → Promise<result>` and
`dispatchWave(jobs[]) → Promise<results[]>`. Behavior: per-model wave grouping (§4.1 —
jobs sorted/grouped by resolved model; next model's group awaits current's drain);
concurrency ≤ maxReaders; per-job watchdog (abort via SDK after
`parallel.subSessionTimeoutMs`);
schema validation on receipt with ≤2 re-prompt retries (validation errors appended to
the retry prompt); session registry entries (sessionID → {role, itemId}) for the gates;
journal events for dispatch/complete/retry/abort; results carry
{sessionID, value|error, timings}.

The FAKE SDK (`tests/fixtures/fake-sdk.ts`) implements create/prompt/abort/messages
with canned, per-test-programmable responses and records every call — the unit tests
never need opencode or a model.

- [ ] Steps: failing tests (wave ordering: mixed-model jobs dispatch AABB not ABAB —
  asserted on the fake's call order; retry on schema-invalid then success; two failures
  ⇒ env-failed result; watchdog aborts; registry populated and cleaned) → red →
  implement → green → commit `conductor: 7.1 fanout engine`.

#### Task 7.2: `adapter/router-client.ts`

**Interfaces:** `routerHealthy(routerCfg) → Promise<boolean>`;
`fetchMetricsSummary(routerCfg) → Promise<summary|null>` — strictly fail-soft: never
throws, null on any failure, journals at `debug`. Consumer: `conductor_report`'s
metrics section (Task 9.5).

- [ ] Steps: failing tests against a stub `node:http` server (healthy 200; 404;
  connection refused; hang past a 2 s internal timeout — each yields false/null
  without throwing) → red → implement → green → commit `conductor: 7.2 router client`.

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
  contains the seven ladder rungs; `receive-review.md` contains "verify before
  implementing" and bans "You're absolutely right"); no pack contains "TBD"/"TODO".
- [ ] Steps 2–4: red → write the packs → green.
  **Step 5:** Commit: `conductor: 8.1 doctrine packs`.

#### Task 8.2: `adapter/inject.ts`

**Interfaces:** `buildSystemAppend(registryEntry, run, items, packs) → string[]`
(role pack + ≤30-line state block naming the ONE legal next tool from
`gates-phase.ts`); `paramsForRole(role) → {temperature, topP?}`;
`headersFor(registryEntry, job?) → Record<string,string>` (§4.4 tags).

- [ ] Steps: failing tests (orchestrator gets core.md + state block; implementer gets
  tdd.md + its item block; state block stays ≤30 lines with 40 items (summarization
  asserted); next-tool line matches gates-phase for three run states AND names
  `conductor_setup` on an unconfigured repo; header set per role; missing pack file at
  init throws) → red → implement → green → commit `conductor: 8.2 injection`.

---

### Phase 9 — Tools + stage logic (the pipeline itself)

Each task: tool handler(s) in `adapter/tools.ts`, driven by unit tests through the FAKE
SDK + fixture repos. Handlers follow the invariant loop: legality → derive → persist →
journal → compact return.

#### Task 9.1: `conductor_classify` + `conductor_status` + `conductor_decide` + `conductor_surface`

- [ ] Steps: failing tests (classify dispatches classifier+skeptic on the fake,
  disagreement escalates to work, run.json embeds the check; a trivial classification
  synthesizes a one-item queue (fileScope + testScope) and enters EXECUTING flagged
  trivial (scopes taken from the classifier's proposedFileScope/proposedTestScope);
  trivial with empty proposed scopes or a count over trivialMaxFiles escalates to
  work (handler re-check); status renders; decide appends §2.7 record rejecting <2 scored options for
  kind:derived (Task 1.5's rule); surface blocks named items and continues) → red →
  implement → green → commit `conductor: 9.1 intake tools`.

#### Task 9.2: `conductor_decompose` + `conductor_plan`

- [ ] Steps: failing tests (decompose validates DAG/scopes/sizes; cycle rejected with
  re-prompt (fake returns a cycle then a fix); ponytail full-mode rejects minimal-code
  rung with empty reuse note; plan writes plan.md, extracts ≥2-option decisions into
  the ledger; placeholder strings in the fake's plan output are rejected with one
  bounded re-prompt) → red → implement → green → commit `conductor: 9.2 planning tools`.

#### Task 9.3: `conductor_plan_review` (the adversarial loop, plan-level)

- [ ] Steps: failing tests (4 lenses dispatched with lens-specific prompts (asserted on
  the fake); majors → K skeptics each; surviving major ⇒ planner re-prompted with
  findings, round increments; zero surviving majors ⇒ PLAN_REVIEWED; round cap ⇒
  surviving majors become surfaced questions and only untouched items proceed
  (blocked-set asserted)) → red → implement → green →
  commit `conductor: 9.3 plan review`.

#### Task 9.4: Item pipeline tools — `conductor_dispatch_wave`, `conductor_submit_test`,
`conductor_vet_test`, `conductor_mark_green`, `conductor_validate`,
`conductor_queue_amend` (created here because the BLOCKED escalation depends on it)

- [ ] Steps: failing tests, per §3.3's normative bullets, each enforced behavior one
  test: wave dispatch matches core/schedule; submit_test runs the test via evidence.ts
  and rejects failureClass "error" (fixture stderr) with bounded repair loop; an
  immediately-passing test is rejected and surfaces the ponytail-skip decision;
  vet_test fans out vetCritics with spec+test+red (and NOT impl — asserted absent from
  the fake's received prompt); mustFix loops bounded; mark_green re-runs the test,
  denies on exit 1; validate start-stamps, sets the per-tree marker (freeze gate
  consumes it — integration-asserted via gates test), and in shared-tree mode passes
  the §4.2 quarantine exclusion list — a wave sibling at RED AND a blocked prior-wave
  item at RED both provably do not fail item A's validate (fixture-asserted), while
  item A's own red test still does; two no-template fallback items in one wave reach
  GREEN without livelocking (the runTest quarantine case); DEBUG entry on failure
  injects
  debug.md into the implementer's next dispatch (asserted), debugFixCap ⇒ surfaced
  architecture question; queue_amend re-validates the DAG/scopes and records a
  decision; implementer BLOCKED escalates context → stronger model → re-split via
  `conductor_queue_amend` (decision recorded, asserted) → surfaced question → red →
  implement → green → commit `conductor: 9.4 item pipeline`.

#### Task 9.5: `conductor_item_review` + `conductor_publish` + `conductor_report` +
`conductor_inline_claim` + `conductor_override`

- [ ] Steps: failing tests: the §3.3 MANDATORY lens set always dispatches (a config of
  `itemReviewers: 3` still covers all five mandatory lenses via merging — asserted);
  trivial-run lens merging keeps the guardrail lens (asserted); surviving spec/contract
  findings ⇒ that round's quality-lens findings are discarded and re-derived after the
  fix (adjudication ordering asserted); skeptic verdicts per Task 1.3's
  `findingSurvives` rule (k=2 tie upholds); implementer pushback routes through one
  extra skeptic round; fix ⇒ re-validate ⇒ re-review bounded; publish stages the
  item's fileScope ∪ testScope changes (the resulting commit asserted to contain the
  item's test file), applies §2.1 format rules (stdin-mode fixture: dirty file rewritten +
  restaged; crashing formatter ⇒ publish denied, file untouched), auto re-verifies on
  stale freshness (fixture edits a file after verify started; the re-verify applies
  the same §4.2 quarantine exclusion rule as conductor_validate), denies generated
  messages carrying the §3.3 normative trailer denylist (generator-side test),
  read-only mode writes the batch into the report instead; report re-runs full verify
  fresh WITH the §4.2 exclusion list (testScope files of every non-PUBLISHED item
  below GREEN; mixed published+blocked fixture asserted, exclusions disclosed in
  report.md's blocked/deferred section), refuses while an item is
  unpublished-and-unblocked, writes report.md containing taints + deferred + surfaced
  + metrics (via Task 7.2's router client, stubbed), records stop done — and for a
  trivial run produces report-lite → TRIVIAL_DONE; inline_claim scopes edit permission (gate integration asserted) and
  records the decision; override records anomaly + taint + one-shot bypass (second
  action re-denied) → red → implement → green →
  commit `conductor: 9.5 review/publish/report`.

#### Task 9.6: `adapter/worktrees.ts` + parallel-writes integration

**Interfaces:** `createWorktree(workspace, itemId) → path` (`git worktree add
.conductor/state/worktrees/<itemId>`); `mergeBack(workspace, itemId) → {ok, conflict}`
(ff-only first, else a normal merge, executed by the handler); `removeWorktree(…)`.
Integration (per §4.2): under `parallel.writes: "worktrees"`, `conductor_dispatch_wave`
creates a worktree per wave implementer; the session registry binds that implementer's
edit scope to paths under its worktree; `evidence.runVerify` runs with `cwd` = the
worktree (per-tree markers, Task 6.1); `conductor_publish` under worktree mode runs its
stage/format/freshness/commit sequence with `cwd` = the item's worktree (same generated
message + trailer denylist), then merges back serially in item order and re-validates
each item against the integrated tree (`cwd` = workspace) before PUBLISHED; a merge
conflict demotes the later item to GREEN for re-validation.

- [ ] Steps: failing tests on fixture repos (create/remove round-trip; disjoint-scope
  ff merge; contrived conflict ⇒ demotion to GREEN asserted; post-merge re-validate
  provably runs in the integrated tree (witness file written by the fixture verify
  command); per-tree verify markers — a running verify in tree A does not freeze edits
  in tree B (gate integration); registry scope binding to worktree paths) → red →
  implement → green → commit `conductor: 9.6 worktree mode`.

---

### Phase 10 — Continuation + ask-gate

#### Task 10.1: `adapter/continuation.ts` + ask-gate wiring

- [ ] Steps: failing tests (idle on active run with legal next action ⇒ exactly one
  re-prompt naming that action (fake SDK asserts prompt text matches gates-phase);
  debounce; identical state signature ⇒ futile counter increments, any state change
  resets it; `futileRePrompts` reaching 3 ⇒ stop `noop` + `disengage` anomaly recorded
  and re-prompting stops (the single wedge detector — Task 1.3's rule, no separate env
  path); halt file ⇒ interrupt, no re-prompt; ANSWERED/TRIVIAL_DONE/REPORTED never
  re-prompted; a sub-session `permission.asked` event ⇒ `permission.reply` reject +
  NEEDS_CONTEXT conversion surfaced to the orchestrator; an orchestrator edit ask WITH
  an active inline claim covering the path ⇒ replied allow, WITHOUT ⇒ replied reject
  (§3.6); an orchestrator question journaled with Task 1.5's isHumanTerritory verdict)
  → red → implement → green → commit `conductor: 10.1 continuation + ask gate`.

---

### Phase 11 — llama-router (C++)

CMake restructure first, then module-by-module TDD with doctest. All router unit tests
run against in-process fakes (a stub upstream `httplib::Server` started by the test on
an ephemeral port); no model, no llama-server needed until the smoke task.

#### Task 11.1: Build scaffold + upstream contract check

- [ ] **Step 1:** CMakeLists: remove target `myprogram`; add `llama-router` (src/router,
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
  --no-shell` in a test harness, smallest installed model), verify and record in
  `src/router/UPSTREAM_CONTRACT.md` (`WIRE_CONTRACT_VERIFIED: 2026-08-07 …`): the
  `/v1/models` shape in router mode; `response_format`/`json_schema` acceptance and
  GBNF constraining (send a schema'd request, confirm conforming output); `usage` +
  `timings` fields present in non-stream responses; SSE chunk framing for streamed;
  behavior on requesting a non-resident model (router-mode autoload semantics — load
  latency visible). This is a MANUAL-run task step (documented command lines), not a
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

#### Task 11.5: `batcher` — swap batching + group affinity

- [ ] Steps: doctest red (resident-model tracking from dispatch history; ABAB arrivals
  under swapWindowMs dispatch AABB (stub records order); maxBatchHoldMs bounds any
  request's hold (asserted with fake clock — the batcher takes a clock interface,
  tests inject); same-group requests dequeue contiguously within a model class) →
  implement → green → commit `conductor: 11.5 batcher`.

#### Task 11.6: `schema-guard`

- [ ] Steps: doctest red (tagged request without response_format/grammar ⇒ 400 naming
  the header contract; untagged passes untouched; tagged non-stream response
  validated: conforming passes verbatim, non-conforming wrapped in the §4.4 error
  envelope with validator messages; streaming tagged responses pass through with a
  journal warning — validation of streams is out of scope, recorded in
  HONEST-LIMITS) → implement (json-schema-validator) → green →
  commit `conductor: 11.6 schema guard`.

#### Task 11.7: `metrics`

- [ ] Steps: doctest red (one JSONL line per request with §4.4's fields incl.
  queue-wait and usage token counts parsed from the upstream body; /conductor/metrics
  aggregates (count, p50/p95 wait per model); /conductor/health) → implement →
  green → commit `conductor: 11.7 metrics`.

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
  generation from chosen host/port; opencode fragment merge — deep merge, conductor
  keys win, `${LLAMA_HARNESS_ROOT}` substitution, baseURL rewrite to the router port
  when router enabled; `--no-router` leaves baseURL direct; supervisor backoff policy —
  a pure function: restart delays capped-exponential, reset on a healthy run) →
  implement: serve.py gains `--router/--no-router` (default: router when the binary
  exists) and launches llama-router under a small supervisor loop process (serve.py
  itself execs into the session shell and cannot supervise; the supervisor dies with
  the shell like the existing server watchdog), merges the fragment into the session
  opencode config it already writes; fetch_models' `config` subcommand regenerates the
  fragment-aware base config → green → commit `conductor: 12.1 serve wiring`.

#### Task 12.2: First-run repo setup flow

- [ ] Steps: red (unit: detection matrix package.json/CMake+ctest/pyproject/Cargo/go →
  proposed scopes, each detected runner carrying its default `itemTest` template
  (§2.1: node --test {files}; pytest {files}; ctest -R {name}; go test -run {name});
  smoke-spawn check fails on unspawnable command; git-mode question
  has NO default — the plugin, on first tool use in an unconfigured repo, surfaces
  exactly one interactive question (this is the sanctioned interactive ask);
  `.git/info/exclude` registration) → implement (plugin-side: `adapter/state.ts`
  first-run path + the `conductor_setup` tool — already in the §3.4 inventory, legal
  only while config is absent via Task 3.2's `repoConfigured` input, and named by the
  Task 8.2 injection as the next action) → green →
  commit `conductor: 12.2 first-run setup`.

---

### Phase 13 — End-to-end acceptance

#### Task 13.1: Scripted e2e (no model): the full pipeline on a fixture repo

- [ ] **Step 1:** `conductor/tests/e2e.test.ts` — drives the REAL plugin hooks + REAL
  handlers + REAL state/evidence/journal against a fixture git repo with a real (tiny)
  Node test suite, using the FAKE SDK programmed with realistic canned outputs for
  every sub-session in sequence: classify(work) → decompose(2 items, disjoint scopes)
  → plan → plan review (1 major, refuted; 1 major upheld → revision → clean round) →
  wave dispatch → I1: test submitted (first attempt import-error → repaired → legal
  red) → vetted (1 mustFix → fixed) → green → validated → review (1 finding upheld →
  fix → re-validate → clean) → published (REAL git commit in the fixture; message
  asserted trailer-free; commit content asserted to include the item's test file) →
  I2 same compressed → report (REAL full verify runs; report
  content asserted: taints/deferred/none, metrics present) → stop done. Along the way:
  an out-of-order tool call denied; an orchestrator edit denied; an edit during
  validate denied; an override exercised once and visible in the report. A second,
  compressed scenario classifies trivial and rides EXECUTING(trivial) through the full
  item FSM (merged lenses, guardrail lens present) to report-lite → TRIVIAL_DONE. A
  third scenario runs a two-item wave under `parallel.writes: "worktrees"` (Task 9.6
  integration: both implement concurrently in worktrees, serial merge-back,
  post-merge re-validation).
- [ ] **Step 2:** Red → glue fixes → green (this is the harness proving itself).
- [ ] **Step 3:** Commit: `conductor: 13.1 e2e scripted`.

#### Task 13.2: Live smoke (real opencode + smallest real model; manual-run, documented)

- [ ] **Step 1:** `scripts/serve.py` (router on), `cd` to a scratch repo, run opencode
  with a toy prompt ("add a slugify util with tests"). Observe and record in
  `conductor/SMOKE.md`: classification, decomposition, plan review round-trip, item
  TDD cycle with real model outputs surviving schema enforcement (note retry counts —
  this is the 9B-vs-schema stress test), publish commit, report, idle continuation
  firing at least once, `conductor_status` output.
- [ ] **Step 2:** Fix what breaks (each fix lands as its own red→green task-let with a
  test at the layer that failed). Commit: `conductor: 13.2 live smoke`.

---

### Phase 14 — POC evaluation (the point of all this)

#### Task 14.1: `scripts/conductor_bench.py`

- [ ] Steps: red (unit tests on the pure parts: task manifest load; result schema;
  scoring pass-through; every manifest entry parses and its hidden test command is
  spawnable) → implement: (a) author `bench/conductor-tasks.json` — 10 tasks with
  stated selection criteria: language mix (TS, Python, C++), difficulty spread from
  one-function to small-multi-file, each with a hidden test command that FAILS on an
  unmodified repo and is never shown to the model; (b) the driver: runs each task
  twice — **baseline** (plain opencode session, same model, no conductor plugin) and
  **conductor** (full pipeline), both headless (`opencode run`), collecting pass/fail
  on hidden tests, wall-clock, total tokens (router ledger), review findings caught,
  overrides used. Emits `.data/benchmark/conductor-report.md` with per-task and
  aggregate deltas → green → commit `conductor: 14.1 bench driver`.

#### Task 14.2: The POC run (manual)

- [ ] **Step 1:** Execute the 10-task comparison on this machine with the configured
  default models; commit the report. This number — quality delta vs token/wall-clock
  cost — is the POC's deliverable. Commit: `conductor: 14.2 POC run`.

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
  (tail metrics ledger; per-model lanes; swap markers) → green →
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
5. **Sub-model quality is a floor, not a gate.** A 9B reviewer upholding garbage
   findings costs fix-loop rounds; the skeptic layer and round caps bound the damage,
   and the bench (Phase 14) measures it instead of assuming it away.
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
9. **Router resident-model tracking is inferential** (dispatch history), not queried
   from the server; a human loading models out-of-band degrades batching efficiency,
   never correctness.
10. **macOS/Apple Silicon only for the POC** (G12 note); nothing gratuitously breaks
    Linux, nothing verifies it.

## §10. Stretch (explicitly OUT of the base build)

- Mutation-smoke on TEST_VETTED (kill an injected mutant before vetting passes).
- Seal/tamper-evidence over conductor's own files (lower value single-user; the git
  history of this repo is the audit trail).
- Cross-run memory (decision-ledger reuse across runs in a repo).
- Linux support + CI.
- Streaming schema validation in the router.
- Multi-machine fan-out (a second Mac serving a second model family).

## §11. Final acceptance checklist

- [ ] `node --test conductor/tests/` — all green, ≥ 20 test files.
- [ ] `ctest` on router-tests — all green.
- [ ] Purity guard + doctrine tests green (G3, §6 enforced mechanically).
- [ ] Scripted e2e (13.1) green — the full pipeline, gates, override, trivial path,
      worktree wave, and report proven through the real plugin against a real fixture
      repo.
- [ ] Live smoke (13.2) recorded in SMOKE.md — schema enforcement survived real
      local-model outputs; retry counts noted.
- [ ] POC report (14.2) committed with measured quality/cost deltas.
- [ ] serve.py: `--router` and `--no-router` both produce working sessions (G5).
- [ ] OPERATIONS.md + HONEST-LIMITS.md exist and match §9.
- [ ] `git log --oneline` shows one commit per task, each on a green suite.

## §12. Effort & reliability estimate

**Size:** ~34 TS modules+tests, ~7 C++ modules+tests, 2 Python modules+tests, 9 doctrine
packs, ~65 bite-sized tasks.

**Effort:** a strong frontier agent executing task-by-task: 3–5 focused days; order
6–12M tokens. Human involvement: the git-mode/setup answers, the three manual-run smoke
steps (11.8, 13.2, 14.2), and reading the POC report.

**Reliability, honestly:** TS core+gates+pipeline against the fake SDK: ~90% first-pass
(the wire contract is pinned by Task 0.2 before anything depends on it). Live-opencode
behavior: ~75–85% first-pass — the risk concentrates in plugin-loading via config path,
`{file:…}` prompt resolution, and structured-output field naming, ALL routed through
Task 0.2's discovery test so drift fails loudly at build time, not silently at runtime.
Router: ~85% (httplib streaming edge cases are the residue). Local-model schema
compliance under GBNF constraint is the POC's open question — that is what Phase 14
measures rather than promises.

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
  schema-guard (11.6); config keys in §2.1 consumed by named tasks only.
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

*(End of plan.)*
