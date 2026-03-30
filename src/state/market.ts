/**
 * market_state.json management (Section 10.1).
 * Replaces briefing.json. During migration Phase 1, daemon writes to BOTH files.
 */

import { readFileSync } from 'node:fs';
import { marketStatePath, briefingPath } from '../config.js';
import { atomicWriteJsonSync } from './atomic.js';
import type { MarketState } from '../types/v2.js';

/** Read market state. Returns null if file doesn't exist. */
export function readMarketState(): MarketState | null {
  try {
    const raw = readFileSync(marketStatePath(), 'utf-8');
    return JSON.parse(raw) as MarketState;
  } catch {
    return null;
  }
}

/**
 * Write market state. Also writes briefing.json in parallel (migration Phase 1).
 * See SPEC-V2.md Section X: briefing.json is NOT removed immediately.
 */
export function writeMarketState(state: MarketState): void {
  atomicWriteJsonSync(marketStatePath(), state);

  // Migration Phase 1: parallel write to briefing.json
  // Converts MarketState back to old briefing format for backward compatibility
  try {
    const briefing = {
      timestamp: state.updatedAt,
      candidates: state.shortlist,
      topLists: state.topLists,
      portfolio: undefined as unknown,
      strategy: undefined as unknown,
    };
    atomicWriteJsonSync(briefingPath(), briefing);
  } catch {
    // Non-critical: briefing.json failure shouldn't break daemon
  }
}
