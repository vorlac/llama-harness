import { getBool, getNum } from "../../config/keys.ts";
import type { Middleware } from "../types.ts";
import { reply } from "../types.ts";
import type { Scheduler } from "../../pipeline/scheduler.ts";
import { realScheduler } from "../../pipeline/scheduler.ts";

/**
 * Fixed-window limiter keyed on the client address.
 *
 * rateLimit.max is read with getNum, so a configured 0 stays 0 and every
 * request is refused. That is deliberate: 0 is how an operator hard-stops
 * ingest without stopping the process.
 */
export function createRateLimiter(
  cfg: Record<string, any>,
  scheduler: Scheduler = realScheduler,
): Middleware {
  const enabled = getBool(cfg, "rateLimit.enabled", true);
  const windowMs = getNum(cfg, "rateLimit.windowMs", 1000);
  const max = getNum(cfg, "rateLimit.max", 100);

  const counts: Record<string, { windowStart: number; hits: number }> = {};

  return (ctx) => {
    if (!enabled) return null;
    const now = scheduler.now();
    const key = ctx.remote;
    let bucket = counts[key];
    if (bucket === undefined || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, hits: 0 };
      counts[key] = bucket;
    }
    bucket.hits += 1;
    if (bucket.hits > max) {
      return reply(429, { error: "rate limited" }, { "retry-after": String(Math.ceil(windowMs / 1000)) });
    }
    return null;
  };
}
