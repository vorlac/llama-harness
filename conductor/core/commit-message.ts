// The §3.3 step-5 commit-message template. PURE: no git, no clock, no I/O, no
// sub-session. A commit message is a RECORD, not a judgment, so nothing here may
// dispatch or ask — the handler asserts exactly that by counting sub-session
// calls across a whole publish (zero).
//
// The template's one hard obligation is that conductor NEVER signs someone else's
// name to a commit. §3.3 names four tokens that may not appear in a trailer
// position, and the difficulty is that the text being embedded — an item's title
// and rationale, and a red test's failure excerpt — is MODEL-AUTHORED and may
// contain anything, including those very tokens. So the denylist is enforced
// twice, deliberately: the generator NEUTRALIZES (here), and the handler REFUSES
// (adapter/tools.ts) even a message handed to it through the injectable seam.
// Defense in depth, because the generator can be replaced and the rule cannot.

import type { QueueItem } from "./types.ts";

// The §3.3 tokens. Canonical casing for display; every comparison below is
// case-insensitive. Widening this list is a spec change, not an edit.
export const TRAILER_DENYLIST: readonly string[] = [
  "Co-Authored-By",
  "Signed-off-by",
  "Generated with",
  "\u{1F916}",
];

// The robot emoji is barred ANYWHERE, not merely in a trailer position: it is a
// tool-attribution mark wherever it sits. The three textual tokens are barred in
// TRAILER POSITION — the start of a line, after optional indentation — which is
// what git itself treats as a trailer and what a reader of `git log` sees as an
// attribution.
const ROBOT = "\u{1F916}";
const TEXT_TOKENS: readonly string[] = TRAILER_DENYLIST.filter((token) => token !== ROBOT);

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TRAILER_AT_LINE_START = new RegExp(
  "^\\s*(?:" + TEXT_TOKENS.map(escapeForRegExp).join("|") + ")",
  "i",
);

/**
 * Does `message` carry a denylisted trailer? True when any line begins (after
 * optional whitespace) with one of the three textual tokens, or when the robot
 * emoji appears anywhere at all.
 *
 * Shared by the generator's own proof obligation and by the handler's refusal, so
 * "what counts as a trailer" is ONE derivation rather than two that can drift.
 */
export function hasDenylistedTrailer(message: string): boolean {
  if (message.includes(ROBOT)) return true;
  return message.split("\n").some((line) => TRAILER_AT_LINE_START.test(line));
}

/**
 * Which denylisted token `message` carries, in the list's canonical casing, or
 * null when it carries none. The handler's denial names it, so an operator reads
 * WHICH rule was broken rather than that some rule was.
 */
export function denylistedTrailerToken(message: string): string | null {
  if (message.includes(ROBOT)) return ROBOT;
  for (const line of message.split("\n")) {
    for (const token of TEXT_TOKENS) {
      if (new RegExp("^\\s*" + escapeForRegExp(token), "i").test(line)) return token;
    }
  }
  return null;
}

// Model-authored text, made safe to embed in a BODY. Two transformations, each
// for a stated reason:
//
//   (1) the robot emoji is deleted outright — there is no position where it is
//       acceptable, so neutralizing it means removing it;
//   (2) every line is quoted with "> ". A quoted line can never sit in a trailer
//       position, because the regex above allows only WHITESPACE before a token
//       and ">" is not whitespace. Quoting uniformly (rather than only the
//       offending lines) means the safety does not depend on the detector and
//       the reader can see at a glance which text conductor wrote and which it
//       is merely reproducing.
//
// "#" is never emitted at the start of a line: git's default cleanup DELETES such
// lines outright, which would silently drop content from the record.
function quoteForBody(text: string): string {
  return text
    .split(ROBOT)
    .join("")
    .split("\n")
    .map((line) => ("> " + line).replace(/\s+$/, ""))
    .join("\n");
}

// The subject is safe by construction: the template's own prefix stands before
// any model text, so an embedded token can never be at line start. Newlines are
// folded because a commit subject is one line by definition.
function foldToSubject(text: string): string {
  return text.split(ROBOT).join("").replace(/\s+/g, " ").trim();
}

// The §2.6 red record the message cites, narrowed to what the template reads. A
// real EvidenceRecord assigns to it structurally, so the template can never be
// handed a paraphrase of a red that did not happen.
export interface RedProof {
  seq: number;
  command: string[];
  failureExcerpt: string;
}

/**
 * Build the §3.3 step-5 commit message for `item`, citing `redProof`.
 *
 * The message NAMES the item and CITES its red by ledger seq. Both are load-
 * bearing: the id makes the commit traceable to the queue entry that authorized
 * it, and the seq makes the TDD claim checkable — a reader can open
 * evidence.jsonl at that seq and see the failure this commit's test once
 * produced. A template cannot invent a seq, which is why the proof is a
 * parameter rather than prose.
 *
 * `redProof` is null for a non-behavioral item, which by §2.4 has no test and
 * therefore no red to cite.
 */
export function buildCommitMessage(item: QueueItem, redProof: RedProof | null): string {
  const subject = "conductor: " + item.id + " " + foldToSubject(item.title);

  const sections: string[] = [subject, ""];

  const rationale = item.rationale.trim();
  if (rationale.length > 0) {
    sections.push("Rationale:", quoteForBody(rationale), "");
  }

  if (redProof === null) {
    sections.push("Red proof: none — this item is non-behavioral (§2.4), so it has no test.");
  } else {
    sections.push("Red proof: evidence seq " + String(redProof.seq));
    sections.push("Command: " + redProof.command.join(" "));
    const excerpt = redProof.failureExcerpt.trim();
    if (excerpt.length > 0) {
      sections.push(quoteForBody(excerpt));
    }
  }

  sections.push("");
  sections.push("Scope: " + item.fileScope.join(", "));

  return sections.join("\n") + "\n";
}
