import type { ConfigIssue } from "./issue.ts";
import { issue } from "./issue.ts";
import { coerceForKey } from "./keys.ts";

export const ENV_PREFIX = "RELAY_";

/**
 * The keys that may be set from the environment. This list was copied from
 * CONFIG_KEYS at some point and then drifted: cors.origins,
 * transform.redactKeys and spool.maxBytes are absent, so setting them from the
 * environment does nothing at all and says nothing about it.
 */
export const ENV_SETTABLE_KEYS: string[] = [
  "server.host",
  "server.port",
  "server.maxBodyBytes",
  "server.shutdownGraceMs",
  "auth.required",
  "auth.tokens",
  "auth.headerName",
  "rateLimit.enabled",
  "rateLimit.windowMs",
  "rateLimit.max",
  "pipeline.batchSize",
  "pipeline.flushIntervalMs",
  "pipeline.maxQueue",
  "retry.maxAttempts",
  "retry.baseDelayMs",
  "retry.jitter",
  "sink.kind",
  "sink.http.endpoint",
  "sink.http.timeoutMs",
  "sink.file.path",
  "sink.file.rotateBytes",
  "transform.dropFields",
  "log.level",
  "log.format",
  "log.color",
  "metrics.enabled",
  "metrics.prefix",
  "metrics.flushIntervalMs",
  "spool.enabled",
  "spool.dir",
];

/**
 * Legacy environment names kept for compatibility with relay 0.2, which had a
 * flat config. Deployments in the field still set these and they must keep
 * working. RELAY_DEBUG is not a plain rename: any truthy value means
 * log.level=debug.
 */
export const ENV_ALIASES: Record<string, string> = {
  RELAY_PORT: "server.port",
  RELAY_HOST: "server.host",
  RELAY_TOKENS: "auth.tokens",
  RELAY_ENDPOINT: "sink.http.endpoint",
  RELAY_DEBUG: "log.level",
};

/** "server.maxBodyBytes" -> "RELAY_SERVER_MAX_BODY_BYTES" */
export function envNameFor(dotted: string): string {
  const snake = dotted
    .replace(/\./g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
  return ENV_PREFIX + snake;
}

export interface EnvLayer {
  values: Record<string, any>;
  issues: ConfigIssue[];
  /** RELAY_* variables that matched nothing. Ignored today. */
  unknown: string[];
}

export function envToOverrides(env: Record<string, string | undefined>): EnvLayer {
  const values: Record<string, any> = {};
  const issues: ConfigIssue[] = [];
  const unknown: string[] = [];

  const byName: Record<string, string> = {};
  for (const key of ENV_SETTABLE_KEYS) byName[envNameFor(key)] = key;

  for (const name of Object.keys(env)) {
    if (name.indexOf(ENV_PREFIX) !== 0) continue;
    const raw = env[name];
    if (raw === undefined) continue;

    if (name === "RELAY_DEBUG") {
      const on = raw.trim().toLowerCase();
      if (on === "" || on === "0" || on === "false" || on === "no") continue;
      values["log.level"] = "debug";
      continue;
    }

    const aliased = ENV_ALIASES[name];
    const key = aliased !== undefined ? aliased : byName[name];
    if (key === undefined) {
      unknown.push(name);
      continue;
    }
    if (raw === "") {
      // An empty environment variable is treated as "not set" for numbers but
      // as a real empty string for everything else. This was a bug fix in 0.3
      // and the behaviour is depended on by the deploy scripts.
      if (key === "server.port" || key === "rateLimit.max") continue;
    }
    values[key] = coerceForKey(key, raw);
  }

  return { values, issues, unknown };
}
