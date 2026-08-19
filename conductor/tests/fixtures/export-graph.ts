// conductor/tests/fixtures/export-graph.ts — the pure analyzer behind the
// GAP-020 unreachable-exports audit (conductor/tests/unreachable-exports.test.ts).
//
// WHY THIS EXISTS. Correction cluster C — the single highest severity-per-entry
// family in the review record — is the built-but-wired-to-nothing shape: a symbol
// defined, exported, typechecked and (often) unit-tested, reachable from no
// production path. Its terminal instance is ISSUE-001, the dead §6.4 injection
// layer that shipped green because every test proved its own helper rather than
// the wire. routerHealthy, inject.ts's whole surface, and the ISSUE-038/-039
// state/evidence fields written-and-read-by-nothing are the same class.
//
// The audit walks the shipped tree (conductor/{core,adapter,plugin}) and reports
// every VALUE export (function/const/let/class/enum — the runtime symbols; a type
// is erased and cannot be "dead code") whose identifier is referenced NOWHERE in
// that tree outside its own declaration. Comments are BLANKED before counting
// (the strip-comments lens both source audits already read through), so a symbol
// named only in prose is not mistaken for a live reference.
//
// It is a PURE function over {rel, src} pairs so the discrimination witness
// (GAP-019) can feed it a synthetic known-bad set and assert it reports the dead
// export — a checker that cannot demonstrate a failure is decorative (ISSUE-128).

import { stripComments } from "./strip-comments.ts";

export interface SourceFile {
  // Repo-relative path, used only for the reported location.
  rel: string;
  // Verbatim file contents.
  src: string;
}

export interface DeadExport {
  rel: string;
  name: string;
}

// The runtime-value export forms. `type` and `interface` are deliberately absent:
// they are erased at compile time, so a type consumed only by a test is not dead
// runtime code — it is part of the module's checkable surface. The dead-CODE audit
// is about symbols that occupy the binary and reach no caller.
const VALUE_EXPORT =
  /^export\s+(?:async\s+)?(?:function|const|let|class|enum|abstract\s+class)\s+([A-Za-z0-9_]+)/gm;

// The default export a composition root ships (opencode loads it by the module's
// default binding, not by name), captured so the audit can see it exists.
const DEFAULT_EXPORT = /^export\s+default\s+([A-Za-z0-9_]+)/m;

// Every value export declared across the given files, with the file it lives in.
export function collectValueExports(files: readonly SourceFile[]): DeadExport[] {
  const out: DeadExport[] = [];
  for (const file of files) {
    const code = stripComments(file.src);
    for (const match of code.matchAll(VALUE_EXPORT)) {
      out.push({ rel: file.rel, name: match[1] as string });
    }
    const def = code.match(DEFAULT_EXPORT);
    if (def) out.push({ rel: file.rel, name: def[1] as string });
  }
  return out;
}

// Count word-boundary occurrences of `name` across the comment-blanked bodies of
// every file. A live export is referenced at least twice: once at its declaration
// and once at a call/import/re-export site. Referenced exactly once (its own
// declaration) is the dead-export signature.
function referenceCount(name: string, blanked: readonly string[]): number {
  const re = new RegExp("\\b" + name + "\\b", "g");
  let total = 0;
  for (const body of blanked) {
    const found = body.match(re);
    if (found) total += found.length;
  }
  return total;
}

// The value exports that are referenced nowhere in the file set outside their own
// declaration — the unreachable set. Names are de-duplicated so a symbol exported
// under a name that also appears (live) elsewhere is not reported.
export function unreachedValueExports(files: readonly SourceFile[]): DeadExport[] {
  const blanked = files.map((f) => stripComments(f.src));
  const exports = collectValueExports(files);
  const dead: DeadExport[] = [];
  for (const exp of exports) {
    if (referenceCount(exp.name, blanked) <= 1) dead.push(exp);
  }
  return dead;
}
