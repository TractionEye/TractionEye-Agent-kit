// ---- TractionEye Agent Kit v2 Types ----
// See SPEC-V2.md for full specification.

import type { OhlcvCandle } from '../gecko/types.js';

// ---- CloseType Enum (Section VI-A-1) ----

export type CloseType =
  | 'stop_loss'
  | 'take_profit'
  | 'partial_tp'
  | 'trailing_stop'
  | 'time_limit'
  | 'thesis_exit'
  | 'safety_degradation'
  | 'manual'
  | 'failed';

// ---- Triple Barrier (Section VI-A) ----

export type TripleBarrierConfig = {
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

// ---- Action Pattern (Section VI-B) ----

export type PositionAction =
  | CreatePositionAction
  | StopPositionAction
  | StorePositionAction;

export type CreatePositionAction = {
  type: 'create';
  tokenAddress: string;
  poolAddress: string;
  amountNano: string;
  slippageTolerance?: number;
  barriers: TripleBarrierConfig;
  archetype: string;
  entryReason: string;
};

export type StopPositionAction = {
  type: 'stop';
  tokenAddress: string;
  closeType: CloseType;
  reason: string;
  sellPercent: number;
};

export type StorePositionAction = {
  type: 'store';
  tokenAddress: string;
};

// ---- Risk Policy (Section VI) ----

export type RiskPolicy = {
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

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  maxOpenPositions: 5,
  maxTotalExposurePercent: 80,
  maxPerTokenPercent: 15,
  maxPriceImpactPercent: 5,
  minLockedLiquidityPercent: 10,
  minHoldersCount: 50,
  maxTop10HoldersPercent: 60,
  cooldownAfterExitMinutes: 120,
  defaultBarriers: {
    stopLossPercent: 10,
    takeProfitPercent: 25,
    timeLimitSeconds: 7200,
    trailingStop: { activationPercent: 15, deltaPercent: 5 },
    partialTp: { triggerPercent: 15, sellPercent: 30 },
  },
  version: 1,
  updatedAt: new Date().toISOString(),
};

// ---- Safety Gate (Section VI) ----

export type SafetyRejectId =
  | 'HONEYPOT'
  | 'MINT_AUTHORITY'
  | 'FREEZE_AUTHORITY'
  | 'DUPLICATE_POSITION'
  | 'POSITION_CAP'
  | 'EXPOSURE_CAP'
  | 'NOT_TRADEABLE'
  | 'ZERO_LIQUIDITY'
  | 'WASH_CONFIRMED'
  | 'COOLDOWN';

export type PenaltyId =
  | 'HIGH_CONCENTRATION'
  | 'LOW_HOLDERS'
  | 'LOW_LOCKED_LIQUIDITY'
  | 'TOO_FRESH'
  | 'CTO_TOKEN'
  | 'HONEYPOT_UNKNOWN'
  | 'SUSPICIOUS_ORGANICITY';

export type SafetyCheckResult = {
  verdict: 'pass' | 'reject' | 'warning';
  rejects: { id: SafetyRejectId; reason: string }[];
  penalties: { id: PenaltyId; multiplier: number; reason: string }[];
  finalMultiplier: number;
};

// ---- Anti-Wash / Organicity (Section VII) ----

export type OrganicitySignal = {
  name: string;
  value: number;
  threshold: number;
  passed: boolean;
};

export type OrganicityVerdict = {
  verdict: 'organic' | 'suspicious' | 'wash';
  score: number;
  signals: OrganicitySignal[];
};

// ---- Computed Signals (Section V-A) ----

export type ComputedSignals = {
  volumeAcceleration: number | null;
  buyPressure: number | null;
  buyerAcceleration: number | null;
};

// ---- Confidence Summary (Section V-B) ----

export type ConfidenceSummary = {
  score: number;
  confirmingSignals: string[];
  contradictingSignals: string[];
};

// ---- GeckoTerminal Token Info (Section V) ----

export type GeckoTokenInfo = {
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
  socials: { type: string; url: string }[];
};

// ---- GeckoTerminal Pool Info (Section V) ----

export type GeckoPoolInfo = {
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
    m5: { buys: number; sells: number; buyers: number; sellers: number };
    m15: { buys: number; sells: number; buyers: number; sellers: number };
    m30: { buys: number; sells: number; buyers: number; sellers: number };
    h1: { buys: number; sells: number; buyers: number; sellers: number };
    h6: { buys: number; sells: number; buyers: number; sellers: number };
    h24: { buys: number; sells: number; buyers: number; sellers: number };
  };
  poolCreatedAt: string;
};

// ---- Verification Result (Section XI) ----

export type VerificationResult = {
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

// ---- Stored Verification (ohlcv stripped for disk + LLM savings) ----

export type StoredMomentum = {
  buyPressure: number;
  volumeRatio1h: number;
  volumeRatio5h: number;
  priceChange1h: number;
  priceChange5h: number;
  avgCandleRange1h: number;
  avgCandleRange5h: number;
};

export type StoredVerificationResult = Omit<VerificationResult, 'momentum'> & {
  momentum: StoredMomentum;
};

// ---- Cooldown (Section VI-C) ----

export type CooldownEntry = {
  tokenAddress: string;
  exitTimestamp: string;
  closeType: CloseType;
};

export type CooldownState = {
  entries: Record<string, CooldownEntry>;
};

// ---- Position Thesis (Section 10.3) ----

export type PositionThesis = {
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
  partialTpTriggered: boolean;
  exitEvents: {
    timestamp: string;
    type: CloseType;
    pnlPercent: number;
    soldPercent: number;
    reason: string;
  }[];
};

// ---- Portfolio State (Section 10.3) ----

export type PortfolioState = {
  updatedAt: string;
  positions: Record<string, PositionThesis>;
};

// ---- Market State (Section 10.1) ----

export type ShortlistEntry = {
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

export type MarketRegime = 'active' | 'quiet' | 'volatile';

export type MarketState = {
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
    gecko: { used: number; limit: number; windowResetAt: string };
    dex: { used: number; limit: number; windowResetAt: string };
  };
};

// ---- Candidate Registry (Section 10.2) ----

export type CandidateState =
  | 'discovered'
  | 'shortlisted'
  | 'verifying'
  | 'verified'
  | 'rejected'
  | 'watching'
  | 'bought';

export type CandidateEntry = {
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

export type CandidateRegistry = {
  candidates: Record<string, CandidateEntry>;
};

// ---- Reflection Log (Section 10.5) ----

export type ReflectionEntry = {
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

// ---- Playbooks (Section IX) ----

export type PlaybookEntry = {
  name: string;
  description: string;
  signals: { field: string; condition: string; threshold: unknown }[];
  params: {
    entryThresholds: {
      minBuyerDiversity: number;
      minVolume1h: number;
      minGtScore: number | null;
    };
    sizing: { positionSizePercent: number; maxPerToken: number };
    exits: {
      takeProfitPercent: number;
      stopLossPercent: number;
      timeLimitSeconds: number | null;
      trailingStop: { activationPercent: number; deltaPercent: number } | null;
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

export type Playbooks = {
  updatedAt: string;
  version: number;
  archetypes: Record<string, PlaybookEntry>;
};

// ---- DEX Defaults (Section IX) ----

export type DexDefaults = {
  entryThresholds: {
    minBuyerDiversityRatio: number;
    minVolume1hUsd: number;
    minLiquidityUsd: number;
  };
  sizing: { maxPositionSizePercent: number };
  exits: {
    takeProfitPercent: number;
    stopLossPercent: number;
    timeLimitSeconds: number;
    trailingStop: { activationPercent: number; deltaPercent: number };
    thesisReviewInterval: string;
  };
};

// ---- Daemon Event Bus (Section III) ----

export type DaemonEvent =
  | { type: 'shortlist_ready'; candidates: ShortlistEntry[] }
  | { type: 'thesis_break'; position: PositionThesis; reason: string }
  | { type: 'barrier_triggered'; position: PositionThesis; closeType: CloseType; pnlPercent: number }
  | { type: 'alert'; message: string; severity: 'warn' | 'critical' }
  | { type: 'deep_think_scheduled'; reason: 'timer' | 'event' };

// ---- Eval (Section XIV) ----

export type EvalMetrics = {
  verifyAccuracy: number;
  rejectAccuracy: number;
  washDetectionRate: number;
  closeTypeCounts: Partial<Record<CloseType, number>>;
  archetypeStats: Record<string, { trades: number; winRate: number; avgPnl: number }>;
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

export type EvalTrace = {
  timestamp: string;
  action: 'verify' | 'buy' | 'sell' | 'review' | 'scout';
  duration_ms: number;
  toolCalls: { name: string; args: unknown; result: unknown; latency_ms: number }[];
  decision: string;
  outcome?: string;
};

export type Baseline = {
  capturedAt: string;
  period: string;
  metrics: {
    winRate: number;
    avgPnlPercent: number;
    maxDrawdown: number;
    tradesPerWeek: number;
  };
};

export type EvalReport = {
  generatedAt: string;
  period: { from: string; to: string };
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
