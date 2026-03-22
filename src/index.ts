// Core
export { TractionEyeClient, createTractionEyeTools } from './client.js';
export type {
  TractionEyeClientConfig,
  StrategySummary,
  TokenSummary,
  PortfolioSummary,
  AvailableToken,
  TradeAction,
  TradeRequest,
  TradePreview,
  TradeResult,
  OperationStatus,
} from './types/contracts.js';

// Rate limiter
export { RateLimiter, RequestPriority } from './rate-limiter.js';

// GeckoTerminal
export { GeckoTerminalClient } from './gecko/index.js';
export type { PoolInfo, TokenPrice } from './gecko/index.js';

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

// Simulation
export { Simulator } from './simulation/index.js';
export type { VirtualTrade, SimulationResult } from './simulation/index.js';
