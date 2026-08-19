// Task 4.1 red tests (question ledger half) — conductor/tests/questions.test.ts.
//
// Subject (must NOT exist when this goes red; failure is
// `Cannot find module '../adapter/questions.ts'` — the missing-subject red):
//   - conductor/adapter/questions.ts   (§2.11 questions.jsonl writer/reader)
// Built INSIDE Task 4.1 per the build's task-splitting. An ADAPTER (G14): node:fs /
// node:path only, may read the clock; no Bun API, no shell tag. Every fixture is a
// throwaway dir under os.tmpdir(), torn down in after(); nothing touches the
// llama-harness repo or port 8080.
//
// Spec read: plan 979-998 §2.11 (questions.jsonl shape + "conductor_answer records the
// answer, unblocks every item that named it"); plan 758-791 §2.5 (the item `blocked`
// annotation carries the questionId that answering must clear).
//
// ---------------------------------------------------------------------------
// PINNED EXPORT SURFACE the implementer must target (questions.ts). Functions take the
// RUN DIRECTORY (…/.conductor/runs/<runId>/) so they own both questions.jsonl and the
// items/ dir underneath it. `nowMs` is the injected clock (defaults to Date.now).
//
//   interface NewQuestion { runId; question; askedBy: {role;sessionID};
//       humanTerritory: boolean; origin: QuestionOrigin; blocksItems: string[] }
//   appendQuestion(runDir, input: NewQuestion, nowMs?): QuestionRecord
//       // mints the next id (Q-0001, Q-0002, …), stamps tsMs, sets answeredIso/answer
//       // null, appends one line to <runDir>/questions.jsonl, returns the record.
//   readQuestions(runDir): QuestionRecord[]
//       // current view, ONE record per id (an answer coalesces onto its question).
//   interface AnswerResult { question: QuestionRecord; clearedItemIds: string[] }
//   answerQuestion(runDir, questionId, answer: string, nowMs?): AnswerResult
//       // records the answer (answeredIso + answer) AND clears the `blocked` disposition
//       // on every item under <runDir>/items/ whose blocked.questionId === questionId,
//       // returning which items were cleared.
// ---------------------------------------------------------------------------
//
// Assertion id -> test name (docs/build/specs/task-4.1.assertions.json, 4.1-questions):
//   "[4.1-questions] appendQuestion mints sequential ids and persists to questions.jsonl"
//   "[4.1-questions] answerQuestion records the answer AND clears every item that named it"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The subject under test — absent at red time (the missing-subject red).
import { appendQuestion, readQuestions, answerQuestion } from "../adapter/questions.ts";
import type { NewQuestion } from "../adapter/questions.ts";
import type { Item } from "../core/types.ts";

const NOW = 1_754_560_000_000;

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A throwaway "run directory" with an items/ subdir, mirroring …/.conductor/runs/<runId>/.
function mkRunDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-questions-"));
  tmpDirs.push(dir);
  mkdirSync(path.join(dir, "items"), { recursive: true });
  return dir;
}

function baseQuestion(overrides: Partial<NewQuestion> = {}): NewQuestion {
  const base: NewQuestion = {
    runId: "r-20260807-a1b2",
    question: "Should unknown config keys fail the load, or collect and report all?",
    askedBy: { role: "planner", sessionID: "ses_planner" },
    humanTerritory: true,
    origin: "plan-review-cap",
    blocksItems: [],
  };
  return { ...base, ...overrides };
}

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  const base: Item = {
    id,
    state: "PENDING",
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
  return { ...base, ...overrides };
}

function writeItem(runDir: string, item: Item): void {
  writeFileSync(path.join(runDir, "items", `${item.id}.json`), JSON.stringify(item));
}

function readItem(runDir: string, id: string): Item {
  return JSON.parse(readFileSync(path.join(runDir, "items", `${id}.json`), "utf8")) as Item;
}

// ---------------------------------------------------------------------------

test("[4.1-questions] appendQuestion mints sequential ids and persists to questions.jsonl", () => {
  const runDir = mkRunDir();

  const q1 = appendQuestion(runDir, baseQuestion({ question: "Q one?", blocksItems: ["I2"] }), NOW);
  assert.equal(q1.id, "Q-0001", "the first question is Q-0001 (§2.11)");
  assert.equal(q1.tsMs, NOW, "tsMs is stamped from the injected clock");
  assert.equal(q1.question, "Q one?");
  assert.deepEqual(q1.blocksItems, ["I2"]);
  assert.equal(q1.answeredIso, null, "a fresh question is unanswered");
  assert.equal(q1.answer, null);

  const q2 = appendQuestion(runDir, baseQuestion({ question: "Q two?" }), NOW);
  assert.equal(q2.id, "Q-0002", "ids increment across appends");

  assert.ok(existsSync(path.join(runDir, "questions.jsonl")), "the ledger file is written");
  const all = readQuestions(runDir);
  assert.deepEqual(all.map((q) => q.id), ["Q-0001", "Q-0002"], "readQuestions returns both, in order");
  assert.deepEqual(all.map((q) => q.question), ["Q one?", "Q two?"]);
});

test("[4.1-questions] answerQuestion records the answer AND clears every item that named it", () => {
  const runDir = mkRunDir();

  const blocking = appendQuestion(runDir, baseQuestion({ question: "blocking?", blocksItems: ["I2"] }), NOW); // Q-0001
  appendQuestion(runDir, baseQuestion({ question: "other?", blocksItems: ["I3"] }), NOW); // Q-0002

  // I2 is blocked BY the question we will answer; I3 is blocked by a different one;
  // I9 is not blocked at all. Only I2 must be cleared.
  writeItem(runDir, makeItem("I2", { state: "RED", blocked: { reason: "needs answer", sinceMs: NOW, questionId: blocking.id, stage: "RED" } }));
  writeItem(runDir, makeItem("I3", { state: "RED", blocked: { reason: "other", sinceMs: NOW, questionId: "Q-0002", stage: "RED" } }));
  writeItem(runDir, makeItem("I9", { state: "GREEN" }));

  const res = answerQuestion(runDir, blocking.id, "collect and report all", "tool", NOW);
  assert.deepEqual(res.clearedItemIds, ["I2"], "exactly the items that named the question are cleared");
  assert.equal(res.question.answer, "collect and report all", "the answer is recorded on the question");
  assert.notEqual(res.question.answeredIso, null, "answeredIso is stamped");

  // I2 is unblocked on disk; I3 (named a different question) is untouched.
  assert.equal(readItem(runDir, "I2").blocked, null, "answering the question clears the item that named it");
  assert.notEqual(readItem(runDir, "I3").blocked, null, "an item that named a DIFFERENT question stays blocked");
  assert.equal(readItem(runDir, "I3").blocked?.questionId, "Q-0002");

  // The ledger now shows the question answered, coalesced to a single record.
  const answered = readQuestions(runDir).filter((q) => q.id === blocking.id);
  assert.equal(answered.length, 1, "answering coalesces to a single ledger record for the question");
  assert.equal(answered[0].answer, "collect and report all", "the persisted record carries the answer");
  assert.notEqual(answered[0].answeredIso, null, "the persisted record carries answeredIso");
});

// ---------------------------------------------------------------------------
// F1 (MAJOR): answerQuestion is two-phase — it MUST clear the blocked items BEFORE
// it marks the question answered. answeredIso is the gate key that makes
// conductor_answer legal; if the question were marked answered FIRST and a crash hit
// before the clear, an item would be wedged blocked on an already-answered question
// with no legal tool left to finish the clear (§2.11 line 998 forbids hand-editing to
// resume). Clearing first + marking last makes a retry idempotent.
// ---------------------------------------------------------------------------

test("[4.1-questions] F1: answerQuestion clears items BEFORE marking answered — a crash between leaves the question OPEN and a retry completes it idempotently", () => {
  const runDir = mkRunDir();

  const blocking = appendQuestion(runDir, baseQuestion({ question: "blocking?", blocksItems: ["I2"] }), NOW); // Q-0001
  writeItem(
    runDir,
    makeItem("I2", { state: "RED", blocked: { reason: "needs answer", sinceMs: NOW, questionId: blocking.id, stage: "RED" } }),
  );

  // Simulate a crash AFTER the items are cleared and BEFORE the question is marked
  // answered: the injected hook fires between the two phases and throws.
  assert.throws(
    () =>
      answerQuestion(runDir, blocking.id, "collect and report all", "tool", NOW, {
        onAfterItemsBeforeMark: () => {
          throw new Error("boom: crash between clearing items and marking answered");
        },
      }),
    /boom/,
    "the injected mid-commit throw propagates",
  );

  // (a) the item was cleared BEFORE the (failed) mark — the clear is already durable.
  assert.equal(readItem(runDir, "I2").blocked, null, "the blocked item is cleared before the question is marked answered");
  // (b) the question is STILL OPEN — no answered gate key was written on the partial commit.
  const afterCrash = readQuestions(runDir).find((q) => q.id === blocking.id);
  assert.equal(afterCrash?.answeredIso, null, "a crash before the mark leaves the question OPEN (answeredIso stays null)");
  assert.equal(afterCrash?.answer, null, "the answer is not persisted on the partial commit");

  // (c) a retry completes the answer idempotently: the already-cleared item is skipped
  // by the item.blocked guard (cleared nothing), and the question is now answered.
  const res = answerQuestion(runDir, blocking.id, "collect and report all", "tool", NOW);
  assert.deepEqual(res.clearedItemIds, [], "the retry re-clears nothing (the item was already unblocked) — idempotent");
  assert.equal(res.question.answer, "collect and report all", "the retry records the answer on the returned record");
  assert.notEqual(res.question.answeredIso, null, "the retry stamps answeredIso");
  const finalQ = readQuestions(runDir).find((q) => q.id === blocking.id);
  assert.notEqual(finalQ?.answeredIso, null, "the question is answered on disk after the retry");
  assert.equal(finalQ?.answer, "collect and report all", "the answered record persists the answer");
  assert.equal(readItem(runDir, "I2").blocked, null, "the item remains unblocked after the retry");
});

// ---------------------------------------------------------------------------
// F3 (minor): the atomic writer must not follow a pre-planted symlink at its temp
// path. The OLD writer used a PREDICTABLE temp name (questions.jsonl.<pid>.<counter>.tmp)
// and a plain writeFileSync, so a symlink planted at that name would be written
// THROUGH — clobbering a target outside the sandbox. The fix gives the temp a random
// suffix AND creates it with {flag:"wx"} (exclusive create) so a pre-existing entry
// makes the write fail rather than follow.
// ---------------------------------------------------------------------------

test("[4.1-questions] F3: the atomic writer does not follow a pre-planted symlink at its temp path (random suffix + exclusive create)", () => {
  const runDir = mkRunDir();
  const victim = path.join(runDir, "victim.txt");
  const ORIGINAL = "SECRET-DO-NOT-OVERWRITE\n";
  writeFileSync(victim, ORIGINAL);

  // Pre-plant a symlink at EVERY temp name the old predictable scheme could produce for
  // the next write (the module-global counter is provably far below this bound — the
  // whole file executes well under a dozen atomic writes before this test), each
  // pointing at the victim. The old writer would writeFileSync through the matching one
  // and truncate the victim; the fix never uses a predictable name and never writes
  // through a pre-existing entry.
  for (let n = 0; n < 256; n += 1) {
    symlinkSync(victim, path.join(runDir, `questions.jsonl.${process.pid}.${n}.tmp`));
  }

  const q = appendQuestion(runDir, baseQuestion({ question: "safe write?" }), NOW);
  assert.equal(q.id, "Q-0001", "the write still succeeds to the real ledger");

  assert.equal(
    readFileSync(victim, "utf8"),
    ORIGINAL,
    "a pre-planted symlink at the temp path is NOT followed — the victim is byte-for-byte untouched",
  );
  assert.deepEqual(
    readQuestions(runDir).map((r) => r.id),
    ["Q-0001"],
    "the ledger lands as a real file at its true path",
  );
});
