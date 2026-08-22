// The §3.2 item-size row's acceptance-CLUSTER count (core/planning.ts).
//
// SUBJECT: `acceptanceClusters`, and the size row in `validateQueue` that reads
// it. The row asks "does this item cover more than one thing?" and answered it
// by taking each criterion's first non-determiner WORD as that criterion's
// subject. A word's position in an English sentence is not its subject, so the
// count was an artifact of prose style: two live runs were refused for items
// that cover exactly one thing.
//
// The two refusals are pinned verbatim below as regression fixtures:
//   (A) run r-20260821-47df, journal seq 32 — three checks on one function
//       counted as the clusters (slugify, leading, export).
//   (B) the corpus campaign's euler-001-py conductor arm — seven criteria about
//       one solver counted as seven clusters. The arm spent 43.9 minutes and
//       337,052 tokens without leaving INTAKE.
//
// The rows are grouped by the three causes the reproductions established:
//   1. one file spelled two ways counted twice;
//   2. sentence-leading words that are not subjects leaking in as subjects;
//   3. regression GUARDS ("src/registry.py is not modified") counted as
//      subjects, so the row charged an item for promising not to break things.
//
// Every loosening row is paired with a TEETH row. A guard that over-fires is
// visible in the journal; one that never fires is invisible, so the two-things
// corpus at the bottom is asserted as a RATE against the same corpus the old
// scan is measured on, and may not fall below it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptanceClusters, validateQueue, vagueAcceptance } from "../core/planning.ts";
import type { Config, Queue, QueueItem } from "../core/types.ts";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeConfig(): Config {
  return {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 100_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function item(over: Partial<QueueItem> = {}): QueueItem {
  const base: QueueItem = {
    id: "I1",
    title: "an item",
    rationale: "because the run needs it",
    fileScope: ["src/slugify.ts"],
    testScope: ["tests/slugify.test.ts"],
    acceptance: ["slugify lowercases the input"],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the run needs it",
      reuse: "checked src/util.ts; nothing there does it",
      ladderRung: "minimal-code",
    },
  };
  return { ...base, ...over };
}

function queueOf(one: QueueItem): Queue {
  return { items: [one] };
}

/** The cluster violations `validateQueue` reports for one item, if any. */
function clusterViolations(one: QueueItem): string[] {
  return validateQueue(queueOf(one), makeConfig()).violations.filter((v) => /clusters/i.test(v));
}

/** The clusters the size row counts for an item, context and all. */
function clustersOf(one: QueueItem): string[] {
  return acceptanceClusters(one.acceptance, one);
}

// A delimiter is unbalanced when its opener and closer counts disagree; a quote
// is its own pair, so an ODD count is unbalanced. This is the property that
// catches a cluster name torn out of the middle of a token.
function unbalancedDelimiters(text: string): string[] {
  const bad: string[] = [];
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]) {
    if (text.split(open).length !== text.split(close).length) bad.push(`${open}${close}`);
  }
  for (const quote of ['"', "'", "`"]) {
    if ((text.split(quote).length - 1) % 2 !== 0) bad.push(quote);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// the two live manifestations, verbatim
// ---------------------------------------------------------------------------

// Journal seq 32 of run r-20260821-47df, byte for byte.
const MANIFESTATION_A = [
  'slugify("Hello There World") === "hello-there-world"',
  "leading and trailing hyphens are removed",
  "export name and signature are unchanged",
];

// The euler-001-py conductor arm's item.
const MANIFESTATION_B = [
  "src/solvers/p001.py exports solve() taking no arguments",
  "p001.py returns 233168 when called",
  "src/solvers/__init__.py leaves the package importable",
  "solve() completes in under one second",
  "module registers itself with the registry on import",
  "src/registry.py is not modified",
  "tests/check_visible.py still passes",
];

test("[cluster-live-a] the three checks run r-20260821-47df was refused for assert about ONE function, so the item spans one cluster and validateQueue accepts it", () => {
  const subject = item({ acceptance: [...MANIFESTATION_A] });

  assert.deepEqual(
    clustersOf(subject),
    ["src/slugify.ts"],
    "all three criteria assert about the one function, which is the file the item declares; leading and export are sentence-leading words, not subjects",
  );
  assert.deepEqual(
    clusterViolations(subject),
    [],
    "the planner is told nothing about clusters — the live reject named (slugify, leading, export)",
  );
  assert.equal(validateQueue(queueOf(subject), makeConfig()).ok, true, "and the item is accepted");
});

test("[cluster-live-b] the euler-001-py item spans one cluster however its scope is declared, and its two regression guards cost it nothing", () => {
  const oneFile = item({
    fileScope: ["src/solvers/p001.py"],
    testScope: ["tests/test_p001.py"],
    acceptance: [...MANIFESTATION_B],
  });
  assert.deepEqual(clustersOf(oneFile), ["src/solvers/p001.py"], "seven criteria, one solver");
  assert.deepEqual(clusterViolations(oneFile), [], "the live reject counted seven clusters");

  // The same acceptance under the scope the criteria actually require: an item
  // that writes the solver AND its package init. The count may not depend on
  // how honestly the planner declared what it writes.
  const twoFiles = item({
    fileScope: ["src/solvers/p001.py", "src/solvers/__init__.py"],
    testScope: ["tests/test_p001.py"],
    acceptance: [...MANIFESTATION_B],
  });
  assert.deepEqual(clusterViolations(twoFiles), [], "declaring the second file it writes cannot make the item larger");

  // And with the package criterion written as a deliverable rather than as a
  // preservation guard: one criterion names both declared files, which is the
  // item telling the row they are one piece of work.
  const deliverable = item({
    fileScope: ["src/solvers/p001.py", "src/solvers/__init__.py"],
    testScope: ["tests/test_p001.py"],
    acceptance: [
      "src/solvers/p001.py exports solve() taking no arguments",
      "p001.py returns 233168 when called",
      "src/solvers/__init__.py imports p001 and registers it",
      "solve() completes in under one second",
      "src/registry.py is not modified",
    ],
  });
  assert.deepEqual(clusterViolations(deliverable), [], "a criterion naming two declared files says they are one cluster");
});

// ---------------------------------------------------------------------------
// cause 1 — one file spelled two ways
// ---------------------------------------------------------------------------

test("[cluster-one-file-two-spellings] a file the item declares is ONE cluster however a criterion spells it, and a symbol a criterion introduces beside its file belongs to that file", () => {
  const spellings = item({
    fileScope: ["src/solvers/p001.py"],
    testScope: ["tests/test_p001.py"],
    acceptance: ["src/solvers/p001.py exports solve()", "p001.py returns 233168"],
  });
  assert.deepEqual(clustersOf(spellings), ["src/solvers/p001.py"], "the full path and the bare filename are one file");

  const dotSlash = item({
    fileScope: ["src/a.ts"],
    testScope: ["tests/a.test.ts"],
    acceptance: ["./src/a.ts exports run()", "src/a.ts returns 0 on success"],
  });
  assert.deepEqual(clustersOf(dotSlash), ["src/a.ts"], '"./src/a.ts" and "src/a.ts" are one path');

  const fileAndSymbol = item({
    fileScope: ["src/backoff.ts"],
    testScope: ["tests/backoff.test.ts"],
    acceptance: ["src/backoff.ts exports backoffDelays(attempts, baseMs)", "backoffDelays(3, 100) === [100, 200]"],
  });
  assert.deepEqual(
    clustersOf(fileAndSymbol),
    ["src/backoff.ts"],
    "the first criterion says backoffDelays lives in src/backoff.ts, so the second is about that file",
  );

  // The counter-case that keeps the fold honest: two DIFFERENT files whose
  // basenames agree stay two clusters. Folding on the basename alone would
  // collapse them.
  const sameBasename = item({
    fileScope: ["src/a/util.ts", "src/b/util.ts"],
    testScope: ["tests/util.test.ts"],
    acceptance: ["src/a/util.ts trims the label", "src/b/util.ts pads the label"],
  });
  assert.equal(clustersOf(sameBasename).length, 2, "two files that merely share a basename are two clusters");
});

// ---------------------------------------------------------------------------
// cause 2 — sentence-leading words that are not subjects
// ---------------------------------------------------------------------------

test("[cluster-agentless-heads-abstain] a criterion whose grammar puts no subject at the front contributes no cluster instead of contributing the word that happens to be there", () => {
  const rows: ReadonlyArray<{ why: string; scope: string; acceptance: string[] }> = [
    { why: "adjective opener", scope: "src/slugify.ts", acceptance: ["slugify lowercases the input", "leading hyphens are removed"] },
    { why: "language-construct noun", scope: "src/slugify.ts", acceptance: ["slugify collapses punctuation runs", "export name and signature are unchanged"] },
    { why: "gerund opener", scope: "src/duration.py", acceptance: ['parse_duration("1h30m") returns 5400', 'calling parse_duration("") raises ValueError', "passing an unknown unit raises ValueError"] },
    { why: "gerund opener (moving)", scope: "src/machine.ts", acceptance: ["step advances the head one cell", "moving off the board sets alive to false"] },
    { why: "existential opener", scope: "src/wrap.ts", acceptance: ["wrap emits a line per greedy fill", "there is no trailing newline"] },
    { why: "prepositional opener", scope: "src/retry.ts", acceptance: ["callWithRetry returns fn()'s value on success", "on a thrown error it retries using the backoff schedule"] },
    { why: "generic noun (module)", scope: "src/solve.py", acceptance: ["solve() returns 233168", "module registers itself with the registry on import"] },
    { why: "generic noun (output)", scope: "src/dedent.ts", acceptance: ["dedent removes the common leading prefix", "the output has no trailing newline"] },
    { why: "passive puts the subject last", scope: "src/slugify.ts", acceptance: ["the empty string is returned by slugify", "slugify trims hyphens"] },
    { why: "literal value as subject", scope: "src/solve.py", acceptance: ["solve() runs in under a second", "233168 is returned by solve()"] },
    { why: "literal value as subject (float)", scope: "src/summary.py", acceptance: ["summarize_json emits one line of JSON", "30.5 is written 30.5 and 10.0 is written 10"] },
    { why: "the third-criterion cliff", scope: "src/duration.py", acceptance: ['parse_duration("1h30m") returns 5400', 'parse_duration("") raises ValueError', "whitespace around the text is ignored"] },
    { why: "given/when preamble", scope: "src/slugify.ts", acceptance: ["given an empty input slugify returns ''", "when input is '!!!' slugify returns ''"] },
    { why: "markdown bullets", scope: "src/slugify.ts", acceptance: ["- slugify lowercases the input", "* slugify trims hyphens"] },
    { why: "numbered list", scope: "src/slugify.ts", acceptance: ["1. slugify lowercases the input", "2. slugify trims hyphens"] },
    { why: "checkbox list", scope: "src/slugify.ts", acceptance: ["[ ] slugify lowercases the input", "[x] slugify trims hyphens"] },
  ];
  for (const row of rows) {
    const subject = item({ fileScope: [row.scope], testScope: ["tests/t.test.ts"], acceptance: row.acceptance });
    assert.deepEqual(
      clusterViolations(subject),
      [],
      `${row.why}: one subject, ${String(row.acceptance.length)} criteria — got ${JSON.stringify(clustersOf(subject))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// cause 3 — a promise not to break something is not a second thing
// ---------------------------------------------------------------------------

test("[cluster-guards-do-not-divide] a preservation criterion contributes no cluster, so the size row stops charging an item for its non-regression discipline", () => {
  const rows: ReadonlyArray<{ why: string; scope: string; acceptance: string[] }> = [
    { why: "a file the item does not write", scope: "src/solvers/p001.py", acceptance: ["solve() returns 233168", "src/registry.py is not modified"] },
    { why: "two guards at once", scope: "src/level.ts", acceptance: ["levelFor(3) === 2", "src/state.ts is not changed", "tests/visible.test.ts still passes"] },
    { why: "no existing test is modified", scope: "src/slugify.ts", acceptance: ["slugify returns a hyphenated string", "no existing test is modified"] },
    { why: "an unchanged function", scope: "src/table.ts", acceptance: ["formatTable pads each column", "summarize() is unchanged"] },
    { why: "continues to compile", scope: "src/wrap.hpp", acceptance: ["wrap emits one line per fill", "src/main.cpp continues to compile"] },
    { why: "leaves the package importable", scope: "src/solvers/p001.py", acceptance: ["solve() returns 233168", "src/solvers/__init__.py leaves the package importable"] },
  ];
  for (const row of rows) {
    const subject = item({ fileScope: [row.scope], testScope: ["tests/t.test.ts"], acceptance: row.acceptance });
    assert.deepEqual(
      clusterViolations(subject),
      [],
      `${row.why}: got ${JSON.stringify(clustersOf(subject))}`,
    );
  }

  // Adding a guard can never RAISE the count: the property that inverts the
  // defect rather than merely softening it.
  const bare = item({ acceptance: ["slugify lowercases the input"] });
  const guarded = item({
    acceptance: [
      "slugify lowercases the input",
      "src/registry.py is not modified",
      "tests/visible.test.ts still passes",
      "the public export list is unchanged",
    ],
  });
  assert.ok(
    clustersOf(guarded).length <= clustersOf(bare).length,
    `promising not to break four more things cannot make an item larger; got ${JSON.stringify(clustersOf(guarded))}`,
  );
});

test("[cluster-guard-vocabulary-does-not-swallow-work] an ordinary criterion that merely mentions holding, keeping or staying is still a deliverable, and an adversative defeats a preservation claim", () => {
  const stillWork: ReadonlyArray<[string, string]> = [
    ["the flag is unset by default", "flag"],
    ["the parser is not case sensitive", "parser"],
    ["memoize keeps its arity intact", "memoize"],
    ["the cache remains warm across calls", "cache"],
    ["the list stays sorted after insert", "list"],
    ["the parser continues to accept UTF-8", "parser"],
  ];
  for (const [criterion, why] of stillWork) {
    const paired = item({
      fileScope: ["src/a.ts"],
      testScope: ["tests/a.test.ts"],
      acceptance: [criterion, "router retries on 502"],
    });
    assert.equal(
      clusterViolations(paired).length,
      1,
      `"${criterion}" delivers ${why} and is not a preservation guard, so pairing it with a second subject is still two things`,
    );
  }

  const adversative = item({
    acceptance: ["slugify lowercases the input", "src/router.ts is unchanged apart from the new retry"],
  });
  assert.equal(
    clusterViolations(adversative).length,
    1,
    "a preservation claim that carves out an exception is not a guard — it delivers the exception",
  );
});

// ---------------------------------------------------------------------------
// cause 4 — the subject is the HEAD, not whatever name stands near it
// ---------------------------------------------------------------------------

test("[cluster-head-beats-a-name-in-object-position] a criterion whose head is a legal subject keeps it, so naming a return type or an output path in the object does not split one subject into two", () => {
  const rows: ReadonlyArray<{ why: string; scope: string; acceptance: string[] }> = [
    { why: "an output path as the object", scope: "src/generate/main.ts", acceptance: ["the generator writes docs/api.md", "the generator exits 0"] },
    { why: "a return type as the object", scope: "src/lang/parse-entry.ts", acceptance: ["parse returns AstNode for a valid input", "parse throws on empty input"] },
    { why: "a dotted member as the object", scope: "src/parser.ts", acceptance: ["parser rejects config.load(cfg)", "parser exposes the parsed table"] },
    { why: "a snake_case identifier as the object", scope: "src/parser.ts", acceptance: ["the parser rejects unknown_key entries", "the parser accepts a well-formed file"] },
    { why: "an upper snake_case constant as the object", scope: "src/router.ts", acceptance: ["the router retries HTTP_502 responses", "the router logs each attempt"] },
    { why: "the doctrine's own worked example", scope: "src/lang/parse-entry.ts", acceptance: ["parse rejects empty input", "parse returns AstNode on success"] },
  ];
  for (const row of rows) {
    const subject = item({ fileScope: [row.scope], testScope: ["tests/t.test.ts"], acceptance: row.acceptance });
    assert.deepEqual(
      clusterViolations(subject),
      [],
      `${row.why}: one subject, two checks — got ${JSON.stringify(clustersOf(subject))}`,
    );
  }

  // The window is still what reads a criterion whose head abstains: the object
  // wins only when the head is not a subject at all.
  const gerund = item({
    fileScope: ["src/backoff.ts"],
    testScope: ["tests/backoff.test.ts"],
    acceptance: ["calling backoffDelays(3, 100) returns [100, 200]", "calling backoffDelays(1, 100) returns [100]"],
  });
  assert.deepEqual(clustersOf(gerund), ["backoffdelays"], "a gerund head abstains, and the window then reads the call");
});

test("[cluster-declared-file-named-by-its-bare-stem] a file the item declares is one cluster when one criterion spells it as a path and a sibling names it by its bare stem", () => {
  const stem = item({
    fileScope: ["src/slugify.ts"],
    testScope: ["tests/slugify.test.ts"],
    acceptance: ["src/slugify.ts lowercases the input", "slugify trims hyphens"],
  });
  assert.deepEqual(clustersOf(stem), ["src/slugify.ts"], "the path and the bare stem are the one declared file");
  assert.deepEqual(clusterViolations(stem), [], "one file, two checks");

  // Manifestation (B) is one word from re-breaking: its sibling criterion spells
  // the solver "p001.py", and the bare stem "p001" must fold the same way.
  const euler = item({
    fileScope: ["src/solvers/p001.py"],
    testScope: ["tests/test_p001.py"],
    acceptance: ["src/solvers/p001.py exports solve() taking no arguments", "p001 returns 233168 when called"],
  });
  assert.deepEqual(clusterViolations(euler), [], `the bare stem is the declared file; got ${JSON.stringify(clustersOf(euler))}`);
});

// ---------------------------------------------------------------------------
// cause 5 — "by" is an agent only when it introduces one
// ---------------------------------------------------------------------------

test("[cluster-adverbial-by-is-not-an-agent] an adverbial or sort-criterion by-phrase is not the criterion's subject, and an agent phrase never outranks a head that names something", () => {
  const rows: ReadonlyArray<{ why: string; scope: string; acceptance: string[] }> = [
    { why: "by default", scope: "src/config.ts", acceptance: ["the retry limit is applied by default", "parser rejects an unknown key"] },
    { why: "sorted by a field", scope: "src/sort.ts", acceptance: ["the rows are sorted by name", "sortRows returns a new array"] },
    { why: "two sort criteria on one list", scope: "src/list.ts", acceptance: ["the list is sorted by name", "the list is filtered by date"] },
    { why: "grouped and ordered", scope: "src/report.ts", acceptance: ["the report is grouped by day", "the report is ordered by total"] },
    { why: "a declared path beats the by-phrase", scope: "src/router.ts", acceptance: ["src/router.ts retries on 502", "src/router.ts is exercised by the integration suite"] },
    { why: "a call-syntax head beats the by-phrase", scope: "src/duration.py", acceptance: ['parse_duration("1h") returns 3600', 'parse_duration("") is rejected by the caller'] },
    { why: "an adverbial by shadowing a later agent", scope: "src/config.ts", acceptance: ["parser rejects an unknown key", "a 502 is retried by default by the parser"] },
  ];
  for (const row of rows) {
    const subject = item({ fileScope: [row.scope], testScope: ["tests/t.test.ts"], acceptance: row.acceptance });
    assert.deepEqual(
      clusterViolations(subject),
      [],
      `${row.why}: one subject — got ${JSON.stringify(clustersOf(subject))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// cause 6 — a guard preserves an artifact it NAMES, and preserves only its own
// clause
// ---------------------------------------------------------------------------

test("[cluster-guard-names-the-artifact-it-preserves] guard vocabulary over a criterion that names no file, test or symbol is an ordinary deliverable and still counts", () => {
  const deliverables: ReadonlyArray<[string, string]> = [
    ["the daemon still runs after a config reload", "daemon"],
    ["the cache still loads after an eviction", "cache"],
    ["the router keeps the pooled connection working across retries", "router"],
    ["an existing row is not renamed by the migration", "the migration"],
  ];
  // "the queue entry is not removed until the TTL expires" belongs to this class
  // too and is deliberately absent: its main clause is an agentless passive, so
  // the abstention grammar drops it whatever the guard rule says, and a row that
  // passes for a second reason pins nothing.
  for (const [criterion, why] of deliverables) {
    const paired = item({
      fileScope: ["src/parser.ts"],
      testScope: ["tests/parser.test.ts"],
      acceptance: ["src/parser.ts rejects an unknown key", criterion],
    });
    assert.equal(
      clusterViolations(paired).length,
      1,
      `"${criterion}" delivers ${why} and names no artifact to preserve, so it is a second thing; got ${JSON.stringify(clustersOf(paired))}`,
    );
  }

  // The same vocabulary over a criterion that DOES name the artifact is the
  // guard it looks like, and costs nothing.
  const guards = [
    "src/daemon.ts still runs",
    "src/cache.ts is not deleted",
    "tests/visible.test.ts keeps passing",
    "src/legacy.ts must not be touched",
    "src/registry.py must not be modified",
    "no changes to src/registry.py",
    "the CLI behaviour must not change",
    "the tests keep passing",
  ];
  for (const criterion of guards) {
    const guarded = item({
      fileScope: ["src/parser.ts"],
      testScope: ["tests/parser.test.ts"],
      acceptance: ["src/parser.ts rejects an unknown key", criterion],
    });
    assert.deepEqual(
      clusterViolations(guarded),
      [],
      `"${criterion}" promises not to break something and costs nothing; got ${JSON.stringify(clustersOf(guarded))}`,
    );
  }
});

test("[cluster-guard-filter-drops-the-clause-not-the-criterion] a guard clause beside a deliverable in ONE criterion hides nothing: the deliverable half still names its subject", () => {
  const rows: ReadonlyArray<{ why: string; criterion: string; subject: string }> = [
    { why: "guard leads", criterion: "src/registry.py is not modified and src/telemetry.ts sends a heartbeat every 30s", subject: "src/telemetry.ts" },
    { why: "guard trails", criterion: "src/telemetry.ts sends a heartbeat every 30s and the suite still passes", subject: "src/telemetry.ts" },
    { why: "guard trails a bare subject", criterion: "router retries on 502 and no existing test is broken", subject: "router" },
    { why: "guard trails after a semicolon", criterion: "router retries on 502; no existing test is broken", subject: "router" },
  ];
  for (const row of rows) {
    const subject = item({
      fileScope: ["src/a.ts"],
      testScope: ["tests/a.test.ts"],
      acceptance: ["src/a.ts exports run()", row.criterion],
    });
    assert.deepEqual(
      clustersOf(subject),
      ["src/a.ts", row.subject],
      `${row.why}: the guard clause is dropped, the deliverable clause is not`,
    );
  }

  // A coordinated NOUN PHRASE inside one guard clause is not two clauses: the
  // whole criterion is still the guard it reads as.
  const coordinated = item({
    fileScope: ["src/slugify.ts"],
    testScope: ["tests/slugify.test.ts"],
    acceptance: ["slugify lowercases the input", "export name and signature are unchanged"],
  });
  assert.deepEqual(clustersOf(coordinated), ["src/slugify.ts"], "a guard over a coordinated subject is one guard");
});

// ---------------------------------------------------------------------------
// cause 7 — a coarse declared scope may not fold what it does not name
// ---------------------------------------------------------------------------

test("[cluster-glob-scope-does-not-fold-its-members] a directory glob in fileScope is not a cluster: two files under it stay two, and two criteria about ONE file under it stay one", () => {
  const twoFiles = item({
    fileScope: ["src/**"],
    testScope: ["tests/t.test.ts"],
    acceptance: ["src/parser.ts rejects an unknown key", "src/router.ts retries once on a 502"],
  });
  assert.deepEqual(
    clustersOf(twoFiles),
    ["src/parser.ts", "src/router.ts"],
    "the glob is the scope entry, not the subject: the criteria name two files",
  );

  const oneFile = item({
    fileScope: ["src/**"],
    testScope: ["tests/t.test.ts"],
    acceptance: ["src/parser.ts rejects an unknown key", "src/parser.ts accepts a well-formed file"],
  });
  assert.deepEqual(clusterViolations(oneFile), [], "two checks on one file under a glob scope are one cluster");
});

// ---------------------------------------------------------------------------
// cause 8 — a passive clause suppresses the clause it is in, not the sentence
// ---------------------------------------------------------------------------

test("[cluster-passive-suppresses-its-own-clause-only] a trailing subordinate passive does not blank the ACTIVE head in front of it, and an agentless passive main clause still abstains", () => {
  const stillTwo = item({
    fileScope: ["src/config.ts"],
    testScope: ["tests/config.test.ts"],
    acceptance: ["parser rejects an unknown key", "router retries on 502 when the connection is dropped"],
  });
  assert.deepEqual(clustersOf(stillTwo), ["parser", "router"], "the passive sits in the subordinate clause; the head is active");

  const three = item({
    fileScope: ["src/config.ts"],
    testScope: ["tests/config.test.ts"],
    acceptance: [
      "parser rejects an unknown key",
      "router retries on 502 when the connection is dropped",
      "cache evicts on overflow once the limit is exceeded",
    ],
  });
  assert.equal(clustersOf(three).length, 3, `three things stay three; got ${JSON.stringify(clustersOf(three))}`);

  // The abstention itself is intact: a criterion whose MAIN clause is passive
  // and names no agent still contributes nothing.
  const agentless = item({
    fileScope: ["src/duration.py"],
    testScope: ["tests/t.test.ts"],
    acceptance: ['parse_duration("1h30m") returns 5400', "whitespace around the text is ignored"],
  });
  assert.deepEqual(clustersOf(agentless), ["parse_duration"], "an agentless passive main clause abstains");
});

// ---------------------------------------------------------------------------
// TEETH — not optional
// ---------------------------------------------------------------------------

// Genuinely-two-things items, one row per shape the smell arrives in. The
// SECOND element is why the row is here, so a future loosening that deletes one
// has to delete its reason too.
const TWO_THINGS: ReadonlyArray<{ why: string; scope: string[]; acceptance: string[] }> = [
  { why: "two bare subjects", scope: ["src/config.ts"], acceptance: ["parser rejects an unknown key", "router retries on 502"] },
  { why: "two bare subjects behind articles", scope: ["src/config.ts"], acceptance: ["the parser rejects an unknown key", "the router retries on 502"] },
  { why: "the near miss: a member is not its owner", scope: ["src/config.ts"], acceptance: ["config.load(cfg) rejects an unknown key with a named error", "config exposes the parsed table"] },
  { why: "two call-syntax subjects", scope: ["src/config.ts"], acceptance: ['pad("a") === "[a]"', 'trim("b") === "b"'] },
  { why: "two declared files, named as paths", scope: ["src/parser.ts", "src/router.ts"], acceptance: ["src/parser.ts rejects an unknown key", "src/router.ts retries once on a 502"] },
  { why: "a lexer and an emitter", scope: ["src/lexer.ts", "src/parser.ts"], acceptance: ["src/lexer.ts tokenizes braces", "src/parser.ts builds the AST"] },
  { why: "a path the item does not declare, actively asserted about", scope: ["src/a.ts"], acceptance: ["src/a.ts exports run()", "src/telemetry.ts sends a heartbeat every 30s"] },
  { why: "an adversative defeats the guard vocabulary", scope: ["src/slugify.ts"], acceptance: ["slugify lowercases the input", "src/router.ts is unchanged apart from the new retry"] },
  { why: "passive voice naming its agent", scope: ["src/slugify.ts"], acceptance: ["slugify lowercases the input", "a 502 response is retried by the router"] },
  { why: "two calls behind one gerund", scope: ["src/backoff.ts"], acceptance: ["calling backoffDelays(3, 100) returns [100, 200]", "calling callWithRetry twice records both delays"] },
  { why: "two camelCase subjects", scope: ["src/backoff.ts"], acceptance: ["backoffDelays(3,100) === [100,200]", "callWithRetry re-throws the last error"] },
  { why: "two snake_case subjects", scope: ["src/util.py"], acceptance: ['parse_duration("1h") returns 3600', "format_table pads each column"] },
  { why: "three subjects", scope: ["src/config.ts"], acceptance: ["parser rejects an unknown key", "router retries on 502", "cache evicts on overflow"] },
  { why: "an anchored criterion beside a second bare subject", scope: ["src/a.ts"], acceptance: ["src/a.ts exports run()", "telemetry sends a heartbeat every 30s"] },
  // The shapes a planner reaches for AFTER a refusal names its clusters back to
  // it. Each is a one-phrase edit to an item that still covers two things, and
  // each was measured escaping the row it is filed under.
  { why: "a directory glob declared in place of the two paths", scope: ["src/**"], acceptance: ["src/parser.ts rejects an unknown key", "src/router.ts retries once on a 502"] },
  { why: "a leading guard clause carrying a second deliverable", scope: ["src/a.ts"], acceptance: ["src/a.ts exports run()", "src/registry.py is not modified and src/telemetry.ts sends a heartbeat every 30s"] },
  { why: "a trailing guard clause on a second deliverable", scope: ["src/a.ts"], acceptance: ["src/a.ts exports run()", "src/telemetry.ts sends a heartbeat every 30s and the suite still passes"] },
  { why: "a guard clause on a bare-subject deliverable", scope: ["src/config.ts"], acceptance: ["parser rejects an unknown key", "router retries on 502 and no existing test is broken"] },
  { why: "a trailing subordinate clause in the passive", scope: ["src/config.ts"], acceptance: ["parser rejects an unknown key", "router retries when the connection is dropped"] },
  { why: "a co-naming criterion that relates the two files to nothing", scope: ["src/lexer.ts", "src/parser.ts"], acceptance: ["src/lexer.ts tokenizes braces", "src/parser.ts builds the AST", "src/lexer.ts and src/parser.ts are both formatted"] },
  { why: "a symbol mentioned in passing does not move house", scope: ["src/a.ts"], acceptance: ["src/a.ts exports run() and never calls telemetry.send()", "telemetry.send() posts a heartbeat every 30s"] },
  { why: "guard VOCABULARY on a criterion that names no artifact to preserve", scope: ["src/parser.ts"], acceptance: ["src/parser.ts rejects an unknown key", "the daemon still runs after a config reload"] },
];

test("[cluster-still-rejects-two-things] the size guard is not loosened into uselessness: every genuinely-two-things shape is still REJECTED, and the rejection names both subjects", () => {
  for (const row of TWO_THINGS) {
    const subject = item({ fileScope: [...row.scope], testScope: ["tests/t.test.ts"], acceptance: row.acceptance });
    const violations = clusterViolations(subject);
    assert.equal(
      violations.length,
      1,
      `${row.why}: this item covers two things and must be refused; got clusters ${JSON.stringify(clustersOf(subject))}`,
    );
    assert.match(violations[0], /spans \d+ clusters/i, `${row.why}: the rejection is the one-cluster budget's`);
  }
});

test("[cluster-teeth-rate] the repaired row rejects at least as many genuinely-two-things items as the scan it replaces, measured over the same corpus", () => {
  // The positional scan this row replaces, kept here as the floor to measure
  // against: first non-determiner token per criterion.
  const determiners = new Set([
    "the", "a", "an", "its", "it", "this", "that", "these", "those",
    "each", "every", "all", "any", "no", "our", "their", "his", "her",
    "when", "if", "given", "after", "before", "and", "or", "but", "then",
  ]);
  function positionalClusters(acceptance: readonly string[]): string[] {
    const subjects: string[] = [];
    for (const criterion of acceptance) {
      let subject = "";
      for (const raw of criterion.trim().split(/\s+/)) {
        const token = raw.replace(/^[^\w./-]+/, "").replace(/[^\w./-]+$/, "").toLowerCase();
        if (token.length === 0) continue;
        if (determiners.has(token)) continue;
        const identifier = /^[\w./-]+/.exec(token);
        if (identifier === null) continue;
        subject = identifier[0];
        break;
      }
      if (subject.length > 0 && !subjects.includes(subject)) subjects.push(subject);
    }
    return subjects;
  }

  let repaired = 0;
  let positional = 0;
  for (const row of TWO_THINGS) {
    const subject = item({ fileScope: [...row.scope], testScope: ["tests/t.test.ts"], acceptance: row.acceptance });
    if (acceptanceClusters(row.acceptance, subject).length > 1) repaired += 1;
    if (positionalClusters(row.acceptance).length > 1) positional += 1;
  }
  assert.ok(
    repaired >= positional,
    `the repaired row must not trade an over-firing guard for a never-firing one: repaired ${String(repaired)}/${String(TWO_THINGS.length)} against the positional scan's ${String(positional)}/${String(TWO_THINGS.length)}`,
  );
  assert.equal(repaired, TWO_THINGS.length, "and on this corpus it catches every one");
});

// ---------------------------------------------------------------------------
// the message the planner reads
// ---------------------------------------------------------------------------

test("[cluster-violation-names-and-remedy] the rejection quotes names a human recognises and prescribes a move the rest of the table permits", () => {
  const subject = item({
    fileScope: ["src/config.ts"],
    testScope: ["tests/config.test.ts"],
    acceptance: ['pad("a") === "[a]"', 'trim("b") === "b"'],
  });
  const violations = clusterViolations(subject);
  assert.equal(violations.length, 1, `premise: exactly one cluster violation; got ${violations.join(" | ")}`);

  const named = /clusters \((.*)\), over the one-cluster/.exec(violations[0]);
  assert.notEqual(named, null, `the violation lists the clusters it counted; got: ${violations[0]}`);
  const names = (named === null ? "" : named[1]).split(", ");
  assert.equal(names.length, 2, `two clusters were counted, so two names are listed; got: ${violations[0]}`);
  for (const name of names) {
    assert.deepEqual(
      unbalancedDelimiters(name),
      [],
      `the cluster name "${name}" is quoted back at the planner and must be a thing that exists in the item`,
    );
    assert.doesNotMatch(name, /,/, `a cluster name may not contain the separator the list is joined with: "${name}"`);
  }

  // "split it into one item per cluster" is not a legal move when the clusters
  // share a file: the inter-item scope-disjointness row refuses the split. The
  // remedy must name moves the table permits.
  assert.doesNotMatch(
    violations[0],
    /one item per cluster/i,
    "the remedy may not prescribe a split the disjointness row rejects",
  );

  // Obeying the remedy has to be possible. One item per subject, each with its
  // own file, passes the whole table.
  const split: Queue = {
    items: [
      item({ id: "I1", fileScope: ["src/pad.ts"], testScope: ["tests/pad.test.ts"], acceptance: ['pad("a") === "[a]"'] }),
      item({ id: "I2", fileScope: ["src/trim.ts"], testScope: ["tests/trim.test.ts"], acceptance: ['trim("b") === "b"'] }),
    ],
  };
  assert.equal(validateQueue(split, makeConfig()).ok, true, "the remedy the violation names is reachable");
});

test("[cluster-guards-never-raise-the-count] adding a preservation guard to any acceptance leaves the count where it was, including when nothing else in the acceptance resolves", () => {
  const ladder: ReadonlyArray<{ why: string; scope: string; bare: string[] }> = [
    { why: "a head the scan reads", scope: "src/slugify.ts", bare: ["slugify lowercases the input"] },
    { why: "a generic head that abstains", scope: "src/dedent.ts", bare: ["the output has no trailing newline"] },
    { why: "a deictic head that abstains", scope: "src/wrap.ts", bare: ["there is no trailing whitespace in the emitted file"] },
    { why: "a passive head that abstains", scope: "src/parse.ts", bare: ["an empty input is rejected with a parse error"] },
  ];
  const guards = ["src/registry.py is not modified", "tests/visible.test.ts still passes", "src/legacy.ts is untouched"];
  for (const row of ladder) {
    const bare = item({ fileScope: [row.scope], testScope: ["tests/t.test.ts"], acceptance: [...row.bare] });
    for (let n = 1; n <= guards.length; n += 1) {
      const guarded = item({
        fileScope: [row.scope],
        testScope: ["tests/t.test.ts"],
        acceptance: [...row.bare, ...guards.slice(0, n)],
      });
      assert.ok(
        clustersOf(guarded).length <= clustersOf(bare).length,
        `${row.why}: ${String(n)} guard(s) raised the count from ${JSON.stringify(clustersOf(bare))} to ${JSON.stringify(clustersOf(guarded))}`,
      );
      assert.deepEqual(clusterViolations(guarded), [], `${row.why}: ${String(n)} guard(s) refused a one-thing item`);
    }
  }

  // A pure-refactor item, whose acceptance is guards and nothing else, spans no
  // clusters at all. It is the acceptance shape a "behaviour must not change"
  // spec produces, and every criterion in it is a promise every half of a split
  // would still owe.
  const allGuards = item({
    fileScope: ["src/api.ts"],
    testScope: ["tests/api.test.ts"],
    acceptance: ["the exported names are unchanged", "tests/api.test.ts still passes", "src/registry.py is not modified"],
  });
  assert.deepEqual(clustersOf(allGuards), [], "an acceptance that only preserves delivers no subject to count");
  assert.deepEqual(clusterViolations(allGuards), [], "and a pure-refactor item is not refused for its discipline");
});

// ---------------------------------------------------------------------------
// the floor, and the residuals — pinned as known behaviour, not hidden
// ---------------------------------------------------------------------------

test("[cluster-last-resort-floor] acceptance in which no criterion names anything falls back to the positional scan rather than to silence", () => {
  // Neither criterion carries a name, a call, a path or any token the item's
  // own scope corroborates, so nothing resolves. The row then reports what the
  // positional scan reports: over-strict, and identical to the behaviour this
  // repair replaces — never zero clusters, which would switch the guard off on
  // exactly the prose that hides a two-things item best.
  const nameless = item({
    fileScope: ["src/parse.ts"],
    testScope: ["tests/parse.test.ts"],
    acceptance: ["an empty input is rejected with a parse error", "a well-formed document is accepted"],
  });
  assert.deepEqual(
    clustersOf(nameless),
    ["empty", "well-formed"],
    "the fallback is the positional scan, defects and all — a KNOWN false positive, kept so the row cannot be switched off by writing prose",
  );
});

test("[cluster-known-residuals] the shapes this row still gets wrong are pinned, so a later repair has to rewrite them deliberately", () => {
  // KNOWN FALSE POSITIVE. Verb-leading criteria carry no subject at all, and
  // `rejects`/`accepts` are string-indistinguishable from `parser`/`router`,
  // which the teeth row above requires to stay two clusters. conductor/doctrine
  // teaches the planner to name the subject instead.
  const verbLed = item({
    fileScope: ["src/parse.ts"],
    testScope: ["tests/parse.test.ts"],
    acceptance: ["rejects empty input with a parse error", "accepts a well-formed document"],
  });
  assert.equal(clusterViolations(verbLed).length, 1, "verb-leading acceptance is still refused; the doctrine pack teaches against it");
  const named = item({
    fileScope: ["src/parse.ts"],
    testScope: ["tests/parse.test.ts"],
    acceptance: ["parse rejects empty input with a parse error", "parse accepts a well-formed document"],
  });
  assert.deepEqual(clusterViolations(named), [], "and naming the subject is what the doctrine asks for, and passes");

  // KNOWN FALSE NEGATIVE. One criterion can never yield two subjects, so a
  // planner that concatenates its checks escapes the row entirely. The repair
  // removes the pressure to do it; it does not close the hole.
  const jammed = item({
    fileScope: ["src/config.ts"],
    testScope: ["tests/config.test.ts"],
    acceptance: ['pad("a") === "[a]" and trim("b") === "b"'],
  });
  assert.deepEqual(jammed.acceptance.length === 1 ? clusterViolations(jammed) : ["unreachable"], [], "a single criterion is at most one cluster, whatever it joins");

  // KNOWN FALSE NEGATIVE. Two subjects behind one generic noun collapse, because
  // the row cannot tell a repeated real subject from a repeated generic one.
  const generic = item({
    fileScope: ["src/mod.py"],
    testScope: ["tests/mod_test.py"],
    acceptance: ["the module registers itself with the registry", "the module prints the report table"],
  });
  assert.deepEqual(clusterViolations(generic), [], "two things behind one generic noun are not caught");

  // KNOWN FALSE POSITIVE. The floor reads a criterion the grammar abstained on,
  // so an acceptance where EVERY criterion abstains and whose leading nouns
  // differ is refused for its prose. The floor is the deliberate strictness the
  // row above pins; this is the price of it.
  const abstained = item({
    fileScope: ["src/emit.ts"],
    testScope: ["tests/emit.test.ts"],
    acceptance: ["the total is computed by summing the values", "the report is generated by writing the rows"],
  });
  assert.deepEqual(clustersOf(abstained), ["total", "report"], "the floor reports the positional reading of two abstaining criteria");

  // KNOWN FALSE POSITIVE. A directory glob is not the canonical spelling of any
  // one file, so the two spellings of one file under it cannot be folded onto
  // each other. Declaring the path the item writes is what folds them.
  const globSpellings = item({
    fileScope: ["src/**"],
    testScope: ["tests/t.test.ts"],
    acceptance: ["src/parser.ts rejects an unknown key", "parser.ts accepts a well-formed file"],
  });
  assert.equal(clustersOf(globSpellings).length, 2, "a glob scope cannot canonicalize a bare filename");

  // KNOWN FALSE NEGATIVE. Two declared files fold when a criterion RELATES them,
  // and two independent clauses jammed into one criterion look like a relation:
  // "src/lexer.ts is formatted and src/parser.ts is formatted" puts a word
  // between the two mentions. It is the jammed-criterion hole above wearing the
  // fold's clothes, and it closes with that one, not separately.
  const jammedFold = item({
    fileScope: ["src/lexer.ts", "src/parser.ts"],
    testScope: ["tests/t.test.ts"],
    acceptance: [
      "src/lexer.ts tokenizes braces",
      "src/parser.ts builds the AST",
      "src/lexer.ts is formatted and src/parser.ts is formatted",
    ],
  });
  assert.deepEqual(clusterViolations(jammedFold), [], "two clauses in one criterion read as one criterion relating two files");
});

// ---------------------------------------------------------------------------
// the sibling acceptance row: a function identifier is not an English verb
// ---------------------------------------------------------------------------

test("[vague-acceptance-identifier-is-not-a-verb] a criterion whose subject is a function named refactor, cleanup or optimize is an observable check, and a numeric bound phrased with make it is a check too", () => {
  const checks = [
    "refactor(ast) preserves the token count",
    "cleanup() removes the temp dir",
    "optimize() returns the same result for an empty input",
    "optimise(x) is idempotent",
    "tidy(s) === s.trim()",
    "polish(img).width === 100",
    "enhance(row) adds the id column",
    "improve(x) throws on null",
    "make it less than 200ms",
    "make it more than 3 retries",
  ];
  for (const criterion of checks) {
    assert.equal(vagueAcceptance(criterion), null, `"${criterion}" is a check an assertion can run`);
  }

  const wishes = [
    "improve the error messages",
    "clean up the parser",
    "refactor for clarity",
    "optimize the hot path",
    "make it better",
    "make it more robust",
    // No identifier carries whitespace before its delimiter, so a space between
    // the verb and a dash or a dot leaves an English verb, not a function name.
    "refactor - remove the duplication",
    "clean up - the parser",
    "improve   -   the docs",
    "tidy\t- the imports",
  ];
  for (const criterion of wishes) {
    assert.notEqual(vagueAcceptance(criterion), null, `"${criterion}" is still a wish, not a check`);
  }
});
