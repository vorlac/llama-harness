// conductor/core/freshness.ts — the §2.6 freshness rule and the §2.6.1
// failure-class resolution table (Task 1.3; plan lines 2100-2128, 817-850,
// 1496-1506). Core module: pure — no I/O and no clock; every mtime, HEAD, and
// timestamp arrives as an input, and per-runner extraction rules arrive as
// DATA (Task 6.1 owns the rule tables) so this stays a truth table and not a
// regex someone tweaks in an adapter.

import { globMatch } from "./shell-parse.ts";
import type { FailureClass } from "./types.ts";

// ---------------------------------------------------------------------------
// verifyFreshFor — the §2.6 freshness rule
// ---------------------------------------------------------------------------

/** The freshness-relevant fields of a §2.6 verify record. */
export interface FreshnessRecord {
  /** START stamp, taken after quarantine, before the first scope ran. */
  startedMs: number;
  /** The HEAD the verify actually judged. */
  head: string;
}

/** Everything the rule consumes, gathered by the (impure) caller. */
export interface FreshnessInputs {
  /** Worktree mtimes of the staged behavioral files that exist. */
  stagedMtimes: number[];
  /** Index mtime; consulted only when a staged entry is a deletion/rename. */
  indexMtimeMs: number;
  hasStagedDeletion: boolean;
  currentHead: string;
  /** §3.9 no-git mode: there is no HEAD, so condition 2 is skipped. */
  noGit: boolean;
}

export interface FreshnessVerdict {
  fresh: boolean;
  /** Empty when fresh; a populated reason on every stale verdict. */
  why: string;
}

/**
 * A verify record is fresh for a commit iff BOTH (§2.6, plan lines 838-850):
 *  1. startedMs >= max(worktree mtimes of the staged behavioral files that
 *     exist, index mtime when any staged behavioral entry is a
 *     deletion/rename) — equality counts fresh: an edit stamped AT the start
 *     instant was visible to the verify;
 *  2. record.head === currentHead — a green produced on one branch is not a
 *     green on another (`git switch` between validate and publish changes the
 *     tree without necessarily touching any staged file's mtime). Skipped
 *     entirely in no-git mode (§3.9).
 */
export function verifyFreshFor(
  record: FreshnessRecord,
  inputs: FreshnessInputs,
): FreshnessVerdict {
  const reasons: string[] = [];

  // Condition 1. With no surviving staged file mtimes and no staged deletion
  // there is no reference term, and the condition holds vacuously.
  const refs: number[] = [...inputs.stagedMtimes];
  if (inputs.hasStagedDeletion) refs.push(inputs.indexMtimeMs);
  if (refs.length > 0) {
    const maxRef = Math.max(...refs);
    if (record.startedMs < maxRef) {
      reasons.push(
        `an edit landed after the verify started (startedMs ${record.startedMs} < staged reference mtime ${maxRef}) and was never verified`,
      );
    }
  }

  // Condition 2 — skipped under noGit (§3.9): the freshness rule drops the
  // HEAD term because there is no repository to have a HEAD.
  if (!inputs.noGit && record.head !== inputs.currentHead) {
    reasons.push(
      `HEAD moved since the verify (record.head ${record.head} !== currentHead ${inputs.currentHead}); the record describes a different tree`,
    );
  }

  if (reasons.length > 0) {
    return { fresh: false, why: `stale: ${reasons.join("; ")}` };
  }
  return { fresh: true, why: "" };
}

// ---------------------------------------------------------------------------
// classifyFailure — the §2.6.1 closed vocabulary
// ---------------------------------------------------------------------------

/**
 * Per-runner extraction rules, as data (regex sources, never functions):
 *  - unresolvedPatterns: capture group 1 extracts the unresolved specifier;
 *  - assertionPatterns: recognize a genuine assertion failure;
 *  - dotsAsSeparators: python-style module dots are path separators for the
 *    fileScope membership check ("slugger.core" -> "slugger/core").
 */
export interface RunnerRules {
  runner: string;
  unresolvedPatterns: string[];
  assertionPatterns: string[];
  dotsAsSeparators?: boolean;
}

// Normalize an extracted specifier for the fileScope membership check.
// Relative specifiers resolve from the test file toward the tree, so their
// leading ./ and ../ segments carry no scope information — they are dropped
// before glob matching ("../src/slugify.ts" -> "src/slugify.ts"). Bare
// specifiers ("lodash", "requests") pass through unchanged and so land
// outside any source scope.
function normalizeSpecifier(raw: string, dotsAsSeparators: boolean): string {
  let spec = dotsAsSeparators ? raw.split(".").join("/") : raw;
  for (;;) {
    if (spec.startsWith("./")) {
      spec = spec.slice(2);
    } else if (spec.startsWith("../")) {
      spec = spec.slice(3);
    } else {
      break;
    }
  }
  return spec;
}

/**
 * Classify a failing run's output into §2.6.1's closed vocabulary:
 *  - "missing-subject": the run could not resolve a module/symbol AND every
 *    unresolved specifier resolves inside this item's declared fileScope —
 *    the subject this item is contracted to build does not exist yet, the
 *    only legal non-assertion red (greenfield TDD's first failure shape);
 *  - "assertion": no unresolved specifier, and a recognized assertion
 *    failure — the test ran and the behavior was wrong;
 *  - "error": anything else (syntax error in the test, an unresolved import
 *    pointing OUTSIDE the fileScope, collection/build failure elsewhere) —
 *    the conservative default: a test broken by unrelated breakage proves
 *    nothing.
 *
 * exitCode is part of the pinned Task 1.3 signature and is recorded by the
 * evidence writer; the class is decided by output shape alone, because
 * runners disagree about exit codes (pytest exits 2 for collection errors).
 */
export function classifyFailure(
  stderr: string,
  stdout: string,
  exitCode: number,
  itemFileScope: string[],
  runnerRules: RunnerRules,
): FailureClass {
  const text = `${stderr}\n${stdout}`;

  // Unresolved-specifier extraction runs first: output naming an unresolved
  // module is never a plain assertion run, whatever else it contains.
  const specifiers: string[] = [];
  for (const source of runnerRules.unresolvedPatterns) {
    for (const m of text.matchAll(new RegExp(source, "g"))) {
      const captured = m[1];
      if (typeof captured === "string" && captured.length > 0) {
        specifiers.push(captured);
      }
    }
  }
  if (specifiers.length > 0) {
    const dots = runnerRules.dotsAsSeparators === true;
    const allInScope = specifiers.every((raw) => {
      const spec = normalizeSpecifier(raw, dots);
      return itemFileScope.some((glob) => globMatch(glob, spec));
    });
    // Any unresolved specifier outside the fileScope contaminates the run:
    // the missing thing is not (only) the subject this item must build.
    return allInScope ? "missing-subject" : "error";
  }

  for (const source of runnerRules.assertionPatterns) {
    if (new RegExp(source).test(text)) return "assertion";
  }

  return "error";
}
