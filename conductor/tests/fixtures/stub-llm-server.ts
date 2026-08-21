// Wire-contract fixture (Task 0.2): a fake OpenAI-compatible server standing in
// for llama-server, so the integration test is model-free and fast. It records
// every request (headers + parsed body) in memory and answers with canned
// responses; scenario markers in the last user message make it emit tool calls
// so the test can drive opencode's tool loop deterministically.
//
// Verified against the installed binary (opencode 1.18.15, 2026-08-12): the
// @ai-sdk/openai-compatible provider POSTs `${baseURL}/chat/completions` with
// `stream: true` and consumes SSE `chat.completion.chunk` events.
import { createServer, type Server } from "node:http";

/** Loopback page the webfetch probe targets; served by this same server. */
export const WEBFETCH_PAGE_PATH = "/probe-page";
export const WEBFETCH_PAGE_BODY = "CONDUCTOR_WEBFETCH_PAGE_MARKER_44R plain probe page\n";

export interface StubRequest {
  n: number;
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

export interface StubHandle {
  port: number;
  baseUrl: string;
  requests: StubRequest[];
  close(): Promise<void>;
}

interface ChatMessage {
  role: string;
  content?: unknown;
}

interface ToolCallSpec {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function messagesOf(body: Record<string, unknown>): ChatMessage[] {
  const raw = body["messages"];
  return Array.isArray(raw) ? (raw as ChatMessage[]) : [];
}

function lastUserText(body: Record<string, unknown>): string {
  const messages = messagesOf(body);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m === undefined || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((c): c is { type: string; text: string } => {
          const part = c as { type?: unknown; text?: unknown };
          return part.type === "text" && typeof part.text === "string";
        })
        .map((c) => c.text)
        .join("\n");
    }
  }
  return "";
}

function hasToolResult(body: Record<string, unknown>): boolean {
  return messagesOf(body).some((m) => m.role === "tool");
}

function offeredToolNames(body: Record<string, unknown>): string[] {
  const raw = body["tools"];
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const t of raw) {
    const name = (t as { function?: { name?: unknown } }).function?.name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

/** The scenario table: marker in the last user message -> tool call to emit. */
function scenarioToolCalls(
  text: string,
  body: Record<string, unknown>,
  editTargetPath: string,
  webfetchUrl: string,
): ToolCallSpec[] | undefined {
  const offered = offeredToolNames(body);
  const pick = (wanted: string): string => (offered.includes(wanted) ? wanted : wanted);
  if (text.includes("SCENARIO_CALL_BASH")) {
    return [
      {
        id: "call_stub_bash_1",
        name: pick("bash"),
        args: { command: "echo conductor-probe", description: "wire probe" },
      },
    ];
  }
  if (text.includes("SCENARIO_CALL_PROBE_TOOL")) {
    return [{ id: "call_stub_probe_1", name: "conductor_probe", args: { note: "from-stub" } }];
  }
  if (text.includes("SCENARIO_CALL_TASK")) {
    return [
      {
        id: "call_stub_task_1",
        name: pick("task"),
        args: { description: "probe spawn", prompt: "say hi", subagent_type: "helper" },
      },
    ];
  }
  if (text.includes("SCENARIO_BANNER_RESULT")) {
    return [
      {
        id: "call_stub_bash_banner_1",
        name: pick("bash"),
        // Deliberately NOT the string the recorder's deny rule matches, so this
        // call runs and produces a result the after-hook can decorate.
        args: { command: "echo conductor-banner-result-probe", description: "banner result probe" },
      },
    ];
  }
  if (text.includes("SCENARIO_CALL_WEBFETCH")) {
    return [
      {
        id: "call_stub_webfetch_1",
        name: pick("webfetch"),
        args: { url: webfetchUrl, format: "text" },
      },
    ];
  }
  if (text.includes("SCENARIO_CALL_EDIT")) {
    return [
      {
        id: "call_stub_edit_1",
        name: pick("edit"),
        args: { filePath: editTargetPath, oldString: "alpha", newString: "beta" },
      },
    ];
  }
  return undefined;
}

function chunkEnvelope(id: string, model: unknown): Record<string, unknown> {
  return { id, object: "chat.completion.chunk", created: 0, model };
}

export function startStubLlmServer(options: { editTargetPath: string }): Promise<StubHandle> {
  const requests: StubRequest[] = [];
  let n = 0;
  // Filled in by listen(); the scenario table needs the bound port to name the
  // loopback page in the webfetch tool call it emits.
  let boundPort = 0;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });
    req.on("end", () => {
      n += 1;
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = { unparseable: raw };
      }
      requests.push({
        n,
        url: req.url ?? "",
        method: req.method ?? "",
        headers: { ...req.headers },
        body,
      });

      // The loopback page the Phase 20.2 webfetch probe targets. Keeping the
      // fetch target on this server is what makes that probe hermetic: opencode
      // really performs the fetch, and it never leaves the machine.
      if ((req.url ?? "").startsWith(WEBFETCH_PAGE_PATH)) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(WEBFETCH_PAGE_BODY);
        return;
      }

      if (!(req.url ?? "").includes("chat/completions")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const text = lastUserText(body);
      const toolCalls = hasToolResult(body)
        ? undefined
        : scenarioToolCalls(text, body, options.editTargetPath, `http://127.0.0.1:${boundPort}${WEBFETCH_PAGE_PATH}`);
      const replyText = `STUB_REPLY_OK ${n}`;
      const id = `chatcmpl-stub-${n}`;

      if (body["stream"] === true) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (delta: Record<string, unknown>, finish: string | null): void => {
          res.write(
            `data: ${JSON.stringify({
              ...chunkEnvelope(id, body["model"]),
              choices: [{ index: 0, delta, finish_reason: finish }],
            })}\n\n`,
          );
        };
        send({ role: "assistant" }, null);
        if (toolCalls !== undefined) {
          toolCalls.forEach((tc, i) => {
            send(
              {
                tool_calls: [
                  {
                    index: i,
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                  },
                ],
              },
              null,
            );
          });
          send({}, "tool_calls");
        } else {
          send({ content: replyText }, null);
          send({}, "stop");
        }
        res.write(
          `data: ${JSON.stringify({
            ...chunkEnvelope(id, body["model"]),
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            choices: [],
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const message =
        toolCalls !== undefined
          ? {
              role: "assistant",
              content: null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : { role: "assistant", content: replyText };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created: 0,
          model: body["model"],
          choices: [{ index: 0, message, finish_reason: toolCalls !== undefined ? "tool_calls" : "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });

  return new Promise<StubHandle>((resolvePromise, rejectPromise) => {
    server.on("error", rejectPromise);
    // Ephemeral port on loopback: never 8080 (reserved for llama-server); the
    // OS assigns from the dynamic range, and the assertion below pins that.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("stub server did not report a TCP address"));
        return;
      }
      if (address.port === 8080) {
        rejectPromise(new Error("stub server was assigned reserved port 8080"));
        return;
      }
      boundPort = address.port;
      resolvePromise({
        port: address.port,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
