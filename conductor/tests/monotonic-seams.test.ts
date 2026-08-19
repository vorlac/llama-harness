// GAP-035 (P14 — enforcement that holds only when the machine is idle) red tests —
// lives at conductor/tests/monotonic-seams.test.ts.
//
// Subject: the two seams whose verdict a same-instant collision can flip —
//   conductor/adapter/clock.ts   (the injectable monotonic time source, and the
//                                 resolution a stamp carries on its face);
//   conductor/core/freshness.ts  (§2.6 condition 1, whose tie between a start stamp
//                                 and a staged mtime is decidable only when the stamp
//                                 can order two events inside one millisecond);
//   conductor/adapter/tools.ts   (capturedRedOf: "is a later run for this item on the
//                                 ledger than the red the critics would be shown").
//
// Every collision below is CONSTRUCTED, never waited for: the timestamps and the
// ledger are written by hand, so the verdict these tests pin is the same on an idle
// machine and on a loaded one.
//
// Assertions: GAP-035-clock-strict, GAP-035-clock-wall-jump, GAP-035-stamp-resolution,
// GAP-035-fresh-tie-precise, GAP-035-fresh-tie-coarse, GAP-035-fresh-sub-ms-truncation,
// GAP-035-stale-red-seq-collision, GAP-035-stale-red-torn-line.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { createMonotonicClock, stampResolutionMsOf } from "../adapter/clock.ts";
import { capturedRedOf } from "../adapter/tools.ts";
import { verifyFreshFor } from "../core/freshness.ts";
import type { Item } from "../core/types.ts";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});
function scratchRunDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-gap035-"));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// The clock: two events inside one tick must still be ordered
// ---------------------------------------------------------------------------

test("[GAP-035-clock-strict] a monotonic clock built on a STUCK elapsed source still returns strictly increasing stamps: two events inside one tick are ordered, never equal", () => {
  const clock = createMonotonicClock({ wall: () => 1_700_000_000_000, elapsed: () => 0n });
  const stamps = [clock(), clock(), clock(), clock(), clock()];
  for (let i = 1; i < stamps.length; i += 1) {
    assert.ok(
      stamps[i] > stamps[i - 1],
      `stamp ${i} (${stamps[i]}) must be strictly greater than stamp ${i - 1} (${stamps[i - 1]}): ` +
        "a tie is what makes a freshness or stale-red comparison a coin flip",
    );
  }
  assert.ok(
    stamps[0] >= 1_700_000_000_000,
    "the first stamp is the wall clock the run started from, so the value stays an epoch millisecond",
  );
});

test("[GAP-035-clock-wall-jump] the clock reads the wall clock ONCE, so an NTP step backwards cannot move a stamp back before one already handed out", () => {
  let wall = 1_700_000_000_000;
  let ns = 0n;
  const clock = createMonotonicClock({ wall: () => wall, elapsed: () => ns });
  const first = clock();
  wall = 1_600_000_000_000; // the wall clock steps a hundred million seconds backwards
  ns = 5_000_000n; // 5 ms of real elapsed time
  const second = clock();
  assert.ok(second > first, "the second stamp is later than the first despite the wall-clock step");
  assert.ok(
    Math.abs(second - (first + 5)) < 0.001,
    `the elapsed source, not the wall clock, sets the interval (expected ~${first + 5}, got ${second})`,
  );
});

test("[GAP-035-stamp-resolution] a stamp declares on its face what it can order: a whole-millisecond stamp resolves 1ms, a fractional one resolves the tie", () => {
  assert.equal(stampResolutionMsOf(1_700_000_000_000), 1, "a whole-millisecond wall stamp cannot order two events inside its tick");
  assert.equal(stampResolutionMsOf(1_700_000_000_000.5), 0, "a fractional stamp came from the monotonic source and can");
  assert.equal(stampResolutionMsOf(Number.NaN), 1, "an unreadable stamp is treated as the coarse case, never as a proof of ordering");
});

// ---------------------------------------------------------------------------
// §2.6 condition 1: the tie between the start stamp and a staged mtime
// ---------------------------------------------------------------------------

const FRESH_HEAD = "a".repeat(40);

test("[GAP-035-fresh-tie-precise] an edit stamped at the IDENTICAL instant as a precise verify start is STALE: a tie the stamp can resolve is not a proof that the edit preceded the verify", () => {
  const verdict = verifyFreshFor(
    { startedMs: 1_700_000_000_000.5, head: FRESH_HEAD },
    {
      stagedMtimes: [1_700_000_000_000.5],
      indexMtimeMs: 0,
      hasStagedDeletion: false,
      currentHead: FRESH_HEAD,
      noGit: false,
      stampResolutionMs: 0,
    },
  );
  assert.equal(verdict.fresh, false, "the collision resolves STALE, so the verify is re-run instead of trusted");
  assert.match(verdict.why, /verify started/, "and the reason names the term that failed: " + verdict.why);
});

test("[GAP-035-fresh-tie-coarse] the same collision under a whole-millisecond stamp keeps §2.6's equality-counts-fresh reading: a clock that cannot order the two events may not call every same-millisecond edit unverified", () => {
  const verdict = verifyFreshFor(
    { startedMs: 1_700_000_000_000, head: FRESH_HEAD },
    {
      stagedMtimes: [1_700_000_000_000],
      indexMtimeMs: 0,
      hasStagedDeletion: false,
      currentHead: FRESH_HEAD,
      noGit: false,
    },
  );
  assert.equal(verdict.fresh, true, "equality counts fresh when the stamp resolves nothing finer than the tick");
});

test("[GAP-035-fresh-sub-ms-truncation] an edit that landed BEFORE the verify started reads stale under a truncated wall stamp and fresh under the monotonic one: the flip a loaded machine used to decide", () => {
  // The edit landed at 1000.7 ms and the verify started at 1000.9 ms. Date.now()
  // truncates the start to 1000, so the sub-millisecond mtime looks later than a
  // start it actually preceded — a §2.6 verdict decided by where inside one
  // millisecond the two events happened to fall.
  const coarse = verifyFreshFor(
    { startedMs: 1_700_000_000_000, head: FRESH_HEAD },
    {
      stagedMtimes: [1_700_000_000_000.7],
      indexMtimeMs: 0,
      hasStagedDeletion: false,
      currentHead: FRESH_HEAD,
      noGit: false,
      stampResolutionMs: 1,
    },
  );
  assert.equal(coarse.fresh, false, "the truncated stamp cannot see that the edit preceded the start");

  const precise = verifyFreshFor(
    { startedMs: 1_700_000_000_000.9, head: FRESH_HEAD },
    {
      stagedMtimes: [1_700_000_000_000.7],
      indexMtimeMs: 0,
      hasStagedDeletion: false,
      currentHead: FRESH_HEAD,
      noGit: false,
      stampResolutionMs: 0,
    },
  );
  assert.equal(precise.fresh, true, "the monotonic stamp orders the two events and the verify stands");
});

// ---------------------------------------------------------------------------
// The stale-red seam: "has a later run happened than the red the critics see?"
// ---------------------------------------------------------------------------

const RED_LINE = {
  seq: 1,
  ts: 1_700_000_000_000,
  kind: "red",
  itemId: "I1",
  command: ["node", "--test", "tests/p.test.mjs"],
  exitCode: 1,
  failureExcerpt: "AssertionError [ERR_ASSERTION]: 7 !== -7",
  failureClass: "assertion",
  targeted: true,
};

function itemPointingAt(seq: number): Item {
  return {
    id: "I1",
    state: "RED",
    assignee: null,
    worktree: null,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: { red: { ledger: "evidence.jsonl", seq } },
    taint: [],
    inlineClaim: null,
  };
}

function writeLedger(runDir: string, lines: string[]): void {
  writeFileSync(path.join(runDir, "evidence.jsonl"), lines.join("\n") + "\n");
}

test("[GAP-035-stale-red-seq-collision] a later run that computed the SAME seq as the captured red still makes the red stale: recency is the ledger's own append order, not a counter two writers can land on together", () => {
  const runDir = scratchRunDir();
  // Two writers that read the ledger in the same instant both mint max+1 and both
  // write seq 2 — the sequence analogue of a same-millisecond stamp collision. The
  // GREEN below is the repaired test's run, so the red no longer describes what the
  // test on disk produces and the critics may not be shown it.
  writeLedger(runDir, [
    JSON.stringify({ ...RED_LINE, seq: 2 }),
    JSON.stringify({ seq: 2, ts: 1_700_000_000_001, kind: "green", itemId: "I1", command: ["node", "--test", "tests/p.test.mjs"], exitCode: 0 }),
  ]);
  const captured = capturedRedOf(runDir, itemPointingAt(2), "I1");
  assert.equal(captured.red.seq, 2, "the red the pointer names is still the record returned");
  assert.equal(
    captured.stale,
    true,
    "a run recorded AFTER the red makes the pairing stale even when the two records carry the same seq",
  );
});

test("[GAP-035-stale-red-torn-line] a torn ledger line makes the captured red STALE rather than invisible: an unreadable record is never read as proof that nothing newer ran", () => {
  const runDir = scratchRunDir();
  writeLedger(runDir, [JSON.stringify(RED_LINE), '{"seq":2,"kind":"gr']);
  const captured = capturedRedOf(runDir, itemPointingAt(1), "I1");
  assert.equal(captured.red.seq, 1, "the torn line does not wedge the vet: the legal red is still found");
  assert.equal(
    captured.stale,
    true,
    "and the vet re-establishes the red instead of trusting a ledger it could not read to the end",
  );
});

test("[GAP-035-stale-red-newest-red-is-fresh] the normal path is untouched: when the captured red IS the last record for the item, nothing is stale and no re-run is provoked", () => {
  const runDir = scratchRunDir();
  writeLedger(runDir, [
    JSON.stringify({ seq: 1, ts: 1_699_999_999_000, kind: "green", itemId: "I2", command: ["node"], exitCode: 0 }),
    JSON.stringify({ ...RED_LINE, seq: 2 }),
  ]);
  const captured = capturedRedOf(runDir, itemPointingAt(2), "I1");
  assert.equal(captured.stale, false, "another item's later record says nothing about this item's red");
  assert.equal(captured.resolvedByFallback, false, "and the item's own §2.6 pointer resolved it");
});
