# Fix Campaign — per-item record

Plan: `docs/build/fix-campaign-plan.md`. One entry per landed item: what landed, the observed
evidence, the verifier's verdict, residuals and where they were routed. Entries are terse and
factual; design rationale lives in the plan and the decision record, not here.

---

## Phase 0.1 — D14 addendum amendment · commit 31456bc
A3–A6 constraints, the five-file tool-addition map at 17.3/18.1, dependency gates on 17.4
(GAP-021) and 17.5 (ISSUE-001). Document work only.

## Phase I.1 (gate half) — GAP-035 / ISSUE-032 · commit f6c0fdd
`scripts/test-conductor.sh`: `--test-timeout=120000` on the node leg; a failing exit preserves
the leg scratch dir at a printed durable path instead of deleting it. Both paths exercised
before commit (zero-glob red preserved evidence + exited 1; scoped green cleaned up).

## Phase I.1 (TS half) — GAP-035 / ISSUE-134 P14 root
- **Landed:** `adapter/clock.ts` (strictly-increasing sub-ms epoch clock, injectable sources;
  `stampResolutionMsOf`); `capturedRedOf` recency = ledger APPEND POSITION, never seq value;
  torn ledger line forces `stale` (skipped for choosing, counted for recency);
  `core/freshness.ts` §2.6 tie decided by `stampResolutionMs` DATA (precise stamp ⇒ tie is
  stale; coarse stamp keeps equality-counts-fresh); one clock instance wired through the
  plugin ToolDeps bundle + continuation hook; `fanout.test.ts` `makeConfig` default
  `subSessionTimeoutMs` 900_000 → 60_000 (ISSUE-032's runner-stall tail).
- **Evidence:** red observed at assertion level by reverting both comparisons (fail=3);
  green 9/9 scoped; full gate 1391/1391 ×3 (implementer, verifier, orchestrator). Load-bearing
  mutation (seq-value comparison restored) re-run independently by verifier AND orchestrator:
  fail=2 each; restores hash-verified (`git diff` sha256 b512669b… identical before/after).
- **Verifier verdict:** CONFIRMED. Core layering clean (no clock/I-O entered core).
- **Honest limit:** the live P14 flake never reproduced (~70 min under 24–28 burners, 250
  harness runs). The claim on record is "the two load-sensitive comparisons ISSUE-134 names
  are no longer load-sensitive," not "the observed flake was watched to die."
- **Residuals routed:** seq minting is still read-max-plus-one (ISSUE-026 — Phase IV.2 owns
  it; capturedRedOf no longer consumes seq for recency, but future consumers inherit the
  collision). Torn line is a whole-ledger flag: one crash artifact costs one extra
  re-establish per vet for the run's life (cost, fail-safe direction; rides GAP-024).
  Stamp resolution is inferred from the value rather than persisted on the record (~1e-6
  per-stamp chance a precise stamp self-reports coarse; degrades lenient — sounder as a
  persisted field if the record schema is ever touched again).
- **New observation (not in any register):** `[G14-gitio]` — under heavy load, bun 1.3.14's
  `execFileSync("git rev-parse HEAD")` returned EMPTY stdout inside `bun-smoke.test.ts`'s
  own git helper while the adapter's `headSha()` was correct; one bun-leg gate failure,
  evidence preserved at the gate's durable path. Watch for recurrence; not scheduled.

## Phase I.3 — ISSUE-088 stripComments canary
- **Landed:** one shared string/template/regex-aware `stripComments` at
  `conductor/tests/fixtures/strip-comments.ts` (both private quote-blind copies deleted);
  8 tests incl. three whole-tree canaries (no shipped file loses a CODE line, every tail
  survives, the original witness site is readable). Measured blast radius at HEAD before
  the fix: 150 blanked code lines in `core/gates-edit.ts`, 189 in `adapter/tools.ts`.
- **Widened-view sweep:** zero real violations in the newly visible ~340 lines — the one
  newly seen journal site (`config.updated`, tools.ts:9276) is a legal, listed event.
  Cross-checked against a real TS 5.9.3 parse over all 104 files: 0 code chars blanked,
  0 comment chars kept. Register drift noted: file is `core/gates-edit.ts` (register said
  adapter/), ranges shifted; defect reproduced exactly.
- **Evidence:** TDD red 6/8 → green 8/8; full gate 1404/1404 (implementer) + orchestrator
  mutation re-run (quote-branch neutered → fail=6; restore hash-identical) + full gate.
- **Verification note:** the stage's adversarial verifier never ran (see incident below);
  orchestrator verification substituted. The implementer itself caught and fixed a
  non-load-bearing regex assertion via mutation testing mid-stage.
- **Incident:** the machine SLEPT mid-workflow — the I.4a wiring agent died mid-response
  ("computer went to sleep"); the canary had already finished; no partial wiring edits
  reached the tree (verified: only the four canary files present). `caffeinate -is`
  (pid noted in session) now pins the machine awake for the campaign's remainder; the
  wiring stage resumes from the workflow cache.

## Phase VII-A — the build floor (audit/structural layer)
- **Landed (VII.1):** `core/wiring-manifest.ts` + test — declares all six composition-root
  hooks + the tool binding + module wires; two-way parity asserts every declared wire is
  registered and every registered hook is declared, and every CONDUCTOR_TOOL_NAMES member has
  a non-fallback ToolSpec (MACRO-025b). This is the mechanism that catches ISSUE-001 (dead
  injection) on day one — verified: unregistering a hook turns it red. `core/vocab-registry.ts`
  + test — pins stopKinds/runStates/itemStates/roles and parity-checks the TS, JSON-schema, and
  Python copies (D15c: pins the plan-frozen spellings, does not replace them); a cross-language
  drift (python STOP_KINDS rename) goes red (ISSUE-113 class).
- **Landed (VII.2):** GAP-020 unreachable-exports audit (`export-graph.ts` fixture +
  `unreachable-exports.test.ts`) — flags any conductor/{core,adapter,plugin} value export with
  no non-test importer; it found and DELETED two genuinely dead exports (STOP_KIND_PRODUCERS,
  answerFilesOnDisk). GAP-017 full inversion (`scan-universe.ts` — every scanner asserts its
  walked file-set covers the git-tracked universe minus explicit exemptions, so a shipped file
  outside the enumerated dirs is a red not a blind spot); journal-vocab/legaltools-callsites/
  source-hygiene converted. GAP-019 discrimination witnesses — every converted/new check feeds
  a known-bad fixture and asserts it reports the violation (no decorative checkers).
- **Evidence:** gate 1770 → 1788/1788; verifier CONFIRMED, no defects, all mutations
  reproduced red + restored; orchestrator re-ran the ISSUE-001-shape hook-unregister mutation
  (manifest red, restore hash-identical).
- **Deferred (owner):** M5 scanner lives in scripts/conductor-gate.sh (off-limits; already
  git-ls-files-based with count floors — reported, unedited). tools.ts split stays a
  Phase-16-planning decision (D2).

## Phase V (non-live) — doctrine content + pre-live readiness
- **Landed (V.1, committed f33b95b):** GAP-037 generated run-shape playbook in core.md (no
  hand-listed tools); GAP-042 generated "measured limits" in decompose.md derived from
  core/planning.ts constants (ITEM_MAX_FILES, read-set budget), teaching the real size rule
  and dropping the falsified "law bends by path arithmetic" prose (ISSUE-012); GAP-043 uniform
  stuck-state protocol single-sourced into every pack's generated block; GAP-044 core.md ask
  policy reconciled with the mid-run surface/answer-file mechanism. Gate 1758/1758.
  (Salvaged: the workflow crashed on StructuredOutput serialization — the model packed all
  fields into `summary` with angle brackets — but the work and its gate run were complete;
  committed after an independent gate confirmation, verify folded into the V stage.)
- **Landed (V.2):** GAP-032 `core/preflight.ts` spec-currency go/no-go (keyed on
  verifiedAgainstHead vs HEAD + cited-file diffs) — the owner's ~2-min pre-13.2 check; GAP-033
  `checkLiveArtifact` binds SMOKE.md / conductor-report.md to runId + an evidence seq + a real
  command line + a content floor, before the artifacts exist. ISSUE-042 (D9) router pool-sizing
  liveness fix in `router/admission.hpp` — distinct in-flight model KEYS bounded so many
  client-controlled model strings cannot each seize maxInflightPerModel workers and starve
  `/conductor/health` (a single key keeps its full allowance). ISSUE-104 (reviews-upheld reads
  None/not-measured, not a fabricated 0), ISSUE-107 (cell PATH threaded through the spawnability
  preflight), ISSUE-108/-112 editable halves.
- **Evidence:** node gate 1769/1769; router-tests 93 cases / 27736 assertions SUCCESS;
  verifier CONFIRMED, all 6 load-bearing mutations reproduced red + inverse-restored.
- **Owner-owned follow-ups (serve.py / docs / live):** ISSUE-105 (serve.py session trap must
  drop INT/TERM so Ctrl-C doesn't abandon a live model), ISSUE-108 sleep-on-non-200 in
  wait_until_ready, ISSUE-106 main-launch test, ISSUE-078 (14.2 spec committed-path clause —
  couples to the live 14.2 run), and the 13.2 spec fanout.ts line-number bump — done by the
  orchestrator in this session's follow-on where editable, else handed to the 13.2/14.2 owner.

## Phase IV — security XS day + concurrency/crash + cheap fixes/honesty
- **Landed (IV.1 security):** git `-c` exec-config keys denied by git's own key-shape rules
  (exec sections + leaves) AND the equivalent env-var class (GIT_PAGER/EXTERNAL_DIFF/SSH/…,
  PAGER/EDITOR) (ISSUE-015); case-fold `.conductor` state-area deny at both the edit-path and
  interpreter-script sites (GAP-026/ISSUE-016); hyphenated git plumbing detected (ISSUE-019);
  `git branch` narrowed to list forms, bare creation + `--set-upstream-to=` denied (ISSUE-020);
  `checkout -p/--patch` denied (ISSUE-021); ISSUE-037 ask-gate wildcard precedence; D8:
  apply_patch/patch removed from WRITE_TOOLS, denied outright, wire-contract pin over the live
  offered-tool list; wrapper unwrap made iterative AND basename+case-fold resolved across
  env/nice/nohup/timeout/xargs/sudo and every command NAME (shells/interpreters/write-shapes),
  closing the `/usr/bin/ENV sh -c` and upper-case-spelling bypasses.
- **Landed (IV.2 concurrency, D6):** evidence attribution (writer identity on every record;
  readEvidenceAt refuses itemId/tree mismatch, ISSUE-027); an N-party single-writer lock
  (`state.ts`) — per-acquisition identity tokens, atomic compare-and-delete break rights
  (O_EXCL, identity-keyed), linkSync whole-record publication, self-verify, age/liveness
  reclaim of abandoned break rights (no permanent wedge), release keyed on token — real
  N-process races give exactly one writer (ISSUE-023/-024/-025/-026); `block-and-ask.ts`
  transactional primitive (GAP-028, ISSUE-100); tolerant ledgers + `jsonl.ts` (GAP-024);
  quarantine leak cleanup (ISSUE-029).
- **Landed (IV.3 cheap/honesty):** isHumanTerritory patterns narrowed (ISSUE-070, no more
  pub/sub false stalls); dead eviction `download_missing`/`fetch_model` deleted (ISSUE-110
  code); routerHealthy deleted, failover comments/headers corrected to "setup-probes-only,
  supervisor-restart" (D9/ISSUE-040), 503 codes marked diagnostic-only (ISSUE-041); Phase III
  residuals — route-aware receipt fallback for nested test layouts, `path:line` citation
  extraction, conductor_status AWAITING-OPERATOR-CONFIRMATION notice.
- **Doc fixes (orchestrator-owned):** scripts/README.md + docs/user/benchmarking.md eviction
  sections (ISSUE-110 prose); docs/developer/{core-and-adapters,scheduling-and-fanout}.md
  routerHealthy removed and §4.4 setup-probes-only framing added; conductor/docs/OPERATIONS.md
  run.lock shape. Historical spec assertion JSONs (task-7.2, task-12.1-G5) left as frozen
  records — spec currency is Phase VII.5's (GAP-030/-031).
- **Evidence:** gate 1553 → 1753/1753 across the phase; three fix rounds. Round 1 verdict
  PARTIAL → round 2 refuted the flock (real races made 2 writers 23/25) and rebuilt it as the
  N-party lock (0/210 real-process violations); round 3 closed the case-fold-command-names
  bypass, the break-right wedge, and added the atomic-publication guard. Verifier CONFIRMED
  R0/R1/R2 against the real round-3 code.
- **INCIDENT + recovery:** the round-3 verifier ran `git checkout -- state.ts` (a forbidden
  git write) to restore a mutation; the file was uncommitted, so it reverted to HEAD and
  destroyed the phase's lock rewrite in that one file. Recovered losslessly from the workflow
  transcripts: the fixer's full-file Read gave the round-2 baseline, replaying its 7
  construction Edits rebuilt round-3-final, and the gate returned to 1753/1753 with the
  real-process race clean (0 violations, 4 and 8 openers). Lesson recorded to memory; future
  workflow RULES forbid git checkout for mutation restore (inverse Edit only).
- **Residuals routed:** LD_PRELOAD/DYLD env prefixes + ISSUE-014/-018 wrapper-hiding are the
  enumeration class the GAP-025 flip closes (Phase VI, D7). capturedRedOf keeps its own jsonl
  reader (needs line positions — defensible).

## Phase III — review witnesses + disposition + human provenance
- **Landed (III.1):** `core/review-witness.ts` — per-dispatch nonce + `diffContact` re-derived
  from the item's diff INCLUDING created files (a creation-shaped item's lens must cite real
  lines of the file it created); `[]` without contact evidence refused; honest empty review
  still advances (review.md calibration line VERBATIM, D15b). `core/receipt-floor.ts` — a
  DONE must intersect the finding; route-aware fallback (implementer falls back to fileScope
  MINUS testScope); no-op DONE re-dispatched once then surfaced. `core/verdict.ts` —
  abstention-upholds (D11): refutation carries evidence {discriminatingInput, run, reading};
  evidence-free kills are gone; panel findings namespaced by session (ISSUE-049).
  `core/reply-protocol.ts` — reply statuses derived from the schema enum; pushback matcher
  exact-token (F10 ≠ F1). skeptic.md drops "uncertain ⇒ refuted" and the sealing line.
- **Landed (III.2):** one disposition function (actionable | waiting-human | stuck | settled)
  consumed by report/continuation/shouldTerminate; total stop closer — all six stop kinds
  have writers; D5-strict: a RED closing verify stamps blocked/env, NEVER done; resume path
  live; attempt-cap exhaustion lands as stuck/blocked.
- **Landed (III.3):** GAP-013 answer-file channel — `<runDir>/answers/Q-*.md` in the state
  area models cannot write; `answeredVia` provenance (tool vs human-file); ISSUE-052: defer
  provenance DERIVED, never model-claimed; report renders Q/A/provenance; answered questions
  stop vanishing (ISSUE-051).
- **Fix round (6 closed):** creation-shaped witness vacuity; interpreter one-liner writes
  (node -e/python -c/ruby -e) now write-classified with any `.conductor`-mentioning
  interpreter script denied OUTRIGHT fail-closed; tool answers cannot self-revive a blocked
  run (human-territory answers await operator confirmation via the file channel — the file
  answer revives, the tool answer stands recorded); route-aware receipt fallback; answers/
  dir created at surface; comment-hygiene GUARD landed (comments-only scan via the shared
  strip-comments fixture inverted; tools.ts ratcheted at its current count, ratchet
  mutation-verified tight).
- **Evidence:** gate 1476 → 1553/1553; verifier CONFIRMED twice (phase + fix round) with
  own-fixture escape re-attempts; orchestrator re-ran the self-revive guard mutation
  (fail=1 observed; restore hash-identical e86451d4…).
- **Residuals routed:** `env`-wrapped interpreter/shell writes escape the single unwrap
  (pre-existing, shared with the committed extractor; enumeration class — Phase IV.1 adds
  multi-unwrap; the GAP-025 flip closes the class). Glob-vs-glob subtraction misses nested
  test layouts (Phase IV.3). `pathLikeTokens` misses `path:line` citations (Phase IV.3).
  conductor_status lacks the AWAITING-OPERATOR-CONFIRMATION notice (Phase IV.3). tools.ts
  hygiene ratchet at 40 (about half legit §3.3 vocabulary) — tighten opportunistically.

## Phase II — GAP-006 + the scope/TDD pass + GAP-041 (the trust floor)
- **Landed (II.1, GAP-006):** `core/tool-legality.ts` — one declaration table (phase rule from
  a closed vocabulary + caller allowlist) through which EVERY `conductor_*` call passes via
  `requireToolLegal`; caller identity read from the §3.5 registry, never from arguments;
  sub-session allowlist = status/surface/override only; `advanceRun` derives position from
  persisted state (the hardcoded `legalRunTransition("EXECUTING",…)` sites are gone);
  `Run.classified` receipt closes classify re-entry; `OVERRIDE_GATES` closed vocabulary with
  unknown names refused at zero budget cost. Growth: an undeclared tool fails a guard test
  AND is refused at runtime. One pre-existing e2e test corrected (it spent its override on a
  gate with no consumption point — encoded ISSUE-007's defect).
- **Landed (II.2a):** setup floor (GAP-015), rootLevelOnly hole (ISSUE-009), vetted-test
  identity witness (GAP-007), green-admission REFUSE per D10 (GAP-008), real staged-deletion
  fact at publish freshness (ISSUE-046).
- **Landed (II.2b):** validateQueue refuses wildcard-headed globs, matched-file size budget,
  read-set token bound (`workflow.readSetTokenBudget`, default 20000, 0=off), id shape +
  newline folding (ISSUE-071), inter-item write-territory overlap for ANY kind pair;
  per-item attempt cap (`workflow.implementerAttempts`, default 3). Both knobs documented in
  docs/user/configuration.md (this commit).
- **Landed (II.3, GAP-041):** test-vet.md and §2.10 are one list; a critic verdict failing a
  load-bearing criterion refuses advancement naming the criterion (ISSUE-013 closed).
- **Fix rounds (4):** round 1 verdict PARTIAL → F1 (trivial-classification path bypassed ALL
  queue acceptance — closed: one acceptance authority, trivial routes through validateQueue),
  F3 (implementer's writable set now fileScope MINUS testScope — prevention before the spent
  sub-session), F6 (overlap refusal kind-blind), F7 (caller rule answered before argument
  shape). Round 3: GAP-015 coverage judged on ONE evidence universe (the detection walk) with
  complete judgment (no sorted 200-slice); decompose.md trimmed 6498→6319 bytes. Round 4:
  multi-ecosystem escape (coverage judged on PRE-widening per-ecosystem source globs; widened
  unions stay for requiredScopes routing) — verifier re-performed six doc-shaped answers, all
  refused.
- **Escape gauntlet (fresh verifier, own probes through real handlers):** defer-all→report
  refused from four positions; classify re-entry refused incl. deleted-receipt variant;
  eleven orchestrator-only tools refused from a real dispatched sub-session; misspelled
  override gate costs nothing; root-level TDD skip refused; '**' trivial fileScope refused;
  zero-test/fallback greens refused. Gate 1476/1476; orchestrator re-ran the round-4
  load-bearing mutation (red observed, restore hash-identical).
- **Residuals routed/accepted:** template-less ecosystems (cargo/cmake) now block at
  mark_green until an itemTest template is configured — loud, recoverable, a consequence of
  the owner's D10 REFUSE (accepted). Multi-ecosystem greenfield scaffolds take the
  non-empty fallback (deliberate). decompose.md headroom now 181 bytes — watch at Phase 16.

## Phase I.4 — ISSUE-001 (CRITICAL) + GAP-001 + GAP-003 + GAP-005 + GAP-039
- **Landed (wiring):** plugin registers `experimental.chat.system.transform` / `chat.params` /
  `chat.headers` (names verified against the SDK's own d.ts); one pure `composeDelivery`
  entry point in `adapter/inject.ts` so system text, temperature, and headers are three
  fields of one decision; every dispatched session receives its role's packs verbatim + the
  live state block (recommended next tool) + §4.1 temperature + §4.4 router tags. ISSUE-004
  ordering fixed: packs load fail-closed BEFORE the beacon writes, so beacon presence means
  doctrine deliverable. ISSUE-003 folded: doctrine dir resolvable, override channel honest.
- **Landed (witness, GAP-001):** three layers — wire (`live-inject.test.ts` drives a real
  `opencode serve` against a stub provider and asserts doctrine/state-block/params/headers
  in the outbound request, with an anti-vacuity leg), runtime (one journal receipt per
  delivery under the listed `inject`/`system-append` event: role, packs, packDigest),
  status (`conductor_status` renders last delivery per session). Multi-role witnessed at
  the unit layer (a parked in-flight sub-session gets tdd.md, its own temperature, its own
  role headers — NOT the orchestrator fallback); live leg stays single-role (gate cost).
- **Landed (GAP-003):** the live-ish leg rides the main suite via the wire-contract spawn
  idiom — real opencode, stub provider, every full gate run.
- **Landed (GAP-005):** `core/mechanics.ts` derives pack MECHANICS from `legalTools` itself
  (~14 synthetic FSM positions; meta list = TOOL_BINDINGS minus stage tools, so a new tool
  can never go unnamed); all nine packs carry the generated block; `tools/generate-mechanics.ts`
  splices under a marker law, CLI round-trip tested; guard test compares each pack against a
  FRESH derivation with an independent re-derivation anti-vacuity leg. Seven dispatch prompts
  stopped hand-spelling doctrine — they compose through fail-closed `doctrineSlice` (both
  failure arms separately load-bearing). `PLAN_PLACEHOLDER_LABELS` derives from the real
  rejector; plan.md names every rejected shape, guard goes red if a rule is added unnamed.
- **Landed (GAP-039):** tdd.md's cycle ends in a gate-legal action.
- **Evidence:** TDD reds per subject; fix round closed all 8 findings of the round-1 PARTIAL
  verdict (two false mutation claims, single-role witness, isRepo memo divergence, plan.md
  token regression, hygiene) — fresh verifier CONFIRMED all 8 with mutation re-runs; gate
  1440/1440 ×2 (recheck) + orchestrator (below). Orchestrator re-ran THE mutation
  (system-transform hook unregistered): 8/16 witness tests red; restore hash-identical.
- **Residuals routed:** beacon `doctrineLoaded` digest field (Beacon interface pinned by
  ops-docs at 4 fields; docs are orchestrator-territory) → Phase VII.5 record pass.
  GAP-002 wiring manifest → Phase VII.1 as planned. Live leg single-role → acceptable,
  noted. No repo guard exists for prohibited comment words (two 'now's slipped through
  agents twice) → candidate small guard, Phase VII basket.

## Phase I.2 — ISSUE-002 (CRITICAL) + GAP-004 + CR-2
- **Landed:** `sessionTreeOf(store, item)` returns `item.worktree ?? store.root` — always a
  PATH — with `itemTreeOf` deriving the marker SLUG independently; the shipped default
  (`parallel.writes:"off"`) accepts in-scope sub-session writes end to end. `core/types.ts`
  defines `TreeSlug`/`TreePath` (unique-symbol brands, erasable) + validating constructors
  (`treePath` refuses `"main"`; run-time half survives type-stripping) + `MAIN_TREE`/`NO_TREE`;
  the brand threads through every tree-carrying seam (9 production files, 25 test files).
  JSON schema spellings untouched (schema export regenerated byte-identical). New tests:
  `[issue-002-default-main-tree-composition]` (both directions through the real composed
  gate), `tree-types.test.ts` (misfeed = compile error on exactly 8 marked lines +
  anti-vacuity control + fail-closed constructors).
- **CR-2:** found ALREADY LANDED at HEAD (C-081 era) — all six `13.1-cr2-*` rows had
  passing, mutation-verified tests; the stage verified instead of re-implementing. Spec
  rows 62–67 `coveredByTest` filled and `knownPartialCoverage` marked paid (this commit).
- **Evidence:** TDD reds observed per subject; full gate 1396/1396 ×2 (verifier,
  orchestrator). Verifier re-ran all 15 load-bearing mutations with hash-verified restores;
  orchestrator independently re-ran the ISSUE-002 mutation (fail=3, restore hash-identical).
- **Verifier verdict:** CONFIRMED.
- **Residuals routed:** `sameTree` re-spelling at plugin/index.ts:842–848 → ISSUE-142,
  owned by GAP-002's deriveGateFacts (Phase VII.1). ISSUE-002 row premise hardcodes
  `writes:"off"` rather than binding production's default (C-077-adjacent scope nit) →
  small-fix basket. `tree-types.test.ts` writes tsc probes under `conductor/node_modules/`
  (cleanup in `after`; hygiene walkers all skip it) — accepted. `treePath("")` admitted as
  NO_TREE traces fail-closed on every path (HEAD-identical behavior) — accepted.
