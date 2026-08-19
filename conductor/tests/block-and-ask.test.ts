// conductor/tests/block-and-ask.test.ts — Phase IV.2 item 4 (GAP-028): ONE
// transactional block-and-ask primitive.
//
// SUBJECT: conductor/adapter/block-and-ask.ts
//
// The class this closes (C-032 E7 / ISSUE-100): a stuck stage appends its §2.11
// question FIRST and calls store.setBlocked SECOND. A crash between the two writes
// leaves an OPEN question naming an item that carries no disposition — the stage
// gate then offers the tool again on an item nothing says is blocked, and the
// question is unanswerable-by-construction because answering it clears nothing.
// Prevention covered 2 of the sites and the repair pass excluded 4 of them by
// origin.
//
// The primitive writes an INTENT first (temp+rename), then both halves, then drops
// the intent — so a crash at any point leaves a record from which the next open
// completes exactly what was owed. Neither half is inferred: the intent carries the
// whole ask.
//
// HERMETIC: throwaway dirs under os.tmpdir(); no git remote, no socket, no port.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  blockItemWithQuestion,
  pendingBlockIntents,
  reconcileOrphanQuestions,
  replayBlockIntents,
} from "../adapter/block-and-ask.ts";
import type { BlockJournal } from "../adapter/block-and-ask.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateJournal, StateStore } from "../adapter/state.ts";
import { answerQuestion, readQuestions } from "../adapter/questions.ts";
import type { NewQuestion } from "../adapter/questions.ts";
import type { Config, Item } from "../core/types.ts";

const START_MS = 1_754_560_000_000;

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

interface LogCall {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
}

function makeJournal(): { sink: BlockJournal & StateJournal; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const sink = {
    log(
      level: string,
      component: string,
      event: string,
      data: Record<string, unknown>,
    ): void {
      calls.push({ level, component, event, data });
    },
  };
  return { sink, calls };
}

function makeConfig(): Config {
  const cfg: Config = {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 1,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 1, maxReaders: 1, subSessionTimeoutMs: 1000 },
    models: { default: "qwen3.6-27b", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 5, maxRunDirBytes: 100_000_000, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
  return cfg;
}

function makeItem(id: string): Item {
  return {
    id,
    state: "RED",
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

interface Bench {
  store: StateStore;
  runId: string;
  runDir: string;
  journal: BlockJournal & StateJournal;
  calls: LogCall[];
}

function bench(itemIds: string[] = ["I1"]): Bench {
  const root = mkdtempSync(path.join(tmpdir(), "conductor-blockask-"));
  tmpDirs.push(root);
  const { sink, calls } = makeJournal();
  const store = openWorkspace({
    root,
    config: makeConfig(),
    journal: sink,
    version: "0.0.0-test",
    sessionID: "ses_test",
    now: () => START_MS,
  });
  const run = store.createRun({
    prompt: "p",
    sessionID: "ses_test",
    classification: { kind: "work", rationale: "r", check: { agreed: true, note: "" } },
  });
  for (const id of itemIds) store.saveItem(run.runId, makeItem(id));
  return {
    store,
    runId: run.runId,
    runDir: path.join(root, ".conductor", "runs", run.runId),
    journal: sink,
    calls,
  };
}

function ask(runId: string, itemId: string, origin: NewQuestion["origin"] = "implementer-blocked"): NewQuestion {
  return {
    runId,
    question: "the implementer is stuck on " + itemId + "; say how it should proceed",
    askedBy: { role: "implementer", sessionID: "ses_sub_1" },
    humanTerritory: false,
    origin,
    blocksItems: [itemId],
  };
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("[IV.2-blockask] the primitive writes BOTH halves and leaves no intent behind", () => {
  const b = bench();
  const result = blockItemWithQuestion({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    itemIds: ["I1"],
    question: ask(b.runId, "I1"),
    reason: "the implementer could not take the item to GREEN",
    stage: "GREEN",
    journal: b.journal,
    now: () => START_MS,
  });

  const questions = readQuestions(b.runDir);
  assert.equal(questions.length, 1, "exactly one question was appended");
  assert.equal(result.question.id, questions[0].id, "the result names the appended question");
  const item = b.store.loadItem(b.runId, "I1");
  assert.equal(item.blocked?.questionId, questions[0].id, "the item's disposition points AT that question");
  assert.equal(item.blocked?.stage, "GREEN", "and carries the stage the ask was raised at");
  assert.deepEqual(pendingBlockIntents(b.runDir), [], "a completed transaction leaves no intent");
  assert.ok(
    b.calls.some((c) => c.event === "question.surfaced"),
    "the ask is journaled",
  );
  assert.ok(
    b.calls.some((c) => c.event === "item.updated" && c.data.blocked === true),
    "and so is the disposition it caused",
  );
});

// ---------------------------------------------------------------------------
// The crash windows
// ---------------------------------------------------------------------------

test("[IV.2-blockask] a crash after the intent and before EITHER half is completed by replay", () => {
  const b = bench();
  assert.throws(
    () =>
      blockItemWithQuestion({
        store: b.store,
        runId: b.runId,
        runDir: b.runDir,
        itemIds: ["I1"],
        question: ask(b.runId, "I1"),
        reason: "the implementer could not take the item to GREEN",
        stage: "GREEN",
        journal: b.journal,
        now: () => START_MS,
        onAfterIntent: () => {
          throw new Error("boom: killed after the intent, before either write");
        },
      }),
    /boom/,
    "the injected crash propagates",
  );

  assert.equal(readQuestions(b.runDir).length, 0, "premise: neither half landed");
  assert.equal(b.store.loadItem(b.runId, "I1").blocked, null, "premise: the item carries no disposition");
  assert.equal(pendingBlockIntents(b.runDir).length, 1, "the intent survives the crash");

  const completed = replayBlockIntents({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    journal: b.journal,
    now: () => START_MS,
  });

  assert.deepEqual(completed, ["I1"], "replay reports the item it completed the ask for");
  const questions = readQuestions(b.runDir);
  assert.equal(questions.length, 1, "the question the crash owed is appended exactly once");
  assert.equal(
    b.store.loadItem(b.runId, "I1").blocked?.questionId,
    questions[0].id,
    "and the item is blocked at it",
  );
  assert.deepEqual(pendingBlockIntents(b.runDir), [], "the intent is cleared once the transaction is whole");
});

test("[IV.2-blockask] a crash BETWEEN the halves does not mint a second question — replay reuses the open one", () => {
  const b = bench();
  assert.throws(
    () =>
      blockItemWithQuestion({
        store: b.store,
        runId: b.runId,
        runDir: b.runDir,
        itemIds: ["I1"],
        question: ask(b.runId, "I1"),
        reason: "the implementer could not take the item to GREEN",
        stage: "GREEN",
        journal: b.journal,
        now: () => START_MS,
        onAfterQuestion: () => {
          throw new Error("boom: killed after the question, before the block");
        },
      }),
    /boom/,
    "the injected crash propagates",
  );

  assert.equal(readQuestions(b.runDir).length, 1, "premise: the question landed");
  assert.equal(b.store.loadItem(b.runId, "I1").blocked, null, "premise: the block did not");

  replayBlockIntents({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    journal: b.journal,
    now: () => START_MS,
  });

  const questions = readQuestions(b.runDir);
  assert.equal(
    questions.length,
    1,
    "a second question for the same stuck item would be unanswerable-by-construction: the item has ONE disposition",
  );
  assert.equal(b.store.loadItem(b.runId, "I1").blocked?.questionId, questions[0].id, "the block completes at the open question");
});

test("[IV.2-blockask] replay is idempotent: a whole transaction is left exactly as it stands", () => {
  const b = bench();
  blockItemWithQuestion({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    itemIds: ["I1"],
    question: ask(b.runId, "I1"),
    reason: "stuck",
    stage: "GREEN",
    journal: b.journal,
    now: () => START_MS,
  });
  const before = b.store.loadItem(b.runId, "I1");

  const completed = replayBlockIntents({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    journal: b.journal,
    now: () => START_MS + 5000,
  });

  assert.deepEqual(completed, [], "there was nothing owed");
  assert.equal(readQuestions(b.runDir).length, 1, "no duplicate question");
  assert.deepEqual(b.store.loadItem(b.runId, "I1").blocked, before.blocked, "the disposition is untouched");
});

test("[IV.2-blockask] an item RELEASED from its question is not re-blocked by the repair", () => {
  const b = bench();
  const result = blockItemWithQuestion({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    itemIds: ["I1"],
    question: ask(b.runId, "I1"),
    reason: "stuck",
    stage: "GREEN",
    journal: b.journal,
    now: () => START_MS,
  });
  // The documented escape hatch: conductor_queue_amend clears the block while the
  // question stays open. The item's own releasedQuestions history is what separates
  // that from a half-applied ask.
  b.store.clearBlocked(b.runId, "I1");
  assert.ok(
    (b.store.loadItem(b.runId, "I1").releasedQuestions ?? []).includes(result.question.id),
    "premise: the release is recorded on the item",
  );

  reconcileOrphanQuestions(b.store, b.runId, b.runDir, b.journal);

  assert.equal(
    b.store.loadItem(b.runId, "I1").blocked,
    null,
    "a released item stays released — repairing without the separator kills the escape hatch permanently",
  );
});

// ---------------------------------------------------------------------------
// ISSUE-100's repair half: EVERY origin is reconciled, not one
// ---------------------------------------------------------------------------

test("[IV.2-blockask] the orphan reconciler completes a half-applied ask at ANY origin, not just implementer-blocked", () => {
  for (const origin of ["review-round-cap", "debug-architecture", "plan-review-cap", "scope-conflict"] as const) {
    const b = bench();
    // A half-applied ask at this origin: the question landed, the block did not.
    assert.throws(
      () =>
        blockItemWithQuestion({
          store: b.store,
          runId: b.runId,
          runDir: b.runDir,
          itemIds: ["I1"],
          question: ask(b.runId, "I1", origin),
          reason: "the cap was reached",
          stage: "REVIEWED",
          journal: b.journal,
          now: () => START_MS,
          onAfterQuestion: () => {
            throw new Error("boom");
          },
        }),
      /boom/,
    );
    // The intent is deliberately discarded, so the reconciler is the ONLY repair
    // left — this is the state a crash before the intent write leaves, and the
    // state every ask minted before the primitive existed leaves.
    rmSync(path.join(b.runDir, "block-intents"), { recursive: true, force: true });

    reconcileOrphanQuestions(b.store, b.runId, b.runDir, b.journal);

    const questions = readQuestions(b.runDir);
    assert.equal(
      b.store.loadItem(b.runId, "I1").blocked?.questionId,
      questions[0].id,
      `an open ${origin} question naming an undisposed item must be completed, or the item is offered the same tool forever`,
    );
  }
});

test("[IV.2-blockask] an ANSWERED question never re-blocks anything", () => {
  const b = bench();
  blockItemWithQuestion({
    store: b.store,
    runId: b.runId,
    runDir: b.runDir,
    itemIds: ["I1"],
    question: ask(b.runId, "I1"),
    reason: "stuck",
    stage: "GREEN",
    journal: b.journal,
    now: () => START_MS,
  });
  b.store.clearBlocked(b.runId, "I1");
  // An answered question with the item already released: nothing to repair.
  const item = b.store.loadItem(b.runId, "I1");
  item.releasedQuestions = [];
  b.store.saveItem(b.runId, item);
  answerQuestion(b.runDir, readQuestions(b.runDir)[0].id, "proceed as written", "human-file", START_MS + 10);

  reconcileOrphanQuestions(b.store, b.runId, b.runDir, b.journal);
  assert.equal(b.store.loadItem(b.runId, "I1").blocked, null, "a settled question is not a pending ask");
});

// ---------------------------------------------------------------------------
// ISSUE-100's prevention half: no stage tool hand-rolls the pair any more
// ---------------------------------------------------------------------------

test("[IV.2-blockask] no handler in tools.ts pairs a bare question append with its own setBlocked", () => {
  const source = readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "adapter", "tools.ts"),
    "utf8",
  );
  const bareBlocks = source.split("store.setBlocked(").length - 1;
  assert.ok(
    bareBlocks <= 2,
    "every stuck-stage ask routes through blockItemWithQuestion; the only remaining direct dispositions are " +
      "conductor_surface_question's own multi-item loop and its successor path — found " +
      String(bareBlocks),
  );
});
