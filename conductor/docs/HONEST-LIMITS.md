# Honest limits

The plan's §9 is normative and this file is its copy. Every entry below states something
conductor **does not** do, or does only partially, so that an operator reading this page
before trusting a run knows exactly where the enforcement stops.

Read this together with [OPERATIONS.md](OPERATIONS.md), whose first rule — *no banner, no
conductor* — is limit 11 turned into a daily habit.

---

1. **Gates fire inside opencode.** A human terminal, or any process outside the plugin's
   sight, is ungated. Operational security is out of scope.
2. **No pre-emptive turn-end gate exists in opencode.** Continuation is idle-driven
   re-entry (§3.7); between the turn ending and the re-prompt, the model has "stopped".
   The disengage backstop bounds the failure mode; upstream FR noted.
3. **Ledgers are records, not proofs** — but every FSM-advancing record is written by a
   handler that re-derived the evidence itself (G6); the model's only fabrication path
   is `conductor_override`, which is loud, tainted, and reported.
4. **The schema guard validates non-streaming JSON only.** Streamed structured outputs
   pass with a warning; the fan-out engine's receipt-validation covers them (G5's
   two-layer posture).
5. **Model quality is a floor, not a gate.** A 27B reviewer upholding garbage findings
   costs fix-loop rounds; the skeptic layer and round caps bound the damage, and the
   bench (Phase 14) measures it instead of assuming it away.
6. **`scopesIntersect` is conservative.** False positives serialize work that could
   have parallelized; they never corrupt. Declared scopes can still LIE (an implementer
   editing outside its scope is denied, but a scope declared too wide serializes
   honestly).
7. **Verify trusts the target repo's own test command.** Vacuous tests get vacuous
   protection; the TEST_VETTED stage exists to raise exactly this floor for tests the
   pipeline itself writes.
8. **Two opencode sessions sharing one workspace**: the second gets read-only conductor
   (run-dir lock, Task 4.1; a dead holder's lock is broken automatically); the lock is
   advisory and a human deleting it lies to both sessions.
9. **The router observes; it never enforces.** Its schema check is a recorded
   observation, not a rejection (§4.4) — a request the direct path would have served is
   never failed by the router. Response observation covers non-streaming bodies only, so
   if opencode streams (Task 0.2 determines this), that dataset is empty and the router
   is justified by scheduling and metrics alone.
10. **macOS/Apple Silicon only for the POC** (G12 note); nothing gratuitously breaks
    Linux, nothing verifies it.
11. **Conductor cannot detect its own absence.** If opencode fails to load the plugin,
    every gate in this document is silently absent and the session looks normal. The
    liveness beacon and the session banner (§3.8) make it *visible*; nothing can make it
    *impossible*. First rule of the ops guide: no banner, no conductor.
12. **A second, plain opencode session in the same repo is ungated.** The harness travels
    via `OPENCODE_CONFIG` in the shell `serve.py` spawns; any other terminal running
    `opencode` in that repo has no plugin, takes no lock, and is invisible to the
    conductor session — whose freshness stamps, quarantine moves, and freeze windows are
    then racing an unmanaged writer. (Limit 8 covers two *conductor* sessions, which is
    the benign case.)
13. **In-session interpreters bypass the write-shape extractor.** `node -e`,
    `python -c`, and friends can write files without matching any redirect/tee/sed
    pattern. The edit gate catches shapes, not intent; G7's detection-over-prevention
    posture applies, and the journal records the command either way.
14. **`behavioral:false` is only as honest as `behavioralPaths`.** The path arithmetic is
    mechanical, but the path list is human-confirmed at setup (§2.1). A repo that lists
    `src/**` while keeping logic in `lib/**` has handed the model a legal TDD bypass.
    Setup asks rather than defaults for exactly this reason.
15. **Single-model routing is a POC constraint, not a finding.** G13 makes the quality
    delta attributable to process, and costs whatever a larger reviewer would have added.
    §10's multi-model stretch is how that question gets asked separately.

---

## How to use this list

Two of these limits change what an operator should *do*, not merely what they should
expect:

- **Limit 11 → check the banner.** A session without the §3.8 conductor banner is a
  session with no gates at all. Nothing downstream — not a green suite, not a clean
  report — distinguishes it from a gated one.
- **Limit 12 → one terminal per workspace.** A second plain `opencode` in the same repo
  is not merely unhelpful; it races the freshness stamps that publish depends on.

The remaining limits are bounds on interpretation: they say how much a green run is
worth, and the answer is "exactly as much as the target repo's own tests are worth"
(limit 7) plus whatever the review layer caught (limit 5).
