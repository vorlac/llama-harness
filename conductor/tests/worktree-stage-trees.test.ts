// conductor/tests/worktree-stage-trees.test.ts — the Phase 9 milestone-gate finding
// C-055: under `config.parallel.writes:"worktrees"` the stage handlers DISPATCHED into
// the item's worktree (sessionTreeOf, already correct) but EXECUTED against the main
// workspace. Every handler-owned execution — the item test, the full verify, the review
// prompts' git diff and file reads, and the §4.2 foreign-red existence probe — was
// hardcoded to `store.root`.
//
// Why that is a false-evidence bug and not a cosmetic one. An implementer edits the
// item's worktree; conductor_mark_green then runs the item's test in a tree that never
// received the edit, and conductor_validate verifies a tree the change never reached.
// So a GREEN can be produced by a tree nobody edited (the main tree happened to pass),
// and a RED can be produced by changes that are not the item's (a sibling's WIP in the
// main tree). Both are evidence about the wrong subject, which is exactly the failure
// this build fears: a check that passes while inspecting less — or other — than it
// claims to.
//
// THE TWO TYPES, KEPT APART (the gate's C-037 ruling 5). A "tree" is two different
// things in this codebase and conflating them is how a worktree freeze silently never
// fires:
//   * the verify MARKER's tree is a SLUG — "main" or "<itemId>" — because
//     evidence.ts markerPathOf runs assertSafeId over it to compose
//     `verify-running-<tree>.json` (a path-shaped tree would let a poisoned key write
//     outside runDir, and assertSafeId is deliberately NOT relaxed);
//   * the EXECUTION tree is a filesystem PATH — a cwd, the root a file read resolves
//     against.
// Every row below asserts BOTH halves where both exist, and [worktree-validate-*]
// asserts the marker filename directly, so passing a path where a slug belongs (or the
// reverse) cannot pass.
//
// HOW EACH ROW ISOLATES ONE MECHANISM. Every fixture makes the two candidate trees
// DIVERGE, so no assertion below can be satisfied by both:
//   * the item test file is a DIFFERENT file in each tree, each writing its OWN witness
//     path, and the witness lives OUT of both trees — so "which tree ran" is observed
//     directly rather than inferred from an exit code;
//   * the worktree carries an EXTRA COMMIT, so its HEAD sha differs from the main
//     tree's, and the §2.6 record's `head` (read by `git rev-parse` in the run's cwd)
//     names the tree the verify actually ran in;
//   * the reviewed file carries a different working-tree marker in each tree, and the
//     assertion demands the diff's `+` line, which only a real `git diff` in that tree
//     produces;
//   * the sibling's test file exists in the WORKTREE ONLY, so a foreign-red set computed
//     against the main tree cannot contain it.
// Each row also asserts its own PREMISE (the divergence really exists, the sub-sessions
// really were dispatched, the scope command really ran) so it cannot pass by becoming
// unverifiable, and every "the wrong tree's marker is absent" claim is paired with a
// positive "the right tree's marker is present" claim so an empty scan is RED.
//
// The non-worktree behaviour is pinned here too: with item.worktree null, sessionTreeOf
// returns the shared tree — the workspace itself — the execution root is store.root and
// the marker slug is "main" — the last row asserts exactly that, so a fix that simply
// moved everything into a worktree would fail.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { handleItemReview, handleMarkGreen, handleValidate } from "../adapter/tools.ts";
import type { ItemReviewResult, MarkGreenResult, ValidateResult } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { loadPacks } from "../adapter/inject.ts";
import { validate } from "../core/types.ts";
import { treePath } from "../core/types.ts";
import type { Config, EvidenceRecord, Item, ItemState, Queue, QueueItem, TreePath } from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// Markers. Every one is distinctive enough that a substring match is unambiguous,
// and the MAIN/WT pairs are what make the two trees tell themselves apart.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "WT-TITLE-MARKER-5501";
const ACCEPT_MARKER = "WT-ACCEPT-MARKER-5502";
const SCOPE = "wtscope5503";
const START_MS = 1_754_900_000_000;

const MAIN_FILE_MARKER = "MAIN-TREE-FILE-MARKER-5511";
const WT_FILE_MARKER = "WORKTREE-FILE-MARKER-5512";
const MAIN_TEST_MARKER = "MAIN-TREE-TEST-MARKER-5513";
const WT_TEST_MARKER = "WORKTREE-TEST-MARKER-5514";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKS: Record<string, string> = loadPacks(path.resolve(HERE, "..", "doctrine"));

// ---------------------------------------------------------------------------
// Hermetic git + temp bookkeeping (the tests/tools-9.4b.test.ts idiom). Never the
// llama-harness repo: every fixture is a throwaway under os.tmpdir().
// ---------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function headOf(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

// The MAIN workspace: a real committed repo, so a §2.6 record carries a real HEAD.
function committedRepo(seed: Array<{ rel: string; content: string }> = []): TreePath {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "conductor-wt-main-")));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  for (const file of seed) {
    const abs = path.join(dir, file.rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, file.content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

// A REAL `git worktree` on its own branch — what the §4.2 wave driver creates and
// persists onto the item as `item.worktree`. `extraCommit` gives the worktree a HEAD
// of its own, which is how a §2.6 record proves which tree it was produced in.
function addWorktree(repo: string, itemId: string, extraCommit = false): TreePath {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "conductor-wt-tree-")));
  tmpDirs.push(parent);
  const wt = path.join(parent, itemId);
  git(repo, ["worktree", "add", "-b", `conductor/${itemId}`, wt]);
  // git checks out TRACKED files only, so an empty src/ or tests/ in the workspace has
  // no counterpart here. The wave driver's worktrees are ordinary working trees; make
  // these two directories exist so a fixture write is not an ENOENT.
  mkdirSync(path.join(wt, "src"), { recursive: true });
  mkdirSync(path.join(wt, "tests"), { recursive: true });
  if (extraCommit) {
    writeFileSync(path.join(wt, "worktree-only.txt"), `${itemId}\n`);
    git(wt, ["add", "worktree-only.txt"]);
    git(wt, ["commit", "-m", "worktree commit"]);
  }
  return treePath(realpathSync(wt));
}

// The OUT-OF-REPO §4.2 state home — also where every witness file lives, so no witness
// is ever inside a tree under test (a quarantine or a diff must never see one).
function freshStateHome(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "conductor-wt-state-")));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Fixture test files. Each one writes its OWN witness path before doing anything
// else, so "this file ran" is observed rather than inferred.
// ---------------------------------------------------------------------------

// Writes its witness, then asserts its subject module's export — red until the
// subject exists IN THE SAME TREE, green once an implementer writes it there.
function subjectTest(witnessAbs: string, moduleRel: string, marker: string): string {
  return (
    'import { writeFileSync } from "node:fs";\n' +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    `writeFileSync(${JSON.stringify(witnessAbs)}, ${JSON.stringify(marker)});\n` +
    `const mod = await import(${JSON.stringify(moduleRel)});\n` +
    `test(${JSON.stringify(marker)}, () => {\n` +
    "  assert.equal(mod.ok, true);\n" +
    "});\n"
  );
}

// A test that only records that it ran — used for the sibling whose file the §4.2
// foreign-red quarantine must move OUT of the tree being verified.
function witnessOnlyTest(witnessAbs: string, marker: string): string {
  return (
    'import { writeFileSync } from "node:fs";\n' +
    'import test from "node:test";\n' +
    `writeFileSync(${JSON.stringify(witnessAbs)}, ${JSON.stringify(marker)});\n` +
    `test(${JSON.stringify(marker)}, () => {});\n`
  );
}

const SUBJECT_MODULE = "export const ok = true;\n";

// ---------------------------------------------------------------------------
// The verify scope COMMAND: a probe that records, per run, the cwd it was given, which
// repo-relative paths were PRESENT at that instant (the §4.2 quarantine proof) and which
// `verify-running-*.json` markers were live (the slug proof). Exits 0 — the outcome of
// the scope is not what these rows are about; WHERE it ran is.
// ---------------------------------------------------------------------------

interface ProbeSnapshot {
  cwd: string;
  present: string[];
  markers: string[];
}

function probeCmd(witness: string, runsDir: string, rels: string[]): string[] {
  const script =
    "const fs=require('fs'),path=require('path');\n" +
    `const runsDir=${JSON.stringify(runsDir)};\n` +
    "const markers=[];\n" +
    "if (fs.existsSync(runsDir)) {\n" +
    "  for (const d of fs.readdirSync(runsDir)) {\n" +
    "    const dir=path.join(runsDir,d);\n" +
    "    if (!fs.statSync(dir).isDirectory()) continue;\n" +
    "    for (const f of fs.readdirSync(dir)) {\n" +
    "      if (/^verify-running-.+\\.json$/.test(f)) markers.push(f);\n" +
    "    }\n" +
    "  }\n" +
    "}\n" +
    "markers.sort();\n" +
    `const rels=${JSON.stringify(rels)};\n` +
    "const present=rels.filter((r) => fs.existsSync(path.join(process.cwd(), r)));\n" +
    `const witness=${JSON.stringify(witness)};\n` +
    "const prior=fs.existsSync(witness) ? JSON.parse(fs.readFileSync(witness,'utf8')) : [];\n" +
    "prior.push({ cwd: fs.realpathSync(process.cwd()), present: present, markers: markers });\n" +
    "fs.writeFileSync(witness, JSON.stringify(prior));\n";
  return [process.execPath, "-e", script];
}

function readProbe(witness: string): ProbeSnapshot[] {
  if (!existsSync(witness)) return [];
  return JSON.parse(readFileSync(witness, "utf8")) as ProbeSnapshot[];
}

// ---------------------------------------------------------------------------
// Journal sink (capture only; the closed-vocabulary journal is pinned elsewhere).
// ---------------------------------------------------------------------------

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
  return {
    records,
    sink: {
      log(level, component, event, data, corr): void {
        records.push({ level, component, event, data, corr });
      },
      flushSync(): void {
        /* nothing buffered */
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Config / store / queue fixtures
// ---------------------------------------------------------------------------

interface FixtureScope {
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
}

function makeConfig(opts: { command: string[]; itemTest?: string[]; itemReviewers?: number }): Config {
  const scope: FixtureScope = {
    command: [...opts.command],
    timeoutMs: 120_000,
    ...(opts.itemTest !== undefined ? { itemTest: [...opts.itemTest] } : {}),
  };
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: scope } as Config["verify"]["scopes"],
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 1,
      itemReviewers: opts.itemReviewers ?? 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 1,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    // The §4.2 mode the wave driver runs under when it creates the worktrees.
    parallel: { writes: "worktrees", maxImplementers: 4, maxReaders: 6, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function runsDirOf(root: string): string {
  return path.join(root, ".conductor", "runs");
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

function createRunFor(store: StateStore): string {
  return store.createRun({
    prompt: "keep the sign of negative offsets",
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  }).runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

function makeRuntimeItem(id: string, state: ItemState, worktree: TreePath | null): Item {
  return {
    id,
    state,
    assignee: null,
    worktree,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: {},
    taint: [],
    inlineClaim: null,
  };
}

function makeQueueItem(id: string, over: { fileScope: string[]; testScope: string[] }): QueueItem {
  return {
    id,
    title: `keep the sign of negative offsets (${TITLE_MARKER})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

// Drive the run to EXECUTING by direct on-disk seeding (the 9.4b discipline), then
// persist each item's §4.2 worktree exactly as the wave driver would.
function seedExecuting(
  store: StateStore,
  runId: string,
  queue: Queue,
  states: Record<string, ItemState>,
  worktrees: Record<string, TreePath>,
): void {
  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const qi of queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, states[qi.id] ?? "PENDING", worktrees[qi.id] ?? null));
  }
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

// ---------------------------------------------------------------------------
// Fan-out wiring over the FAKE SDK. The responder sees the WHOLE request — including
// the registry entry's tree — so an implementer can write into the tree it was actually
// dispatched to, which is what a real write-capable sub-session does.
// ---------------------------------------------------------------------------

interface PromptedRecord {
  role: string;
  itemId: string;
  tree: string;
  text: string;
  sessionID: string;
}

interface Wiring {
  fanout: Fanout;
  prompted: PromptedRecord[];
  byRole: (role: string) => PromptedRecord[];
}

function makeRecordingTree(): TreeState {
  return {
    isFrozen(): boolean {
      return false;
    },
    onClear(): () => void {
      return () => undefined;
    },
  };
}

function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  respond: (req: PromptedRecord) => string,
): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  sdk.setResponder((req) => {
    const record: PromptedRecord = {
      role: req.entry?.role ?? "",
      itemId: req.entry?.itemId ?? "",
      tree: req.entry?.tree ?? "",
      text: req.text,
      sessionID: req.sessionID,
    };
    prompted.push(record);
    return { kind: "reply", text: respond(record) };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    makeRecordingTree(),
    runId,
  );
  return { fanout, prompted, byRole: (role) => prompted.filter((p) => p.role === role) };
}

const IMPL_RECEIPT = JSON.stringify({
  status: "DONE",
  summary: "wrote the minimal subject module",
  concerns: [],
  neededContext: null,
  blockReason: null,
});
const NO_FINDINGS = JSON.stringify({ findings: [] });

// ---------------------------------------------------------------------------
// Fixture sanity (the probe-block discipline): the canned payloads must satisfy the
// schemas the fan-out engine validates them against, or every row below would be
// asserting on a retry storm rather than on a tree.
// ---------------------------------------------------------------------------

assert.equal(
  validate("ImplementerResult", JSON.parse(IMPL_RECEIPT) as unknown).ok,
  true,
  "sanity: the implementer receipt satisfies SCHEMAS.ImplementerResult",
);
assert.equal(
  validate("Findings", JSON.parse(NO_FINDINGS) as unknown).ok,
  true,
  "sanity: the empty findings reply satisfies SCHEMAS.Findings",
);
assert.ok(
  (PACKS["tdd.md"] ?? "").length > 200,
  "sanity: the REAL doctrine packs loaded through the committed loader",
);

// ===========================================================================
// [worktree-mark-green-runs-the-items-tree]
// ===========================================================================

test("[worktree-mark-green-runs-the-items-tree] conductor_mark_green runs the ITEM TEST in the tree the item is being worked in: the implementer writes the subject into the item's worktree, and the handler's run executes the WORKTREE's test file (its witness is written) and not the main workspace's (whose witness stays absent) — running the main tree would have failed on a subject that was never written there", async () => {
  const root = committedRepo();
  const wt = addWorktree(root, "I1");
  const stateHome = freshStateHome();
  const mainWitness = path.join(stateHome, "main-test-ran.txt");
  const wtWitness = path.join(stateHome, "worktree-test-ran.txt");

  const config = makeConfig({
    // The full-scope command must never be what decided this row: the targeted §2.1
    // itemTest template is asserted below, and this command only records that it ran.
    command: probeCmd(path.join(stateHome, "scope.json"), runsDirOf(root), []),
    itemTest: [process.execPath, "--test", "{files}"],
  });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "TEST_VETTED" }, { I1: wt });

  // The SAME testScope path holds a DIFFERENT file in each tree, each writing its own
  // witness. Neither tree has the subject module yet, so whichever file runs is red
  // until an implementer writes src/a.mjs INTO THAT TREE.
  writeFileSync(path.join(root, "tests", "a.test.mjs"), subjectTest(mainWitness, "../src/a.mjs", MAIN_TEST_MARKER));
  writeFileSync(path.join(wt, "tests", "a.test.mjs"), subjectTest(wtWitness, "../src/a.mjs", WT_TEST_MARKER));
  assert.notEqual(
    readFileSync(path.join(root, "tests", "a.test.mjs"), "utf8"),
    readFileSync(path.join(wt, "tests", "a.test.mjs"), "utf8"),
    "premise: the two trees really hold DIFFERENT test files, so the witnesses can tell them apart",
  );
  assert.equal(existsSync(path.join(root, "src", "a.mjs")), false, "premise: the main tree has no subject module");
  assert.equal(existsSync(path.join(wt, "src", "a.mjs")), false, "premise: the worktree has no subject module either");

  // A write-capable sub-session writes into the tree IT WAS DISPATCHED TO — the real
  // behaviour, and what makes this row a statement about the handler's cwd alone.
  const wiring = makeWiring(runId, config, journal.sink, (req) => {
    if (req.role !== "implementer") return `UNSCRIPTED ROLE ${req.role}`;
    const target = path.join(req.tree, "src", "a.mjs");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, SUBJECT_MODULE);
    return IMPL_RECEIPT;
  });

  const res: MarkGreenResult = await handleMarkGreen({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey-wt",
    now: () => START_MS,
  });

  // Premises: the dispatch really happened, and it really landed in the worktree.
  const implementers = wiring.byRole("implementer");
  assert.equal(implementers.length, 1, "premise: exactly one implementer sub-session was dispatched");
  assert.equal(implementers[0].tree, wt, "premise: the implementer was dispatched INTO the item's worktree (sessionTreeOf)");
  assert.equal(existsSync(path.join(wt, "src", "a.mjs")), true, "premise: the implementer's edit landed in the worktree");
  assert.equal(
    existsSync(path.join(root, "src", "a.mjs")),
    false,
    "premise: the MAIN workspace never received the change — a green there could only be a green about the wrong tree",
  );

  // The finding itself: which tree's test file the handler executed.
  assert.equal(existsSync(wtWitness), true, "the handler ran the WORKTREE's item test — the tree the change lives in");
  assert.equal(
    existsSync(mainWitness),
    false,
    "the handler did NOT run the main workspace's item test — that file was never executed",
  );

  // And the evidence the item advances on is that run's, targeted through the §2.1
  // itemTest template (never the full-scope fallback).
  const evidence = readEvidence(runDir);
  assert.equal(evidence.length, 1, "exactly ONE §2.6 record was appended: the handler's own run");
  assert.equal(evidence[0].kind, "green", "the item test PASSED, because it ran where the implementation is");
  const green = evidence[0] as Extract<EvidenceRecord, { kind: "green" }>;
  assert.equal(green.exitCode, 0, "the green record carries the passing exit code");
  assert.deepEqual(
    green.command,
    [process.execPath, "--test", "tests/a.test.mjs"],
    "the run was TARGETED by the §2.1 itemTest template — the argv is the substituted template, not the full-scope command",
  );
  assert.equal(readProbe(path.join(stateHome, "scope.json")).length, 0, "the full-scope fallback command never ran");

  const item = store.loadItem(runId, "I1");
  assert.equal(validate("Item", item).ok, true, "the advanced item file still satisfies the §2.5 schema");
  assert.equal(item.state, "GREEN", "the item advanced TEST_VETTED->GREEN on evidence from its OWN tree");
  assert.equal(item.worktree, wt, "the item is still bound to its worktree");
  assert.equal(res.ok, true, "the compact return reports the advance");
  assert.equal(res.ranItemTest, true, "the handler ran the item test itself");
  assert.equal(res.exitCode, 0, "the compact return names the passing exit code");
});

// ===========================================================================
// [worktree-validate-runs-and-marks-the-items-tree]
// ===========================================================================

test("[worktree-validate-runs-and-marks-the-items-tree] conductor_validate verifies the item's WORKTREE and stamps the per-tree marker with the item's SLUG: the scope command's cwd IS the worktree, the §2.6 record's head is the WORKTREE's HEAD (which differs from the main tree's) and its tree is the slug \"I1\" — while the live marker file on disk is verify-running-I1.json and verify-running-main.json is never written", async () => {
  const root = committedRepo();
  // The worktree carries an extra commit, so the two trees have DIFFERENT HEAD shas —
  // which is how the record itself says where it was produced.
  const wt = addWorktree(root, "I1", true);
  const stateHome = freshStateHome();
  const probe = path.join(stateHome, "verify-probe.json");

  assert.notEqual(headOf(wt), headOf(root), "premise: the worktree's HEAD really differs from the main tree's");

  const config = makeConfig({ command: probeCmd(probe, runsDirOf(root), []) });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "GREEN" }, { I1: wt });

  const wiring = makeWiring(runId, config, journal.sink, (req) => `UNSCRIPTED ROLE ${req.role}`);

  const res: ValidateResult = await handleValidate({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey-wt",
    packs: PACKS,
    now: () => START_MS,
  });

  // Premise: the verify really executed a scope. A verify that ran nothing could not
  // say anything about a tree at all.
  const snapshots = readProbe(probe);
  assert.equal(snapshots.length, 1, "premise: the required scope ran exactly once");
  assert.equal(wiring.prompted.length, 0, "premise: a green verify dispatches nobody, so no sub-session muddies this row");

  // (a) the EXECUTION tree is a PATH: the scope command's own cwd.
  assert.equal(snapshots[0].cwd, wt, "the verify's scope command ran with cwd = the item's WORKTREE");
  assert.notEqual(snapshots[0].cwd, root, "and not in the main workspace");

  // (b) the MARKER's tree is a SLUG: the filename the freeze is keyed on.
  assert.deepEqual(
    snapshots[0].markers,
    ["verify-running-I1.json"],
    "the live per-tree marker is keyed on the item's SLUG — a path-shaped tree would be rejected by assertSafeId, and \"main\" would freeze the wrong tree",
  );

  // (c) the §2.6 record carries both halves honestly.
  const records = readEvidence(runDir).filter((r): r is Extract<EvidenceRecord, { kind: "verify" }> => r.kind === "verify");
  assert.equal(records.length, 1, "exactly ONE §2.6 verify record was appended");
  assert.equal(records[0].tree, "I1", "the record's tree is the item's slug");
  assert.equal(records[0].head, headOf(wt), "the record's head is the WORKTREE's HEAD — the tree it actually judged");
  assert.notEqual(records[0].head, headOf(root), "and NOT the main workspace's HEAD");
  assert.equal(records[0].green, true, "the verify is green");

  assert.equal(existsSync(path.join(runDir, "verify-running-main.json")), false, "no main-tree marker was left behind");
  assert.equal(existsSync(path.join(runDir, "verify-running-I1.json")), false, "the item's marker was removed on completion");

  const item = store.loadItem(runId, "I1");
  assert.equal(item.state, "VALIDATED", "the item advanced GREEN->VALIDATED on a verify of its OWN tree");
  assert.equal(res.ok, true, "the compact return reports the advance");
  assert.equal(res.verifySeq, records[0].seq, "the compact return names the record the advance rests on");
});

// ===========================================================================
// [worktree-foreign-red-set-follows-the-items-tree]
// ===========================================================================

test("[worktree-foreign-red-set-follows-the-items-tree] the §4.2 foreign red set is computed against the tree the verify RUNS IN: a sibling's test file that exists only in the item's worktree is quarantined out of it (it is absent from the tree while the scope runs) — computing the set against the main workspace, where that file does not exist, would leave a sibling's deliberate red loose inside the verified tree", async () => {
  const root = committedRepo();
  const wt = addWorktree(root, "I1");
  const stateHome = freshStateHome();
  const probe = path.join(stateHome, "verify-probe.json");
  const siblingWitness = path.join(stateHome, "sibling-ran.txt");

  const config = makeConfig({ command: probeCmd(probe, runsDirOf(root), ["tests/b.test.mjs"]) });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
    ],
  };
  // I2 is at PENDING — below GREEN — so its test is a §4.2 foreign red for I1's verify.
  seedExecuting(store, runId, queue, { I1: "GREEN", I2: "PENDING" }, { I1: wt });

  // The sibling's test file exists ONLY in the worktree. A foreign-red set computed
  // against the main workspace cannot contain it; one computed against the tree the
  // verify runs in must.
  writeFileSync(path.join(wt, "tests", "b.test.mjs"), witnessOnlyTest(siblingWitness, "SIBLING-5515"));
  assert.equal(existsSync(path.join(wt, "tests", "b.test.mjs")), true, "premise: the sibling's test exists in the worktree");
  assert.equal(
    existsSync(path.join(root, "tests", "b.test.mjs")),
    false,
    "premise: it does NOT exist in the main workspace — the two trees diverge on exactly this file",
  );

  const wiring = makeWiring(runId, config, journal.sink, (req) => `UNSCRIPTED ROLE ${req.role}`);

  const res: ValidateResult = await handleValidate({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey-wt",
    packs: PACKS,
    now: () => START_MS,
  });

  const snapshots = readProbe(probe);
  assert.equal(snapshots.length, 1, "premise: the required scope ran exactly once");
  assert.equal(snapshots[0].cwd, wt, "premise: the verify ran in the worktree");

  assert.ok(
    res.excluded.includes("tests/b.test.mjs"),
    "the sibling's test is IN the §4.2 foreign red set — it could only be found in the tree the verify runs in",
  );
  assert.deepEqual(
    snapshots[0].present,
    [],
    "and it was really moved OUT of that tree for the duration of the verify",
  );
  assert.equal(
    existsSync(path.join(wt, "tests", "b.test.mjs")),
    true,
    "the quarantine was restored into the worktree when the verify completed",
  );
  assert.equal(res.ok, true, "the verify is green and the item advanced");
});

// ===========================================================================
// [worktree-item-review-reads-the-items-tree]
// ===========================================================================

test("[worktree-item-review-reads-the-items-tree] conductor_item_review builds its §3.3 prompts from the item's WORKTREE: every lens reviewer receives the worktree's git diff (the added line carries the worktree's marker) and the worktree's test text, and NEITHER main-workspace marker appears in any prompt — a reviewer fed the main tree would judge a tree without the change it was convened for", async () => {
  const root = committedRepo([
    { rel: "src/a.mjs", content: "export const ok = true;\n" },
    { rel: "tests/a.test.mjs", content: "// committed placeholder\n" },
  ]);
  const wt = addWorktree(root, "I1");
  const stateHome = freshStateHome();

  const config = makeConfig({
    command: probeCmd(path.join(stateHome, "scope.json"), runsDirOf(root), []),
    itemReviewers: 3,
  });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "VALIDATED" }, { I1: wt });

  // Both trees have UNCOMMITTED changes to the same two tracked files, carrying
  // different markers — so the diff and the file read each name exactly one tree.
  writeFileSync(path.join(root, "src", "a.mjs"), `export const ok = true;\nexport const note = "${MAIN_FILE_MARKER}";\n`);
  writeFileSync(path.join(wt, "src", "a.mjs"), `export const ok = true;\nexport const note = "${WT_FILE_MARKER}";\n`);
  writeFileSync(path.join(root, "tests", "a.test.mjs"), `// ${MAIN_TEST_MARKER}\n`);
  writeFileSync(path.join(wt, "tests", "a.test.mjs"), `// ${WT_TEST_MARKER}\n`);

  // Premise: both trees really do produce a non-empty diff of their own.
  const mainDiff = git(root, ["diff", "--", "src/a.mjs"]);
  const wtDiff = git(wt, ["diff", "--", "src/a.mjs"]);
  assert.ok(mainDiff.includes(`+export const note = "${MAIN_FILE_MARKER}";`), "premise: the main workspace has its own diff");
  assert.ok(wtDiff.includes(`+export const note = "${WT_FILE_MARKER}";`), "premise: the worktree has its own, different diff");

  const wiring = makeWiring(runId, config, journal.sink, (req) => {
    if (req.role !== "reviewer") return `UNSCRIPTED ROLE ${req.role}`;
    return NO_FINDINGS;
  });

  const res: ItemReviewResult = await handleItemReview({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey-wt",
    packs: PACKS,
    sessionID: "ses_orchestrator",
    now: () => START_MS,
  });

  const reviewers = wiring.byRole("reviewer");
  assert.equal(reviewers.length, 3, "premise: the three-session lens composition really was dispatched");
  for (const prompt of reviewers) {
    assert.equal(prompt.tree, wt, "premise: every reviewer session is bound to the item's worktree");
    assert.ok(prompt.text.includes(TITLE_MARKER), "premise: the prompt is the §3.3 item-review prompt (it carries the item's spec)");

    // The DIFF half: only a real `git diff` run in the worktree produces this + line.
    assert.ok(
      prompt.text.includes(`+export const note = "${WT_FILE_MARKER}";`),
      "the lens prompt carries the WORKTREE's git diff",
    );
    assert.equal(
      prompt.text.includes(MAIN_FILE_MARKER),
      false,
      "and carries nothing from the main workspace's diff or fileScope read",
    );

    // The TEST half: the item's testScope read off disk.
    assert.ok(prompt.text.includes(WT_TEST_MARKER), "the lens prompt carries the WORKTREE's test text");
    assert.equal(prompt.text.includes(MAIN_TEST_MARKER), false, "and not the main workspace's test text");
  }

  assert.equal(res.ok, true, "a round with zero findings advances the item");
  assert.equal(store.loadItem(runId, "I1").state, "REVIEWED", "the PERSISTED item reached REVIEWED");
});

// ===========================================================================
// [no-worktree-execution-stays-in-the-shared-tree]
// ===========================================================================

test("[no-worktree-execution-stays-in-the-shared-tree] with item.worktree null NOTHING changes: conductor_validate runs in the workspace root, stamps the marker slug \"main\" and records the workspace HEAD — the worktree translation must not fire for an item that has no tree of its own, even though a worktree for a DIFFERENT item exists on disk", async () => {
  const root = committedRepo();
  // A worktree exists for a sibling — so a fix that keyed on "does the run have any
  // worktree" rather than "does THIS item have one" would be caught here.
  const otherWt = addWorktree(root, "I2", true);
  const stateHome = freshStateHome();
  const probe = path.join(stateHome, "verify-probe.json");

  assert.notEqual(headOf(otherWt), headOf(root), "premise: the sibling's worktree really is a distinguishable tree");

  const config = makeConfig({ command: probeCmd(probe, runsDirOf(root), []) });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
    ],
  };
  seedExecuting(store, runId, queue, { I1: "GREEN", I2: "GREEN" }, { I2: otherWt });
  assert.equal(store.loadItem(runId, "I1").worktree, null, "premise: I1 has no worktree of its own");

  const wiring = makeWiring(runId, config, journal.sink, (req) => `UNSCRIPTED ROLE ${req.role}`);

  const res: ValidateResult = await handleValidate({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey-wt",
    packs: PACKS,
    now: () => START_MS,
  });

  const snapshots = readProbe(probe);
  assert.equal(snapshots.length, 1, "premise: the required scope ran exactly once");
  assert.equal(snapshots[0].cwd, root, "the verify ran in the WORKSPACE ROOT, as it always has");
  assert.deepEqual(snapshots[0].markers, ["verify-running-main.json"], "the marker slug is \"main\"");

  const records = readEvidence(runDir).filter((r): r is Extract<EvidenceRecord, { kind: "verify" }> => r.kind === "verify");
  assert.equal(records.length, 1, "exactly ONE §2.6 verify record was appended");
  assert.equal(records[0].tree, "main", "the record's tree is the shared tree");
  assert.equal(records[0].head, headOf(root), "the record's head is the workspace's HEAD");
  assert.equal(res.ok, true, "the item advanced exactly as it does today");
  assert.equal(store.loadItem(runId, "I1").state, "VALIDATED", "the PERSISTED item reached VALIDATED");
});
