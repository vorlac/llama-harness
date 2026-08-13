# CORRECTIONS — deviations from the plan, append-only

Format per entry: plan quote + line numbers, observed reality (exact command and
output), decision, alternatives considered, blast radius.

---

## C-001 (2026-08-12) — Progress tracking moved out of the plan's checkboxes

- **Plan:** front matter instructs the implementing agent to tick `- [ ]` boxes.
- **Decision:** the plan file is immutable; progress lives in `docs/build/STATE.json`,
  updated in the same commit as each task. Ordered by the orchestrator launch prompt §1
  (`docs/conductor-build-orchestrator-prompt.md`), which supplies the justification:
  checkbox state dies under `git restore`, conflicts across workers, and makes the spec
  mutable.
- **Blast radius:** none on product code. §11 acceptance is checked by script, not boxes.

## C-002 (2026-08-12) — bun installed at preflight; G14 leg is ACTIVE

- **Plan:** §11 requires `bun test conductor/tests/bun-smoke.test.ts` green; Task 2.2
  authorizes skipping if bun is absent. bun was absent on this machine.
- **Observed:** `brew install bun` → exit 0; `bun --version` → `1.3.14` at
  `/opt/homebrew/bin/bun`.
- **Decision:** bun leg ACTIVE; no `SKIPPED_UNMET` path needed.
- **Blast radius:** Task 2.2 and §11 acceptance run for real.

## C-003 (2026-08-12) — pytest installed at preflight for /usr/bin/python3

- **Plan:** Task 6.2 probes pytest discovery; Task 12.2 emits a `pytest {files}` default.
  pytest was absent.
- **Observed:** `/usr/bin/python3 -m pip install --user pytest` → `pytest 8.4.2`.
  CLI scripts land in `~/Library/Python/3.9/bin` (NOT on PATH) — always invoke as
  `/usr/bin/python3 -m pytest`.
- **Decision:** pytest measurable for Task 6.2; nothing ships UNMEASURED.
- **Blast radius:** Tasks 6.2, 12.2.

## C-004 (2026-08-12) — login shell is zsh, not fish

- **Prompt §2.1:** shell = fish at /opt/homebrew/bin/fish. **Observed:** `$SHELL` =
  `/bin/zsh`.
- **Decision:** no impact; every script is `#!/usr/bin/env bash` and invoked as
  `bash script.sh`, exactly as the prompt mandates. Recorded because ground truth said
  to re-verify surprises.
- **Blast radius:** none.

## C-005 (2026-08-12) — canonical test command wrapped in scripts/test-conductor.sh

- **Plan (§8 preamble, line 1969-1970 and ~50 task steps):** green step runs
  `node --test conductor/tests/`.
- **Observed (node v26.7.0):** directory positional → `MODULE_NOT_FOUND` reported as a
  *failing test* (exit 1); glob matching zero files → exit 0; quoted glob + TAP
  reporter → correct counts. Transcript in GATES.json.
- **Decision:** all gate decisions run through `bash scripts/test-conductor.sh`
  (TAP-parsed; fails on tests==0, fail>0, cancelled>0, skipped>0, todo>0; from Task 0.3
  it also runs `tsc --noEmit`). Raw `node --test` is never a gate input.
- **Alternatives:** trust exit codes (rejected: both failure modes above), per-task
  explicit file lists (rejected: drift-prone across 50+ tasks).
- **Blast radius:** every green/red step; §11 acceptance script.

## C-006 (2026-08-12) — M3 typecheck invokes the local tsc binary, not bare `npx tsc`

- **Prompt §3.4:** `npx tsc -p conductor/tsconfig.json --noEmit`.
- **Decision:** test-conductor.sh calls `conductor/node_modules/.bin/tsc` and FAILS if
  it is missing, because bare `npx tsc` outside the package dir can fall back to a
  network fetch of an arbitrary typescript version — nondeterministic and slow.
  Same check, pinned binary.
- **Blast radius:** M3 only.

## C-007 (2026-08-12) — one scaffold commit outside the 52-task manifest

- **Decision:** durable state (docs/build/*), gate tooling (scripts/test-conductor.sh,
  scripts/conductor-gate.sh), and the user's already-staged
  docs/conductor-build-orchestrator-prompt.md land as one commit
  `conductor-build: preflight, gate tooling, durable state scaffold` **before** Task
  0.1. Not a manifest commit; does not match the `^conductor: ` grep (§11's last row
  inspects those). No trailers, matching repo history.
- **Blast radius:** git history gains non-manifest commits; verify-acceptance.sh checks
  the 52 manifest messages appear exactly once each, which extras do not disturb.

## C-008 (2026-08-12) — Task 5.4 added; ordering overrides adopted

- **Task 5.4** (`chat.message` hook — run creation, startHead/startBranch/startDirty
  capture, orchestrator session registration; plan §3.2, §3.5) is specified but never
  assigned by the plan. Added as its own red→green→commit
  (`conductor: 5.4 chat.message hook`, tier A) before Phase 9, per orchestrator prompt
  §3.3. Likewise adopted: `adapter/quarantine.ts` built inside Task 6.1;
  `adapter/questions.ts` built inside Task 4.1.
- **Ordering overrides** (orchestrator prompt §3.1): 0.3 before 0.2; 4.2 before 4.1;
  2.2 lands immediately after 4.1; 12.1 tracked as 12.1-core + 12.1-G5 (G5 half runs
  after 13.1). Recorded in STATE.json meta.orderingOverrides.
- **Blast radius:** commit order differs from plan §8's serial listing; each deviation
  has a STATE.json row.

## C-009 (2026-08-12) — .gitignore negation for docs/build/

- **Observed:** `.gitignore:5` pattern `build/` (unanchored, intended for CMake trees)
  also matched `docs/build/`, silently blocking the git-tracked build-state directory.
- **Decision:** appended `!docs/build/` negation. Existing CMake semantics untouched.
  Editing THIS repo's .gitignore is in scope (prompt §3.4 itself orders a
  conductor/node_modules/ entry); G10 forbids editing TARGET repos' .gitignore only.
- **Blast radius:** none beyond making docs/build trackable.

## C-010 (2026-08-12) — Task 0.3 smoke test asserts a real value, not `1 === 1`

- **Plan (line 2046):** "one trivial `conductor/tests/smoke.test.ts` asserting `1 === 1`
  plus importing a trivial `conductor/core/types.ts` export".
- **Conflict:** gate M5 (and the plan's own G4 anti-stub law it mechanizes) rejects
  trivially-true assertions of exactly that shape.
- **Decision:** the smoke test asserts the imported export's VALUE
  (`CONDUCTOR_NAME === "conductor"`), preserving the task's stated purpose — proving
  .ts imports execute under node --test — without a vacuous assertion. The import is
  the meat; the literal comparison was never the point.
- **Also:** conductor/package.json gained `@types/node` as a third devDependency beyond
  prompt §3.4's two (typescript, @opencode-ai/plugin): tsc cannot resolve `node:test`
  et al. without it, and the M3 leg would fail on every test file. Still
  devDependencies-only; G1 (zero runtime deps) untouched.
- **Blast radius:** none beyond the smoke test's assertion text and one dev dependency.

## C-011 (2026-08-12) — gate sequencing + one out-of-order commit

- **M4 sequencing (standing procedure):** M4's red re-derivation requires the task
  commit to exist (`git worktree add --detach <taskCommit>`), while §7.1 nominally runs
  the gate pre-commit. Procedure adopted: M1/M2/M3/M5/M6/M7 run pre-commit; the commit
  lands; M4 runs immediately after FROM the commit; its result is recorded in
  GATES.json on the next docs/build touch. An M4 failure halts the build for a fix
  commit. (Applied to 0.3: M4 PASS.)
- **Task 6.2 committed early** (after 0.3, before Phase 1) as free early parallel work,
  pre-authorized by orchestrator prompt §6.2. Probe findings of note: node --test and
  pytest COLLECT in-repo git-worktree copies (whole-tree runs go red) — the measured
  justification for conductor's out-of-repo worktrees and quarantine; pytest
  additionally aborts its whole session on duplicate basenames across worktree copies.
- **Blast radius:** commit order differs from §8's listing (pre-authorized); none on code.

## C-012 (2026-08-12) — opencode self-updated to 1.18.15 mid-build; wire contract pinned against it

- **Observed:** preflight `opencode --version` printed 1.18.10; after Task 0.2's live
  probing the same command prints **1.18.15** (opencode self-updates on use). The §5
  contract was verified against 1.18.15 — the binary production will actually run.
- **Consequences recorded in conductor/adapter/wire-notes.md, load-bearing for later
  tasks:** (1) prompt-body `format:{json_schema}` DOES NOT EXIST — the fan-out engine
  (7.1) must use prompt-shaped structured output + independent validation + retry
  (G5/G9 posture unchanged); requests carry NO schema field, an 11.6 scoping input
  alongside the streaming finding (§3.1 override: 11.6 shrinks to request-side
  counter + recorded note). (2) permission adjudication is
  `POST /session/{id}/permissions/{permissionID}` `{response}` — adapter constants
  only, core untouched (G11). (3) plugin/index.ts must export ONLY its factory.
  (4) every directory handed to opencode must be realpath'd (macOS /var vs
  /private/var turns in-project edits into external_directory asks). (5) plugin-init
  failure is log-and-continue UNGATED — §3.8's beacon must be loud and out-of-band.
- **Also:** Task 12.1's generated config must pin opencode auto-update OFF so the
  verified contract cannot drift under a running session.
- **Blast radius:** briefs for 5.3, 7.1, 8.2, 10.1, 11.6, 12.1.

## C-013 (2026-08-12) — M5 scope refinements (two)

- The bare word "stub" is the plan's own vocabulary for test doubles (§8 Task 0.2
  "fake OpenAI-compatible stub server"; Phase 11 "httplib stubs"). M5 now forbids it
  in production source only (core/adapter/plugin/tools/src), allows it under
  conductor/tests/. Placeholder-marker patterns (TODO/FIXME/XXX/not implemented/
  placeholder) still apply everywhere. `.md` files are excluded from M5 entirely —
  doc content is governed by anchor tests (8.1, 15.1). Both directions self-tested.
- **Blast radius:** M5 only; gate strictness on production source unchanged.

## C-014 (2026-08-12) — fragment gained tools.task=false (cross-task edit, justified)

- **Plan §5.3 (lines 1792-1798):** "the fragment sets each agent's built-in
  task/agent tool to 'deny' via the config's tool-permission key (exact key pinned by
  Task 0.2)". Discovery (iii) pinned it: `agent.<name>.tools: {"task": false}`.
- **Decision:** added to all seven agent defs in conductor/opencode-fragment.json and
  asserted by a new fragment.test.ts test (M6 hard-stop justification: this is the
  plan's own deferred-to-0.2 obligation, not drift).
- **Blast radius:** fragment consumers (12.1 merge); registry gate remains layer 2.

## C-015 (2026-08-12) — Phase 0 gate findings: skip-directive hole + wire-notes honesty

- **Finding 1 (major, discovery-integrity lens; reproduced by orchestrator before
  fixing):** on node 26.7.0, `describe(..., {skip})` reports as a skipped SUITE —
  TAP trailer shows `# skipped 0` — so test-conductor.sh's count-based skip rejection
  never fired for describe-level skips. A suite wrapped in an unconditional
  describe-skip would sail through green. Fix: the gate now rejects ANY
  `ok N ... # SKIP|# TODO` directive at any subtest depth (self-tests S12-S14).
  On an opencode-less machine the wire suite now FAILS the gate loudly instead of
  passing vacuously — correct for this build.
- **Finding 2 (major):** seven wire-notes sub-claims were presented under "every line
  is asserted" with no asserting test. Fixed by tagging each **[observed]**, an honest
  header defining the tag, and an Assertion-coverage notes section for the minor
  tightness gaps. The G6 record now distinguishes suite-pinned reality from
  probing-transcript observations.
- **Also carried:** spec-conformance nit — G1 ("types-only dev dependency") vs §5.1
  (mandates value-importing `tool({...})`): the plan's own tension; Task 5.3 must
  resolve it explicitly when authoring the production plugin.
- **Blast radius:** gate script (stricter only); wire-notes wording; no code.

## C-016 (2026-08-12) — Phase 1 adversarial gate: 2 fix rounds, 6 future-task bindings

- **Gate outcome:** 6 independent lens contexts (spec-conformance ×2, correctness ×2,
  boundary-cases ×2, counterexample ×2) found 8 confirmed defects incl. 5 majors. Two
  bounded fix rounds (plan §7.2 cap is 3) resolved every in-scope defect; orchestrator
  re-ran all 26 lens malicious inputs against the fixed modules (26/26 corrected).
- **Fixed in committed Phase-1 code** (freshness/shell-parse/decide/stops/types), all
  test-first, +27 pinning tests (252 -> 279): classifyFailure interior-`..` escape;
  scopesIntersect case-insensitive heads (pure-safe over-approx); isHumanTerritory
  `push --force`/`-f`/`$N/month`; zero-budget env guard; **globMatch exponential
  backtracking (MAJOR DoS — 130s -> 0.1ms via `**`-collapse + memoization, hot path on
  every gate check)**; **gitSubcommand fail-safe on unrecognized global flags (MAJOR
  false-ALLOW: `git --namespace log apply` returned allow-listed `log`)**; **isGitCommand
  skips env-assignment/env/command/sudo/exec wrappers + basename-resolves path git
  (MAJOR false-negative)**; verifyFreshFor non-finite-timestamp fail-safe; scanKeywords
  rejects tuple-form `items` (JSON-Schema-2020-12 divergence with the router validator).
- **Justification for editing earlier-task files (M6):** confirmed security/liveness
  findings from the milestone gate; every change added tests and preserved all existing
  assertions (git numstat: additions only, zero deletions on test files).
- **Bound to future tasks** (assertion ledgers carry phaseGate1Bindings): 5.1 (full-token
  deny matrix; `branch -D` must deny; env/value-flag red-team spellings), 5.2
  (wrapper-aware writeShapedPaths), 6.1 (per-kind evidence validation; absolute-path
  relativization before classifyFailure — this repo is ESM and emits absolute
  module-not-found; tight anchored runnerRules), 9.1 (derived-decision scoring;
  ClassificationCheck correctedKind), 9.5a (under-delivered skeptic panel must not
  silent-drop a major), 3.3 (empty-scope conservative serialize).
- **G7-documented residuals** (honest-limits-pending.md): backtick substitution, alias
  injection, `sh -c`/`bash -c` wrappers, `$'...'` ANSI-C quoting.
- **Blast radius:** hardening only; every change is the safe direction; all 279 tests green.

## C-017 (2026-08-12) — Phase 2 crash-recovery gate: journal torn-line heal

- **Finding (crash-recovery lens, orchestrator mechanical probe):** the write-ahead JSONL
  journal did not heal a torn trailing line. A previous process crashing mid-append
  (power loss / disk full) leaves a partial record with no newline; the next append
  concatenated onto it (`{"seq":6,...in{"seq":7,...}`), silently destroying BOTH the torn
  record and the next one — unacceptable for the component whose job is durable
  debuggability (§7.4).
- **Fix (test-first, [2.1-torn-write]):** adapter/journal.ts now checks, on the first
  append per instance, whether journal.jsonl ends without a newline and prepends one,
  isolating the torn partial and keeping every subsequent record a clean parseable line.
  readLastSeq already skipped unparseable lines for seq continuation. 301 -> 302 tests.
- **Blast radius:** journal durability only; the safe direction; orchestrator re-ran its
  own crash probe (0 fail).

## C-018 (2026-08-12) — Phase 3 gate: trivial-report hole + G6 single-source guard

- **Finding (MAJOR, counterexample lens; corroborated by state-machine lens as minor):**
  gates-phase `reportLegal = trivial || allSettled` made conductor_report LEGAL for a
  trivial EXECUTING run with an UNSETTLED (PENDING) item. Since the phase-order gate
  enforces on the legal set (G9), it would permit conductor_report → EXECUTING→TRIVIAL_DONE
  (terminal) with the item never tested/implemented/published — the run closes claiming
  done, work lost. The handler's closing re-verify does NOT save it: the §4.2 foreign-red-
  set EXCLUDES every non-PUBLISHED item below GREEN, so the unsettled item's own red test
  is excluded and the verify passes vacuously.
- **Plan contradiction resolved (DERIVE-AND-RECORD, §8.1 — a legality derivation, not a
  schema/vocabulary/G change):** line 2256 ("EXECUTING flagged trivial legalizes ...
  conductor_report") vs line 1142 ("conductor_report requires every item to be PUBLISHED,
  blocked, or deferred") + §3.2/§3.3 ("the item FSM is NEVER skipped; trivial compresses
  fan-out width, not process"). Decision: report is REACHABLE in trivial EXECUTING but
  LEGAL only when all items are settled (same precondition as work runs). Fix:
  `reportLegal = allSettled` (drop the `trivial ||`). Honors both plan lines under the
  safe interpretation of 2256.
- **Test change (sanctioned, M6-justified by the confirmed MAJOR):** [3.2-trivial]
  rewritten — item stage tool still legal in trivial EXECUTING; report NOT legal with a
  PENDING item; report legal once the item is settled (PUBLISHED). Additive negative case.
- **G6 single-source guard (both correctness lenses, informational):** RUN_STATES /
  ITEM_STATES in fsm-run/fsm-item.ts are parallel copies of types.ts RunState/ItemState —
  set-equal today but "single source" held by CONVENTION, not construction. New
  conductor/tests/single-source.test.ts asserts the copies are set-equal, converting it to
  by-construction (a future divergence fails the test).
- **Bound to future tasks:** 9.4c (PLAN_REVIEWED->EXECUTING context — dispatch_wave must
  supply survivingMajors:0 when planReviewRounds<max, else round>=max; the gate is
  satisfiable-by-construction since you only reach PLAN_REVIEWED by satisfying the exit
  condition); 9.5b (report handler enforces all-settled as a non-verify precondition,
  defense-in-depth); 5.3/9.4a (decide + make consistent whether direct per-item stage-tool
  calls enforce dependency-readiness — legalTools currently offers a stage tool for a
  dependency-unready item, matching the plan's "first-class for recovery" intent but
  contradicting its own recommended:null).
- **Blast radius:** gates-phase legal-set for trivial report (stricter/safer); one test
  tightened; one guard test added. All the safe direction.

## C-019 (2026-08-12) — Task 4.1: stale-lock break routed to the journal, not an AnomalyRecord

- **Plan (line 2299-2300):** "a dead pid or over-age lock is broken with an anomaly record".
- **Conflict:** §2.8 AnomalyRecord kinds are a CLOSED vocabulary {override, gate-crash,
  disengage} — no lock kind — and anomalies.jsonl is RUN-scoped, while a stale-lock break
  happens at workspace-open BEFORE any run exists.
- **Decision (DERIVE-AND-RECORD; routing choice, not a vocabulary change so not
  STOP-AND-PARK):** the break is journaled as a `warn state lock.stale-break` record
  (carrying brokenPid + reason dead-pid|over-age) — the anomaly TRACE — rather than an
  AnomalyRecord in a run file. A LIVE foreign lock journals `warn state lock.contended`,
  leaves the lock intact, and sets readOnly=true (createRun then throws). isAlive treats
  any non-ESRCH error (incl. EPERM) as alive, so a lock is never stolen without proof of
  death. Pinned by state.test.ts:668/682.
- **Blast radius:** none on the schema; the §2.8 vocabulary is untouched. If a lock-kind
  anomaly is ever wanted, it is a separate §2.8 change (STOP-AND-PARK) — not done here.

## C-020 (2026-08-12) — Phase 4 gate: state/questions crash-safety + sandbox hardening

Two adversarial lenses (crash-recovery, filesystem-safety) found 2 majors + 3 minors.
Atomic-write primitive, dead-pid/over-age lock, retention pruning, .git/info/exclude (G10),
and gitio command-injection surface all confirmed SOUND. Fixes (test-first):
- **F1 (MAJOR, crash-recovery):** answerQuestion was ordered answer-first then clear-items.
  A crash between leaves an item blocked on an ANSWERED question, and since answeredIso is
  the gate key for conductor_answer (gates-phase hasOpenQuestion), NO legal tool can finish
  the clear → permanent wedge, violating §2.11 line 998 ("resumes without hand-editing
  state"). FIX: clear items FIRST, mark the question answered LAST; a mid-crash retry is
  idempotent (already-cleared items skipped; question still open so conductor_answer legal).
- **F2 (MAJOR-latent, filesystem):** state.ts path builders never validated runId/itemId, so
  saveItem(runId,{id:"../../tmp/x"}) escapes .conductor/ (path.join collapses ..). Not
  reachable at HEAD (no live callers) but the adapter is the trust boundary and ids flow
  from model-driven decomposition. FIX: assertSafeId (reject empty, path separators, .., and
  anything not a simple slug) in every path builder.
- **F3 (minor):** questions.ts writeAtomic used a predictable tmp name (pid.counter) →
  symlink-follow write outside sandbox. FIX: mirror state.ts (randomBytes suffix + flag "wx").
- **F4 (minor):** lock fresh-claim TOCTOU (two cold starts both write). FIX: exclusive-create
  (flag "wx") on the fresh claim, EEXIST → re-read as contention. Best-effort; if a clean
  deterministic test isn't feasible, documented in honest-limits-pending.md instead.
- **F5 (minor):** createRun left an orphan empty run dir on mid-create crash (never pruned,
  no run.json). FIX: write run.json BEFORE the items dir so any orphan is prunable. (Not a
  wedge; below the bar, folded in since the round is open.)

## C-021 (2026-08-12) — binding: registerConductorExclude vs a linked worktree (Task 9.6)

- registerConductorExclude does mkdirSync(root/.git/info); in a LINKED worktree root/.git is
  a FILE, so this throws ENOTDIR at openWorkspace init. Not a Phase-4 sandbox escape (and the
  .conductor/ state normally lives in the MAIN workspace, not per-worktree), but Task 9.6
  (worktree mode) MUST resolve the real gitdir (git rev-parse --absolute-git-dir, as gitio
  does) or skip the exclude write when root/.git is not a directory. Bound to 9.6.

## C-022 (2026-08-12) — Phase 5 security MILESTONE gate: 4 gate bypasses + 1 spec gap

security/bypass lens found 4 bypasses, ALL re-confirmed by the orchestrator running them
against the real code; spec-conformance lens returned CONFORMANT row-by-row with 1 minor
enumeration gap. (The red-team-by-data generator died to an API error; the orchestrator
generates+executes its own malicious batch post-fix instead.) Fixes, test-first, all in the
SAFE/deny direction:
- **MAJOR 1 (git write past decideGit via shell expansion):** `$'git' apply evil.patch`,
  `$"git" push`, `x=git; $x push` all tokenized to a non-`git` command word (`$git`/`$x`)
  → isGitCommand false → ALLOWED, but bash runs the git write around the edit gate; the
  fail-closed flag also read false (fails OPEN). FIX: (a) shellTokens decodes ANSI-C `$'…'`
  and locale `$"…"` quoting (strip the `$`+quotes) so `$'git'`→`git`→denied; (b) decideGit
  DENIES any segment whose command-word token still carries an unresolved expansion sigil
  (backtick, `$'`, `$"`, `${`, `$(`, `$VAR`) — an un-analyzable command word cannot be
  verified safe, so deny + surface. Closes `$'\xNN…'`, `$x`, `g${e}it`, backtick-command.
- **MAJOR 2 (`>|` force-redirect not a write shape):** `echo x >| f` → writeShapedPaths []
  → classified "read" → edit gate skipped AND unregistered session passes the registry
  gate. FIX: recognize `>|` as a redirect target.
- **MAJOR 3 (`..` path traversal in the edit gate):** `> src/a/../../.conductor/run.json`
  with scope `src/a/**` → globMatch matches (`..` literal, `**` swallows) → ALLOWED, writes
  the handler-only state area; the `.conductor/**` deny doesn't fire (literal path starts
  `src`). Distinct code path from the Phase-4 state.ts fix. FIX: decideEdit DENIES any edit
  path containing a `..` segment (a legitimate in-scope path never has one).
- **MINOR 4 (non-enumerated in-place writers):** `perl -pi`, `dd of=`, `gawk -i inplace`,
  `ex`/`ed` escape writeShapedPaths. FIX: add the common ones; document arbitrary obscure
  in-place writers as a G7 limit.
- **A1 (spec-conformance, minor under-block):** `checkout -f`/`switch -f`/
  `--discard-changes` aren't in §3.5:1378's enumerated worktree-discard list, so under the
  non-default `check-only` policy they'd be allowed and discard tracked changes (HEAD-check
  doesn't catch it). FIX: add `-f`/`--force`/`--discard-changes` to the unconditional deny.
- **Documented residual (honest-limits-pending.md):** parameter expansion and hex/octal
  ANSI-C escapes that still slip a command word past static analysis are DENIED by the new
  unresolvable-command-word rule (fail-safe), so the residual is now over-blocking, not a
  hole. Backtick/alias remain documented per G7.

## C-023 (2026-08-12) — Phase 5 gate fix round 2: wrapper-with-flags git bypass

Orchestrator re-attack of the C-022 fixes (all 6 confirmed holding) surfaced 3 NEW residuals
of the same wrapper class: `sudo -u bob git push`, `env -i git push`, `command -p git commit`
all ALLOW — the Phase-1 wrapper unwrap skips only a BARE wrapper word (`sudo git`), not the
wrapper's own flags/values, so the command word reads as `-u`/`-i`/`-p` instead of `git` and
isGitCommand returns false. FIX (fail-safe): the wrapper-unwrap (shell-parse.ts
gitCommandWordIndex) skips a recognized wrapper's leading option tokens — `-flag`,
`--flag`, a known value-taking flag's value (sudo -u/-g/-C/-h/-p/-r/-t/-U; env -u/-C/-S),
and env `NAME=value` — before taking the command word; gates-git reuses that helper and
DENIES as unresolvable if the structure can't be cleanly resolved to a command word.
Verified against the 3 inputs + controls (bare `sudo git push` still deny, `env git push`
still deny, non-wrapper commands unchanged).

## C-024 (2026-08-12) — Phase 6 milestone gate: evidence/quarantine crash-safety + sandbox (expected-broken mechanism)

Two lenses (residual-risk, crash-recovery/fs-safety) on the out-of-repo quarantine — the
mechanism §14 flagged as changed-and-never-re-reviewed. ~9 findings; the orchestrator
reproduced the reproducible ones (clobber-on-restore = real data loss; ../ entry moved a
file from OUTSIDE the repo). Fixes (test-first, all safe direction):
- **F1 EXDEV (MAJOR):** the quarantine dir is under $stateHome (home volume); a repo on a
  different volume (Docker/CI/external drive/tmpfs) makes renameSync throw EXDEV, uncaught,
  crashing the wave driver on EVERY multi-item wave. FIX: move helper tries renameSync; on
  EXDEV falls back to copyFileSync + utimesSync(preserve original mtime) + unlinkSync — works
  cross-volume AND preserves the mtime the freshness invariant needs. Wrap the quarantine
  call in runVerify's try so any failure heals.
- **F2 clobber-on-restore (MAJOR, reproduced):** replay overwrote a refilled repo slot (the
  corrected new file) with the stale quarantined red, old mtime defeating freshness. FIX:
  restore NEVER overwrites an existing dst — skip + leave the stored file + record a conflict.
- **F3 sandbox escape via unvalidated ids (MAJOR):** workspaceKey=`../../../../etc` →
  quarantineDirFor → rmSync(recursive) on /etc/quarantine; tree=`../../tmp/evil` → marker
  path escapes runDir; excludeTestFiles `../x` moves a file from outside the repo (reproduced).
  Same assertSafeId gap Phase-4 closed in state.ts. FIX: apply assertSafeId to
  runId/workspaceKey/tree; reject `..`/absolute in files/excludeTestFiles.
- **F4 replay heals a LIVE run's quarantine (MAJOR):** replayPendingRestores sweeps ALL
  manifests assuming any is a crashed orphan; with concurrent worktree runs it restores an
  ACTIVE run's files back mid-verify (spurious red + broken invariant). FIX: manifest carries
  {pid,startMs}; replay heals ONLY dead-owner orphans (pidAlive skip); ENOENT source =
  already-healed (no throw); check repoRoot still exists (skip if gone); never throw out of
  runVerify; per-entry try.
- **F5 illegal-red too loose (MAJOR):** legality checked the FULL text + basename match; spec
  (§2404/2431) says the EXCERPT must name a testScope file. FIX: check only the excerpt
  (first 300 chars), full-path match, not basename.
- **F6 recycled-pid marker wedge (minor):** marker stale-break checks only pidAlive; a
  recycled pid refuses forever. FIX: over-age break using startMs (mirror state.ts staleLockMs).
- **F7 childEnv git hygiene (minor):** strips only NODE_TEST_CONTEXT; FIX: also strip
  GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR + set GIT_OPTIONAL_LOCKS=0 (gitio parity).
- **F8 timeout SIGTERM-trap false-green (nano):** FIX: timeout kill uses SIGKILL (untrappable).

## C-025 (2026-08-12) — Phase 7 gate (concurrency): fan-out watchdog coverage

Concurrency lens: fan-out core races SOUND (cap, barrier, watchdog-vs-completion double-resolve,
registry retry window, freeze-hold double-dispatch all airtight; router-client double-resolve +
socket/timer leak airtight; 12x flake sweep clean). 3 hang-family findings:
- **F1 (MAJOR):** the per-job watchdog is armed AFTER `await client.session.create()`, so a hung
  create is unbounded → the whole wave hangs with no backstop, defeating the §2474 per-sub-session
  wall-clock cap. FIX: arm the job timeout BEFORE session.create so create+prompt are both bounded;
  on fire, abort (if a session exists) and env-fail the job.
- **F3 (LOW):** hold() subscribes onClear then sets heldUnsubs — a synchronous-notify TreeState
  would strand the held job. FIX: set heldUnsubs before/atomically with subscribe.
- **F2 (MINOR, bound to 9.4c):** a held write-capable job has no backstop if its tree's verify
  marker NEVER clears (leaked/stale marker) → silent wave hang. The fan-out hold path is
  deliberately timer-free (§4.2 "no timers, no polling"); the backstop is that a stale-marker
  break (Phase-6 evidence over-age break) MUST surface to treeState.onClear. BINDING for 9.4c
  (the wave driver wires treeState): a stale/over-age marker break fires onClear so a leaked
  marker becomes an env failure, not a silent hang.

## C-026 (2026-08-12) — M5 marker scan scoped to production source (false-positive class)

- **Discovered (Task 8.1 gate):** a full-tree `conductor-gate.sh` scan failed on three
  COMMITTED test files whose tokens are not unfinished work: `chat-message.test.ts`
  (a comment naming "the placeholder classification"), `gates-git.test.ts`
  (`cmd: "git grep TODO"` — test DATA fed to the shell-parser), and
  `quarantine.test.ts` (an example path `…conductor-quar-outside-XXXX/…` where the
  `XXX` marker matched 3 of 4 X's). Task 8.1's own `doctrine.test.ts` adds a fourth of
  the same class — its subject IS "placeholder marker," named five times. The 15.1
  doc-fidelity test will have the same need.
- **Root cause:** `PAT_STUB` (TODO/FIXME/XXX/not implemented/placeholder) applied to ALL
  non-.md files. In TEST files these tokens legitimately appear as (a) test data,
  (b) the subject of anti-stub enforcement, and (c) example strings — none are the
  unfinished-*product* markers G4/M5 exist to catch.
- **Fix (two parts):** (1) the marker scan is now production-source only, using the SAME
  `*conductor/tests/*` case-split C-013 already applies to the bare word `stub`;
  (2) `XXX` → `\bXXX\b`, so a standalone `XXX` marker still trips but a longer `XXXX`
  token does not (a strict precision gain, applied universally).
- **No coverage lost — the real test-file risk is caught elsewhere.** An UNFINISHED or
  DISABLED test does not depend on the marker scan: `test-conductor.sh` hard-fails any
  skipped/todo test or SKIP/TODO TAP directive at any depth (lines 40-42), and M5's
  `PAT_SKIP`/`PAT_TRIV`/`PAT_CATCH` (skip/todo tests, trivially-true asserts, empty
  catch) remain UNIVERSAL and still apply to test files. Self-tested both directions:
  a synthetic production file with `// TODO`/`placeholder`/`stub`/standalone `XXX`
  still FAILS; a test file carrying only the legit FP tokens PASSES; a test file with
  `test.skip`/`assert.ok(true)`/empty `catch{}` still FAILS. Full tree: M5 PASS (57).
- **Residual (disclosed):** a stray marker COMMENT with no functional effect (e.g.
  `// TODO: more cases`) inside a test file is no longer caught by M5 — it is caught by
  the mandatory per-task orchestrator diff read and the phase-gate test-vet lens. This
  matches the gate header's stated posture (idiom-dependent shapes are eyeballed in the
  diff read, not regexed). Logged to honest-limits-pending.md.
- **Blast radius:** `scripts/conductor-gate.sh` only; production-source strictness
  unchanged; committed with a `conductor-build:` infra commit ahead of the 8.1 commit.

## C-027 (2026-08-12) — Task 8.2 pre-commit adversarial review: 2 defects in inject.ts

An orchestrator-run adversarial review workflow (3 lenses — spec-conformance, edge/
counterexample, invariants — each finding skeptic-verified) over the freshly-implemented
`conductor/adapter/inject.ts`, BEFORE its commit, surfaced two real defects (1 refuted).
Both were re-derived by the orchestrator, then fixed test-first (new failing tests added,
red observed, implementer fixed, full-suite green re-observed — 837/837).

- **MAJOR — false terminality in the injected state block.** `renderStateBlock` hardcoded
  `"Recommended next tool: none (the run is terminal — nothing to advance)."` for EVERY
  `legalTools(...).recommended === null`. But `legalTools` returns null in several
  NON-terminal states too — a stalled EXECUTING wave (gates-phase.ts:318-320, e.g. the
  only actionable item waits on a blocked dependency), the INTAKE non-work branch (245-250),
  and the default branch (323-326) — each with 4-5 legal meta tools. So the block, re-stated
  into the system prompt every request (G9), asserted a FALSE "terminal / nothing to advance"
  claim mid-run, directly contradicting the "Other legal tools available now: N" line beneath
  it and risking the orchestrator concluding the run was finished. FIX: render the
  authoritative `verdict.why` (which legalTools already computes and which correctly
  distinguishes a genuine "Terminal run: …" from a stalled "EXECUTING: no item is
  schedulable this wave …") instead of any self-computed terminality. Test
  `8.2-null-recommendation` pins it across a stalled non-terminal case and a real terminal
  (REPORTED) case.
- **Fail-closed hardening — empty pack accepted.** `loadPacks` treated a present-but-empty
  (0-byte / whitespace-only) pack as a successful read, so `initPlugin` wrote the §3.8
  liveness beacon for effectively-absent doctrine — the exact "looks entirely normal and
  enforces nothing" failure mode §3.8 exists to make visible. Spec-literal-conformant (§6.4
  names only a *missing* file), but against §3.8's intent. FIX: `loadPacks` now throws a
  fail-closed error naming any pack whose `content.trim().length === 0`, so an empty pack
  fails exactly like a missing one and the beacon is never written. Test `8.2-empty-pack`.
- **Refuted (1):** the third finding did not survive skeptic verification and was dropped.
- **Process note:** this is the ultracode adversarial-review pattern applied per-task. The
  implementer's own "GATE PASS" was on the TARGETED test glob; the major was invisible to
  the original 9 tests (none exercised a null-recommendation-but-non-terminal state). Caught
  pre-commit by the review + the orchestrator's mandatory full-suite green + diff read.
- **Blast radius:** `conductor/adapter/inject.ts` + two new tests in `inject.test.ts`; both
  ride in the `conductor: 8.2 injection` commit. Ledger rows 8.2-null-recommendation /
  8.2-empty-pack added to task-8.2.assertions.json.

## C-028 (2026-08-13) — Phase 8 (doctrine) gate: 7 confirmed findings, 1 fix round

The Phase 8 adversarial gate (3 blind lenses — doc-fidelity vs the §6.1 port map,
inject.ts §6.4 conformance, subsystem completeness — each finding skeptic-verified;
11 raw → 4 refuted → 7 confirmed) found the doctrine subsystem incomplete against the
plan. Fixed test-first in one round, two commits (102802d packs, efd0f84 injection):

- **MAJOR — debug.md injected into 0 sessions.** §4.1 requires the implementer pack to be
  `tdd.md (+debug.md in DEBUG)`, but `ROLE_PACKS.implementer` was `["tdd.md"]` and
  buildSystemAppend keyed purely on role, so the loaded+validated debug.md reached no model.
  FIX: buildSystemAppend appends debug.md as a secondary pack for an implementer whose active
  item is in DEBUG posture, via a new OPTIONAL `GateItem.debugging` field (ignored by
  legalTools; read only by injection). Tight guard; tdd.md stays primary. Test `8.2-debug-pack`.
- **MAJOR — review.md missing the spec-before-quality adjudication ordering** (§6.1 1841). FIX:
  added the ordering section (surviving spec findings discard that round's quality findings,
  re-derived after the code settles). Anchor `8.1-anchors-review-ordering`.
- **MINOR — core.md missing forbidden satisfaction phrases** (§6.1 1837, verification-before-
  completion's enforceable red-flags) **and the ponytail lite reminder** (§6.1 1849). FIX:
  added both sections; reworded the "binds every role" opening (the full pack is injected for
  only some roles). Anchors `8.1-anchors-core-forbidden` / `8.1-anchors-core-ponytail`.
- **MINOR — doctrine.test.ts pinned content for only 7/9 packs.** plan.md and skeptic.md had
  only existence/no-marker checks, so their port-map doctrine could silently drift. FIX: added
  content anchors `8.1-anchors-plan` / `8.1-anchors-skeptic` (both green today — hardening).
- **DEFERRED (recorded binding) — receive-review.md delivery.** §6.1 lists it as injected
  doctrine but §4.1 assigns it to no static role, because its delivery context (an implementer
  RECEIVING review findings) does not exist until Phase 9 routes surviving findings to the
  implementer. The pack is loaded/cached now (init stays fail-closed over the full set); the
  Phase 9 review-receipt/fix-round task must thread a "receiving-review" signal to
  buildSystemAppend so it appends receive-review.md. The false inject.ts comment claiming it
  was already "referenced by review receipt" was corrected to name this binding.
- **NIT (noted, not fixed) — X-Conductor-Group** keyed on raw tree/itemId rather than a
  role/stage-qualified id; functional as-is; a KV-affinity refinement, not blocking.
- **Process note:** the two MAJORs (dead packs) were invisible to the 8.1 anchor test and the
  8.2 unit tests — both proved their packs were *loaded* and *shaped* but neither proved they
  were *delivered*. The completeness lens exists to catch exactly that "loaded ≠ delivered" gap.
- **Blast radius:** `conductor/doctrine/core.md`, `review.md`, `conductor/tests/doctrine.test.ts`
  (102802d); `conductor/core/gates-phase.ts` (optional GateItem field), `conductor/adapter/inject.ts`,
  `conductor/tests/inject.test.ts` (efd0f84). Phase 8 gate verdict: PASS after 1 fix round.

## C-029 (2026-08-13) — Task 9.1 (tools MILESTONE): pre-commit adversarial review, 6 defects + 1 widening

The six Phase-9 intake/question handlers (conductor_classify/status/decide/surface/answer/defer,
added to adapter/tools.ts) passed their 10 authored tests, then a 3-lens skeptic-verified
adversarial review (13 raw → 2 refuted → 11 confirmed) found real defects the tests missed. All
fixed test-first (F1–F6 red → green; F7 a hardening test) BEFORE the 9.1 commit; full suite 864/864.

- **MAJOR (F1) — classify hard-throw on a spec-legal escalation.** A classifier saying "question"
  (trivialItem:null) + a skeptic correcting to "trivial" (stricter: trivial>question, §3.2) yielded
  finalKind "trivial" with no trivialItem to synthesize → the handler threw and stranded the run at
  INTAKE. FIX: an un-synthesizable trivial escalates FURTHER to work (classifier proposes, handler
  disposes); the old throw is now unreachable.
- **MAJOR (F2) — surface half-write on a bad itemId.** appendQuestion ran before confirming the
  named items exist, so a hallucinated/typo'd id (a realistic LLM failure) left an orphan open
  question + partially-blocked items, wedging the run. FIX: precheck every named item exists BEFORE
  any write (§3.4 legality-before-persist) — a bad id now leaves zero writes.
- **MAJOR (F3) — defer orphan decision on a bad itemId.** The §2.7 record + D-id counter advanced
  before setDeferred threw ENOENT. FIX: precheck the item exists before appendDecision.
- **MAJOR (F4) — surface trusted a caller humanTerritory flag.** §2.11 defines humanTerritory as the
  core/decide.ts isHumanTerritory VERDICT, not a caller flag. FIX: compute isHumanTerritory(question)
  (a caller may force true, but cannot force a human-territory question down to false).
- **MINOR (F5) — classify correctedKind could violate "null IFF agreed".** A schema-valid
  {agreed:false, correctedKind:null} skeptic reply produced an inconsistent result and escalated
  nothing. FIX: normalize — escalate only on an actionable correction (!agreed && correctedKind!=null);
  agreed/correctedKind derived so the invariant always holds; used for both the result and
  run.classification.check.
- **MINOR (F6) — decisions.jsonl torn-line wedge.** A crash/kill/ENOSPC mid-append left a malformed
  line that made mintDecisionId's per-line JSON.parse throw, permanently wedging decide+defer. FIX:
  mintDecisionId scans the raw ledger for `"id":"D-<n>"` tokens (never JSON.parse-ing a line), so a
  torn line neither wedges the mint nor lets the next id collide with a partially-claimed one. (JSON
  escaping of any such sequence inside a text field means only real id fields / torn lines match.)
- **Hardening (F7) — journal-vocab test.** The 9.1 handlers use a §7.4 widening: one event
  `decision.recorded` was ADDED to the `state` component in journal-events.ts (a decide/defer records
  no run/item state, so it owns a grep-able name rather than misusing item.updated — sanctioned by
  the file's own widening rule; NO §2-schema enum touched, no STOP-AND-PARK). F7 drives
  classify/decide/defer through the REAL (throwing) journal to prove all emitted events are in the
  closed vocab — the test journal-events.ts's rule requires for an added name.
- **Deferred to Task 10.1 (recorded bindings, NOT fixed here):**
  (i) conductor_classify's question path sets run.state=ANSWERED but does not archiveRun — archival
  timing is a run-lifecycle/retention concern, not classify's; (ii) conductor_decide does not consult
  isHumanTerritory — decide.ts documents that function "for the ask-gate (Task 10.1) and
  conductor_decide", so a kind:derived decision on a human-territory question should be rejected/
  surfaced by the 10.1 ask-gate. Both bound in HANDOFF.
- **Blast radius:** `conductor/adapter/tools.ts` (6 handlers + the 6 fixes), `conductor/core/
  journal-events.ts` (decision.recorded), `conductor/tests/tools-9.1.test.ts` (17 tests). The Phase 9
  MILESTONE gate (after 9.6) will re-review the whole tools subsystem.

## C-030 — Task 9.2 pre-commit adversarial review (3 lenses, skeptic-verified)

**Panel:** 3 blind lenses (spec-conformance / edge-counterexample / invariants) over the uncommitted
9.2 diff -> 27 findings -> 2 refute-biased skeptics each (tie-upholds, k=2). 19 survived. The session
limit killed 9 skeptics mid-panel; per the plan's own under-delivered-panel rule (the 9.5a binding)
the findings whose panel under-delivered (F5, F6, F8, plus one refuter each on F4/F7/E9) were counted
as UPHELD rather than silently dropped — the workflow's own filter would have dropped the three with
zero returned verdicts, which is exactly the defect that binding exists to prevent.

- **MAJOR (F1/I1) — the §3.2 item size budget was wired to `workflow.trivialMaxFiles`.** That field is
  the §2.1 TRIVIAL-classification ceiling (shipped default **2**, plan line 560); §3.2's size row says
  "~5 files" and names no config knob. Under the DEFAULT config every decomposed item touching 3+ files
  was rejected as "too large" — the run burns its one re-prompt and then wedges in INTAKE — and tuning
  the trivial ceiling silently retuned decompose. The authored tests masked it by fixing
  trivialMaxFiles:5. FIX: `ITEM_MAX_FILES = 5` owned by core/planning.ts; trivialMaxFiles is left to the
  trivial path alone.
- **MAJOR (F2/I3/E4) — acceptance clustering broke on ordinary English, both directions.** The cluster
  subject was the raw leading token, so every criterion opening with an article collapsed to the subject
  "the" (two genuinely different subjects counted as ONE cluster — the exact two-things smell the row
  targets, under-rejected), while one subject phrased with and without an article counted as TWO and was
  rejected with the nonsense reason "spans 2 clusters (parser, the)". FIX: skip determiners/stop-words
  when choosing the subject token.
- **MINOR (F3/E11) — `make it <observable outcome>` was rejected as a quality wish.** The pattern
  `/\bmake\s+it\s+\w+/i` fired on "make it return 404 on a missing id", contradicting the module's own
  stated narrowness rule. FIX: require a quality-adjective continuation.
- **MINOR (F4/E6) — the placeholder scan condemned plans for DISCUSSING placeholders.** Bare-word rules
  rejected a plan describing an HTML `placeholder` attribute, an item "remove the TODO comments in
  src/x.ts", a sentence ending "/etc.", and a bare `...` line inside a fenced code block (idiomatic in
  Python stubs/YAML). FIX: shape-matched rules (comment-marker `TODO:`, `<placeholder>`/"placeholder
  for", list-trailing ", etc."), and the elision rule judged against the document with fenced code
  stripped. Added the TBD expansions ("to be determined/decided").
- **MINOR (E2) — duplicate item ids made the cycle detector judge a DIFFERENT graph.** The deps map was
  last-writer-wins, so a cycle routed through an earlier duplicate vanished; the single re-prompt omitted
  it and attempt 2 died for a defect the planner was never shown. FIX: duplicate ids UNION their edges.
- **MINOR (E3) — only the FIRST cycle was reported.** Two disjoint cycles meant the one re-prompt carried
  half the truth. FIX: `findDependsOnCycles` returns every distinct cycle (de-duplicated by node set).
- **MINOR (E5) — the disjoint-path guard false-rejected root-level-only globs.** `scopesIntersect`
  reduces a glob to its literal head and a leading wildcard yields an EMPTY head that overlaps
  everything — the right conservative bias for the wave scheduler (a false overlap only serialises work)
  but a hard false REJECTION here, so a docs item scoped `*.md` was rejected as editing behavioral
  production code. FIX: a glob naming no directory and no `**` matches root-level files only and is
  disjoint from a directory-rooted path; `**/*.md` genuinely does reach under it and is still rejected.
  shell-parse.ts is UNTOUCHED (the scheduler keeps its conservative rule).
- **MINOR (E8/F8) — the placeholder doctrine covered plan.md only.** A decision proposal carrying "TBD"
  in question/why/choice/appliedWhere was minted into the PERMANENT §2.7 ledger, while the identical
  string in the markdown rejected the whole plan. §3.2 makes the recorded decisions part of the same plan
  output. FIX: `planDefects` scans the decision prose too.
- **MINOR (E9) — the one bounded re-prompt named only ONE defect class.** A reply that was both
  placeholder-laden and carried a <2-option derived decision was re-prompted about placeholders only, so
  a compliant attempt 2 died terminally for an unshown defect. FIX: placeholder + decision-gate defects
  are collected in ONE pass and the re-prompt carries all of them.
- **NIT (I5) — the decision-gate rejection journaled nothing** before throwing, while every other
  rejection emitted `fsm/guard-reject`. FIX: unified into the same guard-reject path.
- **NIT (I2) — a corrupt queue.json leaked a raw SyntaxError** naming neither tool nor file, and the read
  was not BOM-tolerant. FIX: named error + BOM strip.
- **NIT (I6) — planDecisionSchema hand-re-listed the §2.7 fields** while the TS type was already
  `Omit<DecisionRecord,"id"|"tsIso">`; drift would have surfaced only as the fan-out schema-rejecting
  well-formed plans. FIX: the schema is DERIVED from decisionRecordSchema. (Guard test R13 passed
  pre-fix — recorded honestly as a regression guard, not red-driven evidence.)
- **NIT (E13) — an empty-string id was excluded from `seen` but INCLUDED as a graph node,** producing the
  incoherent reason "cycle ( -> )". FIX: empty ids are not nodes.
- **MINOR (F6) — decomposePrompt stated a ponytail law the handler does not enforce.** Under `lite` it
  told the planner a minimal-code rung with an empty reuse note "is rejected" (false — §6.3 lite is
  advisory and validateQueue correctly does not enforce it), and `ultra`'s additional
  challenge-the-requirements instruction appeared nowhere. FIX: `ponytailLaw(config)` states the law at
  the configured intensity.
- **REFUTED by their panels (no change):** E1 (claimed concurrent handleDecompose invocations both
  persist — refuted 2/2: the workspace lock plus the single-orchestrator model), E7 (placeholder
  false-negatives on TBD expansions — refuted 2/2, though the two literal expansions were added anyway
  as a cheap strict improvement), E12 (the file budget counts fileScope ENTRIES so one broad glob evades
  it — refuted 2/2; the same claim as F7, whose panel under-delivered, so the stronger panel governs).
- **DEFERRED to Task 10.1 (recorded binding, NOT fixed here):** E10 — a crash INSIDE the persist phase
  leaves half-written state a re-run compounds rather than reconciles (orphaned decisions.jsonl records
  from a never-accepted plan; orphaned PENDING item files absent from queue.json). Reconciliation belongs
  with the run lifecycle/continuation engine, not in these two handlers.
- **Documented deviation (F5, not a defect):** the handlers grant ONE re-prompt uniformly to every §3.2
  row, while the plan's table reserves the bounded round for the size row and 9.2's bullet for the cycle
  case. Uniform-one is strictly MORE forgiving and still ends in "a rejection with a named reason";
  recorded for the Phase 9 milestone gate rather than silently kept.
- **Blast radius:** `conductor/core/planning.ts` (rewritten pure half), `conductor/core/types.ts`
  (derived planDecisionSchema), `conductor/adapter/tools.ts` (readQueueJson, planDefects, unified
  re-prompt, ponytailLaw), `conductor/tests/tools-9.2.test.ts` (9 authored + 14 review-fix = 23 tests).
  887/887 green.

## C-031 — Task 9.3 pre-commit adversarial review (THROTTLED: 2 lenses, skeptics for MAJORS only)

**Throttle applied** after the C-030 burst exhausted a 5-hour account window (~79 agents / 5.7M tokens):
2 lenses instead of 3, the §3.2 spec QUOTED INLINE so no agent re-read the 3,399-line plan, and skeptic
panels for MAJOR findings only (minors/nits triaged by the orchestrator). Result: 16 agents / 1.4M tokens
— and it still found 5 majors. Both reviewers RAN the real handler over the fake SDK to produce evidence
rather than reasoning from the source alone, which is why the findings carry concrete traces.

**A first attempt returned `{surviving: [], ...}` — NOT a clean bill of health.** Both lenses had died to
a mid-response connection error; the journal held zero findings. Reporting that as "review passed" would
have been a false green of exactly the kind these gates exist to catch. Re-run; the re-run found the 5.

- **MAJOR (F1/E3) — plan review could pass having dispatched NOTHING.** The lens roster was sized by
  `readFanout("planReview", config)` = min(planReviewers, parallel.maxReaders). With maxReaders < 4 it
  silently dropped lenses (c) decomposition and (d) minimality; at maxReaders 0 it dispatched zero
  reviewers and STILL advanced PLANNED->PLAN_REVIEWED as a "clean round" — a plan certified on evidence
  nobody gathered, which is the precise failure the handler's own blind-spot doctrine forbids. FIX:
  coverage first — the roster is never smaller than the lens set (`Math.max(readFanout, 4)`); the clamp
  is a CONCURRENCY knob the fan-out engine already enforces internally. The lens roster that actually ran
  is now journaled on the transition, so a dropped lens can never again be invisible.
- **MAJOR (F2/E5) — one bare directory token blocked the ENTIRE queue.** `scopesIntersect` compares
  literal-head PREFIXES segment-wise, so a shorter head prefixes every longer one: evidence reading
  "both items write into src/" mapped to every item, nullifying §3.2's "the run proceeds on the remaining
  items". The wildcard guard inspected only segment[0], so `src/`, `src/**` and `src/beta/*.ts` all sailed
  past it. FIX: file-shaped tokens only — the LAST segment must be a real dotted filename and no segment
  may carry a wildcard.
- **MAJOR (E1) — the opposite failure in the same function: common citations blocked NOTHING.**
  `./src/x.ts`, a bare `parse.ts`, a markdown `[link](src/x.ts)`, a comma-joined list, a possessive
  `parse.ts's`, and smart-quoted paths ALL resolved to `[]`, so a surviving major blocked no item and the
  run executed what the review condemned — the under-match the module's own header says must not happen.
  FIX: normalise each shape (markdown link split, comma/semicolon separators, `./` prefix, possessive,
  curly quotes) and match a bare filename against each scope's BASENAME, case-folded.
- **MAJOR (F3/E2) — the block ledger lied, and the unblock path fired early.** An Item carries ONE
  `blocked` disposition, so with two survivors naming the same item the second question still listed it in
  `blocksItems` while the block pointed at the FIRST question. answerQuestion clears by questionId, so
  answering the first RELEASED the item while the second surviving major was still open. FIX: claims are
  resolved cumulatively — first survivor owns the item, later ones drop it from their own `blocksItems`,
  so a question names exactly the items whose `blocked.questionId` is that question. (Orchestrator had
  independently flagged this before the panel reported.)
- **MINOR (E9, fixed) — `skepticsPerFinding: 0` made every major auto-survive** with zero adjudication:
  the panel guard was stepped around at k=0 and `findingSurvives([], 0)` is vacuously true. FIX: a major
  with k < 1 is a named configuration refusal before anything is spent.
- **MINOR (E6, fixed) — id matching crossed dotted/slashed boundaries**, so "I1" matched inside "I1.2"
  and blocked the wrong item. FIX: '.' and '/' are boundary characters.
- **MINOR (F6, partially fixed)** — minors/nits and the raised counts were discarded without a trace; the
  transition now journals per-severity counts alongside the roster.
- **DEFERRED to Task 10.1 (recorded bindings, NOT fixed here)** — all crash/partial-write class, which is
  where the run lifecycle + continuation engine belongs, and consistent with C-030's E10 deferral:
  (a) **E4** the cap's per-survivor loop writes a question then blocks its items, so a failure after the
  first question persists leaves a half-applied cap with no resume key — a retry appends duplicate
  questions and re-points blocks; (b) **E7** the revision counter is saved AFTER the plan it counts, so a
  crash in that window leaves the revised plan with the old counter and a re-run gets the whole
  planReviewMaxRounds budget again; (c) **E8** a surviving major naming a queue item whose runtime item
  file is missing aborts the review and wedges the run at PLANNED with no recovery path; (d) **F4** the
  lens/panel aborts leave a partially advanced run from round 2 onward, contradicting the comment that
  promises the run is untouched; (e) **F5** each revision round re-appends the planner's decisions with no
  dedupe, accumulating duplicate §2.7 rows.
- **Raised at the Phase 9 milestone gate:** F7 (the cap question's text promises a list of blocked items
  it never prints, and asserts a block even for a finding that blocks nothing) and E10 (the panel stride
  `index * k + i` assumes integer k, which numberSchema permits to be fractional).
- **Blast radius:** `conductor/core/planning.ts` (findingBlocksItems + pathLikeTokens + ID_BOUNDARY),
  `conductor/adapter/tools.ts` (lens roster, skeptic guard, cumulative claims, journal), and
  `conductor/tests/tools-9.3.test.ts` (8 authored + 6 review-fix = 14). 901/901 green.

## C-032 — Task 9.4a (conductor_submit_test + conductor_vet_test): adversarial review found 5 surviving MAJORs, 3 distinct defects

**How it was found.** Throttled adversarial review of the uncommitted 9.4a diff (2 blind lenses —
spec-conformance and edge-counterexample — then 2 refute-biased skeptics per MAJOR only; spec quoted
inline so no agent re-read the 3,399-line plan). 18 agents, 2.3M tokens. Five majors survived, and they
collapse to THREE defects: each lens independently found two of them. One major (F1, the `testWriter`
vs `test-writer` role vocabulary) was REFUTED by both its skeptics — the string the diff uses is the one
§3.3 and the pinned contract name — and is recorded here only so the refutation is not re-litigated.

The 11 authored tests passed throughout. Every defect below is one the suite structurally could not
catch, which is the whole reason the review exists.

- **MAJOR (F3 + E1) — a failure somewhere ELSE in the suite was admitted as this item's RED.**
  `adapter/evidence.ts` computes `legalRed` — the §2.1 illegal-red rule, `isLegalClass(class) &&
  (targeted || the excerpt names a testScope file)` — for exactly the §3.3 case "a collection failure
  elsewhere — is NOT red". Both handlers DROPPED it, taking only `outcome.record` and admitting the red
  on failureClass alone. Reachable on any project whose verify scope carries no §2.1 `itemTest` template
  (schema-optional: the scope schema requires only command + timeoutMs) and via the zero-test fallback.
  `grep legalRed` showed it was written by evidence.ts and read by NOBODY. The fixture config hid it: its
  full-scope tripwire emits a token that classifies as "error", so the tests only ever asserted the
  tripwire's absence. FIX: one `redAdmission` helper applies BOTH halves — core keeps the §2.6.1 class
  split, evidence.ts keeps the targeting half — at both the submit admission and the vet re-run. An
  untargeted red is NOT repairable (no edit to the writer's own test makes a full-suite run target it),
  so it stops the stage and asks instead of burning the repair budget re-observing someone else's failure.

- **MAJOR (F2 + E2) — a PASSING test could reach TEST_VETTED, and thence GREEN.** The vet's captured red
  was a property of the POINTER, not of the test on disk. When a mustFix repair stopped being a red,
  `blockVetAndAsk` wrote only `attempts.vetRounds` — it never re-pointed or invalidated
  `item.evidence.red` — and `capturedRedOf` PREFERS the pointer over the ledger's latest record. So after
  the question was answered, the next vet paired the PRE-repair red with the POST-repair (passing) test,
  a clean critic round advanced RED→TEST_VETTED, and TEST_VETTED→GREEN requires only `testExit === 0`,
  which a passing test satisfies. An item could go green with no red ever proven for the test it ships —
  the exact anchoring G6/P6 exist to prevent. FIX: `capturedRedOf` also reports whether ANY run for the
  item is newer than that red; a stale pairing is re-established through `evidence.runTest` at vet entry
  (and must still be a legal red, or the stage blocks and asks). P6 is intact — on the normal path the red
  IS the newest run, so a clean first round still re-runs nothing.

- **MAJOR (E5) — queue-declared `testScope` paths escaped the repo, in BOTH directions.** They were
  dereferenced un-normalised: handed to the child test runner as argv, and read into sub-session prompts.
  A `..` entry made the child EXECUTE an out-of-repo file and streamed its contents to the model
  (reproduced: sentinel written, marker in the prompt). queue.json is model-authored and core
  `validateQueue` constrains ids, DAG shape, sizes and behavioral/testScope pairing but never path SHAPE.
  The rest of the codebase takes the opposite posture — gates-edit denies a `..` segment before scope
  matching, state.assertSafeId rejects separators, quarantine rejects absolute paths. FIX:
  `assertContainedPaths` at the legality step (the last point before both dereferences), refusing absolute
  and `..` entries by name rather than normalising them away.

- **MINOR (E11) — a REGRESSION this diff introduced.** The 9.4a/5.3 depsReady binding made a DEFERRED
  dependency wedge the run: dependents got no stage tool (unready) and were not `isSettled`, so
  `conductor_report` was never legalized and `recommended` was null — permanently, with no escape the
  gate's `why` or the deny message mentioned. Before the binding the dependents were still offered their
  stage tool, so the run could finish. FIX: a new `cannotEverPublish` fixpoint in core/gates-phase.ts
  extends the report precondition — an item stalled behind a chain that can never reach PUBLISHED is as
  closed as a settled one. A BLOCKED dependency is deliberately EXCLUDED (a question can be answered and
  the item resumes, so conductor_answer is the way out and the run is waiting, not finished); this is
  what keeps the committed 8.2-null-recommendation contract intact, and a first, broader version of the
  fix that retracted blocked deps too was caught by that test and narrowed.

- **MINOR (E6, fixed) — `capturedRedOf` trusted the ledger unconditionally**, so a §2.6.1 class-"error"
  record — the very class the submit side refuses as "not a red" — could be handed to the critics as THE
  CAPTURED RED, and an unresolvable pointer silently substituted the newest red with no warning. FIX:
  filter to the legal classes; journal a warn when the pointer had to be resolved by fallback.

- **MINOR (E10, fixed) — §2.5 attempts under-reported the item's history.** `attempts.testRepairs` and
  `attempts.vetRounds` were ASSIGNED the current call's local counter, so a second call after an answered
  question overwrote what the first spent. FIX: accumulate. (The related question — whether the BUDGET
  itself should be per-item rather than per-call — is a policy choice, raised at the Phase 9 gate.)

- **MINOR (F4, fixed) — `NEEDS_CONTEXT` was treated as a completed write.** Only status "BLOCKED" was
  handled, so a writer asking for context silently burned a repair attempt per round (reproduced: all 4
  dispatches spent) and the question raised at exhaustion did not relay what it asked for. FIX: same exit
  as BLOCKED, with `neededContext` carried into the question.

- **MINOR (F7, fixed, no new test) — the §2.7 two-options law was asserted in a comment, not enforced.**
  The immediate-pass fork appended its decision straight through `appendDecision`, while every other
  decision-writing site gates on core `requireTwoOptions` first. The literal is compliant today, so no
  test could go red; the gate is now called at the write so the site cannot drift.

- **NIT (E12, fixed) — a crash-torn questions.jsonl line killed the LEGALITY step** with a raw
  SyntaxError naming neither the tool nor the file. FIX: a named legality failure, the shape
  `readQueueJson` was written to have.

- **NIT (E13, fixed) — fractional knobs rounded budgets UP.** The §2.1 schema types them `number` and the
  subset validator has no integer/minimum keyword, so `testRepairAttempts: 1.5` spent TWO repairs and a
  2.5 vet fan-out dispatched THREE critics. FIX: floor at the read.

- **Raised at the Phase 9 milestone gate (POLICY, not defects):** (a) **F5** the §4.2 readiness predicate
  is written twice — `depsReady` (enforcing) and `unpublishedDeps` (which composes the refusal message) —
  with no single source; (b) **F6** `itemVerifyScope` matches requiredScopes against fileScope as well as
  testScope and silently takes the first candidate with an `itemTest`, so a repo whose production and
  test paths select different scopes can run the wrong runner; (c) **E8** `vetCritics: 0` /
  `vetMaxRounds: 0` make the handler throw while the gate still RECOMMENDS the tool — knob validation
  belongs at config load; (d) **E9** the item test runs synchronously inside an async handler, freezing
  the orchestrator's event loop (and every fan-out watchdog) for the duration of each run; (e) **E14**
  the vet roster is sized by `readFanout` alone while handlePlanReview floors its roster at the coverage
  set — two stages disagreeing in one file; (f) whether the repair/round BUDGETS should be per-item
  rather than per-call. **Deferred to Task 10.1** (crash/partial-write class, with the C-030/C-031
  parks): **E7**, the question-then-setBlocked window, which can leave an OPEN question no item
  references.

- **Blast radius:** `conductor/adapter/tools.ts` (redAdmission + assertContainedPaths + capturedRedOf
  staleness + the two NEEDS_CONTEXT exits + floored knobs + accumulated attempts + requireTwoOptions),
  `conductor/core/gates-phase.ts` (cannotEverPublish + the report precondition), and the new
  `conductor/tests/tools-9.4a-review.test.ts` (9 defect reproductions, red before / green after).
  921/921 green, typecheck OK, bun leg OK.

## C-033 — Task 11.4 (admission): the admitted slot was released mid-stream, so the cap bounded nothing that mattered

**How it was found.** Not by a review panel — by the orchestrator READING THE DIFF, which is the
step the per-task loop puts after "observe green" for exactly this reason. The 8 authored rows were
green (25 cases / 1588 assertions) and two independent mutations confirmed the suite genuinely
discriminates (breaking priority ordering failed [11.4-priority-order]; shrinking the listener pool
to httplib's default failed [11.4-health-at-full-queue]). The defect was still there.

- **MAJOR — `maxInflightPerModel` was unenforced for STREAMING traffic, i.e. all generation
  traffic.** `handleProxy` claims an admitted slot into a `shared_ptr<AdmissionSlot>` whose
  destructor returns it. On the BUFFERED path that is correct: the local pointer dies at the end of
  `relayToUpstream`, after the body has been sent. On the INCREMENTAL path (SSE, or any answer with
  no Content-Length) the handler REGISTERS a content provider and returns immediately — the stream
  runs afterwards, on the connection thread. The provider captured `[relay, call]` and NOT `slot`,
  so the slot was released the moment the handler returned. A comment three functions away asserted
  the opposite ("a streaming relay hands a copy to its content provider so the slot outlives this
  handler exactly as long as the stream does") — it described an intention the code did not carry
  out. SSE is the entire point of this proxy (`set_tcp_nodelay`, the unbuffered relay, the
  600s stream timeout all exist for it), so the cap was inert for every request it was written to
  bound: the router would admit unlimited concurrent generations and llama-server's slots would be
  the only backstop.
  **Why the 8 rows missed it:** the stub upstream answers with `response.set_content(...)`, which
  sets a Content-Length, so every authored row takes the buffered path. The streaming-plus-admission
  combination was never exercised. This is the same shape as C-032's fixture blind spot — a fixture
  that cannot reach the failing path makes a passing suite say nothing about it.
  **FIX:** capture the slot in the provider (`slot = std::move(slot)`). httplib destroys the
  provider when the response ends, normally or by the connection dying, so the slot is returned
  exactly once on every outcome. The buffered and both error-exit paths are untouched — they return
  before the move, so their local pointer still releases on scope exit.
  **Pinned by** the new [11.4-fix-streaming-slot-release] case: against a stub that streams one
  chunk and then parks, `inflight_count` must be 1 while the stream is live and a second same-model
  request must QUEUE. Before the fix it read `0 == 1` and the second request passed straight
  through; after it, 26 cases / 1599 assertions green.

- **Recovered work, not re-done work.** Both subagents for this round (the 11.4 implementer and the
  9.4b implementer) died on a weekly account limit. The 11.4 one had written a complete and good
  `admission.hpp` and most of the router seam, but stopped between USING `admission_` and DECLARING
  it, and never wrote `sendAdmissionError` — the tree did not compile. The orchestrator finished
  both by hand rather than discarding the work, then reviewed the whole diff as if it had arrived
  from a live agent, which is what surfaced the defect above.

- **Blast radius:** `src/router/admission.hpp` (new, header-only), `src/router/router.hpp`
  (admission seam + the fix), `src/router/config.hpp` (the SG-2 maxQueued clamp inside 11.2's
  existing validation path), `src/tests/admission_test.cpp` (8 authored rows + 1 review-fix),
  `CMakeLists.txt` (source list, orchestrator-only). ctest 26/26, stable across three runs
  (1.53s / 1.54s / 1.57s); `llama-router` still links.

## C-034 — Task 9.4b (mark_green / validate / queue_amend): a guard no test could see

**How it was found.** Subagents were unavailable (weekly account limit), so there was no adversarial
review panel for this task. In its place the orchestrator ran the substitute it had just proved out
at 11.4: MUTATION-TEST the green suite, then read the diff. Four mutations were run against the
13-row suite; three failed the right rows and one did NOT.

- **COVERAGE HOLE (found by mutation, fixed with a new row) — the "never quarantine the item's own
  tests" guard was unpinned.** Deleting `own.has(file)` from `foreignRedSet` left all 13 rows green.
  The reason is a real asymmetry in the §4.2 union: the QUEUE half already skips the subject item
  (`if (entry.id === itemId) continue`), so the guard does nothing there — it is load-bearing only
  for the REGISTRY half. And that is the dangerous half: the §2.11 stale-red registry is
  workspace-level and SURVIVES RUNS, so an entry an earlier run wrote can name a path that is now
  THIS item's testScope. Quarantining it would move the item's own red out of its own verify and
  return a false green — precisely the cross-run poisoning the plan describes at §2.11 (lines
  1019-1020: "conductor_validate of run 2 runs run 1's red test… and spends debugFixCap fix
  attempts hunting a 'bug' that is a leftover"), except in the more dangerous direction, where the
  leftover SILENCES the check instead of failing it.
  The existing [9.4b-own-red-still-fails-validate] row cannot catch it: its foreign red belongs to a
  sibling, so it only ever exercises the queue half. FIX: a new row,
  [9.4b-fix-stale-red-never-quarantines-own-test], seeds a registry entry from an earlier run naming
  the subject item's own test and asserts the item's own red still fails its verify — verified to go
  RED under the mutation and green with the guard restored.
  **The general lesson, now in HANDOFF:** a row that passes a mutation is not necessarily a row that
  covers the code; two independent code paths can reach the same assertion, and only one of them may
  be under test. Mutate every branch of a guard, not just the guard.

- The three mutations that DID discriminate, each failing only its own rows: dropping
  `excludeTestFiles` from the item-test path (the no-template livelock row), dropping the stale-red
  half of the union (the three-cases + one more), and hardcoding `debugFixCap` to 3 (the cap row,
  which is pinned at two different caps for exactly this reason).

- **Self-review findings, fixed before commit:** (a) the `debug-architecture` question minted at the
  cap carried `askedBy.sessionID: ""` from a leftover ternary that could only ever evaluate to the
  empty string — §2.11 provenance must name the sub-session that was working the item, so the last
  fixer's session id is now threaded to it; (b) the non-behavioral PENDING->GREEN path did not
  increment `attempts.green` while the behavioral path did — a green is a green, and an inconsistent
  counter is a counter nobody can read.

- **Recorded limitation, raised at the Phase 9 gate:** `runVerify` takes ONE `scopePattern`, and
  §2.1 maps path patterns to scope names, so an item whose `fileScope` entries select DIFFERENT
  scopes cannot express their union in a single call — the first entry's scopes are the ones that
  run. This is the sibling of C-032's F6 (itemVerifyScope's arbitrary pick) and belongs with it.

- **Unimplementable rungs, raised rather than faked (G4):** §3.3's BLOCKED ladder reads "more
  context -> stronger model -> item re-split via conductor_queue_amend -> surfaced to the human".
  The two middle rungs are not constructible from §2.1 — it carries `models.roles` (a role->model
  map) with no notion of an escalation model, and the re-split rung would have mark_green call
  queue_amend, which the 9.4b bullet does not ask for. The two constructible rungs are implemented
  (a NEEDS_CONTEXT stop-and-ask, and a BLOCKED stop-and-ask on the existing "implementer-blocked"
  origin); the other two are Phase-9-gate business.

- **Blast radius:** `conductor/adapter/tools.ts` section (8) (+~640 lines: handleMarkGreen,
  handleValidate, handleQueueAmend and their helpers), `conductor/tests/tools-9.4b.test.ts`
  (13 authored rows + 1 mutation-fix row). 943/943 green, typecheck OK, bun leg OK.

## C-035 — Task 9.4b: handleQueueAmend's signature contradicts the tool it implements (OPEN, fix queued)

**How it was found.** Not by a review — by comparing my own orchestrator-authored 9.4b assertions
against an INDEPENDENT lookahead draft of the same task that I had wrongly concluded did not exist.
(My `find` for it ran against the repo root; the draft was in the scratchpad. The task still landed
correctly and its coverage matches the draft's row-for-row — the draft splits DEBUG into three rows
where mine merges two — but the draft's spec-gap list caught something mine did not.)

- **MAJOR (open) — the handler cannot be reached by its own tool.** Plan §3.4 line 1323 registers
  `conductor_queue_amend | {ops[]}`, and the COMMITTED plugin surface agrees:
  `conductor/plugin/index.ts:165` declares `args: { ops: S.array(S.string()) }`. My
  `handleQueueAmend` instead takes `queue: Queue` — a whole replacement queue — plus the decision
  fields. Nothing can get from `{ops: string[]}` to a complete `Queue`, so when Task 9.6 wires tool
  calls to handlers there is no honest binding to write. This is the same class of defect as the
  9.4a/5.3 gate-vs-handler disagreement that the build treats as blocking: two committed surfaces
  that describe the same tool differently.
  The tests do not catch it because they call the handler directly with a queue they built.
  **FIX (queued, test-first):** `handleQueueAmend` takes the ops, APPLIES them to the run's current
  queue, and re-validates the RESULT through core validateQueue — which is strictly closer to the
  bullet's "re-validates DAG/scopes/behavioral and records a decision" than replacing the queue
  wholesale, and keeps legality-before-persist intact. The op vocabulary must be a CLOSED union
  (add / update / remove), and the draft's two companion gaps get resolved with it: which item
  states are amendable (only PENDING/RED/TEST_VETTED/GREEN — nothing of theirs is integrated), and
  what an update does to a blocked item (§2.5's `blocked` comment names conductor_queue_amend as a
  legal clearer, so an update clears it through store.clearBlocked).
  **Deferred by one step on purpose:** the 9.4c test-writer is reading adapter/tools.ts right now,
  so the edit lands after it reports rather than racing it.

- **MINOR (open, same fix batch) — validate's scopePattern.** C-034 recorded that `runVerify` takes
  ONE scopePattern while an item may carry several fileScope entries selecting different §2.1
  scopes, and settled for the first entry with the limitation raised at the Phase 9 gate. The
  independent draft proposes deriving the pattern from the item's fileScope as a UNION instead,
  which is better if it can be expressed. Re-examine when the queue_amend fix lands: if a single
  runVerify call genuinely cannot express the union, the limitation stands and stays a gate item;
  if it can, take it.
