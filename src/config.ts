import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default data directory for TractionEye config and briefing files. */
export const DEFAULT_DATA_DIR =
  process.env['TRACTIONEYE_DATA_DIR'] ?? join(homedir(), '.tractioneye');

/** Path to the unified config file. */
export function configPath(): string {
  return join(DEFAULT_DATA_DIR, 'config.json');
}

/** Path to the briefing file written by the daemon. */
export function briefingPath(): string {
  return join(DEFAULT_DATA_DIR, 'briefing.json');
}

export type TpSlDefaults = {
  takeProfitPercent: number;
  stopLossPercent: number;
  partialTakeProfitPercent?: number;
  partialTakeProfitSellPercent?: number;
};

export type TpSlConfig = {
  defaults: TpSlDefaults;
  perToken?: Record<string, Partial<TpSlDefaults>>;
};

export type ScreeningFilterConfig = {
  [key: string]: unknown;
};

export type DaemonConfig = {
  agentToken?: string;
  sessionId?: string;
  openclawPath?: string;
  tpSl?: TpSlConfig;
  screening?: {
    intervalMs?: number;
    filter?: ScreeningFilterConfig;
  };
};

/** Ensure data directory exists. */
export function ensureDataDir(): void {
  mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
}

/** Read the config file. Returns empty config if file doesn't exist. */
export function readConfig(): DaemonConfig {
  try {
    const raw = readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw) as DaemonConfig;
  } catch {
    return {};
  }
}

/** Write the config file (full replace). */
export function writeConfig(config: DaemonConfig): void {
  ensureDataDir();
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Merge partial updates into the existing config and write. */
export function updateConfig(patch: Partial<DaemonConfig>): DaemonConfig {
  const config = { ...readConfig(), ...patch };
  writeConfig(config);
  return config;
}

/** Read the briefing file. Returns null if not found. */
export function readBriefing(): unknown {
  try {
    const raw = readFileSync(briefingPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
