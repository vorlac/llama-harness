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
