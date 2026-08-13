// conductor/adapter/tools.ts — Task 5.3 (gate-hookup half; plan lines 2375-2391,
// §3.5 lines 1334-1427). The ONE function the plugin's tool.execute.before body
// calls, plus the §3.4 tool-name inventory and the tool-class derivation the
// session-registry gate dispatches on.
//
// Adapter module (G14): runs under BOTH the opencode plugin runtime and Node
// type-stripping, so it uses ONLY runtime-agnostic code — no single-runtime
// globals, no shell tag, no subprocess. All decision logic lives in the PURE core
// gates (core/gates-git.ts, core/gates-edit.ts) and the core shell parser
// (core/shell-parse.ts); this file only SEQUENCES them in the §3.5 order, gathers
// the §7.4 input snapshot, and turns a `deny` decision into the thrown Error that
// opencode reads back to the model as the refusal reason (Task 0.2 wire-notes).
//
// Order (§3.5): the session-registry gate FIRST (spawn denied in every session;
// an unregistered write/conductor denied by the REGISTRY rule), then — for bash —
// the git gate over the WHOLE command and the edit-scope gate over each
// write-shaped target, and — for an edit/write tool — the edit-scope gate over the
// edited path. FAIL-CLOSED (G5): if a pure core decision crashes, the anomaly is
// journaled (gates/gate-crash) and the disposition is decided by a `guarded` flag
// computed from the REAL parse (a git segment or a write shape present, or the
// tool itself writes/advances-state/spawns) — guarded ⇒ deny, harmless read ⇒
// allow. Every deny journals its snapshot under gates/deny (§7.4).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

import { decideGit } from "../core/gates-git.ts";
import { decideEdit, decideSession, writeShapedPaths } from "../core/gates-edit.ts";
import type { Decision, EditInput, SessionInput } from "../core/gates-edit.ts";
import { globMatch, isGitCommand, scopesIntersect, shellTokens, splitOnOperators } from "../core/shell-parse.ts";
import { isHumanTerritory, requireTwoOptions } from "../core/decide.ts";
import { legalRunTransition } from "../core/fsm-run.ts";
import { ITEM_STATES, legalItemTransition } from "../core/fsm-item.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun, LegalToolsResult } from "../core/gates-phase.ts";
import { findingBlocksItems, scanPlaceholders, validateQueue } from "../core/planning.ts";
import { nextWave, readFanout } from "../core/schedule.ts";
import { findingSurvives } from "../core/verdict.ts";
import { SCHEMAS, validate } from "../core/types.ts";
import type {
  Classification,
  ClassificationCheck,
  ClassificationKind,
  Config,
  CriterionVerdict,
  DecisionRecord,
  EvidenceRecord,
  FailureClass,
  Findings,
  ImplementerResult,
  Item,
  ItemState,
  Plan,
  PlanDecision,
  Queue,
  QueueItem,
  Run,
  RunState,
  TestVet,
  TrivialItem,
  Verdict,
} from "../core/types.ts";
import { writeFileAtomicSync } from "./state.ts";
import type { StateStore } from "./state.ts";
import { appendQuestion, answerQuestion, readQuestions } from "./questions.ts";
import type { Fanout, FanoutJob, TreeState } from "./fanout.ts";
import { runTest, runVerify } from "./evidence.ts";
import type { RunTestResult, ScopeSpec } from "./evidence.ts";
import type { Journal } from "./journal.ts";

// ---------------------------------------------------------------------------
// (1) The §3.4 tool inventory (plan lines 1307-1328) — the EXACT 22 conductor_*
// names the plugin's `tool` hook registers. A plain readonly string[] (G2: no
// enum); the plugin builds its `tool` map from THIS array, and the test asserts
// the two never drift.
// ---------------------------------------------------------------------------

export const CONDUCTOR_TOOL_NAMES: readonly string[] = [
  "conductor_classify",
  "conductor_decompose",
  "conductor_plan",
  "conductor_plan_review",
  "conductor_dispatch_wave",
  "conductor_submit_test",
  "conductor_vet_test",
  "conductor_mark_green",
  "conductor_validate",
  "conductor_item_review",
  "conductor_publish",
  "conductor_report",
  "conductor_surface",
  "conductor_answer",
  "conductor_defer",
  "conductor_decide",
  "conductor_queue_amend",
  "conductor_inline_claim",
  "conductor_override",
  "conductor_status",
  "conductor_setup",
  "conductor_forget_stale",
];

// ---------------------------------------------------------------------------
// (2) Tool-class derivation for the registry gate (§3.5). Non-bash tools classify
// by name; a `bash` tool classifies by whether its command has a write shape. A
// git WRITE hidden in a read-classified bash command is deliberately NOT forced
// to "write" here — it is caught downstream by the git gate, which runs for
// registered and unregistered sessions alike.
// ---------------------------------------------------------------------------

export type ToolClass = "read" | "write" | "conductor" | "spawn";

// opencode's built-in sub-agent spawn tool (Task 0.2 discovery iii: its id is
// `task`). Spawning is denied in EVERY session — the load-bearing registry rule.
const SPAWN_TOOL = "task";
// The edit/write/patch tools whose NAME alone marks the call a write.
const WRITE_TOOLS: readonly string[] = ["edit", "write", "patch", "apply_patch"];

export function classifyTool(toolName: string, command?: string): ToolClass {
  if (toolName === SPAWN_TOOL) return "spawn";
  if (toolName.startsWith("conductor_")) return "conductor";
  if (WRITE_TOOLS.includes(toolName)) return "write";
  if (toolName === "bash") {
    return writeShapedPaths(command ?? "").length > 0 ? "write" : "read";
  }
  return "read";
}

// ---------------------------------------------------------------------------
// (3) The gate-hookup function. Returns to ALLOW; throws Error(reason) to DENY.
// ---------------------------------------------------------------------------

type GitMode = "read-only" | "commit" | "commit-and-push";
type BranchPolicy = "pin" | "check-only";
type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export interface Corr {
  runId: string;
  itemId?: string;
  sessionID?: string;
}

export interface GateJournal {
  log: (
    level: LogLevel,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: Corr,
  ) => void;
}

export interface RegistryEntry {
  role: string;
  itemId?: string;
  tree?: string;
}

// Fail-closed injection seam (dependency injection): a test overrides a core
// decision function to simulate a crash; each defaults to the real core.
export interface GateDeps {
  decideSession?: (input: SessionInput) => Decision;
  decideGit?: (
    command: string,
    sessionRole: string,
    gitMode: GitMode,
    runActive: boolean,
    branchPolicy: BranchPolicy,
  ) => Decision;
  decideEdit?: (input: EditInput) => Decision;
}

export interface GateHookInput {
  sessionID: string;
  toolName: string;
  args: Record<string, unknown>; // raw tool args (for the §7.4 snapshot)
  command?: string; // bash command text (args.command)
  editPath?: string; // absolute path for an edit/write tool
  registry: Map<string, RegistryEntry>;
  gitMode: GitMode;
  runActive: boolean;
  branchPolicy: BranchPolicy;
  fileScope: string[];
  testScope: string[];
  verifyInFlightTree: string | null;
  inlineClaimScope: string[] | null;
  journal: GateJournal;
  corr: Corr;
  deps?: GateDeps;
}

// True iff the command contains at least one git segment, computed with the SAME
// quote-aware tokenizer + operator segmentation the git gate uses internally.
// This is the "real parse" the fail-closed guardedness flag reads, so it stays
// reliable even when decideGit itself crashes (G5).
function hasGitSegment(command: string): boolean {
  for (const seg of splitOnOperators(shellTokens(command))) {
    if (isGitCommand(seg)) return true;
  }
  return false;
}

// The §7.4 input snapshot for a deny: enough context (toolName, raw args, the
// repro command/path, and the reason) to reproduce the decision through the pure
// core function in a test.
function denySnapshot(input: GateHookInput, reason: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    toolName: input.toolName,
    args: input.args,
    reason,
  };
  if (input.command !== undefined) data.command = input.command;
  if (input.editPath !== undefined) data.editPath = input.editPath;
  return data;
}

// Journal the deny snapshot (gates/deny) and throw the reason. A deny is a
// security refusal, logged at `warn` so the journal always persists it (§7.4).
function denyThrow(input: GateHookInput, reason: string): never {
  input.journal.log("warn", "gates", "deny", denySnapshot(input, reason), input.corr);
  throw new Error(reason);
}

// Run one pure core decision under the fail-closed guard (G5). On a crash the
// anomaly is journaled (gates/gate-crash, at `error`) and the disposition follows
// the `guarded` flag: a guarded call fails CLOSED (deny), a harmless read fails
// OPEN (allow). The crash is never invisible either way.
function guardedDecide(
  input: GateHookInput,
  guarded: boolean,
  crashContext: Record<string, unknown>,
  decide: () => Decision,
): Decision {
  try {
    return decide();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.journal.log(
      "error",
      "gates",
      "gate-crash",
      { ...crashContext, guarded, error: message },
      input.corr,
    );
    if (guarded) {
      return {
        action: "deny",
        reason:
          "a security gate crashed while judging a guarded call — denied (fail-closed, G5): " +
          message,
      };
    }
    return { action: "allow" };
  }
}

function reasonOf(decision: Decision, fallback: string): string {
  return decision.reason !== undefined && decision.reason.length > 0
    ? decision.reason
    : fallback;
}

export function gateBeforeToolCall(input: GateHookInput): void {
  const entry = input.registry.get(input.sessionID);
  const registered = entry !== undefined;
  const role = entry?.role ?? null;
  const sessionTree = entry?.tree ?? "";

  const command = input.command;
  const gitSegmentPresent = command !== undefined && hasGitSegment(command);
  const writeTargets = command !== undefined ? writeShapedPaths(command) : [];
  const toolClass = classifyTool(input.toolName, command);

  // The fail-closed guardedness flag (G5), computed ONCE from the real parse:
  // anything that could write, advance conductor state, or spawn a child must
  // fail closed on a gate crash; only a harmless read fails open.
  const guarded =
    gitSegmentPresent ||
    writeTargets.length > 0 ||
    toolClass === "write" ||
    toolClass === "conductor" ||
    toolClass === "spawn";

  const decideSessionFn: (i: SessionInput) => Decision =
    input.deps?.decideSession ?? decideSession;
  const decideGitFn: (
    c: string,
    sessionRole: string,
    gitMode: GitMode,
    runActive: boolean,
    branchPolicy: BranchPolicy,
  ) => Decision = input.deps?.decideGit ?? decideGit;
  const decideEditFn: (i: EditInput) => Decision = input.deps?.decideEdit ?? decideEdit;

  // (a) Session-registry gate FIRST. An unregistered write/conductor is denied by
  //     the REGISTRY rule (naming the missing item assignment, NOT a scope); a
  //     spawn is denied in every session, registered or not.
  const sessionDecision = guardedDecide(
    input,
    guarded,
    { gate: "session", toolName: input.toolName, toolClass },
    () => decideSessionFn({ registered, role, toolName: input.toolName, toolClass }),
  );
  if (sessionDecision.action === "deny") {
    denyThrow(input, reasonOf(sessionDecision, "the session-registry gate denied this call"));
  }

  const editInputFor = (path: string): EditInput => ({
    sessionRole: role ?? "",
    registered,
    fileScope: input.fileScope,
    testScope: input.testScope,
    path,
    verifyInFlightTree: input.verifyInFlightTree,
    sessionTree,
    inlineClaimScope: input.inlineClaimScope,
  });

  // (b) bash: the git gate over the WHOLE command (decideGit allows non-git
  //     commands, so running it over every bash command is how a git write hidden
  //     in a compound command such as `ls && git commit` is still caught), then
  //     the edit-scope gate over each write-shaped target.
  if (input.toolName === "bash") {
    if (command === undefined) return;

    const gitDecision = guardedDecide(
      input,
      guarded,
      { gate: "git", toolName: input.toolName, command },
      () => decideGitFn(command, role ?? "", input.gitMode, input.runActive, input.branchPolicy),
    );
    if (gitDecision.action === "deny") {
      denyThrow(input, reasonOf(gitDecision, "the git gate denied this command"));
    }

    for (const target of writeTargets) {
      const editDecision = guardedDecide(
        input,
        guarded,
        { gate: "edit", toolName: input.toolName, command, editPath: target },
        () => decideEditFn(editInputFor(target)),
      );
      if (editDecision.action === "deny") {
        denyThrow(input, reasonOf(editDecision, "the edit-scope gate denied this write"));
      }
    }
    return;
  }

  // (c) edit/write/patch tool: the edit-scope gate over the edited path.
  if (input.editPath !== undefined) {
    const editPath = input.editPath;
    const editDecision = guardedDecide(
      input,
      guarded,
      { gate: "edit", toolName: input.toolName, editPath },
      () => decideEditFn(editInputFor(editPath)),
    );
    if (editDecision.action === "deny") {
      denyThrow(input, reasonOf(editDecision, "the edit-scope gate denied this edit"));
    }
  }
}

// ===========================================================================
// (4) The §3.4 Phase-9 stage-tool handlers (plan lines 2567-2582). Each follows
// the §3.4 invariant loop — legality -> derive -> persist -> journal -> compact
// return — and each is (with the state store and questions adapter it delegates
// to) the ONLY writer of run/item state (G6). The two ledgers this task adds live
// at the run dir: queue.json (a synthesized trivial item) and decisions.jsonl
// (decide/defer). They are handler-owned, so this file writes them through the
// crash-safe primitive (queue.json) and a plain JSONL append (decisions.jsonl) —
// never through state.ts's private evidence appender (G6).
// ===========================================================================

// The handler journal sink: structurally the adapter/journal.ts Journal (a leveled
// log + optional flush). GateJournal above already models it; the handlers reuse it.
type HandlerJournal = GateJournal;

// Every handler derives its run dir the same way: <root>/.conductor/runs/<runId>/.
function handlerRunDir(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

// §3.2 kind strictness: work (2) > trivial (1) > question (0). The stricter of two
// kinds wins a classifier/skeptic disagreement (and any handler re-check escalation).
const KIND_STRICTNESS: Record<string, number> = { question: 0, trivial: 1, work: 2 };
function stricterKind(a: ClassificationKind, b: ClassificationKind): ClassificationKind {
  return (KIND_STRICTNESS[a] ?? 0) >= (KIND_STRICTNESS[b] ?? 0) ? a : b;
}

// §2.4 handler re-check (classifier proposes, handler disposes): a trivial item is
// escalated to work when ANY objective bound is violated, even if the skeptic agreed
// trivial. (a) more files than trivialMaxFiles; (b) a behavioral item with no test
// scope (a behavioral change owes a test, §2.4); (c) a behavioral:false item whose
// fileScope intersects verify.behavioralPaths — the §2.4 disjoint-path guard forbids
// claiming untestability while editing behavioral production code.
function trivialViolatesRecheck(trivialItem: TrivialItem, config: Config): boolean {
  if (trivialItem.fileScope.length > config.workflow.trivialMaxFiles) return true;
  if (trivialItem.behavioral && trivialItem.testScope.length === 0) return true;
  if (!trivialItem.behavioral && scopesIntersect(trivialItem.fileScope, config.verify.behavioralPaths)) {
    return true;
  }
  return false;
}

// --- decisions.jsonl (§2.7) — a handler-owned ledger at the run dir -----------

// Mint the next §2.7 id (D-0001, D-0002, …) as max-existing-numeric + 1. The scan is
// torn-line TOLERANT (mirror journal.ts's crash-artifact posture): it reads the raw
// ledger and extracts every `"id":"D-<n>"` token directly, never JSON.parse-ing a line,
// so a half-written trailing line left by a crash/kill/ENOSPC neither wedges the mint
// (a JSON.parse throw) NOR lets the next id COLLIDE with the torn line's id — the mint
// advances strictly PAST the highest id present, valid line or not. A leading BOM is
// stripped as elsewhere. Over-counting (a D-<n> token in a free-text field) only skips
// ids, never collides, so the id-field-anchored pattern stays conservative.
function mintDecisionId(runDir: string): string {
  const ledgerPath = path.join(runDir, "decisions.jsonl");
  let maxNum = 0;
  if (existsSync(ledgerPath)) {
    let raw = readFileSync(ledgerPath, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    for (const match of raw.matchAll(/"id"\s*:\s*"D-(\d+)"/g)) {
      const value = Number.parseInt(match[1], 10);
      if (value > maxNum) maxNum = value;
    }
  }
  return "D-" + String(maxNum + 1).padStart(4, "0");
}

// A fresh §2.5 runtime item at the head of the item FSM (plan lines 760-791).
// Shared by every handler that CREATES items — the trivial synthesis in
// conductor_classify and the decomposed queue in conductor_decompose — so the
// birth shape of an item is written down exactly once.
function newPendingItem(itemId: string): Item {
  return {
    id: itemId,
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

// The §2.7 schema half of a decision's legality, separate from the append so a caller
// that persists something else first can establish it BEFORE that write — appendDecision
// throwing after the fact would leave the other write standing.
function assertDecisionValid(record: DecisionRecord): void {
  const result = validate("DecisionRecord", record);
  if (!result.ok) {
    throw new Error("tools: refusing to write an invalid DecisionRecord: " + result.errors.join("; "));
  }
}

// Validate (schema-subset, §2.7) then append one JSON line to decisions.jsonl.
function appendDecision(runDir: string, record: DecisionRecord): void {
  assertDecisionValid(record);
  mkdirSync(runDir, { recursive: true });
  appendFileSync(path.join(runDir, "decisions.jsonl"), JSON.stringify(record) + "\n");
}

// ---------------------------------------------------------------------------
// conductor_classify (§3.2)
// ---------------------------------------------------------------------------

export interface ClassifyInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  sessionID?: string;
  now?: () => number;
}

export interface ClassifyResult {
  kind: ClassificationKind; // the FINAL (possibly escalated) kind
  agreed: boolean; // the skeptic's verdict
  correctedKind: ClassificationKind | null; // null IFF agreed
  itemId: string | null; // the synthesized trivial item id, else null
  runState: RunState; // ANSWERED | EXECUTING | INTAKE
}

function classifierPrompt(userPrompt: string): string {
  return (
    "Classify the following work request as exactly one of: question, trivial, work. " +
    'Reply with a single JSON object matching the Classification schema (kind, rationale, ' +
    'confidence, trivialItem). trivialItem is a complete queue item (minus id/dependsOn) and ' +
    'is non-null ONLY for kind "trivial".\n\nREQUEST:\n' +
    userPrompt
  );
}

function skepticPrompt(userPrompt: string, proposed: ClassificationKind): string {
  return (
    'You are a skeptic cross-checking a classification. The classifier proposed kind "' +
    proposed +
    '". Reply with a single JSON object matching the ClassificationCheck schema ' +
    "(agreed, correctedKind, note): if you disagree set agreed=false and correctedKind to the " +
    "kind you would assign, otherwise agreed=true and correctedKind=null.\n\nREQUEST:\n" +
    userPrompt
  );
}

// Dispatch a classifier (schema Classification) then a skeptic (schema
// ClassificationCheck) through the injected Fanout; embed the check into
// run.classification; escalate to the stricter kind on disagreement AND on any §2.4
// re-check failure; on a surviving trivial, synthesize queue.json + the runtime item
// and advance to EXECUTING; work stays INTAKE; question advances to ANSWERED.
export async function handleClassify(input: ClassifyInput): Promise<ClassifyResult> {
  const { store, fanout, runId, config, journal } = input;
  const runDir = handlerRunDir(store, runId);
  const run = store.loadRun(runId);

  // (1) derive: classifier proposes, skeptic checks (registry-before-prompt is the
  //     fan-out engine's contract; structured output is prompt-shaped + independently
  //     validated, so no native `format` field is ever set).
  const classifierJob: FanoutJob = {
    role: "mechanical",
    itemId: "",
    tree: "",
    writeCapable: false,
    prompt: classifierPrompt(run.prompt),
    schemaName: "Classification",
    priority: "interactive",
  };
  const classifierResult = await fanout.dispatch(classifierJob);
  const classification = classifierResult.value as Classification | undefined;
  if (classification === undefined) {
    throw new Error(
      "conductor_classify: the classifier sub-session produced no valid Classification (" +
        JSON.stringify(classifierResult.error) +
        ")",
    );
  }

  const skepticJob: FanoutJob = {
    role: "skeptic",
    itemId: "",
    tree: "",
    writeCapable: false,
    prompt: skepticPrompt(run.prompt, classification.kind),
    schemaName: "ClassificationCheck",
    priority: "interactive",
  };
  const skepticResult = await fanout.dispatch(skepticJob);
  const check = skepticResult.value as ClassificationCheck | undefined;
  if (check === undefined) {
    throw new Error(
      "conductor_classify: the skeptic sub-session produced no valid ClassificationCheck (" +
        JSON.stringify(skepticResult.error) +
        ")",
    );
  }

  // An actionable disagreement = the skeptic BOTH dissents AND names a correction.
  // Normalizing to that condition enforces the result contract "correctedKind is null
  // IFF agreed": a schema-valid but self-contradictory {agreed:false, correctedKind:null}
  // reply names nothing to escalate to, so it escalates NOTHING and normalizes to
  // agreed:true (F5). The skeptic's raw note is preserved on check.note regardless.
  const correctedKind: ClassificationKind | null =
    !check.agreed && check.correctedKind !== null ? check.correctedKind : null;
  const agreed = correctedKind === null;
  let finalKind: ClassificationKind =
    correctedKind !== null ? stricterKind(classification.kind, correctedKind) : classification.kind;

  // Handler re-check (classifier proposes, handler disposes): escalate a surviving
  // trivial to work on any §2.4 violation, even when the skeptic AGREED trivial.
  if (finalKind === "trivial" && classification.trivialItem !== null) {
    if (trivialViolatesRecheck(classification.trivialItem, config)) {
      finalKind = "work";
    }
  }
  // A "trivial" disposition with NOTHING to synthesize — the classifier itself did not
  // say trivial, so there is no trivialItem (the §2.10 cross-field rule ties trivialItem
  // non-null to kind "trivial"), and a skeptic's question→trivial correction cannot
  // conjure one — escalates FURTHER to work rather than throwing (F1). An
  // un-synthesizable trivial is not a legal EXECUTING run.
  if (finalKind === "trivial" && classification.trivialItem === null) {
    finalKind = "work";
  }

  // (2) persist: record the final kind + the embedded (normalized) skeptic check.
  run.classification = {
    kind: finalKind,
    rationale: classification.rationale,
    check: { agreed, note: check.note },
  };

  let itemId: string | null = null;
  if (finalKind === "trivial") {
    const trivialItem = classification.trivialItem;
    if (trivialItem === null) {
      // Unreachable: the escalation steps above already dispose a null-trivialItem
      // "trivial" to work. Retained as a typed invariant guard (narrows trivialItem to
      // non-null for the synthesis below), never a live throw path.
      throw new Error("conductor_classify: a trivial classification must carry a trivialItem (§2.10)");
    }
    // Synthesize the §2.4 queue (one item; mint id; dependsOn:[]) and validate it as
    // any decomposed queue would be validated, then write it at the run dir.
    itemId = "I1";
    const queueItem: QueueItem = {
      id: itemId,
      title: trivialItem.title,
      rationale: trivialItem.rationale,
      fileScope: [...trivialItem.fileScope],
      testScope: [...trivialItem.testScope],
      acceptance: [...trivialItem.acceptance],
      behavioral: trivialItem.behavioral,
      dependsOn: [],
      ponytail: { ...trivialItem.ponytail },
    };
    const queue: Queue = { items: [queueItem] };
    const queueResult = validate("Queue", queue);
    if (!queueResult.ok) {
      throw new Error(
        "conductor_classify: refusing to write an invalid queue.json: " + queueResult.errors.join("; "),
      );
    }
    writeFileAtomicSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));

    // Create the §2.5 runtime item at the head of the item FSM (PENDING) via the store.
    store.saveItem(runId, newPendingItem(itemId));
    run.state = "EXECUTING";
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, state: "PENDING", origin: "trivial-synthesis" },
      { runId, itemId },
    );
  } else if (finalKind === "question") {
    run.state = "ANSWERED";
  } else {
    run.state = "INTAKE"; // work: decompose is the next pipeline tool.
  }

  store.saveRun(run);

  // (3) journal the run FSM disposition; (4) compact return.
  journal.log(
    "info",
    "fsm",
    "transition",
    { to: run.state, classification: finalKind, agreed },
    { runId, sessionID: input.sessionID },
  );

  return { kind: finalKind, agreed, correctedKind, itemId, runState: run.state };
}

// ---------------------------------------------------------------------------
// conductor_status (§3.4) — read-only.
// ---------------------------------------------------------------------------

export interface StatusInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
}

export interface StatusItem {
  id: string;
  state: string;
  blocked: unknown;
  deferred: unknown;
}

export interface StatusResult {
  runId: string;
  state: RunState;
  classification: { kind: ClassificationKind } | null;
  items: StatusItem[];
  openQuestions: Array<{ id: string; question: string }>;
}

// Render the run/item/question dispositions. READ-ONLY: it mutates no persisted
// byte — every access is a store read (loadRun/loadItem) or a questions read.
export function handleStatus(input: StatusInput): StatusResult {
  const { store, runId } = input;
  const runDir = handlerRunDir(store, runId);
  const run = store.loadRun(runId);

  const items: StatusItem[] = [];
  const itemsDir = path.join(runDir, "items");
  if (existsSync(itemsDir)) {
    for (const name of readdirSync(itemsDir).sort()) {
      if (!name.endsWith(".json")) continue;
      const item = store.loadItem(runId, name.slice(0, -".json".length));
      items.push({ id: item.id, state: item.state, blocked: item.blocked, deferred: item.deferred });
    }
  }

  const openQuestions: Array<{ id: string; question: string }> = [];
  for (const q of readQuestions(runDir)) {
    if (q.answeredIso === null) openQuestions.push({ id: q.id, question: q.question });
  }

  const classification =
    run.classification !== null && run.classification !== undefined
      ? { kind: run.classification.kind }
      : null;

  return { runId, state: run.state, classification, items, openQuestions };
}

// ---------------------------------------------------------------------------
// conductor_decide (§2.7)
// ---------------------------------------------------------------------------

export interface DecideInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
  now?: () => number;
  question: string;
  options: Array<{ name: string; score?: DecisionRecord["options"][number]["score"] }>;
  choice: string;
  why: string;
  kind: "derived" | "human";
  appliedWhere: string;
}

export interface DecideResult {
  decisionId: string;
  record: DecisionRecord;
}

// Append the §2.7 record. Legality FIRST (requireTwoOptions rejects a kind:derived
// record carrying <2 scored options), BEFORE any persist — a rejected decide writes
// NO ledger line. On accept: mint id + tsIso, append one line, journal, return.
export function handleDecide(input: DecideInput): DecideResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  const record: DecisionRecord = {
    id: mintDecisionId(runDir),
    tsIso: new Date(now()).toISOString(),
    question: input.question,
    options: input.options.map((option) =>
      option.score === undefined ? { name: option.name } : { name: option.name, score: option.score },
    ),
    choice: input.choice,
    why: input.why,
    kind: input.kind,
    appliedWhere: input.appliedWhere,
  };

  // (1) legality — the throw precedes persist, so a rejected decide leaves no line.
  const gate = requireTwoOptions(record);
  if (!gate.ok) {
    throw new Error(gate.why);
  }

  // (2) persist the ledger line; (3) journal; (4) return.
  appendDecision(runDir, record);
  journal.log(
    "info",
    "state",
    "decision.recorded",
    { decisionId: record.id, kind: record.kind, choice: record.choice },
    { runId },
  );

  return { decisionId: record.id, record };
}

// ---------------------------------------------------------------------------
// conductor_surface (§2.11)
// ---------------------------------------------------------------------------

export interface SurfaceInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
  now?: () => number;
  question: string;
  blocksItems: string[];
  askedBy: { role: string; sessionID: string };
  humanTerritory?: boolean;
}

export interface SurfaceResult {
  questionId: string;
  blockedItemIds: string[];
}

// Append the §2.11 question (origin surface-tool), set blocked:{questionId} on every
// named item, leave un-named items actionable (the run continues on them), journal.
export function handleSurface(input: SurfaceInput): SurfaceResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality before persist (§3.4): every named item must exist. A bad id aborts
  //     the whole call with ZERO writes — no orphan question, no half-applied block.
  for (const itemId of input.blocksItems) {
    try {
      store.loadItem(runId, itemId);
    } catch {
      throw new Error('conductor_surface: item "' + itemId + '" does not exist; refusing to surface');
    }
  }

  // §2.11 makes humanTerritory the core isHumanTerritory VERDICT, not a caller flag: a
  // caller may FORCE true, but cannot force a human-territory question down to false.
  const humanTerritory = input.humanTerritory === true ? true : isHumanTerritory(input.question);

  const question = appendQuestion(
    runDir,
    {
      runId,
      question: input.question,
      askedBy: { role: input.askedBy.role, sessionID: input.askedBy.sessionID },
      humanTerritory,
      origin: "surface-tool",
      blocksItems: [...input.blocksItems],
    },
    now(),
  );

  const blockedItemIds: string[] = [];
  for (const itemId of input.blocksItems) {
    store.setBlocked(runId, itemId, {
      reason: "blocked on surfaced question " + question.id,
      stage: "surface",
      questionId: question.id,
    });
    blockedItemIds.push(itemId);
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId: question.id },
      { runId, itemId },
    );
  }

  return { questionId: question.id, blockedItemIds };
}

// ---------------------------------------------------------------------------
// conductor_answer (§2.11)
// ---------------------------------------------------------------------------

export interface AnswerInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
  now?: () => number;
  questionId: string;
  answer: string;
}

export interface AnswerHandlerResult {
  questionId: string;
  clearedItemIds: string[];
}

// Clear blocked on EXACTLY the items bound to the question and mark it answered —
// delegated to questions.answerQuestion, which owns the C-018/C-020 clear-first-
// then-mark wedge order (never re-implemented here). Journal, return the cleared ids.
export function handleAnswer(input: AnswerInput): AnswerHandlerResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  const result = answerQuestion(runDir, input.questionId, input.answer, now());

  for (const itemId of result.clearedItemIds) {
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: null, clearedQuestionId: input.questionId },
      { runId, itemId },
    );
  }

  return { questionId: input.questionId, clearedItemIds: result.clearedItemIds };
}

// ---------------------------------------------------------------------------
// conductor_defer (§2.7 / §2.5)
// ---------------------------------------------------------------------------

export interface DeferInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
  now?: () => number;
  itemId: string;
  reason: string;
}

export interface DeferResult {
  itemId: string;
  decisionId: string;
}

// Append a §2.7 decision record explaining the deferral (kind:"human" — exempt from
// requireTwoOptions; a deferral is a judgment, not a scored pick, so it fabricates no
// options), then set deferred:{reason,decisionId} on the item (legalTools treats a
// deferred item as settled). Journal, return.
export function handleDefer(input: DeferInput): DeferResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // Legality before persist (§3.4): the item must exist, else a bad id would leave an
  // orphan decision record (and advance the D- counter) with nothing to point at it.
  try {
    store.loadItem(runId, input.itemId);
  } catch {
    throw new Error('conductor_defer: item "' + input.itemId + '" does not exist; refusing to defer');
  }

  const decisionId = mintDecisionId(runDir);
  const record: DecisionRecord = {
    id: decisionId,
    tsIso: new Date(now()).toISOString(),
    question: "Defer item " + input.itemId + " out of this run?",
    options: [{ name: "defer" }],
    choice: "defer",
    why: input.reason,
    kind: "human",
    appliedWhere: "item " + input.itemId,
  };
  appendDecision(runDir, record);
  journal.log(
    "info",
    "state",
    "decision.recorded",
    { decisionId, kind: record.kind, itemId: input.itemId },
    { runId, itemId: input.itemId },
  );

  store.setDeferred(runId, input.itemId, { reason: input.reason, decisionId });
  journal.log(
    "info",
    "state",
    "item.updated",
    { itemId: input.itemId, deferred: true, decisionId },
    { runId, itemId: input.itemId },
  );

  return { itemId: input.itemId, decisionId };
}

// ===========================================================================
// (5) The §3.2 PLANNING-stage handlers (Task 9.2, plan lines 2584-2594). Same
// §3.4 invariant loop as the Task-9.1 handlers — legality -> derive -> persist ->
// journal -> compact return — with the §3.2 tables applied by the PURE core
// (core/planning.ts) so this file stays a thin adapter: dispatch, re-prompt,
// persist, journal.
//
// The re-prompt budget is ONE, uniformly (plan lines 1104-1110 give the bounded
// re-split round for size; §3.2's other rows are rejections outright, and one
// re-prompt is strictly more forgiving than each row demands). A reply that
// still violates any rule is REJECTED: the handler throws with the named
// reason and — because legality precedes persist — leaves NOTHING behind: no
// queue.json, no plan.md, no decisions.jsonl line, no item, and the run in the
// state it started in.
// ===========================================================================

// One initial dispatch + exactly ONE bounded re-prompt.
const PLANNER_ATTEMPTS = 2;

// Every planner dispatch in this stage: a fresh read-only sub-session (the
// engine registers it BEFORE its first prompt), prompt-shaped structured output
// independently validated against `schemaName` (Task 0.2 DRIFT — no native
// `format` field is ever set), at interactive priority.
function plannerJob(prompt: string, schemaName: string): FanoutJob {
  return {
    role: "planner",
    itemId: "",
    tree: "",
    writeCapable: false,
    prompt,
    schemaName,
    priority: "interactive",
  };
}

// The bounded re-prompt: the ORIGINAL instruction plus the concrete defects the
// reply was rejected for, and the plain statement that no further round follows
// (the same shape the fan-out engine uses for its schema retries).
function rejectionReprompt(basePrompt: string, heading: string, reasons: string[]): string {
  return (
    basePrompt +
    "\n\n" +
    heading +
    "\n" +
    reasons.map((reason) => "- " + reason).join("\n") +
    "\nFix EVERY defect above and reply again with a single valid JSON object. This is the " +
    "ONLY re-prompt: a reply that still violates any of these rules is rejected outright."
  );
}

// ---------------------------------------------------------------------------
// conductor_decompose (§3.2)
// ---------------------------------------------------------------------------

export interface DecomposeInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  sessionID?: string;
  now?: () => number;
}

export interface DecomposeResult {
  itemIds: string[]; // every created item, in queue order
  runState: RunState; // DECOMPOSED on acceptance (a rejection throws instead)
}

// The `decompose.md` doctrine, inlined: the queue shape plus every §3.2 rule the
// handler will REJECT on, stated up front (and parameterised by the config the
// handler judges with) so the planner is told the law before it guesses at it.
function decomposePrompt(userPrompt: string, config: Config): string {
  const behavioralPaths =
    config.verify.behavioralPaths.length > 0
      ? config.verify.behavioralPaths.join(", ")
      : "(none configured)";
  return (
    "Decompose the following work request into a queue of independently implementable items. " +
    "Reply with a single JSON object matching the Queue schema (items: id, title, rationale, " +
    "fileScope, testScope, acceptance, behavioral, dependsOn, ponytail).\n" +
    "The handler REJECTS a decomposition that breaks any of these (§3.2):\n" +
    "- dependsOn names other item ids and must form a DAG: no cycle, no dangling id.\n" +
    "- every item declares a non-empty fileScope; an item that writes nothing is not an item.\n" +
    "- testScope is non-empty IF AND ONLY IF behavioral is true.\n" +
    "- behavioral:false is legal ONLY when every fileScope glob is DISJOINT from the " +
    "configured behavioral paths: " +
    behavioralPaths +
    ".\n" +
    "- acceptance criteria are observable checks an assertion can run, never quality wishes.\n" +
    "- each item stays at or under " +
    String(config.workflow.trivialMaxFiles) +
    " files and one acceptance cluster; split anything bigger.\n" +
    ponytailLaw(config) +
    "\nREQUEST:\n" +
    userPrompt
  );
}

// The ponytail law AS IT WILL BE ENFORCED at the configured intensity (§6.3).
// `lite` records the ladder but is advisory, so telling the planner a lite rung
// "is rejected" states a law validateQueue does not apply; `ultra` additionally
// instructs the planner to challenge the requirements themselves.
function ponytailLaw(config: Config): string {
  if (config.ponytail === "lite") {
    return (
      '- every item records its ponytail ladder rung and reuse note; under intensity "lite" the ' +
      "ladder is advisory — recorded for the reader, not enforced by the handler.\n"
    );
  }
  const enforced =
    '- every item records its ponytail ladder rung and reuse note; under intensity "' +
    config.ponytail +
    '" a "minimal-code" rung with an empty reuse note is rejected.\n';
  if (config.ponytail === "ultra") {
    return (
      enforced +
      "- challenge the requirements themselves: propose the smallest version that satisfies the " +
      "request, and say plainly when a requested piece is unnecessary (§6.3 ultra).\n"
    );
  }
  return enforced;
}

// Dispatch the `planner` role (schema "Queue") through the injected Fanout,
// judge the reply against the §3.2 table with the pure core, re-prompt ONCE with
// the named defects, and on acceptance persist queue.json + the §2.5 PENDING
// items and advance INTAKE->DECOMPOSED. A reply that still fails is REJECTED —
// the Promise rejects with the named reason and nothing is written.
export async function handleDecompose(input: DecomposeInput): Promise<DecomposeResult> {
  const { store, fanout, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);
  const run = store.loadRun(runId);

  // (1) legality FIRST, before a single sub-session is spent: only an INTAKE run
  //     classified `work` decomposes (§3.1's classification-selected exit).
  const edge = legalRunTransition(run.state, "DECOMPOSED", {
    classification: run.classification.kind,
  });
  if (!edge.ok) {
    throw new Error(
      "conductor_decompose: " + (edge.why ?? "this run may not advance to DECOMPOSED"),
    );
  }

  // (2) derive: the planner proposes, the §3.2 table disposes.
  const basePrompt = decomposePrompt(run.prompt, config);
  let promptText = basePrompt;
  let accepted: Queue | null = null;
  let violations: string[] = [];
  for (let attempt = 1; attempt <= PLANNER_ATTEMPTS; attempt += 1) {
    const result = await fanout.dispatch(plannerJob(promptText, "Queue"));
    const candidate = result.value as Queue | undefined;
    if (candidate === undefined) {
      throw new Error(
        "conductor_decompose: the planner sub-session produced no valid Queue (" +
          JSON.stringify(result.error) +
          ")",
      );
    }
    const verdict = validateQueue(candidate, config);
    if (verdict.ok) {
      accepted = candidate;
      break;
    }
    violations = verdict.violations;
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "decompose", attempt, violations },
      { runId, sessionID: input.sessionID },
    );
    if (attempt < PLANNER_ATTEMPTS) {
      promptText = rejectionReprompt(
        basePrompt,
        "Your decomposition was REJECTED for these defects:",
        violations,
      );
    }
  }
  if (accepted === null) {
    throw new Error(
      "conductor_decompose: the decomposition is REJECTED — it still violates §3.2 after the " +
        "one bounded re-prompt: " +
        violations.join("; "),
    );
  }

  // (3) persist. Nothing unvalidated reaches the disk: the fan-out engine already
  //     checked the receipt against SCHEMAS.Queue, and validateQueue judged the
  //     whole §3.2 table above.
  writeFileAtomicSync(path.join(runDir, "queue.json"), JSON.stringify(accepted, null, 2));

  const itemIds: string[] = [];
  for (const queueItem of accepted.items) {
    store.saveItem(runId, newPendingItem(queueItem.id));
    itemIds.push(queueItem.id);
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId: queueItem.id, state: "PENDING", origin: "decompose" },
      { runId, itemId: queueItem.id },
    );
  }

  run.state = "DECOMPOSED";
  store.saveRun(run);

  // (4) journal the run FSM transition; (5) compact return.
  journal.log(
    "info",
    "fsm",
    "transition",
    { to: run.state, items: itemIds.length, tsMs: now() },
    { runId, sessionID: input.sessionID },
  );

  return { itemIds, runState: run.state };
}

// ---------------------------------------------------------------------------
// conductor_plan (§3.2)
// ---------------------------------------------------------------------------

export interface PlanInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  sessionID?: string;
  now?: () => number;
}

export interface PlanResult {
  planPath: string; // the written plan.md
  decisionIds: string[]; // the §2.7 ids minted for the plan's forks, in plan order
  runState: RunState; // PLANNED on acceptance (a rejection throws instead)
}

// Read the run's decomposed queue back for the plan prompt. A DECOMPOSED run
// that has no (or a malformed) queue.json is corrupt, not plannable — and that
// is a legality failure, so it throws BEFORE any sub-session is spent.
function readQueueJson(runDir: string, tool: string): Queue {
  const queuePath = path.join(runDir, "queue.json");
  if (!existsSync(queuePath)) {
    throw new Error(
      tool + ": this run has no queue.json at " + queuePath + "; decompose must run first (§3.2)",
    );
  }
  // BOM-tolerant like every other §2 read, and a torn/corrupt file is a NAMED
  // legality failure — a raw SyntaxError names neither the tool nor the file.
  const raw = readFileSync(queuePath, "utf8").replace(/^﻿/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      tool + ": queue.json at " + queuePath + " is not valid JSON: " + (error as Error).message,
    );
  }
  const result = validate("Queue", parsed);
  if (!result.ok) {
    throw new Error(
      tool + ": queue.json does not satisfy the §2.4 Queue schema: " + result.errors.join("; "),
    );
  }
  return parsed as Queue;
}

// The `plan.md` doctrine, inlined: the writing-plans rules (exact paths,
// bite-sized steps, complete code for non-obvious steps, NO placeholders — the
// three §3.2 defects named), the §2.7 >=2-scored-options rule, and the §6.3
// ponytail guardrails at the configured intensity, over the decomposed queue the
// plan must cover item by item.
function planPrompt(userPrompt: string, queue: Queue, config: Config): string {
  const itemLines = queue.items
    .map(
      (item) =>
        "- " +
        item.id +
        " (" +
        (item.behavioral ? "behavioral" : "non-behavioral") +
        "): " +
        item.title +
        " | fileScope: " +
        item.fileScope.join(", ") +
        " | testScope: " +
        (item.testScope.length > 0 ? item.testScope.join(", ") : "(none)") +
        " | acceptance: " +
        item.acceptance.join("; "),
    )
    .join("\n");
  return (
    "Write the execution plan for the decomposed queue below. Reply with a single JSON object " +
    'matching the Plan schema (markdown, decisions).\n"markdown" IS plan.md: per-item test ' +
    "strategy, the design alternatives considered, the risks, and the execution order proposal " +
    "— exact paths, bite-sized steps, complete code for every non-obvious step. NO " +
    'placeholders: "TBD", "add error handling" and "similar to task N" are plan defects BY ' +
    'NAME and the handler rejects the whole plan for them.\n"decisions" records every ' +
    "consequential fork: at least 2 real options, EACH scored on the five criteria " +
    "(capability, testability, movingParts, validationEarliness, singleSource), plus the " +
    'choice, the why, the kind ("derived" for anything derivable; "human" only for taste, ' +
    'money, irreversible commitments or secrets) and appliedWhere. A "derived" fork carrying ' +
    "fewer than 2 scored options is rejected.\nPonytail intensity is \"" +
    config.ponytail +
    '": plan the minimal thing that satisfies the request, and never lazy on the ' +
    "intensity-independent guardrails — security, input validation at trust boundaries, " +
    "data-loss handling and accessibility (§6.3).\n\nQUEUE:\n" +
    itemLines +
    "\n\nREQUEST:\n" +
    userPrompt
  );
}

// The ledger fields of a plan's decision proposal — everything but the `id` and
// `tsIso` this handler mints. `score` is re-attached only when the proposal
// carried one, so an unscored option never lands an explicit `score: undefined`
// key in a record the §2.7 schema forbids extra properties on.
function planDecisionFields(proposal: PlanDecision): PlanDecision {
  return {
    question: proposal.question,
    options: proposal.options.map((option) =>
      option.score === undefined ? { name: option.name } : { name: option.name, score: option.score },
    ),
    choice: proposal.choice,
    why: proposal.why,
    kind: proposal.kind,
    appliedWhere: proposal.appliedWhere,
  };
}

// EVERY defect in a candidate plan, collected in ONE pass so the single bounded
// re-prompt carries the whole truth. Two classes: the plan.md placeholder
// doctrine, applied to the document AND to each decision proposal's prose —
// §3.2 makes the recorded decisions part of the same plan output, so a "TBD" in
// a decision would otherwise be minted into the PERMANENT §2.7 ledger while the
// identical string in the markdown rejects the whole plan — and the §2.7
// >=2-scored-options gate, the same one conductor_decide applies. The id/tsIso
// stand-ins are empty because requireTwoOptions reads only `kind` and `options`.
function planDefects(candidate: Plan, proposals: readonly PlanDecision[]): string[] {
  const defects: string[] = [];
  for (const defect of scanPlaceholders(candidate.markdown)) {
    defects.push("plan.md placeholder defect: " + defect);
  }
  for (const fields of proposals) {
    const prose = [fields.question, fields.choice, fields.why, fields.appliedWhere]
      .concat(fields.options.map((option) => option.name))
      .join("\n");
    if (prose.trim().length > 0) {
      for (const defect of scanPlaceholders(prose)) {
        defects.push('decision "' + fields.question + '" placeholder defect: ' + defect);
      }
    }
    const gate = requireTwoOptions({ id: "", tsIso: "", ...fields });
    if (!gate.ok) {
      defects.push('decision "' + fields.question + '" is REJECTED: ' + gate.why);
    }
  }
  return defects;
}

// Dispatch the `planner` role (schema "Plan") through the injected Fanout, scan
// the returned document for the plan.md placeholder defects (ONE bounded
// re-prompt), gate every decision proposal through core requireTwoOptions, then
// — and only then — write plan.md, append the minted §2.7 records, and advance
// DECOMPOSED->PLANNED. Legality precedes persist exactly as in conductor_decide:
// a rejected plan leaves no plan.md, no ledger line, and the run in DECOMPOSED.
export async function handlePlan(input: PlanInput): Promise<PlanResult> {
  const { store, fanout, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);
  const run = store.loadRun(runId);

  // (1) legality: only a DECOMPOSED run plans, and it plans over its queue.
  const edge = legalRunTransition(run.state, "PLANNED", {});
  if (!edge.ok) {
    throw new Error("conductor_plan: " + (edge.why ?? "this run may not advance to PLANNED"));
  }
  const queue = readQueueJson(runDir, "conductor_plan");

  // (2) derive: the planner writes plan.md; the plan.md doctrine disposes.
  const basePrompt = planPrompt(run.prompt, queue, config);
  let promptText = basePrompt;
  let accepted: Plan | null = null;
  let acceptedProposals: PlanDecision[] = [];
  let defects: string[] = [];
  for (let attempt = 1; attempt <= PLANNER_ATTEMPTS; attempt += 1) {
    const result = await fanout.dispatch(plannerJob(promptText, "Plan"));
    const candidate = result.value as Plan | undefined;
    if (candidate === undefined) {
      throw new Error(
        "conductor_plan: the planner sub-session produced no valid Plan (" +
          JSON.stringify(result.error) +
          ")",
      );
    }
    const candidateProposals = candidate.decisions.map(planDecisionFields);
    const found = planDefects(candidate, candidateProposals);
    if (found.length === 0) {
      accepted = candidate;
      acceptedProposals = candidateProposals;
      break;
    }
    defects = found;
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "plan", attempt, defects: found },
      { runId, sessionID: input.sessionID },
    );
    if (attempt < PLANNER_ATTEMPTS) {
      promptText = rejectionReprompt(
        basePrompt,
        "Your plan was REJECTED for these defects:",
        defects,
      );
    }
  }
  if (accepted === null) {
    throw new Error(
      "conductor_plan: the plan is REJECTED — these defects survive the one bounded re-prompt: " +
        defects.join("; "),
    );
  }
  const proposals = acceptedProposals;

  // (4) persist: plan.md through the crash-safe primitive, then one ledger line
  //     per decision. Each id is minted immediately BEFORE its own append, so
  //     two decisions never collide on the max-existing-numeric+1 mint.
  const planPath = path.join(runDir, "plan.md");
  writeFileAtomicSync(planPath, accepted.markdown);

  const decisionIds: string[] = [];
  for (const fields of proposals) {
    const record: DecisionRecord = {
      id: mintDecisionId(runDir),
      tsIso: new Date(now()).toISOString(),
      ...fields,
    };
    appendDecision(runDir, record);
    decisionIds.push(record.id);
    journal.log(
      "info",
      "state",
      "decision.recorded",
      { decisionId: record.id, kind: record.kind, choice: record.choice, origin: "plan" },
      { runId },
    );
  }

  run.state = "PLANNED";
  store.saveRun(run);

  // (5) journal the run FSM transition; (6) compact return.
  journal.log(
    "info",
    "fsm",
    "transition",
    { to: run.state, planPath, decisions: decisionIds.length, tsMs: now() },
    { runId, sessionID: input.sessionID },
  );

  return { planPath, decisionIds, runState: run.state };
}

// ===========================================================================
// (6) The §3.2 PLAN_REVIEWED handler (Task 9.3, plan lines 2596-2604): the
// plan-level adversarial loop. Same §3.4 invariant loop as sections (4) and (5)
// — legality -> derive -> persist -> journal -> compact return — wrapped around
// a BOUNDED round loop:
//
//   review  : readFanout("planReview") fresh `reviewer` sub-sessions, ONE §3.2
//             lens each, every prompt carrying the plan AND the queue;
//   refute  : every `major` finding gets skepticsPerFinding `skeptic`
//             sub-sessions, adjudicated by core findingSurvives (⌈k/2⌉,
//             TIE-UPHOLDS — never re-derived here);
//   exit?   : core legalRunTransition's planReviewGate decides — it admits
//             PLANNED->PLAN_REVIEWED on a clean round (zero surviving majors)
//             OR at the round cap. The handler NEVER re-derives that rule;
//   revise  : below the cap with majors alive, the planner is re-prompted with
//             the surviving findings, plan.md is re-written and
//             run.planReviewRounds increments by exactly one (§3.2 "plan
//             revised, round++"), and the REVISED plan is re-reviewed;
//   cap     : at the cap each still-surviving major becomes a §2.11 question
//             (origin "plan-review-cap") and every item its blocksItems names is
//             set blocked:{questionId, reason, stage:"plan-review"} — a FIELD ON
//             THE ITEM and a row in a ledger with an unblock path
//             (conductor_answer), never an English sentence. The run then
//             PROCEEDS on the remaining items.
// ===========================================================================

// The §3.2 four lenses (plan line 1121). They are four different INSTRUMENTS
// over the same plan+queue, not four samples of one judgement: each reviewer
// sub-session is told exactly one of them and told that the others are held by
// someone else, so the four prompts are pairwise different and no lens is
// silently reviewed twice while another goes unreviewed.
interface ReviewLens {
  id: string;
  charge: string;
}

const PLAN_REVIEW_LENSES: readonly ReviewLens[] = [
  {
    id: "correctness",
    charge:
      "judge whether the plan's design is sound and its steps actually work: are the stated " +
      "approach, the ordering assumptions and the data flow true of the code the plan will " +
      "touch, do the named interfaces line up, and is any step unsound or self-contradictory " +
      "as written? A step that cannot work as written is a major.",
  },
  {
    id: "completeness",
    charge:
      "judge the plan against the user's request: is every part of the request covered by an " +
      "item and by a step that carries it out, and does the plan quietly drop, defer or " +
      "half-answer any of it? The placeholder scan is folded into this lens: \"TBD\", \"to be " +
      'determined", a TODO or FIXME marker, "add error handling", "similar to task N", a bare ' +
      '"..." elision, or a placeholder standing in for real content is a plan defect BY NAME — ' +
      "report every one you find, quoting it.",
  },
  {
    id: "decomposition",
    charge:
      "judge the queue's decomposition quality: is each item ONE bite (a small fileScope and " +
      "an acceptance list about one subject), are the items' write scopes really disjoint " +
      "where the plan has them run together, and is dependsOn honest — every real ordering " +
      "edge declared, none invented, and no cycle?",
  },
  {
    id: "minimality",
    charge:
      "judge the plan for minimality (the ponytail law): does it introduce abstractions, " +
      "layers, options or configuration the request never asked for, and does it write new " +
      "code where something that already exists would serve? Name each unrequested piece and " +
      "each skipped reuse.",
  },
];

// The plan + queue every plan-review dispatch carries. Lens (c) judges scope
// disjointness and DAG honesty, so the queue rides along WHOLE (raw §2.4 JSON),
// never summarised.
function planReviewContext(userPrompt: string, planMd: string, queue: Queue): string {
  return (
    "\n\nTHE USER'S REQUEST:\n" +
    userPrompt +
    "\n\nTHE PLAN (plan.md):\n" +
    planMd +
    "\n\nTHE QUEUE (queue.json):\n" +
    JSON.stringify(queue, null, 2)
  );
}

// The `review.md` doctrine, inlined at plan level: one lens per reviewer, the
// severity rubric by real-world impact, one concern per finding, a citation in
// `evidence` — and the rule that an empty findings list IS the approval, so a
// reviewer never invents a finding to look thorough.
function lensPrompt(lens: ReviewLens, userPrompt: string, planMd: string, queue: Queue): string {
  return (
    "You are a plan reviewer holding ONE lens over the whole plan and its queue. Reply with a " +
    "single JSON object matching the Findings schema (findings: id, severity, lens, claim, " +
    "evidence, suggestedFix).\n" +
    'Your lens is "' +
    lens.id +
    '": ' +
    lens.charge +
    "\n" +
    "Report ONLY what your lens sees — a different reviewer holds each of the other lenses, so " +
    "anything outside yours is not your seat.\n" +
    "An EMPTY findings list is a valid, finished review — it IS the approval. Never invent a " +
    "finding to look thorough.\n" +
    'Severity by real impact: "major" is a genuine defect that must be fixed before this plan ' +
    'is executed (wrong result, a broken contract, a missing requirement); "minor" is a smaller ' +
    'robustness issue; "nit" is cosmetic and blocks nothing. One concern per finding — never ' +
    "bundle a defect and a quibble into one.\n" +
    'Set `lens` to "' +
    lens.id +
    "\" and make `evidence` cite the plan section or the queue item id your claim rests on: a " +
    "claim naming the item id or the file path it is about is the one that can be acted on.\n" +
    "Give each finding a short stable `id` and a `suggestedFix` that is the smallest correct " +
    "change." +
    planReviewContext(userPrompt, planMd, queue)
  );
}

// The `skeptic.md` doctrine, inlined: refute this ONE finding in isolation,
// uphold only what you personally could not refute, and default to REFUTED when
// undecided. The finding travels alone — a skeptic is never shown its siblings
// (cross-contamination is how noise survives).
function skepticRefutePrompt(
  finding: Findings["findings"][number],
  lens: string,
  k: number,
  userPrompt: string,
  planMd: string,
  queue: Queue,
): string {
  return (
    "You are a skeptic. Your job is to REFUTE the finding below — not to appreciate it, not to " +
    "improve it, and not to wave it through. Reply with a single JSON object matching the " +
    "Verdict schema (findingId, upheld, reasoning).\n" +
    "Set `findingId` to exactly \"" +
    finding.id +
    '". Set `upheld` true ONLY if you personally could not refute the claim against the plan; ' +
    "when you cannot decide, the verdict is REFUTED (upheld false) — uncertainty is not " +
    "evidence of a defect. You are one of " +
    String(k) +
    " independent skeptics on this ONE finding and it survives iff at least ⌈k/2⌉ of you " +
    "uphold it, so do not uphold to be agreeable. Judge exactly this finding, in isolation; " +
    "never invent a defect the reviewer did not raise. `reasoning` names the plan section you " +
    "checked and either the failing case you constructed or the reproduction you tried and " +
    "could not make fail.\n\nTHE FINDING UNDER REVIEW (id " +
    finding.id +
    ", severity " +
    finding.severity +
    ", lens " +
    lens +
    "):\nclaim: " +
    finding.claim +
    "\nevidence: " +
    finding.evidence +
    "\nsuggested fix: " +
    finding.suggestedFix +
    planReviewContext(userPrompt, planMd, queue)
  );
}

// A finding as the handler carries it between the round's stages: the §2.10
// record, the lens that raised it, and the sub-session that did — the provenance
// a cap question records in `askedBy`.
interface RaisedFinding {
  finding: Findings["findings"][number];
  lens: string;
  sessionID: string;
}

function renderFinding(raised: RaisedFinding): string {
  return (
    "- [" +
    raised.finding.id +
    " | " +
    raised.lens +
    "] " +
    raised.finding.claim +
    "\n  evidence: " +
    raised.finding.evidence +
    "\n  suggested fix: " +
    raised.finding.suggestedFix
  );
}

// The revision re-prompt (§3.2 "handler re-prompts the planner with the
// findings, plan revised"). It is the SAME plan.md doctrine handlePlan states
// (so the revision is judged by the same law it will be judged by), plus the
// plan as it stands, plus the surviving findings, plus the demand for a
// stand-alone replacement document — plan.md is re-written, never appended to.
function planRevisionPrompt(
  userPrompt: string,
  queue: Queue,
  config: Config,
  planMd: string,
  survivors: readonly RaisedFinding[],
  round: number,
): string {
  return (
    planPrompt(userPrompt, queue, config) +
    "\n\nTHIS IS A REVISION (plan-review round " +
    String(round) +
    "). Your previous plan was reviewed by four independent lenses and these MAJOR findings " +
    "each survived a panel of skeptics whose job was to refute them:\n" +
    survivors.map(renderFinding).join("\n") +
    "\n\nYOUR PREVIOUS PLAN (plan.md as it stands):\n" +
    planMd +
    "\n\nResolve EVERY finding above — fix it in the plan, or state in the plan why the finding " +
    "is wrong and what the plan does instead. Reply with the COMPLETE revised document in " +
    "`markdown`: it REPLACES plan.md wholesale, so it must stand alone."
  );
}

// The §2.11 question a surviving major becomes when the round cap is reached.
// It carries the claim verbatim (that is what the human is being asked about),
// the evidence, and the concrete choices — this is the ask, not a status line.
function capQuestionText(raised: RaisedFinding, rounds: number, max: number): string {
  return (
    "Plan review reached its round cap (" +
    String(rounds) +
    " of " +
    String(max) +
    " revision round(s) spent) with this major finding from the " +
    raised.lens +
    " lens still surviving its skeptics: " +
    raised.finding.claim +
    "\nEvidence: " +
    raised.finding.evidence +
    "\nSuggested fix: " +
    raised.finding.suggestedFix +
    "\nThe plan stands as written and the items named below are blocked until you answer: say " +
    "how the plan should handle this, or that it should proceed as written."
  );
}

export interface PlanReviewInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  sessionID?: string;
  now?: () => number;
}

export interface PlanReviewResult {
  runState: RunState; // PLAN_REVIEWED on both exits (clean round and round cap)
  rounds: number; // the final run.planReviewRounds (REVISION rounds spent)
  questionIds: string[]; // the cap's §2.11 questions ([] on a clean exit)
  blockedItemIds: string[]; // the items those questions blocked ([] on a clean exit)
}

// One review round: the lens fan-out, then the per-major skeptic panels, then
// the survival adjudication. Returns every finding raised (for the journal's
// counts) and the majors that survived their panels.
async function planReviewRound(
  fanout: Fanout,
  config: Config,
  userPrompt: string,
  planMd: string,
  queue: Queue,
): Promise<{ raised: RaisedFinding[]; survivors: RaisedFinding[]; lenses: string[] }> {
  // (a) the lens fan-out.
  // COVERAGE FIRST. §3.2 names four lenses and they are the substance of this
  // stage, so the roster is never smaller than the lens set: sizing it by
  // readFanout alone (min(planReviewers, parallel.maxReaders)) silently dropped
  // lenses (c) and (d) whenever the reader clamp was below four, and at
  // maxReaders 0 dispatched NOTHING while still advancing the run to
  // PLAN_REVIEWED — a plan that "passed review" on evidence nobody gathered.
  // The clamp is a CONCURRENCY knob and the fan-out engine already enforces it
  // internally (it admits at most maxReaders jobs at a time), so honouring
  // coverage here costs nothing operationally; a larger readFanout still buys a
  // second independent holder for a lens rather than a fifth kind of review.
  const count = Math.max(readFanout("planReview", config), PLAN_REVIEW_LENSES.length);
  const lenses: ReviewLens[] = [];
  for (let i = 0; i < count; i += 1) {
    lenses.push(PLAN_REVIEW_LENSES[i % PLAN_REVIEW_LENSES.length]);
  }
  const lensJobs: FanoutJob[] = lenses.map((lens) => ({
    role: "reviewer",
    itemId: "",
    tree: "",
    writeCapable: false,
    prompt: lensPrompt(lens, userPrompt, planMd, queue),
    schemaName: "Findings",
    priority: "interactive",
    lens: lens.id,
  }));
  const lensResults = await fanout.dispatchWave(lensJobs);

  const raised: RaisedFinding[] = [];
  for (const [index, result] of lensResults.entries()) {
    const findings = result.value as Findings | undefined;
    // A lens that produced nothing is a BLIND SPOT, not a clean bill of health:
    // reporting "no findings" for a lens that never ran would advance the run on
    // evidence nobody gathered. The four lenses are different instruments and
    // none substitutes for another, so a missing one aborts the review (the run
    // is untouched and the tool can simply be run again).
    if (findings === undefined) {
      throw new Error(
        'conductor_plan_review: the "' +
          lenses[index].id +
          '" lens sub-session produced no valid Findings (' +
          JSON.stringify(result.error) +
          ")",
      );
    }
    for (const finding of findings.findings) {
      raised.push({ finding, lens: lenses[index].id, sessionID: result.sessionID });
    }
  }

  // (b) skeptics: exactly skepticsPerFinding refuters per MAJOR (§3.2). Minors
  //     and nits get none — they gate nothing, so refuting them buys nothing.
  const majors = raised.filter((entry) => entry.finding.severity === "major");
  const k = config.workflow.skepticsPerFinding;
  // skepticsPerFinding is schema-valid at 0, and findingSurvives([], 0) is
  // vacuously true — so an empty panel would have made EVERY major auto-survive
  // with no adjudication at all, silently choosing the most consequential
  // reading of "no skeptics configured". A major that cannot be adjudicated is
  // a configuration error, said out loud, before anything is spent.
  if (majors.length > 0 && k < 1) {
    throw new Error(
      "conductor_plan_review: workflow.skepticsPerFinding is " +
        String(k) +
        ", so the " +
        String(majors.length) +
        " major finding(s) this round cannot be adjudicated by any skeptic panel; " +
        "configure at least one skeptic per finding (§3.2)",
    );
  }
  const skepticJobs: FanoutJob[] = [];
  for (const major of majors) {
    for (let i = 0; i < k; i += 1) {
      skepticJobs.push({
        role: "skeptic",
        itemId: "",
        tree: "",
        writeCapable: false,
        prompt: skepticRefutePrompt(major.finding, major.lens, k, userPrompt, planMd, queue),
        schemaName: "Verdict",
        priority: "interactive",
      });
    }
  }
  const verdictResults = skepticJobs.length > 0 ? await fanout.dispatchWave(skepticJobs) : [];

  // (c) survival, adjudicated by the core rule (⌈k/2⌉, TIE-UPHOLDS) over the
  //     panel each major was given. A verdict is bound to its finding by the JOB
  //     that asked for it, not by the reply's self-declared findingId, so a
  //     confused skeptic cannot vote in another finding's panel. A panel member
  //     that env-failed contributes no uphold (the skeptic doctrine's default is
  //     refuted), but a panel where EVERY member failed adjudicated nothing —
  //     that major is neither refuted nor upheld, so the review aborts rather
  //     than guessing in either direction.
  const survivors: RaisedFinding[] = [];
  for (const [index, major] of majors.entries()) {
    const panel: Verdict[] = [];
    for (let i = 0; i < k; i += 1) {
      const verdict = verdictResults[index * k + i]?.value as Verdict | undefined;
      if (verdict !== undefined) panel.push(verdict);
    }
    if (k > 0 && panel.length === 0) {
      throw new Error(
        'conductor_plan_review: no skeptic verdict came back for major finding "' +
          major.finding.id +
          '" — it is unadjudicated, so the review cannot say whether it survives',
      );
    }
    if (findingSurvives(panel, k)) survivors.push(major);
  }

  return { raised, survivors, lenses: lenses.map((lens) => lens.id) };
}

// Re-prompt the planner for a revised plan and accept it under the SAME plan.md
// law handlePlan applies (placeholder doctrine + the §2.7 >=2-scored-options
// gate), with the same ONE bounded re-prompt. A revision that still violates the
// law is REJECTED: the throw leaves plan.md and the run exactly as they were.
async function reviseAcceptedPlan(
  fanout: Fanout,
  basePrompt: string,
  journal: HandlerJournal,
  runId: string,
  sessionID: string | undefined,
  round: number,
): Promise<{ plan: Plan; proposals: PlanDecision[] }> {
  let promptText = basePrompt;
  let defects: string[] = [];
  for (let attempt = 1; attempt <= PLANNER_ATTEMPTS; attempt += 1) {
    const result = await fanout.dispatch(plannerJob(promptText, "Plan"));
    const candidate = result.value as Plan | undefined;
    if (candidate === undefined) {
      throw new Error(
        "conductor_plan_review: the planner sub-session produced no valid revised Plan (" +
          JSON.stringify(result.error) +
          ")",
      );
    }
    const proposals = candidate.decisions.map(planDecisionFields);
    const found = planDefects(candidate, proposals);
    if (found.length === 0) return { plan: candidate, proposals };
    defects = found;
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "plan-review-revision", round, attempt, defects: found },
      { runId, sessionID },
    );
    if (attempt < PLANNER_ATTEMPTS) {
      promptText = rejectionReprompt(
        basePrompt,
        "Your revised plan was REJECTED for these defects:",
        defects,
      );
    }
  }
  throw new Error(
    "conductor_plan_review: the revised plan is REJECTED — these defects survive the one " +
      "bounded re-prompt: " +
      defects.join("; "),
  );
}

/**
 * conductor_plan_review (§3.2 PLAN_REVIEWED). Runs the bounded plan-level
 * adversarial loop over the run's plan.md + queue.json and settles it: a clean
 * round advances PLANNED->PLAN_REVIEWED with nothing blocked; the round cap
 * advances it too, after converting every still-surviving major into a §2.11
 * question (origin "plan-review-cap") and blocking exactly the items that
 * question names — the run then proceeds on the rest.
 */
export async function handlePlanReview(input: PlanReviewInput): Promise<PlanReviewResult> {
  const { store, fanout, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);
  const run = store.loadRun(runId);

  // (1) legality FIRST, before a single sub-session is spent. The §3.1 edge is
  //     probed with the most permissive context (a clean round), so this rejects
  //     exactly the runs that can NEVER reach PLAN_REVIEWED from where they are;
  //     the real exit gate is re-asked below each round with the round's actual
  //     counts, and it — not this handler — owns the clean/cap exit rule.
  const edge = legalRunTransition(run.state, "PLAN_REVIEWED", { survivingMajors: 0 });
  if (!edge.ok) {
    throw new Error(
      "conductor_plan_review: " + (edge.why ?? "this run may not advance to PLAN_REVIEWED"),
    );
  }
  const queue = readQueueJson(runDir, "conductor_plan_review");
  const planPath = path.join(runDir, "plan.md");
  if (!existsSync(planPath)) {
    throw new Error(
      "conductor_plan_review: this run has no plan.md at " +
        planPath +
        "; conductor_plan must run first (§3.2)",
    );
  }
  let planMd = readFileSync(planPath, "utf8");
  const max = config.workflow.planReviewMaxRounds;

  // (2) derive: review -> refute -> adjudicate -> (revise and go again). The
  //     loop is bounded by the cap the gate enforces, and every iteration either
  //     exits or consumes one revision round, so it always terminates.
  let survivors: RaisedFinding[] = [];
  let lensRoster: string[] = [];
  let raisedCounts = { major: 0, minor: 0, nit: 0 };
  for (;;) {
    const outcome = await planReviewRound(fanout, config, run.prompt, planMd, queue);
    survivors = outcome.survivors;
    lensRoster = outcome.lenses;
    raisedCounts = {
      major: outcome.raised.filter((e) => e.finding.severity === "major").length,
      minor: outcome.raised.filter((e) => e.finding.severity === "minor").length,
      nit: outcome.raised.filter((e) => e.finding.severity === "nit").length,
    };

    const exit = legalRunTransition(run.state, "PLAN_REVIEWED", {
      survivingMajors: survivors.length,
      round: run.planReviewRounds,
      max,
    });
    if (exit.ok) break;

    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      {
        stage: "plan-review",
        round: run.planReviewRounds,
        max,
        findings: outcome.raised.length,
        survivingMajors: survivors.length,
        why: exit.why,
      },
      { runId, sessionID: input.sessionID },
    );

    // A surviving major below the cap: re-prompt the planner with the findings,
    // re-write plan.md, round++ — then re-review the REVISED plan (§3.2).
    const nextRound = run.planReviewRounds + 1;
    const revision = await reviseAcceptedPlan(
      fanout,
      planRevisionPrompt(run.prompt, queue, config, planMd, survivors, nextRound),
      journal,
      runId,
      input.sessionID,
      nextRound,
    );
    planMd = revision.plan.markdown;
    writeFileAtomicSync(planPath, planMd);
    for (const fields of revision.proposals) {
      const record: DecisionRecord = {
        id: mintDecisionId(runDir),
        tsIso: new Date(now()).toISOString(),
        ...fields,
      };
      appendDecision(runDir, record);
      journal.log(
        "info",
        "state",
        "decision.recorded",
        { decisionId: record.id, kind: record.kind, choice: record.choice, origin: "plan-review" },
        { runId },
      );
    }
    run.planReviewRounds = nextRound;
    store.saveRun(run);
  }

  // (3) persist the cap products, if this was a cap exit. `survivors` is empty on
  //     a clean round, so this whole block is a no-op there.
  //
  //     Legality before persist, again: every item a surviving major names must
  //     exist as a runtime item, checked for ALL survivors BEFORE the first
  //     question is written, so a corrupt queue cannot leave a half-applied set
  //     of questions and blocks behind.
  //     An Item carries ONE `blocked` disposition, so two survivors naming the
  //     same item cannot both own it. The claim is therefore resolved HERE,
  //     cumulatively: the first survivor to name an item owns it, and later
  //     survivors drop it from their own blocksItems. Recording it in both
  //     ledgers made the second row FALSE on disk — and worse, answering the
  //     first question released an item the second surviving major still
  //     condemned. A question's blocksItems now names exactly the items whose
  //     blocked.questionId is that question.
  const claimed = new Set<string>();
  const mapped = survivors.map((survivor) => {
    const named = findingBlocksItems(survivor.finding, queue.items);
    const owned = named.filter((itemId) => !claimed.has(itemId));
    for (const itemId of owned) claimed.add(itemId);
    return { survivor, itemIds: owned };
  });
  for (const entry of mapped) {
    for (const itemId of entry.itemIds) {
      try {
        store.loadItem(runId, itemId);
      } catch {
        throw new Error(
          'conductor_plan_review: surviving finding "' +
            entry.survivor.finding.id +
            '" names queue item "' +
            itemId +
            '", which has no runtime item file; refusing to surface a half-applied cap',
        );
      }
    }
  }

  const questionIds: string[] = [];
  const blockedItemIds: string[] = [];
  for (const entry of mapped) {
    const question = capQuestionText(entry.survivor, run.planReviewRounds, max);
    // §2.11 keeps humanTerritory the core VERDICT on the text, never a flag the
    // caller fabricates. (Asking is legal here regardless: §3.2 spends the whole
    // bounded machine loop first, so the cap is the point where the machine has
    // provably run out of moves.)
    const record = appendQuestion(
      runDir,
      {
        runId,
        question,
        askedBy: { role: "reviewer", sessionID: entry.survivor.sessionID },
        humanTerritory: isHumanTerritory(question),
        origin: "plan-review-cap",
        blocksItems: [...entry.itemIds],
      },
      now(),
    );
    questionIds.push(record.id);

    for (const itemId of entry.itemIds) {
      // An item carries ONE `blocked` disposition, so the first surviving major
      // that names it owns the block; a later question still records the item in
      // its own blocksItems (that is what the finding says), but it does not
      // overwrite the questionId the unblock path (conductor_answer) keys on.
      if (blockedItemIds.includes(itemId)) continue;
      store.setBlocked(runId, itemId, {
        reason:
          "blocked on plan-review question " +
          record.id +
          ": " +
          entry.survivor.finding.claim,
        stage: "plan-review",
        questionId: record.id,
      });
      blockedItemIds.push(itemId);
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, blocked: true, questionId: record.id, stage: "plan-review" },
        { runId, itemId },
      );
    }
  }

  run.state = "PLAN_REVIEWED";
  store.saveRun(run);

  // (4) journal the run FSM transition; (5) compact return. The run PROCEEDS:
  //     items no surviving major named stay actionable and the wave scheduler
  //     schedules them next (§3.2 "the run proceeds on the remaining items").
  journal.log(
    "info",
    "fsm",
    "transition",
    {
      to: run.state,
      rounds: run.planReviewRounds,
      lenses: lensRoster,
      findingsRaised: raisedCounts,
      survivingMajors: survivors.length,
      questions: questionIds.length,
      blockedItems: blockedItemIds.length,
      tsMs: now(),
    },
    { runId, sessionID: input.sessionID },
  );

  return {
    runState: run.state,
    rounds: run.planReviewRounds,
    questionIds,
    blockedItemIds,
  };
}

// ===========================================================================
// (7) The §3.3 RED-stage item handlers (Task 9.4a, plan lines 2612-2623): the
// two tools that carry a BEHAVIORAL item from PENDING to TEST_VETTED —
// conductor_submit_test (PENDING->RED) and conductor_vet_test (RED->TEST_VETTED).
// Same §3.4 invariant loop as sections (4)-(6): legality -> derive -> persist ->
// journal -> compact return.
//
// Two rules shape everything here:
//
//   THE HANDLER RUNS THE TEST, NOT THE MODEL (§3.3). Every run and re-run goes
//   through adapter/evidence.ts runTest — the only writer of evidence.jsonl —
//   which substitutes the §2.1 itemTest template, applies the zero-test policy,
//   classifies the failure through core classifyFailure (§2.6.1) and appends +
//   journals the §2.6 record. This file therefore spawns nothing itself, never
//   re-classifies a failure, and never re-implements an FSM edge: the red is
//   admitted by core legalItemTransition's redEvidenceGate (exit != 0 AND class
//   in {assertion, missing-subject}) and by nothing else.
//
//   LEGALITY IS THE GATE'S DERIVATION (§3.2). The legality step asks
//   core/gates-phase.ts legalTools whether THIS tool is offered for THIS item,
//   over the same run/queue/item facts the injection renders — so the handler and
//   the gate cannot disagree (the 9.4a/5.3 deferred binding, ENFORCE: a
//   dependency-unready item is offered no stage tool AND refused by the handler,
//   with no recovery bypass). A denial THROWS before any dispatch or persist, the
//   handleDecide/handleDefer convention, so "nothing was written" is checkable.
//
// Every §2.11 question minted here reuses an EXISTING origin — the origin
// vocabulary is CLOSED (core/types.ts QUESTION_ORIGINS) and this task widens
// nothing: "implementer-blocked" wherever the write-capable test-writer is the
// party that got stuck (submit_test's spent repair budget; a writer that replied
// BLOCKED; a mustFix repair that stopped being a legal red) and
// "review-round-cap" at the vet round cap (the vet loop is a review-round cap
// over the test). Likewise every journal name below is already in the closed
// §7.4 vocabulary (core/journal-events.ts EVENTS).
// ===========================================================================

// Until Task 9.6 lands worktrees, every write-capable sub-session works the main
// tree (§3.5) — named once so the two dispatch sites cannot drift.
const STAGE_TREE = "main";

// The §2.10 TEST_VET criteria, READ OUT OF THE REGISTERED SCHEMA rather than
// restated here (G6 single source): the compact return's tally rows are exactly
// the criteria the fan-out engine validates each critic receipt against, in
// schema order.
function testVetCriteria(): string[] {
  const schema = SCHEMAS.TestVet as
    | { properties?: { verdictsByCriterion?: { required?: unknown } } }
    | undefined;
  const required = schema?.properties?.verdictsByCriterion?.required;
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error(
      "conductor_vet_test: SCHEMAS.TestVet declares no §2.10 criteria; the vet tally has no source",
    );
  }
  return required.map((name) => String(name));
}

// evidence.ts takes the full adapter/journal.ts Journal (log + flushSync); the
// handlers carry the leveled sink shape. Forward log verbatim and flushSync only
// when the injected sink actually has one — the handler must never invent a sink
// of its own, or the evidence records would land in a different journal than the
// rest of the stage.
function evidenceJournalOf(journal: HandlerJournal): Journal {
  const sink = journal as HandlerJournal & { flushSync?: () => void };
  return {
    log: (level, component, event, data, corr): void => {
      journal.log(level, component, event, data, corr);
    },
    flushSync: (): void => {
      if (typeof sink.flushSync === "function") sink.flushSync();
    },
  };
}

// The §2.6 red member of the evidence union.
type RedEvidence = Extract<EvidenceRecord, { kind: "red" }>;
type VerifyEvidence = Extract<EvidenceRecord, { kind: "verify" }>;
type ItemTestEvidence = Extract<EvidenceRecord, { kind: "red" | "green" }>;

// ---------------------------------------------------------------------------
// The shared legality step (invariant-loop step 1)
// ---------------------------------------------------------------------------

// Everything a stage handler needs once legality has passed: the run, the §2.4
// queue and this item's entry in it, and the §2.5 runtime item.
interface StageContext {
  run: Run;
  queue: Queue;
  queueItem: QueueItem;
  item: Item;
}

// The gate's view of the run's items, built from queue.json's structural facts
// (behavioral/dependsOn/fileScope) plus each runtime item file's FSM position and
// annotations. A queue item with no runtime file contributes nothing — it cannot
// be scheduled and, being un-PUBLISHED, still holds its dependents back.
function gateItemsOf(store: StateStore, runId: string, queue: Queue): GateItem[] {
  const gateItems: GateItem[] = [];
  for (const qi of queue.items) {
    let item: Item;
    try {
      item = store.loadItem(runId, qi.id);
    } catch {
      continue;
    }
    gateItems.push({
      id: qi.id,
      state: item.state,
      behavioral: qi.behavioral,
      dependsOn: [...qi.dependsOn],
      fileScope: [...qi.fileScope],
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
    });
  }
  return gateItems;
}

// The dependencies of `queueItem` that are not PUBLISHED yet (§4.2: nothing below
// PUBLISHED unlocks a dependent; an id with no runtime item is never published).
function unpublishedDeps(queueItem: QueueItem, gateItems: GateItem[]): string[] {
  const stateById = new Map<string, string>();
  for (const gi of gateItems) stateById.set(gi.id, gi.state);
  return queueItem.dependsOn.filter((dep) => stateById.get(dep) !== "PUBLISHED");
}

// Why the gate does not offer `tool` for this item, in the terms the caller can
// act on. The alternative stage tool is read back OUT OF THE SAME VERDICT rather
// than re-derived, so the message can never name a path the gate would refuse.
function stageDenyReason(
  tool: string,
  verdict: LegalToolsResult,
  context: { run: Run; queueItem: QueueItem; item: Item; gateItems: GateItem[] },
): string {
  const { run, queueItem, item } = context;
  if (run.state !== "EXECUTING") {
    return (
      'item "' +
      queueItem.id +
      '" cannot run a stage tool: the run is at ' +
      run.state +
      ", not EXECUTING (§3.2)"
    );
  }
  if (item.blocked !== null) {
    return (
      'item "' +
      queueItem.id +
      '" is blocked on question ' +
      (item.blocked.questionId ?? "(unspecified)") +
      " (" +
      item.blocked.reason +
      "); a blocked item makes no transition until conductor_answer resolves it (§3.3)"
    );
  }
  if (item.deferred !== null) {
    return (
      'item "' + queueItem.id + '" is deferred (' + item.deferred.reason + "); it makes no transition (§3.3)"
    );
  }
  const unready = unpublishedDeps(queueItem, context.gateItems);
  if (unready.length > 0) {
    return (
      'item "' +
      queueItem.id +
      '" is dependency-UNREADY: it dependsOn ' +
      unready.join(", ") +
      ", which " +
      (unready.length === 1 ? "is" : "are") +
      " not PUBLISHED yet — nothing below PUBLISHED unlocks a dependent (§4.2), so " +
      tool +
      ' is refused for "' +
      queueItem.id +
      '"'
    );
  }
  // The gate's own answer to "what MAY this item do right now", read back out of
  // the verdict: a non-behavioral PENDING item is offered conductor_mark_green,
  // and that is the path the deny message must name (§3.3, §2.4).
  for (const [name, hint] of verdict.legal) {
    if ((hint.itemIds ?? []).includes(queueItem.id)) {
      return (
        'item "' +
        queueItem.id +
        '" is at ' +
        item.state +
        (queueItem.behavioral ? "" : " and is behavioral:false (it owes no test, §2.4)") +
        ": its legal stage tool right now is " +
        name +
        ", not " +
        tool +
        " (§3.3)"
      );
    }
  }
  return 'item "' + queueItem.id + '" is not offered ' + tool + " right now: " + verdict.why;
}

// The legality step both stage handlers share. Loads the run, queue and item,
// asks legalTools whether `tool` is offered for `itemId`, and THROWS a named
// refusal if it is not — before any sub-session is dispatched and before any
// state is written.
function requireStageTool(
  tool: string,
  store: StateStore,
  runId: string,
  itemId: string,
  runDir: string,
): StageContext {
  const run = store.loadRun(runId);
  const queue = readQueueJson(runDir, tool);
  const queueItem = queue.items.find((qi) => qi.id === itemId);
  if (queueItem === undefined) {
    throw new Error(tool + ': item "' + itemId + "\" is not in this run's queue.json; refusing to run the stage");
  }
  let item: Item;
  try {
    item = store.loadItem(runId, itemId);
  } catch {
    throw new Error(tool + ': item "' + itemId + '" has no runtime item file; refusing to run the stage');
  }

  const gateItems = gateItemsOf(store, runId, queue);
  const gateRun: GateRun = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
  };
  // §2.4 paths are repo-relative and stay inside the run's tree. Asserted HERE, at
  // the legality step, because this is the last point before the two things that
  // dereference them: the child test runner takes testScope as argv, and the
  // sub-session prompts read those files' contents. queue.json is model-authored and
  // core validateQueue constrains ids, DAG shape and sizes but never path SHAPE, so
  // an escaping entry would otherwise reach both. The rest of the codebase already
  // refuses exactly this: gates-edit denies a ".." segment before scope matching,
  // state.assertSafeId rejects separators, quarantine rejects absolute paths.
  assertContainedPaths(tool, store.root, itemId, "testScope", queueItem.testScope);
  assertContainedPaths(tool, store.root, itemId, "fileScope", queueItem.fileScope);

  // A crash-torn trailing line in questions.jsonl must fail as a NAMED legality
  // failure — the reader has to know which tool refused and which file to repair —
  // never as a raw SyntaxError naming neither (the shape readQueueJson avoids).
  let questions: Array<{ id: string; answeredIso: string | null }>;
  try {
    questions = readQuestions(runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
  } catch (error) {
    throw new Error(
      tool +
        ": cannot read questions.jsonl in " +
        runDir +
        " (a torn or invalid §2.11 record — repair the file to resume): " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  const verdict = legalTools(gateRun, gateItems, questions, true);
  const offered = verdict.legal.get(tool)?.itemIds ?? [];
  if (!offered.includes(itemId)) {
    throw new Error(tool + ": " + stageDenyReason(tool, verdict, { run, queueItem, item, gateItems }));
  }
  return { run, queue, queueItem, item };
}

// Every declared path must be repo-relative and resolve INSIDE the run's tree. A
// ".." or absolute entry is refused by name — never normalised away silently, since
// the queue that produced it is model-authored and a caller that meant to reach
// outside the tree should be told, not quietly corrected.
function assertContainedPaths(
  tool: string,
  root: string,
  itemId: string,
  label: string,
  rels: string[],
): void {
  const base = path.resolve(root);
  for (const rel of rels) {
    const escapes =
      rel.length === 0 ||
      path.isAbsolute(rel) ||
      rel.split(/[\\/]/).includes("..") ||
      !(path.resolve(base, rel) + path.sep).startsWith(base + path.sep);
    if (escapes) {
      throw new Error(
        tool +
          ': item "' +
          itemId +
          '" declares a ' +
          label +
          ' entry that escapes the run tree: "' +
          rel +
          '". §2.4 paths are repo-relative; the child test runner would take this as argv and the ' +
          "sub-session prompts would read it, so the stage refuses it before either happens",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Running the item test (delegated whole to adapter/evidence.ts)
// ---------------------------------------------------------------------------

// The §2.1 scope names an item's paths require: every requiredScopes entry whose
// pattern matches ANY of them contributes its scopes, deduped in declaration order.
// The item's paths are its testScope UNION its fileScope — an item spanning two path
// families owes what §2.1 requires of each, and one array element cannot speak for
// the rest.
function requiredScopeNames(config: Config, paths: string[]): string[] {
  const names: string[] = [];
  for (const req of config.verify.requiredScopes) {
    if (!paths.some((p) => globMatch(req.pattern, p))) continue;
    for (const name of req.scopes) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

// The paths an item's required scopes are resolved over: everything it declares.
function itemScopePaths(queueItem: QueueItem): string[] {
  return [...queueItem.testScope, ...queueItem.fileScope];
}

// The §2.1 verify scope this item's test runs under: every requiredScopes entry
// whose pattern matches one of the item's own paths contributes its scopes, and a
// scope carrying an itemTest template (the TARGETED run §3.3 depends on) wins over
// one that only has a full-scope command. An item no scope covers has no
// constructible test command — a named legality failure, never a silent full-suite
// fallback.
function itemVerifyScope(config: Config, queueItem: QueueItem, tool: string): ScopeSpec {
  const names = requiredScopeNames(config, itemScopePaths(queueItem));
  const candidates: Array<{ name: string; spec: Config["verify"]["scopes"][string] }> = [];
  for (const name of names) {
    const spec = config.verify.scopes[name];
    if (spec !== undefined) candidates.push({ name, spec });
  }
  if (candidates.length === 0) {
    throw new Error(
      tool +
        ': no verify.requiredScopes entry covers item "' +
        queueItem.id +
        '" (testScope ' +
        JSON.stringify(queueItem.testScope) +
        ", fileScope " +
        JSON.stringify(queueItem.fileScope) +
        "), so this item has no test command (§2.1)",
    );
  }
  const chosen =
    candidates.find((c) => Array.isArray(c.spec.itemTest) && c.spec.itemTest.length > 0) ?? candidates[0];
  return {
    name: chosen.name,
    command: [...chosen.spec.command],
    timeoutMs: chosen.spec.timeoutMs,
    ...(Array.isArray(chosen.spec.itemTest) ? { itemTest: [...chosen.spec.itemTest] } : {}),
  };
}

// One handler-run of the item test. evidence.runTest appends AND journals the
// §2.6 record; the fixture repo IS the store root, which is the test's cwd.
function runItemTest(
  input: { store: StateStore; runId: string; journal: HandlerJournal; now: () => number },
  queueItem: QueueItem,
  scope: ScopeSpec,
  runDir: string,
): RunTestResult {
  return runTest(runDir, queueItem.id, {
    scope,
    testFiles: [...queueItem.testScope],
    cwd: input.store.root,
    fileScope: [...queueItem.fileScope],
    journal: evidenceJournalOf(input.journal),
    runId: input.runId,
    now: input.now,
  });
}

// Whether a run's outcome is admissible as THIS item's red. §2.1's illegal-red rule
// has two halves and core owns only one of them: legalItemTransition applies the
// §2.6.1 class split, and evidence.ts computes the targeting half as `legalRed` —
// `isLegalClass(class) && (targeted || the excerpt names a testScope file)`. Reading
// only the class admits the §3.3 case "a collection failure elsewhere — is NOT red":
// a full-scope fallback run that failed in somebody else's test, on a project whose
// verify scope carries no itemTest template (schema-optional) or whose targeted run
// executed zero tests. Both halves, or it is not this item's red.
function redAdmission(
  outcome: RunTestResult,
  queueItem: QueueItem,
): { ok: boolean; why: string; repairable: boolean } {
  const record = outcome.record;
  if (record.kind !== "red") {
    return { ok: false, why: "the run exited 0, so it is not a red", repairable: false };
  }
  const edge = legalItemTransition("PENDING", "RED", {
    item: { behavioral: queueItem.behavioral, blocked: null },
    testExit: record.exitCode,
    failureClass: record.failureClass,
  });
  if (!edge.ok) {
    return {
      ok: false,
      why: 'the last run failed with §2.6.1 class "' + record.failureClass + '", which is not a red',
      // A broken test is exactly what a test-writer can repair.
      repairable: true,
    };
  }
  if (!outcome.legalRed) {
    // NOT repairable: no edit the writer can make to its own test changes the fact
    // that the run never targeted it. Rewriting the test would spend the whole
    // budget re-observing somebody else's failure, so the stage stops and asks.
    const reasons: string[] = [];
    if (outcome.fellBack) reasons.push("the run fell back to the full verify scope (no §2.1 itemTest template)");
    if (outcome.ranZeroTests) reasons.push("the targeted run executed zero tests");
    if (!outcome.targeted && !outcome.fellBack) reasons.push("the run was not targeted at this item");
    reasons.push("and its output names none of the item's testScope files");
    return {
      ok: false,
      why:
        "the failure is not this item's: " +
        reasons.join(", ") +
        ", so it is a suite failure elsewhere impersonating a red (§2.1, §3.3)",
      repairable: false,
    };
  }
  return { ok: true, why: edge.why ?? "", repairable: false };
}

// ---------------------------------------------------------------------------
// The sub-session prompts (§3.3 roles testWriter + reviewer)
// ---------------------------------------------------------------------------

// The item as its spec: title + rationale + acceptance + the two scopes. Every
// dispatch in this stage carries it, and NONE of them carries the implementation.
function itemSpecBlock(queueItem: QueueItem): string {
  return (
    "\n\nTHE ITEM (queue.json):\n" +
    "id: " +
    queueItem.id +
    "\ntitle: " +
    queueItem.title +
    "\nrationale: " +
    queueItem.rationale +
    "\nacceptance:\n" +
    queueItem.acceptance.map((line) => "- " + line).join("\n") +
    "\ntestScope (the ONLY paths you may write): " +
    queueItem.testScope.join(", ") +
    "\nfileScope (the production paths this item will change LATER — not now): " +
    queueItem.fileScope.join(", ")
  );
}

// The item's test files as they stand on disk. The vet critics judge THIS text,
// and a repair prompt shows the writer what it actually produced.
function testScopeContent(root: string, queueItem: QueueItem): string {
  const parts: string[] = [];
  for (const rel of queueItem.testScope) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) {
      parts.push("--- " + rel + " (not written yet) ---");
      continue;
    }
    parts.push("--- " + rel + " ---\n" + readFileSync(abs, "utf8"));
  }
  return parts.join("\n");
}

// The captured red, rendered for a prompt: the command, the exit code, the §2.6.1
// class and the bounded excerpt — the run's OWN output, never a paraphrase.
function redBlock(record: RedEvidence): string {
  return (
    "\n\nTHE CAPTURED RED (the handler ran this test itself):\n" +
    "command: " +
    record.command.join(" ") +
    "\nexit code: " +
    String(record.exitCode) +
    "\n§2.6.1 failure class: " +
    record.failureClass +
    "\ncaptured output:\n" +
    record.failureExcerpt
  );
}

// The tdd.md charge the test-writer works under (§3.3): test files ONLY, inside
// the item's testScope, and a failure that fails for the RIGHT reason.
function testWriterPrompt(queueItem: QueueItem): string {
  return (
    "You are the TEST-WRITER for one queue item, working under the TDD doctrine: the test " +
    "comes FIRST and must FAIL before any implementation of this item exists.\n" +
    "Write ONLY test files, and only the paths listed in testScope below — the edit-scope gate " +
    "refuses every other path (§2.4). Do NOT write, stub or sketch the production code: another " +
    "sub-session implements it against your test.\n" +
    "Assert the item's ACCEPTANCE as observable behaviour through the subject's public surface — " +
    "not an internal call count, not a mock's bookkeeping — so a subtly wrong implementation " +
    "still fails your test.\n" +
    "THE HANDLER, not you, runs the test after you reply. It is admitted as a RED only when it " +
    'exits non-zero for a §2.6.1-legal reason: "assertion" (the behaviour was evaluated and was ' +
    'wrong) or "missing-subject" (the subject this item is contracted to build does not exist ' +
    'yet). A test that fails to PARSE, or that fails to resolve something OUTSIDE the item\'s ' +
    'fileScope, is class "error" — that is not a red and comes straight back to you for repair. ' +
    "A test that PASSES immediately is rejected outright.\n" +
    "Reply with a single JSON object matching the ImplementerResult schema (status, summary, " +
    "concerns, neededContext, blockReason) once the file is written." +
    itemSpecBlock(queueItem)
  );
}

// The §3.3 repair re-dispatch: the original charge plus the run's OWN captured
// failure and the test as it stands, with the remaining budget stated plainly.
function testRepairPrompt(
  queueItem: QueueItem,
  record: RedEvidence,
  testText: string,
  repair: number,
  max: number,
): string {
  return (
    testWriterPrompt(queueItem) +
    "\n\nYOUR TEST IS NOT A LEGAL RED (repair " +
    String(repair) +
    " of " +
    String(max) +
    "). The handler ran it and the failure classified as \"" +
    record.failureClass +
    '" — the behaviour was never evaluated, so this failure proves nothing about the item.' +
    redBlock(record) +
    "\n\nTHE TEST AS IT STANDS:\n" +
    testText +
    "\n\nRepair the TEST so that it runs and fails for the RIGHT reason (§2.6.1 " +
    '"assertion" or "missing-subject"), then reply again with a single valid ImplementerResult ' +
    "JSON object." +
    (repair >= max
      ? " This is the LAST repair attempt: if it is still not a legal red the item is blocked and " +
        "a question is raised."
      : "")
  );
}

// §3.3 TEST_VET: fresh reviewer critics judging the test on the §2.10 criteria,
// given the spec + the test + the captured red and NOT the implementation.
function vetCriticPrompt(
  queueItem: QueueItem,
  testText: string,
  record: RedEvidence,
  critics: number,
  round: number,
  max: number,
): string {
  return (
    "You are one of " +
    String(critics) +
    " INDEPENDENT test-vet critics judging ONE test, in a fresh context (vet round " +
    String(round) +
    " of at most " +
    String(max) +
    "). You are given the item's spec, the test as written, and the captured red output — and " +
    "deliberately NOT the implementation: none exists yet, and that is the point, since a critic " +
    "shown code that already passes is anchored by it.\n" +
    "Judge the test on exactly these criteria (§2.10 TEST_VET):\n" +
    "- observableBehavior: it asserts observable behaviour through the subject's public surface, " +
    "not internals.\n" +
    "- wouldCatchWrongImpl: a subtly WRONG implementation would still fail it — it is not a " +
    "tautology and it is not testing a mock.\n" +
    "- rightLevel: it is at the right level (unit vs integration) for what it pins.\n" +
    "- pinsAcceptance: it pins THIS item's acceptance criteria, not a neighbouring concern.\n" +
    "- antiPatterns: no anti-patterns — no sleep-based timing, no assertion-free run, no " +
    "snapshot of everything, no test that cannot fail.\n" +
    "Reply with a single JSON object matching the TestVet schema: a verdict {pass, note} for each " +
    "criterion, plus `mustFix` — the concrete changes this test MUST have before it can be " +
    "vetted. An EMPTY mustFix is the approval; never invent a fix to look thorough, and never " +
    "ask for a change that only restates a criterion." +
    itemSpecBlock(queueItem) +
    "\n\nTHE TEST AS WRITTEN:\n" +
    testText +
    redBlock(record)
  );
}

// The mustFix re-dispatch: the UNION of the round's critics, back to the writer.
function vetRepairPrompt(
  queueItem: QueueItem,
  testText: string,
  record: RedEvidence,
  mustFix: readonly string[],
  round: number,
  max: number,
): string {
  return (
    testWriterPrompt(queueItem) +
    "\n\nTHE TEST VET RAISED MUST-FIX ITEMS (vet round " +
    String(round) +
    " of at most " +
    String(max) +
    "). Independent critics judged your test against the item's acceptance and every item below " +
    "must be resolved:\n" +
    mustFix.map((entry) => "- " + entry).join("\n") +
    "\n\nTHE TEST AS IT STANDS:\n" +
    testText +
    redBlock(record) +
    "\n\nRewrite the test so every must-fix item is resolved AND it still fails for a §2.6.1-legal " +
    "reason — the handler re-runs it before the critics see it again, and a test that stops being " +
    "a legal red cannot be vetted. Reply again with a single valid ImplementerResult JSON object."
  );
}

// Every testWriter dispatch in this stage: write-capable, on the main tree, with
// the already-registered ImplementerResult schema (9.4a authors NO schema).
function testWriterJob(itemId: string, prompt: string): FanoutJob {
  return {
    role: "testWriter",
    itemId,
    tree: STAGE_TREE,
    writeCapable: true,
    prompt,
    schemaName: "ImplementerResult",
    priority: "interactive",
  };
}

// The receipt plus the sub-session that produced it: a §2.11 question raised over
// a stuck writer records THAT session in `askedBy` (provenance, not a guess).
async function dispatchTestWriter(
  tool: string,
  fanout: Fanout,
  itemId: string,
  prompt: string,
): Promise<{ reply: ImplementerResult; sessionID: string }> {
  const result = await fanout.dispatch(testWriterJob(itemId, prompt));
  const reply = result.value as ImplementerResult | undefined;
  if (reply === undefined) {
    throw new Error(
      tool +
        ': the test-writer sub-session for item "' +
        itemId +
        '" produced no valid ImplementerResult (' +
        JSON.stringify(result.error) +
        ")",
    );
  }
  return { reply, sessionID: result.sessionID };
}

// ---------------------------------------------------------------------------
// conductor_submit_test (§3.3 PENDING->RED)
// ---------------------------------------------------------------------------

const SUBMIT_TEST_TOOL = "conductor_submit_test";
const VET_TEST_TOOL = "conductor_vet_test";

export interface SubmitTestInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: HandlerJournal;
  sessionID?: string;
  now?: () => number;
}

export interface SubmitTestResult {
  ok: boolean; // true IFF the item advanced PENDING->RED
  itemState: ItemState; // the PERSISTED state after the call
  exitCode: number | null; // the last handler-run test's exit code
  failureClass: FailureClass | null; // the last red's §2.6.1 class (null on a green)
  excerpt: string | null; // the appended record's bounded failureExcerpt
  attempts: number; // TOTAL testWriter dispatches consumed (<= 1 + testRepairAttempts)
  questionId: string | null; // the §2.11 question minted at repair exhaustion
  decisionId: string | null; // the §2.7 record minted on an immediate pass
  fork: string | null; // names the immediate-pass fork for the orchestrator
}

// The two arms of the immediate-pass fork (§3.3: "either the behavior already
// exists — recorded as a decision, ponytail rung skip — or the test is wrong").
// Both are REAL options and both are scored, so the record satisfies §2.7's
// >=2-scored-options rule as core requireTwoOptions enforces it.
const PASS_SKIP_OPTION = "behavior-already-exists (ponytail rung skip; this item may be unnecessary)";
const PASS_WRONG_OPTION = "test-is-wrong (rewrite the test and resubmit)";

/**
 * conductor_submit_test (§3.3 PENDING->RED, behavioral items only). Owns the
 * WHOLE stage: it dispatches the test-writer sub-session (role "testWriter",
 * write-capable, schema ImplementerResult), runs the item test ITSELF through
 * evidence.runTest, and admits the result through core legalItemTransition.
 *
 * exit 0 is a rejection (a passing test is not a red): the ponytail-skip fork is
 * recorded as a §2.7 derived decision and the item is left PENDING and un-blocked
 * for the orchestrator to defer or re-dispatch. Class "error" is not a red
 * either: the captured failure goes back to the writer for repair, bounded at
 * config.workflow.testRepairAttempts REPAIRS (the initial write is not a repair,
 * so at most 1 + testRepairAttempts writer dispatches in all), after which the
 * item is blocked at stage "RED" and ONE §2.11 question is raised.
 */
export async function handleSubmitTest(input: SubmitTestInput): Promise<SubmitTestResult> {
  const { store, fanout, runId, itemId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality — the gate's own derivation, before a single sub-session is
  //     spent and before anything is written.
  const stage = requireStageTool(SUBMIT_TEST_TOOL, store, runId, itemId, runDir);
  const queueItem = stage.queueItem;
  const scope = itemVerifyScope(config, queueItem, SUBMIT_TEST_TOOL);
  // The §2.1 schema types the knob `number` and the subset validator has no integer
  // keyword, so a fractional value loads. Floor it: `repairs >= maxRepairs` with 1.5
  // would spend TWO repairs — a budget the operator never configured. Knobs round
  // down, never up.
  const maxRepairs = Math.max(0, Math.floor(config.workflow.testRepairAttempts));

  // (2) derive: write -> run -> judge, with the bounded repair loop.
  let dispatches = 0;
  let repairs = 0;
  let prompt = testWriterPrompt(queueItem);
  let lastRed: RedEvidence | null = null;
  // The sub-session a §2.11 question would name in `askedBy` (§2.11 provenance):
  // the writer that was working the item when the stage gave up.
  let writerSessionID = input.sessionID ?? "";

  // The shared exhaustion exit (repair budget spent, or a writer that declared
  // itself BLOCKED — burning the remaining attempts on a sub-session that has
  // said it cannot proceed buys nothing). The item stays PENDING: `blocked` is a
  // §2.5 ANNOTATION, not an FSM position.
  const blockAndAsk = (why: string): SubmitTestResult => {
    const item = store.loadItem(runId, itemId);
    // ACCUMULATED, never assigned: §2.5 attempts are the ITEM's history. A second
    // call after an answered question spends its own repairs on the same item, and a
    // counter that showed only the last call's would hide what the item really cost.
    item.attempts.testRepairs += repairs;
    store.saveItem(runId, item);

    const questionText =
      SUBMIT_TEST_TOOL +
      ' could not obtain a legal RED for item "' +
      itemId +
      '" — ' +
      why +
      " (workflow.testRepairAttempts=" +
      String(maxRepairs) +
      ", repairs spent " +
      String(repairs) +
      ").\n" +
      (lastRed === null
        ? "No §2.6.1-legal failure was ever captured."
        : "The last run exited " +
          String(lastRed.exitCode) +
          ' with §2.6.1 class "' +
          lastRed.failureClass +
          '":\n' +
          lastRed.failureExcerpt) +
      "\nSay how this item's first failing test should be written, or whether the item itself " +
      "should be reshaped.";
    const question = appendQuestion(
      runDir,
      {
        runId,
        question: questionText,
        askedBy: { role: "testWriter", sessionID: writerSessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      now(),
    );
    const reason =
      "test-writer could not produce a legal §2.6.1 red for the PENDING->RED stage: " +
      why +
      " (repairs spent " +
      String(repairs) +
      " of workflow.testRepairAttempts=" +
      String(maxRepairs) +
      ")";
    const blocked = store.setBlocked(runId, itemId, {
      reason,
      stage: "RED",
      questionId: question.id,
    });
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId: question.id, stage: "RED", testRepairs: repairs },
      { runId, itemId },
    );
    return {
      ok: false,
      itemState: blocked.state,
      exitCode: lastRed === null ? null : lastRed.exitCode,
      failureClass: lastRed === null ? null : lastRed.failureClass,
      excerpt: lastRed === null ? null : lastRed.failureExcerpt,
      attempts: dispatches,
      questionId: question.id,
      decisionId: null,
      fork: null,
    };
  };

  for (;;) {
    const writer = await dispatchTestWriter(SUBMIT_TEST_TOOL, fanout, itemId, prompt);
    const reply = writer.reply;
    dispatches += 1;
    writerSessionID = writer.sessionID;
    if (reply.status === "BLOCKED") {
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: "RED", itemId, reason: "test-writer BLOCKED", detail: reply.blockReason ?? reply.summary },
        { runId, itemId },
      );
      return blockAndAsk(
        "the test-writer replied BLOCKED: " + (reply.blockReason ?? reply.summary),
      );
    }
    if (reply.status === "NEEDS_CONTEXT") {
      // Same reading as BLOCKED, for the same reason: re-issuing an identical prompt
      // cannot supply what the writer just said it lacks, so repairing would burn the
      // budget a round at a time and ask the human to unblock a stage without telling
      // them what is missing. The ask RELAYS what was asked for.
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: "RED", itemId, reason: "test-writer NEEDS_CONTEXT", detail: reply.neededContext ?? reply.summary },
        { runId, itemId },
      );
      return blockAndAsk(
        "the test-writer replied NEEDS_CONTEXT: " + (reply.neededContext ?? reply.summary),
      );
    }

    // THE HANDLER runs the test (§3.3) — evidence.ts appends and journals the
    // §2.6 record; nothing here re-classifies it.
    const outcome = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir);
    const record = outcome.record;

    if (record.kind === "green") {
      // (3a) REJECTION: a passing test is not a red. Record the §3.3 fork as a
      //      §2.7 derived decision and leave the item exactly where it was —
      //      PENDING, un-blocked, unquestioned: the orchestrator chooses.
      const decision: DecisionRecord = {
        id: mintDecisionId(runDir),
        tsIso: new Date(now()).toISOString(),
        question:
          'conductor_submit_test: item "' +
          itemId +
          "\"'s submitted test PASSED on its first run (exit 0), so it is not a red. Does the " +
          "behaviour already exist, or is the test wrong?",
        options: [
          {
            name: PASS_SKIP_OPTION,
            score: {
              capability: 1,
              testability: 1,
              movingParts: 2,
              validationEarliness: 1,
              singleSource: 2,
            },
          },
          {
            name: PASS_WRONG_OPTION,
            score: {
              capability: 2,
              testability: 3,
              movingParts: 2,
              validationEarliness: 3,
              singleSource: 2,
            },
          },
        ],
        choice: PASS_WRONG_OPTION,
        why:
          "A test that passes before any implementation of this item exists either asserts " +
          "behaviour that is already present (the ponytail ladder's skip rung — the item may be " +
          "unnecessary) or asserts the wrong thing. The conservative default is test-is-wrong: " +
          "the rejection already forces a resubmission, and the skip arm stays available to the " +
          "orchestrator through conductor_defer, which reads this ledger.",
        kind: "derived",
        appliedWhere: "item " + itemId,
      };
      // §2.7's >=2-scored-options law, ENFORCED at the write rather than asserted in
      // a comment — the same core gate handleDecide and the plan path run, so this
      // site cannot drift out of compliance if the literal above is ever edited.
      const passGate = requireTwoOptions(decision);
      if (!passGate.ok) {
        throw new Error(SUBMIT_TEST_TOOL + ": " + (passGate.why ?? "the pass-rejection decision is not §2.7-legal"));
      }
      appendDecision(runDir, decision);
      journal.log(
        "info",
        "state",
        "decision.recorded",
        { decisionId: decision.id, kind: decision.kind, choice: decision.choice, itemId },
        { runId, itemId },
      );
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: "RED", itemId, reason: "test passed immediately", exitCode: record.exitCode },
        { runId, itemId },
      );
      return {
        ok: false,
        itemState: store.loadItem(runId, itemId).state,
        exitCode: record.exitCode,
        failureClass: null,
        excerpt: null,
        attempts: dispatches,
        questionId: null,
        decisionId: decision.id,
        fork: PASS_SKIP_OPTION + " vs " + PASS_WRONG_OPTION + " — recorded choice: " + PASS_WRONG_OPTION,
      };
    }

    if (record.kind !== "red") {
      // runTest appends red|green for an item test; a verify record here would
      // mean the ledger writer changed under us. Say so rather than reading
      // fields that are not there.
      throw new Error(
        SUBMIT_TEST_TOOL +
          ': the item test run for "' +
          itemId +
          '" appended a §2.6 "' +
          record.kind +
          '" record; an item test yields red|green only',
      );
    }

    lastRed = record;
    const edge = redAdmission(outcome, queueItem);

    if (edge.ok) {
      // (3b) persist the advance: the FSM position, the repairs actually spent,
      //      and the §2.6 pointer to the red the item advanced ON.
      const item = store.loadItem(runId, itemId);
      item.state = "RED";
      item.attempts.testRepairs += repairs;
      item.evidence.red = { ledger: "evidence.jsonl", seq: record.seq };
      store.saveItem(runId, item);

      // (4) journal through the closed §7.4 vocabulary only.
      journal.log(
        "info",
        "fsm",
        "transition",
        {
          itemId,
          from: "PENDING",
          to: "RED",
          failureClass: record.failureClass,
          exitCode: record.exitCode,
          targeted: outcome.targeted,
          evidenceSeq: record.seq,
          attempts: dispatches,
          testRepairs: repairs,
          why: edge.why,
        },
        { runId, itemId },
      );
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, state: "RED", testRepairs: repairs, evidenceSeq: record.seq },
        { runId, itemId },
      );

      // (5) compact return.
      return {
        ok: true,
        itemState: item.state,
        exitCode: record.exitCode,
        failureClass: record.failureClass,
        excerpt: record.failureExcerpt,
        attempts: dispatches,
        questionId: null,
        decisionId: null,
        fork: null,
      };
    }

    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      {
        stage: "RED",
        itemId,
        failureClass: record.failureClass,
        exitCode: record.exitCode,
        repairs,
        maxRepairs,
        targeted: outcome.targeted,
        fellBack: outcome.fellBack,
        ranZeroTests: outcome.ranZeroTests,
        legalRed: outcome.legalRed,
        why: edge.why,
      },
      { runId, itemId },
    );

    // A red the writer cannot repair (the run never targeted this item) stops the
    // stage at once — see redAdmission. Only a §2.6.1 class-"error" red is worth
    // another dispatch.
    if (!edge.repairable) return blockAndAsk(edge.why);

    // The red is illegal (class "error"). Spend a REPAIR if the budget has one
    // left — the initial write was not a repair (§2.1 "illegal-red repair
    // attempts"), so the loop makes at most 1 + testRepairAttempts dispatches.
    if (repairs >= maxRepairs) {
      return blockAndAsk(edge.why + ", and the repair budget is spent");
    }
    repairs += 1;
    prompt = testRepairPrompt(
      queueItem,
      record,
      testScopeContent(store.root, queueItem),
      repairs,
      maxRepairs,
    );
  }
}

// ---------------------------------------------------------------------------
// conductor_vet_test (§3.3 RED->TEST_VETTED)
// ---------------------------------------------------------------------------

export interface VetTestInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: HandlerJournal;
  sessionID?: string;
  now?: () => number;
}

export interface VetCriterionTally {
  criterion: string;
  passed: number;
  failed: number;
}

export interface VetTestResult {
  ok: boolean; // true IFF the item advanced RED->TEST_VETTED
  itemState: ItemState; // the PERSISTED state after the call
  rounds: number; // vet rounds run (== item.attempts.vetRounds)
  verdicts: VetCriterionTally[]; // the FINAL round's per-criterion tally, in schema order
  mustFix: string[]; // the final round's UNION ([] on a clean exit)
  questionId: string | null; // the §2.11 question minted at the round cap
}

// The red this item is carrying: the record its §2.6 pointer names, else the last
// red on the ledger for this item. A RED item with no captured red cannot be
// vetted — the critics' whole job is to judge a test against what it produced.
// `stale` is true when the ledger holds a LATER run for this item than the red the
// critics would be shown — i.e. the test on disk has been re-run since, so the red no
// longer describes what it produces. The caller re-establishes the red before vetting
// rather than pairing an old failure with a new test.
function capturedRedOf(
  runDir: string,
  item: Item,
  itemId: string,
): { red: RedEvidence; stale: boolean; resolvedByFallback: boolean } {
  const ledger = path.join(runDir, "evidence.jsonl");
  const reds: RedEvidence[] = [];
  let latestSeq = -1;
  if (existsSync(ledger)) {
    let raw = readFileSync(ledger, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: EvidenceRecord;
      try {
        parsed = JSON.parse(trimmed) as EvidenceRecord;
      } catch {
        continue; // a torn crash artifact is skipped, never allowed to wedge the vet
      }
      if (parsed.itemId !== itemId) continue;
      // Every run for this item counts toward "what ran last", red or green.
      if (parsed.seq > latestSeq) latestSeq = parsed.seq;
      // Only a §2.6.1-LEGAL red is a red. A class-"error" record is one the submit
      // side refuses outright ("that is not a red"), so handing it to the critics as
      // THE CAPTURED RED would vet a test against its own brokenness.
      if (parsed.kind === "red" && (parsed.failureClass === "assertion" || parsed.failureClass === "missing-subject")) {
        reds.push(parsed);
      }
    }
  }
  const pointer = item.evidence.red;
  let resolvedByFallback = true;
  let chosen: RedEvidence | undefined;
  if (pointer !== undefined) {
    chosen = reds.find((record) => record.seq === pointer.seq);
    if (chosen !== undefined) resolvedByFallback = false;
  }
  if (chosen === undefined) chosen = reds[reds.length - 1];
  if (chosen === undefined) {
    throw new Error(
      VET_TEST_TOOL +
        ': item "' +
        itemId +
        '" is at RED but evidence.jsonl carries no §2.6.1-legal red record for it (a class-"error" ' +
        "record is not a red); there is nothing for the critics to judge the test against (§2.6)",
    );
  }
  return { red: chosen, stale: chosen.seq !== latestSeq, resolvedByFallback };
}

/**
 * conductor_vet_test (§3.3 RED->TEST_VETTED). Fans out readFanout("vet", config)
 * critics as ONE parallel group (role "reviewer", read-only, schema TestVet, a
 * fresh sub-session each), every prompt carrying the item spec + the test + the
 * captured red and NOT the implementation. A round in which every critic returns
 * an empty mustFix advances the item through core legalItemTransition; any
 * non-empty mustFix sends the UNION back to the test-writer in one write-capable
 * re-dispatch, re-runs the repaired test through evidence.runTest (which must
 * still be a §2.6.1-legal red — so the next round's prompt carries a TRUE
 * captured red for the test it judges) and re-vets. The loop is bounded by
 * config.workflow.vetMaxRounds: at the cap the item STAYS at RED with
 * blocked:{stage:"TEST_VETTED"} and ONE §2.11 question.
 */
export async function handleVetTest(input: VetTestInput): Promise<VetTestResult> {
  const { store, fanout, runId, itemId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality — same derivation, same throw-before-anything discipline.
  const stage = requireStageTool(VET_TEST_TOOL, store, runId, itemId, runDir);
  const queueItem = stage.queueItem;
  const criteria = testVetCriteria();
  // Floored for the same reason as testRepairAttempts: a fractional fan-out would
  // dispatch MORE critics than configured (2.5 -> 3), which can also breach a
  // fractional parallel.maxReaders ceiling.
  const critics = Math.floor(readFanout("vet", config));
  if (critics < 1) {
    throw new Error(
      VET_TEST_TOOL +
        ": the configured vet fan-out is " +
        String(critics) +
        " critic(s) (workflow.vetCritics clamped to parallel.maxReaders), so no critic could judge " +
        'item "' +
        itemId +
        "\"'s test; configure at least one (§4.3)",
    );
  }
  const max = Math.floor(config.workflow.vetMaxRounds);
  if (max < 1) {
    throw new Error(
      VET_TEST_TOOL +
        ": workflow.vetMaxRounds is " +
        String(max) +
        ", so no vet round may run; configure at least one (§2.1)",
    );
  }

  const scope = itemVerifyScope(config, queueItem, VET_TEST_TOOL);
  const captured = capturedRedOf(runDir, stage.item, itemId);
  let red = captured.red;
  if (captured.resolvedByFallback) {
    journal.log(
      "warn",
      "state",
      "item.updated",
      { itemId, evidenceSeq: red.seq, why: "the item's §2.6 red pointer did not resolve; fell back to the last legal red" },
      { runId, itemId },
    );
  }
  let testText = testScopeContent(store.root, queueItem);
  let rounds = 0;
  // Both are the FINAL round's products; every exit below runs at least one round
  // and overwrites them, so the initializers are only the empty starting state.
  let mustFix: string[] = [];
  let tally: VetCriterionTally[] = [];
  // §2.11 provenance for a question raised out of this loop: the critic (or the
  // writer) whose sub-session the ask came out of.
  let askedBySessionID = input.sessionID ?? "";

  // The loop's STUCK exit (a writer that declared itself BLOCKED, or a repair that
  // stopped being a §2.6.1 red): the item stays at RED — `blocked` is a §2.5
  // annotation, not an FSM position — carrying blocked:{stage:"TEST_VETTED"} and
  // ONE §2.11 question on the EXISTING origin "implementer-blocked" (the blocked
  // write-capable sub-session here IS the test-writer; nothing widens the closed
  // vocabulary). Same shape as the submit-side exhaustion, so both stage tools
  // leave a stuck item in one recognisable state with one unblock path.
  const blockVetAndAsk = (detail: string, sessionID: string): VetTestResult => {
    const item = store.loadItem(runId, itemId);
    // ACCUMULATED (see the submit side): §2.5 attempts are the item's history, and a
    // second call after an answered question spends its own rounds on the same item.
    item.attempts.vetRounds += rounds;
    store.saveItem(runId, item);

    const questionText =
      VET_TEST_TOOL +
      ' could not vet item "' +
      itemId +
      '": ' +
      detail +
      ".\nThe critics judge a test against the failure it actually produces, so this item cannot " +
      "be vetted until its test is a legal §2.6.1 red again. Say how the test should pin this " +
      "item's acceptance, or whether the item itself should be reshaped.";
    const question = appendQuestion(
      runDir,
      {
        runId,
        question: questionText,
        askedBy: { role: "testWriter", sessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      now(),
    );
    const blocked = store.setBlocked(runId, itemId, {
      reason: "the test vet could not proceed: " + detail,
      stage: "TEST_VETTED",
      questionId: question.id,
    });
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "TEST_VETTED", itemId, round: rounds, reason: detail },
      { runId, itemId },
    );
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId: question.id, stage: "TEST_VETTED", vetRounds: rounds },
      { runId, itemId },
    );
    return {
      ok: false,
      itemState: blocked.state,
      rounds,
      verdicts: tally,
      mustFix,
      questionId: question.id,
    };
  };

  // The captured red must describe the test the critics are about to judge, not
  // whatever produced it once. If ANY run for this item is newer than the red — a
  // mustFix repair from an earlier call that stopped being a red, an interrupted
  // stage, a crash between the re-run and the pointer write — the pairing is stale
  // and re-establishing it is the whole point of G6: without this, a repaired test
  // that PASSES gets vetted against the pre-repair red, and RED->TEST_VETTED->GREEN
  // needs only exit 0, publishing an item whose shipped test never had a red.
  // P6 is intact: on the normal path the red IS the newest run, so nothing re-runs.
  if (captured.stale) {
    const outcome = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir);
    const admission = redAdmission(outcome, queueItem);
    if (!admission.ok) {
      return blockVetAndAsk(
        "the test on disk no longer produces the captured red — " + admission.why,
        input.sessionID ?? "",
      );
    }
    red = outcome.record as RedEvidence;
    const item = store.loadItem(runId, itemId);
    item.evidence.red = { ledger: "evidence.jsonl", seq: red.seq };
    store.saveItem(runId, item);
    testText = testScopeContent(store.root, queueItem);
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, evidenceSeq: red.seq, why: "the captured red was stale; re-established before vetting (G6)" },
      { runId, itemId },
    );
  }

  for (;;) {
    // (2) derive: ONE parallel group of fresh critics per round.
    rounds += 1;
    const jobs: FanoutJob[] = [];
    for (let i = 0; i < critics; i += 1) {
      jobs.push({
        role: "reviewer",
        itemId,
        tree: STAGE_TREE,
        writeCapable: false,
        prompt: vetCriticPrompt(queueItem, testText, red, critics, rounds, max),
        schemaName: "TestVet",
        priority: "interactive",
      });
    }
    const results = await fanout.dispatchWave(jobs);
    if (results.length > 0) askedBySessionID = results[0].sessionID;

    const roundTally: VetCriterionTally[] = criteria.map((criterion) => ({
      criterion,
      passed: 0,
      failed: 0,
    }));
    const union: string[] = [];
    for (const [index, result] of results.entries()) {
      const vet = result.value as TestVet | undefined;
      // A critic that produced nothing is a BLIND SPOT, not an approval: vetting a
      // test on verdicts nobody gathered is exactly the failure this stage exists
      // to prevent, so the round aborts instead (the item is untouched and the
      // tool can simply be run again).
      if (vet === undefined) {
        throw new Error(
          VET_TEST_TOOL +
            ": vet critic " +
            String(index + 1) +
            " of " +
            String(critics) +
            ' for item "' +
            itemId +
            '" produced no valid TestVet (' +
            JSON.stringify(result.error) +
            ")",
        );
      }
      const byCriterion = vet.verdictsByCriterion as unknown as Record<string, CriterionVerdict>;
      for (const row of roundTally) {
        const verdict = byCriterion[row.criterion];
        if (verdict !== undefined && verdict.pass) row.passed += 1;
        else row.failed += 1;
      }
      for (const entry of vet.mustFix) {
        if (!union.includes(entry)) union.push(entry);
      }
    }
    tally = roundTally;
    mustFix = union;

    if (union.length === 0) {
      // (3a) a clean round: the core edge, then persist + journal + return.
      const item = store.loadItem(runId, itemId);
      const edge = legalItemTransition("RED", "TEST_VETTED", {
        item: { behavioral: queueItem.behavioral, blocked: item.blocked },
      });
      if (!edge.ok) {
        throw new Error(VET_TEST_TOOL + ": " + (edge.why ?? "RED->TEST_VETTED is not legal for this item"));
      }
      item.state = "TEST_VETTED";
      item.attempts.vetRounds += rounds;
      item.evidence.red = { ledger: "evidence.jsonl", seq: red.seq };
      store.saveItem(runId, item);

      journal.log(
        "info",
        "fsm",
        "transition",
        {
          itemId,
          from: "RED",
          to: "TEST_VETTED",
          rounds,
          critics,
          verdicts: tally,
          why: edge.why,
        },
        { runId, itemId },
      );
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, state: "TEST_VETTED", vetRounds: rounds },
        { runId, itemId },
      );

      return { ok: true, itemState: item.state, rounds, verdicts: tally, mustFix, questionId: null };
    }

    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "TEST_VETTED", itemId, round: rounds, max, mustFix: union },
      { runId, itemId },
    );

    // (3b) the round cap: the item STAYS at RED (blocked is an annotation) and
    //      ONE §2.11 question is raised, mirroring the submit-side exhaustion.
    //      Nothing is dispatched after this round.
    if (rounds >= max) {
      const item = store.loadItem(runId, itemId);
      item.attempts.vetRounds += rounds;
      item.evidence.red = { ledger: "evidence.jsonl", seq: red.seq };
      store.saveItem(runId, item);

      const questionText =
        VET_TEST_TOOL +
        ' reached its round cap for item "' +
        itemId +
        '": ' +
        String(rounds) +
        " of workflow.vetMaxRounds=" +
        String(max) +
        " vet round(s) spent and the critics still require:\n" +
        union.map((entry) => "- " + entry).join("\n") +
        "\nThe test stands as written and the item is blocked until you answer: say how the test " +
        "should pin this item's acceptance, or that it should stand as it is.";
      const question = appendQuestion(
        runDir,
        {
          runId,
          question: questionText,
          askedBy: { role: "reviewer", sessionID: askedBySessionID },
          humanTerritory: isHumanTerritory(questionText),
          origin: "review-round-cap",
          blocksItems: [itemId],
        },
        now(),
      );
      const blocked = store.setBlocked(runId, itemId, {
        reason:
          "test vet reached vetMaxRounds=" +
          String(max) +
          " with mustFix still outstanding: " +
          union.join("; "),
        stage: "TEST_VETTED",
        questionId: question.id,
      });
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, blocked: true, questionId: question.id, stage: "TEST_VETTED", vetRounds: rounds },
        { runId, itemId },
      );

      return {
        ok: false,
        itemState: blocked.state,
        rounds,
        verdicts: tally,
        mustFix,
        questionId: question.id,
      };
    }

    // (3c) below the cap: ONE write-capable re-dispatch carrying the UNION, then
    //      a re-run that must still be a §2.6.1-legal red before the next round —
    //      so every round's critics judge a test against ITS OWN captured red.
    const writer = await dispatchTestWriter(
      VET_TEST_TOOL,
      fanout,
      itemId,
      vetRepairPrompt(queueItem, testText, red, union, rounds, max),
    );
    if (writer.reply.status === "BLOCKED") {
      // Same reading as the submit side: a writer that has declared it cannot
      // proceed is not made to try again — the item stops with an unblock path.
      return blockVetAndAsk(
        "the test-writer replied BLOCKED on the must-fix re-dispatch: " +
          (writer.reply.blockReason ?? writer.reply.summary),
        writer.sessionID,
      );
    }
    if (writer.reply.status === "NEEDS_CONTEXT") {
      return blockVetAndAsk(
        "the test-writer replied NEEDS_CONTEXT on the must-fix re-dispatch: " +
          (writer.reply.neededContext ?? writer.reply.summary),
        writer.sessionID,
      );
    }

    const outcome = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir);
    const record = outcome.record;
    // The repaired test must STILL be a §2.6.1-legal red — admitted by the SAME rule
    // the submit side applies (class split + targeting), never re-derived here.
    const admission = redAdmission(outcome, queueItem);
    if (!admission.ok) {
      // §3.3's changed-test rule: the repaired test re-enters the test
      // discipline, and it did not survive it. That is a submit-side failure, not
      // something to vet, so the loop stops with the blocked+question shape the
      // submit side uses — never a silent re-vet of a test that is no longer red.
      return blockVetAndAsk(
        record.kind === "red"
          ? "the repaired test is not a red: " + admission.why
          : "the repaired test PASSES (exit 0), so it is no longer a red",
        writer.sessionID,
      );
    }

    red = record as RedEvidence;
    testText = testScopeContent(store.root, queueItem);
  }
}

// ---------------------------------------------------------------------------
// (8) conductor_mark_green + conductor_validate + conductor_queue_amend
//     (§3.3 TEST_VETTED->GREEN and GREEN->VALIDATED; §2.4/§2.7 the amendment)
// ---------------------------------------------------------------------------

const MARK_GREEN_TOOL = "conductor_mark_green";
const VALIDATE_TOOL = "conductor_validate";
const QUEUE_AMEND_TOOL = "conductor_queue_amend";

// The §3.3 write-capable implementer: doctrine tdd.md's minimal-code section, the
// item's fileScope, the SAME ImplementerResult receipt every other write-capable
// role replies with (9.4b registers no schema).
function implementerJob(itemId: string, prompt: string): FanoutJob {
  return {
    role: "implementer",
    itemId,
    tree: STAGE_TREE,
    writeCapable: true,
    prompt,
    schemaName: "ImplementerResult",
    priority: "interactive",
  };
}

async function dispatchImplementer(
  tool: string,
  fanout: Fanout,
  itemId: string,
  prompt: string,
): Promise<{ reply: ImplementerResult; sessionID: string }> {
  const result = await fanout.dispatch(implementerJob(itemId, prompt));
  const reply = result.value as ImplementerResult | undefined;
  if (reply === undefined) {
    throw new Error(
      tool +
        ': the implementer sub-session for item "' +
        itemId +
        '" produced no valid ImplementerResult (' +
        JSON.stringify(result.error) +
        ")",
    );
  }
  return { reply, sessionID: result.sessionID };
}

// One spelling per file. A repo-relative path is collapsed ("./tests/a.test.mjs",
// "tests//a.test.mjs" and "tests/./a.test.mjs" all become "tests/a.test.mjs") and
// spelled with forward slashes, so two authors naming the same file compare equal.
// A traversing path keeps its leading "..", which the quarantine still refuses.
function normalizeRepoRel(rel: string): string {
  return path.normalize(rel).split(path.sep).join("/");
}

// §4.2's foreign red set: the testScope files of every OTHER queue item below
// GREEN, UNION every path in the workspace stale-red registry — which survives
// runs, and is the only witness to a red test an EARLIER run abandoned. The
// subject item's OWN tests are never excluded: quarantining them would let the
// verify pass by not running the thing it is supposed to prove.
function foreignRedSet(store: StateStore, runId: string, queue: Queue, itemId: string): string[] {
  const belowGreen = ITEM_STATES.indexOf("GREEN");
  const own = new Set<string>();
  for (const entry of queue.items) {
    if (entry.id === itemId) for (const file of entry.testScope) own.add(normalizeRepoRel(file));
  }

  const foreign: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    // The own-tests guard compares NORMALIZED paths: the queue and the workspace
    // stale-red registry are written by different authors at different times, so the
    // same file arrives as "tests/a.test.mjs", "./tests/a.test.mjs" or
    // "tests//a.test.mjs". On a raw-string comparison a second spelling walks past the
    // guard and quarantines the item's own red — a false green.
    const file = normalizeRepoRel(raw);
    if (own.has(file) || seen.has(file)) return;
    // A file that is not in the tree cannot poison a verify, and handing it to the §4.2
    // quarantine would ENOENT out of renameSync and sink the whole run. A sibling still
    // at PENDING has not had its test WRITTEN yet (conductor_submit_test writes it), so
    // this is the ordinary case, not the exotic one.
    if (!existsSync(path.join(store.root, file))) return;
    seen.add(file);
    foreign.push(file);
  };

  for (const entry of queue.items) {
    if (entry.id === itemId) continue;
    let state: ItemState;
    try {
      state = store.loadItem(runId, entry.id).state;
    } catch {
      // A queue item with no runtime file has certainly not reached GREEN, so its
      // tests are foreign reds by the same rule.
      state = "PENDING";
    }
    if (ITEM_STATES.indexOf(state) >= belowGreen) continue;
    for (const file of entry.testScope) add(file);
  }

  for (const entry of store.readStaleRed().entries) add(entry.path);

  // Deterministic, so two runs over one fixture quarantine the same set in the
  // same order and a manifest is comparable across them.
  foreign.sort();
  return foreign;
}

// The paths the full verify selects its required scopes with: the item's WHOLE
// declared path set, exactly as itemVerifyScope resolves the item-test scope.
// runVerify unions the scopes every matching §2.1 entry names, so an item whose
// paths select different scopes runs all of them — and the order a model happened
// to write its fileScope in decides nothing.
function verifyScopePathsOf(queueItem: QueueItem): string[] {
  const paths = itemScopePaths(queueItem);
  return paths.length > 0 ? paths : ["**"];
}

function implementerPrompt(queueItem: QueueItem): string {
  return (
    "You are the implementer for this item. Write the MINIMAL production code that makes its " +
    "already-vetted failing test pass (doctrine tdd.md, minimal-code section). You may edit ONLY " +
    "the item's fileScope; the test files are frozen — if the test looks wrong, say so in your " +
    "receipt rather than editing it." +
    itemSpecBlock(queueItem) +
    "\n\nReply with the ImplementerResult receipt."
  );
}

// The DEBUG dispatch: doctrine debug.md VERBATIM (root cause before fix, one
// hypothesis at a time), plus the verify's own captured failure — never a
// paraphrase of it.
function debugFixPrompt(
  queueItem: QueueItem,
  packs: Record<string, string>,
  failure: string,
  round: number,
  cap: number,
): string {
  const doctrine = packs["debug.md"];
  if (doctrine === undefined || doctrine.trim().length === 0) {
    throw new Error(
      VALIDATE_TOOL +
        ": the DEBUG protocol requires doctrine debug.md and the loaded pack set has none; " +
        "refusing to dispatch a debug fix without the doctrine that governs it (§3.3)",
    );
  }
  return (
    doctrine +
    "\n\nThe full verify FAILED for this item. Find the ROOT CAUSE before changing anything, and " +
    "test ONE hypothesis at a time.\n" +
    "Fix attempt " +
    String(round) +
    " of workflow.debugFixCap=" +
    String(cap) +
    "." +
    itemSpecBlock(queueItem) +
    "\n\nTHE VERIFY'S OWN CAPTURED FAILURE:\n" +
    failure +
    "\n\nReply with the ImplementerResult receipt."
  );
}

// What the verify actually reported, rendered for a prompt and for the DEBUG
// hypothesis: the scopes that failed, with their exit codes, off the §2.6 record.
function verifyFailureText(record: VerifyEvidence): string {
  const failed = Object.entries(record.scopes).filter(([, outcome]) => !outcome.green);
  if (failed.length === 0) return "the verify reported no failing scope";
  return failed
    .map(([name, outcome]) => "scope " + name + " exited " + String(outcome.exitCode))
    .join("\n");
}

export interface MarkGreenInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: HandlerJournal;
  stateHome: string;
  workspaceKey: string;
  now?: () => number;
}

export interface MarkGreenResult {
  ok: boolean; // true IFF the item advanced to GREEN
  itemState: ItemState; // the PERSISTED state after the call
  ranItemTest: boolean; // false for a behavioral:false item
  exitCode: number | null; // the handler-run item test's exit code (null if none)
  attempts: number; // implementer dispatches consumed
  excluded: string[]; // the §4.2 foreign red set the item test ran under
  questionId: string | null; // the §2.11 question minted at a stuck implementer
}

/**
 * conductor_mark_green (§3.3). Owns the whole stage exactly as submit_test owns
 * PENDING->RED: it dispatches the implementer, then runs the item test ITSELF and
 * admits the result through core legalItemTransition. A DONE receipt is not an
 * advance — the tool call fails until the test actually passes.
 *
 * A behavioral:false item has no constructible test (§2.4 proves its fileScope
 * disjoint from behavioralPaths), so it advances PENDING->GREEN with no item test
 * run at all.
 */
export async function handleMarkGreen(input: MarkGreenInput): Promise<MarkGreenResult> {
  const { store, fanout, runId, itemId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality — the gate's own derivation, before a single sub-session is spent.
  const stage = requireStageTool(MARK_GREEN_TOOL, store, runId, itemId, runDir);
  const queueItem = stage.queueItem;
  const from = stage.item.state;

  // (2) derive. The implementer runs for BOTH kinds of item: a non-behavioral item
  //     still needs its production change written, it just owes no test.
  const writer = await dispatchImplementer(
    MARK_GREEN_TOOL,
    fanout,
    itemId,
    implementerPrompt(queueItem),
  );
  const attempts = 1;

  const stuck = (why: string): MarkGreenResult => {
    const questionText =
      MARK_GREEN_TOOL +
      ' could not take item "' +
      itemId +
      '" to GREEN — ' +
      why +
      "\nSay how the implementation should proceed, or whether the item should be reshaped.";
    const question = appendQuestion(
      runDir,
      {
        runId,
        question: questionText,
        askedBy: { role: "implementer", sessionID: writer.sessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      now(),
    );
    const blocked = store.setBlocked(runId, itemId, {
      reason: "the implementer could not take the item to GREEN: " + why,
      stage: "GREEN",
      questionId: question.id,
    });
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId: question.id, stage: "GREEN" },
      { runId, itemId },
    );
    return {
      ok: false,
      itemState: blocked.state,
      ranItemTest: false,
      exitCode: null,
      attempts,
      excluded: [],
      questionId: question.id,
    };
  };

  // The two CONSTRUCTIBLE rungs of §3.3's escalation ladder. "Stronger model" and
  // "item re-split" need a §2.1 knob that does not exist, so they are raised at the
  // Phase 9 gate rather than faked (G4).
  if (writer.reply.status === "BLOCKED") {
    return stuck("the implementer replied BLOCKED: " + (writer.reply.blockReason ?? writer.reply.summary));
  }
  if (writer.reply.status === "NEEDS_CONTEXT") {
    return stuck(
      "the implementer replied NEEDS_CONTEXT: " + (writer.reply.neededContext ?? writer.reply.summary),
    );
  }

  // (3a) a non-behavioral item: PENDING->GREEN with NO item test. The §3.3 annotation
  //      rule is judged against the item AS IT IS AT THE PERSIST, not against the
  //      snapshot taken before the implementer sub-session ran: anything that blocked
  //      the item during that window stops the advance, and the check and the write see
  //      one state.
  if (!queueItem.behavioral) {
    const item = store.loadItem(runId, itemId);
    const edge = legalItemTransition(from, "GREEN", {
      item: { behavioral: queueItem.behavioral, blocked: item.blocked },
    });
    if (!edge.ok) {
      throw new Error(MARK_GREEN_TOOL + ": " + (edge.why ?? from + "->GREEN is not legal for this item"));
    }
    item.state = "GREEN";
    item.attempts.green += 1;
    store.saveItem(runId, item);
    journal.log(
      "info",
      "fsm",
      "transition",
      { itemId, from, to: "GREEN", behavioral: false, attempts, why: edge.why },
      { runId, itemId },
    );
    journal.log("info", "state", "item.updated", { itemId, state: "GREEN" }, { runId, itemId });
    return {
      ok: true,
      itemState: item.state,
      ranItemTest: false,
      exitCode: null,
      attempts,
      excluded: [],
      questionId: null,
    };
  }

  // (3b) a behavioral item: THE HANDLER runs the test, under the §4.2 foreign red
  //      set so a sibling's deliberate red cannot fail this item's run (the
  //      no-template fallback needs it exactly as much as the verify does).
  const excluded = foreignRedSet(store, runId, stage.queue, itemId);
  const scope = itemVerifyScope(config, queueItem, MARK_GREEN_TOOL);
  const outcome = runTest(runDir, itemId, {
    scope,
    testFiles: [...queueItem.testScope],
    cwd: store.root,
    fileScope: [...queueItem.fileScope],
    excludeTestFiles: excluded,
    stateHome: input.stateHome,
    workspaceKey: input.workspaceKey,
    journal: evidenceJournalOf(journal),
    runId,
    now,
  });
  if (outcome.record.kind === "verify") {
    // runTest appends red|green for an item test; a verify record here would mean
    // the ledger writer changed under us. Say so rather than reading fields that
    // are not there.
    throw new Error(
      MARK_GREEN_TOOL +
        ': the item test run for "' +
        itemId +
        '" appended a §2.6 verify record; an item test yields red|green only',
    );
  }
  const record: ItemTestEvidence = outcome.record;

  // The §3.3 annotation rule reads the item AS IT IS AT THE PERSIST. `stage.item` was
  // loaded before the implementer sub-session ran, so judging the block against it would
  // let a GREEN be written over an item something blocked during that window.
  const item = store.loadItem(runId, itemId);
  const edge = legalItemTransition(from, "GREEN", {
    item: { behavioral: queueItem.behavioral, blocked: item.blocked },
    testExit: record.exitCode,
  });
  if (!edge.ok) {
    // Not a refusal — the stage RAN and the implementation is not done. The item
    // stays where it was, un-blocked, and the orchestrator re-calls the tool.
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "GREEN", itemId, exitCode: record.exitCode, attempts, why: edge.why },
      { runId, itemId },
    );
    return {
      ok: false,
      itemState: store.loadItem(runId, itemId).state,
      ranItemTest: true,
      exitCode: record.exitCode,
      attempts,
      excluded,
      questionId: null,
    };
  }

  item.state = "GREEN";
  item.attempts.green += 1;
  item.evidence.green = { ledger: "evidence.jsonl", seq: record.seq };
  store.saveItem(runId, item);

  journal.log(
    "info",
    "fsm",
    "transition",
    {
      itemId,
      from,
      to: "GREEN",
      exitCode: record.exitCode,
      evidenceSeq: record.seq,
      excluded: excluded.length,
      attempts,
      why: edge.why,
    },
    { runId, itemId },
  );
  journal.log(
    "info",
    "state",
    "item.updated",
    { itemId, state: "GREEN", evidenceSeq: record.seq },
    { runId, itemId },
  );

  return {
    ok: true,
    itemState: item.state,
    ranItemTest: true,
    exitCode: record.exitCode,
    attempts,
    excluded,
    questionId: null,
  };
}

export interface ValidateInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: HandlerJournal;
  stateHome: string;
  workspaceKey: string;
  packs: Record<string, string>;
  now?: () => number;
}

export interface ValidateResult {
  ok: boolean; // true IFF the item advanced GREEN->VALIDATED
  itemState: ItemState; // the PERSISTED state after the call
  green: boolean; // the LAST verify's outcome
  excluded: string[]; // the §4.2 foreign red set quarantined for the verify
  verifySeq: number | null; // the §2.6 verify record the outcome rests on
  debugFixes: number; // fix attempts spent (== item.attempts.debugFixes)
  questionId: string | null; // the "debug-architecture" question minted at the cap
}

/**
 * conductor_validate (§3.3 GREEN->VALIDATED). Composes evidence.runVerify, which
 * owns the whole verify mechanism — quarantining the foreign red set OUT of the
 * repo, start-stamping, recording HEAD, the per-tree marker that freezes the tree,
 * and restoring everything on every exit. This handler computes the §4.2 SET and
 * admits the outcome; it re-implements none of that.
 *
 * A live same-tree marker is a REFUSAL (two verifies in one tree would each
 * describe a tree the other was mutating). A red verify enters the DEBUG protocol:
 * `debugging` is set from the verify's OWN failure, then up to
 * config.workflow.debugFixCap implementer dispatches — each carrying doctrine
 * debug.md — with a re-verify after each; at the cap the item is blocked and ONE
 * §2.11 question is raised on the existing "debug-architecture" origin.
 */
export async function handleValidate(input: ValidateInput): Promise<ValidateResult> {
  const { store, fanout, runId, itemId, config, journal, packs } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality.
  const stage = requireStageTool(VALIDATE_TOOL, store, runId, itemId, runDir);
  const queueItem = stage.queueItem;
  const excluded = foreignRedSet(store, runId, stage.queue, itemId);
  const scopePaths = verifyScopePathsOf(queueItem);
  // An item no requiredScopes entry covers selects NO scope, and `every` over an empty
  // scope map is vacuously true — the verify would report green having executed nothing
  // and take the item to VALIDATED on no evidence at all. On a behavioral:false item
  // this verify is the item's ONLY evidence, so the same named §2.1 legality failure
  // itemVerifyScope raises for the item test is raised here: never a silent fallback.
  if (requiredScopeNames(config, scopePaths).length === 0) {
    throw new Error(
      VALIDATE_TOOL +
        ': no verify.requiredScopes entry covers item "' +
        itemId +
        '" (testScope ' +
        JSON.stringify(queueItem.testScope) +
        ", fileScope " +
        JSON.stringify(queueItem.fileScope) +
        "), so the full verify would run no scope at all (§2.1)",
    );
  }
  // Floored for the same reason as every other budget knob: the §2.1 schema types
  // it `number`, and a fractional cap would round the fix budget UP.
  const cap = Math.max(0, Math.floor(config.workflow.debugFixCap));

  const verify = (): VerifyEvidence => {
    const outcome = runVerify(runDir, itemId, config, scopePaths, {
      cwd: store.root,
      excludeTestFiles: excluded,
      journal: evidenceJournalOf(journal),
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      runId,
      tree: STAGE_TREE,
      now,
    });
    if (outcome.refused) {
      // The marker's holder is left untouched — never stolen, never overwritten.
      throw new Error(
        VALIDATE_TOOL +
          ': item "' +
          itemId +
          '" cannot verify: ' +
          outcome.reason +
          " (tree " +
          outcome.tree +
          ", held by pid " +
          String(outcome.heldBy.pid) +
          ")",
      );
    }
    const record = outcome.record as VerifyEvidence;
    // Belt-and-braces on the same vacuity: the item IS covered, but every scope its
    // §2.1 entries name is missing from verify.scopes, so the run executed nothing. An
    // empty scope map is not admissible evidence for the GREEN->VALIDATED edge.
    if (Object.keys(record.scopes).length === 0) {
      throw new Error(
        VALIDATE_TOOL +
          ': the full verify for item "' +
          itemId +
          '" ran no scope (its §2.1 required scopes name nothing verify.scopes defines), ' +
          "so there is no evidence to advance on",
      );
    }
    return record;
  };

  // (2) derive: the first verify, then the bounded DEBUG loop.
  let record = verify();
  let debugFixes = 0;
  // §2.11 provenance: the question raised at the cap names the sub-session that was
  // working the item when the stage gave up, not a blank.
  let fixerSessionID = "";

  while (!record.green) {
    // The DEBUG posture is persisted BEFORE the implementer speaks, and its
    // hypothesis comes off the verify's OWN record — the model has said nothing
    // yet, so it cannot be a paraphrase of anything it claimed.
    const failure = verifyFailureText(record);
    if (debugFixes === 0) {
      store.setDebugging(runId, itemId, {
        hypothesis:
          "the full verify failed for this item: " +
          failure +
          " — find the root cause before changing anything (§3.3 DEBUG)",
      });
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: "VALIDATED", itemId, green: false, evidenceSeq: record.seq, debugging: true },
        { runId, itemId },
      );
    }

    if (debugFixes >= cap) {
      const item = store.loadItem(runId, itemId);
      item.attempts.debugFixes += debugFixes;
      store.saveItem(runId, item);

      const questionText =
        VALIDATE_TOOL +
        ' reached workflow.debugFixCap=' +
        String(cap) +
        ' for item "' +
        itemId +
        '" and the full verify is still red:\n' +
        failure +
        "\nThe §3.3 three-fix rule reads a failure that resists this many fixes as an ARCHITECTURE " +
        "question, not another bug: say how the item (or the design it rests on) should change.";
      const question = appendQuestion(
        runDir,
        {
          runId,
          question: questionText,
          askedBy: { role: "implementer", sessionID: fixerSessionID },
          humanTerritory: isHumanTerritory(questionText),
          origin: "debug-architecture",
          blocksItems: [itemId],
        },
        now(),
      );
      const blocked = store.setBlocked(runId, itemId, {
        reason:
          "the full verify stayed red through workflow.debugFixCap=" +
          String(cap) +
          " fix attempts: " +
          failure,
        stage: "VALIDATED",
        questionId: question.id,
      });
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, blocked: true, questionId: question.id, stage: "VALIDATED", debugFixes },
        { runId, itemId },
      );
      return {
        ok: false,
        itemState: blocked.state,
        green: false,
        excluded,
        verifySeq: record.seq,
        debugFixes,
        questionId: question.id,
      };
    }

    debugFixes += 1;
    const fixer = await dispatchImplementer(
      VALIDATE_TOOL,
      fanout,
      itemId,
      debugFixPrompt(queueItem, packs, failure, debugFixes, cap),
    );
    fixerSessionID = fixer.sessionID;
    record = verify();
  }

  // (3) persist the advance.
  const item = store.loadItem(runId, itemId);
  const edge = legalItemTransition("GREEN", "VALIDATED", {
    item: { behavioral: queueItem.behavioral, blocked: item.blocked },
  });
  if (!edge.ok) {
    throw new Error(VALIDATE_TOOL + ": " + (edge.why ?? "GREEN->VALIDATED is not legal for this item"));
  }
  item.state = "VALIDATED";
  item.attempts.debugFixes += debugFixes;
  item.debugging = null;
  item.evidence.validated = { ledger: "evidence.jsonl", seq: record.seq };
  store.saveItem(runId, item);

  journal.log(
    "info",
    "fsm",
    "transition",
    {
      itemId,
      from: "GREEN",
      to: "VALIDATED",
      evidenceSeq: record.seq,
      excluded: excluded.length,
      debugFixes,
      why: edge.why,
    },
    { runId, itemId },
  );
  journal.log(
    "info",
    "state",
    "item.updated",
    { itemId, state: "VALIDATED", evidenceSeq: record.seq, debugFixes },
    { runId, itemId },
  );

  return {
    ok: true,
    itemState: item.state,
    green: true,
    excluded,
    verifySeq: record.seq,
    debugFixes,
    questionId: null,
  };
}

export interface QueueAmendInput {
  store: StateStore;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  now?: () => number;
  queue: Queue;
  question: string;
  options: Array<{ name: string; score?: DecisionRecord["options"][number]["score"] }>;
  choice: string;
  why: string;
  appliedWhere: string;
}

export interface QueueAmendResult {
  ok: boolean;
  decisionId: string;
  itemIds: string[];
}

/**
 * conductor_queue_amend (§2.4/§2.7). Re-runs core validateQueue over the AMENDED
 * queue and refuses any violation, and gates its §2.7 record through the same core
 * requireTwoOptions every other decision site runs. Both refusals precede every
 * write, so a rejected amendment leaves queue.json byte-identical.
 *
 * Synchronous: it dispatches nothing.
 */
export function handleQueueAmend(input: QueueAmendInput): QueueAmendResult {
  const { store, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality, in both halves, BEFORE anything is persisted.
  const verdict = validateQueue(input.queue, config);
  if (!verdict.ok) {
    throw new Error(
      QUEUE_AMEND_TOOL +
        ": the amended queue is not §2.4-legal, so nothing was written: " +
        verdict.violations.join("; "),
    );
  }

  const decision: DecisionRecord = {
    id: mintDecisionId(runDir),
    tsIso: new Date(now()).toISOString(),
    question: input.question,
    options: input.options.map((option) => ({
      name: option.name,
      ...(option.score === undefined ? {} : { score: option.score }),
    })) as DecisionRecord["options"],
    choice: input.choice,
    why: input.why,
    kind: "derived",
    appliedWhere: input.appliedWhere,
  };
  const gate = requireTwoOptions(decision);
  if (!gate.ok) {
    throw new Error(
      QUEUE_AMEND_TOOL + ": " + (gate.why ?? "the amendment decision is not §2.7-legal") +
        " — nothing was written",
    );
  }
  // requireTwoOptions covers the options rule ALONE. The §2.7 schema is the other half,
  // and it must be established here rather than at the append: a record that fails it
  // after queue.json has been swapped tells the caller the amendment failed while the run
  // executes the amended queue.
  assertDecisionValid(decision);

  // (2) persist: the queue the run will execute, then the record of why.
  writeFileAtomicSync(path.join(runDir, "queue.json"), JSON.stringify(input.queue, null, 2));
  appendDecision(runDir, decision);

  const itemIds = input.queue.items.map((entry) => entry.id);
  journal.log(
    "info",
    "state",
    "decision.recorded",
    { decisionId: decision.id, kind: decision.kind, choice: decision.choice, items: itemIds.length },
    { runId },
  );

  return { ok: true, decisionId: decision.id, itemIds };
}

// ===========================================================================
// (9) conductor_dispatch_wave — the §4.2 wave DRIVER (Task 9.4c, plan lines
// 2640-2651, §4.2 lines 1544-1618). The run's work engine: it computes the wave
// through core/schedule nextWave, runs ONE async pipeline per wave member
// through the SHARED fan-out engine (so the orchestrator model never interleaves
// items by hand), and performs PLAN_REVIEWED->EXECUTING on its first call.
//
// The driver REACHES the committed per-item stage handlers rather than
// reimplementing them (§4.2: one implementation, one set of gates, whether the
// model or the driver is calling). It therefore owns exactly the three ordering
// guarantees a per-item tool cannot see from inside its own item:
//
//   BATCHING. The wave advances stage by stage: every active member owing the
//   same stage enters it together as one group, and a stage is entered ONCE per
//   call. A member that drops out (blocked, deferred, env-failed, or stopped by
//   a stage that ran without advancing it) leaves every later group and delays
//   nobody; a member that arrives at a stage the wave has already passed stops
//   there for the next call rather than opening a second group behind it.
//
//   WRITES SERIALIZE PER TREE (§4.3). Read stages overlap freely; the stages
//   whose dispatch is write-capable — plus conductor_publish, whose git index is
//   a singleton — run strictly one at a time, in §4.2 wave order.
//
//   FREEZE (§3.5's freeze-as-scheduling rule). The hold itself is the fan-out
//   engine's and is not re-implemented here: a write-capable job for a frozen
//   tree is HELD and released through TreeState.onClear. The driver owns the two
//   halves the engine cannot own — the NOTIFICATION (it calls notifyClear after
//   every stage execution, so a tree a stage released, or a stale marker the
//   evidence layer broke, deterministically releases the held jobs with no timer
//   and no polling) and the BOUND (a held job nothing will ever release is
//   env-failed rather than awaited forever).
//
// Stages this build does not carry yet — conductor_item_review lands at 9.5a and
// conductor_publish at 9.5b — are reached through an INJECTABLE executor table,
// the same dependency injection as the Fanout, the clock and VerifyOptions. The
// DEFAULT table wires ONLY handlers committed here, and a member that reaches a
// stage no executor serves STOPS there with an envError naming that stage: at
// 9.4c a wave genuinely cannot publish, and the driver says so rather than
// throwing "not implemented", skipping the stage, or advancing an item past work
// that never happened.
// ===========================================================================

const DISPATCH_WAVE_TOOL = "conductor_dispatch_wave";
const PUBLISH_TOOL = "conductor_publish";

// The stages that may not overlap in one tree: the two whose sub-session is
// write-capable (testWriter, implementer) and publish, whose git index is a
// singleton. Every other stage is a read group and overlaps freely (§4.2).
const SERIAL_STAGES: readonly string[] = [SUBMIT_TEST_TOOL, MARK_GREEN_TOOL, PUBLISH_TOOL];

// The journal a stage executor is handed: the leveled handler sink plus the
// flush the evidence layer needs. Deliberately the WIDE level/corr shape, so an
// injected executor (a test's recorder, a later stage's handler) can consume it
// without knowing this module's leveled union.
export interface StageJournal {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
  flushSync: () => void;
}

// Everything a stage executor needs to run ONE stage for ONE item. `tool` is the
// §3.4 conductor_* name the §3.3 item FSM says advances the item — the same
// vocabulary core/gates-phase offers per item, so the table key and the gate's
// offer are one string.
export interface StageExecutorContext {
  tool: string;
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: StageJournal;
  stateHome: string;
  workspaceKey: string;
  packs: Record<string, string>;
  now: () => number;
}

// What a stage execution reports back: whether it ADVANCED the item, and the
// item's persisted state after it. `ok:false` stops the member — the driver
// never advances an item past work that did not happen (§3.3).
export interface StageOutcome {
  ok: boolean;
  itemState: ItemState;
}

export type StageExecutor = (ctx: StageExecutorContext) => Promise<StageOutcome>;

// The §3.5 tree view the driver drives: the one the Fanout was built over, plus
// the release notification the driver owns.
export interface WaveTreeState extends TreeState {
  notifyClear: (tree: string) => void;
}

export interface DispatchWaveInput {
  store: StateStore;
  fanout: Fanout;
  treeState: WaveTreeState;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  stateHome: string;
  workspaceKey: string;
  packs: Record<string, string>;
  now?: () => number;
  // Merged OVER the default table, never replacing it: an injected entry serves
  // one stage, and every other stage keeps the handler this build committed.
  executors?: Record<string, StageExecutor>;
}

// One wave member's disposition. Compact by construction: the block/defer
// REASONS rather than the §2.5 annotation objects, and no §2.4 queue-item or
// §2.5 item JSON anywhere.
export interface WaveDisposition {
  itemId: string;
  state: ItemState; // the PERSISTED item state after the call
  blocked: string | null; // the §2.5 block reason
  deferred: string | null; // the §2.5 defer reason
  envError: string | null; // an environment failure that stopped this member
  stoppedAt: string | null; // the conductor_* stage the member stopped at
  anomaly: string | null; // something abnormal this member rode (a freeze hold)
}

export interface DispatchWaveResult {
  runState: RunState; // the PERSISTED run state after the call
  wave: { parallel: string[]; rationale: string }; // nextWave's OWN plan
  items: WaveDisposition[];
}

// The driver's per-member bookkeeping, kept beside the item rather than in it:
// none of it is §2.5 state, and none of it is persisted.
interface WaveMember {
  itemId: string;
  active: boolean;
  stoppedAt: string | null;
  envError: string | null;
  anomaly: string | null;
}

// A stage execution's fate, captured so a rejection is a VALUE the driver can
// dispose of rather than a throw that would abandon the wave's other members.
type StageSettlement = { kind: "done"; outcome: StageOutcome } | { kind: "failed"; error: unknown };

// The executor-facing sink, forwarded to the handler's own sink verbatim. Built
// rather than cast so the executors' records land in the SAME journal as the
// rest of the wave (the evidenceJournalOf convention), and so a sink without a
// flush still satisfies the seam.
function stageJournalOf(journal: HandlerJournal): StageJournal {
  const sink = journal as HandlerJournal & { flushSync?: () => void };
  return {
    log: (level, component, event, data, corr): void => {
      // The seam takes the wide `string` level; the handler sink takes the §7.1
      // union, and every caller inside this module emits one of its members.
      journal.log(level as LogLevel, component, event, data, {
        runId: corr.runId ?? "",
        ...(corr.itemId === undefined ? {} : { itemId: corr.itemId }),
        ...(corr.sessionID === undefined ? {} : { sessionID: corr.sessionID }),
      });
    },
    flushSync: (): void => {
      if (typeof sink.flushSync === "function") sink.flushSync();
    },
  };
}

// The DEFAULT stage-executor table: ONLY the handlers this build carries. There
// is deliberately NO entry for conductor_item_review (9.5a) or conductor_publish
// (9.5b) — a placeholder would take an item past work that never happened, and a
// throw would make a wave that legitimately cannot publish look broken.
function defaultStageExecutors(): Record<string, StageExecutor> {
  return {
    [SUBMIT_TEST_TOOL]: async (ctx): Promise<StageOutcome> => {
      const result = await handleSubmitTest({
        store: ctx.store,
        fanout: ctx.fanout,
        runId: ctx.runId,
        itemId: ctx.itemId,
        config: ctx.config,
        journal: ctx.journal,
        now: ctx.now,
      });
      return { ok: result.ok, itemState: result.itemState };
    },
    [VET_TEST_TOOL]: async (ctx): Promise<StageOutcome> => {
      const result = await handleVetTest({
        store: ctx.store,
        fanout: ctx.fanout,
        runId: ctx.runId,
        itemId: ctx.itemId,
        config: ctx.config,
        journal: ctx.journal,
        now: ctx.now,
      });
      return { ok: result.ok, itemState: result.itemState };
    },
    [MARK_GREEN_TOOL]: async (ctx): Promise<StageOutcome> => {
      const result = await handleMarkGreen({
        store: ctx.store,
        fanout: ctx.fanout,
        runId: ctx.runId,
        itemId: ctx.itemId,
        config: ctx.config,
        journal: ctx.journal,
        stateHome: ctx.stateHome,
        workspaceKey: ctx.workspaceKey,
        now: ctx.now,
      });
      return { ok: result.ok, itemState: result.itemState };
    },
    [VALIDATE_TOOL]: async (ctx): Promise<StageOutcome> => {
      const result = await handleValidate({
        store: ctx.store,
        fanout: ctx.fanout,
        runId: ctx.runId,
        itemId: ctx.itemId,
        config: ctx.config,
        journal: ctx.journal,
        stateHome: ctx.stateHome,
        workspaceKey: ctx.workspaceKey,
        packs: ctx.packs,
        now: ctx.now,
      });
      return { ok: result.ok, itemState: result.itemState };
    },
  };
}

// The gate's verdict over the run's CURRENT persisted facts. Every legality
// question the driver asks — its own offer, and each member's next stage — is
// answered from this ONE derivation, so the driver and the stage handlers can
// never disagree about what may run (§3.2).
function waveVerdict(store: StateStore, runId: string, runDir: string, queue: Queue): LegalToolsResult {
  const run = store.loadRun(runId);
  const gateRun: GateRun = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
  };
  let questions: Array<{ id: string; answeredIso: string | null }>;
  try {
    questions = readQuestions(runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
  } catch (error) {
    throw new Error(
      DISPATCH_WAVE_TOOL +
        ": cannot read questions.jsonl in " +
        runDir +
        " (a torn or invalid §2.11 record — repair the file to resume): " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  return legalTools(gateRun, gateItemsOf(store, runId, queue), questions, true);
}

// The §3.3 stage tool the gate offers THIS item right now, or null when it
// offers none (PUBLISHED, blocked, deferred, dependency-unready). Read out of
// the verdict rather than re-derived from the item's FSM position: the item FSM
// table lives in core, and this file reads its answer.
function offeredStageTool(verdict: LegalToolsResult, itemId: string): string | null {
  for (const [tool, hint] of verdict.legal) {
    const ids = hint.itemIds;
    if (ids !== undefined && ids.includes(itemId)) return tool;
  }
  return null;
}

// The scheduler's view of the run's items: FSM position plus the two annotations
// that veto scheduling, for every queue item that has a runtime file.
function scheduleItemsOf(
  store: StateStore,
  runId: string,
  queue: Queue,
): Array<{ id: string; state: string; blocked: { reason: string } | null; deferred: { reason: string } | null }> {
  const items: Array<{
    id: string;
    state: string;
    blocked: { reason: string } | null;
    deferred: { reason: string } | null;
  }> = [];
  for (const qi of queue.items) {
    let item: Item;
    try {
      item = store.loadItem(runId, qi.id);
    } catch {
      continue; // no runtime facts — nextWave cannot schedule it either
    }
    items.push({
      id: qi.id,
      state: item.state,
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
    });
  }
  return items;
}

/**
 * conductor_dispatch_wave (§3.2, §4.2). Computes the wave through core/schedule
 * nextWave, performs PLAN_REVIEWED->EXECUTING on its first call (unconditionally
 * — an empty first wave still transitions, or conductor_report is unreachable and
 * the run wedges), and drives one pipeline per wave member through the shared
 * fan-out engine until the wave is drained-or-blocked. Returns the compact
 * per-item disposition summary; persists nothing of its own.
 */
export async function handleDispatchWave(input: DispatchWaveInput): Promise<DispatchWaveResult> {
  const { store, fanout, treeState, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);
  const executors: Record<string, StageExecutor> = {
    ...defaultStageExecutors(),
    ...(input.executors ?? {}),
  };
  const stageJournal = stageJournalOf(journal);
  // A held write-capable job has no watchdog of its own — the engine arms one
  // only for a job it has admitted — so the driver bounds the wait with the
  // operator's OWN sub-session budget rather than inventing a second knob.
  const heldBudgetMs = Math.max(1, Math.floor(config.parallel.subSessionTimeoutMs));

  // (1) legality — the driver's own offer, from the gate's derivation, before it
  //     transitions, computes or dispatches anything (§3.2).
  const queue = readQueueJson(runDir, DISPATCH_WAVE_TOOL);
  const entryVerdict = waveVerdict(store, runId, runDir, queue);
  if (!entryVerdict.legal.has(DISPATCH_WAVE_TOOL)) {
    throw new Error(DISPATCH_WAVE_TOOL + " is not legal right now: " + entryVerdict.why);
  }

  // (2) the run edge, on the FIRST call. Run carries planReviewRounds and NOT
  //     survivingMajors, so the context is DERIVED from what was persisted:
  //     below the cap the review exited on a clean round; at the cap it exited
  //     with its majors surfaced as questions. core/fsm-run owns which of the two
  //     admits the edge — this handler re-derives neither arm.
  const run = store.loadRun(runId);
  if (run.state === "PLAN_REVIEWED") {
    const max = config.workflow.planReviewMaxRounds;
    const context =
      run.planReviewRounds < max ? { survivingMajors: 0 } : { round: run.planReviewRounds, max };
    const edge = legalRunTransition(run.state, "EXECUTING", context);
    if (!edge.ok) {
      throw new Error(
        DISPATCH_WAVE_TOOL + ": " + (edge.why ?? "this run may not advance to EXECUTING"),
      );
    }
    const from = run.state;
    run.state = "EXECUTING";
    store.saveRun(run);
    journal.log(
      "info",
      "fsm",
      "transition",
      { from, to: run.state, why: edge.why, planReviewRounds: run.planReviewRounds, tsMs: now() },
      { runId },
    );
  }

  // (3) the wave — nextWave's OWN plan over the persisted facts and the config
  //     caps. Membership, order and rationale are all its; nothing here filters
  //     the set it returned or restates why it chose it.
  const wave = nextWave({ items: queue.items }, scheduleItemsOf(store, runId, queue), config);
  const members: WaveMember[] = wave.parallel.map((itemId) => ({
    itemId,
    active: true,
    stoppedAt: null,
    envError: null,
    anomaly: null,
  }));

  // A member stops: it runs no further stage in THIS call, and the disposition
  // names the stage it stopped at.
  const stop = (member: WaveMember, tool: string, envError: string | null): void => {
    member.active = false;
    member.stoppedAt = tool;
    if (envError !== null) {
      member.envError = envError;
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: tool, itemId: member.itemId, reason: envError },
        { runId, itemId: member.itemId },
      );
    }
  };

  // Await a HELD stage under the budget. Resolves to null when the budget
  // expires with the job still held: a leaked marker becomes an env-fail, never
  // a silent wave hang, and the wave's other members are never made to wait on
  // a tree nothing is going to release.
  const awaitHeld = async (settle: Promise<StageSettlement>): Promise<StageSettlement | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
      }, heldBudgetMs);
    });
    try {
      return await Promise.race([settle, expiry]);
    } finally {
      // The wave must never leave a live timer behind: a released job would
      // otherwise keep the process alive for the whole budget.
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  // One member's ONE stage.
  const runStage = async (member: WaveMember, tool: string): Promise<void> => {
    const executor = executors[tool];
    if (executor === undefined) {
      stop(
        member,
        tool,
        'item "' +
          member.itemId +
          '" reached ' +
          tool +
          ", which no stage executor in this build serves; the member stops here rather than " +
          "skipping the stage or advancing past work that did not happen",
      );
      return;
    }

    // §3.5: the engine HOLDS a write-capable job whose tree is frozen. Noting it
    // here is what turns a hold into an observable anomaly rather than a wave
    // that merely takes a long time.
    const frozen = SERIAL_STAGES.includes(tool) && treeState.isFrozen(STAGE_TREE);
    if (frozen) {
      member.anomaly =
        'tree "' +
        STAGE_TREE +
        '" was frozen by a live verify marker when ' +
        tool +
        " dispatched, so the fan-out engine HELD this member's write-capable job until the " +
        "marker cleared (§3.5)";
    }

    const settle: Promise<StageSettlement> = executor({
      tool,
      store,
      fanout,
      runId,
      itemId: member.itemId,
      config,
      journal: stageJournal,
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      packs: input.packs,
      now,
    }).then(
      (outcome): StageSettlement => ({ kind: "done", outcome }),
      (error): StageSettlement => ({ kind: "failed", error }),
    );

    const settlement = frozen ? await awaitHeld(settle) : await settle;
    if (settlement === null) {
      stop(
        member,
        tool,
        "the write-capable sub-session for " +
          tool +
          ' was HELD out of tree "' +
          STAGE_TREE +
          '": its verify marker never cleared within parallel.subSessionTimeoutMs=' +
          String(heldBudgetMs) +
          "ms, so the member is env-failed rather than awaited forever (§3.5)",
      );
      return;
    }

    // The stage ran, so whatever it did to the tree is done: notify the §3.5
    // view, which is what releases any write-capable job the engine is holding
    // on a marker this stage broke or a verify this stage finished (P6).
    treeState.notifyClear(STAGE_TREE);

    if (settlement.kind === "failed") {
      const error = settlement.error;
      stop(member, tool, tool + " failed: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    // A stage that RAN without advancing the item stops the member — a failing
    // item test, a red verify, a blocked member. That is not an environment
    // failure, and it is never re-run inside one dispatch_wave call.
    if (!settlement.outcome.ok) stop(member, tool, null);
  };

  // One stage GROUP: the members owing a read stage go together and overlap
  // freely; the write stages run strictly one at a time in wave order. The first
  // job of each is started in this ONE synchronous pass, so the order sub-session
  // traffic reaches the engine is §4.2's and not the event loop's.
  const runGroup = async (scheduled: Array<{ member: WaveMember; tool: string }>): Promise<void> => {
    const running: Array<Promise<void>> = [];
    let serial: Promise<void> | null = null;
    for (const entry of scheduled) {
      if (SERIAL_STAGES.includes(entry.tool)) {
        serial =
          serial === null
            ? runStage(entry.member, entry.tool)
            : serial.then(() => runStage(entry.member, entry.tool));
      } else {
        running.push(runStage(entry.member, entry.tool));
      }
    }
    if (serial !== null) running.push(serial);
    await Promise.all(running);
  };

  // (4) drive the wave stage by stage until it is drained-or-blocked. Each round
  //     re-asks the gate over the freshly PERSISTED facts, so a member that
  //     blocked, deferred or finished in the previous round simply stops being
  //     offered a stage tool and leaves the wave without delaying anybody.
  const entered = new Set<string>();
  for (;;) {
    const verdict = waveVerdict(store, runId, runDir, queue);
    const scheduled: Array<{ member: WaveMember; tool: string }> = [];
    for (const member of members) {
      if (!member.active) continue;
      const tool = offeredStageTool(verdict, member.itemId);
      if (tool === null) {
        // Drained (PUBLISHED) or dropped out (blocked/deferred): the gate offers
        // this item nothing, so the member is simply done for this call.
        member.active = false;
        continue;
      }
      if (entered.has(tool)) {
        // The wave has already passed this stage in this call. A second group
        // behind the first would re-open a stage the batch already closed, so
        // the member stops and the NEXT dispatch_wave call carries it.
        stop(member, tool, null);
        continue;
      }
      scheduled.push({ member, tool });
    }
    if (scheduled.length === 0) break;
    for (const entry of scheduled) entered.add(entry.tool);
    await runGroup(scheduled);
  }

  // (5) compact return: one disposition per member, in wave order, read back
  //     through the store — never out of what a handler said it did.
  const items: WaveDisposition[] = members.map((member) => {
    const item = store.loadItem(runId, member.itemId);
    return {
      itemId: member.itemId,
      state: item.state,
      blocked: item.blocked === null ? null : item.blocked.reason,
      deferred: item.deferred === null ? null : item.deferred.reason,
      envError: member.envError,
      stoppedAt: member.stoppedAt,
      anomaly: member.anomaly,
    };
  });

  return {
    runState: store.loadRun(runId).state,
    wave: { parallel: [...wave.parallel], rationale: wave.rationale },
    items,
  };
}
