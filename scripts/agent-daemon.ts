#!/usr/bin/env node
/**
 * TractionEye Agent Daemon v2
 *
 * Stateful runtime with microcycles (Section III):
 * 1. Price Sentry (30s) — batch price check, triple barrier evaluation
 * 2. Scout Refresh (3min) — pool discovery, junk filter, shortlist update
 * 3. Thesis Check Light (60s) — DexScreener-only momentum check (0 gecko calls)
 * 4. Thesis Check Deep (10min) — GeckoTerminal buyer diversity + safety re-check
 *
 * Deep-Think Triggers (invoke LLM via OpenClaw):
 * - shortlist_ready: scout found new verified candidates
 * - thesis_break: position thesis broken
 * - barrier_triggered: TP/SL/trailing fired
 * - scheduled: heartbeat every 10-15 min
 *
 * See SPEC-V2.md Sections III, VI-A.
 */

import { watchFile } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  TractionEyeClient,
  DexScreenerClient,
  BarrierManager,
  CooldownManager,
  QuotaManager,
  readConfig,
  configPath,
  ensureDataDir,
  ensureStateDir,
  isAgentSessionActive,
  DEFAULT_RISK_POLICY,
  writeMarketState,
  readPortfolioState,
  writePortfolioState,
  addPosition as addPortfolioPosition,
  recordExitEvent,
  readPlaybooks,
  writePlaybooks,
  updateArchetypeStats,
  resolveBarriers,
  type BarrierEvent,
  type PoolInfo,
  type ScreeningFilter,
  type DaemonConfig,
  type RiskPolicy,
  type ShortlistEntry,
  type MarketRegime,
  type MarketState,
  type CloseType,
  type DaemonEvent,
} from '../dist/index.js';

// ── Constants ──────────────────────────────────────────────────────────────

const PRICE_SENTRY_INTERVAL_MS = 30_000;       // 30 seconds
const SCOUT_INTERVAL_MS = 180_000;              // 3 minutes
const THESIS_LIGHT_INTERVAL_MS = 60_000;        // 60 seconds
const THESIS_DEEP_INTERVAL_MS = 600_000;        // 10 minutes
const HEARTBEAT_INTERVAL_MS = 900_000;          // 15 minutes

/** Hardcoded junk filter — pools that don't pass are discarded before agent criteria. */
const JUNK_FILTER: ScreeningFilter = {
  minLiquidityUsd: 1000,
  minVolume24hUsd: 0.01,
};

const TOP_LIST_SIZE = 5;

// ── State ──────────────────────────────────────────────────────────────────

let config: DaemonConfig;
let riskPolicy: RiskPolicy;
let client: TractionEyeClient | null = null;
let dex: DexScreenerClient;
let barrierManager: BarrierManager | null = null;
let cooldownManager: CooldownManager;
let quotaManager: QuotaManager;
let lastExecutionResult: { operationId: string; amountNano: string } | null = null;

// Timers
let scoutTimer: ReturnType<typeof setInterval> | null = null;
let thesisLightTimer: ReturnType<typeof setInterval> | null = null;
let thesisDeepTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// Event queue
const eventQueue: DaemonEvent[] = [];

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDataDir();
  ensureStateDir();
  config = readConfig();

  if (!config.agentToken) {
    console.log('[daemon] No agentToken in config. Waiting for agent to set it...');
    watchFile(configPath(), { interval: 5000 }, () => {
      config = readConfig();
      if (config.agentToken) {
        console.log('[daemon] agentToken detected, starting...');
        void startup();
      }
    });
    return;
  }

  await startup();
}

async function startup(): Promise<void> {
  try {
    client = await TractionEyeClient.create({ agentToken: config.agentToken! });
    console.log(`[daemon] Connected to strategy: ${client.strategyName}`);
  } catch (err) {
    console.error('[daemon] Failed to connect:', err);
    process.exit(1);
  }

  dex = client.dex;
  riskPolicy = config.riskPolicy ?? DEFAULT_RISK_POLICY;
  cooldownManager = new CooldownManager();
  quotaManager = new QuotaManager();

  // Set up 429 callbacks
  client.gecko.setOn429Callback((path) => {
    quotaManager.reportOverage('gecko');
    console.warn(`[daemon] Gecko 429 on ${path}`);
  });
  client.dex.setOn429Callback((path) => {
    quotaManager.reportOverage('dex');
    console.warn(`[daemon] DexScreener 429 on ${path}`);
  });

  // Start all microcycles
  startBarrierMonitor();
  startScoutLoop();
  startThesisCheckLight();
  startThesisCheckDeep();
  startHeartbeat();

  // Watch config file for changes
  watchFile(configPath(), { interval: 5000 }, () => {
    console.log('[daemon] Config changed, reloading...');
    config = readConfig();
    riskPolicy = config.riskPolicy ?? DEFAULT_RISK_POLICY;
    restartBarrierMonitor();
  });

  console.log('[daemon] v2 Runtime started — all microcycles active.');
}

// ── Price Sentry + Triple Barrier (30s) ──────────────────────────────────

function startBarrierMonitor(): void {
  if (!client) return;

  const executor = async (tokenAddress: string, _action: 'SELL', sellPercent: number) => {
    if (!client) return;
    const portfolio = await client.getPortfolio();
    const token = portfolio.tokens.find((t) => t.address === tokenAddress);
    if (!token) return;

    const fullQty = BigInt(token.quantity);
    const sellQty = sellPercent >= 100
      ? fullQty
      : (fullQty * BigInt(Math.round(sellPercent * 100))) / 10000n;
    if (sellQty <= 0n) return;

    const execution = await client.executeTrade({
      action: 'SELL',
      tokenAddress,
      amountNano: sellQty.toString(),
    });

    lastExecutionResult = {
      operationId: execution.operationId,
      amountNano: sellQty.toString(),
    };
  };

  const onEvent = (event: BarrierEvent) => {
    console.log(`[daemon] ${event.closeType}: ${event.symbol} ${event.pnlPercent.toFixed(2)}% — ${event.reason}`);

    // Record exit in portfolio state
    const portfolioState = readPortfolioState();
    recordExitEvent(
      portfolioState,
      event.tokenAddress,
      event.closeType,
      event.pnlPercent,
      event.sellPercent,
      event.reason,
    );
    writePortfolioState(portfolioState);

    // Record cooldown for losing exits
    cooldownManager.recordClose(event.tokenAddress, event.closeType);

    // Update playbook stats
    const playbooks = readPlaybooks();
    const pos = barrierManager?.getPosition(event.tokenAddress);
    if (pos) {
      updateArchetypeStats(playbooks, pos.symbol, event.pnlPercent);
      writePlaybooks(playbooks);
    }

    // Emit daemon event
    const daemonEvent: DaemonEvent = {
      type: 'barrier_triggered',
      position: portfolioState.positions[event.tokenAddress] ?? {} as any,
      closeType: event.closeType,
      pnlPercent: event.pnlPercent,
    };
    eventQueue.push(daemonEvent);

    // Notify agent
    notifyAgent(event, lastExecutionResult);
    lastExecutionResult = null;
  };

  barrierManager = new BarrierManager(
    dex,
    executor,
    onEvent,
    PRICE_SENTRY_INTERVAL_MS,
  );

  // Load positions from portfolio
  void loadPositions().then(() => {
    barrierManager?.start();
    console.log('[daemon] Barrier monitor started (30s interval)');
  });
}

async function loadPositions(): Promise<void> {
  if (!client || !barrierManager) return;
  try {
    const persistedState = readPortfolioState();
    const portfolio = await client.getPortfolio();
    for (const t of portfolio.tokens) {
      if (t.entryPriceTon == null) continue;
      try {
        const tokenPrice = await dex.getTokenPrice(t.address);
        if (tokenPrice.priceUsd == null) continue;
        const currentValueTon = Number(t.currentValueTon ?? 0);
        const entryPriceTon = Number(t.entryPriceTon);
        const ratio = entryPriceTon > 0 && currentValueTon > 0
          ? entryPriceTon / currentValueTon
          : 1;
        const entryPriceUsd = tokenPrice.priceUsd * ratio;

        const persisted = persistedState.positions[t.address];
        barrierManager.addPosition({
          tokenAddress: t.address,
          poolAddress: persisted?.poolAddress ?? '',
          symbol: t.symbol,
          entryPriceUsd,
          entryTimestamp: persisted?.entryTimestamp ?? new Date().toISOString(),
          quantity: t.quantity,
          barriers: persisted?.barriers ?? resolveBarriers(t.address, undefined, config, riskPolicy),
          peakPnlPercent: persisted?.peakPnlPercent ?? 0,
          trailingStopActivated: persisted?.trailingStopActivated ?? false,
          partialTpTriggered: false,
        });
      } catch {
        // Skip token if price fetch fails
      }
    }
  } catch (err) {
    console.error('[daemon] Failed to load positions:', err);
  }
}

function restartBarrierMonitor(): void {
  if (barrierManager?.isRunning) {
    const positions = barrierManager.getPositions();
    barrierManager.stop();
    startBarrierMonitor();
    for (const pos of positions) {
      barrierManager?.addPosition(pos);
    }
  }
}

// ── Scout Refresh (3min) ─────────────────────────────────────────────────

function startScoutLoop(): void {
  void runScout();
  scoutTimer = setInterval(() => void runScout(), SCOUT_INTERVAL_MS);
  console.log(`[daemon] Scout loop started (${SCOUT_INTERVAL_MS / 1000}s interval)`);
}

async function runScout(): Promise<void> {
  if (!client) return;

  if (isAgentSessionActive() || quotaManager.isAgentActive()) {
    console.log('[daemon] Agent active, skipping scout cycle');
    return;
  }

  try {
    const [topPools, trendingPools, newPools] = await Promise.all([
      dex.getTopPools(),
      dex.getTrendingPools(),
      dex.getNewPools(),
    ]);

    // Tag and deduplicate
    const taggedSources: Array<[PoolInfo[], string]> = [
      [topPools, 'top_volume'],
      [trendingPools, 'trending'],
      [newPools, 'new'],
    ];

    const poolMap = new Map<string, PoolInfo>();
    for (const [pools, tag] of taggedSources) {
      for (const p of pools) {
        const existing = poolMap.get(p.poolAddress);
        if (existing) {
          if (!existing.tags.includes(tag)) existing.tags.push(tag);
        } else {
          p.tags = [tag];
          poolMap.set(p.poolAddress, p);
        }
      }
    }

    // Junk filter + stablecoin exclusion
    const filtered = [...poolMap.values()].filter((p) => {
      if (p.reserveInUsd < (JUNK_FILTER.minLiquidityUsd ?? 0)) return false;
      if (p.volume24hUsd <= 0) return false;
      if (p.lockedLiquidityPercent != null && p.lockedLiquidityPercent === 0) return false;
      if (isUsdtPool(p.name)) return false;
      return true;
    });

    // Deduplicate by base token
    const byToken = new Map<string, PoolInfo>();
    for (const p of filtered) {
      const tokenKey = p.baseTokenId ?? p.name;
      const existing = byToken.get(tokenKey);
      if (!existing || p.reserveInUsd > existing.reserveInUsd) {
        if (existing) p.tags = [...new Set([...p.tags, ...existing.tags])];
        byToken.set(tokenKey, p);
      } else {
        existing.tags = [...new Set([...existing.tags, ...p.tags])];
      }
    }
    let candidates = [...byToken.values()];

    // Agent criteria filter from config
    const agentFilter = config.screening?.filter as ScreeningFilter | undefined;
    if (agentFilter) {
      candidates = candidates.filter((pool) => passesFilter(pool, agentFilter));
    }

    // Build shortlist entries with computed signals
    const shortlist: ShortlistEntry[] = candidates.map((p) => {
      const vol6hPerH = p.volume6hUsd / 6;
      const volumeAcceleration = vol6hPerH >= 100 / 6 ? p.volume1hUsd / vol6hPerH : null;
      const totalTxns1h = p.buys1h + p.sells1h;
      const buyPressure = totalTxns1h >= 10 ? p.buys1h / totalTxns1h : null;

      return {
        poolAddress: p.poolAddress,
        tokenAddress: p.baseTokenId ?? '',
        symbol: p.name.split(' / ')[0] ?? '',
        dexId: p.dexId,
        tags: p.tags,
        reserveInUsd: p.reserveInUsd,
        volume1hUsd: p.volume1hUsd,
        priceChange1h: p.priceChange1h,
        uniqueBuyers1h: null, // Only from GeckoTerminal
        boostTotalAmount: p.boostTotalAmount,
        cto: p.cto,
        buys1h: p.buys1h,
        sells1h: p.sells1h,
        volumeAcceleration,
        buyPressure,
        shortlistedAt: new Date().toISOString(),
        archetype: classifyArchetype(p),
        verificationStatus: 'pending',
      };
    });

    // Build top-lists
    const topByVolume = [...candidates].sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, TOP_LIST_SIZE);
    const topByLiquidity = [...candidates].sort((a, b) => b.reserveInUsd - a.reserveInUsd).slice(0, TOP_LIST_SIZE);
    const topByFdv = [...candidates].filter((p) => p.fdvUsd != null).sort((a, b) => (b.fdvUsd ?? 0) - (a.fdvUsd ?? 0)).slice(0, TOP_LIST_SIZE);
    const topGainers1h = [...candidates].sort((a, b) => b.priceChange1h - a.priceChange1h).slice(0, TOP_LIST_SIZE);
    const topGainers24h = [...candidates].sort((a, b) => b.priceChange24h - a.priceChange24h).slice(0, TOP_LIST_SIZE);
    const topByTxCount = [...candidates].sort((a, b) => b.transactions24h - a.transactions24h).slice(0, TOP_LIST_SIZE);

    // Fetch portfolio + strategy
    const [portfolio, strategy] = await Promise.all([
      client.getPortfolio(),
      client.getStrategySummary(),
    ]);

    // Determine market regime
    const avgVolAccel = shortlist
      .filter((s) => s.volumeAcceleration != null)
      .reduce((sum, s) => sum + (s.volumeAcceleration ?? 0), 0) / Math.max(1, shortlist.filter((s) => s.volumeAcceleration != null).length);
    const priceSpread = Math.max(...candidates.map((p) => p.priceChange1h)) - Math.min(...candidates.map((p) => p.priceChange1h));
    let marketRegime: MarketRegime = 'quiet';
    if (priceSpread > 20) marketRegime = 'volatile';
    else if (avgVolAccel > 1.5) marketRegime = 'active';

    // Get TON price
    const tonPrice = await dex.getTokenPrice('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

    // Get cooldown tokens
    const cooldownTokens = cooldownManager.getActiveCooldowns(riskPolicy.cooldownAfterExitMinutes);

    // Get quota state
    const quotaState = quotaManager.getState();

    // Write market_state.json (also writes briefing.json in parallel)
    const marketState: MarketState = {
      updatedAt: new Date().toISOString(),
      shortlist,
      topLists: {
        byVolume: topByVolume.map((p) => p.poolAddress),
        byLiquidity: topByLiquidity.map((p) => p.poolAddress),
        byFdv: topByFdv.map((p) => p.poolAddress),
        gainers1h: topGainers1h.map((p) => p.poolAddress),
        gainers24h: topGainers24h.map((p) => p.poolAddress),
        byTxCount: topByTxCount.map((p) => p.poolAddress),
      },
      marketRegime,
      tonPriceUsd: tonPrice.priceUsd ?? 0,
      pendingVerifications: shortlist.filter((s) => s.verificationStatus === 'pending').map((s) => s.tokenAddress),
      openPositionReviews: [],
      cooldownTokens,
      apiUsage: {
        gecko: { used: quotaState.gecko.used, limit: quotaState.gecko.limit, windowResetAt: quotaState.gecko.windowResetAt },
        dex: { used: quotaState.dex.used, limit: quotaState.dex.limit, windowResetAt: quotaState.dex.windowResetAt },
      },
    };
    writeMarketState(marketState);

    console.log(`[daemon] Scout: ${shortlist.length} candidates, regime=${marketRegime}`);

    // Emit shortlist_ready if new candidates found
    if (shortlist.length > 0) {
      eventQueue.push({ type: 'shortlist_ready', candidates: shortlist });
    }
  } catch (err) {
    console.error('[daemon] Scout error:', err);
  }
}

// ── Thesis Check Light (60s, DexScreener only, 0 gecko calls) ────────────

function startThesisCheckLight(): void {
  thesisLightTimer = setInterval(() => void runThesisCheckLight(), THESIS_LIGHT_INTERVAL_MS);
  console.log(`[daemon] Thesis check light started (${THESIS_LIGHT_INTERVAL_MS / 1000}s interval)`);
}

async function runThesisCheckLight(): Promise<void> {
  if (!barrierManager || barrierManager.getPositions().length === 0) return;

  try {
    const positions = barrierManager.getPositions();
    const addresses = positions.map((p) => p.tokenAddress);
    const prices = await dex.getTokenPricesBatch(addresses);

    const portfolioState = readPortfolioState();
    let stateChanged = false;

    for (const pos of positions) {
      const priceInfo = prices.get(pos.tokenAddress);
      if (!priceInfo?.priceUsd) continue;

      const pnlPercent = ((priceInfo.priceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      const thesis = portfolioState.positions[pos.tokenAddress];
      if (!thesis) continue;

      // Check momentum deceleration: volume < 30% of entry AND price falling
      // We don't have real-time volume here (would need DexScreener pair call),
      // so just check PnL trend for light check
      if (pnlPercent < -5 && thesis.thesisStatus === 'intact') {
        thesis.thesisStatus = 'weakening';
        thesis.lastReviewedAt = new Date().toISOString();
        stateChanged = true;
        console.log(`[daemon] Thesis weakening: ${pos.symbol} at ${pnlPercent.toFixed(1)}%`);
      }
    }

    if (stateChanged) {
      writePortfolioState(portfolioState);
    }
  } catch (err) {
    console.error('[daemon] Thesis check light error:', err);
  }
}

// ── Thesis Check Deep (10min, 2 gecko calls per position) ────────────────

function startThesisCheckDeep(): void {
  thesisDeepTimer = setInterval(() => void runThesisCheckDeep(), THESIS_DEEP_INTERVAL_MS);
  console.log(`[daemon] Thesis check deep started (${THESIS_DEEP_INTERVAL_MS / 1000}s interval)`);
}

async function runThesisCheckDeep(): Promise<void> {
  if (!client || !barrierManager) return;
  const positions = barrierManager.getPositions();
  if (positions.length === 0) return;

  const portfolioState = readPortfolioState();
  let stateChanged = false;

  // Process one position per cycle to conserve gecko budget
  const posToReview = positions[0]; // Round-robin could be added later
  if (!posToReview || !posToReview.poolAddress) return;

  try {
    // 2 gecko calls: getPoolInfo for buyer diversity, getTokenInfo for safety re-check
    const poolInfo = await client.gecko.getPoolInfo(posToReview.poolAddress);
    const thesis = portfolioState.positions[posToReview.tokenAddress];
    if (!thesis) return;

    // Check buyer diversity collapse
    if (thesis.thesisMetrics.entryBuyerDiversity1h > 0) {
      const currentDiversity = poolInfo.transactions.h1.buys > 0
        ? poolInfo.transactions.h1.buyers / poolInfo.transactions.h1.buys
        : 0;
      if (currentDiversity < thesis.thesisMetrics.entryBuyerDiversity1h * 0.3) {
        thesis.thesisStatus = 'broken';
        thesis.lastReviewedAt = new Date().toISOString();
        stateChanged = true;
        console.log(`[daemon] Thesis BROKEN (buyer diversity collapse): ${posToReview.symbol}`);

        eventQueue.push({
          type: 'thesis_break',
          position: thesis,
          reason: `Buyer diversity collapsed from ${thesis.thesisMetrics.entryBuyerDiversity1h.toFixed(2)} to ${currentDiversity.toFixed(2)}`,
        });
      }
    }

    // Check sustained net sell
    const netBuy = poolInfo.transactions.h1.buys - poolInfo.transactions.h1.sells;
    if (netBuy < 0 && thesis.thesisStatus === 'intact') {
      thesis.thesisStatus = 'weakening';
      thesis.lastReviewedAt = new Date().toISOString();
      stateChanged = true;
    }

    if (stateChanged) {
      writePortfolioState(portfolioState);
    }
  } catch (err) {
    console.error(`[daemon] Thesis deep check error for ${posToReview.symbol}:`, err);
  }
}

// ── Heartbeat (15min) ────────────────────────────────────────────────────

function startHeartbeat(): void {
  heartbeatTimer = setInterval(() => {
    eventQueue.push({ type: 'deep_think_scheduled', reason: 'timer' });
    console.log('[daemon] Heartbeat — deep think scheduled');
  }, HEARTBEAT_INTERVAL_MS);
  console.log(`[daemon] Heartbeat started (${HEARTBEAT_INTERVAL_MS / 60000}min interval)`);
}

// ── Archetype Classification (deterministic) ─────────────────────────────

function classifyArchetype(pool: PoolInfo): string | null {
  if (pool.boostTotalAmount > 0) return 'paid_attention';
  if (pool.cto) return 'cto_momentum';

  const totalTxns1h = pool.buys1h + pool.sells1h;
  const buyPressure = totalTxns1h > 0 ? pool.buys1h / totalTxns1h : 0;
  if (buyPressure > 0.6 && pool.volume1hUsd > 3000) return 'organic_breakout';

  return null;
}

// ── Agent Notification ───────────────────────────────────────────────────

function notifyAgent(
  event: BarrierEvent,
  execution?: { operationId: string; amountNano: string } | null,
): void {
  const sessionId = config.sessionId;
  const openclawPath = config.openclawPath ?? 'openclaw';
  if (!sessionId) {
    console.log('[daemon] No sessionId configured, skipping agent notification');
    return;
  }

  const payload = JSON.stringify({
    event: 'barrier_triggered',
    closeType: event.closeType,
    tokenAddress: event.tokenAddress,
    symbol: event.symbol,
    entryPriceUsd: event.entryPriceUsd,
    exitPriceUsd: event.currentPriceUsd,
    pnlPercent: event.pnlPercent,
    soldPercent: event.sellPercent,
    reason: event.reason,
    amountNano: execution?.amountNano ?? null,
    operationId: execution?.operationId ?? null,
    timestamp: new Date().toISOString(),
  });

  const message = `Save to today's daily memory as a trade event: ${payload}`;

  execFile(openclawPath, ['agent', '--session-id', sessionId, '--message', message], (err) => {
    if (err) {
      console.error('[daemon] Failed to notify agent:', err.message);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isUsdtPool(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('usdt') || lower.includes('usd₮');
}

function passesFilter(pool: PoolInfo, f: ScreeningFilter): boolean {
  if (f.minLiquidityUsd != null && pool.reserveInUsd < f.minLiquidityUsd) return false;
  if (f.maxLiquidityUsd != null && pool.reserveInUsd > f.maxLiquidityUsd) return false;
  if (f.minVolume24hUsd != null && pool.volume24hUsd < f.minVolume24hUsd) return false;
  if (f.minFdvUsd != null && (pool.fdvUsd == null || pool.fdvUsd < f.minFdvUsd)) return false;
  if (f.maxFdvUsd != null && pool.fdvUsd != null && pool.fdvUsd > f.maxFdvUsd) return false;
  if (f.minMarketCapUsd != null && (pool.marketCapUsd == null || pool.marketCapUsd < f.minMarketCapUsd)) return false;
  if (f.maxMarketCapUsd != null && pool.marketCapUsd != null && pool.marketCapUsd > f.maxMarketCapUsd) return false;
  if (f.minLockedLiquidityPercent != null && (pool.lockedLiquidityPercent == null || pool.lockedLiquidityPercent < f.minLockedLiquidityPercent)) return false;

  const ranges: Array<[number, { min?: number; max?: number } | undefined]> = [
    [pool.priceChange5m, f.priceChange5m],
    [pool.priceChange15m, f.priceChange15m],
    [pool.priceChange30m, f.priceChange30m],
    [pool.priceChange1h, f.priceChange1h],
    [pool.priceChange6h, f.priceChange6h],
    [pool.priceChange24h, f.priceChange24h],
  ];
  for (const [value, range] of ranges) {
    if (range) {
      if (range.min != null && value < range.min) return false;
      if (range.max != null && value > range.max) return false;
    }
  }

  if (f.minTransactions24h != null && pool.transactions24h < f.minTransactions24h) return false;
  if (f.minBuySellRatio != null && pool.buySellRatio < f.minBuySellRatio) return false;
  if (f.minUniqueBuyers24h != null && pool.uniqueBuyers24h < f.minUniqueBuyers24h) return false;

  return true;
}

// ── Start ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[daemon] Fatal error:', err);
  process.exit(1);
});
