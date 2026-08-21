// conductor/tools/atlas.ts — the END-TO-END ATLAS: one machine-checkable map of
// what happens to a prompt from the moment opencode receives it to the moment a
// result is published into the workspace.
//
// WHY THIS IS DATA AND NOT A DIAGRAM. A hand-drawn picture of this system is
// wrong the day after it is drawn, and a picture cannot be tested. The node set
// here is instead PINNED against the closed vocabularies the code already owns —
// the §7.4 journal events, the §3.1/§3.3 FSM states, the §2.9 stop kinds, the
// §3.4 tool inventory and the §6.4 hook registrations. conductor/tests/atlas.test.ts
// asserts the pin in BOTH directions, so a vocabulary member with no node and a
// node claiming a member that does not exist are each a red run. The same
// construction vocab-registry.ts uses for cross-language spelling, applied to the
// shape of the system rather than to its words.
//
// WHAT IS PINNED AND WHAT IS NOT. The NODE SET is derived and enforced. The EDGE
// set and the prose are editorial: no module states the order of the pipeline in
// one place, so a person writes it and a reader checks it. That split is the
// honest one — the drift that actually happens is "a gate was added and the map
// never heard about it", which the pin catches, not a re-drawn arrow.
//
// WHY THIS LIVES IN tools/ AND NOT IN core/. It was written as a core module and
// moved, because a documentation-data module cannot sit in a scanned production
// tree. Four separate text audits read conductor/{core,adapter,plugin} as TEXT,
// and every one of them treats a STRING LITERAL as code — which is exactly what
// this file is made of:
//
//   unreachable-exports  counts identifiers, so naming `fetchMetricsSummary` in
//                        prose lifted that dead symbol out of the unreached set;
//   purity (core-imports) matches `from "…"`, so the phrase "…distinguish a repo
//                        I may not write from 'no repo at all'" parsed as an import;
//   ops-behavioral-anchor greps for a banner emitter, and the caveat SAYING no
//                        module emits a banner registered as one that does;
//   comment-hygiene       applies to the prose either way, and rightly.
//
// Each was survivable alone. Together they make the point: prose describing the
// tree, placed inside the tree, silently disables the audits that keep the tree
// honest. tools/ is still typechecked and still gate-scanned, and the pin in
// conductor/tests/atlas.test.ts is what actually guarantees accuracy — the core
// purity guard never did, because a frozen data literal has no I/O to forbid.
//
// STATUS OF THE CLAIMS. Every node describes what the code at this revision
// SPECIFIES. Task 13.2 (the live smoke) has not been run, so no edge here has
// been observed end to end on a live model. Nodes whose behaviour is known to
// diverge from what a reader would assume carry a `caveat`.

import type { Component } from "../core/journal-events.ts";
import type { RunState } from "../core/fsm-run.ts";
import type { ItemState } from "../core/fsm-item.ts";
import type { StopKind } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

// Which half of the system a node lives in. `workspace` is the repository being
// worked on — the only layer whose contents outlive the process.
export type AtlasLayer = "opencode" | "conductor" | "router" | "workspace";

// What a node IS. The kinds that name a closed vocabulary (`tool`, `runState`,
// `itemState`, `stop`, `hook`) are the ones the parity test pins member-for-member.
export type AtlasNodeKind =
  | "entry"
  | "hook"
  | "init"
  | "inject"
  | "gate"
  | "hatch"
  | "tool"
  | "runState"
  | "itemState"
  | "engine"
  | "router"
  | "sink"
  | "stop";

// A journal record a node is responsible for emitting: the §7.4 component/event
// pair plus the level it actually goes out at. `emitted: false` records a name
// that IS in the closed vocabulary but that no call site writes — the fact a
// person watching a live log most needs, because waiting for one of these is
// waiting forever.
export interface AtlasLogPoint {
  component: Component;
  event: string;
  level: "error" | "warn" | "info" | "debug" | "trace";
  // What the record means when it appears, and the `data` keys worth reading.
  means: string;
  emitted?: false;
}

// One outcome of a decision node. `when` is the condition, `to` is the node the
// system moves to (a node id, or "" where the outcome leaves the graph).
export interface AtlasFork {
  when: string;
  to: string;
  // "allow" advances; "deny" refuses the call; "hold" parks it; "fail" ends badly.
  outcome: "allow" | "deny" | "hold" | "fail" | "advance";
  // The refusal text or effect a person will actually see.
  effect?: string;
}

export interface AtlasNode {
  id: string;
  label: string;
  kind: AtlasNodeKind;
  layer: AtlasLayer;
  // One sentence: what this step does.
  what: string;
  // The rule it exists to enforce, and the failure it is written against. Absent
  // on nodes that are positions rather than enforcement points.
  enforces?: string;
  // Repo-relative `path:line` anchors. First entry is the primary definition.
  source: readonly string[];
  // Journal/telemetry this node is responsible for.
  logs?: readonly AtlasLogPoint[];
  // Every branch out of a decision node.
  forks?: readonly AtlasFork[];
  // Where the node's behaviour departs from the obvious reading.
  caveat?: string;
  // For kinds that pin a vocabulary: the exact member this node stands for.
  member?: string;
}

export type AtlasEdgeKind = "flow" | "deny" | "spawn" | "read" | "write";

export interface AtlasEdge {
  from: string;
  to: string;
  kind: AtlasEdgeKind;
  label?: string;
}

export interface Atlas {
  nodes: readonly AtlasNode[];
  edges: readonly AtlasEdge[];
}

// Compile-time parity on the three closed state vocabularies: a member string
// that is not a real state fails `tsc`, so those axes never reach the runtime
// test wrong. The event and tool axes are strings here and pinned at runtime.
type RunStateMember = RunState;
type ItemStateMember = ItemState;
type StopKindMember = StopKind;

const runState = (s: RunStateMember): string => s;
const itemState = (s: ItemStateMember): string => s;
const stopKind = (s: StopKindMember): string => s;

// ---------------------------------------------------------------------------
// Nodes — Part 1: entry, the six opencode hooks, workspace init, §6.4 injection
// ---------------------------------------------------------------------------

const ENTRY_NODES: readonly AtlasNode[] = [
  {
    id: "entry.prompt",
    label: "Prompt submitted in opencode",
    kind: "entry",
    layer: "opencode",
    what:
      "A person types a request into an opencode session whose config loads the conductor plugin. " +
      "Nothing conductor does is reachable until this happens: the plugin is passive and every " +
      "action below is a hook opencode calls.",
    source: ["conductor/plugin/index.ts:338", "conductor/opencode-fragment.json:1"],
  },
  {
    id: "entry.model",
    label: "Session model + provider baseURL",
    kind: "entry",
    layer: "opencode",
    what:
      "opencode resolves which model the session talks to and the provider base URL it posts to. " +
      "scripts/serve.py generates a session-scoped opencode config pointing this at llama-router.",
    source: ["scripts/serve.py:1", "conductor/plugin/index.ts:147"],
    caveat:
      "The plugin cannot re-point a live session's provider URL. Conductor's §4.4 failover diverts " +
      "only the HTTP conductor issues itself (setup proofs, the metrics read) — never the run's model " +
      "traffic. Mid-run transport resilience is the serve.py supervisor's restart, not the plugin's.",
  },
];

const HOOK_NODES: readonly AtlasNode[] = [
  {
    id: "hook.chat.message",
    label: "chat.message — prompt intake",
    kind: "hook",
    layer: "opencode",
    member: "chat.message",
    what:
      "Fires as the prompt enters the session. Conductor uses it to notice a prompt that arrives " +
      "while a run is already live, so a mid-run instruction is recorded rather than silently merged " +
      "into the orchestrator's context.",
    enforces:
      "§3.2 — a human instruction issued mid-run leaves a durable trace. Without it the only record " +
      "of a course correction is the model's own memory of it.",
    source: ["conductor/plugin/index.ts:1"],
    logs: [
      {
        component: "state",
        event: "user.midrun-prompt",
        level: "info",
        means:
          "A prompt arrived while a run was live. Read `data` for the text and the run position it " +
          "landed at — this is the record that explains a run that suddenly changed direction.",
      },
    ],
  },
  {
    id: "hook.system.transform",
    label: "experimental.chat.system.transform — doctrine injection",
    kind: "hook",
    layer: "opencode",
    member: "experimental.chat.system.transform",
    what:
      "Appends the role's doctrine packs and the live state block onto the system prompt of EVERY " +
      "request. It appends; it never replaces what opencode already put there.",
    enforces:
      "§6.4 — the model is never trusted to remember the process. Position, legal tools and " +
      "recommendation are re-stated on every single request, so a model that forgets is corrected " +
      "one request later rather than drifting for a whole run.",
    source: ["conductor/plugin/index.ts:1556", "conductor/adapter/inject.ts:341"],
    logs: [
      {
        component: "inject",
        event: "system-append",
        level: "info",
        means:
          "The delivery receipt. `data` carries {role, packs, packDigest, stateBlock, stateBlockLines, " +
          "entries}. This is the ONE record proving doctrine actually reached a request — the defect " +
          "ISSUE-001 was exactly this layer built, tested and never registered.",
      },
    ],
    caveat:
      "The delivery is composed per request and never cached (G9): a memoized delivery would re-state " +
      "a position the run has already left.",
  },
  {
    id: "hook.chat.params",
    label: "chat.params — sampling",
    kind: "hook",
    layer: "opencode",
    member: "chat.params",
    what:
      "Sets the per-role sampling temperature (and topP when the role declares one) on the outbound " +
      "request. It deliberately leaves topK and maxOutputTokens alone.",
    enforces:
      "A reviewer and an implementer should not sample alike. Role-appropriate temperature is set " +
      "mechanically rather than asked for in prose.",
    source: ["conductor/plugin/index.ts:1584"],
  },
  {
    id: "hook.chat.headers",
    label: "chat.headers — router tags",
    kind: "hook",
    layer: "opencode",
    member: "chat.headers",
    what:
      "Adds X-Conductor-Role, X-Conductor-Priority, X-Conductor-Group and (only when the job flags " +
      "structured output) X-Conductor-Schema: required. Adds to the header map rather than replacing " +
      "it, because the provider's own auth headers live there.",
    enforces:
      "§4.4 — these four headers are the entire channel through which llama-router learns what kind " +
      "of work a request is. Without them every request is anonymous and admission control degrades " +
      "to first-come-first-served.",
    source: ["conductor/plugin/index.ts:1594", "conductor/adapter/inject.ts:279"],
  },
  {
    id: "hook.tool.before",
    label: "tool.execute.before — the gate choke point",
    kind: "hook",
    layer: "opencode",
    member: "tool.execute.before",
    what:
      "Fires before EVERY tool call the model makes, conductor's own tools included. This is the one " +
      "place the security gates run. Returning allows the call; throwing denies it.",
    enforces:
      "§3.5 — one choke point, not a check scattered across handlers. A gate that some call path can " +
      "route around is not a gate.",
    source: ["conductor/plugin/index.ts:1666", "conductor/adapter/tools.ts:426"],
  },
  {
    id: "hook.tool.after",
    label: "tool.execute.after — the one operator-visible channel",
    kind: "hook",
    layer: "opencode",
    member: "tool.execute.after",
    what:
      "Fires after every non-conductor tool call and prefixes the §3.8 session banner — harness " +
      "version, plugin pid, live runId and resolved model — to the session's FIRST tool result, " +
      "followed by the §2.11 stale-red exclusions when the run carries any. Once per session. A " +
      "conductor_* result is never decorated, because those are payloads the orchestrator parses.",
    enforces:
      "§3.8 — 'no banner, no conductor' is the ops guide's first rule, and it needs a banner. Four " +
      "candidate seams were measured against the pinned binary and this is the only one that puts " +
      "plugin-authored text in front of an operator, so the banner is conditional on a tool running " +
      "and the beacon file remains the check that is not.",
    source: ["conductor/plugin/index.ts:1", "conductor/core/banner.ts:1"],
  },
  {
    id: "hook.event",
    label: "event — the idle bus",
    kind: "hook",
    layer: "opencode",
    member: "event",
    what:
      "Receives opencode's session lifecycle events. Conductor watches for session-idle, which is the " +
      "trigger the continuation engine needs to notice that a run has stalled with work still open.",
    enforces:
      "§3.7 — a local model that stops mid-run is the normal case, not the exception. Something has to " +
      "notice and re-prompt, or every run ends by the operator giving up.",
    source: ["conductor/plugin/index.ts:1", "conductor/adapter/continuation.ts:1"],
  },
];

const INIT_NODES: readonly AtlasNode[] = [
  {
    id: "init.ensurePacks",
    label: "ensurePacks — fail-closed doctrine load",
    kind: "init",
    layer: "conductor",
    what:
      "Loads all nine required doctrine packs from the doctrine directory, memoized on the resolved " +
      "path. A missing, unreadable or whitespace-only pack throws and the hook does no conductor work.",
    enforces:
      "§6.4/§3.8 fail-closed at init. A conductor running without its doctrine would gate calls while " +
      "telling the model nothing about the process it is being gated against — worse than not running.",
    source: ["conductor/plugin/index.ts:739", "conductor/adapter/inject.ts:80"],
    forks: [
      {
        when: "All nine packs load and are non-empty",
        to: "init.ensureWorkspace",
        outcome: "allow",
      },
      {
        when: "Any required pack is missing, unreadable or empty",
        to: "sink.stderr",
        outcome: "fail",
        effect:
          'Throws: `conductor: required doctrine pack "<file>" is missing or unreadable at <path> ' +
          "(§6.4 fail-closed at init)`. The beacon is NOT written, so no run can start.",
      },
    ],
    logs: [
      {
        component: "state",
        event: "hook.failed",
        level: "error",
        means:
          "A conductor hook could not do its conductor-side work. `data.hook` names which one. G5 " +
          "fail-soft swallows the throw so the opencode session survives, which makes this record the " +
          "ONLY trace that conductor is not actually running.",
      },
    ],
    caveat:
      "Ordering is load-bearing: packs load BEFORE openWorkspace, so the §3.8 liveness beacon is only " +
      "written for a workspace whose doctrine can actually be delivered (ISSUE-004).",
  },
  {
    id: "init.ensureWorkspace",
    label: "ensureWorkspace — open .conductor/",
    kind: "init",
    layer: "conductor",
    what:
      "Resolves the workspace root, loads .conductor/config.json, and opens the state store. Every " +
      "hook that needs conductor state calls this first.",
    source: ["conductor/plugin/index.ts:428", "conductor/adapter/config-io.ts:1"],
  },
  {
    id: "lock.run",
    label: "run.lock — OS-level single writer",
    kind: "init",
    layer: "workspace",
    what:
      "`.conductor/state/run.lock` holds {pid, startMs, sessionID?, token?}. A fresh claim is written " +
      "whole into a same-directory temp and published with linkSync, which is atomic and refuses to " +
      "overwrite an existing name.",
    enforces:
      "§4.1 — exactly one conductor session may write a workspace. Two sessions interleaving writes " +
      "into one .conductor/ tree corrupts run state in a way no later read can detect.",
    source: ["conductor/adapter/state.ts:162", "conductor/adapter/state.ts:1130"],
    logs: [
      {
        component: "state",
        event: "lock.acquired",
        level: "info",
        means: "This session is the writer. Everything below is legal for it.",
      },
      {
        component: "state",
        event: "lock.contended",
        level: "warn",
        means:
          "A live foreign writer holds the lock. Logged at `warn` from the three state.ts sites and at " +
          "`error` from the plugin's second-session refusal (plugin/index.ts:483).",
      },
      {
        component: "state",
        event: "lock.stale-break",
        level: "warn",
        means: "The holder was judged dead and its lock was broken. `data` names the identity that lost it.",
      },
      {
        component: "state",
        event: "lock.released",
        level: "info",
        means: "The writer let go cleanly.",
      },
    ],
    forks: [
      { when: "No live holder, or the holder is dead", to: "beacon.alive", outcome: "allow" },
      {
        when: "A live foreign writer holds it",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "openWorkspace REFUSES the second session outright — it gets no store at all, not a read-only " +
          "one. The session keeps working as plain opencode with no conductor enforcement.",
      },
    ],
    caveat:
      "The two optional identity fields are absent from a lock written by an older conductor or a test " +
      "fixture; identity then falls back to pid and startMs.",
  },
  {
    id: "beacon.alive",
    label: "alive.json — the liveness beacon",
    kind: "init",
    layer: "workspace",
    what:
      "`.conductor/state/alive.json` is written once the workspace opens. Its presence is the operator's " +
      "proof that conductor is actually engaged in this session.",
    enforces:
      "§3.8 — the first rule of running conductor is NO BEACON, NO CONDUCTOR. A plugin that failed to " +
      "load looks exactly like a plugin that loaded and chose to allow everything.",
    source: ["conductor/adapter/state.ts:179"],
    caveat:
      "The plan's visible session banner is NOT wired — no module emits one — so this file is the whole " +
      "of that check. Check it before trusting any gate to be running.",
  },
];

const INJECT_NODES: readonly AtlasNode[] = [
  {
    id: "inject.compose",
    label: "composeDelivery — one composition per request",
    kind: "inject",
    layer: "conductor",
    what:
      "The single call all three §6.4 hooks read. Resolves the session's role from the §3.5 registry, " +
      "selects packs, renders the state block, and answers system-append + params + headers together " +
      "with a receipt.",
    enforces:
      "One derivation, three consumers — the system prompt, the sampling params and the router headers " +
      "can never disagree about what role this session is.",
    source: ["conductor/adapter/inject.ts:341", "conductor/plugin/index.ts:1071"],
    forks: [
      { when: "Session has a registry entry", to: "inject.packs", outcome: "allow" },
      {
        when: "Session has no registry entry",
        to: "inject.packs",
        outcome: "allow",
        effect: 'Role is the literal string "unregistered" — never a promotion to a §4.1 role.',
      },
      {
        when: "Composition throws",
        to: "sink.journal",
        outcome: "fail",
        effect: "G5 fail-soft: journals state/hook.failed and the hook appends nothing.",
      },
    ],
  },
  {
    id: "inject.packs",
    label: "Pack selection by role",
    kind: "inject",
    layer: "conductor",
    what:
      "Maps the session role to its doctrine packs: orchestrator/mechanical/unknown to core.md, planner " +
      "to decompose.md + plan.md, testWriter and implementer to tdd.md, reviewer to review.md + " +
      "test-vet.md, skeptic to skeptic.md. Two packs attach conditionally — debug.md when the active " +
      "item carries debugging:true, and receive-review.md when the registry entry carries " +
      "receivingReview:true.",
    enforces:
      "A role is told the rules of its own job and not the rules of everyone else's. The packs are " +
      "capped at 120 lines and 6500 bytes each so the process instructions cannot crowd out the work.",
    source: ["conductor/adapter/inject.ts:42", "conductor/adapter/inject.ts:199"],
    caveat:
      "receive-review.md rides the REGISTRY ENTRY, not the item state — so the same item's other " +
      "dispatches (a debug fix, a green fix) receive nothing extra.",
  },
  {
    id: "inject.stateBlock",
    label: "The live state block",
    kind: "inject",
    layer: "conductor",
    what:
      "A block of at most 30 lines, always last in the append, re-stating: run state, active item, the " +
      "recommended next tool with its rationale, a count of other legal tools, open questions, blocked " +
      "and deferred counts, taint count and overrides remaining.",
    enforces:
      "§6.4 — 're-stated every request, never remembered'. The recommendation comes from the SAME " +
      "legalTools derivation the phase gate enforces, so the model is never advised to call something " +
      "the gate will refuse.",
    source: ["conductor/adapter/inject.ts:124", "conductor/core/gates-phase.ts:246"],
    caveat:
      "With no live run the block is three lines pointing at conductor_status. The 30-line ceiling is " +
      "asserted by tests, not enforced inside inject.ts.",
  },
];

// ---------------------------------------------------------------------------
// Nodes — Part 2: the gate stack, in the order gateBeforeToolCall runs it
// ---------------------------------------------------------------------------

const GATE_NODES: readonly AtlasNode[] = [
  {
    id: "gate.entry",
    label: "gateBeforeToolCall — allow by return, deny by throw",
    kind: "gate",
    layer: "conductor",
    what:
      "The adapter choke point every tool call passes through. It runs the gates below in a fixed " +
      "order and either returns (allow) or throws the refusal text (deny).",
    enforces:
      "§3.5 — the model never sees a gate decision as data it could argue with. A denial is an " +
      "exception at the tool boundary.",
    source: ["conductor/adapter/tools.ts:426", "conductor/adapter/tools.ts:230"],
    logs: [
      {
        component: "gates",
        event: "deny",
        level: "warn",
        means:
          "A call was refused. `data` carries the §7.4 input snapshot {toolName, args, reason, command?, " +
          "editPath?}. This is the FIRST record to grep when a session says it cannot do something.",
      },
      {
        component: "gates",
        event: "allow",
        level: "debug",
        means: "A call was adjudicated and permitted. Only visible at debug or below.",
      },
      {
        component: "gates",
        event: "snapshot",
        level: "debug",
        means: "The gate's input state at decision time — what the gate believed when it decided.",
      },
    ],
  },
  {
    id: "gate.crash",
    label: "guardedDecide — fail-closed on guarded calls",
    kind: "gate",
    layer: "conductor",
    what:
      "Wraps each pure gate decision. If the decision function throws, this decides what to do with a " +
      "call nobody adjudicated.",
    enforces:
      "G5 — a crashed gate must not silently become an open gate. A call is `guarded` when it has a git " +
      "segment, has at least one write-shaped target, or its tool class is write/conductor/spawn.",
    source: ["conductor/adapter/tools.ts:355", "conductor/adapter/tools.ts:437"],
    logs: [
      {
        component: "gates",
        event: "gate-crash",
        level: "error",
        means:
          "A security gate threw while judging a call. Always worth investigating — the §2.8 anomaly " +
          "class. Read `data` for which gate and which call.",
      },
    ],
    forks: [
      {
        when: "The call is guarded and a gate crashed",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`a security gate crashed while judging a guarded call — denied (fail-closed, G5): <message>`",
      },
      {
        when: "The call is not guarded and a gate crashed",
        to: "gate.entry",
        outcome: "allow",
        effect: "A harmless read (an `ls`) is allowed through rather than breaking the session.",
      },
    ],
    caveat:
      "A crash on a wrapper-hidden git write that the parser failed to see as a git segment is NOT " +
      "guarded, so it fails OPEN. That gap is real and worth knowing before a live test.",
  },
  {
    id: "gate.patch",
    label: "(a0) Patch-tool refusal",
    kind: "gate",
    layer: "conductor",
    what:
      "`apply_patch` and `patch` are refused before every other gate, in every session, registered or not.",
    enforces:
      "A patch body carries its own write targets in a form no gate parses, so the edit-scope gate " +
      "cannot bound it. Refusing the tool is the only sound answer.",
    source: ["conductor/adapter/tools.ts:453"],
    forks: [
      {
        when: "toolName is apply_patch or patch",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`the <tool> tool is denied in every session: a patch body carries its own write targets in a " +
          "form no gate adjudicates... Use the edit/write tools, whose target is a single path this " +
          "session's scope is checked against`",
      },
      { when: "Any other tool", to: "gate.session", outcome: "allow" },
    ],
  },
  {
    id: "gate.spawn",
    label: "Sub-agent spawn denial",
    kind: "gate",
    layer: "conductor",
    what:
      "opencode's built-in `task` tool is denied unconditionally — in registered and unregistered " +
      "sessions alike, before the registry check runs.",
    enforces:
      "A child session conductor never registered would perform exactly the writes this session is " +
      "scoped out of. The generated agent definitions also set \"task\": false for all seven " +
      "restricted agents, so the denial is enforced twice.",
    source: ["conductor/core/gates-edit.ts:59", "conductor/opencode-fragment.json:16"],
    forks: [
      {
        when: "toolClass is spawn",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`sub-agent spawn (the task tool) is denied in every session, registered or not — a child " +
          "session conductor never registered would perform exactly the writes this session is scoped " +
          "out of`",
      },
    ],
  },
  {
    id: "gate.session",
    label: "(a) decideSession — the §3.5 registry gate",
    kind: "gate",
    layer: "conductor",
    what:
      "Asks whether this opencode session has a conductor registry entry, and refuses conductor tools " +
      "and writes to sessions that do not.",
    enforces:
      "§3.5 — conductor state advances only from sessions conductor itself dispatched. A session the " +
      "human opened by hand may read freely and may not mutate.",
    source: ["conductor/core/gates-edit.ts:41"],
    forks: [
      { when: "toolClass read (registered or not)", to: "gate.git", outcome: "allow" },
      { when: "toolClass write/conductor, registered", to: "gate.git", outcome: "allow" },
      {
        when: "toolClass conductor, unregistered",
        to: "sink.journal",
        outcome: "deny",
        effect: "`conductor state advances only from registered sessions; this session has no registry entry`",
      },
      {
        when: "toolClass write, unregistered",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`this session has no conductor item assignment — an edit/write needs a registered item scope; " +
          "obtain one through conductor rather than writing unassigned`",
      },
    ],
  },
  {
    id: "gate.git",
    label: "(b) decideGit — enumerated-allow git matrix",
    kind: "gate",
    layer: "conductor",
    what:
      "Runs over EVERY bash command, not just git-looking ones, splitting on operators and newlines. " +
      "Any denied git segment denies the whole command; an allowed read never rescues a later write.",
    enforces:
      "Default-deny on git. The model may inspect the repository and may not rewrite its history: a " +
      "reset, a force-push or a rebase can destroy work no conductor record could reconstruct.",
    source: ["conductor/core/gates-git.ts:677", "conductor/core/gates-git.ts:686"],
    forks: [
      { when: "No git segment present", to: "gate.interpreter", outcome: "allow" },
      { when: "An enumerated-allow read subcommand", to: "gate.interpreter", outcome: "allow" },
      {
        when: "Command word is unresolvable, or contains a shell expansion",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`unresolvable command word (shell expansion in command position); use conductor_surface if " +
          "the command is genuinely needed`",
      },
      {
        when: "Any other git subcommand or an exec-route flag",
        to: "sink.journal",
        outcome: "deny",
        effect: "Default-deny. The refusal names the subcommand it refused.",
      },
    ],
    caveat:
      "sessionRole and git.mode are accepted and EXPLICITLY DISCARDED here — git policy is role- and " +
      "mode-uniform for model sessions. git.mode branches the publish handler only. Separately, the git " +
      "gate does not see through most wrappers: `timeout 5 git push`, `nice git push` and " +
      "`sh -c \"git push\"` are not recognised as git segments, and a gate crash on one fails OPEN.",
  },
  {
    id: "gate.interpreter",
    label: "Interpreter state-area refusal",
    kind: "gate",
    layer: "conductor",
    what:
      "Scans every interpreter one-liner (node/bun/deno/python/perl/ruby `-e`/`-c` program text) and " +
      "refuses outright — with no path resolution at all — any whose case-folded body mentions " +
      "`.conductor`.",
    enforces:
      "A program text can COMPUTE the path it writes to, so no path-based check can bound it. The " +
      "mention itself is the refusal.",
    source: ["conductor/core/gates-edit.ts:579", "conductor/adapter/tools.ts:521"],
    forks: [
      {
        when: "An interpreter program mentions .conductor",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`an interpreter one-liner naming the .conductor state area is denied outright: the state area " +
          "is handler-written only, and a program text can build the path it writes to, so the mention " +
          "itself is the refusal`",
      },
      { when: "No such mention", to: "gate.writeshape", outcome: "allow" },
    ],
  },
  {
    id: "gate.writeshape",
    label: "writeShapedPaths — what a bash command actually writes",
    kind: "gate",
    layer: "conductor",
    what:
      "Extracts every path a bash command would write, so the edit gate can adjudicate each one. Covers " +
      "redirects (>, >>, &>, >|), tee, in-place sed/perl/awk, mv/cp destinations, rm, dd of=, ex/ed, " +
      "recursive `sh -c`, and write calls inside interpreter one-liners.",
    enforces:
      "An edit does not have to arrive through the edit tool. Without this, `echo x > src/a.ts` would " +
      "bypass the entire scope system.",
    source: ["conductor/core/gates-edit.ts:610", "conductor/core/gates-edit.ts:641"],
    forks: [
      { when: "One or more write-shaped targets found", to: "gate.edit", outcome: "allow" },
      { when: "No write shape (cat, grep, echo without redirect)", to: "gate.legality", outcome: "allow" },
    ],
    caveat:
      "`>&` (fd duplication) is deliberately NOT treated as a redirect. The command classifies as a " +
      "write purely because a write shape was found, which is also what makes it `guarded` for the " +
      "fail-closed crash rule.",
  },
  {
    id: "gate.edit",
    label: "(c) decideEdit — the edit-scope gate",
    kind: "gate",
    layer: "conductor",
    what:
      "Adjudicates ONE path at a time, in a fixed order of five checks. Runs once per write-shaped bash " +
      "target and once for a non-bash tool's filePath.",
    enforces:
      "§3.5 — a session may write only inside the scope conductor assigned it. This is the check that " +
      "makes parallel implementers safe: two items with disjoint fileScopes cannot touch each other.",
    source: ["conductor/core/gates-edit.ts:88", "conductor/core/gates-edit.ts:174"],
    forks: [
      {
        when: "1. Path is not under the session's tree",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`the path is outside this session's tree; an edit is confined to the tree the session was " +
          "dispatched into (§3.5), and no item scope can widen that`",
      },
      {
        when: "2. Normalized path contains a `..` segment",
        to: "sink.journal",
        outcome: "deny",
        effect: "`path traversal (`..`) is denied; an in-scope edit path never contains a `..` segment`",
      },
      {
        when: "3. A verify marker is live for THIS tree (freeze)",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`a verify marker is live for this tree (freeze); every edit here — source, test, or config — " +
          "is denied until the verify clears`",
      },
      {
        when: "4. Path matches .conductor/** (case-folded)",
        to: "sink.journal",
        outcome: "deny",
        effect: "`the .conductor state area is handler-written only; no session may edit .conductor/** paths`",
      },
      {
        when: "5. Path fails the session role's scope rule",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "An implementer editing its own testScope, a testWriter outside its testScope, a reader role " +
          "(reviewer/skeptic/planner/mechanical) editing at all, or an unknown role — each has its own " +
          "named refusal.",
      },
      { when: "All five pass", to: "gate.legality", outcome: "allow" },
    ],
    caveat:
      "The freeze is STRICT: it denies a test-writer inside its own testScope too. And the scopes come " +
      "from the item's PERSISTED queue.json entry — any failure to read one yields an empty scope, " +
      "which denies everything.",
  },
  {
    id: "gate.legality",
    label: "requireToolLegal — the tool-legality table",
    kind: "gate",
    layer: "conductor",
    what:
      "For conductor_* calls only. Looks the tool up in TOOL_LEGALITY, applies its caller rule " +
      "(orchestrator vs sub-session) and then its phase rule (always / stage / verdict / non-terminal / " +
      "once-at-intake).",
    enforces:
      "§3.4 — a tool with no declared row is REFUSED, not run. A closed table means a tool added without " +
      "a legality decision cannot be called at all.",
    source: ["conductor/adapter/tools.ts:3232", "conductor/core/tool-legality.ts:90"],
    forks: [
      {
        when: "No row in TOOL_LEGALITY",
        to: "sink.journal",
        outcome: "deny",
        effect: "Refused as undeclared. This is the fail-safe for a tool someone registered but never classified.",
      },
      {
        when: "Caller kind is not permitted for this tool",
        to: "sink.journal",
        outcome: "deny",
        effect: "The refusal enumerates every tool this caller kind MAY call.",
      },
      {
        when: "Run is terminal and the tool is non-terminal",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "`the run is TERMINAL... A terminal run takes no further mutation (§2.3): its report is " +
          "written, its items are disposed of, and reopening it would make that record a lie.`",
      },
      { when: "Row, caller and phase all permit", to: "gate.phase", outcome: "allow" },
    ],
  },
  {
    id: "gate.phase",
    label: "legalTools — the phase-order gate",
    kind: "gate",
    layer: "conductor",
    what:
      "Derives, from the run's FSM position plus its items, questions and repo configuration, the ONE " +
      "verdict naming every legal tool, the single recommended next tool, and a rationale.",
    enforces:
      "§3.4 — the pipeline order is a construction, not a request. One derivation feeds three consumers: " +
      "this gate, the §6.4 injection and the continuation engine, so they can never disagree.",
    source: ["conductor/core/gates-phase.ts:246"],
    forks: [
      {
        when: "repoConfigured is false",
        to: "tool.conductor_setup",
        outcome: "allow",
        effect: "Only conductor_setup and conductor_status are legal.",
      },
      {
        when: "Run is terminal",
        to: "tool.conductor_status",
        outcome: "allow",
        effect: "Only conductor_status, plus conductor_answer if an unanswered question exists.",
      },
      {
        when: "Non-terminal",
        to: "run.INTAKE",
        outcome: "allow",
        effect:
          "Meta tools (status/decide/surface/defer, plus answer when a question is open) are always " +
          "added, then the stage tools for the run's position.",
      },
    ],
  },
  {
    id: "gate.stage",
    label: "requireStageTool — the per-item legality step",
    kind: "gate",
    layer: "conductor",
    what:
      "What the six per-item stage handlers call before dispatching anything or writing any state. " +
      "Refuses an item not in queue.json, an item with no runtime file, and any scope entry that is not " +
      "repo-relative and inside the tree.",
    enforces:
      "The phase gate says WHICH tool; this says which ITEM. Without it a legal tool could be aimed at " +
      "an item that is blocked, deferred or dependency-unready.",
    source: ["conductor/adapter/tools.ts:3117", "conductor/adapter/tools.ts:3044"],
    forks: [
      { when: "The gate offers this tool for this item id", to: "item.PENDING", outcome: "allow" },
      {
        when: "Run not EXECUTING / item blocked / deferred / deps unpublished",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "stageDenyReason picks the most specific cause in order and names it — the questionId that " +
          "blocks it, the deferral, or the unpublished dependencies.",
      },
    ],
  },
];

const HATCH_NODES: readonly AtlasNode[] = [
  {
    id: "hatch.inline_claim",
    label: "conductor_inline_claim — the G8 scoped hatch",
    kind: "hatch",
    layer: "conductor",
    what:
      "Lets the orchestrator claim a narrow path scope and edit it directly, instead of dispatching a " +
      "sub-session for a one-line change.",
    enforces:
      "G8 — the alternative to a cheap legal hatch is an expensive illegal one. The claim is scoped: a " +
      "present-but-non-matching claim still denies.",
    source: ["conductor/core/gates-edit.ts:238", "conductor/core/tool-legality.ts:199"],
    caveat:
      "Without an active claim the orchestrator may not edit source at all: `use conductor_inline_claim " +
      "if dispatch is genuinely more expensive than doing`.",
  },
  {
    id: "hatch.override",
    label: "conductor_override — the budgeted, taint-recording hatch",
    kind: "hatch",
    layer: "conductor",
    what:
      "Spends one unit of a per-item and per-run budget to bypass one of exactly three gates: session, " +
      "git, edit. The itemId comes from the §3.5 registry, never from the model.",
    enforces:
      "§3.6 — an override is possible, costly and recorded. It marks the item TAINTED, so a run that " +
      "reached green by overriding says so in its own report.",
    source: ["conductor/adapter/tools.ts:9400", "conductor/core/tool-legality.ts:302"],
    logs: [
      {
        component: "gates",
        event: "override-granted",
        level: "warn",
        means:
          "A grant was issued. The gate decision that SPENDS it logs `gates: allow`; an over-budget " +
          "refusal logs `gates: deny`. Watch this name to see a run buying its way past a gate.",
      },
    ],
    forks: [
      {
        when: "Gate name is outside {session, git, edit}",
        to: "sink.journal",
        outcome: "deny",
        effect:
          "Refused BEFORE the budget check and spends NOTHING — no meter moves, no taint, no anomaly, " +
          "because `an override that can never be converted is not an override that happened`.",
      },
      { when: "Budget remains", to: "gate.entry", outcome: "allow", effect: "Grant issued; item tainted." },
      {
        when: "Run budget exhausted",
        to: "stop.env",
        outcome: "fail",
        effect: "handleOverride records a stop of kind `env` and the run ends.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Nodes — Part 3: the §3.1 Run FSM and the §3.3 Item FSM
// ---------------------------------------------------------------------------

const RUN_STATE_NODES: readonly AtlasNode[] = [
  {
    id: "run.INTAKE",
    label: "INTAKE",
    kind: "runState",
    layer: "conductor",
    member: runState("INTAKE"),
    what:
      "Where every run starts. conductor_classify decides whether the request is work, trivial or a " +
      "question, and the classification selects which of three exits is legal.",
    enforces:
      "The classification is cheap and is NOT trusted: a request classified trivial that turns out to " +
      "need real work is re-opened rather than forced through the wrong path.",
    source: ["conductor/core/fsm-run.ts:39"],
    forks: [
      { when: 'classification "work"', to: "run.DECOMPOSED", outcome: "advance" },
      { when: 'classification "question"', to: "run.ANSWERED", outcome: "advance" },
      { when: 'classification "trivial"', to: "run.EXECUTING", outcome: "advance" },
    ],
  },
  {
    id: "run.DECOMPOSED",
    label: "DECOMPOSED",
    kind: "runState",
    layer: "conductor",
    member: runState("DECOMPOSED"),
    what:
      "The request has been split into items, each with a fileScope, a testScope, a behavioral flag and " +
      "its dependsOn edges. The item DAG exists.",
    enforces:
      "Scope disjointness is decided here, once. It is what later lets a wave run in parallel without " +
      "two sessions racing on one file.",
    source: ["conductor/core/fsm-run.ts:44", "conductor/core/planning.ts:1"],
  },
  {
    id: "run.PLANNED",
    label: "PLANNED",
    kind: "runState",
    layer: "conductor",
    member: runState("PLANNED"),
    what: "A plan exists for the decomposed items — design content and acceptance clusters per item.",
    source: ["conductor/core/fsm-run.ts:45"],
  },
  {
    id: "run.PLAN_REVIEWED",
    label: "PLAN_REVIEWED",
    kind: "runState",
    layer: "conductor",
    member: runState("PLAN_REVIEWED"),
    what:
      "The plan survived adversarial review. Reached only on a CLEAN round (zero surviving majors) or " +
      "at the planReviewMaxRounds cap, at which point surviving majors are surfaced as questions and " +
      "the run proceeds on the rest.",
    enforces:
      "The majors-to-revise-to-re-review loop is INTERNAL to the handler and never regresses run state, " +
      "so a plan cannot ping-pong the FSM backwards.",
    source: ["conductor/core/fsm-run.ts:46", "conductor/core/fsm-run.ts:78"],
  },
  {
    id: "run.EXECUTING",
    label: "EXECUTING",
    kind: "runState",
    layer: "conductor",
    member: runState("EXECUTING"),
    what:
      "The work state. Items move through the §3.3 item FSM in waves; the run stays here until every " +
      "item is settled and conductor_report closes it.",
    source: ["conductor/core/fsm-run.ts:47"],
    forks: [
      { when: "All items settled, work run", to: "run.REPORTED", outcome: "advance" },
      { when: "All items settled, trivial run", to: "run.TRIVIAL_DONE", outcome: "advance" },
    ],
  },
  {
    id: "run.REPORTED",
    label: "REPORTED (terminal)",
    kind: "runState",
    layer: "conductor",
    member: runState("REPORTED"),
    what: "A work run closed by conductor_report, with a closing verify and a written report.md.",
    source: ["conductor/core/fsm-run.ts:48"],
  },
  {
    id: "run.TRIVIAL_DONE",
    label: "TRIVIAL_DONE (terminal)",
    kind: "runState",
    layer: "conductor",
    member: runState("TRIVIAL_DONE"),
    what: "A trivial run closed. Still requires every item to be settled — a trivial run is NOT exempt.",
    source: ["conductor/core/fsm-run.ts:49", "conductor/core/gates-phase.ts:390"],
  },
  {
    id: "run.ANSWERED",
    label: "ANSWERED (terminal)",
    kind: "runState",
    layer: "conductor",
    member: runState("ANSWERED"),
    what: "The request was a question and was answered. No items, no pipeline.",
    source: ["conductor/core/fsm-run.ts:50"],
  },
];

const FSM_ENGINE_NODES: readonly AtlasNode[] = [
  {
    id: "engine.fsm",
    label: "FSM adjudication",
    kind: "engine",
    layer: "conductor",
    what:
      "Both FSMs are pure functions over a plain context argument: the handler runs the work and this " +
      "only judges the evidence reported back. Terminality is DERIVED from the diagram (a state with no " +
      "successor) rather than restated as a second list that could drift.",
    enforces:
      "§3.1/§3.3 — a forward-only diagram. A second hand-written terminal list is a place for the two " +
      "to drift, and the drift is always toward a mutation reaching a finished run.",
    source: ["conductor/core/fsm-run.ts:1", "conductor/core/fsm-item.ts:1"],
    logs: [
      {
        component: "fsm",
        event: "transition",
        level: "info",
        means: "A state advanced. The backbone record for reconstructing what a run did.",
      },
      {
        component: "fsm",
        event: "refusal",
        level: "warn",
        means: "A transition was refused because its evidence did not satisfy the edge's gate.",
      },
      {
        component: "fsm",
        event: "guard-reject",
        level: "warn",
        means: "A guard on the edge rejected the move — for example a red claimed with a passing test.",
      },
      {
        component: "fsm",
        event: "invalid-transition",
        level: "error",
        means:
          "A move off the diagram entirely. The `why` names the legal successors of the current state, " +
          "so this record tells you where the run CAN go.",
      },
    ],
  },
];

const ITEM_STATE_NODES: readonly AtlasNode[] = [
  {
    id: "item.PENDING",
    label: "PENDING",
    kind: "itemState",
    layer: "conductor",
    member: itemState("PENDING"),
    what:
      "An item that has not started. Behavioral items go to RED first; non-behavioral items skip " +
      "straight to GREEN.",
    source: ["conductor/core/fsm-item.ts:15"],
    forks: [
      { when: "behavioral: true", to: "item.RED", outcome: "advance" },
      { when: "behavioral: false", to: "item.GREEN", outcome: "advance" },
    ],
  },
  {
    id: "item.RED",
    label: "RED",
    kind: "itemState",
    layer: "conductor",
    member: itemState("RED"),
    what:
      "A genuinely failing test exists for this item. The handler RUNS the test; the FSM judges the exit " +
      "code and the classified failure.",
    enforces:
      "§2.6.1 — a red must fail for the RIGHT reason. exit != 0 AND failureClass is `assertion` (the " +
      "behavior was evaluated and was wrong) or `missing-subject` (what this item builds does not exist " +
      "yet). Class `error` — a syntax or collection failure — is NOT a red, and a passing test is not a " +
      "red either.",
    source: ["conductor/core/fsm-item.ts:71"],
  },
  {
    id: "item.TEST_VETTED",
    label: "TEST_VETTED",
    kind: "itemState",
    layer: "conductor",
    member: itemState("TEST_VETTED"),
    what:
      "The red test survived adversarial vetting — critics checked it is not a mock test, a test-only " +
      "production method, or a test that would pass against a stub.",
    enforces:
      "§2.10 — a test nobody vetted proves whatever the implementer later makes it prove. The vet " +
      "happens BEFORE any implementation exists.",
    source: ["conductor/core/fsm-item.ts:18", "conductor/core/vet-criteria.ts:1"],
  },
  {
    id: "item.GREEN",
    label: "GREEN",
    kind: "itemState",
    layer: "conductor",
    member: itemState("GREEN"),
    what: "The implementation makes the vetted test pass.",
    source: ["conductor/core/fsm-item.ts:19"],
  },
  {
    id: "item.VALIDATED",
    label: "VALIDATED",
    kind: "itemState",
    layer: "conductor",
    member: itemState("VALIDATED"),
    what:
      "The green was re-verified independently, under the freshness rule, rather than taken from the " +
      "implementer's word.",
    enforces:
      "§2.6 — the claim is not the record. A verify runs against a frozen tree, which is why the edit " +
      "gate hard-freezes every write in that tree while a verify marker is live.",
    source: ["conductor/core/fsm-item.ts:20", "conductor/core/freshness.ts:1"],
  },
  {
    id: "item.REVIEWED",
    label: "REVIEWED",
    kind: "itemState",
    layer: "conductor",
    member: itemState("REVIEWED"),
    what:
      "Adversarial review ran and its surviving findings were dispatched as fix rounds. A finding " +
      "survives unless a refutation naming discriminatingInput, run AND reading refutes it; an " +
      "abstention UPHOLDS and a tie UPHOLDS.",
    enforces:
      "D11 — the burden is on the refuter. A vague 'looks fine to me' cannot kill a finding.",
    source: ["conductor/core/fsm-item.ts:21", "conductor/core/verdict.ts:40"],
    caveat:
      "Under §3.9 no-git mode an item TERMINATES here: publish is disabled and REVIEWED counts as " +
      "settled, with the diff recorded in the report instead.",
  },
  {
    id: "item.PUBLISHED",
    label: "PUBLISHED (terminal)",
    kind: "itemState",
    layer: "conductor",
    member: itemState("PUBLISHED"),
    what: "The item's work is committed into the workspace. This is the ONLY state that unlocks a dependent.",
    source: ["conductor/core/fsm-item.ts:22", "conductor/core/schedule.ts:72"],
  },
];

// ---------------------------------------------------------------------------
// Nodes — Part 4: the §3.4 tool inventory. Exactly the 22 names the plugin's
// `tool` hook registers; the parity test pins this list to CONDUCTOR_TOOL_NAMES.
// ---------------------------------------------------------------------------

function toolNode(
  name: string,
  label: string,
  what: string,
  source: readonly string[],
  extra: Partial<AtlasNode> = {},
): AtlasNode {
  return { id: `tool.${name}`, label, kind: "tool", layer: "conductor", member: name, what, source, ...extra };
}

const TOOL_NODES: readonly AtlasNode[] = [
  toolNode(
    "conductor_classify",
    "conductor_classify",
    "Decides work / trivial / question at INTAKE and advances the run down the matching branch.",
    ["conductor/core/gates-phase.ts:315", "conductor/core/tool-legality.ts:124"],
    { enforces: "Phase rule `once-at-intake`: legal once, and only while the run is unclassified." },
  ),
  toolNode(
    "conductor_decompose",
    "conductor_decompose",
    "Splits a work request into scoped items with a dependency DAG. Rejects placeholder labels and " +
      "overlapping scopes.",
    ["conductor/core/planning.ts:1", "conductor/core/gates-phase.ts:338"],
  ),
  toolNode(
    "conductor_plan",
    "conductor_plan",
    "Attaches design content and acceptance clusters to each decomposed item.",
    ["conductor/core/gates-phase.ts:338"],
  ),
  toolNode(
    "conductor_plan_review",
    "conductor_plan_review",
    "Runs a read fan-out of plan reviewers, counts surviving majors, and either loops for a revision or " +
      "advances at the round cap.",
    ["conductor/core/gates-phase.ts:344", "conductor/core/fsm-run.ts:78"],
  ),
  toolNode(
    "conductor_dispatch_wave",
    "conductor_dispatch_wave",
    "The run's work engine. Computes the next wave, creates worktrees when configured, and drives each " +
      "member through its stage. Offered repeatedly while the wave has members — not a one-shot entry edge.",
    ["conductor/adapter/tools.ts:6048", "conductor/core/schedule.ts:1"],
    {
      enforces:
        "Write-capable stages (submit_test, mark_green, publish) are SERIAL because the git index is a " +
        "singleton; every other stage is a read group that overlaps freely.",
    },
  ),
  toolNode(
    "conductor_submit_test",
    "conductor_submit_test",
    "Dispatches a testWriter to write the failing test, runs it, and moves PENDING to RED if the failure " +
      "is a legal red.",
    ["conductor/adapter/tools.ts:3819", "conductor/core/fsm-item.ts:71"],
  ),
  toolNode(
    "conductor_vet_test",
    "conductor_vet_test",
    "Runs vet critics against the red test before any implementation exists. A single `pass:false` bites.",
    ["conductor/core/vet-criteria.ts:1", "conductor/adapter/tools.ts:4271"],
  ),
  toolNode(
    "conductor_mark_green",
    "conductor_mark_green",
    "Dispatches an implementer to make the vetted test pass, then re-runs the test to record the green.",
    ["conductor/adapter/tools.ts:4959"],
  ),
  toolNode(
    "conductor_validate",
    "conductor_validate",
    "Independently re-verifies the green under the freshness rule, with the tree frozen for the duration.",
    ["conductor/adapter/tools.ts:5294", "conductor/core/freshness.ts:1"],
  ),
  toolNode(
    "conductor_item_review",
    "conductor_item_review",
    "Runs adversarial review, adjudicates each finding through the skeptic panel, and dispatches fix " +
      "rounds — testWriter first when a finding touches testScope, then implementer.",
    ["conductor/adapter/tools.ts:6952", "conductor/adapter/tools.ts:6377"],
  ),
  toolNode(
    "conductor_publish",
    "conductor_publish",
    "Stages fileScope + testScope minus the run's pre-existing dirty set, commits, and (under " +
      "commit-and-push) pushes. Merges a worktree back first when in worktree mode.",
    ["conductor/adapter/tools.ts:7994", "conductor/adapter/tools.ts:8075"],
    {
      caveat:
        "Suppressed entirely under §3.9 no-git mode, which is DERIVED from isRepo(root) — not from " +
        "git.mode, because `read-only` cannot distinguish 'a repo I may not write' from 'no repo at all'. " +
        "A failed push does NOT undo the commit; it is journaled as an error.",
    },
  ),
  toolNode(
    "conductor_report",
    "conductor_report",
    "Closes the run. Runs the closing verify, chooses the stop kind through the one total closer, and " +
      "writes report.md. Legal only when every item is settled.",
    ["conductor/adapter/tools.ts:9105", "conductor/core/gates-phase.ts:390"],
    {
      enforces:
        "The stop kind is computed BEFORE report.md is written, so the artifact and run.json can never " +
        "disagree about how the run ended.",
    },
  ),
  toolNode(
    "conductor_surface",
    "conductor_surface",
    "Raises a §2.11 question for a human. One of only two tools a sub-session may call.",
    ["conductor/core/tool-legality.ts:174", "conductor/adapter/questions.ts:1"],
    {
      logs: [
        {
          component: "state",
          event: "question.surfaced",
          level: "info",
          means:
            "A question was appended to the question ledger. Changes no item state on its own — the " +
            "block that accompanies it does.",
        },
      ],
    },
  ),
  toolNode(
    "conductor_answer",
    "conductor_answer",
    "Records a human's answer to a surfaced question and releases the items blocked on it.",
    ["conductor/adapter/questions.ts:1", "conductor/core/provenance.ts:1"],
    {
      enforces:
        "The record carries `answeredVia` — the channel the answer arrived through — plus a derived " +
        "`human` flag, so 'what did a human actually decide in this run?' has an answer a forged " +
        "human-in-the-loop cannot fake.",
      logs: [
        {
          component: "state",
          event: "question.answered",
          level: "info",
          means: "GAP-013's provenance record. `via` names the channel; `human` is derived from it.",
        },
        {
          component: "state",
          event: "run.resumed",
          level: "info",
          means:
            "A stop of a resumable kind (blocked / surfaced / noop) was CLEARED because the human " +
            "answered. `done`, `env` and `interrupt` are NOT resumable.",
        },
      ],
    },
  ),
  toolNode(
    "conductor_defer",
    "conductor_defer",
    "Marks an item deferred. A deferred item is settled for reporting and contributes no stage tool.",
    ["conductor/core/disposition.ts:95"],
    {
      caveat:
        "Deferring everything is caught: a settle with advancedItems === 0 closes the run `noop`, not " +
        "`done` (MACRO-007).",
    },
  ),
  toolNode(
    "conductor_decide",
    "conductor_decide",
    "Records a derived decision in the decision ledger, with its scored options and the human-territory " +
      "flag.",
    ["conductor/core/decide.ts:1"],
    {
      logs: [
        {
          component: "state",
          event: "decision.recorded",
          level: "info",
          means: "A decision was appended. Records no run/item state change, which is why it owns its own name.",
        },
      ],
    },
  ),
  toolNode(
    "conductor_queue_amend",
    "conductor_queue_amend",
    "Amends the item queue mid-run within bounded rules — it cannot rewrite history or un-publish work.",
    ["conductor/core/queue-amend.ts:1", "conductor/core/tool-legality.ts:194"],
  ),
  toolNode(
    "conductor_inline_claim",
    "conductor_inline_claim",
    "Claims a narrow path scope so the orchestrator can make a small edit directly instead of dispatching.",
    ["conductor/core/tool-legality.ts:199", "conductor/core/gates-edit.ts:238"],
  ),
  toolNode(
    "conductor_override",
    "conductor_override",
    "Spends budget to bypass one of the session / git / edit gates, tainting the item. One of only two " +
      "tools a sub-session may call.",
    ["conductor/adapter/tools.ts:9400", "conductor/core/tool-legality.ts:204"],
  ),
  toolNode(
    "conductor_status",
    "conductor_status",
    "Reads the run: position, items, questions, deliveries, taint and legal tools. Always legal, in " +
      "every phase, including on a terminal run.",
    ["conductor/core/tool-legality.ts:209"],
  ),
  toolNode(
    "conductor_setup",
    "conductor_setup",
    "Writes .conductor/config.json. Precedes every run; until it has run, only setup and status are legal.",
    ["conductor/core/gates-phase.ts:262"],
    {
      logs: [
        {
          component: "state",
          event: "config.updated",
          level: "info",
          means:
            "Setup wrote the config. `data.changes` carries the reconfigure diff and `data.answers` the " +
            "values it was answered with — including `acknowledgeNoTdd`, the one word that can turn the " +
            "TDD law off and which has no config field to land in (GAP-015).",
        },
      ],
    },
  ),
  toolNode(
    "conductor_forget_stale",
    "conductor_forget_stale",
    "Removes a named entry from the stale-red registry.",
    ["conductor/adapter/tools.ts:1"],
    {
      caveat:
        "Bound straight to the store's removeStaleRed with no handler of its own, and it is the ONLY " +
        "exit from the stale-red registry — a slow-growing false-green surface worth watching.",
    },
  ),
];

// ---------------------------------------------------------------------------
// Nodes — Part 5: the engines that drive a run between tool calls
// ---------------------------------------------------------------------------

const ENGINE_NODES: readonly AtlasNode[] = [
  {
    id: "engine.state",
    label: "The .conductor state store",
    kind: "engine",
    layer: "conductor",
    what:
      "Crash-safe reads and writes over `.conductor/`: run.json, queue.json, per-item files, and the " +
      "ledgers. Every id composed into a path is guarded so it cannot escape the state area.",
    enforces:
      "Handlers re-derive from persisted state rather than trusting what a previous handler said. The " +
      "wave driver reads its result back through the store, never from the handler's return value.",
    source: ["conductor/adapter/state.ts:1", "conductor/adapter/state.ts:397"],
    logs: [
      {
        component: "state",
        event: "run.created",
        level: "info",
        means: "A run directory exists and the run is live. The first record of any run.",
      },
      {
        component: "state",
        event: "item.updated",
        level: "info",
        means: "An item's persisted record moved. The workhorse record of the EXECUTING phase.",
      },
    ],
  },
  {
    id: "engine.schedule",
    label: "nextWave — wave computation",
    kind: "engine",
    layer: "conductor",
    what:
      "Computes the maximal set of items that are dependency-ready, pairwise fileScope-disjoint, not " +
      "blocked or deferred, within parallel.maxImplementers, and not already published. Order is DAG " +
      "depth ascending then id ascending — invariant under input reordering.",
    enforces:
      "§4.2 — parallelism is derived from declared scopes, not requested. Two items that could touch " +
      "the same file are never in one wave.",
    source: ["conductor/core/schedule.ts:1", "conductor/core/schedule.ts:185"],
    caveat:
      "Degenerate scopes SERIALIZE. An empty fileScope reads as disjoint from everything (the trap), and " +
      "a wildcard-headed glob matches everything — so both are treated as conflicting with every other " +
      "candidate rather than allowed to run wide.",
  },
  {
    id: "engine.fanout",
    label: "createFanout — the sub-session engine",
    kind: "engine",
    layer: "conductor",
    what:
      "Dispatches each wave member as a real opencode sub-session with its own role, model, tree and " +
      "doctrine. Groups jobs by resolved model and drains one group at a time.",
    enforces:
      "§3.5 — the registry entry is written BEFORE the sub-session's first prompt, so a child session " +
      "can never make a call the gates judge as unregistered.",
    source: ["conductor/adapter/fanout.ts:167", "conductor/adapter/fanout.ts:289"],
    logs: [
      {
        component: "fanout",
        event: "wave",
        level: "info",
        means:
          "A wave was dispatched. `data` carries {jobs, roles, items}. One record per WAVE, not per " +
          "job — the per-job records cannot be grouped back into waves after the fact, and the " +
          "per-tier cost table and the observation snapshot both read this.",
      },
      {
        component: "fanout",
        event: "subsession.dispatched",
        level: "info",
        means: "A sub-session started. `data` carries {role, itemId, tree, model}.",
      },
      {
        component: "fanout",
        event: "subsession.hold",
        level: "info",
        means:
          "A write-capable job was HELD (not denied) because its tree is frozen by a live verify. It " +
          "releases when the marker clears.",
      },
      {
        component: "fanout",
        event: "subsession.retry",
        level: "warn",
        means:
          "A receipt failed schema validation and the job was re-prompted with the concrete errors " +
          "appended. At most two retries — three prompt calls per session.",
      },
      {
        component: "fanout",
        event: "subsession.complete",
        level: "info",
        means:
          "The job finished. `data.ok` distinguishes success from failure; on failure `data.reason` is " +
          "session-create-failed, schema-invalid or engine-error.",
      },
      {
        component: "fanout",
        event: "subsession.abort",
        level: "warn",
        means:
          "The watchdog fired and killed a hung sub-session. `data` carries {reason: 'watchdog-timeout', " +
          "timeoutMs}. The watchdog is armed BEFORE session.create, so it bounds the entire job.",
      },
    ],
    caveat:
      "Structured output is PROMPT-SHAPED: no `format` field is ever put on the request body. The engine " +
      "validates each receipt itself against the pure core schema. Every fanout failure is classified " +
      "`env`, never a work failure.",
  },
  {
    id: "engine.evidence",
    label: "The evidence layer",
    kind: "engine",
    layer: "conductor",
    what:
      "Runs tests as real subprocesses, classifies their failures, and records red / green / verify " +
      "evidence with the tree and scope it applies to. Writes the verify marker that freezes a tree.",
    enforces:
      "§2.6 — a claim is not the record. The FSM reads THIS, not what the model said in prose.",
    source: ["conductor/adapter/evidence.ts:1"],
    logs: [
      {
        component: "evidence",
        event: "red",
        level: "info",
        means: "A failing test was recorded, with its exit code and classified failure.",
      },
      { component: "evidence", event: "green", level: "info", means: "A passing test was recorded." },
      {
        component: "evidence",
        event: "verify",
        level: "info",
        means:
          "An independent re-verification ran. While its marker is live the whole tree is frozen to " +
          "edits — this is the record that explains a burst of edit denials.",
      },
    ],
    caveat:
      "Exit codes 124, 126, 127 and >= 129 are treated as UNRUNNABLE rather than as a failing test — a " +
      "runner that could not run is an env problem, not a red.",
  },
  {
    id: "engine.disposition",
    label: "dispositionsOf — the one derivation",
    kind: "engine",
    layer: "conductor",
    what:
      "Folds every item into exactly one of four dispositions, worst-first: actionable, waiting-human, " +
      "stuck, settled. Computed as a fixpoint, so a dependsOn cycle terminates instead of recursing.",
    enforces:
      "MACRO-005 — four separate predicates used to answer 'is this run finished?' with subtly different " +
      "closures, and every recorded wedge lived in a disagreement between them. There is one now.",
    source: ["conductor/core/disposition.ts:37", "conductor/core/disposition.ts:112"],
    caveat:
      "There is deliberately no single-item `dispositionOf`: a disposition is not a property of an item " +
      "in isolation, because a dependency that can never publish dooms its dependents.",
  },
  {
    id: "engine.stops",
    label: "stopKindOf — the one total closer",
    kind: "engine",
    layer: "conductor",
    what:
      "Maps a cause (settle, closing-verify-red, futility, override-exhausted, transport, halt) to " +
      "exactly one of the six stop kinds. Every stop writer routes through it.",
    enforces:
      "D5-STRICT — `done` requires ALL of: cause settle, nothing actionable, nothing blocked, no open " +
      "question, nothing stuck, at least one advanced item, and no red closing verify. A settle over " +
      "live work fails closed to a kind that sends the operator looking, never to completion.",
    source: ["conductor/core/disposition.ts:289", "conductor/core/stops.ts:122"],
    caveat:
      "`closing-verify-red` has NO `done` branch at all. handleOverride is the one stop writer that does " +
      "not route through the closer — it writes the literal kind `env` (the value agrees; the routing " +
      "does not).",
  },
  {
    id: "engine.continuation",
    label: "The continuation engine",
    kind: "engine",
    layer: "conductor",
    what:
      "Watches for session idle and re-prompts the orchestrator when the run has work the gate can " +
      "still offer. Debounced at 2000ms from the last re-prompt.",
    enforces:
      "§3.7 — a local model stopping mid-run is normal. This is what keeps a run moving without an " +
      "operator poking it, and what ends one that cannot move.",
    source: ["conductor/adapter/continuation.ts:1", "conductor/adapter/continuation.ts:176"],
    logs: [
      {
        component: "continuation",
        event: "idle",
        level: "debug",
        means: "The session went idle and the engine took a pass.",
      },
      {
        component: "continuation",
        event: "reprompt",
        level: "info",
        means: "The orchestrator was re-prompted. Watch the count: three futile re-prompts stop the run.",
      },
      {
        component: "continuation",
        event: "disengage",
        level: "warn",
        means: "The engine stopped driving this run.",
      },
    ],
    caveat:
      "The futility signature deliberately EXCLUDES run.counters — a raw hash of run.json would reset " +
      "futility on every pass and the detector could never fire. It projects only classification, item " +
      "states and reasons, plan-review rounds, question answered-ness and run state.",
  },
  {
    id: "engine.router_client",
    label: "router-client — conductor's own HTTP to the router",
    kind: "engine",
    layer: "conductor",
    what:
      "Knows exactly one router endpoint, /conductor/metrics, and holds the failover latch. Never " +
      "rejects: a refused connection, a socket error or a hang all resolve to null.",
    enforces:
      "§4.4 fail-soft — a down router must never turn a request the direct path would have served into " +
      "an error. The first failure latches to the upstream; the second disables probing entirely.",
    source: ["conductor/adapter/router-client.ts:92", "conductor/adapter/router-client.ts:126"],
    logs: [
      {
        component: "router-client",
        event: "failover",
        level: "warn",
        means: "The latch moved. `data` carries {failovers, probingDisabled}.",
      },
      {
        component: "router-client",
        event: "response",
        level: "debug",
        means: "A metrics read succeeded or failed; `data.reason` says which.",
      },
      {
        component: "router-client",
        event: "request",
        level: "debug",
        means: "DECLARED IN THE VOCABULARY BUT NEVER EMITTED. No call site writes it — do not wait for it.",
        emitted: false,
      },
      {
        component: "router-client",
        event: "retry",
        level: "debug",
        means: "DECLARED IN THE VOCABULARY BUT NEVER EMITTED. No call site writes it — do not wait for it.",
        emitted: false,
      },
    ],
    caveat:
      "fetchMetricsSummary has NO production caller, so in a real session every report renders " +
      "`Router contact: ABSENT`. The latch also diverts only conductor's OWN HTTP — the run's model " +
      "traffic goes wherever opencode's session config points, and the plugin cannot re-point it.",
  },
];

// ---------------------------------------------------------------------------
// Nodes — Part 6: llama-router, the C++ proxy every model request crosses
// ---------------------------------------------------------------------------

const ROUTER_NODES: readonly AtlasNode[] = [
  {
    id: "router.listen",
    label: "llama-router — the httplib listener",
    kind: "router",
    layer: "router",
    what:
      "Sits in front of a separately launched llama-server and proxies /v1/*. Needs no live upstream at " +
      "construction — the upstream connection is made per proxied request.",
    enforces:
      "One endpoint in front of many models, so a fan-out of sub-sessions does not stampede the model " +
      "server. It links spdlog, cpp-httplib, nlohmann-json and json-schema-validator, and never links " +
      "llama itself.",
    source: ["router/router.hpp:505", "CMakeLists.txt:61"],
  },
  {
    id: "router.tags",
    label: "extract_and_strip_tags — read the four conductor tags",
    kind: "router",
    layer: "router",
    what:
      "Reads role, priority, group and schema from headers, falling back to a top-level `x_conductor` " +
      "body object. The `x_conductor` key is ALWAYS stripped before forwarding.",
    enforces:
      "The upstream must never see conductor's routing metadata. A body with no `x_conductor` key — " +
      "non-JSON bodies included — is forwarded BYTE-verbatim rather than re-serialized.",
    source: ["router/router.hpp:454", "router/router.hpp:1316"],
    caveat:
      "X-Conductor-Role and X-Conductor-Priority are FIXED names with no config knob; group and schema " +
      "are read under configured names. Per tag the header wins over the body; a mismatch logs at debug.",
  },
  {
    id: "router.observe",
    label: "observe_request — the schema observer",
    kind: "router",
    layer: "router",
    what:
      "Runs for EVERY /v1/* request, GET included. A request tagged X-Conductor-Schema: required is " +
      "checked for an actual structured-output declaration in three arms: a json_schema response_format, " +
      "a non-empty GBNF `grammar` string, or a top-level `json_schema` object.",
    enforces:
      "A session that CLAIMS it needs structured output and does not ask for it is the silent failure " +
      "mode that makes a whole fan-out return prose the parser rejects. The count makes it visible.",
    source: ["router/schema-observer.hpp:189", "router/router.hpp:700"],
    caveat:
      "Response-side conformance is only observable on the BUFFERED path. Fan-out traffic streams, so " +
      "real sub-session requests always record schemaConformed: null.",
  },
  {
    id: "router.reject",
    label: "400 schema_missing (optional posture)",
    kind: "router",
    layer: "router",
    what:
      "When schema.rejectOnMissing is true, a tagged-but-schemaless POST is refused BEFORE admission " +
      "with a 400 naming both the resolved header and the literal config key.",
    source: ["router/router.hpp:736", "router/router.hpp:1270"],
    forks: [
      { when: "rejectOnMissing false (default)", to: "router.admit", outcome: "allow", effect: "Counted, not refused." },
      {
        when: "rejectOnMissing true and the request is tagged-and-schemaless",
        to: "",
        outcome: "deny",
        effect: '400 `{"error":{"type":"invalid_request_error","code":"schema_missing"}}`',
      },
    ],
    caveat:
      "The refusal is a posture; the COUNT is the observation. schema_missing_count increments either " +
      "way and is monotonic per Router instance.",
  },
  {
    id: "router.admit",
    label: "AdmissionController::admit — per-model concurrency",
    kind: "router",
    layer: "router",
    what:
      "Blocks the handler thread until a slot for this model is free, a timeout elapses, or the queue " +
      "overflows. One priority-ordered queue; queueWaitMs is measured across exactly this call.",
    enforces:
      "A local machine serves one model at a time well and several badly. Admission is what stops a " +
      "wave of sub-sessions from thrashing the weights.",
    source: ["router/admission.hpp:133", "router/admission.hpp:229"],
    forks: [
      { when: "A slot is free for this model", to: "router.relay", outcome: "allow" },
      {
        when: "Queue is full",
        to: "",
        outcome: "deny",
        effect: '503 immediately, never after a wait — code `queue_overflow`.',
      },
      {
        when: "Queued past queueTimeoutMs",
        to: "",
        outcome: "deny",
        effect: "503 — code `queue_timeout`. The waiter erases itself from the queue.",
      },
      {
        when: "A NEW distinct model key past the distinct-key bound",
        to: "",
        outcome: "deny",
        effect:
          "503 overflow with no wait. The bound is 1 + (8-1)/maxInflightPerModel, so a client-chosen " +
          "model string cannot exhaust the pool and starve /conductor/health (ISSUE-042).",
      },
    ],
    caveat:
      "The timeout/overflow distinction is DIAGNOSTIC ONLY. The fan-out reaches the router through " +
      "opencode's provider fetch, which surfaces a failure as an error string with no body — so nothing " +
      "in conductor backs off on these codes. Non-POST requests skip admission entirely and record " +
      "queueWaitMs 0.",
  },
  {
    id: "router.affinity",
    label: "AffinityPolicy — group burst ordering",
    kind: "router",
    layer: "router",
    what:
      "Chooses which queued waiter goes next within the highest-priority class. With contiguousDequeue " +
      "on, a group drains as a burst bounded by the arrivals present when the burst started.",
    enforces:
      "Members arriving mid-drain fall OUTSIDE the burst and wait for the group's next turn, which stops " +
      "a busy group starving its neighbours. Affinity can push an untagged request back but can never " +
      "pull one forward.",
    source: ["router/affinity.hpp:88", "router/affinity.hpp:29"],
  },
  {
    id: "router.relay",
    label: "relayToUpstream — buffered or chunked",
    kind: "router",
    layer: "router",
    what:
      "Opens a fresh client to the upstream, spawns one worker thread per call, and relays either a " +
      "buffered body or a chunked stream. Usage and timings are scraped from SSE events as they pass, " +
      "never buffered.",
    source: ["router/router.hpp:846", "router/router.hpp:331"],
    forks: [
      { when: "Upstream answers", to: "sink.router_ledger", outcome: "allow" },
      {
        when: "Upstream unreachable, or dies mid-body on the buffered path",
        to: "sink.router_ledger",
        outcome: "fail",
        effect: '502 `{"error":{"type":"router_upstream_unreachable"}}`',
      },
      {
        when: "Upstream fails mid-STREAM",
        to: "sink.router_ledger",
        outcome: "fail",
        effect:
          "NO envelope. The chunked response is aborted WITHOUT its terminating chunk rather than ended " +
          "cleanly, so the client can tell truncation from completion.",
      },
    ],
    caveat:
      "The admission slot is held in a shared_ptr the streaming content provider also captures, so the " +
      "slot returns when the LAST holder dies — not when the handler frame exits.",
  },
  {
    id: "router.health",
    label: "GET /conductor/health",
    kind: "router",
    layer: "router",
    what: 'Returns 200 `{"status":"ok","version":"..."}`.',
    enforces:
      "Registered OUTSIDE admission, so it answers while every slot and every queue entry is held. A " +
      "health check that queues behind the work it is checking on is not a health check.",
    source: ["router/router.hpp:646"],
  },
];

// ---------------------------------------------------------------------------
// Nodes — Part 7: every telemetry sink in the harness, and the six stop kinds
// ---------------------------------------------------------------------------

const SINK_NODES: readonly AtlasNode[] = [
  {
    id: "sink.journal",
    label: "journal.jsonl — the leveled run journal",
    kind: "sink",
    layer: "workspace",
    what:
      "`.conductor/runs/<runId>/journal.jsonl`. One complete JSON line per record, appended " +
      "synchronously. Fields: seq, ts, level, component, runId, itemId?, sessionID?, event, data.",
    enforces:
      "§7.4 — 'logs you can't grep by name are logs you can't debug'. Every emittable event name is " +
      "enumerated in one file and an unlisted name is caught at its source.",
    source: ["conductor/adapter/journal.ts:167", "conductor/core/journal-events.ts:54"],
    caveat:
      "The default file level is `info`, so debug and trace records are ABSENT unless you raise it. " +
      "error and warn are always written regardless of threshold. Set CONDUCTOR_LOG=trace (or " +
      "`component:level` pairs) to see everything; an unknown level in that variable is IGNORED rather " +
      "than allowed to silence a component by typo. Records past ~32 KiB are truncated with " +
      "`data.truncated = true`, and the file rotates to journal.N.jsonl.gz past retention.maxRunDirBytes " +
      "(256 MiB default).",
  },
  {
    id: "sink.stderr",
    label: "Plugin stderr — the pre-run sink",
    kind: "sink",
    layer: "conductor",
    what:
      "One console.error line of JSON per record, UNFILTERED. It is the only sink that exists before a " +
      "run directory does.",
    source: ["conductor/plugin/index.ts:363"],
    caveat:
      "Pre-rebind records are NOT replayed into journal.jsonl. If conductor fails during init — a " +
      "missing doctrine pack, a contended lock — the ONLY trace is here. Capture opencode's stderr " +
      "before starting a live test.",
  },
  {
    id: "sink.evidence",
    label: "The evidence ledger",
    kind: "sink",
    layer: "workspace",
    what: "Per-run record of every test run: red, green and verify, with tree, scope, exit code and class.",
    source: ["conductor/adapter/evidence.ts:1"],
  },
  {
    id: "sink.decisions",
    label: "The decision ledger",
    kind: "sink",
    layer: "workspace",
    what: "Append-only record of derived decisions with scored options and the human-territory flag.",
    source: ["conductor/core/decide.ts:1"],
  },
  {
    id: "sink.questions",
    label: "The question ledger",
    kind: "sink",
    layer: "workspace",
    what:
      "`questions.jsonl` — every §2.11 question, its answer, the channel the answer arrived on, and the " +
      "derived human flag. Tolerant to a torn line rather than throwing.",
    source: ["conductor/adapter/state.ts:487", "conductor/adapter/jsonl.ts:1"],
  },
  {
    id: "sink.anomalies",
    label: "The anomaly ledger",
    kind: "sink",
    layer: "workspace",
    what: "§2.8 anomalies — the gate crashes and other events that should not have happened.",
    source: ["conductor/adapter/state.ts:1"],
  },
  {
    id: "sink.report",
    label: "report.md — the terminal artifact",
    kind: "sink",
    layer: "workspace",
    what:
      "Every terminal path writes one, through ONE writer. A stop-report runs no closing verify and " +
      "enforces no all-settled precondition; every section is fail-soft.",
    enforces:
      "A run that ended has a document saying how. The stop kind is chosen before the file is written so " +
      "the artifact and run.json agree.",
    source: ["conductor/adapter/tools.ts:8885"],
    logs: [
      {
        component: "state",
        event: "run.stop-report",
        level: "info",
        means: "The terminal artifact was written for a run whose stop some other component recorded.",
      },
    ],
  },
  {
    id: "sink.router_ledger",
    label: "The router metrics ledger",
    kind: "sink",
    layer: "router",
    what:
      "One JSONL line per /v1/* request, 12 keys always present: model, role, group, priority, " +
      "queueWaitMs, upstreamMs, promptTokens, completionTokens, timings, schemaMissing, schemaConformed, " +
      "status. Written by a destructor, so exactly one line per request on every exit path.",
    enforces:
      "The RAII guard means the capacity refusal, the 502 and the streamed completion each yield exactly " +
      "one line and none can be forgotten by a `return` a later edit routes around.",
    source: ["router/metrics.hpp:50", "router/router.hpp:684"],
    caveat:
      "A write failure is warn-logged and NEVER thrown — the counters still advance. /conductor/health " +
      "and /conductor/metrics are never ledgered and never counted.",
  },
  {
    id: "sink.router_metrics",
    label: "GET /conductor/metrics — the in-memory aggregate",
    kind: "sink",
    layer: "router",
    what:
      "Nine keys: totalRequests, schemaMissing, schemaConformed, statusCounts, promptTokens, " +
      "completionTokens, waitMsP50, waitMsP95, schemaConformanceRate. Outside admission, so it answers " +
      "at a full queue.",
    source: ["router/metrics.hpp:102", "router/router.hpp:658"],
    caveat:
      "IN-MEMORY SINCE CONSTRUCTION — a prior run's ledger file contributes nothing, and this is not read " +
      "back out of the file. Every request's queueWaitMs enters the percentile sample, zeros included. " +
      "schemaConformanceRate is null (never 0) when there are no verdicts.",
  },
  {
    id: "sink.router_stderr",
    label: "Router stderr (spdlog)",
    kind: "sink",
    layer: "router",
    what:
      "The router's own log. Carries the admission refusals at warn, every tagged-and-missing schema " +
      "request at warn, tag mismatches and unknown priority strings at debug, and the mid-stream " +
      "upstream failure.",
    source: ["router/router.hpp:1254", "router/router.hpp:712"],
  },
  {
    id: "sink.opencode",
    label: "opencode's own session log",
    kind: "sink",
    layer: "opencode",
    what:
      "The host's view: tool calls, chat turns, and the errors conductor's G5 fail-soft swallowed to keep " +
      "the session alive.",
    source: ["conductor/plugin/index.ts:1"],
    caveat:
      "This is the sink that shows a hook throwing when conductor's own journal cannot, because a hook " +
      "that fails before the workspace opens has no run directory to write to.",
  },
  {
    id: "sink.llama_server",
    label: "llama-server stderr",
    kind: "sink",
    layer: "router",
    what:
      "The model server underneath the router: token rates, context sizes, and weight-swap timing. Useful " +
      "for performance diagnosis, mostly noise for logic diagnosis.",
    source: ["scripts/serve.py:1"],
  },
];

const STOP_NODES: readonly AtlasNode[] = [
  {
    id: "stop.done",
    label: "done",
    kind: "stop",
    layer: "conductor",
    member: stopKind("done"),
    what:
      "The only success kind, and the hardest to reach: cause settle, nothing actionable, nothing " +
      "blocked, no open question, nothing stuck, at least one advanced item, and no red closing verify.",
    source: ["conductor/core/disposition.ts:283"],
  },
  {
    id: "stop.noop",
    label: "noop",
    kind: "stop",
    layer: "conductor",
    member: stopKind("noop"),
    what:
      "Nothing advanced. Either three futile re-prompts (the continuation engine gave up) or a settle " +
      "with advancedItems === 0 — the defer-everything escape.",
    source: ["conductor/core/disposition.ts:323", "conductor/core/stops.ts:145"],
  },
  {
    id: "stop.blocked",
    label: "blocked",
    kind: "stop",
    layer: "conductor",
    member: stopKind("blocked"),
    what:
      "The run cannot proceed. Blocked items with no answerable question, a stuck disposition, a settle " +
      "over live work, or a closing verify that failed on an assertion.",
    source: ["conductor/core/disposition.ts:305"],
  },
  {
    id: "stop.surfaced",
    label: "surfaced",
    kind: "stop",
    layer: "conductor",
    member: stopKind("surfaced"),
    what: "The run is waiting on a human: questions are open and the operator has to answer them.",
    source: ["conductor/core/disposition.ts:323"],
  },
  {
    id: "stop.env",
    label: "env",
    kind: "stop",
    layer: "conductor",
    member: stopKind("env"),
    what:
      "The environment failed, not the work: a transport floor of five consecutive send failures, an " +
      "exhausted override budget, or a closing verify whose runner could not run at all.",
    source: ["conductor/core/disposition.ts:293", "conductor/adapter/continuation.ts:1107"],
  },
  {
    id: "stop.interrupt",
    label: "interrupt",
    kind: "stop",
    layer: "conductor",
    member: stopKind("interrupt"),
    what: "A halt file was observed. The operator stopped the run deliberately.",
    source: ["conductor/adapter/continuation.ts:817"],
  },
];

// ---------------------------------------------------------------------------
// Edges — the editorial half. No module states the pipeline order in one place,
// so a person writes it. The parity test checks only that both endpoints of
// every edge name a real node; the ORDER is reviewed by reading, not by a test.
// ---------------------------------------------------------------------------

const EDGES: readonly AtlasEdge[] = [
  // Entry and per-request init.
  { from: "entry.prompt", to: "hook.chat.message", kind: "flow", label: "prompt enters the session" },
  { from: "entry.prompt", to: "hook.system.transform", kind: "flow", label: "every request" },
  { from: "hook.chat.message", to: "init.ensurePacks", kind: "flow" },
  { from: "hook.system.transform", to: "init.ensurePacks", kind: "flow" },
  { from: "init.ensurePacks", to: "init.ensureWorkspace", kind: "flow", label: "packs load first (ISSUE-004)" },
  { from: "init.ensureWorkspace", to: "lock.run", kind: "flow" },
  { from: "lock.run", to: "beacon.alive", kind: "flow", label: "on acquire" },
  { from: "lock.run", to: "sink.journal", kind: "write", label: "contended / stale-break" },

  // Injection.
  { from: "init.ensureWorkspace", to: "inject.compose", kind: "flow" },
  { from: "inject.compose", to: "inject.packs", kind: "flow" },
  { from: "inject.packs", to: "inject.stateBlock", kind: "flow", label: "state block is always last" },
  { from: "inject.compose", to: "sink.journal", kind: "write", label: "inject/system-append receipt" },
  { from: "gate.phase", to: "inject.stateBlock", kind: "read", label: "same legalTools derivation" },
  { from: "inject.stateBlock", to: "entry.model", kind: "flow", label: "system prompt" },
  { from: "hook.chat.params", to: "entry.model", kind: "flow", label: "temperature" },
  { from: "hook.chat.headers", to: "entry.model", kind: "flow", label: "X-Conductor-* tags" },

  // The model request crosses the router.
  { from: "entry.model", to: "router.listen", kind: "flow", label: "POST /v1/chat/completions" },
  { from: "router.listen", to: "router.tags", kind: "flow" },
  { from: "router.tags", to: "router.observe", kind: "flow" },
  { from: "router.observe", to: "router.reject", kind: "flow" },
  { from: "router.reject", to: "router.admit", kind: "flow", label: "POST only" },
  { from: "router.admit", to: "router.affinity", kind: "flow", label: "when queued" },
  { from: "router.affinity", to: "router.relay", kind: "flow" },
  { from: "router.admit", to: "router.relay", kind: "flow", label: "slot free" },
  { from: "router.relay", to: "sink.router_ledger", kind: "write", label: "one line per request" },
  { from: "router.relay", to: "sink.router_metrics", kind: "write", label: "in-memory counters" },
  { from: "router.relay", to: "sink.llama_server", kind: "flow", label: "upstream" },
  { from: "router.listen", to: "router.health", kind: "flow", label: "outside admission" },
  { from: "router.listen", to: "sink.router_stderr", kind: "write" },
  { from: "engine.router_client", to: "sink.router_metrics", kind: "read", label: "GET /conductor/metrics" },

  // The reply comes back and the model calls a tool.
  { from: "entry.model", to: "hook.tool.before", kind: "flow", label: "model calls a tool" },
  { from: "hook.tool.before", to: "gate.entry", kind: "flow" },
  { from: "gate.entry", to: "gate.crash", kind: "flow", label: "each decision is wrapped" },
  { from: "gate.entry", to: "gate.patch", kind: "flow", label: "(a0)" },
  { from: "gate.patch", to: "gate.spawn", kind: "flow" },
  { from: "gate.spawn", to: "gate.session", kind: "flow", label: "(a)" },
  { from: "gate.session", to: "gate.git", kind: "flow", label: "(b) bash only" },
  { from: "gate.git", to: "gate.interpreter", kind: "flow" },
  { from: "gate.interpreter", to: "gate.writeshape", kind: "flow" },
  { from: "gate.writeshape", to: "gate.edit", kind: "flow", label: "once per write target" },
  { from: "gate.edit", to: "gate.legality", kind: "flow", label: "(c) conductor_* only" },
  { from: "gate.legality", to: "gate.phase", kind: "flow" },
  { from: "gate.phase", to: "gate.stage", kind: "flow", label: "per-item stage tools" },
  { from: "gate.entry", to: "sink.journal", kind: "write", label: "deny / allow / snapshot" },
  { from: "gate.crash", to: "sink.anomalies", kind: "write", label: "§2.8 anomaly" },
  { from: "hatch.inline_claim", to: "gate.edit", kind: "flow", label: "widens the orchestrator's scope" },
  { from: "hatch.override", to: "gate.entry", kind: "flow", label: "spends budget, taints the item" },
  { from: "hatch.override", to: "stop.env", kind: "flow", label: "budget exhausted" },

  // The run FSM.
  { from: "gate.stage", to: "tool.conductor_classify", kind: "flow" },
  { from: "tool.conductor_classify", to: "run.INTAKE", kind: "flow" },
  { from: "run.INTAKE", to: "tool.conductor_decompose", kind: "flow", label: "work" },
  { from: "run.INTAKE", to: "run.ANSWERED", kind: "flow", label: "question" },
  { from: "run.INTAKE", to: "run.EXECUTING", kind: "flow", label: "trivial" },
  { from: "tool.conductor_decompose", to: "run.DECOMPOSED", kind: "flow" },
  { from: "run.DECOMPOSED", to: "tool.conductor_plan", kind: "flow" },
  { from: "tool.conductor_plan", to: "run.PLANNED", kind: "flow" },
  { from: "run.PLANNED", to: "tool.conductor_plan_review", kind: "flow" },
  { from: "tool.conductor_plan_review", to: "run.PLAN_REVIEWED", kind: "flow", label: "clean round or round cap" },
  { from: "run.PLAN_REVIEWED", to: "tool.conductor_dispatch_wave", kind: "flow" },
  { from: "tool.conductor_dispatch_wave", to: "run.EXECUTING", kind: "flow" },
  { from: "engine.fsm", to: "sink.journal", kind: "write", label: "transition / refusal / guard-reject" },

  // The work engine.
  { from: "run.EXECUTING", to: "engine.schedule", kind: "flow", label: "nextWave" },
  { from: "engine.schedule", to: "engine.fanout", kind: "flow", label: "dispatch the wave" },
  { from: "engine.fanout", to: "entry.model", kind: "spawn", label: "one sub-session per member" },
  { from: "engine.fanout", to: "sink.journal", kind: "write", label: "subsession.*" },

  // The item FSM.
  { from: "engine.fanout", to: "item.PENDING", kind: "flow" },
  { from: "item.PENDING", to: "tool.conductor_submit_test", kind: "flow", label: "behavioral" },
  { from: "tool.conductor_submit_test", to: "item.RED", kind: "flow" },
  { from: "item.RED", to: "tool.conductor_vet_test", kind: "flow" },
  { from: "tool.conductor_vet_test", to: "item.TEST_VETTED", kind: "flow" },
  { from: "item.TEST_VETTED", to: "tool.conductor_mark_green", kind: "flow" },
  { from: "item.PENDING", to: "tool.conductor_mark_green", kind: "flow", label: "non-behavioral" },
  { from: "tool.conductor_mark_green", to: "item.GREEN", kind: "flow" },
  { from: "item.GREEN", to: "tool.conductor_validate", kind: "flow" },
  { from: "tool.conductor_validate", to: "item.VALIDATED", kind: "flow" },
  { from: "item.VALIDATED", to: "tool.conductor_item_review", kind: "flow" },
  { from: "tool.conductor_item_review", to: "item.REVIEWED", kind: "flow" },
  { from: "item.REVIEWED", to: "tool.conductor_publish", kind: "flow", label: "suppressed under §3.9 no-git" },
  { from: "tool.conductor_publish", to: "item.PUBLISHED", kind: "flow" },
  { from: "item.PUBLISHED", to: "engine.schedule", kind: "flow", label: "unlocks dependents" },
  { from: "engine.evidence", to: "item.RED", kind: "read", label: "the FSM judges evidence, not prose" },
  { from: "engine.evidence", to: "item.GREEN", kind: "read" },
  { from: "engine.evidence", to: "item.VALIDATED", kind: "read" },
  { from: "engine.evidence", to: "gate.edit", kind: "write", label: "verify marker freezes the tree" },
  { from: "engine.evidence", to: "sink.evidence", kind: "write" },
  { from: "engine.evidence", to: "sink.journal", kind: "write", label: "red / green / verify" },
  { from: "engine.state", to: "sink.journal", kind: "write", label: "run.created / item.updated" },

  // Questions and decisions.
  { from: "tool.conductor_surface", to: "sink.questions", kind: "write" },
  { from: "tool.conductor_answer", to: "sink.questions", kind: "write" },
  { from: "tool.conductor_decide", to: "sink.decisions", kind: "write" },
  { from: "tool.conductor_answer", to: "run.EXECUTING", kind: "flow", label: "releases blocked items" },

  // Closing.
  { from: "run.EXECUTING", to: "tool.conductor_report", kind: "flow", label: "all items settled" },
  { from: "engine.disposition", to: "tool.conductor_report", kind: "read", label: "settledForReport" },
  { from: "tool.conductor_report", to: "engine.stops", kind: "flow" },
  { from: "engine.stops", to: "run.REPORTED", kind: "flow", label: "work run" },
  { from: "engine.stops", to: "run.TRIVIAL_DONE", kind: "flow", label: "trivial run" },
  { from: "engine.stops", to: "sink.report", kind: "write" },
  { from: "engine.stops", to: "stop.done", kind: "flow" },
  { from: "engine.stops", to: "stop.noop", kind: "flow" },
  { from: "engine.stops", to: "stop.blocked", kind: "flow" },
  { from: "engine.stops", to: "stop.surfaced", kind: "flow" },
  { from: "engine.stops", to: "stop.env", kind: "flow" },
  { from: "engine.stops", to: "stop.interrupt", kind: "flow" },

  // The continuation loop, which runs between everything above.
  { from: "hook.event", to: "engine.continuation", kind: "flow", label: "session idle" },
  { from: "engine.continuation", to: "entry.prompt", kind: "flow", label: "re-prompt (debounced 2000ms)" },
  { from: "engine.continuation", to: "engine.stops", kind: "flow", label: "futility / transport floor / halt" },
  { from: "engine.continuation", to: "sink.journal", kind: "write", label: "idle / reprompt / disengage" },
  { from: "gate.phase", to: "engine.continuation", kind: "read", label: "is there a lever left?" },
  { from: "engine.disposition", to: "engine.stops", kind: "read", label: "worst-first fold" },
  { from: "engine.router_client", to: "sink.journal", kind: "write", label: "failover / response" },
  { from: "init.ensurePacks", to: "sink.stderr", kind: "write", label: "pre-run failures land here only" },
  { from: "tool.conductor_setup", to: "sink.journal", kind: "write", label: "config.updated" },
  { from: "sink.journal", to: "sink.opencode", kind: "flow", label: "swallowed throws surface here" },
];

// ---------------------------------------------------------------------------
// The atlas. ONE value export (the vocab-registry.ts precedent): the parity test
// and the renderer both read this, and nothing in the runtime path does.
// ---------------------------------------------------------------------------

export const ATLAS: Atlas = {
  nodes: [
    ...ENTRY_NODES,
    ...HOOK_NODES,
    ...INIT_NODES,
    ...INJECT_NODES,
    ...GATE_NODES,
    ...HATCH_NODES,
    ...RUN_STATE_NODES,
    ...FSM_ENGINE_NODES,
    ...ITEM_STATE_NODES,
    ...TOOL_NODES,
    ...ENGINE_NODES,
    ...ROUTER_NODES,
    ...SINK_NODES,
    ...STOP_NODES,
  ],
  edges: EDGES,
};
