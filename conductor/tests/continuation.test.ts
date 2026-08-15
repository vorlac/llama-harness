// Task 10.1 RED tests — FINAL LOCATION conductor/tests/continuation.test.ts.
//
// SUBJECT (must NOT exist when this goes red): conductor/adapter/continuation.ts. The
// failure is `Cannot find module '../adapter/continuation.ts'` — the missing-subject
// shape, a legal red per §2.6.1. Three rows go red as ASSERTION failures rather than as
// the unresolved import (they drive ALREADY-EXPORTED bindings and assert NEW behaviour
// from them, exactly as 9.4c's gate row and 9.5c's override rows did):
//   [10.1-binding-decide-human-territory]      — adapter/tools.ts handleDecide
//   [10.1-binding-question-reuse-no-duplicate] — adapter/tools.ts handleSubmitTest/handleVetTest
//   [10.1-plugin-event-hook-routes]            — plugin/index.ts ConductorPlugin
// Those three still fail through this file's top-level import, which is the point: the
// file is one contract and it goes green only when every part of it is built.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   Task 10.1 (2731-2745) — the authoritative behaviour of this task.
//   §3.7 (1456-1476)      — the continuation engine: idle detection, the re-prompt, the
//                           2s debounce, the futile-signature wedge detector, halt.
//   §2.3 (705-711)        — isTerminal, ONE definition; "EXECUTING with a stop" included.
//   §2.9 (888-917)        — the stop vocabulary, who records which kind, and the rule
//                           that every stop writes a report through the ONE writer.
//   §2.8 (877-883)        — the AnomalyRecord kind:"disengage" shape.
//   §3.5 (1334-1427)      — the session registry, the ask surface, the edit gate.
//   §3.6 (1428-1455)      — the inline claim that scopes an orchestrator edit.
//   §6.2 (1851-1879)      — human territory; Task 1.5's isHumanTerritory verdict.
//   §2.11 (979-1008)      — questions.jsonl and the stale-red registry.
//   docs/build/specs/task-10.1.assertions.json — the 32 rows mapped 1:1 to the 32 tests
//                           below, its dependsOnUnbuilt / verifiedAgainstHead facts, its
//                           correctionsToDraft rulings and its fourteen resolved specGaps.
//   conductor/adapter/wire-notes.md:32-34,55-59,109-110 — the `permission.asked` BUS event
//                           (the typed `permission.ask` plugin hook is never dispatched at
//                           1.18.15), and the reply route
//                           client.postSessionIdPermissionsPermissionId({path:{id,
//                           permissionID}, body:{response:'once'|'always'|'reject'}}).
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-10.1.assertions.json; this file is the contract
// that pins them):
//  (G1) THE FUTILITY SIGNATURE EXCLUDES run.counters (SG-1). run.counters lives INSIDE
//       run.json (core/types.ts:205), so §3.7.2's literal "hash of run.json" is
//       self-defeating: every re-prompt mutates run.json, so a raw hash resets futility on
//       every pass and the wedge detector can never fire. The signature is a canonical
//       projection with sorted keys over
//         {run.state, run.classification.kind, run.planReviewRounds,
//          items sorted by id as {id, state, blockedReason, deferredReason},
//          questions sorted by id as {id, answered}}
//       and NOTHING else. Deliberately narrow: every extra field is another way for a
//       wedged run to look like it moved.
//  (G2) THE COUNTER ORDER INSIDE ONE PASS is: consult core/stops.ts shouldTerminate with
//       the PERSISTED counters FIRST, then (on the re-prompt path) update the counters and
//       save, then send the prompt. That is the only order in which both
//       [10.1-noop-after-three-futile] ("exactly three prompts, the fourth idle stops") and
//       [10.1-futile-signature-excludes-counters] ("futileRePrompts reads 1 then 2 then 3
//       across the three re-prompt passes") are simultaneously true. The update rule is:
//       a signature that DIFFERS from the last one this engine observed sets
//       futileRePrompts to 0; anything else (equal, or no observation yet) increments it.
//       idleRePrompts increments on every pass that actually sends a prompt.
//  (G3) NO RECOMMENDATION ⇒ NO PROMPT (SG-2). core/gates-phase.ts:456 shows a reachable
//       NON-terminal EXECUTING verdict with recommended === null. That pass journals
//       continuation/idle carrying legalTools' own `why`, prompts nothing, and leaves BOTH
//       counters untouched — it is not a futile re-prompt, because it is not a re-prompt.
//  (G4) DEBOUNCE AND ONE-IN-FLIGHT LIVE IN A CALLER-OWNED IN-MEMORY OBJECT (SG-3), the
//       same shape the §3.5 `registry` Map and the §3.6 `overrideGrants` Map already use.
//       §2.3's schema has no field for either and adding one would be a schema change.
//       `createContinuationState()` mints it; both handlers take it as `state`.
//  (G5) ARCHIVAL (SG-4, the C-029(a) binding): the engine archives ANY terminal run it
//       observes at idle, in the SAME pass, AFTER any stop-report it owes and AFTER
//       worktree cleanup. store.archiveRun only clears the pointer (state.ts:563), so it
//       is idempotent. A question run reaches ANSWERED with NO queue.json on disk
//       (conductor_classify's question path never decomposes), so the archival pass must
//       tolerate a missing queue.
//  (G6) THE NEEDS_CONTEXT CONVERSION IS PRODUCED BY THE ASK-GATE AND DELIVERED BY THE
//       ENGINE (SG-5). adapter/fanout.ts has no permission awareness and FanoutResult
//       (:66) has no channel for a mid-session event, so handlePermissionAsked RETURNS and
//       RECORDS {sessionID, itemId, status:"NEEDS_CONTEXT", neededContext} into the shared
//       ContinuationState, and the next orchestrator re-prompt surfaces it EXACTLY ONCE.
//       No new §2.10 status, no schema change.
//  (G7) THE C-029(b) GUARD LIVES INSIDE handleDecide (SG-6), beside the existing
//       requireTwoOptions check at adapter/tools.ts:850 — conductor_decide arrives as a
//       TOOL CALL, never as a permission ask, and continuation.ts imports FROM tools.ts,
//       so a tools.ts -> continuation.ts import would close a cycle.
//  (G8) "ACTIVE CLAIM" (SG-8) means item.inlineClaim !== null AND item.state !== "PUBLISHED".
//       The committed adapter/tools.ts inlineClaimScopeFor (:7674) implements only the
//       first half. ONE exported derivation, `activeInlineClaimScope(store, runId)`, adds
//       the second and returns the flat `string[] | null` BOTH seams take — the
//       tool.execute.before gate's GateHookInput.inlineClaimScope (tools.ts:218) and the
//       permission reply. The mid-FSM half of §3.6's expiry ("leaves its CURRENT state")
//       is NOT computable from committed state and is NOT implemented here.
//  (G9) THE ORCHESTRATOR HAS NO TREE (SG-9). adapter/chat-message.ts:75 registers
//       {role:"orchestrator"} with no `tree`, and both decideEdit consumers read
//       `entry?.tree ?? ""` (tools.ts:338), which mangles an ABSOLUTE ask path:
//       core/gates-edit.ts:128 turns "/repo/src/a.ts" into "repo/src/a.ts", which matches
//       no tree-relative scope. ONE exported helper resolves the session tree as
//       `entry.tree ?? store.root` and BOTH seams use it. chat-message.ts is NOT edited.
//  (G10) THE ASK PAYLOAD'S FILE PATH IS NOT WIRE-PINNED (SG-10; wire-notes.md:110 records
//       patterns/metadata as never asserted). Extraction order is metadata.filePath, then
//       metadata.path, then a single CONCRETE (wildcard-free) entry of `patterns`; when
//       none yields a path the ask FAILS CLOSED (reject), even under an active claim. The
//       question text extraction is the same shape: metadata.question, then metadata.text;
//       when neither yields text the journalled record carries humanTerritory false plus
//       textAvailable false — the verdict is never fabricated — and the reply is allow.
//  (G11) THE STOP-REPORT IS THE COMMITTED handleReport (adapter/tools.ts:7283) IN ITS STOP
//       MODE, which it selects from `run.stop !== null` (:7310). continuation.ts records
//       the stop and then DRIVES that one writer; it contains no report-writing code and
//       no second stale-red registration. `deps.writeStopReport` overrides it for the
//       write-ahead-ordering row only.
//  (G13) ANSWERING RELEASES AN ITEM ONLY WHEN NO OPEN QUESTION STILL NAMES IT (C-056's
//       residual, adjudicated onto this task). handleSurface (adapter/tools.ts:890-956)
//       applies FIRST-BLOCK-WINS: it records which named items are ALREADY blocked (:899-908)
//       and skips them (:938), but it STILL appends its question with the item in its own
//       blocksItems (:914-925). So two open questions can name one item while §2.5's single
//       `blocked` disposition carries only the first — and adapter/questions.ts answerQuestion
//       (:125) keys the release purely on `blocked.questionId === questionId`, so answering the
//       FIRST releases an item the SECOND still gates. RULE: on release, re-block on the OLDEST
//       still-open question that names the item, and release only when none remains. Two
//       consequences this file pins:
//         - the successor search must EXCLUDE the question being answered. answerQuestion marks
//           the question answered LAST (:176-179, the C-018/C-020 clear-first wedge order), so a
//           naive "scan the open questions" during the clear phase finds the very question being
//           answered and re-blocks the item on itself.
//         - a re-blocked item is NOT reported in clearedItemIds. handleAnswer (:986-994) journals
//           state/item.updated with `blocked: null` for every id it returns there, so listing an
//           item that is still blocked would make the journal say the opposite of the disk.
//  (G12) WORKTREE REMOVAL IS 10.1's CALL (C-037 ruling 6). adapter/worktrees.ts
//       removeWorktree ships at 9.6 with no caller by design; its committed signature is
//       FOUR parameters — removeWorktree(workspace, runId, itemId, {stateHome, workspaceKey})
//       — not the three the 10.1 spec's dependsOnUnbuilt section quotes.
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) handleSessionIdle DOES NOT AWAIT THE PROMPT IT SENDS. It fires the prompt, latches
//       "one in flight" in the ContinuationState, and returns; the latch clears when the
//       prompt settles. Awaiting it would make [10.1-one-reprompt-in-flight] unobservable.
//  (P2) THE PASS ORDER is: (a) orchestrator-only check; (b) currentRun; (c) the C-032 E7
//       orphan-question reconciliation — the row says "BEFORE any re-prompt or stop
//       decision"; (d) halt ⇒ interrupt (halt outranks the debounce, the recommendation
//       and the futility rule alike); (e) isTerminal ⇒ worktree cleanup + archive, never a
//       prompt; (f) the futility signature and the progress reset — a run that MOVED since
//       the last re-prompt is not wedged, so the comparison must precede the verdict that
//       would stop it; (g) shouldTerminate; (h) the verdict; (i) debounce/in-flight;
//       (j) counters + prompt.
//  (P3) THE ENGINE WRITES ONLY TWO STOP KINDS: `noop` (its own futility rule) and
//       `interrupt` (halt). A shouldTerminate verdict of blocked / surfaced / env is NOT
//       recorded here — §2.9:900-905 assigns blocked/surfaced/done to the report tool and
//       env to the fan-out engine and handleOverride (which already records it at
//       tools.ts:7772).
//  (P4) THE PLUGIN'S `event` HOOK IS A THIN BODY delegating to the ONE adapter function
//       `handlePluginEvent`, exactly as `tool.execute.before` delegates to
//       gateBeforeToolCall. The plugin opens its workspace LAZILY (never at construction —
//       tests/gate-wiring.test.ts constructs the factory against a directory that does not
//       exist and must keep passing), reads its §2.1 Config from <root>/.conductor/config.json,
//       and seeds the §3.5 registry entry for the PERSISTED run's own sessionID
//       (core/types.ts Run.sessionID) as role "orchestrator" — the entry
//       adapter/chat-message.ts:75 writes, reconstructed from persisted state rather than
//       invented. How the plugin resolves stateHome/workspaceKey is NOT pinned here.
//  (P5) FAIL-SOFT (G5 of the build guards) means: the event hook catches, journals ONCE at
//       level "error" under a name core/journal-events.ts isKnownEvent accepts, and
//       resolves. This file asserts the level and the vocabulary membership, not the
//       spelling.
//
// ---------------------------------------------------------------------------
// PINNED EXPORT SURFACE the implementer must target (conductor/adapter/continuation.ts).
// Everything these tests read is here so the implementer can hit it EXACTLY. Every
// durable read/write goes through the INJECTED store (G6 of the build guards); the clock
// is INJECTED and no test ever sleeps.
//
//   // (G4) the caller-owned in-memory half: the debounce clock, the one-in-flight latch,
//   // the last observed futility signature, the set of already-adjudicated permission ids
//   // and the pending NEEDS_CONTEXT surface queue. Opaque to these tests.
//   export interface ContinuationState { … }
//   export function createContinuationState(): ContinuationState;
//
//   // (G11)/(G12) the two injection seams, each defaulting to the committed function.
//   export interface ContinuationDeps {
//     writeStopReport?: (input: {
//       store: StateStore; runId: string; config: Config; journal: HandlerJournal;
//       stateHome: string; workspaceKey: string; now?: () => number;
//     }) => Promise<{ reportPath: string }>;          // default: adapter/tools.ts handleReport
//     removeWorktree?: (workspace: string, runId: string, itemId: string,
//                       ctx: { stateHome: string; workspaceKey: string }) => void;
//   }                                                 // default: adapter/worktrees.ts removeWorktree
//
//   export function handleSessionIdle(input: {
//     store: StateStore; state: ContinuationState;
//     registry: Map<string, RegistryEntry>;           // the §3.5 session registry
//     sessionID: string;                              // the session that went idle
//     client: ContinuationClient;                     // session.prompt + the permission route
//     config: Config; journal: HandlerJournal;
//     stateHome: string; workspaceKey: string;
//     now: () => number; deps?: ContinuationDeps;
//   }): Promise<{ runId: string | null; prompted: boolean;
//                 stop: { kind: string; reasonDisplay: string; tsMs: number } | null }>
//
//   export function handlePermissionAsked(input: {
//     store: StateStore; state: ContinuationState;
//     registry: Map<string, RegistryEntry>;
//     client: ContinuationClient;
//     event: { id: string; sessionID: string; permission: string;
//              patterns?: string[]; metadata?: Record<string, unknown> };
//     journal: HandlerJournal; now?: () => number;
//   }): Promise<{ replied: "once" | "always" | "reject" | null;
//                 conversion: { sessionID: string; itemId: string | null;
//                               status: string; neededContext: string } | null }>
//
//   // (P4) the router the plugin's `event` hook delegates to. NEVER throws.
//   export function handlePluginEvent(input: {
//     event: { type: string; properties?: Record<string, unknown> };
//     store: StateStore; state: ContinuationState;
//     registry: Map<string, RegistryEntry>; client: ContinuationClient;
//     config: Config; journal: HandlerJournal;
//     stateHome: string; workspaceKey: string;
//     now: () => number; deps?: ContinuationDeps;
//   }): Promise<void>
//
//   // (G8)/(G9) the two ONE-derivation helpers BOTH seams read.
//   export function activeInlineClaimScope(store: StateStore, runId: string): string[] | null;
//   export function resolveSessionTree(store: StateStore, entry: RegistryEntry | undefined): string;
// ---------------------------------------------------------------------------
//
// Assertion id -> test (each test name carries its id as its FIRST token):
//   10.1-idle-orchestrator-only              10.1-terminal-never-reprompted
//   10.1-idle-no-live-run                    10.1-archive-terminal-run
//   10.1-idle-reprompt-recommended           10.1-archive-removes-worktrees
//   10.1-reprompt-names-gate-recommendation  10.1-plugin-event-hook-routes
//   10.1-idle-null-recommendation            10.1-event-hook-failsoft
//   10.1-debounce-2s                         10.1-ask-unregistered-reject
//   10.1-one-reprompt-in-flight              10.1-ask-subsession-reject-once
//   10.1-futile-signature-excludes-counters  10.1-ask-needs-context-conversion
//   10.1-signature-change-resets             10.1-ask-claim-allow
//   10.1-noop-after-three-futile             10.1-ask-noclaim-reject
//   10.1-noop-anomaly-write-ahead            10.1-ask-claim-one-derivation-both-seams
//   10.1-noop-stop-report-one-writer         10.1-ask-path-unextractable-reject
//   10.1-engine-records-only-noop-and-interrupt
//   10.1-halt-interrupt                      10.1-ask-question-allowed-verdict-journaled
//   10.1-ask-unknown-kind-reject             10.1-ask-reply-failure-failsoft
//   10.1-binding-decide-human-territory      10.1-binding-orphan-question-reconcile
//   10.1-binding-question-reuse-no-duplicate
//   10.1-binding-answer-reblocks-on-next-open-question

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// THE SUBJECT — absent at red time (the missing-subject red names THIS path).
import {
  activeInlineClaimScope,
  createContinuationState,
  handlePermissionAsked,
  handlePluginEvent,
  handleSessionIdle,
  resolveSessionTree,
} from "../adapter/continuation.ts";

// Adapters + core that DO exist today.
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { appendQuestion, answerQuestion, readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { createWorktree } from "../adapter/worktrees.ts";
import { isRepo } from "../adapter/gitio.ts";
import {
  gateBeforeToolCall,
  handleAnswer,
  handleDecide,
  handleQueueAmend,
  handleSubmitTest,
  handleSurface,
  handleVetTest,
} from "../adapter/tools.ts";
import type { QueueAmendOp } from "../core/queue-amend.ts";
import type { RegistryEntry } from "../adapter/tools.ts";
import { ConductorPlugin } from "../plugin/index.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun, LegalToolsResult } from "../core/gates-phase.ts";
import { isHumanTerritory } from "../core/decide.ts";
import { isTerminal } from "../core/stops.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import { validate } from "../core/types.ts";
import type {
  AnomalyRecord,
  Config,
  DecisionRecord,
  EvidenceRecord,
  Item,
  ItemState,
  Queue,
  QueueItem,
  Run,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";
import type { FakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY so every call site below type-checks the
// green implementation against this file's contract (the 5.3/9.4a/9.4c convention).
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
  flushSync: () => void;
}

interface ClientEnvelope {
  data?: unknown;
  error?: unknown;
}

// The SDK subset the engine drives: the fan-out engine's session surface (so the fake
// client assigns unchanged) plus the wire-verified permission reply route. NOTE the
// spelling: wire-notes.md:55-59 records that the plan's client.permission.reply({requestID,
// reply}) DOES NOT EXIST at 1.18.15 — the generated method is this one.
interface ContinuationClient {
  session: {
    create(opts?: { body?: { title?: string; parentID?: string } }): Promise<ClientEnvelope>;
    prompt(opts: { path: { id: string }; body: Record<string, unknown> }): Promise<ClientEnvelope>;
    abort(opts: { path: { id: string } }): Promise<ClientEnvelope>;
    messages(opts: { path: { id: string } }): Promise<ClientEnvelope>;
  };
  postSessionIdPermissionsPermissionId(opts: {
    path: { id: string; permissionID: string };
    body: { response: "once" | "always" | "reject" };
  }): Promise<ClientEnvelope>;
}

interface StopRecord {
  kind: string;
  reasonDisplay: string;
  tsMs: number;
}

interface SessionIdleResult {
  runId: string | null;
  prompted: boolean;
  stop: StopRecord | null;
}

interface NeedsContextConversion {
  sessionID: string;
  itemId: string | null;
  status: string;
  neededContext: string;
}

interface PermissionAskedResult {
  replied: "once" | "always" | "reject" | null;
  conversion: NeedsContextConversion | null;
}

interface AskEvent {
  id: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
}

// The two committed §2.11 handler returns row 33 reads (adapter/tools.ts:883, :971),
// mirrored locally so this file stays a self-contained contract.
interface SurfaceOutcome {
  questionId: string;
  blockedItemIds: string[];
}

interface AnswerOutcome {
  questionId: string;
  clearedItemIds: string[];
}

interface PluginHooks {
  tool?: Record<string, unknown>;
  "tool.execute.before"?: (input: unknown, output: unknown) => Promise<void> | void;
  "chat.message"?: (
    input: { sessionID: string },
    output: { parts: Array<{ type: string; text?: string }> },
  ) => Promise<void> | void;
  event?: (input: { event: { type: string; properties?: Record<string, unknown> } }) => Promise<void> | void;
}

type Registry = Map<string, RegistryEntry>;

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a
// value DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-1042";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-7731";
const RED_MARKER = "CAPTURED-RED-MARKER-8815";
const MUSTFIX_MARKER = "MUSTFIX-MARKER-4416: assert the returned value, not the call count";
const BLOCK_MARKER = "WRITER-BLOCK-MARKER-6620";
const FALLBACK_TRIPWIRE = "FULL_SCOPE_FALLBACK_RAN_3311";
const BROKEN_TOKEN = "BROKEN_TOKEN_9042";

const SCOPE = "unit1042";
const ORCH = "ses_orchestrator";
const SUB = "ses_implementer";
const TREE_OFF = "main";

// The §3.7.4 debounce window (plan line 1462): 2 seconds, measured from the LAST
// re-prompt. Named once so every timing arithmetic below reads the same number.
const DEBOUNCE_MS = 2000;

const START_MS = 1_755_100_000_000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTINUATION_SRC = path.resolve(HERE, "..", "adapter", "continuation.ts");

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom). Every fixture
// is a throwaway repo under os.tmpdir(); the out-of-repo state home is a SEPARATE
// throwaway dir. This test never runs git against the llama-harness repo.
// ---------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
  GIT_TERMINAL_PROMPT: "0",
};

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// A committed fixture repo: <root> IS the workspace root, so .conductor/ lands beside
// src/ and tests/ exactly as it does in production.
function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-cont-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "parser.mjs"), "export const parse = (t) => Math.abs(Number(t));\n");
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-cont-state-"));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Journal, clock, registry
// ---------------------------------------------------------------------------

function makeJournal(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

function continuationRecords(records: CaptureRecord[], event: string): CaptureRecord[] {
  return records.filter((r) => r.component === "continuation" && r.event === event);
}

function gateRecords(records: CaptureRecord[], event: string): CaptureRecord[] {
  return records.filter((r) => r.component === "gates" && r.event === event);
}

// The INJECTED clock. Every timing row moves this variable; nothing sleeps.
interface Clock {
  now: () => number;
  set: (ms: number) => void;
  advance: (ms: number) => void;
  read: () => number;
}
function makeClock(startMs = START_MS): Clock {
  let ms = startMs;
  return {
    now: () => ms,
    set: (next: number) => {
      ms = next;
    },
    advance: (delta: number) => {
      ms += delta;
    },
    read: () => ms,
  };
}

function makeRegistry(entries: Array<[string, RegistryEntry]> = []): Registry {
  return new Map<string, RegistryEntry>(entries);
}

// ---------------------------------------------------------------------------
// The permission-reply recorder.
//
// tests/fixtures/fake-sdk.ts:72-79 exposes ONLY `session.{create,prompt,abort,messages}`
// — there is no client-level method on the fixture at all, so the wire-verified reply
// route has nowhere to be recorded. The 10.1 spec says the fixture must be EXTENDED with
// a recorder; this test-writer may not edit the committed fixture, so the recorder is
// built HERE as a thin DECORATOR over the fake's client. It adds exactly one top-level
// member and passes the session surface through untouched, so the decorated object stays
// structurally assignable to adapter/fanout.ts FanoutClient.
//
// `mode` drives [10.1-ask-reply-failure-failsoft]: "ok" resolves with an empty data
// envelope, "error-envelope" resolves with an {error} envelope (the shape the generated
// hey-api client returns on a non-2xx), and "throw" rejects outright (a transport fault).
// ---------------------------------------------------------------------------

interface PermissionReplyRecord {
  sessionID: string;
  permissionID: string;
  response: string;
}

type ReplyMode = "ok" | "error-envelope" | "throw";

interface Wiring {
  sdk: FakeSdk;
  client: ContinuationClient;
  replies: PermissionReplyRecord[];
  registry: Registry;
}

function makeWiring(registry: Registry, mode: ReplyMode = "ok"): Wiring {
  const sdk = makeFakeSdk({ registry });
  const replies: PermissionReplyRecord[] = [];
  // Default: every prompt resolves at once. The in-flight row overrides this.
  sdk.setResponder(() => ({ kind: "reply", text: "ack" }));
  const client: ContinuationClient = {
    session: sdk.client.session,
    async postSessionIdPermissionsPermissionId(opts): Promise<ClientEnvelope> {
      replies.push({
        sessionID: opts.path.id,
        permissionID: opts.path.permissionID,
        response: opts.body.response,
      });
      if (mode === "throw") {
        throw new Error("INJECTED permission-reply transport failure");
      }
      if (mode === "error-envelope") {
        return { error: { message: "INJECTED permission-reply error envelope" } };
      }
      return { data: {} };
    },
  };
  return { sdk, client, replies, registry };
}

// Yield a bounded number of macrotask turns. NEVER a synchronization point: it only gives
// an incorrect implementation more opportunity to emit the call whose absence the
// following assertion claims, so it can only make a passing assertion harder to satisfy.
async function turns(count = 6): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

// ---------------------------------------------------------------------------
// Config / store / run / queue fixtures
// ---------------------------------------------------------------------------

interface ConfigOpts {
  maxOverridesPerRun?: number;
  testRepairAttempts?: number;
  vetCritics?: number;
  vetMaxRounds?: number;
}

function makeConfig(opts: ConfigOpts = {}): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        [SCOPE]: {
          command: [
            process.execPath,
            "-e",
            `process.stderr.write(${JSON.stringify(FALLBACK_TRIPWIRE + "\n")}); process.exit(1);`,
          ],
          timeoutMs: 120_000,
          itemTest: [process.execPath, "--test", "{files}"],
        },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: opts.vetCritics ?? 1,
      vetMaxRounds: opts.vetMaxRounds ?? 2,
      testRepairAttempts: opts.testRepairAttempts ?? 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: opts.maxOverridesPerRun ?? 4,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: ORCH,
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

const USER_PROMPT = "make the beta parser keep the sign of negative offsets";

function createRunFor(store: StateStore, sessionID = ORCH): string {
  const run = store.createRun({
    prompt: USER_PROMPT,
    sessionID,
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
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
    title: `keep the sign of negative offsets (${TITLE_MARKER})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: over.behavioral ?? true,
    dependsOn: [...(over.dependsOn ?? [])],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

// Drive a run to EXECUTING WITHOUT calling any other task's handler (direct on-disk
// seeding, the tools-9.2/9.3/9.4a/9.5c discipline).
function seedExecuting(
  store: StateStore,
  runId: string,
  queue: Queue,
  states: Record<string, ItemState> = {},
): void {
  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const qi of queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, states[qi.id] ?? "PENDING"));
  }
}

// A single-item EXECUTING fixture whose gate recommendation is stable and non-null:
// I1 PENDING + behavioral ⇒ conductor_submit_test{I1}. Nothing the engine does can
// advance it, which is precisely what makes it a wedge fixture.
function seedOneItemExecuting(store: StateStore, runId: string): Queue {
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue);
  return queue;
}

// ---------------------------------------------------------------------------
// Ledger readers (read the PERSISTED artifacts, never a handler's return)
// ---------------------------------------------------------------------------

function readRunFile(store: StateStore, runId: string): Run {
  return JSON.parse(readFileSync(path.join(runDirOf(store, runId), "run.json"), "utf8")) as Run;
}

function readJsonl(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function readAnomalies(runDir: string): AnomalyRecord[] {
  return readJsonl(path.join(runDir, "anomalies.jsonl")) as AnomalyRecord[];
}

function readEvidence(runDir: string): EvidenceRecord[] {
  return readJsonl(path.join(runDir, "evidence.jsonl")) as EvidenceRecord[];
}

function readDecisions(runDir: string): DecisionRecord[] {
  return readJsonl(path.join(runDir, "decisions.jsonl")) as DecisionRecord[];
}

function rawOrEmpty(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function itemFileBytes(runDir: string, itemId: string): string {
  return readFileSync(path.join(runDir, "items", `${itemId}.json`), "utf8");
}

// ---------------------------------------------------------------------------
// The gate's view of the SAME persisted fixture — built exactly as the committed
// adapter/tools.ts gateItemsOf (:2328) builds it, so the test and the engine ask the pure
// gate about one and the same state.
// ---------------------------------------------------------------------------

function gateItemsOf(store: StateStore, runId: string, queue: Queue): GateItem[] {
  const out: GateItem[] = [];
  for (const qi of queue.items) {
    let item: Item;
    try {
      item = store.loadItem(runId, qi.id);
    } catch {
      continue;
    }
    out.push({
      id: qi.id,
      state: item.state,
      behavioral: qi.behavioral,
      dependsOn: [...qi.dependsOn],
      fileScope: [...qi.fileScope],
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
    });
  }
  return out;
}

// The verdict the ENGINE must read — computed here through the SAME core function and the
// SAME input assembly the committed waveVerdict (adapter/tools.ts:5001) performs, so no
// assertion below re-derives a next step of its own.
function verdictOf(store: StateStore, runId: string, queue: Queue): LegalToolsResult {
  const run = store.loadRun(runId);
  const gateRun: GateRun = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
  };
  const questions = readQuestions(runDirOf(store, runId)).map((q) => ({
    id: q.id,
    answeredIso: q.answeredIso,
  }));
  return legalTools(gateRun, gateItemsOf(store, runId, queue), questions, true, isRepo(store.root));
}

// Every conductor_* name a composed prompt mentions. Used to prove the engine never names
// a tool the gate did not legalize.
function toolNamesIn(text: string): string[] {
  return [...new Set(text.match(/conductor_[a-z_]+/g) ?? [])];
}

// ---------------------------------------------------------------------------
// Sub-session receipts (§2.10) used by the two handler-driving rows
// ---------------------------------------------------------------------------

function implJson(status = "DONE", summary = "wrote the item test"): string {
  return JSON.stringify({
    status,
    summary,
    concerns: [],
    neededContext: null,
    blockReason: status === "BLOCKED" ? BLOCK_MARKER : null,
  });
}

function vetJson(mustFix: string[]): string {
  const clean = mustFix.length === 0;
  const verdict = (note: string): { pass: boolean; note: string } => ({ pass: clean, note });
  return JSON.stringify({
    verdictsByCriterion: {
      observableBehavior: verdict("asserts the returned value"),
      wouldCatchWrongImpl: verdict("a sign-dropping implementation still fails it"),
      rightLevel: verdict("unit level is right for a pure function"),
      pinsAcceptance: verdict("pins this item's acceptance criterion"),
      antiPatterns: verdict("no mock-testing, no tautology"),
    },
    mustFix: [...mustFix],
  });
}

function brokenTest(marker: string): string {
  return `// ${marker}\nimport test from "node:test";\nconst ${BROKEN_TOKEN} = ;\ntest("t", () => {});\n`;
}

type CannedReply = string | ((promptText: string) => string);

interface RoleScript {
  testWriter: CannedReply[];
  reviewer: CannedReply[];
}

interface FanoutWiring {
  fanout: Fanout;
  sdk: FakeSdk;
  byRole: (role: string) => number;
}

// The 9.4a harness shape: a per-role reply script over the fake SDK, clamped to the last
// entry so a bad-forever stream drives the block paths.
function makeFanoutWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  script: RoleScript,
): FanoutWiring {
  // adapter/fanout.ts's own registry entry shape (itemId and tree REQUIRED there, unlike
  // adapter/tools.ts's gate-side RegistryEntry) — the 9.4a wiring's exact declaration.
  const registry = new Map<string, { role: string; itemId: string; tree: string }>();
  const sdk = makeFakeSdk({ registry });
  const counted: string[] = [];
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    counted.push(role);
    const queue = role === "testWriter" ? script.testWriter : role === "reviewer" ? script.reviewer : [];
    if (queue.length === 0) return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    let idx = sessionIdx.get(req.sessionID);
    if (idx === undefined) {
      idx = nextByRole.get(role) ?? 0;
      nextByRole.set(role, idx + 1);
      sessionIdx.set(req.sessionID, idx);
    }
    const canned = queue[Math.min(idx, queue.length - 1)];
    return { kind: "reply", text: typeof canned === "function" ? canned(req.text) : canned };
  });
  const tree: TreeState = {
    isFrozen(): boolean {
      return false;
    },
    onClear(): () => void {
      return () => undefined;
    },
  };
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    tree,
    runId,
  );
  return { fanout, sdk, byRole: (role: string) => counted.filter((r) => r === role).length };
}

// A test-writer responder that WRITES `content` at `rel` — the fixture stand-in for a real
// write-capable sub-session's edit.
function writerWrites(repo: string, rel: string, content: string): CannedReply {
  return (): string => {
    const target = path.join(repo, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return implJson();
  };
}

// ---------------------------------------------------------------------------
// Fixture sanity: the premises these tests depend on, asserted mechanically rather than
// assumed (the 9.1-9.5c probe-block discipline).
// ---------------------------------------------------------------------------

const HUMAN_Q = "Should we delete the production data before the migration?";
const TECHNICAL_Q = "Should the parser use a Map or a plain object for the offset table?";
const HUMAN_DECIDE_Q = "Should we delete the production database snapshots to free space?";
const TECHNICAL_DECIDE_Q = "Should the parser return a tuple or a plain object?";

assert.equal(isHumanTerritory(HUMAN_Q), true, "sanity: the §6.2 fixture question IS human territory");
assert.equal(isHumanTerritory(TECHNICAL_Q), false, "sanity: the derivable fixture question is NOT human territory");
assert.equal(isHumanTerritory(HUMAN_DECIDE_Q), true, "sanity: the human-territory decide fixture IS human territory");
assert.equal(isHumanTerritory(TECHNICAL_DECIDE_Q), false, "sanity: the technical decide fixture is NOT human territory");
assert.equal(
  validate("ImplementerResult", JSON.parse(implJson("BLOCKED")) as unknown).ok,
  true,
  "sanity: the BLOCKED receipt satisfies SCHEMAS.ImplementerResult",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson([MUSTFIX_MARKER])) as unknown).ok,
  true,
  "sanity: the must-fix vet receipt satisfies SCHEMAS.TestVet",
);
assert.equal(
  validate("AnomalyRecord", { ts: START_MS, kind: "disengage", detail: "d" } as unknown).ok,
  true,
  "sanity: the §2.8 disengage variant is exactly {ts, kind, detail}",
);

// ===========================================================================
// [10.1-idle-orchestrator-only]
// ===========================================================================

test("[10.1-idle-orchestrator-only] a session.idle from a non-orchestrator role, and one from a session with no registry entry at all, each produce ZERO prompts, leave run.json byte-identical and emit no `continuation` journal record", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const registry = makeRegistry([
    [ORCH, { role: "orchestrator" }],
    [SUB, { role: "implementer", itemId: "I1", tree: root }],
  ]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();

  const before = rawOrEmpty(path.join(runDirOf(store, runId), "run.json"));

  for (const sessionID of [SUB, "ses_never_registered"]) {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: clock.now,
    });
    assert.equal(res.prompted, false, `${sessionID}: a non-orchestrator idle re-prompts nothing`);
    clock.advance(DEBOUNCE_MS * 2);
  }
  await turns();

  assert.equal(wiring.sdk.prompts.length, 0, "§3.7.1's engine is the ORCHESTRATOR's: no prompt is sent for a sub-session idle");
  assert.equal(wiring.sdk.creates.length, 0, "no sub-session is created either");
  assert.equal(
    rawOrEmpty(path.join(runDirOf(store, runId), "run.json")),
    before,
    "run.json is byte-identical — the counters were not touched",
  );
  assert.equal(
    journal.records.filter((r) => r.component === "continuation").length,
    0,
    "no `continuation` record is emitted for an idle the engine does not own",
  );
  store.release();
});

// ===========================================================================
// [10.1-idle-no-live-run]
// ===========================================================================

test("[10.1-idle-no-live-run] an orchestrator idle with no live run — never created, and already cleared by an archival pass — is a quiet no-op: zero prompts, zero writes, no throw", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const idle = async (): Promise<SessionIdleResult> =>
    handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });

  // (a) no run has ever been created.
  assert.equal(store.currentRun(), null, "precondition: no run is live");
  const first: SessionIdleResult = await idle();
  assert.equal(first.runId, null, "with no live run the pass names no run");
  assert.equal(first.prompted, false, "and prompts nothing");

  // (b) the state every archived run leaves behind (state.ts:563 clears the pointer only).
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  store.archiveRun(runId);
  assert.equal(store.currentRun(), null, "precondition: the archival pass cleared the pointer");
  const runBytes = rawOrEmpty(path.join(runDirOf(store, runId), "run.json"));

  clock.advance(DEBOUNCE_MS * 2);
  const second: SessionIdleResult = await idle();
  await turns();

  assert.equal(second.runId, null, "an archived run is not resurrected by a later idle");
  assert.equal(second.prompted, false, "and nothing is re-prompted into it");
  assert.equal(wiring.sdk.prompts.length, 0, "zero prompts across both no-live-run shapes");
  assert.equal(
    rawOrEmpty(path.join(runDirOf(store, runId), "run.json")),
    runBytes,
    "the archived run's run.json is byte-identical after the idle",
  );
  store.release();
});

// ===========================================================================
// [10.1-idle-reprompt-recommended]
// ===========================================================================

test("[10.1-idle-reprompt-recommended] an orchestrator idle on a non-terminal run with a non-null recommendation sends EXACTLY ONE prompt to the orchestrator's own session naming the recommended tool and its itemId, increments the PERSISTED counters.idleRePrompts by one, journals continuation/reprompt, and creates zero sub-sessions", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue = seedOneItemExecuting(store, runId);

  const verdict = verdictOf(store, runId, queue);
  assert.notEqual(verdict.recommended, null, "premise: the fixture's gate verdict recommends a tool");
  const recommended = verdict.recommended;
  assert.ok(recommended !== null, "premise: the recommendation is non-null");
  assert.equal(recommended.args.itemId, "I1", "premise: the recommendation targets I1");

  const idleBefore = readRunFile(store, runId).counters.idleRePrompts;

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();

  const res: SessionIdleResult = await handleSessionIdle({
    store,
    state: createContinuationState(),
    registry,
    sessionID: ORCH,
    client: wiring.client,
    config,
    journal: journal.sink,
    stateHome: freshStateHome(),
    workspaceKey: "wk",
    now: clock.now,
  });
  await turns();

  assert.equal(res.prompted, true, "the pass reports that it re-prompted");
  assert.equal(res.runId, runId, "and names the live run");
  assert.equal(wiring.sdk.prompts.length, 1, "EXACTLY ONE prompt — a re-prompt is one message, not a burst");
  const prompt = wiring.sdk.prompts[0];
  assert.equal(prompt.sessionID, ORCH, "the re-prompt is addressed to the orchestrator's own session");
  assert.ok(
    prompt.text.includes(recommended.tool),
    `the composed prompt names the recommended tool (${recommended.tool}); got: ${prompt.text}`,
  );
  assert.ok(prompt.text.includes("I1"), "and names the item the recommendation carries");
  assert.equal(wiring.sdk.creates.length, 0, "a re-prompt is a MESSAGE, not a dispatch: zero sub-sessions created");

  const persisted = readRunFile(store, runId);
  assert.equal(
    persisted.counters.idleRePrompts,
    idleBefore + 1,
    "counters.idleRePrompts increased by exactly one, read back from the persisted run.json",
  );
  assert.equal(validate("Run", persisted).ok, true, "the re-written run.json still satisfies the §2.3 schema");

  const reprompts = continuationRecords(journal.records, "reprompt");
  assert.equal(reprompts.length, 1, "exactly one continuation/reprompt record");
  assert.ok(
    JSON.stringify(reprompts[0].data).includes(recommended.tool),
    "the journal record carries the tool name the re-prompt named",
  );
  store.release();
});

// ===========================================================================
// [10.1-reprompt-names-gate-recommendation]
// ===========================================================================

test("[10.1-reprompt-names-gate-recommendation] the named action is READ from core/gates-phase legalTools, never re-derived: on two fixtures differing only in item position the prompt names the tool that gate returns, and in NEITHER case does the text name a conductor_* tool absent from verdict.legal", async () => {
  const cases: Array<{ itemState: ItemState; expected: string }> = [
    { itemState: "PENDING", expected: "conductor_submit_test" },
    { itemState: "VALIDATED", expected: "conductor_item_review" },
  ];

  for (const kase of cases) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
    };
    seedExecuting(store, runId, queue, { I1: kase.itemState });

    const verdict = verdictOf(store, runId, queue);
    const recommended = verdict.recommended;
    assert.ok(recommended !== null, `${kase.itemState}: premise — the gate recommends a tool`);
    assert.equal(
      recommended.tool,
      kase.expected,
      `${kase.itemState}: premise — the gate's own recommendation is ${kase.expected}`,
    );

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    await handleSessionIdle({
      store,
      state: createContinuationState(),
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: makeClock().now,
    });
    await turns();

    assert.equal(wiring.sdk.prompts.length, 1, `${kase.itemState}: exactly one re-prompt`);
    const text = wiring.sdk.prompts[0].text;
    assert.ok(
      text.includes(recommended.tool),
      `${kase.itemState}: the prompt names the tool legalTools returned for THIS fixture; got: ${text}`,
    );
    for (const named of toolNamesIn(text)) {
      assert.ok(
        verdict.legal.has(named),
        `${kase.itemState}: the prompt names "${named}", which the gate did NOT legalize (legal: ${[...verdict.legal.keys()].join(", ")})`,
      );
    }
    store.release();
  }
});

// ===========================================================================
// [10.1-idle-null-recommendation]
// ===========================================================================

test("[10.1-idle-null-recommendation] SG-2: a non-terminal EXECUTING run whose verdict has recommended === null (I1 BLOCKED, I2 dependsOn I1) prompts NOTHING, leaves BOTH counters untouched, and emits exactly one continuation/idle record carrying legalTools' own `why` verbatim", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"], dependsOn: ["I1"] }),
    ],
  };
  seedExecuting(store, runId, queue);
  store.setBlocked(runId, "I1", { reason: "waiting on the human", stage: "RED" });

  const verdict = verdictOf(store, runId, queue);
  assert.equal(verdict.recommended, null, "premise: the gate recommends nothing on this fixture");
  assert.ok(verdict.legal.size > 0, "premise: the run is NOT terminal — the meta tools are still legal");
  assert.ok(verdict.why.length > 0, "premise: the gate supplies a non-empty rationale");

  const before = readRunFile(store, runId).counters;
  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);

  const res: SessionIdleResult = await handleSessionIdle({
    store,
    state: createContinuationState(),
    registry,
    sessionID: ORCH,
    client: wiring.client,
    config,
    journal: journal.sink,
    stateHome: freshStateHome(),
    workspaceKey: "wk",
    now: makeClock().now,
  });
  await turns();

  assert.equal(res.prompted, false, "the engine never invents a next step the gate did not offer");
  assert.equal(wiring.sdk.prompts.length, 0, "zero prompts");
  const after = readRunFile(store, runId).counters;
  assert.equal(after.idleRePrompts, before.idleRePrompts, "idleRePrompts is untouched — nothing was re-prompted");
  assert.equal(
    after.futileRePrompts,
    before.futileRePrompts,
    "futileRePrompts is untouched — a run the engine cannot advance is not a futile RE-PROMPT",
  );

  const idles = continuationRecords(journal.records, "idle");
  assert.equal(idles.length, 1, "exactly one continuation/idle record");
  assert.ok(
    JSON.stringify(idles[0].data).includes(verdict.why),
    `the idle record carries legalTools' authoritative why verbatim; got: ${JSON.stringify(idles[0].data)}`,
  );
  store.release();
});

// ===========================================================================
// [10.1-debounce-2s]
// ===========================================================================

test("[10.1-debounce-2s] §3.7.4 with the clock INJECTED: after a re-prompt at t0, idles at t0+1999ms (and a burst inside the same window) send nothing and leave idleRePrompts unchanged; an idle at t0+2000ms sends exactly one more", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const idle = async (): Promise<SessionIdleResult> => {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    return res;
  };

  const t0 = clock.read();
  await idle();
  assert.equal(wiring.sdk.prompts.length, 1, "the first idle re-prompts");
  const afterFirst = readRunFile(store, runId).counters.idleRePrompts;

  // A BURST inside the window: every one of these is inside [t0, t0+2000).
  for (const offset of [1, 500, 1999]) {
    clock.set(t0 + offset);
    const res = await idle();
    assert.equal(res.prompted, false, `an idle at t0+${offset}ms is inside the 2s window`);
  }
  assert.equal(
    wiring.sdk.prompts.length,
    1,
    "a burst of idles inside ONE window yields exactly one prompt in total",
  );
  assert.equal(
    readRunFile(store, runId).counters.idleRePrompts,
    afterFirst,
    "a debounced pass does not touch counters.idleRePrompts",
  );

  // The window is measured from the LAST RE-PROMPT (t0), not from the last idle (t0+1999).
  clock.set(t0 + DEBOUNCE_MS);
  const res = await idle();
  assert.equal(res.prompted, true, "an idle at exactly t0+2000ms is outside the window");
  assert.equal(wiring.sdk.prompts.length, 2, "and produces exactly one more prompt");
  assert.equal(
    readRunFile(store, runId).counters.idleRePrompts,
    afterFirst + 1,
    "the second re-prompt increments the persisted counter once",
  );
  store.release();
});

// ===========================================================================
// [10.1-one-reprompt-in-flight]
// ===========================================================================

test("[10.1-one-reprompt-in-flight] at most ONE re-prompt is in flight: with the first prompt PARKED, an idle well OUTSIDE the debounce window sends nothing and changes no counter; once the parked prompt settles a later idle re-prompts normally", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  // PARK every prompt: the test decides when it settles.
  wiring.sdk.setResponder(() => ({ kind: "pending" }));

  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const idle = async (): Promise<SessionIdleResult> => {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    return res;
  };

  await idle();
  assert.equal(wiring.sdk.prompts.length, 1, "the first idle sends its prompt");
  assert.equal(wiring.sdk.inFlightCount(), 1, "and that prompt is still unsettled (parked)");
  const counters = readRunFile(store, runId).counters;

  // Deliberately FAR outside the debounce window, so passing this cannot be an artifact
  // of the debounce guard — the two guards are independent.
  clock.advance(DEBOUNCE_MS * 10);
  const held = await idle();
  assert.equal(held.prompted, false, "an idle while a re-prompt is unsettled sends nothing");
  assert.equal(wiring.sdk.prompts.length, 1, "still exactly one prompt");
  assert.deepEqual(
    readRunFile(store, runId).counters,
    counters,
    "and no counter moved while the in-flight guard held",
  );

  wiring.sdk.resolvePending(ORCH, { kind: "reply", text: "the orchestrator replied" });
  await turns();

  clock.advance(DEBOUNCE_MS * 10);
  const released = await idle();
  assert.equal(released.prompted, true, "once the in-flight prompt settles, a later idle re-prompts");
  assert.equal(wiring.sdk.prompts.length, 2, "exactly one more prompt after the release");
  store.release();
});

// ===========================================================================
// [10.1-futile-signature-excludes-counters]
// ===========================================================================

test("[10.1-futile-signature-excludes-counters] SG-1: across three consecutive re-prompt passes in which NOTHING changes except counters.idleRePrompts, the PERSISTED counters.futileRePrompts reads 1 then 2 then 3 — a signature over raw run.json would hold it at 0 forever", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const observed: number[] = [];
  const idleObserved: number[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    assert.equal(res.prompted, true, `pass ${pass + 1} re-prompts (the run is non-terminal and has a recommendation)`);
    const counters = readRunFile(store, runId).counters;
    observed.push(counters.futileRePrompts);
    idleObserved.push(counters.idleRePrompts);
    clock.advance(DEBOUNCE_MS * 2);
  }

  assert.deepEqual(
    idleObserved,
    [1, 2, 3],
    "premise: the ONLY thing that changed between passes is counters.idleRePrompts, which the engine itself increments",
  );
  assert.deepEqual(
    observed,
    [1, 2, 3],
    "counters.futileRePrompts climbs 1,2,3 — the signature EXCLUDES run.counters, so the engine's own writes are not mistaken for progress",
  );
  assert.equal(wiring.sdk.prompts.length, 3, "each pass sent exactly one prompt");
  store.release();
});

// ===========================================================================
// [10.1-signature-change-resets]
// ===========================================================================

test("[10.1-signature-change-resets] ANY state change resets counters.futileRePrompts to 0, asserted independently for three change classes — an item advancing, a disposition appearing, and the run state advancing — each from a persisted futileRePrompts of 2, and each still re-prompting", async () => {
  type Mutator = (store: StateStore, runId: string) => void;
  const cases: Array<{ name: string; mutate: Mutator }> = [
    {
      name: "(a) an item advances PENDING -> RED",
      mutate: (store, runId) => {
        const item = store.loadItem(runId, "I1");
        item.state = "RED";
        store.saveItem(runId, item);
      },
    },
    {
      name: "(b) a disposition appears (the item gains `blocked`)",
      mutate: (store, runId) => {
        store.setBlocked(runId, "I1", { reason: "the writer could not produce a red", stage: "RED" });
      },
    },
    {
      name: "(c) the run state advances PLANNED -> PLAN_REVIEWED",
      mutate: (store, runId) => {
        const run = store.loadRun(runId);
        run.state = "PLAN_REVIEWED";
        store.saveRun(run);
      },
    },
  ];

  for (const kase of cases) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const queue = seedOneItemExecuting(store, runId);
    if (kase.name.startsWith("(c)")) {
      const run = store.loadRun(runId);
      run.state = "PLANNED";
      store.saveRun(run);
    }

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const clock = makeClock();
    const state = createContinuationState();
    const stateHome = freshStateHome();

    const idle = async (): Promise<SessionIdleResult> => {
      const res: SessionIdleResult = await handleSessionIdle({
        store,
        state,
        registry,
        sessionID: ORCH,
        client: wiring.client,
        config,
        journal: journal.sink,
        stateHome,
        workspaceKey: "wk",
        now: clock.now,
      });
      await turns();
      clock.advance(DEBOUNCE_MS * 2);
      return res;
    };

    // Two unchanged passes drive the PERSISTED futile counter to 2.
    await idle();
    await idle();
    assert.equal(
      readRunFile(store, runId).counters.futileRePrompts,
      2,
      `${kase.name}: premise — two unchanged passes leave futileRePrompts at 2`,
    );
    const promptsBefore = wiring.sdk.prompts.length;

    kase.mutate(store, runId);
    const verdict = verdictOf(store, runId, queue);
    assert.notEqual(verdict.recommended, null, `${kase.name}: premise — the mutated fixture still recommends a tool`);

    const res = await idle();
    assert.equal(
      readRunFile(store, runId).counters.futileRePrompts,
      0,
      `${kase.name}: the state change resets futileRePrompts to 0, read back from run.json`,
    );
    assert.equal(res.prompted, true, `${kase.name}: and the engine still re-prompts`);
    assert.equal(
      wiring.sdk.prompts.length,
      promptsBefore + 1,
      `${kase.name}: exactly one more prompt after the change`,
    );
    store.release();
  }
});

test("[10.1-signature-change-resets] the RESTART case: with counters.futileRePrompts persisted at 2 and a FRESH ContinuationState (lastSignature null), the first idle carries the persisted counter forward untouched, and after a real state change the next idle writes 0, still re-prompts and records no stop — a moving run is never wedged by a process restart", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue = seedOneItemExecuting(store, runId);

  // Exactly what a killed process leaves behind: the counters are persisted
  // mid-count (§2.3 run.json) while the in-memory signature is gone.
  const seeded = store.loadRun(runId);
  seeded.counters.idleRePrompts = 2;
  seeded.counters.futileRePrompts = 2;
  store.saveRun(seeded);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  assert.equal(state.lastSignature, null, "premise: the restarted process holds no observed signature");
  const stateHome = freshStateHome();

  const idle = async (): Promise<SessionIdleResult> => {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 2);
    return res;
  };

  const first = await idle();
  assert.equal(first.prompted, true, "the first post-restart idle still re-prompts");
  const afterFirst = readRunFile(store, runId);
  assert.equal(
    afterFirst.counters.futileRePrompts,
    2,
    "a pass with NO prior observation cannot claim the run failed to move: the persisted futile counter is carried forward untouched, never incremented on hearsay",
  );
  assert.equal(afterFirst.counters.idleRePrompts, 3, "premise: a prompt WAS sent, so the idle counter still advances");

  const moved = store.loadItem(runId, "I1");
  moved.state = "RED";
  store.saveItem(runId, moved);
  assert.notEqual(verdictOf(store, runId, queue).recommended, null, "premise: the moved fixture still recommends a tool");

  const second = await idle();
  assert.equal(second.stop, null, "the run MOVED, so the §3.7 wedge detector must not fire");
  assert.equal(second.prompted, true, "and the moving run is re-prompted again");
  const afterSecond = readRunFile(store, runId);
  assert.equal(
    afterSecond.counters.futileRePrompts,
    0,
    "the state change resets the persisted futile counter to 0, read back from run.json",
  );
  assert.equal(afterSecond.stop, null, "run.json carries no stop");
  assert.equal(store.currentRun()?.runId, runId, "the run is still live — a false wedge would have archived it");
  assert.equal(wiring.sdk.prompts.length, 2, "exactly two prompts across the two passes");
  store.release();
});

// ===========================================================================
// [10.1-noop-after-three-futile]
// ===========================================================================

test("[10.1-noop-after-three-futile] on a fixture where nothing ever changes, successive idles produce EXACTLY THREE prompts and the FOURTH produces none: the engine records run.stop {kind:'noop', reasonDisplay naming the futile count, tsMs from the injected clock} and every later idle prompts nothing and does not re-record the stop", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  writeFileSync(path.join(root, "tests", "p.test.mjs"), "// abandoned red\n");

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const idle = async (): Promise<SessionIdleResult> => {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 2);
    return res;
  };

  for (let pass = 1; pass <= 3; pass += 1) {
    const res = await idle();
    assert.equal(res.prompted, true, `pass ${pass} re-prompts`);
    assert.equal(readRunFile(store, runId).stop, null, `pass ${pass} records no stop`);
  }
  assert.equal(wiring.sdk.prompts.length, 3, "EXACTLY THREE prompts before the wedge is called");

  const stopClockMs = clock.read();
  const fourth = await idle();
  assert.equal(fourth.prompted, false, "the FOURTH idle produces no prompt");
  assert.equal(wiring.sdk.prompts.length, 3, "still exactly three prompts in total");

  const stopped = readRunFile(store, runId);
  assert.ok(stopped.stop !== null, "the fourth idle records a stop");
  assert.equal(stopped.stop?.kind, "noop", "the recorded kind is §2.9 `noop` — the single wedge detector");
  assert.equal(stopped.stop?.tsMs, stopClockMs, "the stop is stamped from the INJECTED clock, never Date.now");
  assert.match(
    String(stopped.stop?.reasonDisplay ?? ""),
    /3/,
    "the reasonDisplay names the futile re-prompt count that ended the run",
  );
  assert.equal(validate("Run", stopped).ok, true, "the stopped run.json still satisfies the §2.3 schema");
  assert.equal(isTerminal(stopped), true, "and the run is now terminal by core/stops.ts isTerminal");

  const stopBytes = rawOrEmpty(path.join(runDirOf(store, runId), "run.json"));
  for (let extra = 0; extra < 2; extra += 1) {
    const res = await idle();
    assert.equal(res.prompted, false, `later idle ${extra + 1} prompts nothing`);
  }
  assert.equal(wiring.sdk.prompts.length, 3, "no later idle re-prompts a stopped run");
  assert.equal(
    rawOrEmpty(path.join(runDirOf(store, runId), "run.json")),
    stopBytes,
    "the stop is not re-recorded — isTerminal short-circuits every later pass",
  );
  store.release();
});

// ===========================================================================
// [10.1-noop-anomaly-write-ahead]
// ===========================================================================

test("[10.1-noop-anomaly-write-ahead] §2.8 write-ahead: the noop path appends the schema-valid {ts, kind:'disengage', detail} anomaly BEFORE the stop-report — proven with an injected report writer that THROWS: the handler still returns (fail-soft), anomalies.jsonl carries the disengage line and run.json carries stop.kind 'noop', and one continuation/disengage record is emitted", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  const runDir = runDirOf(store, runId);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  let writerCalls = 0;
  const idle = async (): Promise<SessionIdleResult> => {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
      deps: {
        writeStopReport: async (): Promise<{ reportPath: string }> => {
          writerCalls += 1;
          throw new Error("INJECTED stop-report writer failure");
        },
      },
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 2);
    return res;
  };

  for (let pass = 1; pass <= 3; pass += 1) await idle();
  assert.equal(readAnomalies(runDir).length, 0, "premise: no anomaly is written while the run is merely being re-prompted");

  await idle();

  assert.equal(writerCalls, 1, "the noop path drove the stop-report writer exactly once");
  const anomalies = readAnomalies(runDir);
  const disengage = anomalies.filter((a) => a.kind === "disengage");
  assert.equal(disengage.length, 1, "exactly one §2.8 disengage anomaly survives the writer's failure");
  assert.equal(
    validate("AnomalyRecord", disengage[0]).ok,
    true,
    "the appended anomaly is a schema-valid §2.8 record",
  );
  assert.equal(disengage[0].ts, clock.read() - DEBOUNCE_MS * 2, "the anomaly is stamped from the injected clock");
  assert.ok(
    disengage[0].kind === "disengage" && disengage[0].detail.length > 0,
    "the disengage record carries a non-empty detail",
  );
  assert.equal(
    readRunFile(store, runId).stop?.kind,
    "noop",
    "the recorded stop survives the writer's failure too — a killed process leaves its trace",
  );
  assert.equal(
    continuationRecords(journal.records, "disengage").length,
    1,
    "exactly one continuation/disengage journal record",
  );
  store.release();
});

// ===========================================================================
// [10.1-noop-stop-report-one-writer]
// ===========================================================================

test("[10.1-noop-stop-report-one-writer] the noop path writes the §2.9 stop-report through the ONE mode-parameterized report writer and contains no report-writing code of its own: report.md exists with the stop kind in its headline, ZERO §2.6 'verify' records were appended, the abandoned red is in the stale-red registry — and continuation.ts never names store.addStaleRed", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  const runDir = runDirOf(store, runId);
  // The abandoned red test the §2.11 registry must disclose: it EXISTS on disk and its
  // item is below GREEN, which is exactly the shared helper's registration rule.
  writeFileSync(path.join(root, "tests", "p.test.mjs"), `// ${RED_MARKER}\n`);

  assert.deepEqual(store.readStaleRed().entries, [], "premise: the workspace registry starts empty");
  assert.equal(readEvidence(runDir).length, 0, "premise: the evidence ledger starts empty");

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const idle = async (): Promise<void> => {
    await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 2);
  };
  for (let pass = 1; pass <= 4; pass += 1) await idle();

  assert.equal(readRunFile(store, runId).stop?.kind, "noop", "premise: the wedge fired");

  const reportPath = path.join(runDir, "report.md");
  assert.equal(existsSync(reportPath), true, "the noop path leaves the §2.9 artifact behind");
  const report = readFileSync(reportPath, "utf8");
  const headline = report.split("\n")[0];
  assert.match(headline, /noop/, `the stop kind is in the report's headline; got: ${headline}`);
  assert.ok(report.includes("I1"), "the report names the run's item");

  assert.equal(
    readEvidence(runDir).filter((r) => r.kind === "verify").length,
    0,
    "a stop-report proves no claim and re-runs nothing (§2.9): ZERO verify records were appended",
  );
  assert.equal(
    existsSync(path.join(root, FALLBACK_TRIPWIRE)),
    false,
    "and the verify scope command never executed",
  );

  const stale = store.readStaleRed().entries.map((e) => e.path);
  assert.ok(
    stale.includes("tests/p.test.mjs"),
    `the abandoned red is registered in the §2.11 stale-red registry; got ${JSON.stringify(stale)}`,
  );

  // C-037 ruling 4: the registration happens inside the SHARED helper the report writer
  // calls, so the continuation engine must not reach past it to store.addStaleRed.
  const source = readFileSync(CONTINUATION_SRC, "utf8");
  assert.equal(
    source.includes("addStaleRed"),
    false,
    "continuation.ts must never name store.addStaleRed — the stale-red registration is the shared helper's",
  );
  store.release();
});

// ===========================================================================
// [10.1-engine-records-only-noop-and-interrupt]
// ===========================================================================

test("[10.1-engine-records-only-noop-and-interrupt] the engine records ONLY the two stop kinds §2.9 assigns to it: on fixtures where shouldTerminate returns blocked, surfaced and env the run.stop stays NULL and the engine re-prompts the gate's own recommendation instead", async () => {
  interface Case {
    name: string;
    seed: (store: StateStore, runId: string, runDir: string) => Queue;
    configOpts?: ConfigOpts;
    counters?: (run: Run) => void;
  }
  const cases: Case[] = [
    {
      name: "blocked (every item blocked, futileRePrompts 0)",
      seed: (store, runId) => {
        const queue: Queue = {
          items: [makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] })],
        };
        seedExecuting(store, runId, queue);
        store.setBlocked(runId, "I1", { reason: "waiting on the human", stage: "RED" });
        return queue;
      },
    },
    {
      name: "surfaced (no open item, no blocked item, an open human-territory question)",
      seed: (store, runId, runDir) => {
        const queue: Queue = {
          items: [makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] })],
        };
        seedExecuting(store, runId, queue, { I1: "PUBLISHED" });
        appendQuestion(
          runDir,
          {
            runId,
            question: HUMAN_Q,
            askedBy: { role: "orchestrator", sessionID: ORCH },
            humanTerritory: true,
            origin: "surface-tool",
            blocksItems: [],
          },
          START_MS,
        );
        return queue;
      },
    },
    {
      name: "env (the override budget is exhausted)",
      configOpts: { maxOverridesPerRun: 1 },
      seed: (store, runId) => seedOneItemExecuting(store, runId),
      counters: (run) => {
        run.counters.overridesUsed = 1;
      },
    },
  ];

  for (const kase of cases) {
    const root = scratchRepo();
    const config = makeConfig(kase.configOpts ?? {});
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue = kase.seed(store, runId, runDir);
    if (kase.counters !== undefined) {
      const run = store.loadRun(runId);
      kase.counters(run);
      store.saveRun(run);
    }

    const verdict = verdictOf(store, runId, queue);
    const recommended = verdict.recommended;
    assert.ok(recommended !== null, `${kase.name}: premise — the gate still offers a way forward`);

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state: createContinuationState(),
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: makeClock().now,
    });
    await turns();

    assert.equal(res.stop, null, `${kase.name}: the engine records no stop for this verdict`);
    assert.equal(
      readRunFile(store, runId).stop,
      null,
      `${kase.name}: run.stop stays null — blocked/surfaced belong to the report tool and env to the override hatch (§2.9:900-905)`,
    );
    assert.equal(existsSync(path.join(runDir, "report.md")), false, `${kase.name}: and no stop-report is written`);
    assert.equal(res.prompted, true, `${kase.name}: the engine re-prompts instead`);
    assert.equal(wiring.sdk.prompts.length, 1, `${kase.name}: exactly one prompt`);
    assert.ok(
      wiring.sdk.prompts[0].text.includes(recommended.tool),
      `${kase.name}: naming the gate's own recommendation (${recommended.tool})`,
    );
    store.release();
  }
});

// ===========================================================================
// [10.1-halt-interrupt]
// ===========================================================================

test("[10.1-halt-interrupt] §3.7.3: with the halt file present an orchestrator idle sends ZERO prompts even on a non-terminal run with a live recommendation, futileRePrompts 0 and INSIDE the 2s debounce window — halt outranks all of them; the engine records stop {kind:'interrupt'} naming the halt file, writes the stop-report through the same one writer, emits one continuation/disengage record, and writes NO disengage anomaly", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue = seedOneItemExecuting(store, runId);
  const runDir = runDirOf(store, runId);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();

  const idle = async (): Promise<SessionIdleResult> => {
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    return res;
  };

  // One ordinary pass first, so the NEXT pass is provably INSIDE the debounce window —
  // halt has to outrank the guard that would otherwise have suppressed a prompt anyway,
  // and it has to fire without a single futile re-prompt on the clock.
  await idle();
  assert.equal(wiring.sdk.prompts.length, 1, "premise: the run was being re-prompted normally");
  const counters = readRunFile(store, runId).counters;
  assert.equal(counters.futileRePrompts, 1, "premise: the wedge detector is nowhere near its threshold");
  assert.notEqual(verdictOf(store, runId, queue).recommended, null, "premise: the gate still recommends a tool");

  // §3.7.3's halt file — adapter/state.ts:709 reads exactly this path.
  const haltPath = path.join(root, ".conductor", "state", "halt");
  mkdirSync(path.dirname(haltPath), { recursive: true });
  writeFileSync(haltPath, "stop\n");
  assert.equal(store.isHalted(), true, "premise: store.isHalted() sees the halt file");

  clock.advance(1); // still deep inside the 2s window opened by the first re-prompt
  const haltMs = clock.read();
  const res = await idle();

  assert.equal(res.prompted, false, "a halted run is never re-prompted");
  assert.equal(wiring.sdk.prompts.length, 1, "no prompt was sent on the halt pass");

  const run = readRunFile(store, runId);
  assert.equal(run.stop?.kind, "interrupt", "the engine records §2.9 `interrupt` for a human halt");
  assert.equal(run.stop?.tsMs, haltMs, "stamped from the injected clock");
  assert.match(String(run.stop?.reasonDisplay ?? ""), /halt/i, "the reasonDisplay names the halt file");
  assert.equal(validate("Run", run).ok, true, "the halted run.json still satisfies the §2.3 schema");

  assert.equal(existsSync(path.join(runDir, "report.md")), true, "the halt path writes the stop-report through the same writer");
  assert.match(readFileSync(path.join(runDir, "report.md"), "utf8").split("\n")[0], /interrupt/, "whose headline names the interrupt");

  assert.equal(
    readAnomalies(runDir).filter((a) => a.kind === "disengage").length,
    0,
    "a human halt is NOT a §2.8 anomaly — the disengage kind belongs to the noop wedge alone",
  );
  assert.equal(
    continuationRecords(journal.records, "disengage").length,
    1,
    "exactly one continuation/disengage journal record",
  );
  store.release();
});

// ===========================================================================
// [10.1-terminal-never-reprompted]
// ===========================================================================

test("[10.1-terminal-never-reprompted] isTerminal runs are NEVER re-prompted, asserted for all FOUR shapes — ANSWERED, REPORTED, TRIVIAL_DONE, and EXECUTING with a recorded stop — with zero prompts and zero counter writes each", async () => {
  interface Shape {
    name: string;
    state: Run["state"];
    stop: Run["stop"];
  }
  const shapes: Shape[] = [
    { name: "ANSWERED", state: "ANSWERED", stop: null },
    { name: "REPORTED", state: "REPORTED", stop: null },
    { name: "TRIVIAL_DONE", state: "TRIVIAL_DONE", stop: null },
    {
      name: "EXECUTING with a recorded stop (the case §2.3 flags as previously missed)",
      state: "EXECUTING",
      stop: { kind: "noop", reasonDisplay: "wedged", tsMs: START_MS },
    },
  ];

  for (const shape of shapes) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    seedOneItemExecuting(store, runId);
    const run = store.loadRun(runId);
    run.state = shape.state;
    run.stop = shape.stop;
    store.saveRun(run);
    assert.equal(isTerminal(store.loadRun(runId)), true, `${shape.name}: premise — core isTerminal says terminal`);
    const countersBefore = readRunFile(store, runId).counters;

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const res: SessionIdleResult = await handleSessionIdle({
      store,
      state: createContinuationState(),
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: makeClock().now,
    });
    await turns();

    assert.equal(res.prompted, false, `${shape.name}: a terminal run is never re-prompted`);
    assert.equal(wiring.sdk.prompts.length, 0, `${shape.name}: zero prompts`);
    assert.deepEqual(
      readRunFile(store, runId).counters,
      countersBefore,
      `${shape.name}: zero counter writes`,
    );
    store.release();
  }
});

// ===========================================================================
// [10.1-archive-terminal-run]
// ===========================================================================

test("[10.1-archive-terminal-run] C-029(a)/SG-4: a terminal run observed at idle is ARCHIVED in that same pass — for the ANSWERED run conductor_classify's question path leaves behind (no queue.json on disk) and for a stop-terminal run — after which currentRun() is null while runs/<runId>/run.json is still readable, and a second idle neither throws nor re-archives", async () => {
  interface Shape {
    name: string;
    withQueue: boolean;
    apply: (run: Run) => void;
  }
  const shapes: Shape[] = [
    {
      // §3.2:1081 "question ⇒ the orchestrator answers; state ANSWERED, run archived".
      // handleClassify is NOT edited by this task — archival is wired HERE. A question run
      // never decomposes, so there is no queue.json and the pass must tolerate that.
      name: "ANSWERED (a question run, no queue.json)",
      withQueue: false,
      apply: (run) => {
        run.state = "ANSWERED";
        run.classification = { kind: "question", rationale: "a question", check: { agreed: true, note: "" } };
      },
    },
    {
      name: "EXECUTING with stop noop",
      withQueue: true,
      apply: (run) => {
        run.stop = { kind: "noop", reasonDisplay: "wedged", tsMs: START_MS };
      },
    },
  ];

  for (const shape of shapes) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    if (shape.withQueue) {
      seedOneItemExecuting(store, runId);
    }
    const run = store.loadRun(runId);
    if (shape.withQueue) run.state = "EXECUTING";
    shape.apply(run);
    store.saveRun(run);
    assert.equal(
      existsSync(path.join(runDirOf(store, runId), "queue.json")),
      shape.withQueue,
      `${shape.name}: premise — the queue file presence matches the shape`,
    );
    assert.equal(store.currentRun()?.runId, runId, `${shape.name}: premise — the run is current`);

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const clock = makeClock();
    const state = createContinuationState();
    const stateHome = freshStateHome();
    const idle = async (): Promise<SessionIdleResult> => {
      const res: SessionIdleResult = await handleSessionIdle({
        store,
        state,
        registry,
        sessionID: ORCH,
        client: wiring.client,
        config,
        journal: journal.sink,
        stateHome,
        workspaceKey: "wk",
        now: clock.now,
      });
      await turns();
      clock.advance(DEBOUNCE_MS * 2);
      return res;
    };

    await idle();
    assert.equal(store.currentRun(), null, `${shape.name}: the terminal run is archived in the same pass`);
    const onDisk = readRunFile(store, runId);
    assert.equal(onDisk.state, shape.withQueue ? "EXECUTING" : "ANSWERED", `${shape.name}: archiving is not deletion — run.json is still readable`);
    assert.equal(validate("Run", onDisk).ok, true, `${shape.name}: and still schema-valid`);

    const second = await idle();
    assert.equal(second.runId, null, `${shape.name}: a second idle finds no live run`);
    assert.equal(second.prompted, false, `${shape.name}: and prompts nothing`);
    assert.equal(wiring.sdk.prompts.length, 0, `${shape.name}: no prompt was ever sent`);
    store.release();
  }
});

// ===========================================================================
// [10.1-archive-removes-worktrees]
// ===========================================================================

test("[10.1-archive-removes-worktrees] C-037 ruling 6 / the 9.6 binding: on the archival pass the engine calls adapter/worktrees.ts removeWorktree for every item whose persisted item.worktree is non-null and for NO other item — `git worktree list` names none of the run's worktrees afterwards, the state-home directories are gone, and an injected recorder proves the exact call set", async () => {
  // ---- part 1: the REAL removal against a real fixture repo -----------------
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"] }),
      makeQueueItem("I3", { fileScope: ["src/c.ts"], testScope: ["tests/c.test.ts"] }),
    ],
  };
  seedExecuting(store, runId, queue, { I1: "PUBLISHED", I2: "PUBLISHED", I3: "PUBLISHED" });

  const stateHome = freshStateHome();
  const workspaceKey = "wk-archive";
  const ctx = { stateHome, workspaceKey };
  const treePaths: Record<string, string> = {};
  for (const itemId of ["I1", "I2"]) {
    treePaths[itemId] = createWorktree(root, runId, itemId, ctx);
    const item = store.loadItem(runId, itemId);
    item.worktree = treePaths[itemId];
    store.saveItem(runId, item);
  }
  assert.equal(store.loadItem(runId, "I3").worktree, null, "premise: I3 never had a worktree");
  for (const itemId of ["I1", "I2"]) {
    assert.equal(existsSync(treePaths[itemId]), true, `premise: ${itemId}'s worktree exists on disk`);
    assert.ok(
      git(root, ["worktree", "list", "--porcelain"]).includes(itemId),
      `premise: git knows about ${itemId}'s worktree`,
    );
  }

  const run = store.loadRun(runId);
  run.state = "REPORTED";
  run.stop = { kind: "done", reasonDisplay: "the run completed", tsMs: START_MS };
  store.saveRun(run);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  await handleSessionIdle({
    store,
    state: createContinuationState(),
    registry,
    sessionID: ORCH,
    client: wiring.client,
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey,
    now: makeClock().now,
  });
  await turns();

  const listing = git(root, ["worktree", "list", "--porcelain"]);
  for (const itemId of ["I1", "I2"]) {
    assert.equal(
      listing.includes(treePaths[itemId]),
      false,
      `git worktree list no longer names ${itemId}'s worktree; got: ${listing}`,
    );
    assert.equal(existsSync(treePaths[itemId]), false, `${itemId}'s state-home worktree directory is gone`);
  }
  assert.equal(store.currentRun(), null, "the run is archived after the cleanup");
  assert.equal(
    existsSync(path.join(runDirOf(store, runId), "run.json")),
    true,
    "archiveRun itself still deletes nothing (the 9.6 pin holds)",
  );
  store.release();

  // ---- part 2: the exact call set, through an injected recorder -------------
  const root2 = scratchRepo();
  const journal2 = makeJournal();
  const store2 = openStore(root2, journal2.sink, config);
  const runId2 = createRunFor(store2);
  seedExecuting(store2, runId2, queue, { I1: "PUBLISHED", I2: "PUBLISHED", I3: "PUBLISHED" });
  for (const itemId of ["I1", "I2"]) {
    const item = store2.loadItem(runId2, itemId);
    item.worktree = path.join(stateHome, "conductor", workspaceKey, "worktrees", runId2, itemId);
    store2.saveItem(runId2, item);
  }
  const run2 = store2.loadRun(runId2);
  run2.state = "REPORTED";
  store2.saveRun(run2);

  const removed: Array<{ workspace: string; runId: string; itemId: string; stateHome: string; workspaceKey: string }> = [];
  const registry2 = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring2 = makeWiring(registry2);
  await handleSessionIdle({
    store: store2,
    state: createContinuationState(),
    registry: registry2,
    sessionID: ORCH,
    client: wiring2.client,
    config,
    journal: journal2.sink,
    stateHome,
    workspaceKey,
    now: makeClock().now,
    deps: {
      removeWorktree: (
        workspace: string,
        rid: string,
        itemId: string,
        wctx: { stateHome: string; workspaceKey: string },
      ): void => {
        removed.push({ workspace, runId: rid, itemId, stateHome: wctx.stateHome, workspaceKey: wctx.workspaceKey });
      },
    },
  });
  await turns();

  assert.deepEqual(
    removed.map((r) => r.itemId).sort(),
    ["I1", "I2"],
    "removeWorktree is called for exactly the items carrying a worktree — an item that never had one contributes no call",
  );
  for (const call of removed) {
    assert.equal(call.workspace, root2, "the call names the workspace root");
    assert.equal(call.runId, runId2, "and this run");
    assert.equal(call.stateHome, stateHome, "and the out-of-repo state home it was created under");
    assert.equal(call.workspaceKey, workspaceKey, "and the workspace key");
  }
  store2.release();
});

// ===========================================================================
// [10.1-plugin-event-hook-routes]
// ===========================================================================

test("[10.1-plugin-event-hook-routes] the plugin factory's hooks gain an `event` function beside the unchanged `tool` map and `tool.execute.before`, and it ROUTES by event.type: session.idle reaches the idle engine (a re-prompt is observed) and permission.asked reaches the ask gate (a reply is recorded), while every other type — permission.replied, session.created — is ignored with no prompt, no reply and no throw", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  // The plugin opens the workspace itself (P4), so it reads its §2.1 Config from disk.
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  // Release OUR lock first: adapter/state.ts:234 degrades a second opener to read-only,
  // and the plugin must be the single writer for this process (G6).
  store.release();

  const wiring = makeWiring(makeRegistry());
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  const hooks = await factory({
    client: wiring.client,
    project: { id: "prj_test", worktree: root },
    directory: root,
    worktree: root,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  });

  assert.equal(typeof hooks.event, "function", "the plugin installs an `event` hook");
  assert.equal(typeof hooks.tool, "object", "the `tool` map is unchanged");
  assert.equal(
    typeof hooks["tool.execute.before"],
    "function",
    "and the tool.execute.before gate hook is still installed",
  );
  const fire = hooks.event;
  assert.ok(fire !== undefined, "the event hook is present");

  // Types the router must IGNORE, fired first so a later observation cannot be theirs.
  for (const type of ["permission.replied", "session.created", "message.updated"]) {
    await fire({ event: { type, properties: { sessionID: ORCH, id: "per_ignored" } } });
  }
  await turns();
  assert.equal(wiring.sdk.prompts.length, 0, "an unrouted event type sends no prompt");
  assert.equal(wiring.replies.length, 0, "and replies to nothing");

  // session.idle -> the idle engine.
  await fire({ event: { type: "session.idle", properties: { sessionID: ORCH } } });
  await turns();
  assert.equal(wiring.sdk.prompts.length, 1, "a session.idle payload reaches the idle engine");
  assert.equal(wiring.sdk.prompts[0].sessionID, ORCH, "and the re-prompt is addressed to the orchestrator session");

  // permission.asked -> the ask gate. An unregistered session is rejected (registry-first),
  // which is an observation no registration is needed to make.
  await fire({
    event: {
      type: "permission.asked",
      properties: {
        id: "per_route_1",
        sessionID: "ses_unknown_to_the_registry",
        permission: "edit",
        patterns: [`${root}/src/a.ts`],
        metadata: { filePath: `${root}/src/a.ts` },
      },
    },
  });
  await turns();
  assert.equal(wiring.replies.length, 1, "a permission.asked payload reaches the ask gate");
  assert.equal(wiring.replies[0].permissionID, "per_route_1", "the reply names the permission id from the payload");
  assert.equal(wiring.replies[0].response, "reject", "and an unregistered session is rejected");
});

// ===========================================================================
// [10.1-event-hook-failsoft]
// ===========================================================================

test("[10.1-event-hook-failsoft] G5 fail-soft: a throw from inside either handler is CAUGHT by the event router, journaled once at level 'error' under a name the closed §7.4 vocabulary accepts, and NOT propagated — the returned promise resolves", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const BOOM = "INJECTED store failure 4471";
  // A store whose run reads THROW — the injected fault both handlers must survive.
  const brokenStore: StateStore = {
    ...store,
    currentRun(): Run | null {
      throw new Error(BOOM);
    },
    loadRun(): Run {
      throw new Error(BOOM);
    },
    loadItem(): Item {
      throw new Error(BOOM);
    },
  };

  const registry = makeRegistry([
    [ORCH, { role: "orchestrator" }],
    [SUB, { role: "implementer", itemId: "I1", tree: root }],
  ]);
  const wiring = makeWiring(registry);

  for (const event of [
    { type: "session.idle", properties: { sessionID: ORCH } },
    {
      type: "permission.asked",
      properties: { id: "per_failsoft", sessionID: SUB, permission: "edit", metadata: { filePath: `${root}/src/a.ts` } },
    },
  ]) {
    const fresh = makeJournal();
    await handlePluginEvent({
      event,
      store: brokenStore,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      config,
      journal: fresh.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: makeClock().now,
    });
    await turns();

    const errors = fresh.records.filter((r) => r.level === "error");
    assert.equal(errors.length, 1, `${event.type}: the crash is journaled exactly once at error level`);
    assert.equal(
      isKnownEvent(errors[0].component, errors[0].event),
      true,
      `${event.type}: "${errors[0].component}/${errors[0].event}" must be in the closed §7.4 vocabulary (core/journal-events.ts)`,
    );
    assert.ok(
      JSON.stringify(errors[0].data).includes(BOOM),
      `${event.type}: the record carries the underlying failure so the crash is reproducible (§7.4)`,
    );
  }
  store.release();
});

// ===========================================================================
// [10.1-ask-unregistered-reject]
// ===========================================================================

test("[10.1-ask-unregistered-reject] registry-first: a permission.asked whose sessionID has NO registry entry is rejected with exactly one reply, whatever the permission kind, and journaled gates/deny naming the missing registration", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  for (const permission of ["edit", "question", "bash"]) {
    const fresh = makeJournal();
    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const event: AskEvent = {
      id: `per_unreg_${permission}`,
      sessionID: "ses_not_in_the_registry",
      permission,
      patterns: [`${root}/src/a.ts`],
      metadata: { filePath: `${root}/src/a.ts`, question: TECHNICAL_Q },
    };
    const res: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event,
      journal: fresh.sink,
      now: makeClock().now,
    });

    assert.equal(res.replied, "reject", `${permission}: an unregistered session is rejected`);
    assert.equal(wiring.replies.length, 1, `${permission}: exactly one reply is sent`);
    assert.deepEqual(
      wiring.replies[0],
      { sessionID: event.sessionID, permissionID: event.id, response: "reject" },
      `${permission}: the reply rides the wire-verified route with the ask's own ids`,
    );
    const denies = gateRecords(fresh.records, "deny");
    assert.equal(denies.length, 1, `${permission}: exactly one gates/deny record`);
    assert.match(
      JSON.stringify(denies[0].data),
      /registr/i,
      `${permission}: the deny names the missing registration, not a scope`,
    );
  }
  store.release();
});

// ===========================================================================
// [10.1-ask-subsession-reject-once]
// ===========================================================================

test("[10.1-ask-subsession-reject-once] §3.5(b): a permission.asked from any sub-session role is rejected for EVERY permission kind — 'question' included, which §5.3 grants precisely so the plugin can refuse it — through client.postSessionIdPermissionsPermissionId({path:{id,permissionID},body:{response:'reject'}}), journaled gates/deny; a REPEAT delivery of the same permission id sends NO second reply", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const roles = ["implementer", "testWriter", "reviewer", "skeptic", "planner", "mechanical"];
  const kinds = ["edit", "question", "bash", "webfetch"];

  for (const role of roles) {
    for (const permission of kinds) {
      const fresh = makeJournal();
      const sessionID = `ses_${role}`;
      const registry = makeRegistry([
        [ORCH, { role: "orchestrator" }],
        [sessionID, { role, itemId: "I1", tree: root }],
      ]);
      const wiring = makeWiring(registry);
      const state = createContinuationState();
      const event: AskEvent = {
        id: `per_${role}_${permission}`,
        sessionID,
        permission,
        patterns: [`${root}/src/parser.mjs`],
        metadata: { filePath: `${root}/src/parser.mjs`, question: TECHNICAL_Q },
      };

      const first: PermissionAskedResult = await handlePermissionAsked({
        store,
        state,
        registry,
        client: wiring.client,
        event,
        journal: fresh.sink,
        now: makeClock().now,
      });
      assert.equal(first.replied, "reject", `${role}/${permission}: a sub-session ask is rejected`);
      assert.equal(wiring.replies.length, 1, `${role}/${permission}: exactly one reply`);
      assert.deepEqual(
        wiring.replies[0],
        { sessionID, permissionID: event.id, response: "reject" },
        `${role}/${permission}: the reply carries {path:{id,permissionID}, body:{response:'reject'}}`,
      );
      assert.equal(
        gateRecords(fresh.records, "deny").length,
        1,
        `${role}/${permission}: journaled gates/deny`,
      );

      // The bus may re-deliver: adjudication is ONCE PER PERMISSION ID.
      const repeat: PermissionAskedResult = await handlePermissionAsked({
        store,
        state,
        registry,
        client: wiring.client,
        event,
        journal: fresh.sink,
        now: makeClock().now,
      });
      assert.equal(repeat.replied, null, `${role}/${permission}: a repeat delivery replies again to nothing`);
      assert.equal(
        wiring.replies.length,
        1,
        `${role}/${permission}: still exactly one reply after the re-delivery`,
      );
    }
  }
  store.release();
});

// ===========================================================================
// [10.1-ask-needs-context-conversion]
// ===========================================================================

test("[10.1-ask-needs-context-conversion] SG-5: the sub-session rejection converts to {sessionID, itemId, status:'NEEDS_CONTEXT', neededContext naming the denied permission and its patterns}, the ENGINE's next orchestrator re-prompt carries the item id and that neededContext string, it is surfaced EXACTLY ONCE, and the item's own FSM state and blocked disposition are unchanged", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  const runDir = runDirOf(store, runId);

  const registry = makeRegistry([
    [ORCH, { role: "orchestrator" }],
    [SUB, { role: "implementer", itemId: "I1", tree: root }],
  ]);
  const wiring = makeWiring(registry);
  const state = createContinuationState();
  const clock = makeClock();
  const stateHome = freshStateHome();
  const DENIED_PATTERN = `${root}/src/forbidden-4712.ts`;
  const itemBefore = itemFileBytes(runDir, "I1");

  const res: PermissionAskedResult = await handlePermissionAsked({
    store,
    state,
    registry,
    client: wiring.client,
    event: {
      id: "per_needs_context",
      sessionID: SUB,
      permission: "edit",
      patterns: [DENIED_PATTERN],
      metadata: { filePath: DENIED_PATTERN },
    },
    journal: journal.sink,
    now: clock.now,
  });

  assert.equal(res.replied, "reject", "the sub-session ask is rejected");
  const conversion = res.conversion;
  assert.ok(conversion !== null, "and the rejection converts to a surfaceable disposition");
  assert.equal(conversion.sessionID, SUB, "the conversion names the sub-session");
  assert.equal(conversion.itemId, "I1", "and the item id taken from the registry entry");
  assert.equal(
    conversion.status,
    "NEEDS_CONTEXT",
    "reusing the committed §2.10 ImplementerStatus member — no new status is invented",
  );
  assert.ok(conversion.neededContext.includes("edit"), "the neededContext names the denied permission");
  assert.ok(conversion.neededContext.includes(DENIED_PATTERN), "and the pattern it was denied for");

  assert.equal(itemFileBytes(runDir, "I1"), itemBefore, "the item's FSM state and blocked disposition are unchanged");

  const idle = async (): Promise<SessionIdleResult> => {
    const out: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 2);
    return out;
  };

  await idle();
  assert.equal(wiring.sdk.prompts.length, 1, "the engine re-prompts the orchestrator");
  const surfaced = wiring.sdk.prompts[0].text;
  assert.ok(surfaced.includes("I1"), "the re-prompt names the item whose sub-session was denied");
  assert.ok(
    surfaced.includes(conversion.neededContext),
    `the re-prompt carries the neededContext verbatim; got: ${surfaced}`,
  );

  await idle();
  assert.equal(wiring.sdk.prompts.length, 2, "a second idle re-prompts normally");
  assert.equal(
    wiring.sdk.prompts[1].text.includes(conversion.neededContext),
    false,
    "but does NOT repeat the conversion — the surface queue is drained on delivery",
  );
  store.release();
});

// ===========================================================================
// [10.1-ask-claim-allow]
// ===========================================================================

test("[10.1-ask-claim-allow] §3.6/SG-9: an ORCHESTRATOR edit ask for an ABSOLUTE path under the workspace root, while the item whose queue fileScope covers it carries a non-null inlineClaim, is replied ALLOW with response 'once' and journaled gates/allow — which only holds once the session tree resolves to the workspace root, because the committed empty-tree default mangles the absolute path", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["tests/**"] })],
  };
  seedExecuting(store, runId, queue);
  const item = store.loadItem(runId, "I1");
  item.inlineClaim = { reason: "dispatching this one-line fix costs more than doing it", decisionId: "D-0001" };
  store.saveItem(runId, item);

  // §3.5:1344-1347 / adapter/chat-message.ts:75 — the orchestrator's entry carries NO tree.
  const orchestratorEntry: RegistryEntry = { role: "orchestrator" };
  const registry = makeRegistry([[ORCH, orchestratorEntry]]);
  assert.equal(orchestratorEntry.tree, undefined, "premise: the orchestrator's registry entry has no tree");
  assert.equal(
    resolveSessionTree(store, orchestratorEntry),
    root,
    "SG-9: the tree resolver falls back to the workspace root, not the empty string",
  );
  const scope = activeInlineClaimScope(store, runId);
  assert.deepEqual(scope, ["src/**"], "the ONE derivation yields the claimed item's §2.4 fileScope");

  const wiring = makeWiring(registry);
  const askedPath = path.join(root, "src", "parser.mjs");
  const res: PermissionAskedResult = await handlePermissionAsked({
    store,
    state: createContinuationState(),
    registry,
    client: wiring.client,
    event: {
      id: "per_claim_allow",
      sessionID: ORCH,
      permission: "edit",
      patterns: [askedPath],
      metadata: { filePath: askedPath },
    },
    journal: journal.sink,
    now: makeClock().now,
  });

  assert.equal(res.replied, "once", "an orchestrator edit covered by an active claim is ALLOWED");
  assert.equal(wiring.replies.length, 1, "with exactly one reply");
  assert.equal(
    wiring.replies[0].response,
    "once",
    "response 'once' — the only affirmative value wire-notes.md:34 verified",
  );
  const allows = gateRecords(journal.records, "allow");
  assert.equal(allows.length, 1, "journaled gates/allow");
  assert.ok(
    JSON.stringify(allows[0].data).includes(askedPath),
    "the record carries the adjudicated path (§7.4 reproducibility)",
  );
  store.release();
});

// ===========================================================================
// [10.1-ask-noclaim-reject]
// ===========================================================================

test("[10.1-ask-noclaim-reject] the SAME orchestrator edit ask is replied REJECT for four shapes: no claim anywhere; a claim whose fileScope does not cover the path; a claim on a PUBLISHED item; and a `..` or .conductor/ path that a wildcard claim scope would otherwise glob-match", async () => {
  interface Shape {
    name: string;
    fileScope: string[];
    itemState: ItemState;
    claim: boolean;
    askRel: string;
  }
  const shapes: Shape[] = [
    { name: "(a) no item carries an inlineClaim", fileScope: ["src/**"], itemState: "PENDING", claim: false, askRel: "src/parser.mjs" },
    { name: "(b) the claim's fileScope does not cover the path", fileScope: ["docs/**"], itemState: "PENDING", claim: true, askRel: "src/parser.mjs" },
    { name: "(c) the claim is on a PUBLISHED item (SG-8: a finished item covers nothing)", fileScope: ["src/**"], itemState: "PUBLISHED", claim: true, askRel: "src/parser.mjs" },
    { name: "(d1) a `..` segment under a wildcard claim (gates-edit.ts:183)", fileScope: ["**"], itemState: "PENDING", claim: true, askRel: "src/../../escape.ts" },
    { name: "(d2) a .conductor/ path under a wildcard claim (gates-edit.ts:208)", fileScope: ["**"], itemState: "PENDING", claim: true, askRel: ".conductor/state/halt" },
  ];

  for (const shape of shapes) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const queue: Queue = {
      items: [makeQueueItem("I1", { fileScope: [...shape.fileScope], testScope: ["tests/**"] })],
    };
    seedExecuting(store, runId, queue, { I1: shape.itemState });
    if (shape.claim) {
      const item = store.loadItem(runId, "I1");
      item.inlineClaim = { reason: "inline is cheaper here", decisionId: "D-0001" };
      store.saveItem(runId, item);
    }

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const askedPath = `${root}/${shape.askRel}`;
    const res: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event: {
        id: "per_noclaim",
        sessionID: ORCH,
        permission: "edit",
        patterns: [askedPath],
        metadata: { filePath: askedPath },
      },
      journal: journal.sink,
      now: makeClock().now,
    });

    assert.equal(res.replied, "reject", `${shape.name}: the ask is rejected`);
    assert.equal(wiring.replies.length, 1, `${shape.name}: exactly one reply`);
    assert.equal(wiring.replies[0].response, "reject", `${shape.name}: response 'reject'`);
    assert.equal(gateRecords(journal.records, "deny").length, 1, `${shape.name}: journaled gates/deny`);
    assert.equal(gateRecords(journal.records, "allow").length, 0, `${shape.name}: and nothing was allowed`);
    store.release();
  }
});

// ===========================================================================
// [10.1-ask-claim-one-derivation-both-seams]
// ===========================================================================

test("[10.1-ask-claim-one-derivation-both-seams] the active-claim scope is ONE exported derivation feeding BOTH gates: with the claim active gateBeforeToolCall does NOT throw for the orchestrator's edit AND the permission reply is 'once'; with the claim removed gateBeforeToolCall throws the G8 reason AND the reply is 'reject' — no fixture can exist where one seam allows and the other denies", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["tests/**"] })],
  };
  seedExecuting(store, runId, queue);
  const claimed = store.loadItem(runId, "I1");
  claimed.inlineClaim = { reason: "inline is cheaper here", decisionId: "D-0001" };
  store.saveItem(runId, claimed);

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const askedPath = path.join(root, "src", "parser.mjs");

  const driveGate = (): void => {
    gateBeforeToolCall({
      sessionID: ORCH,
      toolName: "edit",
      args: { filePath: askedPath },
      editPath: askedPath,
      registry,
      gitMode: "commit",
      runActive: true,
      branchPolicy: "pin",
      fileScope: [],
      testScope: [],
      verifyInFlightTree: null,
      // The SAME derivation the ask-gate reads. This row drives it directly; the
      // PRODUCTION wiring that has to make the same call is driven through the
      // plugin's own hook by the row of the same name at the foot of this file.
      inlineClaimScope: activeInlineClaimScope(store, runId),
      journal: journal.sink,
      corr: { runId, sessionID: ORCH },
    });
  };

  // The tool.execute.before seam evaluates the path against the SESSION TREE, which for a
  // tree-less orchestrator entry must resolve to the workspace root (SG-9).
  assert.equal(resolveSessionTree(store, registry.get(ORCH)), root, "premise: the resolved orchestrator tree is the root");

  // --- claim ACTIVE: both seams allow -------------------------------------
  assert.deepEqual(activeInlineClaimScope(store, runId), ["src/**"], "premise: the derivation yields the claimed scope");
  assert.doesNotThrow(driveGate, "with the claim active, tool.execute.before allows the orchestrator's edit");

  const allowWiring = makeWiring(registry);
  const allowed: PermissionAskedResult = await handlePermissionAsked({
    store,
    state: createContinuationState(),
    registry,
    client: allowWiring.client,
    event: {
      id: "per_both_seams_allow",
      sessionID: ORCH,
      permission: "edit",
      patterns: [askedPath],
      metadata: { filePath: askedPath },
    },
    journal: journal.sink,
    now: makeClock().now,
  });
  assert.equal(allowed.replied, "once", "and the permission ask for the SAME path is allowed");

  // --- claim REMOVED: both seams deny -------------------------------------
  const unclaimed = store.loadItem(runId, "I1");
  unclaimed.inlineClaim = null;
  store.saveItem(runId, unclaimed);
  assert.equal(activeInlineClaimScope(store, runId), null, "premise: the derivation now yields no scope at all");

  let caught: unknown = null;
  try {
    driveGate();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error, "with the claim gone, tool.execute.before DENIES by throwing");
  assert.match(
    (caught as Error).message,
    /inline claim/i,
    "and the thrown reason is core gates-edit's G8 reason naming the inline claim",
  );

  const denyWiring = makeWiring(registry);
  const denied: PermissionAskedResult = await handlePermissionAsked({
    store,
    state: createContinuationState(),
    registry,
    client: denyWiring.client,
    event: {
      id: "per_both_seams_deny",
      sessionID: ORCH,
      permission: "edit",
      patterns: [askedPath],
      metadata: { filePath: askedPath },
    },
    journal: journal.sink,
    now: makeClock().now,
  });
  assert.equal(denied.replied, "reject", "and the permission ask for the SAME path is rejected");
  store.release();
});

// ===========================================================================
// [10.1-ask-path-unextractable-reject]
// ===========================================================================

test("[10.1-ask-path-unextractable-reject] SG-10 fail-closed: an orchestrator edit ask from whose payload no concrete file path can be extracted — no metadata.filePath, no metadata.path, and patterns absent, empty or wildcard-only — is REJECTED and journaled gates/deny naming the unextractable payload, EVEN WHEN an active claim exists", async () => {
  const shapes: Array<{ name: string; patterns?: string[]; metadata?: Record<string, unknown> }> = [
    { name: "patterns absent, metadata absent" },
    { name: "patterns empty", patterns: [], metadata: {} },
    { name: "patterns wildcard-only", patterns: ["**", "src/*"], metadata: {} },
    { name: "metadata carries neither filePath nor path", patterns: [], metadata: { reason: "an edit", tool: "edit" } },
  ];

  for (const shape of shapes) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const queue: Queue = { items: [makeQueueItem("I1", { fileScope: ["**"], testScope: ["tests/**"] })] };
    seedExecuting(store, runId, queue);
    const item = store.loadItem(runId, "I1");
    item.inlineClaim = { reason: "inline is cheaper here", decisionId: "D-0001" };
    store.saveItem(runId, item);
    assert.deepEqual(
      activeInlineClaimScope(store, runId),
      ["**"],
      `${shape.name}: premise — a wildcard claim IS active, so a reject cannot be an accident of scope`,
    );

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const event: AskEvent = {
      id: "per_unextractable",
      sessionID: ORCH,
      permission: "edit",
      ...(shape.patterns !== undefined ? { patterns: shape.patterns } : {}),
      ...(shape.metadata !== undefined ? { metadata: shape.metadata } : {}),
    };
    const res: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event,
      journal: journal.sink,
      now: makeClock().now,
    });

    assert.equal(res.replied, "reject", `${shape.name}: an unrecognized payload degrades to 'the claim does not work'`);
    assert.equal(wiring.replies.length, 1, `${shape.name}: exactly one reply`);
    assert.equal(wiring.replies[0].response, "reject", `${shape.name}: response 'reject'`);
    const denies = gateRecords(journal.records, "deny");
    assert.equal(denies.length, 1, `${shape.name}: journaled gates/deny`);
    assert.match(
      JSON.stringify(denies[0].data),
      /path/i,
      `${shape.name}: the deny names the unextractable path in its payload snapshot`,
    );
    store.release();
  }
});

// ===========================================================================
// [10.1-ask-question-allowed-verdict-journaled]
// ===========================================================================

test("[10.1-ask-question-allowed-verdict-journaled] §3.5: an ORCHESTRATOR ask with permission 'question' is ALLOWED ('once') but counted and journaled with Task 1.5's verdict — one gates/allow record carrying permission:'question' and humanTerritory === core/decide isHumanTerritory(text), asserted on BOTH polarities; with no extractable text the record carries humanTerritory false plus textAvailable false and the reply is still allow", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  interface Shape {
    name: string;
    metadata: Record<string, unknown>;
    humanTerritory: boolean;
    textAvailable: boolean;
  }
  const shapes: Shape[] = [
    { name: "a §6.2 human-territory question", metadata: { question: HUMAN_Q }, humanTerritory: true, textAvailable: true },
    { name: "a derivable technical question", metadata: { question: TECHNICAL_Q }, humanTerritory: false, textAvailable: true },
    { name: "no extractable question text", metadata: { reason: "asking" }, humanTerritory: false, textAvailable: false },
  ];

  for (const shape of shapes) {
    const fresh = makeJournal();
    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const res: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event: {
        id: `per_question_${shape.humanTerritory}_${shape.textAvailable}`,
        sessionID: ORCH,
        permission: "question",
        metadata: shape.metadata,
      },
      journal: fresh.sink,
      now: makeClock().now,
    });

    assert.equal(res.replied, "once", `${shape.name}: an orchestrator question ask is allowed`);
    assert.equal(wiring.replies.length, 1, `${shape.name}: exactly one reply`);
    assert.equal(wiring.replies[0].response, "once", `${shape.name}: response 'once'`);

    const allows = gateRecords(fresh.records, "allow");
    assert.equal(allows.length, 1, `${shape.name}: exactly one gates/allow record — the ask is COUNTED, not merely permitted`);
    assert.equal(allows[0].data["permission"], "question", `${shape.name}: the record carries the permission kind`);
    assert.equal(
      allows[0].data["humanTerritory"],
      shape.humanTerritory,
      `${shape.name}: the record carries Task 1.5's verdict for this exact text`,
    );
    assert.equal(
      allows[0].data["textAvailable"],
      shape.textAvailable,
      `${shape.name}: the record says whether a verdict could be reached at all — it is never fabricated`,
    );
  }
  store.release();
});

// ===========================================================================
// [10.1-ask-unknown-kind-reject]
// ===========================================================================

test("[10.1-ask-unknown-kind-reject] an orchestrator ask whose permission is neither 'edit' nor 'question' — bash, webfetch, or an unrecognized future kind — is REJECTED and journaled gates/deny naming the kind: the ask-gate's default is deny, so a vocabulary that grows upstream cannot silently widen what the orchestrator may do", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  for (const permission of ["bash", "webfetch", "some_future_permission_5502"]) {
    const fresh = makeJournal();
    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const res: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event: {
        id: `per_kind_${permission}`,
        sessionID: ORCH,
        permission,
        metadata: { filePath: path.join(root, "src", "parser.mjs"), question: TECHNICAL_Q },
      },
      journal: fresh.sink,
      now: makeClock().now,
    });

    assert.equal(res.replied, "reject", `${permission}: an unrecognized permission kind is rejected`);
    assert.equal(wiring.replies.length, 1, `${permission}: exactly one reply`);
    assert.equal(wiring.replies[0].response, "reject", `${permission}: response 'reject'`);
    const denies = gateRecords(fresh.records, "deny");
    assert.equal(denies.length, 1, `${permission}: journaled gates/deny`);
    assert.ok(
      JSON.stringify(denies[0].data).includes(permission),
      `${permission}: the deny names the kind it refused`,
    );
  }
  store.release();
});

// ===========================================================================
// [10.1-ask-reply-failure-failsoft]
// ===========================================================================

test("[10.1-ask-reply-failure-failsoft] the reply route failing — an {error} envelope, and a throw outright — is journaled once at error level and does NOT propagate out of the handler or the event router; no state is written and no re-prompt is triggered by the failure", async () => {
  for (const mode of ["error-envelope", "throw"] as ReplyMode[]) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    seedOneItemExecuting(store, runId);
    const runDir = runDirOf(store, runId);
    const runBytes = rawOrEmpty(path.join(runDir, "run.json"));
    const itemBytes = itemFileBytes(runDir, "I1");

    const registry = makeRegistry([
      [ORCH, { role: "orchestrator" }],
      [SUB, { role: "implementer", itemId: "I1", tree: root }],
    ]);
    const wiring = makeWiring(registry, mode);
    const fresh = makeJournal();

    // (a) through the handler directly.
    await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event: { id: `per_fail_${mode}`, sessionID: SUB, permission: "edit", metadata: { filePath: `${root}/src/parser.mjs` } },
      journal: fresh.sink,
      now: makeClock().now,
    });

    const errors = fresh.records.filter((r) => r.level === "error");
    assert.equal(errors.length, 1, `${mode}: the transport failure is journaled exactly once at error level`);
    assert.equal(
      isKnownEvent(errors[0].component, errors[0].event),
      true,
      `${mode}: "${errors[0].component}/${errors[0].event}" must be in the closed §7.4 vocabulary`,
    );

    // (b) and through the event router, which must also not propagate it.
    await handlePluginEvent({
      event: {
        type: "permission.asked",
        properties: { id: `per_fail_route_${mode}`, sessionID: SUB, permission: "edit", metadata: { filePath: `${root}/src/parser.mjs` } },
      },
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      config,
      journal: fresh.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: makeClock().now,
    });
    await turns();

    assert.equal(rawOrEmpty(path.join(runDir, "run.json")), runBytes, `${mode}: no run state was written`);
    assert.equal(itemFileBytes(runDir, "I1"), itemBytes, `${mode}: no item state was written`);
    assert.equal(wiring.sdk.prompts.length, 0, `${mode}: a transport failure triggers no re-prompt`);
    store.release();
  }
});

// ===========================================================================
// [10.1-binding-decide-human-territory]
// ===========================================================================

test("[10.1-binding-decide-human-territory] C-029(b)/SG-6, enforced inside handleDecide beside the existing requireTwoOptions check: a kind:'derived' decision whose question satisfies isHumanTerritory is REJECTED BEFORE PERSIST — decisions.jsonl gains zero lines, the next successful decide still mints the next sequential D-id, and the question is SURFACED as a schema-valid §2.11 record (humanTerritory true, origin 'surface-tool', blocksItems []) — while the identical question with kind:'human' is ACCEPTED and a derived decision on a technical question is unaffected", () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);

  const scored = [
    {
      name: "delete them now",
      score: { capability: 2, testability: 2, movingParts: 2, validationEarliness: 2, singleSource: 2 },
    },
    {
      name: "keep them and pay for the storage",
      score: { capability: 1, testability: 2, movingParts: 3, validationEarliness: 2, singleSource: 2 },
    },
  ];

  // ---- run A: the rejection, the untouched ledger, and the sequential id ----
  const runA = createRunFor(store);
  const dirA = runDirOf(store, runA);
  const ledgerA = path.join(dirA, "decisions.jsonl");
  const beforeA = rawOrEmpty(ledgerA);
  assert.equal(beforeA, "", "premise: run A's decision ledger starts empty");

  assert.throws(
    () =>
      handleDecide({
        store,
        runId: runA,
        journal: journal.sink,
        now: () => START_MS,
        question: HUMAN_DECIDE_Q,
        options: scored,
        choice: "delete them now",
        why: "the snapshots are large",
        kind: "derived",
        appliedWhere: "ops/runbook.md",
      }),
    /human territory|§6\.2/i,
    "a derived decision over a §6.2 human-territory question is refused, naming human territory",
  );

  assert.equal(rawOrEmpty(ledgerA), beforeA, "decisions.jsonl is byte-identical — legality precedes persist");
  assert.equal(readDecisions(dirA).length, 0, "and gains zero lines");

  const surfaced = readQuestions(dirA);
  assert.equal(surfaced.length, 1, "the refused decision is SURFACED as exactly one §2.11 question");
  assert.equal(validate("QuestionRecord", surfaced[0]).ok, true, "which is a schema-valid §2.11 record");
  assert.equal(surfaced[0].question, HUMAN_DECIDE_Q, "carrying the question verbatim");
  assert.equal(surfaced[0].humanTerritory, true, "marked human territory");
  assert.equal(
    surfaced[0].origin,
    "surface-tool",
    "under the EXISTING closed QUESTION_ORIGINS member — the vocabulary is not widened",
  );
  assert.deepEqual(surfaced[0].blocksItems, [], "blocking no item");
  assert.equal(surfaced[0].answeredIso, null, "and open");

  const next = handleDecide({
    store,
    runId: runA,
    journal: journal.sink,
    now: () => START_MS,
    question: TECHNICAL_DECIDE_Q,
    options: scored,
    choice: "delete them now",
    why: "the tuple is cheaper to destructure",
    kind: "derived",
    appliedWhere: "src/parser.mjs",
  });
  assert.equal(
    next.decisionId,
    "D-0001",
    "the rejection consumed no id: the next successful decide still mints the FIRST sequential D-id",
  );
  assert.equal(readDecisions(dirA).length, 1, "and the technical derived decision is unaffected — its line is appended");

  // ---- run B: the kind:"human" control -------------------------------------
  const runB = createRunFor(store);
  const dirB = runDirOf(store, runB);
  const human = handleDecide({
    store,
    runId: runB,
    journal: journal.sink,
    now: () => START_MS,
    question: HUMAN_DECIDE_Q,
    options: [{ name: "delete them now" }, { name: "keep them" }],
    choice: "delete them now",
    why: "the human answered",
    kind: "human",
    appliedWhere: "ops/runbook.md",
  });
  assert.equal(human.decisionId, "D-0001", "the identical question with kind:'human' is ACCEPTED");
  const linesB = readDecisions(dirB);
  assert.equal(linesB.length, 1, "and appends its line as before");
  assert.equal(linesB[0].kind, "human", "recorded as a human decision");
  assert.equal(readQuestions(dirB).length, 0, "a human-kind decision surfaces no question — it IS the answer");
  store.release();
});

// ===========================================================================
// [10.1-binding-orphan-question-reconcile]
// ===========================================================================

test("[10.1-binding-orphan-question-reconcile] C-032 E7 repair half: at idle, BEFORE any re-prompt or stop decision, the engine completes the half-applied blockAndAsk window — an OPEN 'implementer-blocked' question whose blocksItems names an UNBLOCKED item makes the engine call store.setBlocked with that questionId, journal state/item.updated and append NO new question — while a fully-applied pair is left byte-identical and an ANSWERED question never re-blocks anything", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"] }),
      makeQueueItem("I3", { fileScope: ["src/c.ts"], testScope: ["tests/c.test.ts"] }),
    ],
  };
  seedExecuting(store, runId, queue);
  const runDir = runDirOf(store, runId);

  const ask = (itemId: string): string =>
    appendQuestion(
      runDir,
      {
        runId,
        question: `conductor_submit_test could not obtain a legal RED for item "${itemId}"`,
        askedBy: { role: "testWriter", sessionID: SUB },
        humanTerritory: false,
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      START_MS,
    ).id;

  // I1: the E7 window — the question was appended and the process died before setBlocked.
  const orphanId = ask("I1");
  // I2: a fully-applied pair — question open AND the item blocked, pointing at it.
  const appliedId = ask("I2");
  store.setBlocked(runId, "I2", { reason: "already blocked on " + appliedId, stage: "RED", questionId: appliedId });
  // I3: an ANSWERED question naming it; the item is unblocked and must stay that way.
  const answeredId = ask("I3");
  answerQuestion(runDir, answeredId, "go ahead", START_MS);

  assert.equal(store.loadItem(runId, "I1").blocked, null, "premise: I1 is the orphan — question open, item unblocked");
  assert.notEqual(store.loadItem(runId, "I2").blocked, null, "premise: I2's pair is fully applied");
  assert.equal(store.loadItem(runId, "I3").blocked, null, "premise: I3 is unblocked under an ANSWERED question");
  const i2Before = itemFileBytes(runDir, "I2");
  const i3Before = itemFileBytes(runDir, "I3");
  const questionsBefore = rawOrEmpty(path.join(runDir, "questions.jsonl"));

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  await handleSessionIdle({
    store,
    state: createContinuationState(),
    registry,
    sessionID: ORCH,
    client: wiring.client,
    config,
    journal: journal.sink,
    stateHome: freshStateHome(),
    workspaceKey: "wk",
    now: makeClock().now,
  });
  await turns();

  const i1 = store.loadItem(runId, "I1");
  assert.notEqual(i1.blocked, null, "the orphan's second write is completed idempotently");
  assert.equal(i1.blocked?.questionId, orphanId, "the item's block points at THAT open question");
  assert.ok((i1.blocked?.stage ?? "").length > 0, "and carries a non-empty stage");
  assert.ok(
    (i1.blocked?.reason ?? "").includes(orphanId),
    "the block's reason names the open question, so a human can see what unwedges it",
  );
  assert.equal(validate("Item", i1).ok, true, "the reconciled item file still satisfies the §2.5 schema");
  assert.equal(i1.state, "PENDING", "reconciliation is an ANNOTATION, never an FSM move");

  assert.equal(itemFileBytes(runDir, "I2"), i2Before, "a fully-applied pair is left byte-identical — no second write");
  assert.equal(itemFileBytes(runDir, "I3"), i3Before, "an ANSWERED question never re-blocks anything");
  assert.equal(
    rawOrEmpty(path.join(runDir, "questions.jsonl")),
    questionsBefore,
    "the reconciliation appends NO new question",
  );
  assert.equal(readQuestions(runDir).length, 3, "still exactly the three seeded questions");

  const updates = journal.records.filter(
    (r) => r.component === "state" && r.event === "item.updated" && r.corr.itemId === "I1",
  );
  assert.equal(updates.length, 1, "the completed write is journaled once under state/item.updated for I1");

  // The item is now answerable through the normal path: answerQuestion clears exactly the
  // items whose blocked.questionId matches.
  const cleared = answerQuestion(runDir, orphanId, "write it as a missing-subject red", START_MS);
  assert.deepEqual(cleared.clearedItemIds, ["I1"], "answering the orphan question clears exactly the reconciled item");
  store.release();
});

// ===========================================================================
// [10.1-binding-question-reuse-no-duplicate]
// ===========================================================================

test("[10.1-binding-question-reuse-no-duplicate] C-032 E7 prevention half: blockAndAsk and blockVetAndAsk REUSE an already-open 'implementer-blocked' question for the same item instead of appending a second — asserted separately for BOTH call sites: two consecutive blocking calls leave EXACTLY ONE record in questions.jsonl with item.blocked.questionId naming it, the accumulated attempts counters still increase on both calls, and a blocking call for a DIFFERENT item still mints its own question", async () => {
  // ---- call site 1: handleSubmitTest's blockAndAsk (adapter/tools.ts:2977) --
  {
    const root = scratchRepo();
    const config = makeConfig({ testRepairAttempts: 1 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [
        makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/other.mjs"], testScope: ["tests/o.test.mjs"] }),
      ],
    };
    seedExecuting(store, runId, queue);

    const wiring = makeFanoutWiring(runId, config, journal.sink, {
      testWriter: [writerWrites(root, "tests/p.test.mjs", brokenTest("SUBMIT-V1"))],
      reviewer: [],
    });

    const submit = async (itemId: string): Promise<void> => {
      await handleSubmitTest({
        store,
        fanout: wiring.fanout,
        runId,
        itemId,
        config,
        journal: journal.sink,
        sessionID: SUB,
        now: () => START_MS,
      });
    };

    await submit("I1");
    const afterFirst = readQuestions(runDir);
    assert.equal(afterFirst.length, 1, "submit: the first exhaustion mints exactly one question");
    const qid = afterFirst[0].id;
    assert.equal(afterFirst[0].origin, "implementer-blocked", "submit: on the existing closed-vocabulary origin");
    const repairsAfterFirst = store.loadItem(runId, "I1").attempts.testRepairs;
    assert.equal(repairsAfterFirst, 1, "submit: the permitted repair was consumed and accumulated");
    assert.equal(store.loadItem(runId, "I1").blocked?.questionId, qid, "submit: the block points at that question");

    // The C-032 E7 window: the question stays OPEN while the item's block is lost, which is
    // exactly the state a crash between the two writes leaves behind — and the only state in
    // which the stage gate offers the tool a second time.
    store.clearBlocked(runId, "I1");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "submit: the item is unblocked again (the E7 window)");
    assert.equal(readQuestions(runDir)[0].answeredIso, null, "submit: and its question is still OPEN");

    await submit("I1");
    const afterSecond = readQuestions(runDir);
    assert.equal(afterSecond.length, 1, "submit: the SECOND blocking call appends no duplicate — the open question is reused");
    assert.equal(afterSecond[0].id, qid, "submit: and it is the same record");
    const item = store.loadItem(runId, "I1");
    assert.equal(item.blocked?.questionId, qid, "submit: the item's block re-points at the reused question");
    assert.equal(
      item.attempts.testRepairs,
      repairsAfterFirst + 1,
      "submit: the accumulated attempts counter still increases on the second call (the C-029 accumulation is preserved)",
    );

    // A DIFFERENT item still mints its own question.
    await submit("I2");
    const afterOther = readQuestions(runDir);
    assert.equal(afterOther.length, 2, "submit: a blocking call for a DIFFERENT item mints its own question");
    const other = afterOther.find((q) => q.id !== qid);
    assert.ok(other !== undefined, "submit: the second question exists");
    assert.deepEqual(other.blocksItems, ["I2"], "submit: and blocks exactly the other item");
    store.release();
  }

  // ---- call site 2: handleVetTest's blockVetAndAsk (adapter/tools.ts:3446) --
  {
    const root = scratchRepo();
    const config = makeConfig({ vetCritics: 1, vetMaxRounds: 2 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [
        makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/other.mjs"], testScope: ["tests/o.test.mjs"] }),
      ],
    };
    seedExecuting(store, runId, queue, { I1: "RED", I2: "RED" });
    writeFileSync(path.join(root, "tests", "p.test.mjs"), `// ${RED_MARKER}\n`);
    writeFileSync(path.join(root, "tests", "o.test.mjs"), `// ${RED_MARKER}\n`);
    // The §2.6 red each RED item already carries, written straight to the ledger.
    const reds: EvidenceRecord[] = ["I1", "I2"].map((itemId, index) => ({
      seq: index + 1,
      ts: START_MS,
      kind: "red",
      itemId,
      command: [process.execPath, "--test", `tests/${itemId === "I1" ? "p" : "o"}.test.mjs`],
      exitCode: 1,
      failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER}\n\n7 !== -7`,
      failureClass: "assertion",
      targeted: true,
    }));
    writeFileSync(path.join(runDir, "evidence.jsonl"), reds.map((r) => JSON.stringify(r)).join("\n") + "\n");
    for (const [index, itemId] of ["I1", "I2"].entries()) {
      const item = store.loadItem(runId, itemId);
      item.evidence.red = { ledger: "evidence.jsonl", seq: index + 1 };
      store.saveItem(runId, item);
    }

    // Round 1 returns a must-fix, so the loop reaches the write-capable re-dispatch; the
    // writer then replies BLOCKED, which is blockVetAndAsk's own exit (tools.ts:3712).
    const wiring = makeFanoutWiring(runId, config, journal.sink, {
      testWriter: [implJson("BLOCKED", "the writer cannot repair this test")],
      reviewer: [vetJson([MUSTFIX_MARKER])],
    });

    const vet = async (itemId: string): Promise<void> => {
      await handleVetTest({
        store,
        fanout: wiring.fanout,
        runId,
        itemId,
        config,
        journal: journal.sink,
        sessionID: SUB,
        now: () => START_MS,
      });
    };

    await vet("I1");
    const afterFirst = readQuestions(runDir);
    assert.equal(afterFirst.length, 1, "vet: the first block mints exactly one question");
    const qid = afterFirst[0].id;
    assert.equal(afterFirst[0].origin, "implementer-blocked", "vet: on the existing closed-vocabulary origin");
    const roundsAfterFirst = store.loadItem(runId, "I1").attempts.vetRounds;
    assert.ok(roundsAfterFirst > 0, "vet: the round that ran was accumulated onto the item");
    assert.equal(store.loadItem(runId, "I1").blocked?.questionId, qid, "vet: the block points at that question");

    store.clearBlocked(runId, "I1");
    assert.equal(readQuestions(runDir)[0].answeredIso, null, "vet: the question is still OPEN in the E7 window");

    await vet("I1");
    const afterSecond = readQuestions(runDir);
    assert.equal(afterSecond.length, 1, "vet: the SECOND blocking call appends no duplicate — the open question is reused");
    assert.equal(afterSecond[0].id, qid, "vet: and it is the same record");
    const item = store.loadItem(runId, "I1");
    assert.equal(item.blocked?.questionId, qid, "vet: the item's block re-points at the reused question");
    assert.equal(
      item.attempts.vetRounds,
      roundsAfterFirst * 2,
      "vet: the accumulated vetRounds counter still increases on the second call",
    );

    await vet("I2");
    const afterOther = readQuestions(runDir);
    assert.equal(afterOther.length, 2, "vet: a blocking call for a DIFFERENT item mints its own question");
    const other = afterOther.find((q) => q.id !== qid);
    assert.ok(other !== undefined, "vet: the second question exists");
    assert.deepEqual(other.blocksItems, ["I2"], "vet: and blocks exactly the other item");
    store.release();
  }
});

// ===========================================================================
// [10.1-binding-answer-reblocks-on-next-open-question]
// ===========================================================================

test("[10.1-binding-answer-reblocks-on-next-open-question] C-056's residual: releasing an item on answer must re-block it on the OLDEST still-open question that names it and release only when none remains — asserted in both directions on a real questions ledger, and with a THREE-question fixture whose successor is Q2, so an implementation choosing the NEWEST open question (Q3), or the question being answered, or none at all, each fail distinctly", () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);

  // Distinct, strictly increasing stamps, so "oldest" is the SAME question under all three
  // readings available on disk — ledger order, minted id order (appendQuestion mints
  // max+1) and tsMs order — and the test's notion of oldest is therefore unambiguous.
  const T1 = START_MS;
  const T2 = START_MS + 1_000;
  const T3 = START_MS + 2_000;
  const T_ANSWER = START_MS + 10_000;

  const surface = (runId: string, text: string, tsMs: number, blocksItems: string[]): SurfaceOutcome =>
    handleSurface({
      store,
      runId,
      journal: journal.sink,
      now: () => tsMs,
      question: text,
      blocksItems,
      askedBy: { role: "orchestrator", sessionID: ORCH },
    });

  const answer = (runId: string, questionId: string, tsMs: number): AnswerOutcome =>
    handleAnswer({
      store,
      runId,
      journal: journal.sink,
      now: () => tsMs,
      questionId,
      answer: "answered by the human",
    });

  // Schedulability read from the SAME committed derivation adapter/tools.ts
  // offeredStageTool (:5027) uses: a stage tool carries the ids it may target.
  const schedulable = (runId: string, queue: Queue, itemId: string): boolean => {
    for (const hint of verdictOf(store, runId, queue).legal.values()) {
      if ((hint.itemIds ?? []).includes(itemId)) return true;
    }
    return false;
  };

  const answeredIsoOf = (runDir: string, questionId: string): string | null => {
    const found = readQuestions(runDir).find((q) => q.id === questionId);
    assert.ok(found !== undefined, `the ledger still carries ${questionId}`);
    return found.answeredIso;
  };

  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"] }),
    ],
  };

  // =========================================================================
  // (A) the row's two directions, on the two-question fixture it names.
  // =========================================================================
  {
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    seedExecuting(store, runId, queue);
    const i2Before = itemFileBytes(runDir, "I2");

    const q1 = surface(runId, "QUESTION-ALPHA-2318: which encoding do the offsets use?", T1, ["I1"]);
    const q2 = surface(runId, "QUESTION-BRAVO-2318: should negative offsets clamp or wrap?", T2, ["I1"]);

    // The C-056 premise, asserted rather than assumed: first-block-wins means Q2 names I1
    // in its own blocksItems but does NOT own the item's single §2.5 disposition.
    assert.deepEqual(q1.blockedItemIds, ["I1"], "premise: the FIRST surfaced question blocks I1");
    assert.deepEqual(q2.blockedItemIds, [], "premise: first-block-wins — the second question blocks nothing");
    assert.deepEqual(
      readQuestions(runDir).find((q) => q.id === q2.questionId)?.blocksItems,
      ["I1"],
      "premise: yet Q2's own blocksItems still names I1 — that is the gap C-056 left open",
    );
    assert.equal(store.loadItem(runId, "I1").blocked?.questionId, q1.questionId, "premise: I1 is blocked on Q1");
    assert.equal(schedulable(runId, queue, "I1"), false, "premise: a blocked item is not schedulable");

    // ---- (a) answering Q1 must RE-BLOCK on Q2, not release --------------
    const releaseQ1 = answer(runId, q1.questionId, T_ANSWER);
    const afterQ1 = store.loadItem(runId, "I1");

    assert.notEqual(
      afterQ1.blocked,
      null,
      "answering Q1 must NOT release I1 — Q2 is still open and still names it",
    );
    assert.equal(
      afterQ1.blocked?.questionId,
      q2.questionId,
      "I1 is re-blocked on the still-open Q2",
    );
    assert.notEqual(
      afterQ1.blocked?.questionId,
      q1.questionId,
      "and NOT on the question just answered — the successor search must exclude it (answerQuestion marks answered LAST)",
    );
    assert.ok(
      (afterQ1.blocked?.reason ?? "").includes(q2.questionId),
      "the re-block's reason names the question that still gates the item, so a human can see what unwedges it",
    );
    assert.ok((afterQ1.blocked?.stage ?? "").length > 0, "and carries a non-empty stage");
    assert.equal(afterQ1.state, "PENDING", "re-blocking is an ANNOTATION, never an FSM move");
    assert.equal(validate("Item", afterQ1).ok, true, "the re-blocked item file still satisfies the §2.5 schema");
    assert.equal(schedulable(runId, queue, "I1"), false, "and I1 is still NOT schedulable");

    assert.equal(
      releaseQ1.clearedItemIds.includes("I1"),
      false,
      "a re-blocked item is not reported as cleared — handleAnswer journals `blocked: null` for every id it returns",
    );
    assert.notEqual(answeredIsoOf(runDir, q1.questionId), null, "Q1 is still marked answered");
    assert.equal(answeredIsoOf(runDir, q2.questionId), null, "and Q2 is still open");
    assert.equal(readQuestions(runDir).length, 2, "the re-block appends NO new question");

    // ---- (b) answering Q2 then RELEASES ---------------------------------
    const releaseQ2 = answer(runId, q2.questionId, T_ANSWER + 1);
    const afterQ2 = store.loadItem(runId, "I1");

    assert.equal(afterQ2.blocked, null, "with no open question left naming it, I1 is released");
    assert.deepEqual(releaseQ2.clearedItemIds, ["I1"], "and the release is reported exactly once");
    assert.equal(schedulable(runId, queue, "I1"), true, "I1 is schedulable again");
    assert.equal(readQuestions(runDir).length, 2, "still exactly the two questions");
    assert.equal(itemFileBytes(runDir, "I2"), i2Before, "the un-named control item was never touched");
  }

  // =========================================================================
  // (B) the ordering half: THREE questions, so "the successor" and "the oldest
  //     successor" are different answers and the test discriminates them.
  // =========================================================================
  {
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    seedExecuting(store, runId, queue);

    const q1 = surface(runId, "QUESTION-CHARLIE-4407: which encoding?", T1, ["I1"]);
    const q2 = surface(runId, "QUESTION-DELTA-4407: clamp or wrap?", T2, ["I1"]);
    const q3 = surface(runId, "QUESTION-ECHO-4407: what about the empty string?", T3, ["I1"]);

    // "Oldest" is unambiguous here: ledger order, minted id order and tsMs order all agree.
    const ledger = readQuestions(runDir);
    assert.deepEqual(
      ledger.map((q) => q.id),
      [q1.questionId, q2.questionId, q3.questionId],
      "premise: ledger order is Q1, Q2, Q3",
    );
    assert.deepEqual(
      ledger.map((q) => q.tsMs),
      [T1, T2, T3],
      "premise: tsMs order agrees with ledger order, so `oldest` reads the same three ways",
    );
    assert.ok(q1.questionId < q2.questionId && q2.questionId < q3.questionId, "premise: minted id order agrees too");
    assert.deepEqual(q2.blockedItemIds, [], "premise: first-block-wins for Q2");
    assert.deepEqual(q3.blockedItemIds, [], "premise: and for Q3");
    assert.equal(store.loadItem(runId, "I1").blocked?.questionId, q1.questionId, "premise: I1 is blocked on Q1");

    // Answering the OLDEST leaves the item on the oldest of what remains — Q2. This is the
    // assertion that separates oldest-first from newest-first: both re-block, only one
    // picks Q2.
    answer(runId, q1.questionId, T_ANSWER);
    const successor = store.loadItem(runId, "I1").blocked;
    assert.notEqual(successor, null, "answering Q1 re-blocks rather than releasing");
    assert.equal(
      successor?.questionId,
      q2.questionId,
      "the successor is the OLDEST still-open question naming I1 (Q2)",
    );
    assert.notEqual(
      successor?.questionId,
      q3.questionId,
      "NOT the newest still-open one (Q3) — first-block-wins is only coherent if the successor is chosen oldest-first",
    );

    // Answering a YOUNGER question out of order changes nothing: it owns no item's block,
    // and it must not become the successor or release anything.
    const outOfOrder = answer(runId, q3.questionId, T_ANSWER + 1);
    assert.deepEqual(outOfOrder.clearedItemIds, [], "answering Q3 clears nothing — it never owned I1's block");
    assert.equal(
      store.loadItem(runId, "I1").blocked?.questionId,
      q2.questionId,
      "and I1 stays blocked on Q2",
    );
    assert.equal(schedulable(runId, queue, "I1"), false, "I1 is still not schedulable");

    // Only when NONE remains is the item released.
    const last = answer(runId, q2.questionId, T_ANSWER + 2);
    assert.equal(store.loadItem(runId, "I1").blocked, null, "with every naming question answered, I1 is released");
    assert.deepEqual(last.clearedItemIds, ["I1"], "and the release is reported");
    assert.equal(schedulable(runId, queue, "I1"), true, "I1 is schedulable again");
    assert.equal(readQuestions(runDir).length, 3, "no question was ever appended by the re-block chain");
    for (const q of readQuestions(runDir)) {
      assert.notEqual(q.answeredIso, null, `${q.id} is marked answered — re-blocking never undoes an answer`);
    }
  }
  store.release();
});

// ===========================================================================
// [10.1-ask-claim-one-derivation-both-seams] — the PRODUCTION wiring
// ===========================================================================

test("[10.1-ask-claim-one-derivation-both-seams] the production wiring, driven through plugin/index.ts's OWN tool.execute.before hook and its OWN registration path: with the claim active the plugin admits the orchestrator's edit, and with the claim gone the same hook denies — the scope and the session tree are both derived by the plugin, not handed to it by this test", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedExecuting(store, runId, {
    items: [makeQueueItem("I1", { fileScope: ["src/**"], testScope: ["tests/**"] })],
  });
  const claimed = store.loadItem(runId, "I1");
  claimed.inlineClaim = { reason: "inline is cheaper here", decisionId: "D-0001" };
  store.saveItem(runId, claimed);
  const itemPath = path.join(runDirOf(store, runId), "items", "I1.json");

  // The plugin opens the workspace itself (P4) and must be the single writer (G6).
  mkdirSync(path.join(root, ".conductor"), { recursive: true });
  writeFileSync(path.join(root, ".conductor", "config.json"), JSON.stringify(config, null, 2));
  store.release();

  const wiring = makeWiring(makeRegistry());
  const factory = ConductorPlugin as unknown as (input: unknown) => Promise<PluginHooks>;
  const hooks = await factory({
    client: wiring.client,
    project: { id: "prj_test", worktree: root },
    directory: root,
    worktree: root,
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://127.0.0.1:4096"),
    $: () => undefined,
  });

  // The ONLY registration production performs for an orchestrator session:
  // adapter/chat-message.ts registers {role:"orchestrator"} with NO tree (SG-9), so
  // whatever resolves that tree has to be the plugin's own gate body.
  const chat = hooks["chat.message"];
  assert.ok(chat !== undefined, "the plugin installs a chat.message hook");
  await chat({ sessionID: ORCH }, { parts: [{ type: "text", text: "carry on" }] });

  const before = hooks["tool.execute.before"];
  assert.ok(before !== undefined, "and the tool.execute.before gate hook");
  // §0.2's realpath rule: the plugin canonicalizes its root, so the ask must be the
  // canonical path or the comparison would be about symlinks rather than claims.
  const askedPath = path.join(realpathSync(root), "src", "parser.mjs");
  const drive = async (): Promise<Error | null> => {
    try {
      await before({ sessionID: ORCH, tool: "edit" }, { args: { filePath: askedPath } });
      return null;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  };

  assert.equal(
    await drive(),
    null,
    "with the claim active, the plugin's OWN inline-claim derivation admits the orchestrator's edit",
  );

  // Drop the claim on disk — our lock is released, so the item file is written directly.
  const unclaimed = JSON.parse(readFileSync(itemPath, "utf8")) as Item;
  unclaimed.inlineClaim = null;
  writeFileSync(itemPath, JSON.stringify(unclaimed, null, 2));

  const denied = await drive();
  assert.ok(denied instanceof Error, "with the claim gone, the SAME production hook denies by throwing");
  assert.match(
    denied.message,
    /inline claim/i,
    "and the reason is core gates-edit's G8 reason naming the inline claim",
  );
});

// ===========================================================================
// [10.1-ask-path-unextractable-reject] — the MIXED payload
// ===========================================================================

test("[10.1-ask-path-unextractable-reject] SG-10 fail-closed on a MIXED payload: an orchestrator edit ask whose `patterns` carry wildcards BESIDE a covered concrete path is rejected WHOLE — the wildcards are not filtered away and the ask adjudicated on what remains, and a metadata.filePath cannot rescue a payload that also asks for a wildcard", async () => {
  const shapes = [
    { name: "concrete path mixed with wildcard patterns", withMetadata: false },
    { name: "metadata.filePath beside a wildcard pattern", withMetadata: true },
  ];

  for (const shape of shapes) {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    seedExecuting(store, runId, { items: [makeQueueItem("I1", { fileScope: ["**"], testScope: ["tests/**"] })] });
    const item = store.loadItem(runId, "I1");
    item.inlineClaim = { reason: "inline is cheaper here", decisionId: "D-0001" };
    store.saveItem(runId, item);

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const concrete = path.join(root, "src", "parser.mjs");

    // PREMISE: the concrete path ALONE is granted, so the reject below can only be
    // the wildcards' doing — this is what makes the row about mixing, not coverage.
    const soloWiring = makeWiring(registry);
    const solo: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: soloWiring.client,
      event: { id: "per_mixed_solo", sessionID: ORCH, permission: "edit", patterns: [concrete] },
      journal: journal.sink,
      now: makeClock().now,
    });
    assert.equal(solo.replied, "once", `${shape.name}: premise — the concrete path on its own IS covered by the claim`);

    const wiring = makeWiring(registry);
    const res: PermissionAskedResult = await handlePermissionAsked({
      store,
      state: createContinuationState(),
      registry,
      client: wiring.client,
      event: {
        id: "per_mixed",
        sessionID: ORCH,
        permission: "edit",
        patterns: shape.withMetadata ? [concrete, "**"] : [concrete, "**/*.ts", `${root}/**`],
        metadata: shape.withMetadata ? { filePath: concrete } : {},
      },
      journal: journal.sink,
      now: makeClock().now,
    });

    assert.equal(
      res.replied,
      "reject",
      `${shape.name}: a reply grants the ASK, so a payload that also asks for a wildcard degrades to 'the claim does not work'`,
    );
    assert.equal(wiring.replies.length, 1, `${shape.name}: exactly one reply`);
    assert.equal(wiring.replies[0].response, "reject", `${shape.name}: response 'reject'`);
    store.release();
  }
});

// ===========================================================================
// [10.1-binding-orphan-question-reconcile] — the deliberate release
// ===========================================================================

test("[10.1-binding-orphan-question-reconcile] a DELIBERATE release is not a half-applied block: after conductor_queue_amend clears `blocked` under a still-OPEN implementer-blocked question (§2.5 names that tool a legal clearer), the next orchestrator idle leaves the item released and re-prompts — while an item untouched since its question was appended is still repaired in the same pass", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/other.mjs"], testScope: ["tests/o.test.mjs"] }),
    ],
  };
  seedExecuting(store, runId, queue);
  const runDir = runDirOf(store, runId);

  const ask = (itemId: string): string =>
    appendQuestion(
      runDir,
      {
        runId,
        question: `conductor_submit_test could not obtain a legal RED for item "${itemId}"`,
        askedBy: { role: "testWriter", sessionID: SUB },
        humanTerritory: false,
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      START_MS,
    ).id;

  // I1: the fully-applied pair the amendment then RELEASES.
  const releasedQuestion = ask("I1");
  store.setBlocked(runId, "I1", { reason: BLOCK_MARKER, stage: "PENDING", questionId: releasedQuestion });
  assert.notEqual(store.loadItem(runId, "I1").blocked, null, "premise: I1's block was fully applied");

  // I2: the C-032 E7 window — question appended, the item untouched since.
  const orphanQuestion = ask("I2");
  assert.equal(store.loadItem(runId, "I2").blocked, null, "premise: I2 is the half-applied orphan");

  const ops: QueueAmendOp[] = [
    {
      op: "update",
      item: makeQueueItem("I1", {
        fileScope: ["src/parser.mjs"],
        testScope: ["tests/p.test.mjs", "tests/p.signed.test.mjs"],
      }),
    },
  ];
  const amended = handleQueueAmend({
    store,
    runId,
    config,
    journal: journal.sink,
    now: () => START_MS,
    ops,
    question: "should I1's test scope widen to cover the signed cases?",
    options: [
      {
        name: "widen I1's test scope",
        score: { capability: 4, testability: 5, movingParts: 4, validationEarliness: 5, singleSource: 4 },
      },
      {
        name: "leave the scope and add a second item",
        score: { capability: 3, testability: 3, movingParts: 2, validationEarliness: 3, singleSource: 2 },
      },
    ],
    choice: "widen I1's test scope",
    why: "the signed cases belong to the same behaviour, so one item still owns one change",
    appliedWhere: "queue.json",
  });
  assert.deepEqual(amended.updated, ["I1"], "premise: the amendment updated I1");
  assert.equal(store.loadItem(runId, "I1").blocked, null, "premise: §2.5's legal clearer released I1");
  const stillOpen = readQuestions(runDir).find((q) => q.id === releasedQuestion);
  assert.equal(stillOpen?.answeredIso, null, "premise: and left the blocking question OPEN — the ambiguous state");

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const res: SessionIdleResult = await handleSessionIdle({
    store,
    state: createContinuationState(),
    registry,
    sessionID: ORCH,
    client: wiring.client,
    config,
    journal: journal.sink,
    stateHome: freshStateHome(),
    workspaceKey: "wk",
    now: makeClock().now,
  });
  await turns();

  assert.equal(
    store.loadItem(runId, "I1").blocked,
    null,
    "an item DELIBERATELY released by an amendment is not re-blocked at idle — the documented escape hatch survives",
  );
  assert.notEqual(
    store.loadItem(runId, "I2").blocked,
    null,
    "while the untouched orphan is still repaired in the very same pass",
  );
  assert.equal(
    store.loadItem(runId, "I2").blocked?.questionId,
    orphanQuestion,
    "and its block points at the open question that named it",
  );
  assert.equal(res.stop, null, "the pass records no stop");
  assert.equal(readQuestions(runDir).length, 2, "and appends no question");
  store.release();
});

// ===========================================================================
// [10.1-signature-change-resets] — progress outranks the wedge stop
// ===========================================================================

test("[10.1-signature-change-resets] progress OUTRANKS the wedge stop: with counters.futileRePrompts persisted at 3 and a real state change since the third re-prompt, the fourth idle resets the counter and re-prompts instead of disengaging — while the identical fixture that did NOT move is still stopped `noop` on that same fourth pass", async () => {
  const drive = async (moved: boolean): Promise<{
    res: SessionIdleResult;
    futile: number;
    stopKind: string | null;
    disengages: number;
    prompts: number;
  }> => {
    const root = scratchRepo();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const queue = seedOneItemExecuting(store, runId);
    const runDir = runDirOf(store, runId);

    const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
    const wiring = makeWiring(registry);
    const clock = makeClock();
    const state = createContinuationState();
    const stateHome = freshStateHome();

    const idle = async (): Promise<SessionIdleResult> => {
      const out: SessionIdleResult = await handleSessionIdle({
        store,
        state,
        registry,
        sessionID: ORCH,
        client: wiring.client,
        config,
        journal: journal.sink,
        stateHome,
        workspaceKey: "wk",
        now: clock.now,
      });
      await turns();
      clock.advance(DEBOUNCE_MS * 2);
      return out;
    };

    for (let pass = 0; pass < 3; pass += 1) await idle();
    assert.equal(
      readRunFile(store, runId).counters.futileRePrompts,
      3,
      "premise: three unchanged passes leave futileRePrompts at 3, one short of the stop",
    );
    assert.equal(wiring.sdk.prompts.length, 3, "premise: exactly three prompts so far");

    if (moved) {
      // The run finally did the work the third re-prompt asked for.
      const item = store.loadItem(runId, "I1");
      item.state = "RED";
      store.saveItem(runId, item);
      assert.notEqual(
        verdictOf(store, runId, queue).recommended,
        null,
        "premise: the MOVED fixture still has a next action, so a re-prompt is possible",
      );
    }

    const res = await idle();
    const persisted = readRunFile(store, runId);
    const out = {
      res,
      futile: persisted.counters.futileRePrompts,
      stopKind: persisted.stop === null ? null : persisted.stop.kind,
      disengages: readAnomalies(runDir).filter((a) => a.kind === "disengage").length,
      prompts: wiring.sdk.prompts.length,
    };
    store.release();
    return out;
  };

  const movedRun = await drive(true);
  assert.equal(movedRun.res.stop, null, "the run MOVED before this pass, so the wedge detector must not fire");
  assert.equal(movedRun.stopKind, null, "no stop is persisted on run.json");
  assert.equal(movedRun.disengages, 0, "and no §2.8 disengage anomaly is appended");
  assert.equal(movedRun.futile, 0, "the observed progress resets futileRePrompts to 0");
  assert.equal(movedRun.res.prompted, true, "and the fourth pass re-prompts");
  assert.equal(movedRun.prompts, 4, "exactly one more prompt");

  const wedgedRun = await drive(false);
  assert.equal(wedgedRun.res.stop?.kind, "noop", "the CONTROL fixture, which did not move, is still stopped noop");
  assert.equal(wedgedRun.stopKind, "noop", "and the stop is persisted");
  assert.equal(wedgedRun.disengages, 1, "with its disengage anomaly");
  assert.equal(wedgedRun.prompts, 3, "and no fourth prompt");
});

// ===========================================================================
// [10.1-one-reprompt-in-flight] — a SYNCHRONOUS transport throw
// ===========================================================================

test("[10.1-one-reprompt-in-flight] the one-in-flight latch is released when the prompt call throws SYNCHRONOUSLY: the pass reports no prompt, journals the failure once at error level under a §7.4 name, and the next idle re-prompts normally once the transport recovers — a transient fault cannot silence the idle engine for the life of the process", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const THROW_MARKER = "INJECTED synchronous transport failure 5518";
  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  let throwing = true;
  const client: ContinuationClient = {
    session: {
      create: (opts) => wiring.client.session.create(opts),
      prompt: (opts) => {
        if (throwing) throw new Error(THROW_MARKER);
        return wiring.client.session.prompt(opts);
      },
      abort: (opts) => wiring.client.session.abort(opts),
      messages: (opts) => wiring.client.session.messages(opts),
    },
    postSessionIdPermissionsPermissionId: (opts) => wiring.client.postSessionIdPermissionsPermissionId(opts),
  };

  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();
  const idle = async (): Promise<SessionIdleResult> => {
    const out: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    return out;
  };

  const first = await idle();
  assert.equal(first.prompted, false, "a send that threw is not reported as a prompt");
  assert.equal(wiring.sdk.prompts.length, 0, "premise: the transport never received it");
  const errors = journal.records.filter((r) => r.level === "error");
  assert.equal(errors.length, 1, "the failure is journaled exactly once at error level");
  assert.equal(
    isKnownEvent(errors[0].component, errors[0].event),
    true,
    `"${errors[0].component}/${errors[0].event}" must be in the closed §7.4 vocabulary`,
  );
  assert.ok(
    JSON.stringify(errors[0].data).includes(THROW_MARKER),
    "and carries the underlying failure, so the fault is diagnosable",
  );

  throwing = false;
  clock.advance(DEBOUNCE_MS * 10);
  const second = await idle();
  assert.equal(second.prompted, true, "with the latch released and the transport recovered, the next idle re-prompts");
  assert.equal(wiring.sdk.prompts.length, 1, "and the prompt reaches the transport");
  store.release();
});

// ===========================================================================
// [10.1-ask-needs-context-conversion] — a FAILED delivery, and the run scope
// ===========================================================================

test("[10.1-ask-needs-context-conversion] a conversion whose delivery FAILS is not destroyed: when the re-prompt carrying it rejects, the failure is journaled at error level and the conversion goes back on the queue, so the next successful re-prompt carries it — 'surfaced exactly once' may never become 'surfaced zero times'", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);

  const REJECT_MARKER = "INJECTED prompt transport failure 6614";
  const DENIED_PATH = `${root}/src/forbidden-6614.ts`;
  const registry = makeRegistry([
    [ORCH, { role: "orchestrator" }],
    [SUB, { role: "implementer", itemId: "I1", tree: root }],
  ]);
  const wiring = makeWiring(registry);
  let rejecting = true;
  const client: ContinuationClient = {
    session: {
      create: (opts) => wiring.client.session.create(opts),
      prompt: (opts) =>
        rejecting ? Promise.reject(new Error(REJECT_MARKER)) : wiring.client.session.prompt(opts),
      abort: (opts) => wiring.client.session.abort(opts),
      messages: (opts) => wiring.client.session.messages(opts),
    },
    postSessionIdPermissionsPermissionId: (opts) => wiring.client.postSessionIdPermissionsPermissionId(opts),
  };

  const state = createContinuationState();
  const clock = makeClock();
  const asked: PermissionAskedResult = await handlePermissionAsked({
    store,
    state,
    registry,
    client,
    event: { id: "per_lost_conversion", sessionID: SUB, permission: "edit", patterns: [DENIED_PATH] },
    journal: journal.sink,
    now: clock.now,
  });
  assert.equal(asked.replied, "reject", "premise: the sub-session ask is refused (§3.5(b))");
  const conversion = asked.conversion;
  assert.ok(conversion !== null, "premise: and converts to a NEEDS_CONTEXT disposition to surface");

  const idle = async (): Promise<SessionIdleResult> => {
    const out: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 5);
    return out;
  };

  await idle();
  const errors = journal.records.filter((r) => r.level === "error");
  assert.equal(errors.length, 1, "the failed delivery is journaled once at error level");
  assert.equal(
    isKnownEvent(errors[0].component, errors[0].event),
    true,
    `"${errors[0].component}/${errors[0].event}" must be in the closed §7.4 vocabulary`,
  );
  assert.ok(
    JSON.stringify(errors[0].data).includes(REJECT_MARKER),
    "and names the transport failure that swallowed the surface",
  );

  rejecting = false;
  const second = await idle();
  assert.equal(second.prompted, true, "premise: the recovered transport takes the next re-prompt");
  assert.equal(wiring.sdk.prompts.length, 1, "premise: exactly one prompt actually reached the transport");
  assert.ok(
    wiring.sdk.prompts[0].text.includes(conversion.neededContext),
    "the conversion whose delivery failed rides the NEXT successful re-prompt rather than being destroyed",
  );

  const third = await idle();
  assert.equal(third.prompted, true, "premise: a third pass re-prompts too");
  assert.equal(
    wiring.sdk.prompts[1].text.includes(conversion.neededContext),
    false,
    "and having been delivered once, it is not repeated",
  );
  store.release();
});

test("[10.1-ask-needs-context-conversion] the surface queue is RUN-SCOPED: a conversion raised under a run that then ENDS is reported as lost exactly once and is never delivered into a LATER run's re-prompt, which could only name an item that run does not contain", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const firstRunId = createRunFor(store);
  seedOneItemExecuting(store, firstRunId);

  const DENIED_PATH = `${root}/src/forbidden-4712.ts`;
  const registry = makeRegistry([
    [ORCH, { role: "orchestrator" }],
    [SUB, { role: "implementer", itemId: "I1", tree: root }],
  ]);
  const wiring = makeWiring(registry);
  const state = createContinuationState();
  const clock = makeClock();

  const asked: PermissionAskedResult = await handlePermissionAsked({
    store,
    state,
    registry,
    client: wiring.client,
    event: { id: "per_run_scoped", sessionID: SUB, permission: "edit", patterns: [DENIED_PATH] },
    journal: journal.sink,
    now: clock.now,
  });
  const conversion = asked.conversion;
  assert.ok(conversion !== null, "premise: the refusal queued a conversion under the FIRST run");

  const idle = async (): Promise<SessionIdleResult> => {
    const out: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 5);
    return out;
  };

  // End the first run before any re-prompt could carry the conversion: §2.3 terminality
  // is a persisted stop, and the idle engine archives such a run on sight.
  const ending = store.loadRun(firstRunId);
  ending.stop = { kind: "done", reasonDisplay: "the run finished before the surface could be delivered", tsMs: START_MS };
  store.saveRun(ending);

  const archived = await idle();
  assert.equal(archived.prompted, false, "premise: a terminal run is archived, never re-prompted");
  assert.equal(store.currentRun(), null, "premise: the first run is gone");
  const lost = journal.records.filter(
    (r) => r.level === "error" && String((r.data as { hook?: unknown }).hook ?? "").includes("surface-conversion"),
  );
  assert.equal(lost.length, 1, "the undelivered conversion is reported lost exactly once — never silently dropped");
  assert.ok(
    String((lost[0].data as { error?: unknown }).error ?? "").includes(conversion.neededContext),
    "and the record says what the orchestrator never heard",
  );

  // A LATER run, with a queue that does not contain I1 at all.
  const secondRunId = createRunFor(store);
  seedExecuting(store, secondRunId, {
    items: [makeQueueItem("I9", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  });
  const second = await idle();
  assert.equal(second.runId, secondRunId, "premise: the engine is now working the SECOND run");
  assert.equal(second.prompted, true, "premise: which does get its own re-prompt");
  assert.equal(wiring.sdk.prompts.length, 1, "premise: exactly one prompt was sent, and it belongs to the second run");
  const text = wiring.sdk.prompts[0].text;
  assert.ok(text.includes("I9"), "premise: it names the second run's own item");
  assert.equal(
    text.includes(conversion.neededContext),
    false,
    "a conversion raised under an archived run is never delivered into a later run's re-prompt",
  );
  assert.equal(text.includes("I1"), false, "and the later run is never told about an item it does not contain");
  store.release();
});

// ===========================================================================
// [10.1-binding-orphan-question-reconcile] — the release outlives LATER questions
// ===========================================================================

test("[10.1-binding-orphan-question-reconcile] a deliberate release is remembered in the DURABLE record, not inferred from the filesystem: after conductor_queue_amend releases an item under a still-OPEN question, a LATER question appended for a different item — an ordinary event on any run that carries on — does not resurrect the released block, while that later question's own half-applied window is repaired in the same pass", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] }),
      makeQueueItem("I3", { fileScope: ["src/other.mjs"], testScope: ["tests/o.test.mjs"] }),
    ],
  };
  seedExecuting(store, runId, queue);
  const runDir = runDirOf(store, runId);

  const ask = (itemId: string): string =>
    appendQuestion(
      runDir,
      {
        runId,
        question: `conductor_submit_test could not obtain a legal RED for item "${itemId}"`,
        askedBy: { role: "testWriter", sessionID: SUB },
        humanTerritory: false,
        origin: "implementer-blocked",
        blocksItems: [itemId],
      },
      START_MS,
    ).id;

  const releasedQuestion = ask("I1");
  store.setBlocked(runId, "I1", { reason: BLOCK_MARKER, stage: "PENDING", questionId: releasedQuestion });
  assert.notEqual(store.loadItem(runId, "I1").blocked, null, "premise: I1's block was fully applied");

  const amended = handleQueueAmend({
    store,
    runId,
    config,
    journal: journal.sink,
    now: () => START_MS,
    ops: [
      {
        op: "update",
        item: makeQueueItem("I1", {
          fileScope: ["src/parser.mjs"],
          testScope: ["tests/p.test.mjs", "tests/p.signed.test.mjs"],
        }),
      },
    ],
    question: "should I1's test scope widen to cover the signed cases?",
    options: [
      {
        name: "widen I1's test scope",
        score: { capability: 4, testability: 5, movingParts: 4, validationEarliness: 5, singleSource: 4 },
      },
      {
        name: "leave the scope and add a second item",
        score: { capability: 3, testability: 3, movingParts: 2, validationEarliness: 3, singleSource: 2 },
      },
    ],
    choice: "widen I1's test scope",
    why: "the signed cases belong to the same behaviour, so one item still owns one change",
    appliedWhere: "queue.json",
  });
  assert.deepEqual(amended.updated, ["I1"], "premise: the amendment updated I1");
  assert.equal(store.loadItem(runId, "I1").blocked, null, "premise: §2.5's legal clearer released I1");

  // The run CARRIES ON: a later item hits its own §2.11 window, so questions.jsonl
  // grows AFTER the release was written. Nothing about I1 changed.
  const laterQuestion = ask("I3");
  assert.equal(store.loadItem(runId, "I3").blocked, null, "premise: I3 is the genuine half-applied orphan");
  assert.notEqual(laterQuestion, releasedQuestion, "premise: and it is a question of its own");

  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const state = createContinuationState();
  const clock = makeClock();
  const idle = async (): Promise<SessionIdleResult> => {
    const out: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client: wiring.client,
      config,
      journal: journal.sink,
      stateHome: freshStateHome(),
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 5);
    return out;
  };
  const res = await idle();

  assert.equal(
    store.loadItem(runId, "I1").blocked,
    null,
    "the released item stays released after a later question is appended — the escape hatch is not restored only until the next question",
  );
  assert.equal(
    store.loadItem(runId, "I3").blocked?.questionId,
    laterQuestion,
    "while the later question's own orphan is completed on that same pass",
  );
  assert.equal(res.stop, null, "the pass records no stop");
  assert.equal(readQuestions(runDir).length, 2, "and appends no question");

  // The release excuses THAT question, not the item: I1 later hits a §2.11 window of
  // its own, and the half-applied block behind that NEW question is a genuine orphan.
  // An item that has ever been released must not become permanently unrepairable.
  const secondQuestion = ask("I1");
  await idle();
  assert.equal(
    store.loadItem(runId, "I1").blocked?.questionId,
    secondQuestion,
    "a NEW question's half-applied window on the same item is still completed — the record excuses one question, not the item forever",
  );
  store.release();
});

// ===========================================================================
// [10.1-one-reprompt-in-flight] — a send that never left the process
// ===========================================================================

test("[10.1-one-reprompt-in-flight] a send that THREW is not accounted for as a re-prompt: with a permanently throwing transport, four idles outside the debounce window leave idleRePrompts and futileRePrompts at zero, write no continuation/reprompt record and no §2.8 disengage anomaly, and never stop the run `noop` — the wedge rule may only accuse an orchestrator that was actually asked", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  const runDir = runDirOf(store, runId);

  const THROW_MARKER = "INJECTED unreachable transport 7731";
  const registry = makeRegistry([[ORCH, { role: "orchestrator" }]]);
  const wiring = makeWiring(registry);
  const client: ContinuationClient = {
    session: {
      create: (opts) => wiring.client.session.create(opts),
      prompt: () => {
        throw new Error(THROW_MARKER);
      },
      abort: (opts) => wiring.client.session.abort(opts),
      messages: (opts) => wiring.client.session.messages(opts),
    },
    postSessionIdPermissionsPermissionId: (opts) => wiring.client.postSessionIdPermissionsPermissionId(opts),
  };

  const clock = makeClock();
  const state = createContinuationState();
  const stateHome = freshStateHome();
  const idle = async (): Promise<SessionIdleResult> => {
    const out: SessionIdleResult = await handleSessionIdle({
      store,
      state,
      registry,
      sessionID: ORCH,
      client,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wk",
      now: clock.now,
    });
    await turns();
    clock.advance(DEBOUNCE_MS * 5);
    return out;
  };

  const passes: SessionIdleResult[] = [];
  for (let n = 0; n < 4; n += 1) passes.push(await idle());

  assert.equal(wiring.sdk.prompts.length, 0, "premise: not one prompt ever reached the transport");
  assert.deepEqual(
    passes.map((p) => p.prompted),
    [false, false, false, false],
    "premise: and no pass claims to have prompted",
  );
  const counters = readRunFile(store, runId).counters;
  assert.equal(counters.idleRePrompts, 0, "a send that never left this process is not counted as a re-prompt");
  assert.equal(counters.futileRePrompts, 0, "nor charged to the futility rule, which describes the ORCHESTRATOR's silence");
  assert.equal(
    journal.records.filter((r) => r.component === "continuation" && r.event === "reprompt").length,
    0,
    "and no continuation/reprompt record claims a message was sent",
  );
  assert.equal(
    journal.records.filter((r) => r.level === "error").length,
    4,
    "the four failures are journaled at error level — the correct and sufficient trace",
  );
  assert.equal(passes[3].stop, null, "the fourth pass does not disengage on prompts the orchestrator never received");
  assert.equal(readRunFile(store, runId).stop, null, "and run.json carries no false wedge verdict");
  assert.equal(
    readAnomalies(runDir).filter((a) => a.kind === "disengage").length,
    0,
    "and no §2.8 disengage anomaly accuses a run that was never asked",
  );
  store.release();
});
