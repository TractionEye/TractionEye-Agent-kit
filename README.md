# @tractioneye/agent-sdk

TypeScript SDK for TractionEye trading agents. Provides a clean, high-level interface for managing trading strategies without knowing internal API endpoints.

## How it works — Token model

**This SDK does not manage wallets or private keys.** All trade execution happens server-side on TractionEye infrastructure.

Authentication works via an **Agent Token** — a secret string that binds the SDK client to a specific trading strategy.

```
Strategy Owner (human) ──generates──▶ Agent Token
                                            │
                                            ▼
                              Agent / Bot receives token
                                            │
                                            ▼
                          TractionEyeClient.create({ agentToken })
                                            │
                                            ▼
                              Trades execute on that strategy
```

> **If you are building an AI agent or trading bot:**
> You must ask the strategy owner to generate a token for you.
> Without a token from a real TractionEye strategy, the SDK cannot connect.
>
> **Steps for the strategy owner:**
> 1. Open TractionEye in Telegram
> 2. Go to their strategy → **Edit Strategy**
> 3. Tap **Generate Token**
> 4. Send the token to you (the agent/bot developer)

## Install

```bash
npm install @tractioneye/agent-sdk
```

> **Can't install from npm yet?** Clone and build locally — see [Local development](#local-development) below.

---

## Getting started

### Step 1 — Get your Agent Token

The SDK authenticates via an **Agent Token** tied to a specific TractionEye strategy.

1. Open [TractionEye](https://test.tractioneye.xyz) in Telegram
2. Go to your strategy → tap **Edit Strategy** (settings icon)
3. Tap **Generate Token**
4. Copy the token — it will only be shown once

> **One token = one strategy.** The client automatically reads `strategyId` from the token on startup.
> To get a fresh token at any time, tap **Regenerate** — the old token is immediately revoked.

### Step 2 — Set the environment variable

```bash
export TRACTIONEYE_AGENT_TOKEN=your_token_here
```

### Step 3 — Initialize the client

```ts
import { TractionEyeClient } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: process.env.TRACTIONEYE_AGENT_TOKEN!,
});

const summary = await client.getStrategySummary();
console.log('Strategy:', summary.strategyName, '| TON in strategy:', summary.tonInStrategy);
```

---

## Local development

If the npm package is not yet available, run directly from source:

```bash
git clone https://github.com/TractionEye/agent-sdk
cd agent-sdk
npm install
npm run build

export TRACTIONEYE_AGENT_TOKEN=your_token_here
npx tsx examples/buy-flow.ts
```

---

## Configuration

| Option | Type | Required | Description |
|---|---|---|---|
| `agentToken` | `string` | ✅ | Agent token from TractionEye Edit Strategy screen |
| `baseUrl` | `string` | ❌ | Override API base URL. Default: `https://test.tractioneye.xyz/trust_api` |

---

## API Reference

### `TractionEyeClient.create(config)`

Creates and initializes a client. Fetches `strategyId` from backend on startup.

```ts
const client = await TractionEyeClient.create({
  agentToken: 'your-token',
  baseUrl: 'https://test.tractioneye.xyz/trust_api', // optional
});
```

---

### `getStrategySummary()`

Returns aggregated performance metrics for the strategy.

```ts
const summary = await client.getStrategySummary();
```

**Returns: `StrategySummary`**

| Field | Type | Description |
|---|---|---|
| `strategyId` | `string` | Strategy ID |
| `strategyName` | `string` | Strategy name |
| `pnlDayTon` | `string` | PnL for the last 24h (TON) |
| `pnlWeekTon` | `string` | PnL for the last 7 days (TON) |
| `pnlMonthTon` | `string` | PnL for the last 30 days (TON) |
| `pnlYearTon` | `string` | PnL for the last year (TON) |
| `tonInStrategy` | `string` | Total TON under management |
| `totalWinRate` | `number` | Win rate (0–1) |
| `tradesPerWeek` | `number` | Average trades per week |
| `maxDrawdown` | `number` | Maximum drawdown |
| `lowBalanceState` | `boolean` | True if balance is critically low (< 0.35 TON) |

---

### `getPortfolio()`

Returns current token positions held in the strategy.

```ts
const portfolio = await client.getPortfolio();
```

**Returns: `PortfolioSummary`**

| Field | Type | Description |
|---|---|---|
| `strategyId` | `string` | Strategy ID |
| `totalRealizedPnlTon` | `string` | Total realized PnL (TON) |
| `totalUnrealizedPnlTon` | `string` | Total unrealized PnL (TON) |
| `tokens` | `TokenSummary[]` | Array of current positions |

**`TokenSummary` fields:**

| Field | Type | Description |
|---|---|---|
| `address` | `string` | Jetton address on TON |
| `symbol` | `string` | Token symbol (e.g., `WETH`) |
| `decimals` | `number` | Token decimals |
| `quantity` | `string` | Position size in on-chain nano units |
| `realizedPnlTon` | `string` | Realized PnL for this token (TON) |
| `unrealizedPnlTon` | `string` | Unrealized PnL for this token (TON) |
| `entryPriceTon` | `string?` | Average entry price (TON) |
| `currentValueTon` | `string?` | Current position value (TON) |

> **Note on `quantity`:** Value is in on-chain nano units (string). To display human-readable value: `Number(quantity) / 10 ** decimals`.

---

### `getAvailableTokens(limit?, offset?)`

Returns a page of tokens available for trading (default: first 200).

```ts
const tokens = await client.getAvailableTokens();
// [{ address: 'EQ...', symbol: 'WETH', decimals: 18 }, ...]
```

> **Tip:** Use `findToken(symbol)` for symbol-based lookup — it's more efficient than loading the full list.

**Returns: `AvailableToken[]`**

| Field | Type | Description |
|---|---|---|
| `address` | `string` | Jetton address on TON |
| `symbol` | `string` | Token symbol |
| `decimals` | `number` | Token decimals |

---

### `findToken(symbol)`

Find a single token by its symbol. Preferred way to resolve symbol → address before trading.

```ts
const weth = await client.findToken('WETH');
if (!weth) throw new Error('WETH not found');
```

---

### `previewTrade(req)`

Simulates a trade and returns expected outcome. **Always call before `executeTrade()`.**

```ts
const preview = await client.previewTrade({
  action: 'BUY',
  tokenAddress: 'EQB...', // jetton address
  amountNano: '5000000000', // 5 TON in nanotons
});
```

**`TradePreviewRequest`:**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `'BUY' \| 'SELL'` | ✅ | Trade direction |
| `tokenAddress` | `string` | ✅ | Jetton address |
| `amountNano` | `string` | ✅ | Amount in nano units (TON nanotons for BUY, jetton nano units for SELL) |

**Returns: `TradePreview`**

| Field | Type | Description |
|---|---|---|
| `validationOutcome` | `'ok' \| 'warning' \| 'rejected'` | Backend validation result |
| `lowBalanceState` | `boolean` | True if balance may be insufficient |
| `estimatedReceiveNano` | `string` | Expected output in nano units |
| `minReceiveNano` | `string` | Minimum output after slippage |
| `priceImpactPercent` | `number` | Price impact % |
| `swapRate` | `string` | Current exchange rate |

---

### `executeTrade(req)`

Executes a trade. Returns `operationId` for status polling.

```ts
const execution = await client.executeTrade({
  action: 'BUY',
  tokenAddress: 'EQB...',
  amountNano: '5000000000',
  slippageTolerance: 0.01, // optional, default 0.01
});

console.log('Operation ID:', execution.operationId);
```

**`TradeExecutionRequest`:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `action` | `'BUY' \| 'SELL'` | ✅ | — | Trade direction |
| `tokenAddress` | `string` | ✅ | — | Jetton address |
| `amountNano` | `string` | ✅ | — | Amount in nano units |
| `slippageTolerance` | `number` | ❌ | `0.01` | Slippage tolerance (1% = 0.01) |

**Returns: `TradeExecution`**

| Field | Type | Description |
|---|---|---|
| `operationId` | `string` | Use this for `getOperationStatus()` |
| `initialStatus` | `'pending'` | Always `pending` on execution |
| `swapType` | `TradeAction` | `BUY` or `SELL` |
| `tokenAddress` | `string` | Token traded |
| `expectedTokenAmountNano` | `string?` | Expected token output |
| `expectedTonAmountNano` | `string?` | Expected TON output |

> **Idempotency:** each `executeTrade()` call generates a unique `idempotencyKey` internally. Safe to retry on network errors — backend deduplicates.

---

### `getOperationStatus(operationId)`

Polls the status of an executed trade. Poll every 3–5 seconds until status is not `pending`.

```ts
const status = await client.getOperationStatus(execution.operationId);
```

**Returns: `OperationStatus`**

| Field | Type | Description |
|---|---|---|
| `operationId` | `string` | Operation ID |
| `status` | `'pending' \| 'confirmed' \| 'adjusted' \| 'failed'` | Current status (see below) |
| `swapType` | `TradeAction` | `BUY` or `SELL` |
| `tokenAddress` | `string` | Token address |
| `actualTokenAmountNano` | `string?` | Actual token amount received |
| `actualTonAmountNano` | `string?` | Actual TON amount received |
| `failureReason` | `string?` | Human-readable failure reason |

**Operation status lifecycle:**

```
pending → confirmed   ✅ trade executed on-chain as expected
        → adjusted    ⚠️  trade executed but with a different amount
                          (e.g. slippage hit, partial fill). Check actualTokenAmountNano.
        → failed      ❌ trade did not execute. Check failureReason.
                          Common reasons: transaction timeout, insufficient balance, DEX error.
```

> **On `adjusted`:** The trade went through, but the actual received amount differs from `estimatedReceiveNano`. Always use `actualTokenAmountNano` / `actualTonAmountNano` to record what was actually received.

> **On `failed`:** No funds were moved. It is safe to retry the trade.

---

## Example: BUY flow with polling

```ts
import { TractionEyeClient } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: process.env.TRACTIONEYE_AGENT_TOKEN!,
});

// 1. Find token
const weth = await client.findToken('WETH');
if (!weth) throw new Error('WETH not available');

// 2. Amount: 5 TON
const amountNano = (5n * 10n ** 9n).toString();

// 3. Preview
const preview = await client.previewTrade({
  action: 'BUY',
  tokenAddress: weth.address,
  amountNano,
});

if (preview.validationOutcome === 'rejected') {
  console.log('Trade rejected');
  process.exit(1);
}

// 4. Execute
const execution = await client.executeTrade({
  action: 'BUY',
  tokenAddress: weth.address,
  amountNano,
});

console.log('Trade started, operationId:', execution.operationId);

// 5. Poll status
let status;
do {
  await new Promise(r => setTimeout(r, 5000));
  status = await client.getOperationStatus(execution.operationId);
  console.log('Status:', status.status);
} while (status.status === 'pending');

if (status.status === 'confirmed') {
  console.log('Trade confirmed! Received:', status.actualTokenAmountNano, 'nano WETH');
} else if (status.status === 'adjusted') {
  console.log('Trade adjusted. Actual received:', status.actualTokenAmountNano);
} else {
  console.log('Trade failed:', status.failureReason);
}
```

---

## Tools for LLM agents

```ts
import { TractionEyeClient, createTractionEyeTools } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: process.env.TRACTIONEYE_AGENT_TOKEN!,
});

const tools = createTractionEyeTools(client);
// Pass tools to your agent framework (OpenAI, LangChain, etc.)
```

Available tools:
- `tractioneye_get_strategy_summary`
- `tractioneye_get_portfolio`
- `tractioneye_get_available_tokens`
- `tractioneye_preview_trade`
- `tractioneye_execute_trade`
- `tractioneye_get_operation_status`

---

## Architecture

```
Agent / LLM
    │
    ▼
TractionEyeClient (SDK)
    │  - hides HTTP details
    │  - handles BUY/SELL mapping
    │  - generates idempotency keys
    │  - normalizes response contracts
    │
    ▼
TractionEye Backend API
    │
    ▼
Ston.fi (swaps on TON)
```

Backend is the single source of truth: it validates trades, calculates PnL, and executes swaps. SDK is a thin adapter layer only.
