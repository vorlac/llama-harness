// conductor/core/planning.ts — Task 9.2 (pure half; plan lines 2584-2594). The
// §3.2 DECOMPOSED validation TABLE (plan lines 1096-1110) and the plan.md
// placeholder doctrine (plan lines 1112-1117), as pure decisions.
//
// Core module (G3): pure `(parsedInput, stateSnapshot) -> decision`. No I/O, no
// runtime globals, no wall clock — the decompose/plan HANDLERS in
// adapter/tools.ts own the dispatch, the re-prompt, the persist and the journal;
// this file only says WHAT is wrong and NAMES it. Every §3.2 row is a rejection
// with a named reason, never a warning, so each check contributes a violation
// string the handler can hand straight back to the planner as the re-prompt
// reason (and, after the bounded re-prompt, as the thrown rejection).
//
// The named reasons are load-bearing twice over: they are what the planner is
// re-prompted with, and after the single bounded round they are the thrown
// rejection. So every check here reports EVERY instance it can see in one pass
// (all cycles, every offending item) — a check that reported only its first hit
// would spend the one re-prompt on half the truth and then reject the run for a
// defect the planner was never shown.

import { globMatch, isWildcardHeaded, scopesIntersect } from "./shell-parse.ts";
import type { Config, Queue, QueueItem } from "./types.ts";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface QueueValidation {
  ok: boolean;
  violations: string[];
}

/**
 * What an item's declared write scope MEASURES OUT TO in the tree the queue will
 * execute against: the number of existing files its fileScope globs match, and
 * their total size in bytes. Core cannot look at a filesystem (G3), so the
 * adapter that owns glob expansion measures and hands this in; a queue judged
 * without it is judged on its SHAPE alone, which is every rule below that does
 * not read `measurements`.
 */
export interface ScopeMeasurement {
  files: number;
  bytes: number;
}

export type ScopeMeasurements = ReadonlyMap<string, ScopeMeasurement>;

// The read-set estimate's divisor. Four bytes per token is the ordinary
// English/source rule of thumb; the number exists to be WRONG BY A CONSTANT in a
// way an operator can compensate for with the budget, not to be exact.
export const BYTES_PER_TOKEN = 4;

// The shipped read-set ceiling, in estimated tokens (~80 KB of source). Generous
// on purpose: the mechanism exists to refuse the item that a small local model
// provably cannot read, not to re-litigate item size, which the file budget above
// already owns. `workflow.readSetTokenBudget` overrides it, and a configured 0
// turns the bound off.
export const DEFAULT_READ_SET_TOKEN_BUDGET = 20000;

// The shipped per-item implementer-attempt budget (§3.3's escalation ladder ends
// somewhere). `workflow.implementerAttempts` overrides it.
export const DEFAULT_IMPLEMENTER_ATTEMPTS = 3;

/** The configured read-set token ceiling; 0 (or negative) means "no bound". */
export function readSetTokenBudget(config: Config): number {
  const configured = config.workflow.readSetTokenBudget;
  if (configured === undefined) return DEFAULT_READ_SET_TOKEN_BUDGET;
  return Math.max(0, Math.floor(configured));
}

/** The configured per-item implementer-attempt budget, never below one. */
export function implementerAttemptBudget(config: Config): number {
  const configured = config.workflow.implementerAttempts;
  if (configured === undefined) return DEFAULT_IMPLEMENTER_ATTEMPTS;
  return Math.max(1, Math.floor(configured));
}

/** The estimated token cost of reading everything an item's fileScope matches. */
export function readSetTokens(measurement: ScopeMeasurement): number {
  return Math.ceil(measurement.bytes / BYTES_PER_TOKEN);
}

// §2.4 ids are model-authored and land in three places that cannot defend
// themselves: the §3.3 commit SUBJECT (embedded raw, so a newline injects a whole
// line into the record — ISSUE-071), the item ledger's file name, and the prose
// scan that maps findings to items. One character class satisfies all three.
const ITEM_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

// A scope entry is embedded in the commit BODY and handed to a child process as
// argv. A newline (or any other control character) in one is never a path — it is
// a line the model wrote into a record it does not own.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

// §3.2's size row budget ("scope > ~5 files"). This is the DECOMPOSITION item
// budget and it owns its own number: config.workflow.trivialMaxFiles is the
// §2.1 TRIVIAL-CLASSIFICATION ceiling (shipped default 2, plan line 560) and
// wiring the two together both rejected every 3-file item under the default
// config and made tuning the trivial path silently retune decompose.
export const ITEM_MAX_FILES = 5;

// ---------------------------------------------------------------------------
// DAG acyclicity (§2.4: `dependsOn` "must form a DAG")
// ---------------------------------------------------------------------------

// core/schedule.ts deliberately defers acyclicity to decompose (it schedules a
// queue it may ASSUME acyclic), so the detector lives here — the one place a
// cycle can still be rejected before anything is persisted.
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/**
 * The dependency graph as `id -> edges`. Two subtleties, both of them defects
 * this function exists to avoid:
 *   - DUPLICATE ids UNION their edges rather than last-writer-wins. Overwriting
 *     let a cycle routed through an earlier duplicate vanish, so the queue was
 *     judged against a graph it did not describe.
 *   - EMPTY ids are not nodes at all. An empty id is its own named violation;
 *     admitting it as a node produced the incoherent reason "cycle ( -> )".
 */
function buildDeps(items: readonly QueueItem[]): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  for (const item of items) {
    if (item.id.trim().length === 0) continue;
    const existing = deps.get(item.id);
    if (existing === undefined) {
      deps.set(item.id, [...item.dependsOn]);
      continue;
    }
    for (const dep of item.dependsOn) {
      if (!existing.includes(dep)) existing.push(dep);
    }
  }
  return deps;
}

/**
 * EVERY distinct `dependsOn` cycle, each as the node path that closes it
 * (["I1","I2","I1"]); an empty array means the dependency graph is acyclic.
 * Iterative three-colour DFS (no recursion, so a pathological queue cannot blow
 * the stack). Edges naming an id that is not in the queue are SKIPPED — a
 * dangling dependency is its own named violation, and treating it as an edge
 * would hide the real defect. Cycles are de-duplicated by their node set, so
 * the same loop reached from two roots is reported once.
 */
export function findDependsOnCycles(items: readonly QueueItem[]): string[][] {
  const deps = buildDeps(items);
  const colour = new Map<string, number>();
  for (const id of deps.keys()) colour.set(id, WHITE);

  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  for (const root of deps.keys()) {
    if (colour.get(root) !== WHITE) continue;
    // `path` mirrors the GRAY frames, so the closing edge's cycle is the slice
    // from the re-entered node to the top of the path.
    const path: string[] = [root];
    const frames: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    colour.set(root, GRAY);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const edges = deps.get(frame.id) ?? [];
      if (frame.next >= edges.length) {
        colour.set(frame.id, BLACK);
        frames.pop();
        path.pop();
        continue;
      }
      const dep = edges[frame.next];
      frame.next += 1;
      if (!deps.has(dep)) continue; // dangling id — reported separately
      const depColour = colour.get(dep);
      if (depColour === GRAY) {
        const cycle = [...path.slice(path.indexOf(dep)), dep];
        const key = [...new Set(cycle)].sort().join(",");
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
        continue; // keep walking: a queue may carry several disjoint cycles
      }
      if (depColour === BLACK) continue;
      colour.set(dep, GRAY);
      path.push(dep);
      frames.push({ id: dep, next: 0 });
    }
  }
  return cycles;
}

// ---------------------------------------------------------------------------
// The §2.4 disjoint-path guard
// ---------------------------------------------------------------------------

// A glob that names no directory and no `**` matches ROOT-LEVEL files only
// ("*.md", "README.md"). core/shell-parse.ts's scopesIntersect is deliberately
// conservative — it reduces a glob to its literal head, and a leading wildcard
// yields an EMPTY head that overlaps everything — which is the right bias for
// the wave scheduler (a false overlap only serialises work) but a hard false
// REJECTION here. Comparing depth first keeps the conservative rule everywhere
// it is safe while letting a root-level-only scope be disjoint from a scope
// rooted in a directory, which it provably is.
function rootLevelOnly(glob: string): boolean {
  return !glob.includes("/") && !glob.includes("**");
}

// Whether a glob rooted in a directory can ALSO name a root-level file. `**`
// matches zero or more path segments, so a `**`-headed glob with at most one
// literal segment left over ("**", "**/*.ts", "**/*.go") matches "config.ts" as
// surely as it matches "src/deep/config.ts". The depth comparison below reads
// "not root-level-only" as "lives in a directory", which is FALSE for exactly
// these globs — and they are the safe default (`**`) and the ordinary ecosystem
// answer (`**/*.ts`), so without this the disjoint-path guard declared a
// root-level production file disjoint from every behavioral path and let a
// `behavioral:false` item edit it with no test at all.
function reachesRootLevel(glob: string): boolean {
  const segments = glob.split("/");
  if (segments[0] !== "**") return false;
  return segments.filter((segment) => segment !== "**").length <= 1;
}

/**
 * The FIRST (fileScope glob, behavioralPaths glob) pair that overlaps, or null
 * when the two lists are disjoint. Pair-wise so the rejection can NAME the
 * intersecting glob (§3.2 requires the reason, not a boolean); the overlap test
 * itself is core/shell-parse.ts's scopesIntersect, so decompose and the wave
 * scheduler judge overlap by exactly the same (deliberately conservative) rule.
 */
export function firstIntersectingGlob(
  fileScope: readonly string[],
  behavioralPaths: readonly string[],
): { scope: string; behavioral: string } | null {
  for (const scope of fileScope) {
    for (const behavioral of behavioralPaths) {
      // One matches root-level files only and the other is rooted in a
      // directory it cannot climb out of: they cannot name the same file. A
      // `**`-headed glob DOES climb out (reachesRootLevel), so the pair still
      // goes to scopesIntersect rather than being called disjoint on depth.
      if (rootLevelOnly(scope) !== rootLevelOnly(behavioral)) {
        const nested = rootLevelOnly(scope) ? behavioral : scope;
        if (!reachesRootLevel(nested)) continue;
      }
      if (scopesIntersect([scope], [behavioral])) return { scope, behavioral };
    }
  }
  return null;
}

/**
 * The first (fileScope glob, testScope entry) pair where the write scope COVERS
 * the test path, or null when the two scopes are separate territory.
 *
 * Two matchers, because the pair can be spelled two ways and only one of them is
 * a glob-against-path question: `globMatch` answers "does this write glob match
 * that literal test path" exactly, and `scopesIntersect` catches the glob-against-
 * glob spelling ("src/*.ts" vs "src/*.test.ts", where the first really does match
 * what the second names) with the same conservative rule the wave scheduler uses.
 */
function firstCoveringGlob(
  fileScope: readonly string[],
  testScope: readonly string[],
): { file: string; test: string } | null {
  for (const file of fileScope) {
    for (const test of testScope) {
      if (globMatch(file, test) || globMatch(test, file) || scopesIntersect([file], [test])) {
        return { file, test };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Acceptance phrasing (§3.2: "acceptance criteria phrased as observable checks"
// rejects "make it better")
// ---------------------------------------------------------------------------

// Quality WISHES, not checks. Deliberately narrow shapes — a criterion is only
// rejected when it is a quality phrase with no observable outcome anywhere in
// it, because over-rejecting here would burn the single bounded re-prompt on a
// perfectly checkable criterion. In particular "make it <concrete outcome>"
// ("make it return 404 on a missing id") is a CHECK; only the quality-adjective
// continuation is the "make it better" wish the row names.
const VAGUE_ACCEPTANCE: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'the "make it better" shape — a wish, not a check',
    // "more"/"less" name a quality only when no threshold follows: "make it more
    // than 3 retries" and "make it less than 200ms" are bounds an assertion runs,
    // which is what this rule's own docstring promises about "make it <outcome>".
    pattern:
      /\bmake\s+it\s+(?:better|nicer|cleaner|faster|prettier|simpler|smaller|tidier|robust|solid|good|great|pretty|neat|more\s+(?!than\b)\w+|less\s+(?!than\b)\w+)\b/i,
  },
  {
    label: "opens with a bare quality verb and names no observable outcome",
    // The verb must be an English word, not an IDENTIFIER that happens to spell
    // one. `refactor(ast) preserves the token count` and `cleanup() removes the
    // temp dir` are observable checks about functions with those names, and
    // refusing them wedged a run exactly as a miscounted cluster did.
    pattern: /^\s*(?:improve|enhance|polish|tidy|optimi[sz]e|clean\s*up|refactor)\b(?![(._-])/i,
  },
  {
    label: "ends on a quality adjective in place of an outcome",
    pattern: /\b(?:better|nicer|cleaner|more\s+robust|as\s+appropriate|etc\.?)\s*$/i,
  },
  { label: "carries an unresolved placeholder", pattern: /\b(?:TBD|TODO|FIXME)\b/i },
];

/** The reason a criterion is not an observable check, or null when it is one. */
export function vagueAcceptance(criterion: string): string | null {
  if (criterion.trim().length === 0) return "the criterion is empty";
  for (const rule of VAGUE_ACCEPTANCE) {
    if (rule.pattern.test(criterion)) return rule.label;
  }
  return null;
}

// The DETERMINERS, conjunctions and temporal openers a criterion may carry in
// front of its subject. The scan walks past them rather than reading one as the
// subject: without this, every criterion opening with an article collapsed to
// the subject "the" (so "the parser rejects X" and "the router retries Y" —
// exactly the two-things smell the size row targets — counted as ONE cluster),
// while one subject phrased with and without an article ("parser rejects…" plus
// "the parser preserves…") counted as TWO and was rejected with the nonsense
// reason "spans 2 clusters (parser, the)".
//
// This set stays a set of DETERMINERS. Widening it with the generic nouns and
// gerunds ordinary acceptance opens with is the wrong instrument twice over: it
// is an open-ended English word list, and walking PAST such a word lands the
// scan on the verb that follows it, which is a worse subject than the noun was.
// Those shapes are handled by the abstention grammar below, which ends the scan
// instead of advancing it.
const DETERMINERS = new Set([
  "the", "a", "an", "its", "it", "this", "that", "these", "those",
  "each", "every", "all", "any", "no", "our", "their", "his", "her",
  "when", "if", "given", "after", "before", "and", "or", "but", "then",
]);

// What may appear INSIDE a subject's name: word characters, and the three
// separators an identifier carries in the languages this build plans against —
// the dot of `config.load`, the slash of a path, the hyphen of a kebab name.
// A parenthesis or a quote is not one of them: they open the ARGUMENTS of a
// call, which are no part of what the criterion is about. It is also the whole
// alphabet a cluster NAME is drawn from, which is what structurally keeps a
// quoted name from carrying an unbalanced delimiter or the ", " the violation
// joins names with.
const SUBJECT_CHARS = /^[\w./-]+/;

// A criterion may arrive as a markdown list row. The marker is layout, not
// language, and reading one as a subject produced the cluster names "-" and
// "1." — names that exist nowhere in the item.
const LIST_MARKER = /^\s*(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+/;

// A bare number is a value the criterion asserts ABOUT something, never the
// something. "233168 is returned by solve()" is about solve.
const NUMERIC_TOKEN = /^[\d.,]+$/;

// ---------------------------------------------------------------------------
// PRESERVATION claims: the criteria that do not divide an item
// ---------------------------------------------------------------------------
//
// "src/registry.py is not modified" and "tests/check_visible.py still passes"
// are regression GUARDS, not things the item is about. The test is a PROOF, not
// a preference: splitting an item does not divide such a criterion — every half
// still owes it — so it can never be a reason the item is two items. Counting
// them made the size row charge a planner for its non-regression discipline:
// the more carefully it promised not to break things, the likelier its item was
// refused as too large.
//
// Both halves of each pattern are closed vocabularies — a set of EDIT verbs and
// a set of BUILD properties — because negation-of-change is a small grammatical
// family in a way that "nouns that are not subjects" is not.
//
// Two of those vocabularies are split, because half of each is also ordinary
// RUNTIME vocabulary. `src/state.ts is not changed` preserves a file; "the queue
// entry is not removed until the TTL expires" and "the daemon still runs after a
// config reload" are the deliverables of an eviction item and a hot-reload item.
// The discriminator is structural rather than lexical: a guard NAMES the
// artifact it promises to leave alone — a path, a filename, a call, an
// identifier carrying a name mark. A criterion using the ambiguous half of the
// vocabulary over prose that names no artifact is delivering behaviour, and is
// counted like any other deliverable.
//
// A guard is also read at the CLAUSE it occupies rather than at the whole
// sentence. Dropping the sentence let one clause of ordinary non-regression
// discipline carry a second deliverable past the row: "src/registry.py is not
// modified and src/telemetry.ts sends a heartbeat every 30s" asserts nothing at
// all in its first half and a whole second component in its second.
const SOURCE_EDIT_PARTICIPLE = "modified|edited|altered|rewritten|regenerated|touched|reformatted";
const ARTIFACT_EDIT_PARTICIPLE = "changed|removed|deleted|renamed|moved|broken|affected|regressed";
const EDIT_PARTICIPLE = `${SOURCE_EDIT_PARTICIPLE}|${ARTIFACT_EDIT_PARTICIPLE}`;
const BUILD_PROPERTY = "importable|passing|compiling|building|green|installable";
const ARTIFACT_BUILD_PROPERTY = "working|loadable|runnable";
const STILL_BUILD = "passes|pass|compiles|compile|builds|build|holds|green|succeeds|imports";
const STILL_ARTIFACT = "runs|run|works|work|loads|load";
// The modal and nominal spellings of the same promise. A planner reading a
// migration spec writes "must not be modified" and "no changes to X" as readily
// as "is not modified", and the violation text itself uses the modal form to
// describe the concept it then refused as input.
const MODAL = "must|should|shall|will|would|may|might|can";

// The guard shapes whose vocabulary says nothing but preservation, whatever the
// criterion is about.
const PRESERVATION_CLAIMS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:is|are|was|were|gets?|stays?|remains?)\s+not\s+(?:being\s+)?(?:${SOURCE_EDIT_PARTICIPLE})\b`, "i"),
  new RegExp(
    String.raw`\b(?:is|are|was|were|stays?|remains?)\s+(?:unchanged|unmodified|untouched|unaffected|intact|the\s+same|as\s+before|byte-for-byte)\b`,
    "i",
  ),
  new RegExp(String.raw`\bstill\s+(?:${STILL_BUILD})\b`, "i"),
  new RegExp(String.raw`\bcontinues?\s+to\s+(?:pass|compile|build|work|run|import|load)\b`, "i"),
  new RegExp(String.raw`\b(?:leaves|keeps?|preserves?)\b[^,;]*?\b(?:${BUILD_PROPERTY})\b`, "i"),
  new RegExp(String.raw`\bno\s+(?:existing|other|current)\s+[\w./-]+\s+(?:is|are)\s+(?:${EDIT_PARTICIPLE})\b`, "i"),
  new RegExp(String.raw`\b(?:${MODAL})\s+not\s+(?:be\s+)?(?:${SOURCE_EDIT_PARTICIPLE})\b`, "i"),
  new RegExp(String.raw`\b(?:${MODAL})\s+not\s+(?:be\s+)?(?:change[sd]?|move[sd]?|broken|regressed?)\b`, "i"),
  new RegExp(String.raw`\bno\s+changes?\s+to\b`, "i"),
];

// The guard shapes whose vocabulary is also ordinary runtime English. Each holds
// only over a criterion that names the artifact it preserves.
const ARTIFACT_PRESERVATION_CLAIMS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:is|are|was|were|gets?|stays?|remains?)\s+not\s+(?:being\s+)?(?:${ARTIFACT_EDIT_PARTICIPLE})\b`, "i"),
  new RegExp(String.raw`\b(?:${MODAL})\s+not\s+(?:be\s+)?(?:${ARTIFACT_EDIT_PARTICIPLE})\b`, "i"),
  new RegExp(String.raw`\bstill\s+(?:${STILL_ARTIFACT})\b`, "i"),
  new RegExp(String.raw`\b(?:leaves|keeps?|preserves?)\b[^,;]*?\b(?:${ARTIFACT_BUILD_PROPERTY})\b`, "i"),
];

// A preservation claim that carves out an exception is not a guard: it delivers
// the exception. "src/router.ts is unchanged apart from the added retry" works.
const ADVERSATIVE = /\b(?:apart\s+from|except|other\s+than|besides|aside\s+from|save\s+for)\b/i;

/** Whether a criterion names a file, a test or a symbol — what a guard preserves. */
function namesAnArtifact(criterion: string): boolean {
  return clauseTokens(criterion).some((token) => nameMarked(token));
}

/** Whether a criterion promises that something does NOT change. */
function preservationClaim(criterion: string): boolean {
  if (ADVERSATIVE.test(criterion)) return false;
  if (PRESERVATION_CLAIMS.some((pattern) => pattern.test(criterion))) return true;
  if (!ARTIFACT_PRESERVATION_CLAIMS.some((pattern) => pattern.test(criterion))) return false;
  return namesAnArtifact(criterion);
}

// Where one criterion carries more than one clause. The separators are the ones
// that join independent clauses in the acceptance prose a planner writes; the
// split is consulted only when the criterion reads as a guard, so an ordinary
// deliverable carrying a comma — `backoffDelays(3, 100) === [100, 200]` — is
// never cut.
const CLAUSE_SEPARATOR = /\s*;\s*|\s+and\s+|\s+but\s+|,\s+/i;

// What makes a fragment a CLAUSE rather than half of a coordinated noun phrase:
// a finite verb. "export name" and "signature are unchanged" is one guard over a
// coordinated subject; "src/registry.py is not modified" and "src/telemetry.ts
// sends a heartbeat" is a guard beside a deliverable.
const FINITE_VERB =
  /\b(?:is|are|was|were|be|been|being|has|have|had|does|do|did|can|could|may|might|must|shall|should|will|would|[a-z]{3,}(?:es|ed|s))\b/i;
const CLAUSE_MIN_TOKENS = 3;

/**
 * What a criterion DELIVERS: the criterion itself when it is not a guard, the
 * one clause of it that delivers something when the rest is a guard, and null
 * when the whole criterion only promises that something does not change.
 */
function deliverableText(criterion: string, context: ClusterContext | undefined): string | null {
  if (!preservationClaim(criterion)) return criterion;
  for (const segment of criterion.split(CLAUSE_SEPARATOR)) {
    const clause = segment.trim();
    if (clause.length === 0) continue;
    if (preservationClaim(clause)) continue;
    if (clauseTokens(clause).length < CLAUSE_MIN_TOKENS) continue;
    if (!FINITE_VERB.test(clause)) continue;
    if (criterionSubject(clause, context) === null) continue;
    return clause;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The abstention grammar: when a criterion's first word is not its subject
// ---------------------------------------------------------------------------
//
// English routinely opens a sentence with something other than the subject, and
// each of these forms produced a cluster named for a word that names nothing:
// "leading" (a passive's patient), "calling" (a gerund), "there" (existential),
// "on" (a preposition), "module" and "output" (generic nouns). A criterion in
// one of these forms yields NO subject rather than a fabricated one — the count
// only ever falls, so a criterion the scan cannot read can never be a reason to
// refuse an item.
//
// The passive is read at the MAIN clause, not at the sentence: "router retries
// when the connection is dropped" has the active head "router", and suppressing
// it for a passive five words downstream hid a whole second component behind a
// subordinate clause anyone can append.
const PASSIVE_VOICE = /\b(?:is|are|was|were|gets|get|been|being)\s+(?:not\s+)?(?:being\s+)?([a-z]+(?:ed|wn|en))\b/i;
// Where a subordinate clause begins. Only after a first word: a criterion may
// legitimately OPEN with one ("when input is '!!!' slugify returns ''"), and
// there the whole sentence is the reading.
const SUBORDINATE_CLAUSE =
  /\s+(?:when|whenever|while|if|unless|until|once|after|before|because|since|though|although|whereas|provided)\s+/i;
// Passive voice puts the subject after "by", where a positional scan never
// reaches it: "a 502 response is retried by the router" is about the router.
// An AGENT is what that "by" has to introduce. English also puts a manner, a
// deadline and a sort key there — "by default", "by 2pm", "sorted by name" —
// and reading one of those as the subject fabricated the cluster names this
// module's own list-marker rule was written to stop. An agent is marked: it
// carries a determiner, it carries a name mark, or the item's own scope
// corroborates it.
const BY_PHRASE = /\bby\s+/i;
const AGENT_DETERMINER = /^(?:the|a|an|its|this|that|these|those|each|every|our|their|his|her)\s+/i;
const GERUND_HEAD = /^[a-z]{3,}ing$/;
// Written as split word lists: each is prose read as a vocabulary, and a quoted
// member of the prepositions reads to the purity scanner as a module specifier.
const DEICTIC_HEADS = new Set(
  "there here both either neither exactly only nothing everything something".split(" "),
);
const PREPOSITION_HEADS = new Set(
  "on in at for with from to under over during within without per by about into across".split(" "),
);
const GENERIC_HEADS = new Set(
  ("module package file files script program binary library header function method class command " +
    "output outputs result results code value values behaviour behavior implementation logic api tool " +
    "field input data content report table entry entries").split(" "),
);
// A criterion saying a file does NOT touch something is not saying the something
// lives there.
const NEGATION_TOKENS = new Set("never not neither nor without unlike".split(" "));

// How far past a criterion's opening word a subject may still be found. Three
// tokens covers "calling parse_duration(…)" and "given an empty input slugify…"
// without reaching the OBJECT of the verb: an unbounded look would read
// "passing an unknown unit raises ValueError" as a criterion about ValueError.
// It is also how far from the file it names a symbol may sit and still be read
// as living there.
const SUBJECT_WINDOW = 3;

// The marks that make a token a NAME rather than an English word: call syntax, a
// path separator, a dotted member, camelCase, PascalCase, snake_case.
const CALL_SYNTAX = /^[\w./-]+\(/;
const CAMEL_CASE = /^[a-z][a-z0-9]*[A-Z]/;
const PASCAL_CASE = /^[A-Z][a-z0-9]+[A-Z]/;
const SNAKE_CASE = /^[a-z][a-z0-9]*_[a-z0-9]/i;

// A scope entry that names a TERRITORY rather than a file. "src/**" is a legal
// fileScope — only a wildcard-HEADED entry is refused — and it is not a thing an
// acceptance criterion can be about, so it never becomes a cluster NAME.
const GLOB_CHARACTER = /[*?[\]{}]/;

/**
 * The item context the cluster count reads: what the item DECLARES it writes and
 * tests. It is the only structural evidence available about what a criterion is
 * about, and the size row already holds it — the file budget five lines above
 * reads the same field. An acceptance judged without it is judged on its prose
 * alone, which is what every unit call below does deliberately.
 */
export type ClusterContext = Pick<QueueItem, "fileScope" | "testScope">;

interface SubjectToken {
  raw: string;
  identifier: string;
}

/** A criterion's tokens, list marker and determiners walked past. */
function clauseTokens(criterion: string): SubjectToken[] {
  const tokens: SubjectToken[] = [];
  for (const word of criterion.replace(LIST_MARKER, "").trim().split(/\s+/)) {
    const raw = word.replace(/^[^\w./-]+/, "");
    const clean = raw.replace(/[^\w./-]+$/, "").replace(/^\.\//, "").toLowerCase();
    if (clean.length === 0) continue;
    if (DETERMINERS.has(clean)) continue;
    const identifier = SUBJECT_CHARS.exec(clean);
    if (identifier === null) continue;
    tokens.push({ raw, identifier: identifier[0] });
  }
  return tokens;
}

function nameMarked(token: SubjectToken): boolean {
  if (NUMERIC_TOKEN.test(token.identifier)) return false;
  if (CALL_SYNTAX.test(token.raw)) return true;
  if (token.identifier.includes("/")) return true;
  if (DOTTED_FILENAME.test(token.identifier)) return true;
  if (CAMEL_CASE.test(token.raw) || PASCAL_CASE.test(token.raw)) return true;
  return SNAKE_CASE.test(token.identifier);
}

function declaredScope(context: ClusterContext | undefined): string[] {
  if (context === undefined) return [];
  return [...context.fileScope, ...context.testScope];
}

/** The final segment of a path with its extension removed ("src/p001.py" -> "p001"). */
function stemOf(pathLike: string): string {
  const base = basenameOf(pathLike);
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/**
 * Whether `entry` is the scope entry a token names. The three token shapes are
 * matched by three different rules on purpose:
 *   - a token carrying a directory is matched by the conservative overlap the
 *     wave scheduler uses, so `src/lib/a.ts` resolves against `src/lib/**`;
 *   - a bare dotted filename is matched by BASENAME, which is what makes
 *     `p001.py` and `src/solvers/p001.py` one file;
 *   - a bare identifier is matched by STEM, which is what lets one criterion
 *     name a file and a sibling criterion name the symbol inside it.
 * A full path is never matched by basename: `src/a/util.ts` and `src/b/util.ts`
 * are two files, and folding them would be the mirror defect of splitting one.
 */
function entryNamedBy(token: string, entry: string): boolean {
  if (token.includes("/")) return scopesIntersect([token], [entry]);
  if (DOTTED_FILENAME.test(token)) return basenameOf(entry).toLowerCase() === token;
  return stemOf(entry) === token;
}

/** Whether the item's own declaration corroborates a token as something it names. */
function corroborated(token: SubjectToken, context: ClusterContext | undefined): boolean {
  if (NUMERIC_TOKEN.test(token.identifier)) return false;
  return declaredScope(context).some((entry) => entryNamedBy(token.identifier, entry));
}

/**
 * The FILE a token names: the declared scope entry when the item declares that
 * file, the token itself when it is a path the item does not declare, and null
 * when the token is not a file at all.
 *
 * The key is the file, not the entry that matched it. A declared entry is the
 * canonical spelling of ONE file, so every way a criterion spells that file
 * folds onto it — but a directory glob is a territory rather than a file, and
 * keying by the entry there collapsed every path under `src/**` into one
 * cluster, making the row weakest exactly where the item declares the most.
 *
 * A path the item does NOT declare still resolves to itself rather than being
 * dropped: a criterion actively asserting about a file outside the write scope
 * is either a second thing or an under-declared scope, and both are worth the
 * refusal. Only a criterion PRESERVING such a file is dropped, and that happens
 * one step earlier.
 */
function resolveFile(token: string, context: ClusterContext | undefined): string | null {
  const entries = declaredScope(context).filter((entry) => !GLOB_CHARACTER.test(entry));
  if (token.includes("/")) {
    for (const entry of entries) {
      if (scopesIntersect([token], [entry])) return entry;
    }
    return token;
  }
  if (NUMERIC_TOKEN.test(token)) return null;
  if (DOTTED_FILENAME.test(token)) {
    for (const entry of entries) {
      if (basenameOf(entry).toLowerCase() === token) return entry;
    }
    return null;
  }
  for (const entry of entries) {
    if (stemOf(entry) === token) return entry;
  }
  return null;
}

/** The criterion up to the first subordinate clause that follows a word of it. */
function mainClause(criterion: string): string {
  const sentence = criterion.replace(LIST_MARKER, "").trim();
  const boundary = SUBORDINATE_CLAUSE.exec(sentence);
  if (boundary === null) return sentence;
  return sentence.slice(0, boundary.index);
}

/**
 * The AGENT a passive criterion names, or null when its "by" introduces a
 * manner, a deadline or a sort key instead. Every by-phrase in the criterion is
 * read, so an adverbial one in front cannot shadow the agent behind it.
 */
function passiveAgent(criterion: string, context: ClusterContext | undefined): SubjectToken | null {
  const phrases = criterion.split(BY_PHRASE).slice(1);
  for (const phrase of phrases) {
    const introduced = AGENT_DETERMINER.test(phrase);
    const tokens = clauseTokens(phrase);
    if (tokens.length === 0) continue;
    const candidate = tokens[0];
    if (NUMERIC_TOKEN.test(candidate.identifier)) continue;
    if (GERUND_HEAD.test(candidate.identifier)) continue;
    if (DEICTIC_HEADS.has(candidate.identifier)) continue;
    if (PREPOSITION_HEADS.has(candidate.identifier)) continue;
    if (GENERIC_HEADS.has(candidate.identifier)) continue;
    if (introduced || nameMarked(candidate) || corroborated(candidate, context)) return candidate;
  }
  return null;
}

/**
 * The subject one criterion asserts about, or null when it names none.
 *
 * The order is the rule: a token the item's own scope corroborates comes first,
 * then a HEAD that carries a name, then a head the grammar leaves standing, then
 * the agent of a passive, and only then a name deeper in the opening window.
 *
 * The head outranks a name deeper in the window because a criterion's OBJECT is
 * a name as often as its subject is: "the generator writes docs/api.md" and "the
 * generator exits 0" are two checks on one generator, and reading the first as a
 * criterion about docs/api.md split one subject in two. The window still reads
 * the criteria whose head is not a subject at all, which is the whole reason it
 * exists.
 *
 * An unremarkable opening word STANDS rather than being dropped for want of
 * corroboration, and that asymmetry is where the row keeps its teeth. "parser
 * rejects an unknown key" and "router retries on 502" name nothing the item
 * declares and carry no mark, and they are the two-things smell the size row
 * exists for. Requiring corroboration would drop both and accept the item.
 * A criterion is therefore refused a subject only when the GRAMMAR says its
 * opening word is not one — which is a closed set of forms, where "words that
 * happen not to be subjects" is not.
 */
function criterionSubject(criterion: string, context: ClusterContext | undefined): SubjectToken | null {
  const tokens = clauseTokens(criterion);
  if (tokens.length === 0) return null;
  const window = tokens.slice(0, SUBJECT_WINDOW);

  for (const token of window) {
    if (corroborated(token, context)) return token;
  }

  const head = tokens[0];
  if (nameMarked(head)) return head;

  const passive = PASSIVE_VOICE.test(mainClause(criterion));
  if (
    !passive &&
    !NUMERIC_TOKEN.test(head.identifier) &&
    !GERUND_HEAD.test(head.identifier) &&
    !DEICTIC_HEADS.has(head.identifier) &&
    !PREPOSITION_HEADS.has(head.identifier) &&
    !GENERIC_HEADS.has(head.identifier)
  ) {
    return head;
  }

  if (passive) {
    const agent = passiveAgent(criterion, context);
    if (agent !== null) return agent;
  }

  for (const token of window) {
    if (nameMarked(token)) return token;
  }
  return null;
}

/**
 * The positional reading: each criterion's first non-determiner token, reduced
 * to its leading identifier and case folded. It is what the scan above falls
 * back to when NOTHING in an acceptance resolves — no name, no path, no call, no
 * token the item's own scope corroborates.
 *
 * It is deliberately the floor rather than an empty answer. Acceptance that
 * names nothing is exactly the prose in which a two-things item hides best, and
 * a row that goes silent there would be a guard nobody can see failing. The
 * floor is strict and sometimes wrong in the direction a journal records.
 *
 * It reads what the acceptance DELIVERS, never the guards: a floor that counted
 * a preservation claim made the count RISE when a planner promised not to break
 * something, which is the inversion the guard rule exists to remove.
 */
function positionalSubjects(delivered: readonly string[]): string[] {
  const subjects: string[] = [];
  for (const criterion of delivered) {
    let subject = "";
    for (const raw of criterion.replace(LIST_MARKER, "").trim().split(/\s+/)) {
      const token = raw.replace(/^[^\w./-]+/, "").replace(/[^\w./-]+$/, "").toLowerCase();
      if (token.length === 0) continue;
      if (DETERMINERS.has(token)) continue;
      const identifier = SUBJECT_CHARS.exec(token);
      if (identifier === null) continue;
      subject = identifier[0];
      break;
    }
    if (subject.length > 0 && !subjects.includes(subject)) subjects.push(subject);
  }
  return subjects;
}

/**
 * The distinct acceptance CLUSTERS an item's criteria fall into. §3.2's size row
 * rejects "> 1 acceptance cluster", and two criteria about two different subjects
 * is the "this item covers two things" smell that row is aimed at. Criteria that
 * share a subject stay ONE cluster however many they are, so an item may pin
 * several observable checks on the same behaviour.
 *
 * The plan (line 1109) fixes the THRESHOLD and leaves the UNIT undefined, and
 * this is the unit: the SUBJECT a criterion asserts about, resolved against the
 * files the item declares wherever the criterion names one. Four properties
 * carry it, and each answers a measured refusal of an item that covers one thing:
 *
 *   - a criterion that PRESERVES rather than delivers contributes nothing,
 *     because splitting an item never divides such a criterion;
 *   - a criterion whose grammar puts no subject at its front contributes
 *     nothing, rather than contributing the word that happens to be there;
 *   - a file the item declares is ONE cluster however a criterion spells it,
 *     and a symbol a criterion introduces beside its file belongs to that file;
 *   - the count never RISES for anything a planner adds out of discipline: a
 *     guard costs nothing wherever it appears, including in the floor.
 *
 * Against each of those sits the property that keeps the row's teeth, because
 * every one of them is also a shape a planner under re-prompt pressure can
 * reach for: a guard is dropped at its own CLAUSE and only over an artifact it
 * names, a symbol is homed only where it sits beside its file, a passive
 * suppresses only the clause it is in, a directory glob folds nothing, and two
 * declared files fold only where a criterion RELATES them rather than listing
 * them.
 *
 * `context` is the item. Without it the reading is prose-only, which is what
 * makes the function answerable on an acceptance list alone.
 *
 * The return is the cluster NAMES and nothing else, deliberately: a richer
 * partition (deliverables, guards, unresolved) would read better in a violation,
 * and it would also move every assertion that pins this scan's answers — the
 * assertions that certify the row is neither loosened into uselessness nor
 * re-broken in the ways it has been broken already. The legibility that
 * partition buys is bought instead by the violation text, which names the three
 * legal moves rather than the one illegal one.
 *
 * Two token reductions are load-bearing and their ORDER is the rule. Punctuation
 * is stripped off both ends FIRST, because the determiner test is a lookup on a
 * whole word and "the," is not "the" — scanning for the identifier before that
 * step lets a comma smuggle an article back in as a subject and revives "spans 2
 * clusters (parser, the)". Only then is the leading identifier taken, stopping at
 * the first character that cannot appear inside one; stripping the ENDS alone
 * left the call syntax §3.2's observable-check row actively asks for embedded in
 * the middle, so `pad("a") === "[a]"` and `pad("") === ""` — two checks on ONE
 * function — yielded the subjects `pad("a` and `pad` and counted as two clusters,
 * with the name `pad("a` quoted back at the planner.
 */
export function acceptanceClusters(
  acceptance: readonly string[],
  context?: ClusterContext,
): string[] {
  const delivered: string[] = [];
  for (const criterion of acceptance) {
    const text = deliverableText(criterion, context);
    if (text !== null) delivered.push(text);
  }

  // A criterion naming both a file and a symbol says where the symbol lives, so
  // a sibling criterion about that symbol is about that file. The symbol has to
  // sit BESIDE the file to be read as living in it: an unbounded look let one
  // trailing mention of another component's function ("… and never calls
  // telemetry.send()") adopt that function permanently, folding a sibling
  // criterion that was genuinely about the other component.
  const symbolHome = new Map<string, string>();
  for (const text of delivered) {
    const tokens = clauseTokens(text);
    let home: string | null = null;
    let at = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      home = resolveFile(tokens[i].identifier, context);
      if (home !== null) {
        at = i;
        break;
      }
    }
    if (home === null) continue;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (NEGATION_TOKENS.has(token.identifier)) break;
      if (Math.abs(i - at) > SUBJECT_WINDOW) continue;
      if (resolveFile(token.identifier, context) !== null) continue;
      if (NUMERIC_TOKEN.test(token.identifier)) continue;
      if (nameMarked(token)) symbolHome.set(token.identifier, home);
    }
  }

  const clusters: string[] = [];
  for (const text of delivered) {
    const subject = criterionSubject(text, context);
    if (subject === null) continue;
    const file = resolveFile(subject.identifier, context);
    const key = file ?? symbolHome.get(subject.identifier) ?? subject.identifier;
    if (!clusters.includes(key)) clusters.push(key);
  }

  if (clusters.length === 0) return positionalSubjects(delivered);
  if (context === undefined || clusters.length < 2) return clusters;

  // One criterion RELATING two of the item's own declared files is the item
  // saying those files are one piece of work — an implementation and the package
  // init that exports it, a header and the source that defines it. Two declared
  // files that no criterion ever relates stay two clusters.
  //
  // Relating them is not the same as listing them. "src/lexer.ts and
  // src/parser.ts are both formatted" asserts nothing a reader could not have
  // assumed and names no work, and folding on it let one line the format gate
  // already owns collapse a lexer and a parser into one item. The two mentions
  // must therefore be separated by at least one word of the criterion — the verb
  // that relates them — where a coordination puts them side by side.
  for (const text of delivered) {
    const tokens = clauseTokens(text);
    const named: Array<{ entry: string; at: number }> = [];
    for (let i = 0; i < tokens.length; i += 1) {
      for (const entry of context.fileScope) {
        if (!entryNamedBy(tokens[i].identifier, entry)) continue;
        if (named.some((seen) => seen.entry === entry)) continue;
        named.push({ entry, at: i });
      }
    }
    for (let i = 1; i < named.length; i += 1) {
      if (named[i].at - named[i - 1].at < 2) continue;
      const folded = clusters.indexOf(named[i].entry);
      if (folded >= 0 && clusters.includes(named[0].entry)) clusters.splice(folded, 1);
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// The §3.2 DECOMPOSED validation table
// ---------------------------------------------------------------------------

/**
 * Judge a decomposed queue against the whole §3.2 table (plan lines 1100-1110).
 * Returns EVERY violation, each naming the offending item and the defect, so the
 * handler's single bounded re-prompt can carry the complete list rather than
 * making the planner discover the defects one round at a time.
 *
 * The rows, in order: item-id integrity (unique ids, resolvable `dependsOn`);
 * DAG acyclicity; non-empty `fileScope`; non-empty `testScope` IFF `behavioral`;
 * `behavioral:false` => fileScope disjoint from `verify.behavioralPaths` (the
 * TDD-skip loophole, named with the intersecting glob); acceptance phrased as
 * observable checks; item size (files budget + acceptance clusters); and the
 * ponytail rung/reuse rule under `full`/`ultra` (§6.3 — `lite` records the
 * ladder but is advisory, so it is not enforced here).
 */
export function validateQueue(
  queue: Queue,
  config: Config,
  measurements?: ScopeMeasurements,
): QueueValidation {
  const violations: string[] = [];
  const items = queue.items;

  if (items.length === 0) {
    return {
      ok: false,
      violations: [
        "the decomposition is empty: a work run needs at least one queue item (§3.2)",
      ],
    };
  }

  // --- item-id integrity: the ground the DAG row stands on ------------------
  const seen = new Set<string>();
  for (const item of items) {
    if (item.id.trim().length === 0) {
      violations.push("an item carries an empty id; every §2.4 item is addressable by id");
      continue;
    }
    if (seen.has(item.id)) {
      violations.push(
        `duplicate item id "${item.id}": ids address items in dependsOn and in the item ledger, so they must be unique (§2.4)`,
      );
    }
    if (!ITEM_ID_SHAPE.test(item.id)) {
      violations.push(
        `item id ${JSON.stringify(item.id)} is not an addressable id: an id is letters, digits, "_" and "-" only (^[A-Za-z0-9_-]+$) — the §3.3 commit template embeds the id in its subject line, so a space, a separator or a newline in one writes a line into the commit record that nobody authored (§2.4)`,
      );
    }
    seen.add(item.id);
  }
  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (!seen.has(dep)) {
        violations.push(
          `item "${item.id}" dependsOn "${dep}", which is not an item in this queue: dependsOn names item ids (§2.4)`,
        );
      }
    }
  }

  // --- DAG acyclicity: every cycle, not just the first ----------------------
  for (const cycle of findDependsOnCycles(items)) {
    violations.push(
      `dependsOn contains a cycle (${cycle.join(" -> ")}): item dependencies must form a DAG, so no item may transitively depend on itself (§2.4)`,
    );
  }

  const ponytailEnforced = config.ponytail === "full" || config.ponytail === "ultra";

  for (const item of items) {
    const id = item.id;

    // --- non-empty fileScope ------------------------------------------------
    if (item.fileScope.length === 0) {
      violations.push(
        `item "${id}" declares an empty fileScope: an item that writes nothing is not an item (§3.2)`,
      );
    }

    // --- non-empty testScope IFF behavioral ---------------------------------
    if (item.behavioral && item.testScope.length === 0) {
      violations.push(
        `item "${id}" is behavioral:true but declares an empty testScope: a behavioral change owes the test paths that will prove it (§2.4)`,
      );
    }
    if (!item.behavioral && item.testScope.length > 0) {
      violations.push(
        `item "${id}" is behavioral:false but claims test paths it will never write (testScope: ${item.testScope.join(", ")}): testScope is non-empty IFF behavioral (§3.2)`,
      );
    }

    // --- behavioral:false => fileScope disjoint from behavioralPaths --------
    if (!item.behavioral) {
      const hit = firstIntersectingGlob(item.fileScope, config.verify.behavioralPaths);
      if (hit !== null) {
        violations.push(
          `item "${id}" is behavioral:false but its fileScope glob "${hit.scope}" intersects the verify.behavioralPaths glob "${hit.behavioral}": an item cannot declare itself untestable while editing behavioral production code (§2.4 disjoint-path guard)`,
        );
      }
    }

    // --- acceptance phrased as observable checks ----------------------------
    if (item.acceptance.length === 0) {
      violations.push(
        `item "${id}" declares no acceptance criteria: every item states the observable checks that settle it (§3.2)`,
      );
    }
    for (const criterion of item.acceptance) {
      const vague = vagueAcceptance(criterion);
      if (vague !== null) {
        violations.push(
          `item "${id}" acceptance criterion ${JSON.stringify(criterion)} is not an observable check (${vague}): phrase it as a check an assertion can run (§3.2)`,
        );
      }
    }

    // --- scope SHAPE: no wildcard-headed glob, no control characters --------
    //
    // A wildcard-headed entry ("**", "*.ts", "{src,lib}/**") has an empty literal
    // head, so it prefixes EVERY path in the repository. Two consequences, both
    // load-bearing: §2.6.1's `missing-subject` class asks whether the unresolved
    // specifier lives inside fileScope, and `globMatch("**", anything)` says yes —
    // which makes a test that imports a nonexistent module a harness-blessed legal
    // RED asserting nothing; and the §3.6 edit gate binds the implementer session
    // to the same globs, so the item's write grant is the whole tree.
    for (const glob of item.fileScope) {
      if (isWildcardHeaded(glob)) {
        violations.push(
          `item "${id}" declares the wildcard-headed fileScope entry ${JSON.stringify(glob)}: its literal head is empty, so it names every path in the repository — it grants the item's implementer an edit over the whole tree and makes the §2.6.1 missing-subject class vacuous. Name the directory or file the item actually writes (§3.2)`,
        );
      }
    }
    for (const [field, entries] of [
      ["fileScope", item.fileScope],
      ["testScope", item.testScope],
    ] as const) {
      for (const entry of entries) {
        if (CONTROL_CHARACTER.test(entry)) {
          violations.push(
            `item "${id}" declares the ${field} entry ${JSON.stringify(entry)}, which carries a newline or control character: scope entries are embedded in the §3.3 commit body and handed to the test runner as arguments, so a newline in one writes a line into a record it does not own (§2.4)`,
          );
        }
      }
    }

    // --- scope DISJOINTNESS inside the item ---------------------------------
    //
    // The implementer sub-session's edit gate is bound to fileScope. A testScope
    // the fileScope covers is therefore a licence to rewrite the very test that
    // proves the item — the escape GAP-007's identity witness had to be built to
    // catch after the fact, refused here before the item exists.
    if (item.testScope.length > 0) {
      const conflict = firstCoveringGlob(item.fileScope, item.testScope);
      if (conflict !== null) {
        violations.push(
          `item "${id}" declares the testScope entry "${conflict.test}" inside its own fileScope glob "${conflict.file}": the implementer is gated to fileScope, so an overlapping test path licenses the session that must PASS the test to rewrite it — keep the two scopes disjoint (§2.4)`,
        );
      }
    }

    // --- item size ----------------------------------------------------------
    //
    // Measured on the files the scope MATCHES where the measurement exists, and
    // never below the entry count: `["src/**"]` is one entry and may be a hundred
    // files, while a literal path naming a file that does not exist yet measures
    // zero and is still one file of work.
    const measured = measurements?.get(id);
    const matchedFiles = Math.max(item.fileScope.length, measured?.files ?? 0);
    if (matchedFiles > ITEM_MAX_FILES) {
      const how =
        measured !== undefined && measured.files > item.fileScope.length
          ? `its fileScope (${item.fileScope.join(", ")}) matches ${String(matchedFiles)} files`
          : `its fileScope names ${String(matchedFiles)} files`;
      violations.push(
        `item "${id}" is too large: ${how}, over the ${String(ITEM_MAX_FILES)}-file item budget — split it into smaller items (§3.2)`,
      );
    }

    // --- the read-set token bound -------------------------------------------
    //
    // The item budget above bounds how much an item WRITES. This bounds how much
    // it must READ to be written at all: an implementer with a 32k context cannot
    // be dispatched into a scope whose files do not fit in it, and the dispatch
    // that tries is spent before it starts.
    const budget = readSetTokenBudget(config);
    if (measured !== undefined && budget > 0) {
      const estimate = readSetTokens(measured);
      if (estimate > budget) {
        violations.push(
          `item "${id}" is too big to read: its fileScope matches ${String(measured.files)} files totalling ${String(measured.bytes)} bytes, an estimated ${String(estimate)} tokens of read set, over the ${String(budget)}-token workflow.readSetTokenBudget — narrow the scope or raise the budget (§3.2)`,
        );
      }
    }
    // The cluster count reads the ITEM, not the acceptance list alone: the files
    // it declares are the only structural evidence of what its criteria are
    // about, and the file budget above already reads the same field.
    //
    // The remedy names the three legal moves and not the fourth. "Split it into
    // one item per cluster" was unreachable advice whenever the clusters shared
    // a file: obeying it produced fresh violations from the inter-item
    // disjointness row below, so the guard prescribed a move the table refuses.
    const clusters = acceptanceClusters(item.acceptance, item);
    if (clusters.length > 1) {
      violations.push(
        `item "${id}" is too large: its acceptance spans ${String(clusters.length)} clusters (${clusters.join(", ")}), over the one-cluster item budget — give each subject its own item with its own files, declare a path in fileScope if this item really writes it, or phrase a criterion about a file it must not change as a preservation guard ("… is not modified") (§3.2)`,
      );
    }

    // --- ponytail rung + reuse note under full/ultra (§6.3) ------------------
    if (
      ponytailEnforced &&
      item.ponytail.ladderRung === "minimal-code" &&
      item.ponytail.reuse.trim().length === 0
    ) {
      violations.push(
        `item "${id}" claims the "minimal-code" ponytail rung with an empty reuse note: under ponytail intensity "${config.ponytail}" you must show you looked before writing new code (§6.3)`,
      );
    }
  }

  // --- inter-item scope disjointness (§4.2's rule, made a refusal) ----------
  //
  // Two items whose write scopes overlap are one item wearing two ids: the wave
  // scheduler can only ever serialize around them, a review finding cannot be
  // attributed to one of them, and whichever publishes second commits the other's
  // edits. The rule was ASKED of the planner in doctrine and enforced nowhere;
  // asked here, at the only point where the answer is still cheap.
  //
  // Judged with the same conservative overlap the wave scheduler uses, which
  // over-approximates deliberately: "src/**" and "src/lex.mjs" overlap because
  // the first really can write the second.
  //
  // Over EVERY pair, whatever each item's `behavioral` flag says. Keying the rule
  // on behavioral pairs made it a rule about tests rather than about territory:
  // a behavioral item writing ["src/foo.ts", "docs/x.md"] and a non-behavioral one
  // writing ["docs/x.md"] are two ids over one file, and the reasons above — a
  // finding that cannot be attributed, a publish that commits the other's edits —
  // are indifferent to whether either item owes a test.
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.id === b.id) continue; // a duplicate id is its own violation
      if (a.fileScope.length === 0 || b.fileScope.length === 0) continue;
      if (!scopesIntersect(a.fileScope, b.fileScope)) continue;
      violations.push(
        `items "${a.id}" (fileScope: ${a.fileScope.join(", ")}) and "${b.id}" (fileScope: ${b.fileScope.join(", ")}) claim overlapping write territory: two items that can edit the same file cannot be reviewed, scheduled or published independently — give each item a scope of its own (§2.4)`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// §3.2 PLAN_REVIEWED — which items a plan-level finding blocks
// (plan lines 1119-1131; the spec gap resolved in task-9.3.assertions.json)
// ---------------------------------------------------------------------------
//
// PLAN GAP, resolved here once: a §2.10 FINDING carries id/severity/lens/claim/
// evidence/suggestedFix and NO item reference, yet §3.2 requires "every item its
// blocksItems names" to be blocked when the plan-review round cap is reached. The
// PINNED resolution (no schema widening): the finding's own prose IS the
// reference, so a finding blocks an item when its claim+evidence (a) names that
// item's id, or (b) names a file path that intersects the item's fileScope under
// the same conservative core scopesIntersect the wave scheduler uses. A finding
// that names neither blocks nothing — it still becomes a question, and the run
// proceeds on every item (§3.2 "the run proceeds on the remaining items").
//
// The bias is deliberate and one-directional: an over-match blocks an item that
// a human then unblocks with `conductor_answer`, while an under-match lets the
// run execute an item a surviving major says is wrong. So the id scan is
// boundary-anchored (never a substring of a longer word) and the path scan
// refuses a wildcard-headed token, whose empty literal head would otherwise
// intersect EVERY scope and block the whole queue on one sloppy sentence.

// A queue item as this mapping sees it: its id and its write scope.
export interface BlockableItem {
  id: string;
  fileScope: readonly string[];
}

// A §2.10 finding as this mapping sees it: the two prose fields that can name an
// item. `suggestedFix` is deliberately NOT scanned — it describes the FIX, and a
// fix that mentions another file must not block the item that file belongs to.
export interface FindingReference {
  claim: string;
  evidence: string;
}

// Characters that continue an identifier. An id matches only when neither
// neighbour is one of these, so "I1" is found in "item I1 loads…" but not inside
// "I10" or "MAJ-I1-CLAIM".
// '.' and '/' are boundary characters too: queue ids are unconstrained strings
// (§2.4 types them as plain strings), so without them "I1" matched INSIDE
// "I1.2" and blocked the wrong item.
const ID_BOUNDARY = /[A-Za-z0-9_./-]/;

/** True iff `text` names `id` as a standalone token. */
function mentionsId(text: string, id: string): boolean {
  if (id.trim().length === 0) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(id, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : text.charAt(at - 1);
    const after = text.charAt(at + id.length); // "" past the end of the string
    if (!ID_BOUNDARY.test(before) && !ID_BOUNDARY.test(after)) return true;
    from = at + 1;
  }
}

// Prose punctuation that can wrap a path inside a sentence: stripped from each
// end so "…in src/beta/parse.ts, which…" still yields the bare path. Curly
// quotes are included — an editor that smart-quotes a plan must not make its
// citations invisible to the mapping.
const LEADING_PUNCTUATION = /^["'`([{<“”‘’]+/;
const TRAILING_PUNCTUATION = /["'`)\]}>,;:!?.“”‘’]+$/;
// "src/beta/parse.ts's reader" — the possessive is prose, not part of the path.
const POSSESSIVE = /['’]s$/;
// "src/beta/parse.ts:118", ":118:14", ":118-140" — the compiler/editor citation
// form, and the one a reviewer reaches for most because their tools print it.
// The numbers say WHERE in the file to look; the path half is the citation, and
// keeping them joined made the whole token stop being file-shaped, so the most
// precise way of naming a file resolved to nothing at all.
const LINE_SUFFIX = /:\d+(?:[:-]\d+)?$/;

// A path-shaped token: either it carries a directory separator, or it is a bare
// dotted filename ("parse.ts"). Everything else in a sentence is a word.
const DOTTED_FILENAME = /^[A-Za-z0-9_@~+-]+(?:\.[A-Za-z0-9_+-]+)+$/;
// The wildcard constructs core/shell-parse.ts's literalHead breaks on. A token
// whose FIRST segment carries one has an empty literal head, which intersects
// every scope — such a token is dropped rather than allowed to block the queue.
const WILDCARD = /[*?{[]/;

/**
 * Every FILE-shaped token in `text`, de-duplicated, in first-seen order.
 *
 * "File-shaped" is the load-bearing word, and it is stricter than "path-shaped"
 * for a reason discovered the hard way: core/shell-parse.ts's scopesIntersect
 * compares literal-head PREFIXES segment-wise, so a head with fewer segments
 * prefixes every longer one. A bare directory token therefore has exactly the
 * blast radius the wildcard guard was written to prevent — one sentence saying
 * "both items write into src/" matched EVERY item and blocked the whole queue,
 * nullifying §3.2's "the run proceeds on the remaining items". So a token counts
 * only when its LAST segment is a real dotted filename and no segment carries a
 * wildcard: "src/beta/parse.ts" and "parse.ts" qualify; "src/", "src/**",
 * "src/beta/*.ts" and "tests/" do not.
 *
 * The other half is the opposite failure: the ordinary ways a reviewer cites a
 * file — "./src/x.ts", a bare filename, a markdown link, a comma-joined list, a
 * possessive, smart quotes, a "path:line" citation — all resolved to nothing, so
 * a surviving major blocked no item and the run executed what the review
 * condemned. Each of those shapes is normalised here.
 */
export function pathLikeTokens(text: string): string[] {
  // "[the parser](src/beta/parse.ts)" -> the path becomes its own token.
  const normalised = text.replace(/\]\(/g, " ");
  const tokens: string[] = [];
  // Commas and semicolons separate citations as often as spaces do.
  for (const raw of normalised.split(/[\s,;]+/)) {
    let token = raw.replace(LEADING_PUNCTUATION, "").replace(TRAILING_PUNCTUATION, "");
    token = token.replace(POSSESSIVE, "");
    token = token.replace(LINE_SUFFIX, ""); // "parse.ts:118" cites parse.ts
    token = token.replace(/^\.\//, ""); // "./src/x.ts" and "src/x.ts" are one path
    if (token.length === 0) continue;
    if (!token.includes("/") && !DOTTED_FILENAME.test(token)) continue;
    const segments = token.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) continue; // a bare "/" names nothing
    if (segments.some((segment) => WILDCARD.test(segment))) continue; // over-matches
    // The last segment must be a real filename — this is what keeps a bare
    // directory from prefix-matching the entire queue.
    if (!DOTTED_FILENAME.test(segments[segments.length - 1])) continue;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/** The final segment of a path ("src/beta/parse.ts" -> "parse.ts"). */
function basenameOf(pathLike: string): string {
  const segments = pathLike.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : pathLike;
}

/**
 * The queue items a plan-level finding blocks, in queue order and without
 * duplicates: those whose id the finding's claim/evidence names as a token, plus
 * those whose fileScope a path named there intersects (core scopesIntersect).
 * An empty result is a legal answer — the finding still owes a question, it just
 * blocks no item.
 */
export function findingBlocksItems(
  finding: FindingReference,
  items: readonly BlockableItem[],
): string[] {
  const text = finding.claim + "\n" + finding.evidence;
  const tokens = pathLikeTokens(text);
  const blocked: string[] = [];
  for (const item of items) {
    if (blocked.includes(item.id)) continue; // a duplicate queue id names one item
    if (mentionsId(text, item.id)) {
      blocked.push(item.id);
      continue;
    }
    const scope = [...item.fileScope];
    for (const token of tokens) {
      // A token carrying a directory is judged by the same conservative overlap
      // rule the wave scheduler uses; a BARE filename ("parse.ts") cannot be —
      // its literal head would never prefix "src/beta/parse.ts" — so it is
      // matched against each scope's basename instead. Both arms fold case, so
      // an id and a path never disagree about it.
      const matched = token.includes("/")
        ? scopesIntersect([token], scope)
        : scope.some((entry) => basenameOf(entry).toLowerCase() === token.toLowerCase());
      if (matched) {
        blocked.push(item.id);
        break;
      }
    }
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// §3.3 review-fix routing — which role a surviving finding's fix is dispatched to
// ---------------------------------------------------------------------------
//
// Pure scope policy, so it lives here rather than inline in the review handler,
// where it was a second derivation nobody could test against a refusal.
//
// The defect that moved it (ISSUE-054): the inline version asked
// `suggestedFix.includes(scopeEntry)` over RAW scope entries, which are globs. A
// fix naming a concrete test file does not contain the literal "tests/parser/**",
// so a test defect routed to the IMPLEMENTER — whose edit gate is bound to
// fileScope, making the dispatch a guaranteed denial: three wasted rounds and a
// surfaced question, exactly what §3.3 warns about.
//
// The rule here matches PATHS: every file-shaped token in the prose is matched
// against each scope entry as a glob. The literal containment test is KEPT as a
// second arm, so a fix that quotes a literal scope entry verbatim routes exactly
// as it always did — this widens the matcher, it never narrows it.

export interface FixRouting {
  testWriter: boolean;
  implementer: boolean;
}

export interface FixScopes {
  fileScope: readonly string[];
  testScope: readonly string[];
}

/** True when `fix` names a path that `scope` covers, by glob or by quotation. */
function fixNamesScope(fix: string, scope: readonly string[], tokens: readonly string[]): boolean {
  for (const entry of scope) {
    if (entry.length === 0) continue;
    if (fix.includes(entry)) return true;
    for (const token of tokens) {
      if (globMatch(entry, token)) return true;
    }
  }
  return false;
}

/**
 * Which write-capable role(s) a surviving §2.10 finding's fix is dispatched to
 * (§3.3): a test-adequacy finding — and any fix whose prose names a testScope
 * path — is the test-writer's; a fix that names both scopes goes to both;
 * everything else is the implementer's.
 */
export function routeFix(
  suggestedFix: string,
  scopes: FixScopes,
  opts: { testAdequacyLens: boolean },
): FixRouting {
  const tokens = pathLikeTokens(suggestedFix);
  const namesTest = fixNamesScope(suggestedFix, scopes.testScope, tokens);
  const namesFile = fixNamesScope(suggestedFix, scopes.fileScope, tokens);
  if (opts.testAdequacyLens || namesTest) {
    return { testWriter: true, implementer: namesFile };
  }
  return { testWriter: false, implementer: true };
}

// ---------------------------------------------------------------------------
// plan.md doctrine (§3.2 PLANNED, plan lines 1112-1117)
// ---------------------------------------------------------------------------

// "no placeholders — 'TBD', 'add error handling', 'similar to task N' are plan
// defects by name" (plan line 1115). The three named defects plus the shapes
// that are the same defect wearing another word.
//
// Every rule here is SHAPE-matched, not word-matched. A plan must be able to
// DESCRIBE placeholder-shaped work ("add an input whose placeholder attribute
// reads 'name'", "remove the TODO comments left in src/x.ts") without being
// condemned for it — a bare-word scan rejected conforming plans, burned the one
// bounded re-prompt, and then wedged the run.
const PLAN_PLACEHOLDERS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "TBD", pattern: /\bTBD\b/i },
  { label: "to be determined/decided", pattern: /\bto\s+be\s+(?:determined|decided)\b/i },
  // A comment-marker shape ("TODO:", a line that STARTS with TODO), never the
  // bare word inside a sentence.
  {
    label: "TODO/FIXME/XXX marker",
    pattern: /(?:\b(?:TODO|FIXME|XXX)\s*:)|(?:(?:^|\n)[ \t]*(?:\/\/|#|\*)?[ \t]*(?:TODO|FIXME|XXX)\b)/,
  },
  { label: "add error handling", pattern: /\badd\s+error\s+handling\b/i },
  {
    label: "similar to task N",
    pattern: /\bsimilar\s+to\s+(?:task|item|step|the\s+above)\b/i,
  },
  // Placeholder USAGE, not the word: "<placeholder>", "[placeholder]",
  // "placeholder for the real X", "as a placeholder".
  {
    label: "a placeholder stands in for real content",
    pattern: /<placeholder>|\[placeholder\]|\bplaceholder\s+(?:for|here|text|value)\b|\bas\s+a\s+placeholder\b/i,
  },
  { label: "and so on / etc.", pattern: /\b(?:and\s+so\s+on\b)|,\s*etc\.?/i },
];

// The rejected shapes BY LABEL — the same strings scanPlaceholders reports. The
// doctrine that warns a planner about them (doctrine/plan.md's self-check, which
// the conductor_plan dispatch prompt carries verbatim) must name every one, and
// conductor/tests/doctrine-mechanics.test.ts checks it by running the scanner
// above over that section: the doctrine is judged by the rejector itself rather
// than by a second copy of this list, so a rule added here cannot drift out of the
// doctrine that has to teach it.
export const PLAN_PLACEHOLDER_LABELS: readonly string[] = PLAN_PLACEHOLDERS.map(
  (rule) => rule.label,
);

// A bare "..." line is an ELISION in prose but idiomatic INSIDE a fenced code
// block (Python stubs, YAML markers), so the elision rule is judged against the
// document with its fenced blocks removed.
const ELISION_LINE = /(?:^|\n)[ \t]*(?:\.\.\.|…)[ \t]*(?:\n|$)/;

function stripFencedCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "\n");
}

/**
 * The plan.md placeholder defects present in a plan document, by name (an empty
 * array means the plan is clean). An empty/whitespace document is itself the
 * defect — a plan that says nothing has elided everything.
 */
export function scanPlaceholders(markdown: string): string[] {
  if (markdown.trim().length === 0) {
    return ["the plan document is empty: plan.md must carry the per-item plan (§3.2)"];
  }
  const found: string[] = [];
  for (const rule of PLAN_PLACEHOLDERS) {
    if (rule.pattern.test(markdown)) found.push(rule.label);
  }
  if (ELISION_LINE.test(stripFencedCode(markdown))) {
    found.push("elided content (a bare ... line outside a code fence)");
  }
  return found;
}
