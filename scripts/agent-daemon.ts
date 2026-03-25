#!/usr/bin/env node
/**
 * TractionEye Agent Daemon
 *
 * Single process, two functions:
 * 1. TP/SL monitoring — continuous price polling, auto-sells on trigger
 * 2. Screening + briefing — periodic market scan → briefing.json
 *
 * Reads config from ~/.tractioneye/config.json
 * Writes briefing to ~/.tractioneye/briefing.json
 */

import { writeFileSync, watchFile } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  TractionEyeClient,
  RateLimiter,
  GeckoTerminalClient,
  TokenScreener,
  PositionManager,
  readConfig,
  briefingPath,
  configPath,
  ensureDataDir,
  type PositionEvent,
  type PoolInfo,
  type ScreeningFilter,
  type DaemonConfig,
  type TpSlConfig,
} from '../dist/index.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SCREENING_INTERVAL_MS = 180_000; // 3 minutes
const TP_SL_POLL_INTERVAL_MS = 10_000; // 10 seconds

/** Hardcoded junk filter — pools that don't pass are discarded before agent criteria. */
const JUNK_FILTER: ScreeningFilter = {
  minLiquidityUsd: 1000,
  minVolume24hUsd: 0.01, // > 0
};

// ── State ──────────────────────────────────────────────────────────────────

let config: DaemonConfig;
let client: TractionEyeClient | null = null;
let gecko: GeckoTerminalClient;
let screener: TokenScreener;
let positionManager: PositionManager | null = null;
let limiter: RateLimiter;
let screeningTimer: ReturnType<typeof setInterval> | null = null;
let lastExecutionResult: { operationId: string; amountNano: string } | null = null;

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDataDir();
  config = readConfig();

  if (!config.agentToken) {
    console.log('[daemon] No agentToken in config. Waiting for agent to set it...');
    // Watch config for changes — agent will write agentToken on first run
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

  limiter = client.limiter;
  gecko = client.gecko;
  screener = client.screener;

  // Start TP/SL monitoring
  startTpSlMonitor();

  // Start screening loop
  startScreeningLoop();

  // Watch config file for TP/SL parameter changes
  watchFile(configPath(), { interval: 5000 }, () => {
    console.log('[daemon] Config changed, reloading...');
    config = readConfig();
    restartTpSlMonitor();
  });

  console.log('[daemon] Running.');
}

// ── TP/SL Monitoring ───────────────────────────────────────────────────────

function buildPositionConfig(tpSl?: TpSlConfig) {
  const defaults = tpSl?.defaults ?? { takeProfitPercent: 25, stopLossPercent: 8 };
  return {
    takeProfitPercent: defaults.takeProfitPercent,
    stopLossPercent: defaults.stopLossPercent,
    partialTpTrigger: defaults.partialTakeProfitPercent,
    partialTpPercent: defaults.partialTakeProfitSellPercent,
  };
}

function startTpSlMonitor(): void {
  if (!client) return;

  const posConfig = buildPositionConfig(config.tpSl);

  const executor = async (tokenAddress: string, _action: 'BUY' | 'SELL', sellPercent: number) => {
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

    // Store execution result for notifyAgent
    lastExecutionResult = {
      operationId: execution.operationId,
      amountNano: sellQty.toString(),
    };
  };

  const onEvent = (event: PositionEvent) => {
    console.log(`[daemon] ${event.type}: ${event.symbol} ${event.changePercent.toFixed(2)}%`);
    notifyAgent(event, lastExecutionResult);
    lastExecutionResult = null;
  };

  positionManager = new PositionManager(
    gecko,
    posConfig,
    executor,
    onEvent,
    { intervalMs: TP_SL_POLL_INTERVAL_MS },
  );

  // Load positions from portfolio
  void loadPositions().then(() => {
    positionManager?.start();
    console.log('[daemon] TP/SL monitor started');
  });
}

async function loadPositions(): Promise<void> {
  if (!client || !positionManager) return;
  try {
    const portfolio = await client.getPortfolio();
    for (const t of portfolio.tokens) {
      if (t.entryPriceTon == null) continue;
      try {
        const tokenPrice = await gecko.getTokenPrice(t.address);
        if (tokenPrice.priceUsd == null) continue;
        const currentValueTon = Number(t.currentValueTon ?? 0);
        const entryPriceTon = Number(t.entryPriceTon);
        const ratio = entryPriceTon > 0 && currentValueTon > 0
          ? entryPriceTon / currentValueTon
          : 1;
        const entryPriceUsd = tokenPrice.priceUsd * ratio;

        positionManager.addPosition({
          tokenAddress: t.address,
          symbol: t.symbol,
          entryPriceUsd,
          quantity: t.quantity,
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

function restartTpSlMonitor(): void {
  if (positionManager?.isRunning) {
    // Preserve existing positions
    const positions = positionManager.getPositions();
    positionManager.stop();
    startTpSlMonitor();
    // Re-add preserved positions
    for (const pos of positions) {
      positionManager?.addPosition(pos);
    }
  }
}

function notifyAgent(
  event: PositionEvent,
  execution?: { operationId: string; amountNano: string } | null,
): void {
  const sessionId = config.sessionId;
  const openclawPath = config.openclawPath ?? 'openclaw';
  if (!sessionId) {
    console.log('[daemon] No sessionId configured, skipping agent notification');
    return;
  }

  const payload = JSON.stringify({
    event: 'tp_sl_triggered',
    type: event.type,
    tokenAddress: event.tokenAddress,
    symbol: event.symbol,
    entryPriceUsd: event.entryPriceUsd,
    exitPriceUsd: event.currentPriceUsd,
    pnlPercent: event.changePercent,
    soldPercent: event.sellPercent,
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

// ── Screening + Briefing ───────────────────────────────────────────────────

/** Stablecoin name patterns — pools with these in the name are excluded from candidates. */
const STABLECOIN_PATTERNS = [/\bUSDT\b/i, /\bUSD₮\b/i, /\bUSDC\b/i, /\bDAI\b/i, /\bjUSDT\b/i, /\bjUSDC\b/i];

function isStablecoinPool(name: string): boolean {
  return STABLECOIN_PATTERNS.some((re) => re.test(name));
}

const TOP_LIST_SIZE = 10;

function startScreeningLoop(): void {
  const interval = config.screening?.intervalMs ?? DEFAULT_SCREENING_INTERVAL_MS;
  // Run immediately
  void runScreening();
  screeningTimer = setInterval(() => void runScreening(), interval);
  console.log(`[daemon] Screening loop started (interval: ${interval}ms)`);
}

async function runScreening(): Promise<void> {
  if (!client) return;

  try {
    // Fetch pools from 5 sources for a comprehensive market view
    const [
      poolsByVolume,
      poolsByTxCount,
      trending5m,
      trending1h,
      newPools,
    ] = await Promise.all([
      gecko.getPools(1, 'h24_volume_usd_desc'),
      gecko.getPools(1, 'h24_tx_count_desc'),
      gecko.getTrendingPools('5m'),
      gecko.getTrendingPools('1h'),
      gecko.getNewPools(),
    ]);

    // Tag each pool by source, then deduplicate — merge tags on collision
    const taggedSources: Array<[PoolInfo[], string]> = [
      [poolsByVolume, 'top_volume'],
      [poolsByTxCount, 'top_tx_count'],
      [trending5m, 'trending_5m'],
      [trending1h, 'trending_1h'],
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
    let candidates = [...poolMap.values()].filter((p) => {
      if (p.reserveInUsd < (JUNK_FILTER.minLiquidityUsd ?? 0)) return false;
      if (p.volume24hUsd <= 0) return false;
      if (p.lockedLiquidityPercent === 0) return false;
      if (isStablecoinPool(p.name)) return false;
      return true;
    });

    // Agent criteria filter from config
    const agentFilter = config.screening?.filter as ScreeningFilter | undefined;
    if (agentFilter) {
      candidates = candidates.filter((pool) => passesFilter(pool, agentFilter));
    }

    // Build top-lists by client-side sorting (no extra API requests)
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

    // Write enriched briefing
    const briefing = {
      timestamp: new Date().toISOString(),
      candidates,
      tops: {
        byVolume: topByVolume.map((p) => p.poolAddress),
        byLiquidity: topByLiquidity.map((p) => p.poolAddress),
        byFdv: topByFdv.map((p) => p.poolAddress),
        gainers1h: topGainers1h.map((p) => p.poolAddress),
        gainers24h: topGainers24h.map((p) => p.poolAddress),
        byTxCount: topByTxCount.map((p) => p.poolAddress),
      },
      portfolio,
      strategy,
    };

    writeFileSync(briefingPath(), JSON.stringify(briefing, null, 2) + '\n', 'utf-8');
    console.log(`[daemon] Briefing updated: ${candidates.length} candidates from ${poolMap.size} pools`);
  } catch (err) {
    console.error('[daemon] Screening error:', err);
  }
}

/** Inline filter check matching ScreeningFilter logic from screener.ts */
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
