// conductor/tools/export-schemas.ts — Task 11.1 (§11.1): ship the §2 JSON
// Schemas out of core/types.ts (the single-source SCHEMAS record) as one file
// per schema, so the C++ router tests (Task 11.6) validate against the exact
// same objects the fan-out engine feeds to session.prompt({format}) — single
// source, two consumers (plan lines 470-476).
//
// A dev/test-time script: no runtime dependencies, node built-ins only. It is
// erasable-TypeScript clean (runs under Node type-stripping) and side-effect-free
// on import — the CLI leg below writes only when this file is the entry point,
// so importing it (as the test does) never touches the filesystem.

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { SCHEMAS } from "../core/types.ts";

// Write every SCHEMAS entry into outDir as <name>.schema.json, creating outDir
// (and any missing parents) first. Each file's bytes are the pinned pretty form
// JSON.stringify(schema, null, 2) — 2-space indent, no trailing newline — the
// exact shape the router tests byte-read. Returns the schema names written.
export function exportSchemas(outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const names = Object.keys(SCHEMAS);
  for (const k of names) {
    writeFileSync(
      path.join(outDir, `${k}.schema.json`),
      JSON.stringify(SCHEMAS[k], null, 2),
    );
  }
  return names;
}

// CLI: `node conductor/tools/export-schemas.ts [outDir]`. Used by
// scripts/test-conductor.sh and, later, a CMake pre-build step. The default
// target is cwd-relative (the gate runs from the repo root). The entry-point
// guard uses an argv[1] suffix check so the write fires only for direct
// invocation and never when the module is imported — under Node type-stripping
// there is no import.meta.main, so the suffix test is the robust equivalent.
if (process.argv[1] && process.argv[1].endsWith("export-schemas.ts")) {
  exportSchemas(process.argv[2] ?? path.resolve("src/tests/schemas"));
}
