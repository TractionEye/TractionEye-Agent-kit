/**
 * Example: Read strategy state and portfolio
 *
 * Usage:
 *   TRACTIONEYE_AGENT_TOKEN=<token> npx tsx examples/portfolio-check.ts
 */

import { TractionEyeClient } from '../src/index.js';

async function main() {
  const token = process.env.TRACTIONEYE_AGENT_TOKEN;
  if (!token) throw new Error('TRACTIONEYE_AGENT_TOKEN env variable is required');

  const client = await TractionEyeClient.create({ agentToken: token });
  console.log(`Strategy: ${client.strategyName} (id: ${client.strategyId})\n`);

  // Strategy summary
  const summary = await client.getStrategySummary();
  console.log('=== Strategy Summary ===');
  console.log(`TON in strategy : ${summary.tonInStrategy}`);
  console.log(`PnL day         : ${summary.pnlDayTon} TON`);
  console.log(`PnL week        : ${summary.pnlWeekTon} TON`);
  console.log(`PnL month       : ${summary.pnlMonthTon} TON`);
  console.log(`Win rate        : ${(summary.totalWinRate * 100).toFixed(1)}%`);
  console.log(`Max drawdown    : ${summary.maxDrawdown}`);
  console.log(`Low balance     : ${summary.lowBalanceState}`);

  // Portfolio
  const portfolio = await client.getPortfolio();
  console.log('\n=== Portfolio ===');
  console.log(`Total realized PnL   : ${portfolio.totalRealizedPnlTon} TON`);
  console.log(`Total unrealized PnL : ${portfolio.totalUnrealizedPnlTon} TON`);
  console.log(`\nPositions (${portfolio.tokens.length}):`);

  for (const t of portfolio.tokens) {
    const humanQty = (BigInt(t.quantity) / 10n ** BigInt(t.decimals)).toString();
    console.log(`  ${t.symbol.padEnd(8)} qty=${t.quantity} (≈${humanQty}) | unrealizedPnl=${t.unrealizedPnlTon} TON`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
