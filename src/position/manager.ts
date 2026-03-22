import type { GeckoTerminalClient } from '../gecko/client.js';
import type { TokenPrice } from '../gecko/types.js';
import type {
  MonitorConfig,
  PositionConfig,
  PositionEvent,
  TrackedPosition,
} from './types.js';

const DEFAULT_INTERVAL_MS = 10_000;

export type TradeExecutor = (tokenAddress: string, action: 'BUY' | 'SELL', sellPercent: number) => Promise<void>;
export type PositionEventHandler = (event: PositionEvent) => void;

/**
 * Monitors open positions and auto-triggers TP/SL via GeckoTerminal price feeds.
 *
 * Usage:
 * 1. Create instance with config
 * 2. Call addPosition() for each open position
 * 3. Call start() to begin the polling loop
 * 4. Call stop() to halt monitoring
 */
export class PositionManager {
  private positions = new Map<string, TrackedPosition>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly gecko: GeckoTerminalClient,
    private readonly config: PositionConfig,
    private readonly executeTradeCallback: TradeExecutor,
    private readonly onEvent?: PositionEventHandler,
    private readonly monitorConfig?: MonitorConfig,
  ) {}

  /** Add a position to be monitored. */
  addPosition(pos: TrackedPosition): void {
    this.positions.set(pos.tokenAddress, pos);
  }

  /** Remove a position from monitoring. */
  removePosition(tokenAddress: string): void {
    this.positions.delete(tokenAddress);
  }

  /** Get all tracked positions. */
  getPositions(): TrackedPosition[] {
    return Array.from(this.positions.values());
  }

  /** Start the polling loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const interval = this.monitorConfig?.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Run immediately, then on interval
    void this.tick();
    this.timer = setInterval(() => void this.tick(), interval);
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Single monitoring tick: fetch prices & check TP/SL. */
  private async tick(): Promise<void> {
    if (this.positions.size === 0) return;

    const addresses = Array.from(this.positions.keys());
    let prices: TokenPrice[];
    try {
      prices = await this.gecko.getTokenPrices(addresses);
    } catch {
      // Swallow errors — will retry on next tick
      return;
    }

    const priceMap = new Map<string, number>();
    for (const p of prices) {
      if (p.priceUsd != null) priceMap.set(p.address, p.priceUsd);
    }

    for (const [addr, pos] of this.positions) {
      const currentPrice = priceMap.get(addr);
      if (currentPrice == null) continue;

      const changePct = ((currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

      // Check stop loss first (higher priority)
      if (this.config.stopLossPercent != null && changePct <= -this.config.stopLossPercent) {
        const event: PositionEvent = {
          type: 'stop_loss',
          tokenAddress: addr,
          symbol: pos.symbol,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          changePercent: changePct,
          sellPercent: 100,
        };
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, 'SELL', 100);
        } catch {
          // Trade execution failed — position stays, will retry next tick
          continue;
        }
        this.positions.delete(addr);
        continue;
      }

      // Check partial take profit
      if (
        this.config.partialTpTrigger != null &&
        this.config.partialTpPercent != null &&
        !pos.partialTpTriggered &&
        changePct >= this.config.partialTpTrigger
      ) {
        const event: PositionEvent = {
          type: 'partial_take_profit',
          tokenAddress: addr,
          symbol: pos.symbol,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          changePercent: changePct,
          sellPercent: this.config.partialTpPercent,
        };
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, 'SELL', this.config.partialTpPercent);
        } catch {
          continue;
        }
        pos.partialTpTriggered = true;
      }

      // Check full take profit
      if (this.config.takeProfitPercent != null && changePct >= this.config.takeProfitPercent) {
        const event: PositionEvent = {
          type: 'take_profit',
          tokenAddress: addr,
          symbol: pos.symbol,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          changePercent: changePct,
          sellPercent: 100,
        };
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, 'SELL', 100);
        } catch {
          continue;
        }
        this.positions.delete(addr);
      }
    }
  }
}
