// Task 0.3 (assertion 0.3-smoke): prove that .ts imports execute under
// `node --test` type-stripping by importing a named export from core/types.ts
// with an explicit .ts extension and asserting on its runtime value.
// (Deviation C-010: no literal 1 === 1 assertion — the gate rejects
// trivially-true assertions; asserting on the imported value preserves the
// task's stated purpose.)

import { test } from "node:test";
import assert from "node:assert/strict";

import { CONDUCTOR_NAME } from "../core/types.ts";

test("smoke: CONDUCTOR_NAME imported from ../core/types.ts equals \"conductor\"", () => {
  assert.equal(CONDUCTOR_NAME, "conductor");
});
