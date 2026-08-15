// conductor/tests/tool-binding.test.ts — C-044 structural guard: the tool surface
// and the handler surface must agree, by construction.
//
// C-035 and C-044 both found committed drift between a tool's declared args
// (plugin/index.ts) and its handler's input interface (adapter/tools.ts) —
// fields a handler REQUIRES that nothing declares, supplies, or fixes. This
// guard makes the correspondence a construction, the same way
// single-source.test.ts does for the FSM vocabularies: for every tool bound in
// core/tool-bindings.ts,
//
//   handler input REQUIRED fields
//     == declared tool args ∪ binding.infrastructure ∪ binding.fixed keys
//
// The DECLARED-args side is read from the REAL plugin (ConductorPlugin is
// instantiated and its tool map inspected, the gate-wiring.test.ts approach),
// so the guard checks what the plugin actually ships. The HANDLER side is
// TypeScript interfaces, erased at runtime, so it is read from the SOURCE text
// of adapter/tools.ts — acceptable for a guard, PROVIDED the parse fails
// loudly. C-045's lesson is that a check which silently inspects less than it
// claims to is worse than no check: every extraction below asserts a plausible
// minimum (>= 16 handlers, >= 16 input interfaces, >= 2 required fields each),
// so a broken parse is a red, never a vacuous green.
//
// Tools whose handler does not exist yet (publish, report, inline_claim,
// override, setup, forget_stale) are null in the binding table, and this guard
// asserts their handlers are genuinely ABSENT from the adapter source — plus
// that every exported handle* function is claimed by exactly one binding. So
// the moment 9.5b/9.5c export a new handler, the guard goes red until its
// binding is declared: new handlers are born under the guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_BINDINGS } from "../core/tool-bindings.ts";
import type { ToolBinding } from "../core/tool-bindings.ts";
import { ConductorPlugin } from "../plugin/index.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const toolsSourcePath = path.resolve(testsDir, "../adapter/tools.ts");

// Plausible minima (the anti-vacuity floor, C-045): at C-044 time the adapter
// exports 16 handlers over 16 distinct input interfaces, every input interface
// requires at least {store, runId, journal}, and §3.4 fixes the inventory at 22.
const MIN_HANDLERS = 16;
const MIN_INPUT_INTERFACES = 16;
const MIN_REQUIRED_FIELDS = 2;
const TOOL_COUNT = 22;
const MAX_UNBOUND = 6;

// ---------------------------------------------------------------------------
// The real plugin's declared tool args (the gate-wiring.test.ts approach).
// ---------------------------------------------------------------------------

// A synthetic opencode PluginInput — enough for the construction-safe factory to
// run under `node --test` with no opencode process.
function stubPluginInput(): unknown {
  return {
    client: {},
    project: { id: "prj_test", worktree: "/repo" },
    directory: "/repo",
    worktree: "/repo",
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  };
}

interface PluginHooks {
  tool?: Record<string, unknown>;
}

async function invokePlugin(): Promise<PluginHooks> {
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  return factory(stubPluginInput());
}

interface DeclaredArgs {
  required: Set<string>;
  optional: Set<string>;
}

// Split a tool definition's raw zod arg shape into required/optional names.
// `tool()` is identity, so the map values are `{description, args, execute}`
// and args is the raw shape record. Optionality comes from zod's own
// isOptional() — if the schema does not expose it, that is a loud failure, not
// a guess.
function declaredArgsOf(toolMap: Record<string, unknown>, toolName: string): DeclaredArgs {
  const def = toolMap[toolName];
  assert.ok(def !== null && typeof def === "object", `plugin tool "${toolName}" must be a definition object`);
  const args = (def as { args?: unknown }).args;
  assert.ok(args !== null && typeof args === "object", `plugin tool "${toolName}" must carry an args shape object`);
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const [argName, schema] of Object.entries(args as Record<string, unknown>)) {
    assert.ok(schema !== null && typeof schema === "object", `${toolName}.args.${argName} must be a zod schema`);
    const isOptional = (schema as { isOptional?: unknown }).isOptional;
    assert.equal(
      typeof isOptional,
      "function",
      `${toolName}.args.${argName}: zod schema must expose isOptional() — cannot classify the arg, refusing to guess`,
    );
    if ((isOptional as () => boolean).call(schema)) {
      optional.add(argName);
    } else {
      required.add(argName);
    }
  }
  return { required, optional };
}

// ---------------------------------------------------------------------------
// The adapter source parse (the erased-interface side). Every step loud.
// ---------------------------------------------------------------------------

interface InterfaceFields {
  required: Set<string>;
  optional: Set<string>;
  // field name -> the raw type TEXT that followed its colon. Names alone let a
  // tool declare the right argument with the wrong SHAPE, which is how C-047
  // shipped: `options: S.array(S.string())` satisfied a name-level check while
  // the handler wanted Array<{name, score?}>, so no call could ever have
  // produced a §2.7-legal record.
  types: Map<string, string>;
}

interface AdapterSurface {
  // exported handler name -> its input interface name
  handlers: Map<string, string>;
  // input interface name -> its parsed fields
  fieldsOf: (interfaceName: string) => InterfaceFields;
}

function readAdapterSource(): string {
  const source = readFileSync(toolsSourcePath, "utf8");
  assert.ok(
    source.length > 10_000,
    `adapter/tools.ts read only ${source.length} bytes — the guard's source read is broken`,
  );
  return source;
}

// Extract every `export [async] function handleX(input: XInput...)` signature.
// Anchored at line starts so comment text cannot match; \s+ spans a wrapped
// signature.
function extractHandlers(source: string): Map<string, string> {
  const handlers = new Map<string, string>();
  const re = /^export\s+(?:async\s+)?function\s+(handle\w+)\s*\(\s*input\s*:\s*(\w+)/gm;
  for (const m of source.matchAll(re)) {
    const name = m[1] as string;
    const inputName = m[2] as string;
    assert.equal(handlers.has(name), false, `handler ${name} extracted twice — the parse is broken`);
    handlers.set(name, inputName);
  }
  assert.ok(
    handlers.size >= MIN_HANDLERS,
    `extracted only ${handlers.size} exported handle* functions from adapter/tools.ts ` +
      `(>= ${MIN_HANDLERS} exist at C-044 time) — the extraction is broken, and a broken ` +
      `extraction must be red, never a vacuous green (C-045)`,
  );
  return handlers;
}

// Parse `export interface <name> { ... }` and classify its top-level fields as
// required (no `?`) or optional (`?`). Brace-depth tracked so a nested inline
// object type ({ role: string; sessionID: string }) contributes no field names.
function extractInterfaceFields(source: string, interfaceName: string): InterfaceFields {
  const marker = `export interface ${interfaceName} {`;
  const start = source.indexOf(marker);
  assert.notEqual(
    start,
    -1,
    `interface ${interfaceName} not found in adapter/tools.ts — either it was renamed ` +
      `(update core/tool-bindings.ts) or the guard's parse marker is broken`,
  );
  assert.equal(
    source.indexOf(marker, start + 1),
    -1,
    `interface ${interfaceName} declared more than once — the parse cannot pick one`,
  );

  const openIdx = start + marker.length - 1; // the "{"
  let depth = 0;
  let end = -1;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `interface ${interfaceName}: unbalanced braces — the parse is broken`);

  const body = source.slice(openIdx + 1, end);
  const required = new Set<string>();
  const optional = new Set<string>();
  const types = new Map<string, string>();
  let d = 1;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "");
    if (d === 1) {
      const m = /^\s*(\w+)(\?)?\s*:\s*(.*)$/.exec(line);
      if (m) {
        (m[2] === "?" ? optional : required).add(m[1] as string);
        // Only the first line of the type. That is deliberate: a multi-line
        // object or Array<{...}> still yields enough of a prefix to classify
        // COARSELY, and a partial read is safer than a brace-matching parse
        // that could silently mis-associate a field with a nested one.
        types.set(m[1] as string, (m[3] as string).trim());
      }
    }
    for (const ch of line) {
      if (ch === "{") d++;
      else if (ch === "}") d--;
    }
  }

  assert.ok(
    required.size >= MIN_REQUIRED_FIELDS,
    `interface ${interfaceName}: extracted only ${required.size} required fields ` +
      `(every handler input requires at least store+runId+journal) — an extraction ` +
      `this empty is a broken parse, and a broken parse must be red (C-045)`,
  );
  assert.equal(
    types.size,
    required.size + optional.size,
    `interface ${interfaceName}: captured ${types.size} field types for ` +
      `${required.size + optional.size} fields — the type capture is out of step with the ` +
      `name capture, so any shape comparison built on it would be checking the wrong field`,
  );
  return { required, optional, types };
}

function parseAdapterSurface(): AdapterSurface {
  const source = readAdapterSource();
  const handlers = extractHandlers(source);
  const cache = new Map<string, InterfaceFields>();
  const fieldsOf = (interfaceName: string): InterfaceFields => {
    let fields = cache.get(interfaceName);
    if (fields === undefined) {
      fields = extractInterfaceFields(source, interfaceName);
      cache.set(interfaceName, fields);
    }
    return fields;
  };
  return { handlers, fieldsOf };
}

// conductor_forget_stale -> handleForgetStale (holds for all 16 bound handlers;
// the not-yet-bound absence check leans on it, and the exactly-once claim sweep
// backstops any future handler that breaks the convention).
function conventionalHandlerName(toolName: string): string {
  const stem = toolName.replace(/^conductor_/, "");
  const camel = stem
    .split("_")
    .map((part) => (part.length === 0 ? part : (part[0] as string).toUpperCase() + part.slice(1)))
    .join("");
  return `handle${camel}`;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function setMinus(a: Set<string>, b: Set<string>): string[] {
  return sorted([...a].filter((v) => !b.has(v)));
}

// ---------------------------------------------------------------------------
// [C-044-inventory] the table and the shipped plugin cover the same tools.
// ---------------------------------------------------------------------------

test("[C-044-binding] the binding table covers exactly the plugin's registered tools", async () => {
  const hooks = await invokePlugin();
  assert.ok(hooks.tool !== null && typeof hooks.tool === "object", "the plugin registers a tool map");
  const registered = Object.keys(hooks.tool ?? {});
  const tableKeys = Object.keys(TOOL_BINDINGS);

  assert.equal(registered.length, TOOL_COUNT, `the plugin registers exactly the §3.4 ${TOOL_COUNT} tools`);
  assert.deepEqual(
    sorted(tableKeys),
    sorted(registered),
    "TOOL_BINDINGS must have exactly one entry per registered tool — no extras, none missing",
  );

  const bound = tableKeys.filter((name) => TOOL_BINDINGS[name] !== null);
  const unbound = tableKeys.filter((name) => TOOL_BINDINGS[name] === null);
  assert.ok(
    bound.length >= MIN_HANDLERS,
    `only ${bound.length} tools are bound in the table (>= ${MIN_HANDLERS} handlers exist at C-044 time) — bindings are missing`,
  );
  assert.ok(
    unbound.length <= MAX_UNBOUND,
    `${unbound.length} tools are marked not-yet-bound (at most ${MAX_UNBOUND} handlers were outstanding at C-044 time) — a binding was dropped instead of declared`,
  );
});

// ---------------------------------------------------------------------------
// [C-044-parse] the source extraction itself is loud (the C-045 lesson).
// ---------------------------------------------------------------------------

test("[C-044-binding] the adapter source parse extracts a plausible handler surface, loudly", () => {
  const surface = parseAdapterSurface();

  // extractHandlers already asserts >= MIN_HANDLERS; pin the interface side too.
  const interfaceNames = new Set(surface.handlers.values());
  assert.ok(
    interfaceNames.size >= MIN_INPUT_INTERFACES,
    `the ${surface.handlers.size} handlers map to only ${interfaceNames.size} distinct input ` +
      `interfaces (>= ${MIN_INPUT_INTERFACES} exist at C-044 time) — the extraction is broken`,
  );
  for (const interfaceName of interfaceNames) {
    // extractInterfaceFields asserts presence, uniqueness, and a non-vacuous
    // required-field floor for every one of them.
    surface.fieldsOf(interfaceName);
  }
});

// ---------------------------------------------------------------------------
// [C-044-claims] handlers and bindings claim each other, both directions.
// ---------------------------------------------------------------------------

test("[C-044-binding] every exported handler is claimed by exactly one binding, and not-yet-bound tools have no handler", () => {
  const surface = parseAdapterSurface();
  const claimedBy = new Map<string, string>(); // handler name -> tool name

  for (const [toolName, binding] of Object.entries(TOOL_BINDINGS)) {
    if (binding === null) {
      // A null entry is a PROMISE that the handler does not exist yet. The
      // moment 9.5b/9.5c export it, this goes red until the binding is declared.
      const expected = conventionalHandlerName(toolName);
      assert.equal(
        surface.handlers.has(expected),
        false,
        `${toolName} is marked not-yet-bound in core/tool-bindings.ts, but adapter/tools.ts ` +
          `now exports ${expected} — declare the tool's binding (handler, input, ` +
          `infrastructure, fixed) so the new handler is born under this guard`,
      );
      continue;
    }

    assert.equal(
      surface.handlers.has(binding.handler),
      true,
      `${toolName}: binding names handler ${binding.handler}, but adapter/tools.ts exports no such function`,
    );
    assert.equal(
      binding.handler,
      conventionalHandlerName(toolName),
      `${toolName}: handler ${binding.handler} breaks the conductor_x_y -> handleXY naming ` +
        `convention the not-yet-bound absence check depends on`,
    );
    assert.equal(
      surface.handlers.get(binding.handler),
      binding.input,
      `${toolName}: binding says ${binding.handler} takes ${binding.input}, but the source ` +
        `declares ${binding.handler}(input: ${surface.handlers.get(binding.handler)})`,
    );
    assert.equal(
      claimedBy.has(binding.handler),
      false,
      `handler ${binding.handler} is claimed by both ${claimedBy.get(binding.handler)} and ${toolName}`,
    );
    claimedBy.set(binding.handler, toolName);
  }

  const unclaimed = sorted([...surface.handlers.keys()].filter((h) => !claimedBy.has(h)));
  assert.deepEqual(
    unclaimed,
    [],
    `adapter/tools.ts exports handlers no binding claims: ${unclaimed.join(", ")} — every ` +
      `handler must be declared in core/tool-bindings.ts so the composition root can bind it`,
  );
});

// ---------------------------------------------------------------------------
// [C-044-equation] the load-bearing check: for every bound tool,
//   handler REQUIRED input == declared args ∪ infrastructure ∪ fixed.
// ---------------------------------------------------------------------------

test("[C-044-binding] every bound tool's declared args ∪ infrastructure ∪ fixed equal its handler's required input, exactly", async () => {
  const hooks = await invokePlugin();
  const toolMap = hooks.tool ?? {};
  const surface = parseAdapterSurface();
  const violations: string[] = [];

  let checked = 0;
  for (const [toolName, binding] of Object.entries(TOOL_BINDINGS)) {
    if (binding === null) continue;
    checked += 1;

    const declared = declaredArgsOf(toolMap as Record<string, unknown>, toolName);
    const input = surface.fieldsOf(binding.input);
    const infrastructure = new Set<string>(binding.infrastructure);
    const fixedKeys = new Set<string>(Object.keys(binding.fixed));

    // The three supply routes must not overlap — an arg both declared and
    // root-supplied would be silently shadowed at composition time.
    const declaredAll = new Set<string>([...declared.required, ...declared.optional]);
    for (const field of declaredAll) {
      if (infrastructure.has(field)) {
        violations.push(`${toolName}: "${field}" is both a declared tool arg and an infrastructure field`);
      }
      if (fixedKeys.has(field)) {
        violations.push(`${toolName}: "${field}" is both a declared tool arg and a fixed value`);
      }
    }
    for (const field of infrastructure) {
      if (fixedKeys.has(field)) {
        violations.push(`${toolName}: "${field}" is both an infrastructure field and a fixed value`);
      }
    }

    // The C-035/C-044 defect class, mechanized.
    const union = new Set<string>([...declared.required, ...infrastructure, ...fixedKeys]);
    for (const field of setMinus(input.required, union)) {
      violations.push(
        `${toolName}: ${binding.input}.${field} is REQUIRED by ${binding.handler} but is neither a ` +
          `declared tool arg, an infrastructure field, nor a fixed value — the handler cannot be satisfied`,
      );
    }
    for (const field of setMinus(union, input.required)) {
      violations.push(
        `${toolName}: "${field}" is declared/supplied/fixed but ${binding.input} does not require it — ` +
          `drift in the other direction (a phantom the handler will never read as required)`,
      );
    }

    // An OPTIONAL declared arg must still exist on the input, as optional.
    for (const field of declared.optional) {
      if (!input.optional.has(field)) {
        violations.push(
          `${toolName}: optional declared arg "${field}" is not an optional field of ${binding.input}`,
        );
      }
    }
  }

  assert.ok(
    checked >= MIN_HANDLERS,
    `the equation ran over only ${checked} bound tools (>= ${MIN_HANDLERS} handlers exist at C-044 time) — vacuous coverage`,
  );
  assert.deepEqual(
    violations,
    [],
    "tool/handler surface mismatches (C-044):\n" + violations.join("\n"),
  );
});

// ---------------------------------------------------------------------------
// [C-044-ruling] pin the ruling itself: kind is fixed, never a tool arg.
// ---------------------------------------------------------------------------

test('[C-044-binding] conductor_decide fixes kind to "derived" — a tool-recorded decision was not asked of a human (§2.7)', async () => {
  const binding = TOOL_BINDINGS["conductor_decide"] as ToolBinding | null;
  assert.ok(binding !== null, "conductor_decide must be bound");
  assert.deepEqual(
    binding.fixed,
    { kind: "derived" },
    'the composition root fixes conductor_decide\'s kind to "derived" (C-044 ruling); ' +
      "the path that carries a human's answer is conductor_answer",
  );

  const hooks = await invokePlugin();
  const declared = declaredArgsOf(hooks.tool as Record<string, unknown>, "conductor_decide");
  assert.equal(
    declared.required.has("kind") || declared.optional.has("kind"),
    false,
    "kind must never be a declared tool arg on conductor_decide (C-044 ruling)",
  );
});

// ---------------------------------------------------------------------------
// [C-047] the SHAPE half. Names alone are not enough.
//
// C-044's equation checks that every required handler field is SUPPLIED by
// something. It cannot see whether it is supplied with the right TYPE — and
// that gap already contained a live defect. Both conductor_decide and
// conductor_queue_amend declared `options: S.array(S.string())` while their
// handlers take Array<{name, score?}>. Core requireTwoOptions rejects a
// `kind:"derived"` record whose options lack scores, every tool-recorded
// decision IS derived, and a string cannot carry a ladder-5 score — so neither
// tool could ever have completed a call. Both were name-perfect throughout.
//
// The comparison is deliberately COARSE (string / number / boolean / object /
// array-of-string / array-of-object). A precise structural comparison between
// zod and erased TypeScript is not available at runtime, and a guard that
// pretends to more precision than it has is worse than one that states its
// resolution. What it DOES catch is the whole family this defect belongs to:
// a scalar declared where a structure is required, or the reverse.
// ---------------------------------------------------------------------------

// Fields the composition root supplies or fixes are not model input and have no
// declared arg to compare against.
type CoarseKind = "string" | "number" | "boolean" | "object" | "array<string>" | "array<object>";

function zodCoarseKind(schema: unknown): CoarseKind | null {
  const def = (schema as { def?: Record<string, unknown> } | null)?.def;
  if (def === undefined || def === null) return null;
  const kind = def["type"];
  if (kind === "optional" || kind === "nullable" || kind === "default") {
    return zodCoarseKind(def["innerType"]);
  }
  if (kind === "string") return "string";
  if (kind === "number") return "number";
  if (kind === "boolean") return "boolean";
  if (kind === "object") return "object";
  if (kind === "array") {
    const element = zodCoarseKind(def["element"]);
    if (element === "string") return "array<string>";
    if (element === "object") return "array<object>";
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolving a NAMED handler type through the module that DEFINES it.
//
// The classifier below used to return null for any field spelled with a type
// alias, and "cannot place" was the hole the queue_amend twin of C-047 sat in:
// QueueAmendInput.ops is `QueueAmendOp[]`, the plugin declares
// `ops: S.array(S.string())`, and because the guard could not classify the alias
// it filed the pair as UNDETERMINED and waved it through on a hand-written
// allow-list. An excuse list is not a comparison.
//
// The alias is read from conductor/core/ — the module that owns the union —
// while the declared side is read from the live plugin. Neither side is derived
// from the other (C-077).
// ---------------------------------------------------------------------------

const coreDir = path.resolve(testsDir, "../core");
const pluginSourcePath = path.resolve(testsDir, "../plugin/index.ts");

// The right-hand side of `export type <name> = ...`, terminated by the first
// `;` at brace/paren depth 0. Returns null when core/ defines no such alias.
function aliasBodyOf(aliasName: string): string | null {
  for (const entry of readdirSync(coreDir).filter((f) => f.endsWith(".ts")).sort()) {
    const source = readFileSync(path.join(coreDir, entry), "utf8");
    const marker = new RegExp(`^export type ${aliasName}\\s*=`, "m");
    const hit = marker.exec(source);
    if (hit === null) continue;
    const rest = source.slice(hit.index + (hit[0] as string).length);
    let depth = 0;
    for (let i = 0; i < rest.length; i += 1) {
      const ch = rest[i];
      if (ch === "{" || ch === "(") depth += 1;
      else if (ch === "}" || ch === ")") depth -= 1;
      else if (ch === ";" && depth === 0) return rest.slice(0, i);
    }
    return null;
  }
  return null;
}

// A union whose every member is an object literal is coarsely an OBJECT; a union
// whose every member is a string (or a string literal) is coarsely a STRING.
// A mixed union stays unplaceable and is reported, never excused.
function aliasCoarseKind(aliasName: string): CoarseKind | null {
  const body = aliasBodyOf(aliasName);
  if (body === null) return null;
  const stripped = body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const members: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of stripped) {
    if (ch === "{" || ch === "(") depth += 1;
    if (ch === "}" || ch === ")") depth -= 1;
    if (ch === "|" && depth === 0) {
      members.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  members.push(current);
  const parts = members.map((m) => m.trim()).filter((m) => m.length > 0);
  if (parts.length === 0) return null;
  if (parts.every((p) => p.startsWith("{"))) return "object";
  if (parts.every((p) => /^(string|"[^"]*"|'[^']*')$/.test(p))) return "string";
  return null;
}

function tsCoarseKind(typeText: string): CoarseKind | null {
  // Strip a trailing separator and any "| null" / "| undefined" tail.
  const text = typeText.replace(/;.*$/, "").replace(/\s*\|\s*(null|undefined)\b/g, "").trim();
  if (/^string$/.test(text)) return "string";
  if (/^number$/.test(text)) return "number";
  if (/^boolean$/.test(text)) return "boolean";
  if (/^string\[\]$/.test(text) || /^Array<string>$/.test(text)) return "array<string>";
  if (/^Array<\s*\{/.test(text) || /^\{.*\}\[\]$/.test(text)) return "array<object>";
  if (/^\{/.test(text)) return "object";
  // `<Alias>[]` / `Array<Alias>` — resolve the element through core/.
  const named = /^(\w+)\[\]$/.exec(text) ?? /^Array<\s*(\w+)\s*>$/.exec(text);
  if (named !== null) {
    const element = aliasCoarseKind(named[1] as string);
    if (element === "string") return "array<string>";
    if (element === "object") return "array<object>";
    return null;
  }
  if (/^\w+$/.test(text)) return aliasCoarseKind(text);
  return null;
}

// A declared shape may legitimately differ from the handler's field when a PURE,
// separately tested widener stands between the two — but ONLY while that widener
// is actually CALLED on the way through. A parser nobody calls is not a bridge,
// it is a cast, and a cast from `string` to a structure is the C-047 defect
// wearing a justification. Each entry names the parser that must be reachable in
// the composition root or the handler for the mismatch to be excused.
const CLAIMED_BRIDGES: Record<string, { parser: string; module: string }> = {
  "conductor_queue_amend.ops": { parser: "parseAmendOps", module: "core/queue-amend.ts" },
};

// Is the named widener CALLED anywhere on the path from the declared arg to the
// handler — the composition root (plugin/index.ts) or the handler file itself?
function bridgeIsReal(parser: string): boolean {
  const call = new RegExp(`\\b${parser}\\s*\\(`);
  for (const file of [pluginSourcePath, toolsSourcePath]) {
    if (call.test(readFileSync(file, "utf8"))) return true;
  }
  return false;
}

test("[C-047-shape] every declared tool arg has the same COARSE shape as the handler field it feeds, so a scalar can never be declared where the handler needs a structure", async () => {
  const hooks = await invokePlugin();
  const toolMap = hooks.tool as Record<string, unknown>;
  const surface = parseAdapterSurface();

  const mismatches: string[] = [];
  let compared = 0;
  const undetermined: string[] = [];

  for (const [toolName, binding] of Object.entries(TOOL_BINDINGS)) {
    if (binding === null) continue;
    const fields = surface.fieldsOf(binding.input);
    const args = (toolMap[toolName] as { args?: Record<string, unknown> }).args ?? {};

    for (const [argName, schema] of Object.entries(args)) {
      const typeText = fields.types.get(argName);
      if (typeText === undefined) continue; // the equation test owns missing names
      const declared = zodCoarseKind(schema);
      const wanted = tsCoarseKind(typeText);
      if (declared === null || wanted === null) {
        undetermined.push(`${toolName}.${argName} (declared=${declared ?? "?"}, handler="${typeText}")`);
        continue;
      }
      compared += 1;
      if (declared === wanted) continue;
      const key = `${toolName}.${argName}`;
      const bridge = CLAIMED_BRIDGES[key];
      if (bridge !== undefined && bridgeIsReal(bridge.parser)) continue;
      mismatches.push(
        `${key}: the tool declares ${declared} but ${binding.input}.${argName} ` +
          `is ${wanted} ("${typeText}") — the composition root cannot bridge that, and ` +
          `fabricating the missing structure is exactly what it may not do` +
          (bridge === undefined
            ? ""
            : `. A bridge through ${bridge.module} ${bridge.parser} is CLAIMED for this arg, but ` +
              `${bridge.parser} is called nowhere in plugin/index.ts or adapter/tools.ts — the ` +
              `binding casts the declared value straight into the handler's field instead, so a ` +
              `caller that follows the DECLARED schema cannot make this tool succeed. Either ` +
              `declare the structure the handler requires, or actually call ${bridge.parser} on ` +
              `the way in`),
      );
    }
  }

  // A guard that compared nothing would pass silently — the C-045 failure mode.
  assert.ok(
    compared >= 13,
    `only ${compared} arg shapes were comparable (expected at least 13 across the bound tools); ` +
      `an extraction this thin means the parse or the zod introspection broke, and a guard ` +
      `that inspects nothing must be RED, never a vacuous green. Undetermined: ${undetermined.join("; ")}`,
  );

  // NOTHING is excused for being unclassifiable any more. The list used to carry
  // one standing entry — conductor_queue_amend.ops — on the grounds that the
  // `string[]` declaration was widened into the closed QueueAmendOp union by
  // core/queue-amend.ts parseAmendOps. The alias is now resolved through the
  // module that defines it, so the pair is COMPARABLE, and whether the claimed
  // bridge exists is decided by looking for the call rather than by trusting the
  // comment: an arg the classifier cannot place is a hole a scalar-for-structure
  // defect hides in, which is exactly what this row exists to close.
  assert.deepEqual(
    undetermined,
    [],
    "the coarse classifier could not place an argument: teach it the shape (resolving the alias " +
      "through the module that defines it) — an UNDETERMINED verdict may not stand in for a check",
  );

  assert.deepEqual(mismatches, [], mismatches.join("\n"));
});
