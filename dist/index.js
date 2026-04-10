import {
  DEFAULT_DATA_DIR,
  atomicWriteJsonSync,
  briefingPath,
  candidateRegistryPath,
  configPath,
  cooldownPath,
  ensureDataDir,
  ensureStateDir,
  evalReportPath,
  evalTracesDir,
  isAgentSessionActive,
  marketStatePath,
  playbooksPath,
  portfolioStatePath,
  readBriefing,
  readConfig,
  reflectionLogPath,
  sessionLockPath,
  stateDirPath,
  touchSessionLock,
  updateConfig,
  writeConfig
} from "./chunk-6I47TOLN.js";
import {
  checkOrganicity
} from "./chunk-VCLXCZIZ.js";
import {
  buildConfidence,
  computeSignals
} from "./chunk-I44ENZ6C.js";

// src/client.ts
import { randomUUID } from "crypto";

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
  constructor(name = "default", maxTokens = 5, windowMs = 6e4, minIntervalMs = 2e3) {
    this.lastRequest = 0;
    this.queue = [];
    this.draining = false;
    this.name = name;
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
      const sinceLast = Date.now() - this.lastRequest;
      if (sinceLast < this.minIntervalMs) {
        await sleep(this.minIntervalMs - sinceLast);
      }
      const entry = this.queue.shift();
      this.tokens -= 1;
      this.lastRequest = Date.now();
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
  // ---------- Trades & OHLCV ----------
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
  /** Fetch OHLCV candles for a pool (retries with cache-bust on empty response). */
  async getPoolOhlcv(poolAddress, timeframe = "day", limit = 30, priority = 1 /* High */) {
    const basePath = `/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const path = attempt === 0 ? basePath : `${basePath}&_cb=${Date.now()}`;
      const data = await this.get(path, priority);
      const ohlcvList = data.data.attributes.ohlcv_list;
      if (ohlcvList.length === 0 && attempt < maxAttempts - 1) {
        console.warn(
          `[gecko] OHLCV empty for ${poolAddress}, retrying with cache-bust (attempt ${attempt + 1}/${maxAttempts})`
        );
        await new Promise((r) => setTimeout(r, 3e3));
        continue;
      }
      if (ohlcvList.length === 0) {
        console.warn(`[gecko] OHLCV still empty for ${poolAddress} after ${maxAttempts} attempts`);
      }
      const candles = ohlcvList.map(
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
    return { candles: [], meta: {} };
  }
  // ---------- Token & Pool Info (v2) ----------
  /**
   * Fetch token safety + holder info from GeckoTerminal.
   * Endpoint: GET /networks/ton/tokens/{tokenAddress}/info
   * See SPEC-V2.md Section V.
   */
  async getTokenInfo(tokenAddress, priority = 1 /* High */) {
    const data = await this.get(
      `/networks/${NETWORK}/tokens/${tokenAddress}/info`,
      priority
    );
    const a = data.data.attributes;
    return {
      address: a.address,
      name: a.name ?? "",
      symbol: a.symbol ?? "",
      decimals: a.decimals ?? 9,
      gtScore: a.gt_score,
      gtScoreDetails: a.gt_score_details ? {
        pool: a.gt_score_details.pool,
        transaction: a.gt_score_details.transaction,
        creation: a.gt_score_details.creation,
        info: a.gt_score_details.info,
        holders: a.gt_score_details.holders
      } : null,
      holders: a.holders ? {
        count: a.holders.count,
        distributionPercentage: {
          top10: num(a.holders.distribution_percentage.top_10),
          range11to30: num(a.holders.distribution_percentage["11_30"]),
          range31to50: num(a.holders.distribution_percentage["31_50"]),
          rest: num(a.holders.distribution_percentage.rest)
        }
      } : null,
      isHoneypot: a.is_honeypot,
      mintAuthority: a.mint_authority,
      freezeAuthority: a.freeze_authority,
      websites: a.websites ?? [],
      socials: [
        ...a.twitter_handle ? [{ type: "twitter", url: `https://twitter.com/${a.twitter_handle}` }] : [],
        ...a.telegram_handle ? [{ type: "telegram", url: `https://t.me/${a.telegram_handle}` }] : [],
        ...a.discord_url ? [{ type: "discord", url: a.discord_url }] : []
      ]
    };
  }
  /**
   * Fetch pool details including unique buyers/sellers from GeckoTerminal.
   * Endpoint: GET /networks/ton/pools/{poolAddress}
   * See SPEC-V2.md Section V.
   */
  async getPoolInfo(poolAddress, priority = 1 /* High */) {
    const data = await this.get(
      `/networks/${NETWORK}/pools/${poolAddress}`,
      priority
    );
    const a = data.data.attributes;
    const pc = a.price_change_percentage;
    const vol = a.volume_usd;
    const txn = a.transactions;
    return {
      poolAddress: a.address,
      name: a.name,
      baseTokenPriceUsd: a.base_token_price_usd,
      reserveInUsd: num(a.reserve_in_usd),
      lockedLiquidityPercentage: a.locked_liquidity_percentage,
      fdvUsd: a.fdv_usd != null ? num(a.fdv_usd) : null,
      marketCapUsd: a.market_cap_usd != null ? num(a.market_cap_usd) : null,
      priceChange: {
        m5: num(pc.m5),
        m15: num(pc.m15),
        m30: num(pc.m30),
        h1: num(pc.h1),
        h6: num(pc.h6),
        h24: num(pc.h24)
      },
      volume: {
        m5: num(vol.m5),
        m15: num(vol.m15),
        m30: num(vol.m30),
        h1: num(vol.h1),
        h6: num(vol.h6),
        h24: num(vol.h24)
      },
      transactions: {
        m5: txn.m5,
        m15: txn.m15,
        m30: txn.m30,
        h1: txn.h1,
        h6: txn.h6,
        h24: txn.h24
      },
      poolCreatedAt: a.pool_created_at
    };
  }
  /** Register a callback for 429 responses (used by QuotaManager). */
  setOn429Callback(cb) {
    this.on429Callback = cb;
  }
  // ---------- Internal ----------
  get(path, priority) {
    return this.limiter.schedule(priority, async () => {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch(`${GECKO_BASE}${path}`, {
          headers: { Accept: "application/json" }
        });
        if (res.status === 429) {
          this.on429Callback?.(path);
          const backoffMs = (attempt + 1) * 5e3;
          console.warn(`[gecko] 429 on ${path}, waiting ${backoffMs / 1e3}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}: ${path}`);
        return res.json();
      }
      throw new Error(`GeckoTerminal 429: ${path} (exhausted ${maxRetries} retries)`);
    });
  }
};
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// src/dexscreener/client.ts
var DEX_BASE = "https://api.dexscreener.com";
var DexScreenerClient = class {
  constructor(limiter) {
    this.limiter = limiter;
  }
  // ---------- Pool search ----------
  /** Search pools by keyword, filtered to TON chain. */
  async searchPools(query, priority = 2 /* Low */) {
    const data = await this.get(
      `/latest/dex/search?q=${encodeURIComponent(query)}`,
      priority
    );
    if (!data.pairs) return [];
    return data.pairs.filter((p) => p.chainId === "ton").map(mapPairToPoolInfo);
  }
  /** Fetch all pairs for a token address on TON. */
  async getTokenPairs(tokenAddress, priority = 2 /* Low */) {
    const data = await this.get(
      `/latest/dex/tokens/${tokenAddress}`,
      priority
    );
    if (!data.pairs) return [];
    return data.pairs.filter((p) => p.chainId === "ton").map(mapPairToPoolInfo);
  }
  /** Fetch a single pair by address on TON. */
  async getPair(pairAddress, priority = 2 /* Low */) {
    const data = await this.get(
      `/latest/dex/pairs/ton/${pairAddress}`,
      priority
    );
    if (!data.pair) return null;
    return mapPairToPoolInfo(data.pair);
  }
  // ---------- Token price ----------
  /** Fetch price for a single token (picks highest-liquidity pair). */
  async getTokenPrice(tokenAddress, priority = 0 /* Critical */) {
    const pools = await this.getTokenPairs(tokenAddress, priority);
    if (pools.length === 0) {
      return { address: tokenAddress, priceUsd: null, symbol: "" };
    }
    const best = pools.reduce((a, b) => b.reserveInUsd > a.reserveInUsd ? b : a);
    const priceNum = Number(best.baseTokenPriceUsd);
    return {
      address: tokenAddress,
      priceUsd: Number.isFinite(priceNum) ? priceNum : null,
      symbol: best.name.split(" / ")[0] ?? ""
    };
  }
  /** Fetch prices for multiple tokens sequentially. */
  async getTokenPrices(addresses, priority = 0 /* Critical */) {
    const results = [];
    for (const addr of addresses) {
      results.push(await this.getTokenPrice(addr, priority));
    }
    return results;
  }
  /**
   * Batch price query — up to 30 addresses per request.
   * Uses /latest/dex/tokens/{addr1,addr2,...addr30}.
   * Critical for position monitoring: 8 positions = 1 request instead of 8.
   * See SPEC-V2.md Section XIII.
   */
  async getTokenPricesBatch(addresses, priority = 0 /* Critical */) {
    const result = /* @__PURE__ */ new Map();
    if (addresses.length === 0) return result;
    for (let i = 0; i < addresses.length; i += 30) {
      const chunk = addresses.slice(i, i + 30);
      const joined = chunk.join(",");
      const data = await this.get(
        `/latest/dex/tokens/${joined}`,
        priority
      );
      const pairs = (data.pairs ?? []).filter((p) => p.chainId === "ton");
      const byToken = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const addr = pair.baseToken.address;
        const existing = byToken.get(addr);
        if (!existing || (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0)) {
          byToken.set(addr, pair);
        }
      }
      for (const addr of chunk) {
        const pair = byToken.get(addr);
        if (pair) {
          const priceNum = Number(pair.priceUsd);
          result.set(addr, {
            address: addr,
            priceUsd: Number.isFinite(priceNum) ? priceNum : null,
            symbol: pair.baseToken.symbol
          });
        } else {
          result.set(addr, { address: addr, priceUsd: null, symbol: "" });
        }
      }
    }
    return result;
  }
  // ---------- Discovery ----------
  /** Top pools on TON sorted by 24h volume. */
  async getTopPools(priority = 2 /* Low */) {
    const data = await this.get(
      `/latest/dex/search?q=TON`,
      priority
    );
    if (!data.pairs) return [];
    return data.pairs.filter((p) => p.chainId === "ton").sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)).map(mapPairToPoolInfo);
  }
  /** Trending (boosted) pools on TON. Falls back to getTopPools if none found. */
  async getTrendingPools(priority = 2 /* Low */) {
    const boosts = await this.get(`/token-boosts/latest/v1`, priority);
    const tonBoosts = (Array.isArray(boosts) ? boosts : []).filter(
      (b) => b.chainId === "ton"
    );
    if (tonBoosts.length === 0) {
      return this.getTopPools(priority);
    }
    const boostAmounts = /* @__PURE__ */ new Map();
    for (const b of tonBoosts) {
      const current = boostAmounts.get(b.tokenAddress) ?? 0;
      boostAmounts.set(b.tokenAddress, current + (b.totalAmount ?? b.amount ?? 0));
    }
    const pools = [];
    for (const boost of tonBoosts.slice(0, 5)) {
      const tokenPools = await this.getTokenPairs(boost.tokenAddress, priority);
      if (tokenPools.length > 0) {
        const pool = tokenPools[0];
        pool.boostTotalAmount = boostAmounts.get(boost.tokenAddress) ?? 0;
        pools.push(pool);
      }
    }
    return pools;
  }
  /** Newly profiled tokens on TON. */
  async getNewPools(priority = 2 /* Low */) {
    const profiles = await this.get(`/token-profiles/latest/v1`, priority);
    const tonProfiles = (Array.isArray(profiles) ? profiles : []).filter(
      (p) => p.chainId === "ton"
    );
    const pools = [];
    for (const profile of tonProfiles.slice(0, 5)) {
      const tokenPools = await this.getTokenPairs(profile.tokenAddress, priority);
      if (tokenPools.length > 0) {
        const pool = tokenPools[0];
        const desc = (profile.description ?? "").toLowerCase();
        if (desc.includes("cto") || desc.includes("community takeover")) {
          pool.cto = true;
        }
        pools.push(pool);
      }
    }
    return pools;
  }
  /** Register a callback for 429 responses (used by QuotaManager). */
  setOn429Callback(cb) {
    this.on429Callback = cb;
  }
  // ---------- Internal ----------
  get(path, priority) {
    return this.limiter.schedule(priority, async () => {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const res = await fetch(`${DEX_BASE}${path}`, {
          headers: { Accept: "application/json" }
        });
        if (res.status === 429) {
          this.on429Callback?.(path);
          const backoffMs = (attempt + 1) * 3e3;
          console.warn(`[dexscreener] 429 on ${path}, waiting ${backoffMs / 1e3}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}: ${path}`);
        return res.json();
      }
      throw new Error(`DexScreener 429: ${path} (exhausted ${maxRetries} retries)`);
    });
  }
};
function mapPairToPoolInfo(pair) {
  const buys24 = pair.txns?.h24?.buys ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;
  const buys1h = pair.txns?.h1?.buys ?? 0;
  const sells1h = pair.txns?.h1?.sells ?? 0;
  return {
    poolAddress: pair.pairAddress,
    name: `${pair.baseToken.symbol} / ${pair.quoteToken.symbol}`,
    baseTokenPriceUsd: pair.priceUsd ?? "0",
    reserveInUsd: pair.liquidity?.usd ?? 0,
    fdvUsd: pair.fdv ?? null,
    marketCapUsd: pair.marketCap ?? null,
    lockedLiquidityPercent: null,
    volume24hUsd: pair.volume?.h24 ?? 0,
    volume6hUsd: pair.volume?.h6 ?? 0,
    volume1hUsd: pair.volume?.h1 ?? 0,
    priceChange5m: pair.priceChange?.m5 ?? 0,
    priceChange15m: 0,
    priceChange30m: 0,
    priceChange1h: pair.priceChange?.h1 ?? 0,
    priceChange6h: pair.priceChange?.h6 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    transactions24h: buys24 + sells24,
    buys24h: buys24,
    sells24h: sells24,
    // Unique buyers/sellers: 0 from DexScreener (only available via GeckoTerminal)
    uniqueBuyers1h: 0,
    uniqueBuyers6h: 0,
    uniqueBuyers24h: 0,
    uniqueSellers1h: 0,
    uniqueSellers6h: 0,
    uniqueSellers24h: 0,
    buySellRatio: sells24 > 0 ? buys24 / sells24 : buys24 > 0 ? Infinity : 0,
    createdAt: pair.pairCreatedAt != null ? new Date(pair.pairCreatedAt).toISOString() : "",
    baseTokenId: pair.baseToken.address,
    tags: [],
    // v2 fields
    dexId: pair.dexId ?? "",
    priceNative: pair.priceNative ?? "0",
    buys5m: pair.txns?.m5?.buys ?? 0,
    sells5m: pair.txns?.m5?.sells ?? 0,
    buys1h,
    sells1h,
    buys6h: pair.txns?.h6?.buys ?? 0,
    sells6h: pair.txns?.h6?.sells ?? 0,
    volume5mUsd: pair.volume?.m5 ?? 0,
    socials: pair.info?.socials?.map((s) => ({ type: s.type, url: s.url })) ?? [],
    websites: pair.info?.websites?.map((w) => w.url) ?? [],
    boostTotalAmount: 0,
    cto: false
  };
}

// src/screening/screener.ts
var ALL_SOURCES = ["pools", "trending", "new_pools"];
var TokenScreener = class {
  constructor(dex) {
    this.dex = dex;
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
    const pools = await this.dex.searchPools(query);
    return pools.filter((p) => matchesFilter(p, filter));
  }
  async fetchSources(sources) {
    const results = await Promise.all(
      sources.map((s) => {
        switch (s) {
          case "pools":
            return this.dex.getTopPools();
          case "trending":
            return this.dex.getTrendingPools();
          case "new_pools":
            return this.dex.getNewPools();
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
  constructor(dex, config, executeTradeCallback, onEvent, monitorConfig) {
    this.dex = dex;
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
      prices = await this.dex.getTokenPrices(addresses);
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
  constructor(http, strategyId, strategyName, geckoLimiter, dexLimiter, dryRun) {
    this.http = http;
    this.strategyId = strategyId;
    this.strategyName = strategyName;
    /** In-memory map: operationId → execution context (swapType, tokenAddress). */
    this._opContext = /* @__PURE__ */ new Map();
    this.positionManager = null;
    this.geckoLimiter = geckoLimiter;
    this.dexLimiter = dexLimiter;
    this.limiter = geckoLimiter;
    this.gecko = new GeckoTerminalClient(geckoLimiter);
    this.dex = new DexScreenerClient(dexLimiter);
    this.screener = new TokenScreener(this.dex);
    this.dryRun = dryRun;
    this.simulator = dryRun ? new Simulator() : null;
  }
  // ── Factory ──────────────────────────────────────────────────────────────
  static async create(config) {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const http = new TractionEyeHttpClient(baseUrl, config.agentToken);
    const strategy = await http.get("/agent/strategy");
    const geckoLimiter = new RateLimiter("gecko", 5, 6e4, 2e3);
    const dexLimiter = new RateLimiter("dexscreener", 10, 6e4, 1e3);
    return new _TractionEyeClient(
      http,
      String(strategy.strategy_id),
      strategy.strategy_name,
      geckoLimiter,
      dexLimiter,
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
  async findTokenByAddress(address) {
    logMethodCall("findTokenByAddress", { address });
    const r = await this.http.get(
      `/agent/assets/search?q=${encodeURIComponent(address)}&limit=10`
    );
    const match = r.asset_list.find(
      (a) => a.contract_address === address
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
    const idempotencyKey = randomUUID();
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
  // ── Market analytics (DexScreener + GeckoTerminal OHLCV) ─────────────────
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
    return this.dex.getTrendingPools();
  }
  /** Get newly created pools on TON. */
  async getNewPools() {
    logMethodCall("getNewPools");
    return this.dex.getNewPools();
  }
  /** Get current USD price for a token by address. */
  async getTokenPriceUsd(tokenAddress) {
    logMethodCall("getTokenPriceUsd", { tokenAddress });
    const tp = await this.dex.getTokenPrice(tokenAddress);
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
      this.dex,
      positionConfig,
      executor,
      onEvent,
      monitorConfig
    );
    const portfolio = await this.getPortfolio();
    for (const t of portfolio.tokens) {
      if (t.entryPriceTon == null) continue;
      const tokenPrice = await this.dex.getTokenPrice(t.address);
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

// src/state/market.ts
import { readFileSync } from "fs";
function readMarketState() {
  try {
    const raw = readFileSync(marketStatePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeMarketState(state) {
  atomicWriteJsonSync(marketStatePath(), state);
  try {
    const briefing = {
      timestamp: state.updatedAt,
      candidates: state.shortlist,
      topLists: state.topLists,
      portfolio: void 0,
      strategy: void 0
    };
    atomicWriteJsonSync(briefingPath(), briefing);
  } catch {
  }
}

// src/state/portfolio.ts
import { readFileSync as readFileSync2 } from "fs";
function readPortfolioState() {
  try {
    const raw = readFileSync2(portfolioStatePath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { updatedAt: (/* @__PURE__ */ new Date()).toISOString(), positions: {} };
  }
}
function writePortfolioState(state) {
  state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  atomicWriteJsonSync(portfolioStatePath(), state);
}
function addPosition(state, thesis) {
  state.positions[thesis.tokenAddress] = thesis;
}
function updatePositionBarriers(state, tokenAddress, barriers) {
  const pos = state.positions[tokenAddress];
  if (!pos) return false;
  pos.barriers = barriers;
  return true;
}
function updateThesisStatus(state, tokenAddress, status) {
  const pos = state.positions[tokenAddress];
  if (!pos) return false;
  pos.thesisStatus = status;
  pos.lastReviewedAt = (/* @__PURE__ */ new Date()).toISOString();
  return true;
}
function recordExitEvent(state, tokenAddress, closeType, pnlPercent, soldPercent, reason) {
  const pos = state.positions[tokenAddress];
  if (!pos) return false;
  pos.exitEvents.push({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type: closeType,
    pnlPercent,
    soldPercent,
    reason
  });
  if (soldPercent >= 100) {
    delete state.positions[tokenAddress];
  }
  return true;
}

// src/tools/projection.ts
function projectPoolInfoFull(p) {
  const { name: _n, socials: _s, websites: _w, priceNative: _pn, baseTokenPriceUsd: _bp, baseTokenId: _bt, ...rest } = p;
  return { ...rest, symbol: p.name.split(" / ")[0] ?? p.name, tokenAddress: p.baseTokenId ?? "" };
}
function projectPoolInfoCompact(p) {
  return {
    poolAddress: p.poolAddress,
    tokenAddress: p.baseTokenId ?? "",
    symbol: p.name.split(" / ")[0] ?? p.name,
    dexId: p.dexId,
    tags: p.tags,
    reserveInUsd: p.reserveInUsd,
    fdvUsd: p.fdvUsd,
    marketCapUsd: p.marketCapUsd,
    volume1hUsd: p.volume1hUsd,
    volume24hUsd: p.volume24hUsd,
    priceChange1h: p.priceChange1h,
    priceChange24h: p.priceChange24h,
    buys1h: p.buys1h,
    sells1h: p.sells1h,
    buySellRatio: p.buySellRatio,
    uniqueBuyers1h: p.uniqueBuyers1h,
    lockedLiquidityPercent: p.lockedLiquidityPercent,
    boostTotalAmount: p.boostTotalAmount,
    cto: p.cto,
    createdAt: p.createdAt
  };
}
function projectVerificationResult(r) {
  const { ohlcv: _dropped, ...momentumRest } = r.momentum;
  return { ...r, momentum: momentumRest };
}
function projectMarketState(s) {
  return {
    updatedAt: s.updatedAt,
    marketRegime: s.marketRegime,
    tonPriceUsd: s.tonPriceUsd,
    candidates: s.shortlist,
    topLists: {
      byVolume: s.topLists.byVolume.slice(0, 5),
      byLiquidity: s.topLists.byLiquidity.slice(0, 5),
      byFdv: s.topLists.byFdv.slice(0, 5),
      gainers1h: s.topLists.gainers1h.slice(0, 5),
      gainers24h: s.topLists.gainers24h.slice(0, 5),
      byTxCount: s.topLists.byTxCount.slice(0, 5)
    },
    pendingVerifications: s.pendingVerifications,
    openPositionReviews: s.openPositionReviews,
    cooldownTokens: s.cooldownTokens,
    apiUsage: s.apiUsage
  };
}
function projectOrganicity(o) {
  return {
    verdict: o.verdict,
    score: o.score,
    failedSignals: o.signals.filter((s) => !s.passed).map((s) => s.name)
  };
}

// src/tools/barriers.ts
function resolveBarriers(tokenAddress, customBarriers, config, riskPolicy) {
  const base = { ...riskPolicy.defaultBarriers };
  const perToken = config.tpSl?.perToken?.[tokenAddress];
  if (perToken) {
    if (perToken.takeProfitPercent != null) base.takeProfitPercent = perToken.takeProfitPercent;
    if (perToken.stopLossPercent != null) base.stopLossPercent = perToken.stopLossPercent;
    if (perToken.partialTakeProfitPercent != null && perToken.partialTakeProfitSellPercent != null) {
      base.partialTp = {
        triggerPercent: perToken.partialTakeProfitPercent,
        sellPercent: perToken.partialTakeProfitSellPercent
      };
    }
  }
  if (customBarriers) return { ...base, ...customBarriers };
  return base;
}

// src/verify/pipeline.ts
var VERIFY_CACHE_TTL_MS = 5 * 6e4;
var verifyCache = /* @__PURE__ */ new Map();
function getCachedVerifyData(tokenAddress) {
  const entry = verifyCache.get(tokenAddress);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > VERIFY_CACHE_TTL_MS) {
    verifyCache.delete(tokenAddress);
    return null;
  }
  return entry;
}
function cleanVerifyCache() {
  const now = Date.now();
  for (const [key, entry] of verifyCache) {
    if (now - entry.timestamp > VERIFY_CACHE_TTL_MS) {
      verifyCache.delete(key);
    }
  }
}
async function verifyCandidate(gecko, tokenAddress, poolAddress, dexId, poolCreatedAt) {
  const startTime = Date.now();
  let geckoCallsUsed = 0;
  const cached = getCachedVerifyData(tokenAddress);
  let tokenInfo;
  let poolInfo;
  if (cached) {
    tokenInfo = cached.tokenInfo;
    poolInfo = cached.poolInfo;
  } else {
    tokenInfo = await gecko.getTokenInfo(tokenAddress);
    geckoCallsUsed++;
    poolInfo = await gecko.getPoolInfo(poolAddress);
    geckoCallsUsed++;
    verifyCache.set(tokenAddress, {
      tokenInfo,
      poolInfo,
      timestamp: Date.now()
    });
  }
  const trades = await gecko.getPoolTrades(poolAddress);
  geckoCallsUsed++;
  const ohlcvResp = await gecko.getPoolOhlcv(poolAddress, "hour", 30);
  geckoCallsUsed++;
  const organicity = checkOrganicity(poolInfo, trades);
  const candles = ohlcvResp.candles;
  const buyPressureVal = poolInfo.transactions.h1.buys + poolInfo.transactions.h1.sells > 0 ? poolInfo.transactions.h1.buys / (poolInfo.transactions.h1.buys + poolInfo.transactions.h1.sells) : 0;
  const signals = computeSignals(null, poolInfo);
  const confidence = buildConfidence(tokenInfo, poolInfo, signals, organicity);
  const safetyReasons = [];
  let safetyVerdict = "pass";
  if (tokenInfo.isHoneypot === "yes") {
    safetyVerdict = "reject";
    safetyReasons.push("Confirmed honeypot");
  }
  if (tokenInfo.mintAuthority != null) {
    safetyVerdict = "reject";
    safetyReasons.push("Mint authority exists");
  }
  if (tokenInfo.freezeAuthority != null) {
    safetyVerdict = "reject";
    safetyReasons.push("Freeze authority exists");
  }
  if (organicity.verdict === "wash") {
    safetyVerdict = "reject";
    safetyReasons.push("Wash trading confirmed");
  }
  if (poolInfo.reserveInUsd < 500) {
    safetyVerdict = "reject";
    safetyReasons.push(`Liquidity too low: $${poolInfo.reserveInUsd.toFixed(0)}`);
  }
  if (safetyVerdict === "pass") {
    if (tokenInfo.isHoneypot === "unknown") {
      safetyVerdict = "warning";
      safetyReasons.push("Honeypot status unknown");
    }
    if (organicity.verdict === "suspicious") {
      safetyVerdict = "warning";
      safetyReasons.push("Suspicious trading activity");
    }
  }
  let priceImpactEstimate = "low";
  if (poolInfo.reserveInUsd < 5e3) priceImpactEstimate = "high";
  else if (poolInfo.reserveInUsd < 2e4) priceImpactEstimate = "medium";
  let poolAge = "";
  if (poolCreatedAt) {
    const ageMs = Date.now() - new Date(poolCreatedAt).getTime();
    const hours = Math.floor(ageMs / 36e5);
    const days = Math.floor(hours / 24);
    poolAge = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
  }
  return {
    safety: {
      verdict: safetyVerdict,
      reasons: safetyReasons,
      isHoneypot: tokenInfo.isHoneypot,
      mintAuthority: tokenInfo.mintAuthority != null,
      freezeAuthority: tokenInfo.freezeAuthority != null,
      gtScore: tokenInfo.gtScore
    },
    organicity,
    momentum: {
      buyPressure: buyPressureVal,
      volumeRatio1h: computeVolumeRatio(candles, 1),
      volumeRatio5h: computeVolumeRatio(candles, 5),
      priceChange1h: computePriceChange(candles, 1),
      priceChange5h: computePriceChange(candles, 5),
      avgCandleRange1h: computeAvgCandleRange(candles, 1),
      avgCandleRange5h: computeAvgCandleRange(candles, 5),
      ohlcv: candles
    },
    execution: {
      reserveInUsd: poolInfo.reserveInUsd,
      lockedLiquidityPercent: poolInfo.lockedLiquidityPercentage,
      priceImpactEstimate
    },
    computedSignals: signals,
    confidence,
    meta: {
      poolAddress,
      tokenAddress,
      dexId,
      poolAge,
      geckoCallsUsed,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }
  };
}
function computeVolumeRatio(candles, recentCount) {
  if (candles.length < recentCount + 1) return 1;
  const recent = candles.slice(-recentCount);
  const earlier = candles.slice(0, -recentCount);
  if (earlier.length === 0) return 1;
  const recentAvg = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const earlierAvg = earlier.reduce((s, c) => s + c.volume, 0) / earlier.length;
  if (earlierAvg < 1) return 1;
  return Math.round(recentAvg / earlierAvg * 100) / 100;
}
function computePriceChange(candles, count) {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-count);
  const first = slice[0].close;
  const last = slice[slice.length - 1].close;
  if (first === 0) return 0;
  return Math.round((last - first) / first * 1e4) / 100;
}
function computeAvgCandleRange(candles, count) {
  const slice = candles.slice(-count);
  if (slice.length === 0) return 0;
  const ranges = slice.map((c) => c.close > 0 ? (c.high - c.low) / c.close * 100 : 0);
  return Math.round(ranges.reduce((s, r) => s + r, 0) / ranges.length * 100) / 100;
}

// src/safety/gate.ts
function checkSafety(ctx) {
  const rejects = [];
  const penalties = [];
  if (ctx.tokenInfo?.isHoneypot === "yes") {
    rejects.push({ id: "HONEYPOT", reason: "Token is confirmed honeypot \u2014 cannot sell" });
  }
  if (ctx.tokenInfo?.mintAuthority != null) {
    rejects.push({ id: "MINT_AUTHORITY", reason: `Owner can mint tokens (authority: ${ctx.tokenInfo.mintAuthority})` });
  }
  if (ctx.tokenInfo?.freezeAuthority != null) {
    rejects.push({ id: "FREEZE_AUTHORITY", reason: `Owner can freeze tokens (authority: ${ctx.tokenInfo.freezeAuthority})` });
  }
  const hasPosition = ctx.portfolio.tokens.some(
    (t) => t.address === ctx.tokenAddress && Number(t.quantity) > 0
  );
  if (hasPosition) {
    rejects.push({ id: "DUPLICATE_POSITION", reason: "Token already in portfolio" });
  }
  const openPositions = ctx.portfolio.tokens.filter((t) => Number(t.quantity) > 0).length;
  if (openPositions >= ctx.riskPolicy.maxOpenPositions) {
    rejects.push({ id: "POSITION_CAP", reason: `Open positions (${openPositions}) >= max (${ctx.riskPolicy.maxOpenPositions})` });
  }
  if (!ctx.isTradeable) {
    rejects.push({ id: "NOT_TRADEABLE", reason: "Token not available on TractionEye" });
  }
  if (ctx.poolInfo != null && ctx.poolInfo.reserveInUsd < 500) {
    rejects.push({ id: "ZERO_LIQUIDITY", reason: `Pool liquidity too low: $${ctx.poolInfo.reserveInUsd.toFixed(0)}` });
  }
  if (ctx.organicity?.verdict === "wash") {
    rejects.push({ id: "WASH_CONFIRMED", reason: "Volume is fake (wash trading confirmed)" });
  }
  const cooldownEntry = ctx.cooldownMap.get(ctx.tokenAddress);
  if (cooldownEntry) {
    const exitTime = new Date(cooldownEntry.exitTimestamp).getTime();
    const cooldownMs = ctx.riskPolicy.cooldownAfterExitMinutes * 6e4;
    if (Date.now() - exitTime < cooldownMs) {
      const cooldownUntil = new Date(exitTime + cooldownMs).toISOString();
      rejects.push({ id: "COOLDOWN", reason: `Token in cooldown until ${cooldownUntil} (exited by ${cooldownEntry.closeType})` });
    }
  }
  if (ctx.tokenInfo?.holders != null) {
    const top10 = ctx.tokenInfo.holders.distributionPercentage.top10;
    if (top10 > ctx.riskPolicy.maxTop10HoldersPercent) {
      penalties.push({ id: "HIGH_CONCENTRATION", multiplier: 0.5, reason: `Top 10 holders own ${top10.toFixed(1)}%` });
    }
  }
  if (ctx.tokenInfo?.holders != null && ctx.tokenInfo.holders.count < ctx.riskPolicy.minHoldersCount) {
    penalties.push({ id: "LOW_HOLDERS", multiplier: 0.7, reason: `Only ${ctx.tokenInfo.holders.count} holders` });
  }
  if (ctx.poolInfo?.lockedLiquidityPercentage != null && ctx.poolInfo.lockedLiquidityPercentage > 0) {
    if (ctx.poolInfo.lockedLiquidityPercentage < 30) {
      penalties.push({ id: "LOW_LOCKED_LIQUIDITY", multiplier: 0.6, reason: `Locked liquidity ${ctx.poolInfo.lockedLiquidityPercentage.toFixed(1)}% < 30%` });
    }
  }
  if (ctx.poolAge !== null && ctx.poolAge < 30) {
    penalties.push({ id: "TOO_FRESH", multiplier: 0.5, reason: `Pool is only ${ctx.poolAge} minutes old` });
  }
  if (ctx.cto) {
    penalties.push({ id: "CTO_TOKEN", multiplier: 0.8, reason: "Community takeover token" });
  }
  if (ctx.tokenInfo?.isHoneypot === "unknown") {
    penalties.push({ id: "HONEYPOT_UNKNOWN", multiplier: 0.9, reason: "Cannot confirm token is safe (honeypot status unknown)" });
  }
  if (ctx.organicity?.verdict === "suspicious") {
    penalties.push({ id: "SUSPICIOUS_ORGANICITY", multiplier: 0.5, reason: "Suspicious trading activity detected" });
  }
  const finalMultiplier = penalties.reduce((mult, p) => mult * p.multiplier, 1);
  let verdict;
  if (rejects.length > 0) {
    verdict = "reject";
  } else if (penalties.length > 0) {
    verdict = "warning";
  } else {
    verdict = "pass";
  }
  return { verdict, rejects, penalties, finalMultiplier };
}

// src/types/v2.ts
var DEFAULT_RISK_POLICY = {
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
    partialTp: { triggerPercent: 15, sellPercent: 30 }
  },
  version: 1,
  updatedAt: (/* @__PURE__ */ new Date()).toISOString()
};

// src/state/cooldown.ts
import { readFileSync as readFileSync3 } from "fs";
var COOLDOWN_TRIGGERS = /* @__PURE__ */ new Set([
  "stop_loss",
  "thesis_exit",
  "safety_degradation"
]);
var CooldownManager = class {
  constructor() {
    this.entries = /* @__PURE__ */ new Map();
    this.loadFromDisk();
  }
  /** Load cooldown state from disk. Filters out expired entries. */
  loadFromDisk() {
    try {
      const raw = readFileSync3(cooldownPath(), "utf-8");
      const state = JSON.parse(raw);
      this.entries = new Map(Object.entries(state.entries));
    } catch {
      this.entries = /* @__PURE__ */ new Map();
    }
  }
  /** Save current state to disk atomically. */
  saveToDisk() {
    const state = {
      entries: Object.fromEntries(this.entries)
    };
    atomicWriteJsonSync(cooldownPath(), state);
  }
  /**
   * Record a position close. Adds cooldown entry if close type triggers cooldown.
   */
  recordClose(tokenAddress, closeType) {
    if (!COOLDOWN_TRIGGERS.has(closeType)) return;
    this.entries.set(tokenAddress, {
      tokenAddress,
      exitTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
      closeType
    });
    this.saveToDisk();
  }
  /**
   * Unconditionally add a cooldown entry for a token. Use for explicit exits
   * (e.g. manual sells) that must always trigger cooldown regardless of close type.
   */
  addEntry(tokenAddress, closeType) {
    this.entries.set(tokenAddress, {
      tokenAddress,
      exitTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
      closeType
    });
    this.saveToDisk();
  }
  /**
   * Check if a token is in cooldown.
   * @param tokenAddress - Token to check
   * @param cooldownMinutes - Cooldown duration in minutes
   * @returns true if token is in cooldown
   */
  isInCooldown(tokenAddress, cooldownMinutes) {
    const entry = this.entries.get(tokenAddress);
    if (!entry) return false;
    const exitTime = new Date(entry.exitTimestamp).getTime();
    const cooldownMs = cooldownMinutes * 6e4;
    return Date.now() - exitTime < cooldownMs;
  }
  /** Get cooldown entry for a token (or undefined). */
  getEntry(tokenAddress) {
    return this.entries.get(tokenAddress);
  }
  /** Get all active cooldown entries as a Map. */
  getMap() {
    return new Map(this.entries);
  }
  /** Get all active entries with remaining time info. */
  getActiveCooldowns(cooldownMinutes) {
    const result = [];
    const cooldownMs = cooldownMinutes * 6e4;
    for (const [, entry] of this.entries) {
      const exitTime = new Date(entry.exitTimestamp).getTime();
      if (Date.now() - exitTime < cooldownMs) {
        result.push({
          tokenAddress: entry.tokenAddress,
          cooldownUntil: new Date(exitTime + cooldownMs).toISOString(),
          closeType: entry.closeType
        });
      }
    }
    return result;
  }
  /** Remove expired entries. Called during daily cleanup. */
  cleanupExpired(cooldownMinutes) {
    const cooldownMs = cooldownMinutes * 6e4;
    let removed = 0;
    for (const [addr, entry] of this.entries) {
      const exitTime = new Date(entry.exitTimestamp).getTime();
      if (Date.now() - exitTime >= cooldownMs) {
        this.entries.delete(addr);
        removed++;
      }
    }
    if (removed > 0) this.saveToDisk();
    return removed;
  }
};

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
      description: "Market briefing: candidates, regime, TON price, top-lists, cooldowns, API usage. Call FIRST each tick.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        touchSessionLock();
        const state = readMarketState();
        if (state) return projectMarketState(state);
        const briefing = readBriefing();
        if (!briefing) return { error: "No market state found. Is the daemon running?" };
        return briefing;
      }
    },
    // ── 2. verify_candidate (replaces analyze_pool) ──────────────────────
    {
      name: "tractioneye_verify_candidate",
      description: "Full 4-call GeckoTerminal verification: safety, organicity, momentum, confidence. Call AFTER read_briefing, BEFORE buy_token. Uses 2-4 gecko calls.",
      parameters: {
        type: "object",
        properties: {
          tokenAddress: { type: "string", description: "Token contract address" },
          poolAddress: { type: "string", description: "Pool address to verify" },
          dexId: { type: "string", description: "DEX identifier (stonfi, dedust)" },
          poolCreatedAt: { type: "string", description: "Pool creation timestamp (ISO)" }
        },
        required: ["tokenAddress", "poolAddress"],
        additionalProperties: false
      },
      handler: async (args) => {
        touchSessionLock();
        const tokenAddress = args["tokenAddress"];
        const poolAddress = args["poolAddress"];
        const dexId = args["dexId"] ?? "";
        const poolCreatedAt = args["poolCreatedAt"];
        const result = await verifyCandidate(
          client.gecko,
          tokenAddress,
          poolAddress,
          dexId,
          poolCreatedAt
        );
        return projectVerificationResult(result);
      }
    },
    // ── 3. buy_token (v2: safety gate + cooldown + penalty + barriers) ──
    {
      name: "tractioneye_buy_token",
      description: "Buy token: cooldown check \u2192 safety gate \u2192 penalty application \u2192 execute \u2192 register barriers atomically. Call AFTER verify_candidate.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Token symbol (e.g. NOT). Either symbol or tokenAddress required." },
          tokenAddress: { type: "string", description: "Token contract address. Either symbol or tokenAddress required." },
          poolAddress: { type: "string", description: "Pool address from screening output (required for position tracking)." },
          amountNano: { type: "string", description: "Amount to spend in nanoTON (1 TON = 1,000,000,000 nanoTON; e.g. 5 TON = 5000000000)" },
          slippageTolerance: { type: "number", description: "Slippage tolerance (default: 0.01 = 1%)" },
          archetype: { type: "string", description: "Candidate archetype (e.g. organic_breakout)" },
          entryReason: { type: "string", description: "Why you are buying (for reflection)" },
          barriers: {
            type: "object",
            description: "Custom barrier config. Overrides ALL per-token config if provided. Omit to use risk policy defaults + per-token overrides.",
            properties: {
              stopLossPercent: { type: "number" },
              takeProfitPercent: { type: "number" },
              timeLimitSeconds: { type: ["number", "null"] },
              trailingStop: {
                type: ["object", "null"],
                properties: {
                  activationPercent: { type: "number" },
                  deltaPercent: { type: "number" }
                }
              },
              partialTp: {
                type: "object",
                properties: {
                  triggerPercent: { type: "number" },
                  sellPercent: { type: "number" }
                }
              }
            }
          }
        },
        required: ["amountNano", "poolAddress"],
        additionalProperties: false
      },
      handler: async (args) => {
        let tokenAddress = args["tokenAddress"];
        const symbol = args["symbol"];
        const amountNanoRaw = args["amountNano"];
        if (!amountNanoRaw || typeof amountNanoRaw !== "string") {
          return { error: 'amountNano required \u2014 provide nanoTON string (e.g. "5000000000" for 5 TON)' };
        }
        let amountNano = amountNanoRaw;
        const slippage = args["slippageTolerance"];
        const poolAddress = args["poolAddress"];
        const archetype = args["archetype"] ?? "unknown";
        const entryReason = args["entryReason"] ?? "";
        const customBarriers = args["barriers"];
        if (!tokenAddress && symbol) {
          const token = await client.findToken(symbol);
          if (!token) return { error: `Token not found: ${symbol}` };
          tokenAddress = token.address;
        }
        if (!tokenAddress) return { error: "Provide either symbol or tokenAddress" };
        const config = readConfig();
        const riskPolicy = config.riskPolicy ?? DEFAULT_RISK_POLICY;
        const cooldownMgr = new CooldownManager();
        if (cooldownMgr.isInCooldown(tokenAddress, riskPolicy.cooldownAfterExitMinutes)) {
          const entry = cooldownMgr.getEntry(tokenAddress);
          const exitTime = new Date(entry.exitTimestamp).getTime();
          const cooldownUntil = new Date(exitTime + riskPolicy.cooldownAfterExitMinutes * 6e4).toISOString();
          return {
            status: "rejected",
            reason: `Token in cooldown until ${cooldownUntil} (exited by ${entry.closeType})`
          };
        }
        const isTradeable = await client.findTokenByAddress(tokenAddress) != null;
        const portfolio = await client.getPortfolio();
        const cached = getCachedVerifyData(tokenAddress);
        const tokenInfo = cached?.tokenInfo ?? null;
        const poolInfo = cached?.poolInfo ?? null;
        let poolAge = null;
        if (poolInfo?.poolCreatedAt) {
          poolAge = Math.floor((Date.now() - new Date(poolInfo.poolCreatedAt).getTime()) / 6e4);
        }
        const safetyResult = checkSafety({
          tokenInfo,
          poolInfo,
          organicity: null,
          // Already checked during verify_candidate
          portfolio,
          riskPolicy,
          cooldownMap: cooldownMgr.getMap(),
          tokenAddress,
          isTradeable,
          poolAge,
          cto: false
        });
        if (safetyResult.verdict === "reject") {
          return {
            status: "rejected",
            reason: safetyResult.rejects.map((r) => `${r.id}: ${r.reason}`).join("; "),
            safetyResult
          };
        }
        const originalAmountNano = amountNano;
        if (safetyResult.finalMultiplier < 1) {
          const adjusted = BigInt(Math.floor(Number(BigInt(amountNano)) * safetyResult.finalMultiplier));
          amountNano = adjusted.toString();
        }
        const preview = await client.previewTrade({ action: "BUY", tokenAddress, amountNano });
        if (preview.validationOutcome === "rejected") {
          return { status: "rejected", reason: "Validation rejected", preview };
        }
        if (preview.priceImpactPercent > riskPolicy.maxPriceImpactPercent) {
          return { status: "rejected", reason: `High price impact: ${preview.priceImpactPercent}%`, preview };
        }
        const execution = await client.executeTrade({
          action: "BUY",
          tokenAddress,
          amountNano,
          slippageTolerance: slippage
        });
        const result = await pollOperationStatus(client, execution.operationId);
        const barriers = resolveBarriers(tokenAddress, customBarriers, config, riskPolicy);
        if (result.status !== "failed") {
          const effectivePoolAddress = poolInfo?.poolAddress ?? poolAddress ?? "";
          const effectiveSymbol = tokenInfo?.symbol ?? symbol ?? "";
          const entryPriceUsd = parseFloat(poolInfo?.baseTokenPriceUsd ?? "0") || 0;
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const thesis = {
            tokenAddress,
            poolAddress: effectivePoolAddress,
            symbol: effectiveSymbol,
            dexId: "",
            entryPriceUsd,
            entryTimestamp: now,
            amountNano,
            entrySizePercent: 0,
            archetype,
            entryReason,
            thesisMetrics: {
              entryBuyerDiversity1h: poolInfo?.transactions.h1.buyers ?? 0,
              entryVolume1h: poolInfo?.volume.h1 ?? 0,
              entryMomentum: "unknown"
            },
            currentPriceUsd: null,
            unrealizedPnlPercent: null,
            peakPnlPercent: 0,
            thesisStatus: "intact",
            lastReviewedAt: now,
            barriers,
            trailingStopActivated: false,
            partialTpTriggered: false,
            exitEvents: []
          };
          try {
            const portfolioState = readPortfolioState();
            addPosition(portfolioState, thesis);
            writePortfolioState(portfolioState);
          } catch {
          }
        }
        const response = {
          status: result.status,
          operationId: result.operationId,
          preview,
          result,
          barriers,
          archetype,
          entryReason
        };
        if (safetyResult.penalties.length > 0) {
          response.penaltyBreakdown = {
            originalAmountNano,
            adjustedAmountNano: amountNano,
            penalties: safetyResult.penalties,
            finalMultiplier: safetyResult.finalMultiplier
          };
        }
        return response;
      }
    },
    // ── 4. sell_token ───────────────────────────────────────────────────
    {
      name: "tractioneye_sell_token",
      description: 'Sell token (full or partial). Use "all" for amountNano to exit entire position.',
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
        if (result.status === "confirmed") {
          const cooldownMgr = new CooldownManager();
          cooldownMgr.addEntry(tokenAddress, "manual");
        }
        return { status: result.status, operationId: result.operationId, preview, result };
      }
    },
    // ── 5. set_tp_sl (v2: supports full TripleBarrierConfig) ─────────────
    {
      name: "tractioneye_set_tp_sl",
      description: "Modify barriers on open positions or set defaults. Barriers are set atomically at buy time via buy_token.",
      parameters: {
        type: "object",
        properties: {
          tokenAddress: { type: "string", description: "Token address. Omit to set defaults." },
          takeProfitPercent: { type: "number", description: "Take profit threshold (e.g. 25 = +25%)" },
          stopLossPercent: { type: "number", description: "Stop loss threshold (e.g. 8 = -8%)" },
          partialTakeProfitPercent: { type: "number", description: "Partial TP trigger (e.g. 15 = +15%)" },
          partialTakeProfitSellPercent: { type: "number", description: "Sell this % of position at partial TP (e.g. 50)" },
          timeLimitSeconds: { type: ["number", "null"], description: "Max hold time in seconds (null = no limit)" },
          trailingStopActivationPercent: { type: "number", description: "Trailing stop activates at +X% PnL" },
          trailingStopDeltaPercent: { type: "number", description: "Trailing stop follows X% below peak" }
        },
        additionalProperties: false
      },
      handler: async (args) => {
        ensureDataDir();
        const hasPartialTrigger = args["partialTakeProfitPercent"] != null;
        const hasPartialSell = args["partialTakeProfitSellPercent"] != null;
        if (hasPartialTrigger !== hasPartialSell) {
          return {
            error: "partialTakeProfitPercent and partialTakeProfitSellPercent must be provided together"
          };
        }
        const config = readConfig();
        if (!config.tpSl) {
          config.tpSl = { defaults: { takeProfitPercent: 25, stopLossPercent: 8 } };
        }
        const patch = {};
        if (args["takeProfitPercent"] != null) patch.takeProfitPercent = args["takeProfitPercent"];
        if (args["stopLossPercent"] != null) patch.stopLossPercent = args["stopLossPercent"];
        if (args["partialTakeProfitPercent"] != null) patch.partialTakeProfitPercent = args["partialTakeProfitPercent"];
        if (args["partialTakeProfitSellPercent"] != null) patch.partialTakeProfitSellPercent = args["partialTakeProfitSellPercent"];
        if (args["timeLimitSeconds"] !== void 0) patch.timeLimitSeconds = args["timeLimitSeconds"];
        if (args["trailingStopActivationPercent"] != null || args["trailingStopDeltaPercent"] != null) {
          patch.trailingStop = {
            activationPercent: args["trailingStopActivationPercent"] ?? 15,
            deltaPercent: args["trailingStopDeltaPercent"] ?? 5
          };
        }
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
      description: "Update daemon screening criteria (liquidity, volume, price changes, transactions). Writes to config.json.",
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
      description: "Strategy performance (PnL, win rate, balance, drawdown) and current portfolio positions.",
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
      description: "Screen TON pools by criteria (liquidity, volume, price changes, transactions, buy/sell ratio, unique buyers). Ad-hoc discovery beyond daemon briefing.",
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
        const pools = await client.screenTokens({
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
        return pools.map(projectPoolInfoFull);
      }
    },
    // ── 9. find ─────────────────────────────────────────────────────────
    {
      name: "tractioneye_find",
      description: "Find token by symbol or search pools by keyword. Returns token address and matching pools.",
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
        return { token, pools: pools.map(projectPoolInfoCompact) };
      }
    },
    // ── 10. get_token_price ─────────────────────────────────────────────
    {
      name: "tractioneye_get_token_price",
      description: "Current USD price for a token by contract address.",
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
      description: "List tokens available for trading in this strategy.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => client.getAvailableTokens()
    },
    // ── 12. get_simulation_results ──────────────────────────────────────
    {
      name: "tractioneye_get_simulation_results",
      description: "Dry-run simulation results: win rate, avg PnL, recommended parameters. Only available in simulation mode.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => client.getSimulationResults()
    },
    // ── 13. review_position (v2) ───────────────────────────────────────
    {
      name: "tractioneye_review_position",
      description: "Fresh thesis check for an open position: organicity, signals, trade flow. Uses 2 gecko calls.",
      parameters: {
        type: "object",
        properties: {
          tokenAddress: { type: "string", description: "Token address of the open position" },
          poolAddress: { type: "string", description: "Pool address for the position" }
        },
        required: ["tokenAddress", "poolAddress"],
        additionalProperties: false
      },
      handler: async (args) => {
        touchSessionLock();
        const tokenAddress = args["tokenAddress"];
        const poolAddress = args["poolAddress"];
        const poolInfo = await client.gecko.getPoolInfo(poolAddress);
        const trades = await client.gecko.getPoolTrades(poolAddress);
        const priceInfo = await client.dex.getTokenPrice(tokenAddress);
        const organicity = (await import("./organicity-VCEPAEHP.js")).checkOrganicity(poolInfo, trades);
        const signals = (await import("./signals-EGCUUCQQ.js")).computeSignals(null, poolInfo);
        return {
          currentPrice: priceInfo.priceUsd,
          poolInfo: {
            reserveInUsd: poolInfo.reserveInUsd,
            volume1h: poolInfo.volume.h1,
            buyers1h: poolInfo.transactions.h1.buyers,
            sellers1h: poolInfo.transactions.h1.sellers
          },
          organicity: projectOrganicity(organicity),
          signals,
          tradeFlow: {
            recentTrades: trades.length,
            buyCount: trades.filter((t) => t.kind === "buy").length,
            sellCount: trades.filter((t) => t.kind === "sell").length
          }
        };
      }
    },
    // ── 14. record_reflection (v2) ─────────────────────────────────────
    {
      name: "tractioneye_record_reflection",
      description: "Append reflection to log. Types: trade_closed, thesis_review, session_summary, lesson_learned.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["trade_closed", "thesis_review", "session_summary", "lesson_learned"],
            description: "Type of reflection entry"
          },
          trade: {
            type: "object",
            description: "Trade reflection (for trade_closed type)",
            properties: {
              tokenAddress: { type: "string" },
              symbol: { type: "string" },
              archetype: { type: "string" },
              pnlPercent: { type: "number" },
              holdDuration: { type: "string" },
              exitReason: { type: "string" },
              whatWorked: { type: "string" },
              whatFailed: { type: "string" },
              lessonForPlaybook: { type: "string" }
            }
          },
          session: {
            type: "object",
            description: "Session summary (for session_summary type)",
            properties: {
              candidatesReviewed: { type: "number" },
              tradesExecuted: { type: "number" },
              marketRegime: { type: "string" },
              keyObservation: { type: "string" }
            }
          },
          lesson: {
            type: "object",
            description: "Lesson learned (for lesson_learned type)",
            properties: {
              rule: { type: "string" },
              evidence: { type: "string" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              affectsPlaybook: { type: ["string", "null"] }
            }
          }
        },
        required: ["type"],
        additionalProperties: false
      },
      handler: async (args) => {
        const { appendFileSync: appendFileSync2, mkdirSync } = await import("fs");
        const { reflectionLogPath: reflectionLogPath2, ensureStateDir: ensureStateDir2 } = await import("./config-TJYP3CSG.js");
        ensureStateDir2();
        const entry = {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          type: args["type"],
          ...args["trade"] ? { trade: args["trade"] } : {},
          ...args["session"] ? { session: args["session"] } : {},
          ...args["lesson"] ? { lesson: args["lesson"] } : {}
        };
        appendFileSync2(reflectionLogPath2(), JSON.stringify(entry) + "\n", "utf-8");
        return { success: true, entry };
      }
    },
    // ── 15. read_risk_policy (v2) ──────────────────────────────────────
    {
      name: "tractioneye_read_risk_policy",
      description: "Read-only risk caps and limits: max positions, exposure, price impact, cooldown, default barriers.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        const config = readConfig();
        return config.riskPolicy ?? DEFAULT_RISK_POLICY;
      }
    },
    // ── 16. read_api_budget (v2) ────────────────────────────────────────
    {
      name: "tractioneye_read_api_budget",
      description: "Current API quota state: gecko and dexscreener usage vs limits.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        return {
          gecko: {
            name: "GeckoTerminal",
            currentLimit: "5 req/60s",
            note: "verify_candidate uses 2-4 calls, review_position uses 2 calls"
          },
          dex: {
            name: "DexScreener",
            currentLimit: "10 req/60s",
            note: "getTokenPricesBatch handles up to 30 tokens in 1 request"
          }
        };
      }
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

// src/position/barrier.ts
var DEFAULT_INTERVAL_MS2 = 3e4;
var BarrierManager = class {
  constructor(dex, executeTradeCallback, onEvent, intervalMs = DEFAULT_INTERVAL_MS2) {
    this.dex = dex;
    this.executeTradeCallback = executeTradeCallback;
    this.onEvent = onEvent;
    this.intervalMs = intervalMs;
    this.positions = /* @__PURE__ */ new Map();
    this.timer = null;
    this.running = false;
  }
  /** Register a position with barriers. */
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
  /** Get a single position. */
  getPosition(tokenAddress) {
    return this.positions.get(tokenAddress);
  }
  /** Update barriers for an existing position. */
  updateBarriers(tokenAddress, barriers) {
    const pos = this.positions.get(tokenAddress);
    if (!pos) return false;
    pos.barriers = barriers;
    return true;
  }
  /** Start the barrier evaluation loop. */
  start() {
    if (this.running) return;
    this.running = true;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }
  /** Stop the barrier evaluation loop. */
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
  /** Single evaluation tick: fetch batch prices & check all barriers. */
  async tick() {
    if (this.positions.size === 0) return;
    const addresses = Array.from(this.positions.keys());
    let priceMap;
    try {
      priceMap = await this.dex.getTokenPricesBatch(addresses);
    } catch {
      return;
    }
    for (const [addr, pos] of this.positions) {
      const priceInfo = priceMap.get(addr);
      if (!priceInfo?.priceUsd) continue;
      const currentPrice = priceInfo.priceUsd;
      const pnlPercent = (currentPrice - pos.entryPriceUsd) / pos.entryPriceUsd * 100;
      if (pnlPercent > pos.peakPnlPercent) {
        pos.peakPnlPercent = pnlPercent;
      }
      const event = this.evaluateBarriers(pos, currentPrice, pnlPercent);
      if (event) {
        this.onEvent?.(event);
        try {
          await this.executeTradeCallback(addr, "SELL", event.sellPercent);
        } catch {
          continue;
        }
        if (event.sellPercent >= 100) {
          this.positions.delete(addr);
        }
      }
    }
  }
  /**
   * Evaluate all barriers for a position.
   * Returns the first barrier that fires, or null if none.
   * Priority: stop_loss > trailing_stop > time_limit > take_profit > partial_tp
   */
  evaluateBarriers(pos, currentPrice, pnlPercent) {
    const b = pos.barriers;
    const base = {
      tokenAddress: pos.tokenAddress,
      symbol: pos.symbol,
      entryPriceUsd: pos.entryPriceUsd,
      currentPriceUsd: currentPrice,
      pnlPercent
    };
    if (pnlPercent <= -b.stopLossPercent) {
      return {
        ...base,
        closeType: "stop_loss",
        sellPercent: 100,
        reason: `PnL ${pnlPercent.toFixed(1)}% hit stop loss at -${b.stopLossPercent}%`
      };
    }
    if (b.trailingStop) {
      if (!pos.trailingStopActivated && pnlPercent >= b.trailingStop.activationPercent) {
        pos.trailingStopActivated = true;
      }
      if (pos.trailingStopActivated) {
        const trailingStopLevel = pos.peakPnlPercent - b.trailingStop.deltaPercent;
        if (pnlPercent <= trailingStopLevel && trailingStopLevel > 0) {
          return {
            ...base,
            closeType: "trailing_stop",
            sellPercent: 100,
            reason: `Trailing stop: peak ${pos.peakPnlPercent.toFixed(1)}%, stop at ${trailingStopLevel.toFixed(1)}%, current ${pnlPercent.toFixed(1)}%`
          };
        }
      }
    }
    if (b.timeLimitSeconds != null) {
      const holdMs = Date.now() - new Date(pos.entryTimestamp).getTime();
      if (holdMs >= b.timeLimitSeconds * 1e3) {
        return {
          ...base,
          closeType: "time_limit",
          sellPercent: 100,
          reason: `Position held for ${Math.round(holdMs / 6e4)} minutes, time limit is ${Math.round(b.timeLimitSeconds / 60)} minutes`
        };
      }
    }
    if (pnlPercent >= b.takeProfitPercent) {
      return {
        ...base,
        closeType: "take_profit",
        sellPercent: 100,
        reason: `PnL ${pnlPercent.toFixed(1)}% hit take profit at +${b.takeProfitPercent}%`
      };
    }
    if (b.partialTp && !pos.partialTpTriggered && pnlPercent >= b.partialTp.triggerPercent) {
      pos.partialTpTriggered = true;
      return {
        ...base,
        closeType: "partial_tp",
        sellPercent: b.partialTp.sellPercent,
        reason: `Partial TP: PnL ${pnlPercent.toFixed(1)}% hit trigger at +${b.partialTp.triggerPercent}%, selling ${b.partialTp.sellPercent}%`
      };
    }
    return null;
  }
};

// src/quota/manager.ts
var DEFAULT_GECKO_RPM = 5;
var DEFAULT_DEX_RPM = 10;
var WINDOW_MS = 6e4;
var DEFAULT_ALLOCATION = {
  gecko: { critical: 0.6, verify: 0.2, scout: 0, background: 0.2 },
  dex: { critical: 0.3, verify: 0, scout: 0.4, background: 0.3 }
};
var QuotaManager = class {
  constructor(geckoRpm = DEFAULT_GECKO_RPM, dexRpm = DEFAULT_DEX_RPM) {
    this.agentLastActive = 0;
    this.gecko = this.createTracker(geckoRpm, DEFAULT_ALLOCATION.gecko);
    this.dex = this.createTracker(dexRpm, DEFAULT_ALLOCATION.dex);
  }
  createTracker(limit, allocation) {
    return {
      used: 0,
      limit,
      windowStartMs: Date.now(),
      windowMs: WINDOW_MS,
      allocation,
      perQueue: { critical: 0, verify: 0, scout: 0, background: 0 },
      overageCount: 0
    };
  }
  /** Configure budget allocation for an API. */
  configure(allocation) {
    if (allocation.gecko) {
      this.gecko.allocation = { ...this.gecko.allocation, ...allocation.gecko };
    }
    if (allocation.dex) {
      this.dex.allocation = { ...this.dex.allocation, ...allocation.dex };
    }
  }
  /**
   * Acquire a slot for an API request.
   * Returns immediately if budget available, waits if not.
   */
  async acquire(api, queue) {
    const tracker = api === "gecko" ? this.gecko : this.dex;
    this.maybeResetWindow(tracker);
    const queueBudget = Math.floor(tracker.limit * tracker.allocation[queue]);
    if (tracker.perQueue[queue] >= queueBudget && queueBudget > 0) {
      const waitMs = tracker.windowStartMs + tracker.windowMs - Date.now();
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
        this.maybeResetWindow(tracker);
      }
    }
    if (tracker.used >= tracker.limit) {
      const waitMs = tracker.windowStartMs + tracker.windowMs - Date.now();
      if (waitMs > 0) {
        await new Promise((r) => setTimeout(r, waitMs));
        this.maybeResetWindow(tracker);
      }
    }
    tracker.used++;
    tracker.perQueue[queue]++;
  }
  /** Record that a request was made (for external tracking). */
  record(api, queue) {
    const tracker = api === "gecko" ? this.gecko : this.dex;
    this.maybeResetWindow(tracker);
    tracker.used++;
    tracker.perQueue[queue]++;
  }
  /** Report a 429 overage. Feedback from on429 callbacks. */
  reportOverage(api) {
    const tracker = api === "gecko" ? this.gecko : this.dex;
    tracker.overageCount++;
    console.warn(`[quota] 429 reported for ${api} (total overages: ${tracker.overageCount})`);
  }
  /** Get current budget state. */
  getState() {
    this.maybeResetWindow(this.gecko);
    this.maybeResetWindow(this.dex);
    return {
      gecko: {
        used: this.gecko.used,
        limit: this.gecko.limit,
        free: Math.max(0, this.gecko.limit - this.gecko.used),
        windowResetAt: new Date(this.gecko.windowStartMs + this.gecko.windowMs).toISOString(),
        perQueue: { ...this.gecko.perQueue }
      },
      dex: {
        used: this.dex.used,
        limit: this.dex.limit,
        free: Math.max(0, this.dex.limit - this.dex.used),
        windowResetAt: new Date(this.dex.windowStartMs + this.dex.windowMs).toISOString(),
        perQueue: { ...this.dex.perQueue }
      }
    };
  }
  /** Mark agent as active (replaces session lock check). */
  touchAgentActive() {
    this.agentLastActive = Date.now();
  }
  /** Check if agent is active (within last 5 minutes). */
  isAgentActive(timeoutMs = 5 * 6e4) {
    return Date.now() - this.agentLastActive < timeoutMs;
  }
  maybeResetWindow(tracker) {
    const now = Date.now();
    if (now - tracker.windowStartMs >= tracker.windowMs) {
      tracker.used = 0;
      tracker.perQueue = { critical: 0, verify: 0, scout: 0, background: 0 };
      tracker.windowStartMs = now;
    }
  }
};

// src/state/candidates.ts
import { readFileSync as readFileSync4 } from "fs";
function readCandidateRegistry() {
  try {
    const raw = readFileSync4(candidateRegistryPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { candidates: {} };
  }
}
function writeCandidateRegistry(registry) {
  atomicWriteJsonSync(candidateRegistryPath(), registry);
}
function upsertCandidate(registry, entry) {
  registry.candidates[entry.tokenAddress] = entry;
}
function transitionCandidate(registry, tokenAddress, newState, extra) {
  const candidate = registry.candidates[tokenAddress];
  if (!candidate) return false;
  candidate.state = newState;
  candidate.lastUpdatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (extra?.verification) candidate.verification = projectVerificationResult(extra.verification);
  if (extra?.rejectionReason) candidate.rejectionReason = extra.rejectionReason;
  if (extra?.archetype) candidate.archetype = extra.archetype;
  return true;
}
function cleanupCandidates(registry) {
  const now = Date.now();
  let removed = 0;
  for (const [addr, entry] of Object.entries(registry.candidates)) {
    const ttl = new Date(entry.ttl).getTime();
    if (now > ttl) {
      delete registry.candidates[addr];
      removed++;
    }
  }
  return removed;
}
function createCandidateEntry(tokenAddress, poolAddress, symbol, dexId, tags) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const ttl = new Date(Date.now() + 24 * 60 * 6e4).toISOString();
  return {
    tokenAddress,
    poolAddress,
    symbol,
    dexId,
    state: "discovered",
    discoveredAt: now,
    lastUpdatedAt: now,
    discoveryTags: tags,
    archetype: null,
    verification: null,
    rejectionReason: null,
    ttl
  };
}

// src/state/playbooks.ts
import { readFileSync as readFileSync5 } from "fs";
var DEX_DEFAULTS = {
  ston_fi: {
    entryThresholds: {
      minBuyerDiversityRatio: 0.2,
      minVolume1hUsd: 500,
      minLiquidityUsd: 1e3
    },
    sizing: { maxPositionSizePercent: 15 },
    exits: {
      takeProfitPercent: 25,
      stopLossPercent: 10,
      timeLimitSeconds: 7200,
      trailingStop: { activationPercent: 15, deltaPercent: 5 },
      thesisReviewInterval: "PT10M"
    }
  },
  dedust: {
    entryThresholds: {
      minBuyerDiversityRatio: 0.3,
      minVolume1hUsd: 400,
      minLiquidityUsd: 1e3
    },
    sizing: { maxPositionSizePercent: 12 },
    exits: {
      takeProfitPercent: 20,
      stopLossPercent: 12,
      timeLimitSeconds: 5400,
      trailingStop: { activationPercent: 10, deltaPercent: 4 },
      thesisReviewInterval: "PT8M"
    }
  }
};
function defaultPlaybooks() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const defaultStats = { totalTrades: 0, wins: 0, losses: 0, avgPnlPercent: 0, lastUpdated: now };
  return {
    updatedAt: now,
    version: 1,
    archetypes: {
      organic_breakout: {
        name: "organic_breakout",
        description: "Genuine buying interest with accelerating volume and diverse buyers",
        signals: [
          { field: "buyPressure", condition: ">", threshold: 0.6 },
          { field: "volumeAcceleration", condition: ">", threshold: 1.5 },
          { field: "buyerAcceleration", condition: ">", threshold: 1.2 }
        ],
        params: {
          entryThresholds: { minBuyerDiversity: 0.25, minVolume1h: 500, minGtScore: 30 },
          sizing: { positionSizePercent: 10, maxPerToken: 15 },
          exits: {
            takeProfitPercent: 30,
            stopLossPercent: 10,
            timeLimitSeconds: 7200,
            trailingStop: { activationPercent: 15, deltaPercent: 5 },
            thesisHalfLife: "PT30M"
          }
        },
        stats: defaultStats
      },
      paid_attention: {
        name: "paid_attention",
        description: "Token with paid boosts \u2014 traffic fades fast, tighter exits",
        signals: [
          { field: "boostTotalAmount", condition: ">", threshold: 0 },
          { field: "volume1hUsd", condition: ">", threshold: 2e3 }
        ],
        params: {
          entryThresholds: { minBuyerDiversity: 0.2, minVolume1h: 400, minGtScore: null },
          sizing: { positionSizePercent: 8, maxPerToken: 12 },
          exits: {
            takeProfitPercent: 15,
            stopLossPercent: 8,
            timeLimitSeconds: 3600,
            trailingStop: { activationPercent: 10, deltaPercent: 4 },
            thesisHalfLife: "PT15M"
          }
        },
        stats: defaultStats
      },
      cto_momentum: {
        name: "cto_momentum",
        description: "Community takeover with momentum \u2014 higher risk, reduced size",
        signals: [
          { field: "cto", condition: "===", threshold: true },
          { field: "buyPressure", condition: ">", threshold: 0.55 }
        ],
        params: {
          entryThresholds: { minBuyerDiversity: 0.2, minVolume1h: 300, minGtScore: null },
          sizing: { positionSizePercent: 6, maxPerToken: 10 },
          exits: {
            takeProfitPercent: 20,
            stopLossPercent: 12,
            timeLimitSeconds: 5400,
            trailingStop: { activationPercent: 12, deltaPercent: 5 },
            thesisHalfLife: "PT20M"
          }
        },
        stats: defaultStats
      }
    }
  };
}
function readPlaybooks() {
  try {
    const raw = readFileSync5(playbooksPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return defaultPlaybooks();
  }
}
function writePlaybooks(playbooks) {
  playbooks.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  playbooks.version++;
  atomicWriteJsonSync(playbooksPath(), playbooks);
}
function updateArchetypeStats(playbooks, archetype, pnlPercent) {
  const entry = playbooks.archetypes[archetype];
  if (!entry) return false;
  entry.stats.totalTrades++;
  if (pnlPercent > 0) entry.stats.wins++;
  else entry.stats.losses++;
  const total = entry.stats.totalTrades;
  entry.stats.avgPnlPercent = (entry.stats.avgPnlPercent * (total - 1) + pnlPercent) / total;
  entry.stats.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
  return true;
}

// src/state/reflections.ts
import { readFileSync as readFileSync6, appendFileSync, writeFileSync } from "fs";
function appendReflection(entry) {
  ensureStateDir();
  appendFileSync(reflectionLogPath(), JSON.stringify(entry) + "\n", "utf-8");
}
function readReflections() {
  try {
    const raw = readFileSync6(reflectionLogPath(), "utf-8");
    return raw.trim().split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
function readReflectionsInRange(from, to) {
  const entries = readReflections();
  return entries.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return ts >= from.getTime() && ts <= to.getTime();
  });
}

// src/eval/metrics.ts
function calculateEvalMetrics(cooldownPreventedCount = 0, windowDays = 7) {
  const allReflections = readReflections();
  const cutoff = Date.now() - windowDays * 24 * 60 * 6e4;
  const reflections = allReflections.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  const playbooks = readPlaybooks();
  const closeTypeCounts = {};
  const tradeReflections = reflections.filter((r) => r.type === "trade_closed" && r.trade);
  for (const r of tradeReflections) {
    if (r.trade?.exitReason) {
      const closeType = r.trade.exitReason;
      closeTypeCounts[closeType] = (closeTypeCounts[closeType] ?? 0) + 1;
    }
  }
  const archetypeStats = {};
  for (const [name, entry] of Object.entries(playbooks.archetypes)) {
    if (entry.stats.totalTrades > 0) {
      archetypeStats[name] = {
        trades: entry.stats.totalTrades,
        winRate: entry.stats.wins / entry.stats.totalTrades * 100,
        avgPnl: entry.stats.avgPnlPercent
      };
    }
  }
  let totalProfit = 0;
  let totalLoss = 0;
  for (const r of tradeReflections) {
    const pnl = r.trade?.pnlPercent ?? 0;
    if (pnl > 0) totalProfit += pnl;
    else totalLoss += Math.abs(pnl);
  }
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
  const thesisExits = tradeReflections.filter((r) => r.trade?.exitReason === "thesis_exit");
  const thesisExitRate = tradeReflections.length > 0 ? thesisExits.length / tradeReflections.length * 100 : 0;
  const thesisExitPnl = thesisExits.length > 0 ? thesisExits.reduce((sum, r) => sum + (r.trade?.pnlPercent ?? 0), 0) / thesisExits.length : 0;
  let totalHoldMs = 0;
  let holdCount = 0;
  for (const r of tradeReflections) {
    if (r.trade?.holdDuration) {
      const match = r.trade.holdDuration.match(/(\d+)h/);
      if (match) {
        totalHoldMs += parseInt(match[1]) * 36e5;
        holdCount++;
      }
    }
  }
  const avgHoldMs = holdCount > 0 ? totalHoldMs / holdCount : 0;
  const avgHoldDuration = avgHoldMs > 0 ? `${Math.floor(avgHoldMs / 36e5)}h ${Math.floor(avgHoldMs % 36e5 / 6e4)}m` : "N/A";
  const verifyAccuracy = 0;
  const rejectAccuracy = 0;
  const washDetectionRate = 0;
  return {
    verifyAccuracy,
    rejectAccuracy,
    washDetectionRate,
    closeTypeCounts,
    archetypeStats,
    profitFactor,
    avgVerifyLatencyMs: 0,
    apiErrorRate: 0,
    geckoUsagePercent: 0,
    dexUsagePercent: 0,
    thesisExitRate,
    thesisExitPnl,
    avgHoldDuration,
    cooldownPreventedCount
  };
}
function generateEvalReport(baseline, cooldownPreventedCount = 0) {
  const current = calculateEvalMetrics(cooldownPreventedCount);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const comparisons = [];
  const addComparison = (metric, currentVal, baselineVal) => {
    let trend = "no_baseline";
    let delta = null;
    if (baselineVal != null) {
      delta = currentVal - baselineVal;
      if (Math.abs(delta) < 1) trend = "stable";
      else if (delta > 0) trend = "improving";
      else trend = "degrading";
    }
    comparisons.push({ metric, current: currentVal, baseline: baselineVal, delta, trend });
  };
  addComparison("profitFactor", current.profitFactor, null);
  addComparison("thesisExitRate", current.thesisExitRate, null);
  addComparison("cooldownPreventedCount", current.cooldownPreventedCount, null);
  const alerts = [];
  const slCount = current.closeTypeCounts["stop_loss"] ?? 0;
  const totalCloses = Object.values(current.closeTypeCounts).reduce((s, v) => s + (v ?? 0), 0);
  if (totalCloses > 5 && slCount / totalCloses > 0.8) {
    alerts.push("WARNING: 80%+ of closes are stop losses \u2014 strategy may be failing");
  }
  if (current.profitFactor < 1 && totalCloses > 10) {
    alerts.push("WARNING: Profit factor < 1 \u2014 losing more than winning");
  }
  return {
    generatedAt: now,
    period: { from: baseline.capturedAt, to: now },
    current,
    baseline,
    comparison: comparisons,
    alerts
  };
}
function captureBaseline(winRate, avgPnlPercent, maxDrawdown, tradesPerWeek) {
  return {
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    period: "v1_final",
    metrics: {
      winRate,
      avgPnlPercent,
      maxDrawdown,
      tradesPerWeek
    }
  };
}
export {
  BarrierManager,
  CooldownManager,
  DEFAULT_DATA_DIR,
  DEFAULT_RISK_POLICY,
  DEX_DEFAULTS,
  DexScreenerClient,
  GeckoTerminalClient,
  PositionManager,
  QuotaManager,
  RateLimiter,
  RequestPriority,
  Simulator,
  TokenScreener,
  TractionEyeClient,
  TractionEyeHttpError,
  addPosition,
  appendReflection,
  atomicWriteJsonSync,
  briefingPath,
  buildConfidence,
  calculateEvalMetrics,
  candidateRegistryPath,
  captureBaseline,
  checkOrganicity,
  checkSafety,
  cleanVerifyCache,
  cleanupCandidates,
  computeSignals,
  configPath,
  cooldownPath,
  createCandidateEntry,
  createTractionEyeTools,
  ensureDataDir,
  ensureStateDir,
  evalReportPath,
  evalTracesDir,
  generateEvalReport,
  getCachedVerifyData,
  isAgentSessionActive,
  marketStatePath,
  playbooksPath,
  portfolioStatePath,
  readBriefing,
  readCandidateRegistry,
  readConfig,
  readMarketState,
  readPlaybooks,
  readPortfolioState,
  readReflections,
  readReflectionsInRange,
  recordExitEvent,
  reflectionLogPath,
  resolveBarriers,
  sessionLockPath,
  stateDirPath,
  touchSessionLock,
  transitionCandidate,
  updateArchetypeStats,
  updateConfig,
  updatePositionBarriers,
  updateThesisStatus,
  upsertCandidate,
  verifyCandidate,
  writeCandidateRegistry,
  writeConfig,
  writeMarketState,
  writePlaybooks,
  writePortfolioState
};
