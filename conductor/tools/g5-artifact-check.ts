// conductor/tools/g5-artifact-check.ts — the check that makes the G5 artifact
// impossible to satisfy with two identical commands (G5-SG-3).
//
// WHY THIS FILE EXISTS. The first G5 record looked complete: two arms, two
// transcripts, a PASS. Its two arms were the SAME `node --test … e2e.test.ts`
// invocation prefixed with two different values of one environment variable —
// the openai base-URL variable named in the phase-12 findings — and a repo-wide
// grep for that variable returned ZERO hits. No source file read it, so the two
// arms were the same command run twice and the equivalence they recorded was a
// tautology. Nothing in the artifact's own shape objected, which is the defect
// this module closes.
//
// (That variable's name is never written CONTIGUOUSLY anywhere under the trees
// this file scans — here or in the driver — because a mention would itself make
// the "no source reads it" test pass. The tests assemble it, the purity guard's
// convention.)
//
// The rules, applied to the artifact's own text:
//   1. both arms are recorded, verbatim, under fixed markers;
//   2. they are not byte-identical;
//   3. if they differ ONLY in environment assignments, at least one differing
//      variable NAME must appear in a source file the repo actually ships — a
//      difference no code reads is not a difference;
//   4. the WITH arm's report carries the metrics summary THE ROUTER SERVED
//      (deep-equal to what the driver read off the live router), so the router
//      was contacted rather than merely alive;
//   5. the WITHOUT arm's report carries no summary at all — the arms observably
//      differed in the one place they are allowed to (G5-SG-2).
//
// Used by conductor/tools/g5-equivalence.ts when it writes the artifact, and by
// conductor/tests/g5-artifact.test.ts on every run of the node suite, so a later
// hand-edit that flattens the two arms back into one fails the gate.

import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

export const G5_MARKERS = {
  armWith: "ARM-WITH-ROUTER-CMD",
  armWithout: "ARM-WITHOUT-ROUTER-CMD",
  routerServed: "ROUTER-SERVED-SUMMARY",
  reportWith: "REPORT-METRICS-WITH",
  reportWithout: "REPORT-METRICS-WITHOUT",
} as const;

// The trees a repo-read variable could legitimately live in. node_modules and
// build output are excluded: a variable "read" only by a dependency is not read
// by this project.
const SOURCE_DIRS = [
  "conductor/core",
  "conductor/adapter",
  "conductor/plugin",
  "conductor/tools",
  "conductor/tests",
  "scripts",
];

export interface G5CommandShape {
  env: Array<{ name: string; value: string }>;
  argv: string[];
}

export interface G5CheckResult {
  ok: boolean;
  violations: string[];
  armWith: string | null;
  armWithout: string | null;
  differingEnvNames: string[];
  envNamesReadBySource: string[];
}

// A command line as `NAME=value NAME=value argv…`: leading assignments are the
// environment, everything from the first non-assignment token on is the argv.
export function splitCommand(command: string): G5CommandShape {
  const tokens = command.trim().split(/\s+/).filter((t) => t.length > 0);
  const env: Array<{ name: string; value: string }> = [];
  let i = 0;
  for (; i < tokens.length; i += 1) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(tokens[i] ?? "");
    if (match === null) break;
    env.push({ name: match[1] ?? "", value: match[2] ?? "" });
  }
  return { env, argv: tokens.slice(i) };
}

function markerValues(markdown: string, marker: string): string[] {
  const out: string[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(marker + ":")) continue;
    out.push(line.slice(marker.length + 1).trim());
  }
  return out;
}

function listSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full);
      else files.push(full);
    }
  };
  for (const rel of SOURCE_DIRS) walk(path.join(repoRoot, rel));
  return files;
}

// Which of these variable names any shipped source file mentions. This is the
// grep the first G5 record would have failed.
export function envNamesReadBySource(names: string[], repoRoot: string): string[] {
  if (names.length === 0) return [];
  const found = new Set<string>();
  for (const file of listSourceFiles(repoRoot)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const name of names) {
      if (text.includes(name)) found.add(name);
    }
  }
  return [...found].sort();
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

export function checkG5Artifact(markdown: string, repoRoot: string): G5CheckResult {
  const violations: string[] = [];
  const single = (marker: string): string | null => {
    const values = markerValues(markdown, marker);
    if (values.length === 0) {
      violations.push(`the artifact carries no \`${marker}:\` line — the record must state it, not imply it`);
      return null;
    }
    if (values.length > 1) {
      violations.push(`the artifact carries ${String(values.length)} \`${marker}:\` lines — exactly one is readable as the record`);
      return null;
    }
    return values[0] ?? null;
  };

  const armWith = single(G5_MARKERS.armWith);
  const armWithout = single(G5_MARKERS.armWithout);
  const routerServedRaw = single(G5_MARKERS.routerServed);
  const reportWithRaw = single(G5_MARKERS.reportWith);
  const reportWithoutRaw = single(G5_MARKERS.reportWithout);

  let differing: string[] = [];
  let read: string[] = [];

  if (armWith !== null && armWithout !== null) {
    if (armWith === armWithout) {
      violations.push(
        "the two arms are BYTE-IDENTICAL commands — the same command run twice cannot compare a run with the router against a run without it",
      );
    } else {
      const a = splitCommand(armWith);
      const b = splitCommand(armWithout);
      const names = new Set<string>();
      for (const entry of a.env) {
        const other = b.env.find((e) => e.name === entry.name);
        if (other === undefined || other.value !== entry.value) names.add(entry.name);
      }
      for (const entry of b.env) {
        const other = a.env.find((e) => e.name === entry.name);
        if (other === undefined || other.value !== entry.value) names.add(entry.name);
      }
      differing = [...names].sort();
      read = envNamesReadBySource(differing, repoRoot);
      const argvDiffers = JSON.stringify(a.argv) !== JSON.stringify(b.argv);
      if (!argvDiffers && read.length === 0) {
        violations.push(
          `the arms run the SAME argv and differ only in ${JSON.stringify(differing)}, which no source file under ${JSON.stringify(SOURCE_DIRS)} reads — a variable nothing reads is not a difference, and that is exactly how the first G5 record's two arms were one command run twice`,
        );
      }
    }
  }

  const served = routerServedRaw === null ? null : parseJsonObject(routerServedRaw);
  const reportWith = reportWithRaw === null ? null : parseJsonObject(reportWithRaw);
  if (routerServedRaw !== null && served === null) {
    violations.push(`${G5_MARKERS.routerServed} is not a JSON object: ${routerServedRaw}`);
  }
  if (reportWithRaw !== null && reportWith === null) {
    violations.push(
      `${G5_MARKERS.reportWith} is not a JSON object (${reportWithRaw}) — the WITH arm must show a real MetricsSummary reaching the report, which is how the router is proved to have been CONTACTED rather than merely running`,
    );
  }
  if (served !== null && reportWith !== null && canonical(served) !== canonical(reportWith)) {
    violations.push(
      `the summary the router served (${canonical(served)}) is not the summary that reached the report (${canonical(reportWith)}) — the WITH arm's report did not come from that router`,
    );
  }

  if (reportWithoutRaw !== null && parseJsonObject(reportWithoutRaw) !== null) {
    violations.push(
      `${G5_MARKERS.reportWithout} is a MetricsSummary (${reportWithoutRaw}) — with nothing listening the report must carry none, and two arms that produced the same metrics were not two arms`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    armWith,
    armWithout,
    differingEnvNames: differing,
    envNamesReadBySource: read,
  };
}
