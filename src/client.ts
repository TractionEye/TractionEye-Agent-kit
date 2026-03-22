import { TractionEyeHttpClient } from './http/client.js';
import { RateLimiter } from './rate-limiter.js';
import { GeckoTerminalClient } from './gecko/client.js';
import { TokenScreener } from './screening/screener.js';
import { PositionManager } from './position/manager.js';
import { Simulator } from './simulation/simulator.js';
import type {
  AvailableToken,
  OperationStatus,
  PortfolioSummary,
  StrategySummary,
  TradeAction,
  TradePreview,
  TradeRequest,
  TradeResult,
  TractionEyeClientConfig,
} from './types/contracts.js';
import type { PositionConfig, MonitorConfig, PositionEvent } from './position/types.js';
import type { ScreeningConfig, ScreeningFilter } from './screening/types.js';
import type { PoolInfo } from './gecko/types.js';
import type { SimulationResult } from './simulation/types.js';

const DEFAULT_BASE_URL = 'https://test.tractioneye.xyz/trust_api';

// ---- Backend response shapes (internal) ----

type AgentStrategyResponse = {
  strategy_id: number;
  strategy_name: string;
  pnl_day: number;
  pnl_week: number;
  pnl_month: number;
  pnl_year: number;
  ton_in_strategy: number;
  total_win_rate: number;
  trades_per_week: number;
  max_drawdown: number;
  low_balance_state: boolean;
};

type AgentPortfolioResponse = {
  total_realized_pnl_ton: number;
  total_unrealized_pnl_ton: number;
  tokens: Array<{
    token_address: string;
    symbol: string;
    decimals: number;
    quantity_nano?: string;
    quantity?: string;
    realized_pnl_ton: number;
    unrealized_pnl_ton: number;
    entry_price?: number;
    current_value_ton?: number;
  }>;
};

type StonfiAssetsResponse = {
  asset_list: Array<{ contract_address: string; symbol: string; decimals: number }>;
};

type TradePreviewResponse = {
  token_address: string;
  action: string;
  amount: string;
  estimated_tokens: string;
  price_impact: number;
  swap_rate: string;
};

type TradeExecuteResponse = {
  operation_id: string;
  token_address: string;
  action: string;
  amount: string;
  status: string;
};

type OperationStatusResponse = {
  operation_id: string;
  status: string;
  result?: TradeExecuteResponse;
};

export class TractionEyeClient {
  /** GeckoTerminal client for market data. */
  readonly gecko: GeckoTerminalClient;
  /** Token screener for filtering pools. */
  readonly screener: TokenScreener;
  /** Simulation engine (only active when dryRun=true). */
  readonly simulator: Simulator | null;

  private positionManager: PositionManager | null = null;
  private readonly dryRun: boolean;

  private constructor(
    private readonly http: TractionEyeHttpClient,
    public readonly strategyId: string,
    public readonly strategyName: string,
    readonly limiter: RateLimiter,
    dryRun: boolean,
  ) {
    this.gecko = new GeckoTerminalClient(limiter);
    this.screener = new TokenScreener(this.gecko);
    this.dryRun = dryRun;
    this.simulator = dryRun ? new Simulator() : null;
  }

  static async create(config: TractionEyeClientConfig): Promise<TractionEyeClient> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const http = new TractionEyeHttpClient(baseUrl, config.agentToken);
    const strategy = await http.get<AgentStrategyResponse>('/agent/strategy');
    const limiter = new RateLimiter();
    return new TractionEyeClient(
      http,
      String(strategy.strategy_id),
      strategy.strategy_name,
      limiter,
      config.dryRun ?? false,
    );
  }

  // ============================================================
  // Existing methods (unchanged API)
  // ============================================================

  async getStrategySummary(): Promise<StrategySummary> {
    const s = await this.http.get<AgentStrategyResponse>('/agent/strategy');
    return {
      strategyId: String(s.strategy_id),
      strategyName: s.strategy_name,
      pnlDayTon: String(s.pnl_day),
      pnlWeekTon: String(s.pnl_week),
      pnlMonthTon: String(s.pnl_month),
      pnlYearTon: String(s.pnl_year),
      tonInStrategy: String(s.ton_in_strategy),
      totalWinRate: s.total_win_rate,
      tradesPerWeek: s.trades_per_week,
      maxDrawdown: s.max_drawdown,
      lowBalanceState: s.low_balance_state,
    };
  }

  async getPortfolio(): Promise<PortfolioSummary> {
    const p = await this.http.get<AgentPortfolioResponse>('/agent/portfolio');
    return {
      strategyId: this.strategyId,
      totalRealizedPnlTon: String(p.total_realized_pnl_ton),
      totalUnrealizedPnlTon: String(p.total_unrealized_pnl_ton),
      tokens: p.tokens.map((t) => ({
        address: t.token_address,
        symbol: t.symbol,
        decimals: t.decimals,
        quantity: t.quantity_nano ?? t.quantity ?? '0',
        realizedPnlTon: String(t.realized_pnl_ton),
        unrealizedPnlTon: String(t.unrealized_pnl_ton),
        entryPriceTon: t.entry_price != null ? String(t.entry_price) : undefined,
        currentValueTon: t.current_value_ton != null ? String(t.current_value_ton) : undefined,
      })),
    };
  }

  async getAvailableTokens(limit = 200, offset = 0): Promise<AvailableToken[]> {
    const r = await this.http.get<StonfiAssetsResponse>(`/stonfi/assets?limit=${limit}&offset=${offset}`);
    return r.asset_list.map((a) => ({
      address: a.contract_address,
      symbol: a.symbol,
      decimals: a.decimals,
    }));
  }

  // ============================================================
  // New base methods
  // ============================================================

  /** Find a token by symbol in the available token list. */
  async findToken(symbol: string): Promise<AvailableToken | null> {
    const tokens = await this.getAvailableTokens();
    const lower = symbol.toLowerCase();
    return tokens.find((t) => t.symbol.toLowerCase() === lower) ?? null;
  }

  /** Preview a trade without executing it. Returns estimated outcome. */
  async previewTrade(req: TradeRequest): Promise<TradePreview> {
    const r = await this.http.post<TradePreviewResponse>('/agent/trade/preview', {
      token_address: req.tokenAddress,
      action: req.action,
      amount: req.amount,
      slippage_tolerance: req.slippageTolerance,
    });
    return {
      tokenAddress: r.token_address,
      action: r.action as TradeAction,
      amount: r.amount,
      estimatedTokens: r.estimated_tokens,
      priceImpact: r.price_impact,
      swapRate: r.swap_rate,
    };
  }

  /**
   * Execute a trade. In dry-run mode records a virtual trade via previewTrade().
   */
  async executeTrade(req: TradeRequest): Promise<TradeResult> {
    if (this.dryRun && this.simulator) {
      const preview = await this.previewTrade(req);
      const price = Number(preview.swapRate) || 0;
      if (req.action === 'BUY') {
        this.simulator.recordBuy(req.tokenAddress, '', price, req.amount);
      } else {
        this.simulator.recordSell(req.tokenAddress, '', price, req.amount);
      }
      return {
        operationId: `sim_${Date.now()}`,
        tokenAddress: req.tokenAddress,
        action: req.action,
        amount: req.amount,
        status: 'completed',
      };
    }

    const r = await this.http.post<TradeExecuteResponse>('/agent/trade/execute', {
      token_address: req.tokenAddress,
      action: req.action,
      amount: req.amount,
      slippage_tolerance: req.slippageTolerance,
    });
    return {
      operationId: r.operation_id,
      tokenAddress: r.token_address,
      action: r.action as TradeAction,
      amount: r.amount,
      status: r.status as TradeResult['status'],
    };
  }

  /** Check the status of a trade operation. */
  async getOperationStatus(operationId: string): Promise<OperationStatus> {
    const r = await this.http.get<OperationStatusResponse>(`/agent/trade/status/${operationId}`);
    return {
      operationId: r.operation_id,
      status: r.status as OperationStatus['status'],
      result: r.result
        ? {
            operationId: r.result.operation_id,
            tokenAddress: r.result.token_address,
            action: r.result.action as TradeAction,
            amount: r.result.amount,
            status: r.result.status as TradeResult['status'],
          }
        : undefined,
    };
  }

  // ============================================================
  // Market analytics (GeckoTerminal)
  // ============================================================

  /** Screen tokens/pools by filter criteria. */
  async screenTokens(config: ScreeningConfig): Promise<PoolInfo[]> {
    return this.screener.screen(config);
  }

  /** Search pools by keyword with optional filter. */
  async searchPools(query: string, filter?: ScreeningFilter): Promise<PoolInfo[]> {
    return this.screener.search(query, filter ?? {});
  }

  /** Get trending pools on TON. */
  async getTrendingPools(): Promise<PoolInfo[]> {
    return this.gecko.getTrendingPools();
  }

  /** Get newly created pools on TON. */
  async getNewPools(): Promise<PoolInfo[]> {
    return this.gecko.getNewPools();
  }

  /** Get current USD price for a token by address. */
  async getTokenPriceUsd(tokenAddress: string): Promise<number | null> {
    const tp = await this.gecko.getTokenPrice(tokenAddress);
    return tp.priceUsd;
  }

  // ============================================================
  // Position management (TP/SL monitoring)
  // ============================================================

  /**
   * Start monitoring open positions for TP/SL triggers.
   * Fetches the current portfolio and begins the polling loop.
   */
  async startPositionMonitor(
    positionConfig: PositionConfig,
    monitorConfig?: MonitorConfig,
    onEvent?: (event: PositionEvent) => void,
  ): Promise<void> {
    if (this.positionManager?.isRunning) {
      this.positionManager.stop();
    }

    const executor = async (tokenAddress: string, action: 'BUY' | 'SELL', _sellPercent: number) => {
      // In a full implementation, sellPercent would determine the amount.
      // For now we sell the entire position quantity.
      const portfolio = await this.getPortfolio();
      const token = portfolio.tokens.find((t) => t.address === tokenAddress);
      if (!token) return;
      await this.executeTrade({
        tokenAddress,
        action,
        amount: token.quantity,
      });
    };

    this.positionManager = new PositionManager(
      this.gecko,
      positionConfig,
      executor,
      onEvent,
      monitorConfig,
    );

    // Load existing positions from portfolio
    const portfolio = await this.getPortfolio();
    for (const t of portfolio.tokens) {
      if (t.entryPriceTon == null) continue;
      // Get entry price in USD from GeckoTerminal for TP/SL comparison
      const tokenPrice = await this.gecko.getTokenPrice(t.address);
      if (tokenPrice.priceUsd == null) continue;
      // Approximate entry price in USD based on current price ratio
      const currentValueTon = Number(t.currentValueTon ?? 0);
      const entryPriceTon = Number(t.entryPriceTon);
      const ratio = entryPriceTon > 0 && currentValueTon > 0
        ? entryPriceTon / currentValueTon
        : 1;
      const entryPriceUsd = tokenPrice.priceUsd * ratio;

      this.positionManager.addPosition({
        tokenAddress: t.address,
        symbol: t.symbol,
        entryPriceUsd,
        quantity: t.quantity,
        partialTpTriggered: false,
      });
    }

    this.positionManager.start();
  }

  /** Stop the position monitoring loop. */
  stopPositionMonitor(): void {
    this.positionManager?.stop();
  }

  /** Get the position manager instance (if started). */
  getPositionManager(): PositionManager | null {
    return this.positionManager;
  }

  // ============================================================
  // Simulation
  // ============================================================

  /** Get simulation results (only available in dry-run mode). */
  getSimulationResults(): SimulationResult | null {
    return this.simulator?.getResults() ?? null;
  }

  /** Reset simulation data (only in dry-run mode). */
  resetSimulation(): void {
    this.simulator?.reset();
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }
}

// ============================================================
// LLM-ready tool definitions
// ============================================================

/** Creates an array of tool definitions compatible with LLM function-calling APIs. */
export function createTractionEyeTools(client: TractionEyeClient) {
  return [
    {
      name: 'get_strategy_summary',
      description: 'Get strategy performance summary: PnL, win rate, drawdown, balance.',
      parameters: {},
      execute: () => client.getStrategySummary(),
    },
    {
      name: 'get_portfolio',
      description: 'Get current portfolio: open positions, realized and unrealized P&L.',
      parameters: {},
      execute: () => client.getPortfolio(),
    },
    {
      name: 'get_available_tokens',
      description: 'List available tokens for trading.',
      parameters: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number', description: 'Max tokens to return (default 200)' },
          offset: { type: 'number', description: 'Pagination offset' },
        },
      },
      execute: (args: { limit?: number; offset?: number }) =>
        client.getAvailableTokens(args.limit, args.offset),
    },
    {
      name: 'find_token',
      description: 'Find a token by its symbol.',
      parameters: {
        type: 'object' as const,
        properties: {
          symbol: { type: 'string', description: 'Token symbol to search for' },
        },
        required: ['symbol'],
      },
      execute: (args: { symbol: string }) => client.findToken(args.symbol),
    },
    {
      name: 'preview_trade',
      description: 'Preview a trade without executing: shows price impact and estimated tokens.',
      parameters: {
        type: 'object' as const,
        properties: {
          tokenAddress: { type: 'string', description: 'Token contract address' },
          action: { type: 'string', enum: ['BUY', 'SELL'], description: 'Trade direction' },
          amount: { type: 'string', description: 'Amount in TON' },
          slippageTolerance: { type: 'number', description: 'Slippage tolerance %' },
        },
        required: ['tokenAddress', 'action', 'amount'],
      },
      execute: (args: TradeRequest) => client.previewTrade(args),
    },
    {
      name: 'execute_trade',
      description: 'Execute a BUY or SELL trade. In dry-run mode records a virtual trade.',
      parameters: {
        type: 'object' as const,
        properties: {
          tokenAddress: { type: 'string', description: 'Token contract address' },
          action: { type: 'string', enum: ['BUY', 'SELL'], description: 'Trade direction' },
          amount: { type: 'string', description: 'Amount in TON' },
          slippageTolerance: { type: 'number', description: 'Slippage tolerance %' },
        },
        required: ['tokenAddress', 'action', 'amount'],
      },
      execute: (args: TradeRequest) => client.executeTrade(args),
    },
    {
      name: 'get_operation_status',
      description: 'Check the status of a trade operation by ID.',
      parameters: {
        type: 'object' as const,
        properties: {
          operationId: { type: 'string', description: 'Operation ID from executeTrade' },
        },
        required: ['operationId'],
      },
      execute: (args: { operationId: string }) => client.getOperationStatus(args.operationId),
    },
    // --- New tools ---
    {
      name: 'screen_tokens',
      description: 'Screen TON tokens/pools by criteria: liquidity, volume, price change, transactions, buy/sell ratio.',
      parameters: {
        type: 'object' as const,
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
            description: 'Sources to scan',
          },
        },
      },
      execute: (args: ScreeningFilter & { sources?: Array<'pools' | 'trending' | 'new_pools'> }) => {
        const { sources, ...filter } = args;
        return client.screenTokens({ filter, sources });
      },
    },
    {
      name: 'search_pools',
      description: 'Search TON pools by keyword.',
      parameters: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query (token name, symbol, etc.)' },
        },
        required: ['query'],
      },
      execute: (args: { query: string }) => client.searchPools(args.query),
    },
    {
      name: 'get_trending_pools',
      description: 'Get trending pools on TON DEX.',
      parameters: {},
      execute: () => client.getTrendingPools(),
    },
    {
      name: 'get_new_pools',
      description: 'Get newly created pools on TON DEX.',
      parameters: {},
      execute: () => client.getNewPools(),
    },
    {
      name: 'get_token_price',
      description: 'Get current USD price for a token by address.',
      parameters: {
        type: 'object' as const,
        properties: {
          tokenAddress: { type: 'string', description: 'Token contract address' },
        },
        required: ['tokenAddress'],
      },
      execute: (args: { tokenAddress: string }) => client.getTokenPriceUsd(args.tokenAddress),
    },
    {
      name: 'get_simulation_results',
      description: 'Get dry-run simulation results: win rate, avg P&L, recommended parameters.',
      parameters: {},
      execute: () => client.getSimulationResults(),
    },
  ];
}
