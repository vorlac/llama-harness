// conductor/tests/tree-types.test.ts — fix-campaign Phase I.2, GAP-004: the
// slug/path duality becomes a COMPILE ERROR.
//
// Subject: conductor/core/types.ts (the two tree types + their constructors) and
// the seams that carry a tree — core/gates-edit.ts, adapter/fanout.ts,
// adapter/evidence.ts, adapter/tools.ts.
//
// -------------------------------------------------------------------------
// THE DUALITY (C-037 ruling 5, register origin MM-009)
// -------------------------------------------------------------------------
// A "tree" is TWO different things in this build and the difference is not
// cosmetic:
//
//   * the EVIDENCE layer's tree is a SLUG — "main" for the shared tree, an
//     itemId for a worktree. adapter/evidence.ts markerPathOf composes
//     verify-running-<slug>.json out of it and runs assertSafeId, which rejects
//     a "/" outright, so a PATH can never be one;
//   * the GATE layer's tree is a PATH — core/gates-edit.ts normalizeUnderTree
//     strips it off the front of an absolute edit path by string equality, so a
//     SLUG can never be one: normalizeUnderTree("<root>/src/a.ts", "main")
//     returns null and the gate denies every edit in that session.
//
// Four times in this build's history one was fed where the other belonged
// (ISSUE-002 is the fourth: the shipped parallel.writes:"off" default registered
// every sub-session under the slug "main" and the edit gate therefore denied
// every write the pipeline's first implementer attempted). Each fix was a
// translation at one more call site, because the type system could not tell the
// two apart — both were `string`.
//
// -------------------------------------------------------------------------
// EXPECTED EXPORT SURFACE — conductor/core/types.ts
// -------------------------------------------------------------------------
//
//   export type TreeSlug = string & <brand>;   // the evidence layer's tree name
//   export type TreePath = string & <brand>;   // the gate layer's tree root
//
//   export function treeSlug(value: string): TreeSlug;
//     // rejects an empty value and any value carrying a "/" — the assertSafeId
//     // shape the marker filename already demands.
//   export function treePath(value: string): TreePath;
//     // rejects a NON-EMPTY value carrying no "/" — i.e. a bare slug. The empty
//     // string is the registry's "this session has no tree of its own" value
//     // (adapter/continuation.ts resolveSessionTree fills it from the store's
//     // root), so it is admitted and spelled once as NO_TREE.
//
//   export const MAIN_TREE: TreeSlug;   // the shared tree's slug, "main", once
//   export const NO_TREE: TreePath;     // the empty tree, once
//
// Both constructors are pure (G3) and both fail CLOSED (G5): a misfeed that
// reaches them at run time throws rather than being silently branded, which is
// what keeps the guarantee alive under the plugin runtime's type stripping,
// where the compile-time half does not exist.
//
// -------------------------------------------------------------------------
// HOW THE COMPILE ERROR IS WITNESSED
// -------------------------------------------------------------------------
// A type-level claim needs a type-level witness, so these rows COMPILE two
// probe programs with the project's own tsc and the project's own compiler
// options:
//
//   * the MISFEED probe hands a TreeSlug to every seam that takes a TreePath and
//     a TreePath to every seam that takes a TreeSlug. Every one of those lines
//     carries a `// MISFEED` marker, and the row asserts that the set of lines
//     tsc reports an error on is EXACTLY the set of marked lines — so a probe
//     that stops binding a real seam (a renamed field, a deleted import) fails
//     as loudly as a duality that stops being a compile error;
//   * the CONTROL probe feeds the same seams correctly and must compile CLEAN.
//     Without it a probe harness that always fails would pass the first row
//     while proving nothing.
//
// The probes live under conductor/node_modules/ — the one directory in this repo
// that every source scanner, the tsconfig include globs and git all skip — so an
// intentionally-uncompilable file can never be mistaken for a shipped one.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { MAIN_TREE, NO_TREE, treePath, treeSlug } from "../core/types.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");
const tsc = path.join(conductorDir, "node_modules", ".bin", "tsc");

const probeDirs: string[] = [];

after(() => {
  for (const dir of probeDirs) rmSync(dir, { recursive: true, force: true });
});

// A scratch directory for one probe program. node_modules is skipped by
// conductor/tests/source-hygiene.ts's walk, by composition-root.test.ts's
// production-source walk, by conductor/tsconfig.json's include globs and by git,
// while still resolving @types/node and the project's own relative imports.
function probeDir(tag: string): string {
  const dir = mkdtempSync(path.join(conductorDir, "node_modules", `.${tag}`));
  probeDirs.push(dir);
  return dir;
}

interface TscRun {
  ok: boolean;
  output: string;
  errorLines: number[];
  foreignErrors: string[];
}

// Compile ONE probe file with the project's own compiler options (mirroring
// conductor/tsconfig.json — `tsc -p` is not usable here because the probe is
// deliberately outside every include glob). Errors are reported per file, so the
// run separates the probe's own error lines from any error attributed elsewhere:
// a probe whose IMPORTS fail to resolve must never read as a satisfied claim.
function compileProbe(dir: string, file: string): TscRun {
  assert.ok(
    existsSync(tsc),
    `premise: the project's own typescript compiler is installed at ${tsc} — GAP-004's guarantee IS the typecheck, so a missing compiler is a red gate, never a skipped row (G4)`,
  );
  let output: string;
  let ok: boolean;
  try {
    output = execFileSync(
      tsc,
      [
        "--noEmit",
        "--strict",
        "--erasableSyntaxOnly",
        "--target",
        "es2023",
        "--lib",
        "es2023",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--allowImportingTsExtensions",
        "--skipLibCheck",
        "--types",
        "node",
        file,
      ],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    ok = true;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    ok = false;
  }
  const errorLines = new Set<number>();
  const foreignErrors: string[] = [];
  for (const line of output.split("\n")) {
    if (!line.includes("error TS")) continue;
    const own = new RegExp(`^${file}\\((\\d+),\\d+\\): error TS`).exec(line);
    if (own === null) foreignErrors.push(line.trim());
    else errorLines.add(Number(own[1]));
  }
  return { ok, output, errorLines: [...errorLines].sort((a, b) => a - b), foreignErrors };
}

// The lines a probe MARKS as misfeeds: the expectation source for the row below,
// read off the probe text itself so the two can never drift apart.
function markedLines(source: string): number[] {
  const out: number[] = [];
  source.split("\n").forEach((line, index) => {
    if (line.includes("// MISFEED")) out.push(index + 1);
  });
  return out;
}

// The probe preamble both programs share: the real seams, imported from the real
// files. Every misfeed below is an assignment INTO one of these production types,
// never into a shape this test declares — a probe that types its own struct
// would prove nothing about the build.
const PREAMBLE = `import type { EvidenceRecord, Item, TreePath, TreeSlug } from "../../core/types.ts";
import { treePath, treeSlug } from "../../core/types.ts";
import type { EditInput } from "../../core/gates-edit.ts";
import type { FanoutJob, RegistryEntry } from "../../adapter/fanout.ts";
import type { StateStore } from "../../adapter/state.ts";
import type { VerifyOptions } from "../../adapter/evidence.ts";
import { verifyInFlightTreeFor } from "../../adapter/tools.ts";

type VerifyRecord = Extract<EvidenceRecord, { kind: "verify" }>;

const SLUG: TreeSlug = treeSlug("I1");
const PATH: TreePath = treePath("/tmp/conductor-tree-probe/wt");
const STORE: StateStore = null as unknown as StateStore;
`;

// SLUG where a PATH belongs — the ISSUE-002 direction, four times over — and
// PATH where a SLUG belongs, the C-037 ruling 5 direction that makes a worktree
// freeze silently never fire.
const MISFEED_PROBE = `${PREAMBLE}
export function jobTree(job: FanoutJob): void {
  job.tree = SLUG; // MISFEED
}

export function registryTree(entry: RegistryEntry): void {
  entry.tree = SLUG; // MISFEED
}

export function gateSessionTree(input: EditInput): void {
  input.sessionTree = SLUG; // MISFEED
}

export function gateFreezeTree(input: EditInput): void {
  input.verifyInFlightTree = SLUG; // MISFEED
}

export function itemWorktree(item: Item): void {
  item.worktree = SLUG; // MISFEED
}

export function verifyOptionTree(opts: VerifyOptions): void {
  opts.tree = PATH; // MISFEED
}

export function verifyRecordTree(record: VerifyRecord): void {
  record.tree = PATH; // MISFEED
}

export function frozenTreeFor(): TreePath | null {
  return verifyInFlightTreeFor(STORE, "run_1", PATH); // MISFEED
}
`;

const CONTROL_PROBE = `${PREAMBLE}
export function jobTree(job: FanoutJob): void {
  job.tree = PATH;
}

export function registryTree(entry: RegistryEntry): void {
  entry.tree = PATH;
}

export function gateSessionTree(input: EditInput): void {
  input.sessionTree = PATH;
}

export function gateFreezeTree(input: EditInput): void {
  input.verifyInFlightTree = PATH;
}

export function itemWorktree(item: Item): void {
  item.worktree = PATH;
}

export function verifyOptionTree(opts: VerifyOptions): void {
  opts.tree = SLUG;
}

export function verifyRecordTree(record: VerifyRecord): void {
  record.tree = SLUG;
}

export function frozenTreeFor(): TreePath | null {
  return verifyInFlightTreeFor(STORE, "run_1", SLUG);
}
`;

// ===========================================================================
// GAP-004 row 1 — the misfeed does not typecheck, at every seam that carries a tree
// ===========================================================================

test("[gap-004-misfeed-is-a-compile-error] handing the evidence layer's tree SLUG to a seam that takes the gate layer's tree PATH — a fan-out job, a §3.5 registry entry, the edit gate's sessionTree and verifyInFlightTree, an item's persisted worktree — and handing a PATH to the evidence layer's marker slug does NOT typecheck: tsc reports an error on EXACTLY the marked lines, so the fifth misfeed is unrepresentable rather than merely unwritten", () => {
  const dir = probeDir("tree-type-misfeed-");
  writeFileSync(path.join(dir, "misfeed.ts"), MISFEED_PROBE);
  const run = compileProbe(dir, "misfeed.ts");
  const expected = markedLines(MISFEED_PROBE);

  assert.equal(expected.length, 8, "premise: the probe marks all eight seams — if this changes, the row below is measuring something else");
  assert.deepEqual(
    run.foreignErrors,
    [],
    `the probe must bind the REAL production seams: every error tsc reported outside misfeed.ts means an import did not resolve, so nothing about the duality was measured.\n${run.output}`,
  );
  assert.deepEqual(
    run.errorLines,
    expected,
    `every line the probe marks // MISFEED must be a type error and no other line may be: a tree SLUG is not a tree PATH and a tree PATH is not a marker SLUG, so neither can be handed where the other belongs. tsc said:\n${run.output}`,
  );
});

// ===========================================================================
// GAP-004 row 2 — the anti-vacuity control
// ===========================================================================

test("[gap-004-correct-feed-still-compiles] the CONTROL probe — the same eight seams fed the type each one actually takes — compiles clean, so row 1 is a statement about the duality and not about a probe harness that fails at everything", () => {
  const dir = probeDir("tree-type-control-");
  writeFileSync(path.join(dir, "control.ts"), CONTROL_PROBE);
  const run = compileProbe(dir, "control.ts");

  assert.deepEqual(
    run.errorLines,
    [],
    `feeding each seam its OWN tree type must compile: a branded type that nothing can satisfy would deny every legitimate wiring too. tsc said:\n${run.output}`,
  );
  assert.deepEqual(run.foreignErrors, [], `and no import may fail to resolve.\n${run.output}`);
  assert.equal(run.ok, true, `so the control program typechecks.\n${run.output}`);
});

// ===========================================================================
// GAP-004 row 3 — the constructors fail closed at RUN time too
// ===========================================================================

test("[gap-004-constructors-fail-closed] the two constructors refuse the OTHER type's shape at run time — treeSlug refuses a path, treePath refuses a bare slug — because the plugin ships type-stripped, where the compile-time half of this guarantee does not exist (G5)", () => {
  assert.equal(treeSlug("main"), "main", "a slug brands to its own characters — the marker filename is composed from it");
  assert.equal(treePath("/repo/src"), "/repo/src", "and a path brands to its own characters — the edit gate compares it by string equality");

  assert.throws(
    () => treeSlug("/repo/worktrees/I1"),
    /tree/i,
    "a PATH is not a marker slug: adapter/evidence.ts markerPathOf composes a filename out of it and runs assertSafeId, so a value carrying a separator must be refused where it is minted, not where it is written",
  );
  assert.throws(
    () => treeSlug(""),
    /tree/i,
    "and an empty slug names no tree at all",
  );
  assert.throws(
    () => treePath("main"),
    /tree/i,
    'ISSUE-002 exactly: the slug "main" is not a tree path — core/gates-edit.ts normalizeUnderTree would strip nothing off an absolute edit path and deny every write in that session',
  );
  assert.throws(
    () => treePath("I1"),
    /tree/i,
    "and an itemId slug is not a tree path either",
  );

  assert.equal(
    NO_TREE,
    "",
    "the ONE spelling of \"this session has no tree of its own\" — adapter/continuation.ts resolveSessionTree is what fills it from the workspace root, and a reader job that names no item carries it",
  );
  assert.equal(MAIN_TREE, "main", "and the ONE spelling of the shared tree's evidence slug");
});
