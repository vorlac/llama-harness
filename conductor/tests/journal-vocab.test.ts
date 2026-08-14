// conductor/tests/journal-vocab.test.ts — the guard for the §7.4 CLOSED event
// vocabulary, at the two places it can be breached.
//
// adapter/journal.ts THROWS on an event name that core/journal-events.ts EVENTS
// does not list (outside NODE_ENV=production). That check is only as good as the
// call sites it actually sees: every handler test in this suite injects its own
// capturing journal sink, which accepts anything, so a handler could — and did —
// ship a name the REAL journal refuses. The Phase 9 milestone gate found four
// such names on live paths (the §3.6 override hatch's grant/consume/refuse
// records, handlePublish's git.preexistingDirty:"refuse" arm, handleReport's
// §2.9 stop-report path, and openWorkspace's live-foreign-lock contention
// record). Every one of them would have thrown in production-shaped dev/test use
// at the exact moment its path ran.
//
// Two independent guards, because each is blind where the other sees:
//
//   (1) A SOURCE audit of every `.log(` call site under conductor/{core,adapter,
//       plugin}. It covers paths no test drives, which is precisely how these
//       four survived. It cannot prove a path is reachable.
//   (2) LIVE drives of the four repaired paths through the REAL createJournal —
//       no capturing sink anywhere — so the vocabulary is proven against the
//       writer that enforces it, on code that actually executed.
//
// Anti-vacuity (C-045): both guards assert floors on what they inspected. A scan
// that finds nothing, and a drive whose fixture stopped reaching its branch, must
// be RED rather than a silent pass.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateJournal, StateStore } from "../adapter/state.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import {
  gateBeforeToolCall,
  handleOverride,
  handlePublish,
  handleReport,
} from "../adapter/tools.ts";
import type {
  GateHookInput,
  OverrideGrant,
  OverrideInput,
  PublishInput,
  RegistryEntry,
  ReportInput,
} from "../adapter/tools.ts";
import { EVENTS, isKnownEvent } from "../core/journal-events.ts";
import { SCHEMAS } from "../core/types.ts";
import type {
  Config,
  EvidenceRecord,
  Item,
  ItemState,
  JournalRecord,
  Queue,
  QueueItem,
} from "../core/types.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");

// ===========================================================================
// (1) The SOURCE audit
// ===========================================================================

// Everything under conductor/ that ships (the legaltools-callsites.test.ts list).
const PRODUCTION_DIRS = ["core", "adapter", "plugin"];

// Anti-vacuity floors, measured at the time this guard was written. They are
// LOWER bounds, not counts: they exist so a walk that silently stops finding
// files, or a parser that silently stops matching, is RED instead of green.
const MIN_FILES_SCANNED = 12;
const MIN_CALL_SITES = 80;
const MIN_SITES_IN_TOOLS = 60;
const MIN_SITES_IN_STATE = 4;

// The ONLY call sites allowed to name their component/event through a variable.
// Each is a pass-through seam that forwards a name its caller already chose (and
// whose caller IS audited below); a NEW entry here would be the obvious way to
// smuggle an unlisted name past this guard, so the set is pinned exactly rather
// than merely counted. Deliberately line-free: this list must not churn when an
// unrelated edit shifts a line number.
const EXPECTED_DYNAMIC_SITES: readonly string[] = [
  'adapter/evidence.ts: .log(component="evidence", event=record.kind)',
  "adapter/tools.ts: .log(component=component, event=event)",
  "adapter/tools.ts: .log(component=component, event=event)",
];

interface CallSite {
  file: string;
  line: number;
  args: string[];
  text: string;
}

// Comments are BLANKED, not deleted, so line numbers survive and prose that
// merely mentions `journal.log(...)` is never scanned as a call site (the
// legaltools-callsites.test.ts idiom, for the same reason it was needed there).
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
    } else if (two === "/*") {
      while (i < source.length && source.slice(i, i + 2) !== "*/") {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts")) out.push(full);
    }
  };
  for (const dir of PRODUCTION_DIRS) walk(path.join(conductorDir, dir));
  return out;
}

// Every `X.log(...)` call except console.log, with its arguments split at depth 1
// so a nested call or an inline object literal never splits an argument.
function logCallSites(files: string[]): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    const rel = path.relative(conductorDir, file);
    for (const match of source.matchAll(/\.log\s*\(/g)) {
      const before = source.slice(Math.max(0, match.index - 12), match.index);
      if (/console\s*$/.test(before)) continue;
      const openIdx = match.index + match[0].length - 1;

      let depth = 1;
      let i = openIdx + 1;
      const args: string[] = [];
      let current = "";
      while (depth > 0 && i < source.length) {
        const ch = source[i];
        if (ch === "(" || ch === "{" || ch === "[") depth += 1;
        else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
        if (depth === 0) break;
        if (ch === "," && depth === 1) {
          args.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
        i += 1;
      }
      if (current.trim().length > 0) args.push(current.trim());
      sites.push({
        file: rel,
        line: source.slice(0, match.index).split("\n").length,
        args,
        text: source.slice(match.index, i + 1).replace(/\s+/g, " ").slice(0, 120),
      });
    }
  }
  return sites;
}

// A double-quoted string literal argument, unwrapped; null for anything else.
function literalOf(arg: string | undefined): string | null {
  if (arg === undefined) return null;
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(arg);
  return match === null ? null : (JSON.parse(arg) as string);
}

test("[vocab-callsites] EVERY literal journal call site in shipped code names an event inside the CLOSED §7.4 vocabulary — the handler suites all inject accepting sinks, so this source audit is the only guard that sees a path no test drives", () => {
  // The checker is not vacuously true: a fabricated name really is rejected.
  assert.equal(
    isKnownEvent("state", "definitely-not-a-listed-event-9915"),
    false,
    "premise: isKnownEvent rejects an unlisted name (otherwise every assertion below is vacuous)",
  );

  const files = productionFiles();
  assert.ok(
    files.length >= MIN_FILES_SCANNED,
    `walked only ${files.length} shipped .ts files (>= ${MIN_FILES_SCANNED} exist) — the walk is broken`,
  );

  const sites = logCallSites(files);
  assert.ok(
    sites.length >= MIN_CALL_SITES,
    `found only ${sites.length} journal call sites (>= ${MIN_CALL_SITES} exist) — the parser is ` +
      "broken, and a broken scan must be RED rather than a vacuous green (C-045)",
  );
  assert.ok(
    sites.filter((s) => s.file === path.join("adapter", "tools.ts")).length >= MIN_SITES_IN_TOOLS,
    `adapter/tools.ts yielded fewer than ${MIN_SITES_IN_TOOLS} call sites — the file carrying most of ` +
      "the §3.4 handlers cannot have gone quiet, so the scan missed it",
  );
  assert.ok(
    sites.filter((s) => s.file === path.join("adapter", "state.ts")).length >= MIN_SITES_IN_STATE,
    `adapter/state.ts yielded fewer than ${MIN_SITES_IN_STATE} call sites — the scan missed it`,
  );

  // Every site is either literal (auditable here) or an allowlisted forwarder.
  // Anything the parser could not read at all is a HOLE, not a pass.
  const unreadable = sites.filter((s) => s.args.length < 3);
  assert.deepEqual(
    unreadable.map((s) => `${s.file}:${s.line} — ${s.text}`),
    [],
    "a journal call site whose arguments this audit could not read is a hole in the audit",
  );

  const dynamic = sites
    .filter((s) => literalOf(s.args[1]) === null || literalOf(s.args[2]) === null)
    .map((s) => `${s.file}: .log(component=${s.args[1]}, event=${s.args[2]})`)
    .sort();
  assert.deepEqual(
    dynamic,
    [...EXPECTED_DYNAMIC_SITES].sort(),
    "the set of call sites naming their event through a VARIABLE changed. Those sites are invisible " +
      "to this audit, so each one must be a pass-through seam whose caller is itself audited — never " +
      "a handler that computes an event name. Add it here only with that argument.",
  );

  const literal = sites.filter(
    (s) => literalOf(s.args[1]) !== null && literalOf(s.args[2]) !== null,
  );
  assert.equal(
    literal.length + dynamic.length,
    sites.length,
    "every call site is classified exactly once (literal or dynamic) — no site fell through",
  );
  assert.ok(literal.length >= MIN_CALL_SITES - EXPECTED_DYNAMIC_SITES.length, "premise: the literal sites are the bulk of them");

  const breaches = literal
    .filter((s) => !isKnownEvent(literalOf(s.args[1]) as string, literalOf(s.args[2]) as string))
    .map((s) => `${s.file}:${s.line} logs "${literalOf(s.args[1])}"/"${literalOf(s.args[2])}"`);
  assert.deepEqual(
    breaches,
    [],
    "these call sites name a component/event pair core/journal-events.ts EVENTS does not list. The " +
      "REAL journal THROWS on each of them the moment its path runs (adapter/journal.ts, dev/test). " +
      "Fix by using an EXISTING name that honestly describes what happened; widening the closed " +
      "vocabulary is a spec decision, not a call-site one (§7.4).",
  );
});

test("[vocab-callsites] the one component whose event name is computed — evidence — can only compute names the vocabulary lists", () => {
  // adapter/evidence.ts logs `record.kind` verbatim, so the audit above cannot
  // read it. It is closed from the other end instead: the §2.6 kind enum, read
  // off the SAME core schema the writer validates against, must be a SUBSET of
  // EVENTS.evidence.
  const schema = SCHEMAS.EvidenceRecord as { properties: { kind: { enum: readonly string[] } } };
  const kinds = schema.properties.kind.enum;
  assert.ok(Array.isArray(kinds) && kinds.length >= 3, "premise: the §2.6 kind enum was read off SCHEMAS");
  for (const kind of kinds) {
    assert.equal(
      isKnownEvent("evidence", kind),
      true,
      `evidence kind "${kind}" is written to the journal as its event name, so it must be listed in EVENTS.evidence`,
    );
  }
  assert.equal(
    EVENTS.evidence.every((event) => kinds.includes(event)),
    true,
    "and the two lists agree in both directions — an EVENTS.evidence entry that is not a §2.6 kind is dead vocabulary",
  );
});

// ===========================================================================
// (2) The LIVE drives — the REAL journal, which throws on an unlisted name
// ===========================================================================

const START_MS = 1_755_200_000_000;
const WORKSPACE_KEY = "wkey-vocab";
const SCOPE = "unit-vocab-3317";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
  GIT_TERMINAL_PROMPT: "0",
};

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8" });
}

function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function committedRepo(): string {
  const dir = scratch("conductor-vocab-repo-");
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "beta.mjs"), "export const parse = (s) => Number(s);\n");
  writeFileSync(path.join(dir, "tests", "beta.test.mjs"), "import test from 'node:test';\ntest('t', () => {});\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function headSha(dir: string): string {
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

// THE journal for every drive below: adapter/journal.ts's real writer, teed so the
// records can be inspected. There is deliberately no capturing-only sink in this
// file — an unlisted event THROWS out of the handler under test.
interface Tee {
  journal: Journal;
  records: JournalRecord[];
  journalPath: string;
}

function realJournal(runDir: string, config: Config): Tee {
  mkdirSync(runDir, { recursive: true });
  const real = createJournal(runDir, config, {});
  const records: JournalRecord[] = [];
  const journal: Journal = {
    log: (level, component, event, data, corr): void => {
      records.push({ seq: 0, ts: 0, level, component, runId: corr.runId, event, data });
      real.log(level, component, event, data, corr);
    },
    flushSync: (): void => real.flushSync(),
  };
  return { journal, records, journalPath: path.join(runDir, "journal.jsonl") };
}

// The §7.4 assertion every drive ends with: at least `floor` records were emitted
// (a path that journaled nothing proves nothing) and every one of them is in the
// closed vocabulary. The real journal has already refused any that were not — this
// re-states it against the RECORDS so a future journal that stopped enforcing is
// caught here too.
function assertAllInVocabulary(tee: Tee, floor: number, what: string): void {
  assert.ok(
    tee.records.length >= floor,
    `${what}: expected at least ${floor} journal records, saw ${tee.records.length} — a drive that ` +
      "journaled nothing would pass this guard vacuously",
  );
  const outside = tee.records
    .filter((r) => !isKnownEvent(r.component, r.event))
    .map((r) => `${r.component}/${r.event}`);
  assert.deepEqual(outside, [], `${what}: these events are outside the closed §7.4 vocabulary`);
}

// The records the real writer actually PERSISTED, read back off journal.jsonl.
function persisted(tee: Tee): JournalRecord[] {
  tee.journal.flushSync();
  if (!existsSync(tee.journalPath)) return [];
  return readFileSync(tee.journalPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

function makeConfig(over: {
  preexistingDirty?: Config["git"]["preexistingDirty"];
  maxOverridesPerItem?: number;
  maxOverridesPerRun?: number;
} = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: { command: [process.execPath, "-e", "0"], timeoutMs: 120_000 } },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "src/**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: over.preexistingDirty ?? "exclude" },
    workflow: {
      trivialMaxFiles: 1,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 3,
      maxOverridesPerItem: over.maxOverridesPerItem ?? 1,
      maxOverridesPerRun: over.maxOverridesPerRun ?? 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// openWorkspace takes the workspace-level sink (its runId is optional because the
// lock precedes any run), so the real journal is adapted rather than re-created.
function stateSinkOf(tee: Tee): StateJournal {
  return {
    log: (level, component, event, data, corr): void => {
      tee.journal.log(
        level as JournalRecord["level"],
        component,
        event,
        data,
        {
          runId: corr.runId ?? "",
          ...(corr.itemId === undefined ? {} : { itemId: corr.itemId }),
          ...(corr.sessionID === undefined ? {} : { sessionID: corr.sessionID }),
        },
      );
    },
  };
}

function openStore(root: string, tee: Tee, config: Config, pid?: number): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal: stateSinkOf(tee),
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: pid ?? process.pid,
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

function makeQueueItem(id: string, fileScope: string[], testScope: string[]): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...fileScope],
    testScope: [...testScope],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

const NEVER_FROZEN: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

interface Bench {
  root: string;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  tee: Tee;
}

// One run, one queue item, on a real repo. `dirty` runs BEFORE the run exists, so
// what it writes lands in run.startDirty (the §3.9 pre-existing-WIP set).
function buildBench(opts: {
  config: Config;
  itemState: ItemState;
  fileScope?: string[];
  testScope?: string[];
  dirty?: (root: string) => void;
}): Bench {
  const root = committedRepo();
  const stateHome = scratch("conductor-vocab-state-");
  if (opts.dirty !== undefined) opts.dirty(root);

  // The journal dir is the run dir, which only exists after createRun — so the tee
  // is built on the path createRun will make, and mkdir'd up front.
  const tee = realJournal(path.join(root, ".conductor", "journal-vocab"), opts.config);
  const store = openStore(root, tee, opts.config);
  const run = store.createRun({
    prompt: "make the beta parser keep the sign of negative offsets",
    sessionID: "ses_orchestrator",
    classification: { kind: "work", rationale: "a behavioural change", check: { agreed: true, note: "" } },
  });
  const runId = run.runId;
  const runDir = path.join(root, ".conductor", "runs", runId);
  run.state = "EXECUTING";
  store.saveRun(run);

  const queue: Queue = {
    items: [makeQueueItem("I1", opts.fileScope ?? ["src/beta.mjs"], opts.testScope ?? ["tests/beta.test.mjs"])],
  };
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  store.saveItem(runId, makeRuntimeItem("I1", opts.itemState));

  return { root, stateHome, store, runId, runDir, config: opts.config, tee };
}

function appendEvidence(runDir: string, record: EvidenceRecord): EvidenceRecord {
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  return record;
}

async function noMetrics(): Promise<null> {
  return null;
}

function makeFanout(bench: Bench): Fanout {
  const registry = new Map<string, { role: string; itemId?: string; tree?: string }>();
  // A fan-out engine is required by handlePublish's uniform input shape; the paths
  // driven here dispatch nothing, so the client is never called.
  const client = {
    session: {
      create: async (): Promise<{ data: { id: string } }> => ({ data: { id: "ses_never" } }),
      prompt: async (): Promise<{ data: { info: { sessionID: string; finish: string }; parts: [] } }> => ({
        data: { info: { sessionID: "ses_never", finish: "stop" }, parts: [] },
      }),
      abort: async (): Promise<{ data: boolean }> => ({ data: true }),
      messages: async (): Promise<{ data: [] }> => ({ data: [] }),
    },
  };
  return createFanout(
    client as unknown as Parameters<typeof createFanout>[0],
    bench.config,
    bench.tee.journal,
    registry as unknown as Parameters<typeof createFanout>[3],
    NEVER_FROZEN,
    bench.runId,
  );
}

// ---------------------------------------------------------------------------
// Drive A: the live-foreign-lock contention record (adapter/state.ts)
// ---------------------------------------------------------------------------

test("[vocab-live-lock] a LIVE foreign lock journals its contention record through the REAL journal — the §4.1 second-session path must not throw on its own event name", () => {
  const root = committedRepo();
  const config = makeConfig();
  const tee = realJournal(path.join(root, ".conductor", "journal-vocab"), config);

  // A lock owned by a DIFFERENT, still-alive process (this test process itself).
  const stateDir = path.join(root, ".conductor", "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, "run.lock"),
    JSON.stringify({ pid: process.pid, startMs: START_MS - 1000 }),
  );

  const store = openStore(root, tee, config, process.pid + 1);

  // Premise: the contention branch is the branch that ran. Without this the test
  // could pass on a fixture where the lock was simply claimed.
  assert.equal(store.readOnly, true, "premise: a live foreign lock forced read-only (§4.1)");

  assertAllInVocabulary(tee, 1, "the lock-contention path");
  const onDisk = persisted(tee);
  assert.ok(
    onDisk.some((r) => r.component === "state" && r.event.startsWith("lock.")),
    "the contention record was PERSISTED by the real writer, not merely accepted",
  );
});

// ---------------------------------------------------------------------------
// Drive B: the §3.6 override hatch — granted, then consumed at the gate
// ---------------------------------------------------------------------------

test("[vocab-live-override-granted] handleOverride's grant AND the gate decision that consumes it both journal through the REAL journal — the §3.6 hatch's two records must be in the closed vocabulary", async () => {
  const bench = buildBench({
    config: makeConfig({ maxOverridesPerItem: 2, maxOverridesPerRun: 2 }),
    itemState: "RED",
    fileScope: ["src/beta.mjs"],
  });
  const grants = new Map<string, OverrideGrant>();
  const outOfScope = path.join(bench.root, "src", "generated-header.mjs");

  const attemptEdit = (withGrants: boolean): { allowed: boolean; reason: string } => {
    const registry = new Map<string, RegistryEntry>([
      ["ses_impl", { role: "implementer", itemId: "I1", tree: bench.root }],
    ]);
    const input: GateHookInput = {
      sessionID: "ses_impl",
      toolName: "edit",
      args: { filePath: outOfScope },
      editPath: outOfScope,
      registry,
      gitMode: "commit",
      runActive: true,
      branchPolicy: "pin",
      fileScope: ["src/beta.mjs"],
      testScope: ["tests/beta.test.mjs"],
      verifyInFlightTree: null,
      inlineClaimScope: null,
      journal: bench.tee.journal,
      corr: { runId: bench.runId, itemId: "I1", sessionID: "ses_impl" },
      ...(withGrants ? { overrideGrants: grants } : {}),
    };
    try {
      gateBeforeToolCall(input);
      return { allowed: true, reason: "" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // A journal refusal is NOT a gate denial: it must never be swallowed as one.
      assert.ok(
        !reason.includes("event vocabulary"),
        `the gate path threw a JOURNAL vocabulary error rather than a gate decision: ${reason}`,
      );
      return { allowed: false, reason };
    }
  };

  // Premise: without a grant this exact edit is denied, so an "allowed" below can
  // only have come from the grant being consumed.
  assert.equal(attemptEdit(false).allowed, false, "premise: the edit gate denies this out-of-scope path");

  const overrideInput: OverrideInput = {
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.tee.journal,
    now: () => START_MS,
    sessionID: "ses_impl",
    itemId: "I1",
    gate: "edit",
    reason: "the edit gate cannot see the generated header",
    grantedAction: "edit src/generated-header.mjs",
    overrideGrants: grants,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: noMetrics,
  };
  const before = bench.tee.records.length;
  const result = await handleOverride(overrideInput);
  assert.equal(result.granted, true, "premise: the override was granted (the budget had room)");
  assert.ok(
    bench.tee.records.length > before,
    "premise: granting the override journaled at least one record for this guard to judge",
  );

  const consumed = attemptEdit(true);
  assert.equal(consumed.allowed, true, "premise: the grant converted the denial to an allow");
  assert.equal(grants.size, 0, "premise: the one-shot grant was spent");

  assertAllInVocabulary(bench.tee, 3, "the override grant + consumption path");
  assert.equal(
    persisted(bench.tee).length > 0,
    true,
    "the real writer PERSISTED the hatch's records",
  );
});

// ---------------------------------------------------------------------------
// Drive C: the over-budget refusal, which also drives the §2.9 stop-report
// ---------------------------------------------------------------------------

test("[vocab-live-override-refused] an over-budget override records its refusal AND writes the §2.9 stop-report, both through the REAL journal — two paths, two event names, neither of which may be outside the vocabulary", async () => {
  const bench = buildBench({
    config: makeConfig({ maxOverridesPerItem: 0, maxOverridesPerRun: 5 }),
    itemState: "RED",
  });
  // The item's test file exists on disk, so the stop-report's §2.11 stale-red
  // registration has a candidate and the report path does real work.
  assert.ok(existsSync(path.join(bench.root, "tests", "beta.test.mjs")), "premise: the item's test file is on disk");

  const grants = new Map<string, OverrideGrant>();
  const result = await handleOverride({
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.tee.journal,
    now: () => START_MS,
    sessionID: "ses_impl",
    itemId: "I1",
    gate: "edit",
    reason: "the edit gate cannot see the generated header",
    grantedAction: "edit src/generated-header.mjs",
    overrideGrants: grants,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: noMetrics,
  });

  // Premises: the refusal branch ran, and it dragged the stop-report writer with it.
  assert.equal(result.granted, false, "premise: over budget, the override was refused");
  assert.equal(result.stop?.kind, "env", "premise: the refusal recorded the §2.9 env stop");
  assert.equal(grants.size, 0, "premise: nothing was granted");
  assert.ok(result.reportPath !== null && existsSync(result.reportPath), "premise: the stop-report was written");

  assertAllInVocabulary(bench.tee, 2, "the over-budget refusal + stop-report path");
  assert.ok(persisted(bench.tee).length >= 2, "the real writer PERSISTED both records");
});

test("[vocab-live-stop-report] handleReport in §2.9 STOP mode, driven directly on an already-stopped run, journals inside the closed vocabulary", async () => {
  const bench = buildBench({ config: makeConfig(), itemState: "RED" });
  const run = bench.store.loadRun(bench.runId);
  run.stop = { kind: "interrupt", reasonDisplay: "the halt file was present", tsMs: START_MS };
  bench.store.saveRun(run);

  const input: ReportInput = {
    store: bench.store,
    fanout: makeFanout(bench),
    runId: bench.runId,
    config: bench.config,
    journal: bench.tee.journal,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
    metrics: noMetrics,
  };
  const before = bench.tee.records.length;
  const report = await handleReport(input);

  // Premise: STOP mode is the mode that ran (not the full/lite `done` path).
  assert.equal(report.stopReport, true, "premise: the writer took its §2.9 stop-report mode");
  assert.equal(report.verifySeq, null, "premise: a stop-report runs no closing verify");
  assert.ok(
    bench.tee.records.length > before,
    "premise: the stop-report path journaled at least one record for this guard to judge",
  );

  assertAllInVocabulary(bench.tee, 1, "the stop-report path");
});

// ---------------------------------------------------------------------------
// Drive D: handlePublish's git.preexistingDirty "refuse" arm
// ---------------------------------------------------------------------------

test('[vocab-live-publish-refuse] handlePublish under git.preexistingDirty "refuse" surfaces its scope-conflict question through the REAL journal — the arm that meets the human\'s uncommitted work must not throw on its own event name', async () => {
  const wip = "export const parse = (s) => Number(s); // human WIP\n";
  const bench = buildBench({
    config: makeConfig({ preexistingDirty: "refuse" }),
    itemState: "REVIEWED",
    dirty: (root) => {
      writeFileSync(path.join(root, "src", "beta.mjs"), wip);
    },
  });

  // Premise: the human's WIP really is in the run's pre-existing dirty set, which
  // is the only thing that can send publish down the refuse arm.
  assert.ok(
    (bench.store.loadRun(bench.runId).startDirty ?? []).includes("src/beta.mjs"),
    "premise: the WIP is recorded in run.startDirty",
  );

  // The §2.6 verify this publish would rest on, produced at the CURRENT head.
  const verify: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "verify",
    itemId: "I1",
    startedMs: START_MS + 60_000,
    head: headSha(bench.root),
    branch: "main",
    tree: "main",
    excluded: [],
    green: true,
    scopes: { [SCOPE]: { green: true, exitCode: 0, durationMs: 5 } },
  };
  appendEvidence(bench.runDir, verify);
  const item = bench.store.loadItem(bench.runId, "I1");
  item.evidence.validated = { ledger: "evidence.jsonl", seq: verify.seq };
  bench.store.saveItem(bench.runId, item);

  const input: PublishInput = {
    store: bench.store,
    fanout: makeFanout(bench),
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: bench.tee.journal,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  };
  const before = bench.tee.records.length;
  const result = await handlePublish(input);

  // Premises: the REFUSE arm is the arm that ran — not a denial from an earlier
  // step (no verify record, head drift, wrong state), which would journal nothing.
  assert.equal(result.ok, false, "premise: publish was denied");
  assert.ok((result.denial ?? "").includes("src/beta.mjs"), "premise: the denial names the conflicting path");
  assert.ok(result.questionId !== null, "premise: the refuse arm minted its scope-conflict question");
  assert.ok(
    bench.tee.records.length > before,
    "premise: the refuse arm journaled a record for this guard to judge",
  );

  assertAllInVocabulary(bench.tee, 1, "the publish refuse path");
  const onDisk = persisted(bench.tee);
  assert.ok(onDisk.length > 0, "the real writer PERSISTED the refuse arm's record");
  assert.deepEqual(
    onDisk.filter((r) => !isKnownEvent(r.component, r.event)).map((r) => `${r.component}/${r.event}`),
    [],
    "and every PERSISTED record — read back off journal.jsonl, not off the tee — is in the vocabulary",
  );
});
