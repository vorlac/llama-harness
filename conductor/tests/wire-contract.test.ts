// WIRE_CONTRACT_VERIFIED: 2026-08-12 against /opt/homebrew/bin/opencode 1.18.15
// (plan §5 was written against 1.18.10; drift is recorded in
// conductor/adapter/wire-notes.md and encoded here — Task 0.2).
//
// Integration test for the opencode wire contract (plan lines 1999-2041).
// It starts `opencode serve` headless against a throwaway fixture directory
// whose config loads conductor/tests/fixtures/recorder-plugin.ts by absolute
// file path, stands up a fake OpenAI-compatible server in place of
// llama-server, and asserts every row of docs/build/specs/task-0.2.assertions.json
// against OBSERVED binary behaviour — never against the hoped-for §5 text.
//
// Skip policy (0.2-noskip): the suite is skip-tagged ONLY when no opencode
// binary exists; the unconditional guard test at the bottom asserts the skip
// flag is exactly coupled to binary absence and that the suite really ran on
// a machine that has the binary. On this machine a skip is a failure
// (scripts/test-conductor.sh rejects skipped > 0).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, before, describe, it, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  startStubLlmServer,
  WEBFETCH_PAGE_BODY,
  type StubHandle,
  type StubRequest,
} from "./fixtures/stub-llm-server.ts";
import {
  BANNER_PART_MARKER,
  BANNER_PART_TRIGGER_TITLE,
  BANNER_RESULT_MARKER,
  BANNER_TOAST_MARKER,
  BANNER_TOAST_TRIGGER_TITLE,
  CRASH_MARKER,
  DENY_MARKER,
  PARAMS_FALLBACK_FIELD,
  PARAMS_FALLBACK_VALUE,
  PLUGIN_SPAWN_TRIGGER_TITLE,
  PROBE_HEADER_NAME,
  PROBE_HEADER_VALUE,
  SYSTEM_MARKER,
} from "./fixtures/wire-markers.ts";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const RECORDER_PLUGIN_PATH = resolve(TESTS_DIR, "fixtures", "recorder-plugin.ts");
const CRASHING_PLUGIN_PATH = resolve(TESTS_DIR, "fixtures", "crashing-plugin.ts");
const FILEREF_MARKER = "CONDUCTOR_FILEREF_MARKER_88Q";
const LLAMA_SERVER_RESERVED_PORT = 8080;

function findOpencodeBinary(): string | null {
  const candidates = ["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"];
  for (const entry of (process.env["PATH"] ?? "").split(delimiter)) {
    if (entry !== "") candidates.push(join(entry, "opencode"));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const OPENCODE_BINARY = findOpencodeBinary();
const SKIP: string | false =
  OPENCODE_BINARY === null ? "opencode binary not installed (checked /opt/homebrew/bin, /usr/local/bin, PATH)" : false;

// ---------------------------------------------------------------------------
// Shared wire-shape helpers
// ---------------------------------------------------------------------------

interface SessionInfo {
  id: string;
  parentID?: string;
  title?: string;
}

interface ToolPartState {
  status?: string;
  error?: unknown;
  output?: unknown;
  input?: Record<string, unknown>;
}

interface Part {
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: ToolPartState;
}

interface MessageEntry {
  info: { id: string; role: string };
  parts: Part[];
}

interface PromptResponse {
  info: { finish?: string; modelID?: string; providerID?: string; sessionID?: string };
  parts: Part[];
}

interface RecorderRecord {
  kind: string;
  at: number;
  data: Record<string, unknown>;
}

function eventType(r: RecorderRecord): string | undefined {
  const t = r.data["type"];
  return r.kind === "event" && typeof t === "string" ? t : undefined;
}

function eventProps(r: RecorderRecord): Record<string, unknown> {
  const p = r.data["properties"];
  return p !== null && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

function parseRecorderLine(line: string): RecorderRecord | null {
  try {
    return JSON.parse(line) as RecorderRecord;
  } catch {
    // A torn tail line can exist while the plugin is mid-append; the pollers
    // simply read again on the next tick.
    return null;
  }
}

async function pollUntil<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 30_000,
  intervalMs = 150,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(intervalMs);
  }
}

async function httpJson(
  method: string,
  url: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const json: unknown = text === "" ? null : JSON.parse(text);
  return { status: res.status, json };
}

async function pickFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      const srv = createNetServer();
      srv.on("error", rejectPort);
      srv.listen(0, "127.0.0.1", () => {
        const address = srv.address();
        if (address === null || typeof address === "string") {
          srv.close(() => rejectPort(new Error("net server reported no TCP address")));
          return;
        }
        const assigned = address.port;
        srv.close(() => resolvePort(assigned));
      });
    });
    if (port !== LLAMA_SERVER_RESERVED_PORT) return port;
  }
  throw new Error(`could not pick a free port that is not ${LLAMA_SERVER_RESERVED_PORT}`);
}

function serveEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Drop inherited OPENCODE_* so the spawned server is fully hermetic.
    if (value !== undefined && !key.startsWith("OPENCODE_")) env[key] = value;
  }
  return { ...env, OPENCODE_DISABLE_AUTOUPDATE: "1", ...overrides };
}

interface ServeHandle {
  proc: ChildProcess;
  url: string;
  log: () => string;
  kill: () => Promise<void>;
}

async function startOpencodeServe(options: {
  binary: string;
  port: number;
  cwd: string;
  env: Record<string, string>;
}): Promise<ServeHandle> {
  const proc = spawn(
    options.binary,
    ["serve", "--port", String(options.port), "--print-logs", "--log-level", "INFO"],
    { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let buf = "";
  proc.stdout?.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
  });
  proc.stderr?.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
  });
  const exited = new Promise<void>((resolveExit) => {
    proc.on("exit", () => resolveExit());
  });

  const kill = async (): Promise<void> => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      const forceTimer = setTimeout(() => proc.kill("SIGKILL"), 3_000);
      await exited;
      clearTimeout(forceTimer);
    }
  };

  try {
    const url = await pollUntil<string>(
      () => {
        if (proc.exitCode !== null) {
          throw new Error(`opencode serve exited early (code ${proc.exitCode}); log:\n${buf.slice(-2_000)}`);
        }
        const m = buf.match(/listening on (http:\/\/[0-9.]+:[0-9]+)/);
        return m?.[1];
      },
      "opencode serve to print its listen address",
      30_000,
      100,
    );
    // Readiness = the config endpoint answering, never a fixed sleep.
    const deadline = Date.now() + 30_000;
    let lastReadinessError = "";
    for (;;) {
      try {
        const res = await httpJson("GET", `${url}/config`, undefined, 5_000);
        if (res.status === 200) break;
        lastReadinessError = `status ${res.status}`;
      } catch (err) {
        // Connection refused while the listener finishes booting.
        lastReadinessError = String(err);
      }
      if (Date.now() > deadline) {
        throw new Error(`opencode serve /config never became ready: ${lastReadinessError}`);
      }
      await sleep(150);
    }
    return { proc, url, log: () => buf, kill };
  } catch (err) {
    proc.kill("SIGKILL");
    await exited;
    throw err;
  }
}

function writeOpencodeConfig(options: {
  configPath: string;
  pluginPath: string;
  stubBaseUrl: string;
  filerefPromptPath?: string;
}): void {
  const models = {
    "stub-model": {
      id: "stub-model",
      name: "Stub Model A",
      tool_call: true,
      temperature: true,
      limit: { context: 32_768, output: 4_096 },
      cost: { input: 0, output: 0 },
    },
    "stub-model-b": {
      id: "stub-model-b",
      name: "Stub Model B",
      tool_call: true,
      temperature: true,
      limit: { context: 32_768, output: 4_096 },
      cost: { input: 0, output: 0 },
    },
  };
  const agent: Record<string, unknown> = {
    "wire-primary": {
      mode: "primary",
      description: "wire probe primary",
      permission: { edit: "allow", bash: "allow" },
    },
    asker: {
      mode: "primary",
      description: "asks before editing",
      permission: { edit: "ask", bash: "allow" },
    },
    restricted: {
      mode: "primary",
      description: "denied the built-in task spawn tool",
      tools: { task: false },
    },
    helper: { mode: "subagent", description: "helper subagent for spawn probes" },
  };
  if (options.filerefPromptPath !== undefined) {
    // NOTE: opencode scans EVERY config string for file references, so even a
    // description containing a literal brace-file token is resolved (and a
    // dangling one is a ConfigInvalidError). Keep fixture prose plain.
    agent["fileref"] = {
      mode: "primary",
      description: "system prompt loaded from an absolute path",
      prompt: `{file:${options.filerefPromptPath}}`,
    };
  }
  writeFileSync(
    options.configPath,
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: [options.pluginPath],
        model: "stub/stub-model",
        small_model: "stub/stub-model",
        provider: {
          stub: {
            npm: "@ai-sdk/openai-compatible",
            name: "Stub LLM",
            options: { baseURL: options.stubBaseUrl, apiKey: "local" },
            models,
          },
        },
        agent,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

let mainSuiteRan = false;

// ---------------------------------------------------------------------------
// Phase 20.1 — the committed offered-tool contract. This is an EQUALITY pin, not
// a membership sample: the assertion-coverage note it closes says the suite
// asserted "membership/absence of specific names, never the full list", which
// leaves a tool arriving on an opencode bump invisible. Every name here carries
// a §2 side-effect class in adapter/wire-notes.md, and Task 21.3 refuses a
// built-in that carries none — so a name added here without a class is caught
// twice.
//
// `conductor_probe` is the recorder fixture's own plugin tool and is part of the
// set opencode offers, which is exactly why the pin includes it: a plugin tool
// and a built-in are indistinguishable to the model.
const OFFERED_BUILTIN_TOOLS: readonly string[] = [
  "bash",
  "edit",
  "glob",
  "grep",
  "read",
  "skill",
  "task",
  "todowrite",
  "webfetch",
  "write",
];
const OFFERED_TOOL_SET: readonly string[] = [...OFFERED_BUILTIN_TOOLS, "conductor_probe"].sort();

// 20.5 recorded reality. A bare {type,text} pushed onto the chat.message hook's
// `output.parts` fails the prompt with a 500 — the array is Part[] (id,
// sessionID and messageID all required), not TextPartInput[]. A fully-shaped
// Part is accepted without error and then has no effect at all: opencode builds
// both the persisted message and the provider request from its own part records,
// never from the array the hook mutated. So the seam delivers no banner.
const BANNER_PART_REACHES_TRANSCRIPT = false;

// 20.5, the other half: the appended part does not reach the provider request
// either. Recorded separately because "invisible to the operator" and "invisible
// to the model" are different failures, and a future opencode could change one
// without the other.
const BANNER_PART_REACHES_MODEL = false;

interface PermissionRule {
  permission: string;
  pattern: string;
  action: string;
}

interface ResolvedAgent {
  name: string;
  mode?: string;
  permission: PermissionRule[];
}

interface ResolvedChild {
  id: string;
  parentID?: string;
}

// opencode resolves a permission by walking its agent's ruleset and taking the
// LAST rule whose permission and pattern both match — the leading {*,*,allow}
// row is therefore the default and every later row is a narrowing. Only the
// wildcard and prefix/suffix forms the base ruleset actually uses are handled;
// anything richer would be modelling opencode rather than measuring it.
function patternMatches(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;
  if (pattern.startsWith("*") && pattern.endsWith("*") && pattern.length > 2) {
    return value.includes(pattern.slice(1, -1));
  }
  if (pattern.startsWith("*")) return value.endsWith(pattern.slice(1));
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return false;
}

function offeredNames(request: StubRequest): string[] {
  return (request.body["tools"] as { function?: { name?: string } }[])
    .map((t) => t.function?.name)
    .filter((n): n is string => typeof n === "string");
}

function effectivePermission(rules: PermissionRule[], permission: string, value: string): string {
  let action = "allow";
  for (const rule of rules) {
    if (rule.permission !== "*" && rule.permission !== permission) continue;
    if (!patternMatches(rule.pattern, value)) continue;
    action = rule.action;
  }
  return action;
}

describe("opencode wire contract (Task 0.2)", { skip: SKIP }, () => {
  // realpathSync matters: macOS tmpdir() is /var/... which opencode
  // canonicalizes to /private/var/...; an uncanonicalized session directory
  // makes edits inside the fixture look external (external_directory asks).
  const tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "conductor-wire-")));
  const fixtureDir = join(tmpRoot, "fixture");
  const homeDir = join(tmpRoot, "home");
  const recorderFile = join(tmpRoot, "recorder.jsonl");
  const editTargetPath = join(fixtureDir, "edit-target.txt");
  const filerefPromptPath = join(fixtureDir, "sysprompt.md");

  let stub: StubHandle | undefined;
  let serve: ServeHandle | undefined;

  function records(): RecorderRecord[] {
    if (!existsSync(recorderFile)) return [];
    const out: RecorderRecord[] = [];
    for (const line of readFileSync(recorderFile, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const parsed = parseRecorderLine(line);
      if (parsed !== null) out.push(parsed);
    }
    return out;
  }

  function findRecord(pred: (r: RecorderRecord) => boolean): RecorderRecord | undefined {
    return records().find(pred);
  }

  function stubRequestWithMarker(marker: string): StubRequest | undefined {
    assert.ok(stub !== undefined, "stub server not started");
    return stub.requests.find(
      (r) => r.url.includes("chat/completions") && JSON.stringify(r.body["messages"] ?? []).includes(marker),
    );
  }

  function serverUrl(): string {
    assert.ok(serve !== undefined, "opencode serve not started");
    return serve.url;
  }

  async function createSession(title: string, parentID?: string): Promise<SessionInfo> {
    const body: Record<string, unknown> = { title };
    if (parentID !== undefined) body["parentID"] = parentID;
    const res = await httpJson("POST", `${serverUrl()}/session?directory=${encodeURIComponent(fixtureDir)}`, body);
    assert.equal(res.status, 200, `session.create failed: ${JSON.stringify(res.json)}`);
    const session = res.json as SessionInfo;
    assert.match(session.id, /^ses_/);
    return session;
  }

  async function promptSession(
    sessionID: string,
    body: Record<string, unknown>,
    timeoutMs = 90_000,
  ): Promise<PromptResponse> {
    const res = await httpJson(
      "POST",
      `${serverUrl()}/session/${sessionID}/message?directory=${encodeURIComponent(fixtureDir)}`,
      body,
      timeoutMs,
    );
    assert.equal(res.status, 200, `session.prompt failed: ${JSON.stringify(res.json).slice(0, 500)}`);
    return res.json as PromptResponse;
  }

  async function transcript(sessionID: string): Promise<MessageEntry[]> {
    const res = await httpJson(
      "GET",
      `${serverUrl()}/session/${sessionID}/message?directory=${encodeURIComponent(fixtureDir)}`,
    );
    assert.equal(res.status, 200);
    return res.json as MessageEntry[];
  }

  function toolParts(messages: MessageEntry[]): Part[] {
    return messages.flatMap((m) => m.parts.filter((p) => p.type === "tool"));
  }

  let primerSessionID = "";

  before(
    async () => {
      mainSuiteRan = true;
      mkdirSync(fixtureDir, { recursive: true });
      mkdirSync(homeDir, { recursive: true });
      writeFileSync(editTargetPath, "alpha\n");
      writeFileSync(filerefPromptPath, `${FILEREF_MARKER} from sysprompt file\n`);

      stub = await startStubLlmServer({ editTargetPath });
      writeOpencodeConfig({
        configPath: join(fixtureDir, "opencode.json"),
        pluginPath: RECORDER_PLUGIN_PATH,
        stubBaseUrl: stub.baseUrl,
        filerefPromptPath,
      });

      assert.ok(OPENCODE_BINARY !== null);
      const port = await pickFreePort();
      assert.notEqual(port, LLAMA_SERVER_RESERVED_PORT);
      serve = await startOpencodeServe({
        binary: OPENCODE_BINARY,
        port,
        cwd: fixtureDir,
        env: serveEnv({
          OPENCODE_CONFIG: join(fixtureDir, "opencode.json"),
          OPENCODE_TEST_HOME: homeDir,
          XDG_CONFIG_HOME: join(homeDir, "xdg"),
          CONDUCTOR_RECORDER_FILE: recorderFile,
        }),
      });
      assert.ok(!serve.url.endsWith(`:${LLAMA_SERVER_RESERVED_PORT}`));

      // Primer round-trip: one plain prompt that several tests dissect.
      const primer = await createSession("wire-primer");
      primerSessionID = primer.id;
      const reply = await promptSession(primerSessionID, {
        agent: "wire-primary",
        parts: [{ type: "text", text: "WIRE_PRIMER hello plain" }],
      });
      assert.equal(reply.info.finish, "stop");
    },
    { timeout: 120_000 },
  );

  after(
    async () => {
      if (serve !== undefined) await serve.kill();
      if (stub !== undefined) await stub.close();
      rmSync(tmpRoot, { recursive: true, force: true });
    },
    { timeout: 30_000 },
  );

  it("0.2-serve/0.2-plugin-load: plugin loads from a config-listed absolute file path; config carries the test agents", async () => {
    const factory = await pollUntil(
      () => findRecord((r) => r.kind === "factory"),
      "recorder plugin factory record",
      15_000,
    );
    assert.equal(factory.data["directory"], fixtureDir);
    assert.equal(factory.data["hasClient"], true);
    assert.equal(factory.data["hasShell"], true);

    const config = await httpJson("GET", `${serverUrl()}/config?directory=${encodeURIComponent(fixtureDir)}`);
    const cfg = config.json as { plugin?: string[]; agent?: Record<string, unknown> };
    assert.ok(cfg.plugin?.some((p) => p.endsWith("fixtures/recorder-plugin.ts")));
    assert.ok(cfg.agent !== undefined);
    for (const name of ["wire-primary", "asker", "restricted", "helper", "fileref"]) {
      assert.ok(name in cfg.agent, `agent ${name} missing from served config`);
    }

    const ids = await httpJson(
      "GET",
      `${serverUrl()}/experimental/tool/ids?directory=${encodeURIComponent(fixtureDir)}`,
    );
    assert.ok((ids.json as string[]).includes("conductor_probe"));
  });

  it("0.2-deny: tool.execute.before throw denies the call and the error text reaches the transcript", async () => {
    const session = await createSession("deny-probe");
    await promptSession(session.id, {
      agent: "wire-primary",
      parts: [{ type: "text", text: "SCENARIO_CALL_BASH deny-run" }],
    });

    const messages = await transcript(session.id);
    const bashPart = toolParts(messages).find((p) => p.tool === "bash");
    assert.ok(bashPart !== undefined, "no bash tool part in transcript");
    assert.equal(bashPart.state?.status, "error");
    assert.ok(String(bashPart.state?.error).includes(DENY_MARKER));

    // The deny reason also goes back to the model as the tool result.
    const followUp = stub?.requests.find((r) =>
      (r.body["messages"] as unknown[] | undefined)?.some(
        (m) => (m as { role?: string }).role === "tool" && JSON.stringify(m).includes(DENY_MARKER),
      ),
    );
    assert.ok(followUp !== undefined, "deny text never reached the model as a tool result");

    const beforeRecord = findRecord(
      (r) => r.kind === "tool.execute.before" && r.data["tool"] === "bash" && r.data["sessionID"] === session.id,
    );
    assert.ok(beforeRecord !== undefined);
  });

  it("0.2-custom-tool: plugin-defined tool registers and executes", async () => {
    const session = await createSession("custom-tool-probe");
    await promptSession(session.id, {
      agent: "wire-primary",
      parts: [{ type: "text", text: "SCENARIO_CALL_PROBE_TOOL custom-run" }],
    });

    const request = stubRequestWithMarker("custom-run");
    assert.ok(request !== undefined);
    const offered = (request.body["tools"] as { function?: { name?: string } }[]).map((t) => t.function?.name);
    assert.ok(offered.includes("conductor_probe"), `conductor_probe not offered to model: ${offered.join(",")}`);

    const part = toolParts(await transcript(session.id)).find((p) => p.tool === "conductor_probe");
    assert.ok(part !== undefined);
    assert.equal(part.state?.status, "completed");
    assert.equal(part.state?.output, "PROBE_OK:from-stub");

    const executed = findRecord((r) => r.kind === "custom-tool-executed" && r.data["sessionID"] === session.id);
    assert.ok(executed !== undefined);
    assert.equal(executed.data["note"], "from-stub");
  });

  // D8 (ISSUE-017): `apply_patch`/`patch` exist in opencode's tool registry but
  // are NOT in the offered set at 1.18.15 — a config flip away from reachable.
  // The gate refuses both outright (gate-wiring.test.ts [5.3-patch-tools-denied]),
  // and this row pins the OTHER half of that decision: the day a build starts
  // offering either tool to the model, this assertion goes red and the decision
  // gets re-taken deliberately rather than by drift.
  it("0.2-patch-tools-unoffered: neither apply_patch nor patch is in the offered tool set (D8 pin)", () => {
    const request = stubRequestWithMarker("WIRE_PRIMER");
    assert.ok(request !== undefined);
    const offered = (request.body["tools"] as { function?: { name?: string } }[]).map((t) => t.function?.name);
    assert.ok(offered.length > 0, `no tools offered at all — the pin would be vacuous: ${JSON.stringify(offered)}`);
    for (const denied of ["apply_patch", "patch"]) {
      assert.ok(
        !offered.includes(denied),
        `${denied} is offered to the model; the gate denies it outright, so the D8 decision must be re-taken: ${offered.join(",")}`,
      );
    }
  });

  it("0.2-headers: chat.headers output reaches the stub as HTTP headers (body vendor-field fallback also observed)", () => {
    const request = stubRequestWithMarker("WIRE_PRIMER");
    assert.ok(request !== undefined);
    assert.equal(request.headers[PROBE_HEADER_NAME], PROBE_HEADER_VALUE);
    // Not needed as a fallback, but pinned while we are here: a field set via
    // chat.params `options` lands as a top-level provider-body key, so the
    // §5.1 x_conductor body fallback is real if headers ever regress.
    assert.equal(request.body[PARAMS_FALLBACK_FIELD], PARAMS_FALLBACK_VALUE);
    const headersRecord = findRecord(
      (r) => r.kind === "chat.headers" && r.data["sessionID"] === primerSessionID,
    );
    assert.ok(headersRecord !== undefined);
  });

  it("0.2-systransform: experimental.chat.system.transform content reaches the stub request body", () => {
    const request = stubRequestWithMarker("WIRE_PRIMER");
    assert.ok(request !== undefined);
    const systemMessages = (request.body["messages"] as { role: string; content?: unknown }[]).filter(
      (m) => m.role === "system",
    );
    assert.ok(systemMessages.some((m) => String(m.content).includes(SYSTEM_MARKER)));
    const transformRecord = findRecord(
      (r) => r.kind === "system.transform" && r.data["sessionID"] === primerSessionID,
    );
    assert.ok(transformRecord !== undefined);
  });

  it("0.2-idle: session.idle fires after the reply", async () => {
    await pollUntil(
      () =>
        findRecord(
          (r) => eventType(r) === "session.idle" && eventProps(r)["sessionID"] === primerSessionID,
        ),
      "session.idle event for the primer session",
      15_000,
    );
  });

  it("0.2-format DRIFT: prompt-body format:{type:json_schema} is accepted but produces NO schema field in the provider request at 1.18.15", async () => {
    const session = await createSession("format-probe");
    const reply = await promptSession(session.id, {
      agent: "wire-primary",
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { verdict: { type: "string" } }, required: ["verdict"] },
      },
      parts: [{ type: "text", text: "FORMAT_PROBE give verdict" }],
    });
    assert.equal(reply.info.finish, "stop");

    const request = stubRequestWithMarker("FORMAT_PROBE");
    assert.ok(request !== undefined);
    // Observed reality (recorded, not hoped): neither field is produced. When
    // an opencode upgrade starts emitting one of them, this test fails and the
    // adapter constant gets pinned to whichever field appears.
    assert.ok(!("response_format" in request.body), "upstream now emits response_format: re-pin wire-notes");
    assert.ok(!("json_schema" in request.body), "upstream now emits json_schema: re-pin wire-notes");
  });

  it("0.2-model-override: model override in the prompt body reaches the stub", async () => {
    const session = await createSession("model-override-probe");
    const reply = await promptSession(session.id, {
      agent: "wire-primary",
      model: { providerID: "stub", modelID: "stub-model-b" },
      parts: [{ type: "text", text: "MODEL_OVERRIDE_PROBE hello" }],
    });
    assert.equal(reply.info.modelID, "stub-model-b");
    const request = stubRequestWithMarker("MODEL_OVERRIDE_PROBE");
    assert.ok(request !== undefined);
    assert.equal(request.body["model"], "stub-model-b");
  });

  it("0.2-fileref: {file:<absolute path>} agent prompt resolves and reaches the stub as the system prompt", async () => {
    const session = await createSession("fileref-probe");
    await promptSession(session.id, {
      agent: "fileref",
      parts: [{ type: "text", text: "FILEREF_PROBE hello" }],
    });
    const request = stubRequestWithMarker("FILEREF_PROBE");
    assert.ok(request !== undefined);
    const systemMessages = (request.body["messages"] as { role: string; content?: unknown }[]).filter(
      (m) => m.role === "system",
    );
    assert.ok(systemMessages.some((m) => String(m.content).includes(FILEREF_MARKER)));
  });

  it("0.2-perm-ask-hook/0.2-perm-bus: permission.ask hook is NOT dispatched; permission.asked bus event + HTTP reply adjudicates an agent-level ask", async () => {
    // --- allow path ("once") -------------------------------------------------
    const session = await createSession("perm-once-probe");
    const promptResult = promptSession(session.id, {
      agent: "asker",
      parts: [{ type: "text", text: "SCENARIO_CALL_EDIT perm-once-run" }],
    }).then(
      (r) => ({ ok: true as const, reply: r }),
      (err: unknown) => ({ ok: false as const, error: String(err) }),
    );

    const asked = await pollUntil(
      () =>
        findRecord(
          (r) => eventType(r) === "permission.asked" && eventProps(r)["sessionID"] === session.id,
        ),
      "permission.asked bus event",
      30_000,
    );
    const permissionID = String(eventProps(asked)["id"]);
    assert.match(permissionID, /^per_/);
    assert.equal(eventProps(asked)["permission"], "edit");

    // §5.2 named this client.permission.reply({requestID, reply}); the real
    // 1.18.15 surface is POST /session/{id}/permissions/{permissionID} with
    // {response} (SDK method postSessionIdPermissionsPermissionId).
    const replyRes = await httpJson(
      "POST",
      `${serverUrl()}/session/${session.id}/permissions/${permissionID}?directory=${encodeURIComponent(fixtureDir)}`,
      { response: "once" },
    );
    assert.equal(replyRes.status, 200);
    assert.equal(replyRes.json, true);

    const settled = await promptResult;
    assert.ok(settled.ok, `prompt failed after permission reply: ${settled.ok ? "" : settled.error}`);
    assert.equal(readFileSync(editTargetPath, "utf8"), "beta\n", "allowed edit did not execute");

    await pollUntil(
      () =>
        findRecord(
          (r) => eventType(r) === "permission.replied" && eventProps(r)["sessionID"] === session.id,
        ),
      "permission.replied bus event",
      15_000,
    );

    // --- deny path ("reject") ------------------------------------------------
    // Reset the target first: the edit tool validates oldString against the
    // file BEFORE asking, so a stale target would fail without any ask.
    writeFileSync(editTargetPath, "alpha\n");
    const rejectSession = await createSession("perm-reject-probe");
    const rejectResult = promptSession(rejectSession.id, {
      agent: "asker",
      parts: [{ type: "text", text: "SCENARIO_CALL_EDIT perm-reject-run" }],
    }).then(
      (r) => ({ ok: true as const, reply: r }),
      (err: unknown) => ({ ok: false as const, error: String(err) }),
    );
    const rejectAsked = await pollUntil(
      () =>
        findRecord(
          (r) => eventType(r) === "permission.asked" && eventProps(r)["sessionID"] === rejectSession.id,
        ),
      "permission.asked bus event (reject path)",
      30_000,
    );
    const rejectPermissionID = String(eventProps(rejectAsked)["id"]);
    const rejectReply = await httpJson(
      "POST",
      `${serverUrl()}/session/${rejectSession.id}/permissions/${rejectPermissionID}?directory=${encodeURIComponent(fixtureDir)}`,
      { response: "reject" },
    );
    assert.equal(rejectReply.status, 200);
    const rejectSettled = await rejectResult;
    assert.ok(rejectSettled.ok);

    const editPart = toolParts(await transcript(rejectSession.id)).find((p) => p.tool === "edit");
    assert.ok(editPart !== undefined);
    assert.equal(editPart.state?.status, "error");
    assert.match(String(editPart.state?.error), /reject/i);
    assert.equal(readFileSync(editTargetPath, "utf8"), "alpha\n", "rejected edit must not run");

    // The typed plugin hook stayed silent through BOTH permission flows. If an
    // upstream fix starts dispatching it, this assertion is the tripwire.
    assert.equal(
      records().filter((r) => r.kind === "permission.ask-hook-dispatched").length,
      0,
      "permission.ask plugin hook IS now dispatched: upstream fixed it, re-pin §5.1",
    );
  });

  it("0.2-disc-streaming (i): session.prompt issues a STREAMING provider request", (t) => {
    const request = stubRequestWithMarker("WIRE_PRIMER");
    assert.ok(request !== undefined);
    assert.equal(request.body["stream"], true);
    assert.deepEqual(request.body["stream_options"], { include_usage: true });
    t.diagnostic("discovery(i): provider requests are streaming (stream:true, SSE consumed) - Task 11.6 must observe SSE");
  });

  it("0.2-disc-init-failure (ii): a plugin that throws in its factory is logged and the session continues UNGATED", async (t) => {
    assert.ok(OPENCODE_BINARY !== null && stub !== undefined);
    const crashFixtureDir = join(tmpRoot, "crash-fixture");
    const crashHomeDir = join(tmpRoot, "crash-home");
    mkdirSync(crashFixtureDir, { recursive: true });
    mkdirSync(crashHomeDir, { recursive: true });
    writeOpencodeConfig({
      configPath: join(crashFixtureDir, "opencode.json"),
      pluginPath: CRASHING_PLUGIN_PATH,
      stubBaseUrl: stub.baseUrl,
    });

    const port = await pickFreePort();
    const crashServe = await startOpencodeServe({
      binary: OPENCODE_BINARY,
      port,
      cwd: crashFixtureDir,
      env: serveEnv({
        OPENCODE_CONFIG: join(crashFixtureDir, "opencode.json"),
        OPENCODE_TEST_HOME: crashHomeDir,
        XDG_CONFIG_HOME: join(crashHomeDir, "xdg"),
        CONDUCTOR_RECORDER_FILE: join(tmpRoot, "crash-recorder.jsonl"),
      }),
    });
    try {
      const created = await httpJson(
        "POST",
        `${crashServe.url}/session?directory=${encodeURIComponent(crashFixtureDir)}`,
        { title: "crash-probe" },
      );
      assert.equal(created.status, 200, "session creation was refused after plugin init failure");
      const sessionID = (created.json as SessionInfo).id;

      await pollUntil(
        () => (crashServe.log().includes("failed to load plugin") ? true : undefined),
        "'failed to load plugin' in serve log",
        15_000,
      );
      assert.ok(crashServe.log().includes(CRASH_MARKER), "crash marker missing from serve log");

      const reply = await httpJson(
        "POST",
        `${crashServe.url}/session/${sessionID}/message?directory=${encodeURIComponent(crashFixtureDir)}`,
        { agent: "wire-primary", parts: [{ type: "text", text: "CRASH_UNGATED_PROBE hello" }] },
        90_000,
      );
      assert.equal(reply.status, 200);
      const parts = (reply.json as PromptResponse).parts;
      assert.ok(parts.some((p) => p.type === "text" && (p.text ?? "").startsWith("STUB_REPLY_OK")));
      t.diagnostic(
        "discovery(ii): factory throw => level=ERROR 'failed to load plugin' log line, then sessions/prompts proceed with NO gating - §3.8 beacon must be loud",
      );
    } finally {
      await crashServe.kill();
    }
  });

  it("0.2-disc-tool-disable (iii): agent-level tools:{task:false} removes the spawn tool; a forced call is rejected as an unavailable tool", async (t) => {
    const restricted = await createSession("task-restricted-probe");
    await promptSession(restricted.id, {
      agent: "restricted",
      parts: [{ type: "text", text: "SCENARIO_CALL_TASK restricted-run" }],
    });

    const request = stubRequestWithMarker("restricted-run");
    assert.ok(request !== undefined);
    const offered = (request.body["tools"] as { function?: { name?: string } }[]).map((t2) => t2.function?.name);
    assert.ok(!offered.includes("task"), `task tool still offered to restricted agent: ${offered.join(",")}`);

    const parts = toolParts(await transcript(restricted.id));
    assert.ok(!parts.some((p) => p.tool === "task"), "restricted agent executed the task tool");
    const invalidPart = parts.find((p) => p.tool === "invalid");
    assert.ok(invalidPart !== undefined, "forced task call did not surface as the 'invalid' tool");
    assert.equal(invalidPart.state?.input?.["tool"], "task");
    assert.match(String(invalidPart.state?.output), /unavailable tool 'task'/);

    // Control: the same call from an unrestricted agent spawns a child session.
    const allowed = await createSession("task-allowed-probe");
    await promptSession(
      allowed.id,
      { agent: "wire-primary", parts: [{ type: "text", text: "SCENARIO_CALL_TASK allowed-run" }] },
      120_000,
    );
    const taskPart = toolParts(await transcript(allowed.id)).find((p) => p.tool === "task");
    assert.ok(taskPart !== undefined);
    assert.equal(taskPart.state?.status, "completed");
    const children = await httpJson(
      "GET",
      `${serverUrl()}/session/${allowed.id}/children?directory=${encodeURIComponent(fixtureDir)}`,
    );
    const childList = children.json as SessionInfo[];
    assert.equal(childList.length, 1);
    assert.equal(childList[0]?.parentID, allowed.id);
    t.diagnostic('discovery(iii): config key = agent.<name>.tools = {"task": false} (§5.3 fragment must use it)');
  });

  it("0.2-disc-parentid (iv): parentID is accepted on create; plugin-created sessions have the same ses_ id shape", async (t) => {
    const parent = await createSession("parent-probe");
    const child = await createSession("child-probe", parent.id);
    assert.equal(child.parentID, parent.id);
    assert.match(child.id, /^ses_[0-9a-zA-Z]+$/);

    const trigger = await createSession(PLUGIN_SPAWN_TRIGGER_TITLE);
    const pluginCreated = await pollUntil(
      () => findRecord((r) => r.kind === "plugin-created-session"),
      "plugin-created-session record",
      15_000,
    );
    assert.equal(pluginCreated.data["error"], null);
    const created = pluginCreated.data["created"] as SessionInfo;
    assert.equal(created.parentID, trigger.id);
    assert.match(created.id, /^ses_[0-9a-zA-Z]+$/);
    // Recorded reality: NO distinguishable id shape exists for plugin-created
    // sessions (identical ses_ prefix), and tool-call ids are minted by the
    // PROVIDER (the stub's call_stub_* ids came back verbatim), so the
    // registry gate cannot key on id shape - it must key on the session
    // registry, exactly as §3.5 assumes.
    const denyBefore = findRecord((r) => r.kind === "tool.execute.before" && r.data["tool"] === "bash");
    assert.ok(denyBefore !== undefined);
    assert.equal(denyBefore.data["callID"], "call_stub_bash_1");
    t.diagnostic("discovery(iv): parentID accepted on create (API and plugin client); id shape identical (ses_*): registry gate stays mandatory");
  });

  // -------------------------------------------------------------------------
  // Phase 20 — measured client contract. Each test below closes one gap the
  // assertion-coverage notes name, or answers one question a later phase is
  // gated on. They add no behaviour; they only pin what the binary does.
  // -------------------------------------------------------------------------

  it("20.1-tool-inventory: the FULL offered tool set equals the committed list, not merely a membership sample", () => {
    const request = stubRequestWithMarker("WIRE_PRIMER");
    assert.ok(request !== undefined, "no primer request reached the stub");
    const offered = offeredNames(request).sort();
    assert.ok(offered.length > 0, "no tools offered at all — the pin would be vacuous");
    // The whole point of this assertion is that it is an EQUALITY. A tool that
    // appears or disappears on an opencode bump must become an explicit decision,
    // which membership checks cannot force.
    assert.deepEqual(
      offered,
      OFFERED_TOOL_SET,
      "the offered tool set drifted from the committed contract; update OFFERED_TOOL_SET and " +
        "wire-notes.md, and give every added name a §2 side-effect class before Task 21.3 refuses it",
    );
  });

  it("20.2-permission-defaults: with no permission key in config, every offered built-in resolves to allow — webfetch included", async (t) => {
    const res = await httpJson("GET", `${serverUrl()}/agent?directory=${encodeURIComponent(fixtureDir)}`);
    assert.equal(res.status, 200);
    const agents = res.json as ResolvedAgent[];

    // `helper` is the fixture's bare subagent: mode subagent, no permission key,
    // no prompt key. It is the closest analogue of a conductor sub-session.
    const helper = agents.find((a) => a.name === "helper");
    assert.ok(helper !== undefined, "fixture agent 'helper' missing from the resolved agent list");
    // `wire-primary` is the primary-kind counterpart, and native agents cover the
    // built-in kinds, so the posture is recorded for every kind opencode ships.
    const primary = agents.find((a) => a.name === "wire-primary");
    assert.ok(primary !== undefined);

    for (const agent of [helper, primary]) {
      for (const toolName of OFFERED_BUILTIN_TOOLS) {
        assert.equal(
          effectivePermission(agent.permission, toolName, "*"),
          "allow",
          `built-in '${toolName}' does not default to allow for agent '${agent.name}' — ` +
            "the §1.1 premise and Task 21.4 both key off this",
        );
      }
    }

    // The narrowings that DO exist in the base ruleset, recorded so a later
    // opencode release that adds one to a tool name is caught here.
    assert.equal(effectivePermission(helper.permission, "external_directory", "*"), "ask");
    assert.equal(effectivePermission(helper.permission, "question", "*"), "deny");
    assert.equal(effectivePermission(helper.permission, "read", ".env"), "ask");
    assert.equal(effectivePermission(helper.permission, "read", "src/main.ts"), "allow");

    t.diagnostic(
      "20.2: opencode 1.18.15 resolves every agent's ruleset from a leading {*,*,allow} rule; " +
        "webfetch carries no narrowing in any agent kind, so it is reachable and unasked by default",
    );
  });

  it("20.2-webfetch-live: a webfetch call from a bare subagent-kind agent executes with NO permission.asked", async (t) => {
    const asksBefore = records().filter((r) => eventType(r) === "permission.asked").length;
    const session = await createSession("webfetch-posture");
    await promptSession(session.id, {
      agent: "helper",
      parts: [{ type: "text", text: "SCENARIO_CALL_WEBFETCH probe the loopback page" }],
    });

    const parts = toolParts(await transcript(session.id));
    const fetchPart = parts.find((p) => p.tool === "webfetch");
    assert.ok(fetchPart !== undefined, `webfetch was never called: ${JSON.stringify(parts.map((p) => p.tool))}`);
    assert.equal(
      fetchPart.state?.status,
      "completed",
      `webfetch did not complete: ${JSON.stringify(fetchPart.state)}`,
    );
    assert.ok(
      JSON.stringify(fetchPart.state?.output ?? "").includes(WEBFETCH_PAGE_BODY.trim().split(" ")[0] ?? ""),
      "the fetched page body did not reach the tool result",
    );

    const asksAfter = records().filter((r) => eventType(r) === "permission.asked").length;
    assert.equal(
      asksAfter,
      asksBefore,
      "a permission.asked fired for webfetch; the §1.1 premise would then be narrower than stated",
    );
    t.diagnostic("20.2: webfetch ran end-to-end against a loopback URL with zero permission asks");
  });

  it("20.5-banner-part: a part appended inside chat.message reaches neither the transcript nor the model, so it is not a banner seam", async (t) => {
    const session = await createSession("banner-part-probe");
    await promptSession(session.id, {
      agent: "wire-primary",
      parts: [{ type: "text", text: `${BANNER_PART_TRIGGER_TITLE} banner seam probe` }],
    });

    const appended = await pollUntil(
      () => findRecord((r) => r.kind === "banner-part-appended"),
      "banner-part-appended record",
      15_000,
    );
    assert.equal(appended.data["after"], (appended.data["before"] as number) + 1);

    // Two distinct questions, recorded separately: whether the marker is EVER
    // readable during the message's life, and whether it is readable once the
    // message has settled. A single read right after the prompt returns cannot
    // tell a durable part from a transient one, so this polls to a deadline.
    let everSeen = false;
    let lastTexts: string[] = [];
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const messages = await transcript(session.id);
      lastTexts = messages.flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text ?? ""));
      if (lastTexts.some((tx) => tx.includes(BANNER_PART_MARKER))) everSeen = true;
      await sleep(250);
    }
    const settledSeen = lastTexts.some((tx) => tx.includes(BANNER_PART_MARKER));
    assert.equal(
      everSeen,
      false,
      "the appended part became readable at some point in the message's life; the seam is then " +
        "transient rather than inert, and Task 21.7 must re-measure before ruling it out",
    );

    assert.equal(
      settledSeen,
      BANNER_PART_REACHES_TRANSCRIPT,
      settledSeen
        ? "an appended chat.message part now reaches the transcript — chat.message became a usable banner seam and BANNER_PART_REACHES_TRANSCRIPT must be flipped"
        : `an appended chat.message part never reaches the transcript, so chat.message cannot carry a user-visible banner. Settled transcript text parts: ${JSON.stringify(lastTexts)}`,
    );

    // Nor does it reach the model. The append is inert in both directions, which
    // is what disqualifies it as a banner seam rather than merely costing tokens.
    const request = stubRequestWithMarker(BANNER_PART_TRIGGER_TITLE);
    assert.ok(request !== undefined, "no provider request carried the banner probe prompt");
    const sentToModel = JSON.stringify(request.body["messages"] ?? []).includes(BANNER_PART_MARKER);
    assert.equal(
      sentToModel,
      BANNER_PART_REACHES_MODEL,
      "the model-visibility of an appended chat.message part changed; Task 21.7's seam choice depends on it",
    );

    t.diagnostic(
      `20.5: appended chat.message part — ever readable in transcript = ${String(everSeen)}, ` +
        `readable after the message settles = ${String(settledSeen)}, sent to the model = ${String(sentToModel)}`,
    );
  });

  it("20.5-banner-toast: client.tui.showToast is callable from a plugin, and its success is not evidence a human saw it", async (t) => {
    const session = await createSession("banner-toast-probe");
    await promptSession(session.id, {
      agent: "wire-primary",
      parts: [{ type: "text", text: `${BANNER_TOAST_TRIGGER_TITLE} banner seam probe` }],
    });

    const toast = await pollUntil(
      () => findRecord((r) => r.kind === "banner-toast"),
      "banner-toast record",
      15_000,
    );
    assert.equal(toast.data["threw"], false, `client.tui.showToast threw: ${String(toast.data["error"])}`);
    assert.equal(toast.data["error"], null, "client.tui.showToast returned an error envelope");
    assert.ok(BANNER_TOAST_MARKER.length > 0);
    // The route answers 200 with no TUI attached — this suite runs `opencode
    // serve` headless, and no client is subscribed. So a toast is DELIVERABLE
    // but not OBSERVABLE, and Task 21.7 must not treat a 200 as a banner.
    t.diagnostic(
      "20.5: /tui/show-toast succeeds under headless serve with no TUI attached — " +
        "success proves reachability, never visibility",
    );
  });

  it("20.5-banner-result: tool.execute.after CAN decorate a result it did not produce, and the decoration reaches the transcript", async (t) => {
    const session = await createSession("banner-result-probe");
    await promptSession(session.id, {
      agent: "wire-primary",
      parts: [{ type: "text", text: "SCENARIO_BANNER_RESULT decorate this result" }],
    });

    await pollUntil(
      () => findRecord((r) => r.kind === "banner-result-decorated"),
      "banner-result-decorated record",
      15_000,
    );

    const parts = toolParts(await transcript(session.id));
    const bashPart = parts.find((p) => p.callID === "call_stub_bash_banner_1");
    assert.ok(bashPart !== undefined, `the probe bash call is absent: ${JSON.stringify(parts.map((p) => p.callID))}`);
    assert.equal(bashPart.state?.status, "completed", JSON.stringify(bashPart.state));
    const output = JSON.stringify(bashPart.state?.output ?? "");
    assert.ok(
      output.includes(BANNER_RESULT_MARKER),
      `the after-hook decoration did not reach the persisted tool result: ${output.slice(0, 300)}`,
    );
    t.diagnostic(
      "20.5: tool.execute.after output mutation is the ONE measured channel that puts plugin text " +
        "in front of an operator — but it fires only when a tool runs, so a banner riding it is " +
        "conditional on the session making at least one tool call",
    );
  });

  it("20.6-subagent-prompt: a mode:subagent agent with no prompt key gets opencode's own system prompt, and the system.transform injection still lands", async (t) => {
    const marker = "WIRE_SUBAGENT_SYSPROMPT_PROBE";
    const session = await createSession("subagent-sysprompt-probe");
    await promptSession(session.id, {
      agent: "helper",
      parts: [{ type: "text", text: `${marker} plain` }],
    });

    const request = stubRequestWithMarker(marker);
    assert.ok(request !== undefined, "no provider request carried the subagent probe marker");
    const messages = request.body["messages"] as { role: string; content?: unknown }[];
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");

    assert.ok(
      systemText.length > 0,
      "a subagent with no prompt key received NO system message at all — the §6.4 injection would be the only system content",
    );
    // The load-bearing half: doctrine rides experimental.chat.system.transform,
    // and ISSUE-001 is what a silently-dead injection costs. Task 21.1 selects an
    // agent per sub-session, so the injection must be proven to survive that.
    assert.ok(
      systemText.includes(SYSTEM_MARKER),
      "experimental.chat.system.transform content did NOT reach a session prompted with agent:'helper' — " +
        "Task 21.1 must not proceed",
    );
    t.diagnostic(
      `20.6: bare subagent system prompt is ${String(systemText.length)} chars of opencode's own text, ` +
        "and the system.transform append still lands on it",
    );
  });

  it("20.6-create-agent: session.create accepts `agent` and `parentID` together at 1.18.15, and /children lists the child", async (t) => {
    const parent = await createSession("agent-parent-probe");
    const res = await httpJson(
      "POST",
      `${serverUrl()}/session?directory=${encodeURIComponent(fixtureDir)}`,
      { title: "reviewer:item-1", parentID: parent.id, agent: "helper" },
    );
    assert.equal(res.status, 200, `session.create with agent+parentID failed: ${JSON.stringify(res.json)}`);
    const child = res.json as ResolvedChild;
    assert.equal(child.parentID, parent.id, "parentID was not echoed on the created session");

    const children = await httpJson(
      "GET",
      `${serverUrl()}/session/${parent.id}/children?directory=${encodeURIComponent(fixtureDir)}`,
    );
    assert.equal(children.status, 200);
    const listed = (children.json as SessionInfo[]).map((c) => c.id);
    assert.ok(
      listed.includes(child.id),
      `the API-created child is absent from /session/{id}/children: ${JSON.stringify(listed)}`,
    );
    t.diagnostic(
      "20.6: POST /session accepts {parentID, agent} on 1.18.15 even though the pinned 1.18.10 SDK " +
        "types declare only {parentID, title} — Task 21.1 can set both in one call",
    );
  });

  // -------------------------------------------------------------------------
  // Task 21.1 prerequisites. Setting `agent` on session.create is only worth
  // doing if it GOVERNS the session, and only safe if a wrong name is loud.
  // Both are measured here before fanout.ts is changed.
  // -------------------------------------------------------------------------

  it("21.1-create-agent-does-not-govern: an agent set at session.create does NOT shape the tools offered; the PROMPT's agent does", async (t) => {
    // `restricted` carries tools:{task:false}. If create-time selection governed,
    // `task` would be absent from the set offered to a prompt naming no agent.
    const res = await httpJson(
      "POST",
      `${serverUrl()}/session?directory=${encodeURIComponent(fixtureDir)}`,
      { title: "create-agent-governs", agent: "restricted" },
    );
    assert.equal(res.status, 200);
    const session = res.json as SessionInfo;

    const createMarker = "WIRE_CREATE_AGENT_ONLY";
    await promptSession(session.id, { parts: [{ type: "text", text: `${createMarker} plain` }] });
    const createRequest = stubRequestWithMarker(createMarker);
    assert.ok(createRequest !== undefined, "no provider request carried the create-agent probe marker");
    const offeredWithoutPromptAgent = offeredNames(createRequest);
    assert.ok(offeredWithoutPromptAgent.length > 0, "no tools offered at all — the pin would be vacuous");
    // RECORDED REALITY: create-time selection is metadata. The session record
    // echoes the agent, and the tool set ignores it.
    assert.ok(
      offeredWithoutPromptAgent.includes("task"),
      "create-time agent selection now GOVERNS the offered tool set; Task 21.1 may then drop the " +
        "prompt-body agent and this pin must be re-taken",
    );

    // The prompt-body agent is the field that governs, on the SAME session.
    const promptMarker = "WIRE_PROMPT_AGENT_GOVERNS";
    await promptSession(session.id, {
      agent: "restricted",
      parts: [{ type: "text", text: `${promptMarker} plain` }],
    });
    const promptRequest = stubRequestWithMarker(promptMarker);
    assert.ok(promptRequest !== undefined, "no provider request carried the prompt-agent probe marker");
    const offeredWithPromptAgent = offeredNames(promptRequest);
    assert.ok(
      !offeredWithPromptAgent.includes("task"),
      `the prompt-body agent did not govern either: ${offeredWithPromptAgent.join(",")}`,
    );

    t.diagnostic(
      "21.1: session.create's `agent` is recorded but does not govern; the prompt body's `agent` " +
        "is what shapes the offered tool set, so Task 21.1 must set BOTH — create for the child " +
        "record, prompt for the posture",
    );
  });

  it("21.1-create-agent-unknown: an unknown agent name is accepted and echoed, so a wrong name is a SILENT no-op", async (t) => {
    const res = await httpJson(
      "POST",
      `${serverUrl()}/session?directory=${encodeURIComponent(fixtureDir)}`,
      { title: "unknown-agent", agent: "conductor-does-not-exist" },
    );
    // Recorded reality: no validation, no 400, no warning. This is why the
    // role -> agent map must be pinned against opencode-fragment.json by a test:
    // a typo there would be exactly the built-but-never-wired failure the fragment
    // blocks already are, with nothing to notice it.
    assert.equal(
      res.status,
      200,
      "an unknown agent name is now rejected; the fragment-parity pin can be relaxed to rely on it",
    );
    assert.equal((res.json as { agent?: string }).agent, "conductor-does-not-exist");
    t.diagnostic(
      "21.1: POST /session accepts an unknown agent name with 200 and echoes it — a typo in the " +
        "role->agent map cannot be detected at runtime, so it must be detected by a test",
    );
  });

  it("§5.1 coverage: every named hook was observed firing during this suite", () => {
    const kinds = new Set(records().map((r) => r.kind));
    for (const kind of [
      "factory",
      "chat.message",
      "chat.params",
      "chat.headers",
      "system.transform",
      "tool.execute.before",
      "tool.execute.after",
      "custom-tool-executed",
    ]) {
      assert.ok(kinds.has(kind), `hook record '${kind}' never observed`);
    }
    const eventTypes = new Set(records().map((r) => eventType(r)).filter((t) => t !== undefined));
    for (const type of ["session.created", "session.idle", "permission.asked", "permission.replied"]) {
      assert.ok(eventTypes.has(type), `bus event '${type}' never observed`);
    }
  });
});

test("0.2-noskip: the wire-contract suite skips ONLY when the opencode binary is absent", () => {
  const binaryPresent = OPENCODE_BINARY !== null;
  assert.equal(SKIP === false, binaryPresent, "skip flag must be exactly coupled to binary absence");
  if (binaryPresent) {
    assert.equal(mainSuiteRan, true, "binary is installed but the wire-contract suite did not run");
  }
});
