# Honest limits

The plan's §9 is normative and the numbered part of this file is its copy. Every entry
below states something conductor **does not** do, or does only partially, so that an
operator reading this page before trusting a run knows exactly where the enforcement
stops.

The whole document rests on the **G7** posture: **detection over prevention**. Conductor
watches a session it does not own, inside a client it does not control. The honest
consequence: a good deal of what could go wrong here is *documented rather than prevented*.
A limit written down on this page is a limit you can plan around; a limit nobody wrote
down is one you find out about from a bad commit.

Read this together with [OPERATIONS.md](./OPERATIONS.md), whose first rule — *no banner, no
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

## Limits the build itself discovered

The fifteen above were written before the code was. These were found while building it,
and they are recorded here rather than in a commit message nobody reads. They follow the
same rule: each says what conductor does **not** reach, and where the enforcement stops.

### Git-command detection reaches the enumerated globals only

The git gate decides on the **subcommand**, and finding the subcommand means skipping
git's value-taking global options first. Three are enumerated by name: `-c k=v`, `-C dir`
and `--git-dir <dir>` (plus the inline `--git-dir=<dir>`). Every other leading option is
**non-enumerated** — `--work-tree <dir>`, `--exec-path <path>`, `--namespace <ns>`, and any
option a future git adds — and the parser cannot know whether the token after it is that
option's value or the real subcommand.

It therefore **denies**: the unrecognised option is returned verbatim as the subcommand,
lands on no allow-list, and the default-deny row fires. That is the safe direction, and it
is a real cost: it **over-denies** legitimate read-only commands, so `git --no-pager log`
or a `--work-tree` read is refused in a gated session even though it changes nothing. The
model is told which token caused it and can re-issue the command without the global.

### Freshness fails safe on a non-finite timestamp

Freshness is a *proof* that no edit landed after a verify, and the proof is arithmetic on
timestamps. A **non-finite** value — `NaN` or `Infinity` from a filesystem that answered
strangely — makes the numeric comparison false, and a false comparison would read as
*fresh*. So any non-finite `startedMs`, staged mtime, or (when a staged entry is a
deletion) index mtime is treated as **stale** up front. The cost is a publish refused for
a clock or filesystem oddity that may have been harmless; the alternative was a stale
green reading fresh, which is the one failure this rule exists to prevent.

### `classifyFailure` reads text, and only text

The §2.6.1 verdict on a failing test — `assertion`, `missing-subject` or `error` — is
decided from the runner's **output shape**, never from exit codes (runners disagree: pytest
exits 2 for a collection error). That makes the causality **text-only**: it is bounded by
the per-runner **runner rule** data — the regex sources that recognise an unresolved
specifier and a genuine assertion. A runner whose rules are missing or whose message
wording changes classifies as `error`, the conservative default, so a legal red can be
demoted to an illegal one by nothing more than a version bump in the target's test runner.

### Edit detection matches an enumerated set of write shapes

The bash edit gate extracts write targets from an **enumerated** set of shapes: output
redirects, `tee`, `sed -i`, `perl -i`, `gawk -i inplace`, `ex`/`ed`, `dd of=`, the
destination of `mv`/`cp`, the operands of `rm`, and a bounded unwrap of `sh -c "…"` so a
wrapper cannot hide one. It matches shapes, not intent. A write performed by a shape
outside that set is not seen as a write, and adding a shape means adding it to the set —
which is exactly the maintenance burden the enumeration buys in exchange for never
guessing.

### The M5 stub scan covers production sources only

The mechanical stub-marker scan runs over **production** sources — the tracked TypeScript
under `conductor/`, the C++ under `router/` and `tools/`, and `scripts/*.py`. Test files
under `conductor/tests/` are deliberately excluded, because the markers appear there
legitimately as test *data*, as the *subject* of anti-stub enforcement, and inside example
strings. The real test-file risk — an unfinished test — is caught independently and does
not rely on this scan: `scripts/test-conductor.sh` hard-fails any test the suite declined to
execute, and the TAP directives that mark one, at any depth.

### The current posture on shell expansion, and what it still misses

The git gate's rule on expansion is a **shell-expansion sigil** rule, and it is a deny.
When a command-word token still carries an **unresolved** expansion sigil after the
splitter has done its work — a backtick, a `$VAR`, a `${…}` or `$(…)` splice, a `$'…'`
span, or a backslash escape a real shell would decode — the command word names something
knowable only at shell runtime. Detection resolves the command word by token equality, so
such a word would read as "not git" and let a git write straight through. Conductor cannot
adjudicate what it cannot read, so it **denies** the whole command and tells the model to
surface a question through `conductor_surface` instead of executing it. The same rule
covers the alias route: a command word that resolves to no real binary is denied rather
than trusted.

Two residuals survive that, and both are over- or under-reach rather than a hole:

- **Over-blocking.** A perfectly legitimate expansion in command position — a path built
  from a variable, a wrapper resolved at runtime — is denied in a gated session, because
  the rule cannot tell it apart from the case it exists to stop. The refusal names the
  token, and `conductor_surface` is the route through.
- **In-place writers outside the write-shape set.** A program that opens a file and
  rewrites it in place, invoked by a name the extractor's **write-shape** set does not
  enumerate, writes without being recognised as a write. The journal still records the
  command; the edit gate simply did not adjudicate it as an edit.

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
