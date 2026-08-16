# Enforcement Review — Part: The C++ llama-router

**Scope:** `router/` — main.cpp, router.hpp, admission.hpp, affinity.hpp, config.hpp, metrics.hpp,
cli.hpp, schema-observer.hpp, version.hpp, UPSTREAM_CONTRACT.md, and `router/tests/`.
**Date:** 2026-08-15
**Reviewer:** enforcement sub-reviewer (cpp-router lane)
**Method:** full-file reads, build + ctest, live-binary probing against a stub upstream, mutation
testing per briefing §4, read against plan §4.4 (proxy verbatim incl. SSE; admission cap → queue →
503 envelope; schema observation never enforcement; metrics ledger; G5 fail-soft).

Status: **COMPLETE.** 8 ISSUEs (4 MAJOR-graded, 4 MINOR), 6 IDEAs, 7 cross-lens pointers,
11 mutations (9 bound, 2 survivors — one disclosed, one redundant-code), 8 live probes
(1 reproduction), coverage ledger over every in-scope file, honesty audit clean of fabrication
but not of certified omission.

**Verdict in one paragraph:** the router's data path is the strongest-tested code in this
repository — nine of eleven mutations went red, the ordering laws are swept property-style, and
the G5 fail-soft direction survives every attack I could construct against the shipped config.
The defects live at the edges the tests cannot see: a liveness inversion under client-controlled
model keys (002, reproduced), a schema-contract seam no automated check ever crosses (003), a
promised-but-unbuilt 503 consumer (004), and — most seriously for a build whose currency is
evidence — a live-smoke artifact certified complete by a form-level gate while three of its
twelve assertion rows have nothing behind them and one wire-contract stamp cites an observation
that never happened (006/007).

---

## 1. ISSUE register

### CPP-ROUTER-001 — MetricsLedger's wait-sample vector grows without bound, and every /conductor/metrics poll sorts it under the ledger mutex

- **Where:** `router/metrics.hpp:137` (`waits_.push_back(entry.queueWaitMs)`), `:227-236`
  (`percentile()` copies and sorts the whole vector), `:240` (one mutex over ledger + counters).
- **Pattern:** the charter's "unbounded growth in any ledger or in-memory structure" (Part C,
  resource handling); cousin of C-087's leak class.
- **What happens:** `waits_` keeps one `int64` per request for the life of the process — it is
  never truncated, sampled, or windowed. `summary()` copies the whole vector and `std::sort`s it
  (O(N log N)) on every GET `/conductor/metrics`, while holding `mutex_` — the same mutex
  `record()` needs. `record()` is called from every request's `LedgerGuard` destructor, i.e. on
  httplib handler/connection threads.
- **Failure scenario:** a long-lived router (the supervisor loop restarts it only on crash;
  §4.4 expects it to live for the session) that has served ~10M requests holds ~80 MB of waits and
  every dashboard poll blocks all response completions for the duration of an 10M-element copy+sort.
  Nothing crashes; the router just degrades in proportion to its own uptime. The 90-run POC will not
  hit it, which is exactly why nothing has.
- **Independent of test coverage:** no test can catch this shape (it is a resource-envelope
  property); filing from code reading.
- **Severity:** MINOR today (POC-scale traffic), structural nuisance later.
- **Fix direction:** reservoir-sample or bucket the waits (fixed-size histogram gives exact-enough
  p50/p95), or at least sort incrementally / keep a sorted multiset with capped size.

### CPP-ROUTER-002 — Listener thread-pool sizing implements "maxInflightPerModel" as a single addend while admission caps per model KEY, which is client-controlled: distinct model strings exhaust the pool and starve /conductor/health — REPRODUCED LIVE

- **Where:** `router/config.hpp:280-298` (`taskQueueThreadsExactFor` = maxQueued +
  maxInflightPerModel + 8), `router/admission.hpp:293` (`inflight_` keyed by the request body's
  model string), `router/router.hpp:560-562` (pool sized once at start()).
- **Plan clause:** §4.4 / Task 11.4: "threads ≥ maxQueued + **Σ maxInflightPerModel** + 8" — a sum
  over models. The config carries one number and the code adds it **once**, but the admission
  table grants `maxInflightPerModel` slots to *every distinct model string* it sees. The model
  string comes from the request body (`planForward`, router.hpp:820-822) and is unvalidated —
  SG-3 deliberately buckets junk under "" but *distinct* junk gets distinct buckets.
- **Recorded deviation (this is worse than recorded):** STATE.json task 11.4 records *"SG-2's
  thread budget uses config.admission.maxInflightPerModel directly rather than a sum over models:
  §2.2 carries ONE scalar per-model cap, not a per-model map, so the plan's 'sum(...)' reduces to
  that scalar."* The reduction is only sound when the number of model keys is 1; the admission
  table itself contradicts that assumption for every additional distinct model string, and the
  deviation does not record the liveness consequence.
- **REPRODUCED (probe P-02, live binary + stub upstream, config maxInflight=1/maxQueued=0 →
  pool = 9 threads):**
  - 10 concurrent slow POSTs naming **10 distinct models** → all admitted (no 503s), pool
    exhausted, `GET /conductor/health` **timed out after 3s** (curl exit 28) and recovered only
    after the relays drained (then 200 in 0.6ms).
  - Control: the same 10 POSTs naming **one model** → 9 immediate `503`s, health answered
    `200 in 0.0007s` throughout. The starvation is caused precisely by the per-model bucketing,
    not by load.
- **Consequence:** SG-5 ("health answers while every slot and queue entry is held") and SG-6
  (models listing never stalls) are true for single-model saturation — the only shape the tests
  drive — and false for multi-model saturation. The supervisor's health probe would read a
  healthy router as down, triggering §4.4 failover for the rest of the session.
- **Related leak, same client-controlled key:** the 11.5 KNOWN MINOR (an `AffinityPolicy` map
  entry survives when a contended queue drains entirely by timeout) is bounded by "distinct model
  names ever contended" — which this shows is client-controlled, so it is a slow unbounded leak
  under adversarial model names, slightly worse than the deviation records.
- **Severity:** MAJOR as a liveness property inversion (reproduced), MINOR in the shipped G13
  deployment where one trusted client names one model.
- **Fix direction:** bound the number of distinct in-flight model keys, admit non-configured
  models under the "" bucket, or size the pool from a declared model list.


### CPP-ROUTER-003 — No automated check ever runs the C++ config parser against the CURRENT exported schema: the promised CMake pre-build export step was deferred at 11.1 and never landed, and the main gate has no ctest leg

- **Where:** `CMakeLists.txt` (router-tests target, lines 88-110 — no `export-schemas`
  custom command anywhere in the file); `scripts/test-conductor.sh:95-109` (exports schemas,
  never builds or runs router-tests); `docs/build/STATE.json` task 11.1 deviation: *"CMake
  pre-build custom_command for export-schemas deferred to 11.6 (when router-tests consumes the
  schemas); test-conductor.sh already regenerates them"* — 11.6 landed with no such step.
- **Pattern:** P7 (individually-correct rules composing into a hole) + P1. Rule 1: the Node gate
  regenerates `router/tests/schemas/*.json` but is a Node gate, so it runs no C++. Rule 2: ctest
  runs the C++ but reads whatever schema files sit in the **gitignored**
  `router/tests/schemas/` directory (confirmed: `git check-ignore` says IGNORED), i.e. whatever
  was last exported, whenever that was. Composition: **a change to core/types.ts's RouterConfig
  shape sails through the full gate green** (schemas re-exported, no C++ consumer executed),
  while `llama-router` in production validates its §2.2 config against the newly-exported file
  and can refuse to start — or accept a shape the committed C++ range checks never anticipated.
  Conversely, ctest run standalone (the documented verification command in the briefing §1) can
  quietly test against a stale schema.
- **Also:** a fresh clone that follows the briefing's own build instructions (`cmake --build …
  --target router-tests llama-router` then ctest) has an EMPTY schemas directory — config_test
  resolves `schemas/RouterConfig.schema.json` from `__FILE__` (config_test.cpp:125-129) and
  fails on a missing file, so the documented C++ verification path does not work from a clean
  checkout without first running the unrelated Node gate. `conductor_wiring.py:470` knows this
  ("a fresh clone simply does not have one") for the *production* path but nothing repairs the
  *test* path.
- **Record honesty angle:** the 11.1 deviation explicitly promises the step at 11.6; 11.6's
  recorded deviations (C-046) do not mention it. An unclosed deferral is invisible unless someone
  diffs deviation text across tasks — nothing re-derives that a deferred step eventually landed.
- **Severity:** MAJOR as an enforcement gap (the schema contract between layers 1 and 2 is
  guarded by nothing that runs automatically), MINOR in immediate blast radius (the shape is
  stable).
- **Fix direction:** add the promised `add_custom_command`/`add_custom_target` pre-build step
  invoking `node conductor/tools/export-schemas.ts router/tests/schemas`, and/or give
  `scripts/test-conductor.sh` an optional ctest leg that runs when the build directory exists.

### CPP-ROUTER-004 — §4.4's "a JSON error the fan-out engine understands (it backs off and retries; bounded)" has no consumer: nothing on the TS side parses the 503 admission envelope or discriminates queue_timeout from queue_overflow

- **Where:** `router/admission.hpp:53-58` (envelope constants), `router/router.hpp:1232-1236`
  ("`code` carries the discriminator the fan-out side acts on"); TS side:
  `conductor/adapter/router-client.ts` (health probe + failover latch + metrics fetch ONLY — no
  503 handling), `conductor/adapter/fanout.ts` (zero references to 503, the envelope type
  strings, or the router at all; verified by grep).
- **Plan clause:** §4.4 lines 1647-1649: "Queue overflow or timeout ⇒ 503 with a JSON error
  the fan-out engine understands (**it backs off and retries; bounded**)."
- **What holds / what doesn't:** the router's half is implemented and well-tested (SG-1 envelope,
  three string codes). The fan-out half — an envelope-aware backoff-and-retry — does not exist.
  Fan-out traffic reaches the router through opencode's provider fetch, so a 503 surfaces as
  whatever opencode's error path does with it; conductor's own code never sees, parses, or acts
  on `queue_timeout` vs `queue_overflow`. The C++ comment asserting "the discriminator the
  fan-out side acts on" is a P4-shaped claim about a consumer that was never built.
- **Consequence:** under saturation, shed requests become opaque sub-session failures instead of
  the bounded-retry behaviour the plan promises; the two distinct codes (retry-may-work vs
  already-full) inform nobody.
- **Severity:** MAJOR for spec conformance (identifier-position reading of §4.4), though the
  practical exposure is bounded because serve.py derives `maxInflightPerModel` from the same
  number as `--parallel`, making 503s rare in the shipped configuration.
- **Cross-lens:** the missing consumer belongs to the TS fan-out subsystem's reviewer; recorded
  here because the router's comments claim the consumer exists.
- **Fix direction:** either implement envelope-aware retry in the fan-out engine, or amend the
  comments/HONEST-LIMITS to say the codes are diagnostic only.

### CPP-ROUTER-005 — config_test/admission_test's schema-path fallback walks to a directory that no longer exists (`src/tests/schemas/`): dead code that would resolve WRONG if the primary resolution ever failed

- **Where:** `router/tests/config_test.cpp:140` and `router/tests/admission_test.cpp:512`
  (`dir / "src" / "tests" / kRelative`); the schemas actually live at
  `router/tests/schemas/` (the C++ tree was hoisted out of `src/`; the briefing itself notes
  plan §1.1's layout is stale). `schema_observer_test.cpp`'s `repoPath` (line 363-391) does it
  correctly by walking for the real relative path.
- **Pattern:** P12 (a path nothing has ever walked) + P3 (two spellings of the schema location,
  one stale). The primary `__FILE__`-based resolution always succeeds under CMake's
  absolute-path compilation, so the fallback has never executed; if it ever does (a build system
  compiling with relative paths, or a moved tree), it searches a directory that cannot exist and
  the suite fails with a misleading "expected location" message pointing beside `__FILE__`.
- **Severity:** MINOR (latent, test-infrastructure only).
- **Fix direction:** make both files use schema_observer_test's `repoPath` idiom, or delete the
  fallback.

### CPP-ROUTER-006 — Task 11.8's committed live-smoke artifact proves NOTHING for at least three of its twelve assertion rows, its own "does NOT discharge" list omits them, and the M8 gate passed on artifact form rather than row coverage

- **Where:** `docs/build/artifacts/11.8-live-smoke.md` (211 lines, sole content of commit
  `2e3dd96`, byte-identical at HEAD — verified via `git show 2e3dd96 --stat`);
  `docs/build/specs/task-11.8.assertions.json` (12 rows); `docs/build/GATES.json` taskGates/11.8.
- **Pattern:** P13 (a named row proven by nothing) at its purest, plus P9. The artifact drove
  exactly THREE requests through the router (its own ledger table says so: `GET /v1/models`, two
  non-stream POSTs). Row by row:
  - **`11.8-streaming-live`** — demands a `"stream": true` request via `curl -N` with visible
    arrival times, incremental `data:` chunks and `data: [DONE]` framing. The artifact contains
    **no streamed request of any kind** (grep for "stream" matches only prose about non-stream
    responses). Nothing behind the row.
  - **`11.8-failsoft-equivalence`** — "LIVE G5, **the load-bearing one**": replay the constrained
    request byte-identically at the direct upstream and paste both transcripts side by side. The
    only direct-upstream call in the artifact is `curl http://127.0.0.1:8080/health`. No replay,
    no side-by-side, nothing behind the row. This is the same G5-equivalence evidence class as
    C-089, one task over.
  - **`11.8-models-and-404`** — demands `curl -sS -i http://…/v1/models` pasted verbatim AND a
    pasted 404 for the upstream's own `/health` path through the router. The models call exists
    only as one line of prose ("returned the upstream's model list verbatim"); the 404 probe is
    entirely absent (zero matches for "404" in the file).
  - **`11.8-binding-not-discharged`** — demands a NEW `## Task 11.8 — live smoke` section
    APPENDED to router/UPSTREAM_CONTRACT.md. Commit 2e3dd96 touched only the artifact; no such
    section ever existed in UPSTREAM_CONTRACT.md's history (verified across all five commits of
    that file). The row's *spirit* (don't overclaim Step 2) was honoured in the artifact's
    closing section; its letter was not performed.
  - **`11.8-m8-artifact`** — demands "every version and path is the observed one (llama-server
    build line, model id, **router git sha, curl version**)". The artifact has the first two and
    neither of the last two.
- **The honesty mechanism missed it:** the artifact's "What this run does NOT discharge" section
  lists the slot count, autoload latency, SG-E and the dashboard — and does NOT list the
  streaming probe, the equivalence probe or the 404 probe, so a reader (and the gate) sees a
  complete-looking record.
- **The gate sealed it:** GATES.json M8 for 11.8 passed on "verbatim command lines, raw output
  and exit codes" plus a re-run of the router health leg. Nothing adjudicated the artifact
  against the row list; M4's note says "the live half has no red — M8 governs", so no mechanism
  ever compared rows to evidence.
- **Severity:** MAJOR (build-record honesty). The router's SSE relay IS well-proven by doctests
  (proxy_test's gated two-chunk cases) — what is missing is the live, stub-free form the rows
  exist to force, and the record claiming it exists when it does not.
- **Fix direction:** re-run the smoke with the three missing probes appended to the artifact (30
  minutes with a live model), or amend the artifact's does-not-discharge list and the row ledger
  to say honestly what was not observed.

### CPP-ROUTER-007 — UPSTREAM_CONTRACT's WIRE_CONTRACT_VERIFIED stamp cites "SSE chunk framing observed at 11.8" to an artifact that contains no streamed request, and the test guarding the stamp checks only that the cited PATH EXISTS

- **Where:** `router/UPSTREAM_CONTRACT.md:3` ("all six Step 2 items observed; items **1-4 at
  11.8**"), `:17-22` (`STEP2_ITEM_4: 11.8 docs/build/artifacts/11.8-live-smoke.md`), `:32-36`
  ("Items 1–4 … were observed at Task 11.8 and are recorded in …/11.8-live-smoke.md");
  `scripts/test_conductor_wiring.py:1477-1488` (the STEP2_ITEM check).
- **Pattern:** P9 (evidence that is a tautology — a citation whose target cannot support it)
  compounded by P1 (the guard inspects less than it appears to): the wiring test asserts the
  STEP2_ITEM marker names a task and an evidence path and that **the path exists** — never that
  the file contains the claimed observation. `STEP2_ITEM_4` (SSE chunk framing for streamed
  responses) is therefore green while pointing at a file with **zero streamed requests** (see
  CPP-ROUTER-006). The artifact's own closing list even names only THREE observed items ("the
  /v1/models shape…, response_format acceptance with GBNF constraining, and usage+timings on a
  non-stream response") — the "items 1-4" phrasing appears to have been inherited from C-041's
  *expectation* ("it observes four of the six items"), written before the smoke ran: prose
  matched against prose, the P10 lesson again.
- **Consequence:** the wire-contract record — the thing Task 0.2/11.1 exists to make trustworthy —
  certifies an SSE framing observation that never happened. A future engineer relying on the
  stamp (e.g. changing the SSE relay and consulting the contract for llama-server's real framing)
  has no recorded live observation to consult.
- **Severity:** MAJOR (evidence integrity), MINOR practical (doctests cover the relay against
  stub framing; llama-server's real framing remains unobserved-but-claimed).
- **Fix direction:** observe SSE live once and record it; make the STEP2_ITEM check grep the
  cited artifact for the item's load-bearing marker (e.g. "text/event-stream" + "data: [DONE]"
  for item 4), so a citation must be supported by content, not existence.

### CPP-ROUTER-008 — Row `11.8-upstream-recorded` anticipates the serve.py/qwen3.6-27b upstream; the smoke ran a hand-started ornith-9b with flags serve.py never emits — honestly disclosed, but the row's letter and the record disagree

- **Where:** `docs/build/specs/task-11.8.assertions.json` row 11.8-upstream-recorded (demands
  recording "the `scripts/serve.py --no-shell` invocation (or, per SG-H, the already-running
  server that was reused) … the model id (qwen3.6-27b per §8.4)");
  `docs/build/artifacts/11.8-live-smoke.md:28-31` (direct `--model` start of **ornith-9b** with
  `--parallel 4`, which the row notes serve.py notably does NOT pass).
- **Pattern:** P8-lite. The provenance-recording intent is satisfied (the artifact records
  exactly what ran); the row's named expectations (serve.py vehicle, G13 model) are not what
  happened, and no deviation note reconciles them. Every conclusion drawn from the smoke
  (constrained output works, conformance discriminates) is therefore evidence about ornith-9b,
  not about the model conductor actually runs — F1-CONFIRMED in UPSTREAM_CONTRACT.md later showed
  the G13 model behaves WORSE (1024 tokens of thinking, empty content), which is exactly the kind
  of divergence the row's model pin existed to catch earlier.
- **Severity:** MINOR (disclosed in substance, unreconciled in form).

---

## 2. IDEA register

### IDEA-CPP-01 — Bind the no-re-encoding relay property with one header assertion

Origin: mutation M-01 (replacing `sendBuffered`'s fixed-length content provider with plain
`response.set_content`) left all 92 test cases / 27,726 assertions green — exactly as the 11.3
deviation predicted ("tests would have passed either way"; httplib clients decompress
transparently, so byte-equality can't see compression).
Kind: test-maintainability.
Value: the property that justified the content-provider design (never gzip/brotli bytes the
upstream chose, never mint Content-Encoding/Vary) is currently enforced by nothing; one test that
sends `Accept-Encoding: gzip, br` with a compressible-sized stub answer and asserts the response
carries NO `Content-Encoding` header would bind it. (Probe P-05 confirmed the property holds
today.)
Cost: ~15 lines in proxy_test.cpp.
Relates to: mutation table M-01.

### IDEA-CPP-02 — Replace MetricsLedger's unbounded wait vector with a fixed-size structure

Origin: CPP-ROUTER-001. A bounded histogram (1ms/10ms/100ms buckets) or reservoir gives p50/p95
within tolerance at O(1) memory and O(buckets) summary cost, removing both the growth and the
sort-under-mutex.
Kind: efficiency. Cost: ~40 lines. Relates to: CPP-ROUTER-001.

### IDEA-CPP-03 — The "non-stream" predicate for response validation is "has Content-Length", not "is not an event stream"

Origin: reading `relayToUpstream` (router.hpp:948-949): a chunked NON-SSE JSON response (no
Content-Length, no text/event-stream) takes the incremental path, so `observe_response` never
runs and the verdict is null even though the body is a single buffered-able JSON document.
llama-server always sends Content-Length on non-stream responses, so this is unobservable today.
Kind: polish/docs — worth one comment line where `incremental` is computed, so a future upstream
that chunks non-stream JSON doesn't silently zero the conformance dataset.
Cost: comment only. Relates to: standalone.

### IDEA-CPP-04 — Admission gates on `method == POST`, not on "generation call"

Origin: reading handleProxy (router.hpp:726-730). PUT/PATCH/DELETE/OPTIONS to /v1/* are proxied
un-admitted (only POST is admitted). Today's upstream has no bodied non-POST /v1 routes, so this
is inert; if llama-server ever grows one, it bypasses the cap silently.
Kind: polish (comment or a `isAdmittedMethod` helper naming the assumption).
Cost: trivial. Relates to: standalone.

### IDEA-CPP-05 — hasFreeSlot's queued-waiter scan is provably redundant; say so or delete it

Origin: mutation M-03 (deleting the scan) left the suite green. Grants happen inside `release()`
under the same mutex, so the "an arrival must not overtake the queue head" state the scan defends
against cannot exist outside the lock. Either delete it (grantNext is the single grant path) or
re-comment it as belt-and-braces, so the next reader doesn't infer a reachable race from it.
Kind: naming/docs. Cost: trivial. Relates to: mutation table M-03.

### IDEA-CPP-06 — STEP2_ITEM citations should be content-checked, not existence-checked

Origin: CPP-ROUTER-007. `test_conductor_wiring.py` already greps UPSTREAM_CONTRACT for
load-bearing strings (it caught the earlier autoload mismeasurement via `--models-max`); the same
idiom applied to each STEP2_ITEM's cited artifact (item 4 → "text/event-stream" AND "[DONE]")
closes the path-exists loophole for ~10 lines each.
Kind: tooling. Relates to: CPP-ROUTER-006/007.

---

## 3. CROSS-LENS POINTERS

- **TS fan-out (enforcement, other subsystem):** no code in `conductor/adapter/fanout.ts` or
  `router-client.ts` parses the router's 503 admission envelope or discriminates
  `queue_timeout`/`queue_overflow` — §4.4's "the fan-out engine understands (backs off and
  retries; bounded)" is unimplemented on the consuming side (CPP-ROUTER-004 carries the detail).
- **TS router-client (enforcement, other subsystem):** `router-client.ts:220` casts the parsed
  /conductor/metrics object `as MetricsSummary` without validating — a P3 restatement of the six
  summary keys with no drift guard on the TS side (the C++ tests pin the names; nothing compares
  the two languages' literals mechanically). Same for `x_conductor`
  (wire-markers.ts:17 vs router.hpp:78) and the four X-Conductor-* header names
  (inject.ts:239-245 vs router.hpp:99-102): each side pins its own copy; no test compares them.
- **Wiring/scripts subsystem:** `scripts/test_conductor_wiring.py:1477-1488`'s STEP2_ITEM check
  is a live P1 instance (path-exists as proxy for evidence-exists) — the wiring reviewer should
  sweep that file for siblings.
- **Meta-audit (Part E):** the "items 1-4 at 11.8" claim in UPSTREAM_CONTRACT.md appears to
  descend from C-041's pre-run *expectation* rather than from the artifact — prose matched
  against prose (the P10 lesson); worth checking whether other correction-derived claims were
  inherited into stamps the same way.
- **Macro lens:** UPSTREAM_CONTRACT.md doubles as a findings ledger (F1/F3/F4 are wiring
  decisions living in a router contract file); the macro review should decide where measured
  bindings like "the structured-output path must disable thinking" actually belong.
- **15.2 dashboard:** `dashboard/ledger_view.hpp` (659 lines) and `dashboard/main.cpp` (418
  lines) were NOT deep-read here (outside the named scope); dashboard_test.cpp (1,984 lines, 17
  rows, compile-time purity fences) was read at title/structure depth and looks strong. Someone
  should own those two files explicitly.
- **Ops/docs:** `docs/build/honest-limits-pending.md` is asserted by [11.6-shrunk-scope-note];
  Phase 15's HONEST-LIMITS.md should be checked to carry the same facts (not verified here).

---

---

## 4. Mutation table

Method: `cp` snapshot → edit → `cmake --build … --target router-tests` → run the full doctest
binary (92 cases / ~27.7k assertions at baseline) → restore from snapshot → `cmp` proof.
Baseline before and after the campaign: **100% green** (ctest + 10× flake sweep, zero failures).

| # | Mutation | File | Expectation | Result | Verdict |
|---|---|---|---|---|---|
| M-01 | `sendBuffered` replaced with plain `response.set_content` (httplib may then gzip/brotli and mint Content-Encoding) | router.hpp | GREEN per the recorded 11.3 deviation | **GREEN 92/92** | **NOT BOUND** — disclosed P11 gap confirmed; see IDEA-CPP-01 |
| M-02 | `resolvedPriorityClass` returns the tag verbatim instead of collapsing to interactive | router.hpp | RED | RED (1 case, [11.7-ledger-fields]) | BOUND |
| M-03 | `hasFreeSlot` queued-waiter scan deleted | admission.hpp | uncertain | **GREEN 92/92** | NOT BOUND — analysed as provably redundant (grants happen inside release() under the same mutex); IDEA-CPP-05 |
| M-04 | `recordObservation` stops incrementing `schemaMissingCount_` | router.hpp | RED | RED (6 cases, 28 asserts) | BOUND |
| M-05 | `percentile()` always returns `sorted[0]` | metrics.hpp | RED | RED (1 case, 4 asserts, [11.7-metrics-aggregates]) | BOUND |
| M-06 | streamed relay frames an upstream mid-body failure as a clean end (`sink.done()` instead of abort) | router.hpp | RED | RED (1 case, [11.3-upstream-truncated-stream]) | BOUND |
| M-08 | `planForward` re-serializes every JSON object body (byte-verbatim law broken) | router.hpp | RED | RED (8 cases, 25 asserts) | BOUND — strongly |
| M-09 | `kProxyPathPattern` narrowed to `/v1/chat/.*` | router.hpp | RED | RED (7 cases, 16 asserts) | BOUND |
| M-10 | affinity burst ceiling removed (`arrival > queuedThrough` check deleted — a busy group could starve neighbours) | affinity.hpp | RED | RED (1 case, 7 asserts, [11.5-fair-interleave]) | BOUND |
| M-11 | any engaged schema tag value counts as tagged (drop the `== "required"` predicate) | schema-observer.hpp | RED | RED (1 case, 8 asserts, [11.6-untagged-untouched]) | BOUND |
| M-13 | maxQueued clamp made silent (warn deleted) | config.hpp | RED | RED (2 cases) | BOUND |

Live probes (built `llama-router` binary + Python stub upstream on ephemeral ports; all spawned
processes killed and verified gone):

| # | Probe | Result |
|---|---|---|
| P-01 | `GET /v1/models?probe=q1&x=%20y` through the router | stub saw the raw target verbatim, percent-encoding untouched — query strings survive (`request.target` path works; no test covers this) |
| P-02a | 10 concurrent slow POSTs, 10 DISTINCT models, pool = 9 threads | **`/conductor/health` starved** (curl exit 28 after 3s), recovered post-drain — CPP-ROUTER-002 reproduced |
| P-02b | control: same load, ONE model | 9× immediate 503, health 200 in 0.7ms throughout |
| P-03 | `/v1`, `/v1x`, `/conductor/other` | all 404, zero upstream contact — pattern boundary as documented |
| P-04 | `HEAD /v1/models` | 200; forwarded upstream as HEAD (httplib routes HEAD via Get handlers) — un-admitted, ledgered |
| P-05 | `Accept-Encoding: gzip, br` on a proxied GET | response carries NO Content-Encoding — verbatim relay holds today (unbound; see M-01) |
| P-06 | flake sweep: full binary 10× sequential | 10/10 SUCCESS, zero flakes |
| P-07 | `node conductor/tools/export-schemas.ts` to scratch, `diff -rq` vs `router/tests/schemas/` | identical — the gitignored schemas are currently fresh (does not repair CPP-ROUTER-003's structural gap) |

---

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion / IDs |
|---|---|---|---|
| router/main.cpp (119) | read in full | 100% | thin adapter, exit codes 0/2/3/4 as documented; signal handling async-safe; clean |
| router/router.hpp (1,389) | read in full; 6 mutations; 5 live probes | 100% | core relay sound; produced 001(context), 002, 004(comment), M-01 gap |
| router/admission.hpp (332) | read in full; 1 mutation; probes P-02a/b | 100% | ordering laws bound; per-model-key liveness hole → 002; M-03 redundant scan |
| router/affinity.hpp (201) | read in full; 1 mutation | 100% | pure policy, laws bound (M-10); 11.5 policies_ leak re-assessed under client-controlled keys (in 002) |
| router/config.hpp (520) | read in full; 1 mutation | 100% | parse/validate/clamp sound; overflow handling (C-038 fixes) verified present; 003 (schema wiring) |
| router/metrics.hpp (253) | read in full; 1 mutation | 100% | exactly-once + fail-soft sound; unbounded waits_ → 001 |
| router/schema-observer.hpp (289) | read in full; 1 mutation | 100% | observe-never-enforce sound; predicate bound (M-11) |
| router/cli.hpp (149) | read in full | 100% | pure parse, refusal contract complete; clean |
| router/version.hpp (14) | read in full | 100% | single version constant, asserted by health test |
| router/UPSTREAM_CONTRACT.md (363) | read in full; stamp claims re-derived against cited artifacts and git history | 100% | → 007, 008; F1/F3/F4 cross-lens |
| router/tests/proxy_test.cpp (1,307) | read in full | 100% | exemplary suite (genuine-short-read pre-proof); target of M-06/M-08/M-09 |
| router/tests/admission_test.cpp (1,714) | read in full | 100% | thorough; stale `src/tests` fallback → 005 |
| router/tests/affinity_test.cpp (1,246) | read in full | 100% | property sweeps + live-Router row; M-10 target |
| router/tests/schema_observer_test.cpp (1,619) | read in full | 100% | C-046 closure verified present; M-11 target |
| router/tests/metrics_test.cpp (2,469) | read in full | 100% | C-033/C-049 closures verified present; M-02/M-05 targets |
| router/tests/config_test.cpp (476) | read in full | 100% | stale fallback → 005; single-source proof is real (relaxed-schema counter-case) |
| router/tests/cli_test.cpp (310) | read in full | 100% | C-051 alone-ness closure present |
| router/tests/dashboard_test.cpp (1,984) | headers + all 17 case titles + purity fences read; bodies skimmed | ~40% | looks strong; subject files outside scope — cross-lens pointer filed |
| router/tests/scaffold_test.cpp (10) | read in full | 100% | doctest main owner |
| dashboard/ledger_view.hpp, dashboard/main.cpp | **not examined** (outside named scope) | 0% | cross-lens pointer filed |
| docs/build/specs/task-11.{2..8},15.2.assertions.json | all row ids enumerated; 11.8's twelve row texts read in full; C++ rows diffed against TEST_CASE ids (digit-aware grep) | rows 100%, texts ~60% | every 11.2-11.7 row + 15.2 row has a same-named TEST_CASE; 11.8's live rows → 006 |
| docs/build/artifacts/11.8-live-smoke.md (211) | read in full; claims re-derived vs git history | 100% | → 006, 007, 008 |
| CMakeLists.txt (router targets) | targeted read | router sections | → 003 (missing export-schemas pre-build step) |
| scripts/serve.py + conductor_wiring.py (router wiring) | targeted reads (launch argv, config generation, STEP2 check) | ~15% | generate_router_config conforms to §2.2; STEP2 path-only check → 007; rest belongs to the wiring reviewer |
| STATE.json / GATES.json / CORRECTIONS.md (11.x slices) | targeted reads | 11.x entries | deviations cross-checked; unclosed 11.1→11.6 deferral → 003 |

**Assertion-row enumeration verdict (Part G #5, scoped to router tasks):** 11.2 (6/6), 11.3
(10/10 + 2 extra truncation cases), 11.4 (8/8 + 4 fix-rows), 11.5 (7/7), 11.6 (13/13), 11.7
(16/16 incl. the C-049 orchestrator addition), 15.2 (17/17) — every row has a same-named
TEST_CASE in the C++ suite. 11.8: 1/12 rows is a doctest (cli-contract, present); 11 are
live-manual, of which **at least 3 have nothing behind them** (CPP-ROUTER-006) and 2 more are
partially met (008, m8-artifact clauses).

---

## 6. Cleared areas — attacked and not broken

- **Byte-verbatim relay** (the G5 core): attacked by M-08 (8 cases red), P-01 (query strings +
  percent-encoding verbatim), P-05 (no minted Content-Encoding), and the suites' non-canonical
  body fixtures. Holds; the only unbound corner is compression re-encoding (M-01 → IDEA-CPP-01).
- **Observe-never-enforce**: attacked by M-11 and by reading every refusal site — the ONLY
  router-minted statuses are the two 502 shapes, the admission 503s, and the opt-in 400 (default
  false, pinned by test and by serve.py's generator). Confirmed: no request the direct path
  serves becomes an error under the shipped config.
- **Mid-body truncation honesty** (buffered → own 502, streamed → aborted chunk framing): M-06
  went red on the exact case; the test suite pre-proves its stub produces a genuine short read
  before using it — a self-refutation-quality fixture.
- **Admission ordering laws** (priority classes, FIFO-within-class, burst contiguity, untagged
  never advanced, toggle inert): M-10 red; the affinity suite additionally sweeps 200 random
  arrival sequences per law and permutes queue storage against ordinal ties.
- **Single-model pool exhaustion** (SG-2/SG-5, the shape the tests drive): health and metrics
  answer at a full queue; reproduced live in probe P-02b. (The multi-model shape is NOT cleared —
  CPP-ROUTER-002.)
- **Exactly-once ledger accounting** across all five exit paths, including the pre-admission 400
  and the mid-stream client disconnect; concurrent-append tearing hammered by 6×40 module writes
  + 8-way e2e. Clean.
- **Config validation**: unknown keys, bad ports, fractional/negative/overflow admission
  integers, silent-clamp (M-13 red), single-source schema proof via a relaxed-schema counter-case.
  Clean.
- **Crash/teardown lifetimes**: UpstreamCall's destructor cancel→stop→join discipline read
  end-to-end; the disconnect-mid-stream test drives it; 10× flake sweep saw no leaks or hangs; no
  stray processes after all probes (`ps` verified).
- **Enforcement posture (Part A, scoped):** the router accepts nothing from a model on trust —
  every number it reports (counts, waits, verdicts) is derived from traffic it relayed itself.
  The enforcement findings in this lane are therefore all about the BUILD RECORD (006/007/008),
  not the data path.

## 7. Honesty audit (scoped)

Checked: STATE.json 11.1-11.8 deviations against the tree (one unclosed deferral → 003);
GATES.json taskGates/11.8 M8 adjudication against the artifact (→ 006); commit 2e3dd96's actual
content vs its manifest string (matches; artifact-only); UPSTREAM_CONTRACT.md's stamp citations
against the cited artifacts' contents (item 4 false → 007) and against its own git history (no
11.8 section ever existed → 006); the 11.8 artifact's internal ledger/summary arithmetic
(reconciles: 462=120+342, 50=25+25, rate 0.5 — genuine); exported schemas vs a fresh export
(identical). **Fabrication found: none** — the failures found are omissions certified as
completeness (006/007), not invented outputs. Every number I checked inside the 11.8 artifact is
internally consistent, which is precisely why the missing probes were invisible to a form-level
gate.
