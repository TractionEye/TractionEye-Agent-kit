/**
 * Example: Using createTractionEyeTools with an LLM agent framework
 *
 * This example shows how to wire up the tools layer.
 * Replace the "mock agent" section with your actual framework.
 *
 * Usage:
 *   TRACTIONEYE_AGENT_TOKEN=<token> npx tsx examples/agent-tools.ts
 */

import { TractionEyeClient, createTractionEyeTools } from '../src/index.js';

async function main() {
  const token = process.env.TRACTIONEYE_AGENT_TOKEN;
  if (!token) throw new Error('TRACTIONEYE_AGENT_TOKEN env variable is required');

  const client = await TractionEyeClient.create({ agentToken: token });
  const tools = createTractionEyeTools(client);

  console.log('Available tools for LLM:');
  for (const tool of tools) {
    console.log(`  - ${tool.name}`);
    console.log(`    ${tool.description.slice(0, 80)}...`);
  }

  // --- Mock agent call: get strategy summary ---
  console.log('\n=== Mock tool call: tractioneye_get_strategy_summary ===');
  const summaryTool = tools.find((t) => t.name === 'tractioneye_get_strategy_summary')!;
  const summaryResult = await summaryTool.handler({});
  console.log(JSON.stringify(summaryResult, null, 2));

  // --- Mock agent call: get portfolio ---
  console.log('\n=== Mock tool call: tractioneye_get_portfolio ===');
  const portfolioTool = tools.find((t) => t.name === 'tractioneye_get_portfolio')!;
  const portfolioResult = await portfolioTool.handler({});
  console.log(JSON.stringify(portfolioResult, null, 2));

  // --- To integrate with OpenAI / OpenClaw / other frameworks: ---
  //
  // const openaiTools = tools.map(t => ({
  //   type: 'function' as const,
  //   function: {
  //     name: t.name,
  //     description: t.description,
  //     parameters: t.parameters,
  //   }
  // }));
  //
  // Then handle tool_calls in the completion loop:
  // const result = await t.handler(toolCallArgs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
