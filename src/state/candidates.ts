/**
 * candidate_registry.json management (Section 10.2).
 * State machine for candidate lifecycle.
 */

import { readFileSync } from 'node:fs';
import { candidateRegistryPath } from '../config.js';
import { atomicWriteJsonSync } from './atomic.js';
import type { CandidateRegistry, CandidateEntry, CandidateState, VerificationResult } from '../types/v2.js';

/** Read candidate registry. Returns empty registry if file doesn't exist. */
export function readCandidateRegistry(): CandidateRegistry {
  try {
    const raw = readFileSync(candidateRegistryPath(), 'utf-8');
    return JSON.parse(raw) as CandidateRegistry;
  } catch {
    return { candidates: {} };
  }
}

/** Write candidate registry atomically. */
export function writeCandidateRegistry(registry: CandidateRegistry): void {
  atomicWriteJsonSync(candidateRegistryPath(), registry);
}

/** Add or update a candidate entry. */
export function upsertCandidate(
  registry: CandidateRegistry,
  entry: CandidateEntry,
): void {
  registry.candidates[entry.tokenAddress] = entry;
}

/** Transition candidate state. */
export function transitionCandidate(
  registry: CandidateRegistry,
  tokenAddress: string,
  newState: CandidateState,
  extra?: {
    verification?: VerificationResult;
    rejectionReason?: string;
    archetype?: string;
  },
): boolean {
  const candidate = registry.candidates[tokenAddress];
  if (!candidate) return false;

  candidate.state = newState;
  candidate.lastUpdatedAt = new Date().toISOString();

  if (extra?.verification) candidate.verification = extra.verification;
  if (extra?.rejectionReason) candidate.rejectionReason = extra.rejectionReason;
  if (extra?.archetype) candidate.archetype = extra.archetype;

  return true;
}

/**
 * Clean up expired entries.
 * Rejected: TTL 24 hours. Bought: TTL 7 days.
 */
export function cleanupCandidates(registry: CandidateRegistry): number {
  const now = Date.now();
  let removed = 0;

  for (const [addr, entry] of Object.entries(registry.candidates)) {
    const ttl = new Date(entry.ttl).getTime();
    if (now > ttl) {
      delete registry.candidates[addr];
      removed++;
    }
  }

  return removed;
}

/** Create a new candidate entry with standard TTL. */
export function createCandidateEntry(
  tokenAddress: string,
  poolAddress: string,
  symbol: string,
  dexId: string,
  tags: string[],
): CandidateEntry {
  const now = new Date().toISOString();
  // Default TTL: 24 hours for new candidates
  const ttl = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

  return {
    tokenAddress,
    poolAddress,
    symbol,
    dexId,
    state: 'discovered',
    discoveredAt: now,
    lastUpdatedAt: now,
    discoveryTags: tags,
    archetype: null,
    verification: null,
    rejectionReason: null,
    ttl,
  };
}
