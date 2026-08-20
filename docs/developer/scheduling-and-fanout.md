# Scheduling and fan-out

How conductor decides which items run together, who drives them, and how sub-sessions are
created, prompted, validated, and collected. This page is for anyone changing
[`core/schedule.ts`](../../conductor/core/schedule.ts),
[`adapter/fanout.ts`](../../conductor/adapter/fanout.ts), or
[`adapter/router-client.ts`](../../conductor/adapter/router-client.ts).

Two modules split the work. `core/schedule.ts` is pure: it answers "which items may run at
the same time" from the queue, the runtime item facts, and the config caps — no I/O, no
clock, no globals. `adapter/fanout.ts` is the engine that actually runs them: it creates
opencode sub-sessions over the SDK, prompts them, validates what comes back, and collects
results. The scheduler decides; the engine executes.

## The wave

A wave is the maximal set of queue items that may be worked simultaneously.
`nextWave(queue, items, config)` returns `{parallel: string[], rationale: string}`, where
`rationale` is always a non-empty sentence explaining the selection or the empty result.

Membership is four conditions, each checked explicitly in the candidate loop:

| #   | Condition                 | How it is checked                                                                                       |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| a   | Dependency-ready          | every id in `dependsOn` is in the PUBLISHED set; nothing below PUBLISHED unlocks a dependent            |
| b   | Pairwise scope-disjoint   | `scopesIntersect(candidate.fileScope, chosen.fileScope)` is false against every already-selected member |
| c   | Not blocked, not deferred | the runtime item's `blocked` and `deferred` annotations are both `null`                                 |
| d   | Within the cap            | the wave is closed once it reaches `parallel.maxImplementers` (default 2)                               |

Two filters sit alongside them: an item already in state `PUBLISHED` is never a member, and
an item with no runtime record is not schedulable — the scheduler has no facts about it, so
it is skipped rather than guessed at.

### Order is intrinsic

Candidates are sorted by **DAG depth ascending, then item id ascending**, and that sorted
order is both the order the wave is emitted in and the order the greedy selection walks.

Depth is the longest dependency chain over the *full* queue graph: 0 for an item with no
`dependsOn`, otherwise `1 + max(depth of its dependencies)`. It is computed from the edges
alone, independent of publish state, so an item's ordinal never changes as the run
progresses. An unknown dependency id contributes 0, and an in-progress set makes a
malformed cyclic edge terminate rather than recurse forever — the queue is a DAG by schema,
so that guard is a floor, not a live path.

Order invariance matters because the wave is the input to everything downstream: which
sub-sessions get created, which trees get frozen, and the order `conductor_publish` walks.
If shuffling the queue array changed the wave, two runs over identical work could produce
different commits, different journals, and different reviews. A content-derived sort key
makes the wave a pure function of the queue's *content*, not its arrangement.

### The degenerate-scope defence

`scopesIntersect([], X)` returns `false`. An empty `fileScope` therefore reads as *disjoint
from everything* under a naive intersection, and an item carrying one would join every
wave — the exact opposite of what an unbounded write scope should do. A wildcard-headed
glob such as `*/foo.ts` is the mirror trap: its literal head is empty, so it prefixes every
path, and a check that trusted head comparison alone would have to get the empty case right
in two places.

The scheduler does not rely on `scopesIntersect` for either case. It classifies the scope
first, with `isDegenerateScope`:

```ts
// conductor/core/schedule.ts
function isDegenerateScope(fileScope: string[]): boolean {
  if (fileScope.length === 0) return true;
  for (const glob of fileScope) {
    const segments = glob.split("/").filter((seg) => seg.length > 0);
    if (segments.length === 0) return true;
    const head = segments[0];
    if (head.includes("*") || head.includes("?") ||
        head.includes("{") || head.includes("[")) return true;
  }
  return false;
}
```

A degenerate scope on **either** side of a comparison forces a conflict, so a
degenerate-scope item never shares a wave with anything. It still runs — it simply runs
alone. The wildcard vocabulary here (`*`, `?`, `{`, `[`) is deliberately the same set
`shell-parse.ts` uses to compute a literal head, so the two modules agree on what
"wildcard-headed" means.

## scopesIntersect is conservative

The intersection test lives in
[`core/shell-parse.ts`](../../conductor/core/shell-parse.ts). It takes each glob's
**literal head** — the leading path segments before the first wildcard construct — and
reports intersection when any pair of heads is a segment-wise prefix of the other.

```ts
scopesIntersect(["src/parser/*.ts"], ["src/parser/lexer.ts"]);  // true  (correct)
scopesIntersect(["src/*.ts"],        ["src/*.md"]);             // true  (over-approximate)
scopesIntersect(["src/a/**"],        ["src/b/**"]);             // false (disjoint)
scopesIntersect(["src"],             ["src2/lib.ts"]);          // false (segment-wise)
```

Three properties follow from that definition:

- **Segment-wise, not string-wise.** `src` is not a prefix of `src2/...`, because the
  comparison walks whole path segments. A string-prefix test would have merged unrelated
  directories.
- **Case-insensitive.** On a case-insensitive filesystem — the reference host is macOS —
  `Src/**` and `src/**` name the same real directory, so folding case is the safe
  direction.
- **Symmetric by construction**, since overlap is checked on both heads.

The over-approximation is the point. `src/*.ts` and `src/*.md` are genuinely disjoint file
sets, and the test still reports them as intersecting. That false positive costs
parallelism — the two items serialize into consecutive waves — and never costs correctness,
because two items that *do* overlap are never placed in the same wave. Errors in the
permissive direction would let two implementers write the same file concurrently; errors in
this direction just make the run slower. It is one of the project's recorded honest limits,
recorded as a limit precisely because it is a deliberate trade rather than a bug.

## Wave selection

```mermaid
---
config:
    theme: 'base'
    curve: 'straight'
    themeVariables:
        darkMode: true
        clusterBkg: '#22272f62'
        clusterBorder: '#6a6f77ff'
        clusterTextColor: '#C1C4CAff'
        lineColor: '#C1C4CAAA'
        background: '#262B33'
        primaryColor: '#3a3f47ff'
        primaryTextColor: '#C1C4CAff'
        primaryBorderColor: '#6a6f77ff'
        primaryLabelBkg: '#262B33'
        secondaryColor: '#425f5fff'
        secondaryBorderColor: '#8c9c81ff'
        secondaryTextColor: '#C1C4CAff'
        tertiaryColor: '#4d4962ff'
        tertiaryBorderColor: '#8983a5ff'
        tertiaryTextColor: '#C1C4CAff'
        nodeTextColor: '#C1C4CA'
        defaultLinkColor: '#C1C4CA'
        edgeLabelBackground: '#262B33'
        labelTextColor: '#C1C4CA'
---
flowchart TD
%% Source: conductor/core/schedule.ts:140-225 (nextWave)
    Q["queue item plus runtime facts"] --> P{"already PUBLISHED"}
    P -->|yes| SKIP["not a candidate"]
    P -->|no| B{"blocked or deferred"}
    B -->|yes| SKIP
    B -->|no| D{"all dependsOn PUBLISHED"}
    D -->|no| SKIP
    D -->|yes| C["candidate with depth and flag"]
    C --> S["sort by depth then id"]
    S --> G{"wave below maxImplementers"}
    G -->|no| STOP["wave closed"]
    G -->|yes| X{"degenerate scope either side"}
    X -->|yes| SER["serialize to later wave"]
    X -->|no| I{"scopesIntersect a member"}
    I -->|yes| SER
    I -->|no| SEL["join the wave"]
    SEL --> G
    SER --> G

    linkStyle default stroke:#C1C4CAaa,stroke-width:2px,color:#C1C4CAaa

    classDef neutral fill:#3a3f47,stroke:#6a6f77,color:#C1C4CA,rx:6,ry:6
    classDef accent  fill:#2b4268,stroke:#779DC9,color:#ffffff,rx:6,ry:6
    classDef warn    fill:#7a7253,stroke:#c7c19b,color:#ffffff,rx:6,ry:6
    classDef ok      fill:#425f5f,stroke:#8c9c81,color:#ffffff,rx:6,ry:6

    class Q,P,B,D,C,S,G,X,I,SKIP,STOP neutral
    class SEL ok
    class SER warn
```

## Who drives the wave

`conductor_dispatch_wave`'s handler runs an internal driver: **one async pipeline per wave
member**, each walking that item's FSM by calling the same handlers the per-item tools
call, all sharing the fan-out engine's concurrency budget. The orchestrator model does not
interleave items.

This is the only arrangement that works, and the reason is mechanical rather than
aesthetic. A single opencode session executes tool calls **sequentially**. Under a
marker-only `dispatch_wave` — a tool that merely records "these items are now in flight"
and returns — the advertised overlap, item B's test being written while item A implements,
would require the orchestrator model to emit concurrent tool calls. That is a dependency on
model behavior for a *concurrency guarantee*, and the design refuses it explicitly: fan-out
does not depend on the model emitting parallel task calls. Concurrency lives in the engine,
which is deterministic, testable against the fake SDK, and cannot forget.

The per-item tools stay callable — single-item runs, inline claims, and recovery all use
them. The driver and the model reach the same handlers, so there is one implementation and
one set of gates either way.

## Ordering guarantees

The driver owns three ordering rules that the scheduler's disjointness check alone cannot
provide.

| Guarantee                                                         | Why                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The write-capable stages never overlap, and run in wave order     | there is one working tree, so two concurrent writers would race on it regardless of scope disjointness      |
| `conductor_publish` runs serially in item order                   | the git index is a singleton; two concurrent stages would interleave into one commit                        |
| No write-capable dispatch enters a tree with a live verify marker | the freeze is a scheduling rule, not only a gate — a held job waits rather than being denied                |

The first two rules are one mechanism. `SERIAL_STAGES` names the three stages that may not
overlap — `conductor_submit_test` and `conductor_mark_green`, whose sub-sessions are write-capable,
and `conductor_publish`, whose git index is a singleton. Within a stage group the driver chains
those into a single promise in wave order and lets every other stage overlap freely. The first job
of each is started in one synchronous pass, so the order sub-session traffic reaches the engine is
the wave's and not the event loop's.

What overlaps, then, is every read stage: vet critics, review lenses, and skeptics across all wave
members at once. That is where most of a run's usable concurrency lives, and it is why stage
batching matters more than write parallelism does.

The third guarantee is where the scheduler and the engine meet. The edit-scope gate denies
every edit in a frozen tree, production and test files alike; the engine additionally
*holds* the dispatch, so a write-capable job never reaches a session that would immediately
be denied. The gate is the correctness guarantee and the hold is the scheduling behavior that
keeps the gate from being hit in the first place. A stage that finishes notifies the tree view,
which is what releases any job the engine was holding on a marker that stage broke or a verify it
finished.

## Stage batching

Within a wave the driver batches like stages: all members' vet critics dispatch together,
all members' review lenses dispatch together. `readFanout` gives a stage its reader count as the
configured count clamped to the concurrency ceiling:

```ts
readFanout(stage, config) === min(stageCount(stage, config), config.parallel.maxReaders)
```

| Stage        | Config key                    | Default | Ceiling default          |
| ------------ | ----------------------------- | ------- | ------------------------ |
| `planReview` | `workflow.planReviewers`      | 4       | `parallel.maxReaders` = 6 |
| `itemReview` | `workflow.itemReviewers`      | 6       | `parallel.maxReaders` = 6 |
| `vet`        | `workflow.vetCritics`         | 3       | `parallel.maxReaders` = 6 |
| `skeptics`   | `workflow.skepticsPerFinding` | 2       | `parallel.maxReaders` = 6 |

`readFanout` is not the last word on either review roster, and it is important not to read it as
one. **Coverage outranks the concurrency knob.** Plan review floors its roster at the number of
named lenses — `max(readFanout("planReview", config), lensCount)` — because sizing by `readFanout`
alone silently dropped lenses whenever the reader clamp fell below the lens count, and at
`maxReaders: 0` dispatched nothing at all while still advancing the run to `PLAN_REVIEWED`: a plan
that "passed review" on evidence nobody gathered. Item review clamps instead:
`clamp(readFanout("itemReview", config), 3, 6)`, and pins 3 for a trivial-classified run. Neither
costs anything operationally, because the fan-out engine still admits at most `maxReaders` jobs at
a time — the clamp is a concurrency knob and the engine is where it is enforced.

Under one model, batching saves no model swaps — there are none to save. What it still buys
is **KV prefix locality**: like stages across wave members share most of their prompt
prefix, so dispatching them contiguously lets llama-router's group affinity dequeue them
together and llama-server's slot reuse keep that prefix hot. Batching also keeps the read
fan-out saturated, which is where most of a run's usable concurrency lives.

## Worktree mode

`parallel.writes` selects between two arrangements. The default, `"off"`, runs every session
against the one workspace tree and serializes implementer writes within it. `"worktrees"` gives
each wave implementer a tree of its own, so their writes genuinely overlap.

Under `parallel.writes: "worktrees"`, each wave implementer gets its own worktree at
`<stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId>` — **outside the
repository**, for the same reason quarantine is, with more force. A worktree is a complete
second copy of every test file in the project. Placed inside the repo, a whole-tree runner
in the main tree would discover and execute all of them, including another item's
in-progress red test. Quarantine moves a handful of files out of the walked tree; a
worktree inside it would add an entire second tree's worth of collectable tests.

The rest of the mode is five rules:

- **Created at wave setup.** The wave driver creates one worktree per member *before* any stage
  dispatch, so every member's sub-sessions are born bound to their own tree, and records the path
  on the item's `worktree` field. Under `"off"` that block runs no git command at all and
  `worktree` stays `null`. A tree an earlier call already created and that still exists is
  reused, and `createWorktree` itself prunes first, adopts a still-registered worktree only after
  verifying its branch, and reuses a surviving branch rather than force-deleting it — so a
  crash-recovery path preserves committed work.
- **Edit-scope binding.** Each session's edit-scope gate binds to its worktree path, so an
  implementer cannot write into the main tree or into another item's worktree. The reviewers and
  the verify runner bind to the same tree: dispatching reviewers into the workspace while the
  change sits in a worktree would show them a tree without the change they were convened for.
- **Serial merge-back in item order.** `mergeBack` verifies the branch identity, tries
  `--ff-only` first, falls back to a normal merge, and aborts a conflicted merge before
  returning, so the workspace is never left mid-merge. Serial order follows from the driver's
  publish stage being serial and the call being synchronous.
- **Re-validation against the integrated tree.** After each merge the item re-validates
  before reaching PUBLISHED. A green in isolation is not a green in company, and the
  integrated tree is the only place where that distinction can be observed.
- **Conflict fallback.** Scope disjointness makes conflicts structurally rare; a conflict anyway
  aborts the merge, drops the later item back to `GREEN` with the `debugging` annotation set, and
  it re-validates from there. Earlier items' completed merges stand and this item's commit stays
  on its own branch. That drop is an administrative write, not an FSM edge — see
  [state machines](state-machines.md).

Teardown is the continuation engine's: it removes each worktree-bearing item's tree at run
teardown. `gitio` and `evidence.runVerify` take an explicit tree/`cwd` argument throughout, and
verify markers are per-tree, which is what lets one tree's verify freeze only that tree.

## The fan-out engine

`createFanout(client, config, journal, registry, treeState, runId)` returns
`{dispatch, dispatchWave}`. A job is `{role, itemId, tree, writeCapable, prompt,
schemaName, priority, lens?, receivingReview?}`; a result is `{sessionID, value?, error?, timings}`
with `timings: {startedMs, endedMs, durationMs}`. `dispatchWave` writes results positionally, so
`results[i]` always corresponds to `jobs[i]` regardless of completion order.

`tree` is the tree *path* the sub-session is dispatched into, and the engine writes it verbatim
onto the session-registry entry the gates read — so the gate judges an edit against the same tree
the scheduler put the session in. A job that works no tree of its own carries `NO_TREE`.
`receivingReview` marks a dispatch that is receiving review findings, which is what makes the
doctrine layer deliver `receive-review.md` to it.

Each job is create, prompt, collect:

1. **Create** — `session.create({body: {title: "<role>:<itemId>"}})`. A create that returns
   no usable id ends the job with an `env` error rather than proceeding.
2. **Prompt** — `session.prompt({path: {id}, body: {parts: [{type: "text", text}], model}})`.
3. **Collect** — the reply's text parts are joined, parsed as JSON, validated, and the
   registry entry is deleted.

### The registry is written before the first prompt

Immediately after `session.create` returns an id, the engine writes
`registry.set(sessionID, {role, itemId, tree})` — **before** the first prompt is sent.

The session-registry gate is the first gate in the stack: a session with no registry entry
may read, but every write-shaped call and every `conductor_*` call is denied. A sub-session
that was prompted before its entry existed would be a live session capable of making tool
calls that the gates cannot classify. Ordering the two operations this way is what makes
"no unregistered writer" a structural property rather than a timing hope. The entry is
deleted on every terminal path, including the watchdog path.

### Independent schema validation with bounded retry

The prompt body carries **no `format` field**. The prompt-body
`format: {type: "json_schema"}` field does not exist at opencode 1.18.15 — it is accepted
silently and produces neither `response_format` nor `json_schema` in the provider request,
so no schema'd body field is emitted at all. Structured output is therefore prompt-shaped,
and independent validation by the engine is not a belt-and-braces extra: it is the only
mechanism holding receipts to their schema.

The loop runs at most three prompts per session — the initial attempt plus at most two
re-prompt retries:

```ts
const MAX_ATTEMPTS = 3;
```

Each attempt parses the joined text parts as JSON and runs the pure core `validate(schemaName, parsed)`.
On success the job finishes with the parsed value. On failure below the attempt cap, the
retry prompt keeps the **original instruction** and appends the concrete validation errors
as a bulleted list, so the model is correcting a named defect rather than guessing at what
went wrong. When the budget is spent, the job finishes with an `env` error carrying the
final error list — an env-failed *completion*, never confused with a watchdog abort.

### The watchdog

A per-job timer is armed on the global `setTimeout` **before** `session.create`, so
`parallel.subSessionTimeoutMs` (default 900000 ms — fifteen minutes) bounds the entire job
including the create phase. If create itself hangs, nothing else in the system would abort it and
the whole wave would stall behind one slot.

On fire the watchdog aborts the session over the SDK if an id exists yet, journals
`subsession.abort` at `warn` with `reason: "watchdog-timeout"`, and produces an `env` error
result. A `done` flag makes completion exactly-once across every path, so a `create` that
resolves *after* the watchdog fired cannot double-finish — and if that late create did
produce a session id, it is aborted so it does not leak.

### Freeze-aware admission

Within a model group the engine admits up to `parallel.maxReaders` jobs at once (default 6).
Before admitting a job it checks the freeze:

```ts
if (entry.job.writeCapable && treeState.isFrozen(entry.job.tree)) { hold(entry); continue; }
```

A write-capable job for a frozen tree is **held** — not dispatched, and not denied. It
subscribes to `treeState.onClear` and is re-queued when the marker for its tree clears, so
release is event-driven: no timers, no polling. A read-only job for the same tree is
admitted immediately, because a verify in progress does not stop anyone reading.

Holding is registered before subscribing, because a `TreeState` may notify synchronously
from inside `onClear` when the tree is already clear. Registering first means a synchronous
clear finds the entry and releases it, instead of stranding a job and hanging the wave. The
release itself is idempotent across the synchronous path and a later marker-clear
notification.

### Per-model wave grouping

Jobs are grouped by resolved model — `config.models.roles[role] ?? config.models.default` —
preserving first-appearance order of groups and input order within each group, and one
group drains fully before the next starts. Given jobs for models A and B interleaved, the
dispatch order is AABB, not ABAB.

Under the single-model configuration this is the identity function on one group: every role
resolves to the same model, so there is exactly one group and the barrier never fires. It
stays anyway because it costs one `groupBy` and it is the difference between a future
multi-model configuration being a config change and being a redesign.

## A fan-out job, end to end

```mermaid
---
config:
    theme: 'base'
    themeVariables:
        darkMode: true
        background: '#262B33'
        primaryColor: '#2b4268ff'
        primaryTextColor: '#FFFFFF'
        primaryBorderColor: '#779DC9'
        lineColor: '#C1C4CA'
        actorBkg: '#2b4268ff'
        actorBorder: '#779DC9'
        actorTextColor: '#C1C4CA'
        actorLineColor: '#779DC9'
        activationBorderColor: '#c7ac9bff'
        activationBkgColor: '#7a6253ff'
        noteBkgColor: '#3a3f47ff'
        noteTextColor: '#C1C4CA'
        noteBorderColor: '#6a6f77ff'
        labelBoxBkgColor: '#425f5fff'
        labelBoxBorderColor: '#8c9c81ff'
        labelTextColor: '#C1C4CA'
        altSectionBkgColor: '#4d4962ff'
        signalColor: '#C1C4CA'
        signalTextColor: '#C1C4CA'
        messageTextColor: '#C1C4CA'
---
sequenceDiagram
%% Source: conductor/adapter/fanout.ts:204-356 (runJob)
    participant E as Fan-out engine
    participant W as Watchdog
    participant R as Session registry
    participant S as opencode SDK
    participant V as Core validator
    E->>W: arm timer before create
    E->>+S: session.create
    S-->>-E: sessionID
    E->>R: set role, itemId, tree
    E->>+S: session.prompt attempt 1
    S-->>-E: reply text parts
    E->>+V: validate against schemaName
    V-->>-E: errors
    E->>+S: re-prompt with errors appended
    S-->>-E: reply text parts
    E->>+V: validate against schemaName
    V-->>-E: ok
    E->>W: clear timer
    E->>R: delete sessionID
    Note over W,S: on fire the watchdog aborts the session
```

## Roles

A job's model is `config.models.roles[role] ?? config.models.default`. The reference deployment
leaves `models.roles` empty and serves every role from one set of weights, so no stage boundary
costs a model swap; the key is read rather than ignored, so pointing a role at different weights
is a config change and not a redesign. A role selects doctrine, sampling, gate posture, and a
router priority tag; in the base configuration it never selects weights.

| Role         | Doctrine packs                  | Temp | Gate posture                   | Priority    |
| ------------ | ------------------------------- | ---- | ------------------------------ | ----------- |
| orchestrator | `core.md`                       | 0.4  | edit: ask (inline claims only) | interactive |
| planner      | `decompose.md` + `plan.md`      | 0.7  | edit: deny                     | interactive |
| testWriter   | `tdd.md`                        | 0.5  | edit: `testScope` only         | review      |
| implementer  | `tdd.md` (+`debug.md` in DEBUG) | 0.4  | edit: `fileScope` only         | review      |
| reviewer     | `review.md` + `test-vet.md`     | 0.3  | edit: deny                     | review      |
| skeptic      | `skeptic.md`                    | 0.3  | edit: deny                     | review      |
| mechanical   | `core.md`                       | 0.1  | edit: deny                     | batch       |

A role whose name is not in the table falls back to `core.md` and temperature 0.4, so an
unregistered session still receives grounding rather than an empty system append. One more pack
is delivered by signal rather than by role: a dispatch that receives review findings also gets
`receive-review.md`, keyed on the registry entry the fan-out engine wrote for that dispatch and
not on the item's state, so the same item's other dispatches get nothing extra.

The single-model decision is also what makes the POC's measurement meaningful: a quality
delta measured this way is attributable to process, not to a bigger model doing the
reviewing.

## Review adjudication

Item review dispatches fresh reviewers over the item's diff, spec, and test, one lens each:

| Lens                      | Looks for                                                            | Mandatory                    |
| ------------------------- | -------------------------------------------------------------------- | ---------------------------- |
| spec/contract             | missing requirements, unrequested extras, API and contract soundness | yes                          |
| correctness               | defects in the change itself                                         | yes                          |
| guardrail                 | security, trust-boundary validation, data loss                       | yes                          |
| test-adequacy             | does the test still honestly pin the change now that the impl exists | yes                          |
| minimality/simplification | unnecessary machinery, simpler equivalents                           | yes                          |
| perf                      | performance consequences                                             | added at `itemReviewers` ≥ 6 |

Session count is `clamp(readFanout("itemReview", config), 3, 6)`, or a flat 3 for a
trivial-classified run. At 6 each lens gets its own session. Below 6,
lenses **merge pairwise from the tail** of the priority list: 5 merges minimality with perf;
4 additionally joins test-adequacy to spec/contract; 3 gives spec+correctness,
guardrail+minimality, test-adequacy+perf. Values below 3 clamp to 3 with a journal warning.
Merging never drops a mandatory lens, and configuration cannot truncate the mandatory five
away.

Every finding then faces `skepticsPerFinding` refuters, and survival is a threshold on the count
of seats that did **not** refute it:

```ts
// conductor/core/verdict.ts
export function findingSurvives(verdicts: readonly Verdict[], k: number): boolean {
  let upholds = 0;
  for (const verdict of verdicts) {
    if (verdictKind(verdict) !== "refuted") upholds += 1;
  }
  return upholds >= Math.ceil(k / 2);
}
```

**A refutation without evidence is an abstention, and an abstention upholds.** `verdictKind`
counts a verdict as a refutation only when its `refutationEvidence` names all three of the
discriminating input, what was run, and the reading under which the finding fails; anything less
is a seat that could not evaluate the finding, and incapacity must not extinguish it. Refutation
stays cheap for a skeptic who did the work and stays fatal to the finding.

**A tie upholds.** At the default `k = 2` the threshold is `⌈2/2⌉ = 1`, so a finding two
skeptics split on survives — a finding worth arguing about is worth a fix round. At `k = 3`
the threshold is 2, a strict majority.

`skepticsPerFinding: 0` does not disable skeptic review: it throws when any major finding is
raised, because `findingSurvives([], 0)` is vacuously true and would auto-survive every major.

Adjudication is two-stage. Surviving spec/contract findings are fixed **first**, and
quality-lens findings from a round that produced surviving spec findings are **discarded
and re-derived** after the fix. Judging not-yet-spec-compliant code is wasted judgment: the
quality findings were derived against code that is about to change shape. All lenses still
dispatch in parallel — the two-stage rule is an ordering over adjudication, not over
dispatch, so it costs nothing in wall-clock.

Surviving findings are routed by the paths their fix touches, not by a fixed recipient —
see [state machines](state-machines.md) for the routing table and the re-vet requirement.

## The router client

[`adapter/router-client.ts`](../../conductor/adapter/router-client.ts) is the plugin's
metrics client for llama-router. It is an adapter because it does network I/O,
and it is strictly fail-soft, because the router is a residual-risk dependency that the
process must survive losing.

| Function                                                | Returns                           | Failure behavior                                                                                                      |
| ------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fetchMetricsSummary(routerCfg, log?)`                  | `Promise<MetricsSummary \| null>` | `null` on request failure, non-200, unparseable body, or a body that is not an object; journals the reason at `debug` |
| `resolveBaseUrl(routerCfg, upstreamCfg, failoverState)` | `string`                          | synchronous and pure — no I/O, so it cannot fail                                                                      |
| `noteRouterFailure(failoverState, log?)`                | `void`                            | records one failover and journals `failover` at `warn`                                                                |
| `createFailoverState()`                                 | `FailoverState`                   | a fresh, unlatched state                                                                                              |

Absorption is total. The single underlying GET settles exactly once and never rejects: a
refused connection, a socket error, a body-read error, and a hang past the probe timeout all
resolve to `null`, and the timeout destroys the socket so no probe can wedge the event loop.
The probe timer is `unref`'d so a pending probe never keeps the process alive on its own.

### The failover latch

`FailoverState` is `{failovers, useUpstream, metricsPartial, probingDisabled}`, threaded
through the session by the fan-out engine. When the engine observes a router request
failure it calls `noteRouterFailure`, and the first failover:

- increments `failovers`,
- sets `useUpstream`, which pins `resolveBaseUrl` to the **upstream** origin for the
  remainder of the session,
- sets `metricsPartial`, which `conductor_report` reads and reports.

The latch is deliberate. Without it, "layer 2 is fail-soft" would mean only "the process
would have been fine if the crash had happened at a different time" — in-flight
sub-sessions still die and the run still takes `env` failures. Pinning the base URL for the
rest of the session converts a flapping dependency into one clean, recorded transition.
Marking metrics partial is the honesty half: the router's ledger has a hole in it, and the
report says so rather than presenting a partial dataset as complete.

### The second-failover rule

A second failover in one session sets `probingDisabled`, and from that point `resolveBaseUrl`
keeps returning the upstream with **zero network calls**. Two failures is enough evidence that
the router is not coming back within this session; continuing to probe it would spend a probe
timeout per check to learn something already known. The §4.4 failover protects conductor's own
setup probes only — the run's model traffic reaches the router through opencode's fixed
provider base URL, which the plugin cannot repoint mid-session, so a router that dies mid-run
takes `env` failures on its in-flight sub-sessions and the supervisor's restart is the
resilience story, not a client-side probe.

The client addresses one endpoint, `/conductor/metrics`. `MetricsSummary` carries
`totalRequests`, `schemaMissing`, `schemaConformed`, `statusCounts`, `promptTokens`, and
`completionTokens` — the POC's cost and conformance dataset. See
[llama-router](llama-router.md) for what serves it.

There is deliberately no health-probe function here. Setup reaches the router through its own
proof requests and reads the verdict off those, and the live health probing an operator relies on
is the supervisor's, in `scripts/serve.py`. An exported, tested probe with no caller reads as
coverage of a mechanism that does not run.

## See also

- [State machines](state-machines.md) — the item FSM the wave driver walks per member
- [Gates](gates.md) — the session registry, edit-scope, and freeze gates the engine feeds
- [Evidence and quarantine](evidence-and-quarantine.md) — verify markers and the foreign red set
- [llama-router](llama-router.md) — admission, group affinity, and the metrics ledger
- [opencode integration](opencode-integration.md) and
  [`adapter/wire-notes.md`](../../conductor/adapter/wire-notes.md) — the verified wire contract
