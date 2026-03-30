/**
 * reflection_log.jsonl management (Section 10.5).
 * Append-only log of agent reflections, lessons, and trade reviews.
 */

import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { reflectionLogPath, ensureStateDir } from '../config.js';
import type { ReflectionEntry } from '../types/v2.js';

/** Append a reflection entry to the log. */
export function appendReflection(entry: ReflectionEntry): void {
  ensureStateDir();
  appendFileSync(reflectionLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read all reflection entries. Returns empty array if file doesn't exist. */
export function readReflections(): ReflectionEntry[] {
  try {
    const raw = readFileSync(reflectionLogPath(), 'utf-8');
    return raw
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ReflectionEntry);
  } catch {
    return [];
  }
}

/** Read reflections within a time range. */
export function readReflectionsInRange(from: Date, to: Date): ReflectionEntry[] {
  const entries = readReflections();
  return entries.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return ts >= from.getTime() && ts <= to.getTime();
  });
}

/**
 * Archive old entries. Keeps entries from last `keepDays` days in the main file.
 * Older entries are returned (caller should write to archive).
 */
export function archiveOldReflections(keepDays: number): {
  kept: ReflectionEntry[];
  archived: ReflectionEntry[];
} {
  const entries = readReflections();
  const cutoff = Date.now() - keepDays * 24 * 60 * 60_000;

  const kept: ReflectionEntry[] = [];
  const archived: ReflectionEntry[] = [];

  for (const entry of entries) {
    if (new Date(entry.timestamp).getTime() >= cutoff) {
      kept.push(entry);
    } else {
      archived.push(entry);
    }
  }

  // Rewrite main file with only kept entries
  if (archived.length > 0) {
    writeFileSync(
      reflectionLogPath(),
      kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : ''),
      'utf-8',
    );
  }

  return { kept, archived };
}
