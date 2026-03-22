import { RateLimiter, RequestPriority } from '../rate-limiter.js';
import type {
  GeckoPoolData,
  GeckoPoolsResponse,
  GeckoSearchResponse,
  GeckoTokensResponse,
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
  async getPools(page = 1, priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<GeckoPoolsResponse>(
      `/networks/${NETWORK}/pools?page=${page}`,
      priority,
    );
    return data.data.map(mapPool);
  }

  /** Trending pools on TON. */
  async getTrendingPools(priority = RequestPriority.Low): Promise<PoolInfo[]> {
    const data = await this.get<GeckoPoolsResponse>(
      `/networks/${NETWORK}/trending_pools`,
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
      volume24hUsd: num(p.attributes.volume_usd.h24),
      priceChange1h: 0,
      priceChange6h: 0,
      priceChange24h: num(p.attributes.price_change_percentage.h24),
      transactions24h: 0,
      buys24h: 0,
      sells24h: 0,
      buySellRatio: 0,
      createdAt: '',
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

function mapPool(p: GeckoPoolData): PoolInfo {
  const a = p.attributes;
  const buys = a.transactions.h24.buys;
  const sells = a.transactions.h24.sells;
  return {
    poolAddress: a.address,
    name: a.name,
    baseTokenPriceUsd: a.base_token_price_usd,
    reserveInUsd: num(a.reserve_in_usd),
    volume24hUsd: num(a.volume_usd.h24),
    priceChange1h: num(a.price_change_percentage.h1),
    priceChange6h: num(a.price_change_percentage.h6),
    priceChange24h: num(a.price_change_percentage.h24),
    transactions24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    buySellRatio: sells > 0 ? buys / sells : buys > 0 ? Infinity : 0,
    createdAt: a.pool_created_at,
    baseTokenId: p.relationships?.base_token?.data?.id,
  };
}
