/**
 * Demo entry point: expand a schedule file over its window and print the
 * resulting calendar, the conflicts, and a summary.
 *
 *   node src/cli.ts [path/to/schedule.json]
 *
 * Defaults to data/sample-schedule.json next to this package.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatOffset, offsetAt } from "./timezone.ts";
import {
  buildSchedule,
  detectConflicts,
  formatOccurrence,
  parseEvents,
  summarizeSchedule,
} from "./schedule.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEDULE = join(HERE, "..", "data", "sample-schedule.json");

interface ScheduleFile {
  name?: string;
  window: { start: string; end: string };
  events: unknown;
}

function main(argv: string[]): number {
  const path = argv.length > 0 ? resolve(argv[0]) : DEFAULT_SCHEDULE;
  const file = JSON.parse(readFileSync(path, "utf8")) as ScheduleFile;

  const rangeStart = Date.parse(file.window.start);
  const rangeEnd = Date.parse(file.window.end);
  if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) {
    process.stderr.write(`window bounds are not ISO-8601 instants in ${path}\n`);
    return 1;
  }

  const events = parseEvents(file.events);
  const options = { rangeStart, rangeEnd };
  const occurrences = buildSchedule(events, options);
  const conflicts = detectConflicts(events, options);
  const summary = summarizeSchedule(events, options);

  process.stdout.write(`schedule: ${file.name ?? path}\n`);
  process.stdout.write(`window:   ${file.window.start} .. ${file.window.end}\n\n`);

  for (const occurrence of occurrences) {
    const offset = formatOffset(offsetAt(occurrence.startUtc, occurrence.timeZone));
    process.stdout.write(`  ${formatOccurrence(occurrence)} (UTC${offset})\n`);
  }

  process.stdout.write(`\nconflicts: ${conflicts.length}\n`);
  for (const conflict of conflicts) {
    process.stdout.write(
      `  ${conflict.resource}: ${conflict.first.eventId} vs ${conflict.second.eventId} ` +
        `(${conflict.overlapMinutes} min)\n`,
    );
  }

  process.stdout.write(
    `\nevents: ${summary.events}  occurrences: ${summary.occurrences}  ` +
      `booked minutes: ${summary.bookedMinutes}\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
