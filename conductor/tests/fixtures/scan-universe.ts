// conductor/tests/fixtures/scan-universe.ts — GAP-017's inverted subject
// selection, shared by the text audits.
//
// MACRO-016: 23% of the review's corrections were a check that inspects less than
// it appears to. The recurring mechanism is OPEN-ENDED ENUMERATION — a scanner
// walks a hand-named set of directories, and a source file that lands anywhere
// else is invisible to a guard that reports full coverage. The fix is INVERSION:
// define the subject as the whole tracked universe MINUS an explicit exemption
// list, then prove the scan actually reached every file that universe names. A
// file added outside the enumerated set is then a RED (uncovered tracked file),
// not a silent omission.
//
// This module reads `git ls-files` — the tracked universe — and offers the pure
// set-difference the audits assert on. The impurity (the git read) is confined
// here; `uncovered` is pure so the discrimination witness can feed it a synthetic
// scanned-set with a hole and prove the coverage check fails.

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));
export const CONDUCTOR_DIR = path.resolve(fixturesDir, "..", "..");
export const REPO_ROOT = path.resolve(CONDUCTOR_DIR, "..");

// Absolute paths of the tracked files matching any of the given pathspecs. `-z`
// keeps paths with unusual characters intact.
export function trackedFiles(pathspecs: readonly string[]): string[] {
  const raw = execFileSync("git", ["ls-files", "-z", "--", ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return raw
    .split("\0")
    .filter((p) => p.length > 0)
    .map((p) => path.join(REPO_ROOT, p));
}

// The SHIPPED TypeScript universe: every tracked conductor .ts EXCEPT the two
// non-production trees. Exemptions are named, not implied — a new shipped
// directory is in the universe until it is exempted here on purpose, which is the
// whole point (journal-vocab / legaltools walk core+adapter+plugin, and a fourth
// shipped dir must announce itself as a coverage failure, not vanish).
export const PRODUCTION_EXEMPT_PREFIXES: readonly string[] = [
  "conductor/tests/", // the tests themselves and their fixtures
  "conductor/tools/", //  dev-only tooling (export-schemas, replay, …); not shipped
];

export function productionTsUniverse(): string[] {
  return trackedFiles(["conductor/**/*.ts"]).filter((abs) => {
    const rel = path.relative(REPO_ROOT, abs);
    if (rel.endsWith(".test.ts")) return false;
    return !PRODUCTION_EXEMPT_PREFIXES.some((pre) => rel.startsWith(pre));
  });
}

// The tracked TEXT-SOURCE universe: every tracked file whose extension is text and
// none of whose path components is an exempt directory. Mirrors the whole-tree
// control-byte walk in source-hygiene, so the walk can be proven to cover it.
export function textSourceUniverse(
  extensions: ReadonlySet<string>,
  skipDirs: ReadonlySet<string>,
): string[] {
  return trackedFiles(["*"]).filter((abs) => {
    const rel = path.relative(REPO_ROOT, abs);
    if (!extensions.has(path.extname(rel))) return false;
    return !rel.split(path.sep).some((seg) => skipDirs.has(seg));
  });
}

// The tracked-universe files that the scan did NOT reach. Pure: both arguments are
// absolute-path lists. A non-empty result is the inversion failure — the scan's
// enumerated file-set no longer covers the universe it claims to.
export function uncovered(scanned: readonly string[], universe: readonly string[]): string[] {
  const seen = new Set(scanned);
  return universe.filter((f) => !seen.has(f));
}
