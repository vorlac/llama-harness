// Tests for conductor/core/preflight.ts — GAP-032 (spec currency) and GAP-033
// (live-artifact checkers), the pre-live-contact go/no-go.
//
// Subject: conductor/core/preflight.ts (pure). These pin the go/no-go decisions
// the owner runs before 13.2 / 14.2, so a stale spec or a run-less artifact is
// caught by a text check rather than by burning a model-gated live budget.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  specCurrency,
  extractCitedFiles,
  checkLiveArtifact,
  type SpecRecord,
  type LiveArtifactSpec,
  type LiveArtifactLedger,
} from "../core/preflight.ts";

// ---------------------------------------------------------------------------
// GAP-032 — spec currency
// ---------------------------------------------------------------------------

const spec132: SpecRecord = {
  taskId: "13.2",
  verifiedAgainstHead: "75a2531",
  citedFiles: ["conductor/adapter/fanout.ts", "conductor/adapter/state.ts", "conductor/core/journal-events.ts"],
};

test("[gap-032-current-when-head-unmoved] identical head is current, no notes", () => {
  const verdict = specCurrency(spec132, {
    currentHead: "75a2531",
    changedPathsSinceVerifiedHead: [],
  });
  assert.equal(verdict.current, true);
  assert.equal(verdict.headMoved, false);
  assert.deepEqual(verdict.driftedCitedFiles, []);
  assert.deepEqual(verdict.notes, []);
});

test("[gap-032-head-moved-no-cited-drift] a moved head with no cited file changed stays current", () => {
  // The real 13.2 shape: HEAD advanced 142 commits but nothing the spec cites
  // changed, so the run is safe — the head move is reported, not blocking.
  const verdict = specCurrency(spec132, {
    currentHead: "f33b95b",
    changedPathsSinceVerifiedHead: ["scripts/conductor_bench.py", "docs/build/HANDOFF.md"],
  });
  assert.equal(verdict.current, true, "no cited file changed, so the spec is current");
  assert.equal(verdict.headMoved, true);
  assert.deepEqual(verdict.driftedCitedFiles, []);
  assert.equal(verdict.notes.length, 1, "the head move is noted");
  assert.match(verdict.notes[0], /75a2531/);
  assert.match(verdict.notes[0], /f33b95b/);
});

test("[gap-032-cited-drift-blocks] a changed cited file makes the spec stale", () => {
  const verdict = specCurrency(spec132, {
    currentHead: "f33b95b",
    changedPathsSinceVerifiedHead: ["conductor/adapter/fanout.ts", "scripts/serve.py"],
  });
  assert.equal(verdict.current, false, "a cited file changed — re-verification is due");
  assert.deepEqual(verdict.driftedCitedFiles, ["conductor/adapter/fanout.ts"]);
  // A head-move note plus one per drifted file.
  assert.equal(verdict.notes.length, 2);
  assert.match(verdict.notes[1], /fanout\.ts/);
});

test("[gap-032-extract-cited-files] code paths are pulled from spec prose, docs ignored", () => {
  const specText =
    "the ONLY machine record is fanout's subsession.retry lines " +
    "(conductor/adapter/fanout.ts:299-320), cross-checked against " +
    "router/admission.hpp and scripts/serve.py:402, per docs/build/HANDOFF.md " +
    "and docs/build/specs/task-13.2.assertions.json. fanout.ts:299-320 again.";
  const cited = extractCitedFiles(specText);
  assert.deepEqual(cited, [
    "conductor/adapter/fanout.ts",
    "router/admission.hpp",
    "scripts/serve.py",
  ]);
  assert.ok(!cited.some((f) => f.startsWith("docs/")), "docs/ citations are not code drift");
});

// ---------------------------------------------------------------------------
// GAP-033 — live-artifact checkers
// ---------------------------------------------------------------------------

const smokeSpec: LiveArtifactSpec = { label: "SMOKE.md", minLines: 5, requireCommandLine: true };
const ledger: LiveArtifactLedger = { runId: "run-20260819-abc", evidenceSeqHighWater: 12 };

function smokeBody(): string {
  return [
    "# Conductor SMOKE",
    "runId: run-20260819-abc",
    "First end-to-end live run.",
    "    $ scripts/serve.py --model qwen3.6-27b",
    "Item TDD cycle recorded at evidence seq 7.",
    "The publish landed in the scratch repo.",
  ].join("\n");
}

test("[gap-033-smoke-ok] a real bound capture passes", () => {
  const check = checkLiveArtifact(smokeBody(), smokeSpec, ledger);
  assert.equal(check.ok, true, check.problems.join("; "));
  assert.deepEqual(check.problems, []);
});

test("[gap-033-runid-bind] an artifact naming no runId is refused", () => {
  const body = smokeBody().replace("run-20260819-abc", "run-somethingelse");
  const check = checkLiveArtifact(body, smokeSpec, ledger);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("bound to no run")));
});

test("[gap-033-evidence-seq-bind] a seq past the ledger high-water does not bind", () => {
  // The body cites seq 99, but the run only minted up to 12 — a body invented
  // without the run's ledger cannot name a seq inside it.
  const body = smokeBody().replace("evidence seq 7", "evidence seq 99");
  const check = checkLiveArtifact(body, smokeSpec, ledger);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("within the run's ledger")));
});

test("[gap-033-command-line-floor] a capture with no $ command line is refused", () => {
  const body = smokeBody().replace("    $ scripts/serve.py --model qwen3.6-27b", "we ran serve.py");
  const check = checkLiveArtifact(body, smokeSpec, ledger);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes('"$ " command line')));
});

test("[gap-033-content-floor] a stub that carries the ids but nothing else is refused", () => {
  const stub = "runId: run-20260819-abc seq 7 $ x";
  const check = checkLiveArtifact(stub, smokeSpec, ledger);
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("content floor")));
});

test("[gap-033-no-evidence-minted] a run that minted no evidence has nothing to bind", () => {
  const check = checkLiveArtifact(smokeBody(), smokeSpec, { runId: "run-20260819-abc", evidenceSeqHighWater: 0 });
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("minted no evidence")));
});

test("[gap-033-report-no-command-required] the report kind can waive the command-line floor", () => {
  const reportSpec: LiveArtifactSpec = { label: "conductor-report.md", minLines: 3, requireCommandLine: false };
  const body = ["# Conductor report", "runId: run-20260819-abc", "aggregated over seq 3 evidence records"].join("\n");
  const check = checkLiveArtifact(body, reportSpec, ledger);
  assert.equal(check.ok, true, check.problems.join("; "));
});
