// Task 12.2 RED tests — FINAL LOCATION conductor/tests/setup.test.ts.
//
// SUBJECT (must NOT exist when this goes red):
//   adapter/tools.ts  handleSetup            — the conductor_setup handler (§3.4; its NAME and
//                                              its {reconfigure?} arg schema are ALREADY
//                                              registered at tools.ts:112 / plugin/index.ts:224
//                                              and asserted by tests/gate-wiring.test.ts:240 —
//                                              NONE of that registration is new work here)
//   adapter/tools.ts  SETUP_PROBE_SCHEMA_NAME — the SCHEMAS key the §2.1:630 schema probe
//                                              constrains its request with and validates its
//                                              reply against, through core validate()
//   adapter/gitio.ts  initRepo               — the §3.9:1500 "initialize a repo here" branch;
//                                              gitio exports read queries ONLY at HEAD
//   adapter/config-io.ts loadConfig / DEFAULT_CONFIG
//                                            — task-let 5.4a's §2.1 config reader and its
//                                              single-source default Config. 12.2 CONSUMES
//                                              them; it does not author a second reader and it
//                                              does not retype a second default.
// Every other import in this file resolves to a committed export at HEAD, so the red is the
// missing-subject shape (§2.6.1): `Cannot find module '../adapter/config-io.ts'` first, and
// the missing named bindings from tools.ts / gitio.ts behind it.
//
// Spec read:
//   docs/plans/2026-08-07-conductor-harness-plan.md
//     Task 12.2 (2890-2913) — the authoritative behaviour of this task.
//     §2.1 (478-636)        — the config shape, the four itemTest defaults, the detection
//                             list, the two undefaultable questions, and the SETUP PROOF
//                             TABLE (628-632) with its law at :634 — "A failed check is a
//                             setup failure with a named remedy, not a warning."
//     §3.4 (1327)           — conductor_setup's row: legal while config is absent, or with
//                             reconfigure:true (no live run + a journaled config diff).
//     §3.9 (1498-1508)      — isRepo false ⇒ the one interactive choice; what no-git sets.
//     §6.2 (1874-1875)      — mid-run interactive interruption is sanctioned for exactly two
//                             things, one of which is `git.mode` first-run setup.
//   docs/build/specs/task-12.2.assertions.json — the 28 rows below, its verifiedAgainstHead
//     facts, its correctionsToDraft rulings, its reusesExisting list, its 19 specGaps, and
//     its orchestratorAmendment_2026_08_14 (the 5.4a collision).
//   docs/build/specs/task-5.4a.assertions.json — row 5.4a-default-config-is-safe-not-permissive,
//     which pins DEFAULT_CONFIG as the single source this task builds its candidate from.
//   router/UPSTREAM_CONTRACT.md + CORRECTIONS.md C-058 — the live measurements this file's
//     slot-count and schema-probe rows are built on (see M1/M2/M3 below).
//   CORRECTIONS.md C-003 — bare `pytest` is not on PATH on this machine.
//
// ---------------------------------------------------------------------------
// MEASURED FACTS this file is built on (never assumed; re-measured in-file where a test
// depends on them, so a machine change turns into a loud failure and not a silent pass).
//
//  (M1) llama-server reports its slot count at GET /props -> total_slots. Measured on
//       qwen3.6-27b / llama-server 10298: 4 with no `--parallel`, 6 with `--parallel 6`
//       (UPSTREAM_CONTRACT.md:21-22,57-80). Those are the two numbers the slot rows use, and
//       §2.1's default parallel.maxReaders is 6 — so "no --parallel" is exactly the failing
//       configuration the proof exists to catch.
//  (M2) `--ctx-size` is the TOTAL context divided among slots: `--parallel 6` beside an
//       unchanged `--ctx-size 8192` cuts every slot's window to 1536 (C-058 F3). A remedy
//       that names `--parallel` alone therefore instructs the user into a 6x context cut, so
//       the remedy string is asserted to name `--ctx-size` too.
//  (M3) A schema-constrained probe can return EMPTY content with a 200 status — the 27B model
//       spent a full 1024-token budget reasoning and returned "" (C-058 F1-CONFIRMED). An
//       empty body is therefore a FAILING probe: a check that accepted "" would pass against a
//       model that can never produce structured output at all.
//  (M4) `pytest` is not on PATH here; `/usr/bin/python3 -m pytest` is pytest 8.4.2 (C-003).
//       Re-measured in [12.2-c003-pytest-measured] before it is relied on.
//  (M5) `go --version` exits 2 on this toolchain (measured) while spawning perfectly well —
//       the case that makes "unspawnable, not unhappy" a real distinction.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS + INTERPRETATIONS (this file is the contract that pins them;
// the implementer must target these exactly).
//
//  (P1) TWO-PHASE, and the ANSWERS TRANSPORT (spec gap "answers transport"). §3.4 pins the
//       tool args as {reconfigure?} only, but the two undefaultable answers must reach the
//       handler. handleSetup takes an optional `answers` object; the tool spec in
//       plugin/index.ts gains the same optional arg (a recorded plan deviation — tool args are
//       not a LAW closed vocabulary; no §2 schema, state field or journal event is touched).
//       A call WITHOUT every required answer runs DETECTION + the SMOKE SPAWN, returns the
//       proposals and the open asks, and WRITES NOTHING. A call carrying every required
//       answer additionally runs the three live proofs and, only if all pass, writes.
//  (P2) ILLEGALITY THROWS; A FAILED PROOF RETURNS. An out-of-contract CALL (already configured
//       without reconfigure:true; reconfigure with a live run) THROWS an Error naming the legal
//       alternative — the committed handleX convention. A failed setup CHECK returns
//       {ok:false, written:false, failures:[…]} so every named remedy is narrated at once;
//       §2.1:634 makes it a failure either way, and it is not an illegal call.
//  (P3) THE SLOT PROOF HAS TWO LEGS, neither of them a stopwatch. Leg 1 is the spec row's own
//       mechanism: parallel.maxReaders concurrent trivial completions on /v1/chat/completions —
//       the ONE path a router proxies (router.hpp:104-108) — every one of which must come back
//       served. Leg 2 is the capacity number, GET {origin}/props -> total_slots (M1). Leg 1
//       alone cannot see a server that ACCEPTS every reader and then queues them (llama-server
//       does exactly that at --parallel 1); leg 2 alone never issues the fan-out the row
//       specifies, and /props is not under /v1, so a healthy router 404s it — which is why leg 2
//       retries the UPSTREAM origin directly rather than treating a routing fact as a proof
//       failure. Wall-clock overlap is what the row forbids and is measured nowhere.
//  (P4) THE SCHEMA PROBE registers its own tiny schema into the (deliberately mutable, see
//       core/types.ts:1238-1242) SCHEMAS record under SETUP_PROBE_SCHEMA_NAME, sends it as the
//       request's response_format.json_schema.schema, and validates the reply through core
//       validate(SETUP_PROBE_SCHEMA_NAME, parsed). One object, both ends — no second schema
//       literal. This registers a PROBE schema; it changes no §2 artifact schema.
//  (P5) THE ORIGIN IS RESOLVED INSIDE THE HANDLER. handleSetup takes {router, upstream,
//       failoverState} and calls router-client resolveBaseUrl itself, because the fail-soft row
//       requires it to RE-resolve after noteRouterFailure latches useUpstream. (The spec's
//       "the origin is an INPUT" phrasing cannot satisfy its own G5 row; the configs are the
//       input instead.) Probes are DIRECT bounded node:http with stream:false — never through
//       opencode's prompt path, which wire-notes.md:41-55 proved emits no response_format.
//  (P6) SMOKE COVERAGE IS OBSERVABLE. proposals.smoked is the list of probes actually spawned:
//       {source, argv0, ok}, one row per command the config would record — every scope
//       `command`, every scope `itemTest` (substituted against a representative testScope
//       file), and every format-rule command. Without it "the check covers every command" is
//       an unverifiable claim, since a scope command and its itemTest almost always share an
//       argv[0]. The probe is [argv0, "--version"], shell:false, under evidence.childEnv, with
//       closed stdin and a bounded kill timeout; ok:false means the process could not be
//       SPAWNED (spawnSync `error` set), never that it exited non-zero (M5).
//  (P7) THE NODE itemTest IS ATTACHED ON RECOGNITION, NOT ON detectRunner. evidence.ts:137
//       falls back to the node profile for EVERY unrecognized command, so detectRunner(["jest"])
//       IS the node profile — keying the attachment on detectRunner would staple
//       `node --test {files}` onto a jest repo, the precise silent-wrong-answer the spec row
//       exists to prevent. The template attaches iff basename(argv[0]) starts with "node" or
//       the argv contains "--test". Asserted as the converse (a node template implies a
//       recognized node command), which is the checkable direction.
//  (P8) SCOPE NAMES ARE THE ECOSYSTEM KEYS — node | python | go | cmake | cargo — so a
//       multi-ecosystem repo cannot silently overwrite one scope with another, and each
//       proposal carries `ecosystem` and `sourceGlob` alongside the §2.1 scope fields.
//       requiredScopes is one entry per scope: pattern "**" when exactly one ecosystem was
//       detected, otherwise that ecosystem's sourceGlob — an EXTENSION glob (**/*.{js,ts,...}),
//       not a directory glob, so two ecosystems in one repo cover the repo's sources between
//       them instead of both claiming src/** and leaving lib/, include/ and test/ to nobody.
//  (P9) THE DIFF JOURNAL EVENT is `state` / `config.updated`, added to core/journal-events.ts
//       EVENTS.state under that file's own sanctioned-widening rule (the `decision.recorded`
//       precedent, C-029 F7). data.changes is [{key, from, to}] over dotted key paths, ONLY
//       the changed keys, and an empty array when nothing changed. Setup journals through a
//       runId-OPTIONAL sink shaped like adapter/state.ts:47 StateJournal, because it has no run.
// (P10) THE §2.11 QUESTION LEDGER IS NOT TOUCHED. The two asks are the handler's RESULT
//       (§6.2:1875's sanctioned interactive ask). No questions.jsonl is written and the
//       QuestionRecord origin vocabulary is not widened.
//
// ---------------------------------------------------------------------------
// Assertion id -> test (each test name carries its row id as its FIRST token):
//   12.2-detect-itemtest-templates    -> the five-ecosystem matrix: argv arrays, the §2.1:499
//                                        templates, and every proposal round-tripped through
//                                        the COMMITTED detectRunner + substituteItemTest.
//   12.2-detect-go-dirs               -> {dirs} targets package dirs; no go argv carries -run.
//   12.2-detect-node-scripts-test     -> scripts.test is read and tokenized by shellTokens; the
//                                        node template attaches only to a recognized node cmd.
//   12.2-detect-multi-ecosystem       -> two scopes, one requiredScopes entry each; never empty.
//   12.2-detect-behavioral-paths      -> per-ecosystem proposals, carried on the ask, never
//                                        written unanswered; the go ask names the _test.go caveat.
//   12.2-detect-cargo                 -> cargo proposal, no itemTest, no fifth RUNNER_PROFILE.
//   12.2-no-build-command             -> scope key sets exactly; a spliced buildCommand fails
//                                        the registered schema.
//   12.2-smoke-spawn-unspawnable-fails-> an unspawnable argv[0] fails setup, names argv+remedy,
//                                        writes nothing; coverage over commands/itemTests/rules.
//   12.2-smoke-spawn-semantics        -> non-zero exit passes; shell metacharacters are one
//                                        executable name; childEnv hygiene; bounded timeout.
//   12.2-proof-models-default         -> the §2.1:629 proof, against a recorded GET /v1/models.
//   12.2-models-default-derived       -> derived from the list or the caller, never guessed.
//   12.2-proof-schema-probe           -> the §2.1:630 proof; request shape asserted; an EMPTY
//                                        reply FAILS (M3).
//   12.2-proof-slot-count             -> the §2.1:631 proof at the measured 4-vs-6 (M1); the
//                                        remedy names --parallel and --ctx-size (M2).
//   12.2-zero-model-dispatch          -> three direct requests, no model sub-session at all.
//   12.2-proofs-origin-fail-soft      -> a dead router is not a setup failure (G5).
//   12.2-proof-before-write           -> every failure leg leaves the repo unconfigured.
//   12.2-two-asks-no-default          -> both undefaultable asks; zero question records.
//   12.2-partial-answers-write-nothing-> one answer is not enough; no §2.1 example is defaulted.
//   12.2-nogit-offer                  -> the §3.9 single choice; `git init` from the HANDLER.
//   12.2-nogit-config                 -> read-only + writes off, and NO invented field.
//   12.2-exclude-registration         -> the committed registerConductorExclude, once, and not
//                                        at all when a proof failed.
//   12.2-config-written-atomic-valid  -> the written file, field by field, against DEFAULT_CONFIG
//                                        and the §2.1 numbers.
//   12.2-repo-configured-one-derivation-> gate and handler never disagree; corrupt reopens setup.
//   12.2-setup-legality               -> legal while absent, refuses when configured.
//   12.2-reconfigure-live-run-denies  -> isTerminal is the predicate; the config is untouched.
//   12.2-reconfigure-diff-journaled   -> the diff, through the REAL throwing journal.
//   12.2-c003-pytest-measured         -> the pytest fallback, measured on this machine.
//   12.2-no-new-runtime-dependency    -> G1/G14 source scan of the touched adapter modules.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// THE SUBJECTS — absent at red time.
import { handleSetup, SETUP_PROBE_SCHEMA_NAME } from "../adapter/tools.ts";
import { initRepo } from "../adapter/gitio.ts";
import { DEFAULT_CONFIG, loadConfig } from "../adapter/config-io.ts";

// Committed adapters + core.
import { gitCommonDir, isRepo } from "../adapter/gitio.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateStore } from "../adapter/state.ts";
import { RUNNER_PROFILES, detectRunner, substituteItemTest } from "../adapter/evidence.ts";
import { createFailoverState } from "../adapter/router-client.ts";
import type { FailoverState } from "../adapter/router-client.ts";
import { createJournal } from "../adapter/journal.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateRun } from "../core/gates-phase.ts";
import { isTerminal } from "../core/stops.ts";
import { globMatch, shellTokens } from "../core/shell-parse.ts";
import { SCHEMAS, validate } from "../core/types.ts";
import type { Config, GitMode, LogLevel } from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY so every call site below typechecks the green
// implementation against this file's contract (the 9.4a/9.4b/9.4c convention).
// ---------------------------------------------------------------------------

interface SetupAnswers {
  // §2.1:622 question 1 — NEVER defaulted.
  gitMode?: GitMode;
  // §2.1:622 question 2 — the confirmed (or corrected) behavioralPaths. NEVER defaulted.
  behavioralPaths?: string[];
  // §3.9:1500-1502 — true: initialize a repo here; false: run in no-git mode.
  initRepo?: boolean;
}

interface SetupAsk {
  id: string;
  question: string;
  options: string[];
  proposal: string[] | null;
}

interface ProposedScope {
  name: string;
  ecosystem: string;
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
  behavioralPaths: string[];
  sourceGlob: string;
}

interface SmokeProbe {
  source: string;
  argv0: string;
  ok: boolean;
}

interface SetupProposals {
  scopes: ProposedScope[];
  behavioralPaths: string[];
  requiredScopes: Array<{ pattern: string; scopes: string[] }>;
  notes: string[];
  smoked: SmokeProbe[];
}

interface ConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}

interface SetupResult {
  ok: boolean;
  written: boolean;
  repoConfigured: boolean;
  isRepo: boolean;
  asks: SetupAsk[];
  proposals: SetupProposals;
  config: Config | null;
  failures: string[];
  diff: ConfigChange[] | null;
}

interface SetupJournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
}

interface SetupInput {
  root: string;
  journal: SetupJournalSink;
  router: { listen: { host: string; port: number }; probeTimeoutMs: number };
  upstream: { host: string; port: number };
  failoverState: FailoverState;
  reconfigure?: boolean;
  answers?: SetupAnswers;
  // The session's served model id when the caller knows it (Task 12.1 does).
  modelId?: string;
  now?: () => number;
}

// The three ask ids (P1/P10).
const ASK_GIT_MODE = "git.mode";
const ASK_BEHAVIORAL_PATHS = "verify.behavioralPaths";
const ASK_GIT_INIT = "git.init";

// The §2.1:499 itemTest defaults, verbatim.
const NODE_ITEM_TEST = ["node", "--test", "{files}"];
const PYTEST_ITEM_TEST = ["pytest", "{files}"];
const GO_ITEM_TEST = ["go", "test", "{dirs}"];
const CTEST_ITEM_TEST = ["ctest", "-R", "{name}"];

// P4: the probe schema, pinned here so BOTH ends of the probe are one object.
const PROBE_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Temp-dir + git fixture bookkeeping (the tests/evidence.test.ts idiom): every fixture is a
// throwaway directory under os.tmpdir(), torn down at the end of the file.
// ---------------------------------------------------------------------------

const TMP_DIRS: string[] = [];

function newDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-12-2-${tag}-`));
  TMP_DIRS.push(dir);
  return dir;
}

after(() => {
  for (const dir of TMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

// Hermetic git: no user/global/system config reaches these fixtures, and identity comes from
// the environment so `git commit` needs no `git config` call.
const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_OPTIONAL_LOCKS: "0",
};

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

function writeFixtureFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

/** A fixture workspace. `repo: false` builds a plain directory (the §3.9 case). */
function fixture(tag: string, files: Record<string, string>, opts?: { repo?: boolean }): string {
  const root = newDir(tag);
  writeFixtureFiles(root, files);
  if (opts?.repo !== false) {
    git(root, "init", "-q", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "fixture");
  }
  return root;
}

// --- the ecosystem fixture contents -----------------------------------------

const PKG_NODE_TEST = JSON.stringify(
  { name: "fx-node", version: "1.0.0", scripts: { test: "node --test" } },
  null,
  2,
);
const PKG_NO_SCRIPTS = JSON.stringify({ name: "fx-node-bare", version: "1.0.0" }, null, 2);
const PKG_JEST = JSON.stringify(
  { name: "fx-jest", version: "1.0.0", scripts: { test: "jest" } },
  null,
  2,
);
const PKG_CTEST_SCRIPT = JSON.stringify(
  { name: "fx-ctest-script", version: "1.0.0", scripts: { test: "ctest -R fx" } },
  null,
  2,
);

const CMAKELISTS = [
  "cmake_minimum_required(VERSION 3.20)",
  "project(fx CXX)",
  "enable_testing()",
  "add_test(NAME fx_smoke COMMAND true)",
  "",
].join("\n");

const PYPROJECT = ['[project]', 'name = "slugger"', 'version = "0.1.0"', ""].join("\n");
const CARGO_TOML = ["[package]", 'name = "fx"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n");
const GO_MOD = ["module example.com/fx", "", "go 1.22", ""].join("\n");

function nodeFixture(tag: string, pkg: string): string {
  return fixture(tag, {
    "package.json": pkg,
    "src/index.js": "export const x = 1;\n",
    "tests/a.test.js": "// fixture test\n",
  });
}

function cmakeFixture(tag: string): string {
  return fixture(tag, { "CMakeLists.txt": CMAKELISTS, "src/main.cpp": "int main(){return 0;}\n" });
}

function pythonFixture(tag: string): string {
  return fixture(tag, { "pyproject.toml": PYPROJECT, "slugger/__init__.py": "" });
}

function cargoFixture(tag: string): string {
  return fixture(tag, { "Cargo.toml": CARGO_TOML, "src/lib.rs": "pub fn x() -> u8 { 1 }\n" });
}

function goFixture(tag: string): string {
  return fixture(tag, { "go.mod": GO_MOD, "pkg/a/a.go": "package a\n" });
}

function multiFixture(tag: string): string {
  return fixture(tag, {
    "package.json": PKG_NODE_TEST,
    "CMakeLists.txt": CMAKELISTS,
    "src/index.js": "export const x = 1;\n",
    "tests/a.test.js": "// fixture test\n",
  });
}

// ---------------------------------------------------------------------------
// The stub served origin (the fixtures/stub-llm-server.ts PATTERN: node:http on an ephemeral
// port, every request recorded, canned bodies, close()). It is NOT that fixture — that one
// answers {ok:true} to every non-chat path, serves no /v1/models, has no slot instrumentation
// and requires an editTargetPath (stub-llm-server.ts:122,147-151).
// ---------------------------------------------------------------------------

interface StubOptions {
  models?: string[];
  totalSlots?: number;
  chatContent?: string;
  chatStatus?: number;
  // The ROUTER's shape: router.hpp:104-108 pins kProxyPathPattern "/v1/.*" and every other
  // path falls through to httplib's own 404. A stub standing in for the router must 404 the
  // origin-root endpoints, or a test cannot see what a real router does to them.
  proxyOnlyV1?: boolean;
  // Hold each slot-probe completion (a chat request carrying NO response_format) open until
  // this many are open AT ONCE, then release the batch. peakConcurrentSlotProbes() is what
  // the SERVER saw, so a test can measure overlap without a stopwatch. Default 1: release
  // immediately, which is the behaviour every other test in this file expects.
  slotBarrier?: number;
  // Serve at most this many slot probes; every reader past it comes back 503, the way a
  // server with fewer readers than the fan-out refuses the overflow instead of holding it.
  serveAtMostSlotProbes?: number;
}

interface StubRequest {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

interface StubHandle {
  host: string;
  port: number;
  requests: StubRequest[];
  /** The greatest number of slot-probe completions this server held open simultaneously. */
  peakConcurrentSlotProbes: () => number;
  close: () => Promise<void>;
}

const SERVED_MODEL = "stub-served-model-4471";
const PROBE_CONFORMING = JSON.stringify({ ok: true });
const PROBE_NONCONFORMING = JSON.stringify({ nope: 1 });

function startStub(options: StubOptions = {}): Promise<StubHandle> {
  const models = options.models ?? [SERVED_MODEL];
  const totalSlots = options.totalSlots ?? 6;
  const chatContent = options.chatContent ?? PROBE_CONFORMING;
  const chatStatus = options.chatStatus ?? 200;
  const proxyOnlyV1 = options.proxyOnlyV1 ?? false;
  const slotBarrier = options.slotBarrier ?? 1;
  const serveAtMostSlotProbes = options.serveAtMostSlotProbes ?? Number.MAX_SAFE_INTEGER;
  const requests: StubRequest[] = [];
  let acceptedSlotProbes = 0;
  let openSlotProbes = 0;
  let peakSlotProbes = 0;
  let held: Array<() => void> = [];
  let barrierTimer: ReturnType<typeof setTimeout> | null = null;

  const releaseHeld = (): void => {
    const batch = held;
    held = [];
    for (const release of batch) release();
  };

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = { unparseable: raw };
        }
      }
      const url = req.url ?? "";
      requests.push({ method: req.method ?? "", url, body });

      const json = (status: number, payload: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (proxyOnlyV1 && !url.startsWith("/v1/")) {
        json(404, { error: "this origin proxies only /v1/* (router.hpp:104-108): " + url });
        return;
      }

      if (url.startsWith("/v1/models")) {
        json(200, { object: "list", data: models.map((id) => ({ id, object: "model" })) });
        return;
      }
      // M1: llama-server publishes its slot count here, at the ORIGIN root (not under /v1).
      if (url.startsWith("/props")) {
        json(200, { total_slots: totalSlots });
        return;
      }
      if (url.includes("chat/completions")) {
        const chatBody = {
          id: "chatcmpl-stub-12-2",
          object: "chat.completion",
          choices: [
            { index: 0, message: { role: "assistant", content: chatContent }, finish_reason: "stop" },
          ],
        };
        // The schema probe carries response_format; the slot probes do not.
        if ("response_format" in body) {
          json(chatStatus, chatBody);
          return;
        }
        acceptedSlotProbes += 1;
        if (acceptedSlotProbes > serveAtMostSlotProbes) {
          json(503, { error: "no free slot for this reader" });
          return;
        }
        openSlotProbes += 1;
        if (openSlotProbes > peakSlotProbes) peakSlotProbes = openSlotProbes;
        held.push(() => {
          openSlotProbes -= 1;
          json(chatStatus, chatBody);
        });
        if (held.length >= slotBarrier) {
          if (barrierTimer !== null) {
            clearTimeout(barrierTimer);
            barrierTimer = null;
          }
          releaseHeld();
        } else if (barrierTimer === null) {
          // A barrier that is never reached must still answer, or the probe would fail on a
          // timeout rather than on the count the test is about.
          barrierTimer = setTimeout(() => {
            barrierTimer = null;
            releaseHeld();
          }, 400);
        }
        return;
      }
      json(404, { error: "no stub route for " + url });
    });
  });

  return new Promise<StubHandle>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        host: "127.0.0.1",
        port,
        requests,
        peakConcurrentSlotProbes: () => peakSlotProbes,
        close: () =>
          new Promise<void>((done) => {
            if (barrierTimer !== null) {
              clearTimeout(barrierTimer);
              barrierTimer = null;
            }
            releaseHeld();
            server.close(() => done());
          }),
      });
    });
  });
}

async function withStub<T>(options: StubOptions, body: (stub: StubHandle) => Promise<T>): Promise<T> {
  const stub = await startStub(options);
  try {
    return await body(stub);
  } finally {
    await stub.close();
  }
}

/** A port nothing listens on: bind an ephemeral port, read it, release it. */
function closedPort(): Promise<number> {
  return new Promise<number>((resolve) => {
    const server = createServer(() => {});
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------
// Handler input harness.
// ---------------------------------------------------------------------------

interface LoggedRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}

interface Harness {
  input: SetupInput;
  records: LoggedRecord[];
  failover: FailoverState;
}

function harness(root: string, stub: StubHandle, opts?: { routerPort?: number }): Harness {
  const records: LoggedRecord[] = [];
  const failover = createFailoverState();
  const input: SetupInput = {
    root,
    journal: {
      log: (level, component, event, data, corr) => {
        records.push({ level, component, event, data, corr });
      },
    },
    router: { listen: { host: "127.0.0.1", port: opts?.routerPort ?? stub.port }, probeTimeoutMs: 4000 },
    upstream: { host: "127.0.0.1", port: stub.port },
    failoverState: failover,
  };
  return { input, records, failover };
}

const ANSWERED_PATHS = ["app-src/**"];

function answers(over?: Partial<SetupAnswers>): SetupAnswers {
  return { gitMode: "read-only", behavioralPaths: [...ANSWERED_PATHS], ...over };
}

// THE one call site of the subject. Typing it here (rather than casting at each call) is what
// makes this file a contract: the green handleSetup must accept SetupInput and return a
// SetupResult, structurally, or tsc --noEmit fails.
async function setup(input: SetupInput): Promise<SetupResult> {
  return await handleSetup(input);
}

function configPathOf(root: string): string {
  return path.join(root, ".conductor", "config.json");
}

function readConfigRaw(root: string): string {
  return readFileSync(configPathOf(root), "utf8");
}

function scopeOf(result: SetupResult, ecosystem: string): ProposedScope {
  const found = result.proposals.scopes.find((scope) => scope.ecosystem === ecosystem);
  assert.ok(
    found !== undefined,
    `expected a "${ecosystem}" scope; got ${JSON.stringify(result.proposals.scopes)}`,
  );
  return found;
}

function askOf(result: SetupResult, id: string): SetupAsk {
  const found = result.asks.find((ask) => ask.id === id);
  assert.ok(found !== undefined, `expected an ask "${id}"; got ${JSON.stringify(result.asks)}`);
  return found;
}

function hasAsk(result: SetupResult, id: string): boolean {
  return result.asks.some((ask) => ask.id === id);
}

function failureText(result: SetupResult): string {
  return result.failures.join(" | ");
}

/** Every file under a directory tree, as repo-relative paths. */
function walk(dir: string, base: string, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

// ---------------------------------------------------------------------------
// (1) [12.2-detect-itemtest-templates]
// ---------------------------------------------------------------------------

test("[12.2-detect-itemtest-templates] each ecosystem proposes an argv-array command and the §2.1:499 itemTest, and every proposal round-trips through the COMMITTED evidence machinery", async () => {
  const roots = {
    node: nodeFixture("tmpl-node", PKG_NO_SCRIPTS),
    cmake: cmakeFixture("tmpl-cmake"),
    python: pythonFixture("tmpl-python"),
    cargo: cargoFixture("tmpl-cargo"),
    go: goFixture("tmpl-go"),
  };
  const testScope = ["pkg/a/a_test.go", "tests/a.test.js"];

  await withStub({}, async (stub) => {
    // node: no scripts.test -> the bare default, plus the node template.
    const nodeResult = await setup(harness(roots.node, stub).input);
    const nodeScope = scopeOf(nodeResult, "node");
    assert.deepEqual(nodeScope.command, ["node", "--test"]);
    assert.deepEqual(nodeScope.itemTest, NODE_ITEM_TEST);

    // cmake -> ctest.
    const cmakeResult = await setup(harness(roots.cmake, stub).input);
    const cmakeScope = scopeOf(cmakeResult, "cmake");
    assert.deepEqual(cmakeScope.command, ["ctest"]);
    assert.deepEqual(cmakeScope.itemTest, CTEST_ITEM_TEST);

    // go -> the package-dir template.
    const goResult = await setup(harness(roots.go, stub).input);
    const goScope = scopeOf(goResult, "go");
    assert.deepEqual(goScope.command, ["go", "test", "./..."]);
    assert.deepEqual(goScope.itemTest, GO_ITEM_TEST);

    // cargo -> NO itemTest key at all (§2.1:487-497 absent-template fallback).
    const cargoResult = await setup(harness(roots.cargo, stub).input);
    const cargoScope = scopeOf(cargoResult, "cargo");
    assert.deepEqual(cargoScope.command, ["cargo", "test"]);
    assert.equal(
      Object.hasOwn(cargoScope, "itemTest"),
      false,
      "cargo has no §2.1 itemTest default and must not be given an invented one",
    );

    // python -> the §2.1:499 default is `pytest {files}`; on THIS machine C-003's fallback
    // applies, so the shape is pinned (a pytest-profile argv ending in {files}) here and the
    // exact fallback argv is pinned by [12.2-c003-pytest-measured].
    const pyResult = await setup(harness(roots.python, stub).input);
    const pyScope = scopeOf(pyResult, "python");
    const pyItemTest = pyScope.itemTest;
    assert.ok(pyItemTest !== undefined, "the python leg must carry an itemTest template");
    assert.ok(pyItemTest.includes("pytest"), `python itemTest must invoke pytest: ${JSON.stringify(pyItemTest)}`);
    assert.equal(pyItemTest[pyItemTest.length - 1], "{files}", "the pytest template targets {files}");
    assert.equal(detectRunner(pyItemTest).runner, "pytest");
    assert.equal(detectRunner(pyScope.command).runner, "pytest");
    assert.deepEqual(
      PYTEST_ITEM_TEST,
      ["pytest", "{files}"],
      "the §2.1:499 pytest default this file measures the fallback against",
    );

    // Every proposal, across every ecosystem: argv ARRAYS only, and each one proven against
    // the COMMITTED machinery rather than a parallel template system.
    const all = [nodeResult, cmakeResult, goResult, cargoResult, pyResult];
    for (const result of all) {
      for (const scope of result.proposals.scopes) {
        assert.ok(Array.isArray(scope.command), `command must be an argv array: ${scope.name}`);
        assert.ok(scope.command.length > 0, `command must be non-empty: ${scope.name}`);
        for (const token of scope.command) assert.equal(typeof token, "string");
        assert.equal(typeof scope.timeoutMs, "number");

        const profile = detectRunner(scope.command);
        assert.ok(
          Object.hasOwn(RUNNER_PROFILES, profile.runner),
          `detectRunner must return a committed profile for ${JSON.stringify(scope.command)}`,
        );
        // The four non-cargo ecosystems must land on their OWN profile. RUNNER_PROFILES is
        // keyed by RUNNER, not by ecosystem, and the committed set is exactly
        // node/pytest/go/ctest ([12.2-detect-cargo] pins that there is no fifth), so cmake
        // maps to ctest and python maps to pytest. cargo's node fallback is the documented
        // conservative bin ([12.2-detect-cargo]).
        const PROFILE_FOR_ECOSYSTEM: Record<string, string> = {
          node: "node",
          go: "go",
          cmake: "ctest",
          python: "pytest",
        };
        if (scope.ecosystem !== "cargo") {
          const expected = PROFILE_FOR_ECOSYSTEM[scope.ecosystem];
          assert.ok(
            expected !== undefined,
            `no committed runner profile is mapped for ecosystem ${JSON.stringify(scope.ecosystem)}`,
          );
          assert.equal(
            profile.runner,
            expected,
            `${scope.ecosystem}: detectRunner(${JSON.stringify(scope.command)}) must be the ${expected} profile`,
          );
        }

        const itemTest = scope.itemTest;
        if (itemTest !== undefined) {
          const substituted = substituteItemTest(itemTest, testScope);
          assert.ok(substituted.length > 0);
          for (const token of substituted) {
            assert.equal(
              token.includes("{"),
              false,
              `substituteItemTest left an unsubstituted token in ${JSON.stringify(substituted)}`,
            );
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (2) [12.2-detect-go-dirs]
// ---------------------------------------------------------------------------

test("[12.2-detect-go-dirs] the go proposal targets package DIRS and never carries -run (the §2.1:503-506 correction)", async () => {
  const root = goFixture("godirs");
  await withStub({}, async (stub) => {
    const result = await setup(harness(root, stub).input);
    const scope = scopeOf(result, "go");
    const template = scope.itemTest;
    assert.ok(template !== undefined, "the go leg must carry the {dirs} template");
    assert.deepEqual(template, GO_ITEM_TEST);

    // The correction itself, through the COMMITTED substituter: three test files in two
    // packages become two ./dir targets, deduplicated, first-seen order, ./-prefixed.
    assert.deepEqual(
      substituteItemTest(template, ["pkg/a/x_test.go", "pkg/a/y_test.go", "pkg/b/z_test.go"]),
      ["go", "test", "./pkg/a", "./pkg/b"],
    );

    // `-run` matches test FUNCTION names: handed file basenames it exits 0 having run zero
    // tests. No go argv the matrix proposes may contain it, anywhere.
    for (const proposed of result.proposals.scopes) {
      if (proposed.ecosystem !== "go") continue;
      assert.equal(proposed.command.includes("-run"), false, "no -run in the go scope command");
      assert.equal(
        (proposed.itemTest ?? []).includes("-run"),
        false,
        "no -run in the go itemTest template",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// (3) [12.2-detect-node-scripts-test]
// ---------------------------------------------------------------------------

test("[12.2-detect-node-scripts-test] the node leg reads package.json scripts.test through the committed shellTokens, and the node template attaches only to a RECOGNIZED node command", async () => {
  const bare = nodeFixture("scripts-bare", PKG_NO_SCRIPTS);
  const nodeScript = nodeFixture("scripts-node", PKG_NODE_TEST);
  const jest = nodeFixture("scripts-jest", PKG_JEST);
  const ctestScript = nodeFixture("scripts-ctest", PKG_CTEST_SCRIPT);

  await withStub({}, async (stub) => {
    const bareResult = await setup(harness(bare, stub).input);
    const bareScope = scopeOf(bareResult, "node");
    assert.deepEqual(bareScope.command, ["node", "--test"]);
    assert.deepEqual(bareScope.itemTest, NODE_ITEM_TEST);

    const nodeResult = await setup(harness(nodeScript, stub).input);
    const nodeScope = scopeOf(nodeResult, "node");
    assert.deepEqual(nodeScope.command, shellTokens("node --test"));
    assert.deepEqual(nodeScope.command, ["node", "--test"]);
    assert.deepEqual(nodeScope.itemTest, NODE_ITEM_TEST);

    // `"test": "jest"` — the real command, and NO itemTest. jest is not installed here, so
    // this call also fails its smoke spawn; the proposals are STILL returned so the user can
    // see and correct what setup found.
    const jestResult = await setup(harness(jest, stub).input);
    const jestScope = scopeOf(jestResult, "node");
    assert.deepEqual(jestScope.command, ["jest"]);
    assert.equal(
      Object.hasOwn(jestScope, "itemTest"),
      false,
      "a jest repo must not be handed `node --test {files}` (P7)",
    );

    // A spawnable non-node script proves the same rule without the smoke failure riding along.
    const ctestResult = await setup(harness(ctestScript, stub).input);
    const ctestScope = scopeOf(ctestResult, "node");
    assert.deepEqual(ctestScope.command, shellTokens("ctest -R fx"));
    assert.deepEqual(ctestScope.command, ["ctest", "-R", "fx"]);
    assert.equal(
      Object.hasOwn(ctestScope, "itemTest"),
      false,
      "a package.json whose test script is not node gets no node template",
    );

    // The checkable direction of P7, over every fixture in this test: a node template implies
    // a RECOGNIZED node command. (The converse is false — evidence.ts:137 bins every unknown
    // command as the node profile, so detectRunner(["jest"]) is the node profile too.)
    for (const result of [bareResult, nodeResult, jestResult, ctestResult]) {
      for (const scope of result.proposals.scopes) {
        if (JSON.stringify(scope.itemTest) !== JSON.stringify(NODE_ITEM_TEST)) continue;
        const argv0 = path.basename(scope.command[0]).toLowerCase();
        assert.ok(
          argv0.startsWith("node") || scope.command.includes("--test"),
          `the node template was paired with a non-node command: ${JSON.stringify(scope.command)}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (4) [12.2-detect-multi-ecosystem]
// ---------------------------------------------------------------------------

test("[12.2-detect-multi-ecosystem] a two-ecosystem repo yields two distinctly-named scopes and one requiredScopes entry each; a single-ecosystem repo yields the ** entry; never an empty array", async () => {
  const multi = multiFixture("multi");
  const single = cmakeFixture("single");

  await withStub({}, async (stub) => {
    const multiResult = await setup(harness(multi, stub).input);
    const names = multiResult.proposals.scopes.map((scope) => scope.name).sort();
    assert.deepEqual(names, ["cmake", "node"], "both ecosystems survive; neither overwrites the other");
    assert.equal(new Set(names).size, names.length, "scope names are distinct");

    const required = multiResult.proposals.requiredScopes;
    assert.equal(required.length, 2, "one requiredScopes entry per detected scope");
    for (const scope of multiResult.proposals.scopes) {
      const entry = required.find((row) => row.scopes.length === 1 && row.scopes[0] === scope.name);
      assert.ok(entry !== undefined, `no requiredScopes entry for scope ${scope.name}`);
      assert.equal(
        entry.pattern,
        scope.sourceGlob,
        `a multi-ecosystem requiredScopes pattern is that ecosystem's source glob`,
      );
    }

    // Each ecosystem's source glob names ITS OWN sources, so the entries do not collide and
    // no ordinary source path falls outside every one of them. An item that no requiredScopes
    // entry covers has no constructible test command at all — adapter/tools.ts itemVerifyScope
    // raises a named legality failure for it — so an uncovered path is a repo setup wrote a
    // config for and then made unverifiable.
    const patterns = required.map((row) => row.pattern);
    assert.equal(new Set(patterns).size, patterns.length, `requiredScopes patterns collide: ${patterns.join(", ")}`);
    const coverage: Record<string, string[]> = {
      "src/a.js": ["node"],
      "lib/util.js": ["node"],
      "test/util.test.js": ["node"],
      "src/main.cpp": ["cmake"],
      "include/x.hpp": ["cmake"],
    };
    for (const [filePath, expected] of Object.entries(coverage)) {
      const covering = required
        .filter((row) => globMatch(row.pattern, filePath))
        .flatMap((row) => row.scopes)
        .sort();
      assert.deepEqual(covering, expected, `requiredScopes coverage for ${filePath}`);
    }

    const singleResult = await setup(harness(single, stub).input);
    assert.equal(singleResult.proposals.scopes.length, 1);
    assert.deepEqual(singleResult.proposals.requiredScopes, [{ pattern: "**", scopes: ["cmake"] }]);

    // A cleanly-validating config with an EMPTY requiredScopes leaves every path unverified.
    for (const result of [multiResult, singleResult]) {
      assert.ok(result.proposals.requiredScopes.length > 0, "requiredScopes is never proposed empty");
      for (const row of result.proposals.requiredScopes) {
        assert.ok(row.scopes.length > 0, `requiredScopes entry ${row.pattern} has no scopes`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (5) [12.2-detect-behavioral-paths]
// ---------------------------------------------------------------------------

test("[12.2-detect-behavioral-paths] each ecosystem carries its §2.1:523-526 behavioralPaths PROPOSAL on the confirmation ask, nothing is written without an explicit answer, and the go ask names the _test.go caveat", async () => {
  const nodeRoot = nodeFixture("bp-node", PKG_NO_SCRIPTS);
  const pyRoot = pythonFixture("bp-python");
  const goRoot = goFixture("bp-go");
  const cmakeRoot = cmakeFixture("bp-cmake");
  const cargoRoot = cargoFixture("bp-cargo");

  await withStub({}, async (stub) => {
    const expected: Array<[string, string, string[]]> = [
      [nodeRoot, "node", ["src/**", "lib/**"]],
      [pyRoot, "python", ["slugger/**"]],
      [goRoot, "go", ["**/*.go"]],
      [cmakeRoot, "cmake", ["src/**", "include/**"]],
      [cargoRoot, "cargo", ["src/**"]],
    ];

    for (const [root, ecosystem, paths] of expected) {
      const result = await setup(harness(root, stub).input);
      assert.deepEqual(
        scopeOf(result, ecosystem).behavioralPaths,
        paths,
        `${ecosystem} behavioralPaths proposal`,
      );
      assert.deepEqual(result.proposals.behavioralPaths, paths, `${ecosystem} merged proposal`);

      // The proposal rides the ask, and no answer means no file.
      const ask = askOf(result, ASK_BEHAVIORAL_PATHS);
      assert.deepEqual(ask.proposal, paths, `${ecosystem} ask carries the proposal`);
      assert.equal(result.written, false);
      assert.equal(existsSync(configPathOf(root)), false, `${ecosystem}: nothing written without an answer`);
    }

    // §2.1:525 asks for "**/*.go minus **/*_test.go", which core/shell-parse globMatch cannot
    // express and Config.verify.behavioralPaths (positive globs) cannot hold. The proposal is
    // the positive glob and the ASK names the caveat so the user can narrow it.
    const goResult = await setup(harness(goRoot, stub).input);
    const goAsk = askOf(goResult, ASK_BEHAVIORAL_PATHS);
    assert.ok(
      goAsk.question.includes("_test.go"),
      `the go behavioralPaths ask must name the _test.go caveat: ${goAsk.question}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (6) [12.2-detect-cargo]
// ---------------------------------------------------------------------------

test("[12.2-detect-cargo] Cargo.toml is detected, proposes cargo test with no itemTest and src/**, writes a schema-valid config, and adds NO fifth RUNNER_PROFILE", async () => {
  const root = cargoFixture("cargo-detect");

  await withStub({}, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));
    assert.equal(result.written, true);

    const scope = scopeOf(result, "cargo");
    assert.deepEqual(scope.command, ["cargo", "test"]);
    assert.equal(Object.hasOwn(scope, "itemTest"), false);
    assert.deepEqual(scope.behavioralPaths, ["src/**"]);

    const written = JSON.parse(readConfigRaw(root)) as Config;
    assert.equal(validate("Config", written).ok, true, JSON.stringify(validate("Config", written).errors));
    assert.deepEqual(written.verify.scopes.cargo.command, ["cargo", "test"]);
    assert.equal(Object.hasOwn(written.verify.scopes.cargo, "itemTest"), false);

    // No fifth profile: adding one is a §2.6.1 classification change and is not taken here.
    assert.deepEqual(Object.keys(RUNNER_PROFILES).sort(), ["ctest", "go", "node", "pytest"]);
    assert.equal(
      detectRunner(["cargo", "test"]),
      RUNNER_PROFILES.node,
      "cargo falls through to evidence.ts:137's conservative node bin — the deliberate safe bin",
    );
  });
});

// ---------------------------------------------------------------------------
// (7) [12.2-no-build-command]
// ---------------------------------------------------------------------------

test("[12.2-no-build-command] no proposed or written scope ever carries buildCommand, and a config that did would fail its own registered schema", async () => {
  const root = multiFixture("nobuild");

  await withStub({}, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));

    const written = JSON.parse(readConfigRaw(root)) as Config;
    const legalKeySets = [
      JSON.stringify(["command", "timeoutMs"]),
      JSON.stringify(["command", "itemTest", "timeoutMs"]),
    ];
    const scopeNames = Object.keys(written.verify.scopes);
    assert.ok(scopeNames.length >= 2, "the multi fixture writes both scopes");
    for (const name of scopeNames) {
      const keys = Object.keys(written.verify.scopes[name]).sort();
      assert.ok(
        legalKeySets.includes(JSON.stringify(keys)),
        `scope ${name} key set ${JSON.stringify(keys)} is outside {command,timeoutMs[,itemTest]}`,
      );
      assert.equal(Object.hasOwn(written.verify.scopes[name], "buildCommand"), false);
    }
    assert.equal(validate("Config", written).ok, true);

    // The trap, asserted directly: §2.1:483-485 describes buildCommand and
    // adapter/evidence.ts:338-342 implements it, but core/types.ts:530-540 omits it under
    // additionalProperties:false — so emitting it would write a config that fails its own gate.
    const spliced = JSON.parse(JSON.stringify(written)) as Config;
    const first = Object.keys(spliced.verify.scopes)[0];
    (spliced.verify.scopes[first] as Record<string, unknown>).buildCommand = ["make", "-j2"];
    const splicedResult = validate("Config", spliced);
    assert.equal(splicedResult.ok, false, "SCHEMAS.Config must reject a scope carrying buildCommand");
    assert.ok(
      splicedResult.errors.some((error) => error.includes("buildCommand")),
      `the validator error must name buildCommand: ${splicedResult.errors.join("; ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (8) [12.2-smoke-spawn-unspawnable-fails]
// ---------------------------------------------------------------------------

test("[12.2-smoke-spawn-unspawnable-fails] an unspawnable argv[0] is a setup FAILURE naming the argv and a remedy, writes nothing, and the check covers scope commands, itemTest templates and (on reconfigure) format-rule commands", async () => {
  const jestRoot = nodeFixture("smoke-jest", PKG_JEST);
  const okRoot = nodeFixture("smoke-ok", PKG_NODE_TEST);

  // jest is genuinely absent here; measure that rather than assume it.
  const jestProbe = spawnSync("jest", ["--version"], { stdio: "ignore" });
  assert.ok(jestProbe.error !== undefined, "this row needs `jest` to be genuinely unspawnable here");

  await withStub({}, async (stub) => {
    const failed = await setup({
      ...harness(jestRoot, stub).input,
      answers: answers(),
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.written, false);
    const text = failureText(failed);
    assert.ok(text.includes("jest"), `the failure must name the argv: ${text}`);
    assert.ok(
      /remedy|install|PATH|correct/i.test(text),
      `§2.1:634 — a failure with a NAMED REMEDY, not a warning: ${text}`,
    );
    assert.equal(existsSync(configPathOf(jestRoot)), false);
    assert.ok(
      failed.proposals.smoked.some((probe) => probe.argv0 === "jest" && probe.ok === false),
      `the smoke log must record the failed probe: ${JSON.stringify(failed.proposals.smoked)}`,
    );

    // Coverage: every command the config would record is probed, each under its own source.
    const good = await setup({
      ...harness(okRoot, stub).input,
      answers: answers(),
    });
    assert.equal(good.ok, true, failureText(good));
    const sources = good.proposals.smoked.map((probe) => probe.source);
    assert.ok(
      sources.includes("verify.scopes.node.command"),
      `the scope command must be smoke-spawned: ${JSON.stringify(sources)}`,
    );
    assert.ok(
      sources.includes("verify.scopes.node.itemTest"),
      `the itemTest template must be smoke-spawned too: ${JSON.stringify(sources)}`,
    );
    for (const probe of good.proposals.smoked) assert.equal(probe.ok, true);

    // The format-rule half: a RECONFIGURE of a config that already carries rules must smoke
    // them. Setup itself proposes format.rules [] and detects no formatter.
    const config = JSON.parse(readConfigRaw(okRoot)) as Config;
    assert.deepEqual(config.format.rules, [], "detection proposes no formatter");
    config.format.rules = [
      { pattern: "**/*.js", mode: "check", command: ["definitely-not-a-formatter-9931", "{file}"] },
    ];
    writeFileSync(configPathOf(okRoot), JSON.stringify(config, null, 2));
    const before = readConfigRaw(okRoot);

    const reconfigured = await setup({
      ...harness(okRoot, stub).input,
      reconfigure: true,
      answers: answers(),
    });
    assert.equal(reconfigured.ok, false);
    assert.equal(reconfigured.written, false);
    assert.ok(
      failureText(reconfigured).includes("definitely-not-a-formatter-9931"),
      `the format-rule command must be named: ${failureText(reconfigured)}`,
    );
    assert.ok(
      reconfigured.proposals.smoked.some((probe) => probe.source.startsWith("format.rules")),
      `the format rules must appear in the smoke log: ${JSON.stringify(reconfigured.proposals.smoked)}`,
    );
    assert.equal(readConfigRaw(okRoot), before, "a failed reconfigure leaves the config byte-identical");
  });
});

// ---------------------------------------------------------------------------
// (9) [12.2-smoke-spawn-semantics]
// ---------------------------------------------------------------------------

test("[12.2-smoke-spawn-semantics] the smoke verdict is spawnability alone: a non-zero exit passes, shell metacharacters are ONE executable name, the child runs under evidence.childEnv, and a hanging probe is killed by a bounded timeout", async () => {
  // (a) M5: `go --version` exits non-zero on this toolchain while spawning perfectly.
  const goProbe = spawnSync("go", ["--version"], { stdio: "ignore" });
  assert.equal(goProbe.error, undefined, "go must be spawnable for this leg to mean anything");
  assert.notEqual(goProbe.status, 0, "M5: `go --version` exits non-zero here");

  const goRoot = goFixture("semantics-go");

  // (b) a single-quoted script value tokenizes to ONE token, so argv[0] IS the whole string.
  const breachRoot = newDir("semantics-breach");
  const breachMarker = path.join(breachRoot, "SHELL-BREACH-8823");
  writeFixtureFiles(breachRoot, {
    "package.json": JSON.stringify(
      { name: "fx-breach", version: "1.0.0", scripts: { test: `'echo hi; touch ${breachMarker}'` } },
      null,
      2,
    ),
    "src/index.js": "export const x = 1;\n",
  });
  git(breachRoot, "init", "-q", "-b", "main");
  git(breachRoot, "add", "-A");
  git(breachRoot, "commit", "-q", "-m", "fixture");

  // (c) an executable that records its own environment and exits non-zero.
  const envRoot = newDir("semantics-env");
  writeFixtureFiles(envRoot, {
    "package.json": JSON.stringify(
      { name: "fx-env", version: "1.0.0", scripts: { test: "./probe.sh" } },
      null,
      2,
    ),
    "probe.sh": '#!/bin/sh\nenv > "$(pwd)/probe-env.txt"\nexit 3\n',
    "src/index.js": "export const x = 1;\n",
  });
  chmodSync(path.join(envRoot, "probe.sh"), 0o755);
  git(envRoot, "init", "-q", "-b", "main");
  git(envRoot, "add", "-A");
  git(envRoot, "commit", "-q", "-m", "fixture");

  // (d) an executable that never returns.
  const hangRoot = newDir("semantics-hang");
  writeFixtureFiles(hangRoot, {
    "package.json": JSON.stringify(
      { name: "fx-hang", version: "1.0.0", scripts: { test: "./hang.sh" } },
      null,
      2,
    ),
    // 90s: long enough that only a REAL bound can beat the 45s assertion below, short enough
    // that an unbounded (blocking spawnSync) implementation FAILS loudly instead of wedging
    // the suite — the probe runs synchronously, so a node:test timeout could not interrupt it.
    "hang.sh": "#!/bin/sh\nsleep 90\n",
    "src/index.js": "export const x = 1;\n",
  });
  chmodSync(path.join(hangRoot, "hang.sh"), 0o755);
  git(hangRoot, "init", "-q", "-b", "main");
  git(hangRoot, "add", "-A");
  git(hangRoot, "commit", "-q", "-m", "fixture");

  await withStub({}, async (stub) => {
    // (a) spawnable-but-unhappy PASSES.
    const goResult = await setup({
      ...harness(goRoot, stub).input,
      answers: answers(),
    });
    assert.equal(goResult.ok, true, `a non-zero probe exit is not a setup failure: ${failureText(goResult)}`);
    assert.equal(goResult.written, true);

    // (b) shell:false — the metacharacter string is one executable name, never interpreted.
    const breachResult = await setup({
      ...harness(breachRoot, stub).input,
      answers: answers(),
    });
    assert.equal(breachResult.ok, false, "an uninterpretable command name cannot be spawned");
    assert.equal(existsSync(breachMarker), false, "shell:false — the `touch` must never have run");
    assert.ok(
      failureText(breachResult).includes("echo hi;"),
      `the whole string is the argv[0] that failed: ${failureText(breachResult)}`,
    );

    // (c) evidence.childEnv hygiene reaches the probe child.
    const savedGitDir = process.env.GIT_DIR;
    const savedTestContext = process.env.NODE_TEST_CONTEXT;
    process.env.GIT_DIR = path.join(envRoot, "NOT-A-REAL-GITDIR");
    process.env.NODE_TEST_CONTEXT = "child-v8-serializer";
    let envResult: SetupResult;
    try {
      envResult = await setup({
        ...harness(envRoot, stub).input,
        answers: answers(),
      });
    } finally {
      if (savedGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = savedGitDir;
      if (savedTestContext === undefined) delete process.env.NODE_TEST_CONTEXT;
      else process.env.NODE_TEST_CONTEXT = savedTestContext;
    }
    assert.equal(envResult.ok, true, failureText(envResult));
    const childEnvText = readFileSync(path.join(envRoot, "probe-env.txt"), "utf8");
    const childEnvLines = childEnvText.split("\n");
    assert.equal(
      childEnvLines.some((line) => line.startsWith("GIT_DIR=")),
      false,
      "childEnv strips GIT_DIR",
    );
    assert.equal(
      childEnvLines.some((line) => line.startsWith("NODE_TEST_CONTEXT=")),
      false,
      "childEnv strips NODE_TEST_CONTEXT",
    );
    assert.ok(
      childEnvLines.includes("GIT_OPTIONAL_LOCKS=0"),
      `childEnv sets GIT_OPTIONAL_LOCKS=0: ${childEnvText}`,
    );

    // (d) a hanging probe cannot wedge setup.
    const started = Date.now();
    const hangResult = await setup({
      ...harness(hangRoot, stub).input,
      answers: answers(),
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 45_000, `the probe timeout must bound setup; it took ${elapsed}ms against a 90s sleep`);
    assert.ok(
      hangResult.proposals.smoked.some((probe) => probe.argv0.includes("hang.sh")),
      "the hanging probe is recorded in the smoke log",
    );
  });
});

// ---------------------------------------------------------------------------
// (10) [12.2-proof-models-default]
// ---------------------------------------------------------------------------

test("[12.2-proof-models-default] §2.1:629 — a models.default absent from the stubbed /v1/models fails setup naming the model and the ids the server did list", async () => {
  const missingRoot = nodeFixture("models-missing", PKG_NODE_TEST);
  const presentRoot = nodeFixture("models-present", PKG_NODE_TEST);

  await withStub({ models: ["alpha-1", "beta-2"] }, async (stub) => {
    const failed = await setup({
      ...harness(missingRoot, stub).input,
      answers: answers(),
      modelId: "gamma-3",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.written, false);
    const text = failureText(failed);
    assert.ok(text.includes("gamma-3"), `the missing model must be named: ${text}`);
    assert.ok(text.includes("alpha-1") && text.includes("beta-2"), `the served ids must be named: ${text}`);
    assert.equal(existsSync(configPathOf(missingRoot)), false);

    // The proof was actually MADE — it cannot pass (or fail) vacuously.
    const modelsRequests = stub.requests.filter((request) => request.url.startsWith("/v1/models"));
    assert.ok(modelsRequests.length >= 1, "setup must GET /v1/models");
    assert.equal(modelsRequests[0].method, "GET");
  });

  await withStub({ models: ["alpha-1", "beta-2"] }, async (stub) => {
    const passed = await setup({
      ...harness(presentRoot, stub).input,
      answers: answers(),
      modelId: "beta-2",
    });
    assert.equal(passed.ok, true, failureText(passed));
    assert.equal(passed.written, true);
    const written = JSON.parse(readConfigRaw(presentRoot)) as Config;
    assert.equal(written.models.default, "beta-2");
  });
});

// ---------------------------------------------------------------------------
// (11) [12.2-models-default-derived]
// ---------------------------------------------------------------------------

test("[12.2-models-default-derived] models.default is derived from the served list or the caller, never guessed; several served ids with no caller id is a named failure", async () => {
  const soloRoot = nodeFixture("models-solo", PKG_NODE_TEST);
  const callerRoot = nodeFixture("models-caller", PKG_NODE_TEST);
  const ambiguousRoot = nodeFixture("models-ambiguous", PKG_NODE_TEST);

  // (a) exactly one served id -> adopted; roles {} (G13).
  await withStub({ models: ["only-served-7712"] }, async (stub) => {
    const result = await setup({
      ...harness(soloRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));
    const written = JSON.parse(readConfigRaw(soloRoot)) as Config;
    assert.equal(written.models.default, "only-served-7712");
    assert.deepEqual(written.models.roles, {});
    assert.notEqual(written.models.default, "qwen3.6-27b", "§2.1:602's example is this repo's weight, not a default");
  });

  // (b) the caller supplies the id and it is checked against the list.
  await withStub({ models: ["one-9001", "two-9002"] }, async (stub) => {
    const result = await setup({
      ...harness(callerRoot, stub).input,
      answers: answers(),
      modelId: "two-9002",
    });
    assert.equal(result.ok, true, failureText(result));
    const written = JSON.parse(readConfigRaw(callerRoot)) as Config;
    assert.equal(written.models.default, "two-9002");
  });

  // (c) several served, none supplied -> a named ambiguity, and nothing written.
  await withStub({ models: ["one-9001", "two-9002"] }, async (stub) => {
    const result = await setup({
      ...harness(ambiguousRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.written, false);
    const text = failureText(result);
    assert.ok(text.includes("one-9001") && text.includes("two-9002"), `both candidates named: ${text}`);
    assert.ok(text.includes("models.default"), `the remedy names the field: ${text}`);
    assert.ok(text.includes(".conductor/config.json"), `the remedy names the file: ${text}`);
    assert.equal(existsSync(configPathOf(ambiguousRoot)), false);
  });
});

// ---------------------------------------------------------------------------
// (12) [12.2-proof-schema-probe]
// ---------------------------------------------------------------------------

test("[12.2-proof-schema-probe] §2.1:630 — ONE direct schema-constrained POST; a reply that does not validate FAILS, and an EMPTY reply is a FAILING probe (C-058 F1)", async () => {
  // P4: one schema object, both ends of the probe.
  assert.deepEqual(
    SCHEMAS[SETUP_PROBE_SCHEMA_NAME],
    PROBE_SCHEMA,
    "the probe schema is registered in SCHEMAS so core validate() can resolve it",
  );
  assert.equal(validate(SETUP_PROBE_SCHEMA_NAME, { ok: true }).ok, true);
  assert.equal(validate(SETUP_PROBE_SCHEMA_NAME, { nope: 1 }).ok, false);

  const goodRoot = nodeFixture("probe-good", PKG_NODE_TEST);
  const badRoot = nodeFixture("probe-bad", PKG_NODE_TEST);
  const emptyRoot = nodeFixture("probe-empty", PKG_NODE_TEST);

  // (a) a conforming reply passes, and the REQUEST shape is asserted off the recording stub.
  await withStub({ chatContent: PROBE_CONFORMING }, async (stub) => {
    const result = await setup({
      ...harness(goodRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));

    // The SCHEMA probe is the one carrying response_format; §2.1:631's slot readers are the
    // other completions on this path and are counted by their own row.
    const posts = stub.requests.filter(
      (request) => request.url.includes("chat/completions") && "response_format" in request.body,
    );
    assert.equal(posts.length, 1, "§2.1:630 is ONE tiny request, not a batch");
    assert.equal(posts[0].method, "POST");
    assert.equal(
      posts[0].body.stream,
      false,
      "wire-notes.md:35 records that the provider STREAMs; the probe must not",
    );
    const format = posts[0].body.response_format as Record<string, unknown> | undefined;
    assert.ok(format !== undefined, "the probe must carry response_format");
    assert.equal(format.type, "json_schema");
    const jsonSchema = format.json_schema as Record<string, unknown>;
    assert.deepEqual(
      jsonSchema.schema,
      PROBE_SCHEMA,
      "the constraint sent is the same object the reply is validated against",
    );
  });

  // (b) an unconstrained (non-conforming) reply fails setup naming the check.
  await withStub({ chatContent: PROBE_NONCONFORMING }, async (stub) => {
    const result = await setup({
      ...harness(badRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.written, false);
    assert.ok(
      /schema/i.test(failureText(result)),
      `the failure must name the schema check: ${failureText(result)}`,
    );
    assert.equal(existsSync(configPathOf(badRoot)), false);
  });

  // (c) M3 / C-058 F1-CONFIRMED: an EMPTY body with a 200 status is a FAILING probe. A check
  // that accepted "" would pass against a model that can never emit structured output at all.
  await withStub({ chatContent: "" }, async (stub) => {
    const result = await setup({
      ...harness(emptyRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, false, "an empty completion is not a passing schema probe");
    assert.equal(result.written, false);
    assert.equal(existsSync(configPathOf(emptyRoot)), false);
  });
});

// ---------------------------------------------------------------------------
// (13) [12.2-proof-slot-count]
// ---------------------------------------------------------------------------

test("[12.2-proof-slot-count] §2.1:631 — an observed slot count below parallel.maxReaders fails setup naming both numbers and the --parallel remedy (measured 4-vs-6, M1/M2)", async () => {
  const shortRoot = nodeFixture("slots-short", PKG_NODE_TEST);
  const okRoot = nodeFixture("slots-ok", PKG_NODE_TEST);

  // §2.1's default maxReaders is 6, and 5.4a's default carries it.
  assert.equal(DEFAULT_CONFIG.parallel.maxReaders, 6, "§2.1:583 maxReaders default");

  // (a) M1: a server started with NO --parallel reports 4 slots. That is short of 6.
  await withStub({ totalSlots: 4 }, async (stub) => {
    const result = await setup({
      ...harness(shortRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.written, false);
    const text = failureText(result);
    assert.ok(text.includes("4"), `the observed slot count must be named: ${text}`);
    assert.ok(text.includes("6"), `the configured maxReaders must be named: ${text}`);
    assert.ok(text.includes("--parallel"), `the §2.1:631 remedy must name --parallel: ${text}`);
    // M2 / C-058 F3: `--parallel N` beside an unchanged --ctx-size divides every slot's window
    // by N. A remedy naming --parallel alone walks the user into a 6x context cut.
    assert.ok(text.includes("--ctx-size"), `the remedy must name --ctx-size too (C-058 F3): ${text}`);
    assert.equal(existsSync(configPathOf(shortRoot)), false);

    const propsRequests = stub.requests.filter((request) => request.url.startsWith("/props"));
    assert.ok(propsRequests.length >= 1, "the slot count is read from the server, not timed");
    assert.equal(propsRequests[0].method, "GET");
  });

  // (b) M1: `--parallel 6` reports 6 slots, which satisfies maxReaders 6.
  await withStub({ totalSlots: 6 }, async (stub) => {
    const result = await setup({
      ...harness(okRoot, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));
    assert.equal(result.written, true);
  });
});

test("[12.2-proof-slot-count] §2.1:631 — the slot proof ISSUES parallel.maxReaders concurrent completions on /v1/chat/completions, and the server sees them all open at once", async () => {
  const root = nodeFixture("slots-concurrent", PKG_NODE_TEST);
  const readers = DEFAULT_CONFIG.parallel.maxReaders;

  // The barrier releases only once `readers` slot probes are open SIMULTANEOUSLY, so the peak
  // below is measured by the server, never by a clock on the client. A setup that sends one
  // completion (the schema probe) and reads a slot count out of GET /props never reaches it.
  await withStub({ totalSlots: readers, slotBarrier: readers }, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));

    const slotProbes = stub.requests.filter(
      (request) =>
        request.method === "POST" &&
        request.url.includes("chat/completions") &&
        !("response_format" in request.body),
    );
    assert.equal(
      slotProbes.length,
      readers,
      `the slot proof issues parallel.maxReaders trivial completions, got ${String(slotProbes.length)}`,
    );
    assert.equal(
      stub.peakConcurrentSlotProbes(),
      readers,
      "all of them are open on the server AT ONCE — the overlap is the proof",
    );
    // Every slot probe travels the ONE path a router proxies (router.hpp:104-108).
    for (const probe of slotProbes) {
      assert.ok(probe.url.startsWith("/v1/"), `a slot probe must be proxyable: ${probe.url}`);
    }
  });
});

test("[12.2-proof-slot-count] §2.1:631 — an origin that cannot hold parallel.maxReaders readers open fails setup naming the observed count and the --parallel remedy", async () => {
  const root = nodeFixture("slots-serializing", PKG_NODE_TEST);
  const readers = DEFAULT_CONFIG.parallel.maxReaders;

  // A server that refuses the overflow readers rather than holding them: only `readers - 2`
  // completions are ever served, the rest come back 503. Nothing here is timed.
  await withStub({ totalSlots: readers, serveAtMostSlotProbes: readers - 2 }, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.written, false);
    const text = failureText(result);
    assert.ok(text.includes(String(readers - 2)), `the observed count must be named: ${text}`);
    assert.ok(text.includes(String(readers)), `the configured maxReaders must be named: ${text}`);
    assert.ok(text.includes("--parallel"), `the remedy must name --parallel: ${text}`);
    assert.ok(text.includes("--ctx-size"), `the remedy must name --ctx-size too (C-058 F3): ${text}`);
    assert.equal(existsSync(configPathOf(root)), false);
  });
});

test("[12.2-proofs-origin-fail-soft] a HEALTHY router that proxies only /v1/* is not a setup failure: the slot count is read from the upstream directly", async () => {
  const root = nodeFixture("props-not-proxied", PKG_NODE_TEST);

  // router.hpp:104-108 proxies /v1/.* and 404s everything else, so GET /props at the router
  // origin is a routing fact about the proxy — never a fact about the served model.
  await withStub({ totalSlots: 6 }, async (upstream) => {
    await withStub({ proxyOnlyV1: true, totalSlots: 6 }, async (router) => {
      const bench = harness(root, upstream, { routerPort: router.port });
      const result = await setup({ ...bench.input, answers: answers() });

      assert.equal(result.ok, true, `a healthy router must not fail setup: ${failureText(result)}`);
      assert.equal(result.written, true);

      // The proofs ran through the ROUTER, so the failover never latched.
      assert.equal(bench.failover.useUpstream, false, "a healthy router is never failed over");
      const routerProbes = router.requests.filter((request) => request.url.startsWith("/v1/"));
      assert.ok(routerProbes.length >= 2, "the /v1 proofs travel through the router");

      // ...and the slot count came from the upstream, which is the process that publishes it.
      const upstreamProps = upstream.requests.filter((request) => request.url.startsWith("/props"));
      assert.ok(upstreamProps.length >= 1, "the slot count is read from llama-server directly");
      assert.equal(upstreamProps[0].method, "GET");
    });
  });
});

// ---------------------------------------------------------------------------
// (14) [12.2-zero-model-dispatch]
// ---------------------------------------------------------------------------

test("[12.2-zero-model-dispatch] a full successful setup makes exactly the three direct proof requests and dispatches ZERO model sub-sessions", async () => {
  const root = nodeFixture("zero-dispatch", PKG_NODE_TEST);
  // The fake SDK is the only route to a sub-session; handleSetup is handed none, so a dispatch
  // is impossible by construction. The load-bearing half is the request log below: a proof that
  // travelled through a model session could be ANSWERED by the model instead of by the server,
  // which is the one thing these proofs exist to prevent.
  const registry = new Map<string, { role: string; itemId?: string; tree?: string }>();
  const sdk = makeFakeSdk({ registry });

  await withStub({}, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, failureText(result));

    const shape = [
      ...new Set(stub.requests.map((request) => `${request.method} ${request.url.split("?")[0]}`)),
    ].sort();
    assert.deepEqual(shape, ["GET /props", "GET /v1/models", "POST /v1/chat/completions"]);
    assert.equal(sdk.calls.length, 0, "setup creates no session and prompts no model");
  });
});

// ---------------------------------------------------------------------------
// (15) [12.2-proofs-origin-fail-soft]
// ---------------------------------------------------------------------------

test("[12.2-proofs-origin-fail-soft] G5 — a router that refuses connections latches the failover and the proofs complete against the upstream; setup SUCCEEDS", async () => {
  const root = nodeFixture("failsoft", PKG_NODE_TEST);
  const deadPort = await closedPort();

  await withStub({}, async (stub) => {
    const bench = harness(root, stub, { routerPort: deadPort });
    const result = await setup({ ...bench.input, answers: answers() });

    assert.equal(result.ok, true, `a down router is never itself a setup failure: ${failureText(result)}`);
    assert.equal(result.written, true);

    assert.ok(bench.failover.failovers >= 1, "the failed request records a failover");
    assert.equal(bench.failover.useUpstream, true, "the session latches onto the upstream");
    assert.equal(bench.failover.metricsPartial, true, "§4.4 — the run's metrics are partial");

    const failoverRecords = bench.records.filter(
      (record) => record.component === "router-client" && record.event === "failover",
    );
    assert.ok(failoverRecords.length >= 1, "noteRouterFailure journals `failover`");
    assert.equal(failoverRecords[0].level, "warn");

    // Every proof still ran, against the UPSTREAM stub.
    const shape = [
      ...new Set(stub.requests.map((request) => `${request.method} ${request.url.split("?")[0]}`)),
    ].sort();
    assert.deepEqual(shape, ["GET /props", "GET /v1/models", "POST /v1/chat/completions"]);
  });
});

// ---------------------------------------------------------------------------
// (16) [12.2-proof-before-write]
// ---------------------------------------------------------------------------

test("[12.2-proof-before-write] the proofs run against the candidate in MEMORY: every failure leg leaves the repo with no config.json and loadConfig reporting unconfigured", async () => {
  const unspawnable = nodeFixture("before-unspawnable", PKG_JEST);
  const missingModel = nodeFixture("before-model", PKG_NODE_TEST);
  const badSchema = nodeFixture("before-schema", PKG_NODE_TEST);
  const shortSlots = nodeFixture("before-slots", PKG_NODE_TEST);

  const legs: Array<[string, StubOptions, Partial<SetupInput>]> = [
    ["unspawnable command", {}, {}],
    ["missing models.default", { models: ["served-a", "served-b"] }, { modelId: "not-served-1234" }],
    ["unconstrained schema reply", { chatContent: PROBE_NONCONFORMING }, {}],
    ["short slot count", { totalSlots: 4 }, {}],
  ];
  const roots = [unspawnable, missingModel, badSchema, shortSlots];

  for (let i = 0; i < legs.length; i += 1) {
    const [label, stubOptions, extra] = legs[i];
    const root = roots[i];
    await withStub(stubOptions, async (stub) => {
      const result = await setup({
        ...harness(root, stub).input,
        answers: answers(),
        ...extra,
      });
      assert.equal(result.ok, false, `${label}: must fail`);
      assert.equal(result.written, false, `${label}: must write nothing`);
      assert.equal(result.config, null, `${label}: no config is returned`);
      assert.equal(existsSync(configPathOf(root)), false, `${label}: no config.json on disk`);
      assert.equal(
        loadConfig(root).repoConfigured,
        false,
        `${label}: the repo stays unconfigured, so no gate opens on an unproven config`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// (17) [12.2-two-asks-no-default]
// ---------------------------------------------------------------------------

test("[12.2-two-asks-no-default] §2.1:622 + §6.2:1875 — a first call in a git repo returns BOTH undefaultable asks, writes nothing, and creates no §2.11 question record", async () => {
  const root = nodeFixture("two-asks", PKG_NODE_TEST);

  await withStub({}, async (stub) => {
    const result = await setup(harness(root, stub).input);

    const gitAsk = askOf(result, ASK_GIT_MODE);
    const configSchema = SCHEMAS.Config as Record<string, unknown>;
    const properties = configSchema.properties as Record<string, Record<string, unknown>>;
    const gitProperties = properties.git.properties as Record<string, Record<string, unknown>>;
    const gitModes = gitProperties.mode.enum as string[];
    assert.deepEqual(
      [...gitAsk.options].sort(),
      [...gitModes].sort(),
      "the git.mode ask offers exactly the §2.1 GIT_MODES",
    );
    assert.ok(gitAsk.question.length > 0);

    const pathsAsk = askOf(result, ASK_BEHAVIORAL_PATHS);
    assert.ok(pathsAsk.proposal !== null && pathsAsk.proposal.length > 0, "the confirmation ask carries a proposal");

    assert.equal(result.written, false);
    assert.equal(existsSync(configPathOf(root)), false);

    // P10: the asks are the RESULT, not §2.11 questions. adapter/questions.ts needs a run dir
    // setup has not got, and the origin vocabulary has no setup member.
    const stateFiles = walk(path.join(root, ".conductor"), root, []);
    assert.equal(
      stateFiles.some((file) => file.endsWith("questions.jsonl")),
      false,
      `no question ledger may be written: ${JSON.stringify(stateFiles)}`,
    );
    const questionSchema = SCHEMAS.QuestionRecord as Record<string, unknown>;
    const questionProperties = questionSchema.properties as Record<string, Record<string, unknown>>;
    const origins = questionProperties.origin.enum as string[];
    assert.equal(
      origins.some((origin) => origin.includes("setup")),
      false,
      `QUESTION_ORIGINS must not be widened for setup: ${JSON.stringify(origins)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// (18) [12.2-partial-answers-write-nothing]
// ---------------------------------------------------------------------------

test("[12.2-partial-answers-write-nothing] one of the two answers is not enough, and no written config ever carries a §2.1 EXAMPLE value that was not explicitly answered", async () => {
  const gitOnly = nodeFixture("partial-git", PKG_NODE_TEST);
  const pathsOnly = nodeFixture("partial-paths", PKG_NODE_TEST);
  const bothRoot = nodeFixture("partial-both", PKG_NODE_TEST);

  await withStub({}, async (stub) => {
    const gitResult = await setup({
      ...harness(gitOnly, stub).input,
      answers: { gitMode: "commit" },
    });
    assert.equal(gitResult.written, false);
    assert.equal(existsSync(configPathOf(gitOnly)), false);
    assert.equal(hasAsk(gitResult, ASK_BEHAVIORAL_PATHS), true, "the unanswered ask is re-returned");
    assert.equal(hasAsk(gitResult, ASK_GIT_MODE), false, "the answered one is not re-asked");

    const pathsResult = await setup({
      ...harness(pathsOnly, stub).input,
      answers: { behavioralPaths: ["lib/**"] },
    });
    assert.equal(pathsResult.written, false);
    assert.equal(existsSync(configPathOf(pathsOnly)), false);
    assert.equal(hasAsk(pathsResult, ASK_GIT_MODE), true);
    assert.equal(hasAsk(pathsResult, ASK_BEHAVIORAL_PATHS), false);

    // The negative half: the node proposal is ["src/**","lib/**"] and §2.1:582's example
    // git.mode is "commit". Answer neither, and the written file must carry the ANSWERS.
    const bothResult = await setup({
      ...harness(bothRoot, stub).input,
      answers: { gitMode: "commit-and-push", behavioralPaths: ["app-src/**"] },
    });
    assert.equal(bothResult.ok, true, failureText(bothResult));
    const written = JSON.parse(readConfigRaw(bothRoot)) as Config;
    assert.equal(written.git.mode, "commit-and-push");
    assert.notEqual(written.git.mode, "commit", "§2.1:582's example is never defaulted in");
    assert.deepEqual(written.verify.behavioralPaths, ["app-src/**"]);
    assert.notDeepEqual(
      written.verify.behavioralPaths,
      ["src/**"],
      "§2.1:527's example is never defaulted in",
    );
  });
});

// ---------------------------------------------------------------------------
// (19) [12.2-nogit-offer]
// ---------------------------------------------------------------------------

test("[12.2-nogit-offer] §3.9:1500-1502 — a non-repo workspace gets exactly ONE choice, and `initialize` runs git init from the HANDLER and continues down the git path in the same call", async () => {
  assert.equal(typeof initRepo, "function", "the §3.9 init branch is a new gitio write");

  const offerRoot = fixture("nogit-offer", { "package.json": PKG_NODE_TEST }, { repo: false });
  const initRoot = fixture("nogit-init", { "package.json": PKG_NODE_TEST }, { repo: false });
  const fullRoot = fixture("nogit-full", { "package.json": PKG_NODE_TEST }, { repo: false });

  assert.equal(isRepo(offerRoot), false, "the §3.9 fixture must genuinely not be a repo");

  await withStub({}, async (stub) => {
    // (a) exactly one choice, and NOT the git.mode question (no-git forces it).
    const offer = await setup(harness(offerRoot, stub).input);
    assert.equal(offer.isRepo, false);
    assert.equal(offer.asks.length, 1, `exactly one interactive choice: ${JSON.stringify(offer.asks)}`);
    assert.equal(offer.asks[0].id, ASK_GIT_INIT);
    assert.equal(offer.asks[0].options.length, 2, "initialize a repo here | run in no-git mode");
    assert.equal(hasAsk(offer, ASK_GIT_MODE), false);
    assert.equal(offer.written, false);
    assert.equal(existsSync(configPathOf(offerRoot)), false);

    // (b) choosing `initialize` performs git init from the handler, then the SAME call
    //     continues down the ordinary git-repo path — which means asking git.mode.
    const bench = harness(initRoot, stub);
    const registry = new Map<string, { role: string; itemId?: string; tree?: string }>();
    const sdk = makeFakeSdk({ registry });
    const initialized = await setup({
      ...bench.input,
      answers: { initRepo: true, behavioralPaths: ["src/**"] },
    });
    assert.equal(isRepo(initRoot), true, "git init ran");
    assert.equal(existsSync(path.join(initRoot, ".git")), true);
    assert.equal(initialized.isRepo, true, "the handler re-derives isRepo and continues");
    assert.equal(hasAsk(initialized, ASK_GIT_MODE), true, "the ordinary git-repo path asks git.mode");
    assert.equal(initialized.written, false, "still one answer short");
    assert.equal(sdk.calls.length, 0, "git init is never delegated to a model session");

    // (c) with git.mode answered too, the initialized repo writes.
    const done = await setup({
      ...harness(fullRoot, stub).input,
      answers: { initRepo: true, gitMode: "commit", behavioralPaths: ["src/**"] },
    });
    assert.equal(isRepo(fullRoot), true);
    assert.equal(done.ok, true, failureText(done));
    assert.equal(done.written, true);
    const written = JSON.parse(readConfigRaw(fullRoot)) as Config;
    assert.equal(written.git.mode, "commit");
  });
});

// ---------------------------------------------------------------------------
// (20) [12.2-nogit-config]
// ---------------------------------------------------------------------------

test("[12.2-nogit-config] no-git mode writes git.mode read-only + parallel.writes off, skips the exclude registration, and invents NO configuration field for itself", async () => {
  const root = fixture("nogit-config", { "package.json": PKG_NODE_TEST, "src/i.js": "\n" }, { repo: false });

  await withStub({}, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: { initRepo: false, behavioralPaths: ["src/**"] },
    });
    assert.equal(result.ok, true, failureText(result));
    assert.equal(result.written, true);
    assert.equal(isRepo(root), false, "no-git mode does not create a repo");
    assert.equal(existsSync(path.join(root, ".git")), false, "no .git, so nothing to register into");

    const written = JSON.parse(readConfigRaw(root)) as Config;
    assert.equal(written.git.mode, "read-only");
    assert.equal(written.parallel.writes, "off");
    assert.equal(validate("Config", written).ok, true, validate("Config", written).errors.join("; "));

    // The load-bearing half: Config has no noGit field, no publish switch and no worktree
    // switch, and configSchema's additionalProperties:false would reject an invented one.
    // No-git stays a RUNTIME gitio.isRepo derivation — the same one 9.5b's publish refusal
    // keys on — so it means one thing in both tasks.
    const schema = SCHEMAS.Config as Record<string, unknown>;
    const schemaKeys = Object.keys(schema.properties as Record<string, unknown>).sort();
    assert.deepEqual(Object.keys(written).sort(), schemaKeys, "the written key set IS the schema's");
    const raw = readConfigRaw(root);
    for (const forbidden of ["noGit", "no_git", "publish", "worktree"]) {
      assert.equal(
        raw.includes(forbidden),
        false,
        `the written config must invent no "${forbidden}" field`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// (21) [12.2-exclude-registration]
// ---------------------------------------------------------------------------

test("[12.2-exclude-registration] a completed setup registers .conductor/ once through the COMMITTED registerConductorExclude, preserves an existing line, never duplicates, and registers nothing when a proof failed", async () => {
  const root = nodeFixture("exclude-ok", PKG_NODE_TEST);
  const failRoot = nodeFixture("exclude-fail", PKG_NODE_TEST);

  const excludePathOf = (repo: string): string => {
    const commonDir = gitCommonDir(repo);
    assert.ok(commonDir !== null, "the fixture must be a repo with a resolvable common dir");
    return path.join(commonDir, "info", "exclude");
  };

  const preexisting = "# fixture-preexisting-line-6620\n*.log\n";
  const excludePath = excludePathOf(root);
  mkdirSync(path.dirname(excludePath), { recursive: true });
  writeFileSync(excludePath, preexisting);

  await withStub({}, async (stub) => {
    const first = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(first.ok, true, failureText(first));

    const afterFirst = readFileSync(excludePath, "utf8");
    const count = (text: string): number =>
      text.split(/\r?\n/).filter((line) => line.trim() === ".conductor/").length;
    assert.equal(count(afterFirst), 1, `exactly one .conductor/ line: ${JSON.stringify(afterFirst)}`);
    assert.ok(afterFirst.includes("*.log"), "a pre-existing unrelated line is preserved");
    assert.ok(afterFirst.includes("# fixture-preexisting-line-6620"));

    const second = await setup({
      ...harness(root, stub).input,
      reconfigure: true,
      answers: answers(),
    });
    assert.equal(second.ok, true, failureText(second));
    assert.equal(count(readFileSync(excludePath, "utf8")), 1, "a reconfigure adds no duplicate");
  });

  // A setup that FAILS a proof registers nothing.
  await withStub({ totalSlots: 4 }, async (stub) => {
    const failed = await setup({
      ...harness(failRoot, stub).input,
      answers: answers(),
    });
    assert.equal(failed.ok, false);
    const failExclude = excludePathOf(failRoot);
    const content = existsSync(failExclude) ? readFileSync(failExclude, "utf8") : "";
    assert.equal(
      content.split(/\r?\n/).some((line) => line.trim() === ".conductor/"),
      false,
      "a failed setup registers nothing",
    );
  });
});

// ---------------------------------------------------------------------------
// (22) [12.2-config-written-atomic-valid]
// ---------------------------------------------------------------------------

test("[12.2-config-written-atomic-valid] the written file validates against SCHEMAS.Config and is the confirmed answers merged over 5.4a's DEFAULT_CONFIG, with the §2.1 numbers intact", async () => {
  const root = multiFixture("written");

  await withStub({}, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers({ gitMode: "commit" }),
    });
    assert.equal(result.ok, true, failureText(result));
    assert.equal(result.written, true);

    const raw = readConfigRaw(root);
    const written = JSON.parse(raw) as Config;
    assert.deepEqual(result.config, written, "the returned config IS the persisted one");
    const validation = validate("Config", written);
    assert.equal(validation.ok, true, validation.errors.join("; "));

    // The atomic writer leaves no temp behind (adapter/state.ts:136 writes a same-dir
    // pid-suffixed temp and renames; a crash or a throw removes it).
    const residue = readdirSync(path.join(root, ".conductor")).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(residue, [], "writeFileAtomicSync leaves no .tmp residue");
    assert.equal(
      readdirSync(path.join(root, ".conductor")).filter((name) => name === "config.json").length,
      1,
    );

    // The answered halves.
    assert.equal(written.version, 1);
    assert.equal(written.git.mode, "commit");
    assert.equal(written.git.branchPolicy, "pin");
    assert.equal(written.git.preexistingDirty, "refuse");
    assert.deepEqual(written.verify.behavioralPaths, ANSWERED_PATHS);
    assert.deepEqual(Object.keys(written.verify.scopes).sort(), ["cmake", "node"]);
    assert.equal(written.verify.requiredScopes.length, 2);
    assert.deepEqual(written.format.rules, []);

    // The un-asked halves come from the SINGLE exported default — not a second literal typed
    // here or in the setup module (the 12.1 DEFAULT_MAX_READERS hazard, applied to Config).
    assert.deepEqual(written.workflow, DEFAULT_CONFIG.workflow);
    assert.deepEqual(written.parallel, DEFAULT_CONFIG.parallel);
    assert.equal(written.ponytail, DEFAULT_CONFIG.ponytail);
    assert.deepEqual(written.retention, DEFAULT_CONFIG.retention);
    assert.deepEqual(written.logging, DEFAULT_CONFIG.logging);

    // …and that default must still BE §2.1's, field by field, so a drifted default is loud.
    assert.equal(written.workflow.trivialMaxFiles, 2);
    assert.equal(written.workflow.planReviewers, 4);
    assert.equal(written.workflow.planReviewMaxRounds, 3);
    assert.equal(written.workflow.itemReviewers, 6);
    assert.equal(written.workflow.skepticsPerFinding, 2);
    assert.equal(written.workflow.reviewMaxRounds, 3);
    assert.equal(written.workflow.vetCritics, 3);
    assert.equal(written.workflow.vetMaxRounds, 3);
    assert.equal(written.workflow.testRepairAttempts, 3);
    assert.equal(written.workflow.debugFixCap, 3);
    assert.equal(written.workflow.maxOverridesPerItem, 1);
    assert.equal(written.workflow.maxOverridesPerRun, 2);
    assert.equal(written.parallel.writes, "off");
    assert.equal(written.parallel.maxImplementers, 2);
    assert.equal(written.parallel.maxReaders, 6);
    assert.equal(written.parallel.subSessionTimeoutMs, 900000);
    assert.equal(written.ponytail, "full");
    assert.equal(written.retention.keepRuns, 20);
    assert.equal(written.retention.maxRunDirBytes, 268435456);
    assert.equal(written.retention.pruneOnRunCreate, true);
    assert.equal(written.logging.level, "info");
    assert.deepEqual(written.logging.components, {});
    assert.deepEqual(written.models.roles, {});
    for (const name of Object.keys(written.verify.scopes)) {
      assert.equal(written.verify.scopes[name].timeoutMs, 600000, `§2.1:483 timeoutMs for ${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// (23) [12.2-repo-configured-one-derivation]
// ---------------------------------------------------------------------------

test("[12.2-repo-configured-one-derivation] ONE reader feeds both the gate and the handler: absent, unparseable and schema-invalid all read as UNCONFIGURED, so a corrupt config reopens setup", async () => {
  const absent = nodeFixture("derive-absent", PKG_NODE_TEST);
  const valid = nodeFixture("derive-valid", PKG_NODE_TEST);
  const torn = nodeFixture("derive-torn", PKG_NODE_TEST);
  const invalid = nodeFixture("derive-invalid", PKG_NODE_TEST);

  await withStub({}, async (stub) => {
    // (a) absent — the ordinary first-run case.
    assert.equal(loadConfig(absent).repoConfigured, false);
    const absentResult = await setup(harness(absent, stub).input);
    assert.equal(absentResult.repoConfigured, false, "the handler agrees with the reader");
    assert.ok(absentResult.asks.length > 0, "setup RUNS rather than refusing");

    // (b) a real, written, valid config reads as configured.
    const validResult = await setup({
      ...harness(valid, stub).input,
      answers: answers(),
    });
    assert.equal(validResult.ok, true, failureText(validResult));
    assert.equal(loadConfig(valid).repoConfigured, true);

    // (c) unparseable, and (d) parses but fails validate("Config") — both must reopen setup.
    const goodRaw = readConfigRaw(valid);
    mkdirSync(path.dirname(configPathOf(torn)), { recursive: true });
    writeFileSync(configPathOf(torn), goodRaw.slice(0, Math.floor(goodRaw.length / 2)));
    mkdirSync(path.dirname(configPathOf(invalid)), { recursive: true });
    writeFileSync(configPathOf(invalid), JSON.stringify({ version: 1, verify: { scopes: {} } }, null, 2));

    for (const [label, root] of [["unparseable", torn], ["schema-invalid", invalid]] as const) {
      // 5.4a's reader is required to be LOUD about a corrupt file (5.4a-config-malformed-is-loud)
      // and THROWS, which is safe because 5.4a opens the workspace LAZILY: the throw is caught at
      // that open, written to the §7.1 stderr sink, and tool.execute.before still DENIES
      // (5.4a-construction-failure-denies-loudly) — it can never ungate a session at plugin
      // construction. The leg stays tolerant of either disposition because the ONE thing neither
      // may do is report the repo as CONFIGURED: that would open every gate on an unvalidated
      // object. handleSetup must therefore absorb the throw and treat it as unconfigured.
      let reported: boolean;
      try {
        reported = loadConfig(root).repoConfigured;
      } catch {
        reported = false;
      }
      assert.equal(reported, false, `${label}: must not read as configured`);

      const result = await setup(harness(root, stub).input);
      assert.equal(result.repoConfigured, false, `${label}: the handler agrees`);
      assert.ok(result.asks.length > 0, `${label}: a corrupt config REOPENS setup`);
    }
  });
});

// ---------------------------------------------------------------------------
// (24) [12.2-setup-legality]
// ---------------------------------------------------------------------------

test("[12.2-setup-legality] setup runs while .conductor/config.json is absent and REFUSES on a configured repo without reconfigure:true, naming the legal alternative", async () => {
  const root = nodeFixture("legality", PKG_NODE_TEST);

  // The committed gate, CONSUMED and not duplicated: gates-phase.ts:246-253 already legalizes
  // exactly conductor_setup + conductor_status and recommends setup when repoConfigured is false.
  const gateRun: GateRun = { state: "INTAKE", stop: null, classification: null };
  const verdict = legalTools(gateRun, [], [], false);
  assert.deepEqual([...verdict.legal.keys()].sort(), ["conductor_setup", "conductor_status"]);
  assert.ok(verdict.recommended !== null, "the unconfigured branch recommends a tool");
  assert.equal(verdict.recommended.tool, "conductor_setup");
  assert.ok(verdict.why.length > 0);

  await withStub({}, async (stub) => {
    const first = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(first.ok, true, failureText(first));
    assert.equal(first.written, true);

    const before = readConfigRaw(root);
    await assert.rejects(
      async () => {
        await setup({ ...harness(root, stub).input, answers: answers() });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(message.includes("reconfigure"), `the refusal names the legal alternative: ${message}`);
        return true;
      },
      "an already-configured repo refuses setup without reconfigure:true",
    );
    assert.equal(readConfigRaw(root), before, "the refusal writes nothing");
  });
});

// ---------------------------------------------------------------------------
// (25) [12.2-reconfigure-live-run-denies]
// ---------------------------------------------------------------------------

test("[12.2-reconfigure-live-run-denies] reconfigure is denied while core/stops isTerminal reports a live run, and proceeds once the run is terminal or the pointer is gone", async () => {
  const root = nodeFixture("reconfigure-live", PKG_NODE_TEST);

  await withStub({}, async (stub) => {
    const first = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(first.ok, true, failureText(first));
    const config = JSON.parse(readConfigRaw(root)) as Config;

    const records: LoggedRecord[] = [];
    const store: StateStore = openWorkspace({
      root,
      config,
      journal: {
        log: (level, component, event, data, corr) => {
          records.push({ level, component, event, data, corr });
        },
      },
      version: "12.2-test",
      sessionID: "ses_setup_live",
    });
    const run = store.createRun({
      prompt: "a live run",
      sessionID: "ses_setup_live",
      classification: { kind: "work", rationale: "fixture", check: { agreed: true, note: "fixture" } },
    });
    assert.equal(isTerminal(run), false, "the fixture run must genuinely be live");
    store.release();

    const before = readConfigRaw(root);
    await assert.rejects(
      async () => {
        await setup({
          ...harness(root, stub).input,
          reconfigure: true,
          answers: answers({ gitMode: "commit" }),
        });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(message.includes(run.runId), `the denial names the live run: ${message}`);
        return true;
      },
      "reconfigure requires no live run",
    );
    assert.equal(readConfigRaw(root), before, "the denied reconfigure leaves the config byte-identical");

    // A terminal run (a recorded stop) lets it through — the ONE isTerminal definition.
    const reopened: StateStore = openWorkspace({
      root,
      config,
      journal: { log: () => {} },
      version: "12.2-test",
      sessionID: "ses_setup_live2",
    });
    const stopped = reopened.loadRun(run.runId);
    stopped.stop = { kind: "done", reasonDisplay: "fixture stop", tsMs: 1 };
    assert.equal(isTerminal(stopped), true);
    reopened.saveRun(stopped);
    reopened.release();

    const allowed = await setup({
      ...harness(root, stub).input,
      reconfigure: true,
      answers: answers({ gitMode: "commit" }),
    });
    assert.equal(allowed.ok, true, failureText(allowed));
    assert.equal(allowed.written, true);
    assert.equal((JSON.parse(readConfigRaw(root)) as Config).git.mode, "commit");

    // No current-run pointer at all is likewise not a live run.
    rmSync(path.join(root, ".conductor", "state", "current-run.json"), { force: true });
    const pointerless = await setup({
      ...harness(root, stub).input,
      reconfigure: true,
      answers: answers({ gitMode: "read-only" }),
    });
    assert.equal(pointerless.ok, true, failureText(pointerless));
    assert.equal((JSON.parse(readConfigRaw(root)) as Config).git.mode, "read-only");
  });
});

// ---------------------------------------------------------------------------
// (26) [12.2-reconfigure-diff-journaled]
// ---------------------------------------------------------------------------

test("[12.2-reconfigure-diff-journaled] a completed reconfigure journals ONLY the changed keys with old and new values, on a name inside the closed §7.4 vocabulary, through the REAL throwing journal", async () => {
  const root = nodeFixture("reconfigure-diff", PKG_NODE_TEST);

  await withStub({}, async (stub) => {
    const first = await setup({
      ...harness(root, stub).input,
      answers: answers({ gitMode: "read-only" }),
    });
    assert.equal(first.ok, true, failureText(first));

    // (a) a reconfigure that changes exactly one key.
    const bench = harness(root, stub);
    const changed = await setup({
      ...bench.input,
      reconfigure: true,
      answers: answers({ gitMode: "commit" }),
    });
    assert.equal(changed.ok, true, failureText(changed));
    assert.equal(changed.written, true);

    const diffRecords = bench.records.filter((record) => record.event === "config.updated");
    assert.equal(diffRecords.length, 1, `exactly one diff record: ${JSON.stringify(bench.records)}`);
    const record = diffRecords[0];
    assert.equal(record.component, "state");
    assert.equal(record.corr.runId, undefined, "setup has no run, so the sink is runId-OPTIONAL");

    const changes = record.data.changes as ConfigChange[];
    assert.ok(Array.isArray(changes));
    assert.deepEqual(changes, [{ key: "git.mode", from: "read-only", to: "commit" }]);
    assert.deepEqual(changed.diff, changes, "the result carries the same diff it journaled");

    // The name must be inside the closed §7.4 vocabulary — the `decision.recorded` precedent
    // (C-029 F7): a name added to core/journal-events.ts EVENTS.state, with the grep test.
    assert.equal(
      isKnownEvent("state", "config.updated"),
      true,
      "core/journal-events.ts EVENTS.state must carry `config.updated`",
    );

    // …and driven through the REAL journal, which THROWS on an unlisted name outside
    // production (adapter/journal.ts:229-235), so an unwidened vocabulary fails here rather
    // than passing silently against a recording double.
    const runDir = newDir("diff-journal");
    const config = JSON.parse(readConfigRaw(root)) as Config;
    const realJournal = createJournal(runDir, config, {});
    for (const captured of bench.records) {
      realJournal.log(
        captured.level as LogLevel,
        captured.component,
        captured.event,
        captured.data,
        { runId: "r-20260814-diff", ...captured.corr },
      );
    }
    const journalText = readFileSync(path.join(runDir, "journal.jsonl"), "utf8");
    assert.ok(
      journalText.includes('"config.updated"'),
      "the diff record reaches the real JSONL journal",
    );

    // (b) a reconfigure that changes NOTHING still journals the fact.
    const bench2 = harness(root, stub);
    const unchanged = await setup({
      ...bench2.input,
      reconfigure: true,
      answers: answers({ gitMode: "commit" }),
    });
    assert.equal(unchanged.ok, true, failureText(unchanged));
    const emptyDiffs = bench2.records.filter((entry) => entry.event === "config.updated");
    assert.equal(emptyDiffs.length, 1);
    assert.deepEqual(emptyDiffs[0].data.changes, [], "an empty change set is recorded, not omitted");
    assert.deepEqual(unchanged.diff, []);
  });
});

// ---------------------------------------------------------------------------
// (27) [12.2-c003-pytest-measured]
// ---------------------------------------------------------------------------

test("[12.2-c003-pytest-measured] C-003 — the §2.1:499 pytest default is tried FIRST and genuinely fails here, and the recorded fallback genuinely spawns", async () => {
  // M4, re-measured so a machine change is loud rather than silent.
  const bare = spawnSync("pytest", ["--version"], { stdio: "ignore" });
  assert.ok(
    bare.error !== undefined,
    "C-003: bare `pytest` must be unspawnable on this machine for this row to be measured",
  );
  const viaPython = spawnSync("/usr/bin/python3", ["-m", "pytest", "--version"], { stdio: "ignore" });
  assert.equal(viaPython.error, undefined, "the C-003 fallback interpreter must be spawnable");
  assert.equal(viaPython.status, 0, "`python3 -m pytest --version` succeeds here (pytest 8.4.2)");

  const root = pythonFixture("c003");

  await withStub({}, async (stub) => {
    const result = await setup({
      ...harness(root, stub).input,
      answers: answers(),
    });
    assert.equal(result.ok, true, `the fallback keeps setup alive here: ${failureText(result)}`);
    assert.equal(result.written, true);

    // The §2.1:499 default was tried first, and its probe genuinely failed.
    const bareProbe = result.proposals.smoked.find((probe) => path.basename(probe.argv0) === "pytest");
    assert.ok(bareProbe !== undefined, `the bare pytest default must be probed first: ${JSON.stringify(result.proposals.smoked)}`);
    assert.equal(bareProbe.ok, false, "…and it must genuinely fail on this machine");

    const scope = scopeOf(result, "python");
    const command = scope.command;
    const itemTest = scope.itemTest;
    assert.ok(itemTest !== undefined);
    assert.ok(
      path.basename(command[0]).startsWith("python"),
      `the fallback scope command runs pytest through python3: ${JSON.stringify(command)}`,
    );
    assert.deepEqual(command.slice(1), ["-m", "pytest"]);
    assert.deepEqual(itemTest.slice(1), ["-m", "pytest", "{files}"]);
    assert.equal(itemTest[0], command[0], "one interpreter for both");

    // The swap costs nothing downstream: evidence.detectRunner:130-132 already recognises the
    // `python… pytest` argv shape.
    assert.equal(detectRunner(command), RUNNER_PROFILES.pytest);
    assert.equal(detectRunner(itemTest), RUNNER_PROFILES.pytest);

    // The proposal SAYS which form it chose and why — a fallback, not a silent rewrite.
    const notes = result.proposals.notes.join(" | ");
    assert.ok(notes.includes("pytest"), `the notes must name the pytest choice: ${notes}`);
    assert.ok(
      notes.includes(command[0]) || notes.includes("-m pytest"),
      `the notes must name the form chosen: ${notes}`,
    );

    const fallbackProbe = result.proposals.smoked.find(
      (probe) => path.basename(probe.argv0).startsWith("python"),
    );
    assert.ok(fallbackProbe !== undefined, "the fallback interpreter is smoke-spawned too");
    assert.equal(fallbackProbe.ok, true);

    const written = JSON.parse(readConfigRaw(root)) as Config;
    assert.deepEqual(written.verify.scopes.python.command, command);
    assert.deepEqual(written.verify.scopes.python.itemTest, itemTest);
  });
});

// ---------------------------------------------------------------------------
// (28) [12.2-no-new-runtime-dependency]
// ---------------------------------------------------------------------------

test("[12.2-no-new-runtime-dependency] G1/G14 — the setup path imports only node: built-ins and conductor's own modules, and names no runtime-exclusive global", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const adapterDir = path.resolve(here, "..", "adapter");
  const touched = ["tools.ts", "state.ts", "gitio.ts", "config-io.ts"];

  // Statement-anchored, so a quoted phrase in prose ("… derived from \"no repo at all\" …")
  // can never be mistaken for a module specifier. These four forms are every static import
  // shape the codebase uses, including the `} from "…"` tail of a multi-line import.
  const STATEMENT_FORMS: RegExp[] = [
    /^import\s+["']([^"']+)["'];?\s*(?:\/\/.*)?$/,
    /^import\s.*\sfrom\s+["']([^"']+)["'];?\s*(?:\/\/.*)?$/,
    /^export\s.*\sfrom\s+["']([^"']+)["'];?\s*(?:\/\/.*)?$/,
    /^\}\s*from\s+["']([^"']+)["'];?\s*(?:\/\/.*)?$/,
  ];
  const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']/;

  const isComment = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
  };

  for (const file of touched) {
    const full = path.join(adapterDir, file);
    assert.equal(existsSync(full), true, `the setup path's module ${file} must exist`);
    const lines = readFileSync(full, "utf8").split("\n");

    let seen = 0;
    for (const line of lines) {
      if (isComment(line)) continue;
      const trimmed = line.trim();
      const specifiers: string[] = [];
      for (const form of STATEMENT_FORMS) {
        const match = form.exec(trimmed);
        if (match !== null) specifiers.push(match[1]);
      }
      const dynamic = DYNAMIC_IMPORT.exec(trimmed);
      if (dynamic !== null) specifiers.push(dynamic[1]);

      for (const specifier of specifiers) {
        seen += 1;
        assert.ok(
          specifier.startsWith("node:") || specifier.startsWith("./") || specifier.startsWith("../"),
          `${file}: bare specifier "${specifier}" — G1 forbids a runtime dependency`,
        );
      }

      // No runtime-exclusive global in CODE (the module headers legitimately discuss both
      // runtimes in prose, which is why comment lines are skipped above).
      assert.equal(/\bBun\s*\./.test(trimmed), false, `${file}: Bun-only global in "${trimmed}"`);
      assert.equal(/\bDeno\s*\./.test(trimmed), false, `${file}: Deno-only global in "${trimmed}"`);
    }

    assert.ok(seen > 0, `${file}: the scan must actually find imports (it would pass vacuously otherwise)`);
  }
});
