// Task 5.4a red tests — destination conductor/tests/composition.test.ts.
//
// Task-let 5.4a is the SESSION/RUN LIFECYCLE HALF of the composition root. It is
// not in the plan; the orchestrator opened it under prompt §3.3 ("anything else
// you find unowned: add it as an explicit numbered task-let with its own
// red→green→commit"). Spec: docs/build/specs/task-5.4a.assertions.json (14 rows).
//
// SUBJECTS (the red is missing-subject: `Cannot find module
// '../adapter/config-io.ts'`, plus a plugin that exposes no `chat.message`):
//   - conductor/adapter/config-io.ts   NEW. The §2.1 `.conductor/config.json`
//                                      reader. Nothing in the product reads that
//                                      file today — core/types.ts:134's comment is
//                                      its ONLY mention anywhere.
//   - conductor/plugin/index.ts        EDITED. The composition edits that give the
//                                      plugin a real StateStore (adapter/state.ts
//                                      openWorkspace), a real JSONL journal
//                                      (adapter/journal.ts createJournal), a real
//                                      SessionRegistry, and a `chat.message` hook
//                                      that calls the committed handleChatMessage.
//
// WHY THIS EXISTS. At HEAD the plugin is a shell: `openWorkspace` appears nowhere
// in plugin/index.ts, its journal is a console.error stub (:103-107), its registry
// is a bare Map (:97), and it returns exactly `{tool, "tool.execute.before"}`
// (:246). `grep -rn handleChatMessage conductor --include=*.ts`, excluding the
// module itself and its tests, returns NOTHING — Task 5.4's whole deliverable has
// no production caller. So in a live opencode session no run is ever created and
// no session is ever registered as the orchestrator, which makes Task 10.1 (the
// ask gate and the continuation engine) unimplementable against the product.
//
// THE SCOPE FENCE (spec SG-4). This task-let does NOT bind the 22 conductor tool
// handlers. They stay bound to handlerNotBound (plugin/index.ts:83-89) and keep
// throwing — that is plan:2958's "glue fixes" and belongs to Task 13.1 (C-044
// Finding 1). The last test in this file asserts the fence deliberately, so a
// future reader can see the boundary was drawn rather than forgotten.
//
// ===========================================================================
// EXPECTED MODULE SURFACE — this file is the contract the subjects must meet.
// ===========================================================================
//
// -- conductor/adapter/config-io.ts ----------------------------------------
//
//   // Where §2.1's config lives, as ONE literal, so the plugin and Task 12.2's
//   // setup writer cannot disagree about the path.
//   export function configPath(root: string): string;   // <root>/.conductor/config.json
//
//   export interface LoadedConfig {
//     config: Config;            // the §2.1 config in force
//     repoConfigured: boolean;   // false iff no config file exists — the flag
//                                // core/gates-phase.ts legalTools already takes
//                                // (:276, :299: an unconfigured repo may call
//                                // only conductor_setup / conductor_status)
//   }
//
//   // The FIRST default Config in the product (`grep -rn 'DEFAULT_CONFIG|
//   // defaultConfig' conductor/` returns nothing at HEAD). Safe-by-construction,
//   // not permissive — see [5.4a-default-config-is-safe-not-permissive] below
//   // for the field-by-field pin and the reasoning for each non-plan value.
//   // CROSS-TASK OBLIGATION: Task 12.2 writes .conductor/config.json and MUST
//   // honour this object as its single source, exactly as scripts/
//   // conductor_wiring.py:63-68 says of DEFAULT_MAX_READERS.
//   export const DEFAULT_CONFIG: Config;
//
//   // Synchronous, like every other conductor store read. `root` is the ALREADY
//   // REALPATH'd workspace root (the caller realpaths — §0.2 wire-notes DRIFT).
//   //   - no file            -> {config: DEFAULT_CONFIG value, repoConfigured:false}
//   //   - file + valid       -> {config: <parsed, field for field>, repoConfigured:true}
//   //   - file + unparseable -> THROWS, naming the file
//   //   - file + invalid     -> THROWS, naming the file AND carrying the errors
//   //                           validate("Config", parsed) itself produced
//   // It NEVER falls back to defaults on a malformed file: a repo whose config
//   // says git.mode "none" silently becoming "commit" is a security downgrade.
//   export function loadConfig(root: string): LoadedConfig;
//
// -- conductor/plugin/index.ts ---------------------------------------------
//
//   The factory still exports exactly `ConductorPlugin` (wire-notes: a plugin
//   module may export ONLY plugin functions). Its returned hooks gain ONE key:
//
//     "chat.message"?: (input: {sessionID: string, ...},
//                       output: {message: UserMessage, parts: Part[]}) => Promise<void>
//
//   — the 1.18.15 signature (node_modules/@opencode-ai/plugin/dist/index.d.ts).
//   It returns Promise<void>, so nothing this test asserts may depend on a
//   returned value; every assertion below reads the durable artifact or the
//   journal instead. The hook:
//     1. lazily ensures the workspace (see LAZY below), then
//     2. builds the prompt from output.parts — the `text` of every part whose
//        type is "text", in order; non-text parts contribute nothing — then
//     3. calls the committed handleChatMessage({store, registry, sessionID,
//        prompt, journal}) (adapter/chat-message.ts:105, input shape at :55-62),
//     4. and on the "created" path rebinds the journal to the new run dir and
//        journals `state`/`run.created` with data {runId, root} (the resolved
//        workspace root — the ONE observable that proves SG-3's realpath rule).
//     Any throw out of step 3 is CAUGHT, journaled once at level "error" under a
//     component/event pair core/journal-events.ts LISTS, and swallowed (G5).
//
//   ONE REGISTRY, TWO CONSUMERS. adapter/tools.ts gateBeforeToolCall takes
//   `registry: Map<string, RegistryEntry>` (tools.ts:211) while handleChatMessage
//   takes `registry: SessionRegistry` — an interface with register()/get()
//   (chat-message.ts:35-38). A bare Map does not satisfy the latter. The plugin
//   therefore holds ONE Map and hands handleChatMessage a thin
//   {register,get} view OVER THAT SAME MAP. Two maps is the bug this task-let
//   exists to prevent, and the [5.4a-registration-reaches-the-gate] row is what
//   catches it.
//
//   LAZY (spec SG-3). The factory must do NO filesystem work at construction:
//   conductor/tests/gate-wiring.test.ts:313-333 constructs it against
//   `directory: "/repo"`, a path that does not exist, and that committed test
//   must keep passing. The workspace is opened on FIRST HOOK USE, against
//   realpathSync(input.directory) (§0.2 wire-notes: "opencode canonicalizes
//   session directories … the adapter must realpath every directory they hand
//   opencode"). If the open fails, the failure is LOUD on stderr and the gate
//   hook still DENIES — a plugin that fails open is the §3.8 silent-ungate case,
//   the most dangerous failure shape in the integration.
//
//   THE TWO-PHASE JOURNAL (spec SG-1). createJournal(runDir, …) needs a run
//   directory; the run directory is made by store.createRun(); the store needs a
//   journal. That cycle is real and the plan never addresses it. Resolution: ONE
//   journal object whose SINK is rebindable. Before any run exists it writes
//   through the §7.1 stderr sink — which is what the committed stub already does
//   (plugin/index.ts:103-107) — and the moment a run directory exists it rebinds
//   to a createJournal-backed JSONL sink for that dir. Records written before the
//   rebind are NOT replayed into the file: they were correctly stderr-only
//   events, and replaying them would file records under a run they did not belong
//   to (and break Task 15.0's source-order guarantee).
//
//   THE STDERR SINK'S SHAPE is pinned, because it is the only thing a test can
//   observe before a run exists: exactly ONE `console.error` call per record,
//   carrying one JSON object with the keys {level, component, event, data, corr}
//   — byte-for-byte the committed stub's shape. It is UNFILTERED: it is the only
//   sink that exists pre-run, so a §7.1 console level filter there would silently
//   LOSE the record instead of downgrading it (§7.4).
//
//   TWO CONSEQUENCES THE IMPLEMENTER MUST HANDLE, both outside this file:
//   (a) conductor/tests/journal-vocab.test.ts audits every `.log(` call site
//       under conductor/{core,adapter,plugin} and pins the set that names its
//       component/event through a VARIABLE (EXPECTED_DYNAMIC_SITES). The
//       rebindable sink forwards a caller-chosen name, so it is a new dynamic
//       site and must be added to that allowlist — it is exactly the
//       "pass-through seam whose caller is itself audited" the list documents.
//   (b) There is no §7.4 name for "the chat.message hook failed". Under
//       core/journal-events.ts's own widening rule (option 2: add a name here,
//       in the same commit as the call site and a test that greps for it, when
//       an existing name would make the record lie), EVENTS.state gains one —
//       `chat.message.failed` is the recommended spelling. The fail-soft test
//       below does not pin the spelling; it requires isKnownEvent to accept
//       whatever name is used, which forbids inventing an unlisted one.
//
// ===========================================================================
// Assertion id -> test name (docs/build/specs/task-5.4a.assertions.json)
// ===========================================================================
//   5.4a-config-loads-valid                  -> "[5.4a-config-loads-valid] …"
//   5.4a-config-absent-defaults              -> "[5.4a-config-absent-defaults] …"
//   5.4a-config-malformed-is-loud            -> "[5.4a-config-malformed-is-loud] …"
//   5.4a-default-config-is-safe-not-permissive -> "[5.4a-default-config-is-safe-not-permissive] …"
//   5.4a-plugin-exposes-chat-message         -> "[5.4a-plugin-exposes-chat-message] …"
//   5.4a-chat-message-creates-run            -> "[5.4a-chat-message-creates-run] …"
//   5.4a-chat-message-registers-orchestrator -> "[5.4a-chat-message-registers-orchestrator] …"
//   5.4a-registration-reaches-the-gate       -> "[5.4a-registration-reaches-the-gate] …"
//   5.4a-midrun-prompt-routed-not-recreated  -> "[5.4a-midrun-prompt-routed-not-recreated] …"
//   5.4a-journal-rebinds-to-run-dir          -> "[5.4a-journal-rebinds-to-run-dir] …"
//   5.4a-workspace-opened-lazily-and-realpathed -> "[5.4a-workspace-opened-lazily-and-realpathed] …"
//   5.4a-construction-failure-denies-loudly  -> "[5.4a-construction-failure-denies-loudly] …"
//   5.4a-hook-failsoft-does-not-break-the-session -> "[5.4a-hook-failsoft-does-not-break-the-session] …"
//   5.4a-git-policy-comes-from-the-config    -> "[5.4a-git-policy-comes-from-the-config] …"
//   5.4a-tools-still-throw-scope-fence       -> "[5.4a-tools-still-throw-scope-fence] …"
//
// Every fixture is a throwaway dir under os.tmpdir(), built at runtime and torn
// down in after(). No test here runs git against the llama-harness repo.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---- the subjects --------------------------------------------------------
// config-io.ts does NOT exist at red time; this import is the missing-subject red.
import { DEFAULT_CONFIG, configPath, loadConfig } from "../adapter/config-io.ts";
import type { LoadedConfig } from "../adapter/config-io.ts";
// The plugin exists but exposes no `chat.message` at red time.
import { ConductorPlugin } from "../plugin/index.ts";

// ---- committed subjects this file composes over --------------------------
import { CONDUCTOR_TOOL_NAMES } from "../adapter/tools.ts";
import { DEFAULT_LEVEL, isKnownEvent } from "../core/journal-events.ts";
import { validate } from "../core/types.ts";
import type { Config, JournalRecord, Run } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Structural mirrors of the opencode hook shapes. Kept LOCAL (not imported from
// @opencode-ai/plugin) so this file is a self-contained contract that also runs
// under Node type-stripping; the real 1.18.15 types are the source they mirror
// (node_modules/@opencode-ai/plugin/dist/index.d.ts, Hooks).
// ---------------------------------------------------------------------------

interface RegisteredTool {
  description: string;
  execute: (args: unknown, context: unknown) => Promise<unknown>;
}

interface ChatMessageHookInput {
  sessionID: string;
  agent?: string;
  messageID?: string;
}

interface ChatMessageHookOutput {
  message: Record<string, unknown>;
  parts: Array<Record<string, unknown>>;
}

interface ToolBeforeHookInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolBeforeHookOutput {
  args: Record<string, unknown>;
}

interface PluginHooks {
  tool?: Record<string, RegisteredTool>;
  "tool.execute.before"?: (
    input: ToolBeforeHookInput,
    output: ToolBeforeHookOutput,
  ) => Promise<void> | void;
  "chat.message"?: (
    input: ChatMessageHookInput,
    output: ChatMessageHookOutput,
  ) => Promise<void> | void;
}

// The §7.1 stderr sink's record shape (the committed stub's JSON payload).
interface StderrRecord {
  level?: unknown;
  component?: unknown;
  event?: unknown;
  data?: Record<string, unknown>;
  corr?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..", "..");

const SESSION = "ses_orchestrator_5f3a";
const OTHER_SESSION = "ses_stray_7c1d";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  tmpDirs.push(dir);
  // Every root handed to the plugin is realpath'd by the plugin itself; the
  // fixtures resolve their own paths so the assertions compare like with like.
  return dir;
}

// A plain (non-git) workspace root. §3.9 no-git run creation is already covered
// by conductor/tests/chat-message.test.ts; these tests care about the wiring.
function plainRoot(tag: string): string {
  return realpathSync(scratchDir(tag));
}

// Hermetic git for BUILDING fixtures — no global/system config can leak in, and
// every invocation is scoped to the fixture dir.
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
  GIT_TERMINAL_PROMPT: "0",
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitRoot(tag: string): string {
  const dir = plainRoot(tag);
  git(dir, ["init", "-b", "main"]);
  writeFileSync(path.join(dir, "seed.ts"), "export const x = 1;\n");
  git(dir, ["add", "seed.ts"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

// ---------------------------------------------------------------------------
// Driving the real plugin
// ---------------------------------------------------------------------------

// A synthetic opencode PluginInput — the gate-wiring.test.ts shape, parameterized
// by the directory so each test can hand the factory its own workspace root.
function pluginInput(directory: string): unknown {
  return {
    client: {},
    project: { id: "prj_5f3a", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

async function startPlugin(directory: string): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(pluginInput(directory));
}

function textPart(id: string, text: string): Record<string, unknown> {
  return { id, type: "text", text };
}

// Drive the REAL `chat.message` hook with a synthetic user message. `texts` become
// text parts in order; a non-text part is interleaved so the prompt builder is
// proven to select by part type rather than by position.
async function sendChatMessage(
  hooks: PluginHooks,
  sessionID: string,
  texts: string[],
): Promise<void> {
  const hook = hooks["chat.message"];
  assert.equal(
    typeof hook,
    "function",
    "the plugin must expose a `chat.message` hook — without it no run is ever created in a live session",
  );
  const parts: Array<Record<string, unknown>> = [];
  texts.forEach((text, index) => {
    parts.push(textPart(`prt_text_${index}`, text));
  });
  parts.splice(1, 0, {
    id: "prt_file_ignored",
    type: "file",
    mime: "text/plain",
    url: "file:///tmp/NOT-A-PROMPT-4b7e.txt",
    filename: "NOT-A-PROMPT-4b7e.txt",
  });
  await (hook as (i: ChatMessageHookInput, o: ChatMessageHookOutput) => Promise<void>)(
    { sessionID, agent: "conductor", messageID: "msg_5f3a" },
    {
      message: { id: "msg_5f3a", sessionID, role: "user", time: { created: 1_754_560_000_000 } },
      parts,
    },
  );
}

// Drive the REAL `tool.execute.before` gate hook.
async function callGate(
  hooks: PluginHooks,
  input: { tool: string; sessionID: string; args: Record<string, unknown> },
): Promise<void> {
  const hook = hooks["tool.execute.before"];
  assert.equal(typeof hook, "function", "the plugin must keep its tool.execute.before gate hook");
  await (hook as (i: ToolBeforeHookInput, o: ToolBeforeHookOutput) => Promise<void>)(
    { tool: input.tool, sessionID: input.sessionID, callID: "call_5f3a" },
    { args: input.args },
  );
}

// Await a call that must DENY, handing back the Error so the caller can assert on
// WHAT the reason names. Non-vacuous: fails if the call did not throw an Error.
async function expectDeny(fn: () => Promise<void>, ctx: string): Promise<Error> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert.ok(threw, `${ctx}: expected the gate to DENY by throwing`);
  assert.ok(caught instanceof Error, `${ctx}: a deny must throw an Error`);
  assert.ok((caught as Error).message.length > 0, `${ctx}: the thrown reason must be non-empty`);
  return caught as Error;
}

// ---------------------------------------------------------------------------
// Capturing the §7.1 stderr sink
// ---------------------------------------------------------------------------

interface Captured<T> {
  result: T;
  lines: string[];
  records: StderrRecord[];
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<Captured<T>> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]): void => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  let result: T;
  try {
    result = await fn();
  } finally {
    console.error = original;
  }
  const records: StderrRecord[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a non-JSON stderr line is not a journal record
    }
    if (parsed !== null && typeof parsed === "object") records.push(parsed as StderrRecord);
  }
  return { result, lines, records };
}

// ---------------------------------------------------------------------------
// Reading the durable artifacts (§1.2 layout)
// ---------------------------------------------------------------------------

function stateDirOf(root: string): string {
  return path.join(root, ".conductor", "state");
}

function runsDirOf(root: string): string {
  return path.join(root, ".conductor", "runs");
}

function runDirOf(root: string, runId: string): string {
  return path.join(runsDirOf(root), runId);
}

// The §1.2 current-run pointer state.ts writes: {"runId": "..."} (or null).
function currentRunId(root: string): string | null {
  const pointer = path.join(stateDirOf(root), "current-run.json");
  if (!existsSync(pointer)) return null;
  const parsed = JSON.parse(readFileSync(pointer, "utf8")) as { runId?: unknown } | null;
  if (parsed === null || typeof parsed !== "object") return null;
  return typeof parsed.runId === "string" ? parsed.runId : null;
}

function readRun(root: string, runId: string): Run {
  return JSON.parse(readFileSync(path.join(runDirOf(root, runId), "run.json"), "utf8")) as Run;
}

function countRuns(root: string): number {
  const dir = runsDirOf(root);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "run.json")),
  ).length;
}

// Every line of <runDir>/journal.jsonl, parsed. An unparseable line throws here —
// a torn journal is a failure, not something to skip past (§7.4).
function readJournalFile(runDirPath: string): JournalRecord[] {
  const journalPath = path.join(runDirPath, "journal.jsonl");
  if (!existsSync(journalPath)) return [];
  const out: JournalRecord[] = [];
  for (const line of readFileSync(journalPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(JSON.parse(trimmed) as JournalRecord);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The DOCUMENTED default Config (spec SG-2). Pinned here field for field so the
// implementer has one unambiguous target and Task 12.2 has one source to honour.
//
// Every value is the plan's own §2.1 example (plan lines 480-618) EXCEPT the four
// below, each of which the plan either forbids defaulting or would make
// PERMISSIVE if copied verbatim. A default is what an unconfigured repo gets, so
// it must fail toward "conductor can do less", never "conductor may do more":
//
//   git.mode "read-only"        plan line 545 says the mode is "asked on first run
//                               in a repo, NEVER defaulted". The example's "commit"
//                               is therefore NOT a default — assuming it would let
//                               an unconfigured repo be committed to.
//   verify.scopes {}            conductor must not invent a test command. An empty
//                               scope map means no verification is fabricated; the
//                               repo is unconfigured, so nothing may run anyway.
//   verify.requiredScopes []    an entry naming a scope that does not exist in the
//                               (empty) scope map is an internally inconsistent
//                               default; [] keeps the object coherent.
//   verify.behavioralPaths ["**"]  plan lines 526-530: "a wrong value here is the
//                               difference between an enforced TDD law and an
//                               optional one, so it is asked, never silently
//                               defaulted". [] would make behavioral:false legal
//                               for ALL code — the permissive direction. ["**"]
//                               makes every path owe verification until setup
//                               narrows it, which is the safe direction.
//   models.default ""           G13's model is validated against the live
//                               /v1/models list at setup and at every run start.
//                               Naming a model nobody chose would let a run talk
//                               to weights the user never picked; "" fails loudly.
//   toolSurface.classifyBuiltins true  §2's governance floor: a built-in carrying
//                               no declared side-effect class is refused rather
//                               than falling through to the read catch-all. The
//                               safe direction is ON — an unclassified tool is one
//                               nobody can say the reach of, and defaulting it to
//                               "harmless" is the absence of a decision rather
//                               than a decision. The flag exists so the lane can
//                               be turned OFF for a rollback, never to opt in.
//   toolSurface.denyNetwork true  the network class is refused, both the
//                               webfetch/websearch names and a bash command whose
//                               shape reaches an enumerated network program. The
//                               measured posture is that the client offers
//                               webfetch with NO permission narrowing in any agent
//                               kind (wire-notes 20.2), so leaving this off would
//                               be leaving the surface exactly as wide as it was
//                               found.
//
// The whole object is unreachable in practice until conductor_setup runs —
// legalTools(…, repoConfigured=false, …) (core/gates-phase.ts:299) leaves only
// conductor_setup and conductor_status legal in every state — which is exactly
// why the default may be strict without stranding anyone.
// ---------------------------------------------------------------------------

const DOCUMENTED_DEFAULT_CONFIG: Config = {
  version: 1,
  verify: { scopes: {}, behavioralPaths: ["**"], requiredScopes: [] },
  format: { rules: [] },
  git: { mode: "read-only", branchPolicy: "pin", preexistingDirty: "refuse" },
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
  parallel: { writes: "off", maxImplementers: 2, maxReaders: 6, subSessionTimeoutMs: 900000 },
  models: { default: "", roles: {} },
  toolSurface: { classifyBuiltins: true, denyNetwork: true },
  ponytail: "full",
  retention: { keepRuns: 20, maxRunDirBytes: 268435456, pruneOnRunCreate: true },
  logging: { level: "info", components: {} },
};

// A configured repo's config: deliberately different from the default in every
// block a test reads, so "preserved field for field" cannot pass by accident.
function configuredConfig(): Config {
  return {
    version: 1,
    verify: {
      scopes: { unit: { command: ["node", "--test"], timeoutMs: 600000, itemTest: ["node", "--test", "{files}"] } },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [{ pattern: "**/*.ts", mode: "stdin", command: ["prettier", "--stdin-filepath", "{file}"] }] },
    git: { mode: "commit-and-push", branchPolicy: "check-only", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 1,
      planReviewers: 2,
      planReviewMaxRounds: 1,
      itemReviewers: 2,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 1,
      maxOverridesPerItem: 3,
      maxOverridesPerRun: 4,
    },
    parallel: { writes: "worktrees", maxImplementers: 3, maxReaders: 5, subSessionTimeoutMs: 123456 },
    models: { default: "qwen3.6-27b", roles: {} },
    ponytail: "ultra",
    retention: { keepRuns: 3, maxRunDirBytes: 1048576, pruneOnRunCreate: false },
    logging: { level: "debug", components: { gates: "trace" } },
  };
}

function writeConfigFile(root: string, contents: string): string {
  const target = path.join(root, ".conductor", "config.json");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

// ===========================================================================
// 5.4a-config-loads-valid
// ===========================================================================

test("[5.4a-config-loads-valid] a present, schema-valid .conductor/config.json is read through the committed validator and returned field for field with repoConfigured true", () => {
  const root = plainRoot("conductor-5.4a-cfgvalid-");
  const written = configuredConfig();
  const target = writeConfigFile(root, JSON.stringify(written, null, 2));

  assert.equal(
    configPath(root),
    target,
    "configPath must name §2.1's location — <root>/.conductor/config.json — as ONE literal the plugin and Task 12.2 share",
  );

  const loaded: LoadedConfig = loadConfig(root);

  assert.equal(loaded.repoConfigured, true, "a present config means the repo IS configured (§3.2)");
  assert.deepEqual(
    loaded.config,
    written,
    "every §2.1 value is preserved field for field — the loader parses, it does not re-derive",
  );
  assert.notDeepEqual(
    loaded.config,
    DOCUMENTED_DEFAULT_CONFIG,
    "premise: the fixture config differs from the default, so field-for-field preservation is a real check",
  );
  assert.equal(
    validate("Config", loaded.config).ok,
    true,
    "what the loader returns is a schema-valid §2.1 Config by the committed validator's own judgement",
  );

  // The values the rest of the composition actually consumes survived the round
  // trip: the store reads retention, the journal reads logging, the gates read git.
  assert.equal(loaded.config.git.mode, "commit-and-push", "the git block is the file's, not a default");
  assert.equal(loaded.config.logging.level, "debug", "the logging block the journal binds to is the file's");
  assert.equal(loaded.config.retention.keepRuns, 3, "the retention block the store prunes by is the file's");
});

// ===========================================================================
// 5.4a-config-absent-defaults
// ===========================================================================

test("[5.4a-config-absent-defaults] an ABSENT config file yields the documented default with repoConfigured false and does not throw", () => {
  const root = plainRoot("conductor-5.4a-cfgabsent-");
  assert.equal(
    existsSync(path.join(root, ".conductor", "config.json")),
    false,
    "premise: a repo conductor has never been set up in has no config file",
  );

  const loaded = loadConfig(root);

  assert.equal(
    loaded.repoConfigured,
    false,
    "an unconfigured repo is the ordinary FIRST-RUN case (§3.2), reported through the flag legalTools already takes — not an error",
  );
  assert.deepEqual(
    loaded.config,
    DOCUMENTED_DEFAULT_CONFIG,
    "the config in force with no file is the documented default, field for field",
  );

  // A caller mutating its copy must not poison the next caller's defaults: the
  // default is the product's single source, and one mutable shared object would
  // let any consumer silently rewrite it for everyone.
  let frozen = false;
  try {
    (loaded.config as { git: { mode: string } }).git.mode = "commit-and-push";
  } catch {
    frozen = true;
  }
  const second = loadConfig(root);
  assert.equal(
    second.config.git.mode,
    "read-only",
    `a later load still gets the documented default (the first result was ${frozen ? "frozen" : "mutable"}) — the default cannot be rewritten by a consumer`,
  );
  assert.equal(second.repoConfigured, false, "and it is still reported as unconfigured");
});

// ===========================================================================
// 5.4a-config-malformed-is-loud
// ===========================================================================

test("[5.4a-config-malformed-is-loud] an unparseable or schema-invalid config is a LOUD failure naming the file and the validator's own errors — never a silent fallback to defaults", () => {
  // (a) present but not JSON at all.
  const rootA = plainRoot("conductor-5.4a-cfgtorn-");
  const targetA = writeConfigFile(rootA, '{"version": 1, "git": {"mode": "read-only",\n');
  let caughtA: unknown;
  try {
    loadConfig(rootA);
  } catch (err) {
    caughtA = err;
  }
  assert.ok(caughtA instanceof Error, "an unparseable config file must THROW, not fall back to defaults");
  assert.ok(
    (caughtA as Error).message.includes(targetA),
    `the failure must name the file it could not read (message was: ${(caughtA as Error).message})`,
  );

  // (b) parses, but is not a §2.1 Config. The thrown message must carry the
  //     errors validate("Config", …) itself produced — proof the loader routes
  //     through the committed validator rather than a hand-rolled field check.
  const rootB = plainRoot("conductor-5.4a-cfginvalid-");
  const invalid = configuredConfig() as unknown as { git: { mode: string }; workflow?: unknown };
  invalid.git.mode = "none"; // not a member of the §2.1 GIT_MODES enum
  delete invalid.workflow; // and a whole required block is missing
  const expected = validate("Config", invalid);
  assert.equal(expected.ok, false, "premise: the fixture really is schema-invalid");
  assert.ok(expected.errors.length > 0, "premise: the validator produced error text to compare against");

  const targetB = writeConfigFile(rootB, JSON.stringify(invalid, null, 2));
  let caughtB: unknown;
  try {
    loadConfig(rootB);
  } catch (err) {
    caughtB = err;
  }
  assert.ok(caughtB instanceof Error, "a schema-invalid config must THROW");
  const messageB = (caughtB as Error).message;
  assert.ok(messageB.includes(targetB), `the failure must name the offending file (message was: ${messageB})`);
  for (const expectedError of expected.errors) {
    assert.ok(
      messageB.includes(expectedError),
      `the failure must carry the validator's OWN error text — missing "${expectedError}" from: ${messageB}`,
    );
  }

  // (c) an UNKNOWN key. The §2.1 schema sets additionalProperties:false at every
  //     level, so the committed validator rejects it; a hand-rolled "check the
  //     fields I know about" loader would wave it through. This is the arm that
  //     separates the two implementations.
  const rootC = plainRoot("conductor-5.4a-cfgextra-");
  const extra = configuredConfig() as unknown as Record<string, unknown>;
  extra.gitMode = "commit"; // a plausible typo for git.mode, and a silent downgrade
  const targetC = writeConfigFile(rootC, JSON.stringify(extra, null, 2));
  let caughtC: unknown;
  try {
    loadConfig(rootC);
  } catch (err) {
    caughtC = err;
  }
  assert.ok(
    caughtC instanceof Error,
    "an unknown top-level key must be REFUSED (additionalProperties:false) — a config typo must not read as a valid config",
  );
  assert.ok((caughtC as Error).message.includes(targetC), "and that failure names the file too");

  // Nothing was silently defaulted anywhere: all three roots still hold their
  // malformed file, and none of the three calls returned.
  for (const [root, target] of [
    [rootA, targetA],
    [rootB, targetB],
    [rootC, targetC],
  ] as const) {
    assert.equal(existsSync(target), true, `${root}: the offending config file is left on disk for the human to fix`);
  }
});

// ===========================================================================
// 5.4a-default-config-is-safe-not-permissive
// ===========================================================================

test("[5.4a-default-config-is-safe-not-permissive] the exported DEFAULT_CONFIG is the documented default field by field, is safe-by-construction rather than permissive, and is the single source Task 12.2 must honour", () => {
  assert.equal(
    validate("Config", DEFAULT_CONFIG).ok,
    true,
    "the default must itself be a schema-valid §2.1 Config — it is handed straight to openWorkspace and createJournal",
  );
  assert.deepEqual(
    DEFAULT_CONFIG,
    DOCUMENTED_DEFAULT_CONFIG,
    "DEFAULT_CONFIG is the documented default, field for field (the pin lives in this file's header comment)",
  );

  // The four safety-critical values, called out individually so a future edit
  // that quietly loosens one fails on its own line with its own reason.
  assert.notEqual(
    DEFAULT_CONFIG.git.mode,
    "commit",
    "plan line 545: git.mode is ASKED on first run and NEVER defaulted — an unconfigured repo must not be assumed committable",
  );
  assert.equal(DEFAULT_CONFIG.git.mode, "read-only", "the safe default is the mode that cannot write history");
  assert.equal(
    DEFAULT_CONFIG.git.preexistingDirty,
    "refuse",
    "a pre-existing dirty path blocks the item rather than being swept into a conductor commit (§3.3)",
  );
  assert.deepEqual(
    DEFAULT_CONFIG.verify.behavioralPaths,
    ["**"],
    "with no configured behavioralPaths every path owes verification; an empty list would make behavioral:false legal for ALL code",
  );
  assert.deepEqual(
    DEFAULT_CONFIG.verify.scopes,
    {},
    "conductor does not invent a test command for a repo it has not been set up in",
  );
  assert.equal(
    DEFAULT_CONFIG.models.default,
    "",
    "G13's model is validated against the live /v1/models list; naming one nobody chose would silently pick weights for the user",
  );

  // Single source (1): the journal's own §7.1 default level.
  assert.equal(
    DEFAULT_CONFIG.logging.level,
    DEFAULT_LEVEL,
    "the default config's log level IS core/journal-events.ts DEFAULT_LEVEL — two spellings of the §7.1 default would drift",
  );

  // Single source (2): the CROSS-TASK OBLIGATION. scripts/conductor_wiring.py:63-68
  // says in its own words: "this module owns the default as ONE literal. Task 12.2
  // writes .conductor/config.json and must use the same number, or the two defaults
  // drift with nothing to catch it." This is the check that catches it.
  const wiringPath = path.join(repoRoot, "scripts", "conductor_wiring.py");
  assert.equal(existsSync(wiringPath), true, `premise: the §12.1 wiring module is at ${wiringPath}`);
  const wiringSource = readFileSync(wiringPath, "utf8");
  const readersMatch = /^DEFAULT_MAX_READERS\s*=\s*(\d+)\s*$/m.exec(wiringSource);
  const timeoutMatch = /^SUB_SESSION_TIMEOUT_MS\s*=\s*(\d+)\s*$/m.exec(wiringSource);
  assert.ok(readersMatch !== null, "premise: conductor_wiring.py declares DEFAULT_MAX_READERS as one literal");
  assert.ok(timeoutMatch !== null, "premise: conductor_wiring.py declares SUB_SESSION_TIMEOUT_MS as one literal");
  assert.equal(
    DEFAULT_CONFIG.parallel.maxReaders,
    Number((readersMatch as RegExpExecArray)[1]),
    "DEFAULT_CONFIG.parallel.maxReaders must equal conductor_wiring.py DEFAULT_MAX_READERS — serve.py derives llama-server's --parallel from that number, so a drift makes the fan-out serialize upstream while both tasks' tests stay green",
  );
  assert.equal(
    DEFAULT_CONFIG.parallel.subSessionTimeoutMs,
    Number((timeoutMatch as RegExpExecArray)[1]),
    "and the fan-out watchdog default must equal conductor_wiring.py SUB_SESSION_TIMEOUT_MS for the same reason",
  );
});

// ===========================================================================
// 5.4a-plugin-exposes-chat-message
// ===========================================================================

test("[5.4a-plugin-exposes-chat-message] the factory's hooks gain a `chat.message` function ALONGSIDE the unchanged tool map and the unchanged, still-denying tool.execute.before", async () => {
  const root = plainRoot("conductor-5.4a-hooks-");
  const hooks = await startPlugin(root);

  assert.equal(
    typeof hooks["chat.message"],
    "function",
    "the plugin installs a chat.message hook — the production caller handleChatMessage has never had one",
  );

  // Additive, not displacing: the committed §3.4 inventory is untouched.
  assert.equal(typeof hooks.tool, "object", "the `tool` map survives");
  assert.notEqual(hooks.tool, null, "the `tool` map is not null");
  assert.deepEqual(
    Object.keys(hooks.tool ?? {}).sort(),
    [...CONDUCTOR_TOOL_NAMES].sort(),
    "the plugin still registers EXACTLY the §3.4 22-tool inventory",
  );

  // …and the gate hook still adjudicates. The spawn deny is the load-bearing half
  // of §3.5 (:1356-1360) and is unconditional — it depends on no config, no
  // registry entry and no git mode, so it proves the gate still runs without
  // pinning anything this task-let leaves free.
  assert.equal(typeof hooks["tool.execute.before"], "function", "the gate hook survives");
  const err = await expectDeny(
    () =>
      callGate(hooks, {
        tool: "task",
        sessionID: SESSION,
        args: { description: "d", prompt: "p", subagent_type: "conductor-implementer" },
      }),
    "spawn after the composition edits",
  );
  assert.match(
    err.message,
    /spawn|task/i,
    "the spawn deny still names the spawn rule — the composition edits did not displace the committed gate",
  );
});

// ===========================================================================
// 5.4a-chat-message-creates-run
// ===========================================================================

test("[5.4a-chat-message-creates-run] driving the real chat.message hook against a real repo writes a schema-valid §2.3 run.json carrying the prompt and the provisional classification, and points current-run at it", async () => {
  const root = gitRoot("conductor-5.4a-create-");
  const hooks = await startPlugin(root);

  assert.equal(currentRunId(root), null, "precondition: no run is live in a fresh workspace");

  const promptA = "PROMPT-A-9f3a: add the config reader";
  const promptB = "PROMPT-B-2c8d: and wire it into the plugin";
  await sendChatMessage(hooks, SESSION, [promptA, promptB]);

  // Asserted by READING THE DISK, not by trusting a return value — the opencode
  // chat.message hook returns Promise<void>, so the artifact is the only evidence.
  const runId = currentRunId(root);
  assert.ok(runId !== null, "the §1.2 current-run pointer names the newly created run");
  assert.equal(countRuns(root), 1, "exactly one run directory exists after the first prompt");

  const runJson = path.join(runDirOf(root, runId as string), "run.json");
  assert.equal(existsSync(runJson), true, `the run is durable on disk at ${runJson}`);

  const run = readRun(root, runId as string);
  const schema = validate("Run", run);
  assert.equal(schema.ok, true, `run.json must be a schema-valid §2.3 Run: ${schema.errors.join("; ")}`);
  assert.equal(run.runId, runId, "the run.json names the run the pointer names");
  assert.equal(run.state, "INTAKE", "a new run starts at the head of the §3.1 run FSM");
  assert.equal(run.sessionID, SESSION, "the run records the arriving orchestrator session");
  assert.equal(run.stop, null, "a fresh run has no stop recorded");

  // The prompt is assembled from the TEXT parts, in order, and nothing else.
  assert.ok(run.prompt.includes(promptA), "the run carries the first text part's text");
  assert.ok(run.prompt.includes(promptB), "the run carries the second text part's text");
  assert.ok(
    run.prompt.indexOf(promptA) < run.prompt.indexOf(promptB),
    "the text parts are assembled in arrival order",
  );
  assert.equal(
    run.prompt.includes("NOT-A-PROMPT-4b7e"),
    false,
    "a non-text part contributes nothing to the prompt — the builder selects by part type, not by position",
  );

  // The provisional classification handleChatMessage supplies (chat-message.ts:86-90):
  // kind "work" keeps the run in INTAKE, and the check is recorded as not-yet-agreed
  // because the skeptic CLASSIFICATION_CHECK has not run.
  assert.equal(run.classification.kind, "work", "the provisional classification keeps the run in INTAKE (plan line 1093)");
  assert.equal(
    run.classification.check.agreed,
    false,
    "the classification check is recorded as NOT agreed — conductor_classify has not run yet",
  );
  assert.ok(run.classification.rationale.length > 0, "the provisional classification carries a rationale");

  // The git provenance the store captures came from the real fixture repo.
  assert.equal(
    run.startHead,
    git(root, ["rev-parse", "HEAD"]).trim(),
    "startHead is the fixture repo's real HEAD — the run went through the real store, not a stub",
  );
  assert.equal(run.startBranch, "main", "startBranch is the fixture's branch");
});

// ===========================================================================
// 5.4a-chat-message-registers-orchestrator
// ===========================================================================

test("[5.4a-chat-message-registers-orchestrator] after the hook call the arriving session is registered with role 'orchestrator' in the registry the PLUGIN holds — proven through the gate that consults it, not a test-local copy", async () => {
  const root = plainRoot("conductor-5.4a-register-");
  const hooks = await startPlugin(root);

  // Before: a conductor-class call from this session is denied by the REGISTRY
  // rule (core/gates-edit.ts decideSession: "conductor state advances only from
  // registered sessions; this session has no registry entry").
  const before = await expectDeny(
    () => callGate(hooks, { tool: "conductor_status", sessionID: SESSION, args: {} }),
    "conductor tool before any chat.message",
  );
  assert.match(
    before.message,
    /registered sessions|no registry entry/i,
    "the pre-registration deny is the registry rule's own reason",
  );

  await sendChatMessage(hooks, SESSION, ["register me"]);

  // After: the SAME conductor-class call passes the session gate. Nothing else
  // changed — same plugin instance, same session, same tool.
  await callGate(hooks, { tool: "conductor_status", sessionID: SESSION, args: {} });

  // And the ROLE is specifically "orchestrator": the edit gate's per-role branch
  // (gates-edit.ts decideEdit) answers an orchestrator with G8's inline-claim
  // rule, a reason no other role produces.
  const roleProof = await expectDeny(
    () =>
      callGate(hooks, {
        tool: "edit",
        sessionID: SESSION,
        args: { filePath: path.join(root, "src", "a.ts"), oldString: "a", newString: "b" },
      }),
    "orchestrator edit after registration",
  );
  assert.match(
    roleProof.message,
    /inline claim/i,
    "an orchestrator's edit meets G8's inline-claim rule — the role in the registry really is 'orchestrator'",
  );
  assert.match(roleProof.message, /orchestrator/i, "and the reason names the role it adjudicated");

  // A DIFFERENT session that never sent a prompt is still unregistered: the hook
  // registered the arriving session, not everyone.
  const stray = await expectDeny(
    () => callGate(hooks, { tool: "conductor_status", sessionID: OTHER_SESSION, args: {} }),
    "conductor tool from a session that never prompted",
  );
  assert.match(
    stray.message,
    /registered sessions|no registry entry/i,
    "registration is per session — a stray session is still denied by the registry rule",
  );
});

// ===========================================================================
// 5.4a-registration-reaches-the-gate  (the load-bearing row)
// ===========================================================================

test("[5.4a-registration-reaches-the-gate] the SAME edit from the SAME session is denied as unregistered before a chat.message and adjudicated as the orchestrator after it — one registry, two consumers, proven by behaviour change", async () => {
  const root = plainRoot("conductor-5.4a-onereg-");
  const hooks = await startPlugin(root);

  const editPath = path.join(root, "src", "feature.ts");
  const editArgs = { filePath: editPath, oldString: "a", newString: "b" };
  const edit = (): Promise<void> => callGate(hooks, { tool: "edit", sessionID: SESSION, args: editArgs });

  // BEFORE: the registry gate runs first and denies by the REGISTRY rule — the
  // reason names the missing item assignment, not any scope or role.
  const denied = await expectDeny(edit, "edit before any chat.message");
  assert.match(
    denied.message,
    /item assignment|registered/i,
    "an unregistered session's edit is denied by the registry rule (§3.5)",
  );
  assert.doesNotMatch(
    denied.message,
    /inline claim/i,
    "premise: before registration the edit never reaches the per-role branch, so G8's reason is absent",
  );

  await sendChatMessage(hooks, SESSION, ["do the work"]);

  // AFTER: byte-for-byte the same call, on the same plugin instance. It is now
  // adjudicated by the ORCHESTRATOR branch of the edit gate. The deny is still a
  // deny (G8 forbids orchestrator source edits without an inline claim) but the
  // REASON has changed — and that change is only possible if the entry
  // handleChatMessage wrote is in the very map gateBeforeToolCall reads.
  const adjudicated = await expectDeny(edit, "the same edit after the chat.message");
  assert.match(
    adjudicated.message,
    /inline claim/i,
    "after registration the same edit is judged by G8's orchestrator rule — the registration reached the gate",
  );
  assert.match(adjudicated.message, /orchestrator/i, "and the reason names the orchestrator role");
  assert.doesNotMatch(
    adjudicated.message,
    /item assignment/i,
    "it is NOT the registry reason any more: two separate registries would have left this unchanged",
  );
  assert.notEqual(
    adjudicated.message,
    denied.message,
    "the deny reason genuinely changed — the whole point of this row",
  );
});

// ===========================================================================
// 5.4a-midrun-prompt-routed-not-recreated
// ===========================================================================

test("[5.4a-midrun-prompt-routed-not-recreated] a second prompt arriving while the first run is live is routed into it: no second run dir, the pointer is unmoved, and the journaled route names the LIVE runId", async () => {
  const root = gitRoot("conductor-5.4a-midrun-");
  const hooks = await startPlugin(root);

  const first = "FIRST-PROMPT-1a2b: the task";
  await sendChatMessage(hooks, SESSION, [first]);
  const liveRunId = currentRunId(root);
  assert.ok(liveRunId !== null, "precondition: the first prompt created the live run");
  assert.equal(countRuns(root), 1, "precondition: exactly one run exists");
  const createdIso = readRun(root, liveRunId as string).createdIso;

  const midrun = "MIDRUN-CONTEXT-9f3a: also handle the edge case";
  await sendChatMessage(hooks, SESSION, [midrun]);

  assert.equal(countRuns(root), 1, "a mid-run prompt creates NO second run directory (plan line 1073)");
  assert.equal(currentRunId(root), liveRunId, "the current-run pointer still names the live run");
  const after = readRun(root, liveRunId as string);
  assert.equal(after.createdIso, createdIso, "the live run.json was not re-created");
  assert.ok(after.prompt.includes(first), "the run still records the prompt that created it, not the mid-run one");
  assert.equal(
    after.prompt.includes(midrun),
    false,
    "a routed mid-run prompt does not overwrite the run's creating prompt",
  );

  // The hook returns void, so the route is asserted where it is durable: the
  // §7.4 `user.midrun-prompt` record, in the LIVE run's journal, correlated to
  // the live run and carrying the routed text (chat-message.ts:117).
  const records = readJournalFile(runDirOf(root, liveRunId as string));
  const routed = records.filter((r) => r.component === "state" && r.event === "user.midrun-prompt");
  assert.equal(routed.length, 1, "the mid-run route is journaled exactly once");
  assert.equal(routed[0].runId, liveRunId, "the journaled route names the LIVE runId it was folded into");
  assert.ok(
    JSON.stringify(routed[0].data).includes(midrun),
    "the routed prompt text is preserved — the orchestrator context must not be lost",
  );
});

// ===========================================================================
// 5.4a-journal-rebinds-to-run-dir  (spec SG-1, both halves)
// ===========================================================================

test("[5.4a-journal-rebinds-to-run-dir] pre-run records go to the stderr sink and create no file; once a run dir exists the journal rebinds to <runDir>/journal.jsonl — and the pre-run records are NOT replayed into it", async () => {
  const root = gitRoot("conductor-5.4a-journal-");
  const hooks = await startPlugin(root);

  assert.equal(
    existsSync(runsDirOf(root)),
    false,
    "premise: no run directory — and therefore no journal file — can exist before the first hook call",
  );

  const captured = await captureStderr(async () => {
    await sendChatMessage(hooks, SESSION, ["start the run"]);
  });

  const runId = currentRunId(root);
  assert.ok(runId !== null, "the prompt created a run");
  const runDir = runDirOf(root, runId as string);

  // --- the pre-run half: openWorkspace's own records went to stderr ----------
  const lockRecords = captured.records.filter(
    (r) => r.component === "state" && r.event === "lock.acquired",
  );
  assert.equal(
    lockRecords.length,
    1,
    `the workspace lock — journaled by openWorkspace BEFORE any run exists — is written exactly once to the §7.1 stderr sink (captured lines: ${JSON.stringify(captured.lines)})`,
  );
  assert.ok(
    typeof lockRecords[0].level === "string" && (lockRecords[0].level as string).length > 0,
    "the stderr sink emits one JSON object per record carrying {level, component, event, data, corr}",
  );

  // --- the rebound half: the run's own records are in the FILE ---------------
  const journalPath = path.join(runDir, "journal.jsonl");
  assert.equal(existsSync(journalPath), true, `the journal rebound to the run directory at ${journalPath}`);
  const fileRecords = readJournalFile(runDir);
  assert.ok(fileRecords.length > 0, "the rebound journal actually wrote records");
  for (const record of fileRecords) {
    const schema = validate("JournalRecord", record);
    assert.equal(schema.ok, true, `every line is a schema-valid §7.2 JournalRecord: ${schema.errors.join("; ")}`);
    assert.equal(
      isKnownEvent(record.component, record.event),
      true,
      `and names an event inside the closed §7.4 vocabulary (${record.component}/${record.event})`,
    );
  }
  const created = fileRecords.filter((r) => r.component === "state" && r.event === "run.created");
  assert.equal(created.length, 1, "the run's creation is journaled once, into the run's own journal");
  assert.equal(created[0].runId, runId, "correlated to the run it created");
  assert.equal(created[0].data.runId, runId, "and its data names the run");

  // --- THE NEGATIVE HALF: no replay ------------------------------------------
  // Buffering the pre-run records and flushing them on rebind would file records
  // under a run they did not belong to and break replay's source-order guarantee
  // (Task 15.0's 15.0-order-file-not-seq). They were correctly stderr-only.
  assert.deepEqual(
    fileRecords.filter((r) => r.event === "lock.acquired"),
    [],
    "the pre-run lock record is NOT replayed into the run's journal — it belongs to the workspace, not to this run",
  );

  // A second prompt on the SAME plugin instance must not re-open the workspace:
  // a second lock.acquired would land in the file, which is how a re-open would
  // announce itself.
  await sendChatMessage(hooks, SESSION, ["more context"]);
  assert.deepEqual(
    readJournalFile(runDir).filter((r) => r.event === "lock.acquired"),
    [],
    "the workspace is opened ONCE per plugin instance — a per-hook re-open would journal another lock.acquired, now into the file",
  );
});

// ===========================================================================
// 5.4a-workspace-opened-lazily-and-realpathed  (spec SG-3)
// ===========================================================================

test("[5.4a-workspace-opened-lazily-and-realpathed] the factory opens no workspace at construction (the committed gate-wiring test constructs against a non-existent directory) and, when it does open, uses the REALPATH of input.directory", async () => {
  // (a) Construction against a directory that does not exist must not throw and
  //     must not touch the filesystem — conductor/tests/gate-wiring.test.ts:313-333
  //     constructs the factory against `directory: "/repo"` and must keep passing.
  const absent = path.join(tmpdir(), "conductor-5.4a-absent-4b7e", "no", "such", "dir");
  assert.equal(existsSync(absent), false, "premise: the directory really is absent");
  const hooksAbsent = await startPlugin(absent);
  assert.equal(typeof hooksAbsent.tool, "object", "the factory still resolves against a non-existent directory");
  assert.equal(existsSync(absent), false, "and it created nothing there — construction does no filesystem work");

  // (b) Against a real root, `.conductor/` must not appear until a hook runs.
  const eager = plainRoot("conductor-5.4a-lazy-");
  const hooksEager = await startPlugin(eager);
  assert.equal(
    existsSync(path.join(eager, ".conductor")),
    false,
    "the factory did NOT open the workspace at construction — an eager open breaks the committed gate-wiring test",
  );
  await sendChatMessage(hooksEager, SESSION, ["open it now"]);
  assert.equal(
    existsSync(path.join(eager, ".conductor")),
    true,
    "the workspace is opened on FIRST HOOK USE — lazily, not never",
  );

  // (c) The root is the REALPATH of input.directory. §0.2 wire-notes pins this as
  //     a DRIFT: "opencode canonicalizes session directories (macOS /var/... tmp
  //     paths become /private/var/...); a NON-canonical directory makes in-project
  //     edits ask for external_directory instead of edit — the adapter must
  //     realpath every directory it hands opencode." A symlinked root is exactly
  //     how the scope gates would silently mis-match.
  const parent = plainRoot("conductor-5.4a-realpath-");
  const realRoot = path.join(parent, "real-workspace");
  mkdirSync(realRoot);
  const linkRoot = path.join(parent, "link-workspace");
  symlinkSync(realRoot, linkRoot);
  assert.notEqual(
    realpathSync(linkRoot),
    linkRoot,
    "premise: the symlinked root really does resolve to a different string",
  );
  assert.equal(realpathSync(linkRoot), realRoot, "premise: it resolves to the real root");

  const hooksLinked = await startPlugin(linkRoot);
  await sendChatMessage(hooksLinked, SESSION, ["work through the symlink"]);

  const runId = currentRunId(realRoot);
  assert.ok(runId !== null, "the run was created under the real root");
  const created = readJournalFile(runDirOf(realRoot, runId as string)).filter(
    (r) => r.component === "state" && r.event === "run.created",
  );
  assert.equal(created.length, 1, "the run.created record is the one place the resolved root is observable (§7.4)");
  assert.equal(
    created[0].data.root,
    realRoot,
    "the workspace root the plugin resolved is the REALPATH of input.directory",
  );
  assert.notEqual(
    created[0].data.root,
    linkRoot,
    "and it is NOT the symlink opencode handed in — an un-canonicalized root is the silent scope mis-match §0.2 records",
  );
});

// ===========================================================================
// 5.4a-construction-failure-denies-loudly
// ===========================================================================

test("[5.4a-construction-failure-denies-loudly] a workspace that cannot be opened is reported LOUDLY on the §7.1 stderr sink naming the cause, and the gate hook still DENIES rather than being absent", async () => {
  // A root that is a regular FILE: openWorkspace's first mkdir fails with a real,
  // deterministic errno (no chmod, no privilege dependence). realpathSync resolves
  // it fine, so the failure lands exactly where SG-3 says it must — at the lazy
  // open, not at construction.
  const parent = plainRoot("conductor-5.4a-badroot-");
  const fileRoot = path.join(parent, "not-a-directory");
  writeFileSync(fileRoot, "this is a file, not a workspace\n");

  // The errno the store will really hit, measured rather than assumed.
  let expectedCode = "";
  try {
    mkdirSync(path.join(fileRoot, ".conductor", "state"), { recursive: true });
  } catch (err) {
    expectedCode = String((err as NodeJS.ErrnoException).code ?? "");
  }
  assert.ok(expectedCode.length > 0, "premise: opening a workspace under a file really does fail with an errno");

  const hooks = await startPlugin(fileRoot);
  assert.equal(
    typeof hooks["tool.execute.before"],
    "function",
    "a workspace that cannot be opened must NOT make the gate hook absent — §3.8's silent-ungate is the most dangerous failure shape in this integration",
  );

  const captured = await captureStderr(async () => {
    await expectDeny(
      () =>
        callGate(hooks, {
          tool: "edit",
          sessionID: SESSION,
          args: { filePath: path.join(fileRoot, "src", "a.ts"), oldString: "a", newString: "b" },
        }),
      "edit against an unopenable workspace",
    );
  });

  const loud = captured.records.filter((r) => r.level === "error");
  assert.ok(
    loud.length >= 1,
    `the open failure is reported at ERROR level on the stderr sink (captured: ${JSON.stringify(captured.lines)})`,
  );
  const text = JSON.stringify(loud);
  assert.ok(text.includes(fileRoot), "the report names the workspace root it could not open");
  assert.ok(
    text.includes(expectedCode),
    `the report names the CAUSE (${expectedCode}), not just that something went wrong`,
  );
});

// ===========================================================================
// IV.2-second-session-refused (GAP-027, owner decision D6)
// ===========================================================================

test("[IV.2-second-session-refused] a workspace already held by a live conductor is refused LOUDLY at the composition root — the record names the holder, the gate still denies, and no run is created", async () => {
  const root = gitRoot("conductor-iv2-second-session-");
  // A holder that is alive, foreign, and not over-age: pid 1 always exists and is
  // never this process, and probing it reports EPERM rather than ESRCH — which the
  // liveness rule counts as alive, exactly as it must for a lock owned by another
  // user's conductor.
  mkdirSync(stateDirOf(root), { recursive: true });
  writeFileSync(
    path.join(stateDirOf(root), "run.lock"),
    JSON.stringify({ pid: 1, startMs: Date.now(), sessionID: "ses_holder_5f3a" }),
  );

  const hooks = await startPlugin(root);
  assert.equal(
    typeof hooks["tool.execute.before"],
    "function",
    "a refused second session must NOT make the gate hook absent — an ungated session is worse than a refused one",
  );

  const captured = await captureStderr(async () => {
    await expectDeny(
      () =>
        callGate(hooks, {
          tool: "edit",
          sessionID: SESSION,
          args: { filePath: path.join(root, "src", "a.ts"), oldString: "a", newString: "b" },
        }),
      "edit from a session that does not hold the workspace",
    );
    await sendChatMessage(hooks, SESSION, ["a prompt arriving in a workspace someone else holds"]);
  });

  const loud = captured.records.filter((r) => r.level === "error" && r.event === "lock.contended");
  assert.ok(
    loud.length >= 1,
    `the refusal is reported at ERROR level under lock.contended (captured: ${JSON.stringify(captured.lines)})`,
  );
  const text = JSON.stringify(loud);
  assert.ok(text.includes('"holderPid":1'), "the refusal names the HOLDER's pid, so the operator knows which session to close");
  assert.ok(text.includes("ses_holder_5f3a"), "and the holder's session id");

  const runsDir = path.join(root, ".conductor", "runs");
  const runDirs = existsSync(runsDir) ? readdirSync(runsDir) : [];
  assert.deepEqual(runDirs, [], "the refused session created no run: it never got a store to write one with");
  assert.equal(
    JSON.parse(readFileSync(path.join(stateDirOf(root), "run.lock"), "utf8")).sessionID,
    "ses_holder_5f3a",
    "and the holder's lock is untouched",
  );
});

// ===========================================================================
// 5.4a-hook-failsoft-does-not-break-the-session
// ===========================================================================

test("[5.4a-hook-failsoft-does-not-break-the-session] a throw from inside handleChatMessage is caught by the hook, journaled once at error level under a listed §7.4 event, and does not propagate out of the hook (G5)", async () => {
  const root = plainRoot("conductor-5.4a-failsoft-");

  // The injection. The plugin owns its own store, so a fake store cannot be
  // handed in; the equivalent real-world fault is a torn run.json left by a
  // crash. handleChatMessage's FIRST act is store.currentRun() (chat-message.ts:108),
  // and state.ts currentRun -> loadRun -> readJsonFileSync does NOT swallow a
  // parse failure (state.ts:544-561), so this throws from inside the hook body.
  const staleRunId = "r-20260101-abcd";
  mkdirSync(runDirOf(root, staleRunId), { recursive: true });
  writeFileSync(path.join(runDirOf(root, staleRunId), "run.json"), '{"runId": TORN_BY_A_CRASH_5f3a}\n');
  mkdirSync(stateDirOf(root), { recursive: true });
  writeFileSync(path.join(stateDirOf(root), "current-run.json"), JSON.stringify({ runId: staleRunId }));

  const hooks = await startPlugin(root);

  const captured = await captureStderr(async () => {
    // The whole point: this must RESOLVE. A conductor that fails must not take
    // the user's opencode session down with it (G5).
    await sendChatMessage(hooks, SESSION, ["this prompt hits a torn run.json"]);
  });

  const errors = captured.records.filter((r) => r.level === "error");
  assert.equal(
    errors.length,
    1,
    `the failure is journaled exactly ONCE at error level — not swallowed silently, not logged per layer (captured: ${JSON.stringify(captured.lines)})`,
  );
  const record = errors[0];
  assert.equal(
    isKnownEvent(String(record.component), String(record.event)),
    true,
    `the fail-soft record names an event core/journal-events.ts LISTS (got ${String(record.component)}/${String(record.event)}) — the real createJournal THROWS on an unlisted name, which would turn this fail-soft path into a second crash`,
  );
  assert.match(
    String(record.event),
    /fail|error|crash/i,
    "and the name it uses reads as a failure rather than borrowing an unrelated event's name (§7.4 widening rule)",
  );
  const text = JSON.stringify(record);
  assert.match(
    text,
    /not valid JSON|Unexpected token|SyntaxError/i,
    "the record carries the underlying cause, so the failure is debuggable rather than merely counted",
  );

  // The session survives AND nothing was half-written: the torn run is still the
  // only run dir, and no fresh run was minted on top of the failure.
  assert.equal(
    readdirSync(runsDirOf(root)).length,
    1,
    "exactly the one pre-existing (torn) run directory is on disk — the failed hook created nothing",
  );
  assert.equal(
    currentRunId(root),
    staleRunId,
    "and the current-run pointer was not moved onto a run the failed hook never finished creating",
  );

  // And the plugin is still usable afterwards: the gate hook still adjudicates.
  const err = await expectDeny(
    () => callGate(hooks, { tool: "task", sessionID: SESSION, args: { description: "d", prompt: "p" } }),
    "spawn after a failed chat.message",
  );
  assert.match(err.message, /spawn|task/i, "a failed chat.message leaves the gates working, not disabled");
});

// ===========================================================================
// 5.4a-git-policy-comes-from-the-config
// ===========================================================================
//
// WHICH HALF OF `config.git` IS OBSERVABLE, AND WHY IT IS NOT `git.mode`.
// core/gates-git.ts:459-467 takes `gitMode` and immediately discards it —
// `void gitMode;` — under a doc comment that states the design: "git policy is
// role- and mode-uniform for model sessions: the publish/commit handler runs git
// through execFile inside the plugin, which is not a tool call and never reaches
// this gate, so sessionRole and gitMode do not branch the decision. Only the
// branch-movement rows read runActive/branchPolicy."
//
// So `git commit` is denied with the SAME conductor_publish reason under
// git.mode "read-only" and under "commit", and no probe through this hook can
// tell the two apart. The half of the §2.1 git block that DOES reach a decision
// is `branchPolicy`, through decideCheckout/decideSwitch -> movement()
// (gates-git.ts:172-188): under "pin" with an active run, branch movement is
// denied; under "check-only" the same command is ALLOWED. That allow/deny split
// is the negative control this row needs — a hardcoded "pin" denies in both
// configurations and fails part (a) below.
//
// `gitMode` is threaded from the config on the adjacent line and is inert only
// at THIS seam (it is live where publish legality is decided), so it is guarded
// where it is observable at all: part (c) reads the call site's source, the same
// audit idiom tests/journal-vocab.test.ts and tests/tool-binding.test.ts use for
// facts no runtime probe can see.

// A §2.1 config whose git block is the one thing under test; every other block is
// held constant so nothing but `git` can explain a difference in outcome.
function configWithGit(git: Config["git"]): Config {
  return { ...configuredConfig(), git };
}

const GIT_MOVEMENT = "git switch feature-x";
const GIT_COMMIT = 'git commit -m "wip"';

// Drive ONE bash command through the real `tool.execute.before` hook, from a
// REGISTERED session, in a workspace whose .conductor/config.json carries `git`.
// The config is written BEFORE the plugin starts, because the composition loads
// it once, lazily, on first hook use. Returns the deny reason, or null on allow.
async function gitPolicyOutcome(
  tag: string,
  git: Config["git"],
  command: string,
): Promise<string | null> {
  const root = plainRoot(tag);
  writeConfigFile(root, JSON.stringify(configWithGit(git), null, 2));
  const hooks = await startPlugin(root);
  // Registered: chat.message writes the §3.5 orchestrator entry, so the registry
  // gate passes and the GIT gate is the one actually deciding.
  await sendChatMessage(hooks, SESSION, ["work on the feature"]);
  try {
    await callGate(hooks, { tool: "bash", sessionID: SESSION, args: { command } });
  } catch (err) {
    assert.ok(err instanceof Error, `${tag}: a deny must throw an Error`);
    return (err as Error).message;
  }
  return null;
}

test("[5.4a-git-policy-comes-from-the-config] the gate's git policy is the repo's own §2.1 git block, not a hardcoded assumption: the SAME command from the SAME registered session is denied under branchPolicy 'pin' and ALLOWED under 'check-only', and the call site names config.git.mode rather than a literal", async () => {
  // (a) THE DISCRIMINATOR. Two workspaces differing in ONE field —
  //     git.branchPolicy — and the same command from the same registered session.
  //     A hardcoded "pin" denies both and fails here; a hardcoded "check-only"
  //     allows both and fails here. Only a policy read from the config passes.
  const pinned = await gitPolicyOutcome(
    "conductor-5.4a-gitpin-",
    { mode: "read-only", branchPolicy: "pin", preexistingDirty: "refuse" },
    GIT_MOVEMENT,
  );
  const checkOnly = await gitPolicyOutcome(
    "conductor-5.4a-gitcheck-",
    { mode: "read-only", branchPolicy: "check-only", preexistingDirty: "refuse" },
    GIT_MOVEMENT,
  );

  assert.ok(
    pinned !== null,
    "under the repo's git.branchPolicy 'pin' a branch movement during a live run is DENIED",
  );
  assert.match(
    pinned as string,
    /branchPolicy 'pin'|pinned to its branch/i,
    "and the deny is the branch-policy rule's own reason, not some other gate's",
  );
  assert.equal(
    checkOnly,
    null,
    `the SAME command under git.branchPolicy 'check-only' is ALLOWED — this is the negative control: a hardcoded "pin" denies here too, and a test that only asserted "denied" would pass against it (denied with: ${checkOnly})`,
  );

  // (b) The `git commit` pair, pinned for what it actually is. Both configurations
  //     deny with the SAME reason, because gates-git.ts:466 voids gitMode — which
  //     is why (a), not this, is the discriminator. This assertion is a TRIP-WIRE:
  //     if the core ever starts branching on gitMode these two diverge, this line
  //     goes red, and (a) can then be strengthened to discriminate on the mode.
  const commitUnderReadOnly = await gitPolicyOutcome(
    "conductor-5.4a-gitro-",
    { mode: "read-only", branchPolicy: "pin", preexistingDirty: "refuse" },
    GIT_COMMIT,
  );
  const commitUnderCommit = await gitPolicyOutcome(
    "conductor-5.4a-gitcm-",
    { mode: "commit", branchPolicy: "pin", preexistingDirty: "refuse" },
    GIT_COMMIT,
  );
  assert.ok(commitUnderReadOnly !== null, "a bash `git commit` is denied under git.mode 'read-only'");
  assert.ok(commitUnderCommit !== null, "and under git.mode 'commit' as well");
  assert.match(
    commitUnderReadOnly as string,
    /conductor_publish/,
    "the commit deny is the core git gate's reason, naming the tool that owns publishing",
  );
  assert.equal(
    commitUnderCommit,
    commitUnderReadOnly,
    "core/gates-git.ts:459-467 DISCARDS gitMode (`void gitMode;`), so a `git commit` probe cannot tell the two modes apart — if this line ever goes red the core has begun branching on gitMode and the discriminator above should move onto it",
  );

  // (c) The source guard for the half no probe can see. gitMode is passed on the
  //     line adjacent to branchPolicy, so hardcoding it is a live mutation that
  //     (a) alone would not catch. This is the tests/journal-vocab.test.ts idiom:
  //     a source audit where runtime observation is impossible, with an
  //     anti-vacuity floor so a broken extraction is RED, not a silent pass.
  const pluginPath = path.resolve(testsDir, "..", "plugin", "index.ts");
  const pluginSource = readFileSync(pluginPath, "utf8");
  const callStart = pluginSource.indexOf("gateBeforeToolCall({");
  assert.notEqual(callStart, -1, `premise: ${pluginPath} still delegates the decision to gateBeforeToolCall`);
  const callEnd = pluginSource.indexOf("});", callStart);
  assert.notEqual(callEnd, -1, "premise: the call site's argument object terminates readably");
  // Whole-line comments are dropped so prose above a field can never satisfy or
  // trip the checks below.
  const callSite = pluginSource
    .slice(callStart, callEnd)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(
    callSite.length > 120,
    `premise: the extracted call site is the real argument object (got ${callSite.length} chars) — a broken extraction must be red, never a vacuous green`,
  );

  assert.match(
    callSite,
    /gitMode\s*:\s*config\.git\.mode\b/,
    "the gate's gitMode is the repo's §2.1 git.mode — a config that is loaded and then ignored is the same downgrade as a config never read",
  );
  assert.match(
    callSite,
    /branchPolicy\s*:\s*config\.git\.branchPolicy\b/,
    "and its branchPolicy is the repo's too (the half part (a) proves behaviourally)",
  );
  assert.doesNotMatch(
    callSite,
    /gitMode\s*:\s*["'`]/,
    'gitMode must not be a hardcoded literal: the old `gitMode: "commit"` assumed every repo was committable, including one whose config says read-only',
  );
  assert.doesNotMatch(
    callSite,
    /branchPolicy\s*:\s*["'`]/,
    'branchPolicy must not be a hardcoded literal either — `branchPolicy: "pin"` is exactly the mutation part (a) catches',
  );
});

// ===========================================================================
// 5.4a-tools-still-throw-scope-fence  (spec SG-4 — the fence, now CROSSED)
// ===========================================================================
//
// This row was authored as a deliberate NEGATIVE: task-let 5.4a took the
// session/run lifecycle half of the composition root and left the 22 tool
// handlers bound to handlerNotBound, so the fence asserted the throw and named
// plan:2958 and Task 13.1 as the owner of the binding.
//
// TASK 13.1'S COMPOSITION-ROOT ROUND IS THE AUTHORIZED CROSSING. It binds every
// one of the 22 names to its committed adapter/tools.ts handler (spec
// docs/build/specs/task-13.1-composition-root.assertions.json, row
// 13.1-cr-fence-rewritten-not-deleted), so the throw this row used to assert is
// exactly what must no longer happen. The row is REWRITTEN to assert the
// positive, never deleted and never weakened: the count-of-22 assertion and the
// every-name-is-registered loop it also carries were never about the throw, and
// they survive verbatim. The behavioural depth of the binding lives in
// conductor/tests/composition-root.test.ts; what stays here is the fence itself.

test("[5.4a-tools-still-throw-scope-fence] every one of the 22 conductor tools is registered with a callable execute and NONE of them refuses with handlerNotBound any more — Task 13.1's composition-root round bound them to their committed handlers, and this fence records the crossing", async () => {
  const root = plainRoot("conductor-5.4a-fence-");
  const hooks = await startPlugin(root);
  const toolMap = hooks.tool ?? {};

  assert.equal(
    CONDUCTOR_TOOL_NAMES.length,
    22,
    "premise: the §3.4 inventory is the 22 names this fence covers",
  );

  for (const name of CONDUCTOR_TOOL_NAMES) {
    const definition = toolMap[name];
    assert.ok(definition !== undefined, `${name} is registered`);
    assert.equal(typeof definition.execute, "function", `${name} has an execute function`);

    let caught: unknown;
    try {
      await definition.execute({}, {});
    } catch (err) {
      caught = err;
    }
    if (caught === undefined) continue; // a tool that ran is bound by definition
    assert.ok(caught instanceof Error, `${name}'s refusal is an Error`);
    assert.doesNotMatch(
      (caught as Error).message,
      /no run handler is bound to this session/,
      `${name} must NOT refuse with the handlerNotBound message any more — Task 13.1 bound it to its committed handler, and a tool that still throws it is a tool no live opencode session can use`,
    );
  }
});
