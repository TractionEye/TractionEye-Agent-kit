import { TractionEyeHttpClient } from './http/client.js';
import { logMethodCall } from './logger.js';
import type { AvailableToken, PortfolioSummary, StrategySummary, TractionEyeClientConfig } from './types/contracts.js';

const DEFAULT_BASE_URL = 'https://test.tractioneye.xyz/trust_api';

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

export class TractionEyeClient {
  private constructor(
    private readonly http: TractionEyeHttpClient,
    public readonly strategyId: string,
    public readonly strategyName: string,
  ) {}

  static async create(config: TractionEyeClientConfig): Promise<TractionEyeClient> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const http = new TractionEyeHttpClient(baseUrl, config.agentToken);
    const strategy = await http.get<AgentStrategyResponse>('/agent/strategy');

    return new TractionEyeClient(http, String(strategy.strategy_id), strategy.strategy_name);
  }

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
      const r = await this.http.get<StonfiAssetsResponse>(`/stonfi/assets?limit=${pageSize}&offset=${offset}`);
      const page = r.asset_list.map((a) => ({
        address: a.contract_address,
        symbol: a.symbol,
        decimals: a.decimals,
      }));

      tokens.push(...page);

      if (page.length < pageSize) {
        return tokens;
      }

      offset += pageSize;
    }
  }
}
