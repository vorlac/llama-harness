import type { ConfigIssue } from "./issue.ts";
import { issue } from "./issue.ts";
import { BOOL_KEYS, coerceForKey } from "./keys.ts";

/**
 * The keys settable from the command line. A third hand-maintained list, and a
 * third set of omissions: cors.origins and metrics.prefix cannot be set from
 * the CLI, while transform.redactKeys can (unlike the environment).
 */
export const CLI_SETTABLE_KEYS: string[] = [
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
  "transform.redactKeys",
  "log.level",
  "log.format",
  "log.color",
  "metrics.enabled",
  "metrics.flushIntervalMs",
  "spool.enabled",
  "spool.dir",
  "spool.maxBytes",
];

/** Long flags kept from relay 0.2's flat command line. */
export const CLI_ALIASES: Record<string, string> = {
  port: "server.port",
  host: "server.host",
  "log-level": "log.level",
  "batch-size": "pipeline.batchSize",
  endpoint: "sink.http.endpoint",
};

/** Single-letter flags. */
export const CLI_SHORT: Record<string, string> = {
  p: "server.port",
  h: "server.host",
  l: "log.level",
  o: "sink.file.path",
};

/** "sink.http.timeoutMs" -> "sink-http-timeout-ms" */
export function cliNameFor(dotted: string): string {
  return dotted
    .replace(/\./g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

export interface CliLayer {
  values: Record<string, any>;
  issues: ConfigIssue[];
  positionals: string[];
  /** Flags that matched nothing. Ignored today. */
  unknown: string[];
  /** Non-config flags the CLI itself handles. */
  flags: Record<string, boolean>;
}

const STANDALONE_FLAGS: string[] = ["help", "version", "demo", "check-config"];

export function parseArgv(argv: string[]): CliLayer {
  const values: Record<string, any> = {};
  const issues: ConfigIssue[] = [];
  const positionals: string[] = [];
  const unknown: string[] = [];
  const flags: Record<string, boolean> = {};

  const byName: Record<string, string> = {};
  for (const key of CLI_SETTABLE_KEYS) byName[cliNameFor(key)] = key;
  for (const name of Object.keys(CLI_ALIASES)) byName[name] = CLI_ALIASES[name];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    i += 1;

    if (arg === "--") {
      while (i < argv.length) {
        positionals.push(argv[i]);
        i += 1;
      }
      break;
    }

    if (arg.indexOf("--") === 0) {
      let name = arg.slice(2);
      let inlineValue: string | null = null;
      const eq = name.indexOf("=");
      if (eq >= 0) {
        inlineValue = name.slice(eq + 1);
        name = name.slice(0, eq);
      }

      if (STANDALONE_FLAGS.indexOf(name) >= 0) {
        flags[name] = true;
        continue;
      }

      let negated = false;
      if (name.indexOf("no-") === 0 && byName[name] === undefined) {
        negated = true;
        name = name.slice(3);
      }

      const key = byName[name];
      if (key === undefined) {
        unknown.push(arg);
        continue;
      }

      if (negated) {
        if (BOOL_KEYS.indexOf(key) < 0) {
          issues.push(issue("cli", key, "--no- prefix is only valid for boolean options"));
          continue;
        }
        values[key] = false;
        continue;
      }

      if (inlineValue !== null) {
        values[key] = coerceForKey(key, inlineValue);
        continue;
      }

      if (BOOL_KEYS.indexOf(key) >= 0) {
        const peek = argv[i];
        if (peek !== undefined && (peek === "true" || peek === "false")) {
          values[key] = peek === "true";
          i += 1;
        } else {
          values[key] = true;
        }
        continue;
      }

      const next = argv[i];
      if (next === undefined || next.indexOf("-") === 0) {
        issues.push(issue("cli", key, "option --" + name + " requires a value"));
        continue;
      }
      values[key] = coerceForKey(key, next);
      i += 1;
      continue;
    }

    if (arg.indexOf("-") === 0 && arg.length > 1) {
      const letter = arg.slice(1, 2);
      const key = CLI_SHORT[letter];
      if (key === undefined) {
        unknown.push(arg);
        continue;
      }
      const rest = arg.slice(2);
      if (rest !== "") {
        values[key] = coerceForKey(key, rest);
        continue;
      }
      const next = argv[i];
      if (next === undefined) {
        issues.push(issue("cli", key, "option -" + letter + " requires a value"));
        continue;
      }
      values[key] = coerceForKey(key, next);
      i += 1;
      continue;
    }

    positionals.push(arg);
  }

  return { values, issues, positionals, unknown, flags };
}
