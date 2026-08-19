// conductor/tests/wiring-manifest.test.ts — GAP-002 completeness test.
//
// SUBJECTS: conductor/core/wiring-manifest.ts (the declarative wire ledger) and
// conductor/plugin/index.ts (the composition root whose registration must equal
// it). This file constructs the REAL plugin the opencode loader constructs and
// asserts, in both directions, that the wires it registers are exactly the wires
// the manifest declares.
//
// WHY THIS FILE EXISTS. ISSUE-001 shipped a whole doctrine-injection layer that
// was built, imported and tested — and never registered, so it ran in no session
// and every test stayed green because each proved its own helper rather than the
// wire. The delivery witness (inject-wiring.test.ts) proves the three §6.4 hooks
// carry text to a request; this file is the completeness INDEX over it and over
// the gate/fan-out witnesses: it does not re-run their behaviour, it asserts every
// wire they depend on is present and that nothing was silently added past the
// ledger. Drop the `event` hook and this goes red; add a seventh hook without a
// manifest entry and this goes red; register a tool with the silent argument-free
// fallback ToolSpec (MACRO-025(b)) and this goes red.
//
// The manifest test reads NOTHING out of the composition helpers to decide what
// "registered" means — it reads the constructed plugin's own return object and the
// composition root's own import graph.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ConductorPlugin } from "../plugin/index.ts";
import { initRepo } from "../adapter/gitio.ts";
import { CONDUCTOR_TOOL_NAMES } from "../adapter/tools.ts";
import {
  WIRING_MANIFEST,
  declaredHookKeys,
  declaredModuleWires,
  declaredToolBinding,
  fallbackToolDescription,
} from "../core/wiring-manifest.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = path.resolve(HERE, "..", "plugin", "index.ts");

interface RegisteredTool {
  description?: unknown;
  execute?: unknown;
}

interface PluginHooks {
  tool?: Record<string, RegisteredTool>;
  [key: string]: unknown;
}

// Construct the plugin exactly as the opencode loader does: call the factory with
// a synthetic PluginInput. Construction is LAZY (plugin/index.ts opens no
// workspace at construction), so a bare git repo and a fake client suffice; no
// hook is invoked here — this test reads the SHAPE the loader receives.
function pluginInput(directory: string, client: unknown): unknown {
  return {
    client,
    project: { id: "prj_manifest", worktree: directory },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

async function constructPlugin(): Promise<PluginHooks> {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-manifest-"));
  try {
    initRepo(dir);
    const sdk = makeFakeSdk({ registry: new Map(), idPrefix: "ses_manifest_" });
    const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
    return await factory(pluginInput(dir, sdk.client));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A wire's source references, comment lines removed, so a symbol mentioned only in
// a `//` comment does not count as a live reference (openWorkspace and createFanout
// both appear in explanatory comments as well as at their call sites).
function nonCommentLinesMentioning(source: string, symbol: string): string[] {
  const re = new RegExp(`\\b${symbol}\\b`);
  return source
    .split("\n")
    .filter((line) => re.test(line))
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
}

test("[GAP-002-hook-parity] the composition root registers EXACTLY the manifest's hook wires — no undeclared hook, no undelivered declaration", async () => {
  const hooks = await constructPlugin();

  const declared = new Set(declaredHookKeys());
  assert.ok(declared.size > 0, "the manifest declares at least one hook wire");

  // Every key on the return object except `tool` is a lifecycle hook opencode
  // invokes; `tool` is the tool map, covered by the toolBinding wire below.
  const registered = new Set(Object.keys(hooks).filter((k) => k !== "tool"));

  const missing = [...declared].filter((k) => !registered.has(k));
  const undeclared = [...registered].filter((k) => !declared.has(k));

  assert.deepEqual(
    missing,
    [],
    `declared wire(s) not registered by the composition root (the ISSUE-001 shape): ${missing.join(", ")}`,
  );
  assert.deepEqual(
    undeclared,
    [],
    `hook(s) registered but absent from the wiring manifest (a wire added past the ledger): ${undeclared.join(", ")}`,
  );
});

test("[GAP-002-tool-binding] the tool map's keys equal CONDUCTOR_TOOL_NAMES, and every tool carries a real (non-fallback) ToolSpec", async () => {
  const hooks = await constructPlugin();

  const binding = declaredToolBinding();
  assert.equal(
    binding.registration,
    "CONDUCTOR_TOOL_NAMES",
    "the single toolBinding wire names the §3.4 inventory accessor",
  );

  const map = hooks.tool ?? {};
  const registered = Object.keys(map).sort();
  const inventory = [...CONDUCTOR_TOOL_NAMES].sort();
  assert.ok(inventory.length > 0, "premise: the inventory is non-empty");
  assert.deepEqual(
    registered,
    inventory,
    "the registered tool-map keys must equal CONDUCTOR_TOOL_NAMES exactly — no dropped tool, no undeclared tool",
  );

  // MACRO-025(b): a name missing from the composition root's `specs` map is
  // registered with the argument-free fallback description rather than dropped, so
  // the inventory assertion above cannot catch it. A tool still wearing its
  // fallback description is a silently-half-wired tool.
  for (const name of inventory) {
    const tool = map[name] ?? {};
    assert.equal(typeof tool.execute, "function", `${name} has an execute function`);
    assert.equal(typeof tool.description, "string", `${name} has a string description`);
    assert.notEqual(
      tool.description,
      fallbackToolDescription(name),
      `${name} still carries the argument-free fallback ToolSpec (MACRO-025(b)) — it has no hand-written spec`,
    );
  }
});

test("[GAP-002-module-wires] each declared module wire is both imported and referenced by the composition root — no dead import", () => {
  const source = readFileSync(PLUGIN_PATH, "utf8");
  const modules = declaredModuleWires();
  assert.ok(modules.length > 0, "the manifest declares at least one module wire");

  for (const wire of modules) {
    assert.equal(typeof wire.binds, "string", `${wire.name} module wire names a bound symbol`);
    const symbol = wire.binds as string;

    const importRe = new RegExp(
      `import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*["']${wire.registration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    );
    assert.ok(
      importRe.test(source),
      `the composition root must import ${symbol} from ${wire.registration} (${wire.name})`,
    );

    // References OTHER than the import line: a symbol imported and never called is
    // the ISSUE-001 shape — a wire that exists on paper and reaches no session.
    const refs = nonCommentLinesMentioning(source, symbol).filter(
      (line) => !/^\s*import\b/.test(line),
    );
    assert.ok(
      refs.length > 0,
      `${symbol} is imported but never referenced in the composition root body — dead wiring (${wire.name})`,
    );
  }
});

test("[GAP-002-manifest-shape] the manifest is well-formed: unique names, exactly one tool binding, module wires bind a symbol", () => {
  const names = WIRING_MANIFEST.map((w) => w.name);
  assert.deepEqual(
    names,
    [...new Set(names)],
    "wire names are unique",
  );
  assert.equal(
    WIRING_MANIFEST.filter((w) => w.kind === "toolBinding").length,
    1,
    "exactly one toolBinding wire",
  );
  for (const wire of WIRING_MANIFEST) {
    assert.ok(wire.registration.length > 0, `${wire.name} names a registration`);
    if (wire.kind === "module") {
      assert.ok(
        typeof wire.binds === "string" && wire.binds.length > 0,
        `${wire.name} module wire binds a symbol`,
      );
    }
  }
});
