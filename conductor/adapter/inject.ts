// conductor/adapter/inject.ts — Task 8.2: the §6.4 system-prompt injection layer
// (plan lines 1892-1903, §4.1 roles table 1512-1543, §4.4 router headers 1636-1698,
// §3.8 liveness beacon 1478-1495). Four concerns, one seam:
//   - buildSystemAppend: the `experimental.chat.system.transform` body — the role's
//     doctrine pack(s) verbatim, then a live state block RE-STATED every request and
//     never remembered (G9). A pure function of its inputs.
//   - paramsForRole:     the `chat.params` sampling table (§4.1).
//   - headersFor:        the `chat.headers` §4.4 router tags.
//   - loadPacks/initPlugin: the §6.4 fail-closed init — a missing pack is a startup
//     error surfaced BEFORE the §3.8 beacon is written, so the beacon's ABSENCE
//     proves init failed. loadPacks/initPlugin are the ONLY filesystem-touching
//     functions here; the three transform helpers are pure (no I/O, no clock, no
//     randomness), so identical inputs yield byte-identical output (G9).
//
// ADAPTER (G14): the pure helpers borrow only the core `legalTools` derivation
// (§3.1: one legality verdict, three consumers, they can never disagree). The two
// init functions use only node:fs / node:path — no single-runtime global, no shell
// tag, no top-level await — so this runs under BOTH Node type-stripping and the
// alternate opencode plugin runtime.

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
// debug.md and receive-review.md, referenced by DEBUG posture and review receipt).
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
  const verdict = legalTools(run, items, questions, ctx.repoConfigured);
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
  const packFiles = ROLE_PACKS[registryEntry.role] ?? ["core.md"];
  const append: string[] = [];
  for (const file of packFiles) {
    const content = packs[file];
    if (content !== undefined) append.push(content);
  }
  // Guarantee a non-empty append even if the primary pack is somehow absent from the
  // cache, so append[0] is always a string and the block is always the last entry.
  if (append.length === 0) append.push("");
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
