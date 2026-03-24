// ---- GeckoTerminal API response shapes (TON network) ----

export type GeckoPoolAttributes = {
  name: string;
  address: string;
  base_token_price_usd: string;
  quote_token_price_usd: string;
  reserve_in_usd: string;
  pool_created_at: string;
  fdv_usd: string | null;
  market_cap_usd: string | null;
  locked_liquidity_percentage: string | null;
  volume_usd: {
    m5: string;
    m15: string;
    m30: string;
    h1: string;
    h6: string;
    h24: string;
  };
  price_change_percentage: {
    m5: string;
    m15: string;
    m30: string;
    h1: string;
    h6: string;
    h24: string;
  };
  transactions: {
    m5: { buys: number; sells: number; buyers: number; sellers: number };
    m15: { buys: number; sells: number; buyers: number; sellers: number };
    m30: { buys: number; sells: number; buyers: number; sellers: number };
    h1: { buys: number; sells: number; buyers: number; sellers: number };
    h6: { buys: number; sells: number; buyers: number; sellers: number };
    h24: { buys: number; sells: number; buyers: number; sellers: number };
  };
};

export type GeckoPoolData = {
  id: string;
  type: string;
  attributes: GeckoPoolAttributes;
  relationships?: {
    base_token?: { data: { id: string; type: string } };
    quote_token?: { data: { id: string; type: string } };
  };
};

export type GeckoPoolsResponse = {
  data: GeckoPoolData[];
};

export type GeckoTokenAttributes = {
  name: string;
  symbol: string;
  address: string;
  decimals: number;
  price_usd: string | null;
  volume_usd: { h24: string };
};

export type GeckoTokenData = {
  id: string;
  type: string;
  attributes: GeckoTokenAttributes;
};

export type GeckoTokensResponse = {
  data: GeckoTokenData[];
};

export type GeckoSearchPoolData = {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    reserve_in_usd: string;
    volume_usd: { h24: string };
    price_change_percentage: { h24: string };
  };
};

export type GeckoSearchResponse = {
  data: GeckoSearchPoolData[];
};

// ---- SDK-level types derived from Gecko data ----

export type PoolInfo = {
  poolAddress: string;
  name: string;
  baseTokenPriceUsd: string;
  reserveInUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  lockedLiquidityPercent: number | null;
  volume24hUsd: number;
  volume6hUsd: number;
  volume1hUsd: number;
  priceChange5m: number;
  priceChange15m: number;
  priceChange30m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  transactions24h: number;
  buys24h: number;
  sells24h: number;
  uniqueBuyers1h: number;
  uniqueBuyers6h: number;
  uniqueBuyers24h: number;
  uniqueSellers1h: number;
  uniqueSellers6h: number;
  uniqueSellers24h: number;
  buySellRatio: number;
  createdAt: string;
  baseTokenId?: string;
};

export type TokenPrice = {
  address: string;
  priceUsd: number | null;
  symbol: string;
};

// ---- Trades endpoint ----

export type GeckoTradeAttributes = {
  kind: 'buy' | 'sell';
  volume_in_usd: string;
  tx_from_address: string;
  block_timestamp: string;
  from_token_amount: string;
  to_token_amount: string;
  price_from_in_usd: string;
  price_to_in_usd: string;
  block_number: number;
  tx_hash: string;
};

export type GeckoTradeData = {
  id: string;
  type: string;
  attributes: GeckoTradeAttributes;
};

export type GeckoTradesResponse = {
  data: GeckoTradeData[];
};

export type TradeInfo = {
  kind: 'buy' | 'sell';
  volumeInUsd: number;
  txFromAddress: string;
  blockTimestamp: string;
  fromTokenAmount: number;
  toTokenAmount: number;
  priceFromInUsd: number;
  priceToInUsd: number;
};

// ---- OHLCV endpoint ----

export type OhlcvCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OhlcvMeta = {
  base: { name: string; symbol: string; address: string };
  quote: { name: string; symbol: string };
};

export type GeckoOhlcvResponse = {
  data: {
    attributes: {
      ohlcv_list: [number, number, number, number, number, number][];
    };
  };
  meta: {
    base: { name: string; symbol: string; address: string };
    quote: { name: string; symbol: string };
  };
};

export type OhlcvResponse = {
  candles: OhlcvCandle[];
  meta: OhlcvMeta;
};

export type OhlcvTimeframe = 'day' | 'hour' | 'minute';
