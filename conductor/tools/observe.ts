// conductor/tools/observe.ts — the read-only reader an observing agent watches a
// run through, and the bundle command that packages a finished one.
//
// READ-ONLY BY CONSTRUCTION, WHICH IS THE POINT. This is a separate process that
// opens files for reading and nothing else. It imports no handler, holds no store,
// takes no lock and registers no hook, so there is no code path by which an
// observer could perturb the run it is watching — a property a rule about being
// careful cannot deliver. The derivation itself is core/observation.ts, which is
// pure; everything here is file I/O and formatting.
//
// It also does not need the run to be finished. Every file it reads is appended
// or rewritten in place by the live plugin, so polling this against a running
// conductor is the intended use: that is what "watch a run in flight" means.
//
// A dev/observation-time script: node built-ins only, erasable-TypeScript clean,
// and side-effect-free on import — the CLI leg runs only when this file is the
// entry point.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as path from "node:path";

import {
  DEFAULT_PER_SLOT_CONTEXT_TOKENS,
  BREAKDOWN_THRESHOLDS,
  FOLLOW_START,
  crossedThresholds,
  deriveLiveConsole,
  deriveSnapshot,
  deriveStrainSignals,
  exchangeLines,
  humanMs,
  ledgerEntriesOf,
  nextFollowFrame,
  parseConcatenatedJson,
  refusalLine,
  stallBanner,
  turnLine,
  waitingLine,
} from "./observation.ts";
import type {
  FollowCursor,
  LedgerEntry,
  LiveConsole,
  ObservationInput,
  ObservedItem,
  ObservedQuestion,
  ObservedRecord,
  RunSnapshot,
  StrainSignals,
} from "./observation.ts";

// A missing or unreadable file yields the empty answer rather than throwing. An
// observer reading a live run WILL catch a file mid-write, and a reader that dies
// on that is a reader nobody can leave running.
function readJsonFile(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Parse a JSONL file, dropping any line that does not parse. A torn tail line is
// the normal state of a file being appended to, not an error.
export function readJsonl(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // A line being written right now. The next poll will read it whole.
    }
  }
  return out;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rec(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Every item record in a run directory, in id order. */
export function readItems(runDir: string): ObservedItem[] {
  const dir = path.join(runDir, "items");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    // Present but unreadable — not a directory, or no permission. The head of
    // this file promises that costs the answer, not the process.
    return [];
  }
  const out: ObservedItem[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const parsed = readJsonFile(path.join(dir, entry));
    if (parsed === null) continue;
    const attempts = rec(parsed["attempts"]);
    out.push({
      id: str(parsed["id"], entry.replace(/\.json$/, "")),
      state: str(parsed["state"], "unknown"),
      blocked: parsed["blocked"] ?? null,
      deferred: parsed["deferred"] ?? null,
      taint: Array.isArray(parsed["taint"]) ? (parsed["taint"] as unknown[]) : [],
      attempts: { overridesUsed: num(attempts["overridesUsed"]) },
    });
  }
  return out;
}

/** The questions ledger's still-open entries. */
export function readOpenQuestions(runDir: string): ObservedQuestion[] {
  const out: ObservedQuestion[] = [];
  for (const record of readJsonl(path.join(runDir, "questions.jsonl"))) {
    const answered = record["answer"] !== undefined && record["answer"] !== null;
    if (answered) continue;
    out.push({
      id: str(record["id"]),
      question: str(record["question"]),
      answerPath: str(record["answerPath"]),
    });
  }
  return out;
}

/** The trees a live verify has frozen, by marker file presence. */
export function readLiveVerifyTrees(runDir: string): string[] {
  const dir = path.join(runDir, "verify");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((entry) => entry.endsWith(".marker") || entry.endsWith(".json"))
      .map((entry) => entry.replace(/\.(marker|json)$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export interface ObservationReport {
  runId: string;
  snapshot: RunSnapshot;
  signals: StrainSignals;
  crossed: readonly string[];
  thresholds: typeof BREAKDOWN_THRESHOLDS;
}

/**
 * Read one run directory and derive everything an observer needs from it.
 *
 * `reviewMaxRounds` and `perSlotContextTokens` are the two facts that live
 * outside the run directory. They are parameters rather than lookups so this
 * function reads exactly one directory and nothing else — an observer pointed at
 * an archived run should not need that run's config to still be installed.
 */
export function observeRunDir(
  runDir: string,
  options: { reviewMaxRounds?: number; perSlotContextTokens?: number; tailEvents?: number } = {},
): ObservationReport {
  const runFile = readJsonFile(path.join(runDir, "run.json")) ?? {};
  const counters = rec(runFile["counters"]);
  const classification = rec(runFile["classification"]);
  const input: ObservationInput = {
    runId: str(runFile["runId"], path.basename(runDir)),
    run: {
      state: str(runFile["state"], "unknown"),
      classification:
        str(classification["kind"]).length > 0 ? { kind: str(classification["kind"]) } : null,
      stop: runFile["stop"] ?? null,
      counters: { overridesUsed: num(counters["overridesUsed"]) },
    },
    items: readItems(runDir),
    openQuestions: readOpenQuestions(runDir),
    liveVerifyTrees: readLiveVerifyTrees(runDir),
    journal: readRunRecords(runDir),
    // conductor/adapter/config-io.ts DEFAULT_CONFIG.workflow.reviewMaxRounds.
    reviewMaxRounds: options.reviewMaxRounds ?? 3,
    perSlotContextTokens: options.perSlotContextTokens ?? DEFAULT_PER_SLOT_CONTEXT_TOKENS,
    ...(options.tailEvents === undefined ? {} : { tailEvents: options.tailEvents }),
  };

  const signals = deriveStrainSignals(input);
  return {
    runId: input.runId,
    snapshot: deriveSnapshot(input),
    signals,
    crossed: crossedThresholds(signals),
    thresholds: BREAKDOWN_THRESHOLDS,
  };
}

/**
 * The human-readable form: where the run is, why, and what is straining.
 *
 * Written for an observing model's first thirty seconds. It leads with position
 * and blockage because those are what decide whether anything else matters.
 */
export function renderReport(report: ObservationReport): string {
  const lines: string[] = [];
  const s = report.snapshot;
  lines.push(`run ${report.runId} — ${s.runState}${s.stopped ? " (STOPPED)" : ""}`);
  lines.push(`classification: ${s.classification ?? "unclassified"}`);

  lines.push("");
  lines.push("items");
  if (s.items.length === 0) lines.push("  (none)");
  for (const item of s.items) {
    const marks: string[] = [];
    if (item.blocked !== null && item.blocked !== undefined) marks.push(`blocked: ${String(item.blocked)}`);
    if (item.tainted) marks.push("tainted");
    if (item.overridesUsed > 0) marks.push(`overrides ${String(item.overridesUsed)}`);
    lines.push(`  ${item.id.padEnd(12)} ${item.state.padEnd(12)} ${marks.join("; ")}`);
  }

  lines.push("");
  lines.push(`in flight: ${s.inFlight.length === 0 ? "(none)" : ""}`);
  for (const session of s.inFlight) {
    lines.push(`  ${session.role} on ${session.itemId} (${session.sessionID})`);
  }

  if (s.liveVerifyTrees.length > 0) {
    lines.push("");
    lines.push(`frozen trees (a write-capable job here is HELD, not hung): ${s.liveVerifyTrees.join(", ")}`);
  }

  if (s.openQuestions.length > 0) {
    lines.push("");
    lines.push("open questions — the run is waiting on a human for these");
    for (const question of s.openQuestions) {
      lines.push(`  ${question.id}: ${question.question}`);
      lines.push(`    answer at: ${question.answerPath}`);
    }
  }

  const g = report.signals;
  lines.push("");
  lines.push("strain");
  lines.push(`  denies ${String(g.denies)} / allowed ${String(g.allowedCalls)} (rate ${g.denyRate.toFixed(2)})`);
  for (const [gate, count] of Object.entries(g.deniesByGate)) {
    lines.push(`    ${gate}: ${String(count)}`);
  }
  lines.push(`  overrides minted ${String(g.overridesMinted)} / spent ${String(g.overridesSpent)}`);
  lines.push(`  waves ${String(g.waves)} (${String(g.serializedWaves)} carried one job)`);
  lines.push(`  receipt retries ${String(g.receiptRetries)}, aborts ${String(g.subsessionAborts)}, holds ${String(g.subsessionHolds)}`);
  lines.push(`  idle ${String(g.idleContinuations)}, reprompts ${String(g.reprompts)}, disengages ${String(g.disengages)}`);
  lines.push(`  verify ${String(g.verifyRuns)}, red ${String(g.redEvents)}, green ${String(g.greenEvents)}`);
  lines.push(`  gate crashes ${String(g.gateCrashes)}`);
  lines.push(
    `  largest brief ${String(g.largestBriefChars)} chars ` +
      `(${(g.largestBriefWindowFraction * 100).toFixed(0)}% of the effective per-slot window)`,
  );

  lines.push("");
  if (report.crossed.length === 0) {
    lines.push("no declared threshold crossed");
  } else {
    lines.push("THRESHOLDS CROSSED — each is a finding to investigate, never a stop:");
    for (const name of report.crossed) {
      lines.push(`  ${name} (threshold ${String((report.thresholds as Record<string, number>)[name])})`);
    }
  }

  if (g.allowedCalls === 0 && g.denies === 0) {
    lines.push("");
    lines.push(
      "NOTE: no gate decisions are recorded at all. An allowed read is journaled at DEBUG, " +
        "so a run gathered at the default logging.level of info shows denies and network " +
        "allows only. Re-run at debug if the question is what this session reached.",
    );
  }

  return lines.join("\n");
}

// The files a bundle copies out of a run directory, in the order an observer
// reads them. A file that is absent is simply not in the bundle: a run that never
// surfaced a question has no questions ledger, and inventing an empty one would
// tell the reader something false.
const BUNDLE_FILES: readonly string[] = [
  "run.json",
  "queue.json",
  "journal.jsonl",
  "questions.jsonl",
  "decisions.jsonl",
  "anomalies.jsonl",
  "evidence.jsonl",
];

/**
 * Package one run into a directory an observing model can be handed whole.
 *
 * Copies rather than references, because the point of a bundle is that it
 * survives the run directory being pruned by retention.
 */
export function writeBundle(runDir: string, outDir: string, report: ObservationReport): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];

  for (const name of BUNDLE_FILES) {
    const source = path.join(runDir, name);
    if (!existsSync(source)) continue;
    try {
      writeFileSync(path.join(outDir, name), readFileSync(source));
      written.push(name);
    } catch {
      // An unreadable source file is recorded by its absence from the manifest.
    }
  }

  const itemsDir = path.join(runDir, "items");
  if (existsSync(itemsDir) && statSync(itemsDir).isDirectory()) {
    const outItems = path.join(outDir, "items");
    mkdirSync(outItems, { recursive: true });
    for (const entry of readdirSync(itemsDir).sort()) {
      try {
        writeFileSync(path.join(outItems, entry), readFileSync(path.join(itemsDir, entry)));
        written.push(path.join("items", entry));
      } catch {
        // As above.
      }
    }
  }

  writeFileSync(path.join(outDir, "observation.json"), JSON.stringify(report, null, 2));
  written.push("observation.json");
  writeFileSync(path.join(outDir, "observation.txt"), renderReport(report) + "\n");
  written.push("observation.txt");

  return written;
}

// ---------------------------------------------------------------------------
// The live console: reading a run WHILE it runs.
// ---------------------------------------------------------------------------

// The router's ledger, wherever the operator keeps it. Optional by construction:
// a console that dies because a cost file is missing is a console nobody leaves
// running.
export const DEFAULT_LEDGER_PATH = ".data/router/metrics.jsonl";

// How often --follow re-reads. Short enough that a tool call appears while the
// watcher is still looking at the request that made it.
export const DEFAULT_FOLLOW_INTERVAL_MS = 2000;

// How often a stalled run repeats its banner, so a terminal nobody has touched
// for twenty minutes still shows the clock advancing.
const STALL_HEARTBEAT_MS = 15_000;

/**
 * The whole journal of a run directory, as ONE text: every rotated archive in
 * ascending order, then the active file.
 *
 * adapter/journal.ts rotateIfNeeded gzips the active journal to
 * `journal.N.jsonl.gz` and truncates it, so a reader that opens only
 * `journal.jsonl` renumbers turn #1 onto the middle of the run, re-bases every
 * `t+` offset against the rotation, and loses the run.created record whose `root`
 * the ledger join keys on — silently, with a full-looking console on screen.
 * replay.ts reads the archives for the same reason.
 */
function journalText(runDir: string): { text: string; sources: number } {
  const parts: string[] = [];
  const archives: Array<{ index: number; file: string }> = [];
  let names: string[];
  try {
    names = readdirSync(runDir);
  } catch {
    names = [];
  }
  for (const name of names) {
    const match = /^journal\.(\d+)\.jsonl\.gz$/.exec(name);
    if (match !== null) archives.push({ index: Number(match[1]), file: path.join(runDir, name) });
  }
  archives.sort((a, b) => a.index - b.index);
  for (const archive of archives) {
    try {
      parts.push(gunzipSync(readFileSync(archive.file)).toString("utf8"));
    } catch {
      // A rotation caught mid-write, or an archive this reader cannot open. It
      // costs that archive's records; the rest of the run still reads.
    }
  }
  const active = path.join(runDir, "journal.jsonl");
  if (existsSync(active)) {
    try {
      parts.push(readFileSync(active, "utf8"));
    } catch {
      /* being written right now; the next poll reads it */
    }
  }
  return { text: parts.join("\n"), sources: parts.length };
}

/**
 * Every journal record in a run directory, archives included.
 *
 * Reads BOTH on-disk shapes: the compact line-per-record the writer produces and
 * the pretty-printed concatenated objects the preserved evidence and the router's
 * own ledger are stored in. A torn tail — the normal state of a file being
 * appended to right now — costs that record and nothing else.
 */
export function readRunRecords(runDir: string): ObservedRecord[] {
  return parseConcatenatedJson(journalText(runDir).text).values as ObservedRecord[];
}

/** The router ledger, or [] when there is not one to read. */
export function readLedgerFile(file: string): LedgerEntry[] {
  if (!existsSync(file)) return [];
  try {
    return ledgerEntriesOf(parseConcatenatedJson(readFileSync(file, "utf8")).values);
  } catch {
    return [];
  }
}

export interface ConsoleMeta {
  runId: string;
  runState: string;
  snapshot?: RunSnapshot;
  ledgerPath?: string;
}

/**
 * The whole console as one screen of text.
 *
 * Ordered by what decides whether anything else matters: the stall clock first,
 * because a watcher must be able to see "nothing has advanced in twenty minutes"
 * without reading a single timeline row; then the totals that say where the time
 * and the tokens went; then refusals, which are the failures a timeline of allows
 * hides; then the turns and the sub-session exchanges.
 */
export function renderConsole(view: LiveConsole, meta: ConsoleMeta): string {
  const lines: string[] = [];
  lines.push(`== LIVE CONSOLE ${meta.runId} — ${meta.runState} ==`);
  lines.push(stallBanner(view.stall));
  if (view.waitingOn !== null) lines.push(waitingLine(view.waitingOn));

  const elapsed =
    view.firstTsMs === null || view.latestTsMs === null ? null : view.latestTsMs - view.firstTsMs;
  // A count nothing measured is printed as (unrecorded), never as 0: a confident
  // zero beside a dead column reads as "the model did what it was told".
  const mismatches = view.recommendationsRecorded === 0 ? "(unrecorded)" : String(view.mismatchCount);
  lines.push(
    `elapsed ${humanMs(elapsed)}  turns ${String(view.turns.length)}  ` +
      `mismatches ${mismatches}  refusals ${String(view.refusalCount)}  ` +
      `sub-sessions ${String(view.exchanges.length)}`,
  );
  const costCaveat = view.ledgerJoined
    ? view.ledgerPartialRoles.length === 0
      ? ""
      : `  (PARTIAL — ${view.ledgerPartialRoles.join(", ")}: the router ledger holds fewer ` +
        "group-tagged requests than these roles took turns, so their cost is withheld rather " +
        "than shifted onto the wrong rows)"
    : "  (no router ledger joined — no cost column)";
  lines.push(
    `COMPACTION suspected ${String(view.compactionCount)} costing ${humanMs(view.compactionMs)}  ` +
      `tokens ${String(view.promptTokensTotal)} in / ${String(view.completionTokensTotal)} out` +
      costCaveat,
  );
  if (view.malformedRecords > 0) {
    lines.push(
      `malformed journal regions skipped: ${String(view.malformedRecords)} ` +
        `(${String(view.malformedBytes)} bytes)`,
    );
  }

  const snapshot = meta.snapshot;
  if (snapshot !== undefined) {
    const items = snapshot.items.map((item) => `${item.id}:${item.state}`).join(" ");
    lines.push(`items ${items.length === 0 ? "(none)" : items}`);
    for (const session of snapshot.inFlight) {
      lines.push(`in flight: ${session.role} on ${session.itemId} (${session.sessionID})`);
    }
    for (const question of snapshot.openQuestions) {
      lines.push(`OPEN QUESTION ${question.id}: ${question.question}`);
      lines.push(`  answer at: ${question.answerPath}`);
    }
  }

  if (view.turns.length > 0 && view.recommendationsRecorded === 0) {
    lines.push(
      "NOTE: no turn in this journal records a recommended next tool, so the recommended-vs-actual " +
        "column reads (unrecorded) and the mismatch count is not a zero. The delivery receipt carries " +
        "`recommended` (plugin/index.ts, inject/system-append); a journal without it was written " +
        "before that field existed.",
    );
  }

  lines.push("");
  lines.push("-- refusals --");
  if (view.refusals.length === 0) lines.push("  (none)");
  for (const refusal of view.refusals) lines.push(`  ${refusalLine(refusal)}`);

  lines.push("");
  lines.push("-- turns --");
  if (view.turns.length === 0) lines.push("  (no request has been built yet)");
  for (const turn of view.turns) lines.push(`  ${turnLine(turn)}`);

  lines.push("");
  lines.push("-- sub-sessions --");
  if (view.exchanges.length === 0) lines.push("  (none dispatched)");
  for (const exchange of view.exchanges) {
    for (const line of exchangeLines(exchange)) lines.push(`  ${line}`);
  }

  return lines.join("\n");
}

// One live view, assembled from the run directory and the optional ledger.
//
// `nowMs` is undefined for a one-shot render and the wall clock for a follow: a
// finished run read back tomorrow must measure its stall to its own last record,
// or every archived run reads as stalled by however long ago it ran.
function currentView(runDir: string, ledgerPath: string, nowMs?: number): LiveConsole {
  const parsed = parseConcatenatedJson(journalText(runDir).text);
  return deriveLiveConsole({
    records: parsed.values as ObservedRecord[],
    ledger: readLedgerFile(ledgerPath),
    ...(nowMs === undefined ? {} : { nowMs }),
    malformedRecords: parsed.malformed,
    malformedBytes: parsed.malformedBytes,
  });
}

function runMeta(runDir: string): { runId: string; runState: string } {
  const runFile = readJsonFile(path.join(runDir, "run.json")) ?? {};
  return {
    runId: str(runFile["runId"], path.basename(runDir)),
    runState: str(runFile["state"], "unknown"),
  };
}

export interface FollowOptions {
  intervalMs: number;
  ledgerPath: string;
  write: (text: string) => void;
  now: () => number;
}

/**
 * Tail a run journal as it grows, rendering rows as they arrive.
 *
 * An APPEND-ONLY stream rather than a repainted screen: each row is printed once,
 * so the scrollback is the run's history and piping it to a file yields a log. The
 * stall banner repeats on a heartbeat even when nothing arrives, because a run
 * that has stopped producing records is exactly the case a watcher most needs to
 * see, and it is the one case where a silent console would say nothing at all.
 *
 * Returns a stop function. The clock and the sink are parameters so a caller can
 * drive it without a terminal.
 */
export function followRun(runDir: string, options: FollowOptions): () => void {
  let cursor: FollowCursor = FOLLOW_START;
  let lastBannerAt = 0;
  let lastLevel = "";
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    const now = options.now();
    const view = currentView(runDir, options.ledgerPath, now);
    const frame = nextFollowFrame(view, cursor);
    cursor = frame.cursor;
    if (frame.text.length > 0) options.write(frame.text);
    const dueForHeartbeat = now - lastBannerAt >= STALL_HEARTBEAT_MS;
    const escalated = view.stall.level !== lastLevel;
    // Escalation and the heartbeat, and NOT "this frame had content": a banner
    // between nearly every row is not the one line a watcher reads from across
    // the room, and a run producing rows is a run they can already see is alive.
    if (view.stall.level !== "ok" && (escalated || dueForHeartbeat)) {
      const waiting = view.waitingOn;
      options.write(
        `${stallBanner(view.stall)}\n` + (waiting === null ? "" : `  ${waitingLine(waiting)}\n`),
      );
      lastBannerAt = now;
    }
    lastLevel = view.stall.level;
  };

  tick();
  // The timer is deliberately NOT unref'd: a tail loop whose whole purpose is to
  // keep a terminal open must keep the process open too, and the caller ends it
  // by calling the returned stop.
  const timer = setInterval(tick, options.intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ---------------------------------------------------------------------------
// CLI. Runs only when this file is the entry point.
// ---------------------------------------------------------------------------

// main's answer when the process must stay alive rather than exit: --follow ends
// when the operator ends it, not when main returns.
const KEEP_RUNNING = -1;

// The value of a flag given as `--flag value`, or null.
function flagValue(argv: readonly string[], name: string): string | null {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  const value = argv[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function main(argv: readonly string[]): number {
  const runDir = argv[0];
  if (runDir === undefined || runDir.length === 0 || runDir.startsWith("--")) {
    process.stderr.write(
      "usage: observe.ts <run-dir> [--json] [--bundle <out-dir>]\n" +
        "                  [--console] [--follow] [--interval <ms>] [--ledger <metrics.jsonl>]\n" +
        "  <run-dir> is .conductor/runs/<runId> — a live one is fine, this only reads.\n" +
        "  --console renders the live console once; --follow tails it as the run grows.\n",
    );
    return 2;
  }
  if (!existsSync(runDir)) {
    process.stderr.write(`observe: no such run directory: ${runDir}\n`);
    return 2;
  }

  const ledgerPath = flagValue(argv, "--ledger") ?? DEFAULT_LEDGER_PATH;

  if (argv.includes("--follow")) {
    const given = flagValue(argv, "--interval");
    const interval = given === null ? DEFAULT_FOLLOW_INTERVAL_MS : Number(given);
    if (!Number.isFinite(interval) || interval <= 0) {
      process.stderr.write(`observe: --interval needs a positive number of milliseconds\n`);
      return 2;
    }
    const meta = runMeta(runDir);
    process.stdout.write(
      `== FOLLOWING ${meta.runId} (${runDir}) every ${String(interval)}ms — ctrl-C to stop ==\n` +
        `ledger: ${existsSync(ledgerPath) ? ledgerPath : `${ledgerPath} (absent — no cost column)`}\n`,
    );
    const stop = followRun(runDir, {
      intervalMs: interval,
      ledgerPath,
      write: (text) => process.stdout.write(text),
      now: () => Date.now(),
    });
    const finish = (): void => {
      stop();
      process.exit(0);
    };
    process.on("SIGINT", finish);
    process.on("SIGTERM", finish);
    return KEEP_RUNNING;
  }

  if (argv.includes("--console")) {
    const report = observeRunDir(runDir);
    const view = currentView(runDir, ledgerPath);
    process.stdout.write(
      renderConsole(view, {
        runId: report.runId,
        runState: report.snapshot.runState,
        snapshot: report.snapshot,
        ledgerPath,
      }) + "\n",
    );
    return 0;
  }

  const report = observeRunDir(runDir);
  const bundleAt = argv.indexOf("--bundle");
  if (bundleAt !== -1) {
    const outDir = argv[bundleAt + 1];
    if (outDir === undefined || outDir.length === 0) {
      process.stderr.write("observe: --bundle needs an output directory\n");
      return 2;
    }
    const written = writeBundle(runDir, outDir, report);
    process.stdout.write(`bundled ${String(written.length)} file(s) into ${outDir}\n`);
    return 0;
  }

  process.stdout.write(
    (argv.includes("--json") ? JSON.stringify(report, null, 2) : renderReport(report)) + "\n",
  );
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("observe.ts")) {
  const code = main(process.argv.slice(2));
  if (code !== KEEP_RUNNING) process.exit(code);
}
