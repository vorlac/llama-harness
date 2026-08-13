# Extending conductor

Recipes for changing the system: adding a tool, a gate rule, a doctrine pack, a review lens, a
role, a schema, a router module, a verify ecosystem, a model, a benchmark preset — and adapting
the whole workflow to something that is not "write software with tests". For developers working
inside this repository.

## The shape of every recipe

Every recipe below has the same five parts, because every change lands the same way.

| Part                       | What it means                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What you are adding        | The one thing. If it is two things, it is two changes.                                                                                                                                   |
| Files, in order            | The order matters: the declaration before the consumer, the test before both.                                                                                                            |
| The test you write first   | G4 has no exceptions. The test goes red *before* the subject exists, and the red must be a legal red — an assertion failure or a missing subject, never a crash in the test file itself. |
| Gates that must stay green | Always the canonical gate; usually one narrower glob you run while iterating.                                                                                                            |
| The trap                   | The thing that bites people. Read it before you start, not after.                                                                                                                        |

The two gates:

```bash
bash scripts/test-conductor.sh                              # the whole suite + typecheck + bun + schema export
bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'   # one slice, while iterating
bash scripts/conductor-gate.sh                              # mechanical stub scan
```

Never run `node --test` directly for a gate decision. A directory positional resolves as a module
and produces a bogus `MODULE_NOT_FOUND` that looks exactly like a legitimate red, and a glob
matching zero files exits 0 — a vacuous green. The wrapper parses the TAP trailer and fails unless
`tests > 0` and `fail`, `cancelled`, `skipped`, and `todo` are all zero, with no `# SKIP`/`# TODO`
directive at any subtest depth. A green run of it is four things, not one: the trailer,
`tsc --noEmit`, the Bun dual-runtime smoke, and the JSON Schema regeneration into
`router/tests/schemas/`.

## Add a `conductor_*` tool

**What you are adding.** One more way to advance the state machine. There is no other way to
advance it: handlers are the only writers of run and item state.

**Files, in order.**

1. [`conductor/tests/gates-phase.test.ts`](../../conductor/tests/gates-phase.test.ts) — the
   legality row, as a case. Then a handler test alongside the existing
   `conductor/tests/tools-*.test.ts` files.
2. [`conductor/core/gates-phase.ts`](../../conductor/core/gates-phase.ts) — a name constant and
   the row that legalizes it. This file names only the tools it can legalize; the four hatch and
   maintenance tools (`conductor_queue_amend`, `conductor_inline_claim`, `conductor_override`,
   `conductor_forget_stale`) are absent from it deliberately.
3. [`conductor/adapter/tools.ts`](../../conductor/adapter/tools.ts) — add the exact name to
   `CONDUCTOR_TOOL_NAMES`, then write `handleYourTool`.
4. [`conductor/core/journal-events.ts`](../../conductor/core/journal-events.ts) — register any new
   event name under its component. `isKnownEvent` is checked on every journal write, so an
   unlisted name is caught at its source rather than leaking under a name no test can grep.
5. [`conductor/plugin/index.ts`](../../conductor/plugin/index.ts) — a `specs` entry: a one-line
   description and the zod arg shape built from `tool.schema`. The tool map is built *from*
   `CONDUCTOR_TOOL_NAMES`, so a name you forget here still registers, with an argument-free
   definition.

**The handler's four obligations.** In this order, every time:

1. **Check legality** — `legalTools` for the phase gate, `legalRunTransition` for the FSM edge, or
   both. Legality runs *before persist* and before a single sub-session is spent: a rejected call
   leaves no queue.json, no ledger line, no item, and the run in the state it started in.
2. **Re-derive its own evidence** — the handler runs the command, the diff, the verify. A model's
   claim is never the record.
3. **Write state and journal** — state only through the `StateStore`
   (`saveRun`, `saveItem`, `setBlocked`, `setDeferred`, …); handler-owned ledgers through
   `writeFileAtomicSync` for whole documents and a plain JSONL append for `decisions.jsonl`. Never
   through `state.ts`'s private evidence appender — `adapter/evidence.ts` is the only writer of
   `evidence.jsonl`.
4. **Return a compact result** — the shape the model reads back. Small, and named.

**Gates.** `bash scripts/test-conductor.sh`. `gate-wiring.test.ts` asserts that the names the
plugin registers are exactly the inventory, so a rename in one place is a red in the other.

**The trap.** Every handler lives in one file. Two queue items that each add a tool therefore
share a `fileScope`, `scopesIntersect` reports a conflict, and the wave scheduler will never put
them in the same wave. Tool work lands serially. That is a cost of the single-file layout, not a
bug in the scheduler — plan for it when you decompose.

## Add or change a gate rule

**What you are adding.** A row in a deny matrix. Gates live in the pure core
([`gates-git.ts`](../../conductor/core/gates-git.ts),
[`gates-edit.ts`](../../conductor/core/gates-edit.ts),
[`gates-phase.ts`](../../conductor/core/gates-phase.ts)); `gateBeforeToolCall` in
[`adapter/tools.ts`](../../conductor/adapter/tools.ts) only sequences them.

**Files, in order.** The test file for that gate, then the core module. Nothing else — if a gate
change needs an adapter change, the decision has leaked out of the core.

**The table-row-as-test discipline.** Each row of the matrix is one case, and the git suite is
biased toward proving deny for a stated reason: a missing allow row only annoys a model, which
surfaces a question; a missing deny row lets `git apply` write arbitrary files straight around the
edit-scope gate.

**The default-deny posture.** Three places default to deny, and all three must stay that way:

| Gate             | Default                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git policy       | Any subcommand not on the read-only allow-list denies, naming the rule and the legal alternative.                                                       |
| Edit scope       | An unknown role has no edit scope; edits are denied.                                                                                                    |
| Session registry | An unregistered session may read; every write-shaped and every `conductor_*` call denies. Spawning (`task`) denies in every session, registered or not. |

**The false-positive test that must accompany any widened allow.** Widening an allow is where
gates break. `branch` is on the read-only allow-list — and `git branch -D x` must still deny. So
every widened allow ships with a paired case proving the destructive or adjacent form still
denies. Write that case first; it is the one that fails when the widening is too wide.

**Gates.** `bash scripts/test-conductor.sh 'conductor/tests/gates-*.test.ts'` while iterating,
then the whole suite.

**The trap.** Two of them. Match parsed tokens, never a substring regex — detection has to see
through env-assignment prefixes, one wrapper (`env`/`command`/`sudo`/`builtin`/`exec`), and path
basenames. And the fail-closed disposition is decided by a `guarded` flag computed from the *real*
parse (a git segment present, a write shape present, or the tool itself writes, advances state, or
spawns), not from the gate that crashed — so a new gate guarding something the flag cannot see
fails *open* on a crash.

## Add a doctrine pack

**What you are adding.** One more always-on instruction block appended to a role's system prompt
on every request. Not an optional skill — a local model self-activates an optional skill
approximately never.

**Files, in order.**

1. [`conductor/tests/doctrine.test.ts`](../../conductor/tests/doctrine.test.ts) — an anchor test
   that pins the pack's normative sentences verbatim. Anchors are what stop a pack from drifting
   into vague encouragement.
2. `conductor/doctrine/<name>.md` — the pack itself.
3. [`conductor/adapter/inject.ts`](../../conductor/adapter/inject.ts) — add the filename to
   `REQUIRED_PACKS`, and to `ROLE_PACKS` for the role that receives it.

**The length ceiling.** 120 lines, asserted for every pack. The current nine run 56–102 lines. No
pack may carry a placeholder marker (`TODO`, `TBD`), and none may name a client — `opencode`,
`claude`, and `cursor` are all forbidden strings, because model-facing text is client-agnostic.

**The role that receives it, and the signal that delivers it.** `ROLE_PACKS` maps a role to its
pack list; `append[0]` is the primary doctrine and the live state block is always last. Delivery
can also be conditional: `debug.md` is appended only when the session's role is `implementer`
*and* its active item carries the debugging annotation. If your pack is conditional, that
condition is a signal you must thread from the registry entry or the item, and it needs its own
test.

**Gates.** `bash scripts/test-conductor.sh 'conductor/tests/doctrine.test.ts'`, then
`inject.test.ts`, then the suite.

**The trap.** `REQUIRED_PACKS` and `ROLE_PACKS` are different lists, and only the first is
fail-closed. `receive-review.md` is loaded and cached at init but no role list names it — it is
present, valid, and undelivered. Adding a pack to `REQUIRED_PACKS` alone gets you a startup
requirement, not an injection. Adding it to neither and referencing it from `ROLE_PACKS` gets you
a silently skipped pack: `buildSystemAppend` appends only packs it finds in the cache.

## Add a review lens

**What you are adding.** One more instrument over the same artifact. Lenses are not samples of one
judgement — each reviewer is told its lens and told the others are held by someone else.

**Where the lens sets are defined.** The plan-level set is `PLAN_REVIEW_LENSES` in
[`adapter/tools.ts`](../../conductor/adapter/tools.ts): correctness, completeness, decomposition,
minimality, each a `{id, charge}` pair. The item-level set is the six of plan §3.3 —
spec/contract, correctness, guardrail, test-adequacy, minimality/simplification, perf.

**Mandatory versus optional.** The first five item-review lenses are mandatory and are never
truncated by configuration; perf is added when `itemReviewers` reaches 6. Merging never drops a
mandatory lens.

**The merge order below six.** Sessions are `clamp(itemReviewers, 3, 6)`. At 6 each lens gets its
own session; below 6, lenses merge pairwise from the tail of the priority list.

| `itemReviewers` | Composition                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------- |
| 6               | one session per lens                                                                          |
| 5               | minimality + perf merge                                                                       |
| 4               | test-adequacy also joins spec/contract                                                        |
| 3               | spec+correctness, guardrail+minimality, test-adequacy+perf (also the trivial-run composition) |
| < 3             | clamps to 3 with a journal warning                                                            |

**The path-routing consequence.** Surviving findings are routed by the paths their fix touches,
not by the lens that raised them: `fileScope` only goes to the implementer; anything touching
`testScope` goes to the test-writer, and that changed test re-enters the test discipline (re-run,
re-vet) before re-validate; both goes to the test-writer first. So a new lens must be honest about
where its fixes land. A lens whose findings are about tests but which routes to the implementer
produces a guaranteed deny — the implementer is gated to `fileScope` — then three wasted review
rounds and a surfaced question.

**Gates.** The plan-review lens fan-out asserts lens-specific prompts, so adding a lens changes
that assertion; then the suite.

**The trap.** Coverage is floored at the lens count: the plan-review roster is
`max(readFanout("planReview", config), PLAN_REVIEW_LENSES.length)`. Sizing by the reader clamp
alone silently dropped lenses whenever `parallel.maxReaders` fell below four, and at
`maxReaders: 0` dispatched nothing while still advancing the run to `PLAN_REVIEWED`. So adding a
lens raises the *floor* on sub-sessions per round, forever — a token cost paid on every review,
which is why a lens is a design decision rather than a line of prompt text.

## Add a role

**What you are adding.** A new kind of sub-session. Under G13 every session runs
`config.models.default`, so a role selects doctrine, sampling, gate posture, and router priority —
never weights.

**The four table entries a role must supply**, all in
[`adapter/inject.ts`](../../conductor/adapter/inject.ts) except the gate posture:

| Entry                | Where                                                         | Fallback if you forget                       |
| -------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| Doctrine pack(s)     | `ROLE_PACKS`                                                  | `core.md`                                    |
| Sampling temperature | `ROLE_TEMPERATURE`                                            | `0.4`                                        |
| Router priority tag  | `ROLE_PRIORITY` → the `X-Conductor-Priority` header           | `interactive`                                |
| Gate posture         | `gates-edit.ts`: a scope arm, or membership in `READER_ROLES` | **deny** — an unknown role has no edit scope |

**The agent definition.** [`conductor/opencode-fragment.json`](../../conductor/opencode-fragment.json)
gets an agent entry: `mode` (`primary` or `subagent`), a one-line `description`, a `permission`
block (`question: "ask"`, plus `edit: "deny"` for read-only roles), and — non-negotiable —
`"tools": { "task": false }`, the per-agent spawn denial. `fragment.test.ts` pins this file's
contents, so the test is where you start.

**The registry entry.** A session is `{ role, itemId?, tree? }`. The fan-out engine writes the
entry *before* the sub-session's first prompt (registry-before-prompt); the `chat.message` hook
writes the orchestrator's. A session with no entry is unregistered and its writes are denied.

**Gates.** `fragment.test.ts`, `inject.test.ts`, `gates-edit.test.ts`, then the suite.

**The trap.** The same role has three spellings, and each table is keyed independently: the
injection tables use `testWriter`, the edit gate uses `test-writer`, and the opencode agent is
`conductor-test-writer`. Three of the four lookups fall back silently on a miss — you get
`core.md`, temperature 0.4, and `interactive` priority with no error anywhere. Only the edit gate
fails loudly, by denying. Write the injection test first; it is the one that catches the typo.

## Add a schema

**What you are adding.** A new payload shape that both TypeScript and the router agree on.

**Files, in order.** [`conductor/tests/types.test.ts`](../../conductor/tests/types.test.ts), then
[`conductor/core/types.ts`](../../conductor/core/types.ts) — **once**. The TS interface, the
hand-written JSON Schema object, and the `SCHEMAS` registration all live in that one file, next to
each other.

**Keep the validator subset.** Schemas may use only six keywords: `type`, `required`, `enum`,
`properties`, `items`, `additionalProperties`. `validate` scans the schema recursively *before* it
looks at any data and reports any keyword outside the subset, at any depth — never a silent
ignore. Tuple-form `items` is rejected on purpose: it is 2020-12 `prefixItems`, which the router's
full validator implements and this subset does not, and accepting it would let the two validators
disagree about the same payload. A cross-field rule that no subset keyword can express is
hand-coded in `validate` — the `Classification` rule tying `trivialItem` to `kind: "trivial"` is
the worked example.

**Let the gate regenerate the exported file.** `scripts/test-conductor.sh` runs
`node conductor/tools/export-schemas.ts router/tests/schemas`, writing one
`<Name>.schema.json` per entry. Those files are generated and gitignored. Never hand-write one:
the C++ router tests byte-read them, and a hand-edited copy is exactly the drift the export step
exists to prevent.

**Add the consumer.** A schema with no consumer is dead weight. Either a `schemaName` on a
`FanoutJob` — remember that structured output is prompt-shaped and independently validated by the
fan-out engine, because opencode 1.18.15 has no working `format` field — or a router-side
validation that reads the exported file.

**Gates.** `types.test.ts`, `export-schemas.test.ts`, and `single-source.test.ts`, which pins the
run and item state vocabularies against the FSM modules so a state added in one place and not the
other goes red.

**The trap.** `additionalProperties: false` means the validator rejects an unexpected key. That is
what you want for a persisted record and a hazard for a model-authored payload: a well-meaning
extra field turns into a schema rejection and a re-prompt. Decide which one you are writing.

## Add a router module

*The router today parses its config and reports its version; the proxy, admission control,
affinity, schema observation, and metrics modules land at tasks 11.3–11.8.*

**What you are adding.** A C++23 translation unit under `router/`.

**Files, in order.**

1. `router/tests/<name>_test.cpp` — a doctest suite written against the exact API you intend to
   produce. `router/tests/config_test.cpp` is the model: it opens with the target header's full
   declaration in a comment block, and every name in it is asserted below.
2. `router/<name>.hpp` (and `.cpp` if it needs one).
3. [`CMakeLists.txt`](../../CMakeLists.txt) — add sources to the `router-tests` source list, and to
   `llama-router` if the binary needs them. The doctest binary is registered whole:
   `add_test(NAME router-tests COMMAND router-tests)`.

**The include rule.** `src/` is the only user-code include root on both targets, so every
in-workspace header is included by its full path relative to `src/`: `#include "router/config.hpp"`,
never `#include "config.hpp"`. An include then names where the header actually lives, no matter
which file includes it.

**The constraint every new module inherits.** The router is fail-soft and it *observes*. It never
returns a status the direct path would not have returned; its schema guard records and does not
reject. `serve.py --no-router` must run the identical process, just slower. If your module can
change the outcome of a request, it belongs in layer 1, where the gates are.

**Gates.**

```bash
cmake --build .out/build/clang-relwdebinfo --target router-tests
ctest --test-dir .out/build/clang-relwdebinfo
```

**The trap.** Build only `--target llama-router`, `--target router-tests`, or `--target membench`.
A bare `cmake --build` also compiles the whole vendored `extern/llama-cpp` tree, which no target
here links. The other trap is validation shape: parse against the schema file
you are handed, never a copy of the shape baked into the parser.

## Support a new verify ecosystem

**What you are adding.** The ability to run, classify, and target a test runner conductor has not
met.

**Files, in order.** [`conductor/tests/evidence.test.ts`](../../conductor/tests/evidence.test.ts),
then [`conductor/adapter/evidence.ts`](../../conductor/adapter/evidence.ts), then the setup
proposals.

**The scope command.** A named entry in `verify.scopes` with `command` and `timeoutMs`, plus a
`verify.requiredScopes` row mapping a path pattern to the scopes that path selects. That is what
decides which scopes run for a changed file.

**The `itemTest` template, and which substitution it needs.** This is the choice people get wrong.
Pick by the runner's *targeting model*, not by taste:

| Token     | Expands to                                                   | Use when                                                                     |
| --------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `{files}` | each `testScope` file as its own argv entry                  | The runner takes file paths: `node --test {files}`, `pytest {files}`.        |
| `{dirs}`  | the unique parent directories, in `./dir` form               | The runner targets packages, not files: `go test {dirs}`.                    |
| `{name}`  | an alternation regex over the basenames, extensions stripped | The runner's registered test names contain the file name: `ctest -R {name}`. |

Go is the cautionary tale. `go test -run` matches test *function* names; handed file basenames it
matches nothing and exits 0 with zero tests run — a vacuous green that looks like a pass. That was
reproduced, not assumed, and it is why package-dir targeting is the go default.

**The `zeroTestPatterns`.** Add a `RunnerProfile` to `RUNNER_PROFILES`: a `runner` name, `rules`
(`unresolvedPatterns` and `assertionPatterns` as regex *sources*, never code, plus
`dotsAsSeparators` where dotted module names are path separators), and `zeroTestPatterns`. These
are the strings that prove a targeted run executed nothing — node's `# tests 0`, pytest's
`collected 0 items`, go's `no test files`, ctest's `Total Tests: 0`. On a match the run is neither
a legal red nor a pass: the handler falls back to the quarantined full-scope run plus the
excerpt rule. Then extend `detectRunner`, which keys off the command's argv; the fallback for an
unrecognized command is the node profile, whose tight patterns bin an unfamiliar crash as `error`.

**The `behavioralPaths` proposal.** Setup proposes a value per ecosystem and asks the user to
confirm or correct it, because a wrong value is the difference between an enforced TDD law and an
optional one. The existing proposals: node `src/**`, `lib/**`; python `<pkg>/**`; go `**/*.go`
minus `**/*_test.go`; cmake `src/**`, `include/**`. Your ecosystem needs one, and it needs to be a
proposal rather than a default.

**Gates.** `evidence.test.ts` asserts every runner profile ships zero-test patterns; then the
suite.

**The trap.** Quarantine assumes the runner walks the tree. Moving a file aside only hides it if
the runner would have discovered it by walking — which is why quarantine moves files *outside the
repository* rather than relying on `.git/info/exclude`, and why the assumption was measured per
runner. See [`conductor/docs/RUNNER-DISCOVERY.md`](../../conductor/docs/RUNNER-DISCOVERY.md)
before you assume yours behaves.

## Add a model to the catalog

**What you are adding.** One `Model` entry in
[`scripts/models_catalog.py`](../../scripts/models_catalog.py), appended to `CATALOG`.

**The fields.** Required: `id`, `repo`, `title`, `category` (one of the five in `CATEGORIES`),
`params`, `license`, `context`, `quants`, `default_quant`, `notes`. Optional: `serve_ctx`
(defaults to 32768, deliberately well below `context` because KV cache is what pushes a model over
the memory budget), `tool_call` (defaults true), `reasoning`, `vision`, `embedding`, `reranker`,
`mmproj`, `experimental`, and `sampling` (extra llama-server preset keys, de-dashed CLI option to
value).

`quants` maps a quant token to its measured total size in GB — the sum of all shards, measured
against the HuggingFace file tree API, not estimated. The token is matched against the repo's real
file tree at download time by `match_quant`, which understands root-level single files, root-level
shards, quant-named directories, and full-name directories.

**Then re-run list.**

```bash
scripts/fetch_models.py list          # catalog + what fits this machine
scripts/fetch_models.py info <id>
scripts/fetch_models.py install <id>
```

**The trap.** `default_quant` must be a key in `quants` — `default_size_gb` indexes it directly.
And set `experimental=True` for exotic quant formats or brand-new architectures that may need a
newer llama.cpp than the pinned submodule; experimental models are excluded from bulk installs,
which is the point.

## Add a benchmark preset or task

**What you are adding.** Either a named configuration that answers a question, or a piece of work
every model in a category competes on. Both live in
[`scripts/bench_presets.py`](../../scripts/bench_presets.py).

**A preset** is a `Preset` appended to `PRESETS`: `name`, `focus` (the question it answers — it is
printed in the report, so write it as a question), and then either `sampling` or
`use_author_sampling=True`, over a `runtime` dict. The two dicts are not interchangeable:

| Class      | Cost                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `runtime`  | llama-server/llama-cli flags fixed at load time. Changing one forces a full model reload — around 30 s on a 30 GB model. |
| `sampling` | Per-request. Free to change.                                                                                             |

The runner groups runs by `runtime_key`, so each distinct runtime configuration is loaded exactly
once and sampling is swept within it. A preset that varies one runtime flag buys a whole extra
load — which is why the existing ten are deltas from a single control rather than a cross-product.

**A task** is a `Task` appended to `TASKS`: `id`, `category`, `scoring`, `prompt`, and the fields
its scoring tier requires — `tests` for `exec`, `expect_symbols` for `symbols`, `judge_rubric` for
`judge`, `needs_image` for the vision task.

**What must stay consistent.** `TASKS_BY_CATEGORY` is keyed by category, so there is exactly one
task per category and a second entry silently shadows the first. The category must be one of
`CATEGORIES` or carry an entry in `PLACEHOLDER_CATEGORIES`, which exists so the report can say
"not benchmarked because nothing can run it" rather than quietly omitting a category. And the tier
ordering is the point: `exec` beats `symbols` beats `judge`, and a self-graded score is never
mixed into the objective one — the interesting number is the calibration gap between them.

## Adapt conductor to a different workflow

This is the important recipe, and it starts with a distinction.

**Knobs designed to be turned.** `.conductor/config.json` in its entirety: `verify.scopes`,
`verify.behavioralPaths`, `verify.requiredScopes`, the `format` rules, the three `git` keys, every
`workflow` count, `parallel`, `models`, `ponytail`, `retention`, `logging`. The *contents* of a
doctrine pack. A lens's `charge` text. The values in the roles tables.

**Load-bearing — do not turn.** The two FSMs and their edges. The gate order and the fail-closed
posture. The rule that the handler re-derives its own evidence. The single-writer rules (handlers
own state, `evidence.ts` owns the evidence ledger). The existence of the override budget. The
plugin module exporting only plugin functions. Injection being always-on rather than opt-in.

A workflow adaptation that touches only the first list is configuration. One that touches the
second is a change to conductor, and it needs the recipes above.

### Sketch: a docs-only or prose workflow

**Change.** Point `verify.scopes` at a prose toolchain — a link checker, a markdown linter, a
style checker — with `requiredScopes` mapping `**/*.md` to those scopes. Set `verify.behavioralPaths`
to the globs whose content you genuinely verify. Everything outside them becomes the
non-behavioral path: items travel `PENDING → GREEN → VALIDATED → REVIEWED → PUBLISHED`, skipping
`RED` and `TEST_VETTED` entirely. Rewrite the lens charges for prose, and substitute the doctrine
that carries the test law — `tdd.md` and `test-vet.md` — with the prose equivalent.

**Do not change.** The disjoint-path rule that governs `behavioral: false`. An item may declare
itself non-behavioral only if *every* glob in its `fileScope` is disjoint from `behavioralPaths`,
and `conductor_decompose` rejects a violation by name, quoting the intersecting glob. Do not
empty `behavioralPaths` to make life easier: an empty list makes every item legally
non-behavioral, and the TDD law becomes advisory in one edit.

**What you give up.** Red-before-green evidence for everything outside `behavioralPaths`, and the
vet stage along with it — a non-behavioral item never reaches `RED`, so no critic ever judges a
test that was never written. Review, skepticism, verify, freshness, and publish are unchanged.

If you keep the doctrine filenames and replace only their contents, `REQUIRED_PACKS` and
`ROLE_PACKS` need no edit — but `doctrine.test.ts` pins those packs' anchors verbatim, so the
anchors move in the same commit as the prose.

### Sketch: a review-only workflow

**Change.** Set `git.mode: "read-only"`. Publish stops committing: the batch is written into the
report instead. Keep `workflow.itemReviewers` at its default of 6 so every lens gets its own
session — 6 is also the ceiling, since sessions are `clamp(itemReviewers, 3, 6)` — and raise
`skepticsPerFinding` and `reviewMaxRounds` to taste.

**Do not change.** The item FSM. `REVIEWED` is a position, not a terminus, and this is where a
review-only workflow meets real friction: `conductor_report` is legalized only when *every* item
is settled, and `isSettled` in [`gates-phase.ts`](../../conductor/core/gates-phase.ts) counts
exactly three dispositions — `PUBLISHED`, blocked, or deferred. A workflow whose items genuinely
stop at `REVIEWED` therefore needs `isSettled` widened, and that is a gate change: a table row, a
test that proves the new disposition closes a run, and a test that proves an unreviewed item still
does not. Do not work around it by deferring every item — a deferral writes a decision record
claiming a judgment nobody made.

**What you give up.** The publish stage's guarantees: the HEAD-mismatch refusal, the
staged-scope-minus-pre-existing-dirty discipline, and format enforcement. Nothing is committed, so
nothing is proven to have been committed cleanly.

### Sketch: a research or exploration workflow

**Change.** Lean on trivial classification. Raise `workflow.trivialMaxFiles` so more requests
classify `trivial`, which takes the `INTAKE → EXECUTING` edge with one synthesized item and skips
`DECOMPOSED`, `PLANNED`, and `PLAN_REVIEWED` outright. Use `conductor_inline_claim` so the
orchestrator edits directly instead of paying for a dispatch. Lower `parallel.maxImplementers` and
`parallel.maxReaders` to shrink fan-out width.

**Do not change.** The handler re-check on a trivial classification. The classifier proposes and
the handler disposes: a trivial item is escalated to `work` when it names more files than
`trivialMaxFiles`, when it is behavioral with an empty `testScope`, or when it is
`behavioral: false` with a `fileScope` that intersects `behavioralPaths` — and that escalation
fires even when the skeptic agreed. Raising `trivialMaxFiles` widens exactly one of those three
bounds. The other two are the reason "skip the tests, it's just an experiment" does not work.

**What you give up.** Decomposition, the plan document, and plan review, for every trivial run.
You do not give up the item FSM: an inline claim changes *who* edits, never *what* is enforced,
and the item still travels every position its `behavioral` flag demands.

**One number that will surprise you.** `readFanout` clamps each read stage to
`parallel.maxReaders`, but the plan-review roster is floored at the lens count. Setting
`maxReaders: 1` does not reduce plan review to one lens — it dispatches all four, one at a time.
The clamp is a concurrency knob, not a coverage knob.

## Adding a global constraint, or changing one

The honest answer is that you mostly do not, and the reasoning lives in
[design constraints](design-constraints.md). The fourteen constraints are each load-bearing for
something specific and written down; before proposing a change, find the failure the constraint
prevents and say what replaces the prevention.

The plan is immutable. It is never edited and its checkboxes are never ticked — a spec you can
edit is a spec that quietly agrees with whatever was built. So a deviation is *recorded*, not
merged into the specification, across three files:

| File                                                   | Role                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/build/CORRECTIONS.md`](../build/CORRECTIONS.md) | Append-only ledger. Each entry: the plan quote with line numbers, the observed reality with the exact command and output, the decision, the alternatives considered, and the blast radius. |
| [`docs/build/HANDOFF.md`](../build/HANDOFF.md)         | The live summary — where the build is, what is next, which deviations are in force.                                                                                                        |
| [`docs/build/STATE.json`](../build/STATE.json)         | Machine truth: per-task status and ordering overrides.                                                                                                                                     |

Every recorded deviation so far concerns layout, ordering, tooling, or a defect a gate caught.
None has relaxed one of the fourteen. That is what "load-bearing" means in practice.

## See also

- [Design constraints](design-constraints.md) — the fourteen, and what each one prevents
- [Testing and verification](testing-and-verification.md) — the canonical gate and what it rejects
- [Pure core and thin adapters](core-and-adapters.md) — where a decision belongs
- [Gates](gates.md) — the stack you are adding a row to
- [Configuration](../user/configuration.md) — every key the workflow sketches turn
