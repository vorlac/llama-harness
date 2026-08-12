// Task 1.1 (docs/plans/2026-08-07-conductor-harness-plan.md lines 2059-2084):
// tests for conductor/core/types.ts — every §2 schema (plan lines 468-1026) as a
// hand-written JSON Schema object + TS type, plus the minimal subset validator
// validate(schemaName, value) -> {ok, errors[]} whose subset is exactly
// type / required / enum / properties / items / additionalProperties
// (plan lines 2065-2068; two-validator discipline lines 2070-2075).
//
// Assertion coverage (docs/build/specs/task-1.1.assertions.json):
//   1.1-types                  -> "exported surface" describe (plus the type-only
//                                 import below, which compile-checks the 17 TS types)
//   1.1-validate               -> "exported surface" > validate return-shape test;
//                                 every assertAccepts/assertRejects goes through it
//   1.1-examples               -> each per-schema describe's "accepts the §2 …" tests
//   1.1-reject-required        -> each per-schema "rejects … missing …" test
//   1.1-reject-enum            -> the enum-rejection tests (Item state "DONE" et al.)
//   1.1-reject-extra           -> the "rejects an extra property …" tests
//   1.1-subset-rejection       -> "validator subset discipline" > out-of-subset tests
//   1.1-subset-clean           -> "validator subset discipline" > every-exported-schema
//                                 keyword walk
//   1.1-trivial-classification -> "Classification (§2.10)" > trivialItem tests
//
// Every verbatim fixture below is its §2 example with the jsonc comments stripped.
// Supplementary fixtures (not replacements for the verbatim ones) are constructed
// from the schema's own field comments and cite the plan line they complete from.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CONDUCTOR_NAME, SCHEMAS, validate } from "../core/types.ts";
import type {
  Config,
  RouterConfig,
  Run,
  Queue,
  Item,
  EvidenceRecord,
  DecisionRecord,
  AnomalyRecord,
  QuestionRecord,
  StaleRedRegistry,
  Findings,
  Verdict,
  Classification,
  ClassificationCheck,
  TestVet,
  ImplementerResult,
  JournalRecord,
} from "../core/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCHEMA_NAMES = [
  "Config",
  "RouterConfig",
  "Run",
  "Queue",
  "Item",
  "EvidenceRecord",
  "DecisionRecord",
  "AnomalyRecord",
  "QuestionRecord",
  "StaleRedRegistry",
  "Findings",
  "Verdict",
  "Classification",
  "ClassificationCheck",
  "TestVet",
  "ImplementerResult",
  "JournalRecord",
] as const;

function assertAccepts(schemaName: string, value: unknown, label: string): void {
  const result = validate(schemaName, value);
  assert.equal(
    result.ok,
    true,
    `${schemaName} must accept ${label}; errors: ${result.errors.join("; ")}`,
  );
  assert.deepEqual(result.errors, [], `${schemaName} ok:true must carry zero errors (${label})`);
}

function assertRejects(schemaName: string, value: unknown, label: string): void {
  const result = validate(schemaName, value);
  assert.equal(result.ok, false, `${schemaName} must reject ${label}, but it accepted`);
  assert.equal(
    result.errors.length > 0,
    true,
    `${schemaName} rejection of ${label} must carry at least one error message`,
  );
}

// Shallow copy minus one key — used to build the missing-required-field fixtures.
function omit<T extends object>(value: T, key: keyof T & string): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k !== key) copy[k] = v;
  }
  return copy;
}

// Shallow copy with one key replaced/added — wrong-enum and extra-property fixtures.
function withProp<T extends object>(
  value: T,
  key: string,
  propValue: unknown,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) copy[k] = v;
  copy[key] = propValue;
  return copy;
}

// The exact allowed keyword subset, plan lines 2065-2068.
const SUBSET_KEYWORDS = new Set([
  "type",
  "required",
  "enum",
  "properties",
  "items",
  "additionalProperties",
]);

// Recursively walk a schema object and record every keyword outside the subset.
// `properties` keys are property NAMES (not keywords) — recursion descends into
// their values; `items` may be a schema or a tuple of schemas; a boolean is a
// legal (sub)schema and carries no keywords.
function collectForeignKeywords(schema: unknown, path: string, offenses: string[]): void {
  if (typeof schema === "boolean") return;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    offenses.push(`${path}: not a schema object`);
    return;
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (!SUBSET_KEYWORDS.has(keyword)) {
      offenses.push(`${path}.${keyword}`);
      continue;
    }
    if (keyword === "properties") {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        for (const [prop, sub] of Object.entries(value)) {
          collectForeignKeywords(sub, `${path}.properties.${prop}`, offenses);
        }
      }
    } else if (keyword === "items") {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          collectForeignKeywords(value[i], `${path}.items[${i}]`, offenses);
        }
      } else {
        collectForeignKeywords(value, `${path}.items`, offenses);
      }
    } else if (keyword === "additionalProperties") {
      if (typeof value !== "boolean") {
        collectForeignKeywords(value, `${path}.additionalProperties`, offenses);
      }
    }
  }
}

// Register a schema through the exported SCHEMAS record for the duration of one
// test body, then remove it. This is the pinned surface for the out-of-subset
// rejection tests (plan lines 2066-2068): validate resolves names via SCHEMAS.
function withTemporarySchema(name: string, schema: unknown, body: () => void): void {
  const record = SCHEMAS as Record<string, unknown>;
  assert.equal(Object.hasOwn(record, name), false, `test schema name collides: ${name}`);
  record[name] = schema;
  try {
    body();
  } finally {
    delete record[name];
  }
}

// ---------------------------------------------------------------------------
// Verbatim §2 example fixtures (jsonc comments stripped, nothing else changed)
// ---------------------------------------------------------------------------

// §2.1, plan lines 480-618.
const configExample: Config = {
  version: 1,
  verify: {
    scopes: {
      unit: {
        command: ["node", "--test"],
        timeoutMs: 600000,
        itemTest: ["node", "--test", "{files}"],
      },
    },
    behavioralPaths: ["src/**"],
    requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
  },
  format: {
    rules: [],
  },
  git: {
    mode: "commit",
    branchPolicy: "pin",
    preexistingDirty: "refuse",
  },
  workflow: {
    trivialMaxFiles: 2,
    planReviewers: 4,
    planReviewMaxRounds: 3,
    itemReviewers: 6,
    skepticsPerFinding: 2,
    reviewMaxRounds: 3,
    vetCritics: 3,
    vetMaxRounds: 3,
    testRepairAttempts: 3,
    debugFixCap: 3,
    maxOverridesPerItem: 1,
    maxOverridesPerRun: 2,
  },
  parallel: {
    writes: "off",
    maxImplementers: 2,
    maxReaders: 6,
    subSessionTimeoutMs: 900000,
  },
  models: {
    default: "qwen3.6-27b",
    roles: {},
  },
  ponytail: "full",
  retention: {
    keepRuns: 20,
    maxRunDirBytes: 268435456,
    pruneOnRunCreate: true,
  },
  logging: { level: "info", components: {} },
};

// §2.2, plan lines 639-669.
const routerConfigExample: RouterConfig = {
  version: 1,
  listen: { host: "127.0.0.1", port: 8088 },
  upstream: { host: "127.0.0.1", port: 8080 },
  admission: {
    maxInflightPerModel: 4,
    maxQueued: 64,
    queueTimeoutMs: 600000,
  },
  priorities: { interactive: 0, review: 1, batch: 2 },
  affinity: { header: "X-Conductor-Group", contiguousDequeue: true },
  schema: {
    observeHeader: "X-Conductor-Schema",
    validateResponses: true,
    rejectOnMissing: false,
  },
  metrics: { ledgerPath: ".data/router/metrics.jsonl" },
  logging: { level: "info" },
};

// §2.3, plan lines 673-703.
const runExample: Run = {
  runId: "r-20260807-a1b2",
  createdIso: "2026-08-07T12:00:00Z",
  prompt: "<the user's prompt, verbatim>",
  sessionID: "<orchestrator session id>",
  state: "EXECUTING",
  classification: {
    kind: "work",
    rationale: "…",
    check: { agreed: true, note: "" },
  },
  startHead: "3f9a1c7",
  startBranch: "main",
  startDirty: ["src/parser/wip.ts"],
  excludedStaleRed: ["tests/i2.test.ts"],
  planReviewRounds: 2,
  stop: null,
  counters: {
    idleRePrompts: 0,
    futileRePrompts: 0,
    overridesUsed: 0,
  },
};

// Supplementary (NOT the verbatim example): a terminal-stop Run. The stop shape
// {kind, reasonDisplay, tsMs} is pinned at plan line 696; "noop" is a §2.9 stop
// kind (plan lines 888-897).
const runWithStopExample: Run = {
  ...runExample,
  stop: { kind: "noop", reasonDisplay: "3 futile idle re-prompts", tsMs: 1754560000000 },
};

// §2.4, plan lines 715-751.
const queueExample: Queue = {
  items: [
    {
      id: "I1",
      title: "…",
      rationale: "…",
      fileScope: ["src/parser/**"],
      testScope: ["tests/parser/**"],
      acceptance: ["parser rejects empty input with ParseError"],
      behavioral: true,
      dependsOn: [],
      ponytail: {
        necessary: "why this must exist",
        reuse: "what existing code was checked and why it doesn't cover this",
        ladderRung: "minimal-code",
      },
    },
  ],
};

// §2.5, plan lines 760-791.
const itemExample: Item = {
  id: "I1",
  state: "GREEN",
  assignee: null,
  worktree: null,
  attempts: {
    green: 1,
    reviewRounds: 0,
    vetRounds: 0,
    testRepairs: 0,
    debugFixes: 0,
    overridesUsed: 0,
  },
  blocked: null,
  deferred: null,
  debugging: null,
  evidence: {
    red: { ledger: "evidence", seq: 12 },
    green: { ledger: "evidence", seq: 18 },
    validated: { ledger: "evidence", seq: 25 },
  },
  taint: [],
  inlineClaim: null,
};

// Supplementary: populated annotation objects per the §2.5 field comments —
// blocked {reason, sinceMs, questionId?, stage} (plan line 772), deferred
// {reason, decisionId} (line 778), debugging {sinceMs, hypothesis} (line 780),
// inlineClaim {reason, decisionId} (line 789).
const itemBlockedExample: Item = {
  ...itemExample,
  state: "RED",
  blocked: {
    reason: "test-repair exhausted",
    sinceMs: 1754560000000,
    questionId: "Q-0001",
    stage: "RED",
  },
};

const itemDeferredExample: Item = {
  ...itemExample,
  deferred: { reason: "not this run", decisionId: "D-0007" },
};

const itemDebuggingExample: Item = {
  ...itemExample,
  debugging: { sinceMs: 1754560000000, hypothesis: "stale artifact from previous build" },
  inlineClaim: { reason: "one-line fix applied inline", decisionId: "D-0007" },
};

// §2.6, plan lines 799-815 (three records: red, green, verify).
const evidenceRedExample: EvidenceRecord = {
  seq: 12,
  ts: 1754560000000,
  kind: "red",
  itemId: "I1",
  command: ["node", "--test", "tests/parser.test.ts"],
  exitCode: 1,
  failureExcerpt: "AssertionError: expected ParseError… (≤300 chars)",
  failureClass: "assertion",
  targeted: true,
};

const evidenceGreenExample: EvidenceRecord = {
  seq: 18,
  ts: 1754560200000,
  kind: "green",
  itemId: "I1",
  command: ["node", "--test", "tests/parser.test.ts"],
  exitCode: 0,
};

const evidenceVerifyExample: EvidenceRecord = {
  seq: 25,
  ts: 1754560400000,
  kind: "verify",
  itemId: "I1",
  startedMs: 1754560300000,
  head: "3f9a1c7",
  branch: "main",
  tree: "main",
  excluded: ["tests/i2.test.ts"],
  green: true,
  scopes: { unit: { green: true, exitCode: 0, durationMs: 41876 } },
};

// §2.7, plan lines 854-867.
const decisionExample: DecisionRecord = {
  id: "D-0007",
  tsIso: "2026-08-07T12:00:00Z",
  question: "HTTP client for router health: cpp-httplib client vs raw sockets?",
  options: [
    {
      name: "cpp-httplib",
      score: {
        capability: 2,
        testability: 2,
        movingParts: 2,
        validationEarliness: 1,
        singleSource: 2,
      },
    },
    {
      name: "raw sockets",
      score: {
        capability: 1,
        testability: 1,
        movingParts: 0,
        validationEarliness: 1,
        singleSource: 2,
      },
    },
  ],
  choice: "cpp-httplib",
  why: "strict superset on scored criteria; already a dependency",
  kind: "derived",
  appliedWhere: "src/router/router-client note",
};

// §2.8, plan lines 877-883 (three records: override, gate-crash, disengage).
const anomalyOverrideExample: AnomalyRecord = {
  ts: 1754560000000,
  kind: "override",
  itemId: "I3",
  gate: "phase-order",
  reason: "<model-supplied>",
  grantedAction: "conductor_mark_green",
};

const anomalyGateCrashExample: AnomalyRecord = {
  ts: 1754560100000,
  kind: "gate-crash",
  gate: "git-policy",
  disposition: "denied",
  error: "…",
};

const anomalyDisengageExample: AnomalyRecord = {
  ts: 1754560200000,
  kind: "disengage",
  detail: "3 futile idle re-prompts; stop noop recorded",
};

// §2.11, plan lines 984-993.
const questionExample: QuestionRecord = {
  id: "Q-0001",
  tsMs: 1754560000000,
  runId: "r-…",
  question: "Should unknown config keys fail the whole load, or collect and report all?",
  askedBy: { role: "planner", sessionID: "ses_…" },
  humanTerritory: true,
  origin: "plan-review-cap",
  blocksItems: ["I2"],
  answeredIso: null,
  answer: null,
};

// Supplementary: the answered form — conductor_answer records answer and
// unblocks (plan lines 996-998); answeredIso/answer flip from null to strings.
const questionAnsweredExample: QuestionRecord = {
  ...questionExample,
  answeredIso: "2026-08-07T13:00:00Z",
  answer: "collect and report all",
};

// §2.11, plan lines 1002-1008.
const staleRedExample: StaleRedRegistry = {
  version: 1,
  entries: [
    {
      path: "tests/i2.test.ts",
      itemId: "I2",
      runId: "r-20260807-a1b2",
      sinceMs: 1754560000000,
      reason: "item blocked at RED (test-repair exhausted)",
    },
  ],
};

// §2.10, plan lines 922-928.
const findingsExample: Findings = {
  findings: [
    {
      id: "F1",
      severity: "major",
      lens: "correctness",
      claim: "…one-sentence defect statement…",
      evidence: "file:line + why (what breaks, when)",
      suggestedFix: "…",
    },
  ],
};

// §2.10, plan lines 930-932.
const verdictExample: Verdict = {
  findingId: "F1",
  upheld: false,
  reasoning: "…the claim mis-reads the guard on line 42; the case is handled…",
};

// §2.10, plan lines 934-936.
const classificationExample: Classification = {
  kind: "work",
  rationale: "…",
  confidence: "high",
  trivialItem: null,
};

// Supplementary: kind:"trivial" with a COMPLETE trivialItem — a §2.4 queue item
// minus id and dependsOn (title, rationale, fileScope, testScope, acceptance,
// behavioral, ponytail{necessary,reuse,ladderRung}), per plan lines 937-945.
const classificationTrivialCompleteExample: Classification = {
  kind: "trivial",
  rationale: "single-file comment fix",
  confidence: "high",
  trivialItem: {
    title: "…",
    rationale: "…",
    fileScope: ["src/parser/**"],
    testScope: ["tests/parser/**"],
    acceptance: ["parser rejects empty input with ParseError"],
    behavioral: true,
    ponytail: {
      necessary: "why this must exist",
      reuse: "what existing code was checked and why it doesn't cover this",
      ladderRung: "minimal-code",
    },
  },
};

// §2.10, plan lines 950-951.
const classificationCheckExample: ClassificationCheck = {
  agreed: true,
  correctedKind: null,
  note: "…",
};

// §2.10, plan lines 958-965.
const testVetExample: TestVet = {
  verdictsByCriterion: {
    observableBehavior: { pass: true, note: "" },
    wouldCatchWrongImpl: { pass: false, note: "tautological: asserts the mock" },
    rightLevel: { pass: true, note: "" },
    pinsAcceptance: { pass: true, note: "" },
    antiPatterns: { pass: true, note: "" },
  },
  mustFix: ["…"],
};

// §2.10, plan lines 967-970.
const implementerResultExample: ImplementerResult = {
  status: "DONE",
  summary: "…",
  concerns: [],
  neededContext: null,
  blockReason: null,
};

// Supplementary: the BLOCKED form — status enum member plus a non-null
// blockReason (plan lines 968-970).
const implementerBlockedExample: ImplementerResult = {
  status: "BLOCKED",
  summary: "…",
  concerns: [],
  neededContext: null,
  blockReason: "cannot satisfy acceptance without touching I2's fileScope",
};

// §7.2, plan lines 1932-1937. JournalRecord is in Task 1.1's 17-schema list
// (plan lines 2062-2064) but its example lives in §7.2, not §2 — transcribed
// verbatim from there.
const journalExample: JournalRecord = {
  seq: 141,
  ts: 1754560000000,
  level: "info",
  component: "fanout",
  runId: "r-…",
  itemId: "I3",
  sessionID: "ses_…",
  event: "subsession.dispatched",
  data: { role: "reviewer", lens: "correctness", model: "qwen3.6-27b" },
};

// ---------------------------------------------------------------------------
// Exported surface (assertions 1.1-types, 1.1-validate)
// ---------------------------------------------------------------------------

describe("exported surface of core/types.ts", () => {
  test('CONDUCTOR_NAME stays pinned to "conductor" (Task 0.3 subject, kept by Task 1.1)', () => {
    assert.equal(CONDUCTOR_NAME, "conductor");
  });

  test("SCHEMAS contains a JSON Schema object for each of the 17 §2 names", () => {
    const record = SCHEMAS as Record<string, unknown>;
    for (const name of SCHEMA_NAMES) {
      const schema = record[name];
      assert.equal(
        typeof schema === "object" && schema !== null && !Array.isArray(schema),
        true,
        `SCHEMAS[${JSON.stringify(name)}] must be a JSON Schema object`,
      );
    }
  });

  test("validate(schemaName, value) returns {ok: boolean, errors: string[]}", () => {
    const result = validate("Run", runExample);
    assert.equal(typeof result.ok, "boolean");
    assert.equal(Array.isArray(result.errors), true);
    for (const err of result.errors) {
      assert.equal(typeof err, "string", "every validate error must be a string");
    }
  });
});

// ---------------------------------------------------------------------------
// Per-schema example acceptance and rejections
// (assertions 1.1-examples, 1.1-reject-required, 1.1-reject-enum, 1.1-reject-extra)
// ---------------------------------------------------------------------------

describe("Config (§2.1)", () => {
  test("accepts the §2.1 example verbatim", () => {
    assertAccepts("Config", configExample, "the §2.1 example");
  });

  test('rejects a Config missing required "version"', () => {
    assertRejects("Config", omit(configExample, "version"), 'a value missing "version"');
  });

  test('rejects git.mode outside "read-only"|"commit"|"commit-and-push" (plan line 545)', () => {
    const badGitMode = withProp(configExample, "git", {
      mode: "yolo",
      branchPolicy: "pin",
      preexistingDirty: "refuse",
    });
    assertRejects("Config", badGitMode, 'git.mode "yolo"');
  });
});

describe("RouterConfig (§2.2)", () => {
  test("accepts the §2.2 example verbatim", () => {
    assertAccepts("RouterConfig", routerConfigExample, "the §2.2 example");
  });

  test('rejects a RouterConfig missing required "admission"', () => {
    assertRejects(
      "RouterConfig",
      omit(routerConfigExample, "admission"),
      'a value missing "admission"',
    );
  });
});

describe("Run (§2.3)", () => {
  test("accepts the §2.3 example verbatim", () => {
    assertAccepts("Run", runExample, "the §2.3 example");
  });

  test("accepts a Run with a recorded stop {kind, reasonDisplay, tsMs} (plan line 696)", () => {
    assertAccepts("Run", runWithStopExample, 'a Run with stop kind "noop"');
  });

  test('rejects a Run missing required "runId"', () => {
    assertRejects("Run", omit(runExample, "runId"), 'a value missing "runId"');
  });

  test('rejects run state "DONE" — outside the §3.1 vocabulary (plan lines 679, 1032-1043)', () => {
    assertRejects("Run", withProp(runExample, "state", "DONE"), 'state "DONE"');
  });

  test('rejects stop.kind "finished" — outside the §2.9 closed stop vocabulary (plan lines 888-897)', () => {
    const badStop = withProp(runExample, "stop", {
      kind: "finished",
      reasonDisplay: "…",
      tsMs: 1754560000000,
    });
    assertRejects("Run", badStop, 'stop.kind "finished"');
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects("Run", withProp(runExample, "unexpectedExtra", true), "an extra property");
  });
});

describe("Queue (§2.4)", () => {
  test("accepts the §2.4 example verbatim", () => {
    assertAccepts("Queue", queueExample, "the §2.4 example");
  });

  test('rejects a queue item missing required "id" (nested required)', () => {
    const badQueue = { items: [omit(queueExample.items[0], "id")] };
    assertRejects("Queue", badQueue, 'an item missing "id"');
  });

  test('rejects ponytail.ladderRung "vibes" — outside the closed rung list (plan lines 745-746)', () => {
    const badQueue = {
      items: [
        withProp(queueExample.items[0], "ponytail", {
          necessary: "why this must exist",
          reuse: "what existing code was checked and why it doesn't cover this",
          ladderRung: "vibes",
        }),
      ],
    };
    assertRejects("Queue", badQueue, 'ponytail.ladderRung "vibes"');
  });

  test("rejects an extra property on a queue item (additionalProperties: false)", () => {
    const badQueue = { items: [withProp(queueExample.items[0], "unexpectedExtra", true)] };
    assertRejects("Queue", badQueue, "an extra item property");
  });
});

describe("Item (§2.5)", () => {
  test("accepts the §2.5 example verbatim", () => {
    assertAccepts("Item", itemExample, "the §2.5 example");
  });

  test("accepts a blocked item annotation {reason, sinceMs, questionId, stage} (plan line 772)", () => {
    assertAccepts("Item", itemBlockedExample, "a blocked item");
  });

  test("accepts a deferred item annotation {reason, decisionId} (plan line 778)", () => {
    assertAccepts("Item", itemDeferredExample, "a deferred item");
  });

  test("accepts debugging {sinceMs, hypothesis} and inlineClaim {reason, decisionId} (plan lines 780, 789)", () => {
    assertAccepts("Item", itemDebuggingExample, "a debugging item with an inline claim");
  });

  test('rejects an Item missing required "state"', () => {
    assertRejects("Item", omit(itemExample, "state"), 'a value missing "state"');
  });

  test('rejects item state "DONE" — outside the §3.3 vocabulary (plan lines 763, 1164)', () => {
    assertRejects("Item", withProp(itemExample, "state", "DONE"), 'state "DONE"');
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects("Item", withProp(itemExample, "unexpectedExtra", true), "an extra property");
  });
});

describe("EvidenceRecord (§2.6)", () => {
  test('accepts the §2.6 "red" example verbatim', () => {
    assertAccepts("EvidenceRecord", evidenceRedExample, 'the §2.6 "red" example');
  });

  test('accepts the §2.6 "green" example verbatim', () => {
    assertAccepts("EvidenceRecord", evidenceGreenExample, 'the §2.6 "green" example');
  });

  test('accepts the §2.6 "verify" example verbatim', () => {
    assertAccepts("EvidenceRecord", evidenceVerifyExample, 'the §2.6 "verify" example');
  });

  test('rejects an EvidenceRecord missing required "seq"', () => {
    assertRejects("EvidenceRecord", omit(evidenceRedExample, "seq"), 'a value missing "seq"');
  });

  test('rejects failureClass "flake" — outside the §2.6.1 closed vocabulary (plan lines 817-823)', () => {
    assertRejects(
      "EvidenceRecord",
      withProp(evidenceRedExample, "failureClass", "flake"),
      'failureClass "flake"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "EvidenceRecord",
      withProp(evidenceRedExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("DecisionRecord (§2.7)", () => {
  test("accepts the §2.7 example verbatim", () => {
    assertAccepts("DecisionRecord", decisionExample, "the §2.7 example");
  });

  test('rejects a DecisionRecord missing required "choice"', () => {
    assertRejects("DecisionRecord", omit(decisionExample, "choice"), 'a value missing "choice"');
  });

  test('rejects kind "auto" — outside "derived"|"human" (plan line 865)', () => {
    assertRejects("DecisionRecord", withProp(decisionExample, "kind", "auto"), 'kind "auto"');
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "DecisionRecord",
      withProp(decisionExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("AnomalyRecord (§2.8)", () => {
  test('accepts the §2.8 "override" example verbatim', () => {
    assertAccepts("AnomalyRecord", anomalyOverrideExample, 'the §2.8 "override" example');
  });

  test('accepts the §2.8 "gate-crash" example verbatim', () => {
    assertAccepts("AnomalyRecord", anomalyGateCrashExample, 'the §2.8 "gate-crash" example');
  });

  test('accepts the §2.8 "disengage" example verbatim', () => {
    assertAccepts("AnomalyRecord", anomalyDisengageExample, 'the §2.8 "disengage" example');
  });

  test('rejects an AnomalyRecord missing required "kind"', () => {
    assertRejects(
      "AnomalyRecord",
      omit(anomalyOverrideExample, "kind"),
      'a value missing "kind"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "AnomalyRecord",
      withProp(anomalyOverrideExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("QuestionRecord (§2.11)", () => {
  test("accepts the §2.11 example verbatim", () => {
    assertAccepts("QuestionRecord", questionExample, "the §2.11 example");
  });

  test("accepts the answered form (answeredIso/answer strings; plan lines 996-998)", () => {
    assertAccepts("QuestionRecord", questionAnsweredExample, "an answered question");
  });

  test('rejects a QuestionRecord missing required "question"', () => {
    assertRejects(
      "QuestionRecord",
      omit(questionExample, "question"),
      'a value missing "question"',
    );
  });

  test('rejects origin "other" — outside the closed origin list (plan lines 989-991)', () => {
    assertRejects(
      "QuestionRecord",
      withProp(questionExample, "origin", "other"),
      'origin "other"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "QuestionRecord",
      withProp(questionExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("StaleRedRegistry (§2.11)", () => {
  test("accepts the §2.11 example verbatim", () => {
    assertAccepts("StaleRedRegistry", staleRedExample, "the §2.11 example");
  });

  test('rejects a StaleRedRegistry missing required "entries"', () => {
    assertRejects(
      "StaleRedRegistry",
      omit(staleRedExample, "entries"),
      'a value missing "entries"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "StaleRedRegistry",
      withProp(staleRedExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("Findings (§2.10)", () => {
  test("accepts the §2.10 FINDINGS example verbatim", () => {
    assertAccepts("Findings", findingsExample, "the §2.10 FINDINGS example");
  });

  test('rejects a Findings missing required "findings"', () => {
    assertRejects("Findings", omit(findingsExample, "findings"), 'a value missing "findings"');
  });

  test('rejects severity "blocker" — outside "major"|"minor"|"nit" (plan line 924)', () => {
    const badFindings = {
      findings: [withProp(findingsExample.findings[0], "severity", "blocker")],
    };
    assertRejects("Findings", badFindings, 'severity "blocker"');
  });

  test("rejects an extra property on a finding (additionalProperties: false)", () => {
    const badFindings = {
      findings: [withProp(findingsExample.findings[0], "unexpectedExtra", true)],
    };
    assertRejects("Findings", badFindings, "an extra finding property");
  });
});

describe("Verdict (§2.10)", () => {
  test("accepts the §2.10 VERDICT example verbatim", () => {
    assertAccepts("Verdict", verdictExample, "the §2.10 VERDICT example");
  });

  test('rejects a Verdict missing required "findingId"', () => {
    assertRejects("Verdict", omit(verdictExample, "findingId"), 'a value missing "findingId"');
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "Verdict",
      withProp(verdictExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("Classification (§2.10)", () => {
  test("accepts the §2.10 CLASSIFICATION example verbatim", () => {
    assertAccepts("Classification", classificationExample, "the §2.10 CLASSIFICATION example");
  });

  test('accepts kind:"trivial" with a COMPLETE trivialItem (plan lines 937-945)', () => {
    assertAccepts(
      "Classification",
      classificationTrivialCompleteExample,
      'kind:"trivial" with a complete trivialItem',
    );
  });

  test('rejects kind:"trivial" with trivialItem null (plan lines 937, 2080-2081)', () => {
    const trivialNull = {
      kind: "trivial",
      rationale: "…",
      confidence: "high",
      trivialItem: null,
    };
    assertRejects("Classification", trivialNull, 'kind:"trivial" with a null trivialItem');
  });

  test('rejects kind:"trivial" with a PARTIAL trivialItem (plan lines 937-945, 2080-2081)', () => {
    const trivialPartial = {
      kind: "trivial",
      rationale: "…",
      confidence: "high",
      trivialItem: { title: "fix comment typo" },
    };
    assertRejects("Classification", trivialPartial, 'kind:"trivial" with a partial trivialItem');
  });

  test('rejects kind:"work" with a non-null trivialItem ("null otherwise", plan line 937)', () => {
    const workWithItem = withProp(classificationTrivialCompleteExample, "kind", "work");
    assertRejects("Classification", workWithItem, 'kind:"work" with a non-null trivialItem');
  });

  test('rejects kind "chore" — outside "question"|"trivial"|"work" (plan lines 683, 935)', () => {
    assertRejects(
      "Classification",
      withProp(classificationExample, "kind", "chore"),
      'kind "chore"',
    );
  });

  test('rejects a Classification missing required "kind"', () => {
    assertRejects(
      "Classification",
      omit(classificationExample, "kind"),
      'a value missing "kind"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "Classification",
      withProp(classificationExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("ClassificationCheck (§2.10)", () => {
  test("accepts the §2.10 CLASSIFICATION_CHECK example verbatim", () => {
    assertAccepts(
      "ClassificationCheck",
      classificationCheckExample,
      "the §2.10 CLASSIFICATION_CHECK example",
    );
  });

  test('rejects a ClassificationCheck missing required "agreed"', () => {
    assertRejects(
      "ClassificationCheck",
      omit(classificationCheckExample, "agreed"),
      'a value missing "agreed"',
    );
  });

  test('rejects correctedKind "banana" — outside null|"question"|"trivial"|"work" (plan lines 952-953)', () => {
    assertRejects(
      "ClassificationCheck",
      withProp(classificationCheckExample, "correctedKind", "banana"),
      'correctedKind "banana"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "ClassificationCheck",
      withProp(classificationCheckExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("TestVet (§2.10)", () => {
  test("accepts the §2.10 TEST_VET example verbatim", () => {
    assertAccepts("TestVet", testVetExample, "the §2.10 TEST_VET example");
  });

  test('rejects a TestVet missing required "verdictsByCriterion"', () => {
    assertRejects(
      "TestVet",
      omit(testVetExample, "verdictsByCriterion"),
      'a value missing "verdictsByCriterion"',
    );
  });

  test('rejects verdictsByCriterion missing the "antiPatterns" criterion (nested required; plan lines 959-964)', () => {
    const missingCriterion = withProp(
      testVetExample,
      "verdictsByCriterion",
      omit(testVetExample.verdictsByCriterion, "antiPatterns"),
    );
    assertRejects("TestVet", missingCriterion, 'a value missing the "antiPatterns" criterion');
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "TestVet",
      withProp(testVetExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("ImplementerResult (§2.10)", () => {
  test("accepts the §2.10 IMPLEMENTER RESULT example verbatim", () => {
    assertAccepts(
      "ImplementerResult",
      implementerResultExample,
      "the §2.10 IMPLEMENTER RESULT example",
    );
  });

  test('accepts the BLOCKED form with a non-null blockReason (plan lines 968-970)', () => {
    assertAccepts("ImplementerResult", implementerBlockedExample, "a BLOCKED result");
  });

  test('rejects an ImplementerResult missing required "status"', () => {
    assertRejects(
      "ImplementerResult",
      omit(implementerResultExample, "status"),
      'a value missing "status"',
    );
  });

  test('rejects status "PARTIAL" — outside the closed status list (plan lines 968-969)', () => {
    assertRejects(
      "ImplementerResult",
      withProp(implementerResultExample, "status", "PARTIAL"),
      'status "PARTIAL"',
    );
  });

  test("rejects an extra property (additionalProperties: false)", () => {
    assertRejects(
      "ImplementerResult",
      withProp(implementerResultExample, "unexpectedExtra", true),
      "an extra property",
    );
  });
});

describe("JournalRecord (§7.2; in Task 1.1's schema list at plan lines 2062-2064)", () => {
  test("accepts the §7.2 example verbatim (plan lines 1932-1937)", () => {
    assertAccepts("JournalRecord", journalExample, "the §7.2 example");
  });

  test("accepts a record without itemId/sessionID — the correlation triple is (runId, itemId?, sessionID?) (plan line 1939)", () => {
    const minimalCorrelation = omit(omit(journalExample, "itemId"), "sessionID");
    assertAccepts("JournalRecord", minimalCorrelation, "a record without itemId/sessionID");
  });

  test('rejects a JournalRecord missing required "event"', () => {
    assertRejects("JournalRecord", omit(journalExample, "event"), 'a value missing "event"');
  });

  test('rejects level "verbose" — outside the five §7.1 levels (plan line 1911)', () => {
    assertRejects(
      "JournalRecord",
      withProp(journalExample, "level", "verbose"),
      'level "verbose"',
    );
  });
});

// ---------------------------------------------------------------------------
// Validator subset discipline
// (assertions 1.1-subset-rejection, 1.1-subset-clean; plan lines 2065-2075)
// ---------------------------------------------------------------------------

describe("validator subset discipline", () => {
  test('rejects a schema using "pattern" (out-of-subset) instead of silently ignoring it', () => {
    // "abc" satisfies both type:"string" AND the pattern, so a silently-ignoring
    // (or fully-implementing) validator would return ok:true — only explicit
    // unknown-keyword rejection can fail this value.
    withTemporarySchema("TaskOneOne-OutOfSubset-Pattern", { type: "string", pattern: "^a" }, () => {
      const result = validate("TaskOneOne-OutOfSubset-Pattern", "abc");
      assert.equal(
        result.ok,
        false,
        "a schema keyword outside the subset must be an error, not a silent ignore",
      );
      assert.equal(result.errors.length > 0, true, "the rejection must carry an error");
      assert.match(result.errors.join("\n"), /pattern/, "the error must name the keyword");
    });
  });

  test('rejects "minimum" nested inside a properties subschema (recursive keyword policing)', () => {
    withTemporarySchema(
      "TaskOneOne-OutOfSubset-Minimum",
      {
        type: "object",
        properties: { a: { type: "number", minimum: 3 } },
        required: ["a"],
        additionalProperties: false,
      },
      () => {
        const result = validate("TaskOneOne-OutOfSubset-Minimum", { a: 5 });
        assert.equal(
          result.ok,
          false,
          "an out-of-subset keyword nested in a subschema must also be an error",
        );
        assert.equal(result.errors.length > 0, true, "the rejection must carry an error");
        assert.match(result.errors.join("\n"), /minimum/, "the error must name the keyword");
      },
    );
  });

  test('rejects a top-level "oneOf" (combinators are outside the subset)', () => {
    withTemporarySchema("TaskOneOne-OutOfSubset-OneOf", { oneOf: [{ type: "string" }] }, () => {
      const result = validate("TaskOneOne-OutOfSubset-OneOf", "x");
      assert.equal(result.ok, false, "oneOf is outside the subset and must be an error");
      assert.equal(result.errors.length > 0, true, "the rejection must carry an error");
      assert.match(result.errors.join("\n"), /oneOf/, "the error must name the keyword");
    });
  });

  test("the keyword walker flags out-of-subset keywords (guards the next test against a vacuous pass)", () => {
    const offenses: string[] = [];
    collectForeignKeywords({ type: "string", pattern: "^a" }, "SelfTest", offenses);
    assert.deepEqual(offenses, ["SelfTest.pattern"]);
  });

  test("every exported schema uses ONLY subset keywords (two-validator discipline, plan lines 2070-2075)", () => {
    const offenses: string[] = [];
    const entries = Object.entries(SCHEMAS as Record<string, unknown>);
    assert.equal(entries.length > 0, true, "SCHEMAS must not be empty");
    for (const [name, schema] of entries) {
      collectForeignKeywords(schema, name, offenses);
    }
    assert.deepEqual(
      offenses,
      [],
      "schemas are constrained to the weaker validator on purpose (plan line 2075)",
    );
  });
});
