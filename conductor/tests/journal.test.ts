// Task 2.1 red tests — lives at conductor/tests/journal.test.ts.
//
// Subjects (must NOT exist when this goes red; the failure is
// `Cannot find module '../core/journal-events.ts'` — the missing-subject shape,
// a legal red):
//   - conductor/core/journal-events.ts  (closed event vocabulary + level defaults)
//   - conductor/adapter/journal.ts       (leveled JSONL journal + console sink)
// conductor/core/types.ts already exists (green) and is the source of the §7.2
// JournalRecord type + the `validate` subset-validator this test reuses.
//
// Spec:
//   §7.1 levels & sinks (plan 1909-1929): five levels error>warn>info>debug>trace;
//     logging.level global + logging.components per-component override; env
//     CONDUCTOR_LOG wins over config; error/warn written regardless of level;
//     console (stderr) sink at >= console level (default warn); journal exceeding
//     retention.maxRunDirBytes rotates to journal.N.jsonl.gz.
//   §7.2 record shape (plan 1930-1945): {seq, ts, level, component, runId,
//     itemId?, sessionID?, event, data}; correlation triple always carried; event
//     names are a closed tested vocabulary (no adapter emits an unlisted event).
//   §7.4 debuggability law (plan 1956-1963): logs you can't grep by name are logs
//     you can't debug — unknown events must be caught.
//   Task 2.1 interfaces (plan 2163-2178).
//
// DUAL-RUNTIME (G14): this test drives adapter/journal.ts through node:fs temp
// dirs only (os.tmpdir + mkdtempSync). It never touches a Bun API and asserts
// only observable behaviour: files on disk, injected consoleFn calls, thrown
// errors. The implementer uses node:fs (appendFileSync/readFileSync/renameSync) +
// node:zlib for the .gz rotation.
//
// Assertions covered: 2.1-vocab, 2.1-api, 2.1-levels, 2.1-env,
// 2.1-unknown-event, 2.1-seq, 2.1-console, 2.1-truncation, 2.1-rotation.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";

import { validate } from "../core/types.ts";
import type { JournalRecord, Config, LogLevel } from "../core/types.ts";

// The two subjects under test — absent at red time.
import { EVENTS, isKnownEvent, DEFAULT_LEVEL, DEFAULT_CONSOLE_LEVEL } from "../core/journal-events.ts";
import { createJournal } from "../adapter/journal.ts";

// ---------------------------------------------------------------------------
// Pinned contract (so the implementer targets it precisely)
// ---------------------------------------------------------------------------
// core/journal-events.ts:
//   EVENTS: Record<Component, readonly string[]>   // component -> closed event list
//   isKnownEvent(component: string, event: string): boolean
//   DEFAULT_LEVEL: LogLevel        // "info"  (§7.1 global default)
//   DEFAULT_CONSOLE_LEVEL: LogLevel // "warn" (§7.1 console default)
//
// adapter/journal.ts:
//   createJournal(runDir, config, env, consoleFn?) -> { log, flushSync }
//     log(level: LogLevel, component: string, event: string,
//         data: Record<string, unknown>, corr: Corr): void
//     flushSync(): void
//   Corr = { runId: string; itemId?: string; sessionID?: string }
//   consoleFn(record: JournalRecord): void   // injected console sink; tests capture
//   env: Record<string, string | undefined>  // process.env-like; CONDUCTOR_LOG + NODE_ENV read here
//   Journal file: <runDir>/journal.jsonl ; rotations: <runDir>/journal.N.jsonl.gz
// ---------------------------------------------------------------------------

const COMPONENTS = [
  "fsm",
  "gates",
  "fanout",
  "evidence",
  "continuation",
  "inject",
  "router-client",
  "state",
] as const;

const ALL_LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "trace"];

// EVENTS indexed by an arbitrary string, independent of the implementer's exact
// key typing — the test sources valid event names from the vocabulary itself.
const eventsByComponent = EVENTS as unknown as Record<string, readonly string[]>;

function anyEvent(component: string): string {
  const list = eventsByComponent[component];
  assert.ok(Array.isArray(list) && list.length > 0, `EVENTS.${component} must be a non-empty list`);
  return list[0];
}

// ---------------------------------------------------------------------------
// Temp-dir + fixture helpers (ephemeral; never the repo tree, never port 8080)
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function freshRunDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-journal-"));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readRecords(runDir: string): JournalRecord[] {
  const file = path.join(runDir, "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

/** A full, valid §2.1 Config (assigned to a variable so no excess-property check
 *  fires — the adapter may type `config` as Config or any narrower subset). */
function makeConfig(over: {
  level?: LogLevel;
  components?: Record<string, LogLevel>;
  maxRunDirBytes?: number;
}): Config {
  return {
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
    retention: {
      keepRuns: 20,
      maxRunDirBytes: over.maxRunDirBytes ?? 268435456,
      pruneOnRunCreate: true,
    },
    logging: { level: over.level ?? "info", components: over.components ?? {} },
  };
}

const CORR = { runId: "r-2.1" } as const;
const DEV_ENV: Record<string, string> = {}; // no NODE_ENV => dev/test (throws on unknown)

function has(records: JournalRecord[], component: string, level: LogLevel): boolean {
  return records.some((r) => r.component === component && r.level === level);
}

// ===========================================================================
// [2.1-vocab] core/journal-events.ts: closed vocabulary per component + defaults
// ===========================================================================

test("[2.1-vocab] EVENTS covers all eight §7.1 components with non-empty event lists", () => {
  for (const component of COMPONENTS) {
    const list = eventsByComponent[component];
    assert.ok(Array.isArray(list), `EVENTS.${component} must be an array`);
    assert.ok(list.length > 0, `EVENTS.${component} must list at least one event`);
    for (const event of list) {
      assert.equal(typeof event, "string", `EVENTS.${component} entries must be strings`);
    }
  }
});

test("[2.1-vocab] isKnownEvent agrees with EVENTS for every listed (component, event)", () => {
  for (const component of COMPONENTS) {
    for (const event of eventsByComponent[component]) {
      assert.equal(
        isKnownEvent(component, event),
        true,
        `isKnownEvent(${component}, ${event}) must be true — it is in EVENTS`,
      );
    }
  }
});

test("[2.1-vocab] isKnownEvent rejects unlisted events and unknown components (§7.4)", () => {
  assert.equal(
    isKnownEvent("fanout", "definitely.not.a.registered.event"),
    false,
    "an unlisted event name must be rejected",
  );
  assert.equal(
    isKnownEvent("not-a-real-component", anyEvent("fanout")),
    false,
    "a real event under an unknown component must be rejected",
  );
});

test("[2.1-vocab] the §7.2 example event fanout/subsession.dispatched is in the vocabulary", () => {
  // Plan lines 1935-1936 give this exact (component, event) as the record shape example.
  assert.equal(isKnownEvent("fanout", "subsession.dispatched"), true);
  assert.ok(
    eventsByComponent["fanout"].includes("subsession.dispatched"),
    "EVENTS.fanout must contain the §7.2 example event",
  );
});

test("[2.1-vocab] level defaults: DEFAULT_LEVEL=info, DEFAULT_CONSOLE_LEVEL=warn (§7.1)", () => {
  assert.equal(DEFAULT_LEVEL, "info", "global default level is info (§7.1)");
  assert.equal(DEFAULT_CONSOLE_LEVEL, "warn", "console default level is warn (§7.1 sink table)");
  assert.ok(ALL_LEVELS.includes(DEFAULT_LEVEL), "DEFAULT_LEVEL must be a valid LogLevel");
  assert.ok(ALL_LEVELS.includes(DEFAULT_CONSOLE_LEVEL), "DEFAULT_CONSOLE_LEVEL must be a valid LogLevel");
});

// ===========================================================================
// [2.1-api] createJournal shape + §7.2 record shape + correlation triple
// ===========================================================================

test("[2.1-api] createJournal returns {log, flushSync}; a record has the §7.2 shape and validates", () => {
  const runDir = freshRunDir();
  const cfg = makeConfig({ level: "trace" });
  const journal = createJournal(runDir, cfg, DEV_ENV);

  assert.equal(typeof journal.log, "function", "createJournal must return log()");
  assert.equal(typeof journal.flushSync, "function", "createJournal must return flushSync()");

  const event = anyEvent("fanout");
  journal.log("info", "fanout", event, { role: "reviewer", lens: "correctness" }, {
    runId: "r-api",
    itemId: "I3",
    sessionID: "ses_api",
  });
  journal.flushSync();

  const records = readRecords(runDir);
  assert.equal(records.length, 1, "exactly one record was written");
  const rec = records[0];

  // §7.2 shape.
  assert.equal(typeof rec.seq, "number");
  assert.equal(typeof rec.ts, "number");
  assert.equal(rec.level, "info");
  assert.equal(rec.component, "fanout");
  assert.equal(rec.event, event);
  assert.equal(rec.runId, "r-api");
  assert.equal(rec.itemId, "I3");
  assert.equal(rec.sessionID, "ses_api");
  assert.deepEqual(rec.data, { role: "reviewer", lens: "correctness" });

  // The record validates against the project's own §7.2 JournalRecord schema
  // (single source of truth in core/types.ts): no stray top-level keys.
  const res = validate("JournalRecord", rec);
  assert.ok(res.ok, `record must validate as JournalRecord: ${res.errors.join("; ")}`);
});

test("[2.1-api] correlation triple: itemId/sessionID appear only when supplied in corr", () => {
  const runDir = freshRunDir();
  const journal = createJournal(runDir, makeConfig({ level: "trace" }), DEV_ENV);

  journal.log("info", "state", anyEvent("state"), {}, { runId: "r-corr" }); // runId only
  journal.log("info", "state", anyEvent("state"), {}, { runId: "r-corr", itemId: "I7" }); // + itemId
  journal.flushSync();

  const records = readRecords(runDir);
  assert.equal(records.length, 2);

  assert.equal(records[0].runId, "r-corr");
  assert.equal(records[0].itemId, undefined, "itemId absent when not supplied");
  assert.equal(records[0].sessionID, undefined, "sessionID absent when not supplied");

  assert.equal(records[1].itemId, "I7", "itemId carried when supplied");
  assert.equal(records[1].sessionID, undefined, "sessionID still absent when not supplied");

  for (const rec of records) {
    const res = validate("JournalRecord", rec);
    assert.ok(res.ok, `correlation record must validate: ${res.errors.join("; ")}`);
  }
});

// ===========================================================================
// [2.1-levels] level filtering matrix; error/warn ALWAYS written (§7.1)
// ===========================================================================

interface LevelRow {
  configured: LogLevel;
  present: LogLevel[];
}

// error>warn>info>debug>trace. A record at level L is written iff L is at least
// as severe as the configured threshold — EXCEPT error and warn, which are
// always written regardless of the threshold (§7.1). Note the configured="error"
// row: warn is LESS severe than error, so the ordinary filter would drop it — it
// appears anyway, which is the always-written property.
const levelRows: LevelRow[] = [
  { configured: "error", present: ["error", "warn"] },
  { configured: "warn", present: ["error", "warn"] },
  { configured: "info", present: ["error", "warn", "info"] },
  { configured: "debug", present: ["error", "warn", "info", "debug"] },
  { configured: "trace", present: ["error", "warn", "info", "debug", "trace"] },
];

for (const row of levelRows) {
  test(`[2.1-levels] configured=${row.configured} writes exactly {${row.present.join(",")}} (error/warn always)`, () => {
    const runDir = freshRunDir();
    const journal = createJournal(runDir, makeConfig({ level: row.configured }), DEV_ENV);

    const event = anyEvent("fanout");
    for (const level of ALL_LEVELS) {
      journal.log(level, "fanout", event, { lvl: level }, CORR);
    }
    journal.flushSync();

    const records = readRecords(runDir);
    for (const level of ALL_LEVELS) {
      const expected = row.present.includes(level);
      assert.equal(
        has(records, "fanout", level),
        expected,
        `at configured=${row.configured}, level ${level} should be ${expected ? "written" : "filtered"}`,
      );
    }
    // The always-written guarantee, stated directly.
    assert.ok(has(records, "fanout", "error"), "error is always written");
    assert.ok(has(records, "fanout", "warn"), "warn is always written regardless of configured level");
  });
}

// ===========================================================================
// [2.1-env] CONDUCTOR_LOG env override beats config (per-component and global)
// ===========================================================================

test("[2.1-env] CONDUCTOR_LOG=fanout:trace,gates:debug overrides per component; uncovered components keep config", () => {
  const runDir = freshRunDir();
  // Config global level is the most restrictive: with no env, only error/warn survive.
  const cfg = makeConfig({ level: "error" });
  const env: Record<string, string> = { CONDUCTOR_LOG: "fanout:trace,gates:debug" };
  const journal = createJournal(runDir, cfg, env);

  journal.log("trace", "fanout", anyEvent("fanout"), {}, CORR); // fanout->trace: WRITTEN
  journal.log("debug", "gates", anyEvent("gates"), {}, CORR); // gates->debug: WRITTEN
  journal.log("trace", "gates", anyEvent("gates"), {}, CORR); // below gates threshold: DROPPED
  journal.log("info", "state", anyEvent("state"), {}, CORR); // state uses config "error": DROPPED
  journal.log("error", "state", anyEvent("state"), {}, CORR); // error always: WRITTEN
  journal.flushSync();

  const records = readRecords(runDir);
  assert.ok(has(records, "fanout", "trace"), "fanout:trace override lets a fanout trace through");
  assert.ok(has(records, "gates", "debug"), "gates:debug override lets a gates debug through");
  assert.ok(!has(records, "gates", "trace"), "gates trace is below the gates:debug override — dropped");
  assert.ok(!has(records, "state", "info"), "state is uncovered by env — keeps config level error, drops info");
  assert.ok(has(records, "state", "error"), "state error is always written");
});

test("[2.1-env] bare CONDUCTOR_LOG=debug overrides the global config level", () => {
  const runDir = freshRunDir();
  const cfg = makeConfig({ level: "error" }); // config says error-only
  const env: Record<string, string> = { CONDUCTOR_LOG: "debug" }; // env raises the floor to debug
  const journal = createJournal(runDir, cfg, env);

  journal.log("debug", "fanout", anyEvent("fanout"), {}, CORR); // WRITTEN (env global=debug)
  journal.log("trace", "fanout", anyEvent("fanout"), {}, CORR); // DROPPED (below debug)
  journal.log("info", "state", anyEvent("state"), {}, CORR); // WRITTEN (debug covers info)
  journal.flushSync();

  const records = readRecords(runDir);
  assert.ok(has(records, "fanout", "debug"), "bare env debug beats config error for debug records");
  assert.ok(!has(records, "fanout", "trace"), "trace is still below the env debug floor");
  assert.ok(has(records, "state", "info"), "bare env debug applies globally, across components");
});

// ===========================================================================
// [2.1-unknown-event] unknown event THROWS in dev/test, warns (tolerates) in prod
// ===========================================================================
// Mechanism: env.NODE_ENV. Absent or any value !== "production" => dev/test
// (throw, so the mis-named event is caught at the source, per §7.4). NODE_ENV ===
// "production" => prod (no throw; the record is retained and surfaced so
// logging never crashes production). Plan line 2174: "unknown event name THROWS
// in dev/test (asserted) and warns in prod".

const BOGUS_EVENT = "definitely.not.a.registered.event";

test("[2.1-unknown-event] dev/test: an unknown event THROWS (message names it) and writes nothing", () => {
  for (const env of [DEV_ENV, { NODE_ENV: "test" }, { NODE_ENV: "development" }] as Record<string, string>[]) {
    const runDir = freshRunDir();
    const journal = createJournal(runDir, makeConfig({ level: "trace" }), env);

    assert.throws(
      () => journal.log("info", "fanout", BOGUS_EVENT, {}, CORR),
      (err: unknown) => {
        assert.ok(err instanceof Error, "must throw an Error");
        assert.ok(
          err.message.includes(BOGUS_EVENT),
          `thrown message must name the offending event; got: ${err.message}`,
        );
        return true;
      },
      `unknown event must throw under env=${JSON.stringify(env)}`,
    );

    journal.flushSync();
    assert.equal(readRecords(runDir).length, 0, "a rejected unknown event writes nothing to the journal");
  }
});

test("[2.1-unknown-event] prod: an unknown event does NOT throw; the record is retained and surfaced", () => {
  const runDir = freshRunDir();
  const consoleRecords: JournalRecord[] = [];
  const consoleFn = (rec: JournalRecord): void => {
    consoleRecords.push(rec);
  };
  const journal = createJournal(runDir, makeConfig({ level: "trace" }), { NODE_ENV: "production" }, consoleFn);

  assert.doesNotThrow(
    () => journal.log("warn", "fanout", BOGUS_EVENT, { note: "prod tolerates" }, CORR),
    "in prod an unknown event must not throw",
  );
  journal.flushSync();

  const records = readRecords(runDir);
  assert.ok(
    records.some((r) => r.event === BOGUS_EVENT),
    "prod retains the unknown-event record in the journal rather than losing it",
  );
  assert.ok(
    consoleRecords.some((r) => r.event === BOGUS_EVENT),
    "prod surfaces the unknown event through the warn console sink instead of throwing",
  );
});

// ===========================================================================
// [2.1-seq] seq monotonic across TWO journal instances on the same runDir
// ===========================================================================

test("[2.1-seq] seq is monotonic and a second journal on the same dir continues from the last seq", () => {
  const runDir = freshRunDir();
  const cfg = makeConfig({ level: "trace" });

  const first = createJournal(runDir, cfg, DEV_ENV);
  for (let i = 0; i < 3; i += 1) {
    first.log("info", "fsm", anyEvent("fsm"), { instance: 1, i }, CORR);
  }
  first.flushSync();

  // Crash-restart: a brand-new journal instance re-reads the last seq from the
  // existing journal file and continues — it must NOT reset to the start.
  const second = createJournal(runDir, cfg, DEV_ENV);
  for (let i = 0; i < 2; i += 1) {
    second.log("info", "fsm", anyEvent("fsm"), { instance: 2, i }, CORR);
  }
  second.flushSync();

  const records = readRecords(runDir);
  assert.equal(records.length, 5, "all five records are present across both instances");

  // Strictly increasing in file order.
  for (let i = 1; i < records.length; i += 1) {
    assert.ok(
      records[i].seq > records[i - 1].seq,
      `seq must strictly increase: ${records[i - 1].seq} -> ${records[i].seq}`,
    );
  }

  const seqOf = (instance: number): number[] =>
    records.filter((r) => (r.data as { instance?: number }).instance === instance).map((r) => r.seq);
  const firstSeqs = seqOf(1);
  const secondSeqs = seqOf(2);
  assert.equal(firstSeqs.length, 3);
  assert.equal(secondSeqs.length, 2);
  assert.ok(
    Math.min(...secondSeqs) > Math.max(...firstSeqs),
    "the second instance's seqs continue above the first instance's — no reset",
  );
});

// ===========================================================================
// [2.1-console] console sink via injected consoleFn receives only records >= warn
// ===========================================================================

test("[2.1-console] console sink (injected consoleFn) gets only records >= warn, independent of file level", () => {
  const runDir = freshRunDir();
  const consoleRecords: JournalRecord[] = [];
  const consoleFn = (rec: JournalRecord): void => {
    consoleRecords.push(rec);
  };
  // File level = trace, so the journal FILE captures everything; the console sink
  // has its own default threshold (warn), so it must NOT mirror the file.
  const journal = createJournal(runDir, makeConfig({ level: "trace" }), DEV_ENV, consoleFn);

  const event = anyEvent("fanout");
  for (const level of ALL_LEVELS) {
    journal.log(level, "fanout", event, { lvl: level }, CORR);
  }
  journal.flushSync();

  // The file got all five (level=trace).
  assert.equal(readRecords(runDir).length, 5, "the journal file captures every level at configured=trace");

  // The console got exactly error + warn, in log order.
  assert.equal(consoleRecords.length, 2, "console sink receives exactly the two records at/above warn");
  assert.equal(consoleRecords[0].level, "error", "first console record is the error");
  assert.equal(consoleRecords[1].level, "warn", "second console record is the warn");
  for (const rec of consoleRecords) {
    assert.equal(typeof rec.seq, "number", "console sink receives full journal records");
    assert.equal(rec.event, event);
    assert.equal(rec.runId, CORR.runId);
  }
});

// ===========================================================================
// [2.1-truncation] atomic append (single line per record) + >32 KiB truncation
// ===========================================================================

test("[2.1-truncation] atomic append: N log calls produce N complete parseable lines with strictly increasing seq", () => {
  const runDir = freshRunDir();
  const journal = createJournal(runDir, makeConfig({ level: "trace" }), DEV_ENV);

  const N = 25;
  const event = anyEvent("evidence");
  for (let i = 0; i < N; i += 1) {
    journal.log("info", "evidence", event, { i }, CORR);
  }
  journal.flushSync();

  const raw = readFileSync(path.join(runDir, "journal.jsonl"), "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, N, "one complete line per record — no partial or interleaved writes");

  const records = lines.map((l) => JSON.parse(l) as JournalRecord); // each line is complete JSON
  for (let i = 1; i < records.length; i += 1) {
    assert.ok(records[i].seq > records[i - 1].seq, "seq strictly increases across the appended records");
  }
});

test("[2.1-truncation] oversized data is truncated with data.truncated=true and the record shrinks", () => {
  const runDir = freshRunDir();
  const journal = createJournal(runDir, makeConfig({ level: "trace" }), DEV_ENV);

  const huge = "x".repeat(100 * 1024); // 100 KiB payload — far over the 32 KiB budget
  journal.log("info", "fanout", anyEvent("fanout"), { blob: huge }, CORR);
  journal.flushSync();

  const raw = readFileSync(path.join(runDir, "journal.jsonl"), "utf8");
  const line = raw.split("\n").find((l) => l.trim().length > 0);
  assert.ok(line, "a record line was written");

  const rec = JSON.parse(line as string) as JournalRecord;
  assert.equal(
    (rec.data as { truncated?: unknown }).truncated,
    true,
    'oversized data is marked with "truncated": true inside data',
  );
  assert.ok(
    Buffer.byteLength(line as string, "utf8") < 40 * 1024,
    "the truncated record is bounded well below the 100 KiB raw payload (≤ ~32 KiB budget)",
  );
});

test("[2.1-truncation] a small record is NOT marked truncated and validates as JournalRecord", () => {
  const runDir = freshRunDir();
  const journal = createJournal(runDir, makeConfig({ level: "trace" }), DEV_ENV);

  journal.log("info", "fanout", anyEvent("fanout"), { small: "ok" }, CORR);
  journal.flushSync();

  const rec = readRecords(runDir)[0];
  assert.notEqual((rec.data as { truncated?: unknown }).truncated, true, "small data is never marked truncated");
  const res = validate("JournalRecord", rec);
  assert.ok(res.ok, `untruncated record must validate as JournalRecord: ${res.errors.join("; ")}`);
});

// ===========================================================================
// [2.1-rotation] journal exceeding retention.maxRunDirBytes rotates to .gz
// ===========================================================================

test("[2.1-rotation] a journal exceeding retention.maxRunDirBytes rotates to journal.1.jsonl.gz (valid gzip)", () => {
  const runDir = freshRunDir();
  // Deliberately tiny threshold so a modest number of records triggers rotation.
  const cfg = makeConfig({ level: "trace", maxRunDirBytes: 800 });
  const journal = createJournal(runDir, cfg, DEV_ENV);

  const event = anyEvent("continuation");
  const pad = "y".repeat(60);
  for (let i = 0; i < 120; i += 1) {
    journal.log("info", "continuation", event, { i, pad }, CORR);
  }
  journal.flushSync();

  const rotated = readdirSync(runDir).filter((f) => /^journal\.\d+\.jsonl\.gz$/.test(f));
  assert.ok(rotated.length >= 1, "at least one rotated .gz archive must exist after exceeding maxRunDirBytes");
  assert.ok(
    rotated.includes("journal.1.jsonl.gz"),
    `first rotation is named journal.1.jsonl.gz (plan line 613); saw: ${rotated.join(", ")}`,
  );
  assert.ok(existsSync(path.join(runDir, "journal.jsonl")), "the active journal.jsonl continues after rotation");

  // The archive is real gzip and decompresses to journal lines.
  const gz = readFileSync(path.join(runDir, "journal.1.jsonl.gz"));
  assert.equal(gz[0], 0x1f, "gzip magic byte 0");
  assert.equal(gz[1], 0x8b, "gzip magic byte 1");
  const text = gunzipSync(gz).toString("utf8");
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  assert.ok(firstLine, "the rotated archive contains journal lines");
  const archived = JSON.parse(firstLine as string) as JournalRecord;
  assert.equal(typeof archived.seq, "number", "archived records keep the §7.2 shape");
  assert.equal(archived.component, "continuation");
});

// ===========================================================================
// [2.1-torn-write] crash-recovery: a torn TRAILING partial line (crash mid-append,
// no terminating newline) must be isolated — the next record must NOT be
// concatenated onto it. One torn write must not silently destroy the next record
// too (§7.4: a record you can't parse is a record you can't debug with).
// ===========================================================================

test("[2.1-torn-write] a torn trailing partial line is isolated; the next record stays its own parseable line (§7.4)", () => {
  const runDir = freshRunDir();
  const cfg = makeConfig({ level: "trace" });

  // A prior process wrote some complete records, then crashed mid-append.
  const first = createJournal(runDir, cfg, DEV_ENV);
  for (let i = 0; i < 3; i += 1) {
    first.log("info", "fsm", anyEvent("fsm"), { pass: 1, i }, CORR);
  }
  first.flushSync();

  const before = readRecords(runDir);
  const lastCompleteSeq = before[before.length - 1].seq;

  // Simulate the crash: a partial record with NO terminating newline is left at
  // the end of the file (power loss / disk full mid-append).
  const TORN = '{"seq":999,"ts":1,"level":"in';
  appendFileSync(path.join(runDir, "journal.jsonl"), TORN); // note: no trailing "\n"

  // A fresh journal restarts on the same dir and logs its next record.
  const second = createJournal(runDir, cfg, DEV_ENV);
  second.log("warn", "fsm", anyEvent("fsm"), { marker: "post-crash" }, CORR);
  second.flushSync();

  const lines = readFileSync(path.join(runDir, "journal.jsonl"), "utf8").split("\n");

  // (c) The torn partial is isolated on its own, still-unparseable line — the
  // writer must not have concatenated the new record onto it.
  assert.ok(
    lines.includes(TORN),
    `the torn partial must survive as its own line, not merge into the next record; saw: ${JSON.stringify(lines)}`,
  );
  assert.throws(() => JSON.parse(TORN), "the torn partial is unparseable by construction");

  // (a) The record written after the torn line is one complete, JSON-parseable
  // line of its own.
  const parsed = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as JournalRecord;
      } catch {
        return undefined;
      }
    })
    .filter((r): r is JournalRecord => r !== undefined);

  const postCrash = parsed.filter((r) => (r.data as { marker?: unknown }).marker === "post-crash");
  assert.equal(
    postCrash.length,
    1,
    "the record written after the torn line must be one complete, JSON-parseable line of its own",
  );

  // (b) Its seq continues past the last COMPLETE record's seq — the torn partial
  // is skipped for seq purposes, never counted.
  assert.equal(
    postCrash[0].seq,
    lastCompleteSeq + 1,
    "the new record's seq continues from the last complete record, past the torn partial",
  );
});
