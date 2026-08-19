// Task 5.3 red tests — lives at conductor/tests/gate-wiring.test.ts.
//
// SUBJECTS (must NOT exist when this goes red; the failure is
// `Cannot find module '../adapter/tools.ts'` — the missing-subject shape, a legal
// red per §2.6.1):
//   - conductor/adapter/tools.ts  (the gate-hookup half + the conductor_* tool
//     registration accessor)
//   - conductor/plugin/index.ts   (the opencode plugin: hook bodies that each call
//     ONE adapter function)
//
// SPEC:
//   - §3.5 (plan lines 1334-1427): the tool.execute.before gates — the
//     session-registry gate runs FIRST (spawn denied unconditionally; an
//     unregistered write/conductor call denied by the REGISTRY rule); the git
//     policy; the edit-scope gate; fail-closed on a gate crash while judging a
//     git/edit-write, fail-open on a crash while judging a harmless read (G5).
//   - §3.4 (plan lines 1303-1333): the 22 conductor_* tool inventory — the
//     plugin's `tool` hook must register EXACTLY these names.
//   - §7.4 (plan lines 1956-1963): the debuggability law — every deny journals its
//     input snapshot with enough context to reproduce the decision.
//   - Task 5.3 (plan lines 2375-2391) + docs/build/specs/task-5.3.assertions.json.
//   - conductor/adapter/wire-notes.md: throw inside `tool.execute.before` denies
//     (the thrown message is the reason the model sees); a plugin module may
//     export ONLY plugin functions (so plugin/index.ts exports exactly its
//     factory; the tool-name accessor lives in the sibling adapter/tools.ts);
//     `tool()` from @opencode-ai/plugin is `(input) => input` and the `tool` hook
//     is an object keyed by tool name.
//
// =========================================================================
// EXPECTED EXPORT SURFACE — this test file is the contract the subjects must meet.
// =========================================================================
//
// -- conductor/adapter/tools.ts --------------------------------------------
//
//   // (1) The §3.4 tool-registration accessor: the EXACT 22-name inventory the
//   //     plugin's `tool` hook registers. A readonly string[] (no enum, G2).
//   export const CONDUCTOR_TOOL_NAMES: readonly string[];
//
//   // (2) Tool-class derivation for the registry gate. Non-bash tools classify by
//   //     name; a `bash` tool classifies by its command (write-shaped ⇒ "write",
//   //     else "read"; a git WRITE is caught downstream by the git gate, which runs
//   //     for registered and unregistered sessions alike).
//   export type ToolClass = "read" | "write" | "conductor" | "spawn";
//   export function classifyTool(toolName: string, command?: string): ToolClass;
//
//   // (3) The gate-hookup function the plugin's tool.execute.before body calls.
//   //     Returns normally to ALLOW; THROWS new Error(reason) to DENY (mirroring
//   //     opencode's throw-to-deny). It runs, in order:
//   //       (a) the session-registry gate FIRST (decideSession) — spawn denied in
//   //           every session; an unregistered write/conductor call denied by the
//   //           REGISTRY rule (reason names the missing item assignment, NOT a
//   //           scope);
//   //       (b) for a bash tool: the git gate (decideGit) over the WHOLE command
//   //           (decideGit itself allows non-git commands — running it over every
//   //           bash command is how a git write hidden in a compound command such
//   //           as `ls && git commit` is still caught), then the edit gate
//   //           (decideEdit) over each writeShapedPaths() target;
//   //       (c) for an edit/write/patch tool: the edit gate over `editPath`.
//   //     FAIL-CLOSED (G5): if a wrapped core decision function (decideGit /
//   //     decideEdit) THROWS, the crash is journaled as `gate-crash`; the call is
//   //     then DENIED (throw) iff the command was GUARDED (a git segment present OR
//   //     a write shape present) and ALLOWED (return) otherwise (fail-open on a
//   //     harmless read). Guardedness is computed from the real parse, so it is
//   //     reliable even when the decision function crashes.
//   //     EVERY deny journals its input snapshot (§7.4) under component "gates",
//   //     event "deny"; every crash journals under "gates"/"gate-crash".
//   export function gateBeforeToolCall(input: {
//     sessionID: string;
//     toolName: string;
//     args: Record<string, unknown>;      // raw tool args (for the §7.4 snapshot)
//     command?: string;                   // bash command text (args.command)
//     editPath?: string;                  // ABSOLUTE path for an edit/write tool
//     registry: Map<string, { role: string; itemId?: string; tree?: string }>;
//     gitMode: "read-only" | "commit" | "commit-and-push";
//     runActive: boolean;
//     branchPolicy: "pin" | "check-only";
//     fileScope: string[];                // the session's item source scope
//     testScope: string[];                // the session's item test scope
//     verifyInFlightTree: TreePath | null;
//     inlineClaimScope: string[] | null;
//     journal: { log: (level, component, event, data, corr) => void };
//     corr: { runId: string; itemId?: string; sessionID?: string };
//     // fail-closed injection seam (dependency injection): override a core
//     // decision function to simulate a crash; defaults to the real cores.
//     deps?: {
//       decideSession?: (input) => { action: "allow" | "deny"; reason?: string };
//       decideGit?: (command, sessionRole, gitMode, runActive, branchPolicy) =>
//                     { action: "allow" | "deny"; reason?: string };
//       decideEdit?: (input) => { action: "allow" | "deny"; reason?: string };
//     };
//   }): void;
//
// -- conductor/plugin/index.ts ---------------------------------------------
//
//   // The opencode plugin FACTORY and NOTHING else (wire-notes: a plugin module
//   // may export only plugin functions). Its returned hooks include:
//   //   - `tool`: the map produced from CONDUCTOR_TOOL_NAMES (keys === the 22
//   //     names), each value a `tool({...})` definition;
//   //   - `tool.execute.before`: a thin body that parses input.tool / output.args /
//   //     input.sessionID and delegates to the ONE adapter function
//   //     gateBeforeToolCall.
//   // MUST be construction-safe: the factory may set up closures but MUST NOT do
//   // blocking I/O or require live opencode services at construction — that is what
//   // lets the tool registration be unit-tested with a synthetic input.
//   export const ConductorPlugin: Plugin;   // (input, options?) => Promise<Hooks>
//
// =========================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gateBeforeToolCall,
  classifyTool,
  CONDUCTOR_TOOL_NAMES,
} from "../adapter/tools.ts";
import { ConductorPlugin } from "../plugin/index.ts";
import { treePath } from "../core/types.ts";
import type { TreePath } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Local structural mirrors of the subjects' param/return shapes. Kept local (not
// imported) so this file is a self-contained contract; the subjects' real types
// assign to these under tsc --strict (same pattern as gates-edit.test.ts).
// ---------------------------------------------------------------------------

type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
type ToolClass = "read" | "write" | "conductor" | "spawn";

interface Corr {
  runId: string;
  itemId?: string;
  sessionID?: string;
}

interface CapturedRecord {
  level: LogLevel;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: Corr;
}

interface GateJournal {
  log: (
    level: LogLevel,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: Corr,
  ) => void;
}

interface RegistryEntry {
  role: string;
  itemId?: string;
  tree?: TreePath;
}
type Registry = Map<string, RegistryEntry>;

interface Decision {
  action: "allow" | "deny";
  reason?: string;
}

interface SessionInput {
  registered: boolean;
  role: string | null;
  toolName: string;
  toolClass: ToolClass;
}

interface EditInput {
  sessionRole: string;
  registered: boolean;
  fileScope: string[];
  testScope: string[];
  path: string;
  verifyInFlightTree: TreePath | null;
  sessionTree: TreePath;
  inlineClaimScope: string[] | null;
}

interface GateDeps {
  decideSession?: (input: SessionInput) => Decision;
  decideGit?: (
    command: string,
    sessionRole: string,
    gitMode: "read-only" | "commit" | "commit-and-push",
    runActive: boolean,
    branchPolicy: "pin" | "check-only",
  ) => Decision;
  decideEdit?: (input: EditInput) => Decision;
}

interface GateHookInput {
  sessionID: string;
  toolName: string;
  args: Record<string, unknown>;
  command?: string;
  editPath?: string;
  registry: Registry;
  gitMode: "read-only" | "commit" | "commit-and-push";
  runActive: boolean;
  branchPolicy: "pin" | "check-only";
  fileScope: string[];
  testScope: string[];
  verifyInFlightTree: TreePath | null;
  inlineClaimScope: string[] | null;
  journal: GateJournal;
  corr: Corr;
  deps?: GateDeps;
}

// ---------------------------------------------------------------------------
// The §3.4 tool inventory (plan lines 1307-1328) — the EXACT 22 names the plugin's
// `tool` hook must register. A renamed or forgotten tool fails the set-equality
// assertions below rather than silently at runtime.
// ---------------------------------------------------------------------------

const INVENTORY: readonly string[] = [
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
// Fixtures + helpers.
// ---------------------------------------------------------------------------

const TREE = treePath("/repo");
const REG_SESSION = "ses_registered";
const UNREG_SESSION = "ses_unregistered";

const ALLOW: Decision = { action: "allow" };

// A fake journal that captures every record into an array (the §7.4 grep target).
function makeJournal(): { journal: GateJournal; records: CapturedRecord[] } {
  const records: CapturedRecord[] = [];
  const journal: GateJournal = {
    log: (level, component, event, data, corr) => {
      records.push({ level, component, event, data, corr });
    },
  };
  return { journal, records };
}

// A fixture session registry (§3.5): REG_SESSION is a registered implementer with
// an item + tree; UNREG_SESSION is deliberately absent.
function baseRegistry(): Registry {
  const reg: Registry = new Map();
  reg.set(REG_SESSION, { role: "implementer", itemId: "I1", tree: TREE });
  return reg;
}

// Build a GateHookInput with sane defaults (a registered implementer, git.commit
// mode, an active pinned run); every field is overridable per case.
function hookInput(over: Partial<GateHookInput> = {}): GateHookInput {
  const base: GateHookInput = {
    sessionID: REG_SESSION,
    toolName: "bash",
    args: {},
    registry: baseRegistry(),
    gitMode: "commit",
    runActive: true,
    branchPolicy: "pin",
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    verifyInFlightTree: null,
    inlineClaimScope: null,
    journal: makeJournal().journal,
    corr: { runId: "run1" },
  };
  return { ...base, ...over };
}

// assert.throws that hands back the Error so the caller can assert on WHAT the
// reason names. Non-vacuous: fails if the call did not throw an Error.
function expectThrow(fn: () => void, ctx: string): Error {
  let caught: unknown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    caught = e;
  }
  assert.ok(threw, `${ctx}: expected the gate to DENY by throwing`);
  assert.ok(caught instanceof Error, `${ctx}: a deny must throw an Error`);
  assert.ok((caught as Error).message.length > 0, `${ctx}: the thrown reason must be non-empty`);
  return caught as Error;
}

// A synthetic opencode PluginInput — enough for a construction-safe factory to run
// under `node --test` with no opencode process.
function stubPluginInput(): unknown {
  return {
    client: {},
    project: { id: "prj_test", worktree: TREE },
    directory: TREE,
    worktree: TREE,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

interface PluginHooks {
  tool?: Record<string, unknown>;
  "tool.execute.before"?: (input: unknown, output: unknown) => Promise<void> | void;
}

async function invokePlugin(): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(stubPluginInput());
}

// ===========================================================================
// [5.3-api] the export surface + tool classification.
// ===========================================================================

test("[5.3-api] adapter + plugin export the gate hook, classifier, inventory, and factory", () => {
  assert.equal(typeof gateBeforeToolCall, "function", "gateBeforeToolCall is exported");
  assert.equal(typeof classifyTool, "function", "classifyTool is exported");
  assert.equal(typeof ConductorPlugin, "function", "ConductorPlugin factory is exported");
  assert.ok(Array.isArray(CONDUCTOR_TOOL_NAMES), "CONDUCTOR_TOOL_NAMES is an array");

  // classifyTool: names map to registry classes; a bash tool classifies by its
  // command's write shape.
  assert.equal(classifyTool("task"), "spawn", "the built-in spawn tool is class spawn");
  assert.equal(classifyTool("edit"), "write", "edit is a write-class tool");
  assert.equal(classifyTool("write"), "write", "write is a write-class tool");
  assert.equal(classifyTool("conductor_publish"), "conductor", "a conductor_* tool is class conductor");
  assert.equal(classifyTool("read"), "read", "read is a read-class tool");
  assert.equal(classifyTool("bash", "ls -la"), "read", "a plain bash read is class read");
  assert.equal(classifyTool("bash", "echo hi > out.txt"), "write", "a write-shaped bash is class write");
});

// ===========================================================================
// [5.3-git-deny] a bash git deny THROWS with the core git gate's reason (plan 2381).
// ===========================================================================

test("[5.3-git-deny] a bash `git commit` throws with the core reason (conductor_publish)", () => {
  const cmd = 'git commit -m "wip"';
  const err = expectThrow(
    () => gateBeforeToolCall(hookInput({ toolName: "bash", command: cmd, args: { command: cmd } })),
    "git commit",
  );
  assert.match(
    err.message,
    /conductor_publish/,
    "the thrown reason must be the core git gate's reason naming conductor_publish",
  );

  // Control: a read-only git command is ALLOWED — the gate does not blanket-deny bash.
  assert.doesNotThrow(
    () => gateBeforeToolCall(hookInput({ toolName: "bash", command: "git status", args: { command: "git status" } })),
    "a read-only `git status` must be allowed",
  );
});

// ===========================================================================
// [5.3-edit-deny] a registered implementer editing outside fileScope THROWS naming
// the scope (plan 2381).
// ===========================================================================

test("[5.3-edit-deny] an implementer editing outside its fileScope throws naming the scope", () => {
  const outPath = `${TREE}/lib/other.ts`;
  const err = expectThrow(
    () =>
      gateBeforeToolCall(
        hookInput({
          toolName: "edit",
          editPath: outPath,
          args: { filePath: outPath },
          fileScope: ["src/**"],
        }),
      ),
    "out-of-scope edit",
  );
  assert.match(err.message, /fileScope/, "an out-of-scope edit deny must name the fileScope");

  // Control: an in-scope edit is ALLOWED.
  const inPath = `${TREE}/src/a.ts`;
  assert.doesNotThrow(
    () =>
      gateBeforeToolCall(
        hookInput({ toolName: "edit", editPath: inPath, args: { filePath: inPath }, fileScope: ["src/**"] }),
      ),
    "an in-scope edit must be allowed",
  );
});

// ===========================================================================
// [5.3-registry-first] the registry gate runs FIRST: an UNREGISTERED session's edit
// is denied by the REGISTRY rule, not the scope rule, and the reason says so — the
// edit-scope gate is never even consulted (plan 2382-2383).
// ===========================================================================

test("[5.3-registry-first] an unregistered session's edit is denied by the registry rule, not the scope rule", () => {
  let editConsulted = false;
  // The path is ALSO out of scope, so if the scope gate ran it would fire — proving
  // the registry gate ran FIRST requires the reason to be the REGISTRY reason and
  // decideEdit to have never been called.
  const outPath = `${TREE}/lib/out-of-scope.ts`;
  const err = expectThrow(
    () =>
      gateBeforeToolCall(
        hookInput({
          sessionID: UNREG_SESSION, // absent from the registry
          toolName: "edit",
          editPath: outPath,
          args: { filePath: outPath },
          fileScope: ["src/**"],
          deps: {
            decideEdit: () => {
              editConsulted = true;
              return ALLOW;
            },
          },
        }),
      ),
    "unregistered edit",
  );

  assert.match(
    err.message,
    /item assignment|registered/i,
    "the reason must name the registry rule (no item assignment / unregistered session)",
  );
  assert.doesNotMatch(
    err.message,
    /fileScope/,
    "the reason must NOT be the scope-deny reason — that would mean the scope gate ran",
  );
  assert.equal(
    editConsulted,
    false,
    "the edit-scope gate (decideEdit) must NOT run once the registry gate has denied",
  );
});

// ===========================================================================
// [5.3-spawn] a spawn (the built-in `task` tool) THROWS in EVERY session, registered
// or not — the load-bearing half of the registry gate (plan 2384, §3.5:1356-1360).
// ===========================================================================

test("[5.3-spawn] a task/spawn attempt throws in every session (registered and unregistered)", () => {
  for (const sessionID of [REG_SESSION, UNREG_SESSION]) {
    const err = expectThrow(
      () =>
        gateBeforeToolCall(
          hookInput({
            sessionID,
            toolName: "task",
            args: { description: "d", prompt: "p", subagent_type: "conductor-implementer" },
          }),
        ),
      `spawn in ${sessionID}`,
    );
    assert.match(err.message, /spawn|task/i, `the spawn deny must name the spawn/task rule (session ${sessionID})`);
  }
});

// ===========================================================================
// [5.3-fail-closed] an injected decideGit crash DURING A GIT COMMAND still throws
// (fail-closed, G5) AND journals `gate-crash` (plan 2384-2385).
// ===========================================================================

test("[5.3-fail-closed] a decideGit crash while judging a git command fails closed and journals gate-crash", () => {
  const { journal, records } = makeJournal();
  const cmd = "git commit -m x";
  // Inject the crash via the dependency-injection seam: an override that throws.
  const crashingGit = () => {
    throw new Error("INJECTED decideGit crash");
  };

  expectThrow(
    () =>
      gateBeforeToolCall(
        hookInput({ toolName: "bash", command: cmd, args: { command: cmd }, journal, deps: { decideGit: crashingGit } }),
      ),
    "crash during git command",
  );

  const crash = records.find((r) => r.component === "gates" && r.event === "gate-crash");
  assert.ok(crash, "a fail-closed crash must be journaled under gates/gate-crash");
});

// ===========================================================================
// [5.3-fail-open] the SAME decideGit crash during a HARMLESS `ls` (no git, no write
// shape) ALLOWS (fail-open) and still journals `gate-crash` (plan 2385-2386).
// ===========================================================================

test("[5.3-fail-open] the same decideGit crash while judging a harmless ls allows and journals gate-crash", () => {
  const { journal, records } = makeJournal();
  const cmd = "ls -la";
  const crashingGit = () => {
    throw new Error("INJECTED decideGit crash");
  };

  assert.doesNotThrow(
    () =>
      gateBeforeToolCall(
        hookInput({ toolName: "bash", command: cmd, args: { command: cmd }, journal, deps: { decideGit: crashingGit } }),
      ),
    "a crash while judging a harmless ls must fail OPEN (allow)",
  );

  const crash = records.find((r) => r.component === "gates" && r.event === "gate-crash");
  assert.ok(crash, "even a fail-open crash must be journaled under gates/gate-crash (never invisible)");
});

// ===========================================================================
// [5.3-journal-law] every DENY journals its input snapshot (§7.4) — enough context
// (toolName, args, the repro command/path, and the reason) to reproduce the
// decision through the pure core function. The test greps the fake journal (plan
// 2386, §7.4:1956-1963).
// ===========================================================================

test("[5.3-journal-law] a git deny journals its input snapshot (toolName, args, command, reason)", () => {
  const { journal, records } = makeJournal();
  const cmd = "git commit -m snap";
  expectThrow(
    () => gateBeforeToolCall(hookInput({ toolName: "bash", command: cmd, args: { command: cmd }, journal })),
    "git deny snapshot",
  );

  const deny = records.find((r) => r.component === "gates" && r.event === "deny");
  assert.ok(deny, "a git deny must be journaled under gates/deny");
  assert.equal(deny.data["toolName"], "bash", "the snapshot carries the toolName");
  assert.equal(deny.data["command"], cmd, "the snapshot carries the command (the git gate's repro input)");
  assert.deepEqual(deny.data["args"], { command: cmd }, "the snapshot carries the raw tool args");
  assert.match(String(deny.data["reason"]), /conductor_publish/, "the snapshot carries the deny reason");
});

test("[5.3-journal-law] an edit deny journals its input snapshot (toolName, path, reason)", () => {
  const { journal, records } = makeJournal();
  const outPath = `${TREE}/lib/nope.ts`;
  expectThrow(
    () =>
      gateBeforeToolCall(
        hookInput({
          toolName: "edit",
          editPath: outPath,
          args: { filePath: outPath },
          fileScope: ["src/**"],
          journal,
        }),
      ),
    "edit deny snapshot",
  );

  const deny = records.find((r) => r.component === "gates" && r.event === "deny");
  assert.ok(deny, "an edit deny must be journaled under gates/deny");
  assert.equal(deny.data["toolName"], "edit", "the snapshot carries the toolName");
  assert.equal(deny.data["editPath"], outPath, "the snapshot carries the edit path (the edit gate's repro input)");
  assert.match(String(deny.data["reason"]), /fileScope/, "the snapshot carries the deny reason");
});

test("[5.3-journal-law] a registry-gate deny (unregistered write) also journals its snapshot", () => {
  const { journal, records } = makeJournal();
  const outPath = `${TREE}/src/a.ts`;
  expectThrow(
    () =>
      gateBeforeToolCall(
        hookInput({
          sessionID: UNREG_SESSION,
          toolName: "edit",
          editPath: outPath,
          args: { filePath: outPath },
          journal,
        }),
      ),
    "registry deny snapshot",
  );

  const deny = records.find((r) => r.component === "gates" && r.event === "deny");
  assert.ok(deny, "a registry-gate deny must also be journaled under gates/deny");
  assert.equal(deny.data["toolName"], "edit", "the snapshot carries the toolName");
  assert.match(String(deny.data["reason"]), /item assignment|registered/i, "the snapshot carries the registry reason");
});

// ===========================================================================
// [5.3-tool-inventory] the plugin's `tool` hook registers EXACTLY the §3.4 names,
// asserted against the inventory so a renamed/forgotten tool fails HERE rather than
// at runtime (plan 2387-2388).
// ===========================================================================

test("[5.3-tool-inventory] CONDUCTOR_TOOL_NAMES is exactly the §3.4 22-tool inventory", () => {
  assert.equal(new Set(CONDUCTOR_TOOL_NAMES).size, 22, "exactly 22 uniquely-named conductor tools");
  assert.deepEqual(
    [...CONDUCTOR_TOOL_NAMES].sort(),
    [...INVENTORY].sort(),
    "the adapter inventory must equal the §3.4 set exactly — no more, no fewer",
  );
});

test("[5.3-tool-inventory] the plugin's tool hook registers exactly the §3.4 names", async () => {
  const hooks = await invokePlugin();

  assert.equal(typeof hooks.tool, "object", "the plugin registers a `tool` map");
  assert.notEqual(hooks.tool, null, "the `tool` map must not be null");
  const registered = Object.keys(hooks.tool ?? {});

  assert.deepEqual(
    registered.sort(),
    [...INVENTORY].sort(),
    "the plugin's `tool` hook must register EXACTLY the §3.4 names — a renamed/forgotten tool fails here",
  );
  // Tie the plugin registration to the adapter's accessor: they must not drift.
  assert.deepEqual(
    registered.sort(),
    [...CONDUCTOR_TOOL_NAMES].sort(),
    "the plugin must register exactly the adapter's CONDUCTOR_TOOL_NAMES",
  );

  assert.equal(
    typeof hooks["tool.execute.before"],
    "function",
    "the plugin installs a tool.execute.before gate hook (the deny-by-throw seam)",
  );
});
