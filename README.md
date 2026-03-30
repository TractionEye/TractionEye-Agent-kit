# @tractioneye/agent-kit

**Open-source AI agent toolkit for autonomous trading on TON DEX.**

The Agent Kit gives AI agents everything needed to manage a public trading strategy: market discovery, safety verification, trade execution with atomic position protection, and self-improving performance tracking.

An agent becomes an autonomous strategy manager — analyzing markets, verifying candidates through a safety pipeline, executing trades with triple barrier protection, and reflecting on results to improve over time.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **17 agent tools** | Ready-to-use tool definitions for LLM agents (OpenClaw, LangChain, OpenAI, etc.) |
| **Safety gates** | 10 hard rejects (honeypot, mint/freeze authority, wash trading) + 7 structural penalties. LLM cannot bypass. |
| **Triple barrier** | Position protection: stop loss + take profit + trailing stop + time limit. Set atomically with buy. |
| **Anti-wash detection** | 5 organicity signals detect fake volume before buying |
| **Verify pipeline** | 4-call GeckoTerminal verification: safety, buyers, trades, price structure |
| **Background daemon** | 4 microcycles running 24/7: price sentry, scout, thesis checks |
| **Dual API** | DexScreener (discovery, prices) + GeckoTerminal (verification, safety) with batched requests |
| **State persistence** | 6 state artifacts with atomic writes for crash safety |
| **Cooldown system** | Prevents re-buying tokens after stop loss (breaks loss cycles) |
| **Eval metrics** | Close type histogram, archetype stats, profit factor with 7-day sliding window |
| **Simulation mode** | Dry-run trading for strategy testing before going live |

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │     AI Agent (OpenClaw / LangChain / ...)   │
                    │     Uses 17 tools + trading skill           │
                    └──────────────────┬──────────────────────────┘
                                       │
                              ┌────────▼─────────┐
                              │    Agent Kit     │
                              │ TractionEyeClient│
                              └──┬───────┬────┬──┘
                                 │       │    │
                  ┌──────────────▼──┐ ┌──▼────▼──────────────┐
                  │  DexScreener    │ │  GeckoTerminal       │
                  │  (discovery,    │ │  (verify, safety,    │
                  │   prices,       │ │   OHLCV, trades,     │
                  │   screening)    │ │   unique buyers)     │
                  └─────────────────┘ └──────────────────────┘
                                 │
                       ┌─────────▼──────────┐
                       │  TractionEye       │
                       │  Backend API       │
                       │  (execute trades,  │
                       │   portfolio, PnL)  │
                       └────────────────────┘

   ┌────────────────────────────────────────────────────────────┐
   │  Background Daemon (pm2)                                   │
   │                                                            │
   │  Price Sentry (30s)  — batch prices, triple barrier eval  │
   │  Scout (3min)        — discovery, junk filter, shortlist  │
   │  Thesis Light (60s)  — DexScreener momentum check         │
   │  Thesis Deep (10min) — GeckoTerminal buyer diversity      │
   │  Heartbeat (15min)   — triggers agent deep-think session  │
   │                                                            │
   │  Writes: market_state.json, briefing.json                 │
   │  Monitors: all positions via BarrierManager               │
   │  Protects: auto-sells on SL/TP/trailing/time barrier      │
   └────────────────────────────────────────────────────────────┘
```

> **The Agent Kit does not manage wallets or private keys.** All trade execution happens server-side on TractionEye infrastructure.

---

## Install

```bash
npm install github:TractionEye/TractionEye-Agent-kit
```

---

## Quick Start

### 1. Get your Agent Token

1. Open [TractionEye](https://t.me/TractionEyeTestBot/app) in Telegram
2. Go to your strategy -> **Edit Strategy**
3. Tap **Generate Token**
4. Copy the token (shown only once)

> **One token = one strategy.** Tap **Regenerate** for a new token — the old one is revoked immediately.

### 2. Initialize the client

```ts
import { TractionEyeClient, createTractionEyeTools } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: 'your-agent-token',
});

// Get all 17 tools for your AI agent
const tools = createTractionEyeTools(client);
```

### 3. Start the daemon

```bash
# Set agentToken in ~/.tractioneye/config.json, then:

# Foreground (for debugging):
npm run daemon

# Background (production):
npm run daemon:start    # requires pm2

# Status / stop:
npm run daemon:status
npm run daemon:stop
```

### 4. First trading session

```
read_briefing           → market state, shortlist, regime, cooldowns
  ↓
verify_candidate        → safety + organicity + momentum + confidence
  ↓
buy_token (+ barriers)  → cooldown check → safety gate → execute → barriers registered
  ↓
record_reflection       → append to reflection log
  ↓
get_status              → PnL, win rate, portfolio review
```

---

## Agent Tools

`createTractionEyeTools(client)` returns **17 tools**. Each tool has a description that tells the agent when and how to use it.

### Core tools

| Tool | Description |
|------|-------------|
| `read_briefing` | Market state: shortlisted candidates with computed signals, archetypes, cooldowns, market regime, API usage. **Call first** on every session. |
| `verify_candidate` | Full 4-call verification: token safety (honeypot/mint/freeze), pool health (unique buyers), trade flow (wash detection), OHLCV. Returns safety verdict, organicity, confidence score. Uses 2-4 GeckoTerminal calls. |
| `buy_token` | Atomic buy: cooldown check -> safety gate -> penalty preview -> execute -> barrier registration. No gap between buy and protection. Accepts custom `barriers` and `archetype`. |
| `sell_token` | Sell token (full or partial). Use `"all"` for amountNano to exit entire position. |
| `set_tp_sl` | Modify barriers on open positions: TP, SL, trailing stop (activation + delta), time limit, partial TP. Not needed at buy time (barriers set atomically). |
| `review_position` | Check thesis for an open position: fresh market data, organicity, signals. Use to decide hold/exit. |
| `get_status` | Strategy PnL, win rate, drawdown, balance, current positions. |
| `record_reflection` | Write to reflection log: trade_closed, session_summary, lesson_learned. Append-only JSONL. |

### Discovery & screening

| Tool | Description |
|------|-------------|
| `screen_tokens` | Ad-hoc screening by criteria (liquidity, volume, FDV, price change, buy/sell ratio, etc.). |
| `find` | Find token by symbol or search pools by keyword. |
| `get_token_price` | Current USD price for a token. |
| `get_available_tokens` | List of tokens available for trading in this strategy. |
| `update_screening_config` | Update daemon screening criteria. |

### Policy & budget

| Tool | Description |
|------|-------------|
| `read_risk_policy` | Current risk caps: max positions, exposure limit, cooldown duration, default barriers. Read-only. |
| `read_api_budget` | Current API quota state (GeckoTerminal and DexScreener usage vs limits). |
| `get_simulation_results` | Dry-run results: win rate, avg PnL, recommended parameters. Simulation mode only. |

### Deprecated

| Tool | Description |
|------|-------------|
| `analyze_pool` | Replaced by `verify_candidate`. Still works as legacy fallback (trades + OHLCV only, no safety checks). |

---

## Safety Gates

The safety gate is deterministic code that runs **before** every trade. The LLM cannot bypass, override, or disable it.

### Hard rejects (trade is impossible)

| Check | Condition |
|-------|-----------|
| Honeypot | Token confirmed as honeypot (cannot sell) |
| Mint authority | Owner can mint tokens, devaluing position |
| Freeze authority | Owner can freeze tokens, blocking funds |
| Duplicate position | Token already in portfolio |
| Position cap | Open positions >= max allowed |
| Not tradeable | Token not available on TractionEye |
| Zero liquidity | Pool liquidity < $500 |
| Wash confirmed | Anti-wash check found fake volume (3+ signals failed) |
| Cooldown | Token exited by stop loss / thesis break within cooldown period |

### Structural penalties (trade allowed, size reduced)

Penalties stack multiplicatively. Example: concentrated holders (x0.5) + few holders (x0.7) + CTO (x0.8) = position size x0.28.

| Check | Multiplier |
|-------|-----------|
| Top 10 holders > threshold | x0.5 |
| Holder count < minimum | x0.7 |
| Low locked liquidity | x0.6 |
| Pool age < 30 minutes | x0.5 |
| Community takeover token | x0.8 |
| Honeypot status unknown | x0.9 |
| Suspicious organicity | x0.5 |

---

## Triple Barrier System

Every position is protected by 4 barriers evaluated every 30 seconds. Whichever fires first closes the position.

| Barrier | How it works |
|---------|-------------|
| **Stop Loss** | Exit if PnL drops to -X% |
| **Take Profit** | Exit if PnL reaches +X% |
| **Trailing Stop** | Activates at +X%, then follows Y% below peak PnL. Captures extended runs. |
| **Time Limit** | Exit if position held longer than N seconds. Frees capital from stagnant positions. |
| **Partial TP** | Sell Z% of position at +X% (optional, fires once) |

Barriers are set **atomically** with the buy — no gap between purchase and protection. The daemon enforces them 24/7 regardless of agent availability.

Default barriers per archetype:

| Archetype | TP | SL | Trailing | Time limit |
|-----------|----|----|----------|------------|
| organic_breakout | +30% | -10% | 15% activate, 5% delta | 2 hours |
| paid_attention | +15% | -8% | 10% activate, 4% delta | 1 hour |
| cto_momentum | +20% | -12% | 12% activate, 5% delta | 1.5 hours |

---

## Background Daemon

The daemon is a stateful runtime with 4 microcycles:

| Cycle | Interval | What it does | API calls |
|-------|----------|-------------|-----------|
| **Price Sentry** | 30s | Batch price check for all positions, evaluate triple barriers | 1 DexScreener (batch) |
| **Scout** | 3min | Pool discovery, junk filter, archetype classification, market state update | 3-7 DexScreener |
| **Thesis Light** | 60s | Momentum check using DexScreener data (price/volume trends) | 0 GeckoTerminal |
| **Thesis Deep** | 10min | Buyer diversity + safety re-check via GeckoTerminal | 2 GeckoTerminal / position |

The daemon also:
- Records cooldowns when positions exit by stop loss or thesis break
- Updates playbook stats on every trade close
- Detects market regime (active / quiet / volatile)
- Emits events: `shortlist_ready`, `thesis_break`, `barrier_triggered`
- Notifies the agent via OpenClaw CLI on barrier triggers

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
    }
  },
  "screening": {
    "intervalMs": 180000,
    "filter": {
      "minLiquidityUsd": 1000,
      "minVolume24hUsd": 500
    }
  },
  "riskPolicy": {
    "maxOpenPositions": 5,
    "maxTotalExposurePercent": 80,
    "maxPerTokenPercent": 15,
    "maxPriceImpactPercent": 5,
    "cooldownAfterExitMinutes": 120,
    "defaultBarriers": {
      "stopLossPercent": 10,
      "takeProfitPercent": 25,
      "timeLimitSeconds": 7200,
      "trailingStop": { "activationPercent": 15, "deltaPercent": 5 }
    }
  }
}
```

| Key | Description |
|-----|-------------|
| `agentToken` | Agent token from TractionEye strategy |
| `sessionId` | OpenClaw session ID for daemon notifications |
| `tpSl.defaults` | Legacy TP/SL thresholds (used alongside barriers) |
| `screening.filter` | Screening criteria (same fields as `screen_tokens` tool) |
| `riskPolicy` | Hard limits the agent cannot override |

---

## State Files

```
~/.tractioneye/
├── config.json                  ← Credentials, TP/SL, screening, risk policy
├── briefing.json                ← Legacy briefing (backward compatible)
├── agent-session.lock           ← Session lock (agent active indicator)
└── state/
    ├── market_state.json        ← Market shortlist, regime, signals, cooldowns
    ├── candidate_registry.json  ← Candidate lifecycle (discovered → verified → bought)
    ├── portfolio_state.json     ← Position thesis, barriers, exit events
    ├── playbooks.json           ← Archetype definitions + per-archetype stats
    ├── cooldown.json            ← Tokens in cooldown after stop loss
    ├── eval_report.json         ← Performance metrics with baseline comparison
    └── reflection_log.jsonl     ← Append-only agent reflections and lessons
```

All JSON state files use **atomic writes** (write to .tmp, then rename) for crash safety.

---

## Rate Limits

The kit manages two external APIs with built-in rate limiting and priority queues:

| API | Current limit | Usage |
|-----|--------------|-------|
| **DexScreener** | 10 req/60s | Discovery, prices (batch up to 30 tokens/request), screening |
| **GeckoTerminal** | 5 req/60s | Verification (4 calls), thesis deep check (2 calls/position) |
| **TractionEye backend** | No limit | Trade execution, portfolio, strategy |

The quota manager tracks per-queue budgets (critical / verify / scout / background) and includes 429 detection with automatic feedback.

---

## Trading Skill

The kit includes `skills/trading.md` — a behavioral specification for AI trading agents:

- **v2 session algorithm**: briefing -> verify candidates -> atomic buy with barriers -> reflection
- **Archetype-aware trading**: different barrier configs for organic_breakout / paid_attention / cto_momentum
- **Self-learning**: agent records lessons, tracks which archetypes and signals produce best results
- **Position review**: handles weakening/broken thesis from daemon monitoring
- **Reflection system**: structured entries (trade_closed, session_summary, lesson_learned) persisted to JSONL

Designed for [OpenClaw](https://openclaw.com) agents. The algorithm can be adapted for any LLM agent framework.

---

## Simulation Mode

```ts
const client = await TractionEyeClient.create({
  agentToken: 'your-token',
  dryRun: true,
});
```

In simulation mode:
- `executeTrade()` records virtual trades instead of real execution
- `getSimulationResults()` returns win rate, average PnL, and recommended parameters
- All safety gates and verification still run (test your full pipeline)
- Use this to validate strategies before committing real funds

---

## Enriched Pool Data

Every `PoolInfo` includes data from both DexScreener and GeckoTerminal:

| Field | Description |
|-------|-------------|
| `poolAddress`, `name`, `dexId` | Pool identification and DEX routing |
| `baseTokenPriceUsd`, `priceNative` | Token price in USD and relative to TON |
| `reserveInUsd`, `fdvUsd`, `marketCapUsd` | Pool liquidity and valuation |
| `volume1hUsd`, `volume6hUsd`, `volume24hUsd`, `volume5mUsd` | Trading volume across timeframes |
| `priceChange5m` / `1h` / `6h` / `24h` | Price change percentages |
| `buys5m`, `sells5m`, `buys1h`, `sells1h`, `buys6h`, `sells6h`, `buys24h`, `sells24h` | Transaction counts per timeframe |
| `uniqueBuyers1h` / `6h` / `24h`, `uniqueSellers1h` / `6h` / `24h` | Unique wallets (from GeckoTerminal only) |
| `buySellRatio` | Buy/sell ratio (24h) |
| `boostTotalAmount` | Paid boost amount (attention signal) |
| `cto` | Community takeover flag |
| `socials`, `websites` | Token social links and websites |
| `tags` | Discovery source: `top_volume`, `trending`, `new` |

---

## Local Development

```bash
git clone https://github.com/TractionEye/TractionEye-Agent-kit
cd TractionEye-Agent-kit
npm install
npm run build
npm run check     # TypeScript type checking
```

---

## Attribution

Triple barrier, action pattern, cooldown, and CloseType concepts adapted from [Hummingbot](https://github.com/hummingbot/hummingbot) (Apache 2.0). Computed signals and confidence summary inspired by FreqAI (concepts only, no code).

## License

MIT
