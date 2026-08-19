// conductor/tests/unreachable-exports.test.ts — GAP-020, the UNREACHABLE-EXPORTS
// audit. A standing check that no value export in conductor/{core,adapter,plugin}
// is reachable from no production path.
//
// The defect this closes is correction cluster C, the highest severity-per-entry
// family in the review record: built, exported, typechecked, often unit-tested,
// and wired to nothing. ISSUE-001 (the dead §6.4 injection layer) is its terminal
// instance; routerHealthy and the ISSUE-038/-039 written-and-read-by-nothing state
// fields are the same shape. Every one of them shipped green because a test proved
// the helper, never the wire.
//
// The rule. Every VALUE export (function/const/let/class/enum — the runtime
// symbols; a type is erased and cannot be dead code) must be referenced somewhere
// in the SHIPPED tree outside its own declaration. A symbol referenced nowhere in
// production is admitted only if it is on one of two EXPLICIT registers:
//
//   ENTRY_POINTS — invoked from outside the tree (opencode loads the plugin
//     factory by its default binding; nothing in-repo imports it). Named here so a
//     genuine boundary symbol is not mistaken for dead code.
//
//   TEST_SURFACE — a pure helper exposed for its own unit test and not yet wired
//     into a production caller. This is the tracked-obligation register GAP-020's
//     floor names: built-but-production-unwired is not forbidden, but it is not
//     invisible either — a name lands here by an explicit, reviewable edit, and the
//     audit refuses to let one hide unless a test actually exercises it (so the
//     register can never be used to grandfather a symbol that is dead EVERYWHERE,
//     the routerHealthy class — that must be deleted, as answerFilesOnDisk and
//     STOP_KIND_PRODUCERS were when this audit landed).
//
// The registers are self-cleaning: [allowlist-not-stale] fails the day a listed
// symbol is wired or deleted, so a wired export cannot keep drawing an exemption it
// no longer needs (the ISSUE-090 rot the review record found in a stale proof).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { SourceFile } from "./fixtures/export-graph.ts";
import { collectValueExports, unreachedValueExports } from "./fixtures/export-graph.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");

// The shipped tree: the three production directories, everything under them that
// is not a test. The walk reads the FILESYSTEM (not `git ls-files`) so an untracked
// new production file is in scope the moment it exists — growth must not land in a
// blind span (MACRO-026). The tracked-universe coverage that a walk cannot silently
// under-count is proven for the text audits in scan-universe.ts.
const PRODUCTION_DIRS = ["core", "adapter", "plugin"];

// Anti-vacuity floor (C-045): a walk that silently stops finding source, or an
// export parser that stops matching, must be RED, never a vacuous pass over an
// empty set. Well below the ~270 value exports present when this audit landed.
const MIN_VALUE_EXPORTS = 150;

// Boundary symbols invoked from outside the repo. opencode imports the plugin
// factory by the module's default binding, so no in-repo file names it.
const ENTRY_POINTS: ReadonlySet<string> = new Set([
  "plugin/index.ts:ConductorPlugin",
  "adapter/inject.ts:initPlugin",
]);

// Pure helpers exposed for their own unit test, production-unwired at HEAD. Each is
// referenced by at least one test (asserted below), so this register cannot hold a
// symbol that is dead everywhere. Pinned exactly, line-free, sorted by key.
const TEST_SURFACE: ReadonlySet<string> = new Set([
  "adapter/gitio.ts:headShortSubject",
  "adapter/gitio.ts:stagedFiles",
  "adapter/gitio.ts:stagedNameStatus",
  "adapter/gitio.ts:unstagedDrift",
  "adapter/router-client.ts:fetchMetricsSummary",
  "core/commit-message.ts:hasDenylistedTrailer",
  "core/decide.ts:scoreOptions",
  "core/mechanics.ts:extractMechanics",
  "core/mechanics.ts:mechanicsBlock",
  "core/planning.ts:PLAN_PLACEHOLDER_LABELS",
  "core/preflight.ts:checkLiveArtifact",
  "core/preflight.ts:extractCitedFiles",
  "core/preflight.ts:specCurrency",
  "core/reply-protocol.ts:concernToken",
  "core/shell-parse.ts:gitSubcommand",
  "core/types.ts:CONDUCTOR_NAME",
  "core/vet-criteria.ts:vetCriterionNames",
  "core/vocab-registry.ts:VOCABULARIES",
  "core/wiring-manifest.ts:declaredHookKeys",
  "core/wiring-manifest.ts:declaredModuleWires",
  "core/wiring-manifest.ts:declaredToolBinding",
  "core/wiring-manifest.ts:fallbackToolDescription",
]);

const ALLOWLIST: ReadonlySet<string> = new Set([...ENTRY_POINTS, ...TEST_SURFACE]);

function walkTs(dir: string, keepTests: boolean, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTs(full, keepTests, out);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (!keepTests && entry.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

function productionSourceFiles(): SourceFile[] {
  const files: string[] = [];
  for (const dir of PRODUCTION_DIRS) walkTs(path.join(conductorDir, dir), false, files);
  return files.map((full) => ({
    rel: path.relative(conductorDir, full),
    src: readFileSync(full, "utf8"),
  }));
}

function key(entry: { rel: string; name: string }): string {
  return `${entry.rel}:${entry.name}`;
}

test("[gap020-no-unreached-exports] every value export in conductor/{core,adapter,plugin} is referenced in production, an entry point, or a registered test-surface helper — a symbol reachable from no production path is the ISSUE-001/routerHealthy dead-code class and must be wired or removed, not shipped green", () => {
  const files = productionSourceFiles();

  const total = collectValueExports(files).length;
  assert.ok(
    total >= MIN_VALUE_EXPORTS,
    `the export scan found only ${total} value exports (>= ${MIN_VALUE_EXPORTS} exist) — the walk or the ` +
      `parser is not reaching the tree, and a guard that inspects nothing passes vacuously`,
  );

  const offenders = unreachedValueExports(files).filter((d) => !ALLOWLIST.has(key(d)));
  assert.deepEqual(
    offenders.map(key),
    [],
    "this value export is referenced nowhere in the shipped tree and is on no register. Either wire it " +
      "into a production caller, or — if it is genuinely dead — delete it. Grandfathering it onto " +
      "TEST_SURFACE is refused unless a test exercises it; a symbol dead in production AND tests is the " +
      "exact class this audit exists to make uncommittable.",
  );
});

test("[gap020-allowlist-not-stale] every registered exemption still names a currently-unreached value export — a symbol that has since been wired or deleted must lose its exemption, so the register cannot rot into a standing excuse (the ISSUE-090 class)", () => {
  const files = productionSourceFiles();
  const unreachedKeys = new Set(unreachedValueExports(files).map(key));
  const declaredKeys = new Set(collectValueExports(files).map(key));

  const stale = [...ALLOWLIST].filter((k) => !unreachedKeys.has(k));
  assert.deepEqual(
    stale,
    [],
    "a registered exemption no longer describes a production-unreached export: either the symbol is now " +
      "referenced in production (remove it from the register — its exemption is spent) or it no longer " +
      "exists (remove the dead entry). Also flags a mistyped rel:name that matches no declared export: " +
      declaredKeys.size + " value exports were declared.",
  );
});

test("[gap020-test-surface-really-tested] every TEST_SURFACE entry is exercised by at least one test file — the register admits production-unwired helpers, never symbols dead everywhere, which have no legitimate exemption and must be deleted", () => {
  const testFiles: string[] = walkTs(testsDir, true, []).filter((f) => f.endsWith(".test.ts"));
  assert.ok(testFiles.length > 30, `found only ${testFiles.length} test files — the test walk is broken`);
  const corpus = testFiles.map((f) => readFileSync(f, "utf8")).join("\n");

  const unproven: string[] = [];
  for (const k of TEST_SURFACE) {
    const name = k.slice(k.indexOf(":") + 1);
    if (!new RegExp("\\b" + name + "\\b").test(corpus)) unproven.push(k);
  }
  assert.deepEqual(
    unproven,
    [],
    "a TEST_SURFACE entry is referenced by no test. The register is for helpers a test exercises but no " +
      "production path yet wires; a symbol reachable from neither is dead everywhere and must be deleted.",
  );
});

test("[gap020-discrimination] the analyzer proves it CAN fail: a synthetic dead export is reported and a referenced one is not — a checker that cannot demonstrate a failure is decorative (ISSUE-128)", () => {
  // A referenced export is NOT flagged.
  const live: SourceFile[] = [
    { rel: "a.ts", src: "export function foo() { return 1; }\n" },
    { rel: "b.ts", src: "import { foo } from './a.ts';\nfoo();\n" },
  ];
  assert.deepEqual(unreachedValueExports(live).map((d) => d.name), [], "a referenced export is live");

  // A never-referenced export IS flagged — the routerHealthy signature.
  const dead: SourceFile[] = [
    { rel: "a.ts", src: "export const routerHealthy = () => true;\nexport function used() {}\nused();\n" },
  ];
  assert.deepEqual(
    unreachedValueExports(dead).map((d) => d.name),
    ["routerHealthy"],
    "an export referenced only at its own declaration must be reported dead",
  );

  // A reference that lives only in a COMMENT does not rescue the symbol.
  const commented: SourceFile[] = [
    { rel: "a.ts", src: "// mentions routerHealthy in prose only\nexport const routerHealthy = 1;\n" },
  ];
  assert.deepEqual(
    unreachedValueExports(commented).map((d) => d.name),
    ["routerHealthy"],
    "a prose mention is not a live reference",
  );

  // The audit's allowlist gate itself can fail: inject a dead export into the real
  // production set and confirm an un-registered symbol becomes an offender.
  const files = productionSourceFiles();
  const injected = [...files, { rel: "adapter/ghost.ts", src: "export function ghostExport() {}\n" }];
  const offenders = unreachedValueExports(injected)
    .filter((d) => !ALLOWLIST.has(key(d)))
    .map((d) => d.name);
  assert.ok(
    offenders.includes("ghostExport"),
    "a new unregistered dead export must surface as an offender against the real tree",
  );
});
