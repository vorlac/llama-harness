// conductor/tests/handler-refusal-journal.test.ts — a refused conductor tool call
// leaves a record in the journal.
//
// The hole this closes, measured from a live run: gateBeforeToolCall journals
// `gates: allow` and `gates: deny`, so every call the GATE STACK judged is on the
// record. A refusal thrown further in — by the run FSM, by validateQueue, by a
// handler's own legality step — was a bare throw that wrote nothing. In the
// analyzed run, conductor_decompose (refused: "illegal run transition
// EXECUTING->DECOMPOSED") and conductor_queue_amend (refused by validateQueue)
// BOTH appear in journal.jsonl as `gates: allow` and nowhere else: two of the
// run's three tool failures survived only in opencode's own log, where no replay,
// no observer and no post-mortem can reach them.
//
// The composition root's runTool is the ONE choke point every §3.4 call passes
// through, so the record is emitted there: component "gates", event "refused",
// carrying the tool name, the verbatim refusal text the caller reads, and the
// session/run/item context its sibling records carry. It is a record and nothing
// else — the refusal still THROWS, unchanged, because a refusal converted to data
// is a refusal the model reads as success.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { isKnownEvent } from "../core/journal-events.ts";
import { ConductorPlugin } from "../plugin/index.ts";

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-refusal-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

interface PluginHooks {
  tool?: Record<string, { description: string; execute: (args: unknown, ctx: unknown) => Promise<unknown> }>;
}

function pluginInput(directory: string): unknown {
  return {
    client: {},
    project: { id: "prj_refusal", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

function toolCtx(sessionID: string, directory: string): unknown {
  return {
    sessionID,
    messageID: "msg_refusal",
    agent: "conductor",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

interface SinkRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: Record<string, unknown>;
}

// The §7.1 stderr sink is where a journal with no bound run writes, so a
// console.error capture reads exactly the records the plugin emitted.
async function capture(fn: () => Promise<void>): Promise<SinkRecord[]> {
  const records: SinkRecord[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    const first = args[0];
    if (typeof first !== "string") return;
    try {
      const parsed = JSON.parse(first) as SinkRecord;
      if (typeof parsed.component === "string" && typeof parsed.event === "string") records.push(parsed);
    } catch {
      // Not a journal record — the sink writes JSON and nothing else, so anything
      // unparseable belongs to some other writer and is not this audit's subject.
    }
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return records;
}

function refusedRecords(records: SinkRecord[]): SinkRecord[] {
  return records.filter((record) => record.component === "gates" && record.event === "refused");
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

test("[refusal-vocab] the closed §7.4 vocabulary lists gates/refused — adapter/journal.ts THROWS on an unlisted name, so an unregistered name makes every write below a second crash", () => {
  assert.equal(
    isKnownEvent("gates", "definitely-not-a-listed-event-4471"),
    false,
    "premise: isKnownEvent rejects an unlisted name, or the assertion below is vacuous",
  );
  assert.equal(isKnownEvent("gates", "refused"), true);
});

// ---------------------------------------------------------------------------
// The choke point, driven through the REAL plugin
// ---------------------------------------------------------------------------

test("[refusal-journaled-early] a call refused BEFORE the handler bundle is assembled (a required argument the caller never supplied) journals gates/refused carrying the tool name and the verbatim refusal — and still throws", async () => {
  const root = scratchDir("early");
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  const hooks = await factory(pluginInput(root));
  const definition = (hooks.tool ?? {})["conductor_submit_test"];
  assert.ok(definition !== undefined, "premise: conductor_submit_test is registered");

  let thrown: unknown = null;
  const records = await capture(async () => {
    try {
      await definition.execute({}, toolCtx("ses_refusal_early", root));
    } catch (err) {
      thrown = err;
    }
  });

  assert.ok(thrown instanceof Error, "the refusal must reach the caller as a throw, not as data");
  const message = (thrown as Error).message;
  assert.match(message, /itemId/, "premise: this is the missing-argument refusal");

  const refusals = refusedRecords(records);
  assert.equal(
    refusals.length,
    1,
    `a refused tool call must leave exactly one gates/refused record; the sink saw ${JSON.stringify(
      records.map((r) => `${r.component}/${r.event}`),
    )}`,
  );
  const record = refusals[0];
  assert.equal(record.level, "warn", "a refusal is journaled at warn, like the deny it sits beside");
  assert.equal(record.data.toolName, "conductor_submit_test", "the record names the tool that was refused");
  assert.equal(
    record.data.reason,
    message,
    "and carries the refusal VERBATIM — a paraphrase is a second story about what the caller was told",
  );
  assert.equal(record.corr.sessionID, "ses_refusal_early", "with the calling session, as its siblings carry");
});

test("[refusal-journaled-deep] a call refused DEEPER IN — past the caller and argument checks, where the run FSM, validateQueue and the handlers' own legality steps live — journals gates/refused too, because the choke point catches rather than each handler reporting itself", async () => {
  const root = scratchDir("deep");
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  const hooks = await factory(pluginInput(root));
  const definition = (hooks.tool ?? {})["conductor_submit_test"];
  assert.ok(definition !== undefined, "premise: conductor_submit_test is registered");

  let thrown: unknown = null;
  const records = await capture(async () => {
    try {
      await definition.execute({ itemId: "I1" }, toolCtx("ses_refusal_deep", root));
    } catch (err) {
      thrown = err;
    }
  });

  assert.ok(
    thrown instanceof Error,
    "premise: an unconfigured workspace with no live run cannot serve conductor_submit_test",
  );
  const message = (thrown as Error).message;
  assert.doesNotMatch(
    message,
    /required argument/,
    "premise: this refusal comes from past the argument check, or the row proves nothing the one above did not",
  );

  const refusals = refusedRecords(records);
  assert.equal(refusals.length, 1, "the deeper refusal is journaled exactly once, not zero times and not twice");
  assert.equal(refusals[0].data.toolName, "conductor_submit_test");
  assert.equal(refusals[0].data.reason, message, "the verbatim refusal");
});
