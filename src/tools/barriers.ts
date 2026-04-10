import type { TripleBarrierConfig, RiskPolicy } from '../types/v2.js';
import type { DaemonConfig } from '../config.js';

/**
 * Resolves the effective TripleBarrierConfig for a token using the priority chain:
 *   defaultBarriers (base) → perToken config → customBarriers (LLM override, highest priority).
 *
 * Handles the type bridge between TpSlDefaults flat fields
 * (partialTakeProfitPercent / partialTakeProfitSellPercent) and
 * TripleBarrierConfig nested partialTp (triggerPercent / sellPercent).
 */
export function resolveBarriers(
  tokenAddress: string,
  customBarriers: TripleBarrierConfig | undefined,
  config: DaemonConfig,
  riskPolicy: RiskPolicy,
): TripleBarrierConfig {
  const base: TripleBarrierConfig = { ...riskPolicy.defaultBarriers };

  // Layer 2: perToken config (set via set_tp_sl)
  const perToken = config.tpSl?.perToken?.[tokenAddress];
  if (perToken) {
    if (perToken.takeProfitPercent != null) base.takeProfitPercent = perToken.takeProfitPercent;
    if (perToken.stopLossPercent != null) base.stopLossPercent = perToken.stopLossPercent;
    if (
      perToken.partialTakeProfitPercent != null &&
      perToken.partialTakeProfitSellPercent != null
    ) {
      base.partialTp = {
        triggerPercent: perToken.partialTakeProfitPercent,
        sellPercent: perToken.partialTakeProfitSellPercent,
      };
    }
  }

  // Layer 3: explicit LLM override (highest priority)
  if (customBarriers) return customBarriers;

  return base;
}
