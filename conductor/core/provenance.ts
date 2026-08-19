// conductor/core/provenance.ts — GAP-013 / ISSUE-052: the ONE place that says
// which artifacts carry a human's authority and where the human writes them.
//
// THE PROBLEM THIS ANSWERS. Two records claimed a human had spoken when none had:
// `conductor_answer` cleared any block with any string and left nothing saying
// where the string came from (ISSUE-051), and `conductor_defer` stamped
// kind:"human" on every model deferral (ISSUE-052) — one file over from the
// C-044 ruling that a tool-call decision "was not asked of a human, so kind is
// always derived". A weak local orchestrator could therefore mint human
// authority at will, and the report showed neither forgery.
//
// THE RULE, stated once: human provenance is DERIVED FROM AN ARTIFACT, never
// claimed by a caller. The artifact is a file under the `.conductor` state area,
// which core/gates-edit.ts denies to EVERY session, orchestrator included. No
// artifact, no human kind.
//
// HOW STRONG THAT IS, stated honestly. The channel is exactly as strong as the
// bash write gate that stands in front of the state area — no stronger. That gate
// is an ENUMERATION of write shapes (redirects, tee, sed -i, mv/cp destinations,
// and the interpreter one-liners core/gates-edit.ts recognizes), plus one
// fail-closed rule: any interpreter program that so much as names `.conductor` is
// refused outright, path operand or not. An enumeration is a measured posture, not
// a proof — a write shape nobody has enumerated is a write nobody gates — and a
// §3.6 override can still spend budget to bypass an edit deny. The claim this file
// is entitled to make is therefore "a gated session cannot write here through any
// shape the gate knows", and the gap between that and "cannot write here" is what
// GAP-025's enumeration flip is for. Until then, read a `human-file` record as: no
// session took a KNOWN write route to this artifact.
//
// Core module (G3): pure predicates and pure path derivation — no I/O, no clock.
// The reading and writing live in adapter/answer-file.ts.

import type { AnswerChannel, DecisionKind } from "./types.ts";

// The directory under the run dir that holds one answer file per question. Named
// here so the deny rule, the printed instruction and the reader cannot drift.
export const ANSWERS_DIRNAME = "answers";

// The §2.11 question id shape (adapter/questions.ts mints Q-0001, Q-0002, …).
// A path is only ever derived from an id that matches: an id is a model-visible
// string, and joining an arbitrary one into a path is how a reader is talked into
// reading something else.
const QUESTION_ID = /^Q-\d+$/;

/**
 * True only for the channel that rests on the state-area artifact. Every caller
 * that asks "may this record say a human decided?" asks it HERE — the question is
 * one predicate precisely so a second, laxer reading cannot appear beside it.
 */
export function isHumanProvenance(via: AnswerChannel | null): boolean {
  return via === "human-file";
}

/** The answer file's name, refusing any id that is not a §2.11 question id. */
export function answerFileNameOf(questionId: string): string {
  if (!QUESTION_ID.test(questionId)) {
    throw new Error(
      `provenance: "${questionId}" is not a §2.11 question id (Q-0001, Q-0002, …); refusing to derive a path from it`,
    );
  }
  return questionId + ".md";
}

/**
 * The repo-relative path the operator drops the answer at, for the ONE question.
 * Printed by conductor_surface and conductor_status so the human is told exactly
 * where to write, and read back by adapter/answer-file.ts from the same
 * derivation.
 */
export function answerDropPath(runId: string, questionId: string): string {
  return [".conductor", "runs", runId, ANSWERS_DIRNAME, answerFileNameOf(questionId)].join("/");
}

/**
 * The §2.7 decision kind a deferral may carry, derived from the answer that
 * authorizes it. `null` — the ordinary model-initiated deferral — is "derived",
 * and so is a deferral pointed at an answer that itself came through the tool.
 * Only a human-file answer mints "human".
 */
export function deferDecisionKind(authorizingAnswer: { answeredVia: AnswerChannel | null } | null): DecisionKind {
  return authorizingAnswer !== null && isHumanProvenance(authorizingAnswer.answeredVia) ? "human" : "derived";
}

// The three fields of a §2.11 question record this rule reads. Structural rather
// than the whole QuestionRecord so a fixture and a ledger line both assign.
export interface AnsweredQuestionView {
  humanTerritory: boolean;
  answeredIso: string | null;
  answeredVia: AnswerChannel | null;
}

/**
 * Does this answered question still owe the operator's own word?
 *
 * The defect: a run that stopped `blocked`/`surfaced` waiting on a §6.2 human
 * question was revived by ANY answer, and conductor_answer's channel is pinned to
 * `tool` — so the orchestrator that raised the question could answer it itself and
 * un-stop its own run. The escalation the stop exists to force became a two-call
 * formality, and nothing in the run said a human had never spoken.
 *
 * The rule: a human-territory question is released by the human-file artifact and
 * by nothing else. A question OUTSIDE human territory is machine territory by the
 * §6.2 classifier's own verdict, and a relayed answer settles it as it always did
 * — the fix narrows the hatch to exactly the questions §6.2 says are not the
 * model's to close.
 *
 * Two consumers, one predicate: the revival gate, and the report line that tells
 * the operator a question is answered but still standing.
 */
export function awaitsOperatorConfirmation(question: AnsweredQuestionView): boolean {
  if (question.answeredIso === null) return false;
  if (!question.humanTerritory) return false;
  return !isHumanProvenance(question.answeredVia);
}

/**
 * How a channel reads in a report. The tool label states the limit out loud: a
 * relayed answer is evidence of a model's assertion, not of a human's judgment,
 * and a reader who sees only "answered" cannot tell those apart — which is the
 * invisibility ISSUE-051 measured.
 */
export function provenanceLabel(via: AnswerChannel | null): string {
  if (via === "human-file") return "human-file (operator artifact)";
  if (via === "tool") return "tool (model-relayed; no human artifact)";
  return "unanswered";
}
