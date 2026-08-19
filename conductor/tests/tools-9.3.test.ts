// Task 9.3 RED tests — FINAL LOCATION conductor/tests/tools-9.3.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the ONE Phase-9 plan-review handler
// added to the EXISTING conductor/adapter/tools.ts (which today carries the §5.3 gate
// wiring + the Task-9.1 and Task-9.2 handlers). The red is the missing-export shape —
// tools.ts resolves, but the named binding below does not yet exist:
//   handlePlanReview
//
// The handler follows the §3.4 invariant loop — legality → derive → persist → journal →
// compact return — and (with the state store it delegates to) is the ONLY writer of
// run/item state (G6). It drives the plan-level adversarial loop (§3.2 PLAN_REVIEWED)
// through the injected Fanout (adapter/fanout.ts) over the FAKE SDK
// (tests/fixtures/fake-sdk.ts).
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.3 (2596-2604)  — the authoritative behaviour of the tool.
//   §3.2 (1119-1131)         — the four lenses, majors → skepticsPerFinding refuters,
//                              surviving majors ⇒ planner re-prompt + round++, exit on a
//                              clean round or at planReviewMaxRounds; at the cap each
//                              surviving major becomes a questions.jsonl record
//                              (origin "plan-review-cap") and every item its blocksItems
//                              names is set blocked:{questionId, reason, stage:"plan-review"};
//                              the run proceeds on the remaining items.
//   §2.10 (919-932)          — SCHEMAS.Findings / SCHEMAS.Verdict (already registered).
//   §2.11 (984-993)          — the question record; QUESTION_ORIGINS already carries
//                              "plan-review-cap" (no closed-vocabulary widening).
//   core/verdict.ts          — findingSurvives(verdicts, k): uphold count ≥ ⌈k/2⌉,
//                              TIE-UPHOLDS. Reused, never reimplemented.
//   core/schedule.ts         — readFanout("planReview", config) for the reviewer count.
//   docs/build/specs/task-9.3.assertions.json — the 8 rows mapped to the tests below,
//                              including the PINNED blocksItems mapping resolution.
//
// PINNED blocksItems mapping (the spec-gap resolution in task-9.3.assertions.json,
// followed exactly): §2.10 findings carry NO item reference, so the handler derives a
// cap-question's blocksItems by scanning the finding's claim+evidence for (a) known
// queue item ids and (b) file paths that intersect an item's fileScope via core
// scopesIntersect (core/shell-parse.ts). A finding that names neither still becomes a
// question record with blocksItems: [] and blocks nothing.
//
// PINNED round semantics (this file is the contract): `run.planReviewRounds` counts
// PLANNER REVISION rounds — it increments by exactly one each time a surviving major
// causes the planner to be re-prompted and the plan re-written (§3.2 "plan revised,
// round++"), and it is the `round` the handler hands the committed fsm-run.ts
// planReviewGate. That gate admits the cap exit only when round >= planReviewMaxRounds,
// so `planReviewMaxRounds` bounds REVISIONS: at the cap the handler has already revised
// `planReviewMaxRounds` times and re-reviewed the revised plan; only majors STILL
// surviving that re-review become cap questions. Concretely, with planReviewMaxRounds=1
// and bad-forever majors the loop is: review (4 reviewer prompts) → skeptics → survivors
// → revise (1 planner prompt, planReviewRounds=1) → re-review (4 more reviewer prompts)
// → skeptics → survivors → cap exit (questions + blocks + PLAN_REVIEWED). No revision
// happens AT the cap exit itself — the questions describe the plan as it stands.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). The input is a
// single options object; runDir is derived as <store.root>/.conductor/runs/<runId>/.
// `journal` is the leveled sink (adapter/journal.ts Journal-compatible); `now` defaults
// to Date.now. Legality: the run must be PLANNED. Compact return: `rounds` is the final
// run.planReviewRounds; `questionIds`/`blockedItemIds` are the cap products (both []
// on a clean exit).
//
//   // conductor_plan_review (§3.2) — fan out the FOUR lenses (role `reviewer`, schema
//   // "Findings", readFanout("planReview", config) sub-sessions, one lens-specific
//   // prompt each, every prompt carrying the plan AND the queue); give every `major`
//   // finding exactly config.workflow.skepticsPerFinding `skeptic` sub-sessions (schema
//   // "Verdict"); adjudicate survival with core findingSurvives; re-prompt the `planner`
//   // (schema "Plan") with the surviving findings, re-write plan.md, and increment
//   // run.planReviewRounds once per revision round; exit PLANNED→PLAN_REVIEWED on a
//   // clean round, or at the round cap convert each still-surviving major into a
//   // questions.jsonl record (origin "plan-review-cap", blocksItems per the pinned
//   // mapping above) + set blocked:{questionId, reason, stage:"plan-review"} on every
//   // named item — the run proceeds on the rest.
//   handlePlanReview(input: {
//     store: StateStore; fanout: Fanout; runId: string; config: Config;
//     journal: JournalSink; now?: () => number;
//   }): Promise<{ runState: RunState; rounds: number; questionIds: string[]; blockedItemIds: string[] }>
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id):
//   9.3-four-lenses              → four pairwise-different lens prompts, role reviewer,
//                                  fresh sessions, each sees the plan + the queue.
//   9.3-skeptics-per-major       → exactly skepticsPerFinding skeptics for the one major,
//                                  none for the minor/nit.
//   9.3-refuted-major-dies       → a refuted major triggers no re-prompt, no question,
//                                  no block.
//   9.3-surviving-major-reprompts→ one surviving major ⇒ one planner re-prompt naming the
//                                  claim, plan.md re-written, planReviewRounds +1, the
//                                  revised plan re-reviewed.
//   9.3-zero-majors-planned      → minors/nits only ⇒ PLAN_REVIEWED via fsm/transition.
//   9.3-round-cap-questions      → at the cap each surviving major becomes a schema-valid
//                                  §2.11 record, origin "plan-review-cap".
//   9.3-round-cap-blocks-items   → every blocksItems item is blocked — asserted by READING
//                                  THE PERSISTED ITEM FILES via store.loadItem.
//   9.3-round-cap-proceeds       → un-named items stay actionable; the run advances.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The SUBJECT — absent at red time (missing-export red from the existing tools.ts).
import { handlePlanReview } from "../adapter/tools.ts";

// Adapters + core that DO exist (Tasks 4.1 / 7.1 / 1.1 / 1.3 / 3.3 / 1.2).
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { validate } from "../core/types.ts";
import { findingBlocksItems } from "../core/planning.ts";
import type {
  Config,
  Findings,
  Item,
  Queue,
  QueueItem,
  QuestionRecord,
  RunState,
  Verdict,
  TreePath,
} from "../core/types.ts";
import { findingSurvives } from "../core/verdict.ts";
import { nextWave, readFanout } from "../core/schedule.ts";
import { scopesIntersect } from "../core/shell-parse.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// GAP-005: the plan-level dispatch prompts compose their doctrine slice out of the
// loaded pack map, so every handler call here carries the REAL packs, keyed by file
// name exactly as adapter/inject.ts loadPacks keys them.
const DOCTRINE_PACKS: Record<string, string> = {};
{
  const doctrineDir = new URL("../doctrine/", import.meta.url);
  for (const name of readdirSync(doctrineDir)) {
    if (name.endsWith(".md")) {
      DOCTRINE_PACKS[name] = readFileSync(new URL(name, doctrineDir), "utf8");
    }
  }
}

// The pinned compact-return shape (the header's contract, restated structurally so the
// call sites type-check the green implementation against it).
interface PlanReviewResult {
  runState: RunState;
  rounds: number;
  questionIds: string[];
  blockedItemIds: string[];
}

// ---------------------------------------------------------------------------
// Fixtures + helpers (the same harness shape as tools-9.1/9.2.test.ts).
// ---------------------------------------------------------------------------

// A fixed injected clock: the store reads OpenOptions.now for every stamped value.
const START_MS = 1_754_560_000_000;

// A leveled sink structurally compatible with adapter/journal.ts Journal (used for the
// store, the fan-out engine, and the handler) — captures every record for the journal
// assertions. Deliberately loose (level:string, runId?) so it assigns to both the
// StateJournal (runId optional) and the Journal (runId required) parameter shapes.
interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}
interface JournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
  flushSync: () => void;
}
function makeJournal(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

// A never-frozen §3.5 tree view (plan review runs readers only, so this only admits).
const OPEN_TREE: TreeState = {
  isFrozen(): boolean {
    return false;
  },
  onClear(): () => void {
    return () => undefined;
  },
};

// A complete §2.1 Config. planReviewers defaults to 4 — the §3.2 four-lens fan-out —
// with parallel.maxReaders 4, so readFanout("planReview", config) yields exactly 4
// (the sanity block below pins that premise). The knobs 9.3 exercises are
// parameterised; the rest are inert-but-valid defaults.
function makeConfig(
  opts: {
    planReviewers?: number;
    planReviewMaxRounds?: number;
    skepticsPerFinding?: number;
    modelDefault?: string;
    maxReaders?: number;
  } = {},
): Config {
  return {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: opts.planReviewers ?? 4,
      planReviewMaxRounds: opts.planReviewMaxRounds ?? 1,
      itemReviewers: 1,
      skepticsPerFinding: opts.skepticsPerFinding ?? 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: {
      writes: "off",
      maxImplementers: 4,
      maxReaders: opts.maxReaders ?? 4,
      subSessionTimeoutMs: 100_000,
    },
    models: { default: opts.modelDefault ?? "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// Temp-dir bookkeeping: each test creates its own workspace and removes it in its own
// finally; this after() is the backstop that guarantees nothing survives the run.
const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});
function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools93-"));
  tmpDirs.push(dir);
  return dir;
}

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

// The user's prompt — distinctive so the completeness lens can be asserted to carry it.
const USER_PROMPT = "add signed offset parsing to the beta parser";

// Create a run at INTAKE with a schema-valid `work` classification. Returns the run id.
function createIntakeRun(store: StateStore): string {
  const run = store.createRun({
    prompt: USER_PROMPT,
    sessionID: "ses_orchestrator",
    classification: { kind: "work", rationale: "intake placeholder", check: { agreed: true, note: "" } },
  });
  return run.runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

// A schema-valid §2.5 runtime Item at PENDING (seeding the PLANNED state).
function makeRuntimeItem(id: string): Item {
  return {
    id,
    state: "PENDING",
    assignee: null,
    worktree: null,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: {},
    taint: [],
    inlineClaim: null,
  };
}

// A schema-valid §2.4 queue item (behavioral, test-scoped, full-mode-legal ponytail).
function makeQueueItem(id: string, fileScope: string[], testScope: string[]): QueueItem {
  return {
    id,
    title: `pin the ${id} behaviour`,
    rationale: `the ${id} module's behaviour must be pinned before the change lands`,
    fileScope,
    testScope,
    acceptance: [`${id}'s subject rejects the malformed input with a named error`],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: `the ${id} change is required by the user's prompt`,
      reuse: "checked the existing modules; nothing covers this behaviour",
      ladderRung: "minimal-code",
    },
  };
}

// The two queue shapes the tests seed. Fresh objects per call (no shared mutation).
const I1_SCOPE = ["src/alpha/load.ts"];
const I2_SCOPE = ["src/beta/parse.ts"];
const I3_SCOPE = ["src/gamma/render.ts"];
function queueTwo(): Queue {
  return {
    items: [
      makeQueueItem("I1", [...I1_SCOPE], ["tests/alpha/load.test.ts"]),
      makeQueueItem("I2", [...I2_SCOPE], ["tests/beta/parse.test.ts"]),
    ],
  };
}
function queueThree(): Queue {
  const queue = queueTwo();
  queue.items.push(makeQueueItem("I3", [...I3_SCOPE], ["tests/gamma/render.test.ts"]));
  return queue;
}

// Drive a run to the PLANNED state WITHOUT calling the 9.1/9.2 handlers (direct on-disk
// seeding, the tools-9.2 seedDecomposed discipline): flip run.state, zero the round
// counter, write plan.md + a valid queue.json, seed one PENDING item per queue item.
function seedPlanned(store: StateStore, runId: string, queue: Queue, planMd: string): void {
  const run = store.loadRun(runId);
  run.state = "PLANNED";
  run.planReviewRounds = 0;
  store.saveRun(run);
  const runDir = runDirOf(store, runId);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  writeFileSync(path.join(runDir, "plan.md"), planMd);
  for (const qi of queue.items) store.saveItem(runId, makeRuntimeItem(qi.id));
}

// Plan documents. The BASELINE and REVISED markers are disjoint strings so "plan.md was
// re-written" is a two-sided assertion (revised marker present, baseline marker gone).
const PLAN_MARKER = "PLAN-DOC-BASELINE-4437";
const REVISED_MARKER = "PLAN-DOC-REVISED-9902";
const SEED_PLAN_MD =
  `## Plan ${PLAN_MARKER}\n\n` +
  "### Item I1 — src/alpha/load.ts\n" +
  "- Test strategy: assert load() rejects an unregistered schema with a named error.\n" +
  "- Implementation: read the config in load(), validating against the registered schema.\n\n" +
  "### Item I2 — src/beta/parse.ts\n" +
  "- Test strategy: assert parse() preserves the sign of negative offsets.\n" +
  "- Implementation: parse offsets with a signed reader.\n";
const REVISED_PLAN_MD =
  `## Plan ${REVISED_MARKER}\n\n` +
  "### Item I1 — src/alpha/load.ts\n" +
  "- Test strategy: assert load() rejects an unregistered schema with a named error.\n" +
  "- Implementation: registerSchema() first, then load() reads and validates the config.\n";

// §2.10 finding fixtures.
type Finding = Findings["findings"][number];
function makeFinding(
  id: string,
  severity: Finding["severity"],
  lens: string,
  claim: string,
  evidence: string,
): Finding {
  return { id, severity, lens, claim, evidence, suggestedFix: `address the defect: ${claim}` };
}
function findingsJson(findings: Finding[]): string {
  return JSON.stringify({ findings });
}
const EMPTY_FINDINGS = findingsJson([]);

// §2.10 verdict fixtures. GAP-036: a refutation counts as one only when it carries
// its evidence (discriminating input, run, reading); `upheld:false` without that is
// an ABSTENTION, and an abstention upholds. Every overturn here is an evidenced
// one, so these rows keep asserting what they always asserted.
const PLAN_REFUTATION_EVIDENCE = {
  discriminatingInput: "the plan section the claim says is missing",
  run: "re-read the section and the queue item it maps to",
  reading: "the section states it, so the claimed omission does not hold",
};
function verdictJson(findingId: string, upheld: boolean): string {
  const verdict: Verdict = {
    findingId,
    upheld,
    reasoning: upheld
      ? "the claim stands: the cited defect is real and unmitigated"
      : "the claim mis-reads the plan; the cited case is already handled",
    refutationEvidence: upheld ? null : PLAN_REFUTATION_EVIDENCE,
  };
  return JSON.stringify(verdict);
}
function verdicts(...upholds: boolean[]): Verdict[] {
  return upholds.map((upheld, i) => ({
    findingId: "F",
    upheld,
    reasoning: `skeptic ${i}`,
    refutationEvidence: upheld ? null : PLAN_REFUTATION_EVIDENCE,
  }));
}

// The §3.2 "Plan" receipt for the planner revision re-prompt (schema registered by 9.2).
function planJson(markdown: string): string {
  return JSON.stringify({ markdown, decisions: [] });
}

// The claims. Each cap major exercises ONE arm of the pinned blocksItems mapping:
//   MAJ-ID   names queue item id I1 in its claim              → blocksItems ["I1"]
//   MAJ-PATH names a literal path inside I2's fileScope in its evidence → ["I2"]
//   MAJ-NONE names neither                                     → blocksItems []
const CLAIM_ID = "item I1 loads the config before its schema is registered";
const EV_ID = "the plan's 'Load order' section places load() ahead of registerSchema(), so the first call throws";
const CLAIM_PATH = "two queue items edit the same parser translation unit in one wave";
const EV_PATH = "src/beta/parse.ts appears in two overlapping fileScopes, so the wave must serialize on it";
const CLAIM_NONE = "the rollback strategy for the data migration is absent";
const EV_NONE = "the plan's 'Migration' section promises deletion before any backup is verified";
function capFindings(): Finding[] {
  return [
    makeFinding("MAJ-ID", "major", "correctness", CLAIM_ID, EV_ID),
    makeFinding("MAJ-PATH", "major", "decomposition", CLAIM_PATH, EV_PATH),
    makeFinding("MAJ-NONE", "major", "completeness", CLAIM_NONE, EV_NONE),
  ];
}

// The single-major claims for the skeptic-count / dies / survives tests.
const MAJOR_CLAIM = "the wave order serializes both parser edits behind an unrelated docs step";
const MINOR_CLAIM = "the risk section understates the migration window";
const NIT_CLAIM = "two plan headings use inconsistent capitalization";
const CLAIM_DEAD = "item I1 misreads the retry guard as unbounded";
const EV_DEAD = "the guard on line 42 already caps retries at three";
const CLAIM_LIVE = "the plan validates the config only after first use instead of at load time";
const EV_LIVE = "the plan's 'Load order' section defers validation until the first read";

// Build a Fanout over the fake SDK with a PER-ROLE reply script: each NEW sub-session of
// a role is assigned the next canned reply for THAT role (in first-prompt order),
// clamping to the last so a bad-forever stream drives the round-cap path; retries within
// a session re-serve the same reply (all replies here are schema-valid, so the engine
// never retries — one prompt per sub-session, which is what the count pins read). A
// reply may be a function of the prompt text (the cap skeptics use it to echo back the
// finding id the prompt names). An UNSCRIPTED role replies with unparseable text so a
// stray dispatch env-fails loudly instead of silently succeeding. Records every prompt's
// {role, text, sessionID} in arrival order for the role/ordering assertions.
type CannedReply = string | ((promptText: string) => string);
interface RoleScript {
  reviewer: CannedReply[];
  skeptic: CannedReply[];
  planner: CannedReply[];
}
interface PromptedRecord {
  role: string;
  text: string;
  sessionID: string;
}
function makeReviewFanout(
  runId: string,
  config: Config,
  journal: JournalSink,
  script: RoleScript,
): {
  fanout: Fanout;
  sdk: ReturnType<typeof makeFakeSdk>;
  prompted: PromptedRecord[];
  byRole: (role: string) => PromptedRecord[];
} {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    prompted.push({ role, text: req.text, sessionID: req.sessionID });
    const queue =
      role === "reviewer"
        ? script.reviewer
        : role === "skeptic"
          ? script.skeptic
          : role === "planner"
            ? script.planner
            : [];
    if (queue.length === 0) {
      return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    }
    let idx = sessionIdx.get(req.sessionID);
    if (idx === undefined) {
      idx = nextByRole.get(role) ?? 0;
      nextByRole.set(role, idx + 1);
      sessionIdx.set(req.sessionID, idx);
    }
    const canned = queue[Math.min(idx, queue.length - 1)];
    const text = typeof canned === "function" ? canned(req.text) : canned;
    return { kind: "reply", text };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );
  return {
    fanout,
    sdk,
    prompted,
    byRole: (role: string) => prompted.filter((p) => p.role === role),
  };
}

// The four §3.2 lenses as name patterns: each of the four reviewer prompts must match
// EXACTLY ONE of these, and the four matches must be four different prompts. Lens (d)
// is matched on "minimality" alone — every prompt carries the raw §2.4 queue, whose
// items all contain the literal key "ponytail", so that word cannot discriminate.
const LENS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "(a) correctness/design soundness", re: /correctness/i },
  { name: "(b) completeness vs the user's prompt", re: /completeness/i },
  { name: "(c) decomposition quality", re: /decomposition/i },
  { name: "(d) minimality/ponytail", re: /minimality/i },
];

function findQuestion(questions: QuestionRecord[], claimFragment: string, ctx: string): QuestionRecord {
  const found = questions.filter((q) => q.question.includes(claimFragment));
  assert.equal(found.length, 1, `${ctx}: exactly one cap question carries the claim "${claimFragment}"`);
  return found[0];
}

// ---------------------------------------------------------------------------
// Fixture sanity: every canned payload must satisfy the schema the fan-out engine
// validates it against (or a red would be a fixture bug, not a handler bug), the skeptic
// fixtures must mean what the tests say under core findingSurvives (⌈k/2⌉, TIE-UPHOLDS),
// the reviewer count premise must hold, and the pinned blocksItems mapping premises must
// be mechanically true of the fixture texts. (Same discipline as 9.1/9.2's probe blocks.)
// ---------------------------------------------------------------------------
assert.equal(validate("Queue", queueThree()).ok, true, "sanity: the queue fixture satisfies SCHEMAS.Queue");
assert.equal(
  validate("Findings", JSON.parse(findingsJson(capFindings())) as unknown).ok,
  true,
  "sanity: the cap findings fixture satisfies SCHEMAS.Findings",
);
assert.equal(
  validate("Findings", JSON.parse(EMPTY_FINDINGS) as unknown).ok,
  true,
  "sanity: an empty findings list satisfies SCHEMAS.Findings",
);
assert.equal(
  validate("Verdict", JSON.parse(verdictJson("MAJ-ID", true)) as unknown).ok,
  true,
  "sanity: the verdict fixture satisfies SCHEMAS.Verdict",
);
assert.equal(
  validate("Plan", JSON.parse(planJson(REVISED_PLAN_MD)) as unknown).ok,
  true,
  "sanity: the revised-plan fixture satisfies SCHEMAS.Plan",
);
// findingSurvives premises (core semantics, never reimplemented here):
assert.equal(findingSurvives(verdicts(true), 1), true, "sanity: k=1, one uphold survives (⌈1/2⌉=1)");
assert.equal(findingSurvives(verdicts(true, false), 2), true, "sanity: k=2, a 1-1 TIE UPHOLDS (⌈2/2⌉=1)");
assert.equal(findingSurvives(verdicts(true, false, false), 3), false, "sanity: k=3, one uphold dies (⌈3/2⌉=2)");
assert.equal(findingSurvives(verdicts(false, false, false), 3), false, "sanity: k=3, zero upholds dies");
// The four-lens fan-out premise: readFanout("planReview", config) = 4 under this config.
assert.equal(readFanout("planReview", makeConfig()), 4, "sanity: the configured plan-review fan-out is the four lenses");
// The pinned blocksItems mapping premises: MAJ-PATH's path hits exactly I2's fileScope;
assert.equal(scopesIntersect(["src/beta/parse.ts"], I2_SCOPE), true, "sanity: the MAJ-PATH path intersects I2's fileScope");
assert.equal(scopesIntersect(["src/beta/parse.ts"], I1_SCOPE), false, "sanity: the MAJ-PATH path is disjoint from I1's fileScope");
assert.equal(scopesIntersect(["src/beta/parse.ts"], I3_SCOPE), false, "sanity: the MAJ-PATH path is disjoint from I3's fileScope");
// MAJ-ID's texts carry the id and no path; MAJ-PATH's carry the path and no id; MAJ-NONE's carry neither.
assert.ok(CLAIM_ID.includes("I1") && !CLAIM_ID.includes("/") && !EV_ID.includes("/"), "sanity: MAJ-ID names only the item id");
for (const text of [CLAIM_PATH, EV_PATH, CLAIM_NONE, EV_NONE]) {
  assert.ok(
    !text.includes("I1") && !text.includes("I2") && !text.includes("I3"),
    `sanity: no accidental item id in the fixture text "${text}"`,
  );
}
assert.ok(EV_PATH.includes("src/beta/parse.ts"), "sanity: MAJ-PATH's evidence carries the literal fileScope path");
assert.ok(!CLAIM_NONE.includes("/") && !EV_NONE.includes("/"), "sanity: MAJ-NONE carries no path-like token");

// ===========================================================================
// [9.3-four-lenses]
// ===========================================================================

test("[9.3-four-lenses] fans out the four §3.2 lenses as fresh reviewer sub-sessions — four pairwise-different lens-naming prompts, each seeing the plan AND the queue", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueTwo(), SEED_PLAN_MD);

    // A clean round: every lens reports zero findings, so the ONLY dispatches are the
    // four reviewers (skeptic/planner scripts are empty ⇒ a stray dispatch fails loudly).
    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [EMPTY_FINDINGS],
      skeptic: [],
      planner: [],
    });

    const res: PlanReviewResult = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    // Exactly the four lens sub-sessions were dispatched — all role `reviewer`, each a
    // FRESH session prompted exactly once, and nothing else was prompted at all.
    const reviewers = wiring.byRole("reviewer");
    assert.equal(reviewers.length, 4, "exactly four reviewer prompts (one per §3.2 lens)");
    assert.equal(wiring.prompted.length, 4, "no other role was prompted in a clean round");
    assert.equal(wiring.sdk.creates.length, 4, "each lens gets its own FRESH sub-session");
    const perSession = new Map<string, number>();
    for (const p of reviewers) perSession.set(p.sessionID, (perSession.get(p.sessionID) ?? 0) + 1);
    assert.equal(perSession.size, 4, "the four reviewer prompts land on four distinct sessions");
    for (const [sessionID, count] of perSession) {
      assert.equal(count, 1, `reviewer session ${sessionID} carries exactly ONE lens-specific prompt`);
    }
    assert.ok(
      wiring.sdk.prompts.every((p) => p.hasFormatField === false),
      "structured output is prompt-shaped + independently validated (no native `format` field — Task 0.2 DRIFT)",
    );

    // The four prompts are pairwise DIFFERENT and each names its OWN lens: every lens
    // pattern matches exactly one prompt, and the four matches are four different prompts.
    const texts = reviewers.map((p) => p.text);
    assert.equal(new Set(texts).size, 4, "the four lens prompts are pairwise different");
    const matchedTexts: string[] = [];
    for (const lens of LENS_PATTERNS) {
      const matches = texts.filter((t) => lens.re.test(t));
      assert.equal(matches.length, 1, `lens ${lens.name} is named by exactly one prompt`);
      matchedTexts.push(matches[0]);
    }
    assert.equal(new Set(matchedTexts).size, 4, "the four lens patterns map onto four DIFFERENT prompts");

    // Every dispatch sees the plan AND the queue (ids + write scopes — lens (c) judges
    // scope disjointness, so the queue must ride along whole).
    for (const t of texts) {
      assert.ok(t.includes(PLAN_MARKER), "every lens prompt carries the plan document");
      assert.ok(t.includes("I1") && t.includes("I2"), "every lens prompt carries the queue's item ids");
      assert.ok(t.includes("src/alpha/load.ts") && t.includes("src/beta/parse.ts"), "every lens prompt carries the queue's fileScopes");
    }
    // Lens (b) is completeness VS THE USER'S PROMPT with the placeholder scan folded in.
    const completeness = texts.find((t) => /completeness/i.test(t)) as string;
    assert.ok(completeness.includes(USER_PROMPT), "the completeness lens prompt carries the user's prompt");
    assert.ok(/placeholder/i.test(completeness), "the completeness lens folds in the placeholder scan");

    assert.equal(res.runState, "PLAN_REVIEWED", "a clean round advances PLANNED→PLAN_REVIEWED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.3-skeptics-per-major]
// ===========================================================================

test("[9.3-skeptics-per-major] every major gets exactly config.workflow.skepticsPerFinding skeptic sub-sessions; minors and nits get none", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ skepticsPerFinding: 3 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueTwo(), SEED_PLAN_MD);

    // One reviewer reports a major + a minor + a nit; the rest report nothing. All three
    // skeptics refute the major (0 upholds < ⌈3/2⌉ = 2 — sanity-pinned above), so the
    // round ends clean and the ONLY skeptic traffic is the per-major dispatch itself.
    const major = makeFinding("MAJ-1", "major", "decomposition", MAJOR_CLAIM, "the queue's ordering section shows the serialization");
    const minor = makeFinding("MIN-1", "minor", "completeness", MINOR_CLAIM, "the risk table lists a two-day window");
    const nit = makeFinding("NIT-1", "nit", "minimality", NIT_CLAIM, "the two section headings differ in case only");
    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [findingsJson([major, minor, nit]), EMPTY_FINDINGS],
      skeptic: [verdictJson("MAJ-1", false)],
      planner: [],
    });

    const res: PlanReviewResult = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    assert.equal(wiring.byRole("reviewer").length, 4, "one review round: four lens prompts");
    const skeptics = wiring.byRole("skeptic");
    assert.equal(skeptics.length, 3, "the ONE major gets exactly skepticsPerFinding (3) skeptic dispatches");

    // Counted per finding id on the fake's recorded prompts: all three skeptic prompts
    // interrogate MAJ-1 (id + claim), and none so much as mentions the minor or the nit.
    assert.equal(
      skeptics.filter((p) => p.text.includes("MAJ-1")).length,
      3,
      "every skeptic prompt names the major finding's id",
    );
    for (const p of skeptics) {
      assert.ok(p.text.includes(MAJOR_CLAIM), "every skeptic prompt carries the major's claim to refute");
      assert.ok(!p.text.includes("MIN-1") && !p.text.includes(MINOR_CLAIM), "no skeptic prompt names the minor");
      assert.ok(!p.text.includes("NIT-1") && !p.text.includes(NIT_CLAIM), "no skeptic prompt names the nit");
    }
    const skepticSessions = new Set(skeptics.map((p) => p.sessionID));
    assert.equal(skepticSessions.size, 3, "each skeptic is its own fresh sub-session");

    assert.equal(wiring.byRole("planner").length, 0, "a refuted major re-prompts no planner");
    assert.equal(res.runState, "PLAN_REVIEWED", "with the major refuted, the round is clean → PLAN_REVIEWED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.3-refuted-major-dies]
// ===========================================================================

test("[9.3-refuted-major-dies] a major refuted below the findingSurvives threshold triggers no planner re-prompt, mints no question, and blocks nothing", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ skepticsPerFinding: 3, planReviewMaxRounds: 1 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueTwo(), SEED_PLAN_MD);
    const runDir = runDirOf(store, runId);

    // The major NAMES item I1 in its claim, so if it wrongly survived to a cap it would
    // have to block I1 — its death is therefore observable as I1 staying unblocked.
    // Verdicts: 1 uphold vs 2 refutes < ⌈3/2⌉ = 2 (sanity-pinned above) ⇒ the major dies.
    const major = makeFinding("MAJ-DEAD", "major", "correctness", CLAIM_DEAD, EV_DEAD);
    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [findingsJson([major]), EMPTY_FINDINGS],
      skeptic: [verdictJson("MAJ-DEAD", true), verdictJson("MAJ-DEAD", false), verdictJson("MAJ-DEAD", false)],
      planner: [],
    });

    const res: PlanReviewResult = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    // The death was ADJUDICATED (three skeptics really ran), not skipped.
    assert.equal(wiring.byRole("skeptic").length, 3, "all three skeptics were dispatched before the major died");
    assert.equal(wiring.byRole("reviewer").length, 4, "one review round sufficed");

    // No planner re-prompt…
    assert.equal(wiring.byRole("planner").length, 0, "a refuted major triggers NO planner re-prompt");
    assert.equal(res.rounds, 0, "no revision round was consumed");
    // …and at the cap: no question, no block.
    assert.equal(readQuestions(runDir).length, 0, "a refuted major produces NO question record");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "the item the dead claim NAMED stays unblocked");
    assert.equal(store.loadItem(runId, "I2").blocked, null, "no other item is blocked either");
    assert.deepEqual(res.questionIds, [], "the compact return carries no question ids");
    assert.deepEqual(res.blockedItemIds, [], "the compact return carries no blocked items");

    const run = store.loadRun(runId);
    assert.equal(run.state, "PLAN_REVIEWED", "zero SURVIVING majors is a clean round → PLAN_REVIEWED");
    assert.equal(run.planReviewRounds, 0, "run.planReviewRounds is untouched (no revision happened)");
    const planMd = readFileSync(path.join(runDir, "plan.md"), "utf8");
    assert.ok(planMd.includes(PLAN_MARKER) && !planMd.includes(REVISED_MARKER), "plan.md was NOT rewritten");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.3-surviving-major-reprompts]
// ===========================================================================

test("[9.3-surviving-major-reprompts] a surviving major re-prompts the planner with the findings (naming the claim), the plan is re-written, planReviewRounds increments by exactly one, and the REVISED plan is re-reviewed", async () => {
  const root = scratchDir();
  try {
    // Cap 2 so the clean exit below is provably exit-on-clean, not exit-at-cap.
    const config = makeConfig({ skepticsPerFinding: 2, planReviewMaxRounds: 2 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueTwo(), SEED_PLAN_MD);
    const runDir = runDirOf(store, runId);

    // Round 1: one lens reports MAJ-LIVE; the skeptics split 1-1 and a TIE UPHOLDS at
    // k=2 (⌈2/2⌉ = 1, sanity-pinned above) ⇒ the major SURVIVES ⇒ planner revision.
    // Round 2 (the revised plan): every lens reports zero findings ⇒ clean exit.
    const major = makeFinding("MAJ-LIVE", "major", "correctness", CLAIM_LIVE, EV_LIVE);
    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [findingsJson([major]), EMPTY_FINDINGS],
      skeptic: [verdictJson("MAJ-LIVE", true), verdictJson("MAJ-LIVE", false)],
      planner: [planJson(REVISED_PLAN_MD)],
    });

    const res: PlanReviewResult = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    // EXACT prompt counts for the bounded loop: 4 lens prompts per round × 2 rounds,
    // 2 skeptics (round 1's tie), and exactly ONE planner re-prompt.
    const reviewers = wiring.byRole("reviewer");
    const planners = wiring.byRole("planner");
    assert.equal(reviewers.length, 8, "two review rounds: exactly 4 + 4 lens prompts");
    assert.equal(wiring.byRole("skeptic").length, 2, "round 1's major got its two skeptics; round 2 had no majors");
    assert.equal(planners.length, 1, "the surviving major re-prompts the planner exactly ONCE");

    // The re-prompt carries the surviving finding by claim.
    assert.ok(planners[0].text.includes(CLAIM_LIVE), "the planner re-prompt NAMES the surviving claim");

    // Ordering: all of round 1's four lens prompts precede the planner re-prompt, and
    // all of round 2's four follow it.
    const plannerAt = wiring.prompted.findIndex((p) => p.role === "planner");
    const reviewerIdxs = wiring.prompted
      .map((p, i) => (p.role === "reviewer" ? i : -1))
      .filter((i) => i !== -1);
    assert.equal(reviewerIdxs.filter((i) => i < plannerAt).length, 4, "round 1's four lens prompts precede the re-prompt");
    assert.equal(reviewerIdxs.filter((i) => i > plannerAt).length, 4, "round 2's four lens prompts follow the re-prompt");

    // The plan was revised and RE-WRITTEN: plan.md is the planner's revision now…
    const planMd = readFileSync(path.join(runDir, "plan.md"), "utf8");
    assert.ok(planMd.includes(REVISED_MARKER), "plan.md carries the revised plan");
    assert.ok(!planMd.includes(PLAN_MARKER), "the baseline plan text is gone (re-written, not appended)");
    // …and round 2 reviewed the REVISED plan, not a stale copy.
    for (const p of reviewers.slice(0, 4)) {
      assert.ok(p.text.includes(PLAN_MARKER), "round 1's lenses saw the baseline plan");
    }
    for (const p of reviewers.slice(4)) {
      assert.ok(p.text.includes(REVISED_MARKER), "round 2's lenses see the REVISED plan");
      assert.ok(!p.text.includes(PLAN_MARKER), "round 2's lenses no longer see the baseline plan");
    }

    // round++ exactly once per revision round.
    const run = store.loadRun(runId);
    assert.equal(run.planReviewRounds, 1, "run.planReviewRounds incremented by exactly one for the one revision round");
    assert.equal(res.rounds, 1, "the compact return reports the same round count");

    // The exit was clean, not a cap: PLAN_REVIEWED with no questions and no blocks.
    assert.equal(run.state, "PLAN_REVIEWED", "the clean round after revision advances PLANNED→PLAN_REVIEWED");
    assert.equal(res.runState, "PLAN_REVIEWED", "the compact return reports the advance");
    assert.equal(readQuestions(runDir).length, 0, "a clean exit writes no cap questions");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "a clean exit blocks nothing (I1)");
    assert.equal(store.loadItem(runId, "I2").blocked, null, "a clean exit blocks nothing (I2)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.3-zero-majors-planned]
// ===========================================================================

test("[9.3-zero-majors-planned] a round with zero surviving majors (minors/nits only) exits the loop and advances to PLAN_REVIEWED through the fsm/transition event", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueTwo(), SEED_PLAN_MD);
    const runDir = runDirOf(store, runId);

    // Findings exist — a minor and a nit — but no major, so nothing gates the exit.
    const minor = makeFinding("MIN-Z", "minor", "completeness", MINOR_CLAIM, "the risk table lists a two-day window");
    const nit = makeFinding("NIT-Z", "nit", "minimality", NIT_CLAIM, "the two section headings differ in case only");
    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [findingsJson([minor, nit]), EMPTY_FINDINGS],
      skeptic: [],
      planner: [],
    });

    const res: PlanReviewResult = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    assert.equal(wiring.byRole("reviewer").length, 4, "one review round: four lens prompts");
    assert.equal(wiring.byRole("skeptic").length, 0, "minors/nits dispatch NO skeptics");
    assert.equal(wiring.byRole("planner").length, 0, "zero majors re-prompt no planner");

    assert.equal(res.runState, "PLAN_REVIEWED", "zero surviving majors exits the loop → PLAN_REVIEWED");
    assert.equal(res.rounds, 0, "no revision round was consumed");
    assert.deepEqual(res.questionIds, [], "no cap questions on a clean exit");
    assert.deepEqual(res.blockedItemIds, [], "no blocks on a clean exit");

    const run = store.loadRun(runId);
    assert.equal(run.state, "PLAN_REVIEWED", "the persisted run is PLAN_REVIEWED");
    assert.equal(run.planReviewRounds, 0, "planReviewRounds is untouched");
    assert.equal(readQuestions(runDir).length, 0, "questions.jsonl stays empty");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "no item was blocked (I1)");
    assert.equal(store.loadItem(runId, "I2").blocked, null, "no item was blocked (I2)");

    // The transition is journaled through the EXISTING closed-vocabulary event —
    // component "fsm", event "transition" (core/journal-events.ts EVENTS) — naming
    // the PLAN_REVIEWED target.
    assert.ok(
      journal.records.some(
        (r) => r.component === "fsm" && r.event === "transition" && JSON.stringify(r).includes("PLAN_REVIEWED"),
      ),
      "the PLANNED→PLAN_REVIEWED transition is journaled via fsm/transition",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// The round-cap scenario (shared driver for the three cap assertions; each test drives
// its own workspace). Cap 1, k=1 skeptics that UPHOLD every major (⌈1/2⌉ = 1 — sanity-
// pinned above), reviewers that report the same three majors EVERY round (bad-forever):
//   round 1: 4 lens prompts → 3 majors → 3 upholding skeptics → survivors
//   revision: 1 planner prompt (planReviewRounds = 1), plan re-written
//   round 2: 4 lens prompts on the revised plan → same 3 majors → 3 skeptics → survivors
//   cap:     planReviewRounds (1) >= planReviewMaxRounds (1) ⇒ each surviving major
//            becomes a §2.11 question (origin "plan-review-cap"), every item its
//            blocksItems names is blocked, the run proceeds on the rest → PLAN_REVIEWED.
// The cap skeptic reply is a FUNCTION of the prompt text: it upholds whichever major id
// the prompt names, so verdict↔finding association never depends on dispatch order.
// ===========================================================================

interface CapDrive {
  config: Config;
  store: StateStore;
  runId: string;
  runDir: string;
  res: PlanReviewResult;
  questions: QuestionRecord[];
}

async function driveRoundCap(root: string): Promise<CapDrive> {
  const config = makeConfig({ skepticsPerFinding: 1, planReviewMaxRounds: 1 });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createIntakeRun(store);
  seedPlanned(store, runId, queueThree(), SEED_PLAN_MD);

  const capReply = findingsJson(capFindings());
  const wiring = makeReviewFanout(runId, config, journal.sink, {
    // Per-round assignment: round 1's four reviewer sessions take indices 0-3 (one
    // reports the majors), round 2's take 4-7 (index 4 reports them again; the rest
    // clamp to the trailing EMPTY) — majors survive EVERY round, forcing the cap.
    reviewer: [capReply, EMPTY_FINDINGS, EMPTY_FINDINGS, EMPTY_FINDINGS, capReply, EMPTY_FINDINGS],
    skeptic: [
      (promptText: string): string => {
        const id = ["MAJ-ID", "MAJ-PATH", "MAJ-NONE"].find((f) => promptText.includes(f)) ?? "MAJ-UNMATCHED";
        return verdictJson(id, true);
      },
    ],
    planner: [planJson(REVISED_PLAN_MD)],
  });

  const res: PlanReviewResult = await handlePlanReview({
    store,
    fanout: wiring.fanout,
    runId,
    config,
    journal: journal.sink,
    packs: DOCTRINE_PACKS,
    now: () => START_MS,
  });

  // The EXACT bounded-loop prompt counts (pinned in every cap drive): one revision at
  // cap 1, two review rounds around it, three upholding skeptics per round.
  assert.equal(wiring.byRole("planner").length, 1, "cap drive: exactly ONE planner revision (planReviewMaxRounds = 1)");
  assert.equal(wiring.byRole("reviewer").length, 8, "cap drive: exactly two review rounds of four lens prompts");
  assert.equal(wiring.byRole("skeptic").length, 6, "cap drive: three majors × one skeptic × two rounds");
  assert.equal(store.loadRun(runId).planReviewRounds, 1, "cap drive: planReviewRounds sits AT the cap");
  assert.equal(res.rounds, 1, "cap drive: the compact return reports the capped round count");

  const runDir = runDirOf(store, runId);
  return { config, store, runId, runDir, res, questions: readQuestions(runDir) };
}

// ===========================================================================
// [9.3-round-cap-questions]
// ===========================================================================

test("[9.3-round-cap-questions] at the round cap every surviving major is written to questions.jsonl as a schema-valid §2.11 record with origin 'plan-review-cap' carrying its claim", async () => {
  const root = scratchDir();
  try {
    const ctx = await driveRoundCap(root);

    assert.equal(ctx.questions.length, 3, "EACH of the three surviving majors became exactly one question");
    for (const q of ctx.questions) {
      assert.equal(validate("QuestionRecord", q).ok, true, "every cap question is a schema-valid §2.11 record");
      assert.equal(q.origin, "plan-review-cap", "every cap question carries origin exactly 'plan-review-cap'");
      assert.ok(q.question.length > 0, "every cap question has non-empty question text");
      assert.equal(q.answeredIso, null, "every cap question starts open");
      assert.equal(q.runId, ctx.runId, "every cap question names its run");
    }

    // One question per surviving major, each carrying THAT major's claim, with the
    // blocksItems the PINNED mapping derives: id-in-claim → ["I1"]; literal path in
    // evidence intersecting I2's fileScope (core scopesIntersect) → ["I2"]; a major
    // naming neither → blocksItems [] (it still becomes a question, blocks nothing).
    const qId = findQuestion(ctx.questions, CLAIM_ID, "MAJ-ID");
    const qPath = findQuestion(ctx.questions, CLAIM_PATH, "MAJ-PATH");
    const qNone = findQuestion(ctx.questions, CLAIM_NONE, "MAJ-NONE");
    assert.equal(new Set([qId.id, qPath.id, qNone.id]).size, 3, "the three claims map to three distinct questions");
    assert.deepEqual(qId.blocksItems, ["I1"], "the id-naming major blocks exactly the item its claim names");
    assert.deepEqual(qPath.blocksItems, ["I2"], "the path-naming major blocks exactly the item whose fileScope its evidence intersects");
    assert.deepEqual(qNone.blocksItems, [], "a major naming no item still becomes a question with empty blocksItems");

    assert.deepEqual(
      [...ctx.res.questionIds].sort(),
      ctx.questions.map((q) => q.id).sort(),
      "the compact return names exactly the persisted cap questions",
    );
    assert.equal(ctx.res.runState, "PLAN_REVIEWED", "the capped run still advances");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.3-round-cap-blocks-items]
// ===========================================================================

test("[9.3-round-cap-blocks-items] every item a cap-question's blocksItems names is set blocked:{questionId, reason, stage:'plan-review'} — asserted by reading the persisted item files via store.loadItem", async () => {
  const root = scratchDir();
  try {
    const ctx = await driveRoundCap(root);
    const qId = findQuestion(ctx.questions, CLAIM_ID, "MAJ-ID");
    const qPath = findQuestion(ctx.questions, CLAIM_PATH, "MAJ-PATH");

    // The blocked set is asserted by READING THE PERSISTED ITEM FILES through
    // store.loadItem — never by inspecting a journal/log line (the plan's explicit
    // demand: a block is a FIELD ON THE ITEM, §3.2).
    const i1 = ctx.store.loadItem(ctx.runId, "I1");
    assert.equal(validate("Item", i1).ok, true, "the blocked I1 file still validates against the §2.5 schema");
    assert.ok(i1.blocked !== null, "I1's persisted file carries a blocked disposition");
    assert.equal(i1.blocked?.questionId, qId.id, "I1 is blocked on the id-naming major's question");
    assert.equal(i1.blocked?.stage, "plan-review", "I1's block names the plan-review stage");
    assert.ok((i1.blocked?.reason ?? "").length > 0, "I1's block carries a non-empty reason");

    const i2 = ctx.store.loadItem(ctx.runId, "I2");
    assert.equal(validate("Item", i2).ok, true, "the blocked I2 file still validates against the §2.5 schema");
    assert.ok(i2.blocked !== null, "I2's persisted file carries a blocked disposition");
    assert.equal(i2.blocked?.questionId, qPath.id, "I2 is blocked on the path-naming major's question");
    assert.equal(i2.blocked?.stage, "plan-review", "I2's block names the plan-review stage");
    assert.ok((i2.blocked?.reason ?? "").length > 0, "I2's block carries a non-empty reason");

    assert.deepEqual(
      [...ctx.res.blockedItemIds].sort(),
      ["I1", "I2"],
      "the compact return names exactly the blocked items",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.3-round-cap-proceeds]
// ===========================================================================

test("[9.3-round-cap-proceeds] items no surviving major names stay unblocked and the run advances — a partially-blocked queue proceeds instead of halting", async () => {
  const root = scratchDir();
  try {
    const ctx = await driveRoundCap(root);

    // I3 was named by NO surviving major: its persisted file stays fully actionable.
    const i3 = ctx.store.loadItem(ctx.runId, "I3");
    assert.equal(i3.blocked, null, "the un-named item is NOT blocked");
    assert.equal(i3.deferred, null, "the un-named item is not deferred either");
    assert.equal(i3.state, "PENDING", "the un-named item keeps its actionable FSM state");
    assert.ok(!ctx.res.blockedItemIds.includes("I3"), "the compact return does not claim I3");

    // The queue is PARTIALLY blocked — blocked and actionable items coexist legally.
    assert.ok(ctx.store.loadItem(ctx.runId, "I1").blocked !== null, "the partially-blocked queue really has blocked members");

    // And the run PROCEEDS rather than halting: PLAN_REVIEWED, no stop recorded, and
    // the committed wave scheduler can still schedule the remaining item.
    const run = ctx.store.loadRun(ctx.runId);
    assert.equal(run.state, "PLAN_REVIEWED", "the capped run advances to PLAN_REVIEWED");
    assert.equal(ctx.res.runState, "PLAN_REVIEWED", "the compact return reports the advance");
    assert.equal(run.stop, null, "no stop is recorded — the run is live, not halted");
    const queue = JSON.parse(readFileSync(path.join(ctx.runDir, "queue.json"), "utf8")) as Queue;
    const runtime = queue.items.map((qi) => ctx.store.loadItem(ctx.runId, qi.id));
    const wave = nextWave(queue, runtime, ctx.config);
    assert.deepEqual(wave.parallel, ["I3"], "the next wave still schedules the un-named item — the run proceeds on the rest");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// REVIEW-FIX TESTS (R1-R6). The throttled 2-lens adversarial panel over the 9.3
// diff returned 5 MAJOR findings (each skeptic-verified, several with the
// reviewer having RUN the real handler to produce its evidence) plus 9
// minors/nits. Each test below pins ONE fix and was observed RED against the
// pre-fix implementation.
// ===========================================================================

// The three fixture items, as the pure mapping sees them.
const MAP_ITEMS = [
  { id: "I1", fileScope: I1_SCOPE },
  { id: "I2", fileScope: I2_SCOPE },
  { id: "I3", fileScope: I3_SCOPE },
];

// --- R1 [F1/E3 MAJOR] §3.2 mandates FOUR lenses. Sizing the roster by
// readFanout("planReview") = min(planReviewers, parallel.maxReaders) silently
// DROPPED lenses (c) and (d) whenever maxReaders < 4 — and at maxReaders 0
// dispatched NOTHING and still advanced to PLAN_REVIEWED, i.e. a run "passed"
// plan review having gathered no evidence at all. Lens COVERAGE is the
// substance of the stage; the reader clamp is a concurrency knob and the
// fan-out engine already enforces it internally.
test("[9.3-fix-lens-coverage] all four §3.2 lenses are dispatched even when the reader clamp is below four", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ planReviewers: 1, maxReaders: 1 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueThree(), SEED_PLAN_MD);

    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [EMPTY_FINDINGS],
      skeptic: [],
      planner: [],
    });
    const res = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    const reviewerPrompts = wiring.byRole("reviewer");
    assert.equal(reviewerPrompts.length, 4, "all FOUR lenses are dispatched regardless of the reader clamp");
    for (const lens of ["correctness", "completeness", "decomposition", "minimality"]) {
      assert.equal(
        reviewerPrompts.filter((p) => p.text.includes(`Your lens is "${lens}"`)).length,
        1,
        `lens "${lens}" is held by exactly one reviewer`,
      );
    }
    assert.equal(res.runState, "PLAN_REVIEWED", "a clean round still advances");
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes("minimality")),
      "the lens roster that actually ran is greppable in the journal",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- R2 [F2/E5 MAJOR] scopesIntersect compares literal-head PREFIXES, so a
// bare directory token prefixes every deeper scope: one sentence containing
// "src/" blocked the ENTIRE queue and nullified §3.2's "the run proceeds on the
// remaining items" — precisely the blast radius the wildcard guard was written
// to prevent, arriving through a token the guard never inspected.
test("[9.3-fix-blocks-no-directory-tokens] a bare directory token blocks nothing", () => {
  for (const evidence of [
    "both items write into src/, so the wave must serialize",
    "the plan globs src/** across the queue",
    "everything under src/beta/*.ts is affected",
    "the tests/ tree is untouched",
  ]) {
    assert.deepEqual(
      findingBlocksItems({ claim: "a claim naming no file", evidence }, MAP_ITEMS),
      [],
      `a directory-shaped token must not block the queue: ${JSON.stringify(evidence)}`,
    );
  }
  // The honest, fully-qualified citation still blocks exactly its item.
  assert.deepEqual(
    findingBlocksItems(
      { claim: "the parser mis-reads the offset", evidence: "src/beta/parse.ts appears twice" },
      MAP_ITEMS,
    ),
    ["I2"],
    "a real file path still blocks exactly the item that owns it",
  );
});

// --- R3 [E1 MAJOR] The opposite failure of R2, in the same function: the
// ordinary ways a reviewer cites a file all resolved to NOTHING, so a surviving
// major blocked no item and the run executed the item the review condemned.
test("[9.3-fix-blocks-common-citation-forms] the ordinary ways a reviewer cites a file all resolve", () => {
  const cases: Array<[string, string[]]> = [
    ["./src/beta/parse.ts reads the offset as unsigned", ["I2"]],
    ["parse.ts reads the offset as unsigned", ["I2"]],
    ["see [the parser](src/beta/parse.ts) for it", ["I2"]],
    ["src/alpha/load.ts,src/beta/parse.ts overlap", ["I1", "I2"]],
    ["src/beta/parse.ts's reader is unsigned", ["I2"]],
    ["“src/beta/parse.ts” is the culprit", ["I2"]],
    // The compiler/editor citation form: a reviewer quoting a line, a range, or a
    // line:column. The path half is the citation; the numbers are where to look.
    ["src/beta/parse.ts:118 reads the offset as unsigned", ["I2"]],
    ["src/beta/parse.ts:118:14 is the read", ["I2"]],
    ["src/beta/parse.ts:118-140 covers the whole reader", ["I2"]],
    ["parse.ts:118 reads the offset as unsigned", ["I2"]],
    // A bare directory keeps blocking nothing, line number or not (R2's rule).
    ["src/:118 is not a citation", []],
  ];
  for (const [evidence, expected] of cases) {
    assert.deepEqual(
      findingBlocksItems({ claim: "the parser mis-reads the offset", evidence }, MAP_ITEMS),
      expected,
      `citation form must resolve: ${JSON.stringify(evidence)}`,
    );
  }
});

// --- R4 [F3/E2 MAJOR] An Item carries ONE `blocked` disposition. With two
// surviving majors naming the same item, the second question still claimed the
// item in its blocksItems while the block pointed at the FIRST question — so the
// ledger row was false on disk, and answering the first question released the
// item while the second major was still open. §3.2's "a field on the item, a row
// in a ledger, and an unblock path" has to agree with itself.
test("[9.3-fix-overlapping-blocks] a question's blocksItems names exactly the items it actually blocks", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ planReviewMaxRounds: 0, skepticsPerFinding: 1 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueThree(), SEED_PLAN_MD);

    // Two DIFFERENT majors, both citing the same file — so both map to I1.
    const both = findingsJson([
      makeFinding("M1", "major", "correctness", "the loader runs before the schema exists", "src/alpha/load.ts calls load() first"),
      makeFinding("M2", "major", "minimality", "the loader wraps an abstraction nobody asked for", "src/alpha/load.ts adds a factory layer"),
    ]);
    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [both, EMPTY_FINDINGS, EMPTY_FINDINGS, EMPTY_FINDINGS],
      skeptic: [(text: string) => verdictJson(text.includes("M2") ? "M2" : "M1", true)],
      planner: [],
    });
    const res = await handlePlanReview({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
      now: () => START_MS,
    });

    assert.equal(res.runState, "PLAN_REVIEWED", "the cap exit still advances the run");
    const questions = readQuestions(runDirOf(store, runId));
    assert.equal(questions.length, 2, "both surviving majors become questions");

    const item = store.loadItem(runId, "I1");
    assert.ok(item.blocked !== null, "the contested item is blocked");
    const owner = item.blocked?.questionId;
    assert.ok(
      questions.some((q) => q.id === owner),
      "the item's block points at a real question",
    );
    for (const q of questions) {
      const claimsItem = q.blocksItems.includes("I1");
      assert.equal(
        claimsItem,
        q.id === owner,
        `question ${q.id} may claim I1 in blocksItems ONLY if it is the question the item is blocked on`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- R5 [E6] Item ids are unconstrained strings, and the id scan treated '.'
// and '/' as separators, so a shorter id matched INSIDE a longer dotted or
// slashed one and blocked the wrong item.
test("[9.3-fix-id-boundary] an id is not matched inside a longer dotted or slashed id", () => {
  const items = [
    { id: "I1", fileScope: ["src/alpha/load.ts"] },
    { id: "I1.2", fileScope: ["src/delta/sub.ts"] },
  ];
  assert.deepEqual(
    findingBlocksItems({ claim: "item I1.2 is wrong", evidence: "the sub-item mis-orders its steps" }, items),
    ["I1.2"],
    "naming I1.2 must not also block I1",
  );
});

// --- R6 [E9] skepticsPerFinding is schema-valid at 0, and the panel guard was
// stepped around at k=0 so findingSurvives([], 0) made EVERY major auto-survive
// with zero adjudication — silently picking the most consequential reading of
// "no skeptics configured".
test("[9.3-fix-zero-skeptics] a zero-skeptic panel refuses to adjudicate instead of auto-upholding", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ skepticsPerFinding: 0, planReviewMaxRounds: 0 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedPlanned(store, runId, queueThree(), SEED_PLAN_MD);

    const wiring = makeReviewFanout(runId, config, journal.sink, {
      reviewer: [
        findingsJson([makeFinding("M1", "major", "correctness", "the loader runs first", "src/alpha/load.ts calls load() first")]),
        EMPTY_FINDINGS,
        EMPTY_FINDINGS,
        EMPTY_FINDINGS,
      ],
      skeptic: [],
      planner: [],
    });

    let threw = false;
    try {
      await handlePlanReview({
        store,
        fanout: wiring.fanout,
        runId,
        config,
        journal: journal.sink,
        packs: DOCTRINE_PACKS,
        now: () => START_MS,
      });
    } catch (error) {
      threw = true;
      assert.match(
        (error as Error).message,
        /skeptic/i,
        "the refusal names the unadjudicated skeptic panel",
      );
    }
    assert.ok(threw, "a major cannot be adjudicated by an empty panel — the handler refuses");
    assert.equal(store.loadRun(runId).state, "PLANNED", "the run is left where it was");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
