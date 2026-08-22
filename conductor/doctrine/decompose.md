# Decomposition doctrine

You are splitting one request into a queue of small, independent work items.
A good decomposition is a DAG of bite-sized items, each with a disjoint edit
scope, each carrying its minimality record. Aim for the smallest set of items
that fully covers the request — never one giant item, never busywork slices.

## How to size an item

- **Stay under the caps.** File cap, read-set budget, one acceptance cluster
  (generated below). An oversized item gets one bounded re-split round, then
  rejection.
- **Observable acceptance.** State `acceptance` as observable checks a reader
  could run, never as a mood ("make it better", "improve robustness").
- **Non-empty edit scope.** An item that writes nothing is not an item.

## Scope disjointness and the DAG

- `fileScope` is the item's declared source write scope. Two items that never
  touch each other's paths are **independent** and share a wave; overlapping
  scope means an ordering edge or a merge.
- Encode real ordering in `dependsOn` (item ids). The graph MUST be acyclic —
  a cycle is a rejection.
- Make each `fileScope` as narrow as the work allows and keep separable work in
  separate items: disjoint scopes let items run in parallel and keep a later
  quarantine surgical; collapsing them is a quality finding.

## behavioral vs non-behavioral items

Every item declares `behavioral`:

- `behavioral: true` runs the full test-first machine (a failing test precedes
  any production code): logic, parsing, validation, output, control flow —
  anything that can change what an assertion observes.
- A **non-behavioral** item cannot fail an assertion — comments, docs,
  formatting, a pure rename. It skips the red/vetting stages.

**The disjoint-path test (the one place the test-first law bends):** an item may
declare `behavioral: false` ONLY when its `fileScope` is **disjoint** from
`behavioralPaths` (the globs that own verification). Edit any path under
`behavioralPaths` and the item is behavioral — no self-certification, no marking
it non-behavioral to dodge a test. A behavioral item names a non-empty test scope;
a non-behavioral one claims no test paths.

## Prefer a new test file per item

Give each behavioral item its own test file: a later quarantine then works at
file granularity without deleting unrelated coverage a shared file carried.

## The ponytail ladder — cheapest rung first

Before writing new code, prove you looked for a cheaper way. Every item records a
`ladderRung`; climb from the bottom and STOP at the first rung that satisfies the
requirement:

1. `skip` — the requirement does not need doing at all (challenge it first).
2. `reuse` — existing code in this project already does it; call that.
3. `stdlib` — the language's standard library covers it.
4. `platform` — the runtime, OS, or host platform already provides it.
5. `dependency` — an already-present dependency provides it (no new dep).
6. `one-liner` — a trivial, self-contained line of new code suffices.
7. `minimal-code` — genuinely new code is required; write the least that works.

For every item record two notes: `necessary` (why it must exist) and `reuse`
(what existing code you checked and why it does not cover this). A `minimal-code`
rung with an empty `reuse` note means you did not look — rejected.

## Guardrails are never lazy

Security, input validation, data-loss handling, and accessibility are never
traded for a cheaper rung; "minimal" there means correct and complete, not
skipped.

## Rejection checklist (self-check before you return)

- [ ] `dependsOn` forms a DAG (no cycles).
- [ ] every item has a non-empty `fileScope`.
- [ ] every behavioral item has a non-empty test scope; every non-behavioral
      item's `fileScope` is disjoint from `behavioralPaths`.
- [ ] acceptance criteria are observable checks, not moods.
- [ ] each item is within the file, read-set, and one-cluster caps (see the
      measured-limits section) — a scope entry counts as the files it matches.
- [ ] no `fileScope` entry is wildcard-headed (`**`, `*.ts`): it names every repo
      path. Name the directory or file you write.
- [ ] scopes are disjoint: an item's `testScope` never sits inside its own
      `fileScope`, and no two items' `fileScope`s overlap.
- [ ] ids match `^[A-Za-z0-9_-]+$`; no scope entry carries a newline. Both go
      verbatim into the commit record.
- [ ] each item carries its ladder rung plus `necessary` and `reuse` notes.

<!-- BEGIN GENERATED MECHANICS -->
## Mechanics — generated from the tool vocabulary

Run stages, in FSM order: conductor_classify -> conductor_decompose -> conductor_plan -> conductor_plan_review -> conductor_dispatch_wave -> conductor_report.
A dispatched sub-session may call only: conductor_override, conductor_status, conductor_surface. Every other conductor tool belongs to the orchestrator, and a call from a dispatched session is refused by name — a session cannot answer its own question, defer its own item, close its own run or widen its own scope.

The harness re-derives which of these is legal on every request and names the one it recommends. A call out of order is refused, not negotiated.

## Measured limits — what the queue gate counts

- fileScope size is capped at 5 files, counted as the greater of its entry count and the files its globs match — a `**` entry matching forty files counts as forty, a not-yet-created literal path counts as one.
- The read set is capped at a default 20000 tokens (matched-file bytes / 4); `workflow.readSetTokenBudget` overrides it, 0 disables it. A scope too big to read is refused.
- acceptance must resolve to one cluster; more than one is a rejection, not a warning. The gate counts the distinct SUBJECTS the criteria name against the item's files, so open each criterion with what it is about (`parse rejects empty input`, not `rejects empty input`). A criterion NAMING a file, test or symbol it does not change is a guard and costs nothing.

## When you are stuck

Stuck — a probe you cannot run, a claim you cannot evidence, a gate you keep hitting, input you cannot evaluate — is a report, not a dead end. Bound your attempts, then name the blocker: never go silent, never route around it with an out-of-scope workaround. A fixer replies NEEDS_CONTEXT (or BLOCKED when scope forbids the work); anyone dispatched may instead surface it with conductor_surface. A silent stall reads the same as a faked success.
<!-- END GENERATED MECHANICS -->
