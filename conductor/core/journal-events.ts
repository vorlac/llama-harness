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
  // §2.3 / §4.1 state store: run creation, lock lifecycle, item mutations, the
  // §3.2 chat.message route of a prompt arriving during a live run (plan line 1074),
  // and the §2.7 decision/deferral ledger append the Phase-9 stage tools emit
  // (§7.4 observability widening: a decide/defer records no run/item state, so it
  // owns its own grep-able name rather than borrowing item.updated).
  //
  // The last four follow the SAME rule, each for a fact no other name states
  // truthfully (see the widening note at the foot of this file):
  //   lock.contended    — §4.1: the lock was NOT acquired because a live foreign
  //                       writer holds it, so this session drops to read-only.
  //   question.surfaced — a §2.11 question-ledger append that changes no item
  //                       state (the decision.recorded case, one ledger over).
  //   run.stop-report   — §2.9: the terminal artifact was written for a run whose
  //                       stop some OTHER component already recorded.
  //   hook.failed       — §3.5/§3.2: a conductor opencode hook could not do its
  //                       conductor-side work (the workspace would not open, or
  //                       the chat.message body threw). G5 fail-soft swallows the
  //                       throw so the user's session survives, which makes this
  //                       record the ONLY trace of it; data.hook names the hook.
  //                       No gate/fsm/state name states that fact — the call was
  //                       not adjudicated, no transition was attempted, and
  //                       nothing was persisted.
  state: [
    "run.created",
    "lock.acquired",
    "lock.released",
    "lock.stale-break",
    "lock.contended",
    "item.updated",
    "user.midrun-prompt",
    "decision.recorded",
    "question.surfaced",
    "run.stop-report",
    "hook.failed",
  ],
};

// True iff `event` is listed under a KNOWN `component`. An unknown component or
// an unlisted event both return false (§7.4) — the two ways an adapter can log a
// name that no replay tool can find.
export function isKnownEvent(component: string, event: string): boolean {
  if (!Object.hasOwn(EVENTS, component)) return false;
  const list = (EVENTS as Record<string, readonly string[]>)[component];
  return list.includes(event);
}

// The widening rule, stated once so the next reader applies it the same way. A
// call site that needs a name NOT listed above has two honest options, in this
// order: (1) use an existing name that truthfully describes what happened —
// which is what the §3.6 override hatch does (its grant is `gates: override-granted`,
// the gate decision that spends the grant is `gates: allow`, and an over-budget
// refusal is `gates: deny`); or (2) add a name HERE, in the same commit as the
// call site and a test that greps for it, and only when option (1) would make the
// record lie. Borrowing a near-miss name is worse than widening: a record filed
// under someone else's name is a record no replay filter can trust (§7.4).
//
// §7.1 sink table: the journal's global default level and the console sink's
// (stderr) default level.
export const DEFAULT_LEVEL: LogLevel = "info";
export const DEFAULT_CONSOLE_LEVEL: LogLevel = "warn";
