/** Priority levels for GeckoTerminal API requests. */
declare enum RequestPriority {
    /** P0 — TP/SL monitoring (60% budget) */
    Critical = 0,
    /** P1 — Trade execution (20% budget) */
    High = 1,
    /** P2 — Screening / background (20% budget) */
    Low = 2
}
/**
 * Token-bucket rate limiter with priority queue.
 * GeckoTerminal free tier: ~30 req/min advertised, ~5-6 burst limit in practice.
 * Strategy: small burst bucket (5) + minimum interval between requests (2s)
 * to stay within real-world limits across daemon + agent processes sharing one IP.
 */
declare class RateLimiter {
    private tokens;
    private readonly maxTokens;
    private readonly windowMs;
    private readonly minIntervalMs;
    private lastRefill;
    private lastRequest;
    private queue;
    private draining;
    constructor(maxTokens?: number, windowMs?: number, minIntervalMs?: number);
    /** Schedule a request with a given priority. Returns the result promise. */
    schedule<T>(priority: RequestPriority, execute: () => Promise<T>): Promise<T>;
    private refill;
    private drain;
}

type PoolInfo = {
    poolAddress: string;
    name: string;
    baseTokenPriceUsd: string;
    reserveInUsd: number;
    fdvUsd: number | null;
    marketCapUsd: number | null;
    lockedLiquidityPercent: number | null;
    volume24hUsd: number;
    volume6hUsd: number;
    volume1hUsd: number;
    priceChange5m: number;
    priceChange15m: number;
    priceChange30m: number;
    priceChange1h: number;
    priceChange6h: number;
    priceChange24h: number;
    transactions24h: number;
    buys24h: number;
    sells24h: number;
    uniqueBuyers1h: number;
    uniqueBuyers6h: number;
    uniqueBuyers24h: number;
    uniqueSellers1h: number;
    uniqueSellers6h: number;
    uniqueSellers24h: number;
    buySellRatio: number;
    createdAt: string;
    baseTokenId?: string;
    /** Tags indicating how this pool was discovered (e.g. 'top_volume', 'trending_1h', 'new'). */
    tags: string[];
};
type TokenPrice = {
    address: string;
    priceUsd: number | null;
    symbol: string;
};
type TradeInfo = {
    kind: 'buy' | 'sell';
    volumeInUsd: number;
    txFromAddress: string;
    blockTimestamp: string;
    fromTokenAmount: number;
    toTokenAmount: number;
    priceFromInUsd: number;
    priceToInUsd: number;
};
type OhlcvCandle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};
type OhlcvMeta = {
    base: {
        name: string;
        symbol: string;
        address: string;
    };
    quote: {
        name: string;
        symbol: string;
    };
};
type OhlcvResponse = {
    candles: OhlcvCandle[];
    meta: OhlcvMeta;
};
type OhlcvTimeframe = 'day' | 'hour' | 'minute';

/** GeckoTerminal API client for TON network with built-in rate limiting. */
declare class GeckoTerminalClient {
    private readonly limiter;
    constructor(limiter: RateLimiter);
    /** Fetch pools for TON network (paginated, up to 20 per page). */
    getPools(page?: number, sort?: 'h24_volume_usd_desc' | 'h24_tx_count_desc', priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Trending pools on TON. */
    getTrendingPools(duration?: '5m' | '1h' | '6h' | '24h', priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Newly created pools on TON. */
    getNewPools(priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Search pools by keyword, filtered to TON network. */
    searchPools(query: string, priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Fetch details for multiple pools (up to 30 addresses, comma-separated). */
    getPoolsMulti(addresses: string[], priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Fetch recent trades for a pool. */
    getPoolTrades(poolAddress: string, options?: {
        tradeVolumeInUsdGreaterThan?: number;
    }, priority?: RequestPriority): Promise<TradeInfo[]>;
    /** Fetch OHLCV candles for a pool. */
    getPoolOhlcv(poolAddress: string, timeframe?: OhlcvTimeframe, limit?: number, priority?: RequestPriority): Promise<OhlcvResponse>;
    /** Fetch prices for multiple tokens (up to 30 addresses). P0 priority by default. */
    getTokenPrices(addresses: string[], priority?: RequestPriority): Promise<TokenPrice[]>;
    /** Fetch a single token's price. */
    getTokenPrice(address: string, priority?: RequestPriority): Promise<TokenPrice>;
    private get;
}

/** Filter criteria for token/pool screening. All fields optional. */
type ScreeningFilter = {
    /** Minimum pool reserve (liquidity) in USD. */
    minLiquidityUsd?: number;
    /** Maximum pool reserve (liquidity) in USD. */
    maxLiquidityUsd?: number;
    /** Minimum fully diluted valuation in USD. */
    minFdvUsd?: number;
    /** Maximum fully diluted valuation in USD. */
    maxFdvUsd?: number;
    /** Minimum market cap in USD. */
    minMarketCapUsd?: number;
    /** Maximum market cap in USD. */
    maxMarketCapUsd?: number;
    /** Minimum locked liquidity percentage (e.g. 50 = 50%). */
    minLockedLiquidityPercent?: number;
    /** Minimum 24h trading volume in USD. */
    minVolume24hUsd?: number;
    /** Price change 5m range (min/max %). */
    priceChange5m?: {
        min?: number;
        max?: number;
    };
    /** Price change 15m range (min/max %). */
    priceChange15m?: {
        min?: number;
        max?: number;
    };
    /** Price change 30m range (min/max %). */
    priceChange30m?: {
        min?: number;
        max?: number;
    };
    /** Price change 1h range (min/max %). */
    priceChange1h?: {
        min?: number;
        max?: number;
    };
    /** Price change 6h range (min/max %). */
    priceChange6h?: {
        min?: number;
        max?: number;
    };
    /** Price change 24h range (min/max %). */
    priceChange24h?: {
        min?: number;
        max?: number;
    };
    /** Minimum number of transactions in 24h. */
    minTransactions24h?: number;
    /** Minimum buy/sell ratio (e.g. 1.5 = 1.5× more buys than sells). */
    minBuySellRatio?: number;
    /** Minimum unique buyers in 24h. */
    minUniqueBuyers24h?: number;
};
/** Sources to include when screening. */
type ScreeningSource = 'pools' | 'trending' | 'new_pools';
type ScreeningConfig = {
    /** Filter criteria. */
    filter: ScreeningFilter;
    /** Which sources to scan. Defaults to all. */
    sources?: ScreeningSource[];
};

/** Screens TON pools via GeckoTerminal and applies client-side filters. */
declare class TokenScreener {
    private readonly gecko;
    constructor(gecko: GeckoTerminalClient);
    /** Run a screening pass: fetch pools from configured sources & filter. */
    screen(config: ScreeningConfig): Promise<PoolInfo[]>;
    /** Search pools by keyword and apply filter. */
    search(query: string, filter: ScreeningFilter): Promise<PoolInfo[]>;
    private fetchSources;
}

/** Configuration for position management (TP/SL, sizing). */
type PositionConfig = {
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
type MonitorConfig = {
    /** Polling interval in milliseconds (default: 10000 = 10s). */
    intervalMs?: number;
};
/** Tracked position in the monitor. */
type TrackedPosition = {
    tokenAddress: string;
    symbol: string;
    entryPriceUsd: number;
    quantity: string;
    /** Whether partial TP has already been triggered. */
    partialTpTriggered: boolean;
};
/** Event emitted when TP/SL triggers. */
type PositionEvent = {
    type: 'take_profit' | 'partial_take_profit' | 'stop_loss';
    tokenAddress: string;
    symbol: string;
    entryPriceUsd: number;
    currentPriceUsd: number;
    changePercent: number;
    /** Sell percentage (100 for full close, partial for partial TP). */
    sellPercent: number;
};

type TradeExecutor = (tokenAddress: string, action: 'BUY' | 'SELL', sellPercent: number) => Promise<void>;
type PositionEventHandler = (event: PositionEvent) => void;
/**
 * Monitors open positions and auto-triggers TP/SL via GeckoTerminal price feeds.
 *
 * Usage:
 * 1. Create instance with config
 * 2. Call addPosition() for each open position
 * 3. Call start() to begin the polling loop
 * 4. Call stop() to halt monitoring
 */
declare class PositionManager {
    private readonly gecko;
    private readonly config;
    private readonly executeTradeCallback;
    private readonly onEvent?;
    private readonly monitorConfig?;
    private positions;
    private timer;
    private running;
    constructor(gecko: GeckoTerminalClient, config: PositionConfig, executeTradeCallback: TradeExecutor, onEvent?: PositionEventHandler | undefined, monitorConfig?: MonitorConfig | undefined);
    /** Add a position to be monitored. */
    addPosition(pos: TrackedPosition): void;
    /** Remove a position from monitoring. */
    removePosition(tokenAddress: string): void;
    /** Get all tracked positions. */
    getPositions(): TrackedPosition[];
    /** Start the polling loop. */
    start(): void;
    /** Stop the polling loop. */
    stop(): void;
    get isRunning(): boolean;
    /** Single monitoring tick: fetch prices & check TP/SL. */
    private tick;
}

/** A single virtual trade recorded during simulation. */
type VirtualTrade = {
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
type SimulationResult = {
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

/**
 * Dry-run simulation engine.
 *
 * Instead of executing real trades it records virtual trades and computes
 * statistics (win rate, avg P&L) to help the agent recommend optimal parameters.
 */
declare class Simulator {
    private trades;
    /** Open virtual positions keyed by token address. */
    private openPositions;
    get isActive(): boolean;
    /** Record a virtual BUY (opens a position). */
    recordBuy(tokenAddress: string, symbol: string, priceUsd: number, quantity: string): VirtualTrade;
    /** Record a virtual SELL (closes a position). Calculates P&L vs entry. */
    recordSell(tokenAddress: string, symbol: string, priceUsd: number, quantity: string): VirtualTrade;
    /** Check if there's an open virtual position for a token. */
    hasPosition(tokenAddress: string): boolean;
    /** Get the virtual entry price for a token (or null). */
    getEntryPrice(tokenAddress: string): number | null;
    /** Get all open virtual positions. */
    getOpenPositions(): VirtualTrade[];
    /** Compute simulation results from all recorded trades. */
    getResults(): SimulationResult;
    /** Reset all simulation data. */
    reset(): void;
    private recommend;
}

type TractionEyeClientConfig = {
    agentToken: string;
    baseUrl?: string;
    /** Enable dry-run simulation mode. Default: false. */
    dryRun?: boolean;
};
type StrategySummary = {
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
type TokenSummary = {
    address: string;
    symbol: string;
    decimals: number;
    quantity: string;
    realizedPnlTon: string;
    unrealizedPnlTon: string;
    entryPriceTon?: string;
    currentValueTon?: string;
};
type PortfolioSummary = {
    strategyId: string;
    totalRealizedPnlTon: string;
    totalUnrealizedPnlTon: string;
    tokens: TokenSummary[];
};
type AvailableToken = {
    address: string;
    symbol: string;
    decimals: number;
};
type TradeAction = 'BUY' | 'SELL';
type TradePreviewRequest = {
    action: TradeAction;
    tokenAddress: string;
    amountNano: string;
};
type ValidationOutcome = 'ok' | 'warning' | 'rejected';
type TradePreview = {
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
type TradeExecutionRequest = {
    action: TradeAction;
    tokenAddress: string;
    amountNano: string;
    slippageTolerance?: number;
};
type TradeExecution = {
    operationId: string;
    initialStatus: 'pending';
    swapType: TradeAction;
    tokenAddress: string;
    expectedTokenAmountNano?: string;
    expectedTonAmountNano?: string;
};
type OperationStatusType = 'pending' | 'confirmed' | 'adjusted' | 'failed';
type OperationStatus = {
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

declare class TractionEyeClient {
    private readonly http;
    readonly strategyId: string;
    readonly strategyName: string;
    /** In-memory map: operationId → execution context (swapType, tokenAddress). */
    private readonly _opContext;
    /** GeckoTerminal client for market data (built-in, no API key needed). */
    readonly gecko: GeckoTerminalClient;
    /** Token screener for filtering pools by criteria. */
    readonly screener: TokenScreener;
    /** Rate limiter for GeckoTerminal API (30 req/60s). */
    readonly limiter: RateLimiter;
    /** Simulation engine (only active when dryRun=true). */
    readonly simulator: Simulator | null;
    private positionManager;
    private readonly dryRun;
    private constructor();
    static create(config: TractionEyeClientConfig): Promise<TractionEyeClient>;
    get isDryRun(): boolean;
    getStrategySummary(): Promise<StrategySummary>;
    getPortfolio(): Promise<PortfolioSummary>;
    /**
     * Returns the first page of tradeable tokens (up to `limit`, default 200).
     * Use `findToken()` for symbol-based lookup instead of loading the full catalog.
     */
    getAvailableTokens(limit?: number, offset?: number): Promise<AvailableToken[]>;
    /**
     * Find a token by symbol. Preferred way to resolve symbol → address before trading.
     * Example: const weth = await client.findToken('WETH');
     */
    findToken(symbol: string): Promise<AvailableToken | null>;
    previewTrade(req: TradePreviewRequest): Promise<TradePreview>;
    /**
     * Execute a trade. In dry-run mode records a virtual trade via previewTrade().
     */
    executeTrade(req: TradeExecutionRequest): Promise<TradeExecution>;
    getOperationStatus(operationId: string): Promise<OperationStatus>;
    /** Screen tokens/pools by filter criteria. */
    screenTokens(config: ScreeningConfig): Promise<PoolInfo[]>;
    /** Search pools by keyword with optional filter. */
    searchPools(query: string, filter?: ScreeningFilter): Promise<PoolInfo[]>;
    /** Get trending pools on TON. */
    getTrendingPools(): Promise<PoolInfo[]>;
    /** Get newly created pools on TON. */
    getNewPools(): Promise<PoolInfo[]>;
    /** Get current USD price for a token by address. */
    getTokenPriceUsd(tokenAddress: string): Promise<number | null>;
    /**
     * Start monitoring open positions for TP/SL triggers.
     * Fetches the current portfolio and begins the polling loop.
     */
    startPositionMonitor(positionConfig: PositionConfig, monitorConfig?: MonitorConfig, onEvent?: (event: PositionEvent) => void): Promise<void>;
    /** Stop the position monitoring loop. */
    stopPositionMonitor(): void;
    /** Get the position manager instance (if started). */
    getPositionManager(): PositionManager | null;
    /** Get simulation results (only available in dry-run mode). */
    getSimulationResults(): SimulationResult | null;
    /** Reset simulation data (only in dry-run mode). */
    resetSimulation(): void;
}

declare class TractionEyeHttpError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(message: string, status: number, body?: unknown | undefined);
}

type Tool = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
};
declare function createTractionEyeTools(client: TractionEyeClient): Tool[];

/** Default data directory for TractionEye config and briefing files. */
declare const DEFAULT_DATA_DIR: string;
/** Path to the unified config file. */
declare function configPath(): string;
/** Path to the briefing file written by the daemon. */
declare function briefingPath(): string;
type TpSlDefaults = {
    takeProfitPercent: number;
    stopLossPercent: number;
    partialTakeProfitPercent?: number;
    partialTakeProfitSellPercent?: number;
};
type TpSlConfig = {
    defaults: TpSlDefaults;
    perToken?: Record<string, Partial<TpSlDefaults>>;
};
type ScreeningFilterConfig = {
    [key: string]: unknown;
};
type DaemonConfig = {
    agentToken?: string;
    sessionId?: string;
    openclawPath?: string;
    tpSl?: TpSlConfig;
    screening?: {
        intervalMs?: number;
        filter?: ScreeningFilterConfig;
    };
};
/** Ensure data directory exists. */
declare function ensureDataDir(): void;
/** Read the config file. Returns empty config if file doesn't exist. */
declare function readConfig(): DaemonConfig;
/** Write the config file (full replace). */
declare function writeConfig(config: DaemonConfig): void;
/** Merge partial updates into the existing config and write. */
declare function updateConfig(patch: Partial<DaemonConfig>): DaemonConfig;
/** Read the briefing file. Returns null if not found. */
declare function readBriefing(): unknown;

export { type AvailableToken, DEFAULT_DATA_DIR, type DaemonConfig, GeckoTerminalClient, type MonitorConfig, type OhlcvCandle, type OhlcvMeta, type OhlcvResponse, type OhlcvTimeframe, type OperationStatus, type OperationStatusType, type PoolInfo, type PortfolioSummary, type PositionConfig, type PositionEvent, PositionManager, RateLimiter, RequestPriority, type ScreeningConfig, type ScreeningFilter, type ScreeningSource, type SimulationResult, Simulator, type StrategySummary, type TokenPrice, TokenScreener, type TokenSummary, type TpSlConfig, type TpSlDefaults, type TrackedPosition, TractionEyeClient, type TractionEyeClientConfig, TractionEyeHttpError, type TradeAction, type TradeExecution, type TradeExecutionRequest, type TradeInfo, type TradePreview, type TradePreviewRequest, type ValidationOutcome, type VirtualTrade, briefingPath, configPath, createTractionEyeTools, ensureDataDir, readBriefing, readConfig, updateConfig, writeConfig };
