// conductor/core/reply-protocol.ts — GAP-040: the reply protocols get NAMES, and
// the pushback matcher gets EXACT tokens. Core module (G3): pure.
//
// Two defects, one vocabulary. (1) NEEDS_CONTEXT and DONE_WITH_CONCERNS existed
// only inside dispatch prompt literals: no doctrine pack named either, so
// receive-review.md told a fixer to "refute with evidence" while naming no channel
// to refute ON. (2) The handler matched a pushback with `concern.includes(id)`, so
// a concern about F10 was adjudicated as a pushback on F1 (ISSUE-049) — the
// substring defect, which mis-adjudicates exactly the doctrine-following fixer who
// writes a careful, loosely-worded concern.
//
// Both halves are single-sourced here: the statuses are the schema's own enum, and
// the concern token the doctrine teaches is the token the matcher parses.

import { IMPLEMENTER_STATUSES } from "./types.ts";
import type { ImplementerStatus } from "./types.ts";

// The exact prefix a concern uses to name the finding it answers.
export const CONCERN_PREFIX = "finding:";

/** The canonical concern token for a finding id: `finding:<id>`. */
export function concernToken(id: string): string {
  return CONCERN_PREFIX + id;
}

// What each reply status commits the replying session to. Keyed by the SCHEMA's
// enum, so a status added to core/types.ts with no meaning here fails the render
// rather than shipping a protocol the doctrine does not describe.
const STATUS_MEANINGS: Readonly<Record<string, string>> = {
  DONE: "the fix is implemented — the harness diffs the tree and refuses a receipt that touched no file the finding names",
  DONE_WITH_CONCERNS:
    "you are pushing back — every concerns[] entry names its finding as `finding:<id>` and carries your reasoning, and the handler routes that reasoning through one more skeptic round",
  NEEDS_CONTEXT: "you cannot proceed without something you were not given — name exactly what, in neededContext",
  BLOCKED: "the work cannot be done in this scope at all — name the blocker in blockReason",
};

export interface ReplyProtocol {
  status: ImplementerStatus;
  meaning: string;
}

/** The reply protocols, derived from the schema enum they must stay closed over. */
export function replyProtocols(): ReplyProtocol[] {
  return IMPLEMENTER_STATUSES.map((status) => {
    const meaning = STATUS_MEANINGS[status];
    if (meaning === undefined) {
      throw new Error(
        `conductor: reply status "${status}" has no protocol description — add it to STATUS_MEANINGS in ` +
          "core/reply-protocol.ts (a status the doctrine cannot name is a channel nobody can use)",
      );
    }
    return { status, meaning };
  });
}

/** The generated-mechanics paragraph naming the statuses and the concern format. */
export function renderReplyProtocol(): string {
  const lines = ["Reply statuses, and what each one commits you to:"];
  for (const protocol of replyProtocols()) {
    lines.push("- " + protocol.status + ": " + protocol.meaning + ".");
  }
  lines.push(
    "A concern that names no finding as `finding:<id>` is not a pushback: it is read as agreement, " +
      "and the receipt still has to show the fix in the tree.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exact-token matching
// ---------------------------------------------------------------------------

// The characters an id token may carry. Namespaced ids ("<sessionID>:<id>") keep
// the colon, so the token after the `finding:` prefix reads back whole.
const TOKEN_CHARS = /[A-Za-z0-9_.:/#@-]+/g;
const TRAILING_PUNCTUATION = /[.,;:)\]}'"]+$/;
const LEADING_PUNCTUATION = /^[(\['"]+/;

function tokensOf(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.match(TOKEN_CHARS) ?? []) {
    let token = raw.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "");
    if (token.length === 0) continue;
    tokens.push(token);
    if (token.startsWith(CONCERN_PREFIX)) {
      const bare = token.slice(CONCERN_PREFIX.length).replace(TRAILING_PUNCTUATION, "");
      if (bare.length > 0) tokens.push(bare);
    }
  }
  return tokens;
}

/**
 * Does this concern line name one of these finding identifiers? EXACT token
 * equality — the canonical `finding:<id>` form or the bare id standing alone —
 * never substring containment, which is how F10 matched F1 and a real pushback
 * landed on the wrong finding.
 */
export function concernNamesFinding(concern: string, names: readonly string[]): boolean {
  const tokens = tokensOf(concern);
  return names.some((name) => name.length > 0 && tokens.includes(name));
}
