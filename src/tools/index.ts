import type { TractionEyeClient } from '../client.js';
import type { ScreeningSource } from '../screening/types.js';
import type { OhlcvTimeframe } from '../gecko/types.js';
import {
  readBriefing,
  readConfig,
  writeConfig,
  ensureDataDir,
} from '../config.js';

type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const PRICE_CHANGE_RANGE = {
  type: 'object',
  properties: { min: { type: 'number' }, max: { type: 'number' } },
};

export function createTractionEyeTools(client: TractionEyeClient): Tool[] {
  return [
    // ── 1. read_briefing ────────────────────────────────────────────────
    {
      name: 'tractioneye_read_briefing',
      description:
        'Call this FIRST on every trading session tick. Returns market candidates collected from multiple perspectives (volume leaders, trending 5m/1h for catching early growth, most active by transactions, newly created), current portfolio, and strategy performance. Each candidate has tags showing how it was discovered — a pool appearing in several categories simultaneously may indicate a stronger signal. The briefing also includes top-lists sorted by volume, liquidity, FDV, transaction count, and price gainers (1h, 24h) — use these different views to compare, form hypotheses about what makes a good candidate, and verify your assumptions across sessions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const briefing = readBriefing();
        if (!briefing) return { error: 'No briefing file found. Is the daemon running?' };
        return briefing;
      },
    },

    // ── 2. analyze_pool ─────────────────────────────────────────────────
    {
      name: 'tractioneye_analyze_pool',
      description:
        'Deep-analyze a candidate from briefing: recent trades (whale detection, buy/sell pressure) and OHLCV candles (price trend, volatility). Call AFTER read_briefing for candidates you are interested in, BEFORE buy_token. Uses 2 API requests.',
      parameters: {
        type: 'object',
        properties: {
          poolAddress: { type: 'string', description: 'Pool address to analyze' },
          ohlcvTimeframe: {
            type: 'string',
            enum: ['day', 'hour', 'minute'],
            description: 'OHLCV timeframe (default: hour)',
          },
          ohlcvLimit: { type: 'number', description: 'Number of candles (default: 30)' },
          minTradeVolumeUsd: {
            type: 'number',
            description: 'Only return trades above this USD volume (whale filter)',
          },
        },
        required: ['poolAddress'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const poolAddress = args['poolAddress'] as string;
        const timeframe = (args['ohlcvTimeframe'] as OhlcvTimeframe) ?? 'hour';
        const limit = (args['ohlcvLimit'] as number) ?? 30;
        const minVol = args['minTradeVolumeUsd'] as number | undefined;

        // Sequential — rate limiter enforces minInterval between requests
        const trades = await client.gecko.getPoolTrades(
          poolAddress,
          minVol != null ? { tradeVolumeInUsdGreaterThan: minVol } : undefined,
        );
        const ohlcv = await client.gecko.getPoolOhlcv(poolAddress, timeframe, limit);

        // Compute wallet concentration from trades
        const walletVolume = new Map<string, number>();
        for (const t of trades) {
          walletVolume.set(t.txFromAddress, (walletVolume.get(t.txFromAddress) ?? 0) + t.volumeInUsd);
        }
        const totalVolume = trades.reduce((s, t) => s + t.volumeInUsd, 0);
        const topWallets = [...walletVolume.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([address, volume]) => ({
            address,
            volumeUsd: volume,
            percentOfTotal: totalVolume > 0 ? Math.round((volume / totalVolume) * 10000) / 100 : 0,
          }));

        return {
          trades: { count: trades.length, items: trades.slice(0, 50) },
          ohlcv: { timeframe, candles: ohlcv.candles, meta: ohlcv.meta },
          walletConcentration: { topWallets, totalTradeVolumeUsd: totalVolume },
        };
      },
    },

    // ── 3. buy_token ────────────────────────────────────────────────────
    {
      name: 'tractioneye_buy_token',
      description:
        'Buy a token after analysis. Handles: resolve symbol → preview trade → check validation & price impact → execute → poll status until final. Call AFTER analyze_pool confirmed the candidate. Returns final execution result or rejection reason.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token symbol (e.g. NOT). Either symbol or tokenAddress required.' },
          tokenAddress: { type: 'string', description: 'Token contract address. Either symbol or tokenAddress required.' },
          amountNano: { type: 'string', description: 'Amount of TON to spend in nano units' },
          slippageTolerance: { type: 'number', description: 'Slippage tolerance (default: 0.01 = 1%)' },
        },
        required: ['amountNano'],
        additionalProperties: false,
      },
      handler: async (args) => {
        let tokenAddress = args['tokenAddress'] as string | undefined;
        const symbol = args['symbol'] as string | undefined;
        const amountNano = args['amountNano'] as string;
        const slippage = args['slippageTolerance'] as number | undefined;

        // Resolve symbol → address
        if (!tokenAddress && symbol) {
          const token = await client.findToken(symbol);
          if (!token) return { error: `Token not found: ${symbol}` };
          tokenAddress = token.address;
        }
        if (!tokenAddress) return { error: 'Provide either symbol or tokenAddress' };

        // Preview
        const preview = await client.previewTrade({ action: 'BUY', tokenAddress, amountNano });
        if (preview.validationOutcome === 'rejected') {
          return { status: 'rejected', reason: 'Validation rejected', preview };
        }
        if (preview.priceImpactPercent > 5) {
          return { status: 'rejected', reason: `High price impact: ${preview.priceImpactPercent}%`, preview };
        }

        // Execute
        const execution = await client.executeTrade({
          action: 'BUY',
          tokenAddress,
          amountNano,
          slippageTolerance: slippage,
        });

        // Poll status
        const result = await pollOperationStatus(client, execution.operationId);
        return { status: result.status, operationId: result.operationId, preview, result };
      },
    },

    // ── 4. sell_token ───────────────────────────────────────────────────
    {
      name: 'tractioneye_sell_token',
      description:
        'Sell a token (full or partial). Handles: preview → validate → execute → poll. Use "all" for amountNano to sell entire position. Call when you decide to exit a position manually.',
      parameters: {
        type: 'object',
        properties: {
          tokenAddress: { type: 'string', description: 'Token contract address' },
          amountNano: { type: 'string', description: 'Amount in nano units or "all" for full position' },
          slippageTolerance: { type: 'number', description: 'Slippage tolerance (default: 0.01 = 1%)' },
        },
        required: ['tokenAddress', 'amountNano'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const tokenAddress = args['tokenAddress'] as string;
        let amountNano = args['amountNano'] as string;
        const slippage = args['slippageTolerance'] as number | undefined;

        // Resolve "all"
        if (amountNano === 'all') {
          const portfolio = await client.getPortfolio();
          const token = portfolio.tokens.find((t) => t.address === tokenAddress);
          if (!token) return { error: `Token not found in portfolio: ${tokenAddress}` };
          amountNano = token.quantity;
        }

        // Preview
        const preview = await client.previewTrade({ action: 'SELL', tokenAddress, amountNano });
        if (preview.validationOutcome === 'rejected') {
          return { status: 'rejected', reason: 'Validation rejected', preview };
        }

        // Execute
        const execution = await client.executeTrade({
          action: 'SELL',
          tokenAddress,
          amountNano,
          slippageTolerance: slippage,
        });

        // Poll status
        const result = await pollOperationStatus(client, execution.operationId);
        return { status: result.status, operationId: result.operationId, preview, result };
      },
    },

    // ── 5. set_tp_sl ────────────────────────────────────────────────────
    {
      name: 'tractioneye_set_tp_sl',
      description:
        'Set Take Profit and Stop Loss for a specific token or as defaults for all positions. Call AFTER buy_token. The background daemon monitors prices 24/7 and auto-sells when triggered. Writes to ~/.tractioneye/config.json.',
      parameters: {
        type: 'object',
        properties: {
          tokenAddress: { type: 'string', description: 'Token address. Omit to set defaults.' },
          takeProfitPercent: { type: 'number', description: 'Take profit threshold (e.g. 25 = +25%)' },
          stopLossPercent: { type: 'number', description: 'Stop loss threshold (e.g. 8 = -8%)' },
          partialTakeProfitPercent: { type: 'number', description: 'Partial TP trigger (e.g. 15 = +15%)' },
          partialTakeProfitSellPercent: { type: 'number', description: 'Sell this % of position at partial TP (e.g. 50)' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        ensureDataDir();
        const config = readConfig();
        if (!config.tpSl) {
          config.tpSl = { defaults: { takeProfitPercent: 25, stopLossPercent: 8 } };
        }

        const patch: Record<string, number> = {};
        if (args['takeProfitPercent'] != null) patch.takeProfitPercent = args['takeProfitPercent'] as number;
        if (args['stopLossPercent'] != null) patch.stopLossPercent = args['stopLossPercent'] as number;
        if (args['partialTakeProfitPercent'] != null) patch.partialTakeProfitPercent = args['partialTakeProfitPercent'] as number;
        if (args['partialTakeProfitSellPercent'] != null) patch.partialTakeProfitSellPercent = args['partialTakeProfitSellPercent'] as number;

        const tokenAddress = args['tokenAddress'] as string | undefined;
        if (tokenAddress) {
          if (!config.tpSl.perToken) config.tpSl.perToken = {};
          config.tpSl.perToken[tokenAddress] = { ...config.tpSl.perToken[tokenAddress], ...patch };
        } else {
          config.tpSl.defaults = { ...config.tpSl.defaults, ...patch };
        }

        writeConfig(config);
        return { success: true, tpSl: config.tpSl };
      },
    },

    // ── 6. update_screening_config ──────────────────────────────────────
    {
      name: 'tractioneye_update_screening_config',
      description:
        'Update token screening criteria used by the background daemon for candidate selection. Call during reflection after analyzing trading results to improve future candidate quality. Writes to ~/.tractioneye/config.json.',
      parameters: {
        type: 'object',
        properties: {
          intervalMs: { type: 'number', description: 'Screening interval in ms (default: 180000 = 3min)' },
          minLiquidityUsd: { type: 'number' },
          maxLiquidityUsd: { type: 'number' },
          minFdvUsd: { type: 'number' },
          maxFdvUsd: { type: 'number' },
          minMarketCapUsd: { type: 'number' },
          maxMarketCapUsd: { type: 'number' },
          minLockedLiquidityPercent: { type: 'number' },
          minVolume24hUsd: { type: 'number' },
          priceChange5m: PRICE_CHANGE_RANGE,
          priceChange15m: PRICE_CHANGE_RANGE,
          priceChange30m: PRICE_CHANGE_RANGE,
          priceChange1h: PRICE_CHANGE_RANGE,
          priceChange6h: PRICE_CHANGE_RANGE,
          priceChange24h: PRICE_CHANGE_RANGE,
          minTransactions24h: { type: 'number' },
          minBuySellRatio: { type: 'number' },
          minUniqueBuyers24h: { type: 'number' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        ensureDataDir();
        const config = readConfig();
        if (!config.screening) config.screening = {};

        if (args['intervalMs'] != null) {
          config.screening.intervalMs = args['intervalMs'] as number;
        }

        // Build filter from remaining args
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
      },
    },

    // ── 7. get_status ───────────────────────────────────────────────────
    {
      name: 'tractioneye_get_status',
      description:
        'Get strategy performance (PnL, win rate, balance, drawdown) and current portfolio (positions with PnL) in one call. Call during reflection or when user asks about performance.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const [summary, portfolio] = await Promise.all([
          client.getStrategySummary(),
          client.getPortfolio(),
        ]);
        return { strategy: summary, portfolio };
      },
    },

    // ── 8. screen_tokens ────────────────────────────────────────────────
    {
      name: 'tractioneye_screen_tokens',
      description:
        'Screen TON tokens/pools by criteria: liquidity, FDV, market cap, volume, price change (5m to 24h), transactions, buy/sell ratio, unique buyers. Returns matching pools from GeckoTerminal. Use for ad-hoc screening beyond the daemon briefing.',
      parameters: {
        type: 'object',
        properties: {
          minLiquidityUsd: { type: 'number', description: 'Minimum pool liquidity in USD' },
          maxLiquidityUsd: { type: 'number', description: 'Maximum pool liquidity in USD' },
          minFdvUsd: { type: 'number', description: 'Minimum fully diluted valuation in USD' },
          maxFdvUsd: { type: 'number', description: 'Maximum fully diluted valuation in USD' },
          minMarketCapUsd: { type: 'number', description: 'Minimum market cap in USD' },
          maxMarketCapUsd: { type: 'number', description: 'Maximum market cap in USD' },
          minLockedLiquidityPercent: { type: 'number', description: 'Minimum locked liquidity (e.g. 50 = 50%)' },
          minVolume24hUsd: { type: 'number', description: 'Minimum 24h volume in USD' },
          priceChange5m: { ...PRICE_CHANGE_RANGE, description: 'Price change 5m range (%)' },
          priceChange15m: { ...PRICE_CHANGE_RANGE, description: 'Price change 15m range (%)' },
          priceChange30m: { ...PRICE_CHANGE_RANGE, description: 'Price change 30m range (%)' },
          priceChange1h: { ...PRICE_CHANGE_RANGE, description: 'Price change 1h range (%)' },
          priceChange6h: { ...PRICE_CHANGE_RANGE, description: 'Price change 6h range (%)' },
          priceChange24h: { ...PRICE_CHANGE_RANGE, description: 'Price change 24h range (%)' },
          minTransactions24h: { type: 'number', description: 'Min transactions in 24h' },
          minBuySellRatio: { type: 'number', description: 'Min buy/sell ratio (e.g. 1.5)' },
          minUniqueBuyers24h: { type: 'number', description: 'Min unique buyers in 24h' },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['pools', 'trending', 'new_pools'] },
            description: 'Sources to scan (default: all)',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const sources = args['sources'] as ScreeningSource[] | undefined;
        const rangeArg = (key: string) => args[key] as { min?: number; max?: number } | undefined;
        return client.screenTokens({
          filter: {
            minLiquidityUsd: args['minLiquidityUsd'] as number | undefined,
            maxLiquidityUsd: args['maxLiquidityUsd'] as number | undefined,
            minFdvUsd: args['minFdvUsd'] as number | undefined,
            maxFdvUsd: args['maxFdvUsd'] as number | undefined,
            minMarketCapUsd: args['minMarketCapUsd'] as number | undefined,
            maxMarketCapUsd: args['maxMarketCapUsd'] as number | undefined,
            minLockedLiquidityPercent: args['minLockedLiquidityPercent'] as number | undefined,
            minVolume24hUsd: args['minVolume24hUsd'] as number | undefined,
            priceChange5m: rangeArg('priceChange5m'),
            priceChange15m: rangeArg('priceChange15m'),
            priceChange30m: rangeArg('priceChange30m'),
            priceChange1h: rangeArg('priceChange1h'),
            priceChange6h: rangeArg('priceChange6h'),
            priceChange24h: rangeArg('priceChange24h'),
            minTransactions24h: args['minTransactions24h'] as number | undefined,
            minBuySellRatio: args['minBuySellRatio'] as number | undefined,
            minUniqueBuyers24h: args['minUniqueBuyers24h'] as number | undefined,
          },
          sources,
        });
      },
    },

    // ── 9. find ─────────────────────────────────────────────────────────
    {
      name: 'tractioneye_find',
      description:
        'Find a token by symbol or search pools by keyword. Combines findToken (symbol → address) and searchPools (keyword → pool list). Use when you need to resolve a token or explore pools by name.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Token symbol or search keyword' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const query = args['query'] as string;
        const [token, pools] = await Promise.all([
          client.findToken(query),
          client.searchPools(query),
        ]);
        return { token, pools };
      },
    },

    // ── 10. get_token_price ─────────────────────────────────────────────
    {
      name: 'tractioneye_get_token_price',
      description:
        'Get current USD price for a token by its contract address via GeckoTerminal. Use for quick price checks.',
      parameters: {
        type: 'object',
        properties: {
          tokenAddress: { type: 'string', description: 'Token contract address' },
        },
        required: ['tokenAddress'],
        additionalProperties: false,
      },
      handler: async (args) => client.getTokenPriceUsd(args['tokenAddress'] as string),
    },

    // ── 11. get_available_tokens ────────────────────────────────────────
    {
      name: 'tractioneye_get_available_tokens',
      description:
        'Get the list of tokens that can be traded in this strategy. Use to check what tokens are available or to resolve symbols and addresses.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getAvailableTokens(),
    },

    // ── 12. get_simulation_results ──────────────────────────────────────
    {
      name: 'tractioneye_get_simulation_results',
      description:
        'Get dry-run simulation results: win rate, average P&L, recommended TP/SL/position size parameters. Only available in dry-run mode. Call after running simulation to evaluate strategy before going live.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getSimulationResults(),
    },
  ];
}

// ── Internal helpers ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;

async function pollOperationStatus(client: TractionEyeClient, operationId: string) {
  for (let i = 0; i < MAX_POLLS; i++) {
    const status = await client.getOperationStatus(operationId);
    if (status.status !== 'pending') return status;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return client.getOperationStatus(operationId);
}
