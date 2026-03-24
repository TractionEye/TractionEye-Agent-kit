import type { GeckoTerminalClient } from '../gecko/client.js';
import type { PoolInfo } from '../gecko/types.js';
import type { ScreeningConfig, ScreeningFilter, ScreeningSource } from './types.js';

const ALL_SOURCES: ScreeningSource[] = ['pools', 'trending', 'new_pools'];

/** Screens TON pools via GeckoTerminal and applies client-side filters. */
export class TokenScreener {
  constructor(private readonly gecko: GeckoTerminalClient) {}

  /** Run a screening pass: fetch pools from configured sources & filter. */
  async screen(config: ScreeningConfig): Promise<PoolInfo[]> {
    const sources = config.sources ?? ALL_SOURCES;
    const pools = await this.fetchSources(sources);

    // Deduplicate by pool address
    const seen = new Set<string>();
    const unique: PoolInfo[] = [];
    for (const p of pools) {
      if (!seen.has(p.poolAddress)) {
        seen.add(p.poolAddress);
        unique.push(p);
      }
    }

    return unique.filter((p) => matchesFilter(p, config.filter));
  }

  /** Search pools by keyword and apply filter. */
  async search(query: string, filter: ScreeningFilter): Promise<PoolInfo[]> {
    const pools = await this.gecko.searchPools(query);
    return pools.filter((p) => matchesFilter(p, filter));
  }

  private async fetchSources(sources: ScreeningSource[]): Promise<PoolInfo[]> {
    const results = await Promise.all(
      sources.map((s) => {
        switch (s) {
          case 'pools':
            return this.gecko.getPools();
          case 'trending':
            return this.gecko.getTrendingPools();
          case 'new_pools':
            return this.gecko.getNewPools();
        }
      }),
    );
    return results.flat();
  }
}

function checkRange(value: number, range?: { min?: number; max?: number }): boolean {
  if (!range) return true;
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}

function matchesFilter(pool: PoolInfo, f: ScreeningFilter): boolean {
  if (f.minLiquidityUsd != null && pool.reserveInUsd < f.minLiquidityUsd) return false;
  if (f.maxLiquidityUsd != null && pool.reserveInUsd > f.maxLiquidityUsd) return false;
  if (f.minVolume24hUsd != null && pool.volume24hUsd < f.minVolume24hUsd) return false;

  // FDV / market cap / locked liquidity — skip check if pool value is null (no data)
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
