/** Filter criteria for token/pool screening. All fields optional. */
export type ScreeningFilter = {
  /** Minimum pool reserve (liquidity) in USD. */
  minLiquidityUsd?: number;
  /** Maximum pool reserve (liquidity) in USD. */
  maxLiquidityUsd?: number;
  /** Minimum 24h trading volume in USD. */
  minVolume24hUsd?: number;
  /** Price change 1h range (min/max %). */
  priceChange1h?: { min?: number; max?: number };
  /** Price change 6h range (min/max %). */
  priceChange6h?: { min?: number; max?: number };
  /** Price change 24h range (min/max %). */
  priceChange24h?: { min?: number; max?: number };
  /** Minimum number of transactions in 24h. */
  minTransactions24h?: number;
  /** Minimum buy/sell ratio (e.g. 1.5 = 1.5× more buys than sells). */
  minBuySellRatio?: number;
};

/** Sources to include when screening. */
export type ScreeningSource = 'pools' | 'trending' | 'new_pools';

export type ScreeningConfig = {
  /** Filter criteria. */
  filter: ScreeningFilter;
  /** Which sources to scan. Defaults to all. */
  sources?: ScreeningSource[];
};
