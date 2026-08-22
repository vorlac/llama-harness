# date-range-scheduler

Recurring-event expansion with real time zones, and booking-conflict detection
on top of it. No dependencies: the Node standard library and `Intl` only.

## Layout

| Path | Contents |
|---|---|
| `src/types.ts` | Shared value types: civil date-times, rules, events, occurrences, intervals |
| `src/civil.ts` | Proleptic Gregorian calendar arithmetic; no zone awareness |
| `src/timezone.ts` | IANA offsets via `Intl`, and the two conversions across them |
| `src/recurrence.ts` | Rule validation and expansion into occurrences |
| `src/overlap.ts` | Half-open interval algebra, free/busy, conflict detection |
| `src/schedule.ts` | Whole-calendar operations over many events |
| `src/cli.ts` | Demo entry point: expand a schedule file and print it |
| `docs/SEMANTICS.md` | The behavioural reference for everything above |
| `test/` | `node:test` suite, one file per module |
| `BUGS.md` | Four field reports open against this version |
| `data/sample-schedule.json` | Input for the demo |

## Running it

```sh
bash build.sh                       # load every module; nothing to compile
bash run.sh                         # expand data/sample-schedule.json and print it
bash run.sh path/to/schedule.json   # expand some other schedule file
bash test.sh                        # run the whole suite
node --test 'test/recurrence.test.ts'   # run one file
```

Node 22.18 or newer is required: the sources are TypeScript and are executed
directly by Node's type stripping, so there is no build step and no toolchain
to install.

## Concepts

A `CivilDateTime` is a wall-clock reading with no zone. An instant is
milliseconds since the epoch. An `EventDefinition` stores a local start, a
duration, a zone, and an optional `RecurrenceRule`; expanding it produces
`Occurrence` values that carry both the local start and the resolved instants.
`docs/SEMANTICS.md` states the rules the expansion follows — DST resolution,
short-month clamping, `COUNT`/`UNTIL` bounds, exception dates, and the
half-open interval convention used by conflict detection.

## Example

```ts
import { expandEvent } from "./src/recurrence.ts";

const occurrences = expandEvent({
  id: "standup",
  timeZone: "America/New_York",
  start: { year: 2026, month: 3, day: 2, hour: 9, minute: 15, second: 0 },
  durationMinutes: 15,
  resource: "room-atlas",
  recurrence: { frequency: "WEEKLY", byDay: ["MO", "TU", "WE", "TH", "FR"], count: 10 },
});
```
