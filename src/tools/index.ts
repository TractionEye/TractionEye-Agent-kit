import type { TractionEyeClient } from '../client.js';
import type { TradeAction } from '../types/contracts.js';

type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export function createTractionEyeTools(client: TractionEyeClient): Tool[] {
  return [
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
      description: 'Use this to execute a BUY or SELL trade after you have checked the preview and validation outcome. This will start an operation that you should track with get_operation_status.',
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
  ];
}
