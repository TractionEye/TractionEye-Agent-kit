/** A single virtual trade recorded during simulation. */
export type VirtualTrade = {
  tokenAddress: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  priceUsd: number;
  quantity: string;
  timestamp: number;
  /** For SELL: P&L % relative to the paired BUY entry price. */
  pnlPercent?: number;
};

/** Aggregated simulation results. */
export type SimulationResult = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfitPercent: number;
  avgLossPercent: number;
  netPnlPercent: number;
  trades: VirtualTrade[];
  /** Recommended parameters based on simulation statistics. */
  recommendedConfig: {
    takeProfitPercent: number;
    stopLossPercent: number;
    positionSizePercent: number;
  };
};
