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
import { startStubLlmServer, type StubHandle, type StubRequest } from "./fixtures/stub-llm-server.ts";
import {
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
