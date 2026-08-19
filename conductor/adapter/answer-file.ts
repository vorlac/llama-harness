// conductor/adapter/answer-file.ts — GAP-013's out-of-band channel: the operator
// drops one file, the harness ingests it.
//
// WHY A FILE. Every conductor_* tool is reachable by the model, so no tool call
// can prove a human spoke (ISSUE-051: "the human-in-the-loop can be fully
// simulated"). The `.conductor` state area is the place the gates defend hardest:
// core/gates-edit.ts denies `.conductor/**` to every session, orchestrator
// included, matched on the tree-normalized path so no scope widens it, and the
// bash gate refuses outright any interpreter one-liner that names the state area.
// One `echo >` by the operator is the whole protocol.
//
// WHAT THAT DOES AND DOES NOT ESTABLISH. The channel is exactly as strong as that
// bash write gate, whose write-shape recognition is an ENUMERATION — it catches
// the shapes it knows and is measured, not proven, against the ones it does not
// (core/provenance.ts states the same boundary at the rule itself; GAP-025's flip
// is the work that would close it). So a file here is evidence that no session
// took a known write route to it, which is the strongest signal the harness has
// and is deliberately not described as more than that.
//
// An ADAPTER (G14): node:fs / node:path only. The path derivation and the
// provenance rule live in core/provenance.ts; this file reads and lists.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

import { ANSWERS_DIRNAME, answerFileNameOf } from "../core/provenance.ts";

export interface PendingAnswer {
  questionId: string;
  answer: string;
}

/** The absolute path of one question's answer file under the run directory. */
export function answerFileAbsPath(runDir: string, questionId: string): string {
  return path.join(runDir, ANSWERS_DIRNAME, answerFileNameOf(questionId));
}

/**
 * The answer the operator wrote, or null when there is nothing to read.
 *
 * NULL, not "", for an empty or whitespace-only file (G5, fail closed): a
 * zero-length file is what a stray `touch`, an interrupted redirect or a
 * half-finished paste leaves behind, and releasing a blocked item on one would
 * make the strongest channel in the system the easiest to trip by accident. An
 * unreadable file is null for the same reason — the question stays open and the
 * operator's next write is still waiting to be found.
 *
 * The body is used as written apart from a BOM and surrounding whitespace: an
 * answer is prose, and reformatting a human's words is not this reader's job.
 */
export function readAnswerFile(runDir: string, questionId: string): string | null {
  const file = answerFileAbsPath(runDir, questionId);
  if (!existsSync(file)) return null;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const body = raw.trim();
  return body.length === 0 ? null : body;
}

/**
 * Every open question that has an answer waiting on disk, in the order the ids
 * were handed in. Keyed on the OPEN set the caller supplies rather than on a
 * directory scan: an already-answered question's file is spent, and re-reading it
 * would let a file left on disk overwrite the answer that already cleared the
 * block.
 */
export function pendingAnswers(runDir: string, openQuestionIds: readonly string[]): PendingAnswer[] {
  const found: PendingAnswer[] = [];
  for (const questionId of openQuestionIds) {
    const answer = readAnswerFile(runDir, questionId);
    if (answer !== null) found.push({ questionId, answer });
  }
  return found;
}

/**
 * The answer files present under the run dir, by question id. Read-only, for
 * surfaces that report what the operator has dropped; the ingest path uses
 * pendingAnswers, which cannot be fooled by a file for a question this run does
 * not have.
 */
export function answerFilesOnDisk(runDir: string): string[] {
  const dir = path.join(runDir, ANSWERS_DIRNAME);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .sort();
}
