// Test-facing helpers.
//
// The whole test suite goes through this module, and this module is the only
// place allowed to talk about configuration keys as strings. It is what lets
// the suite pin precedence, defaults and validation without reaching into the
// representation the production modules use.
//
// The exported signatures below are a contract: test/*.test.ts is not edited
// during the migration, so loadForTest, LoadedConfig, makeApp and TestApp must
// keep accepting and returning what they accept and return today.

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ConfigIssue } from "../config/issue.ts";
import { loadConfig } from "../config/loader.ts";
import { CONFIG_KEYS } from "../config/keys.ts";
import { clearCurrentConfig } from "../config/current.ts";
import { ManualScheduler } from "../pipeline/scheduler.ts";
import { createNullSink } from "../pipeline/sinks/nullSink.ts";
import { createSink } from "../pipeline/sinks/index.ts";
import type { Sink } from "../pipeline/sinks/types.ts";
import { createApp } from "../app.ts";
import type { AppHandle } from "../app.ts";
import type { ReqCtx, Reply } from "../server/types.ts";
import { createLogger } from "../observability/logger.ts";
import type { Logger } from "../observability/logger.ts";
import { createMetrics } from "../observability/metrics.ts";
import type { Metrics } from "../observability/metrics.ts";
import { applyTransform } from "../pipeline/transform.ts";
import { withRetry } from "../pipeline/retry.ts";
import { Batcher } from "../pipeline/batcher.ts";
import { createFileSink } from "../pipeline/sinks/fileSink.ts";
import { createHttpSink } from "../pipeline/sinks/httpSink.ts";
import { withSpool } from "../storage/spool.ts";
import type { Spool } from "../storage/spool.ts";
import { setCurrentConfig } from "../config/current.ts";
import { formatIssue } from "../config/issue.ts";

export interface HarnessInput {
  /** Parsed config-file contents. Nested or flat dotted keys, both accepted. */
  file?: any;
  /** Environment map. Only RELAY_* names are consulted. */
  env?: Record<string, string | undefined>;
  /** Argument vector, without argv[0] and argv[1]. */
  argv?: string[];
  /** Highest-precedence dotted-key overrides. */
  overrides?: Record<string, any>;
}

export interface LoadedConfig {
  /** False when the configuration failed validation. */
  ok: boolean;
  /** Every validation failure, each naming its source and its key. */
  issues: ConfigIssue[];
  /** Resolved value for a canonical dotted key, e.g. "server.port". */
  effective(key: string): unknown;
  /** Which layer won for a key: "cli" | "env" | "file" | "default" | "override". */
  sourceOf(key: string): string | undefined;
  /** Every canonical dotted key the application knows about, sorted. */
  keys(): string[];
  /** The object the production modules consume. */
  raw: unknown;
}

export function loadForTest(input: HarnessInput = {}): LoadedConfig {
  const result = loadConfig({
    file: input.file,
    env: input.env,
    argv: input.argv,
    overrides: input.overrides,
  });
  return {
    ok: result.ok,
    issues: result.issues,
    effective(key: string): unknown {
      return result.config[key];
    },
    sourceOf(key: string): string | undefined {
      return result.sources[key];
    },
    keys(): string[] {
      const seen: Record<string, boolean> = {};
      for (const k of CONFIG_KEYS) seen[k] = true;
      for (const k of Object.keys(result.config)) seen[k] = true;
      return Object.keys(seen).sort();
    },
    raw: result.config,
  };
}

/** Drop the process-global config so one test cannot leak into the next. */
export function resetGlobalConfig(): void {
  clearCurrentConfig();
}

export interface RequestOptions {
  body?: any;
  headers?: Record<string, string>;
  remote?: string;
}

export interface TestApp {
  app: AppHandle;
  /** Every line the logger emitted, in order. */
  logs: string[];
  scheduler: ManualScheduler;
  /**
   * The sink the batcher writes to. Defaults to the null sink, whose records
   * land in sink.written; for any other configured sink kind `written` stays
   * empty and the real sink is exercised instead.
   */
  sink: Sink & { written: any[] };
  /** Drive one request through the whole middleware chain, without sockets. */
  request(method: string, path: string, options?: RequestOptions): Promise<Reply>;
  /** Start a real listener and return its base URL. */
  listen(): Promise<string>;
  close(): Promise<void>;
}

export interface MakeAppOptions {
  scheduler?: ManualScheduler;
  sink?: Sink & { written: any[] };
}

/**
 * Build a running application from a configuration description.
 *
 * Throws when the configuration is invalid; the message names every offending
 * key. Tests rely on that, so keep the key in the message.
 */
export function makeApp(input: HarnessInput = {}, options: MakeAppOptions = {}): TestApp {
  clearCurrentConfig();
  const result = loadConfig({
    file: input.file,
    env: input.env,
    argv: input.argv,
    overrides: input.overrides,
  });
  const logs: string[] = [];
  const scheduler = options.scheduler !== undefined ? options.scheduler : new ManualScheduler();

  // The null sink is used unless the configuration asks for a real one, in
  // which case the real one is built so that its own construction-time
  // failures surface here. `written` stays empty for sinks other than null.
  let sink: Sink & { written: any[] };
  if (options.sink !== undefined) {
    sink = options.sink;
  } else if (!result.ok || String(result.config["sink.kind"]) === "null") {
    sink = createNullSink();
  } else {
    sink = Object.assign(createSink(result.config, { scheduler }), { written: [] as any[] });
  }

  const app = createApp(result, {
    scheduler,
    sink,
    logWrite: (line: string) => { logs.push(line); },
  });

  return {
    app,
    logs,
    scheduler,
    sink,
    async request(method: string, path: string, opts: RequestOptions = {}): Promise<Reply> {
      const headers: Record<string, string> = {};
      const given = opts.headers !== undefined ? opts.headers : {};
      for (const name of Object.keys(given)) headers[name.toLowerCase()] = given[name];

      let body = "";
      if (typeof opts.body === "string") body = opts.body;
      else if (opts.body !== undefined) body = JSON.stringify(opts.body);

      const qIndex = path.indexOf("?");
      const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
      const query: Record<string, string> = {};
      if (qIndex >= 0) {
        for (const pair of path.slice(qIndex + 1).split("&")) {
          if (pair === "") continue;
          const eq = pair.indexOf("=");
          if (eq < 0) query[pair] = "";
          else query[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
        }
      }

      const ctx: ReqCtx = {
        method: method.toUpperCase(),
        path: pathname,
        query,
        headers,
        body,
        remote: opts.remote !== undefined ? opts.remote : "127.0.0.1",
      };
      return app.handle(ctx);
    },
    async listen(): Promise<string> {
      const port = await app.listen();
      const host = String((app.config as Record<string, any>)["server.host"]);
      return "http://" + host + ":" + String(port);
    },
    async close(): Promise<void> {
      await app.close();
      clearCurrentConfig();
    },
  };
}

/** Parse a Reply body as JSON. */
export function bodyJson(r: Reply): any {
  return JSON.parse(r.body);
}

export interface TempDir {
  path: string;
  join(...parts: string[]): string;
  cleanup(): void;
}

export function makeTempDir(prefix: string = "relay-test-"): TempDir {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return {
    path,
    join(...parts: string[]): string {
      return join(path, ...parts);
    },
    cleanup(): void {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Component rigs.
//
// Tests never construct a pipeline or server component directly; they go
// through the rigs below, which is what keeps the suite independent of how
// configuration is represented internally. These signatures are part of the
// frozen contract too.
// ---------------------------------------------------------------------------

/** Resolve a HarnessInput into the object the modules consume, or throw. */
function resolveConfig(input: HarnessInput): Record<string, any> {
  const result = loadConfig({
    file: input.file,
    env: input.env,
    argv: input.argv,
    overrides: input.overrides,
  });
  if (!result.ok) {
    throw new Error(
      "relay: invalid configuration: " + result.issues.map(formatIssue).join("; "),
    );
  }
  return result.config;
}

export function makeLogger(input: HarnessInput = {}): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger(resolveConfig(input), (line: string) => { lines.push(line); });
  return { logger, lines };
}

export function makeMetrics(input: HarnessInput = {}): Metrics {
  return createMetrics(resolveConfig(input));
}

export function transformRecord(record: any, input: HarnessInput = {}): any {
  return applyTransform(record, resolveConfig(input));
}

export interface RetryRun {
  /** The value fn eventually returned, or undefined when it never succeeded. */
  value: any;
  /** The error fn last threw, or null when it succeeded. */
  error: any;
  /** How many times fn was called. */
  attempts: number;
  /** Backoff durations that were waited, in order. */
  delays: number[];
}

export async function runRetry(
  fn: (attempt: number) => Promise<any>,
  input: HarnessInput = {},
): Promise<RetryRun> {
  const cfg = resolveConfig(input);
  const scheduler = new ManualScheduler();
  let attempts = 0;
  const wrapped = async (attempt: number): Promise<any> => {
    attempts += 1;
    return fn(attempt);
  };
  try {
    const value = await withRetry(wrapped, cfg, { scheduler, random: () => 0.5 });
    return { value, error: null, attempts, delays: scheduler.sleeps.slice() };
  } catch (err: any) {
    return { value: undefined, error: err, attempts, delays: scheduler.sleeps.slice() };
  }
}

export interface BatcherRig {
  batcher: Batcher;
  sink: Sink & { written: any[] };
  scheduler: ManualScheduler;
  logs: string[];
}

export function makeBatcher(
  input: HarnessInput = {},
  options: { sink?: Sink & { written: any[] } } = {},
): BatcherRig {
  const cfg = resolveConfig(input);
  const logs: string[] = [];
  const logger = createLogger(cfg, (line: string) => { logs.push(line); });
  const metrics = createMetrics(cfg);
  const scheduler = new ManualScheduler();
  const sink = options.sink !== undefined ? options.sink : createNullSink();
  const batcher = new Batcher(cfg, { sink, scheduler, logger, metrics });
  return { batcher, sink, scheduler, logs };
}

export interface HttpSinkRig {
  sink: Sink;
  scheduler: ManualScheduler;
  /** Backoff durations that were waited, in order. */
  delays: number[];
}

export function makeHttpSink(
  input: HarnessInput,
  post: (url: string, body: string, timeoutMs: number) => Promise<number>,
): HttpSinkRig {
  const cfg = resolveConfig(input);
  const scheduler = new ManualScheduler();
  const sink = createHttpSink(cfg, { scheduler, post });
  return { sink, scheduler, delays: scheduler.sleeps };
}

export function makeFileSink(input: HarnessInput): Sink {
  return createFileSink(resolveConfig(input));
}

/** Enter the spool scope with a configuration described the usual way. */
export async function runWithSpool<T>(
  input: HarnessInput,
  fn: (spool: Spool) => Promise<T>,
): Promise<T> {
  const cfg = resolveConfig(input);
  setCurrentConfig(cfg);
  try {
    return await withSpool(fn);
  } finally {
    clearCurrentConfig();
  }
}
