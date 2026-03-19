/**
 * Example: Full BUY flow
 * preview → execute → poll status
 *
 * Usage:
 *   TRACTIONEYE_AGENT_TOKEN=<token> npx tsx examples/buy-flow.ts
 */

import { TractionEyeClient } from '../src/index.js';
import type { OperationStatus } from '../src/index.js';

async function main() {
  const token = process.env.TRACTIONEYE_AGENT_TOKEN;
  if (!token) throw new Error('TRACTIONEYE_AGENT_TOKEN env variable is required');

  // 1. Create client
  const client = await TractionEyeClient.create({ agentToken: token });
  console.log(`Connected to strategy: ${client.strategyName} (id: ${client.strategyId})`);

  // 2. Check strategy state
  const summary = await client.getStrategySummary();
  console.log(`TON in strategy: ${summary.tonInStrategy}`);
  console.log(`Low balance: ${summary.lowBalanceState}`);

  if (summary.lowBalanceState) {
    console.warn('Warning: strategy has low balance');
  }

  // 3. Find WETH token
  const tokens = await client.getAvailableTokens();
  const weth = tokens.find((t) => t.symbol === 'WETH');
  if (!weth) throw new Error('WETH not found in available tokens');
  console.log(`WETH address: ${weth.address}`);

  // 4. Set amount: 1 TON
  const amountNano = (1n * 10n ** 9n).toString();
  console.log(`\nPreviewing BUY ${amountNano} nanoTON of WETH...`);

  // 5. Preview
  const preview = await client.previewTrade({
    action: 'BUY',
    tokenAddress: weth.address,
    amountNano,
  });

  console.log(`Validation: ${preview.validationOutcome}`);
  console.log(`Estimated receive: ${preview.estimatedReceiveNano} nano WETH`);
  console.log(`Min receive: ${preview.minReceiveNano} nano WETH`);
  console.log(`Price impact: ${preview.priceImpactPercent}%`);
  console.log(`Swap rate: ${preview.swapRate}`);

  if (preview.validationOutcome === 'rejected') {
    console.error('Trade rejected by backend. Aborting.');
    return;
  }

  if (preview.validationOutcome === 'warning') {
    console.warn('Trade has warnings. Proceeding anyway for demo purposes.');
  }

  // 6. Execute
  console.log('\nExecuting trade...');
  const execution = await client.executeTrade({
    action: 'BUY',
    tokenAddress: weth.address,
    amountNano,
    slippageTolerance: 0.01,
  });

  console.log(`Operation started: ${execution.operationId}`);

  // 7. Poll status
  console.log('\nPolling status...');
  let status: OperationStatus;
  let attempts = 0;

  do {
    await new Promise((r) => setTimeout(r, 5000));
    status = await client.getOperationStatus(execution.operationId);
    attempts++;
    console.log(`[${attempts}] Status: ${status.status}`);
  } while (status.status === 'pending' && attempts < 20);

  // 8. Final result
  console.log('\n=== Final Status ===');
  console.log(`Status: ${status.status}`);

  if (status.status === 'confirmed' || status.status === 'adjusted') {
    console.log(`Actual WETH received: ${status.actualTokenAmountNano}`);
    console.log(`Actual TON spent: ${status.actualTonAmountNano}`);
  } else if (status.status === 'failed') {
    console.error(`Failed: ${status.failureReason} (code: ${status.errorCode})`);
  } else {
    console.log('Still pending after max attempts');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
