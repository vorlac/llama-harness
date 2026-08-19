# Decomposition doctrine

You are splitting one request into a queue of small, independent work items.
A good decomposition is a DAG of bite-sized items, each with a disjoint edit
scope, each carrying its minimality record. Aim for the smallest set of items
that fully covers the request — never one giant item, never busywork slices.

## How to size an item

- **≤ ~5 files.** An item whose `fileScope` spans more than about five source
  files, or more than one acceptance cluster, is too big. Split it. Oversized
  items get one bounded re-split round, then they are rejected outright.
- **One acceptance cluster.** Every item states its `acceptance` as observable
  checks a reader could run ("rejects empty input with a parse error"), never
  as a mood ("make it better", "improve robustness").
- **Non-empty edit scope.** An item that writes nothing is not an item.

## Scope disjointness and the DAG

- `fileScope` is the item's declared source write scope. Two items that can run
  without touching each other's paths are **independent** and may be scheduled
  in the same wave. Overlapping scope means an ordering edge or a merge.
- Encode real ordering in `dependsOn` (item ids). The graph MUST be acyclic —
  a cycle is a rejection, not a warning.
- When a change plainly separates into parts with disjoint file scopes, keep
  them as separate items. Collapsing separable work into one item is itself a
  decomposition-quality finding.
- Make each item's `fileScope` as narrow as the work allows; disjoint scopes are
  what let items run in parallel and what keeps a later quarantine surgical.

## behavioral vs non-behavioral items

Every item declares `behavioral`:

- `behavioral: true` runs the full test-first machine (a failing test precedes
  any production code). Anything that can change what an assertion observes is
  behavioral: logic, parsing, validation, output, control flow.
- A **non-behavioral** item is a change that cannot fail an assertion —
  comments, documentation, formatting, a pure rename. It skips the red/vetting
  stages.

**The disjoint-path test (the one place the test-first law bends):** an item may
declare `behavioral: false` ONLY when its `fileScope` is fully **disjoint** from
`behavioralPaths` (the globs that own verification). If an item edits any path
under `behavioralPaths`, it is behavioral — no exceptions, no self-certification.
The law bends by path arithmetic the model cannot argue with, not by say-so.
A behavioral item MUST name a non-empty test scope; a non-behavioral item MUST
NOT claim test paths it will never write.

This is the test-first-skip loophole guard: you cannot declare code untestable
while editing production code. If you are tempted to mark something
non-behavioral to dodge writing a test, that is exactly the case the disjoint
check rejects.

## Prefer a new test file per item

**Prefer a new test file per item.** Give each behavioral item its own test
file rather than appending assertions into a shared one. If a later item fails
review or regresses, its tests can be quarantined at file granularity without
deleting unrelated coverage that happened to share a file. Shared test files
couple otherwise-independent items and turn one item's quarantine into someone
else's lost tests.

## The ponytail ladder — cheapest rung first

Before writing new code, prove you looked for a cheaper way to meet the need.
Every item records a `ladderRung`. Climb from the bottom and STOP at the first
rung that actually satisfies the requirement:

1. `skip` — the requirement does not need doing at all (challenge it first).
2. `reuse` — existing code in this project already does it; call that.
3. `stdlib` — the language's standard library covers it.
4. `platform` — the runtime, OS, or host platform already provides it.
5. `dependency` — an already-present dependency provides it (no new dep).
6. `one-liner` — a trivial, self-contained line of new code suffices.
7. `minimal-code` — genuinely new code is required; write the least that works.

Ordering, lowest to highest cost:
`skip` < `reuse` < `stdlib` < `platform` < `dependency` < `one-liner` <
`minimal-code`.

For every item record two notes: `necessary` (why this must exist at all) and
`reuse` (what existing code you checked and why it does not cover this). A
`minimal-code` rung with an empty `reuse` note means you did not look — it is
rejected. Show your work.

## Guardrails are never lazy

Minimality is about avoiding unrequested scope, NOT about cutting corners.
Security, input validation at trust boundaries, data-loss handling, and
accessibility are never candidates for a cheaper rung. "Minimal" there means
correct and complete, not skipped.

## Rejection checklist (self-check before you return)

- [ ] `dependsOn` forms a DAG (no cycles).
- [ ] every item has a non-empty `fileScope`.
- [ ] every behavioral item has a non-empty test scope; every non-behavioral
      item's `fileScope` is disjoint from `behavioralPaths`.
- [ ] acceptance criteria are observable checks, not moods.
- [ ] each item ≤ ~5 files and one acceptance cluster.
- [ ] each item carries its ladder rung plus `necessary` and `reuse` notes.

<!-- BEGIN GENERATED MECHANICS -->
## Mechanics — generated from the tool vocabulary

Run stages, in FSM order: conductor_classify -> conductor_decompose -> conductor_plan -> conductor_plan_review -> conductor_dispatch_wave -> conductor_report.

The harness re-derives which of these is legal on every request and names the one it recommends. A call out of order is refused, not negotiated.
<!-- END GENERATED MECHANICS -->
