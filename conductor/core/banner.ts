// conductor/core/banner.ts — the §3.8 session banner text.
//
// "No beacon, no conductor" is the ops guide's first rule, and it works: the
// beacon at .conductor/state/alive.json distinguishes a gated session from an
// ungated one. What it does not do is tell the operator inside the session they
// are already in. A plugin that fails to load is logged once on the serve log and
// the session comes up looking entirely normal, with every gate absent — so
// "looks normal" is precisely what the failure looks like, and the check that
// catches it requires looking somewhere else.
//
// This module composes the line that answers the question in place. The DELIVERY
// is the hard part and it is not solved here: Task 20.5 measured four candidate
// seams against the pinned binary and only one puts plugin-authored text in front
// of an operator — a tool.execute.after output mutation, which fires only when a
// tool runs. The banner is therefore conditional on the session making at least
// one tool call, and HONEST-LIMITS records that rather than implying otherwise.
//
// Core module: pure, imports nothing.

export interface SessionBannerInput {
  // The harness version, the same string the liveness beacon carries, so the two
  // can be compared without translation.
  version: string;
  // The plugin process id. This is the field an operator checks alive.json's
  // against when asking whether the process that wrote it is still the one here.
  pid: number;
  // The live run, or null when none is open. Null is reported as prose.
  runId: string | null;
  // The resolved model, so a run against unintended weights is visible at the
  // top of the session rather than discovered in the report.
  model: string;
  // The §2.11 stale-red exclusions carried into this run, already phrased by
  // handleChatMessage, or null when there are none.
  staleReport: string | null;
}

// The stale report rides a tool result and is charged against the same context
// window the item's source is, so it is bounded rather than trusted to be short.
const MAX_STALE_REPORT = 400;

/**
 * The one-line banner plus, when there is something to say, the stale-red note.
 *
 * Recognisably conductor's: "no banner, no conductor" only works as a habit if a
 * human can tell this line from any other line of tool output at a glance.
 */
export function composeSessionBanner(input: SessionBannerInput): string {
  const run = input.runId === null || input.runId.length === 0 ? "no run" : input.runId;
  const head =
    "[conductor " +
    input.version +
    " · pid " +
    String(input.pid) +
    " · " +
    run +
    " · " +
    input.model +
    "]";
  if (input.staleReport === null || input.staleReport.length === 0) return head;
  const report =
    input.staleReport.length > MAX_STALE_REPORT
      ? input.staleReport.slice(0, MAX_STALE_REPORT) + "…"
      : input.staleReport;
  return head + "\n" + report;
}
