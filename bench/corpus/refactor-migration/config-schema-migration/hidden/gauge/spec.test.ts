// The graded checks for the config-schema migration.
//
// MIGRATION-SPEC.md states the end state, and three of the four checks below
// are that document's own words rather than this file's opinion: section 2
// gives the two grep commands and says they "must print nothing", and section 5
// says package.json has no dependencies and must keep having none. The fourth
// is a floor on the decision log the spec requires, not a judgement of it - no
// mechanical check can read whether twelve open questions were resolved well.
//
// The six frozen suites are graded from the copies beside this file, so a
// working tree that edited or deleted anything under test/ is still measured by
// the suite the task was set with. They import only
// ../src/testsupport/harness.ts, which resolves out of this directory exactly
// as it resolves out of test/.
import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GAUGE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(GAUGE, "..");

// MIGRATION-SPEC.md section 2, the first grep: no module outside src/config/
// and src/testsupport/ may index configuration by string.
const STRING_INDEX =
  /\[\s*"(server|auth|rateLimit|cors|pipeline|retry|sink|transform|log|metrics|spool)\./;

// MIGRATION-SPEC.md section 2, the second grep: the four legacy accessors have
// no callers left outside src/config/. getCurrentConfig is deliberately not in
// this set - open question 9 leaves keeping a typed process-global on the table.
const LEGACY_ACCESSOR = /\b(getStr|getNum|getBool|getList)\(/;

// A decision log shorter than this is a file that exists rather than a log.
const NOTES_MIN_BYTES = 1000;

function typescriptFiles(dir: string, prefix: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    const full = join(dir, name);
    const relative = prefix === "" ? name : prefix + "/" + name;
    if (statSync(full).isDirectory()) {
      out.push(...typescriptFiles(full, relative));
    } else if (name.endsWith(".ts")) {
      out.push(relative);
    }
  }
  return out;
}

function hits(pattern: RegExp, exclude: string[]): string[] {
  const found: string[] = [];
  for (const relative of typescriptFiles(join(ROOT, "src"), "")) {
    if (exclude.some((prefix) => relative.startsWith(prefix))) {
      continue;
    }
    const lines = readFileSync(join(ROOT, "src", relative), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        found.push("src/" + relative + ":" + String(index + 1) + ": " + line.trim());
      }
    });
  }
  return found;
}

test("no module outside the config layer reads configuration by string key", () => {
  const remaining = hits(STRING_INDEX, ["config/", "testsupport/"]);
  assert.deepEqual(
    remaining,
    [],
    "MIGRATION-SPEC.md section 2 requires this to be empty; " +
      String(remaining.length) +
      " call site(s) still index configuration by string",
  );
});

test("the legacy untyped accessors have no callers left outside the config layer", () => {
  const remaining = hits(LEGACY_ACCESSOR, ["config/"]);
  assert.deepEqual(
    remaining,
    [],
    "MIGRATION-SPEC.md section 2 requires this to be empty; " +
      String(remaining.length) +
      " call site(s) still reach for getStr/getNum/getBool/getList",
  );
});

test("the package still declares no dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
  assert.deepEqual(declared, [], "the validator is written here, not installed");
});

test("the migration leaves a decision log behind", () => {
  let body = "";
  try {
    body = readFileSync(join(ROOT, "MIGRATION-NOTES.md"), "utf8");
  } catch {
    assert.fail("MIGRATION-NOTES.md is missing");
  }
  assert.ok(
    body.trim().length >= NOTES_MIN_BYTES,
    "MIGRATION-NOTES.md is " +
      String(body.trim().length) +
      " bytes; the spec's twelve open questions each need a resolution and a reason",
  );
});
