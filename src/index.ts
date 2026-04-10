// Core
export { TractionEyeClient } from './client.js';
export { TractionEyeHttpError } from './http/client.js';
export { createTractionEyeTools } from './tools/index.js';
export { resolveBarriers } from './tools/barriers.js';
export type {
  TractionEyeClientConfig,
  StrategySummary,
  TokenSummary,
  PortfolioSummary,
  AvailableToken,
  TradeAction,
  TradePreviewRequest,
  TradePreview,
  ValidationOutcome,
  TradeExecutionRequest,
  TradeExecution,
  OperationStatusType,
  OperationStatus,
} from './types/contracts.js';

// Rate limiter
export { RateLimiter, RequestPriority } from './rate-limiter.js';

// GeckoTerminal (OHLCV + trades only)
export { GeckoTerminalClient } from './gecko/index.js';
export type {
  PoolInfo,
  TokenPrice,
  TradeInfo,
  OhlcvCandle,
  OhlcvResponse,
  OhlcvMeta,
  OhlcvTimeframe,
} from './gecko/index.js';

// DexScreener (pool discovery, prices, screening)
export { DexScreenerClient } from './dexscreener/index.js';
export type { DexPair } from './dexscreener/index.js';

// Config
export {
  DEFAULT_DATA_DIR,
  configPath,
  briefingPath,
  sessionLockPath,
  readConfig,
  writeConfig,
  updateConfig,
  readBriefing,
  ensureDataDir,
  touchSessionLock,
  isAgentSessionActive,
} from './config.js';
export type { DaemonConfig, TpSlConfig, TpSlDefaults } from './config.js';

// Screening
export { TokenScreener } from './screening/index.js';
export type { ScreeningConfig, ScreeningFilter, ScreeningSource } from './screening/index.js';

// Position management
export { PositionManager } from './position/index.js';
export type {
  PositionConfig,
  MonitorConfig,
  TrackedPosition,
  PositionEvent,
} from './position/index.js';

// v2: Triple Barrier position management
export { BarrierManager } from './position/index.js';
export type {
  BarrierPosition,
  BarrierEvent,
  BarrierTradeExecutor,
  BarrierEventHandler,
} from './position/index.js';

// Simulation
export { Simulator } from './simulation/index.js';
export type { VirtualTrade, SimulationResult } from './simulation/index.js';

// v2: Safety gates
export { checkSafety, checkOrganicity } from './safety/index.js';
export type { SafetyContext } from './safety/index.js';

// v2: Quota manager
export { QuotaManager } from './quota/index.js';
export type { QuotaQueue, QuotaBudget } from './quota/index.js';

// v2: Verify pipeline
export { verifyCandidate, getCachedVerifyData, cleanVerifyCache, computeSignals, buildConfidence } from './verify/index.js';

// v2: State management
export {
  atomicWriteJsonSync,
  CooldownManager,
  readMarketState,
  writeMarketState,
  readCandidateRegistry,
  writeCandidateRegistry,
  upsertCandidate,
  transitionCandidate,
  cleanupCandidates,
  createCandidateEntry,
  readPortfolioState,
  writePortfolioState,
  addPosition,
  updatePositionBarriers,
  updateThesisStatus,
  recordExitEvent,
  readPlaybooks,
  writePlaybooks,
  updateArchetypeStats,
  DEX_DEFAULTS,
  appendReflection,
  readReflections,
  readReflectionsInRange,
} from './state/index.js';

// v2: Config extensions
export {
  stateDirPath,
  marketStatePath,
  candidateRegistryPath,
  portfolioStatePath,
  playbooksPath,
  cooldownPath,
  evalReportPath,
  reflectionLogPath,
  evalTracesDir,
  ensureStateDir,
} from './config.js';

// v2: Types
export type {
  CloseType,
  TripleBarrierConfig,
  RiskPolicy,
  SafetyRejectId,
  PenaltyId,
  SafetyCheckResult,
  OrganicitySignal,
  OrganicityVerdict,
  ComputedSignals,
  ConfidenceSummary,
  GeckoTokenInfo,
  GeckoPoolInfo,
  VerificationResult,
  CooldownEntry,
  CooldownState,
  PositionThesis,
  PortfolioState,
  ShortlistEntry,
  MarketRegime,
  MarketState,
  CandidateState,
  CandidateEntry,
  CandidateRegistry,
  ReflectionEntry,
  PlaybookEntry,
  Playbooks,
  DexDefaults,
  DaemonEvent,
  PositionAction,
  CreatePositionAction,
  StopPositionAction,
  StorePositionAction,
  StoredMomentum,
  StoredVerificationResult,
} from './types/v2.js';
export type {
  EvalMetrics,
  EvalTrace,
  EvalReport,
  Baseline,
} from './types/v2.js';

// v2: Projection types
export type {
  FullProjectedPoolInfo,
  CompactPoolInfo,
  MarketBriefing,
  SlimOrganicity,
} from './tools/projection.js';

// v2: Eval
export { calculateEvalMetrics, generateEvalReport, captureBaseline } from './eval/index.js';
export { DEFAULT_RISK_POLICY } from './types/v2.js';
