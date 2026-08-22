// conductor/adapter/tools.ts — Task 5.3 (gate-hookup half; plan lines 2375-2391,
// §3.5 lines 1334-1427). The ONE function the plugin's tool.execute.before body
// calls, plus the §3.4 tool-name inventory and the tool-class derivation the
// session-registry gate dispatches on.
//
// Adapter module (G14): runs under BOTH the opencode plugin runtime and Node
// type-stripping, so it uses ONLY runtime-agnostic code — no single-runtime
// globals, no shell tag; the only subprocesses are the §3.3 review probe's git
// invocations, through node:child_process with argv arrays (the gitio.ts
// discipline — every test and verify child process goes through
// adapter/evidence.ts instead). All decision logic lives in the PURE core
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

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import * as path from "node:path";

import { decideGit } from "../core/gates-git.ts";
import {
  decideEdit,
  decideSession,
  interpreterStateAreaScript,
  writeShapedPaths,
} from "../core/gates-edit.ts";
import type { Decision, EditInput, SessionInput } from "../core/gates-edit.ts";
import {
  globMatch,
  isGitCommand,
  isWildcardHeaded,
  scopesIntersect,
  shellTokens,
  splitOnOperators,
} from "../core/shell-parse.ts";
import { isHumanTerritory, requireTwoOptions } from "../core/decide.ts";
import { advanceRun, legalRunTransition } from "../core/fsm-run.ts";
import { ITEM_STATES, legalItemTransition } from "../core/fsm-item.ts";
import {
  closingVerifyFailure,
  dispositionsOf,
  isResumableStop,
  runDispositionOf,
  stopKindOf,
} from "../core/disposition.ts";
import { legalTools, settledForReport } from "../core/gates-phase.ts";
import type { GateItem, GateRun, LegalToolsResult } from "../core/gates-phase.ts";
import {
  callerAllowed,
  isOverrideGate,
  legalityRowOf,
  nonTerminalAllowed,
  onceAtIntakeAllowed,
  undeclaredToolWhy,
  unknownOverrideGateWhy,
  verdictAllowed,
  readerMayOverrideGate,
  readerEditOverrideWhy,
} from "../core/tool-legality.ts";
import type { CallerIdentity } from "../core/tool-legality.ts";
import { packSection } from "../core/mechanics.ts";
import { impliedMustFix, renderVetCriteria } from "../core/vet-criteria.ts";
import {
  ITEM_MAX_FILES,
  findingBlocksItems,
  implementerAttemptBudget,
  routeFix,
  scanPlaceholders,
  validateQueue,
} from "../core/planning.ts";
import type { ScopeMeasurement } from "../core/planning.ts";
import { applyAmendOps } from "../core/queue-amend.ts";
import type { QueueAmendOp } from "../core/queue-amend.ts";
import { nextWave, readFanout } from "../core/schedule.ts";
import { findingSurvives } from "../core/verdict.ts";
import { checkReadWitness, createdFileDiff, diffContact, witnessNonce } from "../core/review-witness.ts";
import type { CreatedFile } from "../core/review-witness.ts";
import { findingSubjects, floorExclusions, receiptFloor } from "../core/receipt-floor.ts";
import { concernNamesFinding } from "../core/reply-protocol.ts";
import { MAIN_TREE, NO_TREE, SCHEMAS, treePath, treeSlug, validate } from "../core/types.ts";
import type { SideEffectClass, ToolClass } from "../core/types.ts";
import { builtinSideEffect, decideBuiltinSurface } from "../core/builtin-surface.ts";
import { networkShapedCommands } from "../core/gates-edit.ts";
import type {
  AnomalyRecord,
  AnswerChannel,
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
  QuestionRecord,
  Run,
  RunState,
  StopKind,
  TestVet,
  TreePath,
  TreeSlug,
  TrivialItem,
  Verdict,
} from "../core/types.ts";
import {
  pidIsAlive as pidStillRunning,
  readJsonFileSync,
  registerConductorExclude,
  writeFileAtomicSync,
} from "./state.ts";
import type { StateStore } from "./state.ts";
import { readJsonlTolerant } from "./jsonl.ts";
import { DEFAULT_CONFIG, configPath, loadConfig } from "./config-io.ts";
import { appendQuestion, answerQuestion, readQuestions } from "./questions.ts";
import { blockItemWithQuestion } from "./block-and-ask.ts";
import { answerFileAbsPath, pendingAnswers } from "./answer-file.ts";
import {
  answerDropPath,
  awaitsOperatorConfirmation,
  deferDecisionKind,
  isHumanProvenance,
  provenanceLabel,
} from "../core/provenance.ts";
import { headSha, indexMtimeMs, initRepo, isRepo, worktreeMtimes } from "./gitio.ts";
import { createWorktree, mergeBack } from "./worktrees.ts";
import { stampResolutionMsOf } from "./clock.ts";
import { verifyFreshFor } from "../core/freshness.ts";
import { isTerminal } from "../core/stops.ts";
import { noteRouterFailure, resolveBaseUrl } from "./router-client.ts";
import type { FailoverState, MetricsSummary } from "./router-client.ts";
import { buildCommitMessage, denylistedTrailerToken } from "../core/commit-message.ts";
import type { RedProof } from "../core/commit-message.ts";
import type { Fanout, FanoutJob, TreeState } from "./fanout.ts";
import { childEnv, detectRunner, runTest, runVerify, substituteItemTest } from "./evidence.ts";
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

// opencode's built-in sub-agent spawn tool (Task 0.2 discovery iii: its id is
// `task`). Spawning is denied in EVERY session — the load-bearing registry rule.
const SPAWN_TOOL = "task";
// The edit/write tools whose NAME alone marks the call a write, and whose single
// `args.filePath` the edit-scope gate adjudicates.
const WRITE_TOOLS: readonly string[] = ["edit", "write"];

// The patch tools, refused outright (D8, owner decision on ISSUE-017). They were
// registered write tools, but the edit branch adjudicates ONE `args.filePath` and
// a patch BODY carries none — so a multi-file patch reached the filesystem with
// only the registry gate between it and `.conductor/**`, a sibling tree, or
// anything outside fileScope, and no patch-body path extractor exists to build a
// decision from. opencode holds them in its registry without offering them
// (wire-notes.md), which is one config flip from reachable; the wire contract
// pins that, and the gate refuses the tools themselves. They still classify as
// WRITE so a gate crash on one fails closed (G5).
const DENIED_TOOLS: readonly string[] = ["apply_patch", "patch"];

export function classifyTool(toolName: string, command?: string): ToolClass {
  if (toolName === SPAWN_TOOL) return "spawn";
  if (toolName.startsWith("conductor_")) return "conductor";
  if (WRITE_TOOLS.includes(toolName) || DENIED_TOOLS.includes(toolName)) return "write";
  if (toolName === "bash") {
    const text = command ?? "";
    // An interpreter program naming the state area counts as a write even when no
    // literal path operand can be read out of it: it is refused downstream, and a
    // call refused as a write must not have been classified as a harmless read on
    // the way in (the crash-posture flag reads this classification).
    if (writeShapedPaths(text).length > 0) return "write";
    return interpreterStateAreaScript(text) !== null ? "write" : "read";
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
  // The tree PATH the §3.5 gates judge this session against (adapter/fanout.ts's
  // entry, read here through the shape this gate needs). Absent on an entry the
  // chat-message layer registered before any tree was resolved onto it.
  tree?: TreePath;
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

/**
 * §3.6's one-shot override grant, minted by handleOverride into a CALLER-owned
 * map (the sibling of the §3.5 session registry) and consumed — deleted — by the
 * first gate decision it converts from deny to allow. Keyed by
 * {sessionID, gate, itemId}, so a foreign session can neither see nor spend it.
 */
export interface OverrideGrant {
  sessionID: string;
  gate: string;
  itemId: string;
  reason: string;
  grantedAction: string;
  tsMs: number;
}

function overrideGrantKey(sessionID: string, gate: string, itemId: string): string {
  return sessionID + "::" + gate + "::" + itemId;
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
  // The tree a live verify has frozen, as the PATH core/gates-edit.ts compares
  // it against — the composition root translates the marker slug (§3.5).
  verifyInFlightTree: TreePath | null;
  inlineClaimScope: string[] | null;
  // §3.6: the caller-owned map handleOverride writes one-shot grants into. A
  // grant bypasses exactly ONE otherwise-denied decision of its named gate.
  overrideGrants?: Map<string, OverrideGrant>;
  // The §2 tool-surface lane flags, each individually revertible. ABSENT READS AS
  // ENABLED: a composition root that forgets to pass them gets the governance
  // floor rather than losing it, which is the only default a fail-closed gate can
  // have. config.toolSurface is what the plugin threads in.
  toolSurface?: { classifyBuiltins: boolean; denyNetwork: boolean };
  journal: GateJournal;
  corr: Corr;
  deps?: GateDeps;
}

// The §2 class of a bash call, derived from its command rather than its name. A
// command with a write-shaped target is W; everything else this phase can decide
// is R0. The R1/R2/R3 discriminations belong to the extractors Task 21.4 adds,
// and until they exist a read-shaped bash is R0 — which is the honest statement
// that this layer cannot yet tell `ls` from `curl`, rather than a claim that it
// can.
function bashSideEffect(
  command: string,
  writeTargets: readonly string[],
  networkPrograms: readonly string[],
): SideEffectClass {
  // Write wins over network when a command is both: the write gates bound a
  // target, and losing that adjudication to a coarser refusal would be a
  // downgrade even though the call is refused either way.
  if (writeTargets.length > 0) return "W";
  if (interpreterStateAreaScript(command) !== null) return "W";
  if (networkPrograms.length > 0) return "R3";
  // The R1/R2 discriminations belong to the typed handlers of a later phase.
  // Until those exist, a read-shaped bash is R0 — the honest statement that this
  // layer cannot tell a checker from an `ls`, not a claim that it can.
  return "R0";
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

// Which of the gate stack's tables refused. The observer groups denies by this
// name and the whole reading of a deny rate rests on it — `edit` says the plan's
// scopes are wrong, `git` says the session reached for a commit it may not make,
// `session` says something called from an unregistered session
// (docs/developer/observing-a-run.md). The reason string carries the argument;
// this carries the table, because a prose reason cannot be grouped.
type DenyGate = "tool" | "surface" | "session" | "git" | "edit";

// The §7.4 input snapshot for a deny: enough context (the refusing gate, toolName,
// raw args, the repro command/path, and the reason) to reproduce the decision
// through the pure core function in a test.
function denySnapshot(input: GateHookInput, gate: DenyGate, reason: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    gate,
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
function denyThrow(input: GateHookInput, gate: DenyGate, reason: string): never {
  input.journal.log("warn", "gates", "deny", denySnapshot(input, gate, reason), input.corr);
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

// §3.6's one-shot bypass, at the point of denial: when the named gate would
// deny, a live grant keyed to {sessionID, gate, itemId} converts that ONE
// decision to allow and is deleted (consumed) in the same breath — any later
// action in the session, the same one repeated or a different one, meets the
// gate on its ordinary terms. The consumption is journaled at warn so the
// bypassed deny stays as visible as a deny itself (§2.8 taints the item; this
// journals the moment the grant was spent). It rides `gates: allow` — the §7.4
// name for this gate's disposition, which is exactly what the grant produced —
// with the spent grant in the record's data; `gates: override-granted` names the
// hatch MINTING a grant (handleOverride), not a gate spending one.
function consumeOverrideGrant(input: GateHookInput, gate: string): boolean {
  const grants = input.overrideGrants;
  if (grants === undefined) return false;
  const itemId = input.registry.get(input.sessionID)?.itemId;
  if (itemId === undefined) return false;
  const key = overrideGrantKey(input.sessionID, gate, itemId);
  const grant = grants.get(key);
  if (grant === undefined) return false;
  grants.delete(key);
  input.journal.log(
    "warn",
    "gates",
    "allow",
    {
      via: "override-grant",
      gate,
      itemId,
      grantedAction: grant.grantedAction,
      reason: grant.reason,
      toolName: input.toolName,
    },
    input.corr,
  );
  return true;
}

// The §7.4 record for a call every gate allowed (Task 21.5).
//
// `gates: allow` already existed and fired in exactly one circumstance — an
// override grant being SPENT — so an ordinary allowed read left no trace. The
// campaign asks what each arm reached and whether reaching it correlated with
// passing, and only the denies could answer that.
//
// A network allow is `warn` because it should be rare and each one is worth an
// operator's attention; everything else is `debug`, because a read allow is the
// highest-volume event in the system and belongs behind a verbosity a campaign
// turns up deliberately. An ordinary allow carries no `via`, which is what keeps
// it distinguishable from the grant-spend record that shares its name.
function journalAllow(
  input: GateHookInput,
  toolClass: ToolClass,
  sideEffect: SideEffectClass | undefined,
  networkPrograms: readonly string[],
): void {
  const data: Record<string, unknown> = {
    toolName: input.toolName,
    toolClass,
    sideEffect: sideEffect ?? null,
  };
  if (networkPrograms.length > 0) {
    data.networkPrograms = [...networkPrograms];
    // The command is the evidence for a network allow and nothing else needs it,
    // so it rides only that record, bounded.
    const command = input.command ?? "";
    data.command = command.length > 500 ? command.slice(0, 500) + "…" : command;
  }
  input.journal.log(sideEffect === "R3" ? "warn" : "debug", "gates", "allow", data, input.corr);
}

export function gateBeforeToolCall(input: GateHookInput): void {
  const entry = input.registry.get(input.sessionID);
  const registered = entry !== undefined;
  const role = entry?.role ?? null;
  const sessionTree = entry?.tree ?? NO_TREE;

  const command = input.command;
  const gitSegmentPresent = command !== undefined && hasGitSegment(command);
  const writeTargets = command !== undefined ? writeShapedPaths(command) : [];
  const toolClass = classifyTool(input.toolName, command);
  // §2 side-effect class. A bash call has none by name — `ls` is R0 and `curl` is
  // R3 — so it is classified from its command by the extractors below; every
  // other name reads its class from the table.
  // The network programs a bash command reaches, read from the command with the
  // same tokenizer and wrapper unwrapping the write shapes use. Computed once:
  // it feeds both the class below and the refusal's own text.
  const networkPrograms = command !== undefined ? networkShapedCommands(command) : [];
  const sideEffect =
    input.toolName === "bash"
      ? bashSideEffect(command ?? "", writeTargets, networkPrograms)
      : builtinSideEffect(input.toolName);

  // The fail-closed guardedness flag (G5), computed ONCE from the real parse:
  // anything that could write, advance conductor state, or spawn a child must
  // fail closed on a gate crash; only a harmless read fails open. An unclassified
  // tool is guarded too: the whole point of refusing it is that nobody can say
  // what it reaches, which is not a claim that it reaches nothing.
  const guarded =
    gitSegmentPresent ||
    writeTargets.length > 0 ||
    toolClass === "write" ||
    toolClass === "conductor" ||
    toolClass === "spawn" ||
    sideEffect === "R3" ||
    sideEffect === undefined;

  // (a0) The patch tools, refused before every other gate and in every session
  //      (D8). There is no adjudicable payload to reach a scope decision with: a
  //      patch body names its targets in a format no gate here parses, and the
  //      one `args.filePath` the edit branch reads is absent from exactly the
  //      multi-file shape that matters. A refusal that does not depend on the
  //      call's arguments cannot be spelled around by choosing different ones.
  if (DENIED_TOOLS.includes(input.toolName)) {
    denyThrow(
      input,
      "tool",
      "the " +
        input.toolName +
        " tool is denied in every session: a patch body carries its own write targets in a form no gate adjudicates, so the edit-scope gate cannot bound it. Use the edit/write tools, whose target is a single path this session's scope is checked against",
    );
  }

  // (a1) The §2 tool-surface gate. A property of the TOOL, not of the session, so
  //      it sits beside the patch refusal rather than inside the registry gate: a
  //      stray unregistered reader and a dispatched implementer meet the same
  //      table. It is grant-consumable on the same terms as every other deny —
  //      §3.6 is a budgeted, taint-recording hatch, not an exemption.
  const surfaceDecision = guardedDecide(
    input,
    guarded,
    { gate: "session", toolName: input.toolName, toolClass },
    () =>
      decideBuiltinSurface({
        toolName: input.toolName,
        ...(sideEffect === undefined ? {} : { commandClass: sideEffect }),
        classifyBuiltins: input.toolSurface?.classifyBuiltins ?? true,
        denyNetwork: input.toolSurface?.denyNetwork ?? true,
        networkPrograms,
      }),
  );
  if (surfaceDecision.action === "deny" && !consumeOverrideGrant(input, "session")) {
    denyThrow(input, "surface", reasonOf(surfaceDecision, "the tool-surface gate denied this call"));
  }

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
  if (sessionDecision.action === "deny" && !consumeOverrideGrant(input, "session")) {
    denyThrow(input, "session", reasonOf(sessionDecision, "the session-registry gate denied this call"));
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
  // Every path that reaches here has passed every gate. Routing each exit through
  // one closure is what makes the record per CALL rather than per gate.
  const allow = (): void => {
    journalAllow(input, toolClass, sideEffect, networkPrograms);
  };

  if (input.toolName === "bash") {
    if (command === undefined) return allow();

    const gitDecision = guardedDecide(
      input,
      guarded,
      { gate: "git", toolName: input.toolName, command },
      () => decideGitFn(command, role ?? "", input.gitMode, input.runActive, input.branchPolicy),
    );
    if (gitDecision.action === "deny" && !consumeOverrideGrant(input, "git")) {
      denyThrow(input, "git", reasonOf(gitDecision, "the git gate denied this command"));
    }

    // The state area, ahead of every path-shaped decision. An interpreter program
    // that names `.conductor` is refused whether or not its path operand is a
    // literal this file can read: the state area's whole value is that a gated
    // session cannot write it, and a rule that holds only for the spellings the
    // extractor parses would leave the provenance channel resting on the model's
    // choice of syntax. Grant-consumable on the same terms as every other edit
    // deny — §3.6 is a budgeted, taint-recording hatch, not an exemption.
    const stateAreaScript = interpreterStateAreaScript(command);
    if (stateAreaScript !== null && !consumeOverrideGrant(input, "edit")) {
      denyThrow(
        input,
        "edit",
        "an interpreter one-liner naming the .conductor state area is denied outright: the state " +
          "area is handler-written only, and a program text can build the path it writes to, so " +
          "the mention itself is the refusal. The offending program was: " +
          (stateAreaScript.length > 200 ? stateAreaScript.slice(0, 200) + "…" : stateAreaScript),
      );
    }

    for (const target of writeTargets) {
      const editDecision = guardedDecide(
        input,
        guarded,
        { gate: "edit", toolName: input.toolName, command, editPath: target },
        () => decideEditFn(editInputFor(target)),
      );
      if (editDecision.action === "deny" && !consumeOverrideGrant(input, "edit")) {
        denyThrow(input, "edit", reasonOf(editDecision, "the edit-scope gate denied this write"));
      }
    }
    return allow();
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
    if (editDecision.action === "deny" && !consumeOverrideGrant(input, "edit")) {
      denyThrow(input, "edit", reasonOf(editDecision, "the edit-scope gate denied this edit"));
    }
  }

  allow();
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
export function handlerRunDir(store: StateStore, runId: string): string {
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
//
// Each bound states itself. §2.10's disposition here is an ESCALATION rather than a
// refusal, so nothing is thrown and the reason reaches an operator only if the check
// carries it: an escalation nobody can see is a guard nobody can watch fail.
function trivialRecheckViolations(trivialItem: TrivialItem, config: Config): string[] {
  const violations: string[] = [];
  if (trivialItem.fileScope.length > config.workflow.trivialMaxFiles) {
    violations.push(
      "the trivial item claims " +
        String(trivialItem.fileScope.length) +
        " fileScope entries, over the workflow.trivialMaxFiles ceiling of " +
        String(config.workflow.trivialMaxFiles) +
        " (§2.4)",
    );
  }
  if (trivialItem.behavioral && trivialItem.testScope.length === 0) {
    violations.push(
      "the trivial item is behavioral:true and declares an empty testScope: a behavioral change owes " +
        "the test paths that will prove it (§2.4)",
    );
  }
  if (!trivialItem.behavioral && scopesIntersect(trivialItem.fileScope, config.verify.behavioralPaths)) {
    violations.push(
      "the trivial item is behavioral:false while its fileScope intersects verify.behavioralPaths: an " +
        "item cannot declare itself untestable while editing behavioral production code (§2.4 " +
        "disjoint-path guard)",
    );
  }
  return violations;
}

// The §2.4 queue a `trivial` classification synthesizes: one item, the reserved id,
// dependsOn empty. Composed in ONE place, so the queue the re-check judges and the
// queue that reaches queue.json are the same value and cannot say different things.
const TRIVIAL_ITEM_ID = "I1";

function trivialQueue(trivialItem: TrivialItem): Queue {
  return {
    items: [
      {
        id: TRIVIAL_ITEM_ID,
        title: trivialItem.title,
        rationale: trivialItem.rationale,
        fileScope: [...trivialItem.fileScope],
        testScope: [...trivialItem.testScope],
        acceptance: [...trivialItem.acceptance],
        behavioral: trivialItem.behavioral,
        dependsOn: [],
        ponytail: { ...trivialItem.ponytail },
      },
    ],
  };
}

// ONE ACCEPTANCE AUTHORITY. The §2.4 schema and the trivial re-check above answer
// only "is this a well-formed item within the trivial bounds"; every §3.2
// queue-acceptance rule — the wildcard-headed glob that hands the implementer the
// whole tree, the matched-file size budget, the read-set token bound, the id shape
// and newline rules the §3.3 commit template rests on, the testScope-inside-fileScope
// licence — lives in core validateQueue, and was reachable only through
// conductor_decompose. A request classified `trivial` instead of `work` therefore
// walked past all of it and wrote the scope the §3.6 edit gate binds its implementer
// to. Judged here by the same pure function, against the same measured scope facts
// (ISSUE-012's entry-count hole is measured, not counted), with no relaxation: a
// trivial item is one item, so the inter-item rows are vacuous for it and every
// remaining row means for it exactly what it means for a planned one.
//
// The composed queue is judged against SCHEMAS.Queue by the same call and reported the
// same way, because both answers answer one question — is THIS the item to synthesize
// — and a receipt that cannot be written is not an item the acceptance table can admit.
function trivialAcceptanceViolations(queue: Queue, config: Config, root: string): string[] {
  const shape = validate("Queue", queue);
  if (!shape.ok) {
    return shape.errors.map((error) => "the synthesized queue.json is not a valid Queue: " + error);
  }
  return validateQueue(queue, config, measureQueueScopes(root, queue)).violations;
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
// Read the §2.7 decision ledger. It had an appender and NO reader at HEAD, which
// is why the report's decision-ledger section was uncovered: nothing had ever
// needed to read back what the run decided. Torn-line tolerant for the same
// reason the mint is — a crash artifact must not wedge the closing report.
function readDecisions(runDir: string): DecisionRecord[] {
  const ledgerPath = path.join(runDir, "decisions.jsonl");
  if (!existsSync(ledgerPath)) return [];
  let raw = readFileSync(ledgerPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const out: DecisionRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as DecisionRecord);
    } catch {
      continue;
    }
  }
  return out;
}

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
  // Every re-check reason that forced `work`, verbatim from the rule that produced
  // it; empty when nothing escalated. The caller reads WHY a request it proposed as
  // trivial is being planned instead.
  escalation: string[];
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
// run.classification; escalate to the stricter kind on disagreement AND to `work` on
// any re-check failure — the §2.4 bounds, the §2.10 cross-field rule, or the §3.2
// acceptance table; on a surviving trivial, synthesize queue.json + the runtime item
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
    tree: NO_TREE,
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
    tree: NO_TREE,
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

  // Handler re-check (classifier proposes, handler disposes): a surviving trivial is
  // escalated to work on ANY violation — the §2.4 bounds, the §2.10 cross-field rule,
  // or the §3.2 acceptance table — even when the skeptic AGREED trivial. §2.10 gives
  // escalation as the disposition for all of them, and this stage has no re-prompt of
  // its own: a refusal that throws persists nothing, so `classified` stays false, the
  // phase gate re-offers conductor_classify, and classifierPrompt is a pure function of
  // run.prompt — the next roll is byte-identical input to the same model and the run
  // never leaves INTAKE. `work` is the route that can converge, because the planner
  // decomposes the same request under conductor_decompose's bounded re-prompt.
  //
  // That is what makes escalation the disposition rather than a re-prompt or an attempt
  // counter: a re-check verdict is a FUNCTION of the prompt, so re-rolling it returns
  // the same verdict forever, and once the classification is recorded the phase gate's
  // once-at-intake rule makes a second conductor_classify illegal — the loop is closed
  // by construction, with nothing left to count. The two dispatch refusals above are a
  // different failure: a sub-session that returns no valid receipt has already spent the
  // fan-out's own retry budget, and its reply is not a function of the prompt.
  const proposedItem = classification.trivialItem;
  let escalation: string[] = [];
  let synthesized: Queue | null = null;
  if (finalKind === "trivial") {
    if (proposedItem === null) {
      // A "trivial" disposition with NOTHING to synthesize: the classifier itself did
      // not say trivial, so there is no trivialItem (the §2.10 cross-field rule ties a
      // non-null trivialItem to kind "trivial"), and a skeptic's question→trivial
      // correction cannot conjure one. An un-synthesizable trivial is not a legal
      // EXECUTING run (F1).
      escalation = [
        'the disposition is "trivial" with no trivialItem to synthesize: the §2.10 cross-field rule ' +
          "ties a trivialItem to a classifier that said trivial, and a correction cannot supply one",
      ];
    } else {
      const candidate = trivialQueue(proposedItem);
      escalation = trivialRecheckViolations(proposedItem, config);
      if (escalation.length === 0) {
        // The §3.2 table measures scopes against the tree this run executes in, so it
        // is asked only once the cheap §2.4 bounds hold: an item already escalating
        // owes no glob walk.
        escalation = trivialAcceptanceViolations(candidate, config, store.root);
      }
      if (escalation.length === 0) synthesized = candidate;
    }
    if (escalation.length > 0) {
      finalKind = "work";
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: "classify", disposition: "escalate-to-work", violations: escalation },
        { runId, sessionID: input.sessionID },
      );
    }
  }

  // (2) persist: record the final kind + the embedded (normalized) skeptic check.
  // `classified` is the RECEIPT the legality choke point reads: run.classification
  // is written provisionally at intake, so only this flag distinguishes "the
  // classifier has spoken" from "a placeholder is standing in for it" — and
  // conductor_classify is legal exactly while it is false (§3.2).
  run.classification = {
    kind: finalKind,
    rationale: classification.rationale,
    check: { agreed, note: check.note },
  };
  run.classified = true;

  let itemId: string | null = null;
  if (finalKind === "trivial") {
    if (synthesized === null) {
      // Unreachable: a trivial that reaches here carries a queue the §2.4 bounds, the
      // §2.10 cross-field rule and the §3.2 table all admitted, and anything else was
      // disposed to work above. Retained as a typed invariant guard (it narrows the
      // queue for the write below), never a live throw path.
      throw new Error("conductor_classify: a trivial classification must carry a synthesized queue (§2.10)");
    }
    // LEGALITY BEFORE PERSIST: the queue written here is the one the re-check judged,
    // so nothing reaches the run dir that the §3.2 acceptance table has not admitted.
    itemId = TRIVIAL_ITEM_ID;
    writeFileAtomicSync(path.join(runDir, "queue.json"), JSON.stringify(synthesized, null, 2));

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

  return { kind: finalKind, agreed, correctedKind, itemId, runState: run.state, escalation };
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

// The §7.4 name the injection layer's delivery record rides, spelled ONCE for the
// writer (plugin/index.ts's transform hook) and this reader. `inject` /
// `system-append` is already the listed vocabulary entry for "the system-prompt
// append the plugin performs" (core/journal-events.ts), so reading it back adds no
// name to the closed set.
const DELIVERY_COMPONENT = "inject";
const DELIVERY_EVENT = "system-append";

// What ONE session was last handed by the §6.4 injection layer: its §4.1 role, the
// doctrine packs that role received, and the digest of their bytes. Read back from
// the delivery record the transform hook already writes — §7.4's `inject` /
// `system-append` — so the surface reports what WAS delivered rather than what a
// fresh composition would produce at read time, and the closed journal vocabulary
// is not widened for it.
export interface StatusDelivery {
  sessionID: string;
  role: string;
  packs: string[];
  packDigest: string;
}

export interface StatusResult {
  runId: string;
  state: RunState;
  classification: { kind: ClassificationKind } | null;
  items: StatusItem[];
  // GAP-013: each open question carries the repo-relative path the OPERATOR drops
  // an answer at. A channel nobody is told about is a channel nobody uses, and the
  // model's own relay is then the only route a human's judgment has.
  openQuestions: Array<{ id: string; question: string; answerPath: string }>;
  // ISSUE-051's live-surface half. A §6.2 human-territory question the model
  // answered through the tool is RECORDED but not settled: the run it blocks
  // stays stopped until the operator's own artifact arrives. Such a question
  // carries an answer, so it leaves openQuestions — and a reader of status was
  // then told the run had nothing outstanding while it sat stopped on exactly
  // that. It is carried here instead, with the notice the §2.9 report renders
  // and the path the operator still owes, off the one predicate both surfaces
  // read (core/provenance.ts awaitsOperatorConfirmation).
  standingQuestions: Array<{
    id: string;
    question: string;
    answerPath: string;
    notice: string;
  }>;
  // One row per session that has received doctrine in this run, its LAST delivery
  // (G9: the delivery is re-composed every request, so only the most recent one
  // describes the session as it stands). Empty when nothing has been delivered —
  // an absent field and an empty list would otherwise say the same thing.
  deliveries: StatusDelivery[];
}

// The last §6.4 delivery per session, read off the run's journal. Cheap by
// construction: the file is scanned line by line and only the lines that carry the
// delivery event name are parsed, so a run whose journal is mostly FSM traffic
// costs a substring test per line. A journal that cannot be read yields no rows —
// status is a read surface and must not fail because a record is torn.
function deliveriesOf(runDir: string): StatusDelivery[] {
  const file = path.join(runDir, "journal.jsonl");
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const bySession = new Map<string, StatusDelivery>();
  for (const line of text.split("\n")) {
    if (!line.includes(DELIVERY_EVENT)) continue;
    let record: {
      component?: unknown;
      event?: unknown;
      sessionID?: unknown;
      data?: Record<string, unknown>;
    };
    try {
      record = JSON.parse(line) as typeof record;
    } catch {
      continue; // a torn trailing line is not a reason to report no deliveries at all
    }
    if (record.component !== DELIVERY_COMPONENT || record.event !== DELIVERY_EVENT) continue;
    const sessionID = typeof record.sessionID === "string" ? record.sessionID : "";
    if (sessionID.length === 0) continue;
    const data = record.data ?? {};
    const packs = Array.isArray(data["packs"])
      ? (data["packs"] as unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    // Last write wins: the delivery is re-composed on every request (G9), so the
    // final record is the one that describes the session as it stands.
    bySession.set(sessionID, {
      sessionID,
      role: typeof data["role"] === "string" ? (data["role"] as string) : "",
      packs,
      packDigest: typeof data["packDigest"] === "string" ? (data["packDigest"] as string) : "",
    });
  }
  return [...bySession.values()].sort((a, b) => (a.sessionID < b.sessionID ? -1 : 1));
}

// Render the run/item/question dispositions. READ-ONLY: it mutates no persisted
// byte — every access is a store read (loadRun/loadItem), a questions read or a
// journal read.
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

  const openQuestions: StatusResult["openQuestions"] = [];
  const standingQuestions: StatusResult["standingQuestions"] = [];
  for (const q of readQuestions(runDir)) {
    if (q.answeredIso === null) {
      openQuestions.push({ id: q.id, question: q.question, answerPath: answerDropPath(runId, q.id) });
    } else if (awaitsOperatorConfirmation(q)) {
      standingQuestions.push({
        id: q.id,
        question: q.question,
        answerPath: answerDropPath(runId, q.id),
        notice: standingQuestionNotice(runId, q.id),
      });
    }
  }

  const classification =
    run.classification !== null && run.classification !== undefined
      ? { kind: run.classification.kind }
      : null;

  return {
    runId,
    state: run.state,
    classification,
    items,
    openQuestions,
    standingQuestions,
    deliveries: deliveriesOf(runDir),
  };
}

// ---------------------------------------------------------------------------
// conductor_decide (§2.7)
// ---------------------------------------------------------------------------

const DECIDE_TOOL = "conductor_decide";

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

  // (1b) C-029(b): the SECOND legality check, beside the first and before the same
  //      persist. A kind:"derived" decision claims the answer was derivable, and
  //      §6.2 says a human-territory question is not: deriving one settles, on the
  //      model's own authority, a matter the human owns. So it is refused and the
  //      question is SURFACED instead — through the ONE §2.11 writer, on the
  //      EXISTING closed-vocabulary origin, blocking no item (the run may still
  //      have work it can do). kind:"human" is the legal way to record the same
  //      question: that record IS the human's answer.
  if (record.kind === "derived" && isHumanTerritory(record.question)) {
    appendQuestion(
      runDir,
      {
        runId,
        question: record.question,
        askedBy: { role: "orchestrator", sessionID: "" },
        humanTerritory: true,
        origin: "surface-tool",
        blocksItems: [],
      },
      now(),
    );
    journal.log(
      "info",
      "state",
      "question.surfaced",
      { question: record.question, humanTerritory: true, refusedDecision: "derived" },
      { runId },
    );
    throw new Error(
      DECIDE_TOOL +
        ': refusing a kind:"derived" decision for a §6.2 human territory question — "' +
        record.question +
        '". It has been surfaced as a §2.11 question instead; record the human\'s answer with kind:"human".',
    );
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
  // GAP-013: where the human writes the answer. Returned by the surfacing call
  // itself so the path travels with the question that needs it.
  answerPath: string;
}

// Append the §2.11 question (origin surface-tool), set blocked:{questionId} on every
// named item, leave un-named items actionable (the run continues on them), journal.
export function handleSurface(input: SurfaceInput): SurfaceResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality before persist (§3.4): every named item must exist. A bad id aborts
  //     the whole call with ZERO writes — no orphan question, no half-applied block.
  //     The same pass records which named items are ALREADY blocked, for the
  //     first-block-wins rule below.
  const alreadyBlocked = new Set<string>();
  for (const itemId of input.blocksItems) {
    let existing: Item;
    try {
      existing = store.loadItem(runId, itemId);
    } catch {
      throw new Error('conductor_surface: item "' + itemId + '" does not exist; refusing to surface');
    }
    if (existing.blocked !== null && existing.blocked !== undefined) alreadyBlocked.add(itemId);
  }

  // (1b) the drop directory. GAP-013 prints an answer path with every surfaced
  //      question, and nothing created the directory it sits in — so the operator's
  //      first `echo > <path>` failed ENOENT on a channel advertised as "one echo
  //      is the whole protocol". It is made HERE, before anything is persisted, so
  //      a run dir that cannot hold the channel aborts the surface with zero writes
  //      rather than surfacing a question nobody can answer. Derived through the
  //      same answer-file path function the reader uses, never a second join.
  mkdirSync(path.dirname(answerFileAbsPath(runDir, "Q-0001")), { recursive: true });

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
    // FIRST-BLOCK-WINS. §2.5 gives an item exactly ONE `blocked` disposition and
    // conductor_answer keys the release on blocked.questionId, so the first block that
    // names an item owns it. Overwriting would erase every trace of the earlier question
    // from the item: answering THIS question would then release an item the earlier one
    // still gates, with nothing on disk pointing back at it (§2.11 forbids hand-editing
    // state to resume). The later question is still appended and still records the item in
    // its own blocksItems — that is what the caller asserted — but the item keeps the block
    // it already had, and blockedItemIds names only what this question actually blocked.
    // The plan-review cap path applies the identical rule.
    if (alreadyBlocked.has(itemId)) continue;
    store.setBlocked(runId, itemId, {
      reason: "blocked on surfaced question " + question.id,
      stage: "surface",
      questionId: question.id,
    });
    alreadyBlocked.add(itemId); // a repeated id in blocksItems must not re-block either
    blockedItemIds.push(itemId);
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId: question.id },
      { runId, itemId },
    );
  }

  return {
    questionId: question.id,
    blockedItemIds,
    answerPath: answerDropPath(runId, question.id),
  };
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
  // GAP-013: the CHANNEL this answer arrived through, supplied by the caller that
  // OBSERVED it — never by the model. The tool binding fixes it to "tool" (the
  // same construction C-044 uses to keep conductor_decide derived), so the only
  // caller that can pass "human-file" is ingestAnswerFiles, which passes it
  // because it just read a file out of the state area no session may write.
  via: AnswerChannel;
}

export interface AnswerHandlerResult {
  questionId: string;
  clearedItemIds: string[];
  // ISSUE-066's resume path: true when this answer revived a run that had stopped
  // waiting for it. Reported rather than left implicit so the caller — and the
  // §3.7 continuation engine reading the same run — is not left guessing whether
  // there is still a run to advance.
  resumed: boolean;
}

// Clear blocked on EXACTLY the items bound to the question and mark it answered —
// delegated to questions.answerQuestion, which owns the C-018/C-020 clear-first-
// then-mark wedge order (never re-implemented here). Journal, return the cleared ids.
export function handleAnswer(input: AnswerInput): AnswerHandlerResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  const result = answerQuestion(runDir, input.questionId, input.answer, input.via, now());

  // The provenance record, filed under its own §7.4 name: a replay filter looking
  // for "what did a human actually decide in this run?" reads this event and its
  // `human` field. item.updated describes the items an answer released and would
  // make that question unanswerable.
  journal.log(
    "info",
    "state",
    "question.answered",
    {
      questionId: input.questionId,
      via: input.via,
      human: isHumanProvenance(input.via),
      clearedItemIds: result.clearedItemIds,
    },
    { runId },
  );

  // C-056's residual. handleSurface applies FIRST-BLOCK-WINS: a later question
  // that names an already-blocked item is still appended, and still records that
  // item in its own blocksItems, but the item's single §2.5 `blocked` disposition
  // keeps pointing at the FIRST question. answerQuestion keys the release purely
  // on blocked.questionId, so answering the first would RELEASE an item a second
  // open question still gates — first-block-wins is only coherent if the block
  // hands off. So a released item is re-blocked on the OLDEST still-open question
  // that names it, and released only when none remains.
  //
  // The successor search runs AFTER answerQuestion has returned, so the ledger it
  // reads already carries the answer and the answeredIso guard alone excludes the
  // question just answered; the explicit id test beside it is defence in depth for
  // any future caller that searches DURING the clear phase (answerQuestion marks
  // the question answered LAST, the C-018/C-020 clear-first wedge order, so a scan
  // inside that window would find it still open and re-block the item on the very
  // question that just released it). A re-blocked item is NOT reported in
  // clearedItemIds either — this journal says `blocked: null` for every id it
  // returns there, and listing a still-blocked item would make the record say the
  // opposite of the disk.
  let ledger: QuestionRecord[] = [];
  try {
    ledger = readQuestions(runDir);
  } catch {
    ledger = [];
  }
  const clearedItemIds: string[] = [];
  for (const itemId of result.clearedItemIds) {
    const successor = ledger.find(
      (candidate) =>
        candidate.id !== input.questionId &&
        candidate.answeredIso === null &&
        candidate.blocksItems.includes(itemId),
    );
    if (successor === undefined) {
      clearedItemIds.push(itemId);
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, blocked: null, clearedQuestionId: input.questionId },
        { runId, itemId },
      );
      continue;
    }
    let stage = "surface";
    try {
      stage = store.loadItem(runId, itemId).state;
    } catch {
      stage = "surface";
    }
    store.setBlocked(runId, itemId, {
      reason: "blocked on surfaced question " + successor.id,
      stage,
      questionId: successor.id,
    });
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId: successor.id, succeededQuestionId: input.questionId },
      { runId, itemId },
    );
  }

  return {
    questionId: input.questionId,
    clearedItemIds,
    resumed: reviveIfWaiting(store, runId, journal, result.question),
  };
}

// ISSUE-066's lost work, closed. A run that stopped honestly — `blocked`,
// `surfaced`, or the `noop` the futile detector fires on a run stalled behind an
// unanswered question — was terminal the instant the stop was recorded, and the
// idle engine then archived it and cleared the current-run pointer. Answering the
// question afterwards released the item and left the dependent PENDING forever:
// the documented resume path was dead, and the honest waiting model lost committed
// work while the model that deferred the same item closed clean.
//
// The revival is deliberately narrow. It clears ONLY the stop record, and only on
// a run whose FSM position is still non-terminal — a run terminal by STATE has
// been closed by conductor_report and has its §2.9 artifact, and reviving it would
// mean inventing a backwards FSM edge. So no transition is taken, no state is
// rewritten, and nothing but the stop and the pointer moves.
//
// It is narrow in a second way (the Phase III fix round). The revival ran for
// EVERY answer channel, and conductor_answer's channel is PINNED to `tool` — so an
// orchestrator that stopped its run on a §6.2 human question could answer that
// question itself and un-stop the run in the next call. The escalation a `blocked`
// stop exists to force was a two-call formality performed entirely by the model.
// A human-territory question is released by the operator's artifact and nothing
// else (core/provenance.ts awaitsOperatorConfirmation); the answer is still
// RECORDED either way, and the report names a question that is answered but still
// standing, so the tool answer is preserved rather than discarded.
function reviveIfWaiting(
  store: StateStore,
  runId: string,
  journal: HandlerJournal,
  question: QuestionRecord,
): boolean {
  if (awaitsOperatorConfirmation(question)) return false;
  let run: Run;
  try {
    run = store.loadRun(runId);
  } catch {
    return false;
  }
  const stop = run.stop;
  if (stop === null) return false;
  if (!isResumableStop(stop.kind)) return false;
  // §2.3 terminality has two sources; only the stop-record source is revivable.
  if (isTerminal({ state: run.state, stop: null })) return false;

  run.stop = null;
  store.saveRun(run);
  store.resumeRun(runId);
  journal.log(
    "info",
    "state",
    "run.resumed",
    { resumedFromStop: stop.kind, questionId: question.id, reasonDisplay: stop.reasonDisplay },
    { runId },
  );
  return true;
}

// The §2.11 question a deferral cites as its human authority, or null when it
// cites none. A citation that names an unknown question, an unanswered one, or one
// answered through the tool is REFUSED by name: those are the three ways a caller
// can point at something that does not carry a human's judgment, and each one gets
// its own message so the refusal is diagnosable rather than mysterious.
function requireDeferAuthority(
  runDir: string,
  questionId: string | undefined,
): { answeredVia: AnswerChannel | null } | null {
  if (questionId === undefined) return null;
  let ledger: QuestionRecord[];
  try {
    ledger = readQuestions(runDir);
  } catch (error) {
    throw new Error(
      'conductor_defer: cannot read questions.jsonl to adjudicate the cited question "' +
        questionId +
        '": ' +
        String(error),
    );
  }
  const cited = ledger.find((question) => question.id === questionId);
  if (cited === undefined) {
    throw new Error(
      'conductor_defer: the cited question "' + questionId + '" is not in this run\'s §2.11 ledger; refusing to defer',
    );
  }
  if (cited.answeredIso === null) {
    throw new Error(
      'conductor_defer: the cited question "' +
        questionId +
        '" is still OPEN, so nothing was decided; refusing to record human provenance',
    );
  }
  if (!isHumanProvenance(cited.answeredVia)) {
    throw new Error(
      'conductor_defer: the cited question "' +
        questionId +
        '" was answered via ' +
        String(cited.answeredVia) +
        ", not the human-file channel; only an answer the model could not write mints human provenance",
    );
  }
  return { answeredVia: cited.answeredVia };
}

// ---------------------------------------------------------------------------
// GAP-013: the answer-file ingest — the HARNESS's half of the out-of-band channel
// ---------------------------------------------------------------------------

export interface IngestAnswersInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
  now?: () => number;
}

export interface IngestedAnswer {
  questionId: string;
  clearedItemIds: string[];
  resumed: boolean;
}

/**
 * Ingest every answer the operator has dropped for an OPEN question of this run,
 * recording each as `human-file` provenance.
 *
 * This is the only caller that may pass "human-file", and it may because of what
 * it read: a file under `.conductor/runs/<runId>/answers/`, an area
 * core/gates-edit.ts denies to every session. Nothing here trusts a caller's
 * claim — the claim IS the file's existence.
 *
 * It routes through handleAnswer rather than answerQuestion so an out-of-band
 * answer takes exactly the same path a typed one does: the C-056 successor
 * re-block, the journal record, and ISSUE-066's revival of a run that stopped
 * waiting for precisely this answer. The one difference is the provenance.
 *
 * Read-tolerant by design: a torn questions.jsonl yields no open questions and no
 * ingest, because a pass that cannot see the ledger must not invent answers for
 * it.
 */
export function ingestAnswerFiles(input: IngestAnswersInput): IngestedAnswer[] {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  let openIds: string[];
  try {
    openIds = readQuestions(runDir)
      .filter((question) => question.answeredIso === null)
      .map((question) => question.id);
  } catch {
    return [];
  }
  if (openIds.length === 0) return [];

  const ingested: IngestedAnswer[] = [];
  for (const pending of pendingAnswers(runDir, openIds)) {
    const result = handleAnswer({
      store,
      runId,
      journal,
      now,
      questionId: pending.questionId,
      answer: pending.answer,
      via: "human-file",
    });
    ingested.push({
      questionId: pending.questionId,
      clearedItemIds: result.clearedItemIds,
      resumed: result.resumed,
    });
  }
  return ingested;
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
  // ISSUE-052: the §2.11 question whose HUMAN-FILE answer authorizes this
  // deferral, when one does. Not a declared tool argument — the model surface
  // carries no way to name one, so a model-initiated deferral always arrives
  // without it and always records `derived`.
  humanQuestionId?: string;
}

export interface DeferResult {
  itemId: string;
  decisionId: string;
}

// Append a §2.7 decision record explaining the deferral, then set
// deferred:{reason,decisionId} on the item (legalTools treats a deferred item as
// settled). Journal, return.
//
// ISSUE-052: an unconditional kind:"human" stamp on this record sat one file over
// from the C-044 ruling that a tool-call decision "was not asked of a human, so
// kind is always derived" — so every model deferral fabricated a human-authority
// record, and a run that deferred the hard items closed clean with a ledger full of
// forged human judgments. The kind is DERIVED FROM THE AUTHORIZING ARTIFACT
// (core/provenance.ts): the ordinary deferral records "derived", and only a
// deferral resting on an answer that came through the file channel records "human".
//
// Deferral itself stays FREE (decision D3-partial): nothing here prices it, taints
// the item, or refuses it. What this closes is the lie, not the hatch.
//
// Both kinds are exempt from requireTwoOptions — a deferral is a judgment, not a
// scored pick, so it fabricates no options.
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

  // The citation is adjudicated BEFORE anything is written, and it fails closed: a
  // citation that does not resolve to a human-file answer is REFUSED rather than
  // quietly downgraded, so a caller that believes it is recording human authority
  // never gets a record that says something else.
  const authorizing = requireDeferAuthority(runDir, input.humanQuestionId);
  const kind = deferDecisionKind(authorizing);

  const decisionId = mintDecisionId(runDir);
  const record: DecisionRecord = {
    id: decisionId,
    tsIso: new Date(now()).toISOString(),
    question: "Defer item " + input.itemId + " out of this run?",
    options: [{ name: "defer" }],
    choice: "defer",
    why:
      authorizing === null
        ? input.reason
        : input.reason + " (authorized by the human-file answer to " + String(input.humanQuestionId) + ")",
    kind,
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
    tree: NO_TREE,
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
// The ONE way a dispatch prompt states doctrine (GAP-005).
//
// Doctrine used to live in two unguarded spellings: the anchor-tested `.md` packs
// and hand-written restatements inside the prompt literals below. Nothing guarded
// either direction, so a pack edit changed nothing a session read and a prompt
// edit changed doctrine nobody reviewed — and after §6.4 injection the two
// spellings CONFLICT in one context window, with the model weighting the tail.
//
// So a prompt never re-spells a rule: it carries the pack's own section verbatim,
// and it FAILS CLOSED (naming the pack) when the doctrine that governs the
// dispatch is absent — the same posture debugFixPrompt has always had. An
// operator repointing the doctrine directory governs what the sub-session actually
// reads, in every dispatch rather than in one.
// ---------------------------------------------------------------------------

function doctrineSlice(
  packs: Record<string, string>,
  file: string,
  headings: readonly string[],
  tool: string,
): string {
  const pack = packs[file];
  if (pack === undefined || pack.trim().length === 0) {
    throw new Error(
      tool +
        ': this dispatch is governed by doctrine "' +
        file +
        '" and the loaded pack set has none; refusing to dispatch without the doctrine that ' +
        "governs it (§6.4)",
    );
  }
  const slices: string[] = [];
  for (const heading of headings) {
    const section = packSection(pack, heading);
    if (section === null) {
      throw new Error(
        tool +
          ': doctrine "' +
          file +
          '" carries no section "' +
          heading +
          '"; the dispatch prompt composes its rules FROM that section and will not re-spell them',
      );
    }
    slices.push(section);
  }
  return slices.join("\n\n");
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
  packs: Record<string, string>;
  sessionID?: string;
  now?: () => number;
}

export interface DecomposeResult {
  itemIds: string[]; // every created item, in queue order
  runState: RunState; // DECOMPOSED on acceptance (a rejection throws instead)
}

// The queue shape the handler parses, the §3.2 rejection law taken VERBATIM from
// doctrine decompose.md (never a second spelling of it), and the numbers the law is
// parameterised by: behavioralPaths and the ponytail intensity from THIS workspace's
// config, and the per-item file cap from ITEM_MAX_FILES — the constant validateQueue's
// item-size row applies. The cap belongs to the gate, not to the workspace:
// config.workflow.trivialMaxFiles bounds what may skip planning altogether (§2.10), a
// different number with a different job, and sourcing this line from it states one cap
// to the planner while the pack's generated mechanics block and the gate state another.
export function decomposePrompt(
  userPrompt: string,
  config: Config,
  packs: Record<string, string>,
): string {
  const behavioralPaths =
    config.verify.behavioralPaths.length > 0
      ? config.verify.behavioralPaths.join(", ")
      : "(none configured)";
  return (
    "Decompose the following work request into a queue of independently implementable items. " +
    "Reply with a single JSON object matching the Queue schema (items: id, title, rationale, " +
    "fileScope, testScope, acceptance, behavioral, dependsOn, ponytail).\n" +
    "The handler REJECTS a decomposition that breaks your doctrine's own checklist (§3.2):\n\n" +
    doctrineSlice(
      packs,
      "decompose.md",
      ["Rejection checklist (self-check before you return)"],
      "conductor_decompose",
    ) +
    "\n\nAs this workspace is configured, that checklist reads:\n" +
    "- behavioralPaths (the globs that own verification): " +
    behavioralPaths +
    "\n- the per-item file cap: " +
    String(ITEM_MAX_FILES) +
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
  const edge = advanceRun(run, "DECOMPOSED", {
    classification: run.classification.kind,
    classified: run.classified === true,
  });
  if (!edge.ok) {
    throw new Error("conductor_decompose: " + edge.why);
  }

  // (2) derive: the planner proposes, the §3.2 table disposes.
  const basePrompt = decomposePrompt(run.prompt, config, input.packs);
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
    // The §3.2 table, judged against the SHAPE of the queue and against what its
    // scopes measure out to in the tree this run executes in — the entry count
    // alone says one glob is one file (ISSUE-012).
    const verdict = validateQueue(candidate, config, measureQueueScopes(store.root, candidate));
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
  packs: Record<string, string>;
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
export function readQueueJson(runDir: string, tool: string): Queue {
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
export function planPrompt(
  userPrompt: string,
  queue: Queue,
  config: Config,
  packs: Record<string, string>,
): string {
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
    'matching the Plan schema (markdown, decisions).\n"markdown" IS plan.md, and the handler ' +
    "rejects it against your doctrine's own self-check:\n\n" +
    doctrineSlice(packs, "plan.md", ["Self-check before returning"], "conductor_plan") +
    '\n\n"decisions" records every consequential fork: at least 2 real options, EACH scored on ' +
    "the five criteria (capability, testability, movingParts, validationEarliness, " +
    'singleSource), plus the choice, the why, the kind ("derived" for anything derivable; ' +
    '"human" only for taste, money, irreversible commitments or secrets) and appliedWhere. A ' +
    '"derived" fork carrying fewer than 2 scored options is rejected.\nPonytail intensity is "' +
    config.ponytail +
    '" (§6.3).\n\nQUEUE:\n' +
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
  const edge = advanceRun(run, "PLANNED", {});
  if (!edge.ok) {
    throw new Error("conductor_plan: " + edge.why);
  }
  const queue = readQueueJson(runDir, "conductor_plan");

  // (2) derive: the planner writes plan.md; the plan.md doctrine disposes.
  const basePrompt = planPrompt(run.prompt, queue, config, input.packs);
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

// One lens per reviewer, plus the severity rubric VERBATIM from doctrine
// review.md — the plan-level and item-level reviewers therefore calibrate off the
// same words the pack was reviewed and anchor-tested on.
export function lensPrompt(
  lens: ReviewLens,
  userPrompt: string,
  planMd: string,
  queue: Queue,
  packs: Record<string, string>,
): string {
  return (
    "You are a plan reviewer holding ONE lens over the whole plan and its queue. Reply with a " +
    "single JSON object matching the Findings schema (findings: id, severity, lens, claim, " +
    "evidence, suggestedFix).\n" +
    'Your lens is "' +
    lens.id +
    '": ' +
    lens.charge +
    "\n" +
    "\n" +
    doctrineSlice(
      packs,
      "review.md",
      ["An empty review is the approval"],
      "conductor_plan_review",
    ) +
    "\n\nSet `lens` to \"" +
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
export function skepticRefutePrompt(
  finding: Findings["findings"][number],
  lens: string,
  k: number,
  userPrompt: string,
  planMd: string,
  queue: Queue,
  packs: Record<string, string>,
): string {
  return (
    "You are a skeptic. Reply with a single JSON object matching the Verdict schema " +
    "(findingId, upheld, reasoning, refutationEvidence). Your doctrine governs the verdict:\n\n" +
    doctrineSlice(
      packs,
      "skeptic.md",
      ["Your verdict and how it counts", "Refutation carries evidence; abstention upholds"],
      "conductor_plan_review",
    ) +
    "\n\nSet `findingId` to exactly \"" +
    finding.id +
    '". You are one of ' +
    String(k) +
    " independent skeptics on this ONE finding. Judge exactly this finding, in isolation; " +
    "never invent a defect the reviewer did not raise. `reasoning` names the plan section you " +
    "checked and either the failing case you constructed or the reproduction you tried and " +
    "could not make fail.\n" +
    "A REFUTATION CARRIES EVIDENCE: set `refutationEvidence` to the discriminating input, what " +
    "you ran or read, and the reading under which the finding fails. `upheld:false` WITHOUT all " +
    "three is recorded as an ABSTENTION, and an abstention upholds the finding.\n\n" +
    "THE FINDING UNDER REVIEW (id " +
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
  packs: Record<string, string>,
  planMd: string,
  survivors: readonly RaisedFinding[],
  round: number,
): string {
  return (
    planPrompt(userPrompt, queue, config, packs) +
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
  packs: Record<string, string>;
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
  packs: Record<string, string>,
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
    tree: NO_TREE,
    writeCapable: false,
    prompt: lensPrompt(lens, userPrompt, planMd, queue, packs),
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
        tree: NO_TREE,
        writeCapable: false,
        prompt: skepticRefutePrompt(major.finding, major.lens, k, userPrompt, planMd, queue, packs),
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
  const edge = advanceRun(run, "PLAN_REVIEWED", { survivingMajors: 0 });
  if (!edge.ok) {
    throw new Error("conductor_plan_review: " + edge.why);
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
    const outcome = await planReviewRound(fanout, config, run.prompt, planMd, queue, input.packs);
    survivors = outcome.survivors;
    lensRoster = outcome.lenses;
    raisedCounts = {
      major: outcome.raised.filter((e) => e.finding.severity === "major").length,
      minor: outcome.raised.filter((e) => e.finding.severity === "minor").length,
      nit: outcome.raised.filter((e) => e.finding.severity === "nit").length,
    };

    // The one site that asks the FSM table DIRECTLY rather than through
    // advanceRun, and deliberately: this is a loop-exit PROBE ("would another
    // round still be owed?"), not an advance. The run is left where it is either
    // way, and the transition it probes is performed by the gate above once the
    // loop ends.
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
      planRevisionPrompt(run.prompt, queue, config, input.packs, planMd, survivors, nextRound),
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
    // One ask per surviving major (reuseOpen:false): each finding is its own
    // question, and merging two findings that happen to name the same item would
    // lose one of them. The item still carries ONE disposition — the first
    // question that names it owns the block, which the primitive enforces by
    // leaving an already-blocked item alone.
    const asked = blockItemWithQuestion({
      store,
      runId,
      runDir,
      itemIds: [...entry.itemIds],
      question: {
        runId,
        question,
        askedBy: { role: "reviewer", sessionID: entry.survivor.sessionID },
        humanTerritory: isHumanTerritory(question),
        origin: "plan-review-cap",
        blocksItems: [...entry.itemIds],
      },
      reason: "blocked on the plan-review cap: " + entry.survivor.finding.claim,
      stage: "plan-review",
      journal,
      now,
      reuseOpen: false,
    });
    questionIds.push(asked.question.id);
    for (const itemId of asked.blockedItemIds) blockedItemIds.push(itemId);
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

// The shared tree's EVIDENCE slug (§2.6): the name the per-tree verify marker
// carries when the work is not isolated in a worktree. It is not a path and no
// gate may ever be handed it — that misfeed is ISSUE-002; core/types.ts brands
// it out of every path-typed seam.
const STAGE_TREE = MAIN_TREE;

// The §3.5 tree an item's sub-sessions dispatch into, as the PATH the edit gate
// compares by string equality: the item's persisted worktree under
// parallel.writes "worktrees" (set by the wave driver at wave setup), else the
// WORKSPACE ITSELF — which is the tree those sessions really work when the item
// has no tree of its own. The shared tree's marker slug is a separate derivation
// (verifyInFlightTreeFor's, below); handing this one the slug denied every write
// the shipped default ever dispatched.
function sessionTreeOf(store: StateStore, item: Item): TreePath {
  return item.worktree ?? store.root;
}

/**
 * The C-037 ruling 5 slug->path translation. The evidence layer's tree is an
 * ITEM-ID SLUG ("main" or "<itemId>": markerPathOf runs assertSafeId, which
 * rejects "/"), while the gate's tree is a PATH compared by string equality — so
 * the wiring layer MUST translate a live marker's slug before it fills
 * GateHookInput.verifyInFlightTree, or a worktree freeze silently never fires.
 * "main" -> the workspace root; "<itemId>" -> the item's persisted worktree
 * (null when the item has no worktree — no path can be frozen for it).
 * assertSafeId is NOT relaxed: the slug stays authoritative for the marker.
 */
export function verifyInFlightTreeFor(
  store: StateStore,
  runId: string,
  markerTree: TreeSlug,
): TreePath | null {
  if (markerTree === STAGE_TREE) return store.root;
  return store.loadItem(runId, markerTree).worktree;
}

// The tree a stage handler's OWN execution belongs to, as the TWO DISTINCT TYPES the
// C-037 ruling 5 keeps apart:
//   `slug` — the evidence layer's tree name ("main" | "<itemId>"). markerPathOf runs
//            assertSafeId over it to compose verify-running-<slug>.json, so a PATH can
//            never go here;
//   `root` — the filesystem PATH a command's cwd and a file read resolve against.
// Conflating them is how a worktree freeze silently never fires, which is why they are
// derived together, once, and never re-derived at a call site.
//
// Neither half is a new derivation: whether the item has a tree of its own is the
// §2.5 worktree field, and slug->path is verifyInFlightTreeFor's. With
// item.worktree null both collapse to the shared tree's slug and the workspace
// root, which is the tree those sessions work.
interface ItemTree {
  slug: TreeSlug;
  root: TreePath;
}

function itemTreeOf(store: StateStore, runId: string, item: Item): ItemTree {
  const slug = item.worktree === null ? STAGE_TREE : treeSlug(item.id);
  return { slug, root: verifyInFlightTreeFor(store, runId, slug) ?? store.root };
}

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

/**
 * Whether the phase gate offers `tool` for this item as the run stands, and, when
 * it does not, the reason in terms the caller can act on.
 *
 * The ONE place the question is asked. requireStageTool refuses through it, and
 * conductor_inline_claim's futility refusal names its exit through it — so a
 * message that prescribes a next step can never prescribe one the gate would then
 * refuse. A second derivation of "is this tool open for this item" is the shape
 * that has drifted repeatedly in this build: the gate offering what the handler
 * rejects, or a refusal naming a door locked from the other side.
 */
function stageToolOffer(
  tool: string,
  store: StateStore,
  runId: string,
  runDir: string,
  context: { run: Run; queue: Queue; queueItem: QueueItem; item: Item },
): { offered: boolean; reason: string } {
  const { run, queue, queueItem, item } = context;
  const gateItems = gateItemsOf(store, runId, queue);
  const gateRun: GateRun = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
    classified: run.classified === true,
  };
  // A crash-torn trailing line in questions.jsonl is HEALED at the reader
  // (GAP-024): the line is skipped and the legality verdict is taken on the
  // questions that are actually there. The alternative — refusing the stage until
  // a human repairs the file by hand — wedged a run at exactly the moment §2.11
  // forbids hand-editing state to resume.
  const questions = readQuestions(runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
  // §3.9 publish availability is DERIVED from the workspace, never assumed: the
  // handlers compute the same predicate, so gate and handler cannot disagree
  // about whether an item at REVIEWED still owes a publish (C-048/C-054).
  const verdict = legalTools(gateRun, gateItems, questions, true, isRepo(store.root));
  const offered = (verdict.legal.get(tool)?.itemIds ?? []).includes(queueItem.id);
  return {
    offered,
    reason: offered ? "" : stageDenyReason(tool, verdict, { run, queueItem, item, gateItems }),
  };
}

// The legality step both stage handlers share. Loads the run, queue and item,
// asks stageToolOffer whether `tool` is offered for `itemId`, and THROWS a named
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

  const offer = stageToolOffer(tool, store, runId, runDir, { run, queue, queueItem, item });
  if (!offer.offered) throw new Error(tool + ": " + offer.reason);
  return { run, queue, queueItem, item };
}

// ---------------------------------------------------------------------------
// GAP-006: the ONE legality choke point every conductor_* call passes through.
//
// requireStageTool above answers "may THIS ITEM run this stage tool now?" for the
// six per-item tools. Nothing answered "may this tool be called at all?" for
// anything else — legalTools had two production call sites and every meta name
// routed through neither, so conductor_classify, conductor_report,
// conductor_answer, conductor_defer, conductor_decide, conductor_queue_amend,
// conductor_inline_claim and conductor_override reached their handlers with no
// legality question asked of them (ISSUE-005). This is that question, asked once,
// for every name, from the composition root's runTool.
//
// It reads the DECLARATION TABLE (core/tool-legality.ts) rather than carrying a
// rule per tool: the table says where a tool is legal and who may call it, this
// function evaluates those declarations against persisted state, and a tool with
// no row is refused outright — which is what makes the next tool impossible to
// add unguarded.
// ---------------------------------------------------------------------------

export interface ToolLegalityInput {
  tool: string;
  // Absent for the ONE tool that runs before a workspace exists (conductor_setup
  // produces the very Config a store needs to open). Its row is `always`, so the
  // rule is decided before any state is read; a row that DOES read state and
  // arrives without a store is refused rather than waved through.
  store?: StateStore;
  // "" when no live run exists. Only the `always` rows can reach the choke point
  // in that state (the composition root's no-run refusal fires first for the rest).
  runId: string;
  // The caller as the §3.5 registry holds it — never as the model supplies it.
  caller: CallerIdentity;
}

// The run's items for a `verdict` evaluation, over a queue that may not exist
// yet. An INTAKE or DECOMPOSED run legitimately has no queue.json, and "the file
// is absent" is not a legality failure here the way it is for conductor_plan —
// it simply means the run has no items for the gate to reason about.
function legalityGateItems(store: StateStore, runId: string, runDir: string): GateItem[] {
  const queuePath = path.join(runDir, "queue.json");
  if (!existsSync(queuePath)) return [];
  let queue: Queue;
  try {
    queue = readQueueJson(runDir, "conductor legality");
  } catch {
    // A torn queue.json is reported by the tool that must READ it (readQueueJson
    // names the file and the tool). The legality gate treats it as no items:
    // refusing every tool here would hide that diagnosis behind a phase message.
    return [];
  }
  return gateItemsOf(store, runId, queue);
}

/**
 * Adjudicate `tool` for this caller at this run's position, and THROW a named
 * refusal when it is not legal. Returns nothing on success: the call proceeds.
 *
 * Ordering is deliberate. The caller rule is evaluated FIRST, because "you may
 * not call this at all" and "you may not call this here" are different facts and
 * telling a dispatched implementer where the run stands invites it to wait for a
 * position that will never make the call legal for it.
 */
export function requireToolLegal(input: ToolLegalityInput): void {
  const { tool, store, runId, caller } = input;

  const row = legalityRowOf(tool);
  if (row === undefined) throw new Error(undeclaredToolWhy(tool));

  const byCaller = callerAllowed(tool, caller);
  if (!byCaller.ok) throw new Error(byCaller.why);

  // `stage` DELEGATES the phase question to the committed path the row names,
  // and `always` has none to ask. Both are decided without reading the run, so a
  // runless conductor_status never needs one.
  if (row.phase === "stage" || row.phase === "always") return;

  if (store === undefined) {
    throw new Error(
      tool +
        ": its legality depends on the run's position, and this call carries no state store to " +
        "read it from. Conductor refuses rather than assuming a position it cannot see (G5).",
    );
  }
  if (runId.length === 0) {
    throw new Error(
      tool +
        ": there is no live run for this workspace, so the run position this tool's legality " +
        "depends on does not exist. " +
        row.why +
        ".",
    );
  }

  const run = store.loadRun(runId);
  const position = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classified: run.classified === true,
  };

  if (row.phase === "non-terminal") {
    const verdict = nonTerminalAllowed(tool, position);
    if (!verdict.ok) throw new Error(verdict.why);
    return;
  }

  if (row.phase === "once-at-intake") {
    const verdict = onceAtIntakeAllowed(tool, position);
    if (!verdict.ok) throw new Error(verdict.why);
    return;
  }

  // `verdict`: the gate's own offer for this position, from the SAME derivation
  // the injection and the continuation engine read (§3.2 — one derivation, three
  // consumers), including its §3.9 publish-availability input.
  const runDir = handlerRunDir(store, runId);
  const gateRun: GateRun = {
    state: run.state,
    stop: position.stop,
    classification: { kind: run.classification.kind },
    classified: run.classified === true,
  };
  const questions = readQuestions(runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
  const offer = legalTools(
    gateRun,
    legalityGateItems(store, runId, runDir),
    questions,
    true,
    isRepo(store.root),
  );
  const verdict = verdictAllowed(tool, offer);
  if (!verdict.ok) throw new Error(verdict.why);
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

// The paths a RUN-LEVEL verify's required scopes are resolved over: the union of
// every item's, deduped. The closing verify has no subject item, so its subject is
// the whole queue — and a run touching two path families owes what §2.1 requires of
// both. Deduped because a repeated path would only make the same pattern match twice.
function runScopePaths(queue: Queue): string[] {
  const paths: string[] = [];
  for (const entry of queue.items) {
    for (const p of itemScopePaths(entry)) {
      if (!paths.includes(p)) paths.push(p);
    }
  }
  return paths;
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
// §2.6 record; the test runs in the tree the ITEM is being worked in (itemTreeOf's
// root — the item's worktree under §4.2, else the workspace), because a test run
// against a tree the implementer never edited is evidence about the wrong subject.
function runItemTest(
  input: { store: StateStore; runId: string; journal: HandlerJournal; now: () => number },
  queueItem: QueueItem,
  scope: ScopeSpec,
  runDir: string,
  treeRoot: string,
): RunTestResult {
  return runTest(runDir, queueItem.id, {
    scope,
    testFiles: [...queueItem.testScope],
    cwd: treeRoot,
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

// Whether a run's outcome is admissible as THIS item's green (GAP-008, owner
// decision D10: REFUSE). The red path has refused an untargeted run since §2.1 —
// "a collection failure elsewhere is NOT this item's red" — and the green path had
// no counterpart at all, so exactly the run the red path throws out could be ridden
// past a test that provably executed zero times: runTest's zero-test guard re-runs
// the FULL scope, and any exit 0 out of THAT was admitted as the item's GREEN.
//
// `targeted` is the complete witness. runTest sets it false in exactly the two
// fallback shapes (zero-test guard, absent §2.1 itemTest template) and true
// otherwise, so `fellBack === !targeted` always holds; the RunTestResult's own
// flags are read here only to say WHICH shape it was, in redAdmission's vocabulary.
function greenAdmission(
  outcome: RunTestResult,
  queueItem: QueueItem,
): { ok: boolean; why: string } {
  if (outcome.record.kind !== "green") {
    return { ok: false, why: "the run did not exit 0, so it is not a green" };
  }
  if (outcome.targeted) return { ok: true, why: "" };
  const reasons: string[] = [];
  if (outcome.ranZeroTests) reasons.push("the targeted run executed zero tests");
  if (outcome.fellBack) reasons.push("the run fell back to the full verify scope (no §2.1 itemTest template)");
  if (reasons.length === 0) reasons.push("the run was not targeted at this item");
  return {
    ok: false,
    why:
      "the pass is not this item's: " +
      reasons.join(", ") +
      ", so it is a suite result elsewhere impersonating a green — item " +
      queueItem.id +
      "'s own test (" +
      queueItem.testScope.join(", ") +
      ") is not shown to have run at all (§2.1, §3.3)",
  };
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

// The §2.6 IDENTITY of the item's test files as they stand in `root`: one entry per
// testScope file that EXISTS, carrying a sha256 of its bytes (GAP-007). Read as
// bytes, not text, so a re-encoding is a different file — which it is.
//
// A testScope entry with no file behind it contributes no entry: at vet time the
// critics judged only what was there, and a witness naming a file that never
// existed would refuse every later green for a reason nobody can act on.
function vettedTestDigests(root: string, queueItem: QueueItem): Array<{ path: string; sha256: string }> {
  const digests: Array<{ path: string; sha256: string }> = [];
  for (const rel of queueItem.testScope) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    digests.push({ path: rel, sha256: createHash("sha256").update(readFileSync(abs)).digest("hex") });
  }
  return digests;
}

// The FIRST vetted test file whose bytes no longer match the witness the vet
// captured, or null when every one of them still does. A file the witness names
// and the tree no longer holds counts as broken identity too — deleting the vetted
// test is the same escape as rewriting it, one byte shorter.
function brokenTestIdentity(
  root: string,
  witness: readonly { path: string; sha256: string }[],
): { path: string; vetted: string; now: string } | null {
  for (const entry of witness) {
    const abs = path.join(root, entry.path);
    if (!existsSync(abs)) return { path: entry.path, vetted: entry.sha256, now: "(absent)" };
    const now = createHash("sha256").update(readFileSync(abs)).digest("hex");
    if (now !== entry.sha256) return { path: entry.path, vetted: entry.sha256, now };
  }
  return null;
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
    "You are the TEST-WRITER for one queue item. Your doctrine pack states the law this stage " +
    "enforces; this prompt states only what the HANDLER does with your reply.\n" +
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
    "The criteria (§2.10 TEST_VET), as doctrine test-vet.md teaches them:\n\n" +
    renderVetCriteria() +
    "\n\nReply with a single JSON object matching the TestVet schema: a verdict {pass, note} for " +
    "each criterion, plus `mustFix` — the concrete changes this test MUST have before it can be " +
    "vetted." +
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

// Every testWriter dispatch in this stage: write-capable, on the item's own tree
// (its worktree under §4.2 worktree mode, else main), with the already-registered
// ImplementerResult schema (9.4a authors NO schema).
function testWriterJob(itemId: string, tree: TreePath, prompt: string): FanoutJob {
  return {
    role: "testWriter",
    itemId,
    tree,
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
  tree: TreePath,
  prompt: string,
): Promise<{ reply: ImplementerResult; sessionID: string }> {
  const result = await fanout.dispatch(testWriterJob(itemId, tree, prompt));
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
  // The tree this stage EXECUTES against — the same tree its sub-sessions are
  // dispatched into (sessionTreeOf). The writer's test lands there, so that is where
  // the test must be run from and read back.
  const tree = itemTreeOf(store, runId, stage.item);
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
    const reason =
      "test-writer could not produce a legal §2.6.1 red for the PENDING->RED stage: " +
      why +
      " (repairs spent " +
      String(repairs) +
      " of workflow.testRepairAttempts=" +
      String(maxRepairs) +
      ")";
    const asked = blockItemWithQuestion({
      store,
      runId,
      runDir,
      itemIds: [itemId],
      question: {
        runId,
        question: questionText,
        askedBy: { role: "testWriter", sessionID: writerSessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      reason,
      stage: "RED",
      journal,
      now,
      journalData: { testRepairs: repairs },
    });
    const question = asked.question;
    const blocked = asked.items[0] ?? store.loadItem(runId, itemId);
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
    const writer = await dispatchTestWriter(SUBMIT_TEST_TOOL, fanout, itemId, sessionTreeOf(store, stage.item), prompt);
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
    const outcome = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir, tree.root);
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
      testScopeContent(tree.root, queueItem),
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
//
// Recency is the ledger's own APPEND ORDER, never the seq value (GAP-035). `seq` is
// minted by reading the ledger and adding one, so two writers that read it in the
// same instant mint the same number; comparing seq values would then read a later
// run as "the same run" and hand the critics a red the test on disk no longer
// produces. Position cannot collide. For the same reason a line that does not parse
// forces `stale`: a record we could not read is never evidence that nothing newer
// ran — it is skipped for CHOOSING the red (a torn crash artifact must not wedge the
// vet) and counted for JUDGING recency.
export function capturedRedOf(
  runDir: string,
  item: Item,
  itemId: string,
): { red: RedEvidence; stale: boolean; resolvedByFallback: boolean } {
  const ledger = path.join(runDir, "evidence.jsonl");
  const reds: Array<{ record: RedEvidence; position: number }> = [];
  let latestPosition = -1;
  let unreadableLine = false;
  if (existsSync(ledger)) {
    let raw = readFileSync(ledger, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    let position = -1;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      position += 1;
      let parsed: EvidenceRecord;
      try {
        parsed = JSON.parse(trimmed) as EvidenceRecord;
      } catch {
        unreadableLine = true; // skipped for the choice, counted for the recency judgment
        continue;
      }
      if (parsed.itemId !== itemId) continue;
      // Every run for this item counts toward "what ran last", red or green.
      latestPosition = position;
      // Only a §2.6.1-LEGAL red is a red. A class-"error" record is one the submit
      // side refuses outright ("that is not a red"), so handing it to the critics as
      // THE CAPTURED RED would vet a test against its own brokenness.
      if (parsed.kind === "red" && (parsed.failureClass === "assertion" || parsed.failureClass === "missing-subject")) {
        reds.push({ record: parsed, position });
      }
    }
  }
  const pointer = item.evidence.red;
  let resolvedByFallback = true;
  let chosen: { record: RedEvidence; position: number } | undefined;
  if (pointer !== undefined) {
    // The LAST record carrying the pointed-at seq: if two writers minted the same
    // number, the newer of them is the one the pointer was written for.
    for (const entry of reds) {
      if (entry.record.seq === pointer.seq) chosen = entry;
    }
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
  return {
    red: chosen.record,
    stale: unreadableLine || chosen.position !== latestPosition,
    resolvedByFallback,
  };
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
  // The tree this stage EXECUTES against: the critics judge the test text AS IT STANDS
  // in the item's own tree, and a repair re-run must exercise the file the writer just
  // edited there.
  const tree = itemTreeOf(store, runId, stage.item);
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
  let testText = testScopeContent(tree.root, queueItem);
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
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "TEST_VETTED", itemId, round: rounds, reason: detail },
      { runId, itemId },
    );
    const asked = blockItemWithQuestion({
      store,
      runId,
      runDir,
      itemIds: [itemId],
      question: {
        runId,
        question: questionText,
        askedBy: { role: "testWriter", sessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      reason: "the test vet could not proceed: " + detail,
      stage: "TEST_VETTED",
      journal,
      now,
      journalData: { vetRounds: rounds },
    });
    const question = asked.question;
    const blocked = asked.items[0] ?? store.loadItem(runId, itemId);
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
    const outcome = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir, tree.root);
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
    testText = testScopeContent(tree.root, queueItem);
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
        tree: sessionTreeOf(store, stage.item),
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
      // ISSUE-013: the criteria BITE. A receipt that fails a criterion and names
      // no repair is self-contradictory, and advancing on its empty mustFix
      // resolved that against the critic's own written verdict. The failure it
      // wrote down becomes the repair it did not spell, naming the criterion.
      for (const entry of [...vet.mustFix, ...impliedMustFix(vet)]) {
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
      // GAP-007: WHICH test the critics approved, not just that they approved one.
      // Captured from the tree they read (`testText` above came from the same place),
      // at the instant the approval is persisted, so `mark_green` can prove the file
      // it re-runs is the file that was vetted.
      item.vettedTests = vettedTestDigests(tree.root, queueItem);
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
      const asked = blockItemWithQuestion({
        store,
        runId,
        runDir,
        itemIds: [itemId],
        question: {
          runId,
          question: questionText,
          askedBy: { role: "reviewer", sessionID: askedBySessionID },
          humanTerritory: isHumanTerritory(questionText),
          origin: "review-round-cap",
          blocksItems: [itemId],
        },
        reason:
          "test vet reached vetMaxRounds=" +
          String(max) +
          " with mustFix still outstanding: " +
          union.join("; "),
        stage: "TEST_VETTED",
        journal,
        now,
        journalData: { vetRounds: rounds },
      });
      const question = asked.question;
      const blocked = asked.items[0] ?? store.loadItem(runId, itemId);

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
      sessionTreeOf(store, stage.item),
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

    const outcome = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir, tree.root);
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
    testText = testScopeContent(tree.root, queueItem);
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
function implementerJob(itemId: string, tree: TreePath, prompt: string): FanoutJob {
  return {
    role: "implementer",
    itemId,
    tree,
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
  tree: TreePath,
  prompt: string,
): Promise<{ reply: ImplementerResult; sessionID: string }> {
  const result = await fanout.dispatch(implementerJob(itemId, tree, prompt));
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
// ===========================================================================
// (10) Shared terminal-path helpers (Task 9.5b). Each exists because the SAME
// operation is performed from more than one place, and this build has watched a
// rule that lives in two places drift four separate times.
// ===========================================================================

/**
 * The REVIEWED->GREEN drop (C-037 ruling 7). An item whose closing verify goes
 * red after its review is returned to GREEN with the §3.3 DEBUG annotation set,
 * so the debug protocol can take it.
 *
 * Deliberately NOT routed through legalItemTransition, and deliberately journaled
 * as `state: item.updated` rather than `fsm: transition`: core/fsm-item.ts has no
 * backward REVIEWED->GREEN edge, and it should not grow one. This is an
 * ADMINISTRATIVE write — the run correcting its own bookkeeping after evidence
 * changed — not a claim that the FSM permits the edge. Calling it a transition
 * would either force a bogus edge into the table or make the journal lie.
 *
 * Shared with Task 9.6, whose merge-conflict path performs the identical drop.
 */
export function demoteReviewedToGreen(input: {
  store: StateStore;
  runId: string;
  itemId: string;
  journal: HandlerJournal;
  reason: string;
  hypothesis: string;
  now?: () => number;
}): Item {
  const { store, runId, itemId, journal } = input;
  const now = input.now ?? Date.now;

  const item = store.loadItem(runId, itemId);
  item.state = "GREEN";
  item.debugging = { sinceMs: now(), hypothesis: input.hypothesis };
  store.saveItem(runId, item);

  journal.log(
    "warn",
    "state",
    "item.updated",
    { itemId, state: "GREEN", from: "REVIEWED", reason: input.reason, debugging: true },
    { runId, itemId },
  );
  return item;
}

/**
 * The §2.11 stale-red registration every terminal path owes (C-037 ruling 4).
 * ONE helper, called by conductor_report and by 9.5c's stop-report, so a run that
 * ends with a red test on disk discloses it exactly once and in one shape.
 *
 * Registers the testScope files of every item BELOW GREEN — those are the tests
 * that may still be red — but only those that EXIST on disk. A declared-but-never-
 * written test poisons nothing and would make the registry name a file no reader
 * can open. Paths already in the workspace registry are not re-added and not
 * re-reported, so a second terminal path in the same workspace is idempotent.
 *
 * Returns the paths it ADDED, so the caller's report can list exactly what this
 * run disclosed rather than the whole accumulated registry.
 */
export function registerStaleRed(input: {
  store: StateStore;
  runId: string;
  queue: Queue;
  reason: string;
  now?: () => number;
}): string[] {
  const { store, runId, queue } = input;
  const now = input.now ?? Date.now;
  const belowGreen = ITEM_STATES.indexOf("GREEN");

  const known = new Set(store.readStaleRed().entries.map((entry) => normalizeRepoRel(entry.path)));
  const added: string[] = [];

  for (const entry of queue.items) {
    let state: ItemState;
    try {
      state = store.loadItem(runId, entry.id).state;
    } catch {
      state = "PENDING";
    }
    if (ITEM_STATES.indexOf(state) >= belowGreen) continue;

    for (const raw of entry.testScope) {
      const file = normalizeRepoRel(raw);
      if (known.has(file)) continue;
      if (!existsSync(path.join(store.root, file))) continue;
      store.addStaleRed({ path: file, itemId: entry.id, runId, sinceMs: now(), reason: input.reason });
      known.add(file);
      added.push(file);
    }
  }
  return added;
}

export function foreignRedSet(
  store: StateStore,
  runId: string,
  queue: Queue,
  // The subject whose OWN tests must never be quarantined. NULL when there is no
  // subject: conductor_report's closing verify judges the WHOLE run, so no item's
  // tests are privileged and every below-GREEN test in the queue is foreign to it.
  itemId: string | null,
  // The tree this set will be quarantined OUT OF — the same cwd the verify runs in.
  // The existence probe below must ask THAT tree and no other: under §4.2 worktree mode
  // a sibling's test can exist in the worktree and not in the workspace (and the
  // reverse), so probing the workspace either leaves a foreign red loose inside the
  // verified tree or hands quarantineFiles a path that ENOENTs out of renameSync.
  // Defaults to the workspace, which is what every non-worktree caller means.
  treeRoot: string = store.root,
): string[] {
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
    if (!existsSync(path.join(treeRoot, file))) return;
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
  // The tree this stage EXECUTES against — the same one the implementer below is
  // dispatched into. Running the item test anywhere else would let a tree nobody
  // edited hand the item its GREEN.
  const tree = itemTreeOf(store, runId, stage.item);

  // Implementer sub-sessions SPENT by this call (0 until one is dispatched, which
  // the exhaustion refusal below returns before doing).
  let attempts = 0;

  // The one stuck exit: block the item, mint the §2.11 question that offers the
  // human the unblock path, and journal it. Takes the asking session explicitly
  // because it is reached both AFTER an implementer ran (the sub-session asks) and
  // BEFORE one is dispatched (the budget refusal, where no sub-session exists).
  const blockWithQuestion = (
    why: string,
    askedBySessionID: string,
    over: Partial<Pick<MarkGreenResult, "ranItemTest" | "exitCode" | "excluded">> = {},
  ): MarkGreenResult => {
    const questionText =
      MARK_GREEN_TOOL +
      ' could not take item "' +
      itemId +
      '" to GREEN — ' +
      why +
      "\nSay how the implementation should proceed, or whether the item should be reshaped.";
    const asked = blockItemWithQuestion({
      store,
      runId,
      runDir,
      itemIds: [itemId],
      question: {
        runId,
        question: questionText,
        askedBy: { role: "implementer", sessionID: askedBySessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      reason: "the implementer could not take the item to GREEN: " + why,
      stage: "GREEN",
      journal,
      now,
    });
    const question = asked.question;
    const blocked = asked.items[0] ?? store.loadItem(runId, itemId);
    return {
      ok: false,
      itemState: blocked.state,
      ranItemTest: false,
      exitCode: null,
      attempts,
      excluded: [],
      questionId: question.id,
      ...over,
    };
  };

  // (1b) THE ATTEMPT BUDGET (§3.3's ladder has to end somewhere). This stage spends
  //      exactly one implementer per call and the ORCHESTRATOR decides how often to
  //      call it, so an item the model cannot finish was an unbounded loop: every
  //      failed attempt returned "not yet", nothing counted, and nothing ever said
  //      stop. The count is persisted BEFORE the dispatch, so a sub-session that
  //      crashes the handler still costs an attempt — a budget that only counts
  //      tidy failures bounds nothing.
  const attemptBudget = implementerAttemptBudget(config);
  const beforeDispatch = store.loadItem(runId, itemId);
  if (beforeDispatch.attempts.green >= attemptBudget) {
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "GREEN", itemId, attemptsSpent: beforeDispatch.attempts.green, attemptBudget },
      { runId, itemId },
    );
    return blockWithQuestion(
      "the implementer attempt budget is EXHAUSTED: " +
        String(beforeDispatch.attempts.green) +
        " of workflow.implementerAttempts=" +
        String(attemptBudget) +
        " attempts were spent and the item never reached GREEN. Re-shape the item, answer what " +
        "the implementer is missing, or raise the budget — a further attempt is refused rather " +
        "than spent (§3.3)",
      // No sub-session asked this one: the handler refused before dispatching, which
      // is the whole point of the budget.
      "",
    );
  }
  beforeDispatch.attempts.green += 1;
  store.saveItem(runId, beforeDispatch);

  // (2) derive. The implementer runs for BOTH kinds of item: a non-behavioral item
  //     still needs its production change written, it just owes no test.
  const writer = await dispatchImplementer(
    MARK_GREEN_TOOL,
    fanout,
    itemId,
    sessionTreeOf(store, stage.item),
    implementerPrompt(queueItem),
  );
  attempts = 1;

  const stuck = (
    why: string,
    over: Partial<Pick<MarkGreenResult, "ranItemTest" | "exitCode" | "excluded">> = {},
  ): MarkGreenResult => blockWithQuestion(why, writer.sessionID, over);

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
    // `attempts.green` counts the implementer sub-sessions this item has SPENT and
    // is incremented at the dispatch above, not here: a counter that only moved on
    // the way out counted successes, and a budget cannot be built on those.
    item.state = "GREEN";
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

  // (3a1) GAP-007: the test this stage is about to re-run must BE the test the vet
  //       critics approved. An item may legally declare a testScope file inside its
  //       own fileScope, and the implementer sub-session that just ran was write-
  //       capable there, so "the critics approved a test" and "this run exercised
  //       that test" are two different facts — and only this one is checked here.
  //       The witness is read from the PERSISTED item (the vet wrote it; nothing a
  //       sub-session can reach rewrites it), and an item that never passed through
  //       the vet carries none, which is not a mismatch to report.
  const vetted = store.loadItem(runId, itemId).vettedTests;
  if (vetted !== undefined && vetted.length > 0) {
    const broken = brokenTestIdentity(tree.root, vetted);
    if (broken !== null) {
      return stuck(
        "the vetted test no longer has the identity the critics approved: " +
          broken.path +
          " was sha256 " +
          broken.vetted.slice(0, 12) +
          " when RED->TEST_VETTED was persisted and is " +
          (broken.now === "(absent)" ? "ABSENT from the tree now" : "sha256 " + broken.now.slice(0, 12) + " now") +
          ". A green earned by re-running a test the vet never saw is not this item's GREEN " +
          "(§2.6/§3.3); re-vet the test that is there, or restore the one that was.",
      );
    }
  }

  // (3b) a behavioral item: THE HANDLER runs the test, under the §4.2 foreign red
  //      set so a sibling's deliberate red cannot fail this item's run (the
  //      no-template fallback needs it exactly as much as the verify does).
  const excluded = foreignRedSet(store, runId, stage.queue, itemId, tree.root);
  const scope = itemVerifyScope(config, queueItem, MARK_GREEN_TOOL);
  const outcome = runTest(runDir, itemId, {
    scope,
    testFiles: [...queueItem.testScope],
    cwd: tree.root,
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

  // GAP-008: green-admission symmetry. A green the red path would have thrown out
  // is refused here rather than persisted as the item's GREEN. Refused, not
  // re-attempted: no edit the implementer can make to production code turns a
  // full-scope fallback into a targeted run — that takes a §2.1 itemTest template
  // (or a test the runner can actually collect), which is a config/queue answer,
  // so the stage stops with the one unblock path the other stuck exits use.
  const admission = greenAdmission(outcome, queueItem);
  if (record.kind === "green" && !admission.ok) {
    return stuck(admission.why, { ranItemTest: true, exitCode: record.exitCode, excluded });
  }

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
  // The tree this stage EXECUTES against: `root` is the verify's cwd (and the tree the
  // §4.2 quarantine moves the foreign red set out of), `slug` is the per-tree marker key
  // whose freeze denies every edit in that tree while the verify is in flight. Verifying
  // the workspace while the change lives in the item's worktree would judge a tree the
  // change never reached, and marking "main" would freeze a tree nobody is editing.
  const tree = itemTreeOf(store, runId, stage.item);
  const excluded = foreignRedSet(store, runId, stage.queue, itemId, tree.root);
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
      cwd: tree.root,
      excludeTestFiles: excluded,
      journal: evidenceJournalOf(journal),
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      runId,
      tree: tree.slug,
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
      const asked = blockItemWithQuestion({
        store,
        runId,
        runDir,
        itemIds: [itemId],
        question: {
          runId,
          question: questionText,
          askedBy: { role: "implementer", sessionID: fixerSessionID },
          humanTerritory: isHumanTerritory(questionText),
          origin: "debug-architecture",
          blocksItems: [itemId],
        },
        reason:
          "the full verify stayed red through workflow.debugFixCap=" +
          String(cap) +
          " fix attempts: " +
          failure,
        stage: "VALIDATED",
        journal,
        now,
        journalData: { debugFixes },
      });
      const question = asked.question;
      const blocked = asked.items[0] ?? store.loadItem(runId, itemId);
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
      sessionTreeOf(store, stage.item),
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
  // The §3.4 tool's own argument. The run's current queue supplies everything the
  // ops do not mention, so an amendment cannot drop an item by omission.
  ops: QueueAmendOp[];
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
  added: string[];
  updated: string[];
  removed: string[];
}

/**
 * conductor_queue_amend (§2.4/§2.7). Applies the §3.4 ops to the queue the run is
 * executing, re-runs core validateQueue over the RESULT and refuses any violation,
 * and gates its §2.7 record through the same core requireTwoOptions every other
 * decision site runs. Every refusal precedes every write, so a rejected amendment
 * leaves queue.json byte-identical.
 *
 * It also reconciles §2.5: an added id gets a runtime item at the head of the FSM
 * (without one, the next handler to load it throws), a removed id loses its item
 * file (without that, re-adding the id later resurrects the dropped item's state),
 * and an updated id is released from `blocked` — which §2.5 names this tool as a
 * legal clearer of.
 *
 * Synchronous: it dispatches nothing.
 */
export function handleQueueAmend(input: QueueAmendInput): QueueAmendResult {
  const { store, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality, in every half, BEFORE anything is persisted.
  //
  // (1a) the ops against the queue the run is ACTUALLY executing. Re-reading
  // queue.json rather than trusting a caller-supplied queue is the point of the
  // §3.4 shape: the amendment states the change, the run states the rest.
  const current = readJsonFileSync(path.join(runDir, "queue.json")) as Queue;
  const states: Record<string, ItemState | undefined> = {};
  for (const entry of current.items) {
    states[entry.id] = store.loadItem(runId, entry.id).state;
  }
  const applied = applyAmendOps(current, input.ops, states);
  if (!applied.ok) {
    throw new Error(QUEUE_AMEND_TOOL + ": " + applied.why + " — nothing was written");
  }

  // (1b) the RESULT against §2.4, through the same pure function 9.2 planning uses.
  const verdict = validateQueue(applied.queue, config, measureQueueScopes(store.root, applied.queue));
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

  // (2) persist. The order is chosen so that the only state a crash can leave behind
  // is a runtime item no queue entry names — an orphan nothing reads, which the next
  // amendment overwrites. The opposite order would leave queue.json naming an item
  // whose file is absent, and every later loadItem would throw on it.
  for (const itemId of applied.added) {
    store.saveItem(runId, newPendingItem(itemId));
    journal.log("info", "state", "item.updated", { itemId, state: "PENDING", origin: "queue-amend" }, { runId, itemId });
  }
  writeFileAtomicSync(path.join(runDir, "queue.json"), JSON.stringify(applied.queue, null, 2));
  for (const itemId of applied.removed) {
    store.removeItem(runId, itemId);
  }
  // §2.5: conductor_queue_amend is a legal clearer of `blocked`. An update rewrites
  // the entry the block was raised against, so the item is released — and only that:
  // the FSM position and the item's history are the amendment's to keep, not reset.
  // Core holds that honest by refusing an update that re-scopes an item past
  // PENDING, whose kept evidence would then describe a scope the item does not own;
  // a re-scope arrives here as remove-then-add, which reborns the item PENDING.
  for (const itemId of applied.updated) {
    if (store.loadItem(runId, itemId).blocked !== null) store.clearBlocked(runId, itemId);
  }
  appendDecision(runDir, decision);

  const itemIds = applied.queue.items.map((entry) => entry.id);
  journal.log(
    "info",
    "state",
    "decision.recorded",
    {
      decisionId: decision.id,
      kind: decision.kind,
      choice: decision.choice,
      items: itemIds.length,
      added: applied.added.length,
      updated: applied.updated.length,
      removed: applied.removed.length,
    },
    { runId },
  );

  return {
    ok: true,
    decisionId: decision.id,
    itemIds,
    added: applied.added,
    updated: applied.updated,
    removed: applied.removed,
  };
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
  notifyClear: (tree: TreePath) => void;
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

// A REVOCABLE view of the StateStore, handed to ONE stage execution (C-054).
//
// The driver bounds a HELD write-capable job (P8: env-failed, never awaited
// forever), but a JavaScript promise cannot be cancelled: when the budget
// expires the stage is still running, and a sibling's notifyClear — or the next
// dispatch_wave call — can release its held job later. Without this fence that
// stage walks on and advances the item's PERSISTED state after the compact
// return already said the member stopped, so the return and the store disagree
// with no record of why, and a second wave can schedule an item something else
// is still writing.
//
// So the driver revokes the stage's access to the run's facts at the moment it
// abandons it. The stage keeps running — that much is unavoidable — but its next
// store call throws instead of writing: the late write is REFUSED, the refusal
// NAMES the abandonment, and the stage dies there rather than drifting on. The
// fence is per-execution, so revoking one member's view never touches another's.
interface FencedStore {
  store: StateStore;
  abandon: (why: string) => void;
}

function fenceStore(store: StateStore): FencedStore {
  let refusal: string | null = null;
  const fenced = new Proxy(store, {
    get(target: StateStore, prop: string | symbol): unknown {
      const value = Reflect.get(target, prop);
      // Data members (store.root) pass through; every OPERATION goes through the
      // fence, reads included — an abandoned stage has no business reading the
      // facts either, and stopping it at its first touch is what makes the
      // refusal prompt rather than "at whichever call happens to write".
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        if (refusal !== null) throw new Error(refusal);
        return (value as (this: StateStore, ...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return {
    store: fenced,
    abandon: (why: string): void => {
      refusal = why;
    },
  };
}

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
    // C-050. These two stages had no handler when the driver shipped, and the
    // driver's honest-stop covered for their absence. 9.5a and 9.5b built them;
    // without the entries below, a run driven entirely through
    // conductor_dispatch_wave could not advance any item past VALIDATED — which
    // defeats §4.2, whose whole purpose is that the model does not interleave
    // items by hand.
    [ITEM_REVIEW_TOOL]: async (ctx): Promise<StageOutcome> => {
      const result = await handleItemReview({
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
    // conductor_publish is already in SERIAL_STAGES — the git index is a
    // singleton (§4.3) — so the driver runs this one strictly alone, in §4.2
    // wave order, exactly as it does submit_test and mark_green.
    [PUBLISH_TOOL]: async (ctx): Promise<StageOutcome> => {
      const result = await handlePublish({
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
  };
}

// The gate's verdict over the run's CURRENT persisted facts. Every legality
// question the driver asks — its own offer, and each member's next stage — is
// answered from this ONE derivation, so the driver and the stage handlers can
// never disagree about what may run (§3.2).
export function waveVerdict(store: StateStore, runId: string, runDir: string, queue: Queue): LegalToolsResult {
  const run = store.loadRun(runId);
  const gateRun: GateRun = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
    classified: run.classified === true,
  };
  const questions = readQuestions(runDir).map((q) => ({ id: q.id, answeredIso: q.answeredIso }));
  return legalTools(gateRun, gateItemsOf(store, runId, queue), questions, true, isRepo(store.root));
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
    const edge = advanceRun(run, "EXECUTING", context);
    if (!edge.ok) {
      throw new Error(DISPATCH_WAVE_TOOL + ": " + edge.why);
    }
    const from = edge.from;
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

  // (3b) §4.2 worktree mode: ONE worktree per wave member, created at wave SETUP —
  //      before any stage dispatch — so every member's sub-sessions are born bound
  //      to their own tree. item.worktree is the committed §2.5 field; setting it
  //      IS an item update, so the lifecycle rides the existing `state:
  //      item.updated` event with the path in the record (G6 — journal-events.ts
  //      is not widened). Under the default "off" this block runs no git command
  //      at all and item.worktree stays null.
  if (config.parallel.writes === "worktrees") {
    for (const member of members) {
      const item = store.loadItem(runId, member.itemId);
      if (item.worktree !== null && existsSync(item.worktree)) continue; // an earlier call's tree stands
      const worktree = createWorktree(store.root, runId, member.itemId, {
        stateHome: input.stateHome,
        workspaceKey: input.workspaceKey,
      });
      item.worktree = treePath(worktree);
      store.saveItem(runId, item);
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId: member.itemId, worktree },
        { runId, itemId: member.itemId },
      );
    }
  }

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
    // that merely takes a long time. The tree is the MEMBER's own — its worktree
    // under §4.2 worktree mode, else main — so a worktree implementer is never
    // held by another tree's validate.
    const memberTree = sessionTreeOf(store, store.loadItem(runId, member.itemId));
    const frozen = SERIAL_STAGES.includes(tool) && treeState.isFrozen(memberTree);
    if (frozen) {
      member.anomaly =
        'tree "' +
        memberTree +
        '" was frozen by a live verify marker when ' +
        tool +
        " dispatched, so the fan-out engine HELD this member's write-capable job until the " +
        "marker cleared (§3.5)";
    }

    // The stage runs against a REVOCABLE view of the store (C-054), so a stage
    // this driver has to abandon on the held-job budget below cannot write the
    // run's facts behind the driver's back.
    const fence = fenceStore(store);
    const settle: Promise<StageSettlement> = executor({
      tool,
      store: fence.store,
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
      // ABANDONMENT (C-054). The budget expired with the stage STILL RUNNING, and
      // nothing here can cancel it: a released hold — a sibling's notifyClear, or
      // the next dispatch_wave call — would let it walk on and advance the item
      // long after this return said the member stopped. Revoking its store view
      // is what makes the stop TRUE: from here the stage may read and write
      // nothing of the run's, so the compact return below stays the last word on
      // this item and the next wave may schedule it without racing a writer.
      fence.abandon(
        DISPATCH_WAVE_TOOL +
          ": the " +
          tool +
          ' stage for item "' +
          member.itemId +
          '" was ABANDONED when its held-job budget (parallel.subSessionTimeoutMs=' +
          String(heldBudgetMs) +
          "ms) expired; the wave stopped waiting on it and reported it stopped, so this " +
          "abandoned stage may no longer read or write the run's state (C-054)",
      );
      member.anomaly =
        (member.anomaly === null ? "" : member.anomaly + "; ") +
        "the budget expired with the stage still running, so the driver ABANDONED it: it was " +
        "fenced out of the run's state rather than left able to write after this wave reported " +
        "the member stopped";
      stop(
        member,
        tool,
        "the write-capable sub-session for " +
          tool +
          ' was HELD out of tree "' +
          memberTree +
          '": its verify marker never cleared within parallel.subSessionTimeoutMs=' +
          String(heldBudgetMs) +
          "ms, so the member is env-failed rather than awaited forever (§3.5)",
      );
      return;
    }

    // The stage ran, so whatever it did to the tree is done: notify the §3.5
    // view, which is what releases any write-capable job the engine is holding
    // on a marker this stage broke or a verify this stage finished (P6).
    treeState.notifyClear(memberTree);

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

// ===========================================================================
// (10) conductor_item_review — §3.3 VALIDATED->REVIEWED (Task 9.5a, plan lines
// 2652-2665; §3.3 lines 1232-1271). Same §3.4 invariant loop as every stage
// handler: legality -> derive -> persist -> journal -> compact return. Each
// round, in order:
//
//   LENSES. sessions = clamp(readFanout("itemReview"), 3, 6) fresh reviewer
//   sub-sessions (a trivial-classified run always uses the three-session
//   composition), each holding one merged lens group over the item's diff +
//   spec + test. The FIVE mandatory lenses are never truncated by
//   configuration: below six sessions they MERGE pairwise from the tail of the
//   priority list, so even three sessions cover all five. The rosterSizingRule
//   (the E14 resolution): floor at a coverage SET the spec names, clamp where
//   the spec names only a COUNT — parallel.maxReaders is a wall-clock ceiling
//   the fan-out engine enforces internally, NEVER a coverage truncation. A
//   pre-clamp fan-out below three journals a warn-level record on the existing
//   fanout/subsession.dispatched event naming the configured and clamped
//   values (no §7.4 vocabulary widening).
//
//   SKEPTICS. EVERY finding — regardless of severity, deliberately unlike
//   handlePlanReview's majors-only rule: plan review answers one binary
//   question, while item review's output is ROUTED FIXES, and a fix demand
//   nobody adjudicated is not dispatchable — gets readFanout("skeptics")
//   refuters, and survival is decided by core findingSurvives (⌈k/2⌉,
//   TIE-UPHOLDS), never re-derived. An under-delivered panel is re-dispatched
//   ONCE for its missing seats; a verdict still missing after that counts as
//   an UPHOLD — conservative, so a real finding is never dropped because a
//   skeptic session crashed (the Phase 1 deferred binding).
//
//   ADJUDICATION ORDERING. A surviving spec/contract finding discards the
//   round's QUALITY-lens findings (test-adequacy, minimality, perf — doctrine
//   review.md's tiering): judging not-yet-spec-compliant code is wasted
//   judgment, so they are re-derived by the next round's fresh fan-out.
//   Correctness and guardrail are tier-1 — retained and fixed alongside the
//   spec findings.
//
//   ROUTING BY PATH (§3.3 table). A fix touching only fileScope dispatches an
//   implementer; a test-adequacy finding — and any finding whose suggestedFix
//   names a testScope path — dispatches a TEST-WRITER and never the
//   implementer (who is gated to fileScope: routing it there is a guaranteed
//   edit-gate denial); a fix touching both runs the testWriter FIRST, then the
//   implementer, sequentially. A changed test RE-ENTERS the test discipline:
//   re-run through evidence.runTest, the reverted-behavior probe where cheap,
//   then a re-vet with readFanout("vet") fresh critics — all BEFORE
//   re-validate. Every fix dispatch carries the receivingReview registry
//   signal, so buildSystemAppend delivers doctrine receive-review.md to it
//   (the Phase 8 / C-028 deferred binding: loaded is not delivered).
//
//   PUSHBACK. A fix receipt of DONE_WITH_CONCERNS whose concerns name a routed
//   finding id is adjudicated by exactly ONE extra skeptic round carrying the
//   fixer's reasoning verbatim: refuted, the finding dies with no further
//   demand; upheld, the fix is re-demanded once and the loop stops there —
//   pushback is never accepted silently and never loops.
//
//   BOUND. fix => re-validate (evidence.runVerify over the §4.2 foreign-red
//   set) => re-review, bounded by workflow.reviewMaxRounds. At the cap ONE
//   §2.11 question (existing origin "review-round-cap") carries the surviving
//   finding list, the item is blocked via store.setBlocked and STAYS at
//   VALIDATED. A round with zero survivors advances through core
//   legalItemTransition — never a direct state write.
// ===========================================================================

const ITEM_REVIEW_TOOL = "conductor_item_review";

// §3.3 lens vocabulary. The first five are MANDATORY; itemReviewers >= 6 adds perf.
const LENS_SPEC = "spec/contract";
const LENS_CORRECTNESS = "correctness";
const LENS_GUARDRAIL = "guardrail";
const LENS_TEST_ADEQUACY = "test-adequacy";
const LENS_MINIMALITY = "minimality";
const LENS_PERF = "perf";

// The lenses a surviving spec/contract finding discards for its round (doctrine
// review.md's tiering: requirement/behaviour findings stand, style/structure/polish
// findings are re-derived over the fixed tree).
const ITEM_QUALITY_LENSES: readonly string[] = [LENS_TEST_ADEQUACY, LENS_MINIMALITY, LENS_PERF];

// The §3.3 merged compositions, keyed by session count: at 6 each lens is its own
// session; below 6, lenses merge pairwise from the tail of the priority list; 3 is
// the trivial-run composition. Merging never drops a mandatory lens.
const ITEM_REVIEW_COMPOSITIONS: Record<number, readonly (readonly string[])[]> = {
  6: [[LENS_SPEC], [LENS_CORRECTNESS], [LENS_GUARDRAIL], [LENS_TEST_ADEQUACY], [LENS_MINIMALITY], [LENS_PERF]],
  5: [[LENS_SPEC], [LENS_CORRECTNESS], [LENS_GUARDRAIL], [LENS_TEST_ADEQUACY], [LENS_MINIMALITY, LENS_PERF]],
  4: [[LENS_SPEC, LENS_TEST_ADEQUACY], [LENS_CORRECTNESS], [LENS_GUARDRAIL], [LENS_MINIMALITY, LENS_PERF]],
  3: [[LENS_SPEC, LENS_CORRECTNESS], [LENS_GUARDRAIL, LENS_MINIMALITY], [LENS_TEST_ADEQUACY, LENS_PERF]],
};

// One charge per lens id — what that instrument judges (§3.3).
const ITEM_LENS_CHARGES: Record<string, string> = {
  [LENS_SPEC]:
    "spec compliance — missing requirements, unrequested extras — plus API/contract soundness",
  [LENS_CORRECTNESS]:
    "whether the change actually behaves correctly on its inputs, edge cases included",
  [LENS_GUARDRAIL]:
    "security, trust-boundary validation and data-loss — the ponytail never-lazy list",
  [LENS_TEST_ADEQUACY]:
    "whether the test still honestly pins the change now that the implementation exists",
  [LENS_MINIMALITY]:
    "minimality/simplification — unrequested abstractions, and code something existing would serve",
  [LENS_PERF]:
    "performance — asymptotic or hot-path cost the change carries without need",
};

// One git invocation, argv-array discipline (the gitio.ts shape). Repo-location env
// overrides are stripped so an inherited GIT_DIR can never redirect the probe away
// from the run's own tree. A non-zero exit is a RESULT here, not an error: the §3.3
// probe's cheapness rule reads it as "skip".
// GAP-012's measuring instrument: the tree's per-file change signature over the
// item's declared paths — each tracked file's own diff body, plus the content of
// each untracked file the scope matches. Two of these, taken around a fix
// dispatch, name exactly the files that dispatch changed. A name-only listing
// would not: the item is ALREADY changing its fileScope, so a file's presence in
// the diff says nothing about whether this dispatch touched it.
function treeTouchSignature(root: string, queueItem: QueueItem): Map<string, string> {
  const signature = new Map<string, string>();
  const paths = itemScopePaths(queueItem);
  if (paths.length === 0) return signature;
  const diff = runReviewGit(root, ["diff", "--", ...paths]).stdout;
  for (const part of diff.split(/^diff --git /m)) {
    if (part.trim().length === 0) continue;
    const newline = part.indexOf("\n");
    const header = newline < 0 ? part : part.slice(0, newline);
    const match = /b\/(.+)$/.exec(header.trim());
    signature.set(match === null ? header.trim() : match[1].trim(), part);
  }
  const others = runReviewGit(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths]).stdout;
  for (const line of others.split("\n")) {
    const rel = line.trim();
    if (rel.length === 0) continue;
    const abs = path.join(root, rel);
    signature.set(rel, existsSync(abs) ? "untracked\n" + readFileSync(abs, "utf8") : "untracked\n(absent)");
  }
  return signature;
}

// The files whose signature changed between two readings, sorted.
function touchedBetween(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const touched: string[] = [];
  for (const [file, body] of after) {
    if (before.get(file) !== body) touched.push(file);
  }
  for (const file of before.keys()) {
    if (!after.has(file) && !touched.includes(file)) touched.push(file);
  }
  return touched.sort();
}

function runReviewGit(cwd: string, args: string[]): { status: number; stdout: string } {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  delete env["GIT_COMMON_DIR"];
  const out = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: out.status === null ? 1 : out.status, stdout: out.stdout ?? "" };
}

// §3.3 "fresh reviewers over the item's diff + spec + test": the diff half.
//
// The UNTRACKED files the item's declared scope matches, each with the content it
// holds in this tree. The same `ls-files --others` probe treeTouchSignature runs,
// read here for the reviewers' benefit rather than the fixer's.
function itemCreatedFiles(root: string, queueItem: QueueItem): CreatedFile[] {
  const paths = itemScopePaths(queueItem);
  if (paths.length === 0) return [];
  const others = runReviewGit(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths]).stdout;
  const created: CreatedFile[] = [];
  for (const line of others.split("\n")) {
    const rel = line.trim();
    if (rel.length === 0) continue;
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    created.push({ path: rel, content: readFileSync(abs, "utf8") });
  }
  return created;
}

// The item's diff over its declared paths, as one string: git's own diff for the
// files it tracks, plus a creation hunk per file the item brought into existence.
// Split out from the prompt block because GAP-011's witness check re-derives the
// touched-file and hunk set from EXACTLY the diff the reviewers were shown — a
// second `git diff` call could disagree with the first if the tree moved between
// them.
//
// The created half is load-bearing, not cosmetic. `git diff` says nothing about an
// untracked file, so a creation-shaped item used to reach checkReadWitness with an
// EMPTY contact map: no file to cite, no span to land in, and a witness that had
// only to echo the nonce printed in its own prompt. The item's created files are
// the item's whole change, and a reviewer who has not read them has read nothing.
function itemDiff(root: string, queueItem: QueueItem): string {
  const paths = itemScopePaths(queueItem);
  const tracked = paths.length > 0 ? runReviewGit(root, ["diff", "--", ...paths]).stdout : "";
  const created = createdFileDiff(itemCreatedFiles(root, queueItem));
  if (created.length === 0) return tracked;
  return tracked.length === 0 ? created : tracked + (tracked.endsWith("\n") ? "" : "\n") + created;
}

function itemDiffBlock(root: string, queueItem: QueueItem, diff: string): string {
  const parts: string[] = [
    "\n\nTHE ITEM'S DIFF (working tree):\n" + (diff.trim().length > 0 ? diff : "(no tracked diff)"),
    "\nTHE ITEM'S fileScope AS IT STANDS:",
  ];
  for (const rel of queueItem.fileScope) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) {
      parts.push("--- " + rel + " (absent) ---");
      continue;
    }
    parts.push("--- " + rel + " ---\n" + readFileSync(abs, "utf8"));
  }
  return parts.join("\n");
}

// A §2.10 finding as this stage carries it: the record, the lens it belongs to
// (the finding's own `lens` field — a merged session holds two lenses, so the
// session cannot disambiguate), and the sub-session that raised it (§2.11
// provenance for the cap question).
//
// ISSUE-049: `key` is the finding's IDENTITY here, and it is namespaced by the
// session that raised it. Six independent lens sessions numbering their findings
// F1, F2… collide with near-certainty, and the model-authored id was both the
// adjudication key and the token a fixer's pushback was matched against — so one
// finding's refutation dropped its id-twin (a real security hole, reproduced), and
// a concern about F10 was read as a pushback on F1.
interface ItemRaisedFinding {
  finding: Findings["findings"][number];
  lens: string;
  sessionID: string;
  key: string;
}

function raisedKey(sessionID: string, id: string): string {
  return (sessionID.length > 0 ? sessionID : "unattributed") + ":" + id;
}

function renderItemFinding(entry: ItemRaisedFinding): string {
  return (
    "- [" +
    entry.key +
    " | " +
    entry.lens +
    " | " +
    entry.finding.severity +
    "] " +
    entry.finding.claim +
    "\n  evidence: " +
    entry.finding.evidence +
    "\n  suggested fix: " +
    entry.finding.suggestedFix
  );
}

// The review.md doctrine at item level, one merged lens group per session. The
// machine-readable `LENSES:` line is the session's lens attribution contract: a
// reviewer-role prompt WITHOUT it is a §2.10 TEST_VET critic, never a lens session.
export function itemLensPrompt(
  group: readonly string[],
  queueItem: QueueItem,
  diffBlock: string,
  testText: string,
  sessions: number,
  packs: Record<string, string>,
  nonce: string,
): string {
  const charges = group.map((id) => '- "' + id + '": ' + (ITEM_LENS_CHARGES[id] ?? id)).join("\n");
  return (
    "You are an item reviewer, one of " +
    String(sessions) +
    " fresh review sub-sessions, holding the lens(es) below over ONE queue item's change — " +
    "its diff, its spec and its test. Reply with a single JSON object matching the ItemFindings " +
    "schema (findings: id, severity, lens, claim, evidence, suggestedFix; plus readWitness).\n" +
    "LENSES: " +
    group.join(", ") +
    "\n" +
    "READ WITNESS NONCE: " +
    nonce +
    "\n" +
    "Your charge(s):\n" +
    charges +
    "\n\n" +
    doctrineSlice(
      packs,
      "review.md",
      ["An empty review is the approval", "The read witness"],
      "conductor_item_review",
    ) +
    "\n\nSet `readWitness.nonce` to the READ WITNESS NONCE above and `readWitness.citedRanges` to " +
    "the ranges you actually read — at least one per file the diff touches, each naming the file " +
    "and its post-image start/end line inside a hunk of that file. A file this item CREATES " +
    "appears as a creation hunk covering its whole content and must be cited like any other. The " +
    "harness re-derives the diff's own file and hunk set and refuses a witness that cites a file " +
    "the diff does not touch or a span no hunk contains. An EMPTY findings list is still the " +
    "approval; it carries the same witness.\n\nSet `lens` to " +
    "the single lens id (drawn from your LENSES line) the finding belongs to, and make " +
    "`evidence` cite the file or test line the claim rests on. Give each finding a short " +
    "stable `id` and a `suggestedFix` naming the smallest correct change and the path(s) it " +
    "touches." +
    itemSpecBlock(queueItem) +
    diffBlock +
    "\n\nTHE ITEM'S TEST:\n" +
    testText
  );
}

// The skeptic.md doctrine over ONE item-review finding, in isolation (a skeptic is
// never shown its siblings — cross-contamination is how noise survives).
export function itemSkepticPrompt(
  entry: ItemRaisedFinding,
  k: number,
  queueItem: QueueItem,
  diffBlock: string,
  testText: string,
  packs: Record<string, string>,
): string {
  const f = entry.finding;
  return (
    "You are a skeptic over ONE item-review finding. Reply with a single JSON object " +
    "matching the Verdict schema (findingId, upheld, reasoning, refutationEvidence). Your " +
    "doctrine governs the verdict:\n\n" +
    doctrineSlice(
      packs,
      "skeptic.md",
      ["Your verdict and how it counts", "Refutation carries evidence; abstention upholds"],
      "conductor_item_review",
    ) +
    '\n\nSet `findingId` to exactly "' +
    entry.key +
    '". You are one of ' +
    String(k) +
    " independent skeptics on this ONE finding. Judge exactly this finding, in isolation; " +
    "never invent a defect the reviewer did not raise.\n" +
    "A REFUTATION CARRIES EVIDENCE: set `refutationEvidence` to the discriminating input, what " +
    "you ran or read, and the reading under which the finding fails. `upheld:false` WITHOUT all " +
    "three is recorded as an ABSTENTION, and an abstention upholds the finding — so a verdict " +
    "you cannot evidence costs the finding nothing.\n\nTHE FINDING UNDER REVIEW (id " +
    entry.key +
    ", severity " +
    f.severity +
    ", lens " +
    entry.lens +
    "):\nclaim: " +
    f.claim +
    "\nevidence: " +
    f.evidence +
    "\nsuggested fix: " +
    f.suggestedFix +
    itemSpecBlock(queueItem) +
    diffBlock +
    "\n\nTHE ITEM'S TEST:\n" +
    testText
  );
}

// The ONE extra skeptic round a pushback earns (§3.3): the same refutation charge,
// carrying the fixer's own reasoning VERBATIM.
function itemPushbackSkepticPrompt(
  entry: ItemRaisedFinding,
  reasoning: readonly string[],
  k: number,
  queueItem: QueueItem,
  diffBlock: string,
  testText: string,
  packs: Record<string, string>,
): string {
  return (
    itemSkepticPrompt(entry, k, queueItem, diffBlock, testText, packs) +
    "\n\nTHE FIX DISPATCH ANSWERED THIS FINDING WITH REASONING instead of implementing it " +
    "(§3.3: pushback is adjudicated by one more skeptic round, never accepted silently). " +
    "Weigh that reasoning; uphold the finding ONLY if it still stands despite it.\n" +
    "THE FIXER'S REASONING (verbatim):\n" +
    reasoning.map((line) => "- " + line).join("\n")
  );
}

// The implementer-route fix dispatch: doctrine receive-review.md's charge (verify
// the claim before implementing the fix), fileScope only, the standard receipt.
function reviewImplementerFixPrompt(
  entries: readonly ItemRaisedFinding[],
  queueItem: QueueItem,
  round: number,
  max: number,
): string {
  return (
    "You are the implementer for this item. Independent review lenses raised the finding(s) " +
    "below over the item's change, and each SURVIVED a panel of skeptics charged with " +
    "refuting it (review round " +
    String(round) +
    " of at most " +
    String(max) +
    "). Work under doctrine receive-review.md: VERIFY each claim against the code before " +
    "implementing its fix. You may edit ONLY the item's fileScope — the test files are " +
    "frozen for you (§2.4).\n" +
    "If a finding is WRONG, do not implement it: reply DONE_WITH_CONCERNS with a concerns[] " +
    "entry naming the finding as `finding:<id>` (the exact token — a concern that names no " +
    "finding that way is read as agreement) and carrying your reasoning; the handler routes " +
    "that reasoning through one more skeptic round rather than accepting it silently.\n" +
    "A DONE receipt is diffed against the tree: a receipt that touched no file the finding " +
    "names is refused and re-dispatched.\n" +
    "FINDINGS TO FIX:\n" +
    entries.map(renderItemFinding).join("\n") +
    itemSpecBlock(queueItem) +
    "\n\nReply with the ImplementerResult receipt."
  );
}

// The testWriter-route fix dispatch (§3.3 table row 2): testScope only, and the
// changed test re-enters the test discipline before anything else moves.
function reviewTestWriterFixPrompt(
  entries: readonly ItemRaisedFinding[],
  queueItem: QueueItem,
  round: number,
  max: number,
): string {
  return (
    "You are the TEST-WRITER for this item. Independent review lenses raised the finding(s) " +
    "below, each of which demands a TEST change, and each SURVIVED a panel of skeptics " +
    "charged with refuting it (review round " +
    String(round) +
    " of at most " +
    String(max) +
    "). Work under doctrine receive-review.md: VERIFY each claim against the test before " +
    "implementing its fix. You may edit ONLY the item's testScope — the edit-scope gate " +
    "refuses every other path (§2.4). Never resolve a finding by weakening the assertion " +
    "that produced it: the handler re-runs your changed test through evidence, probes it " +
    "against a reverted-behavior tree where cheap, and re-vets it with independent critics " +
    "BEFORE the item is re-validated.\n" +
    "If a finding is WRONG, do not implement it: reply DONE_WITH_CONCERNS with a concerns[] " +
    "entry naming the finding as `finding:<id>` (the exact token — a concern that names no " +
    "finding that way is read as agreement) and carrying your reasoning; the handler routes " +
    "that reasoning through one more skeptic round rather than accepting it silently.\n" +
    "A DONE receipt is diffed against the tree: a receipt that touched no file the finding " +
    "names is refused and re-dispatched.\n" +
    "FINDINGS TO FIX:\n" +
    entries.map(renderItemFinding).join("\n") +
    itemSpecBlock(queueItem) +
    "\n\nReply with the ImplementerResult receipt."
  );
}

// The re-demand after an UPHELD pushback: the finding stands; the fix is required.
function reviewRedemandPrompt(
  role: string,
  entries: readonly ItemRaisedFinding[],
  queueItem: QueueItem,
): string {
  return (
    "You are the " +
    role +
    " for this item. Your pushback on the finding(s) below was adjudicated by an extra " +
    "skeptic round and UPHELD: each finding stands despite your reasoning, and its fix is " +
    "REQUIRED (§3.3 — one pushback round per finding, never more).\n" +
    "FINDINGS TO FIX:\n" +
    entries.map(renderItemFinding).join("\n") +
    itemSpecBlock(queueItem) +
    "\n\nReply with the ImplementerResult receipt."
  );
}

// GAP-012's re-dispatch: the fix receipt claimed a fix the tree does not carry.
// The discrepancy travels VERBATIM — the fixer is told what changed, what the
// findings name, and that the next receipt is measured the same way — because a
// re-dispatch that merely repeats the original demand teaches the session nothing
// about why its first answer was refused.
function reviewReceiptFloorPrompt(
  role: string,
  entries: readonly ItemRaisedFinding[],
  queueItem: QueueItem,
  discrepancy: string,
): string {
  return (
    "You are the " +
    role +
    " for this item. Your previous receipt reported the fix as done, but the harness diffed the " +
    "tree and REFUSED it: " +
    discrepancy +
    ".\nImplement the fix in the file(s) the finding names, or — if the finding is wrong — reply " +
    "DONE_WITH_CONCERNS with a concerns[] entry naming the finding as `finding:<id>` and carrying " +
    "your reasoning, which is adjudicated by one more skeptic round. A second receipt that touches " +
    "nothing the finding names surfaces the item to the human.\n" +
    "FINDINGS TO FIX:\n" +
    entries.map(renderItemFinding).join("\n") +
    itemSpecBlock(queueItem) +
    "\n\nReply with the ImplementerResult receipt."
  );
}

// §3.3's changed-test re-vet: fresh §2.10 critics over the test as it stands. This
// prompt deliberately carries NO `LENSES:` line — that line is the lens-session
// attribution contract, and a vet critic is not a lens.
function reviewRevetPrompt(
  queueItem: QueueItem,
  testText: string,
  rerunLine: string,
  critics: number,
): string {
  return (
    "You are one of " +
    String(critics) +
    " INDEPENDENT test-vet critics judging ONE test that was CHANGED during item review " +
    "(§3.3: a changed test re-enters the test discipline). You are given the item's spec, " +
    "the test as it stands, and the handler's own re-run outcome.\n" +
    "The criteria (§2.10 TEST_VET), as doctrine test-vet.md teaches them:\n\n" +
    renderVetCriteria() +
    "\n\nReply with a single JSON object matching the TestVet schema: a verdict {pass, note} for " +
    "each criterion, plus `mustFix` — the concrete changes this test MUST have." +
    itemSpecBlock(queueItem) +
    "\n\nTHE TEST AS IT STANDS:\n" +
    testText +
    "\n\nTHE HANDLER'S RE-RUN OUTCOME:\n" +
    rerunLine
  );
}

function itemLensJob(itemId: string, tree: TreePath, group: readonly string[], prompt: string): FanoutJob {
  return {
    role: "reviewer",
    itemId,
    tree,
    writeCapable: false,
    prompt,
    // GAP-011: the ITEM-level findings schema — the one that makes the read
    // witness an obligation the receipt cannot omit.
    schemaName: "ItemFindings",
    priority: "interactive",
    lens: group.join("+"),
  };
}

function itemSkepticJob(itemId: string, tree: TreePath, prompt: string): FanoutJob {
  return {
    role: "skeptic",
    itemId,
    tree,
    writeCapable: false,
    prompt,
    schemaName: "Verdict",
    priority: "interactive",
  };
}

// Every review-fix dispatch carries the C-028 delivery signal: the fan-out engine
// copies it onto the §3.5 registry entry, and buildSystemAppend keys the
// receive-review.md secondary pack on exactly that mark.
function reviewFixJob(role: "implementer" | "testWriter", itemId: string, tree: TreePath, prompt: string): FanoutJob {
  return {
    role,
    itemId,
    tree,
    writeCapable: true,
    prompt,
    schemaName: "ImplementerResult",
    priority: "interactive",
    receivingReview: true,
  };
}

function reviewRevetJob(itemId: string, tree: TreePath, prompt: string): FanoutJob {
  return {
    role: "reviewer",
    itemId,
    tree,
    writeCapable: false,
    prompt,
    schemaName: "TestVet",
    priority: "interactive",
  };
}

export interface ItemReviewInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: HandlerJournal;
  stateHome: string;
  workspaceKey: string;
  packs: Record<string, string>;
  sessionID?: string;
  now?: () => number;
}

export interface ItemReviewResult {
  ok: boolean; // true IFF the item advanced VALIDATED->REVIEWED
  itemState: ItemState; // the PERSISTED state after the call
  rounds: number; // review rounds run (== item.attempts.reviewRounds)
  surviving: string[]; // finding ids still surviving at exit ([] on a clean exit)
  questionId: string | null; // the "review-round-cap" question (null on a clean exit)
}

/**
 * conductor_item_review (§3.3 VALIDATED->REVIEWED). Runs the bounded item-level
 * adversarial loop — lens fan-out, per-finding skeptic panels, path-routed fixes,
 * fix => re-validate => re-review — and settles the item: a round with zero
 * surviving findings advances it through core legalItemTransition; the round cap
 * mints ONE §2.11 question (origin "review-round-cap") naming the survivors and
 * blocks the item, which stays at VALIDATED.
 */
export async function handleItemReview(input: ItemReviewInput): Promise<ItemReviewResult> {
  const { store, fanout, runId, itemId, config, journal, packs } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality — the gate's own derivation; a denial throws BEFORE any dispatch.
  const stage = requireStageTool(ITEM_REVIEW_TOOL, store, runId, itemId, runDir);
  const queueItem = stage.queueItem;

  // C-053. Every session this handler dispatches is bound to the tree the ITEM is
  // being worked in — the SAME sessionTreeOf every other stage already uses. Under
  // parallel.writes:"worktrees" that is the item's worktree; otherwise it is the
  // shared tree, which is why the non-worktree rows keep asserting "main".
  //
  // Hardcoding the shared tree here was invisible until C-050 put item review into
  // the wave: a reviewer would have judged a tree without the change it was
  // convened for, and a write-capable fix would have edited outside the isolation
  // §4.2 created.
  const itemTree = sessionTreeOf(store, stage.item);

  // C-055. The same tree as an EXECUTION target: the prompts' git diff and testScope
  // read, the reverted-behavior probe's stash, the re-run of the item test and the
  // re-validate all belong to `tree.root`, and the re-validate's marker to `tree.slug`.
  // Dispatching the reviewers into the worktree while reading the workspace would show
  // them a tree without the change they were convened for — the same defect one layer
  // down.
  const tree = itemTreeOf(store, runId, stage.item);

  // The §3.3 session count (the rosterSizingRule): clamp(readFanout, 3, 6), and the
  // trivial composition for a trivial-classified run. The floor is the named
  // coverage set speaking — three sessions still cover all five mandatory lenses.
  const preClamp = readFanout("itemReview", config);
  const trivial = stage.run.classification.kind === "trivial";
  const sessions = trivial ? 3 : Math.min(6, Math.max(3, Math.floor(preClamp)));
  const composition = ITEM_REVIEW_COMPOSITIONS[sessions];
  const k = Math.floor(readFanout("skeptics", config));
  const max = Math.floor(config.workflow.reviewMaxRounds);
  if (max < 1) {
    throw new Error(
      ITEM_REVIEW_TOOL +
        ": workflow.reviewMaxRounds is " +
        String(max) +
        ", so no review round may run; configure at least one (§2.1)",
    );
  }

  const scope = itemVerifyScope(config, queueItem, ITEM_REVIEW_TOOL);
  const scopePaths = verifyScopePathsOf(queueItem);
  const excluded = foreignRedSet(store, runId, stage.queue, itemId, tree.root);

  // The re-validate (§3.3 fix => re-validate): evidence.runVerify over the §4.2
  // foreign-red set, exactly as conductor_validate composes it. A red re-validate is
  // conductor_validate's DEBUG business, not another review round's — said out loud.
  const revalidate = (): VerifyEvidence => {
    const outcome = runVerify(runDir, itemId, config, scopePaths, {
      cwd: tree.root,
      excludeTestFiles: excluded,
      journal: evidenceJournalOf(journal),
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      runId,
      tree: tree.slug,
      now,
    });
    if (outcome.refused) {
      throw new Error(
        ITEM_REVIEW_TOOL +
          ': item "' +
          itemId +
          '" cannot re-validate: ' +
          outcome.reason +
          " (tree " +
          outcome.tree +
          ", held by pid " +
          String(outcome.heldBy.pid) +
          ")",
      );
    }
    const record = outcome.record as VerifyEvidence;
    if (!record.green) {
      throw new Error(
        ITEM_REVIEW_TOOL +
          ': the re-validate after the review fix round is RED for item "' +
          itemId +
          '" (' +
          verifyFailureText(record) +
          "); the fix regressed the verify, which is conductor_validate's DEBUG business — " +
          "review cannot proceed past it (§3.3)",
      );
    }
    return record;
  };

  let rounds = 0;
  let surviving: ItemRaisedFinding[] = [];

  // The stuck exit (a fixer that replied BLOCKED/NEEDS_CONTEXT, or a changed test
  // that failed its own discipline): the item stays at VALIDATED — blocked is a §2.5
  // annotation, not an FSM position — with ONE §2.11 question on the EXISTING
  // "implementer-blocked" origin. Same shape as the vet-side stuck exit.
  const blockReviewAndAsk = (
    detail: string,
    askedByRole: string,
    askedBySessionID: string,
  ): ItemReviewResult => {
    const item = store.loadItem(runId, itemId);
    item.attempts.reviewRounds += rounds;
    store.saveItem(runId, item);
    const questionText =
      ITEM_REVIEW_TOOL +
      ' could not complete a review fix round for item "' +
      itemId +
      '": ' +
      detail +
      ".\nSay how the surviving finding(s) should be resolved, or whether the item should " +
      "proceed as it stands.";
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "REVIEWED", itemId, round: rounds, reason: detail },
      { runId, itemId },
    );
    const asked = blockItemWithQuestion({
      store,
      runId,
      runDir,
      itemIds: [itemId],
      question: {
        runId,
        question: questionText,
        askedBy: { role: askedByRole, sessionID: askedBySessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      reason: "the review fix round could not proceed: " + detail,
      stage: "REVIEWED",
      journal,
      now,
      journalData: { reviewRounds: rounds },
    });
    const question = asked.question;
    const blocked = asked.items[0] ?? store.loadItem(runId, itemId);
    return {
      ok: false,
      itemState: blocked.state,
      rounds,
      surviving: surviving.map((entry) => entry.finding.id),
      questionId: question.id,
    };
  };

  // The clean advance: the edge goes through the core rule, never a direct write,
  // and the journaled `why` is the rule's own — the observable proof it was asked.
  const advance = (): ItemReviewResult => {
    const item = store.loadItem(runId, itemId);
    const edge = legalItemTransition("VALIDATED", "REVIEWED", {
      item: { behavioral: queueItem.behavioral, blocked: item.blocked },
    });
    if (!edge.ok) {
      throw new Error(
        ITEM_REVIEW_TOOL + ": " + (edge.why ?? "VALIDATED->REVIEWED is not legal for this item"),
      );
    }
    item.state = "REVIEWED";
    item.attempts.reviewRounds += rounds;
    store.saveItem(runId, item);
    journal.log(
      "info",
      "fsm",
      "transition",
      { itemId, from: "VALIDATED", to: "REVIEWED", rounds, sessions, why: edge.why },
      { runId, itemId },
    );
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, state: "REVIEWED", reviewRounds: item.attempts.reviewRounds },
      { runId, itemId },
    );
    return { ok: true, itemState: item.state, rounds, surviving: [], questionId: null };
  };

  // One skeptic panel PER finding — k seats each, dispatched as one wave — with
  // survival decided by core findingSurvives over the panel each finding was GIVEN
  // (a verdict is bound to its finding by the job that asked, never by the reply's
  // self-declared findingId). An under-delivered panel is re-dispatched ONCE for
  // its missing seats; a verdict still missing after that counts as an UPHOLD (G6):
  // feeding the partial panel straight to findingSurvives would read every missing
  // verdict as an overturn and silently drop the finding.
  //
  // ISSUE-049: the outcome is keyed on the ENTRY, never on the model-authored
  // finding id. Six independent lens sessions numbering findings F1, F2… collide
  // with near-certainty, and an id-keyed map let one finding's refutation
  // overwrite — and drop — a finding its OWN panel upheld.
  const adjudicate = async (
    entries: readonly ItemRaisedFinding[],
    promptOf: (entry: ItemRaisedFinding) => string,
  ): Promise<Map<ItemRaisedFinding, boolean>> => {
    const outcome = new Map<ItemRaisedFinding, boolean>();
    if (entries.length === 0) return outcome;
    if (k < 1) {
      throw new Error(
        ITEM_REVIEW_TOOL +
          ": the configured skeptic fan-out is " +
          String(k) +
          " (workflow.skepticsPerFinding clamped to parallel.maxReaders), so the " +
          String(entries.length) +
          " finding(s) this round cannot be adjudicated; configure at least one (§3.3)",
      );
    }
    const jobs: FanoutJob[] = [];
    for (const entry of entries) {
      for (let seat = 0; seat < k; seat += 1) jobs.push(itemSkepticJob(itemId, itemTree, promptOf(entry)));
    }
    const results = await fanout.dispatchWave(jobs);
    const panels: Verdict[][] = entries.map(() => []);
    const missing: number[] = [];
    entries.forEach((entry, index) => {
      for (let seat = 0; seat < k; seat += 1) {
        const verdict = results[index * k + seat]?.value as Verdict | undefined;
        if (verdict !== undefined) panels[index].push(verdict);
      }
      for (let gap = panels[index].length; gap < k; gap += 1) missing.push(index);
    });
    if (missing.length > 0) {
      const retry = await fanout.dispatchWave(
        missing.map((index) => itemSkepticJob(itemId, itemTree, promptOf(entries[index]))),
      );
      retry.forEach((result, at) => {
        const verdict = result.value as Verdict | undefined;
        if (verdict !== undefined) panels[missing[at]].push(verdict);
      });
    }
    entries.forEach((entry, index) => {
      const panel = panels[index];
      while (panel.length < k) {
        panel.push({
          findingId: entry.key,
          upheld: true,
          reasoning:
            "skeptic seat undelivered after one re-dispatch; the missing verdict counts as " +
            "an UPHOLD — a finding is never dropped because a skeptic session crashed (§3.3)",
          refutationEvidence: null,
        });
      }
      outcome.set(entry, findingSurvives(panel, k));
    });
    return outcome;
  };

  // One review-fix dispatch (implementer or testWriter), write-capable, carrying
  // the C-028 receivingReview signal.
  const dispatchReviewFix = async (
    role: "implementer" | "testWriter",
    prompt: string,
  ): Promise<{ reply: ImplementerResult; sessionID: string }> => {
    const result = await fanout.dispatch(reviewFixJob(role, itemId, itemTree, prompt));
    const reply = result.value as ImplementerResult | undefined;
    if (reply === undefined) {
      throw new Error(
        ITEM_REVIEW_TOOL +
          ": the " +
          role +
          ' fix sub-session for item "' +
          itemId +
          '" produced no valid ImplementerResult (' +
          JSON.stringify(result.error) +
          ")",
      );
    }
    return { reply, sessionID: result.sessionID };
  };

  // §3.3 routing by the paths the fix touches, not by a fixed recipient — core
  // policy (routeFix), asked here rather than re-derived: the inline derivation
  // this replaced compared raw scope STRINGS against the fix prose, so a glob
  // scope routed every test finding to the implementer, whose edit gate then
  // denied it (ISSUE-054).
  const routeItemFix = (entry: ItemRaisedFinding): { testWriter: boolean; implementer: boolean } =>
    routeFix(
      entry.finding.suggestedFix,
      { fileScope: queueItem.fileScope, testScope: queueItem.testScope },
      { testAdequacyLens: entry.lens === LENS_TEST_ADEQUACY },
    );

  // The §3.3 "where cheap" reverted-behavior probe. Attempted iff the item's
  // fileScope is non-empty AND its working-tree changes round-trip through
  // `git stash push -- <fileScope>` / `git stash pop` (restored in a finally); ANY
  // stash failure — including an exit-0 push that minted no entry, which a later
  // pop would fail on — SKIPS the probe. It AUGMENTS the mandatory re-run + re-vet,
  // never replaces them.
  const probeReverted = (): { ran: boolean; stillFails: boolean } => {
    if (queueItem.fileScope.length === 0) return { ran: false, stillFails: false };
    const push = runReviewGit(tree.root, ["stash", "push", "--", ...queueItem.fileScope]);
    if (push.status !== 0) return { ran: false, stillFails: false };
    if (runReviewGit(tree.root, ["rev-parse", "--verify", "--quiet", "refs/stash"]).status !== 0) {
      return { ran: false, stillFails: false };
    }
    try {
      const probe = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir, tree.root);
      return { ran: true, stillFails: probe.record.kind === "red" };
    } finally {
      runReviewGit(tree.root, ["stash", "pop"]);
    }
  };

  // The changed-test discipline (§3.3 table row 2): re-run through evidence, probe
  // where cheap, then re-vet with fresh critics — all BEFORE re-validate.
  const runTestDiscipline = async (): Promise<{ ok: true } | { ok: false; result: ItemReviewResult }> => {
    const rerun = runItemTest({ store, runId, journal, now }, queueItem, scope, runDir, tree.root);
    const probe = probeReverted();
    if (probe.ran && !probe.stillFails) {
      return {
        ok: false,
        result: blockReviewAndAsk(
          "the changed test PASSES against the reverted-behavior probe tree, so it no longer " +
            "pins the item's behaviour — it pins the implementation's shape",
          "testWriter",
          input.sessionID ?? "",
        ),
      };
    }
    const critics = Math.floor(readFanout("vet", config));
    if (critics < 1) {
      throw new Error(
        ITEM_REVIEW_TOOL +
          ": the configured vet fan-out is " +
          String(critics) +
          " critic(s), so the changed test cannot be re-vetted; configure at least one (§4.3)",
      );
    }
    const testText = testScopeContent(tree.root, queueItem);
    const rerunRecord = rerun.record;
    const rerunLine =
      rerunRecord.kind === "red"
        ? "the changed test FAILS against the item's tree (exit " +
          String(rerunRecord.exitCode) +
          ", §2.6.1 class " +
          rerunRecord.failureClass +
          ")"
        : "the changed test PASSES against the item's tree (exit 0) — the implementation exists";
    const jobs: FanoutJob[] = [];
    for (let i = 0; i < critics; i += 1) {
      jobs.push(reviewRevetJob(itemId, itemTree, reviewRevetPrompt(queueItem, testText, rerunLine, critics)));
    }
    const results = await fanout.dispatchWave(jobs);
    const union: string[] = [];
    for (const [index, result] of results.entries()) {
      const vet = result.value as TestVet | undefined;
      if (vet === undefined) {
        throw new Error(
          ITEM_REVIEW_TOOL +
            ": re-vet critic " +
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
      // ISSUE-013, at the §3.3 changed-test re-vet: the same rule, since the same
      // receipt shape decides the same question.
      for (const entry of [...vet.mustFix, ...impliedMustFix(vet)]) {
        if (!union.includes(entry)) union.push(entry);
      }
    }
    if (union.length > 0) {
      return {
        ok: false,
        result: blockReviewAndAsk(
          "the changed test did not clear the review re-vet; the critics still require: " +
            union.join("; "),
          "reviewer",
          results[0]?.sessionID ?? "",
        ),
      };
    }
    return { ok: true };
  };

  // (2) derive: review -> refute -> route fixes -> re-validate -> re-review, bounded
  //     by reviewMaxRounds. Every iteration either exits or consumes one round.
  for (;;) {
    rounds += 1;
    const diffText = itemDiff(tree.root, queueItem);
    const diffBlock = itemDiffBlock(tree.root, queueItem, diffText);
    // GAP-011: the changed-file/hunk set the reviewers' own witness is checked
    // against, re-derived from the SAME diff string their prompt carries.
    const contact = diffContact(diffText);
    const testText = testScopeContent(tree.root, queueItem);

    // (2a) the lens fan-out. The sub-3 clamp warning rides the FIRST review
    //      dispatch, on the EXISTING fanout event, at level warn (G2) — whichever
    //      knob (itemReviewers or maxReaders) produced the sub-floor value.
    if (rounds === 1 && preClamp < 3) {
      journal.log(
        "warn",
        "fanout",
        "subsession.dispatched",
        {
          configured: preClamp,
          clamped: sessions,
          tool: ITEM_REVIEW_TOOL,
          why:
            "the itemReview fan-out is below the §3.3 three-session floor; clamped up so " +
            "the mandatory lens set still dispatches",
        },
        { runId, itemId, sessionID: input.sessionID },
      );
    }
    const nonces = composition.map((group) =>
      witnessNonce([runId, itemId, String(rounds), group.join("+")]),
    );
    const lensJobs = composition.map((group, index) =>
      itemLensJob(
        itemId,
        itemTree,
        group,
        itemLensPrompt(group, queueItem, diffBlock, testText, sessions, packs, nonces[index]),
      ),
    );
    const lensResults = await fanout.dispatchWave(lensJobs);
    const raised: ItemRaisedFinding[] = [];
    for (const [index, result] of lensResults.entries()) {
      const findings = result.value as Findings | undefined;
      // A lens that produced nothing is a BLIND SPOT, not a clean bill of health
      // (the handlePlanReview rule): the item is untouched and the tool can simply
      // be run again.
      if (findings === undefined) {
        throw new Error(
          ITEM_REVIEW_TOOL +
            ': the "' +
            composition[index].join("+") +
            '" lens sub-session produced no valid Findings (' +
            JSON.stringify(result.error) +
            ")",
        );
      }
      // GAP-011 (ISSUE-072): a schema-valid reply still has to show CONTACT with
      // the diff — this dispatch's nonce, and ranges the diff really carries. An
      // empty findings list IS the approval and stays one; what stops being free
      // is approving a diff nobody opened. Judgement is untouched: the harness
      // re-derives contact, never correctness.
      const witness = checkReadWitness(findings.readWitness, {
        nonce: nonces[index],
        contact,
      });
      if (!witness.ok) {
        throw new Error(
          ITEM_REVIEW_TOOL +
            ': the "' +
            composition[index].join("+") +
            '" lens sub-session returned a reply with no admissible read witness: ' +
            witness.reasons.join("; ") +
            " — a review that cannot show it read the diff is not an approval (§3.3)",
        );
      }
      for (const finding of findings.findings) {
        raised.push({
          finding,
          lens: finding.lens,
          sessionID: result.sessionID,
          key: raisedKey(result.sessionID, finding.id),
        });
      }
    }

    // (2b) skeptics: every finding, k seats, core survival arithmetic.
    const survivesByEntry = await adjudicate(raised, (entry) =>
      itemSkepticPrompt(entry, k, queueItem, diffBlock, testText, packs),
    );
    let roundSurvivors = raised.filter((entry) => survivesByEntry.get(entry) === true);

    // (2c) adjudication ordering (§3.3): a surviving spec/contract finding discards
    //      the round's quality-lens findings — they are re-derived by the NEXT
    //      round's fresh fan-out, after the spec fix and its re-validate. Tier-1
    //      (correctness, guardrail) findings are retained.
    if (roundSurvivors.some((entry) => entry.lens === LENS_SPEC)) {
      roundSurvivors = roundSurvivors.filter((entry) => !ITEM_QUALITY_LENSES.includes(entry.lens));
    }
    surviving = roundSurvivors;

    // (2d) zero survivors: the clean advance, through the core rule.
    if (roundSurvivors.length === 0) return advance();

    // (2e) the fix pass — §3.3 routing by path, testWriter FIRST then implementer,
    //      sequentially, each under its own discipline.
    if (
      packs["receive-review.md"] === undefined ||
      packs["receive-review.md"].trim().length === 0
    ) {
      throw new Error(
        ITEM_REVIEW_TOOL +
          ": doctrine receive-review.md is absent from the loaded pack set; refusing to " +
          "dispatch a review fix without the doctrine that governs receiving one (§3.3/C-028)",
      );
    }
    const routed = roundSurvivors.map((entry) => ({ entry, route: routeItemFix(entry) }));
    const writerSet = routed.filter((r) => r.route.testWriter).map((r) => r.entry);
    const implSet = routed.filter((r) => r.route.implementer).map((r) => r.entry);
    // Findings a pushback round refuted. Keyed by ENTRY for the ISSUE-049 reason:
    // an id-keyed set killed both of two id-twins on one adjudication.
    const dead = new Set<ItemRaisedFinding>();

    const escalate = (
      role: string,
      reply: ImplementerResult,
      sessionID: string,
    ): ItemReviewResult =>
      blockReviewAndAsk(
        "the " +
          role +
          " replied " +
          reply.status +
          " on the review fix dispatch: " +
          (reply.blockReason ?? reply.neededContext ?? reply.summary),
        role,
        sessionID,
      );

    // A DONE_WITH_CONCERNS receipt whose concerns name a routed finding id is a
    // PUSHBACK (G5): ONE extra skeptic round carrying the reasoning verbatim.
    // Refuted, the finding dies; upheld, the fix is re-demanded exactly once. The
    // re-demand's own receipt is not re-adjudicated — one extra round, never more.
    const resolveFix = async (
      role: "implementer" | "testWriter",
      entries: ItemRaisedFinding[],
      first: { reply: ImplementerResult; sessionID: string },
    ): Promise<{ ok: true } | { ok: false; result: ItemReviewResult }> => {
      if (first.reply.status === "BLOCKED" || first.reply.status === "NEEDS_CONTEXT") {
        return { ok: false, result: escalate(role, first.reply, first.sessionID) };
      }
      if (first.reply.status !== "DONE_WITH_CONCERNS") return { ok: true };
      // GAP-040 (ISSUE-049): EXACT-token matching. `concern.includes(id)` read a
      // concern about F10 as a pushback on F1 — it mis-adjudicated precisely the
      // doctrine-following fixer who writes a careful, loosely-worded concern.
      const names = (entry: ItemRaisedFinding): string[] => [entry.key, entry.finding.id];
      const pushed = entries.filter((entry) =>
        first.reply.concerns.some((line) => concernNamesFinding(line, names(entry))),
      );
      if (pushed.length === 0) return { ok: true };
      const upheldByEntry = await adjudicate(pushed, (entry) =>
        itemPushbackSkepticPrompt(
          entry,
          first.reply.concerns.filter((line) => concernNamesFinding(line, names(entry))),
          k,
          queueItem,
          diffBlock,
          testText,
          packs,
        ),
      );
      const upheld = pushed.filter((entry) => upheldByEntry.get(entry) === true);
      for (const entry of pushed) {
        if (upheldByEntry.get(entry) !== true) dead.add(entry);
      }
      if (upheld.length > 0) {
        const again = await dispatchReviewFix(role, reviewRedemandPrompt(role, upheld, queueItem));
        if (again.reply.status === "BLOCKED" || again.reply.status === "NEEDS_CONTEXT") {
          return { ok: false, result: escalate(role, again.reply, again.sessionID) };
        }
      }
      return { ok: true };
    };

    // GAP-012, the fixer-receipt floor. One fix pass = dispatch, settle the
    // pushbacks, then MEASURE: the tree is signed before the dispatch and after
    // everything the dispatch was going to do, and a receipt that touched no file
    // the still-live findings NAME is refused. The refusal re-dispatches ONCE with
    // the discrepancy verbatim; a second empty receipt surfaces the item. Nothing
    // here judges whether the fix is right — that is the next round's job — only
    // whether the claimed work exists at all.
    const runFixPass = async (
      role: "implementer" | "testWriter",
      entries: ItemRaisedFinding[],
      prompt: string,
    ): Promise<{ ok: true } | { ok: false; result: ItemReviewResult }> => {
      const before = treeTouchSignature(tree.root, queueItem);
      const first = await dispatchReviewFix(role, prompt);
      const settled = await resolveFix(role, entries, first);
      if (!settled.ok) return settled;
      const obliged = entries.filter((entry) => !dead.has(entry));
      if (obliged.length === 0) return { ok: true };
      const scopes = { fileScope: queueItem.fileScope, testScope: queueItem.testScope };
      // The per-PATH half of the same subtraction (core/receipt-floor.ts
      // floorExclusions): a co-located testScope sits INSIDE the fileScope and so
      // survives the entry-level subtraction, and an implementer's edit to a test
      // the write gate refuses outright cannot be the receipt for its finding.
      const excluded = floorExclusions(role, scopes);
      const subjects: string[] = [];
      for (const entry of obliged) {
        // The ROUTE is part of the question: a finding that names no path is
        // discharged inside the half of the item this fixer may write, never the
        // other one (core/receipt-floor.ts routeFallbackScope).
        const named = findingSubjects(entry.finding, scopes, role);
        for (const subject of named) {
          if (!subjects.includes(subject)) subjects.push(subject);
        }
      }
      const measure = (): { ok: boolean; reason: string } =>
        receiptFloor(
          touchedBetween(before, treeTouchSignature(tree.root, queueItem)),
          subjects,
          excluded,
        );
      const firstFloor = measure();
      if (firstFloor.ok) return { ok: true };
      journal.log(
        "warn",
        "fsm",
        "guard-reject",
        { stage: "REVIEWED", itemId, round: rounds, role, reason: firstFloor.reason },
        { runId, itemId },
      );
      const again = await dispatchReviewFix(
        role,
        reviewReceiptFloorPrompt(role, obliged, queueItem, firstFloor.reason),
      );
      if (again.reply.status === "BLOCKED" || again.reply.status === "NEEDS_CONTEXT") {
        return { ok: false, result: escalate(role, again.reply, again.sessionID) };
      }
      const secondFloor = measure();
      if (secondFloor.ok) return { ok: true };
      return {
        ok: false,
        result: blockReviewAndAsk(
          "the " + role + "'s fix receipt was refused twice — " + secondFloor.reason,
          role,
          again.sessionID,
        ),
      };
    };

    if (writerSet.length > 0) {
      const settled = await runFixPass(
        "testWriter",
        writerSet,
        reviewTestWriterFixPrompt(writerSet, queueItem, rounds, max),
      );
      if (!settled.ok) return settled.result;
      // The changed test re-enters the discipline REGARDLESS of pushback: the
      // writer may have edited before pushing back on a sibling finding.
      const discipline = await runTestDiscipline();
      if (!discipline.ok) return discipline.result;
    }

    const implLive = implSet.filter((entry) => !dead.has(entry));
    if (implLive.length > 0) {
      const settled = await runFixPass(
        "implementer",
        implLive,
        reviewImplementerFixPrompt(implLive, queueItem, rounds, max),
      );
      if (!settled.ok) return settled.result;
    }

    // A finding a pushback round REFUTED died: it demands nothing further and
    // contributes nothing at the cap.
    surviving = roundSurvivors.filter((entry) => !dead.has(entry));

    // (2f) fix => re-validate (§3.3). Always after a fix pass: a fix dispatch may
    //      have edited the tree whatever its receipt said.
    revalidate();

    // (2g) the bound. Below the cap the next round re-reviews the fixed tree; at
    //      the cap the machine is out of moves — ONE §2.11 question carrying the
    //      surviving finding list, and the item is blocked, staying at VALIDATED.
    if (rounds < max) continue;
    if (surviving.length === 0) {
      // Every survivor died in pushback adjudication: nothing survives, which is
      // the VALIDATED->REVIEWED edge's own condition.
      return advance();
    }
    const survivingIds = surviving.map((entry) => entry.finding.id);
    const item = store.loadItem(runId, itemId);
    item.attempts.reviewRounds += rounds;
    store.saveItem(runId, item);
    const questionText =
      ITEM_REVIEW_TOOL +
      ' reached its round cap for item "' +
      itemId +
      '": ' +
      String(rounds) +
      " of workflow.reviewMaxRounds=" +
      String(max) +
      " review round(s) spent and these finding(s) still survive their skeptics:\n" +
      surviving.map(renderItemFinding).join("\n") +
      "\nThe item stays at VALIDATED and is blocked until you answer: say how the finding(s) " +
      "should be resolved, or that the item should proceed as it stands.";
    journal.log(
      "warn",
      "fsm",
      "guard-reject",
      { stage: "REVIEWED", itemId, round: rounds, max, surviving: survivingIds },
      { runId, itemId },
    );
    const asked = blockItemWithQuestion({
      store,
      runId,
      runDir,
      itemIds: [itemId],
      question: {
        runId,
        question: questionText,
        askedBy: { role: "reviewer", sessionID: surviving[0].sessionID },
        humanTerritory: isHumanTerritory(questionText),
        origin: "review-round-cap",
        blocksItems: [itemId],
      },
      reason:
        "item review reached reviewMaxRounds=" +
        String(max) +
        " with finding(s) still surviving: " +
        survivingIds.join("; "),
      stage: "REVIEWED",
      journal,
      now,
      journalData: { reviewRounds: rounds },
    });
    const question = asked.question;
    const blocked = asked.items[0] ?? store.loadItem(runId, itemId);
    return {
      ok: false,
      itemState: blocked.state,
      rounds,
      surviving: survivingIds,
      questionId: question.id,
    };
  }
}

// ===========================================================================
// (11) conductor_publish — the §3.3 step 1-6 sequence (Task 9.5b, plan lines
// 2667-2686). REVIEWED->PUBLISHED, or an honest denial.
//
// Every step that can refuse RETURNS {ok:false, denial} rather than throwing:
// a denial is a normal outcome the model is expected to read and act on, and
// throwing would make an ordinary "not yet" indistinguishable from a bug. The
// legality check at the top still throws — an illegal tool call IS a bug.
//
// Nothing is half-written on any denial path: the commit is the LAST mutation,
// and every refusal precedes it.
// ===========================================================================

// The prepared-batch artifact (C-037 ruling 3). It is a runDir FILE and not a
// journal payload for a specific reason: journal records are capped at 32 KiB and
// shrinkToFit replaces an oversized payload with {truncated:true}. A truncated
// diff in a report is a report that lies about what shipped, so the diff travels
// as an artifact that has no cap.
// What the caller asserts the record at `seq` must BE. ISSUE-027: resolving a
// record by seq alone trusts the pointer completely, and a seq is exactly the
// thing two writers can mint twice — so the seq locates the line and the
// attribution decides whether it is the caller's line at all. capturedRedOf has
// always filtered by itemId; this is the same check at the publish-side resolver,
// which is where a mis-pointed seq ships one item's green on another's evidence.
export interface EvidenceExpectation {
  itemId: string;
  // §4.2 worktree mode: a green produced against the shared tree is not a green
  // for the item's worktree. Omitted when the caller does not care which tree.
  tree?: TreeSlug;
}

export interface EvidenceLookup {
  /** The record, or null when there is none at `seq` or it is another's. */
  record: EvidenceRecord | null;
  /** Non-null exactly when a record WAS at `seq` and failed attribution. */
  refused: { seq: number; foundItemId: string; foundTree?: string } | null;
}

/**
 * Read ONE §2.6 evidence record by its ledger seq AND its attribution.
 *
 * A missing record is a fact the caller must handle, not an exception: a publish
 * whose verify record cannot be found is denied, not crashed. Torn lines are
 * skipped for the same reason every other ledger reader heals them. A record that
 * IS present but belongs to another item (or another tree) is REFUSED and
 * reported as such, so the denial can say which — "no record" and "someone else's
 * record" are different failures, and only one of them means corruption.
 *
 * The LAST match wins: if two writers ever minted the same number, the newer line
 * is the one a pointer written afterwards refers to (the same rule capturedRedOf
 * applies for the same reason).
 */
export function lookupEvidenceAt(
  runDir: string,
  seq: number,
  expect: EvidenceExpectation,
): EvidenceLookup {
  const { records } = readJsonlTolerant<EvidenceRecord>(path.join(runDir, "evidence.jsonl"));
  let found: EvidenceRecord | null = null;
  for (const parsed of records) {
    if (parsed.seq === seq) found = parsed;
  }
  if (found === null) return { record: null, refused: null };
  const foundTree = found.kind === "verify" ? found.tree : undefined;
  const itemMatches = found.itemId === expect.itemId;
  const treeMatches = expect.tree === undefined || foundTree === undefined || foundTree === expect.tree;
  if (itemMatches && treeMatches) return { record: found, refused: null };
  return {
    record: null,
    refused: {
      seq,
      foundItemId: found.itemId,
      ...(foundTree === undefined ? {} : { foundTree }),
    },
  };
}

// The lookup for the callers that need only the record: a refusal reads as
// absence, which is what a report line and a commit-message proof both do with it.
function readEvidenceAt(
  runDir: string,
  seq: number,
  expect: EvidenceExpectation,
): EvidenceRecord | null {
  return lookupEvidenceAt(runDir, seq, expect).record;
}

const PUBLISH_BATCH_FILE = "publish-batch.jsonl";

export interface PublishBatchRecord {
  itemId: string;
  tsMs: number;
  mode: string;
  files: string[];
  diff: string;
  suggestedMessage: string;
  // The preexistingDirty "exclude" paths this publish left out of the commit.
  // They belong in the report's Exclusions section: the human's WIP did not ship,
  // and a report that does not say so misrepresents what was committed.
  skipped: string[];
  verify: { seq: number | null; green: boolean };
}

function appendPublishBatch(runDir: string, record: PublishBatchRecord): void {
  // A plain append, mirroring appendDecision. state.ts's raw ledger-append export
  // is RESERVED to evidence.ts by the committed G6 source scan
  // ([4.1-evidence-append]) — which is textual, so this comment names it only by
  // description. This is a handler-owned run-dir ledger like decisions.jsonl,
  // not evidence, so the plain append is the right sibling to copy.
  mkdirSync(runDir, { recursive: true });
  appendFileSync(path.join(runDir, PUBLISH_BATCH_FILE), JSON.stringify(record) + "\n");
}

export function readPublishBatch(runDir: string): PublishBatchRecord[] {
  const file = path.join(runDir, PUBLISH_BATCH_FILE);
  if (!existsSync(file)) return [];
  const out: PublishBatchRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line) as PublishBatchRecord);
    } catch {
      // A torn last line is the crash-safety case the journal healer already
      // handles for its own ledger; here it simply means that batch is not
      // reportable, which the report renders as such rather than throwing.
    }
  }
  return out;
}

export interface PublishInput {
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: HandlerJournal;
  stateHome: string;
  workspaceKey: string;
  now?: () => number;
  // The §3.3 step-5 template, injectable so the handler-side denylist refusal can
  // be exercised against a generator that misbehaves. Defaults to the pure core
  // template — the handler never builds a message itself.
  messageBuilder?: (item: QueueItem, redProof: RedProof | null) => string;
}

export interface PublishResult {
  ok: boolean;
  itemState: ItemState;
  denial: string | null;
  commit: string | null;
  pushed: boolean;
  message: string | null;
  staged: string[];
  skipped: string[];
  reverified: boolean;
  verifySeq: number | null;
  excluded: string[];
  questionId: string | null;
}

function publishDenial(itemState: ItemState, denial: string, over: Partial<PublishResult> = {}): PublishResult {
  return {
    ok: false,
    itemState,
    denial,
    commit: null,
    pushed: false,
    message: null,
    staged: [],
    skipped: [],
    reverified: false,
    verifySeq: null,
    excluded: [],
    questionId: null,
    ...over,
  };
}

// The §2.1 format rule that governs a path: FIRST match wins, so an operator
// orders rules from most specific to least and the ordering is the rule.
function formatRuleFor(config: Config, rel: string): Config["format"]["rules"][number] | null {
  for (const rule of config.format.rules) {
    if (globMatch(rule.pattern, rel)) return rule;
  }
  return null;
}

// The subset of `rels` git already knows about. `git ls-files` lists a path that
// is in the index whether or not it still exists in the worktree, which is
// exactly the question a deleted-inside-scope path has to answer. -z so a path
// with a quote-worthy byte comes back verbatim rather than C-quoted.
function trackedPaths(treeRoot: string, rels: string[]): Set<string> {
  if (rels.length === 0) return new Set();
  const out = runReviewGit(treeRoot, ["ls-files", "-z", "--", ...rels]);
  if (out.status !== 0) return new Set();
  return new Set(out.stdout.split("\0").filter((entry) => entry.length > 0));
}

// A §2.4 scope entry is either a literal path or a glob ("src/parser/**"). A
// literal passes through untouched — the staging filter judges its existence
// exactly where it always did — while a glob expands to the files that exist
// under the publish tree, because `git add` takes paths, not this glob dialect.
// The walk skips the trees that are never publishable content.
const GLOB_META = /[*?[\]{]/;

/**
 * What each item's declared write scope MEASURES OUT TO in `treeRoot`: the files
 * its fileScope globs actually match, and their total size. This is the half of
 * the §3.2 item budget core cannot compute (G3 forbids core a filesystem), and it
 * is measured HERE, at queue acceptance, because this module is the one that owns
 * glob expansion.
 *
 * A literal path naming a file that does not exist yet measures zero files and
 * zero bytes — greenfield work costs nothing to read, and core takes the entry
 * count as the floor of the file budget precisely so that item is still counted.
 *
 * A wildcard-headed entry is NOT expanded: core refuses it on shape, and walking
 * an entire repository to measure a scope that is already rejected is the one
 * thing this measurement must never do.
 */
function measureQueueScopes(treeRoot: string, queue: Queue): Map<string, ScopeMeasurement> {
  const measured = new Map<string, ScopeMeasurement>();
  for (const item of queue.items) {
    const rels = new Set<string>();
    for (const entry of item.fileScope) {
      const rel = normalizeRepoRel(entry);
      if (isWildcardHeaded(rel)) continue;
      for (const found of expandScopeEntry(treeRoot, rel)) rels.add(found);
    }
    let files = 0;
    let bytes = 0;
    for (const rel of rels) {
      let info;
      try {
        info = statSync(path.join(treeRoot, rel));
      } catch {
        continue; // a path that is not there yet costs nothing to read
      }
      if (!info.isFile()) continue;
      files += 1;
      bytes += info.size;
    }
    measured.set(item.id, { files, bytes });
  }
  return measured;
}

function expandScopeEntry(treeRoot: string, rel: string): string[] {
  if (!GLOB_META.test(rel)) return [rel];
  const found: string[] = [];
  const walk = (dirRel: string): void => {
    const absDir = dirRel.length === 0 ? treeRoot : path.join(treeRoot, dirRel);
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git" || name === ".conductor" || name === "node_modules") continue;
      const childRel = dirRel.length === 0 ? name : dirRel + "/" + name;
      let info;
      try {
        info = statSync(path.join(treeRoot, childRel));
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(childRel);
      } else if (globMatch(rel, childRel)) {
        found.push(childRel);
      }
    }
  };
  walk("");
  return found.sort();
}

export async function handlePublish(input: PublishInput): Promise<PublishResult> {
  const { store, runId, itemId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);
  const root = store.root;

  // §3.9: publish is DERIVED from the workspace, not configured — Config has no
  // no-git field and git.mode "read-only" cannot distinguish "a repo I may not
  // write" from "no repo at all". The gate consumes this same predicate, so no
  // fixture exists in which the gate offers publish and the handler refuses it.
  const publishEnabled = isRepo(root);

  if (!publishEnabled) {
    // A REFUSAL, not a denial. The gate consumes this same predicate and never
    // offers conductor_publish in no-git mode, so arriving here is an illegal
    // tool call rather than a "not yet" the model should read and retry. Named
    // here rather than left to the generic not-offered refusal below because the
    // reader needs the MODE, not "no tool is offered for this item".
    throw new Error(
      PUBLISH_TOOL +
        ": this workspace is not a git repository, so §3.9 no-git mode is in force and publish is " +
        "disabled — the item terminates at REVIEWED and its diff is recorded in the report",
    );
  }

  // LEGALITY BEFORE PERSIST. Publish is a §3.3 stage tool and asks the SAME
  // question every other stage handler asks, through the SAME helper: does core
  // legalTools offer THIS tool for THIS item right now. The hand-rolled
  // precondition this replaced (`item.state !== "REVIEWED"`) was a second
  // derivation of one rule, and it was the weaker one: it could not see the §2.5
  // `blocked`/`deferred` annotations, the run's own FSM position or a stop, nor
  // an unpublished dependency — so a deferred item at REVIEWED published.
  const stage = requireStageTool(PUBLISH_TOOL, store, runId, itemId, runDir);
  const { run, queue, queueItem, item } = stage;

  // The item FSM, consulted BEFORE the first side effect rather than after the
  // commit, the push and the merge-back. Asked late it could refuse nothing: the
  // work was already integrated by the time it answered. `blocked` is the rule
  // that lives here (§3.3, applied before the transition table), and a commit is
  // the least reversible write in the system.
  const edge = legalItemTransition("REVIEWED", "PUBLISHED", {
    item: { behavioral: queueItem.behavioral, blocked: item.blocked },
  });
  if (!edge.ok) {
    return publishDenial(item.state, PUBLISH_TOOL + ": " + (edge.why ?? "the FSM denies REVIEWED->PUBLISHED"));
  }

  const gitMode = config.git.mode;
  const readOnly = gitMode === "read-only";

  // §4.2 worktree mode: config says worktrees AND the item carries a persisted
  // worktree. The input surface is unchanged — the mode is read off the same
  // §2.1/§2.5 facts every other handler reads. Steps 1-6 then run with cwd =
  // item.worktree (the commit lands on conductor/<runId>/<itemId>, and the
  // workspace is a bystander until merge-back), and PUBLISHED is gated on an
  // integrated-tree re-validate in the workspace afterwards.
  const treeRoot = config.parallel.writes === "worktrees" && item.worktree !== null ? item.worktree : root;
  const worktreeMode = treeRoot !== root;

  // ---- step 1: the branch/HEAD check -------------------------------------
  // The verify this publish rests on was produced against ONE tree. A branch
  // switch moves HEAD without necessarily touching any staged file's mtime, so
  // the mtime terms cannot see it — which is exactly why §2.6's freshness rule
  // carries a head term at all, and why it is checked before anything is staged.
  // In worktree mode both sides are the WORKTREE's: the record was produced with
  // cwd = the worktree and tree = the item id (G10), and the integrated tree gets
  // its own tree:"main" record after merge-back.
  const validatedRef = item.evidence.validated ?? item.evidence.green ?? null;
  // ISSUE-027: the pointer's seq LOCATES the record; the item id and (in worktree
  // mode) the tree decide whether it is this item's record at all. A publish that
  // trusts the seq alone is the last link of the double-writer chain — it ships one
  // item's commit on another item's green.
  const expectedTree = worktreeMode ? treeSlug(itemId) : MAIN_TREE;
  const lookup =
    validatedRef === null
      ? { record: null, refused: null }
      : lookupEvidenceAt(runDir, validatedRef.seq, { itemId, tree: expectedTree });
  const record = lookup.record as VerifyEvidence | null;
  if (record === null) {
    return publishDenial(
      item.state,
      lookup.refused === null
        ? PUBLISH_TOOL + ': item "' + itemId + '" carries no §2.6 verify record to publish on'
        : PUBLISH_TOOL +
            ': item "' +
            itemId +
            '" points at evidence seq ' +
            String(lookup.refused.seq) +
            ', but the record there belongs to item "' +
            lookup.refused.foundItemId +
            '"' +
            (lookup.refused.foundTree === undefined
              ? ""
              : ' on tree "' + lookup.refused.foundTree + '"') +
            " — a green produced for something else is not this item's evidence (§2.6). Re-validate the item.",
    );
  }

  const currentHead = headSha(treeRoot) ?? "";
  if (record.head !== currentHead) {
    return publishDenial(
      item.state,
      PUBLISH_TOOL +
        ': the verify this publish rests on was produced at commit "' +
        record.head +
        '" but HEAD is now "' +
        currentHead +
        '" — a green produced on one tree is not a green on another (§2.6). ' +
        "Re-validate the item against the current tree.",
    );
  }

  // ---- step 2: stage fileScope ∪ testScope MINUS the user's pre-existing WIP
  const preexisting = new Set((run.startDirty ?? []).map((entry) => normalizeRepoRel(entry)));
  const wanted = [
    ...new Set(
      itemScopePaths(queueItem).flatMap((entry) => expandScopeEntry(treeRoot, normalizeRepoRel(entry))),
    ),
  ].sort();

  const conflicts = wanted.filter((rel) => preexisting.has(rel));
  const skipped: string[] = [];
  if (conflicts.length > 0) {
    if (config.git.preexistingDirty === "refuse") {
      // The human's uncommitted work sits inside the scope this run claims. That
      // is a conflict between the run's scope and the human's, which is exactly
      // what the closed `scope-conflict` origin names — no widening needed.
      // The ask and the item's disposition are ONE transaction (GAP-028): a
      // publish that surfaced the question and then died left an item nothing
      // said was blocked, and the next pass offered it publish again — against
      // the same human WIP, minting the same question.
      const asked = blockItemWithQuestion({
        store,
        runId,
        runDir,
        itemIds: [itemId],
        question: {
          runId,
          question:
            "Publishing " +
            itemId +
            " would touch files you already had uncommitted work in (" +
            conflicts.join(", ") +
            "). Commit, stash, or set git.preexistingDirty to \"exclude\" to publish without them.",
          askedBy: { role: "orchestrator", sessionID: "" },
          humanTerritory: true,
          origin: "scope-conflict",
          blocksItems: [itemId],
        },
        reason:
          "publishing would touch the human's pre-existing uncommitted work: " + conflicts.join(", "),
        stage: item.state,
        journal,
        now,
        journalData: { conflicts },
      });
      const question = asked.question;
      return publishDenial(
        item.state,
        PUBLISH_TOOL +
          ": git.preexistingDirty is \"refuse\" and the item's scope contains pre-existing dirty files (" +
          conflicts.join(", ") +
          ") — nothing was staged",
        { questionId: question.id },
      );
    }
    skipped.push(...conflicts);
  }

  // A path the item DELETED inside its own scope is still the item's to publish,
  // and existsSync cannot tell "the item removed this file" from "this declared
  // path was never created": both are absent from disk. Git can tell them apart,
  // so it is asked — a TRACKED path stays in the pathspec (`git add` records the
  // removal, and the commit ships it), while a path git has never heard of is
  // dropped, because `git add` aborts on a pathspec matching nothing.
  const claimed = wanted.filter((rel) => !preexisting.has(rel));
  const tracked = trackedPaths(treeRoot, claimed);
  const staged = claimed.filter((rel) => existsSync(path.join(treeRoot, rel)) || tracked.has(rel));

  // ---- step 3: format ----------------------------------------------------
  for (const rel of staged) {
    const rule = formatRuleFor(config, rel);
    if (rule === null) continue;
    const abs = path.join(treeRoot, rel);
    const before = readFileSync(abs, "utf8");

    const out = spawnSync(rule.command[0] as string, rule.command.slice(1), {
      cwd: treeRoot,
      encoding: "utf8",
      input: rule.mode === "stdin" ? before : undefined,
      stdio: rule.mode === "stdin" ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    // A formatter that could not run, or exited non-zero, or (in stdin mode)
    // produced nothing from non-empty input, has not rendered a FORMATTING
    // VERDICT — it has failed. Treating its empty stdout as "the formatted file"
    // would silently truncate the source. Failure and dirty are distinct.
    if (out.error !== undefined || out.status === null || out.status !== 0) {
      return publishDenial(
        item.state,
        PUBLISH_TOOL +
          ": the format rule " +
          JSON.stringify(rule.pattern) +
          " (" +
          rule.command.join(" ") +
          ") failed on " +
          rel +
          (out.error !== undefined ? " (" + String(out.error) + ")" : " (exit " + String(out.status) + ")") +
          " — no commit was created",
      );
    }
    if (rule.mode === "stdin") {
      const formatted = out.stdout ?? "";
      if (before.length > 0 && formatted.length === 0) {
        return publishDenial(
          item.state,
          PUBLISH_TOOL +
            ": the format rule " +
            JSON.stringify(rule.pattern) +
            " (" +
            rule.command.join(" ") +
            ") produced empty output for non-empty " +
            rel +
            " — a crashed formatter's stdout is not a formatting verdict",
        );
      }
      if (formatted !== before) writeFileSync(abs, formatted);
    }
  }

  if (!readOnly && staged.length > 0) {
    const add = runReviewGit(treeRoot, ["add", "--", ...staged]);
    if (add.status !== 0) {
      return publishDenial(item.state, PUBLISH_TOOL + ": git add failed for " + staged.join(", "));
    }
  }

  // ---- step 4: freshness, and at most ONE auto re-verify ------------------
  const behavioral = staged.filter((rel) => existsSync(path.join(treeRoot, rel)));
  const mtimes = [...worktreeMtimes(treeRoot, behavioral).values()];
  const fresh = verifyFreshFor(
    { startedMs: record.startedMs, head: record.head },
    {
      stagedMtimes: mtimes,
      indexMtimeMs: indexMtimeMs(treeRoot),
      // ISSUE-046: a staged entry with no file behind it is a DELETION this publish
      // deliberately ships (the `tracked` half of `staged` above is exactly that
      // set), and a deletion moves no worktree mtime — so with this hardcoded false
      // the surviving files' stamps alone decided freshness and a change whose only
      // post-validate edit removed a file committed a tree state no verify ever
      // described. `behavioral` is `staged` minus what still exists, so the two
      // differing in length IS the staged-deletion fact, derived where it is known.
      hasStagedDeletion: behavioral.length !== staged.length,
      currentHead,
      noGit: false,
      // What the record's OWN stamp can order (GAP-035): a verify started under the
      // composition root's monotonic clock carries a sub-millisecond stamp that
      // decides the tie against a filesystem mtime, and a record written by a
      // whole-millisecond wall read does not. Read off the record, because that is
      // all a record written by an earlier process still carries.
      stampResolutionMs: stampResolutionMsOf(record.startedMs),
    },
  );

  let reverified = false;
  let verifySeq: number | null = record.seq;
  let excluded: string[] = [];

  if (!fresh.fresh) {
    reverified = true;
    // The set is quarantined out of the tree the verify runs in — the worktree in
    // worktree mode — so its existence probe must ask THAT tree (C-055).
    excluded = foreignRedSet(store, runId, queue, itemId, treeRoot);
    const outcome = runVerify(runDir, itemId, config, verifyScopePathsOf(queueItem), {
      cwd: treeRoot,
      excludeTestFiles: excluded,
      journal: evidenceJournalOf(journal),
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      runId,
      // Per-tree marker + honest record identity (§2.6): the tree the verify
      // judges is the item's own worktree in worktree mode, else main.
      tree: worktreeMode ? treeSlug(itemId) : STAGE_TREE,
      now,
    });
    if (outcome.refused) {
      return publishDenial(
        item.state,
        PUBLISH_TOOL + ': item "' + itemId + '" cannot re-verify: ' + outcome.reason,
      );
    }
    const reRecord = outcome.record as VerifyEvidence;
    verifySeq = reRecord.seq;
    if (!reRecord.green) {
      // The item's own test still passes in this situation — it is the TREE that
      // moved under it. So the item goes back to GREEN with the debug protocol
      // armed rather than being blamed, and publish stops. No second attempt:
      // looping here would burn the budget on a tree nobody has fixed yet.
      demoteReviewedToGreen({
        store,
        runId,
        itemId,
        journal,
        reason: "the auto re-verify at publish went red on the current tree",
        hypothesis: "the tree changed after the review: " + verifyFailureText(reRecord),
        now,
      });
      return publishDenial("GREEN", PUBLISH_TOOL + ": the auto re-verify failed; the item is back at GREEN for debugging", {
        reverified: true,
        verifySeq,
        excluded,
      });
    }
  }

  // ---- step 5: the message, built by the pure template --------------------
  const redRef = item.evidence.red ?? null;
  const redRecord =
    redRef === null
      ? null
      : (readEvidenceAt(runDir, redRef.seq, { itemId }) as Extract<EvidenceRecord, { kind: "red" }> | null);
  const redProof: RedProof | null =
    redRecord === null
      ? null
      : { seq: redRecord.seq, command: [...redRecord.command], failureExcerpt: redRecord.failureExcerpt };

  const build = input.messageBuilder ?? buildCommitMessage;
  const message = build(queueItem, redProof);

  // Defense in depth: the generator neutralizes, and the handler REFUSES. The
  // generator is injectable and can be replaced; the rule cannot.
  const token = denylistedTrailerToken(message);
  if (token !== null) {
    return publishDenial(
      item.state,
      PUBLISH_TOOL +
        ": the commit message carries the denylisted trailer token " +
        JSON.stringify(token) +
        " (§3.3) — conductor does not sign another name to a commit, and no commit was created",
      { staged, skipped, reverified, verifySeq, excluded },
    );
  }

  // ---- step 6: commit, push, batch, advance ------------------------------
  // Against HEAD rather than the index: in read-only mode nothing is staged, and
  // a batch whose diff is empty because of the MODE would make the report claim
  // the item changed nothing. The empty pathspec is guarded because `git diff
  // HEAD --` with NO pathspec is not the empty diff — it is the WHOLE-WORKTREE
  // diff, which would put every unrelated edit in the tree into this item's batch
  // line and let the report attribute them to it. An item that staged nothing
  // changed nothing, and its diff is empty.
  const diff = staged.length === 0 ? "" : runReviewGit(treeRoot, ["diff", "HEAD", "--", ...staged]).stdout;

  let commit: string | null = null;
  let pushed = false;

  if (!readOnly && staged.length > 0) {
    // The commit carries the item's OWN pathspec, so what it commits is what this
    // handler staged — not whatever else the index happens to hold. The index is a
    // singleton (§4.3) shared with the human and with every earlier publish that
    // denied BETWEEN its `git add` and this line, and a pathspec-less `git commit`
    // would sweep all of it into this item's commit under this item's message.
    // With a pathspec git commits those paths' worktree content (deletions
    // included) and leaves the rest of the index staged and untouched.
    const made = runReviewGit(treeRoot, ["commit", "--cleanup=default", "-m", message, "--", ...staged]);
    if (made.status !== 0) {
      return publishDenial(item.state, PUBLISH_TOOL + ": git commit failed", {
        staged,
        skipped,
        reverified,
        verifySeq,
        excluded,
      });
    }
    commit = headSha(treeRoot);

    if (gitMode === "commit-and-push" && !worktreeMode) {
      // §3.3:1296. argv discipline, never a shell string — core/gates-git.ts
      // denies a SESSION's `git push`, so the handler is the only thing that may
      // perform it, and it performs it directly. In worktree mode the push waits
      // for merge-back: what ships is the WORKSPACE branch, after integration.
      const push = runReviewGit(root, ["push"]);
      pushed = push.status === 0;
      if (!pushed) {
        // The commit STANDS. Denying after a successful commit would leave
        // conductor's state disagreeing with git, and no later step can repair
        // that; a push that failed is an operator problem, loudly journaled.
        journal.log(
          "error",
          "state",
          "item.updated",
          { itemId, push: "failed", commit },
          { runId, itemId },
        );
      }
    }
  }

  // ---- worktree mode: merge back, then re-validate the INTEGRATED tree -----
  if (worktreeMode && commit !== null) {
    // §4.2 merge-back, serial in item order by construction (the driver's publish
    // stage is serial and this call is synchronous; the workspace index is a
    // singleton, §4.3). mergeBack verifies the branch identity, tries --ff-only
    // first, falls back to a normal merge, and aborts a conflicted merge before
    // returning — the workspace is never left mid-merge.
    const merged = mergeBack(root, runId, itemId, {
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
    });
    if (merged.conflict) {
      // §4.2: a conflict drops the LATER item to GREEN for re-validation through
      // the SHARED administrative helper (C-037 ruling 7) — never an fsm edge.
      // The earlier items' completed merges stand; this item's commit stays on
      // its own branch, untouched by the abort.
      demoteReviewedToGreen({
        store,
        runId,
        itemId,
        journal,
        reason:
          "the merge-back of branch conductor/" + runId + "/" + itemId + " conflicted with the integrated tree",
        hypothesis:
          "an earlier item's merge changed the same lines this item's branch changes; " +
          "re-validate against the integrated tree",
        now,
      });
      return publishDenial(
        "GREEN",
        PUBLISH_TOOL +
          ': the merge-back of item "' +
          itemId +
          '" conflicted with the integrated tree; the merge was aborted and the item is back at GREEN ' +
          "for re-validation (§4.2)",
        { staged, skipped, reverified, verifySeq, excluded, message },
      );
    }

    // §4.2 integration honesty: the item reaches PUBLISHED only after a green
    // verify of the INTEGRATED tree (cwd = the workspace, tree "main") — a green
    // in isolation is not a green in company. The completed merge STANDS either
    // way (the push-failure precedent: conductor's state never disagrees with
    // git history it cannot rewrite); a red holds back the ITEM, not the merge.
    const integratedExcluded = foreignRedSet(store, runId, queue, itemId, root);
    const integrated = runVerify(runDir, itemId, config, verifyScopePathsOf(queueItem), {
      cwd: root,
      excludeTestFiles: integratedExcluded,
      journal: evidenceJournalOf(journal),
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      runId,
      tree: STAGE_TREE,
      now,
    });
    if (integrated.refused) {
      return publishDenial(
        item.state,
        PUBLISH_TOOL +
          ': item "' +
          itemId +
          '" merged back but cannot re-validate the integrated tree: ' +
          integrated.reason,
        { staged, skipped, reverified, verifySeq, excluded, commit, message },
      );
    }
    const integratedRecord = integrated.record as VerifyEvidence;
    verifySeq = integratedRecord.seq;
    if (!integratedRecord.green) {
      demoteReviewedToGreen({
        store,
        runId,
        itemId,
        journal,
        reason: "the integrated-tree re-validate after merge-back went red",
        hypothesis:
          "the integrated tree fails where the worktree passed: " + verifyFailureText(integratedRecord),
        now,
      });
      return publishDenial(
        "GREEN",
        PUBLISH_TOOL +
          ": the integrated-tree re-validate failed after merge-back; the merge stands and the item " +
          "is back at GREEN for debugging (§4.2)",
        { staged, skipped, reverified, verifySeq, excluded, commit, message },
      );
    }

    if (!readOnly && gitMode === "commit-and-push") {
      const push = runReviewGit(root, ["push"]);
      pushed = push.status === 0;
      if (!pushed) {
        journal.log(
          "error",
          "state",
          "item.updated",
          { itemId, push: "failed", commit },
          { runId, itemId },
        );
      }
    }
  }

  appendPublishBatch(runDir, {
    itemId,
    tsMs: now(),
    mode: gitMode,
    files: staged,
    diff,
    suggestedMessage: message,
    skipped,
    verify: { seq: verifySeq, green: true },
  });

  // The edge was judged legal before any of this ran (see the top of the
  // handler). It is NOT re-asked here: a second consultation after the commit
  // could only report a refusal nothing can act on.
  item.state = "PUBLISHED";
  store.saveItem(runId, item);

  journal.log(
    "info",
    "state",
    "item.updated",
    { itemId, state: "PUBLISHED", commit, pushed, staged: staged.length, skipped: skipped.length, reverified },
    { runId, itemId },
  );

  return {
    ok: true,
    itemState: "PUBLISHED",
    denial: null,
    commit,
    pushed,
    message,
    staged,
    skipped,
    reverified,
    verifySeq,
    excluded,
    questionId: null,
  };
}

// ===========================================================================
// (12) conductor_report — the §3.2 closing report (Task 9.5b, plan lines
// 2667-2686). ONE writer with a MODE parameter, not two writers: the full and
// lite reports differ in section CONTENT only, and 9.5c's stop-report drives
// this same function in its stop mode.
// ===========================================================================

const REPORT_TOOL = "conductor_report";
const REPORT_FILE = "report.md";

export interface ReportInput {
  store: StateStore;
  // Taken for a uniform handler shape so the composition root can call every
  // handler alike, and deliberately UNUSED: a report dispatches nothing. Reading
  // it would be the bug, not ignoring it. OPTIONAL because handleOverride also
  // drives this writer (§2.9: every stop writes a report) and an over-budget
  // override has no fan-out engine in hand to satisfy a required field with.
  fanout?: Fanout;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  stateHome: string;
  workspaceKey: string;
  now?: () => number;
  // Task 7.2's fetchMetricsSummary, injected so the closing report never opens a
  // socket in a test. Fail-soft by contract: a null result renders a line, never
  // a throw and never a blocked report — a run that finished its work is not
  // held hostage by a metrics endpoint that is down.
  metrics?: () => Promise<MetricsSummary | null>;
}

export interface ReportResult {
  runState: RunState;
  // §3.2:1155's SECTION-CONTENT mode (full vs lite). The §2.9 stop-report is
  // the third mode of the same writer; it is reported by `stopReport` rather
  // than widening this field, and it never ran a verify (verifySeq null).
  mode: "full" | "lite";
  stopReport: boolean;
  reportPath: string;
  verifySeq: number | null;
  green: boolean;
  excluded: string[];
  staleRedAdded: string[];
  metricsAvailable: boolean;
  stop: { kind: string; reasonDisplay: string; tsMs: number } | null;
}

function reportSection(heading: string, lines: string[]): string {
  return "## " + heading + "\n\n" + (lines.length > 0 ? lines.join("\n") : "(none)") + "\n";
}

// The per-item disposition block every report mode shares (§3.2 full/lite and
// the §2.9 stop-report): id + FSM position as the block heading, the settled
// disposition, the red proof, review rounds, taints, and — for blocked or
// deferred items — the recorded REASON.
function reportItemLines(
  store: StateStore,
  runId: string,
  runDir: string,
  queue: Queue,
  publishEnabled: boolean,
): string[] {
  const itemLines: string[] = [];
  for (const entry of queue.items) {
    const persisted = store.loadItem(runId, entry.id);
    itemLines.push("### " + entry.id + " — " + persisted.state);
    const disposition =
      persisted.state === "PUBLISHED"
        ? "published"
        : persisted.deferred !== null
          ? "deferred"
          : persisted.blocked !== null
            ? "blocked"
            : publishEnabled
              ? "unfinished"
              : "terminated at REVIEWED (no-git)";
    itemLines.push("Disposition: " + disposition);

    const redRef = persisted.evidence.red ?? null;
    const red =
      redRef === null
        ? null
        : (readEvidenceAt(runDir, redRef.seq, { itemId: entry.id }) as Extract<
            EvidenceRecord,
            { kind: "red" }
          > | null);
    itemLines.push(
      red === null
        ? "Red proof: none"
        : "Red proof: seq " + String(red.seq) + " — " + red.command.join(" "),
    );
    itemLines.push("Review rounds: " + String(persisted.attempts.reviewRounds));
    itemLines.push("Taints: " + (persisted.taint.length === 0 ? "(none)" : JSON.stringify(persisted.taint)));
    if (persisted.blocked !== null) itemLines.push("Reason: " + persisted.blocked.reason);
    if (persisted.deferred !== null) itemLines.push("Reason: " + persisted.deferred.reason);
    itemLines.push("");
  }
  return itemLines;
}

// GAP-022: the §2.9 stop-report names the run's ONE disposition alongside the
// recorded kind, so an operator reading the artifact of a run that stopped
// mid-flight sees the same fact the closer decided on rather than a kind with no
// stated basis.
function stopReportDisposition(
  store: StateStore,
  runId: string,
  runDir: string,
  queue: Queue,
  publishEnabled: boolean,
): string {
  const items = queue.items.map((entry) => {
    const persisted = store.loadItem(runId, entry.id);
    return {
      id: entry.id,
      state: persisted.state,
      dependsOn: entry.dependsOn,
      blocked: persisted.blocked,
      deferred: persisted.deferred,
    };
  });
  const openQuestionIds = readQuestions(runDir)
    .filter((q) => q.answeredIso === null)
    .map((q) => q.id);
  const dispositions = dispositionsOf(items, { publishEnabled, openQuestionIds });
  return runDispositionOf([...dispositions.values()], { openQuestions: openQuestionIds.length });
}

// A report section that cannot be built says so and does not sink the artifact
// (ISSUE-061). A stop-report is the one artifact a broken run is entitled to, so
// "the report writer threw" is the one outcome that is never acceptable: the
// section that failed renders its own failure, and every other section still lands.
function softSection(heading: string, build: () => string[]): string {
  try {
    return reportSection(heading, build());
  } catch (err) {
    return reportSection(heading, [
      "(unavailable: " + (err instanceof Error ? err.message : String(err)) + ")",
    ]);
  }
}

function softLine(label: string, build: () => string): string {
  try {
    return label + ": " + build();
  } catch (err) {
    return label + ": (unavailable: " + (err instanceof Error ? err.message : String(err)) + ")";
  }
}

export interface EnsureTerminalReportInput {
  store: StateStore;
  /** Defaults to the workspace's current run. */
  runId?: string;
  journal: HandlerJournal;
  now?: () => number;
}

export interface EnsureTerminalReportResult {
  written: boolean;
  reportPath: string;
  /** Why the artifact was (or was not) written — the fact a caller journals. */
  reason: string;
}

/**
 * GAP-024's second half: EVERY terminal run leaves the §2.9 artifact.
 *
 * A run whose conductor was killed records no stop and writes no report — the
 * process that would have done both is gone — so the human is left with a run
 * directory and no statement of what happened to it. This is the sweep the next
 * open runs: if the current run already carries a stop but has no artifact
 * (ISSUE-061's throwing writer), or if the conductor that held the workspace
 * before this session is DEAD, report.md is written naming the run's disposition.
 *
 * It is deliberately NOT a stop recorder. Writing run.json here would make the
 * crashed run terminal on this sweep's authority, which would take ISSUE-066's
 * resume path away from a run a human may still answer; the artifact states what
 * is true and changes nothing.
 *
 * Every section is fail-soft, because the run dirs that need this most are exactly
 * the ones a kill left torn.
 */
export function ensureTerminalReport(input: EnsureTerminalReportInput): EnsureTerminalReportResult {
  const store = input.store;
  const now = input.now ?? Date.now;
  let runId = input.runId;
  if (runId === undefined) {
    let current: Run | null = null;
    try {
      current = store.currentRun();
    } catch {
      current = null;
    }
    if (current === null) return { written: false, reportPath: "", reason: "no current run" };
    runId = current.runId;
  }
  const runDir = handlerRunDir(store, runId);
  const reportPath = path.join(runDir, REPORT_FILE);
  if (existsSync(reportPath)) {
    return { written: false, reportPath, reason: "the run already has its artifact" };
  }

  let run: Run | null = null;
  try {
    run = store.loadRun(runId);
  } catch {
    run = null;
  }
  const prior = store.priorBeacon;
  const ownerGone =
    prior !== null && !pidStillRunning(prior.pid);
  const stopped = run !== null && run.stop !== null;
  if (!stopped && !ownerGone) {
    return { written: false, reportPath, reason: "the run's conductor is still live" };
  }

  const publishEnabled = isRepo(store.root);
  // The queue is READ ONCE and its failure is carried, not swallowed: a run dir a
  // kill left torn has no readable queue, and a report that quietly rendered an
  // empty one would state a disposition ("settled") drawn from items it could not
  // see. Every section built from the queue reports the failure instead.
  const queueRead = readQueue(runDir);
  const requireQueue = (): Queue => {
    if (queueRead.error !== null) throw queueRead.error;
    return queueRead.queue;
  };
  const parts: string[] = [
    "# conductor terminal report — run " + runId,
    "",
    stopped && run !== null && run.stop !== null
      ? "Stop kind: " + run.stop.kind + "\nReason: " + run.stop.reasonDisplay
      : "Stop kind: none recorded — the conductor that owned this run is gone (pid " +
        String(prior === null ? "unknown" : prior.pid) +
        (prior === null || prior.sessionID.length === 0 ? "" : ', session "' + prior.sessionID + '"') +
        "), so the run stopped without recording one",
    softLine("Run disposition", () =>
      stopReportDisposition(store, runId as string, runDir, requireQueue(), publishEnabled),
    ),
    "Closing verify: none — a terminal report proves no claim and re-runs nothing (§2.9)",
    "",
    softSection("Items", () =>
      reportItemLines(store, runId as string, runDir, requireQueue(), publishEnabled),
    ),
    softSection("Open questions", () => reportQuestionLines(runDir)),
    softSection("Questions answered", () => reportAnsweredQuestionLines(runDir)),
    softSection("Decisions", () => reportDecisionLines(runDir)),
  ];
  writeFileAtomicSync(reportPath, parts.join("\n") + "\n");
  input.journal.log(
    "warn",
    "state",
    "run.stop-report",
    {
      kind: stopped && run !== null && run.stop !== null ? run.stop.kind : "unrecorded",
      recovered: !stopped,
      ...(prior === null ? {} : { priorPid: prior.pid }),
      tsMs: now(),
    },
    { runId },
  );
  return {
    written: true,
    reportPath,
    reason: stopped ? "a stopped run had no artifact" : "the run's conductor is gone",
  };
}

// The run's queue, or the reason it could not be read. Absent and torn are both
// failures here: a run that never got a queue and a run whose queue a kill cut in
// half are both states the report must NAME rather than paper over.
function readQueue(runDir: string): { queue: Queue; error: Error | null } {
  try {
    return { queue: readJsonFileSync(path.join(runDir, "queue.json")) as Queue, error: null };
  } catch (err) {
    return {
      queue: { items: [] },
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

// A §6.2 question the model answered through the tool is RECORDED but not
// settled: the run it was blocking stays stopped until the operator's own
// artifact arrives. This is the one sentence that says so, written once and
// rendered by BOTH surfaces that report it — the §2.9 report's answered-question
// line and conductor_status's standing list. A reader who saw only "answered"
// would take the exchange for closed, and two spellings of the sentence would let
// one surface drift into saying something milder than the other.
function standingQuestionNotice(runId: string, questionId: string): string {
  return (
    "AWAITING OPERATOR CONFIRMATION (§6.2 human territory): the run stays stopped until " +
    "the operator's answer is dropped at " +
    answerDropPath(runId, questionId)
  );
}

function reportQuestionLines(runDir: string): string[] {
  return readQuestions(runDir)
    .filter((q) => q.answeredIso === null)
    .map((q) => "- " + q.id + " — " + q.question + " (answer at " + answerDropPath(q.runId, q.id) + ")");
}

// ISSUE-051's invisibility half. Every report mode filtered questions to
// `answeredIso === null`, so an ANSWERED question appeared in no report at all:
// a run could surface a blocking question, answer it itself, and proceed, leaving
// the artifact that describes the run silent about the whole exchange. Answered
// questions are rendered with their answer and the channel it arrived through, so
// a relayed answer and a human's own are distinguishable by reading the report.
function reportAnsweredQuestionLines(runDir: string): string[] {
  return readQuestions(runDir)
    .filter((q) => q.answeredIso !== null)
    .map(
      (q) =>
        "- " +
        q.id +
        " [" +
        provenanceLabel(q.answeredVia) +
        "] " +
        q.question +
        " => " +
        (q.answer ?? "") +
        (awaitsOperatorConfirmation(q) ? " — " + standingQuestionNotice(q.runId, q.id) : ""),
    );
}

function reportDecisionLines(runDir: string): string[] {
  return readDecisions(runDir).map(
    (d) => "- " + d.id + " (" + d.kind + ") " + d.question + " => " + d.choice + " — " + d.why,
  );
}

function reportStaleLines(queue: Queue, staleRedAdded: string[]): string[] {
  return staleRedAdded.map((file) => {
    const owner = queue.items.find((entry) =>
      entry.testScope.some((candidate) => normalizeRepoRel(candidate) === file),
    );
    return "- " + file + (owner === undefined ? "" : " (" + owner.id + ")");
  });
}

// GAP-029: every report states, as a POSITIVE witness, whether the router was
// actually CONTACTED for this run — a real MetricsSummary crossing the §4.4 seam —
// or ABSENT. Without this line a "router / no-router equivalence" claim (the G5
// tautology ISSUE-074 flagged) is trivially true: a report that never reads
// metrics is byte-identical to one whose router was down. The witness also renders
// the served totalRequests, so a run whose request count is implausibly low
// against the sub-sessions it launched reads as unrouted rather than silently so.
// totalRequests is read DEFENSIVELY: the seam hands over an UNVALIDATED
// MetricsSummary (ISSUE-139), so a malformed body that slipped the fail-soft parse
// renders "unknown" rather than a bare "undefined".
function reportMetricsSection(summary: MetricsSummary | null): string {
  const witness =
    summary === null
      ? "Router contact: ABSENT — no metrics summary crossed the §4.4 seam (router down, or the metrics seam was not wired)"
      : "Router contact: CONFIRMED — router served metrics (totalRequests=" +
        (typeof summary.totalRequests === "number" ? String(summary.totalRequests) : "unknown") +
        ")";
  const body = summary === null ? "(unavailable)" : JSON.stringify(summary, null, 2);
  return "## Metrics\n\n" + witness + "\n\n" + body + "\n";
}

export async function handleReport(input: ReportInput): Promise<ReportResult> {
  const { store, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);
  const root = store.root;

  // The queue read is deferred rather than fatal: a `done` report over an
  // unreadable queue is a bug and still throws below, while the §2.9 stop-report —
  // the artifact a CRASHED run owes the human — renders the queue-derived sections
  // as unavailable and hands over the rest (ISSUE-061).
  const queueRead = readQueue(runDir);
  const run = store.loadRun(runId);
  const trivial = run.classification !== null && run.classification.kind === "trivial";
  const mode: "full" | "lite" = trivial ? "lite" : "full";

  // §3.9 again, and from the SAME predicate the gate uses: with publish disabled
  // an item terminating at REVIEWED is settled; with git it still owes a publish.
  const publishEnabled = isRepo(root);

  // §2.9 STOP-REPORT mode, selected from the PERSISTED stop and nothing else: a
  // recorded stop means the recorder (the continuation engine, the fan-out
  // engine, or handleOverride) already decided how this run ends, and the
  // writer's whole job is to leave the artifact behind. Three consequences:
  //   - NO all-settled precondition — a stopped run is by definition unsettled
  //     (wedged, interrupted, env-broken), and enforcing §3.2's done-gate here
  //     would make the artifact unreachable in exactly the runs §2.9 serves;
  //   - NO closing verify — a stopped run has no claim to prove and may be
  //     mid-edit (§2.9), so nothing executes, nothing is quarantined, and the
  //     evidence ledger is untouched;
  //   - run.json is READ, never rewritten — the stop kind stays whatever the
  //     recorder wrote, least of all upgraded to `done`.
  if (run.stop !== null) {
    const stop = run.stop;
    const queue = queueRead.queue;
    const requireQueue = (): Queue => {
      if (queueRead.error !== null) throw queueRead.error;
      return queueRead.queue;
    };

    // §2.11 disclosure through the ONE shared helper the `done` path also calls.
    const staleRedAdded = registerStaleRed({
      store,
      runId,
      queue,
      reason: "left red when run " + runId + " terminated (§2.11)",
      now,
    });
    const summary = input.metrics === undefined ? null : await input.metrics();

    // ISSUE-061: every section is FAIL-SOFT here. A stopped run is the one run
    // entitled to an artifact — it is unsettled, possibly mid-edit, and the human
    // has nothing else to read — so a section that cannot be built (an item file a
    // crash never wrote, a torn ledger) renders its own failure and the rest of
    // the report still lands. A throwing writer left the run with no artifact at
    // all, which is the §2.9 promise broken in the exact case it was made for.
    const parts: string[] = [
      "# conductor stop-report — " + stop.kind + " — run " + runId,
      "",
      "Stop kind: " + stop.kind,
      "Reason: " + stop.reasonDisplay,
      softLine("Run disposition", () =>
        stopReportDisposition(store, runId, runDir, requireQueue(), publishEnabled),
      ),
      "Closing verify: none — a stop-report proves no claim and re-runs nothing (§2.9)",
      "",
      softSection("Items", () => reportItemLines(store, runId, runDir, requireQueue(), publishEnabled)),
      softSection("Open questions", () => reportQuestionLines(runDir)),
      softSection("Questions answered", () => reportAnsweredQuestionLines(runDir)),
      softSection("Decisions", () => reportDecisionLines(runDir)),
      softSection("Stale-red additions", () => reportStaleLines(requireQueue(), staleRedAdded)),
      reportMetricsSection(summary),
    ];

    const reportPath = path.join(runDir, REPORT_FILE);
    writeFileAtomicSync(reportPath, parts.join("\n"));

    journal.log(
      "info",
      "state",
      "run.stop-report",
      { kind: stop.kind, reasonDisplay: stop.reasonDisplay, staleRedAdded },
      { runId },
    );

    return {
      runState: run.state,
      mode,
      stopReport: true,
      reportPath,
      verifySeq: null,
      green: false,
      excluded: [],
      staleRedAdded,
      metricsAvailable: summary !== null,
      stop: { kind: stop.kind, reasonDisplay: stop.reasonDisplay, tsMs: stop.tsMs },
    };
  }

  // Past the stop branch this is a §3.2 closing report over a live run: an
  // unreadable queue here is a real fault and must not be papered over.
  if (queueRead.error !== null) throw queueRead.error;
  const queue = queueRead.queue;

  const items = queue.items.map((entry) => {
    const persisted = store.loadItem(runId, entry.id);
    return {
      id: entry.id,
      state: persisted.state,
      behavioral: entry.behavioral,
      dependsOn: entry.dependsOn,
      fileScope: entry.fileScope,
      blocked: persisted.blocked,
      deferred: persisted.deferred,
    };
  });

  // THE MANDATORY DEFERRED BINDING (C-018). This is a PRESENCE CHECK over the
  // persisted items, and it runs BEFORE any verify — because the closing verify
  // cannot answer it. An unsettled item below GREEN has its own red test in the
  // §4.2 exclusion set, so the verify would pass WITHOUT EVER EXECUTING the
  // failure that makes the run unfinished. Ordering it first is not an
  // optimization; it is the only order in which the check means anything.
  // GAP-022: the run's ONE disposition, derived from the SAME persisted state the
  // report precondition reads — item files plus the §2.11 ledger. The stop kind
  // this writer records is a function of it, so "what the report says" and "how
  // the run ended" can never be two different readings of one run.
  const openQuestionIds = readQuestions(runDir)
    .filter((q) => q.answeredIso === null)
    .map((q) => q.id);
  const dispositions = dispositionsOf(items, { publishEnabled, openQuestionIds });
  const runClosure = {
    disposition: runDispositionOf([...dispositions.values()], { openQuestions: openQuestionIds.length }),
    blockedItems: items.filter((item) => item.blocked !== null).length,
    openQuestions: openQuestionIds.length,
    advancedItems: items.filter(
      (item) => item.state === "PUBLISHED" || (!publishEnabled && item.state === "REVIEWED"),
    ).length,
    deferredItems: items.filter((item) => item.deferred !== null).length,
  };

  const settled = settledForReport(items, { publishEnabled });
  if (!settled.allSettled) {
    throw new Error(
      REPORT_TOOL +
        ": the run is not finished — " +
        settled.unsettled.join(", ") +
        " is neither published, blocked nor deferred (§3.2). No verify was run and no report was written.",
    );
  }

  // The closing verify: fresh, full, and over the WHOLE run — so it has no
  // subject item and nothing is privileged. Exclusions still apply, because a
  // report is legal with blocked items whose red tests are still on disk.
  //
  // Its §2.1 scopes are selected against the paths the RUN declares (every item's
  // testScope ∪ fileScope), through the SAME `requiredScopeNames` union every
  // other stage resolves with — the C-039 resolution. The selector matches each
  // requiredScopes PATTERN against a PATH, so a literal "**" handed in as the
  // path selects nothing unless a pattern happens to match that two-character
  // string, and `Object.values({}).every(...)` would then close the run REPORTED
  // on a verify that executed no command at all.
  const excluded = foreignRedSet(store, runId, queue, null);
  const scopePaths = runScopePaths(queue);
  // C-039 layer (b): a NAMED refusal before anything runs. A run whose paths no
  // §2.1 entry covers has no closing verify to give, and the report's whole claim
  // is that verify — so it is refused rather than written on nothing.
  if (requiredScopeNames(config, scopePaths).length === 0) {
    throw new Error(
      REPORT_TOOL +
        ": no verify.requiredScopes entry covers this run's declared paths " +
        JSON.stringify(scopePaths) +
        ", so the closing verify would run no scope at all (§2.1). No report was written.",
    );
  }
  const outcome = runVerify(runDir, runId, config, scopePaths, {
    cwd: root,
    excludeTestFiles: excluded,
    journal: evidenceJournalOf(journal),
    stateHome: input.stateHome,
    workspaceKey: input.workspaceKey,
    runId,
    tree: STAGE_TREE,
    now,
  });
  if (outcome.refused) {
    throw new Error(REPORT_TOOL + ": the closing verify could not run: " + outcome.reason);
  }
  const record = outcome.record as VerifyEvidence;
  // C-039 layer (c), the same belt-and-braces handleValidate carries: the run IS
  // covered, but every scope its §2.1 entries name is missing from verify.scopes,
  // so nothing executed. An empty scope map is not admissible evidence for closing
  // a run — `green` over it is vacuously true and would say the opposite.
  if (Object.keys(record.scopes).length === 0) {
    throw new Error(
      REPORT_TOOL +
        ": the closing verify ran no scope (this run's §2.1 required scopes name nothing " +
        "verify.scopes defines), so there is no evidence to close the run on",
    );
  }

  // §2.11 disclosure, through the ONE shared helper 9.5c also calls.
  const staleRedAdded = registerStaleRed({
    store,
    runId,
    queue,
    reason: "left red when run " + runId + " terminated (§2.11)",
    now,
  });

  const summary = input.metrics === undefined ? null : await input.metrics();

  // ---- report.md ---------------------------------------------------------
  const itemLines = reportItemLines(store, runId, runDir, queue, publishEnabled);
  const questionLines = reportQuestionLines(runDir);
  const answeredQuestionLines = reportAnsweredQuestionLines(runDir);
  const decisionLines = reportDecisionLines(runDir);
  const staleLines = reportStaleLines(queue, staleRedAdded);

  const batches = readPublishBatch(runDir);
  const skippedFromBatches = new Set<string>();
  for (const batch of batches) {
    for (const file of batch.skipped ?? []) skippedFromBatches.add(file);
  }
  const exclusionLines = [
    ...excluded.map((file) => "- excluded from the closing verify: " + file),
    ...[...skippedFromBatches].sort().map((file) => "- left out of its commit (preexisting dirty): " + file),
  ];

  const batchLines: string[] = [];
  for (const batch of batches) {
    batchLines.push("### " + batch.itemId + " (" + batch.mode + ")");
    batchLines.push("Suggested message:");
    batchLines.push(batch.suggestedMessage);
    batchLines.push("Files: " + batch.files.join(", "));
    batchLines.push("Diff:");
    batchLines.push(batch.diff);
    batchLines.push("");
  }

  // GAP-021 / MACRO-006: the stop kind is CHOSEN by the one closer over the run's
  // persisted dispositions, never asserted by this writer. Two members of §2.9's
  // closed vocabulary — `blocked` and `surfaced` — had no writer at all, so a run
  // whose every remaining item waited on a human closed "the run completed".
  //
  // The closing verify's result is CONSULTED here rather than merely rendered
  // (ISSUE-053, decision D5 STRICT): §3.2 calls it "verification-before-completion
  // made mechanical", and a law that cannot fail the completion is advisory. A red
  // closing verify maps to `blocked` or `env` by failure class and can never stamp
  // `done`. The verdict is computed BEFORE report.md is written so the artifact
  // and run.json carry the same answer.
  const verdict = stopKindOf(
    record.green
      ? { cause: "settle", run: runClosure }
      : {
          cause: "closing-verify-red",
          run: runClosure,
          failureClass: closingVerifyFailure(record.scopes),
        },
  );

  const parts: string[] = [
    "# conductor report — run " + runId,
    "",
    "Mode: " + mode,
    "Closing verify: " + (record.green ? "green" : "RED") + " (evidence seq " + String(record.seq) + ")",
    "Run disposition: " + runClosure.disposition,
    "Stop kind: " + verdict.kind + " — " + verdict.why,
    "",
    reportSection("Items", itemLines),
    reportSection("Open questions", questionLines),
    reportSection("Questions answered", answeredQuestionLines),
  ];

  // G10: a trivial run has no decision ledger to speak of, so an EMPTY section is
  // omitted entirely rather than rendered as "(none)" — lite reports do not carry
  // headings for machinery the run never used. A NON-empty ledger is always shown.
  if (!(mode === "lite" && decisionLines.length === 0)) {
    parts.push(reportSection("Decisions", decisionLines));
  }

  parts.push(reportSection("Stale-red additions", staleLines));
  parts.push(reportSection("Exclusions", exclusionLines));
  parts.push(reportMetricsSection(summary));
  parts.push(reportSection("Prepared batches", batchLines));

  const reportPath = path.join(runDir, REPORT_FILE);
  writeFileAtomicSync(reportPath, parts.join("\n"));

  // ---- close the run -----------------------------------------------------
  const target: RunState = trivial ? "TRIVIAL_DONE" : "REPORTED";
  // The from-state is READ off the run, never asserted (MACRO-004): this handler
  // used to hand the FSM the literal "EXECUTING", which made the edge legal for a
  // run it merely described — and the journal then recorded the same claim. A run
  // that reached this writer from DECOMPOSED closed `done` on that fiction.
  const edge = advanceRun(run, target, { classification: trivial ? "trivial" : "work" });
  if (!edge.ok) {
    throw new Error(REPORT_TOOL + ": " + edge.why);
  }

  const stop: { kind: StopKind; reasonDisplay: string; tsMs: number } = {
    kind: verdict.kind,
    reasonDisplay:
      verdict.why +
      ": " +
      String(queue.items.length) +
      " item(s), closing verify " +
      (record.green ? "green" : "RED"),
    tsMs: now(),
  };
  run.state = target;
  run.stop = stop;
  store.saveRun(run);

  journal.log(
    "info",
    "fsm",
    "transition",
    { from: edge.from, to: target, stop: stop.kind, why: edge.why },
    { runId },
  );

  return {
    runState: target,
    mode,
    stopReport: false,
    reportPath,
    verifySeq: record.seq,
    green: record.green,
    excluded,
    staleRedAdded,
    metricsAvailable: summary !== null,
    stop,
  };
}

// ===========================================================================
// (13) The §3.6 hatches (Task 9.5c, plan lines 2687-2698):
// conductor_inline_claim + conductor_override, plus the ONE derivation that
// turns a persisted claim into the §3.5 gate's inlineClaimScope input. The
// §2.9 stop-report path itself lives in handleReport (section 12) — the report
// writer has three modes and one implementation — and handleOverride's
// over-budget refusal only DRIVES it.
// ===========================================================================

const INLINE_CLAIM_TOOL = "conductor_inline_claim";
const OVERRIDE_TOOL = "conductor_override";

// §2.8 anomalies.jsonl: validate, then append one line. Called AHEAD of the
// rest of the triggering handler's writes (write-ahead), so a killed process
// still leaves its trace.
export function appendAnomaly(runDir: string, record: AnomalyRecord): void {
  const result = validate("AnomalyRecord", record);
  if (!result.ok) {
    throw new Error("tools: refusing to write an invalid AnomalyRecord: " + result.errors.join("; "));
  }
  mkdirSync(runDir, { recursive: true });
  appendFileSync(path.join(runDir, "anomalies.jsonl"), JSON.stringify(record) + "\n");
}

// ---------------------------------------------------------------------------
// conductor_inline_claim (§3.6)
// ---------------------------------------------------------------------------

export interface InlineClaimInput {
  store: StateStore;
  runId: string;
  journal: HandlerJournal;
  now?: () => number;
  itemId: string;
  reason: string;
  options: Array<{ name: string; score?: DecisionRecord["options"][number]["score"] }>;
  choice: string;
}

export interface InlineClaimResult {
  itemId: string;
  decisionId: string;
  // The claimed scope, read back through the ONE derivation the gate is fed
  // from, so this result and the gate cannot disagree about what was granted.
  fileScope: string[] | null;
}

/**
 * Why a claim over a behavioral item at PENDING is futile, and what the caller
 * should do instead.
 *
 * The exit is DERIVED, never asserted. conductor_submit_test is the item's stage
 * tool by the §3.3 table, but a blocked, deferred, dependency-unready or
 * pre-EXECUTING item is offered no stage tool at all — so naming it
 * unconditionally would answer a deadlock with a door locked from the other side,
 * which is the one thing gates-edit.ts says a refusal must never do. stageToolOffer
 * answers whether the gate opens that door, and stageDenyReason names the blocker
 * when it does not.
 */
function futilityRefusal(
  store: StateStore,
  runId: string,
  runDir: string,
  queue: Queue,
  claimEntry: QueueItem,
  item: Item,
): string {
  const run = store.loadRun(runId);
  const offer = stageToolOffer(SUBMIT_TEST_TOOL, store, runId, runDir, {
    run,
    queue,
    queueItem: claimEntry,
    item,
  });
  const exit = offer.offered
    ? 'Call ' +
      SUBMIT_TEST_TOOL +
      ' on "' +
      claimEntry.id +
      '": it DISPATCHES the test-writer that authors the failing test in testScope.'
    : SUBMIT_TEST_TOOL +
      ' is not open for "' +
      claimEntry.id +
      '" either — ' +
      offer.reason +
      ". That is the blocker to clear; the claim stays futile until it is.";
  return (
    'item "' +
    claimEntry.id +
    '" is behavioral and sits at PENDING, where the red it owes is written into testScope' +
    (claimEntry.testScope.length === 0
      ? ", which this queue entry leaves empty"
      : " (" + claimEntry.testScope.join(", ") + ")") +
    ". A claim grants this item's fileScope (" +
    claimEntry.fileScope.join(", ") +
    ") and nothing else (§3.6), and §2.4 holds those two scopes disjoint — so the claim cannot " +
    "license the write its own next step needs, and widening its scope to reach the test is " +
    "refused for that same reason. " +
    exit +
    " A claim becomes useful over this item once its red exists: from TEST_VETTED the " +
    "implementation lands inside the fileScope a claim grants. What it buys there is the " +
    "ORCHESTRATOR's own edit permission inside that scope, not a saved sub-session — " +
    "conductor_mark_green still dispatches its implementer for a claimed item and an unclaimed " +
    "one alike."
  );
}

/**
 * §3.6: grant the ORCHESTRATOR edit permission scoped to the claimed item's
 * fileScope, for work where dispatch is objectively more expensive than doing.
 * The claim is a §2.7 DERIVED decision (dispatching was the other option), so
 * it passes the SAME requireTwoOptions gate conductor_decide applies — and
 * legality precedes persist: a rejected claim writes NOTHING (no ledger line,
 * no item annotation, no widened scope). On accept: the ledger line first,
 * then the §2.5 {reason, decisionId} annotation pointing at it. The claim
 * changes WHO edits, never WHAT is enforced — the item FSM applies in full.
 */
export function handleInlineClaim(input: InlineClaimInput): InlineClaimResult {
  const { store, runId, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (1) legality before persist (§3.4): the item must exist...
  let item: Item;
  try {
    item = store.loadItem(runId, input.itemId);
  } catch {
    throw new Error(INLINE_CLAIM_TOOL + ': item "' + input.itemId + '" does not exist; refusing to claim');
  }

  // ...and the §2.4 queue entry the claim would grant must be readable. §3.6's
  // grant IS that entry's fileScope: inlineClaimScopeFor fails closed without it
  // and derives no scope at all, so a claim taken here would spend a §2.7 ledger
  // line and a §2.5 annotation on a grant of nothing. Refuse one step earlier,
  // with the same posture the derivation takes.
  const read = readQueue(runDir);
  const claimEntry = read.queue.items.find((candidate) => candidate.id === input.itemId);
  if (claimEntry === undefined) {
    throw new Error(
      INLINE_CLAIM_TOOL +
        ': item "' +
        input.itemId +
        '" has no entry in this run\'s queue.json' +
        (read.error === null ? "" : " (" + read.error.message + ")") +
        ", and §3.6 grants exactly that entry's fileScope — inlineClaimScopeFor would derive no scope " +
        "at all, so the claim would record a decision that grants nothing; refusing before it is taken",
    );
  }

  // ...and a claim that could never license its own next step is refused before it
  // is taken. A behavioral item at PENDING owes a proven red, and that red is
  // written into testScope; a claim grants the queue entry's fileScope and nothing
  // else (inlineClaimScopeFor), and §2.4 holds fileScope disjoint from testScope.
  // The scope the claim would grant therefore cannot cover the one write the item's
  // next step needs — a futility provable right here, from the queue entry and the
  // item's FSM position, before any of it is spent. The claim stays legal
  // everywhere else: on a non-behavioral item, and on a behavioral item past its
  // red, the work lands inside fileScope.
  if (claimEntry.behavioral && item.state === "PENDING") {
    throw new Error(INLINE_CLAIM_TOOL + ": " + futilityRefusal(store, runId, runDir, read.queue, claimEntry, item));
  }

  // ...and the claim's decision must be §2.7-legal BEFORE anything persists.
  const record: DecisionRecord = {
    id: mintDecisionId(runDir),
    tsIso: new Date(now()).toISOString(),
    question: "Work item " + input.itemId + " inline under an orchestrator claim instead of dispatching?",
    options: input.options.map((option) =>
      option.score === undefined ? { name: option.name } : { name: option.name, score: option.score },
    ),
    choice: input.choice,
    why: input.reason,
    kind: "derived",
    appliedWhere: "item " + input.itemId,
  };
  const gate = requireTwoOptions(record);
  if (!gate.ok) {
    throw new Error(INLINE_CLAIM_TOOL + ": " + gate.why);
  }
  assertDecisionValid(record);

  // (2) persist: the ledger line, then the annotation (handleDefer's order).
  appendDecision(runDir, record);
  item.inlineClaim = { reason: input.reason, decisionId: record.id };
  store.saveItem(runId, item);

  // (3) journal; (4) compact return.
  journal.log(
    "info",
    "state",
    "decision.recorded",
    { decisionId: record.id, kind: record.kind, itemId: input.itemId },
    { runId, itemId: input.itemId },
  );
  journal.log(
    "info",
    "state",
    "item.updated",
    { itemId: input.itemId, inlineClaim: true, decisionId: record.id },
    { runId, itemId: input.itemId },
  );

  return {
    itemId: input.itemId,
    decisionId: record.id,
    fileScope: inlineClaimScopeFor(store, runId, input.itemId),
  };
}

/**
 * The ONE derivation of an active inline claim's scope: the persisted §2.5 item
 * says WHETHER a claim is active, the §2.4 queue says WHAT the item's fileScope
 * is (§3.6: the claim scopes edit permission to exactly that), and BOTH the
 * plugin's permission adjudicator and the §5.3 gate feed the gate's
 * inlineClaimScope input from here — this build has watched a rule that lives
 * in two places drift five separate times. No claim (or no item, or no queue
 * entry) derives no scope at all: fail closed, never open.
 */
export function inlineClaimScopeFor(store: StateStore, runId: string, itemId: string): string[] | null {
  let item: Item;
  try {
    item = store.loadItem(runId, itemId);
  } catch {
    return null;
  }
  if (item.inlineClaim === null) return null;

  let queue: Queue;
  try {
    queue = readJsonFileSync(path.join(handlerRunDir(store, runId), "queue.json")) as Queue;
  } catch {
    return null;
  }
  const entry = queue.items.find((candidate) => candidate.id === itemId);
  if (entry === undefined) return null;
  return [...entry.fileScope];
}

// ---------------------------------------------------------------------------
// conductor_override (§3.6)
// ---------------------------------------------------------------------------

export interface OverrideInput {
  store: StateStore;
  runId: string;
  config: Config;
  journal: HandlerJournal;
  now?: () => number;
  sessionID: string;
  // The §3.5 registry role of the calling session. The composition root reads it
  // from the registry entry; the handler never asks the model for it, on the same
  // rule that makes itemId a registry fact rather than an argument.
  sessionRole: string;
  itemId: string;
  gate: string;
  reason: string;
  grantedAction: string;
  overrideGrants: Map<string, OverrideGrant>;
  stateHome: string;
  workspaceKey: string;
  metrics?: () => Promise<MetricsSummary | null>;
}

export interface OverrideResult {
  granted: boolean;
  itemId: string;
  gate: string;
  // Both §2.1 budget meters as persisted after the call.
  overridesUsedItem: number;
  overridesUsedRun: number;
  // On a refusal: the recorded §2.9 env stop and the stop-report it wrote.
  stop: Run["stop"];
  reportPath: string | null;
}

/**
 * §3.6: spend the override budget for a ONE-SHOT gate bypass with taint. The
 * budget check comes FIRST, against BOTH §2.1 meters (maxOverridesPerItem and
 * maxOverridesPerRun) — over EITHER, the refusal is atomic: an `env` stop plus
 * the stop-report (through the ONE writer, §2.9's normative rule) and NOTHING
 * else. No taint, no counter, no anomaly, no grant: a refused override is not
 * an override that happened, and half-recording one would make the report lie.
 *
 * Within budget: the §2.8 anomaly first (write-ahead), then the item's taint
 * entry + per-item meter, the run meter, and finally the one-shot grant into
 * the CALLER-owned map the §5.3 gate consumes from — keyed to
 * {sessionID, gate, itemId} and spent by the first decision it converts.
 */
export async function handleOverride(input: OverrideInput): Promise<OverrideResult> {
  const { store, runId, config, journal } = input;
  const now = input.now ?? Date.now;
  const runDir = handlerRunDir(store, runId);

  // (0) legality, and BEFORE the budget check because this refusal must cost
  // nothing (ISSUE-007): only "session", "git" and "edit" have a consumption
  // point in gateBeforeToolCall, so a grant for any other name can never be
  // converted — yet at HEAD it still tainted the item, appended the anomaly and
  // spent BOTH §2.1 meters. Two honest misspellings then exhausted the default
  // budget and the third recorded an `env` stop and ended the run. The hatch is
  // documented with a `phase-order` example it cannot serve, so the misspelling
  // is the DOCUMENTED use.
  if (!isOverrideGate(input.gate)) {
    throw new Error(unknownOverrideGateWhy(OVERRIDE_TOOL, input.gate));
  }

  // (0b) Task 21.6, and free for exactly ISSUE-007's reason: a reader role's edit
  // grant can never convert, because the opencode agent it is dispatched under
  // denies edit before this gate is reached. Refusing it here costs nothing —
  // no meter, no taint, no anomaly, no stop.
  if (!readerMayOverrideGate(input.sessionRole, input.gate)) {
    throw new Error(readerEditOverrideWhy(OVERRIDE_TOOL, input.sessionRole));
  }

  // (1) legality: the item must exist...
  let item: Item;
  try {
    item = store.loadItem(runId, input.itemId);
  } catch {
    throw new Error(OVERRIDE_TOOL + ': item "' + input.itemId + '" does not exist; refusing to override');
  }
  const run = store.loadRun(runId);

  // ...and the budget check precedes every write (§3.6).
  const maxItem = config.workflow.maxOverridesPerItem;
  const maxRun = config.workflow.maxOverridesPerRun;
  const exhausted: string[] = [];
  if (item.attempts.overridesUsed >= maxItem) {
    exhausted.push(
      'item "' + input.itemId + '" has used ' + String(item.attempts.overridesUsed) +
        " of maxOverridesPerItem " + String(maxItem),
    );
  }
  if (run.counters.overridesUsed >= maxRun) {
    exhausted.push(
      "the run has used " + String(run.counters.overridesUsed) +
        " of maxOverridesPerRun " + String(maxRun),
    );
  }

  if (exhausted.length > 0) {
    const stop: Run["stop"] = {
      kind: "env",
      reasonDisplay:
        "override budget exhausted: " + exhausted.join("; ") +
        " — over budget is an env stop, not another override (§3.6)",
      tsMs: now(),
    };
    run.stop = stop;
    store.saveRun(run);
    // The hatch's own decision, under the §7.4 name for a gate saying no: an
    // override request that meets an exhausted budget is refused, and `gates:
    // deny` is what a refusal by the gate system is called.
    journal.log(
      "warn",
      "gates",
      "deny",
      { gate: input.gate, itemId: input.itemId, reason: "override budget exhausted", exhausted },
      { runId, itemId: input.itemId, sessionID: input.sessionID },
    );

    // §2.9: every stop writes a report — through the ONE writer, which selects
    // stop mode from the stop this handler just recorded.
    const report = await handleReport({
      store,
      runId,
      config,
      journal,
      stateHome: input.stateHome,
      workspaceKey: input.workspaceKey,
      now,
      metrics: input.metrics,
    });

    return {
      granted: false,
      itemId: input.itemId,
      gate: input.gate,
      overridesUsedItem: item.attempts.overridesUsed,
      overridesUsedRun: run.counters.overridesUsed,
      stop,
      reportPath: report.reportPath,
    };
  }

  // (2) persist: anomaly FIRST (§2.8 write-ahead), then taint + both meters.
  const tsMs = now();
  appendAnomaly(runDir, {
    ts: tsMs,
    kind: "override",
    itemId: input.itemId,
    gate: input.gate,
    reason: input.reason,
    grantedAction: input.grantedAction,
  });
  item.taint.push({
    tsMs,
    kind: "override",
    gate: input.gate,
    reason: input.reason,
    grantedAction: input.grantedAction,
  });
  item.attempts.overridesUsed += 1;
  store.saveItem(runId, item);
  run.counters.overridesUsed += 1;
  store.saveRun(run);

  // (3) the one-shot grant, into the caller-owned map the gate consumes from.
  input.overrideGrants.set(overrideGrantKey(input.sessionID, input.gate, input.itemId), {
    sessionID: input.sessionID,
    gate: input.gate,
    itemId: input.itemId,
    reason: input.reason,
    grantedAction: input.grantedAction,
    tsMs,
  });

  // (4) journal; (5) compact return. A granted override is NOT a stop: the run
  // stays live and no report is written.
  journal.log(
    "warn",
    "gates",
    "override-granted",
    {
      itemId: input.itemId,
      gate: input.gate,
      grantedAction: input.grantedAction,
      overridesUsedItem: item.attempts.overridesUsed,
      overridesUsedRun: run.counters.overridesUsed,
    },
    { runId, itemId: input.itemId, sessionID: input.sessionID },
  );

  return {
    granted: true,
    itemId: input.itemId,
    gate: input.gate,
    overridesUsedItem: item.attempts.overridesUsed,
    overridesUsedRun: run.counters.overridesUsed,
    stop: null,
    reportPath: null,
  };
}

// ---------------------------------------------------------------------------
// (12.2) conductor_setup — first-run repo setup (plan 2890-2913).
//
// The ONE handler that takes no StateStore and no runId. adapter/state.ts
// OpenOptions REQUIRES a Config, and a Config is exactly what setup produces, so
// the first-run path cannot go through openWorkspace at all: handleSetup reads
// and writes the workspace directly, journals through a runId-OPTIONAL sink
// (the shape adapter/state.ts StateJournal already defines for the lock/beacon
// events that precede any run), and never takes the run lock.
//
// TWO PHASES, because §2.1:622's two questions have NO default. A call WITHOUT
// every required answer runs detection + the smoke spawn, returns the proposals
// and the open asks, and WRITES NOTHING. A call carrying every required answer
// additionally runs the three §2.1:628-632 live proofs and — only if all of them
// pass — writes .conductor/config.json atomically. The proofs run against the
// CANDIDATE config in memory: §2.1:634 makes a failed check a setup FAILURE, and
// core/gates-phase.ts keys the whole tool surface off the file's presence, so a
// half-proven config on disk is strictly worse than no config at all.
//
// An out-of-contract CALL throws (the committed handleX convention): an
// already-configured repo without reconfigure:true, and a reconfigure while a run
// is live. A failed setup CHECK returns {ok:false, written:false, failures:[…]}
// so every named remedy is narrated at once.
// ---------------------------------------------------------------------------

// The tiny schema the §2.1:630 probe constrains its request with AND validates
// its reply against — ONE object at both ends, resolved through core validate()
// like every other §2 artifact. Registering it widens no §2 schema: SCHEMAS is
// deliberately a mutable name→schema record (core/types.ts), and this is a PROBE
// schema, not an artifact one.
export const SETUP_PROBE_SCHEMA_NAME = "SetupProbe";

const SETUP_PROBE_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

SCHEMAS[SETUP_PROBE_SCHEMA_NAME] = SETUP_PROBE_SCHEMA;

// §2.1:483's example scope timeout, applied to every proposed scope.
const SETUP_SCOPE_TIMEOUT_MS = 600000;
// A scope's sourceGlob is what setupRequiredScopes turns into that scope's
// requiredScopes pattern in a MULTI-ecosystem repo, so it has to name the files
// the ecosystem actually owns rather than the directory its sources usually sit
// in. Two ecosystems both claiming "src/**" leave lib/, include/ and test/
// covered by nothing, and an item no requiredScopes entry covers has no
// constructible test command at all (itemVerifyScope raises on it).
const NODE_SOURCE_GLOB = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const CMAKE_SOURCE_GLOB = "**/*.{c,cc,cpp,cxx,h,hh,hpp,hxx,cmake}";
// The smoke probe's own kill timeout. A probe exists to answer "can this be
// spawned at all"; one that hangs has answered nothing and must never wedge setup.
const SETUP_SMOKE_TIMEOUT_MS = 10000;
// The representative testScope the itemTest templates are substituted against
// before their argv[0] is probed (P6): a template is only probeable once its
// §2.1 tokens are gone.
const SETUP_REPRESENTATIVE_TEST_FILES = ["pkg/example/example_test.go"];
// The §2.1:499 pytest default, and the C-003 fallback interpreters tried in order
// when its argv[0] is not on this machine's PATH.
const SETUP_PYTEST_INTERPRETERS = ["python3", "python"];

const ASK_GIT_MODE = "git.mode";
const ASK_BEHAVIORAL_PATHS = "verify.behavioralPaths";
const ASK_GIT_INIT = "git.init";

export interface SetupAnswers {
  gitMode?: GitMode;
  behavioralPaths?: string[];
  initRepo?: boolean;
  // The §2.1 TDD law's kill switch, made explicit. A behavioralPaths list that
  // names none of the source this repo actually has turns RED-before-GREEN off
  // for every item; setup refuses it unless the caller says so in this word, and
  // the word is journaled with the rest of the answered values.
  acknowledgeNoTdd?: boolean;
}

// One §6.2:1875 sanctioned interactive ask. These are the handler's RESULT, not
// §2.11 questions: adapter/questions.ts is keyed to a run dir setup has not got,
// and QUESTION_ORIGINS has no setup origin — widening it would file a workspace
// question under a run that does not exist.
export interface SetupAsk {
  id: string;
  question: string;
  options: string[];
  proposal: string[] | null;
}

// A detected ecosystem's proposal. `command`/`timeoutMs`/`itemTest` are the §2.1
// scope fields verbatim; `ecosystem`, `behavioralPaths` and `sourceGlob` ride
// alongside so a multi-ecosystem repo cannot silently overwrite one scope with
// another and each requiredScopes pattern has a source.
export interface ProposedScope {
  name: string;
  ecosystem: string;
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
  behavioralPaths: string[];
  sourceGlob: string;
}

// One smoke probe, recorded so "the check covers every command" is verifiable
// rather than asserted: a scope command and its itemTest almost always share an
// argv[0], so a count would not distinguish "both probed" from "one probed".
export interface SmokeProbe {
  source: string;
  argv0: string;
  ok: boolean;
}

export interface SetupProposals {
  scopes: ProposedScope[];
  behavioralPaths: string[];
  requiredScopes: Array<{ pattern: string; scopes: string[] }>;
  notes: string[];
  smoked: SmokeProbe[];
}

export interface ConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}

// The workspace-level journal sink (adapter/state.ts StateJournal's shape): runId
// is OPTIONAL because setup precedes every run.
export interface SetupJournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
}

export interface SetupInput {
  root: string;
  journal: SetupJournalSink;
  router: { listen: { host: string; port: number }; probeTimeoutMs: number };
  upstream: { host: string; port: number };
  failoverState: FailoverState;
  reconfigure?: boolean;
  answers?: {
    gitMode?: GitMode;
    behavioralPaths?: string[];
    initRepo?: boolean;
    acknowledgeNoTdd?: boolean;
  };
  // The session's served model id when the caller knows it (Task 12.1 does).
  modelId?: string;
  now?: () => number;
}

export interface SetupResult {
  ok: boolean;
  written: boolean;
  repoConfigured: boolean;
  isRepo: boolean;
  asks: SetupAsk[];
  proposals: SetupProposals;
  config: Config | null;
  failures: string[];
  diff: ConfigChange[] | null;
}

function setupIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Read + parse a JSON file, or null when it is absent or unreadable. Setup reads
// the TARGET repo's files, which it does not own: a package.json it cannot parse
// is a repo fact, not a conductor fault.
function setupReadJsonFile(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return setupIsRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setupReadTextFile(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// The §2.1 git modes, read off the REGISTERED schema rather than restated here,
// so the ask can never offer a mode the config would reject.
function setupGitModes(): string[] {
  const schema = SCHEMAS.Config as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const gitProperties = properties.git.properties as Record<string, Record<string, unknown>>;
  const modes = gitProperties.mode.enum;
  return Array.isArray(modes) ? modes.map((mode) => String(mode)) : [];
}

// ONE spawn probe: [argv0, "--version"], shell:false, under evidence.childEnv,
// with closed stdin and a bounded kill. The verdict is SPAWNABILITY alone — a
// command that exists and exits non-zero (`go --version` exits 2 on a perfectly
// good toolchain) has answered the question the plan asks. `error` is set when
// the process could not be spawned at all, and when the kill timeout fired.
function setupSmokeProbe(
  root: string,
  source: string,
  argv0: string,
  smoked: SmokeProbe[],
): boolean {
  const result = spawnSync(argv0, ["--version"], {
    cwd: root,
    env: childEnv(),
    timeout: SETUP_SMOKE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const ok = result.error === undefined;
  smoked.push({ source, argv0, ok });
  return ok;
}

function setupUnspawnableFailure(argv0: string, source: string): string {
  return (
    `setup: the command "${argv0}" (${source}) could not be spawned on this machine — ` +
    "remedy: install it, put it on PATH, or correct the command in .conductor/config.json " +
    "before running conductor_setup again"
  );
}

// The node leg's template rule (P7). evidence.detectRunner falls back to the node
// profile for EVERY unrecognized command, so keying the attachment on it would
// staple `node --test {files}` onto a jest repo — the silent wrong answer §2.1's
// absent-template fallback exists to avoid. Recognition is the argv itself.
function setupIsNodeCommand(command: string[]): boolean {
  if (command.length === 0) return false;
  const base = path.basename(command[0]).toLowerCase();
  return base.startsWith("node") || command.includes("--test");
}

// pyproject.toml's project name, as the python behavioralPaths package dir. A
// deliberately narrow read: the first `name = "…"` line, which is what §2.1's
// detection needs and all a proposal the human must confirm should claim.
function setupPyprojectPackage(text: string): string | null {
  const match = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text);
  if (match === null) return null;
  return match[1].replace(/-/g, "_");
}

interface SetupDetection {
  scopes: ProposedScope[];
  notes: string[];
  // Each detected ecosystem's OWN source glob — the extension set that ecosystem
  // owns — captured before setupCoverEveryPath widens scope.sourceGlob into the
  // brace union that routes uncovered kinds. Two different questions read these:
  // "which scope must run when this path changes" is answered by the widened
  // pattern, and "is this path this repo's SOURCE" only ever by these.
  detectedSourceGlobs: string[];
}

// The directories a coverage walk never descends into: version control, the
// conductor state dir the config being written lives in, and the dependency and
// build trees an ecosystem regenerates. expandScopeEntry skips the first three
// for the same reason — nothing an item declares as its scope lives inside them.
//
// Every setup judgment that needs a file list reads it through setupWalkRepoFiles,
// so the requiredScopes widening and the GAP-015 coverage floor share ONE universe:
// setup never accepts an answer on the strength of a tree it does not itself walk.
const SETUP_UNWALKED_DIRS = new Set([
  ".git",
  ".conductor",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  "build",
  "dist",
  ".cache",
]);

// The coverage walk is BOUNDED. It exists to learn which kinds of file a repo
// holds, and a tree big enough to reach this cap named every one of them long
// before it; an unbounded walk would be a way for one pathological checkout to
// wedge setup on a machine conductor does not own.
const SETUP_WALK_FILE_CAP = 20000;

interface SetupDirEntry {
  name: string;
  isDir: boolean;
}

// One directory listing, fail-soft. Setup reads the TARGET repo, which it does
// not own: a directory it cannot list is a repo fact, not a conductor fault, and
// must not throw out of detection.
function setupReadDir(dir: string): SetupDirEntry[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDir: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

// Every file in the repo, repo-relative with "/" separators, minus the trees
// above. Recursion follows Dirent.isDirectory(), which is false for a SYMLINK to
// a directory — so a symlink cycle cannot spin the walk, and a symlinked file is
// still counted as the file it appears to be.
function setupWalkRepoFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dirRel: string): void => {
    for (const entry of setupReadDir(dirRel.length === 0 ? root : path.join(root, dirRel))) {
      if (found.length >= SETUP_WALK_FILE_CAP) return;
      if (SETUP_UNWALKED_DIRS.has(entry.name)) continue;
      const childRel = dirRel.length === 0 ? entry.name : dirRel + "/" + entry.name;
      if (entry.isDir) walk(childRel);
      else found.push(childRel);
    }
  };
  walk("");
  return found;
}

// The glob covering a path's KIND rather than the path itself: its extension
// where it has one, its whole name where it does not. Keyed on the kind so the
// written pattern still covers the next doc page or shell script the repo grows;
// a pattern keyed on the literal paths one walk happened to see would go stale
// the moment anything was added. A name carrying glob metacharacters would make
// the derived pattern match something other than the file it came from, so it
// contributes no coverage rather than wrong coverage.
function setupCoverageGlob(relPath: string): string | null {
  const slash = relPath.lastIndexOf("/");
  const base = slash === -1 ? relPath : relPath.slice(slash + 1);
  if (base.length === 0 || GLOB_META.test(base)) return null;
  const dot = base.lastIndexOf(".");
  if (dot > 0 && dot < base.length - 1) return "**/*" + base.slice(dot);
  return "**/" + base;
}

// The multi-ecosystem branch's coverage guarantee. Each ecosystem's source glob
// names the files that ecosystem OWNS, which is what routes an item's targeted
// test to the right runner — but a repo is not only sources. Its README, its
// docs, its build files and its scripts sit outside every ecosystem's extension
// set, and a path no requiredScopes entry covers has no constructible test
// command at all: the item raises at itemVerifyScope, the full verify raises at
// handleValidate, and the closing report raises at handleReport. The
// single-ecosystem branch has never had that hole, because "**" makes every path
// owe the only scope.
//
// This is the same rule generalized: a path no detected ecosystem owns owes EVERY
// detected scope, because setup cannot know which of them a change to a doc, a
// build file or a script breaks. It is folded into each ecosystem's OWN glob
// rather than added as a separate catch-all entry so the per-ecosystem routing
// survives — an extra entry whose pattern was "**" would make every source owe
// every scope too, and the routing would be decoration.
function setupCoverEveryPath(root: string, scopes: ProposedScope[], notes: string[]): void {
  // One ecosystem already writes "**" (setupRequiredScopes), which covers the
  // tree by construction; zero is refused by handleSetup rather than papered over.
  if (scopes.length < 2) return;
  const owned = scopes.map((scope) => scope.sourceGlob);
  const unowned: string[] = [];
  for (const rel of setupWalkRepoFiles(root)) {
    if (owned.some((glob) => globMatch(glob, rel))) continue;
    const kind = setupCoverageGlob(rel);
    if (kind === null || unowned.includes(kind)) continue;
    unowned.push(kind);
  }
  if (unowned.length === 0) return;
  unowned.sort();
  for (const scope of scopes) {
    scope.sourceGlob = "{" + scope.sourceGlob + "," + unowned.join(",") + "}";
  }
  notes.push(
    `coverage: ${unowned.join(", ")} belong to no detected ecosystem, so they are added to ` +
      "EVERY scope's requiredScopes pattern — setup cannot know which ecosystem a change to a " +
      "doc, a build file or a script breaks, and a path no entry covers has no test command at all",
  );
}

// The §2.1:620 detection matrix. Every proposal is an argv ARRAY (never a shell
// string), carries the §2.1:499 itemTest default for its runner (cargo has none,
// and none is invented), and is proposed — never written — until the human
// answers.
function setupDetect(root: string, smoked: SmokeProbe[]): SetupDetection {
  const scopes: ProposedScope[] = [];
  const notes: string[] = [];

  const pkg = setupReadJsonFile(path.join(root, "package.json"));
  if (pkg !== null) {
    const scripts = setupIsRecord(pkg.scripts) ? pkg.scripts : {};
    const scriptTest = typeof scripts.test === "string" ? scripts.test : null;
    let command: string[] = ["node", "--test"];
    if (scriptTest !== null) {
      const tokens = shellTokens(scriptTest);
      if (tokens.length > 0) {
        command = tokens;
        notes.push(`node: verify command taken from package.json scripts.test (${scriptTest})`);
      }
    }
    const scope: ProposedScope = {
      name: "node",
      ecosystem: "node",
      command,
      timeoutMs: SETUP_SCOPE_TIMEOUT_MS,
      behavioralPaths: ["src/**", "lib/**"],
      sourceGlob: NODE_SOURCE_GLOB,
    };
    if (setupIsNodeCommand(command)) {
      scope.itemTest = ["node", "--test", "{files}"];
    } else {
      notes.push(
        `node: ${command[0]} is not node's own runner, so no itemTest template is proposed ` +
          "(§2.1's absent-template fallback runs the whole scope command instead)",
      );
    }
    scopes.push(scope);
  }

  const cmakeText = setupReadTextFile(path.join(root, "CMakeLists.txt"));
  if (cmakeText !== null && cmakeText.includes("enable_testing")) {
    scopes.push({
      name: "cmake",
      ecosystem: "cmake",
      command: ["ctest"],
      timeoutMs: SETUP_SCOPE_TIMEOUT_MS,
      itemTest: ["ctest", "-R", "{name}"],
      behavioralPaths: ["src/**", "include/**"],
      sourceGlob: CMAKE_SOURCE_GLOB,
    });
    notes.push(
      "cmake: `ctest` is proposed unqualified — most CMake projects run it from a build " +
        "directory, and setup guesses none rather than pointing the scope at a directory that " +
        "may not exist",
    );
  }

  const pyproject = setupReadTextFile(path.join(root, "pyproject.toml"));
  if (pyproject !== null) {
    // C-003: §2.1:499's `pytest {files}` is the FIRST choice, and it is MEASURED
    // rather than assumed — bare pytest is not on every machine's PATH (it is not
    // on this one). Only a genuinely failed probe swaps in an interpreter, and the
    // swap is named in the notes rather than made silently.
    let command = ["pytest"];
    let itemTest = ["pytest", "{files}"];
    const bareOk = setupSmokeProbe(root, "verify.scopes.python.command(§2.1 default)", "pytest", smoked);
    if (bareOk) {
      notes.push("python: the §2.1:499 default `pytest {files}` is spawnable here and is used as-is");
    } else {
      let chosen: string | null = null;
      for (const interpreter of SETUP_PYTEST_INTERPRETERS) {
        const probe = spawnSync(interpreter, ["-m", "pytest", "--version"], {
          cwd: root,
          env: childEnv(),
          timeout: SETUP_SMOKE_TIMEOUT_MS,
          killSignal: "SIGKILL",
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        });
        if (probe.error === undefined && probe.status === 0) {
          chosen = interpreter;
          break;
        }
      }
      if (chosen !== null) {
        command = [chosen, "-m", "pytest"];
        itemTest = [chosen, "-m", "pytest", "{files}"];
        notes.push(
          `python: bare \`pytest\` is not on PATH here, so the scope runs pytest through ` +
            `${chosen} (-m pytest); evidence.detectRunner reads that argv as the pytest profile, ` +
            "so nothing downstream sees a different runner",
        );
      } else {
        notes.push(
          "python: neither bare `pytest` nor an interpreter carrying `-m pytest` could be " +
            "spawned here, so the §2.1:499 default is proposed unchanged and will fail its " +
            "smoke check until pytest is installed",
        );
      }
    }
    const pkgDir = setupPyprojectPackage(pyproject);
    scopes.push({
      name: "python",
      ecosystem: "python",
      command,
      timeoutMs: SETUP_SCOPE_TIMEOUT_MS,
      itemTest,
      behavioralPaths: [pkgDir === null ? "**/*.py" : `${pkgDir}/**`],
      // The scope's coverage is every .py file, not just the declared package
      // directory: a test module beside it is still python's to verify.
      sourceGlob: "**/*.py",
    });
  }

  if (existsSync(path.join(root, "go.mod"))) {
    // §2.1:503-506: the template targets package DIRS. `-run` matches test
    // FUNCTION names, so handed file basenames it exits 0 having run zero tests —
    // a green that proves nothing. No go argv this matrix proposes carries it.
    scopes.push({
      name: "go",
      ecosystem: "go",
      command: ["go", "test", "./..."],
      timeoutMs: SETUP_SCOPE_TIMEOUT_MS,
      itemTest: ["go", "test", "{dirs}"],
      behavioralPaths: ["**/*.go"],
      sourceGlob: "**/*.go",
    });
  }

  if (existsSync(path.join(root, "Cargo.toml"))) {
    // No itemTest: §2.1 pins no cargo template, and inventing one would be a
    // guess the human is not asked to confirm. No fifth RUNNER_PROFILE either —
    // that is a §2.6.1 classification change, and detectRunner's conservative
    // node fallback bins an unfamiliar cargo failure as `error`, the safe bin.
    scopes.push({
      name: "cargo",
      ecosystem: "cargo",
      command: ["cargo", "test"],
      timeoutMs: SETUP_SCOPE_TIMEOUT_MS,
      behavioralPaths: ["src/**"],
      sourceGlob: "**/*.rs",
    });
  }

  // Captured BEFORE the widening, because the widening destroys it: once
  // setupCoverEveryPath has folded **/README.md and **/*.toml into every scope's
  // sourceGlob there is no longer any record of which extensions an ecosystem
  // actually owns, and the GAP-015 coverage clause needs exactly that record.
  const detectedSourceGlobs = scopes.map((scope) => scope.sourceGlob);
  setupCoverEveryPath(root, scopes, notes);

  for (const scope of scopes) {
    notes.push(
      `${scope.name}: failures from this scope classify under the ` +
        `${detectRunner(scope.command).runner} runner profile (§2.6.1)`,
    );
  }
  return { scopes, notes, detectedSourceGlobs };
}

// One requiredScopes entry per detected scope. With exactly one ecosystem the
// pattern is "**", which leaves no path uncovered by construction; with several,
// each entry's pattern is that ecosystem's own source glob — widened by
// setupCoverEveryPath until the globs between them cover the whole tree, because
// extensions alone cover a repo's SOURCES and a repo is not only sources.
function setupRequiredScopes(scopes: ProposedScope[]): Array<{ pattern: string; scopes: string[] }> {
  if (scopes.length === 1) return [{ pattern: "**", scopes: [scopes[0].name] }];
  return scopes.map((scope) => ({ pattern: scope.sourceGlob, scopes: [scope.name] }));
}

// The §2.1:620 markers setupDetect keys on, named in the refusal below so the
// operator is told exactly what would have to exist for setup to characterise the
// repo rather than being told only that something was missing.
const SETUP_ECOSYSTEM_MARKERS =
  "package.json (node), a CMakeLists.txt calling enable_testing() (cmake), pyproject.toml " +
  "(python), go.mod (go) or Cargo.toml (cargo)";

// A repo setup could not characterise. Writing what detection actually found —
// no scopes and an EMPTY requiredScopes — is the worst available outcome: it
// validates, so nothing downstream catches it, and then every stage that needs a
// test command raises on it, on a repo conductor_setup is no longer legal to
// re-run. Setup refuses instead, and invents no verify command it cannot prove.
function setupNoCoverageFailure(root: string): string {
  return (
    `setup: no ecosystem could be detected in ${root} — none of ${SETUP_ECOSYSTEM_MARKERS} is ` +
    "present, so setup has no verify scope to propose and no verify.requiredScopes coverage to " +
    "write. It will not write an empty one: SCHEMAS.Config declares no minItems, so " +
    "`requiredScopes: []` VALIDATES and then leaves every item without a constructible test " +
    "command (submit_test, vet_test, mark_green and item_review all raise on it) on a repo " +
    "conductor_setup is no longer legal to re-run without reconfigure:true. Nothing was written, " +
    "so this repo stays unconfigured and setup may be run again. Remedy: add the manifest of the " +
    "ecosystem this repo builds with and run conductor_setup again, or write " +
    ".conductor/config.json by hand with a verify.scopes entry and a verify.requiredScopes entry " +
    "whose pattern covers the paths that scope verifies"
  );
}

// How many uncovered files the refusal quotes back. Enough to recognise what was
// missed, not enough to bury the remedy sentence under a file listing.
const SETUP_COVERAGE_NAMED = 5;

// What the answered behavioralPaths list actually covers, judged on MATCHED FILES.
//
// `covered`/`uncovered` are real repository paths that the detected ecosystems'
// source globs match; `sourceFilesFound` says whether there was any evidence to
// judge on at all.
//
// The evidence is setupWalkRepoFiles — the SAME walk detection itself ran, honouring
// SETUP_UNWALKED_DIRS — and every file it yields is judged. Both halves are the
// clause, not implementation taste:
//
//   ONE UNIVERSE. Judged instead against a walk that skips only .git/.conductor/
//   node_modules, a repo's generated or vendored trees are evidence detection never
//   saw: `["dist/**"]` against a bundled dist/ "covered" a repo whose actual sources
//   are all under src/, and the repo-wide TDD kill walked through the floor wearing
//   a path this very function had just refused to walk into.
//
//   NO TRUNCATION. Judged against a bounded slice of a SORTED expansion, every
//   source sorting past the bound is invisible, and invisibility reads as
//   uncovered: a repo with a few hundred files under aaa/ refused the honest answer
//   `["zzz/**"]` for the one source at zzz/late.mjs. Matching answered globs against
//   a file list is string work — the walk's own SETUP_WALK_FILE_CAP is the only
//   bound this needs, and it bounds the WALK rather than the judgment.
//
// The globs are the DETECTED ones (SetupDetection.detectedSourceGlobs), never
// scope.sourceGlob. On a multi-ecosystem repo setupCoverEveryPath has already
// rewritten every scope.sourceGlob into a brace union folding in the kinds no
// ecosystem owns — **/README.md, **/*.toml, **/*.json — so that no path is left
// without a requiredScopes entry. That union answers a ROUTING question. Read as
// the definition of "source file" it made a doc file count as coverage, and
// `["README.md"]` bought a config in which every item under src/ was legally
// behavioral:false: the repo-wide TDD kill again, through the clause written to
// refuse it. The single-ecosystem repo, whose glob is never widened, refused the
// same answer all along — which is why the hole was multi-ecosystem-only.
interface SetupBehavioralCoverage {
  covered: string[];
  uncovered: string[];
  sourceFilesFound: boolean;
}

function setupBehavioralCoverage(
  root: string,
  detectedSourceGlobs: readonly string[],
  answeredPaths: readonly string[],
): SetupBehavioralCoverage {
  const sourceGlobs = detectedSourceGlobs.map((glob) => normalizeRepoRel(glob));
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const rel of setupWalkRepoFiles(root)) {
    if (!sourceGlobs.some((glob) => globMatch(glob, rel))) continue;
    if (answeredPaths.some((glob) => globMatch(glob, rel))) covered.push(rel);
    else uncovered.push(rel);
  }
  // The judgment above is already complete; this orders only the handful of names
  // the refusal quotes, so the same repo always reports the same ones.
  uncovered.sort();
  return { covered, uncovered, sourceFilesFound: covered.length + uncovered.length > 0 };
}

function setupMergedBehavioralPaths(scopes: ProposedScope[]): string[] {
  const merged: string[] = [];
  for (const scope of scopes) {
    for (const glob of scope.behavioralPaths) {
      if (!merged.includes(glob)) merged.push(glob);
    }
  }
  return merged;
}

// Smoke-spawn every command the config would RECORD: each scope command, each
// scope itemTest (substituted, so no §2.1 token reaches the probe), and every
// format rule (setup proposes none, but a reconfigure inherits the ones already
// in the file).
function setupSmokeAll(
  root: string,
  scopes: ProposedScope[],
  formatRules: Config["format"]["rules"],
  smoked: SmokeProbe[],
): string[] {
  const failures: string[] = [];
  for (const scope of scopes) {
    const commandSource = `verify.scopes.${scope.name}.command`;
    if (!setupSmokeProbe(root, commandSource, scope.command[0], smoked)) {
      failures.push(setupUnspawnableFailure(scope.command[0], commandSource));
    }
    const itemTest = scope.itemTest;
    if (itemTest !== undefined) {
      const itemTestSource = `verify.scopes.${scope.name}.itemTest`;
      const substituted = substituteItemTest(itemTest, SETUP_REPRESENTATIVE_TEST_FILES);
      if (substituted.length > 0 && !setupSmokeProbe(root, itemTestSource, substituted[0], smoked)) {
        failures.push(setupUnspawnableFailure(substituted[0], itemTestSource));
      }
    }
  }
  for (let i = 0; i < formatRules.length; i += 1) {
    const rule = formatRules[i];
    const source = `format.rules[${String(i)}].command`;
    if (rule.command.length === 0) continue;
    if (!setupSmokeProbe(root, source, rule.command[0], smoked)) {
      failures.push(setupUnspawnableFailure(rule.command[0], source));
    }
  }
  return failures;
}

interface SetupHttpResult {
  status: number;
  body: string;
}

// A single bounded, fail-soft JSON request. It NEVER rejects: a refused
// connection, a socket error, or a hang past probeTimeoutMs all resolve null, so
// the CALLER decides what a failed request means (a dead router is a failover; a
// dead upstream is a failed proof). The router-client's httpGet is GET-only and
// module-private, so this is the same discipline written for the POST the schema
// probe needs — not a second policy.
function setupHttpJson(
  origin: string,
  pathName: string,
  method: "GET" | "POST",
  payload: Record<string, unknown> | null,
  timeoutMs: number,
): Promise<SetupHttpResult | null> {
  return new Promise<SetupHttpResult | null>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: SetupHttpResult | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };

    let url: URL;
    try {
      url = new URL(pathName, origin);
    } catch {
      finish(null);
      return;
    }
    const body = payload === null ? null : JSON.stringify(payload);
    const headers: Record<string, string> =
      body === null
        ? {}
        : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) };

    const req = httpRequest(
      { host: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", () => {
          req.destroy();
          finish(null);
        });
      },
    );
    req.on("error", () => {
      finish(null);
    });
    timer = setTimeout(() => {
      req.destroy();
      finish(null);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    if (body !== null) req.write(body);
    req.end();
  });
}

// One proof request against the §4.4 origin. A DOWN ROUTER IS NOT A SETUP
// FAILURE (G5): the first failed request latches the session onto the upstream
// through the committed noteRouterFailure and the request is re-made against the
// origin resolveBaseUrl then yields. Only what the proofs themselves prove false
// fails setup.
//
// The `failover` record is written HERE, with a literal component and event, and
// noteRouterFailure is called without its optional sink: forwarding a sink that
// passes the event name through as a variable would make this call site invisible
// to the §7.4 source audit, which is the one guard that sees journal names no
// test drives.
async function setupProofRequest(
  input: SetupInput,
  pathName: string,
  method: "GET" | "POST",
  payload: Record<string, unknown> | null,
): Promise<SetupHttpResult | null> {
  const timeoutMs = input.router.probeTimeoutMs;
  const first = resolveBaseUrl(input.router, input.upstream, input.failoverState);
  const result = await setupHttpJson(first, pathName, method, payload, timeoutMs);
  if (result !== null) return result;

  // The latch is a HERD guard, not an answer. §2.1:631 issues maxReaders requests
  // together, so when a router dies mid-fan-out every one of them fails against the
  // router and they resume one at a time: the first to resume latches the session,
  // and the rest find `useUpstream` already true. Treating that latch as "this
  // request is finished" returned null for every reader but the first — the healthy
  // upstream was never asked, and a router outage was reported as a llama-server
  // slot shortage. A request that resumes behind the latch instead goes STRAIGHT to
  // the upstream `resolveBaseUrl` now names: it neither re-notes the failover (the
  // router failed once, not once per reader) nor re-probes the dead origin (the
  // thundering herd the latch exists to prevent). `second === first` below is still
  // the equality proof that a retry would hit the same origin twice.
  if (!input.failoverState.useUpstream) {
    noteRouterFailure(input.failoverState);
    input.journal.log(
      "warn",
      "router-client",
      "failover",
      {
        failovers: input.failoverState.failovers,
        probingDisabled: input.failoverState.probingDisabled,
        origin: first,
        path: pathName,
      },
      {},
    );
  }
  const second = resolveBaseUrl(input.router, input.upstream, input.failoverState);
  if (second === first) return null;
  return await setupHttpJson(second, pathName, method, payload, timeoutMs);
}

function setupParseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

// §2.1:629 — the served model list, or null when the origin could not answer.
async function setupServedModels(input: SetupInput): Promise<string[] | null> {
  const res = await setupProofRequest(input, "/v1/models", "GET", null);
  if (res === null || res.status !== 200) return null;
  const parsed = setupParseJson(res.body);
  if (!setupIsRecord(parsed) || !Array.isArray(parsed.data)) return null;
  const ids: string[] = [];
  for (const entry of parsed.data) {
    if (setupIsRecord(entry) && typeof entry.id === "string") ids.push(entry.id);
  }
  return ids;
}

// §2.1:630 — ONE tiny schema-constrained request, sent DIRECT (never through
// opencode's prompt path, which adapter/wire-notes.md proved emits neither
// `format` nor `response_format` at 1.18.15) and non-streaming. PASS is "the
// reply validates against the probe's schema": a model that ignores the
// constraint but answers correctly passes, and an EMPTY completion — measured on
// this repo's weights, C-058 — does not.
async function setupSchemaProbe(input: SetupInput, model: string): Promise<string | null> {
  const res = await setupProofRequest(input, "/v1/chat/completions", "POST", {
    model,
    messages: [
      {
        role: "user",
        content: 'Reply with exactly this JSON object and nothing else: {"ok": true}',
      },
    ],
    stream: false,
    max_tokens: 256,
    response_format: {
      type: "json_schema",
      json_schema: { name: SETUP_PROBE_SCHEMA_NAME, strict: true, schema: SETUP_PROBE_SCHEMA },
    },
  });
  if (res === null) {
    return (
      "setup proof (§2.1:630): the schema-constrained probe request never completed — " +
      "remedy: start the served model (or the router) and run conductor_setup again"
    );
  }
  if (res.status !== 200) {
    return (
      `setup proof (§2.1:630): the schema-constrained probe returned HTTP ${String(res.status)} — ` +
      "remedy: check the served origin's log; a server that refuses response_format cannot be " +
      "trusted with the schema-shaped stages"
    );
  }
  const parsed = setupParseJson(res.body);
  let content: string | null = null;
  if (setupIsRecord(parsed) && Array.isArray(parsed.choices) && parsed.choices.length > 0) {
    const choice = parsed.choices[0];
    if (setupIsRecord(choice) && setupIsRecord(choice.message) && typeof choice.message.content === "string") {
      content = choice.message.content;
    }
  }
  if (content === null || content.trim().length === 0) {
    return (
      "setup proof (§2.1:630): the schema-constrained probe came back EMPTY (a 200 with no " +
      "content) — a model that spends its whole budget and returns nothing can never produce " +
      "structured output; remedy: raise the served model's token budget, or serve a model that " +
      "honours response_format"
    );
  }
  const reply = setupParseJson(content);
  if (reply === undefined) {
    return (
      "setup proof (§2.1:630): the schema-constrained probe came back unconstrained — the reply " +
      `is not JSON at all (${content.slice(0, 120)}); remedy: serve a model that honours ` +
      "response_format json_schema"
    );
  }
  const verdict = validate(SETUP_PROBE_SCHEMA_NAME, reply);
  if (!verdict.ok) {
    return (
      "setup proof (§2.1:630): the schema-constrained probe came back unconstrained — the reply " +
      `does not validate against the probe schema (${verdict.errors.join("; ")}); remedy: serve a ` +
      "model that honours response_format json_schema"
    );
  }
  return null;
}

// The remedy every §2.1:631 failure ends with. --parallel alone divides the
// existing total context by the new slot count (C-058 F3), so the two flags are
// always named together.
function setupSlotRemedy(maxReaders: number): string {
  return (
    `Remedy: restart llama-server with --parallel ${String(maxReaders)}, and raise --ctx-size ` +
    "with it: --ctx-size is the TOTAL context divided among the slots, so adding slots alone " +
    "shrinks every slot's window"
  );
}

// llama-server publishes its own slot count at GET /props (total_slots): the
// SERVER's report of its capacity rather than an inference from a stopwatch.
//
// /props is NOT under /v1, and the router proxies ONLY /v1/.*
// (router/router.hpp:104-108) — every other path falls through to httplib's own
// 404. A router that answers the /v1 proofs and 404s /props is HEALTHY, so this
// read retries the upstream origin directly instead of failing setup, and it does
// NOT call noteRouterFailure: latching the session onto the upstream over a
// routing fact would take the router out of the loop for the rest of the run.
async function setupServedSlotCount(input: SetupInput): Promise<number | null> {
  const timeoutMs = input.router.probeTimeoutMs;
  const proofOrigin = resolveBaseUrl(input.router, input.upstream, input.failoverState);
  const upstreamOrigin = `http://${input.upstream.host}:${String(input.upstream.port)}`;
  const origins =
    proofOrigin === upstreamOrigin ? [proofOrigin] : [proofOrigin, upstreamOrigin];
  for (const origin of origins) {
    const res = await setupHttpJson(origin, "/props", "GET", null, timeoutMs);
    if (res === null || res.status !== 200) continue;
    const parsed = setupParseJson(res.body);
    if (setupIsRecord(parsed) && typeof parsed.total_slots === "number") return parsed.total_slots;
  }
  return null;
}

// §2.1:631 — the slot proof, in two legs, neither of them a stopwatch.
//
// LEG 1 is the plan's own mechanism: parallel.maxReaders concurrent trivial
// completions, issued together against /v1/chat/completions — the one path a
// router proxies, so the proof reaches the server through the same origin the run
// will use. Every reader must come back served; an origin that refuses, drops or
// errors one under a maxReaders-wide fan-out cannot hold the run's readers open,
// and the failure names how many it did serve.
//
// LEG 2 is the capacity number itself, read from the server (setupServedSlotCount
// above). Leg 1 alone cannot see a server that ACCEPTS every reader and then
// queues them internally — llama-server does exactly that at --parallel 1 — so the
// count llama-server publishes is what turns "all six were accepted" into "all six
// can actually run".
async function setupSlotProof(
  input: SetupInput,
  maxReaders: number,
  model: string,
): Promise<string | null> {
  const readers = maxReaders > 1 ? maxReaders : 1;
  if (model.length > 0) {
    const results = await Promise.all(
      Array.from({ length: readers }, (_unused, index) =>
        setupProofRequest(input, "/v1/chat/completions", "POST", {
          model,
          messages: [{ role: "user", content: `Reply with the digit ${String(index + 1)}.` }],
          stream: false,
          max_tokens: 1,
        }),
      ),
    );
    const served = results.filter((res) => res !== null && res.status === 200).length;
    if (served < readers) {
      return (
        `setup proof (§2.1:631): of ${String(readers)} concurrent readers the served origin ` +
        `held only ${String(served)} open, and parallel.maxReaders is ${String(maxReaders)} — ` +
        "the fan-out would serialize against a server that cannot hold its readers open. " +
        setupSlotRemedy(maxReaders)
      );
    }
  }

  const slots = await setupServedSlotCount(input);
  if (slots === null) {
    return (
      "setup proof (§2.1:631): neither the served origin nor the upstream answered GET /props " +
      "with a total_slots, so the slot count is unknown — remedy: serve the model through " +
      `llama-server (which publishes total_slots) and start it with --parallel ${String(maxReaders)} ` +
      "plus a matching --ctx-size"
    );
  }
  if (slots < maxReaders) {
    return (
      `setup proof (§2.1:631): the served origin reports ${String(slots)} slots but ` +
      `parallel.maxReaders is ${String(maxReaders)} — the fan-out would serialize against a ` +
      "server that cannot hold its readers open. " +
      setupSlotRemedy(maxReaders)
    );
  }
  return null;
}

// Flatten a config to dotted key paths, arrays and scalars as leaves, so a diff
// names the field a human would edit (`git.mode`) rather than the object holding it.
function setupFlattenConfig(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (setupIsRecord(value)) {
    for (const [key, inner] of Object.entries(value)) {
      setupFlattenConfig(inner, prefix.length === 0 ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  out.set(prefix, value);
}

function setupConfigDiff(before: Config, after: Config): ConfigChange[] {
  const from = new Map<string, unknown>();
  const to = new Map<string, unknown>();
  setupFlattenConfig(before, "", from);
  setupFlattenConfig(after, "", to);
  const keys = [...new Set([...from.keys(), ...to.keys()])].sort();
  const changes: ConfigChange[] = [];
  for (const key of keys) {
    const oldValue = from.get(key);
    const newValue = to.get(key);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ key, from: oldValue ?? null, to: newValue ?? null });
    }
  }
  return changes;
}

// The §2.1 config in force, or null for all three of: absent, unparseable, and
// failing validate("Config"). ONE derivation on top of task-let 5.4a's reader, so
// the gate's `repoConfigured` and this handler can never disagree — a corrupt
// config REOPENS setup rather than opening every gate on an unvalidated object.
function setupCurrentConfig(root: string): Config | null {
  try {
    const loaded = loadConfig(root);
    return loaded.repoConfigured ? loaded.config : null;
  } catch {
    return null;
  }
}

// The reconfigure guard's "no live run" predicate, read off the persisted run
// rather than through openWorkspace — opening a workspace would take the very
// lock the guard is testing for.
function setupLiveRunId(root: string): string | null {
  const pointerPath = path.join(root, ".conductor", "state", "current-run.json");
  if (!existsSync(pointerPath)) return null;
  let pointer: unknown;
  try {
    pointer = readJsonFileSync(pointerPath);
  } catch {
    return null;
  }
  if (!setupIsRecord(pointer) || typeof pointer.runId !== "string") return null;
  const runId = pointer.runId;
  const runPath = path.join(root, ".conductor", "runs", runId, "run.json");
  let run: unknown;
  try {
    run = readJsonFileSync(runPath);
  } catch {
    // A pointer naming a run that cannot be read is not evidence of NO run, and
    // reconfiguring under a live run is what this guard exists to prevent.
    throw new Error(
      `conductor_setup: refusing to reconfigure — ${runPath} names the current run but could ` +
        "not be read, so whether a run is live cannot be established",
    );
  }
  return isTerminal(run as Run) ? null : runId;
}

export async function handleSetup(input: SetupInput): Promise<SetupResult> {
  const root = input.root;
  const now = input.now ?? Date.now;
  const answers: SetupAnswers = input.answers ?? {};
  const reconfigure = input.reconfigure === true;

  // (1) legality (§3.2 / §3.4). Setup RUNS while the config is absent — that is
  // the state in which core/gates-phase.ts legalizes only conductor_setup and
  // conductor_status — and REFUSES on a configured repo without reconfigure:true.
  const existing = setupCurrentConfig(root);
  if (existing !== null && !reconfigure) {
    throw new Error(
      `conductor_setup: ${configPath(root)} already configures this repo — pass ` +
        "reconfigure:true to re-run setup (§3.4); setup writes nothing otherwise",
    );
  }
  if (reconfigure) {
    const liveRunId = setupLiveRunId(root);
    if (liveRunId !== null) {
      throw new Error(
        `conductor_setup: refusing to reconfigure while run ${liveRunId} is live (§3.4) — ` +
          "finish or stop that run first; the config it started under stays byte-identical",
      );
    }
  }

  // (2) §3.9: a workspace that is not a repo gets ONE choice, and no git.mode
  // question (no-git forces the mode). `initialize` runs git init from the
  // HANDLER — never a model session — after which the SAME call continues down
  // the ordinary git-repo path.
  const asks: SetupAsk[] = [];
  let repoNow = isRepo(root);
  let noGit = false;
  if (!repoNow) {
    if (answers.initRepo === undefined) {
      asks.push({
        id: ASK_GIT_INIT,
        question:
          `${root} is not a git repository. Conductor can initialize one here, or run in ` +
          "no-git mode (§3.9): no-git forces git.mode read-only and parallel writes off, and " +
          "publish stays unavailable because there is nothing to commit to.",
        options: ["initialize a repo here", "run in no-git mode"],
        proposal: null,
      });
    } else if (answers.initRepo) {
      initRepo(root);
      repoNow = isRepo(root);
    } else {
      noGit = true;
    }
  }

  // (3) detection + the smoke sweep. Both run on EVERY call, answered or not, so
  // the human sees what setup found before being asked to confirm anything.
  const smoked: SmokeProbe[] = [];
  const detection = setupDetect(root, smoked);
  const scopes = detection.scopes;
  const proposedPaths = setupMergedBehavioralPaths(scopes);
  const formatRules = existing === null ? [] : existing.format.rules;
  const smokeFailures = setupSmokeAll(root, scopes, formatRules, smoked);
  const proposals: SetupProposals = {
    scopes,
    behavioralPaths: proposedPaths,
    requiredScopes: setupRequiredScopes(scopes),
    notes: detection.notes,
    smoked,
  };

  const unconfigured = (
    partial: Partial<SetupResult> & { failures: string[] },
  ): SetupResult => ({
    ok: false,
    written: false,
    repoConfigured: existing !== null,
    isRepo: repoNow,
    asks,
    proposals,
    config: null,
    diff: null,
    ...partial,
  });

  if (asks.length > 0) return unconfigured({ failures: smokeFailures });

  // (4) the two §2.1:622 questions that have NO default. Neither value is ever
  // silently defaulted: a call short of either answer re-returns the missing ask
  // and writes nothing.
  if (!noGit && answers.gitMode === undefined) {
    asks.push({
      id: ASK_GIT_MODE,
      question:
        "Which git mode should conductor use in this repo? It has no default (§2.1:622): " +
        "read-only never writes git state, commit commits each published item, and " +
        "commit-and-push also pushes.",
      options: setupGitModes(),
      proposal: null,
    });
  }
  if (answers.behavioralPaths === undefined) {
    const goDetected = scopes.some((scope) => scope.ecosystem === "go");
    const caveat = goDetected
      ? " The go proposal is the positive glob **/*.go; §2.1 asks for **/*.go minus " +
        "**/*_test.go, which a list of positive globs cannot express, so narrow it here if " +
        "the *_test.go files should not owe a behavioral test."
      : "";
    asks.push({
      id: ASK_BEHAVIORAL_PATHS,
      question:
        "Confirm the paths whose changes require a behavioral test (§2.1:622). It has no " +
        `default: this proposal is what detection found, not a decision.${caveat}`,
      options: ["confirm the proposal", "supply a corrected list"],
      proposal: [...proposedPaths],
    });
  }
  if (asks.length > 0) return unconfigured({ failures: smokeFailures });

  if (smokeFailures.length > 0) return unconfigured({ failures: smokeFailures });

  // (4b) COVERAGE, before the proofs so a repo setup cannot characterise is
  // refused without opening a socket. verify.requiredScopes is what gives every
  // later stage a test command to construct; with no ecosystem detected there is
  // no honest one to write, and the empty array that detection produces is the one
  // outcome that both validates and wedges the repo. The refusal names what could
  // not be detected and leaves the repo unconfigured, which is the whole
  // difference between a repo that can be set up again and one that cannot.
  if (proposals.requiredScopes.length === 0) {
    return unconfigured({ failures: [setupNoCoverageFailure(root)] });
  }

  // (4c) THE DEGENERATE-CONFIG FLOOR (GAP-015). `behavioralPaths` is the whole
  // reach of the §2.1 TDD law: `behavioral:false` is legal for an item exactly
  // when its fileScope is disjoint from this list, and the ∅-intersection is
  // vacuously true — so an empty list (or one naming nothing this repo's detected
  // ecosystems own) makes EVERY item legally non-behavioral and skips RED→vet→GREEN
  // repo-wide in a single tool call. The only gate before this was
  // `answers.behavioralPaths === undefined`, which `[]` walks straight through.
  //
  // Coverage is judged on MATCHED FILES, and it has to be. The obvious spelling —
  // ask core scopesIntersect whether the answered list intersects each detected
  // sourceGlob — is VACUOUS here, because every sourceGlob detection produces
  // ("**/*.{js,…,ts,…}", "**/*.py", "**/*.go", …) is wildcard-headed: its literal
  // head is empty, so the conservative head-prefix rule calls it an intersection
  // with any non-empty list whatsoever. ["docs/**"] on a repo whose only source is
  // src/index.mjs passed that clause, which left `[]` as the only degeneracy the
  // floor could actually see. Asked against the files the globs really match, the
  // clause states what it always meant to: is there ANY source file in this repo
  // that this list would make behavioral.
  //
  // A repo with a detected ecosystem but no source file YET (a fresh scaffold) has
  // no evidence to judge on, and refusing it would wedge exactly the greenfield case
  // conductor exists to work in — so with no source files found the clause falls back
  // to "the list must at least be non-empty", which is the degeneracy the floor was
  // written for. The escape is a WORD, not a silence: `acknowledgeNoTdd:true` is a
  // deliberate answer, and it rides into the journal with the rest of them below.
  //
  // The evidence globs are the ones DETECTION produced, not the ones
  // setupCoverEveryPath left on the scopes: the widened brace union exists to route
  // a change to a doc or a build file at some scope, and reading it as "source"
  // let ["README.md"] cover a multi-ecosystem repo whose sources are all under
  // src/. Routing keeps the widened patterns (requiredScopes below is built from
  // them); this clause keeps the detected extension sets.
  const answeredPaths = answers.behavioralPaths ?? [];
  const coverage = setupBehavioralCoverage(root, detection.detectedSourceGlobs, answeredPaths);
  const covers = coverage.sourceFilesFound ? coverage.covered.length > 0 : answeredPaths.length > 0;
  if (!covers && answers.acknowledgeNoTdd !== true) {
    const missed = coverage.uncovered.slice(0, SETUP_COVERAGE_NAMED);
    return unconfigured({
      failures: [
        "setup: verify.behavioralPaths " +
          JSON.stringify(answeredPaths) +
          (answeredPaths.length === 0
            ? " is EMPTY, so no path in this repo requires a behavioral test"
            : " matches no source file this repo has: it covers none of " +
              missed.join(", ") +
              (coverage.uncovered.length > missed.length
                ? " (and " + String(coverage.uncovered.length - missed.length) + " more)"
                : "") +
              ", which is what the detected ecosystems own (" +
              detection.detectedSourceGlobs.join(", ") +
              ")") +
          " — every item would be legally behavioral:false and the whole repo would run " +
          "PENDING->GREEN with no test at all (§2.1/§2.4). Supply a list that covers this " +
          "repo's source, or pass answers.acknowledgeNoTdd:true to configure it anyway; " +
          "setup will not turn the TDD law off by accident.",
      ],
    });
  }

  // (5) the candidate config, built from task-let 5.4a's single exported default
  // rather than a second literal (two defaults that drift are invisible to both
  // tasks' tests). Only what setup detected or the human answered is overwritten.
  const candidate: Config = structuredClone(DEFAULT_CONFIG);
  const scopeMap: Config["verify"]["scopes"] = {};
  for (const scope of scopes) {
    const entry: Config["verify"]["scopes"][string] = {
      command: [...scope.command],
      timeoutMs: scope.timeoutMs,
    };
    // No buildCommand: setup DETECTS test commands and does not detect build
    // ones, so proposing a build step would be inventing a command nobody named.
    // The key validates and adapter/evidence.ts runs it, so an operator whose
    // scope needs a build adds it by hand — see docs/user/configuration.md.
    if (scope.itemTest !== undefined) entry.itemTest = [...scope.itemTest];
    scopeMap[scope.name] = entry;
  }
  candidate.verify.scopes = scopeMap;
  candidate.verify.requiredScopes = proposals.requiredScopes.map((entry) => ({
    pattern: entry.pattern,
    scopes: [...entry.scopes],
  }));
  candidate.verify.behavioralPaths = [...(answers.behavioralPaths ?? [])];
  candidate.format.rules = formatRules.map((rule) => ({
    pattern: rule.pattern,
    mode: rule.mode,
    command: [...rule.command],
  }));
  if (noGit) {
    // §3.9 in CONFIG terms, and nothing more: Config has no noGit field, no
    // publish switch and no worktree switch, and additionalProperties:false would
    // reject an invented one. No-git stays a runtime gitio.isRepo derivation —
    // the same one publish's refusal keys on — so it means one thing everywhere.
    candidate.git.mode = "read-only";
    candidate.parallel.writes = "off";
  } else if (answers.gitMode !== undefined) {
    candidate.git.mode = answers.gitMode;
  }

  // (6) the §2.1:628-632 proofs, against the candidate IN MEMORY. §2.1:634: a
  // failed check is a setup failure with a named remedy, never a warning.
  const failures: string[] = [];
  const served = await setupServedModels(input);
  if (served === null) {
    failures.push(
      "setup proof (§2.1:629): the served origin did not answer GET /v1/models — remedy: start " +
        "the model server (or the router) and run conductor_setup again",
    );
  } else if (input.modelId !== undefined) {
    if (!served.includes(input.modelId)) {
      failures.push(
        `setup proof (§2.1:629): models.default "${input.modelId}" is not served — the origin ` +
          `lists ${served.join(", ")}; remedy: serve that model, or set models.default in ` +
          ".conductor/config.json to one of the listed ids",
      );
    } else {
      candidate.models.default = input.modelId;
    }
  } else if (served.length === 1) {
    candidate.models.default = served[0];
  } else {
    failures.push(
      `setup proof (§2.1:629): models.default cannot be derived — the origin serves ` +
        `${served.length === 0 ? "no models at all" : served.join(", ")}; remedy: set ` +
        "models.default in .conductor/config.json (setup never guesses among served weights)",
    );
  }

  if (candidate.models.default.length > 0) {
    const schemaFailure = await setupSchemaProbe(input, candidate.models.default);
    if (schemaFailure !== null) failures.push(schemaFailure);
  }

  const slotFailure = await setupSlotProof(
    input,
    candidate.parallel.maxReaders,
    candidate.models.default,
  );
  if (slotFailure !== null) failures.push(slotFailure);

  if (failures.length > 0) return unconfigured({ failures });

  const validation = validate("Config", candidate);
  if (!validation.ok) {
    return unconfigured({
      failures: [
        "setup: the candidate config does not validate against the §2.1 schema: " +
          validation.errors.join("; "),
      ],
    });
  }

  // (7) persist — atomically, and only now that every proof has passed.
  const diff = existing === null ? null : setupConfigDiff(existing, candidate);
  writeFileAtomicSync(configPath(root), JSON.stringify(candidate, null, 2));
  // §1.2/§3.9: registerConductorExclude writes nothing when root is not a repo,
  // so the no-git branch needs no separate skip.
  registerConductorExclude(root);

  // (8) journal. A reconfigure records its DIFF — the changed keys with their old
  // and new values, and an empty change set when nothing changed, because "the
  // config was rewritten and nothing moved" is itself a fact replay needs.
  //
  // The ANSWERED VALUES ride along on every write, first setup included (GAP-015).
  // The written config records what the answers produced; only the record says what
  // was answered — and `acknowledgeNoTdd` in particular has no config field to land
  // in, so without this the one call that turns the TDD law off would leave no trace
  // anywhere. A first setup has no diff to state, hence `changes: []`.
  input.journal.log(
    "info",
    "state",
    "config.updated",
    {
      path: configPath(root),
      changes: diff ?? [],
      answers: {
        behavioralPaths: [...answeredPaths],
        ...(answers.gitMode === undefined ? {} : { gitMode: answers.gitMode }),
        ...(answers.initRepo === undefined ? {} : { initRepo: answers.initRepo }),
        acknowledgeNoTdd: answers.acknowledgeNoTdd === true,
      },
      tsMs: now(),
    },
    {},
  );

  return {
    ok: true,
    written: true,
    repoConfigured: true,
    isRepo: repoNow,
    asks,
    proposals,
    config: candidate,
    failures: [],
    diff,
  };
}
