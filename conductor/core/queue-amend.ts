// The §2.4 queue-amendment vocabulary: what `conductor_queue_amend` may be asked
// to do, and what applying it to a queue means. Pure — no I/O, no clock, no state
// store. The handler in adapter/tools.ts supplies the run's current queue and the
// item states, and persists whatever comes back out.
//
// This exists because the tool takes OPS, not a queue. Plan §3.4 registers
// `conductor_queue_amend | {ops[]}` and the plugin declares
// `args: { ops: S.array(S.string()) }`, so an amendment states the CHANGE and the
// run's own queue supplies everything the change did not mention. Replacing the
// queue wholesale would let a caller drop items by omission and would leave the
// tool with no honest binding to its handler.

import { ITEM_STATES } from "./fsm-item.ts";
import type { ItemState, Queue, QueueItem } from "./types.ts";

// The CLOSED op vocabulary. Widening it is a STOP-AND-PARK, not an edit: every
// consumer below switches exhaustively over these three.
export const AMEND_OP_KINDS = ["add", "update", "remove"] as const;
export type AmendOpKind = (typeof AMEND_OP_KINDS)[number];

export type QueueAmendOp =
  | { op: "add"; item: QueueItem }
  | { op: "update"; item: QueueItem }
  | { op: "remove"; id: string };

// The item states in which a queue entry may still change: everything strictly
// before verification. §2.5's `blocked` comment names conductor_queue_amend as a
// legal clearer, which is only coherent while the item's work is still in flight —
// at VALIDATED the item carries a verify record that the amended scope would
// invalidate, and at REVIEWED/PUBLISHED its work is integrated.
export const AMENDABLE_ITEM_STATES = ["PENDING", "RED", "TEST_VETTED", "GREEN"] as const;

export type AmendParse = { ok: true; ops: QueueAmendOp[] } | { ok: false; why: string };

export type AmendApply =
  | { ok: true; queue: Queue; added: string[]; updated: string[]; removed: string[] }
  | { ok: false; why: string };

function isAmendable(state: ItemState): boolean {
  return (AMENDABLE_ITEM_STATES as readonly string[]).includes(state);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAmendOpKind(value: unknown): value is AmendOpKind {
  return typeof value === "string" && (AMEND_OP_KINDS as readonly string[]).includes(value);
}

/**
 * Widen the tool's declared `ops: string[]` into the closed union. Each element is
 * one JSON object; a refusal names the POSITION so a long list is diagnosable.
 *
 * This is only the SHAPE. Whether an op is applicable — the id exists, the id does
 * not already exist, the item is still amendable — is applyAmendOps' business,
 * because only it can see the queue.
 */
export function parseAmendOps(raw: readonly string[]): AmendParse {
  if (raw.length === 0) {
    return { ok: false, why: "an amendment must carry at least one op; the ops list was empty" };
  }

  const ops: QueueAmendOp[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const at = `ops[${index}]`;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw[index]);
    } catch {
      return { ok: false, why: `${at} is not JSON; every op is one JSON object` };
    }
    if (!isPlainObject(decoded)) {
      return { ok: false, why: `${at} is not a JSON object` };
    }

    const kind = decoded.op;
    if (!isAmendOpKind(kind)) {
      return {
        ok: false,
        why: `${at} carries the op ${JSON.stringify(kind)}, which is outside the closed vocabulary ${AMEND_OP_KINDS.join("/")}`,
      };
    }

    if (kind === "remove") {
      if (!nonEmptyString(decoded.id)) {
        return { ok: false, why: `${at} (remove) requires a non-empty string "id"` };
      }
      ops.push({ op: "remove", id: decoded.id });
      continue;
    }

    const item = decoded.item;
    if (!isPlainObject(item)) {
      return { ok: false, why: `${at} (${kind}) requires an "item" object — the §2.4 queue entry to ${kind}` };
    }
    if (!nonEmptyString(item.id)) {
      return { ok: false, why: `${at} (${kind}) requires its item to carry a non-empty string "id"` };
    }
    // The rest of the entry's shape is SCHEMAS.Queue's business: the handler runs
    // core validateQueue over the result, so a malformed entry is refused there
    // with the §2.4 violation named, not paraphrased here.
    ops.push({ op: kind, item: item as unknown as QueueItem });
  }

  return { ok: true, ops };
}

/**
 * Apply `ops` to `queue` in order, so a later op sees what an earlier one did —
 * remove-then-add of one id is the re-scope the §3.3 BLOCKED ladder ends in.
 *
 * `states` maps item id to its §2.5 FSM position. An id this call ADDS has no
 * state yet and is amendable by construction; an id the queue names but `states`
 * does not is refused rather than assumed safe.
 *
 * Never mutates its arguments: the handler re-validates the result and may refuse
 * it, and a refused amendment must leave the run executing exactly what it was.
 */
export function applyAmendOps(
  queue: Queue,
  ops: readonly QueueAmendOp[],
  states: Readonly<Record<string, ItemState | undefined>>,
): AmendApply {
  if (ops.length === 0) {
    return { ok: false, why: "an amendment must carry at least one op; the ops list was empty" };
  }

  const items: QueueItem[] = structuredClone(queue.items);
  // NET effects, not a log: an id removed and re-added is born fresh (one `add`),
  // and an id added then removed never existed. The handler reconciles §2.5 files
  // from these, so anything but the net would create or delete the wrong file.
  const added = new Set<string>();
  const updated = new Set<string>();
  const removed = new Set<string>();

  const indexOf = (id: string): number => items.findIndex((entry) => entry.id === id);

  for (let position = 0; position < ops.length; position += 1) {
    const op = ops[position];
    const at = `ops[${position}]`;

    if (op.op === "add") {
      if (indexOf(op.item.id) !== -1) {
        return { ok: false, why: `${at}: cannot add ${op.item.id} — the queue already has an item with that id` };
      }
      items.push(structuredClone(op.item));
      // The id is absent, so either it was never here or a prior op in THIS list
      // removed it. Cancelling that retirement is what makes remove-then-add one
      // net birth: reported as both, the handler would create the reborn item's
      // file and then delete it, leaving a queue entry with no §2.5 item at all.
      // (`updated` cannot hold the id — an update requires presence, and a remove
      // clears it — so there is nothing to cancel there.)
      removed.delete(op.item.id);
      added.add(op.item.id);
      continue;
    }

    const id = op.op === "remove" ? op.id : op.item.id;
    const found = indexOf(id);
    if (found === -1) {
      return { ok: false, why: `${at}: cannot ${op.op} ${id} — the queue has no item with that id` };
    }

    // An id this amendment created is amendable whatever `states` says about a
    // previous incarnation; anything else must still be pre-verification.
    if (!added.has(id)) {
      const state = states[id];
      if (state === undefined) {
        return {
          ok: false,
          why: `${at}: cannot ${op.op} ${id} — the run has no §2.5 item for it, so its state cannot be established`,
        };
      }
      if (!(ITEM_STATES as readonly string[]).includes(state)) {
        return { ok: false, why: `${at}: cannot ${op.op} ${id} — its state ${state} is outside the §3.3 vocabulary` };
      }
      if (!isAmendable(state)) {
        return {
          ok: false,
          why:
            `${at}: cannot ${op.op} ${id} at ${state} — the queue is amendable only while nothing of an item's ` +
            `work is integrated (${AMENDABLE_ITEM_STATES.join("/")})`,
        };
      }
    }

    if (op.op === "remove") {
      items.splice(found, 1);
      updated.delete(id);
      // An id created by THIS amendment and then dropped never reached disk, so
      // there is nothing for the handler to retire.
      if (added.delete(id)) continue;
      removed.add(id);
      continue;
    }

    items[found] = structuredClone(op.item);
    if (!added.has(id)) updated.add(id);
  }

  return {
    ok: true,
    queue: { items },
    added: [...added],
    updated: [...updated],
    removed: [...removed],
  };
}
