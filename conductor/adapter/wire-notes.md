# Wire-contract notes — Task 0.2

Verified against the installed binary on 2026-08-12 by
`conductor/tests/wire-contract.test.ts` (fixtures under `conductor/tests/fixtures/`).
Every line below is asserted by that test unless tagged **[observed]** — that tag
marks behaviour genuinely observed during live probing that NO test currently pins,
so an upstream regression there would be invisible to the suite (phase-0 gate
finding; the tags are the honest record G6 requires). "Green" here means the test
passes with RECORDED reality.

**Binary reality first:** the installed binary is **opencode 1.18.15** at
`/opt/homebrew/bin/opencode` (plan §5 was written against 1.18.10; the pinned
`@opencode-ai/plugin` / `@opencode-ai/sdk` dev-dependencies are 1.18.10). Where
the 1.18.10 SDK types and the 1.18.15 runtime disagree, the runtime won and is
what the test pins.

## Verified points

- WIRE_CONTRACT_VERIFIED: 2026-08-12 `opencode serve --port <n> --print-logs` starts headless and prints `opencode server listening on http://127.0.0.1:<n>` (streams merged in the harness; stderr attribution **[observed]**); readiness is `GET /config` returning 200. NOTE **[observed]** `--port 0` does NOT allocate an ephemeral port — it lands on the default 4096 — so tests must pick and pass a concrete free port (never 8080, reserved for llama-server).
- WIRE_CONTRACT_VERIFIED: 2026-08-12 hermetic serve = env `OPENCODE_CONFIG=<abs config>` + `XDG_CONFIG_HOME=<tmp>` (redirects the global `~/.config/opencode` lookup) + `OPENCODE_TEST_HOME=<tmp>` (overrides homedir). **[observed]** `OPENCODE_TEST_HOME` alone does NOT redirect the global config dir.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 §5.1 plugin loading: a config-listed ABSOLUTE FILE PATH in `"plugin": [...]` loads on 1.18.15 (surfaced as a `file://` URL in `GET /config`). The §5.1 symlink fallback is NOT needed. Plugins load lazily at instance bootstrap (first request carrying `?directory=`), not at serve start.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 **[observed]** **plugin modules may export ONLY plugin functions** (or `{server}` modules). Any other export (a constant, a string) makes the loader throw `TypeError("Plugin export is not a function")` and the WHOLE plugin is skipped with a logged ERROR while the session continues ungated. `conductor/plugin/index.ts` must therefore export exactly its factory; shared constants go in sibling modules (see `tests/fixtures/wire-markers.ts`).
- WIRE_CONTRACT_VERIFIED: 2026-08-12 plugin factory input carries `project`, `client`, `directory`, `worktree`, `serverUrl`, `$` as §5.1 says (plus `experimental_workspace`); bare specifier `@opencode-ai/plugin` resolves from the plugin file's own node_modules walk (conductor/node_modules), even under full XDG isolation.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 §5.1 hook names all fire on 1.18.15: `tool`, `tool.execute.before`, `tool.execute.after`, `chat.message`, `chat.params`, `chat.headers`, `event`, `experimental.chat.system.transform` (coverage-asserted in one sweep at the end of the suite).
- WIRE_CONTRACT_VERIFIED: 2026-08-12 deny mechanics: a throw inside `tool.execute.before` denies the call; the tool part in the transcript gets `state.status="error"` with `state.error` = the thrown message, and the same text goes back to the model as the tool-result content. Gate reasons ride the Error message, exactly as §5.4 row 2 says.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 custom tools under the `tool` hook key (`tool({description, args: tool.schema…, execute})`) register (visible in `GET /experimental/tool/ids` and in the provider-request `tools` array) and execute (result string becomes the tool part output).
- WIRE_CONTRACT_VERIFIED: 2026-08-12 `chat.headers` output DOES reach the provider as HTTP request headers (stub observed `x-conductor-probe: wire-0-2`). The x_conductor body fallback is NOT needed — but it was pinned anyway: a key set on `chat.params` `output.options` lands as a TOP-LEVEL provider-body field (observed `"x_conductor":"params-fallback-probe"` in the JSON body), so the §4.4 tag fallback is real if headers ever regress.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 `experimental.chat.system.transform` works: a string pushed onto `output.system` arrives as its own `role:"system"` message in the provider request body.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 `session.idle` fires on the event bus (plugin `event` hook) after the reply completes, with `properties.sessionID`.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 model override in the prompt body (`model:{providerID,modelID}`) reaches the provider: stub saw `"model":"stub-model-b"` and the assistant info echoed `modelID:"stub-model-b"`.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 `{file:<absolute path>}` in an agent `prompt` config resolves and the file content becomes the agent's system message (it REPLACES opencode's default system prompt). serve.py's inline fallback is NOT needed. CAUTION **[observed]**: opencode scans EVERY config string for brace-file references — a literal `{file:...}` inside e.g. a description is resolved too, and a dangling one is a hard `ConfigInvalidError` (config endpoint returns 400 and no session can start).
- WIRE_CONTRACT_VERIFIED: 2026-08-12 the typed `permission.ask` plugin hook is NOT dispatched at 1.18.15 (0 dispatches across two full permission flows; the suite asserts the count so an upstream fix trips it).
- WIRE_CONTRACT_VERIFIED: 2026-08-12 the `permission.asked` bus event DOES fire (plan §5.1 is right; the pinned 1.18.10 SDK *types* are stale — they only declare `permission.updated`/`permission.replied`). Live payload: `properties = {id: "per_…", sessionID, permission: "edit", patterns: [...], metadata: {...}}`. `permission.replied` also fires after adjudication.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 permission adjudication endpoint: `POST /session/{id}/permissions/{permissionID}` with body `{response: "once"|"always"|"reject"}` returns `true`. `"once"` lets the tool run (edit executed, file changed); `"reject"` denies it (tool part errors with "The user rejected permission to use this specific tool call.", file untouched). This is the §3.6 inline-claim mechanism, proven end-to-end against an agent-level `edit:"ask"`.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 **[observed]** session directories are canonicalized: macOS `/var/...` tmp paths become `/private/var/...` in opencode. A NON-canonical directory makes in-project edits ask for `external_directory` instead of `edit` — serve.py and the adapter must realpath every directory they hand opencode.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 **[observed]** the edit tool validates its arguments against the file BEFORE asking permission (a non-matching oldString fails with no ask ever raised) — ask-gate tests must stage files first.
- WIRE_CONTRACT_VERIFIED: 2026-08-12 provider plumbing: `npm:"@ai-sdk/openai-compatible"` + `options.baseURL` POSTs `{baseURL}/chat/completions`; built-in tool names offered to the model at 1.18.15: `bash, edit, glob, grep, read, skill, task, todowrite, webfetch, write` (+ registered plugin tools; `question`, `invalid`, `websearch`, `apply_patch` also exist in the tool registry).

## DRIFT (§5 claims that failed against the binary; no plan-named fallback)

- **DRIFT — prompt `format:{type:"json_schema"}` does not exist at 1.18.15.**
  §5.2's `format?:{type:"json_schema", schema}` prompt-body field is not in the
  server's schema (the generated SDK types have no `format` key), and the live
  probe shows it is accepted silently and produces NEITHER `response_format`
  NOR `json_schema` in the provider request — no schema'd body field is emitted
  at all, so the "record WHICH field" question is answered: **neither**. The
  bundled ai-sdk provider *can* emit
  `response_format:{type:"json_schema", json_schema:{schema, strict, name}}`,
  but opencode's prompt path never invokes it. The test pins the absence so an
  upstream fix is noticed. Consequence for the plan: structured outputs must be
  prompt-shaped and independently validated by the fan-out engine (G5 already
  requires the validation half); any Phase design leaning on `format` must be
  re-scoped to "instruction + independent schema validation, retry on parse
  failure".
- **DRIFT — `client.permission.reply({requestID, reply})` is not the 1.18.15
  surface.** The working call is
  `POST /session/{id}/permissions/{permissionID}` `{response}` (generated SDK
  method `client.postSessionIdPermissionsPermissionId({path:{id, permissionID},
  body:{response}})`). Field names differ (`permissionID`/`response`, not
  `requestID`/`reply`) and the session id is required in the path. The
  MECHANISM §3.5/§3.6 depend on is fully verified (see above); only the named
  method shape drifted. Adapter constants must use the path+body shape.

## The four discoveries (each scopes a later phase)

- **DISCOVERY (i) — streaming (scopes Task 11.6 / §4.4):**
  WIRE_CONTRACT_VERIFIED: 2026-08-12 `session.prompt` issues a **STREAMING**
  provider request: body `stream: true` with
  `stream_options: {include_usage: true}`, and the reply is consumed as SSE
  `chat.completion.chunk` events (terminated by `data: [DONE]`). llama-router's
  response observation WILL see streaming responses and must parse SSE, not a
  single JSON body.
- **DISCOVERY (ii) — plugin-init failure (scopes §3.8 beacon loudness):**
  WIRE_CONTRACT_VERIFIED: 2026-08-12 a plugin whose factory throws is **logged
  and skipped — sessions continue completely ungated**. Observed: one
  `level=ERROR message="failed to load plugin" … error=<thrown message>` line
  on the serve log, then session create and prompt proceed (tool use **[observed]** only) — all
  normally with zero hooks installed and no API-visible refusal or banner. The
  same log-and-continue applies to module-load failures (bad exports). §3.8's
  liveness beacon must therefore be LOUD and out-of-band: nothing in the
  session itself betrays that the gates are absent.
- **DISCOVERY (iii) — per-agent spawn-tool denial (scopes the §5.3 fragment):**
  WIRE_CONTRACT_VERIFIED: 2026-08-12 the exact config key is
  `agent.<name>.tools: {"task": false}` (the built-in spawn tool's id is
  `task`; args `description`, `prompt`, `subagent_type`, `task_id`). Effect:
  `task` is omitted from the tools offered to that agent's model, and a forced
  call is redirected to the built-in `invalid` tool — transcript shows
  `tool:"invalid"` with `state.input.tool="task"` and output "Model tried to
  call unavailable tool 'task'…". Control run: the same call from an
  unrestricted agent spawns a real child session (child's `parentID` = the
  spawning session). The fragment's per-agent denial must use `tools`, and the
  registry gate stays as the second layer.
- **DISCOVERY (iv) — session `parentID` / id shapes (scopes the registry gate):**
  WIRE_CONTRACT_VERIFIED: 2026-08-12 `parentID` IS accepted on
  `session.create` (both via the HTTP API and via the client handed to the
  plugin) and is echoed on the session and by `/session/{id}/children`.
  Plugin-created sessions have the IDENTICAL `ses_…` id shape as any other
  session — there is NO distinguishable id shape — and tool-call ids
  (`callID`) are minted by the PROVIDER (the stub's `call_stub_*` ids came
  back verbatim), so they carry no opencode-side signal either. The registry
  gate (§3.5) cannot lean on id shape and must key on its own
  sessionID→role/item registry, exactly as planned.

## Assertion-coverage notes (minor gaps, recorded at the Phase 0 gate)

The suite asserts these points loosely; tighten opportunistically if regressions bite:
- {file:...} test asserts the file content appears as a system message; it does not
  assert the DEFAULT system prompt is absent (append would also pass).
- permission responses: only "once" and "reject" are exercised; "always" never sent.
- permission.asked payload: id/sessionID/permission asserted; patterns/metadata not.
- plugin path in GET /config matched by endsWith; the file:// URL shape and the
  lazy-load timing are not pinned.
- built-in tool list: membership/absence of specific names asserted, never the full list.
- parentID: create-response echo asserted for API-created sessions; /children echo
  asserted only for the task-tool-spawned child.
- log lines matched by substring ("failed to load plugin", /reject/i), not exact
  level/text.

---

## Phase 20 additions — measured 2026-08-20 against the same binary (1.18.15)

Same rule as above: every line is asserted by `conductor/tests/wire-contract.test.ts`
unless tagged **[observed]**. These close the assertion-coverage gaps named at the end
of the previous section and answer the questions Phases 21 and 22B are gated on.

### 20.1 The complete offered tool set (was: membership only)

- WIRE_CONTRACT_VERIFIED: 2026-08-20 the FULL set of tool names offered to the model at
  1.18.15, asserted by `deepEqual` rather than by membership, is exactly:
  `bash, edit, glob, grep, read, skill, task, todowrite, webfetch, write` plus every
  plugin-registered tool (the fixture's `conductor_probe`). `question`, `invalid`,
  `websearch` and `apply_patch` remain registry-only and are NOT offered.
  The pin lives at `OFFERED_BUILTIN_TOOLS` / `OFFERED_TOOL_SET` in the test; a tool
  appearing or disappearing on an opencode bump is now a red test naming the tool,
  not a silent hole.

### 20.2 Default permission posture per built-in

- WIRE_CONTRACT_VERIFIED: 2026-08-20 every resolved agent — native and config-defined,
  `mode: primary` and `mode: subagent` — begins its permission ruleset with
  `{permission: "*", pattern: "*", action: "allow"}` and then narrows. Rules are
  **last-match-wins**. The complete base narrowing set is:
  `doom_loop * -> ask`, `external_directory * -> ask` (with allow carve-outs for the
  tool-output dir and the opencode temp dir), `question * -> deny`,
  `plan_enter * -> deny`, `plan_exit * -> deny`, `read * -> allow`,
  `read *.env -> ask`, `read *.env.* -> ask`, `read *.env.example -> allow`.
- WIRE_CONTRACT_VERIFIED: 2026-08-20 **`webfetch` carries no narrowing in any agent kind**,
  so it resolves to `allow` and raises no `permission.asked`. A live probe drove a
  `webfetch` call from a bare `mode: subagent` agent (no `permission` key, no `prompt`
  key) against a loopback URL: the tool completed, the page body reached the tool
  result, and the `permission.asked` count did not move. **The network surface is open
  by default in a sub-session and conductor's own auto-reject default never sees it,
  because opencode never asks.** Task 21.4 is therefore load-bearing, not redundant.
- WIRE_CONTRACT_VERIFIED: 2026-08-20 a config agent carrying `tools: {"task": false}`
  resolves with an additional `task * -> deny` permission rule **on top of** the tool
  being omitted from the offered set — two layers, not one (DISCOVERY (iii) recorded
  only the offered-set half).
- **[observed]** the resolved-agent view is `GET /agent?directory=<dir>`, and the `Agent`
  schema makes `permission` a required field, so the ruleset is always readable without
  driving a prompt.

### 20.3 Fan-out sub-sessions select their role's agent

- `conductor/adapter/fanout.ts` creates every sub-session with
  `client.session.create({ body: { title, parentID, agent } })`, where `agent` is
  `ROLE_AGENT[job.role]` — the names `conductor/opencode-fragment.json` declares. **The six
  subagent blocks are therefore in force for the sessions that do the work**, including
  their `"edit": "deny"` and `tools: {"task": false}` rows.
- Measured from the binary in the 13.2 live smoke, run `r-20260821-c82b`, reading opencode's
  own `session` table after a plan-review fan-out:

  ```
  {"id": "ses_fdd723764ffeV26O6uhnL1gEY0", "parent_id": null, "agent": "conductor-orchestrator"}
  {"id": "ses_fdd70ac05ffedmwDnDF0fQpor3", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "agent": "conductor-planner"}
  {"id": "ses_fdd62784fffe6CiLpepzyPdeR0", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "agent": "conductor-reviewer"}
  ```

- A wrong agent name is silent (opencode accepts an unknown agent with 200 and echoes it),
  which is why `conductor/tests/fragment.test.ts` pins `ROLE_AGENT`'s values to the fragment.
  Enforcement does not rest on the agent either way: conductor's registry and edit gates bind
  on the session registry.

### 20.4 Side-effect class per offered tool (§2 of the read-only capability plan)

| Tool | Class | Note |
|---|---|---|
| `read` | R0 | pure repo-local read |
| `grep` | R0 | pure repo-local read |
| `glob` | R0 | pure repo-local read |
| `todowrite` | R0 | writes session-local todo state, never the tree |
| `skill` | R0 | loads instruction text; reaches no tree and no network |
| `bash` | polymorphic | adjudicated per command by extractor, never by name: `ls` R0, a checker R1, `man` R2, `curl` R3, `sed -i` W |
| `webfetch` | R3 | network read; allow-by-default per 20.2 |
| `websearch` | R3 | registry-only at 1.18.15, so not reachable — classified so it cannot arrive unclassified |
| `edit` | W | single `args.filePath`, adjudicated by the edit-scope gate |
| `write` | W | single `args.filePath`, adjudicated by the edit-scope gate |
| `patch` | X | structurally unboundable; refused ahead of every gate |
| `apply_patch` | X | structurally unboundable; refused ahead of every gate |
| `task` | S | session-spawning; denied in every session |
| `question` | — | registry-only; opencode's own ask surface, not a conductor lane |
| `invalid` | — | opencode's redirect target for an unavailable tool |

### 20.5 Banner delivery seam

Four candidates were probed. Only one puts plugin-authored text in front of an operator.

- WIRE_CONTRACT_VERIFIED: 2026-08-20 **appending a part to `output.parts` inside the
  `chat.message` hook delivers nothing.** `output.parts` is `Part[]`, not
  `TextPartInput[]`: a bare `{type, text}` fails the whole prompt with an HTTP 500
  (`UnknownError`), and a fully-shaped `Part` (`id`, `sessionID`, `messageID`) is
  accepted and then has no effect — the appended text reaches neither the persisted
  transcript nor the provider request. opencode builds both from its own part records.
- WIRE_CONTRACT_VERIFIED: 2026-08-20 **`tool.execute.after` CAN decorate a result it did
  not produce**, and the decoration reaches the persisted tool part. This is the one
  measured channel for operator-visible plugin text. Its cost is that it fires only when
  a tool runs, so a banner riding it is conditional on the session making at least one
  tool call.
- WIRE_CONTRACT_VERIFIED: 2026-08-20 `client.tui.showToast` (`POST /tui/show-toast`,
  body `{title?, message, variant: info|success|warning|error, duration?}`) is callable
  from a plugin and answers success under headless `opencode serve` **with no TUI
  attached**. A 200 therefore proves reachability, never visibility. **[observed]** the
  bench drives `opencode run`, which has no TUI, so a toast is inert there.
- A plugin tool's own return string is visible (pinned by `0.2-custom-tool`), but is
  likewise tied to a call.

**Conclusion for Task 21.7: there is no unconditional user-visible text channel at
1.18.15.** The strongest available seam is `tool.execute.after` decoration of the
session's first tool result, and it must be described as conditional.

### 20.6 Agent-selected sub-sessions

- WIRE_CONTRACT_VERIFIED: 2026-08-20 **`POST /session` accepts `agent` and `parentID`
  together at 1.18.15**, echoes `parentID` on the created session, and lists the child
  under `GET /session/{id}/children`. The pinned 1.18.10 SDK types declare only
  `{parentID?, title?}` and are stale; the runtime schema also carries `agent`, `model`,
  `metadata`, `permission` and `workspaceID`. Task 21.1 can set both fields in one call.
  **[observed]** `permission` being settable per session at create is a governance lever
  no conductor code uses today.
- WIRE_CONTRACT_VERIFIED: 2026-08-20 a `mode: "subagent"` agent with **no `prompt` key**
  resolves with `prompt: ""` and receives opencode's own composed system prompt at
  request time — measured at 9,646 characters for the fixture's bare subagent.
- WIRE_CONTRACT_VERIFIED: 2026-08-20 **the `experimental.chat.system.transform` injection
  still lands on a session prompted with `agent:` set.** This is the load-bearing check
  for Task 21.1: doctrine rides that hook, and ISSUE-001 is what a silently-dead
  injection costs.
