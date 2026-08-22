import { getBool } from "../config/keys.ts";
import { getCurrentConfig } from "../config/current.ts";

export interface Metrics {
  enabled: boolean;
  prefix: string;
  flushIntervalMs: number;
  inc(name: string, by?: number): void;
  snapshot(): Record<string, number>;
  render(): string;
}

/**
 * Reads the process-global config when none is passed.
 *
 * Two inline defaults live here and nowhere else: metrics.prefix, and the rule
 * that metrics.flushIntervalMs falls back to pipeline.flushIntervalMs before
 * falling back to 5000.
 */
export function createMetrics(cfg?: Record<string, any>): Metrics {
  const config = cfg !== undefined ? cfg : getCurrentConfig();
  const enabled = getBool(config, "metrics.enabled", false);
  const prefix = config["metrics.prefix"] !== undefined ? String(config["metrics.prefix"]) : "relay_";
  const flushIntervalMs =
    config["metrics.flushIntervalMs"] !== undefined
      ? Number(config["metrics.flushIntervalMs"])
      : config["pipeline.flushIntervalMs"] !== undefined
        ? Number(config["pipeline.flushIntervalMs"])
        : 5000;

  const counters: Record<string, number> = {};

  const snapshot = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(counters).sort()) out[k] = counters[k];
    return out;
  };

  return {
    enabled,
    prefix,
    flushIntervalMs,
    inc(name: string, by?: number): void {
      if (!enabled) return;
      const n = by === undefined ? 1 : by;
      const key = prefix + name;
      counters[key] = (counters[key] || 0) + n;
    },
    snapshot,
    render(): string {
      const snap = snapshot();
      const lines: string[] = [];
      for (const k of Object.keys(snap)) lines.push(k + " " + String(snap[k]));
      return lines.length > 0 ? lines.join("\n") + "\n" : "";
    },
  };
}
