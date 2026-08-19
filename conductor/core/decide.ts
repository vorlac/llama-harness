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
  // A subscription is human territory when the question is about PAYING for one:
  // the bare noun is also the pub/sub vocabulary ("the subscription handler"),
  // and classifying that as human territory stalls a run on a question the model
  // owns. So the money half must be present — the commercial verb, or a price
  // word — within the same clause.
  /\b(?:cancel|cancelling|canceling|renew|renewing|buy|purchase|pay\s+for|paying\s+for)\b[^.?!\n]{0,40}\bsubscriptions?\b/i,
  /\bsubscriptions?\b[^.?!\n]{0,40}\b(?:cost|costs|price|fee|fees|billing|billed|invoice|renewal)\b/i,
  // -- recurring paid price: a currency amount charged per month, or a monthly
  //    billing cadence named alongside a plan/tier/subscription. A measurable
  //    quota ("requests per second") never mentions money or a month, so it
  //    stays machine territory.
  /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:\/\s*|\s+per\s+)month\b/i,
  /(?:\/\s*month|\bper\s+month\b|\bmonthly\b)[\s\S]*\b(?:plan|tier|subscription)\b/i,
  /\b(?:plan|tier|subscription)\b[\s\S]*(?:\/\s*month|\bper\s+month\b|\bmonthly\b)/i,
  // -- irreversible / publish / delete. The destructive verb must open its
  //    clause or follow a non-path character, so "delete" inside a file path
  //    (src/delete-user.ts) never fires. It must ALSO reach an irreversible
  //    TARGET within a few words: deleting a cache entry, a temp directory or a
  //    stale line is the ordinary work of the run, and treating every occurrence
  //    of the verb as human territory is a stall, not a safeguard. The target
  //    list is the externally-visible, unrecoverable kind of loss.
  /(?:^|[^\w/.-])(?:delete|destroy|erase|wipe|purge)\s+(?:[\w'-]+\s+){0,3}?(?:production|prod|live|customer'?s?|user'?s?|users'|account|accounts|database|databases|db|table|tables|bucket|buckets|volume|volumes|snapshot|snapshots|backup|backups|repo|repository|history|weights|everything)\b/i,
  /\b(?:drop|truncate)\s+(?:the\s+)?(?:table|database|schema|column)\b/i,
  // Publishing is human territory when it leaves the repository: a package
  // pushed to a public index, a release cut for the world. "publish the event
  // to the bus" and "the publisher retries" are message-passing vocabulary and
  // stay machine territory, so a distribution TARGET must be named alongside.
  /\bpublish(?:es|ed|ing)?\b[^.?!\n]{0,60}\b(?:npm|pypi|crates\.io|rubygems|nuget|maven|homebrew|docker\s*hub|app\s*store|marketplace|registry|publicly|website|blog)\b/i,
  /\b(?:npm|pypi|crates\.io|rubygems|nuget|maven|homebrew|docker\s*hub|app\s*store|marketplace|registry)\b[^.?!\n]{0,60}\bpublish(?:es|ed|ing)?\b/i,
  /\bpublish\s+(?:a\s+|an\s+|the\s+|this\s+|our\s+)?(?:release|package|gem|crate|artifact|version|tag)\b/i,
  /\birreversible\b/i,
  /\bcannot\s+be\s+undone\b/i,
  /\bforce[-\s]push\b/i,
  /\bpush\s+(?:--force|-f)\b/i,
  /\bforce-with-lease\b/i,
  // -- secrets / credentials. "secret" alone is also a schema name, a config
  //    key and a directory ("the secrets schema", "secrets/*.json"), so the
  //    word must sit in a shape that HANDLES a credential: a named secret, a
  //    secret's value, or a verb that moves one. The uppercase run catches
  //    env-style names like AWS_SECRET_ACCESS_KEY, where underscores defeat \b.
  /\b(?:client|app|application|api|shared|signing|webhook|deploy|deployment)\s+secrets?\b/i,
  /\bsecrets?\s+(?:key|keys|value|values|token|tokens|string)\b/i,
  /\b(?:rotate|rotating|share|sharing|paste|pasting|provide|supply|reveal|expose|leak|commit|committing|hard-?code|hard-?coding)\s+(?:the\s+|a\s+|an\s+|our\s+|my\s+|your\s+|this\s+|that\s+)?secrets?\b/i,
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
