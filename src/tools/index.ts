import type { TractionEyeClient } from '../client.js';
import type { TradeAction } from '../types/contracts.js';
import type { ScreeningSource } from '../screening/types.js';

type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export function createTractionEyeTools(client: TractionEyeClient): Tool[] {
  return [
    // ── Existing tools (unchanged) ───────────────────────────────────────
    {
      name: 'tractioneye_get_strategy_summary',
      description: 'Use this to get current performance metrics of the strategy you are managing (PnL, win rate, TON in strategy, drawdown, etc.). Call it before making trading decisions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getStrategySummary(),
    },
    {
      name: 'tractioneye_get_portfolio',
      description: 'Use this to see which tokens are currently held in the strategy, their quantities and PnL. Call it when you need current positions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getPortfolio(),
    },
    {
      name: 'tractioneye_get_available_tokens',
      description: 'Use this to get the list of tokens that can be bought or sold in this strategy. Use it to resolve token symbols and addresses.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getAvailableTokens(),
    },
    {
      name: 'tractioneye_find_token',
      description: 'Use this to find a token by its symbol (e.g. "WETH") and get its contract address and decimals. Call this before previewTrade or executeTrade when you only know the symbol.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token symbol, e.g. WETH, USDT, NOT' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
      handler: async (args) => client.findToken(args['symbol'] as string),
    },
    {
      name: 'tractioneye_preview_trade',
      description: 'Use this to simulate a BUY or SELL trade for a given token and amount, and to get price impact, min receive amount and validation outcome. Always call this before executing a trade.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['BUY', 'SELL'] },
          tokenAddress: { type: 'string' },
          amountNano: { type: 'string', description: 'Amount in nano units (TON or jetton)' },
        },
        required: ['action', 'tokenAddress', 'amountNano'],
        additionalProperties: false,
      },
      handler: async (args) => client.previewTrade({
        action: args['action'] as TradeAction,
        tokenAddress: args['tokenAddress'] as string,
        amountNano: args['amountNano'] as string,
      }),
    },
    {
      name: 'tractioneye_execute_trade',
      description: 'Use this to execute a BUY or SELL trade after you have checked the preview and validation outcome. In dry-run mode records a virtual trade instead. Track with get_operation_status.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['BUY', 'SELL'] },
          tokenAddress: { type: 'string' },
          amountNano: { type: 'string' },
          slippageTolerance: { type: 'number', description: 'Optional, default 0.01' },
        },
        required: ['action', 'tokenAddress', 'amountNano'],
        additionalProperties: false,
      },
      handler: async (args) => client.executeTrade({
        action: args['action'] as TradeAction,
        tokenAddress: args['tokenAddress'] as string,
        amountNano: args['amountNano'] as string,
        slippageTolerance: args['slippageTolerance'] as number | undefined,
      }),
    },
    {
      name: 'tractioneye_get_operation_status',
      description: 'Use this to check the status of a previously executed trade by operationId (pending, confirmed, adjusted, failed). Call it repeatedly until status is final.',
      parameters: {
        type: 'object',
        properties: { operationId: { type: 'string' } },
        required: ['operationId'],
        additionalProperties: false,
      },
      handler: async (args) => client.getOperationStatus(args['operationId'] as string),
    },

    // ── New tools (GeckoTerminal analytics) ──────────────────────────────

    {
      name: 'tractioneye_screen_tokens',
      description: 'Screen TON tokens/pools by criteria: liquidity, volume, price change (1h/6h/24h), transactions, buy/sell ratio. Returns matching pools from GeckoTerminal.',
      parameters: {
        type: 'object',
        properties: {
          minLiquidityUsd: { type: 'number', description: 'Minimum pool liquidity in USD' },
          maxLiquidityUsd: { type: 'number', description: 'Maximum pool liquidity in USD' },
          minVolume24hUsd: { type: 'number', description: 'Minimum 24h volume in USD' },
          priceChange1h: {
            type: 'object',
            properties: { min: { type: 'number' }, max: { type: 'number' } },
            description: 'Price change 1h range (%)',
          },
          priceChange6h: {
            type: 'object',
            properties: { min: { type: 'number' }, max: { type: 'number' } },
            description: 'Price change 6h range (%)',
          },
          priceChange24h: {
            type: 'object',
            properties: { min: { type: 'number' }, max: { type: 'number' } },
            description: 'Price change 24h range (%)',
          },
          minTransactions24h: { type: 'number', description: 'Min transactions in 24h' },
          minBuySellRatio: { type: 'number', description: 'Min buy/sell ratio (e.g. 1.5)' },
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
        return client.screenTokens({
          filter: {
            minLiquidityUsd: args['minLiquidityUsd'] as number | undefined,
            maxLiquidityUsd: args['maxLiquidityUsd'] as number | undefined,
            minVolume24hUsd: args['minVolume24hUsd'] as number | undefined,
            priceChange1h: args['priceChange1h'] as { min?: number; max?: number } | undefined,
            priceChange6h: args['priceChange6h'] as { min?: number; max?: number } | undefined,
            priceChange24h: args['priceChange24h'] as { min?: number; max?: number } | undefined,
            minTransactions24h: args['minTransactions24h'] as number | undefined,
            minBuySellRatio: args['minBuySellRatio'] as number | undefined,
          },
          sources,
        });
      },
    },
    {
      name: 'tractioneye_search_pools',
      description: 'Search TON pools by keyword (token name, symbol, etc.) on GeckoTerminal.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: async (args) => client.searchPools(args['query'] as string),
    },
    {
      name: 'tractioneye_get_trending_pools',
      description: 'Get currently trending pools on TON DEX from GeckoTerminal.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getTrendingPools(),
    },
    {
      name: 'tractioneye_get_new_pools',
      description: 'Get newly created pools on TON DEX from GeckoTerminal.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getNewPools(),
    },
    {
      name: 'tractioneye_get_token_price',
      description: 'Get current USD price for a token by its contract address via GeckoTerminal.',
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
    {
      name: 'tractioneye_get_simulation_results',
      description: 'Get dry-run simulation results: win rate, average P&L, recommended TP/SL/position size parameters. Only available in dry-run mode.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => client.getSimulationResults(),
    },
  ];
}
