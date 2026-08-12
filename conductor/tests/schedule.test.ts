// Task 3.3 red tests — lives at conductor/tests/schedule.test.ts.
// Subject: conductor/core/schedule.ts (must NOT exist when this goes red; the
// failure is Cannot find module '../core/schedule.ts' — the missing-subject
// shape, a legal red per §2.6.1). core/schedule.ts is pure.
//
// Spec:
//   §4.2 the wave scheduler (plan lines 1544-1618): a wave is a MAXIMAL set of
//     items that are (a) dependency-ready (every dependsOn PUBLISHED), (b)
//     pairwise fileScope-disjoint (glob-intersection via the conservative
//     scopesIntersect, §1.2 / plan 2091-2093), (c) not blocked/deferred, and
//     (d) within parallel.maxImplementers. Deterministic order: DAG depth then
//     id.
//   Task 3.3 interfaces (plan lines 2261-2273):
//     nextWave(queue, items, config) -> {parallel: string[], rationale}
//     readFanout(stage, config) -> number
//   Phase-1 adversarial gate binding (docs/build/specs/task-3.3.assertions.json,
//     phaseGate1Bindings): scopesIntersect([], X) === false — an empty scope
//     reads as DISJOINT and would join every wave. The gate already requires a
//     non-empty fileScope per item (plan line 1104), but nextWave MUST treat an
//     empty / wildcard-headed (degenerate) fileScope conservatively as
//     defense-in-depth: serialize, never parallelize.
//
// Assertions covered: 3.3-api, 3.3-diamond, 3.3-overlap, 3.3-cap, 3.3-unlock,
// plus the empty-scope conservative-serialize binding.

import { test } from "node:test";
import assert from "node:assert/strict";

import { nextWave, readFanout } from "../core/schedule.ts";
// scopesIntersect (Task 1.2) is imported to demonstrate the conservative bias
// that the scheduler inherits, and its empty-input false result (the trap the
// binding guards against). It is a real, existing export.
import { scopesIntersect } from "../core/shell-parse.ts";

// ---------------------------------------------------------------------------
// Minimal §2.4 / §2.5 / §2.1 fixtures: only the fields the pure scheduler may
// consume. queue item -> {id, fileScope, dependsOn}; runtime item -> {id,
// state, blocked, deferred}; config -> {parallel, workflow}. (Mirrors the
// structural-fixture discipline of tests/stops.test.ts.)
// ---------------------------------------------------------------------------

interface QueueItemFixture {
  id: string;
  fileScope: string[];
  dependsOn: string[];
}

interface QueueFixture {
  items: QueueItemFixture[];
}

interface ItemFixture {
  id: string;
  state: string;
  blocked: { reason: string } | null;
  deferred: { reason: string } | null;
}

interface ConfigFixture {
  parallel: { maxImplementers: number; maxReaders: number };
  workflow: {
    planReviewers: number;
    itemReviewers: number;
    vetCritics: number;
    skepticsPerFinding: number;
  };
}

function qItem(
  id: string,
  fileScope: string[],
  dependsOn: string[] = [],
): QueueItemFixture {
  return { id, fileScope, dependsOn };
}

function rItem(
  id: string,
  state = "PENDING",
  over: Partial<Pick<ItemFixture, "blocked" | "deferred">> = {},
): ItemFixture {
  return { id, state, blocked: null, deferred: null, ...over };
}

interface ConfigOver {
  maxImplementers?: number;
  maxReaders?: number;
  planReviewers?: number;
  itemReviewers?: number;
  vetCritics?: number;
  skepticsPerFinding?: number;
}

function cfg(over: ConfigOver = {}): ConfigFixture {
  return {
    parallel: {
      maxImplementers: over.maxImplementers ?? 4,
      maxReaders: over.maxReaders ?? 6,
    },
    workflow: {
      planReviewers: over.planReviewers ?? 4,
      itemReviewers: over.itemReviewers ?? 6,
      vetCritics: over.vetCritics ?? 3,
      skepticsPerFinding: over.skepticsPerFinding ?? 2,
    },
  };
}

function wave(
  queueItems: QueueItemFixture[],
  runItems: ItemFixture[],
  config: ConfigFixture,
): { parallel: string[]; rationale: string } {
  const queue: QueueFixture = { items: queueItems };
  return nextWave(queue, runItems, config);
}

// ---------------------------------------------------------------------------
// [3.3-api] export surface + return shape.
// ---------------------------------------------------------------------------

test("[3.3-api] nextWave and readFanout are exported functions", () => {
  assert.equal(typeof nextWave, "function", "nextWave is exported");
  assert.equal(typeof readFanout, "function", "readFanout is exported");
});

test("[3.3-api] nextWave returns {parallel: string[], rationale: string}", () => {
  const result = wave(
    [qItem("a", ["src/a/**"])],
    [rItem("a")],
    cfg({ maxImplementers: 2 }),
  );
  assert.ok(Array.isArray(result.parallel), "parallel is an array");
  assert.ok(
    result.parallel.every((id) => typeof id === "string"),
    "parallel holds item-id strings",
  );
  assert.equal(typeof result.rationale, "string", "rationale is a string");
  assert.ok(result.rationale.length > 0, "rationale is non-empty");
  assert.deepEqual(
    result.parallel,
    ["a"],
    "a lone dependency-ready item is the whole wave",
  );
});

// §4.2 criterion (c): blocked / deferred items are never wave members even when
// dependency-ready and scope-disjoint.
test("[3.3-api] blocked and deferred candidates are excluded from the wave", () => {
  const result = wave(
    [
      qItem("u", ["src/u/**"]),
      qItem("v", ["src/v/**"]),
      qItem("w", ["src/w/**"]),
    ],
    [
      rItem("u"),
      rItem("v", "PENDING", { blocked: { reason: "test-repair exhausted" } }),
      rItem("w", "PENDING", { deferred: { reason: "not this run" } }),
    ],
    cfg({ maxImplementers: 5 }),
  );
  assert.deepEqual(
    result.parallel,
    ["u"],
    "only the open item schedules; blocked v and deferred w are excluded",
  );
});

// ---------------------------------------------------------------------------
// [3.3-diamond] diamond DAG a -> {b, c} -> d produces the correct waves.
// ---------------------------------------------------------------------------

test("[3.3-diamond] diamond DAG waves: {a}, then {b,c}, then {d}", () => {
  const queue = [
    qItem("a", ["src/a/**"]),
    qItem("b", ["src/b/**"], ["a"]),
    qItem("c", ["src/c/**"], ["a"]),
    qItem("d", ["src/d/**"], ["b", "c"]),
  ];
  const config = cfg({ maxImplementers: 4 });

  // Nothing published: only a is dependency-ready.
  const w1 = wave(
    queue,
    [rItem("a"), rItem("b"), rItem("c"), rItem("d")],
    config,
  );
  assert.deepEqual(w1.parallel, ["a"], "wave 1 is a alone");

  // a PUBLISHED: b and c unlock together (disjoint scopes); d still waits.
  const w2 = wave(
    queue,
    [rItem("a", "PUBLISHED"), rItem("b"), rItem("c"), rItem("d")],
    config,
  );
  assert.deepEqual(
    w2.parallel,
    ["b", "c"],
    "wave 2 fans out b and c in parallel (both depth 1, id order)",
  );

  // a, b, c PUBLISHED: d unlocks.
  const w3 = wave(
    queue,
    [
      rItem("a", "PUBLISHED"),
      rItem("b", "PUBLISHED"),
      rItem("c", "PUBLISHED"),
      rItem("d"),
    ],
    config,
  );
  assert.deepEqual(w3.parallel, ["d"], "wave 3 is d alone");
});

// ---------------------------------------------------------------------------
// [3.3-overlap] fileScope overlap forces serialization.
// ---------------------------------------------------------------------------

test("[3.3-overlap] items with overlapping fileScope serialize (one wave member)", () => {
  const result = wave(
    [qItem("m", ["src/shared/**"]), qItem("n", ["src/shared/**"])],
    [rItem("m"), rItem("n")],
    cfg({ maxImplementers: 2 }),
  );
  assert.equal(
    result.parallel.length,
    1,
    "two items writing the same tree cannot share a wave",
  );
  assert.deepEqual(
    result.parallel,
    ["m"],
    "the deterministic first (depth then id) is the wave; n serializes after",
  );
});

// The conservative scopesIntersect bias (plan 2091-2093) shows up HERE: two
// items whose scopes over-approximate as intersecting must serialize, while a
// genuinely-disjoint pair parallelizes.
test("[3.3-overlap] conservative scopesIntersect bias serializes over-approximated scopes", () => {
  // Over-approximation: distinct real files, identical literal head "src".
  assert.equal(
    scopesIntersect(["src/*.ts"], ["src/*.md"]),
    true,
    "conservative bias: shared literal head reports intersection",
  );
  const biased = wave(
    [qItem("p", ["src/*.ts"]), qItem("q", ["src/*.md"])],
    [rItem("p"), rItem("q")],
    cfg({ maxImplementers: 2 }),
  );
  assert.equal(
    biased.parallel.length,
    1,
    "the over-approximated pair serializes (false-positive only costs parallelism)",
  );
  assert.deepEqual(biased.parallel, ["p"], "deterministic first wins the wave");

  // Genuinely-disjoint control: different literal heads => parallelizable.
  assert.equal(
    scopesIntersect(["one/**"], ["two/**"]),
    false,
    "distinct literal heads are disjoint",
  );
  const disjoint = wave(
    [qItem("p", ["one/**"]), qItem("q", ["two/**"])],
    [rItem("p"), rItem("q")],
    cfg({ maxImplementers: 2 }),
  );
  assert.deepEqual(
    disjoint.parallel,
    ["p", "q"],
    "truly-disjoint items DO fan out together (the bias is not a blanket refusal)",
  );
});

// ---------------------------------------------------------------------------
// [3.3-cap] parallel.maxImplementers caps the wave.
// ---------------------------------------------------------------------------

test("[3.3-cap] parallel.maxImplementers caps the number of wave members", () => {
  const queue = [
    qItem("x", ["src/x/**"]),
    qItem("y", ["src/y/**"]),
    qItem("z", ["src/z/**"]),
  ];
  const items = [rItem("x"), rItem("y"), rItem("z")];

  const capped2 = wave(queue, items, cfg({ maxImplementers: 2 }));
  assert.equal(capped2.parallel.length, 2, "cap of 2 yields exactly 2 members");
  assert.deepEqual(
    capped2.parallel,
    ["x", "y"],
    "the cap keeps the deterministic prefix (depth then id); z waits",
  );

  const capped1 = wave(queue, items, cfg({ maxImplementers: 1 }));
  assert.deepEqual(
    capped1.parallel,
    ["x"],
    "cap of 1 fully serializes even scope-disjoint work",
  );
});

// ---------------------------------------------------------------------------
// [3.3-unlock] only PUBLISHED dependencies unlock dependents.
// ---------------------------------------------------------------------------

test("[3.3-unlock] a dependent unlocks only when its dependency is PUBLISHED", () => {
  const queue = [
    qItem("a", ["src/a/**"]),
    qItem("b", ["src/b/**"], ["a"]),
  ];
  const config = cfg({ maxImplementers: 4 });

  // a PENDING: b is not dependency-ready.
  const pending = wave(queue, [rItem("a"), rItem("b")], config);
  assert.ok(
    !pending.parallel.includes("b"),
    "b is locked while a is unpublished",
  );
  assert.ok(pending.parallel.includes("a"), "a itself is ready");

  // a advanced but NOT published (REVIEWED): still does not unlock b.
  const reviewed = wave(queue, [rItem("a", "REVIEWED"), rItem("b")], config);
  assert.ok(
    !reviewed.parallel.includes("b"),
    "REVIEWED is below PUBLISHED — dependency is not yet satisfied",
  );

  // a PUBLISHED: b unlocks; a (done) is not itself a wave member.
  const published = wave(queue, [rItem("a", "PUBLISHED"), rItem("b")], config);
  assert.deepEqual(
    published.parallel,
    ["b"],
    "PUBLISHED a unlocks b, and the published item is excluded from the wave",
  );
});

// ---------------------------------------------------------------------------
// [3.3-order] deterministic order (DAG depth then id) under input reordering.
// ---------------------------------------------------------------------------

test("[3.3-order] wave order is DAG-depth-then-id, independent of input order", () => {
  // a is PUBLISHED (a satisfied dependency). b depends on a (depth 1); c and d
  // have no dependencies (depth 0). Ready candidates: c, d (depth 0) then b
  // (depth 1); ties broken by id ascending.
  const queue = [
    qItem("a", ["src/a/**"]),
    qItem("b", ["src/b/**"], ["a"]),
    qItem("c", ["src/c/**"]),
    qItem("d", ["src/d/**"]),
  ];
  const items = [
    rItem("a", "PUBLISHED"),
    rItem("b"),
    rItem("c"),
    rItem("d"),
  ];
  const config = cfg({ maxImplementers: 8 });

  const expected = ["c", "d", "b"];

  const forward = wave(queue, items, config);
  assert.deepEqual(
    forward.parallel,
    expected,
    "depth 0 (c, d by id) precede depth 1 (b)",
  );

  // Reverse both inputs: output must be identical (order is intrinsic, not
  // positional).
  const reversed = wave(
    [...queue].reverse(),
    [...items].reverse(),
    config,
  );
  assert.deepEqual(
    reversed.parallel,
    expected,
    "reordering queue and items does not change the wave order",
  );
});

// ---------------------------------------------------------------------------
// [3.3-empty-scope] Phase-1 gate binding: an empty or wildcard-headed (i.e.
// degenerate) fileScope must be treated conservatively — it never shares a
// parallel wave with another item, even though scopesIntersect reports the
// empty scope as disjoint.
// ---------------------------------------------------------------------------

test("[3.3-empty-scope] an empty fileScope conservatively serializes (never parallelizes)", () => {
  // The trap: an empty scope reads as DISJOINT, so a scheduler that trusted
  // scopesIntersect alone would fan e out alongside every other item.
  assert.equal(
    scopesIntersect([], ["src/f/**"]),
    false,
    "empty scope is reported disjoint — exactly the case nextWave must NOT trust",
  );
  const result = wave(
    [qItem("e", []), qItem("f", ["src/f/**"])],
    [rItem("e"), rItem("f")],
    cfg({ maxImplementers: 2 }),
  );
  assert.equal(
    result.parallel.length,
    1,
    "defense-in-depth: the empty-scope item does not join f's wave",
  );
});

test("[3.3-empty-scope] a wildcard-headed fileScope conservatively serializes", () => {
  // A wildcard-headed glob has an empty literal head, so scopesIntersect
  // already over-approximates it as intersecting everything.
  assert.equal(
    scopesIntersect(["**/*.ts"], ["src/h/**"]),
    true,
    "empty literal head prefixes every path — reported intersecting",
  );
  const result = wave(
    [qItem("g", ["**/*.ts"]), qItem("h", ["src/h/**"])],
    [rItem("g"), rItem("h")],
    cfg({ maxImplementers: 2 }),
  );
  assert.equal(
    result.parallel.length,
    1,
    "the wildcard-headed item serializes against the concrete-scope item",
  );
});

// ---------------------------------------------------------------------------
// [3.3-api] readFanout(stage, config): per-stage reader count, capped by
// parallel.maxReaders (the fan-out ceiling, plan line 583 / §4.3 line 1623 —
// "up to maxReaders"). Stage vocabulary: planReview, itemReview, vet, skeptics
// -> workflow.planReviewers / itemReviewers / vetCritics / skepticsPerFinding.
// ---------------------------------------------------------------------------

test("[3.3-api] readFanout returns each stage's configured reader count when under the ceiling", () => {
  const config = cfg({
    maxReaders: 6,
    planReviewers: 4,
    itemReviewers: 6,
    vetCritics: 3,
    skepticsPerFinding: 2,
  });
  assert.equal(readFanout("planReview", config), 4, "planReview -> planReviewers");
  assert.equal(readFanout("itemReview", config), 6, "itemReview -> itemReviewers");
  assert.equal(readFanout("vet", config), 3, "vet -> vetCritics");
  assert.equal(readFanout("skeptics", config), 2, "skeptics -> skepticsPerFinding");

  const fan = readFanout("itemReview", config);
  assert.equal(typeof fan, "number", "readFanout returns a number");
  assert.ok(Number.isInteger(fan) && fan >= 1, "a positive integer fan-out");
});

test("[3.3-api] readFanout caps every stage at parallel.maxReaders", () => {
  const tight = cfg({
    maxReaders: 2,
    planReviewers: 4,
    itemReviewers: 6,
    vetCritics: 3,
    skepticsPerFinding: 2,
  });
  assert.equal(
    readFanout("itemReview", tight),
    2,
    "6 configured readers are clamped to the ceiling of 2",
  );
  assert.equal(readFanout("vet", tight), 2, "3 vet critics clamped to 2");
  assert.ok(
    readFanout("planReview", tight) <= tight.parallel.maxReaders,
    "no stage ever exceeds maxReaders",
  );

  const singleton = cfg({ maxReaders: 1, itemReviewers: 6, vetCritics: 3 });
  assert.equal(
    readFanout("itemReview", singleton),
    1,
    "a ceiling of 1 forces serial reads",
  );
});
