/** Priority levels for API requests (used by both GeckoTerminal and DexScreener clients). */
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
    readonly name: string;
    private tokens;
    private readonly maxTokens;
    private readonly windowMs;
    private readonly minIntervalMs;
    private lastRefill;
    private lastRequest;
    private queue;
    private draining;
    constructor(name?: string, maxTokens?: number, windowMs?: number, minIntervalMs?: number);
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
    /** DEX identifier (e.g. 'stonfi', 'dedust'). From DexScreener dexId. */
    dexId: string;
    /** Token price relative to TON. From DexScreener priceNative. */
    priceNative: string;
    /** Buys in last 5 minutes. */
    buys5m: number;
    /** Sells in last 5 minutes. */
    sells5m: number;
    /** Buys in last 1 hour. */
    buys1h: number;
    /** Sells in last 1 hour. */
    sells1h: number;
    /** Buys in last 6 hours. */
    buys6h: number;
    /** Sells in last 6 hours. */
    sells6h: number;
    /** 5-minute volume in USD. */
    volume5mUsd: number;
    /** Social links from token info. */
    socials: {
        type: string;
        url: string;
    }[];
    /** Website URLs from token info. */
    websites: string[];
    /** Total boost amount (from /token-boosts endpoint). 0 if not boosted. */
    boostTotalAmount: number;
    /** Community Takeover token (from /token-profiles endpoint). */
    cto: boolean;
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

type CloseType = 'stop_loss' | 'take_profit' | 'partial_tp' | 'trailing_stop' | 'time_limit' | 'thesis_exit' | 'safety_degradation' | 'manual' | 'failed';
type TripleBarrierConfig = {
    stopLossPercent: number;
    takeProfitPercent: number;
    timeLimitSeconds: number | null;
    trailingStop: {
        activationPercent: number;
        deltaPercent: number;
    } | null;
    partialTp?: {
        triggerPercent: number;
        sellPercent: number;
    };
};
type PositionAction = CreatePositionAction | StopPositionAction | StorePositionAction;
type CreatePositionAction = {
    type: 'create';
    tokenAddress: string;
    poolAddress: string;
    amountNano: string;
    slippageTolerance?: number;
    barriers: TripleBarrierConfig;
    archetype: string;
    entryReason: string;
};
type StopPositionAction = {
    type: 'stop';
    tokenAddress: string;
    closeType: CloseType;
    reason: string;
    sellPercent: number;
};
type StorePositionAction = {
    type: 'store';
    tokenAddress: string;
};
type RiskPolicy = {
    maxOpenPositions: number;
    maxTotalExposurePercent: number;
    maxPerTokenPercent: number;
    maxPriceImpactPercent: number;
    minLockedLiquidityPercent: number;
    minHoldersCount: number;
    maxTop10HoldersPercent: number;
    cooldownAfterExitMinutes: number;
    defaultBarriers: TripleBarrierConfig;
    version: number;
    updatedAt: string;
};
declare const DEFAULT_RISK_POLICY: RiskPolicy;
type SafetyRejectId = 'HONEYPOT' | 'MINT_AUTHORITY' | 'FREEZE_AUTHORITY' | 'DUPLICATE_POSITION' | 'POSITION_CAP' | 'EXPOSURE_CAP' | 'NOT_TRADEABLE' | 'ZERO_LIQUIDITY' | 'WASH_CONFIRMED' | 'COOLDOWN';
type PenaltyId = 'HIGH_CONCENTRATION' | 'LOW_HOLDERS' | 'LOW_LOCKED_LIQUIDITY' | 'TOO_FRESH' | 'CTO_TOKEN' | 'HONEYPOT_UNKNOWN' | 'SUSPICIOUS_ORGANICITY';
type SafetyCheckResult = {
    verdict: 'pass' | 'reject' | 'warning';
    rejects: {
        id: SafetyRejectId;
        reason: string;
    }[];
    penalties: {
        id: PenaltyId;
        multiplier: number;
        reason: string;
    }[];
    finalMultiplier: number;
};
type OrganicitySignal = {
    name: string;
    value: number;
    threshold: number;
    passed: boolean;
};
type OrganicityVerdict = {
    verdict: 'organic' | 'suspicious' | 'wash';
    score: number;
    signals: OrganicitySignal[];
};
type ComputedSignals = {
    volumeAcceleration: number | null;
    buyPressure: number | null;
    buyerAcceleration: number | null;
};
type ConfidenceSummary = {
    score: number;
    confirmingSignals: string[];
    contradictingSignals: string[];
};
type GeckoTokenInfo = {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    gtScore: number | null;
    gtScoreDetails: {
        pool: number;
        transaction: number;
        creation: number;
        info: number;
        holders: number;
    } | null;
    holders: {
        count: number;
        distributionPercentage: {
            top10: number;
            range11to30: number;
            range31to50: number;
            rest: number;
        };
    } | null;
    isHoneypot: 'yes' | 'unknown' | null;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    websites: string[];
    socials: {
        type: string;
        url: string;
    }[];
};
type GeckoPoolInfo = {
    poolAddress: string;
    name: string;
    baseTokenPriceUsd: string;
    reserveInUsd: number;
    lockedLiquidityPercentage: number | null;
    fdvUsd: number | null;
    marketCapUsd: number | null;
    priceChange: {
        m5: number;
        m15: number;
        m30: number;
        h1: number;
        h6: number;
        h24: number;
    };
    volume: {
        m5: number;
        m15: number;
        m30: number;
        h1: number;
        h6: number;
        h24: number;
    };
    transactions: {
        m5: {
            buys: number;
            sells: number;
            buyers: number;
            sellers: number;
        };
        m15: {
            buys: number;
            sells: number;
            buyers: number;
            sellers: number;
        };
        m30: {
            buys: number;
            sells: number;
            buyers: number;
            sellers: number;
        };
        h1: {
            buys: number;
            sells: number;
            buyers: number;
            sellers: number;
        };
        h6: {
            buys: number;
            sells: number;
            buyers: number;
            sellers: number;
        };
        h24: {
            buys: number;
            sells: number;
            buyers: number;
            sellers: number;
        };
    };
    poolCreatedAt: string;
};
type VerificationResult = {
    safety: {
        verdict: 'pass' | 'reject' | 'warning';
        reasons: string[];
        isHoneypot: 'yes' | 'unknown' | null;
        mintAuthority: boolean;
        freezeAuthority: boolean;
        gtScore: number | null;
    };
    organicity: OrganicityVerdict;
    momentum: {
        buyPressure: number;
        volumeRatio1h: number;
        volumeRatio5h: number;
        priceChange1h: number;
        priceChange5h: number;
        avgCandleRange1h: number;
        avgCandleRange5h: number;
        ohlcv: OhlcvCandle[];
    };
    execution: {
        reserveInUsd: number;
        lockedLiquidityPercent: number | null;
        priceImpactEstimate: 'low' | 'medium' | 'high';
    };
    computedSignals: ComputedSignals;
    confidence: ConfidenceSummary;
    meta: {
        poolAddress: string;
        tokenAddress: string;
        dexId: string;
        poolAge: string;
        geckoCallsUsed: number;
        timestamp: string;
    };
};
type StoredMomentum = {
    buyPressure: number;
    volumeRatio1h: number;
    volumeRatio5h: number;
    priceChange1h: number;
    priceChange5h: number;
    avgCandleRange1h: number;
    avgCandleRange5h: number;
};
type StoredVerificationResult = Omit<VerificationResult, 'momentum'> & {
    momentum: StoredMomentum;
};
type CooldownEntry = {
    tokenAddress: string;
    exitTimestamp: string;
    closeType: CloseType;
};
type CooldownState = {
    entries: Record<string, CooldownEntry>;
};
type PositionThesis = {
    tokenAddress: string;
    poolAddress: string;
    symbol: string;
    dexId: string;
    entryPriceUsd: number;
    entryTimestamp: string;
    amountNano: string;
    entrySizePercent: number;
    archetype: string;
    entryReason: string;
    thesisMetrics: {
        entryBuyerDiversity1h: number;
        entryVolume1h: number;
        entryMomentum: string;
    };
    currentPriceUsd: number | null;
    unrealizedPnlPercent: number | null;
    peakPnlPercent: number;
    thesisStatus: 'intact' | 'weakening' | 'broken';
    lastReviewedAt: string;
    barriers: TripleBarrierConfig;
    trailingStopActivated: boolean;
    exitEvents: {
        timestamp: string;
        type: CloseType;
        pnlPercent: number;
        soldPercent: number;
        reason: string;
    }[];
};
type PortfolioState = {
    updatedAt: string;
    positions: Record<string, PositionThesis>;
};
type ShortlistEntry = {
    poolAddress: string;
    tokenAddress: string;
    symbol: string;
    dexId: string;
    tags: string[];
    reserveInUsd: number;
    volume1hUsd: number;
    priceChange1h: number;
    uniqueBuyers1h: number | null;
    boostTotalAmount: number;
    cto: boolean;
    buys1h: number;
    sells1h: number;
    volumeAcceleration: number | null;
    buyPressure: number | null;
    shortlistedAt: string;
    archetype: string | null;
    verificationStatus: 'pending' | 'verified' | 'rejected';
};
type MarketRegime = 'active' | 'quiet' | 'volatile';
type MarketState = {
    updatedAt: string;
    shortlist: ShortlistEntry[];
    topLists: {
        byVolume: string[];
        byLiquidity: string[];
        byFdv: string[];
        gainers1h: string[];
        gainers24h: string[];
        byTxCount: string[];
    };
    marketRegime: MarketRegime;
    tonPriceUsd: number;
    pendingVerifications: string[];
    openPositionReviews: {
        tokenAddress: string;
        thesisStatus: 'weakening' | 'broken';
        reason: string;
    }[];
    cooldownTokens: {
        tokenAddress: string;
        cooldownUntil: string;
        closeType: CloseType;
    }[];
    apiUsage: {
        gecko: {
            used: number;
            limit: number;
            windowResetAt: string;
        };
        dex: {
            used: number;
            limit: number;
            windowResetAt: string;
        };
    };
};
type CandidateState = 'discovered' | 'shortlisted' | 'verifying' | 'verified' | 'rejected' | 'watching' | 'bought';
type CandidateEntry = {
    tokenAddress: string;
    poolAddress: string;
    symbol: string;
    dexId: string;
    state: CandidateState;
    discoveredAt: string;
    lastUpdatedAt: string;
    discoveryTags: string[];
    archetype: string | null;
    verification: StoredVerificationResult | null;
    rejectionReason: string | null;
    ttl: string;
};
type CandidateRegistry = {
    candidates: Record<string, CandidateEntry>;
};
type ReflectionEntry = {
    timestamp: string;
    type: 'trade_closed' | 'thesis_review' | 'session_summary' | 'lesson_learned';
    trade?: {
        tokenAddress: string;
        symbol: string;
        archetype: string;
        pnlPercent: number;
        holdDuration: string;
        exitReason: string;
        whatWorked: string;
        whatFailed: string;
        lessonForPlaybook: string;
    };
    session?: {
        candidatesReviewed: number;
        tradesExecuted: number;
        marketRegime: string;
        keyObservation: string;
    };
    lesson?: {
        rule: string;
        evidence: string;
        confidence: 'low' | 'medium' | 'high';
        affectsPlaybook: string | null;
    };
};
type PlaybookEntry = {
    name: string;
    description: string;
    signals: {
        field: string;
        condition: string;
        threshold: unknown;
    }[];
    params: {
        entryThresholds: {
            minBuyerDiversity: number;
            minVolume1h: number;
            minGtScore: number | null;
        };
        sizing: {
            positionSizePercent: number;
            maxPerToken: number;
        };
        exits: {
            takeProfitPercent: number;
            stopLossPercent: number;
            timeLimitSeconds: number | null;
            trailingStop: {
                activationPercent: number;
                deltaPercent: number;
            } | null;
            thesisHalfLife: string;
        };
    };
    dexOverrides?: {
        stonfi?: Partial<PlaybookEntry['params']>;
        dedust?: Partial<PlaybookEntry['params']>;
    };
    stats: {
        totalTrades: number;
        wins: number;
        losses: number;
        avgPnlPercent: number;
        lastUpdated: string;
    };
};
type Playbooks = {
    updatedAt: string;
    version: number;
    archetypes: Record<string, PlaybookEntry>;
};
type DexDefaults = {
    entryThresholds: {
        minBuyerDiversityRatio: number;
        minVolume1hUsd: number;
        minLiquidityUsd: number;
    };
    sizing: {
        maxPositionSizePercent: number;
    };
    exits: {
        takeProfitPercent: number;
        stopLossPercent: number;
        timeLimitSeconds: number;
        trailingStop: {
            activationPercent: number;
            deltaPercent: number;
        };
        thesisReviewInterval: string;
    };
};
type DaemonEvent = {
    type: 'shortlist_ready';
    candidates: ShortlistEntry[];
} | {
    type: 'thesis_break';
    position: PositionThesis;
    reason: string;
} | {
    type: 'barrier_triggered';
    position: PositionThesis;
    closeType: CloseType;
    pnlPercent: number;
} | {
    type: 'alert';
    message: string;
    severity: 'warn' | 'critical';
} | {
    type: 'deep_think_scheduled';
    reason: 'timer' | 'event';
};
type EvalMetrics = {
    verifyAccuracy: number;
    rejectAccuracy: number;
    washDetectionRate: number;
    closeTypeCounts: Partial<Record<CloseType, number>>;
    archetypeStats: Record<string, {
        trades: number;
        winRate: number;
        avgPnl: number;
    }>;
    profitFactor: number;
    avgVerifyLatencyMs: number;
    apiErrorRate: number;
    geckoUsagePercent: number;
    dexUsagePercent: number;
    thesisExitRate: number;
    thesisExitPnl: number;
    avgHoldDuration: string;
    cooldownPreventedCount: number;
};
type EvalTrace = {
    timestamp: string;
    action: 'verify' | 'buy' | 'sell' | 'review' | 'scout';
    duration_ms: number;
    toolCalls: {
        name: string;
        args: unknown;
        result: unknown;
        latency_ms: number;
    }[];
    decision: string;
    outcome?: string;
};
type Baseline = {
    capturedAt: string;
    period: string;
    metrics: {
        winRate: number;
        avgPnlPercent: number;
        maxDrawdown: number;
        tradesPerWeek: number;
    };
};
type EvalReport = {
    generatedAt: string;
    period: {
        from: string;
        to: string;
    };
    current: EvalMetrics;
    baseline: Baseline;
    comparison: {
        metric: string;
        current: number;
        baseline: number | null;
        delta: number | null;
        trend: 'improving' | 'stable' | 'degrading' | 'no_baseline';
    }[];
    alerts: string[];
};

/**
 * GeckoTerminal API client — OHLCV candles and trade history only.
 * Pool discovery, prices, and screening are handled by DexScreenerClient.
 */
declare class GeckoTerminalClient {
    private readonly limiter;
    constructor(limiter: RateLimiter);
    /** Fetch recent trades for a pool. */
    getPoolTrades(poolAddress: string, options?: {
        tradeVolumeInUsdGreaterThan?: number;
    }, priority?: RequestPriority): Promise<TradeInfo[]>;
    /** Fetch OHLCV candles for a pool (retries with cache-bust on empty response). */
    getPoolOhlcv(poolAddress: string, timeframe?: OhlcvTimeframe, limit?: number, priority?: RequestPriority): Promise<OhlcvResponse>;
    /**
     * Fetch token safety + holder info from GeckoTerminal.
     * Endpoint: GET /networks/ton/tokens/{tokenAddress}/info
     * See SPEC-V2.md Section V.
     */
    getTokenInfo(tokenAddress: string, priority?: RequestPriority): Promise<GeckoTokenInfo>;
    /**
     * Fetch pool details including unique buyers/sellers from GeckoTerminal.
     * Endpoint: GET /networks/ton/pools/{poolAddress}
     * See SPEC-V2.md Section V.
     */
    getPoolInfo(poolAddress: string, priority?: RequestPriority): Promise<GeckoPoolInfo>;
    private on429Callback?;
    /** Register a callback for 429 responses (used by QuotaManager). */
    setOn429Callback(cb: (path: string) => void): void;
    private get;
}

/** DexScreener API client for TON network with built-in rate limiting. */
declare class DexScreenerClient {
    private readonly limiter;
    constructor(limiter: RateLimiter);
    /** Search pools by keyword, filtered to TON chain. */
    searchPools(query: string, priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Fetch all pairs for a token address on TON. */
    getTokenPairs(tokenAddress: string, priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Fetch a single pair by address on TON. */
    getPair(pairAddress: string, priority?: RequestPriority): Promise<PoolInfo | null>;
    /** Fetch price for a single token (picks highest-liquidity pair). */
    getTokenPrice(tokenAddress: string, priority?: RequestPriority): Promise<TokenPrice>;
    /** Fetch prices for multiple tokens sequentially. */
    getTokenPrices(addresses: string[], priority?: RequestPriority): Promise<TokenPrice[]>;
    /**
     * Batch price query — up to 30 addresses per request.
     * Uses /latest/dex/tokens/{addr1,addr2,...addr30}.
     * Critical for position monitoring: 8 positions = 1 request instead of 8.
     * See SPEC-V2.md Section XIII.
     */
    getTokenPricesBatch(addresses: string[], priority?: RequestPriority): Promise<Map<string, TokenPrice>>;
    /** Top pools on TON sorted by 24h volume. */
    getTopPools(priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Trending (boosted) pools on TON. Falls back to getTopPools if none found. */
    getTrendingPools(priority?: RequestPriority): Promise<PoolInfo[]>;
    /** Newly profiled tokens on TON. */
    getNewPools(priority?: RequestPriority): Promise<PoolInfo[]>;
    private on429Callback?;
    /** Register a callback for 429 responses (used by QuotaManager). */
    setOn429Callback(cb: (path: string) => void): void;
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

/** Screens TON pools via DexScreener and applies client-side filters. */
declare class TokenScreener {
    private readonly dex;
    constructor(dex: DexScreenerClient);
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
 * Monitors open positions and auto-triggers TP/SL via DexScreener price feeds.
 *
 * Usage:
 * 1. Create instance with config
 * 2. Call addPosition() for each open position
 * 3. Call start() to begin the polling loop
 * 4. Call stop() to halt monitoring
 */
declare class PositionManager {
    private readonly dex;
    private readonly config;
    private readonly executeTradeCallback;
    private readonly onEvent?;
    private readonly monitorConfig?;
    private positions;
    private timer;
    private running;
    constructor(dex: DexScreenerClient, config: PositionConfig, executeTradeCallback: TradeExecutor, onEvent?: PositionEventHandler | undefined, monitorConfig?: MonitorConfig | undefined);
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
    /** GeckoTerminal client — OHLCV candles and trade history only. */
    readonly gecko: GeckoTerminalClient;
    /** DexScreener client — pool discovery, prices, screening. */
    readonly dex: DexScreenerClient;
    /** Token screener for filtering pools by criteria. */
    readonly screener: TokenScreener;
    /** Rate limiter for GeckoTerminal API (30 req/60s, OHLCV + trades only). */
    readonly geckoLimiter: RateLimiter;
    /** Rate limiter for DexScreener API (~60 req/60s). */
    readonly dexLimiter: RateLimiter;
    /** @deprecated Use geckoLimiter. Kept for backward compatibility with daemon. */
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
    findTokenByAddress(address: string): Promise<AvailableToken | null>;
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
declare function stateDirPath(): string;
declare function marketStatePath(): string;
declare function candidateRegistryPath(): string;
declare function portfolioStatePath(): string;
declare function playbooksPath(): string;
declare function cooldownPath(): string;
declare function evalReportPath(): string;
declare function reflectionLogPath(): string;
declare function evalTracesDir(): string;
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
    riskPolicy?: RiskPolicy;
};
/** Ensure data directory exists. */
declare function ensureDataDir(): void;
/** Ensure state subdirectory exists. */
declare function ensureStateDir(): void;
/** Read the config file. Returns empty config if file doesn't exist. */
declare function readConfig(): DaemonConfig;
/** Write the config file (full replace). Uses atomic write for crash safety. */
declare function writeConfig(config: DaemonConfig): void;
/** Merge partial updates into the existing config and write. */
declare function updateConfig(patch: Partial<DaemonConfig>): DaemonConfig;
/** Read the briefing file. Returns null if not found. */
declare function readBriefing(): unknown;
/** Path to the agent session lock file. */
declare function sessionLockPath(): string;
/** Touch the session lock file — signals that an agent is actively using the API. */
declare function touchSessionLock(): void;
/** Check if an agent session is active (lock file exists and is recent). */
declare function isAgentSessionActive(timeoutMs?: number): boolean;

/**
 * Resolves the effective TripleBarrierConfig for a token using the priority chain:
 *   defaultBarriers (base) → perToken config → customBarriers (LLM override, highest priority).
 *
 * Handles the type bridge between TpSlDefaults flat fields
 * (partialTakeProfitPercent / partialTakeProfitSellPercent) and
 * TripleBarrierConfig nested partialTp (triggerPercent / sellPercent).
 */
declare function resolveBarriers(tokenAddress: string, customBarriers: TripleBarrierConfig | undefined, config: DaemonConfig, riskPolicy: RiskPolicy): TripleBarrierConfig;

type DexPair = {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceNative: string;
    priceUsd: string;
    txns: {
        m5: {
            buys: number;
            sells: number;
        };
        h1: {
            buys: number;
            sells: number;
        };
        h6: {
            buys: number;
            sells: number;
        };
        h24: {
            buys: number;
            sells: number;
        };
    };
    volume: {
        m5?: number;
        h1: number;
        h6: number;
        h24: number;
    };
    priceChange: {
        m5: number;
        h1: number;
        h6: number;
        h24: number;
    };
    liquidity?: {
        usd: number;
        base: number;
        quote: number;
    };
    fdv?: number;
    marketCap?: number;
    pairCreatedAt?: number;
    info?: {
        imageUrl?: string;
        websites?: Array<{
            url: string;
        }>;
        socials?: Array<{
            type: string;
            url: string;
        }>;
    };
};

/**
 * Triple Barrier Position Manager (Section VI-A).
 * Replaces simple TP/SL with 4 barriers: SL, TP, trailing stop, time limit.
 * Evaluates ALL barriers every tick. Whichever fires first closes the position.
 *
 * API budget impact: ZERO — uses same price data already fetched by price sentry.
 */

type BarrierPosition = {
    tokenAddress: string;
    poolAddress: string;
    symbol: string;
    entryPriceUsd: number;
    entryTimestamp: string;
    quantity: string;
    barriers: TripleBarrierConfig;
    /** Peak PnL % reached (for trailing stop tracking). */
    peakPnlPercent: number;
    /** Whether trailing stop has been activated. */
    trailingStopActivated: boolean;
    /** Whether partial TP has already fired. */
    partialTpTriggered: boolean;
};
type BarrierEvent = {
    closeType: CloseType;
    tokenAddress: string;
    symbol: string;
    entryPriceUsd: number;
    currentPriceUsd: number;
    pnlPercent: number;
    sellPercent: number;
    reason: string;
};
type BarrierTradeExecutor = (tokenAddress: string, action: 'SELL', sellPercent: number) => Promise<void>;
type BarrierEventHandler = (event: BarrierEvent) => void;
declare class BarrierManager {
    private readonly dex;
    private readonly executeTradeCallback;
    private readonly onEvent?;
    private readonly intervalMs;
    private positions;
    private timer;
    private running;
    constructor(dex: DexScreenerClient, executeTradeCallback: BarrierTradeExecutor, onEvent?: BarrierEventHandler | undefined, intervalMs?: number);
    /** Register a position with barriers. */
    addPosition(pos: BarrierPosition): void;
    /** Remove a position from monitoring. */
    removePosition(tokenAddress: string): void;
    /** Get all tracked positions. */
    getPositions(): BarrierPosition[];
    /** Get a single position. */
    getPosition(tokenAddress: string): BarrierPosition | undefined;
    /** Update barriers for an existing position. */
    updateBarriers(tokenAddress: string, barriers: TripleBarrierConfig): boolean;
    /** Start the barrier evaluation loop. */
    start(): void;
    /** Stop the barrier evaluation loop. */
    stop(): void;
    get isRunning(): boolean;
    /** Single evaluation tick: fetch batch prices & check all barriers. */
    private tick;
    /**
     * Evaluate all barriers for a position.
     * Returns the first barrier that fires, or null if none.
     * Priority: stop_loss > trailing_stop > time_limit > take_profit > partial_tp
     */
    private evaluateBarriers;
}

/**
 * Safety Gate (Section VI).
 * Deterministic checks that run BEFORE trade execution.
 * LLM cannot bypass, override, or disable these gates.
 */

type SafetyContext = {
    tokenInfo: GeckoTokenInfo | null;
    poolInfo: GeckoPoolInfo | null;
    organicity: OrganicityVerdict | null;
    portfolio: PortfolioSummary;
    riskPolicy: RiskPolicy;
    cooldownMap: Map<string, CooldownEntry>;
    tokenAddress: string;
    isTradeable: boolean;
    poolAge: number | null;
    cto: boolean;
};
/**
 * Run all safety gate checks. Returns verdict with rejects and penalties.
 * If any hard reject fires, the trade is impossible.
 * Penalties reduce position size multiplicatively.
 */
declare function checkSafety(ctx: SafetyContext): SafetyCheckResult;

/**
 * Anti-Wash Detection (Section VII).
 * Mandatory step in verify_candidate. Without passing, a candidate cannot be verified.
 */

/**
 * Check organicity of trading activity for a pool.
 *
 * @param poolInfo - Pool info from GeckoTerminal (for unique buyer/seller counts)
 * @param trades - Recent trade history from GeckoTerminal (for wallet analysis)
 * @returns OrganicityVerdict with signals and verdict
 */
declare function checkOrganicity(poolInfo: GeckoPoolInfo, trades: TradeInfo[]): OrganicityVerdict;

/**
 * Central Quota Manager (Section IV).
 * Replaces coarse session lock. Daemon and agent both operate through QuotaManager.
 * Tracks per-queue API usage and enforces budget allocation.
 */
type QuotaQueue = 'critical' | 'verify' | 'scout' | 'background';
type QueueAllocation = Record<QuotaQueue, number>;
type QuotaBudget = {
    gecko: {
        used: number;
        limit: number;
        free: number;
        windowResetAt: string;
        perQueue: Record<QuotaQueue, number>;
    };
    dex: {
        used: number;
        limit: number;
        free: number;
        windowResetAt: string;
        perQueue: Record<QuotaQueue, number>;
    };
};
declare class QuotaManager {
    private gecko;
    private dex;
    private agentLastActive;
    constructor(geckoRpm?: number, dexRpm?: number);
    private createTracker;
    /** Configure budget allocation for an API. */
    configure(allocation: {
        gecko?: Partial<QueueAllocation>;
        dex?: Partial<QueueAllocation>;
    }): void;
    /**
     * Acquire a slot for an API request.
     * Returns immediately if budget available, waits if not.
     */
    acquire(api: 'gecko' | 'dex', queue: QuotaQueue): Promise<void>;
    /** Record that a request was made (for external tracking). */
    record(api: 'gecko' | 'dex', queue: QuotaQueue): void;
    /** Report a 429 overage. Feedback from on429 callbacks. */
    reportOverage(api: 'gecko' | 'dex'): void;
    /** Get current budget state. */
    getState(): QuotaBudget;
    /** Mark agent as active (replaces session lock check). */
    touchAgentActive(): void;
    /** Check if agent is active (within last 5 minutes). */
    isAgentActive(timeoutMs?: number): boolean;
    private maybeResetWindow;
}

/**
 * verify_candidate pipeline (Section XI).
 * Replaces analyze_pool with 4-call GeckoTerminal verification.
 * Includes 5-minute TTL cache to avoid redundant calls.
 */

type CacheEntry = {
    tokenInfo: GeckoTokenInfo;
    poolInfo: GeckoPoolInfo;
    timestamp: number;
};
/** Get cached verify data if still valid. */
declare function getCachedVerifyData(tokenAddress: string): CacheEntry | null;
/** Clear expired entries from cache. */
declare function cleanVerifyCache(): void;
/**
 * Run the full 4-call verify pipeline.
 * 1. getTokenInfo(tokenAddress) -> safety + holders
 * 2. getPoolInfo(poolAddress) -> liquidity, unique buyers/sellers, volume
 * 3. getPoolTrades(poolAddress) -> trade flow, wallet concentration
 * 4. getPoolOhlcv(poolAddress) -> price structure
 *
 * @returns VerificationResult with safety, organicity, momentum, execution data
 */
declare function verifyCandidate(gecko: GeckoTerminalClient, tokenAddress: string, poolAddress: string, dexId: string, poolCreatedAt?: string): Promise<VerificationResult>;

/**
 * Computed Signals (Section V-A) and Confidence Summary (Section V-B).
 * Derived metrics from raw API data — zero additional API calls.
 */

/**
 * Compute derived signals from raw market data.
 * Scout phase: volumeAcceleration + buyPressure only (DexScreener data).
 * Verify phase: adds buyerAcceleration (GeckoTerminal data).
 */
declare function computeSignals(pool: PoolInfo | null, geckoPool: GeckoPoolInfo | null): ComputedSignals;
/**
 * Build confidence summary from all verification data.
 * Informational only — NOT a gate or position size multiplier.
 */
declare function buildConfidence(tokenInfo: GeckoTokenInfo | null, geckoPool: GeckoPoolInfo | null, signals: ComputedSignals, organicity: OrganicityVerdict): ConfidenceSummary;

/**
 * Atomic JSON write: write to tmp file, then rename.
 * Safe against daemon crashes — either old or new file remains intact.
 * See SPEC-V2.md Section X.
 */
declare function atomicWriteJsonSync(filePath: string, data: unknown): void;

/**
 * Cooldown mechanism (Section VI-C).
 * Prevents re-buying a token after SL/thesis_exit/safety_degradation.
 * Persisted to ~/.tractioneye/state/cooldown.json via atomic writes.
 */

declare class CooldownManager {
    private entries;
    constructor();
    /** Load cooldown state from disk. Filters out expired entries. */
    private loadFromDisk;
    /** Save current state to disk atomically. */
    private saveToDisk;
    /**
     * Record a position close. Adds cooldown entry if close type triggers cooldown.
     */
    recordClose(tokenAddress: string, closeType: CloseType): void;
    /**
     * Check if a token is in cooldown.
     * @param tokenAddress - Token to check
     * @param cooldownMinutes - Cooldown duration in minutes
     * @returns true if token is in cooldown
     */
    isInCooldown(tokenAddress: string, cooldownMinutes: number): boolean;
    /** Get cooldown entry for a token (or undefined). */
    getEntry(tokenAddress: string): CooldownEntry | undefined;
    /** Get all active cooldown entries as a Map. */
    getMap(): Map<string, CooldownEntry>;
    /** Get all active entries with remaining time info. */
    getActiveCooldowns(cooldownMinutes: number): {
        tokenAddress: string;
        cooldownUntil: string;
        closeType: CloseType;
    }[];
    /** Remove expired entries. Called during daily cleanup. */
    cleanupExpired(cooldownMinutes: number): number;
}

/**
 * market_state.json management (Section 10.1).
 * Replaces briefing.json. During migration Phase 1, daemon writes to BOTH files.
 */

/** Read market state. Returns null if file doesn't exist. */
declare function readMarketState(): MarketState | null;
/**
 * Write market state. Also writes briefing.json in parallel (migration Phase 1).
 * See SPEC-V2.md Section X: briefing.json is NOT removed immediately.
 */
declare function writeMarketState(state: MarketState): void;

/**
 * candidate_registry.json management (Section 10.2).
 * State machine for candidate lifecycle.
 */

/** Read candidate registry. Returns empty registry if file doesn't exist. */
declare function readCandidateRegistry(): CandidateRegistry;
/** Write candidate registry atomically. */
declare function writeCandidateRegistry(registry: CandidateRegistry): void;
/** Add or update a candidate entry. */
declare function upsertCandidate(registry: CandidateRegistry, entry: CandidateEntry): void;
/** Transition candidate state. */
declare function transitionCandidate(registry: CandidateRegistry, tokenAddress: string, newState: CandidateState, extra?: {
    verification?: VerificationResult;
    rejectionReason?: string;
    archetype?: string;
}): boolean;
/**
 * Clean up expired entries.
 * Rejected: TTL 24 hours. Bought: TTL 7 days.
 */
declare function cleanupCandidates(registry: CandidateRegistry): number;
/** Create a new candidate entry with standard TTL. */
declare function createCandidateEntry(tokenAddress: string, poolAddress: string, symbol: string, dexId: string, tags: string[]): CandidateEntry;

/**
 * portfolio_state.json management (Section 10.3).
 * Tracks position thesis, barriers, and exit events.
 */

/** Read portfolio state. Returns empty state if file doesn't exist. */
declare function readPortfolioState(): PortfolioState;
/** Write portfolio state atomically. */
declare function writePortfolioState(state: PortfolioState): void;
/** Add a new position to portfolio state. */
declare function addPosition(state: PortfolioState, thesis: PositionThesis): void;
/** Update barriers for an existing position. */
declare function updatePositionBarriers(state: PortfolioState, tokenAddress: string, barriers: TripleBarrierConfig): boolean;
/** Update thesis status for a position. */
declare function updateThesisStatus(state: PortfolioState, tokenAddress: string, status: 'intact' | 'weakening' | 'broken'): boolean;
/** Record an exit event for a position. */
declare function recordExitEvent(state: PortfolioState, tokenAddress: string, closeType: CloseType, pnlPercent: number, soldPercent: number, reason: string): boolean;

/**
 * playbooks.json management (Section IX, 10.4).
 * DEX-specific playbooks with barrier defaults per archetype.
 */

/** Default DEX-specific configurations (Section IX). */
declare const DEX_DEFAULTS: Record<string, DexDefaults>;
/** Read playbooks. Returns defaults if file doesn't exist. */
declare function readPlaybooks(): Playbooks;
/** Write playbooks atomically. */
declare function writePlaybooks(playbooks: Playbooks): void;
/** Update stats for a specific archetype after a trade closes. */
declare function updateArchetypeStats(playbooks: Playbooks, archetype: string, pnlPercent: number): boolean;

/**
 * reflection_log.jsonl management (Section 10.5).
 * Append-only log of agent reflections, lessons, and trade reviews.
 */

/** Append a reflection entry to the log. */
declare function appendReflection(entry: ReflectionEntry): void;
/** Read all reflection entries. Returns empty array if file doesn't exist. */
declare function readReflections(): ReflectionEntry[];
/** Read reflections within a time range. */
declare function readReflectionsInRange(from: Date, to: Date): ReflectionEntry[];

/**
 * Tool response projections.
 * Strips raw data (OHLCV candles, trade arrays, full PoolInfo) from tool responses
 * to reduce LLM token consumption while preserving all actionable information.
 */

type FullProjectedPoolInfo = Omit<PoolInfo, 'name' | 'socials' | 'websites' | 'priceNative' | 'baseTokenPriceUsd'> & {
    symbol: string;
    tokenAddress: string;
};
type CompactPoolInfo = {
    poolAddress: string;
    tokenAddress: string;
    symbol: string;
    dexId: string;
    tags: string[];
    reserveInUsd: number;
    fdvUsd: number | null;
    marketCapUsd: number | null;
    volume1hUsd: number;
    volume24hUsd: number;
    priceChange1h: number;
    priceChange24h: number;
    buys1h: number;
    sells1h: number;
    buySellRatio: number;
    uniqueBuyers1h: number;
    lockedLiquidityPercent: number | null;
    boostTotalAmount: number;
    cto: boolean;
    createdAt: string;
};
type MarketBriefing = {
    updatedAt: string;
    marketRegime: MarketRegime;
    tonPriceUsd: number;
    candidates: ShortlistEntry[];
    topLists: MarketState['topLists'];
    pendingVerifications: string[];
    openPositionReviews: MarketState['openPositionReviews'];
    cooldownTokens: MarketState['cooldownTokens'];
    apiUsage: MarketState['apiUsage'];
};
type SlimOrganicity = {
    verdict: OrganicityVerdict['verdict'];
    score: number;
    failedSignals: string[];
};

/**
 * Eval Block (Section XIV).
 * Extended metrics calculated from Agent Kit's own data.
 * Base PnL comes from TractionEye backend (not duplicated here).
 */

/**
 * Calculate extended eval metrics from reflection log and playbook stats.
 * @param cooldownPreventedCount - number of re-buys blocked by cooldown
 * @param windowDays - sliding window in days (default: 7). Only trades within this window are counted for alerts and close type histogram.
 */
declare function calculateEvalMetrics(cooldownPreventedCount?: number, windowDays?: number): EvalMetrics;
/**
 * Generate eval report comparing current metrics to baseline.
 */
declare function generateEvalReport(baseline: Baseline, cooldownPreventedCount?: number): EvalReport;
/**
 * Capture current performance as baseline (at v2 launch).
 */
declare function captureBaseline(winRate: number, avgPnlPercent: number, maxDrawdown: number, tradesPerWeek: number): Baseline;

export { type AvailableToken, type BarrierEvent, type BarrierEventHandler, BarrierManager, type BarrierPosition, type BarrierTradeExecutor, type Baseline, type CandidateEntry, type CandidateRegistry, type CandidateState, type CloseType, type CompactPoolInfo, type ComputedSignals, type ConfidenceSummary, type CooldownEntry, CooldownManager, type CooldownState, type CreatePositionAction, DEFAULT_DATA_DIR, DEFAULT_RISK_POLICY, DEX_DEFAULTS, type DaemonConfig, type DaemonEvent, type DexDefaults, type DexPair, DexScreenerClient, type EvalMetrics, type EvalReport, type EvalTrace, type FullProjectedPoolInfo, type GeckoPoolInfo, GeckoTerminalClient, type GeckoTokenInfo, type MarketBriefing, type MarketRegime, type MarketState, type MonitorConfig, type OhlcvCandle, type OhlcvMeta, type OhlcvResponse, type OhlcvTimeframe, type OperationStatus, type OperationStatusType, type OrganicitySignal, type OrganicityVerdict, type PenaltyId, type PlaybookEntry, type Playbooks, type PoolInfo, type PortfolioState, type PortfolioSummary, type PositionAction, type PositionConfig, type PositionEvent, PositionManager, type PositionThesis, type QuotaBudget, QuotaManager, type QuotaQueue, RateLimiter, type ReflectionEntry, RequestPriority, type RiskPolicy, type SafetyCheckResult, type SafetyContext, type SafetyRejectId, type ScreeningConfig, type ScreeningFilter, type ScreeningSource, type ShortlistEntry, type SimulationResult, Simulator, type SlimOrganicity, type StopPositionAction, type StorePositionAction, type StoredMomentum, type StoredVerificationResult, type StrategySummary, type TokenPrice, TokenScreener, type TokenSummary, type TpSlConfig, type TpSlDefaults, type TrackedPosition, TractionEyeClient, type TractionEyeClientConfig, TractionEyeHttpError, type TradeAction, type TradeExecution, type TradeExecutionRequest, type TradeInfo, type TradePreview, type TradePreviewRequest, type TripleBarrierConfig, type ValidationOutcome, type VerificationResult, type VirtualTrade, addPosition, appendReflection, atomicWriteJsonSync, briefingPath, buildConfidence, calculateEvalMetrics, candidateRegistryPath, captureBaseline, checkOrganicity, checkSafety, cleanVerifyCache, cleanupCandidates, computeSignals, configPath, cooldownPath, createCandidateEntry, createTractionEyeTools, ensureDataDir, ensureStateDir, evalReportPath, evalTracesDir, generateEvalReport, getCachedVerifyData, isAgentSessionActive, marketStatePath, playbooksPath, portfolioStatePath, readBriefing, readCandidateRegistry, readConfig, readMarketState, readPlaybooks, readPortfolioState, readReflections, readReflectionsInRange, recordExitEvent, reflectionLogPath, resolveBarriers, sessionLockPath, stateDirPath, touchSessionLock, transitionCandidate, updateArchetypeStats, updateConfig, updatePositionBarriers, updateThesisStatus, upsertCandidate, verifyCandidate, writeCandidateRegistry, writeConfig, writeMarketState, writePlaybooks, writePortfolioState };
