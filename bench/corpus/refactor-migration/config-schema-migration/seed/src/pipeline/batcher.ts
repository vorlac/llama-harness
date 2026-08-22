import { getNum } from "../config/keys.ts";
import type { Logger } from "../observability/logger.ts";
import type { Metrics } from "../observability/metrics.ts";
import type { Scheduler } from "./scheduler.ts";
import { realScheduler } from "./scheduler.ts";
import type { Sink } from "./sinks/types.ts";

export interface BatcherDeps {
  sink: Sink;
  scheduler?: Scheduler;
  logger?: Logger;
  metrics?: Metrics;
}

/**
 * Buffers records and hands them to the sink either when the buffer reaches
 * pipeline.batchSize or when the background interval fires.
 *
 * The interval is captured at construction time, so a Batcher built before the
 * config was finished keeps the old value forever. The inline fallbacks here
 * (batchSize 100, flushIntervalMs 250, maxQueue 1000) all disagree with
 * defaults.ts, which says 50, 1000 and has no entry for maxQueue at all.
 */
export class Batcher {
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  readonly maxQueue: number;
  flushCount: number;
  droppedCount: number;
  errorCount: number;
  writtenCount: number;
  private buffer: any[];
  private timer: any;
  private inflight: Promise<void>;
  private sink: Sink;
  private scheduler: Scheduler;
  private logger: Logger | null;
  private metrics: Metrics | null;

  constructor(cfg: Record<string, any>, deps: BatcherDeps) {
    this.batchSize = getNum(cfg, "pipeline.batchSize", 100);
    this.flushIntervalMs = cfg["pipeline.flushIntervalMs"] !== undefined
      ? Number(cfg["pipeline.flushIntervalMs"])
      : 250;
    this.maxQueue = Number(cfg["pipeline.maxQueue"]) || 1000;
    this.flushCount = 0;
    this.droppedCount = 0;
    this.errorCount = 0;
    this.writtenCount = 0;
    this.buffer = [];
    this.timer = null;
    this.inflight = Promise.resolve();
    this.sink = deps.sink;
    this.scheduler = deps.scheduler !== undefined ? deps.scheduler : realScheduler;
    this.logger = deps.logger !== undefined ? deps.logger : null;
    this.metrics = deps.metrics !== undefined ? deps.metrics : null;
  }

  get size(): number {
    return this.buffer.length;
  }

  async push(record: any): Promise<void> {
    if (this.buffer.length >= this.maxQueue) {
      this.droppedCount += 1;
      if (this.metrics !== null) this.metrics.inc("records_dropped");
      if (this.logger !== null) this.logger.warn("queue full, dropping record");
      return;
    }
    this.buffer.push(record);
    if (this.buffer.length >= this.batchSize) await this.flush();
  }

  flush(): Promise<void> {
    if (this.buffer.length === 0) return this.inflight;
    const batch = this.buffer;
    this.buffer = [];
    this.inflight = this.inflight.then(async () => {
      this.flushCount += 1;
      try {
        const n = await this.sink.write(batch);
        this.writtenCount += n;
        if (this.metrics !== null) this.metrics.inc("records_written", n);
      } catch (err: any) {
        this.errorCount += 1;
        if (this.metrics !== null) this.metrics.inc("flush_errors");
        if (this.logger !== null) {
          this.logger.error("flush failed", { error: String(err && err.message) });
        }
      }
    });
    return this.inflight;
  }

  /** Resolves once every flush started so far has finished. */
  settled(): Promise<void> {
    return this.inflight;
  }

  start(): void {
    if (this.timer !== null) return;
    if (this.flushIntervalMs <= 0) return;
    this.timer = this.scheduler.setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      this.scheduler.clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    await this.inflight;
    await this.sink.close();
  }
}
