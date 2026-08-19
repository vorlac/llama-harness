// conductor/tests/evidence-attribution.test.ts — Phase IV.2 items 1 and 3:
// evidence attribution (ISSUE-027) and cross-process-guarded seq minting
// (ISSUE-026), the two halves of the STATE-CRASH-005/006 chain that stay closed
// even if the single-writer lock is ever bypassed.
//
// SUBJECTS:
//   conductor/adapter/evidence.ts — every appended record carries the writer's
//     identity {pid, startedMs}; seq is minted through mintEvidenceSeq, which
//     reserves under an exclusive-create latch and refuses to mint while a
//     FOREIGN LIVE process holds the workspace lock.
//   conductor/adapter/state.ts    — lockHolderForRunDir / assertWorkspaceLockHeld:
//     the lock dependency the mint records.
//   conductor/adapter/tools.ts    — lookupEvidenceAt refuses a record whose
//     itemId (or, in worktree mode, tree) is not the one the caller asked for.
//
// The chain these close: two writers mint the same seq -> a pointer resolves to
// another item's record -> publish ships one item's green on another's verify.
// Attribution alone breaks the last link regardless of how the seq collided.
//
// HERMETIC: every fixture is a throwaway dir under os.tmpdir(); no git remote, no
// socket, no port 8080, nothing under the harness repo.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { mintEvidenceSeq, runTest, validateEvidenceRecord } from "../adapter/evidence.ts";
import type { ScopeSpec } from "../adapter/evidence.ts";
import { lockHolderForRunDir } from "../adapter/state.ts";
import { lookupEvidenceAt } from "../adapter/tools.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { treeSlug, validate } from "../core/types.ts";
import type { Config, EvidenceRecord } from "../core/types.ts";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

// A workspace whose <root>/.conductor/runs/<runId> is the run dir the evidence
// writer works in, so the mint can find (or not find) the workspace lock beside it.
function workspaceRunDir(runId = "r-20260818-a1b2"): { root: string; runDir: string; lockPath: string } {
  const root = scratch("conductor-attr-ws-");
  const runDir = path.join(root, ".conductor", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  mkdirSync(path.join(root, ".conductor", "state"), { recursive: true });
  return { root, runDir, lockPath: path.join(root, ".conductor", "state", "run.lock") };
}

function fullConfig(): Config {
  const cfg: Config = {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "refuse" },
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
    models: { default: "qwen3.6-27b", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 20, maxRunDirBytes: 268435456, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
  return cfg;
}

function makeJournal(runDir: string): Journal {
  return createJournal(runDir, fullConfig(), {});
}

function readLedger(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvidenceRecord);
}

// A pid that is guaranteed dead: a spawned-and-reaped child.
function deadPid(): number {
  const reaped = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(typeof reaped.pid, "number", "spawn-and-reap yields a concrete, now-dead pid");
  return reaped.pid as number;
}

// ---------------------------------------------------------------------------
// (1) Attribution: every appended evidence record names its writer
// ---------------------------------------------------------------------------

test("[IV.2-attribution] runTest stamps the writer identity {pid, startedMs} on the appended record, and the ledger validates with it", () => {
  const { runDir } = workspaceRunDir();
  const journal = makeJournal(runDir);
  const scope: ScopeSpec = {
    name: "unit",
    command: [process.execPath, "-e", "process.exit(0)"],
    timeoutMs: 600000,
    itemTest: [process.execPath, "-e", "process.exit(0)"],
  };
  const result = runTest(runDir, "I1", {
    scope,
    testFiles: ["tests/x.test.ts"],
    cwd: runDir,
    fileScope: ["src/**"],
    journal,
    writer: { pid: 4242, startedMs: 1_700_000_000_000 },
  });

  assert.deepEqual(
    result.record.writer,
    { pid: 4242, startedMs: 1_700_000_000_000 },
    "the appended record carries the identity of the process that wrote it, so a foreign record is attributable",
  );
  const persisted = readLedger(runDir);
  assert.equal(persisted.length, 1, "exactly one record was appended");
  assert.deepEqual(persisted[0].writer, { pid: 4242, startedMs: 1_700_000_000_000 }, "the identity survives the round-trip to disk");
  assert.equal(validate("EvidenceRecord", persisted[0]).ok, true, "the §2 schema admits the writer field");
});

test("[IV.2-attribution] validateEvidenceRecord REFUSES a record with no writer identity — an unattributable record is not appendable", () => {
  const base = {
    seq: 1,
    ts: 1,
    kind: "red" as const,
    itemId: "I1",
    command: ["node", "--test"],
    exitCode: 1,
    failureExcerpt: "AssertionError",
    failureClass: "assertion" as const,
    targeted: true,
  };
  const withoutWriter = validateEvidenceRecord(base);
  assert.equal(withoutWriter.ok, false, "a record naming no writer is refused");
  assert.ok(
    withoutWriter.errors.some((e) => e.includes("writer")),
    "the refusal names the missing field: " + withoutWriter.errors.join("; "),
  );
  const withWriter = validateEvidenceRecord({ ...base, writer: { pid: 1, startedMs: 2 } });
  assert.equal(withWriter.ok, true, "the same record WITH a writer is appendable: " + withWriter.errors.join("; "));
});

// ---------------------------------------------------------------------------
// (2) ISSUE-027: a record is resolved by seq AND by attribution
// ---------------------------------------------------------------------------

function plantLedger(runDir: string, records: unknown[]): void {
  writeFileSync(
    path.join(runDir, "evidence.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

const verifyRecord = (over: Record<string, unknown>): Record<string, unknown> => ({
  seq: 7,
  ts: 10,
  kind: "verify",
  itemId: "I1",
  startedMs: 5,
  head: "a".repeat(40),
  branch: "main",
  tree: "main",
  excluded: [],
  green: true,
  scopes: {},
  writer: { pid: 1, startedMs: 1 },
  ...over,
});

test("[IV.2-attribution] lookupEvidenceAt refuses a record at the asked-for seq that belongs to ANOTHER item (ISSUE-027)", () => {
  const { runDir } = workspaceRunDir();
  plantLedger(runDir, [verifyRecord({ itemId: "I2" })]);

  const mine = lookupEvidenceAt(runDir, 7, { itemId: "I1" });
  assert.equal(mine.record, null, "a seq hit whose itemId is another item's is NOT this item's evidence");
  assert.notEqual(mine.refused, null, "the refusal is reported rather than silently indistinguishable from an absent record");
  assert.equal(mine.refused?.foundItemId, "I2", "the refusal names the item the record actually belongs to");

  const theirs = lookupEvidenceAt(runDir, 7, { itemId: "I2" });
  assert.equal(theirs.record?.seq, 7, "the record still resolves for the item that owns it");
  assert.equal(theirs.refused, null, "a correctly-attributed record is not a refusal");
});

test("[IV.2-attribution] lookupEvidenceAt refuses a verify record produced against a DIFFERENT tree (§4.2 worktree mode)", () => {
  const { runDir } = workspaceRunDir();
  plantLedger(runDir, [verifyRecord({ itemId: "I1", tree: "main" })]);

  const worktree = lookupEvidenceAt(runDir, 7, { itemId: "I1", tree: treeSlug("I1") });
  assert.equal(worktree.record, null, "a green produced on the shared tree is not a green for the item's worktree");
  assert.equal(worktree.refused?.foundTree, "main", "the refusal names the tree the record was produced against");

  const sameTree = lookupEvidenceAt(runDir, 7, { itemId: "I1", tree: treeSlug("main") });
  assert.equal(sameTree.record?.seq, 7, "the same record resolves when the caller asks for the tree it was produced on");
});

test("[IV.2-attribution] lookupEvidenceAt skips a torn line and still resolves a later well-formed record", () => {
  const { runDir } = workspaceRunDir();
  writeFileSync(
    path.join(runDir, "evidence.jsonl"),
    '{"seq":6,"kind":"ver\n' + JSON.stringify(verifyRecord({ seq: 7 })) + "\n",
  );
  const found = lookupEvidenceAt(runDir, 7, { itemId: "I1" });
  assert.equal(found.record?.seq, 7, "a crash-torn line is skipped, not thrown on");
});

// ---------------------------------------------------------------------------
// (3) ISSUE-026: seq minting is single-writer and collision-impossible
// ---------------------------------------------------------------------------

test("[IV.2-seq] two mints with no append in between yield DIFFERENT seqs — the reservation is durable, not a read-max-plus-one", () => {
  const { runDir } = workspaceRunDir();
  const first = mintEvidenceSeq(runDir, { pid: process.pid });
  const second = mintEvidenceSeq(runDir, { pid: process.pid });
  assert.equal(first, 1, "the first mint of an empty ledger is 1");
  assert.equal(
    second,
    2,
    "a second mint cannot re-issue the first number: read-max-plus-one over an unwritten ledger is exactly the collision ISSUE-026 names",
  );
  const third = mintEvidenceSeq(runDir, { pid: process.pid });
  assert.equal(third, 3, "the reservation keeps advancing");
});

test("[IV.2-seq] the mint advances past the highest seq ALREADY on the ledger (a reservation counter never rewinds history)", () => {
  const { runDir } = workspaceRunDir();
  plantLedger(runDir, [verifyRecord({ seq: 41 })]);
  assert.equal(mintEvidenceSeq(runDir, { pid: process.pid }), 42, "the mint clears the ledger's own maximum");
});

test("[IV.2-seq] the mint REFUSES while a live FOREIGN process holds the workspace lock (the recorded lock dependency)", () => {
  const { runDir, lockPath } = workspaceRunDir();
  // A live foreign holder: this test process, claimed under a different pid.
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startMs: 1 }));

  assert.throws(
    () => mintEvidenceSeq(runDir, { pid: process.pid + 1 }),
    /lock|holder|single-writer/i,
    "minting a seq beside another process's workspace lock is refused, naming the holder",
  );

  // The holder itself mints freely.
  assert.equal(mintEvidenceSeq(runDir, { pid: process.pid }), 1, "the lock HOLDER mints normally");
});

test("[IV.2-seq] a DEAD holder's lock does not wedge the mint (a crash must never make a run unwritable)", () => {
  const { runDir, lockPath } = workspaceRunDir();
  writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), startMs: 1 }));
  assert.equal(mintEvidenceSeq(runDir, { pid: process.pid }), 1, "a dead holder is no holder at all");
});

test("[IV.2-seq] lockHolderForRunDir reads the workspace lock that sits beside the run dir", () => {
  const { runDir, lockPath } = workspaceRunDir();
  assert.equal(lockHolderForRunDir(runDir), null, "no lock file means no holder");
  writeFileSync(lockPath, JSON.stringify({ pid: 9191, startMs: 77 }));
  assert.deepEqual(
    lockHolderForRunDir(runDir),
    { pid: 9191, startMs: 77 },
    "the holder is read from <root>/.conductor/state/run.lock, derived from the run dir",
  );
});
