// conductor/tests/atlas.test.ts — the ATLAS PARITY GUARD.
//
// SUBJECT: conductor/tools/atlas.ts, the end-to-end map of a prompt's journey
// through opencode, conductor and llama-router.
//
// WHY THIS FILE EXISTS. A map of a system is worth exactly what its accuracy is
// worth, and a hand-maintained one decays silently: the map keeps rendering, keeps
// looking authoritative, and stops describing the code. That is the same defect
// class the documentation campaign spent 506 corrections on, and the answer is the
// same one vocab-registry.ts uses for cross-language spelling — pin the members to
// the code and let a test fail the day they diverge.
//
// WHAT IS PINNED. The atlas NODE SET, in both directions, against five closed
// vocabularies the code already owns:
//
//   CONDUCTOR_TOOL_NAMES  (adapter/tools.ts)      -> kind "tool"
//   RUN_STATES            (core/fsm-run.ts)       -> kind "runState"
//   ITEM_STATES           (core/fsm-item.ts)      -> kind "itemState"
//   STOP_KINDS            (core/stops.ts)         -> kind "stop"
//   declaredHookKeys()    (core/wiring-manifest.ts) -> kind "hook"
//   EVENTS                (core/journal-events.ts) -> some node's `logs`
//
// Both directions matter and catch opposite defects. Vocabulary-to-atlas catches
// GROWTH the map never heard about — a gate added, a tool registered, an event
// widened. Atlas-to-vocabulary catches ROT — a node describing a tool that was
// deleted, which is how a map starts lying while still passing a spot check.
//
// WHAT IS NOT PINNED, and deliberately. The EDGE set and the prose. No module
// states the pipeline order in one place, so a person writes it and a reader
// checks it. What IS mechanized about the edges is referential integrity: every
// endpoint and every fork target must name a node that exists, so the graph can
// never render a dangling arrow.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ATLAS } from "../tools/atlas.ts";
import type { AtlasNode } from "../tools/atlas.ts";
import { COMPONENTS, EVENTS, isKnownEvent } from "../core/journal-events.ts";
import { RUN_STATES } from "../core/fsm-run.ts";
import { ITEM_STATES } from "../core/fsm-item.ts";
import { STOP_KINDS } from "../core/stops.ts";
import { declaredHookKeys } from "../core/wiring-manifest.ts";
import { CONDUCTOR_TOOL_NAMES } from "../adapter/tools.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "..", "..");

// Anti-vacuity floors (C-045). A map that shrank to nothing, or a filter that
// stopped matching, must be RED rather than a vacuous pass over an empty set.
const MIN_NODES = 80;
const MIN_EDGES = 60;

function membersOfKind(kind: AtlasNode["kind"]): string[] {
  return ATLAS.nodes.filter((n) => n.kind === kind).map((n) => n.member ?? `<node ${n.id} has no member>`);
}

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

// ---------------------------------------------------------------------------
// Structural integrity
// ---------------------------------------------------------------------------

test("[atlas-floors] the atlas holds a real map — node and edge counts are above the anti-vacuity floor, so a collapsed map or a broken filter is red rather than a silent pass over an empty set", () => {
  assert.ok(
    ATLAS.nodes.length >= MIN_NODES,
    `the atlas holds only ${ATLAS.nodes.length} nodes (floor ${MIN_NODES}) — a map this small is not describing this system`,
  );
  assert.ok(
    ATLAS.edges.length >= MIN_EDGES,
    `the atlas holds only ${ATLAS.edges.length} edges (floor ${MIN_EDGES})`,
  );
});

test("[atlas-unique-ids] every node id is unique — a duplicate id makes one node unreachable in the rendered graph and silently swallows whichever of the two the renderer indexes second", () => {
  const seen = new Map<string, number>();
  for (const n of ATLAS.nodes) seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  assert.deepEqual(dupes, [], "these node ids appear more than once");
});

test("[atlas-referential-integrity] every edge endpoint and every fork target names a node that exists — the one mechanical property the editorial edge set must still hold, so the graph can never render a dangling arrow", () => {
  const ids = new Set(ATLAS.nodes.map((n) => n.id));
  const dangling: string[] = [];

  for (const e of ATLAS.edges) {
    if (!ids.has(e.from)) dangling.push(`edge.from "${e.from}" (-> ${e.to})`);
    if (!ids.has(e.to)) dangling.push(`edge.to "${e.to}" (from ${e.from})`);
  }
  for (const n of ATLAS.nodes) {
    for (const f of n.forks ?? []) {
      // "" is the sanctioned spelling for a fork that leaves the graph (an HTTP
      // response to a client conductor never sees again).
      if (f.to !== "" && !ids.has(f.to)) dangling.push(`fork target "${f.to}" on node ${n.id}`);
    }
  }
  assert.deepEqual(dangling, [], "these references name no node in the atlas");
});

test("[atlas-source-files-exist] every `path:line` anchor names a file that is really on disk — a source reference to a deleted or moved file is how a map keeps looking authoritative after the code left", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const n of ATLAS.nodes) {
    assert.ok(n.source.length > 0, `node ${n.id} cites no source`);
    for (const ref of n.source) {
      const colon = ref.lastIndexOf(":");
      const file = colon === -1 ? ref : ref.slice(0, colon);
      checked += 1;
      if (!existsSync(path.join(repoRoot, file))) missing.push(`${n.id} -> ${ref}`);
    }
  }
  assert.ok(checked > 100, `only ${checked} source anchors were checked — the walk is not reaching the atlas`);
  assert.deepEqual(missing, [], "these source anchors name a file that does not exist");
});

// ---------------------------------------------------------------------------
// The five vocabulary pins, both directions
// ---------------------------------------------------------------------------

test("[atlas-pins-tools] the atlas names exactly the 22 §3.4 conductor_* tools — a tool registered without a node is growth the map never heard about; a node naming a deleted tool is rot", () => {
  assert.deepEqual(sorted(membersOfKind("tool")), sorted(CONDUCTOR_TOOL_NAMES));
});

test("[atlas-pins-run-states] the atlas names exactly the eight §3.1 run FSM positions", () => {
  assert.deepEqual(sorted(membersOfKind("runState")), sorted(RUN_STATES));
});

test("[atlas-pins-item-states] the atlas names exactly the seven §3.3 item FSM positions", () => {
  assert.deepEqual(sorted(membersOfKind("itemState")), sorted(ITEM_STATES));
});

test("[atlas-pins-stop-kinds] the atlas names exactly the six §2.9 stop kinds — the closed vocabulary a run can end under", () => {
  assert.deepEqual(sorted(membersOfKind("stop")), sorted(STOP_KINDS));
});

test("[atlas-pins-hooks] the atlas names exactly the opencode hook keys the wiring manifest declares — register a seventh hook without a node and this goes red, which is the ISSUE-001 shape applied to the map", () => {
  assert.deepEqual(sorted(membersOfKind("hook")), sorted(declaredHookKeys()));
});

// ---------------------------------------------------------------------------
// The journal-event pin — the axis that makes a LIVE view possible
// ---------------------------------------------------------------------------

test("[atlas-covers-every-journal-event] every name in the closed §7.4 vocabulary is claimed by some atlas node — this is what lets a live journal tail light up the node that emitted a record, and an unclaimed event is a record no view can place", () => {
  const claimed = new Set<string>();
  for (const n of ATLAS.nodes) {
    for (const l of n.logs ?? []) claimed.add(`${l.component}/${l.event}`);
  }

  const unclaimed: string[] = [];
  for (const component of COMPONENTS) {
    for (const event of EVENTS[component]) {
      if (!claimed.has(`${component}/${event}`)) unclaimed.push(`${component}/${event}`);
    }
  }
  assert.deepEqual(
    unclaimed,
    [],
    "these journal events are emittable but no atlas node claims them — add the log point to the node " +
      "that emits it, or the live view will show a record it cannot place on the graph",
  );
});

test("[atlas-claims-only-real-events] no atlas node claims a component/event pair outside the closed vocabulary — a node advertising a log line that can never be written sends a debugger looking for a record that does not exist", () => {
  const bogus: string[] = [];
  for (const n of ATLAS.nodes) {
    for (const l of n.logs ?? []) {
      if (!isKnownEvent(l.component, l.event)) bogus.push(`${n.id} claims ${l.component}/${l.event}`);
    }
  }
  assert.deepEqual(bogus, [], "these claimed events are not in the §7.4 vocabulary");
});

test("[atlas-records-unemitted-events] the atlas marks the vocabulary names that NO call site writes — router-client's `request` and `retry` are declared and never emitted, and a map that hides that fact sends an operator waiting forever for a line that never comes", () => {
  const unemitted = new Set<string>();
  for (const n of ATLAS.nodes) {
    for (const l of n.logs ?? []) {
      if (l.emitted === false) unemitted.add(`${l.component}/${l.event}`);
    }
  }
  assert.ok(
    unemitted.has("router-client/request") && unemitted.has("router-client/retry"),
    `the two known never-emitted names must stay flagged; flagged set was ${JSON.stringify([...unemitted])}`,
  );
});

// ---------------------------------------------------------------------------
// Content floors — a node that says nothing is decoration
// ---------------------------------------------------------------------------

test("[atlas-nodes-say-something] every node carries a non-trivial `what`, and every gate carries the rule it `enforces` — a gate node with no stated purpose cannot answer the question the map exists to answer", () => {
  const thin: string[] = [];
  for (const n of ATLAS.nodes) {
    if (n.what.trim().length < 40) thin.push(`${n.id}: what is ${n.what.trim().length} chars`);
    if (n.kind === "gate" && (n.enforces === undefined || n.enforces.trim().length < 40)) {
      thin.push(`${n.id}: a gate with no stated enforcement`);
    }
  }
  assert.deepEqual(thin, [], "these nodes are too thin to be useful");
});

test("[atlas-discrimination] the pin analyzer proves it CAN fail — a checker that cannot demonstrate a failure is decorative (ISSUE-128)", () => {
  // Vocabulary-to-atlas: a member with no node is reported.
  const toolMembers = new Set(membersOfKind("tool"));
  assert.ok(
    !toolMembers.has("conductor_does_not_exist"),
    "sanity: the atlas must not already carry the synthetic name",
  );
  const withGhost = sorted([...CONDUCTOR_TOOL_NAMES, "conductor_does_not_exist"]);
  assert.notDeepEqual(
    sorted([...toolMembers]),
    withGhost,
    "a tool added to the vocabulary but not to the atlas must make the pin unequal",
  );

  // Atlas-to-vocabulary: a node naming a deleted member is reported.
  const withRot = sorted([...toolMembers, "conductor_deleted_tool"]);
  assert.notDeepEqual(
    withRot,
    sorted(CONDUCTOR_TOOL_NAMES),
    "a node naming a tool that no longer exists must make the pin unequal",
  );

  // Referential integrity really resolves ids rather than accepting any string.
  const ids = new Set(ATLAS.nodes.map((n) => n.id));
  assert.ok(!ids.has("gate.nonexistent"), "sanity: the synthetic id must be absent");
  assert.ok(ids.has("gate.entry"), "sanity: a known id must resolve, or the check is matching nothing");
});
