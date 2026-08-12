// conductor/adapter/questions.ts — Task 4.1 (question-ledger half): the §2.11
// questions.jsonl writer/reader (plan lines 979-998; §2.5 item `blocked` carries
// the questionId that answering must clear, plan lines 758-791).
//
// An ADAPTER (G14): node:fs / node:path only, plus the injected clock and the
// core/types.ts schema validator — no single-runtime API, no shell tag. It owns
// its OWN I/O end to end (its own crash-safe temp+rename writer); it never reaches
// into state.ts's raw ledger appender (G6). Every function takes the RUN DIRECTORY
// (…/.conductor/runs/<runId>/) so it owns both questions.jsonl and the items/ dir
// underneath it.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { validate } from "../core/types.ts";
import type { Item, QuestionOrigin, QuestionRecord } from "../core/types.ts";

export interface NewQuestion {
  runId: string;
  question: string;
  askedBy: { role: string; sessionID: string };
  humanTerritory: boolean;
  origin: QuestionOrigin;
  blocksItems: string[];
}

export interface AnswerResult {
  question: QuestionRecord;
  clearedItemIds: string[];
}

// Monotonic within this process so the temp file used by writeAtomic never
// collides with a still-open sibling. Combined with the pid it is unique on disk.
let tmpCounter = 0;

// The crash-safe write questions.ts owns for itself: a pid-suffixed same-dir temp,
// fully written, then renamed over the target (an interrupted write leaves the old
// file intact rather than a half-written one).
function writeAtomic(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `${path.basename(filePath)}.${process.pid}.${tmpCounter++}.tmp`);
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, filePath);
}

function readTextBomTolerant(filePath: string): string {
  let raw = readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return raw;
}

// The current coalesced view of the ledger: one record per id, in first-seen
// order. answerQuestion rewrites a question's line in place, so the file already
// holds one line per id — the Map coalescing is a defensive belt over that.
function readRecords(runDir: string): QuestionRecord[] {
  const qp = path.join(runDir, "questions.jsonl");
  if (!existsSync(qp)) return [];
  const byId = new Map<string, QuestionRecord>();
  const order: string[] = [];
  for (const line of readTextBomTolerant(qp).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const record = JSON.parse(trimmed) as QuestionRecord;
    if (!byId.has(record.id)) order.push(record.id);
    byId.set(record.id, record);
  }
  return order.map((id) => byId.get(id) as QuestionRecord);
}

function writeRecords(runDir: string, records: QuestionRecord[]): void {
  const data = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
  writeAtomic(path.join(runDir, "questions.jsonl"), data);
}

function assertValidQuestion(record: QuestionRecord): void {
  const result = validate("QuestionRecord", record);
  if (!result.ok) {
    throw new Error("questions: refusing to write an invalid QuestionRecord: " + result.errors.join("; "));
  }
}

// Mint the next id (Q-0001, Q-0002, …) as max-existing-numeric + 1, stamp tsMs
// from the injected clock, set answeredIso/answer null, append one line, and
// return the record.
export function appendQuestion(runDir: string, input: NewQuestion, nowMs?: number): QuestionRecord {
  const records = readRecords(runDir);
  let maxNum = 0;
  for (const record of records) {
    const match = record.id.match(/^Q-(\d+)$/);
    if (match !== null) {
      const value = Number.parseInt(match[1], 10);
      if (value > maxNum) maxNum = value;
    }
  }
  const record: QuestionRecord = {
    id: "Q-" + String(maxNum + 1).padStart(4, "0"),
    tsMs: nowMs ?? Date.now(),
    runId: input.runId,
    question: input.question,
    askedBy: { role: input.askedBy.role, sessionID: input.askedBy.sessionID },
    humanTerritory: input.humanTerritory,
    origin: input.origin,
    blocksItems: [...input.blocksItems],
    answeredIso: null,
    answer: null,
  };
  assertValidQuestion(record);
  writeRecords(runDir, [...records, record]);
  return record;
}

// The current view: one record per id (an answer coalesces onto its question).
export function readQuestions(runDir: string): QuestionRecord[] {
  return readRecords(runDir);
}

// Record the answer (answeredIso + answer) on the question AND clear the `blocked`
// disposition on every item under <runDir>/items/ whose blocked.questionId ===
// questionId, returning which items were cleared. Items that named a DIFFERENT
// question — or none — are left untouched.
export function answerQuestion(
  runDir: string,
  questionId: string,
  answer: string,
  nowMs?: number,
): AnswerResult {
  const records = readRecords(runDir);
  const index = records.findIndex((record) => record.id === questionId);
  if (index === -1) {
    throw new Error(`questions: cannot answer unknown question "${questionId}" in ${runDir}`);
  }
  const ts = nowMs ?? Date.now();
  const answered: QuestionRecord = {
    ...records[index],
    answeredIso: new Date(ts).toISOString(),
    answer,
  };
  assertValidQuestion(answered);
  const nextRecords = records.slice();
  nextRecords[index] = answered;
  writeRecords(runDir, nextRecords);

  const clearedItemIds: string[] = [];
  const itemsDir = path.join(runDir, "items");
  if (existsSync(itemsDir)) {
    for (const name of readdirSync(itemsDir)) {
      if (!name.endsWith(".json")) continue;
      const itemPath = path.join(itemsDir, name);
      const item = JSON.parse(readTextBomTolerant(itemPath)) as Item;
      if (item.blocked !== null && item.blocked.questionId === questionId) {
        item.blocked = null;
        const result = validate("Item", item);
        if (!result.ok) {
          throw new Error("questions: refusing to write an invalid item.json: " + result.errors.join("; "));
        }
        writeAtomic(itemPath, JSON.stringify(item));
        clearedItemIds.push(item.id);
      }
    }
  }
  clearedItemIds.sort();
  return { question: answered, clearedItemIds };
}
