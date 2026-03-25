import { RateLimiter, RequestPriority } from '../rate-limiter.js';
import type {
  GeckoPoolData,
  GeckoPoolsResponse,
  GeckoSearchResponse,
  GeckoTokensResponse,
  GeckoTradesResponse,
  GeckoOhlcvResponse,
  OhlcvTimeframe,
  OhlcvResponse,
  OhlcvCandle,
  TradeInfo,
  PoolInfo,
  TokenPrice,
} from './types.js';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const NETWORK = 'ton';

/** GeckoTerminal API client for TON network with built-in rate limiting. */
export class GeckoTerminalClient {
  constructor(private readonly limiter: RateLimiter) {}

  // ---------- Pool endpoints ----------

  /** Fetch pools for TON network (paginated, up to 20 per page). */
  async getPools(
    page = 1,
    sort: 'h24_volume_usd_desc' | 'h24_tx_count_desc' = 'h24_volume_usd_desc',
    priority = RequestPriority.Low,
  ): Promise<PoolInfo[]> {
    const data = await this.get<GeckoPoolsResponse>(
      `/networks/${NETWORK}/pools?page=${page}&sort=${sort}`,
      priority,
    );
    return data.data.map(mapPool);
  }

  /** Trending pools on TON. */
  async getTrendingPools(
    duration: '5m' | '1h' | '6h' | '24h' = '24h',
    priority = RequestPriority.Low,
  ): Promise<PoolInfo[]> {
    const data = await this.get<GeckoPoolsResponse>(
      `/networks/${NETWORK}/trending_pools?duration=${duration}`,
      priority,
    );
    return data.data.map(mapPool);
  }

  /** Newly created pools on TON. */
  async getNewPools(priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<GeckoPoolsResponse>(
      `/networks/${NETWORK}/new_pools`,
      priority,
    );
    return data.data.map(mapPool);
  }

  /** Search pools by keyword, filtered to TON network. */
  async searchPools(query: string, priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<GeckoSearchResponse>(
      `/search/pools?query=${encodeURIComponent(query)}&network=${NETWORK}`,
      priority,
    );
    // Search response has a slightly different shape — map common fields
    return data.data.map((p) => ({
      poolAddress: p.attributes.address,
      name: p.attributes.name,
      baseTokenPriceUsd: '0',
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
      createdAt: '',
      tags: [],
    }));
  }

  /** Fetch details for multiple pools (up to 30 addresses, comma-separated). */
  async getPoolsMulti(addresses: string[], priority = RequestPriority.Low): Promise<PoolInfo[]> {
    if (addresses.length === 0) return [];
    const joined = addresses.slice(0, 30).join(',');
    const data = await this.get<GeckoPoolsResponse>(
      `/networks/${NETWORK}/pools/multi/${joined}`,
      priority,
    );
    return data.data.map(mapPool);
  }

  // ---------- Trades & OHLCV endpoints ----------

  /** Fetch recent trades for a pool. */
  async getPoolTrades(
    poolAddress: string,
    options?: { tradeVolumeInUsdGreaterThan?: number },
    priority = RequestPriority.High,
  ): Promise<TradeInfo[]> {
    let path = `/networks/${NETWORK}/pools/${poolAddress}/trades`;
    if (options?.tradeVolumeInUsdGreaterThan != null) {
      path += `?trade_volume_in_usd_greater_than=${options.tradeVolumeInUsdGreaterThan}`;
    }
    const data = await this.get<GeckoTradesResponse>(path, priority);
    return data.data.map((t) => ({
      kind: t.attributes.kind,
      volumeInUsd: num(t.attributes.volume_in_usd),
      txFromAddress: t.attributes.tx_from_address,
      blockTimestamp: t.attributes.block_timestamp,
      fromTokenAmount: num(t.attributes.from_token_amount),
      toTokenAmount: num(t.attributes.to_token_amount),
      priceFromInUsd: num(t.attributes.price_from_in_usd),
      priceToInUsd: num(t.attributes.price_to_in_usd),
    }));
  }

  /** Fetch OHLCV candles for a pool. */
  async getPoolOhlcv(
    poolAddress: string,
    timeframe: OhlcvTimeframe = 'day',
    limit = 30,
    priority = RequestPriority.High,
  ): Promise<OhlcvResponse> {
    const data = await this.get<GeckoOhlcvResponse>(
      `/networks/${NETWORK}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`,
      priority,
    );
    const candles: OhlcvCandle[] = data.data.attributes.ohlcv_list.map(
      ([timestamp, open, high, low, close, volume]) => ({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      }),
    );
    return { candles, meta: data.meta };
  }

  // ---------- Token endpoints ----------

  /** Fetch prices for multiple tokens (up to 30 addresses). P0 priority by default. */
  async getTokenPrices(
    addresses: string[],
    priority = RequestPriority.Critical,
  ): Promise<TokenPrice[]> {
    if (addresses.length === 0) return [];
    const joined = addresses.slice(0, 30).join(',');
    const data = await this.get<GeckoTokensResponse>(
      `/networks/${NETWORK}/tokens/multi/${joined}`,
      priority,
    );
    return data.data.map((t) => ({
      address: t.attributes.address,
      priceUsd: t.attributes.price_usd != null ? num(t.attributes.price_usd) : null,
      symbol: t.attributes.symbol,
    }));
  }

  /** Fetch a single token's price. */
  async getTokenPrice(address: string, priority = RequestPriority.Critical): Promise<TokenPrice> {
    const data = await this.get<GeckoTokensResponse>(
      `/networks/${NETWORK}/tokens/${address}`,
      priority,
    );
    const t = data.data[0];
    if (!t) throw new Error(`Token not found: ${address}`);
    return {
      address: t.attributes.address,
      priceUsd: t.attributes.price_usd != null ? num(t.attributes.price_usd) : null,
      symbol: t.attributes.symbol,
    };
  }

  // ---------- Internal ----------

  private get<T>(path: string, priority: RequestPriority): Promise<T> {
    return this.limiter.schedule(priority, async () => {
      const res = await fetch(`${GECKO_BASE}${path}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}: ${path}`);
      return res.json() as Promise<T>;
    });
  }
}

// ---------- Helpers ----------

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapPool(p: GeckoPoolData): PoolInfo {
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
    tags: [],
  };
}
