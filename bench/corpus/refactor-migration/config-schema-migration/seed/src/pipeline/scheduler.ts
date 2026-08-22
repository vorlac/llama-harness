// Timing seam. Production uses realScheduler; tests inject ManualScheduler so
// that nothing in the suite depends on wall-clock time.

export interface Scheduler {
  now(): number;
  sleep(ms: number): Promise<void>;
  setInterval(fn: () => void, ms: number): any;
  clearInterval(handle: any): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (handle: any) => { clearInterval(handle); },
};

interface ManualTimer {
  id: number;
  everyMs: number;
  nextAt: number;
  fn: () => void;
  cancelled: boolean;
}

export class ManualScheduler implements Scheduler {
  private clock: number;
  private nextId: number;
  private timers: ManualTimer[];
  /** Every duration passed to sleep(), in call order. Sleeps resolve at once. */
  readonly sleeps: number[];

  constructor(startAt: number = 0) {
    this.clock = startAt;
    this.nextId = 1;
    this.timers = [];
    this.sleeps = [];
  }

  now(): number {
    return this.clock;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve();
  }

  setInterval(fn: () => void, ms: number): any {
    const timer: ManualTimer = {
      id: this.nextId,
      everyMs: ms,
      nextAt: this.clock + ms,
      fn,
      cancelled: false,
    };
    this.nextId += 1;
    this.timers.push(timer);
    return timer.id;
  }

  clearInterval(handle: any): void {
    for (const t of this.timers) {
      if (t.id === handle) t.cancelled = true;
    }
    this.timers = this.timers.filter((t) => !t.cancelled);
  }

  /** Move the clock forward, firing every interval that comes due. */
  advance(ms: number): void {
    const target = this.clock + ms;
    for (;;) {
      let next: ManualTimer | null = null;
      for (const t of this.timers) {
        if (t.cancelled || t.everyMs <= 0) continue;
        if (t.nextAt > target) continue;
        if (next === null || t.nextAt < next.nextAt) next = t;
      }
      if (next === null) break;
      this.clock = next.nextAt;
      next.nextAt = next.nextAt + next.everyMs;
      next.fn();
    }
    this.clock = target;
  }

  get pendingTimers(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }
}
