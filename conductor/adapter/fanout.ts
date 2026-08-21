// conductor/adapter/fanout.ts — Task 7.1: the fan-out engine (plan lines 2465-2494;
// §4.1 lines 1512-1543; §4.2 lines 1544-1618; §3.5 lines 1334-1427). A pool of
// opencode sub-sessions driven over the SDK — create -> prompt -> collect — with
// per-model wave grouping (§4.1), freeze-aware admission (§3.5's freeze-as-scheduling
// rule), independent schema validation with bounded re-prompt retry, a session
// registry written BEFORE the first prompt, and a per-job watchdog.
//
// Task 0.2 DRIFT (adapter/wire-notes.md): the prompt-body `format:{json_schema}`
// field DOES NOT EXIST at 1.18.15. Structured output is therefore PROMPT-SHAPED and
// the engine INDEPENDENTLY validates each receipt via the pure core validate() —
// never a native `format` result, so no `format` field is ever put on the body.
//
// Adapter module (G14): runs under BOTH the opencode plugin runtime and Node
// type-stripping, so it uses only runtime-agnostic built-ins — the GLOBAL
// setTimeout/clearTimeout (so node:test mock timers control the watchdog) and Date
// for wall-clock timings. No single-runtime global, no shell tag, no subprocess. The
// only decision help it borrows is the pure core validator.

import { validate } from "../core/types.ts";
import type { Config, TreePath } from "../core/types.ts";
import type { Corr, Journal } from "./journal.ts";

// ---------------------------------------------------------------------------
// Public surface (exactly what tests/fanout.test.ts imports, plus FanoutClient).
// ---------------------------------------------------------------------------

// §3.5 registry entry: sessionID -> {role, itemId, tree}. The gates dispatch on it,
// and it MUST exist before the sub-session's first prompt so no sub-session can make
// a gated tool call while unregistered. `receivingReview` is the §3.3/C-028 delivery
// signal: set on a review-fix dispatch so the §6.4 injection layer appends doctrine
// receive-review.md to that session's system prompt — it rides the entry, never the
// item state, so the same item's other dispatches receive nothing extra.
export interface RegistryEntry {
  role: string;
  itemId: string;
  // The tree PATH the gates judge this session's writes against — never the
  // evidence layer's slug (core/types.ts brands the two apart; ISSUE-002).
  tree: TreePath;
  receivingReview?: boolean;
}

// The subset of the session registry the engine writes. A plain
// Map<string, RegistryEntry> satisfies it (set/get/has/delete).
export interface SessionRegistry {
  set(sessionID: string, entry: RegistryEntry): unknown;
  get(sessionID: string): RegistryEntry | undefined;
  has(sessionID: string): boolean;
  delete(sessionID: string): unknown;
}

// The §3.5 freeze view, per tree. `isFrozen` is the admission check; `onClear`
// subscribes to marker-clear notifications (returning an unsubscribe) so a held
// write-capable job is released deterministically — no timers, no polling.
export interface TreeState {
  isFrozen(tree: TreePath): boolean;
  onClear(listener: (tree: TreePath) => void): () => void;
}

// One unit of fan-out work. `writeCapable` is the freeze-admission discriminator: a
// write-capable job may not enter a frozen tree; a reader always may.
export interface FanoutJob {
  role: string;
  itemId: string;
  // The tree PATH this sub-session is dispatched into, which the engine writes
  // verbatim onto the §3.5 registry entry the gates read. NO_TREE for a job that
  // works no tree of its own.
  tree: TreePath;
  writeCapable: boolean;
  prompt: string;
  schemaName: string;
  priority: string;
  lens?: string;
  // Rides into the §3.5 registry entry: marks a dispatch that receives review
  // findings, so buildSystemAppend delivers doctrine receive-review.md to it.
  receivingReview?: boolean;
}

export interface FanoutResult {
  sessionID: string;
  value?: unknown;
  error?: unknown;
  timings: { startedMs: number; endedMs: number; durationMs: number };
}

export interface Fanout {
  dispatch(job: FanoutJob): Promise<FanoutResult>;
  dispatchWave(jobs: FanoutJob[]): Promise<FanoutResult[]>;
}

// The result envelope the generated hey-api SDK client returns ({ data?, error? }).
export interface FanoutEnvelope<T> {
  data?: T;
  error?: unknown;
}

// The subset of the opencode SDK client the engine drives — structurally satisfied
// by the real @opencode-ai/sdk client and by tests/fixtures/fake-sdk.ts's client.
export interface FanoutClient {
  session: {
    create(opts?: {
      body?: { title?: string; parentID?: string; agent?: string };
    }): Promise<FanoutEnvelope<{ id: string }>>;
    prompt(opts: {
      path: { id: string };
      body: Record<string, unknown>;
    }): Promise<FanoutEnvelope<{ info?: unknown; parts?: unknown }>>;
    abort(opts: { path: { id: string } }): Promise<FanoutEnvelope<{ aborted?: boolean }>>;
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

// Initial attempt + at most two re-prompt retries (plan line 2475: "≤2 re-prompt
// retries"), so at most three prompt() calls per session.
const MAX_ATTEMPTS = 3;

interface Entry {
  job: FanoutJob;
  index: number;
  model: string;
}

type Receipt = { ok: true; value: unknown } | { ok: false; errors: string[] };

// Compose the prompt reply's text parts (the prompt-shaped payload) into one string.
function extractReplyText(reply: FanoutEnvelope<{ info?: unknown; parts?: unknown }>): string {
  const parts = reply.data?.parts;
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (part !== null && typeof part === "object") {
      const p = part as { type?: unknown; text?: unknown };
      if (p.type === "text" && typeof p.text === "string") chunks.push(p.text);
    }
  }
  return chunks.join("\n");
}

// Parse the receipt text and validate it against the named schema with the pure core
// validator (the DRIFT-mandated independent validation half).
function parseAndValidate(text: string, schemaName: string): Receipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`response was not parseable JSON: ${message}`] };
  }
  const result = validate(schemaName, parsed);
  if (result.ok) return { ok: true, value: parsed };
  return { ok: false, errors: result.errors };
}

// The retry prompt keeps the ORIGINAL instruction and appends the concrete validation
// errors the receipt failed on (plan line 2475).
function appendErrors(basePrompt: string, schemaName: string, errors: string[]): string {
  const bulleted = errors.map((e) => `- ${e}`).join("\n");
  return (
    `${basePrompt}\n\n` +
    `Your previous reply did not satisfy the required ${schemaName} schema. Correct ` +
    `these validation errors and reply again with a single valid JSON object:\n${bulleted}`
  );
}

// §4.1 role -> opencode agent name. The six subagent blocks in
// conductor/opencode-fragment.json are selected by NOTHING until a dispatch names
// one, so their `"edit": "deny"` and `tools: {"task": false}` rows bind no session
// that does the work. Naming the agent buys three things: the client's sub-agent
// view labels each child by its role rather than showing an anonymous default; the
// spawn tool is never OFFERED to a session that may not use it, instead of being
// offered and then denied by the registry gate at the cost of a wasted turn; and
// the opencode permission layer denies reader-role edits independently of
// conductor's own edit gate, which the budgeted override hatch can route around.
//
// A wrong name here is SILENT — opencode accepts an unknown agent with 200 and
// echoes it (wire-notes 21.1) — so the values are pinned to the fragment by
// conductor/tests/fragment.test.ts, and the KEYS are a registered site of the
// `roles` vocabulary (core/vocab-registry.ts) so a role added to ROLE_PACKS and
// forgotten here goes red.
//
// `orchestrator` maps to the primary agent for completeness of the vocabulary; the
// engine never dispatches that role, since the orchestrator is the session doing
// the dispatching.
export const ROLE_AGENT: Record<string, string> = {
  orchestrator: "conductor-orchestrator",
  planner: "conductor-planner",
  testWriter: "conductor-test-writer",
  implementer: "conductor-implementer",
  reviewer: "conductor-reviewer",
  skeptic: "conductor-skeptic",
  mechanical: "conductor-mechanical",
};

export function createFanout(
  client: FanoutClient,
  config: Config,
  journal: Journal,
  registry: SessionRegistry,
  treeState: TreeState,
  runId = "",
  // The orchestrator session every dispatched sub-session is a child of. Empty
  // when no orchestrator session is known, in which case parentID is OMITTED
  // rather than sent empty: the field's schema pattern is `^ses`, so "" is not a
  // weaker version of the same request, it is an invalid one.
  parentSessionID = "",
): Fanout {
  const maxReaders = config.parallel.maxReaders;
  const timeoutMs = config.parallel.subSessionTimeoutMs;

  // model = config.models.roles[role] ?? config.models.default (§4.1).
  const resolveModel = (job: FanoutJob): string =>
    config.models.roles[job.role] ?? config.models.default;

  // Group jobs by resolved model, preserving first-appearance order of groups and
  // input order within each — the AABB drain order §4.1 requires. Under the default
  // single-model config this is the identity function on one group (G13).
  const groupByModel = (jobs: FanoutJob[]): Entry[][] => {
    const order: string[] = [];
    const byModel = new Map<string, Entry[]>();
    jobs.forEach((job, index) => {
      const model = resolveModel(job);
      let bucket = byModel.get(model);
      if (bucket === undefined) {
        bucket = [];
        byModel.set(model, bucket);
        order.push(model);
      }
      bucket.push({ job, index, model });
    });
    return order.map((model) => byModel.get(model) as Entry[]);
  };

  // Run ONE sub-session end to end, writing results[index]. Resolves when the job
  // reaches a terminal result (success, retry-exhausted, or watchdog abort) so the
  // group scheduler can free the slot.
  const runJob = (entry: Entry, results: FanoutResult[]): Promise<void> =>
    new Promise<void>((finalizeSlot) => {
      const { job, index, model } = entry;
      const startedMs = Date.now();
      let sessionID = "";
      let timer: ReturnType<typeof setTimeout> | undefined;
      let done = false;

      const corr = (): Corr => ({ runId, itemId: job.itemId, sessionID });

      const finish = (partial: { sessionID: string; value?: unknown; error?: unknown }): void => {
        if (done) return;
        done = true;
        // CRUCIAL (task): clear the watchdog on normal completion so a 900s default
        // timer never keeps the process alive and hangs node --test.
        if (timer !== undefined) clearTimeout(timer);
        if (sessionID.length > 0) registry.delete(sessionID);
        const endedMs = Date.now();
        results[index] = {
          sessionID: partial.sessionID,
          value: partial.value,
          error: partial.error,
          timings: { startedMs, endedMs, durationMs: Math.max(0, endedMs - startedMs) },
        };
        finalizeSlot();
      };

      // Per-job watchdog on the GLOBAL timer (mock-timer controllable). Armed BEFORE
      // session.create so the timeout bounds the ENTIRE job — the create phase included
      // (F1). If create hangs, nothing else would abort it and the whole wave would hang.
      // On fire: abort the session via the SDK IF one exists yet (create may still be in
      // flight, in which case there is no id to abort), journal the abort, and produce a
      // timeout error result. The `done` guard makes this exactly-once with every other
      // completion path, so a create that resolves LATE (after this fired) cannot
      // double-finish.
      timer = setTimeout(() => {
        if (done) return;
        if (sessionID.length > 0) {
          client.session.abort({ path: { id: sessionID } }).catch(() => undefined);
        }
        journal.log(
          "warn",
          "fanout",
          "subsession.abort",
          { reason: "watchdog-timeout", timeoutMs },
          corr(),
        );
        finish({
          sessionID,
          error: {
            kind: "env",
            reason: `watchdog timeout: aborted hung sub-session after ${timeoutMs}ms`,
          },
        });
      }, timeoutMs);

      void (async () => {
        try {
          // The title is what a human reads in the client's session list; the
          // lens distinguishes the six reviewers of one item from each other.
          const title =
            job.lens === undefined || job.lens === ""
              ? `${job.role}:${job.itemId}`
              : `${job.role}[${job.lens}]:${job.itemId}`;
          const agent = ROLE_AGENT[job.role];
          const created = await client.session.create({
            body: {
              title,
              ...(parentSessionID === "" ? {} : { parentID: parentSessionID }),
              ...(agent === undefined ? {} : { agent }),
            },
          });
          if (done) {
            // The watchdog already timed this job out during the create phase. If create
            // nonetheless produced a session id, abort it so it does not leak; the
            // done-guard ensures we never finish twice.
            const lateId = created.data?.id;
            if (typeof lateId === "string" && lateId.length > 0) {
              client.session.abort({ path: { id: lateId } }).catch(() => undefined);
            }
            return;
          }
          const id = created.data?.id;
          if (typeof id !== "string" || id.length === 0) {
            journal.log(
              "info",
              "fanout",
              "subsession.complete",
              { ok: false, reason: "session-create-failed", role: job.role, itemId: job.itemId },
              { runId, itemId: job.itemId },
            );
            finish({ sessionID: "", error: { kind: "env", reason: "sub-session could not be created" } });
            return;
          }
          sessionID = id;

          // §3.5: register BEFORE the first prompt — a sub-session must never be able
          // to make a tool call while unregistered.
          registry.set(sessionID, {
            role: job.role,
            itemId: job.itemId,
            tree: job.tree,
            ...(job.receivingReview === true ? { receivingReview: true } : {}),
          });
          journal.log(
            "info",
            "fanout",
            "subsession.dispatched",
            { role: job.role, itemId: job.itemId, tree: job.tree, model },
            corr(),
          );

          let promptText = job.prompt;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const reply = await client.session.prompt({
              path: { id: sessionID },
              // Prompt-shaped only — NO `format` field (Task 0.2 DRIFT). The
              // `agent` here is the field that governs the offered tool set and
              // the permission ruleset; the one on create is only metadata
              // (wire-notes 21.1), so both are set and neither is redundant.
              body: {
                parts: [{ type: "text", text: promptText }],
                model,
                ...(agent === undefined ? {} : { agent }),
              },
            });
            if (done) return; // the watchdog already resolved this job

            const receipt = parseAndValidate(extractReplyText(reply), job.schemaName);
            if (receipt.ok) {
              journal.log("info", "fanout", "subsession.complete", { ok: true, attempts: attempt }, corr());
              finish({ sessionID, value: receipt.value });
              return;
            }
            if (attempt < MAX_ATTEMPTS) {
              journal.log("info", "fanout", "subsession.retry", { attempt, errors: receipt.errors }, corr());
              promptText = appendErrors(job.prompt, job.schemaName, receipt.errors);
              continue;
            }
            // Retry budget spent: an env-failed COMPLETION (never a watchdog abort).
            journal.log(
              "info",
              "fanout",
              "subsession.complete",
              { ok: false, reason: "schema-invalid", errors: receipt.errors },
              corr(),
            );
            finish({
              sessionID,
              error: {
                kind: "env",
                reason: "sub-session output failed schema validation after retries",
                errors: receipt.errors,
              },
            });
            return;
          }
        } catch (err) {
          if (done) return;
          const message = err instanceof Error ? err.message : String(err);
          journal.log(
            "info",
            "fanout",
            "subsession.complete",
            { ok: false, reason: "engine-error", detail: message },
            { runId, itemId: job.itemId, sessionID },
          );
          finish({ sessionID, error: { kind: "env", reason: `sub-session engine error: ${message}` } });
        }
      })();
    });

  // Run ONE model group: admit up to maxReaders at once, holding write-capable jobs
  // out of a frozen tree until its marker clears. Resolves at the group barrier —
  // when every member (including released holds) has finished.
  const runGroup = (group: Entry[], results: FanoutResult[]): Promise<void> =>
    new Promise<void>((resolveGroup) => {
      if (group.length === 0) {
        resolveGroup();
        return;
      }
      const queue: Entry[] = [...group];
      const heldUnsubs = new Map<number, () => void>();
      let inFlight = 0;
      let remaining = group.length;

      const hold = (entry: Entry): void => {
        journal.log(
          "info",
          "fanout",
          "subsession.hold",
          { role: entry.job.role, itemId: entry.job.itemId, tree: entry.job.tree },
          { runId, itemId: entry.job.itemId },
        );
        // F3: a TreeState may notify the listener SYNCHRONOUSLY from inside onClear (an
        // already-cleared tree). Register this entry in heldUnsubs BEFORE subscribing —
        // reaching the real unsubscribe through a mutable ref — so a synchronous clear
        // finds the entry registered and releases the held job instead of stranding it
        // (a wave-hanging bug). `released` makes release idempotent across the sync path
        // and a later marker-clear notification.
        const unsubRef: { fn: () => void } = { fn: () => undefined };
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          heldUnsubs.delete(entry.index);
          unsubRef.fn();
          queue.push(entry);
          pump();
        };
        heldUnsubs.set(entry.index, release);
        const unsub = treeState.onClear((tree) => {
          if (tree !== entry.job.tree || treeState.isFrozen(entry.job.tree)) return;
          if (heldUnsubs.get(entry.index) === undefined) return; // already released
          release();
        });
        unsubRef.fn = unsub;
        // If the listener already fired synchronously during subscribe (release ran
        // before unsubRef.fn was assigned, so the real unsubscribe was not yet reachable),
        // unsubscribe once we finally hold it.
        if (released) unsub();
      };

      const pump = (): void => {
        while (queue.length > 0 && inFlight < maxReaders) {
          const entry = queue[0];
          // Freeze-aware admission: a write-capable job for a frozen tree is HELD —
          // not dispatched, not denied — and released when the marker clears (§3.5).
          if (entry.job.writeCapable && treeState.isFrozen(entry.job.tree)) {
            queue.shift();
            hold(entry);
            continue;
          }
          queue.shift();
          inFlight += 1;
          void runJob(entry, results).then(onDone);
        }
      };

      const onDone = (): void => {
        inFlight -= 1;
        remaining -= 1;
        if (remaining === 0) {
          resolveGroup();
          return;
        }
        pump();
      };

      pump();
    });

  const dispatchWave = async (jobs: FanoutJob[]): Promise<FanoutResult[]> => {
    const results: FanoutResult[] = new Array<FanoutResult>(jobs.length);
    // One record per wave, emitted HERE because this is the only place that knows
    // a wave happened: the seven handler call sites would each be a chance to
    // forget, and the per-job records cannot be grouped back into waves after the
    // fact. An empty job list is a caller that computed no work, not a wave.
    if (jobs.length > 0) {
      journal.log(
        "info",
        "fanout",
        "wave",
        {
          jobs: jobs.length,
          roles: jobs.map((job) => job.role),
          items: [...new Set(jobs.map((job) => job.itemId))],
        },
        { runId },
      );
    }
    // Drain one model group before the next — the between-group barrier (§4.1).
    for (const group of groupByModel(jobs)) {
      await runGroup(group, results);
    }
    return results;
  };

  const dispatch = (job: FanoutJob): Promise<FanoutResult> =>
    dispatchWave([job]).then((results) => results[0]);

  return { dispatch, dispatchWave };
}
