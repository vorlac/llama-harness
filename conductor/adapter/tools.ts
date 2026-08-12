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

import { decideGit } from "../core/gates-git.ts";
import { decideEdit, decideSession, writeShapedPaths } from "../core/gates-edit.ts";
import type { Decision, EditInput, SessionInput } from "../core/gates-edit.ts";
import { isGitCommand, shellTokens, splitOnOperators } from "../core/shell-parse.ts";

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
