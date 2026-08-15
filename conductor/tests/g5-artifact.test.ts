// conductor/tests/g5-artifact.test.ts — the standing guard over the G5 record
// (plan 2884-2888, spec row g5-artifact-cannot-be-two-identical-commands).
//
// The G5 step's artifact is the deliverable: a record that the scripted e2e ran
// once with the C++ llama-router in the loop and once without, and came out the
// same. The first such record passed review while recording the SAME COMMAND
// TWICE — two invocations differing only in an environment variable no source
// file read. This file makes that shape fail, permanently and cheaply, on every
// run of the node suite:
//
//   * the shipped artifact must satisfy conductor/tools/g5-artifact-check.ts;
//   * and the checker itself must REJECT the tautologies, which the negative
//     cases below prove by feeding it exactly them. A checker that only ever
//     passes is the same defect one level up.
//
// It spawns nothing, opens no socket and needs no binary: it reads one markdown
// file and greps the source trees. The router-touching half of G5 lives in
// conductor/tools/g5-equivalence.ts, which is a driver and not a test for
// exactly that reason (G5-SG-1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { checkG5Artifact, envNamesReadBySource, splitCommand } from "../tools/g5-artifact-check.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACT = path.join(repoRoot, "docs", "build", "artifacts", "12.1-g5-equivalence.md");

// The dead variable, assembled rather than written: this file lives under one of
// the trees the checker greps, so spelling it out would make "no source reads
// it" false and quietly disarm the negative case below.
const DEAD_VAR = "CONDUCTOR_OPENAI" + "_BASE_URL";

const NODE = "/usr/local/bin/node --test --test-reporter=tap conductor/tests/e2e.test.ts";
const SUMMARY = '{"completionTokens":0,"promptTokens":0,"statusCounts":{"502":4},"totalRequests":4}';

function artifact(parts: {
  armWith: string;
  armWithout: string;
  served?: string;
  reportWith?: string;
  reportWithout?: string;
}): string {
  return [
    "# a G5 record",
    "ARM-WITH-ROUTER-CMD: " + parts.armWith,
    "ARM-WITHOUT-ROUTER-CMD: " + parts.armWithout,
    "ROUTER-SERVED-SUMMARY: " + (parts.served ?? SUMMARY),
    "REPORT-METRICS-WITH: " + (parts.reportWith ?? SUMMARY),
    "REPORT-METRICS-WITHOUT: " + (parts.reportWithout ?? "null"),
    "",
  ].join("\n");
}

test("G5 guard: the shipped equivalence record passes its own anti-tautology check (g5-artifact-cannot-be-two-identical-commands)", () => {
  assert.equal(
    existsSync(ARTIFACT),
    true,
    `${ARTIFACT} is missing — the G5 step's whole deliverable is that record; regenerate it with \`node conductor/tools/g5-equivalence.ts\``,
  );
  const result = checkG5Artifact(readFileSync(ARTIFACT, "utf8"), repoRoot);
  assert.deepEqual(
    result.violations,
    [],
    "the G5 artifact violates the check that exists because the first one was two identical commands:\n" +
      result.violations.join("\n"),
  );
  assert.notEqual(result.armWith, result.armWithout, "the recorded arms are two different invocations");
  assert.ok(
    result.envNamesReadBySource.length > 0,
    `the arms differ in ${JSON.stringify(result.differingEnvNames)}, and at least one of those names must be read by shipped source — otherwise the difference is decorative`,
  );
});

test("G5 guard: the checker REJECTS two byte-identical commands", () => {
  const result = checkG5Artifact(artifact({ armWith: NODE, armWithout: NODE }), repoRoot);
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => /BYTE-IDENTICAL/i.test(v)),
    `expected a byte-identical violation, got ${JSON.stringify(result.violations)}`,
  );
});

test("G5 guard: the checker REJECTS arms that differ only in a variable no source file reads", () => {
  // Verbatim the shipped defect: same argv, one env var, and that var is read by
  // nothing in the repo.
  const result = checkG5Artifact(
    artifact({
      armWith: `${DEAD_VAR}=http://127.0.0.1:8088/v1 ${NODE}`,
      armWithout: `${DEAD_VAR}=http://127.0.0.1:8080/v1 ${NODE}`,
    }),
    repoRoot,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.differingEnvNames, [DEAD_VAR]);
  assert.deepEqual(
    result.envNamesReadBySource,
    [],
    `${DEAD_VAR} must still be read by nothing — if some file starts reading it, this negative case stops testing anything`,
  );
  assert.ok(
    result.violations.some((v) => v.includes("no source file")),
    `expected an unread-variable violation, got ${JSON.stringify(result.violations)}`,
  );
});

test("G5 guard: the checker REJECTS a WITH arm whose report never received a summary, and a WITHOUT arm that did", () => {
  const noSummary = checkG5Artifact(
    artifact({
      armWith: `CONDUCTOR_E2E_ROUTER_PORT=8391 ${NODE}`,
      armWithout: NODE,
      reportWith: "null",
    }),
    repoRoot,
  );
  assert.equal(noSummary.ok, false);
  assert.ok(
    noSummary.violations.some((v) => v.includes("CONTACTED")),
    `a router that was up but never asked must fail: ${JSON.stringify(noSummary.violations)}`,
  );

  const bothServed = checkG5Artifact(
    artifact({
      armWith: `CONDUCTOR_E2E_ROUTER_PORT=8391 ${NODE}`,
      armWithout: NODE,
      reportWithout: SUMMARY,
    }),
    repoRoot,
  );
  assert.equal(bothServed.ok, false);
  assert.ok(
    bothServed.violations.some((v) => v.includes("nothing listening")),
    `a summary arriving with no router must fail: ${JSON.stringify(bothServed.violations)}`,
  );
});

test("G5 guard: the checker REJECTS a report summary that did not come from the router it recorded", () => {
  const result = checkG5Artifact(
    artifact({
      armWith: `CONDUCTOR_E2E_ROUTER_PORT=8391 ${NODE}`,
      armWithout: NODE,
      served: '{"totalRequests":4}',
      reportWith: '{"totalRequests":9}',
    }),
    repoRoot,
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.violations.some((v) => v.includes("did not come from that router")),
    `expected a provenance violation, got ${JSON.stringify(result.violations)}`,
  );
});

test("G5 guard: the env-read grep and the command splitter answer honestly", () => {
  assert.deepEqual(
    envNamesReadBySource([DEAD_VAR], repoRoot),
    [],
    "the variable the first record leaned on is read by no shipped source file",
  );
  assert.deepEqual(
    envNamesReadBySource(["CONDUCTOR_E2E_ROUTER_PORT"], repoRoot),
    ["CONDUCTOR_E2E_ROUTER_PORT"],
    "the variable the arms actually differ in IS read — conductor/tests/e2e.test.ts aims the metrics seam with it",
  );
  const shape = splitCommand("A=1 B=2 node --test x.ts");
  assert.deepEqual(
    shape.env.map((e) => e.name),
    ["A", "B"],
  );
  assert.deepEqual(shape.argv, ["node", "--test", "x.ts"]);
});
