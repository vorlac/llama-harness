// conductor/tests/fanout.test.ts — Task 7.1 RED tests for THE fan-out engine
// (adapter/fanout.ts): a pool of opencode sub-sessions over the SDK
// (create → prompt → collect) with per-model wave dispatch, freeze-aware admission,
// schema validation + bounded re-prompt retry, a session registry written before the
// first prompt, and a per-job watchdog. Driven entirely against the FAKE in-process
// SDK (tests/fixtures/fake-sdk.ts) — NO opencode, NO model, NO network.
//
// SUBJECT (must NOT exist while this goes red; the failure is
// `Cannot find module '.../conductor/adapter/fanout.ts'` — the missing-subject shape,
// a legal greenfield red because the unresolved path is THIS item's fileScope):
//   - conductor/adapter/fanout.ts
//
// Spec read for this test (NOT thinned):
//   plan 2465-2494  (Task 7.1) — the createFanout/dispatch/dispatchWave interface and
//                     the full enumerated test list (2485-2492).
//   plan 1512-1543  §4.1 — roles under one model (G13): the engine groups jobs by
//                     resolved model and drains one group before the next; under the
//                     default single-model config that is the identity function (one
//                     group, no barrier), and it is the seam a multi-model config uses.
//   plan 1544-1618  §4.2 — the wave scheduler + the freeze-as-scheduling rule: no
//                     write-capable dispatch enters a tree with a live verify marker.
//   plan 1334-1427  §3.5 — freeze rules + the registry gate: the registry entry exists
//                     BEFORE the prompt so no sub-session can act while unregistered.
//   adapter/wire-notes.md — the 0.2 DRIFT: prompt-body `format:{json_schema}` DOES NOT
//                     EXIST at 1.18.15. Structured output is PROMPT-SHAPED and
//                     INDEPENDENTLY VALIDATED by the engine (core validate() on receipt,
//                     ≤2 re-prompt retries with the validation errors appended). The
//                     fake's prompt() returns a text/parts payload the engine parses +
//                     validates — never a native `format` result. Pinned below.
//
// THE 8 ASSERTION ROWS (docs/build/specs/task-7.1.assertions.json) → tests:
//   7.1-api            → "createFanout exposes dispatch + dispatchWave; a job yields
//                         {sessionID,value,timings}"
//   7.1-grouping       → "mixed-model jobs dispatch AABB (not ABAB) with a barrier"
//                        + "a single-model wave is one group with no barrier"
//   7.1-freeze-hold    → "a writeCapable job into a frozen tree is HELD then released;
//                         a read job dispatches immediately"
//   7.1-registry-first → "the registry entry exists before the first prompt is sent"
//   7.1-retry          → "schema-invalid re-prompts with errors appended then succeeds"
//                        + "persistent invalidity ⇒ env-failed after ≤2 retries"
//   7.1-watchdog       → "a hung sub-session is aborted via the SDK after the timeout"
//   7.1-concurrency    → "in-flight sub-sessions never exceed maxReaders"
//   7.1-cleanup        → "registry populated then cleaned; journal dispatch/complete;
//                         results carry {sessionID,value|error,timings}"
//   (hold/retry/abort journal events are asserted inside their behavior tests above.)

import { test } from "node:test";
import assert from "node:assert/strict";

// VALUE import of the subject: this is the line that goes red (missing subject) until
// adapter/fanout.ts exists. Type-only imports below are erased and do not resolve at
// runtime, so the red is exactly the missing-subject module error, never a SyntaxError.
import { createFanout } from "../adapter/fanout.ts";
import type {
  Fanout,
  FanoutJob,
  FanoutResult,
  RegistryEntry,
  SessionRegistry,
  TreeState,
} from "../adapter/fanout.ts";

import { validate, SCHEMAS } from "../core/types.ts";
import type { Config } from "../core/types.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import type { Journal, Corr } from "../adapter/journal.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import type { FakeSdk, PromptReply } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// A temporary schema the engine validates receipts against. The comment on core
// SCHEMAS explicitly blesses tests registering through the mutable record; this file
// runs in its own `node --test` process, so the registration is isolated.
// ---------------------------------------------------------------------------
const PROBE = "FanoutProbe";
SCHEMAS[PROBE] = {
  type: "object",
  properties: { ok: { type: "boolean" }, note: { type: "string" } },
  required: ["ok", "note"],
  additionalProperties: false,
};

const VALID_VALUE = { ok: true, note: "done" };
const VALID = JSON.stringify(VALID_VALUE);
const INVALID = JSON.stringify({ ok: true }); // missing the required "note"

// Sanity: the fixture's own premises must hold, or every downstream assertion is moot.
assert.equal(validate(PROBE, VALID_VALUE).ok, true, "VALID payload must pass core validate()");
assert.equal(validate(PROBE, { ok: true }).ok, false, "INVALID payload must fail core validate()");

// ---------------------------------------------------------------------------
// Test doubles + helpers
// ---------------------------------------------------------------------------

interface LoggedRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: Corr;
}

function makeRecordingJournal(): { journal: Journal; records: LoggedRecord[] } {
  const records: LoggedRecord[] = [];
  const journal: Journal = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { journal, records };
}

// A controllable §3.5 freeze view. `isFrozen`/`onClear` satisfy the engine's TreeState;
// `setFrozen(tree,false)` clears the marker AND notifies subscribers, which is how the
// held write-capable job is released deterministically (no timers, no polling).
function makeFakeTreeState(): TreeState & { setFrozen(tree: string, frozen: boolean): void } {
  const frozen = new Set<string>();
  const listeners = new Set<(tree: string) => void>();
  return {
    isFrozen(tree: string): boolean {
      return frozen.has(tree);
    },
    onClear(listener: (tree: string) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setFrozen(tree: string, isFrozen: boolean): void {
      const was = frozen.has(tree);
      if (isFrozen) {
        frozen.add(tree);
        return;
      }
      frozen.delete(tree);
      if (was) for (const listener of [...listeners]) listener(tree);
    },
  };
}

function makeConfig(over: {
  parallel?: Partial<Config["parallel"]>;
  models?: Config["models"];
} = {}): Config {
  return {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "refuse" },
    workflow: {
      trivialMaxFiles: 2,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 6,
      skepticsPerFinding: 2,
      reviewMaxRounds: 3,
      vetCritics: 3,
      vetMaxRounds: 3,
      testRepairAttempts: 3,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 2,
    },
    parallel: {
      writes: "off",
      maxImplementers: 2,
      maxReaders: 6,
      subSessionTimeoutMs: 900_000,
      ...over.parallel,
    },
    models: over.models ?? { default: "model-A", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 20, maxRunDirBytes: 268_435_456, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
}

// Registry the engine writes and the fake reads (the shared ordering witness). A plain
// Map satisfies the engine's SessionRegistry surface (set/get/has/delete) and exposes
// `.size` for the populated-then-cleaned assertions.
function makeRegistry(): Map<string, RegistryEntry> {
  return new Map<string, RegistryEntry>();
}

// A macrotask boundary drains every pending microtask (the fake's async create/prompt
// chain), so after `settle()` the engine has issued every dispatch it currently can.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  await flush();
  await flush();
};
// Microtask-only drain — used where mock timers make setTimeout inert.
const microtasks = async (n = 40): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

// Resolve every currently-parked prompt with a payload that echoes its item id, so
// dispatchWave's INPUT-ORDER result contract is checkable even when dispatch is
// reordered by model grouping.
function resolveAllEchoingItem(sdk: FakeSdk, registry: Map<string, RegistryEntry>): void {
  for (const parked of [...sdk.pending]) {
    const itemId = registry.get(parked.sessionID)?.itemId ?? "?";
    sdk.resolvePending(parked.sessionID, {
      kind: "reply",
      text: JSON.stringify({ ok: true, note: itemId }),
    });
  }
}

function noteOf(result: FanoutResult): unknown {
  return (result.value as { note?: unknown } | undefined)?.note;
}

function assertKnownFanoutEvents(records: LoggedRecord[]): void {
  for (const record of records) {
    if (record.component !== "fanout") continue;
    assert.ok(
      isKnownEvent("fanout", record.event),
      `fanout event "${record.event}" must be in the closed §7.4 vocabulary`,
    );
  }
}

function readJob(over: Partial<FanoutJob> = {}): FanoutJob {
  return {
    role: "reviewer",
    itemId: "i1",
    tree: "main",
    writeCapable: false,
    prompt: "review the change",
    schemaName: PROBE,
    priority: "review",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 7.1-api — the interface exists and a single dispatch produces a result.
// ---------------------------------------------------------------------------
test("[7.1-api] createFanout exposes dispatch + dispatchWave; a job yields {sessionID,value,timings}", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout: Fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeFakeTreeState());

  assert.equal(typeof fanout.dispatch, "function", "dispatch must be exposed");
  assert.equal(typeof fanout.dispatchWave, "function", "dispatchWave must be exposed");

  sdk.setResponder(() => ({ kind: "reply", text: VALID }));
  const result = await fanout.dispatch(readJob());

  assert.equal(typeof result.sessionID, "string");
  assert.ok(sdk.creates.includes(result.sessionID), "result.sessionID must be a session the engine created");
  assert.deepEqual(result.value, VALID_VALUE, "success carries the parsed+validated value");
  assert.equal(result.error, undefined, "a successful result carries no error");
  assert.equal(typeof result.timings.startedMs, "number");
  assert.equal(typeof result.timings.endedMs, "number");
  assert.equal(typeof result.timings.durationMs, "number");
  assert.ok(result.timings.durationMs >= 0);

  // dispatchWave returns one result per job.
  const waveResults = await fanout.dispatchWave([readJob({ itemId: "w1" }), readJob({ itemId: "w2" })]);
  assert.equal(waveResults.length, 2);

  assert.ok(records.some((r) => r.event === "subsession.dispatched"), "a dispatch event is journaled");
  assert.ok(records.some((r) => r.event === "subsession.complete"), "a complete event is journaled");
  assertKnownFanoutEvents(records);
});

// ---------------------------------------------------------------------------
// 7.1-grouping — mixed-model jobs dispatch AABB (not ABAB) with a between-group barrier.
// ---------------------------------------------------------------------------
test("[7.1-grouping] mixed-model jobs dispatch grouped AABB (not ABAB) with a barrier between model groups", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal } = makeRecordingJournal();
  const config = makeConfig({
    parallel: { maxReaders: 6 },
    models: { default: "model-A", roles: { alpha: "model-A", beta: "model-B" } },
  });
  const fanout: Fanout = createFanout(sdk.client, config, journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "pending" }));

  // Interleaved by role A,B,A,B — a non-grouping engine would dispatch ABAB.
  const jobs: FanoutJob[] = [
    readJob({ role: "alpha", itemId: "a0" }),
    readJob({ role: "beta", itemId: "b1" }),
    readJob({ role: "alpha", itemId: "a2" }),
    readJob({ role: "beta", itemId: "b3" }),
  ];
  const wave = fanout.dispatchWave(jobs);
  await settle();

  // Only the model-A group is in flight; the model-B group is barriered behind it.
  assert.equal(sdk.prompts.length, 2, "only the first model group is dispatched before its drain");
  assert.deepEqual(
    sdk.prompts.map((p) => p.model),
    ["model-A", "model-A"],
    "the first group is all model-A (AA), never interleaved with model-B",
  );

  resolveAllEchoingItem(sdk, registry); // drain group A
  await settle();

  assert.equal(sdk.prompts.length, 4, "the second model group dispatches only after the first drains");
  assert.deepEqual(
    sdk.prompts.map((p) => p.model),
    ["model-A", "model-A", "model-B", "model-B"],
    "recorded prompt order is AABB, not ABAB",
  );

  resolveAllEchoingItem(sdk, registry); // drain group B
  const results = await wave;

  assert.deepEqual(
    results.map(noteOf),
    ["a0", "b1", "a2", "b3"],
    "results are returned in INPUT order even though dispatch was grouped",
  );
});

test("[7.1-grouping] a single-model wave dispatches in one group with no barrier", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal } = makeRecordingJournal();
  // maxReaders high enough that concurrency is NOT the limiter — so if all four are in
  // flight at once, it is because there is one group and no barrier (G13 identity).
  const config = makeConfig({ parallel: { maxReaders: 10 }, models: { default: "model-A", roles: {} } });
  const fanout: Fanout = createFanout(sdk.client, config, journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "pending" }));

  const jobs: FanoutJob[] = [
    readJob({ itemId: "s0" }),
    readJob({ itemId: "s1" }),
    readJob({ itemId: "s2" }),
    readJob({ itemId: "s3" }),
  ];
  const wave = fanout.dispatchWave(jobs);
  await settle();

  assert.equal(sdk.prompts.length, 4, "all four dispatch together — one group, no barrier");
  assert.equal(sdk.inFlightCount(), 4);
  assert.deepEqual(
    sdk.prompts.map((p) => p.model),
    ["model-A", "model-A", "model-A", "model-A"],
    "every job resolved to the single default model",
  );

  resolveAllEchoingItem(sdk, registry);
  const results = await wave;
  assert.deepEqual(results.map(noteOf), ["s0", "s1", "s2", "s3"]);
});

// ---------------------------------------------------------------------------
// 7.1-freeze-hold — freeze-aware admission (§3.5 / §4.2).
// ---------------------------------------------------------------------------
test("[7.1-freeze-hold] a writeCapable job into a frozen tree is HELD (not dispatched, not denied) and dispatches after the marker clears; a read job dispatches immediately", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const treeState = makeFakeTreeState();
  const fanout: Fanout = createFanout(sdk.client, makeConfig(), journal, registry, treeState);

  treeState.setFrozen("treeX", true);
  sdk.setResponder(() => ({ kind: "reply", text: VALID }));

  const writeJob = readJob({ role: "implementer", writeCapable: true, tree: "treeX", itemId: "w", prompt: "edit" });
  const readForSameTree = readJob({ role: "reviewer", writeCapable: false, tree: "treeX", itemId: "r", prompt: "read" });

  const wave = fanout.dispatchWave([writeJob, readForSameTree]);
  await settle();

  // The write-capable job is HELD: no session created for it while the marker is live.
  assert.equal(sdk.creates.length, 1, "only the read job is dispatched into the frozen tree");
  const holdEvents = records.filter((r) => r.event === "subsession.hold");
  assert.equal(holdEvents.length, 1, "the held write-capable job is journaled as a hold");
  assert.equal(holdEvents[0].data["tree"], "treeX", "the hold names the frozen tree");
  // Held, not DENIED: no abort, no completion for the write job yet.
  assert.ok(!sdk.aborts.length, "a held job is not aborted");
  assert.ok(
    records.some((r) => r.event === "subsession.dispatched"),
    "the read job for the same tree dispatches immediately",
  );

  // Clear the marker — the held job must now be released and dispatched.
  treeState.setFrozen("treeX", false);
  await settle();
  assert.equal(sdk.creates.length, 2, "the held write-capable job dispatches after the marker clears");

  const results = await wave;
  const writeResult = results[0]; // input order: writeJob first
  assert.equal(writeResult.error, undefined, "the released write job succeeds — it was held, never denied");
  assert.deepEqual(writeResult.value, VALID_VALUE);

  assertKnownFanoutEvents(records);
});

// ---------------------------------------------------------------------------
// 7.1-registry-first — the registry entry exists BEFORE the first prompt (§3.5).
// ---------------------------------------------------------------------------
test("[7.1-registry-first] the registry entry (sessionID -> {role,itemId,tree}) exists before the first prompt is sent", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout: Fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "reply", text: VALID }));
  const result = await fanout.dispatch(readJob({ role: "reviewer", itemId: "i7", tree: "main" }));

  assert.equal(sdk.prompts.length, 1);
  const rec = sdk.prompts[0];
  // The fake sampled the registry at the instant prompt() was entered: a sub-session
  // must never be able to make a tool call while unregistered.
  assert.equal(rec.registeredAtStart, true, "the session was registered before prompt() was called");
  assert.ok(rec.entryAtStart !== undefined, "the registry entry was present at prompt time");
  assert.equal(rec.entryAtStart?.role, "reviewer");
  assert.equal(rec.entryAtStart?.itemId, "i7");
  assert.equal(rec.entryAtStart?.tree, "main");
  // Task 0.2 DRIFT: no native `format` body field — structured output is prompt-shaped.
  assert.equal(rec.hasFormatField, false, "the engine must not lean on the non-existent format field");

  assert.deepEqual(result.value, VALID_VALUE);
  assert.equal(registry.size, 0, "the registry entry is cleaned after completion");
});

// ---------------------------------------------------------------------------
// 7.1-retry — schema validation on receipt, ≤2 re-prompt retries (errors appended).
// ---------------------------------------------------------------------------
test("[7.1-retry] a schema-invalid receipt re-prompts with the validation errors appended, then succeeds", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout: Fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeFakeTreeState());

  // Attempt 1 invalid, attempt 2 valid.
  sdk.setResponder((req): PromptReply =>
    req.attempt === 1 ? { kind: "reply", text: INVALID } : { kind: "reply", text: VALID },
  );

  const result = await fanout.dispatch(readJob({ itemId: "i1", prompt: "PRODUCE_PROBE" }));
  const sid = sdk.creates[0];

  assert.equal(sdk.creates.length, 1, "a retry re-prompts the SAME session, it does not create a new one");
  assert.equal(sdk.promptsFor(sid).length, 2, "exactly one re-prompt after the invalid receipt");

  // The retry prompt carries BOTH the original instruction and the appended validation
  // errors (the ones core validate() would emit for the invalid payload).
  const expectedErrors = validate(PROBE, { ok: true }).errors;
  assert.ok(expectedErrors.length > 0, "the invalid payload must yield concrete validation errors");
  const retryText = sdk.promptsFor(sid)[1].text;
  assert.ok(retryText.includes("PRODUCE_PROBE"), "the retry keeps the original prompt");
  assert.ok(
    expectedErrors.some((e) => retryText.includes(e)),
    "the retry prompt has the validation errors appended",
  );

  assert.deepEqual(result.value, VALID_VALUE, "the retry succeeds and yields the validated value");
  assert.equal(result.error, undefined);
  assert.ok(records.some((r) => r.event === "subsession.retry"), "the retry is journaled");
  assertKnownFanoutEvents(records);
});

test("[7.1-retry] persistent schema-invalidity yields an env-failed result after ≤2 retries (two retry failures)", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout: Fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "reply", text: INVALID })); // never valid

  const result = await fanout.dispatch(readJob({ itemId: "i1" }));
  const sid = sdk.creates[0];

  // Initial attempt + 2 retries = 3 prompt calls, then give up: ≤2 re-prompt retries.
  assert.equal(sdk.promptsFor(sid).length, 3, "the engine re-prompts at most twice before giving up");
  assert.equal(
    records.filter((r) => r.event === "subsession.retry").length,
    2,
    "two retry attempts are journaled",
  );

  assert.equal(result.value, undefined, "an exhausted retry budget produces no value");
  assert.ok(result.error !== undefined, "it produces an env-failed error result");
  const errText = JSON.stringify(result.error).toLowerCase();
  assert.ok(/schema|valid/.test(errText), "the error attributes the failure to schema validation");
  assert.ok(sdk.creates.includes(result.sessionID), "the failed result still carries its sessionID");
  assert.ok(!sdk.aborts.length, "a schema exhaustion is a completion, not a watchdog abort");
  assert.ok(records.some((r) => r.event === "subsession.complete"), "exhaustion journals a completion");
  assertKnownFanoutEvents(records);
});

// ---------------------------------------------------------------------------
// 7.1-watchdog — a hung sub-session is aborted via the SDK after the timeout. Uses the
// node:test mock timers so no real time passes: the fake hangs, the fake clock advances.
// ---------------------------------------------------------------------------
test("[7.1-watchdog] a hung sub-session is aborted via the SDK after parallel.subSessionTimeoutMs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });

  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const config = makeConfig({ parallel: { subSessionTimeoutMs: 5_000 } });
  const fanout: Fanout = createFanout(sdk.client, config, journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "hang" })); // the sub-session never replies

  const pending = fanout.dispatch(readJob({ itemId: "hang" }));
  await microtasks(); // let create resolve and the (hanging) prompt be issued
  const sid = sdk.creates[0];

  assert.equal(sdk.prompts.length, 1, "the prompt was issued and is in flight");
  assert.equal(sdk.aborts.length, 0, "no abort before the timeout elapses");

  t.mock.timers.tick(5_000); // the watchdog fires
  await microtasks();
  const result = await pending;

  assert.deepEqual(sdk.aborts, [sid], "the watchdog aborts the hung session via the SDK");
  assert.equal(result.value, undefined);
  assert.ok(result.error !== undefined, "a watchdog abort produces an error result");
  const errText = JSON.stringify(result.error).toLowerCase();
  assert.ok(/timeout|abort|watchdog/.test(errText), "the error attributes the failure to the watchdog");
  assert.ok(result.timings.durationMs >= 5_000, "timings reflect the elapsed watchdog interval");
  assert.ok(records.some((r) => r.event === "subsession.abort"), "the abort is journaled");
  assertKnownFanoutEvents(records);
});

// ---------------------------------------------------------------------------
// 7.1-concurrency — in-flight sub-sessions never exceed maxReaders.
// ---------------------------------------------------------------------------
test("[7.1-concurrency] in-flight sub-sessions never exceed parallel.maxReaders", async () => {
  const registry = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal } = makeRecordingJournal();
  const config = makeConfig({ parallel: { maxReaders: 2 }, models: { default: "model-A", roles: {} } });
  const fanout: Fanout = createFanout(sdk.client, config, journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "pending" }));

  const jobs: FanoutJob[] = [
    readJob({ itemId: "c0" }),
    readJob({ itemId: "c1" }),
    readJob({ itemId: "c2" }),
    readJob({ itemId: "c3" }),
  ];
  const wave = fanout.dispatchWave(jobs);
  await settle();

  assert.equal(sdk.inFlightCount(), 2, "at most maxReaders (2) are dispatched at once");
  assert.equal(sdk.prompts.length, 2, "the remaining jobs wait for a free slot");
  assert.equal(registry.size, 2, "the registry holds exactly the in-flight sessions");

  // Drain: each completion admits at most one more, and the cap holds throughout.
  let peak = sdk.inFlightCount();
  let guard = 0;
  while (sdk.inFlightCount() > 0) {
    assert.ok(sdk.inFlightCount() <= 2, "in-flight must never exceed maxReaders");
    resolveAllEchoingItem(sdk, registry);
    await settle();
    peak = Math.max(peak, sdk.inFlightCount());
    guard += 1;
    if (guard > 20) throw new Error("concurrency drain did not terminate");
  }
  assert.ok(peak <= 2, "peak concurrency never exceeded maxReaders");

  const results = await wave;
  assert.equal(results.length, 4);
  assert.deepEqual(results.map(noteOf).sort(), ["c0", "c1", "c2", "c3"]);
  assert.equal(registry.size, 0, "the registry is fully cleaned after the wave");
});

// ---------------------------------------------------------------------------
// 7.1-cleanup — registry populated then cleaned; journal dispatch/complete; results
// carry {sessionID, value|error, timings}.
// ---------------------------------------------------------------------------
test("[7.1-cleanup] the registry is populated during flight then cleaned; journals dispatch/complete; results carry {sessionID,value,timings}", async () => {
  const registry: SessionRegistry & Map<string, RegistryEntry> = makeRegistry();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const config = makeConfig({ parallel: { maxReaders: 6 }, models: { default: "model-A", roles: {} } });
  const fanout: Fanout = createFanout(sdk.client, config, journal, registry, makeFakeTreeState());

  sdk.setResponder(() => ({ kind: "pending" }));

  const jobs: FanoutJob[] = [readJob({ itemId: "k0" }), readJob({ itemId: "k1" })];
  const wave = fanout.dispatchWave(jobs);
  await settle();

  // Populated during flight, keyed sessionID -> {role,itemId,tree}.
  assert.equal(registry.size, 2, "the registry is populated while sub-sessions are in flight");
  for (const sid of sdk.creates) {
    const entry = registry.get(sid);
    assert.ok(entry !== undefined, "every in-flight session has a registry entry");
    assert.equal(entry?.role, "reviewer");
    assert.equal(entry?.tree, "main");
  }

  resolveAllEchoingItem(sdk, registry);
  const results = await wave;

  assert.equal(registry.size, 0, "the registry is cleaned once the wave completes");
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(typeof result.sessionID, "string", "results carry a sessionID");
    assert.ok(sdk.creates.includes(result.sessionID));
    assert.ok(result.value !== undefined, "results carry a value on success");
    assert.equal(result.error, undefined);
    assert.equal(typeof result.timings.startedMs, "number", "results carry timings");
    assert.equal(typeof result.timings.endedMs, "number");
    assert.ok(result.timings.durationMs >= 0);
  }

  assert.ok(records.some((r) => r.event === "subsession.dispatched"), "dispatch is journaled");
  assert.equal(
    records.filter((r) => r.event === "subsession.complete").length,
    2,
    "each sub-session journals a completion",
  );
  // Every subsession lifecycle event carries the correlating sessionID (§7.2).
  for (const r of records.filter((x) => x.event === "subsession.complete")) {
    assert.ok(typeof r.corr.sessionID === "string" && sdk.creates.includes(r.corr.sessionID));
  }
  assertKnownFanoutEvents(records);
});
