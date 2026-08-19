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

// The component names other tools (conductor/tools/replay.ts) match records
// against BY SYMBOL. Declared here as the single source (GAP-034 / ISSUE-131) and
// spliced into COMPONENTS below, so a rename moves in ONE place and every tool
// that imports the symbol moves with it — a renamed component can no longer blank
// a replay lane while the vocabulary claims reuse.
export const COMPONENT_FSM = "fsm";
export const COMPONENT_GATES = "gates";
export const COMPONENT_FANOUT = "fanout";

// The eight §7.1 components (plan lines 1911-1914). An `as const` array is the
// single source for both the union type and the EVENTS keys (per G2: no `enum`).
export const COMPONENTS = [
  COMPONENT_FSM,
  COMPONENT_GATES,
  COMPONENT_FANOUT,
  "evidence",
  "continuation",
  "inject",
  "router-client",
  "state",
] as const;
export type Component = (typeof COMPONENTS)[number];

// The event names other tools reference BY SYMBOL, declared once here and spliced
// into EVENTS below (GAP-034 / ISSUE-131). replay.ts imports these rather than
// restating the literals, so a name renamed here follows into every timeline it
// feeds instead of silently blanking one while a guard-test claims reuse.
export const FSM_TRANSITION = "transition";
export const FSM_GUARD_REJECT = "guard-reject";
export const GATES_DENY = "deny";
export const GATES_GATE_CRASH = "gate-crash";
export const FANOUT_DISPATCHED = "subsession.dispatched";
export const FANOUT_HOLD = "subsession.hold";
export const FANOUT_COMPLETE = "subsession.complete";
export const FANOUT_RETRY = "subsession.retry";
export const FANOUT_ABORT = "subsession.abort";

// The closed event vocabulary, one non-empty list per component, derived from
// the plan's event usage across §2, §3 and §7. Adapters emit only these names;
// widening the vocabulary means adding a name here (and a test that greps for
// it), never inventing one at the call site.
export const EVENTS: Record<Component, readonly string[]> = {
  // §3.1 / §7.4: FSM transitions and refusals.
  fsm: [FSM_TRANSITION, "refusal", FSM_GUARD_REJECT, "invalid-transition"],
  // §3.6 / §7.2 / §7.4: gate decisions (with their input snapshot at debug),
  // the §2.8 gate-crash anomaly, and the budgeted override hatch.
  gates: [GATES_DENY, "allow", "snapshot", GATES_GATE_CRASH, "override-granted"],
  // §7.2 gives fanout/subsession.dispatched as the record-shape example; the
  // rest are the sub-session lifecycle the fan-out engine drives.
  fanout: [
    FANOUT_DISPATCHED,
    FANOUT_HOLD,
    FANOUT_COMPLETE,
    FANOUT_RETRY,
    FANOUT_ABORT,
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
  // owns its own grep-able name rather than borrowing `item.updated`).
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
  //   `config.updated`  — §2.1/§3.4: conductor_setup wrote .conductor/config.json.
  //                       data.changes carries the reconfigure diff (the keys that
  //                       moved, with their prior and current values; empty on a
  //                       first setup, which
  //                       has nothing to diff against) and data.answers carries the
  //                       §2.1:622 values the call was answered with — including the
  //                       `acknowledgeNoTdd` word, which has no config field to land in
  //                       and would otherwise leave the one call that can turn the TDD
  //                       law off with no trace anywhere (GAP-015). Setup
  //                       precedes every run, writes no item and records no
  //                       decision, so `item.updated` and decision.recorded would
  //                       both LIE about what happened; the widening follows the
  //                       decision.recorded precedent exactly (C-029 F7).
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
    // GAP-013's provenance record: a §2.11 question was ANSWERED, and this names
    // the channel it arrived through (`via`, plus the derived `human` flag).
    // Widened rather than borrowed: question.surfaced describes the ask,
    // `item.updated` describes the items the answer released, and neither can
    // answer "what did a human actually decide in this run?" — which is the one
    // question a forged human-in-the-loop makes unanswerable (§7.4).
    "question.answered",
    "run.stop-report",
    // ISSUE-066's resume path: a §2.9 stop of a resumable kind was CLEARED because
    // the human answered the question the run was waiting on. Widened rather than
    // borrowed: run.created describes a run that did not exist before,
    // run.stop-report describes an artifact, and `item.updated` names the wrong
    // subject — a record filed under any of them is a record no replay filter can
    // trust (§7.4).
    "run.resumed",
    "hook.failed",
    "config.updated",
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
