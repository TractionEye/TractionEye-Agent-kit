# @tractioneye/agent-sdk

TypeScript SDK for TractionEye trading agents. Provides a clean, high-level interface for managing trading strategies without knowing internal API endpoints.

## Install

```bash
npm install @tractioneye/agent-sdk
```

## Quick start

```ts
import { TractionEyeClient } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: process.env.TRACTIONEYE_AGENT_TOKEN!,
});

const summary = await client.getStrategySummary();
console.log('Strategy:', summary.strategyName, '| TON in strategy:', summary.tonInStrategy);

const portfolio = await client.getPortfolio();
console.log('Tokens held:', portfolio.tokens.map(t => t.symbol));

const tokens = await client.getAvailableTokens();
console.log('Available tokens:', tokens.map(t => t.symbol));
```

## Configuration

| Option | Type | Required | Description |
|---|---|---|---|
| `agentToken` | `string` | ✅ | JWT agent token from TractionEye |
| `baseUrl` | `string` | ❌ | Override API base URL. Default: `https://test.tractioneye.xyz/trust_api` |

**Rule:** 1 `agentToken` = 1 strategy. The client reads `strategyId` automatically on `create()`.

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
| `lowBalanceState` | `boolean` | True if balance is critically low |

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

### `getAvailableTokens()`

Returns the list of tokens available for trading in this strategy.

```ts
const tokens = await client.getAvailableTokens();
// [{ address: 'EQ...', symbol: 'WETH', decimals: 18 }, ...]
```

**Returns: `AvailableToken[]`**

| Field | Type | Description |
|---|---|---|
| `address` | `string` | Jetton address on TON |
| `symbol` | `string` | Token symbol |
| `decimals` | `number` | Token decimals |

Automatically paginates through the full token catalog.

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
| `amountNano` | `string` | ✅ | Amount in nano units (TON for BUY, jetton for SELL) |

**Returns: `TradePreview`**

| Field | Type | Description |
|---|---|---|
| `validationOutcome` | `'ok' \| 'warning' \| 'rejected'` | Backend validation result |
| `lowBalanceState` | `boolean` | True if balance may be insufficient |
| `estimatedReceiveNano` | `string` | Expected output in nano units |
| `minReceiveNano` | `string` | Minimum output after slippage |
| `priceImpactPercent` | `number` | Price impact % |
| `swapRate` | `string` | Current exchange rate |

**BUY/SELL address mapping** (handled internally by SDK):
- BUY (TON → jetton): `offeraddress = TON_NATIVE`, `askaddress = tokenAddress`
- SELL (jetton → TON): `offeraddress = tokenAddress`, `askaddress = TON_NATIVE`

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

Polls the status of an executed trade.

```ts
const status = await client.getOperationStatus(execution.operationId);
```

**Returns: `OperationStatus`**

| Field | Type | Description |
|---|---|---|
| `operationId` | `string` | Operation ID |
| `status` | `'pending' \| 'confirmed' \| 'adjusted' \| 'failed'` | Current status |
| `swapType` | `TradeAction` | `BUY` or `SELL` |
| `tokenAddress` | `string` | Token address |
| `actualTokenAmountNano` | `string?` | Actual token amount received |
| `actualTonAmountNano` | `string?` | Actual TON amount received |
| `failureReason` | `string?` | Human-readable failure reason |
| `errorCode` | `number?` | Error code if failed |

**Status lifecycle:** `pending → confirmed | adjusted | failed`

Poll every 3–5 seconds until status is not `pending`.

---

## Example: BUY flow with polling

```ts
import { TractionEyeClient, OperationStatus } from '@tractioneye/agent-sdk';

const client = await TractionEyeClient.create({
  agentToken: process.env.TRACTIONEYE_AGENT_TOKEN!,
});

// 1. Find token
const tokens = await client.getAvailableTokens();
const weth = tokens.find(t => t.symbol === 'WETH');
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
  console.log('Trade rejected:', preview);
  process.exit(1);
}

if (preview.validationOutcome === 'warning' || preview.lowBalanceState) {
  console.warn('Warning:', preview);
  // agent decides whether to proceed
}

console.log(`Buying WETH: estimated receive ${preview.estimatedReceiveNano} nano, impact ${preview.priceImpactPercent}%`);

// 4. Execute
const execution = await client.executeTrade({
  action: 'BUY',
  tokenAddress: weth.address,
  amountNano,
  slippageTolerance: 0.01,
});

console.log('Trade started, operationId:', execution.operationId);

// 5. Poll status
let status: OperationStatus;
do {
  await new Promise(r => setTimeout(r, 5000));
  status = await client.getOperationStatus(execution.operationId);
  console.log('Status:', status.status);
} while (status.status === 'pending');

if (status.status === 'confirmed') {
  console.log('Trade confirmed! Received:', status.actualTokenAmountNano, 'nano WETH');
} else {
  console.log('Trade ended with status:', status.status, status.failureReason);
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
// Pass tools to your agent framework (OpenAI, OpenClaw, etc.)
// The model will choose when to call preview, execute, poll, etc.
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
Ston.fi (swaps)
```

Backend is the single source of truth: it validates trades, calculates PnL, and executes swaps. SDK is a thin adapter layer only.
