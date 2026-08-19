// conductor/core/receipt-floor.ts — GAP-012: the fixer-receipt floor. Core module
// (G3): pure — no I/O, no clock, no runtime globals.
//
// The defect this closes: a review fix dispatch that replied DONE and touched
// nothing advanced exactly as far as one that did the work. The next round's only
// check was another lens fan-out, which is GAP-011's trust again — so
// acknowledge-and-change-nothing was a complete, unpunished strategy for clearing
// a finding.
//
// The floor is deliberately the weakest honest one: the fix must have touched at
// least one file the routed finding NAMES. It says nothing about whether the fix
// is correct — that is the next round's job, and pretending a diff proves
// correctness would be the same theatre this file exists to remove.

import { globMatch } from "./shell-parse.ts";
import { pathLikeTokens } from "./planning.ts";

export interface FindingSubject {
  claim: string;
  evidence: string;
  suggestedFix: string;
}

export interface SubjectScopes {
  fileScope: readonly string[];
  testScope: readonly string[];
}

export interface FloorCheck {
  ok: boolean;
  reason: string;
}

// The two §3.3 fix recipients. The floor's fallback depends on which one was
// asked, because they own disjoint halves of the item's tree.
export type FixRoute = "implementer" | "testWriter";

function dedupe(entries: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.length > 0 && !out.includes(entry)) out.push(entry);
  }
  return out;
}

/**
 * The scope the routed fixer may actually write, as the fallback universe.
 *
 * The defect this closes: the fallback was fileScope ∪ testScope for BOTH routes,
 * so an implementation finding whose prose named no path was discharged by
 * touching the TEST file — the one edit an implementer is gated out of making, and
 * the one edit that makes the proof agree with the code instead of the other way
 * round. The floor's whole claim is "the fix landed where the finding lives", and
 * a union scope let it land in the other half of the item.
 *
 * So: a test-writer's fallback is the testScope, and an implementer's is the
 * fileScope MINUS anything the testScope covers — the same subtraction
 * core/gates-edit.ts applies to the implementer's write permission, so the floor
 * demands exactly what the gate would have allowed. A fileScope entirely covered
 * by the testScope (which §3.2 queue acceptance refuses) falls back to the whole
 * fileScope rather than to nothing: a floor of "nothing" is no floor.
 */
export function routeFallbackScope(route: FixRoute, scopes: SubjectScopes): string[] {
  if (route === "testWriter") return dedupe(scopes.testScope);
  const outside = scopes.fileScope.filter(
    (entry) => !scopes.testScope.some((test) => test === entry || globMatch(test, entry)),
  );
  const narrowed = dedupe(outside);
  return narrowed.length > 0 ? narrowed : dedupe(scopes.fileScope);
}

/**
 * The paths a finding NAMES: every file-shaped token in its claim, evidence and
 * suggested fix. A finding whose prose names no path falls back to the scope its
 * ROUTED fixer owns — the fix still has to land somewhere that fixer may write,
 * and a fallback of "nothing" would make the floor vacuous for exactly the vaguest
 * findings.
 */
export function findingSubjects(
  finding: FindingSubject,
  scopes: SubjectScopes,
  route: FixRoute,
): string[] {
  const tokens = pathLikeTokens(finding.claim + "\n" + finding.evidence + "\n" + finding.suggestedFix);
  if (tokens.length > 0) return tokens;
  return routeFallbackScope(route, scopes);
}

function touchesSubject(touchedPath: string, subject: string): boolean {
  if (touchedPath === subject) return true;
  if (globMatch(subject, touchedPath)) return true;
  // A finding may name a bare filename ("parse.ts") where the tree reports the
  // repo-relative path; the basename arm keeps that honest citation admissible.
  const base = subject.split("/").filter((segment) => segment.length > 0).pop();
  return base !== undefined && base === touchedPath.split("/").pop();
}

/**
 * Does a fix receipt's touch set intersect what the routed finding(s) name? The
 * reason is written to be handed BACK to the fixer verbatim: it names the
 * discrepancy (what the receipt touched vs what the findings claim), which is the
 * whole content of the re-dispatch.
 */
export function receiptFloor(touched: readonly string[], subjects: readonly string[]): FloorCheck {
  const named = subjects.length > 0 ? subjects.join(", ") : "(no path named)";
  if (touched.length === 0) {
    return {
      ok: false,
      reason:
        "the receipt reports the fix as done but the tree is unchanged: it touched no file at all, " +
        "and the finding(s) name " +
        named,
    };
  }
  for (const path of touched) {
    for (const subject of subjects) {
      if (touchesSubject(path, subject)) return { ok: true, reason: "" };
    }
  }
  return {
    ok: false,
    reason:
      "the receipt reports the fix as done but it touched no file the finding(s) name: the tree " +
      "changed " +
      touched.join(", ") +
      " while the finding(s) name " +
      named,
  };
}
