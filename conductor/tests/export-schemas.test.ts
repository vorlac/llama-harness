// Task 11.1 red tests — lives at conductor/tests/export-schemas.test.ts.
// Subject: conductor/tools/export-schemas.ts (must not exist when this goes
// red; the failure is Cannot find module '../tools/export-schemas.ts' — the
// missing-subject shape, a legal red per §2.6.1).
//
// Spec: plan Task 11.1 (lines 470-476). tools/export-schemas.ts is a
// dev/test-time script that writes the §2 JSON Schemas from core/types.ts
// (the SCHEMAS record — single source) into a directory, so the C++
// router-tests (Task 11.6) can validate against the same objects the fan-out
// engine feeds to session.prompt({format}).
//
// Pinned interface (what this test locks down):
//   export function exportSchemas(outDir: string): string[]
//   For EACH key k in SCHEMAS it writes <outDir>/<k>.schema.json whose content
//   is JSON.stringify(SCHEMAS[k], null, 2) (pretty JSON), creates outDir if
//   absent, and returns the array of schema names written (the keys). A CLI
//   entry that targets src/router-tests/schemas/ also exists but is NOT tested
//   here — this pins the exported function only.
//
// Assertion: 11.1-export-schemas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { SCHEMAS } from "../core/types.ts";
import { exportSchemas } from "../tools/export-schemas.ts";

const SUFFIX = ".schema.json";

/** Fresh isolated dir per case; the callback owns it, we always tear it down. */
function withTmp(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-schemas-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// (1) The return value is exactly the schema names — every one, no more, no
// fewer. SCHEMAS is the superset Task 11.6 draws from; the returned list is the
// manifest of what got written.
test("[11.1-export-schemas] returns exactly the SCHEMAS names", () => {
  withTmp((dir) => {
    const written = exportSchemas(dir);

    assert.ok(Array.isArray(written), "exportSchemas must return an array of names");
    assert.deepEqual(
      [...written].sort(),
      Object.keys(SCHEMAS).sort(),
      "returned names must equal Object.keys(SCHEMAS) — no missing, no extra",
    );
  });
});

// (2) Every schema round-trips losslessly through the file: it exists, is
// readable, parses as JSON, and deep-equals the in-memory SCHEMAS object. The
// on-disk bytes are the pinned pretty form (JSON.stringify(., null, 2)) so the
// router tests read the identical shape the fan-out engine ships.
test("[11.1-export-schemas] each schema file round-trips losslessly", () => {
  withTmp((dir) => {
    exportSchemas(dir);

    for (const k of Object.keys(SCHEMAS)) {
      const file = path.join(dir, `${k}${SUFFIX}`);
      assert.ok(existsSync(file), `${k}: expected ${file} to be written`);

      const raw = readFileSync(file, "utf8");
      assert.deepEqual(
        JSON.parse(raw),
        SCHEMAS[k],
        `${k}: parsed file must deep-equal SCHEMAS["${k}"]`,
      );
      assert.equal(
        raw,
        JSON.stringify(SCHEMAS[k], null, 2),
        `${k}: on-disk content must be the pinned pretty JSON (2-space indent)`,
      );
    }
  });
});

// (3) The directory holds EXACTLY those .schema.json files — nothing beyond the
// SCHEMAS keys. This is the "covers exactly the schema names Task 11.6
// consumes" guarantee: no stray file the router tests could pick up.
test("[11.1-export-schemas] directory contains exactly the schema files", () => {
  withTmp((dir) => {
    exportSchemas(dir);

    const onDisk = readdirSync(dir)
      .filter((name) => name.endsWith(SUFFIX))
      .sort();
    const expected = Object.keys(SCHEMAS)
      .map((k) => `${k}${SUFFIX}`)
      .sort();

    assert.deepEqual(
      onDisk,
      expected,
      "the .schema.json files on disk must match the SCHEMAS keys exactly",
    );
  });
});

// (4) outDir is created when absent. Point the tool at a not-yet-created nested
// subpath and confirm the directory is made and the files land.
test("[11.1-export-schemas] creates outDir when it does not exist", () => {
  withTmp((dir) => {
    const nested = path.join(dir, "does", "not", "exist", "schemas");
    assert.equal(existsSync(nested), false, "precondition: outDir must not exist yet");

    const written = exportSchemas(nested);

    assert.ok(existsSync(nested), "exportSchemas must create outDir when absent");
    assert.deepEqual(
      [...written].sort(),
      Object.keys(SCHEMAS).sort(),
      "created-dir run must still write every schema",
    );
    for (const k of Object.keys(SCHEMAS)) {
      assert.ok(
        existsSync(path.join(nested, `${k}${SUFFIX}`)),
        `${k}: file must land in the freshly created outDir`,
      );
    }
  });
});
