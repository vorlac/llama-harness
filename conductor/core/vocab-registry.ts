// conductor/core/vocab-registry.ts — GAP-016, the VOCABULARY REGISTRY.
//
// ONE source of truth for the shared closed vocabularies the system restates in
// several languages. Each vocabulary pins its plan-frozen spelling (D15c: the
// registry PINS the members; the TS interface and the hand-written JSON schema
// STAY and are asserted to agree, they are NOT replaced) and NAMES every
// restatement site — the TS arrays, the exported JSON-schema enums, and the
// Python copies. The parity test (conductor/tests/vocab-registry.test.ts) asserts
// every site equals the pin, in both directions: a member added on one side and
// forgotten on another goes red, whichever side moved.
//
// WHY THIS EXISTS. MACRO-012: a stop-kind change touches 6 files in 3 languages,
// none derivable from another, and the copies are findable only by grepping the
// VALUE, not the concept — `grep STOP_KINDS` finds 4 of 6. C-082 (the build's
// costliest defect) was a value-spelled copy a concept-grep missed. ISSUE-113: a
// seventh TS stop kind hard-crashes the 14.2 benchmark python-side, mid-campaign,
// because scripts/conductor_bench.py carries a verbatim tuple that no TS change
// reaches. This registry makes the safe read-set KNOWABLE IN ADVANCE: the concept
// is the index, and one test fails the moment any site drifts.
//
// This module is PURE DATA (a core module, §5.2): the pin and the site
// descriptors only. The test owns the extraction (it imports the runtime TS
// values and reads the .py / record-literal sources).

// How a restatement site spells the vocabulary, which selects the test's extractor.
//   ts-value     — a runtime array/tuple exported from a TS module (the parity
//                  test imports it and compares members).
//   schema-enum  — an `enum` array inside the exported SCHEMAS record, addressed
//                  by a dotted path from a schema root (D15c: the hand-written
//                  schema stays; the registry asserts it agrees).
//   record-keys  — the top-level keys of a `const NAME ... = { ... }` object
//                  literal in a TS source file (the ROLE_* maps whose parallel
//                  keys are MACRO-012's silent role seam).
//   py-tuple     — a `NAME = ( "a", "b", ... )` assignment in a Python source
//                  file (the ISSUE-113 cross-language copy).
export type SiteKind = "ts-value" | "schema-enum" | "record-keys" | "py-tuple";

export interface VocabSite {
  lang: "ts" | "json" | "py";
  kind: SiteKind;
  // Repo-relative source file, or (schema-enum) the exported SCHEMAS record.
  file: string;
  // ts-value / record-keys / py-tuple: the symbol name. schema-enum: a dotted path
  // from the named schema root to the enum-bearing node (e.g. "Run.state" or
  // "Run.stop.kind"), resolved through `.properties` at each step.
  symbol: string;
}

export interface Vocabulary {
  name: string;
  // The pin: the plan-frozen spelling, the reference every site is checked against.
  members: readonly string[];
  // Every place the vocabulary is restated. The test asserts each equals `members`.
  sites: readonly VocabSite[];
}

export const VOCABULARIES: readonly Vocabulary[] = [
  {
    // §2.9 stop kinds — the flagship cross-language case (ISSUE-113 / C-082).
    name: "stopKinds",
    members: ["done", "noop", "blocked", "surfaced", "env", "interrupt"],
    sites: [
      { lang: "ts", kind: "ts-value", file: "conductor/core/stops.ts", symbol: "STOP_KINDS" },
      { lang: "json", kind: "schema-enum", file: "SCHEMAS", symbol: "Run.stop.kind" },
      { lang: "py", kind: "py-tuple", file: "scripts/conductor_bench.py", symbol: "STOP_KINDS" },
    ],
  },
  {
    // §3.1 run states — the FSM export and the persisted schema's enum.
    name: "runStates",
    members: [
      "INTAKE",
      "DECOMPOSED",
      "PLANNED",
      "PLAN_REVIEWED",
      "EXECUTING",
      "REPORTED",
      "TRIVIAL_DONE",
      "ANSWERED",
    ],
    sites: [
      { lang: "ts", kind: "ts-value", file: "conductor/core/fsm-run.ts", symbol: "RUN_STATES" },
      { lang: "json", kind: "schema-enum", file: "SCHEMAS", symbol: "Run.state" },
    ],
  },
  {
    // §3.3 item states — the FSM export and the persisted schema's enum.
    name: "itemStates",
    members: ["PENDING", "RED", "TEST_VETTED", "GREEN", "VALIDATED", "REVIEWED", "PUBLISHED"],
    sites: [
      { lang: "ts", kind: "ts-value", file: "conductor/core/fsm-item.ts", symbol: "ITEM_STATES" },
      { lang: "json", kind: "schema-enum", file: "SCHEMAS", symbol: "Item.state" },
    ],
  },
  {
    // §4.1 roles — the three parallel Record<string,…> maps in adapter/inject.ts
    // whose keys must stay in lockstep (MACRO-012's silent role seam: inject.ts's
    // `??` fallbacks hide a role added to one map and forgotten in another).
    name: "roles",
    members: [
      "orchestrator",
      "planner",
      "testWriter",
      "implementer",
      "reviewer",
      "skeptic",
      "mechanical",
    ],
    sites: [
      { lang: "ts", kind: "record-keys", file: "conductor/adapter/inject.ts", symbol: "ROLE_PACKS" },
      { lang: "ts", kind: "record-keys", file: "conductor/adapter/inject.ts", symbol: "ROLE_TEMPERATURE" },
      { lang: "ts", kind: "record-keys", file: "conductor/adapter/inject.ts", symbol: "ROLE_PRIORITY" },
      // The role -> opencode agent map the fan-out engine names on every
      // session.create and session.prompt (Task 21.1). It is a fourth parallel
      // role map with the same silent-drift shape as the three above: a role
      // added to ROLE_PACKS and forgotten here dispatches with no agent, which
      // opencode accepts without complaint.
      { lang: "ts", kind: "record-keys", file: "conductor/adapter/fanout.ts", symbol: "ROLE_AGENT" },
    ],
  },
  {
    // §3.5 tool classes — the axis the session-registry gate dispatches on.
    // There is ONE site because Task 21.2 deleted the copies rather than pinning
    // them: adapter/tools.ts and core/gates-edit.ts both import the derived
    // union. The entry still earns its place — the pin here is the plan-frozen
    // spelling, so widening the class set is a deliberate two-file act rather
    // than an edit to one array that every gate silently inherits.
    name: "toolClasses",
    members: ["read", "write", "conductor", "spawn"],
    sites: [
      { lang: "ts", kind: "ts-value", file: "conductor/core/types.ts", symbol: "TOOL_CLASSES" },
    ],
  },
  {
    // §2 side-effect classes — what a call can REACH, the axis the built-in
    // classification table and the network deny point are written against.
    name: "sideEffectClasses",
    members: ["R0", "R1", "R2", "R3", "W", "X", "S"],
    sites: [
      { lang: "ts", kind: "ts-value", file: "conductor/core/types.ts", symbol: "SIDE_EFFECT_CLASSES" },
    ],
  },
] as const;
