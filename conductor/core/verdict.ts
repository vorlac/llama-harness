// conductor/core/verdict.ts — §2.10 skeptic-verdict aggregation (Task 1.3;
// plan lines 2115-2116, 930-932). Core module: pure.
//
// GAP-036 / owner decision D11. The original rule counted `upheld:true` and read
// everything else as a refutation, which married skeptic.md's "uncertain ⇒
// refuted" default: a skeptic who could not evaluate the finding — a transport
// failure, a 32k model out of its depth, a panel seat that answered in one
// unaudited line — extinguished it. The build's own record is the evidence
// (C-082/P10 sealed a true finding under a unanimous wrong refutation; audited
// panel kill rates swung 12%→71% under one doctrine).
//
// So a refutation carries evidence symmetric with the finding's, and a verdict
// that refutes without it is an ABSTENTION. An abstention UPHOLDS:
// incapacity cannot convert into a verdict. Refutation is still cheap for a
// skeptic who did the work and still fatal to the finding.

import type { Verdict } from "./types.ts";

export type VerdictKind = "upheld" | "refuted" | "abstained";

function present(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * What one verdict actually says. A refutation counts as a refutation only when
 * it names all three: the discriminating input, what was run, and the reading
 * under which the finding fails. Anything less is an abstention.
 */
export function verdictKind(verdict: Verdict): VerdictKind {
  if (verdict.upheld) return "upheld";
  const evidence = verdict.refutationEvidence;
  if (evidence === undefined || evidence === null) return "abstained";
  if (!present(evidence.discriminatingInput) || !present(evidence.run) || !present(evidence.reading)) {
    return "abstained";
  }
  return "refuted";
}

/**
 * A finding survives skeptic review iff the seats that did NOT refute it reach
 * ⌈k/2⌉, where k is workflow.skepticsPerFinding (§2.1). A TIE UPHOLDS: at the
 * default k=2 the threshold is ⌈2/2⌉ = 1, so a finding two skeptics split on
 * survives — it is worth a fix round. At k=3 the threshold is 2, a strict
 * majority. An abstention counts with the upholds (D11).
 */
export function findingSurvives(verdicts: readonly Verdict[], k: number): boolean {
  let upholds = 0;
  for (const verdict of verdicts) {
    if (verdictKind(verdict) !== "refuted") upholds += 1;
  }
  return upholds >= Math.ceil(k / 2);
}
