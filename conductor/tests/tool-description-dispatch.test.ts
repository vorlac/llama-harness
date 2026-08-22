// conductor/tests/tool-description-dispatch.test.ts — a stage tool that DISPATCHES
// a sub-session says so in the one sentence the model ever reads about it.
//
// The wedge this closes, measured from a live run. conductor_submit_test's whole
// description was "Run the item's test and assert a legal red (behavioral);
// PENDING to RED." — a sentence about VERIFYING a test that already exists. What
// the handler does is dispatch a test-writer sub-session that AUTHORS the failing
// test. The orchestrator drew the only inference that sentence supports and wrote
// it into its own notes — "a failing test must be added to tests/check_visible.py
// before submit_test" — then spent 26 minutes trying to reach a file its claim
// could not cover, and the run ended having written nothing.
//
// A tool description is not documentation: it is the model's only account of what
// the call does, so a description that names the assertion and hides the dispatch
// tells the orchestrator to do the work itself. The row below derives WHICH
// handlers dispatch from the adapter source rather than from a list a person keeps
// in their head — a handler that grows a fan-out and keeps a quiet description is
// red the moment it lands.

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_BINDINGS } from "../core/tool-bindings.ts";
import { ConductorPlugin } from "../plugin/index.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const toolsSourcePath = path.resolve(testsDir, "../adapter/tools.ts");

// Anti-vacuity floors (C-045): a parse that silently reads less than it claims is
// worse than no parse, so every step below asserts a plausible minimum.
const MIN_FUNCTIONS = 100;
const MIN_DISPATCHING_HANDLERS = 8;

interface PluginHooks {
  tool?: Record<string, { description?: unknown }>;
}

function stubPluginInput(): unknown {
  return {
    client: {},
    project: { id: "prj_desc", worktree: "/repo" },
    directory: "/repo",
    worktree: "/repo",
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

async function descriptions(): Promise<Map<string, string>> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  const hooks = await factory(stubPluginInput());
  const map = hooks.tool ?? {};
  const out = new Map<string, string>();
  for (const [name, definition] of Object.entries(map)) {
    const text = definition.description;
    assert.equal(typeof text, "string", `${name} must carry a string description`);
    out.set(name, text as string);
  }
  assert.ok(out.size > 0, "premise: the plugin registers a non-empty tool map");
  return out;
}

// Every top-level function in adapter/tools.ts, sliced from its own `function`
// line to the next one. Slicing beats brace-counting here: braces inside template
// literals and regexes are common in this file, and a mis-counted body would
// silently shrink the set the row below reasons over.
function topLevelFunctions(): Map<string, string> {
  const source = readFileSync(toolsSourcePath, "utf8");
  const lines = source.split("\n");
  const starts: Array<{ line: number; name: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(?:export )?(?:async )?function (\w+)/.exec(lines[i]);
    if (match !== null) starts.push({ line: i, name: match[1] });
  }
  const bodies = new Map<string, string>();
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1].line : lines.length;
    bodies.set(starts[k].name, lines.slice(starts[k].line, end).join("\n"));
  }
  return bodies;
}

// The functions that REACH the fan-out engine: those calling fanout.dispatch /
// fanout.dispatchWave directly, closed under "calls something that does". The
// per-stage helpers (dispatchTestWriter, dispatchImplementer, planReviewRound) sit
// between the handlers and the engine, so a direct-only scan would miss exactly
// the handlers this row exists for.
function dispatchingFunctions(bodies: Map<string, string>): Set<string> {
  const reaching = new Set<string>();
  for (const [name, body] of bodies) {
    if (body.includes("fanout.dispatch")) reaching.add(name);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of bodies) {
      if (reaching.has(name)) continue;
      for (const callee of reaching) {
        if (new RegExp(`\\b${callee}\\s*\\(`).test(body)) {
          reaching.add(name);
          grew = true;
          break;
        }
      }
    }
  }
  return reaching;
}

// A description that names the dispatch: this repository calls it a dispatch or a
// fan-out, and either word tells the orchestrator the work is not its own to do.
const NAMES_A_DISPATCH = /\b(dispatch(es|ed|ing)?|fan-?out)\b/i;

test("[dispatch-named-in-description] every tool whose handler REACHES the fan-out engine says so in its description — a description that names its assertion and hides its dispatch tells the orchestrator to do the work itself, which is the 26-minute fork this row exists to prevent", async () => {
  const bodies = topLevelFunctions();
  assert.ok(
    bodies.size >= MIN_FUNCTIONS,
    `parsed only ${bodies.size} top-level functions out of adapter/tools.ts (>= ${MIN_FUNCTIONS} exist) — the parse is broken, and a broken scan must be RED rather than a vacuous green`,
  );

  const reaching = dispatchingFunctions(bodies);
  // The derivation DISCRIMINATES: two committed handlers run no fan-out at all,
  // and a scan that swept every handler into the set would prove nothing.
  for (const quiet of ["handlePublish", "handleReport"]) {
    assert.ok(bodies.has(quiet), `premise: ${quiet} is a committed handler`);
    assert.equal(
      reaching.has(quiet),
      false,
      `${quiet} dispatches nothing, so the derivation must NOT claim it — a check that flags every handler discriminates nothing`,
    );
  }

  const specs = await descriptions();
  const offenders: string[] = [];
  const covered: string[] = [];
  for (const [tool, binding] of Object.entries(TOOL_BINDINGS)) {
    if (binding === null) continue;
    assert.ok(
      bodies.has(binding.handler),
      `${tool} binds handler ${binding.handler}, which the adapter parse did not find`,
    );
    if (!reaching.has(binding.handler)) continue;
    covered.push(tool);
    const description = specs.get(tool);
    assert.equal(typeof description, "string", `${tool} must be registered with a description`);
    if (!NAMES_A_DISPATCH.test(description as string)) {
      offenders.push(`${tool} (${binding.handler}): ${description as string}`);
    }
  }

  assert.ok(
    covered.length >= MIN_DISPATCHING_HANDLERS,
    `only ${covered.length} bound tools were found to dispatch (>= ${MIN_DISPATCHING_HANDLERS} do) — the derivation missed the fan-out call sites`,
  );
  assert.deepEqual(
    offenders,
    [],
    "these tools dispatch a sub-session and their description never says so. The model reads this " +
      "sentence and nothing else about the call, so a description that omits the dispatch reads as an " +
      "instruction to produce the artifact first — which is how one run spent 59% of its budget " +
      "trying to write a test its own tool would have had a sub-session author.",
  );
});

test("[submit-test-description] conductor_submit_test's description names the test-writer it dispatches and says that sub-session AUTHORS the failing test — the committed sentence described verifying a test that already existed, and the orchestrator believed it", async () => {
  const specs = await descriptions();
  const description = specs.get("conductor_submit_test");
  assert.equal(typeof description, "string", "premise: conductor_submit_test is registered");
  const text = description as string;

  assert.match(text, NAMES_A_DISPATCH, "it dispatches, and the sentence must say so");
  assert.match(
    text,
    /test-?writer/i,
    "and must name WHO is dispatched, so the orchestrator knows the author is not itself",
  );
  assert.match(
    text,
    /\b(writes|authors)\b/i,
    "and must say that sub-session WRITES the test — the difference between this and 'assert a legal red' " +
      "is the whole of the failure: one asks the orchestrator to produce a test file it has no scope for, " +
      "the other tells it to make the call",
  );
});

test("[inline-claim-description] conductor_inline_claim's description states the one state it is always refused in — a behavioral item at PENDING — because the phase gate never advertises this tool in `legal` and the description is the model's only source for the rule", async () => {
  const specs = await descriptions();
  const description = specs.get("conductor_inline_claim");
  assert.equal(typeof description, "string", "premise: conductor_inline_claim is registered");
  const text = description as string;

  assert.match(
    text,
    /behavioral/i,
    "the refusal keys on the item being behavioral, and a rule the model can only learn by spending a " +
      "turn on it is a rule that costs a turn on every run",
  );
  assert.match(text, /PENDING/, "and on it sitting at PENDING");
  assert.match(
    text,
    /refus/i,
    "and the sentence must say the call is REFUSED there, not merely discouraged — the handler throws",
  );
  assert.match(
    text,
    /conductor_submit_test/,
    "and it must name the tool that does own that transition, so learning the rule and learning the " +
      "exit cost the same zero turns",
  );
});
