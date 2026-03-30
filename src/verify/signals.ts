/**
 * Computed Signals (Section V-A) and Confidence Summary (Section V-B).
 * Derived metrics from raw API data — zero additional API calls.
 */

import type { GeckoPoolInfo, GeckoTokenInfo, ComputedSignals, ConfidenceSummary, OrganicityVerdict } from '../types/v2.js';
import type { PoolInfo } from '../gecko/types.js';

/**
 * Compute derived signals from raw market data.
 * Scout phase: volumeAcceleration + buyPressure only (DexScreener data).
 * Verify phase: adds buyerAcceleration (GeckoTerminal data).
 */
export function computeSignals(
  pool: PoolInfo | null,
  geckoPool: GeckoPoolInfo | null,
): ComputedSignals {
  // volumeAcceleration: volume1h / (volume6h / 6)
  let volumeAcceleration: number | null = null;
  const vol1h = pool?.volume1hUsd ?? geckoPool?.volume.h1 ?? 0;
  const vol6h = pool?.volume6hUsd ?? geckoPool?.volume.h6 ?? 0;
  if (vol6h >= 100) {
    volumeAcceleration = vol1h / (vol6h / 6);
  }

  // buyPressure: buys1h / (buys1h + sells1h)
  let buyPressure: number | null = null;
  const buys1h = pool?.buys1h ?? geckoPool?.transactions.h1.buys ?? 0;
  const sells1h = pool?.sells1h ?? geckoPool?.transactions.h1.sells ?? 0;
  if (buys1h + sells1h >= 10) {
    buyPressure = buys1h / (buys1h + sells1h);
  }

  // buyerAcceleration: uniqueBuyers1h / (uniqueBuyers6h / 6)
  // Only from GeckoTerminal (DexScreener has no unique buyers)
  let buyerAcceleration: number | null = null;
  if (geckoPool) {
    const buyers1h = geckoPool.transactions.h1.buyers;
    const buyers6h = geckoPool.transactions.h6.buyers;
    if (buyers6h >= 6) {
      buyerAcceleration = buyers1h / (buyers6h / 6);
    }
  }

  return { volumeAcceleration, buyPressure, buyerAcceleration };
}

/**
 * Build confidence summary from all verification data.
 * Informational only — NOT a gate or position size multiplier.
 */
export function buildConfidence(
  tokenInfo: GeckoTokenInfo | null,
  geckoPool: GeckoPoolInfo | null,
  signals: ComputedSignals,
  organicity: OrganicityVerdict,
): ConfidenceSummary {
  const confirming: string[] = [];
  const contradicting: string[] = [];

  // Organicity
  if (organicity.verdict === 'organic') confirming.push('organic buyers');
  else if (organicity.verdict === 'suspicious') contradicting.push('suspicious trading activity');
  else contradicting.push('wash trading detected');

  // Volume acceleration
  if (signals.volumeAcceleration != null) {
    if (signals.volumeAcceleration > 2.0) confirming.push('volume accelerating');
    else if (signals.volumeAcceleration < 0.5) contradicting.push('volume decelerating');
  }

  // Buy pressure
  if (signals.buyPressure != null) {
    if (signals.buyPressure > 0.6) confirming.push('strong buy pressure');
    else if (signals.buyPressure < 0.4) contradicting.push('sell pressure dominant');
  }

  // Buyer acceleration
  if (signals.buyerAcceleration != null) {
    if (signals.buyerAcceleration > 1.5) confirming.push('new buyers accelerating');
    else if (signals.buyerAcceleration < 0.5) contradicting.push('buyer interest fading');
  }

  // GT score
  if (tokenInfo?.gtScore != null) {
    if (tokenInfo.gtScore > 50) confirming.push(`gt_score ${tokenInfo.gtScore.toFixed(0)} > 50`);
    else if (tokenInfo.gtScore < 30) contradicting.push(`gt_score ${tokenInfo.gtScore.toFixed(0)} < 30`);
  }

  // Holders
  if (tokenInfo?.holders) {
    if (tokenInfo.holders.count >= 500) confirming.push(`${tokenInfo.holders.count} holders`);
    else if (tokenInfo.holders.count < 100) contradicting.push(`only ${tokenInfo.holders.count} holders`);

    if (tokenInfo.holders.distributionPercentage.top10 < 40) confirming.push('well-distributed holdings');
    else if (tokenInfo.holders.distributionPercentage.top10 > 60) contradicting.push('concentrated holdings');
  }

  // Locked liquidity
  if (geckoPool?.lockedLiquidityPercentage != null && geckoPool.lockedLiquidityPercentage > 50) {
    confirming.push('locked liquidity > 50%');
  } else if (geckoPool?.lockedLiquidityPercentage == null) {
    contradicting.push('no locked liquidity data');
  }

  // Score: 0-100
  const total = confirming.length + contradicting.length;
  const score = total > 0 ? Math.round((confirming.length / total) * 100) : 50;

  return {
    score,
    confirmingSignals: confirming,
    contradictingSignals: contradicting,
  };
}
