// Shared marker constants for the Task 0.2 wire-contract fixtures.
//
// These live in their own module because the opencode 1.18.15 plugin loader
// iterates EVERY export of a plugin file and throws
// `TypeError("Plugin export is not a function")` when any export is not a
// plugin function (verified against the installed binary on 2026-08-12) —
// so the recorder plugin must export its factory and nothing else.

/** Marker text thrown by tool.execute.before to prove deny-by-throw (§5.1). */
export const DENY_MARKER = "CONDUCTOR_DENY_MARKER: bash denied by wire-contract recorder";
/** Marker injected through experimental.chat.system.transform. */
export const SYSTEM_MARKER = "CONDUCTOR_SYSTEM_MARKER_73X";
/** Header name/value injected through chat.headers. */
export const PROBE_HEADER_NAME = "x-conductor-probe";
export const PROBE_HEADER_VALUE = "wire-0-2";
/** Vendor field pushed through chat.params options to probe the §5.1 body fallback. */
export const PARAMS_FALLBACK_FIELD = "x_conductor";
export const PARAMS_FALLBACK_VALUE = "params-fallback-probe";
/** Session title that triggers the plugin-side session.create probe (discovery iv). */
export const PLUGIN_SPAWN_TRIGGER_TITLE = "CONDUCTOR_PLUGIN_SPAWN_TRIGGER";
/** Thrown by the crashing plugin's factory (discovery ii). */
export const CRASH_MARKER = "CONDUCTOR_CRASHING_PLUGIN_MARKER";

// ---------------------------------------------------------------------------
// Phase 20 probe markers. Each drives one measurement in wire-contract.test.ts
// and nothing else: a marker only reaches the recorder when the probe that owns
// it is running, so the other suites see the plugin unchanged.
// ---------------------------------------------------------------------------

/** Session title that arms the chat.message appended-part banner probe (20.5). */
export const BANNER_PART_TRIGGER_TITLE = "CONDUCTOR_BANNER_PART_PROBE";
/** Text the recorder appends to output.parts inside chat.message (20.5). */
export const BANNER_PART_MARKER = "CONDUCTOR_BANNER_PART_MARKER_51K";
/** Session title that arms the client.tui.showToast banner probe (20.5). */
export const BANNER_TOAST_TRIGGER_TITLE = "CONDUCTOR_BANNER_TOAST_PROBE";
/** Message text handed to client.tui.showToast (20.5). */
export const BANNER_TOAST_MARKER = "CONDUCTOR_BANNER_TOAST_MARKER_51K";
/** Prefix the recorder prepends to a tool result inside tool.execute.after (20.5). */
export const BANNER_RESULT_MARKER = "CONDUCTOR_BANNER_RESULT_MARKER_51K";
/** bash command whose result the 20.5 tool-result banner probe decorates. */
export const BANNER_RESULT_TRIGGER = "conductor-banner-result-probe";
