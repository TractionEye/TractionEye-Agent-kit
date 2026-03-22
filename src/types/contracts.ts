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

export type TradePreviewRequest = {
  action: TradeAction;
  tokenAddress: string;
  amountNano: string;
};

export type ValidationOutcome = 'ok' | 'warning' | 'rejected';

export type TradePreview = {
  action: TradeAction;
  tokenAddress: string;
  amountNano: string;
  estimatedReceiveNano: string;
  minReceiveNano: string;
  priceImpactPercent: number;
  swapRate: string;
  validationOutcome: ValidationOutcome;
  lowBalanceState: boolean;
};

export type TradeExecutionRequest = {
  action: TradeAction;
  tokenAddress: string;
  amountNano: string;
  slippageTolerance?: number;
};

export type TradeExecution = {
  operationId: string;
  initialStatus: 'pending';
  swapType: TradeAction;
  tokenAddress: string;
  expectedTokenAmountNano?: string;
  expectedTonAmountNano?: string;
};

export type OperationStatusType = 'pending' | 'confirmed' | 'adjusted' | 'failed';

export type OperationStatus = {
  operationId: string;
  status: OperationStatusType;
  swapType: TradeAction;
  tokenAddress: string;
  expectedTokenAmountNano?: string;
  expectedTonAmountNano?: string;
  actualTokenAmountNano?: string;
  actualTonAmountNano?: string;
  failureReason?: string;
  errorCode?: number;
};
