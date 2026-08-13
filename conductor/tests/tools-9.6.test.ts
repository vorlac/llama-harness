// Task 9.6 RED tests — FINAL LOCATION conductor/tests/tools-9.6.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the §4.2 worktree mode — a NEW module
// conductor/adapter/worktrees.ts plus the parallel-writes threading through the COMMITTED
// conductor_dispatch_wave (handleDispatchWave, Task 9.4c) and conductor_publish
// (handlePublish, Task 9.5b). NO new conductor tool and NO new handleX handler. The red is
// two shapes at once:
//   - MISSING MODULE: ../adapter/worktrees.ts does not resolve at HEAD, so this whole file
//     is red the moment node loads it. Its pinned exports:
//       createWorktree   (workspace, runId, itemId, ctx) -> the worktree path
//       mergeBack        (workspace, runId, itemId, ctx) -> { ok, conflict }
//       removeWorktree   (workspace, runId, itemId, ctx) -> void
//   - MISSING EXPORT: adapter/tools.ts does not yet export the C-037 ruling 5 slug->path
//     translation the gate wiring owes:
//       verifyInFlightTreeFor(store, runId, markerTree) -> string | null
//   Beyond those, THREE rows go red BEHAVIOURALLY against committed code once the module
//   exists: [9.6-c021-linked-worktree-exclude] (registerConductorExclude throws ENOTDIR on a
//   linked worktree root at HEAD), [9.6-dispatch-wave-creates-worktrees] and
//   [9.6-registry-binds-worktree-scope] (the committed driver registers every dispatch with
//   tree "main" and persists no item.worktree).
//
// SERIAL-ORDER NOTE: 9.6 is the LAST task of Phase 9 and builds on 9.4c's driver and 9.5b's
// publish handler, both committed at HEAD. It reuses — never re-implements — the committed
// demoteReviewedToGreen (the SHARED REVIEWED->GREEN administrative drop), evidence.runVerify
// (per-tree markers, Task 6.1), gitio's cwd-first queries, and quarantineDirFor's out-of-repo
// path shape. If any of those had to be forked to make this file green, that is a STOP AND
// PARK, not a second copy.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.6 (2699-2728)  — the authoritative behaviour: worktree OUTSIDE the repo,
//                              serial ff-first merge-back, conflict => GREEN demotion,
//                              integrated-tree re-validate, per-tree markers, registry
//                              scope binding, archive/prune hygiene.
//   §4.2:1605-1617           — worktree mode: a worktree INSIDE the repo is a second copy of
//                              every test file the whole-tree runner would then execute.
//   §4.3:1627                — publish serial in item order; the git index is a singleton.
//   §3.5:1396-1413           — strict per-tree freeze + tree-relative path normalization.
//   §3.9:1502-1504           — no-git mode disables worktree mode.
//   §2.5:765 / §2.6:810      — item.worktree; the verify record's tree "main" | "<itemId>".
//   docs/build/specs/task-9.6.assertions.json — the 21 rows mapped to the 21 tests below,
//                              its phaseGate4Bindings (C-021), its C-037 rulings 5/6/7 and
//                              its ten resolved specGaps.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.6.assertions.json; this file is the contract
// that pins them):
//  (G1) BRANCH STRATEGY. createWorktree passes an explicit branch — conductor/<runId>/
//       <itemId> — because a bare `git worktree add` names the branch after the path
//       BASENAME (the itemId), which collides across runs. removeWorktree deletes that
//       branch afterwards, because `git worktree remove --force` leaves it behind.
//  (G2) SIGNATURES. The plan's `mergeBack(workspace, itemId)` cannot compose the branch
//       name, and (workspace, runId, itemId) alone cannot compose the worktree PATH either —
//       the path lives at <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId>
//       (quarantineDirFor's out-of-repo coordinates). All three functions therefore take the
//       spec's positional prefix PLUS one trailing ctx {stateHome, workspaceKey} — a recorded
//       completion of the spec's own recorded deviation from plan 2702-2707.
//  (G3) CONFLICT CLEANUP. mergeBack runs `git merge --abort` before returning
//       {ok:false, conflict:true}: no MERGE_HEAD, clean status, no conflict markers, and a
//       later unrelated merge succeeds in the same workspace.
//  (G4) CRASH PRUNE. createWorktree runs `git worktree prune` BEFORE adding — crash healing
//       at the next worktree operation (the stale-marker-break idiom), no daemon, no state.
//  (G5) NO-GIT. createWorktree REFUSES (throws, naming no-git mode) when gitio.isRepo is
//       false; nothing is created under the state home.
//  (G6) NO NEW JOURNAL EVENT. Setting item.worktree IS an item update: the lifecycle rides
//       `state: item.updated`; the integrated-tree re-validate rides the §2.6 verify record
//       with tree "main". journal-events.ts is not widened.
//  (G7) ARCHIVE IS NOT REMOVAL (C-037 ruling 6). archiveRun clears the current-run pointer
//       and deletes NOTHING; worktree removal is removeWorktree's, invoked by the run
//       lifecycle owner (Task 10.1), and this file pins the non-deletion as a regression.
//  (G8) THE DEMOTION IS THE SHARED HELPER (C-037 ruling 7). A merge conflict drops the later
//       item REVIEWED->GREEN through 9.5b's demoteReviewedToGreen — an administrative store
//       write journaled `state: item.updated` with from:"REVIEWED", NEVER an fsm transition.
//  (G9) TREE IDENTITY (C-037 ruling 5). The evidence layer's tree is an ITEM-ID SLUG
//       (markerPathOf runs assertSafeId, which rejects "/"); the gate's tree is a PATH
//       compared by string equality. The wiring layer translates: "main" -> store.root,
//       "<itemId>" -> store.loadItem(runId, itemId).worktree (null -> nothing to freeze).
//       assertSafeId is NOT relaxed.
// (G10) PUBLISH ORDERING. Pre-merge, publish's §3.3 step 1 compares against the WORKTREE's
//       tree:"<itemId>" verify record; the post-merge re-validate produces the tree:"main"
//       record that gates PUBLISHED — an item is published only after an integrated-tree
//       green (§4.2:1614-1616).
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) REFUSALS THROW, OUTCOMES RETURN. createWorktree/removeWorktree throw on an unsafe
//       id (assertSafeId), on no-git mode, and mergeBack throws on a branch-identity
//       mismatch — before any git write. A merge that RAN returns exactly
//       {ok:true, conflict:false} or {ok:false, conflict:true} (deep-equal, no extra keys).
//  (P2) THE DRIVER CREATES WORKTREES AT WAVE SETUP, before any stage dispatch: every wave
//       member's item.worktree is persisted (read back via store.loadItem) and journaled
//       `state: item.updated` with the path in the record's data, and the member's every
//       sub-session dispatch carries tree = that path into the §3.5 registry.
//  (P3) handlePublish selects worktree mode from config.parallel.writes === "worktrees" AND
//       the persisted item.worktree being non-null. Its INPUT SURFACE IS UNCHANGED — no new
//       fields; the workspace is store.root, the cwd is item.worktree.
//  (P4) PUBLISH FLOW under worktree mode: steps 1-6 with cwd = item.worktree (commit lands
//       on conductor/<runId>/<itemId>); then mergeBack INTO the workspace's own current
//       branch (never a workspace checkout of the item branch); on {ok:true} an
//       integrated-tree runVerify (cwd = workspace, tree "main") gates PUBLISHED; on
//       {conflict:true} the SHARED demotion helper runs and publish returns ok:false with
//       the item persisted at GREEN. A red integrated verify also blocks PUBLISHED; the
//       completed merge STANDS either way (the 9.5b push-failure precedent: conductor's
//       state never disagrees with git history it cannot rewrite).
//  (P5) MERGE-BACK MECHANICS: cwd = workspace, `git merge --ff-only <branch>` first, else a
//       normal merge; before any merge, the recomposed branch name is checked against
//       gitio.currentBranch(<worktree>) and a mismatch is refused with the expected name in
//       the message.
//  (P6) worktrees.ts mirrors gitio's module discipline: execFileSync argv arrays (no shell
//       strings, no `shell: true`) under an env that strips GIT_DIR/GIT_WORK_TREE/
//       GIT_INDEX_FILE — asserted by source scan AND by a live poisoned-GIT_DIR run.
//  (P7) verifyInFlightTreeFor(store, runId, markerTree) is the ONE exported derivation
//       (adapter/tools.ts, the §5.3 wiring layer — the file that already reads
//       RegistryEntry.tree into sessionTree). Its output feeds GateHookInput's existing
//       verifyInFlightTree input; the gate itself is unchanged.
//
// ---------------------------------------------------------------------------
// PINNED MODULE SURFACE the implementer must target (conductor/adapter/worktrees.ts, plus
// the one tools.ts export). Restated STRUCTURALLY below (the 9.4a/9.4b/9.4c/9.5c
// convention) so every call site in this file type-checks the green implementation against
// this file's contract.
//
//   // adapter/worktrees.ts (NEW module)
//   interface WorktreeContext { stateHome: string; workspaceKey: string; }
//   createWorktree(workspace: string, runId: string, itemId: string, ctx: WorktreeContext): string
//     // prune-first; `git worktree add -b conductor/<runId>/<itemId>
//     //   <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId>`; returns the path
//   mergeBack(workspace: string, runId: string, itemId: string, ctx: WorktreeContext):
//     { ok: boolean; conflict: boolean }
//   removeWorktree(workspace: string, runId: string, itemId: string, ctx: WorktreeContext): void
//     // remove --force; prune fallback when the dir is already gone; then the branch delete
//
//   // adapter/tools.ts (ONE new export — the C-037 ruling 5 translation)
//   verifyInFlightTreeFor(store: StateStore, runId: string, markerTree: string): string | null
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id as its FIRST token):
//   9.6-create-worktree-path-and-branch → path + explicit branch + assertSafeId guards +
//                                         untouched main repo.
//   9.6-remove-worktree-and-branch      → remove + branch delete + prune fallback.
//   9.6-outside-repo-witness            → outside the repo; the main tree's whole-tree verify
//                                         provably does not execute the worktree's red copy.
//   9.6-c021-linked-worktree-exclude    → registerConductorExclude resolves --git-common-dir;
//                                         effective, no ENOTDIR, idempotent.
//   9.6-dispatch-wave-creates-worktrees → one worktree per wave member under "worktrees";
//                                         none under "off"; item.worktree persisted+journaled.
//   9.6-registry-binds-worktree-scope   → the registry entry carries the worktree PATH
//                                         (pipeline-real, off the fake SDK's snapshots) and
//                                         the edit gate scopes edits to that tree.
//   9.6-verify-in-worktree              → runVerify cwd=worktree tree=<itemId>: worktree
//                                         head/branch on the record, per-tree marker name.
//   9.6-tree-identity-slug-to-path      → the slug->path translation, end-to-end through the
//                                         gate; the raw slug leaves the session UNFROZEN;
//                                         markerPathOf still refuses a path-shaped tree.
//   9.6-cross-tree-freeze-independence  → a live marker in tree A denies A's edits and not
//                                         B's; the fan-out admission does not hold B.
//   9.6-publish-cwd-worktree            → commit on the worktree branch; workspace clean;
//                                         merge-back integrates; exactly the merged history.
//   9.6-publish-worktree-message-denylist → pure template message, zero model dispatches,
//                                         denylist enforced on the worktree commit.
//   9.6-mergeback-branch-identity       → renamed branch refused with no merge attempted.
//   9.6-mergeback-ff-first-else-merge   → ff produces no merge commit; advanced workspace
//                                         falls back to exactly one merge commit.
//   9.6-mergeback-serial-item-order     → two-item integration in item order, read off git's
//                                         own ordered ref-update log (the reflog) + ancestry.
//   9.6-mergeback-handler-argv          → source scan (execFileSync argv, env scrub), a
//                                         poisoned GIT_DIR run, the session git-gate deny,
//                                         and the exact {ok:true, conflict:false} return.
//   9.6-postmerge-revalidate-integrated → witness file written by the verify command in the
//                                         workspace, absent from the worktree; tree:"main"
//                                         record gates PUBLISHED; a red integrated verify
//                                         blocks PUBLISHED.
//   9.6-conflict-demotes-green          → the later item drops to GREEN via the shared
//                                         helper (state + debugging + `state: item.updated`,
//                                         zero fsm records); the earlier merge stands.
//   9.6-conflict-merge-abort-clean      → no MERGE_HEAD, clean status, no conflict markers,
//                                         a later unrelated merge succeeds.
//   9.6-archive-does-not-remove         → archiveRun deletes nothing; worktrees survive it.
//   9.6-crash-prune                     → a crashed run's stale entry is pruned by the next
//                                         createWorktree, which then succeeds.
//   9.6-nogit-refuses-worktree          → isRepo false => refusal naming no-git mode, and
//                                         nothing created under the state home.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// THE SUBJECTS — absent at red time.
// The new module (unresolved import: the whole file is red until it exists):
import { createWorktree, mergeBack, removeWorktree } from "../adapter/worktrees.ts";
// The C-037 ruling 5 slug->path translation (missing-export red from the existing tools.ts):
import { verifyInFlightTreeFor } from "../adapter/tools.ts";

// Committed today.
import { gateBeforeToolCall, handleDispatchWave, handlePublish } from "../adapter/tools.ts";
import type {
  DispatchWaveInput,
  DispatchWaveResult,
  GateHookInput,
  PublishInput,
  PublishResult,
  RegistryEntry,
  StageExecutor,
  WaveTreeState,
} from "../adapter/tools.ts";
import { openWorkspace, registerConductorExclude } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { currentBranch, dirtyFiles, headSha, isRepo, stagedFiles } from "../adapter/gitio.ts";
import { runVerify } from "../adapter/evidence.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, FanoutJob, TreeState } from "../adapter/fanout.ts";
import type { RegistryEntry as FanoutRegistryEntry } from "../adapter/fanout.ts";
import { loadPacks } from "../adapter/inject.ts";
import { buildCommitMessage } from "../core/commit-message.ts";
import { decideGit } from "../core/gates-git.ts";
import { validate } from "../core/types.ts";
import type { Config, EvidenceRecord, Item, ItemState, ParallelWriteMode, Queue, QueueItem } from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY. The typed consts below are where tsc checks
// the green implementation against THIS file's contract; nothing here imports a type that
// does not exist at HEAD, so the red stays the missing-module/missing-export shape.
// ---------------------------------------------------------------------------

interface WorktreeContext {
  stateHome: string;
  workspaceKey: string;
}

interface MergeBackResult {
  ok: boolean;
  conflict: boolean;
}

type CreateWorktreeFn = (workspace: string, runId: string, itemId: string, ctx: WorktreeContext) => string;
type MergeBackFn = (workspace: string, runId: string, itemId: string, ctx: WorktreeContext) => MergeBackResult;
type RemoveWorktreeFn = (workspace: string, runId: string, itemId: string, ctx: WorktreeContext) => void;
type VerifyInFlightTreeForFn = (store: StateStore, runId: string, markerTree: string) => string | null;

const createWorktreeFn: CreateWorktreeFn = createWorktree;
const mergeBackFn: MergeBackFn = mergeBack;
const removeWorktreeFn: RemoveWorktreeFn = removeWorktree;
const treeForFn: VerifyInFlightTreeForFn = verifyInFlightTreeFor;

// ---------------------------------------------------------------------------
// Distinctive fixture markers and path vocabulary.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-9006";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-9006";
const SHARED_MARKER = "SHARED-BASE-MARKER-9006";
const IMPL_REPLY_MARKER = "IMPL-REPLY-MARKER-9006";

// The §4.2 out-of-repo coordinates. WKEY is this file's workspaceKey everywhere.
const WKEY = "wkey96";

// The verify scope name is deliberately distinctive so a hardcoded "unit" cannot satisfy it.
const SCOPE = "unit9006";

// The committed shared file both conflict fixtures edit (SAME single line => a real merge
// conflict, never a coincidental clean merge).
const SHARED_REL = "src/shared/data.txt";
const SHARED_BASE = `shared base line (${SHARED_MARKER})\n`;

// Names the fixture verify commands write RELATIVE TO THEIR CWD — presence in a tree is the
// proof the verify executed THERE.
const WITNESS_REL = "integrated-witness-9006.jsonl";
const POISON_REL = "integration-poison-9006.txt";

// runVerify's startedMs is an integer Date.now() while file mtimes carry sub-millisecond
// precision, so a verify seeded in the same millisecond as a write could read stale. The
// seeding verifies stamp their clock a hair ahead of the writes they follow.
const MTIME_GUARD_MS = 50;

// This file's home (conductor/tests/) — doctrine packs and the worktrees source are
// resolved RELATIVE to it (meaningful only at the FINAL LOCATION; at red time the file
// never loads far enough to use them).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");
const WORKTREES_SRC = path.resolve(HERE, "..", "adapter", "worktrees.ts");

// The REAL doctrine packs through the COMMITTED loader (the 9.4c wave-bench idiom).
const PACKS: Record<string, string> = loadPacks(DOCTRINE_DIR);

// The expected out-of-repo worktree path and branch — THIS FILE'S OWN restatement of the
// spec literals, never derived from the subject module.
function wtPathOf(stateHome: string, runId: string, itemId: string): string {
  return path.join(stateHome, "conductor", WKEY, "worktrees", runId, itemId);
}

function wtBranchOf(runId: string, itemId: string): string {
  return `conductor/${runId}/${itemId}`;
}

function ctxFor(stateHome: string): WorktreeContext {
  return { stateHome, workspaceKey: WKEY };
}

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom). tmpdir() is
// realpath'd so every composed path equals what git and child processes report back — no
// /var vs /private/var mismatch on macOS.
// ---------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

const REAL_TMP = realpathSync(tmpdir());

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

function gitOut(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// A committed fixture repo. The shared file is COMMITTED so every linked worktree checks it
// out; repo-LOCAL identity is configured so the SUBJECT's own git children (merge commits)
// never depend on the runner's global config.
function committedRepo(): string {
  const dir = mkdtempSync(path.join(REAL_TMP, "conductor-96-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  mkdirSync(path.join(dir, "src", "shared"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  writeFileSync(path.join(dir, SHARED_REL), SHARED_BASE);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function freshStateHome(): string {
  const dir = mkdtempSync(path.join(REAL_TMP, "conductor-96-state-"));
  tmpDirs.push(dir);
  return dir;
}

function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(REAL_TMP, prefix));
  tmpDirs.push(dir);
  return dir;
}

function mustHead(dir: string): string {
  const sha = headSha(dir);
  assert.ok(sha !== null, `premise: HEAD exists in ${dir}`);
  return sha;
}

// `git worktree list --porcelain` paths — git reports REAL paths, and every fixture path is
// composed from the realpath'd tmp root, so plain string comparison is exact.
function worktreeListPaths(workspace: string): string[] {
  return gitOut(workspace, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function branchListed(workspace: string, branch: string): boolean {
  return gitOut(workspace, ["branch", "--list", branch]).length > 0;
}

function mergeHeadExists(workspace: string): boolean {
  return existsSync(path.join(workspace, ".git", "MERGE_HEAD"));
}

function isAncestor(workspace: string, sha: string): boolean {
  const probe = spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
    cwd: workspace,
    env: GIT_ENV,
    stdio: "ignore",
  });
  return probe.status === 0;
}

function commitShas(workspace: string): string[] {
  return gitOut(workspace, ["log", "--format=%H"]).split("\n").filter((line) => line.length > 0);
}

async function turns(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

// ---------------------------------------------------------------------------
// Journal sinks.
// ---------------------------------------------------------------------------

interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}

interface JournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
}

function makeRecorder(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
  };
  return { sink, records };
}

// ---------------------------------------------------------------------------
// Config + fixture commands. Every command is a REAL child process argv (never a shell
// string), matching evidence.ts's spawn discipline.
// ---------------------------------------------------------------------------

const GREEN_CMD: string[] = [process.execPath, "-e", "process.exit(0);"];

// The row-16 command: append {cwd} to a witness ledger IN ITS CWD, then go red iff the
// poison file exists there. Presence of the witness file in a tree is the proof the verify
// executed in that tree; the poison makes only the WORKSPACE red.
const WITNESS_CMD: string[] = [
  process.execPath,
  "-e",
  'const fs = require("node:fs");\n' +
    `fs.appendFileSync(${JSON.stringify(WITNESS_REL)}, JSON.stringify({ cwd: process.cwd() }) + "\\n");\n` +
    `process.exit(fs.existsSync(${JSON.stringify(POISON_REL)}) ? 1 : 0);\n`,
];

// The row-3 WHOLE-TREE runner: recursively discover every *.witness.mjs under the cwd and
// execute each — a stand-in for "the main tree's whole-tree verify runner" whose discovery
// is exactly the §4.2/Task 6.2 hazard.
const TREE_RUNNER_CMD: string[] = [
  process.execPath,
  "-e",
  'const fs = require("node:fs");\n' +
    'const path = require("node:path");\n' +
    'const { spawnSync } = require("node:child_process");\n' +
    "const found = [];\n" +
    "const walk = (dir) => {\n" +
    "  for (const name of fs.readdirSync(dir)) {\n" +
    '    if (name === ".git" || name === "node_modules" || name === ".conductor") continue;\n' +
    "    const p = path.join(dir, name);\n" +
    "    const st = fs.statSync(p);\n" +
    "    if (st.isDirectory()) walk(p);\n" +
    '    else if (name.endsWith(".witness.mjs")) found.push(p);\n' +
    "  }\n" +
    "};\n" +
    "walk(process.cwd());\n" +
    "let bad = 0;\n" +
    "for (const f of found) {\n" +
    '  const r = spawnSync(process.execPath, [f], { stdio: "ignore" });\n' +
    "  if (r.status !== 0) bad += 1;\n" +
    "}\n" +
    "process.exit(bad === 0 ? 0 : 1);\n",
];

// The row-7 command: record which per-tree verify markers are LIVE in the run dir at the
// instant the scope command executes.
function markerObserverCmd(runDir: string, outFile: string): string[] {
  return [
    process.execPath,
    "-e",
    'const fs = require("node:fs");\n' +
      `const seen = fs.readdirSync(${JSON.stringify(runDir)}).filter((name) => name.startsWith("verify-running-"));\n` +
      `fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(seen));\n` +
      "process.exit(0);\n",
  ];
}

// A deliberately-red witness test for the WORKTREE copy: executing it leaves an absolute
// marker file behind and exits 1.
function redWitnessSource(absMarker: string): string {
  return (
    'import { writeFileSync } from "node:fs";\n' +
    `writeFileSync(${JSON.stringify(absMarker)}, "the worktree copy executed\\n");\n` +
    "process.exit(1);\n"
  );
}

interface ConfigOpts {
  writes?: "off" | "worktrees";
  command?: string[];
}

function makeConfig(opts: ConfigOpts = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: { command: [...(opts.command ?? GREEN_CMD)], timeoutMs: 120_000 } },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 3,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 2,
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: {
      writes: opts.writes ?? "worktrees",
      maxImplementers: 4,
      maxReaders: 4,
      subSessionTimeoutMs: 120_000,
    },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// ---------------------------------------------------------------------------
// Store / run / queue fixtures (the tools-9.2..9.5c discipline: direct on-disk seeding, no
// other task's handler runs inside a fixture).
// ---------------------------------------------------------------------------

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

function createRunFor(store: StateStore): string {
  const run = store.createRun({
    prompt: "integrate the parser changes in parallel worktrees",
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for behavioural changes",
      check: { agreed: true, note: "" },
    },
  });
  return run.runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

function makeRuntimeItem(id: string, state: ItemState): Item {
  return {
    id,
    state,
    assignee: null,
    worktree: null,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: {},
    taint: [],
    inlineClaim: null,
  };
}

function makeQueueItem(
  id: string,
  over: { fileScope: string[]; testScope: string[]; behavioral?: boolean; dependsOn?: string[] },
): QueueItem {
  return {
    id,
    title: `carry the ${id} change (${TITLE_MARKER})`,
    rationale: "the harness needs a real queue item to drive the worktree pipeline",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: [`the ${id} change is integrated (${ACCEPT_MARKER})`],
    behavioral: over.behavioral ?? true,
    dependsOn: [...(over.dependsOn ?? [])],
    ponytail: {
      necessary: "the run's prompt asks for this change",
      reuse: "checked the existing modules; nothing carries it",
      ladderRung: "minimal-code",
    },
  };
}

function relsOf(id: string): { srcDir: string; implRel: string; testRel: string } {
  const low = id.toLowerCase();
  return {
    srcDir: path.join("src", low),
    implRel: `src/${low}/impl.mjs`,
    testRel: `tests/${low}.test.mjs`,
  };
}

function waveItem(id: string): QueueItem {
  const rels = relsOf(id);
  return makeQueueItem(id, { fileScope: [`src/${id.toLowerCase()}/**`], testScope: [rels.testRel] });
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

type VerifyEvidence = Extract<EvidenceRecord, { kind: "verify" }>;

function verifyRecords(runDir: string): VerifyEvidence[] {
  return readEvidence(runDir).filter((record): record is VerifyEvidence => record.kind === "verify");
}

// The live per-tree marker slugs in a run dir — the SAME ledger the wiring layer's
// translation consumes (never a slug typed twice).
function liveMarkerSlugs(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((name) => name.startsWith("verify-running-") && name.endsWith(".json"))
    .map((name) => name.slice("verify-running-".length, -".json".length));
}

function markerFileOf(runDir: string, slug: string): string {
  return path.join(runDir, `verify-running-${slug}.json`);
}

// ---------------------------------------------------------------------------
// Fan-out wiring over the fake SDK.
// ---------------------------------------------------------------------------

const NEVER_FROZEN: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

const NEVER_FROZEN_WAVE: WaveTreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
  notifyClear: (): void => undefined,
};

// A quiet fanout for handlePublish: it CAN answer anything, so "zero dispatches" is about
// the handler declining to ask rather than the fixture being unable to reply.
function quietFanout(
  runId: string,
  config: Config,
  journal: JournalSink,
): { fanout: Fanout; sdk: ReturnType<typeof makeFakeSdk> } {
  const registry = new Map<string, FanoutRegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  sdk.setResponder(() => ({ kind: "reply", text: "{}" }));
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    NEVER_FROZEN,
    runId,
  );
  return { fanout, sdk };
}

// A valid §2.10 implementer receipt (row 9's fan-out admission half).
const IMPL_RESULT = {
  status: "DONE",
  summary: `applied the minimal change (${IMPL_REPLY_MARKER})`,
  concerns: [],
  neededContext: null,
  blockReason: null,
};

// ---------------------------------------------------------------------------
// The wave bench (rows 5 and 6): a PLAN_REVIEWED two-item run the committed driver can
// execute for real over the fake SDK.
// ---------------------------------------------------------------------------

const SUBMIT_TEST = "conductor_submit_test";

interface WaveBench {
  workspace: string;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  queue: Queue;
  config: Config;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  registry: Map<string, FanoutRegistryEntry>;
  sdk: ReturnType<typeof makeFakeSdk>;
  fanout: Fanout;
}

function buildWaveBench(writes: "off" | "worktrees"): WaveBench {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig({ writes });
  const journal = makeRecorder();
  const store = openStore(workspace, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = { items: [waveItem("I1"), waveItem("I2")] };

  const run = store.loadRun(runId);
  run.state = "PLAN_REVIEWED";
  run.planReviewRounds = 0;
  store.saveRun(run);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  store.saveItem(runId, makeRuntimeItem("I1", "PENDING"));
  store.saveItem(runId, makeRuntimeItem("I2", "PENDING"));

  const registry = new Map<string, FanoutRegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  const fanout = createFanout(
    sdk.client,
    config,
    journal.sink as unknown as Parameters<typeof createFanout>[2],
    registry,
    NEVER_FROZEN,
    runId,
  );
  return { workspace, stateHome, store, runId, runDir, queue, config, journal, registry, sdk, fanout };
}

function waveInputFor(bench: WaveBench, executors?: Record<string, StageExecutor>): DispatchWaveInput {
  return {
    store: bench.store,
    fanout: bench.fanout,
    treeState: NEVER_FROZEN_WAVE,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WKEY,
    packs: PACKS,
    ...(executors === undefined ? {} : { executors }),
  };
}

// An executor that stops every member at its first stage WITHOUT touching the SDK — row 5
// isolates the driver's wave SETUP (worktree creation) from stage traffic.
const stopExecutor: StageExecutor = async (ctx) => ({
  ok: false,
  itemState: ctx.store.loadItem(ctx.runId, ctx.itemId).state,
});

// ---------------------------------------------------------------------------
// The publish bench (rows 10, 11, 14, 16, 17): items at REVIEWED whose worktrees carry
// uncommitted scope edits and a REAL worktree-tree verify record (seeded through the
// committed evidence.runVerify, so the §2.6 shape is the ledger's and not this file's).
// ---------------------------------------------------------------------------

interface PublishItemSpec {
  id: string;
  // When set, the worktree rewrites the COMMITTED shared file with this content (and the
  // item's fileScope covers it) — the contrived-overlap knob for the conflict rows.
  sharedEdit?: string;
}

interface PublishBench {
  workspace: string;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  queue: Queue;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  sdk: ReturnType<typeof makeFakeSdk>;
  fanout: Fanout;
  h0: string;
  worktreeOf: Map<string, string>;
}

function buildPublishBench(specs: PublishItemSpec[]): PublishBench {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig({ writes: "worktrees" });
  const journal = makeRecorder();
  const store = openStore(workspace, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);

  const queue: Queue = {
    items: specs.map((spec) =>
      makeQueueItem(spec.id, {
        fileScope: [
          `src/${spec.id.toLowerCase()}/**`,
          ...(spec.sharedEdit === undefined ? [] : [SHARED_REL]),
        ],
        testScope: [relsOf(spec.id).testRel],
      }),
    ),
  };
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));

  const evJournal: Journal = createJournal(runDir, config, {});
  const worktreeOf = new Map<string, string>();
  const h0 = mustHead(workspace);

  for (const spec of specs) {
    store.saveItem(runId, makeRuntimeItem(spec.id, "PENDING"));
    const wt = createWorktreeFn(workspace, runId, spec.id, ctxFor(stateHome));
    const rels = relsOf(spec.id);
    mkdirSync(path.join(wt, rels.srcDir), { recursive: true });
    mkdirSync(path.join(wt, "tests"), { recursive: true });
    writeFileSync(path.join(wt, rels.implRel), `export const built = ${JSON.stringify(spec.id)};\n`);
    writeFileSync(
      path.join(wt, rels.testRel),
      `import test from "node:test";\ntest(${JSON.stringify(spec.id)}, () => {});\n`,
    );
    if (spec.sharedEdit !== undefined) writeFileSync(path.join(wt, SHARED_REL), spec.sharedEdit);

    // The WORKTREE-tree verify record publish's step 1 rests on (G10): produced by the
    // committed machinery with cwd = the worktree and tree = the item id.
    const outcome = runVerify(runDir, spec.id, config, [rels.implRel], {
      cwd: wt,
      tree: spec.id,
      journal: evJournal,
      stateHome,
      workspaceKey: WKEY,
      runId,
      now: () => Date.now() + MTIME_GUARD_MS,
    });
    if (outcome.refused) throw new Error(`premise: the seeding verify was refused: ${outcome.reason}`);
    assert.equal(outcome.record.green, true, "premise: the seeding worktree verify is green");
    assert.equal(outcome.record.tree, spec.id, "premise: the seeding record carries the item-id tree slug");

    const item = store.loadItem(runId, spec.id);
    item.worktree = wt;
    item.state = "REVIEWED";
    item.evidence.validated = { ledger: "evidence.jsonl", seq: outcome.record.seq };
    store.saveItem(runId, item);
    worktreeOf.set(spec.id, wt);
  }

  const wired = quietFanout(runId, config, journal.sink);
  return {
    workspace,
    stateHome,
    store,
    runId,
    runDir,
    config,
    queue,
    journal,
    sdk: wired.sdk,
    fanout: wired.fanout,
    h0,
    worktreeOf,
  };
}

function publishInputFor(bench: PublishBench, itemId: string, over: Partial<PublishInput> = {}): PublishInput {
  return {
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: bench.stateHome,
    workspaceKey: WKEY,
    ...over,
  };
}

function wtOf(bench: PublishBench, itemId: string): string {
  const wt = bench.worktreeOf.get(itemId);
  assert.ok(wt !== undefined, `premise: the bench created a worktree for ${itemId}`);
  return wt;
}

// ---------------------------------------------------------------------------
// The gate, driven for real (rows 6, 8, 9): every scope/freeze permission claim goes
// THROUGH the committed §5.3 wiring over core decideEdit — never decideEdit directly.
// ---------------------------------------------------------------------------

interface EditAttempt {
  runId: string;
  journal: JournalSink;
  sessionID: string;
  role: string;
  itemId: string;
  tree: string;
  editPath: string;
  fileScope: string[];
  testScope: string[];
  verifyInFlightTree: string | null;
}

function attemptEdit(a: EditAttempt): { allowed: boolean; reason: string } {
  const registry = new Map<string, RegistryEntry>([
    [a.sessionID, { role: a.role, itemId: a.itemId, tree: a.tree }],
  ]);
  const input: GateHookInput = {
    sessionID: a.sessionID,
    toolName: "edit",
    args: { filePath: a.editPath },
    editPath: a.editPath,
    registry,
    gitMode: "commit",
    runActive: true,
    branchPolicy: "pin",
    fileScope: [...a.fileScope],
    testScope: [...a.testScope],
    verifyInFlightTree: a.verifyInFlightTree,
    inlineClaimScope: null,
    journal: a.journal,
    corr: { runId: a.runId, itemId: a.itemId, sessionID: a.sessionID },
  };
  try {
    gateBeforeToolCall(input);
    return { allowed: true, reason: "" };
  } catch (err) {
    return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Fixture sanity (the 9.1-9.5c probe-block discipline: a red below is then about the
// subjects, never the fixtures).
// ---------------------------------------------------------------------------

// The closed two-mode vocabulary, pinned at the type level (ParallelWriteMode admits
// exactly these two members at HEAD) and at the schema level: BOTH modes this file drives
// are §2.1-valid configurations, so no vocabulary widening is needed anywhere below.
const WORKTREES_MODE: ParallelWriteMode = "worktrees";
const OFF_MODE: ParallelWriteMode = "off";
assert.equal(
  validate("Config", makeConfig({ writes: WORKTREES_MODE })).ok,
  true,
  "sanity: a parallel.writes \"worktrees\" config satisfies SCHEMAS.Config — the mode is committed vocabulary",
);
assert.equal(
  validate("Config", makeConfig({ writes: OFF_MODE })).ok,
  true,
  "sanity: the \"off\" contrast config is schema-valid too",
);
assert.equal(validate("Queue", { items: [waveItem("I1"), waveItem("I2")] }).ok, true, "sanity: the queue fixture satisfies SCHEMAS.Queue");
assert.equal(validate("Item", makeRuntimeItem("I1", "PENDING")).ok, true, "sanity: the item fixture satisfies SCHEMAS.Item");
assert.equal(
  validate("Item", { ...makeRuntimeItem("I1", "RED"), worktree: "/abs/somewhere/wt" }).ok,
  true,
  "sanity: §2.5 item.worktree already admits a path string — no schema widening is needed",
);
assert.equal(
  validate("ImplementerResult", IMPL_RESULT).ok,
  true,
  "sanity: the canned implementer receipt satisfies SCHEMAS.ImplementerResult",
);
assert.ok(Object.keys(PACKS).length > 0, "sanity: the REAL doctrine packs loaded through the committed loader");

// ===========================================================================
// [9.6-create-worktree-path-and-branch]
// ===========================================================================

test("[9.6-create-worktree-path-and-branch] createWorktree(workspace, runId, itemId, ctx) adds a worktree at exactly <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId> and returns that path, on an EXPLICIT branch conductor/<runId>/<itemId> (a bare `git worktree add` would name the branch after the path basename and collide across runs); every id segment is guarded by assertSafeId BEFORE any git call; and the main repo's HEAD, branch and status are untouched", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runId = "r-96-create";
  const h0 = mustHead(workspace);

  const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));

  assert.equal(wt, wtPathOf(stateHome, runId, "I1"), "the returned path is the spec's out-of-repo location, exactly");
  assert.equal(existsSync(wt), true, "the worktree directory exists");
  assert.equal(isRepo(wt), true, "the path is a live git work tree");
  assert.equal(
    currentBranch(wt),
    wtBranchOf(runId, "I1"),
    "the checked-out branch is the EXPLICIT conductor/<runId>/<itemId> name, not the path-basename default",
  );
  assert.equal(mustHead(wt), h0, "the worktree starts at the workspace's HEAD commit");
  assert.equal(branchListed(workspace, wtBranchOf(runId, "I1")), true, "the branch is visible from the main repo");
  assert.ok(worktreeListPaths(workspace).includes(wt), "git's own worktree list names the new path");

  // The main repo is a bystander to the add.
  assert.equal(mustHead(workspace), h0, "the workspace HEAD did not move");
  assert.equal(currentBranch(workspace), "main", "the workspace branch did not switch");
  const dirt = dirtyFiles(workspace);
  assert.deepEqual(
    { trackedModified: dirt.trackedModified, untracked: dirt.untracked },
    { trackedModified: [], untracked: [] },
    "the workspace status stays clean",
  );

  // F2/F3: traversing ids are REFUSED before any git call — the composed path is later
  // rm'd and pruned, so the id guard is a trust boundary, not tidiness.
  const listedBefore = worktreeListPaths(workspace).length;
  assert.throws(
    () => createWorktreeFn(workspace, "../escape", "I1", ctxFor(stateHome)),
    /refusing/,
    "a traversing runId is refused",
  );
  assert.throws(
    () => createWorktreeFn(workspace, runId, "..", ctxFor(stateHome)),
    /refusing/,
    "a dot-dot itemId is refused",
  );
  assert.throws(
    () => createWorktreeFn(workspace, runId, "I1", { stateHome, workspaceKey: "../wk" }),
    /refusing/,
    "a traversing workspaceKey is refused",
  );
  assert.equal(worktreeListPaths(workspace).length, listedBefore, "no refused call added a worktree");
  assert.deepEqual(
    readdirSync(path.join(stateHome, "conductor", WKEY, "worktrees")),
    [runId],
    "the state home carries exactly the one legitimate run's worktrees — nothing a refused id created",
  );
});

// ===========================================================================
// [9.6-remove-worktree-and-branch]
// ===========================================================================

test("[9.6-remove-worktree-and-branch] removeWorktree removes the worktree AND deletes its branch (asserted separately, because `git worktree remove --force` leaves the branch behind); an untracked build artifact in the worktree does not block the removal; when the directory was already deleted the prune fallback still clears the administrative entry and the branch; the main repo ends clean with HEAD untouched", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runId = "r-96-remove";
  const h0 = mustHead(workspace);

  // (a) the ordinary removal, with an untracked artifact in the tree (pins --force).
  const wt1 = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  writeFileSync(path.join(wt1, "build-artifact-9006.txt"), "untracked build output\n");

  removeWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));

  assert.equal(existsSync(wt1), false, "the worktree directory is gone");
  assert.equal(worktreeListPaths(workspace).includes(wt1), false, "git no longer lists the worktree");
  assert.equal(
    branchListed(workspace, wtBranchOf(runId, "I1")),
    false,
    "the conductor/<runId>/<itemId> branch is deleted too — `git worktree remove` alone leaves it behind",
  );

  // (b) the prune fallback: the directory vanished (a crash, a manual rm) but the
  // administrative entry survived.
  const wt2 = createWorktreeFn(workspace, runId, "I2", ctxFor(stateHome));
  rmSync(wt2, { recursive: true, force: true });
  assert.equal(
    worktreeListPaths(workspace).includes(wt2),
    true,
    "premise: deleting the directory leaves git's administrative entry behind",
  );

  removeWorktreeFn(workspace, runId, "I2", ctxFor(stateHome));

  assert.equal(worktreeListPaths(workspace).includes(wt2), false, "the prune fallback cleared the administrative entry");
  assert.equal(branchListed(workspace, wtBranchOf(runId, "I2")), false, "and the branch is deleted on this path too");

  assert.equal(mustHead(workspace), h0, "the workspace HEAD is untouched by both removals");
  const dirt = dirtyFiles(workspace);
  assert.deepEqual(
    { trackedModified: dirt.trackedModified, untracked: dirt.untracked },
    { trackedModified: [], untracked: [] },
    "the workspace status is clean afterwards",
  );
});

// ===========================================================================
// [9.6-outside-repo-witness]
// ===========================================================================

test("[9.6-outside-repo-witness] the worktree path is OUTSIDE the repo (not a prefix-descendant of the workspace), and the main tree's whole-tree verify provably does NOT execute the worktree's copy of a test: a deliberately-red, witness-writing test present only in the worktree leaves a main-tree runVerify GREEN with the witness absent — while the SAME runner in the worktree goes red and writes the witness, so the proof is live, not a tautology (the Task 6.2 hazard closed by construction)", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const witnessHome = freshDir("conductor-96-witness-");
  const runDir = freshDir("conductor-96-rundir-");
  const runId = "r-96-outside";
  const config = makeConfig({ command: TREE_RUNNER_CMD });
  const journal = createJournal(runDir, config, {});

  const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));

  // Geometry first: the worktree lives under the state home, never under the repo.
  assert.notEqual(wt, workspace, "the worktree is not the workspace");
  assert.equal(wt.startsWith(workspace + path.sep), false, "the worktree path is NOT under the repo root");
  assert.equal(wt.startsWith(stateHome + path.sep), true, "the worktree path IS under the out-of-repo state home");

  // The hazard made concrete: a red test in the WORKTREE that proves its own execution.
  const redMarkerAbs = path.join(witnessHome, "red-witness-executed.txt");
  mkdirSync(path.join(wt, "tests"), { recursive: true });
  writeFileSync(path.join(wt, "tests", "i1-red-copy.witness.mjs"), redWitnessSource(redMarkerAbs));

  // The MAIN tree's whole-tree verify: green, and the worktree's red copy provably never ran.
  const mainOutcome = runVerify(runDir, "I1", config, "src/anything.mjs", {
    cwd: workspace,
    tree: "main",
    journal,
    stateHome,
    workspaceKey: WKEY,
    runId,
  });
  assert.equal(mainOutcome.refused, false, "the main-tree verify ran");
  if (mainOutcome.refused) return;
  assert.equal(mainOutcome.record.tree, "main", "the record carries the main tree slug");
  assert.equal(
    mainOutcome.record.green,
    true,
    "the main tree's whole-tree verify is GREEN: the worktree's in-progress red test is invisible to it",
  );
  assert.equal(
    existsSync(redMarkerAbs),
    false,
    "the witness file does not exist — the worktree's copy provably did not execute during the main-tree verify",
  );

  // The CONTRAST: the same runner IN the worktree discovers and executes the red copy.
  // Without this half, 'the witness is absent' would also pass on a runner that runs nothing.
  const wtOutcome = runVerify(runDir, "I1", config, "src/anything.mjs", {
    cwd: wt,
    tree: "I1",
    journal,
    stateHome,
    workspaceKey: WKEY,
    runId,
  });
  assert.equal(wtOutcome.refused, false, "the worktree verify ran");
  if (wtOutcome.refused) return;
  assert.equal(wtOutcome.record.green, false, "the same runner in the WORKTREE goes red on the red copy");
  assert.equal(existsSync(redMarkerAbs), true, "and the witness proves the copy executed there");
});

// ===========================================================================
// [9.6-c021-linked-worktree-exclude]
// ===========================================================================

test("[9.6-c021-linked-worktree-exclude] DEFERRED BINDING (C-021): registerConductorExclude called with a LINKED worktree root does NOT throw ENOTDIR (root/.git is a FILE there and rev-parse --is-inside-work-tree returns true, so the isRepo guard cannot catch it), creates NO .git/info directory inside the worktree, and writes the single `.conductor/` line to the COMMON dir's info/exclude — the only effective target; an exclude in the per-worktree gitdir is inert — so `git status` inside the worktree hides .conductor/; main-repo behaviour stays idempotent", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runId = "r-96-c021";

  const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  assert.equal(statSync(path.join(wt, ".git")).isFile(), true, "premise: a linked worktree's .git is a FILE");
  assert.equal(isRepo(wt), true, "premise: rev-parse reports inside-work-tree, so the isRepo guard passes");

  // At HEAD this throws ENOTDIR (mkdirSync(<wt>/.git/info) with .git a file) — the C-021 red.
  const registered = registerConductorExclude(wt);

  assert.equal(registered, true, "the registration reports success for a worktree root");
  assert.equal(
    statSync(path.join(wt, ".git")).isFile(),
    true,
    "the worktree's .git is STILL a file — no .git/info directory was manufactured inside the worktree",
  );

  // The write landed in the COMMON dir (resolved via `git rev-parse --git-common-dir`,
  // resolved against the root when git answers with a relative path).
  const commonExclude = path.join(workspace, ".git", "info", "exclude");
  assert.equal(existsSync(commonExclude), true, "the common dir's info/exclude exists");
  const commonLines = readFileSync(commonExclude, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() === ".conductor/");
  assert.equal(commonLines.length, 1, "exactly one `.conductor/` line in the COMMON exclude file");

  // The per-worktree gitdir is NOT the target: an exclude written there is empirically inert.
  assert.equal(
    existsSync(path.join(workspace, ".git", "worktrees", "I1", "info", "exclude")),
    false,
    "no exclude file was written into the per-worktree gitdir (an exclude there does nothing)",
  );

  // EFFECTIVE, not just written: an untracked .conductor/ inside the worktree is invisible
  // to git status there.
  mkdirSync(path.join(wt, ".conductor"), { recursive: true });
  writeFileSync(path.join(wt, ".conductor", "state.json"), "{}\n");
  const wtDirt = dirtyFiles(wt);
  assert.equal(
    wtDirt.untracked.some((entry) => entry.startsWith(".conductor")),
    false,
    "git status inside the worktree does not list .conductor/ — the exclusion is effective",
  );

  // Main-repo behaviour unchanged and idempotent: a second and third call add nothing.
  assert.equal(registerConductorExclude(workspace), true, "the main-repo registration still succeeds");
  assert.equal(registerConductorExclude(wt), true, "and the worktree registration is idempotent");
  const afterLines = readFileSync(commonExclude, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() === ".conductor/");
  assert.equal(afterLines.length, 1, "still exactly one `.conductor/` line after repeated calls");
});

// ===========================================================================
// [9.6-dispatch-wave-creates-worktrees]
// ===========================================================================

test("[9.6-dispatch-wave-creates-worktrees] under parallel.writes \"worktrees\", conductor_dispatch_wave creates ONE worktree per wave member at wave setup and persists the committed §2.5 item.worktree = that path (read back via store.loadItem, journaled `state: item.updated` with the path in the record); under the default \"off\" no worktree is created, git lists only the main tree, and item.worktree stays null", async () => {
  // --- worktrees mode -------------------------------------------------------
  const bench = buildWaveBench("worktrees");
  assert.equal(
    existsSync(path.join(bench.stateHome, "conductor", WKEY, "worktrees")),
    false,
    "premise: no worktree exists before the wave",
  );

  const result: DispatchWaveResult = await handleDispatchWave(
    waveInputFor(bench, { [SUBMIT_TEST]: stopExecutor }),
  );
  assert.deepEqual(result.wave.parallel, ["I1", "I2"], "premise: both independent items are wave members");

  for (const itemId of result.wave.parallel) {
    const expected = wtPathOf(bench.stateHome, bench.runId, itemId);
    const item = bench.store.loadItem(bench.runId, itemId);
    assert.equal(
      item.worktree,
      expected,
      `item.worktree for ${itemId} is the out-of-repo path (persisted through the store, read back off disk)`,
    );
    assert.equal(existsSync(expected), true, `the worktree for ${itemId} exists on disk`);
    assert.equal(isRepo(expected), true, `the worktree for ${itemId} is a live git work tree`);
    assert.equal(
      currentBranch(expected),
      wtBranchOf(bench.runId, itemId),
      `the worktree for ${itemId} is on its explicit conductor branch`,
    );
    assert.ok(
      worktreeListPaths(bench.workspace).includes(expected),
      `git's worktree list names ${itemId}'s tree`,
    );

    // G6: the lifecycle rides the EXISTING `state: item.updated` event — no journal-events
    // widening — and the record's data names the path.
    const updated = bench.journal.records.filter(
      (record) =>
        record.component === "state" &&
        record.event === "item.updated" &&
        record.corr.itemId === itemId &&
        JSON.stringify(record.data).includes(expected),
    );
    assert.ok(
      updated.length >= 1,
      `a state/item.updated record for ${itemId} carries the worktree path (G6: no new journal event)`,
    );
  }

  // --- off contrast ---------------------------------------------------------
  const off = buildWaveBench("off");
  await handleDispatchWave(waveInputFor(off, { [SUBMIT_TEST]: stopExecutor }));

  for (const itemId of ["I1", "I2"]) {
    assert.equal(
      off.store.loadItem(off.runId, itemId).worktree,
      null,
      `under \"off\", item.worktree stays null for ${itemId}`,
    );
  }
  assert.equal(
    existsSync(path.join(off.stateHome, "conductor", WKEY, "worktrees")),
    false,
    "under \"off\" nothing was created under the state home's worktrees path",
  );
  assert.equal(
    worktreeListPaths(off.workspace).length,
    1,
    "under \"off\" git lists exactly the main tree — no worktree git command ran at all",
  );
});

// ===========================================================================
// [9.6-registry-binds-worktree-scope]
// ===========================================================================

test("[9.6-registry-binds-worktree-scope] a wave member's sub-session dispatches carry tree = its worktree PATH into the §3.5 registry (pipeline-real: read off the fake SDK's registered-before-first-prompt snapshots during a real dispatch_wave), and the edit gate then scopes edits to that tree: an edit under the session's own worktree with fileScope src/** is ALLOWED, while the same relative path in the MAIN tree and in a sibling item's worktree is DENIED for that session", async () => {
  // Part A — the pipeline binding. No injected executors: the committed submit-test stage
  // dispatches for real; the responder answers garbage so each member stops after its
  // dispatch, leaving the registry snapshots as the evidence.
  const bench = buildWaveBench("worktrees");
  bench.sdk.setResponder(() => ({ kind: "reply", text: "THIS-IS-NOT-JSON-9006" }));

  await handleDispatchWave(waveInputFor(bench));

  const wt1 = wtPathOf(bench.stateHome, bench.runId, "I1");
  const wt2 = wtPathOf(bench.stateHome, bench.runId, "I2");
  assert.equal(bench.store.loadItem(bench.runId, "I1").worktree, wt1, "premise: I1's worktree was persisted");
  assert.equal(bench.store.loadItem(bench.runId, "I2").worktree, wt2, "premise: I2's worktree was persisted");

  for (const [itemId, wt] of [
    ["I1", wt1],
    ["I2", wt2],
  ] as Array<[string, string]>) {
    const prompts = bench.sdk.prompts.filter((p) => p.entryAtStart?.itemId === itemId);
    assert.ok(prompts.length > 0, `premise: ${itemId}'s member dispatched at least one sub-session prompt`);
    for (const prompt of prompts) {
      assert.equal(prompt.registeredAtStart, true, "the session was registered before its first prompt (§3.5)");
      assert.equal(
        prompt.entryAtStart?.tree,
        wt,
        `${itemId}'s registry entry carries its WORKTREE PATH as the tree — never "main", never a sibling's tree`,
      );
    }
  }

  // Part B — the gate scoping over those registry entries. Same relative path, three trees,
  // one session: only the session's own tree admits the edit (tree-relative normalization,
  // §3.5:1409-1413 — never false-denied although the worktree lives under the state home).
  const journal = makeRecorder();
  const covered = path.join("src", "i1", "covered.mjs");
  const base: Omit<EditAttempt, "editPath"> = {
    runId: bench.runId,
    journal: journal.sink,
    sessionID: "ses_impl_i1",
    role: "implementer",
    itemId: "I1",
    tree: wt1,
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    verifyInFlightTree: null,
  };

  const own = attemptEdit({ ...base, editPath: path.join(wt1, covered) });
  assert.equal(own.allowed, true, "an edit under the session's OWN worktree, inside fileScope, is allowed");

  const mainTree = attemptEdit({ ...base, editPath: path.join(bench.workspace, covered) });
  assert.equal(mainTree.allowed, false, "the same relative path in the MAIN tree is denied for that session");

  const sibling = attemptEdit({ ...base, editPath: path.join(wt2, covered) });
  assert.equal(sibling.allowed, false, "and in a SIBLING item's worktree it is denied too");
});

// ===========================================================================
// [9.6-verify-in-worktree]
// ===========================================================================

test("[9.6-verify-in-worktree] evidence.runVerify for a worktree item runs with cwd = the worktree and tree = the item id: the §2.6 record carries the WORKTREE's head and branch (not the workspace's), tree \"<itemId>\", and the per-tree marker live during the run is exactly verify-running-<itemId>.json — Task 6.1 machinery reused, not reimplemented", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runDir = freshDir("conductor-96-rundir-");
  const obsHome = freshDir("conductor-96-obs-");
  const runId = "r-96-verify";

  const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));

  // Advance the WORKTREE's HEAD so its head/branch are distinguishable from the workspace's.
  writeFileSync(path.join(wt, "tweak.txt"), "worktree-local change\n");
  git(wt, ["add", "tweak.txt"]);
  git(wt, ["commit", "-m", "worktree tweak"]);
  const wtHead = mustHead(wt);
  const wsHead = mustHead(workspace);
  assert.notEqual(wtHead, wsHead, "premise: the worktree HEAD differs from the workspace HEAD");

  const obsFile = path.join(obsHome, "markers-seen.json");
  const config = makeConfig({ command: markerObserverCmd(runDir, obsFile) });
  const journal = createJournal(runDir, config, {});

  const outcome = runVerify(runDir, "I1", config, "src/anything.mjs", {
    cwd: wt,
    tree: "I1",
    journal,
    stateHome,
    workspaceKey: WKEY,
    runId,
  });
  assert.equal(outcome.refused, false, "the worktree verify ran");
  if (outcome.refused) return;

  assert.equal(outcome.record.tree, "I1", "the §2.6 record's tree is the ITEM-ID SLUG");
  assert.equal(outcome.record.head, wtHead, "the record's head is the WORKTREE's HEAD");
  assert.notEqual(outcome.record.head, wsHead, "and not the workspace's");
  assert.equal(outcome.record.branch, wtBranchOf(runId, "I1"), "the record's branch is the worktree's conductor branch");
  assert.equal(outcome.record.green, true, "the observer scope command exited 0");

  // The per-tree marker, observed LIVE by the scope command itself.
  const seen = JSON.parse(readFileSync(obsFile, "utf8")) as string[];
  assert.deepEqual(
    seen,
    ["verify-running-I1.json"],
    "while the verify ran, exactly the per-item marker was live — verify-running-<itemId>.json, and no main marker",
  );
  assert.equal(
    existsSync(markerFileOf(runDir, "I1")),
    false,
    "the marker is removed when the verify completes",
  );
});

// ===========================================================================
// [9.6-tree-identity-slug-to-path]
// ===========================================================================

test("[9.6-tree-identity-slug-to-path] C-037 ruling 5, the slug/path bridge: verifyInFlightTreeFor maps the live marker's SLUG to the PATH the gate compares — \"main\" -> the workspace root, \"<itemId>\" -> the persisted item.worktree, null worktree -> nothing to freeze. End-to-end: with a live verify-running-I1.json and a session whose tree is I1's worktree PATH, the gate DENIES every edit in that session; feeding the RAW SLUG through instead leaves the session UNFROZEN (the defect this row exists to prevent); and markerPathOf still refuses a path-shaped tree — assertSafeId is NOT relaxed", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig({ writes: "worktrees" });
  const journal = makeRecorder();
  const store = openStore(workspace, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);

  const wt1 = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  const i1 = makeRuntimeItem("I1", "RED");
  i1.worktree = wt1;
  store.saveItem(runId, i1);
  store.saveItem(runId, makeRuntimeItem("I3", "PENDING")); // worktree null

  // The derivation, all three arms.
  assert.equal(treeForFn(store, runId, "main"), workspace, '"main" translates to the workspace root');
  assert.equal(treeForFn(store, runId, "I1"), wt1, "an item slug translates to the item's persisted worktree path");
  assert.equal(treeForFn(store, runId, "I3"), null, "an item with no worktree yields null — no path can be frozen for it");

  // End-to-end through the committed gate. The slug is read OFF THE LEDGER (the marker
  // filename), exactly as the wiring layer will read it.
  writeFileSync(markerFileOf(runDir, "I1"), JSON.stringify({ pid: process.pid, startMs: Date.now() }));
  const slugs = liveMarkerSlugs(runDir);
  assert.deepEqual(slugs, ["I1"], "premise: exactly one live marker, and its slug is the item id");
  const translated = treeForFn(store, runId, slugs[0]);
  assert.equal(translated, wt1, "the live marker's slug translates to I1's worktree path");

  const base: Omit<EditAttempt, "editPath" | "verifyInFlightTree" | "role" | "testScope"> = {
    runId,
    journal: journal.sink,
    sessionID: "ses_impl_i1",
    itemId: "I1",
    tree: wt1,
    fileScope: ["src/**"],
  };
  const srcEdit = path.join(wt1, "src", "i1", "mod.mjs");
  const testEdit = path.join(wt1, "tests", "i1.test.mjs");

  // Premise: with no verify in flight the very same edit is allowed — so the denial below
  // is attributable to the freeze and nothing else.
  const unfrozen = attemptEdit({
    ...base,
    role: "implementer",
    testScope: ["tests/**"],
    editPath: srcEdit,
    verifyInFlightTree: null,
  });
  assert.equal(unfrozen.allowed, true, "premise: without a live verify the edit is in scope and allowed");

  // TRANSLATED: the session is frozen — every edit denied, source and test alike (§3.5 strict).
  const frozenSrc = attemptEdit({
    ...base,
    role: "implementer",
    testScope: ["tests/**"],
    editPath: srcEdit,
    verifyInFlightTree: translated,
  });
  assert.equal(frozenSrc.allowed, false, "with the TRANSLATED path fed to the gate, the source edit is denied");
  assert.match(frozenSrc.reason, /verify|freeze/i, "and the denial names the freeze");

  const frozenTest = attemptEdit({
    ...base,
    role: "test-writer",
    testScope: ["tests/**"],
    editPath: testEdit,
    verifyInFlightTree: translated,
  });
  assert.equal(frozenTest.allowed, false, "the strict reading: a test edit in the frozen tree is denied too");

  // RAW SLUG: the defect. The gate compares paths by string equality, so "I1" never equals
  // the session's tree and the session is silently UNFROZEN — this is exactly what the
  // translation exists to prevent.
  const rawSlug = attemptEdit({
    ...base,
    role: "implementer",
    testScope: ["tests/**"],
    editPath: srcEdit,
    verifyInFlightTree: slugs[0],
  });
  assert.equal(
    rawSlug.allowed,
    true,
    "feeding the RAW SLUG through leaves the session unfrozen — the committed gate compares path strings, so the wiring MUST translate",
  );

  // The other side of the bridge is NOT relaxed: the evidence layer still refuses a
  // path-shaped tree (assertSafeId inside markerPathOf).
  assert.throws(
    () =>
      runVerify(runDir, "I1", config, "src/anything.mjs", {
        cwd: workspace,
        tree: wt1,
        journal: createJournal(runDir, config, {}),
        stateHome,
        workspaceKey: WKEY,
        runId,
      }),
    /refusing.*tree/,
    "markerPathOf still refuses a path-shaped tree — the slug stays authoritative for the marker",
  );

  rmSync(markerFileOf(runDir, "I1"), { force: true });
});

// ===========================================================================
// [9.6-cross-tree-freeze-independence]
// ===========================================================================

test("[9.6-cross-tree-freeze-independence] a LIVE verify marker in tree A does not freeze tree B: while A's marker is live the gate denies EVERY edit in A (source and test alike, §3.5:1396-1401 strict) but ALLOWS a B-scoped edit in B, and the fan-out TreeState admission dispatches B's write-capable job immediately while holding A's until the marker clears", async () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig({ writes: "worktrees" });
  const journal = makeRecorder();
  const store = openStore(workspace, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);

  const wt1 = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  const wt2 = createWorktreeFn(workspace, runId, "I2", ctxFor(stateHome));
  const i1 = makeRuntimeItem("I1", "RED");
  i1.worktree = wt1;
  store.saveItem(runId, i1);
  const i2 = makeRuntimeItem("I2", "RED");
  i2.worktree = wt2;
  store.saveItem(runId, i2);

  // A's verify is in flight.
  writeFileSync(markerFileOf(runDir, "I1"), JSON.stringify({ pid: process.pid, startMs: Date.now() }));
  const frozenPath = treeForFn(store, runId, liveMarkerSlugs(runDir)[0]);
  assert.equal(frozenPath, wt1, "premise: the live marker translates to A's worktree path");

  // Gate half: A frozen (source AND test), B free.
  const denyA = attemptEdit({
    runId,
    journal: journal.sink,
    sessionID: "ses_impl_a",
    role: "implementer",
    itemId: "I1",
    tree: wt1,
    editPath: path.join(wt1, "src", "i1", "mod.mjs"),
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    verifyInFlightTree: frozenPath,
  });
  assert.equal(denyA.allowed, false, "a source edit in tree A is denied while A's marker is live");

  const denyATest = attemptEdit({
    runId,
    journal: journal.sink,
    sessionID: "ses_test_a",
    role: "test-writer",
    itemId: "I1",
    tree: wt1,
    editPath: path.join(wt1, "tests", "i1.test.mjs"),
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    verifyInFlightTree: frozenPath,
  });
  assert.equal(denyATest.allowed, false, "so is a test edit — the strict per-tree reading");

  const allowB = attemptEdit({
    runId,
    journal: journal.sink,
    sessionID: "ses_impl_b",
    role: "implementer",
    itemId: "I2",
    tree: wt2,
    editPath: path.join(wt2, "src", "i2", "mod.mjs"),
    fileScope: ["src/**"],
    testScope: ["tests/**"],
    verifyInFlightTree: frozenPath,
  });
  assert.equal(allowB.allowed, true, "a B-scoped edit in tree B is ALLOWED — A's marker does not freeze B");

  // Fan-out admission half: the engine over a marker-backed TreeState keyed by the SAME
  // translation. B's write-capable job is admitted immediately; A's is held until the
  // marker clears.
  const registry = new Map<string, FanoutRegistryEntry>();
  const sdk = makeFakeSdk({ registry });
  sdk.setResponder(() => ({ kind: "reply", text: JSON.stringify(IMPL_RESULT) }));
  const listeners: Array<(tree: string) => void> = [];
  const treeState: TreeState = {
    isFrozen(tree: string): boolean {
      return liveMarkerSlugs(runDir).some((slug) => treeForFn(store, runId, slug) === tree);
    },
    onClear(listener: (tree: string) => void): () => void {
      listeners.push(listener);
      return (): void => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
  const fanout = createFanout(
    sdk.client,
    config,
    journal.sink as unknown as Parameters<typeof createFanout>[2],
    registry,
    treeState,
    runId,
  );
  const jobFor = (itemId: string, tree: string): FanoutJob => ({
    role: "implementer",
    itemId,
    tree,
    writeCapable: true,
    prompt: `implement ${itemId}`,
    schemaName: "ImplementerResult",
    priority: "implementer",
  });

  const resB = await fanout.dispatch(jobFor("I2", wt2));
  assert.equal(resB.error, undefined, "B's write-capable job dispatched and completed while A was frozen");
  assert.ok(resB.value !== undefined, "and returned a validated receipt — it was never held");

  const createsBefore = sdk.creates.length;
  const heldA = fanout.dispatch(jobFor("I1", wt1));
  await turns(8);
  assert.equal(
    sdk.creates.length,
    createsBefore,
    "A's write-capable job is HELD out of the frozen tree — no session was even created for it",
  );

  rmSync(markerFileOf(runDir, "I1"), { force: true });
  for (const listener of [...listeners]) listener(wt1);
  const resA = await heldA;
  assert.ok(resA.value !== undefined, "clearing A's marker releases the held job, which then completes");
});

// ===========================================================================
// [9.6-publish-cwd-worktree]
// ===========================================================================

test("[9.6-publish-cwd-worktree] conductor_publish under worktree mode runs the §3.3 sequence with cwd = item.worktree: the branch check rests on the WORKTREE's verify record, the commit lands on conductor/<runId>/<itemId>, the workspace never gains a commit of its own (its only movement is the merge-back fast-forward), its branch stays \"main\" and its index stays empty, and the staged set is exactly fileScope ∪ testScope", async () => {
  const bench = buildPublishBench([{ id: "I1" }]);
  const wt = wtOf(bench, "I1");
  const rels = relsOf("I1");

  assert.equal(mustHead(wt), bench.h0, "premise: worktree and workspace share HEAD before publish");
  assert.equal(
    existsSync(path.join(bench.workspace, rels.implRel)),
    false,
    "premise: the item's new source file exists only in the worktree",
  );

  const result: PublishResult = await handlePublish(publishInputFor(bench, "I1"));

  assert.equal(result.ok, true, `publish succeeded (denial: ${String(result.denial)})`);
  assert.equal(result.itemState, "PUBLISHED", "the item reached PUBLISHED");
  assert.deepEqual(
    [...result.staged].sort(),
    [rels.implRel, rels.testRel].sort(),
    "exactly fileScope ∪ testScope was staged",
  );

  // The commit landed on the WORKTREE's branch.
  const wtHead = mustHead(wt);
  assert.notEqual(wtHead, bench.h0, "the worktree HEAD advanced — the commit was made there");
  assert.equal(currentBranch(wt), wtBranchOf(bench.runId, "I1"), "on the conductor/<runId>/<itemId> branch");
  assert.equal(result.commit, wtHead, "the result names that commit");
  assert.equal(
    gitOut(wt, ["rev-parse", "HEAD~1"]),
    bench.h0,
    "the publish commit's parent is the seed — one commit, made in the worktree",
  );

  // The workspace: its ONLY movement is the merge-back. A fast-forward to the worktree's
  // tip means the workspace never gained a commit of its own — the exact-two-commit
  // history is the proof the publish sequence itself ran elsewhere.
  assert.equal(currentBranch(bench.workspace), "main", "the workspace stayed on its own branch");
  assert.equal(mustHead(bench.workspace), wtHead, "the workspace integrated by fast-forwarding to the worktree tip");
  assert.deepEqual(
    commitShas(bench.workspace),
    [wtHead, bench.h0],
    "the workspace history is exactly [the worktree commit, the seed] — no workspace-side commit ever happened",
  );
  assert.deepEqual(stagedFiles(bench.workspace), [], "the workspace index stayed empty — staging happened in the worktree");
  const dirt = dirtyFiles(bench.workspace);
  assert.deepEqual(dirt.trackedModified, [], "no tracked file was left modified in the workspace");
  assert.equal(
    existsSync(path.join(bench.workspace, rels.implRel)),
    true,
    "the merged source file arrived in the workspace through the merge, not through a workspace edit",
  );
  assert.equal(mergeHeadExists(bench.workspace), false, "no merge is left in flight");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "the persisted item agrees");
});

// ===========================================================================
// [9.6-publish-worktree-message-denylist]
// ===========================================================================

test("[9.6-publish-worktree-message-denylist] worktree mode changes the cwd, never the commit discipline: the message is the pure core template's output verbatim (zero model dispatches on the fake SDK), and the §3.3 trailer denylist refuses the worktree commit exactly as in the main tree — case-insensitive Co-Authored-By and the U+1F916 token both leave worktree AND workspace without a commit and the item at REVIEWED", async () => {
  // (a) the clean publish: the template's own output, no model anywhere near it.
  const clean = buildPublishBench([{ id: "I1" }]);
  const expected = buildCommitMessage(clean.queue.items[0], null);

  const okResult = await handlePublish(publishInputFor(clean, "I1"));
  assert.equal(okResult.ok, true, "premise: the clean publish succeeds");
  assert.equal(okResult.message, expected, "the commit message is the PURE core template output, verbatim");
  assert.equal(
    gitOut(wtOf(clean, "I1"), ["log", "-1", "--format=%B"]).trim(),
    expected.trim(),
    "and the worktree commit carries exactly that message",
  );
  assert.equal(clean.sdk.calls.length, 0, "ZERO model dispatches: the fake SDK saw no traffic at all");

  // (b) the denylist, enforced on the worktree commit. Two tokens, case-varied and the
  // robot emoji; each refusal is total — no commit in either tree, item still REVIEWED.
  const badBuilders: Array<{ label: string; build: (item: QueueItem) => string }> = [
    {
      label: "case-varied Co-Authored-By",
      build: (item) => buildCommitMessage(item, null) + "\nco-authored-BY: Robot <robot@example.invalid>",
    },
    {
      label: "the U+1F916 token",
      build: (item) => buildCommitMessage(item, null) + "\nshipped with \u{1F916} assistance",
    },
  ];
  const bench = buildPublishBench([{ id: "I1" }]);
  const wt = wtOf(bench, "I1");
  for (const bad of badBuilders) {
    const refused = await handlePublish(
      publishInputFor(bench, "I1", { messageBuilder: (item) => bad.build(item) }),
    );
    assert.equal(refused.ok, false, `${bad.label}: the publish is refused`);
    assert.match(
      refused.denial ?? "",
      /denylisted trailer token/i,
      `${bad.label}: the denial names the denylist rule`,
    );
    assert.equal(refused.commit, null, `${bad.label}: no commit was reported`);
    assert.equal(mustHead(wt), bench.h0, `${bad.label}: the WORKTREE gained no commit`);
    assert.equal(mustHead(bench.workspace), bench.h0, `${bad.label}: the workspace gained no commit either`);
    assert.equal(
      bench.store.loadItem(bench.runId, "I1").state,
      "REVIEWED",
      `${bad.label}: the item stays REVIEWED`,
    );
  }
});

// ===========================================================================
// [9.6-mergeback-branch-identity]
// ===========================================================================

test("[9.6-mergeback-branch-identity] mergeBack recomposes conductor/<runId>/<itemId> with the same pure name rule createWorktree used and VERIFIES it against the worktree's checked-out branch before any merge: a renamed branch is REFUSED (the error names the expected branch) with NO merge attempted, and after restoring the branch the same call integrates cleanly", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runId = "r-96-ident";
  const h0 = mustHead(workspace);

  const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  writeFileSync(path.join(wt, "delta.txt"), "worktree change\n");
  git(wt, ["add", "delta.txt"]);
  git(wt, ["commit", "-m", "worktree change"]);
  const c1 = mustHead(wt);

  // Rename the checked-out branch out from under the composed name.
  git(wt, ["switch", "-c", "renamed-9006"]);
  assert.equal(currentBranch(wt), "renamed-9006", "premise: the worktree is on a foreign branch");

  assert.throws(
    () => mergeBackFn(workspace, runId, "I1", ctxFor(stateHome)),
    new RegExp(`conductor/${runId}/I1`),
    "the refusal names the branch it expected, so a renamed or stale branch is never merged silently",
  );
  assert.equal(mustHead(workspace), h0, "NO merge was attempted — the workspace HEAD did not move");
  assert.equal(mergeHeadExists(workspace), false, "and no merge was left in flight");

  // Restore the identity; the same call now integrates.
  git(wt, ["switch", wtBranchOf(runId, "I1")]);
  const merged = mergeBackFn(workspace, runId, "I1", ctxFor(stateHome));
  assert.deepEqual(merged, { ok: true, conflict: false }, "with the branch identity restored the merge-back succeeds");
  assert.equal(mustHead(workspace), c1, "the workspace fast-forwarded to the worktree commit");
});

// ===========================================================================
// [9.6-mergeback-ff-first-else-merge]
// ===========================================================================

test("[9.6-mergeback-ff-first-else-merge] ff-only is attempted FIRST and a normal merge is only the fallback (§4.2:1613), asserted on the resulting history shape: an unadvanced workspace integrates as a fast-forward with NO merge commit; a workspace that advanced with a disjoint commit falls back to exactly ONE merge commit whose parents are the two tips", () => {
  // (a) fast-forward: the workspace has not advanced since the worktree was created.
  const ffWorkspace = committedRepo();
  const ffState = freshStateHome();
  const ffRun = "r-96-ff";
  const ffH0 = mustHead(ffWorkspace);
  const ffWt = createWorktreeFn(ffWorkspace, ffRun, "I1", ctxFor(ffState));
  writeFileSync(path.join(ffWt, "one.txt"), "one\n");
  git(ffWt, ["add", "one.txt"]);
  git(ffWt, ["commit", "-m", "one"]);
  const ffC1 = mustHead(ffWt);

  assert.deepEqual(mergeBackFn(ffWorkspace, ffRun, "I1", ctxFor(ffState)), { ok: true, conflict: false });
  assert.equal(mustHead(ffWorkspace), ffC1, "the workspace HEAD IS the worktree commit — a fast-forward");
  assert.equal(
    gitOut(ffWorkspace, ["rev-list", "--count", "--merges", "HEAD"]),
    "0",
    "NO merge commit exists: ff-only was attempted first and sufficed",
  );
  assert.deepEqual(commitShas(ffWorkspace), [ffC1, ffH0], "the history is linear");

  // (b) fallback: the workspace advanced with a DISJOINT-scope commit.
  const mgWorkspace = committedRepo();
  const mgState = freshStateHome();
  const mgRun = "r-96-merge";
  const mgWt = createWorktreeFn(mgWorkspace, mgRun, "I1", ctxFor(mgState));
  writeFileSync(path.join(mgWt, "one.txt"), "one\n");
  git(mgWt, ["add", "one.txt"]);
  git(mgWt, ["commit", "-m", "one"]);
  const mgC1 = mustHead(mgWt);

  mkdirSync(path.join(mgWorkspace, "docs"), { recursive: true });
  writeFileSync(path.join(mgWorkspace, "docs", "note.md"), "advanced\n");
  git(mgWorkspace, ["add", "docs/note.md"]);
  git(mgWorkspace, ["commit", "-m", "workspace advanced"]);
  const w1 = mustHead(mgWorkspace);

  assert.deepEqual(mergeBackFn(mgWorkspace, mgRun, "I1", ctxFor(mgState)), { ok: true, conflict: false });
  assert.equal(
    gitOut(mgWorkspace, ["rev-list", "--count", "--merges", "HEAD"]),
    "1",
    "exactly ONE merge commit: the normal merge is the FALLBACK, not the first resort",
  );
  const head = mustHead(mgWorkspace);
  assert.equal(gitOut(mgWorkspace, ["rev-parse", `${head}^1`]), w1, "first parent: the workspace's advanced tip");
  assert.equal(gitOut(mgWorkspace, ["rev-parse", `${head}^2`]), mgC1, "second parent: the worktree branch tip");
  assert.equal(existsSync(path.join(mgWorkspace, "one.txt")), true, "the worktree change arrived");
  assert.equal(existsSync(path.join(mgWorkspace, "docs", "note.md")), true, "and the workspace change survived");

  // (c) ORCHESTRATOR ADDITION (C-052). Halves (a) and (b) pin the resulting
  // HISTORY SHAPE, and under git's default merge.ff a single plain `git merge`
  // produces exactly those shapes — so collapsing the two-step sequence into one
  // merge passed all 21 rows. The rule §4.2:1613 states is about the SEQUENCE,
  // and the configuration that separates them is merge.ff=false, under which a
  // plain merge mints a merge commit even where a fast-forward was possible.
  //
  // This is not hypothetical: merge.ff=false is a common repo-level setting for
  // teams that want every integration recorded. Under it, a router that skipped
  // the ff-only attempt would rewrite a linear item integration into a merge
  // commit, and §4.2's serial merge-back would litter the history it was
  // designed to keep readable.
  const ffcWorkspace = committedRepo();
  const ffcState = freshStateHome();
  const ffcRun = "r-96-ff-config";
  git(ffcWorkspace, ["config", "merge.ff", "false"]);
  assert.equal(gitOut(ffcWorkspace, ["config", "merge.ff"]), "false", "premise: this repo forbids implicit fast-forwards");

  const ffcH0 = mustHead(ffcWorkspace);
  const ffcWt = createWorktreeFn(ffcWorkspace, ffcRun, "I1", ctxFor(ffcState));
  writeFileSync(path.join(ffcWt, "one.txt"), "one\n");
  git(ffcWt, ["add", "one.txt"]);
  git(ffcWt, ["commit", "-m", "one"]);
  const ffcC1 = mustHead(ffcWt);

  assert.deepEqual(mergeBackFn(ffcWorkspace, ffcRun, "I1", ctxFor(ffcState)), { ok: true, conflict: false });
  assert.equal(
    gitOut(ffcWorkspace, ["rev-list", "--count", "--merges", "HEAD"]),
    "0",
    "STILL no merge commit: --ff-only was attempted FIRST, so the repo's merge.ff=false never applied",
  );
  assert.equal(mustHead(ffcWorkspace), ffcC1, "the workspace HEAD IS the worktree commit");
  assert.deepEqual(commitShas(ffcWorkspace), [ffcC1, ffcH0], "the history is linear despite merge.ff=false");
});

// ===========================================================================
// [9.6-mergeback-serial-item-order]
// ===========================================================================

test("[9.6-mergeback-serial-item-order] merge-back is serial in ITEM ORDER (§4.2:1613, §4.3:1627 — the workspace index is a singleton): publishing a two-item disjoint-scope wave in item order leaves BOTH items' commits reachable from the workspace branch, and git's own ordered ref-update log (the reflog) shows I1's integration strictly before I2's, with no merge in flight afterwards — the committed driver already serializes the publish stage (9.4c), so per-call synchronous merge-back makes overlapping merges impossible by construction", async () => {
  const bench = buildPublishBench([{ id: "I1" }, { id: "I2" }]);

  // Item order is wave order — the same order the driver's serial publish stage uses.
  const first = await handlePublish(publishInputFor(bench, "I1"));
  assert.equal(first.ok, true, `premise: I1 published (denial: ${String(first.denial)})`);
  const c1 = mustHead(wtOf(bench, "I1"));

  const second = await handlePublish(publishInputFor(bench, "I2"));
  assert.equal(second.ok, true, `premise: I2 published (denial: ${String(second.denial)})`);
  const c2 = mustHead(wtOf(bench, "I2"));

  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "I1 is PUBLISHED");
  assert.equal(bench.store.loadItem(bench.runId, "I2").state, "PUBLISHED", "I2 is PUBLISHED");

  // Both commits are reachable from the workspace branch.
  assert.equal(isAncestor(bench.workspace, c1), true, "I1's commit is reachable from the workspace branch");
  assert.equal(isAncestor(bench.workspace, c2), true, "I2's commit is reachable from the workspace branch");
  assert.equal(
    existsSync(path.join(bench.workspace, relsOf("I1").implRel)) &&
      existsSync(path.join(bench.workspace, relsOf("I2").implRel)),
    true,
    "both items' files are present in the integrated tree",
  );

  // The ordered command log: git's reflog records every ref update in order (newest
  // first). I2's integration must sit ABOVE I1's, and each merge completed before the
  // next began (no MERGE_HEAD survives).
  const reflog = gitOut(bench.workspace, ["reflog", "--format=%gs"]).split("\n");
  const integrations = reflog.filter((line) => line.includes(`conductor/${bench.runId}/`));
  assert.equal(integrations.length, 2, "exactly two integrations touched the workspace ref");
  assert.ok(
    integrations[0].includes("/I2") && integrations[1].includes("/I1"),
    `the reflog orders the merges in ITEM ORDER — I1 then I2 (newest first saw: ${integrations.join(" | ")})`,
  );
  assert.equal(mergeHeadExists(bench.workspace), false, "no merge is in flight after the batch");
  const dirt = dirtyFiles(bench.workspace);
  assert.deepEqual(dirt.trackedModified, [], "the workspace tree is clean after the serial batch");
});

// ===========================================================================
// [9.6-mergeback-handler-argv]
// ===========================================================================

test("[9.6-mergeback-handler-argv] every worktree/merge git operation is HANDLER-executed through execFileSync argv arrays under the GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE scrub — never a shell string, and never a model session (the committed git gate denies a session's merge/commit/push) — and a clean integration returns EXACTLY {ok:true, conflict:false}: a poisoned GIT_DIR in the live environment cannot redirect the writes", () => {
  // Source discipline (the gitio module contract, restated for the new module): argv
  // execFileSync, no shell strings, and the repo-location scrub by name.
  const src = readFileSync(WORKTREES_SRC, "utf8");
  assert.match(src, /execFileSync/, "worktrees.ts runs git through execFileSync argv arrays");
  assert.doesNotMatch(src, /\bexecSync\s*\(/, "no shell-string execSync anywhere");
  assert.doesNotMatch(src, /shell\s*:\s*true/, "no shell:true spawn option anywhere");
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    assert.ok(src.includes(name), `the env scrub names ${name} (the gitio discipline)`);
  }

  // The model-session route is CLOSED by the committed core gate: merge-back writes exist
  // only because the handler performs them directly.
  for (const command of ["git merge conductor/r-96-argv/I1", "git commit -m x", "git push"]) {
    assert.equal(
      decideGit(command, "implementer", "commit", true, "pin").action,
      "deny",
      `core/gates-git denies a session's \`${command}\` — the handler is the only executor`,
    );
  }

  // Live half: a poisoned GIT_DIR/GIT_WORK_TREE in process.env must not redirect the
  // subject's git children (the scrub, exercised rather than trusted).
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runId = "r-96-argv";
  const bogus = path.join(stateHome, "not-a-repo-anywhere");
  process.env.GIT_DIR = bogus;
  process.env.GIT_WORK_TREE = bogus;
  try {
    const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
    writeFileSync(path.join(wt, "delta.txt"), "scrubbed\n");
    git(wt, ["add", "delta.txt"]);
    git(wt, ["commit", "-m", "scrubbed"]);
    const merged = mergeBackFn(workspace, runId, "I1", ctxFor(stateHome));
    assert.deepEqual(
      merged,
      { ok: true, conflict: false },
      "a clean integration returns EXACTLY {ok:true, conflict:false} — and the poisoned GIT_DIR never reached git",
    );
    assert.equal(existsSync(path.join(workspace, "delta.txt")), true, "the merge landed in the intended workspace");
  } finally {
    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;
  }
});

// ===========================================================================
// [9.6-postmerge-revalidate-integrated]
// ===========================================================================

test("[9.6-postmerge-revalidate-integrated] after merge-back the item re-validates against the INTEGRATED tree before PUBLISHED: the fixture's verify command writes a witness into its cwd, and after publish the witness exists in the WORKSPACE and not in the worktree, the §2.6 record carries tree \"main\" with the post-merge head — and when the integrated tree is red the item does NOT reach PUBLISHED: a green in isolation is not a green in company", async () => {
  // (a) the green path: the integrated-tree verify provably ran in the workspace.
  const bench = buildPublishBench([{ id: "I1" }]);
  const wt = wtOf(bench, "I1");
  const witnessConfig = makeConfig({ writes: "worktrees", command: WITNESS_CMD });

  const result = await handlePublish(publishInputFor(bench, "I1", { config: witnessConfig }));
  assert.equal(result.ok, true, `publish succeeded (denial: ${String(result.denial)})`);
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "the item is PUBLISHED");

  assert.equal(
    existsSync(path.join(bench.workspace, WITNESS_REL)),
    true,
    "the verify command executed with cwd = the WORKSPACE — the witness is there",
  );
  assert.equal(
    existsSync(path.join(wt, WITNESS_REL)),
    false,
    "and NOT in the worktree: the fresh worktree record needed no re-verify, so the only execution was the integrated one",
  );
  const witnessed = readFileSync(path.join(bench.workspace, WITNESS_REL), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => (JSON.parse(line) as { cwd: string }).cwd);
  assert.deepEqual(witnessed, [bench.workspace], "the witness records exactly one execution, in the workspace");

  const mains = verifyRecords(bench.runDir).filter((record) => record.tree === "main");
  assert.equal(mains.length, 1, "exactly one integrated-tree (§2.6 tree \"main\") verify record was appended");
  assert.equal(mains[0].green, true, "it is green");
  assert.equal(mains[0].itemId, "I1", "and it belongs to the published item");
  assert.equal(
    mains[0].head,
    mustHead(bench.workspace),
    "its head is the POST-MERGE workspace head — the verify judged the integrated tree, not the pre-merge one",
  );

  // (b) the red contrast: poison the WORKSPACE only. The worktree stays green in
  // isolation; the integrated tree is red; PUBLISHED must not be reached.
  const red = buildPublishBench([{ id: "I1" }]);
  writeFileSync(path.join(red.workspace, POISON_REL), "the integrated tree is red\n");

  const refused = await handlePublish(publishInputFor(red, "I1", { config: witnessConfig }));
  assert.equal(refused.ok, false, "the publish reports failure when the integrated tree is red");
  assert.notEqual(
    red.store.loadItem(red.runId, "I1").state,
    "PUBLISHED",
    "the item did NOT reach PUBLISHED without an integrated-tree green",
  );
  const redMains = verifyRecords(red.runDir).filter((record) => record.tree === "main");
  assert.equal(redMains.length, 1, "the integrated-tree verify record exists");
  assert.equal(redMains[0].green, false, "and it is red — the refusal rests on evidence, not on a hunch");
  // The merge itself STANDS (the 9.5b push-failure precedent: conductor never pretends
  // git history away); it is the ITEM that is held back.
  assert.equal(
    isAncestor(red.workspace, mustHead(wtOf(red, "I1"))),
    true,
    "the completed merge stands in the workspace",
  );
});

// ===========================================================================
// [9.6-conflict-demotes-green]
// ===========================================================================

test("[9.6-conflict-demotes-green] a contrived overlapping edit makes the LATER item's merge conflict: publish returns ok:false, the item is demoted REVIEWED->GREEN through the SHARED 9.5b helper — the persisted item shows GREEN with the debugging annotation set, the journal carries `state: item.updated` with from \"REVIEWED\" and ZERO fsm records for that write (the FSM has no backward edge) — and the EARLIER item's completed merge still stands", async () => {
  const bench = buildPublishBench([
    { id: "I1", sharedEdit: `from I1 (${SHARED_MARKER})\n` },
    { id: "I2", sharedEdit: `from I2 (${SHARED_MARKER})\n` },
  ]);

  const first = await handlePublish(publishInputFor(bench, "I1"));
  assert.equal(first.ok, true, `premise: I1 published cleanly (denial: ${String(first.denial)})`);
  const c1 = mustHead(wtOf(bench, "I1"));

  const fsmBefore = bench.journal.records.filter((record) => record.component === "fsm").length;
  const second = await handlePublish(publishInputFor(bench, "I2"));

  assert.equal(second.ok, false, "the conflicting later publish reports failure");
  const i2 = bench.store.loadItem(bench.runId, "I2");
  assert.equal(i2.state, "GREEN", "the later item is demoted to GREEN for re-validation");
  assert.notEqual(i2.debugging, null, "with the debugging annotation set — the shared helper's signature write");

  // The demotion is the SHARED helper's administrative write: `state: item.updated` with
  // from REVIEWED, and NEVER an fsm transition (C-037 ruling 7).
  const demotions = bench.journal.records.filter(
    (record) =>
      record.component === "state" &&
      record.event === "item.updated" &&
      record.corr.itemId === "I2" &&
      record.data.state === "GREEN" &&
      record.data.from === "REVIEWED",
  );
  assert.equal(demotions.length, 1, "exactly one item.updated record carries the REVIEWED->GREEN drop");
  assert.equal(demotions[0].data.debugging, true, "and it flags the armed debug protocol — the helper's exact shape");
  const fsmGreen = bench.journal.records
    .slice(fsmBefore)
    .filter((record) => record.component === "fsm" && record.data.to === "GREEN");
  assert.equal(fsmGreen.length, 0, "ZERO fsm records for the demotion — no backward edge was invented");

  // The earlier item's integration is untouched by the later conflict.
  assert.equal(isAncestor(bench.workspace, c1), true, "I1's merge still stands in the workspace");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "PUBLISHED", "and I1 stays PUBLISHED");
  assert.equal(
    readFileSync(path.join(bench.workspace, SHARED_REL), "utf8"),
    `from I1 (${SHARED_MARKER})\n`,
    "the workspace's shared file carries I1's content — I2's conflicting change was not half-applied",
  );
  assert.equal(mergeHeadExists(bench.workspace), false, "and no conflicted merge was left in flight");
});

// ===========================================================================
// [9.6-conflict-merge-abort-clean]
// ===========================================================================

test("[9.6-conflict-merge-abort-clean] the conflicting merge leaves the workspace USABLE: mergeBack runs `git merge --abort` before returning {ok:false, conflict:true}, so afterwards there is no MERGE_HEAD, the status is clean, no conflict markers remain in the tracked file, and a subsequent merge-back of an UNRELATED item succeeds in that same workspace", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const runId = "r-96-abort";

  // ALL worktrees branch from the same base commit BEFORE any merge-back runs — the wave
  // shape. A worktree created after I1's merge would branch from the post-merge HEAD and
  // its shared edit would never conflict (a bug this fixture's own stub run caught).
  const wt1 = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  const wt2 = createWorktreeFn(workspace, runId, "I2", ctxFor(stateHome));
  const wt3 = createWorktreeFn(workspace, runId, "I3", ctxFor(stateHome));

  // I1 and I2 rewrite the SAME committed line; I3 is disjoint.
  writeFileSync(path.join(wt1, SHARED_REL), "abort fixture: I1's line\n");
  git(wt1, ["add", SHARED_REL]);
  git(wt1, ["commit", "-m", "I1 shared edit"]);
  writeFileSync(path.join(wt2, SHARED_REL), "abort fixture: I2's line\n");
  git(wt2, ["add", SHARED_REL]);
  git(wt2, ["commit", "-m", "I2 shared edit"]);

  assert.deepEqual(mergeBackFn(workspace, runId, "I1", ctxFor(stateHome)), { ok: true, conflict: false });

  const conflicted = mergeBackFn(workspace, runId, "I2", ctxFor(stateHome));
  assert.deepEqual(conflicted, { ok: false, conflict: true }, "the overlapping merge reports EXACTLY {ok:false, conflict:true}");

  // The workspace is not poisoned: no in-flight merge, clean status, no markers.
  assert.equal(mergeHeadExists(workspace), false, "no MERGE_HEAD remains — the merge was aborted, not abandoned");
  const dirt = dirtyFiles(workspace);
  assert.deepEqual(
    { trackedModified: dirt.trackedModified, untracked: dirt.untracked },
    { trackedModified: [], untracked: [] },
    "git status is clean after the abort",
  );
  assert.deepEqual(stagedFiles(workspace), [], "nothing is left staged");
  const shared = readFileSync(path.join(workspace, SHARED_REL), "utf8");
  assert.equal(shared, "abort fixture: I1's line\n", "the tracked file carries the pre-conflict content");
  assert.equal(shared.includes("<<<<<<<"), false, "and no conflict markers survive anywhere in it");

  // A poisoned mid-merge tree would break every later merge; a clean one does not.
  mkdirSync(path.join(wt3, "docs"), { recursive: true });
  writeFileSync(path.join(wt3, "docs", "i3.md"), "unrelated I3 change\n");
  git(wt3, ["add", "docs/i3.md"]);
  git(wt3, ["commit", "-m", "I3 docs"]);
  assert.deepEqual(
    mergeBackFn(workspace, runId, "I3", ctxFor(stateHome)),
    { ok: true, conflict: false },
    "a subsequent unrelated merge-back succeeds in the SAME workspace",
  );
  assert.equal(existsSync(path.join(workspace, "docs", "i3.md")), true, "and its change arrived");
});

// ===========================================================================
// [9.6-archive-does-not-remove]
// ===========================================================================

test("[9.6-archive-does-not-remove] C-037 ruling 6, pinned as a regression: archiveRun clears the current-run pointer and removes NOTHING — after archiving, the run's worktree still appears in `git worktree list` and the <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/ directory still exists; removal belongs to removeWorktree under the run-lifecycle owner (Task 10.1), and state.ts gains no deletion behaviour", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig({ writes: "worktrees" });
  const journal = makeRecorder();
  const store = openStore(workspace, journal.sink, config);
  const runId = createRunFor(store);

  const wt = createWorktreeFn(workspace, runId, "I1", ctxFor(stateHome));
  const item = makeRuntimeItem("I1", "RED");
  item.worktree = wt;
  store.saveItem(runId, item);
  assert.notEqual(store.currentRun(), null, "premise: the run is current before archiving");

  store.archiveRun(runId);

  assert.equal(store.currentRun(), null, "archiving clears the current-run pointer (its whole committed job)");
  assert.equal(existsSync(wt), true, "the worktree directory still exists — archiving is not deletion");
  assert.ok(worktreeListPaths(workspace).includes(wt), "git still lists the worktree");
  assert.equal(
    existsSync(path.join(stateHome, "conductor", WKEY, "worktrees", runId)),
    true,
    "the run's worktrees directory under the state home is intact",
  );
  assert.equal(
    store.loadItem(runId, "I1").worktree,
    wt,
    "and the archived run's item still names its worktree — nothing was scrubbed",
  );
});

// ===========================================================================
// [9.6-crash-prune]
// ===========================================================================

test("[9.6-crash-prune] a crashed run that left its worktree DIRECTORY deleted but the administrative entry behind never wedges a later run: the next createWorktree runs `git worktree prune` BEFORE adding — afterwards the stale entry is gone from `git worktree list` and the new worktree exists — crash healing at the next worktree operation, no daemon and no new persisted state", () => {
  const workspace = committedRepo();
  const stateHome = freshStateHome();

  // The crashed run: its directory vanishes without removeWorktree ever running.
  const crashedWt = createWorktreeFn(workspace, "r-96-crashed", "I1", ctxFor(stateHome));
  rmSync(crashedWt, { recursive: true, force: true });
  assert.equal(
    worktreeListPaths(workspace).includes(crashedWt),
    true,
    "premise: git's administrative entry survived the crash (the wedge a later run would meet)",
  );

  // The LATER run's first worktree operation heals it.
  const nextWt = createWorktreeFn(workspace, "r-96-next", "I2", ctxFor(stateHome));

  const listed = worktreeListPaths(workspace);
  assert.equal(listed.includes(crashedWt), false, "the stale entry was pruned BEFORE the add");
  assert.ok(listed.includes(nextWt), "and the new worktree was added successfully");
  assert.equal(isRepo(nextWt), true, "the new worktree is a live git work tree");
  assert.equal(
    currentBranch(nextWt),
    wtBranchOf("r-96-next", "I2"),
    "on its own explicit branch — the crashed run's branch never collided with it",
  );
});

// ===========================================================================
// [9.6-nogit-refuses-worktree]
// ===========================================================================

test("[9.6-nogit-refuses-worktree] §3.9:1503 — no-git mode disables worktree mode: in a workspace where gitio.isRepo is false, createWorktree REFUSES naming no-git mode, no directory is created under the state home's worktrees path, and no worktree can ever be handed to the rest of the pipeline as a tree", () => {
  const plain = freshDir("conductor-96-plain-");
  writeFileSync(path.join(plain, "notes.txt"), "not a repository\n");
  const stateHome = freshStateHome();
  assert.equal(isRepo(plain), false, "premise: the workspace is not a git repository");

  assert.throws(
    () => createWorktreeFn(plain, "r-96-nogit", "I1", ctxFor(stateHome)),
    /no-git/i,
    "the refusal names §3.9 no-git mode",
  );
  assert.equal(
    existsSync(path.join(stateHome, "conductor", WKEY, "worktrees")),
    false,
    "nothing was created under the state home's worktrees path",
  );
  assert.equal(
    existsSync(path.join(plain, ".git")),
    false,
    "and the refusal did not manufacture a repository either",
  );
});
