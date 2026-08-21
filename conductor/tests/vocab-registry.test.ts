// conductor/tests/vocab-registry.test.ts — GAP-016 parity test.
//
// SUBJECTS: conductor/core/vocab-registry.ts (the pin + the site index) and every
// restatement site it names — conductor/core/stops.ts, fsm-run.ts, fsm-item.ts,
// the exported SCHEMAS enums in core/types.ts, adapter/inject.ts's ROLE_* maps and
// scripts/conductor_bench.py. For each vocabulary this asserts every named site
// equals the pin, in BOTH directions (a member added to one side and forgotten on
// another goes red, whichever side moved).
//
// WHY THIS FILE EXISTS. MACRO-012 / ISSUE-113: a stop-kind change touches six
// files across TS, JSON schema and Python, none derivable from another; the
// Python copy in scripts/conductor_bench.py is verbatim and a TS-only change
// leaves it stale, hard-crashing the 14.2 benchmark mid-run. This test ties every
// copy to one pin, so the drift the record's costliest defect (C-082) rode becomes
// a red test the moment either side moves — including the cross-language case
// `grep STOP_KINDS` misses (the extractors below key on the CONCEPT, not the
// value).
//
// The test reads the real runtime TS exports and the real source of the Python and
// record-literal copies; it does not restate any vocabulary itself except through
// the registry's pin, which is the thing under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { STOP_KINDS } from "../core/stops.ts";
import { RUN_STATES } from "../core/fsm-run.ts";
import { ITEM_STATES } from "../core/fsm-item.ts";
import { SCHEMAS, SIDE_EFFECT_CLASSES, TOOL_CLASSES } from "../core/types.ts";
import { VOCABULARIES } from "../core/vocab-registry.ts";
import type { VocabSite } from "../core/vocab-registry.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

// The runtime TS arrays a `ts-value` site can name, keyed by "file#symbol". Adding
// a ts-value site to the registry for a symbol not listed here fails loudly (below)
// rather than silently skipping — a site the test cannot read is not a guarded site.
const TS_VALUES: Record<string, readonly string[]> = {
  "conductor/core/stops.ts#STOP_KINDS": STOP_KINDS,
  "conductor/core/fsm-run.ts#RUN_STATES": RUN_STATES,
  "conductor/core/fsm-item.ts#ITEM_STATES": ITEM_STATES,
  "conductor/core/types.ts#TOOL_CLASSES": TOOL_CLASSES,
  "conductor/core/types.ts#SIDE_EFFECT_CLASSES": SIDE_EFFECT_CLASSES,
};

function readSource(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "utf8");
}

// Navigate SCHEMAS.<root>.properties.<step>…​.enum for a dotted "root.step.step"
// path, asserting a non-empty string array at the leaf (a malformed or emptied
// schema cannot pass vacuously).
function schemaEnum(dotted: string): string[] {
  const parts = dotted.split(".");
  const root = parts[0];
  let node: unknown = (SCHEMAS as Record<string, unknown>)[root];
  for (const step of parts.slice(1)) {
    assert.ok(
      node !== null && typeof node === "object" && "properties" in node,
      `SCHEMAS path ${dotted}: no properties at or before "${step}"`,
    );
    const props = (node as { properties?: unknown }).properties;
    assert.ok(
      props !== null && typeof props === "object",
      `SCHEMAS path ${dotted}: properties is not an object at "${step}"`,
    );
    node = (props as Record<string, unknown>)[step];
  }
  assert.ok(
    node !== null && typeof node === "object" && "enum" in node,
    `SCHEMAS path ${dotted}: leaf carries no enum`,
  );
  const members = (node as { enum?: unknown }).enum;
  assert.ok(Array.isArray(members) && members.length > 0, `SCHEMAS path ${dotted}: enum must be a non-empty array`);
  return members.map((m: unknown): string => {
    assert.equal(typeof m, "string", `SCHEMAS path ${dotted}: every enum member is a string`);
    return m as string;
  });
}

// The top-level keys of a `const NAME ... = { ... }` object literal, tracking brace
// depth so the matching close is found (not the first `}` in a nested value).
function recordKeys(source: string, name: string): string[] {
  const startRe = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*\\{`);
  const m = startRe.exec(source);
  assert.ok(m !== null, `record ${name}: no \`const ${name} … = {\` found`);
  let i = m.index + m[0].length; // just past the opening brace
  let depth = 1;
  const bodyStart = i;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  assert.equal(depth, 0, `record ${name}: unbalanced braces`);
  const body = source.slice(bodyStart, i - 1);
  const keys: string[] = [];
  for (const line of body.split("\n")) {
    const km = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line);
    if (km !== null) keys.push(km[1]);
  }
  assert.ok(keys.length > 0, `record ${name}: extracted no keys`);
  return keys;
}

// The quoted members of a `NAME = ( "a", "b", … )` Python tuple assignment.
function pyTuple(source: string, name: string): string[] {
  const re = new RegExp(`\\b${name}\\s*=\\s*\\(([\\s\\S]*?)\\)`);
  const m = re.exec(source);
  assert.ok(m !== null, `python tuple ${name}: not found`);
  const members = [...m[1].matchAll(/["']([^"']+)["']/g)].map((mm) => mm[1]);
  assert.ok(members.length > 0, `python tuple ${name}: no members`);
  return members;
}

function readSite(site: VocabSite): string[] {
  switch (site.kind) {
    case "ts-value": {
      const key = `${site.file}#${site.symbol}`;
      const value = TS_VALUES[key];
      assert.ok(value !== undefined, `ts-value site ${key} is not wired into TS_VALUES — unreadable, so unguarded`);
      return [...value];
    }
    case "schema-enum":
      return schemaEnum(site.symbol);
    case "record-keys":
      return recordKeys(readSource(site.file), site.symbol);
    case "py-tuple":
      return pyTuple(readSource(site.file), site.symbol);
  }
}

for (const vocab of VOCABULARIES) {
  test(`[GAP-016-parity-${vocab.name}] every restatement site equals the pin, both directions`, () => {
    const pin = new Set(vocab.members);
    assert.ok(pin.size > 0, `${vocab.name}: the pin is non-empty`);
    assert.ok(vocab.sites.length > 0, `${vocab.name}: at least one site is named`);

    for (const site of vocab.sites) {
      const siteMembers = new Set(readSite(site));
      const label = `${vocab.name} @ ${site.lang}:${site.file}#${site.symbol}`;

      const missing = [...pin].filter((x) => !siteMembers.has(x));
      const extra = [...siteMembers].filter((x) => !pin.has(x));

      assert.deepEqual(missing, [], `${label}: site is MISSING pinned member(s) — the copy drifted behind the pin: ${missing.join(", ")}`);
      assert.deepEqual(extra, [], `${label}: site has member(s) NOT in the pin — the pin drifted behind the copy: ${extra.join(", ")}`);
    }
  });
}

test("[GAP-016-cross-language] at least one vocabulary is parity-checked across TS, JSON schema and Python", () => {
  const spans = VOCABULARIES.map((v) => new Set(v.sites.map((s) => s.lang)));
  assert.ok(
    spans.some((langs) => langs.has("ts") && langs.has("json") && langs.has("py")),
    "the registry must guard at least one vocabulary across all three languages (the ISSUE-113 stopKinds case)",
  );
});
