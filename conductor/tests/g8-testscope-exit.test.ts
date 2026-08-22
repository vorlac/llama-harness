// conductor/tests/g8-testscope-exit.test.ts — the G8 refusal must name an exit the
// denied path actually has.
//
// THE OBSERVED FAILURE (run r-20260821-0a31, journal seq 48). The orchestrator held
// an inline claim on I1, taken 92 seconds earlier, and tried to edit
// `tests/check_visible.py` — I1's testScope. G8 refused it with "use
// conductor_inline_claim if dispatch is genuinely more expensive than doing": advice
// the session had already taken, and advice that cannot work. §3.6 scopes a claim to
// the item's fileScope and §2.4 holds fileScope disjoint from testScope, so no claim
// reaches a testScope path. The refusal handed the session back the loop it was in.
//
// The exit that exists for that path is conductor_submit_test, which dispatches the
// test-writer that owns the file. These rows pin that the refusal says so — and pin
// it at BOTH production seams, not only in core, because the gate can only name a
// testScope it was handed: core/gates-edit.ts is pure, so `testScope` reaches
// decideEdit as an input the composition root derives. A row that exercised only the
// core function would pass over a production wiring that hands the orchestrator an
// empty testScope forever, which is exactly the state that produced seq 48.
//
// Seams driven here:
//   plugin/index.ts tool.execute.before  — the seam that emitted seq 48 (gate "edit").
//   adapter/continuation.ts handlePermissionAsked — the §3.5(b) orchestrator ask gate.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";

import { decideEdit } from "../core/gates-edit.ts";
import { treePath } from "../core/types.ts";
import type { Config, Item, Queue, QueueItem, TreePath } from "../core/types.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateJournal, StateStore } from "../adapter/state.ts";
import { createContinuationState, handlePermissionAsked } from "../adapter/continuation.ts";
import type { ContinuationClient, PermissionAskedEvent } from "../adapter/continuation.ts";
import { ConductorPlugin } from "../plugin/index.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// (1) The core decision. decideEdit is pure, so these rows need no fixture at all.
// ---------------------------------------------------------------------------

const TREE = treePath("/repo");
const inTree = (rel: string): string => `${TREE}/${rel}`;

interface OrchestratorEdit {
  sessionRole: string;
  registered: boolean;
  fileScope: string[];
  testScope: string[];
  path: string;
  verifyInFlightTree: TreePath | null;
  sessionTree: TreePath;
  inlineClaimScope: string[] | null;
}

const orchestratorEdit = (over: Partial<OrchestratorEdit> = {}): OrchestratorEdit => ({
  sessionRole: "orchestrator",
  registered: true,
  fileScope: [],
  testScope: ["tests/check_visible.py"],
  path: inTree("tests/check_visible.py"),
  verifyInFlightTree: null,
  sessionTree: TREE,
  inlineClaimScope: null,
  ...over,
});

function denyReason(decision: { action: string; reason?: string }, ctx: string): string {
  assert.equal(decision.action, "deny", `${ctx}: expected a DENY`);
  const reason = decision.reason;
  assert.ok(reason, `${ctx}: a DENY carries a non-empty reason`);
  return reason;
}

test("[g8-testscope-names-submit-test] an orchestrator edit inside an item's testScope is refused with the exit that path HAS: the refusal names the testScope it landed in, says an inline claim can never cover it (§2.4 keeps the scopes disjoint), and names conductor_submit_test", () => {
  const reason = denyReason(decideEdit(orchestratorEdit()), "orchestrator editing a testScope path");

  assert.match(reason, /testScope/, "the refusal names the scope the path is in");
  assert.match(reason, /tests\/check_visible\.py/, "and quotes the covering glob, so the reader can check the claim");
  assert.match(reason, /conductor_submit_test/, "and names the tool that dispatches the test-writer owning the file");
  assert.match(reason, /disjoint/i, "and says WHY no claim reaches it — §2.4 holds fileScope and testScope disjoint");

  // The load-bearing negative: the advice that sent the run back into its loop.
  assert.doesNotMatch(
    reason,
    /use conductor_inline_claim/,
    "and it does NOT advise taking an inline claim, which §2.4 makes incapable of covering a testScope path",
  );
});

test("[g8-testscope-holds-under-an-active-claim] the same refusal is given while a claim IS active but scopes elsewhere — the shape of run r-20260821-0a31, where the advice was advice already taken", () => {
  const reason = denyReason(
    decideEdit(orchestratorEdit({ inlineClaimScope: ["src/solvers/p001.py", "src/solvers/__init__.py"] })),
    "orchestrator holding a claim on the item's fileScope, editing its testScope",
  );
  assert.match(reason, /conductor_submit_test/, "the exit named is the one that works from here");
  assert.doesNotMatch(reason, /use conductor_inline_claim/, "not the one the session already spent a decision on");
});

test("[g8-unclaimed-source-keeps-the-claim-advice] a path that is simply unclaimed — outside every testScope — keeps the inline-claim advice, which is the exit THAT path has", () => {
  const reason = denyReason(
    decideEdit(orchestratorEdit({ path: inTree("src/solvers/p001.py") })),
    "orchestrator editing unclaimed source",
  );
  assert.match(reason, /conductor_inline_claim/, "an unclaimed source path is exactly what the claim exists for");
  assert.doesNotMatch(reason, /conductor_submit_test/, "and no test-writer owns a path no testScope covers");
});

test("[g8-claim-still-unlocks-its-own-scope] the refusal shaping leaves the ALLOW arm untouched: a claim that scopes the path still admits the edit", () => {
  const decision = decideEdit(
    orchestratorEdit({ path: inTree("src/solvers/p001.py"), inlineClaimScope: ["src/solvers/**"] }),
  );
  assert.equal(decision.action, "allow", "a claim scoping the path admits it");
});

// ---------------------------------------------------------------------------
// (2) Fixture: a throwaway git repo carrying a run whose one item declares the two
// §2.4 scopes, with an active inline claim. Hermetic — no llama-harness git, no
// network, no model.
// ---------------------------------------------------------------------------

const ORCH = "ses_orchestrator";
const START_MS = 1_787_348_000_000;
const FILE_SCOPE = ["src/solvers/p001.py"];
const TEST_SCOPE = ["tests/check_visible.py"];

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

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function testConfig(): Config {
  return {
    version: 1,
    verify: { scopes: {}, behavioralPaths: ["src/**"], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 4,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    toolSurface: { classifyBuiltins: true, denyNetwork: true },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function silentJournal(): StateJournal {
  return {
    log(): void {
      /* the assertions below read state and gate decisions, never this sink */
    },
  };
}

function queueItem(): QueueItem {
  return {
    id: "I1",
    title: "Add p001 solver",
    rationale: "one new module plus one import",
    fileScope: [...FILE_SCOPE],
    testScope: [...TEST_SCOPE],
    acceptance: ["solve() returns 233168"],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the prompt asks for the solver",
      reuse: "the shape of the worked solver beside it",
      ladderRung: "minimal-code",
    },
  };
}

function runtimeItem(): Item {
  return {
    id: "I1",
    state: "TEST_VETTED",
    assignee: null,
    worktree: null,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: {},
    taint: [],
    inlineClaim: { reason: "inline is cheaper than a dispatch here", decisionId: "D-0001" },
  };
}

// A repo seeded to the EXACT state seq 48 was emitted from: EXECUTING, one item,
// an active claim over its fileScope, and the two §2.4 scopes on disk in queue.json.
function seedClaimedRun(): { root: TreePath; runId: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-g8-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src", "solvers"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "solvers", "__init__.py"), "\n");
  writeFileSync(path.join(dir, "tests", "check_visible.py"), "def test_nothing():\n    pass\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "seed"]);

  const root = treePath(dir);
  const config = testConfig();
  const opts: OpenOptions = {
    root,
    config,
    journal: silentJournal(),
    version: "0.0.0-test",
    sessionID: ORCH,
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  const store: StateStore = openWorkspace(opts);
  const run = store.createRun({
    prompt: "add the p001 solver",
    sessionID: ORCH,
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  const runId = run.runId;
  run.state = "EXECUTING";
  store.saveRun(run);
  const queue: Queue = { items: [queueItem()] };
  writeFileSync(
    path.join(store.root, ".conductor", "runs", runId, "queue.json"),
    JSON.stringify(queue, null, 2),
  );
  store.saveItem(runId, runtimeItem());
  mkdirSync(path.join(dir, ".conductor"), { recursive: true });
  writeFileSync(path.join(dir, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  store.release();
  return { root, runId };
}

interface PluginHooks {
  [hook: string]: ((...args: never[]) => Promise<void>) | undefined;
}

// ---------------------------------------------------------------------------
// (3) The seam that emitted seq 48: plugin/index.ts tool.execute.before. The scopes
// the gate judges by are derived BY THE PLUGIN from the seeded run — this test hands
// it neither, which is the whole point of driving the production hook.
// ---------------------------------------------------------------------------

test("[g8-testscope-plugin-seam] driven through plugin/index.ts's OWN tool.execute.before hook and its OWN registration path: the orchestrator's edit of the item's testScope is refused with the conductor_submit_test exit, while the edit its claim DOES scope is admitted — the testScope reaches the gate from the plugin's derivation, not from this test", async () => {
  const { root } = seedClaimedRun();
  const sdk = makeFakeSdk({ registry: new Map() });

  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  const hooks = await factory({
    client: sdk.client,
    project: { id: "prj_g8", worktree: root },
    directory: root,
    worktree: root,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  });

  // The ONLY registration production performs for an orchestrator session
  // (adapter/chat-message.ts): {role:"orchestrator"}, no itemId, no tree.
  const chat = hooks["chat.message"] as unknown as (a: unknown, b: unknown) => Promise<void>;
  assert.ok(chat !== undefined, "the plugin installs a chat.message hook");
  await chat({ sessionID: ORCH }, { parts: [{ type: "text", text: "carry on" }] });

  const before = hooks["tool.execute.before"] as unknown as (a: unknown, b: unknown) => Promise<void>;
  assert.ok(before !== undefined, "and the tool.execute.before gate hook");

  // §0.2's realpath rule: the plugin canonicalizes its root, so the edit path must be
  // canonical or the comparison would be about symlinks rather than scopes.
  const canonical = realpathSync(root);
  const drive = async (filePath: string): Promise<Error | null> => {
    try {
      await before({ sessionID: ORCH, tool: "edit" }, { args: { filePath } });
      return null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  };

  // PREMISE: the claim really is active at this seam, so the refusal below is about
  // the testScope and not about a fixture whose claim never loaded.
  assert.equal(
    await drive(path.join(canonical, "src", "solvers", "p001.py")),
    null,
    "premise: the plugin's own claim derivation admits the edit the claim scopes",
  );

  const denied = await drive(path.join(canonical, "tests", "check_visible.py"));
  assert.ok(denied instanceof Error, "the same hook refuses the edit of the item's testScope");
  assert.match(
    denied.message,
    /conductor_submit_test/,
    "and the refusal names the exit that path has — the plugin handed the gate the item's testScope",
  );
  assert.doesNotMatch(
    denied.message,
    /use conductor_inline_claim/,
    "and not the claim the session is already holding",
  );
});

// ---------------------------------------------------------------------------
// (4) The other orchestrator edit seam: the §3.5(b) permission ask.
// ---------------------------------------------------------------------------

test("[g8-testscope-ask-seam] the orchestrator's permission ask over a testScope path is rejected with the SAME exit named — the ask gate derives the run's testScopes rather than judging every orchestrator ask against an empty one", async () => {
  const { root } = seedClaimedRun();
  const sdk = makeFakeSdk({ registry: new Map() });
  const replies: Array<{ permissionID: string; response: string }> = [];
  const client = {
    session: sdk.client.session,
    async postSessionIdPermissionsPermissionId(opts: {
      path: { id: string; permissionID: string };
      body: { response: string };
    }): Promise<{ data?: unknown }> {
      replies.push({ permissionID: opts.path.permissionID, response: opts.body.response });
      return { data: {} };
    },
  } as unknown as ContinuationClient;

  const denials: Array<Record<string, unknown>> = [];
  const journal = {
    log(level: string, component: string, event: string, data: Record<string, unknown>): void {
      if (component === "gates" && event === "deny") denials.push(data);
    },
  };

  const store = openWorkspace({
    root,
    config: testConfig(),
    journal: silentJournal(),
    version: "0.0.0-test",
    sessionID: ORCH,
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  });
  const registry = new Map<string, { role: string; itemId?: string; tree?: TreePath }>([
    [ORCH, { role: "orchestrator", tree: root }],
  ]);

  const ask = (id: string, rel: string): PermissionAskedEvent => ({
    id,
    sessionID: ORCH,
    permission: "edit",
    metadata: { filePath: path.join(root, rel) },
  });

  const state = createContinuationState();
  const allowed = await handlePermissionAsked({
    store,
    state,
    registry,
    client,
    event: ask("per_g8_premise", path.join("src", "solvers", "p001.py")),
    journal,
  });
  assert.equal(allowed.replied, "once", "premise: the ask the active claim scopes is granted at this seam");

  const rejected = await handlePermissionAsked({
    store,
    state,
    registry,
    client,
    event: ask("per_g8_testscope", path.join("tests", "check_visible.py")),
    journal,
  });
  store.release();

  assert.equal(rejected.replied, "reject", "the ask over the item's testScope is rejected");
  const last = denials[denials.length - 1];
  assert.ok(last !== undefined, "and the rejection is journaled under gates/deny with its reason");
  assert.match(
    String(last.reason),
    /conductor_submit_test/,
    "the journaled reason names the exit that path has",
  );
  assert.doesNotMatch(
    String(last.reason),
    /use conductor_inline_claim/,
    "and not the claim that cannot reach a testScope path",
  );
});
