// conductor/core/decide.ts — §6.2 decision-protocol helpers (Task 1.5; plan
// lines 2144-2157, 1851-1879, 852-874). Core module: pure.
//
// scoreOptions      — sums the five §2.7 ladder-5 score keys per option; a
//                     strictly greater total wins, a shared top total ties.
// isHumanTerritory  — conservative keyword/shape classifier for the §6.2
//                     human-territory categories, exported for the ask-gate
//                     (Task 10.1) and `conductor_decide`.
// requireTwoOptions — Task 9.1's rejection rule: a kind:"derived" record
//                     needs >=2 options, each scored; kind:"human" is exempt
//                     (§2.7: taste has no objective score).

import type { DecisionRecord } from "./types.ts";

export type DecisionOption = DecisionRecord["options"][number];
type OptionScore = NonNullable<DecisionOption["score"]>;

// The five §2.7 score keys (plan lines 858-859).
const SCORE_KEYS = [
  "capability",
  "testability",
  "movingParts",
  "validationEarliness",
  "singleSource",
] as const;

function totalOf(score: OptionScore): number {
  let total = 0;
  for (const key of SCORE_KEYS) {
    total += score[key];
  }
  return total;
}

/**
 * Sum each option's five §2.7 keys; the strictly greatest total wins
 * automatically (§6.2 ladder 5 — effort is never a tiebreaker). A shared top
 * total is a genuine tie: {winner: null, tie: true}, which on a consequential
 * choice is itself human territory. An option with no score totals 0
 * (requireTwoOptions is the gate that rejects unscored derived records).
 */
export function scoreOptions(
  options: readonly DecisionOption[]
): { winner: string | null; tie: boolean } {
  let best = Number.NEGATIVE_INFINITY;
  let winner: string | null = null;
  let tie = false;
  for (const option of options) {
    const total = option.score === undefined ? 0 : totalOf(option.score);
    if (total > best) {
      best = total;
      winner = option.name;
      tie = false;
    } else if (total === best) {
      winner = null;
      tie = true;
    }
  }
  return { winner, tie };
}

// §6.2 human territory — the only legal asks: taste/aesthetics; money/paid
// services; irreversible externally-visible commitments (publish/delete);
// secrets/credentials. Word-boundary PHRASE patterns, not bare topic nouns:
// derivable technical questions (the §6.2 never-ask list) must stay machine
// territory, so each pattern pins a shape only a human-territory question has.
const HUMAN_PATTERNS: readonly RegExp[] = [
  // -- taste / aesthetics: preference or appearance-comparison shapes.
  /\blooks?\s+(?:better|best|nicer|nice|good|right)\b/i,
  /\byou\s+prefer\b/i,
  /\baesthetics?\b/i,
  /\blook\s+and\s+feel\b/i,
  /\bcolou?r\s+scheme\b/i,
  // -- money / paid services: spending shapes, never bare "cost"/"budget"
  //    (measurable budgets are objective law, ladder 4 — machine territory).
  /\bbuy\b/i,
  /\bpurchase\b/i,
  /\bspend(?:ing)?\s+money\b/i,
  /\bcosts?\s+money\b/i,
  /\bpay(?:ing)?\s+for\b/i,
  /\bpaid\s+(?:tier|plan|service|account|subscription)\b/i,
  /\bsubscription\b/i,
  // -- irreversible / publish / delete. The destructive verb must open its
  //    clause or follow a non-path character AND be followed by whitespace and
  //    a word, so "delete" inside a file path (src/delete-user.ts) never
  //    fires while "delete the production data" does.
  /(?:^|[^\w/.-])(?:delete|destroy|erase|wipe)\s+[A-Za-z]/i,
  /\bdrop\s+(?:the\s+)?(?:table|database|schema|column)\b/i,
  /\bpublish/i,
  /\birreversible\b/i,
  /\bcannot\s+be\s+undone\b/i,
  /\bforce[-\s]push\b/i,
  // -- secrets / credentials. The bare-word forms bound both sides (so
  //    "secretary" never fires); the uppercase run catches env-style names
  //    like AWS_SECRET_ACCESS_KEY, where underscores defeat \b.
  /\bsecrets?\b/i,
  /\bcredentials?\b/i,
  /\bpasswords?\b/i,
  /\bpassphrase\b/i,
  /\bapi[-_\s]?key\b/i,
  /SECRET|ACCESS_KEY|PASSWORD/,
];

/**
 * True iff the question falls in §6.2 human territory. Conservative: only the
 * four categories' phrase shapes return true; everything else — including
 * every derivable technical question — returns false. (Per §6.2 the ask-gate,
 * not this classifier, owns failing toward surfacing at run boundaries.)
 */
export function isHumanTerritory(question: string): boolean {
  return HUMAN_PATTERNS.some((pattern) => pattern.test(question));
}

/**
 * §2.7 multi-option requirement (Task 9.1's rejection rule): a kind:"derived"
 * decision records >=2 real options, each scored on the ladder-5 criteria.
 * kind:"human" records are exempt from scoring — options may omit numeric
 * scores only for human questions (taste has no objective score).
 */
export function requireTwoOptions(record: DecisionRecord): { ok: boolean; why: string } {
  if (record.kind === "human") {
    return {
      ok: true,
      why: 'kind "human" is exempt from scoring: options may omit numeric scores only for human questions (§2.7)',
    };
  }
  if (record.options.length < 2) {
    return {
      ok: false,
      why:
        "derived decision needs at least 2 real options (§2.7); got " +
        String(record.options.length) +
        " option(s)",
    };
  }
  const unscored = record.options.filter((option) => option.score === undefined);
  if (unscored.length > 0) {
    return {
      ok: false,
      why:
        "derived decision needs a ladder-5 score on every option (§2.7); unscored: " +
        unscored.map((option) => option.name).join(", "),
    };
  }
  return {
    ok: true,
    why: "derived decision records " + String(record.options.length) + " scored options (§2.7)",
  };
}
