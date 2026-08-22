import type { ConfigIssue } from "./issue.ts";
import { issue } from "./issue.ts";
import { DEFAULTS } from "./defaults.ts";
import { CONFIG_KEYS, LOG_LEVELS, SINK_KINDS } from "./keys.ts";
import { fileLayerFromObject, readConfigFile } from "./file.ts";
import { envToOverrides } from "./env.ts";
import { parseArgv } from "./cli.ts";

export interface LoadInput {
  /** Already-parsed config file contents. Nested or flat dotted keys. */
  file?: any;
  /** Path to a JSON config file. Ignored when `file` is given. */
  filePath?: string | null;
  /** Environment map. Not read from process.env implicitly. */
  env?: Record<string, string | undefined>;
  /** Argument vector, without argv[0]/argv[1]. */
  argv?: string[];
  /** Highest-precedence dotted-key overrides. Used by tests and by --set. */
  overrides?: Record<string, any>;
}

export interface LoadResult {
  /** The untyped bag every module indexes into. */
  config: Record<string, any>;
  /** key -> "cli" | "env" | "file" | "default" | "override" */
  sources: Record<string, string>;
  issues: ConfigIssue[];
  ok: boolean;
  /** Keys/flags/variables nobody claimed. Collected, never surfaced. */
  unknown: { file: string[]; env: string[]; cli: string[] };
  /** Non-config CLI flags: --help, --version, --demo, --check-config. */
  flags: Record<string, boolean>;
  positionals: string[];
}

const has = (obj: Record<string, any>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Precedence, lowest to highest: defaults, file, env, cli, overrides.
 *
 * The merge uses hasOwnProperty rather than truthiness so that an explicitly
 * configured 0, false or "" beats a lower layer. Getting that wrong is the
 * classic way this loader has been broken in the past.
 */
export function loadConfig(input: LoadInput = {}): LoadResult {
  const config: Record<string, any> = {};
  const sources: Record<string, string> = {};
  const issues: ConfigIssue[] = [];

  for (const key of Object.keys(DEFAULTS)) {
    config[key] = Array.isArray(DEFAULTS[key]) ? DEFAULTS[key].slice() : DEFAULTS[key];
    sources[key] = "default";
  }

  const fileLayer =
    input.file !== undefined && input.file !== null
      ? fileLayerFromObject(input.file, CONFIG_KEYS)
      : input.filePath
        ? readConfigFile(input.filePath, CONFIG_KEYS)
        : { values: {}, issues: [], unknown: [] };
  for (const i of fileLayer.issues) issues.push(i);
  for (const key of Object.keys(fileLayer.values)) {
    if (has(fileLayer.values, key)) {
      config[key] = fileLayer.values[key];
      sources[key] = "file";
    }
  }

  const envLayer = envToOverrides(input.env || {});
  for (const i of envLayer.issues) issues.push(i);
  for (const key of Object.keys(envLayer.values)) {
    if (has(envLayer.values, key)) {
      config[key] = envLayer.values[key];
      sources[key] = "env";
    }
  }

  const cliLayer = parseArgv(input.argv || []);
  for (const i of cliLayer.issues) issues.push(i);
  for (const key of Object.keys(cliLayer.values)) {
    if (has(cliLayer.values, key)) {
      config[key] = cliLayer.values[key];
      sources[key] = "cli";
    }
  }

  const overrides = input.overrides || {};
  for (const key of Object.keys(overrides)) {
    if (has(overrides, key)) {
      config[key] = overrides[key];
      sources[key] = "override";
    }
  }

  // ------------------------------------------------------------- validation
  //
  // Three checks. Everything else that is wrong sails straight through into
  // the modules, where it turns into NaN, an empty list, or a silent false.

  const port = config["server.port"];
  const portNum = typeof port === "number" ? port : Number(port);
  if (Number.isNaN(portNum) || !Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    issues.push(
      issue(sources["server.port"] || "default", "server.port",
        "must be an integer between 0 and 65535, got " + JSON.stringify(port)),
    );
  }

  const level = config["log.level"];
  if (typeof level !== "string" || LOG_LEVELS.indexOf(level) < 0) {
    issues.push(
      issue(sources["log.level"] || "default", "log.level",
        "must be one of " + LOG_LEVELS.join(", ") + ", got " + JSON.stringify(level)),
    );
  }

  const kind = config["sink.kind"];
  if (typeof kind !== "string" || SINK_KINDS.indexOf(kind) < 0) {
    issues.push(
      issue(sources["sink.kind"] || "default", "sink.kind",
        "must be one of " + SINK_KINDS.join(", ") + ", got " + JSON.stringify(kind)),
    );
  }

  // log.format, rateLimit.windowMs, retry.maxAttempts, spool.maxBytes, the
  // list-valued keys and everything else are not checked at all.

  return {
    config,
    sources,
    issues,
    ok: issues.length === 0,
    unknown: { file: fileLayer.unknown, env: envLayer.unknown, cli: cliLayer.unknown },
    flags: cliLayer.flags,
    positionals: cliLayer.positionals,
  };
}
