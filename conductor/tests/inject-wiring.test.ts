// conductor/tests/inject-wiring.test.ts — the §6.4 DELIVERY WITNESS.
//
// SUBJECTS (edited): conductor/plugin/index.ts (hook registration + the delivery
// composition seam) and conductor/adapter/inject.ts (composeDelivery, the one
// function that turns a session's registry entry and the persisted run state into
// the three things a dispatched session must actually receive).
//
// WHY THIS FILE EXISTS. The §6.4 injection layer was BUILT and never WIRED: the
// plugin returned `tool`, `chat.message`, `tool.execute.before` and `event` and
// nothing else, so `experimental.chat.system.transform`, `chat.params` and
// `chat.headers` were never registered and adapter/inject.ts was dead in
// production. Every test that claimed "doctrine is delivered" computed the append
// by calling buildSystemAppend ITSELF — the shape where the harness proves its own
// helper rather than the wire. Nothing was red. The mechanism the whole design
// rests on ("process re-stated every turn, never remembered") reached no session.
//
// So the assertions below never call the composition helpers to decide what
// "delivered" means. They construct the REAL plugin, invoke the hooks OPENCODE
// invokes, with the hook argument shapes @opencode-ai/plugin declares, and read
// what lands in the outputs opencode forwards to the provider. Unregister any one
// of the three hooks and a row here goes red.
//
// THE THREE LAYERS OF THE WITNESS (the wire layer is the sibling
// conductor/tests/live-inject.test.ts, which drives a real `opencode serve`):
//   (b) runtime receipt — the transform hook journals `inject`/`system-append`
//       naming the session, the role, the packs delivered and their digest, so a
//       live run leaves a trail that a doctrine-less dispatch cannot forge.
//   (c) init ordering — the §6.4 packs load BEFORE adapter/state.ts writes the
//       §3.8 liveness beacon, so the beacon's PRESENCE means doctrine is
//       deliverable. With a pack missing, no beacon is written and no run begins.
//
// The §7.4 vocabulary is NOT widened here: `inject`/`system-append` is already the
// listed name for "the system-prompt append the plugin performs"
// (core/journal-events.ts:52), and it states exactly what happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ConductorPlugin } from "../plugin/index.ts";
import { DEFAULT_CONFIG } from "../adapter/config-io.ts";
import { initRepo } from "../adapter/gitio.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import type { Config, Item, ItemState, Queue, QueueItem, RunState } from "../core/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");
const ENV_DOCTRINE_DIR = "LLAMA_HARNESS_DOCTRINE_DIR";

// A line that exists ONLY inside conductor/doctrine/core.md, so "the pack arrived"
// cannot be satisfied by any paraphrase, prompt literal or agent fragment.
const CORE_PACK_ANCHOR = "# Core doctrine — always on";

// The live state block's own first line (adapter/inject.ts renderStateBlock).
const STATE_BLOCK_ANCHOR = "Conductor live state";

// ---------------------------------------------------------------------------
// The opencode hook surface, as @opencode-ai/plugin 1.18.10 declares it
// (node_modules/@opencode-ai/plugin/dist/index.d.ts:187-269). Mirrored locally so
// this file is a self-contained contract: the plugin's real hooks must be
// assignable to these, and the OUTPUT objects are exactly what opencode forwards
// to the provider.
// ---------------------------------------------------------------------------

interface SystemTransformInput {
  sessionID?: string;
  model: unknown;
}
interface SystemTransformOutput {
  system: string[];
}
interface ChatParamsInput {
  sessionID: string;
  agent: string;
  model: unknown;
  provider: unknown;
  message: unknown;
}
interface ChatParamsOutput {
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number | undefined;
  options: Record<string, unknown>;
}
interface ChatHeadersOutput {
  headers: Record<string, string>;
}
interface ChatMessageOutput {
  message: unknown;
  parts: Array<{ type: string; text?: string }>;
}

interface PluginHooks {
  tool?: Record<string, unknown>;
  "chat.message"?: (input: { sessionID: string }, output: ChatMessageOutput) => Promise<void> | void;
  "experimental.chat.system.transform"?: (
    input: SystemTransformInput,
    output: SystemTransformOutput,
  ) => Promise<void> | void;
  "chat.params"?: (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void> | void;
  "chat.headers"?: (input: ChatParamsInput, output: ChatHeadersOutput) => Promise<void> | void;
}

// One journal record as adapter/journal.ts writes it into <runDir>/journal.jsonl
// (FLAT: no `corr` object; itemId/sessionID are optional TOP-LEVEL keys).
interface Rec {
  level?: unknown;
  component?: unknown;
  event?: unknown;
  data?: Record<string, unknown>;
  sessionID?: unknown;
  runId?: unknown;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEMP_ROOTS: string[] = [];

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "conductor",
      GIT_AUTHOR_EMAIL: "conductor@example.invalid",
      GIT_COMMITTER_NAME: "conductor",
      GIT_COMMITTER_EMAIL: "conductor@example.invalid",
    },
  });
}

// A configured workspace: a real git repo carrying .conductor/config.json, which
// is what makes loadConfig report repoConfigured true (the §3.2 flag the live
// state block's legality verdict takes).
function makeWorkspace(tag: string, overrides: Partial<Config> = {}): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), tag)));
  TEMP_ROOTS.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  const config: Config = { ...DEFAULT_CONFIG, ...overrides };
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(path.join(root, "README.md"), "fixture\n");
  git(root, ["add", "-f", "README.md", ".conductor/config.json"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  return root;
}

// The same workspace WITHOUT git: §3.9's no-git shape, which is what makes the
// publish half of the live state block observable (a repo created mid-process must
// change what the block recommends).
function makeNonRepoWorkspace(tag: string): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), tag)));
  TEMP_ROOTS.push(root);
  const config: Config = { ...DEFAULT_CONFIG };
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(path.join(root, "README.md"), "fixture\n");
  return root;
}

// ---------------------------------------------------------------------------
// Run/queue fixtures — seeded on disk through the committed store, never through
// another task's handler (the tools-9.4c discipline composition-root.test.ts uses).
// ---------------------------------------------------------------------------

function openFixtureStore(root: string, overrides: Partial<Config> = {}): StateStore {
  return openWorkspace({
    root,
    config: { ...DEFAULT_CONFIG, ...overrides },
    journal: { log: () => undefined },
    version: "0.0.0-test-inject-wiring",
    sessionID: "ses_fixture_inject",
  });
}

function fixtureQueueItem(id: string): QueueItem {
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
      necessary: "the request asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

function fixtureItem(id: string, state: ItemState): Item {
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

// A live run at `runState` whose queue carries one item per entry of `states`.
function seedRun(store: StateStore, sessionID: string, runState: RunState, states: Record<string, ItemState>): string {
  const created = store.createRun({
    prompt: "keep the sign of negative offsets",
    sessionID,
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  const run = store.loadRun(created.runId);
  run.state = runState;
  store.saveRun(run);
  const queue: Queue = { items: Object.keys(states).map((id) => fixtureQueueItem(id)) };
  writeFileSync(
    path.join(store.root, ".conductor", "runs", created.runId, "queue.json"),
    JSON.stringify(queue, null, 2),
  );
  for (const [id, state] of Object.entries(states)) store.saveItem(created.runId, fixtureItem(id, state));
  return created.runId;
}

// The state block the transform hook actually delivers for one session.
async function deliveredStateBlock(hooks: PluginHooks, sessionID: string): Promise<string> {
  const transform = hookOf(hooks, "experimental.chat.system.transform");
  const output: SystemTransformOutput = { system: [] };
  await transform({ sessionID, model: {} }, output);
  const last = output.system[output.system.length - 1] ?? "";
  assert.ok(
    last.includes(STATE_BLOCK_ANCHOR),
    "premise: the last append entry is the live state block; got: " + last.slice(0, 200),
  );
  return last;
}

// A copy of the shipped doctrine directory with exactly one required pack
// withheld — the §6.4 fail-closed input.
function doctrineMissing(withheld: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "conductor-inject-doctrine-")));
  TEMP_ROOTS.push(dir);
  for (const name of readdirSync(DOCTRINE_DIR)) {
    if (name === withheld) continue;
    copyFileSync(path.join(DOCTRINE_DIR, name), path.join(dir, name));
  }
  assert.ok(
    !existsSync(path.join(dir, withheld)),
    `premise: the fixture doctrine dir must be missing ${withheld}`,
  );
  return dir;
}

function pluginInput(directory: string, client: unknown): unknown {
  return {
    client: client ?? {},
    project: { id: "prj_inject_wiring", worktree: directory },
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

function hookOf<K extends keyof PluginHooks>(hooks: PluginHooks, key: K): NonNullable<PluginHooks[K]> {
  const hook = hooks[key];
  assert.equal(
    typeof hook,
    "function",
    `the plugin must REGISTER the "${String(key)}" hook: §6.4's injection layer reaches a session ` +
      "only through the hooks the factory returns, and a composition function nothing calls " +
      "delivers nothing (ISSUE-001). Registered keys: " +
      Object.keys(hooks).join(", "),
  );
  return hook as NonNullable<PluginHooks[K]>;
}

// ---------------------------------------------------------------------------
// Driving a bound tool, so a REAL sub-session gets registered
// ---------------------------------------------------------------------------

interface RegisteredTool {
  execute: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
}

// The opencode ToolContext the runtime hands `execute`
// (node_modules/@opencode-ai/plugin/dist/tool.d.ts).
function toolCtx(sessionID: string, directory: string): unknown {
  return {
    sessionID,
    messageID: "msg_inject_wiring",
    agent: "conductor",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

function callTool(
  hooks: PluginHooks,
  name: string,
  args: Record<string, unknown>,
  root: string,
  sessionID: string,
): Promise<unknown> {
  const map = (hooks.tool ?? {}) as Record<string, RegisteredTool>;
  const definition = map[name];
  assert.ok(definition !== undefined, `premise: ${name} is registered in the plugin's tool map`);
  return definition.execute(args, toolCtx(sessionID, root));
}

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

interface Tracked {
  promise: Promise<void>;
  settled: () => boolean;
  describe: () => string;
}

// Kick a tool off WITHOUT awaiting it, so the hooks can be driven while its
// sub-session is still live — which is the only window in which a sub-session is
// registered at all (adapter/fanout.ts deletes the entry when the job finishes).
// The outcome is kept (and the rejection attached immediately, so a refusal can
// never surface as an unhandled rejection) because "no sub-session was created" and
// "the tool refused before dispatching" look identical from the fake SDK's side.
function kick(run: () => Promise<unknown>): Tracked {
  let outcome: string | null = null;
  const promise = run().then(
    (value) => {
      outcome = "resolved with " + JSON.stringify(value);
    },
    (error) => {
      outcome = "REJECTED with: " + (error instanceof Error ? error.message : String(error));
    },
  );
  return {
    promise,
    settled: () => outcome !== null,
    describe: () => outcome ?? "still in flight",
  };
}

type FakeSdk = ReturnType<typeof makeFakeSdk>;

// Release every parked sub-session prompt until the driver settles, so no watchdog
// timer outlives the test and keeps node --test alive.
async function drain(sdk: FakeSdk, tracked: Tracked, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!tracked.settled() && Date.now() < deadline) {
    if (sdk.pending.length > 0) {
      sdk.resolveAllPending({ kind: "error", error: { message: "fixture: ending the sub-session" } });
    }
    await tick();
  }
  await Promise.race([tracked.promise, tick(500)]);
}

// Drive the arrival of a user prompt exactly as opencode does, which is what
// creates the §3.2 run and writes the orchestrator's §3.5 registry entry.
async function arrive(hooks: PluginHooks, sessionID: string, prompt: string): Promise<void> {
  const chatMessage = hookOf(hooks, "chat.message");
  await chatMessage({ sessionID }, { message: {}, parts: [{ type: "text", text: prompt }] });
}

function runJournal(root: string): Rec[] {
  const runsDir = path.join(root, ".conductor", "runs");
  if (!existsSync(runsDir)) return [];
  const out: Rec[] = [];
  for (const runId of readdirSync(runsDir)) {
    const file = path.join(runsDir, runId, "journal.jsonl");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line) as Rec);
      } catch {
        continue;
      }
    }
  }
  return out;
}

function withDoctrineDir<T>(dir: string | null, body: () => T): T {
  const prior = process.env[ENV_DOCTRINE_DIR];
  if (dir === null) delete process.env[ENV_DOCTRINE_DIR];
  else process.env[ENV_DOCTRINE_DIR] = dir;
  try {
    return body();
  } finally {
    if (prior === undefined) delete process.env[ENV_DOCTRINE_DIR];
    else process.env[ENV_DOCTRINE_DIR] = prior;
  }
}

process.on("exit", () => {
  for (const dir of TEMP_ROOTS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup; a leftover temp dir must never fail a gate
    }
  }
});

// ===========================================================================
// (1) REGISTRATION — the three §6.4 hooks exist on the returned hook object
// ===========================================================================

test("[inject-wiring-registered] the plugin registers the three §6.4 hooks opencode dispatches", async () => {
  const root = makeWorkspace("conductor-inject-registered-");
  const hooks = await startPlugin(root);

  for (const key of ["experimental.chat.system.transform", "chat.params", "chat.headers"] as const) {
    assert.equal(
      typeof hooks[key],
      "function",
      `§6.4 names three injection hooks and adapter/wire-notes.md records that all three fire at ` +
        `opencode 1.18.15; "${key}" is not registered, so nothing it would deliver reaches any ` +
        "session. Registered: " + Object.keys(hooks).join(", "),
    );
  }
});

// ===========================================================================
// (2) SYSTEM TRANSFORM — the role's doctrine pack, verbatim, plus the live block
// ===========================================================================

test("[inject-wiring-system-transform] the transform hook appends the role's pack VERBATIM and the live state block last", async () => {
  const root = makeWorkspace("conductor-inject-system-");
  const hooks = await startPlugin(root);
  const sessionID = "ses_inject_system";
  await arrive(hooks, sessionID, "please do the work");

  const transform = hookOf(hooks, "experimental.chat.system.transform");
  const preexisting = "opencode's own system prompt";
  const output: SystemTransformOutput = { system: [preexisting] };
  await transform({ sessionID, model: {} }, output);

  assert.equal(
    output.system[0],
    preexisting,
    "the transform APPENDS (§6.4) — it must never drop what opencode already put in the system array",
  );
  assert.ok(
    output.system.length > 1,
    "the transform delivered NOTHING: output.system is unchanged, which is exactly what a session " +
      "receives when the composition layer is never invoked",
  );

  const packText = readFileSync(path.join(DOCTRINE_DIR, "core.md"), "utf8");
  const delivered = output.system.slice(1);
  assert.ok(
    delivered.includes(packText),
    "the orchestrator's §4.1 pack core.md must arrive VERBATIM as its own system entry — a " +
      "paraphrase is a second unguarded spelling of doctrine (ISSUE-003). Got entries: " +
      JSON.stringify(delivered.map((entry) => entry.slice(0, 60))),
  );
  assert.ok(
    delivered.some((entry) => entry.includes(CORE_PACK_ANCHOR)),
    "the delivered pack must carry core.md's own anchor line",
  );

  const last = delivered[delivered.length - 1] ?? "";
  assert.ok(
    last.includes(STATE_BLOCK_ANCHOR),
    "the LIVE STATE BLOCK is the last append entry (§6.4), re-stated every request; got: " + last.slice(0, 200),
  );
  assert.ok(
    last.includes("Recommended next tool: conductor_classify"),
    "the block must name the ONE recommended next tool from the gate's own legality verdict — a " +
      "freshly created run has not been classified (adapter/chat-message.ts writes a PLACEHOLDER " +
      "classification, and run.classified is the receipt that says the classifier has spoken), so " +
      "the recommendation is conductor_classify. Got:\n" + last,
  );
  assert.ok(
    last.split("\n").length <= 30,
    "the live state block is bounded at 30 lines (§6.4); got " + String(last.split("\n").length),
  );

  // Re-stated, never remembered (G9): a second request gets the block again.
  const second: SystemTransformOutput = { system: [] };
  await transform({ sessionID, model: {} }, second);
  assert.ok(
    second.system.some((entry) => entry.includes(STATE_BLOCK_ANCHOR)),
    "§6.4/G9: the state block is re-stated on EVERY request, never delivered once and remembered",
  );
});

// ===========================================================================
// (3) PARAMS — the §4.1 per-role sampling actually reaches the request
// ===========================================================================

test("[inject-wiring-params] the chat.params hook applies the §4.1 per-role temperature", async () => {
  const root = makeWorkspace("conductor-inject-params-");
  const hooks = await startPlugin(root);
  const sessionID = "ses_inject_params";
  await arrive(hooks, sessionID, "please do the work");

  const params = hookOf(hooks, "chat.params");
  const output: ChatParamsOutput = {
    temperature: 0.99,
    topP: 1,
    topK: 0,
    maxOutputTokens: undefined,
    options: {},
  };
  await params(
    { sessionID, agent: "conductor", model: {}, provider: {}, message: {} },
    output,
  );

  assert.equal(
    output.temperature,
    0.4,
    "§4.1 gives the orchestrator temperature 0.4; an untouched 0.99 is the signature of a params " +
      "hook that was composed and never registered (ISSUE-001c)",
  );
});

// ===========================================================================
// (4) HEADERS — the §4.4 router tags actually reach the request
// ===========================================================================

test("[inject-wiring-headers] the chat.headers hook sets the §4.4 X-Conductor-* router tags", async () => {
  const root = makeWorkspace("conductor-inject-headers-");
  const hooks = await startPlugin(root);
  const sessionID = "ses_inject_headers";
  await arrive(hooks, sessionID, "please do the work");

  const headers = hookOf(hooks, "chat.headers");
  const output: ChatHeadersOutput = { headers: {} };
  await headers(
    { sessionID, agent: "conductor", model: {}, provider: {}, message: {} },
    output,
  );

  assert.equal(
    output.headers["X-Conductor-Role"],
    "orchestrator",
    "§4.4: the router's priority, affinity and schema observation all key off these tags, and with " +
      "the hook unregistered the router's conformance dataset is structurally empty (ISSUE-001d). " +
      "Got: " + JSON.stringify(output.headers),
  );
  assert.equal(
    output.headers["X-Conductor-Priority"],
    "interactive",
    "§4.4: the orchestrator's queue class is interactive",
  );
  assert.equal(
    output.headers["X-Conductor-Group"],
    root,
    "§4.4 prefix affinity: the orchestrator's group is the tree adapter/continuation.ts " +
      "resolveSessionTree recorded onto its own registry entry — the workspace root",
  );
});

// ===========================================================================
// (5) RUNTIME RECEIPT — a live delivery leaves a journal trail (GAP-001 layer b)
// ===========================================================================

test("[inject-wiring-receipt] every delivery journals inject/system-append naming the session, role, packs and digest", async () => {
  const root = makeWorkspace("conductor-inject-receipt-");
  const hooks = await startPlugin(root);
  const sessionID = "ses_inject_receipt";
  await arrive(hooks, sessionID, "please do the work");

  const transform = hookOf(hooks, "experimental.chat.system.transform");
  await transform({ sessionID, model: {} }, { system: [] });

  const receipts = runJournal(root).filter(
    (rec) => rec.component === "inject" && rec.event === "system-append",
  );
  assert.ok(
    receipts.length >= 1,
    "C-028 says 'loaded is not delivered'; this record is the mechanical form of the difference. " +
      "Without it a live run that delivered nothing is indistinguishable from one that delivered " +
      "everything. Journal components seen: " +
      JSON.stringify([...new Set(runJournal(root).map((rec) => String(rec.component)))]),
  );

  const receipt = receipts[receipts.length - 1] as Rec;
  assert.equal(receipt.sessionID, sessionID, "the receipt names the session the doctrine was delivered TO");
  const data = receipt.data ?? {};
  assert.equal(data["role"], "orchestrator", "the receipt names the §4.1 role whose pack was selected");
  assert.deepEqual(
    data["packs"],
    ["core.md"],
    "the receipt names the packs actually delivered, so a role that silently lost its pack is visible",
  );
  assert.equal(
    typeof data["packDigest"],
    "string",
    "the receipt carries a digest of the delivered pack text, so a doctrine directory swapped under " +
      "a live run is visible in the trail",
  );
  assert.ok(
    String(data["packDigest"]).length >= 8,
    "the pack digest must be a real digest, not an empty string: " + JSON.stringify(data["packDigest"]),
  );
  assert.equal(
    data["stateBlock"],
    true,
    "the receipt records that the live state block went with the packs — the half a doctrine-only " +
      "delivery would silently drop",
  );
});

test("[inject-wiring-receipt-recommendation] the receipt records the single next tool the state block NAMED, so a run's recommendation can be scored against the tool the model actually called — the state block renders it into a sentence and journals nothing, which leaves the recommended-vs-actual column dead on every run this repository can produce", async () => {
  const root = makeWorkspace("conductor-inject-recommend-");
  const hooks = await startPlugin(root);
  const sessionID = "ses_inject_recommend";
  await arrive(hooks, sessionID, "please do the work");

  const transform = hookOf(hooks, "experimental.chat.system.transform");
  const output: { system: string[] } = { system: [] };
  await transform({ sessionID, model: {} }, output);

  const receipt = runJournal(root)
    .filter((rec) => rec.component === "inject" && rec.event === "system-append")
    .pop() as Rec;
  const data = receipt.data ?? {};
  assert.equal(
    data["recommended"],
    "conductor_classify",
    "an unclassified INTAKE run recommends conductor_classify, and the receipt must carry the NAME " +
      "rather than leave an observer to parse English out of a system prompt it never saw",
  );
  assert.equal(
    data["recommendedItem"],
    null,
    "a run-level recommendation targets no item, and null is that fact — not an absent key",
  );

  const block = output.system[output.system.length - 1];
  assert.match(
    block,
    /Recommended next tool: conductor_classify/,
    "and the recorded name is the one the model was actually told, from the same derivation — a " +
      "receipt that disagreed with the block would be worse than none",
  );
});

// ===========================================================================
// (5a) THE SUB-SESSION LEG — the delivery a REGISTERED sub-session receives
//
// Rows 2-4 measure the orchestrator, and the orchestrator is the ONE role whose
// delivery an unregistered session also gets: §6.4's fallback hands an unknown
// role core.md, and paramsForRole's default temperature is the orchestrator's 0.4.
// So a wiring that read no registry entry at all would satisfy every row above.
// This row takes a sub-session the fan-out actually registered — a testWriter, on
// its own item, while its prompt is in flight — and pins that all three hooks read
// THAT entry: its role's pack (tdd.md, not core.md), its own §4.1 temperature, its
// own §4.4 tags.
// ===========================================================================

test("[inject-wiring-subsession-role] a REGISTERED sub-session receives ITS role's doctrine, temperature and router tags — not the orchestrator's", async () => {
  // A §2.1 verify scope the item is covered by (conductor_submit_test refuses an
  // item no requiredScopes entry covers, before it dispatches anything), and a
  // watchdog short enough that a leaked timer cannot outlive the suite.
  const waveConfig: Partial<Config> = {
    verify: {
      scopes: {
        unit: {
          command: [process.execPath, "-e", "process.exit(0)"],
          timeoutMs: 60_000,
          itemTest: [process.execPath, "-e", "process.exit(0)"],
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    parallel: { ...DEFAULT_CONFIG.parallel, subSessionTimeoutMs: 8_000 },
  };
  const root = makeWorkspace("conductor-inject-subsession-", waveConfig);
  const orchestrator = "ses_inject_orchestrator";
  const store = openFixtureStore(root, waveConfig);
  // A PENDING behavioral item is the wave's first stage: §3.3 sends it to the
  // test-writer, and a testWriter's §4.1 row differs from the orchestrator's in
  // all three columns (tdd.md, 0.5, review) — so each assertion below can fail on
  // its own.
  seedRun(store, orchestrator, "PLAN_REVIEWED", { I1: "PENDING" });

  const sdkRegistry = new Map<string, { role?: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry: sdkRegistry, idPrefix: "ses_writer_" });
  const hooks = await startPlugin(root, sdk.client);

  const tracked = kick(() => callTool(hooks, "conductor_dispatch_wave", {}, root, orchestrator));
  try {
    await waitFor(() => sdk.creates.length > 0 || tracked.settled(), 8_000);
    assert.ok(
      sdk.creates.length > 0,
      "premise: the wave dispatches a real sub-session through the plugin's own fan-out (wave: " +
        tracked.describe() + ")",
    );
    const sub = sdk.creates[0];
    // §3.5 registers the entry BEFORE the first prompt and journals it; the prompt
    // in flight is therefore the window in which opencode dispatches this
    // sub-session's injection hooks, and the record is what names the role that
    // window belongs to.
    await waitFor(() => sdk.promptsFor(sub).length > 0, 8_000);
    assert.ok(sdk.promptsFor(sub).length > 0, "premise: the sub-session's prompt is in flight");
    const dispatched = runJournal(root).find(
      (rec) => rec.component === "fanout" && rec.event === "subsession.dispatched" && rec.sessionID === sub,
    );
    assert.ok(dispatched !== undefined, "premise: the fan-out journaled its §3.5 registration");
    assert.equal(
      (dispatched?.data ?? {})["role"],
      "testWriter",
      "premise: a PENDING behavioral item's first wave stage is the §3.3 test-writer",
    );
    assert.equal(
      (dispatched?.data ?? {})["itemId"],
      "I1",
      "premise: and the entry binds it to the item it was dispatched for",
    );

    // (a) system transform — the ROLE's pack, not the orchestrator's.
    const transform = hookOf(hooks, "experimental.chat.system.transform");
    const output: SystemTransformOutput = { system: [] };
    await transform({ sessionID: sub, model: {} }, output);
    const tdd = readFileSync(path.join(DOCTRINE_DIR, "tdd.md"), "utf8");
    assert.ok(
      output.system.includes(tdd),
      "§4.1 gives the testWriter tdd.md, and it must arrive VERBATIM as its own entry. Got: " +
        JSON.stringify(output.system.map((entry) => entry.slice(0, 60))),
    );
    assert.ok(
      !output.system.some((entry) => entry.includes(CORE_PACK_ANCHOR)),
      "and it must NOT receive the orchestrator's core.md: a hook that ignored the registry entry " +
        "would deliver §6.4's unknown-role fallback to every session alike, which is indistinguishable " +
        "from the orchestrator's own delivery",
    );
    const block = output.system[output.system.length - 1] ?? "";
    assert.ok(block.includes(STATE_BLOCK_ANCHOR), "the live state block is still the last entry");
    assert.ok(
      block.includes("Active item: I1"),
      "and a sub-session's block reports ITS OWN item (§6.4), which it can only know from the " +
        "registry entry; got:\n" + block,
    );

    // (b) params — the role's own §4.1 temperature.
    const params = hookOf(hooks, "chat.params");
    const paramsOut: ChatParamsOutput = {
      temperature: 0.99,
      topP: 1,
      topK: 0,
      maxOutputTokens: undefined,
      options: {},
    };
    await params({ sessionID: sub, agent: "conductor", model: {}, provider: {}, message: {} }, paramsOut);
    assert.equal(
      paramsOut.temperature,
      0.5,
      "§4.1 gives the testWriter temperature 0.5; 0.4 would be the orchestrator's row (the value a " +
        "hook that never read the entry falls back to) and 0.99 an untouched output",
    );

    // (c) headers — the role's own §4.4 tags.
    const headers = hookOf(hooks, "chat.headers");
    const headersOut: ChatHeadersOutput = { headers: {} };
    await headers({ sessionID: sub, agent: "conductor", model: {}, provider: {}, message: {} }, headersOut);
    assert.equal(
      headersOut.headers["X-Conductor-Role"],
      "testWriter",
      "§4.4: the router tags the request with the role it is actually serving; got: " +
        JSON.stringify(headersOut.headers),
    );
    assert.equal(
      headersOut.headers["X-Conductor-Priority"],
      "review",
      "§4.4: a testWriter's queue class is review, not the orchestrator's interactive",
    );
    assert.equal(
      headersOut.headers["X-Conductor-Group"],
      root,
      "§4.4 prefix affinity: the group is the tree the fan-out registered for this sub-session",
    );
    assert.equal(
      headersOut.headers["X-Conductor-Schema"],
      "required",
      "§4.4 observe-not-enforce: every fan-out dispatch asks for a schema-shaped receipt, and the " +
        "router's conformance dataset is exactly the requests that said so. Untagged, the router " +
        "reports schemaConformed 0 / schemaMissing 0 / rate null no matter how the run went. Got: " +
        JSON.stringify(headersOut.headers),
    );

    // (d) the receipt names the sub-session's own packs.
    const receipts = runJournal(root).filter(
      (rec) => rec.component === "inject" && rec.event === "system-append" && rec.sessionID === sub,
    );
    assert.ok(receipts.length >= 1, "the sub-session's delivery leaves its own §7.4 receipt");
    assert.deepEqual(
      (receipts[receipts.length - 1].data ?? {})["packs"],
      ["tdd.md"],
      "and the receipt names the packs THAT role received, so a sub-session served the wrong doctrine " +
        "is visible in the trail rather than only in the model's behaviour",
    );
  } finally {
    await drain(sdk, tracked, 10_000);
  }
});

// ===========================================================================
// (5b) PUBLISH AVAILABILITY — one derivation, re-read per request
// ===========================================================================

test("[inject-wiring-publish-freshness] a repo created mid-process changes the very next state block: §3.9 availability is re-derived, never remembered", async () => {
  const root = makeNonRepoWorkspace("conductor-inject-publish-");
  const sessionID = "ses_inject_publish";
  const store = openFixtureStore(root);
  // One item at REVIEWED: the ONE FSM position where §3.9 decides the next tool.
  // With publish unavailable REVIEWED is terminal and the run closes via the
  // report; with a repo present the same item owes a publish.
  seedRun(store, sessionID, "EXECUTING", { I1: "REVIEWED" });

  const hooks = await startPlugin(root);

  const before = await deliveredStateBlock(hooks, sessionID);
  assert.ok(
    before.includes("Recommended next tool: conductor_report"),
    "premise: with no repo, §3.9 makes REVIEWED terminal and the run closes via conductor_report; " +
      "got:\n" + before,
  );

  // The repo appears mid-process — exactly what conductor_setup's initRepo answer
  // does (adapter/tools.ts calls this same gitio function from the handler).
  assert.equal(initRepo(root), true, "premise: the fixture workspace was not a repo until now");

  const after = await deliveredStateBlock(hooks, sessionID);
  assert.ok(
    after.includes("Recommended next tool: conductor_publish on I1"),
    "the state block must re-derive §3.9 publish availability per request, exactly as the stage gate " +
      "does (adapter/tools.ts calls isRepo(store.root) fresh on every stage call). A process-lifetime " +
      "memo makes the block report publishEnabled:false forever after a setup that initialized the " +
      "repo, so the block recommends closing a run the gate is still asking to publish — two answers " +
      "to one question, from one process. Got:\n" + after,
  );
});

// ===========================================================================
// (5c) THE STATUS SURFACE — what doctrine each session was actually handed
//
// The receipt row above proves the trail EXISTS; this one proves it is legible
// without a journal grep. GAP-001's second layer is that an operator (and the
// orchestrator itself, which reads conductor_status) can see which doctrine each
// live session is running under — the question "is this session governed by the
// pack I think it is?" has no answer from the outside otherwise.
// ===========================================================================

function parseToolResult(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") return JSON.parse(raw) as Record<string, unknown>;
  assert.ok(raw !== null && typeof raw === "object", "a bound tool must return a result");
  const obj = raw as Record<string, unknown>;
  if (typeof obj["output"] === "string") return JSON.parse(obj["output"] as string) as Record<string, unknown>;
  return obj;
}

interface StatusDeliveryRow {
  sessionID?: unknown;
  role?: unknown;
  packs?: unknown;
  packDigest?: unknown;
}

test("[inject-wiring-status-deliveries] conductor_status reports the doctrine each session was last DELIVERED", async () => {
  const root = makeWorkspace("conductor-inject-status-");
  const sessionID = "ses_inject_status";
  const store = openFixtureStore(root);
  seedRun(store, sessionID, "EXECUTING", { I1: "PENDING" });

  const hooks = await startPlugin(root);

  const before = parseToolResult(await callTool(hooks, "conductor_status", {}, root, sessionID));
  assert.deepEqual(
    before["deliveries"],
    [],
    "before any request is composed, no session has been delivered doctrine — status must say so " +
      "rather than omit the field, so 'nothing delivered' and 'this build cannot tell' are different " +
      "answers. Got: " + JSON.stringify(before["deliveries"]),
  );

  await deliveredStateBlock(hooks, sessionID);

  const after = parseToolResult(await callTool(hooks, "conductor_status", {}, root, sessionID));
  const deliveries = after["deliveries"] as StatusDeliveryRow[] | undefined;
  assert.ok(Array.isArray(deliveries), "conductor_status must carry a deliveries array");
  const row = (deliveries ?? []).find((entry) => entry.sessionID === sessionID);
  assert.ok(
    row !== undefined,
    "the session that received doctrine must appear on the status surface; got: " +
      JSON.stringify(deliveries),
  );
  assert.equal(row?.role, "orchestrator", "the row names the §4.1 role the packs were chosen for");
  assert.deepEqual(row?.packs, ["core.md"], "and the packs that session actually received");

  // The digest is the SAME value the §7.4 receipt carries — one derivation read
  // twice, never a second hash computed for the status surface.
  const receipts = runJournal(root).filter(
    (rec) => rec.component === "inject" && rec.event === "system-append" && rec.sessionID === sessionID,
  );
  assert.ok(receipts.length >= 1, "premise: the delivery left its receipt");
  assert.equal(
    row?.packDigest,
    (receipts[receipts.length - 1].data ?? {})["packDigest"],
    "and the digest matches the delivery record's, so status reports what was delivered rather than " +
      "what would be delivered if it were composed again now",
  );

  // Re-stated every request (G9): the row tracks the LAST delivery, not the first.
  await deliveredStateBlock(hooks, sessionID);
  const later = parseToolResult(await callTool(hooks, "conductor_status", {}, root, sessionID));
  const rows = (later["deliveries"] as StatusDeliveryRow[]).filter(
    (entry) => entry.sessionID === sessionID,
  );
  assert.equal(
    rows.length,
    1,
    "one row per session — the surface reports the session's LAST delivery, never a growing log of " +
      "every request it ever made; got: " + JSON.stringify(later["deliveries"]),
  );
});

// ===========================================================================
// (6) INIT ORDERING — packs before the beacon (ISSUE-004 / GAP-001 layer c)
// ===========================================================================

test("[inject-wiring-beacon-ordering] a missing doctrine pack writes NO §3.8 beacon and starts NO run", async () => {
  const root = makeWorkspace("conductor-inject-beacon-");
  const broken = doctrineMissing("review.md");

  const hooks = await withDoctrineDir(broken, () => startPlugin(root));
  const stderrLines: string[] = [];
  const originalError = console.error;
  try {
    console.error = (...args: unknown[]): void => {
      stderrLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    const chatMessage = hookOf(hooks, "chat.message");
    await withDoctrineDir(broken, async () => {
      await chatMessage({ sessionID: "ses_inject_beacon" }, { message: {}, parts: [{ type: "text", text: "go" }] });
    });
  } finally {
    console.error = originalError;
  }

  const alivePath = path.join(root, ".conductor", "state", "alive.json");
  assert.equal(
    existsSync(alivePath),
    false,
    "§3.8's contract is that the beacon's ABSENCE proves init failed — so the §6.4 packs must load " +
      "BEFORE adapter/state.ts writes alive.json. With the beacon written first, an operator who " +
      "deleted the doctrine directory sees a live workspace, a created run and gated edits: work has " +
      "begun and the pack failure surfaces only at the first stage tool (ISSUE-004)",
  );
  assert.equal(
    existsSync(path.join(root, ".conductor", "runs")),
    false,
    "and NO run may be created for a workspace whose doctrine cannot be delivered: a run whose " +
      "sessions receive no doctrine is the silent-degradation shape §3.8 exists to forbid",
  );
  assert.ok(
    stderrLines.some((line) => line.includes("review.md")),
    "the failure is LOUD on the §7.1 stderr sink and NAMES the absent pack; got:\n" + stderrLines.join("\n"),
  );

  // And the same workspace, with the shipped doctrine, DOES write the beacon —
  // so row 6 is a statement about doctrine, not about a fixture that never works.
  const healthy = await withDoctrineDir(null, () => startPlugin(root));
  const chatMessage = hookOf(healthy, "chat.message");
  await chatMessage({ sessionID: "ses_inject_beacon_ok" }, { message: {}, parts: [{ type: "text", text: "go" }] });
  assert.equal(
    existsSync(alivePath),
    true,
    "control: with the shipped packs present the beacon IS written — the row above measures the " +
      "doctrine failure, not a broken fixture",
  );
});
