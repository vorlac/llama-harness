// conductor/tests/fixtures/fake-sdk.ts — Task 7.1 test fixture: a FAKE, in-process
// opencode SDK client for the fan-out engine (adapter/fanout.ts). No opencode
// server, no model, no network — every method is canned and PER-TEST PROGRAMMABLE,
// and every call is RECORDED (call order + args) so the unit tests assert on it.
//
// Why a fake and not the real SDK: Task 7.1's engine (create → prompt → collect,
// wave dispatch, freeze admission, schema validate + retry, watchdog) is pure
// scheduling/validation logic. Task 0.2 pinned the live wire contract already; this
// fixture stands in for that contract so 7.1's behavior is deterministic and fast.
//
// The binding reality this fixture encodes (Task 0.2 DRIFT, adapter/wire-notes.md):
// prompt-body `format:{json_schema}` DOES NOT EXIST at 1.18.15. Structured output is
// therefore PROMPT-SHAPED and INDEPENDENTLY VALIDATED by the engine. So prompt()
// here returns a TEXT/PARTS payload (a JSON string in a text part) that the engine
// must parse + validate itself — it is NOT a native `format` result. The fixture
// records `hasFormatField` on every prompt so a test can pin that the engine never
// leans on the non-existent field.
//
// It mirrors the @opencode-ai/sdk shape the engine drives:
//   client.session.create({ body:{title?,parentID?,agent?} }) -> { data:{ id }, error? }
//   client.session.prompt({ path:{id}, body:{ parts, model? } }) -> { data:{ info, parts }, error? }
//   client.session.abort({ path:{id} })                  -> { data:{ aborted }, error? }
//   client.session.messages({ path:{id} })               -> { data: AssistantMessage[], error? }
//
// Deterministic control surface (no real sleeps, no real network):
//   - setResponder(fn): decide each prompt's fate from its context. A reply resolves
//     with text; `pending` PARKS the prompt (the test releases it, so concurrency and
//     wave barriers are observable); `hang` never resolves (drives the watchdog under
//     mock timers); `error` resolves with an SDK error envelope.
//   - resolvePending / resolveAllPending: release parked prompts on demand.
//   - calls / creates / prompts / aborts / messagesCalls / pending: the recorded log.
//
// Registry-ordering witness: the fixture is handed the SAME session registry the
// engine writes, and on EVERY prompt it records whether the session was already
// registered (`registeredAtStart`) plus a snapshot of the entry. That is how a test
// pins §3.5's rule that the registry entry exists BEFORE the first prompt is sent —
// a sub-session must never be able to make a tool call while unregistered.

// The result envelope the generated hey-api client returns ({ data?, error? }).
export interface SdkEnvelope<T> {
  data?: T;
  error?: unknown;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface AssistantMessage {
  info: { sessionID?: string; finish?: string; modelID?: string; providerID?: string };
  parts: TextPart[];
}

export interface CreateOptions {
  body?: { title?: string; parentID?: string; agent?: string };
}
export interface PromptOptions {
  path: { id: string };
  body: Record<string, unknown>;
}
export interface AbortOptions {
  path: { id: string };
}
export interface MessagesOptions {
  path: { id: string };
}

// The subset of the SDK client the engine drives. Structurally assignable to the
// engine's `FanoutClient` param — the test's `createFanout(sdk.client, …)` call site
// is where tsc checks the two agree.
export interface FakeClient {
  session: {
    create(opts?: CreateOptions): Promise<SdkEnvelope<{ id: string }>>;
    prompt(opts: PromptOptions): Promise<SdkEnvelope<AssistantMessage>>;
    abort(opts: AbortOptions): Promise<SdkEnvelope<{ aborted: boolean }>>;
    messages(opts: MessagesOptions): Promise<SdkEnvelope<AssistantMessage[]>>;
  };
}

// A loose view of the session registry (§3.5: sessionID -> {role,itemId,tree}). A
// plain Map<string, …> satisfies this; the engine writes it and the fixture reads it.
export interface RegistryEntryLike {
  role?: string;
  itemId?: string;
  tree?: string;
}
export interface RegistryLike {
  has(sessionID: string): boolean;
  get(sessionID: string): RegistryEntryLike | undefined;
}

export type FakeMethod = "create" | "prompt" | "abort" | "messages";

// One row of the ordered call log — the record every ordering assertion reads.
export interface FakeCall {
  seq: number;
  method: FakeMethod;
  sessionID?: string;
  body?: unknown;
}

// The detailed record kept for every prompt() invocation.
export interface PromptRecord {
  seq: number;
  sessionID: string;
  // 1-based attempt number for THIS session (1 = initial, 2 = first retry, …).
  attempt: number;
  // The composed prompt text (all text parts joined) — the engine's prompt-shaped
  // instruction; retries must carry the appended validation errors.
  text: string;
  // The resolved model the engine put on the prompt body (drives wave grouping).
  model: string | undefined;
  // Task 0.2 DRIFT witness: true iff the engine (wrongly) set a `format` body field.
  hasFormatField: boolean;
  // §3.5 witness: was the session in the registry at the instant prompt() was entered?
  registeredAtStart: boolean;
  // Snapshot of the registry entry at prompt entry (cloned so later cleanup can't
  // retro-edit it).
  entryAtStart: RegistryEntryLike | undefined;
  body: Record<string, unknown>;
}

// The instruction a responder returns for a single prompt.
export type PromptReply =
  | { kind: "reply"; text: string } // resolve now with this assistant text
  | { kind: "error"; error: unknown } // resolve now with an SDK error envelope
  | { kind: "pending" } // park; the test releases it later
  | { kind: "hang" }; // never resolves (watchdog fodder)

// The instruction a create-responder returns for a single session.create call. It
// mirrors the prompt-hang mechanism (Task F1): `hang` makes create NEVER settle, so a
// test can prove the per-job watchdog bounds the create phase — not just the prompt
// phase — and that a hung create can never leave its wave hanging. The default is
// `created` (resolve with the freshly-minted id), which is what every existing test sees.
export type CreateReply =
  | { kind: "created" } // resolve now with the generated { id }
  | { kind: "error"; error: unknown } // resolve now with an SDK error envelope (no id)
  | { kind: "hang" }; // never resolves — the engine's watchdog must bound create

// The context a create-responder sees for each session.create.
export interface CreateReqContext {
  // The id that WOULD be assigned to this session (recorded whatever the responder does).
  sessionID: string;
  // 1-based ordinal of this create across the fake's lifetime.
  createCount: number;
  body: { title?: string; parentID?: string; agent?: string } | undefined;
}

export type CreateResponder = (req: CreateReqContext) => CreateReply;

// The context a responder sees for each prompt.
export interface PromptReqContext {
  sessionID: string;
  attempt: number;
  text: string;
  model: string | undefined;
  entry: RegistryEntryLike | undefined;
  body: Record<string, unknown>;
}

export type PromptResponder = (req: PromptReqContext) => PromptReply;

// A parked (pending) prompt the test can release.
export interface PendingPrompt {
  sessionID: string;
  attempt: number;
  settle: (reply: PromptReply) => void;
}

export interface FakeSdk {
  client: FakeClient;
  calls: FakeCall[];
  creates: string[];
  prompts: PromptRecord[];
  aborts: string[];
  messagesCalls: string[];
  pending: PendingPrompt[];
  setResponder(responder: PromptResponder): void;
  setCreateResponder(responder: CreateResponder): void;
  resolvePending(sessionID: string, reply: PromptReply): void;
  resolveAllPending(reply: PromptReply): void;
  inFlightCount(): number;
  promptsFor(sessionID: string): PromptRecord[];
}

function extractText(body: Record<string, unknown>): string {
  const parts = body["parts"];
  if (!Array.isArray(parts)) return "";
  const out: string[] = [];
  for (const part of parts) {
    const p = part as { type?: unknown; text?: unknown };
    if (p.type === "text" && typeof p.text === "string") out.push(p.text);
  }
  return out.join("\n");
}

function extractModel(body: Record<string, unknown>): string | undefined {
  const model = body["model"];
  if (typeof model === "string") return model;
  if (model !== null && typeof model === "object") {
    const modelID = (model as { modelID?: unknown }).modelID;
    if (typeof modelID === "string") return modelID;
  }
  return undefined;
}

function cloneEntry(entry: RegistryEntryLike | undefined): RegistryEntryLike | undefined {
  if (entry === undefined) return undefined;
  return { role: entry.role, itemId: entry.itemId, tree: entry.tree };
}

function assistantEnvelope(sessionID: string, text: string): SdkEnvelope<AssistantMessage> {
  return {
    data: {
      info: { sessionID, finish: "stop" },
      parts: [{ type: "text", text }],
    },
  };
}

export function makeFakeSdk(opts: { registry: RegistryLike; idPrefix?: string }): FakeSdk {
  const { registry } = opts;
  const idPrefix = opts.idPrefix ?? "ses_fake_";

  const calls: FakeCall[] = [];
  const creates: string[] = [];
  const prompts: PromptRecord[] = [];
  const aborts: string[] = [];
  const messagesCalls: string[] = [];
  const pending: PendingPrompt[] = [];

  // Default: park everything. Every test sets a responder explicitly, so a missing
  // one never silently auto-completes a prompt and hides a scheduling bug.
  let responder: PromptResponder = () => ({ kind: "pending" });
  // Default: create succeeds immediately. A test opts into a hanging/erroring create
  // (Task F1) via setCreateResponder — the create-phase analogue of the prompt hang.
  let createResponder: CreateResponder = () => ({ kind: "created" });

  let seq = 0;
  let createCount = 0;

  const client: FakeClient = {
    session: {
      create(createOpts?: CreateOptions): Promise<SdkEnvelope<{ id: string }>> {
        createCount += 1;
        const id = `${idPrefix}${createCount}`;
        seq += 1;
        calls.push({ seq, method: "create", sessionID: id, body: createOpts?.body });
        const decision = createResponder({ sessionID: id, createCount, body: createOpts?.body });
        if (decision.kind === "hang") {
          // Never settles — the engine's per-job watchdog must bound the create phase
          // (F1). The id is deliberately NOT pushed to `creates`: the engine never
          // receives it, so from its view no session exists to register or abort.
          return new Promise<SdkEnvelope<{ id: string }>>(() => {});
        }
        if (decision.kind === "error") {
          // Resolve with an error envelope carrying no id — the engine's
          // session-create-failed path. No id reached the engine, so none is recorded.
          return Promise.resolve({ error: decision.error });
        }
        creates.push(id);
        return Promise.resolve({ data: { id } });
      },

      prompt(promptOpts: PromptOptions): Promise<SdkEnvelope<AssistantMessage>> {
        const sessionID = promptOpts.path.id;
        const body = promptOpts.body;
        const text = extractText(body);
        const model = extractModel(body);
        const attempt = prompts.filter((p) => p.sessionID === sessionID).length + 1;
        const entryAtStart = cloneEntry(registry.get(sessionID));
        seq += 1;
        const record: PromptRecord = {
          seq,
          sessionID,
          attempt,
          text,
          model,
          hasFormatField: Object.hasOwn(body, "format"),
          registeredAtStart: registry.has(sessionID),
          entryAtStart,
          body,
        };
        prompts.push(record);
        calls.push({ seq, method: "prompt", sessionID, body });

        const reply = responder({ sessionID, attempt, text, model, entry: entryAtStart, body });
        if (reply.kind === "reply") {
          return Promise.resolve(assistantEnvelope(sessionID, reply.text));
        }
        if (reply.kind === "error") {
          return Promise.resolve({ error: reply.error });
        }
        if (reply.kind === "hang") {
          // A promise that never settles — the engine's watchdog must abort it.
          return new Promise<SdkEnvelope<AssistantMessage>>(() => {});
        }
        // "pending": park it; the test decides when (and how) it resolves.
        return new Promise<SdkEnvelope<AssistantMessage>>((resolvePromise) => {
          const entry: PendingPrompt = {
            sessionID,
            attempt,
            settle: (settleReply: PromptReply) => {
              if (settleReply.kind === "reply") {
                resolvePromise(assistantEnvelope(sessionID, settleReply.text));
              } else if (settleReply.kind === "error") {
                resolvePromise({ error: settleReply.error });
              }
              // "pending"/"hang" as a settle instruction is a no-op (stays parked).
            },
          };
          pending.push(entry);
        });
      },

      async abort(abortOpts: AbortOptions): Promise<SdkEnvelope<{ aborted: boolean }>> {
        const sessionID = abortOpts.path.id;
        seq += 1;
        calls.push({ seq, method: "abort", sessionID });
        aborts.push(sessionID);
        return { data: { aborted: true } };
      },

      async messages(messagesOpts: MessagesOptions): Promise<SdkEnvelope<AssistantMessage[]>> {
        const sessionID = messagesOpts.path.id;
        seq += 1;
        calls.push({ seq, method: "messages", sessionID });
        messagesCalls.push(sessionID);
        const transcript: AssistantMessage[] = prompts
          .filter((p) => p.sessionID === sessionID)
          .map((p) => ({ info: { sessionID }, parts: [{ type: "text", text: p.text }] }));
        return { data: transcript };
      },
    },
  };

  function takePending(sessionID: string): PendingPrompt | undefined {
    const idx = pending.findIndex((p) => p.sessionID === sessionID);
    if (idx === -1) return undefined;
    const [entry] = pending.splice(idx, 1);
    return entry;
  }

  return {
    client,
    calls,
    creates,
    prompts,
    aborts,
    messagesCalls,
    pending,
    setResponder(next: PromptResponder): void {
      responder = next;
    },
    setCreateResponder(next: CreateResponder): void {
      createResponder = next;
    },
    resolvePending(sessionID: string, reply: PromptReply): void {
      const entry = takePending(sessionID);
      if (entry === undefined) {
        throw new Error(`fake-sdk: no pending prompt to resolve for session "${sessionID}"`);
      }
      entry.settle(reply);
    },
    resolveAllPending(reply: PromptReply): void {
      const drained = pending.splice(0, pending.length);
      for (const entry of drained) entry.settle(reply);
    },
    inFlightCount(): number {
      return pending.length;
    },
    promptsFor(sessionID: string): PromptRecord[] {
      return prompts.filter((p) => p.sessionID === sessionID);
    },
  };
}
