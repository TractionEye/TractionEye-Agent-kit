/**
 * Central Quota Manager (Section IV).
 * Replaces coarse session lock. Daemon and agent both operate through QuotaManager.
 * Tracks per-queue API usage and enforces budget allocation.
 */

export type QuotaQueue = 'critical' | 'verify' | 'scout' | 'background';

type QueueAllocation = Record<QuotaQueue, number>; // percentage of total budget

type ApiTracker = {
  used: number;
  limit: number;
  windowStartMs: number;
  windowMs: number;
  allocation: QueueAllocation;
  perQueue: Record<QuotaQueue, number>;
  overageCount: number;
};

export type QuotaBudget = {
  gecko: { used: number; limit: number; free: number; windowResetAt: string; perQueue: Record<QuotaQueue, number> };
  dex: { used: number; limit: number; free: number; windowResetAt: string; perQueue: Record<QuotaQueue, number> };
};

const DEFAULT_GECKO_RPM = 5;
const DEFAULT_DEX_RPM = 10;
const WINDOW_MS = 60_000;

const DEFAULT_ALLOCATION: Record<'gecko' | 'dex', QueueAllocation> = {
  gecko: { critical: 0.6, verify: 0.2, scout: 0.0, background: 0.2 },
  dex: { critical: 0.3, verify: 0.0, scout: 0.4, background: 0.3 },
};

export class QuotaManager {
  private gecko: ApiTracker;
  private dex: ApiTracker;
  private agentLastActive: number = 0;

  constructor(
    geckoRpm: number = DEFAULT_GECKO_RPM,
    dexRpm: number = DEFAULT_DEX_RPM,
  ) {
    this.gecko = this.createTracker(geckoRpm, DEFAULT_ALLOCATION.gecko);
    this.dex = this.createTracker(dexRpm, DEFAULT_ALLOCATION.dex);
  }

  private createTracker(limit: number, allocation: QueueAllocation): ApiTracker {
    return {
      used: 0,
      limit,
      windowStartMs: Date.now(),
      windowMs: WINDOW_MS,
      allocation,
      perQueue: { critical: 0, verify: 0, scout: 0, background: 0 },
      overageCount: 0,
    };
  }

  /** Configure budget allocation for an API. */
  configure(allocation: {
    gecko?: Partial<QueueAllocation>;
    dex?: Partial<QueueAllocation>;
  }): void {
    if (allocation.gecko) {
      this.gecko.allocation = { ...this.gecko.allocation, ...allocation.gecko };
    }
    if (allocation.dex) {
      this.dex.allocation = { ...this.dex.allocation, ...allocation.dex };
    }
  }

  /**
   * Acquire a slot for an API request.
   * Returns immediately if budget available, waits if not.
   */
  async acquire(api: 'gecko' | 'dex', queue: QuotaQueue): Promise<void> {
    const tracker = api === 'gecko' ? this.gecko : this.dex;
    this.maybeResetWindow(tracker);

    // Check if queue has budget
    const queueBudget = Math.floor(tracker.limit * tracker.allocation[queue]);
    if (tracker.perQueue[queue] >= queueBudget && queueBudget > 0) {
      // Queue budget exhausted, wait for window reset
      const waitMs = tracker.windowStartMs + tracker.windowMs - Date.now();
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
        this.maybeResetWindow(tracker);
      }
    }

    // Check total budget
    if (tracker.used >= tracker.limit) {
      const waitMs = tracker.windowStartMs + tracker.windowMs - Date.now();
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
        this.maybeResetWindow(tracker);
      }
    }

    tracker.used++;
    tracker.perQueue[queue]++;
  }

  /** Record that a request was made (for external tracking). */
  record(api: 'gecko' | 'dex', queue: QuotaQueue): void {
    const tracker = api === 'gecko' ? this.gecko : this.dex;
    this.maybeResetWindow(tracker);
    tracker.used++;
    tracker.perQueue[queue]++;
  }

  /** Report a 429 overage. Feedback from on429 callbacks. */
  reportOverage(api: 'gecko' | 'dex'): void {
    const tracker = api === 'gecko' ? this.gecko : this.dex;
    tracker.overageCount++;
    console.warn(`[quota] 429 reported for ${api} (total overages: ${tracker.overageCount})`);
  }

  /** Get current budget state. */
  getState(): QuotaBudget {
    this.maybeResetWindow(this.gecko);
    this.maybeResetWindow(this.dex);

    return {
      gecko: {
        used: this.gecko.used,
        limit: this.gecko.limit,
        free: Math.max(0, this.gecko.limit - this.gecko.used),
        windowResetAt: new Date(this.gecko.windowStartMs + this.gecko.windowMs).toISOString(),
        perQueue: { ...this.gecko.perQueue },
      },
      dex: {
        used: this.dex.used,
        limit: this.dex.limit,
        free: Math.max(0, this.dex.limit - this.dex.used),
        windowResetAt: new Date(this.dex.windowStartMs + this.dex.windowMs).toISOString(),
        perQueue: { ...this.dex.perQueue },
      },
    };
  }

  /** Mark agent as active (replaces session lock check). */
  touchAgentActive(): void {
    this.agentLastActive = Date.now();
  }

  /** Check if agent is active (within last 5 minutes). */
  isAgentActive(timeoutMs: number = 5 * 60_000): boolean {
    return Date.now() - this.agentLastActive < timeoutMs;
  }

  private maybeResetWindow(tracker: ApiTracker): void {
    const now = Date.now();
    if (now - tracker.windowStartMs >= tracker.windowMs) {
      tracker.used = 0;
      tracker.perQueue = { critical: 0, verify: 0, scout: 0, background: 0 };
      tracker.windowStartMs = now;
    }
  }
}
