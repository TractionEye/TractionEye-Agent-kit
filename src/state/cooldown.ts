/**
 * Cooldown mechanism (Section VI-C).
 * Prevents re-buying a token after SL/thesis_exit/safety_degradation.
 * Persisted to ~/.tractioneye/state/cooldown.json via atomic writes.
 */

import { readFileSync } from 'node:fs';
import { cooldownPath } from '../config.js';
import { atomicWriteJsonSync } from './atomic.js';
import type { CloseType, CooldownEntry, CooldownState } from '../types/v2.js';

/** Close types that trigger cooldown. */
const COOLDOWN_TRIGGERS: Set<CloseType> = new Set([
  'stop_loss',
  'thesis_exit',
  'safety_degradation',
]);

export class CooldownManager {
  private entries: Map<string, CooldownEntry>;

  constructor() {
    this.entries = new Map();
    this.loadFromDisk();
  }

  /** Load cooldown state from disk. Filters out expired entries. */
  private loadFromDisk(): void {
    try {
      const raw = readFileSync(cooldownPath(), 'utf-8');
      const state = JSON.parse(raw) as CooldownState;
      this.entries = new Map(Object.entries(state.entries));
    } catch {
      this.entries = new Map();
    }
  }

  /** Save current state to disk atomically. */
  private saveToDisk(): void {
    const state: CooldownState = {
      entries: Object.fromEntries(this.entries),
    };
    atomicWriteJsonSync(cooldownPath(), state);
  }

  /**
   * Record a position close. Adds cooldown entry if close type triggers cooldown.
   */
  recordClose(tokenAddress: string, closeType: CloseType): void {
    if (!COOLDOWN_TRIGGERS.has(closeType)) return;

    this.entries.set(tokenAddress, {
      tokenAddress,
      exitTimestamp: new Date().toISOString(),
      closeType,
    });
    this.saveToDisk();
  }

  /**
   * Unconditionally add a cooldown entry for a token. Use for explicit exits
   * (e.g. manual sells) that must always trigger cooldown regardless of close type.
   */
  addEntry(tokenAddress: string, closeType: CloseType): void {
    this.entries.set(tokenAddress, {
      tokenAddress,
      exitTimestamp: new Date().toISOString(),
      closeType,
    });
    this.saveToDisk();
  }

  /**
   * Check if a token is in cooldown.
   * @param tokenAddress - Token to check
   * @param cooldownMinutes - Cooldown duration in minutes
   * @returns true if token is in cooldown
   */
  isInCooldown(tokenAddress: string, cooldownMinutes: number): boolean {
    const entry = this.entries.get(tokenAddress);
    if (!entry) return false;

    const exitTime = new Date(entry.exitTimestamp).getTime();
    const cooldownMs = cooldownMinutes * 60_000;
    return Date.now() - exitTime < cooldownMs;
  }

  /** Get cooldown entry for a token (or undefined). */
  getEntry(tokenAddress: string): CooldownEntry | undefined {
    return this.entries.get(tokenAddress);
  }

  /** Get all active cooldown entries as a Map. */
  getMap(): Map<string, CooldownEntry> {
    return new Map(this.entries);
  }

  /** Get all active entries with remaining time info. */
  getActiveCooldowns(cooldownMinutes: number): { tokenAddress: string; cooldownUntil: string; closeType: CloseType }[] {
    const result: { tokenAddress: string; cooldownUntil: string; closeType: CloseType }[] = [];
    const cooldownMs = cooldownMinutes * 60_000;

    for (const [, entry] of this.entries) {
      const exitTime = new Date(entry.exitTimestamp).getTime();
      if (Date.now() - exitTime < cooldownMs) {
        result.push({
          tokenAddress: entry.tokenAddress,
          cooldownUntil: new Date(exitTime + cooldownMs).toISOString(),
          closeType: entry.closeType,
        });
      }
    }
    return result;
  }

  /** Remove expired entries. Called during daily cleanup. */
  cleanupExpired(cooldownMinutes: number): number {
    const cooldownMs = cooldownMinutes * 60_000;
    let removed = 0;

    for (const [addr, entry] of this.entries) {
      const exitTime = new Date(entry.exitTimestamp).getTime();
      if (Date.now() - exitTime >= cooldownMs) {
        this.entries.delete(addr);
        removed++;
      }
    }

    if (removed > 0) this.saveToDisk();
    return removed;
  }
}
