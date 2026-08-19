// conductor/tests/review-seams.test.ts — Phase III.1 of the fix campaign: the
// REVIEW-LAYER witnesses. Every row PERFORMS the escape the register recorded and
// asserts the refusal, so a fix that is reasoned rather than wired fails here.
//
//   GAP-011 / ISSUE-072 — "[]" was free. The blind-spot guard fires only when a
//     lens returns no valid receipt, so a schema-valid `{"findings":[]}` advanced
//     the item with no forcing function that the reviewer ever read the diff:
//     the cheapest review evasion in the system was the one the doctrine
//     sanctioned. A lens reply now carries a READ WITNESS — this dispatch's nonce
//     plus cited ranges the harness re-derives against the item's own diff — and a
//     reply whose nonce is absent, or whose ranges name lines the diff does not
//     contain, is refused. Judgement stays trusted; contact is proven. review.md's
//     calibration line ("do not invent findings") is KEPT VERBATIM: the empty
//     review is priced, never forbidden.
//
//   GAP-012 — the fixer-receipt floor. A DONE that did nothing survived, because
//     the next round is GAP-011's trust again. A fix receipt is now diffed against
//     the tree: a receipt that touched nothing the routed finding NAMES (fallback,
//     the item's scopes) is refused, re-dispatched ONCE with the discrepancy
//     named, and surfaced on the second failure.
//
//   GAP-036 (owner decision D11) — abstention upholds. skeptic.md's "uncertain ⇒
//     refuted" converted model INCAPACITY into finding-killing verdicts (C-082/P10
//     sealed a true finding; kill rates swung 12%→71%). A refutation now carries
//     EVIDENCE symmetric with the finding's — the discriminating input, what was
//     run, and the reading under which the finding fails — and a verdict that
//     refutes without it is an ABSTENTION, which UPHOLDS.
//
//   ISSUE-049 — the panel keyed on model-authored finding ids: six independent
//     lens sessions numbering findings F1, F2… collide, and `outcome.set(id, …)`
//     dropped a finding upheld by its OWN panel when its id-twin was refuted. The
//     adjudication keys on the ENTRY, and the ids the fixer sees are namespaced.
//
//   GAP-040 — the reply protocols get NAMES in doctrine (through the generated
//     MECHANICS block, so the statuses cannot drift from the schema enum) and the
//     pushback matcher gets EXACT TOKENS: `concern.includes(id)` made F10 match F1.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TS; real `git init`
// fixture repos and real child processes for the verify; sub-session traffic over
// the fake SDK; no skip/todo.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---- the subjects ---------------------------------------------------------
import { handleItemReview } from "../adapter/tools.ts";
import { checkReadWitness, createdFileDiff, diffContact, witnessNonce } from "../core/review-witness.ts";
import { findingSubjects, receiptFloor, routeFallbackScope } from "../core/receipt-floor.ts";
import { concernNamesFinding, concernToken, renderReplyProtocol } from "../core/reply-protocol.ts";
import { findingSurvives, verdictKind } from "../core/verdict.ts";

// ---- committed machinery these rows compose over --------------------------
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, RegistryEntry, TreeState } from "../adapter/fanout.ts";
import { loadPacks } from "../adapter/inject.ts";
import { renderMechanics } from "../core/mechanics.ts";
import { treePath, validate } from "../core/types.ts";
import type { Config, Item, ItemState, Queue, QueueItem, TreePath, Verdict } from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// The handler surface, restated structurally (the 9.5a convention).
// ---------------------------------------------------------------------------

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

interface ItemReviewResultShape {
  ok: boolean;
  itemState: ItemState;
  rounds: number;
  surviving: string[];
  questionId: string | null;
}

// ---------------------------------------------------------------------------
// Fixture markers and constants.
// ---------------------------------------------------------------------------

const SPEC = "spec/contract";
const CORRECTNESS = "correctness";
const GUARDRAIL = "guardrail";
const TITLE_MARKER = "ITEM-TITLE-MARKER-III1";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-III1";
const FIX_MARKER = "WORKING-TREE-FIX-MARKER-III1";
const SUBJECT_REL = "src/a.mjs";
const TEST_REL = "tests/a.test.mjs";
const SCOPE = "unitIII1";
const START_MS = 1_754_990_000_000;
const ITEM_ID = "I1";
const USER_PROMPT = "keep the sign of negative offsets";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");
const PACKS: Record<string, string> = loadPacks(DOCTRINE_DIR);

function readPack(name: string): string {
  return readFileSync(path.join(DOCTRINE_DIR, name), "utf8");
}

// Whitespace-flattened, so an anchor survives the pack's line wrapping.
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Hermetic git + temp dirs.
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
  return execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const REVERTED_SUBJECT = "export function parse(s) { return Math.abs(Number(s)); }\n";
const FIXED_SUBJECT = `export function parse(s) { return Number(s); } // ${FIX_MARKER}\n`;
const ITEM_TEST_SOURCE =
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'import { parse } from "../src/a.mjs";\n' +
  'test("keeps the sign", () => { assert.equal(parse("-7"), -7); });\n';

// The CREATION-shaped item's whole change: a file that exists only in the working
// tree, never committed, so `git diff` over the item's scope reports nothing at all.
const CREATED_REL = "src/created.mjs";
const CREATED_SOURCE =
  "export function shout(s) {\n" + "  return String(s).toUpperCase();\n" + "}\n";
const CREATED_LINES = 3;

function reviewRepo(created: boolean): TreePath {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-iii1-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  writeFileSync(path.join(dir, TEST_REL), ITEM_TEST_SOURCE);
  writeFileSync(path.join(dir, SUBJECT_REL), REVERTED_SUBJECT);
  git(dir, ["add", "seed.txt", TEST_REL, SUBJECT_REL]);
  git(dir, ["commit", "-m", "seed"]);
  if (created) {
    // No working-tree edit to any TRACKED file: the item's scope is the created
    // file alone, and the committed test it is scoped against is untouched.
    writeFileSync(path.join(dir, CREATED_REL), CREATED_SOURCE);
    return treePath(dir);
  }
  writeFileSync(path.join(dir, SUBJECT_REL), FIXED_SUBJECT);
  return treePath(dir);
}

// The verify command: a real child process that appends one line and exits 0.
function verifyCmd(witness: string): string[] {
  return [
    process.execPath,
    "-e",
    "const fs=require('fs');\n" + `fs.appendFileSync(${JSON.stringify(witness)}, "verify\\n");\n` + "process.exit(0);\n",
  ];
}

// The item test: the real `node --test` over the item's testScope.
function itemTestCmd(repoRoot: string): string[] {
  return [
    process.execPath,
    "-e",
    "const cp=require('child_process');\n" +
      `const repo=${JSON.stringify(repoRoot)};\n` +
      "const files=process.argv.slice(1);\n" +
      "const r=cp.spawnSync(process.execPath,['--test',...files],{cwd:repo,encoding:'utf8'});\n" +
      "process.exit(r.status===null?1:r.status);\n",
    "{files}",
  ];
}

// ---------------------------------------------------------------------------
// Config / store / queue fixtures.
// ---------------------------------------------------------------------------

interface ConfigOpts {
  command: string[];
  itemTest: string[];
  reviewMaxRounds?: number;
  skepticsPerFinding?: number;
}

function makeConfig(opts: ConfigOpts): Config {
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: { command: [...opts.command], timeoutMs: 120_000, itemTest: [...opts.itemTest] } },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 3,
      skepticsPerFinding: opts.skepticsPerFinding ?? 1,
      reviewMaxRounds: opts.reviewMaxRounds ?? 1,
      vetCritics: 1,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 8, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  } as unknown as Config;
}

function makeJournal(): { sink: JournalSink; records: Array<{ event: string; data: Record<string, unknown> }> } {
  const records: Array<{ event: string; data: Record<string, unknown> }> = [];
  const sink: JournalSink = {
    log(_level, _component, event, data): void {
      records.push({ event, data });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

function makeQueueItem(): QueueItem {
  return {
    id: ITEM_ID,
    title: `keep the sign (${TITLE_MARKER})`,
    rationale: "the parser drops the sign",
    fileScope: [SUBJECT_REL],
    testScope: [TEST_REL],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: true,
    dependsOn: [],
    ponytail: { necessary: "the prompt asks for it", reuse: "nothing parses signed offsets", ladderRung: "minimal-code" },
  };
}

// The creation-shaped item: its fileScope is the file it brings into existence,
// and its testScope names a committed test nothing in this item edits.
function makeCreationQueueItem(): QueueItem {
  return { ...makeQueueItem(), fileScope: [CREATED_REL] };
}

const QUEUE: Queue = { items: [makeQueueItem()] };
const CREATION_QUEUE: Queue = { items: [makeCreationQueueItem()] };

function makeRuntimeItem(state: ItemState): Item {
  return {
    id: ITEM_ID,
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

// ---------------------------------------------------------------------------
// Fan-out wiring over the fake SDK.
// ---------------------------------------------------------------------------

type Canned = { kind: "reply"; text: string } | { kind: "error"; error: unknown };

interface RespondReq {
  role: string;
  lenses: string[] | null;
  lensOrdinal: number;
  text: string;
}

type Responder = (req: RespondReq) => Canned;

interface PromptedRecord {
  role: string;
  attempt: number;
  lenses: string[] | null;
  text: string;
}

interface Wiring {
  fanout: Fanout;
  prompted: PromptedRecord[];
  firsts: () => PromptedRecord[];
  byRole: (role: string) => PromptedRecord[];
  lensPrompts: () => PromptedRecord[];
}

function lensesOf(text: string): string[] | null {
  const match = /^LENSES:[ \t]*(.+)$/m.exec(text);
  if (match === null) return null;
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function makeWiring(runId: string, config: Config, journal: JournalSink, respond: Responder): Wiring {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const lensOrdinals = new Map<string, number>();
  let lensSeen = 0;
  const treeState: TreeState = {
    isFrozen(): boolean {
      return false;
    },
    onClear(): () => void {
      return (): void => undefined;
    },
  };
  sdk.setResponder((req) => {
    const entry = registry.get(req.sessionID);
    const role = entry?.role ?? "";
    const lenses = lensesOf(req.text);
    let lensOrdinal = -1;
    if (lenses !== null) {
      const known = lensOrdinals.get(req.sessionID);
      if (known === undefined) {
        lensOrdinal = lensSeen;
        lensOrdinals.set(req.sessionID, lensOrdinal);
        lensSeen += 1;
      } else {
        lensOrdinal = known;
      }
    }
    prompted.push({ role, attempt: req.attempt, lenses, text: req.text });
    const canned = respond({ role, lenses, lensOrdinal, text: req.text });
    if (canned.kind === "error") return { kind: "error", error: canned.error };
    return { kind: "reply", text: canned.text };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    treeState,
    runId,
  );
  const firsts = (): PromptedRecord[] => prompted.filter((p) => p.attempt === 1);
  return {
    fanout,
    prompted,
    firsts,
    byRole: (role: string) => firsts().filter((p) => p.role === role),
    lensPrompts: () => firsts().filter((p) => p.lenses !== null),
  };
}

interface Bench {
  root: TreePath;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  journal: ReturnType<typeof makeJournal>;
  wiring: Wiring;
}

interface BenchOpts {
  respond: Responder;
  reviewMaxRounds?: number;
  skepticsPerFinding?: number;
  // Seed the CREATION-shaped item instead of the edit-shaped one: the scope holds
  // one untracked file and no tracked edit, so `git diff` over it is empty.
  creation?: boolean;
}

function seedBench(opts: BenchOpts): Bench {
  const creation = opts.creation === true;
  const root = reviewRepo(creation);
  const stateHome = mkdtempSync(path.join(tmpdir(), "conductor-iii1-state-"));
  tmpDirs.push(stateHome);
  const config = makeConfig({
    command: verifyCmd(path.join(stateHome, "verify-runs.txt")),
    itemTest: itemTestCmd(root),
    ...(opts.reviewMaxRounds !== undefined ? { reviewMaxRounds: opts.reviewMaxRounds } : {}),
    ...(opts.skepticsPerFinding !== undefined ? { skepticsPerFinding: opts.skepticsPerFinding } : {}),
  });
  const bootstrap = makeJournal();
  const openOpts: OpenOptions = {
    root,
    config,
    journal: bootstrap.sink as unknown as OpenOptions["journal"],
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  const store = openWorkspace(openOpts);
  const run = store.createRun({
    prompt: USER_PROMPT,
    sessionID: "ses_orchestrator",
    classification: { kind: "work", rationale: "a behavioural change", check: { agreed: true, note: "" } },
  });
  const runId = run.runId;
  const runDir = path.join(store.root, ".conductor", "runs", runId);
  const loaded = store.loadRun(runId);
  loaded.state = "EXECUTING";
  store.saveRun(loaded);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(creation ? CREATION_QUEUE : QUEUE, null, 2));
  store.saveItem(runId, makeRuntimeItem("VALIDATED"));
  const journal = makeJournal();
  const wiring = makeWiring(runId, config, journal.sink, opts.respond);
  return { root, stateHome, store, runId, runDir, config, journal, wiring };
}

function review(bench: Bench): Promise<ItemReviewResultShape> {
  return handleItemReview({
    store: bench.store,
    fanout: bench.wiring.fanout,
    runId: bench.runId,
    itemId: ITEM_ID,
    config: bench.config,
    journal: bench.journal.sink as unknown as Parameters<typeof handleItemReview>[0]["journal"],
    stateHome: bench.stateHome,
    workspaceKey: "wkey-iii1",
    packs: PACKS,
    sessionID: "ses_orchestrator",
    now: () => START_MS,
  }) as Promise<ItemReviewResultShape>;
}

// ---------------------------------------------------------------------------
// Receipt builders.
// ---------------------------------------------------------------------------

interface WitnessShape {
  nonce: string;
  citedRanges: Array<{ file: string; startLine: number; endLine: number }>;
}

// The HONEST witness: this dispatch's nonce, plus one range per changed file taken
// from the diff the prompt itself carries. A reviewer that read the diff can
// produce it; a reviewer that did not, cannot.
function honestWitness(promptText: string): WitnessShape {
  const nonce = /READ WITNESS NONCE:[ \t]*(\S+)/.exec(promptText)?.[1] ?? "";
  const contact = diffContact(promptText);
  const citedRanges: WitnessShape["citedRanges"] = [];
  for (const [file, ranges] of contact) {
    citedRanges.push({ file, startLine: ranges[0][0], endLine: ranges[0][1] });
  }
  return { nonce, citedRanges };
}

interface FixtureFinding {
  id: string;
  lens: string;
  claim?: string;
  suggestedFix?: string;
}

function findingsJson(findings: readonly FixtureFinding[], witness: WitnessShape | null): string {
  const body: Record<string, unknown> = {
    findings: findings.map((f) => ({
      id: f.id,
      severity: "major",
      lens: f.lens,
      claim: f.claim ?? `finding ${f.id} raised by the ${f.lens} lens`,
      evidence: `${SUBJECT_REL}:1`,
      suggestedFix: f.suggestedFix ?? `edit ${SUBJECT_REL} so the sign survives`,
    })),
  };
  if (witness !== null) body.readWitness = witness;
  return JSON.stringify(body);
}

interface EvidenceShape {
  discriminatingInput: string;
  run: string;
  reading: string;
}

const REAL_REFUTATION: EvidenceShape = {
  discriminatingInput: 'parse("-7") with the working-tree module',
  run: "node --test tests/a.test.mjs against the item's tree",
  reading: "the finding reads the committed module; the working tree already returns -7",
};

function verdictJson(findingId: string, upheld: boolean, evidence: EvidenceShape | null): string {
  return JSON.stringify({
    findingId,
    upheld,
    reasoning: upheld ? "the finding stands" : "the finding does not reproduce",
    refutationEvidence: evidence,
  });
}

function implJson(status = "DONE", concerns: readonly string[] = []): string {
  return JSON.stringify({
    status,
    summary: "handled the routed finding(s)",
    concerns: [...concerns],
    neededContext: null,
    blockReason: null,
  });
}

function vetJson(): string {
  const verdict = { pass: true, note: "clean" };
  return JSON.stringify({
    verdictsByCriterion: {
      observableBehavior: verdict,
      wouldCatchWrongImpl: verdict,
      rightLevel: verdict,
      pinsAcceptance: verdict,
      antiPatterns: verdict,
    },
    mustFix: [],
  });
}

// A fix dispatch that really edits the file the finding names.
function touchSubject(bench: Bench, note: string): void {
  const file = path.join(bench.root, SUBJECT_REL);
  writeFileSync(file, readFileSync(file, "utf8") + `// ${note}\n`);
}

// ===========================================================================
// Fixture sanity: every canned payload satisfies the schema the engine validates
// it against, so a red below is about the handler and never about the fixture.
// ===========================================================================

const SANITY_WITNESS: WitnessShape = { nonce: "N", citedRanges: [{ file: SUBJECT_REL, startLine: 1, endLine: 1 }] };

assert.equal(
  validate("ItemFindings", JSON.parse(findingsJson([], SANITY_WITNESS)) as unknown).ok,
  true,
  "sanity: an empty findings list WITH a read witness satisfies SCHEMAS.ItemFindings",
);
assert.equal(
  validate("ItemFindings", JSON.parse(findingsJson([], null)) as unknown).ok,
  false,
  "sanity: SCHEMAS.ItemFindings requires the read witness — the witness is a schema obligation, not a convention",
);
assert.equal(
  validate("Findings", JSON.parse(findingsJson([{ id: "F1", lens: SPEC }], SANITY_WITNESS)) as unknown).ok,
  true,
  "sanity: a witness-carrying reply still satisfies the plan-level SCHEMAS.Findings",
);
assert.equal(
  validate("Verdict", JSON.parse(verdictJson("F1", false, REAL_REFUTATION)) as unknown).ok,
  true,
  "sanity: an evidence-carrying refutation is schema-valid",
);
assert.equal(
  validate("Verdict", JSON.parse(verdictJson("F1", false, null)) as unknown).ok,
  true,
  "sanity: a bare refutation is still schema-VALID — the schema admits it so the handler can record it as an ABSTENTION",
);
assert.equal(validate("ImplementerResult", JSON.parse(implJson()) as unknown).ok, true, "sanity: the fix receipt is schema-valid");
assert.equal(validate("TestVet", JSON.parse(vetJson()) as unknown).ok, true, "sanity: the vet receipt is schema-valid");

// ===========================================================================
// 1. GAP-011 — the reviewer diligence witness (core arithmetic first).
// ===========================================================================

test("[III1-witness-core] checkReadWitness refuses an absent witness, a wrong nonce, a fabricated file and a range outside every hunk, and accepts contact the diff really carries", () => {
  const diff =
    "diff --git a/src/a.mjs b/src/a.mjs\n" +
    "index 111..222 100644\n" +
    "--- a/src/a.mjs\n" +
    "+++ b/src/a.mjs\n" +
    "@@ -10,3 +10,4 @@ context\n" +
    " keep\n" +
    "-old\n" +
    "+new\n" +
    "+added\n";
  const contact = diffContact(diff);
  assert.deepEqual([...contact.keys()], ["src/a.mjs"], "the changed-file set is re-derived from the diff itself");
  assert.deepEqual(contact.get("src/a.mjs"), [[10, 13]], "the hunk's NEW-side line span is what a citation must land in");

  const expected = { nonce: "NONCE-1", contact };
  assert.equal(checkReadWitness(null, expected).ok, false, "a reply carrying no witness at all is refused");
  assert.equal(
    checkReadWitness({ nonce: "GUESSED", citedRanges: [{ file: "src/a.mjs", startLine: 10, endLine: 10 }] }, expected).ok,
    false,
    "a witness whose nonce is not THIS dispatch's is refused",
  );
  assert.equal(
    checkReadWitness({ nonce: "NONCE-1", citedRanges: [] }, expected).ok,
    false,
    "a witness citing no range at all leaves the changed file uncited",
  );
  assert.equal(
    checkReadWitness({ nonce: "NONCE-1", citedRanges: [{ file: "src/other.mjs", startLine: 10, endLine: 10 }] }, expected).ok,
    false,
    "a range naming a file the diff does not touch is fabricated contact",
  );
  assert.equal(
    checkReadWitness({ nonce: "NONCE-1", citedRanges: [{ file: "src/a.mjs", startLine: 900, endLine: 901 }] }, expected).ok,
    false,
    "a range outside every hunk of that file does not exist in the diff",
  );
  const good = checkReadWitness({ nonce: "NONCE-1", citedRanges: [{ file: "src/a.mjs", startLine: 11, endLine: 12 }] }, expected);
  assert.equal(good.ok, true, `contact the diff really carries is admissible; refused for ${good.reasons.join("; ")}`);

  assert.notEqual(
    witnessNonce(["run-1", "I1", "1", "spec/contract"]),
    witnessNonce(["run-1", "I1", "1", "correctness"]),
    "each lens dispatch gets its OWN nonce, so one session's witness cannot be replayed for another's",
  );
  assert.equal(
    witnessNonce(["run-1", "I1", "1", "spec/contract"]),
    witnessNonce(["run-1", "I1", "1", "spec/contract"]),
    "the nonce is a pure derivation of the dispatch — the handler re-derives it to check the reply",
  );
});

test("[III1-lazy-empty-refused] THE ESCAPE: a lens replies the schema-valid, zero-effort `{findings:[]}` with NO contact evidence — conductor_item_review REFUSES the reply by name instead of advancing the item, and the item stays VALIDATED", async () => {
  const bench = seedBench({
    respond: (req) => {
      if (req.lenses !== null) return { kind: "reply", text: findingsJson([], null) };
      return { kind: "reply", text: vetJson() };
    },
  });

  await assert.rejects(
    () => review(bench),
    (error: Error) => {
      assert.match(error.message, /conductor_item_review/, "the refusal names the tool");
      assert.match(error.message, /witness/i, "the refusal names the missing read witness");
      return true;
    },
    "an empty findings list with no contact evidence must be REFUSED, not accepted as the approval",
  );

  assert.equal(bench.store.loadItem(bench.runId, ITEM_ID).state, "VALIDATED", "the item did NOT advance on a lazy review");
});

test("[III1-fabricated-witness-refused] a lens that copies the nonce but cites a range the diff does not contain is refused: the harness re-derives the claimed read set against the item's own diff", async () => {
  const bench = seedBench({
    respond: (req) => {
      if (req.lenses !== null) {
        const nonce = /READ WITNESS NONCE:[ \t]*(\S+)/.exec(req.text)?.[1] ?? "";
        return {
          kind: "reply",
          text: findingsJson([], { nonce, citedRanges: [{ file: "src/never-touched.mjs", startLine: 1, endLine: 2 }] }),
        };
      }
      return { kind: "reply", text: vetJson() };
    },
  });

  await assert.rejects(
    () => review(bench),
    (error: Error) => {
      assert.match(error.message, /src\/never-touched\.mjs/, "the refusal names the fabricated citation");
      return true;
    },
    "a cited range the diff does not carry is refused even when the nonce is right",
  );
  assert.equal(bench.store.loadItem(bench.runId, ITEM_ID).state, "VALIDATED", "the item did NOT advance");
});

test("[III1-honest-empty-advances] D15b: the empty review is PRICED, never forbidden — an empty findings list carrying a real read witness still IS the approval and advances the item VALIDATED->REVIEWED", async () => {
  const bench = seedBench({
    respond: (req) => {
      if (req.lenses !== null) return { kind: "reply", text: findingsJson([], honestWitness(req.text)) };
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, true, "the honest empty review advances the item");
  assert.equal(res.itemState, "REVIEWED", "VALIDATED->REVIEWED through the core rule");
  assert.equal(res.rounds, 1, "one round, no fix pass");
  assert.equal(bench.wiring.lensPrompts().length, 3, "three lens sessions dispatched");
  for (const prompt of bench.wiring.lensPrompts()) {
    assert.match(prompt.text, /READ WITNESS NONCE:[ \t]*\S+/, "every lens dispatch carries its own read-witness nonce");
  }
});

test("[III1-created-contact-core] createdFileDiff turns a file the item brought into existence into a citable creation hunk, and drops an empty one rather than demanding a citation nobody can make", () => {
  const contact = diffContact(createdFileDiff([{ path: CREATED_REL, content: CREATED_SOURCE }]));
  assert.deepEqual([...contact.keys()], [CREATED_REL], "a created file is part of the contact universe");
  assert.deepEqual(contact.get(CREATED_REL), [[1, CREATED_LINES]], "its whole post-image is the citable span");

  const empty = diffContact(createdFileDiff([{ path: "src/blank.mjs", content: "" }]));
  assert.equal(empty.size, 0, "an empty created file carries no citable line, so it demands no citation");

  const expected = { nonce: "N-1", contact };
  assert.equal(
    checkReadWitness({ nonce: "N-1", citedRanges: [] }, expected).ok,
    false,
    "THE HOLE: echoing the nonce with no cited range no longer satisfies a creation-shaped item",
  );
  assert.equal(
    checkReadWitness({ nonce: "N-1", citedRanges: [{ file: CREATED_REL, startLine: 2, endLine: 2 }] }, expected).ok,
    true,
    "a range inside the created file's real content is admissible contact",
  );
  assert.equal(
    checkReadWitness({ nonce: "N-1", citedRanges: [{ file: CREATED_REL, startLine: 40, endLine: 41 }] }, expected).ok,
    false,
    "a range past the created file's last line is fabricated contact",
  );
});

test("[III1-creation-nonce-echo-refused] THE ESCAPE: the item CREATES its file, so `git diff` over its scope is empty — a lens that echoes the nonce with `{findings:[]}` and cites nothing must be REFUSED, not advanced", async () => {
  const bench = seedBench({
    creation: true,
    respond: (req) => {
      if (req.lenses !== null) {
        const nonce = /READ WITNESS NONCE:[ \t]*(\S+)/.exec(req.text)?.[1] ?? "";
        return { kind: "reply", text: findingsJson([], { nonce, citedRanges: [] }) };
      }
      return { kind: "reply", text: vetJson() };
    },
  });

  // The premise the escape rests on: the tracked diff really is empty here, so a
  // contact universe derived from `git diff` alone would demand nothing at all.
  assert.equal(
    git(bench.root, ["diff", "--", TEST_REL, CREATED_REL]).trim(),
    "",
    "sanity: the creation-shaped item has NO tracked diff — this is the shape the hole lived in",
  );

  await assert.rejects(
    () => review(bench),
    (error: Error) => {
      assert.match(error.message, /conductor_item_review/, "the refusal names the tool");
      assert.match(error.message, /witness/i, "the refusal names the read witness");
      assert.match(error.message, /src\/created\.mjs/, "the refusal names the created file left uncited");
      return true;
    },
    "a nonce echo with no citation must not advance an item whose whole change is a created file",
  );

  assert.equal(bench.store.loadItem(bench.runId, ITEM_ID).state, "VALIDATED", "the item did NOT advance");
});

test("[III1-creation-honest-witness-advances] the same creation-shaped item advances when the witness cites the created file's REAL lines: the created file rides in the diff the reviewers are shown, so an honest reviewer can produce the citation", async () => {
  const bench = seedBench({
    creation: true,
    respond: (req) => {
      if (req.lenses !== null) return { kind: "reply", text: findingsJson([], honestWitness(req.text)) };
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, true, "the honest witness over a created file advances the item");
  assert.equal(res.itemState, "REVIEWED", "VALIDATED->REVIEWED");

  const lenses = bench.wiring.lensPrompts();
  assert.equal(lenses.length, 3, "three lens sessions dispatched");
  for (const prompt of lenses) {
    assert.match(prompt.text, /\+\+\+ b\/src\/created\.mjs/, "every lens saw the created file as a creation hunk in the diff");
    const derived = diffContact(prompt.text).get(CREATED_REL);
    assert.deepEqual(derived, [[1, CREATED_LINES]], "the span a reviewer derives from the prompt is the file's real content");
  }
});

// ===========================================================================
// 2. GAP-012 — the fixer-receipt floor.
// ===========================================================================

test("[III1-receipt-floor-core] receiptFloor refuses an empty touch set and a touch set disjoint from the finding's named paths, and findingSubjects falls back to the item's scope when the finding names no path", () => {
  const finding = {
    id: "F1",
    severity: "major" as const,
    lens: CORRECTNESS,
    claim: "the guard is missing",
    evidence: `${SUBJECT_REL}:1`,
    suggestedFix: `add the guard in ${SUBJECT_REL}`,
  };
  const scopes = { fileScope: [SUBJECT_REL], testScope: [TEST_REL] };
  assert.deepEqual(
    findingSubjects(finding, scopes, "implementer"),
    [SUBJECT_REL],
    "the finding's own prose names its subject",
  );

  const vague = { ...finding, evidence: "somewhere in the parser", suggestedFix: "handle the empty case" };
  assert.deepEqual(
    findingSubjects(vague, scopes, "implementer"),
    [SUBJECT_REL],
    "an implementer-routed finding that names no path falls back to the source half it may write, never to nothing",
  );
  assert.deepEqual(
    findingSubjects(vague, scopes, "testWriter"),
    [TEST_REL],
    "and a test-writer-routed one falls back to the test half",
  );

  assert.equal(receiptFloor([], [SUBJECT_REL]).ok, false, "a receipt that touched NOTHING is refused");
  assert.equal(receiptFloor(["docs/readme.md"], [SUBJECT_REL]).ok, false, "a receipt touching only files the finding never names is refused");
  assert.equal(receiptFloor([SUBJECT_REL], [SUBJECT_REL]).ok, true, "a receipt touching the finding's subject clears the floor");
  assert.equal(receiptFloor(["src/deep/b.ts"], ["src/**"]).ok, true, "the subject match is glob-aware (the ISSUE-054 lesson)");
});

test("[III1-route-aware-fallback] THE ESCAPE: a vague IMPLEMENTATION finding is 'discharged' by editing the TEST file — the one edit an implementer is gated out of. The route-aware fallback refuses it, and a real source edit still clears the floor", () => {
  const vague = {
    id: "F1",
    severity: "major" as const,
    lens: CORRECTNESS,
    claim: "the empty case is unhandled",
    evidence: "somewhere in the parser",
    suggestedFix: "handle the empty case",
  };
  const scopes = { fileScope: [SUBJECT_REL], testScope: [TEST_REL] };

  const implSubjects = findingSubjects(vague, scopes, "implementer");
  assert.equal(
    receiptFloor([TEST_REL], implSubjects).ok,
    false,
    "touching the TEST file discharges no implementation finding — the union fallback is what let it",
  );
  assert.equal(
    receiptFloor([SUBJECT_REL], implSubjects).ok,
    true,
    "and a real source edit still clears the floor",
  );

  const writerSubjects = findingSubjects(vague, scopes, "testWriter");
  assert.equal(receiptFloor([TEST_REL], writerSubjects).ok, true, "the test-writer's own half still clears its floor");
  assert.equal(
    receiptFloor([SUBJECT_REL], writerSubjects).ok,
    false,
    "and a test-writer that edited the source discharged nothing it was asked for",
  );

  // The subtraction is glob-aware, and it matches the one core/gates-edit.ts
  // applies to the implementer's write permission.
  assert.deepEqual(
    routeFallbackScope("implementer", { fileScope: ["src/**", "tests/helpers/**"], testScope: ["tests/**"] }),
    ["src/**"],
    "a fileScope entry the testScope covers is subtracted, not merely compared by string",
  );
  assert.deepEqual(
    routeFallbackScope("implementer", { fileScope: ["tests/**"], testScope: ["tests/**"] }),
    ["tests/**"],
    "a fileScope wholly inside the testScope falls back to the fileScope rather than to nothing — a floor of nothing is no floor",
  );
});

test("[III1-noop-done-refused] THE ESCAPE: the implementer replies DONE and changes NOTHING — the receipt is refused, re-dispatched ONCE with the discrepancy named, and the second no-op surfaces the item instead of advancing it", async () => {
  const bench = seedBench({
    reviewMaxRounds: 2,
    respond: (req) => {
      if (req.lenses !== null) {
        const found = req.lenses.includes(CORRECTNESS) ? [{ id: "F1", lens: CORRECTNESS }] : [];
        return { kind: "reply", text: findingsJson(found, honestWitness(req.text)) };
      }
      if (req.role === "skeptic") return { kind: "reply", text: verdictJson("F1", true, null) };
      if (req.role === "implementer" || req.role === "testWriter") return { kind: "reply", text: implJson() };
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, false, "an acknowledge-and-change-nothing fix never advances the item");
  assert.equal(res.questionId !== null, true, "the second no-op surfaces a §2.11 question");

  const fixes = bench.wiring.byRole("implementer");
  assert.equal(fixes.length, 2, "the refused receipt is re-dispatched EXACTLY once, then surfaced");
  assert.match(fixes[1].text, /touched no file/i, "the re-dispatch names the discrepancy: the receipt touched nothing the finding names");
  assert.match(fixes[1].text, new RegExp(SUBJECT_REL.replace(".", "\\.")), "the re-dispatch names the path the finding actually claims");

  const questions = readQuestions(bench.runDir);
  assert.equal(questions.length, 1, "exactly one question");
  assert.match(questions[0].question, /touched no file/i, "the surfaced question carries the discrepancy, not a generic failure");
  assert.equal(bench.store.loadItem(bench.runId, ITEM_ID).blocked !== null, true, "the item is blocked, not advanced");
});

test("[III1-real-fix-clears-floor] a DONE that really edits the file the finding names clears the floor: the round completes, re-validates, and the item is settled by the next round", async () => {
  let bench: Bench | null = null;
  bench = seedBench({
    reviewMaxRounds: 2,
    respond: (req) => {
      if (req.lenses !== null) {
        const round = Math.floor(req.lensOrdinal / 3);
        const found = round === 0 && req.lenses.includes(CORRECTNESS) ? [{ id: "F1", lens: CORRECTNESS }] : [];
        return { kind: "reply", text: findingsJson(found, honestWitness(req.text)) };
      }
      if (req.role === "skeptic") return { kind: "reply", text: verdictJson("F1", true, null) };
      if (req.role === "implementer" || req.role === "testWriter") {
        if (bench !== null) touchSubject(bench, "REVIEW-FIX-APPLIED");
        return { kind: "reply", text: implJson() };
      }
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, true, "the honest fix clears the floor and the item advances");
  assert.equal(res.rounds, 2, "round 1 fixed, round 2 found nothing");
  assert.equal(bench.wiring.byRole("implementer").length, 1, "no re-dispatch: the receipt intersected the finding");
  assert.match(readFileSync(path.join(bench.root, SUBJECT_REL), "utf8"), /REVIEW-FIX-APPLIED/, "the fix really landed in the tree");
});

// ===========================================================================
// 3. GAP-036 (D11) — abstention upholds; ISSUE-049 — the panel keying.
// ===========================================================================

test("[III1-verdict-kinds] verdictKind splits upheld / refuted / abstained, and findingSurvives counts an ABSTENTION as an uphold: incapacity can no longer convert into a kill", () => {
  const upheld: Verdict = { findingId: "F1", upheld: true, reasoning: "stands", refutationEvidence: null };
  const refuted = JSON.parse(verdictJson("F1", false, REAL_REFUTATION)) as Verdict;
  const bare = JSON.parse(verdictJson("F1", false, null)) as Verdict;
  const hollow = JSON.parse(
    verdictJson("F1", false, { discriminatingInput: "   ", run: "", reading: "unclear" }),
  ) as Verdict;

  assert.equal(verdictKind(upheld), "upheld", "an uphold is an uphold");
  assert.equal(verdictKind(refuted), "refuted", "a refutation carrying the discriminating input, the run and the reading is a refutation");
  assert.equal(verdictKind(bare), "abstained", "a refutation with NO evidence is an abstention (D11)");
  assert.equal(verdictKind(hollow), "abstained", "blank evidence fields are no evidence");

  assert.equal(findingSurvives([bare], 1), true, "at k=1 an abstention UPHOLDS — the lazy-skeptic kill closes");
  assert.equal(findingSurvives([refuted], 1), false, "an EVIDENCED refutation still kills the finding at k=1");
  assert.equal(findingSurvives([refuted, bare], 2), true, "at k=2 one evidenced refutation plus one abstention still upholds (tie-upholds)");
  assert.equal(findingSurvives([refuted, refuted], 2), false, "two evidenced refutations still bury it");
});

test("[III1-abstention-survives] THE ESCAPE: the skeptic cannot evaluate and returns a bare `upheld:false` with no refutation evidence — the finding SURVIVES and is routed to a fix, instead of being extinguished by an unevidenced line", async () => {
  const bench = seedBench({
    respond: (req) => {
      if (req.lenses !== null) {
        const found = req.lenses.includes(CORRECTNESS) ? [{ id: "F1", lens: CORRECTNESS }] : [];
        return { kind: "reply", text: findingsJson(found, honestWitness(req.text)) };
      }
      if (req.role === "skeptic") return { kind: "reply", text: verdictJson("F1", false, null) };
      if (req.role === "implementer" || req.role === "testWriter") {
        touchSubject(bench, "ABSTENTION-ROUTED-FIX");
        return { kind: "reply", text: implJson() };
      }
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, false, "the finding survived, so the round could not settle the item");
  assert.equal(res.surviving.length, 1, "exactly the one finding survives its evidence-free refutation");
  assert.equal(bench.wiring.byRole("implementer").length, 1, "the surviving finding was ROUTED TO A FIX, not dropped");
});

test("[III1-evidenced-refutation-kills] the symmetry holds in the other direction: a refutation that carries the discriminating input, the run and the reading DOES bury the finding — no fix is dispatched and the item advances", async () => {
  const bench = seedBench({
    respond: (req) => {
      if (req.lenses !== null) {
        const found = req.lenses.includes(CORRECTNESS) ? [{ id: "F1", lens: CORRECTNESS }] : [];
        return { kind: "reply", text: findingsJson(found, honestWitness(req.text)) };
      }
      if (req.role === "skeptic") return { kind: "reply", text: verdictJson("F1", false, REAL_REFUTATION) };
      if (req.role === "implementer" || req.role === "testWriter") return { kind: "reply", text: implJson() };
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, true, "the evidenced refutation settles the round");
  assert.equal(bench.wiring.byRole("implementer").length, 0, "a refuted finding dispatches no fix");
});

test("[III1-id-collision] THE ESCAPE (ISSUE-049): two independent lens sessions both number their finding F1 — one panel upholds, the other refutes with evidence. The upheld finding must SURVIVE: adjudication keys on the entry, never on the model-authored id", async () => {
  const CLAIM_UPHELD = "COLLISION-CLAIM-UPHELD-III1";
  const CLAIM_REFUTED = "COLLISION-CLAIM-REFUTED-III1";
  const bench = seedBench({
    respond: (req) => {
      if (req.lenses !== null) {
        if (req.lenses.includes(CORRECTNESS)) {
          return { kind: "reply", text: findingsJson([{ id: "F1", lens: CORRECTNESS, claim: CLAIM_UPHELD }], honestWitness(req.text)) };
        }
        if (req.lenses.includes(GUARDRAIL)) {
          return { kind: "reply", text: findingsJson([{ id: "F1", lens: GUARDRAIL, claim: CLAIM_REFUTED }], honestWitness(req.text)) };
        }
        return { kind: "reply", text: findingsJson([], honestWitness(req.text)) };
      }
      if (req.role === "skeptic") {
        if (req.text.includes(CLAIM_REFUTED)) return { kind: "reply", text: verdictJson("F1", false, REAL_REFUTATION) };
        return { kind: "reply", text: verdictJson("F1", true, null) };
      }
      if (req.role === "implementer" || req.role === "testWriter") {
        touchSubject(bench, "COLLISION-ROUTED-FIX");
        return { kind: "reply", text: implJson() };
      }
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  assert.equal(res.ok, false, "the upheld twin still demands a fix, so the item cannot settle");
  assert.equal(res.surviving.length, 1, "exactly ONE of the id-twins survives — the refutation must not take its twin with it");

  const fixes = bench.wiring.byRole("implementer");
  assert.equal(fixes.length, 1, "the upheld finding was routed to a fix");
  assert.match(fixes[0].text, new RegExp(CLAIM_UPHELD), "the fix carries the UPHELD twin's claim");
  assert.equal(fixes[0].text.includes(CLAIM_REFUTED), false, "the refuted twin demands nothing");
});

// ===========================================================================
// 4. GAP-040 — named reply protocols, exact-token pushback matching.
// ===========================================================================

test("[III1-concern-token-core] concernNamesFinding matches an EXACT token only: F10 never matches F1, and the canonical `finding:<id>` form is understood", () => {
  assert.equal(concernToken("F1"), "finding:F1", "the canonical concern token names its finding");
  assert.equal(concernNamesFinding("finding:F10 misreads the contract", ["F1"]), false, "F10 is not F1 (the substring defect, ISSUE-049)");
  assert.equal(concernNamesFinding("finding:F1 misreads the contract", ["F1"]), true, "the canonical token matches");
  assert.equal(concernNamesFinding("F1: the contract already covers this.", ["F1"]), true, "a bare exact token still names its finding");
  assert.equal(concernNamesFinding("the F1x finding is wrong", ["F1"]), false, "a token that merely CONTAINS the id is not the id");
  assert.equal(concernNamesFinding("finding:ses_a:F1 is wrong", ["ses_a:F1", "F1"]), true, "the namespaced id is matched whole");
  assert.equal(concernNamesFinding("nothing named here", ["F1"]), false, "a concern naming no finding is not a pushback");
});

test("[III1-pushback-exact-token] THE ESCAPE: the fixer pushes back on `finding:F10` while F1 is the routed finding — F1 must NOT be adjudicated as pushed back, so its fix stays required", async () => {
  const bench = seedBench({
    reviewMaxRounds: 2,
    respond: (req) => {
      if (req.lenses !== null) {
        const round = Math.floor(req.lensOrdinal / 3);
        const found = round === 0 && req.lenses.includes(CORRECTNESS) ? [{ id: "F1", lens: CORRECTNESS }] : [];
        return { kind: "reply", text: findingsJson(found, honestWitness(req.text)) };
      }
      if (req.role === "skeptic") return { kind: "reply", text: verdictJson("F1", true, null) };
      if (req.role === "implementer" || req.role === "testWriter") {
        if (bench !== undefined) touchSubject(bench, "FIX-DESPITE-THE-STRAY-CONCERN");
        return { kind: "reply", text: implJson("DONE_WITH_CONCERNS", ["finding:F10 is unrelated and wrong"]) };
      }
      return { kind: "reply", text: vetJson() };
    },
  });

  const res = await review(bench);
  const skeptics = bench.wiring.byRole("skeptic");
  assert.equal(skeptics.length, 1, "exactly ONE skeptic round: the stray F10 concern earns F1 no pushback adjudication");
  assert.equal(res.ok, true, "the fix landed and the next round settled the item");
});

test("[III1-reply-protocol-named] the generated MECHANICS names every reply status the schema admits and the EXACT concern format, so the protocol is single-sourced rather than spelled in a dispatch prompt", () => {
  const rendered = renderReplyProtocol();
  for (const status of ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"]) {
    assert.ok(rendered.includes(status), `the reply protocol must name the ${status} status`);
  }
  assert.ok(rendered.includes("finding:<id>"), "the reply protocol must carry the EXACT concern token format");

  const mechanics = renderMechanics("receive-review.md");
  assert.ok(mechanics.includes(rendered), "receive-review.md's generated mechanics carries the reply protocol verbatim");

  const pack = readPack("receive-review.md");
  assert.ok(pack.includes(rendered), "the checked-in receive-review.md pack carries the generated reply protocol (regenerate after a change)");
});

// ===========================================================================
// 5. Doctrine — the packs say what the machine now does.
// ===========================================================================

test("[III1-doctrine-review] D15b: review.md keeps its honest calibration line VERBATIM, and states the read witness the harness checks", () => {
  const review = flat(readPack("review.md"));
  assert.ok(
    review.includes(flat("An empty findings list is a valid, complete review — it IS the approval. Do not invent findings to look thorough.")),
    "review.md's calibration line is KEPT verbatim — GAP-011 prices the empty review, it never forbids it",
  );
  assert.ok(review.includes("read witness"), "review.md must name the read witness every reply carries");
  assert.ok(/nonce/i.test(review), "review.md must name the dispatch nonce");
  assert.ok(review.includes("citedRanges"), "review.md must name the cited-ranges field by its schema name");
});

test("[III1-doctrine-skeptic] skeptic.md drops 'uncertain ⇒ refuted', teaches the abstention that upholds, splits 'could not refute' from 'could not evaluate', and carries the P10 identifier-position rule", () => {
  const skeptic = flat(readPack("skeptic.md"));
  assert.ok(/abstention|abstains?\b/i.test(skeptic), "skeptic.md must name the abstention verdict");
  assert.ok(
    /an abstention upholds/i.test(skeptic),
    "skeptic.md must state that an abstention UPHOLDS the finding (D11)",
  );
  assert.ok(
    !/When you cannot decide, the verdict is/i.test(skeptic),
    "skeptic.md must no longer instruct 'when you cannot decide, the verdict is refuted' — that is the C-082/P10 biasing instruction",
  );
  assert.ok(skeptic.includes("refutationEvidence"), "skeptic.md must name the refutation-evidence field the schema carries");
  assert.ok(/could not evaluate/i.test(skeptic), "skeptic.md must name the 'could not evaluate' case");
  assert.ok(/could not refute/i.test(skeptic), "skeptic.md must name the 'could not refute after a real attempt' case as a DIFFERENT thing");
  assert.ok(
    /identifier position/i.test(skeptic),
    "skeptic.md must carry the P10 identifier-position rule: count identifier positions, not prose occurrences",
  );
});

test("[III1-doctrine-receive-review] receive-review.md names the pushback channel by its status and its exact concern token", () => {
  const pack = flat(readPack("receive-review.md"));
  assert.ok(pack.includes("DONE_WITH_CONCERNS"), "receive-review.md must name the status the pushback rides");
  assert.ok(pack.includes("finding:<id>"), "receive-review.md must carry the exact concern token format");
  assert.ok(
    /touched no file|touches no file|diffs the tree/i.test(pack),
    "receive-review.md must state the receipt floor: a DONE is diffed against the tree",
  );
});
