// Task 15.0 RED tests — FINAL LOCATION conductor/tests/replay.test.ts.
//
// SUBJECT (must NOT exist when this goes red): conductor/tools/replay.ts — the
// §7.3 journal -> human timeline renderer (plan §1.1:366, §7.3:1946-1953, Task
// 15.0 bullet 3028-3035). The red is the missing-subject shape:
//   Cannot find module '../tools/replay.ts'
//
// A SECOND, deliberate red rides in the same file: this test imports LOG_LEVELS
// from ../core/types.ts, where the §7.1 severity order lives at :22 as a
// MODULE-PRIVATE const. Per spec-gap SG-2 the implementer adds the single word
// `export` there so replay (and this test) read the one order instead of a third
// private copy. Until that word lands, the import does not link. Both failures
// are legal missing-subject reds; neither is a syntax error.
//
// SPEC READ:
//   plan §7.3:1946-1953   — the four views and the three flags (normative).
//   plan Task 15.0:3028-3035 — the build order (pure render functions, thin
//                           argv/stdout shell at the bottom).
//   plan §7.1:1909-1929   — levels, sinks, rotation to journal.N.jsonl.gz.
//   plan §7.2:1930-1945   — the record shape and the closed event vocabulary.
//   plan §7.4:1956-1963   — the debuggability law: never silently lose a record.
//   docs/build/specs/task-15.0.assertions.json — the 27 rows mapped 1:1 to the
//                           27 tests below, plus SG-1..SG-12.
//
// ---------------------------------------------------------------------------
// PINNED MODULE SURFACE (SG-1). The implementer builds to exactly this.
// ---------------------------------------------------------------------------
//   export interface Malformed { line: number; raw: string; reason: string }
//     `line` is 1-BASED within its own source file.
//   export interface ReplayFilters {
//     components?: string[]; level?: LogLevel; items?: string[] }
//   export interface Lane { itemId: string | null; rows: JournalRecord[] }
//   export interface FanoutRow {
//     sessionID: string | null;   // null when the record carries none, or ""
//     role: string | null; itemId: string | null;
//     tree: string | null; model: string | null;
//     lens: string | null;        // data.lens when the producer wrote one
//     attempts: number;           // 1 + the subsession.retry records in between
//     durationMs: number | null;  // terminal.ts - dispatched.ts; null if unpaired
//     outcome: string;            // "ok" | the terminal record's data.reason
//                                 // | "unterminated" | "hold"
//   }
//   export interface ReviewRoundRow {
//     subject: string;            // record.itemId ?? "plan"
//     round: number;              // data.round (guard-reject) | data.rounds (transition)
//     max: number | null;
//     findings: number | null;                // data.findings, guard-reject
//     findingsRaised: { major: number; minor: number; nit: number } | null;
//     survivingMajors: number;
//     lenses: string[];           // data.lenses roster, else []
//     why: string | null;
//     outcome: string;            // "re-round" (guard-reject) | "accepted" (transition)
//     reviewers: number; skeptics: number;    // dispatches inside this round's window
//   }
//
//   parseJournalText(text: string): { records: JournalRecord[]; malformed: Malformed[] }
//   applyFilters(records: readonly JournalRecord[], filters: ReplayFilters): JournalRecord[]
//   deriveSwimlanes(records: readonly JournalRecord[]): Lane[]
//   deriveFanoutRows(records: readonly JournalRecord[]): FanoutRow[]
//   deriveReviewRounds(records: readonly JournalRecord[]): ReviewRoundRow[]
//   renderTimeline(input: {
//     records: readonly JournalRecord[];
//     malformed: readonly Malformed[];
//     filters: ReplayFilters;
//     sources: readonly { file: string; ok: boolean; error?: string }[];
//   }): string
//   parseArgs(argv: readonly string[]):
//       { ok: true; runDir: string; filters: ReplayFilters }
//     | { ok: false; error: string; exitCode: number }
//   readRunJournal(runDir: string): {
//     records: JournalRecord[]; malformed: Malformed[];
//     sources: { file: string; ok: boolean; error?: string }[] }
//
// Everything except readRunJournal and the CLI leg is PURE: no fs, no clock, no
// process. `parseArgs` receives the ARGUMENT list only (process.argv.slice(2)),
// with the run dir as the first non-flag positional.
//
// ---------------------------------------------------------------------------
// PINNED RENDER FORMAT (SG-9: plain ASCII, no ANSI, deterministic bytes)
// ---------------------------------------------------------------------------
//   Sections are introduced by a line that is exactly `== NAME ==`, in this
//   order: SOURCES, SWIMLANES, DENIALS, FAN-OUT, REVIEW ROUNDS, MALFORMED.
//   A section with nothing to show still appears, with the literal `(none)` in
//   its body — an omitted section and an empty one must not look alike.
//   ONE LINE PER RECORD in SWIMLANES; each record line carries the recorded seq
//   verbatim as the whitespace-delimited token `#<seq>` and the record's ts as an
//   ISO-8601 UTC string (`2026-08-14T12:34:56.789Z`).
//   Markers are bare uppercase ASCII tokens, each independently greppable:
//     DENY  CRASH  TRUNCATED  UNKNOWN-EVENT  UNTERMINATED  NO-SESSION
//     UNKNOWN-LENS  NO-RECORDS
//   A gates/deny row carries DENY in its swimlane line and a DENIALS entry; a
//   gates/gate-crash row carries CRASH in both places, under its own marker.
//
// Exit codes (SG-7, what Task 15.1 will document): 0 rendered (an empty journal
// renders NO-RECORDS and still exits 0); 2 usage error (stderr, nothing on
// stdout); 1 the run dir holds no readable journal source at all, naming it.
//
// FIXTURES: built here at runtime, in temp dirs this file creates and removes.
// Two rows cross-check the fixtures against reality by driving the COMMITTED
// writer (adapter/journal.ts createJournal) to produce the journal replay reads.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { COMPONENTS, isKnownEvent } from "../core/journal-events.ts";
import { LOG_LEVELS, validate } from "../core/types.ts";
import type { Config, JournalRecord, LogLevel } from "../core/types.ts";
import { createJournal } from "../adapter/journal.ts";

// The subject. Absent at red time — this is the missing-subject failure.
import * as replayModule from "../tools/replay.ts";
import {
  applyFilters,
  deriveFanoutRows,
  deriveReviewRounds,
  deriveSwimlanes,
  parseArgs,
  parseJournalText,
  readRunJournal,
  renderTimeline,
} from "../tools/replay.ts";
import type { FanoutRow, Lane, Malformed, ReplayFilters, ReviewRoundRow } from "../tools/replay.ts";

// ---------------------------------------------------------------------------
// Paths, markers, section names
// ---------------------------------------------------------------------------

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorRoot = path.resolve(testsDir, "..");
const replayPath = path.join(conductorRoot, "tools", "replay.ts");

const SURFACE = [
  "applyFilters",
  "deriveFanoutRows",
  "deriveReviewRounds",
  "deriveSwimlanes",
  "parseArgs",
  "parseJournalText",
  "readRunJournal",
  "renderTimeline",
];

const MARK_DENY = "DENY";
const MARK_CRASH = "CRASH";
const MARK_TRUNCATED = "TRUNCATED";
const MARK_UNKNOWN_EVENT = "UNKNOWN-EVENT";
const MARK_UNTERMINATED = "UNTERMINATED";
const MARK_NO_SESSION = "NO-SESSION";
const MARK_UNKNOWN_LENS = "UNKNOWN-LENS";
const MARK_NO_RECORDS = "NO-RECORDS";
const EMPTY_SECTION = "(none)";

const SEC_SOURCES = "SOURCES";
const SEC_SWIMLANES = "SWIMLANES";
const SEC_DENIALS = "DENIALS";
const SEC_FANOUT = "FAN-OUT";
const SEC_REVIEW = "REVIEW ROUNDS";
const SEC_MALFORMED = "MALFORMED";

// The ESC byte, written as a six-character escape so this file stays text for
// grep (see tests/source-hygiene.test.ts).
const ESC = "\u001B";

const RUN_ID = "r-15.0";
const T0 = Date.UTC(2026, 7, 14, 12, 34, 56, 789); // 2026-08-14T12:34:56.789Z

interface Source {
  file: string;
  ok: boolean;
  error?: string;
}

const LIVE_SOURCE: Source = { file: "journal.jsonl", ok: true };

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let seqCounter = 0;

interface RecOver {
  seq?: number;
  ts?: number;
  level?: LogLevel;
  component: string;
  event: string;
  itemId?: string;
  sessionID?: string;
  data?: Record<string, unknown>;
}

/** One §7.2 record. Mirrors adapter/journal.ts:247-257 exactly: itemId and
 *  sessionID are present only when supplied (the correlation triple). */
function rec(over: RecOver): JournalRecord {
  seqCounter += 1;
  const out: JournalRecord = {
    seq: over.seq ?? seqCounter,
    ts: over.ts ?? T0,
    level: over.level ?? "info",
    component: over.component,
    runId: RUN_ID,
    event: over.event,
    data: over.data ?? {},
  };
  if (over.itemId !== undefined) out.itemId = over.itemId;
  if (over.sessionID !== undefined) out.sessionID = over.sessionID;
  return out;
}

function jsonl(records: readonly JournalRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

const tmpDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-replay-"));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function render(
  records: readonly JournalRecord[],
  filters: ReplayFilters = {},
  malformed: readonly Malformed[] = [],
  sources: readonly Source[] = [LIVE_SOURCE],
): string {
  return renderTimeline({ records, malformed, filters, sources });
}

/** The body of one `== NAME ==` section, up to the next section header. */
function section(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `== ${name} ==`);
  assert.ok(
    start >= 0,
    `the render must carry a "== ${name} ==" section header; got:\n${text}`,
  );
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^==\s.+\s==$/.test(l.trim()));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The single line of `text` containing `needle` (one line per record). */
function lineWith(text: string, needle: string): string {
  const hits = text.split("\n").filter((l) => l.includes(needle));
  assert.equal(
    hits.length,
    1,
    `expected exactly one line containing ${JSON.stringify(needle)} (one line per record); got ${hits.length} in:\n${text}`,
  );
  return hits[0];
}

function rowFor(rows: readonly FanoutRow[], sessionID: string): FanoutRow {
  const hits = rows.filter((r) => r.sessionID === sessionID);
  assert.equal(hits.length, 1, `expected exactly one fan-out row for ${sessionID}, got ${hits.length}`);
  return hits[0];
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: readonly string[]): CliResult {
  const r = spawnSync(process.execPath, [replayPath, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

type Parsed = ReturnType<typeof parseArgs>;

function okArgs(parsed: Parsed, label: string): { runDir: string; filters: ReplayFilters } {
  if (!parsed.ok) {
    assert.fail(`${label}: parseArgs must accept these arguments; it returned ${parsed.error}`);
  }
  return { runDir: parsed.runDir, filters: parsed.filters };
}

function errArgs(parsed: Parsed, label: string): { error: string; exitCode: number } {
  if (parsed.ok) {
    assert.fail(`${label}: parseArgs must REJECT these arguments; it accepted them`);
  }
  return { error: parsed.error, exitCode: parsed.exitCode };
}

/** A recursive name+content snapshot of a directory: the read-only proof. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    const entries = readdirSync(d, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      const key = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        out.push(`D ${key}`);
        walk(full, key);
      } else {
        out.push(`F ${key} ${readFileSync(full).toString("base64")}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** A full §2.1 Config, copied from the shape tests/journal.test.ts pins. */
function makeConfig(level: LogLevel): Config {
  const config: Config = {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "refuse" },
    workflow: {
      trivialMaxFiles: 2,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 6,
      skepticsPerFinding: 2,
      reviewMaxRounds: 3,
      vetCritics: 3,
      vetMaxRounds: 3,
      testRepairAttempts: 3,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 2,
    },
    parallel: { writes: "off", maxImplementers: 2, maxReaders: 6, subSessionTimeoutMs: 900000 },
    models: { default: "qwen3.6-27b", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 20, maxRunDirBytes: 268435456, pruneOnRunCreate: true },
    logging: { level, components: {} },
  };
  return config;
}

// ===========================================================================
// [15.0-module-surface]
// ===========================================================================

test("[15.0-module-surface] replay.ts exports exactly the eight SG-1 functions, guards its CLI leg on the argv[1] suffix, and importing it is side-effect free", () => {
  const mod = replayModule as unknown as Record<string, unknown>;
  for (const name of SURFACE) {
    assert.equal(typeof mod[name], "function", `replay.ts must export ${name} as a function`);
  }
  const exported = Object.keys(mod)
    .filter((k) => typeof mod[k] === "function")
    .sort();
  assert.deepEqual(
    exported,
    [...SURFACE].sort(),
    "the exported function surface must be exactly the SG-1 eight — no extra entry point, no missing one",
  );

  // The committed tools/ convention (export-schemas.ts:39): an argv[1] SUFFIX
  // guard, because Node type-stripping provides no import.meta.main and the
  // same file must load under Bun (G14).
  const src = readFileSync(replayPath, "utf8");
  assert.match(
    src,
    /endsWith\(\s*["']replay\.ts["']\s*\)/,
    'the CLI leg must be guarded by process.argv[1].endsWith("replay.ts"), the tools/export-schemas.ts:39 convention',
  );
  assert.equal(
    src.includes("import.meta.main"),
    false,
    "import.meta.main does not exist under Node type-stripping — the argv[1] suffix test is the portable equivalent (G14)",
  );

  // Side-effect freedom, proven in a child process whose argv[1] is the driver
  // (so the CLI guard cannot fire): the module's own stdout contribution is
  // nothing at all, and it creates no file.
  const dir = freshDir();
  const driver = path.join(dir, "driver.mjs");
  writeFileSync(
    driver,
    `import * as m from ${JSON.stringify(replayPath)};\n` +
      `process.stdout.write("IMPORT-OK:" + typeof m.renderTimeline);\n`,
  );
  const child = spawnSync(process.execPath, [driver], { cwd: dir, encoding: "utf8" });
  assert.equal(child.status, 0, `importing replay.ts must succeed; stderr was: ${child.stderr}`);
  assert.equal(
    child.stdout,
    "IMPORT-OK:function",
    "importing replay.ts must write NOTHING of its own to stdout — the CLI leg fires only for direct invocation",
  );
  assert.deepEqual(
    readdirSync(dir).sort(),
    ["driver.mjs"],
    "importing replay.ts must create no file anywhere",
  );
});

// ===========================================================================
// [15.0-parse-records-in-order]
// ===========================================================================

test("[15.0-parse-records-in-order] parseJournalText returns one record per well-formed line in FILE ORDER, skips blank lines silently, and never throws", () => {
  const a = rec({ seq: 11, component: "fsm", event: "transition" });
  const b = rec({ seq: 12, component: "gates", event: "allow" });
  const c = rec({
    seq: 13,
    component: "fanout",
    event: "subsession.dispatched",
    itemId: "I1",
    sessionID: "ses_a",
  });
  const text = ["", JSON.stringify(a), "   ", JSON.stringify(b), "", "\t", JSON.stringify(c), ""].join("\n");

  const out = parseJournalText(text);
  assert.deepEqual(
    out.records.map((r) => [r.seq, r.event]),
    [
      [11, "transition"],
      [12, "allow"],
      [13, "subsession.dispatched"],
    ],
    "records come back in FILE order, one per well-formed line",
  );
  assert.deepEqual(
    out.malformed,
    [],
    "a blank or whitespace-only line is skipped silently — it is not a malformed record",
  );

  const empty = parseJournalText("");
  assert.deepEqual(empty.records, [], "empty text yields zero records");
  assert.deepEqual(empty.malformed, [], "empty text yields zero malformed entries");

  const blanks = parseJournalText("\n\n   \n\t\n");
  assert.deepEqual(blanks.records, [], "a file of blank lines yields zero records");
  assert.deepEqual(blanks.malformed, [], "a file of blank lines yields zero malformed entries");

  for (const weird of ["not json at all", "{", "[]", "null", "3", '{"a":1}']) {
    assert.doesNotThrow(
      () => parseJournalText(weird),
      `parseJournalText must never throw; it threw on ${JSON.stringify(weird)}`,
    );
  }
});

// ===========================================================================
// [15.0-parse-torn-line-reported]
// ===========================================================================

test("[15.0-parse-torn-line-reported] a torn line (the shape adapter/journal.ts:129-139 heals) is reported in malformed[] with its 1-based line, raw text and parse reason, while the complete records survive", () => {
  // Exactly the fingerprint journal.ts leaves after a crash mid-append: a
  // truncated fragment on its own line, complete records either side.
  const TORN = '{"seq":999,"ts":1,"level":"in';
  const a = rec({ seq: 21, component: "fsm", event: "transition" });
  const b = rec({ seq: 22, component: "fsm", event: "refusal", level: "warn" });
  const text = [JSON.stringify(a), TORN, JSON.stringify(b), ""].join("\n");

  const out = parseJournalText(text);

  assert.deepEqual(
    out.records.map((r) => r.seq),
    [21, 22],
    "every complete record on the other lines is still returned",
  );
  assert.equal(out.malformed.length, 1, "the torn fragment is reported, never silently dropped (§7.4)");
  assert.equal(out.malformed[0].line, 2, "the malformed entry carries its 1-BASED line number within the source");
  assert.equal(out.malformed[0].raw, TORN, "the raw torn text is preserved verbatim for a human to read");
  assert.match(
    out.malformed[0].reason,
    /json/i,
    `the reason must name the JSON parse failure; got ${out.malformed[0].reason}`,
  );

  const text2 = section(render(out.records, {}, out.malformed), SEC_MALFORMED);
  assert.ok(text2.includes("2"), "the render surfaces the torn line's line number");
  assert.ok(text2.includes(TORN), "the render surfaces the torn line's raw text rather than hiding it");
});

// ===========================================================================
// [15.0-parse-schema-nonconforming]
// ===========================================================================

test("[15.0-parse-schema-nonconforming] a JSON line that is not a valid journal record is classified by REUSING core validate('JournalRecord', …), and its reason carries the validator's own errors", () => {
  // Mutation-proof pair: one line fails on a missing required key, the other on
  // the level enum. Neither can be caught by the same hand-rolled check.
  const missingEvent = { seq: 31, ts: T0, level: "info", component: "fanout", runId: RUN_ID, data: {} };
  const badLevel = {
    seq: 32,
    ts: T0,
    level: "verbose",
    component: "fanout",
    runId: RUN_ID,
    event: "subsession.dispatched",
    data: {},
  };
  const good = rec({ seq: 33, component: "fsm", event: "transition" });
  const text = [JSON.stringify(missingEvent), JSON.stringify(badLevel), JSON.stringify(good), ""].join("\n");

  const expectMissing = validate("JournalRecord", missingEvent);
  const expectBad = validate("JournalRecord", badLevel);
  assert.equal(expectMissing.ok, false, "precondition: core rejects a record with no `event`");
  assert.equal(expectBad.ok, false, "precondition: core rejects a level outside the enum");

  const out = parseJournalText(text);
  assert.deepEqual(out.records.map((r) => r.seq), [33], "only the conforming line becomes a record");
  assert.equal(out.malformed.length, 2, "both non-conforming lines are reported");
  assert.deepEqual(out.malformed.map((m) => m.line), [1, 2], "1-based line numbers, in file order");
  assert.equal(out.malformed[0].raw, JSON.stringify(missingEvent), "the raw line is preserved verbatim");

  for (const e of expectMissing.errors) {
    assert.ok(
      out.malformed[0].reason.includes(e),
      `the missing-key reason must carry the validator's own error ${JSON.stringify(e)}; got ${out.malformed[0].reason}`,
    );
  }
  for (const e of expectBad.errors) {
    assert.ok(
      out.malformed[1].reason.includes(e),
      `the enum reason must carry the validator's own error ${JSON.stringify(e)}; got ${out.malformed[1].reason}`,
    );
  }
});

// ===========================================================================
// [15.0-read-rotated-archives]
// ===========================================================================

test("[15.0-read-rotated-archives] readRunJournal inflates every journal.N.jsonl.gz in ASCENDING NUMERIC N and reads the active journal.jsonl last", () => {
  const dir = freshDir();
  const a1 = [
    rec({ seq: 1, component: "state", event: "run.created" }),
    rec({ seq: 2, component: "fsm", event: "transition" }),
  ];
  const a2 = [rec({ seq: 3, component: "gates", event: "allow" })];
  // Index 10 is the mutation trap: lexicographically "10" sorts before "2".
  const a10 = [rec({ seq: 4, component: "evidence", event: "green" })];
  const live = [
    rec({ seq: 5, component: "fanout", event: "subsession.dispatched", itemId: "I1", sessionID: "ses_live" }),
  ];

  // Written out of order so the read order cannot come from the write order.
  writeFileSync(path.join(dir, "journal.10.jsonl.gz"), gzipSync(Buffer.from(jsonl(a10), "utf8")));
  writeFileSync(path.join(dir, "journal.2.jsonl.gz"), gzipSync(Buffer.from(jsonl(a2), "utf8")));
  writeFileSync(path.join(dir, "journal.1.jsonl.gz"), gzipSync(Buffer.from(jsonl(a1), "utf8")));
  writeFileSync(path.join(dir, "journal.jsonl"), jsonl(live));

  const out = readRunJournal(dir);

  assert.deepEqual(
    out.records.map((r) => r.seq),
    [1, 2, 3, 4, 5],
    "archives first in ascending numeric index, then the active journal — journal.10 comes AFTER journal.2",
  );
  assert.deepEqual(out.malformed, [], "a well-formed archive yields no malformed lines");
  assert.deepEqual(
    out.sources.map((s) => path.basename(s.file)),
    ["journal.1.jsonl.gz", "journal.2.jsonl.gz", "journal.10.jsonl.gz", "journal.jsonl"],
    "the sources list names the files in the order they were read",
  );
  for (const s of out.sources) {
    assert.equal(s.ok, true, `${s.file} is a readable source`);
  }
});

// ===========================================================================
// [15.0-unreadable-archive-degrades]
// ===========================================================================

test("[15.0-unreadable-archive-degrades] an archive that is not valid gzip is reported as a FAILED source, every other source still renders, and the tool exits 0", () => {
  const dir = freshDir();
  writeFileSync(path.join(dir, "journal.1.jsonl.gz"), Buffer.from("this is not gzip at all", "utf8"));
  const live = [
    rec({
      seq: 7,
      level: "warn",
      component: "gates",
      event: "deny",
      data: { toolName: "bash", args: {}, reason: "SURVIVOR-RECORD" },
    }),
  ];
  writeFileSync(path.join(dir, "journal.jsonl"), jsonl(live));

  const out = readRunJournal(dir);

  const failed = out.sources.filter((s) => path.basename(s.file) === "journal.1.jsonl.gz");
  assert.equal(failed.length, 1, "the unreadable archive is still NAMED as a source — a silent omission would make the timeline lie");
  assert.equal(failed[0].ok, false, "an archive that cannot be inflated is reported ok:false");
  assert.equal(typeof failed[0].error, "string", "the failed source carries the error");
  assert.ok((failed[0].error ?? "").length > 0, "the failed source's error is not empty");

  assert.deepEqual(out.records.map((r) => r.seq), [7], "the readable source's records still come through");

  const text = renderTimeline({ records: out.records, malformed: out.malformed, filters: {}, sources: out.sources });
  assert.ok(
    section(text, SEC_SOURCES).includes("journal.1.jsonl.gz"),
    "the render header names the archive it could not read",
  );

  const cli = runCli([dir]);
  assert.equal(cli.status, 0, "a partially readable history is still worth reading — exit 0");
  assert.ok(cli.stdout.includes("SURVIVOR-RECORD"), "the surviving records are rendered to stdout");
});

// ===========================================================================
// [15.0-order-file-not-seq]
// ===========================================================================

test("[15.0-order-file-not-seq] ordering is SOURCE order, never a sort by seq: an archive ending at seq 900 renders before an active journal that restarted at seq 1, and duplicate seqs are printed verbatim", () => {
  const dir = freshDir();
  // The real post-rotation state: journal.ts:219 truncates journal.jsonl, so
  // journal.ts:101-121 readLastSeq returns 0 and the next process restarts at 1.
  const archived = [
    rec({ seq: 1, component: "state", event: "run.created", data: { marker: "ARCHIVED-FIRST" } }),
    rec({ seq: 900, component: "fsm", event: "transition", data: { marker: "ARCHIVED-LAST" } }),
  ];
  const live = [
    rec({ seq: 1, component: "state", event: "run.created", data: { marker: "LIVE-FIRST" } }),
    rec({ seq: 2, component: "fsm", event: "transition", data: { marker: "LIVE-LAST" } }),
  ];
  writeFileSync(path.join(dir, "journal.1.jsonl.gz"), gzipSync(Buffer.from(jsonl(archived), "utf8")));
  writeFileSync(path.join(dir, "journal.jsonl"), jsonl(live));

  const out = readRunJournal(dir);
  assert.deepEqual(
    out.records.map((r) => r.seq),
    [1, 900, 1, 2],
    "source order: the archive's lines, then the restarted active journal's — never sorted by seq or ts",
  );

  const text = renderTimeline({ records: out.records, malformed: out.malformed, filters: {}, sources: out.sources });
  const iArchivedLast = text.indexOf("ARCHIVED-LAST");
  const iLiveFirst = text.indexOf("LIVE-FIRST");
  assert.ok(iArchivedLast >= 0, "the archived seq-900 record is rendered");
  assert.ok(iLiveFirst >= 0, "the restarted seq-1 record is rendered");
  assert.ok(
    iArchivedLast < iLiveFirst,
    "the archived seq-900 record must render BEFORE the restarted seq-1 record",
  );

  assert.ok(text.includes("#900"), "the recorded seq is printed verbatim as the token #<seq>");
  const ones = text.match(/(^|\s)#1(?=\s|$)/gm);
  assert.equal(
    ones === null ? 0 : ones.length,
    2,
    "seq 1 occurs twice across the rotation and is printed both times — replay never de-duplicates a seq",
  );
});

// ===========================================================================
// [15.0-swimlane-grouping]
// ===========================================================================

test("[15.0-swimlane-grouping] deriveSwimlanes yields the run lane first, then one lane per itemId in FIRST-APPEARANCE order, preserving input order inside each lane", () => {
  const records = [
    rec({ seq: 1, component: "state", event: "run.created" }),
    rec({ seq: 2, component: "fsm", event: "transition", itemId: "I2" }),
    rec({ seq: 3, component: "fsm", event: "transition", itemId: "I1" }),
    rec({ seq: 4, component: "gates", event: "allow" }),
    rec({ seq: 5, level: "warn", component: "fsm", event: "guard-reject", itemId: "I2" }),
    rec({ seq: 6, component: "fsm", event: "transition", itemId: "I3" }),
    rec({ seq: 7, level: "warn", component: "fsm", event: "refusal", itemId: "I1" }),
  ];

  const lanes: Lane[] = deriveSwimlanes(records);

  assert.equal(lanes.length, 4, "one run lane plus one lane per distinct itemId");
  assert.equal(lanes[0].itemId, null, "the run-level lane comes first and is keyed null");
  assert.deepEqual(
    lanes.slice(1).map((l) => l.itemId),
    ["I2", "I1", "I3"],
    "item lanes follow in FIRST-APPEARANCE order — not sorted, not insertion-by-name",
  );
  assert.deepEqual(lanes[0].rows.map((r) => r.seq), [1, 4], "the run lane holds every record with no itemId, in input order");
  assert.deepEqual(lanes[1].rows.map((r) => r.seq), [2, 5], "I2's records keep their input order");
  assert.deepEqual(lanes[2].rows.map((r) => r.seq), [3, 7], "I1's records keep their input order");
  assert.deepEqual(lanes[3].rows.map((r) => r.seq), [6], "I3's single record");
});

// ===========================================================================
// [15.0-swimlane-conservation]
// ===========================================================================

test("[15.0-swimlane-conservation] every record appears EXACTLY ONCE across the lanes, and an empty-string itemId is run-level rather than a lane named ''", () => {
  // adapter/tools.ts:1814-1823 dispatches the plan-review lens jobs with
  // itemId: "", so these records really occur.
  const records = [
    rec({
      seq: 1,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "",
      sessionID: "ses_lens1",
      data: { role: "reviewer", itemId: "", tree: "", model: "qwen3.6-27b" },
    }),
    rec({ seq: 2, component: "fsm", event: "transition", itemId: "I1" }),
    rec({
      seq: 3,
      level: "warn",
      component: "gates",
      event: "deny",
      data: { toolName: "bash", args: {}, reason: "run-level refusal" },
    }),
    rec({
      seq: 4,
      component: "fanout",
      event: "subsession.complete",
      itemId: "",
      sessionID: "ses_lens1",
      data: { ok: true, attempts: 1 },
    }),
    rec({ seq: 5, component: "fsm", event: "transition", itemId: "I1" }),
  ];

  const lanes = deriveSwimlanes(records);
  const flat = lanes.flatMap((l) => l.rows);

  assert.equal(
    flat.length,
    records.length,
    "the summed lane lengths equal the input length — no record dropped, none duplicated",
  );
  const key = (r: JournalRecord): string => `${r.seq}|${r.component}|${r.event}`;
  assert.deepEqual(
    flat.map(key).sort(),
    records.map(key).sort(),
    "the multiset of (seq, component, event) across the lanes is identical to the input",
  );
  assert.deepEqual(
    lanes.map((l) => l.itemId),
    [null, "I1"],
    "an empty-string itemId belongs to the RUN lane; there is no lane named ''",
  );
  assert.deepEqual(lanes[0].rows.map((r) => r.seq), [1, 3, 4], "the empty-itemId records sit in the run lane");
});

// ===========================================================================
// [15.0-gate-denial-highlight]
// ===========================================================================

test("[15.0-gate-denial-highlight] a gates/deny row carries the DENY marker in its lane and a denials entry with toolName/reason/command/editPath, and a gates/gate-crash row carries the distinct CRASH marker", () => {
  // adapter/tools.ts:241-250 denySnapshot; :273-279 the gate-crash anomaly.
  const denyRec = rec({
    seq: 41,
    level: "warn",
    component: "gates",
    event: "deny",
    data: {
      toolName: "bash",
      args: { command: "git push --force" },
      reason: "force-push is refused by the git gate",
      command: "git push --force",
      editPath: "conductor/core/types.ts",
    },
  });
  const crashRec = rec({
    seq: 42,
    level: "error",
    component: "gates",
    event: "gate-crash",
    data: { toolName: "edit", guarded: true, error: "TypeError: cannot read property of undefined" },
  });

  const both = render([denyRec, crashRec]);
  const swim = section(both, SEC_SWIMLANES);
  assert.ok(lineWith(swim, "#41").includes(MARK_DENY), "the deny record's swimlane row is marked DENY");
  assert.ok(lineWith(swim, "#42").includes(MARK_CRASH), "the gate-crash record's swimlane row is marked CRASH");

  const denials = section(both, SEC_DENIALS);
  assert.ok(denials.includes(MARK_DENY), "the deny is listed in the denials section under the DENY marker");
  assert.ok(denials.includes("bash"), "the denials entry shows the toolName");
  assert.ok(denials.includes("force-push is refused by the git gate"), "the denials entry shows the reason");
  assert.ok(denials.includes("git push --force"), "the denials entry shows the repro command when present");
  assert.ok(denials.includes("conductor/core/types.ts"), "the denials entry shows the editPath when present");
  assert.ok(denials.includes(MARK_CRASH), "the gate crash is listed in the SAME section under its own marker");
  assert.ok(
    denials.includes("TypeError: cannot read property of undefined"),
    "the crash entry shows the error a reader must not miss (§2.8 fail-closed)",
  );

  // The two markers are independent: neither fixture leaks the other's marker.
  const denyOnly = render([denyRec]);
  assert.ok(denyOnly.includes(MARK_DENY), "a deny-only render carries DENY");
  assert.equal(denyOnly.includes(MARK_CRASH), false, "a deny-only render must NOT claim a gate crash");

  const crashOnly = render([crashRec]);
  assert.ok(crashOnly.includes(MARK_CRASH), "a crash-only render carries CRASH");
  assert.equal(crashOnly.includes(MARK_DENY), false, "a crash-only render must NOT claim a deny decision — the gate never got to decide");
});

// ===========================================================================
// [15.0-no-ansi-escapes]
// ===========================================================================

test("[15.0-no-ansi-escapes] no render contains an ANSI escape (0x1B) anywhere, including the highlighted denials — highlighting is plain ASCII", () => {
  const denyRec = rec({
    seq: 51,
    level: "warn",
    component: "gates",
    event: "deny",
    data: { toolName: "bash", args: {}, reason: "highlighted" },
  });
  const crashRec = rec({
    seq: 52,
    level: "error",
    component: "gates",
    event: "gate-crash",
    data: { guarded: true, error: "boom" },
  });
  const fanoutRecs = [
    rec({
      seq: 53,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_ansi",
      data: { role: "reviewer", itemId: "I1", tree: "main", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 54,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I1",
      sessionID: "ses_ansi",
      data: { ok: true, attempts: 1 },
    }),
  ];

  const fixtures = [
    render([denyRec, crashRec]),
    render(fanoutRecs),
    render([]),
    render([denyRec, ...fanoutRecs], { components: ["gates"] }),
    render([denyRec], {}, [{ line: 3, raw: '{"seq":1,"ts":', reason: "JSON parse error" }]),
  ];
  for (const [index, text] of fixtures.entries()) {
    assert.equal(
      text.includes(ESC),
      false,
      `render #${index} must carry no ESC byte — a render piped into a file, a diff or a bug report stays byte-clean (G1: no color dependency)`,
    );
  }
});

// ===========================================================================
// [15.0-fanout-duration-pairing]
// ===========================================================================

test("[15.0-fanout-duration-pairing] deriveFanoutRows pairs each dispatch with the NEXT terminal record for the SAME sessionID, computing durationMs from the journal's ts delta, the attempts from the retries between, and the outcome from the terminal payload", () => {
  // Two sub-sessions interleaved, so positional pairing cannot pass by accident.
  const records = [
    rec({
      seq: 1,
      ts: T0 + 0,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_a",
      data: { role: "implementer", itemId: "I1", tree: "wt-a", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 2,
      ts: T0 + 10,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I2",
      sessionID: "ses_b",
      data: { role: "reviewer", itemId: "I2", tree: "wt-b", model: "qwen3.6-8b" },
    }),
    rec({
      seq: 3,
      ts: T0 + 100,
      component: "fanout",
      event: "subsession.retry",
      itemId: "I1",
      sessionID: "ses_a",
      data: { attempt: 1, errors: ["Findings.findings: missing required property"] },
    }),
    rec({
      seq: 4,
      ts: T0 + 150,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I2",
      sessionID: "ses_b",
      data: { ok: true, attempts: 1 },
    }),
    rec({
      seq: 5,
      ts: T0 + 200,
      component: "fanout",
      event: "subsession.retry",
      itemId: "I1",
      sessionID: "ses_a",
      data: { attempt: 2, errors: ["Findings.findings: missing required property"] },
    }),
    rec({
      seq: 6,
      ts: T0 + 500,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I1",
      sessionID: "ses_a",
      data: { ok: true, attempts: 3 },
    }),
  ];

  const rows = deriveFanoutRows(records);
  assert.equal(rows.length, 2, "one row per dispatched sub-session");

  const a = rowFor(rows, "ses_a");
  assert.equal(a.role, "implementer", "role comes from the dispatched payload (fanout.ts:292-298)");
  assert.equal(a.itemId, "I1", "itemId comes from the dispatched payload");
  assert.equal(a.tree, "wt-a", "tree comes from the dispatched payload");
  assert.equal(a.model, "qwen3.6-27b", "model comes from the dispatched payload");
  assert.equal(
    a.durationMs,
    500,
    "durationMs is terminal.ts minus dispatched.ts — FanoutResult.timings is returned to the caller and never journaled",
  );
  assert.equal(a.attempts, 3, "attempts = 1 + the two subsession.retry records between dispatch and terminal");
  assert.equal(a.outcome, "ok", "a terminal complete with ok:true is the ok outcome");

  const b = rowFor(rows, "ses_b");
  assert.equal(b.durationMs, 140, "ses_b pairs with ITS OWN terminal record, not the next one in the file");
  assert.equal(b.attempts, 1, "no retries between ses_b's dispatch and completion");
  assert.equal(b.outcome, "ok");
  assert.equal(b.role, "reviewer");

  // The three failure outcomes the committed producer writes.
  const failureCases: { sessionID: string; event: string; data: Record<string, unknown>; outcome: string }[] = [
    {
      sessionID: "ses_schema",
      event: "subsession.complete",
      data: { ok: false, reason: "schema-invalid", errors: ["Findings: bad"] },
      outcome: "schema-invalid",
    },
    {
      sessionID: "ses_engine",
      event: "subsession.complete",
      data: { ok: false, reason: "engine-error", detail: "socket hang up" },
      outcome: "engine-error",
    },
    {
      sessionID: "ses_watchdog",
      event: "subsession.abort",
      data: { reason: "watchdog-timeout", timeoutMs: 900000 },
      outcome: "watchdog-timeout",
    },
  ];
  for (const c of failureCases) {
    const fixture = [
      rec({
        ts: T0,
        component: "fanout",
        event: "subsession.dispatched",
        itemId: "I9",
        sessionID: c.sessionID,
        data: { role: "reviewer", itemId: "I9", tree: "main", model: "qwen3.6-27b" },
      }),
      rec({
        ts: T0 + 42,
        level: c.event === "subsession.abort" ? "warn" : "info",
        component: "fanout",
        event: c.event,
        itemId: "I9",
        sessionID: c.sessionID,
        data: c.data,
      }),
    ];
    const row = rowFor(deriveFanoutRows(fixture), c.sessionID);
    assert.equal(row.outcome, c.outcome, `the outcome is taken from the terminal record's data (${c.outcome})`);
    assert.equal(row.durationMs, 42, `${c.outcome}: the duration is still the journalled ts delta`);
  }
});

// ===========================================================================
// [15.0-fanout-empty-sessionid-never-merged]
// ===========================================================================

test("[15.0-fanout-empty-sessionid-never-merged] records whose sessionID is ABSENT or the EMPTY STRING never merge into one synthetic session, and never pair with an unrelated dispatch", () => {
  // fanout.ts:203 `let sessionID = ""` + :207 corr() means a record emitted
  // before session.create returns carries sessionID "" — present, schema-valid,
  // and not a session id. fanout.ts:272-278 carries no sessionID at all.
  const records = [
    rec({
      seq: 1,
      ts: T0,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_real",
      data: { role: "implementer", itemId: "I1", tree: "wt-a", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 2,
      ts: T0 + 70,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I1",
      sessionID: "ses_real",
      data: { ok: true, attempts: 1 },
    }),
    rec({
      seq: 3,
      ts: T0 + 80,
      level: "warn",
      component: "fanout",
      event: "subsession.abort",
      itemId: "I2",
      sessionID: "",
      data: { reason: "watchdog-timeout", timeoutMs: 900000 },
    }),
    rec({
      seq: 4,
      ts: T0 + 90,
      level: "warn",
      component: "fanout",
      event: "subsession.abort",
      itemId: "I3",
      sessionID: "",
      data: { reason: "watchdog-timeout", timeoutMs: 900000 },
    }),
    rec({
      seq: 5,
      ts: T0 + 95,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I4",
      data: { ok: false, reason: "session-create-failed", role: "implementer", itemId: "I4" },
    }),
  ];

  const rows = deriveFanoutRows(records);
  assert.equal(rows.length, 4, "one real sub-session plus THREE separate unpaired rows — never one merged row");

  const real = rowFor(rows, "ses_real");
  assert.equal(real.durationMs, 70, "the real session still pairs and still has a duration");

  const orphans = rows.filter((r) => r.sessionID === null);
  assert.equal(orphans.length, 3, "an absent sessionID and an empty-string sessionID are both 'no session'");
  assert.deepEqual(
    orphans.map((r) => r.itemId),
    ["I2", "I3", "I4"],
    "each unpaired record keeps its own item — the two empty-string aborts are not collapsed together",
  );
  for (const o of orphans) {
    assert.equal(o.durationMs, null, "an unpaired record gets NO fabricated duration");
  }
  assert.deepEqual(
    orphans.map((r) => r.outcome),
    ["watchdog-timeout", "watchdog-timeout", "session-create-failed"],
    "each unpaired record reports its own terminal reason",
  );

  const fan = section(render(records), SEC_FANOUT);
  const noSession = fan.split("\n").filter((l) => l.includes(MARK_NO_SESSION));
  assert.equal(noSession.length, 3, "each session-less row is marked NO-SESSION in the render");
});

// ===========================================================================
// [15.0-fanout-unterminated-marked]
// ===========================================================================

test("[15.0-fanout-unterminated-marked] a dispatch with no terminal record renders UNTERMINATED with NO duration value, and a subsession.hold is counted as a hold rather than dropped or mistaken for a dispatch", () => {
  const records = [
    rec({
      seq: 1,
      ts: T0,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_dead",
      data: { role: "implementer", itemId: "I1", tree: "wt-a", model: "qwen3.6-27b" },
    }),
    // fanout.ts:368-373: a held write-capable job, corr without a sessionID.
    rec({
      seq: 2,
      ts: T0 + 5,
      component: "fanout",
      event: "subsession.hold",
      itemId: "I5",
      data: { role: "implementer", itemId: "I5", tree: "wt-e" },
    }),
    rec({
      seq: 3,
      ts: T0 + 10,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I6",
      sessionID: "ses_live",
      data: { role: "reviewer", itemId: "I6", tree: "main", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 4,
      ts: T0 + 30,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I6",
      sessionID: "ses_live",
      data: { ok: true, attempts: 1 },
    }),
  ];

  const rows = deriveFanoutRows(records);
  assert.equal(rows.length, 3, "the dead dispatch, the hold and the completed dispatch each get a row");

  const dead = rowFor(rows, "ses_dead");
  assert.equal(
    dead.durationMs,
    null,
    "an unterminated dispatch has NO duration — not 0, and never a now()-minus-start figure",
  );
  assert.notEqual(dead.durationMs, 0, "a run that died mid-wave must not look like one that completed instantly");
  assert.equal(dead.outcome, "unterminated");

  const holds = rows.filter((r) => r.outcome === "hold");
  assert.equal(holds.length, 1, "the hold record is retained as its own row");
  assert.equal(holds[0].itemId, "I5", "the hold is counted against its item");
  assert.equal(holds[0].sessionID, null, "a hold carries no sessionID (fanout.ts:368-373)");
  assert.equal(holds[0].durationMs, null, "a hold is not a dispatch and has no duration");

  assert.equal(
    rows.filter((r) => r.outcome === "unterminated").length,
    1,
    "the hold is NOT mistaken for an unterminated dispatch",
  );
  assert.equal(rowFor(rows, "ses_live").durationMs, 20, "the completed dispatch is unaffected");

  const fan = section(render(records), SEC_FANOUT);
  assert.ok(lineWith(fan, "ses_dead").includes(MARK_UNTERMINATED), "the unterminated row is explicitly marked");
  assert.equal(
    lineWith(fan, "ses_live").includes(MARK_UNTERMINATED),
    false,
    "a completed sub-session is never marked unterminated",
  );
});

// ===========================================================================
// [15.0-review-round-table]
// ===========================================================================

test("[15.0-review-round-table] deriveReviewRounds produces one row per round from the records committed producers emit, reading BOTH key spellings, keyed by subject = itemId ?? 'plan', with the reviewer/skeptic counts from that round's window", () => {
  const reviewerJob = (itemId: string): Record<string, unknown> => ({
    role: "reviewer",
    itemId,
    tree: "",
    model: "qwen3.6-27b",
  });
  const records = [
    rec({ seq: 1, component: "fanout", event: "subsession.dispatched", itemId: "", sessionID: "ses_r1a", data: reviewerJob("") }),
    rec({ seq: 2, component: "fanout", event: "subsession.dispatched", itemId: "", sessionID: "ses_r1b", data: reviewerJob("") }),
    rec({
      seq: 3,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "",
      sessionID: "ses_s1",
      data: { role: "skeptic", itemId: "", tree: "", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 4,
      component: "fanout",
      event: "subsession.complete",
      itemId: "",
      sessionID: "ses_r1a",
      data: { ok: true, attempts: 1 },
    }),
    // adapter/tools.ts:2021-2034 — the round that DID NOT pass.
    rec({
      seq: 5,
      level: "warn",
      component: "fsm",
      event: "guard-reject",
      data: {
        stage: "plan-review",
        round: 1,
        max: 3,
        findings: 5,
        survivingMajors: 2,
        why: "a surviving major below the round cap",
      },
    }),
    rec({ seq: 6, component: "fanout", event: "subsession.dispatched", itemId: "", sessionID: "ses_r2a", data: reviewerJob("") }),
    rec({ seq: 7, component: "fanout", event: "subsession.dispatched", itemId: "", sessionID: "ses_r2b", data: reviewerJob("") }),
    // adapter/tools.ts:2160-2175 — the transition that CLOSES the sequence.
    rec({
      seq: 8,
      component: "fsm",
      event: "transition",
      data: {
        to: "PLAN_REVIEWED",
        rounds: 2,
        lenses: ["correctness", "contract"],
        findingsRaised: { major: 0, minor: 1, nit: 2 },
        survivingMajors: 0,
        questions: 0,
        blockedItems: 0,
        tsMs: T0,
      },
    }),
  ];

  const rounds: ReviewRoundRow[] = deriveReviewRounds(records);
  assert.equal(rounds.length, 2, "one row per review round");

  assert.equal(rounds[0].subject, "plan", "a record with no itemId is the plan subject");
  assert.equal(rounds[0].round, 1, "round 1 reads data.round from the guard-reject spelling");
  assert.equal(rounds[0].max, 3);
  assert.equal(rounds[0].findings, 5, "findings reads the guard-reject's data.findings");
  assert.equal(rounds[0].survivingMajors, 2);
  assert.equal(rounds[0].outcome, "re-round", "a guard-reject is a round that did not pass");
  assert.equal(rounds[0].why, "a surviving major below the round cap");
  assert.equal(rounds[0].reviewers, 2, "two reviewer dispatches inside round 1's window");
  assert.equal(rounds[0].skeptics, 1, "one skeptic dispatch inside round 1's window");

  assert.equal(rounds[1].subject, "plan");
  assert.equal(rounds[1].round, 2, "round 2 reads data.rounds — the OTHER key spelling — from the transition");
  assert.equal(rounds[1].survivingMajors, 0);
  assert.deepEqual(
    rounds[1].findingsRaised,
    { major: 0, minor: 1, nit: 2 },
    "the accepted round shows the transition's findingsRaised breakdown",
  );
  assert.deepEqual(rounds[1].lenses, ["correctness", "contract"], "the lens roster comes from the transition record");
  assert.equal(rounds[1].outcome, "accepted", "the transition closes the sequence");
  assert.equal(rounds[1].reviewers, 2, "only the dispatches after round 1 closed count toward round 2");
  assert.equal(rounds[1].skeptics, 0);

  // Field-shaped, not pinned to conductor_plan_review: an item-scoped round with
  // a different stage falls into the same table under its own subject, while an
  // ordinary transition carrying no survivingMajors is NOT a review round.
  const itemScoped = [
    rec({ seq: 20, component: "fsm", event: "transition", itemId: "I2", data: { to: "EXECUTING" } }),
    rec({
      seq: 21,
      level: "warn",
      component: "fsm",
      event: "guard-reject",
      itemId: "I2",
      data: { stage: "item-review", round: 1, max: 3, findings: 2, survivingMajors: 1, why: "one major survives" },
    }),
  ];
  const itemRounds = deriveReviewRounds(itemScoped);
  assert.equal(itemRounds.length, 1, "a transition with no survivingMajors is not a review round");
  assert.equal(itemRounds[0].subject, "I2", "subject = record.itemId when the record carries one");
  assert.equal(itemRounds[0].survivingMajors, 1);
});

// ===========================================================================
// [15.0-guard-reject-needs-surviving-majors]
// ===========================================================================

test("[15.0-guard-reject-needs-surviving-majors] a plan-review-revision guard-reject has data.stage but NO data.survivingMajors and is therefore NOT a review round: one round 1 that took two planner attempts yields exactly ONE row, the one carrying the real surviving majors", () => {
  // TWO committed producers emit component 'fsm' / event 'guard-reject':
  //
  //   adapter/tools.ts:1939-1945 — {stage:'plan-review-revision', round, attempt,
  //     defects}, journaled once per FAILED planner-revision attempt. PLANNER_ATTEMPTS
  //     is 2 (:1083) and the log call at :1939 sits OUTSIDE the :1946 re-prompt guard,
  //     so a revision that exhausts its attempts journals BOTH. This record carries
  //     data.stage and NO survivingMajors.
  //
  //   adapter/tools.ts:2021-2034 — {stage:'plan-review', round, max, findings,
  //     survivingMajors, why}, the round that did not pass.
  //
  // SG-3 as literally written ("guard-reject with data.stage present" is a round)
  // counts all three, yielding three rows all claiming round 1, two of them
  // reporting survivingMajors 0 for a round where two majors demonstrably survived.
  // The orchestrator's binding ruling: a guard-reject is a round only with
  // data.stage AND data.survivingMajors !== undefined.
  const reviewerJob: Record<string, unknown> = {
    role: "reviewer",
    itemId: "",
    tree: "",
    model: "qwen3.6-27b",
  };
  const dispatches = [
    rec({ seq: 1, component: "fanout", event: "subsession.dispatched", itemId: "", sessionID: "ses_g1", data: reviewerJob }),
    rec({ seq: 2, component: "fanout", event: "subsession.dispatched", itemId: "", sessionID: "ses_g2", data: reviewerJob }),
  ];
  const revisionAttempt1 = rec({
    seq: 3,
    level: "warn",
    component: "fsm",
    event: "guard-reject",
    data: { stage: "plan-review-revision", round: 1, attempt: 1, defects: ["item I2 has no acceptance criteria"] },
  });
  const revisionAttempt2 = rec({
    seq: 4,
    level: "warn",
    component: "fsm",
    event: "guard-reject",
    data: {
      stage: "plan-review-revision",
      round: 1,
      attempt: 2,
      defects: ["item I2 still has no acceptance criteria"],
    },
  });
  const realReject = rec({
    seq: 5,
    level: "warn",
    component: "fsm",
    event: "guard-reject",
    data: {
      stage: "plan-review",
      round: 1,
      max: 3,
      findings: 5,
      survivingMajors: 2,
      why: "a surviving major below the round cap",
    },
  });

  const rounds = deriveReviewRounds([...dispatches, revisionAttempt1, revisionAttempt2, realReject]);

  assert.equal(
    rounds.length,
    1,
    "round 1 is ONE round however many planner attempts it took — a revision reject is not a round",
  );
  assert.equal(
    rounds[0].survivingMajors,
    2,
    "the surviving row is the one carrying the REAL surviving majors; keeping a revision reject instead would claim 0 survivors for a round where two majors survived",
  );
  assert.equal(rounds[0].findings, 5, "the surviving row carries the real reject's findings count");
  assert.equal(rounds[0].max, 3, "the surviving row carries the real reject's round cap");
  assert.equal(
    rounds[0].why,
    "a surviving major below the round cap",
    "the surviving row carries the real reject's why, not a revision's defect list",
  );
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].subject, "plan");
  assert.equal(rounds[0].outcome, "re-round");
  assert.equal(
    rounds[0].reviewers,
    2,
    "a revision reject is not a round boundary, so it does not close the round's reviewer window early",
  );
  assert.equal(rounds[0].skeptics, 0);

  // The rule is about the record's own fields, never its position: the committed
  // producers can emit these in either order across a re-round, and both orders
  // must still describe one round.
  const reversed = deriveReviewRounds([...dispatches, realReject, revisionAttempt1, revisionAttempt2]);
  assert.equal(reversed.length, 1, "the rule reads the record's fields, not its position in the file");
  assert.equal(reversed[0].survivingMajors, 2, "the real reject is still the row that survives");

  // A revision reject on its OWN is not a round either — otherwise a run that
  // died inside the planner loop would report a phantom round with zero survivors.
  assert.deepEqual(
    deriveReviewRounds([revisionAttempt1, revisionAttempt2]),
    [],
    "planner-revision rejects alone describe no review round at all",
  );
});

// ===========================================================================
// [15.0-review-lens-tolerant]
// ===========================================================================

test("[15.0-review-lens-tolerant] the lens is data.lens when the dispatch carries one, else the round's data.lenses roster, else the UNKNOWN-LENS marker — never invented — and an unknown-lens dispatch still counts toward its round's reviewer total", () => {
  const records = [
    rec({
      seq: 1,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "",
      sessionID: "ses_lensed",
      data: { role: "reviewer", itemId: "", tree: "", model: "qwen3.6-27b", lens: "correctness" },
    }),
    // The committed producer (fanout.ts:292-298) omits job.lens even though
    // FanoutJob:67 carries it — see SG-4. This is the real shape today.
    rec({
      seq: 2,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "",
      sessionID: "ses_bare1",
      data: { role: "reviewer", itemId: "", tree: "", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 3,
      level: "warn",
      component: "fsm",
      event: "guard-reject",
      data: { stage: "plan-review", round: 1, max: 3, findings: 3, survivingMajors: 1, why: "re-round" },
    }),
    rec({
      seq: 4,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "",
      sessionID: "ses_bare2",
      data: { role: "reviewer", itemId: "", tree: "", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 5,
      component: "fsm",
      event: "transition",
      data: {
        to: "PLAN_REVIEWED",
        rounds: 2,
        lenses: ["contract", "perf"],
        findingsRaised: { major: 0, minor: 0, nit: 0 },
        survivingMajors: 0,
      },
    }),
  ];

  const rows = deriveFanoutRows(records);
  assert.equal(rowFor(rows, "ses_lensed").lens, "correctness", "data.lens is read verbatim when the producer wrote one");
  assert.equal(rowFor(rows, "ses_bare1").lens, null, "a dispatch with no data.lens carries no lens of its own");
  assert.equal(rowFor(rows, "ses_bare2").lens, null, "the roster fallback is a RENDER decision, not a fabricated row field");

  const text = render(records);
  const fan = section(text, SEC_FANOUT);
  assert.ok(lineWith(fan, "ses_lensed").includes("correctness"), "the dispatch's own lens is rendered");
  assert.ok(
    lineWith(fan, "ses_bare1").includes(MARK_UNKNOWN_LENS),
    "a dispatch with no lens, in a round with no roster, is marked UNKNOWN-LENS",
  );
  const bare2 = lineWith(fan, "ses_bare2");
  assert.ok(bare2.includes("contract"), "a dispatch with no lens falls back to its round's lenses roster");
  assert.ok(bare2.includes("perf"), "the whole roster is shown, since which lens this session held is unrecorded");

  const rounds = deriveReviewRounds(records);
  assert.equal(rounds[0].reviewers, 2, "the unknown-lens dispatch still counts toward round 1's reviewer total");
  assert.deepEqual(rounds[1].lenses, ["contract", "perf"]);

  // Never invented: with neither a lens nor a roster anywhere, no lens name appears.
  const bareOnly = render([records[1], records[2]]);
  assert.ok(bareOnly.includes(MARK_UNKNOWN_LENS), "with nothing to read, the lens is marked unknown");
  for (const name of ["correctness", "contract", "perf"]) {
    assert.equal(
      bareOnly.includes(name),
      false,
      `no lens name may be invented for a dispatch that recorded none; ${name} leaked into the render`,
    );
  }
});

// ===========================================================================
// [15.0-review-no-fabricated-verdicts]
// ===========================================================================

test("[15.0-review-no-fabricated-verdicts] the review section carries no per-finding uphold/overturn column and never reads runs/<runId>/reviews/*.json — a file nobody writes at HEAD", () => {
  const dir = freshDir();
  const records = [
    rec({
      seq: 1,
      level: "warn",
      component: "fsm",
      event: "guard-reject",
      data: { stage: "plan-review", round: 1, max: 3, findings: 4, survivingMajors: 2, why: "majors survive" },
    }),
    rec({
      seq: 2,
      component: "fsm",
      event: "transition",
      data: {
        to: "PLAN_REVIEWED",
        rounds: 2,
        lenses: ["correctness"],
        findingsRaised: { major: 0, minor: 2, nit: 0 },
        survivingMajors: 0,
      },
    }),
  ];
  writeFileSync(path.join(dir, "journal.jsonl"), jsonl(records));

  const before = readRunJournal(dir);
  const clean = renderTimeline({
    records: before.records,
    malformed: before.malformed,
    filters: {},
    sources: before.sources,
  });

  // §1.2:439 lists reviews/<itemId|plan>-r<N>.json in the layout, but nothing in
  // conductor/{core,adapter,tools} writes it. Plant a file that would crash a
  // reader; replay must not be that reader (G4: no stub for an unwritten artifact).
  mkdirSync(path.join(dir, "reviews"), { recursive: true });
  writeFileSync(path.join(dir, "reviews", "plan-r1.json"), '{"verdict": "SENTINEL-FABRICATED-UPHOLD", ');

  const after = readRunJournal(dir);
  const withReviews = renderTimeline({
    records: after.records,
    malformed: after.malformed,
    filters: {},
    sources: after.sources,
  });

  assert.equal(withReviews, clean, "the reviews/ directory changes the render not at all — replay never opens it");
  assert.equal(
    withReviews.includes("SENTINEL-FABRICATED-UPHOLD"),
    false,
    "nothing from reviews/*.json reaches the render",
  );
  assert.equal(
    after.sources.some((s) => s.file.includes("reviews")),
    false,
    "reviews/*.json is never listed as a journal source",
  );

  const reviewSection = section(withReviews, SEC_REVIEW).toLowerCase();
  assert.equal(reviewSection.includes("uphold"), false, "no fabricated uphold column — the journal records no verdict");
  assert.equal(reviewSection.includes("overturn"), false, "no fabricated overturn column");
  assert.ok(reviewSection.includes("2"), "the round table still reports the rounds the journal DID record");

  const cli = runCli([dir]);
  assert.equal(cli.status, 0, "the crash-shaped reviews file never even gets opened, so the render succeeds");
});

// ===========================================================================
// [15.0-level-threshold]
// ===========================================================================

test("[15.0-level-threshold] --level is a THRESHOLD over the single exported core LOG_LEVELS order, not an exact match, and replay declares no order of its own", () => {
  assert.equal(LOG_LEVELS[0], "error", "precondition: the core §7.1 order is most-severe-first");

  const records = LOG_LEVELS.map((level, i) => rec({ seq: 100 + i, level, component: "fsm", event: "transition" }));

  for (const threshold of LOG_LEVELS) {
    const kept = applyFilters(records, { level: threshold });
    const expected = LOG_LEVELS.filter((l) => LOG_LEVELS.indexOf(l) <= LOG_LEVELS.indexOf(threshold));
    assert.deepEqual(
      kept.map((r) => r.level),
      [...expected],
      `--level ${threshold} keeps exactly the levels at or above it in the imported core order`,
    );
  }

  const warn = applyFilters(records, { level: "warn" }).map((r) => r.level);
  assert.deepEqual(warn, ["error", "warn"], "--level warn keeps error and warn and drops info/debug/trace");
  assert.deepEqual(
    applyFilters(records, { level: "trace" }).map((r) => r.level),
    [...LOG_LEVELS],
    "--level trace keeps everything",
  );
  assert.deepEqual(
    applyFilters(records, {}).map((r) => r.level),
    [...LOG_LEVELS],
    "an absent --level filters nothing",
  );
});

// ===========================================================================
// [15.0-filter-multi-value-and-composition]
// ===========================================================================

test("[15.0-filter-multi-value-and-composition] --component and --item accept repetition AND comma-separated values unioned within a flag, the three flags compose as AND, and --item excludes run-level records", () => {
  const runDir = path.join(tmpdir(), "conductor-replay-argparse-only");

  const repeated = okArgs(parseArgs([runDir, "--component", "fanout", "--component", "gates"]), "repeated --component");
  const commas = okArgs(parseArgs([runDir, "--component", "fanout,gates"]), "comma-separated --component");
  assert.equal(repeated.runDir, runDir, "the first non-flag positional is the run dir");
  assert.deepEqual([...(repeated.filters.components ?? [])].sort(), ["fanout", "gates"]);
  assert.deepEqual([...(commas.filters.components ?? [])].sort(), ["fanout", "gates"]);

  const itemsRepeated = okArgs(parseArgs([runDir, "--item", "I1", "--item", "I2"]), "repeated --item");
  const itemsCommas = okArgs(parseArgs([runDir, "--item", "I1,I2"]), "comma-separated --item");
  assert.deepEqual([...(itemsRepeated.filters.items ?? [])].sort(), ["I1", "I2"]);
  assert.deepEqual([...(itemsCommas.filters.items ?? [])].sort(), ["I1", "I2"]);

  const records = [
    rec({
      seq: 1,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I2",
      sessionID: "ses_1",
      data: { role: "implementer", itemId: "I2", tree: "wt-b", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 2,
      level: "debug",
      component: "fanout",
      event: "subsession.retry",
      itemId: "I2",
      sessionID: "ses_1",
      data: { attempt: 1, errors: ["nope"] },
    }),
    rec({
      seq: 3,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_2",
      data: { role: "reviewer", itemId: "I1", tree: "main", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 4,
      level: "warn",
      component: "gates",
      event: "deny",
      data: { toolName: "bash", args: {}, reason: "a RUN-LEVEL refusal with no itemId" },
    }),
    rec({ seq: 5, component: "fsm", event: "transition", itemId: "I2", data: { to: "REVIEWED" } }),
  ];

  assert.deepEqual(
    applyFilters(records, repeated.filters).map((r) => r.seq),
    applyFilters(records, commas.filters).map((r) => r.seq),
    "'--component fanout --component gates' and '--component fanout,gates' select the same records",
  );
  assert.deepEqual(
    applyFilters(records, repeated.filters).map((r) => r.seq),
    [1, 2, 3, 4],
    "the union within a flag keeps both components",
  );

  assert.deepEqual(
    applyFilters(records, { components: ["fanout"], items: ["I2"], level: "info" }).map((r) => r.seq),
    [1],
    "the three flags compose as AND: fanout AND item I2 AND at-or-above info",
  );

  const itemOnly = applyFilters(records, { items: ["I2"] });
  assert.deepEqual(itemOnly.map((r) => r.seq), [1, 2, 5], "--item selects records whose itemId is in the set");
  assert.equal(
    itemOnly.some((r) => r.seq === 4),
    false,
    "--item EXCLUDES run-level records — they belong to the run lane, not to item I2",
  );
});

// ===========================================================================
// [15.0-filters-applied-once]
// ===========================================================================

test("[15.0-filters-applied-once] filters are applied ONCE and every section derives from that one filtered set — an empty section says so instead of being omitted", () => {
  const records = [
    rec({
      seq: 1,
      level: "warn",
      component: "gates",
      event: "deny",
      data: { toolName: "bash", args: {}, reason: "the only gates record" },
    }),
    rec({
      seq: 2,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_i1",
      data: { role: "reviewer", itemId: "I1", tree: "main", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 3,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I1",
      sessionID: "ses_i1",
      data: { ok: true, attempts: 1 },
    }),
    rec({
      seq: 4,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I2",
      sessionID: "ses_i2",
      data: { role: "implementer", itemId: "I2", tree: "wt-b", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 5,
      component: "fanout",
      event: "subsession.complete",
      itemId: "I2",
      sessionID: "ses_i2",
      data: { ok: true, attempts: 1 },
    }),
    rec({
      seq: 6,
      component: "fsm",
      event: "transition",
      data: {
        to: "PLAN_REVIEWED",
        rounds: 1,
        lenses: ["correctness"],
        findingsRaised: { major: 0, minor: 0, nit: 0 },
        survivingMajors: 0,
      },
    }),
  ];

  const gatesOnly = render(records, { components: ["gates"] });
  const fanSection = section(gatesOnly, SEC_FANOUT);
  const reviewSection = section(gatesOnly, SEC_REVIEW);
  assert.ok(
    fanSection.includes(EMPTY_SECTION),
    "with --component gates the fan-out duration table is empty and SAYS SO rather than vanishing",
  );
  assert.ok(reviewSection.includes(EMPTY_SECTION), "with --component gates the review-round table is empty and says so");
  assert.equal(fanSection.includes("ses_"), false, "no sub-session survived the gates filter");
  assert.ok(section(gatesOnly, SEC_DENIALS).includes("the only gates record"), "the gates record itself still renders");

  // Filtering twice is identical to filtering once: the render applies the
  // filters exactly one time and every section reads that same set.
  const prefiltered = renderTimeline({
    records: applyFilters(records, { components: ["gates"] }),
    malformed: [],
    filters: { components: ["gates"] },
    sources: [LIVE_SOURCE],
  });
  assert.equal(
    gatesOnly,
    prefiltered,
    "rendering pre-filtered records with the same filters is byte-identical — the filters are applied exactly once",
  );

  const i2 = render(records, { items: ["I2"] });
  const i2Fan = section(i2, SEC_FANOUT);
  assert.ok(i2Fan.includes("ses_i2"), "with --item I2 the duration table holds I2's sub-session");
  assert.equal(i2Fan.includes("ses_i1"), false, "with --item I2 the duration table holds ONLY I2's sub-sessions");
  assert.equal(
    section(i2, SEC_SWIMLANES).includes("ses_i1"),
    false,
    "the swimlanes and the duration table cannot disagree about which records exist",
  );
});

// ===========================================================================
// [15.0-truncated-payload-marked]
// ===========================================================================

test("[15.0-truncated-payload-marked] a record whose data is the journal's truncation marker renders with an explicit TRUNCATED marker and its preview, never as a blank payload", () => {
  // adapter/journal.ts:142-159 shrinkToFit, at the :58 32 KiB cap.
  const records = [
    rec({
      seq: 1,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_t",
      data: { truncated: true, preview: "ROLE-implementer-PREVIEW" },
    }),
    rec({ seq: 2, component: "fsm", event: "transition", data: { truncated: true } }),
    rec({ seq: 3, level: "warn", component: "fsm", event: "refusal", data: { why: "an ordinary payload" } }),
  ];

  const swim = section(render(records), SEC_SWIMLANES);
  const first = lineWith(swim, "#1");
  assert.ok(first.includes(MARK_TRUNCATED), "a truncated payload is marked TRUNCATED");
  assert.ok(first.includes("ROLE-implementer-PREVIEW"), "the preview is shown when the writer kept one");
  assert.ok(
    lineWith(swim, "#2").includes(MARK_TRUNCATED),
    "a payload truncated all the way to {truncated:true} is still marked — a blank data field would read as 'nothing happened'",
  );
  assert.equal(
    lineWith(swim, "#3").includes(MARK_TRUNCATED),
    false,
    "an ordinary payload is never marked truncated",
  );
  assert.ok(lineWith(swim, "#3").includes("an ordinary payload"), "an ordinary payload is still shown");
});

// ===========================================================================
// [15.0-unknown-event-marked]
// ===========================================================================

test("[15.0-unknown-event-marked] a component+event outside the closed §7.4 vocabulary is rendered with an explicit UNKNOWN-EVENT marker (decided by core isKnownEvent), neither hidden nor treated as malformed", () => {
  // adapter/journal.ts:236-238 RETAINS such a record in production rather than
  // dropping it, precisely so a human can see it.
  const records = [
    rec({
      seq: 1,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_k",
      data: { role: "implementer", itemId: "I1", tree: "wt-a", model: "qwen3.6-27b" },
    }),
    rec({
      seq: 2,
      component: "fanout",
      event: "subsession.teleported",
      itemId: "I1",
      sessionID: "ses_k",
      data: { note: "retained by the production path" },
    }),
    rec({ seq: 3, component: "mystery", event: "transition", data: {} }),
  ];

  assert.equal(isKnownEvent("fanout", "subsession.dispatched"), true, "precondition: a listed event is known");
  assert.equal(isKnownEvent("fanout", "subsession.teleported"), false, "precondition: an unlisted event is unknown");
  assert.equal(isKnownEvent("mystery", "transition"), false, "precondition: an unknown component is unknown");

  const parsed = parseJournalText(jsonl(records));
  assert.deepEqual(
    parsed.malformed,
    [],
    "an unknown event is schema-valid (the §7.2 schema does not police event names) — it is NOT malformed",
  );
  assert.deepEqual(parsed.records.map((r) => r.seq), [1, 2, 3], "no record is hidden");

  const swim = section(render(parsed.records), SEC_SWIMLANES);
  assert.equal(
    lineWith(swim, "#1").includes(MARK_UNKNOWN_EVENT),
    false,
    "a record in the closed vocabulary is not marked unknown",
  );
  assert.ok(lineWith(swim, "#2").includes(MARK_UNKNOWN_EVENT), "an unlisted event under a known component is marked");
  assert.ok(lineWith(swim, "#3").includes(MARK_UNKNOWN_EVENT), "an unknown component is marked too");
});

// ===========================================================================
// [15.0-render-deterministic-utc]
// ===========================================================================

test("[15.0-render-deterministic-utc] renderTimeline is deterministic and clock-free: byte-identical across calls, timestamps rendered from record.ts as ISO-8601 UTC, and no wall-clock text anywhere", () => {
  const records = [
    rec({ seq: 1, ts: Date.UTC(2026, 7, 14, 12, 34, 56, 789), component: "fsm", event: "transition" }),
    rec({ seq: 2, ts: Date.UTC(2026, 0, 1, 0, 0, 0, 0), component: "gates", event: "allow" }),
  ];

  const first = render(records);
  const second = render(records);
  assert.equal(first, second, "two calls on the same input return byte-identical strings");

  assert.ok(
    first.includes("2026-08-14T12:34:56.789Z"),
    "record.ts renders as ISO-8601 UTC — no local timezone, no locale formatting",
  );
  assert.ok(first.includes("2026-01-01T00:00:00.000Z"), "the second record's UTC instant too");

  const stamps = first.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g);
  assert.equal(
    stamps === null ? 0 : stamps.length,
    records.length,
    "exactly one timestamp per record — no generation timestamp, no wall-clock header",
  );

  const src = readFileSync(replayPath, "utf8");
  assert.equal(
    src.includes("Date.now()"),
    false,
    "the pure functions never read the wall clock, so two machines in two timezones render the same journal identically",
  );
});

// ===========================================================================
// [15.0-cli-exit-codes]
// ===========================================================================

test("[15.0-cli-exit-codes] usage errors return exitCode 2 naming the offending value (and, for --component, the eight legal components from core COMPONENTS); a run dir with no journal source exits 1 naming the path; an empty journal exits 0 with a zero-record notice", () => {
  const noDir = errArgs(parseArgs([]), "no run-dir argument");
  assert.equal(noDir.exitCode, 2, "a missing run dir is a usage error");
  assert.ok(noDir.error.length > 0, "the usage error carries a message");

  const flagOnly = errArgs(parseArgs(["--component", "fanout"]), "flags but no run dir");
  assert.equal(flagOnly.exitCode, 2, "flags alone are still a missing run dir");

  const badFlag = errArgs(parseArgs(["/some/run", "--sideways"]), "unknown flag");
  assert.equal(badFlag.exitCode, 2);
  assert.ok(badFlag.error.includes("--sideways"), "the message names the unknown flag");

  const badComponent = errArgs(parseArgs(["/some/run", "--component", "gatez"]), "unknown component");
  assert.equal(badComponent.exitCode, 2);
  assert.ok(badComponent.error.includes("gatez"), "the message names the offending component value");
  for (const c of COMPONENTS) {
    assert.ok(
      badComponent.error.includes(c),
      `the message must list the legal component ${c}, taken from core COMPONENTS — a typo must never render a silently empty timeline`,
    );
  }

  const badLevel = errArgs(parseArgs(["/some/run", "--level", "verbose"]), "unknown level");
  assert.equal(badLevel.exitCode, 2);
  assert.ok(badLevel.error.includes("verbose"), "the message names the offending level value");

  // The argv shell itself.
  const usage = runCli([]);
  assert.equal(usage.status, 2, "no run-dir argument exits 2");
  assert.equal(usage.stdout, "", "a usage error produces NO stdout");
  assert.ok(usage.stderr.length > 0, "a usage error writes its message to stderr");

  const noJournal = freshDir();
  const missing = runCli([noJournal]);
  assert.equal(missing.status, 1, "a run dir holding no readable journal source at all exits 1");
  assert.ok(
    missing.stderr.includes(path.basename(noJournal)),
    `the exit-1 message names the path; stderr was ${missing.stderr}`,
  );

  const emptyJournal = freshDir();
  writeFileSync(path.join(emptyJournal, "journal.jsonl"), "");
  const zero = runCli([emptyJournal]);
  assert.equal(zero.status, 0, "an empty journal still renders — that is not an error");
  assert.ok(zero.stdout.includes(MARK_NO_RECORDS), "an empty journal renders an explicit zero-record notice");

  const populated = freshDir();
  writeFileSync(
    path.join(populated, "journal.jsonl"),
    jsonl([rec({ seq: 1, component: "state", event: "run.created", data: { note: "HAPPY-PATH" } })]),
  );
  const good = runCli([populated]);
  assert.equal(good.status, 0, "a readable journal renders and exits 0");
  assert.ok(good.stdout.includes("HAPPY-PATH"), "the render goes to stdout");
});

// ===========================================================================
// [15.0-read-only-tool]
// ===========================================================================

test("[15.0-read-only-tool] replay mutates nothing: a run dir is byte-identical before and after a replay, and journal.jsonl plus its archives are its only inputs", () => {
  const dir = freshDir();
  const archived = [rec({ seq: 1, component: "state", event: "run.created" })];
  const live = [
    rec({
      seq: 2,
      level: "warn",
      component: "gates",
      event: "deny",
      data: { toolName: "bash", args: {}, reason: "read-only fixture" },
    }),
    rec({
      seq: 3,
      component: "fanout",
      event: "subsession.dispatched",
      itemId: "I1",
      sessionID: "ses_ro",
      data: { role: "reviewer", itemId: "I1", tree: "main", model: "qwen3.6-27b" },
    }),
  ];
  writeFileSync(path.join(dir, "journal.1.jsonl.gz"), gzipSync(Buffer.from(jsonl(archived), "utf8")));
  writeFileSync(path.join(dir, "journal.jsonl"), jsonl(live));
  mkdirSync(path.join(dir, "state"), { recursive: true });
  writeFileSync(path.join(dir, "state", "run.json"), '{"id":"r-15.0"}');
  mkdirSync(path.join(dir, "reviews"), { recursive: true });
  writeFileSync(path.join(dir, "reviews", "plan-r1.json"), "{}");

  const before = snapshot(dir);
  assert.ok(before.length >= 6, "precondition: the fixture run dir really holds the files we are about to protect");

  const out = readRunJournal(dir);
  renderTimeline({ records: out.records, malformed: out.malformed, filters: {}, sources: out.sources });

  assert.deepEqual(
    snapshot(dir),
    before,
    "readRunJournal + renderTimeline created, removed and modified nothing in the run dir",
  );

  for (const s of out.sources) {
    assert.match(
      path.basename(s.file),
      /^journal(\.\d+)?\.jsonl(\.gz)?$/,
      `replay's only inputs are journal.jsonl and its archives; it read ${s.file}`,
    );
  }

  const cli = runCli([dir]);
  assert.equal(cli.status, 0, "the CLI leg renders the fixture");
  assert.deepEqual(snapshot(dir), before, "the CLI leg leaves the run dir byte-identical too");
});

// ===========================================================================
// [15.0-against-a-real-written-journal]
// ===========================================================================

test("[15.0-against-a-real-written-journal] a journal produced by the COMMITTED writer (adapter/journal.ts createJournal) reads back with zero malformed lines, and the derived denial, duration and review sections match what was logged", () => {
  const dir = freshDir();
  const journal = createJournal(dir, makeConfig("trace"), {});
  const runCorr = { runId: "r-real" };
  const subCorr = { runId: "r-real", itemId: "I3", sessionID: "ses_real" };

  journal.log(
    "warn",
    "gates",
    "deny",
    {
      toolName: "bash",
      args: { command: "git push --force" },
      reason: "force-push is refused by the git gate",
      command: "git push --force",
    },
    runCorr,
  );
  journal.log(
    "info",
    "fanout",
    "subsession.dispatched",
    { role: "reviewer", itemId: "I3", tree: "main", model: "qwen3.6-27b" },
    subCorr,
  );
  journal.log("info", "fanout", "subsession.complete", { ok: true, attempts: 1 }, subCorr);
  journal.log(
    "info",
    "fsm",
    "transition",
    {
      to: "PLAN_REVIEWED",
      rounds: 1,
      lenses: ["correctness"],
      findingsRaised: { major: 0, minor: 1, nit: 0 },
      survivingMajors: 0,
      questions: 0,
      blockedItems: 0,
    },
    runCorr,
  );
  journal.flushSync();

  const out = readRunJournal(dir);
  assert.deepEqual(out.malformed, [], "the committed writer's own output parses with ZERO malformed lines");
  assert.equal(out.records.length, 4, "every logged record comes back");
  for (const r of out.records) {
    const res = validate("JournalRecord", r);
    assert.ok(res.ok, `a record the writer wrote must validate as JournalRecord: ${res.errors.join("; ")}`);
  }

  const text = renderTimeline({
    records: out.records,
    malformed: out.malformed,
    filters: {},
    sources: out.sources,
  });
  const denials = section(text, SEC_DENIALS);
  assert.ok(denials.includes(MARK_DENY), "the writer's deny lands in the denials section");
  assert.ok(denials.includes("force-push is refused by the git gate"), "with the reason the gate actually journaled");
  assert.ok(denials.includes("git push --force"), "and the repro command denySnapshot attached");

  const dispatched = out.records.filter((r) => r.event === "subsession.dispatched");
  const completed = out.records.filter((r) => r.event === "subsession.complete");
  assert.equal(dispatched.length, 1, "precondition: one dispatch was written");
  assert.equal(completed.length, 1, "precondition: one completion was written");

  const rows = deriveFanoutRows(out.records);
  assert.equal(rows.length, 1, "one fan-out row for the one sub-session the writer recorded");
  assert.equal(rows[0].sessionID, "ses_real");
  assert.equal(rows[0].role, "reviewer", "the role the writer put in the dispatched payload");
  assert.equal(rows[0].model, "qwen3.6-27b");
  assert.equal(rows[0].itemId, "I3");
  assert.equal(
    rows[0].durationMs,
    completed[0].ts - dispatched[0].ts,
    "the duration is the ts delta of the two records the writer actually wrote",
  );
  assert.equal(rows[0].outcome, "ok");
  assert.equal(rows[0].attempts, 1);

  const rounds = deriveReviewRounds(out.records);
  assert.equal(rounds.length, 1, "the transition the writer recorded is the one review round");
  assert.equal(rounds[0].subject, "plan", "a run-level transition is the plan subject");
  assert.equal(rounds[0].outcome, "accepted");
  assert.equal(rounds[0].round, 1);
  assert.equal(rounds[0].survivingMajors, 0);
  assert.deepEqual(rounds[0].lenses, ["correctness"]);
  assert.deepEqual(rounds[0].findingsRaised, { major: 0, minor: 1, nit: 0 });
  assert.equal(rounds[0].reviewers, 1, "the reviewer dispatch in the round's window is counted");
});

// ===========================================================================
// [15.0-builtins-only]
// ===========================================================================

test("[15.0-builtins-only] replay.ts imports only node:fs, node:path, node:zlib and relative ../core/*.ts modules, reuses the core vocabulary and schema rather than restating them, and carries no non-erasable TypeScript", () => {
  // Guarded here because tests/purity.test.ts:27-29 scans core/, adapter/ and
  // plugin/ only — conductor/tools/ is covered by no committed guard (SG-10).
  const src = readFileSync(replayPath, "utf8");

  const specifiers: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)) specifiers.push(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) specifiers.push(m[1]);

  assert.ok(specifiers.length > 0, "the guard must actually find replay.ts's imports — a guard that inspects nothing passes vacuously");
  for (const spec of specifiers) {
    const allowed =
      spec === "node:fs" ||
      spec === "node:path" ||
      spec === "node:zlib" ||
      /^\.\.\/core\/[A-Za-z0-9._-]+\.ts$/.test(spec);
    assert.ok(
      allowed,
      `replay.ts may import only node:fs, node:path, node:zlib and relative ../core/*.ts modules (G1: zero runtime dependencies); found ${spec}`,
    );
  }
  assert.ok(
    specifiers.includes("../core/types.ts"),
    "replay REUSES core JournalRecord / validate / LOG_LEVELS instead of restating the record shape or the severity order",
  );
  assert.ok(
    specifiers.includes("../core/journal-events.ts"),
    "replay REUSES core COMPONENTS / isKnownEvent instead of re-listing the §7.4 vocabulary",
  );

  // Single-runtime and shell escapes (G14). Tokens assembled by concatenation so
  // this guard can never flag its own source.
  const forbidden: { token: string; why: string }[] = [
    { token: "Bun" + ".", why: "a Bun-only global breaks the Node leg" },
    { token: "process" + ".binding", why: "an internal Node API breaks the Bun leg" },
    { token: "$" + "`", why: "the Bun shell tag is single-runtime" },
    { token: "require" + "(", why: "CommonJS require has no place in an ESM module" },
  ];
  for (const f of forbidden) {
    assert.equal(src.includes(f.token), false, `replay.ts must not use ${f.token} — ${f.why}`);
  }
  assert.equal(
    /\bimport\s*\(/.test(src),
    false,
    "no dynamic import: replay's dependency set must be readable straight off the import list",
  );

  // Non-erasable TypeScript (G2). Declaration-shaped patterns, so prose in a
  // comment cannot trip the guard while a real declaration cannot escape it.
  const nonErasable: { pattern: RegExp; why: string }[] = [
    { pattern: /(^|\n)\s*(export\s+)?(declare\s+)?(const\s+)?enum\s+[A-Za-z_$]/, why: "enum" },
    { pattern: /(^|\n)\s*(export\s+)?(declare\s+)?namespace\s+[A-Za-z_$]/, why: "namespace" },
    { pattern: /(^|\n)\s*@[A-Za-z_$][A-Za-z0-9_$]*\s*(\(|\n)/, why: "decorator" },
    {
      pattern: /constructor\s*\([^)]*\b(public|private|protected|readonly)\b/,
      why: "parameter property",
    },
  ];
  for (const n of nonErasable) {
    assert.equal(
      n.pattern.test(src),
      false,
      `replay.ts must be erasable TypeScript (G2, tsconfig erasableSyntaxOnly) — found a ${n.why}`,
    );
  }
});
