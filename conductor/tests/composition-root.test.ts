// Task 13.1 COMPOSITION-ROOT round — red tests.
// Destination: conductor/tests/composition-root.test.ts
// Spec: docs/build/specs/task-13.1-composition-root.assertions.json — the 13
// `13.1-cr-` rows (CR-1, the binding) and the five `13.1-cr2-` rows (CR-2, the
// gate snapshot at the tool.execute.before seam). The CR-2 block is at the END
// of this file, under its own banner, and is RED at the CR-1 commit.
//
// SUBJECT: conductor/plugin/index.ts — the opencode plugin factory, EDITED.
//
// WHY THIS IS RED RIGHT NOW. At HEAD (plugin/index.ts:470-478) the `tool` map is
// built from CONDUCTOR_TOOL_NAMES with `execute: handlerNotBound(name)` for all
// 22 names, and handlerNotBound (:159-166) throws
//   `conductor tool "X" was invoked but no run handler is bound to this session`.
// So NOT ONE of the 21 committed handleX handlers in adapter/tools.ts is
// reachable through the plugin opencode actually loads: every scenario below that
// drives a tool dies on that throw. Task 13.1 landed without this glue (a
// recorded deviation in STATE.json tasks['13.1'].deviations), and this file is
// the red that names what the binding owes.
//
// HOW THESE TESTS BIND. Every row here is a claim about what the PLUGIN DOES when
// it is called, so all but two are bound by CALLING it — the real factory, a real
// configured fixture workspace, the real committed handlers underneath. The two
// exceptions are the halves no probe can see, and both are named by their own
// row: the inventory row's "still built by iterating the inventory" half and the
// marker-enumeration row's repo grep. Those two reuse the committed source-audit
// idiom at conductor/tests/composition.test.ts:1493-1530 — extract, drop
// whole-line comments so prose above a field cannot satisfy a check, and assert
// an anti-vacuity floor so a broken extraction is RED rather than a silent pass.
// The fence row also reads a file, because its subject IS a file
// (composition.test.ts's fence), not a behaviour.
//
// C-077 is honoured throughout: no expected value is ever computed by calling the
// thing under test. The reaches-the-committed-handler row derives its expected
// StatusResult by calling the COMMITTED handleStatus from adapter/tools.ts
// directly, and compares it against what the plugin's bound tool returned.
//
// ===========================================================================
// EXPECTED MODULE SURFACE — the one NEW export these tests require.
// ===========================================================================
//
// -- conductor/adapter/evidence.ts ------------------------------------------
//
//   // The live per-tree verify markers in a run directory, as the evidence
//   // layer's TREE SLUGS ("main" | "<itemId>"), sorted. markerPathOf (:631-636)
//   // composes `verify-running-<tree>.json` and is module-private, so nothing
//   // outside this module can enumerate the markers without re-deriving that
//   // filename — and two independently-derived spellings of one filename is how
//   // a freeze silently stops firing on one side only (CR-SG-3).
//   export function liveVerifyTrees(runDir: string): string[];
//
// Both seams the binding owes read THAT function: the WaveTreeState handed to
// handleDispatchWave (this commit) and the gate's verifyInFlightTree derivation
// (CR-2, the next commit).

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---- the subject ----------------------------------------------------------
import { ConductorPlugin } from "../plugin/index.ts";

// ---- committed subjects these tests compose over --------------------------
import { CONDUCTOR_TOOL_NAMES, handleSetup, handleStatus } from "../adapter/tools.ts";
import type { StatusResult } from "../adapter/tools.ts";
import { createFailoverState } from "../adapter/router-client.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { AMEND_OP_KINDS, parseAmendOps } from "../core/queue-amend.ts";
import type { QueueAmendOp } from "../core/queue-amend.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import { SCHEMAS } from "../core/types.ts";
import type { Config, Item, ItemState, Queue, QueueItem, RunState } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Structural mirrors of the opencode hook shapes. Kept LOCAL (not imported from
// @opencode-ai/plugin) so this file is a self-contained contract that also runs
// under Node type-stripping — the composition.test.ts idiom.
// ---------------------------------------------------------------------------

interface RegisteredTool {
  description: string;
  // The raw zod arg SHAPE the plugin declares for this tool — the half of the
  // contract a model reads. The queue-amend row below validates a real argument
  // against it, so it is part of the mirror.
  args?: Record<string, unknown>;
  execute: (args: unknown, context: unknown) => Promise<unknown>;
}

interface ToolBeforeHookInput {
  tool: string;
  sessionID: string;
  callID: string;
}

interface ToolBeforeHookOutput {
  args: Record<string, unknown>;
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

// One §7.4 journal record as it lands in <runDir>/journal.jsonl. The FILE shape
// is FLAT (adapter/journal.ts:247-258): {seq, ts, level, component, runId, event,
// data} plus OPTIONAL TOP-LEVEL itemId / sessionID. There is no `corr` object on
// a file record — core/types.ts journalRecordSchema pins exactly these keys with
// `additionalProperties: false`, and that schema is exported to the C++ router
// tests, so one cannot be added. conductor/tests/journal.test.ts:250 reads
// `rec.sessionID` top-level; that is the committed idiom.
//
// The §7.1 STDERR sink carries a `corr` object instead, and the bundle row below
// reads BOTH sinks — but it only ever reads `component`/`event` off the stderr
// half, which both shapes spell the same way.
interface Rec {
  seq?: unknown;
  ts?: unknown;
  level?: unknown;
  component?: unknown;
  runId?: unknown;
  itemId?: unknown;
  sessionID?: unknown;
  event?: unknown;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");
const pluginPath = path.join(conductorDir, "plugin", "index.ts");
const doctrineDir = path.join(conductorDir, "doctrine");

const SESSION = "ses_orchestrator_13cr";

const tmpDirs: string[] = [];

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  tmpDirs.push(dir);
  return dir;
}

// §4.2's out-of-repo state home is redirected into scratch for the WHOLE file:
// plugin/index.ts:300-304 stateCoordinates reads XDG_STATE_HOME first, and a test
// that drives a real verify must never write into the user's own ~/.local/state.
const priorXdgStateHome = process.env.XDG_STATE_HOME;
process.env.XDG_STATE_HOME = realpathSync(scratchDir("conductor-13.1-cr-xdg-"));

after(() => {
  if (priorXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = priorXdgStateHome;
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function plainRoot(tag: string): string {
  return realpathSync(scratchDir(tag));
}

// Hermetic git for BUILDING fixtures — no global/system config can leak in.
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

// A real git repo with a src/ and a tests/ tree, so item fileScope/testScope
// globs have something to point at.
function gitRoot(tag: string): string {
  const dir = plainRoot(tag);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "beta.ts"), "export const parse = (s: string): number => 7;\n");
  writeFileSync(path.join(dir, "tests", "beta.test.ts"), "export const covered = true;\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

// The §2.1 config shape, mirroring conductor/tests/e2e.test.ts:240-281.
interface ConfigOpts {
  scopeCommand?: string[];
  itemTest?: string[];
  subSessionTimeoutMs?: number;
  debugFixCap?: number;
  gitMode?: Config["git"]["mode"];
}

function makeConfig(opts: ConfigOpts = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        unit: {
          command: opts.scopeCommand ?? [process.execPath, "-e", "process.exit(0)"],
          timeoutMs: 60_000,
          itemTest: opts.itemTest ?? [process.execPath, "-e", "process.exit(0)"],
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [] },
    git: { mode: opts.gitMode ?? "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 2,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 0,
      debugFixCap: opts.debugFixCap ?? 1,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: {
      writes: "off",
      maxImplementers: 1,
      maxReaders: 2,
      subSessionTimeoutMs: opts.subSessionTimeoutMs ?? 4_000,
    },
    models: { default: "cr-test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// The plugin loads §2.1 from the repo's own .conductor/config.json, so a
// "configured fixture workspace" is a git repo that carries one (e2e.test.ts:286).
function writeRepoConfig(root: string, config: Config): void {
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  git(root, ["add", "-f", ".conductor/config.json"]);
  git(root, ["commit", "-m", "conductor config"]);
}

// ---------------------------------------------------------------------------
// Driving the real plugin
// ---------------------------------------------------------------------------

// A synthetic opencode PluginInput. `client` is the seam plugin/index.ts:627
// already casts for the event hook, and adapter/fanout.ts:93-104's FanoutClient
// needs the same three methods — so a fake SDK goes in exactly here.
function pluginInput(directory: string, client: unknown): unknown {
  return {
    client: client ?? {},
    project: { id: "prj_13cr", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

async function startPlugin(directory: string, client?: unknown): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(pluginInput(directory, client));
}

// The opencode ToolContext the runtime hands `execute`
// (node_modules/@opencode-ai/plugin/dist/tool.d.ts).
function toolCtx(sessionID: string, directory: string): unknown {
  return {
    sessionID,
    messageID: "msg_13cr",
    agent: "conductor",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

function toolMapOf(hooks: PluginHooks): Record<string, RegisteredTool> {
  const map = hooks.tool ?? {};
  assert.ok(Object.keys(map).length > 0, "premise: the plugin returns a non-empty `tool` map");
  return map;
}

function toolOf(hooks: PluginHooks, name: string): RegisteredTool {
  const definition = toolMapOf(hooks)[name];
  assert.ok(definition !== undefined, `premise: ${name} is registered in the plugin's tool map`);
  assert.equal(typeof definition.execute, "function", `premise: ${name} has an execute function`);
  return definition;
}

function callTool(
  hooks: PluginHooks,
  name: string,
  args: Record<string, unknown>,
  root: string,
  sessionID: string = SESSION,
): Promise<unknown> {
  return toolOf(hooks, name).execute(args, toolCtx(sessionID, root));
}

interface Attempt {
  threw: boolean;
  error: unknown;
  value: unknown;
}

async function attempt(fn: () => Promise<unknown>): Promise<Attempt> {
  try {
    const value = await fn();
    return { threw: false, error: undefined, value };
  } catch (err) {
    return { threw: true, error: err, value: undefined };
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return `<a non-Error refusal: ${JSON.stringify(err)}>`;
}

// opencode's ToolResult is `string | {output, ...}`, so a handler's own object
// arrives through one of a few shapes. Read whichever the binding chose — the
// row cares about the FIELDS reaching the caller, not the envelope.
function parseToolResult(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(
        "a bound tool must return its handler's own fields to the caller (as JSON in the " +
          "ToolResult, or as the result object itself); this one returned prose: " +
          raw.slice(0, 200),
      );
    }
  }
  if (raw !== null && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.output === "string") {
      try {
        return JSON.parse(obj.output) as Record<string, unknown>;
      } catch {
        const meta = obj.metadata;
        if (meta !== null && typeof meta === "object") return meta as Record<string, unknown>;
        throw new Error("the tool result's output is not JSON: " + obj.output.slice(0, 200));
      }
    }
    if (obj.metadata !== null && typeof obj.metadata === "object") {
      return obj.metadata as Record<string, unknown>;
    }
    return obj;
  }
  throw new Error(`a tool result must carry its handler's fields; got ${JSON.stringify(raw)}`);
}

// Drive the REAL `tool.execute.before` gate hook (composition.test.ts's helper).
async function callGate(
  hooks: PluginHooks,
  input: { tool: string; sessionID: string; args: Record<string, unknown> },
): Promise<void> {
  const hook = hooks["tool.execute.before"];
  assert.equal(typeof hook, "function", "premise: the plugin keeps its tool.execute.before gate hook");
  await (hook as (i: ToolBeforeHookInput, o: ToolBeforeHookOutput) => Promise<void>)(
    { tool: input.tool, sessionID: input.sessionID, callID: "call_13cr" },
    { args: input.args },
  );
}

// The gate DENIES by throwing; hand the reason back so a row can assert on WHAT
// it names. Non-vacuous: fails when the call did not deny at all.
async function gateDeny(
  hooks: PluginHooks,
  input: { tool: string; sessionID: string; args: Record<string, unknown> },
  ctx: string,
): Promise<string> {
  const outcome = await attempt(async () => {
    await callGate(hooks, input);
  });
  assert.ok(outcome.threw, `${ctx}: expected the gate to DENY by throwing`);
  assert.ok(outcome.error instanceof Error, `${ctx}: a deny must throw an Error`);
  return messageOf(outcome.error);
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

function countRuns(root: string): number {
  const dir = runsDirOf(root);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "run.json")),
  ).length;
}

function readJsonlFile(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readRunJournal(runDir: string): Rec[] {
  return readJsonlFile(path.join(runDir, "journal.jsonl")) as Rec[];
}

function readDecisions(runDir: string): Record<string, unknown>[] {
  return readJsonlFile(path.join(runDir, "decisions.jsonl"));
}

// A byte-exact fingerprint of a directory tree: every entry, every file's digest.
function snapshotTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = rel === "" ? dir : path.join(dir, rel);
    const entries = readdirSync(abs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        out.push(`d ${childRel}`);
        walk(childRel);
      } else {
        const digest = createHash("sha256")
          .update(readFileSync(path.join(dir, childRel)))
          .digest("hex");
        out.push(`f ${childRel} ${digest}`);
      }
    }
  };
  if (existsSync(dir)) walk("");
  return out;
}

// ---------------------------------------------------------------------------
// Store / run / queue fixtures (the tools-9.4c discipline: seed on disk, never
// through another task's handler)
// ---------------------------------------------------------------------------

function openTestStore(root: string, config: Config): StateStore {
  return openWorkspace({
    root,
    config,
    journal: { log: () => undefined },
    version: "0.0.0-test-13.1-cr",
    sessionID: "ses_fixture_13cr",
  });
}

function createRunFor(store: StateStore, sessionID: string): string {
  const run = store.createRun({
    prompt: "keep the sign of negative offsets",
    sessionID,
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  return run.runId;
}

function makeRuntimeItem(id: string, state: ItemState): Item {
  return {
    id,
    state,
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

function makeQueueItem(id: string): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

// Put the run where a stage tool can be offered: a queue on disk plus one runtime
// item file per queue entry, at the states the caller names.
function seedQueue(
  store: StateStore,
  runId: string,
  runState: RunState,
  states: Record<string, ItemState>,
): void {
  const run = store.loadRun(runId);
  run.state = runState;
  store.saveRun(run);
  const queue: Queue = { items: Object.keys(states).map((id) => makeQueueItem(id)) };
  writeFileSync(
    path.join(runDirOf(store.root, runId), "queue.json"),
    JSON.stringify(queue, null, 2),
  );
  for (const [id, state] of Object.entries(states)) {
    store.saveItem(runId, makeRuntimeItem(id, state));
  }
}

// ---------------------------------------------------------------------------
// Async choreography for the rows that must observe a dispatch IN FLIGHT
// ---------------------------------------------------------------------------

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await tick();
  }
  return condition();
}

interface Settled {
  ok: boolean;
  error?: unknown;
  value?: unknown;
}

interface Tracked {
  promise: Promise<void>;
  settled: () => Settled | null;
}

// Kick a tool off WITHOUT awaiting it, so the test can observe the plugin's state
// while the dispatch is still in flight. The rejection is attached immediately so
// a refusal can never surface as an unhandled rejection.
function kick(run: () => Promise<unknown>): Tracked {
  let state: Settled | null = null;
  const promise = run().then(
    (value) => {
      state = { ok: true, value };
    },
    (error) => {
      state = { ok: false, error };
    },
  );
  return { promise, settled: () => state };
}

function describeSettled(state: Settled | null): string {
  if (state === null) return "still in flight";
  if (state.ok) return `resolved with ${JSON.stringify(state.value)}`;
  return `REJECTED with: ${messageOf(state.error)}`;
}

type FakeSdk = ReturnType<typeof makeFakeSdk>;

// Release every parked sub-session prompt until the driver settles, so no
// watchdog timer outlives the test and keeps node --test alive.
async function drain(sdk: FakeSdk, tracked: Tracked, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (tracked.settled() === null && Date.now() < deadline) {
    if (sdk.pending.length > 0) {
      sdk.resolveAllPending({ kind: "error", error: { message: "fixture: ending the sub-session" } });
    }
    await tick();
  }
  await Promise.race([tracked.promise, tick(500)]);
}

// ---------------------------------------------------------------------------
// Source-audit helpers (the composition.test.ts:1499-1509 idiom)
// ---------------------------------------------------------------------------

// Whole-line comments are dropped so prose ABOVE a field can never satisfy or
// trip a check.
function dropWholeLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

// Every .ts file conductor/ SHIPS — tests, fixtures and vendored code excluded.
function productionSources(): string[] {
  const out: string[] = [];
  const skip = new Set(["tests", "node_modules", ".git", "doctrine", "dist"]);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(abs);
      } else if (entry.name.endsWith(".ts")) {
        out.push(abs);
      }
    }
  };
  walk(conductorDir);
  return out.sort();
}

// ===========================================================================
// 13.1-cr-inventory-still-exact
// ===========================================================================

test("[13.1-cr-inventory-still-exact] the bound tool map's keys are EXACTLY the 22 CONDUCTOR_TOOL_NAMES and are STILL produced by iterating that inventory — the property the pre-binding loop already had, which a hand-listed switch would silently lose", async () => {
  const root = plainRoot("conductor-13.1-cr-inventory-");
  const hooks = await startPlugin(root);
  const registered = Object.keys(toolMapOf(hooks)).sort();

  assert.equal(CONDUCTOR_TOOL_NAMES.length, 22, "premise: the §3.4 inventory is 22 names");
  assert.deepEqual(
    registered,
    [...CONDUCTOR_TOOL_NAMES].sort(),
    "the tool map's keys are exactly the inventory — no extra name, no missing one",
  );

  // The half no probe can see: a map with the right keys could equally be
  // hand-listed. adapter/tools.ts is the ONE inventory, and the loop over it is
  // what makes a renamed or forgotten tool impossible.
  const pluginSource = readFileSync(pluginPath, "utf8");
  const loopStart = pluginSource.indexOf("for (const name of CONDUCTOR_TOOL_NAMES)");
  assert.notEqual(
    loopStart,
    -1,
    `premise: ${pluginPath} still builds its tool map by iterating CONDUCTOR_TOOL_NAMES`,
  );
  const loopEnd = pluginSource.indexOf("\n  }", loopStart);
  assert.notEqual(loopEnd, -1, "premise: the loop body terminates readably at one indent level");
  const loopSource = dropWholeLineComments(pluginSource.slice(loopStart, loopEnd + 4));
  assert.ok(
    loopSource.length > 120,
    `premise: the extracted loop is the real construction site (got ${loopSource.length} chars) — a broken extraction must be red, never a vacuous green`,
  );

  assert.match(
    loopSource,
    /toolMap\[name\]\s*=/,
    "every registration is keyed by the inventory's own name",
  );
  assert.doesNotMatch(
    loopSource,
    /"conductor_/,
    "no tool name is hand-written inside the construction loop — the inventory is the single source of the key set",
  );
  assert.doesNotMatch(
    loopSource,
    /switch\s*\(/,
    "the binding must not dispatch on a hand-listed switch over tool names: a tool renamed in adapter/tools.ts and forgotten here would then register under a stale key instead of failing loudly",
  );
});

// ===========================================================================
// 13.1-cr-no-tool-throws-not-bound
// ===========================================================================

test("[13.1-cr-no-tool-throws-not-bound] no tool in the map throws the handlerNotBound message any more: each of the 22 executes against a real configured fixture workspace and either returns a value or refuses for a REASON — and handlerNotBound itself is deleted from the plugin, not merely bypassed", async () => {
  const root = gitRoot("conductor-13.1-cr-bound-");
  writeRepoConfig(root, makeConfig());
  const hooks = await startPlugin(root);

  const stillNotBound: string[] = [];
  for (const name of CONDUCTOR_TOOL_NAMES) {
    const outcome = await attempt(() => callTool(hooks, name, {}, root));
    if (!outcome.threw) continue;
    assert.ok(outcome.error instanceof Error, `${name}'s refusal must be an Error`);
    const message = messageOf(outcome.error);
    if (/no run handler is bound to this session/.test(message)) stillNotBound.push(name);
  }
  assert.deepEqual(
    stillNotBound,
    [],
    "every one of the 22 tools must reach a real handler; these are still bound to handlerNotBound",
  );

  // A dead fallback left in the file is the thing a later refactor silently
  // reintroduces, so the function and its message go with the binding.
  const pluginSource = dropWholeLineComments(readFileSync(pluginPath, "utf8"));
  assert.ok(
    pluginSource.length > 2000,
    `premise: the plugin source read back is the real module (got ${pluginSource.length} chars)`,
  );
  assert.doesNotMatch(
    pluginSource,
    /handlerNotBound/,
    "handlerNotBound must be DELETED from plugin/index.ts, not merely unreferenced",
  );
  assert.doesNotMatch(
    pluginSource,
    /no run handler is bound to this session/,
    "and its message with it — a live string is a live fallback waiting to be re-wired",
  );
});

// ===========================================================================
// 13.1-cr-reaches-the-committed-handler
// ===========================================================================

test("[13.1-cr-reaches-the-committed-handler] a bound tool provably reaches its COMMITTED handler and not a re-implementation: conductor_status through the plugin returns field-for-field what adapter/tools.ts handleStatus returns for the same store and the same run", async () => {
  const root = gitRoot("conductor-13.1-cr-handler-");
  const config = makeConfig();
  writeRepoConfig(root, config);

  // The fixture's OWN store — the same one the expected value is derived from,
  // so the two sides of the comparison never come from the plugin (C-077).
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING", I2: "GREEN", I3: "PUBLISHED" });

  const hooks = await startPlugin(root);
  const raw = await callTool(hooks, "conductor_status", {}, root);
  const throughPlugin = parseToolResult(raw);

  // The expected value comes from the COMMITTED handler, called directly.
  const expected: StatusResult = handleStatus({ store, runId, journal: { log: () => undefined } });

  assert.equal(throughPlugin.runId, expected.runId, "the bound tool reports the live run");
  assert.equal(throughPlugin.state, expected.state, "and the run's state, as the handler computed it");
  assert.deepEqual(
    throughPlugin.classification,
    expected.classification,
    "and the classification the handler derived",
  );
  assert.deepEqual(
    throughPlugin.items,
    expected.items,
    "and the per-item dispositions verbatim — a plugin-local re-implementation would have to re-derive the whole §2.5 read, which is exactly what the committed handler is for",
  );
  assert.deepEqual(
    throughPlugin.openQuestions,
    expected.openQuestions,
    "and the §2.11 open questions",
  );
  assert.equal(
    expected.items.length,
    3,
    "premise: the fixture's status is non-trivial (three items in three states), so the comparison above is not a comparison of two empty objects",
  );
});

// ===========================================================================
// 13.1-cr-one-dependency-bundle
// ===========================================================================

test("[13.1-cr-one-dependency-bundle] the binding assembles ONE dependency bundle: three tool calls on one plugin instance open the workspace exactly ONCE and write through ONE journal — the store and the journal are shared, not re-derived per tool", async () => {
  const root = gitRoot("conductor-13.1-cr-bundle-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);

  const stderrLines: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]): void => {
    stderrLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    const hooks = await startPlugin(root);
    await attempt(() => callTool(hooks, "conductor_status", {}, root));
    await attempt(() => callTool(hooks, "conductor_decide", decideArgs("first"), root));
    await attempt(() => callTool(hooks, "conductor_decide", decideArgs("second"), root));
  } finally {
    console.error = originalError;
  }

  const stderrRecords: Rec[] = [];
  for (const line of stderrLines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed !== null && typeof parsed === "object") stderrRecords.push(parsed as Rec);
    } catch {
      continue; // a non-JSON stderr line is not a journal record
    }
  }
  const fileRecords = readRunJournal(runDir);
  const allRecords = [...stderrRecords, ...fileRecords];
  const opens = allRecords.filter((r) => r.component === "state" && r.event === "lock.acquired");
  assert.equal(
    opens.length,
    1,
    `the workspace is opened exactly ONCE per plugin instance and the memoized store is spread into every tool input — got ${opens.length} state/lock.acquired records (0 means no tool ever assembled a bundle at all; more than 1 means a tool body opened a second store of its own, which plugin/index.ts:252-288's memoized ensureWorkspace exists to prevent)`,
  );

  const decisions = readDecisions(runDir);
  assert.equal(
    decisions.length,
    2,
    "premise: both conductor_decide calls reached the committed handler and appended to the §2.7 ledger",
  );

  const runScoped = fileRecords.filter((r) => r.runId === runId);
  assert.ok(
    runScoped.length >= 2,
    `both tool calls write through the ONE run-bound journal (plugin/index.ts:212-242): <runDir>/journal.jsonl carries ${runScoped.length} records correlated to ${runId}, and a tool that built its own journal would have left them on the §7.1 stderr sink instead`,
  );
});

// The §2.7 scored-options shape the composition root may NOT fabricate (C-047).
function decideArgs(tag: string): Record<string, unknown> {
  return {
    question: `which parser change keeps the sign (${tag})`,
    options: [
      {
        name: "widen the token regex",
        score: {
          capability: 3,
          testability: 4,
          movingParts: 2,
          validationEarliness: 3,
          singleSource: 4,
        },
      },
      {
        name: "post-process the parsed number",
        score: {
          capability: 2,
          testability: 3,
          movingParts: 3,
          validationEarliness: 2,
          singleSource: 2,
        },
      },
    ],
    choice: "widen the token regex",
    why: "the sign belongs to the token, so one source keeps it",
    appliedWhere: "src/beta.ts",
  };
}

// ===========================================================================
// 13.1-cr-fanout-is-real-and-registers
// ===========================================================================

test("[13.1-cr-fanout-is-real-and-registers] the bundle's fanout is a REAL createFanout over input.client built with the plugin's ONE registry: driving conductor_dispatch_wave with a fake SDK creates a sub-session that the plugin's own gate hook can see registered, where before the call only the orchestrator existed", async () => {
  const root = gitRoot("conductor-13.1-cr-fanout-");
  const config = makeConfig({ subSessionTimeoutMs: 8_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "PLAN_REVIEWED", { I1: "PENDING" });

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_sub_" });
  const hooks = await startPlugin(root, sdk.client);

  // BEFORE: the sub-session id the fake will mint is unknown to the plugin, and
  // §3.5's registry gate says so in its own words.
  const before = await gateDeny(
    hooks,
    { tool: "edit", sessionID: "ses_sub_1", args: { filePath: path.join(root, "src", "beta.ts") } },
    "before the dispatch",
  );
  assert.match(
    before,
    /no conductor item assignment/,
    "premise: an unregistered session is denied by the REGISTRY rule (core/gates-edit.ts decideSession), which is the message that must stop applying once the fan-out registers it",
  );

  const tracked = kick(() => callTool(hooks, "conductor_dispatch_wave", {}, root));
  try {
    await waitFor(() => sdk.creates.length > 0 || tracked.settled() !== null, 6_000);
    assert.ok(
      sdk.creates.length > 0,
      `the wave must dispatch through a REAL createFanout over input.client — the fake SDK saw no session.create (wave: ${describeSettled(tracked.settled())})`,
    );

    const subSession = sdk.creates[0];
    const after = await gateDeny(
      hooks,
      { tool: "edit", sessionID: subSession, args: { filePath: path.join(root, "src", "beta.ts") } },
      "while the sub-session is live",
    );
    assert.doesNotMatch(
      after,
      /no conductor item assignment/,
      `the fan-out must write its sub-session entry into the PLUGIN's ONE registry (plugin/index.ts:178-191), so the gate hook reads it: ${subSession} is still unregistered as far as the gate is concerned`,
    );
    assert.match(
      after,
      /outside this session's tree/,
      "and the entry carries a TREE, which is what core/gates-edit.ts normalizeUnderTree judges the path against — an entry with no tree would fall through to the per-role scope deny instead",
    );

    await waitFor(
      () => readRunJournal(runDir).some((r) => r.event === "subsession.dispatched"),
      3_000,
    );
    const dispatch = readRunJournal(runDir).find((r) => r.event === "subsession.dispatched");
    assert.ok(
      dispatch !== undefined,
      "adapter/fanout.ts journals the registration through the journal it was constructed with; no fanout/subsession.dispatched record reached the run's journal.jsonl",
    );
    const data = (dispatch?.data ?? {}) as Record<string, unknown>;
    assert.equal(typeof data.role, "string", "the registered entry carries a ROLE");
    assert.ok((data.role as string).length > 0, "a non-empty one");
    assert.equal(data.itemId, "I1", "and the ITEM the wave member is working");
    assert.equal(typeof data.tree, "string", "and the TREE it was dispatched into");
    assert.ok((data.tree as string).length > 0, "a non-empty one");
    assert.equal(
      dispatch?.sessionID,
      subSession,
      "correlated to the sub-session the SDK actually created",
    );
  } finally {
    await drain(sdk, tracked, 8_000);
  }
});

// ===========================================================================
// 13.1-cr-treestate-is-marker-backed
// ===========================================================================

test("[13.1-cr-treestate-is-marker-backed] the treeState handed to handleDispatchWave reads the REAL per-tree verify marker: a write-capable wave member is HELD while verify-running-main.json exists and proceeds once it is removed — a stub returning false is the §3.5 freeze-admission half of the same defect verifyInFlightTree:null is on the gate side", async () => {
  const root = gitRoot("conductor-13.1-cr-freeze-");
  const config = makeConfig({ subSessionTimeoutMs: 30_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "PLAN_REVIEWED", { I1: "PENDING" });

  // A live marker for the shared tree, in the §2.6 shape adapter/evidence.ts
  // writes (evidence.ts:631-636 composes exactly this name).
  const markerPath = path.join(runDir, "verify-running-main.json");
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid, startMs: Date.now() }));

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_frozen_" });
  const hooks = await startPlugin(root, sdk.client);

  const tracked = kick(() => callTool(hooks, "conductor_dispatch_wave", {}, root));
  try {
    await tick(700);
    assert.equal(
      tracked.settled(),
      null,
      `premise: the wave is still in flight — its write-capable member is HELD by the live marker, not finished and not refused (${describeSettled(tracked.settled())})`,
    );
    assert.equal(
      sdk.creates.length,
      0,
      "while verify-running-main.json exists, isFrozen('main') must be TRUE and no write-capable sub-session may be created in that tree",
    );

    rmSync(markerPath);

    await waitFor(() => sdk.creates.length > 0 || tracked.settled() !== null, 8_000);
    assert.ok(
      sdk.creates.length > 0,
      "once the marker is removed isFrozen must go FALSE and onClear must fire, releasing the held member — a treeState that never notices the removal wedges the wave exactly as a constant-true one would",
    );
    assert.ok(
      readRunJournal(runDir).some((r) => r.event === "subsession.hold"),
      "and the hold itself is on the record: adapter/fanout.ts journals fanout/subsession.hold when a write-capable job is kept out of a frozen tree, so a run that never held anything is a treeState that never reported a freeze",
    );
  } finally {
    await drain(sdk, tracked, 10_000);
  }
});

// ===========================================================================
// 13.1-cr-marker-enumeration-single-source
// ===========================================================================

test("[13.1-cr-marker-enumeration-single-source] the live-marker enumeration is EXPORTED from adapter/evidence.ts — the module that owns the filename — and 'verify-running-' appears in exactly one non-test source file: two independently-derived spellings of one filename is how a freeze silently stops firing on one side only", async () => {
  const evidence = (await import("../adapter/evidence.ts")) as Record<string, unknown>;
  const liveVerifyTrees = evidence.liveVerifyTrees;
  assert.equal(
    typeof liveVerifyTrees,
    "function",
    "adapter/evidence.ts must export `liveVerifyTrees(runDir: string): string[]` — the enumeration BOTH the wave driver's treeState and the CR-2 gate derivation read, so a live freeze is one fact and not two implementations that can disagree (markerPathOf at :631-636 is module-private, so nothing else can enumerate without re-deriving the filename)",
  );

  const runDir = plainRoot("conductor-13.1-cr-markers-");
  const enumerate = liveVerifyTrees as (dir: string) => string[];
  assert.deepEqual(enumerate(runDir), [], "an empty run directory holds no live markers");

  // Both markers must be genuinely LIVE by the verify path's own rule — an alive pid
  // AND a fresh startMs — or the enumeration correctly omits them and this row proves
  // nothing about slug extraction. What liveness MEANS is asserted by
  // [13.1-cr-live-means-live-not-present]; here it is only the premise.
  const liveStartMs = Date.now();
  writeFileSync(
    path.join(runDir, "verify-running-main.json"),
    JSON.stringify({ pid: process.pid, startMs: liveStartMs }),
  );
  writeFileSync(
    path.join(runDir, "verify-running-I1.json"),
    JSON.stringify({ pid: process.pid, startMs: liveStartMs }),
  );
  writeFileSync(path.join(runDir, "evidence.jsonl"), "{}\n");
  writeFileSync(path.join(runDir, "verify-running-notjson.txt"), "not a marker");
  assert.deepEqual(
    [...enumerate(runDir)].sort(),
    ["I1", "main"],
    "the enumeration yields the evidence layer's TREE SLUGS for exactly the live marker files — 'main' for the shared tree, the item id for a worktree — and nothing else in the run dir",
  );

  rmSync(path.join(runDir, "verify-running-I1.json"));
  assert.deepEqual(
    enumerate(runDir),
    ["main"],
    "and a removed marker leaves the enumeration immediately",
  );

  // The single-source guard.
  const sources = productionSources();
  assert.ok(
    sources.length > 15,
    `premise: the scan reached conductor's shipped sources (got ${sources.length} files) — a broken walk must be red, never a vacuous green`,
  );
  const hits: string[] = [];
  for (const file of sources) {
    if (dropWholeLineComments(readFileSync(file, "utf8")).includes("verify-running-")) {
      hits.push(path.relative(conductorDir, file));
    }
  }
  assert.deepEqual(
    hits,
    ["adapter/evidence.ts"],
    "the marker filename is spelled in exactly ONE non-test source file; every other seam reads it through the exported enumeration",
  );
});

// ===========================================================================
// 13.1-cr-no-run-refuses-legibly
// ===========================================================================

test("[13.1-cr-no-run-refuses-legibly] a stage tool invoked with NO live run refuses legibly — naming the tool, never a TypeError, creating no run as a side effect and leaving the state directory byte-identical — while conductor_setup, conductor_status and conductor_forget_stale still work with no run at all (CR-SG-1)", async () => {
  const root = gitRoot("conductor-13.1-cr-norun-");
  writeRepoConfig(root, makeConfig());
  const hooks = await startPlugin(root);

  // Force the lazy workspace open FIRST, so the lock and the §3.8 beacon it
  // writes are part of the "before" picture and the comparison below is about
  // the refusal alone.
  await attempt(() => callTool(hooks, "conductor_status", {}, root));
  const before = snapshotTree(path.join(root, ".conductor"));
  assert.ok(before.length > 0, "premise: the workspace was opened and has state on disk to compare");

  const outcome = await attempt(() => callTool(hooks, "conductor_classify", {}, root));
  assert.ok(outcome.threw, "a stage tool with no live run must REFUSE, not silently succeed");
  assert.ok(outcome.error instanceof Error, "the refusal is an Error");
  const message = messageOf(outcome.error);
  assert.doesNotMatch(
    message,
    /no run handler is bound to this session/,
    "premise: the refusal under test is the NO-RUN refusal — a tool still bound to handlerNotBound refuses for a different reason entirely, and that reason belongs to the no-tool-throws-not-bound row, not this one",
  );
  assert.ok(
    !(outcome.error instanceof TypeError),
    `the refusal must be conductor's own, not a null propagating into a handler: ${message}`,
  );
  assert.doesNotMatch(
    message,
    /Cannot read propert|is not a function|undefined is not/,
    "a legible refusal never reads like a crash",
  );
  assert.match(message, /conductor_classify/, "the refusal names the tool that was invoked");
  assert.match(message, /run/i, "and says what is missing — there is no live run to advance");
  assert.ok(
    message.length >= 60,
    `and says what to do instead; a bare "no run" is not actionable (got: ${message})`,
  );

  assert.equal(countRuns(root), 0, "a stage tool never creates a run as a side effect");
  assert.deepEqual(
    snapshotTree(path.join(root, ".conductor")),
    before,
    "and a refused stage tool leaves the state directory byte-identical",
  );

  // The three that must still work with no run at all.
  const status = await attempt(() => callTool(hooks, "conductor_status", {}, root));
  assert.equal(status.threw, false, `conductor_status is legal in every state: ${messageOf(status.error)}`);
  const forget = await attempt(() =>
    callTool(hooks, "conductor_forget_stale", { path: "tests/nothing.test.ts" }, root),
  );
  assert.equal(
    forget.threw,
    false,
    `conductor_forget_stale reads the §2.11 registry, which precedes any run: ${messageOf(forget.error)}`,
  );
  // conductor_setup is the FIRST-RUN tool, so its "works with no run" leg is
  // asserted where a first run actually happens: a repo with no
  // .conductor/config.json at all. Calling it against `root` would not test that
  // — writeRepoConfig configured `root` above, and adapter/tools.ts:8852-8858
  // correctly refuses an already-configured repo without reconfigure:true. That
  // refusal is a different row's subject ([13.1-cr-setup-refuses-by-throwing]).
  const freshRepo = gitRoot("conductor-13.1-cr-norun-setup-");
  assert.equal(
    existsSync(path.join(freshRepo, ".conductor", "config.json")),
    false,
    "premise: this is a genuine first run — nothing has configured this repo",
  );
  const freshHooks = await startPlugin(freshRepo);
  const setup = await attempt(() => callTool(freshHooks, "conductor_setup", {}, freshRepo));
  assert.equal(
    setup.threw,
    false,
    `conductor_setup is the first-run tool and must work before anything exists: ${messageOf(setup.error)}`,
  );
  assert.equal(
    countRuns(freshRepo),
    0,
    "and it is not a run-taking tool: the first-run tool creates no run either",
  );
});

// ===========================================================================
// 13.1-cr-args-passed-not-invented
// ===========================================================================

test("[13.1-cr-args-passed-not-invented] each tool's declared args reach its handler's own field and a REQUIRED argument the caller omitted is a REFUSAL, never a fabricated default — pinned on conductor_decide's §2.7 scored options (C-047) and on an itemId-taking stage tool called with no itemId (CR-SG-2)", async () => {
  const root = gitRoot("conductor-13.1-cr-args-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  const hooks = await startPlugin(root);

  // (a) the args the caller DID supply reach the handler, verbatim.
  const args = decideArgs("passed-through");
  const ok = await attempt(() => callTool(hooks, "conductor_decide", args, root));
  assert.equal(
    ok.threw,
    false,
    `a fully-supplied conductor_decide must succeed: ${messageOf(ok.error)}`,
  );
  const ledger = readDecisions(runDir);
  assert.equal(ledger.length, 1, "exactly one §2.7 record was appended");
  const record = ledger[0];
  assert.equal(record.question, args.question, "the question the caller asked, not a synthesized one");
  assert.equal(record.choice, args.choice, "the choice the caller made");
  assert.equal(record.why, args.why, "the caller's rationale");
  assert.equal(record.appliedWhere, args.appliedWhere, "and where the caller applied it");
  assert.deepEqual(
    record.options,
    args.options,
    "and the SCORED options verbatim — the composition root may not mint, drop or re-score them (C-047)",
  );

  // (b) options as BARE STRINGS: the C-047 shape that made the tool unable to
  //     succeed. A refusal, never a fabricated score.
  const bare = await attempt(() =>
    callTool(hooks, "conductor_decide", { ...args, options: ["widen the regex", "post-process"] }, root),
  );
  assert.ok(bare.threw, "bare-string options carry no score, so the call must be refused");
  assert.ok(!(bare.error instanceof TypeError), `and refused legibly: ${messageOf(bare.error)}`);
  assert.equal(
    readDecisions(runDir).length,
    1,
    "and a refused decide appends NO ledger line — the composition root did not invent scores to make it pass",
  );

  // (c) a required argument omitted entirely.
  const missing = await attempt(() =>
    callTool(hooks, "conductor_decide", { question: args.question, choice: args.choice }, root),
  );
  assert.ok(missing.threw, "conductor_decide with no options at all must refuse");
  assert.ok(!(missing.error instanceof TypeError), `legibly: ${messageOf(missing.error)}`);
  assert.equal(readDecisions(runDir).length, 1, "and still writes nothing");

  // (d) an itemId-taking stage tool called with no itemId.
  const noItem = await attempt(() => callTool(hooks, "conductor_submit_test", {}, root));
  assert.ok(noItem.threw, "conductor_submit_test without its itemId must refuse");
  assert.ok(
    !(noItem.error instanceof TypeError),
    `and must not let the missing arg propagate into the handler as an empty string: ${messageOf(noItem.error)}`,
  );
  const noItemMessage = messageOf(noItem.error);
  assert.match(
    noItemMessage,
    /itemId|item id/i,
    `the refusal names the argument the caller omitted (got: ${noItemMessage})`,
  );
});

// ===========================================================================
// 13.1-cr-forget-stale-thin-binding
// ===========================================================================

test("[13.1-cr-forget-stale-thin-binding] conductor_forget_stale — the one name with no handleX handler — is bound to the committed store method removeStaleRed and to nothing else: the named entry leaves the §2.11 registry on disk, an unknown path is a no-op rather than a throw, and the plugin re-implements no read-modify-write of its own", async () => {
  const root = gitRoot("conductor-13.1-cr-forget-");
  writeRepoConfig(root, makeConfig());

  const registryPath = path.join(stateDirOf(root), "stale-red.json");
  mkdirSync(stateDirOf(root), { recursive: true });
  writeFileSync(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        entries: [
          {
            path: "tests/alpha.test.ts",
            itemId: "I1",
            runId: "r-20260101-aaaa",
            sinceMs: 1_754_560_000_000,
            reason: "left red by an abandoned run",
          },
          {
            path: "tests/beta.test.ts",
            itemId: "I2",
            runId: "r-20260101-bbbb",
            sinceMs: 1_754_560_000_001,
            reason: "left red by an abandoned run",
          },
        ],
      },
      null,
      2,
    ),
  );

  const hooks = await startPlugin(root);
  const removed = await attempt(() =>
    callTool(hooks, "conductor_forget_stale", { path: "tests/alpha.test.ts" }, root),
  );
  assert.equal(removed.threw, false, `forgetting a known entry succeeds: ${messageOf(removed.error)}`);

  const afterRemove = JSON.parse(readFileSync(registryPath, "utf8")) as {
    version: number;
    entries: Array<{ path: string }>;
  };
  assert.equal(afterRemove.version, 1, "the registry's version survives the read-modify-write");
  assert.deepEqual(
    afterRemove.entries.map((e) => e.path),
    ["tests/beta.test.ts"],
    "exactly the named entry is gone, read back off disk — adapter/state.ts:415 removeStaleRed's own behaviour",
  );

  const unknown = await attempt(() =>
    callTool(hooks, "conductor_forget_stale", { path: "tests/never-registered.test.ts" }, root),
  );
  assert.equal(
    unknown.threw,
    false,
    `an unknown path is a no-op, not a throw: ${messageOf(unknown.error)}`,
  );
  const afterUnknown = JSON.parse(readFileSync(registryPath, "utf8")) as {
    entries: Array<{ path: string }>;
  };
  assert.deepEqual(
    afterUnknown.entries.map((e) => e.path),
    ["tests/beta.test.ts"],
    "and it changes nothing",
  );
});

// ===========================================================================
// 13.1-cr-packs-loaded-fail-closed
// ===========================================================================

test("[13.1-cr-packs-loaded-fail-closed] the §6.4 doctrine packs are loaded through adapter/inject.ts loadPacks and REACH the handlers that take them: a red full verify drives conductor_validate's DEBUG dispatch, whose prompt carries doctrine debug.md VERBATIM — a naive binding handing `packs: {}` refuses at that seam instead (CR-SG-4)", async () => {
  const root = gitRoot("conductor-13.1-cr-packs-");
  // A verify scope that is guaranteed RED, so the bounded DEBUG loop is reached
  // without any dependence on what the fixture's own tests would do.
  const config = makeConfig({
    scopeCommand: [process.execPath, "-e", "process.exit(1)"],
    subSessionTimeoutMs: 20_000,
    debugFixCap: 1,
  });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "EXECUTING", { I1: "GREEN" });

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_debug_" });
  const hooks = await startPlugin(root, sdk.client);

  const tracked = kick(() => callTool(hooks, "conductor_validate", { itemId: "I1" }, root));
  try {
    await waitFor(() => sdk.prompts.length > 0 || tracked.settled() !== null, 15_000);
    assert.ok(
      sdk.prompts.length > 0,
      `the DEBUG dispatch must happen: adapter/tools.ts:4132-4139 refuses BEFORE dispatching when the loaded pack set has no debug.md, so no sub-session prompt at all is exactly what an empty \`packs\` record produces (validate: ${describeSettled(tracked.settled())})`,
    );

    const doctrine = readFileSync(path.join(doctrineDir, "debug.md"), "utf8");
    assert.ok(doctrine.trim().length > 200, "premise: the shipped debug.md doctrine is substantial");
    const prompt = sdk.prompts[0].text;
    assert.ok(
      prompt.startsWith(doctrine),
      "the DEBUG prompt carries doctrine debug.md VERBATIM (adapter/tools.ts:4141), which it can only do if the binding loaded the real §6.4 pack set through adapter/inject.ts loadPacks and spread it into the handler input",
    );

    const settled = tracked.settled();
    if (settled !== null && !settled.ok) {
      assert.doesNotMatch(
        messageOf(settled.error),
        /loaded pack set has none/,
        "and the tool never refuses for want of doctrine it should have loaded",
      );
    }
  } finally {
    await drain(sdk, tracked, 25_000);
  }
});

// ===========================================================================
// 13.1-cr-setup-input-not-faked
// ===========================================================================

test("[13.1-cr-setup-input-not-faked] conductor_setup's distinct input is built from the RESOLVED workspace, not from constants: the same tool reports isRepo true in a git repo and false in a non-git one, and it still works in a repo with no .conductor/ at all — the only condition under which a first-run tool is worth anything", async () => {
  const repo = gitRoot("conductor-13.1-cr-setup-repo-");
  assert.equal(
    existsSync(path.join(repo, ".conductor")),
    false,
    "premise: this repo has never been configured",
  );

  const repoHooks = await startPlugin(repo);
  const inRepo = await attempt(() => callTool(repoHooks, "conductor_setup", {}, repo));
  assert.equal(
    inRepo.threw,
    false,
    `conductor_setup must run in a repo with no .conductor/ at all: ${messageOf(inRepo.error)}`,
  );
  const repoResult = parseToolResult(inRepo.value);
  assert.equal(repoResult.isRepo, true, "setup's `root` is the real workspace: this one IS a git repo");
  assert.equal(
    repoResult.repoConfigured,
    false,
    "and it reads the real §2.1 config source: nothing is configured here",
  );
  assert.ok(
    Array.isArray(repoResult.asks) && (repoResult.asks as unknown[]).length > 0,
    "a call carrying no answers returns §2.1:622's undefaultable asks",
  );
  assert.equal(
    repoResult.written,
    false,
    "and writes nothing — the answers are the human's to give",
  );
  assert.equal(
    existsSync(path.join(repo, ".conductor", "config.json")),
    false,
    "so no config file appeared",
  );

  // The same tool, the same constants if there were any — a different workspace.
  const bare = plainRoot("conductor-13.1-cr-setup-bare-");
  const bareHooks = await startPlugin(bare);
  const inBare = await attempt(() => callTool(bareHooks, "conductor_setup", {}, bare));
  assert.equal(inBare.threw, false, `and in a non-git directory too: ${messageOf(inBare.error)}`);
  const bareResult = parseToolResult(inBare.value);
  assert.equal(
    bareResult.isRepo,
    false,
    "setup's root is derived per workspace, not a constant: this directory is NOT a repo, and a faked input could not tell the two fixtures apart",
  );
});

// ===========================================================================
// 13.1-cr-fence-rewritten-not-deleted
// ===========================================================================

test("[13.1-cr-fence-rewritten-not-deleted] composition.test.ts's 5.4a tools-still-throw scope fence is REWRITTEN to assert the positive and never deleted: the row id survives, the title records this task as the authorized crossing, and the count-of-22 and every-name-is-registered halves it also carries survive verbatim", async () => {
  const fencePath = path.join(testsDir, "composition.test.ts");
  const source = readFileSync(fencePath, "utf8");
  const rowId = "5.4a-tools-still-throw-scope-fence";

  const titleStart = source.indexOf(`test("[${rowId}]`);
  assert.notEqual(
    titleStart,
    -1,
    `${fencePath} must still carry a test titled with [${rowId}] — the fence is rewritten, never deleted, or the 5.4a row it discharges is orphaned`,
  );
  assert.equal(
    source.indexOf(`test("[${rowId}]`, titleStart + 1),
    -1,
    "and exactly once",
  );

  const body = dropWholeLineComments(source.slice(titleStart));
  assert.ok(
    body.length > 400,
    `premise: the extracted fence is the real test body (got ${body.length} chars) — a broken extraction must be red, never a vacuous green`,
  );

  const titleEnd = source.indexOf("\n", titleStart);
  const title = source.slice(titleStart, titleEnd);
  assert.doesNotMatch(
    title,
    /STILL bound to a handler that throws/,
    "the title no longer claims the tools still throw — that is precisely what this task changed",
  );
  assert.match(
    title,
    /13\.1/,
    "and it names the task that crossed the fence, so a future reader sees the boundary was crossed deliberately rather than forgotten",
  );

  assert.match(
    body,
    /CONDUCTOR_TOOL_NAMES\.length,\s*\n?\s*22,/,
    "the count-of-22 assertion survives verbatim — it was never about the throw",
  );
  assert.match(
    body,
    /for \(const name of CONDUCTOR_TOOL_NAMES\)/,
    "and so does the every-name loop",
  );
  assert.match(body, /is registered/, "including its registration assertion");

  assert.doesNotMatch(
    body,
    /assert\.match\(\s*\(caught as Error\)\.message,\s*\/no run handler is bound/,
    "and the fence no longer ASSERTS the handlerNotBound throw: it asserts the absence of it",
  );
  assert.match(
    body,
    /doesNotMatch/,
    "the rewritten fence states the positive as a negation of the old message, so a reintroduced handlerNotBound goes red here as well as in composition-root.test.ts",
  );
});

// ===========================================================================
// 13.1-cr-queue-amend-ops-declared-structurally
// ===========================================================================

// The two sides of this row come from two different files, and neither is
// derived from the other (C-077):
//   REQUIRED — core/queue-amend.ts's own QueueAmendOp union and AMEND_OP_KINDS
//              vocabulary, imported and used as the TYPE of the ops the test
//              builds, so tsc itself checks the structure side;
//   DECLARED — the live plugin's `tool` map entry for conductor_queue_amend,
//              read off the running factory, never off a copy in this file.

test("[13.1-cr-queue-amend-ops-declared-structurally] the C-047 TWIN: conductor_queue_amend's DECLARED `ops` must admit the very structure core/queue-amend.ts's QueueAmendOp requires — an amendment built to that union is applied through the bound tool, the declared zod schema accepts that same value, and the bare strings the declaration currently invites amend nothing at all", async () => {
  const root = gitRoot("conductor-13.1-cr-amend-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING", I2: "PENDING" });
  const hooks = await startPlugin(root);

  assert.deepEqual(
    [...AMEND_OP_KINDS].sort(),
    ["add", "remove", "update"],
    "premise: core/queue-amend.ts owns the closed §2.4 op vocabulary this row builds against",
  );

  // Typed as core's own union, so a change to QueueAmendOp is a COMPILE error
  // here rather than a silently-still-green test.
  const ops: QueueAmendOp[] = [
    { op: "remove", id: "I2" },
    { op: "add", item: makeQueueItem("I3") },
  ];

  // (a) the HANDLER side, established by CALLING it: this structure — objects
  //     carrying `op` plus `id`/`item` — is what makes the tool succeed, because
  //     it is what applyAmendOps switches on and what QueueAmendInput.ops is.
  const amended = await attempt(() =>
    callTool(hooks, "conductor_queue_amend", { ...decideArgs("amend"), ops }, root),
  );
  assert.equal(
    amended.threw,
    false,
    `an amendment built to core's QueueAmendOp union must be applied: ${messageOf(amended.error)}`,
  );
  const queuePath = path.join(runDir, "queue.json");
  const applied = JSON.parse(readFileSync(queuePath, "utf8")) as Queue;
  assert.deepEqual(
    applied.items.map((entry) => entry.id).sort(),
    ["I1", "I3"],
    "the §2.4 queue on disk carries the amendment: I2 removed, I3 added — so the STRUCTURE is what the handler requires",
  );

  // (b) the DECLARED side, read off the LIVE plugin: the schema a model reads
  //     must ADMIT the value that just worked. `S.array(S.string())` does not.
  const declared = toolOf(hooks, "conductor_queue_amend").args ?? {};
  const opsSchema = declared["ops"];
  assert.ok(
    opsSchema !== undefined && opsSchema !== null && typeof opsSchema === "object",
    "premise: conductor_queue_amend declares an `ops` argument at all",
  );
  const safeParse = (opsSchema as { safeParse?: unknown }).safeParse;
  assert.equal(
    typeof safeParse,
    "function",
    "premise: the declared arg is a zod schema exposing safeParse — without it this row cannot judge the declaration, and it refuses to guess (C-045)",
  );
  const parse = (value: unknown): { success: boolean } =>
    (safeParse as (v: unknown) => { success: boolean }).call(opsSchema, value);
  assert.equal(
    parse([{ op: "remove", id: "I2" }]).success,
    true,
    "the DECLARED `ops` schema must admit a remove op — plugin/index.ts declares S.array(S.string()), so a model that follows the declaration hands strings and the tool CANNOT SUCCEED, which is the identical defect C-047 recorded for conductor_decide's scored options",
  );
  assert.equal(
    parse([{ op: "add", item: makeQueueItem("I4") }]).success,
    true,
    "and an add op, whose `item` is a whole §2.4 queue entry the composition root may not mint on the model's behalf",
  );
  assert.equal(
    parse(ops).success,
    true,
    "and the exact argument the call above proved the handler requires: the declaration and the requirement are one contract or the tool is a lie",
  );

  // (c) the converse, so the row is not merely a schema opinion: the value the
  //     CURRENT declaration invites — bare strings — amends nothing.
  const bare = await attempt(() =>
    callTool(hooks, "conductor_queue_amend", { ...decideArgs("bare"), ops: ["remove I1"] }, root),
  );
  const afterBare = JSON.parse(readFileSync(queuePath, "utf8")) as Queue;
  assert.deepEqual(
    afterBare.items.map((entry) => entry.id).sort(),
    ["I1", "I3"],
    `a bare-string ops list — exactly what S.array(S.string()) tells a model to send — must never silently amend the queue (outcome: ${bare.threw ? messageOf(bare.error) : JSON.stringify(bare.value)})`,
  );

  // (d) the REFUSAL side — the half (a)-(c) cannot see. Every op above was
  //     ALREADY a structured object, and QueueAmendInput.ops accepts such a
  //     value whether core's parser produced it or a cast waved it through, so
  //     nothing so far tells a real parse apart from
  //     `{ ok: true, ops: args.ops as QueueAmendInput["ops"] }`. What
  //     parseAmendOps uniquely owns is saying NO: the closed add/update/remove
  //     vocabulary, the required `id`, the one-JSON-object-per-element rule —
  //     each refusal naming the POSITION so a long list stays diagnosable. This
  //     leg drives malformed ops through the BOUND tool and requires core's own
  //     verdict to come back, so a root that casts instead of calling core is
  //     RED here.
  const malformed: ReadonlyArray<{ label: string; ops: readonly unknown[] }> = [
    {
      label: "an op outside the closed vocabulary, in SECOND position",
      ops: [{ op: "remove", id: "I1" }, { op: "reorder", id: "I1" }],
    },
    { label: "a remove carrying no id", ops: [{ op: "remove" }] },
    { label: "an add carrying no item", ops: [{ op: "add" }] },
    { label: "an element that is not JSON at all", ops: ["remove I1"] },
  ];
  const beforeMalformed = readFileSync(queuePath, "utf8");
  for (const row of malformed) {
    // The EXPECTED refusal is produced by core/queue-amend.ts — the module that
    // OWNS the vocabulary — called on the same ops the tool is about to be
    // handed. It is never computed from the plugin under test and never typed
    // into this file (C-077), so the day core rewords a refusal this row
    // follows it rather than pinning a stale paraphrase.
    const verdict = parseAmendOps(
      row.ops.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))),
    );
    assert.equal(
      verdict.ok,
      false,
      `premise: core's parseAmendOps refuses ${row.label} — if it stopped doing so this leg has no subject`,
    );
    const why = verdict.ok ? "" : verdict.why;

    const refused = await attempt(() =>
      callTool(hooks, "conductor_queue_amend", { ...decideArgs(row.label), ops: row.ops }, root),
    );
    assert.ok(
      refused.threw,
      `${row.label} must be REFUSED: a composition root that casts \`ops\` straight into QueueAmendInput lets a malformed op through as though it were a union member, which is the one thing the root may never do. It returned: ${JSON.stringify(refused.value)}`,
    );
    assert.ok(
      messageOf(refused.error).includes(why),
      `and the refusal reaching the caller must be CORE's own, verbatim — a message invented downstream is a second spelling of the §2.4 vocabulary, and one that does not name the offending position cannot be acted on in a long ops list.\n  core:   ${why}\n  plugin: ${messageOf(refused.error)}`,
    );
    assert.equal(
      readFileSync(queuePath, "utf8"),
      beforeMalformed,
      `and ${row.label} amends nothing on disk`,
    );
  }
});

// ===========================================================================
// 13.1-cr-queue-entry-single-source
// ===========================================================================

// The binding declared a `queueEntry` zod object beside conductor_queue_amend's
// spec, so a model is told the WHOLE §2.4 entry an add/update op carries rather
// than a partial one validateQueue would then refuse. That is a SECOND spelling
// of a shape core already owns — core/types.ts's QueueItem and its run-time twin
// SCHEMAS.Queue — and two spellings of one fact is this build's most-repeated
// defect class. Core remains the only VALIDATOR, so a drift produces a legible
// refusal rather than corruption; this row is what makes the drift loud at the
// moment it is introduced instead of the moment a model trips over it.
//
// Neither side is typed into this file (C-077): DECLARED is read off the LIVE
// plugin's registered arg schema, REQUIRED off core's SCHEMAS.Queue, both at run
// time, so the guard cannot go stale against either.

// Core §2.4 fields a tool ARGUMENT legitimately need not declare. EMPTY today:
// every field of a queue entry is the model's to supply, because the
// composition root may not mint any of them on its behalf. A new core field
// therefore lands RED here and forces a decision — declare it in the plugin's
// `queueEntry`, or name it below with the reason it is not the model's to give.
// Silent disappearance is the single outcome this list exists to prevent.
const CORE_ENTRY_FIELDS_NOT_A_MODEL_ARGUMENT: Readonly<Record<string, string>> = {};
const CORE_PONYTAIL_FIELDS_NOT_A_MODEL_ARGUMENT: Readonly<Record<string, string>> = {};

// zod v4 introspection, one asserted step at a time: an array schema exposes
// `.element`, an object `.shape`, an optional `.unwrap()`. Each step ASSERTS
// rather than optional-chains, so a zod upgrade that moves this surface makes
// the guard RED instead of vacuously green (C-045: it refuses to guess).
function zodElementOf(schema: unknown, what: string): unknown {
  assert.ok(
    schema !== null && typeof schema === "object",
    `premise: ${what} is a schema object this row can read`,
  );
  const element = (schema as Record<string, unknown>)["element"];
  assert.ok(
    element !== null && typeof element === "object",
    `premise: ${what} is an array schema exposing .element`,
  );
  return element;
}

function zodShapeOf(schema: unknown, what: string): Record<string, unknown> {
  assert.ok(
    schema !== null && typeof schema === "object",
    `premise: ${what} is a schema object this row can read`,
  );
  const holder = schema as Record<string, unknown>;
  // An `.optional()` wrapper hides the object one level down; peel exactly the
  // wrappers that declare themselves peelable.
  const inner =
    typeof holder["unwrap"] === "function"
      ? (holder["unwrap"] as () => unknown).call(holder)
      : schema;
  assert.ok(
    inner !== null && typeof inner === "object",
    `premise: ${what} unwraps to a schema object`,
  );
  const shape = (inner as Record<string, unknown>)["shape"];
  assert.ok(
    shape !== null && typeof shape === "object",
    `premise: ${what} is an object schema exposing .shape`,
  );
  const fields = shape as Record<string, unknown>;
  assert.ok(
    Object.keys(fields).length > 0,
    `premise: ${what} declares at least one field — an empty read would make this guard vacuous`,
  );
  return fields;
}

// Core's §2.4 entry, read off the run-time schema rather than the TS interface
// (an interface is erased before this test ever runs).
function coreEntrySchema(): Record<string, unknown> {
  const queue = SCHEMAS["Queue"];
  assert.ok(
    queue !== null && typeof queue === "object",
    "premise: core exports a run-time Queue schema at SCHEMAS.Queue",
  );
  const items = ((queue as Record<string, unknown>)["properties"] as Record<string, unknown>)?.[
    "items"
  ];
  assert.ok(
    items !== null && typeof items === "object",
    "premise: SCHEMAS.Queue declares an `items` property",
  );
  const entry = (items as Record<string, unknown>)["items"];
  assert.ok(
    entry !== null && typeof entry === "object",
    "premise: SCHEMAS.Queue's `items` is an array schema whose element is the §2.4 entry",
  );
  return entry as Record<string, unknown>;
}

function corePropertiesOf(schema: Record<string, unknown>, what: string): string[] {
  const properties = schema["properties"];
  assert.ok(
    properties !== null && typeof properties === "object",
    `premise: core's ${what} schema declares properties`,
  );
  const names = Object.keys(properties as Record<string, unknown>);
  assert.ok(
    names.length > 0,
    `premise: core's ${what} carries at least one field — an empty read would make this guard vacuous`,
  );
  return names;
}

test("[13.1-cr-queue-entry-single-source] the `queueEntry` the binding declares beside conductor_queue_amend restates core's §2.4 QueueItem, and two spellings of one fact drift: the DECLARED field set — read off the live plugin — must agree with core's own SCHEMAS.Queue entry, every declared field existing in core and every core field either declared or named in this row's justified exclusion list, so a §2.4 change forces a decision instead of silently vanishing from what a model is told to send", async () => {
  const root = gitRoot("conductor-13.1-cr-entry-source-");
  writeRepoConfig(root, makeConfig());
  const hooks = await startPlugin(root);

  // REQUIRED — core, at run time.
  const entrySchema = coreEntrySchema();
  const coreFields = corePropertiesOf(entrySchema, "§2.4 queue entry");
  assert.ok(
    coreFields.includes("id") && coreFields.includes("ponytail"),
    "premise: the schema this row read really is the §2.4 queue entry — it carries `id` and the ponytail record",
  );

  // DECLARED — the live plugin's registered `ops` argument, navigated to the
  // `item` an add/update op carries.
  const opsSchema = toolOf(hooks, "conductor_queue_amend").args?.["ops"];
  const opShape = zodShapeOf(zodElementOf(opsSchema, "the declared `ops` argument"), "a declared amendment op");
  assert.ok(
    Object.hasOwn(opShape, "item"),
    "premise: the declared op carries an `item` — the whole §2.4 entry an add/update supplies; without it there is no second spelling to guard, and this row would be guarding nothing",
  );
  const entryShape = zodShapeOf(opShape["item"], "the declared queueEntry");
  const declaredFields = Object.keys(entryShape);

  // (1) nothing is declared that core does not have: a field a model is told to
  //     send but validateQueue rejects is a lie the tool tells.
  for (const field of declaredFields) {
    assert.ok(
      coreFields.includes(field),
      `the declaration invites "${field}", which core's §2.4 entry does not carry — a model that follows the declaration sends an entry validateQueue then refuses.\n  declared: ${declaredFields.join(", ")}\n  core:     ${coreFields.join(", ")}`,
    );
  }

  // (2) nothing core requires goes undeclared without a NAMED reason: a §2.4
  //     field missing from the declaration is a field the model is never asked
  //     for, and the refusal surfaces only after the amendment is attempted.
  for (const field of coreFields) {
    const excused = CORE_ENTRY_FIELDS_NOT_A_MODEL_ARGUMENT[field];
    assert.ok(
      declaredFields.includes(field) || excused !== undefined,
      `core's §2.4 entry carries "${field}" and the declared queueEntry does not. Either declare it in plugin/index.ts's queueEntry, or add it to CORE_ENTRY_FIELDS_NOT_A_MODEL_ARGUMENT in this test with the reason it is not the model's to supply — a §2.4 field must not vanish from what a model is told to send by nobody noticing.\n  declared: ${declaredFields.join(", ")}\n  core:     ${coreFields.join(", ")}`,
    );
    if (excused !== undefined) {
      assert.ok(
        excused.length > 0 && !declaredFields.includes(field),
        `"${field}" is excused with a reason AND declared anyway — the exclusion list has gone stale, so it no longer records a decision`,
      );
    }
  }

  // (3) the same guard one level down: the declaration restates the ponytail
  //     record's fields too, and that nested spelling drifts by exactly the
  //     same mechanism.
  const corePonytail = corePropertiesOf(
    (entrySchema["properties"] as Record<string, Record<string, unknown>>)["ponytail"],
    "§2.4 ponytail record",
  );
  assert.ok(
    Object.hasOwn(entryShape, "ponytail"),
    "premise: the declared queueEntry carries the ponytail record — leg (2) would already be red otherwise",
  );
  const declaredPonytail = Object.keys(zodShapeOf(entryShape["ponytail"], "the declared ponytail"));
  for (const field of declaredPonytail) {
    assert.ok(
      corePonytail.includes(field),
      `the declared ponytail invites "${field}", which core's §2.4 ponytail does not carry.\n  declared: ${declaredPonytail.join(", ")}\n  core:     ${corePonytail.join(", ")}`,
    );
  }
  for (const field of corePonytail) {
    assert.ok(
      declaredPonytail.includes(field) || CORE_PONYTAIL_FIELDS_NOT_A_MODEL_ARGUMENT[field] !== undefined,
      `core's §2.4 ponytail carries "${field}" and the declaration does not. Declare it, or name it in CORE_PONYTAIL_FIELDS_NOT_A_MODEL_ARGUMENT with its reason.\n  declared: ${declaredPonytail.join(", ")}\n  core:     ${corePonytail.join(", ")}`,
    );
  }
});

// ===========================================================================
// 13.1-cr-setup-refuses-by-throwing
// ===========================================================================

test("[13.1-cr-setup-refuses-by-throwing] conductor_setup refuses the way all 21 other tools refuse — by THROWING, which is what opencode reads back to the model — and NOT by returning a refusal as ordinary data: a configured repo without reconfigure:true throws the committed handler's own §3.4 message, while the first-run leg is asserted where a first run actually happens", async () => {
  const root = gitRoot("conductor-13.1-cr-setup-throws-");
  writeRepoConfig(root, makeConfig());

  // The EXPECTED refusal is produced by the COMMITTED handler in
  // adapter/tools.ts, called directly with its own SetupInput. The plugin is the
  // subject; nothing about the expectation is computed from it (C-077).
  const direct = await attempt(async () =>
    handleSetup({
      root,
      journal: { log: () => undefined },
      router: { listen: { host: "127.0.0.1", port: 18_080 }, probeTimeoutMs: 1_000 },
      upstream: { host: "127.0.0.1", port: 18_081 },
      failoverState: createFailoverState(),
    }),
  );
  assert.ok(
    direct.threw,
    "premise: the committed handleSetup REFUSES an already-configured repo without reconfigure:true (adapter/tools.ts:8852-8858) — if it stopped doing so this row has no subject",
  );
  const expected = messageOf(direct.error);
  assert.match(
    expected,
    /already configures this repo/,
    "premise: and that is the §3.4 refusal it refuses with",
  );

  const hooks = await startPlugin(root);
  const before = snapshotTree(path.join(root, ".conductor"));
  assert.ok(before.length > 0, "premise: the configured repo has state on disk to compare");

  const outcome = await attempt(() => callTool(hooks, "conductor_setup", {}, root));
  assert.ok(
    outcome.threw,
    `conductor_setup must refuse by THROWING, exactly as the other 21 tools do — a refusal RETURNED as data reads to the model as a successful call whose result happens to say no, and softening one handler's refusal channel to satisfy a fixture is the composition root editing the product to fit the test. It returned: ${JSON.stringify(outcome.value)}`,
  );
  assert.ok(outcome.error instanceof Error, "and the refusal is an Error, as every other tool's is");
  const message = messageOf(outcome.error);
  assert.ok(
    message.includes(expected),
    `and it is the HANDLER's own §3.4 refusal reaching the caller, not a paraphrase the composition root invented.\n  handler: ${expected}\n  plugin:  ${message}`,
  );
  assert.deepEqual(
    snapshotTree(path.join(root, ".conductor")),
    before,
    "and a refused setup writes nothing — its own message says so",
  );

  // The first-run leg, asserted where a first run actually happens.
  const fresh = gitRoot("conductor-13.1-cr-setup-throws-first-");
  assert.equal(
    existsSync(path.join(fresh, ".conductor", "config.json")),
    false,
    "premise: this is a genuine first run — nothing has configured this repo",
  );
  const freshHooks = await startPlugin(fresh);
  const first = await attempt(() => callTool(freshHooks, "conductor_setup", {}, fresh));
  assert.equal(
    first.threw,
    false,
    `conductor_setup still works where a first run actually happens: ${messageOf(first.error)}`,
  );
  const result = parseToolResult(first.value);
  assert.equal(
    result.repoConfigured,
    false,
    "and it returns setup's own SetupResult for the unconfigured workspace",
  );
  assert.equal(
    Object.hasOwn(result, "refused"),
    false,
    "which carries no refusal envelope: a refusal is a throw, so `refused` is not a field of the success shape either",
  );
});

// ===========================================================================
// 13.1-cr-journal-flush-forwarded
// ===========================================================================

// The behavioural half is the row's own: read the run's journal.jsonl off disk
// the instant a bound tool returns. The FORWARD itself has no probe — both
// consumers guard it (`if (typeof sink.flushSync === "function")`, adapter/tools.ts
// :2427-2434 and :5014-5026), so deleting it from the plugin changes nothing a
// caller can observe today and everything the moment the journal buffers. That
// half reuses the committed source-audit idiom (composition.test.ts:1493-1530):
// extract, drop whole-line comments, assert an anti-vacuity floor.

// The object literal assigned by `<declaration> = {`, brace-matched.
function objectLiteralAfter(source: string, declaration: string, label: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${label}: "${declaration}" not found — the extraction is broken`);
  assert.equal(
    source.indexOf(declaration, start + 1),
    -1,
    `${label}: "${declaration}" appears more than once — the extraction cannot pick one`,
  );
  const open = source.indexOf("{", start + declaration.length - 1);
  assert.notEqual(open, -1, `${label}: no opening brace after "${declaration}"`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`${label}: unbalanced braces after "${declaration}" — the extraction is broken`);
}

test("[13.1-cr-journal-flush-forwarded] the plugin's rebindable journal FORWARDS flushSync to the run-bound journal, and the records a bound tool writes are already durable in <runDir>/journal.jsonl the instant that tool returns", async () => {
  const root = gitRoot("conductor-13.1-cr-flush-");
  // A GREEN full verify, so conductor_validate takes the §2.6 evidence path
  // whole — the very seam adapter/tools.ts:2427-2434 forwards flushSync across —
  // and settles without dispatching the bounded DEBUG loop.
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "GREEN" });
  const hooks = await startPlugin(root);

  const before = readRunJournal(runDir).length;
  const outcome = await attempt(() => callTool(hooks, "conductor_validate", { itemId: "I1" }, root));
  // Read IMMEDIATELY — no await, no tick, no settling.
  const after = readRunJournal(runDir);
  assert.equal(
    outcome.threw,
    false,
    `premise: the evidence-writing stage tool must reach its committed handler: ${messageOf(outcome.error)}`,
  );
  assert.ok(
    after.length > before,
    `the records a bound tool wrote are on disk the instant it returns: journal.jsonl held ${before} records before the call and ${after.length} after`,
  );
  const written = after.slice(before);
  assert.ok(
    written.some((rec) => rec.itemId === "I1"),
    "including the stage's own item-correlated records — a journal whose flush never reached the run-bound sink would have let them sit while the tool that wrote them returned",
  );
  assert.ok(
    written.every((rec) => rec.runId === runId),
    "and every one of them is correlated to the live run, so they landed in the run's journal rather than on the §7.1 stderr sink",
  );

  // The forward itself — the half no probe can see, because both consumers guard
  // it and the file journal's own flushSync is a no-op barrier today.
  const pluginSource = readFileSync(pluginPath, "utf8");
  const literal = dropWholeLineComments(
    objectLiteralAfter(pluginSource, "const journal: RebindableJournal =", "the rebindable journal"),
  );
  assert.ok(
    literal.length > 120,
    `premise: the extracted rebindable-journal literal is the real one (got ${literal.length} chars) — a broken extraction must be RED, never a vacuous green (C-045)`,
  );
  assert.match(
    literal,
    /flushSync\s*:/,
    "the rebindable journal declares flushSync: adapter/tools.ts forwards a flush ONLY when the sink it was handed carries one, so a sink without it silently drops the barrier",
  );
  assert.match(
    literal,
    /\.flushSync\(\)/,
    "and its flushSync FORWARDS to the run-bound journal's own — a member that exists but forwards nothing is the same dropped barrier with a name on it",
  );

  const iface = dropWholeLineComments(
    objectLiteralAfter(pluginSource, "interface RebindableJournal", "the RebindableJournal interface"),
  );
  assert.match(
    iface,
    /flushSync\s*:\s*\(\)\s*=>\s*void/,
    "and the journal's own TYPE requires it, so removing the forward is a typecheck failure as well as this row's red",
  );
});

// ===========================================================================
// 13.1-cr-override-grant-spendable
// ===========================================================================

test("[13.1-cr-override-grant-spendable] the §3.6 one-shot grant is END-TO-END: conductor_override mints into the plugin's overrideGrants map and the SAME map reaches gateBeforeToolCall, so the next matching edit is converted from deny to ALLOW and the grant is CONSUMED — the second identical edit is denied again", async () => {
  const root = gitRoot("conductor-13.1-cr-grant-");
  const config = makeConfig({ subSessionTimeoutMs: 30_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "PLAN_REVIEWED", { I1: "PENDING" });

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_grant_" });
  const hooks = await startPlugin(root, sdk.client);

  // §3.6's budget is spent BY the session working the item, and the only thing
  // that puts an itemId on a registry entry is the fan-out engine — so the wave
  // is dispatched and held in flight while its member spends the hatch.
  const tracked = kick(() => callTool(hooks, "conductor_dispatch_wave", {}, root));
  try {
    await waitFor(() => sdk.creates.length > 0 || tracked.settled() !== null, 10_000);
    assert.ok(
      sdk.creates.length > 0,
      `premise: the wave dispatches a member whose registry entry carries an itemId (wave: ${describeSettled(tracked.settled())})`,
    );
    const member = sdk.creates[0];
    const edit = {
      tool: "edit",
      sessionID: member,
      args: { filePath: path.join(root, "src", "beta.ts") },
    };

    const denied = await gateDeny(hooks, edit, "before the override");
    assert.doesNotMatch(
      denied,
      /no conductor item assignment/,
      "premise: the member IS registered, so the deny under test comes from a gate the §3.6 hatch converts, not from the registry rule",
    );

    const minted = await attempt(() =>
      callTool(
        hooks,
        "conductor_override",
        {
          gate: "edit",
          reason: "the item's own session needs one denied edit converted, and §2.1's budget allows one",
          grantedAction: "edit src/beta.ts once",
        },
        root,
        member,
      ),
    );
    assert.equal(
      minted.threw,
      false,
      `conductor_override must mint the §3.6 grant for the calling session's item: ${messageOf(minted.error)}`,
    );

    const allowed = await attempt(async () => {
      await callGate(hooks, edit);
    });
    assert.equal(
      allowed.threw,
      false,
      `the grant must reach gateBeforeToolCall through the SAME map handleOverride minted into: the very next matching edit is still denied, so the hatch has no consumer and §3.6 is a dead seam — ${messageOf(allowed.error)}`,
    );

    const again = await gateDeny(hooks, edit, "after the grant was spent");
    assert.equal(
      again,
      denied,
      "and the grant is ONE-SHOT: the second identical edit is denied again, by the same gate, for the same reason — a grant that is not consumed is a standing bypass, not a hatch",
    );
  } finally {
    await drain(sdk, tracked, 20_000);
  }
});

// ===========================================================================
// 13.1-cr-override-needs-registered-item
// ===========================================================================

test("[13.1-cr-override-needs-registered-item] conductor_override REFUSES when the calling session carries no §3.5 registry itemId rather than choosing one: an orchestrator session has no item assignment, the refusal names §3.6, and the run's state is byte-identical afterwards", async () => {
  const root = gitRoot("conductor-13.1-cr-grant-noitem-");
  const config = makeConfig();
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING" });
  const hooks = await startPlugin(root);

  // Settle the workspace open first, so the comparison below is about the
  // refusal alone.
  await attempt(() => callTool(hooks, "conductor_status", {}, root));
  const before = snapshotTree(path.join(root, ".conductor"));
  assert.ok(before.length > 0, "premise: the run has state on disk to compare");

  const outcome = await attempt(() =>
    callTool(
      hooks,
      "conductor_override",
      {
        gate: "edit",
        reason: "an orchestrator session asking for a hatch it has no item to spend",
        grantedAction: "edit src/beta.ts once",
      },
      root,
    ),
  );
  assert.ok(
    outcome.threw,
    `conductor_override must REFUSE a session with no item assignment rather than choosing one: fabricating an itemId spends the WRONG item's §2.1 override budget and writes the §2.8 taint onto the wrong item. It returned: ${JSON.stringify(outcome.value)}`,
  );
  const message = messageOf(outcome.error);
  assert.ok(
    !(outcome.error instanceof TypeError),
    `and refuses legibly — never a null propagating into the handler: ${message}`,
  );
  assert.match(message, /conductor_override/, "the refusal names the tool that was invoked");
  assert.match(message, /item/i, "and what the session lacks — an item assignment");
  assert.match(
    message,
    /3\.6/,
    "and cites §3.6, the section that says the hatch is spent by the session working the item it applies to",
  );
  assert.doesNotMatch(
    message,
    /no run handler is bound to this session/,
    "premise: the refusal under test is the NO-ITEM refusal, not an unbound tool",
  );
  assert.doesNotMatch(
    message,
    /was not supplied/,
    "premise: and not a missing declared argument — every declared arg was given",
  );
  assert.deepEqual(
    snapshotTree(path.join(root, ".conductor")),
    before,
    "and the run's state is byte-identical afterwards: a refused override is not an override that half-happened",
  );
});

// ===========================================================================
// 13.1-cr-live-means-live-not-present
// ===========================================================================

// A pid that is CONFIRMED absent, never one invented and hoped for. spawnSync
// WAITS for the child and reaps it, so its pid is free the moment the call
// returns — but "free" is not "unused": the kernel may already have handed it to
// somebody else. So the pid is only accepted once signal 0 answers ESRCH ("no
// such process"), which is the same evidence evidence.ts:708-715 pidAlive reads.
// EPERM means the pid EXISTS and belongs to another user, so it is discarded and
// another child spawned. The loop is bounded and its exhaustion is an explicit
// fixture failure, never a silent pass.
function reapedPid(): number {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const pid = child.pid;
    if (typeof pid !== "number" || pid <= 0) continue;
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return pid;
    }
  }
  throw new Error(
    "fixture: could not obtain a pid confirmed absent by signal 0 after 20 reaped children — " +
      "this test needs a genuinely dead pid, and it refuses to guess one",
  );
}

test("[13.1-cr-live-means-live-not-present] liveVerifyTrees applies the VERIFY PATH'S OWN liveness rule and not a second, broader one: an alive-and-fresh marker is reported, while a dead-pid marker and an over-age marker are both ABSENT from the result — and both stay on disk, because a read-only enumeration never breaks another party's marker (§4.3)", async () => {
  const evidence = (await import("../adapter/evidence.ts")) as Record<string, unknown>;
  // The verify path takes the over-age bound as VerifyOptions.staleMarkerMs
  // (evidence.ts:620-622). Whether the ENUMERATION takes the same option is the
  // implementer's call — this alias leaves room for it, and every call below
  // passes ONE argument, so what is pinned here is the DEFAULT behaviour.
  const enumerate = evidence.liveVerifyTrees as (
    dir: string,
    opts?: { staleMarkerMs?: number },
  ) => string[];
  assert.equal(
    typeof enumerate,
    "function",
    "premise: adapter/evidence.ts exports liveVerifyTrees — the enumeration both the wave driver and the gate derivation read",
  );

  const runDir = plainRoot("conductor-13.1-cr-livemarker-");
  const markerOf = (tree: string): string => path.join(runDir, `verify-running-${tree}.json`);
  // The on-disk shape readMarker (evidence.ts:687-705) accepts: an object with a
  // numeric `pid` and a numeric `startMs`, which is exactly what runVerify writes
  // at :839-840.
  const writeMarker = (tree: string, pid: number, startMs: number): void => {
    writeFileSync(markerOf(tree), JSON.stringify({ pid, startMs }));
  };
  // Over the DEFAULT_STALE_MARKER_MS bound of 24h (evidence.ts:637), by an hour.
  const OVER_AGE_MS = 25 * 60 * 60 * 1000;

  // Direction 1 — the positive. A marker whose pid is ALIVE (this process) and
  // whose startMs is fresh is a genuine live freeze and MUST be reported. Without
  // this half, an enumeration that returned nothing at all would pass the rest.
  writeMarker("main", process.pid, Date.now());
  assert.deepEqual(
    enumerate(runDir),
    ["main"],
    "a marker whose pid is alive and whose startMs is fresh is exactly what runVerify honours (evidence.ts:795), so the enumeration must report its tree frozen",
  );

  // Direction 2 — the negatives, in the two shapes runVerify itself BREAKS: a
  // dead pid, and an over-age stamp whose pid happens to be alive (the recycled
  // pid, F6). Each gets its own tree so the result names which one leaked.
  const dead = reapedPid();
  writeMarker("I1", dead, Date.now());
  writeMarker("I2", process.pid, Date.now() - OVER_AGE_MS);

  assert.deepEqual(
    [...enumerate(runDir)].sort(),
    ["main"],
    `the verify path's definition of a live marker is pidAlive(marker.pid) AND not over-age (evidence.ts:794-807, whose own comment says "a crashed run can never wedge a tree"). An enumeration that reports every marker FILE present is a SECOND, broader definition of "live" one seam over: a crashed verify's leftover would hold every write-capable wave member for its tree forever and, once the CR-2 gate derivation lands, deny every edit to that tree forever — the exact wedge the single-source row exists to prevent. Tree "I1" carries a marker whose pid (${dead}) is confirmed absent by signal 0, and tree "I2" one whose startMs is ${OVER_AGE_MS}ms old against a 24h default bound; runVerify would break both, so neither is a live freeze`,
  );

  // ...and NEITHER file was removed. Breaking a marker is runVerify's move (§4.3,
  // evidence.ts:806) — a read-only enumeration that deleted another party's marker
  // would be stealing a holder's freeze on the way past.
  assert.equal(
    existsSync(markerOf("I1")),
    true,
    "the enumeration is READ-ONLY: a dead-pid marker is not reported, but it is not deleted either — rmSync of a marker belongs to runVerify (evidence.ts:806), which breaks it deliberately and records the anomaly on its outcome",
  );
  assert.equal(
    existsSync(markerOf("I2")),
    true,
    "and an over-age marker likewise stays on disk: the enumeration answers a question, it does not settle one",
  );

  // Direction 3 — with the one live marker gone, nothing is frozen: the two
  // broken markers cannot become live by being the only ones left.
  rmSync(markerOf("main"));
  assert.deepEqual(
    enumerate(runDir),
    [],
    "and once the live marker is removed the run holds NO live freeze at all — a dead-pid marker and an over-age marker are not a freeze just because they are the only markers present",
  );
});

// ===========================================================================
// 13.1-cr-runless-status-shape-not-a-second-shape
// ===========================================================================

test("[13.1-cr-runless-status-shape-not-a-second-shape] conductor_status returns ONE shape: the runless return carries exactly the key set the handler produces for a real run — derived from that live call, never from a list typed into this test — and it is bound to the handler's declared result type instead of being a literal no compiler ever sees", async () => {
  const config = makeConfig();

  // The REAL-RUN call. It delegates to the committed handleStatus, so the key set
  // it returns IS the handler's own — and that is where the expectation comes
  // from (C-077: never from the runless branch under test, never from a list
  // copied into this file).
  const withRun = gitRoot("conductor-13.1-cr-shape-run-");
  writeRepoConfig(withRun, config);
  const store = openTestStore(withRun, config);
  const runId = createRunFor(store, SESSION);
  seedQueue(store, runId, "EXECUTING", { I1: "PENDING", I2: "GREEN" });
  const runHooks = await startPlugin(withRun);
  const realRun = parseToolResult(await callTool(runHooks, "conductor_status", {}, withRun));
  assert.equal(
    realRun.runId,
    runId,
    "premise: the real-run call reached the committed handler and reports the live run, so the keys derived from it are handleStatus's own",
  );
  const expectedKeys = Object.keys(realRun).sort();
  assert.ok(
    expectedKeys.length >= 5,
    `premise: the derived key set is the handler's whole StatusResult, not a truncated read — got ${JSON.stringify(expectedKeys)}`,
  );

  // The RUNLESS call. Same tool, same plugin factory, a configured workspace in
  // which no run has ever been created.
  const noRun = gitRoot("conductor-13.1-cr-shape-norun-");
  writeRepoConfig(noRun, config);
  const runlessHooks = await startPlugin(noRun);
  const runless = parseToolResult(await callTool(runlessHooks, "conductor_status", {}, noRun));
  assert.equal(countRuns(noRun), 0, "premise: this workspace genuinely has no run");

  assert.deepEqual(
    Object.keys(runless).sort(),
    expectedKeys,
    "conductor_status must return ONE shape in every state: the no-run return carries exactly the key set the handler produces for a real run, so a field added to StatusResult cannot appear on one branch and be missing from the other",
  );
  assert.equal(
    runless.runId,
    null,
    "and the absent run is REPORTED — null, never a fabricated run id",
  );
  assert.equal(runless.state, null, "and likewise the absent run's state");

  // The half no probe can see — the source-audit idiom this file already uses for
  // the inventory and marker-enumeration rows. The two key sets above agree
  // TODAY, and nothing whatever keeps them agreeing: adapter/tools.ts:808-814
  // declares StatusResult with a NON-nullable runId and state, and the bound
  // tool hands its result back as a JSON string, so the runless object is checked
  // by no compiler at all. That is the defect this row names — two shapes on one
  // tool, with a type covering only one.
  const pluginSource = dropWholeLineComments(readFileSync(pluginPath, "utf8"));
  const start = pluginSource.indexOf("conductor_status: async");
  assert.ok(
    start >= 0,
    "premise: the plugin binds conductor_status in its tool-body map — a failed extraction must be RED here, never a silent pass below",
  );
  const end = pluginSource.indexOf("conductor_forget_stale", start);
  assert.ok(end > start, "premise: the extraction found the end of the conductor_status body");
  const body = pluginSource.slice(start, end);
  assert.ok(
    body.includes("return"),
    "premise: the extracted slice is the binding's body and not an empty string",
  );

  const buildsItsOwnLiteral = /return\s*\{/.test(body);
  const checkedByAType = /(?::|satisfies)\s+[A-Z]\w*/.test(body);
  assert.ok(
    !buildsItsOwnLiteral || checkedByAType,
    "the runless return is a BARE object literal in the tool body — no annotation, no `satisfies`, and the bound tool's own return type is a JSON string, so nothing ever compares it to the handler's declared StatusResult (adapter/tools.ts:808-814, where runId and state are both non-nullable). It is a second shape authored by hand, and the key-set agreement asserted above holds only by coincidence: add a field to StatusResult and the real-run branch grows it while this literal silently does not. Bind the runless return to the handler's own result — return what the handler produces for the empty case, or annotate the object with the handler's declared result type — so the drift is a compile error instead of two shapes on one tool",
  );
});

// ===========================================================================
// ===========================================================================
// CR-2 — THE GATE SNAPSHOT AT THE `tool.execute.before` SEAM.
// ===========================================================================
// ===========================================================================
//
// WHY THESE FIVE ARE RED AT THE CR-1 COMMIT. plugin/index.ts:1247-1249 hands
// gateBeforeToolCall three LITERALS —
//
//     fileScope: [],
//     testScope: [],
//     verifyInFlightTree: null,
//
// — sitting between `gitMode: config.git.mode` and `inlineClaimScope`, both of
// which ARE derived. The phase-13 gate confirmed the MAJOR and MEASURED it: it
// widened the two scopes to ["**"] and the whole build stayed green at
// 1280/1280, because core/gates-edit.ts's implementer arm (:226), test-writer
// arm (:235) and entire freeze branch (:196-198) had no production caller that
// could reach them. Nothing in production constructed a fan-out, so the §3.5
// registry never held an entry carrying an `itemId`, so no scope was derivable
// and no session had a role either arm dispatches on.
//
// CR-1 IS WHAT MAKES THESE BEHAVIOURAL. The bound tools build a REAL createFanout
// over the plugin's ONE registry (plugin/index.ts:826-835), so a dispatching tool
// now leaves {role, itemId, tree} entries the gate hook reads — which is why four
// of these five rows drive the real plugin instead of auditing its text.
//
// THE TREE THESE ROWS USE. A registry entry's `tree` is the value
// adapter/tools.ts:2362 sessionTreeOf produced for the item: its persisted §4.2
// worktree PATH when it has one, else the STAGE_TREE SLUG "main". The edit gate
// compares that value to the edit path by string equality
// (core/gates-edit.ts:128-134 normalizeUnderTree), so these rows give each item a
// worktree of its own — the configuration in which the per-role scope arms are
// reachable at all, and the one in which the freeze row's slug->path translation
// is observable, because verifyInFlightTreeFor("<itemId>") IS that item's
// persisted worktree (adapter/tools.ts:2376-2379).
//
// C-077 THROUGHOUT: every expected scope is read back OFF DISK from the queue.json
// this file wrote, never from anything the plugin reports.
//
// ===========================================================================
// EXPECTED PRODUCTION SURFACE — the one NEW affordance CR-2 requires.
// ===========================================================================
//
// -- conductor/plugin/index.ts ----------------------------------------------
//
// The doctrine directory becomes RESOLVABLE instead of the fixed module-relative
// DOCTRINE_DIR const at :130. It DEFAULTS to the shipped conductor/doctrine and is
// overridable through the plugin's existing session-env channel — the same shape
// :137-139 already uses for LLAMA_HARNESS_ROUTER_URL / _URL / _MODEL, read at CALL
// time (:1074-1084), not frozen at module load:
//
//   const ENV_DOCTRINE_DIR = "LLAMA_HARNESS_DOCTRINE_DIR";
//   // in ensurePacks: process.env[ENV_DOCTRINE_DIR] ?? DOCTRINE_DIR
//
// Nothing else about §6.4 changes: loadPacks stays the loader, its message stays
// the one that names the absent pack, and the failure stays LOUD and fail-closed.
// This is the affordance the spec's knownPartialCoverage entry deferred to CR-2
// ("if the doctrine directory is made injectable there, the half becomes a
// three-line test"), and the row below is written against it.

// The override channel the packs row drives. Named here once so the row and the
// implementation cannot spell it two ways.
const ENV_DOCTRINE_DIR = "LLAMA_HARNESS_DOCTRINE_DIR";

// ---------------------------------------------------------------------------
// CR-2 fixtures
// ---------------------------------------------------------------------------

// A §4.2 tree of an item's own: a real directory, because a stage handler runs the
// item's test with this as its cwd once its sub-session replies.
function itemTreeDir(tag: string): string {
  const dir = plainRoot(tag);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  return dir;
}

interface ItemScopes {
  fileScope: string[];
  testScope: string[];
}

// Give a seeded item its OWN §2.4 scopes and its OWN §4.2 tree, ON DISK, exactly
// where the composition root has to read them from: the run's queue.json (the
// §2.4 entry) and the item's persisted worktree (the §2.5 runtime field). Written
// through the same seed-on-disk discipline the rest of this file uses — never
// through another task's handler.
function scopeItemOnDisk(
  store: StateStore,
  runId: string,
  itemId: string,
  scopes: ItemScopes,
  worktree: string,
): void {
  const queuePath = path.join(runDirOf(store.root, runId), "queue.json");
  const queue = JSON.parse(readFileSync(queuePath, "utf8")) as Queue;
  const entry = queue.items.find((candidate) => candidate.id === itemId);
  assert.ok(entry !== undefined, `premise: ${itemId} is in the seeded queue`);
  entry.fileScope = [...scopes.fileScope];
  entry.testScope = [...scopes.testScope];
  writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  const item = store.loadItem(runId, itemId);
  item.worktree = worktree;
  store.saveItem(runId, item);
}

// The scopes as they are PERSISTED — the expectation source for every scope
// assertion below (C-077: an expected value is never computed by calling the thing
// under test, so it comes off the file this test wrote, not off the plugin).
function persistedScopes(store: StateStore, runId: string, itemId: string): ItemScopes {
  const queuePath = path.join(runDirOf(store.root, runId), "queue.json");
  const queue = JSON.parse(readFileSync(queuePath, "utf8")) as Queue;
  const entry = queue.items.find((candidate) => candidate.id === itemId);
  assert.ok(entry !== undefined, `premise: ${itemId} is in the persisted queue`);
  return { fileScope: [...entry.fileScope], testScope: [...entry.testScope] };
}

interface Dispatched {
  sessionID: string;
  role: string;
  tree: string;
}

// Which session the fan-out registered for an item, read off the run's OWN
// fanout/subsession.dispatched record rather than off the fake SDK's creation
// order: the record is production's own statement of which session belongs to
// which item, and it carries the role and tree that went into the registry entry.
function dispatchOf(runDir: string, itemId: string): Dispatched | null {
  for (const rec of readRunJournal(runDir)) {
    if (rec.event !== "subsession.dispatched") continue;
    const data = (rec.data ?? {}) as Record<string, unknown>;
    if (data.itemId !== itemId) continue;
    const sessionID = rec.sessionID;
    if (typeof sessionID !== "string" || sessionID.length === 0) continue;
    return {
      sessionID,
      role: typeof data.role === "string" ? data.role : "",
      tree: typeof data.tree === "string" ? data.tree : "",
    };
  }
  return null;
}

async function awaitDispatch(runDir: string, itemId: string, budgetMs: number): Promise<Dispatched> {
  await waitFor(() => dispatchOf(runDir, itemId) !== null, budgetMs);
  const dispatched = dispatchOf(runDir, itemId);
  assert.ok(
    dispatched !== null,
    `premise: a sub-session for ${itemId} was dispatched and REGISTERED — no fanout/subsession.dispatched record for that item reached the run journal, so there is no §3.5 registry entry for the gate to derive anything from`,
  );
  return dispatched;
}

// One `edit` tool call as the gate hook receives it.
function editOf(sessionID: string, filePath: string): {
  tool: string;
  sessionID: string;
  args: Record<string, unknown>;
} {
  return { tool: "edit", sessionID, args: { filePath } };
}

interface GateOutcome {
  denied: boolean;
  reason: string;
}

// Drive the REAL gate hook and report BOTH dispositions. gateDeny above asserts a
// deny; these rows must assert allows too, because a derivation that returns
// nothing denies everything and would sail through a deny-only test.
async function gateOutcome(
  hooks: PluginHooks,
  input: { tool: string; sessionID: string; args: Record<string, unknown> },
): Promise<GateOutcome> {
  const outcome = await attempt(async () => {
    await callGate(hooks, input);
  });
  return { denied: outcome.threw, reason: outcome.threw ? messageOf(outcome.error) : "" };
}

// The scope array a per-role deny NAMES, parsed back out of core/gates-edit.ts's
// own message (:231 `fileScope [...]`, :240 `testScope [...]`). Doubles as an
// assertion that the deny is the per-role SCOPE deny and not the tree deny, the
// freeze deny, the .conductor deny or the unknown-role fail-safe — so a row can
// never mistake one refusal for another.
function scopeNamedInDeny(reason: string, ctx: string): string[] {
  const match = /(?:fileScope|testScope) \[([^\]]*)\]/.exec(reason);
  assert.ok(
    match !== null,
    `${ctx}: the refusal must be core/gates-edit.ts's per-role SCOPE deny, which names the scope it judged against — got instead: ${reason}`,
  );
  const inner = (match as RegExpExecArray)[1];
  return inner.length === 0 ? [] : inner.split(", ");
}

// ===========================================================================
// 13.1-cr2-gate-scope-derived-from-registry
// ===========================================================================

test("[13.1-cr2-gate-scope-derived-from-registry] the gate's fileScope and testScope are DERIVED PER CALL from the calling session's §3.5 registry entry — its itemId's persisted §2.4 scopes — and BOTH directions are asserted on BOTH arms, because a derivation that returns nothing denies everything and would sail through a deny-only test", async () => {
  const root = gitRoot("conductor-13.1-cr2-scope-");
  const config = makeConfig({ subSessionTimeoutMs: 30_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "TEST_VETTED", I2: "PENDING", I3: "PENDING" });

  // Three items with DISJOINT scopes and a tree each. I2 is never dispatched: it
  // exists so that "the union of every item's scope" is a DIFFERENT answer from
  // "this session's item's scope", and the assertions below can tell them apart.
  const treeI1 = itemTreeDir("conductor-13.1-cr2-tree-i1-");
  const treeI2 = itemTreeDir("conductor-13.1-cr2-tree-i2-");
  const treeI3 = itemTreeDir("conductor-13.1-cr2-tree-i3-");
  scopeItemOnDisk(store, runId, "I1", { fileScope: ["src/alpha/**"], testScope: ["tests/alpha/**"] }, treeI1);
  scopeItemOnDisk(store, runId, "I2", { fileScope: ["src/beta/**"], testScope: ["tests/beta/**"] }, treeI2);
  scopeItemOnDisk(store, runId, "I3", { fileScope: ["src/gamma/**"], testScope: ["tests/gamma/**"] }, treeI3);

  const scopeI1 = persistedScopes(store, runId, "I1");
  const scopeI3 = persistedScopes(store, runId, "I3");

  const sdk = makeFakeSdk({
    registry: new Map<string, { role?: string; itemId?: string; tree?: string }>(),
    idPrefix: "ses_cr2_scope_",
  });
  const hooks = await startPlugin(root, sdk.client);

  // A TEST_VETTED item's stage dispatches the write-capable IMPLEMENTER
  // (adapter/tools.ts:3895-3904); a PENDING behavioral item's dispatches the
  // write-capable TEST-WRITER (:2988-2998). Both are kicked without awaiting, so
  // the gate can be driven while their sub-sessions are live and registered.
  const implRun = kick(() => callTool(hooks, "conductor_mark_green", { itemId: "I1" }, root));
  const writerRun = kick(() => callTool(hooks, "conductor_submit_test", { itemId: "I3" }, root));
  try {
    const impl = await awaitDispatch(runDir, "I1", 20_000);
    const writer = await awaitDispatch(runDir, "I3", 20_000);
    assert.equal(
      impl.tree,
      treeI1,
      "premise: the implementer's registry entry carries I1's OWN tree, which is what the edit gate normalizes an edit path against",
    );
    assert.equal(writer.tree, treeI3, "premise: and the test-writer's carries I3's");

    // ---- the IMPLEMENTER arm (core/gates-edit.ts:226-233) -------------------

    // ALLOW. This is the half `fileScope: []` cannot pass and a deny-only test
    // would never have noticed: an empty scope matches nothing, so the HEAD
    // literal denies every edit an implementer could ever make.
    const inScope = await gateOutcome(hooks, editOf(impl.sessionID, path.join(treeI1, "src", "alpha", "one.ts")));
    assert.equal(
      inScope.denied,
      false,
      `an implementer registered to I1 must be ALLOWED to edit inside I1's OWN persisted fileScope ${JSON.stringify(scopeI1.fileScope)} — the gate refused with: ${inScope.reason}. plugin/index.ts:1247 passes \`fileScope: []\`, and an empty scope denies EVERYTHING; the scopes must be derived per call from the calling session's registry entry (its itemId's queue.json fileScope/testScope), exactly as gitMode and inlineClaimScope beside them already are`,
    );

    // DENY, and the scope the gate judged against is I1's own. `src/beta/**` is
    // I2's fileScope, so a derivation that unions every item's scope — or that
    // reads the wrong item — is caught here rather than mistaken for a pass.
    const otherItem = await gateOutcome(hooks, editOf(impl.sessionID, path.join(treeI1, "src", "beta", "one.ts")));
    assert.equal(
      otherItem.denied,
      true,
      "an implementer must be DENIED outside its own item's fileScope — src/beta/** belongs to I2, and one session's edit permission is never the union of every item's scope",
    );
    assert.deepEqual(
      scopeNamedInDeny(otherItem.reason, "the implementer's out-of-scope edit"),
      scopeI1.fileScope,
      `the scope the gate judged against must be I1's OWN persisted fileScope (read back off queue.json: ${JSON.stringify(scopeI1.fileScope)}) — not another item's, not a union, and not a constant`,
    );

    // And the two scopes are not conflated: I1's TEST scope is not an
    // implementer's edit permission.
    const ownTestScope = await gateOutcome(
      hooks,
      editOf(impl.sessionID, path.join(treeI1, "tests", "alpha", "one.test.ts")),
    );
    assert.equal(
      ownTestScope.denied,
      true,
      `an implementer is scoped by fileScope alone: I1's testScope ${JSON.stringify(scopeI1.testScope)} is the TEST-WRITER's permission, and handing the same array to both fields would let each role edit the other's files`,
    );

    // ---- the TEST-WRITER arm (core/gates-edit.ts:235-242) -------------------
    //
    // core/gates-edit.ts:235 dispatches its testScope arm on the role string
    // "test-writer"; adapter/tools.ts:2991 registers the write-capable writer as
    // "testWriter". Both spellings are named here so a red is legible rather than
    // mysterious: the row's claim is that a test-writer session is ALLOWED inside
    // its testScope, and a role no arm matches falls to :249's unknown-role
    // fail-safe, which denies everything — the same shape as an empty scope, and
    // the same reason a deny-only test would have missed it.
    const writerRoleNote =
      `the fan-out registered this session's role as "${writer.role}"; core/gates-edit.ts:235 ` +
      'dispatches its testScope arm on "test-writer" and :249 denies every role it does not ' +
      "recognise, so the two vocabularies have to be ONE fact for this arm to be reachable at all";

    const writerInTests = await gateOutcome(
      hooks,
      editOf(writer.sessionID, path.join(treeI3, "tests", "gamma", "one.test.ts")),
    );
    assert.equal(
      writerInTests.denied,
      false,
      `a test-writer registered to I3 must be ALLOWED inside I3's OWN persisted testScope ${JSON.stringify(scopeI3.testScope)} — the gate refused with: ${writerInTests.reason}. ${writerRoleNote}`,
    );

    const writerInSrc = await gateOutcome(
      hooks,
      editOf(writer.sessionID, path.join(treeI3, "src", "gamma", "one.ts")),
    );
    assert.equal(
      writerInSrc.denied,
      true,
      `a test-writer must be DENIED inside its item's fileScope ${JSON.stringify(scopeI3.fileScope)} — writing production code is the implementer's charge, and §2.4's two scopes exist so the two roles cannot reach each other's files`,
    );
    assert.deepEqual(
      scopeNamedInDeny(writerInSrc.reason, "the test-writer's production-file edit"),
      scopeI3.testScope,
      `and the scope the gate judged a test-writer against is the item's TESTSCOPE (${JSON.stringify(scopeI3.testScope)}), read from I3's own persisted queue entry — a snapshot that fills both fields from one array cannot tell these two denies apart`,
    );
  } finally {
    await drain(sdk, implRun, 15_000);
    await drain(sdk, writerRun, 15_000);
  }
});

// ===========================================================================
// 13.1-cr2-widening-the-scope-goes-red
// ===========================================================================

test("[13.1-cr2-widening-the-scope-goes-red] widening the derived scope to ['**'] turns this suite RED: the exact mutation the phase-13 gate ran at 1280/1280 green (findings §Phase 13 MAJOR 6) is caught by requiring every deny to NAME the item's own persisted fileScope, so a derivation that ignores the item and returns a permissive constant cannot recur unobserved", async () => {
  const root = gitRoot("conductor-13.1-cr2-widen-");
  const config = makeConfig({ subSessionTimeoutMs: 30_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "TEST_VETTED" });

  const tree = itemTreeDir("conductor-13.1-cr2-widen-tree-");
  scopeItemOnDisk(store, runId, "I1", { fileScope: ["src/alpha/**"], testScope: ["tests/alpha/**"] }, tree);
  const scope = persistedScopes(store, runId, "I1");

  const sdk = makeFakeSdk({
    registry: new Map<string, { role?: string; itemId?: string; tree?: string }>(),
    idPrefix: "ses_cr2_widen_",
  });
  const hooks = await startPlugin(root, sdk.client);

  const tracked = kick(() => callTool(hooks, "conductor_mark_green", { itemId: "I1" }, root));
  try {
    const impl = await awaitDispatch(runDir, "I1", 20_000);

    // Anti-vacuity FIRST: a scope that admits nothing denies everything, and every
    // deny below would be green against it. The allow is what makes the denies
    // mean something.
    const admitted = await gateOutcome(hooks, editOf(impl.sessionID, path.join(tree, "src", "alpha", "one.ts")));
    assert.equal(
      admitted.denied,
      false,
      `premise: the derived scope ADMITS the item's own files (${JSON.stringify(scope.fileScope)}) — the gate refused with: ${admitted.reason}. Every deny asserted below is vacuous against a scope that admits nothing`,
    );

    // `**` spans separators including the leading one (core/gates-edit.ts:123-127),
    // so each of these paths is matched by the mutation and by NOTHING the item
    // declared. Each must be a deny, and each deny must name the item's own scope.
    const widenedButNotOurs = [
      path.join(tree, "src", "beta", "one.ts"),
      path.join(tree, "tests", "alpha", "one.test.ts"),
      path.join(tree, "README.md"),
    ];
    for (const filePath of widenedButNotOurs) {
      const outcome = await gateOutcome(hooks, editOf(impl.sessionID, filePath));
      assert.equal(
        outcome.denied,
        true,
        `${filePath} is outside the item's declared fileScope ${JSON.stringify(scope.fileScope)} and must be DENIED. Widening the derived scopes to ["**"] admits it — that is the mutation the phase-13 gate ran against the whole build without turning a single test red, because no production caller could reach core/gates-edit.ts's implementer arm at all`,
      );
      assert.deepEqual(
        scopeNamedInDeny(outcome.reason, `the deny for ${filePath}`),
        scope.fileScope,
        `and the deny must NAME the item's own persisted fileScope, so a permissive constant is red by its own message: expected ${JSON.stringify(scope.fileScope)}, and a derivation that returned ["**"] would not have denied this at all`,
      );
    }
  } finally {
    await drain(sdk, tracked, 15_000);
  }
});

// ===========================================================================
// 13.1-cr2-freeze-denies-only-its-own-tree
// ===========================================================================

test("[13.1-cr2-freeze-denies-only-its-own-tree] verifyInFlightTree is derived from the LIVE marker set and translated slug->path through the committed verifyInFlightTreeFor: while a marker is live for tree T an edit by a session in T is DENIED, an edit by a session in a DIFFERENT tree is ALLOWED, and once the marker clears the same denied edit succeeds — the allow half is what proves the field is a TREE COMPARISON and not a global 'something is verifying' boolean", async () => {
  const root = gitRoot("conductor-13.1-cr2-freeze-");
  const config = makeConfig({ subSessionTimeoutMs: 30_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "TEST_VETTED", I2: "TEST_VETTED" });

  const treeI1 = itemTreeDir("conductor-13.1-cr2-freeze-i1-");
  const treeI2 = itemTreeDir("conductor-13.1-cr2-freeze-i2-");
  scopeItemOnDisk(store, runId, "I1", { fileScope: ["src/alpha/**"], testScope: ["tests/alpha/**"] }, treeI1);
  scopeItemOnDisk(store, runId, "I2", { fileScope: ["src/beta/**"], testScope: ["tests/beta/**"] }, treeI2);

  const sdk = makeFakeSdk({
    registry: new Map<string, { role?: string; itemId?: string; tree?: string }>(),
    idPrefix: "ses_cr2_freeze_",
  });
  const hooks = await startPlugin(root, sdk.client);

  // Both sub-sessions are registered BEFORE any marker exists: the fan-out's own
  // §3.5 freeze admission (the treeState CR-1 built) holds a write-capable job out
  // of a frozen tree, so a marker written first would prevent the very
  // registration these assertions need.
  const runI1 = kick(() => callTool(hooks, "conductor_mark_green", { itemId: "I1" }, root));
  const runI2 = kick(() => callTool(hooks, "conductor_mark_green", { itemId: "I2" }, root));
  const editI1 = path.join(treeI1, "src", "alpha", "one.ts");
  const editI2 = path.join(treeI2, "src", "beta", "one.ts");

  // The §2.6 marker adapter/evidence.ts writes, named by the evidence layer's tree
  // SLUG — which for an item that has a worktree is its ITEM ID, not a path. That
  // is the whole of C-037 ruling 5: verifyInFlightTreeFor("I1") is the only thing
  // that turns this filename into the PATH core/gates-edit.ts:196-198 compares.
  const markerPath = path.join(runDir, "verify-running-I1.json");

  try {
    const implI1 = await awaitDispatch(runDir, "I1", 20_000);
    const implI2 = await awaitDispatch(runDir, "I2", 20_000);

    const beforeI1 = await gateOutcome(hooks, editOf(implI1.sessionID, editI1));
    assert.equal(
      beforeI1.denied,
      false,
      `premise: with NO marker on disk, I1's implementer may edit inside its own scope — the gate refused with: ${beforeI1.reason}`,
    );
    const beforeI2 = await gateOutcome(hooks, editOf(implI2.sessionID, editI2));
    assert.equal(beforeI2.denied, false, `premise: and so may I2's — the gate refused with: ${beforeI2.reason}`);

    writeFileSync(markerPath, JSON.stringify({ pid: process.pid, startMs: Date.now() }));

    // (a) DENY — the frozen tree's own session. The path is inside I1's fileScope,
    //     so a scope deny here would be the WRONG refusal and the assertion on the
    //     reason says so.
    const frozen = await gateOutcome(hooks, editOf(implI1.sessionID, editI1));
    assert.equal(
      frozen.denied,
      true,
      `while ${path.basename(markerPath)} is live, EVERY edit in I1's tree is denied (§3.5's strict reading, core/gates-edit.ts:196-198) — source, test and config alike. plugin/index.ts:1249 passes \`verifyInFlightTree: null\`, which makes that branch unreachable and this freeze silently never fire`,
    );
    assert.match(
      frozen.reason,
      /verify marker is live for this tree/,
      `and the refusal is the FREEZE, not a scope deny: ${editI1} is inside I1's own fileScope. The marker's name carries the evidence layer's SLUG ("I1"), while the gate compares a PATH by string equality — adapter/tools.ts:2376 verifyInFlightTreeFor is the committed translation, and a snapshot that hands the raw slug across matches no session tree and fires nothing (got: ${frozen.reason})`,
    );

    // (b) ALLOW — a DIFFERENT tree, while the same marker is still live. This is
    //     the half that proves the field is a tree comparison: a global
    //     "something is verifying" boolean, or a marker enumeration whose first
    //     entry is used for every session, denies this and is wrong.
    const neighbour = await gateOutcome(hooks, editOf(implI2.sessionID, editI2));
    assert.equal(
      neighbour.denied,
      false,
      `I2's tree has NO live marker, so its implementer must still be ALLOWED while I1's verify runs — the gate refused with: ${neighbour.reason}. core/gates-edit.ts:196-198 freezes on tree EQUALITY, not on the mere presence of a marker somewhere in the run`,
    );

    // (c) and the freeze LIFTS: the same denied edit succeeds once the marker goes.
    rmSync(markerPath);
    const thawed = await gateOutcome(hooks, editOf(implI1.sessionID, editI1));
    assert.equal(
      thawed.denied,
      false,
      `once the marker clears, the SAME edit must be allowed again — the gate refused with: ${thawed.reason}. A verifyInFlightTree derived once and cached would wedge the tree for the rest of the session, which is the §3.5 half adapter/evidence.ts liveVerifyTrees exists to keep honest`,
    );
  } finally {
    await drain(sdk, runI1, 15_000);
    await drain(sdk, runI2, 15_000);
    if (existsSync(markerPath)) rmSync(markerPath);
  }
});

// ===========================================================================
// 13.1-cr2-no-literals-left-at-the-seam
// ===========================================================================

test("[13.1-cr2-no-literals-left-at-the-seam] the source guard for the half no probe can see: the extracted gateBeforeToolCall argument object matches none of `fileScope: []`, `testScope: []`, `verifyInFlightTree: null`, and every one of the three is assigned from a DERIVATION — including when the literal merely moves one line up into the identifier the seam now passes", async () => {
  // The committed composition.test.ts:1493-1530 idiom, extended: extract the call
  // site, drop whole-line comments so prose ABOVE a field can neither satisfy nor
  // trip a check, hold an anti-vacuity floor so a broken extraction is RED rather
  // than a silent pass, and only then assert.
  const source = readFileSync(pluginPath, "utf8");
  const hookStart = source.indexOf('"tool.execute.before"');
  assert.ok(hookStart >= 0, "premise: the plugin still registers the tool.execute.before gate hook");
  const callStart = source.indexOf("gateBeforeToolCall({", hookStart);
  assert.ok(callStart > hookStart, "premise: the hook still delegates the whole decision to gateBeforeToolCall");
  const callEnd = source.indexOf("});", callStart);
  assert.ok(callEnd > callStart, "premise: the call site's argument object terminates readably");

  const callSite = dropWholeLineComments(source.slice(callStart, callEnd));
  assert.ok(
    callSite.length > 120,
    `premise: the extracted call site is the real argument object (got ${callSite.length} chars) — a broken extraction must be red, never a vacuous green`,
  );
  // A positive control on the extraction itself: the two fields that were ALREADY
  // derived at HEAD sit in this object, so their absence means the slice missed.
  assert.match(
    callSite,
    /gitMode\s*:\s*config\.git\.mode\b/,
    "premise: the extracted slice is the gate snapshot — it carries the already-derived gitMode",
  );
  assert.match(
    callSite,
    /branchPolicy\s*:\s*config\.git\.branchPolicy\b/,
    "premise: and the already-derived branchPolicy",
  );

  // The hook body up to the call, for the second half of the check below.
  const hookBody = dropWholeLineComments(source.slice(hookStart, callStart));
  assert.ok(
    hookBody.length > 120,
    `premise: the hook body above the call site extracted (got ${hookBody.length} chars)`,
  );

  const BARE_LITERAL = /^(\[\s*\]|null|undefined|\[[^\]]*\]|""|''|``)$/;

  const fields: { name: string; head: RegExp; literal: RegExp; wasLiterally: string }[] = [
    { name: "fileScope", head: /fileScope\s*:\s*([A-Za-z_$])/, literal: /fileScope\s*:\s*(\[|null\b|undefined\b|["'`])/, wasLiterally: "[]" },
    { name: "testScope", head: /testScope\s*:\s*([A-Za-z_$])/, literal: /testScope\s*:\s*(\[|null\b|undefined\b|["'`])/, wasLiterally: "[]" },
    {
      name: "verifyInFlightTree",
      head: /verifyInFlightTree\s*:\s*([A-Za-z_$])/,
      literal: /verifyInFlightTree\s*:\s*(null\b|undefined\b|false\b|true\b|\[|["'`])/,
      wasLiterally: "null",
    },
  ];

  for (const field of fields) {
    assert.doesNotMatch(
      callSite,
      field.literal,
      `the gate's \`${field.name}\` is still a LITERAL at the seam (it was \`${field.name}: ${field.wasLiterally}\` at HEAD, plugin/index.ts:1247-1249). It sits between \`gitMode: config.git.mode\` and \`inlineClaimScope\`, both derived — this is the whole of the phase-13 gate's MAJOR 6, and a hardcoded ["**"] is the exact mutation that regression demonstrated`,
    );
    assert.match(
      callSite,
      field.head,
      `and \`${field.name}\` must be assigned from a DERIVATION — an identifier, a property read, a call or a conditional — not a value written out at the call site`,
    );

    // The half a "no literal at the seam" check alone cannot see: the literal
    // moving one line up into the identifier the seam now passes. If the value is
    // rooted in a name the hook itself binds, at least one of that name's
    // assignments must be something other than a bare literal.
    const value = new RegExp(`${field.name}\\s*:\\s*([^,\\n]*)`).exec(callSite);
    assert.ok(value !== null, `premise: ${field.name}'s value at the call site is readable`);
    const rootIdent = /^[A-Za-z_$][\w$]*/.exec((value as RegExpExecArray)[1].trim());
    if (rootIdent === null) continue;
    const assignments = [
      ...hookBody.matchAll(new RegExp(`\\b${rootIdent[0]}\\b[^=;\\n]*(?<![=!<>])=(?!=)\\s*([^;\\n]+)`, "g")),
    ].map((match) => (match[1] ?? "").trim().replace(/,$/, ""));
    if (assignments.length === 0) continue;
    assert.ok(
      assignments.some((rhs) => !BARE_LITERAL.test(rhs)),
      `\`${field.name}\` is passed as \`${rootIdent[0]}\`, but every assignment to \`${rootIdent[0]}\` in the hook is a bare literal (${JSON.stringify(assignments)}) — the literal moved one line up, it did not become a derivation. The scopes come from the calling session's §3.5 registry entry (its itemId's persisted §2.4 scopes) and the freeze from the live marker set through adapter/tools.ts:2376 verifyInFlightTreeFor`,
    );
  }
});

// ===========================================================================
// 13.1-cr2-packs-missing-fails-closed
// ===========================================================================

test("[13.1-cr2-packs-missing-fails-closed] the doctrine directory is RESOLVABLE — defaulting to the shipped conductor/doctrine, overridable by an explicit channel — and against a directory missing a required pack the tools REFUSE: the failure is reported at error level NAMING the absent pack, no sub-session is dispatched, and the refusal reaches the caller", async () => {
  // The shipped pack set, read off disk. It is the source for BOTH the copy the
  // legs below build and the name of the pack that is withheld — nothing here is
  // a list typed into this test.
  const shipped = readdirSync(doctrineDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  assert.ok(
    shipped.length >= 9,
    `premise: conductor/doctrine ships the §6.4 pack set (found ${JSON.stringify(shipped)})`,
  );
  const withheld = shipped.includes("tdd.md") ? "tdd.md" : shipped[0];

  function doctrineCopy(tag: string, omit: string | null): string {
    const dir = plainRoot(tag);
    for (const name of shipped) {
      if (name === omit) continue;
      writeFileSync(path.join(dir, name), readFileSync(path.join(doctrineDir, name), "utf8"));
    }
    return dir;
  }

  // One dispatching leg: a PENDING behavioral item, whose stage tool dispatches a
  // write-capable sub-session. "No sub-session is dispatched" is then observable
  // as a fact about the fake SDK, not as an absence of evidence.
  interface Leg {
    threw: boolean;
    message: string;
    creates: number;
    records: Rec[];
  }

  async function driveSubmitTest(tag: string, doctrine: string | null): Promise<Leg> {
    const root = gitRoot(tag);
    const config = makeConfig({ subSessionTimeoutMs: 8_000 });
    writeRepoConfig(root, config);
    const store = openTestStore(root, config);
    const runId = createRunFor(store, SESSION);
    const runDir = runDirOf(root, runId);
    seedQueue(store, runId, "EXECUTING", { I1: "PENDING" });

    const priorDoctrine = process.env[ENV_DOCTRINE_DIR];
    if (doctrine === null) delete process.env[ENV_DOCTRINE_DIR];
    else process.env[ENV_DOCTRINE_DIR] = doctrine;

    const stderrLines: string[] = [];
    const originalError = console.error;
    const sdk = makeFakeSdk({
      registry: new Map<string, { role?: string; itemId?: string; tree?: string }>(),
      idPrefix: `ses_cr2_packs_${tag}`,
    });
    let outcome: Attempt;
    let tracked: Tracked | null = null;
    try {
      console.error = (...args: unknown[]): void => {
        stderrLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      };
      // The env is set BEFORE the factory runs and read on the way to the handler:
      // the doctrine directory is resolved per plugin instance, exactly as
      // plugin/index.ts:1074-1084 already reads its LLAMA_HARNESS_* session env at
      // call time rather than freezing it at module load.
      const hooks = await startPlugin(root, sdk.client);
      tracked = kick(() => callTool(hooks, "conductor_submit_test", { itemId: "I1" }, root));
      await waitFor(() => sdk.creates.length > 0 || tracked?.settled() !== null, 10_000);
      await drain(sdk, tracked, 10_000);
      const settled = tracked.settled();
      outcome =
        settled === null || settled.ok
          ? { threw: false, error: undefined, value: settled?.value }
          : { threw: true, error: settled.error, value: undefined };
    } finally {
      console.error = originalError;
      if (priorDoctrine === undefined) delete process.env[ENV_DOCTRINE_DIR];
      else process.env[ENV_DOCTRINE_DIR] = priorDoctrine;
      if (tracked !== null) await drain(sdk, tracked, 5_000);
    }

    // The §7.1 stderr sink AND the run's own journal.jsonl: which of the two a
    // record lands on depends only on whether the journal was already bound to a
    // run when it was written, and this row is about the record's LEVEL and
    // CONTENT, not about which sink carried it (the bundle row above reads both
    // for the same reason).
    const records: Rec[] = [];
    for (const line of stderrLines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed !== null && typeof parsed === "object") records.push(parsed as Rec);
      } catch {
        continue;
      }
    }
    records.push(...readRunJournal(runDir));
    return {
      threw: outcome.threw,
      message: outcome.threw ? messageOf(outcome.error) : "",
      creates: sdk.creates.length,
      records,
    };
  }

  // ---- (a) the override, pointed at a directory MISSING a required pack ------
  const broken = await driveSubmitTest("conductor-13.1-cr2-packs-missing-", doctrineCopy("conductor-13.1-cr2-doctrine-broken-", withheld));
  assert.equal(
    broken.creates,
    0,
    `with the doctrine directory missing "${withheld}", NO sub-session may be dispatched: doctrine is checked before the fan-out is driven, never after a write-capable session is already carrying none. The fake SDK saw ${broken.creates} session.create calls, which is what an IGNORED override looks like — plugin/index.ts:130 resolves DOCTRINE_DIR from the plugin's own module URL and nothing in conductor/ overrides it, so the shipped packs loaded and the stage tool dispatched regardless of what the operator's doctrine directory actually contains. That unresolvable directory is why the §6.4 fail-closed half of 13.1-cr-packs-loaded-fail-closed could not be bound at CR-1 (spec knownPartialCoverage), and making it resolvable is what pays that debt`,
  );
  assert.equal(
    broken.threw,
    true,
    `and the tool REFUSES, with the refusal reaching the caller — §6.4 fail-closed. A composition root that swallows the load failure and hands the handlers an empty \`packs\` record is the §3.8 silent-degradation shape this row exists to forbid`,
  );
  assert.match(
    broken.message,
    new RegExp(withheld.replace(".", "\\.")),
    `and the refusal NAMES the absent pack — adapter/inject.ts:256 loadPacks already puts the filename in its own message, so the composition root has only to let it through: got ${broken.message}`,
  );
  const named = broken.records.filter(
    (rec) => rec.level === "error" && JSON.stringify(rec.data ?? {}).includes(withheld),
  );
  assert.ok(
    named.length > 0,
    `and the failure is REPORTED at error level naming the absent pack — a refusal the caller sees but the operator's record does not is half a fail-closed. Records seen: ${JSON.stringify(broken.records.map((rec) => ({ level: rec.level, component: rec.component, event: rec.event })))}`,
  );

  // ---- (b) the SAME override, pointed at a COMPLETE copy --------------------
  // Proves (a)'s refusal was caused by the ABSENT PACK and not by the existence of
  // the override: an override that always refuses is not a resolution.
  const complete = await driveSubmitTest("conductor-13.1-cr2-packs-complete-", doctrineCopy("conductor-13.1-cr2-doctrine-complete-", null));
  assert.doesNotMatch(
    complete.message,
    /doctrine pack/,
    `an override pointed at a COMPLETE pack set must load: ${complete.message}`,
  );
  assert.ok(
    complete.creates > 0,
    `and the stage tool goes on to dispatch its write-capable sub-session (the fake SDK saw ${complete.creates} session.create calls) — so the override is a directory RESOLUTION, not a kill switch`,
  );

  // ---- (c) NO override: the default resolution is unchanged -----------------
  const shippedLeg = await driveSubmitTest("conductor-13.1-cr2-packs-default-", null);
  assert.doesNotMatch(
    shippedLeg.message,
    /doctrine pack/,
    `with no override set, production must still load the shipped pack set from conductor/doctrine — the default resolution is not allowed to change: ${shippedLeg.message}`,
  );
  assert.ok(
    shippedLeg.creates > 0,
    `and the stage tool dispatches exactly as it does today (the fake SDK saw ${shippedLeg.creates} session.create calls). A resolution that reads the env but loses the shipped default refuses EVERY tool in a repo that never set it`,
  );
});

// ===========================================================================
// 13.1-cr2-one-role-vocabulary
// ===========================================================================
//
// Two files name the same fact and they disagree, so the guard has to read BOTH
// of them (C-077: neither side's expectation may be computed from the other's
// file). The gate side is a SOURCE AUDIT — a role string an arm compares against
// is unobservable from outside unless a session carrying it already exists, which
// is precisely what is missing — so it reuses conductor/tests/journal-vocab.test.ts's
// idiom and carries the same anti-vacuity floor: whole-line comments dropped so
// prose cannot satisfy a match, and a parse that finds nothing, or that loses the
// known-good "implementer", is RED rather than a silent pass.

const gatesEditPath = path.join(conductorDir, "core", "gates-edit.ts");
const toolsPath = path.join(conductorDir, "adapter", "tools.ts");
const repoRootDir = path.dirname(conductorDir);
const gatesEditLabel = path.relative(repoRootDir, gatesEditPath);
const toolsLabel = path.relative(repoRootDir, toolsPath);

// Every role string core/gates-edit.ts DISPATCHES on: the `sessionRole === "..."`
// arms, plus the roles in whatever list it tests with `<LIST>.includes(sessionRole)`
// — the list is found through its USE, not by its name, so renaming READER_ROLES
// does not quietly shrink this set to the equality arms alone.
function gateDispatchRoles(): string[] {
  const source = dropWholeLineComments(readFileSync(gatesEditPath, "utf8"));
  const roles = new Set<string>();
  for (const match of source.matchAll(/sessionRole\s*===\s*"([^"]+)"/g)) roles.add(match[1]);
  const listNames = new Set(
    [...source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.includes\(\s*sessionRole\s*\)/g)].map(
      (match) => match[1],
    ),
  );
  for (const name of listNames) {
    const declared = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*\\[([^\\]]*)\\]`).exec(source);
    assert.ok(
      declared !== null,
      `ANTI-VACUITY: ${gatesEditLabel} dispatches through \`${name}.includes(sessionRole)\` but this extraction cannot find ${name}'s array literal, so the roles reached through that list are invisible to this guard — a parse that silently sees nothing is a guard that silently passes`,
    );
    const listed = [...(declared === null ? "" : declared[1]).matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.ok(
      listed.length > 0,
      `ANTI-VACUITY: ${name} is dispatched on in ${gatesEditLabel} but its declaration yielded no role strings`,
    );
    for (const role of listed) roles.add(role);
  }
  return [...roles].sort();
}

// The fan-out's OWN role vocabulary, read from the other file: the `role:` literals
// on FanoutJob construction (the registry entry a sub-session is registered with)
// and on the persisted `askedBy.role` beside them. Read from source because no
// single run dispatches all nine roles; the run below grounds it in what production
// actually registered.
function fanoutRegisteredRoles(): string[] {
  const source = dropWholeLineComments(readFileSync(toolsPath, "utf8"));
  const roles = new Set<string>();
  for (const match of source.matchAll(/\brole:\s*"([^"]+)"\s*,\s*\n\s*itemId\s*[,:]/g)) {
    roles.add(match[1]);
  }
  for (const match of source.matchAll(/askedBy:\s*\{\s*role:\s*"([^"]+)"/g)) roles.add(match[1]);
  return [...roles].sort();
}

test("[13.1-cr2-one-role-vocabulary] the roles the EDIT GATE dispatches on and the roles the FAN-OUT registers are ONE vocabulary, not two: every role string core/gates-edit.ts compares sessionRole against must be a role adapter/tools.ts actually registers — both sets derived at run time from the two DIFFERENT files, the fan-out's grounded in the roles this run really registered, so a rename on either side is RED instead of a silently dead gate arm", async () => {
  // ---- (a) OBSERVED: the roles production actually registers -----------------
  //
  // Two write-capable stage tools through the real bound plugin: a TEST_VETTED
  // item's mark_green dispatches the implementer, a PENDING behavioral item's
  // submit_test dispatches the write-capable test author. Their roles are read off
  // the run's OWN fanout/subsession.dispatched records — production's statement of
  // what went into the §3.5 registry entry, not this test's opinion of it.
  const root = gitRoot("conductor-13.1-cr2-vocab-");
  const config = makeConfig({ subSessionTimeoutMs: 30_000 });
  writeRepoConfig(root, config);
  const store = openTestStore(root, config);
  const runId = createRunFor(store, SESSION);
  const runDir = runDirOf(root, runId);
  seedQueue(store, runId, "EXECUTING", { I1: "TEST_VETTED", I2: "PENDING" });

  const treeI1 = itemTreeDir("conductor-13.1-cr2-vocab-i1-");
  const treeI2 = itemTreeDir("conductor-13.1-cr2-vocab-i2-");
  scopeItemOnDisk(
    store,
    runId,
    "I1",
    { fileScope: ["src/alpha/**"], testScope: ["tests/alpha/**"] },
    treeI1,
  );
  scopeItemOnDisk(
    store,
    runId,
    "I2",
    { fileScope: ["src/beta/**"], testScope: ["tests/beta/**"] },
    treeI2,
  );

  const sdk = makeFakeSdk({
    registry: new Map<string, { role?: string; itemId?: string; tree?: string }>(),
    idPrefix: "ses_cr2_vocab_",
  });
  const hooks = await startPlugin(root, sdk.client);

  const implRun = kick(() => callTool(hooks, "conductor_mark_green", { itemId: "I1" }, root));
  const writerRun = kick(() => callTool(hooks, "conductor_submit_test", { itemId: "I2" }, root));
  let observed: string[] = [];
  try {
    const implementerSide = await awaitDispatch(runDir, "I1", 20_000);
    const writerSide = await awaitDispatch(runDir, "I2", 20_000);
    observed = [...new Set([implementerSide.role, writerSide.role])].sort();
  } finally {
    await drain(sdk, implRun, 15_000);
    await drain(sdk, writerRun, 15_000);
  }

  assert.equal(
    observed.length,
    2,
    `premise: this run must register TWO DIFFERENT write-capable roles — the implementer (I1, mark_green) and the test author (I2, submit_test). Observed on the run's fanout/subsession.dispatched records: ${JSON.stringify(observed)}`,
  );

  // ---- (b) the two derived sets --------------------------------------------
  const gateRoles = gateDispatchRoles();
  const fanoutRoles = fanoutRegisteredRoles();

  assert.ok(
    gateRoles.length > 0 && gateRoles.includes("implementer"),
    `ANTI-VACUITY (gate side): reading ${gatesEditLabel} produced ${JSON.stringify(gateRoles)}, which does not contain the known-good role "implementer" that both files spell the same way today — the extraction is broken, and a broken extraction must be RED, never a vacuous pass`,
  );
  assert.ok(
    fanoutRoles.length > 0 && fanoutRoles.includes("implementer"),
    `ANTI-VACUITY (fan-out side): reading ${toolsLabel} produced ${JSON.stringify(fanoutRoles)}, which does not contain the known-good role "implementer" — the extraction is broken`,
  );
  const unseen = observed.filter((role) => !fanoutRoles.includes(role));
  assert.deepEqual(
    unseen,
    [],
    `ANTI-VACUITY (fan-out side, grounded): the roles this run REALLY registered (${JSON.stringify(observed)}, off the run's fanout/subsession.dispatched records) must all appear in the vocabulary read out of ${toolsLabel} (${JSON.stringify(fanoutRoles)}) — ${JSON.stringify(unseen)} did not, so the source read is not describing what production does and nothing below it can be trusted`,
  );

  // ---- (c) ONE vocabulary ---------------------------------------------------
  //
  // Not "the two sets overlap" — "implementer" overlaps today and the dead arm
  // would survive that. Every role the gate dispatches on must be one the fan-out
  // registers, or that arm is unreachable and the session it was written for falls
  // through to the unknown-role fail-safe, which denies every edit it makes.
  const registered = new Set([...fanoutRoles, ...observed]);
  const unregistered = gateRoles.filter((role) => !registered.has(role));
  assert.deepEqual(
    unregistered,
    [],
    `${gatesEditLabel} dispatches on ${unregistered.length} role string(s) NO session can ever carry: ${JSON.stringify(unregistered)}.\n` +
      `  GATE side, derived from ${gatesEditLabel} (its \`sessionRole === "..."\` arms plus the list it tests with \`.includes(sessionRole)\`): ${JSON.stringify(gateRoles)}\n` +
      `  FAN-OUT side, derived from ${toolsLabel} (the \`role:\` literals on FanoutJob construction and on the persisted \`askedBy.role\`): ${JSON.stringify(fanoutRoles)}\n` +
      `  and OBSERVED on this run's own fanout/subsession.dispatched records: ${JSON.stringify(observed)}\n` +
      `A session registered as one of ${JSON.stringify(observed)} matches none of ${JSON.stringify(unregistered)}, so it falls past every arm to ${gatesEditLabel}'s unknown-role fail-safe and is DENIED EVERY EDIT — the arm written for it has never once been reachable from production. Resolve it by RENAMING one side so the two files spell one fact one way; a table at the composition root that translates ${JSON.stringify(unregistered)} into what the fan-out registers (plugin/index.ts's EDIT_GATE_ROLES) is a THIRD site for the same fact and is deleted, not extended`,
  );
});
