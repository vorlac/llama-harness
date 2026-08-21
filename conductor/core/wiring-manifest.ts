// conductor/core/wiring-manifest.ts — GAP-002, the WIRING MANIFEST.
//
// A single declarative record of every hook/wire the composition root
// (conductor/plugin/index.ts) MUST register for the integration to be live. The
// completeness test (conductor/tests/wiring-manifest.test.ts) constructs the real
// plugin and asserts, in both directions, that the set of wires the composition
// root actually registers equals the set declared here: a declared wire that is
// not registered goes red, and a registered wire that is not declared goes red.
//
// WHY THIS EXISTS. ISSUE-001 (the dead injection layer) shipped green: the §6.4
// hooks were BUILT and IMPORTED but never REGISTERED, so adapter/inject.ts ran in
// no session and 1,382 tests stayed green because each proved its own helper
// rather than the wire. This manifest is the completeness INDEX over the §6.4
// delivery witness (conductor/tests/inject-wiring.test.ts) — it does not re-run
// the behavioural proof, it asserts every wire the delivery/gate/fan-out witnesses
// depend on is present, and that no wire was silently added past the ledger. The
// single largest defect family in the review record (MACRO-001, the ~22-instance
// built-but-never-wired class) goes red the day a wire is dropped.
//
// This module is PURE DATA (a core module, §5.2): no I/O, no clock. The test owns
// the runtime construction and the source-reading.

// The kind of runtime wire a manifest entry describes, which selects how the
// completeness test proves it is registered.
//   hook        — an opencode lifecycle hook: a key on the plugin factory's
//                 return object that opencode invokes by exactly that name. Proven
//                 by set-equality against the constructed plugin's own keys.
//   toolBinding — the §3.4 conductor_* tool inventory: the accessor whose members
//                 must equal the registered tool-map keys, each carrying a real
//                 (non-fallback) ToolSpec. Proven against the constructed tool map.
//   module      — an adapter the composition root must both IMPORT and CALL. An
//                 import with no call site is the ISSUE-001 shape (the fan-out
//                 engine and the §3.8 liveness beacon are the two that, dead,
//                 leave the whole run undelivered or ungated).
export type WireKind = "hook" | "toolBinding" | "module";

export interface Wire {
  // Stable identity for prose and test messages.
  name: string;
  kind: WireKind;
  // hook:        the exact key opencode invokes it by (present on the return object).
  // toolBinding: the inventory accessor name whose members equal the tool-map keys.
  // module:      the import specifier the composition root must import `binds` from.
  registration: string;
  // module only: the symbol that must be imported from `registration` AND referenced
  // in the composition root body outside its import — an unreferenced import is dead
  // wiring (ISSUE-001).
  binds?: string;
}

// The description string the composition root falls back to when a tool has no
// hand-written ToolSpec (plugin/index.ts builds the tool map from the inventory,
// so a name absent from `specs` is registered with this template rather than
// dropped — MACRO-025(b), the silent argument-free fallback). The completeness
// test refuses any registered tool whose description is this template for its name.
export function fallbackToolDescription(toolName: string): string {
  return `Conductor tool ${toolName}.`;
}

export const WIRING_MANIFEST: readonly Wire[] = [
  // §6.4 (a): the doctrine pack(s) + live state block appended to every request.
  // ISSUE-001's dead layer was exactly this hook, unregistered.
  { name: "doctrine-injection", kind: "hook", registration: "experimental.chat.system.transform" },
  // §6.4 (b): the §4.1 per-role sampling.
  { name: "sampling-params", kind: "hook", registration: "chat.params" },
  // §6.4 (c): the §4.4 router tags.
  { name: "router-headers", kind: "hook", registration: "chat.headers" },
  // §3.2: the run-creating prompt intake.
  { name: "prompt-intake", kind: "hook", registration: "chat.message" },
  // §3.5: the edit/git/scope gate — an absent gate is the §3.8 silent-ungate.
  { name: "edit-gate", kind: "hook", registration: "tool.execute.before" },
  // §3.7/§3.5(b)/§3.6: the idle engine, ask-gate and fan-out driver bus.
  { name: "event-bus", kind: "hook", registration: "event" },
  // §3.8: the session banner and the §2.11 stale-red report. Task 20.5 measured
  // four candidate seams against the pinned binary and this is the only one that
  // puts plugin-authored text in front of an operator, so the banner is
  // registered here or it does not exist.
  { name: "session-banner", kind: "hook", registration: "tool.execute.after" },
  // §3.4: the 22 conductor_* tools, each with a real ToolSpec.
  { name: "conductor-tools", kind: "toolBinding", registration: "CONDUCTOR_TOOL_NAMES" },
  // §5.4: the fan-out engine the event bus drives sub-sessions through.
  { name: "fanout-engine", kind: "module", registration: "../adapter/fanout.ts", binds: "createFanout" },
  // §3.8: the liveness beacon openWorkspace writes once doctrine is deliverable.
  { name: "liveness-beacon", kind: "module", registration: "../adapter/state.ts", binds: "openWorkspace" },
] as const;

// The hook keys the manifest declares — the composition root's return object must
// carry exactly these (plus `tool`), no more and no fewer.
export function declaredHookKeys(): readonly string[] {
  return WIRING_MANIFEST.filter((w) => w.kind === "hook").map((w) => w.registration);
}

// The module wires — each must be imported AND referenced by the composition root.
export function declaredModuleWires(): readonly Wire[] {
  return WIRING_MANIFEST.filter((w) => w.kind === "module");
}

// The single tool-binding wire (there is exactly one; the completeness test
// asserts that too, so a second inventory accessor cannot appear unnoticed).
export function declaredToolBinding(): Wire {
  const bindings = WIRING_MANIFEST.filter((w) => w.kind === "toolBinding");
  if (bindings.length !== 1) {
    throw new Error(
      `wiring manifest must declare exactly one toolBinding wire, found ${bindings.length}`,
    );
  }
  return bindings[0];
}
