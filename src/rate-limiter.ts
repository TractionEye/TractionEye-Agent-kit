/** Priority levels for GeckoTerminal API requests. */
export enum RequestPriority {
  /** P0 — TP/SL monitoring (60% budget) */
  Critical = 0,
  /** P1 — Trade execution (20% budget) */
  High = 1,
  /** P2 — Screening / background (20% budget) */
  Low = 2,
}

type QueueEntry<T> = {
  priority: RequestPriority;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

/**
 * Token-bucket rate limiter with priority queue.
 * GeckoTerminal free tier: ~30 req/min advertised, ~5-6 burst limit in practice.
 * Strategy: small burst bucket (5) + minimum interval between requests (2s)
 * to stay within real-world limits across daemon + agent processes sharing one IP.
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly windowMs: number;
  private readonly minIntervalMs: number;
  private lastRefill: number;
  private lastRequest: number = 0;
  private queue: QueueEntry<unknown>[] = [];
  private draining = false;

  constructor(maxTokens = 5, windowMs = 60_000, minIntervalMs = 2_000) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.windowMs = windowMs;
    this.minIntervalMs = minIntervalMs;
    this.lastRefill = Date.now();
  }

  /** Schedule a request with a given priority. Returns the result promise. */
  schedule<T>(priority: RequestPriority, execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = { priority, execute, resolve, reject };
      this.queue.push(entry as QueueEntry<unknown>);
      // Keep queue sorted: lower priority value = higher priority (runs first)
      this.queue.sort((a, b) => a.priority - b.priority);
      this.drain();
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / this.windowMs) * this.maxTokens;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    while (this.queue.length > 0) {
      this.refill();

      if (this.tokens < 1) {
        // Wait until at least 1 token is available
        const waitMs = ((1 - this.tokens) / this.maxTokens) * this.windowMs;
        await sleep(Math.max(waitMs, 200));
        continue;
      }

      // Enforce minimum interval between requests
      const sinceLast = Date.now() - this.lastRequest;
      if (sinceLast < this.minIntervalMs) {
        await sleep(this.minIntervalMs - sinceLast);
      }

      const entry = this.queue.shift()!;
      this.tokens -= 1;
      this.lastRequest = Date.now();

      try {
        const result = await entry.execute();
        entry.resolve(result);
      } catch (err) {
        entry.reject(err);
      }
    }

    this.draining = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
