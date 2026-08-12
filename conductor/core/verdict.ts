// conductor/core/verdict.ts — §2.10 skeptic-verdict aggregation (Task 1.3;
// plan lines 2115-2116, 930-932). Core module: pure.

import type { Verdict } from "./types.ts";

/**
 * A finding survives skeptic review iff its uphold count reaches ⌈k/2⌉,
 * where k is workflow.skepticsPerFinding (§2.1). A TIE UPHOLDS: at the
 * default k=2 the threshold is ⌈2/2⌉ = 1, so a finding two skeptics split
 * on survives — it is worth a fix round. At k=3 the threshold is 2, a
 * strict majority.
 */
export function findingSurvives(verdicts: readonly Verdict[], k: number): boolean {
  let upholds = 0;
  for (const verdict of verdicts) {
    if (verdict.upheld) upholds += 1;
  }
  return upholds >= Math.ceil(k / 2);
}
