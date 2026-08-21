// conductor/tests/banner.test.ts — Task 21.7 RED tests for the §3.8 session
// banner (core/banner.ts) and its delivery.
//
// WHY A BANNER AT ALL. OPERATIONS.md's first rule is "no beacon, no conductor",
// and HONEST-LIMITS limit 11 names a visible session banner as the at-a-glance
// form of that check. The beacon works but lives at .conductor/state/alive.json —
// it requires the operator to look OUTSIDE the session to learn whether the
// session is governed. A plugin that fails to load is logged once on the serve
// log and the session comes up looking completely normal (wire-notes DISCOVERY
// (ii)), so "looks normal" is exactly what an ungated session looks like.
//
// WHAT THE SEAM COST. Task 20.5 probed four candidates against the pinned binary.
// A part appended inside chat.message reaches NEITHER the transcript nor the
// model. tui.showToast answers success with no TUI attached, so a 200 proves
// reachability and not visibility. A plugin tool's own return string is visible
// but is tied to a call. The one measured channel that puts plugin-authored text
// in front of an operator is a tool.execute.after output mutation — and it fires
// only when a tool runs. So the banner is CONDITIONAL, and saying so is part of
// the deliverable.

import { test } from "node:test";
import assert from "node:assert/strict";

import { composeSessionBanner } from "../core/banner.ts";

const base = {
  version: "0.1.0",
  pid: 4242,
  runId: "run-20260820-abc",
  model: "llamacpp/qwen3.6-27b",
  staleReport: null,
};

test("[21.7-banner-names-the-four-facts] the banner carries version, pid, runId and model", () => {
  const banner = composeSessionBanner(base);
  assert.match(banner, /0\.1\.0/, "the harness version");
  assert.match(banner, /4242/, "the plugin pid, which is what alive.json is checked against");
  assert.match(banner, /run-20260820-abc/, "the live runId");
  assert.match(banner, /qwen3\.6-27b/, "and the resolved model");
});

test("[21.7-banner-says-conductor] the banner is recognisable as conductor's, because its absence is the signal", () => {
  // "No banner, no conductor" only works if a human can tell one banner from
  // another line of tool output at a glance.
  assert.match(composeSessionBanner(base), /conductor/i);
});

test("[21.7-no-run] a session with no live run says so rather than inventing one", () => {
  const banner = composeSessionBanner({ ...base, runId: null });
  assert.match(banner, /no run/i);
  assert.doesNotMatch(banner, /null|undefined/, "an absent run is prose, not a leaked sentinel");
});

test("[21.7-stale-report-rides-the-banner] the §2.11 stale-red exclusions reach the operator", () => {
  // handleChatMessage has always COMPUTED this and the chat.message hook has
  // always discarded it, so the exclusions the module header promises to report
  // were reported to nobody. The banner is the channel it was missing.
  const report = "3 test files from earlier runs are still red and are excluded from verification.";
  const banner = composeSessionBanner({ ...base, staleReport: report });
  assert.ok(banner.includes(report), "the report text is carried verbatim, not paraphrased");
});

test("[21.7-no-stale-report] a run with no exclusions adds no line about them", () => {
  const banner = composeSessionBanner(base);
  assert.doesNotMatch(banner, /stale|excluded/i, "silence is the correct report for nothing to report");
});

test("[21.7-bounded] the banner is short enough to ride a tool result without displacing it", () => {
  const long = "x".repeat(5000);
  const banner = composeSessionBanner({ ...base, staleReport: long });
  assert.ok(
    banner.length < 1200,
    `the banner rides a tool result and is charged against the same context the item's source is: ` +
      `${String(banner.length)} chars is too much`,
  );
});
