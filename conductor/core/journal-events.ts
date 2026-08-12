// conductor/core/journal-events.ts — Task 2.1 (core half): the closed,
// per-component event-name vocabulary plus the two level defaults from §7.1
// (plan lines 1909-1945). Pure (G3): the only import is the core LogLevel type;
// no I/O modules, no runtime globals, no network, no wall clock.
//
// This file is where the §7.4 debuggability law is rooted (plan lines 1956-1963):
// "logs you can't grep by name are logs you can't debug", so every event name an
// adapter is allowed to emit is enumerated here once, and `isKnownEvent` is the
// check the journal adapter runs on every write — an unlisted event is caught at
// its source rather than leaking into the journal under a name no test can grep.

import type { LogLevel } from "./types.ts";

// The eight §7.1 components (plan lines 1911-1914). An `as const` array is the
// single source for both the union type and the EVENTS keys (per G2: no `enum`).
export const COMPONENTS = [
  "fsm",
  "gates",
  "fanout",
  "evidence",
  "continuation",
  "inject",
  "router-client",
  "state",
] as const;
export type Component = (typeof COMPONENTS)[number];

// The closed event vocabulary, one non-empty list per component, derived from
// the plan's event usage across §2, §3 and §7. Adapters emit only these names;
// widening the vocabulary means adding a name here (and a test that greps for
// it), never inventing one at the call site.
export const EVENTS: Record<Component, readonly string[]> = {
  // §3.1 / §7.4: FSM transitions and refusals.
  fsm: ["transition", "refusal", "guard-reject", "invalid-transition"],
  // §3.6 / §7.2 / §7.4: gate decisions (with their input snapshot at debug),
  // the §2.8 gate-crash anomaly, and the budgeted override hatch.
  gates: ["deny", "allow", "snapshot", "gate-crash", "override-granted"],
  // §7.2 gives fanout/subsession.dispatched as the record-shape example; the
  // rest are the sub-session lifecycle the fan-out engine drives.
  fanout: [
    "subsession.dispatched",
    "subsession.hold",
    "subsession.complete",
    "subsession.retry",
    "subsession.abort",
  ],
  // §2.6 evidence kinds: red / green / verify.
  evidence: ["red", "green", "verify"],
  // §2.9 / §3.7 / §7.4: continuation re-prompts, idle detection, disengagement.
  continuation: ["reprompt", "idle", "disengage"],
  // §6 injection: the system-prompt append the plugin performs.
  inject: ["system-append"],
  // §4.4 router-facing client: request/response tagging and failover.
  "router-client": ["request", "response", "failover", "retry"],
  // §2.3 / §4.1 state store: run creation, lock lifecycle, item mutations.
  state: ["run.created", "lock.acquired", "lock.released", "lock.stale-break", "item.updated"],
};

// True iff `event` is listed under a KNOWN `component`. An unknown component or
// an unlisted event both return false (§7.4) — the two ways an adapter can log a
// name that no replay tool can find.
export function isKnownEvent(component: string, event: string): boolean {
  if (!Object.hasOwn(EVENTS, component)) return false;
  const list = (EVENTS as Record<string, readonly string[]>)[component];
  return list.includes(event);
}

// §7.1 sink table: the journal's global default level and the console sink's
// (stderr) default level.
export const DEFAULT_LEVEL: LogLevel = "info";
export const DEFAULT_CONSOLE_LEVEL: LogLevel = "warn";
