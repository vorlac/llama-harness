// conductor/tests/scope-seams.test.ts — Phase II.2b of the fix campaign: the SCOPE
// seams. Every row PERFORMS the escape the register recorded and asserts the
// refusal, so a fix that is reasoned rather than wired fails here.
//
//   GAP-009 / ISSUE-011 — a wildcard-headed fileScope ("**" and its cousins) made
//     §2.6.1's `missing-subject` class vacuous (globMatch("**", anySpecifier) is
//     true, so a test that merely imports a nonexistent module was a harness-
//     blessed legal RED asserting nothing) and handed the item's implementer an
//     edit grant over the whole repository. validateQueue accepted it: no breadth
//     cap, no wildcard-head rejection.
//
//   GAP-009 / ISSUE-012 — the §3.2 item size budget counted fileScope ENTRIES, so
//     `["src/**"]` counted ONE and granted edit permission over the whole subtree.
//     The budget is now measured on the files the scope MATCHES.
//
//   Read-set token bound (owner decision, new mechanism) — a 32k local model
//     cannot be dispatched into a scope it cannot read. The item's read cost is
//     estimated at queue acceptance (matched bytes / 4) against a configured
//     budget, and an item over it is refused with the estimate named.
//
//   ISSUE-071 (rider) — the §3.3 commit template embeds the model-authored item
//     id and each fileScope entry raw, so a newline in either injects a fabricated
//     "Red proof:" line into the commit record. Both are refused at admission: an
//     id must match ^[A-Za-z0-9_-]+$ and a scope entry may carry no newline.
//
//   GAP-010 / ISSUE-008 / ISSUE-054 — inter-item scope disjointness became an
//     authoring-time refusal instead of a silent hole (two items whose fileScopes
//     overlap are a write-territory conflict), an item may no longer declare its
//     own test inside its write scope, and `routeOf` — pure scope policy that lived
//     inline in a handler closure and matched RAW scope strings inside
//     `suggestedFix` — is core `routeFix`, glob-aware.
//
//   Attempt cap (owner decision, new mechanism) — `conductor_mark_green` dispatched
//     one implementer per call and counted only the SUCCESSES, so an orchestrator
//     could re-call it forever: an unbounded implementer loop with no disposition.
//     The dispatches are now counted and bounded, and exhaustion takes the item to
//     its blocked path with a reason that NAMES the exhaustion.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// ---- the subjects ---------------------------------------------------------
import { handleClassify, handleDecompose, handleMarkGreen } from "../adapter/tools.ts";
import type { MarkGreenResult } from "../adapter/tools.ts";
import {
  DEFAULT_IMPLEMENTER_ATTEMPTS,
  DEFAULT_READ_SET_TOKEN_BUDGET,
  ITEM_MAX_FILES,
  routeFix,
  validateQueue,
} from "../core/planning.ts";

// ---- committed machinery these rows compose over --------------------------
import { buildCommitMessage } from "../core/commit-message.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { validate } from "../core/types.ts";
import type {
  Classification,
  ClassificationCheck,
  Config,
  Item,
  ItemState,
  Queue,
  QueueItem,
  TreePath,
  TrivialItem,
} from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

const START_MS = 1_755_400_000_000;
const SCOPE = "unitSCP01";
const WORKSPACE_KEY = "wkeySCP01";

// ---------------------------------------------------------------------------
// Harness (the 9.2 / admission-seams shape).
// ---------------------------------------------------------------------------

interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}

interface JournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
  flushSync: () => void;
}

function makeJournal(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  return {
    records,
    sink: {
      log(level, component, event, data, corr): void {
        records.push({ level, component, event, data, corr });
      },
      flushSync(): void {
        /* nothing buffered */
      },
    },
  };
}

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-scope-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

const GREEN_CMD = [process.execPath, "-e", "0"];

interface ConfigOverrides {
  behavioralPaths?: string[];
  readSetTokenBudget?: number;
  implementerAttempts?: number;
  itemTest?: string[];
  command?: string[];
}

function makeConfig(opts: ConfigOverrides = {}): Config {
  const scope: { command: string[]; timeoutMs: number; itemTest?: string[] } = {
    command: [...(opts.command ?? GREEN_CMD)],
    timeoutMs: 120_000,
    ...(opts.itemTest !== undefined ? { itemTest: [...opts.itemTest] } : {}),
  };
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: scope },
      behavioralPaths: opts.behavioralPaths ?? [],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
      ...(opts.readSetTokenBudget === undefined ? {} : { readSetTokenBudget: opts.readSetTokenBudget }),
      ...(opts.implementerAttempts === undefined ? {} : { implementerAttempts: opts.implementerAttempts }),
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

// `classified` models which run this is: one the classifier has already spoken for
// (every decompose bench below, since the INTAKE edge reads that receipt and would
// otherwise refuse before the scope rules under test are reached), or a fresh one
// whose classifier is still to run (the classify benches, which assert that a
// refused trivialItem leaves the receipt unset so the classifier gets another roll).
function createIntakeRun(store: StateStore, classified = false): string {
  const run = store.createRun({
    prompt: "make the beta parser keep the sign of negative offsets",
    sessionID: "ses_orchestrator",
    classification: { kind: "work", rationale: "a behavioural change", check: { agreed: true, note: "" } },
  });
  if (classified) {
    const recorded = store.loadRun(run.runId);
    recorded.classified = true;
    store.saveRun(recorded);
  }
  return run.runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

function makeQueueItem(id: string, over: Partial<QueueItem> = {}): QueueItem {
  const base: QueueItem = {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: ["src/beta.mjs"],
    testScope: ["tests/beta.test.mjs"],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
  return { ...base, ...over };
}

function makeRuntimeItem(id: string, state: ItemState): Item {
  return {
    id,
    state,
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
}

const OPEN_TREE: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

type CannedReply = string | (() => string);

// A fan-out over the fake SDK: each NEW sub-session gets the next canned reply,
// clamped to the last, and every dispatched role is recorded so a row can assert
// how many implementer sub-sessions were actually spent.
function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  script: Record<string, CannedReply[]>,
): { fanout: Fanout; dispatchedRoles: string[] } {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const dispatchedRoles: string[] = [];
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    dispatchedRoles.push(role);
    const replies = script[role] ?? [];
    if (replies.length === 0) return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    let idx = sessionIdx.get(req.sessionID);
    if (idx === undefined) {
      idx = nextByRole.get(role) ?? 0;
      nextByRole.set(role, idx + 1);
      sessionIdx.set(req.sessionID, idx);
    }
    const canned = replies[Math.min(idx, replies.length - 1)];
    return { kind: "reply", text: typeof canned === "function" ? canned() : canned };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );
  return { fanout, dispatchedRoles };
}

// The doctrine packs the dispatch prompts compose their slices out of, keyed
// exactly as adapter/inject.ts loadPacks keys them.
const DOCTRINE_PACKS: Record<string, string> = {};
{
  const doctrineDir = new URL("../doctrine/", import.meta.url);
  for (const name of readdirSync(doctrineDir)) {
    if (name.endsWith(".md")) DOCTRINE_PACKS[name] = readFileSync(new URL(name, doctrineDir), "utf8");
  }
}

function implJson(): string {
  return JSON.stringify({
    status: "DONE",
    summary: "applied the minimal change",
    concerns: [],
    neededContext: null,
    blockReason: null,
  });
}

// Drive a decompose whose planner answers with `queue` every time. Returns the
// rejection reason, or null when the queue was ACCEPTED.
async function decomposeRefusal(root: string, config: Config, queue: Queue): Promise<string | null> {
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createIntakeRun(store, true);
  const wiring = makeWiring(runId, config, journal.sink, { planner: [JSON.stringify(queue)] });
  try {
    await handleDecompose({
      store,
      fanout: wiring.fanout,
      runId,
      config,
      journal: journal.sink,
      packs: DOCTRINE_PACKS,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// A §2.10 trivialItem: a complete §2.4 item minus id/dependsOn, which is what the
// classifier authors and conductor_classify synthesizes queue.json out of.
function makeTrivialItem(over: Partial<TrivialItem> = {}): TrivialItem {
  const base: TrivialItem = {
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: ["src/beta.mjs"],
    testScope: ["tests/beta.test.mjs"],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "one-liner",
    },
  };
  return { ...base, ...over };
}

// What conductor_classify did with a `trivial` classification carrying `trivialItem`:
// the refusal (or null when it was accepted), what kind survived, and whether the
// synthesized queue.json reached the disk.
interface ClassifyOutcome {
  refusal: string | null;
  kind: string | null;
  queueWritten: boolean;
  classified: boolean;
}

async function classifyTrivial(
  root: string,
  config: Config,
  trivialItem: TrivialItem,
): Promise<ClassifyOutcome> {
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createIntakeRun(store);
  const classification: Classification = {
    kind: "trivial",
    rationale: "one small change to one file",
    confidence: "high",
    trivialItem,
  };
  const check: ClassificationCheck = { agreed: true, correctedKind: null, note: "one file, one function" };
  assert.equal(
    validate("Classification", classification).ok,
    true,
    "sanity: the classifier reply satisfies SCHEMAS.Classification, so a refusal below is the handler's",
  );
  const wiring = makeWiring(runId, config, journal.sink, {
    mechanical: [JSON.stringify(classification)],
    skeptic: [JSON.stringify(check)],
  });
  let refusal: string | null = null;
  let kind: string | null = null;
  try {
    kind = (
      await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: journal.sink })
    ).kind;
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  return {
    refusal,
    kind,
    queueWritten: existsSync(path.join(runDirOf(store, runId), "queue.json")),
    classified: store.loadRun(runId).classified === true,
  };
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// The violations validateQueue reports for one queue, with no measured scope facts
// (the SHAPE half, which is pure and needs no tree).
function shapeViolations(queue: Queue, config: Config = makeConfig()): string[] {
  return validateQueue(queue, config).violations;
}

// ---------------------------------------------------------------------------
// Fixture sanity (the 9.x probe-block discipline).
// ---------------------------------------------------------------------------

assert.equal(
  validate("Queue", { items: [makeQueueItem("I1")] }).ok,
  true,
  "sanity: the default queue fixture satisfies SCHEMAS.Queue",
);
assert.equal(
  validate("Queue", { items: [makeQueueItem("I1", { fileScope: ["**"] })] }).ok,
  true,
  "sanity: a wildcard-headed fileScope is SCHEMA-valid — the guard under test is a validateQueue rule, not a schema failure",
);
assert.equal(
  validateQueue({ items: [makeQueueItem("I1")] }, makeConfig()).ok,
  true,
  "sanity: the default queue fixture passes validateQueue, so every refusal below is about the row's escape",
);

// ===========================================================================
// GAP-009 / ISSUE-011 — the wildcard-headed fileScope
// ===========================================================================

test("[scope-wildcard-head] a wildcard-headed fileScope is REFUSED at queue acceptance: '**' (and its cousins) has an empty literal head, which makes §2.6.1's missing-subject class vacuous and hands the item's implementer an edit grant over the whole repository — while a scope with a real literal head is untouched", async () => {
  // THE ESCAPE, at every wildcard construct core's literalHead breaks on.
  for (const escape of ["**", "*", "**/*.ts", "*.ts", "{src,lib}/**", "[sl]ib/**"]) {
    const violations = shapeViolations({
      items: [makeQueueItem("I1", { fileScope: [escape], testScope: ["tests/beta.test.mjs"] })],
    }).filter((violation) => /wildcard/i.test(violation));
    assert.ok(
      violations.length > 0,
      `fileScope ${JSON.stringify([escape])} is wildcard-headed and must be refused`,
    );
    assert.ok(violations[0].includes(escape), `the refusal names the offending glob: ${violations[0]}`);
  }

  // THE GUARD IS NOT A GLOB BAN: a glob with a literal head still passes.
  assert.deepEqual(
    shapeViolations({
      items: [makeQueueItem("I1", { fileScope: ["src/parser/**"], testScope: ["tests/beta.test.mjs"] })],
    }).filter((violation) => /wildcard/i.test(violation)),
    [],
    "'src/parser/**' has a literal head and names a bounded subtree",
  );

  // …and the same escape performed through the REAL decompose handler: the planner
  // proposes it, the handler re-prompts once, the planner repeats it, and the run is
  // REJECTED rather than persisted.
  const root = scratchDir("wildcard");
  const reason = await decomposeRefusal(root, makeConfig(), {
    items: [makeQueueItem("I1", { fileScope: ["**"], testScope: ["tests/beta.test.mjs"] })],
  });
  assert.ok(reason !== null, "the decomposition is rejected, not persisted");
  assert.match(reason ?? "", /wildcard/i, "and the rejection names the wildcard-headed scope");
  assert.equal(
    existsSync(path.join(root, ".conductor", "runs")) &&
      readdirSync(path.join(root, ".conductor", "runs")).some((runId) =>
        existsSync(path.join(root, ".conductor", "runs", runId, "queue.json")),
      ),
    false,
    "nothing was written: legality precedes persist",
  );
});

// ===========================================================================
// GAP-009 / ISSUE-012 — the budget counts MATCHED FILES, not entries
// ===========================================================================

test("[scope-matched-files] the §3.2 item size budget is measured on the files the fileScope MATCHES, not on the number of entries: one broad glob standing for nine files is refused naming the count, and the same glob over two files is accepted", async () => {
  const root = scratchDir("budget");
  for (let n = 1; n <= 9; n += 1) writeFile(root, `src/f${String(n)}.ts`, `export const f${String(n)} = ${String(n)};\n`);

  const broad = makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["tests/beta.test.mjs"] });

  // CONTROL: the OLD rule cannot see this item at all — it counts ENTRIES, and there
  // is exactly one, comfortably inside the budget.
  assert.equal(broad.fileScope.length, 1, "control: the escape is ONE fileScope entry");
  assert.ok(broad.fileScope.length <= ITEM_MAX_FILES, "control: the entry-count budget admits it");

  const reason = await decomposeRefusal(root, makeConfig(), { items: [broad] });
  assert.ok(reason !== null, "an item whose glob matches nine files is refused");
  assert.match(reason ?? "", /9 files/, `the refusal names the MATCHED count: ${reason ?? ""}`);
  assert.match(reason ?? "", new RegExp(String(ITEM_MAX_FILES)), "and the budget it broke");

  // …and the measure is a budget, not a ban: the same glob shape over two files is fine.
  const narrowRoot = scratchDir("budget-ok");
  writeFile(narrowRoot, "src/small/a.ts", "export const a = 1;\n");
  writeFile(narrowRoot, "src/small/b.ts", "export const b = 2;\n");
  assert.equal(
    await decomposeRefusal(narrowRoot, makeConfig(), {
      items: [makeQueueItem("I1", { fileScope: ["src/small/**"], testScope: ["tests/beta.test.mjs"] })],
    }),
    null,
    "a glob matching two files is inside the item budget and is accepted",
  );
});

// ===========================================================================
// Read-set token bound (owner decision)
// ===========================================================================

test("[scope-read-set-budget] an item whose scope is bigger than the configured read-set token budget is REFUSED with the estimate named: a 32k local model cannot be dispatched into a scope it cannot read, and the bound is config-driven so the operator tunes it", async () => {
  const root = scratchDir("readset");
  // 4000 bytes of subject ⇒ an estimated 1000-token read set.
  writeFile(root, "src/big.ts", "x".repeat(4000));
  const item = makeQueueItem("I1", { fileScope: ["src/big.ts"], testScope: ["tests/beta.test.mjs"] });

  const reason = await decomposeRefusal(root, makeConfig({ readSetTokenBudget: 100 }), { items: [item] });
  assert.ok(reason !== null, "an item over the read-set budget is refused");
  assert.match(reason ?? "", /1000/, `the refusal names the ESTIMATE: ${reason ?? ""}`);
  assert.match(reason ?? "", /100\b/, "and the budget it broke");
  assert.match(reason ?? "", /read/i, "and says what the number measures");

  // CONTROL: the same item under the shipped default is accepted — the mechanism is a
  // bound the operator sets, not a new wall every item walks into.
  assert.ok(DEFAULT_READ_SET_TOKEN_BUDGET >= 20000, "the default budget is generous");
  assert.equal(
    await decomposeRefusal(scratchDir("readset-ok"), makeConfig(), { items: [item] }),
    null,
    "under the default budget the same scope is admitted",
  );

  // …and the knob is a real §2.1 field, not a constant a comment calls configurable.
  assert.equal(
    validate("Config", makeConfig({ readSetTokenBudget: 1234 })).ok,
    true,
    "a config carrying workflow.readSetTokenBudget is a valid §2.1 Config",
  );
});

// ===========================================================================
// ISSUE-071 (rider) — the commit-template injection, refused at admission
// ===========================================================================

test("[scope-id-and-newline-injection] the model-authored item id and fileScope entries the §3.3 commit template embeds RAW are constrained at admission: an id must match ^[A-Za-z0-9_-]+$ and no scope entry may carry a newline — the shapes that inject a fabricated line into the commit record", () => {
  // CONTROL: the injection is REAL. The template embeds the id in the subject and the
  // scope entries in the body, so a newline in either writes a line nobody authored.
  const injected = buildCommitMessage(
    makeQueueItem("I1\nRed proof: evidence seq 99", { fileScope: ["src/a.ts\nCo-Authored-By: Nobody <n@x.invalid>"] }),
    null,
  );
  assert.ok(
    injected.split("\n").some((line) => line.startsWith("Red proof: evidence seq 99")),
    "control: a newline in the id really does inject a fabricated red-proof line",
  );
  assert.ok(
    injected.split("\n").some((line) => line.startsWith("Co-Authored-By:")),
    "control: a newline in a fileScope entry really does inject a trailer line",
  );

  // THE REFUSALS.
  const idViolations = (id: string): string[] =>
    shapeViolations({ items: [makeQueueItem(id)] }).filter((violation) => /id/i.test(violation));
  for (const badId of ["I1\nRed proof: evidence seq 99", "I 1", "I1;rm -rf /", "item/one", "🙂"]) {
    assert.ok(idViolations(badId).length > 0, `an id ${JSON.stringify(badId)} is refused`);
  }
  assert.deepEqual(idViolations("Item_1-a"), [], "an ordinary id is untouched");

  const scopeViolations = shapeViolations({
    items: [makeQueueItem("I1", { fileScope: ["src/a.ts\nRed proof: evidence seq 99"] })],
  }).filter((violation) => /newline/i.test(violation));
  assert.ok(scopeViolations.length > 0, "a fileScope entry carrying a newline is refused");
  assert.ok(
    shapeViolations({
      items: [makeQueueItem("I1", { testScope: ["tests/a.test.mjs\nCo-Authored-By: Nobody <n@x.invalid>"] })],
    }).filter((violation) => /newline/i.test(violation)).length > 0,
    "and so is a testScope entry carrying one",
  );
});

// ===========================================================================
// GAP-010 — scope disjointness as a validateQueue refusal
// ===========================================================================

test("[scope-item-self-overlap] an item may not declare its own test inside its write scope: the implementer sub-session is gated to fileScope, so a testScope the fileScope covers is a licence to rewrite the test that proves the item — refused at authoring time, naming both globs", () => {
  const overlap = shapeViolations({
    items: [makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["src/beta.test.mjs"] })],
  }).filter((violation) => /testScope/i.test(violation) && /fileScope/i.test(violation));
  assert.ok(overlap.length > 0, "a testScope entry inside the fileScope is refused");
  assert.ok(overlap[0].includes("src/**"), `the refusal names the covering glob: ${overlap[0]}`);

  // The literal spelling of the same thing (the shape GAP-007's witness was built for).
  assert.ok(
    shapeViolations({
      items: [
        makeQueueItem("I1", {
          fileScope: ["src/beta.mjs", "tests/beta.test.mjs"],
          testScope: ["tests/beta.test.mjs"],
        }),
      ],
    }).filter((violation) => /testScope/i.test(violation) && /fileScope/i.test(violation)).length > 0,
    "naming the test file in BOTH scopes is the same licence, spelled literally",
  );

  // CONTROL: separated scopes are the ordinary shape and stay legal.
  assert.deepEqual(
    shapeViolations({
      items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })],
    }).filter((violation) => /testScope/i.test(violation) && /fileScope/i.test(violation)),
    [],
    "a production scope and a test scope that do not overlap are untouched",
  );
});

test("[scope-inter-item-overlap] two behavioral items whose fileScopes overlap are REFUSED at authoring time: overlapping write territory is a conflict the wave scheduler could only ever serialize around, and the rule was merely ASKED of the planner — the refusal names both items", () => {
  const violations = shapeViolations({
    items: [
      makeQueueItem("I1", { fileScope: ["src/parser/**"], testScope: ["tests/one.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/parser/lex.mjs"], testScope: ["tests/two.test.mjs"] }),
    ],
  }).filter((violation) => /overlap|disjoint/i.test(violation));
  assert.ok(violations.length > 0, "an item pair whose write scopes overlap is refused");
  assert.ok(violations[0].includes("I1") && violations[0].includes("I2"), `the refusal names BOTH items: ${violations[0]}`);

  // The exact-duplicate spelling of the same conflict.
  assert.ok(
    shapeViolations({
      items: [
        makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/one.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/beta.mjs"], testScope: ["tests/two.test.mjs"] }),
      ],
    }).filter((violation) => /overlap|disjoint/i.test(violation)).length > 0,
    "two items naming the SAME file are the same conflict",
  );

  // CONTROL: siblings in one directory are not an overlap — the rule must not
  // collapse every queue into a single item.
  assert.deepEqual(
    shapeViolations({
      items: [
        makeQueueItem("I1", { fileScope: ["src/parser/lex.mjs"], testScope: ["tests/one.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/parser/emit.mjs"], testScope: ["tests/two.test.mjs"] }),
      ],
    }).filter((violation) => /overlap|disjoint/i.test(violation)),
    [],
    "two items writing different files under one directory stay legal",
  );
});

// ===========================================================================
// ISSUE-054 — routeOf promoted to core, glob-aware
// ===========================================================================

test("[scope-route-fix-globs] review-fix routing is core policy and matches PATHS, not raw scope strings: a fix naming a concrete test file under a GLOB testScope routes to the test-writer instead of the implementer — the guaranteed edit-gate denial §3.3 warns about", () => {
  const scopes = { fileScope: ["src/parser/**"], testScope: ["tests/parser/**"] };

  // THE ESCAPE: the suggested fix names a real test file. The old inline routeOf asked
  // `fix.includes("tests/parser/**")`, which no sentence about a real file ever contains,
  // so a test defect was dispatched to the implementer — gated to fileScope, a certain deny.
  const routed = routeFix("the assertion in tests/parser/parse.test.ts pins the shape, not the behaviour", scopes, {
    testAdequacyLens: false,
  });
  assert.equal(routed.testWriter, true, "a fix naming a file under the testScope glob goes to the test-writer");
  assert.equal(routed.implementer, false, "and NOT to the implementer, whose edit gate would deny it");

  // A production fix under a glob fileScope still routes to the implementer only.
  const production = routeFix("src/parser/lex.ts drops the sign before the token is emitted", scopes, {
    testAdequacyLens: false,
  });
  assert.equal(production.implementer, true, "a production fix is the implementer's");
  assert.equal(production.testWriter, false, "and reaches no test-writer");

  // A fix that names BOTH goes to both, and the test-adequacy lens is always the
  // test-writer's regardless of what the prose names.
  const both = routeFix("src/parser/lex.ts must change and tests/parser/parse.test.ts must assert it", scopes, {
    testAdequacyLens: false,
  });
  assert.deepEqual(both, { testWriter: true, implementer: true }, "a fix naming both scopes routes to both");
  assert.equal(
    routeFix("tighten the assertion", scopes, { testAdequacyLens: true }).testWriter,
    true,
    "a test-adequacy finding is the test-writer's whatever its prose names",
  );

  // …and the handler USES the core rule rather than carrying a second copy of it.
  const adapterSource = readFileSync(new URL("../adapter/tools.ts", import.meta.url), "utf8");
  assert.match(adapterSource, /routeFix\(/, "adapter/tools.ts calls the core routing rule");
  assert.doesNotMatch(
    adapterSource,
    /const routeOf =/,
    "and no longer carries the inline closure ISSUE-054 was found in",
  );
});

// ===========================================================================
// Attempt cap (owner decision)
// ===========================================================================

// A test that RUNS and fails its assertion — a legal §2.6.1 red the implementer
// never fixes, so every mark_green attempt lands on the same failure.
const FAILING_TEST =
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'import { parse } from "../src/beta.mjs";\n' +
  'test("keeps the sign", () => {\n' +
  '  assert.equal(parse("-7"), -7, "SCOPE-SEAMS-ATTEMPT-CAP");\n' +
  "});\n";

const SIGN_DROPPING_SOURCE = "export function parse(text) {\n  return Math.abs(Number(text));\n}\n";

test("[scope-implementer-attempt-cap] the per-item implementer attempt count is BOUNDED: mark_green spends one implementer per call and the orchestrator could re-call it forever, so the dispatches are counted, the budget is config-driven, and exhaustion takes the item to its blocked path with a disposition NAMING the exhaustion instead of looping in silence", async () => {
  const root = scratchDir("attempts");
  const config = makeConfig({
    behavioralPaths: ["src/**"],
    implementerAttempts: 2,
    itemTest: [process.execPath, "--test", "{files}"],
  });
  assert.equal(validate("Config", config).ok, true, "sanity: workflow.implementerAttempts is a valid §2.1 field");
  assert.ok(DEFAULT_IMPLEMENTER_ATTEMPTS >= 1, "the shipped default is a real budget");

  writeFile(root, "src/beta.mjs", SIGN_DROPPING_SOURCE);
  writeFile(root, "tests/beta.test.mjs", FAILING_TEST);

  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const run = store.createRun({
    prompt: "keep the sign",
    sessionID: "ses_orchestrator",
    classification: { kind: "work", rationale: "behavioural", check: { agreed: true, note: "" } },
  });
  run.state = "EXECUTING";
  store.saveRun(run);
  const runId = run.runId;
  const runDir = runDirOf(store, runId);
  const queue: Queue = { items: [makeQueueItem("I1")] };
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  store.saveItem(runId, makeRuntimeItem("I1", "TEST_VETTED"));

  // An implementer that replies DONE and changes nothing — the "done by assertion"
  // receipt, so the item test stays red on every attempt.
  const wiring = makeWiring(runId, config, journal.sink, { implementer: [implJson()] });
  const markGreen = (): Promise<MarkGreenResult> =>
    handleMarkGreen({
      store,
      fanout: wiring.fanout,
      runId,
      itemId: "I1",
      config,
      journal: journal.sink,
      stateHome: scratchDir("attempts-state"),
      workspaceKey: WORKSPACE_KEY,
      now: () => START_MS,
    });

  const first = await markGreen();
  assert.equal(first.ok, false, "attempt 1 does not reach GREEN (the item test is red)");
  const second = await markGreen();
  assert.equal(second.ok, false, "attempt 2 does not reach GREEN either");
  const implementers = (): number => wiring.dispatchedRoles.filter((role) => role === "implementer").length;
  assert.equal(implementers(), 2, "control: the budget's worth of implementer sub-sessions really was spent");
  assert.equal(store.loadItem(runId, "I1").blocked, null, "control: the item is not blocked while budget remains");

  // THE ESCAPE: the third call. Under the old seam it dispatched a third implementer,
  // and a fourth, and a fifth — nothing counted the failures and nothing ever stopped.
  const third = await markGreen();
  assert.equal(third.ok, false, "the exhausted item does not advance");
  assert.equal(implementers(), 2, "and NO further implementer sub-session was spent");

  const blocked = store.loadItem(runId, "I1");
  assert.ok(blocked.blocked !== null, "the item is taken to its blocked path");
  assert.match(
    blocked.blocked?.reason ?? "",
    /exhaust/i,
    `the disposition NAMES the exhaustion: ${blocked.blocked?.reason ?? "(none)"}`,
  );
  assert.match(blocked.blocked?.reason ?? "", /2\b/, "and the budget it exhausted");
  assert.ok(third.questionId !== null, "a §2.11 question offers the human the unblock path");
  const asked = readQuestions(runDir).find((q) => q.id === third.questionId);
  assert.match(
    asked?.question ?? "",
    /attempt/i,
    `the question says what ran out: ${asked?.question ?? "(no question)"}`,
  );
});

// ===========================================================================
// The classifier's own door into queue.json — one acceptance authority
// ===========================================================================
//
// conductor_decompose puts the planner's queue through core validateQueue, so
// every §3.2 acceptance rule above (wildcard-headed globs, the matched-file size
// budget, the read-set token bound, id shape, inter-item disjointness) refuses a
// bad decomposition. conductor_classify synthesized queue.json from the
// classifier's `trivialItem` and checked it against the §2.4 SCHEMA and the
// trivial re-check only — so the whole table was bypassable by classifying the
// same request `trivial` instead of `work`. The scope the §3.6 edit gate then
// binds the implementer to comes from THAT queue, so the wildcard-head rule (the
// first row in this file) was optional from one role.

test("[scope-classify-uses-one-acceptance-authority] a `trivial` classification's synthesized queue.json passes through the SAME core validateQueue acceptance a decomposed queue does: a wildcard-headed fileScope is REFUSED from the classifier exactly as it is from the planner, and nothing reaches the disk", async () => {
  const config = makeConfig();

  // THE ESCAPE: the same "**" the [scope-wildcard-head] row refuses at decompose,
  // arriving as a trivialItem instead. Accepted, it wrote a queue.json whose one
  // item grants its implementer an edit over the whole tree.
  const escaped = await classifyTrivial(scratchDir("classify-wild"), config, makeTrivialItem({ fileScope: ["**"] }));
  assert.ok(
    escaped.refusal !== null,
    `a wildcard-headed trivial fileScope must be REFUSED, not synthesized (handler returned kind ${String(escaped.kind)})`,
  );
  assert.match(
    escaped.refusal ?? "",
    /wildcard-headed|every path in the repository/i,
    `and refused with core's OWN §3.2 reason, not a second spelling of it: ${escaped.refusal ?? ""}`,
  );
  assert.equal(escaped.queueWritten, false, "legality precedes persist: no queue.json was written");
  assert.equal(escaped.classified, false, "and the run records no classification, so the refusal is not also a wedge");

  // The same authority's read-set bound, which the trivial re-check has no notion
  // of at all: one file, inside the trivialMaxFiles budget, far too big to read.
  const heavy = scratchDir("classify-heavy");
  writeFile(heavy, "src/beta.mjs", "x".repeat(4000));
  const overRead = await classifyTrivial(
    heavy,
    makeConfig({ readSetTokenBudget: 10 }),
    makeTrivialItem({ fileScope: ["src/**"] }),
  );
  assert.ok(
    overRead.refusal !== null,
    `a trivial item whose scope cannot be read inside the budget must be REFUSED (handler returned kind ${String(overRead.kind)})`,
  );
  assert.match(
    overRead.refusal ?? "",
    /read set|readSetTokenBudget/i,
    `naming the bound it broke: ${overRead.refusal ?? ""}`,
  );
  assert.equal(overRead.queueWritten, false, "and still nothing reached the disk");

  // CONTROL: the ordinary trivial item is untouched — this is one acceptance
  // authority applied to both doors, not a ban on classifying anything trivial.
  const ok = await classifyTrivial(scratchDir("classify-ok"), config, makeTrivialItem());
  assert.equal(ok.refusal, null, `a legal trivial item still classifies: ${ok.refusal ?? ""}`);
  assert.equal(ok.kind, "trivial", "and stays trivial");
  assert.equal(ok.queueWritten, true, "and its synthesized queue.json is written");
});

test("[scope-inter-item-overlap-any-kind] overlapping WRITE territory is refused between ANY two items, not only behavioral pairs: the rule was keyed on `behavioral`, so a behavioral item and a non-behavioral one could both claim the same file — whichever published second would commit the other's edits", () => {
  // The pair the rule could not see: A writes source AND a doc, B writes that doc.
  const mixed = shapeViolations({
    items: [
      makeQueueItem("I1", { fileScope: ["src/foo.ts", "docs/x.md"], testScope: ["tests/one.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["docs/x.md"], testScope: [], behavioral: false }),
    ],
  }).filter((violation) => /overlap|disjoint/i.test(violation));
  assert.ok(mixed.length > 0, "a behavioral / non-behavioral pair over one file is the same conflict");
  assert.ok(
    mixed[0].includes("I1") && mixed[0].includes("I2"),
    `and the refusal names BOTH items: ${mixed[0]}`,
  );

  // Two NON-behavioral items over one file: neither is behavioral, so the old rule
  // skipped the pair twice over.
  assert.ok(
    shapeViolations({
      items: [
        makeQueueItem("I1", { fileScope: ["docs/x.md"], testScope: [], behavioral: false }),
        makeQueueItem("I2", { fileScope: ["docs/**"], testScope: [], behavioral: false }),
      ],
    }).filter((violation) => /overlap|disjoint/i.test(violation)).length > 0,
    "two non-behavioral items over one doc are one item wearing two ids",
  );

  // CONTROL: a non-behavioral item with territory of its OWN stays legal beside a
  // behavioral one — the rule is about overlap, not about mixing kinds.
  assert.deepEqual(
    shapeViolations({
      items: [
        makeQueueItem("I1", { fileScope: ["src/foo.ts"], testScope: ["tests/one.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["docs/x.md"], testScope: [], behavioral: false }),
      ],
    }).filter((violation) => /overlap|disjoint/i.test(violation)),
    [],
    "separate territories stay separate items",
  );
});
