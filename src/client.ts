import { randomUUID } from 'node:crypto';
import { TractionEyeHttpClient } from './http/client.js';
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

// Native TON address used in Ston.fi swap API
const TON_NATIVE_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

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

type SimulateSwapResponse = {
  success: boolean;
  offer_units?: string;
  ask_units?: string;
  min_ask_units?: string;
  price_impact?: string;
  swap_rate?: string;
  validation_outcome?: string;
  low_balance_state?: boolean;
};

type ExecuteSwapResponse = {
  success: boolean;
  swap_type?: string;
  deal_id?: number;
  tx_hash?: string;
  swap_status?: string;
  expected_token_amount?: string;
  expected_ton_amount?: string;
};

type SwapStatusResponse = {
  status: string;
  swap_type?: string;
  token_address?: string;
  expected_token_amount?: string;
  expected_ton_amount?: string;
  actual_token_amount?: string;
  actual_ton_amount?: string;
  failure_reason?: string;
  error_code?: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function toBuyAddresses(tokenAddress: string) {
  return { offeraddress: TON_NATIVE_ADDRESS, askaddress: tokenAddress };
}

function toSellAddresses(tokenAddress: string) {
  return { offeraddress: tokenAddress, askaddress: TON_NATIVE_ADDRESS };
}

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

function toSwapType(raw?: string): TradeAction {
  return raw?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
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

  async getAvailableTokens(): Promise<AvailableToken[]> {
    logMethodCall('getAvailableTokens');
    const pageSize = 200;
    let offset = 0;
    const tokens: AvailableToken[] = [];

    while (true) {
      const r = await this.http.get<StonfiAssetsResponse>(
        `/stonfi/assets?limit=${pageSize}&offset=${offset}`,
      );
      const page = r.asset_list.map((a) => ({
        address: a.contract_address,
        symbol: a.symbol,
        decimals: a.decimals,
      }));
      tokens.push(...page);
      if (page.length < pageSize) return tokens;
      offset += pageSize;
    }
  }

  // ── Trade methods ─────────────────────────────────────────────────────────

  async previewTrade(req: TradePreviewRequest): Promise<TradePreview> {
    logMethodCall('previewTrade', { action: req.action, tokenAddress: req.tokenAddress });

    const addresses =
      req.action === 'BUY' ? toBuyAddresses(req.tokenAddress) : toSellAddresses(req.tokenAddress);

    const res = await this.http.post<SimulateSwapResponse>(
      `/strategy/${this.strategyId}/swap/simulate`,
      {
        offeraddress: addresses.offeraddress,
        askaddress: addresses.askaddress,
        offeramount: req.amountNano,
      },
    );

    return {
      action: req.action,
      tokenAddress: req.tokenAddress,
      amountNano: req.amountNano,
      estimatedReceiveNano: res.ask_units ?? '0',
      minReceiveNano: res.min_ask_units ?? '0',
      priceImpactPercent: parseFloat(res.price_impact ?? '0'),
      swapRate: res.swap_rate ?? '0',
      validationOutcome: toValidationOutcome(res.validation_outcome),
      lowBalanceState: res.low_balance_state ?? false,
    };
  }

  async executeTrade(req: TradeExecutionRequest): Promise<TradeExecution> {
    logMethodCall('executeTrade', { action: req.action, tokenAddress: req.tokenAddress });

    const addresses =
      req.action === 'BUY' ? toBuyAddresses(req.tokenAddress) : toSellAddresses(req.tokenAddress);

    const idempotencyKey = randomUUID();

    const res = await this.http.post<ExecuteSwapResponse>(
      `/strategy/${this.strategyId}/swap/execute`,
      {
        offeraddress: addresses.offeraddress,
        askaddress: addresses.askaddress,
        offeramount: req.amountNano,
        slippagetolerance: req.slippageTolerance ?? 0.01,
        idempotency_key: idempotencyKey,
      },
    );

    const operationId = res.deal_id != null ? String(res.deal_id) : idempotencyKey;

    return {
      operationId,
      initialStatus: 'pending',
      swapType: req.action,
      tokenAddress: req.tokenAddress,
      expectedTokenAmountNano: res.expected_token_amount,
      expectedTonAmountNano: res.expected_ton_amount,
    };
  }

  async getOperationStatus(operationId: string): Promise<OperationStatus> {
    logMethodCall('getOperationStatus', { operationId });

    const res = await this.http.get<SwapStatusResponse>(
      `/strategy/${this.strategyId}/swap/status/${operationId}`,
    );

    return {
      operationId,
      status: toOperationStatus(res.status),
      swapType: toSwapType(res.swap_type),
      tokenAddress: res.token_address ?? '',
      expectedTokenAmountNano: res.expected_token_amount,
      expectedTonAmountNano: res.expected_ton_amount,
      actualTokenAmountNano: res.actual_token_amount,
      actualTonAmountNano: res.actual_ton_amount,
      failureReason: res.failure_reason,
      errorCode: res.error_code,
    };
  }
}
