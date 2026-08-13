# Frequently asked questions

Short answers to the questions this workspace actually raises, grouped by theme. Each
answer links to the page that covers the topic properly.

*These answers describe the system as designed; build state for every subsystem lives in
[project status](../developer/project-status.md).*

---

**General**

## What is llama-harness?

A self-contained macOS/Apple-Silicon workspace with two intertwined halves. The first is a
model harness: Python 3.9 stdlib-only scripts plus a pinned `llama.cpp` submodule that
install, verify, serve, and benchmark open-weight GGUF models locally and wire
[opencode](https://opencode.ai) to them. The second is conductor, an orchestration harness
running on top of opencode.

## What is conductor?

A TDD-enforcing, adversarially-reviewed orchestration harness for opencode. It turns a
prompt into a state machine the model can only advance by calling typed `conductor_*` tools
whose handlers re-derive the evidence themselves, with gates that deny out-of-order actions
and fresh-context sub-sessions that review work they never saw produced. See
[conductor overview](../user/conductor-overview.md).

## Why do both halves live in one repository?

Because they are one system. Conductor's serving model is one the harness installs and
validates, `scripts/serve.py` starts the server and injects the plugin into the session
config, and llama-router sits directly in front of the `llama-server` that `serve.py` runs.

## Why local models at all?

Two reasons. The POC exists to measure how much mechanical process enforcement plus parallel
adversarial review improves a *small* model's output, which is only an interesting question
for a model you can run yourself. And tokens are free locally, which makes constraint G12
payable — "token cost is accepted; wall-clock is engineered" — so no gate or review stage is
ever weakened to save tokens.

## Is this production software?

No. Conductor is a proof of concept, and the plan carries fifteen normative honest limits
(plan §9) rather than hiding them. The model harness half is different: built, working, and
in daily use. Read [gates and hatches](../user/gates-and-hatches.md) before relying on any
enforcement claim — the first limit is that gates fire inside opencode only.

## What platforms does it support, and what happens on Linux?

macOS on Apple Silicon, and nothing else is verified. Honest limit 10 states the posture
exactly: nothing gratuitously breaks Linux, nothing verifies it. The genuinely macOS-shaped
parts are the Metal memory arithmetic, the `iogpu.wired_limit_mb` sysctl, and the
`/var` → `/private/var` realpath rule. Linux support and CI are stretch (plan §10).

## What is the license, and what about the models?

The repository is MIT — see [LICENSE](../../LICENSE). Model weights are not: each catalog
entry records its own license, and they differ widely (MIT, Apache-2.0, Gemma Terms of Use,
NVIDIA Open Model License, and vendor-specific custom terms). The per-model license column
is in [models](../user/models.md).

---

**Models and serving**

## Which model should I start with?

`ornith-35b` is the strongest all-round agentic coder that fits comfortably.
`qwen3-coder-30b` is the fast daily driver at 3B active parameters, and `ornith-9b` or
`gpt-oss-20b` are quick enough for tight edit/test loops. Conductor itself serves
`qwen3.6-27b` for every role. Full catalog in [models](../user/models.md).

## Why one server for every model instead of one process each?

One `llama-server` in router mode reads the generated INI, publishes every installed model
at `/v1/models`, and loads or unloads weights on demand:

```bash
llama-server --models-preset .data/configs/llama-models.ini --models-max 1 --models-autoload
```

`--models-max 1` keeps one model resident, which is what makes switching models in opencode's
picker transparent; one process per model would hold several 25 GB models resident at once.

## What does "fits" versus "tight" actually mean?

| Label     | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `fits`    | weights plus headroom fit inside the Metal budget                               |
| `tight`   | weights fit, but headroom is thin — reduce `ctx-size`, or raise the wired limit |
| `too big` | will not load                                                                   |

Headroom matters because the KV cache and compute buffers sit on top of the weights and grow
with context length; the tool reserves about 18 % of the budget for them.

## Why is my 48 GB model not loading on a 64 GB machine?

Because macOS caps Metal allocation at roughly 75 % of RAM by default, leaving about 52 GB
for weights on a 64 GiB machine — and the KV cache is on top of that. Raise the wired limit
(it resets on reboot) and `list` recalculates automatically:

```bash
sudo sysctl iogpu.wired_limit_mb=57344   # 56 GB
```

## Are downloads trusted or verified?

Verified. Every install checks, in order: exact byte size against the HuggingFace file tree;
SHA-256 against the LFS `oid` HuggingFace publishes; GGUF magic and version, by parsing the
header; and shard-count consistency, where the `split.count` field in the GGUF metadata must
match the file count. `fetch_models.py verify` re-checks at any time.

## Why are the llama-* tools rebuilt so often?

Because they are built from the pinned `extern/llama-cpp` submodule and must never silently
drift from it. `fetch_models.py build` compiles nine binaries into `.data/tools/` and records
the submodule commit in `.data/tools/.build-stamp.json`; every `serve` and every `benchmark`
re-checks that stamp and rebuilds if it moved. When nothing moved, it is a no-op.

## Can I use a model that is not in the catalog?

Yes — append a `Model` entry to `CATALOG` in
[`scripts/models_catalog.py`](../../scripts/models_catalog.py). Quant sizes there are only
used for the offline `list` view; the real file list is resolved live at download time, so
you never hard-code filenames. Check the entry with
`scripts/fetch_models.py info <id> --remote`, which prints every quant the repo publishes.

## Why does the benchmark keep self-graded scores separate?

Because a model scoring its own output is not an independent quality measure. The three tiers
are objective (code executed against hidden tests), perplexity (no judge involved), and
self-graded; the last is never mixed into the objective score, and the interesting figure is
calibration, `self_score − objective`.

---

**conductor**

## Why not just tell the model to follow the process?

Because the failure modes *are* failures to follow prose. Plan §0.1 names six: optimistic
self-reporting, process amnesia near context limits, test-after theater, anchored self-review,
over-building, and shortcut-taking under difficulty. Constraint G9 therefore makes every
workflow obligation a schema-constrained output, a tool the model must call, or a gate that
denies the wrong action — never only an instruction.

## What is the difference between a run and an item?

A run is one prompt's lifecycle and moves through eight states from `INTAKE` to `REPORTED`
(or `ANSWERED`, or `TRIVIAL_DONE`). An item is one unit of work inside that run's queue and
moves through seven states from `PENDING` to `PUBLISHED`. The queue is per-prompt and
ephemeral, with no global backlog. See [state machines](../developer/state-machines.md).

## Why does the orchestrator refuse to edit code?

Constraint G8: the main session coordinates, sub-sessions implement. Its `edit` permission is
`"ask"` and the plugin rejects every ask not covered by an active `conductor_inline_claim`.
When inline work is genuinely right, the claim tool scopes the orchestrator's edit permission
to one item's `fileScope` and records that it happened; the item FSM still applies in full.

## Why is a test that passes immediately rejected?

Because it proves nothing. `conductor_submit_test` runs the test itself and requires a
non-zero exit with failure class `assertion` or `missing-subject` — the behavior was
evaluated and was wrong, or the subject this item is contracted to build does not exist yet. A
test that passes on submission means either the behavior already exists (recorded as a
decision; the item may be unnecessary) or the test is wrong. Class `error` is not a legal red
either, and goes back to the test-writer for repair.

## What is a non-behavioral item, and is it a TDD bypass?

An item with `behavioral: false` skips `RED` and `TEST_VETTED` and walks
`PENDING → GREEN → VALIDATED → REVIEWED → PUBLISHED`. It is not a bypass, because an item may
declare it only if **every** path in its `fileScope` is disjoint from
`verify.behavioralPaths`, and the decompose handler checks that arithmetic mechanically.
Without the path, "fix the typo in this comment" would have no legal trajectory at all. The
real caveat is honest limit 14: it is only as honest as `behavioralPaths`, which is why setup
asks for that list rather than defaulting it.

## Why does a reviewer never see the implementation when vetting a test?

Because there is no implementation yet, and that is the point. The `RED → TEST_VETTED` critics
get the item spec, the test diff, and the captured red output only, so they cannot be anchored
by code that already passes. Their lenses are fixed: asserts observable behavior rather than
internals, would fail for a subtly-wrong implementation, right level, pins acceptance, and an
anti-pattern scan.

## Why do findings have to survive skeptics?

Because a 27B reviewer that upholds garbage findings costs real fix-loop rounds (honest limit
5), and the cheapest defense is a second, independent opinion with the opposite posture. Each
finding faces `skepticsPerFinding` refuters in fresh sessions and survives only if upholds ≥
`⌈k/2⌉`; only survivors block the item.

## Why does a tie uphold a finding?

Because the two errors are not symmetric. A wrongly-upheld finding costs one fix round; a
wrongly-dropped finding ships the defect. A split panel means the claim is arguable, and an
arguable claim earns a fix round rather than a dismissal.

## What is taint, and why is the override budgeted?

`conductor_override {gate, reason}` is the deliberate escape hatch: it checks the budget,
records an anomaly, appends to the item's `taint[]`, and disables the named gate for exactly
one next action in the same session. Taint is permanent for the run and headlined in
`report.md`. It is budgeted at `maxOverridesPerItem: 1` and `maxOverridesPerRun: 2` because
the bookkeeping cost is paid by the *human* at reading time, not by the model during the run.
Over budget is an `env` stop: a gate that needs overriding twice in one run is a bug.

## Why is quarantine outside the repository?

Because `.git/info/exclude` hides a directory from git and from nothing else. The verify
command is the target repo's own, and every default the plan ships — `node --test`, `pytest`,
`go test ./...`, `ctest` — discovers tests by walking the tree, so a red test parked under
`.conductor/` is still run by the verify it was hidden from. Quarantine therefore renames
files to `<stateHome>/conductor/<workspaceKey>/quarantine/<runId>/`, with a manifest written
before any move so a crash replays the pending restores. Measured, not assumed:
[runner discovery](../../conductor/docs/RUNNER-DISCOVERY.md).

## Why does the wave driver own concurrency instead of the model?

Because a single opencode session executes tool calls sequentially. A dispatch that merely
marked a wave as ready would need the orchestrator model to emit concurrent tool calls, which
is exactly the behavior the design refuses to depend on. So `conductor_dispatch_wave`'s
handler drives the wave itself, one async pipeline per member, inside a single tool call. See
[scheduling and fan-out](../developer/scheduling-and-fanout.md).

## Why one model for every role?

Constraint G13. Under `--models-max 1` a role switch is a full weight reload, and roles
alternate per *stage*, not per wave — a single item's walk crosses the boundary four to six
times per review round. More importantly, mixing model sizes would confound the POC's
measurement: the quality delta has to be attributable to process, not to a bigger model doing
the reviewing. A role selects doctrine pack, sampling temperature, gate posture, and router
priority tag — never weights.

## Why is the router allowed to observe but never to reject?

Because layer 2 is fail-soft and layer 1 is fail-closed, and that direction is load-bearing
(G5). A request tagged `X-Conductor-Schema: required` that arrives without a schema field is
journaled, counted as `schemaMissing`, and proxied unchanged; response bodies come back
verbatim whatever the verdict. If the router could fail a request the direct path would have
served, "`--no-router` runs the identical process" would be false. Enforcing structured
output is the fan-out engine's job, and it runs in both configurations.

## What happens if the plugin fails to load?

opencode logs the failure and continues completely ungated — verified against the installed
binary, not assumed. Nothing in the session betrays the absence. So the plugin writes
`.conductor/state/alive.json` at init and the orchestrator's first response carries a
one-line banner, and the first rule of operations is: **no banner, no conductor**. A missing
doctrine pack is a startup error raised *before* the beacon is written, so the beacon's
absence proves init failed.

## Why can the model not spawn its own sub-agents?

Because a model-spawned session would be an unregistered, unscoped writer with no role and no
file scope. opencode's built-in spawn tool is denied per agent via
`agent.<name>.tools: {"task": false}`, and the session-registry gate denies it again in
*every* session, registered or not. Sub-sessions are created by the fan-out engine, which
registers each one's role and item before it can call anything.

## What happens when the model stops mid-run?

opencode has no pre-emptive turn-end hook, so continuation is re-entry rather than refusal. A
`session.idle` event on a non-terminal run with actionable work re-prompts the orchestrator
with the exact next tool call, derived from `legalTools` — the same source the doctrine
injection and the phase gate read. A re-prompt whose run-state signature is unchanged
increments `futileRePrompts`; reaching three records a `noop` stop plus a `disengage` anomaly,
writes the stop-report, and stops re-prompting.

## Can I run conductor in a directory that is not a git repository?

Yes. `conductor_setup` calls `gitio.isRepo`, and when it is false offers exactly one choice:
initialize a repo here, or run in no-git mode. No-git mode sets `git.mode` to `read-only`,
disables publish (items terminate at `REVIEWED` with their diff recorded in the report),
disables worktree mode, and drops the `HEAD` term from the freshness rule. Everything else —
the FSM, the gates, evidence, review — is unchanged.

## What happens to a red test that a run abandons?

It is recorded in the workspace-level stale-red registry, `.conductor/state/stale-red.json`,
which survives runs. Every later run unions that registry into its quarantine computation and
discloses the active entries at run start and in every report. Entries clear when the file is
deleted, when a later run drives the test green, or via `conductor_forget_stale`. Without this,
run 2's first validate would run run 1's leftover red and spend its fix budget hunting a bug
in code it never wrote.

## How do I unblock a run that is waiting on a question?

Answer it. `conductor_answer {questionId, answer}` records the answer, unblocks every item
that named that question, and journals the event — that is how a human resumes a blocked or
surfaced run without hand-editing state. Conductor only asks about human territory: taste,
money, irreversible external commitments, secrets, and genuine ties at the bottom of the
decision ladder. It never asks "shall I proceed?", and never for a derivable answer.

## Does conductor work with a cloud model?

Not in the base build. Nothing in the enforcement layer touches weights — the gates see tool
calls and sessions — but the surrounding machinery assumes the local stack: setup validates
`models.default` against the live `/v1/models` list, `serve.py` and llama-router are built
around the local `llama-server`, and G13 requires one model for every role. The `models.roles`
map is accepted by the schema, but a non-empty map logs a warning at init and sits outside the
tested surface.

---

**Development and testing**

## Why can I not run `node --test` directly?

Because on Node v26.7.0 it lies in two directions. A directory positional resolves as a module
and produces a bogus `MODULE_NOT_FOUND` "failure" that looks exactly like a legitimate red,
and a glob matching zero files exits 0 — a vacuous green. Use the wrapper:

```bash
bash scripts/test-conductor.sh                              # the whole suite
bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'
```

It parses the TAP trailer and fails unless `tests > 0` and `fail`, `cancelled`, `skipped`, and
`todo` are all zero, and unless no `# SKIP`/`# TODO` directive appears at any subtest depth —
describe-level skips are invisible to the trailer counts. It then runs `tsc --noEmit`, the Bun
smoke, and regenerates the JSON Schemas.

## Why does the plugin have zero runtime dependencies?

Constraint G1. opencode loads the `.ts` source directly, so there is no bundler and no build
step, and `@opencode-ai/plugin` is a types-only dev dependency. A runtime dependency is a
thing that can fail to resolve inside somebody else's session, and a plugin that fails to load
is a session that runs completely ungated.

## Why erasable TypeScript only?

Constraint G2, which follows from the previous answer. Node's type stripping runs the same
files opencode loads, so no `enum`, no `namespace`, no parameter properties, and no
`const enum` — and imports between our files carry explicit `.ts` extensions. One
`tsconfig.json` with `"erasableSyntaxOnly": true` pins it mechanically.

## What is the pure-core / thin-adapter rule and what does it buy?

Constraint G3. Every policy decision is a pure function of the form
`(parsedInput, stateSnapshot) → decision` in `conductor/core/`, and core modules import only
other core modules — never `node:fs`, `node:child_process`, the opencode client, or `Bun`.
All I/O lives in `conductor/adapter/`, and a purity test enforces the split. What it buys is
the debuggability law: every deny and every FSM refusal is reproducible from its journaled
input snapshot through the same pure function, in a test.

## Why is there a Bun test as well as Node tests?

Because adapters run under two runtimes: opencode's Bun in production, Node's type stripping
in tests (G14). Adapters therefore use only Node-compatible built-ins and never the Bun shell
`$`. All-Bun testing was rejected because Bun lacks the `node --test` ergonomics; Node-only
testing was rejected because the production runtime would then go unexercised until the end of
the build. One smoke test runs the state store and journal assertions under Bun, early.

## Why must I build a named CMake target?

Because a bare `cmake --build` also compiles the whole vendored `extern/llama-cpp` tree. The
subtree is added with `add_subdirectory` so its configure runs, but nothing here links it —
`llama-router` proxies to a separately-launched `llama-server` and needs neither `llama` nor
`ftxui` — so that build is minutes spent on artifacts no target consumes. Always name the
target; the valid ones are `llama-router`, `router-tests`, and `membench`:

```bash
cmake --build .out/build/clang-relwdebinfo --target llama-router
```

## Why does every C++ include name a path under `src/`?

Because `src/` is the only user-code include root on both C++ targets, so an include names
where the header actually lives regardless of which file includes it:
`#include "router/version.hpp"`, never `#include "version.hpp"`. The rule applies to every
file under `src/`, headers included.

## Where do the JSON Schemas come from, and why are two languages reading them?

`conductor/core/types.ts` is the single source: every schema in the plan exists there as a
TypeScript type and a JSON Schema. `conductor/tools/export-schemas.ts` writes them out to
`src/tests/schemas/` (gitignored) so the C++ router's validator checks bodies against the same
definitions the plugin enforces, not a hand-copied second version. The export runs as part of
`scripts/test-conductor.sh`. See [schemas](../developer/schemas.md).

## How do I add a new conductor tool, doctrine pack, or review lens?

A tool is a pure decision function in `core/`, a legality row in `core/gates-phase.ts`, and a
handler in `adapter/tools.ts` that checks legality, re-derives its own evidence, writes state
and journal atomically, and returns a compact result — handlers are the only writers of run
and item state. A doctrine pack is a markdown file in `conductor/doctrine/` under 120 lines,
plus the delivery signal in `adapter/inject.ts` that appends it for the right role; a pack
loaded but injected to no session is dead weight. A review lens extends the item-review lens
set, where the five mandatory lenses are never truncated. See
[extending](../developer/extending.md).

---

**Status**

## How current are these docs?

They describe the system as designed. The plan is the specification and the code is the
reality; where they differ, the code wins and the deviation is recorded in
[HANDOFF.md](../build/HANDOFF.md) and [STATE.json](../build/STATE.json). One older document,
`docs/prompt-lifecycle.md`, is marked stale by HANDOFF and should not be read as current.

## Where do I read the design?

[The conductor harness plan](../plans/2026-08-07-conductor-harness-plan.md) — 3399 lines,
revision 5, and immutable; sections are cited throughout these docs as `plan §N.N`. Two
companions matter almost as much: [`conductor/DECISIONS.md`](../../conductor/DECISIONS.md)
for the standing decisions and the options each one beat, and
[`conductor/adapter/wire-notes.md`](../../conductor/adapter/wire-notes.md) for what the
installed opencode binary actually does, including where it disagrees with the plan.

## Where do I check what has landed?

[Project status](../developer/project-status.md) is the single authoritative page for what is
built, what is next, and what is deferred. Behind it sit [HANDOFF.md](../build/HANDOFF.md) for
the current working state, [STATE.json](../build/STATE.json) as machine truth,
[CORRECTIONS.md](../build/CORRECTIONS.md) for defects found and fixed during the build, and
[docs/reviews/](../reviews/) for the review records.

---

## See also

- [User guide](../user/README.md) — installing, serving, running conductor
- [Developer guide](../developer/README.md) — architecture and internals
- [Project status](../developer/project-status.md) — what is built today
- [Troubleshooting](../user/troubleshooting.md) — when something is actually broken
- [`scripts/README.md`](../../scripts/README.md) — the deep reference for the model harness
