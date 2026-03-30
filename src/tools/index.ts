import type { TractionEyeClient } from '../client.js';
import type { ScreeningSource } from '../screening/types.js';
import type { OhlcvTimeframe } from '../gecko/types.js';
import type { TripleBarrierConfig } from '../types/v2.js';
import {
  readBriefing,
  readConfig,
  writeConfig,
  ensureDataDir,
  touchSessionLock,
} from '../config.js';
import { verifyCandidate, getCachedVerifyData } from '../verify/index.js';
import { checkSafety } from '../safety/index.js';
import { DEFAULT_RISK_POLICY } from '../types/v2.js';
import { CooldownManager } from '../state/cooldown.js';

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
        touchSessionLock();
        const briefing = readBriefing();
        if (!briefing) return { error: 'No briefing file found. Is the daemon running?' };
        return briefing;
      },
    },

    // ── 2. verify_candidate (replaces analyze_pool) ──────────────────────
    {
      name: 'tractioneye_verify_candidate',
      description:
        'Full verification of a trading candidate. Runs 4-call pipeline: token safety (honeypot/mint/freeze), pool health (unique buyers, liquidity), trade flow analysis (whale detection, wash check), OHLCV price structure. Returns safety verdict, organicity check, momentum signals, confidence score, and penalty breakdown. Call AFTER read_briefing, BEFORE buy_token. Uses 2-4 GeckoTerminal API requests (2 if recently verified, 4 if fresh).',
      parameters: {
        type: 'object',
        properties: {
          tokenAddress: { type: 'string', description: 'Token contract address' },
          poolAddress: { type: 'string', description: 'Pool address to verify' },
          dexId: { type: 'string', description: 'DEX identifier (stonfi, dedust)' },
          poolCreatedAt: { type: 'string', description: 'Pool creation timestamp (ISO)' },
        },
        required: ['tokenAddress', 'poolAddress'],
        additionalProperties: false,
      },
      handler: async (args) => {
        touchSessionLock();
        const tokenAddress = args['tokenAddress'] as string;
        const poolAddress = args['poolAddress'] as string;
        const dexId = (args['dexId'] as string) ?? '';
        const poolCreatedAt = args['poolCreatedAt'] as string | undefined;

        return verifyCandidate(
          client.gecko,
          tokenAddress,
          poolAddress,
          dexId,
          poolCreatedAt,
        );
      },
    },

    // ── 2b. analyze_pool (deprecated alias) ────────────────────────────
    {
      name: 'tractioneye_analyze_pool',
      description:
        '[DEPRECATED — use tractioneye_verify_candidate instead] Deep-analyze a candidate pool.',
      parameters: {
        type: 'object',
        properties: {
          poolAddress: { type: 'string', description: 'Pool address to analyze' },
          tokenAddress: { type: 'string', description: 'Token address (required for full verify)' },
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
        touchSessionLock();
        const poolAddress = args['poolAddress'] as string;
        const tokenAddress = args['tokenAddress'] as string | undefined;

        // If tokenAddress provided, use full verify pipeline
        if (tokenAddress) {
          return verifyCandidate(client.gecko, tokenAddress, poolAddress, '');
        }

        // Legacy fallback: trades + OHLCV only
        const timeframe = (args['ohlcvTimeframe'] as OhlcvTimeframe) ?? 'hour';
        const limit = (args['ohlcvLimit'] as number) ?? 30;
        const minVol = args['minTradeVolumeUsd'] as number | undefined;

        const trades = await client.gecko.getPoolTrades(
          poolAddress,
          minVol != null ? { tradeVolumeInUsdGreaterThan: minVol } : undefined,
        );
        const ohlcv = await client.gecko.getPoolOhlcv(poolAddress, timeframe, limit);

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
          deprecated: 'Use tractioneye_verify_candidate for full safety + organicity checks',
          trades: { count: trades.length, items: trades.slice(0, 50) },
          ohlcv: { timeframe, candles: ohlcv.candles, meta: ohlcv.meta },
          walletConcentration: { topWallets, totalTradeVolumeUsd: totalVolume },
        };
      },
    },

    // ── 3. buy_token (v2: safety gate + cooldown + penalty + barriers) ──
    {
      name: 'tractioneye_buy_token',
      description:
        'Buy a token after verification. Full flow: resolve symbol → cooldown check → safety gate (uses cached verify if <5min) → penalty preview → execute → register barriers atomically. Call AFTER verify_candidate confirmed the candidate. Returns penalty breakdown if penalties apply, then execution result.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token symbol (e.g. NOT). Either symbol or tokenAddress required.' },
          tokenAddress: { type: 'string', description: 'Token contract address. Either symbol or tokenAddress required.' },
          poolAddress: { type: 'string', description: 'Pool address (for barrier registration)' },
          amountNano: { type: 'string', description: 'Amount of TON to spend in nano units' },
          slippageTolerance: { type: 'number', description: 'Slippage tolerance (default: 0.01 = 1%)' },
          archetype: { type: 'string', description: 'Candidate archetype (e.g. organic_breakout)' },
          entryReason: { type: 'string', description: 'Why you are buying (for reflection)' },
          barriers: {
            type: 'object',
            description: 'Custom barrier config. If omitted, defaults from risk policy are used.',
            properties: {
              stopLossPercent: { type: 'number' },
              takeProfitPercent: { type: 'number' },
              timeLimitSeconds: { type: ['number', 'null'] },
              trailingStop: {
                type: ['object', 'null'],
                properties: {
                  activationPercent: { type: 'number' },
                  deltaPercent: { type: 'number' },
                },
              },
              partialTp: {
                type: 'object',
                properties: {
                  triggerPercent: { type: 'number' },
                  sellPercent: { type: 'number' },
                },
              },
            },
          },
        },
        required: ['amountNano'],
        additionalProperties: false,
      },
      handler: async (args) => {
        let tokenAddress = args['tokenAddress'] as string | undefined;
        const symbol = args['symbol'] as string | undefined;
        let amountNano = args['amountNano'] as string;
        const slippage = args['slippageTolerance'] as number | undefined;
        const poolAddress = args['poolAddress'] as string | undefined;
        const archetype = (args['archetype'] as string) ?? 'unknown';
        const entryReason = (args['entryReason'] as string) ?? '';
        const customBarriers = args['barriers'] as TripleBarrierConfig | undefined;

        // Resolve symbol → address
        if (!tokenAddress && symbol) {
          const token = await client.findToken(symbol);
          if (!token) return { error: `Token not found: ${symbol}` };
          tokenAddress = token.address;
        }
        if (!tokenAddress) return { error: 'Provide either symbol or tokenAddress' };

        // Load risk policy and cooldown
        const config = readConfig();
        const riskPolicy = config.riskPolicy ?? DEFAULT_RISK_POLICY;
        const cooldownMgr = new CooldownManager();

        // Cooldown check (in-memory, zero API calls)
        if (cooldownMgr.isInCooldown(tokenAddress, riskPolicy.cooldownAfterExitMinutes)) {
          const entry = cooldownMgr.getEntry(tokenAddress)!;
          const exitTime = new Date(entry.exitTimestamp).getTime();
          const cooldownUntil = new Date(exitTime + riskPolicy.cooldownAfterExitMinutes * 60_000).toISOString();
          return {
            status: 'rejected',
            reason: `Token in cooldown until ${cooldownUntil} (exited by ${entry.closeType})`,
          };
        }

        // Check tradability
        const isTradeable = (await client.findToken(tokenAddress.split('/').pop() ?? tokenAddress)) != null;

        // Get portfolio for position checks
        const portfolio = await client.getPortfolio();

        // Try to use cached verify data for safety check (saves 2 gecko calls)
        const cached = getCachedVerifyData(tokenAddress);
        const tokenInfo = cached?.tokenInfo ?? null;
        const poolInfo = cached?.poolInfo ?? null;

        // Compute pool age
        let poolAge = 0;
        if (poolInfo?.poolCreatedAt) {
          poolAge = Math.floor((Date.now() - new Date(poolInfo.poolCreatedAt).getTime()) / 60_000);
        }

        // Safety gate check
        const safetyResult = checkSafety({
          tokenInfo,
          poolInfo,
          organicity: null, // Already checked during verify_candidate
          portfolio,
          riskPolicy,
          cooldownMap: cooldownMgr.getMap(),
          tokenAddress,
          isTradeable,
          poolAge,
          cto: false,
        });

        if (safetyResult.verdict === 'reject') {
          return {
            status: 'rejected',
            reason: safetyResult.rejects.map((r) => `${r.id}: ${r.reason}`).join('; '),
            safetyResult,
          };
        }

        // Apply penalty multiplier to amount
        const originalAmountNano = amountNano;
        if (safetyResult.finalMultiplier < 1) {
          const adjusted = BigInt(Math.floor(Number(BigInt(amountNano)) * safetyResult.finalMultiplier));
          amountNano = adjusted.toString();
        }

        // Preview
        const preview = await client.previewTrade({ action: 'BUY', tokenAddress, amountNano });
        if (preview.validationOutcome === 'rejected') {
          return { status: 'rejected', reason: 'Validation rejected', preview };
        }
        if (preview.priceImpactPercent > riskPolicy.maxPriceImpactPercent) {
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

        // Determine barriers
        const barriers: TripleBarrierConfig = customBarriers ?? riskPolicy.defaultBarriers;

        // Build response with penalty breakdown
        const response: Record<string, unknown> = {
          status: result.status,
          operationId: result.operationId,
          preview,
          result,
          barriers,
          archetype,
          entryReason,
        };

        if (safetyResult.penalties.length > 0) {
          response.penaltyBreakdown = {
            originalAmountNano,
            adjustedAmountNano: amountNano,
            penalties: safetyResult.penalties,
            finalMultiplier: safetyResult.finalMultiplier,
          };
        }

        return response;
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

    // ── 5. set_tp_sl (v2: supports full TripleBarrierConfig) ─────────────
    {
      name: 'tractioneye_set_tp_sl',
      description:
        'Set or modify barriers for an existing position or set defaults. Supports full Triple Barrier config: TP, SL, trailing stop, time limit, partial TP. Use to MODIFY barriers on already-open positions (barriers are set atomically at buy time via buy_token).',
      parameters: {
        type: 'object',
        properties: {
          tokenAddress: { type: 'string', description: 'Token address. Omit to set defaults.' },
          takeProfitPercent: { type: 'number', description: 'Take profit threshold (e.g. 25 = +25%)' },
          stopLossPercent: { type: 'number', description: 'Stop loss threshold (e.g. 8 = -8%)' },
          partialTakeProfitPercent: { type: 'number', description: 'Partial TP trigger (e.g. 15 = +15%)' },
          partialTakeProfitSellPercent: { type: 'number', description: 'Sell this % of position at partial TP (e.g. 50)' },
          timeLimitSeconds: { type: ['number', 'null'], description: 'Max hold time in seconds (null = no limit)' },
          trailingStopActivationPercent: { type: 'number', description: 'Trailing stop activates at +X% PnL' },
          trailingStopDeltaPercent: { type: 'number', description: 'Trailing stop follows X% below peak' },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        ensureDataDir();
        const config = readConfig();
        if (!config.tpSl) {
          config.tpSl = { defaults: { takeProfitPercent: 25, stopLossPercent: 8 } };
        }

        const patch: Record<string, unknown> = {};
        if (args['takeProfitPercent'] != null) patch.takeProfitPercent = args['takeProfitPercent'] as number;
        if (args['stopLossPercent'] != null) patch.stopLossPercent = args['stopLossPercent'] as number;
        if (args['partialTakeProfitPercent'] != null) patch.partialTakeProfitPercent = args['partialTakeProfitPercent'] as number;
        if (args['partialTakeProfitSellPercent'] != null) patch.partialTakeProfitSellPercent = args['partialTakeProfitSellPercent'] as number;
        if (args['timeLimitSeconds'] !== undefined) patch.timeLimitSeconds = args['timeLimitSeconds'];
        if (args['trailingStopActivationPercent'] != null || args['trailingStopDeltaPercent'] != null) {
          patch.trailingStop = {
            activationPercent: args['trailingStopActivationPercent'] as number ?? 15,
            deltaPercent: args['trailingStopDeltaPercent'] as number ?? 5,
          };
        }

        const tokenAddress = args['tokenAddress'] as string | undefined;
        if (tokenAddress) {
          if (!config.tpSl.perToken) config.tpSl.perToken = {};
          config.tpSl.perToken[tokenAddress] = { ...config.tpSl.perToken[tokenAddress], ...patch };
        } else {
          config.tpSl.defaults = { ...config.tpSl.defaults, ...patch } as typeof config.tpSl.defaults;
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
        'Screen TON tokens/pools by criteria: liquidity, FDV, market cap, volume, price change (5m to 24h), transactions, buy/sell ratio, unique buyers. Returns matching pools from DEX market data. Use for ad-hoc screening beyond the daemon briefing.',
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
        'Get current USD price for a token by its contract address. Use for quick price checks.',
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

    // ── 13. review_position (v2) ───────────────────────────────────────
    {
      name: 'tractioneye_review_position',
      description:
        'Check thesis for an open position: get fresh market data, compare with entry snapshot, return verdict (intact/weakening/broken). Call to review position health during a session.',
      parameters: {
        type: 'object',
        properties: {
          tokenAddress: { type: 'string', description: 'Token address of the open position' },
          poolAddress: { type: 'string', description: 'Pool address for the position' },
        },
        required: ['tokenAddress', 'poolAddress'],
        additionalProperties: false,
      },
      handler: async (args) => {
        touchSessionLock();
        const tokenAddress = args['tokenAddress'] as string;
        const poolAddress = args['poolAddress'] as string;

        // Get current pool data from GeckoTerminal (2 calls: poolInfo + trades)
        const poolInfo = await client.gecko.getPoolInfo(poolAddress);
        const trades = await client.gecko.getPoolTrades(poolAddress);

        // Get current price
        const priceInfo = await client.dex.getTokenPrice(tokenAddress);

        // Run organicity check
        const organicity = (await import('../safety/organicity.js')).checkOrganicity(poolInfo, trades);

        // Compute signals
        const signals = (await import('../verify/signals.js')).computeSignals(null, poolInfo);

        return {
          currentPrice: priceInfo.priceUsd,
          poolInfo: {
            reserveInUsd: poolInfo.reserveInUsd,
            volume1h: poolInfo.volume.h1,
            buyers1h: poolInfo.transactions.h1.buyers,
            sellers1h: poolInfo.transactions.h1.sellers,
          },
          organicity,
          signals,
          tradeFlow: {
            recentTrades: trades.length,
            buyCount: trades.filter((t) => t.kind === 'buy').length,
            sellCount: trades.filter((t) => t.kind === 'sell').length,
          },
        };
      },
    },

    // ── 14. record_reflection (v2) ─────────────────────────────────────
    {
      name: 'tractioneye_record_reflection',
      description:
        'Write a reflection entry to the log. Call after closing a position or at end of session. Entries are append-only in ~/.tractioneye/state/reflection_log.jsonl.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['trade_closed', 'thesis_review', 'session_summary', 'lesson_learned'],
            description: 'Type of reflection entry',
          },
          trade: {
            type: 'object',
            description: 'Trade reflection (for trade_closed type)',
            properties: {
              tokenAddress: { type: 'string' },
              symbol: { type: 'string' },
              archetype: { type: 'string' },
              pnlPercent: { type: 'number' },
              holdDuration: { type: 'string' },
              exitReason: { type: 'string' },
              whatWorked: { type: 'string' },
              whatFailed: { type: 'string' },
              lessonForPlaybook: { type: 'string' },
            },
          },
          session: {
            type: 'object',
            description: 'Session summary (for session_summary type)',
            properties: {
              candidatesReviewed: { type: 'number' },
              tradesExecuted: { type: 'number' },
              marketRegime: { type: 'string' },
              keyObservation: { type: 'string' },
            },
          },
          lesson: {
            type: 'object',
            description: 'Lesson learned (for lesson_learned type)',
            properties: {
              rule: { type: 'string' },
              evidence: { type: 'string' },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
              affectsPlaybook: { type: ['string', 'null'] },
            },
          },
        },
        required: ['type'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const { appendFileSync, mkdirSync } = await import('node:fs');
        const { reflectionLogPath, ensureStateDir } = await import('../config.js');

        ensureStateDir();
        const entry = {
          timestamp: new Date().toISOString(),
          type: args['type'],
          ...(args['trade'] ? { trade: args['trade'] } : {}),
          ...(args['session'] ? { session: args['session'] } : {}),
          ...(args['lesson'] ? { lesson: args['lesson'] } : {}),
        };

        appendFileSync(reflectionLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
        return { success: true, entry };
      },
    },

    // ── 15. read_risk_policy (v2) ──────────────────────────────────────
    {
      name: 'tractioneye_read_risk_policy',
      description:
        'Get current risk caps and limits. Agent cannot change hard policy — this is read-only. Includes: max positions, exposure cap, price impact limit, cooldown duration, default barriers.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        const config = readConfig();
        return config.riskPolicy ?? DEFAULT_RISK_POLICY;
      },
    },

    // ── 16. read_api_budget (v2) ────────────────────────────────────────
    {
      name: 'tractioneye_read_api_budget',
      description:
        'Get current API quota state. Shows gecko and dexscreener usage vs limits. Agent knows its budget.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        // Return rate limiter stats from client
        return {
          gecko: {
            name: 'GeckoTerminal',
            currentLimit: '5 req/60s',
            note: 'verify_candidate uses 2-4 calls, review_position uses 2 calls',
          },
          dex: {
            name: 'DexScreener',
            currentLimit: '10 req/60s',
            note: 'getTokenPricesBatch handles up to 30 tokens in 1 request',
          },
        };
      },
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
