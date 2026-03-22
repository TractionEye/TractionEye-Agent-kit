export type TractionEyeClientConfig = {
  agentToken: string;
  baseUrl?: string;
  /** Enable dry-run simulation mode. Default: false. */
  dryRun?: boolean;
};

export type StrategySummary = {
  strategyId: string;
  strategyName: string;
  pnlDayTon: string;
  pnlWeekTon: string;
  pnlMonthTon: string;
  pnlYearTon: string;
  tonInStrategy: string;
  totalWinRate: number;
  tradesPerWeek: number;
  maxDrawdown: number;
  lowBalanceState: boolean;
};

export type TokenSummary = {
  address: string;
  symbol: string;
  decimals: number;
  quantity: string;
  realizedPnlTon: string;
  unrealizedPnlTon: string;
  entryPriceTon?: string;
  currentValueTon?: string;
};

export type PortfolioSummary = {
  strategyId: string;
  totalRealizedPnlTon: string;
  totalUnrealizedPnlTon: string;
  tokens: TokenSummary[];
};

export type AvailableToken = {
  address: string;
  symbol: string;
  decimals: number;
};

export type TradeAction = 'BUY' | 'SELL';

export type TradeRequest = {
  tokenAddress: string;
  action: TradeAction;
  /** Amount in TON (as string for precision). */
  amount: string;
  /** Slippage tolerance in percent (e.g. 1 = 1%). Optional. */
  slippageTolerance?: number;
};

export type TradePreview = {
  tokenAddress: string;
  action: TradeAction;
  amount: string;
  estimatedTokens: string;
  priceImpact: number;
  swapRate: string;
};

export type TradeResult = {
  operationId: string;
  tokenAddress: string;
  action: TradeAction;
  amount: string;
  status: 'pending' | 'completed' | 'failed';
};

export type OperationStatus = {
  operationId: string;
  status: 'pending' | 'completed' | 'failed';
  result?: TradeResult;
};
