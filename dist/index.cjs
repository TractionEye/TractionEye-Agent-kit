"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  DEFAULT_DATA_DIR: () => DEFAULT_DATA_DIR,
  GeckoTerminalClient: () => GeckoTerminalClient,
  PositionManager: () => PositionManager,
  RateLimiter: () => RateLimiter,
  RequestPriority: () => RequestPriority,
  Simulator: () => Simulator,
  TokenScreener: () => TokenScreener,
  TractionEyeClient: () => TractionEyeClient,
  TractionEyeHttpError: () => TractionEyeHttpError,
  briefingPath: () => briefingPath,
  configPath: () => configPath,
  createTractionEyeTools: () => createTractionEyeTools,
  ensureDataDir: () => ensureDataDir,
  readBriefing: () => readBriefing,
  readConfig: () => readConfig,
  updateConfig: () => updateConfig,
  writeConfig: () => writeConfig
});
module.exports = __toCommonJS(index_exports);

// src/client.ts
var import_node_crypto = require("crypto");

// src/http/client.ts
var TractionEyeHttpError = class extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "TractionEyeHttpError";
  }
};
var TractionEyeHttpClient = class {
  constructor(baseUrl, agentToken) {
    this.baseUrl = baseUrl;
    this.agentToken = agentToken;
  }
  async get(path) {
    return this._request("GET", path);
  }
  async post(path, body) {
    return this._request("POST", path, body);
  }
  async _request(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `agent ${this.agentToken}`,
        Accept: "application/json",
        ...body !== void 0 ? { "Content-Type": "application/json" } : {}
      },
      ...body !== void 0 ? { body: JSON.stringify(body) } : {}
    });
    const text = await res.text();
    const parsed = text ? safeJsonParse(text) : void 0;
    if (!res.ok) {
      throw new TractionEyeHttpError(
        `HTTP ${res.status} for ${method} ${path}`,
        res.status,
        parsed ?? text
      );
    }
    return parsed ?? {};
  }
};
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// src/logger.ts
function logMethodCall(method, args) {
  if (args && Object.keys(args).length > 0) {
    console.log(`[TractionEyeClient] ${method}`, args);
    return;
  }
  console.log(`[TractionEyeClient] ${method}`);
}

// src/rate-limiter.ts
var RequestPriority = /* @__PURE__ */ ((RequestPriority2) => {
  RequestPriority2[RequestPriority2["Critical"] = 0] = "Critical";
  RequestPriority2[RequestPriority2["High"] = 1] = "High";
  RequestPriority2[RequestPriority2["Low"] = 2] = "Low";
  return RequestPriority2;
})(RequestPriority || {});
var RateLimiter = class {
  constructor(maxTokens = 30, windowMs = 6e4, minIntervalMs = 2e3) {
    this.lastRequestTime = 0;
    this.queue = [];
    this.draining = false;
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.windowMs = windowMs;
    this.minIntervalMs = minIntervalMs;
    this.lastRefill = Date.now();
  }
  /** Schedule a request with a given priority. Returns the result promise. */
  schedule(priority, execute) {
    return new Promise((resolve, reject) => {
      const entry = { priority, execute, resolve, reject };
      this.queue.push(entry);
      this.queue.sort((a, b) => a.priority - b.priority);
      this.drain();
    });
  }
  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed / this.windowMs * this.maxTokens;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      this.refill();
      if (this.tokens < 1) {
        const waitMs = (1 - this.tokens) / this.maxTokens * this.windowMs;
        await sleep(Math.max(waitMs, 200));
        continue;
      }
      const sinceLastRequest = Date.now() - this.lastRequestTime;
      if (sinceLastRequest < this.minIntervalMs) {
        await sleep(this.minIntervalMs - sinceLastRequest);
      }
      const entry = this.queue.shift();
      this.tokens -= 1;
      this.lastRequestTime = Date.now();
      try {
        const result = await entry.execute();
        entry.resolve(result);
      } catch (err) {
        entry.reject(err);
      }
    }
    this.draining = false;
  }
};
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// src/gecko/client.ts
var GECKO_BASE = "https://api.geckoterminal.com/api/v2";
var NETWORK = "ton";
var GeckoTerminalClient = class {
  constructor(limiter) {
    this.limiter = limiter;
  }
  // ---------- Pool endpoints ----------
  /** Fetch pools for TON network (paginated, up to 20 per page). */
  async getPools(page = 1, sort = "h24_volume_usd_desc", priority = 2 /* Low */) {
    const data = await this.get(
      `/networks/${NETWORK}/pools?page=${page}&sort=${sort}`,
      priority
    );
    return data.data.map(mapPool);
  }
  /** Trending pools on TON. */
  async getTrendingPools(duration = "24h", priority = 2 /* Low */) {
    const data = await this.get(
      `/networks/${NETWORK}/trending_pools?duration=${duration}`,
      priority
    );
    return data.data.map(mapPool);
  }
  /** Newly created pools on TON. */
  async getNewPools(priority = 2 /* Low */) {
    const data = await this.get(
      `/networks/${NETWORK}/new_pools`,
      priority
    );
    return data.data.map(mapPool);
  }
  /** Search pools by keyword, filtered to TON network. */
  async searchPools(query, priority = 2 /* Low */) {
    const data = await this.get(
      `/search/pools?query=${encodeURIComponent(query)}&network=${NETWORK}`,
      priority
    );
    return data.data.map((p) => ({
      poolAddress: p.attributes.address,
      name: p.attributes.name,
      baseTokenPriceUsd: "0",
      reserveInUsd: num(p.attributes.reserve_in_usd),
      fdvUsd: null,
      marketCapUsd: null,
      lockedLiquidityPercent: null,
      volume24hUsd: num(p.attributes.volume_usd.h24),
      volume6hUsd: 0,
      volume1hUsd: 0,
      priceChange5m: 0,
      priceChange15m: 0,
      priceChange30m: 0,
      priceChange1h: 0,
      priceChange6h: 0,
      priceChange24h: num(p.attributes.price_change_percentage.h24),
      transactions24h: 0,
      buys24h: 0,
      sells24h: 0,
      uniqueBuyers1h: 0,
      uniqueBuyers6h: 0,
      uniqueBuyers24h: 0,
      uniqueSellers1h: 0,
      uniqueSellers6h: 0,
      uniqueSellers24h: 0,
      buySellRatio: 0,
      createdAt: "",
      tags: []
    }));
  }
  /** Fetch details for multiple pools (up to 30 addresses, comma-separated). */
  async getPoolsMulti(addresses, priority = 2 /* Low */) {
    if (addresses.length === 0) return [];
    const joined = addresses.slice(0, 30).join(",");
    const data = await this.get(
      `/networks/${NETWORK}/pools/multi/${joined}`,
      priority
    );
    return data.data.map(mapPool);
  }
  // ---------- Trades & OHLCV endpoints ----------
  /** Fetch recent trades for a pool. */
  async getPoolTrades(poolAddress, options, priority = 1 /* High */) {
    let path = `/networks/${NETWORK}/pools/${poolAddress}/trades`;
    if (options?.tradeVolumeInUsdGreaterThan != null) {
      path += `?trade_volume_in_usd_greater_than=${options.tradeVolumeInUsdGreaterThan}`;
    }
    const data = await this.get(path, priority);
    return data.data.map((t) => ({
      kind: t.attributes.kind,
      volumeInUsd: num(t.attributes.volume_in_usd),
      txFromAddress: t.attributes.tx_from_address,
      blockTimestamp: t.attributes.block_timestamp,
      fromTokenAmount: num(t.attributes.from_token_amount),
      toTokenAmount: num(t.attributes.to_token_amount),
      priceFromInUsd: num(t.attributes.price_from_in_usd),
      priceToInUsd: num(t.attributes.price_to_in_usd)
    }));
  }
  /** Fetch OHLCV candles for a pool. */
  async getPoolOhlcv(poolAddress, timeframe = "day", limit = 30, priority = 1 /* High */) {
    const data = await this.get(
      `/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`,
      priority
    );
    const candles = data.data.attributes.ohlcv_list.map(
      ([timestamp, open, high, low, close, volume]) => ({
        timestamp,
        open,
        high,
        low,
        close,
        volume
      })
    );
    return { candles, meta: data.meta };
  }
  // ---------- Token endpoints ----------
  /** Fetch prices for multiple tokens (up to 30 addresses). P0 priority by default. */
  async getTokenPrices(addresses, priority = 0 /* Critical */) {
    if (addresses.length === 0) return [];
    const joined = addresses.slice(0, 30).join(",");
    const data = await this.get(
      `/networks/${NETWORK}/tokens/multi/${joined}`,
      priority
    );
    return data.data.map((t) => ({
      address: t.attributes.address,
      priceUsd: t.attributes.price_usd != null ? num(t.attributes.price_usd) : null,
      symbol: t.attributes.symbol
    }));
  }
  /** Fetch a single token's price. */
  async getTokenPrice(address, priority = 0 /* Critical */) {
    const data = await this.get(
      `/networks/${NETWORK}/tokens/${address}`,
      priority
    );
    const t = data.data[0];
    if (!t) throw new Error(`Token not found: ${address}`);
    return {
      address: t.attributes.address,
      priceUsd: t.attributes.price_usd != null ? num(t.attributes.price_usd) : null,
      symbol: t.attributes.symbol
    };
  }
  // ---------- Internal ----------
  get(path, priority) {
    return this.limiter.schedule(priority, async () => {
      const res = await fetch(`${GECKO_BASE}${path}`, {
        headers: { Accept: "application/json" }
      });
      if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}: ${path}`);
      return res.json();
    });
  }
};
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function mapPool(p) {
  const a = p.attributes;
  const buys = a.transactions.h24.buys;
  const sells = a.transactions.h24.sells;
  return {
    poolAddress: a.address,
    name: a.name,
    baseTokenPriceUsd: a.base_token_price_usd,
    reserveInUsd: num(a.reserve_in_usd),
    fdvUsd: numOrNull(a.fdv_usd),
    marketCapUsd: numOrNull(a.market_cap_usd),
    lockedLiquidityPercent: numOrNull(a.locked_liquidity_percentage),
    volume24hUsd: num(a.volume_usd.h24),
    volume6hUsd: num(a.volume_usd.h6),
    volume1hUsd: num(a.volume_usd.h1),
    priceChange5m: num(a.price_change_percentage.m5),
    priceChange15m: num(a.price_change_percentage.m15),
    priceChange30m: num(a.price_change_percentage.m30),
    priceChange1h: num(a.price_change_percentage.h1),
    priceChange6h: num(a.price_change_percentage.h6),
    priceChange24h: num(a.price_change_percentage.h24),
    transactions24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    uniqueBuyers1h: a.transactions.h1.buyers ?? 0,
    uniqueBuyers6h: a.transactions.h6.buyers ?? 0,
    uniqueBuyers24h: a.transactions.h24.buyers ?? 0,
    uniqueSellers1h: a.transactions.h1.sellers ?? 0,
    uniqueSellers6h: a.transactions.h6.sellers ?? 0,
    uniqueSellers24h: a.transactions.h24.sellers ?? 0,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? Infinity : 0,
    createdAt: a.pool_created_at,
    baseTokenId: p.relationships?.base_token?.data?.id,
    tags: []
  };
}

// src/screening/screener.ts
var ALL_SOURCES = ["pools", "trending", "new_pools"];
var TokenScreener = class {
  constructor(gecko) {
    this.gecko = gecko;
  }
  /** Run a screening pass: fetch pools from configured sources & filter. */
  async screen(config) {
    const sources = config.sources ?? ALL_SOURCES;
    const pools = await this.fetchSources(sources);
    const seen = /* @__PURE__ */ new Set();
    const unique = [];
    for (const p of pools) {
      if (!seen.has(p.poolAddress)) {
        seen.add(p.poolAddress);
        unique.push(p);
      }
    }
    return unique.filter((p) => matchesFilter(p, config.filter));
  }
  /** Search pools by keyword and apply filter. */
  async search(query, filter) {
    const pools = await this.gecko.searchPools(query);
    return pools.filter((p) => matchesFilter(p, filter));
  }
  async fetchSources(sources) {
    const results = await Promise.all(
      sources.map((s) => {
        switch (s) {
          case "pools":
            return this.gecko.getPools();
          case "trending":
            return this.gecko.getTrendingPools();
          case "new_pools":
            return this.gecko.getNewPools();
        }
      })
    );
    return results.flat();
  }
};
function checkRange(value, range) {
  if (!range) return true;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}
function matchesFilter(pool, f) {
  if (f.minLiquidityUsd != null && pool.reserveInUsd < f.minLiquidityUsd) return false;
  if (f.maxLiquidityUsd != null && pool.reserveInUsd > f.maxLiquidityUsd) return false;
  if (f.minVolume24hUsd != null && pool.volume24hUsd < f.minVolume24hUsd) return false;
  if (f.minFdvUsd != null && (pool.fdvUsd == null || pool.fdvUsd < f.minFdvUsd)) return false;
  if (f.maxFdvUsd != null && pool.fdvUsd != null && pool.fdvUsd > f.maxFdvUsd) return false;
  if (f.minMarketCapUsd != null && (pool.marketCapUsd == null || pool.marketCapUsd < f.minMarketCapUsd)) return false;
  if (f.maxMarketCapUsd != null && pool.marketCapUsd != null && pool.marketCapUsd > f.maxMarketCapUsd) return false;
  if (f.minLockedLiquidityPercent != null && (pool.lockedLiquidityPercent == null || pool.lockedLiquidityPercent < f.minLockedLiquidityPercent)) return false;
  if (!checkRange(pool.priceChange5m, f.priceChange5m)) return false;
  if (!checkRange(pool.priceChange15m, f.priceChange15m)) return false;
  if (!checkRange(pool.priceChange30m, f.priceChange30m)) return false;
  if (!checkRange(pool.priceChange1h, f.priceChange1h)) return false;
  if (!checkRange(pool.priceChange6h, f.priceChange6h)) return false;
  if (!checkRange(pool.priceChange24h, f.priceChange24h)) return false;
  if (f.minTransactions24h != null && pool.transactions24h < f.minTransactions24h) return false;
  if (f.minBuySellRatio != null && pool.buySellRatio < f.minBuySellRatio) return false;
  if (f.minUniqueBuyers24h != null && pool.uniqueBuyers24h < f.minUniqueBuyers24h) return false;
  return true;
}

// src/position/manager.ts
var DEFAULT_INTERVAL_MS = 1e4;
var PositionManager = class {
  constructor(gecko, config, executeTradeCallback, onEvent, monitorConfig) {
    this.gecko = gecko;
    this.config = config;
    this.executeTradeCallback = executeTradeCallback;
    this.onEvent = onEvent;
    this.monitorConfig = monitorConfig;
    this.positions = /* @__PURE__ */ new Map();
    this.timer = null;
    this.running = false;
  }
  /** Add a position to be monitored. */
  addPosition(pos) {
    this.positions.set(pos.tokenAddress, pos);
  }
  /** Remove a position from monitoring. */
  removePosition(tokenAddress) {
    this.positions.delete(tokenAddress);
  }
  /** Get all tracked positions. */
  getPositions() {
    return Array.from(this.positions.values());
  }
  /** Start the polling loop. */
  start() {
    if (this.running) return;
    this.running = true;
    const interval = this.monitorConfig?.intervalMs ?? DEFAULT_INTERVAL_MS;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), interval);
  }
  /** Stop the polling loop. */
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  get isRunning() {
    return this.running;
  }
  /** Single monitoring tick: fetch prices & check TP/SL. */
  async tick() {
    if (this.positions.size === 0) return;
    const addresses = Array.from(this.positions.keys());
    let prices;
    try {
      prices = await this.gecko.getTokenPrices(addresses);
    } catch {
      return;
    }
    const priceMap = /* @__PURE__ */ new Map();
    for (const p of prices) {
      if (p.priceUsd != null) priceMap.set(p.address, p.priceUsd);
    }
    for (const [addr, pos] of this.positions) {
      const currentPrice = priceMap.get(addr);
      if (currentPrice == null) continue;
      const changePct = (currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd * 100;
      if (this.config.stopLossPercent != null && changePct <= -this.config.stopLossPercent) {
        const event = {
          type: "stop_loss",
          tokenAddress: addr,
          symbol: pos.symbol,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          changePercent: changePct,
          sellPercent: 100
        };
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, "SELL", 100);
        } catch {
          continue;
        }
        this.positions.delete(addr);
        continue;
      }
      if (this.config.partialTpTrigger != null && this.config.partialTpPercent != null && !pos.partialTpTriggered && changePct >= this.config.partialTpTrigger) {
        const event = {
          type: "partial_take_profit",
          tokenAddress: addr,
          symbol: pos.symbol,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          changePercent: changePct,
          sellPercent: this.config.partialTpPercent
        };
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, "SELL", this.config.partialTpPercent);
        } catch {
          continue;
        }
        pos.partialTpTriggered = true;
      }
      if (this.config.takeProfitPercent != null && changePct >= this.config.takeProfitPercent) {
        const event = {
          type: "take_profit",
          tokenAddress: addr,
          symbol: pos.symbol,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          changePercent: changePct,
          sellPercent: 100
        };
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, "SELL", 100);
        } catch {
          continue;
        }
        this.positions.delete(addr);
      }
    }
  }
};

// src/simulation/simulator.ts
var Simulator = class {
  constructor() {
    this.trades = [];
    /** Open virtual positions keyed by token address. */
    this.openPositions = /* @__PURE__ */ new Map();
  }
  get isActive() {
    return true;
  }
  /** Record a virtual BUY (opens a position). */
  recordBuy(tokenAddress, symbol, priceUsd, quantity) {
    const trade = {
      tokenAddress,
      symbol,
      action: "BUY",
      priceUsd,
      quantity,
      timestamp: Date.now()
    };
    this.trades.push(trade);
    this.openPositions.set(tokenAddress, trade);
    return trade;
  }
  /** Record a virtual SELL (closes a position). Calculates P&L vs entry. */
  recordSell(tokenAddress, symbol, priceUsd, quantity) {
    const entry = this.openPositions.get(tokenAddress);
    const pnlPercent = entry ? (priceUsd - entry.priceUsd) / entry.priceUsd * 100 : 0;
    const trade = {
      tokenAddress,
      symbol,
      action: "SELL",
      priceUsd,
      quantity,
      timestamp: Date.now(),
      pnlPercent
    };
    this.trades.push(trade);
    this.openPositions.delete(tokenAddress);
    return trade;
  }
  /** Check if there's an open virtual position for a token. */
  hasPosition(tokenAddress) {
    return this.openPositions.has(tokenAddress);
  }
  /** Get the virtual entry price for a token (or null). */
  getEntryPrice(tokenAddress) {
    return this.openPositions.get(tokenAddress)?.priceUsd ?? null;
  }
  /** Get all open virtual positions. */
  getOpenPositions() {
    return Array.from(this.openPositions.values());
  }
  /** Compute simulation results from all recorded trades. */
  getResults() {
    const sells = this.trades.filter((t) => t.action === "SELL" && t.pnlPercent != null);
    const wins = sells.filter((t) => t.pnlPercent > 0);
    const losses = sells.filter((t) => t.pnlPercent <= 0);
    const avgProfit = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPercent, 0) / losses.length : 0;
    const netPnl = sells.length > 0 ? sells.reduce((s, t) => s + t.pnlPercent, 0) / sells.length : 0;
    const winRate = sells.length > 0 ? wins.length / sells.length * 100 : 0;
    return {
      totalTrades: this.trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgProfitPercent: round2(avgProfit),
      avgLossPercent: round2(avgLoss),
      netPnlPercent: round2(netPnl),
      trades: [...this.trades],
      recommendedConfig: this.recommend(avgProfit, avgLoss, winRate)
    };
  }
  /** Reset all simulation data. */
  reset() {
    this.trades = [];
    this.openPositions.clear();
  }
  recommend(avgProfit, avgLoss, winRate) {
    const tp = avgProfit > 0 ? round2(avgProfit * 0.8) : 15;
    const sl = avgLoss < 0 ? round2(Math.abs(avgLoss) * 1.2) : 8;
    const posSize = winRate >= 60 ? 10 : winRate >= 40 ? 5 : 3;
    return {
      takeProfitPercent: Math.max(tp, 5),
      stopLossPercent: Math.max(sl, 3),
      positionSizePercent: posSize
    };
  }
};
function round2(n) {
  return Math.round(n * 100) / 100;
}

// src/client.ts
var DEFAULT_BASE_URL = "https://test.tractioneye.xyz/trust_api";
function toValidationOutcome(raw) {
  if (raw === "warning") return "warning";
  if (raw === "rejected") return "rejected";
  return "ok";
}
function toOperationStatus(raw) {
  if (raw === "confirmed") return "confirmed";
  if (raw === "adjusted") return "adjusted";
  if (raw === "failed") return "failed";
  return "pending";
}
var TractionEyeClient = class _TractionEyeClient {
  constructor(http, strategyId, strategyName, limiter, dryRun) {
    this.http = http;
    this.strategyId = strategyId;
    this.strategyName = strategyName;
    /** In-memory map: operationId → execution context (swapType, tokenAddress). */
    this._opContext = /* @__PURE__ */ new Map();
    this.positionManager = null;
    this.limiter = limiter;
    this.gecko = new GeckoTerminalClient(limiter);
    this.screener = new TokenScreener(this.gecko);
    this.dryRun = dryRun;
    this.simulator = dryRun ? new Simulator() : null;
  }
  // ── Factory ──────────────────────────────────────────────────────────────
  static async create(config) {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const http = new TractionEyeHttpClient(baseUrl, config.agentToken);
    const strategy = await http.get("/agent/strategy");
    const limiter = new RateLimiter();
    return new _TractionEyeClient(
      http,
      String(strategy.strategy_id),
      strategy.strategy_name,
      limiter,
      config.dryRun ?? false
    );
  }
  get isDryRun() {
    return this.dryRun;
  }
  // ── Read methods ─────────────────────────────────────────────────────────
  async getStrategySummary() {
    logMethodCall("getStrategySummary");
    const s = await this.http.get("/agent/strategy");
    return {
      strategyId: String(s.strategy_id),
      strategyName: s.strategy_name,
      pnlDayTon: String(s.pnl_day),
      pnlWeekTon: String(s.pnl_week),
      pnlMonthTon: String(s.pnl_month),
      pnlYearTon: String(s.pnl_year),
      tonInStrategy: String(s.ton_in_strategy),
      totalWinRate: s.total_win_rate,
      tradesPerWeek: s.trades_per_week,
      maxDrawdown: s.max_drawdown,
      lowBalanceState: s.low_balance_state
    };
  }
  async getPortfolio() {
    logMethodCall("getPortfolio");
    const p = await this.http.get("/agent/portfolio");
    return {
      strategyId: this.strategyId,
      totalRealizedPnlTon: String(p.total_realized_pnl_ton),
      totalUnrealizedPnlTon: String(p.total_unrealized_pnl_ton),
      tokens: p.tokens.map((t) => ({
        address: t.token_address,
        symbol: t.symbol,
        decimals: t.decimals,
        quantity: t.quantity_nano ?? t.quantity ?? "0",
        realizedPnlTon: String(t.realized_pnl_ton),
        unrealizedPnlTon: String(t.unrealized_pnl_ton),
        entryPriceTon: t.entry_price != null ? String(t.entry_price) : void 0,
        currentValueTon: t.current_value_ton != null ? String(t.current_value_ton) : void 0
      }))
    };
  }
  /**
   * Returns the first page of tradeable tokens (up to `limit`, default 200).
   * Use `findToken()` for symbol-based lookup instead of loading the full catalog.
   */
  async getAvailableTokens(limit = 200, offset = 0) {
    logMethodCall("getAvailableTokens", { limit, offset });
    const r = await this.http.get(
      `/agent/assets?limit=${limit}&offset=${offset}`
    );
    return r.asset_list.map((a) => ({
      address: a.contract_address,
      symbol: a.symbol,
      decimals: a.decimals
    }));
  }
  /**
   * Find a token by symbol. Preferred way to resolve symbol → address before trading.
   * Example: const weth = await client.findToken('WETH');
   */
  async findToken(symbol) {
    logMethodCall("findToken", { symbol });
    const r = await this.http.get(
      `/agent/assets/search?q=${encodeURIComponent(symbol)}&limit=10`
    );
    const match = r.asset_list.find(
      (a) => a.symbol.toUpperCase() === symbol.toUpperCase()
    );
    if (!match) return null;
    return {
      address: match.contract_address,
      symbol: match.symbol,
      decimals: match.decimals
    };
  }
  // ── Trade methods ─────────────────────────────────────────────────────────
  async previewTrade(req) {
    logMethodCall("previewTrade", { action: req.action, tokenAddress: req.tokenAddress });
    let res;
    try {
      res = await this.http.post("/agent/preview", {
        action: req.action.toLowerCase(),
        token_address: req.tokenAddress,
        amount_nano: req.amountNano
      });
    } catch (e) {
      if (e instanceof TractionEyeHttpError && e.status === 400) {
        const body = e.body;
        if (body?.code === "simulation_failed") {
          return {
            action: req.action,
            tokenAddress: req.tokenAddress,
            amountNano: req.amountNano,
            estimatedReceiveNano: "0",
            minReceiveNano: "0",
            priceImpactPercent: 0,
            swapRate: "0",
            validationOutcome: "rejected",
            lowBalanceState: false
          };
        }
      }
      throw e;
    }
    return {
      action: req.action,
      tokenAddress: req.tokenAddress,
      amountNano: req.amountNano,
      estimatedReceiveNano: String(res.estimated_receive ?? 0),
      minReceiveNano: String(res.min_receive ?? 0),
      priceImpactPercent: res.price_impact ?? 0,
      swapRate: String(res.swap_rate ?? 0),
      validationOutcome: toValidationOutcome(res.validation_outcome),
      lowBalanceState: res.low_balance_state ?? false
    };
  }
  /**
   * Execute a trade. In dry-run mode records a virtual trade via previewTrade().
   */
  async executeTrade(req) {
    logMethodCall("executeTrade", { action: req.action, tokenAddress: req.tokenAddress });
    if (this.dryRun && this.simulator) {
      const preview = await this.previewTrade({
        action: req.action,
        tokenAddress: req.tokenAddress,
        amountNano: req.amountNano
      });
      const price = Number(preview.swapRate) || 0;
      if (req.action === "BUY") {
        this.simulator.recordBuy(req.tokenAddress, "", price, req.amountNano);
      } else {
        this.simulator.recordSell(req.tokenAddress, "", price, req.amountNano);
      }
      return {
        operationId: `sim_${Date.now()}`,
        initialStatus: "pending",
        swapType: req.action,
        tokenAddress: req.tokenAddress
      };
    }
    const idempotencyKey = (0, import_node_crypto.randomUUID)();
    const res = await this.http.post("/agent/execute", {
      action: req.action.toLowerCase(),
      token_address: req.tokenAddress,
      amount_nano: req.amountNano,
      slippage_tolerance: req.slippageTolerance ?? 0.01,
      idempotency_key: idempotencyKey
    });
    const operationId = res.operation_id ?? idempotencyKey;
    this._opContext.set(operationId, {
      swapType: req.action,
      tokenAddress: req.tokenAddress
    });
    const result = res.execution_result;
    return {
      operationId,
      initialStatus: "pending",
      swapType: req.action,
      tokenAddress: req.tokenAddress,
      expectedTokenAmountNano: result?.estimated_receive != null ? String(result.estimated_receive) : void 0,
      expectedTonAmountNano: result?.offer_amount != null ? String(result.offer_amount) : void 0
    };
  }
  async getOperationStatus(operationId) {
    logMethodCall("getOperationStatus", { operationId });
    const res = await this.http.get(`/agent/operation/${operationId}`);
    const result = res.execution_result;
    const ctx = this._opContext.get(operationId);
    const status = toOperationStatus(res.operation_status);
    if (status !== "pending") {
      this._opContext.delete(operationId);
    }
    return {
      operationId,
      status,
      swapType: ctx?.swapType ?? "BUY",
      tokenAddress: ctx?.tokenAddress ?? "",
      actualTokenAmountNano: result?.actual_token_amount != null ? String(result.actual_token_amount) : void 0,
      actualTonAmountNano: result?.actual_ton_amount != null ? String(result.actual_ton_amount) : void 0,
      failureReason: res.failure_reason ?? void 0
    };
  }
  // ── Market analytics (GeckoTerminal) ─────────────────────────────────────
  /** Screen tokens/pools by filter criteria. */
  async screenTokens(config) {
    logMethodCall("screenTokens", { sources: config.sources });
    return this.screener.screen(config);
  }
  /** Search pools by keyword with optional filter. */
  async searchPools(query, filter) {
    logMethodCall("searchPools", { query });
    return this.screener.search(query, filter ?? {});
  }
  /** Get trending pools on TON. */
  async getTrendingPools() {
    logMethodCall("getTrendingPools");
    return this.gecko.getTrendingPools();
  }
  /** Get newly created pools on TON. */
  async getNewPools() {
    logMethodCall("getNewPools");
    return this.gecko.getNewPools();
  }
  /** Get current USD price for a token by address. */
  async getTokenPriceUsd(tokenAddress) {
    logMethodCall("getTokenPriceUsd", { tokenAddress });
    const tp = await this.gecko.getTokenPrice(tokenAddress);
    return tp.priceUsd;
  }
  // ── Position management (TP/SL monitoring) ───────────────────────────────
  /**
   * Start monitoring open positions for TP/SL triggers.
   * Fetches the current portfolio and begins the polling loop.
   */
  async startPositionMonitor(positionConfig, monitorConfig, onEvent) {
    logMethodCall("startPositionMonitor", {
      tp: positionConfig.takeProfitPercent,
      sl: positionConfig.stopLossPercent
    });
    if (this.positionManager?.isRunning) {
      this.positionManager.stop();
    }
    const executor = async (tokenAddress, action, sellPercent) => {
      const portfolio2 = await this.getPortfolio();
      const token = portfolio2.tokens.find((t) => t.address === tokenAddress);
      if (!token) return;
      const pct = Math.max(0, Math.min(100, sellPercent));
      const fullQty = BigInt(token.quantity);
      const sellQty = pct >= 100 ? fullQty : fullQty * BigInt(Math.round(pct * 100)) / 10000n;
      if (sellQty <= 0n) return;
      await this.executeTrade({
        action,
        tokenAddress,
        amountNano: sellQty.toString()
      });
    };
    this.positionManager = new PositionManager(
      this.gecko,
      positionConfig,
      executor,
      onEvent,
      monitorConfig
    );
    const portfolio = await this.getPortfolio();
    for (const t of portfolio.tokens) {
      if (t.entryPriceTon == null) continue;
      const tokenPrice = await this.gecko.getTokenPrice(t.address);
      if (tokenPrice.priceUsd == null) continue;
      const currentValueTon = Number(t.currentValueTon ?? 0);
      const entryPriceTon = Number(t.entryPriceTon);
      const ratio = entryPriceTon > 0 && currentValueTon > 0 ? entryPriceTon / currentValueTon : 1;
      const entryPriceUsd = tokenPrice.priceUsd * ratio;
      this.positionManager.addPosition({
        tokenAddress: t.address,
        symbol: t.symbol,
        entryPriceUsd,
        quantity: t.quantity,
        partialTpTriggered: false
      });
    }
    this.positionManager.start();
  }
  /** Stop the position monitoring loop. */
  stopPositionMonitor() {
    logMethodCall("stopPositionMonitor");
    this.positionManager?.stop();
  }
  /** Get the position manager instance (if started). */
  getPositionManager() {
    return this.positionManager;
  }
  // ── Simulation ───────────────────────────────────────────────────────────
  /** Get simulation results (only available in dry-run mode). */
  getSimulationResults() {
    return this.simulator?.getResults() ?? null;
  }
  /** Reset simulation data (only in dry-run mode). */
  resetSimulation() {
    this.simulator?.reset();
  }
};

// src/config.ts
var import_node_fs = require("fs");
var import_node_os = require("os");
var import_node_path = require("path");
var DEFAULT_DATA_DIR = process.env["TRACTIONEYE_DATA_DIR"] ?? (0, import_node_path.join)((0, import_node_os.homedir)(), ".tractioneye");
function configPath() {
  return (0, import_node_path.join)(DEFAULT_DATA_DIR, "config.json");
}
function briefingPath() {
  return (0, import_node_path.join)(DEFAULT_DATA_DIR, "briefing.json");
}
function ensureDataDir() {
  (0, import_node_fs.mkdirSync)(DEFAULT_DATA_DIR, { recursive: true });
}
function readConfig() {
  try {
    const raw = (0, import_node_fs.readFileSync)(configPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeConfig(config) {
  ensureDataDir();
  (0, import_node_fs.writeFileSync)(configPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}
function updateConfig(patch) {
  const config = { ...readConfig(), ...patch };
  writeConfig(config);
  return config;
}
function readBriefing() {
  try {
    const raw = (0, import_node_fs.readFileSync)(briefingPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// src/tools/index.ts
var PRICE_CHANGE_RANGE = {
  type: "object",
  properties: { min: { type: "number" }, max: { type: "number" } }
};
function createTractionEyeTools(client) {
  return [
    // ── 1. read_briefing ────────────────────────────────────────────────
    {
      name: "tractioneye_read_briefing",
      description: "Call this FIRST on every trading session tick. Returns market candidates collected from multiple perspectives (volume leaders, trending across timeframes, most active, newly created), current portfolio, and strategy performance. Each candidate has tags showing how it was discovered \u2014 a pool appearing in several categories simultaneously may indicate a stronger signal. The briefing also includes top-lists sorted by volume, liquidity, FDV, transaction count, and price gainers (1h, 24h) \u2014 use these different views to compare, form hypotheses about what makes a good candidate, and verify your assumptions across sessions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        const briefing = readBriefing();
        if (!briefing) return { error: "No briefing file found. Is the daemon running?" };
        return briefing;
      }
    },
    // ── 2. analyze_pool ─────────────────────────────────────────────────
    {
      name: "tractioneye_analyze_pool",
      description: "Deep-analyze a candidate from briefing: recent trades (whale detection, buy/sell pressure) and OHLCV candles (price trend, volatility). Call AFTER read_briefing for candidates you are interested in, BEFORE buy_token. Uses 2 API requests.",
      parameters: {
        type: "object",
        properties: {
          poolAddress: { type: "string", description: "Pool address to analyze" },
          ohlcvTimeframe: {
            type: "string",
            enum: ["day", "hour", "minute"],
            description: "OHLCV timeframe (default: hour)"
          },
          ohlcvLimit: { type: "number", description: "Number of candles (default: 30)" },
          minTradeVolumeUsd: {
            type: "number",
            description: "Only return trades above this USD volume (whale filter)"
          }
        },
        required: ["poolAddress"],
        additionalProperties: false
      },
      handler: async (args) => {
        const poolAddress = args["poolAddress"];
        const timeframe = args["ohlcvTimeframe"] ?? "hour";
        const limit = args["ohlcvLimit"] ?? 30;
        const minVol = args["minTradeVolumeUsd"];
        const [trades, ohlcv] = await Promise.all([
          client.gecko.getPoolTrades(poolAddress, minVol != null ? { tradeVolumeInUsdGreaterThan: minVol } : void 0),
          client.gecko.getPoolOhlcv(poolAddress, timeframe, limit)
        ]);
        const walletVolume = /* @__PURE__ */ new Map();
        for (const t of trades) {
          walletVolume.set(t.txFromAddress, (walletVolume.get(t.txFromAddress) ?? 0) + t.volumeInUsd);
        }
        const totalVolume = trades.reduce((s, t) => s + t.volumeInUsd, 0);
        const topWallets = [...walletVolume.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([address, volume]) => ({
          address,
          volumeUsd: volume,
          percentOfTotal: totalVolume > 0 ? Math.round(volume / totalVolume * 1e4) / 100 : 0
        }));
        return {
          trades: { count: trades.length, items: trades.slice(0, 50) },
          ohlcv: { timeframe, candles: ohlcv.candles, meta: ohlcv.meta },
          walletConcentration: { topWallets, totalTradeVolumeUsd: totalVolume }
        };
      }
    },
    // ── 3. buy_token ────────────────────────────────────────────────────
    {
      name: "tractioneye_buy_token",
      description: "Buy a token after analysis. Handles: resolve symbol \u2192 preview trade \u2192 check validation & price impact \u2192 execute \u2192 poll status until final. Call AFTER analyze_pool confirmed the candidate. Returns final execution result or rejection reason.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Token symbol (e.g. NOT). Either symbol or tokenAddress required." },
          tokenAddress: { type: "string", description: "Token contract address. Either symbol or tokenAddress required." },
          amountNano: { type: "string", description: "Amount of TON to spend in nano units" },
          slippageTolerance: { type: "number", description: "Slippage tolerance (default: 0.01 = 1%)" }
        },
        required: ["amountNano"],
        additionalProperties: false
      },
      handler: async (args) => {
        let tokenAddress = args["tokenAddress"];
        const symbol = args["symbol"];
        const amountNano = args["amountNano"];
        const slippage = args["slippageTolerance"];
        if (!tokenAddress && symbol) {
          const token = await client.findToken(symbol);
          if (!token) return { error: `Token not found: ${symbol}` };
          tokenAddress = token.address;
        }
        if (!tokenAddress) return { error: "Provide either symbol or tokenAddress" };
        const preview = await client.previewTrade({ action: "BUY", tokenAddress, amountNano });
        if (preview.validationOutcome === "rejected") {
          return { status: "rejected", reason: "Validation rejected", preview };
        }
        if (preview.priceImpactPercent > 5) {
          return { status: "rejected", reason: `High price impact: ${preview.priceImpactPercent}%`, preview };
        }
        const execution = await client.executeTrade({
          action: "BUY",
          tokenAddress,
          amountNano,
          slippageTolerance: slippage
        });
        const result = await pollOperationStatus(client, execution.operationId);
        return { status: result.status, operationId: result.operationId, preview, result };
      }
    },
    // ── 4. sell_token ───────────────────────────────────────────────────
    {
      name: "tractioneye_sell_token",
      description: 'Sell a token (full or partial). Handles: preview \u2192 validate \u2192 execute \u2192 poll. Use "all" for amountNano to sell entire position. Call when you decide to exit a position manually.',
      parameters: {
        type: "object",
        properties: {
          tokenAddress: { type: "string", description: "Token contract address" },
          amountNano: { type: "string", description: 'Amount in nano units or "all" for full position' },
          slippageTolerance: { type: "number", description: "Slippage tolerance (default: 0.01 = 1%)" }
        },
        required: ["tokenAddress", "amountNano"],
        additionalProperties: false
      },
      handler: async (args) => {
        const tokenAddress = args["tokenAddress"];
        let amountNano = args["amountNano"];
        const slippage = args["slippageTolerance"];
        if (amountNano === "all") {
          const portfolio = await client.getPortfolio();
          const token = portfolio.tokens.find((t) => t.address === tokenAddress);
          if (!token) return { error: `Token not found in portfolio: ${tokenAddress}` };
          amountNano = token.quantity;
        }
        const preview = await client.previewTrade({ action: "SELL", tokenAddress, amountNano });
        if (preview.validationOutcome === "rejected") {
          return { status: "rejected", reason: "Validation rejected", preview };
        }
        const execution = await client.executeTrade({
          action: "SELL",
          tokenAddress,
          amountNano,
          slippageTolerance: slippage
        });
        const result = await pollOperationStatus(client, execution.operationId);
        return { status: result.status, operationId: result.operationId, preview, result };
      }
    },
    // ── 5. set_tp_sl ────────────────────────────────────────────────────
    {
      name: "tractioneye_set_tp_sl",
      description: "Set Take Profit and Stop Loss for a specific token or as defaults for all positions. Call AFTER buy_token. The background daemon monitors prices 24/7 and auto-sells when triggered. Writes to ~/.tractioneye/config.json.",
      parameters: {
        type: "object",
        properties: {
          tokenAddress: { type: "string", description: "Token address. Omit to set defaults." },
          takeProfitPercent: { type: "number", description: "Take profit threshold (e.g. 25 = +25%)" },
          stopLossPercent: { type: "number", description: "Stop loss threshold (e.g. 8 = -8%)" },
          partialTakeProfitPercent: { type: "number", description: "Partial TP trigger (e.g. 15 = +15%)" },
          partialTakeProfitSellPercent: { type: "number", description: "Sell this % of position at partial TP (e.g. 50)" }
        },
        additionalProperties: false
      },
      handler: async (args) => {
        ensureDataDir();
        const config = readConfig();
        if (!config.tpSl) {
          config.tpSl = { defaults: { takeProfitPercent: 25, stopLossPercent: 8 } };
        }
        const patch = {};
        if (args["takeProfitPercent"] != null) patch.takeProfitPercent = args["takeProfitPercent"];
        if (args["stopLossPercent"] != null) patch.stopLossPercent = args["stopLossPercent"];
        if (args["partialTakeProfitPercent"] != null) patch.partialTakeProfitPercent = args["partialTakeProfitPercent"];
        if (args["partialTakeProfitSellPercent"] != null) patch.partialTakeProfitSellPercent = args["partialTakeProfitSellPercent"];
        const tokenAddress = args["tokenAddress"];
        if (tokenAddress) {
          if (!config.tpSl.perToken) config.tpSl.perToken = {};
          config.tpSl.perToken[tokenAddress] = { ...config.tpSl.perToken[tokenAddress], ...patch };
        } else {
          config.tpSl.defaults = { ...config.tpSl.defaults, ...patch };
        }
        writeConfig(config);
        return { success: true, tpSl: config.tpSl };
      }
    },
    // ── 6. update_screening_config ──────────────────────────────────────
    {
      name: "tractioneye_update_screening_config",
      description: "Update token screening criteria used by the background daemon for candidate selection. Call during reflection after analyzing trading results to improve future candidate quality. Writes to ~/.tractioneye/config.json.",
      parameters: {
        type: "object",
        properties: {
          intervalMs: { type: "number", description: "Screening interval in ms (default: 180000 = 3min)" },
          minLiquidityUsd: { type: "number" },
          maxLiquidityUsd: { type: "number" },
          minFdvUsd: { type: "number" },
          maxFdvUsd: { type: "number" },
          minMarketCapUsd: { type: "number" },
          maxMarketCapUsd: { type: "number" },
          minLockedLiquidityPercent: { type: "number" },
          minVolume24hUsd: { type: "number" },
          priceChange5m: PRICE_CHANGE_RANGE,
          priceChange15m: PRICE_CHANGE_RANGE,
          priceChange30m: PRICE_CHANGE_RANGE,
          priceChange1h: PRICE_CHANGE_RANGE,
          priceChange6h: PRICE_CHANGE_RANGE,
          priceChange24h: PRICE_CHANGE_RANGE,
          minTransactions24h: { type: "number" },
          minBuySellRatio: { type: "number" },
          minUniqueBuyers24h: { type: "number" }
        },
        additionalProperties: false
      },
      handler: async (args) => {
        ensureDataDir();
        const config = readConfig();
        if (!config.screening) config.screening = {};
        if (args["intervalMs"] != null) {
          config.screening.intervalMs = args["intervalMs"];
        }
        const { intervalMs: _interval, ...filterArgs } = args;
        const filter = { ...config.screening.filter };
        for (const [key, value] of Object.entries(filterArgs)) {
          if (value != null) {
            filter[key] = value;
          }
        }
        config.screening.filter = filter;
        writeConfig(config);
        return { success: true, screening: config.screening };
      }
    },
    // ── 7. get_status ───────────────────────────────────────────────────
    {
      name: "tractioneye_get_status",
      description: "Get strategy performance (PnL, win rate, balance, drawdown) and current portfolio (positions with PnL) in one call. Call during reflection or when user asks about performance.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        const [summary, portfolio] = await Promise.all([
          client.getStrategySummary(),
          client.getPortfolio()
        ]);
        return { strategy: summary, portfolio };
      }
    },
    // ── 8. screen_tokens ────────────────────────────────────────────────
    {
      name: "tractioneye_screen_tokens",
      description: "Screen TON tokens/pools by criteria: liquidity, FDV, market cap, volume, price change (5m to 24h), transactions, buy/sell ratio, unique buyers. Returns matching pools from GeckoTerminal. Use for ad-hoc screening beyond the daemon briefing.",
      parameters: {
        type: "object",
        properties: {
          minLiquidityUsd: { type: "number", description: "Minimum pool liquidity in USD" },
          maxLiquidityUsd: { type: "number", description: "Maximum pool liquidity in USD" },
          minFdvUsd: { type: "number", description: "Minimum fully diluted valuation in USD" },
          maxFdvUsd: { type: "number", description: "Maximum fully diluted valuation in USD" },
          minMarketCapUsd: { type: "number", description: "Minimum market cap in USD" },
          maxMarketCapUsd: { type: "number", description: "Maximum market cap in USD" },
          minLockedLiquidityPercent: { type: "number", description: "Minimum locked liquidity (e.g. 50 = 50%)" },
          minVolume24hUsd: { type: "number", description: "Minimum 24h volume in USD" },
          priceChange5m: { ...PRICE_CHANGE_RANGE, description: "Price change 5m range (%)" },
          priceChange15m: { ...PRICE_CHANGE_RANGE, description: "Price change 15m range (%)" },
          priceChange30m: { ...PRICE_CHANGE_RANGE, description: "Price change 30m range (%)" },
          priceChange1h: { ...PRICE_CHANGE_RANGE, description: "Price change 1h range (%)" },
          priceChange6h: { ...PRICE_CHANGE_RANGE, description: "Price change 6h range (%)" },
          priceChange24h: { ...PRICE_CHANGE_RANGE, description: "Price change 24h range (%)" },
          minTransactions24h: { type: "number", description: "Min transactions in 24h" },
          minBuySellRatio: { type: "number", description: "Min buy/sell ratio (e.g. 1.5)" },
          minUniqueBuyers24h: { type: "number", description: "Min unique buyers in 24h" },
          sources: {
            type: "array",
            items: { type: "string", enum: ["pools", "trending", "new_pools"] },
            description: "Sources to scan (default: all)"
          }
        },
        additionalProperties: false
      },
      handler: async (args) => {
        const sources = args["sources"];
        const rangeArg = (key) => args[key];
        return client.screenTokens({
          filter: {
            minLiquidityUsd: args["minLiquidityUsd"],
            maxLiquidityUsd: args["maxLiquidityUsd"],
            minFdvUsd: args["minFdvUsd"],
            maxFdvUsd: args["maxFdvUsd"],
            minMarketCapUsd: args["minMarketCapUsd"],
            maxMarketCapUsd: args["maxMarketCapUsd"],
            minLockedLiquidityPercent: args["minLockedLiquidityPercent"],
            minVolume24hUsd: args["minVolume24hUsd"],
            priceChange5m: rangeArg("priceChange5m"),
            priceChange15m: rangeArg("priceChange15m"),
            priceChange30m: rangeArg("priceChange30m"),
            priceChange1h: rangeArg("priceChange1h"),
            priceChange6h: rangeArg("priceChange6h"),
            priceChange24h: rangeArg("priceChange24h"),
            minTransactions24h: args["minTransactions24h"],
            minBuySellRatio: args["minBuySellRatio"],
            minUniqueBuyers24h: args["minUniqueBuyers24h"]
          },
          sources
        });
      }
    },
    // ── 9. find ─────────────────────────────────────────────────────────
    {
      name: "tractioneye_find",
      description: "Find a token by symbol or search pools by keyword. Combines findToken (symbol \u2192 address) and searchPools (keyword \u2192 pool list). Use when you need to resolve a token or explore pools by name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Token symbol or search keyword" }
        },
        required: ["query"],
        additionalProperties: false
      },
      handler: async (args) => {
        const query = args["query"];
        const [token, pools] = await Promise.all([
          client.findToken(query),
          client.searchPools(query)
        ]);
        return { token, pools };
      }
    },
    // ── 10. get_token_price ─────────────────────────────────────────────
    {
      name: "tractioneye_get_token_price",
      description: "Get current USD price for a token by its contract address via GeckoTerminal. Use for quick price checks.",
      parameters: {
        type: "object",
        properties: {
          tokenAddress: { type: "string", description: "Token contract address" }
        },
        required: ["tokenAddress"],
        additionalProperties: false
      },
      handler: async (args) => client.getTokenPriceUsd(args["tokenAddress"])
    },
    // ── 11. get_available_tokens ────────────────────────────────────────
    {
      name: "tractioneye_get_available_tokens",
      description: "Get the list of tokens that can be traded in this strategy. Use to check what tokens are available or to resolve symbols and addresses.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => client.getAvailableTokens()
    },
    // ── 12. get_simulation_results ──────────────────────────────────────
    {
      name: "tractioneye_get_simulation_results",
      description: "Get dry-run simulation results: win rate, average P&L, recommended TP/SL/position size parameters. Only available in dry-run mode. Call after running simulation to evaluate strategy before going live.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => client.getSimulationResults()
    }
  ];
}
var POLL_INTERVAL_MS = 2e3;
var MAX_POLLS = 15;
async function pollOperationStatus(client, operationId) {
  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await client.getOperationStatus(operationId);
    if (status.status !== "pending") return status;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return client.getOperationStatus(operationId);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_DATA_DIR,
  GeckoTerminalClient,
  PositionManager,
  RateLimiter,
  RequestPriority,
  Simulator,
  TokenScreener,
  TractionEyeClient,
  TractionEyeHttpError,
  briefingPath,
  configPath,
  createTractionEyeTools,
  ensureDataDir,
  readBriefing,
  readConfig,
  updateConfig,
  writeConfig
});
