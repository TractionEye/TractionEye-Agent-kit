/**
 * playbooks.json management (Section IX, 10.4).
 * DEX-specific playbooks with barrier defaults per archetype.
 */

import { readFileSync } from 'node:fs';
import { playbooksPath } from '../config.js';
import { atomicWriteJsonSync } from './atomic.js';
import type { Playbooks, PlaybookEntry, DexDefaults } from '../types/v2.js';

/** Default DEX-specific configurations (Section IX). */
export const DEX_DEFAULTS: Record<string, DexDefaults> = {
  ston_fi: {
    entryThresholds: {
      minBuyerDiversityRatio: 0.2,
      minVolume1hUsd: 3000,
      minLiquidityUsd: 2000,
    },
    sizing: { maxPositionSizePercent: 15 },
    exits: {
      takeProfitPercent: 25,
      stopLossPercent: 10,
      timeLimitSeconds: 7200,
      trailingStop: { activationPercent: 15, deltaPercent: 5 },
      thesisReviewInterval: 'PT10M',
    },
  },
  dedust: {
    entryThresholds: {
      minBuyerDiversityRatio: 0.3,
      minVolume1hUsd: 2000,
      minLiquidityUsd: 1500,
    },
    sizing: { maxPositionSizePercent: 12 },
    exits: {
      takeProfitPercent: 20,
      stopLossPercent: 12,
      timeLimitSeconds: 5400,
      trailingStop: { activationPercent: 10, deltaPercent: 4 },
      thesisReviewInterval: 'PT8M',
    },
  },
};

/** Initial playbooks with base archetypes. */
function defaultPlaybooks(): Playbooks {
  const now = new Date().toISOString();
  const defaultStats = { totalTrades: 0, wins: 0, losses: 0, avgPnlPercent: 0, lastUpdated: now };

  return {
    updatedAt: now,
    version: 1,
    archetypes: {
      organic_breakout: {
        name: 'organic_breakout',
        description: 'Genuine buying interest with accelerating volume and diverse buyers',
        signals: [
          { field: 'buyPressure', condition: '>', threshold: 0.6 },
          { field: 'volumeAcceleration', condition: '>', threshold: 1.5 },
          { field: 'buyerAcceleration', condition: '>', threshold: 1.2 },
        ],
        params: {
          entryThresholds: { minBuyerDiversity: 0.25, minVolume1h: 3000, minGtScore: 30 },
          sizing: { positionSizePercent: 10, maxPerToken: 15 },
          exits: {
            takeProfitPercent: 30,
            stopLossPercent: 10,
            timeLimitSeconds: 7200,
            trailingStop: { activationPercent: 15, deltaPercent: 5 },
            thesisHalfLife: 'PT30M',
          },
        },
        stats: defaultStats,
      },
      paid_attention: {
        name: 'paid_attention',
        description: 'Token with paid boosts — traffic fades fast, tighter exits',
        signals: [
          { field: 'boostTotalAmount', condition: '>', threshold: 0 },
          { field: 'volume1hUsd', condition: '>', threshold: 2000 },
        ],
        params: {
          entryThresholds: { minBuyerDiversity: 0.2, minVolume1h: 2000, minGtScore: null },
          sizing: { positionSizePercent: 8, maxPerToken: 12 },
          exits: {
            takeProfitPercent: 15,
            stopLossPercent: 8,
            timeLimitSeconds: 3600,
            trailingStop: { activationPercent: 10, deltaPercent: 4 },
            thesisHalfLife: 'PT15M',
          },
        },
        stats: defaultStats,
      },
      cto_momentum: {
        name: 'cto_momentum',
        description: 'Community takeover with momentum — higher risk, reduced size',
        signals: [
          { field: 'cto', condition: '===', threshold: true },
          { field: 'buyPressure', condition: '>', threshold: 0.55 },
        ],
        params: {
          entryThresholds: { minBuyerDiversity: 0.2, minVolume1h: 1500, minGtScore: null },
          sizing: { positionSizePercent: 6, maxPerToken: 10 },
          exits: {
            takeProfitPercent: 20,
            stopLossPercent: 12,
            timeLimitSeconds: 5400,
            trailingStop: { activationPercent: 12, deltaPercent: 5 },
            thesisHalfLife: 'PT20M',
          },
        },
        stats: defaultStats,
      },
    },
  };
}

/** Read playbooks. Returns defaults if file doesn't exist. */
export function readPlaybooks(): Playbooks {
  try {
    const raw = readFileSync(playbooksPath(), 'utf-8');
    return JSON.parse(raw) as Playbooks;
  } catch {
    return defaultPlaybooks();
  }
}

/** Write playbooks atomically. */
export function writePlaybooks(playbooks: Playbooks): void {
  playbooks.updatedAt = new Date().toISOString();
  playbooks.version++;
  atomicWriteJsonSync(playbooksPath(), playbooks);
}

/** Update stats for a specific archetype after a trade closes. */
export function updateArchetypeStats(
  playbooks: Playbooks,
  archetype: string,
  pnlPercent: number,
): boolean {
  const entry = playbooks.archetypes[archetype];
  if (!entry) return false;

  entry.stats.totalTrades++;
  if (pnlPercent > 0) entry.stats.wins++;
  else entry.stats.losses++;

  // Running average
  const total = entry.stats.totalTrades;
  entry.stats.avgPnlPercent =
    ((entry.stats.avgPnlPercent * (total - 1)) + pnlPercent) / total;
  entry.stats.lastUpdated = new Date().toISOString();

  return true;
}
