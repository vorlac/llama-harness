// conductor/tests/live-inject.test.ts — GAP-003's LIVE-ISH GATE LEG, and layer (a)
// of the GAP-001 delivery witness.
//
// Every other test in this suite drives the conductor plugin through a synthetic
// PluginInput: the factory is real, the hooks are real, and the thing that decides
// WHICH hooks the runtime dispatches is a test helper. That is precisely the blind
// spot that let a whole configuration be inert and green — the §6.4 injection layer
// was composed, unit-tested and never registered, and 1,382 tests could not see it
// because none of them ever asked opencode what it would actually send.
//
// So this leg asks. It starts the REAL `opencode serve` binary against a fixture
// workspace whose config loads conductor/plugin/index.ts by absolute path, points
// the provider at the tests/fixtures stub OpenAI-compatible server, sends ONE
// prompt, and reads the request the provider actually received:
//
//   dispatch composes doctrine  ->  the stub RECEIVES it in the request body
//                               ->  the reply flows back into the transcript.
//
// No model, no network beyond loopback, one prompt. It is deliberately lean: it
// runs on every full gate, so its cost is the gate's cost.
//
// Skip policy (0.2-noskip, mirrored from wire-contract.test.ts): the suite is
// skip-tagged ONLY when no opencode binary exists, and the unconditional guard
// test at the bottom asserts that coupling. scripts/test-conductor.sh rejects any
// skip, so on a machine with the binary this leg cannot quietly stop running.

import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, before, describe, it, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { startStubLlmServer, type StubHandle, type StubRequest } from "./fixtures/stub-llm-server.ts";
import { DEFAULT_CONFIG } from "../adapter/config-io.ts";
import type { Config } from "../core/types.ts";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const CONDUCTOR_DIR = resolve(TESTS_DIR, "..");
const PLUGIN_PATH = resolve(CONDUCTOR_DIR, "plugin", "index.ts");
const DOCTRINE_DIR = resolve(CONDUCTOR_DIR, "doctrine");
const LLAMA_SERVER_RESERVED_PORT = 8080;

// The anchor line that exists only inside conductor/doctrine/core.md. Reading the
// pack from disk (rather than restating a phrase) is what makes "the doctrine
// arrived" mean the PACK arrived and not a paraphrase of it.
const CORE_PACK_ANCHOR = "# Core doctrine — always on";
const STATE_BLOCK_ANCHOR = "Conductor live state";

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
// Serve plumbing (the wire-contract.test.ts idiom, trimmed to one session)
// ---------------------------------------------------------------------------

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

  const deadline = Date.now() + 40_000;
  try {
    let url: string | undefined;
    for (;;) {
      if (proc.exitCode !== null) {
        throw new Error(`opencode serve exited early (code ${proc.exitCode}); log:\n${buf.slice(-2_000)}`);
      }
      url = /listening on (http:\/\/[0-9.]+:[0-9]+)/.exec(buf)?.[1];
      if (url !== undefined) break;
      if (Date.now() > deadline) throw new Error(`opencode serve never printed a listen address; log:\n${buf.slice(-2_000)}`);
      await sleep(100);
    }
    // Readiness is the config endpoint answering, never a fixed sleep.
    let lastError = "";
    for (;;) {
      try {
        const res = await httpJson("GET", `${url}/config`, undefined, 5_000);
        if (res.status === 200) break;
        lastError = `status ${res.status}`;
      } catch (err) {
        lastError = String(err);
      }
      if (Date.now() > deadline) throw new Error(`opencode serve /config never became ready: ${lastError}`);
      await sleep(150);
    }
    return { proc, url, log: () => buf, kill };
  } catch (err) {
    proc.kill("SIGKILL");
    await exited;
    throw err;
  }
}

function serveEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Drop inherited OPENCODE_*/LLAMA_HARNESS_* so the spawned server is hermetic
    // and reads the SHIPPED doctrine directory rather than a caller's override.
    if (value !== undefined && !key.startsWith("OPENCODE_") && !key.startsWith("LLAMA_HARNESS_")) {
      env[key] = value;
    }
  }
  return { ...env, OPENCODE_DISABLE_AUTOUPDATE: "1", ...overrides };
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "conductor",
      GIT_AUTHOR_EMAIL: "conductor@example.invalid",
      GIT_COMMITTER_NAME: "conductor",
      GIT_COMMITTER_EMAIL: "conductor@example.invalid",
    },
  });
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

let mainSuiteRan = false;

describe("live injection through a real opencode (GAP-003)", { skip: SKIP }, () => {
  // realpathSync matters: macOS tmpdir() is /var/... which opencode canonicalizes
  // to /private/var/..., and a non-canonical session directory makes the plugin's
  // own realpath'd root disagree with the one opencode reports (§0.2 wire-notes).
  const tmpRoot = realpathSync(mkdtempSync(join(tmpdir(), "conductor-live-inject-")));
  const fixtureDir = join(tmpRoot, "fixture");
  const homeDir = join(tmpRoot, "home");
  const stateDir = join(tmpRoot, "state");
  const configPath = join(tmpRoot, "opencode.json");

  let stub: StubHandle | undefined;
  let serve: ServeHandle | undefined;
  let replyText = "";

  function stubChatRequests(): StubRequest[] {
    assert.ok(stub !== undefined, "stub server not started");
    return stub.requests.filter((r) => r.url.includes("chat/completions"));
  }

  function systemMessagesOf(request: StubRequest): string[] {
    const raw = request.body["messages"];
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw as Array<{ role?: unknown; content?: unknown }>) {
      if (entry.role !== "system") continue;
      out.push(typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content));
    }
    return out;
  }

  // The first outbound provider request of the run — the one the §6.4 layer had to
  // compose for. Asserting on the FIRST request (not "any request") is what keeps
  // this from passing on a late re-prompt that happened to carry the doctrine.
  function firstChatRequest(): StubRequest {
    const requests = stubChatRequests();
    assert.ok(
      requests.length >= 1,
      "premise: the stub provider must have received at least one chat/completions request",
    );
    return requests[0] as StubRequest;
  }

  before(async () => {
    mkdirSync(fixtureDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    // A configured conductor workspace: a real git repo carrying §2.1's config, so
    // the plugin reports repoConfigured and the live state block's legality verdict
    // is the real one rather than the unconfigured fallback.
    git(fixtureDir, ["init", "-q", "-b", "main"]);
    const config: Config = { ...DEFAULT_CONFIG };
    mkdirSync(join(fixtureDir, ".conductor"), { recursive: true });
    writeFileSync(join(fixtureDir, ".conductor", "config.json"), JSON.stringify(config, null, 2));
    writeFileSync(join(fixtureDir, "README.md"), "live-inject fixture\n");
    git(fixtureDir, ["add", "-f", "README.md", ".conductor/config.json"]);
    git(fixtureDir, ["commit", "-q", "-m", "fixture"]);

    stub = await startStubLlmServer({ editTargetPath: join(fixtureDir, "unused.txt") });

    // Deliberately NO `agent` block: conductor/opencode-fragment.json's
    // orchestrator agent loads core.md as its own system prompt via {file:...}, and
    // an agent that already carries the pack would make "the doctrine arrived"
    // unfalsifiable. Here the ONLY path core.md can take into the request is the
    // §6.4 transform hook.
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          plugin: [PLUGIN_PATH],
          model: "stub/stub-model",
          small_model: "stub/stub-model",
          provider: {
            stub: {
              npm: "@ai-sdk/openai-compatible",
              name: "Stub LLM",
              options: { baseURL: stub.baseUrl, apiKey: "local" },
              models: {
                "stub-model": {
                  id: "stub-model",
                  name: "Stub Model",
                  tool_call: true,
                  temperature: true,
                  limit: { context: 32_768, output: 4_096 },
                  cost: { input: 0, output: 0 },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const port = await pickFreePort();
    serve = await startOpencodeServe({
      binary: OPENCODE_BINARY as string,
      port,
      cwd: fixtureDir,
      env: serveEnv({
        OPENCODE_CONFIG: configPath,
        XDG_CONFIG_HOME: join(homeDir, "config"),
        XDG_STATE_HOME: stateDir,
        OPENCODE_TEST_HOME: homeDir,
      }),
    });

    const created = await httpJson(
      "POST",
      `${serve.url}/session?directory=${encodeURIComponent(fixtureDir)}`,
      { title: "live inject probe" },
    );
    assert.equal(created.status, 200, `session.create failed: ${JSON.stringify(created.json)}`);
    const sessionID = (created.json as { id: string }).id;

    const prompted = await httpJson(
      "POST",
      `${serve.url}/session/${sessionID}/message?directory=${encodeURIComponent(fixtureDir)}`,
      { parts: [{ type: "text", text: "add a greeting helper" }] },
      120_000,
    );
    assert.equal(prompted.status, 200, `session.prompt failed: ${JSON.stringify(prompted.json).slice(0, 500)}`);
    const parts = (prompted.json as { parts?: Array<{ type: string; text?: string }> }).parts ?? [];
    replyText = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n");

    mainSuiteRan = true;
  });

  after(async () => {
    await serve?.kill();
    await stub?.close();
  });

  it("gap-003-doctrine-in-request: the stub provider receives the role's doctrine pack VERBATIM", () => {
    const request = firstChatRequest();
    const systems = systemMessagesOf(request);
    const packText = readFileSync(join(DOCTRINE_DIR, "core.md"), "utf8");

    assert.ok(
      systems.some((entry) => entry.includes(CORE_PACK_ANCHOR)),
      "the doctrine pack never left the harness: no system message in the outbound provider request " +
        "carries core.md's anchor line. This is what ISSUE-001 looked like from the wire — the " +
        "composition layer existed, its unit tests were green, and every dispatched session ran with " +
        "no doctrine at all. System messages seen: " +
        JSON.stringify(systems.map((entry) => entry.slice(0, 80))),
    );
    assert.ok(
      systems.some((entry) => entry.includes(packText.trim())),
      "and it must arrive VERBATIM — the pack's own bytes, not a restatement (ISSUE-003)",
    );
  });

  it("gap-003-state-block-in-request: the live state block rides the same request with the recommended next tool", () => {
    const systems = systemMessagesOf(firstChatRequest());
    const block = systems.find((entry) => entry.includes(STATE_BLOCK_ANCHOR));
    assert.ok(
      block !== undefined,
      "the §6.4 live state block reached nobody: a 32k model's only runtime navigation is this block, " +
        "and without it the model cannot know which tool is legal unless it calls conductor_status. " +
        "System messages seen: " + JSON.stringify(systems.map((entry) => entry.slice(0, 80))),
    );
    assert.match(
      block as string,
      /Recommended next tool: conductor_decompose/,
      "a fresh INTAKE run carrying adapter/chat-message.ts's provisional work classification " +
        "recommends conductor_decompose, from the gate's own legality verdict:\n" + String(block),
    );
  });

  it("gap-003-headers-in-request: the §4.4 X-Conductor-* router tags reach the provider as HTTP headers", () => {
    const request = firstChatRequest();
    const headers = request.headers;
    assert.equal(
      headers["x-conductor-role"],
      "orchestrator",
      "§4.4: priority, prefix affinity and schema observation all key off these tags. Header names " +
        "seen: " + JSON.stringify(Object.keys(headers)),
    );
    assert.equal(
      headers["x-conductor-priority"],
      "interactive",
      "§4.4: the orchestrator's queue class",
    );
    assert.equal(
      headers["x-conductor-group"],
      fixtureDir,
      "§4.4 prefix affinity: the orchestrator's group is its resolved tree — the workspace root",
    );
  });

  it("gap-003-params-in-request: the §4.1 per-role sampling reaches the provider body", () => {
    const request = firstChatRequest();
    assert.equal(
      request.body["temperature"],
      0.4,
      "§4.1 gives the orchestrator temperature 0.4; the provider body carried " +
        JSON.stringify(request.body["temperature"]),
    );
  });

  it("gap-003-reply-flows-back: the stub's reply completes the round trip into the session", () => {
    assert.match(
      replyText,
      /STUB_REPLY_OK/,
      "the leg must prove a whole round trip, not just an outbound request: the stub's reply has to " +
        "come back as the assistant's text. Got: " + JSON.stringify(replyText.slice(0, 200)),
    );
  });

  it("21.7-banner-is-visible: the REAL plugin puts the §3.8 banner into a real tool result", async () => {
    assert.ok(serve !== undefined);
    // A fresh session, so the once-per-session latch has not already fired.
    const created = await httpJson(
      "POST",
      `${serve.url}/session?directory=${encodeURIComponent(fixtureDir)}`,
      { title: "live banner probe" },
    );
    assert.equal(created.status, 200, `session.create failed: ${JSON.stringify(created.json)}`);
    const sessionID = (created.json as { id: string }).id;

    // SCENARIO_CALL_BASH makes the stub emit a real bash tool call, which is what
    // the banner rides. Without a tool call there is no banner — that IS the
    // limitation Task 20.5 measured, and this row exercises the case where the
    // seam exists rather than pretending it always does.
    const prompted = await httpJson(
      "POST",
      `${serve.url}/session/${sessionID}/message?directory=${encodeURIComponent(fixtureDir)}`,
      { parts: [{ type: "text", text: "SCENARIO_CALL_BASH please run the probe" }] },
      120_000,
    );
    assert.equal(prompted.status, 200, `session.prompt failed: ${JSON.stringify(prompted.json).slice(0, 500)}`);

    const messages = await httpJson(
      "GET",
      `${serve.url}/session/${sessionID}/message?directory=${encodeURIComponent(fixtureDir)}`,
    );
    assert.equal(messages.status, 200);
    const entries = messages.json as Array<{ parts: Array<{ type: string; tool?: string; state?: { output?: unknown } }> }>;
    const toolOutputs = entries
      .flatMap((m) => m.parts)
      .filter((p) => p.type === "tool")
      .map((p) => JSON.stringify(p.state?.output ?? ""));
    assert.ok(toolOutputs.length > 0, "the stub did not produce a tool call, so the seam was never exercised");

    const bannered = toolOutputs.filter((o) => o.includes("[conductor "));
    assert.equal(
      bannered.length,
      1,
      "exactly one tool result must carry the banner — none means the seam is dead, more than one " +
        `means the once-per-session latch is broken. Tool outputs: ${JSON.stringify(toolOutputs).slice(0, 600)}`,
    );
    assert.match(bannered[0], /pid \d+/, "the banner names the plugin pid an operator checks alive.json against");
  });

  it("gap-003-plugin-really-loaded: the conductor tools are registered in the live server", async () => {
    assert.ok(serve !== undefined);
    const res = await httpJson("GET", `${serve.url}/config?directory=${encodeURIComponent(fixtureDir)}`);
    assert.equal(res.status, 200);
    const plugins = (res.json as { plugin?: unknown }).plugin;
    assert.ok(
      Array.isArray(plugins) && plugins.some((entry) => String(entry).endsWith("conductor/plugin/index.ts")),
      "anti-vacuity: every row above is meaningless if the REAL plugin never loaded (wire-notes " +
        "DISCOVERY (ii): a plugin whose factory throws is logged and skipped, and the session " +
        "continues completely ungated). GET /config reported: " + JSON.stringify(plugins),
    );
  });
});

// ---------------------------------------------------------------------------
// Unconditional guard (0.2-noskip): the skip flag is coupled to binary absence,
// and on a machine that has the binary the suite really ran.
// ---------------------------------------------------------------------------

test("gap-003-noskip: the live leg is skipped only when no opencode binary exists, and it ran here", () => {
  assert.equal(
    SKIP === false,
    OPENCODE_BINARY !== null,
    "the skip flag must be coupled to binary absence and to nothing else",
  );
  if (OPENCODE_BINARY !== null) {
    assert.equal(
      mainSuiteRan,
      true,
      "opencode is installed, so the live leg MUST have run: a leg that silently stops driving the " +
        "real binary is indistinguishable from one that passes",
    );
  }
});
