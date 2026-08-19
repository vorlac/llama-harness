// conductor/core/mechanics.ts — GAP-005: ONE source for what the doctrine packs
// say about the machine, and the reader the dispatch prompts compose their
// doctrine slice with.
//
// Two jobs, both single-source:
//
//   (1) renderMechanics(pack) DERIVES a short mechanics section for a doctrine
//       pack out of the machine itself — the closed tool vocabulary
//       (./tool-bindings.ts) and the legality machine (./gates-phase.ts). The
//       packs carry the rendered text between the two markers below, and
//       conductor/tests/doctrine-mechanics.test.ts fails the moment a pack's
//       embedded block differs from a fresh derivation. A tool renamed, a stage
//       inserted, an FSM edge moved: the guard goes red and the packs are
//       regenerated. Hand-written pack mechanics drift silently; derived ones
//       cannot, which is the whole point.
//
//   (2) packSection(text, heading) reads ONE named section out of a pack, so a
//       dispatch prompt can carry that section VERBATIM instead of re-spelling
//       its rules in a prompt literal (ISSUE-003: doctrine lived in two unguarded
//       spellings and the unguarded one was the one the model weighted).
//
// The stage sequences are derived by ASKING legalTools what it recommends at each
// FSM position rather than by listing the tools here. A second hand-written list
// is exactly the defect this module exists to remove, and the walk is cheap: it
// is pure computation over ~14 synthetic positions.
//
// Core module (G3): pure — no I/O, no clock, no runtime globals.

import { legalTools } from "./gates-phase.ts";
import type { GateItem, GateRun } from "./gates-phase.ts";
import { ITEM_STATES } from "./fsm-item.ts";
import { TOOL_BINDINGS } from "./tool-bindings.ts";
import { TOOL_LEGALITY } from "./tool-legality.ts";
import { renderReplyProtocol } from "./reply-protocol.ts";
import { renderVetCriteria } from "./vet-criteria.ts";

// The markers that fence the generated section inside a pack. HTML comments, so
// they carry no weight in the rendered doctrine a model reads, and greppable, so
// the guard test can prove there is exactly one block per pack.
export const MECHANICS_BEGIN = "<!-- BEGIN GENERATED MECHANICS -->";
export const MECHANICS_END = "<!-- END GENERATED MECHANICS -->";

// ---------------------------------------------------------------------------
// The derivation: ask the legality machine, never restate it.
// ---------------------------------------------------------------------------

function syntheticRun(state: string, classification: string | null): GateRun {
  return {
    state,
    stop: null,
    classification: classification === null ? null : { kind: classification },
  };
}

function syntheticItem(state: string, behavioral: boolean): GateItem {
  return {
    id: "I1",
    state,
    behavioral,
    dependsOn: [],
    fileScope: ["src/a.ts"],
    blocked: null,
    deferred: null,
  };
}

// The two gate inputs this call site fixes, NAMED rather than passed as bare
// literals, because they mean something different here than at a production call
// site. conductor/tests/legaltools-callsites.test.ts exists to stop a shipped
// VERDICT inheriting or hardcoding `publishEnabled` — a verdict describes one
// workspace, so it must read that workspace. This call site produces no verdict:
// it renders the pipeline the FSM defines into a CHECKED-IN pack, so it must not
// vary with any workspace's git mode or setup state, and both inputs are pinned
// at the fullest pipeline. conductor/tests/doctrine-mechanics.test.ts pins that
// these two constants — and only these two — stand behind this call.
const DESCRIBES_CONFIGURED_REPO = true;
const DESCRIBES_FULL_PIPELINE = true;

// What legalTools recommends at one position, plus whether that recommendation is
// a PER-ITEM stage tool (it carries an itemId) or a run-level one. The two are
// separated by the shape of the recommendation itself, not by a name list.
function recommendationAt(
  run: GateRun,
  items: GateItem[],
): { tool: string; perItem: boolean } | null {
  const verdict = legalTools(run, items, [], DESCRIBES_CONFIGURED_REPO, DESCRIBES_FULL_PIPELINE);
  if (verdict.recommended === null) return null;
  return { tool: verdict.recommended.tool, perItem: verdict.recommended.args.itemId !== undefined };
}

function pushUnique(seq: string[], tool: string): void {
  if (!seq.includes(tool)) seq.push(tool);
}

// The §3.2 run pipeline, in FSM order, as the gate actually recommends it: the
// unclassified INTAKE, the work-classified INTAKE, each intermediate run state,
// and an EXECUTING run whose only item is settled (which is where the report
// becomes the recommendation).
export function runStageTools(): string[] {
  const seq: string[] = [];
  const positions: ReadonlyArray<readonly [string, string | null]> = [
    ["INTAKE", null],
    ["INTAKE", "work"],
    ["DECOMPOSED", "work"],
    ["PLANNED", "work"],
    ["PLAN_REVIEWED", "work"],
    ["EXECUTING", "work"],
  ];
  for (const [state, kind] of positions) {
    const items = state === "EXECUTING" ? [syntheticItem("PUBLISHED", true)] : [];
    const rec = recommendationAt(syntheticRun(state, kind), items);
    if (rec !== null && !rec.perItem) pushUnique(seq, rec.tool);
  }
  return seq;
}

// The §3.3 item pipeline, in FSM order: for a lone behavioral item at each item
// state, the stage tool the gate recommends. PUBLISHED contributes none (it is
// terminal), so the sequence ends where the FSM does.
export function itemStageTools(): string[] {
  const seq: string[] = [];
  for (const state of ITEM_STATES) {
    const rec = recommendationAt(syntheticRun("EXECUTING", "work"), [syntheticItem(state, true)]);
    if (rec !== null && rec.perItem) pushUnique(seq, rec.tool);
  }
  return seq;
}

// Where a NON-behavioral item enters the item pipeline (it owes no red, so it
// skips the test stages). Derived, so the doctrine cannot claim an entry point
// the gate does not offer.
export function nonBehavioralEntryTool(): string {
  const rec = recommendationAt(syntheticRun("EXECUTING", "work"), [syntheticItem("PENDING", false)]);
  return rec === null ? "" : rec.tool;
}

// Every bound tool that is not a stage tool: the meta vocabulary, sorted. Derived
// by SUBTRACTION from the closed binding table, so a tool added to the table
// lands in one of the two lists automatically and can never go unnamed.
export function metaTools(): string[] {
  const stage = new Set([...runStageTools(), ...itemStageTools()]);
  return Object.keys(TOOL_BINDINGS)
    .filter((name) => TOOL_BINDINGS[name] !== null && !stage.has(name))
    .sort();
}

// The tools a DISPATCHED sub-session may call, sorted — read straight off the
// §3.5 caller column of the legality table (GAP-006). Derived rather than
// written out, because a doctrine sentence naming a tool the choke point refuses
// (or omitting one it allows) sends a sub-session to spend a turn finding out.
export function subSessionTools(): string[] {
  return Object.keys(TOOL_LEGALITY)
    .filter((name) => TOOL_LEGALITY[name].callers.includes("sub-session"))
    .sort();
}

// ---------------------------------------------------------------------------
// The rendered section, per pack.
// ---------------------------------------------------------------------------

type MechanicsSection = "run" | "item" | "meta" | "callers" | "criteria" | "replies";

// Which derived facts each pack's readers need. A planner never runs an item
// stage tool and an implementer never runs the run pipeline, so handing every
// pack every line would spend a 32k context window on mechanics the reader
// cannot act on. core.md is the orchestrator's pack and gets all three.
const PACK_SECTIONS: Readonly<Record<string, readonly MechanicsSection[]>> = {
  "core.md": ["run", "item", "meta", "callers"],
  "decompose.md": ["run", "callers"],
  "plan.md": ["run", "callers"],
  "tdd.md": ["item", "callers"],
  "test-vet.md": ["item", "callers", "criteria"],
  "debug.md": ["item", "callers"],
  "review.md": ["item", "callers"],
  "skeptic.md": ["run", "item", "callers"],
  "receive-review.md": ["item", "callers", "replies"],
};

export function renderMechanics(pack: string): string {
  const sections = PACK_SECTIONS[pack];
  if (sections === undefined) {
    throw new Error(
      `conductor: no mechanics profile for doctrine pack "${pack}" — add it to PACK_SECTIONS ` +
        "in core/mechanics.ts (a pack with no profile would carry hand-written mechanics)",
    );
  }
  const lines: string[] = ["## Mechanics — generated from the tool vocabulary", ""];
  if (sections.includes("run")) {
    lines.push("Run stages, in FSM order: " + runStageTools().join(" -> ") + ".");
  }
  if (sections.includes("item")) {
    lines.push(
      "Item stages, in FSM order: " +
        itemStageTools().join(" -> ") +
        ". A non-behavioral item enters at " +
        nonBehavioralEntryTool() +
        ".",
    );
  }
  if (sections.includes("meta")) {
    lines.push("Meta tools, outside the stage order: " + metaTools().join(", ") + ".");
  }
  if (sections.includes("callers")) {
    lines.push(
      "A dispatched sub-session may call only: " +
        subSessionTools().join(", ") +
        ". Every other conductor tool belongs to the orchestrator, and a call from a dispatched " +
        "session is refused by name — a session cannot answer its own question, defer its own " +
        "item, close its own run or widen its own scope.",
    );
  }
  lines.push(
    "",
    "The harness re-derives which of these is legal on every request and names the one it " +
      "recommends. A call out of order is refused, not negotiated.",
  );
  // GAP-041: the §2.10 vet checklist is derived too, from ./vet-criteria.ts — the
  // same list SCHEMAS.TestVet validates a critic receipt against and both vet
  // prompts carry. A pack that taught a checklist of its own prepared its reader
  // for a different examination than the one the harness scores.
  if (sections.includes("criteria")) {
    lines.push("", renderVetCriteria());
  }
  // GAP-040: the reply statuses and the exact concern token, derived from
  // ./reply-protocol.ts — which derives the statuses from the schema enum itself.
  // They existed only inside dispatch prompt literals, so the doctrine told a
  // fixer to push back while naming no channel to push back ON.
  if (sections.includes("replies")) {
    lines.push("", renderReplyProtocol());
  }
  return lines.join("\n");
}

// The generated section WITH its markers — what a pack embeds verbatim.
export function mechanicsBlock(pack: string): string {
  return MECHANICS_BEGIN + "\n" + renderMechanics(pack) + "\n" + MECHANICS_END;
}

// The body a pack currently carries between the markers, or null when the pack
// carries no (or a malformed) block.
export function extractMechanics(text: string): string | null {
  const start = text.indexOf(MECHANICS_BEGIN);
  if (start < 0) return null;
  const bodyStart = start + MECHANICS_BEGIN.length;
  const end = text.indexOf(MECHANICS_END, bodyStart);
  if (end < 0) return null;
  return text.slice(bodyStart, end).trim();
}

// ---------------------------------------------------------------------------
// packSection — the reader a dispatch prompt composes its doctrine slice with.
// ---------------------------------------------------------------------------

/**
 * One `## <heading>` section of a doctrine pack, heading line included, verbatim.
 * Returns null when the pack carries no such section — the caller decides whether
 * that is a refusal (a dispatch that needs the doctrine) or a fallback.
 *
 * The section ends at the next `## ` heading or at either marker of the generated
 * mechanics block, whichever comes first — so a section adjacent to the block
 * never swallows it, and a section rendered INSIDE it (the §2.10 vet checklist)
 * reads back without its closing marker.
 */
export function packSection(text: string, heading: string): string | null {
  const lines = text.split("\n");
  const wanted = "## " + heading;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === wanted) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("## ") || trimmed === MECHANICS_BEGIN || trimmed === MECHANICS_END) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end).join("\n").trim();
  return body.length === 0 ? null : body;
}
