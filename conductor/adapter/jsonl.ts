// conductor/adapter/jsonl.ts — GAP-024: the ONE tolerant reader every .jsonl
// ledger in .conductor/ is read through.
//
// An ADAPTER (G14): node:fs only, no clock, no subprocess, no single-runtime API.
//
// Five ledgers (journal, evidence, questions, decisions, publish-batch) are
// appended line-at-a-time by a process that can be killed mid-write, so every one
// of them can hold a TORN final line. Each reader used to decide for itself what
// to do about that, and the decisions disagreed: the journal and the evidence
// ledger healed, the question ledger threw a raw SyntaxError — which made a run
// unclosable exactly post-crash, since the status tool and the stop-report writer
// both read questions (ISSUE-101). The rule is not restated per ledger here; it is
// implemented once:
//
//   a line that does not parse is SKIPPED and COUNTED.
//
// Skipped, because a crash artifact must never wedge a reader that exists to
// describe the crash. Counted, because "we could not read part of this ledger" is
// itself a fact some callers must act on — capturedRedOf treats an unreadable line
// as proof that it cannot know whether something newer ran, and forces `stale`
// rather than handing the critics a red the tree may have moved past.
//
// A leading UTF-8 BOM is stripped: conductor writes none, but an editor that
// touched a ledger by hand may have added one, and a BOM must not turn the whole
// file into one torn line.

import { existsSync, readFileSync } from "node:fs";

export interface TolerantRead<T> {
  /** Every line that parsed, in file order. */
  records: T[];
  /** How many lines did NOT parse (a crash's torn tail, a hand-edit's damage). */
  torn: number;
}

/** Read `filePath`'s JSON lines, skipping and counting the ones that do not parse. */
export function readJsonlTolerant<T>(filePath: string): TolerantRead<T> {
  if (!existsSync(filePath)) return { records: [], torn: 0 };
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    // An unreadable file is EMPTY to every caller, never a throw: a reader whose
    // job is to describe a broken run must survive a broken file.
    return { records: [], torn: 0 };
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const records: T[] = [];
  let torn = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch {
      torn += 1;
    }
  }
  return { records, torn };
}
