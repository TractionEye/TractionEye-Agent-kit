/**
 * portfolio_state.json management (Section 10.3).
 * Tracks position thesis, barriers, and exit events.
 */

import { readFileSync } from 'node:fs';
import { portfolioStatePath } from '../config.js';
import { atomicWriteJsonSync } from './atomic.js';
import type { PortfolioState, PositionThesis, TripleBarrierConfig, CloseType } from '../types/v2.js';

/** Read portfolio state. Returns empty state if file doesn't exist. */
export function readPortfolioState(): PortfolioState {
  try {
    const raw = readFileSync(portfolioStatePath(), 'utf-8');
    return JSON.parse(raw) as PortfolioState;
  } catch {
    return { updatedAt: new Date().toISOString(), positions: {} };
  }
}

/** Write portfolio state atomically. */
export function writePortfolioState(state: PortfolioState): void {
  state.updatedAt = new Date().toISOString();
  atomicWriteJsonSync(portfolioStatePath(), state);
}

/** Add a new position to portfolio state. */
export function addPosition(
  state: PortfolioState,
  thesis: PositionThesis,
): void {
  state.positions[thesis.tokenAddress] = thesis;
}

/** Update barriers for an existing position. */
export function updatePositionBarriers(
  state: PortfolioState,
  tokenAddress: string,
  barriers: TripleBarrierConfig,
): boolean {
  const pos = state.positions[tokenAddress];
  if (!pos) return false;
  pos.barriers = barriers;
  return true;
}

/** Update thesis status for a position. */
export function updateThesisStatus(
  state: PortfolioState,
  tokenAddress: string,
  status: 'intact' | 'weakening' | 'broken',
): boolean {
  const pos = state.positions[tokenAddress];
  if (!pos) return false;
  pos.thesisStatus = status;
  pos.lastReviewedAt = new Date().toISOString();
  return true;
}

/** Record an exit event for a position. */
export function recordExitEvent(
  state: PortfolioState,
  tokenAddress: string,
  closeType: CloseType,
  pnlPercent: number,
  soldPercent: number,
  reason: string,
): boolean {
  const pos = state.positions[tokenAddress];
  if (!pos) return false;

  pos.exitEvents.push({
    timestamp: new Date().toISOString(),
    type: closeType,
    pnlPercent,
    soldPercent,
    reason,
  });

  // If fully exited, remove from active positions
  if (soldPercent >= 100) {
    delete state.positions[tokenAddress];
  }

  return true;
}
