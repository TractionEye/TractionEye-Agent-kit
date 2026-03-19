/**
 * Smoke tests against test.tractioneye.xyz/trust_api
 * Does NOT execute real trades — only reads + simulate (previewTrade).
 */

import { TractionEyeClient, TractionEyeHttpError } from '../src/index.js';
import type { OperationStatus } from '../src/index.js';

const TOKEN = process.env.TRACTIONEYE_AGENT_TOKEN!;
const INVALID_TOKEN = 'invalid_token_for_smoke_test';

let passed = 0;
let failed = 0;

function ok(name: string, detail?: string) {
  passed++;
  console.log(`  ✅ ${name}${detail ? ': ' + detail : ''}`);
}

function fail(name: string, err: unknown) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ❌ ${name}: ${msg}`);
}

async function run() {
  console.log('=== TractionEye SDK Smoke Tests ===\n');

  // ── 1. create() with valid token ────────────────────────────────────────
  console.log('[1] TractionEyeClient.create() — valid token');
  let client: TractionEyeClient;
  try {
    client = await TractionEyeClient.create({ agentToken: TOKEN });
    ok('create()', `strategyId=${client.strategyId} name="${client.strategyName}"`);
  } catch (e) {
    fail('create()', e);
    console.log('\nCannot proceed without a valid client. Aborting.');
    process.exit(1);
  }

  // ── 2. create() with invalid token ──────────────────────────────────────
  console.log('\n[2] TractionEyeClient.create() — invalid token (expect 401/403)');
  try {
    await TractionEyeClient.create({ agentToken: INVALID_TOKEN });
    fail('create() with invalid token', 'Expected error but got success');
  } catch (e) {
    if (e instanceof TractionEyeHttpError && (e.status === 401 || e.status === 403)) {
      ok('create() with invalid token', `got HTTP ${e.status} as expected`);
    } else {
      fail('create() with invalid token', e);
    }
  }

  // ── 3. getStrategySummary ────────────────────────────────────────────────
  console.log('\n[3] getStrategySummary()');
  try {
    const s = await client!.getStrategySummary();
    if (!s.strategyId) throw new Error('strategyId missing');
    if (typeof s.tonInStrategy !== 'string') throw new Error('tonInStrategy not a string');
    ok('getStrategySummary()', `pnlDay=${s.pnlDayTon} TON | lowBalance=${s.lowBalanceState}`);
  } catch (e) {
    fail('getStrategySummary()', e);
  }

  // ── 4. getPortfolio ──────────────────────────────────────────────────────
  console.log('\n[4] getPortfolio()');
  let firstToken: { address: string; symbol: string; quantity: string } | undefined;
  try {
    const p = await client!.getPortfolio();
    if (typeof p.totalRealizedPnlTon !== 'string') throw new Error('totalRealizedPnlTon not a string');
    ok('getPortfolio()', `${p.tokens.length} positions | realizedPnl=${p.totalRealizedPnlTon} TON`);
    const t = p.tokens[0];
    if (t) {
      firstToken = { address: t.address, symbol: t.symbol, quantity: t.quantity };
      ok('getPortfolio() token fields', `symbol=${t.symbol} qty=${t.quantity}`);
    }
  } catch (e) {
    fail('getPortfolio()', e);
  }

  // ── 5. getAvailableTokens ────────────────────────────────────────────────
  // NOTE: /stonfi/assets currently requires TMA auth, not agent token.
  // This is a known backend gap — needs /agent/assets endpoint.
  console.log('\n[5] getAvailableTokens() [KNOWN GAP: /stonfi/assets requires TMA auth]');
  try {
    const tokens = await client!.getAvailableTokens();
    ok('getAvailableTokens()', `${tokens.length} tokens`);
  } catch (e) {
    if (e instanceof TractionEyeHttpError && e.status === 401) {
      console.log('  ⚠️  KNOWN GAP: /stonfi/assets returns 401 for agent token — needs backend fix');
    } else {
      fail('getAvailableTokens()', e);
    }
  }

  // ── 6. previewTrade — BUY ───────────────────────────────────────────────
  // Use WETH from portfolio since getAvailableTokens is blocked
  const wethAddress = firstToken?.address ?? 'EQBTkLAhEteZCRgRe_xMs5ZE0bMrduYxKbyzGCpXXW8dRWOT';
  console.log('\n[6] previewTrade() — BUY 1 TON of WETH');
  try {
    const amountNano = (1n * 10n ** 9n).toString();
    const preview = await client!.previewTrade({
      action: 'BUY',
      tokenAddress: wethAddress,
      amountNano,
    });
    ok('previewTrade() BUY', `outcome=${preview.validationOutcome} | impact=${preview.priceImpactPercent}% | estimated=${preview.estimatedReceiveNano}`);
  } catch (e) {
    fail('previewTrade() BUY', e);
  }

  // ── 7. previewTrade — SELL ──────────────────────────────────────────────
  console.log('\n[7] previewTrade() — SELL (actual position size)');
  if (firstToken) {
    try {
      // Use actual quantity from portfolio (no larger than position)
      const preview = await client!.previewTrade({
        action: 'SELL',
        tokenAddress: firstToken.address,
        amountNano: firstToken.quantity,
      });
      ok('previewTrade() SELL', `outcome=${preview.validationOutcome} | symbol=${firstToken.symbol}`);
    } catch (e) {
      fail('previewTrade() SELL', e);
    }
  } else {
    console.log('  ⚠️  skipped (no portfolio token)');
  }

  // ── 8. previewTrade — invalid token address ─────────────────────────────
  // Backend returns simulation_failed (400) for unknown addresses.
  // SDK converts this to validationOutcome: "rejected" — correct behavior.
  console.log('\n[8] previewTrade() — invalid token address (expect rejected outcome)');
  try {
    const preview = await client!.previewTrade({
      action: 'BUY',
      tokenAddress: 'INVALID_ADDRESS_000',
      amountNano: '1000000000',
    });
    if (preview.validationOutcome === 'rejected') {
      ok('previewTrade() invalid address', 'got validationOutcome=rejected as expected');
    } else {
      fail('previewTrade() invalid address', `Expected rejected but got: ${preview.validationOutcome}`);
    }
  } catch (e) {
    fail('previewTrade() invalid address', e);
  }

  // ── 9. getOperationStatus — non-existent id ─────────────────────────────
  // Backend returns 200 with operation_status="pending" and failure_reason="Deal not found"
  console.log('\n[9] getOperationStatus() — non-existent operationId');
  try {
    const status = await client!.getOperationStatus('99999999');
    // Backend returns pending + failure_reason for non-existent deals (not 404)
    if (status.failureReason) {
      ok('getOperationStatus() non-existent', `status=${status.status} reason="${status.failureReason}"`);
    } else {
      fail('getOperationStatus() non-existent', 'No failure_reason for non-existent deal');
    }
  } catch (e) {
    fail('getOperationStatus() non-existent', e);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  // ── 10. findToken — symbol search ─────────────────────────────────────────
  console.log('\n[10] findToken() — resolve WETH symbol to address');
  try {
    const token = await client!.findToken('WETH');
    if (token && token.address && token.symbol === 'WETH') {
      ok('findToken() WETH', `address=${token.address.slice(0, 12)}... decimals=${token.decimals}`);
    } else {
      fail('findToken() WETH', `unexpected result: ${JSON.stringify(token)}`);
    }
  } catch (e) { fail('findToken() WETH', e); }

  console.log('\n[11] findToken() — unknown symbol (expect null)');
  try {
    const token = await client!.findToken('NOTEXISTSXYZ999');
    if (token === null) {
      ok('findToken() unknown symbol', 'returned null as expected');
    } else {
      fail('findToken() unknown symbol', `expected null, got ${JSON.stringify(token)}`);
    }
  } catch (e) { fail('findToken() unknown symbol', e); }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
