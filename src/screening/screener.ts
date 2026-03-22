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

function matchesFilter(pool: PoolInfo, f: ScreeningFilter): boolean {
  if (f.minLiquidityUsd != null && pool.reserveInUsd < f.minLiquidityUsd) return false;
  if (f.maxLiquidityUsd != null && pool.reserveInUsd > f.maxLiquidityUsd) return false;
  if (f.minVolume24hUsd != null && pool.volume24hUsd < f.minVolume24hUsd) return false;

  if (f.priceChange1h) {
    if (f.priceChange1h.min != null && pool.priceChange1h < f.priceChange1h.min) return false;
    if (f.priceChange1h.max != null && pool.priceChange1h > f.priceChange1h.max) return false;
  }
  if (f.priceChange6h) {
    if (f.priceChange6h.min != null && pool.priceChange6h < f.priceChange6h.min) return false;
    if (f.priceChange6h.max != null && pool.priceChange6h > f.priceChange6h.max) return false;
  }
  if (f.priceChange24h) {
    if (f.priceChange24h.min != null && pool.priceChange24h < f.priceChange24h.min) return false;
    if (f.priceChange24h.max != null && pool.priceChange24h > f.priceChange24h.max) return false;
  }

  if (f.minTransactions24h != null && pool.transactions24h < f.minTransactions24h) return false;
  if (f.minBuySellRatio != null && pool.buySellRatio < f.minBuySellRatio) return false;

  return true;
}
