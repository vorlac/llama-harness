// conductor/tests/single-source.test.ts — G6 single-source guard for the FSM
// state vocabularies. The §3.1 Run FSM (core/fsm-run.ts) and the §3.3 Item FSM
// (core/fsm-item.ts) each own a closed state vocabulary; the §2.3 Run schema and
// §2.5 Item schema (core/types.ts, via SCHEMAS) each own the SAME vocabulary as
// their `state` enum. "Single source" is a convention until something enforces
// it — this test makes it a construction: if either pair ever drifts (a state
// added to the FSM but not the schema, or vice versa), the run goes red.
//
// The schema half is read at RUNTIME out of the exported SCHEMAS record
// (SCHEMAS.Run.properties.state.enum / SCHEMAS.Item.properties.state.enum): those
// enum arrays ARE the vocabulary every persisted run/item and the router's
// validator are checked against. types.ts keeps its RUN_STATES/ITEM_STATES arrays
// module-private (only the erased TS unions are exported), so the schema enum is
// the sole runtime-derivable source — and it is exactly the one the validator
// uses, so this guard pins the vocabulary the system actually enforces.

import { test } from "node:test";
import assert from "node:assert/strict";

import { RUN_STATES } from "../core/fsm-run.ts";
import { ITEM_STATES } from "../core/fsm-item.ts";
import { SCHEMAS } from "../core/types.ts";

function assertIsRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
}

// Read the schema's own `state` enum out of SCHEMAS at runtime and return it as a
// Set. Navigates SCHEMAS.<name>.properties.state.enum defensively (the record is
// typed Record<string, unknown>), asserting a string array with at least one
// member so a malformed or emptied schema cannot pass vacuously.
function schemaStateSet(schemaName: string): Set<string> {
  const schema = SCHEMAS[schemaName];
  assertIsRecord(schema, `SCHEMAS.${schemaName}`);
  const properties = schema.properties;
  assertIsRecord(properties, `SCHEMAS.${schemaName}.properties`);
  const state = properties.state;
  assertIsRecord(state, `SCHEMAS.${schemaName}.properties.state`);
  const members = state.enum;
  assert.ok(
    Array.isArray(members),
    `SCHEMAS.${schemaName}.properties.state.enum must be an array`,
  );
  const values = members.map((member: unknown): string => {
    assert.equal(
      typeof member,
      "string",
      `every ${schemaName}.state enum member must be a string`,
    );
    return member as string;
  });
  assert.ok(
    values.length > 0,
    `SCHEMAS.${schemaName}.properties.state.enum must be non-empty`,
  );
  return new Set(values);
}

test("[G6-single-source] the §3.1 Run FSM RUN_STATES equal the Run schema's state enum, exactly", () => {
  assert.ok(RUN_STATES.length > 0, "RUN_STATES is a non-empty vocabulary");
  assert.deepEqual(
    new Set(RUN_STATES),
    schemaStateSet("Run"),
    "RUN_STATES (fsm-run.ts) and SCHEMAS.Run.properties.state.enum must have the same members — no extras, none missing",
  );
});

test("[G6-single-source] the §3.3 Item FSM ITEM_STATES equal the Item schema's state enum, exactly", () => {
  assert.ok(ITEM_STATES.length > 0, "ITEM_STATES is a non-empty vocabulary");
  assert.deepEqual(
    new Set(ITEM_STATES),
    schemaStateSet("Item"),
    "ITEM_STATES (fsm-item.ts) and SCHEMAS.Item.properties.state.enum must have the same members — no extras, none missing",
  );
});
