// conductor/tests/vet-criteria.test.ts — Phase II.3 of the fix campaign:
// GAP-041 / ISSUE-013, the §2.10 TEST_VET criteria.
//
// TWO defects, one list behind both.
//
//   GAP-041 — the criteria the vet critic is SCORED on and the checklist
//     test-vet.md TEACHES were two unrelated lists. The critic scored five
//     criteria spelled inside two prompt literals in adapter/tools.ts; the pack
//     taught five mock anti-patterns (≈ one of the five criteria), and three of
//     the five scored criteria had no doctrine at all. A reader of the pack
//     prepared for a different examination than the one it sat.
//
//   ISSUE-013 — the verdicts gated NOTHING. `handleVetTest` advanced the item on
//     an empty `mustFix` union and never consulted the per-criterion verdicts, so
//     the self-contradictory receipt
//     `{verdictsByCriterion:{wouldCatchWrongImpl:{pass:false,…}}, mustFix:[]}`
//     carried the test to TEST_VETTED — the ambiguity resolving in the LESS strict
//     direction, against a critic's own written judgement.
//
// The honest boundary this file respects: the CONTENT of a critic's judgement is
// model judgement and stays trusted — nothing here checks whether a verdict is
// RIGHT. What binds is the harness's handling of the fields the critic DID
// return: a `pass:false` it wrote down cannot be erased by an empty `mustFix`.
//
// Anti-vacuity: row 1 counts each criterion name across the WHOLE pack (a
// hand-copied second list fails it, not just a missing one); row 2 asserts the
// dispatched prompt carries the pack's section BYTE-FOR-BYTE plus each
// criterion's doctrine sentence, so a prompt that merely re-lists the names
// fails; rows 3 and 4 perform the ISSUE-013 escape against the REAL handler over
// a real fixture repo and real child `node --test` processes.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TS; no skip/todo.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// THE SUBJECT — absent at red time.
import {
  VET_CRITERIA,
  VET_CRITERIA_HEADING,
  impliedMustFix,
  renderVetCriteria,
  vetCriterionNames,
} from "../core/vet-criteria.ts";

import { handleVetTest } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { SCHEMA_SHAPE_HEADING, createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { extractMechanics, packSection } from "../core/mechanics.ts";
import { readFanout } from "../core/schedule.ts";
import { SCHEMAS, validate } from "../core/types.ts";
import type { Config, EvidenceRecord, Item, ItemState, Queue, QueueItem, TreePath } from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// Fixture markers — each unique across the file.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "VETCRIT-TITLE-4471";
const ACCEPT_MARKER = "VETCRIT-ACCEPT-6620";
const RED_MARKER = "VETCRIT-RED-9038";
const TEST_V1_MARKER = "VETCRIT-TESTFILE-V1-1157";
const TEST_V2_MARKER = "VETCRIT-TESTFILE-V2-2264";
const FALLBACK_TRIPWIRE = "VETCRIT_FULL_SCOPE_FALLBACK_7781";

// The criterion the register names as load-bearing "at minimum".
const LOAD_BEARING = "wouldCatchWrongImpl";

const PROD_PARSER = "export function parse(text) {\n  return Math.abs(Number(text));\n}\n";

// A test that RUNS and fails its assertion → §2.6.1 class "assertion".
function assertionTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/parser.mjs";\n' +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7, "sign");\n' +
    "});\n"
  );
}

function readPack(name: string): string {
  return readFileSync(new URL(`../doctrine/${name}`, import.meta.url), "utf8");
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Handler harness (the tools-9.4a shape, reduced to what these rows need).
// ---------------------------------------------------------------------------

const START_MS = 1_754_560_000_000;

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

function makeJournal(): JournalSink {
  return {
    log(): void {
      /* the rows below read state, prompts and questions, never the journal */
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
}

function makeConfig(opts: { vetCritics?: number; vetMaxRounds?: number } = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        unit: {
          command: [
            process.execPath,
            "-e",
            `process.stderr.write(${JSON.stringify(FALLBACK_TRIPWIRE + "\n")}); process.exit(1);`,
          ],
          timeoutMs: 120_000,
          itemTest: [process.execPath, "--test", "{files}"],
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: opts.vetCritics ?? 1,
      vetMaxRounds: opts.vetMaxRounds ?? 1,
      testRepairAttempts: 2,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 2, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-vetcrit-"));
  tmpDirs.push(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "parser.mjs"), PROD_PARSER);
  return dir;
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

function makeQueueItem(id: string): QueueItem {
  return {
    id,
    title: `keep the sign of negative offsets (${TITLE_MARKER})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: ["src/**"],
    testScope: ["tests/p.test.mjs"],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

interface Bench {
  store: StateStore;
  runId: string;
  runDir: string;
  root: string;
}

function seedVetBench(root: string, config: Config, sink: JournalSink): Bench {
  const store = openStore(root, sink, config);
  const run = store.createRun({
    prompt: "make the beta parser keep the sign of negative offsets",
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  const runId = run.runId;
  const runDir = path.join(store.root, ".conductor", "runs", runId);
  const loaded = store.loadRun(runId);
  loaded.state = "EXECUTING";
  store.saveRun(loaded);
  const queue: Queue = { items: [makeQueueItem("I1")] };
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  store.saveItem(runId, makeRuntimeItem("I1", "RED"));
  writeFileSync(path.join(root, "tests", "p.test.mjs"), assertionTest(TEST_V1_MARKER));
  const record: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "red",
    itemId: "I1",
    command: [process.execPath, "--test", "tests/p.test.mjs"],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER}\n\n7 !== -7`,
    failureClass: "assertion",
    targeted: true,
  };
  assert.equal(validate("EvidenceRecord", record).ok, true, "sanity: the seeded red is a schema-valid §2.6 record");
  writeFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  return { store, runId, runDir, root };
}

type CannedReply = string | ((promptText: string) => string);
interface PromptedRecord {
  role: string;
  text: string;
  sessionID: string;
}
interface Wiring {
  fanout: Fanout;
  prompted: PromptedRecord[];
  byRole: (role: string) => PromptedRecord[];
}

function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  script: { testWriter: CannedReply[]; reviewer: CannedReply[] },
): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    prompted.push({ role, text: req.text, sessionID: req.sessionID });
    const queue = role === "testWriter" ? script.testWriter : role === "reviewer" ? script.reviewer : [];
    if (queue.length === 0) return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    let idx = sessionIdx.get(req.sessionID);
    if (idx === undefined) {
      idx = nextByRole.get(role) ?? 0;
      nextByRole.set(role, idx + 1);
      sessionIdx.set(req.sessionID, idx);
    }
    const canned = queue[Math.min(idx, queue.length - 1)];
    return { kind: "reply", text: typeof canned === "function" ? canned(req.text) : canned };
  });
  const tree: TreeState = {
    isFrozen(): boolean {
      return false;
    },
    onClear(): () => void {
      return () => undefined;
    },
  };
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    tree,
    runId,
  );
  return { fanout, prompted, byRole: (role: string) => prompted.filter((p) => p.role === role) };
}

// The §2.10 IMPLEMENTER RESULT receipt a testWriter dispatch replies with.
function implJson(): string {
  return JSON.stringify({
    status: "DONE",
    summary: "rewrote the test",
    concerns: [],
    neededContext: null,
    blockReason: null,
  });
}

// A §2.10 TEST_VET receipt with EXPLICIT per-criterion verdicts, so a row can put
// a `pass:false` beside an EMPTY mustFix — the receipt ISSUE-013 is about.
function vetJson(opts: { failing?: readonly string[]; mustFix?: readonly string[] } = {}): string {
  const failing = new Set(opts.failing ?? []);
  const verdicts: Record<string, { pass: boolean; note: string }> = {};
  for (const criterion of vetCriterionNames()) {
    verdicts[criterion] = failing.has(criterion)
      ? { pass: false, note: `the test does not satisfy ${criterion}` }
      : { pass: true, note: `satisfies ${criterion}` };
  }
  return JSON.stringify({ verdictsByCriterion: verdicts, mustFix: [...(opts.mustFix ?? [])] });
}

// A test-writer responder that rewrites the test file and replies with the receipt.
function writerWrites(repo: string, content: string): CannedReply {
  return (): string => {
    writeFileSync(path.join(repo, "tests", "p.test.mjs"), content);
    return implJson();
  };
}

// Fixture sanity (the 9.x probe-block discipline).
assert.equal(
  validate("TestVet", JSON.parse(vetJson()) as unknown).ok,
  true,
  "sanity: a clean critic receipt satisfies SCHEMAS.TestVet",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson({ failing: [LOAD_BEARING] })) as unknown).ok,
  true,
  "sanity: the SELF-CONTRADICTORY receipt (a pass:false beside an empty mustFix) is SCHEMA-VALID — " +
    "which is exactly why the schema cannot be what refuses it",
);

// ===========================================================================
// Row 1 — GAP-041: one list behind the schema and the pack.
// ===========================================================================

test("[vet-criteria-one-list] the §2.10 criteria have ONE source: SCHEMAS.TestVet's required keys ARE the list, the pack's checklist is that same list GENERATED (doctrine included), and no criterion is spelled a second time anywhere in the pack", () => {
  // (a) the list is non-empty and carries doctrine, not just names.
  assert.ok(VET_CRITERIA.length >= 5, "the §2.10 criteria list is populated");
  for (const criterion of VET_CRITERIA) {
    assert.ok(criterion.name.length > 0, "every criterion is named");
    assert.ok(criterion.rule.trim().length > 0, `${criterion.name} carries the rule the critic scores it by`);
    assert.ok(
      criterion.doctrine.trim().length > 0,
      `${criterion.name} carries doctrine — GAP-041's defect was three scored criteria with none`,
    );
  }

  // (b) the SCHEMA derives from the list: the keys the fan-out engine validates a
  //     critic receipt against are exactly the criteria, in order.
  const schema = SCHEMAS.TestVet as {
    properties?: { verdictsByCriterion?: { required?: unknown; properties?: Record<string, unknown> } };
  };
  const required = schema.properties?.verdictsByCriterion?.required;
  assert.deepEqual(
    required,
    vetCriterionNames(),
    "SCHEMAS.TestVet's verdictsByCriterion.required IS the criteria list, in order",
  );
  assert.deepEqual(
    Object.keys(schema.properties?.verdictsByCriterion?.properties ?? {}),
    vetCriterionNames(),
    "…and so are its property keys — no criterion scored that the list does not name",
  );

  // (c) the PACK carries that same list, generated: the section lives inside the
  //     generated block and equals a fresh derivation byte-for-byte.
  const pack = readPack("test-vet.md");
  const generated = extractMechanics(pack);
  assert.notEqual(generated, null, "test-vet.md carries a generated block");
  assert.ok(
    (generated ?? "").includes(renderVetCriteria()),
    "test-vet.md's generated block carries the criteria section VERBATIM — regenerate the packs " +
      "rather than editing the checklist by hand",
  );
  assert.equal(
    packSection(pack, VET_CRITERIA_HEADING),
    renderVetCriteria(),
    `packSection(test-vet.md, "${VET_CRITERIA_HEADING}") must read back exactly the derived section`,
  );

  // (d) ONE list, not two: each criterion name appears exactly once in the whole
  //     pack, so a hand-copied second checklist fails this row as loudly as a
  //     missing one — and each criterion's doctrine reached the pack.
  for (const criterion of VET_CRITERIA) {
    assert.equal(
      occurrences(pack, criterion.name),
      1,
      `"${criterion.name}" appears exactly once in test-vet.md (a second spelling is the GAP-041 defect)`,
    );
    assert.ok(
      pack.includes(criterion.doctrine),
      `test-vet.md teaches ${criterion.name}'s doctrine, not only its name`,
    );
  }
});

// ===========================================================================
// Row 2 — GAP-041: the critic prompt is composed from that same list.
// ===========================================================================

test("[vet-criteria-prompt-composed] the dispatched vet-critic prompt carries the pack's criteria section BYTE-FOR-BYTE — names, rules and doctrine — so the examination a critic sits is the checklist the pack teaches", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ vetCritics: 1, vetMaxRounds: 1 });
    const journal = makeJournal();
    const bench = seedVetBench(root, config, journal);
    assert.equal(readFanout("vet", config), 1, "premise: exactly one critic is dispatched");

    const wiring = makeWiring(bench.runId, config, journal, {
      testWriter: [],
      reviewer: [vetJson()],
    });
    const res = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal,
      now: () => START_MS,
    });
    assert.equal(res.ok, true, "premise: a clean receipt still advances the item");

    const critics = wiring.byRole("reviewer");
    assert.equal(critics.length, 1, "one critic prompt to inspect");
    // The engine appends the receipt's SHAPE, rendered from the schema, after the
    // brief. That block declares field names and types; it teaches no criterion,
    // and the one-list rule below is about the criteria doctrine, so the brief is
    // what it is asserted over. That the shape arrives at all is asserted too:
    // dropping it is what let a live sub-session guess an enum it had never seen.
    const composed = critics[0].text;
    const shapeAt = composed.indexOf(SCHEMA_SHAPE_HEADING);
    assert.notEqual(shapeAt, -1, "the dispatch carries the shape its receipt is judged against");
    const prompt = composed.slice(0, shapeAt);

    const section = packSection(readPack("test-vet.md"), VET_CRITERIA_HEADING);
    assert.notEqual(section, null, "premise: the pack carries the criteria section");
    assert.ok(
      prompt.includes(section ?? ""),
      "the critic prompt carries the pack's criteria section verbatim — it never re-spells the rules",
    );
    for (const criterion of VET_CRITERIA) {
      assert.equal(
        occurrences(prompt, criterion.name),
        1,
        `the prompt names "${criterion.name}" exactly once (one list reached it, not two)`,
      );
      assert.ok(
        prompt.includes(criterion.doctrine),
        `the prompt carries ${criterion.name}'s DOCTRINE, not just its name`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Row 3 — ISSUE-013: the verdicts BITE (the escape, performed).
// ===========================================================================

test("[vet-criteria-bite-refuses-advance] THE ESCAPE: a schema-valid critic receipt failing wouldCatchWrongImpl with an EMPTY mustFix does NOT reach TEST_VETTED — the item stays RED, the returned mustFix names the failed criterion, and at the round cap the §2.11 question names it too", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ vetCritics: 1, vetMaxRounds: 1 });
    const journal = makeJournal();
    const bench = seedVetBench(root, config, journal);

    const wiring = makeWiring(bench.runId, config, journal, {
      testWriter: [],
      // The ISSUE-013 receipt: a written-down failure with no repair asked for.
      reviewer: [vetJson({ failing: [LOAD_BEARING], mustFix: [] })],
    });
    const res = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal,
      now: () => START_MS,
    });

    assert.equal(res.ok, false, "a failed load-bearing criterion refuses the advance");
    assert.notEqual(res.itemState, "TEST_VETTED", "the test is NOT vetted on a verdict that failed");
    assert.equal(
      bench.store.loadItem(bench.runId, "I1").state,
      "RED",
      "the PERSISTED item is still RED — nothing advanced on disk either",
    );
    assert.ok(
      res.mustFix.some((entry) => entry.includes(LOAD_BEARING)),
      `the refusal NAMES the failed criterion: ${JSON.stringify(res.mustFix)}`,
    );

    // The tally the compact return carries agrees with the receipt that was read.
    const row = res.verdicts.find((v) => v.criterion === LOAD_BEARING);
    assert.notEqual(row, undefined, "the tally carries a row for the failed criterion");
    assert.equal(row?.failed, 1, "…and counts the critic's own pass:false");

    // At vetMaxRounds=1 the round cap fires: blocked + one §2.11 question that
    // names the criterion, so a human reading the question knows what failed.
    assert.notEqual(res.questionId, null, "the round cap minted the §2.11 question");
    const questions = readQuestions(bench.runDir);
    const question = questions.find((q) => q.id === res.questionId);
    assert.notEqual(question, undefined, "the question is on disk");
    assert.ok(
      (question?.question ?? "").includes(LOAD_BEARING),
      "the question names the criterion the critic failed",
    );
    assert.notEqual(bench.store.loadItem(bench.runId, "I1").blocked, null, "the item is blocked at the cap");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Row 4 — ISSUE-013: the test goes BACK FOR REPAIR naming the criterion.
// ===========================================================================

test("[vet-criteria-bite-repairs] below the round cap the same receipt sends the test back to the writer, and the repair dispatch NAMES the failed criterion; a clean second round then advances it", async () => {
  const root = scratchRepo();
  try {
    const config = makeConfig({ vetCritics: 1, vetMaxRounds: 2 });
    const journal = makeJournal();
    const bench = seedVetBench(root, config, journal);

    const wiring = makeWiring(bench.runId, config, journal, {
      testWriter: [writerWrites(root, assertionTest(TEST_V2_MARKER))],
      reviewer: [vetJson({ failing: [LOAD_BEARING], mustFix: [] }), vetJson()],
    });
    const res = await handleVetTest({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal,
      now: () => START_MS,
    });

    const writers = wiring.byRole("testWriter");
    assert.equal(writers.length, 1, "the failed criterion produced exactly ONE repair re-dispatch");
    assert.ok(
      writers[0].text.includes(LOAD_BEARING),
      "the repair prompt names the criterion the test must satisfy, not merely 'the critics objected'",
    );
    assert.ok(
      writers[0].text.includes(TEST_V1_MARKER),
      "the repair prompt carries the test as it stands",
    );

    assert.equal(res.rounds, 2, "the refusal cost a round: round 1 repaired, round 2 judged the repair");
    assert.equal(res.ok, true, "a clean second round advances the repaired test");
    assert.equal(res.itemState, "TEST_VETTED", "…to TEST_VETTED");
    assert.equal(
      readFileSync(path.join(root, "tests", "p.test.mjs"), "utf8").includes(TEST_V2_MARKER),
      true,
      "the vetted test is the REPAIRED one",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Row 5 — the rule itself, at the seam both vet paths share.
// ===========================================================================

test("[vet-criteria-implied-mustfix] impliedMustFix binds ONLY the fields a critic returned: a pass:false with no mustFix becomes a repair naming that criterion, a critic that named its own repairs is left alone, and an all-pass receipt implies nothing", () => {
  const verdicts = (failing: readonly string[]): Record<string, { pass: boolean; note: string }> => {
    const out: Record<string, { pass: boolean; note: string }> = {};
    for (const name of vetCriterionNames()) {
      out[name] = failing.includes(name) ? { pass: false, note: `note for ${name}` } : { pass: true, note: "" };
    }
    return out;
  };

  // The approval stays an approval: nothing is invented for a clean receipt.
  assert.deepEqual(
    impliedMustFix({ verdictsByCriterion: verdicts([]), mustFix: [] }),
    [],
    "an all-pass receipt with an empty mustFix implies NOTHING — the empty mustFix is still the approval",
  );

  // The contradiction becomes a repair that names the criterion and carries the
  // critic's own note (the harness adds no judgement of its own).
  const implied = impliedMustFix({ verdictsByCriterion: verdicts([LOAD_BEARING]), mustFix: [] });
  assert.equal(implied.length, 1, "exactly one implied repair, for the one criterion that failed");
  assert.ok(implied[0].includes(LOAD_BEARING), "the implied repair names the failed criterion");
  assert.ok(implied[0].includes(`note for ${LOAD_BEARING}`), "…and carries the critic's OWN note");

  // Every criterion is load-bearing this way — wouldCatchWrongImpl at minimum.
  for (const name of vetCriterionNames()) {
    assert.equal(
      impliedMustFix({ verdictsByCriterion: verdicts([name]), mustFix: [] }).length,
      1,
      `a pass:false on ${name} is a must-fix`,
    );
  }

  // A critic that DID name repairs is trusted with its own list: the harness does
  // not append to a judgement the critic already wrote out.
  assert.deepEqual(
    impliedMustFix({ verdictsByCriterion: verdicts([LOAD_BEARING]), mustFix: ["assert the returned value"] }),
    [],
    "a non-empty mustFix already refuses the advance; the harness adds nothing to it",
  );

  // A criterion the critic omitted altogether is a missing verdict, not a pass.
  assert.equal(
    impliedMustFix({ verdictsByCriterion: {}, mustFix: [] }).length,
    VET_CRITERIA.length,
    "an omitted verdict is not an approval — the tally counts it failed, and so does this",
  );
});
