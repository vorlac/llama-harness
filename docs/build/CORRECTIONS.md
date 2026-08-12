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
