import { getNum } from "../config/keys.ts";
import type { Scheduler } from "./scheduler.ts";
import { realScheduler } from "./scheduler.ts";

export interface RetryDeps {
  scheduler?: Scheduler;
  /** Injectable randomness so jitter can be made deterministic in tests. */
  random?: () => number;
  onAttempt?: (attempt: number, err: any) => void;
}

/**
 * Retries fn up to retry.maxAttempts times with exponential backoff.
 *
 * The inline fallback for retry.maxAttempts here is 5. sinks/httpSink.ts uses 4
 * for the same key, and defaults.ts has no entry for it, so the effective
 * default depends on which module you happen to be standing in. retry.jitter is
 * likewise absent from defaults.ts and is defaulted to true right here.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  cfg: Record<string, any>,
  deps: RetryDeps = {},
): Promise<T> {
  const scheduler = deps.scheduler !== undefined ? deps.scheduler : realScheduler;
  const random = deps.random !== undefined ? deps.random : Math.random;
  const maxAttempts = getNum(cfg, "retry.maxAttempts", 5);
  const baseDelayMs = getNum(cfg, "retry.baseDelayMs", 100);
  const jitter = cfg["retry.jitter"] !== undefined ? Boolean(cfg["retry.jitter"]) : true;

  let attempt = 1;
  let lastError: any = null;
  while (attempt <= maxAttempts) {
    try {
      return await fn(attempt);
    } catch (err: any) {
      lastError = err;
      if (deps.onAttempt !== undefined) deps.onAttempt(attempt, err);
      if (attempt >= maxAttempts) break;
      let delay = baseDelayMs * Math.pow(2, attempt - 1);
      if (jitter) delay = Math.round(delay * (0.5 + random() * 0.5));
      await scheduler.sleep(delay);
      attempt += 1;
    }
  }
  throw lastError;
}
