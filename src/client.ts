import { randomUUID } from 'node:crypto';
import { TractionEyeHttpClient, TractionEyeHttpError } from './http/client.js';
import { logMethodCall } from './logger.js';
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

// ─── Client ────────────────────────────────────────────────────────────────

export class TractionEyeClient {
  private constructor(
    private readonly http: TractionEyeHttpClient,
    public readonly strategyId: string,
    public readonly strategyName: string,
  ) {}

  // ── Factory ──────────────────────────────────────────────────────────────

  static async create(config: TractionEyeClientConfig): Promise<TractionEyeClient> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const http = new TractionEyeHttpClient(baseUrl, config.agentToken);
    const strategy = await http.get<AgentStrategyResponse>('/agent/strategy');
    return new TractionEyeClient(http, String(strategy.strategy_id), strategy.strategy_name);
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
   * Find a token by symbol. Use this to resolve symbol → address before trading.
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
      // Backend returns 400 with code=simulation_failed when trade is rejected
      // (e.g., insufficient position size, no quotes). Convert to TradePreview with rejected outcome.
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

  async executeTrade(req: TradeExecutionRequest): Promise<TradeExecution> {
    logMethodCall('executeTrade', { action: req.action, tokenAddress: req.tokenAddress });

    const idempotencyKey = randomUUID();

    const res = await this.http.post<AgentExecuteResponse>('/agent/execute', {
      action: req.action.toLowerCase(),
      token_address: req.tokenAddress,
      amount_nano: req.amountNano,
      slippage_tolerance: req.slippageTolerance ?? 0.01,
      idempotency_key: idempotencyKey,
    });

    const result = res.execution_result;

    return {
      operationId: res.operation_id ?? idempotencyKey,
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

    return {
      operationId,
      status: toOperationStatus(res.operation_status),
      swapType: 'BUY',
      tokenAddress: '',
      actualTokenAmountNano: result?.actual_token_amount != null
        ? String(result.actual_token_amount)
        : undefined,
      actualTonAmountNano: result?.actual_ton_amount != null
        ? String(result.actual_ton_amount)
        : undefined,
      failureReason: res.failure_reason ?? undefined,
    };
  }
}
