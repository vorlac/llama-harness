// Task 0.3 (assertions 0.3-fragment, 0.3-fragment-test): pin the content of
// conductor/opencode-fragment.json to the plan's §5.3 JSON block (plan lines
// 1754-1780), which the implementer copies verbatim. The file is located
// relative to this test file (never process.cwd(), never an absolute path).
// Note: "${LLAMA_HARNESS_ROOT}" below is the literal substitution token that
// the fragment ships with (serve.py substitutes it at generation time), not a
// template interpolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FRAGMENT_URL = new URL("../opencode-fragment.json", import.meta.url);

const ORCHESTRATOR = "conductor-orchestrator";

const SUBAGENT_NAMES: readonly string[] = [
  "conductor-implementer",
  "conductor-test-writer",
  "conductor-reviewer",
  "conductor-skeptic",
  "conductor-planner",
  "conductor-mechanical",
];

const ALL_AGENT_NAMES: readonly string[] = [ORCHESTRATOR, ...SUBAGENT_NAMES];

const EDIT_DENY_SUBAGENTS: readonly string[] = [
  "conductor-reviewer",
  "conductor-skeptic",
  "conductor-planner",
  "conductor-mechanical",
];

function assertIsRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
}

function readFragment(): Record<string, unknown> {
  const raw = readFileSync(FRAGMENT_URL, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assertIsRecord(parsed, "fragment root");
  return parsed;
}

function agentTable(fragment: Record<string, unknown>): Record<string, unknown> {
  const agent = fragment["agent"];
  assertIsRecord(agent, "fragment.agent");
  return agent;
}

function agentEntry(
  fragment: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const entry = agentTable(fragment)[name];
  assertIsRecord(entry, `fragment.agent["${name}"]`);
  return entry;
}

function permissionOf(
  entry: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const permission = entry["permission"];
  assertIsRecord(permission, `fragment.agent["${name}"].permission`);
  return permission;
}

test("fragment: parses as strict JSON with exactly the top-level keys plugin and agent", () => {
  const fragment = readFragment();
  assert.deepEqual(Object.keys(fragment).sort(), ["agent", "plugin"]);
});

test("fragment: plugin is a single-entry array pointing the harness-root token at conductor/plugin/index.ts", () => {
  const fragment = readFragment();
  const plugin = fragment["plugin"];
  assert.ok(Array.isArray(plugin), "fragment.plugin must be an array");
  assert.equal(plugin.length, 1, "fragment.plugin must have exactly one entry");
  const entry: unknown = plugin[0];
  assert.equal(typeof entry, "string", "fragment.plugin[0] must be a string");
  const path = entry as string;
  assert.ok(
    path.startsWith("${LLAMA_HARNESS_ROOT}"),
    'fragment.plugin[0] must start with the literal token "${LLAMA_HARNESS_ROOT}"',
  );
  assert.ok(
    path.endsWith("conductor/plugin/index.ts"),
    'fragment.plugin[0] must end with "conductor/plugin/index.ts"',
  );
  assert.equal(path, "${LLAMA_HARNESS_ROOT}/conductor/plugin/index.ts");
});

test("fragment: agent object has exactly the seven conductor agent definitions", () => {
  const fragment = readFragment();
  const agent = agentTable(fragment);
  assert.deepEqual(
    Object.keys(agent).sort(),
    [...ALL_AGENT_NAMES].sort(),
    "fragment.agent must define exactly the seven conductor agents, no more, no fewer",
  );
});

test("fragment: conductor-orchestrator is the primary agent with ask-edit, git-commit/push denied, and a {file:...core.md} prompt", () => {
  const fragment = readFragment();
  const orchestrator = agentEntry(fragment, ORCHESTRATOR);
  assert.equal(orchestrator["mode"], "primary");

  const permission = permissionOf(orchestrator, ORCHESTRATOR);
  assert.equal(permission["edit"], "ask");

  const bash = permission["bash"];
  assertIsRecord(bash, `fragment.agent["${ORCHESTRATOR}"].permission.bash`);
  assert.equal(bash["*"], "allow");
  assert.equal(bash["git commit *"], "deny");
  assert.equal(bash["git push *"], "deny");

  const prompt = orchestrator["prompt"];
  assert.equal(typeof prompt, "string", "orchestrator prompt must be a string");
  assert.equal(prompt, "{file:${LLAMA_HARNESS_ROOT}/conductor/doctrine/core.md}");
});

test("fragment: each of the six subagent definitions has mode subagent and question ask", () => {
  const fragment = readFragment();
  for (const name of SUBAGENT_NAMES) {
    const entry = agentEntry(fragment, name);
    assert.equal(entry["mode"], "subagent", `fragment.agent["${name}"].mode`);
    const permission = permissionOf(entry, name);
    assert.equal(
      permission["question"],
      "ask",
      `fragment.agent["${name}"].permission.question`,
    );
  }
});

test("fragment: reviewer, skeptic, planner, and mechanical each deny edit", () => {
  const fragment = readFragment();
  for (const name of EDIT_DENY_SUBAGENTS) {
    const permission = permissionOf(agentEntry(fragment, name), name);
    assert.equal(
      permission["edit"],
      "deny",
      `fragment.agent["${name}"].permission.edit`,
    );
  }
});
