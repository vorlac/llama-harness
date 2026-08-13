// conductor/tests/source-hygiene.test.ts — a guard for the property that makes
// every OTHER text-based check trustworthy: that the repo's source files are
// actually text.
//
// Why this exists. conductor/tests/tools-9.4c.test.ts was committed carrying one
// literal NUL byte, used as a composite-key separator inside a fixture
// (`${role}` + NUL + `${itemId}`). It ran fine — the suite was green and stayed
// green — but `file(1)` classified the whole 109 KB file as `data`, and GREP
// SILENTLY SKIPS BINARY FILES. Twenty-six committed tests became invisible to
// every grep-based audit: coverage sweeps, "does any test pin X", the review
// lenses' own searches, and the orchestrator's. The failure mode is the one this
// build fears most — not a red that shouts, but a check that quietly inspects
// less than it claims to.
//
// The runtime value is unchanged by writing the separator as a six-character
// escape instead of a raw byte, so the fix costs nothing and the guard keeps it
// that way. G7 detection-over-prevention: nothing stops someone pasting a control
// byte, but the gate will say so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Directories that are not ours to police: dependencies, build output, VCS
// internals, and the runtime state trees whose contents are data by design.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".out",
  ".data",
  ".conductor",
  "staging",
  "vendor",
  // Vendored third-party source (vcpkg's build trees, the llama tree). Not ours
  // to police, and ftxui's own terminal-parser tests legitimately embed ESC.
  "extern",
]);

// The extensions whose files are asserted to be text. Deliberately a list rather
// than "everything that is not binary": a new binary asset type should not fail
// this test, and a new SOURCE type should be added here on purpose.
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".cpp",
  ".hpp",
  ".h",
  ".py",
  ".sh",
  ".bash",
  ".yml",
  ".yaml",
  ".txt",
  ".cmake",
  ".toml",
]);

// Control characters a source file has no reason to contain. Tab, newline and
// carriage return are text; everything else below 0x20, plus DEL, is not.
function forbiddenControlBytes(bytes: Buffer): number[] {
  const found = new Set<number>();
  for (const byte of bytes) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) found.add(byte);
  }
  return [...found].sort((a, b) => a - b);
}

function sourceFiles(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue; // a symlink to nowhere is not a source file
    }
    if (info.isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry))) out.push(full);
  }
  return out;
}

test("[hygiene-no-control-bytes] no source file carries a NUL or other forbidden control byte, so grep and every other text-based audit sees the whole tree instead of silently skipping a file it has decided is binary", () => {
  const files = sourceFiles(REPO_ROOT, []);
  assert.ok(
    files.length > 100,
    `the walk found only ${files.length} source files, which means it is not reaching the tree — a guard that inspects nothing passes vacuously`,
  );

  const offenders: string[] = [];
  for (const file of files) {
    const bad = forbiddenControlBytes(readFileSync(file));
    if (bad.length === 0) continue;
    offenders.push(
      `${path.relative(REPO_ROOT, file)} carries ${bad.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}`,
    );
  }

  assert.deepEqual(
    offenders,
    [],
    "a source file carrying a control byte is treated as BINARY by grep and is skipped whole, so every text search that appears to cover the tree silently does not; write the byte as an escape instead",
  );
});
