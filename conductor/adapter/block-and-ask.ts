// conductor/adapter/block-and-ask.ts — GAP-028: THE transactional block-and-ask.
//
// An ADAPTER (G14): node:fs / node:path plus the question ledger, the state store
// and an injected clock. No single-runtime API, no shell tag, no subprocess.
//
// A stuck stage owes TWO durable writes: a §2.11 question, and the §2.5 `blocked`
// disposition that points the item at it. They live in different files, so a kill
// between them leaves the pair half-applied — an OPEN question naming an item that
// carries no disposition. The stage gate then offers the same tool again on an item
// nothing says is blocked, and answering the question clears nothing, because
// `blocked` is what conductor_answer keys on. Every stuck site rebuilt that pair by
// hand, which is how one class ended up with seven implementations, two of them
// hardened (C-032 E7 / ISSUE-100).
//
// The transaction here is the temp+rename idiom applied to the PAIR rather than to
// either file: an INTENT naming the whole ask is committed atomically FIRST, both
// halves are then written, and the intent is dropped only once they are both on
// disk. A crash at any point therefore leaves either nothing, or a record that says
// exactly what was owed — and the next open completes it. Nothing is inferred from
// file order or timestamps.
//
// The repair has two layers, because an ask can predate its own intent:
//   replayBlockIntents        — completes what an intent says was owed;
//   reconcileOrphanQuestions  — completes an open question naming an undisposed
//                               item at ANY origin, for the asks minted before the
//                               primitive existed and for a crash before the intent
//                               landed.
// Both respect the item's own `releasedQuestions` history: "open question,
// unblocked item" is ALSO what a legal release (conductor_queue_amend) looks like,
// and repairing without that separator would re-block every amended item forever.

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { appendQuestion, readQuestions } from "./questions.ts";
import type { NewQuestion } from "./questions.ts";
import { readJsonFileSync, writeFileAtomicSync } from "./state.ts";
import type { StateStore } from "./state.ts";
import type { Item, LogLevel, QuestionRecord } from "../core/types.ts";

// The journal surface this module needs: adapter/journal.ts's Journal and the
// workspace-level StateJournal both satisfy it.
export interface BlockJournal {
  log: (
    level: LogLevel,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId: string; itemId?: string; sessionID?: string },
  ) => void;
}

const INTENTS_DIR = "block-intents";

// The durable record of an ask in flight. It carries the ENTIRE input, so replay
// re-runs the same transaction rather than guessing at half of it from the ledger.
export interface BlockIntent {
  itemIds: string[];
  question: NewQuestion;
  reason: string;
  stage: string;
  reuseOpen: boolean;
  tsMs: number;
  /** The file this intent was read from, so a completed replay can drop it. */
  file: string;
}

export interface BlockAndAskInput {
  store: StateStore;
  runId: string;
  runDir: string;
  /** The items this ask blocks; the first is the one the reuse check keys on. */
  itemIds: string[];
  question: NewQuestion;
  /** The §2.5 `blocked.reason` recorded on each item. */
  reason: string;
  /** The §2.5 `blocked.stage` recorded on each item. */
  stage: string;
  journal: BlockJournal;
  now: () => number;
  /**
   * Reuse an already-OPEN question of the same origin naming the first item
   * instead of minting a second one (default true). There can only be one useful
   * ask per stuck item — §2.5 gives the item ONE disposition — so a second
   * question would be unanswerable-by-construction while the first still gates it.
   * A site that deliberately raises one question per FINDING (the plan-review cap)
   * passes false.
   */
  reuseOpen?: boolean;
  /** Extra fields the journal record for the disposition carries. */
  journalData?: Record<string, unknown>;
  /** Test seam: fires after the intent is committed, before either half. */
  onAfterIntent?: () => void;
  /** Test seam: fires after the question is appended, before the disposition. */
  onAfterQuestion?: () => void;
}

export interface BlockAndAskResult {
  question: QuestionRecord;
  /** True when an already-open question was adopted rather than a fresh mint. */
  reused: boolean;
  /** The items this call actually put a disposition on. */
  blockedItemIds: string[];
  /** The items as they stand after the call, in itemIds order. */
  items: Item[];
}

function intentsDirOf(runDir: string): string {
  return path.join(runDir, INTENTS_DIR);
}

/** Every block-and-ask this run left in flight (an empty list is the healthy case). */
export function pendingBlockIntents(runDir: string): BlockIntent[] {
  const dir = intentsDirOf(runDir);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const intents: BlockIntent[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let parsed: unknown;
    try {
      parsed = readJsonFileSync(file);
    } catch {
      // A torn intent names nothing we can safely complete. The orphan reconciler
      // is the layer that still repairs that case, from the ledger itself.
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Partial<BlockIntent>;
    if (!Array.isArray(record.itemIds) || record.question === undefined) continue;
    intents.push({
      itemIds: record.itemIds,
      question: record.question,
      reason: typeof record.reason === "string" ? record.reason : "",
      stage: typeof record.stage === "string" ? record.stage : "",
      reuseOpen: record.reuseOpen !== false,
      tsMs: typeof record.tsMs === "number" ? record.tsMs : 0,
      file,
    });
  }
  return intents;
}

// The open question of this origin that already names `itemId`, if any.
function openQuestionFor(runDir: string, origin: string, itemId: string): QuestionRecord | null {
  let existing: QuestionRecord[] = [];
  try {
    existing = readQuestions(runDir);
  } catch {
    return null;
  }
  for (const candidate of existing) {
    if (candidate.answeredIso !== null) continue;
    if (candidate.origin !== origin) continue;
    if (!candidate.blocksItems.includes(itemId)) continue;
    return candidate;
  }
  return null;
}

// Set the disposition on each named item that does not already carry one. An item
// has ONE `blocked`, so the FIRST question that names it owns the block; a later
// ask still records the item in its own blocksItems, which is what the ask says.
// An item whose file is missing is skipped rather than fatal: the ask stands, and
// the run's report names the question either way.
function applyBlocks(
  input: { store: StateStore; runId: string; itemIds: string[]; reason: string; stage: string },
  questionId: string,
  journal: BlockJournal,
  journalData: Record<string, unknown>,
): { blockedItemIds: string[]; items: Item[] } {
  const blockedItemIds: string[] = [];
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const itemId of input.itemIds) {
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    let current: Item;
    try {
      current = input.store.loadItem(input.runId, itemId);
    } catch {
      continue;
    }
    if (current.blocked !== null) {
      items.push(current);
      continue;
    }
    const blocked = input.store.setBlocked(input.runId, itemId, {
      reason: input.reason,
      stage: input.stage,
      questionId,
    });
    items.push(blocked);
    blockedItemIds.push(itemId);
    journal.log(
      "info",
      "state",
      "item.updated",
      { itemId, blocked: true, questionId, stage: input.stage, ...journalData },
      { runId: input.runId, itemId },
    );
  }
  return { blockedItemIds, items };
}

/**
 * Raise ONE §2.11 question and put the items it names into `blocked`, as one
 * crash-safe unit. The intent is committed first (temp+rename), so a kill anywhere
 * after it leaves a record the next open completes; it is removed only once both
 * halves stand.
 */
export function blockItemWithQuestion(input: BlockAndAskInput): BlockAndAskResult {
  const reuseOpen = input.reuseOpen !== false;
  const intentsDir = intentsDirOf(input.runDir);
  mkdirSync(intentsDir, { recursive: true });
  const intentFile = path.join(
    intentsDir,
    `${String(input.now())}-${randomBytes(4).toString("hex")}.json`,
  );
  const intent: Omit<BlockIntent, "file"> = {
    itemIds: [...input.itemIds],
    question: input.question,
    reason: input.reason,
    stage: input.stage,
    reuseOpen,
    tsMs: input.now(),
  };
  writeFileAtomicSync(intentFile, JSON.stringify(intent, null, 2));
  if (input.onAfterIntent !== undefined) input.onAfterIntent();

  const result = completeAsk(
    { store: input.store, runId: input.runId, runDir: input.runDir, journal: input.journal },
    { ...intent, file: intentFile },
    input.now,
    input.journalData ?? {},
    input.onAfterQuestion,
  );

  rmSync(intentFile, { force: true });
  return result;
}

// The body BOTH the first attempt and the replay run: adopt-or-append the question,
// then apply the dispositions. Idempotent by construction — a question that already
// stands is adopted, and an item that already carries a disposition is left alone.
function completeAsk(
  ctx: { store: StateStore; runId: string; runDir: string; journal: BlockJournal },
  intent: BlockIntent,
  now: () => number,
  journalData: Record<string, unknown>,
  onAfterQuestion?: () => void,
): BlockAndAskResult {
  const first = intent.itemIds.length > 0 ? intent.itemIds[0] : "";
  const existing =
    intent.reuseOpen && first.length > 0
      ? openQuestionFor(ctx.runDir, intent.question.origin, first)
      : null;
  const question = existing ?? appendQuestion(ctx.runDir, intent.question, now());
  if (existing === null) {
    ctx.journal.log(
      "info",
      "state",
      "question.surfaced",
      {
        questionId: question.id,
        origin: intent.question.origin,
        blocksItems: [...intent.itemIds],
        humanTerritory: question.humanTerritory,
      },
      { runId: ctx.runId, ...(first.length > 0 ? { itemId: first } : {}) },
    );
  }
  if (onAfterQuestion !== undefined) onAfterQuestion();

  const applied = applyBlocks(
    {
      store: ctx.store,
      runId: ctx.runId,
      itemIds: intent.itemIds,
      reason: intent.reason,
      stage: intent.stage,
    },
    question.id,
    ctx.journal,
    journalData,
  );
  return { question, reused: existing !== null, ...applied };
}

export interface ReplayInput {
  store: StateStore;
  runId: string;
  runDir: string;
  journal: BlockJournal;
  now: () => number;
}

/**
 * Complete every block-and-ask this run left in flight, and drop its intent.
 *
 * Returns the item ids a disposition was actually written for — an empty list is
 * both "nothing crashed" and "the crash's work was already whole", which are the
 * same fact to every caller.
 */
export function replayBlockIntents(input: ReplayInput): string[] {
  const completed: string[] = [];
  for (const intent of pendingBlockIntents(input.runDir)) {
    try {
      const result = completeAsk(
        { store: input.store, runId: input.runId, runDir: input.runDir, journal: input.journal },
        intent,
        input.now,
        { reconciled: true },
      );
      for (const itemId of result.blockedItemIds) completed.push(itemId);
    } catch {
      // One unrepairable intent must never wedge the rest of the sweep; the
      // orphan reconciler below is the second layer over exactly this case.
      continue;
    }
    rmSync(intent.file, { force: true });
  }
  return completed;
}

/**
 * The ledger-side repair: for every OPEN question naming an item that carries no
 * disposition, write the disposition the ask owed.
 *
 * EVERY origin is repaired (ISSUE-100). Filtering by origin left the cap,
 * scope-conflict and plan-review asks un-reconciled — the crash window is a
 * property of the two-write shape, not of who raised the ask.
 *
 * THE RELEASE TEST: an item whose `releasedQuestions` names this question was
 * legally released (conductor_queue_amend clears `blocked` and leaves the question
 * open). Re-blocking it would kill the documented escape hatch permanently, so the
 * item's own durable release history — written by store.clearBlocked at the one
 * moment the item still knows which question it was freed from — is what separates
 * a release from a half-applied ask. No file timestamp can do that job: one mtime
 * covers every question in the run, and a replay, a restore or a copy destroys it.
 */
export function reconcileOrphanQuestions(
  store: StateStore,
  runId: string,
  runDir: string,
  journal: BlockJournal,
): void {
  let questions: QuestionRecord[];
  try {
    questions = readQuestions(runDir);
  } catch {
    return;
  }
  for (const question of questions) {
    if (question.answeredIso !== null) continue;
    for (const itemId of question.blocksItems) {
      let item: Item;
      try {
        item = store.loadItem(runId, itemId);
      } catch {
        continue;
      }
      if (item.blocked !== null) continue;
      if ((item.releasedQuestions ?? []).includes(question.id)) continue;
      store.setBlocked(runId, itemId, {
        reason:
          "completing a half-applied block: open question " +
          question.id +
          " names this item but the item carried no disposition (§2.11, C-032 E7)",
        stage: item.state,
        questionId: question.id,
      });
      journal.log(
        "info",
        "state",
        "item.updated",
        { itemId, blocked: true, questionId: question.id, reconciled: true },
        { runId, itemId },
      );
    }
  }
}
