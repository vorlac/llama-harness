// conductor/tests/publish-commit-integrity.test.ts — the Phase 9 gate finding
// "handlePublish's commit does not commit what it staged", pinned as three
// independent behaviours of adapter/tools.ts handlePublish.
//
// The defect, in three parts (all confirmed against HEAD before this file existed):
//
//   (1) publish-commits-whole-index. Step 2 stages with `git add -- <scope>` but
//       step 6 commits with a PATHSPEC-LESS `git commit -m`. A pathspec-less
//       commit commits THE WHOLE INDEX, so anything else already staged — a
//       human's `git add`, or the residue an EARLIER publish left behind when it
//       denied BETWEEN its add and its commit — is swept into this item's commit
//       and attributed to it. The denial paths that sit between the add and the
//       commit (the denylisted-trailer refusal, the failed auto re-verify) make
//       that residue routine rather than exotic.
//
//   (2) publish-empty-pathspec-whole-tree-diff. The batch artifact's diff is
//       `git diff HEAD -- <staged>`. `git diff HEAD --` with NO pathspec is not
//       an empty diff — it is the WHOLE-WORKTREE diff. So an item that staged
//       nothing (every scope path excluded as pre-existing dirt, §3.3 step 2)
//       gets a batch line claiming it changed the entire tree, and the report
//       prints that verbatim.
//
//   (3) publish-deletions-never-staged. The staged set is filtered by existsSync,
//       so a path the item DELETED inside its own declared scope is dropped from
//       the pathspec, never handed to `git add`, and the deletion never ships.
//       existsSync answers "is there a file here", which is not the question:
//       git already knows the path is tracked and gone.
//
// Each test asserts its own PREMISE before it asserts the behaviour, because
// every one of these fixtures can decay into a shape where the check would pass
// while inspecting nothing:
//   * (1) asserts the residue really IS in the index before the second publish —
//     if the earlier publish stopped staging, the "not swept in" assertion would
//     hold vacuously;
//   * (2) asserts, through git itself, that the empty-pathspec form really does
//     produce a whole-worktree diff naming an out-of-scope file at that instant,
//     so "diff is empty" is distinguished from "diff would have been empty
//     anyway". Those are different outcomes and only one of them is the fix;
//   * (3) asserts the deleted path was tracked at HEAD and is gone from disk, so
//     "the commit records the deletion" cannot be satisfied by a file that was
//     never there.
//
// Runtime discipline (the tools-9.5b harness): real on-disk `git init` fixtures,
// argv-array git, node:test + node:assert/strict, erasable TS, no skips.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";

import { handlePublish } from "../adapter/tools.ts";
import type { PublishResult } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { currentBranch, headSha, isRepo, stagedFiles } from "../adapter/gitio.ts";
import type {
  ClassificationKind,
  Config,
  EvidenceRecord,
  Item,
  ItemState,
  Queue,
  QueueItem,
} from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// Fixture constants. The markers are unique to this file, so an assertion that a
// value does (or does not) carry one is unambiguous.
// ---------------------------------------------------------------------------

const SCOPE = "unitPCI";
const GREEN_CMD = [process.execPath, "-e", "0"];
const START_MS = 1_754_990_000_000;
const WORKSPACE_KEY = "wkeyPCI";
const TREE = "main";
const RED_MARKER = "CAPTURED-RED-MARKER-PCI";
const TITLE_MARKER = "ITEM-TITLE-MARKER-PCI";
const OUTSIDE_MARKER = "OUT-OF-SCOPE-WORKTREE-MARKER-PCI";
const DENYLISTED_MESSAGE = "publish I1\n\nCo-Authored-By: Somebody Else <nobody@example.invalid>\n";

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

interface PublishBatchLine {
  itemId: string;
  tsMs: number;
  mode: string;
  files: string[];
  skipped: string[];
  diff: string;
  suggestedMessage: string;
}

type RedEvidence = Extract<EvidenceRecord, { kind: "red" }>;
type VerifyEvidence = Extract<EvidenceRecord, { kind: "verify" }>;

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

function tmpDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-pci-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

// A committed fixture repo. The identity is written into the repo's own config as
// well as GIT_ENV, because the handler's own git calls run under adapter/gitio's
// environment rather than this file's.
function committedRepo(): string {
  const dir = tmpDir("repo");
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

// The name-status lines of ONE commit ("M\tsrc/a.mjs"), i.e. what actually shipped.
function commitNameStatus(dir: string, ref = "HEAD"): string[] {
  return git(dir, ["diff-tree", "--no-commit-id", "--name-status", "-r", ref])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function commitPaths(dir: string, ref = "HEAD"): string[] {
  return commitNameStatus(dir, ref)
    .map((line) => line.split("\t")[1] ?? "")
    .sort();
}

// Every path present in the tree a commit points at.
function treePaths(dir: string, ref = "HEAD"): string[] {
  return git(dir, ["ls-tree", "-r", ref, "--name-only"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

function commitCount(dir: string): number {
  return Number.parseInt(git(dir, ["rev-list", "--count", "HEAD"]).trim(), 10);
}

function makeJournal(): { sink: JournalSink; records: unknown[] } {
  const records: unknown[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

function makeConfig(over: { gitMode?: Config["git"]["mode"] } = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: { command: [...GREEN_CMD], timeoutMs: 120_000 } },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: {
      mode: over.gitMode ?? "commit",
      branchPolicy: "pin",
      preexistingDirty: "exclude",
    },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
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

function makeQueueItem(id: string, over: { fileScope: string[]; testScope: string[] }): QueueItem {
  return {
    id,
    title: `keep the sign of negative offsets (${TITLE_MARKER}-${id})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
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

const OPEN_TREE: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

interface Bench {
  root: string;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  journal: { sink: JournalSink; records: unknown[] };
  fanout: Fanout;
  queue: Queue;
}

interface BenchOpts {
  queue: Queue;
  states: Record<string, ItemState>;
  config?: Config;
  classification?: ClassificationKind;
  // Files created and COMMITTED before the run exists (clean at run start).
  seed?: (root: string) => void;
  // Worktree dirt established BEFORE the run exists, so it lands in run.startDirty.
  dirty?: (root: string) => void;
}

function makeBench(opts: BenchOpts): Bench {
  const config = opts.config ?? makeConfig();
  const root = committedRepo();
  if (opts.seed !== undefined) {
    opts.seed(root);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "fixture seed"]);
  }
  if (opts.dirty !== undefined) opts.dirty(root);

  const stateHome = tmpDir("state");
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const run = store.createRun({
    prompt: "make the beta parser keep the sign of negative offsets",
    sessionID: "ses_orchestrator",
    classification: {
      kind: opts.classification ?? "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  const runId = run.runId;
  const runDir = path.join(store.root, ".conductor", "runs", runId);

  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(opts.queue, null, 2));
  for (const qi of opts.queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, opts.states[qi.id] ?? "PENDING"));
  }

  const registry = new Map<string, { role: string; itemId: string; tree: string }>();
  const sdk = makeFakeSdk({ registry });
  sdk.setResponder(() => ({ kind: "reply", text: "{}" }));
  const fanout = createFanout(
    sdk.client,
    config,
    journal.sink as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );

  return { root, stateHome, store, runId, runDir, config, journal, fanout, queue: opts.queue };
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function nextSeqOf(runDir: string): number {
  return readEvidence(runDir).reduce((max, r) => Math.max(max, r.seq), 0) + 1;
}

function appendEvidenceLine(runDir: string, record: EvidenceRecord): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
}

function seedRed(bench: Bench, itemId: string, testRel: string): void {
  const record: RedEvidence = {
    seq: nextSeqOf(bench.runDir),
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", testRel],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER} (${itemId})\n\n7 !== -7`,
    failureClass: "assertion",
    targeted: true,
  };
  appendEvidenceLine(bench.runDir, record);
  const item = bench.store.loadItem(bench.runId, itemId);
  item.evidence.red = { ledger: "evidence.jsonl", seq: record.seq };
  bench.store.saveItem(bench.runId, item);
}

// The §2.6 verify the item was VALIDATED on. `startedMs` in the FUTURE is fresh
// for every mtime term, so no auto re-verify runs and these tests exercise the
// staging/commit legs alone.
function seedValidated(bench: Bench, itemId: string): VerifyEvidence {
  const record: VerifyEvidence = {
    seq: nextSeqOf(bench.runDir),
    ts: START_MS,
    kind: "verify",
    itemId,
    startedMs: Date.now() + 600_000,
    head: isRepo(bench.root) ? (headSha(bench.root) ?? "") : "",
    branch: isRepo(bench.root) ? (currentBranch(bench.root) ?? "") : "",
    tree: TREE,
    excluded: [],
    green: true,
    scopes: { [SCOPE]: { green: true, exitCode: 0, durationMs: 5 } },
  };
  appendEvidenceLine(bench.runDir, record);
  const item = bench.store.loadItem(bench.runId, itemId);
  item.evidence.validated = { ledger: "evidence.jsonl", seq: record.seq };
  bench.store.saveItem(bench.runId, item);
  return record;
}

function readBatch(runDir: string): PublishBatchLine[] {
  const file = path.join(runDir, "publish-batch.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PublishBatchLine);
}

function subjectSource(marker: string): string {
  return `// ${marker}\nexport function parse(text) {\n  return Number(text);\n}\n`;
}

function passingTest(marker: string, subjectRel: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    `import { parse } from "${subjectRel}";\n` +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7, "sign");\n' +
    "});\n"
  );
}

function publish(
  bench: Bench,
  itemId: string,
  over: { messageBuilder?: (item: QueueItem, redProof: unknown) => string } = {},
): Promise<PublishResult> {
  return handlePublish({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
    ...(over.messageBuilder === undefined
      ? {}
      : { messageBuilder: over.messageBuilder as Parameters<typeof handlePublish>[0]["messageBuilder"] }),
  });
}

// ===========================================================================
// (1) The commit must carry the item's OWN pathspec, not whatever the index holds
// ===========================================================================

test("[publish-commits-only-its-own-pathspec] a publish that denied BETWEEN its `git add` and its commit leaves its files staged; the NEXT item's commit must contain only the next item's scope — not that residue, and not the human's own staged file", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", { fileScope: ["src/a.mjs"], testScope: ["tests/a.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/b.mjs"], testScope: ["tests/b.test.mjs"] }),
      ],
    },
    states: { I1: "REVIEWED", I2: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "human.txt"), "the human's file, as committed\n");
    },
  });

  for (const [id, subject, testRel] of [
    ["I1", "src/a.mjs", "tests/a.test.mjs"],
    ["I2", "src/b.mjs", "tests/b.test.mjs"],
  ] as const) {
    writeFileSync(path.join(bench.root, subject), subjectSource(`SUBJECT-${id}`));
    writeFileSync(path.join(bench.root, testRel), passingTest(`TEST-${id}`, `../${subject}`));
    seedRed(bench, id, testRel);
    seedValidated(bench, id);
  }

  // The human's own staged work, established AFTER the run started (so it is not
  // in run.startDirty and no scope rule excludes it) — the index is a singleton
  // and publish is not its only writer.
  writeFileSync(path.join(bench.root, "human.txt"), `the human's staged edit ${OUTSIDE_MARKER}\n`);
  git(bench.root, ["add", "human.txt"]);

  // I1 denies at step 5 (the denylisted trailer) — AFTER step 2's `git add`.
  const denied: PublishResult = await publish(bench, "I1", { messageBuilder: () => DENYLISTED_MESSAGE });
  assert.equal(denied.ok, false, "I1's publish is denied by the trailer denylist");
  assert.ok((denied.denial ?? "").includes("Co-Authored-By"), "the denial names the denylisted token");
  assert.equal(denied.commit, null, "the denied publish created no commit");

  // PREMISES. Without these the assertions below could pass because the fixture
  // never produced any residue at all.
  const indexBefore = stagedFiles(bench.root);
  assert.ok(indexBefore.includes("src/a.mjs"), "PREMISE: I1's denial left its subject staged in the index");
  assert.ok(
    indexBefore.includes("tests/a.test.mjs"),
    "PREMISE: I1's denial left its test staged in the index",
  );
  assert.ok(indexBefore.includes("human.txt"), "PREMISE: the human's own `git add` is in the same index");
  const commitsBefore = commitCount(bench.root);
  const headBefore = headSha(bench.root) ?? "";

  const res: PublishResult = await publish(bench, "I2");
  assert.equal(res.ok, true, `I2 publishes (denial: ${res.denial ?? "none"})`);
  assert.ok(res.commit !== null, "I2 created a commit");
  assert.equal(commitCount(bench.root), commitsBefore + 1, "exactly ONE new commit exists");
  assert.notEqual(headSha(bench.root) ?? "", headBefore, "HEAD moved to I2's commit");

  // The commit is I2's scope EXACTLY — nothing else the index happened to hold.
  assert.deepEqual(
    commitPaths(bench.root),
    ["src/b.mjs", "tests/b.test.mjs"],
    "I2's commit contains exactly I2's declared scope",
  );

  // And the sweepings are still where they were: staged, uncommitted, unlost.
  const tree = treePaths(bench.root);
  assert.ok(!tree.includes("src/a.mjs"), "I1's subject did NOT ship in I2's commit");
  assert.ok(!tree.includes("tests/a.test.mjs"), "I1's test did NOT ship in I2's commit");
  assert.equal(
    git(bench.root, ["show", "HEAD:human.txt"]),
    "the human's file, as committed\n",
    "the human's STAGED edit was not swept into I2's commit",
  );
  const indexAfter = stagedFiles(bench.root);
  assert.ok(indexAfter.includes("src/a.mjs"), "I1's staged residue survives the commit, still staged");
  assert.ok(indexAfter.includes("human.txt"), "the human's staged edit survives the commit, still staged");
  assert.deepEqual(
    res.staged,
    ["src/b.mjs", "tests/b.test.mjs"],
    "the compact return reports exactly the paths the commit carried",
  );
  assert.equal(bench.store.loadItem(bench.runId, "I2").state, "PUBLISHED", "I2 advanced");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "I1 stayed at REVIEWED");
});

// ===========================================================================
// (2) An empty pathspec is not a whole-tree diff
// ===========================================================================

test("[publish-empty-scope-diff-is-not-whole-tree] an item that staged NOTHING records an EMPTY batch diff — not `git diff HEAD` over the whole worktree, which at that instant names an out-of-scope file the item never touched", async () => {
  const bench = makeBench({
    config: makeConfig({ gitMode: "read-only" }),
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
      writeFileSync(path.join(root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
      writeFileSync(path.join(root, "unrelated.txt"), "unrelated, as committed\n");
    },
    dirty: (root) => {
      // The human was already editing BOTH of the item's declared paths before
      // the run existed, so §3.3 step 2 excludes both and the item stages nothing.
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("HUMAN-WIP"));
      writeFileSync(path.join(root, "tests", "beta.test.mjs"), passingTest("HUMAN-WIP", "../src/beta.mjs"));
    },
  });

  const startDirty = bench.store.loadRun(bench.runId).startDirty;
  assert.ok(startDirty.includes("src/beta.mjs"), "PREMISE: the item's file is pre-existing dirt");
  assert.ok(startDirty.includes("tests/beta.test.mjs"), "PREMISE: the item's test is pre-existing dirt");

  // A worktree change OUTSIDE the item's scope, made after the run started. Only
  // a whole-worktree diff can see it.
  writeFileSync(path.join(bench.root, "unrelated.txt"), `unrelated, edited ${OUTSIDE_MARKER}\n`);

  seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1");

  const res: PublishResult = await publish(bench, "I1");
  assert.equal(res.ok, true, `read-only publish prepares a batch (denial: ${res.denial ?? "none"})`);
  assert.deepEqual(res.staged, [], "PREMISE: the item staged nothing — the empty-pathspec case");
  assert.deepEqual(
    [...res.skipped].sort(),
    ["src/beta.mjs", "tests/beta.test.mjs"],
    "PREMISE: both scope paths were skipped as pre-existing dirt",
  );

  // PREMISE, asserted through git itself: at this instant the degenerate form the
  // handler used — `git diff HEAD --` with no pathspec — is NOT an empty diff. It
  // is the whole-worktree diff, and it names a file outside the item's scope. This
  // is what makes "the batch diff is empty" a real distinction rather than a
  // tautology about a clean tree.
  const wholeTree = git(bench.root, ["diff", "HEAD", "--"]);
  assert.ok(wholeTree.length > 0, "PREMISE: the empty-pathspec diff form is non-empty here");
  assert.ok(wholeTree.includes("unrelated.txt"), "PREMISE: it reaches an out-of-scope file");
  assert.ok(wholeTree.includes(OUTSIDE_MARKER), "PREMISE: it carries the out-of-scope EDIT itself");

  const batch = readBatch(bench.runDir);
  assert.equal(batch.length, 1, "one batch line was written");
  assert.deepEqual(batch[0].files, [], "the batch line reports no files");
  assert.ok(
    !batch[0].diff.includes("unrelated.txt"),
    "the batch diff does not name a file outside the item's scope",
  );
  assert.ok(
    !batch[0].diff.includes(OUTSIDE_MARKER),
    "the batch diff does not carry an out-of-scope edit",
  );
  assert.equal(batch[0].diff, "", "an item that staged nothing has an EMPTY diff, not a whole-tree one");
});

// ===========================================================================
// (3) A deletion inside the declared scope must ship
// ===========================================================================

test("[publish-ships-in-scope-deletion] a file the item DELETED inside its declared fileScope is staged and its removal ships in the commit — existsSync cannot tell 'deleted' from 'never existed', but git can", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", {
          fileScope: ["src/beta.mjs", "src/legacy.mjs", "src/never.mjs"],
          testScope: ["tests/beta.test.mjs"],
        }),
      ],
    },
    states: { I1: "REVIEWED" },
    seed: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), subjectSource("BASE"));
      writeFileSync(path.join(root, "src", "legacy.mjs"), subjectSource("LEGACY-TO-BE-DELETED"));
    },
  });

  // The item's change: the subject is rewritten, its test lands, and the legacy
  // module it replaced is DELETED. "src/never.mjs" is declared but was never
  // created — the case the existsSync filter was really guarding against, kept
  // here so the fix cannot be "hand every declared path to git add".
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource("IMPLEMENTED"));
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("TEST-I1", "../src/beta.mjs"));
  rmSync(path.join(bench.root, "src", "legacy.mjs"));

  // PREMISES: the deleted path really was tracked at HEAD and really is gone.
  assert.ok(
    treePaths(bench.root).includes("src/legacy.mjs"),
    "PREMISE: the deleted path is tracked in HEAD's tree",
  );
  assert.ok(
    !existsSync(path.join(bench.root, "src", "legacy.mjs")),
    "PREMISE: the item really removed the file from the worktree",
  );
  assert.ok(
    !existsSync(path.join(bench.root, "src", "never.mjs")),
    "PREMISE: the never-created scope path does not exist either",
  );

  seedRed(bench, "I1", "tests/beta.test.mjs");
  seedValidated(bench, "I1");

  const res: PublishResult = await publish(bench, "I1");
  assert.equal(res.ok, true, `publish succeeds (denial: ${res.denial ?? "none"})`);
  assert.ok(res.staged.includes("src/legacy.mjs"), "the deleted path is part of what publish staged");
  assert.ok(
    !res.staged.includes("src/never.mjs"),
    "a declared path git has never heard of is NOT staged (git add would abort on it)",
  );

  assert.ok(
    commitNameStatus(bench.root).includes("D\tsrc/legacy.mjs"),
    `the commit records the DELETION (name-status: ${commitNameStatus(bench.root).join(" | ")})`,
  );
  assert.ok(
    !treePaths(bench.root).includes("src/legacy.mjs"),
    "and the file is gone from the tree the commit points at",
  );
  assert.deepEqual(
    commitPaths(bench.root),
    ["src/beta.mjs", "src/legacy.mjs", "tests/beta.test.mjs"],
    "the commit carries the item's scope: the edit, the deletion, and the test",
  );
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "the item advanced");
});
