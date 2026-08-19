// conductor/tests/admission-seams.test.ts — Phase II.2a of the fix campaign: the
// RED and GREEN admission seams, one escape performed per row.
//
// Every row below PERFORMS the escape the register recorded and asserts the
// refusal, so a fix that is reasoned rather than wired fails here.
//
//   GAP-015 / ISSUE-048 — the degenerate-config floor at setup. `behavioralPaths`
//     is the entire reach of the §2.1 TDD law: `behavioral:false` is legal exactly
//     when an item's fileScope is disjoint from that list, and the ∅-intersection
//     is vacuously true — so `answers.behavioralPaths: []` turned RED-before-GREEN
//     off for the whole repo in ONE tool call, and the only gate was
//     `=== undefined`, which `[]` walks straight through. The escape is performed
//     against the real handler; the acknowledged path is performed too, because a
//     floor with no door is a wedge, and the door has to be journaled.
//
//   ISSUE-009 — the `rootLevelOnly` glob hole in the §2.4 disjoint-path guard.
//     `firstIntersectingGlob` compared the two globs' DEPTH first and skipped the
//     pair when it differed, reading "not root-level-only" as "lives in a
//     directory". `**` and `**/*.ts` are neither: they match `config.ts` as surely
//     as `src/deep/config.ts`. Under the safe default `behavioralPaths:["**"]` a
//     root-level production file was declared disjoint from every behavioral path
//     and its item ran PENDING->GREEN with no test at all. Invisible in dogfooding
//     because conductor's own source is all under directories.
//
//   GAP-007 / ISSUE-008 — the vetted-test identity witness across RED->vet->GREEN.
//     `mark_green` re-ran whatever stood at testScope, never re-vetting and never
//     hashing, and an item may legally declare its own test file inside fileScope —
//     so the implementer sub-session overwrote the vetted test with a tautology and
//     earned a GREEN the critics never approved. No override, no taint, no scar.
//
//   GAP-008 / ISSUE-010 — green-admission symmetry (owner decision D10: REFUSE).
//     The red path has refused an untargeted run since §2.1; the green path had no
//     counterpart, so a run whose TARGETED command executed zero tests fell back to
//     the full scope and any exit 0 out of that was admitted as the item's GREEN.
//     The fallback half of this seam is performed in tools-9.4b.test.ts's
//     [9.4b-no-template-wave-no-livelock]; the zero-test half is performed here.
//
//   ISSUE-046 — publish freshness hardcoded `hasStagedDeletion: false`. A deletion
//     moves no worktree mtime, so a change whose only post-validate edit removed a
//     tracked file passed the §2.6 freshness rule on the surviving files' stamps
//     and shipped a tree state no verify ever described.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";

// ---- the subjects ---------------------------------------------------------
import {
  handleMarkGreen,
  handlePublish,
  handleSetup,
  handleVetTest,
} from "../adapter/tools.ts";
import type {
  MarkGreenResult,
  PublishResult,
  SetupInput,
  SetupResult,
  VetTestResult,
} from "../adapter/tools.ts";
import { validateQueue } from "../core/planning.ts";
import { globMatch } from "../core/shell-parse.ts";

// ---- committed machinery these rows compose over --------------------------
import { createFailoverState } from "../adapter/router-client.ts";
import type { FailoverState } from "../adapter/router-client.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { verifyFreshFor } from "../core/freshness.ts";
import { MAIN_TREE, treePath, validate } from "../core/types.ts";
import type {
  Config,
  EvidenceRecord,
  Item,
  ItemState,
  Queue,
  QueueItem,
  TreePath,
} from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// Distinctive markers. Each is unique in this file, so an assertion that a value
// does (or does not) carry one is unambiguous.
// ---------------------------------------------------------------------------

const SCOPE = "unitADM01";
const START_MS = 1_755_000_000_000;
const WORKSPACE_KEY = "wkeyADM01";
const VETTED_MARKER = "VETTED-TEST-MARKER-5108";
const SWAPPED_MARKER = "SWAPPED-TEST-MARKER-6620";
const PROBE_MODEL = "admission-seams-model";

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping.
// ---------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tmpDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-adm-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

function committedRepo(): TreePath {
  const dir = tmpDir("repo");
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

function headSha(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

function currentBranch(dir: string): string {
  return git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

// ---------------------------------------------------------------------------
// Journal sink (the 9.4b/9.5b harness shape).
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

// ---------------------------------------------------------------------------
// Config / store / queue fixtures.
// ---------------------------------------------------------------------------

const GREEN_CMD = [process.execPath, "-e", "0"];

function makeConfig(opts: { command?: string[]; itemTest?: string[]; behavioralPaths?: string[] } = {}): Config {
  const scope: { command: string[]; timeoutMs: number; itemTest?: string[] } = {
    command: [...(opts.command ?? GREEN_CMD)],
    timeoutMs: 120_000,
    ...(opts.itemTest !== undefined ? { itemTest: [...opts.itemTest] } : {}),
  };
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: scope },
      behavioralPaths: opts.behavioralPaths ?? ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
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

function makeQueueItem(
  id: string,
  over: { fileScope: string[]; testScope: string[]; behavioral?: boolean },
): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: ['parse("-7") returns -7'],
    behavioral: over.behavioral ?? true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
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

interface Bench {
  root: TreePath;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  queue: Queue;
}

const OPEN_TREE: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

type CannedReply = string | ((promptText: string) => string);

function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  script: Record<string, CannedReply[]>,
): Fanout {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    const queue = script[role] ?? [];
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
  return createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );
}

function makeBench(opts: { queue: Queue; states: Record<string, ItemState>; config?: Config }): Bench {
  const config = opts.config ?? makeConfig();
  const root = committedRepo();
  const stateHome = tmpDir("state");
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
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
  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(opts.queue, null, 2));
  for (const qi of opts.queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, opts.states[qi.id] ?? "PENDING"));
  }
  return { root, stateHome, store, runId, runDir, config, journal, queue: opts.queue };
}

// Seed the §2.6 RED the item is carrying and point its evidence pointer at it — the
// failure the vet critics judge the test against. Seeded rather than run because these
// rows are about what happens AFTER the vet, and a seeded red is the 9.5b idiom.
function seedRed(bench: Bench, itemId: string, testRel: string, marker: string): void {
  const record: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", testRel],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${marker}\n\n7 !== -7\n  at ${testRel}`,
    failureClass: "assertion",
    targeted: true,
  };
  writeFileSync(path.join(bench.runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  const item = bench.store.loadItem(bench.runId, itemId);
  item.evidence.red = { ledger: "evidence.jsonl", seq: record.seq };
  bench.store.saveItem(bench.runId, item);
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

// ---------------------------------------------------------------------------
// Fixture test/source content.
// ---------------------------------------------------------------------------

function subjectSource(): string {
  return "export function parse(text) {\n  return Number(text);\n}\n";
}

// A test that RUNS and fails its assertion → §2.6.1 class "assertion" (a legal red).
function assertionTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/beta.mjs";\n' +
    'test("keeps the sign", () => {\n' +
    `  assert.equal(parse("-7"), -7, ${JSON.stringify(marker)});\n` +
    "});\n"
  );
}

// The tautology the lazy implementer swaps in: it passes without exercising anything.
function tautologyTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'test("t", () => {\n' +
    "  assert.equal(true, true);\n" +
    "});\n"
  );
}

// A §2.1 itemTest template whose TARGETED run collects nothing. `node --test <file>`
// counts the file itself as one test, so a fixture file cannot produce the signal;
// what runTest actually keys on is the node runner profile's zeroTestPatterns applied
// to the targeted command's output, and this is a runner that emits exactly that.
// detectRunner reads argv[0] (node), so the profile is the same one a real
// `node --test` run is classified under.
const ZERO_TEST_ITEM_TEST = [
  process.execPath,
  "-e",
  "console.log('# tests 0'); console.log('# pass 0');",
  "--",
  "{files}",
];

function passingTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/beta.mjs";\n' +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7);\n' +
    "});\n"
  );
}

// The §2.10 IMPLEMENTER RESULT receipt every write-capable role replies with.
function implJson(): string {
  return JSON.stringify({
    status: "DONE",
    summary: "applied the minimal change",
    concerns: [],
    neededContext: null,
    blockReason: null,
  });
}

// The §2.10 TEST_VET receipt. An empty mustFix is a clean verdict.
function vetJson(mustFix: string[] = []): string {
  const clean = mustFix.length === 0;
  const verdict = (note: string): { pass: boolean; note: string } => ({ pass: clean, note });
  return JSON.stringify({
    verdictsByCriterion: {
      observableBehavior: verdict("asserts the returned value"),
      wouldCatchWrongImpl: verdict("a sign-dropping implementation still fails it"),
      rightLevel: verdict("unit level is right for a pure function"),
      pinsAcceptance: verdict("pins this item's acceptance criterion"),
      antiPatterns: verdict("no mock-testing, no tautology"),
    },
    mustFix: [...mustFix],
  });
}

// An implementer responder that WRITES files inside the repo and replies with the
// receipt — the fixture stand-in for a real write-capable sub-session's edit.
function implementerWrites(repo: string, files: Array<{ rel: string; content: string }>): CannedReply {
  return (): string => {
    for (const file of files) {
      const target = path.join(repo, file.rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    return implJson();
  };
}

// ---------------------------------------------------------------------------
// Fixture sanity (the 9.x probe-block discipline).
// ---------------------------------------------------------------------------

assert.equal(
  validate("ImplementerResult", JSON.parse(implJson()) as unknown).ok,
  true,
  "sanity: the implementer receipt satisfies SCHEMAS.ImplementerResult",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson()) as unknown).ok,
  true,
  "sanity: a clean critic receipt satisfies SCHEMAS.TestVet",
);

// ===========================================================================
// ISSUE-009 — the rootLevelOnly glob hole
// ===========================================================================

test("[adm-rootlevel-glob-hole] a root-level production file cannot escape the §2.4 disjoint-path guard: under the safe default behavioralPaths ['**'] — and under the ordinary ['**/*.ts'] — a behavioral:false item whose fileScope is a ROOT-LEVEL file is REJECTED naming the intersecting glob, while a genuinely root-level-only scope stays disjoint from a directory-rooted behavioralPath", () => {
  const escape = (behavioralPaths: string[], fileScope: string[]): string[] =>
    validateQueue(
      { items: [makeQueueItem("I1", { behavioral: false, fileScope, testScope: [] })] },
      makeConfig({ behavioralPaths }),
    ).violations.filter((violation) => /intersect|disjoint/i.test(violation));

  // THE ESCAPE, performed at both of the globs the register names. `rootLevelOnly("**")`
  // is false and `rootLevelOnly("config.ts")` is true, so the depth comparison declared
  // the pair disjoint and validateQueue accepted a behavioral:false item for a root-level
  // production file — which then runs PENDING->GREEN with no test at all.
  for (const behavioral of ["**", "**/*.ts", "**/*.mjs"]) {
    const violations = escape([behavioral], ["config.ts"]);
    assert.ok(
      violations.length > 0,
      `behavioralPaths ${JSON.stringify([behavioral])} DOES match the root-level file "config.ts", ` +
        "so a behavioral:false item claiming it must be rejected",
    );
    assert.ok(
      violations[0].includes(behavioral) && violations[0].includes("config.ts"),
      `the rejection names both intersecting globs: ${violations[0]}`,
    );
  }

  // …and the SAME hole read the other way round: a `**`-headed fileScope against a
  // root-level-only behavioralPath.
  assert.ok(
    escape(["*.ts"], ["**/*.ts"]).length > 0,
    "'**/*.ts' reaches root level, where '*.ts' lives, so the pair is not disjoint",
  );

  // THE OPTIMIZATION THE HOLE WAS IN still holds where it is sound: `*.md` names only
  // root-level files and `lib/runtime/**` cannot climb out of its directory, so the guard
  // must NOT false-reject that pair (the property [9.2-fix-rootless-glob] pins).
  assert.deepEqual(
    escape(["lib/runtime/**"], ["*.md"]),
    [],
    "'*.md' matches only root-level files and cannot intersect 'lib/runtime/**'",
  );
  assert.deepEqual(
    escape(["lib/runtime/**"], ["README.md"]),
    [],
    "a literal root-level path is disjoint from a directory-rooted behavioralPath",
  );
  // A `**` that is NOT at the head still cannot reach root level from below.
  assert.deepEqual(
    escape(["**/foo/*.ts"], ["config.ts"]),
    [],
    "'**/foo/*.ts' needs a 'foo' directory, so it never names a root-level file",
  );
});

// ===========================================================================
// GAP-015 / ISSUE-048 — the degenerate-config refusal floor at setup
// ===========================================================================

interface StubHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

// The smallest served origin the §2.1:628-632 setup proofs accept: a model list, a
// schema-honouring completion, and a published slot count.
function startStub(): Promise<StubHandle> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const json = (body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(text);
    };
    const url = req.url ?? "";
    if (url.startsWith("/v1/models")) {
      json({ data: [{ id: PROBE_MODEL }] });
      return;
    }
    if (url.startsWith("/props")) {
      json({ total_slots: 64 });
      return;
    }
    if (url.startsWith("/v1/chat/completions")) {
      // Drain the body before answering, so the client's write always completes.
      req.on("data", () => undefined);
      req.on("end", () => {
        json({ choices: [{ message: { content: '{"ok": true}' } }] });
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  return new Promise<StubHandle>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        host: "127.0.0.1",
        port,
        close: (): Promise<void> => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

interface SetupBench {
  input: SetupInput;
  records: CaptureRecord[];
  failover: FailoverState;
}

function setupHarness(root: string, stub: StubHandle): SetupBench {
  const records: CaptureRecord[] = [];
  const failover = createFailoverState();
  return {
    records,
    failover,
    input: {
      root,
      journal: {
        log: (level, component, event, data, corr): void => {
          records.push({ level, component, event, data, corr });
        },
      },
      router: { listen: { host: stub.host, port: stub.port }, probeTimeoutMs: 4000 },
      upstream: { host: stub.host, port: stub.port },
      failoverState: failover,
      modelId: PROBE_MODEL,
      now: () => START_MS,
    },
  };
}

// A node repo setup detects: package.json makes the node scope, so `**/*.{js,…,ts,…}`
// is a real detected source glob for the answered list to be judged against.
function nodeRepo(): string {
  const dir = tmpDir("setup");
  git(dir, ["init", "-b", "main"]);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { test: "node --test" } }, null, 2),
  );
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "index.mjs"), "export const ok = true;\n");
  return dir;
}

function configFileOf(root: string): string {
  return path.join(root, ".conductor", "config.json");
}

test("[adm-setup-refuses-degenerate-behavioral-paths] conductor_setup REFUSES answers.behavioralPaths:[] — the one call that turned the TDD law off for the whole repo — writing no config; an explicit acknowledgeNoTdd:true is the only door through, and the answered values (that word included) are journaled on the write", async () => {
  const stub = await startStub();
  try {
    // (a) THE ESCAPE: the empty list. The only gate was `=== undefined`.
    const root = nodeRepo();
    const bench = setupHarness(root, stub);
    const refused: SetupResult = await handleSetup({
      ...bench.input,
      answers: { gitMode: "read-only", behavioralPaths: [] },
    });

    assert.equal(refused.ok, false, "an empty behavioralPaths list is refused");
    assert.equal(refused.written, false, "nothing was written");
    assert.equal(existsSync(configFileOf(root)), false, "no .conductor/config.json exists");
    const why = refused.failures.join(" | ");
    assert.ok(/behavioralPaths/.test(why), `the refusal names the field: ${why}`);
    assert.ok(
      /acknowledgeNoTdd/.test(why),
      `the refusal names the ONE explicit way through, so it is a floor and not a wedge: ${why}`,
    );
    assert.equal(
      bench.records.some((record) => record.event === "config.updated"),
      false,
      "a refused setup journals no config write",
    );

    // (b) THE CONTROL: a list that covers the detected source is accepted, so the refusal
    //     is about the DEGENERACY and not about every answered list.
    const covering = nodeRepo();
    const coveringBench = setupHarness(covering, stub);
    const ok: SetupResult = await handleSetup({
      ...coveringBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["src/**"] },
    });
    assert.equal(ok.ok, true, `a covering list configures the repo: ${ok.failures.join(" | ")}`);
    assert.deepEqual(
      (JSON.parse(readFileSync(configFileOf(covering), "utf8")) as Config).verify.behavioralPaths,
      ["src/**"],
      "the answered list is what was written",
    );
    const coveringRecord = coveringBench.records.find((record) => record.event === "config.updated");
    assert.ok(coveringRecord !== undefined, "a first setup journals the write it performed");
    assert.deepEqual(
      (coveringRecord.data.answers as { behavioralPaths: string[] }).behavioralPaths,
      ["src/**"],
      "the ANSWERED values are echoed into the journal",
    );
    assert.equal(
      (coveringRecord.data.answers as { acknowledgeNoTdd: boolean }).acknowledgeNoTdd,
      false,
      "and the acknowledgement word is recorded even when it was not given",
    );

    // (c) THE DOOR: the same degenerate answer, acknowledged. It writes — and the
    //     acknowledgement, which has no config field to land in, is in the journal.
    const acked = nodeRepo();
    const ackedBench = setupHarness(acked, stub);
    const written: SetupResult = await handleSetup({
      ...ackedBench.input,
      answers: { gitMode: "read-only", behavioralPaths: [], acknowledgeNoTdd: true },
    });
    assert.equal(written.ok, true, `the acknowledged answer configures: ${written.failures.join(" | ")}`);
    assert.deepEqual(
      (JSON.parse(readFileSync(configFileOf(acked), "utf8")) as Config).verify.behavioralPaths,
      [],
      "the acknowledged empty list is what was written",
    );
    const ackedRecord = ackedBench.records.find((record) => record.event === "config.updated");
    assert.ok(ackedRecord !== undefined, "the acknowledged write is journaled");
    assert.equal(
      (ackedRecord.data.answers as { acknowledgeNoTdd: boolean }).acknowledgeNoTdd,
      true,
      "the ONE call that can turn the TDD law off leaves a trace under a grep-able name",
    );

    // (d) A NON-EMPTY list that names nothing this repo's source actually is: the
    //     same degeneracy in a longer costume. Judged on glob HEADS the clause was
    //     vacuous — every detected sourceGlob ("**/*.{js,…,ts,…}") is wildcard-headed,
    //     so core scopesIntersect calls it an intersection with any non-empty list
    //     whatsoever, and ["docs/**"] "covered" a repo whose only source file is
    //     src/index.mjs. The evidence has to be MATCHED FILES.
    const foreign = nodeRepo();
    const foreignBench = setupHarness(foreign, stub);
    const foreignResult: SetupResult = await handleSetup({
      ...foreignBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["docs/**"] },
    });
    assert.equal(
      foreignResult.ok,
      false,
      `a non-empty list matching NONE of this repo's source is the TDD kill switch wearing a costume: ${foreignResult.failures.join(" | ")}`,
    );
    assert.equal(existsSync(configFileOf(foreign)), false, "and still writes nothing");
    const foreignWhy = foreignResult.failures.join(" | ");
    assert.ok(
      /docs\/\*\*/.test(foreignWhy),
      `the refusal quotes the list it refused: ${foreignWhy}`,
    );
    assert.ok(
      /src\/index\.mjs/.test(foreignWhy),
      `and NAMES what the list failed to cover, so the operator can correct it rather than guess: ${foreignWhy}`,
    );
    assert.ok(
      /acknowledgeNoTdd/.test(foreignWhy),
      `with the one explicit door still named: ${foreignWhy}`,
    );

    // (e) …and the matched-file judgment does not over-refuse: a list spelled as a
    //     glob that really does match the repo's source is accepted, which is what
    //     makes (d) a statement about COVERAGE rather than about spelling.
    const globbed = nodeRepo();
    const globbedBench = setupHarness(globbed, stub);
    const globbedResult: SetupResult = await handleSetup({
      ...globbedBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["**/*.mjs"] },
    });
    assert.equal(
      globbedResult.ok,
      true,
      `a list that matches src/index.mjs covers this repo's source: ${globbedResult.failures.join(" | ")}`,
    );
  } finally {
    await stub.close();
  }
});

// A node repo whose real source sits in src/ and whose dist/ holds a generated
// bundle — the shape every bundler, every `tsc --outDir` and every vendored
// checkout produces.
function nodeRepoWithDist(): string {
  const dir = nodeRepo();
  mkdirSync(path.join(dir, "dist"), { recursive: true });
  writeFileSync(path.join(dir, "dist", "bundle.mjs"), "export const bundled = true;\n");
  return dir;
}

// A node repo whose source files sort BOTH sides of any prefix-bounded sample:
// `count` of them under aaa/, one under zzz/. The late file is the one an honest
// answer names, and the one a truncated evidence list cannot see.
function nodeRepoLateSource(count: number): string {
  const dir = tmpDir("setup");
  git(dir, ["init", "-b", "main"]);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { test: "node --test" } }, null, 2),
  );
  mkdirSync(path.join(dir, "aaa"), { recursive: true });
  for (let i = 0; i < count; i += 1) {
    writeFileSync(path.join(dir, "aaa", `f${String(i).padStart(4, "0")}.mjs`), "export const a = 1;\n");
  }
  mkdirSync(path.join(dir, "zzz"), { recursive: true });
  writeFileSync(path.join(dir, "zzz", "late.mjs"), "export const late = true;\n");
  return dir;
}

test("[adm-setup-coverage-one-evidence-universe] the GAP-015 coverage clause judges an answered behavioralPaths list against the SAME file list detection walked: a bundle under dist/, which detection never descends into, buys no coverage", async () => {
  const stub = await startStub();
  try {
    // TWO FILE UNIVERSES. Coverage evidence came from a walk that skipped only
    //     .git/.conductor/node_modules, while detection's own walk also skips the
    //     regenerated trees (.venv, __pycache__, target, build, dist, .cache). So a
    //     list naming ONLY a tree detection never saw — ["dist/**"] against a
    //     generated bundle — was "covered", and the repo-wide TDD kill survived the
    //     floor: every item under src/ stays legally behavioral:false.
    const vendored = nodeRepoWithDist();
    const vendoredBench = setupHarness(vendored, stub);
    const vendoredResult: SetupResult = await handleSetup({
      ...vendoredBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["dist/**"] },
    });
    assert.equal(
      vendoredResult.ok,
      false,
      `a list covering only a tree the detection walk skips is the TDD kill switch again: ${vendoredResult.failures.join(" | ")}`,
    );
    assert.equal(
      existsSync(configFileOf(vendored)),
      false,
      "and the refused setup writes nothing",
    );
    const vendoredWhy = vendoredResult.failures.join(" | ");
    assert.ok(
      /src\/index\.mjs/.test(vendoredWhy),
      `the refusal names the source the answer left uncovered: ${vendoredWhy}`,
    );
    assert.equal(
      /dist\/bundle\.mjs/.test(vendoredWhy),
      false,
      `and never quotes a file from a tree detection does not walk, which would tell the operator to judge against evidence setup itself refuses to look at: ${vendoredWhy}`,
    );
  } finally {
    await stub.close();
  }
});

test("[adm-setup-coverage-complete-judgment] the same clause judges the answered list against EVERY source file the detection walk found: a source that sorts past any fixed sample bound still earns the honest answer its acceptance, while a list that covers none of them is refused as before", async () => {
  const stub = await startStub();
  try {
    // (a) ORDER-BIASED SAMPLE. The evidence list was a SORTED expansion sliced at a
    //     fixed bound, so every source that sorts past the bound was invisible: a
    //     repo with more than a sample's worth of files under aaa/ made the honest
    //     answer ["zzz/**"] look like it covered nothing at all, and the floor
    //     refused a correct answer. Judgment is per-answer complete or it is a lie.
    const late = nodeRepoLateSource(260);
    const lateBench = setupHarness(late, stub);
    const lateResult: SetupResult = await handleSetup({
      ...lateBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["zzz/**"] },
    });
    assert.equal(
      lateResult.ok,
      true,
      `zzz/late.mjs is a real source file this list makes behavioral, so the list covers this repo: ${lateResult.failures.join(" | ")}`,
    );
    assert.deepEqual(
      (JSON.parse(readFileSync(configFileOf(late), "utf8")) as Config).verify.behavioralPaths,
      ["zzz/**"],
      "and the accepted answer is what was written",
    );

    // (b) THE FLOOR STILL HOLDS on the same big repo: a list naming nothing it owns
    //     is refused, so (a) is a statement about complete evidence and not about
    //     having quietly stopped judging.
    const lateForeign = nodeRepoLateSource(260);
    const lateForeignBench = setupHarness(lateForeign, stub);
    const lateForeignResult: SetupResult = await handleSetup({
      ...lateForeignBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["docs/**"] },
    });
    assert.equal(
      lateForeignResult.ok,
      false,
      `a list matching none of 261 source files is still refused: ${lateForeignResult.failures.join(" | ")}`,
    );
    assert.equal(existsSync(configFileOf(lateForeign)), false, "and still writes nothing");

    // (c) GREENFIELD is untouched: a detected ecosystem with no source file yet has
    //     no evidence to judge on, so the clause falls back to "at least non-empty"
    //     rather than wedging the case conductor exists to work in.
    const scaffold = tmpDir("setup");
    git(scaffold, ["init", "-b", "main"]);
    writeFileSync(
      path.join(scaffold, "package.json"),
      JSON.stringify({ name: "scaffold", version: "0.0.0", scripts: { test: "node --test" } }, null, 2),
    );
    const scaffoldBench = setupHarness(scaffold, stub);
    const scaffoldResult: SetupResult = await handleSetup({
      ...scaffoldBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["src/**"] },
    });
    assert.equal(
      scaffoldResult.ok,
      true,
      `a repo with no source file yet has no evidence to refuse on: ${scaffoldResult.failures.join(" | ")}`,
    );
  } finally {
    await stub.close();
  }
});

// A repo more than one ecosystem owns: package.json (node) and pyproject.toml
// (python), one real source file each, plus a README no ecosystem's extension set
// covers. `python` makes it MULTI-ecosystem, which is what turns setupCoverEveryPath
// on; dropping it leaves the single-ecosystem control.
function multiEcosystemRepo(withPython: boolean): string {
  const dir = tmpDir("setup");
  git(dir, ["init", "-b", "main"]);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts: { test: "node --test" } }, null, 2),
  );
  if (withPython) {
    writeFileSync(
      path.join(dir, "pyproject.toml"),
      '[project]\nname = "fixture"\nversion = "0.0.0"\n',
    );
  }
  writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "index.mjs"), "export const ok = true;\n");
  writeFileSync(path.join(dir, "src", "app.py"), "def ok():\n    return True\n");
  return dir;
}

test("[adm-setup-coverage-prewidening-source-globs] the GAP-015 coverage clause judges the answered list against the DETECTED per-ecosystem source globs, not the requiredScopes patterns setupCoverEveryPath widens: on a multi-ecosystem repo a docs-only answer is still the repo-wide TDD kill and is refused", async () => {
  const stub = await startStub();
  try {
    // THE ESCAPE. setupCoverEveryPath runs inside detection, BEFORE this clause, and
    //     folds every kind no ecosystem owns (**/README.md, **/*.toml, **/*.json …)
    //     into EVERY scope's sourceGlob so no path is left without a requiredScopes
    //     entry. That widened brace union is a ROUTING pattern; taken as the
    //     definition of "source file" it makes a doc count as coverage, and
    //     ["README.md"] bought a config in which every item under src/ is legally
    //     behavioral:false — the same repo-wide TDD kill, let through by the very
    //     clause written to refuse it. Only a repo with TWO ecosystems widens, which
    //     is why the single-ecosystem control below never saw it.
    const multi = multiEcosystemRepo(true);
    const multiBench = setupHarness(multi, stub);
    const multiResult: SetupResult = await handleSetup({
      ...multiBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["README.md"] },
    });
    assert.equal(
      multiResult.ok,
      false,
      `a doc file is not this repo's source, whatever the widened routing pattern matches: ${multiResult.failures.join(" | ")}`,
    );
    assert.equal(existsSync(configFileOf(multi)), false, "and the refused setup writes nothing");
    const multiWhy = multiResult.failures.join(" | ");
    assert.ok(
      /src\/app\.py/.test(multiWhy) && /src\/index\.mjs/.test(multiWhy),
      `the refusal names the sources BOTH ecosystems own and the answer left uncovered: ${multiWhy}`,
    );
    assert.ok(
      /acknowledgeNoTdd/.test(multiWhy),
      `with the one explicit door still named: ${multiWhy}`,
    );
    assert.equal(
      /\*\*\/\*\.md/.test(multiWhy),
      false,
      `and quotes the DETECTED extension sets as what the ecosystems own — a refusal that reports **/*.md as owned source tells the operator to answer with the very doc glob this clause refuses: ${multiWhy}`,
    );

    // THE CONTROL. The same repo minus pyproject.toml: one ecosystem, so no
    //     widening ever happened and the same answer was already refused. It stays
    //     refused, which is what makes the row above a statement about the widened
    //     glob rather than about docs-shaped answers.
    const single = multiEcosystemRepo(false);
    const singleBench = setupHarness(single, stub);
    const singleResult: SetupResult = await handleSetup({
      ...singleBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["README.md"] },
    });
    assert.equal(
      singleResult.ok,
      false,
      `the single-ecosystem control refuses the same answer: ${singleResult.failures.join(" | ")}`,
    );
    assert.equal(existsSync(configFileOf(single)), false, "and writes nothing either");

    // NO OVER-REFUSAL. The honest answer on the SAME multi-ecosystem repo — the one
    //     that really does make both ecosystems' sources behavioral — still configures,
    //     so the fix narrows the evidence rather than the acceptances.
    const honest = multiEcosystemRepo(true);
    const honestBench = setupHarness(honest, stub);
    const honestResult: SetupResult = await handleSetup({
      ...honestBench.input,
      answers: { gitMode: "read-only", behavioralPaths: ["src/**"] },
    });
    assert.equal(
      honestResult.ok,
      true,
      `src/** covers src/index.mjs and src/app.py: ${honestResult.failures.join(" | ")}`,
    );
    assert.deepEqual(
      (JSON.parse(readFileSync(configFileOf(honest), "utf8")) as Config).verify.behavioralPaths,
      ["src/**"],
      "and the accepted answer is what was written",
    );
    // The widening itself is UNTOUCHED: every path still owes a scope, so the
    // routing this clause stopped reading as source still exists to route.
    const written = JSON.parse(readFileSync(configFileOf(honest), "utf8")) as Config;
    for (const rel of ["README.md", "pyproject.toml", "src/index.mjs", "src/app.py"]) {
      assert.ok(
        written.verify.requiredScopes.some((entry) => globMatch(entry.pattern, rel)),
        `${rel} is covered by no requiredScopes entry, so no item touching it has a constructible test command: ${JSON.stringify(written.verify.requiredScopes)}`,
      );
    }
  } finally {
    await stub.close();
  }
});

// ===========================================================================
// GAP-007 / ISSUE-008 — the vetted-test identity witness
// ===========================================================================

// Drive an item RED -> TEST_VETTED through the REAL vet handler, so the identity
// witness under test is the one the committed stage actually writes.
async function vetToTestVetted(bench: Bench, itemId: string): Promise<VetTestResult> {
  const fanout = makeWiring(bench.runId, bench.config, bench.journal.sink, {
    reviewer: [vetJson(), vetJson()],
  });
  return handleVetTest({
    store: bench.store,
    fanout,
    runId: bench.runId,
    itemId,
    config: bench.config,
    journal: bench.journal.sink,
    sessionID: "ses_orchestrator",
    now: () => START_MS,
  });
}

test("[adm-vetted-test-identity] the test file mark_green re-runs must BE the file the critics vetted: the vet captures a content digest at RED->TEST_VETTED, and an implementer that rewrites its own vetted test (legal — the item declares it inside fileScope) is REFUSED at mark_green naming the identity break, with no GREEN written", async () => {
  const config = makeConfig({ itemTest: [process.execPath, "--test", "{files}"] });
  // The item's fileScope CONTAINS its own test file — §2.4 permits it, and it is the
  // shape ISSUE-008 was reproduced on: colocated scopes make the vetted test writable
  // by the implementer sub-session mark_green dispatches.
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", {
          fileScope: ["src/beta.mjs", "tests/beta.test.mjs"],
          testScope: ["tests/beta.test.mjs"],
        }),
      ],
    },
    states: { I1: "RED" },
    config,
  });

  const testAbs = path.join(bench.root, "tests", "beta.test.mjs");
  writeFileSync(testAbs, assertionTest(VETTED_MARKER));
  seedRed(bench, "I1", "tests/beta.test.mjs", VETTED_MARKER);

  const vetted = await vetToTestVetted(bench, "I1");
  assert.equal(vetted.ok, true, `the item must reach TEST_VETTED for this row to be about the green: ${vetted.mustFix.join("; ")}`);

  const afterVet = bench.store.loadItem(bench.runId, "I1");
  assert.equal(afterVet.state, "TEST_VETTED", "premise: the critics approved the test");
  assert.ok(
    afterVet.vettedTests !== undefined && afterVet.vettedTests.length === 1,
    `the vet captured WHICH test it approved: ${JSON.stringify(afterVet.vettedTests)}`,
  );
  assert.equal(afterVet.vettedTests?.[0].path, "tests/beta.test.mjs", "the witness names the testScope file");
  assert.match(afterVet.vettedTests?.[0].sha256 ?? "", /^[0-9a-f]{64}$/, "and carries a sha256 of its bytes");
  assert.equal(
    readFileSync(testAbs, "utf8").includes(VETTED_MARKER),
    true,
    "premise: the vetted test is the one on disk",
  );

  // THE ESCAPE: the implementer writes the subject AND overwrites the vetted test with a
  // tautology. Under the old seam mark_green re-ran whatever was there, the tautology
  // exited 0, and the item took a GREEN the critics never approved.
  const fanout = makeWiring(bench.runId, bench.config, bench.journal.sink, {
    implementer: [
      implementerWrites(bench.root, [
        { rel: "src/beta.mjs", content: subjectSource() },
        { rel: "tests/beta.test.mjs", content: tautologyTest(SWAPPED_MARKER) },
      ]),
    ],
  });
  const green: MarkGreenResult = await handleMarkGreen({
    store: bench.store,
    fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });

  // CONTROL: the swap really happened — the refusal is about the swap, not about a
  // fixture that failed to perform it.
  assert.ok(readFileSync(testAbs, "utf8").includes(SWAPPED_MARKER), "control: the vetted test WAS overwritten");

  assert.equal(green.ok, false, "the swapped test earns no GREEN");
  const afterGreen = bench.store.loadItem(bench.runId, "I1");
  assert.equal(afterGreen.state, "TEST_VETTED", "the item did not advance");
  assert.equal(afterGreen.evidence.green, undefined, "no §2.6 green pointer was persisted");
  assert.ok(green.questionId !== null, "ONE §2.11 question offers the unblock path");
  const asked = readQuestions(bench.runDir).find((q) => q.id === green.questionId);
  assert.ok(
    /tests\/beta\.test\.mjs/.test(asked?.question ?? "") && /vet/i.test(asked?.question ?? ""),
    `the refusal NAMES the identity break and the file it happened to: ${asked?.question ?? "(no question)"}`,
  );

  // …and DELETING the vetted test is the same escape, one byte shorter.
  const restored = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", {
          fileScope: ["src/beta.mjs", "tests/beta.test.mjs"],
          testScope: ["tests/beta.test.mjs"],
        }),
      ],
    },
    states: { I1: "RED" },
    config,
  });
  writeFileSync(path.join(restored.root, "tests", "beta.test.mjs"), assertionTest(VETTED_MARKER));
  seedRed(restored, "I1", "tests/beta.test.mjs", VETTED_MARKER);
  const secondVet = await vetToTestVetted(restored, "I1");
  assert.equal(secondVet.ok, true, "premise: the second fixture also reaches TEST_VETTED");
  const deleting = makeWiring(restored.runId, restored.config, restored.journal.sink, {
    implementer: [
      (): string => {
        writeFileSync(path.join(restored.root, "src", "beta.mjs"), subjectSource());
        rmSync(path.join(restored.root, "tests", "beta.test.mjs"), { force: true });
        return implJson();
      },
    ],
  });
  const deleted: MarkGreenResult = await handleMarkGreen({
    store: restored.store,
    fanout: deleting,
    runId: restored.runId,
    itemId: "I1",
    config: restored.config,
    journal: restored.journal.sink,
    stateHome: restored.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });
  assert.equal(deleted.ok, false, "a vetted test that is gone earns no GREEN either");
  assert.equal(restored.store.loadItem(restored.runId, "I1").state, "TEST_VETTED", "the item did not advance");
});

test("[adm-vetted-test-identity-passes-untouched] the witness is a witness and not a wall: an implementer that leaves the vetted test alone and writes only its production subject takes the item to GREEN exactly as before", async () => {
  const config = makeConfig({ itemTest: [process.execPath, "--test", "{files}"] });
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", {
          fileScope: ["src/beta.mjs", "tests/beta.test.mjs"],
          testScope: ["tests/beta.test.mjs"],
        }),
      ],
    },
    states: { I1: "RED" },
    config,
  });
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), assertionTest(VETTED_MARKER));
  seedRed(bench, "I1", "tests/beta.test.mjs", VETTED_MARKER);
  const vetted = await vetToTestVetted(bench, "I1");
  assert.equal(vetted.ok, true, "premise: the item reaches TEST_VETTED");

  const fanout = makeWiring(bench.runId, bench.config, bench.journal.sink, {
    implementer: [implementerWrites(bench.root, [{ rel: "src/beta.mjs", content: subjectSource() }])],
  });
  const green: MarkGreenResult = await handleMarkGreen({
    store: bench.store,
    fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });
  assert.equal(green.ok, true, "an untouched vetted test still reaches GREEN");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "GREEN", "the item advanced");
  const last = readEvidence(bench.runDir).at(-1);
  assert.equal(last?.kind, "green", "the §2.6 green was appended");
  assert.equal(
    (last as Extract<EvidenceRecord, { kind: "green" }>).targeted,
    true,
    "and the run really was targeted at this item's test",
  );
});

// ===========================================================================
// GAP-008 / ISSUE-010 — green-admission symmetry (the zero-test half)
// ===========================================================================

test("[adm-green-admission-zero-test] a green from a run whose TARGETED command executed ZERO tests is REFUSED as the item's GREEN: the §2.1 zero-test guard falls back to the full scope, that suite exits 0, and the old seam admitted TEST_VETTED->GREEN on a test that provably never ran", async () => {
  const config = makeConfig({ itemTest: ZERO_TEST_ITEM_TEST });
  const bench = makeBench({
    queue: { items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })] },
    states: { I1: "TEST_VETTED" },
    config,
  });
  // The targeted run collects nothing, so the §2.1 zero-test guard sends runTest to the
  // (trivially green) full scope command — the shape ISSUE-010 was reproduced on.
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource());
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("ZERO-TEST-FIXTURE-4417"));

  const fanout = makeWiring(bench.runId, bench.config, bench.journal.sink, { implementer: [implJson()] });
  const green: MarkGreenResult = await handleMarkGreen({
    store: bench.store,
    fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });

  // CONTROL: the run really did fall back and really did exit 0 — the refusal is about
  // what that pass proves, not about a fixture that failed to produce one.
  const last = readEvidence(bench.runDir).at(-1);
  assert.equal(last?.kind, "green", "control: the fallback run produced a §2.6 green");
  assert.equal((last as Extract<EvidenceRecord, { kind: "green" }>).exitCode, 0, "control: it exited 0");
  assert.equal(
    (last as Extract<EvidenceRecord, { kind: "green" }>).targeted,
    false,
    "control: and the record says the run was NOT targeted at the item",
  );

  assert.equal(green.ok, false, "a zero-test green is not this item's GREEN");
  assert.equal(green.ranItemTest, true, "the run happened");
  assert.equal(green.exitCode, 0, "and it exited 0 — the refusal is an admission rule, not an exit code");
  const item = bench.store.loadItem(bench.runId, "I1");
  assert.equal(item.state, "TEST_VETTED", "the item did not advance");
  assert.equal(item.evidence.green, undefined, "no §2.6 green pointer was persisted");
  assert.ok(green.questionId !== null, "ONE §2.11 question offers the unblock path");
  const asked = readQuestions(bench.runDir).find((q) => q.id === green.questionId);
  assert.ok(
    /executed zero tests/i.test(asked?.question ?? ""),
    `the refusal mirrors redAdmission's vocabulary: ${asked?.question ?? "(no question)"}`,
  );
});

// ===========================================================================
// ISSUE-046 — publish freshness and the staged deletion
// ===========================================================================

test("[adm-publish-staged-deletion-freshness] a post-validate DELETION cannot ship on a verify that never judged it: publish derives the staged-deletion fact from the paths it is about to commit, so the §2.6 freshness rule consults the index and the stale verdict forces exactly one auto re-verify", async () => {
  const bench = makeBench({
    queue: {
      items: [
        makeQueueItem("I1", {
          fileScope: ["src/beta.mjs", "src/gone.mjs"],
          testScope: ["tests/beta.test.mjs"],
        }),
      ],
    },
    states: { I1: "REVIEWED" },
  });

  // The item's tree as the (imagined) validate saw it: subject, test, and a TRACKED
  // file the item will delete afterwards.
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource());
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("PUBLISH-FIXTURE-3391"));
  writeFileSync(path.join(bench.root, "src", "gone.mjs"), "export const doomed = true;\n");
  git(bench.root, ["add", "-A"]);
  git(bench.root, ["commit", "-m", "the tree the verify judged"]);
  const headAtValidate = headSha(bench.root);

  // Back-date the surviving files so the verify's start stamp is AFTER every one of
  // them: condition 1 holds on worktree mtimes alone, which is exactly the reading
  // the hardcoded `hasStagedDeletion:false` left in force.
  const past = (START_MS - 3_600_000) / 1000;
  for (const rel of ["src/beta.mjs", "tests/beta.test.mjs"]) {
    utimesSync(path.join(bench.root, rel), past, past);
  }
  const startedMs = START_MS - 1_800_000;

  const validated: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "verify",
    itemId: "I1",
    startedMs,
    head: headAtValidate,
    branch: currentBranch(bench.root),
    tree: MAIN_TREE,
    excluded: [],
    green: true,
    scopes: { [SCOPE]: { green: true, exitCode: 0, durationMs: 5 } },
  };
  writeFileSync(path.join(bench.runDir, "evidence.jsonl"), JSON.stringify(validated) + "\n");
  const item = bench.store.loadItem(bench.runId, "I1");
  item.evidence.validated = { ledger: "evidence.jsonl", seq: validated.seq };
  bench.store.saveItem(bench.runId, item);

  // THE ESCAPE: the only post-validate edit is a deletion. It moves no worktree mtime
  // and does not touch HEAD, so both §2.6 conditions read fresh on the surviving files.
  rmSync(path.join(bench.root, "src", "gone.mjs"));

  // CONTROL, through the CORE rule this file never re-implements: with the deletion fact
  // withheld the record reads FRESH (the escape), and with it supplied it reads STALE.
  const survivingMtimes = [past * 1000, past * 1000];
  const withoutDeletion = verifyFreshFor(
    { startedMs, head: headAtValidate },
    {
      stagedMtimes: survivingMtimes,
      indexMtimeMs: START_MS,
      hasStagedDeletion: false,
      currentHead: headSha(bench.root),
      noGit: false,
    },
  );
  assert.equal(
    withoutDeletion.fresh,
    true,
    "control: withholding the deletion fact makes core verifyFreshFor call this record FRESH — that is the escape",
  );
  const withDeletion = verifyFreshFor(
    { startedMs, head: headAtValidate },
    {
      stagedMtimes: survivingMtimes,
      indexMtimeMs: START_MS,
      hasStagedDeletion: true,
      currentHead: headSha(bench.root),
      noGit: false,
    },
  );
  assert.equal(withDeletion.fresh, false, "control: supplying it makes the SAME record STALE");

  const fanout = makeWiring(bench.runId, bench.config, bench.journal.sink, {});
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });

  assert.equal(
    res.reverified,
    true,
    "the deletion made the §2.6 verdict stale, so publish re-verified rather than shipping a tree state no verify described",
  );
  assert.notEqual(res.verifySeq, validated.seq, "and the publish rests on the NEW verify record");
  assert.equal(res.ok, true, `the re-verify passed and the item published: ${res.denial ?? ""}`);
  assert.equal(
    existsSync(path.join(bench.root, "src", "gone.mjs")),
    false,
    "the deletion really is what shipped",
  );
  assert.equal(
    git(bench.root, ["ls-files", "src/gone.mjs"]).trim(),
    "",
    "…and git no longer tracks it, so the commit carried the removal",
  );
});

test("[adm-publish-no-deletion-still-skips-reverify] the derived fact is DERIVED and not always-on: a publish whose staged paths all still exist keeps the fresh §2.6 verdict and re-verifies nothing", async () => {
  const bench = makeBench({
    queue: {
      items: [makeQueueItem("I1", { fileScope: ["src/beta.mjs"], testScope: ["tests/beta.test.mjs"] })],
    },
    states: { I1: "REVIEWED" },
  });
  writeFileSync(path.join(bench.root, "src", "beta.mjs"), subjectSource());
  writeFileSync(path.join(bench.root, "tests", "beta.test.mjs"), passingTest("PUBLISH-FIXTURE-5502"));

  const validated: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "verify",
    itemId: "I1",
    startedMs: Date.now() + 60_000,
    head: headSha(bench.root),
    branch: currentBranch(bench.root),
    tree: MAIN_TREE,
    excluded: [],
    green: true,
    scopes: { [SCOPE]: { green: true, exitCode: 0, durationMs: 5 } },
  };
  writeFileSync(path.join(bench.runDir, "evidence.jsonl"), JSON.stringify(validated) + "\n");
  const item = bench.store.loadItem(bench.runId, "I1");
  item.evidence.validated = { ledger: "evidence.jsonl", seq: validated.seq };
  bench.store.saveItem(bench.runId, item);

  const fanout = makeWiring(bench.runId, bench.config, bench.journal.sink, {});
  const res: PublishResult = await handlePublish({
    store: bench.store,
    fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  });

  assert.equal(res.reverified, false, "no deletion, no index term, no re-verify");
  assert.equal(res.verifySeq, validated.seq, "the publish rests on the ORIGINAL verify record");
  assert.equal(res.ok, true, `the item published: ${res.denial ?? ""}`);
});
