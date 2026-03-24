#!/usr/bin/env node
/**
 * Post-install setup for TractionEye Agent Daemon.
 * Creates ~/.tractioneye/ directory, config.json with defaults,
 * and copies the skill file into the OpenClaw agent workspace.
 */

const { mkdirSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { execSync } = require('node:child_process');

const DATA_DIR = process.env.TRACTIONEYE_DATA_DIR || join(homedir(), '.tractioneye');
const CONFIG_PATH = join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  agentToken: '',
  sessionId: '',
  openclawPath: 'openclaw',
  tpSl: {
    defaults: {
      takeProfitPercent: 25,
      stopLossPercent: 8,
    },
  },
  screening: {
    intervalMs: 180000,
    filter: {
      minLiquidityUsd: 20000,
      minVolume24hUsd: 10000,
    },
  },
};

// Create data directory
mkdirSync(DATA_DIR, { recursive: true });
console.log(`[setup] Data directory: ${DATA_DIR}`);

// Create config if it doesn't exist
if (!existsSync(CONFIG_PATH)) {
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf-8');
  console.log(`[setup] Created default config: ${CONFIG_PATH}`);
} else {
  console.log(`[setup] Config already exists: ${CONFIG_PATH}`);
}

// Check for pm2
let hasPm2 = false;
try {
  execSync('pm2 --version', { stdio: 'ignore' });
  hasPm2 = true;
} catch {
  // pm2 not installed
}

console.log('');
console.log('=== TractionEye Agent SDK Setup ===');
console.log('');
console.log(`1. Set your agentToken in ${CONFIG_PATH}`);
console.log('2. Start the daemon:');
if (hasPm2) {
  console.log('   npm run daemon:start');
  console.log('');
  console.log('   To persist across reboots:');
  console.log('   pm2 save && pm2 startup');
} else {
  console.log('   npm run daemon');
  console.log('');
  console.log('   For persistent background running, install pm2:');
  console.log('   npm install -g pm2');
  console.log('   npm run daemon:start');
}
console.log('');
