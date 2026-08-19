// conductor/core/types.ts — every §2 schema of
// docs/plans/2026-08-07-conductor-harness-plan.md, once (Task 1.1): each schema
// exists as a TS type AND a hand-written JSON Schema object in SCHEMAS, plus the
// minimal subset validator `validate` (plan lines 2059-2084). Core module: pure,
// imports nothing.
//
// Schema-subset discipline (plan lines 2070-2075): every schema here restricts
// itself to the keyword subset the validator implements — type / required / enum
// / properties / items / additionalProperties — so the router's full validator
// and this one can never disagree about the same payload. `validate` REJECTS any
// other keyword at any depth rather than silently ignoring it.

// CONDUCTOR_NAME is pinned by tests (conductor/tests/smoke.test.ts).
export const CONDUCTOR_NAME = "conductor";

// ---------------------------------------------------------------------------
// Closed vocabularies (single source for both the TS unions and the schema
// enum members; as-const arrays instead of TS enum declarations, per G2).
// ---------------------------------------------------------------------------

// §7.1, plan line 1911.
export const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// §3.1, plan lines 1032-1043.
const RUN_STATES = [
  "INTAKE",
  "DECOMPOSED",
  "PLANNED",
  "PLAN_REVIEWED",
  "EXECUTING",
  "REPORTED",
  "TRIVIAL_DONE",
  "ANSWERED",
] as const;
export type RunState = (typeof RUN_STATES)[number];

// §2.9, plan lines 888-897.
const STOP_KINDS = ["done", "noop", "blocked", "surfaced", "env", "interrupt"] as const;
export type StopKind = (typeof STOP_KINDS)[number];

// §2.3 / §2.10, plan lines 681, 935.
const CLASSIFICATION_KINDS = ["question", "trivial", "work"] as const;
export type ClassificationKind = (typeof CLASSIFICATION_KINDS)[number];

// §2.4, plan lines 745-746.
const LADDER_RUNGS = [
  "skip",
  "reuse",
  "stdlib",
  "platform",
  "dependency",
  "one-liner",
  "minimal-code",
] as const;
export type LadderRung = (typeof LADDER_RUNGS)[number];

// §3.3, plan lines 763, 1164.
const ITEM_STATES = [
  "PENDING",
  "RED",
  "TEST_VETTED",
  "GREEN",
  "VALIDATED",
  "REVIEWED",
  "PUBLISHED",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

// §2.6, plan lines 800-814.
const EVIDENCE_KINDS = ["red", "green", "verify"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// §2.6.1, plan lines 817-823.
const FAILURE_CLASSES = ["assertion", "missing-subject", "error"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

// §2.7, plan line 865.
const DECISION_KINDS = ["derived", "human"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

// §2.8, plan lines 878-882.
const ANOMALY_KINDS = ["override", "gate-crash", "disengage"] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

// §2.11, plan lines 989-991.
const QUESTION_ORIGINS = [
  "surface-tool",
  "plan-review-cap",
  "debug-architecture",
  "implementer-blocked",
  "review-round-cap",
  "scope-conflict",
] as const;
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];

// §2.10, plan line 924.
const SEVERITIES = ["major", "minor", "nit"] as const;
export type Severity = (typeof SEVERITIES)[number];

// §2.10, plan lines 968-969.
const IMPLEMENTER_STATUSES = [
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED",
] as const;
export type ImplementerStatus = (typeof IMPLEMENTER_STATUSES)[number];

// §2.1 git block, plan lines 545, 551, 557.
const GIT_MODES = ["read-only", "commit", "commit-and-push"] as const;
export type GitMode = (typeof GIT_MODES)[number];
const BRANCH_POLICIES = ["pin", "check-only"] as const;
export type BranchPolicy = (typeof BRANCH_POLICIES)[number];
const PREEXISTING_DIRTY_MODES = ["refuse", "exclude"] as const;
export type PreexistingDirtyMode = (typeof PREEXISTING_DIRTY_MODES)[number];

// §2.1 format rules, plan lines 530-542.
const FORMAT_MODES = ["stdin", "check"] as const;
export type FormatMode = (typeof FORMAT_MODES)[number];

// §2.1 parallel block, plan line 581.
const PARALLEL_WRITE_MODES = ["off", "worktrees"] as const;
export type ParallelWriteMode = (typeof PARALLEL_WRITE_MODES)[number];

// §2.1 / §6.3, plan line 606.
const PONYTAIL_LEVELS = ["lite", "full", "ultra"] as const;
export type PonytailLevel = (typeof PONYTAIL_LEVELS)[number];

// ---------------------------------------------------------------------------
// The two tree types (§3.5 / §4.2 / §2.6; C-037 ruling 5)
// ---------------------------------------------------------------------------

// A "tree" is two different things and the difference decides whether a gate
// fires:
//
//   * the EVIDENCE layer names a tree by SLUG — "main" for the shared tree, an
//     itemId for a §4.2 worktree. adapter/evidence.ts composes
//     verify-running-<slug>.json out of it under assertSafeId, which rejects a
//     separator, so a path can never be one;
//   * the GATE layer names a tree by PATH — core/gates-edit.ts strips it off the
//     front of an absolute edit path by string equality, so a slug can never be
//     one: a session whose tree is "main" is denied every edit it attempts.
//
// The two were one `string` for four authorship events running, each of which fed
// one where the other belonged. They are branded here so the compiler carries the
// distinction the names alone could not (fix-campaign GAP-004), and the
// constructors validate so the guarantee survives the plugin runtime's type
// stripping too, where the compile-time half does not exist (G5).
declare const TREE_SLUG_BRAND: unique symbol;
declare const TREE_PATH_BRAND: unique symbol;

export type TreeSlug = string & { readonly [TREE_SLUG_BRAND]: "tree-slug" };
export type TreePath = string & { readonly [TREE_PATH_BRAND]: "tree-path" };

// The evidence layer's tree name. Refuses a separator (the marker filename is
// composed from it) and refuses the empty string (it names no tree at all).
export function treeSlug(value: string): TreeSlug {
  if (value.length === 0) {
    throw new Error("tree slug: the empty string names no tree");
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(
      `tree slug: "${value}" is a PATH, not a tree slug — the evidence layer's tree is "main" or an itemId, and a marker filename is composed from it`,
    );
  }
  return value as TreeSlug;
}

// The gate layer's tree root. Refuses a bare slug — the ISSUE-002 misfeed, where
// the registry handed the edit gate "main" and every write in that session was
// denied. The empty string is admitted: it is NO_TREE, the registry's "this
// session has no tree of its own", which adapter/continuation.ts resolves against
// the workspace root before any gate reads it.
export function treePath(value: string): TreePath {
  if (value.length > 0 && !value.includes("/")) {
    throw new Error(
      `tree path: "${value}" is a SLUG, not a tree path — the edit gate strips this value off the front of an absolute path, so a bare name matches nothing and denies every edit`,
    );
  }
  return value as TreePath;
}

// The shared tree's evidence slug, once.
export const MAIN_TREE: TreeSlug = treeSlug("main");

// "No tree of this session's own", once. The §3.5 registry carries it for a
// sub-session that works no item (a classifier, a planner, a plan reviewer).
export const NO_TREE: TreePath = treePath("");

// ---------------------------------------------------------------------------
// TS types (one per §2 schema, plus their shared shapes)
// ---------------------------------------------------------------------------

// §2.1 `.conductor/config.json`, plan lines 480-618.
export interface Config {
  version: number;
  verify: {
    scopes: Record<string, { command: string[]; timeoutMs: number; itemTest?: string[] }>;
    behavioralPaths: string[];
    requiredScopes: Array<{ pattern: string; scopes: string[] }>;
  };
  format: { rules: Array<{ pattern: string; mode: FormatMode; command: string[] }> };
  git: {
    mode: GitMode;
    branchPolicy: BranchPolicy;
    preexistingDirty: PreexistingDirtyMode;
  };
  workflow: {
    trivialMaxFiles: number;
    planReviewers: number;
    planReviewMaxRounds: number;
    itemReviewers: number;
    skepticsPerFinding: number;
    reviewMaxRounds: number;
    vetCritics: number;
    vetMaxRounds: number;
    testRepairAttempts: number;
    debugFixCap: number;
    maxOverridesPerItem: number;
    maxOverridesPerRun: number;
  };
  parallel: {
    writes: ParallelWriteMode;
    maxImplementers: number;
    maxReaders: number;
    subSessionTimeoutMs: number;
  };
  models: { default: string; roles: Record<string, string> };
  ponytail: PonytailLevel;
  retention: { keepRuns: number; maxRunDirBytes: number; pruneOnRunCreate: boolean };
  logging: { level: LogLevel; components: Record<string, LogLevel> };
}

// §2.2 `.data/configs/conductor-router.json`, plan lines 639-669.
export interface RouterConfig {
  version: number;
  listen: { host: string; port: number };
  upstream: { host: string; port: number };
  admission: { maxInflightPerModel: number; maxQueued: number; queueTimeoutMs: number };
  priorities: { interactive: number; review: number; batch: number };
  affinity: { header: string; contiguousDequeue: boolean };
  schema: { observeHeader: string; validateResponses: boolean; rejectOnMissing: boolean };
  metrics: { ledgerPath: string };
  logging: { level: LogLevel };
}

// §2.3 `runs/<runId>/run.json`, plan lines 673-703.
export interface Run {
  runId: string;
  createdIso: string;
  prompt: string;
  sessionID: string;
  state: RunState;
  classification: {
    kind: ClassificationKind;
    rationale: string;
    check: { agreed: boolean; note: string };
  };
  startHead: string;
  startBranch: string;
  startDirty: string[];
  excludedStaleRed: string[];
  planReviewRounds: number;
  stop: { kind: StopKind; reasonDisplay: string; tsMs: number } | null;
  counters: { idleRePrompts: number; futileRePrompts: number; overridesUsed: number };
}

// §2.4 `runs/<runId>/queue.json`, plan lines 715-751.
export interface QueueItem {
  id: string;
  title: string;
  rationale: string;
  fileScope: string[];
  testScope: string[];
  acceptance: string[];
  behavioral: boolean;
  dependsOn: string[];
  ponytail: { necessary: string; reuse: string; ladderRung: LadderRung };
}

export interface Queue {
  items: QueueItem[];
}

// §2.5 `runs/<runId>/items/<itemId>.json`, plan lines 760-791.
export interface EvidenceRef {
  ledger: string;
  seq: number;
}

export interface Item {
  id: string;
  state: ItemState;
  assignee: string | null;
  // §4.2: the item's own tree when worktree mode gave it one, else null — the
  // shared tree is not spelled here. A PATH: it is what the §3.5 registry hands
  // the edit gate.
  worktree: TreePath | null;
  attempts: {
    green: number;
    reviewRounds: number;
    vetRounds: number;
    testRepairs: number;
    debugFixes: number;
    overridesUsed: number;
  };
  blocked: { reason: string; sinceMs: number; questionId?: string; stage: string } | null;
  // The ids of the §2.11 questions this item's `blocked` annotation has been cleared
  // FROM. `blocked` holds one disposition and forgets it on release, so "open
  // question, unblocked item" reads identically whether the block was deliberately
  // cleared (§2.5 names conductor_queue_amend a legal clearer) or never finished
  // being applied. C-032 E7's reconciler has to tell those apart, and the only
  // discriminator it can trust is one the record itself carries: a filesystem
  // timestamp is defeated by replay, backup, copy and a coarse-mtime volume alike.
  // Absent on items that have never been released, so every §2.5 item ever written
  // stays valid.
  releasedQuestions?: string[];
  deferred: { reason: string; decisionId: string } | null;
  debugging: { sinceMs: number; hypothesis: string } | null;
  evidence: { red?: EvidenceRef; green?: EvidenceRef; validated?: EvidenceRef };
  taint: unknown[];
  inlineClaim: { reason: string; decisionId: string } | null;
}

// §2.6 `runs/<runId>/evidence.jsonl`, plan lines 799-815 (+§2.6.1).
export type EvidenceRecord =
  | {
      seq: number;
      ts: number;
      kind: "red";
      itemId: string;
      command: string[];
      exitCode: number;
      failureExcerpt: string;
      failureClass: FailureClass;
      targeted: boolean;
    }
  | {
      seq: number;
      ts: number;
      kind: "green";
      itemId: string;
      command: string[];
      exitCode: number;
    }
  | {
      seq: number;
      ts: number;
      kind: "verify";
      itemId: string;
      startedMs: number;
      head: string;
      branch: string;
      // The evidence layer's tree SLUG — the same name the per-tree verify marker
      // carries, never a path.
      tree: TreeSlug;
      excluded: string[];
      green: boolean;
      scopes: Record<string, { green: boolean; exitCode: number; durationMs: number }>;
    };

// §2.7 `runs/<runId>/decisions.jsonl`, plan lines 854-867.
export interface DecisionRecord {
  id: string;
  tsIso: string;
  question: string;
  options: Array<{
    name: string;
    score?: {
      capability: number;
      testability: number;
      movingParts: number;
      validationEarliness: number;
      singleSource: number;
    };
  }>;
  choice: string;
  why: string;
  kind: DecisionKind;
  appliedWhere: string;
}

// §3.2 PLANNED receipt (Task 9.2). A plan decision is a DecisionRecord minus the
// two fields the handler mints (`id`, `tsIso`) — derived from DecisionRecord by
// Omit so the proposal shape can never drift from the ledger shape.
export type PlanDecision = Omit<DecisionRecord, "id" | "tsIso">;

export interface Plan {
  markdown: string;
  decisions: PlanDecision[];
}

// §2.8 `runs/<runId>/anomalies.jsonl`, plan lines 877-883.
export type AnomalyRecord =
  | {
      ts: number;
      kind: "override";
      itemId: string;
      gate: string;
      reason: string;
      grantedAction: string;
    }
  | { ts: number; kind: "gate-crash"; gate: string; disposition: string; error: string }
  | { ts: number; kind: "disengage"; detail: string };

// §2.11 `runs/<runId>/questions.jsonl`, plan lines 984-993.
export interface QuestionRecord {
  id: string;
  tsMs: number;
  runId: string;
  question: string;
  askedBy: { role: string; sessionID: string };
  humanTerritory: boolean;
  origin: QuestionOrigin;
  blocksItems: string[];
  answeredIso: string | null;
  answer: string | null;
}

// §2.11 `.conductor/state/stale-red.json`, plan lines 1002-1008.
export interface StaleRedRegistry {
  version: number;
  entries: Array<{
    path: string;
    itemId: string;
    runId: string;
    sinceMs: number;
    reason: string;
  }>;
}

// §2.10 FINDINGS, plan lines 922-928.
export interface Findings {
  findings: Array<{
    id: string;
    severity: Severity;
    lens: string;
    claim: string;
    evidence: string;
    suggestedFix: string;
  }>;
}

// §2.10 VERDICT, plan lines 930-932.
export interface Verdict {
  findingId: string;
  upheld: boolean;
  reasoning: string;
}

// §2.10 CLASSIFICATION, plan lines 934-948: trivialItem is a COMPLETE §2.4
// queue item minus `id` and `dependsOn`; non-null iff kind is "trivial" (that
// cross-field rule is enforced inside `validate`, keeping the schema itself
// inside the keyword subset).
export interface TrivialItem {
  title: string;
  rationale: string;
  fileScope: string[];
  testScope: string[];
  acceptance: string[];
  behavioral: boolean;
  ponytail: { necessary: string; reuse: string; ladderRung: LadderRung };
}

export interface Classification {
  kind: ClassificationKind;
  rationale: string;
  confidence: string;
  trivialItem: TrivialItem | null;
}

// §2.10 CLASSIFICATION_CHECK, plan lines 950-954.
export interface ClassificationCheck {
  agreed: boolean;
  correctedKind: ClassificationKind | null;
  note: string;
}

// §2.10 TEST_VET, plan lines 958-965.
export interface CriterionVerdict {
  pass: boolean;
  note: string;
}

export interface TestVet {
  verdictsByCriterion: {
    observableBehavior: CriterionVerdict;
    wouldCatchWrongImpl: CriterionVerdict;
    rightLevel: CriterionVerdict;
    pinsAcceptance: CriterionVerdict;
    antiPatterns: CriterionVerdict;
  };
  mustFix: string[];
}

// §2.10 IMPLEMENTER RESULT, plan lines 967-970.
export interface ImplementerResult {
  status: ImplementerStatus;
  summary: string;
  concerns: string[];
  neededContext: string | null;
  blockReason: string | null;
}

// §7.2 journal record, plan lines 1932-1939: the correlation triple is
// (runId, itemId?, sessionID?), so itemId and sessionID are optional.
export interface JournalRecord {
  seq: number;
  ts: number;
  level: LogLevel;
  component: string;
  runId: string;
  itemId?: string;
  sessionID?: string;
  event: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hand-written JSON Schema objects (subset keywords only)
// ---------------------------------------------------------------------------

// Shared leaf schemas. Nullable fields use `type: ["x", "null"]` — an array of
// primitive type names under the `type` keyword, still inside the subset.
const stringSchema = { type: "string" };
const numberSchema = { type: "number" };
const booleanSchema = { type: "boolean" };
const stringOrNullSchema = { type: ["string", "null"] };
const stringArraySchema = { type: "array", items: { type: "string" } };
const logLevelSchema = { enum: LOG_LEVELS };

// §2.4 / §2.10 shared ponytail record, plan lines 742-747.
const ponytailSchema = {
  type: "object",
  properties: {
    necessary: stringSchema,
    reuse: stringSchema,
    ladderRung: { enum: LADDER_RUNGS },
  },
  required: ["necessary", "reuse", "ladderRung"],
  additionalProperties: false,
};

// The §2.4 queue-item fields shared verbatim by §2.10's trivialItem
// ("a COMPLETE §2.4 queue item minus `id` and `dependsOn`", plan lines 937-939).
const itemCoreProperties: Record<string, unknown> = {
  title: stringSchema,
  rationale: stringSchema,
  fileScope: stringArraySchema,
  testScope: stringArraySchema,
  acceptance: stringArraySchema,
  behavioral: booleanSchema,
  ponytail: ponytailSchema,
};
const itemCoreRequired = [
  "title",
  "rationale",
  "fileScope",
  "testScope",
  "acceptance",
  "behavioral",
  "ponytail",
];

// §2.5 ledger-qualified evidence ref, plan lines 783-786.
const evidenceRefSchema = {
  type: "object",
  properties: { ledger: stringSchema, seq: numberSchema },
  required: ["ledger", "seq"],
  additionalProperties: false,
};

// §2.5 {reason, decisionId} annotation (deferred / inlineClaim), plan lines 778, 789.
const reasonDecisionOrNullSchema = {
  type: ["object", "null"],
  properties: { reason: stringSchema, decisionId: stringSchema },
  required: ["reason", "decisionId"],
  additionalProperties: false,
};

// §2.2 host/port pair, plan lines 642-643.
const hostPortSchema = {
  type: "object",
  properties: { host: stringSchema, port: numberSchema },
  required: ["host", "port"],
  additionalProperties: false,
};

// §2.10 per-criterion verdict, plan lines 959-964.
const criterionVerdictSchema = {
  type: "object",
  properties: { pass: booleanSchema, note: stringSchema },
  required: ["pass", "note"],
  additionalProperties: false,
};

// §2.1, plan lines 480-618.
const configSchema = {
  type: "object",
  properties: {
    version: numberSchema,
    verify: {
      type: "object",
      properties: {
        scopes: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              command: stringArraySchema,
              timeoutMs: numberSchema,
              itemTest: stringArraySchema,
            },
            required: ["command", "timeoutMs"],
            additionalProperties: false,
          },
        },
        behavioralPaths: stringArraySchema,
        requiredScopes: {
          type: "array",
          items: {
            type: "object",
            properties: { pattern: stringSchema, scopes: stringArraySchema },
            required: ["pattern", "scopes"],
            additionalProperties: false,
          },
        },
      },
      required: ["scopes", "behavioralPaths", "requiredScopes"],
      additionalProperties: false,
    },
    format: {
      type: "object",
      properties: {
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pattern: stringSchema,
              mode: { enum: FORMAT_MODES },
              command: stringArraySchema,
            },
            required: ["pattern", "mode", "command"],
            additionalProperties: false,
          },
        },
      },
      required: ["rules"],
      additionalProperties: false,
    },
    git: {
      type: "object",
      properties: {
        mode: { enum: GIT_MODES },
        branchPolicy: { enum: BRANCH_POLICIES },
        preexistingDirty: { enum: PREEXISTING_DIRTY_MODES },
      },
      required: ["mode", "branchPolicy", "preexistingDirty"],
      additionalProperties: false,
    },
    workflow: {
      type: "object",
      properties: {
        trivialMaxFiles: numberSchema,
        planReviewers: numberSchema,
        planReviewMaxRounds: numberSchema,
        itemReviewers: numberSchema,
        skepticsPerFinding: numberSchema,
        reviewMaxRounds: numberSchema,
        vetCritics: numberSchema,
        vetMaxRounds: numberSchema,
        testRepairAttempts: numberSchema,
        debugFixCap: numberSchema,
        maxOverridesPerItem: numberSchema,
        maxOverridesPerRun: numberSchema,
      },
      required: [
        "trivialMaxFiles",
        "planReviewers",
        "planReviewMaxRounds",
        "itemReviewers",
        "skepticsPerFinding",
        "reviewMaxRounds",
        "vetCritics",
        "vetMaxRounds",
        "testRepairAttempts",
        "debugFixCap",
        "maxOverridesPerItem",
        "maxOverridesPerRun",
      ],
      additionalProperties: false,
    },
    parallel: {
      type: "object",
      properties: {
        writes: { enum: PARALLEL_WRITE_MODES },
        maxImplementers: numberSchema,
        maxReaders: numberSchema,
        subSessionTimeoutMs: numberSchema,
      },
      required: ["writes", "maxImplementers", "maxReaders", "subSessionTimeoutMs"],
      additionalProperties: false,
    },
    models: {
      type: "object",
      properties: {
        default: stringSchema,
        roles: { type: "object", additionalProperties: stringSchema },
      },
      required: ["default", "roles"],
      additionalProperties: false,
    },
    ponytail: { enum: PONYTAIL_LEVELS },
    retention: {
      type: "object",
      properties: {
        keepRuns: numberSchema,
        maxRunDirBytes: numberSchema,
        pruneOnRunCreate: booleanSchema,
      },
      required: ["keepRuns", "maxRunDirBytes", "pruneOnRunCreate"],
      additionalProperties: false,
    },
    logging: {
      type: "object",
      properties: {
        level: logLevelSchema,
        components: { type: "object", additionalProperties: logLevelSchema },
      },
      required: ["level", "components"],
      additionalProperties: false,
    },
  },
  required: [
    "version",
    "verify",
    "format",
    "git",
    "workflow",
    "parallel",
    "models",
    "ponytail",
    "retention",
    "logging",
  ],
  additionalProperties: false,
};

// §2.2, plan lines 639-669.
const routerConfigSchema = {
  type: "object",
  properties: {
    version: numberSchema,
    listen: hostPortSchema,
    upstream: hostPortSchema,
    admission: {
      type: "object",
      properties: {
        maxInflightPerModel: numberSchema,
        maxQueued: numberSchema,
        queueTimeoutMs: numberSchema,
      },
      required: ["maxInflightPerModel", "maxQueued", "queueTimeoutMs"],
      additionalProperties: false,
    },
    priorities: {
      type: "object",
      properties: {
        interactive: numberSchema,
        review: numberSchema,
        batch: numberSchema,
      },
      required: ["interactive", "review", "batch"],
      additionalProperties: false,
    },
    affinity: {
      type: "object",
      properties: { header: stringSchema, contiguousDequeue: booleanSchema },
      required: ["header", "contiguousDequeue"],
      additionalProperties: false,
    },
    schema: {
      type: "object",
      properties: {
        observeHeader: stringSchema,
        validateResponses: booleanSchema,
        rejectOnMissing: booleanSchema,
      },
      required: ["observeHeader", "validateResponses", "rejectOnMissing"],
      additionalProperties: false,
    },
    metrics: {
      type: "object",
      properties: { ledgerPath: stringSchema },
      required: ["ledgerPath"],
      additionalProperties: false,
    },
    logging: {
      type: "object",
      properties: { level: logLevelSchema },
      required: ["level"],
      additionalProperties: false,
    },
  },
  required: [
    "version",
    "listen",
    "upstream",
    "admission",
    "priorities",
    "affinity",
    "schema",
    "metrics",
    "logging",
  ],
  additionalProperties: false,
};

// §2.3, plan lines 673-703.
const runSchema = {
  type: "object",
  properties: {
    runId: stringSchema,
    createdIso: stringSchema,
    prompt: stringSchema,
    sessionID: stringSchema,
    state: { enum: RUN_STATES },
    classification: {
      type: "object",
      properties: {
        kind: { enum: CLASSIFICATION_KINDS },
        rationale: stringSchema,
        check: {
          type: "object",
          properties: { agreed: booleanSchema, note: stringSchema },
          required: ["agreed", "note"],
          additionalProperties: false,
        },
      },
      required: ["kind", "rationale", "check"],
      additionalProperties: false,
    },
    startHead: stringSchema,
    startBranch: stringSchema,
    startDirty: stringArraySchema,
    excludedStaleRed: stringArraySchema,
    planReviewRounds: numberSchema,
    stop: {
      type: ["object", "null"],
      properties: {
        kind: { enum: STOP_KINDS },
        reasonDisplay: stringSchema,
        tsMs: numberSchema,
      },
      required: ["kind", "reasonDisplay", "tsMs"],
      additionalProperties: false,
    },
    counters: {
      type: "object",
      properties: {
        idleRePrompts: numberSchema,
        futileRePrompts: numberSchema,
        overridesUsed: numberSchema,
      },
      required: ["idleRePrompts", "futileRePrompts", "overridesUsed"],
      additionalProperties: false,
    },
  },
  required: [
    "runId",
    "createdIso",
    "prompt",
    "sessionID",
    "state",
    "classification",
    "startHead",
    "startBranch",
    "startDirty",
    "excludedStaleRed",
    "planReviewRounds",
    "stop",
    "counters",
  ],
  additionalProperties: false,
};

// §2.4, plan lines 715-751.
const queueItemSchema = {
  type: "object",
  properties: {
    id: stringSchema,
    ...itemCoreProperties,
    dependsOn: stringArraySchema,
  },
  required: ["id", ...itemCoreRequired, "dependsOn"],
  additionalProperties: false,
};

const queueSchema = {
  type: "object",
  properties: { items: { type: "array", items: queueItemSchema } },
  required: ["items"],
  additionalProperties: false,
};

// §2.5, plan lines 760-791.
const itemSchema = {
  type: "object",
  properties: {
    id: stringSchema,
    state: { enum: ITEM_STATES },
    assignee: stringOrNullSchema,
    worktree: stringOrNullSchema,
    attempts: {
      type: "object",
      properties: {
        green: numberSchema,
        reviewRounds: numberSchema,
        vetRounds: numberSchema,
        testRepairs: numberSchema,
        debugFixes: numberSchema,
        overridesUsed: numberSchema,
      },
      required: [
        "green",
        "reviewRounds",
        "vetRounds",
        "testRepairs",
        "debugFixes",
        "overridesUsed",
      ],
      additionalProperties: false,
    },
    blocked: {
      type: ["object", "null"],
      properties: {
        reason: stringSchema,
        sinceMs: numberSchema,
        questionId: stringSchema,
        stage: stringSchema,
      },
      required: ["reason", "sinceMs", "stage"],
      additionalProperties: false,
    },
    releasedQuestions: stringArraySchema,
    deferred: reasonDecisionOrNullSchema,
    debugging: {
      type: ["object", "null"],
      properties: { sinceMs: numberSchema, hypothesis: stringSchema },
      required: ["sinceMs", "hypothesis"],
      additionalProperties: false,
    },
    evidence: {
      type: "object",
      properties: {
        red: evidenceRefSchema,
        green: evidenceRefSchema,
        validated: evidenceRefSchema,
      },
      additionalProperties: false,
    },
    taint: { type: "array" },
    inlineClaim: reasonDecisionOrNullSchema,
  },
  required: [
    "id",
    "state",
    "assignee",
    "worktree",
    "attempts",
    "blocked",
    "deferred",
    "debugging",
    "evidence",
    "taint",
    "inlineClaim",
  ],
  additionalProperties: false,
};

// §2.6, plan lines 799-815. The three record kinds are a discriminated union in
// TS; the keyword subset has no combinator, so the schema carries the union of
// every kind's fields and requires only the four shared ones. The writer
// (adapter/evidence.ts, Task 6.1) owns the per-kind shape.
const evidenceRecordSchema = {
  type: "object",
  properties: {
    seq: numberSchema,
    ts: numberSchema,
    kind: { enum: EVIDENCE_KINDS },
    itemId: stringSchema,
    command: stringArraySchema,
    exitCode: numberSchema,
    failureExcerpt: stringSchema,
    failureClass: { enum: FAILURE_CLASSES },
    targeted: booleanSchema,
    startedMs: numberSchema,
    head: stringSchema,
    branch: stringSchema,
    tree: stringSchema,
    excluded: stringArraySchema,
    green: booleanSchema,
    scopes: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          green: booleanSchema,
          exitCode: numberSchema,
          durationMs: numberSchema,
        },
        required: ["green", "exitCode", "durationMs"],
        additionalProperties: false,
      },
    },
  },
  required: ["seq", "ts", "kind", "itemId"],
  additionalProperties: false,
};

// §2.7 scored option, plan lines 856-862. Shared verbatim by the persisted
// DecisionRecord and by §3.2's Plan decision PROPOSALS (single source: the two
// must agree on what a scored option is, or conductor_plan could mint a record
// its own ledger schema rejects).
const decisionOptionSchema = {
  type: "object",
  properties: {
    name: stringSchema,
    score: {
      type: "object",
      properties: {
        capability: numberSchema,
        testability: numberSchema,
        movingParts: numberSchema,
        validationEarliness: numberSchema,
        singleSource: numberSchema,
      },
      required: [
        "capability",
        "testability",
        "movingParts",
        "validationEarliness",
        "singleSource",
      ],
      additionalProperties: false,
    },
  },
  required: ["name"],
  additionalProperties: false,
};

// §2.7, plan lines 854-867. `score` is optional per record: options may omit
// numeric scores for kind:"human" questions (plan lines 872-874).
const decisionRecordSchema = {
  type: "object",
  properties: {
    id: stringSchema,
    tsIso: stringSchema,
    question: stringSchema,
    options: {
      type: "array",
      items: decisionOptionSchema,
    },
    choice: stringSchema,
    why: stringSchema,
    kind: { enum: DECISION_KINDS },
    appliedWhere: stringSchema,
  },
  required: ["id", "tsIso", "question", "options", "choice", "why", "kind", "appliedWhere"],
  additionalProperties: false,
};

// §3.2 PLANNED receipt (Task 9.2, plan lines 1112-1117 + 2584-2594): the
// planner's plan document plus the ≥2-option forks it wants recorded. These are
// PROPOSALS — no `id`, no `tsIso`; conductor_plan mints those when it appends
// each accepted proposal to decisions.jsonl, exactly as conductor_decide does.
// DERIVED from decisionRecordSchema rather than re-listed, so a field added to
// §2.7 cannot drift the proposal shape away from the ledger shape (the TS type
// is already Omit<DecisionRecord, "id" | "tsIso">). A hand-copied list would
// surface its drift only as the fan-out engine schema-rejecting well-formed
// plans, which is the worst place to discover it.
const PLAN_DECISION_MINTED = ["id", "tsIso"];
const planDecisionSchema = {
  type: "object",
  properties: Object.fromEntries(
    Object.entries(decisionRecordSchema.properties).filter(
      ([field]) => !PLAN_DECISION_MINTED.includes(field),
    ),
  ),
  required: decisionRecordSchema.required.filter((field) => !PLAN_DECISION_MINTED.includes(field)),
  additionalProperties: false,
};

const planSchema = {
  type: "object",
  properties: {
    markdown: stringSchema,
    decisions: { type: "array", items: planDecisionSchema },
  },
  required: ["markdown", "decisions"],
  additionalProperties: false,
};

// §2.8, plan lines 877-883. Same merged-union encoding as EvidenceRecord:
// only the shared {ts, kind} are required.
const anomalyRecordSchema = {
  type: "object",
  properties: {
    ts: numberSchema,
    kind: { enum: ANOMALY_KINDS },
    itemId: stringSchema,
    gate: stringSchema,
    reason: stringSchema,
    grantedAction: stringSchema,
    disposition: stringSchema,
    error: stringSchema,
    detail: stringSchema,
  },
  required: ["ts", "kind"],
  additionalProperties: false,
};

// §2.11, plan lines 984-993.
const questionRecordSchema = {
  type: "object",
  properties: {
    id: stringSchema,
    tsMs: numberSchema,
    runId: stringSchema,
    question: stringSchema,
    askedBy: {
      type: "object",
      properties: { role: stringSchema, sessionID: stringSchema },
      required: ["role", "sessionID"],
      additionalProperties: false,
    },
    humanTerritory: booleanSchema,
    origin: { enum: QUESTION_ORIGINS },
    blocksItems: stringArraySchema,
    answeredIso: stringOrNullSchema,
    answer: stringOrNullSchema,
  },
  required: [
    "id",
    "tsMs",
    "runId",
    "question",
    "askedBy",
    "humanTerritory",
    "origin",
    "blocksItems",
    "answeredIso",
    "answer",
  ],
  additionalProperties: false,
};

// §2.11, plan lines 1002-1008.
const staleRedRegistrySchema = {
  type: "object",
  properties: {
    version: numberSchema,
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: stringSchema,
          itemId: stringSchema,
          runId: stringSchema,
          sinceMs: numberSchema,
          reason: stringSchema,
        },
        required: ["path", "itemId", "runId", "sinceMs", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["version", "entries"],
  additionalProperties: false,
};

// §2.10 FINDINGS, plan lines 922-928.
const findingsSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: stringSchema,
          severity: { enum: SEVERITIES },
          lens: stringSchema,
          claim: stringSchema,
          evidence: stringSchema,
          suggestedFix: stringSchema,
        },
        required: ["id", "severity", "lens", "claim", "evidence", "suggestedFix"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

// §2.10 VERDICT, plan lines 930-932.
const verdictSchema = {
  type: "object",
  properties: {
    findingId: stringSchema,
    upheld: booleanSchema,
    reasoning: stringSchema,
  },
  required: ["findingId", "upheld", "reasoning"],
  additionalProperties: false,
};

// §2.10 CLASSIFICATION, plan lines 934-948. The schema admits trivialItem as
// null OR a complete queue item minus id/dependsOn; the kind<->trivialItem
// cross-field rule lives in `validate` (a subset schema cannot express it).
const classificationSchema = {
  type: "object",
  properties: {
    kind: { enum: CLASSIFICATION_KINDS },
    rationale: stringSchema,
    confidence: stringSchema,
    trivialItem: {
      type: ["object", "null"],
      properties: { ...itemCoreProperties },
      required: [...itemCoreRequired],
      additionalProperties: false,
    },
  },
  required: ["kind", "rationale", "confidence", "trivialItem"],
  additionalProperties: false,
};

// §2.10 CLASSIFICATION_CHECK, plan lines 950-954: correctedKind is null when
// agreed, otherwise one of the classification kinds.
const classificationCheckSchema = {
  type: "object",
  properties: {
    agreed: booleanSchema,
    correctedKind: { enum: [null, ...CLASSIFICATION_KINDS] },
    note: stringSchema,
  },
  required: ["agreed", "correctedKind", "note"],
  additionalProperties: false,
};

// §2.10 TEST_VET, plan lines 958-965.
const testVetSchema = {
  type: "object",
  properties: {
    verdictsByCriterion: {
      type: "object",
      properties: {
        observableBehavior: criterionVerdictSchema,
        wouldCatchWrongImpl: criterionVerdictSchema,
        rightLevel: criterionVerdictSchema,
        pinsAcceptance: criterionVerdictSchema,
        antiPatterns: criterionVerdictSchema,
      },
      required: [
        "observableBehavior",
        "wouldCatchWrongImpl",
        "rightLevel",
        "pinsAcceptance",
        "antiPatterns",
      ],
      additionalProperties: false,
    },
    mustFix: stringArraySchema,
  },
  required: ["verdictsByCriterion", "mustFix"],
  additionalProperties: false,
};

// §2.10 IMPLEMENTER RESULT, plan lines 967-970.
const implementerResultSchema = {
  type: "object",
  properties: {
    status: { enum: IMPLEMENTER_STATUSES },
    summary: stringSchema,
    concerns: stringArraySchema,
    neededContext: stringOrNullSchema,
    blockReason: stringOrNullSchema,
  },
  required: ["status", "summary", "concerns", "neededContext", "blockReason"],
  additionalProperties: false,
};

// §7.2, plan lines 1932-1939.
const journalRecordSchema = {
  type: "object",
  properties: {
    seq: numberSchema,
    ts: numberSchema,
    level: logLevelSchema,
    component: stringSchema,
    runId: stringSchema,
    itemId: stringSchema,
    sessionID: stringSchema,
    event: stringSchema,
    data: { type: "object" },
  },
  required: ["seq", "ts", "level", "component", "runId", "event", "data"],
  additionalProperties: false,
};

// Name -> schema. Deliberately a plain mutable record: tests register
// temporary schemas through it, and `validate` resolves names from it at call
// time. The fan-out engine passes these to session.prompt({format}) and
// tools/export-schemas.ts ships the same objects to the router tests
// (single source, two consumers — plan lines 470-476).
export const SCHEMAS: Record<string, unknown> = {
  Config: configSchema,
  RouterConfig: routerConfigSchema,
  Run: runSchema,
  Queue: queueSchema,
  Item: itemSchema,
  EvidenceRecord: evidenceRecordSchema,
  DecisionRecord: decisionRecordSchema,
  AnomalyRecord: anomalyRecordSchema,
  QuestionRecord: questionRecordSchema,
  StaleRedRegistry: staleRedRegistrySchema,
  Findings: findingsSchema,
  Verdict: verdictSchema,
  Classification: classificationSchema,
  ClassificationCheck: classificationCheckSchema,
  TestVet: testVetSchema,
  ImplementerResult: implementerResultSchema,
  JournalRecord: journalRecordSchema,
  Plan: planSchema,
};

// ---------------------------------------------------------------------------
// The minimal subset validator (plan lines 2065-2068)
// ---------------------------------------------------------------------------

const SUBSET_KEYWORDS = [
  "type",
  "required",
  "enum",
  "properties",
  "items",
  "additionalProperties",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Recursively police the keyword subset BEFORE validating any data: a keyword
// outside the subset is an error naming that keyword, at any depth, whether or
// not the value exercises that branch — never a silent ignore.
function scanKeywords(schema: unknown, path: string, errors: string[]): void {
  if (typeof schema === "boolean") return;
  if (!isRecord(schema)) {
    errors.push(`${path}: not a schema object`);
    return;
  }
  for (const [keyword, sub] of Object.entries(schema)) {
    if (!(SUBSET_KEYWORDS as readonly string[]).includes(keyword)) {
      errors.push(`${path}: schema keyword "${keyword}" is outside the validator subset`);
      continue;
    }
    if (keyword === "properties" && isRecord(sub)) {
      for (const [prop, propSchema] of Object.entries(sub)) {
        scanKeywords(propSchema, `${path}.properties.${prop}`, errors);
      }
    } else if (keyword === "items") {
      if (Array.isArray(sub)) {
        // Tuple-form items is 2020-12 prefixItems, which the router's full
        // validator (Task 11.6) implements and this subset does not — accepting
        // it here would let the two validators disagree about the same payload.
        errors.push(
          `${path}.items: items as a tuple array is outside the subset (2020-12 uses prefixItems)`,
        );
      } else {
        scanKeywords(sub, `${path}.items`, errors);
      }
    } else if (keyword === "additionalProperties" && typeof sub !== "boolean") {
      scanKeywords(sub, `${path}.additionalProperties`, errors);
    }
  }
}

function checkValue(schema: unknown, value: unknown, path: string, errors: string[]): void {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path}: schema false admits no value`);
    return;
  }
  if (!isRecord(schema)) return; // scanKeywords already reported the malformed schema
  const declaredType = schema["type"];
  if (declaredType !== undefined) {
    const allowed = Array.isArray(declaredType) ? declaredType : [declaredType];
    const actual = jsonTypeOf(value);
    if (!allowed.includes(actual)) {
      errors.push(`${path}: expected type ${allowed.join("|")}, got ${actual}`);
      return;
    }
  }
  const enumMembers = schema["enum"];
  if (Array.isArray(enumMembers) && !enumMembers.some((member) => member === value)) {
    errors.push(`${path}: value is not one of the enum members`);
    return;
  }
  if (isRecord(value)) {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !Object.hasOwn(value, name)) {
          errors.push(`${path}: missing required property "${name}"`);
        }
      }
    }
    const props = isRecord(schema["properties"]) ? schema["properties"] : undefined;
    const additional = schema["additionalProperties"];
    for (const [name, propValue] of Object.entries(value)) {
      if (props !== undefined && Object.hasOwn(props, name)) {
        checkValue(props[name], propValue, `${path}.${name}`, errors);
      } else if (additional === false) {
        errors.push(`${path}: unexpected additional property "${name}"`);
      } else if (additional !== undefined && additional !== true) {
        checkValue(additional, propValue, `${path}.${name}`, errors);
      }
    }
  } else if (Array.isArray(value)) {
    const items = schema["items"];
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length && i < value.length; i += 1) {
        checkValue(items[i], value[i], `${path}[${i}]`, errors);
      }
    } else if (items !== undefined) {
      for (let i = 0; i < value.length; i += 1) {
        checkValue(items, value[i], `${path}[${i}]`, errors);
      }
    }
  }
}

// validate(schemaName, value) — resolves the schema from SCHEMAS at call time,
// rejects any schema keyword outside the subset, then structurally validates.
// The §2.10 Classification cross-field rule (trivialItem REQUIRED non-null when
// kind = "trivial", null otherwise — plan lines 937, 2080-2081) is hand-coded
// here because no subset keyword can express it; the completeness half is the
// trivialItem subschema's own required list.
export function validate(schemaName: string, value: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Object.hasOwn(SCHEMAS, schemaName)) {
    return { ok: false, errors: [`no schema named "${schemaName}" is registered`] };
  }
  scanKeywords(SCHEMAS[schemaName], schemaName, errors);
  if (errors.length === 0) {
    checkValue(SCHEMAS[schemaName], value, schemaName, errors);
    if (schemaName === "Classification" && isRecord(value)) {
      const trivialItem = value["trivialItem"];
      if (value["kind"] === "trivial") {
        if (trivialItem === null || trivialItem === undefined) {
          errors.push('Classification: kind "trivial" requires a complete non-null trivialItem');
        }
      } else if (trivialItem !== null && trivialItem !== undefined) {
        errors.push('Classification: trivialItem must be null unless kind is "trivial"');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
