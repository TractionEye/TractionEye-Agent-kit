# @tractioneye/agent-sdk

TractionEye wrapper SDK for trading agents.

## Current status
Phase 1 in progress.

Implemented:
- `TractionEyeClient.create()`
- `getStrategySummary()`
- `getPortfolio()`
- `getAvailableTokens()`
- basic HTTP client with `Authorization: agent <token>`
- default `baseUrl`: `https://test.tractioneye.xyz/trust_api`

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
const portfolio = await client.getPortfolio();
const tokens = await client.getAvailableTokens();
```
