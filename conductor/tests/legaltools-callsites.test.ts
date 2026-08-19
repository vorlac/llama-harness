// conductor/tests/legaltools-callsites.test.ts — the guard C-048 SAID existed.
//
// C-048 recorded a ruling: `legalTools`' fifth parameter `publishEnabled` stays
// OPTIONAL (a required one is not assignable to the type the 9.5b suite pins),
// and the danger of an optional flag defaulting to `true` — a production call
// site silently inheriting "publish is available" — is removed instead by a
// CONSTRUCTION: every production call site passes it EXPLICITLY, and this file
// fails if one stops.
//
// This file did not exist. Neither did the wiring. All three production call
// sites passed four arguments, so every gate verdict in production was computed
// with publishEnabled defaulted to true — precisely the drift the ruling claimed
// to have closed. Found by the Phase 9 milestone gate, which demonstrated the
// consequence on a real non-repo workspace: with an item at REVIEWED under §3.9
// no-git, the gate OFFERS and RECOMMENDS conductor_publish (which the handler
// unconditionally refuses) and never offers conductor_report (which it accepts).
//
// The lesson is the one this build keeps re-learning in new costumes: a
// construction that is DESCRIBED but not BUILT is worse than an acknowledged gap,
// because the description is what future readers check against. The comment at
// gates-phase.ts cited this filename as evidence; the citation was the only thing
// that existed.
//
// So this guard reads the SOURCE rather than any behaviour: behavioural tests
// pass the flag by hand (tools-9.5b.test.ts does exactly that), which pins the
// parameter's semantics and says nothing about whether production ever sets it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Comments are BLANKED (not deleted) before scanning, so line numbers survive and
// prose that merely mentions the function — "forwards to legalTools (repoConfigured)"
// — is never mistaken for a call. The first version of this guard matched exactly
// that and reported two comments as under-argumented call sites: a scanner that
// inspects the wrong text is the same defect class it exists to catch. The blanker
// is shared with journal-vocab.test.ts and pinned by strip-comments.test.ts, whose
// canaries fail if either audit's view of a shipped file narrows again.
import { stripComments } from "./fixtures/strip-comments.ts";
import { productionTsUniverse, uncovered } from "./fixtures/scan-universe.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");

// The production tree: everything under conductor/ that ships, i.e. not the
// tests and not the dev-only tooling.
const PRODUCTION_DIRS = ["core", "adapter", "plugin"];

// At C-048 time there are exactly three production call sites. The floor is the
// anti-vacuity check (C-045): a scan that finds nothing must be RED, never a
// silent pass, because "no call sites" is indistinguishable from "the scan
// broke" without it.
const MIN_CALL_SITES = 3;

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts")) out.push(full);
    }
  };
  for (const dir of PRODUCTION_DIRS) walk(path.join(conductorDir, dir));
  return out;
}

// Extract the argument list of every `legalTools(...)` CALL — never its
// definition or a type annotation. Brace/paren depth is tracked so a nested call
// or an inline object literal does not split an argument.
interface CallSite {
  file: string;
  line: number;
  args: string[];
  text: string;
}

function legalToolsCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of productionFiles()) {
    const source = stripComments(readFileSync(file, "utf8"));
    const rel = path.relative(conductorDir, file);
    for (const match of source.matchAll(/\blegalTools\s*\(/g)) {
      const openIdx = match.index + match[0].length - 1;
      // The DEFINITION is `export function legalTools(` — not a call.
      const before = source.slice(Math.max(0, match.index - 40), match.index);
      if (/function\s+$/.test(before)) continue;

      let depth = 1;
      let i = openIdx + 1;
      const args: string[] = [];
      let current = "";
      while (depth > 0 && i < source.length) {
        const ch = source[i];
        if (ch === "(" || ch === "{" || ch === "[") depth += 1;
        else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
        if (depth === 0) break;
        if (ch === "," && depth === 1) {
          args.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
        i += 1;
      }
      if (current.trim().length > 0) args.push(current.trim());
      sites.push({
        file: rel,
        line: source.slice(0, match.index).split("\n").length,
        args,
        text: source.slice(match.index, i + 1).replace(/\s+/g, " "),
      });
    }
  }
  return sites;
}

test("[C-048-callsites] EVERY production call site of legalTools passes publishEnabled explicitly — the optional fifth parameter's default must be unreachable from shipped code, because a call site that inherits it silently claims publish is available in a run where it is not", () => {
  const sites = legalToolsCallSites();

  assert.ok(
    sites.length >= MIN_CALL_SITES,
    `found only ${sites.length} production legalTools call sites (>= ${MIN_CALL_SITES} exist at ` +
      `C-048 time) — the source scan is broken, and a broken scan must be RED rather than a ` +
      `vacuous green (C-045)`,
  );

  const underArged = sites.filter((site) => site.args.length < 5);
  assert.deepEqual(
    underArged.map((site) => `${site.file}:${site.line} passes ${site.args.length} args — ${site.text}`),
    [],
    "a production call site is relying on publishEnabled's default. The default is `true`, so under " +
      "§3.9 no-git that verdict offers and recommends conductor_publish (which the handler always " +
      "refuses) and never offers conductor_report (which it accepts). Pass the flag explicitly — " +
      "derive it from gitio.isRepo, the same predicate the handlers use.",
  );
});

test("[C-048-callsites] the fifth argument is DERIVED, never a bare `true` — a literal would re-introduce the same default under a different spelling", () => {
  const sites = legalToolsCallSites().filter((site) => site.args.length >= 5);
  assert.ok(sites.length > 0, "premise: there are five-argument call sites to inspect");

  const hardcoded = sites.filter((site) => /^(true|false)$/.test(site.args[4] as string));
  assert.deepEqual(
    hardcoded.map((site) => `${site.file}:${site.line} hardcodes publishEnabled=${site.args[4]}`),
    [],
    "publishEnabled must come from the workspace (gitio.isRepo) or be threaded from a caller that " +
      "derived it there. A literal satisfies the arity check while restoring exactly the bug it " +
      "was added to prevent — which is the failure mode this whole guard exists to catch.",
  );
});

// GAP-017 (inverted subject selection). PRODUCTION_DIRS is an ENUMERATION — this
// guard scans exactly the three directories it names. MACRO-016's class is the day
// a fourth shipped directory appears (or PRODUCTION_DIRS is narrowed) and the scan
// reports full coverage of a tree it no longer walks. The universe is defined by
// INVERSION instead — every tracked conductor .ts minus the two non-production
// trees (scan-universe.ts) — and this asserts the scanned file-set covers it. An
// uncovered tracked file is a RED, not a silent omission.
test("[C-048-callsites-covers-universe] the production file-set this guard scans covers every tracked shipped .ts (INVERSION over git ls-files) — a new production directory outside PRODUCTION_DIRS surfaces here as an uncovered file, never as a silent gap in a scan that still reports success", () => {
  const scanned = productionFiles();
  const universe = productionTsUniverse();
  assert.ok(universe.length >= 40, `the tracked production universe is only ${universe.length} files — git ls-files is not resolving`);

  const missed = uncovered(scanned, universe).map((f) => path.relative(conductorDir, f));
  assert.deepEqual(
    missed,
    [],
    "a tracked shipped .ts is not in this guard's scanned set. Its legalTools call sites (if any) go " +
      "unchecked. Widen PRODUCTION_DIRS to cover the new tree, or add it to PRODUCTION_EXEMPT_PREFIXES " +
      "in scan-universe.ts on purpose.",
  );
});

test("[C-048-callsites-coverage-discrimination] the coverage check proves it CAN fail: a scanned set with one universe file removed is reported uncovered — a coverage assertion that cannot go red is decorative (GAP-019)", () => {
  const universe = productionTsUniverse();
  assert.ok(universe.length > 1, "premise: the universe has files to drop");
  const holed = universe.slice(1); // drop the first tracked file from the scan
  const missed = uncovered(holed, universe);
  assert.deepEqual(missed, [universe[0]], "dropping a tracked file from the scan must be reported as uncovered");
});
