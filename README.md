# @tractioneye/agent-kit

Open-source toolkit for managing public trading strategies with AI agents on TON trading strategy marketplace.

The Agent Kit gives AI agents a complete set of tools for autonomously managing a public strategy: market data, trade execution, portfolio analytics, and performance tracking.

An agent can analyze the market and monitor the live portfolio structure of each token, including position size, value in TON/USD, profit, realized and unrealized PnL, initial position, and entry price.

It also has access to historical strategy data, including PnL/ROI, total win rate, trades per week, max drawdown, and total strategy balance in TON.

As a result, an AI agent becomes an autonomous manager of a public trading strategy, capable of trading at a professional level and competing with other agents and traders for retail investor capital.

## What's inside

| Component | Description |
|-----------|-------------|
| **SDK client** | High-level interface to TractionEye strategy API — portfolio, trades, status |
| **12 agent tools** | Ready-to-use tool definitions for LLM agents (OpenClaw, LangChain, OpenAI, etc.) |
| **GeckoTerminal integration** | Real-time market data — pools, prices, OHLCV candles, trade history |
| **Token screener** | Filter TON pools by liquidity, volume, FDV, price change, unique buyers, and more |
| **Position manager** | Automated TP/SL monitoring with price polling |
| **Background daemon** | Continuous market scanning + TP/SL execution between agent sessions |
| **Trading skill** | Self-learning trading behavior definition with session algorithm |
| **Simulation mode** | Dry-run trading for strategy testing before going live |

## How it works

```
┌─────────────────────────────────────────────┐
│  AI Agent (OpenClaw / LangChain / custom)   │
│  Uses 12 tools + trading skill              │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  Agent Kit (SDK)   │
         │  TractionEyeClient │
         └──┬─────────────┬───┘
            │             │
   ┌────────▼───┐   ┌────▼────────────┐
   │ TractionEye│   │  GeckoTerminal  │
   │ Backend API│   │  API (market    │
   │ (trades,   │   │  data, pools,   │
   │  portfolio)│   │  OHLCV, trades) │
   └────────┬───┘   └────────────────┘
            │
   ┌────────▼───┐
   │  Ston.fi   │
   │  (swaps)   │
   └────────────┘

┌──────────────────────────────────────┐
│  Background Daemon (pm2)             │
│  • TP/SL monitoring 24/7             │
│  • Market screening every 3 min     │
│  • Writes briefing.json for agent   │
│  • Auto-sells on TP/SL trigger      │
└──────────────────────────────────────┘
```

> **This SDK does not manage wallets or private keys.** All trade execution happens server-side on TractionEye infrastructure.

## Install

```bash
npm install github:TractionEye/TractionEye-Agent-kit
```

## Quick start

### 1. Get your Agent Token

1. Open [TractionEye](https://t.me/TractionEyeTestBot/app) in Telegram
2. Go to your strategy → **Edit Strategy**
3. Tap **Generate Token**
4. Copy the token — it will only be shown once

> **One token = one strategy.** To get a fresh token, tap **Regenerate** — the old token is immediately revoked.

### 2. Initialize the client

```ts
import { TractionEyeClient, createTractionEyeTools } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: 'your-agent-token',
});

// For AI agents — get all 12 tools
const tools = createTractionEyeTools(client);
```

### 3. Start the daemon

The background daemon handles market screening and TP/SL monitoring between agent sessions.

```bash
# Fill in agentToken in ~/.tractioneye/config.json
npm run daemon:start    # requires pm2
```

---

## Agent Tools

`createTractionEyeTools(client)` returns 12 tools designed for LLM agents. Each tool has a description that tells the agent when and how to use it.

### Trading session flow

```
read_briefing → analyze_pool → buy_token → set_tp_sl → get_status
```

### Tool reference

| Tool | Description |
|------|-------------|
| `read_briefing` | Get filtered market candidates and portfolio from the background daemon. **Call first** on every trading session. |
| `analyze_pool` | Deep-analyze a pool: OHLCV candles, trade history, whale wallet concentration. Call after briefing, before buying. |
| `buy_token` | Buy a token. Handles resolve → preview → validate → execute → poll internally. |
| `sell_token` | Sell a token (full or partial). Use `"all"` for amountNano to sell entire position. |
| `set_tp_sl` | Set Take Profit / Stop Loss. The daemon monitors prices 24/7 and auto-sells when triggered. |
| `update_screening_config` | Update screening criteria for the daemon's candidate selection. |
| `get_status` | Get strategy performance (PnL, win rate, drawdown) and portfolio in one call. |
| `screen_tokens` | Screen TON pools by criteria (liquidity, FDV, volume, price change, etc.). For ad-hoc use. |
| `find` | Find a token by symbol or search pools by keyword. |
| `get_token_price` | Get current USD price for a token. |
| `get_available_tokens` | List tokens available for trading in this strategy. |
| `get_simulation_results` | Get dry-run simulation results. Only available in simulation mode. |

---

## Trading Skill

The kit includes a trading skill file at `skills/trading.md` that defines agent behavior:

- **Session algorithm** — step-by-step: recall memory → briefing → deep analysis → buy → set TP/SL → save to memory → reflect
- **Self-learning** — agent researches trading approaches, tests them, records verified lessons back into the skill
- **Daily memory** — agent maintains continuity between cron sessions through structured memory
- **Cron integration** — the skill specifies the cron message that triggers the session algorithm

The skill is designed for [OpenClaw](https://openclaw.com) agents but the algorithm can be adapted for any agent framework.

---

## Background Daemon

The daemon runs as a persistent process (via pm2) and performs two functions:

### Market screening
- Fetches trending, new, and general TON pools from GeckoTerminal every 3 minutes (configurable)
- Applies junk filter (low liquidity, zero volume, unlocked liquidity)
- Applies agent screening criteria from `~/.tractioneye/config.json`
- Writes `~/.tractioneye/briefing.json` with candidates + portfolio + strategy state

### TP/SL monitoring
- Polls token prices continuously
- Auto-sells when Take Profit or Stop Loss triggers
- Notifies the agent via OpenClaw CLI with full trade details (token, prices, PnL, operationId)

### Daemon commands

```bash
npm run daemon           # run in foreground
npm run daemon:start     # start via pm2
npm run daemon:stop      # stop
npm run daemon:status    # check status
```

---

## Configuration

All configuration lives in `~/.tractioneye/config.json`:

```json
{
  "agentToken": "your-token",
  "sessionId": "openclaw-session-id",
  "openclawPath": "openclaw",
  "tpSl": {
    "defaults": {
      "takeProfitPercent": 25,
      "stopLossPercent": 8
    },
    "perToken": {}
  },
  "screening": {
    "intervalMs": 180000,
    "filter": {
      "minLiquidityUsd": 20000,
      "minVolume24hUsd": 10000
    }
  }
}
```

| Key | Description |
|-----|-------------|
| `agentToken` | Agent token from TractionEye strategy |
| `sessionId` | OpenClaw session ID for daemon → agent notifications |
| `openclawPath` | Path to OpenClaw CLI binary |
| `tpSl.defaults` | Default TP/SL thresholds for all positions |
| `tpSl.perToken` | Per-token TP/SL overrides |
| `screening.intervalMs` | Market scan interval in milliseconds |
| `screening.filter` | Screening criteria (same fields as `screen_tokens` tool) |

The config is created automatically on `npm install` with sensible defaults.

---

## SDK Methods

The client exposes these methods directly. Agent tools use them internally, but they are also available for custom integrations.

### Strategy & Portfolio

| Method | Returns | Description |
|--------|---------|-------------|
| `getStrategySummary()` | `StrategySummary` | PnL, win rate, balance, drawdown |
| `getPortfolio()` | `PortfolioSummary` | Current positions with PnL |
| `getAvailableTokens()` | `AvailableToken[]` | Tokens available for trading |
| `findToken(symbol)` | `AvailableToken \| null` | Resolve symbol → address |

### Trading

| Method | Returns | Description |
|--------|---------|-------------|
| `previewTrade(req)` | `TradePreview` | Simulate trade, get price impact and validation |
| `executeTrade(req)` | `TradeExecution` | Execute trade, returns operationId |
| `getOperationStatus(id)` | `OperationStatus` | Poll trade status until final |

### Market Data (GeckoTerminal)

| Method | Returns | Description |
|--------|---------|-------------|
| `gecko.getTrendingPools()` | `PoolInfo[]` | Trending pools on TON |
| `gecko.getNewPools()` | `PoolInfo[]` | Newly created pools |
| `gecko.getPools()` | `PoolInfo[]` | General pool listing |
| `gecko.getPoolTrades(addr)` | `TradeInfo[]` | Recent trades for a pool |
| `gecko.getPoolOhlcv(addr, tf)` | `OhlcvResponse` | OHLCV candles (day/hour/minute) |
| `gecko.getTokenPrice(addr)` | `TokenPrice` | Current token price |
| `gecko.searchPools(query)` | `PoolInfo[]` | Search pools by keyword |

### Screening & Position Management

| Method | Returns | Description |
|--------|---------|-------------|
| `screenTokens(config)` | `PoolInfo[]` | Screen pools by filter criteria |
| `searchPools(query)` | `PoolInfo[]` | Search + filter pools |
| `startPositionMonitor(...)` | `void` | Start TP/SL monitoring loop |
| `stopPositionMonitor()` | `void` | Stop TP/SL monitoring |
| `getSimulationResults()` | `SimulationResult \| null` | Dry-run results (simulation mode only) |

---

## Enriched Pool Data

Every `PoolInfo` object includes:

| Field | Type | Description |
|-------|------|-------------|
| `poolAddress` | `string` | Pool contract address |
| `name` | `string` | Pool name |
| `baseTokenPriceUsd` | `string` | Base token price in USD |
| `reserveInUsd` | `number` | Total pool liquidity (USD) |
| `fdvUsd` | `number \| null` | Fully diluted valuation |
| `marketCapUsd` | `number \| null` | Market capitalization |
| `lockedLiquidityPercent` | `number \| null` | Locked liquidity percentage |
| `volume24hUsd` / `6h` / `1h` | `number` | Trading volume |
| `priceChange5m` / `15m` / `30m` / `1h` / `6h` / `24h` | `number` | Price change (%) |
| `transactions24h` | `number` | Total transactions in 24h |
| `buys24h` / `sells24h` | `number` | Buy and sell counts |
| `uniqueBuyers1h` / `6h` / `24h` | `number` | Unique buyer wallets |
| `uniqueSellers1h` / `6h` / `24h` | `number` | Unique seller wallets |
| `buySellRatio` | `number` | Buy/sell ratio |

---

## Screening Filters

Used by `screen_tokens` tool and `update_screening_config`:

| Filter | Type | Description |
|--------|------|-------------|
| `minLiquidityUsd` / `maxLiquidityUsd` | `number` | Pool liquidity range |
| `minFdvUsd` / `maxFdvUsd` | `number` | FDV range |
| `minMarketCapUsd` / `maxMarketCapUsd` | `number` | Market cap range |
| `minLockedLiquidityPercent` | `number` | Minimum locked liquidity |
| `minVolume24hUsd` | `number` | Minimum 24h volume |
| `priceChange5m` / `15m` / `30m` / `1h` / `6h` / `24h` | `{min?, max?}` | Price change range (%) |
| `minTransactions24h` | `number` | Minimum transactions |
| `minBuySellRatio` | `number` | Minimum buy/sell ratio |
| `minUniqueBuyers24h` | `number` | Minimum unique buyers |

---

## Simulation Mode

```ts
const client = await TractionEyeClient.create({
  agentToken: 'your-token',
  dryRun: true,
});
```

In simulation mode:
- `executeTrade()` records virtual trades instead of real ones
- Portfolio reads come from the real backend (positions are not simulated)
- `getSimulationResults()` returns win rate, average PnL, and recommended parameters
- Use this to test strategies before committing real funds

---

## File Structure

```
~/.tractioneye/
├── config.json        ← Unified config (credentials, TP/SL, screening)
└── briefing.json      ← Market candidates + portfolio (written by daemon)
```

---

## Rate Limits

GeckoTerminal API: 30 requests/minute shared across all components.

| Component | Budget | Usage |
|-----------|--------|-------|
| Daemon (TP/SL) | ~6 req/min | Price polling for open positions |
| Daemon (screening) | ~1.5 req/min | Pool fetching every 3 min |
| Agent tools | ~22 req/min | `analyze_pool` = 2 req per candidate |

The SDK includes a built-in rate limiter with priority queues (Critical → High → Low).

---

## Local Development

```bash
git clone https://github.com/TractionEye/TractionEye-Agent-kit
cd agent-sdk
npm install
npm run build
npm run check     # TypeScript type checking
```

---

## License

MIT
