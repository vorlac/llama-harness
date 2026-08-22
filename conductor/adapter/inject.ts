// conductor/adapter/inject.ts — Task 8.2: the §6.4 system-prompt injection layer
// (plan lines 1892-1903, §4.1 roles table 1512-1543, §4.4 router headers 1636-1698,
// §3.8 liveness beacon 1478-1495). Four concerns, one seam:
//   - buildSystemAppend: the `experimental.chat.system.transform` body — the role's
//     doctrine pack(s) verbatim, then a live state block RE-STATED every request and
//     never remembered (G9). A pure function of its inputs.
//   - paramsForRole:     the `chat.params` sampling table (§4.1).
//   - headersFor:        the `chat.headers` §4.4 router tags.
//   - composeDelivery:   the ONE call the composition root makes per request — the
//     three above answered together, plus the receipt fields (which packs, their
//     digest) the §7.4 journal record carries. It exists so the plugin's three
//     hooks cannot each compose a DIFFERENT delivery for the same session: the
//     headers a request is tagged with and the doctrine it carries are two halves
//     of one decision, and the router's affinity is a lie the moment they diverge.
//   - loadPacks/initPlugin: the §6.4 fail-closed init — a missing pack is a startup
//     error surfaced BEFORE the §3.8 beacon is written, so the beacon's ABSENCE
//     proves init failed. loadPacks/initPlugin are the ONLY filesystem-touching
//     functions here; the transform helpers are pure (no I/O, no clock, no
//     randomness), so identical inputs yield byte-identical output (G9).
//
// ADAPTER (G14): the pure helpers borrow only the core `legalTools` derivation
// (§3.1: one legality verdict, three consumers, they can never disagree). The two
// init functions use only node:fs / node:path — no single-runtime global, no shell
// tag, no top-level await — so this runs under BOTH Node type-stripping and the
// alternate opencode plugin runtime.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { legalTools } from "../core/gates-phase.ts";
import type { GateRun, GateItem, GateQuestion } from "../core/gates-phase.ts";
import type { SessionRegistryEntry } from "./chat-message.ts";

// ---------------------------------------------------------------------------
// §4.1 roles table — the per-role selections a single model still varies.
// ---------------------------------------------------------------------------

// Role -> doctrine pack file(s) (§4.1 col 2). append[0] is ALWAYS the first entry
// (the session's primary doctrine), verbatim from the cached pack map; a role with a
// secondary pack contributes it as a further entry before the state block.
const ROLE_PACKS: Record<string, readonly string[]> = {
  orchestrator: ["core.md"],
  planner: ["decompose.md", "plan.md"],
  testWriter: ["tdd.md"],
  implementer: ["tdd.md"],
  reviewer: ["review.md", "test-vet.md"],
  skeptic: ["skeptic.md"],
  mechanical: ["core.md"],
};

// Role -> sampling temperature (§4.1 col 3).
const ROLE_TEMPERATURE: Record<string, number> = {
  orchestrator: 0.4,
  planner: 0.7,
  testWriter: 0.5,
  implementer: 0.4,
  reviewer: 0.3,
  skeptic: 0.3,
  mechanical: 0.1,
};

// Role -> §4.4 priority tag (interactive | review | batch), derived from §4.1 col 5.
const ROLE_PRIORITY: Record<string, string> = {
  orchestrator: "interactive",
  planner: "interactive",
  testWriter: "review",
  implementer: "review",
  reviewer: "review",
  skeptic: "review",
  mechanical: "batch",
};

// The nine doctrine packs §6.4 loads once at init (the seven role packs plus
// debug.md and receive-review.md). debug.md IS delivered by buildSystemAppend on an
// implementer's DEBUG posture (§4.1). receive-review.md is delivered by
// buildSystemAppend on the registry entry's `receivingReview` signal — the mark the
// §3.3 review-fix routing puts on exactly the dispatches that receive review
// findings (C-028: a pack that is loaded but never delivered governs nothing).
const REQUIRED_PACKS: readonly string[] = [
  "core.md",
  "decompose.md",
  "plan.md",
  "tdd.md",
  "test-vet.md",
  "debug.md",
  "review.md",
  "skeptic.md",
  "receive-review.md",
];

// ---------------------------------------------------------------------------
// (a) buildSystemAppend — doctrine pack(s) + the live state block.
// ---------------------------------------------------------------------------

// The trailing options object §6.4 needs but its ledger arg list omits: what
// buildSystemAppend forwards to legalTools (repoConfigured) plus the two scalars the
// state block reports that are derivable from neither items nor questions.
export interface InjectCtx {
  repoConfigured: boolean;
  // §3.9: whether conductor_publish can work at all in this workspace, i.e.
  // gitio.isRepo(root). REQUIRED rather than optional, and threaded rather than
  // derived here, for two reasons: buildSystemAppend runs on EVERY prompt and
  // isRepo shells out to git, and a caller that must name its git mode cannot
  // forget to have one. Without it the state block names conductor_publish as
  // the next tool in a run where the handler always refuses it (C-054).
  publishEnabled: boolean;
  taintCount: number;
  overridesRemaining: number;
}

// Render the live state block — the LAST append entry, ≤30 lines, re-stated every
// request. It SUMMARIZES: it names only the single recommended tool (and, for a
// sub-session, its own active item), never the full item list, so it stays bounded
// no matter how many items the run carries. The other legal tools are folded into a
// numeric COUNT — never a second "do this" that would contradict the recommendation.
function renderStateBlock(
  registryEntry: SessionRegistryEntry,
  run: GateRun,
  items: GateItem[],
  questions: GateQuestion[],
  ctx: InjectCtx,
): string {
  const verdict = legalTools(run, items, questions, ctx.repoConfigured, ctx.publishEnabled);
  const recommended = verdict.recommended;
  // The recommended tool is always one of the legal tools, so the count of the
  // OTHER legal tools excludes it (and excludes nothing when nothing is recommended).
  const otherLegal = verdict.legal.size - (recommended !== null ? 1 : 0);

  const openQuestions = questions.filter((q) => q.answeredIso === null).length;
  const blocked = items.filter((it) => it.blocked !== null).length;
  const deferred = items.filter((it) => it.deferred !== null).length;

  const lines: string[] = [];
  lines.push("Conductor live state — re-stated every request (§6.4), never remembered.");
  lines.push(`Run state: ${run.state}`);

  // A sub-session bound to an item reports THAT item's id and FSM state (the block's
  // focus is its own work, not the whole run's item list).
  if (registryEntry.itemId !== undefined) {
    const active = items.find((it) => it.id === registryEntry.itemId);
    if (active !== undefined) {
      lines.push(`Active item: ${active.id} (${active.state})`);
    } else {
      lines.push(`Active item: ${registryEntry.itemId} (not in the current item set)`);
    }
  }

  // The single recommended next tool "with its args" — its name, and, when it is a
  // per-item stage tool, the id it targets. A terminal run recommends nothing, and we
  // name no tool for it. No OTHER legal tool is ever named here — only counted below.
  if (recommended === null) {
    // No hardcoded terminality claim: legalTools already computed the AUTHORITATIVE
    // reason nothing is recommended (terminal run, stalled EXECUTING wave, non-work
    // INTAKE, …). Render it verbatim so the block is never falsely "terminal".
    lines.push(`Recommended next tool: none. ${verdict.why}`);
  } else if (recommended.args.itemId !== undefined) {
    lines.push(`Recommended next tool: ${recommended.tool} on ${recommended.args.itemId}`);
  } else {
    lines.push(`Recommended next tool: ${recommended.tool}`);
  }

  lines.push(`Other legal tools available now: ${otherLegal} (call conductor_status to enumerate them).`);
  lines.push(`Open questions: ${openQuestions}`);
  lines.push(`Items blocked: ${blocked} · deferred: ${deferred}`);
  lines.push(`Taint count: ${ctx.taintCount} · overrides remaining: ${ctx.overridesRemaining}`);

  return lines.join("\n");
}

/**
 * The single next tool the state block names, as DATA.
 *
 * The block renders it into a sentence a human reads; the §7.4 receipt records it
 * as a field an observer can score. Both come from this one call into legalTools,
 * so a receipt that disagreed with the block it accompanies is not constructible —
 * and without the field, "recommended vs actual", the signal that names a model
 * ignoring its own state block sixteen turns running, is unrecorded on every run.
 */
export function recommendedToolOf(
  run: GateRun,
  items: GateItem[],
  questions: GateQuestion[],
  ctx: InjectCtx,
): { tool: string | null; itemId: string | null } {
  const recommended = legalTools(run, items, questions, ctx.repoConfigured, ctx.publishEnabled).recommended;
  if (recommended === null) return { tool: null, itemId: null };
  const itemId = recommended.args.itemId;
  return { tool: recommended.tool, itemId: typeof itemId === "string" ? itemId : null };
}

// The state block for a workspace that has no live run: the §3.2 fact that a run
// is created when the orchestrator receives a prompt. It is a SEPARATE rendering
// rather than renderStateBlock over a fabricated run, because every field that
// block reports (state, recommendation, counts) would be an invention here, and a
// state block that invents the run state is worse than one that says there is none.
export function renderNoRunStateBlock(): string {
  return [
    "Conductor live state — re-stated every request (§6.4), never remembered.",
    "Run state: none — this workspace has no live conductor run.",
    "Recommended next tool: none. A run is created when the orchestrator receives a prompt (§3.2); " +
      "conductor_status reports what this workspace already holds.",
  ].join("\n");
}

// The §4.1 pack files this session's delivery carries, in order: the role's
// primary pack first, then the posture-conditional secondaries. Exported so a
// caller can NAME what was delivered (the §7.4 receipt) without re-deriving the
// selection rule — two spellings of "which pack does this role get" is the
// ISSUE-003 shape, one directory over.
export function packFilesFor(
  registryEntry: SessionRegistryEntry,
  items: GateItem[],
): string[] {
  const packFiles = [...(ROLE_PACKS[registryEntry.role] ?? ["core.md"])];
  // §4.1: an implementer whose ACTIVE item is in DEBUG posture also receives
  // debug.md as a secondary pack (tdd.md stays the primary, append[0]). Guard it
  // tightly — non-implementer roles, a missing/unknown itemId, or a non-debugging
  // item get nothing extra — and never duplicate debug.md if it is already listed.
  if (registryEntry.role === "implementer" && registryEntry.itemId !== undefined) {
    const activeItem = items.find((it) => it.id === registryEntry.itemId);
    if (activeItem?.debugging === true && !packFiles.includes("debug.md")) {
      packFiles.push("debug.md");
    }
  }
  // §3.3/C-028: a fix dispatch that receives review findings also receives doctrine
  // receive-review.md as a SECONDARY pack (the role's primary pack stays append[0]),
  // de-duplicated exactly as debug.md is. The signal rides the §3.5 registry entry
  // the fan-out engine wrote for that dispatch — never the item's state, so the SAME
  // item's other dispatches (a debug fix, a green fix) receive nothing extra.
  if (registryEntry.receivingReview === true && !packFiles.includes("receive-review.md")) {
    packFiles.push("receive-review.md");
  }
  return packFiles;
}

// The pack CONTENTS for a selection, verbatim from the cached map. A pack the map
// does not carry contributes nothing rather than an "undefined" string; the empty
// fallback guarantees append[0] is always a string and the state block is always
// the last entry, whatever the cache holds.
function packTextsFor(packFiles: string[], packs: Record<string, string>): string[] {
  const texts: string[] = [];
  for (const file of packFiles) {
    const content = packs[file];
    if (content !== undefined) texts.push(content);
  }
  if (texts.length === 0) texts.push("");
  return texts;
}

// The `experimental.chat.system.transform` body: [ primaryPack, ...secondaryPacks,
// stateBlock ]. append[0] is the role's primary doctrine pack VERBATIM from the
// cached map; the LAST entry is the live state block. An unknown role falls back to
// core.md (the orchestrator/mechanical lite doctrine) so an unregistered session
// still receives grounding rather than an empty system append.
export function buildSystemAppend(
  registryEntry: SessionRegistryEntry,
  run: GateRun,
  items: GateItem[],
  questions: GateQuestion[],
  packs: Record<string, string>,
  ctx: InjectCtx,
): string[] {
  const append = packTextsFor(packFilesFor(registryEntry, items), packs);
  append.push(renderStateBlock(registryEntry, run, items, questions, ctx));
  return append;
}

// ---------------------------------------------------------------------------
// (b) paramsForRole — the `chat.params` sampling table (§4.1).
// ---------------------------------------------------------------------------

export function paramsForRole(role: string): { temperature: number; topP?: number } {
  return { temperature: ROLE_TEMPERATURE[role] ?? 0.4 };
}

// ---------------------------------------------------------------------------
// (c) headersFor — the `chat.headers` §4.4 router tags.
// ---------------------------------------------------------------------------

// The §4.4 prefix-affinity group id: the natural KV-hot grouping key is the session's
// worktree/tree; failing that, the item it works on. Bare sessions with neither (a
// tree-less orchestrator) have no group, and the header is OMITTED entirely so the
// router treats the request as ungrouped.
function groupOf(registryEntry: SessionRegistryEntry): string | null {
  if (typeof registryEntry.tree === "string" && registryEntry.tree.length > 0) {
    return registryEntry.tree;
  }
  if (typeof registryEntry.itemId === "string" && registryEntry.itemId.length > 0) {
    return registryEntry.itemId;
  }
  return null;
}

export function headersFor(
  registryEntry: SessionRegistryEntry,
  job?: { schema?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Conductor-Role": registryEntry.role,
    "X-Conductor-Priority": ROLE_PRIORITY[registryEntry.role] ?? "interactive",
  };
  const group = groupOf(registryEntry);
  if (group !== null) headers["X-Conductor-Group"] = group;
  // §4.4: X-Conductor-Schema: required ONLY when the job flags structured output.
  if (job?.schema === true) headers["X-Conductor-Schema"] = "required";
  return headers;
}

// ---------------------------------------------------------------------------
// (d) composeDelivery — the three above, answered together, plus the receipt.
// ---------------------------------------------------------------------------

// The persisted facts the live state block reports. Assembled by the composition
// root from the store (the ONE place that reads the run directory) and handed here
// as data, which is what keeps this function pure and testable without a workspace.
export interface DeliveryState {
  run: GateRun;
  items: GateItem[];
  questions: GateQuestion[];
  ctx: InjectCtx;
}

// Everything one dispatched request must carry, plus what the §7.4 receipt names.
// `packDigest` is over the delivered pack CONTENT, so a doctrine directory swapped
// under a live run changes the trail even when the file names do not (C-028: a
// receipt that names only file names cannot tell two doctrines apart).
export interface Delivery {
  role: string;
  packFiles: string[];
  packDigest: string;
  // The live state block, named separately from `system` so a caller can RECORD
  // that it went (and how big it was) without re-deriving which entry it is. A
  // delivery whose doctrine arrives and whose block does not is the §6.4 half-miss
  // that leaves a 32k model with no runtime navigation at all.
  stateBlock: string;
  // The tool the state block told this session to call next, and the item it
  // named, as fields. Both null for a delivery that recommends nothing (a
  // terminal run, a workspace with no run at all).
  recommended: string | null;
  recommendedItem: string | null;
  system: string[];
  params: { temperature: number; topP?: number };
  headers: Record<string, string>;
}

// A stable short digest of the delivered doctrine: each pack's NAME and its bytes,
// order included, so neither a reordering nor a same-length edit is invisible.
// LENGTH-PREFIXED rather than separator-delimited: the framing is then unambiguous
// without a delimiter byte, and no separator can collide with pack content (the
// obvious separator, a control byte, would also make this file binary to grep —
// conductor/tests/source-hygiene.test.ts).
function packDigestOf(packFiles: string[], packs: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const file of packFiles) {
    const content = packs[file] ?? "";
    hash.update(String(file.length) + ":" + file);
    hash.update(String(content.length) + ":" + content);
  }
  return hash.digest("hex").slice(0, 16);
}

// The ONE composition the plugin's three §6.4 hooks share. `state` is null for a
// workspace with no live run: the doctrine still goes (a session with no run is
// still governed by its role's pack), and the state block reports the absence
// rather than inventing a run to describe.
export function composeDelivery(input: {
  registryEntry: SessionRegistryEntry;
  packs: Record<string, string>;
  state: DeliveryState | null;
  job?: { schema?: boolean };
}): Delivery {
  const { registryEntry, packs, state } = input;
  const items = state === null ? [] : state.items;
  const packFiles = packFilesFor(registryEntry, items);
  // buildSystemAppend stays the ONE assembler for the live-run case (it is what
  // the §6.4 ledger names and what the injection suite pins); the no-run case is
  // the same shape with the block that reports the absence.
  const system =
    state === null
      ? [...packTextsFor(packFiles, packs), renderNoRunStateBlock()]
      : buildSystemAppend(registryEntry, state.run, state.items, state.questions, packs, state.ctx);
  const recommendation =
    state === null
      ? { tool: null, itemId: null }
      : recommendedToolOf(state.run, state.items, state.questions, state.ctx);
  return {
    role: registryEntry.role,
    packFiles,
    packDigest: packDigestOf(packFiles, packs),
    stateBlock: system[system.length - 1] ?? "",
    recommended: recommendation.tool,
    recommendedItem: recommendation.itemId,
    system,
    params: paramsForRole(registryEntry.role),
    headers: headersFor(registryEntry, input.job),
  };
}

// ---------------------------------------------------------------------------
// (d) loadPacks / initPlugin — the §6.4 fail-closed init.
// ---------------------------------------------------------------------------

// Read the nine required doctrine packs from `doctrineDir`, keyed by filename. Any
// missing or unreadable pack is a STARTUP error (fail-closed, §6.4) whose message
// NAMES the offending pack file, so init can surface exactly which pack is absent.
export function loadPacks(doctrineDir: string): Record<string, string> {
  const packs: Record<string, string> = {};
  for (const file of REQUIRED_PACKS) {
    const packPath = path.join(doctrineDir, file);
    let content: string;
    try {
      content = readFileSync(packPath, "utf8");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `conductor: required doctrine pack "${file}" is missing or unreadable at ${packPath} ` +
          `(§6.4 fail-closed at init): ${detail}`,
      );
    }
    // A present-but-empty (0-byte / whitespace-only) pack is effectively absent
    // doctrine: fail closed exactly like a missing pack so initPlugin never writes
    // the §3.8 beacon for empty doctrine.
    if (content.trim().length === 0) {
      throw new Error(
        `conductor: required doctrine pack "${file}" is present but empty at ${packPath} ` +
          `(§6.4/§3.8 fail-closed at init)`,
      );
    }
    packs[file] = content;
  }
  return packs;
}

// The §3.8 init ordering seam: load the doctrine packs FIRST; only once they all load
// is the liveness beacon written (exactly once) and the cached map returned. A missing
// pack routes its error to the injected logError seam (§7.1 stderr — client.app.log —
// NOT a conductor journal event; the closed vocabulary has no init event) and is
// re-thrown, and the beacon is NEVER written — so a missing beacon is a real
// fail-closed signal that init did not complete.
export function initPlugin(deps: {
  doctrineDir: string;
  logError: (msg: string) => void;
  writeBeacon: () => void;
}): Record<string, string> {
  let packs: Record<string, string>;
  try {
    packs = loadPacks(deps.doctrineDir);
  } catch (err) {
    deps.logError(err instanceof Error ? err.message : String(err));
    throw err;
  }
  deps.writeBeacon();
  return packs;
}
