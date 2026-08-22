// conductor/tests/fanout-transcript.test.ts — the fan-out engine records WHAT a
// sub-session was asked and WHAT it answered.
//
// The gap this pins: fanout/subsession.dispatched carried a character COUNT
// (promptChars) and fanout/subsession.complete carried {ok, attempts}, so the brief a
// sub-session was handed and the text it returned were both absent from the journal.
// In the analyzed run a mechanical classifier ran 271 s and a skeptic 115 s and
// nothing anywhere recorded either side of the exchange.
//
// The contract asserted here:
//   - subsession.dispatched carries `prompt` — the exact text sent, brief plus schema
//     shape — and KEEPS `promptChars`, which conductor/tools/observation.ts reads.
//   - subsession.complete carries `response` — the reply text the engine already held.
//   - both are capped at MAX_TRANSCRIPT_CHARS, and a record whose text was cut carries
//     `truncated: true`; a record whose text fit carries no `truncated` key at all, so
//     a journal written before this contract reads as untruncated rather than as a lie.
//   - `promptChars` stays the size of the WHOLE prompt even when `prompt` is capped.
//   - a wave of six dispatches records six prompts, not one.
//   - a completion with no reply in hand (session-create failure) carries no
//     `response` key rather than an invented empty one.
//
// Driven against the FAKE in-process SDK (tests/fixtures/fake-sdk.ts) — no opencode,
// no model, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createFanout, MAX_TRANSCRIPT_CHARS } from "../adapter/fanout.ts";
import type { FanoutJob, RegistryEntry, TreeState } from "../adapter/fanout.ts";
import { SCHEMAS, treePath } from "../core/types.ts";
import type { Config, TreePath } from "../core/types.ts";
import type { Corr, Journal } from "../adapter/journal.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

const PROBE = "FanoutTranscriptProbe";
SCHEMAS[PROBE] = {
  type: "object",
  properties: { ok: { type: "boolean" }, note: { type: "string" } },
  required: ["ok", "note"],
  additionalProperties: false,
};

const VALID = JSON.stringify({ ok: true, note: "done" });
const INVALID = JSON.stringify({ ok: true }); // missing the required "note"

const TREE_MAIN = treePath("/repo");

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

// Nothing here exercises the freeze path, so every tree is clear and nobody subscribes.
function makeClearTreeState(): TreeState {
  return {
    isFrozen(_tree: TreePath): boolean {
      return false;
    },
    onClear(_listener: (tree: TreePath) => void): () => void {
      return () => undefined;
    },
  };
}

function makeConfig(): Config {
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
      subSessionTimeoutMs: 60_000,
    },
    models: { default: "llamacpp/model-A", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 20, maxRunDirBytes: 268_435_456, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
}

function readJob(over: Partial<FanoutJob> = {}): FanoutJob {
  return {
    role: "reviewer",
    itemId: "i1",
    tree: TREE_MAIN,
    writeCapable: false,
    prompt: "review the change",
    schemaName: PROBE,
    priority: "review",
    ...over,
  };
}

function eventsOf(records: LoggedRecord[], event: string): LoggedRecord[] {
  return records.filter((r) => r.component === "fanout" && r.event === event);
}

function one(records: LoggedRecord[], event: string): Record<string, unknown> {
  const hits = eventsOf(records, event);
  assert.equal(hits.length, 1, `exactly one fanout/${event} record`);
  return hits[0]!.data;
}

// ---------------------------------------------------------------------------
// The brief is on the dispatch record, verbatim.
// ---------------------------------------------------------------------------
test("a dispatch journals the prompt it actually sent, alongside promptChars", async () => {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  sdk.setResponder(() => ({ kind: "reply", text: VALID }));
  await fanout.dispatch(readJob({ prompt: "REVIEW THIS DIFF, carefully" }));

  const sent = sdk.prompts[0]!.text;
  const data = one(records, "subsession.dispatched");
  assert.equal(data["prompt"], sent, "the record carries the exact text the sub-session was handed");
  assert.ok(String(data["prompt"]).includes("REVIEW THIS DIFF, carefully"), "the brief itself is readable");
  assert.equal(data["promptChars"], sent.length, "promptChars still measures the whole prompt");
  assert.equal("truncated" in data, false, "a prompt that fit is not marked truncated");
});

// ---------------------------------------------------------------------------
// The answer is on the completion record.
// ---------------------------------------------------------------------------
test("a completion journals the response text the sub-session returned", async () => {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  sdk.setResponder(() => ({ kind: "reply", text: VALID }));
  await fanout.dispatch(readJob());

  const data = one(records, "subsession.complete");
  assert.equal(data["ok"], true, "the existing ok field survives");
  assert.equal(data["attempts"], 1, "the existing attempts field survives");
  assert.equal(data["response"], VALID, "the reply text is on the record");
  assert.equal("truncated" in data, false, "a response that fit is not marked truncated");
});

// ---------------------------------------------------------------------------
// Retry exhaustion: the record names the last thing the sub-session said, which is
// the text a reader needs to see why the validator kept refusing it.
// ---------------------------------------------------------------------------
test("a schema-invalid exhaustion journals the last response the sub-session gave", async () => {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  sdk.setResponder(() => ({ kind: "reply", text: INVALID }));
  await fanout.dispatch(readJob());

  const data = one(records, "subsession.complete");
  assert.equal(data["ok"], false);
  assert.equal(data["reason"], "schema-invalid");
  assert.equal(data["response"], INVALID, "the refused text is recoverable from the journal");
});

// ---------------------------------------------------------------------------
// A wave of six is six exchanges, not one.
// ---------------------------------------------------------------------------
test("a wave of six dispatches records six prompts, one per job", async () => {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  sdk.setResponder((req) => ({ kind: "reply", text: JSON.stringify({ ok: true, note: req.sessionID }) }));
  const jobs = [0, 1, 2, 3, 4, 5].map((n) => readJob({ itemId: `i${n}`, prompt: `lens-${n} brief` }));
  await fanout.dispatchWave(jobs);

  const dispatched = eventsOf(records, "subsession.dispatched");
  assert.equal(dispatched.length, 6, "six jobs, six dispatch records");
  const briefs = dispatched.map((r) => String(r.data["prompt"]));
  for (let n = 0; n < 6; n += 1) {
    assert.equal(
      briefs.filter((brief) => brief.includes(`lens-${n} brief`)).length,
      1,
      `job ${n}'s own brief appears exactly once`,
    );
  }
  assert.equal(new Set(briefs).size, 6, "six distinct prompts, not one repeated");

  const completed = eventsOf(records, "subsession.complete");
  assert.equal(completed.length, 6, "six completions");
  assert.equal(
    new Set(completed.map((r) => String(r.data["response"]))).size,
    6,
    "each completion carries its OWN sub-session's answer",
  );
});

// ---------------------------------------------------------------------------
// The cap.
// ---------------------------------------------------------------------------
test("an over-cap prompt and response are cut at MAX_TRANSCRIPT_CHARS and marked truncated", async () => {
  assert.ok(MAX_TRANSCRIPT_CHARS >= 4096, "the cap must hold a whole observed brief (2543-2863 chars)");

  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  const hugeNote = "z".repeat(MAX_TRANSCRIPT_CHARS * 2);
  sdk.setResponder(() => ({ kind: "reply", text: JSON.stringify({ ok: true, note: hugeNote }) }));
  await fanout.dispatch(readJob({ prompt: "y".repeat(MAX_TRANSCRIPT_CHARS * 2) }));

  const sent = sdk.prompts[0]!.text;
  const dispatched = one(records, "subsession.dispatched");
  assert.equal(String(dispatched["prompt"]).length, MAX_TRANSCRIPT_CHARS, "the prompt is cut at the cap");
  assert.equal(dispatched["truncated"], true, "and the record says so");
  assert.equal(dispatched["promptChars"], sent.length, "promptChars still reports the UNCUT size");
  assert.ok(sent.length > MAX_TRANSCRIPT_CHARS, "premise: the prompt really was over the cap");

  const completed = one(records, "subsession.complete");
  assert.equal(String(completed["response"]).length, MAX_TRANSCRIPT_CHARS, "the response is cut at the cap");
  assert.equal(completed["truncated"], true, "and the record says so");
  assert.equal(completed["ok"], true, "truncating the transcript does not change the outcome");
});

// ---------------------------------------------------------------------------
// A capped record must still fit the journal's own record ceiling, or the journal
// replaces the WHOLE data blob with a preview and every other field is lost.
// ---------------------------------------------------------------------------
test("a capped transcript record stays well inside the journal's 32 KiB record ceiling", async () => {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  sdk.setResponder(() => ({
    kind: "reply",
    text: JSON.stringify({ ok: true, note: "w".repeat(MAX_TRANSCRIPT_CHARS * 2) }),
  }));
  await fanout.dispatch(readJob({ prompt: "v".repeat(MAX_TRANSCRIPT_CHARS * 2) }));

  const encoder = new TextEncoder();
  for (const record of records) {
    const bytes = encoder.encode(JSON.stringify({ event: record.event, data: record.data })).length;
    assert.ok(
      bytes < 32 * 1024,
      `fanout/${record.event} serializes to ${String(bytes)} bytes, at or past the journal's 32 KiB ceiling`,
    );
  }
});

// ---------------------------------------------------------------------------
// Degrade, never invent: a completion the engine reaches with no reply in hand says
// nothing about a response rather than reporting an empty one.
// ---------------------------------------------------------------------------
test("a completion with no reply in hand carries no response key", async () => {
  const registry = new Map<string, RegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const { journal, records } = makeRecordingJournal();
  const fanout = createFanout(sdk.client, makeConfig(), journal, registry, makeClearTreeState());

  sdk.setCreateResponder(() => ({ kind: "error", error: { message: "no session for you" } }));
  const result = await fanout.dispatch(readJob());
  assert.notEqual(result.error, undefined, "premise: the job failed in the create phase");

  const data = one(records, "subsession.complete");
  assert.equal(data["reason"], "session-create-failed");
  assert.equal("response" in data, false, "no reply was ever received, so none is reported");
  assert.equal(eventsOf(records, "subsession.dispatched").length, 0, "and no dispatch was recorded");
});
