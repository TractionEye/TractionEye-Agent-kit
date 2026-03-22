import type { VirtualTrade, SimulationResult } from './types.js';

/**
 * Dry-run simulation engine.
 *
 * Instead of executing real trades it records virtual trades and computes
 * statistics (win rate, avg P&L) to help the agent recommend optimal parameters.
 */
export class Simulator {
  private trades: VirtualTrade[] = [];
  /** Open virtual positions keyed by token address. */
  private openPositions = new Map<string, VirtualTrade>();

  get isActive(): boolean {
    return true; // simulator is always in dry-run mode
  }

  /** Record a virtual BUY (opens a position). */
  recordBuy(tokenAddress: string, symbol: string, priceUsd: number, quantity: string): VirtualTrade {
    const trade: VirtualTrade = {
      tokenAddress,
      symbol,
      action: 'BUY',
      priceUsd,
      quantity,
      timestamp: Date.now(),
    };
    this.trades.push(trade);
    this.openPositions.set(tokenAddress, trade);
    return trade;
  }

  /** Record a virtual SELL (closes a position). Calculates P&L vs entry. */
  recordSell(tokenAddress: string, symbol: string, priceUsd: number, quantity: string): VirtualTrade {
    const entry = this.openPositions.get(tokenAddress);
    const pnlPercent = entry
      ? ((priceUsd - entry.priceUsd) / entry.priceUsd) * 100
      : 0;

    const trade: VirtualTrade = {
      tokenAddress,
      symbol,
      action: 'SELL',
      priceUsd,
      quantity,
      timestamp: Date.now(),
      pnlPercent,
    };
    this.trades.push(trade);
    this.openPositions.delete(tokenAddress);
    return trade;
  }

  /** Check if there's an open virtual position for a token. */
  hasPosition(tokenAddress: string): boolean {
    return this.openPositions.has(tokenAddress);
  }

  /** Get the virtual entry price for a token (or null). */
  getEntryPrice(tokenAddress: string): number | null {
    return this.openPositions.get(tokenAddress)?.priceUsd ?? null;
  }

  /** Get all open virtual positions. */
  getOpenPositions(): VirtualTrade[] {
    return Array.from(this.openPositions.values());
  }

  /** Compute simulation results from all recorded trades. */
  getResults(): SimulationResult {
    const sells = this.trades.filter((t) => t.action === 'SELL' && t.pnlPercent != null);
    const wins = sells.filter((t) => t.pnlPercent! > 0);
    const losses = sells.filter((t) => t.pnlPercent! <= 0);

    const avgProfit = wins.length > 0
      ? wins.reduce((s, t) => s + t.pnlPercent!, 0) / wins.length
      : 0;
    const avgLoss = losses.length > 0
      ? losses.reduce((s, t) => s + t.pnlPercent!, 0) / losses.length
      : 0;
    const netPnl = sells.length > 0
      ? sells.reduce((s, t) => s + t.pnlPercent!, 0) / sells.length
      : 0;

    const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;

    return {
      totalTrades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgProfitPercent: round2(avgProfit),
      avgLossPercent: round2(avgLoss),
      netPnlPercent: round2(netPnl),
      trades: [...this.trades],
      recommendedConfig: this.recommend(avgProfit, avgLoss, winRate),
    };
  }

  /** Reset all simulation data. */
  reset(): void {
    this.trades = [];
    this.openPositions.clear();
  }

  private recommend(
    avgProfit: number,
    avgLoss: number,
    winRate: number,
  ): SimulationResult['recommendedConfig'] {
    // Heuristic recommendations based on observed simulation statistics:
    // - TP at ~80% of average winning trade to capture gains earlier
    // - SL at ~120% of average losing trade to avoid cutting too early
    // - Position size inversely proportional to risk
    const tp = avgProfit > 0 ? round2(avgProfit * 0.8) : 15;
    const sl = avgLoss < 0 ? round2(Math.abs(avgLoss) * 1.2) : 8;
    const posSize = winRate >= 60 ? 10 : winRate >= 40 ? 5 : 3;

    return {
      takeProfitPercent: Math.max(tp, 5),
      stopLossPercent: Math.max(sl, 3),
      positionSizePercent: posSize,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
