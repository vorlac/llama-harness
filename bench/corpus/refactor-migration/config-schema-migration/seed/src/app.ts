import type { LoadResult } from "./config/loader.ts";
import { formatIssue } from "./config/issue.ts";
import { setCurrentConfig } from "./config/current.ts";
import { createLogger } from "./observability/logger.ts";
import type { Logger } from "./observability/logger.ts";
import { createMetrics } from "./observability/metrics.ts";
import type { Metrics } from "./observability/metrics.ts";
import { Batcher } from "./pipeline/batcher.ts";
import { createSink } from "./pipeline/sinks/index.ts";
import type { Sink } from "./pipeline/sinks/types.ts";
import type { Scheduler } from "./pipeline/scheduler.ts";
import { realScheduler } from "./pipeline/scheduler.ts";
import { createHttpServer } from "./server/httpServer.ts";
import type { HttpServer } from "./server/httpServer.ts";
import { createRouter } from "./server/router.ts";
import { createBodyLimit } from "./server/middleware/bodyLimit.ts";
import { createCorsMiddleware, corsHeaders } from "./server/middleware/cors.ts";
import { createRateLimiter } from "./server/middleware/rateLimit.ts";
import type { Handler, Middleware, ReqCtx, Reply } from "./server/types.ts";

export interface AppDeps {
  scheduler?: Scheduler;
  sink?: Sink;
  logWrite?: (line: string) => void;
}

export interface AppHandle {
  config: Record<string, any>;
  logger: Logger;
  metrics: Metrics;
  batcher: Batcher;
  sink: Sink;
  /** Drive a request straight through the middleware chain, no sockets. */
  handle(ctx: ReqCtx): Promise<Reply>;
  listen(): Promise<number>;
  close(): Promise<void>;
  readonly port: number;
}

/**
 * Wires the daemon together.
 *
 * Order matters more than it looks: setCurrentConfig has to run before
 * createRouter, because the auth decorator inside the router reads the global
 * config at wrap time, and before withSpool is ever entered.
 */
export function createApp(result: LoadResult, deps: AppDeps = {}): AppHandle {
  if (!result.ok) {
    throw new Error(
      "relay: invalid configuration: " + result.issues.map(formatIssue).join("; "),
    );
  }

  const cfg = result.config;
  setCurrentConfig(cfg);

  const scheduler = deps.scheduler !== undefined ? deps.scheduler : realScheduler;
  const logger = createLogger(cfg, deps.logWrite);
  const metrics = createMetrics(cfg);
  const sink = deps.sink !== undefined ? deps.sink : createSink(cfg, { scheduler });
  const batcher = new Batcher(cfg, { sink, scheduler, logger, metrics });

  const router = createRouter({ cfg, batcher, metrics, logger });
  const chain: Middleware[] = [
    createCorsMiddleware(cfg),
    createBodyLimit(cfg),
    createRateLimiter(cfg, scheduler),
  ];
  const extraHeaders = corsHeaders(cfg);

  const handler: Handler = async (ctx) => {
    for (const mw of chain) {
      const short = await mw(ctx);
      if (short !== null && short !== undefined) {
        return { status: short.status, headers: Object.assign({}, extraHeaders, short.headers), body: short.body };
      }
    }
    const r = await router(ctx);
    return { status: r.status, headers: Object.assign({}, extraHeaders, r.headers), body: r.body };
  };

  let server: HttpServer | null = null;
  let boundPort = 0;

  return {
    config: cfg,
    logger,
    metrics,
    batcher,
    sink,
    handle: handler,
    get port(): number {
      return boundPort;
    },
    async listen(): Promise<number> {
      if (server === null) server = createHttpServer(cfg, handler, { logger });
      batcher.start();
      boundPort = await server.start();
      return boundPort;
    },
    async close(): Promise<void> {
      if (server !== null) {
        await server.stop();
        server = null;
      }
      await batcher.stop();
      boundPort = 0;
    },
  };
}
