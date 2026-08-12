// conductor/adapter/journal.ts — Task 2.1 (adapter half): the leveled JSONL
// journal with an injected console sink (plan lines 2163-2178, §7.1-7.4).
//
// This is the first conductor adapter. Adapters do I/O and may read the wall
// clock; only core is forbidden those (G3). It runs under BOTH the opencode
// runtime and Node type-stripping (G14), so it uses only Node-compatible
// built-ins: node:fs for the append/rotate primitives, node:zlib for the real
// gzip rotation, node:path for run-dir joins. No single-runtime API, no shell.
//
// Contract:
//   createJournal(runDir, config, env, consoleFn?) -> { log, flushSync }
//   log(level, component, event, data, corr)
//     - one complete JSON line per call, appended atomically (§7.2 shape);
//     - level filter per §7.1: written iff at/above the resolved threshold,
//       except error/warn which are ALWAYS written;
//     - logging.components overrides the global level per component, and the
//       CONDUCTOR_LOG env (per-component or bare) overrides config;
//     - unknown event (not in the §7.4 vocabulary) THROWS in dev/test and, in
//       production, is retained on disk and surfaced to the console instead of
//       being silently dropped;
//     - the injected consoleFn receives every record at/above the console
//       default (warn), independent of the file threshold;
//     - seq is monotonic and continues across a fresh journal on the same dir;
//     - data pushing a record past ~32 KiB is truncated (data.truncated = true);
//     - a journal past retention.maxRunDirBytes rotates to journal.N.jsonl.gz.

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as path from "node:path";

import { DEFAULT_CONSOLE_LEVEL, isKnownEvent } from "../core/journal-events.ts";
import type { Config, JournalRecord, LogLevel } from "../core/types.ts";

// The correlation triple carried on every record (§7.2). Only runId is
// mandatory; itemId/sessionID appear only when supplied.
export interface Corr {
  runId: string;
  itemId?: string;
  sessionID?: string;
}

export interface Journal {
  log: (
    level: LogLevel,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: Corr,
  ) => void;
  flushSync: () => void;
}

// Severity order (§7.1): error is the most severe (index 0), trace the least.
// A record at level L is written iff rank(L) <= rank(threshold).
const LEVEL_ORDER: readonly LogLevel[] = ["error", "warn", "info", "debug", "trace"];

// Records (line + newline) are bounded to ~32 KiB; larger data is truncated.
const MAX_RECORD_BYTES = 32 * 1024;

function isLevel(value: string): value is LogLevel {
  return (LEVEL_ORDER as readonly string[]).includes(value);
}

function rankOf(level: LogLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

const CONSOLE_RANK = rankOf(DEFAULT_CONSOLE_LEVEL);
const ALWAYS_RANK = rankOf("warn"); // error/warn (rank <= 1) are always written.

interface EnvLog {
  global?: LogLevel;
  components: Record<string, LogLevel>;
}

// Parse CONDUCTOR_LOG: comma-separated segments, each either `component:level`
// (per-component) or a bare `level` (global). Unknown levels are ignored rather
// than allowed to silence a component by typo.
function parseEnvLog(raw: string | undefined): EnvLog {
  const components: Record<string, LogLevel> = {};
  let global: LogLevel | undefined;
  if (raw === undefined) return { global, components };
  for (const segment of raw.split(",")) {
    const seg = segment.trim();
    if (seg.length === 0) continue;
    const colon = seg.indexOf(":");
    if (colon === -1) {
      if (isLevel(seg)) global = seg;
      continue;
    }
    const component = seg.slice(0, colon).trim();
    const level = seg.slice(colon + 1).trim();
    if (component.length > 0 && isLevel(level)) components[component] = level;
  }
  return { global, components };
}

// Re-read the last seq from the existing journal so a fresh instance on the same
// dir continues rather than resetting (§7.2 / task line 2175). Scans from the
// end for the first parseable record with a numeric seq.
function readLastSeq(journalPath: string): number {
  if (!existsSync(journalPath)) return 0;
  let raw: string;
  try {
    raw = readFileSync(journalPath, "utf8");
  } catch {
    return 0;
  }
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as { seq?: unknown };
      if (typeof parsed.seq === "number" && Number.isFinite(parsed.seq)) return parsed.seq;
    } catch {
      continue;
    }
  }
  return 0;
}

// Shrink an oversized record in place: replace its data with a truncation marker
// plus as much of the original serialized payload as fits the byte budget. The
// `truncated` flag lives INSIDE data (never a top-level key, per §7.2).
function shrinkToFit(record: JournalRecord): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(record.data);
  } catch {
    serialized = String(record.data);
  }
  if (typeof serialized !== "string") serialized = "";
  let keep = serialized.length;
  record.data = { truncated: true, preview: serialized };
  while (keep > 0 && Buffer.byteLength(JSON.stringify(record), "utf8") + 1 > MAX_RECORD_BYTES) {
    keep = Math.floor(keep / 2);
    record.data = { truncated: true, preview: serialized.slice(0, keep) };
  }
  if (Buffer.byteLength(JSON.stringify(record), "utf8") + 1 > MAX_RECORD_BYTES) {
    record.data = { truncated: true };
  }
}

export function createJournal(
  runDir: string,
  config: Config,
  env: Record<string, string | undefined>,
  consoleFn?: (record: JournalRecord) => void,
): Journal {
  const journalPath = path.join(runDir, "journal.jsonl");
  const isProd = env.NODE_ENV === "production";
  const envLog = parseEnvLog(env.CONDUCTOR_LOG);
  const configGlobal: LogLevel = config.logging.level;
  const configComponents: Record<string, LogLevel> = config.logging.components;
  const maxBytes = config.retention.maxRunDirBytes;

  let seq = readLastSeq(journalPath);

  // Env beats config; within each, a per-component level beats the global one.
  function thresholdFor(component: string): LogLevel {
    if (Object.hasOwn(envLog.components, component)) return envLog.components[component];
    if (envLog.global !== undefined) return envLog.global;
    if (Object.hasOwn(configComponents, component)) return configComponents[component];
    return configGlobal;
  }

  // The next free rotation index, found by probing journal.N.jsonl.gz upward so
  // a restart never clobbers an existing archive.
  function nextRotationIndex(): number {
    let n = 1;
    while (existsSync(path.join(runDir, `journal.${n}.jsonl.gz`))) n += 1;
    return n;
  }

  // After a write, if the active journal exceeds the retention budget, gzip it
  // to journal.N.jsonl.gz (real deflate) and start a fresh journal.jsonl.
  function rotateIfNeeded(): void {
    if (!Number.isFinite(maxBytes)) return;
    let size: number;
    try {
      size = statSync(journalPath).size;
    } catch {
      return;
    }
    if (size <= maxBytes) return;
    let content: Buffer;
    try {
      content = readFileSync(journalPath);
    } catch {
      return;
    }
    const archived = gzipSync(content);
    const index = nextRotationIndex();
    writeFileSync(path.join(runDir, `journal.${index}.jsonl.gz`), archived);
    writeFileSync(journalPath, "");
  }

  function log(
    level: LogLevel,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: Corr,
  ): void {
    const known = isKnownEvent(component, event);
    if (!known && !isProd) {
      throw new Error(
        `journal: refusing to write unknown event "${event}" under component "${component}" ` +
          "— it is not in the closed §7.4 event vocabulary (add it to core/journal-events.ts)",
      );
    }
    // In production an unknown event is retained on disk and surfaced through the
    // console sink rather than dropped (§7.4: never silently lose a record).
    const forced = !known && isProd;

    const rank = rankOf(level);
    const threshold = thresholdFor(component);
    const writeToFile = forced || rank <= rankOf(threshold) || rank <= ALWAYS_RANK;
    const toConsole = forced || rank <= CONSOLE_RANK;
    if (!writeToFile && !toConsole) return;

    seq += 1;
    const record: JournalRecord = {
      seq,
      ts: Date.now(),
      level,
      component,
      runId: corr.runId,
      event,
      data,
    };
    if (corr.itemId !== undefined) record.itemId = corr.itemId;
    if (corr.sessionID !== undefined) record.sessionID = corr.sessionID;

    let line = JSON.stringify(record);
    if (Buffer.byteLength(line, "utf8") + 1 > MAX_RECORD_BYTES) {
      shrinkToFit(record);
      line = JSON.stringify(record);
    }

    if (writeToFile) {
      appendFileSync(journalPath, line + "\n");
      rotateIfNeeded();
    }
    if (toConsole && consoleFn !== undefined) consoleFn(record);
  }

  // Every log() persists synchronously via appendFileSync, so no in-memory
  // buffer ever accumulates; flushSync is the explicit, named barrier callers
  // use before reading the journal back, and has nothing further to force.
  function flushSync(): void {
    return;
  }

  return { log, flushSync };
}
