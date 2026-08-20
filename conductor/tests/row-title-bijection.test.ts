// conductor/tests/row-title-bijection.test.ts — GAP-030 / MACRO-020, the
// assertion-row LIFECYCLE the spec mechanism shipped without: a row-id <-> test-
// title BIJECTION.
//
// The defect this closes is the record layer's own vacuous-green. An
// `.assertions.json` row is authoritative when a test that carries its id in its
// title actually pins it; it is NOISE when it is proven by nothing. The review
// found the second half had quietly taken over — 13.1 shipped 42 rows of which 37
// were named by no test (ISSUE-081/-132/-133 / M7-crosscutting), and a phase
// adjudicator read the empty `coveredByTest` field as evidence anyway. M7 as a
// COUNT could not tell the two apart; only a bijection can.
//
// The rule, for the 13.1 acceptance family (the task the review named, whose two
// specs are the ones that tag their tests with row ids):
//
//   FORWARD  — every row id in a family spec is either NAMED by at least one test
//     title `[<row-id>]` somewhere in the suite, or listed on UNCOVERED below with
//     the reason it is not yet bound. A row that is neither is the ISSUE-081 class
//     — a claim of coverage backed by nothing — and is RED.
//
//   BACKWARD — every id-shaped title `[13.1-...]` maps to a real row in one of the
//     family specs, or is on SCENARIO_TITLES (a describe/scenario grouping title
//     that is deliberately broader than one row). A title that names no row and is
//     not a declared scenario is a coverage claim against a row that does not exist
//     (the orphan-id class, ISSUE-133).
//
// UNCOVERED is the tracked-obligation register, the same shape tests/
// unreachable-exports.test.ts uses for production-unwired exports: a row lands here by
// an explicit, reviewable edit naming WHY it is unbound, and [not-stale] fails the
// day a listed row gains a test — so the register can never rot into a standing
// excuse for a row a later fix quietly covered. The spec JSON that would carry a
// per-row `disposition` field is under docs/ and off-limits to this layer, so the
// register lives here and the spec edit is REPORTED to the orchestrator.
//
// SCOPE. The bijection is enforced for the 13.1 family only. The one-time backfill
// that would extend a `disposition` field across all ~795 rows in specs/ is the
// deferred half of GAP-030 (IDEA-ROW-2) and is a docs/ edit; this file is the
// enforceable CHECK the backfill needs, proven against the family the review
// measured.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");
const repoRoot = path.resolve(conductorDir, "..");
const specsDir = path.join(repoRoot, "docs", "build", "specs");

// The two specs whose rows are tagged into test titles. Both are the "13.1"
// acceptance task: the end-to-end scenarios and the composition-root production
// code that landed inside that test task.
const FAMILY_SPECS = ["task-13.1.assertions.json", "task-13.1-composition-root.assertions.json"] as const;

// Any bracket tag shaped like a 13.1 row id. `13.1-cr...` / `13.1-cr2...` belong
// to the composition-root spec; the rest to task-13.1. The pattern is deliberately
// wider than the id grammar so a MALFORMED id in a title (a typo'd row) surfaces as
// an orphan rather than slipping past the scan.
const FAMILY_TITLE = /\[(13\.1-[A-Za-z0-9-]+)\]/g;

// Rows not yet named by a test title, each with the reason. Every entry here is a
// coverage obligation REPORTED to the orchestrator (the spec's own `disposition`
// field is docs/ and off-limits). Categories:
//   covered-by-scenario:<title> — the behavior IS exercised, inside a coarser
//     scenario test that carries one grouping title instead of one title per row;
//     the fix is to split it the way [13.1-trivial] was split into its three s2
//     rows, or to record `disposition: covered-by <title>` on the spec row.
//   covered-by-harness — a cross-cutting property every scenario relies on (it
//     runs through the real factory at all), true of the whole file rather than
//     observable as one discrete row; belongs in the spec as a standing precondition.
const UNCOVERED: ReadonlyMap<string, string> = new Map([
  // Cross-cutting harness preconditions — true of every scenario, not one row.
  ["13.1-real-plugin-factory-bound-handlers", "covered-by-harness: every scenario dispatches through the real ConductorPlugin factory (composition-root.test.ts proves the binding as [13.1-cr-*] rows)"],
  ["13.1-gate-snapshot-derived-live", "covered-by-harness: the live-derived gate snapshot is proven per-call by [13.1-cr2-gate-scope-derived-from-registry] and exercised by every scenario's denials"],
  ["13.1-fake-sdk-is-the-only-fake", "covered-by-harness: makeBench substitutes only the SDK; [13.1-cr-setup-input-not-faked] pins the real-input half"],
  ["13.1-canned-outputs-pass-real-schemas", "covered-by-scenario:13.1-full-pipeline (the malformed-first-classification retry runs inside the pipeline setup); needs a tagged it() reading the retry off the capture"],
  // Scenario 1 — full pipeline. Driven by the [13.1-full-pipeline] describe; these
  // facets are exercised there but not yet split into their own tagged it()s.
  ["13.1-s1-mark-green-handler-runs-the-test", "covered-by-scenario:13.1-full-pipeline; add a tagged it() asserting the handler-side item-test re-run from caps().evidence"],
  ["13.1-s1-validate-quarantined-stamped", "covered-by-scenario:13.1-full-pipeline; add a tagged it() asserting the VALIDATED verify record's startedMs/HEAD/tree/excluded from caps().evidence"],
  ["13.1-s1-report-real-closing-verify", "covered-by-scenario:13.1-full-pipeline; add a tagged it() asserting the fresh closing-verify record from caps().evidence"],
  ["13.1-s1-freeze-denies-test-file-edit", "covered-by-scenario:13.1-full-pipeline; the strict-freeze test-file denial is not captured — add an Attempt to FullPipeline and a tagged it()"],
  // Scenario 3 — worktrees.
  ["13.1-s3-worktrees-concurrent-out-of-repo", "covered-by-scenario:13.1-worktree; split like [13.1-trivial] into per-row it()s"],
  ["13.1-s3-serial-mergeback-postmerge-revalidate", "covered-by-scenario:13.1-worktree; split into per-row it()s reading the merge order off the journal"],
  // Scenario 4 — non-behavioral.
  ["13.1-s4-nonbehavioral-no-test-ever", "covered-by-scenario:13.1-non-behavioral; split into per-row it()s"],
  ["13.1-s4-decompose-rejects-behavioral-false-over-src", "covered-by-scenario:13.1-non-behavioral; split into per-row it()s asserting the decompose rejection"],
  // Scenario 5 — the bad ending.
  ["13.1-s5-item-blocks-repair-exhausted", "covered-by-scenario:13.1-bad-ending / fw-blocked-dependent-reprompts; split into per-row it()s"],
  ["13.1-s5-report-refuses-dependent-unsettled", "covered-by-scenario:13.1-bad-ending; split into a per-row it() asserting the non-verify refusal"],
  ["13.1-s5-three-futile-reprompts-noop", "covered-by-scenario:fw-blocked-dependent-reaches-noop; split into a per-row it() reading idle/futile counters"],
  ["13.1-s5-stop-report-written", "covered-by-scenario:fw-wedge-stop-report-written; split into a per-row it()"],
  ["13.1-s5-second-run-validate-passes-and-discloses", "covered-by-scenario:13.1-bad-ending; split into a per-row it() asserting the second run's excludedStaleRed disclosure"],
]);

// Id-shaped titles that deliberately name no single row: the scenario/describe
// grouping titles and the extra behavioral tests beyond the spec. Each is asserted
// present by [not-stale], so this list cannot silently absorb a genuine typo'd row.
const SCENARIO_TITLES: ReadonlySet<string> = new Set([
  "13.1-full-pipeline",
  "13.1-trivial",
  "13.1-worktree",
  "13.1-non-behavioral",
  "13.1-bad-ending",
  "13.1-s1-debug-loop-regression",
]);

interface Spec {
  file: string;
  rows: string[];
}

function loadFamilySpecs(): Spec[] {
  return FAMILY_SPECS.map((file) => {
    const raw = JSON.parse(readFileSync(path.join(specsDir, file), "utf8")) as { assertions: Array<{ id: string }> };
    return { file, rows: raw.assertions.map((a) => a.id) };
  });
}

function testFiles(): string[] {
  return readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => path.join(testsDir, f));
}

// Every distinct 13.1-family bracket tag that appears in a test title anywhere in
// the suite. Reading the whole file (not just `test(` lines) is deliberate: a tag
// referenced only in a comment or an assertion message is NOT a title, so the scan
// is narrowed to lines that open a node:test declaration.
function taggedTitles(): Set<string> {
  const found = new Set<string>();
  const decl = /^\s*(?:test|it|describe)\s*\(/;
  for (const file of testFiles()) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!decl.test(lines[i])) continue;
      // A declaration's title may sit on the same line or the next few; scan a
      // small window so a wrapped `test(\n  "[id] ..."` is still seen.
      const window = lines.slice(i, i + 3).join("\n");
      for (const m of window.matchAll(FAMILY_TITLE)) found.add(m[1]);
    }
  }
  return found;
}

test("[gap030-every-row-bound-or-registered] every 13.1-family assertion row is named by a test title or listed on the UNCOVERED obligation register — a row proven by nothing is the ISSUE-081 vacuous-coverage class and cannot ship green", () => {
  const specs = loadFamilySpecs();
  const totalRows = specs.reduce((n, s) => n + s.rows.length, 0);
  assert.ok(totalRows >= 60, `the family specs declare only ${totalRows} rows (>= 60 exist) — the spec read is not reaching the files`);

  const titles = taggedTitles();
  const offenders: string[] = [];
  for (const spec of specs) {
    for (const row of spec.rows) {
      if (titles.has(row)) continue;
      if (UNCOVERED.has(row)) continue;
      offenders.push(`${spec.file}:${row}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "this assertion row is named by no test title and is on no obligation register. Either bind it with a test whose " +
      "title carries [<row-id>], or — if the behavior is exercised inside a coarser scenario — add it to UNCOVERED with " +
      "the covering scenario, and REPORT the spec `disposition` edit. A row backed by nothing is not coverage.",
  );
});

test("[gap030-no-orphan-titles] every id-shaped 13.1 title maps to a real family row or a declared scenario title — a title naming a row that no spec has is a coverage claim against nothing (the ISSUE-133 orphan-id class)", () => {
  const specs = loadFamilySpecs();
  const rowSet = new Set<string>(specs.flatMap((s) => s.rows));
  const titles = taggedTitles();
  assert.ok(titles.size >= 40, `the title scan found only ${titles.size} 13.1 tags (>= 40 exist) — the scan is not reaching the suite`);

  const orphans: string[] = [];
  for (const title of titles) {
    if (rowSet.has(title)) continue;
    if (SCENARIO_TITLES.has(title)) continue;
    orphans.push(title);
  }
  assert.deepEqual(
    orphans.sort(),
    [],
    "this test title carries a 13.1 row id that no family spec declares. Either it is a typo of a real row id (fix the " +
      "title), or it is a deliberate scenario/grouping title (add it to SCENARIO_TITLES) — a title cannot claim to cover " +
      "a row that does not exist.",
  );
});

test("[gap030-register-not-stale] every UNCOVERED entry is still an unbound family row and every SCENARIO_TITLE still names no row — a registered row that gained a test, or a scenario title that is now a real row, must lose its exemption so the register cannot rot (the ISSUE-090 class)", () => {
  const specs = loadFamilySpecs();
  const rowSet = new Set<string>(specs.flatMap((s) => s.rows));
  const titles = taggedTitles();

  const nowBound = [...UNCOVERED.keys()].filter((row) => titles.has(row));
  assert.deepEqual(
    nowBound,
    [],
    "a row on the UNCOVERED register is now named by a test title — remove it from the register; its obligation is discharged.",
  );

  const notARow = [...UNCOVERED.keys()].filter((row) => !rowSet.has(row));
  assert.deepEqual(
    notARow,
    [],
    "a row on the UNCOVERED register is in no family spec — the id is stale (renamed or deleted) and must be removed.",
  );

  const scenarioIsNowARow = [...SCENARIO_TITLES].filter((t) => rowSet.has(t));
  assert.deepEqual(
    scenarioIsNowARow,
    [],
    "a SCENARIO_TITLES entry now matches a real spec row — it is no longer a mere grouping title; remove it so the row is held to real coverage.",
  );

  const scenarioAbsent = [...SCENARIO_TITLES].filter((t) => !titles.has(t));
  assert.deepEqual(
    scenarioAbsent,
    [],
    "a declared SCENARIO_TITLES entry appears in no test title — a scenario was renamed or removed; the allowlist must not carry a name nothing uses.",
  );
});

test("[gap030-discrimination] the bijection CAN fail: a synthetic uncovered row and a synthetic orphan title are both reported, and a bound row is not — a checker that cannot demonstrate a failure is decorative (ISSUE-128)", () => {
  const rows = new Set(["13.1-alpha", "13.1-beta"]);
  const titles = new Set(["13.1-alpha", "13.1-ghost"]);

  // FORWARD: 13.1-beta has a row but no title and no register -> uncovered.
  const uncovered = [...rows].filter((r) => !titles.has(r));
  assert.deepEqual(uncovered, ["13.1-beta"], "a row named by no title must be reported uncovered");

  // BACKWARD: 13.1-ghost is a title naming no row -> orphan.
  const orphan = [...titles].filter((t) => !rows.has(t));
  assert.deepEqual(orphan, ["13.1-ghost"], "a title naming no row must be reported orphan");

  // A bound row (title present) is neither.
  assert.ok(titles.has("13.1-alpha") && rows.has("13.1-alpha"), "a row with a matching title is bound");

  // And the real scan finds the real family: at least the composition-root rows,
  // which are fully bound, must all be titled.
  const specs = loadFamilySpecs();
  const cr = specs.find((s) => s.file.includes("composition-root"));
  assert.ok(cr !== undefined && cr.rows.length >= 20, "the composition-root spec must load with its rows");
  const realTitles = taggedTitles();
  const crUnbound = (cr as Spec).rows.filter((r) => !realTitles.has(r));
  assert.deepEqual(crUnbound, [], "every composition-root row is bound by a real title — a regression here is a genuine red");
});
