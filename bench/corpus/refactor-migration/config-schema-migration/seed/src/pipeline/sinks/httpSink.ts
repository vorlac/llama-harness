import { getNum, getStr } from "../../config/keys.ts";
import type { Scheduler } from "../scheduler.ts";
import { realScheduler } from "../scheduler.ts";
import type { Sink } from "./types.ts";

export interface HttpSinkDeps {
  scheduler?: Scheduler;
  post?: (url: string, body: string, timeoutMs: number) => Promise<number>;
}

/**
 * POSTs NDJSON batches.
 *
 * Two things worth noticing before touching this file:
 *  - the timeout uses `||`, so an explicitly configured 0 becomes 30000, and
 *    30000 disagrees with the 5000 in defaults.ts;
 *  - it does not call pipeline/retry.ts. It has its own copy of the retry loop,
 *    its own fallback of 4 attempts where retry.ts says 5, and its own backoff
 *    curve (linear here, exponential there).
 */
export function createHttpSink(cfg: Record<string, any>, deps: HttpSinkDeps = {}): Sink {
  const endpoint = getStr(cfg, "sink.http.endpoint", "");
  if (endpoint === "") {
    throw new Error("relay: sink.http.endpoint must be set when sink.kind is \"http\"");
  }
  const timeoutMs = Number(cfg["sink.http.timeoutMs"]) || 30000;
  const attempts = getNum(cfg, "retry.maxAttempts", 4);
  const baseDelayMs = getNum(cfg, "retry.baseDelayMs", 100);
  const scheduler = deps.scheduler !== undefined ? deps.scheduler : realScheduler;

  const post = deps.post !== undefined
    ? deps.post
    : async (url: string, body: string, ms: number): Promise<number> => {
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, ms);
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/x-ndjson" },
            body,
            signal: controller.signal,
          });
          return res.status;
        } finally {
          clearTimeout(timer);
        }
      };

  return {
    name: "http",
    async write(records: any[]): Promise<number> {
      if (records.length === 0) return 0;
      let body = "";
      for (const r of records) body += JSON.stringify(r) + "\n";

      let attempt = 1;
      let lastError: any = null;
      while (attempt <= attempts) {
        try {
          const status = await post(endpoint, body, timeoutMs);
          if (status >= 200 && status < 300) return records.length;
          lastError = new Error("relay: sink returned HTTP " + String(status));
        } catch (err: any) {
          lastError = err;
        }
        if (attempt >= attempts) break;
        await scheduler.sleep(baseDelayMs * attempt);
        attempt += 1;
      }
      throw lastError;
    },
    async close(): Promise<void> {
      return;
    },
  };
}
