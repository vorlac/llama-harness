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

## C-035 — Task 9.4b: handleQueueAmend's signature contradicts the tool it implements (CLOSED)

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

  **LANDED, test-first, 15 R-tests (994/994).** NEW pure `core/queue-amend.ts`: the closed
  `AMEND_OP_KINDS` (add/update/remove) union, `parseAmendOps` (the string→union widening Task 9.6
  binds `ops: S.array(S.string())` through, refusing by POSITION so a long list is diagnosable),
  `applyAmendOps` (ordered application over a structuredClone, so a refused amendment cannot have
  mutated anything), and `AMENDABLE_ITEM_STATES`. `handleQueueAmend` now RE-READS the run's
  queue.json rather than accepting one, which is the substantive half: an amendment states the
  change and the run supplies the rest, so no caller can drop an item by omission.
  `StateStore` gains `removeItem`.

  Resolutions recorded with the fix: amendable = PENDING/RED/TEST_VETTED/GREEN (nothing integrated);
  an update CLEARS `blocked` (§2.5 names this tool as a clearer) and touches neither the FSM
  position nor the item's history; persist order is added-item-files → queue.json → removed-item
  files, so the only state a crash can strand is a runtime item no queue entry names — the orphan
  nothing reads — never a queue entry whose §2.5 file is absent, which every later `loadItem`
  would throw on. That ordering has its own row, injected by making the run dir unwritable while
  `items/` stays writable.

  **A MUTATION FOUND A HOLE THE 14 AUTHORED ROWS MISSED**, which is the third time this build has
  banked on that habit. Dropping the rule that an `add` CANCELS a prior `remove` of the same id
  left every row green — yet with the id in both sets the handler writes the reborn item's file,
  writes queue.json naming it, and then executes the retirement, deleting the file it just made.
  The run is left with a queue entry whose item is absent: the exact wedge this correction exists
  to prevent, reintroduced by the fix for it. Row `C035-remove-then-readd-is-one-net-birth` now
  covers both directions plus the laundering attempt (remove-then-add does NOT make a PUBLISHED
  item amendable). Re-mutated afterwards: it re-reds, and so does the mirror mutation.

  **ORCHESTRATOR ERROR, recorded so it is not repeated:** the first mutation harness reverted with
  `git checkout <file>`, which discards UNCOMMITTED work — it threw away the tools.ts half of this
  fix mid-round. Mutation reverts must restore from a file snapshot taken before the first
  mutation. Nothing was lost (the edits were re-applied from the same strings) but the rule stands.

- **MINOR (CLOSED by C-039's D1(a) — the union resolution removed the single-element rule entirely) — validate's scopePattern.** C-034 recorded that `runVerify` takes
  ONE scopePattern while an item may carry several fileScope entries selecting different §2.1
  scopes, and settled for the first entry with the limitation raised at the Phase 9 gate. The
  independent draft proposes deriving the pattern from the item's fileScope as a UNION instead,
  which is better if it can be expressed. Re-examine when the queue_amend fix lands: if a single
  runVerify call genuinely cannot express the union, the limitation stands and stays a gate item;
  if it can, take it.

## C-036 — the roster-sizing rule, decided once (closes C-032's parked finding E14)

**The question.** C-032's E14 observed that two stages in one file disagree: `handlePlanReview` floors
its roster at its lens set (`Math.max(readFanout(...), PLAN_REVIEW_LENSES.length)`) while
`handleVetTest` sizes purely by `readFanout`, so a low `parallel.maxReaders` silently reduces critic
COVERAGE. It was parked as "decide the rule once and apply it to both stages". Promoting 9.5a forced
the decision, because item review has FIVE lenses §3.3 calls "never truncated by configuration".

**The rule.** FLOOR AT THE SET WHERE THE SPEC NAMES A COVERAGE SET; CLAMP TO `readFanout` WHERE THE
SPEC NAMES ONLY A COUNT. A named coverage set is a correctness requirement — dropping a lens means a
plan or an item "passed review" on evidence nobody gathered. A bare count is a throughput knob, and
clamping it costs breadth of opinion, not coverage.

| stage | what the spec names | rule | committed state |
|---|---|---|---|
| planReview | FOUR lenses (§3.2) — a SET | floor | 9.3 already floors; its recorded deviation is hereby JUSTIFIED, not merely noted |
| itemReview | FIVE mandatory lenses (§3.3), "never truncated by configuration" — a SET | floor, via clamp(.,3,6) + pairwise merge so three sessions still cover five lenses | 9.5a must implement |
| vet | "vetCritics parallel critics" — a COUNT, no named set | clamp | 9.4a already clamps; nothing to change |
| skeptics | skepticsPerFinding — a COUNT | clamp | unchanged |

**Consequence:** `parallel.maxReaders` is a wall-clock concurrency ceiling the fan-out engine enforces
internally, and is NEVER a coverage truncation. **No committed code changes** — the rule ratifies what
9.3 and 9.4a already do and tells 9.5a what to do. E14 can be closed at the Phase 9 gate rather than
carried into it.

## C-037 — rulings from the 9.5b/9.6 fact-check (one of them fixes a gate/handler split I created)

**How it was found.** Before promoting the last two Phase-9 drafts, a verification pass checked every
factual claim in them against HEAD — the same discipline that caught the `excludeTestFiles` misread.
It found six things worth deciding and one outright defect-in-waiting.

### 1. MAJOR (mine) — the report precondition would have split gate from handler
C-032 changed `legalTools`' report precondition from `items.every(isSettled)` to
`items.every(it => isSettled(it) || stuck.has(it.id))` (the `cannotEverPublish` fixpoint). The 9.5b
draft — written earlier — pins `handleReport` to `isSettled` ALONE. Implementing it as drafted would
make the HANDLER STRICTER THAN THE GATE: the gate offers `conductor_report` for a run holding a
permanently-stuck item, and the handler would refuse it. That is precisely the gate/handler
disagreement the 9.4a `depsReady` binding exists to close, and I would have created it myself.
**RULING:** core/gates-phase.ts EXPORTS one settled-for-report predicate (isSettled ∪ cannotEverPublish)
and BOTH the gate and handleReport call it. This also discharges C-032's parked F5 (the §4.2 readiness
rule written twice) by establishing the principle: **a rule the gate enforces and a handler re-checks
must have exactly one derivation, exported from core.**

### 2. §3.3 vs §3.9 are about DIFFERENT modes — not a contradiction
The draft read them as conflicting. They are not: §3.3:1298 says `git.mode:"read-only"` still RUNS
publish and writes the prepared batch into the report *instead of* committing; §3.9:1502-1503 says
NO-GIT mode *disables* publish, items terminating at REVIEWED.
**RULING:** read-only → publish runs, commit replaced by report content, item reaches PUBLISHED.
no-git → publish is not legal, items terminate at REVIEWED, and the §3.2 all-settled precondition must
accept a REVIEWED-terminal item under no-git. Two different rows, not one.

### 3. The batch carrier: NOT the journal
The draft proposed carrying the prepared batch between publish and report in a journal payload.
Verified defective: journal records are hard-capped at 32 KiB and `shrinkToFit` silently replaces an
oversized `data` with `{truncated:true}` (journal.ts:58,142-159). A per-file diff would be truncated
and the report would lie.
**RULING:** publish writes the batch as a runDir ARTIFACT that report reads. This is a §1.2 layout
deviation (recorded, not a closed-vocabulary widening) and is the honest carrier.

### 4. Nobody writes the stale-red registry
`store.addStaleRed` has ZERO production callers at HEAD, yet §2.11 requires entries "written when a run
terminates with any item below GREEN whose test files exist", and BOTH the `done` report (§3.2:1147)
and the stop-report (9.5c) must list them.
**RULING:** ONE shared registration helper, called on every terminal path — 9.5b's done-report and
9.5c's stop-report alike. Neither task may write its own copy.

### 5. TREE IDENTITY IS TWO DIFFERENT THINGS (architectural, found here first)
evidence.ts's `tree` is an ITEM-ID SLUG — `markerPathOf` runs `assertSafeId(tree)`, which rejects any
string containing `/` (evidence.ts:634). gates-edit.ts's `tree` is a PATH — `normalizeUnderTree` strips
it as a path prefix and the freeze compares `verifyInFlightTree === sessionTree` as paths
(gates-edit.ts:120-131, 181-182). In worktree mode the fanout `tree` is the worktree PATH. **No
committed code maps between them**, so a verify marker written under a slug can never match a freeze
check keyed by a path — the freeze would silently never fire in worktree mode.
**RULING:** the slug stays authoritative for the marker (relaxing `assertSafeId` is an F3
trust-boundary change and is refused). Whoever computes `verifyInFlightTree` for the gate must
translate slug → path via the item's `worktree` field. That mapping belongs to the gate-wiring layer,
is a 9.6 assertion row, and is raised at the Phase 9 gate because it also touches §5.3's wiring.

### 6. archiveRun cannot do what the draft asks
`archiveRun` (state.ts:552-557) clears a pointer, deliberately deletes nothing ("archiving is not
deletion"), and has NO production caller. A row asserting it removes worktrees asserts an effect that
cannot happen.
**RULING:** worktree removal lives in adapter/worktrees.ts and is called by the run-lifecycle owner
(Task 10.1), never by state.ts. state.ts does not gain an adapter→adapter edge.

### 7. The demotion's journal event — the two drafts disagreed
9.5b proposed `fsm: transition {demotion:true}`; 9.6 proposed `state: item.updated`, for the same
helper. §4.2:1617 mandates the drop (REVIEWED → GREEN) and `legalItemTransition` has no backward edge.
**RULING:** `state: item.updated`. Calling it `fsm: transition` would claim a transition the FSM
denies. The demotion is an administrative write, it goes through the store (G6), it is ONE named
helper shared by 9.5b and 9.6, and adding a backward FSM edge stays a STOP-AND-PARK.

### 8. Coverage the drafts miss (rows to add when promoting)
Publish is SERIAL IN ITEM ORDER (§4.2:1572, §4.3:1633) — no row asserted it. The `commit-and-push`
push leg (§3.3:1296) — no row. And §3.2:1144-1148's fuller report content (per-item red proof and
review rounds, the decision-ledger summary, the newly-registered stale-red files) — the 9.5b bullet
abbreviates it and the draft followed the abbreviation.

## C-038 — retroactive adversarial review, C++ half (Task 11.4): the thread budget could wrap negative

**How it was found.** The review panel I owed on the two tasks built while subagents were unavailable:
7 blind lenses across the committed 9.4b and 11.4 diffs, 3 refute-biased skeptics per major.
19 majors survived across the lenses, deduping to ~9 distinct defects. This entry covers the three
C++ ones; the TypeScript half follows separately. NOTE: 7 skeptic sessions died on transient
connection errors, so 5 findings had UNDER-DELIVERED panels — per the 9.5a rule their missing verdicts
counted as UPHOLDS, and the orchestrator re-verified each of those in source before acting rather than
taking the count on faith.

- **MAJOR — signed overflow in the listener sizing yielded a ONE-THREAD listener.**
  `taskQueueThreadsFor` was plain `int` arithmetic over two schema-unconstrained knobs:
  `maxQueued + maxInflightPerModel + 8`. A large-but-schema-legal value OVERFLOWS it; signed overflow
  is UB and clang -O2 wraps NEGATIVE. A negative sum is `<= 256`, so the clamp returned EARLY and never
  clamped, and `Router::start` then built `ThreadPool(threads < 1 ? 1 : threads)` — a ONE-THREAD
  listener. That silently INVERTS the exact pool-exhaustion property [11.4-health-at-full-queue]
  exists to prove: one blocked handler would wedge the whole router, health endpoint included.
  A probe against the committed header at the target's own flags: `maxQueued=2147483647` gave
  `computeTaskQueueThreads = -2147483637` and `ThreadPool(1)`.
  FIX: the sum is computed WIDE (`std::int64_t`, each addend widened before the addition) so it cannot
  wrap; the int-returning entry point saturates into `[1, INT_MAX]`; and the clamp compares the EXACT
  sum, so an enormous maxQueued can no longer masquerade as "inside the budget".

- **MAJOR — the admission integers had NO range validation.** The schema types them as bare `number`
  with no integer/minimum, and unlike the two PORTS — which the parser range-checks 1..65535 precisely
  because the schema cannot — admission got nothing. Zero or negative `maxInflightPerModel` makes
  `hasFreeSlot` never true so every request queues until it times out; fractional values truncate.
  FIX: `checkAdmissionInteger`, written in the same shape as the existing `checkPort`, refusing
  non-integral first and then the range, throwing ConfigError NAMING the dotted field. Bounds:
  `maxInflightPerModel 1..1000000`, `maxQueued 0..1000000`, `queueTimeoutMs 0..86400000`. The slot
  ceiling is what makes the sizing sum PROVABLY representable, and at ~4000x the whole thread budget
  it refuses nothing an operator meant.

- **MINOR — the clamp named the wrong knob.** When `maxInflightPerModel` ALONE exhausted the budget,
  the refusal named `admission.maxQueued` — a field no value of which would have helped. FIX: compute
  the in-flight side's cost first and name the field that is actually unsatisfiable; the existing
  `effective < 1` branch still names maxQueued, so the committed boundary at 248 is unmoved.

- **Mutation discipline, and an honest coupling the fixer surfaced.** Reverting the widening fails
  exactly one case (orchestrator-verified independently). Removing all three range checks fails TWO
  cases — because the chosen remedy for an out-of-range value IS the named refusal — so the fixer ran
  a SECOND mutation keeping the upper bounds and dropping only integrality and the lower bounds, which
  isolates the halves cleanly. Reporting that coupling rather than hiding it behind a green mutation
  table is the right instinct.

- **Residual, reported not fixed:** a RouterConfig built IN CODE (parser bypassed) with absurd values
  now saturates to INT_MAX threads, so `Router::start` fails loudly instead of silently running one
  thread. No parsed config can reach it, and a loud failure beats a wedged router.

- **Blast radius:** `src/router/config.hpp` (+106/-9), `src/tests/admission_test.cpp` (+182/-0, purely
  additive — no existing assertion touched). ctest 36/36 (21072 assertions), stable across three runs.

## C-039 — retroactive adversarial review, TypeScript half (Task 9.4b): a verify that ran NOTHING reported green

Companion to C-038 (same review round: 7 lenses, 3 refute-biased skeptics per major, 19 majors
surviving across lenses and deduping to ~9 distinct defects). Five landed on 9.4b; all fixed
test-first, each pinned by a mutation.

- **MAJOR — the false green.** `handleValidate` derived the whole verify from `queueItem.fileScope[0]`.
  When that ONE path matched no `verify.requiredScopes` pattern, `selectScopes` returned [],
  `runScopes` returned {}, and `green = Object.values({}).every(...)` is VACUOUSLY TRUE — so the §2.6
  ledger recorded `green:true, scopes:{}` and the item advanced GREEN->VALIDATED having executed
  nothing. On a behavioral:false item that verify is the item's ONLY evidence (plan line 1198).
  The control that makes it undeniable: same config, same two files, and merely REORDERING the
  fileScope array flips it between a vacuous green and a real red — model-authored array order decided
  whether the config's own required scope ran. The 13 committed rows could not see it because the
  fixture config is `requiredScopes:[{pattern:"**"}]`, which matches every path.
  The deeper cause, which one lens named exactly: `handleValidate` RE-DERIVED scope selection with its
  own one-line rule instead of the rule `itemVerifyScope` already owned, and the two disagreed.
  FIX, three layers: (a) one shared `requiredScopeNames(config, paths)` resolves the union over
  testScope ∪ fileScope for BOTH paths, with `evidence.ts` `selectScopes`/`runScopes`/`runVerify`
  widened to `string | string[]` (backward compatible — every committed caller passes a string);
  (b) a NAMED refusal when no entry covers the item, before anything runs; (c) an empty `scopes` map
  is not admissible for the edge. **This also CLOSES C-034's recorded limitation and C-035's minor open
  item** — the "only the first entry's scopes run" partial-coverage problem is gone, because there is
  no longer a first entry.

- **MAJOR — the foreign red set quarantined files that do not exist.** `foreignRedSet` emitted every
  below-GREEN sibling's DECLARED testScope paths without checking existence; `quarantineFiles` calls
  `renameSync`, which throws ENOENT (not EXDEV, so it rethrows), the rollback re-raises, and
  `handleValidate` dies. Trivially reachable: a sibling at PENDING has not had its test WRITTEN yet.
  FIX: skip paths absent under `store.root`, in the one place that feeds both the validate and the
  mark_green item-test paths. quarantine.ts untouched. The test also pins that an EXISTING sibling red
  is still quarantined, so the filter cannot disable the mechanism it guards.

- **MAJOR — queue.json was swapped before the decision was validated.** `handleQueueAmend` wrote
  queue.json first and called `appendDecision` second, but `appendDecision` performs the §2.7 SCHEMA
  check — so a record failing it threw AFTER the queue was replaced: the caller is told the amendment
  failed while the run now executes the amended queue. FIX: the schema half was extracted as
  `assertDecisionValid` (reused, not duplicated) and runs before any write.

- **MAJOR — mark_green judged the blocked rule against a stale snapshot.** Legality was evaluated
  against the item loaded BEFORE the implementer sub-session ran, then GREEN was persisted onto a
  freshly loaded item — so anything that blocked the item during that window was overwritten. FIX:
  re-load immediately before the check and persist that same object. The fixer found the identical
  hole two lines up on the non-behavioral path and fixed both.

- **MAJOR — the own-tests guard was exact string equality.** C-034's guard compared raw queue.json
  strings, so `./tests/a.test.mjs` walked straight past it and the item's own red got quarantined —
  a false green. FIX: normalize both sides (`path.normalize` + forward slashes; a traversing `..` is
  preserved so the quarantine still refuses it).

- **The fixer applied C-034's own lesson to its own fix, and it paid.** After fixing D5 it mutated the
  SECOND half of the new guard (the queue-side normalization) and found 952/952 still green —
  unpinned. It split the row into two sub-cases (odd spelling on the registry side, odd spelling on
  the queue side) and confirmed each mutation now fails exactly one. This is the discipline C-034
  introduced propagating to a different task and a different author.

- **Blast radius:** `conductor/adapter/evidence.ts` (+14/-6, signature widened compatibly),
  `conductor/adapter/tools.ts` (+110/-27), `conductor/tests/tools-9.4b.test.ts` (+464/-0, purely
  additive). 954/954 green, typecheck and bun legs clean. Orchestrator independently re-ran the D1(a)
  mutation: reverting the union resolution fails 2 rows and nothing else.

## C-040 — six rulings the 9.5b/9.6 promotion surfaced, plus an empirical correction to a Phase-4 binding

Promoting the two specs (15 rows -> 30 for 9.5b, 13 -> 21 for 9.6) raised six questions C-037 did not
cover. Rulings, so the implementers do not have to guess:

1. **No-git makes the gate and the handler disagree about publish — the THIRD instance of this shape.**
   `nextStageTool` maps REVIEWED -> conductor_publish UNCONDITIONALLY, and `legalTools` takes no
   git-mode input, while §3.9:1502-1503 disables publish in no-git mode. Config carries no `noGit`
   field and `git.mode:"read-only"` cannot distinguish the two modes — only `gitio.isRepo` can.
   **RULING:** extend `legalTools` with a fifth parameter `gitAvailable = true`, beside the
   `repoConfigured` boolean it already takes. It DEFAULTS to true, so every committed call site and
   test is unaffected and no behaviour changes silently; the no-git case is pinned by new rows.
   Deriving it inside core is impossible (that would need I/O), so a caller-supplied fact is correct.
   NOTE the pattern: this is the third time one rule has lived in two places and drifted — after the
   9.4a dependency rule and C-037's report predicate. Raise it as a THEME at the Phase 9 gate.

2. **The closing verify has no subject item.** `runVerify`'s second argument is `itemId` and
   `evidenceRecordSchema` REQUIRES itemId, but the done-report's closing verify is run-level.
   **RULING:** pass the runId, with scopePattern `"**"`, and document at the write that on this ONE
   record kind the subject is the run rather than an item. Widening SCHEMAS to make itemId optional is
   a STOP-AND-PARK and is not taken. Flag the overload at the Phase 9 gate.

3. **Serial publish invalidates the next item's green.** Publish is serial in item order and each
   commit MOVES HEAD, so the next REVIEWED item's freshness check legitimately fails — its verify ran
   against a different HEAD, even though its own code did not change. 9.5b denying it is correct and
   honest; what the driver does with the denial was unruled.
   **RULING:** the denied item routes back to RE-VALIDATE (GREEN->VALIDATED again), not to blocked. A
   stale green must not ship, and the item is not in trouble — the world moved under it. This costs one
   verify per published item; record that cost at the Phase 9 gate rather than trading correctness for
   it.

4. **Push failure (§3.3:1296 is silent).** **RULING:** the commit STANDS and the item stays PUBLISHED
   — a commit is local and real, a push is a separate outward action — with the failure journaled at
   warn and named in the report. A failed push must never silently look like a successful one.

5. **`mergeBack`'s signature.** The plan sketches `mergeBack(workspace, itemId)` (2706), which cannot
   compose the `conductor/<runId>/<itemId>` branch name it needs. **RULING:** `(workspace, runId,
   itemId)`, recorded as a deviation from the plan's sketch.

6. **The publish batch artifact.** **RULING:** `runs/<runId>/publish-batch.jsonl`, a recorded §1.2
   (lines 426-437) layout deviation. It ships UNVALIDATED — adding a SCHEMAS entry for it is a
   STOP-AND-PARK — with its shape pinned by assertions only.

### An empirical correction to the Phase-4 binding (C-021), acknowledged
The promotion pass tested the C-021 binding's own parenthetical suggestion, `--absolute-git-dir`, on a
real fixture (git 2.50.1) and found it **WRONG**: in a linked worktree an exclude written into the
per-worktree gitdir is INERT — the path stays untracked — and only the COMMON dir works.
**ACKNOWLEDGED:** the 9.6 row pins `git rev-parse --git-common-dir`. A recorded binding that turns out
to be empirically false gets corrected, not honoured; the binding's INTENT (don't crash, and actually
exclude) is what survives. Supporting facts also verified on the fixture: `<wt>/.git` is a FILE, so
`mkdir -p <wt>/.git/info` raises ENOTDIR; `isRepo()` returns true inside a linked worktree and so does
NOT guard the call; a bare `worktree add` names the branch after the path basename; and
`worktree remove --force` LEAVES THE BRANCH BEHIND, which is why removal is split into two rows.

### One draft claim I had asserted that was itself wrong
I told the promotion pass that the draft's `planLines [2700,2725]` "cut off the `git worktree prune`
clause". It did not — that clause is at 2724, inside the range. The widening to [2699, 2728] is
correct for section boundaries but is directive-driven, not defect-driven, and the record says so.

## C-041 — Branch B: no task in the plan makes llama-router runnable (RESOLVED at 11.8)

**How it was found.** The 11.8 assertion-promotion pass checked the plan's own premise instead of
taking it: plan:2857 says "run llama-router against it", so the pass asked whether the binary can
be run at HEAD. It cannot. `src/main.cpp` is still the Task 11.1 scaffold — no argc/argv, no config
load, no Router — and its own comment claims "the real CLI ... lands in Tasks 11.2-11.7". Every one
of 11.2-11.7 is a HEADER-ONLY library task whose bullets never mention a CLI, so the comment
describes work no bullet ever assigns. 11.8 is the first task that runs the binary at all.

This is a genuine gap in an IMMUTABLE plan, not a misreading. The plan cannot be edited, so the
question is only which task absorbs the work.

- **RULING: 11.8 lands the minimum CLI, test-first.** 11.8's Step 1 presupposes a runnable binary,
  so 11.8 is unexecutable without it; no later task can supply it either, because 12.1's serve.py
  *launches* the binary and therefore needs it to already exist. NEW header-only `src/router/cli.hpp`
  exporting a PURE `parseCli` (args EXCLUDING argv[0]) + NEW `src/tests/cli_test.cpp` (red first, as
  a compile failure, like every other Branch B task) + `src/main.cpp` rewritten as a thin adapter
  over it. The pure/adapter split is what keeps the parse doctest-reachable while the parts that
  need a live socket stay in the live artifact.
- **CONSEQUENCE: 11.8's tier moves C → B** and STATE.json records the deviation. Tier C means
  mechanical; a task that lands a new header, a new doctest file and a rewritten entry point is not.
  The live-artifact obligation (M8: verbatim command lines, cwd, raw output, exit codes) still
  applies to the smoke half.
- **`--schema <path>` is REQUIRED with no default and no search path.** `parseRouterConfig` reads a
  schema file on every parse and the only schema in the tree is a build-time export into the SOURCE
  tree. Any search path (exe-relative, cwd-relative, $PREFIX/share) would be a SECOND source of
  truth for the config shape, which is the exact thing the exported-schema design exists to prevent,
  and a wrong guess would fail with a file-not-found instead of a named field. 12.1 inherits a
  stated contract rather than a discovered one.
- **Exit codes pinned here so 12.1's supervisor inherits them rather than guessing:** 0 clean
  shutdown after SIGINT/SIGTERM, 2 usage error (stderr names the offending flag, then usage),
  3 ConfigError (stderr carries `ConfigError::field()` verbatim), 4 listen bind failure (stderr
  carries host:port). Only the exit-2 family is doctest-reachable — it is a pure parse verdict;
  the rest are recorded live from raw output.

**Two further 11.8 resolutions worth reading at the Phase 11 gate rather than rediscovering:**
11.8 does NOT discharge Task 11.1's Step 2 (it observes four of the six items but cannot produce
the effective concurrent slot count for N∈{1,2,4,8} with and without `--parallel`, which is the
load-bearing number, so `WIRE_CONTRACT_VERIFIED:` stays `<pending>`); and "the dashboard (if built)"
resolves FALSE — there is no dashboard target and 11.8 must not add one, since Branch B's build
deliberately excludes ftxui.

**A cross-spec obligation that was already satisfied.** 11.8's smoke wants to read the metrics
ledger while the router is still up, which only works if 11.7 appends per request instead of
buffering to shutdown. Checked rather than assumed: 11.7's promoted spec already pins it
(`11.7-streamed-line-once` requires the line to be present after the stream completes and before
shutdown, and `11.7-ledger-line-per-request` requires one line per request). No change needed —
recorded so the Phase 11 gate does not re-litigate it.

## C-042 — Task 9.5a: item review adjudicates EVERY finding; plan review adjudicates majors only

**How it was found.** Not by a review — by the 9.5a test-writer reporting, unprompted, that its own
suite could not decide the question. That is the behaviour worth reinforcing: it delivered 27
green-under-stub tests, mutation-tested all eight of its load-bearing rows, and then said which
assertion its fixtures could not discriminate.

**The ambiguity.** Spec row `9.5a-skeptics-findingsurvives` says "every finding gets exactly
workflow.skepticsPerFinding skeptic sub-sessions". Committed `handlePlanReview` does something
else — `adapter/tools.ts:1743` filters `severity === "major"` and only majors get panels. Every
finding in every 9.5a fixture is severity `major`, so a majors-only implementation and an
all-findings implementation BOTH pass the suite. An untestable row is not coverage.

**RULING: at item review every finding gets a panel; plan review keeps its majors filter.** The
difference is structural rather than stylistic, and both halves are right for their own site:

- Plan review answers ONE binary question — does this plan pass. Only majors bear on it, so
  adjudicating a minor would be waste with no consumer.
- Item review's OUTPUT IS ROUTED FIXES. A finding that reaches a fix dispatch unadjudicated is a
  fix demand nobody checked. And `9.5a-adjudication-ordering` acts explicitly on the quality lenses
  (test-adequacy, minimality, perf), which are routinely not major — under a majors-only rule their
  survival would never be decided at all and that row would describe a path that cannot occur.

`handlePlanReview` is NOT changed. A new row `9.5a-skeptics-cover-non-major` was commissioned to
close the hole: it must fail against a majors-only implementation and pass against the delivered
one, proven by mutation rather than asserted.

**THIS IS THE FOURTH INSTANCE OF THE PHASE 9 THEME and it is now the gate's headline item.** One
rule living in two places has drifted at: the 9.4a dependency rule, C-037's report predicate,
C-040's no-git publish gate, and now the skeptic-panel scope. Three of those four were caught by
something OTHER than a review panel — a diff read, a mutation, and a test-writer's own honesty.
The Phase 9 MILESTONE gate must not merely re-check these four sites; it must ask whether the
codebase has any remaining rule that is DERIVED twice rather than exported once, because the
recurrence rate says the answer is yes.

## C-043 — two rulings the 9.5b/9.5c reds need before either is implemented

Both were surfaced by the test-writers themselves, in their own `concerns`, rather than by a review.

### Ruling 1 — no-git publish is a REQUIRED input to legalTools, not an optional one

The 9.5b writer pinned "an OPTIONAL fifth parameter defaulting to true, so no committed call site
changes". **OVERRIDDEN.** An optional parameter with a default IS a compatibility shim, which
`.claude/rules/patterns-and-conventions.md` prohibits outright ("no legacy wrappers", "update all
call sites", "no transition periods"), and it defaults in the DANGEROUS direction: every existing
call site would silently keep claiming publish is available, which is exactly the bug — under
no-git §3.9:1502 disables publish and items terminate at REVIEWED, yet `nextStageTool` maps
REVIEWED to `conductor_publish` unconditionally.

`publishEnabled: boolean` is a REQUIRED fifth parameter of `legalTools`, sibling to the existing
required `repoConfigured`, and all three committed call sites (`adapter/inject.ts:111`,
`adapter/tools.ts:2332`, `adapter/tools.ts:4625`) must state it explicitly. A call site that has to
name its git mode cannot forget to have one.

**Verified against HEAD rather than taken from the spec**, because the spec's phrasing was loose:
`legalTools` DOES already take a boolean, but it is `repoConfigured`, which gates `conductor_setup`
(gates-phase.ts:246 — unconfigured ⇒ only setup and status are legal). It has nothing to do with
git availability, so the spec's claim that legalTools "takes no git-mode input" is correct in
substance. `GateRun` was considered as the carrier and rejected: it is the gate's subset of RUN
STATE (state, stop, classification), and git mode is configuration.

### Ruling 2 — handleReport's input surface is 9.5b's, and 9.5c's fixture yields to it

9.5c's red was written before 9.5b's existed and pins `handleReport` WITHOUT the `fanout` field
that 9.5b's red pins as required (9.5b red line 174 vs 9.5c red line 687's `reportInputFor`). Its
author flagged this honestly: "handleReport is 9.5b's export and does NOT exist yet ... this file
is the first artifact to pin handleReport's input surface."

**9.5b owns the export, so 9.5b's surface is authoritative.** When 9.5c's red is moved into the
tree it will fail to typecheck on the missing field, and the orchestrator will add `fanout` to
9.5c's `reportInputFor` FIXTURE. Recorded in advance and deliberately: editing a red's fixture to
match a surface an earlier task legitimately owns is not the same act as editing an ASSERTION to
make it pass, and pre-authorising it here is what keeps the two distinguishable. No 9.5c assertion
changes; if any does, that is a defect and must be re-derived.

## C-044 — the tool surface and the handler surface disagree in more places than C-035 (MAJOR)

**How it was found.** The 13.1 spec-promotion pass reported SG-1 as a MAJOR: "the plugin
composition root has no owning task". That prompted a SYSTEMATIC audit rather than a spot check —
every tool's declared `args` extracted from `plugin/index.ts`, every `*Input` interface extracted
from `adapter/tools.ts`, infrastructure fields subtracted, and the two lists compared mechanically.
C-035 was found by comparing ONE handler against ONE tool. Comparing all 22 at once found more.

### Finding 1 — the composition root IS assigned, but to two words

VERIFIED AT HEAD: `plugin/index.ts` binds every one of its 22 tools to `handlerNotBound` (:203),
which throws. It imports exactly three things from `adapter/tools.ts` — `classifyTool`,
`CONDUCTOR_TOOL_NAMES`, `gateBeforeToolCall` (:34) — and not a single `handleX`. Nothing outside
`conductor/tests/` calls any handler. At HEAD the product is INERT: nine phases of handler work are
reachable only from tests.

13.1's spec is right that no bullet EXPLICITLY claims the composition root, but it is not
unassigned: plan:2917 requires "REAL plugin hooks + REAL handlers" and plan:2958 says "Red → **glue
fixes** → green (this is the harness proving itself)". "Glue fixes" IS the assignment. No plan
change is needed and none is made.

What IS wrong is the timing. Leaving every tool-to-handler correspondence unverified until the last
coding task means each of Phases 9-12 can add another mismatch, and 13.1 discovers them all at once
in the task least able to absorb surprises. C-035 already proved the drift is real.

### Finding 2 — two committed mismatches the audit found

- **`conductor_decide`.** Plan:1322 and the plugin both declare `{question, options[], choice,
  why}`, but `DecideInput` (tools.ts:723) additionally requires `kind: "derived" | "human"` and
  `appliedWhere: string`. RULING: `kind` is FIXED by the composition root, not a tool arg — §2.7
  (plan:865) defines `"human"` as "was asked", and a decision the orchestrator records through a
  tool call was by definition not asked of a human, so it is always `"derived"` (the path that
  carries a human's answer is `conductor_answer`). `appliedWhere` cannot be synthesized and becomes
  a declared arg.
- **`conductor_queue_amend`.** Declares `{ops}` alone, but `QueueAmendInput` requires the whole
  §2.7 record — `question, options, choice, why, appliedWhere`. This is the OTHER HALF of C-035,
  which fixed only the `ops` half. RULING: the tool declares them. §2.7 demands ≥2 SCORED options
  and a rationale for a derived decision; no code can invent a rationale, and templating the
  options would mean fabricating scores. Plan:1323's `{ops[]}` is shorthand — its own effect column
  says "+ decision record", and §2.7 is what a decision record costs.

### The fix: make the correspondence a construction, not a convention

Patching two instances would leave the third to be found at 13.1. Instead, following the precedent
`conductor/tests/single-source.test.ts` already sets for the FSM vocabularies:

1. ONE exported binding table — tool name → {handler, infrastructure fields the root supplies,
   fixed values like `kind: "derived"`}. This is data the composition root will CONSUME at 13.1,
   so it is written once rather than derived twice (the Phase 9 theme, again).
2. A structural test asserting, for every tool that has a handler, that the handler's required
   input fields are exactly covered by the tool's declared args ∪ infrastructure ∪ fixed values.
   Any future handler whose input drifts from its tool goes RED at the gate that adds it, not at
   13.1.

**SEQUENCING:** deliberately NOT landed in this round — the 9.5a implementer is editing
`adapter/tools.ts` right now and a new test file would change the suite count under it. Lands
immediately after 9.5a commits, before 9.5b starts, so 9.5b's and 9.5c's new handlers are the
first to be born under the guard rather than retrofitted into it.

## C-045 — a committed test file was BINARY, so grep silently skipped 26 tests (MAJOR, detection integrity)

**How it was found.** By accident, and that is the point. While checking a claim the 9.5a
implementer made about a 9.4c row, `grep -c "9.4c" conductor/tests/tools-9.4c.test.ts` returned
NOTHING — on a 109 KB file whose FIRST LINE contains "9.4c". Every grep against that file had been
returning empty, and had been doing so since the file was committed.

**The cause.** One literal NUL byte at line 797, used as a composite-key separator in a fixture
(`role` + NUL + `itemId` — a normal idiom, since NUL cannot occur in either component). `file(1)`
classifies the file as `data`, and GREP SKIPS BINARY FILES. The 26 tests in it were invisible to
every text-based audit: coverage sweeps, "does any test already pin X", the review lenses' own
searches, and the orchestrator's. My earlier row-coverage audits happened to use Python's
`open().read()` and were unaffected; anything shell-based was not.

Nothing was ever red. The suite passed at every gate, M4 passed, the reviews passed. This is the
failure mode this build fears most: not a red that shouts, but a CHECK THAT QUIETLY INSPECTS LESS
THAN IT CLAIMS TO. A green suite proves the tests that ran; it says nothing about a search that
silently covered 25 files instead of 26.

**The fix.** The separator is now a six-character backslash-u escape instead of a raw byte. The
runtime string is byte-for-byte identical — this changes the file's ENCODING, not its semantics —
and the suite is unchanged at 1022/1022. Both the committed file and its parked staging copy were
fixed.

**The guard.** NEW `conductor/tests/source-hygiene.test.ts` walks the repo (skipping `.git`,
`node_modules`, `.out`, `.data`, `.conductor`, `staging` and `extern` — vendored third-party source
is not ours to police, and ftxui's terminal-parser tests legitimately embed ESC) and fails if any
file with a source extension carries a NUL or other forbidden control byte. Tab, newline and
carriage return are text; everything else below 0x20, plus DEL, is not.

Two things the guard does deliberately. It asserts the walk found more than 100 files, because a
guard whose traversal breaks would otherwise pass VACUOUSLY — the same defect class it exists to
catch. And its extension list is an allowlist rather than "everything not binary", so a new binary
ASSET cannot fail it while a new SOURCE type has to be added on purpose.

VERIFIED TO DISCRIMINATE: reintroducing the NUL turns it red; restoring turns it green.

**A standing lesson for every audit in this build, mine included.** An empty grep result is not
evidence of absence until you have confirmed grep actually read the file. Prefer a reader that
fails loudly on undecodable input over one that skips quietly.

## C-046 — Task 11.6: a pinned rule that passed for a masked reason (closed at delivery)

**How it was found.** The 11.6 implementer mutation-tested its own work eight ways, reported seven
kills, and DISCLOSED THE ONE SURVIVOR rather than quietly dropping it from the table. That is the
behaviour this build wants and it is worth naming: a surviving mutation is information, and an
implementer that hides it converts a suite hole into a silent one.

**The hole.** `observe_response` opens with a gate that returns an empty verdict when the response
was streamed — §4.4's "streamed implies unobservable". Removing `|| isStream` from that gate left
the whole 49-case suite GREEN. The reason is masking, not deadness: every `isStream=true` fixture
hands SSE bytes (`data: {...}` frames), which are not a JSON envelope and therefore fail the
envelope-parse gate a few lines later. The empty verdict arrived for two independent reasons, so
the suite could not tell which one produced it.

The gate is not redundant. It is the pinned rule, and it is the only protection when a caller hands
`isStream=true` together with a body that DOES parse — a buffered copy of a streamed response.
Task 11.7 is the very next task and is exactly such a caller, which is why this was closed on
delivery instead of being carried to the Phase 11 gate.

**The fix (orchestrator, added to `[11.6-stream-verdict-null]`).** The discriminating input is a
body that WOULD have produced a verdict, presented as a stream: a well-formed `chat.completion`
envelope whose `choices[0].message.content` conforms to the declared schema. The row now asserts
BOTH directions over identical bytes — `isStream=false` yields an engaged, true verdict (the
premise, so the test cannot pass because the fixture was simply unverifiable), and `isStream=true`
yields an empty one. The only difference between the two calls is the flag.

VERIFIED TO DISCRIMINATE: with `|| isStream` removed the suite is 48/49 with
`[11.6-stream-verdict-null]` red, and only that row; restored, 49/49 at 21,883 assertions.

**The general lesson, which is the same one C-045 taught in a different costume.** A green
assertion proves the outcome, not the mechanism. When two independent gates can each produce the
expected result, the test pins neither — so a fixture must be chosen that only ONE of them can
explain. Mutation testing is what surfaces this; nothing else in the build would have.

## C-047 — two tools could never have completed a single call (MAJOR); the guard gains a SHAPE half

**How it was found.** By the C-044 guard's own author, in its `concerns`, one step after finishing:
the guard it had just built checks that every required handler field is SUPPLIED by something, and
it noticed that nothing checks WITH WHAT TYPE. It reported the gap rather than shipping past it.

**The defect.** Both `conductor_decide` and `conductor_queue_amend` declared
`options: S.array(S.string())`, while `DecideInput`/`QueueAmendInput` take
`Array<{name, score?}>`. Core `requireTwoOptions` rejects a `kind:"derived"` record with fewer than
two options OR with any option lacking a score; every tool-recorded decision IS derived (C-044's
ruling: §2.7 reserves "human" for a decision that was ASKED, which arrives via `conductor_answer`);
and a bare string cannot carry a ladder-5 score. The composition root may not fabricate one — a
fabricated score is a lie in the decision ledger, which is the one artifact that exists to record
why a choice was made.

So both tools would have been refused on EVERY call. Not degraded: unusable. And both were
NAME-PERFECT the whole time — C-044's equation passed on them the moment the missing names were
added, because names were all it could see.

**The fix.** `tool.schema` IS zod (verified: the package's `tool.d.ts` declares
`var schema: typeof z`), so object shapes were available all along and the string declaration was
simply wrong. §2.7's scored option is now declared ONCE at module scope in plugin/index.ts and
shared by both tools, carrying `name` plus the optional five-criterion `score`. `docs/user/
tool-reference.md` was corrected in the same round — it had listed `kind` as an argument of
`conductor_decide`, contradicting C-044's ruling, and had not listed `queue_amend`'s decision
fields at all.

**The guard's new half — `[C-047-shape]`.** For every declared arg of every bound tool, a COARSE
kind (string / number / boolean / object / array-of-string / array-of-object) is derived from the
zod schema at runtime and from the handler field's type text, and the two must agree. Coarse is
deliberate: a precise structural comparison between zod and erased TypeScript is not available, and
a guard that claims more precision than it has is worse than one that states its resolution. What
it catches is the whole family this defect belongs to — a scalar declared where a structure is
required, or the reverse.

Three anti-rot properties, each verified by mutation:
- Restoring the string options reddens it, naming BOTH tools and both sides of each mismatch.
- Breaking the zod introspection reddens it via the "at least 12 comparable" floor rather than
  passing with zero comparisons — the C-045 failure mode, refused by construction.
- Anything the classifier cannot place is asserted against an EXPLICIT allowlist, so a new
  unclassifiable arg is a red someone must look at. A skip list that grows by itself is how a
  guard rots.

The allowlist has exactly one entry, `conductor_queue_amend.ops`, and the distinction it records is
the substantive one: `ops` is declared `string[]` and bridged to the closed `QueueAmendOp` union by
`core/queue-amend.ts parseAmendOps` — a pure, separately tested widening from C-035 that VALIDATES
what it parses and refuses what it cannot. That is a real bridge. Nothing can bridge an unscored
string to a §2.7 score, which is precisely why one is allowed and the other is a defect.

**The pattern across C-044, C-045, C-046 and C-047 is now unmistakable and belongs at the Phase 9
gate.** Every one was a check that PASSED while inspecting less than it appeared to: a name-level
equation blind to types, a grep blind to a binary file, an assertion satisfiable by two independent
mechanisms, a green suite over an inert product. The build's instinct to make invariants
constructions rather than conventions is the right one; what these four add is that a construction
must also assert IT ACTUALLY RAN — a floor, an allowlist, a premise that fails when the fixture
becomes unverifiable.

## C-048 — C-043 ruling 1 is AMENDED: publishEnabled stays optional, and a construction replaces the requirement

**What C-043 ruling 1 said.** That `publishEnabled` must be a REQUIRED fifth parameter of
`legalTools`, on the grounds that an optional parameter defaulting to `true` is a compatibility
shim (which `.claude/rules/patterns-and-conventions.md` prohibits) defaulting in the DANGEROUS
direction — every existing call site silently keeps claiming publish is available.

**Why it could not stand.** The delivered 9.5b red pins the signature as
`(run, items, questions, repoConfigured, publishEnabled?: boolean)` and calls the gate with FOUR
arguments in two rows. A function whose fifth parameter is required is not assignable to that type —
verified rather than assumed, with a throwaway probe: TypeScript reports
"Types of parameters 'e' and 'e' are incompatible ... 'boolean | undefined' is not assignable to
'boolean'". Making it required would therefore have required editing the test, and the test is the
contract. The rule against editing an assertion to make an implementation fit does not have an
exception for the orchestrator's own earlier ruling.

The red's rationale is also better than mine on a point I had not considered: `publishEnabled` is
DERIVED (`gitio.isRepo(store.root)`), not configured, and `isRepo` shells out to git. `legalTools`
runs on EVERY tool call through the gate hook; the two publish/report handlers run rarely. Making
every gate evaluation pay a subprocess to answer a question only two handlers ask is a real cost my
ruling would have imposed.

**The amended ruling.** The parameter is optional and defaults to `true`. The DANGER the required
form was meant to remove is removed a different way, and a stronger one: the handlers that need the
answer compute it themselves and pass it explicitly, and `settledForReport` takes the same flag, so
gate and handler cannot disagree. What remains is a default that no production decision depends on.

**The residual, stated rather than buried.** `adapter/inject.ts:110` and the two gate-hook call
sites in `adapter/tools.ts` still use the 4-argument form, so the state block the model reads can
name `conductor_publish` as legal in a no-git run even though the handler would refuse it. That is
a DISPLAY inconsistency, not a state one — the handler throws, no publish occurs — but it is real,
it is outside 9.5b's rows, and it is exactly the "gate and handler disagree" shape this build keeps
finding. Raised for the Phase 9 gate with the cost trade-off attached: fixing it means either
threading a cached repo-ness flag through InjectCtx or paying `isRepo` per gate evaluation.

**The lesson, which is the one worth keeping.** A ruling made from the spec can be wrong about the
code. Mine was made before the red existed and reasoned only about defaults; the writer's was made
against the actual type-assignability rules and the actual cost of the call. When a delivered
contract contradicts an earlier ruling, the contract is evidence — check whether the ruling was
reasoning from something it could not see, and say so plainly instead of forcing the code to match
a decision that has been overtaken.

## C-049 — Task 11.7: an unasserted exit path, closed; and a mutation-harness trap worth naming

### The gap, disclosed by the implementer

11.7 threads a ledger line onto FIVE exit paths of `handleProxy`. The implementer reported, in its
own `concerns` and unprompted, that one of them — the `schema.rejectOnMissing` 400 — was ledgered
by the "every request entering the handler" rule but that NO fixture drives that posture with a
ledger attached, because every fixture in the file sets `rejectOnMissing:false`. Its line shape was
therefore reasoned from the spec, not executed.

That is worth closing rather than parking, for a reason specific to this path: the 400 is the only
exit answered BEFORE admission and before any upstream contact, and the posture is OPT-IN. A
missing line there would stay invisible until an operator enabled the posture in production, at
which point the shed tail of their refusals would simply be absent from the §4.4 dataset that
exists to explain exactly that.

NEW row `11.7-reject-on-missing-ledgered` drives the posture, asserts one line at status 400 with
NULL upstream and token columns (null rather than zero — zero would assert a measurement never
taken), and asserts the stub saw no request at all. It also sends a CONFORMING request under the
SAME config and requires it to proxy and ledger: without that half, an implementation that 400s
everything would pass the row.

VERIFIED TO DISCRIMINATE: recording the wrong status at that exit fails exactly one case (66 -> 65)
and restoring returns 66/66.

### The trap: a failed build plus a stale binary reads as a surviving mutation

While independently re-running the implementer's C-033-class mutation (drop `ledgerGuard` from the
chunked content provider's capture list), the edit did not COMPILE — the guard is also referenced
inside the lambda body. The build failed, the previously-built binary was still on disk, and
running it reported **65/65 SUCCESS**. Read casually, that is "the mutation survived and the suite
has a hole". It was neither: the mutant never existed.

This is the same family as C-045 and C-047 — a check quietly measuring something other than what it
claims — and it is the FIRST time the build has seen it in the mutation harness itself, which is
the tool being used to find that family. A harness that can silently report a stale result
undermines every conclusion drawn from it.

**STANDING RULE, now applied in this session's later mutations:** a mutation run must ASSERT THE
BUILD SUCCEEDED before the binary's output means anything. In shell:

    BUILD=$(cmake --build ... --target router-tests 2>&1)
    if echo "$BUILD" | grep -qE "error:"; then echo "INVALID MUTATION"; else ./router-tests; fi

A mutation that does not compile is not evidence of anything and must be replaced by one that does,
never recorded as a survivor. The same hazard exists on the TypeScript side in weaker form — a
type error does not stop `node --test` from running the previous module graph — so mutations there
should be confirmed against the typecheck leg too.

A compiling variant of the same decision was run instead and the implementer's finding stands.

## C-050 — the wave driver cannot drive the last three stages (OPEN; fix queued before the Phase 9 gate)

**The finding.** `handleDispatchWave`'s `defaultStageExecutors()` covers exactly four stages —
`conductor_submit_test`, `conductor_vet_test`, `conductor_mark_green`, `conductor_validate`. It has
no executor for `conductor_item_review` (Task 9.5a) or `conductor_publish` (Task 9.5b), because
neither existed when 9.4c shipped. A VALIDATED wave member therefore cannot be advanced by the
driver at all.

**How bad it is, stated precisely rather than dramatically.** Two facts bound it, and both were
checked rather than assumed:

1. **The run is NOT wedged.** `core/gates-phase.ts:404` still adds the per-item stage tool to the
   legal set for every actionable item, so `conductor_item_review` and `conductor_publish` remain
   directly callable by the orchestrator model. The work can proceed; it just proceeds one tool call
   at a time.
2. **The driver fails HONESTLY, by design.** Committed row `[9.4c-missing-stage-stops-honestly]`
   pins that a stage with no executor stops the member with an envError NAMING the missing stage —
   the G4 no-stubs posture. It does not silently skip the item, which is the failure that would
   actually be dangerous.

So this is a DEGRADED driver, not a broken product. But it defeats the driver's stated purpose:
§4.2 exists so the orchestrator model does not interleave items by hand, and a driver that hands
back an env error for the last three stages of every item forces exactly that.

**Why it was not fixed in 9.5a or 9.5b.** Adding an executor requires REVISING a committed test
row — `[9.4c-missing-stage-stops-honestly]` deliberately asserts the current, incomplete table, and
it names `conductor_item_review` as one of its two missing stages. That row is not wrong; it was
true when written. Changing behaviour it pins is a correction round, not a side effect of another
task, and doing it silently inside 9.5a would have meant editing a committed assertion to match new
code — the one move this build refuses.

**QUEUED FIX, test-first, after 9.6 lands and before the Phase 9 milestone gate.** 9.6 is being
written now and threads worktree mode through BOTH `conductor_dispatch_wave` and
`conductor_publish`, so it will touch the driver; sequencing the executor work after it avoids two
rounds editing the same function, and avoids shifting the ground under a red that is being authored
against the current driver right now. The round must:

- add `conductor_item_review` and `conductor_publish` executors to the default table, each a thin
  adapter over the committed handler exactly as the existing four are;
- honour §4.2's SERIAL_STAGES rule — `conductor_publish` is already listed there because the git
  index is a singleton, so its executor must not run concurrently with a sibling's;
- REVISE `[9.4c-missing-stage-stops-honestly]` to pin the honest-stop behaviour against a stage that
  is genuinely absent, rather than against two that were merely unbuilt. The row's PROPERTY is
  right and must survive; only its fixture changes.

Until then the driver's coverage is recorded here rather than discovered at Task 13.1's end-to-end,
which drives a full run through the driver and is where this would otherwise have surfaced.

## C-051 — Task 11.8 CLI: a case whose own NAME claimed more than it tested; plus two harness notes

### The surviving mutation

The 11.8 CLI implementer was cut off by a network error just as it began mutation testing, so the
orchestrator ran the mutations. Three died on the row that owns them (repeated-flag last-wins,
eating the next token as a value, making `--schema` optional). **One survived:** deleting the
`--help must be given alone` refusal outright left all 73 cases green.

The cause is worth naming because it is subtle. The test case is titled "--help and --version are
ACCEPTED ALONE", and every subcase passes the flag by itself. That tests the POSITIVE half — that a
lone `--help` parses — and never the word "alone" itself. The case's own name asserted a
restriction its body did not check. This is the same family as C-046 (an assertion satisfiable by
two independent mechanisms) and C-045 (a grep that silently read nothing): a check appearing to
cover more than it does.

The behaviour is the IMPLEMENTER'S INVENTION — C-041 pins the exit codes and the required flags and
says nothing about combining `--help` with real arguments. It is RATIFIED here rather than silently
inherited, and the reason is that partial obedience is the bad outcome: `--help --config x` means
one of two incompatible things, and printing usage while ALSO accepting the config would obey
neither reading. Two subcases now pin the refusal for `--help` and `--version`. Re-running the
mutation kills it: 72/73 with only that case red.

### Harness note 1 — a mutation whose target string does not exist is not a survivor

An earlier attempt at the `--schema` mutation targeted a string the implementation never contained
(`options.schemaPath.empty()`; the code phrases the check as `!haveSchema`). The substitution
asserted and made NO edit — and the suite then reported 73/73, which reads exactly like a survivor.
It was the unmutated build.

This is the second instance of the C-049 family in one session, and the first where the harness
failed OPEN rather than closed. The rule needs both halves:
  - the mutation must COMPILE (C-049), **and**
  - the mutation must have APPLIED — assert the target string occurs exactly once and fail loudly
    when it does not.

The Python helper used here already asserts `count(old) == 1`, which is what surfaced it. Keep that
assertion; a `sed`-style substitution that silently no-ops would have recorded a false green.

### Harness note 2 — shell word-splitting produced a false defect report

Measuring the exit-code contract with `for args in "--config X --schema Y"; do "$BIN" $args; done`
reported exit 2 where the contract pins 3. The shell here is **zsh**, which — unlike bash — does
NOT word-split an unquoted parameter expansion, so the whole string arrived as ONE argument and the
binary correctly refused it as an unknown flag. The implementation was right; the measurement was
wrong, and it was briefly reported as a defect before being checked.

Exit codes must be measured by passing arguments as SEPARATE words (`check 3 --config X --schema Y`
with `"$@"`), never by expanding a single string variable. Verified afterwards against the real
contract: 2 for every usage error, 0 for `--help`/`--version`, 3 for an unreadable config.

### What the CLI half discharges

C-041's premise is now satisfied: the binary RUNS. Verified live, not reasoned —
`llama-router --config .data/configs/conductor-router.json --schema src/tests/schemas/RouterConfig.schema.json`
listens on 127.0.0.1:8088, answers `GET /conductor/health` with
`{"status":"ok","version":"0.0.1"}` and `GET /conductor/metrics` with the aggregate JSON, and exits
0 on SIGTERM. The exit-3 path also proved itself in passing: a hand-written config using
`affinity.groupHeader` was refused with `router config field 'affinity.header' rejected: required
property 'header' not found` — ConfigError::field() verbatim, which is exactly what SG-I pins and
what makes a misconfiguration diagnosable instead of a silent failure to start.

The remaining half of 11.8 — the live smoke against a real llama-server with a model, recorded as
an M8 artifact — is separate and still owed.

## C-052 — Task 9.6: a shape assertion that could not see the rule it was pinning; plus a latent publish bug

### The survivor, and why it mattered

The 9.6 implementer ran ten mutations, killed nine, and DISCLOSED the tenth: collapsing the
`--ff-only`-first-then-fallback sequence into a single plain `git merge` passed all 21 rows.

Its analysis was right and worth preserving. The row asserts the resulting HISTORY SHAPE — a
fast-forward leaves no merge commit, an advanced workspace leaves exactly one — and under git's
DEFAULT `merge.ff=true` a plain `git merge` fast-forwards on its own, producing byte-identical
shapes. The assertion was true of both implementations, so it pinned neither.

§4.2:1613 states a SEQUENCE ("ff-only first, else a normal merge"), and the configuration that
separates the two is `merge.ff=false` — a common repo-level setting for teams who want every
integration recorded. Under it, a plain merge mints a merge commit even where a fast-forward was
possible. A router that skipped the ff-only attempt would therefore rewrite a linear item
integration into a merge commit, and §4.2's serial merge-back would litter exactly the history it
exists to keep readable.

A third half now sets `merge.ff=false` on the fixture repo and requires the integration to STILL be
a fast-forward with zero merge commits. Re-running the mutation kills it: 20/21 with only
`[9.6-mergeback-ff-first-else-merge]` red. The implementer had already kept the explicit sequence as
the robust reading; this makes that reading enforceable rather than conventional.

This is the fourth member of the family C-045/C-046/C-047/C-051 belong to — a check that passes
while inspecting less than its name claims. The distinguishing move each time is the same: find the
input under which the two candidate implementations DIVERGE, and assert on that.

### A committed behaviour changed, deliberately, and it is not a regression

`handlePublish`'s staging gained glob expansion (`expandScopeEntry`). The 9.6 bench declares a
`fileScope` of `src/i1/**` and pins the staged set to exactly the expanded files; the committed
literal-path staging could not satisfy that, because it filtered scope entries through `existsSync`
and a glob pattern is not a file.

The old behaviour was a LATENT BUG, not a contract: §2.4 permits a glob `fileScope` — `validateQueue`
already reasons about glob intersections — so a run whose items used patterns would have published
EMPTY COMMITS, silently. Expansion is guarded by a meta-character test, so literal entries take the
identical path they always did; the full gate (including 9.5b's 50 committed rows) confirms nothing
else moved.

Recorded rather than absorbed silently, because it changes what a committed handler does.

### The C-021 fix landed here as its own row

`registerConductorExclude` did `mkdir <root>/.git/info` and threw ENOTDIR inside a LINKED WORKTREE,
where `<worktree>/.git` is a FILE, not a directory. It now resolves `git rev-parse --git-common-dir`
(against the root when relative) and writes its single `.conductor/` line there. The read was added
to `adapter/gitio.ts` rather than spawned from `state.ts`, whose own header contract says every git
read goes through gitio and that it spawns nothing itself — so the fix lands in the function the
spec names while both modules keep their stated roles.

### C-050 — RESOLVED

Landed test-first. Two changes, one of them to a committed test row, and the reasoning for each:

**The driver's default table now serves all six item stages.** `conductor_item_review` and
`conductor_publish` were added as thin adapters over the committed handlers, exactly like the four
already there. `conductor_publish` was already in `SERIAL_STAGES` (the git index is a singleton,
§4.3), so the driver runs it strictly alone in wave order with no further change.

**`[9.4c-missing-stage-stops-honestly]` was REVISED, not deleted.** It leaned on the default table
being incomplete — those two stages had no handler when 9.4c shipped — so completing the table
destroyed the condition it was about. But the PROPERTY it pinned was never "the table lacks these
two"; it was "the driver stops honestly at a stage nothing serves", which is a fact about the
DRIVER. The row now creates that condition explicitly via an executors override that un-serves a
stage (the override is spread over the defaults, so an explicit `undefined` removes an entry), and
is independent of which stages the table happens to contain — which is what it should have been
from the start. A test that pins today's incompleteness keeps passing after the incompleteness
stops being acceptable.

**NEW row `[9.4c-default-table-serves-every-stage]`** asserts the complementary claim: in the
shipped configuration there IS no unserved stage. Verified to discriminate — removing the
item-review executor reds exactly that row.

**Two things this exposed that were not the point of the round.**

1. My first version of the new row asserted `stoppedAt !== "conductor_item_review"`, which conflates
   "the stage was unserved" with "the stage ran and declined to advance". It also grepped the
   envError for `/no executor/` while the driver's actual wording is "no stage executor in this
   build serves" — so that half matched nothing and was vacuous. The row now quotes the driver's
   own message as a constant. Same family as C-045/C-046/C-047/C-051, this time in a test I wrote
   myself minutes after describing the family.

2. `[9.4c-stage-batching]` broke for a real reason worth recording: it counts sub-sessions by role
   `"reviewer"`, and BOTH `conductor_vet_test` (§2.10 critics) and `conductor_item_review` (§3.3
   lens reviewers) dispatch under that role. They are distinguishable only by prompt content — the
   `LENSES:` line, per `adapter/tools.ts`'s own comment: "a reviewer-role prompt WITHOUT it is a
   §2.10 TEST_VET critic, never a lens session". Once the wave flowed past vet, the critic count
   went from 2 to 11. The row was confined to the stages it studies rather than taught the
   discriminator, because it is about batching within a stage, not about roles.

   **ROLE-NAME COLLISION, raised for the Phase 9 gate:** two stages sharing a dispatch role, told
   apart only by a substring of the prompt, is a distinction no consumer can make cheaply and one
   that the §3.5 session registry cannot express at all. It has now cost one test. It is not a
   defect today — nothing in production branches on it — but it is exactly the shape that becomes
   one.

## C-053 — item review dispatched every session into the shared tree (MAJOR, activated by C-050)

**How it was found.** By reading 9.6's disclosed open item after landing C-050, rather than by a
review. 9.6 recorded: "item-review's reviewer/fix jobs still use tree 'main' under worktree mode;
neither is a default wave stage at HEAD ... Revisit with C-050, which is what would put them in the
wave." C-050 then put them in the wave, which turned a dormant note into a live defect within the
hour.

**The defect.** All four of `handleItemReview`'s job builders — `itemLensJob`, `itemSkepticJob`,
`reviewFixJob` and `reviewRevetJob` — hardcoded `tree: STAGE_TREE`. Every other stage already
derives its tree from the item through `sessionTreeOf(item)` (`item.worktree ?? "main"`). Item
review was the one that did not.

While item review was not a wave stage this was invisible, because an item worked in the shared tree
and "main" was right by coincidence. Under `parallel.writes: "worktrees"` two consequences follow:

- a lens reviewer or skeptic dispatched against "main" JUDGES A TREE WITHOUT THE CHANGE it was
  convened to review — and a clean verdict from it would mean nothing;
- `reviewFixJob` is `writeCapable: true`, so a routed fix would EDIT THE MAIN TREE while the item is
  isolated in a worktree. Two items' fixes racing in one tree is the precise hazard §4.2 worktree
  mode exists to prevent.

**The fix.** The tree is derived ONCE at the top of the handler (`const itemTree =
sessionTreeOf(stage.item)`) and threaded into all four builders. The committed row
`[9.5a-route-implementer-filescope]`, which asserts the fix runs in tree "main", still passes
unchanged — with `item.worktree` null, `sessionTreeOf` RETURNS "main". That row was always pinning
one half of this function; the new row `[9.5a-worktree-scopes-review-sessions]` pins the other.

VERIFIED: red before the fix (only that row), 29/29 after.

**The generalisable point.** A hardcoded constant that happens to equal the derived value is
indistinguishable from a correct derivation until the inputs change. Every other stage having
already moved to `sessionTreeOf` was the signal; the one holdout was not flagged because nothing
exercised the case that separates them. This is the same shape as C-052's merge.ff finding — two
implementations agreeing under the default configuration, and diverging only under the one nobody
had run.

## Known flake — the wire-contract suite under machine load

`conductor/tests/wire-contract.test.ts` (Task 0.2) spawns a real `opencode serve` and probes it for
readiness. Under heavy concurrent load — several parallel CMake builds — that probe timed out and
all 15 of its subtests were CANCELLED, failing the gate. Diagnosed rather than reruled: opencode
1.18.15 starts fine by hand, but logs "server listening" and only becomes ready to answer /config
about 7.7 seconds later, so a readiness budget tighter than that is load-sensitive.

NOT changed. The suite is a committed gate leg and its timeout is a real property of the
environment, not a defect in the code under test. Recorded so a future cancellation is recognised as
this rather than diagnosed from scratch: re-run on a quiet machine before treating it as a
regression. If it recurs without load, the budget is genuinely too tight and should be widened
deliberately.

## C-054 — I documented a guard into existence and then trusted my own documentation (MAJOR)

**The finding.** The Phase 9 milestone gate's gate-versus-handler lens reported, and both skeptics
confirmed by RUNNING it, that `legalTools`' `publishEnabled` parameter was passed by NO production
call site, and that the guard C-048 cited as the thing preventing exactly that —
`conductor/tests/legaltools-callsites.test.ts` — DID NOT EXIST.

Verified directly rather than taken on report: the file was absent, and all three production call
sites (`adapter/inject.ts:110`, `adapter/tools.ts:2437`, `adapter/tools.ts:4878`) passed four
arguments. Every gate verdict in production was therefore computed with `publishEnabled` defaulted
to `true`.

**What C-048 actually said.** "The danger a required parameter was meant to remove — a call site
silently inheriting publish-enabled — is removed a different way, and a stronger one: ... every
production call site passes it explicitly, and `tests/legaltools-callsites.test.ts` fails if one
stops." Both halves were false when written. I then repeated the claim in a code comment at
`gates-phase.ts`, which is where the gate's lens found it: the citation was the only thing that
existed.

**The consequence, as the lens demonstrated on a real non-repo workspace.** With an item at
REVIEWED under §3.9 no-git, the gate OFFERS and RECOMMENDS `conductor_publish` — which the handler
refuses unconditionally — and never offers `conductor_report`, which the handler accepts. The
injected state block names the failing tool as the next step; the wave driver turns each attempt
into a per-item envError.

The skeptics NARROWED one sub-claim and they were right to: this is not a hard deadlock.
`handleReport` never consults `legalTools` — it derives `isRepo` itself — so a caller who invokes
report anyway still closes the run. What is broken is the GUIDANCE: the model is steered
indefinitely toward a tool that cannot work, and away from the one that can.

**The fix.** The guard now exists, and it reads the SOURCE rather than any behaviour — because a
behavioural test cannot see this: `tools-9.5b.test.ts` passes the flag BY HAND
(`gate(..., true, false)`), which pins the parameter's semantics perfectly and says nothing about
whether production ever sets it. Two rows: every production call site passes five arguments, and
the fifth is DERIVED rather than a bare literal (a literal would satisfy the arity check while
restoring the identical bug). All three call sites are wired — the two in `tools.ts` from
`isRepo(store.root)`, and `inject.ts` through a new REQUIRED `InjectCtx.publishEnabled`, threaded
rather than derived because `buildSystemAppend` runs on every prompt and `isRepo` shells out to git.

VERIFIED red before the wiring (all three sites listed by name), green after; suite 1128/1128.

**The first version of the guard had the same disease as its subject.** It matched `legalTools` in
COMMENTS — prose like "forwards to legalTools (repoConfigured)" — and reported two comments as
under-argumented call sites. A scanner that inspects the wrong text is exactly the class it was
built to catch. It now blanks comments before scanning, preserving line numbers.

**The lesson, and it is the sharpest one this build has produced.** Every prior member of this
family — C-044, C-045, C-046, C-047, C-051, C-052 — was a check that INSPECTED LESS THAN IT
CLAIMED. This one is worse: there was no check at all, only a description of one, written by me, in
two places, in the confident past tense. A described-but-unbuilt construction is more dangerous than
an acknowledged gap, because the description is what the next reader audits against — and I was
that reader twice.

STANDING RULE: when a correction record claims a construction prevents a recurrence, the commit
that records it MUST contain the construction. If the guard is deferred, the record says DEFERRED
and names the task that will build it. "Is removed by" is a claim about the present tense and must
be true when written.

## C-055 — a wildcard fileScope granted edit permission to the whole filesystem (MAJOR, security)

**The finding**, from the Phase 9 milestone gate's isolation lens, demonstrated and then confirmed
by two skeptics. `core/gates-edit.ts normalizeUnderTree` strips the session tree's prefix so
tree-relative item scopes match, and returned a path NOT under the tree UNCHANGED. Its comment
justified that: such a path "matches no tree-relative scope and is denied by the role check below".

That is false for any WILDCARD-HEADED scope. Verified directly:

    globMatch("**",      "/etc/passwd")            -> true
    globMatch("**",      "/Users/sal/.ssh/id_rsa") -> true
    globMatch("**/*.ts", "/tmp/evil.ts")           -> true
    globMatch("src/**",  "/etc/passwd")            -> false

`**` spans separators INCLUDING the leading one. So an absolute path outside the tree, left
unchanged by normalization, was matched by the item's own fileScope and ALLOWED.

**Not an exotic scope.** `verifyScopePathsOf` returns exactly `["**"]` for an item that declares no
paths, and a model-driven decomposition is free to emit `**/*.ts`. The `..` traversal guard does
not help — no traversal is needed when the path is already absolute. Neither does the freeze check
(keyed on tree equality) nor the `.conductor/**` deny (matched against the same unchanged absolute
path, which it does not match).

**The fix.** `normalizeUnderTree` returns null for a path outside the tree, and `decideEdit` denies
outright at step 1 — BEFORE any scope matching, because scope matching is precisely what could not
be trusted to reject it. VERIFIED to discriminate: restoring the old "return it unchanged" line
reds `[5.2-out-of-tree-escape]` and only that row.

**Why the existing security suite missed it.** Phase 5 hardened this gate hard — eight bypasses were
found and fixed there (C-022, C-023) — and it has a dedicated path-traversal row. But every scope in
those fixtures is `src/**`-shaped, i.e. rooted at a literal segment, and a rooted glob genuinely
does fail to match an absolute path. The suite tested the guard against the scopes it expected,
never against the one the product itself generates for a scope-less item. The new row asserts its
own PREMISE (`globMatch("**", "/etc/passwd") === true`) so it cannot later pass because the matcher
changed underneath it.

**The pattern, again.** A comment stated an invariant; the invariant held for the inputs anyone had
tried; the code was trusted because the comment was confident. That is C-054's lesson wearing
different clothes — and the two were found by the same gate, hours apart, in code written months
apart. The gate earned its cost on these two alone.

## C-056 — the Phase 9 gate's fix round: nine defects closed, three rulings ratified

Nine agents, all reporting fixed, none blocked. Suite 1129 -> 1158 (+29 rows across five new test
files). Every fix was verified PRESENT afterwards rather than taken on report — see the
orchestrator error at the end for why that mattered.

### Ratified: the closed §7.4 vocabulary gains three names

The journal-vocab agent found SIX live breaches, not the three it was briefed on — it also caught
`handleOverride`'s grant record, its budget-refusal record, and `openWorkspace`'s live-foreign-lock
record in adapter/state.ts. All six would THROW in any non-production NODE_ENV.

It fixed three with EXISTING names and no widening (the override grant now rides
`gates: override-granted`, which had zero producers; the gate decision that SPENDS a grant rides
`gates: allow` with `data.via`; an over-budget refusal rides `gates: deny`) — the right preference
order, stated in the file as a rule for the next reader.

The other three are RATIFIED, each because every existing name would make the record lie:

- **`state: lock.contended`** — this is not a widening at all. `docs/developer/architecture.md:511`
  and `CORRECTIONS.md:285` ALREADY specify this exact name ("A LIVE foreign lock journals
  `warn state lock.contended`"); the code never had it. Verified both citations directly. This is a
  code/spec disagreement resolved in the spec's favour.
- **`state: question.surfaced`** — handlePublish's refuse arm appends a §2.11 question and changes
  NOTHING about the item, so `item.updated` with `blocked:true` would assert a state change that
  did not happen. `decision.recorded` already exists in this file for exactly this shape, one
  ledger over.
- **`state: run.stop-report`** — the §2.9 terminal artifact for a run whose stop another component
  already recorded. `fsm/transition` would claim an edge that did not happen — the same reasoning
  C-037 ruling 7 applied to the REVIEWED->GREEN demotion. The agent's first attempt invented a
  `report` COMPONENT, which was outside the closed eight and had to go regardless.

### Ratified: first-block-wins when two questions block one item

`handleSurface` overwrote `item.blocked` wholesale, losing the first question's id. The agent chose
FIRST-BLOCK-WINS over widening `blocked` to hold several ids, because §2.5 defines it as carrying
ONE questionId and widening a persisted record is a spec change. Ratified.

RESIDUAL, recorded rather than fixed: under first-block-wins, answering the FIRST question releases
the item while the SECOND is still open and still names it. Strictly better than losing the first
question silently, but not obviously right. Left for the Phase 10 continuation work, which is where
the answer path lives.

### Ratified: an abandoned stage is FENCED, not awaited

`awaitHeld`'s budget expiry stopped the member while its executor kept running and could still
write. The agent did NOT make the driver wait — pinned interpretation P8 forbids it (a held job
nothing will release must not wedge the wave). Instead the abandoned stage's StateStore view is
REVOKED, so its later writes are refused rather than landing silently.

DISCLOSED LIMIT, and it is a real one: the fence covers the StateStore, not raw ledger appends. An
abandoned stage can still append to evidence.jsonl before its next store call. Recorded here rather
than papered over.

### A behaviour change worth naming

With `staged` empty and git.mode not read-only, publish now SKIPS the commit leg entirely instead
of running a pathspec-less `git commit`. Before, that case committed whatever happened to be in the
index — which is the defect — or failed. Skipping is the honest outcome: an item that staged
nothing has nothing to commit.

### ORCHESTRATOR ERROR — I designed a collision into the workflow

The fix workflow ran its clusters sequentially precisely because they all edit adapter/tools.ts.
Then I put THREE tools.ts fixes in a final `Remainder` phase and ran them in PARALLEL. One agent
noticed and said so plainly: "CONCURRENT EDITS TO tools.ts, and a window where I may have clobbered
another agent."

A clobbered fix does not fail the gate — it is simply absent, and the suite stays green because the
test that would have caught it was clobbered with it. So every one of the nine fixes was verified
present afterwards by grepping for its own marker and running its own test file. All nine are
there; the parallel window happened to be harmless. It was luck, not design.

RULE: agents that edit the SAME FILE run sequentially, with no exception for "these three are
small". The sequencing must come from the file they touch, not from how big the change looks.

### A load-sensitive test, not a flake in the product

`[9.4c-abandoned-stage-cannot-write]` was reported failing 1 run in 3. On a quiet machine it passed
5 of 5. The agent was running alongside eight others; this matches the already-recorded behaviour of
the wire-contract suite under concurrent load. Recorded as load-sensitive rather than chased — but
recorded, because a test that fails under load will fail a gate someday and someone will believe it.

---

## C-057 — M5 stopped scanning the C++ half at the layout move, and nobody noticed for eleven commits

`scripts/conductor-gate.sh` (the M5 stub scan) selects its files with

```
git ls-files 'conductor/*.ts' 'conductor/**/*.ts' 'src/router/*' 'src/router/**'
```

The user-directed layout move (0a893e0) hoisted `src/` to `router/`. The two C++ globs have
matched **zero files** ever since. `git ls-files` reports no error for a glob that matches
nothing, so the scan printed `M5 PASS (86 file(s) scanned)` and looked exactly like a clean
tree. Twenty-two tracked C++ files — every router header, every doctest file, `main.cpp` — went
unscanned across 11.6, 11.7, 11.8, 9.6, and the whole Phase 9 gate fix round.

This is the recurring defect class again, the fifth time: **a check that PASSED while inspecting
less than it appeared to.** It is the same shape as C-045 (a grep blind to a binary file) and
C-047 (a green suite over a product whose tools all throw.)

### Why the no-argument mode had rotted

Running the whole-tree scan surfaces the reason it was never run: it fails on the enforcement
machinery itself. `conductor/core/planning.ts` **is** the placeholder detector — its source
contains the literal regexes `/<placeholder>|\[placeholder\]/` and comments explaining them.
`conductor/adapter/tools.ts` writes the prompts that forbid stubbing, so it quotes
`"not implemented"` and `"Do NOT write, stub or sketch the production code"` verbatim. A
word-level scan reads all of that as the violation.

So M5 was run per-task with an explicit file list, where those modules rarely appeared — and the
one mode that would have caught a moved path was the mode nobody could run.

### Three changes, each closing one half of that

1. **The globs follow the tree**: `router/*`, `router/**`, `tools/*`, `tools/**`. 86 files
   scanned becomes 108.
2. **A floor on each half.** The TypeScript glob must match ≥ 40 tracked files and the C++ glob
   ≥ 10, or the scan FAILS naming the moved path. This is the standing lesson applied literally:
   a construction that enforces an invariant must also assert that it actually ran. Self-tested
   by pointing the C++ glob at a nonexistent path — `M5 FAIL: the C++ glob matched 4 tracked
   files (floor 10)`.
3. **The patterns match marker SHAPES, not words** — `TODO:` with a colon, or a marker at the
   start of a comment; `<placeholder>` / `[placeholder]` / `placeholder for|here|text|value`;
   `is a stub` / `stub implementation` / `stubbed out` / a comment that opens with `stub`. These
   deliberately mirror the shapes the PRODUCT pins for the same job at
   `conductor/core/planning.ts:562-577`, and the comment above them says so — this is a
   one-rule-in-two-places instance, entered knowingly, because bash cannot import a TS regex.

That leaves six lines that are genuinely the scanner reading its own subject matter. They are
**line-level exemptions**, not file-level: any other marker in those same files still fails. And
each exemption is verified LIVE on every whole-tree run — an exemption whose anchor line no
longer trips the scan it exempts is itself a FAIL, so an exemption cannot outlive its reason.

### The one real finding underneath

`router/version.hpp:5` read "The router's build version. **Scaffold placeholder for Task 11.1**;
later tasks wire the real config/version surface." That stopped being true at 11.8: the constant
is the shipping version, and `/conductor/health` served exactly `{"status":"ok","version":
"0.0.1"}` in the live smoke and again when this session re-verified it. Comment corrected to say
what the constant now is.

Eleven commits of an unscanned C++ tree produced exactly one stale comment. The scan was not
finding much — but "it would not have found much anyway" is a conclusion available only after
you run it, and it was not available before.

### And I walked straight into the recorded trap while fixing it

To prove the repaired scan still catches a real violation I appended `// TODO: finish this` to
`router/version.hpp`, confirmed exit 1, and reverted with `git checkout router/version.hpp` —
which also discarded the comment fix sitting uncommitted in the same file. That is the mutation
harness trap already written down in `IN_PROGRESS.json` under `mutationRevertTrap`, committed
after it cost half of C-035. Reading it did not stop me from repeating it.

Redone with the discipline the note prescribes: `cp` snapshot first, restore from the snapshot,
`cmp` to confirm. **The note was not enough; the habit has to be to snapshot BEFORE the first
mutation, every time, including when the mutation is "just one line I will obviously undo".**

---

## C-058 — Task 11.1 Step 2 executed, and the number it produced contradicts the plan's own recipe

The live upstream measurement deferred since Task 11.1 (`router/UPSTREAM_CONTRACT.md` carried
`WIRE_CONTRACT_VERIFIED: <pending>` through eight Phase 11 tasks) has now been run against
`qwen3.6-27b` on llama-server 10298. Full artifact in that file; three findings are recorded here
because they change what other tasks must do.

### F3 (MAJOR) — `--parallel N` silently divides the context window by N

`--ctx-size` is llama-server's TOTAL context, partitioned across slots. Measured, one flag apart:

| argv | n_slots | n_ctx_slot | kv_unified |
|---|---|---|---|
| `--ctx-size 8192` (no `--parallel`) | 4 | **8192** | true |
| `--ctx-size 8192 --parallel 6` | 6 | **1536** | false |
| `--ctx-size 49152 --parallel 6` | 6 | **8192** | false |

Plan §8 Task 12.1 mandates "the llama-server command gains `--parallel <slots>` computed from
`parallel.maxReaders`". Implemented as written — append `--parallel N` — that instruction cuts
every sub-session's window from 8192 to 1536 tokens. llama-server reports it as a rounding
notice, `/props` exposes only `total_slots`, and the symptom at the far end is bad model output
rather than a configuration error.

**Ruling (DERIVE-AND-RECORD):** the derivation is two-valued, not one.

```
slots      = max(1, parallel.maxReaders)
--parallel = slots
--ctx-size = per_slot_context * slots
```

This does not change a §2 schema, a closed vocabulary, a G-rule or a §11 row — it makes the
existing mandate produce the configuration it was obviously intended to produce — so it is
derive-and-record, not stop-and-park. Task 12.1's `parallel_server_args` owns both halves, and
the 12.1 assertions already carry a `12.1-ctx-per-slot-preserved` row that pins the argv against
the recorded measurement rather than against reasoning.

### F1-CONFIRMED (MAJOR) — the G13 model returns EMPTY content, and 1024 tokens is not enough

Task 11.8 observed this on `ornith-9b` and asked that `qwen3.6-27b` be checked before 12.1 set
any token budgets. Checked: on "Finding 7 claims 2+2=4. Uphold or refute it", with a declared
`json_schema`, **`max_tokens: 1024` produced 1024 completion tokens, 4024 characters of
`reasoning_content`, and an EMPTY `content`** with `finish_reason: length` and status 200.

A schema-validating caller sees an empty string, fails validation, and retries — and the retry
spends the same budget the same way. That is an unbounded-cost loop under §3.3's whole fan-out.

Measured fix: `"chat_template_kwargs": {"enable_thinking": false}` or `"reasoning_effort":
"none"` (both require `--jinja`) turn that request into `finish_reason: stop`, **96** completion
tokens, zero reasoning characters, and a body conforming exactly to the declared schema. The
widely-cited prompt-level `/no_think` switch is **ignored** by this template and still returned
empty content at 512 tokens — so anyone reaching for it will conclude the model is broken.

Recorded as a binding on 12.1/12.2 rather than fixed here: the structured-output path must send
one of the two switches, and per-role token budgets must be set with thinking either off or
explicitly budgeted. Leaving thinking on is defensible; leaving it on *by accident*, with a
budget sized for a non-reasoning model, is the failure this measurement exists to prevent.

### A measured constraint on what fan-out buys

Eight concurrent 24-token completions against 6 slots: six finished together at ~5.7 s and
exactly two at ~8.0 s, which confirms the slot count and the queueing. But wall-clock rose
almost linearly with N up to 6 (1.62 → 2.26 → 4.85 → 6.17 s). Decoding is bandwidth-bound here,
so parallel fan-out buys pipelining and latency-hiding, **not speedup**. Phase 14's benchmark
must be read with that in mind: an arm issuing more concurrent sub-sessions pays for them in
wall-clock nearly proportionally.

### A readiness-probe trap, recorded because this session fell into it

`curl -s http://127.0.0.1:8080/health` **exits 0** while the model is still loading — the body is
`{"error":{"message":"Loading model",…,"code":503}}` and a 503 is a successful HTTP transaction.
`until curl -s …/health; do sleep 5; done` therefore returns immediately and declares a server
ready that cannot serve. Poll the BODY (`grep -q '"status":"ok"'`) or use `curl -f`. Task 12.1's
supervisor and Task 12.2's setup probe both depend on this.

### Why this is committed separately rather than inside the 12.1 commit

The artifact is 12.1's by ownership, and M6 would allow it in that commit. It is committed now,
alone, because it is the product of a live measurement that took three model loads and cannot be
re-derived from the repository — holding it uncommitted until 12.1's implementation lands would
risk losing it to exactly the mid-task agent death this build has already seen twice.

---

## C-059 — Task 5.4's entire deliverable is unreachable in production (MAJOR)

Found by the Task 10.1 test-writer, which could not make its own `10.1-plugin-event-hook-routes`
row observable end to end and said so instead of working around it silently. Verified by the
orchestrator at HEAD:

```
$ grep -rn "handleChatMessage" conductor --include="*.ts" | grep -v "adapter/chat-message.ts" | grep -v "tests/"
(no output)
```

`conductor/adapter/chat-message.ts:105` exports `handleChatMessage` — Task 5.4's whole deliverable:
run creation, `startHead`/`startBranch`/`startDirty` capture, and **orchestrator session
registration**. The plugin factory at `conductor/plugin/index.ts:246` returns exactly
`{ tool, "tool.execute.before" }`. Nothing else in the product calls it. `chat.message` is not a
hook the plugin registers.

So in a real opencode session: no run is ever created, and **no session is ever registered as the
orchestrator**. `adapter/tools.ts:6777` is the only other place a `"orchestrator"` role string
appears and it is a literal inside an unrelated record, not a registration.

### Why 40 committed tasks did not notice

`conductor/tests/chat-message.test.ts` drives `handleChatMessage` directly and passes. The gate
asks whether the module behaves; it never asks whether anything calls it. This is the fifth
instance of the class this build keeps rediscovering — **a check that passes while inspecting
less than it appears to** — and the closest sibling is C-047, a green suite over a product whose
tools all threw.

The `verify-acceptance.sh` detector written earlier this session ("every §1.1 module is imported
by at least one test") would not have caught it either: `chat-message.ts` IS imported by a test.
The missing detector is "every adapter module is reachable from `plugin/index.ts`", and it is now
worth having.

### The comment that asserted it was done

`conductor/plugin/index.ts:93-95`:

> the registry is populated by the fan-out engine (when it creates a sub-session) **and the
> chat.message hook (for the orchestrator) in later phases**

The later phase arrived — Task 5.4, committed at `1176178` — and wired nothing. The comment now
reads as a description of the code rather than a note about the future, which is exactly how
C-033 hid: a comment claiming what the code below it did not do.

### AMENDED, same session, before anything was built on it

My first ruling here called this a new finding and opened a task-let for it. Then I read further
into the plugin and found the gap is far larger than `chat.message`, and that **C-044 already
recorded it**. Both corrections belong in the record.

What the plugin actually is at HEAD: it never calls `openWorkspace()` (there is **no state
store**), its journal is a `console.error` stub rather than `adapter/journal.ts`, its registry is
a bare `Map` rather than a `SessionRegistry`, and every one of its 22 tools is bound to
`handlerNotBound` — **which throws**. `chat.message` being unwired is one symptom of a plugin
that is a shell.

C-044 Finding 1 verified exactly this ("at HEAD the product is INERT: nine phases of handler work
are reachable only from tests") and correctly found it is not unassigned: plan:2917 requires
"REAL plugin hooks + REAL handlers" and plan:2958 says "Red -> **glue fixes** -> green". Glue
fixes IS the composition root, and it belongs to Task 13.1.

So the honest correction to my own entry: **this is not a new defect, it is a known one I
rediscovered from a different direction.** What is genuinely new is the specific — `chat.message`
is unwired and `handleChatMessage` has no production caller — and that specific has a consequence
C-044 did not draw: **Task 10.1 cannot be implemented against a real production path.** Its
`10.1-plugin-event-hook-routes` row needs a session registered as orchestrator, and nothing
registers one. The 10.1 test-writer worked around it by pinning a reconstruction (the plugin
re-seeds the registry entry from the persisted `Run.sessionID`) and flagged that it had done so.

### Revised ruling — build the lifecycle half of the composition root now, as 5.4a

C-044's own criticism of the arrangement was **timing**: "leaving every tool-to-handler
correspondence unverified until the last coding task means each of Phases 9-12 can add another
mismatch, and 13.1 discovers them all at once in the task least able to absorb surprises." That
argument applies with more force now that 10.1 would otherwise be written against a fiction.

**Task 5.4a takes the session/run lifecycle half only:** `openWorkspace`, the real JSONL journal,
a real `SessionRegistry`, and the `chat.message` hook calling `handleChatMessage`. It does NOT
take the tool-to-handler binding for the 22 tools — that stays 13.1's glue, and the tools keep
throwing until then. That split is coherent and independently testable: after 5.4a a real session
creates a run and registers its orchestrator; it still cannot advance state through a tool.

Sequenced AFTER 15.0 (which currently holds the TypeScript leg's one red) and BEFORE 10.1, which
edits the same `plugin/index.ts` hooks object — C-056's rule is that sequencing comes from the
file touched.

## C-060 — serve.py is orchestrator-only and is also Task 12.1's deliverable

The orchestrator prompt §6.1 lists `scripts/serve.py` among the files **no subagent may ever
edit**. Plan §8 Task 12.1's deliverable is, in large part, edits to `scripts/serve.py` and
`scripts/fetch_models.py`. Taken together those two rules make 12.1 unimplementable by a subagent.

**Resolution (DERIVE-AND-RECORD):** the split the plan itself already draws. Task 12.1's own text
extracts the logic into `scripts/conductor_wiring.py` precisely "so they're testable without
serving" — so the implementer writes that module, which is where every behaviour the 29 assertion
rows check actually lives, and **returns an exact unified diff** for `serve.py` and
`fetch_models.py`, which the orchestrator reads and applies by hand. The single-writer law over
the harness's own tooling is preserved, the work still gets done, and the two signature changes
land under the same eyes that own the file.

## C-061 — I copied a test file out of staging while its writer was still writing

Process error, mine. I set a watcher that fired on the *existence* of a staged file and copied
`staging/task-15.2/dashboard_test.cpp` into `router/tests/` at 06:16:13. The writer's final
version landed at 06:16:35, twenty-two seconds later. I then dispatched an implementer against
the stale snapshot.

The stale copy differed in a way that mattered: it contained an unqualified helper named `quoted`
that resolved to `std::quoted` by ADL — a real compile defect the writer had already found and
fixed by renaming it `jsonString`. The implementer would have hit an error the contract no longer
contained.

Caught only because the writer's final report explicitly said "the copy in `router/tests/` is a
stale intermediate snapshot of my staging file" — it compared mtimes and told me. Re-copied,
verified byte-identical with `cmp`, red re-observed, and the implementer was messaged mid-run
with the diff that mattered.

**RULE: a staged file is ready when its AGENT RETURNS, never when the file appears.** Watching
the filesystem for a path is watching the wrong signal — writers edit in place, repeatedly, and
an intermediate save is indistinguishable from a finished one by any file-level test.

---

## C-062 — Task 12.1, and the test catching the ORCHESTRATOR's live artifact in a wrong measurement

### The row that failed, and why that is the system working

`12.1-live-autoload` asserts the string `--models-max` appears in the contract's Task 12.1
section. It did not, and the implementer traced why: `AUTOLOAD_LATENCY_MS: 2040`, which I had
written into `router/UPSTREAM_CONTRACT.md` at C-058, was **cold process startup to first healthy
`/health`** measured with `--model <path>` directly. Item 5 asks for something else — the latency
of a request naming a model that is **not resident**, against a server started with
`--models-preset` and `--models-max 1`. Different quantity, same units, and the units are what
made it look right.

The implementer could have made its own test green by writing `--models-max` into the prose. It
refused, marked `STEP2_ITEM_5: 12.1 BLOCKED`, reverted the stamp to `<pending>`, kept the 2040 ms
number but relabelled it as cold start, and wrote out the un-run probe verbatim. That is exactly
the behaviour the live-task discipline is for, and it was applied against the orchestrator's own
artifact.

### Discharged, not left blocked

Two chat models are installed, so an eviction can be forced and the probe CAN run. It was run:

```
cold autoload (9B)     wall= 2936 ms      resident, no load  wall=  145 ms   -> 2791 ms
autoload + evict (27B) wall= 9683 ms      resident, no load  wall=  563 ms   -> 9120 ms
```

`AUTOLOAD_LATENCY_MS: 9120` — the G13 model's load cost with the wall clock of the same request
when resident subtracted, so it is the load and not the generation. Item 5 is discharged, all six
Step 2 items are observed, and the stamp is now real rather than pending.

### FINDING F4 (MAJOR for how 12.1 must be read) — preset mode is a parent that spawns children

`--models-preset` does not load models into the listening process. It makes that process a
**router** that spawns a child `llama-server` per model on an ephemeral port and proxies to it;
`--models-max` bounds residency and eviction is LRU. The child's argv is assembled from the INI.

That raised a question F3's whole derivation depends on: **if the parent's `--parallel` and
`--ctx-size` do not reach the child, Task 12.1's slot derivation is inert in the only mode
`serve.py` uses**, and the fan-out silently runs on llama-server's default 4 slots.

Tested rather than assumed. Parent started with `--parallel 6 --ctx-size 49152`, child argv:

```
load:   --ctx-size
load:   49152
load:   --parallel
load:   6
[56637] load_model: initializing, n_slots = 6, n_ctx_slot = 8192, kv_unified = 'false'
```

The parent forwards both and they **override the preset INI** (which said `ctx-size = 65536`).
F3's formula is effective end to end. Precedence recorded: parent CLI beats the preset file.

### A second correction to my own artifact — `/v1/models` is mode-dependent

C-058 recorded that `data[0].id` is the full gguf path. True with `--model` direct; **false in
preset mode**, where the parent gives each child an `--alias` and the ids are the friendly names:

```
['embeddinggemma-300m', 'ornith-9b', 'qwen3-coder-30b', 'qwen3-coder-next', 'qwen3.6-27b', ...]
```

Task 12.2's setup proof matches `models.default` against `/v1/models`, so it must match the
**friendly id** — the shipping mode — and treat a path-shaped id as the direct-mode case. Also:
in preset mode the list is the preset's contents whether or not a model is resident, so presence
does NOT imply loaded.

### C-060 applied: the four-file patch

Per C-060 the implementer wrote `scripts/conductor_wiring.py` (824 lines) and returned a unified
diff for the files it may not edit. The diff touched **four**, not the two anticipated:
`scripts/serve.py`, `scripts/fetch_models.py`, `scripts/test-conductor.sh` (the new python leg)
and `router/UPSTREAM_CONTRACT.md`. Read hunk by hunk and applied by the orchestrator;
`patch --dry-run` clean, `py_compile` and `bash -n` clean afterwards.

### The python leg got a floor before it was trusted

The delivered leg was `unittest discover … || exit 1`. **`unittest discover` exits 0 on "Ran 0
tests"** — the identical vacuous-green hole the node leg exists to close, and one renamed file
would have made the whole Python half silently stop enforcing. Added: a `Ran N` floor of ≥ 1, and
a rejection of `(skipped=…)` / `(expected failures=…)` in the trailer, mirroring the node leg's
SKIP/TODO rejection. Self-tested by pointing discovery at an empty directory — `GATE FAIL: python
leg discovered ZERO tests`.

### Five disclosed survivors, one of which matters a great deal

The implementer disclosed five mutations that no row catches. The serious one:

**`ROUTER_SUPERVISOR_SOURCE` is grepped, never executed.** `12.1-supervisor-lifecycle` searches
the supervisor's source text for `os.kill(shell_pid, 0)`, `SIGTERM`, `SIGKILL` and their order. A
supervisor keeping every token while never signalling passes. In the implementer's words: **"a
router that outlives every session would not fail this suite."** It compensated out of band by
running the real supervisor against fake router binaries — fatal exit 3 stops immediately, exit 1
restarts at 500 ms then 1000 ms, killing the fake shell reaped the router in 0.1 s — but that is
a transcript, not a test.

Also surviving: `wait_for_router_health` is never called by any test (only the injected seam is),
so a `return True` stub survives — which is precisely the `curl -s` 503 trap; `ROUTER_TERM_GRACE_S`
is only asserted `>= 5.0`; and `derive_slots`'s bool guard is unpinned.

Recorded as an obligation on the Phase 12 gate rather than fixed here: these need an
execution-level supervisor test, and adding one now would mean the implementer writing its own
test. Four of five are "the test inspects text where it should run code" — the same class as
C-044/C-047.

### One behaviour worth naming for whoever runs serve.py

Because `parallel_server_args(slots)` takes only `slots`, and `build_server_command`'s output must
equal the head command plus those args, the derived args **append a second `--ctx-size` that
overrides the user's `--ctx`** whenever `slots > 1`. So `serve.py --ctx 4096 --max-readers 6`
serves 8192 per slot, not 4096. That is F3-correct and forced by the assertion's shape, but a user
passing `--ctx` and getting a different per-slot window may reasonably be surprised. At
`slots == 1` the user's `--ctx` is left alone.

---

## C-063 — the Phase 11 gate, run late and worth the wait: one real MAJOR, found six times

Branch B ran parallel to the spine and its phase boundary was never adjudicated when 11.8 landed.
The gate was run now rather than skipped. 19 agents: four blind lenses (correctness,
protocol-conformance, concurrency, spec-conformance), a red-team-by-data candidate generator, and
two refute-biased skeptics per major. **27 findings: 7 major, 20 minor/nit.** Skeptics refuted 10
of 14 verdicts.

### Six of the seven majors are ONE defect

PC-1, PC-2, R11-C1, R11-C2, R11-001 and R11-01 all describe the same thing, found independently by
three different lenses. Reading them as six problems would badly misstate what Phase 11 got wrong;
reading them as one, found six times, is the honest summary and is strong evidence.

**A mid-body upstream failure is relayed downstream as a SUCCESSFUL, silently truncated response.**

Verified by the orchestrator before any fix was dispatched, mechanically rather than by argument:

```
$ grep -n "succeeded" router/router.hpp
238:            bool succeeded{ false };      <- the relay field
1077:            const bool succeeded = ...   <- a LOCAL of the same name
1083:                if (succeeded && ...)    <- reads the LOCAL
1089:                relay->succeeded = succeeded;   <- written, and read NOWHERE
```

`router.hpp:893-904` waits on `headersReady || finished` and decides success purely from the
header flag; `relay->error` is read at :903 but consumed only inside the `if (!haveResponse)`
branch. **Once headers have arrived, the upstream's real verdict is unreachable.**

- **Buffered**: the router ships the partial bytes, and `sendBuffered` sizes the content provider
  at `payload->size()`, so httplib emits a `Content-Length` matching the TRUNCATION — while the
  upstream's own Content-Length was already dropped. The client cannot distinguish it from a
  complete response and the ledger records the upstream's 200.
- **Streaming**: `complete = relay->finished || relay->cancelled` is true even when the call
  FAILED, so `sink.done()` writes a clean terminating chunk and an aborted SSE stream is framed as
  a normal end.

The panel verified reachability against the vendored cpp-httplib 0.52.0:
`read_content_with_length` delivers partial bytes to the content receiver and only THEN returns an
error. The orchestrator separately confirmed **no committed test covers it** — the only
upstream-failure case, `[11.3-upstream-down-502]`, is a CONNECT failure where no headers ever
arrive.

This is the defect class this build keeps meeting: a value written for a purpose and never read,
under a green suite. It is the mirror of C-054 (a guard documented into existence but never built).

### Rulings issued with the fix, so the fix could not drift

- **Buffered → 502.** Nothing has been written downstream at that point, so the choice is still
  open. This extends `router.hpp:29-31`'s stated law — the router mints a status of its own "in
  exactly one situation, an upstream it could not reach at all" — to a SECOND situation, and the
  comment must be updated to say so. A comment still claiming "exactly one situation" after a
  second is added is precisely C-033's shape, and M5 would not catch it.
- **Streaming → abort, never `done()`.** The bytes are already gone; a chunked stream missing its
  terminal chunk is a DETECTABLE error at the client, and that is the honest outcome.
- **No new ledger column.** That would change Task 11.7's committed contract and both of its
  readers (the C++ dashboard's `parseLedgerLine` and the TypeScript router-client).

### The seventh major, and the minors that deserve to outlive this file

R11-02 — a hard-coded 600 s upstream read timeout can 502 a completion llama-server would have
finished. Unreachable at this machine's measured throughput (~67 tok/s against a 8192-token slot
is well under two minutes), so it is recorded as a LIMIT rather than fixed.

Two minors are stronger than their label and are recorded as obligations rather than notes:

- **R11-004** — `metrics.hpp:137` pushes EVERY request's `queueWaitMs` into the percentile sample,
  including the zeros from requests admitted immediately, so `waitMsP50`/`waitMsP95` collapse to 0
  under any load where most requests do not queue. **The C++ dashboard already disagrees with the
  endpoint about this**: 15.2's SG-A resolution counts only `queueWaitMs > 0` as "actually
  waited". One rule, two places, two answers — the theme that has now drifted seven times. It
  matters because Phase 14's benchmark reads these numbers and §7.2's Phase 14 lens is
  measurement-validity. Deferred to the Phase 14 gate rather than changed here, because changing
  it changes 11.7's published contract.
- **R11-06** — the empty-model admission bucket is an independent in-flight counter, so concurrent
  model-less POSTs can put 2× `maxInflightPerModel` requests on the upstream.

The full finding set, with per-finding evidence and reproductions, is committed at
`docs/build/artifacts/phase-11-lens-findings.md`. The red-team probe is separate:
`docs/build/artifacts/phase-11-redteam-probe.md`, executed by the orchestrator against the
committed `observe_request` — 20 hostile shapes, nothing threw, nothing was rejected, PASS.

## C-064 — two test-writers named the same function differently, caught before either committed

5.4a's writer specified `loadConfig(root)`; 12.2's writer specified `readWorkspaceConfig(root)`,
for the same §2.1 config reader that the 5.4a/12.2 collision amendment had already assigned to a
single owner. The amendment settled WHO builds it and never settled WHAT IT IS CALLED, so two
agents working from the same amendment produced two names.

Caught because 12.2's writer read 5.4a's assertions file and reported the disagreement rather than
assuming its own spelling was canonical. Had it not, 12.2's red would have been a *second*
missing-subject error indistinguishable from the first, and the defect would have surfaced only
when 12.2's implementer built a second reader to satisfy it — which is exactly the duplicate the
amendment existed to prevent.

**Ruling: `loadConfig` wins** — 5.4a owns the reader, its test is in the tree with its red
observed, and its implementer is building against that name. Exporting both is not available:
`.claude/rules/patterns-and-conventions.md` forbids compatibility aliases outright.

**LESSON: an ownership amendment must pin the SIGNATURE, not just the owner.** Naming the owning
task stops the duplicate implementation; it does not stop two callers from importing two different
names. The 12.1/12.2 `DEFAULT_MAX_READERS` obligation got this right by naming the literal; the
5.4a/12.2 one named only the file.

### The disposition half, resolved without changing either test

5.4a demands `loadConfig` THROW on a malformed config and never silently fall back. 12.2's writer
argued a throw at plugin construction is dangerous and recommended a loud return instead. Both are
right about their own concern, and the designs already reconcile: 5.4a's plugin opens the
workspace **lazily**, and its `5.4a-construction-failure-denies-loudly` row requires the failure to
be loud on the stderr sink AND the gate to still DENY. A throw is therefore caught at the lazy
open, is loud, and fails closed. The throw stands; 12.2's leg was written tolerant of either and
passes unchanged.

---

## C-065 — task-let 5.4a lands, and my own fix brief was wrong about the git gate

5.4a is green: 15/15, full suite 1201/1201, all five legs. The plugin now opens a real workspace
(lazily, against `realpathSync(input.directory)`), journals through a two-phase sink that rebinds
to `<runDir>/journal.jsonl` when a run appears, holds ONE registry Map with a thin view over it
for both consumers, and calls `handleChatMessage` from a real `chat.message` hook. The 22 tools
remain bound to `handlerNotBound` and still throw — the fence held, and a test asserts it.

M4 both directions, snapshot-restored and `cmp`-verified: removing `config-io.ts` re-derives the
missing-subject red; disabling the `chat.message` hook fails 8 of 14.

### The sixth consecutive disclosed survivor, and it was security-relevant

The implementer wired the gate's git policy from the loaded config — `gitMode: config.git.mode`,
`branchPolicy: config.git.branchPolicy` — beyond what any test demanded, on the grounds that "a
config that is loaded and then ignored is the same downgrade as a config not loaded". It then
disclosed that hardcoding both back to `"commit"`/`"pin"` left the **whole suite** at 1200/1200.

The direction is strictly safer: an unconfigured repo now defaults to `read-only` rather than
unconditional `commit`. Which is exactly why it needed an assertion.

### MY BRIEF FOR THAT ASSERTION WAS WRONG, and the test-writer caught it

I briefed: assert `git commit -m x` is denied with the READ-ONLY reason under
`git.mode: "read-only"` and with a DIFFERENT reason under `"commit"`.

`conductor/core/gates-git.ts:459-467` does this:

```ts
export function decideGit(command, sessionRole, gitMode, runActive, branchPolicy): GitDecision {
  void sessionRole;
  void gitMode;
```

under a doc comment stating the design deliberately: the publish handler runs git through
`execFile` inside the plugin, which is not a tool call and never reaches this gate, so `gitMode`
does not branch the decision. Probed directly, `git commit` returns the **byte-identical** reason
under both modes.

**So the assertion I specified would have FAILED against a correct implementation.** I wrote a
brief that assumed a behaviour I had not checked, in the same session in which I recorded twice
that reading the interface beats inferring it.

The writer's replacement is better than what I asked for, in three parts:

1. **The discriminator moves to `branchPolicy`**, which IS observable at this seam:
   `git switch feature-x` is DENIED under `"pin"` and **ALLOWED** under `"check-only"`. Allow-vs-deny
   is a sharper control than two different denials, and it kills both hardcodings.
2. **The `git commit` pair from my brief is kept — pinned as EQUAL**, as a trip-wire. If the core
   ever starts branching on `gitMode`, that line goes red and the discriminator can move onto it.
3. **A source guard for `gitMode`**, because it is threaded on the adjacent line and inert *only at
   this seam*, so no runtime probe can observe that half. It requires the call site to read
   `gitMode: config.git.mode` and to not match a literal, with comments stripped and a length floor
   so a broken extraction fails red rather than vacuously passing.

Verified by the writer in three runs: unmutated 15/15; both fields hardcoded → the new test fails
on the allow-vs-deny control; `gitMode` hardcoded ALONE → part (a) still passes (as it must, since
the core voids it) and only the source guard fires. That third run is what proves part (c) is
load-bearing rather than decoration.

**LESSON, and it is the same one twice in one session: when briefing an assertion, state the
OBSERVABLE and let the writer find the discriminator. I named a discriminator I had not probed,
and the only reason it did not become a test that passes for the wrong reason — or worse, a
correct implementation "fixed" to satisfy a wrong test — is that the writer probed the core
before writing.**

### Two implementer decisions accepted over my recommendations

- **The event name is `state`/`hook.failed`, not the `chat.message.failed` I recommended.** One
  record shape is needed at TWO call sites: the `chat.message` catch, and the workspace-open
  failure, which `5.4a-construction-failure-denies-loudly` reaches through `tool.execute.before` —
  where "chat.message.failed" would be a straight lie. `journal-events.ts`'s own widening note
  forbids exactly that: "a record filed under someone else's name is a record no replay filter can
  trust." One widening, honest at both sites, with `data.hook` naming which.
- **The implementer also edited the prose above the event array** — "The last three follow the SAME
  rule" became "four" — which is one line beyond my "change nothing else in that file". It flagged
  this rather than hiding it, and it was right to: leaving a comment asserting something the code
  below no longer does is the C-033 shape this build keeps punishing.

---

## C-066 — the Phase 11 major, fixed test-first, and a THIRD half the lenses did not find

The defect of C-063 is closed. `router-tests` 90 → **92 cases, 27726 assertions, 0 failed**.

### The red was genuine, and the agent proved it was genuine

The hard part of this test is not the router — it is producing a REAL short read. `httplib::Server`
cannot emit an unfinished message, so the stub is a raw POSIX socket. And both cases open with an
independent probe, `requireGenuineShortRead(...)`: a plain httplib client, no router in the
picture, which must receive exactly the partial bytes through its content receiver and *then*
report `Error::Read`. If the stub were fake the cases would abort at that probe instead of
reaching the real assertions.

Verbatim red against unmodified `router.hpp`:

```
[11.3-upstream-truncated-buffered]
  CHECK( result->status == 502 )                          values: CHECK( 200 == 502 )
  CHECK_FALSE( mentions(result->body, kTruncationMarker) ) values: CHECK_FALSE( true )
  REQUIRE_FALSE( envelope.is_discarded() )                 values: REQUIRE_FALSE( true )

[11.3-upstream-truncated-stream]
  REQUIRE_FALSE( static_cast<bool>(result) )               values: REQUIRE_FALSE( true )
```

Note the third line: the buffered body was **not valid JSON** — cut mid-string — and that is what a
client would have been handed as a complete answer.

### A trap worth carrying forward

`close()` on a socket with unread request bytes still buffered makes the kernel send **RST**, and
an RST lets the peer discard payload it has already received but not yet handed up. That would
have destroyed the exact partial delivery the test depends on, and the case would have degenerated
into a connection-reset test that "passed" for the wrong reason. The stub therefore drains the
whole request, then `shutdown(SHUT_WR)`, then waits for the peer's FIN before closing.

### The third half, which no lens named

`router.hpp:916-923` applied the upstream's status **and its end-to-end headers** to `response`
before the buffered path knew the outcome. Left alone, the new 502 would have gone out wearing the
head of an answer that never arrived — the router's own error dressed in the upstream's clothes.
The whole head is now deferred behind a `relayResponseHead()` lambda invoked only once the verdict
is known.

The agent's own test did not catch this at first. It said so, strengthened the test (an
`X-Upstream-Marker` on the stub's head) rather than shipping an untested line, and mutation 3
proves it load-bearing.

### And a bug in the original read timing

`relay->error` was snapshotted at `:903` under the FIRST wait (headers-ready), where in a
truncation it is still `Error::Success` — the real error only lands when the call returns. Re-read
inside the buffered completion wait, so the envelope names the actual cause. The `!haveResponse`
path's read was always correct because that wait exits on `finished`.

### Verified by the orchestrator, not accepted on report

Each half reverted independently (`if (X)` → `if (false && X)`), rebuilt, run:

| revert | truncated-buffered | truncated-stream |
|---|---|---|
| buffered 502 | **FAILS** (4 assertions) | passes |
| streaming abort | passes | **FAILS** (1 assertion) |

Each half is under test, and each half only. Restored byte-identical with `cmp` both times.

### Two things left deliberately unchanged, and why

- **The error `type` string stays `router_upstream_unreachable`.** It is now a mild misnomer for
  the mid-body case — the router *did* reach this upstream. But that string is what
  `conductor/adapter/router-client.ts` parses, and changing a committed wire contract to improve a
  word is not a change to make unilaterally inside a fix round. The MESSAGE distinguishes them:
  `truncatedMessage()` says "could not complete the response from", names the httplib error and
  the byte count received, and deliberately does not say "could not reach".
- **The streaming ledger status stays the upstream's 200.** 200 *is* the status line the client
  received, and the ledger records what the client got; the truncation is carried by the missing
  terminating chunk. The only alternative that avoids a schema change would be rewriting that
  status to 502, which would make the ledger disagree with the wire. Recorded as a limit.

### The law in the header comment was updated, because it changed

`router.hpp:27-31` said the router mints a status of its own "in exactly one situation". It is now
two, and the comment says two and says why. A comment still claiming "exactly one" after a second
was added is precisely the C-033 shape, and M5 does not catch prose.

---

## C-067 — two residuals in Task 10.1, found by reading the diff, recorded rather than fixed

Both were found at the 10.1 task gate by reading the whole diff, not by any check. Neither
fails a row: the 33 promoted assertions all pass and all bite (three reverts prove it). Both
are recorded here because the alternative is that they are silently absent.

### (a) The C-032 E7 *prevention* half covers two of four blocking sites

`reuseOrAppendBlockingQuestion` was wired into `handleSubmitTest` and `handleVetTest` —
the two call sites the binding names (the old `blockAndAsk` / `blockVetAndAsk`). But
`adapter/tools.ts` has **four** `appendQuestion` calls carrying `origin:"implementer-blocked"`,
and the other two (the GREEN-stage implementer exit and the review fix-round exit) have the
identical question-first / `setBlocked`-second ordering. They can still mint a second open
question for an item that already has one.

Why this is not a gate failure, and what limits the damage:

- The **repair** half — `continuation.ts reconcileOrphanQuestions` — filters on `origin` alone,
  so it completes half-applied blocks from all four sites, not two.
- The C-056 fix landing in the same commit (`handleAnswer` re-blocks a released item on the
  *oldest* still-open question naming it) means a duplicate question degrades to "answer both"
  rather than "the item is released while still blocked".

So the residual is duplicate *asks*, not a stranded item. Wiring the remaining two sites is a
two-line change and belongs to whoever next opens `tools.ts` for the Phase 10 review.

### (b) A header comment claims more durability than the code has

`conductor/adapter/continuation.ts`'s module header says the futility signature's durable half
"survives a restart". The signature is *computed* from persisted state on every pass, so that
half is true — but the **comparison baseline** (`ContinuationState.lastSignature`) is in-memory
and is `null` again after a plugin restart. The first idle after a restart therefore increments
`futileRePrompts` even if the run genuinely progressed.

The error is one-sided and conservative (it can only shorten a run, never extend one), and it
takes three consecutive restart-then-idle sequences with no ordinary idle in between to reach
the limit — so this is a documentation defect first and a behavioural one a distant second. It
is the C-033 shape all the same: a comment asserting something the code below it does not do,
which M5 cannot see and a green suite does not care about. Left as-is for Phase 10's review to
rule on: either persist the baseline (a §2.3 schema change, so STOP-AND-PARK) or correct the
sentence.

---

## C-068 — C-067(b) was not a documentation defect, and the fix round proves it

The Phase 10 review took C-067(b) at its word and then checked it. C-067(b) reasoned that the
in-memory comparison baseline "can only shorten a run" and that reaching the limit "takes three
consecutive restart-then-idle sequences with no ordinary idle in between". Both halves of that
reasoning are wrong for the same reason: **the counter is persisted while the baseline is not.**
A process that dies with `counters.futileRePrompts` at 2 comes back with the counter still at 2
and `state.lastSignature` at `null`. One idle takes the increment branch on no evidence and
writes 3; the next idle's `shouldTerminate` returns `noop`. That is ONE restart, not three, and
the run it kills is a run that moved.

Severity as filed: MAJOR, and the file was right. §3.7's wedge detector exists to stop a run that
is NOT moving. Here it fired on one that was — stop `{kind:'noop'}`, a stop-report written,
worktrees removed, the run archived.

### The red, run before the fix

A new test tagged `[10.1-signature-change-resets]` — a non-terminal EXECUTING run with
`idleRePrompts 2 / futileRePrompts 2` persisted, a FRESH `createContinuationState()`, one idle,
a real state change (I1 PENDING → RED), a second idle. Against committed code it failed at
`3 !== 2`: pass one incremented on hearsay. The gatekeeper re-ran it as a revert rather than
taking the implementer's word — detached worktree at HEAD `0978540` with both working-tree files
copied in, the fix alone reverted to the committed ternary: **34 → 33/34, and the only failing
test is the new one.**

### The fix, and the trade it takes

`continuation.ts:671` — a pass with NO prior in-memory observation on a run that has ALREADY been
re-prompted (`state.lastSignature === null && run.counters.idleRePrompts > 0`) carries
`counters.futileRePrompts` forward untouched instead of incrementing it. A run that has never
been re-prompted (`idleRePrompts 0`) still counts its first re-prompt, which is what keeps the
committed 1,2,3 row true for a fresh wedge. A genuinely wedged run still stops; a restart costs
it one extra prompt. That is the same trade SG-3 already takes on the debounce clock, and it is
the right direction: a restart may cost a prompt, it may never cost a live run.

### What was NOT done, and why it is a residual and not a park

SG-3's literal claim that the baseline "is derived from persisted state and so survives a
restart" is not achievable as written. The signature **as of the previous re-prompt** is not a
function of the current persisted state — a restarted process can compute today's signature but
has nothing to compare it against. Making it durable needs a new field in `run.json`, i.e. a §2.3
schema change. The sentence was corrected to state what the code actually guarantees. The
durable-baseline option remains available to anyone who opens §2.3 for other reasons; it buys
back one prompt per restart and nothing else.

### Three mutations, RUN not reasoned

| mutation | result |
|---|---|
| revert the guard entirely (committed code) | 33/34 — only the new RESTART test fails |
| drop `state.lastSignature !== null &&` from the reset ternary (C-067's stated tell) | 28/34 — 6 rows fail |
| over-broaden the guard to `run.counters.idleRePrompts > 0` (wedge detector never fires) | 28/34 — 6 rows fail, the RESTART test among them |

C-067's tell was mis-stated — dropping that clause is caught by the committed 1,2,3 row too — but
the defect it pointed at was real, which is the part that mattered.

### The lesson, and it is C-033's again with a twist

C-067 found this by reading a comment that claimed more than the code did, and then **reasoned
about the consequence instead of running it**, and got the consequence wrong in the safe
direction. A residual filed as "documentation defect first, behavioural a distant second" is a
residual nobody schedules. Durability boundaries are not reviewable by reading: pair the durable
field with the volatile one and ask what the first pass after a restart does with both.

---

## C-069 — a test asserted its own checkout's path, and only a fresh worktree could see it

`scripts/test_conductor_wiring.py:1130` read:

```python
self.assertIn(str(REPO_ROOT), section, "every command records the cwd it ran from")
```

`REPO_ROOT` is `SCRIPTS_DIR.parent` — the path of **whatever checkout is running the test**.
`section` is the Task 12.1 Step 2 block of `router/UPSTREAM_CONTRACT.md`, whose line 14 records
the cwd the live measurement was **historically** observed from, as the literal string
`/Users/sal/development/vorlac/llama-harness`. So the assertion compared a frozen historical
path against a live runtime path. It can only pass in the one clone the artifact was written in.

- **The intent was right.** M8 discipline says a live measurement must record the cwd it ran
  from, and the artifact does record it. The *mechanism* was wrong: it read the record by
  matching it against the environment instead of checking the record's own shape.
- **The fix** requires the section to contain ``run from `<path>` `` and requires that captured
  path to be absolute. `router/UPSTREAM_CONTRACT.md` was **not** edited — the record was already
  correct.
- **Provenance:** `git log -S 'every command records the cwd it ran from' -- scripts/test_conductor_wiring.py`
  returns exactly one commit, 589d22e (12.1). Latent since 12.1 landed; the Phase 10 phase gate's
  fresh-worktree leg was the first run in this build to exercise it.

**The mutations, run in the fresh worktree rather than reasoned about:** restoring the pre-fix
assertion reproduces the gate failure verbatim in that tree; deleting the recorded-cwd line
fails; rewriting the cwd as the relative `../llama-harness` fails. Both directions, so the new
assertion is not merely the old one weakened until it passed.

**Why this is worth a numbered correction and not a footnote.** Every quality signal this build
trusts was green on it. The suite was 1235/1235. M4 passed. Two phase gates passed. The per-task
review of 12.1 passed. A defect that makes the repository un-buildable by anyone else survived
all of them, because all of them ran in the same directory. `phaseGates["11"]` even claims a
fresh-worktree PASS at a commit where this was already failing — it enumerates four legs and
never names the python one, which is what a partial reading looks like when it is written down
as a pass.

**The generalisation, and it is a sharper version of C-044…C-047:** those were checks that
inspected less than they appeared to. This is a check that inspected the *environment* when it
meant to inspect the *artifact*. Any assertion whose expected value is computed from `__file__`,
`cwd`, `REPO_ROOT`, `$HOME`, or a hostname is testing the machine, not the code. Grep for that
shape before trusting a suite as a portability claim — and note that the only leg of the build
that could ever have caught it is the one that runs somewhere else.

---

## C-070 — a fix round that closed seven seams and left the eighth closed only for the fixture

The Phase 10 stage-2 reviewer confirmed seven majors in Task 10.1. The fix round returned all
seven GREEN (main tree 1242/1242, five legs), and the implementer disclosed a mutation table of
nine entries. I re-ran every one of the nine in the main tree against a `cp` snapshot: **all nine
are caught, each by exactly one row.** Eight of the nine name a real production seam. The
verdict is still FAIL, on the ninth.

### What the mutation table could not tell me

`reconcileOrphanQuestions` had to separate a half-applied `blockAndAsk` from a §2.5-legal
`conductor_queue_amend` release. The two are byte-identical in durable content, and the fix
reaches outside the content for a discriminator:

```ts
const questionsNs = lastWriteNs(path.join(runDir, "questions.jsonl"));
...
const itemNs = lastWriteNs(path.join(runDir, "items", itemId + ".json"));
if (questionsNs !== null && itemNs !== null && itemNs > questionsNs) continue;
```

`questionsNs` is the mtime of the **whole file**, not of the question being reconciled. One
further append to `questions.jsonl` — from any origin, for any other item — moves that mtime past
the released item's, and the release is forgotten. The committed row passes because its fixture
appends its second question *before* the amend and never appends another.

**PROBE-G1, run not reasoned.** The committed row, with one line changed: the run carries on and
a later item I3 blocks, so its question is appended after the amend. VERBATIM:

```
PROBE-G1 I1.blocked after a later question append: {"reason":"completing a half-applied block: open question Q-0001 names this item but the item carried no disposition (§2.11, C-032 E7)",...,"questionId":"Q-0001"}
PROBE-G1 I3.blocked (the genuine orphan): {...,"questionId":"Q-0002"}
not ok 42 - PROBE-G1: a released item survives a LATER question append
```

The amended item is re-blocked on the question the amend released it from, and will be re-blocked
again after every subsequent amend. That is the original finding, verbatim, one ordinary event
later. The escape hatch is not restored; it is restored until the next question.

The write-order idea is not wrong — the release *does* write the item last. What is wrong is the
granularity: the comparison must be against the moment **that question** was appended, and
`questions.jsonl` does not carry it into the filesystem. The durable record does have the fact
the guard needs (`Question.askedIso`, and the item's own `blocked`/disposition history); a
content-level discriminator is available and a filesystem-level one is not.

### And a regression the round introduced

Releasing the one-in-flight latch on a synchronous throw is right. But the pass that threw still
increments `idleRePrompts` **and** `futileRePrompts`, still stamps `lastRePromptMs`, and still
writes the `info continuation/reprompt` record — a send that never reached the transport is
accounted for exactly like one that did.

**PROBE-G2.** A permanently failing transport, four idles:

```
PROBE-G2 prompts that reached the transport: 0
PROBE-G2 fourth idle stop: {"kind":"noop","reasonDisplay":"the run made no observable progress across 3 consecutive re-prompts (§3.7 futile re-prompt limit reached): disengaging rather than burning tokens",...}
PROBE-G2 disengage anomalies: 1
```

The run is killed, and the durable reason says the orchestrator was re-prompted three times and
did nothing. It was never asked once. The pre-fix behaviour was a silent wedge; this is a false
accusation written to `run.json` and to the anomaly log. It is the better failure of the two and
it is still a defect: a failed send is not a futile re-prompt.

### What the round did close, verified

| seam | mutation | caught by |
|---|---|---|
| plugin's own claim derivation | `inlineClaimScope: null` | the new production-wiring row |
| plugin's own tree resolution | delete `resolveSessionTree(...)` | the same row |
| SG-10 fail-closed on mixed payloads | restore the wildcard-filtering form | ask-path-unextractable-reject |
| progress outranks the wedge stop | delete the reset before `shouldTerminate` | signature-change-resets |
| latch release on a sync throw | delete the try/catch | one-reprompt-in-flight |
| conversions survive a failed send | `.then(settle, settle)` | needs-context (delivery) |
| conversions are run-scoped | drain with `splice` | needs-context (run scope) |
| an ended run reports what it lost | delete the archive-time record | needs-context (run scope) |

The implementer's correction to the reviewer also holds and is worth keeping: the claim that
`resolveSessionTree` at `plugin/index.ts:556` is "provably inert because gateBeforeToolCall
re-derives the tree" is **wrong** — `tools.ts:340` reads `entry?.tree ?? ""`. Deleting that line
now fails a test. A reviewer's "provably inert" was reasoning where a mutation was available.

### The lesson

An implementer who discloses a mutation table and flags his own least conventional change is
doing the job — this one wrote "worth a reviewer's eye" over exactly the change that failed. The
gate's own job is the step past the table: for each mutation, ask what the *fixture* supplies
that production does not. Here the fixture supplied a `questions.jsonl` that never grew again.
**A discriminator drawn from outside the durable record is a discriminator the record cannot
defend.** When a fix has to reach for the filesystem to tell two states apart, the real finding
is usually that the state machine is not writing down something it knows.

---

## C-071 — the state machine writes down what it knows, and a failed send stops accusing anyone

Round 2 of the Phase 10 stage-2 gate was scoped to exactly two things: the major C-070 found
still open, and the regression C-070 found introduced. Both came back closed, and this time the
mutation that mattered was one the gatekeeper wrote rather than one the implementer disclosed.

### The discriminator moved into the record

C-070's finding was that `reconcileOrphanQuestions` told a half-applied `blockAndAsk` from a
§2.5-legal `conductor_queue_amend` release by comparing two file mtimes — and that
`questions.jsonl` carries ONE mtime for every question in the run, so a later append for any
other item moved it past the released item and the release was forgotten.

The fix stops asking the filesystem. `store.clearBlocked` writes the released question's id into
the item's own record:

```ts
const questionId = item.blocked?.questionId;
if (questionId !== undefined) {
  const released = item.releasedQuestions ?? [];
  if (!released.includes(questionId)) item.releasedQuestions = [...released, questionId];
}
item.blocked = null;
```

and the reconciler reads it: `if ((item.releasedQuestions ?? []).includes(question.id)) continue;`.
`lastWriteNs` and the `statSync` import are gone. The immunity is per QUESTION, not per item, so
a *new* question's half-applied window on a previously-released item is still repaired — and that
second half is asserted in the same row, because the obvious over-fix ("this item was released
once, leave it alone forever") would have passed a row that only checked the first half.

**The mutation that decides it.** Restoring round 1's mtime discriminator verbatim takes the suite
to 1243/1244 with **only the new row** failing — the round-1 row still passes underneath it. That
is the whole of why round 1 shipped green, reproduced on demand, and it is the reason both rows
now have to live side by side rather than one replacing the other.

Six mutations were run, each through the full gate and then again scoped to name the row:

| mutation | result |
|---|---|
| delete the `releasedQuestions` guard | 1242/1244, new row fails |
| restore round 1's `statSync` compare (the PROBE-G1 defect) | 1243/1244, **only** the new row fails |
| `clearBlocked` stops recording the release | 1242/1244, new row fails |
| widen the guard to `releasedQuestions.length > 0` | 1243/1244, new row's second half fails |
| delete `if (!sent) return {...}` (the PROBE-G2 defect) | 1243/1244, the in-flight row fails |
| delete the try/catch around `session.prompt` | 1242/1244, the in-flight row fails |

### A send that never left is not a re-prompt

The regression: a prompt call that threw on the way out still incremented `idleRePrompts` and
`futileRePrompts`, so three transport faults reached the §3.7 futility threshold and the fourth
idle killed the run with a durable "no observable progress across 3 consecutive re-prompts". The
orchestrator was never asked once.

The accounting now follows the send — `if (!sent) return { runId, prompted: false, stop: null };`
sits ahead of the counter block — so a thrown call charges nothing, stamps no debounce clock,
records no signature and writes no `info continuation/reprompt`. The `error` record the fail-soft
path already writes is the whole trace. A call that RETURNED and rejects later still counts: it
left the process, and its conversions go back on the queue as before.

### The cross-task edit, approved on the record

`conductor/core/types.ts` and `conductor/adapter/state.ts` were first added by earlier tasks. The
round added one optional `Item` property and five lines inside `clearBlocked`. Approved, because
round 1's own recorded direction was to draw the discriminator from "the item's own block history"
and **that history did not exist**: `blocked` holds one disposition and forgets the questionId
when it goes null, the amend's decision record does not name the item, and `journal.jsonl` rotates
and is level-filtered so it is not a system of record. Creating the fact necessarily touches the
type that declares it and the writer that knows it; the only alternative was keeping the `stat()`.
`releasedQuestions` is in the schema's `properties` and absent from `required`, so every §2.5 item
ever written still validates — and adding it to `properties` was mandatory, not optional, because
the item schema is `additionalProperties: false`.

Three residuals were recorded rather than fixed (GATES.json `stage2FixRound2.residualsRecordedNotFixed`):
the guard depends on an optional `blocked.questionId` that every production setter happens to
supply; under first-block-wins an amend still does not free an item a *second* open question
names, which matches C-056's hand-off doctrine; and a thrown send is now retried on every idle
rather than paced by the debounce.

### The lesson

C-070 said a discriminator drawn from outside the durable record is one the record cannot defend.
The repair is the general form of that: **when a guard has to reach outside the state for a fact,
the finding is that the state machine is not writing down something it already knew.** The moment
`clearBlocked` runs is the last moment the item knows which question released it. Writing it there
costs one optional field and removes an entire class of failure — replay, backup restore, file
copy, coarse-mtime volume — that no test in this suite would ever have run.

---

## C-072 — the Phase 12 gate, stopped at stage 1: the phase was not finished

Stage 1 exists so no reviewer is convened over a tree that cannot support one. It stopped here,
and the reason is not subtle: **task 12.2 is still in flight.** `STATE.json` has it `NOT_STARTED`,
`IN_PROGRESS.json` has it at `red-observation`, and the working tree holds all of it uncommitted —
1068 changed lines across five `conductor/` modules and an untracked 2240-line
`conductor/tests/setup.test.ts`. The main-tree gate is red: `tests=1272 pass=1271 fail=1`, run
twice, identically. The single red is in `setup.test.ts` (28 tests against the spec's 28 rows,
1:1). So 27 of 28 rows are green — `red-observation` is a stale label on a nearly finished task,
not an accurate one.

### The fresh worktree said the quiet part

`git worktree add $TMPDIR/verify-p12 HEAD`, its own `npm install`, then the complete gate: **1244
pass, 0 fail, five legs, GATE PASS.** HEAD is *greener than the working tree*, and that is the
finding, not a comfort. 1272 − 1244 = 28: exactly task 12.2, absent from the repository. The
lesson C-069 wrote down — a green main tree proves nothing about a fresh checkout — has a mirror
image that had not been written down: **a green fresh checkout proves nothing about the phase**,
because work that was never committed cannot fail there.

One good thing fell out of it. `HANDOFF.md` carried an owed item: phase 10's stage-2
fresh-worktree leg was never re-run after either fix round, and the argument for skipping it was
that no build input changed — "an argument, not a measurement", in its own words. This worktree
was cut from `203016d`, the phase-10-PASS commit. It is now a measurement.

### The 12.1 supervisor obligation, adjudicated: CONFIRMED MAJOR

C-062 deferred five disclosed survivors to this gate. The serious one is unchanged in the tree.
`scripts/test_conductor_wiring.py:868-874` does this:

    source = cw.ROUTER_SUPERVISOR_SOURCE
    self.assertIn("os.kill(shell_pid, 0)", source)
    self.assertIn("SIGTERM", source)
    self.assertIn("SIGKILL", source)
    self.assertLess(source.index("SIGTERM"), source.index("SIGKILL"), ...)

Four assertions about a **string**. The supervisor is never executed by any test in the suite. A
supervisor that carries every one of those tokens in a comment and signals nothing passes all
four. C-062 stated the consequence exactly: *"a router that outlives every session would not fail
this suite."* The out-of-band transcript that shows the real behaviour is correct does not change
what the suite enforces. Recorded as a confirmed major and promoted to a fix-round obligation: it
needs an executed test — spawn the real supervisor source against a fake router binary and a fake
shell pid, and assert the signals observed and the reap. The gatekeeper does not write tests, so
this closes as an obligation, not a fix. It is the C-044/C-047/C-063 class again, and this is the
third gate in a row to find it.

### M5 has been reporting a number that does not cover the phase

`scripts/conductor-gate.sh` reported `M5 PASS (115 file(s) scanned)`. Its default file set is
`git ls-files` over `conductor/**/*.ts`, `router/**`, `tools/**`. **`scripts/` is not in that
list**, so `scripts/conductor_wiring.py` and `scripts/test_conductor_wiring.py` — the entirety of
task 12.1's product — have never been scanned by M5. `git ls-files` also excludes untracked
files, so 12.2's 2240-line test file was invisible too. Re-run in explicit-file mode over the
phase-12 set it reports `M5 PASS (12 file(s) scanned)` and is clean, so nothing is wrong with the
code; what is wrong is that the number 115 was being read as coverage.

C-057 added the floors after the C++ half went unscanned for two commits when `src/router` became
`router`. The floors catch a glob that has **moved**. They cannot catch a glob that never
**reached** — and `scripts/` was never reached. "Make every scanner report how much it inspected"
is only half the rule; the other half is checking the number against what you meant to inspect.

### An obligation kept in a one-slot file is an obligation you are going to lose

This gate's brief cites `IN_PROGRESS.json` `processNotes.greppingSourceIsNotTesting` as where the
12.1 obligation lived. That field is gone: `IN_PROGRESS.json` is a single slot, rewritten when
12.2 started, and it now holds only `taskId`, `step`, `intendedFiles`, `startedAt`. The obligation
survived only because C-062 also wrote it into this file. Durable obligations belong in
`CORRECTIONS.md` or `GATES.json`; `IN_PROGRESS.json` is a liveness marker, not a ledger.

Also backfilled here: `STATE.json` had task 12.1 `COMMITTED` with `commitSha: null`. The commit is
`589d22e`. A status without a sha is a claim without a receipt.

## C-073 — the Phase 12 gate, re-run: stage 1 PASS, and the string test kept passing

One fix round, and stage 1 clears. `bash scripts/test-conductor.sh`: **tests=1272 pass=1272 fail=0**,
five legs, run twice identically. C++ 92 cases / 27,726 assertions. M5 clean in both modes. The
fresh worktree — this time cut from HEAD, loaded with the exact file set about to be committed,
`cmp`-verified byte-identical, given its own `npm install` — also reports **1272/1272, GATE PASS**.
That ordering is deliberate: run the fresh checkout *before* the commit and over the *intended* set,
and a forgotten `git add` fails there instead of six commits later.

### C-072's major is closed by a test that runs, and the old test proves why that mattered

`scripts/test_conductor_wiring.py` gains `class RouterSupervisorExecution`: two cases that execute
the real `cw.ROUTER_SUPERVISOR_SOURCE` in a real interpreter via `cw.start_router_supervisor`,
against a planted fake router binary and a real throwaway process standing in for the session shell.
`[12.1-supervisor-signals-executed]` kills the shell and asserts the router records the SIGTERM it
*actually received*, exits, is reaped, and its pid is gone, while the supervisor exits 0.
`[12.1-supervisor-sigkill-executed]` gives the router a SIGTERM handler and a refusal to die, and
asserts it is gone anyway, never exited voluntarily, and not before `ROUTER_TERM_GRACE_S` elapsed.

The gate ran C-072's mutation itself rather than taking the fix round's word for it — `stop()`
replaced by a bare `return`, with the SIGTERM kill, the grace deadline and the SIGKILL escalation
demoted to comments so every token the string test greps for survives, in order:

    Ran 31 tests ... FAILED (failures=2)
    FAIL: test_12_1_supervisor_escalates_to_sigkill  — the router was never signalled
    FAIL: test_12_1_supervisor_signals_and_reaps     — the router was never signalled

`test_12_1_supervisor_lifecycle` — the four `assertIn`/`assertLess` checks over the source string —
**passed**, against a supervisor that signals nothing. C-062 wrote the consequence down and C-072
adjudicated it; this is the run that shows it. The string test is kept, not deleted: it pins the
argv and flag shape cheaply, and the pair now bins distinctly, so losing the signal and losing the
escalation fail different rows.

Cost, disclosed: the escalation case must spend the real 10.0s grace in wall clock. The python leg
goes ~1s → ~13s and the gate ~90s → ~105s. Shortening it would mean not running the real source.

### The red row was the test being wrong about its own subject

`[12.2-detect-itemtest-templates]` mapped ecosystem → profile by identity except `cmake→ctest`. But
`RUNNER_PROFILES` is keyed by **runner** — `node/pytest/go/ctest`, and `[12.2-detect-cargo]` pins
that there is no fifth — so the python scope compared `'pytest'` against `'python'`. Ten lines
above, the same test asserts `detectRunner(pyScope.command).runner === "pytest"`. It contradicted
itself, and the product was right the whole time. Replaced with an explicit `PROFILE_FOR_ECOSYSTEM`
map plus an assertion that every non-cargo ecosystem *has* a mapping, so an unmapped ecosystem fails
loudly instead of silently comparing against `undefined`. The gate's second mutation — dropping the
`python3 -m pytest` arm from `detectRunner` — takes `setup.test.ts` to 26/28, so the repaired
expectation still binds to a real committed profile rather than to whatever `detectRunner` returns.

### Two rows added to a committed spec, and one commit message that will not answer the usual query

`docs/build/specs/task-12.1.assertions.json` had 29 rows against 31 named tests once the executed
pair landed — M7 would have flipped red for the opposite reason. The two rows are added as **text**,
not by re-serialising the file: a `json.dump` round-trip reformatted all 86 lines (the file keeps
`"planLines": [2866, 2889]` inline and its em dashes unescaped) and made the diff unreadable. The
surgical edit is +10 lines. `GATES.json` and `STATE.json` *do* round-trip byte-stably under
`indent=2, ensure_ascii=True`; that was checked with a no-op dump before either was touched, not
assumed.

Deviation worth knowing before you trust the usual query: **task 12.2's product is committed under
`conductor-build: phase 12 gate stage 1 repair`, not under its own `conductor: 12.2 first-run
setup`.** 12.2 was left uncommitted when the phase gate was dispatched over it, and the gatekeeper —
the only role permitted to write git — committed the repair under the message its brief specified.
So `git log --grep='^conductor: 12.2'` finds nothing. `STATE.json`'s `status` + `commitSha` is the
receipt, which is exactly what `meta.convention.commitSha` says it is for.

### Still open, and one of them is now three gates old

`scripts/conductor-gate.sh` still cannot see `scripts/`. Its `git ls-files` globs are
`conductor/**/*.ts`, `router/**`, `tools/**`, so task 12.1's entire product — including the executed
supervisor tests this correction is about — is not in the 115 files M5 reports. The file is
orchestrator-owned and says so on line 2, so neither the fix round nor the gate could widen it;
both passed the files explicitly instead, and M5 is clean over them. The untracked half self-heals
here: `setup.test.ts` becomes tracked with this commit and the default glob picks it up. The
`scripts/*.py` half is an orchestrator edit and is still owed.

Four of C-062's five disclosed 12.1 survivors also remain: `wait_for_router_health` is still called
by no test, `ROUTER_TERM_GRACE_S` has no upper bound, and `derive_slots`' bool guard is unpinned.
Only the serious one closed.

Stage 1 passing is permission to convene a reviewer, not a phase verdict. Stage 2 has not run.

## C-074 — the Phase 14 gate, stopped before it started: the phase does not exist

**What happened.** A phase-14 stage-1 gate was dispatched. Phase 14 has no work in it. STATE.json
carries 14.1 (bench driver) and 14.2 (POC run) as NOT_STARTED with no commitSha, `git log
--grep='^conductor: 14\.'` returns nothing, and `git grep -l -E '14\.[12]-' -- conductor scripts
router tools` returns nothing — not one of the 51 assertion ids already written into
`docs/build/specs/task-14.1.assertions.json` (33 rows) and `task-14.2.assertions.json` (18 rows) is
named by any tracked file. Phase 13 is unbuilt too, and 14.2 depends on it. Phase 12's stage-2
reviewer has still never been convened. This is the same class as C-072 — a gate dispatched over
unfinished work — one phase further along and one degree worse: C-072's phase was half-done and
uncommitted, this one is not started at all.

**Why it matters, given every leg was green.** The gate ran the full battery anyway. Main tree
1275/1275 five legs exit 0. Fresh detached worktree of HEAD `eb39500`, its own `npm install`, complete
gate from scratch: 1272/1272 five legs GATE PASS. C++ 92 cases / 27,726 assertions. M5 116 files, 6
exemptions all live. **All green, and none of it is evidence about phase 14.** The legs are green
*because* phase 14 has not begun. A gatekeeper that reports its legs and stops has produced exactly
the artifact C-044…C-047, C-063 and C-072 keep naming: a check that passes while inspecting less than
it appears to. So M1, M2 and M7 are recorded FAIL against green output, and the M5 phase-set scan is
recorded **NA over an empty subject** rather than PASS over zero files. The rule this hardens: **a
phase gate's first act is reading STATE.json for its own rows' status — before any command is run.**

**Finding 1, carried forward as an obligation: 669 unowned lines.** `git diff --shortstat` at gate
time showed 5 files, +669/−74 across `conductor/adapter/tools.ts`, `conductor/tests/setup.test.ts`,
`scripts/conductor_wiring.py`, `scripts/serve.py` and `scripts/test_conductor_wiring.py`, carrying at
least nine new **phase-12** assertion ids (`[12.2-proof-slot-count]`, `[12.2-proofs-origin-fail-soft]`,
`[12.2-zero-model-dispatch]`, `[12.2-proof-schema-probe]`, `[12.2-detect-multi-ecosystem]`,
`[12.1-session-env-router]`, `[12.1-router-config-shape]`, `[12.1-readiness-fallback-direct]`,
`[12.1-ctx-per-slot-preserved]`) and lifting the working tree to 1275 node / 35 python against HEAD's
1272 / 31. `IN_PROGRESS.json` is absent and no STATE.json row claims any of it. The work is green; the
**attribution** is missing. HANDOFF.md's "the working tree matches it" was false and is corrected.
Either take this through a task gate under a STATE row or revert it — an unowned green diff is exactly
how a phase gets declared done over work nobody gated.

**Finding 2, and it faked a red inside this very gate: a fixed /tmp path in the gate wrapper.**
`scripts/test-conductor.sh` writes the python leg to the hard-coded `/tmp/python-leg.out` (line 103)
and then greps the count out of it (line 111) and the G4 skip trailer out of it (line 119). Two gate
runs on one machine share that file. This gate first ran the main tree and the verification worktree
**concurrently**; the worktree's run truncated the file mid-grep and the main tree printed
`GATE FAIL: python leg discovered ZERO tests (scripts/test_*.py moved or renamed?)` immediately above
its own `Ran 35 tests … OK`. Serialized and re-run, exit 0. The failure direction here is safe — a
false red — but the same corruption feeds the skip check, which can then read another run's trailer.
`test-conductor.sh` is orchestrator-owned: the fix is a per-run `mktemp` path. Until then the
operational rule is **gate runs are serial; never two trees at once.** Note the shape of it — the
guard that exists specifically to catch a vacuous green (C-015's "unittest discover exits 0 on Ran 0
tests") is itself the thing that misfired, because it reads a file it does not own.

**Finding 3, minor.** `git worktree list` still shows a stale `scratchpad/wt12` at `eb39500`, left
from the phase-12 gate, whose record asserts "worktree removed afterwards; `git worktree list` shows
only the main tree". That claim is falsified. Left in place here in case a concurrent session holds
it. Also still open, fourth gate running to say it: `scripts/conductor-gate.sh`'s default set never
reaches `scripts/`, so task 12.1's entire product sits outside the "116 files scanned".

**Order of work.** 1. Attribute or revert the 669 lines. 2. Dispatch phase 12 stage 2. 3. Build and
gate phase 13 (13.1, then 12.1-G5, then 13.2). 4. Then start 14.1 — move
`scratchpad/staging/task-14.1/test_conductor_bench.py` into `scripts/`, observe its red, implement,
task-gate it. 5. Re-run phase 14 stage 1, naming this verdict as its prior.

## C-075 — acceptance repair round 2: nothing was repairable, and the meter says so twice

**Verdict: no rows closed. `bash scripts/verify-acceptance.sh` → 17 PASS / 4 FAIL at `3506dda`,
byte-for-byte the same four failures round 1 left behind.** The repair sub-agent returned STUCK with
an empty `filesTouched`, and the gatekeeper re-derived every claim rather than take it: main-tree
gate **1280/1280, five legs, GATE PASS**; C++ `router-tests` **92 cases / 27,726 assertions,
SUCCESS**; M5 **PASS (117 files, 6 live exemptions)**. All green — and green proves nothing here,
because the four failures are not defects in shipped code. They are three tasks that do not exist.

**Why a repair round could not have worked.** The failing set is `row 6` (wants `conductor/SMOKE.md`,
task 13.2), `row 8` (wants `docs/build/artifacts/conductor-report.md`, task 14.2), `row 12`
(manifest commit messages missing `13.2,14.1,14.2`) and `detector E` (the union of rows 6 and 8).
Every one of them is a **live-measurement** row. 13.2 is an opencode session driven against
qwen3.6-27b with verbatim transcripts; 14.2 is ninety detached headless runs on a local 27B, budgeted
in hours, gated behind its own GO/NO-GO that greps `git log` for 14.1's commit. Neither artifact can
be written from a text editor. `verify-acceptance.sh:143-147` names authoring them anyway as the
single worst outcome available to this build, and it is right: a fabricated `SMOKE.md` turns a
failing meter into a passing meter and a true statement about the system into a false one. **The
correct output of this round was zero code changes, and that is what it produced.**

**Finding 1, major, and the reason this round was worth its cost — the 14.2 report has two
different mandatory paths, and they disagree.** `docs/build/specs/task-14.2.assertions.json` row
`14.2-committed-copy` (spec line 118, reasoned at length in SG-A, spec line 33) fixes the committed
report at **`bench/conductor-report.md`**, choosing `bench/` over `docs/build/` deliberately, because
the report is only interpretable beside the manifest that defines the ten tasks it scores.
`scripts/verify-acceptance.sh:163` hard-codes **`POC=docs/build/artifacts/conductor-report.md`** and
fails row 8 plus detector E when that exact path is absent. **A flawless 14.2 campaign, executed
exactly as its own spec instructs, lands the artifact where the meter does not look and leaves
acceptance at 17/4.** The meter is the authority and is not editable by any build role, so the
resolution is **additive, not a move**: 14.2 must land the report at BOTH paths, byte-identical to
each other. This costs nothing — row `14.2-no-tuning` already permits `docs/build/*` in that commit's
changed-file set, so the second copy is in-bounds as written. Whoever writes 14.2's spec revision
makes this change **before** the campaign launches; discovering it after ninety runs means either a
re-run or an artifact shuffled across paths after the fact, which is exactly the "measurement tuned
while it is being taken" shape row `14.2-no-tuning` exists to forbid. **The gatekeeper did not edit
the spec.** Amending an assertions row changes what a future task must prove, which is test-writing,
and the gatekeeper writes neither tests nor implementation. It is recorded here for the orchestrator.

**Finding 2, major, unchanged from round 1 and now blocking two rows.** Task **14.1 is code-complete
on disk and uncommitted**: `scripts/conductor_bench.py` (1,847 lines), `scripts/test_conductor_bench.py`
(1,947), `bench/conductor-tasks.json` (10 tasks). The python leg discovers and passes them — `Ran 68
tests, OK`, no skips — which is precisely why the gate above reads green while the ledger reads
NOT_STARTED. **Nothing in that paragraph is committed, so none of it counts.** Worse, it is invisible
to M5: the scanner's default set is `git ls-files`, so 3,794 untracked lines sat outside the "117
files scanned" that this very round reported as clean. That is the C-044…C-047/C-063/C-072 defect
class again, on its seventh appearance — **a scanner that passes while inspecting less than it
appears to.** When 14.1 is committed, pass its three files to `conductor-gate.sh` EXPLICITLY.

**Finding 3, minor, and the reason nothing was touched.** The worktree is not clean and two peer
sessions are live (`llama-harness-09`, `llama-harness-9e`). `git status` shows modified
`conductor/adapter/tools.ts`, `conductor/tests/setup.test.ts`,
`scripts/{conductor_wiring,test_conductor_wiring,serve}.py` plus untracked `bench/`,
`scripts/conductor_bench.py`, `scripts/test_conductor_bench.py` and two `docs/` files the repo owner
owns. **The gate numbers above therefore describe the dirty tree, not `3506dda`.** They are still
load-bearing in the safe direction — a green dirty tree containing HEAD's content plus additions does
not prove HEAD green, but this round committed no code, so HEAD's own greenness is unchanged from
round 1, where it was proven in a detached worktree. Record it plainly rather than let a later
reader mistake 1280/1280 for a measurement of the commit.

**Order of work — unchanged, and strictly ordered.** 1. Bind the 22 conductor tools in
`conductor/plugin/index.ts`; until then a live session cannot advance one stage and 13.2 cannot run
at all. 2. Reconcile the peers' in-flight edits, then commit 14.1 under its own message,
`conductor: 14.1 bench driver` — landing it under any other message makes row 12 permanently
unachievable for it. 3. Revise 14.2's spec per Finding 1. 4. Run 13.2 (live, → `conductor/SMOKE.md`).
5. Launch 14.2 **detached** (→ both report paths). Rows 6, 8, 12 and detector E clear together, and
only when those three tasks are genuinely built and genuinely measured.

## C-076 — 12.2's commit renamed instead of its claim: the scar from C-073, closed

C-073 recorded that 12.2's product landed under `conductor-build: phase 12 gate stage 1 repair`
(`eb39500`) rather than under its own manifest message, and drew the consequence plainly:
`git log --grep='^conductor: 12.2'` found nothing, so acceptance row 12 counted 12.2 as a missing
manifest commit. C-075's repair round then made row 12 pass **by editing STATE.json's
`commitMessage` for 12.2 to the phase-gate message that had actually landed** — which is the wrong
direction. Row 12 exists to check that each manifest row's deliverable landed under that row's own
message; rewriting the expected string to whatever happened to be in the log turns the meter into a
tautology. It inspected a string that existed instead of the claim that did not.

**What was done instead.** The repo owner chose to rewrite the commit rather than the claim.
`git filter-branch --msg-filter` over `eb39500~1..HEAD` replaced that one commit's subject with the
verbatim manifest message `conductor: 12.2 first-run setup` and left every tree byte-identical
(HEAD's tree hash is `e01ec00` before and after). Seven commits were rewritten and force-pushed to
`origin/main`; the working tree's five modified files were stashed by explicit path across the
rewrite and restored unchanged (669 insertions, cmp-clean).

**Old → new sha map.** Any short sha quoted in an earlier correction or in `JOURNAL.jsonl`
resolves through this table. Those historical texts are deliberately NOT
rewritten — they record what ran at the time — but `STATE.json`'s four in-range `commitSha` receipts
and `GATES.json`'s `phaseGates['14'].headAtGate` are updated, because those are machine truth.

| old | new | subject |
|-----|-----|---------|
| `eb39500` | `09c8c57` | `conductor: 12.2 first-run setup` (was `conductor-build: phase 12 gate stage 1 repair`) |
| `da31871` | `cddd9b9` | `conductor-build: phase 14 gate stage 1` |
| `71c45a9` | `c4fa9f7` | `conductor: 13.1 e2e scripted` |
| `c64c805` | `4afdf2b` | `conductor: 15.1 ops docs` |
| `3506dda` | `588a046` | `conductor-build: close acceptance rows round 1` |
| `dc42d88` | `cf50357` | `conductor-build: close acceptance rows round 2` |
| `6097918` | `3784d10` | `conductor-build: completion report` |

The pre-rewrite tip is kept as the tag `prerewrite-backup-20260814` (`6097918`), local only.

**The rule this leaves behind.** A failing acceptance row is not an invitation to edit what the row
expects, any more than it is an invitation to author the artifact it wants (C-075). Both moves flip
the meter and leave the truth where it was. If a row's deliverable landed under the wrong message,
the message is what is wrong — fix the message.

**And the defect that caused it, which is still unfixed at the source.** 12.2 was left uncommitted
because its staged test contradicted itself; the implementer correctly returned STUCK and refused to
edit the test. The orchestration then parked the task **with its partial work still in the tree**, so
the phase gate was dispatched over unfinished work and every later task's clean-tree precondition
blocked on it. Parking a task must also park its files.

## C-077 — 14.1's gate: a report that could lie about its own coverage, and the suite agreeing

14.1 arrived at its gate already green — 33 tests for 33 assertion rows, the python leg clean, every
id present by literal match. The M4 red re-derivation is what found the hole, and it found it only
because the mutations were aimed at the honesty surface rather than at the arithmetic.

**The finding.** Three mutations to `scripts/conductor_bench.py` left the python leg at `Ran 64
tests … OK`:

| mutation | what the report would then say |
|---|---|
| `format_recorded(recorded, planned)` → `(planned, planned)` | "30 of 30 recorded" when 22 cells ran |
| `format_rate(passes, recorded)` → `(recorded, recorded)` | every arm passing every cell it recorded |
| `format_outcomes(...)` → `"none recorded"` | every per-repetition spread erased |

The POC's whole deliverable is a quality delta with its spread and its coverage attached. All three
of those numbers could be made to lie, and the suite would not notice.

**Why the suite did not notice.** The assertions searched the rendered report for a string they
built by *calling the formatter under test*:

```python
self.assertIn(cb.format_recorded(22, 30), report, "the arm's coverage must be stated")
```

Mutate `format_recorded` and both sides of that assertion move together. It is a tautology with
respect to the one function it appears to pin — the test asserts that the report contains whatever
the formatter produces, which is true by construction for every possible formatter.

**The fix, test-only, no new row.** Each formatter's output is pinned to a literal the test states
itself, inside the three tests that already own those assertions, so the round-trip assertions below
them become anchored rather than self-referential:

```python
self.assertEqual(cb.format_recorded(22, 30), "22 of 30 recorded")
self.assertIn("22 of 30 recorded", report, "the arm's coverage must be stated")
```

Still 33 tests for 33 rows. Five formatter mutations (`format_recorded`, `format_rate`,
`format_outcomes`, `format_ms`, `format_tokens`) now fail, one failure each; the two arithmetic
mutations from the same M4 pass (`score_cell` → 2 failures, `build_run_plan` → 4) were already
caught. Seven of seven.

**The generalisation, which is the point.** This is C-071's lesson wearing new clothes — *a caught
mutation is not a closed defect; ask what the fixture supplies that production does not* — and its
sharper form: **an oracle computed by the code under test proves nothing about that code.** It is the
same shape as the scanner defect class (C-044…C-047, C-063, C-072, C-075): a check that reports PASS
while inspecting less than it appears to. Here the check inspected nothing at all. Whenever a test
searches an output for `f(x)`, `f` itself is outside the test's reach and needs its own literal pin.

**Where this pointed next, and it is not academic.** 14.1 is the driver that will render 14.2's
`conductor-report.md` — the live artifact acceptance row 8 reads and the one HANDOFF calls the worst
thing to fabricate. An unpinned honesty formatter in the driver is a fabrication route that needs no
one to fabricate anything.

## C-078 — the eighth appearance: M5's default set never reached the python half

`scripts/conductor-gate.sh` is M5, the mechanical stub scan every task gate runs. Its default file set
was `git ls-files 'conductor/**/*.ts' 'router/**' 'tools/**'` — and Phase 12's entire product is
`scripts/serve.py` and `scripts/conductor_wiring.py`, Phase 14's is `scripts/conductor_bench.py`.
Every `M5 PASS (117 file(s) scanned)` printed through those two phases described a set containing
**none of the code the phase had just written**. The standing workaround was to pass the new files
explicitly, which is to say the scan was correct only while somebody remembered that it was not —
and HANDOFF had been carrying that reminder as an open orchestrator debt for three phases.

**Fixed.** `scripts/*.py` joins the default set with its own floor of 5, matching the TS floor of 40
and the C++ floor of 10 that exist for exactly this reason (a glob that stops matching reports PASS
over an empty set and reads like a clean tree). The default scan now reports **128 files, was 117**.
Verified no-op on content: the five scans were run over all 11 tracked python files before the change
and came back `M5 PASS`, so the new coverage adds no exemptions and no false positives.

**Not fixed, and named rather than left silent.** `PAT_CATCH` is TypeScript-shaped
(`catch (...) {}`), so python's `except X: pass` is invisible to it. There are six such sites in
existing tracked python, all deliberate best-effort cleanup, so adding the pattern would mean adding
six exemptions on day one — noise for very little. The python leg's own G4 enforcement (skips and
expected-failures rejected in the unittest trailer) is unaffected and still active.

**Second defect, same commit.** `scripts/test-conductor.sh` wrote both its leg transcripts to FIXED
paths, `/tmp/bun-smoke.out` and `/tmp/python-leg.out`. Two gates running at once overwrote each
other's output and then parsed each other's counts — a gate that reads another gate's numbers is a
wrong answer that looks exactly like a right one. The documented mitigation was the rule "**run gates
SERIALLY**", which is the same shape of workaround: a correct tool only while nobody does the obvious
thing. Both now go to a per-invocation `mktemp -d` under `$TMPDIR`, removed by an `EXIT` trap.
Verified by running two gates concurrently: both `GATE PASS`, both reporting `Ran 68 tests`, no
scratch directory left behind.

Both files are orchestrator-owned; no subagent may edit either.

## C-079 — phase gates 12, 13 and 15 all FAIL, and M7 is why

Three phase gates ran stage 2 at HEAD `108ea25`: three blind lenses each, one adjudicator with
permission to settle findings by running them, then two skeptics per surviving MAJOR briefed to
refute. 62 agents, 4.79M tokens, just under three hours. **All three FAIL.** 25 MAJORs reached
adjudication; **20 were upheld with neither skeptic able to refute**, 2 upheld on a split, 3 refuted
unanimously and dropped. Every failure scenario, its exact proving mutation and both skeptics'
reasoning are in `docs/build/artifacts/phase-gates-12-13-15-findings.md`.

**The cross-cutting cause, and it is not one of the 22.** M7 — "every row in
`task-<id>.assertions.json` maps to a named test" — was recorded PASS for 13.1 and 15.1 and is
satisfied by neither.

| task | rows | times a row id appears in the deliverables |
|---|---|---|
| 12.1 | 35 rows | 35, in `test_conductor_wiring.py` |
| 12.2 | 28 rows | 93, in `setup.test.ts` |
| 14.1 | 33 rows | 33, one test method each |
| **13.1** | **42 rows** | **5** — five test titles, each a paragraph claiming many rows at once |
| **15.1** | **25 rows** | **0** — the spec names `conductor/tests/ops-docs.test.ts`; it does not exist |

Both gates' findings follow from that table rather than sitting beside it.

**Phase 15's ten MAJORs are all factual errors an anchor test would have caught on the day**: the
`llama-router` exit table claims a code 1 that `main()` never returns and omits 2, 3 and 4; the
`--ctx` row states the derivation backwards and its worked example does not compute; the run-dir map
names `state/current-run` where the code writes `current-run.json`, and omits `questions.jsonl`,
`reviews/`, `plan.md`, `run.lock`, `stale-red.json` and both out-of-repo trees; the doc promises the
router never rejects while the router emits a 503 admission envelope; `HONEST-LIMITS.md` omits the
entire build-discovered section it was the declared sink for; neither degraded mode is documented.
15.1's whole gate rested on acceptance row 11a (file present, line count) and row 11b (count the 15
numbered limits) — a 25-row contract enforced by two counting checks.

**Phase 13's headline MAJOR is the vacuous-green trap, inside the build's own end-to-end.**
`e2e.test.ts:230` sets `VERIFY_CMD = [node, "--test", "tests/*.test.ts"]`, spawned without a shell.
The fixture seeds an EMPTY `tests/` directory, and scenario 4 asserts that no test is ever written —
so its "real full verify" matches zero files, and node exits 0 on a zero-match glob. Both skeptics
tried to refute this and could not. One settled it decisively by substituting a wrapper that runs the
identical glob but exits 1 when `# tests` is 0: **3 pass / 2 fail**, scenario 4 among the failures.
The other reproduced the mutation (`tests/*.nomatch.ts`) at 5/5 green and the contrast
(`node -e "process.exit(1)"`) at 0/5, proving the command really is spawned and its exit code really
is consumed — the green is unearned, not unread. `scripts/test-conductor.sh` was written to close
exactly this hole; the row that would have closed it here,
`13.1-fixture-suite-discriminates` ("the scope command matches at least one file, never a zero-match
glob … No later 'validate passed' assertion in this file is vacuous"), is one of the 37 rows that
appear nowhere in the file.

**Phase 12's six are product defects rather than test gaps**, which is its own kind of good news —
its suite names its rows and the lenses had to go past the tests to find these. `serve.py` orphans a
loaded llama-server on any failure between readiness and `start_watchdog` (reproduced twice, child
alive one second after `main()` returned); `--print-env` re-resolves ports off the live session and
reports a URL nothing listens on plus `ROUTER=0` for a running router, with four lines of prose on
stdout where a shell is meant to `eval`; a router dying during setup's slot fan-out fails setup with
a `--parallel` remedy that has nothing to do with the cause; `setupRequiredScopes` writes coverage
that is empty at zero ecosystems and source-only at two or more, after which an item no entry covers
has no constructible test command; and the supervisor re-implements its restart policy inline while
the three tested policy functions have no caller in production.

**The rule.** M7 is a coverage check, and this build's own longest-running lesson is that **a check
which passes while inspecting less than it appears to** is the defect that keeps returning — this is
its ninth appearance and the first time the check was M7 itself. Counting that a row id appears
somewhere is not coverage; five titles claiming forty-two rows is not coverage; and a task whose
named test file does not exist should not be able to reach a gate at all, let alone pass one.

## C-080 — phase 15 fix round 1: write the test that was never written, then let it find the errors

The phase-15 gate found ten confirmed factual errors in the two operator documents (C-079). None of
them was fixed by hand. The cause was upstream of all ten: **Task 15.1 shipped with no test.** Its
spec names `conductor/tests/ops-docs.test.ts`; that file did not exist; so 25 assertion rows were
enforced by two counting checks — acceptance row 11a (the file is present and has N lines) and row
11b (the doc contains 15 numbered items). 15.1's own `revertAssertion` said so plainly and did not
notice it was a confession: *"The acceptance meter is the assertion."*

**The fix round ran the loop the task should have run originally.** A test-writer wrote the missing
anchor test — 1,495 lines, 25 tests, one row id per title — and was forbidden from touching either
document. The orchestrator observed the red itself: **2 pass, 23 fail**, matching the writer's
reported output exactly. An implementer then corrected the documents, forbidden from editing the
test or any source file. The orchestrator observed the green itself and read the whole diff by hand.

**The risk this file was most likely to fail at, checked directly.** A documentation test that reads
the document and asserts the document says what the document says is worth nothing — the C-077
self-referential-oracle shape, in doc form. So the binding was proved by mutating the **source**,
never the docs:

| mutation to the code | what the test's expectation did |
|---|---|
| add `if (cfg.impossible) return 5;` to `router/main.cpp` | `main() returns [0, 2, 3, 4]` → `[0, 2, 3, 4, 5]`, `missing` following |
| rename `alive.json` → `heartbeat.json` in `conductor/adapter/state.ts` | the required run-dir filename set moved with it |

Both restored from `cp` snapshots, `cmp`-verified. The expectations are derived from the code at run
time, so the doc stays checkable as the code changes instead of decaying into folklore.

**What was actually wrong.** The `llama-router` exit table claimed a code 1 that `main()` never
returns and omitted 2, 3 and 4. `--ctx` was documented backwards — as a total the derivation
overrides — when it is the per-slot window; the worked example (`--ctx 4096 --max-readers 6` "serves
8192 per slot") was arithmetically false. The live-run pointer had lost its extension
(`state/current-run` against the code's `current-run.json`). `report.md` was described as existing
only for a `done` run, with the actively harmful gloss *"Anything other than `done` means the report
was refused"* — the writer is guarded on `run.stop !== null`, so all six stop kinds produce one. The
doc said the router never rejects, while `router/admission.hpp` pins a 503 admission envelope with
two capacity refusals. `HONEST-LIMITS.md` carried none of the build-discovered limits it was the
declared sink for. Both degraded modes — no-git and the advisory `run.lock` — were absent entirely.

**The implementer's prose was spot-checked against source rather than believed**: the 503 envelope
constants (`admission.hpp:56-58`), `/conductor/health` registered outside admission (`router.hpp:7`),
`serve.py` exiting 130 on interrupt (`:672`), `MAX_ATTEMPTS = 3` (`fanout.ts:112`) and its verbatim
reason string (`:332`), the fail-closed prefix (`tools.ts:290`), the watchdog's `subsession.abort` at
`warn` (`fanout.ts:239-244`), `DEFAULT_STALE_LOCK_MS` at 24h (`state.ts:38`).

**The gate is NOT recorded PASS, and that is deliberate.** Fix round 1 closed the ten MAJORs and each
is now bound by a named test that fails without its fix. But stage 2 has not been re-run against
documents that went from 293 to 576 lines and from 80 to 174, the five MINORs have not been
re-adjudicated, and **a fix round's own author does not get to close the gate it answered.**

**The rule.** M7 says every row maps to a named test. A task whose named test file does not exist
should not be able to reach a gate, let alone pass one — and the check that would have caught it is
one line: does the file the spec names exist, and does each row id appear in exactly one test title?

---

## C-081 — 13.1's Step-2 glue, three years late: the 22 tools bound, and what binding them exposed

Task 13.1's own spec calls the plugin composition root its Step-2 production work — *"red → glue
fixes → green, this is the harness proving itself"* — and 13.1 landed without it (a recorded
deviation: "the plugin tool-map binding not done"). At HEAD `conductor/plugin/index.ts` built its
`tool` map from `CONDUCTOR_TOOL_NAMES` and gave all 22 names `execute: handlerNotBound(name)`, so not
one committed `handleX` was reachable through the plugin opencode actually loads, and a live session
could not advance a single stage. This closes it, under `docs/build/specs/task-13.1-composition-root.assertions.json`.

**The phase-13 gate's MAJOR 6 could not be fixed on its own.** It reads: the gate hook passes
`fileScope: []`, `testScope: []`, `verifyInFlightTree: null` as literals. The scopes are derived from
the calling session's registry entry, and only the fan-out engine writes an entry carrying an
`itemId` — and nothing in production constructed a fan-out (`grep -rn createFanout conductor
--include=*.ts | grep -v /tests/` returned one hit, the definition). So before the binding there was
no session to derive a scope *from*, and any test for the derivation would have been a source-text
check: the weak form that let it regress unobserved in the first place. MAJOR 6 is therefore CR-2 of
this task, not a separate fix.

**What the round cost, and where the findings came from.** Six agent rounds, ~1.43M tokens. Three
defects were found by tests, four by the orchestrator reading the diff and running mutations by hand:

| # | defect | found by |
|---|---|---|
| 1 | `conductor_queue_amend` cannot succeed: declared `ops: string[]`, handler needs `QueueAmendOp[]` | the sharpened `[C-047-shape]` guard |
| 2 | `conductor_setup` softened to RETURN refusals as data while 21 tools throw | orchestrator, reading a test's own failure message |
| 3 | `liveVerifyTrees` reports every marker FILE — a second, broader definition of "live" | orchestrator, reading the diff |
| 4 | the runless `conductor_status` return is a second shape no compiler sees | orchestrator, reading the diff |
| 5 | row 14 stayed GREEN with core's parser bypassed | orchestrator, running the mutation |
| 6 | the fix for #1 wrote §2.4 down a second time | the implementer, flagging its own work |

**#3 is the sharpest, and it is C-072/C-075's shape once more.** `runVerify` honours a marker only
when `pidAlive(marker.pid) && now() - marker.startMs <= staleMarkerMs`, and its own comment states
the guarantee: *"a recycled pid on an ancient marker (F6) is broken like a dead one, so a crashed run
can never wedge a tree."* The new enumeration checked neither. A crashed verify's leftover — which
`runVerify` would correctly break — would have reported its tree frozen forever, holding every
write-capable wave member and, once CR-2 lands, denying every edit to that tree. **The function was
named `liveVerifyTrees` and did not implement `live`.** The fix reuses `readMarker`, `pidAlive` and
the `DEFAULT_STALE_MARKER_MS` constant itself rather than restating the rule, takes the same
injectable bound and clock the verify path takes, and deletes nothing: breaking a marker stays
`runVerify`'s move under §4.3, so the enumeration is read-only.

**#5 is the tenth appearance of the recurring class, and only a mutation could see it.** Row 14 was a
good-looking test: it drove real ops through the real bound tool against a real store and asserted a
real amendment was applied. Replacing `parseAmendOps(asJson)` with a straight cast — exactly the
pre-fix binding — left the suite at **20 pass / 0 fail**. The reason is that the row only ever handed
the tool well-formed structure, which `QueueAmendInput.ops` accepts whether core's parser produced it
or a cast waved it through. What the parser uniquely supplies is *refusal*: the closed
add/update/remove vocabulary and a positioned message. The row now drives four malformed ops lists
and requires the thrown message to contain **core's own `why`**, obtained by calling `parseAmendOps`
on the same input — never typed into the test, never read back off the plugin under test (C-077).
Re-run by the orchestrator after the fix: the same mutation fails exactly row 14.

**#1's remedy was already in the tree, unused.** `core/queue-amend.ts:82 parseAmendOps(raw: readonly
string[])` turns the declared wire shape into the closed union and is unit-pinned at
`tools-9.4b.test.ts:2940`, in a test whose title calls it *"the binding Task 9.6 needs"*. Nothing had
ever called it. The orchestrator's first prescription — call the parser, do not redeclare the
argument — was **wrong**, and row 14's own test proved it: the row `safeParse`s the LIVE declared
schema and requires it to admit `[{op:"remove",id:"I2"}]`, which no binding behaviour can satisfy
while the declaration says `string[]`. The implementer did both and was right to: the declaration
tells the model the truth, and core still owns the narrowing at the seam — which matters because
in-process callers reach `execute` without zod ever running. The row was corrected to match.

**#6 is this build's most-repeated class, caught by the agent that created it.** Declaring the
structure meant writing a `queueEntry` zod shape that restates §2.4. Core's `validateQueue` remains
the only validator, so a drift is a legible refusal rather than corruption — but it now carries a
two-way guard derived at run time from `SCHEMAS.Queue`: every declared field must exist in core, and
every core field must be declared or named in an explicit `Record<string, string>` of field → reason
(both lists empty today), so a new core field forces a decision instead of vanishing. Proved
non-vacuous by renaming the declared `dependsOn` to `dependsUpon`, which turns it red.

**Deviations recorded, not hidden.**
- `conductor_status`'s runless return is typed `Omit<StatusResult, "runId"|"state"> & {runId: null;
  state: null}`. A field added to or retyped in `StatusResult` is now a compile error at that literal;
  a *rename* of `runId`/`state` surfaces on the `Omit` key list instead. Widening `StatusResult`
  itself was rejected deliberately: it would force every caller to handle a null `handleStatus` never
  returns — one lie traded for another.
- `conductor_setup`'s router/upstream origins come from the §12 session env `LLAMA_HARNESS_ROUTER_URL`
  / `LLAMA_HARNESS_URL` that `serve.py` exports, falling back to the §2.2 defaults. Nothing in
  `conductor/` read those before. No row pins this choice; it is unasserted surface.
- `conductor_override` refuses when the calling session carries no registry `itemId` rather than
  choosing one — fabricating it would spend the wrong item's §2.1 budget and taint the wrong item.
- The fail-closed half of `13.1-cr-packs-loaded-fail-closed` is unbound and recorded under the spec's
  `knownPartialCoverage`. The row text was deliberately NOT weakened to match what was testable:
  editing an acceptance row to fit the test that was written is the C-076 failure.

**Gate.** Full gate observed by the orchestrator: **1326/1326**, typecheck OK, bun 8, schema export
OK, python `Ran 68 tests`, GATE PASS. M5 PASS (129 files). M7: all 21 CR-1 rows carry exactly one
named test title. The `[5.4a-tools-still-throw-scope-fence]` negative row was REWRITTEN to assert the
positive, never deleted — its count-of-22 and every-name-is-registered halves survive verbatim,
because those were never about the throw.

**Still open: CR-2**, the four `13.1-cr2-*` rows — the gate snapshot's three literals, which are now
derivable because the registry finally holds sub-session entries.

---

## C-082 — CR-2: the gate snapshot derived, and a dead gate arm the adversarial process had already declared safe

CR-2 closes the phase-13 gate's **MAJOR 6**. `plugin/index.ts` passed `fileScope: []`, `testScope: []`,
`verifyInFlightTree: null` as literals to `gateBeforeToolCall`, sitting between `gitMode: config.git.mode`
and `inlineClaimScope`, both derived. The gate had measured the consequence: widening the scopes to
`["**"]` regressed nothing in the whole 1,280-test build, because `core/gates-edit.ts`'s implementer arm,
test-writer arm and entire freeze branch had no production caller that could reach them.

**Why this was not fixable before CR-1.** The scopes derive from the calling session's §3.5 registry
entry, and only the fan-out engine writes an entry carrying an `itemId` — and nothing in production
constructed a fan-out. There was no session to derive a scope *from*, so any test would have been a
source-text check: the weak form that let this regress unobserved. Binding the tools is what made a
behavioural test possible, which is why the binding went first.

**What is derived now.** `fileScope`/`testScope` come from the calling session's registry entry → its
`itemId` → that item's persisted queue entry, read through the handlers' own committed `readQueueJson`
(the runtime item file carries the FSM position and the worktree, *not* the scopes). `verifyInFlightTree`
comes from `liveVerifyTrees` (its own pid-alive + staleness rule, C-081) translated slug→path through the
committed `verifyInFlightTreeFor`, and returned **only when it equals the calling session's own tree** —
because `gates-edit.ts:196-198` is a tree comparison, not a global "something is verifying" flag. Every
failure mode derives NO scope, which denies: the literal's one accidental virtue, kept deliberately.

**The doctrine debt from C-081 is paid.** `LLAMA_HARNESS_DOCTRINE_DIR`, read at call time inside
`ensurePacks`, defaulting to the unchanged module-relative shipped directory, with the pack memo keyed by
the resolved directory so a broken override cannot be masked by an earlier successful load.

### The dead arm, and the refutation that protected it

Deriving the scopes exposed a defect underneath them. `core/gates-edit.ts:235` dispatched its test-writer
edit-scope arm on `"test-writer"`; the fan-out has always registered that session as `"testWriter"`
(`adapter/tools.ts:2991`) and persists that spelling into `askedBy.role`. **A real test-writer session
matched no arm at all** and fell to the unknown-role fail-safe. `"implementer"` matched on both sides,
which is exactly why only this one role stayed silently dead — the neighbouring arm worked, so nothing
looked broken. The arm enforcing "an implementer may not edit test files, a test-writer may not edit
source" has never once been reachable from production.

**This was found before, and the build wrote it down as safe.** `STATE.json` records, of Task 9.4a:

> *"One MAJOR (F1: the testWriter vs test-writer role vocabulary) was REFUTED by both skeptics — the
> string the diff uses is the one §3.3 and the pinned contract name — and is recorded in C-032 so it is
> not re-litigated."*

Found, escalated, refuted **unanimously**, and then recorded specifically so nobody would look again. It
was true the whole time. This is the first known FALSE NEGATIVE of the adjudication ladder, and the
damage was not the miss — it was the durable "do not re-litigate" note the miss produced.

**Why the refutation failed, precisely.** The plan uses both spellings, in different positions:
`test-writer` appears 17 times and **every one is English prose** ("nobody — not even a test-writer —
edits any file in a tree with a live verify"); `testWriter` appears 5 times and **every one is an
identifier** — plan:1185 `the test-writer sub-session (role `testWriter`, doctrine `tdd.md`)`, the §3.3
routing table at 1259-1260 whose fix-destination column is `testWriter`, and the role table at 1523. The
skeptics matched a string that occurs 17 times in prose and concluded the contract named it. The plan's
role *identifier* has always been `testWriter`.

**THE LESSON, and it generalises past this build:** *when checking whether code matches a spec's
identifier, count only IDENTIFIER positions. A hyphenated English form of the same concept in prose is
not the contract, and it will usually outnumber the identifier.* A refutation that rests on a string
count has not read the string's position.

**Fixed by renaming, not translating.** `core/gates-edit.ts:235` now says `"testWriter"` — one line of
production logic. The CR-2 implementer's own workaround, an `EDIT_GATE_ROLES = { testWriter:
"test-writer" }` table at the composition root, was **deleted**: it was a third site for one fact, and the
implementer flagged it as such rather than leaving it to be found. Ten role-value strings across four test
files were respelled; not one assertion, expected value or test title was touched, and the deny reason's
English prose ("a test-writer may edit only its item's testScope") was deliberately left as prose.

**The guard that makes it stick.** `[13.1-cr2-one-role-vocabulary]` derives THREE sets and compares them:
the roles `core/gates-edit.ts` dispatches on (parsed, including the list it tests with
`.includes(sessionRole)` — found through its USE, so renaming the list does not blind the guard), the
roles `adapter/tools.ts` registers (parsed), and the roles this run's own
`fanout/subsession.dispatched` journal records actually carried (observed). Every observed role must
appear in the parsed set *before* the main comparison runs, so the source parse is grounded in what
production really registered rather than trusted. A parse finding zero roles, or missing the known-good
`"implementer"`, or a `.includes(sessionRole)` whose declaration cannot be resolved, is RED — anti-vacuity
applied to the guard's own parser. The census it produced is the useful artifact: seven roles per side,
agreeing on six, diverging on exactly one.

**Retire C-032's F1 refutation.** It is wrong on the merits and it is load-bearing in the wrong direction:
future reviewers were told not to re-litigate. Anyone reading C-032 should read this entry instead.

**Recorded, not hidden.**
- `conductor-test-writer` in `conductor/opencode-fragment.json:24` is an OPENCODE AGENT ID in a different
  namespace, pinned by `fragment.test.ts:19` and `scripts/test_conductor_wiring.py:548`. NOT renamed —
  that would be a behaviour change to the merged opencode config, not a spelling fix.
- The guard observes only roles a run actually exercises (`implementer`, `testWriter` here). The five
  reader roles reach the gate through `READER_ROLES` rather than a dispatch arm and are covered by the
  parsed comparison, not the observed one.
- `readQueueJson` throws for a run with no `queue.json`; the gate swallows it and derives no scope, which
  denies. Fail-closed and correct, but it surfaces as a scope deny rather than a named "no queue" refusal
  at that seam. The stage tools still give the named refusal on their own path.

**Gate.** Full gate observed by the orchestrator: **1332/1332**, typecheck OK, bun 8, schema export OK,
python `Ran 68 tests`, GATE PASS. The mutation the row names — `gateScopesFor` returning `["**"]` — was run
and fails rows 22 and 23; the plugin was restored from a byte copy and the green re-observed after.

---

## C-083 — phase 13 fix round, part 1: three of five MAJORs, and two product defects the loops exposed

The phase-13 gate confirmed six MAJORs (C-079). One — the gate snapshot's literals — was MAJOR 6 and
closed as CR-2 (C-082). This entry covers MAJORs 1, 2 and 3. Each was fixed test-side and each is bound by
a mutation THE ORCHESTRATOR RAN ITSELF, because the agent writing the scripted model responses is also the
agent writing the assertions over them, and a scenario that agrees with itself proves nothing.

**MAJOR 1 — every full verify could have been vacuous.** `fixtureRepo()` created `tests/` EMPTY while the
scope command was `node --test tests/*.test.ts`, and node 26.7.0 exits 0 with `tests 0` on a zero match.
Scenario 4 writes no test at all, so its item reached VALIDATED on a verify that executed NOTHING and was
structurally incapable of going red. Row `13.1-fixture-suite-discriminates` demanded a controlSuite step
and had no test of its own — half of why it survived.

Fixed by seeding a committed baseline subject+test into the fixture's OWN seed commit, and by adding the
`tools-9.4b.test.ts:370` controlSuite idiom as a named test that runs before every scenario. Two design
points that were not in the brief and matter: the control asserts an **execution witness** (the baseline
test writes a file proving it RAN) rather than merely an exit code, which is the precise discriminator for
a vacuous green; and the baseline is COMMITTED, so scenario 3's out-of-repo worktrees check it out too —
seeded uncommitted, those verifies would have gone straight back to a zero-match glob. The witness writes
only under an env var the control sets, so no pipeline verify ever dirties a tree the `preexistingDirty`
assertions measure. **Mutation re-run by the orchestrator:** the glob -> `tests/*.nomatch.ts` now fails the
control; before the fix the whole suite stayed 5/5.

**MAJOR 2 — scenario 1's plan review exited at the CAP, and its own comment said otherwise.** `planRound`
was assigned only AFTER `handlePlanReview` returned, so it was 0 for the entire call: the reviewer re-raised
the same majors every round, the skeptic upheld every round, and each "revision" was the byte-identical
round-0 markdown. A gate skeptic measured `rounds: 3` with four `plan-review-cap` questions and five planner
prompts. The test asserted only `runState === "PLAN_REVIEWED"` (which the cap path also sets) and
`rounds >= 1`.

Fixed by making the plan-review script DOCUMENT-driven: each lens judges the `plan.md` text the handler
actually put in its prompt and stops raising its finding only when the demanded sentence is really there. A
driver that stopped rewriting `plan.md`, or re-reviewed stale text, now raises the same finding forever and
exits at the cap. Pinned with `rounds === 2`, `questionIds === []`, `blockedItemIds === []` and zero
persisted questions.

**A REAL ARITHMETIC TRAP, found by the agent and not by the brief.** The orchestrator's acceptance criterion
was "`planReviewMaxRounds` 3 -> 1 must go red". With only ONE revision before the clean round it does NOT:
at max=1 the first exit check asks `round(0) >= max(1)`, which is false, so the single revision still
happens and the following clean round exits with `rounds=1` and no cap questions — byte-identical to the
unmutated result. TWO revisions are required before the mutation binds. The orchestrator's own criterion
would have accepted a scenario that still could not detect a cap exit.

**A CONTRADICTION IN THE ACCEPTANCE ROW ITSELF.** `13.1-s1-plan-review-refute-revise-clean` requires both
"round 2 yields zero surviving majors" and "`run.planReviewRounds` is persisted as 2". The product cannot
satisfy both: `planReviewRounds` counts REVISIONS (tools.ts:2170, 2196), so a clean round straight after the
first revision persists 1. The explicit numeric assertion was taken as authoritative over the prose and the
divergence recorded rather than silently resolved. Every other clause of the row holds exactly.

**MAJOR 3 — no correction loop was ever entered.** `testVet()` was called with NO argument at all six
responder sites, so `mustFix` was `[]` in every vet round of every scenario; the file's only item-review
finding was scripted to be REFUTED; the string "adequacy" did not appear in the file at all. Four acceptance
rows claimed these loops end-to-end. Skeptics measured that deleting the finding, or setting every budget to
its minimum, left the suite at 5/5.

Fixed with four new named tests, one per row, each feeding the machine something it MUST refuse: a tautology
test the critics reject, a spec finding whose fix names only fileScope, a test-adequacy finding whose fix
names only testScope, and an unparseable test attempt. The §3.3 ordering is proved off the §2.6 ledger's own
sequence numbers rather than asserted in prose, and C-032 is pinned end-to-end at last —
`item.evidence.red.seq` is the POST-repair failure, never the pre-repair one.
**Mutation re-run by the orchestrator:** budgets-to-minimum now fails FOUR tests; before the fix it left the
suite 5/5 green.

### Two product defects the loops exposed on first contact

**(a) The e2e's doctrine map was keyed so no handler could read it.** `PACKS[name.slice(0, -3)]` stripped the
`.md`, while the shipped loader (`adapter/inject.ts:279`) keys by FULL FILENAME and both consumers read
`packs["debug.md"]` and `packs["receive-review.md"]`. The first run of the new tests died on the product's
own fail-closed refusal. **Every item-review fix dispatch and every DEBUG fix dispatch in this suite was
unreachable, and nothing noticed** — because until now no scenario ever reached a pack-gated dispatch. That
is MAJOR 3's claim in the form of a live defect. Checked and CONTAINED: no other fixture in the tree builds
a pack map by hand this way.

**(b) `acceptanceClusters` misreads two checks on one subject as two clusters.** `core/planning.ts:229-243`
takes the criterion's first whitespace token and strips only LEADING and TRAILING non-word runs, so
`pad("a")` -> `pad("a` and `pad("")` -> `pad`: same function, two "subjects". `validateQueue` then rejects the
item as spanning 2 clusters and quotes the nonsense cluster name `pad("a` back at the planner. Call phrasing
is exactly what §3.2's observable-check row asks for, so **the guard pushes a planner to jam two checks onto
one line to get past it** — degrading the plan quality the guard exists to protect. This is the same class as
the determiner bug the function's own comment (planning.ts:209-212) records already fixing once. Worked
around in the test with a single criterion, flagged in a comment there; the heuristic is UNTOUCHED and owed
a fix.

**Still unwalked, recorded so it is not mistaken for coverage:** no scenario in this file ever takes a red
validate, so GREEN->VALIDATED never enters DEBUG — `packs["debug.md"]` is never read, `item.attempts.
debugFixes` is never incremented, and `debugFixCap` can be set to 0 with the suite green. It needs a scenario
whose implementer ships a module that passes the item test and REGRESSES the full verify. The §3.3
reverted-behavior probe is likewise exercised by nothing: the item's fileScope file is still untracked at
review time, so `git stash push -- <fileScope>` matches nothing and the probe skips.

**Gate.** Full gate observed by the orchestrator: **1337/1337**, typecheck OK, bun 8, schema export OK,
python `Ran 68 tests`, GATE PASS. M5 PASS (130 files). e2e.test.ts is 10 tests, all green.

**MAJORs 4 and 5 remain open** — scenario 3 asserts the wave SCHEDULE rather than the driver's interleaving
(a strictly serial driver passes it), and scenario 5 omits the entire stop half the plan names, with one of
its two rows asserted INVERTED.

---

## C-084 — phase 13 fix round, part 2: MAJOR 5 closed, and a run shape that wedges forever with no detector

### First, two corrections to C-083 — both are the orchestrator's errors

**(a) C-083 claimed MAJORs 4 and 5 remained open. MAJOR 4 was already closed, in commit `c27b3b3`.**
The workflow covering MAJORs 4 and 5 was interrupted; the orchestrator inspected the tree, saw
`e2e.test.ts` at 10 tests — the same count the previous round left — concluded the interrupted round had
landed nothing, and committed under a message naming MAJORs 1-3. It had in fact landed MAJOR 4's
`watchInterleaving` fix into the EXISTING scenario-3 test, which adds assertions without adding a test.
Verified after the fact: `git show c27b3b3:conductor/tests/e2e.test.ts | grep -cE 'inFlightCount|
watchInterleaving'` returns 2, and 0 at the commit before it.

**The cause is the defect class this file has recorded nine times, committed by the orchestrator about its
own work: a check that PASSES while inspecting less than it appears to.** A test COUNT is a proxy for a
file's contents. The diff is the contents. The rule that already existed — *read the diff yourself* — was
not applied because a cheaper signal looked sufficient.

**(b) One of the four mutations the orchestrator specified was a NO-OP, and the agent said so rather than
reporting a pass.** M-4 was written as "make the run-state signature constant, so no re-prompt is ever
judged futile". Those two clauses are opposites. A CONSTANT signature is exactly what a wedged run already
produces: `movedSinceLastRePrompt` stays false, `futileRePrompts` still counts 1,2,3, and the `noop` stop
still fires — measured, 10/10 still green. The mutation's STATED EFFECT needs the opposite edit: append
`String(Math.random())` so no two signatures ever compare equal, every pass looks like progress, and the
futile counter is reset each time. That version fails, reporting `futileRePrompts` 0 where 2 was expected.
An acceptance criterion that cannot fail is worth exactly as much as the vacuous tests this build keeps
finding, and it was written by the orchestrator.

### MAJOR 5 — closed

`grep -cE 'idleRePrompts|futileRePrompts|disengage|handlePluginEvent'` went 0 -> 15. The scenario now
drives `session.idle` through the REAL plugin bus hook — nothing imports `handleSessionIdle` or
`handlePluginEvent` directly, because a scenario that called the engine would prove the engine works and
prove nothing about whether anything ever reaches it. It asserts the counters climbing 1,2,3 with the run
non-terminal throughout, then the FOURTH pass recording stop `{kind:"noop"}` with a §2.8 `disengage`
anomaly and the counters frozen, then a FIFTH pass — waited past the real §3.7.4 debounce so its silence is
a decision rather than a dropped call — producing no new prompt and no new journal record.

The stop-report is asserted on content: the `noop` headline, `Closing verify: none`, the blocked item with
its exact question id, the dependent's `PENDING`/unfinished disposition, and the newly-registered stale-red
path — while the sibling's never-written test file appears nowhere. **No closing verify is proved by
comparing `evidence.jsonl` BYTE FOR BYTE across the whole wedge path**, not by counting verify records,
which would be `0 === 0` and vacuous.

**Mutations re-run by the orchestrator:** the serial driver (`SERIAL_STAGES.includes(entry.tool)` ->
`true`) fails scenario 3 on the interleaving assertion; `FUTILE_RE_PROMPT_LIMIT` -> `MAX_SAFE_INTEGER`
fails scenario 5. Both restored byte-identical. Gutting the plugin's `event:` hook fails scenario 5 at
`idle pass 1 really re-prompted the orchestrator, 0 !== 1`.

### MAJOR (new, product) — the §3.7 wedge detector is blind to the exact shape SG-4 prescribes

**A blocked item with a dependent behind it wedges SILENTLY AND FOREVER.** Measured, not reasoned: built
with `B1 dependsOn: ["A1"]` exactly as the spec prescribes, the plugin's `session.idle` hook produced ZERO
re-prompts, so `futileRePrompts` never left 0 and the `noop` stop was unreachable.

Three committed rules, each individually right, compose into the hole:
1. `core/gates-phase.ts` `cannotEverPublish` deliberately does NOT count a BLOCKED dependency as
   permanently stuck ("a question can be answered and the item resumes"), so B1 is neither settled nor
   stuck, `allSettled` is false, and `conductor_report` correctly refuses.
2. The same function's `depsReady` excludes B1 from `nextWave` because A1 is not PUBLISHED, and excludes A1
   because it is blocked. So `wave.parallel` is empty and `recommended` is null.
3. `adapter/continuation.ts:743-750` — the SG-2 branch — sees `recommended === null`, journals
   `continuation`/`idle`, and returns WITHOUT prompting. Its stated reasoning is sound in isolation:
   "prompting a tool nobody offered would invent state; counting it as a futile RE-prompt would be a lie,
   because nothing was re-prompted."

**Result: no re-prompt, no `futileRePrompts`, no `noop`, no `disengage`, no stop-report, no archive. The
run sits in EXECUTING indefinitely.** This is precisely the wedge §3.7 exists to end, and it is the one
shape §3.7 cannot see. The only exits are a human answering the §2.11 question or dropping a halt file.
Verified independently by the orchestrator at `continuation.ts:744-750` and `gates-phase.ts:173`.

Note the spec's own scenario-5 row was written FOR this shape, so the acceptance row and the product
disagree about what is reachable — which is why the scenario as landed uses two items with the dependent
INDEPENDENT plus `parallel.maxImplementers: 1`, so the wave carries the blocking item alone and the
sibling is genuinely unstarted. That deviation is recorded, not concealed: it satisfies "report refuses
while an unsettled item remains" but NOT the specific blocked-dependency reasoning the row cites. **The row
cannot be satisfied as written until the product defect is fixed.**

### MAJOR (new, product) — the `event:` hook forwards `input.client` unvalidated

`plugin/index.ts` passes `input.client as unknown as ContinuationClient` with no shape check. With a client
that cannot be prompted — `{}`, which is what this suite's own `pluginInput` passed until this round, and a
plausible degraded or restricted real client — `session.prompt(...)` throws synchronously inside
`handleSessionIdle`. The engine then deliberately charges nothing: `sent = false`, both counters untouched,
`lastRePromptMs` not advanced. That decision is individually correct and well argued in the source ("an
accusation against a session that was never asked once") — **but it has no floor.** There is no counter for
consecutive transport failures, no §2.8 anomaly, and no stop kind for "the orchestrator has been unreachable
for N passes". A permanently dead transport makes the run un-endable and the wedge detector permanently
inert, with the only trace an `error`-level journal line per idle event.

### Recorded, not hidden

- `handleReport`'s STOP-REPORT mode calls `registerStaleRed`, so the §2.11 registration that unpoisons the
  repo now happens on the wedge path too. Measured: the blocked item's test file registered, the sibling's
  NOT (below GREEN but never written, so the existence filter drops it). Scenario 5 previously reached the
  registry through the `done` path only; the stop path's registration had no coverage.
- `plugin/index.ts` `stateCoordinates` reads `XDG_STATE_HOME`/`homedir()` at event time with no injection
  seam, so a stop-report driven through the bus hook resolves `stateHome` against the developer's real home.
  Nothing landed there — the stop-report branch uses no verify and no quarantine — but the coupling is real,
  so the scenario pins `XDG_STATE_HOME` to its scratch dir in a try/finally rather than trusting that branch
  to stay verify-free.

**Gate.** Full gate observed by the orchestrator: **1337/1337**, typecheck OK, bun 8, schema export OK,
python `Ran 68 tests`, GATE PASS. M5 PASS (130 files). All four mutated source files restored byte-identical.

**All five phase-13 e2e MAJORs are now closed.** What remains for phase 13 is the M7 traceability half — 42
assertion rows still named by far fewer test titles — plus the two product defects above, the
`acceptanceClusters` defect from C-083, and the still-unwalked DEBUG loop.

---

## C-085 — §3.7's only wedge detector, restored: the re-prompt condition and the transport floor

Two MAJORs found while closing the phase-13 e2e gate (C-084), both fixed. Each made the counter the plan
calls **"the ONLY wedge detector"** permanently inert on a path that had never run end to end, so a run
could sit in EXECUTING forever with no human-readable artifact — the exact outcome §2.9:911-915 says the
design exists to close.

**The plan decided this, not the orchestrator.** §3.7.1 gates re-prompting on ACTIONABLE WORK — "items not
PUBLISHED/blocked, or a legal next run transition" — not on a recommended stage tool. In the wedge (A
blocked, B `dependsOn:[A]`) B is neither PUBLISHED nor blocked, so the plan says re-prompt. The code gated
on `gate.recommended === null` and said nothing. Three individually-correct rules composed into the hole:
`cannotEverPublish` deliberately does not treat a blocked dependency as stuck (so report CORRECTLY
refuses); `depsReady` excludes both items from the wave (so nothing is recommended); and
`continuation.ts:743-750` returned before prompting. Nothing in core needed new logic — `stops.ts:113`
already returns `noop` at `futileRePrompts >= 3` and `handleReport` already has stop-report mode. **The
counter simply never incremented.**

**The SG-2 branch was preserved, not deleted.** Its reasoning is right for the case it was written for, and
row `fw-silent-when-truly-nothing-actionable` asserts the engine is STILL silent, and still charges no
futile count, when nothing is actionable. A fix that re-prompted unconditionally would have satisfied six
of the eight rows and been wrong.

**THE CONDITION IS NARROWER THAN §3.7.1's PROSE, AND THE REASON IS A GREEN TEST.**
`[10.1-idle-null-recommendation]` pins SILENCE on the fixture "I1 BLOCKED, I2 dependsOn I1" — the same
SHAPE as the wedge. The implementer measured both verdicts and found them identical in every field,
including a byte-identical `why`. The only difference is that the wedge's block minted an OPEN §2.11
question, so the gate legalizes `conductor_answer`. So the bare "items not PUBLISHED/blocked" reading
cannot be the whole rule without turning 10.1 red, and the landed condition is: an unfinished item AND a
legal tool outside the always-legal §3.2 meta baseline.

**Residual hole, and why it is acceptable — VERIFIED BY THE ORCHESTRATOR, not assumed.** A blocked item
carrying NO question, plus a dependent, would still go quiet. The implementer believed that state
unreachable; the orchestrator checked all ELEVEN production `setBlocked` call sites: ten in `tools.ts` are
question-paired, and the eleventh (`continuation.ts:442`, `reconcileOrphanQuestions`) exists precisely to
complete a half-applied block for an ALREADY-OPEN question. So no production path blocks an item without a
question, and the fix closes the shape §2.9 actually describes. Recorded because `[10.1-idle-null-
recommendation]` now pins behaviour for a state production cannot produce — worth knowing before anyone
"fixes" it.

**The transport floor.** A client whose `session.prompt` throws — which the plugin's unchecked
`input.client` cast forwards happily — left `sent = false` and charged nothing. That per-pass decision is
correct and was preserved (FW-SG-3: a session never successfully asked cannot be accused of failing to
progress). What was missing was a floor ACROSS passes. `ContinuationState` now carries
`consecutiveSendFailures`; at the limit the engine appends a §2.8 `disengage` anomaly naming the transport
failure, records stop `{kind:"env"}` — the only kind in the CLOSED §2.9 vocabulary whose definition covers
tooling broken; `noop` would have misreported a run whose orchestrator was never reachable — and drives the
one report writer in stop-report mode with no closing verify. Any send that leaves the process resets the
count, so four failures, a success, and four more never reach the floor.

**The floor value was bounded by a test, not chosen.** `[10.1-one-reprompt-in-flight]` drives FOUR
consecutive synchronous failures and asserts no stop and no anomaly, so the floor must be >= 5. It is 5.

**Mutations re-run by the orchestrator:** restoring the old `recommended === null` early return re-fails
exactly three continuation rows; the file was restored byte-identical and the green re-observed.

**Recorded, not hidden.** `UNIVERSAL_META_TOOLS` in `continuation.ts` restates four names
`core/gates-phase.ts` owns. The implementer tried to derive them and could not — `legalTools` over the same
run with an empty item list returns that same set, so no counterfactual separates "universal" from
"position-specific". If gates-phase adds a fifth always-legal meta tool this list must follow by hand. That
is the "two spellings of one fact" class this build keeps hitting, flagged rather than hidden, and it is
owed a drift guard.

**Gate.** Full gate observed by the orchestrator: **1345/1345**, typecheck OK, bun 8, schema export OK,
python `Ran 68 tests`, GATE PASS. One source file changed: `conductor/adapter/continuation.ts`.

**Consequence for phase 13.** Acceptance row `13.1-s5-report-refuses-dependent-unsettled` was written FOR
the blocked-dependency shape and the product could not reach it, which is why C-084 recorded the e2e's
deviation to an independent sibling. That shape is now reachable and the deviation can be reverted.

---

## C-086 — two derivations made faithful to the facts they claimed to track

**(a) `acceptanceClusters` read call syntax as a second subject.** `core/planning.ts` stripped only LEADING
and TRAILING non-identifier runs from a criterion's first token, so internal call syntax survived:
`pad("a")` -> `pad("a` (the trailing `")` went, the internal `("` stayed) while `pad("")` -> `pad` (the
whole `("")` was trailing). Same function, two "subjects". `validateQueue` then rejected a legitimate item
and quoted the nonsense cluster name `pad("a` back at the planner. Since §3.2's observable-check row asks
for exactly that phrasing, the guard pushed planners to jam two checks onto one line — degrading the plan
quality it exists to protect. Found while walking phase 13's correction loops (C-083), where the e2e had to
adopt that very workaround.

The rule is now two ordered steps: the existing strip-and-casefold, then the existing determiner skip, then
take the token's LEADING identifier run and stop at the first character that cannot appear inside one
(`[\w./-]` is in; parentheses and quotes are not). So `pad("a")`, `pad("")` and `pad` all reduce to `pad`,
while `config.load(cfg)` reduces to `config.load` and stays DISTINCT from `config`.

**The step ORDER is load-bearing and is now documented in the function.** The determiner test is a
whole-word set lookup, so it must see the end-stripped token — `"the,"` is not `"the"`. Extracting the
identifier run FIRST would let a trailing comma smuggle an article through as a subject and revive the
"spans 2 clusters (parser, the)" defect the function's own comment records already fixing once. This is the
second fix to this scan; the first was for determiners and the same reordering would undo it.

**Four rows, and three of them exist to stop a wrong fix rather than to prove the right one.** The
near-miss row (`config.load` vs `config`) turned out to be RED at HEAD as well, not merely a regression
guard, and it asserts the subject NAMES rather than the count — the count alone is green at HEAD. It
catches collapsing everything to one subject, stopping at the first dot, and stopping the identifier run in
the wrong place. A separate row parses the cluster names out of the violation the planner actually receives
and requires balanced brackets and even quote counts, so a fix that got the counts right while still
emitting source fragments stays red.

**(b) `UNIVERSAL_META_TOOLS` was a second spelling of a fact `gates-phase` owns.** C-085's implementer
added a hand-written four-name list and flagged the drift itself rather than hiding it. It is now EXPORTED
and DERIVED at module load by probing the owner: `legalTools` over a synthetic non-terminal run with an
EMPTY item list and no open question — the probe that implementer identified — returns exactly the
always-legal meta tools.

**The derivation had to satisfy an existing guard, and the way it did is worth recording.**
`tests/legaltools-callsites.test.ts` (C-048) scans production source and fails any `legalTools(` call that
passes fewer than five arguments or hardcodes the fifth (`publishEnabled`) as a bare `true`/`false` — the
default is `true`, so a call inheriting it silently claims publish is available in runs where it is not.
The new probe has no honest value to pass: `publishEnabled` reaches only per-item stage tools and the probe
carries no items. Rather than pass a literal (forbidden) or a named constant spelling a literal
differently (which would pass the regex while defeating the guard's purpose), it asks the gate under BOTH
modes and keeps the intersection. That is substantively what "the flag is irrelevant here" means: it
asserts no value, inherits no default, and proves independence rather than claiming it.

**Mutation run by the orchestrator:** dropping one tool from the derived set fails the new row AND
`[10.1-idle-null-recommendation]` — two independent detectors, because the engine then misreads a universal
tool as position-specific and re-prompts where it must stay silent. File restored byte-identical.

**Gate.** Full gate observed by the orchestrator: **1350/1350**, typecheck OK, bun 8, schema export OK,
python `Ran 68 tests`, GATE PASS. Two source files changed: `core/planning.ts`, `adapter/continuation.ts`.

**Consequence:** the phase-13 e2e's one-line two-check workaround (flagged in a comment there) is now
revertible.

---

## C-087 — phase 12, the python half: main() was executed by nothing, and three defects lived in its ordering

Three of phase 12's six confirmed MAJORs, all downstream of one structural fact the gate's adjudicator
named: **no test in either leg executed `scripts/serve.py`'s `main()`.** The seams below it were well
tested and the call sites above them pinned only by source-text greps, so every defect that lives in
main()'s ORDERING was invisible. The adjudicator predicted one such test would close three findings at
once; it did.

**MAJOR 3 — `--print-env` reported a session it had just displaced.** The socket-binding, sometimes-
interactive port resolution ran BEFORE the `--print-env` early return, and `info()` is a bare `print()` to
stdout. Reproduced through main() by the new harness: with the session on port 61806, `--print-env`
reported **61808** — a port it took for itself, that nothing listens on — preceded by four prose lines on
the stdout its own help reserves for `eval`, with `LLAMA_HARNESS_ROUTER=0`. So
`eval "$(scripts/serve.py --print-env)"` died with `port: command not found` and then exported a dead URL;
on a tty the same path reached `prompt("Port to use instead")` and blocked invisibly inside the caller's
command substitution.

Fixed by splitting main() at the `--print-env` return rather than patching symptoms: above the split only
what both modes SHARE (host, wanted ports read from the saved session, the socket-free router preflight);
below it everything that TAKES something (resolve_port, which binds and prompts; resolve_router_port;
save_session). The normal path's ordering and output are byte-identical. `reported_port()` returns the
configured port and separately asks `port_is_listening()` — a connect(), not a bind() — because the row
opens a real connection to the reported port, so a bare early return reporting configured-but-unverified
numbers would not have passed.

**MAJOR 4 — the orphan window.** Between `wait_until_ready` succeeding and `start_watchdog` there was no
try/finally, and Task 12.1 had inserted three raise sites into it. Measured twice: the llama-server child
still alive a second after main() returned, holding a 20+GB model and its port; the next run then shifts
port and leaks a second one. The asymmetry was the tell — the supervisor reaps llama-router, while the
process 12.1 did not supervise was left behind.

Fixed with one guard on the WINDOW, not on the raise sites, because the window IS the ownership gap: no
bash trap yet, no watchdog yet. `start_watchdog` is the LAST statement inside the try and `os.execv` is
outside it — that placement is the handover point, and it is what makes the success path leave the child
running. `except BaseException` is deliberate: leg (a) raises SystemExit, which is not an Exception, and a
Ctrl-C in that window should reap the model too.

**MAJOR 2 — the supervisor's restart policy was a second copy that had already drifted.**
`ROUTER_SUPERVISOR_SOURCE` carried its own inline `delay_ms` and `if code == 0 or code in FATAL:`, while
`router_restart_decision`, `backoff_next` and `restart_delay_ms` had ZERO callers outside their definitions
and the test file. The drift was measurable, not hypothetical: the new test edits `restart_delay_ms()` to
return 2500ms and measured the shipped supervisor waiting **0.87s**.

Fixed by having the generated supervisor LOAD the policy module by absolute path (it runs in a fresh
interpreter with no sys.path entry reaching `scripts/`, so it cannot import by name) and call it. The
inline `delay_ms`, the BASE/FACTOR/CAP constants, the FATAL tuple and the branch are deleted. A bonus the
row forced: the give-up line now carries `verdict.message`, so the sentence telling the operator the router
could not parse its config reaches `router.log` instead of just an exit number.

**Mutations re-run by the orchestrator, both previously green:** `restart_delay_ms` -> `return 0` now fails
two tests including the EXECUTED supervisor row; neutering `reap_server` fails both orphan rows. Files
restored byte-identical, and `ps` confirmed no stray stub children on the machine before or after — these
tests deliberately create children to prove the defect, so that check is part of the verification.

**Recorded, not hidden — a behaviour change no row pinned.** The implementer also routed `--print-env`
around `choose_model`, which violates BOTH stated `--print-env` properties through a different door (it
writes its list with `info()` to stdout and blocks on "Select a model by number"). Leaving it would have
made the fix true only for the arguments the tests happen to pass. **Cost: `--print-env` with no model in
argv and none in the saved session now exits non-zero with a stderr error instead of opening a picker.**
That is correct for a reporting flag and it is untested — owed a row, tracked in the spec.

**Also seen and deliberately not fixed:** `log_handle = open(log_path, "w")` at serve.py:680 is never
closed on the failure path (it surfaces as a ResourceWarning in the orphan tests). It is an fd in a process
that is exiting, it predates this task, and no row touches it.

**Gate.** Full gate observed by the orchestrator: **1350/1350** node, typecheck OK, bun 8, schema export
OK, **python leg `Ran 76 tests` OK**, GATE PASS. Two source files changed: `scripts/serve.py`,
`scripts/conductor_wiring.py`.

**Phase 12 stays FAIL** until MAJORs 1 (G5 equivalence), 5 (setup's slot fan-out remedy) and 6
(setupRequiredScopes coverage) are closed.

---

## C-088 — phase 12's setup half: two ways a successful setup left the repo unusable

Phase 12's last two confirmed MAJORs, both in `conductor_setup`, both reproduced by running against the
real `handleSetup`. Their common shape: **setup reports success and the repo cannot work afterwards.**

**MAJOR 5 — a router outage mid-fan-out was misreported as a slot shortage.** `setupProofRequest`'s guard
`if (result !== null || input.failoverState.useUpstream) return result;` made every concurrent request that
RESUMED AFTER the first failover return null instead of retrying the upstream. Measured: six slot probes
issued together, all six fail at the router, the first to resume latches `useUpstream` and succeeds
upstream, **the other five return null without ever touching the healthy upstream**. Setup then reported
`ok:false` with "of 6 concurrent readers the served origin held only 1 open ... restart llama-server with
--parallel 6" — wrong in every particular, since llama-server was healthy with six slots — and the operator
was left unconfigured. The exact shape of the §12.1 supervisor's restart window.

**The fix is a narrowing, not the deletion the finding suggested, and the difference matters.** The guard
conflated two questions. "Has the router already been recorded as failed?" decides whether to note a SECOND
failover — it must not, since the router failed once, not once per reader, and a second note flips
`probingDisabled`. "Where does this request go now?" is already answered by `resolveBaseUrl`, which after
the latch names the upstream. Deleting the whole condition answers the first wrong (six failovers, six
re-probes of the dead origin — the herd the latch exists to prevent); keeping it as a `return` answers the
second wrong (five readers dropped). So only the failover BOOKKEEPING is now gated on `!useUpstream`, and
`second === first` still stops a request that started on the upstream from probing it twice.

**A test written specifically to catch the naive fix did its job.** `p12b-failover-latch-still-prevents-a-
herd` counts what the DEAD origin received: HEAD measured 6 refusals for 6 readers, and the row requires at
most one probe per reader plus `useUpstream` still SET at the end. The adjudicator's suggested deletion
would have made the headline row green and this one red.

**MAJOR 6a — zero ecosystems wrote empty coverage.** On a repo holding only `README.md` and a `Makefile`,
setup returned `ok:true, written:true, failures:[]` with `verify.requiredScopes []`, which validates
cleanly because core declares no `minItems`. `repoConfigured` then flipped true, gates-phase opened every
gate, and every item afterwards threw at `tools.ts:2716` — while setup was now illegal to re-run without
`reconfigure:true`. A wedged repo produced by a success.

Fixed by refusing BEFORE the §2.1 proofs (so an uncharacterisable repo is refused without opening a
socket), with a message naming the five markers detection keys on and stating that nothing was written so
setup is legal to run again. **The "write coverage the operator completes" arm the spec left open was
rejected on evidence:** that arm's own committed test requires every scope a `requiredScopes` entry names
to exist in `verify.scopes`, so setup would have had to invent a verify COMMAND for a repo it had just said
it could not characterise. Refusal is the only arm that does not contradict itself.

**MAJOR 6b — multi-ecosystem coverage had a hole the single-ecosystem branch does not.** Each entry's
pattern was that ecosystem's extension glob, so `globMatch` was false for `README.md`, `docs/guide.md`,
`CMakeLists.txt`, `package.json` and `scripts/build.sh` against BOTH emitted patterns. The single branch
writes `**` and has no hole. Downstream, a docs-only item — first-class per e2e scenario 4 — threw at
`tools.ts:2716` and `conductor_report` threw at 7542.

**THE LOAD-BEARING CONSTRAINT, AND AN HONEST LIMIT IT FORCES.** The spec offered a trailing `**` catch-all
entry as a free choice. It is not available: the already-green, frozen row `[12.2-detect-multi-ecosystem]`
asserts `required.length === 2`, `entry.pattern === scope.sourceGlob`, and an EXACT coverage map (src/a.js
-> exactly ["node"], src/main.cpp -> exactly ["cmake"]). A third entry breaks the count; a `**` pattern on
either breaks the map. And **`globMatch` has no negation, so a finite set of positive extension globs can
never cover the set of ALL possible paths** — only a `**`-equivalent can, which the frozen map forbids.

So universal coverage was mathematically unavailable under the existing contract; coverage of the repo's
ACTUAL paths was. The fix walks the repo, collects every path no ecosystem's `sourceGlob` matches,
generalises each to its KIND (`**/*.<ext>`, or `**/<name>` when there is no extension) and folds that list
into every scope's own glob as a brace alternation. **RESIDUAL LIMIT, recorded rather than papered over: a
file whose extension did not exist in the repo at setup time is not covered.** Re-running setup with
`reconfigure:true` re-derives it. Whether the frozen row should be relaxed to permit a true catch-all is a
question for the phase-12 gate re-run, not for this fix.

**A second recorded cost:** unowned paths owe EVERY detected scope rather than one arbitrarily chosen one —
the honest generalisation of the single branch, where `**` already makes every path owe the only scope.
Consequence: in a multi-ecosystem repo a docs-only item's CLOSING verify runs both suites, though its
targeted item test still routes to one, because the per-ecosystem entries are declared in detection order
and `itemVerifyScope` picks the first candidate carrying an `itemTest`.

**Mutation re-run by the orchestrator:** restoring the conflated guard re-fails exactly the three failover
rows; file restored byte-identical. `ps` confirmed no stray stub origins before or after.

**Gate.** Full gate observed by the orchestrator: **1356/1356** node, typecheck OK, bun 8, schema export
OK, python `Ran 77 tests` OK, GATE PASS. One source file changed: `conductor/adapter/tools.ts`.

**Phase 12 now has ONE confirmed MAJOR left: MAJOR 1, the G5 router-equivalence run.**

---

## C-089 — G5: an equivalence proof that was two identical commands

Phase 12's last confirmed MAJOR. Plan:2884-2888 mandates running Task 13.1's scripted e2e twice — once
with the router in the loop, once without — and asserting the same terminal state, the same item
dispositions and the same commit set, explicitly so that "the identical process runs without the router" is
true rather than aspirational.

**What shipped was a tautology on two counts.** The recorded artifact's arms were
`CONDUCTOR_OPENAI_BASE_URL=...:8088/v1 node --test e2e.test.ts` and the same command with `:8080/v1`, and
`grep -rn CONDUCTOR_OPENAI_BASE_URL conductor/ scripts/` returns ZERO hits — the variable is read by
nothing. **And the orchestrator found a second layer the gate had not:**
`grep -rn 'fetchMetricsSummary|router' conductor/tests/e2e.test.ts` returned NOTHING. The e2e had no router
touchpoint at all — `reportArgs` passed no `metrics` field and `handleReport` short-circuits on `undefined`
— so even a correctly-wired variable would have changed nothing. The named driver
`conductor/tests/e2e-g5.test.ts` did not exist.

**A constraint shaped the fix.** `conductor/tests/router-client.test.ts:5` promises "the unit tests need
neither the C++ llama-router nor a model", and a fresh detached worktree has no submodules and no built
router. A test that SPAWNS the router must therefore not join the node suite's default run, or every
fresh-checkout verification starts requiring a C++ build. So the WITHOUT arm is an ordinary node test and
the WITH arm lives in a separate driver that produces the artifact — which is how "run it twice and assert"
reads anyway.

**The seam.** `reportArgs` now passes a real `metrics` function calling the UNSTUBBED `fetchMetricsSummary`
over a real socket, defaulting to port 1 — a port an unprivileged process cannot bind, so the connection is
refused instantly. Every crossing is recorded and the scenarios assert the count moved, so "the seam ran"
is an OBSERVED CALL rather than a report line that renders identically when the field is absent. This also
finally meets row `13.1-router-absent-fail-soft` and closes the phase-13 MINOR that named the same hole
from the other side.

**The proof the router was in the loop, which is the row that mattered.** The driver spawns the real
binary, seeds it with a RANDOM 3-7 proxy requests that come back 502 from the router itself (the upstream
is deliberately dead), and reads its ledger. Measured: the router served `{"502":6},"totalRequests":6`
before the arm and `{"502":7},"totalRequests":7` after — **the e2e's own metrics request, on the router's
own ledger.** The driver then kills the router, PROVES the port is dead, and runs the second arm. A router
that started and was never contacted would be the same tautology in a new costume, and the driver fails if
the summary reaching the report is not the one the router served.

**The three compared facts, measured, per scenario:** terminal state (runState/stopKind read back from the
persisted run), item dispositions (queue ids x persisted state/blocked/deferred), and commit set (sorted
unique `git log --name-only base..HEAD` plus `rev-list --count`). All IDENTICAL across arms. The metrics
section legitimately differs and is excluded from the comparison per G5-SG-2 — that difference is the
entire point of having two arms.

**The tautology cannot recur.** `conductor/tools/g5-artifact-check.ts` rejects an artifact whose arms are
byte-identical, whose only differing env names are read by no file under `conductor/{core,adapter,plugin,
tools,tests}` or `scripts/`, whose WITH arm carries no summary, whose WITH summary is not the one the
router served, or whose WITHOUT arm carries a summary at all. It runs in the driver AND in the node suite
against the SHIPPED artifact. Its negative cases feed it the old defect verbatim. A nice touch: the dead
variable's name is assembled from two fragments in both scanned files, so mentioning it in the checker does
not make "no source reads it" false.

**Mutation re-run by the orchestrator:** the shipped artifact was reverted to the two-identical-commands
shape and the node guard failed with "the shipped equivalence record passes its own anti-tautology check";
restored byte-identical. (First attempt was invalid — the orchestrator ran the checker module directly, but
it exports a function with no CLI entry, so it exited 0 doing nothing. Recorded because "the check passed"
would have been the wrong conclusion from a command that never ran the check.)

**Gate.** Full gate observed by the orchestrator: **1363/1363** node, typecheck OK, bun 8, schema export
OK, python `Ran 77 tests` OK, GATE PASS. `ps` confirmed the router process is dead and no strays remain.

**ALL SIX of phase 12's confirmed MAJORs are now closed** (C-087, C-088, C-089). The phase-12 gate can be
re-run; its stage-2 verdict of FAIL stands until it is.

---

## C-090 — C-062's three survivors, pinned: guards whose only value is that they can fail

Three gaps recorded as C-062 survivors, all UNTESTED behaviour rather than broken behaviour. That makes the
mutation proof the deliverable and the green almost irrelevant — a test that passes over working code
proves nothing unless it also fails when the code stops working. All three were verified still live by the
orchestrator immediately before the round.

**(1) `wait_for_router_health` was reached by no test.** Its only callers were production
(`conductor_wiring.py:575`, `:850`); a `return True` stub survived the whole suite. The specific danger it
exists to avoid is the `curl -s 503` trap: a router answering with an ERROR STATUS is not healthy, but a
probe that only asks "did the request complete" says it is. Now pinned in both directions against a real
listener — 200 healthy, 503 not.

The proof needed a second step and the agent took it rather than declaring victory: under the stub the test
dies at its FIRST assertion (the stub never asks the listener anything), which does not by itself show the
503 direction is load-bearing. So it drove the mutated function against a real 503 listener and measured
`wait_for_router_health(503 listener) -> True`, confirming the status-line half would fail too.

**(2) `ROUTER_TERM_GRACE_S` had a floor and no ceiling.** Asserted only `>= 5.0`, so `3600.0` passed — an
operator ending a session would wait an hour for the router to go away.

**The ceiling chosen is 30.0, and the reasoning is what makes it non-arbitrary:** it is exactly
`ROUTER_READY_TIMEOUT_S`, and the test asserts `ceiling <= cw.ROUTER_READY_TIMEOUT_S` so the two move
together. **A router given LONGER to die than it was given to be born is inverted** — that is the
invariant, and 30.0 is where it currently sits. External precedent agrees (launchd allows 20s between
SIGTERM and SIGKILL). The test also checks the number BAKED INTO `ROUTER_SUPERVISOR_SOURCE`, so the ceiling
holds on the literal the detached supervisor actually waits on, not only on a module constant that
supervisor never imports — the same single-source lesson C-087 fixed one layer down.

**(3) `derive_slots`' bool guard was unpinned.** The function rejects `bool` before `int` because
`isinstance(True, int)` is True in python — without it, `derive_slots(True)` silently returns 1 slot and
`derive_slots(False)` floors to 1, turning a config TYPE ERROR into a plausible-looking slot count that
propagates into `--parallel 1`. No test passed a bool. Now both are pinned, and the mutant was measured
producing `derive_slots(True) -> 1` and `parallel_server_args(True) -> ['--parallel', '1']`.

**Mutation re-run by the orchestrator:** deleting `isinstance(max_readers, bool) or` from the guard fails
the new class; file restored byte-identical. All three mutations were run by the agent with `cp` snapshots
and `cmp` restores, and production is byte-identical — only `scripts/test_conductor_wiring.py` changed.

**Gate.** Full gate observed by the orchestrator: **1363/1363** node, typecheck OK, bun 8, schema export
OK, **python `Ran 80 tests`** OK (77 -> 80), GATE PASS.

---

## C-091 — the DEBUG loop, walked at last

The one correction loop that survived every previous round, including the one that closed the vet, review
and repair loops (C-083). No scenario in `conductor/tests/e2e.test.ts` ever took a RED VALIDATE, so
GREEN->VALIDATED never entered the DEBUG branch: `packs["debug.md"]` was never read,
`item.attempts.debugFixes` was never incremented, and **`debugFixCap` could be set to 0 with the whole
1,363-test build green.**

**The shape that reaches it, and why it had never occurred.** The DEBUG loop exists for a change that
satisfies its OWN test and breaks something else. Every prior scenario's implementer either succeeded or
failed on the item's own test, so the loop had no entrance. The new scenario ships

    export function baseline(s) { return "baseline:" + s; }

which satisfies the item's acceptance line (`baseline("x") === "baseline:x"`) exactly and silently drops
the no-argument contract. The ITEM test runs only `tests/suffix.test.ts` -> green -> GREEN. The FULL verify
runs `tests/*.test.ts` -> RED on `tests/baseline.test.ts`, **a file no queue item owns**, so §4.2
quarantines nothing and no repair budget above validate can see it.

**A fix from three rounds earlier paid for this one.** The committed baseline test seeded in C-083 to close
MAJOR 1's zero-match glob is exactly the lever: an item whose fileScope IS `src/baseline.ts` produces a
green item test over a red full verify with no new machinery.

**The discriminator is the doctrine, not a counter.** The scripted responder gates on
`ctx.text.includes(PACKS["debug.md"])` — the real pack read off disk. A fix dispatch arriving WITHOUT the
doctrine is indistinguishable from the first implementation to that responder: it writes the same
regressing module again, the re-verify stays red, and the item ends blocked at the cap instead of
PUBLISHED.

**The agent sharpened the orchestrator's mutation, and the sharpening is the point.** M-2 as specified
(break the `packs["debug.md"]` key) turns the scenario red — but only because the product's own guard
refuses to dispatch a debug fix without its doctrine. **That proves the guard fires, not that the doctrine
reaches the sub-session.** So it added M-2b: `packs["debug"] ?? "some text that is not the doctrine"`,
which satisfies the guard and lets the dispatch happen with a doctrine-free prompt. Still red. The scenario
is therefore sensitive to the doctrine ARRIVING, not merely to the throw — which is the property the row
claims and the orchestrator's own mutation would not have established.

**What it asserts, off the persisted ledger rather than in prose:** exactly one `green` item-test record
whose command names `tests/suffix.test.ts` and NOT the baseline; `verify[0].green === false` with a
non-zero exit and `excluded: []`; `green.seq < verify[0].seq`, so the item really was at GREEN when the red
verify arrived; exactly TWO implementer dispatches, the FIRST carrying no doctrine (so "carries debug.md"
is not a property of every prompt) and the SECOND dispatched at `itemState === "GREEN"` — i.e. from
`conductor_validate`, not from an earlier stage — matching `/Fix attempt 1 of workflow\.debugFixCap=2/` and
`/scope unit exited [1-9]/`, the verify's OWN captured failure; `attempts.debugFixes === 1`;
`debugging === null` (posture cleared); one journal `guard-reject` whose `evidenceSeq` names the red verify
it was derived from; and finally `controlSuite(root)` over the PUBLISHED tree exiting 0 with the baseline
named — the regression really gone, rather than the pipeline having stopped looking.

**Mutation re-run by the orchestrator:** `debugFixCap` -> 0 turns the scenario red (it stops at
`conductor_validate` in state GREEN); file restored byte-identical. `conductor/adapter/tools.ts` was
mutated by the agent and restored with a matching sha256.

**Gate.** Full gate observed by the orchestrator: **1364/1364** node, typecheck OK, bun 8, schema export
OK, python `Ran 80 tests` OK, GATE PASS.

**Still not exercised, and honestly out of reach here:** the §3.3 reverted-behavior probe. At review time
the item's fileScope file is still untracked, so `git stash push -- <fileScope>` matches nothing and the
probe SKIPS. That is the documented "where cheap" behaviour rather than a defect, and reaching it would
have meant bending this scenario around it.

---

## C-092 — M7 for phase 13, scenario 1: the restructure was not bookkeeping

The orchestrator scoped this round as traceability — "the behaviours are largely tested, what is missing is
attributability" — and **that assessment was wrong.** Splitting `[13.1-full-pipeline]` into one named test
per assertion row exposed FOUR rows whose mechanism is not exercised anywhere in the scenario, and TWELVE
more asserted far more weakly than their spec text claims. Naming a row forces someone to point at the
assertion that proves it, and three times here there was nothing to point at.

**The restructure itself is pure.** `[13.1-full-pipeline]` became a `describe` + `before` + 19 `it`s. No
assertion was weakened, strengthened, added or deleted — every one is the same assertion with the same
message, relocated under a row id. The pipeline still runs exactly once (`runFullPipeline()` is the original
body with the `assert.*` calls removed and the values they read captured instead), so runtime is unchanged
and the G5 facts file and acceptance row 5 are unaffected. The scenario token stays in the describe title
so `verify-acceptance.sh`'s TAP grep still hits.

**A shared-setup trap was found and closed by measurement, not by reasoning.** A `before()` that THROWS
makes node report its subtests `cancelled` — and cancelled is not failed. The setup now stashes its failure
and each `it` rethrows it with the setup's own stack. Verified with a throwaway probe: throwing gives
`cancelled`, this shape gives `# fail 2 / # skipped 0 / # cancelled 0`. Every row fails loudly, which is
what C-015 demands and what the gate can actually see.

### The four rows nothing proves

1. **`13.1-s1-mark-green-handler-runs-the-test`** — the row demands the HANDLER re-run the item test before
   TEST_VETTED->GREEN, "proven by a first implementer reply that claims DONE while the test still fails".
   The scripted implementer always writes a correct module on its first reply, so **the lying-DONE
   discriminator — the only thing separating "the handler measured it" from "the model claimed it" — is
   never fed to the machine.** All that exists is `greens.length >= 2`, which a handler that simply trusted
   the model would also satisfy. *Nothing in this scenario would change colour if mark_green stopped
   re-running the test.*
2. **`13.1-s1-validate-quarantined-stamped`** — nothing at all. Scenario 1 never reads a `verify` evidence
   record: not its `startedMs`, not its head, not its tree, not its `excluded` list, and it never seeds a
   stale-red entry. Quarantine round-tripping is asserted nowhere here.
3. **`13.1-s1-report-real-closing-verify`** — nothing at all. `readEvidence` is captured BEFORE the report
   call and never re-read after it. **A `handleReport` that reused an earlier verify record would pass
   everything scenario 1 asserts.**
4. **`13.1-s1-freeze-denies-test-file-edit`** — NOT bound, but the reachability question is now SETTLED and
   the answer is good news. The row's own text says it "fails against the HEAD literal
   `verifyInFlightTree: null` (SG-1)". That literal is gone from the gate path: `plugin/index.ts:1387` now
   passes `verifyFreezeTree`, derived by `freezeTreeFor` walking `liveVerifyTrees` and translating each
   slug through `verifyInFlightTreeFor` (CR-2, C-082). The only surviving `verifyInFlightTree: null` is
   `adapter/continuation.ts:1234`, a different call site that is not the tool.execute.before gate. **The
   row no longer needs excusing — it needs writing.**

### Twelve rows named but partial

Each carries an inline `// NOT proven here:` comment naming the exact clauses its test does not assert, so
the gap is legible at the point of failure rather than only in a report. Examples:
`13.1-s1-classify-work-stays-intake` asserts `classified.kind === "work"` but not that the run is read back
at INTAKE with its classification recorded and NOT advanced.

**Three assertions in the monolith belong to no row in the 20.** Rather than fold them into a neighbouring
row's test — which would make that title claim work it does not do — they kept their own `it`s with no row
id: the §2.6 stale-green publish refusal, the IF1 adjudication, and the G5 metrics-seam crossing. Nothing
was dropped.

**Gate.** Full gate observed by the orchestrator: **1382/1382** node (1364 -> 1382: one top-level test
removed, 19 nested added), typecheck OK, bun 8, schema export OK, python `Ran 80 tests` OK, GATE PASS.
Phase 13's M7 count moves from 6/42 named to **22/42**.

**The lesson for the remaining M7 work:** this is not a formatting exercise. Every scenario still to be
split should be expected to surface rows that nothing proves, and the four above are now open work rather
than closed bookkeeping.
