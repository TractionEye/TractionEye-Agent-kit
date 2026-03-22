import { randomUUID } from 'node:crypto';
import { TractionEyeHttpClient, TractionEyeHttpError } from './http/client.js';
import { logMethodCall } from './logger.js';
import { RateLimiter } from './rate-limiter.js';
import { GeckoTerminalClient } from './gecko/client.js';
import { TokenScreener } from './screening/screener.js';
import { PositionManager } from './position/manager.js';
import { Simulator } from './simulation/simulator.js';
import type {
  AvailableToken,
  OperationStatus,
  OperationStatusType,
  PortfolioSummary,
  StrategySummary,
  TradeAction,
  TradeExecution,
  TradeExecutionRequest,
  TradePreview,
  TradePreviewRequest,
  TractionEyeClientConfig,
  ValidationOutcome,
} from './types/contracts.js';
import type { PositionConfig, MonitorConfig, PositionEvent } from './position/types.js';
import type { ScreeningConfig, ScreeningFilter } from './screening/types.js';
import type { PoolInfo } from './gecko/types.js';
import type { SimulationResult } from './simulation/types.js';

const DEFAULT_BASE_URL = 'https://test.tractioneye.xyz/trust_api';

// ─── Backend response types ────────────────────────────────────────────────

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

type AgentPreviewResponse = {
  action: string;
  token_address: string;
  estimated_receive: number;
  min_receive: number;
  offer_amount: number;
  price_impact: number;
  swap_rate: number;
  validation_outcome: string;
  low_balance_state: boolean;
  warning_reason: string | null;
};

type AgentExecuteResponse = {
  operation_id: string;
  operation_status: string;
  validation_outcome: string;
  failure_reason: string | null;
  execution_result: {
    deal_id: number;
    estimated_receive: number;
    offer_amount: number;
    swap_type: string;
  } | null;
};

type AgentOperationResponse = {
  operation_id: string;
  operation_status: string;
  failure_reason: string | null;
  execution_result: {
    swap_status: string;
    tx_hash: string | null;
    actual_token_amount: number | null;
    actual_ton_amount: number | null;
  } | null;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function toValidationOutcome(raw?: string): ValidationOutcome {
  if (raw === 'warning') return 'warning';
  if (raw === 'rejected') return 'rejected';
  return 'ok';
}

function toOperationStatus(raw?: string): OperationStatusType {
  if (raw === 'confirmed') return 'confirmed';
  if (raw === 'adjusted') return 'adjusted';
  if (raw === 'failed') return 'failed';
  return 'pending';
}

// ─── Operation context (in-memory, survives within a single client instance) ──

type OperationContext = {
  swapType: TradeAction;
  tokenAddress: string;
};

// ─── Client ────────────────────────────────────────────────────────────────

export class TractionEyeClient {
  /** In-memory map: operationId → execution context (swapType, tokenAddress). */
  private readonly _opContext = new Map<string, OperationContext>();

  /** GeckoTerminal client for market data (built-in, no API key needed). */
  readonly gecko: GeckoTerminalClient;
  /** Token screener for filtering pools by criteria. */
  readonly screener: TokenScreener;
  /** Rate limiter for GeckoTerminal API (30 req/60s). */
  readonly limiter: RateLimiter;
  /** Simulation engine (only active when dryRun=true). */
  readonly simulator: Simulator | null;

  private positionManager: PositionManager | null = null;
  private readonly dryRun: boolean;

  private constructor(
    private readonly http: TractionEyeHttpClient,
    public readonly strategyId: string,
    public readonly strategyName: string,
    limiter: RateLimiter,
    dryRun: boolean,
  ) {
    this.limiter = limiter;
    this.gecko = new GeckoTerminalClient(limiter);
    this.screener = new TokenScreener(this.gecko);
    this.dryRun = dryRun;
    this.simulator = dryRun ? new Simulator() : null;
  }

  // ── Factory ──────────────────────────────────────────────────────────────

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

  get isDryRun(): boolean {
    return this.dryRun;
  }

  // ── Read methods ─────────────────────────────────────────────────────────

  async getStrategySummary(): Promise<StrategySummary> {
    logMethodCall('getStrategySummary');
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
    logMethodCall('getPortfolio');
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

  /**
   * Returns the first page of tradeable tokens (up to `limit`, default 200).
   * Use `findToken()` for symbol-based lookup instead of loading the full catalog.
   */
  async getAvailableTokens(limit = 200, offset = 0): Promise<AvailableToken[]> {
    logMethodCall('getAvailableTokens', { limit, offset });
    const r = await this.http.get<StonfiAssetsResponse>(
      `/agent/assets?limit=${limit}&offset=${offset}`,
    );
    return r.asset_list.map((a) => ({
      address: a.contract_address,
      symbol: a.symbol,
      decimals: a.decimals,
    }));
  }

  /**
   * Find a token by symbol. Preferred way to resolve symbol → address before trading.
   * Example: const weth = await client.findToken('WETH');
   */
  async findToken(symbol: string): Promise<AvailableToken | null> {
    logMethodCall('findToken', { symbol });
    const r = await this.http.get<StonfiAssetsResponse>(
      `/agent/assets/search?q=${encodeURIComponent(symbol)}&limit=10`,
    );
    const match = r.asset_list.find(
      (a) => a.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    if (!match) return null;
    return {
      address: match.contract_address,
      symbol: match.symbol,
      decimals: match.decimals,
    };
  }

  // ── Trade methods ─────────────────────────────────────────────────────────

  async previewTrade(req: TradePreviewRequest): Promise<TradePreview> {
    logMethodCall('previewTrade', { action: req.action, tokenAddress: req.tokenAddress });

    let res: AgentPreviewResponse;
    try {
      res = await this.http.post<AgentPreviewResponse>('/agent/preview', {
        action: req.action.toLowerCase(),
        token_address: req.tokenAddress,
        amount_nano: req.amountNano,
      });
    } catch (e) {
      if (e instanceof TractionEyeHttpError && e.status === 400) {
        const body = e.body as { code?: string; details?: { validation_outcome?: string } } | undefined;
        if (body?.code === 'simulation_failed') {
          return {
            action: req.action,
            tokenAddress: req.tokenAddress,
            amountNano: req.amountNano,
            estimatedReceiveNano: '0',
            minReceiveNano: '0',
            priceImpactPercent: 0,
            swapRate: '0',
            validationOutcome: 'rejected',
            lowBalanceState: false,
          };
        }
      }
      throw e;
    }

    return {
      action: req.action,
      tokenAddress: req.tokenAddress,
      amountNano: req.amountNano,
      estimatedReceiveNano: String(res.estimated_receive ?? 0),
      minReceiveNano: String(res.min_receive ?? 0),
      priceImpactPercent: res.price_impact ?? 0,
      swapRate: String(res.swap_rate ?? 0),
      validationOutcome: toValidationOutcome(res.validation_outcome),
      lowBalanceState: res.low_balance_state ?? false,
    };
  }

  /**
   * Execute a trade. In dry-run mode records a virtual trade via previewTrade().
   */
  async executeTrade(req: TradeExecutionRequest): Promise<TradeExecution> {
    logMethodCall('executeTrade', { action: req.action, tokenAddress: req.tokenAddress });

    // Dry-run: preview + record virtual trade
    if (this.dryRun && this.simulator) {
      const preview = await this.previewTrade({
        action: req.action,
        tokenAddress: req.tokenAddress,
        amountNano: req.amountNano,
      });
      const price = Number(preview.swapRate) || 0;
      if (req.action === 'BUY') {
        this.simulator.recordBuy(req.tokenAddress, '', price, req.amountNano);
      } else {
        this.simulator.recordSell(req.tokenAddress, '', price, req.amountNano);
      }
      return {
        operationId: `sim_${Date.now()}`,
        initialStatus: 'pending',
        swapType: req.action,
        tokenAddress: req.tokenAddress,
      };
    }

    const idempotencyKey = randomUUID();

    const res = await this.http.post<AgentExecuteResponse>('/agent/execute', {
      action: req.action.toLowerCase(),
      token_address: req.tokenAddress,
      amount_nano: req.amountNano,
      slippage_tolerance: req.slippageTolerance ?? 0.01,
      idempotency_key: idempotencyKey,
    });

    const operationId = res.operation_id ?? idempotencyKey;

    // Store context so getOperationStatus() can return correct swapType + tokenAddress
    this._opContext.set(operationId, {
      swapType: req.action,
      tokenAddress: req.tokenAddress,
    });

    const result = res.execution_result;

    return {
      operationId,
      initialStatus: 'pending',
      swapType: req.action,
      tokenAddress: req.tokenAddress,
      expectedTokenAmountNano: result?.estimated_receive != null
        ? String(result.estimated_receive)
        : undefined,
      expectedTonAmountNano: result?.offer_amount != null
        ? String(result.offer_amount)
        : undefined,
    };
  }

  async getOperationStatus(operationId: string): Promise<OperationStatus> {
    logMethodCall('getOperationStatus', { operationId });

    const res = await this.http.get<AgentOperationResponse>(`/agent/operation/${operationId}`);
    const result = res.execution_result;

    // Retrieve execution context stored at executeTrade() time
    const ctx = this._opContext.get(operationId);

    const status = toOperationStatus(res.operation_status);

    // Clean up context once operation reaches a terminal state
    if (status !== 'pending') {
      this._opContext.delete(operationId);
    }

    return {
      operationId,
      status,
      swapType: ctx?.swapType ?? 'BUY',
      tokenAddress: ctx?.tokenAddress ?? '',
      actualTokenAmountNano: result?.actual_token_amount != null
        ? String(result.actual_token_amount)
        : undefined,
      actualTonAmountNano: result?.actual_ton_amount != null
        ? String(result.actual_ton_amount)
        : undefined,
      failureReason: res.failure_reason ?? undefined,
    };
  }

  // ── Market analytics (GeckoTerminal) ─────────────────────────────────────

  /** Screen tokens/pools by filter criteria. */
  async screenTokens(config: ScreeningConfig): Promise<PoolInfo[]> {
    logMethodCall('screenTokens', { sources: config.sources });
    return this.screener.screen(config);
  }

  /** Search pools by keyword with optional filter. */
  async searchPools(query: string, filter?: ScreeningFilter): Promise<PoolInfo[]> {
    logMethodCall('searchPools', { query });
    return this.screener.search(query, filter ?? {});
  }

  /** Get trending pools on TON. */
  async getTrendingPools(): Promise<PoolInfo[]> {
    logMethodCall('getTrendingPools');
    return this.gecko.getTrendingPools();
  }

  /** Get newly created pools on TON. */
  async getNewPools(): Promise<PoolInfo[]> {
    logMethodCall('getNewPools');
    return this.gecko.getNewPools();
  }

  /** Get current USD price for a token by address. */
  async getTokenPriceUsd(tokenAddress: string): Promise<number | null> {
    logMethodCall('getTokenPriceUsd', { tokenAddress });
    const tp = await this.gecko.getTokenPrice(tokenAddress);
    return tp.priceUsd;
  }

  // ── Position management (TP/SL monitoring) ───────────────────────────────

  /**
   * Start monitoring open positions for TP/SL triggers.
   * Fetches the current portfolio and begins the polling loop.
   */
  async startPositionMonitor(
    positionConfig: PositionConfig,
    monitorConfig?: MonitorConfig,
    onEvent?: (event: PositionEvent) => void,
  ): Promise<void> {
    logMethodCall('startPositionMonitor', {
      tp: positionConfig.takeProfitPercent,
      sl: positionConfig.stopLossPercent,
    });

    if (this.positionManager?.isRunning) {
      this.positionManager.stop();
    }

    const executor = async (tokenAddress: string, action: 'BUY' | 'SELL', _sellPercent: number) => {
      const portfolio = await this.getPortfolio();
      const token = portfolio.tokens.find((t) => t.address === tokenAddress);
      if (!token) return;
      await this.executeTrade({
        action,
        tokenAddress,
        amountNano: token.quantity,
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
      const tokenPrice = await this.gecko.getTokenPrice(t.address);
      if (tokenPrice.priceUsd == null) continue;
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
    logMethodCall('stopPositionMonitor');
    this.positionManager?.stop();
  }

  /** Get the position manager instance (if started). */
  getPositionManager(): PositionManager | null {
    return this.positionManager;
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  /** Get simulation results (only available in dry-run mode). */
  getSimulationResults(): SimulationResult | null {
    return this.simulator?.getResults() ?? null;
  }

  /** Reset simulation data (only in dry-run mode). */
  resetSimulation(): void {
    this.simulator?.reset();
  }
}
