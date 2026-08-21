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
import * as path from "node:path";

import {
  BREAKDOWN_THRESHOLDS,
  crossedThresholds,
  deriveSnapshot,
  deriveStrainSignals,
} from "./observation.ts";
import type {
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
  const out: ObservedItem[] = [];
  for (const entry of readdirSync(dir).sort()) {
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
    journal: readJsonl(path.join(runDir, "journal.jsonl")) as ObservedRecord[],
    // conductor/adapter/config-io.ts DEFAULT_CONFIG.workflow.reviewMaxRounds.
    reviewMaxRounds: options.reviewMaxRounds ?? 3,
    // scripts/conductor_wiring.py PER_SLOT_CONTEXT_TOKENS.
    perSlotContextTokens: options.perSlotContextTokens ?? 8192,
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
// CLI. Runs only when this file is the entry point.
// ---------------------------------------------------------------------------

function main(argv: readonly string[]): number {
  const runDir = argv[0];
  if (runDir === undefined || runDir.length === 0) {
    process.stderr.write(
      "usage: observe.ts <run-dir> [--json] [--bundle <out-dir>]\n" +
        "  <run-dir> is .conductor/runs/<runId> — a live one is fine, this only reads.\n",
    );
    return 2;
  }
  if (!existsSync(runDir)) {
    process.stderr.write(`observe: no such run directory: ${runDir}\n`);
    return 2;
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
  process.exit(main(process.argv.slice(2)));
}
