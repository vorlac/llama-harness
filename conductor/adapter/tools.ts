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
import { isGitCommand, scopesIntersect, shellTokens, splitOnOperators } from "../core/shell-parse.ts";
import { isHumanTerritory, requireTwoOptions } from "../core/decide.ts";
import { legalRunTransition } from "../core/fsm-run.ts";
import { scanPlaceholders, validateQueue } from "../core/planning.ts";
import { validate } from "../core/types.ts";
import type {
  Classification,
  ClassificationCheck,
  ClassificationKind,
  Config,
  DecisionRecord,
  Item,
  Plan,
  PlanDecision,
  Queue,
  QueueItem,
  RunState,
  TrivialItem,
} from "../core/types.ts";
import { writeFileAtomicSync } from "./state.ts";
import type { StateStore } from "./state.ts";
import { appendQuestion, answerQuestion, readQuestions } from "./questions.ts";
import type { Fanout, FanoutJob } from "./fanout.ts";

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

// Validate (schema-subset, §2.7) then append one JSON line to decisions.jsonl.
function appendDecision(runDir: string, record: DecisionRecord): void {
  const result = validate("DecisionRecord", record);
  if (!result.ok) {
    throw new Error("tools: refusing to write an invalid DecisionRecord: " + result.errors.join("; "));
  }
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
