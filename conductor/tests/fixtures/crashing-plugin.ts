// Wire-contract fixture (Task 0.2, discovery ii): a plugin whose factory throws.
// Loaded by a dedicated `opencode serve` run so the test can record what the
// runtime does with a plugin that fails at init (refuse sessions, or log and
// continue ungated) — the answer scopes §3.8's liveness beacon.
//
// Exports only the factory: the 1.18.15 loader rejects non-function exports.
import type { Plugin } from "@opencode-ai/plugin";
import { CRASH_MARKER } from "./wire-markers.ts";

export const CrashingPlugin: Plugin = async () => {
  throw new Error(CRASH_MARKER);
};
