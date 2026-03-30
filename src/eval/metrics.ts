/**
 * Eval Block (Section XIV).
 * Extended metrics calculated from Agent Kit's own data.
 * Base PnL comes from TractionEye backend (not duplicated here).
 */

import { readReflections } from '../state/reflections.js';
import { readPlaybooks } from '../state/playbooks.js';
import type { EvalMetrics, EvalReport, Baseline, CloseType, ReflectionEntry } from '../types/v2.js';

/**
 * Calculate extended eval metrics from reflection log and playbook stats.
 * @param cooldownPreventedCount - number of re-buys blocked by cooldown
 * @param windowDays - sliding window in days (default: 7). Only trades within this window are counted for alerts and close type histogram.
 */
export function calculateEvalMetrics(
  cooldownPreventedCount: number = 0,
  windowDays: number = 7,
): EvalMetrics {
  const allReflections = readReflections();
  const cutoff = Date.now() - windowDays * 24 * 60 * 60_000;
  const reflections = allReflections.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  const playbooks = readPlaybooks();

  // Close type histogram
  const closeTypeCounts: Partial<Record<CloseType, number>> = {};
  const tradeReflections = reflections.filter((r) => r.type === 'trade_closed' && r.trade);

  for (const r of tradeReflections) {
    if (r.trade?.exitReason) {
      const closeType = r.trade.exitReason as CloseType;
      closeTypeCounts[closeType] = (closeTypeCounts[closeType] ?? 0) + 1;
    }
  }

  // Per-archetype performance
  const archetypeStats: Record<string, { trades: number; winRate: number; avgPnl: number }> = {};
  for (const [name, entry] of Object.entries(playbooks.archetypes)) {
    if (entry.stats.totalTrades > 0) {
      archetypeStats[name] = {
        trades: entry.stats.totalTrades,
        winRate: entry.stats.wins / entry.stats.totalTrades * 100,
        avgPnl: entry.stats.avgPnlPercent,
      };
    }
  }

  // Profit factor
  let totalProfit = 0;
  let totalLoss = 0;
  for (const r of tradeReflections) {
    const pnl = r.trade?.pnlPercent ?? 0;
    if (pnl > 0) totalProfit += pnl;
    else totalLoss += Math.abs(pnl);
  }
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  // Thesis quality
  const thesisExits = tradeReflections.filter((r) => r.trade?.exitReason === 'thesis_exit');
  const thesisExitRate = tradeReflections.length > 0
    ? (thesisExits.length / tradeReflections.length) * 100
    : 0;
  const thesisExitPnl = thesisExits.length > 0
    ? thesisExits.reduce((sum, r) => sum + (r.trade?.pnlPercent ?? 0), 0) / thesisExits.length
    : 0;

  // Average hold duration
  let totalHoldMs = 0;
  let holdCount = 0;
  for (const r of tradeReflections) {
    if (r.trade?.holdDuration) {
      const match = r.trade.holdDuration.match(/(\d+)h/);
      if (match) {
        totalHoldMs += parseInt(match[1]) * 3_600_000;
        holdCount++;
      }
    }
  }
  const avgHoldMs = holdCount > 0 ? totalHoldMs / holdCount : 0;
  const avgHoldDuration = avgHoldMs > 0
    ? `${Math.floor(avgHoldMs / 3_600_000)}h ${Math.floor((avgHoldMs % 3_600_000) / 60_000)}m`
    : 'N/A';

  // Verify/reject accuracy (requires post-hoc tracking — placeholder for now)
  const verifyAccuracy = 0;
  const rejectAccuracy = 0;
  const washDetectionRate = 0;

  return {
    verifyAccuracy,
    rejectAccuracy,
    washDetectionRate,
    closeTypeCounts,
    archetypeStats,
    profitFactor,
    avgVerifyLatencyMs: 0,
    apiErrorRate: 0,
    geckoUsagePercent: 0,
    dexUsagePercent: 0,
    thesisExitRate,
    thesisExitPnl,
    avgHoldDuration,
    cooldownPreventedCount,
  };
}

/**
 * Generate eval report comparing current metrics to baseline.
 */
export function generateEvalReport(
  baseline: Baseline,
  cooldownPreventedCount: number = 0,
): EvalReport {
  const current = calculateEvalMetrics(cooldownPreventedCount);
  const now = new Date().toISOString();

  const comparisons: EvalReport['comparison'] = [];

  const addComparison = (metric: string, currentVal: number, baselineVal: number | null) => {
    let trend: 'improving' | 'stable' | 'degrading' | 'no_baseline' = 'no_baseline';
    let delta: number | null = null;

    if (baselineVal != null) {
      delta = currentVal - baselineVal;
      if (Math.abs(delta) < 1) trend = 'stable';
      else if (delta > 0) trend = 'improving';
      else trend = 'degrading';
    }

    comparisons.push({ metric, current: currentVal, baseline: baselineVal, delta, trend });
  };

  addComparison('profitFactor', current.profitFactor, null);
  addComparison('thesisExitRate', current.thesisExitRate, null);
  addComparison('cooldownPreventedCount', current.cooldownPreventedCount, null);

  // Alerts
  const alerts: string[] = [];
  const slCount = current.closeTypeCounts['stop_loss'] ?? 0;
  const totalCloses = Object.values(current.closeTypeCounts).reduce((s, v) => s + (v ?? 0), 0);
  if (totalCloses > 5 && slCount / totalCloses > 0.8) {
    alerts.push('WARNING: 80%+ of closes are stop losses — strategy may be failing');
  }
  if (current.profitFactor < 1 && totalCloses > 10) {
    alerts.push('WARNING: Profit factor < 1 — losing more than winning');
  }

  return {
    generatedAt: now,
    period: { from: baseline.capturedAt, to: now },
    current,
    baseline,
    comparison: comparisons,
    alerts,
  };
}

/**
 * Capture current performance as baseline (at v2 launch).
 */
export function captureBaseline(
  winRate: number,
  avgPnlPercent: number,
  maxDrawdown: number,
  tradesPerWeek: number,
): Baseline {
  return {
    capturedAt: new Date().toISOString(),
    period: 'v1_final',
    metrics: {
      winRate,
      avgPnlPercent,
      maxDrawdown,
      tradesPerWeek,
    },
  };
}
