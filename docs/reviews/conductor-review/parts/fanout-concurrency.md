# Enforcement Review Part — Fan-out, Continuation, Router Client, Concurrency

**Scope:** `conductor/adapter/fanout.ts`, `conductor/adapter/continuation.ts`,
`conductor/adapter/router-client.ts`. The concurrency cap, the wave barrier, the per-job watchdog
(bounding `session.create` AND the prompt), watchdog-vs-completion double-resolve, the freeze-hold
(double-dispatch / strand), the failover latch, the §3.7 idle engine and its stop paths. Flake
sweep of the fan-out tests (10–20 runs). Leak hunt: fds, child processes, unbounded in-memory
growth.

**Date:** 2026-08-15
**Reviewer:** enforcement sub-reviewer (fanout-concurrency lane)
**Status:** COMPLETE. All mutations restored (`cmp`-verified against snapshots), tree clean
(only this file added), zero stray processes, scoped gate re-run GREEN on the restored tree.

**Verdict in one paragraph.** The three files' core mechanics — the concurrency cap, the wave
barrier, the per-job watchdog (which does bound `session.create` AND the prompt), the
freeze-hold, and the §3.7 accounting — are correct and unusually well-defended: five of seven
run mutations were caught by direct, well-aimed assertions, and the futility/restart/transport-
floor tests are P2-clean. The real defects live at the seams: everything §4.4 promised about
the router CLIENT side is either unwired in production (metrics into the report, metricsPartial,
routerHealthy — -001/-002), unimplemented (fan-out 503 backoff — -003), or structurally
impossible and unrecorded (model-traffic failover — -012); the gate itself converts hang-shaped
regressions into infinite wedges (-006); and the idle engine has two unbounded-silence doors its
own comments almost closed (-010/-011).

---

## 1. ISSUE register

(entries appended as found; numbered FANOUT-CONCURRENCY-NNN)

### FANOUT-CONCURRENCY-001 — Production never wires `fetchMetricsSummary` into `conductor_report`: the §4.4 metrics ledger is unreachable in every production report

**Severity:** MAJOR (spec conformance + P12: a path production never walks)
**Pattern:** P12, P3 (comment claims a consumer that does not exist)
**Files:** `conductor/plugin/index.ts:967-980` (the `deps` bundle), `conductor/adapter/tools.ts:7322/7455/7584` (`ReportInput.metrics` optional seam), `conductor/adapter/router-client.ts:197` (`fetchMetricsSummary`), `conductor/core/tool-bindings.ts:168-173`.

**Claim.** Plan §4.4 (lines 1680-1684) makes the router's metrics ledger "the POC's cost and
conformance dataset" and Task 7.2 ships `fetchMetricsSummary` to read `/conductor/metrics`.
`ReportInput.metrics` is the optional seam that feeds it into the report (`tools.ts:7455`:
`const summary = input.metrics === undefined ? null : await input.metrics();`). The plugin's
composition root builds the ONE `deps` bundle every bound tool spreads (`plugin/index.ts:967-980`)
and it contains **no `metrics` field**. `conductor_report` is bound as
`handleReport({ ...deps })` (`plugin/index.ts:1089`). So in production `input.metrics` is always
`undefined`, `summary` is always `null`, and `metricsAvailable` is always `false` — the router
metrics section of every real report is permanently the "unavailable" arm. Only `e2e.test.ts` and
the g5 evidence tool ever pass the real function (`conductor/tools/g5-equivalence.ts:15`).

**Verification.** `grep -rn "fetchMetricsSummary" conductor/` — hits only in
`router-client.ts` (definition), `tools/g5-equivalence.ts` (evidence tool), a comment in
`core/tool-bindings.ts`, and tests. Zero hits in `conductor/plugin/`. The `deps` object literal
at `plugin/index.ts:968-980` lists store/fanout/treeState/runId/config/journal/stateHome/
workspaceKey/packs/overrideGrants/sessionID — no metrics.

**What a reader is told instead.** `tool-bindings.ts:173` says "The root still passes its fanout
here, as everywhere an input accepts it" about the *fanout* seam — but nothing anywhere says the
root deliberately omits `metrics`, and the plan says the opposite.

**Failed refutation attempt.** Could the omission be deliberate (report must not block on a dead
metrics endpoint)? No — the seam is already fail-soft (`fetchMetricsSummary` never throws,
resolves null, and the report's own comment at tools.ts:7321 says the report "must not be held
hostage by a metrics endpoint that is down"). The infrastructure to pass it safely exists and is
exercised by e2e; only the production wire is missing.

**Fix direction.** Compose `metrics: () => fetchMetricsSummary(routerCfgFromEnv, log)` into the
report deps (the router config is already derivable — `runSetup` builds it at
`plugin/index.ts:1203-1206`), or record a deviation stating that production reports carry no
router metrics.

**Confidence:** high (grep-verified; the e2e test passing the real function proves the seam
works, which sharpens rather than excuses the missing production wire).

---

### FANOUT-CONCURRENCY-002 — `FailoverState.metricsPartial` is written and read by nothing: the §4.4 "mark the run's metrics as partial" clause is unimplemented, and router-client.ts's comment names a consumer that does not exist

**Severity:** MAJOR (spec conformance; P4 — a name/comment asserting an unimplemented property)
**Pattern:** P4, P12
**Files:** `conductor/adapter/router-client.ts:32-33,38,112`, plan §4.4 lines 1690-1692.

**Claim.** Plan §4.4: failover means "journaling a `router.failover` warning and **marking the
run's metrics as partial**". `noteRouterFailure` sets `failoverState.metricsPartial = true`
(router-client.ts:112) and the doc comment at router-client.ts:32-33 says "`metricsPartial` is
the boolean Task 9.5b (conductor_report) reads". It is not:
`grep -rn "metricsPartial" conductor/` hits only router-client.ts, its unit test, and one
assertion in `setup.test.ts:1678` that the flag is *set*. `conductor/adapter/tools.ts` (the
report writer) and `conductor/plugin/index.ts` contain zero references. No report, journal
record, or artifact ever discloses that the run's metrics are partial. Combined with -001, the
production report can neither carry metrics nor say they are partial.

**Consequence.** A run in which the router died mid-way produces a report indistinguishable from
a run with full metrics coverage (both say "unavailable" today; if -001 is fixed without this,
both would say "available" with silently truncated data) — exactly the "evidence a careful
reader could not accept" shape the enforcement charter names.

**Failed refutation attempt.** Is `metricsAvailable: false` an adequate stand-in? No — that flag
reports the *fetch* outcome at report time, not that requests mid-run bypassed the ledger. A
router restarted before report time yields `metricsAvailable: true` over a ledger with a hole.

**Fix direction.** Thread `failoverState` (already minted once per plugin process at
`plugin/index.ts:650`) into `ReportInput` and render partial-ness; delete or correct the
router-client comment.

**Confidence:** high (grep-verified).

---

### FANOUT-CONCURRENCY-003 — Plan §4.4's "503 … the fan-out engine understands (it backs off and retries; bounded)" has no implementation anywhere, and no recorded deviation

**Severity:** MINOR-to-MAJOR (unimplemented normative clause; honesty of the build record)
**Pattern:** spec conformance; P12
**Files:** `conductor/adapter/fanout.ts` (whole file), plan §4.4 "Admission" bullet (lines ~1652-1659).

**Claim.** The plan's admission contract: "Queue overflow or timeout ⇒ 503 with a JSON error the
fan-out engine understands (it backs off and retries; bounded)." `grep -rn "503\|backoff" conductor/adapter/ conductor/core/ conductor/plugin/` finds no handling. Structurally the engine
*cannot* see the 503: it drives sub-sessions through opencode's `session.prompt`, and the model
HTTP call (where the router's 503 lands) is made by opencode's provider client, not by conductor.
What actually happens on an admission 503: opencode's provider surfaces an error, the prompt
reply carries no text parts, `extractReplyText` returns "", `parseAndValidate` fails with
"response was not parseable JSON", and the engine burns its ≤2 *schema* retries with zero
backoff before returning an env error — the schema-retry budget is silently repurposed as the
admission-retry budget the plan promised separately.

**Search of the record.** `grep -rn "backs off\|backoff" docs/build/` finds only the *router
supervisor* backoff discussion (Phase 12). Neither `CORRECTIONS.md` nor `wire-notes.md` records
this clause as dropped or re-scoped, and wire-notes is where the same section's other wire
discoveries (e.g. no `format` field) are pinned.

**Mitigation observed.** `maxInflightPerModel` is derived from `parallel.maxReaders` (Task 12.1)
and the engine caps concurrency at `maxReaders`, so conductor's *own* traffic should not overflow
the router queue in the default config — the reachable case needs foreign traffic on the same
router or a queue timeout. That bounds severity, not the conformance gap.

**Fix direction.** Record the deviation (the honest minimum), or implement bounded backoff-retry
in the engine on the error-envelope path with the router's 503 envelope shape detected from the
reply error.

**Confidence:** high on the absence (grep + structural argument); medium on the runtime behavior
description of opencode's provider layer (not directly observed — would need a live opencode).

---

### FANOUT-CONCURRENCY-004 — `fetchMetricsSummary` returns an unvalidated cast: any JSON object (or array) becomes a `MetricsSummary`, contradicting the file's own "a malformed body never reaches a consumer" claim

**Severity:** MINOR today (its only consumers are the e2e test and the g5 evidence tool — see
-001), MAJOR the moment -001 is fixed
**Pattern:** P4 (comment asserts a property the code does not implement), P5 (no shape-refusal
beyond "is an object")
**Files:** `conductor/adapter/router-client.ts:42-43,214-220`.

**Claim.** The `MetricsSummary` doc comment says "Fail-soft: a malformed body never reaches a
consumer — fetchMetricsSummary returns null first." The implementation checks only
`typeof parsed !== "object" || parsed === null` and then `return parsed as MetricsSummary`.
A body of `[]` (arrays are `typeof "object"`), `{}`, or `{"totalRequests":"a lot"}` all pass and
reach the consumer with every declared numeric field `undefined` or mistyped. The report
formatter then renders `undefined` token counts as real data (`metricsAvailable: true`).

**Reproduction (scratch, no source touched).**
`node -e 'const t=[] ; console.log(typeof t==="object" && t!==null)'` → `true`. The unit test
suite (`router-client.test.ts` "garbage body -> null") covers only a *non-JSON* body; a
wrong-shape JSON body has no refusal test (P5).

**Fix direction.** Validate the five numeric fields + statusCounts record before returning, else
null; add the refusal test.

**Confidence:** high.

---

### FANOUT-CONCURRENCY-005 — A `journal.log` throw inside the fan-out watchdog callback (or the engine-error catch) skips `finish()`: the wave barrier never resolves and the exception escapes as an uncaught timer error

**Severity:** MAJOR (liveness + G5), low likelihood per-call but the failure is a permanent wedge
**Pattern:** P7 (correct components composing into a hole), crash-safety
**Files:** `conductor/adapter/fanout.ts:239-253` (watchdog), `:341-348` (catch),
`conductor/adapter/journal.ts:265-272` (uncaught `appendFileSync`),
`conductor/plugin/index.ts:373-390` (the forwarding wrapper adds no try/catch).

**Claim.** `createJournal().log` performs `appendFileSync` (journal.ts:271) and rotation
`writeFileSync` (journal.ts:218-219) with **no try/catch** — ENOSPC, EACCES, or a removed run
dir throws out of `log`. In dev/test (`NODE_ENV !== "production"`) an unknown event name also
throws by design (journal.ts:230-235). The plugin's rebindable journal wrapper
(plugin/index.ts:374-390) forwards without catching. In fanout.ts:
- the watchdog `setTimeout` callback calls `journal.log` (line 239) **before** `finish` and
  outside any try — a throw here (a) escapes the timer callback as an uncaught exception
  (process-fatal in Node absent a global handler: the G5 "conductor bug kills the session"
  shape), and (b) skips `finish`, so the slot is never freed, `remaining` never reaches 0, and
  `runGroup`'s promise — and therefore `dispatchWave` and the tool call awaiting it — never
  resolves;
- the engine-error catch (line 341) likewise calls `journal.log` before `finish`; a second throw
  there escapes the async IIFE as an unhandled rejection and again skips `finish`.
By contrast, `continuation.ts`'s equivalent path is ordered defensively (`settle()` clears the
latch *before* its `journal.log`), and `handlePluginEvent` catches everything — the fan-out
engine has no equivalent outer net, and its caller (`handleDispatchWave`) awaits it.

**Trigger realism.** Disk-full during a long run is the realistic trigger; the run dir is not
moved by `archiveRun` (verified: state.ts:563-568 only clears the pointer) so ENOENT-by-archive
is not a path. An unknown-event typo would be caught by the vocab source audit for committed
call sites.

**Failed refutation attempt.** "journal.log is called throughout tools.ts unprotected too, so
this is uniform risk" — no: a throw in a *tool handler* propagates to the tool call and surfaces
as a refused call (fail-loud); a throw in a *detached timer callback* has no awaiting caller —
its unique consequences are the uncaught-exception escape and the permanently hung wave.

**Fix direction.** Wrap the watchdog body and the catch-path journal call in try/catch (finish
regardless), or give the plugin's journal wrapper a catch-and-stderr fallback.

**Confidence:** high on the mechanism (code-read, all three files); the trigger requires an fs
error, not reproduced end-to-end.

---

### FANOUT-CONCURRENCY-008 — An undelivered NEEDS_CONTEXT conversion is reported "lost" TWICE, and the test that claims "reported as lost exactly once" samples the journal before the second record lands

**Severity:** MINOR (double-reported error record + stale in-memory retention; no silent loss)
**Pattern:** P13 (a named test that does not prove its title's clause), plus a small real defect
**Files:** `conductor/adapter/continuation.ts:472-495` (`cleanupAndArchive` logs each pending
conversion as lost but does NOT remove it from `state.pendingConversions`), `:729-760`
(`takeConversionsFor` later drains the same entries as "foreign" and logs each AGAIN),
`conductor/tests/continuation.test.ts:4256-4339` (the run-scoped test).

**Reproduced.** I copied the committed test's prelude plus the run-scoped test into a scratch
test file, extended it to re-count `hook: continuation.surface-conversion` error records AFTER
the second run's re-prompt, and ran it: **`PROBE lost-record-count-after-second-run=2`** — one
"the run ended before this NEEDS_CONTEXT conversion could be surfaced … so it is lost", then a
second "raised under run r-…, which is no longer the live run, so it is discarded". The
committed test's `lost.length === 1` assertion (line 4315) executes before the second idle, so
it can never see the duplicate; its title says "exactly once" over the whole scenario. (Scratch
file deleted; tree clean.)

**Also.** Until some later run's re-prompt actually drains them, the dead conversions stay in
`state.pendingConversions` for the life of the process (nothing else removes them). Bounded by
ask volume; still a retention leak the run-end pass believes it has settled ("each undelivered
conversion leaves a record" — it leaves the record AND the entry).

**Fix direction.** In `cleanupAndArchive`, remove the logged conversions from the queue
(filter to `runId !== run.runId`); move the committed test's count assertion after the second
idle.

**Confidence:** high (reproduced).

---

### FANOUT-CONCURRENCY-009 — The ask-gate's wildcard screen covers `patterns` but not `metadata.filePath`/`metadata.path`: a wildcard riding metadata is adjudicated as though it were one concrete file, and decideEdit allows it

**Severity:** MINOR-to-MAJOR (fail-closed asymmetry at a trust boundary the code itself calls
unverified)
**Pattern:** P1-adjacent (a screen inspecting less than it appears to), security hardening
**Files:** `conductor/adapter/continuation.ts:1077-1088` (`hasWildcard` applied only to
`event.patterns`; `metadata.filePath` / `metadata.path` returned unscreened and FIRST in
precedence), `conductor/core/gates-edit.ts` (glob match).

**Reproduced.** `decideEdit({sessionRole:"orchestrator", …, path:"/repo/src/**",
inlineClaimScope:["src/**"], sessionTree:"/repo"})` → **`action:"allow"`** (probe run against the
real module). So a `permission.asked` event with `patterns` absent and
`metadata.filePath: "/repo/src/**"` extracts the literal `"/repo/src/**"`, matches the claim
glob, and is replied `"once"` — the exact grant the SG-10 comment says must never happen
("filtering the wildcards out … would grant `**` on the strength of one covered file"). The
comment's reasoning is applied to `patterns` and not to the field that WINS the extraction
precedence.

**Reachability.** wire-notes records `patterns`/`metadata` as never-asserted upstream shapes
(SG-10) — whether opencode ever puts a glob in `metadata.filePath` is unknown, which is the
argument FOR screening it, not against: the whole SG-10 posture is "an unrecognized payload
fails closed". Test 2934 covers wildcard-only `patterns` and test 3820 covers wildcards beside
a concrete pattern with a metadata rescue attempt — no test covers a wildcard IN metadata with
patterns absent.

**Fix direction.** Apply `hasWildcard` to the metadata fields in `extractAskPath` (return null),
one test.

**Confidence:** high on the code behavior (reproduced); medium on real-world reachability.

---

### FANOUT-CONCURRENCY-010 — A re-prompt whose promise never settles raises the one-in-flight latch forever: the idle engine goes permanently silent, and neither the futile rule nor the send-failure floor can ever fire

**Severity:** MAJOR-shaped, MINOR-rated (needs a transport that hangs without erroring;
local-socket opencode makes that rare)
**Pattern:** P7 — the exact "fault creates the very wedge the engine exists to end" shape the
file's own comments fence off twice, with the third door left open
**Files:** `conductor/adapter/continuation.ts:903` (the latch check), `:946-974` (raise, settle
on `.then(settle, failed)`, sync-throw handling), `:191` (`CONSECUTIVE_SEND_FAILURE_LIMIT`
counts ONLY synchronous throws).

**Claim.** The engine handles three transport outcomes: settled-ok (accounted), settled-reject
(accounted; conversions requeued), and synchronous throw (not accounted; bounded by the
5-consecutive floor, stops `env`). A promise that NEVER settles is the fourth outcome:
`rePromptInFlight` stays true for the life of the process, every subsequent
`handleSessionIdle` returns at step (i) (line 903), the counters freeze, §3.7's only wedge
detector never fires, and the run sits in EXECUTING with no artifact and no end — precisely the
C-085 outcome, produced by the transport instead of the scheduler. The header comment
(lines 938-944) names this danger ("A latch left raised … silences the idle engine for the life
of the process, which freezes the counters, which means the wedge detector can never fire")
but the implemented mitigations cover only the settle and sync-throw paths. The fan-out engine
bounds its prompts with a watchdog (`subSessionTimeoutMs`); the idle engine's prompt has no
bound at all.

**Nuance / failed refutation.** The latch legitimately stays raised while the orchestrator
works its turn (that IS the concurrency bound), so a naive timeout would be wrong — but the
fan-out engine already solved this same problem for sub-sessions with the per-job watchdog, and
`subSessionTimeoutMs` (default 900 s) is an existing, generous bound that distinguishes "long
turn" from "dead transport". Alternatively, passes skipped at the latch could count toward a
floor of their own. Test 1347 proves the latch holds while parked and releases on settle; test
4092 proves the sync-throw release; nothing exercises never-settles (P12).

**Fix direction.** Watchdog the re-prompt promise at `subSessionTimeoutMs` (settle the latch,
requeue conversions, count toward the send-failure floor), or count latch-skipped passes.

**Confidence:** high on the mechanism (code-read; all three handled outcomes traced), not
reproduced live.

---

### FANOUT-CONCURRENCY-011 — A deterministic throw early in `handleSessionIdle` (reconcile, currentRun, loadRun) makes the idle engine permanently silent through the G5 catch: error records accumulate but no floor ever converts "the engine is broken" into a stop

**Severity:** MINOR (requires persistent store-level failure; consequence is the silent-wedge
shape)
**Pattern:** P7 (the same composition argument the transport floor was built on, unapplied to
the store seam)
**Files:** `conductor/adapter/continuation.ts:786-788` (reconcile + loadRun before every other
decision, unguarded), `:1369-1381` (`handlePluginEvent`'s catch — journal-and-return),
`conductor/adapter/state.ts` (`loadRun` throws on unparseable run.json; `setBlocked` re-throws
schema-invalid writes).

**Claim.** `handleSessionIdle` runs `reconcileOrphanQuestions` and `store.loadRun` before the
halt check, the terminality check, the wedge rule and the re-prompt. A deterministic throw
there (corrupt run.json; an item that loads but fails schema validation inside `setBlocked`)
is caught by `handlePluginEvent` (G5) and journaled `hook.failed` — every pass, forever. No
re-prompt, no `noop` stop, no report: the run idles in EXECUTING indefinitely with only
error-level journal lines to show for it. The transport floor exists precisely because "a
permanently dead transport then freezes the counters forever, and §3.7's futile re-prompt
limit — the ONLY wedge detector — can never fire" (comment at lines 177-191); a permanently
throwing store front-section produces the identical outcome and has no floor.

**Mitigating reality.** A corrupt run.json breaks most of the harness, not just this engine;
the journal is loud. This is a completeness note on the wedge-detector story rather than an
urgent defect.

**Fix direction.** Either wrap the pre-decision section so a throw still reaches the
halt/terminality checks, or extend the consecutive-failure floor to cover any repeatedly
throwing idle pass.

**Confidence:** medium-high (mechanism traced; not reproduced — would need a hand-corrupted
store).

---

### FANOUT-CONCURRENCY-012 — §4.4's failover protects only conductor's own setup-probe HTTP requests; the run's MODEL traffic cannot fail over at all, and `routerHealthy` has no production caller

**Severity:** MAJOR as a spec/honesty gap, structural (not a code bug — the code cannot do what
the plan says, and no deviation is recorded)
**Pattern:** spec conformance; P12; P4 (the file's header restates the plan's claim)
**Files:** `conductor/adapter/router-client.ts:11-18` (header: "The fan-out engine, on
observing a router request failure, records it via noteRouterFailure"), `conductor/adapter/
tools.ts:8701-8741` (`setupProofRequest` — the ONLY production consumer of the latch),
`conductor/plugin/index.ts:650,1200-1216` (the latch is minted once and handed only to setup),
plan §4.4 lines 1685-1698.

**Claim.** Plan §4.4: while the router is down "the plugin's router client detects this
(Task 7.2) and **fails over to the upstream base URL for the remainder of the session**",
with the stated rationale: "Without failover … **in-flight sub-sessions still die and the run
still takes `env` failures**." In the shipped system:
- The run's model traffic flows opencode → provider baseURL (fixed in opencode's config at
  session start, wire-notes:37) → router. The plugin cannot re-point opencode's provider
  mid-session; nothing tries. When the router dies mid-run, in-flight sub-sessions DO die and
  the run DOES take env failures — the exact outcome the plan says failover exists to prevent.
- The latch (`FailoverState`) diverts only conductor's own direct HTTP calls, and the only
  production call sites are the §2.1 setup proofs (`setupProofRequest`,
  `setupServedSlotCount`). Verified by grep: `resolveBaseUrl`/`noteRouterFailure` are imported
  only by `tools.ts` (setup section); `createFailoverState` only by `plugin/index.ts:650` which
  passes it only into `SetupInput`.
- `routerHealthy` — and its probingDisabled short-circuit, §4.4's "Two failovers in one session
  stop retrying the router entirely" — has **zero production callers** (tests and the g5
  evidence tool only). The real mitigation for mid-run router death is Phase 12's supervisor
  restart, which the plan describes as a separate layer.
- The fan-out engine itself (`fanout.ts`) contains no router awareness whatsoever, contrary to
  the router-client header comment and the plan's §4.4 wiring description.

**What a reader is told.** router-client.ts's header repeats the plan's claim verbatim.
`grep -rn "failover" docs/build/CORRECTIONS.md` records no re-scope of §4.4's failover clause
after the Task 0.2 wire discovery that model calls are opencode's, not the engine's.

**Fix direction.** Record the deviation honestly (failover = setup probes only; model-traffic
resilience = supervisor restart + opencode's own retry behavior, whatever that is), correct the
router-client header, and delete or wire `routerHealthy`.

**Confidence:** high (all grep-verified; consistent with -001/-002/-003 — §4.4's client-side
clauses were authored against a pre-wire-verification architecture and only partially re-scoped).

---

## 2. IDEA register

### IDEA-FC-1 — Give the gate a `--test-timeout` and the fanout test config a small `subSessionTimeoutMs`
Origin: MUT-3/MUT-5 during this review (a red stalls 15 min; a wedge stalls forever).
Kind: test-maintainability / tooling. Value: hang-shaped regressions become reds; failed runs
finish promptly. Cost: two lines. Relates to: FANOUT-CONCURRENCY-006.

### IDEA-FC-2 — Prune or cap `ContinuationState.adjudicated`
Origin: leak hunt. The Set gains one entry per permission id for the life of the plugin
process and nothing ever removes entries. Harmless at realistic volumes; an LRU cap (or
pruning on run archive) makes the no-leak property unconditional. Kind: polish.
Relates to: standalone.

### IDEA-FC-3 — `httpGet`/`routerHealthy` "never rejects" has one crack: a synchronous throw out of `node:http.request` (malformed host/port from env) rejects the promise
Origin: reading router-client.ts:138 — the executor body calls `httpRequest` outside any
try/catch; `originOf` builds the config from raw env vars (`plugin/index.ts:1204`). An
invalid port (NaN from a mangled `LLAMA_HARNESS_ROUTER_URL`) throws synchronously and the
"never rejects" contract breaks where it is relied on for fail-soft. Kind: hardening.
Cost: a try/catch. Relates to: FANOUT-CONCURRENCY-004.

### IDEA-FC-4 — The `reprompt` journal record's `surfaced` count is written before delivery is known
Origin: reading continuation.ts:965-1051. A send that later REJECTS re-queues its conversions,
but the already-written record claims they were surfaced. One-line fix: journal surfaced count
from the settle path, or note the requeue in `failed`'s record (it does log the count as
`surfaced` there, so the pair is reconstructible — this is polish). Kind: docs/telemetry
accuracy. Relates to: FANOUT-CONCURRENCY-008.

### IDEA-FC-5 — A torn/unparseable queue.json silently reads as "no items" in the idle engine
Origin: continuation.ts:306-314 (`readQueue` returns null on parse failure) — signature says
"no items", waveVerdict sees `{items:[]}`, nothing is actionable, the engine idles silently
forever, and the wedge detector never fires. State writes are atomic so this needs external
corruption, but the failure mode is the silent-wedge shape; a loud journal record on parse
failure would cost two lines. Kind: hardening. Relates to: FANOUT-CONCURRENCY-011.

---

## 3. CROSS-LENS POINTERS

- **MACRO:** Plan §4.4's client-side clauses (failover for the session's traffic, fan-out
  503 backoff, metrics-partial in the report) describe a pre-Task-0.2 architecture in which
  the fan-out engine made model HTTP calls; the wire discovery that opencode owns those calls
  was never propagated back into a recorded §4.4 re-scope. One deviation note would settle
  -001/-002/-003/-012 together. (Owner: macro — design/record coherence.)
- **MACRO:** `continuation.ts` (1,382 lines) carries three separable engines (idle engine,
  ask-gate, plugin-event router) plus two exported claim-derivation helpers consumed by the
  gate hook — navigability/altitude observation for the macro lens.
- **MACRO:** the gate script's lack of any timeout (-006) is a gate-regime design point, not
  just a bug: the build's enforcement backbone has an availability failure mode.
- **CAPABILITY:** nothing converts "the idle engine has thrown on every pass for an hour" or
  "the transport hangs" into an operator-visible artifact (relates -010/-011); the journal is
  the only trace and nothing watches it.
- **OTHER LANE (gates/edit):** `decideEdit` glob-matches a *literal path containing `*`*
  against claim scopes (`/repo/src/**` vs claim `src/**` → allow, reproduced). The ask-gate
  screen (-009) is one consumer; the edit-gate lane may want path-literalness enforced in
  `decideEdit` itself so every consumer inherits it.
- **OTHER LANE (state/journal):** `journal.ts` `log()` can throw (appendFileSync ENOSPC /
  unknown-event in dev) and every subsystem calls it unprotected; the fan-out consequences are
  -005 but the exposure is repo-wide.
- **OTHER LANE (setup/tools):** `setupProofRequest`'s herd-latch logic (tools.ts:8701-8741)
  reads correct under inspection and is tested by setup.test.ts; noting for the setup lane
  that its journal `failover` record is written beside `noteRouterFailure`'s silent call —
  the two-record shape is deliberate (source-audit visibility) and documented inline.
- **META/R1:** task-7.2's assertion row "run metrics marked partial" is satisfied by an
  in-memory boolean no production code reads (-002) — a P13-adjacent row-vs-proof nuance for
  the assertion-ledger enumeration.

---

### FANOUT-CONCURRENCY-006 — The test gate has no `--test-timeout`: a hang-shaped fan-out regression wedges the gate forever instead of failing it, and fanout.test.ts:447 cites a suite timeout that does not exist

**Severity:** MAJOR (the gate is the enforcement backbone; a wedge is worse than a red)
**Pattern:** P4 (a comment asserting a mechanism that is absent), new class: **a gate whose
failure mode for a liveness bug is its own loss of liveness**
**Files:** `scripts/test-conductor.sh` (read in full — no timeout of any kind; the node runner
runs with `--test-timeout=0` per `ps` inspection), `conductor/tests/fanout.test.ts:447`
("caught by the suite's --test-timeout" — no such flag is set anywhere; `grep -rn
"test-timeout" scripts/ conductor/` matches only that comment).

**Measured, twice, during this review's own mutation campaign:**
- MUT-5 (watchdog armed only after `session.create` resolves): the create-hang test deadlocks —
  `await pending` never resolves, node --test never exits, the gate never reports. The
  protection for F1 is therefore "the gate hangs forever", which on an unattended run is
  indistinguishable from a long pass.
- MUT-3 (`inFlight <= maxReaders`): the concurrency test FAILS correctly, but the failed test
  leaves parked prompts and **armed, un-unref'd 900 s watchdog timers** (makeConfig's default
  `subSessionTimeoutMs: 900_000`), so the node process lingers ~15 minutes after the red before
  the trailer prints. Every future red in this file pays the same stall.

**Consequence.** The single most valuable regression signal for this subsystem (a wedged wave —
exactly the C-085 class) is converted from a red into an infinite hang. A CI or human watching
the gate sees no failure, just no completion.

**Fix direction.** Pass `--test-timeout` (e.g. 120000) in `scripts/test-conductor.sh`; fix or
delete the fanout.test.ts comment; consider a small `subSessionTimeoutMs` in `makeConfig()`s
default so leaked timers cannot stall the runner.

**Confidence:** high — both behaviors reproduced on this machine during the campaign.

---

### FANOUT-CONCURRENCY-007 — The watchdog-fired-then-create/prompt-completes paths are proven by nothing: MUT-2 (delete the late-create abort) survives the FULL gate

**Severity:** MINOR (resource leak on a rare race; the correctness guard is structural)
**Pattern:** P11/P12 (untested-but-correct; a branch nothing walks)
**Files:** `conductor/adapter/fanout.ts:259-269` (late-create abort), `:307`
(prompt-reply-after-watchdog guard).

**Mutations run:**
- MUT-2 removed the late-create abort block (a session created after the watchdog already timed
  the job out is aborted so it does not leak). **Full gate: GATE PASS, 1382/1382.** Nothing in
  the repository can fail if that abort disappears — a leaked live sub-session per
  create-slower-than-watchdog race.
- MUT-1 removed the `if (done) return;` after the prompt await. Scoped gate: PASS. Analysis:
  `finish()`'s own `done` guard makes the double-*finish* impossible (and `finalizeSlot` is a
  Promise resolve, idempotent), so the barrier accounting is structurally safe — but with the
  guard gone a watchdog-aborted job whose prompt later resolves invalid would **keep re-prompting
  the aborted session** (the retry `continue` path) and would journal a false
  `subsession.complete ok:true`. That behavior difference is observable and untested.

**Verdict on the double-resolve question the charter asks:** watchdog-vs-completion
double-resolve is structurally prevented (the `done` flag + promise-resolve idempotence + onDone
attached once per job promise) — I could not construct a double-count of `inFlight`/`remaining`
under any interleaving. What is NOT protected is the economy/telemetry of the post-abort tail
(MUT-1/MUT-2 behaviors).

**Fix direction.** One test: create resolves after the watchdog fires → assert the late abort;
one test: prompt resolves after the watchdog fires → assert no further prompt and no ok:true
completion record.

**Confidence:** high (full-gate survival measured for MUT-2).

---

## 4. Mutation table

| # | File | Mutation | Expectation | Result | Verdict |
|---|------|----------|-------------|--------|---------|
| MUT-1 | adapter/fanout.ts:307 | remove `if (done) return;` after prompt await | maybe caught by watchdog tests | scoped gate PASS (13/13) | SURVIVED (belt-and-braces guard; finish's own done-guard prevents double-finish; post-abort re-prompt + false journal record untested → -007) |
| MUT-2 | adapter/fanout.ts:259-269 | remove late-create abort (session leak) | uncaught (no test drives create-resolves-after-watchdog) | **FULL gate PASS (1382/1382)** | SURVIVED → -007 |
| MUT-3 | adapter/fanout.ts:405 | `inFlight < maxReaders` → `<=` | concurrency test red | `not ok 12 [7.1-concurrency]`, then ~15 min stall from un-unref'd 900s timers | CAUGHT (with stall → -006) |
| MUT-4 | adapter/fanout.ts:286-291 | defer registry.set to a microtask after prompt issue | registry-first test red | `not ok 6 [7.1-registry-first]` | CAUGHT |
| MUT-5 | adapter/fanout.ts:234 | arm watchdog only after create resolves | create-hang test red | **suite deadlocks forever; no red ever reported** (killed by hand) | CAUGHT-BY-HANG only → -006 |
| MUT-6 | adapter/fanout.ts:112 | MAX_ATTEMPTS 3 → 4 | retry-budget test red | `not ok 8 [7.1-retry persistent]` | CAUGHT |
| MUT-9 | adapter/fanout.ts:389 | hold release without `pump()` (strand) | freeze-hold test red | `not ok 4 [7.1-freeze-hold]` then hang (killed) | CAUGHT (red printed before hang) |
| MUT-8 | adapter/fanout.ts:215 | (not run) remove `registry.delete` in finish | cleanup test asserts `registry.size === 0` directly | judged protected by inspection | PROTECTED (by inspection) |
| MUT-10 | adapter/fanout.ts:180-194 | (not run) collapse groupByModel to one group | grouping test asserts mid-wave `prompts.length===2` + AABB order directly | judged protected by inspection | PROTECTED (by inspection) |
| C-MUT-A | adapter/continuation.ts:364-369 | drop blocked/deferred reasons from the futility signature | signature-reset tests red | `not ok 9 [10.1-signature-change-resets]` (46/47 pass) | CAUGHT |
| C-MUT-B | adapter/continuation.ts:926 | `resumedMidCount = false` (charge the restart pass) | restart-case test red | `not ok 10 [10.1-signature-change-resets RESTART]` (46/47 pass) | CAUGHT |
| C-MUT-PROBE | (scratch test copy, then deleted) | recount surface-conversion loss records AFTER the second run's drain | 1 if single-report holds | **2 records** | DEFECT CONFIRMED → -008 |
| R-MUT-2 | adapter/router-client.ts:214-219 | delete the entire "metrics body not an object" guard | some test feeds a wrong-shape body | scoped 12/12 PASS, **FULL gate PASS (1382/1382)** | SURVIVED → -004 (guard is decorative) |
| R-MUT-1 | adapter/router-client.ts:185 | (not run) `routerHealthy` true on any status | "404 -> false" test reads it directly | judged protected by inspection | PROTECTED (by inspection) |
| R-MUT-3 | adapter/router-client.ts:113 | (not run) probingDisabled at >= 3 | "two failovers disable probing" test reads it directly | judged protected by inspection | PROTECTED (by inspection) |
| GATE-PROBE | core/gates-edit.ts (read-only probe, no mutation) | `decideEdit` path `/repo/src/**` vs claim `["src/**"]` | deny expected if paths were literal | **allow** | DEFECT INPUT → -009 |

**Flake sweep (charter requirement):** `conductor/tests/fanout.test.ts` run 20× consecutively
via `node --test --test-reporter=tap` (read-only; verdicts still owed to the gate): **20/20
runs, 13 pass / 0 fail each — zero flakes.** `continuation.test.ts` run 5×: 47/0 each.
`router-client.test.ts` 1×: 12/0. Full gate run twice during the campaign (under MUT-2 and
R-MUT-2): both times all 1,382 node tests, bun, schema-export and 80 python tests behaved
identically — no flake observed anywhere in the sweep.

---

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion |
|------|---------------|----------|------------|
| conductor/adapter/fanout.ts (446 ln) | read whole; 7 mutations run, 2 by-inspection; leak/double-resolve analysis; flake sweep 20× | 100% read | Core scheduling sound and well-tested; untested post-watchdog tail (-007); journal-throw liveness hole (-005); no router awareness (feeds -012) |
| conductor/adapter/continuation.ts (1,382 ln) | read whole; 2 mutations run; 1 scratch-reproduction; latch/floor composition analysis; ask-gate probe via decideEdit | 100% read | Exceptionally defended (SG-1/SG-3 accounting mutations all caught); findings -008/-009/-010/-011 are at the seams the defenses don't cover |
| conductor/adapter/router-client.ts (241 ln) | read whole; R-MUT-2 run to FULL gate; production-caller census by grep | 100% read | Fail-soft plumbing fine; shape guard decorative (-004); half the surface is production-dead and the §4.4 story it claims is unimplemented (-001/-002/-012) |
| conductor/tests/fanout.test.ts (751 ln) | read whole; used as mutation oracle | 100% read | 8 rows honestly covered; gaps: create-error path, prompt-reject path, post-watchdog completions, hold×cap interplay (P12 list in -007) |
| conductor/tests/continuation.test.ts (5,024 ln) | title census of all 47 tests; ~12 tests read in full (signature, restart, transport floor, run-scoped conversions, latch, floor-discovery) | ~40% read line-wise, 100% of titles mapped | Strongest test file examined in this lane; one title overclaims (-008) |
| conductor/tests/router-client.test.ts (413 ln) | header/contract read; used as mutation oracle | ~30% read | Covers status/timeout/latch mechanics; no wrong-shape-JSON refusal case (proven by R-MUT-2) |
| conductor/tests/fixtures/fake-sdk.ts (377 ln) | read whole | 100% read | Faithful witness fixture; `error`-kind create reply exists but is exercised by no fanout test |
| conductor/plugin/index.ts | targeted read: journal wrapper (330-410), treeState (686-777), deps assembly (930-1010), tool binding (1060-1245), event hook (1397-1427) | ~35% (the parts wiring my scope) | createTreeState poll/unref/stop lifecycle sound; deps bundle missing `metrics` (-001) |
| conductor/adapter/journal.ts (285 ln) | read whole (for -005) | 100% read | log() throw paths identified; not otherwise assessed (other lane) |
| conductor/adapter/evidence.ts | targeted read: marker lifecycle (630-720, 800-896) | ~15% | Marker removal is finally-protected; liveness rule (pid + 24h) bounds holds; spawnSync verify blocks the loop (see cleared areas) |
| conductor/adapter/tools.ts | targeted read: setup HTTP/proofs (8600-8940), skeptic adjudication + review-fix dispatch (6160-6280), vet wave (3630-3705), report metrics seam (7321-7936 spot) | ~8% (the fan-out-facing sections) | dispatchWave call sites treat undefined values conservatively; retry wave is bounded; no double-dispatch found |
| scripts/test-conductor.sh | read whole (for -006) | 100% read | No timeout; otherwise correct TAP discipline |
| conductor/adapter/wire-notes.md | read whole | 100% | No §4.4 failover re-scope recorded (feeds -012) |
| docs/plans/…-conductor-harness-plan.md | §3.5-§3.9, §4.1-§4.4 read in full; other sections consulted via the briefing | scope-relevant sections | Conformance findings -003/-012 |
| conductor/adapter/state.ts | targeted read: archiveRun, saveItem, currentRun (555-610) | ~5% | archiveRun does not move the run dir (refutes an ENOENT theory in -005) |
| conductor/tests/setup.test.ts | one assertion consulted (line 1678) | spot | metricsPartial asserted set, never consumed (-002) |
| conductor/adapter/questions.ts, worktrees.ts, quarantine.ts, gitio.ts, chat-message.ts, inject.ts, config-io.ts, state.ts (rest), evidence.ts (rest), tools.ts (rest) | **not examined** beyond the call-signature level | — | other lanes own these |

---

## 6. Cleared areas

Attacked and could NOT break — with the attacks named:

1. **Watchdog-vs-completion double-resolve (charter question).** Attacks: removed the
   post-prompt `done` guard (MUT-1), traced every finish path under watchdog-fires-mid-create,
   -mid-prompt, -mid-retry interleavings. The `done` flag in `finish`, the idempotence of the
   Promise resolve, and `onDone` being attached once per job promise make a double-count of
   `inFlight`/`remaining` unreachable. CLEARED (with the -007 tail caveat: telemetry/economy
   after the abort, not accounting).
2. **The concurrency cap.** Attack: off-by-one mutation (MUT-3) — caught by a direct
   assertion; also traced the hold-release path for cap bypass (release pushes to the queue and
   goes back through the same `inFlight < maxReaders` pump — no bypass). CLEARED.
3. **The wave barrier.** Attacks: reasoned over `remaining` accounting for held, released,
   re-held, and failed jobs (each job reaches `onDone` exactly once); AABB grouping mutation
   judged directly asserted. Barrier holes found only via exogenous throws (-005), not
   scheduling. CLEARED for scheduling logic.
4. **Watchdog bounds create AND prompt (charter question).** Verified: armed before
   `session.create` (F1), one timer spans create + all prompt attempts; both hang shapes have
   direct tests; MUT-5 (arm-after-create) is detected — though only as a suite hang (-006).
   CLEARED on the property itself.
5. **Freeze-hold: double-dispatch and strand (charter question).** Attacks: sync-clear-race
   re-read (F3 handling is correct — registered-before-subscribe with the `released`
   idempotence flag and post-subscribe unsub); MUT-9 (release without pump) caught; re-freeze
   at release re-holds via the pump's re-check (no double-dispatch); traced production
   TreeState (40 ms poll + notifyClear + marker liveness). A held job cannot double-dispatch;
   a strand requires a foreign live-pid sub-24h marker whose holder is wedged (bound: 24 h;
   in-process verify is spawnSync and blocks the event loop, so an in-process marker can never
   coexist with a pumping wave). CLEARED, with the 24 h foreign-wedge bound noted as accepted
   design.
6. **The failover latch's own mechanics.** Attacks: caller census, herd-latch re-read
   (`useUpstream` checked before re-noting so N readers note one failover), `second === first`
   equality guard. The latch logic is right; what it is wired to is the finding (-012), not
   how it latches. CLEARED as a mechanism.
7. **The §3.7 accounting (futile counter, debounce, restart, transport floor).** Attacks:
   C-MUT-A (signature weakening) and C-MUT-B (restart charging) both caught by direct,
   well-aimed tests; the floor-discovery test (4831) derives the limit from the machine rather
   than restating it — P2-clean. The idle engine's accounting is the best-defended code in
   this lane. CLEARED (residual: the never-settling latch, -010, which is a missing bound, not
   wrong accounting).
8. **Leak hunt (charter requirement).** fds: none held (journal appendFileSync per call;
   router-client destroys sockets on timeout/error; unref'd timers). Child processes: the lane's
   three files spawn none (evidence spawnSync is synchronous and reaped). In-memory: registry
   entries deleted on finish (asserted); heldUnsubs deleted on release; found only
   `adjudicated` (IDEA-FC-2) and dead `pendingConversions` retention (-008). Process table
   checked clean after every mutation run. No unbounded ledger growth in scope (journal
   rotates).
9. **Flake sweep.** 20× fanout, 5× continuation, zero flakes (§4 table).
