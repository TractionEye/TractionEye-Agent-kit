/** Configuration for position management (TP/SL, sizing). */
export type PositionConfig = {
  /** Size of each trade as % of tonInStrategy (mutually exclusive with positionSizeFixedUsd). */
  positionSizePercent?: number;
  /** Fixed trade size in USD (alternative to %). */
  positionSizeFixedUsd?: number;
  /** Maximum number of open positions at a time. */
  maxOpenPositions?: number;
  /** Maximum allocation per single token as % of tonInStrategy. */
  maxPerTokenPercent?: number;
  /** Close full position when price rises by this % from entry. */
  takeProfitPercent?: number;
  /** Sell partialTpPercent% of position when price rises by partialTpTrigger%. */
  partialTpPercent?: number;
  /** Trigger % rise for partial TP. */
  partialTpTrigger?: number;
  /** Close full position when price drops by this % from entry. */
  stopLossPercent?: number;
};

/** Monitoring loop configuration. */
export type MonitorConfig = {
  /** Polling interval in milliseconds (default: 10000 = 10s). */
  intervalMs?: number;
};

/** Tracked position in the monitor. */
export type TrackedPosition = {
  tokenAddress: string;
  symbol: string;
  entryPriceUsd: number;
  quantity: string;
  /** Whether partial TP has already been triggered. */
  partialTpTriggered: boolean;
};

/** Event emitted when TP/SL triggers. */
export type PositionEvent = {
  type: 'take_profit' | 'partial_take_profit' | 'stop_loss';
  tokenAddress: string;
  symbol: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  changePercent: number;
  /** Sell percentage (100 for full close, partial for partial TP). */
  sellPercent: number;
};
