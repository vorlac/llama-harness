// Wire-contract recorder plugin (Task 0.2 fixture). Loaded by `opencode serve`
// via a config-listed absolute file path; exports every hook §5.1 names and
// appends one JSONL record per hook firing to CONDUCTOR_RECORDER_FILE so the
// integration test can assert against observed reality.
//
// This file runs under opencode's Bun runtime; it uses only node:fs plus the
// objects opencode hands it (G1/G14 posture, same as the production plugin).
//
// NOTE: this module must export the plugin factory and NOTHING else — the
// 1.18.15 loader walks every export and throws when one is not a plugin
// function. Shared constants live in ./wire-markers.ts for that reason.
import { appendFileSync } from "node:fs";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  BANNER_PART_MARKER,
  BANNER_RESULT_MARKER,
  BANNER_RESULT_TRIGGER,
  BANNER_PART_TRIGGER_TITLE,
  BANNER_TOAST_MARKER,
  BANNER_TOAST_TRIGGER_TITLE,
  DENY_MARKER,
  PARAMS_FALLBACK_FIELD,
  PARAMS_FALLBACK_VALUE,
  PLUGIN_SPAWN_TRIGGER_TITLE,
  PROBE_HEADER_NAME,
  PROBE_HEADER_VALUE,
  SYSTEM_MARKER,
} from "./wire-markers.ts";

function recorderFile(): string {
  const p = process.env["CONDUCTOR_RECORDER_FILE"];
  if (p === undefined || p === "") {
    throw new Error("CONDUCTOR_RECORDER_FILE must be set for the wire-contract recorder plugin");
  }
  return p;
}

function record(kind: string, data: unknown): void {
  appendFileSync(recorderFile(), `${JSON.stringify({ kind, at: Date.now(), data })}\n`);
}

let pluginSessionCreated = false;

export const WireRecorder: Plugin = async (input) => {
  record("factory", {
    directory: input.directory,
    worktree: input.worktree,
    projectID: input.project.id,
    serverUrl: String(input.serverUrl),
    hasClient: typeof input.client === "object" && input.client !== null,
    hasShell: input.$ !== undefined,
  });

  return {
    tool: {
      conductor_probe: tool({
        description: "Wire-contract probe tool: records its execution and echoes the note.",
        args: { note: tool.schema.string().describe("echoed back in the tool result") },
        async execute(args, ctx) {
          record("custom-tool-executed", {
            note: args.note,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            agent: ctx.agent,
          });
          return `PROBE_OK:${args.note}`;
        },
      }),
    },

    "tool.execute.before": async (input, output) => {
      record("tool.execute.before", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        args: output.args as unknown,
      });
      const args = output.args as { command?: unknown } | undefined;
      const command = typeof args?.command === "string" ? args.command : "";
      if (input.tool === "bash" && command.includes("conductor-probe")) {
        throw new Error(DENY_MARKER);
      }
    },

    "tool.execute.after": async (input, output) => {
      record("tool.execute.after", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        title: output.title,
      });

      // Phase 20.5 — the tool-result banner seam. A result string is the one
      // channel already proven to render (0.2-custom-tool), so the question is
      // whether a hook can DECORATE a result it did not produce.
      const args = input.args as { command?: unknown } | undefined;
      if (input.tool === "bash" && typeof args?.command === "string" && args.command.includes(BANNER_RESULT_TRIGGER)) {
        output.output = `${BANNER_RESULT_MARKER}\n${output.output}`;
        record("banner-result-decorated", { sessionID: input.sessionID, callID: input.callID });
      }
    },

    // The hook parameter is named `hook` rather than `input` so the factory's
    // `input.client` stays reachable for the 20.5 toast probe below.
    "chat.message": async (hook, output) => {
      record("chat.message", {
        sessionID: hook.sessionID,
        agent: hook.agent,
        messageRole: output.message.role,
        partTypes: output.parts.map((p) => p.type),
      });

      // Phase 20.5 — banner-seam probes. Each fires only when the arriving prompt
      // carries its own trigger, so every other suite sees this hook unchanged.
      const promptText = output.parts
        .map((p) => (p.type === "text" ? ((p as { text?: unknown }).text ?? "") : ""))
        .join("\n");

      // Candidate A: append a text part to output.parts and see whether it
      // survives into the persisted transcript a human reads.
      if (promptText.includes(BANNER_PART_TRIGGER_TITLE)) {
        const before = output.parts.length;
        // `output.parts` is Part[], not TextPartInput[] — a Part carries id,
        // sessionID and messageID, and a bare {type,text} makes the prompt fail
        // 500. The append below is fully shaped, so what it measures is whether
        // the seam works at all rather than whether a malformed part is rejected.
        const template = output.parts.find((p) => p.type === "text");
        output.parts.push({
          ...(template ?? {}),
          id: `prt_conductor_banner_${String(before)}`,
          sessionID: hook.sessionID,
          messageID: output.message.id,
          type: "text",
          text: BANNER_PART_MARKER,
        } as (typeof output.parts)[number]);
        record("banner-part-appended", {
          sessionID: hook.sessionID,
          before,
          after: output.parts.length,
        });
      }

      // Candidate B: the TUI toast route. Recorded with its whole envelope so the
      // test can tell "the call succeeded" from "a human saw it".
      if (promptText.includes(BANNER_TOAST_TRIGGER_TITLE)) {
        try {
          const res = await input.client.tui.showToast({
            body: { title: "conductor", message: BANNER_TOAST_MARKER, variant: "info" },
          });
          record("banner-toast", {
            sessionID: hook.sessionID,
            data: res.data ?? null,
            error: res.error === undefined ? null : String(res.error),
            threw: false,
          });
        } catch (err) {
          record("banner-toast", {
            sessionID: hook.sessionID,
            data: null,
            error: err instanceof Error ? err.message : String(err),
            threw: true,
          });
        }
      }
    },

    "chat.params": async (input, output) => {
      record("chat.params", {
        sessionID: input.sessionID,
        agent: input.agent,
        modelID: input.model.id,
        temperature: output.temperature,
        topP: output.topP,
        optionKeys: Object.keys(output.options),
      });
      // Probe the §5.1 chat.headers fallback path: a vendor field pushed through
      // provider options. The test records whether it reaches the provider body.
      output.options[PARAMS_FALLBACK_FIELD] = PARAMS_FALLBACK_VALUE;
    },

    "chat.headers": async (input, output) => {
      record("chat.headers", {
        sessionID: input.sessionID,
        agent: input.agent,
        modelID: input.model.id,
        existingHeaderNames: Object.keys(output.headers),
      });
      output.headers[PROBE_HEADER_NAME] = PROBE_HEADER_VALUE;
    },

    "experimental.chat.system.transform": async (input, output) => {
      record("system.transform", {
        sessionID: input.sessionID,
        modelID: input.model.id,
        systemLength: output.system.length,
      });
      output.system.push(SYSTEM_MARKER);
    },

    "permission.ask": async (input, output) => {
      // §5.1 claims this typed hook is NOT dispatched by the runtime. Its mere
      // presence in the recorder file falsifies that claim, so record loudly.
      record("permission.ask-hook-dispatched", {
        id: input.id,
        type: input.type,
        sessionID: input.sessionID,
        status: output.status,
      });
    },

    event: async ({ event }) => {
      const properties = event.properties as Record<string, unknown> | undefined;
      record("event", { type: event.type, properties });

      // Discovery (iv): when the test creates a session with the trigger title,
      // create a child session from INSIDE the plugin via the handed client,
      // so the test can compare id shapes and tool-call id shapes.
      if (event.type === "session.created" && !pluginSessionCreated) {
        const info = (properties as { info?: { id?: string; title?: string } } | undefined)?.info;
        if (info?.title === PLUGIN_SPAWN_TRIGGER_TITLE && info.id !== undefined) {
          pluginSessionCreated = true;
          const created = await input.client.session.create({
            body: { title: "conductor-plugin-created-session", parentID: info.id },
          });
          record("plugin-created-session", {
            triggerSessionID: info.id,
            created: created.data ?? null,
            error: created.error ?? null,
          });
        }
      }
    },
  };
};
