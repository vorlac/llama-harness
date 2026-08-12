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
