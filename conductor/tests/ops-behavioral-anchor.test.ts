// conductor/tests/ops-behavioral-anchor.test.ts — MACRO-021, the anchor that can
// see behavioral drift in the operator docs.
//
// conductor/tests/ops-docs.test.ts binds the operator docs' NOUNS to code and
// their behaviors to the PLAN. That is exactly the drift it cannot catch: the
// review found ten verified falsehoods in OPERATIONS.md / HONEST-LIMITS.md, every
// one a CROSS-MODULE BEHAVIORAL claim — a sentence about what some channel does at
// runtime — and ops-docs.test.ts checks none of them against the running code. One
// of its rows, [15.1-banner-entry-is-first], actively REQUIRES the doc to keep
// teaching a signal (the §3.8 session banner) that nothing in the shipped tree
// emits, so the anchor pins the falsehood in place.
//
// The mechanism this file adds: a behavioral doc claim is HONEST only if it is
// BOUND (a code fact this test evaluates makes it true) or MARKED (the doc hedges
// it, e.g. "(§3.8 — not yet wired)"). A claim that is neither — asserted flat while
// the code contradicts it — is the MACRO-021 class and must be on
// KNOWN_DISHONEST_CLAIMS, which is the debt REPORTED to the orchestrator (the docs
// are under docs*/ and off-limits to this layer, so the sentence is corrected there,
// not here). [self-cleaning] fails the day a registered claim becomes honest, so a
// fix cannot leave the register lying.
//
// SCOPE. The exemplar bound here is the headline falsehood: the "no banner, no
// conductor" first rule. It is fully code-decidable — the doc teaches diagnosing a
// dead plugin by the ABSENCE of a §3.8 banner, and grep proves NO production module
// emits a banner, so every HEALTHY session the operator inspects has no banner and
// the rule brands it broken. The other nine falsehoods are REPORTED for the
// orchestrator with their HEAD-verification status; each wants the same shape (a
// journal-driven or grep-driven binding, or an explicit marker).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");
const OPS = path.join(conductorDir, "docs", "OPERATIONS.md");
const PRODUCTION_DIRS = ["core", "adapter", "plugin"];

function productionSource(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      parts.push(readFileSync(full, "utf8"));
    }
  };
  for (const dir of PRODUCTION_DIRS) walk(path.join(conductorDir, dir));
  return parts.join("\n");
}

// The doc teaches the operator to diagnose a dead plugin by the ABSENCE of a §3.8
// session banner ("no banner, no conductor").
function docTeachesBannerDiagnosis(doc: string): boolean {
  return /no banner,\s*no conductor/i.test(doc) && /session has no banner/i.test(doc);
}

// BOUND: some production module actually emits a §3.8 banner, so a real gated
// session would show one and its absence would mean something. A comment does not
// count — the same reason a commented reference does not rescue a dead export.
function productionEmitsBanner(src: string): boolean {
  const codeOnly = src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  return /\bbanner\b/i.test(codeOnly);
}

// MARKED: the doc hedges the banner claim as not-yet-real anywhere in the banner
// discussion — the near-zero-cost honesty the review named.
function bannerClaimMarked(doc: string): boolean {
  return /banner[^.]*\((?:[^)]*not\s+yet[^)]*|[^)]*unwired[^)]*|[^)]*not\s+wired[^)]*)\)/i.test(doc);
}

// The registered dishonest claims: asserted flat in the doc while the code
// contradicts them and no marker hedges them. Each is a sentence the orchestrator
// must correct in the (off-limits) doc — either wire the mechanism, or add the
// "(not yet wired)" marker. `banner` was the exemplar; OPERATIONS.md now hedges it as
// not-yet-wired and elevates the liveness beacon as the working signal, so the claim
// is honest by MARKER and has been discharged from this register.
const KNOWN_DISHONEST_CLAIMS: ReadonlySet<string> = new Set([]);

function claimHonesty(): { bound: boolean; marked: boolean; teaches: boolean } {
  const doc = readFileSync(OPS, "utf8");
  const src = productionSource();
  return {
    teaches: docTeachesBannerDiagnosis(doc),
    bound: productionEmitsBanner(src),
    marked: bannerClaimMarked(doc),
  };
}

test("[macro021-banner-claim-is-dishonest-and-registered] OPERATIONS.md still teaches the §3.8 banner diagnosis and no production module emits a banner, but the doc now hedges the claim as not-yet-wired — so it is honest by MARKER and must be OFF KNOWN_DISHONEST_CLAIMS", () => {
  const h = claimHonesty();
  assert.equal(h.teaches, true, "the banner diagnosis must still be the doc's teaching for this anchor to be measuring the real claim");

  // The claim is not BOUND by code — nothing emits a §3.8 banner at HEAD — so its
  // honesty rests entirely on the doc's not-yet-wired MARKER.
  assert.equal(h.bound, false, "no production module emits a §3.8 banner at HEAD; if one now does, the claim is bound by code instead");
  assert.equal(h.marked, true, "OPERATIONS.md must hedge the banner claim as not-yet-wired — the marker is what makes the taught-but-unemitted claim honest");

  const honest = h.bound || h.marked;
  assert.ok(honest, "a taught banner claim is honest only when bound by code or marked in the doc");
  assert.equal(
    KNOWN_DISHONEST_CLAIMS.has("banner"),
    false,
    "the banner claim is discharged (marked not-yet-wired) and must not linger on KNOWN_DISHONEST_CLAIMS",
  );
});

test("[macro021-register-self-cleaning] a registered dishonest claim that has since become honest (bound by code or marked in the doc) must be removed from KNOWN_DISHONEST_CLAIMS — the register cannot outlive the falsehood it names", () => {
  const h = claimHonesty();
  const stillDishonest = h.teaches && !h.bound && !h.marked;
  if (KNOWN_DISHONEST_CLAIMS.has("banner")) {
    assert.ok(
      stillDishonest,
      "the banner claim is registered as dishonest but is no longer so (a banner is now emitted, or the doc now hedges it, or the doc " +
        "no longer teaches the diagnosis) — remove `banner` from KNOWN_DISHONEST_CLAIMS; the debt is discharged.",
    );
  }
});

test("[macro021-mechanism-can-see-a-false-behavioral-claim] the anchor is not decorative: a claim taught with no emitting code and no marker reads DISHONEST, and the same claim reads HONEST once code emits the signal or the doc hedges it (ISSUE-128)", () => {
  const teaches = (doc: string): boolean => docTeachesBannerDiagnosis(doc);
  const emits = (src: string): boolean => productionEmitsBanner(src);
  const marked = (doc: string): boolean => bannerClaimMarked(doc);

  const teachingDoc = "First rule: no banner, no conductor. ... the session has no banner ...";
  const silentCode = "export function loadPlugin() { return {}; }\n";
  // DISHONEST: taught, nothing emits, no marker.
  assert.equal(teaches(teachingDoc) && !emits(silentCode) && !marked(teachingDoc), true, "a taught-but-unemitted, unmarked claim must read dishonest");

  // HONEST via BINDING: the same claim once production really emits a banner.
  const emittingCode = "export function loadPlugin() { emit(banner('conductor active')); }\n";
  assert.equal(emits(emittingCode), true, "an emitted banner in real code must bind the claim");

  // A banner named only in a comment does NOT bind it.
  const commentedCode = "// this used to emit a banner\nexport const x = 1;\n";
  assert.equal(emits(commentedCode), false, "a commented reference must not rescue the claim");

  // HONEST via MARKER: the same claim once the doc hedges it.
  const markedDoc = "First rule: no banner, no conductor (§3.8 — not yet wired). ... the session has no banner ...";
  assert.equal(marked(markedDoc), true, "a not-yet marker on the banner claim must read as honest");
});
