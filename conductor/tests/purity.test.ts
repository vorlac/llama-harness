// conductor/tests/purity.test.ts — Task 1.4: the G3 purity guard and the G14
// dual-runtime guard, mechanized. A guard test: trivially green today, bites
// the moment core grows an I/O import or an adapter reaches for a
// single-runtime API.
//
// Assertion map (docs/build/specs/task-1.4.assertions.json):
//   1.4-core-imports   -> "purity guard: core imports are relative .ts modules resolving inside conductor/core (1.4-core-imports)"
//   1.4-core-forbidden -> "purity guard: core source is free of forbidden runtime tokens (1.4-core-forbidden)"
//   1.4-adapter-guard  -> "dual-runtime guard: adapter/plugin source is free of single-runtime APIs and shell tags (1.4-adapter-guard)"
//   1.4-subprocess     -> "dual-runtime guard: adapter/plugin subprocess use goes through the sanctioned child-process module (1.4-subprocess)"
//
// Self-trigger note: this file lives in conductor/tests/, which is not a
// scanned tree. Defensively, every token the guard scans FOR is assembled by
// string concatenation, and match extraction uses matchAll (never a
// call-shaped method token), so this guard can never flag its own source even
// if the scan globs ever widen. The scan is deliberately strict: comments are
// NOT stripped — a commented-out forbidden call is still a smell.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorRoot = path.resolve(testsDir, "..");
const coreDir = path.join(conductorRoot, "core");
const adapterDir = path.join(conductorRoot, "adapter");
const pluginDir = path.join(conductorRoot, "plugin");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively list absolute paths of every *.ts file under dirAbs, sorted for
 * determinism. A missing or empty directory yields [] — callers still run
 * their assertions over the (empty) result, so the guard covers those trees
 * from the moment their first .ts file appears.
 */
function listTsFiles(dirAbs: string): string[] {
  const out: string[] = [];
  if (!existsSync(dirAbs)) return out;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(p);
      }
    }
  };
  walk(dirAbs);
  return out.sort();
}

interface FoundSpecifier {
  spec: string;
  line: number; // 1-based
}

// Static `... from "x"`, dynamic `import("x")`, and side-effect `import "x"`.
// Line-based on purpose: the specifier-bearing line of a multi-line import
// clause still matches the first pattern.
const specifierPatterns: RegExp[] = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']/g,
  /^\s*import\s*["']([^"']+)["']/g,
];

/** Extract every import/export specifier in source, with its 1-based line. */
function importSpecifiers(source: string): FoundSpecifier[] {
  const found: FoundSpecifier[] = [];
  const lines = source.split("\n");
  for (const [idx, lineText] of lines.entries()) {
    for (const pattern of specifierPatterns) {
      for (const m of lineText.matchAll(pattern)) {
        const spec = m[1];
        if (typeof spec === "string") {
          found.push({ spec, line: idx + 1 });
        }
      }
    }
  }
  return found;
}

interface TokenRule {
  label: string;
  re: RegExp;
}

// G3: tokens that must never appear anywhere under conductor/core/. Core is
// pure `(parsedInput, stateSnapshot) -> decision`: no filesystem, no
// subprocesses, no runtime globals, no network, no environment, no wall clock
// (core takes nowMs as an input). Patterns are concatenation-assembled — see
// the self-trigger note in the file header.
const coreForbidden: TokenRule[] = [
  { label: "node" + ":fs", re: new RegExp("node" + ":fs\\b") },
  { label: "node" + ":child_" + "process", re: new RegExp("node" + ":child_" + "process\\b") },
  { label: "B" + "un", re: new RegExp("\\bB" + "un\\b") },
  { label: "fet" + "ch(", re: new RegExp("\\bfet" + "ch\\s*\\(") },
  { label: "process" + ".env", re: new RegExp("\\bprocess\\s*\\." + "env\\b") },
  { label: "Date" + ".now", re: new RegExp("\\bDate\\s*\\." + "now\\b") },
];

const backtick = "`";

// G14: adapters/plugin run under BOTH the opencode runtime and Node
// type-stripping, so they may use only Node-compatible built-ins. The
// word-boundary rule below also subsumes the spec's explicit `.spawn` form of
// the single-runtime global, and the dollar-plus-backtick rule catches the
// shell tag handed to the plugin — the one API that silently works in
// production and cannot run in any test.
const dualForbidden: TokenRule[] = [
  { label: "B" + "un", re: new RegExp("\\bB" + "un\\b") },
  { label: "$" + backtick + " (shell tag)", re: new RegExp("\\$" + backtick) },
];

// The single-runtime module namespace, forbidden as an import target in
// adapters/plugin ("...:ffi" etc., and the bare module of the same name).
const bunBareSpecifier = "b" + "un";
const bunSpecifierPrefix = "b" + "un:";

// The one sanctioned subprocess module (G14: execFile with shell:false). The
// core scan above forbids it inside core; the adapter scan permits it — and
// nothing here ever flags it in adapter/plugin files.
const sanctionedSubprocessModule = "node" + ":child_" + "process";

// Subprocess-shaped call tokens: if a file contains any of these, the file
// must import the sanctioned module. Assembled so the token never appears
// call-shaped in this guard's own source.
const subprocessCallRe = new RegExp(
  "\\b(?:sp" + "awn|sp" + "awnSync|ex" + "ec|ex" + "ecSync|ex" + "ecFile|ex" + "ecFileSync)\\s*\\("
);

// ---------------------------------------------------------------------------
// 1.4-core-imports
// ---------------------------------------------------------------------------

test("purity guard: core imports are relative .ts modules resolving inside conductor/core (1.4-core-imports)", () => {
  const files = listTsFiles(coreDir);
  assert.ok(
    files.length >= 1,
    "expected at least one .ts file under conductor/core/ — if this fails the scanner is aimed at the wrong directory"
  );
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(conductorRoot, file);
    const source = readFileSync(file, "utf8");
    for (const { spec, line } of importSpecifiers(source)) {
      const where = rel + ":" + String(line);
      if (!(spec.startsWith("./") || spec.startsWith("../"))) {
        violations.push(
          where + ": import \"" + spec + "\" is not a relative ./ or ../ specifier — core imports ONLY core siblings (G3)"
        );
        continue;
      }
      if (!spec.endsWith(".ts")) {
        violations.push(
          where + ": import \"" + spec + "\" does not end in .ts — imports between our files use explicit .ts extensions (G2)"
        );
      }
      const resolved = path.resolve(path.dirname(file), spec);
      if (!(resolved === coreDir || resolved.startsWith(coreDir + path.sep))) {
        violations.push(
          where + ": import \"" + spec + "\" resolves outside conductor/core/ (to " +
            path.relative(conductorRoot, resolved) + ") — core imports ONLY core siblings (G3)"
        );
      }
    }
  }
  assert.deepEqual(violations, [], "core import discipline violations:\n" + violations.join("\n"));
});

// ---------------------------------------------------------------------------
// 1.4-core-forbidden
// ---------------------------------------------------------------------------

test("purity guard: core source is free of forbidden runtime tokens (1.4-core-forbidden)", () => {
  const files = listTsFiles(coreDir);
  assert.ok(
    files.length >= 1,
    "expected at least one .ts file under conductor/core/ — if this fails the scanner is aimed at the wrong directory"
  );
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(conductorRoot, file);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [idx, lineText] of lines.entries()) {
      for (const rule of coreForbidden) {
        if (rule.re.test(lineText)) {
          violations.push(
            rel + ":" + String(idx + 1) + ": forbidden token " + rule.label +
              " — core is pure (G3): no I/O modules, no runtime globals, no network, no wall clock (nowMs is an input)"
          );
        }
      }
    }
  }
  assert.deepEqual(violations, [], "core purity violations:\n" + violations.join("\n"));
});

// ---------------------------------------------------------------------------
// 1.4-adapter-guard
// ---------------------------------------------------------------------------

test("dual-runtime guard: adapter/plugin source is free of single-runtime APIs and shell tags (1.4-adapter-guard)", () => {
  const files = [...listTsFiles(adapterDir), ...listTsFiles(pluginDir)];
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(conductorRoot, file);
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const [idx, lineText] of lines.entries()) {
      for (const rule of dualForbidden) {
        if (rule.re.test(lineText)) {
          violations.push(
            rel + ":" + String(idx + 1) + ": forbidden reference " + rule.label +
              " — adapters must run under BOTH runtimes (G14)"
          );
        }
      }
    }
    for (const { spec, line } of importSpecifiers(source)) {
      if (spec === bunBareSpecifier || spec.startsWith(bunSpecifierPrefix)) {
        violations.push(
          rel + ":" + String(line) + ": import \"" + spec +
            "\" targets the single-runtime module namespace — adapters must run under BOTH runtimes (G14)"
        );
      }
    }
  }
  assert.deepEqual(violations, [], "dual-runtime violations:\n" + violations.join("\n"));
});

// ---------------------------------------------------------------------------
// 1.4-subprocess
// ---------------------------------------------------------------------------

test("dual-runtime guard: adapter/plugin subprocess use goes through the sanctioned child-process module (1.4-subprocess)", () => {
  const files = [...listTsFiles(adapterDir), ...listTsFiles(pluginDir)];
  const violations: string[] = [];
  for (const file of files) {
    const rel = path.relative(conductorRoot, file);
    const source = readFileSync(file, "utf8");
    const hasSanctioned = importSpecifiers(source).some(
      (s) => s.spec === sanctionedSubprocessModule || s.spec.startsWith(sanctionedSubprocessModule + "/")
    );
    const lines = source.split("\n");
    for (const [idx, lineText] of lines.entries()) {
      if (subprocessCallRe.test(lineText) && !hasSanctioned) {
        violations.push(
          rel + ":" + String(idx + 1) + ": subprocess-shaped call without an import of " +
            sanctionedSubprocessModule + " — every subprocess goes through execFile from " +
            sanctionedSubprocessModule + " with shell:false (G14)"
        );
      }
    }
  }
  assert.deepEqual(violations, [], "subprocess discipline violations:\n" + violations.join("\n"));
});
