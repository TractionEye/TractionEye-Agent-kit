// ---- GeckoTerminal API response shapes (TON network) ----

export type GeckoPoolAttributes = {
  name: string;
  address: string;
  base_token_price_usd: string;
  quote_token_price_usd: string;
  reserve_in_usd: string;
  pool_created_at: string;
  volume_usd: {
    h1: string;
    h6: string;
    h24: string;
  };
  price_change_percentage: {
    h1: string;
    h6: string;
    h24: string;
  };
  transactions: {
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
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
  volume24hUsd: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  transactions24h: number;
  buys24h: number;
  sells24h: number;
  buySellRatio: number;
  createdAt: string;
  baseTokenId?: string;
};

export type TokenPrice = {
  address: string;
  priceUsd: number | null;
  symbol: string;
};
