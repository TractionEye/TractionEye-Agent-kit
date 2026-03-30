# TractionEye AI Trader v2 — Specification

## I. System Definition

TractionEye AI Trader v2 is a long-running autonomous trading agent that:

- Observes the TON DEX market continuously
- Forms and verifies trading hypotheses
- Chooses what data to request and when
- Makes decisions to open, increase, reduce, or close positions
- Maintains persistent memory, playbooks, reflections, and eval traces
- Operates in a continuous cycle, not a one-shot cron session

Constraints:

- Funds are held by TractionEye, not the agent
- Execution remains on the TractionEye execution plane
- agentToken grants rights within a strategy, not custody
- Deterministic risk/execution/safety layers are outside LLM control

---

## II. Architecture

### Two Contours

**Contour A: Autonomous Intelligence Layer**

One agent with a structured decision loop (not multiple LLM workers).

The agent operates in deep-think cycles triggered by the daemon on events or schedule (every 10-15 minutes). Between deep-think cycles, the daemon runs deterministic microcycles without LLM involvement.

**Contour B: Deterministic Trading Kernel**

Not an agent. Professional infrastructure:

- TractionEye execution tools (preview -> validate -> execute -> poll)
- Safety gates (honeypot, mint/freeze, position caps)
- Risk caps and limits
- Quota manager
- Position thesis monitor
- Audit trail (eval traces, reflection log)

### Conflict Resolution Principle

If the LLM wants to BUY but safety/risk/quota blocks it — the deterministic layer ALWAYS wins. The LLM cannot override, bypass, or disable safety gates. This is enforced by code structure: `checkSafety()` runs BEFORE the trade execution call, and a hard reject returns an error to the LLM without executing.

---

## III. Daemon: Agent Runtime

The daemon is no longer just a briefing-writer and TP/SL watcher. It becomes a stateful runtime.

### Daemon Structure

```
agent-daemon.ts ->
  runtime.ts              — main loop, event bus, lifecycle
  microcycles/
    price-sentry.ts       — price monitoring (30s)
    scout.ts              — discovery refresh (3min)
    thesis-check.ts       — position thesis validation (60s)
    quota.ts              — API budget accounting
  state/
    market.ts             — market_state.json read/write
    candidates.ts         — candidate_registry.json state machine
    portfolio.ts          — portfolio_state.json management
    reflections.ts        — reflection_log.jsonl writer
  triggers/
    shortlist-ready.ts    — fires when scout has new verified candidates
    thesis-break.ts       — fires when position thesis breaks
    alert.ts              — fires on abnormal events
```

### Microcycles (deterministic, no LLM)

| Cycle | Interval | What It Does |
|---|---|---|
| Price Sentry | 30s | Batch price check via DexScreener, triple barrier evaluation (SL/TP/trailing/time) |
| Scout Refresh | 3min | Pool discovery, junk filter, archetype classification, shortlist update |
| Thesis Check Light | 60s | Compare price/volume metrics vs entry snapshot using DexScreener data ONLY (0 gecko calls) |
| Thesis Check Deep | 10min | Full buyer diversity + safety re-check via GeckoTerminal (2 gecko calls per position) |
| Quota Accounting | always | Track API usage per queue, enforce limits |

Note on Thesis Check split: A single 60s cycle with gecko calls would consume 10 gecko/min at 5 positions — double the current 5/min limit. The split solves this:
- Light (60s): checks momentum deceleration, sustained net sell, volume collapse using DexScreener price/volume data already fetched by price sentry. **0 gecko calls.**
- Deep (10min): checks buyer diversity collapse, organic collapse, safety degradation via GeckoTerminal getPoolInfo + getTokenInfo. **2 gecko calls per position.**

### Deep-Think Triggers (invoke LLM)

| Trigger | When |
|---|---|
| shortlist_ready | Scout found new candidates after filtering |
| thesis_break | Position thesis broken (buyer diversity collapse, sustained selling) |
| scheduled | Every 10-15 minutes as heartbeat |
| tp_sl_triggered | TP or SL fired, agent should reflect |
| manual | User explicitly asks for a session |

### Event Bus

```typescript
type DaemonEvent =
  | { type: 'shortlist_ready'; candidates: ShortlistEntry[] }
  | { type: 'thesis_break'; position: PositionThesis; reason: string }
  | { type: 'barrier_triggered'; position: PositionThesis; closeType: CloseType; pnlPercent: number }
  | { type: 'alert'; message: string; severity: 'warn' | 'critical' }
  | { type: 'deep_think_scheduled'; reason: 'timer' | 'event' };
```

Note: `barrier_triggered` replaces separate `tp_triggered` and `sl_triggered` events. The `closeType` field specifies which barrier fired (see Section VI-A for CloseType enum).

---

## IV. API Budget Design

### Current SDK Limits vs Target

| API | Provider Limit | Current SDK | Target SDK v2 | Migration |
|---|---|---|---|---|
| GeckoTerminal | 30 req/min | 5 req/60s, min 2s | 20 req/60s, min 1.5s | Raise gradually: 5->10->15->20, monitor 429s |
| DexScreener | ~300 req/min (core) | 10 req/60s, min 1s | 40 req/60s, min 0.5s | Raise gradually: 10->20->30->40, monitor 429s |
| TractionEye backend | No limits | No limiter | No limiter | No change needed |

### Budget at CURRENT limits (5 gecko / 10 dex per minute)

| Task | Gecko req/min | DexScreener req/min |
|---|---|---|
| Price sentry (30s, batch) | 0 | 2 |
| Scout discovery (3 min, typical) | 0 | ~2.3 (worst case: 4.3) |
| Verify 1 candidate (4 calls) | ~0.4 (once per 10 min) | 0 |
| Thesis deep review (2 calls x N, per 10 min) | 0.2 x N | 0 |
| Review position ad-hoc (2 calls each) | ~0.2 (1 per 10 min) | 0 |
| Agent ad-hoc | ~0.3 | ~1.5 |
| **Free** | **~3.4 - 0.2*N** | **~4.2** (worst case: ~2.2) |

At 5 positions: 3.4 - 1.0 = 2.4 free gecko -> 1 verify per 10 min. Tight but workable.
DexScreener worst case (scout finds all trending+new): 2 + 4.3 + 1.5 = 7.8 of 10. Fits.

### Budget at TARGET limits (20 gecko / 40 dex per minute)

| Task | Gecko req/min | DexScreener req/min |
|---|---|---|
| Price sentry (30s, batch) | 0 | 2 |
| Scout discovery (3 min, typical/worst) | 0 | ~2.3 / 4.3 |
| Verify candidates (4 calls each) | ~1.2 (3 per 10 min) | 0 |
| Thesis deep review (2 calls x N, per 10 min) | 0.2 x N | 0 |
| Review position ad-hoc | ~0.4 (2 per 10 min) | 0 |
| Agent ad-hoc | ~1.5 | ~5 |
| **Free** | **~14.9 - 0.2*N** | **~26.7** (worst: ~24.7) |

At 8 positions: 14.9 - 1.6 = 13.3 free -> 3+ verifies per 10 min. Comfortable.

### Central Quota Manager

Replaces coarse session lock. Daemon and agent both operate through QuotaManager.

```typescript
type QuotaQueue = 'critical' | 'verify' | 'scout' | 'background';

class QuotaManager {
  constructor(geckoRpm: number, dexRpm: number);
  configure(allocation: {
    gecko: Record<QuotaQueue, number>;
    dex: Record<QuotaQueue, number>;
  }): void;
  async acquire(api: 'gecko' | 'dex', queue: QuotaQueue): Promise<void>;
  record(api: 'gecko' | 'dex', queue: QuotaQueue): void;
  getState(): QuotaBudget;
}
```

### 429 Detection Callback (concept from Hummingbot Gateway RPC interceptor, Apache 2.0)

Defense-in-depth layer on top of QuotaManager and RateLimiter. Instead of a JS Proxy wrapper (adds type complexity), we add an `on429` callback directly in each client's existing `get()` method.

**What on429 callback does (3 functions only):**
1. **Detect** — checks if HTTP response status === 429 (already detected in existing retry loop)
2. **Log** — records: which API, which endpoint, timestamp
3. **Feedback** — notifies QuotaManager to reduce allocation for that API

**Implementation — 1 line added to each client's existing get() method:**

```typescript
// In GeckoTerminalClient.get() and DexScreenerClient.get():
private on429?: (path: string) => void;  // set by QuotaManager at init

// Inside the existing 429 retry loop (already in both clients):
if (res.status === 429) {
  this.on429?.(path);  // NEW: feedback to QuotaManager
  // ... existing backoff logic unchanged ...
}
```

**Integration flow:**
```
Request flow:
  Agent/Daemon wants data
    → QuotaManager.acquire(api, queue)     // budget check
    → RateLimiter.schedule(priority, fn)   // token bucket + min interval
    → HTTP request to API
    → If 429:
        on429 callback fires → QuotaManager.reportOverage(api)
        Existing retry logic handles backoff (unchanged)
    → If OK: return response
```

**Why callback instead of Proxy:**
- Simpler: 1 line vs 20-line Proxy wrapper
- Type-safe: no Proxy type erasure issues
- No debugging opacity: stack traces stay clean
- Only wraps HTTP methods (not all client methods)
- Existing retry logic is untouched — callback is additive

### Session Lock Migration

Session lock (`touchSessionLock`, `isAgentSessionActive`) is NOT removed immediately. Migration:

1. Implement QuotaManager alongside session lock
2. Daemon checks both: `isAgentSessionActive() || quotaManager.isAgentActive()`
3. Once stable, deprecate session lock
4. Keep `touchSessionLock()` and `isAgentSessionActive()` as exported functions (backward compatibility) but internally delegate to QuotaManager

---

## V. Data Sources

### DexScreener = Scout Plane

Used for: discovery, cheap ranking, price monitoring, momentum signals.

Currently mapped fields:
- poolAddress, name, baseTokenPriceUsd, reserveInUsd, fdvUsd, marketCapUsd
- volume (h1, h6, h24), priceChange (m5, h1, h6, h24)
- transactions24h, buys24h, sells24h, buySellRatio
- createdAt, baseTokenId, tags

**Fields available in DexPair but NOT mapped (0 additional API requests — data extraction from existing calls):**

| Field | Source | Usage |
|---|---|---|
| dexId | DexPair.dexId | DEX routing (stonfi vs dedust) |
| priceNative | DexPair.priceNative | Relative strength vs TON |
| txns.m5/h1/h6 buys/sells | DexPair.txns | **Critical: needed for buyPressure signal + multi-timeframe momentum** |
| priceChange15m, 30m | NOT available from DexScreener | Currently hardcoded to 0 (available from GeckoTerminal pool endpoint) |
| info.socials | DexPair.info.socials | Legitimacy signal |
| info.websites | DexPair.info.websites | Legitimacy signal |

### V-A. Computed Signals (concept from FreqAI feature engineering, implemented as simple math)

Daemon computes these derived metrics from raw DexScreener data during scout phase. Zero additional API calls — pure arithmetic on data already in PoolInfo.

```typescript
type ComputedSignals = {
  volumeAcceleration: number | null;    // volume1hUsd / (volume6hUsd / 6)
  // > 2.0 = volume accelerating, < 0.5 = decelerating
  // null if volume6hUsd < 100 or pool age < 2h

  buyPressure: number | null;           // buys1h / (buys1h + sells1h)
  // > 0.6 = buyers dominate, < 0.4 = sellers dominate
  // null if (buys1h + sells1h) < 10 (too few trades for meaningful signal)
  // REQUIRES: adding buys1h/sells1h mapping from DexPair.txns.h1 (currently not mapped)

  buyerAcceleration: number | null;     // uniqueBuyers1h / (uniqueBuyers6h / 6)
  // ONLY available during verify phase (data from GeckoTerminal getPoolInfo)
  // NOT available during scout phase (DexScreener has no unique buyers)
  // null if uniqueBuyers6h < 6
};
```

**Data source for each signal:**

| Signal | Scout phase (DexScreener) | Verify phase (GeckoTerminal) |
|---|---|---|
| volumeAcceleration | YES — volume1h, volume6h already mapped | YES |
| buyPressure | YES — after adding txns.h1.buys/sells mapping | YES |
| buyerAcceleration | NO — DexScreener has no unique buyers | YES — transactions.h1.buyers from getPoolInfo |

**Implementation prerequisite:** Add `buys1h`, `sells1h`, `buys6h`, `sells6h` to PoolInfo type and to `mapPairToPoolInfo()`. The data is already in the DexScreener API response (`DexPair.txns.h1.buys/sells`) but is currently discarded during mapping (only h24 is extracted).

### V-B. Confidence Summary (concept from FreqAI prediction_confidence)

After verify_candidate, compute a summary score from all confirming/contradicting signals. This is passed to the LLM agent as INFORMATIONAL INPUT — NOT as a gate, NOT as a position size multiplier.

```typescript
type ConfidenceSummary = {
  score: number;                        // 0-100, higher = more signals confirm
  confirmingSignals: string[];          // e.g. ["organic buyers", "volume accelerating", "gt_score > 50"]
  contradictingSignals: string[];       // e.g. ["low holders", "no locked liquidity"]
};
```

**Why NOT a gate or multiplier:** The existing penalty system (Section VI) already handles position sizing based on the same signals. Using the score as an additional gate would double-count penalties. The LLM agent receives the score as context — it can weigh it alongside narrative factors the score doesn't capture.

**Why NOT anomaly detection (Z-score):** Evaluated and rejected. On TON DEX meme tokens, anomalies ARE the opportunities. Z-score penalizes extreme volume which is exactly what profitable trades look like. Anti-wash check (Section VII) already covers buyer diversity through absolute thresholds. Sample size (50 past candidates) is too small for stable statistics on heterogeneous token types.

**Fields available from separate endpoints (0 ADDITIONAL requests — extracted from existing getTrendingPools/getNewPools calls, requires mapping rework):**

| Field | Source Endpoint | Usage |
|---|---|---|
| boostTotalAmount | /token-boosts/latest/v1 (already called in getTrendingPools) | Attention multiplier |
| cto | /token-profiles/latest/v1 (already called in getNewPools) | Regime switch |

NOTE: boostTotalAmount and cto are NOT in the DexPair response. They come from separate endpoints that daemon already calls. The implementation must extract these values during existing getTrendingPools/getNewPools calls and attach to corresponding PoolInfo entries. This is a mapping rework, not new API calls.

**Fields NOT available from DexScreener at all:**
- uniqueBuyers/uniqueSellers (currently = 0, stubs)
- lockedLiquidityPercent (currently = null, hardcoded)
- priceChange15m, priceChange30m (currently = 0, hardcoded)

### GeckoTerminal = Verify Plane

Used for: safety checks, anti-wash detection, deep analysis.

Currently implemented:
- `getPoolTrades(poolAddress)` — trade history, wallet concentration
- `getPoolOhlcv(poolAddress, timeframe, limit)` — OHLCV candles

**New methods to implement:**

1. `getTokenInfo(tokenAddress)` — Endpoint: `GET /networks/ton/tokens/{tokenAddress}/info`
   - gt_score, gt_score_details
   - holders.count, holders.distribution_percentage (top_10, 11_30, 31_50, rest)
   - is_honeypot (string: 'yes' | 'unknown' | null — NOT boolean)
   - mint_authority, freeze_authority
   - websites, socials

2. `getPoolInfo(poolAddress)` — Endpoint: `GET /networks/ton/pools/{poolAddress}`
   - transactions.{m5..h24}.{buys, sells, buyers, sellers} (unique wallet counts)
   - locked_liquidity_percentage
   - volume_usd.{m15, m30}
   - reserve_in_usd

IMPLEMENTATION NOTE: There are two endpoint variants: `/pools/{addr}` and `/pools/{addr}/info`. Before coding, make a test request to both and confirm which returns the transactions.buyers/sellers fields. This is 10 minutes of verification before starting implementation.

---

## VI. Safety Gate (Hard Constitution)

### Hard Rejects (trade is impossible)

These are deterministic code checks in the safety gate. The LLM cannot bypass them.

| ID | Condition | Reason |
|---|---|---|
| HONEYPOT | tokenInfo.isHoneypot === 'yes' | Cannot sell — funds will be trapped. Note: API returns string 'yes'/'unknown'/null, not boolean. 'unknown' = WARNING not reject. |
| MINT_AUTHORITY | tokenInfo.mintAuthority !== null | Owner can mint tokens, devaluing position |
| FREEZE_AUTHORITY | tokenInfo.freezeAuthority !== null | Owner can freeze tokens, blocking funds |
| DUPLICATE_POSITION | Token already in portfolio | Already exposed to this token |
| POSITION_CAP | Open positions >= maxOpenPositions | Too many positions to monitor |
| EXPOSURE_CAP | Total exposure > maxTotalExposurePercent | Too much capital at risk |
| NOT_TRADEABLE | findToken() === null | Token not available on TractionEye |
| ZERO_LIQUIDITY | geckoPool.reserveInUsd < 500 | Pool too thin for safe execution |
| WASH_CONFIRMED | organicity.verdict === "wash" | Volume is fake |

### Structural Penalties (trade allowed, but position size reduced)

Each penalty multiplies position size. Penalties stack multiplicatively.

| ID | Condition | Multiplier | Example |
|---|---|---|---|
| HIGH_CONCENTRATION | holders.top_10 > 50% | x0.5 | Max 50% of standard size |
| LOW_HOLDERS | holders.count < 100 | x0.7 | |
| LOW_LOCKED_LIQUIDITY | lockedLiquidity !== null && < 30% | x0.6 | |
| TOO_FRESH | Pool age < 30 minutes | x0.5 | |
| CTO_TOKEN | cto === true | x0.8 | |
| HONEYPOT_UNKNOWN | isHoneypot === 'unknown' | x0.9 | Cannot confirm token is safe |
| SUSPICIOUS_ORGANICITY | organicity.verdict === "suspicious" | x0.5 | |

Example: top10 > 50% + holders < 100 + cto = 0.5 x 0.7 x 0.8 = 0.28 -> max 28% of standard position size.

Note on lockedLiquidity:
- `null` (data unavailable from DexScreener) -> WARNING "data unavailable", NOT hard reject
- `0` (explicitly zero) -> HARD REJECT. **VERIFICATION REQUIRED**: Before implementing, fetch locked_liquidity_percentage for 5-10 known-good TON pools from GeckoTerminal. If all return 0 (not null), the API does not distinguish "unlocked" from "no data" on TON — in that case treat 0 same as null (WARNING, not reject).
- `< 30%` (low) -> PENALTY x0.6

### VI-A. Triple Barrier Position Management (borrowed from Hummingbot, Apache 2.0)

Replaces the current TP/SL system with 4 barriers. The daemon evaluates ALL barriers every 30 seconds. Whichever fires first closes the position. This is deterministic code — the LLM does not evaluate barriers.

```typescript
type TripleBarrierConfig = {
  stopLossPercent: number;              // exit if PnL <= -X%
  takeProfitPercent: number;            // exit if PnL >= +X%
  timeLimitSeconds: number | null;      // exit if held longer than N seconds (null = no limit)
  trailingStop: {
    activationPercent: number;          // trailing activates when PnL reaches +X%
    deltaPercent: number;               // trailing stop follows at X% below peak PnL
  } | null;                             // null = no trailing
  partialTp?: {
    triggerPercent: number;             // partial TP at +X%
    sellPercent: number;                // sell Y% of position
  };
};
```

**How trailing stop works (example):**
```
Config: activationPercent: 15, deltaPercent: 5
1. Price rises to +15% → trailing activates, stop set at +10%
2. Price rises to +30% → stop moves to +25%
3. Price rises to +50% → stop moves to +45%
4. Price drops to +45% → TRAILING_STOP fires, sell at +45% profit
Without trailing: TP at +25% would have sold at +25%, missing +20% of profit
```

**How time limit works:**
```
Config: timeLimitSeconds: 7200 (2 hours)
1. Position opened at 14:00
2. Price doesn't hit TP or SL
3. At 16:00 → TIME_LIMIT fires, sell at current price
Without time limit: capital locked indefinitely in stagnant position
```

**How the agent sets barriers:**

1. Playbooks define DEFAULT barrier params per archetype (see Section IX):
```
organic_breakout:
  exits:
    takeProfitPercent: 30
    stopLossPercent: 10
    timeLimitSeconds: 7200
    trailingStop: { activationPercent: 15, deltaPercent: 5 }

paid_attention:
  exits:
    takeProfitPercent: 15
    stopLossPercent: 8
    timeLimitSeconds: 3600          # paid traffic fades fast
    trailingStop: { activationPercent: 10, deltaPercent: 4 }
```

2. Agent reads playbook defaults when buying. Agent CAN override defaults based on analysis.

3. Barriers are set atomically with the buy (via Action Pattern, see VI-B). No gap between buy and protection.

4. **Fallback guarantee:** If a position appears in portfolio without barriers (e.g., agent crash), daemon applies global defaults from riskPolicy. A position without barriers is impossible.

**API budget impact: ZERO.** All 4 barriers use the same price data already fetched by price sentry (DexScreener batch, 1 request per 30s for all positions). No additional API calls.

### VI-A-1. CloseType Enum

Every position closure records WHY it closed. Used for agent reflection, playbook stats, and eval metrics.

```typescript
type CloseType =
  | 'stop_loss'            // barrier: price fell below SL
  | 'take_profit'          // barrier: price reached TP
  | 'partial_tp'           // barrier: partial take profit triggered
  | 'trailing_stop'        // barrier: trailing stop triggered after activation
  | 'time_limit'           // barrier: hold duration exceeded limit
  | 'thesis_exit'          // daemon thesis check detected broken thesis
  | 'safety_degradation'   // re-check found mintAuthority or freezeAuthority
  | 'manual'               // agent or user closed manually
  | 'failed';              // execution error during sell
```

All thesis exit rules (BUYER_DIVERSITY_COLLAPSE, SUSTAINED_NET_SELL, etc.) map to `'thesis_exit'` with specific reason stored in `exitReason` field of the reflection entry.

### VI-B. Action Pattern (borrowed from Hummingbot, Apache 2.0)

Formalizes communication between the agent (decision maker) and daemon (executor). Three action types:

```typescript
type PositionAction =
  | CreatePositionAction
  | StopPositionAction
  | StorePositionAction;

type CreatePositionAction = {
  type: 'create';
  tokenAddress: string;
  poolAddress: string;
  amountNano: string;
  slippageTolerance?: number;
  barriers: TripleBarrierConfig;        // barriers set atomically with buy
  archetype: string;
  entryReason: string;
};

type StopPositionAction = {
  type: 'stop';
  tokenAddress: string;
  closeType: CloseType;                 // why we're closing
  reason: string;                       // human-readable reason
  sellPercent: number;                  // 100 = full exit, <100 = partial
};

type StorePositionAction = {
  type: 'store';
  tokenAddress: string;                 // persist result to reflection_log, free memory
};
```

**How this changes the execution flow:**

```
CURRENT (2 steps, gap between buy and protection):
  Agent calls buy_token(token, amount) → waits for result
  Agent calls set_tp_sl(token, tp, sl) → gap exists

NEW (1 atomic step):
  Agent forms CreatePositionAction { token, amount, barriers }
  → buy_token handler internally:
     1. Safety gate check (hard rejects, penalties)
     2. Apply penalty multiplier to amount
     3. Preview trade via TractionEye
     4. Execute trade via TractionEye
     5. Register ALL barriers in daemon immediately
     6. Write to portfolio_state.json
  → No gap. Position is protected from the first second.
```

**Tool interface stays the same externally.** `buy_token` tool accepts the same parameters plus new optional `barriers` field. If `barriers` not provided, defaults from playbook are used automatically.

### Thesis Exit Rules (position closed by broken thesis)

Beyond barriers, positions close when thesis is invalidated. These are evaluated by daemon thesis-check microcycle (every 60s):

| ID | Condition | Action | CloseType |
|---|---|---|---|
| BUYER_DIVERSITY_COLLAPSE | Current buyer diversity < 30% of entry | Exit 100% | thesis_exit |
| SUSTAINED_NET_SELL | Net buy volume negative for 3 consecutive 15-min periods | Exit 100% | thesis_exit |
| MOMENTUM_DECELERATION | Volume < 30% of entry AND price falling | Exit 50% | thesis_exit |
| ORGANIC_COLLAPSE | uniqueBuyerRatio1h < 0.15 AND boostTotalAmount > 0 | Exit 100% | thesis_exit |
| SAFETY_DEGRADATION | Re-check found mintAuthority or freezeAuthority | Exit 100% | safety_degradation |

### VI-C. Cooldown (borrowed from Hummingbot, Apache 2.0)

After a position closes by stop_loss, thesis_exit, or safety_degradation, the same token cannot be re-bought for a configurable period. Prevents loss cycles where the agent repeatedly buys and gets stopped out on the same token.

**Implementation:**
- Daemon maintains `cooldownMap: Map<tokenAddress, { exitTimestamp: string, closeType: CloseType }>`
- **Persisted to disk** at `~/.tractioneye/state/cooldown.json` using atomic writes. Survives daemon restarts.
- On daemon start: load cooldown.json, filter out expired entries
- On position close (SL/thesis/safety): add entry to map + save to disk
- On every buy_token: check if tokenAddress is in cooldownMap AND `now - exitTimestamp < cooldownAfterExitMinutes`
- If in cooldown → HARD REJECT with reason "Token in cooldown until {timestamp}"
- Cooldown entries cleaned up when TTL expires (during daily cleanup cycle)

**What triggers cooldown:**
- `stop_loss` → cooldown applies
- `thesis_exit` → cooldown applies
- `safety_degradation` → cooldown applies (permanent until removed manually)
- `take_profit`, `trailing_stop`, `time_limit`, `partial_tp` → NO cooldown (profitable/neutral exits)
- `manual` → NO cooldown (user decision)

**Added to Safety Gate hard rejects:**

| ID | Condition | Reason |
|---|---|---|
| COOLDOWN | Token exited by SL/thesis/safety within cooldownAfterExitMinutes | Prevents repeated losses on same token |

### Risk Policy Configuration

Added to DaemonConfig as optional field (backward compatible):

```typescript
riskPolicy?: {
  maxOpenPositions: number;              // default: 5 (can raise to 8 after API limit increase)
  maxTotalExposurePercent: number;       // default: 80
  maxPerTokenPercent: number;            // default: 15
  maxPriceImpactPercent: number;         // default: 5 (already enforced in buy_token tool)
  minLockedLiquidityPercent: number;     // default: 10
  minHoldersCount: number;              // default: 50
  maxTop10HoldersPercent: number;       // default: 60
  cooldownAfterExitMinutes: number;     // default: 120 (2 hours)
  defaultBarriers: TripleBarrierConfig; // fallback if playbook/agent don't specify
  version: number;                       // for tracking policy changes
  updatedAt: string;                     // ISO timestamp
};
```

---

## VII. Anti-Wash Detection (Mandatory)

Anti-wash is NOT optional. It is a required step in verify_candidate. Without passing anti-wash check, a candidate cannot reach "verified" status.

### Organicity Check

```typescript
type OrganicityVerdict = {
  verdict: 'organic' | 'suspicious' | 'wash';
  score: number;                      // 0-100
  signals: OrganicitySignal[];
};

type OrganicitySignal = {
  name: string;
  value: number;
  threshold: number;
  passed: boolean;
};
```

### Mandatory Signals

1. **Buyer diversity ratio (h1)**: unique_buyers / total_buys. Threshold >= 0.2 (20% unique).
2. **Seller diversity ratio (h1)**: unique_sellers / total_sells. Threshold >= 0.15.
3. **Buy-sell wallet overlap**: From trade history — if >50% of wallets both buy AND sell, it's wash.
4. **Top-3 wallet concentration**: If top 3 wallets = >70% of volume, suspicious.
5. **Minimum absolute unique buyers (h1)**: At least 5 unique buyer wallets.

### Verdict Logic

- 0 signals failed = `organic`
- 1-2 signals failed = `suspicious` (PENALTY x0.5 on position size)
- 3+ signals failed = `wash` (HARD REJECT)

### Data Sources for Anti-Wash

- unique buyers/sellers: ONLY from GeckoTerminal pool info (`transactions.*.buyers/sellers`). NOT from DexScreener (currently = 0 stubs).
- Wallet overlap and concentration: From GeckoTerminal trade history (`getPoolTrades`).

---

## VIII. Data Degradation Rules

When external APIs are unavailable or return errors:

| Condition | Effect | Recovery |
|---|---|---|
| GeckoTerminal down (3+ consecutive 429 or timeout) | NEW BUYS FORBIDDEN. Thesis review paused. TP/SL continues via DexScreener prices. | Auto-recovers when Gecko responds. Daemon checks every 60s. |
| DexScreener down | CRITICAL: TP/SL monitoring stopped (no prices). Scout stopped. NEW BUYS FORBIDDEN. | Daemon retries every 30s. Alert if down > 5 min. |
| TractionEye backend down | ALL TRADING STOPPED. No buys, no sells possible. | Daemon retries every 60s. Alert immediately. |
| GeckoTerminal token_info returns null on all fields | Safety gate CANNOT confirm safety. Buy for this token FORBIDDEN. | Retry in 60s. If 3 retries = null -> reject candidate. |
| GeckoTerminal pool_info unique buyers = 0 for all periods | Anti-wash check impossible. Candidate gets WARNING, position size x0.5. | Re-check in 10 min. |
| OHLCV empty after 3 retries (new pool) | Momentum analysis impossible. Buy allowed with PENALTY x0.5 (insufficient data). | Pool is too new for OHLCV. Can return later. |
| Data timestamp mismatch > 5 min between DexScreener and GeckoTerminal | Verify gets `stale_data` WARNING. Not a hard block. | Normal — Gecko caches via Cloudflare for 60s. Small mismatch is expected. |

Key principle: "No data = no buy." If safety gate cannot confirm token safety due to API unavailability, the trade is forbidden. Sells and TP/SL remain operational as long as DexScreener (for prices) and TractionEye backend (for execution) are up.

---

## IX. DEX-Specific Playbooks

### dexId Routing

Field `dexId` from DexScreener DexPair (e.g. 'ston_fi', 'dedust') must be mapped into PoolInfo and used for playbook selection.

### DEX-Specific Defaults

```typescript
const DEX_DEFAULTS: Record<string, DexDefaults> = {
  ston_fi: {
    entryThresholds: {
      minBuyerDiversityRatio: 0.2,
      minVolume1hUsd: 3000,
      minLiquidityUsd: 2000,
    },
    sizing: { maxPositionSizePercent: 15 },
    exits: {
      takeProfitPercent: 25,
      stopLossPercent: 10,
      timeLimitSeconds: 7200,         // 2 hours max hold
      trailingStop: { activationPercent: 15, deltaPercent: 5 },
      thesisReviewInterval: 'PT10M',
    },
  },
  dedust: {
    entryThresholds: {
      minBuyerDiversityRatio: 0.3,
      minVolume1hUsd: 2000,
      minLiquidityUsd: 1500,
    },
    sizing: { maxPositionSizePercent: 12 },
    exits: {
      takeProfitPercent: 20,
      stopLossPercent: 12,
      timeLimitSeconds: 5400,         // 1.5 hours (DeDust less liquid, exit faster)
      trailingStop: { activationPercent: 10, deltaPercent: 4 },
      thesisReviewInterval: 'PT8M',
    },
  },
};
```

### Playbook Format

```typescript
type Playbooks = {
  updatedAt: string;
  version: number;
  archetypes: Record<string, PlaybookEntry>;
};

type PlaybookEntry = {
  name: string;                  // 'organic_breakout' | 'paid_attention' | 'cto_momentum' | 'wash_burst'
  description: string;
  signals: { field: string; condition: string; threshold: unknown }[];
  params: {
    entryThresholds: { minBuyerDiversity: number; minVolume1h: number; minGtScore: number | null };
    sizing: { positionSizePercent: number; maxPerToken: number };
    exits: {
      takeProfitPercent: number;
      stopLossPercent: number;
      timeLimitSeconds: number | null;
      trailingStop: { activationPercent: number; deltaPercent: number } | null;
      thesisHalfLife: string;
    };
  };
  dexOverrides?: {
    stonfi?: Partial<PlaybookEntry['params']>;
    dedust?: Partial<PlaybookEntry['params']>;
  };
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    avgPnlPercent: number;
    lastUpdated: string;
  };
};
```

---

## X. State Layer (6 Artifacts)

Location: `~/.tractioneye/state/`

### Atomic Writes (all JSON state files)

All JSON state files MUST use atomic write pattern to prevent corruption on crash:

```typescript
function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);  // atomic on POSIX filesystems
}
```

If daemon crashes mid-write, either the old complete file remains or the new complete file replaces it. No truncated JSON.

Applies to: market_state.json, candidate_registry.json, portfolio_state.json, playbooks.json, cooldown.json, eval_report.json. Does NOT apply to reflection_log.jsonl (append-only, safe by nature).

### Migration from briefing.json

briefing.json is NOT renamed immediately. Migration is phased:

1. **Phase 1 (parallel):** Create new `state/market_state.json` with extended structure. Daemon writes to BOTH briefing.json (old) and market_state.json (new). Tool `read_briefing` reads from new file internally. Exported functions `briefingPath()` and `readBriefing()` remain functional.
2. **Phase 2 (v2.0):** Remove briefing.json, mark old functions as deprecated, bump major SDK version.

This is necessary because `briefingPath()` and `readBriefing()` are exported as public SDK API (`src/index.ts`). Renaming would break external consumers.

### 10.1 market_state.json

Updated by daemon every screening cycle. Replaces briefing.json.

```typescript
type MarketState = {
  updatedAt: string;
  shortlist: ShortlistEntry[];
  topLists: {
    byVolume: string[];
    byLiquidity: string[];
    byFdv: string[];
    gainers1h: string[];
    gainers24h: string[];
    byTxCount: string[];
  };
  marketRegime: 'active' | 'quiet' | 'volatile';
  // Regime determination: 'active' if avg volumeAcceleration of top-10 > 1.5,
  // 'volatile' if price spread (max-min priceChange1h) > 20%, 'quiet' otherwise.
  tonPriceUsd: number;
  portfolio: PortfolioSummary;
  strategy: StrategySummary;
  pendingVerifications: string[];      // tokenAddresses in 'shortlisted' state awaiting verify
  openPositionReviews: {               // positions with weakened/broken thesis
    tokenAddress: string;
    thesisStatus: 'weakening' | 'broken';
    reason: string;
  }[];
  cooldownTokens: {                    // tokens in cooldown (agent should skip in prioritize)
    tokenAddress: string;
    cooldownUntil: string;             // ISO timestamp
    closeType: CloseType;
  }[];
  playbooks: Playbooks;               // current playbook definitions + stats
  apiUsage: {
    gecko: { used: number; limit: number; windowResetAt: string };
    dex: { used: number; limit: number; windowResetAt: string };
  };
};

type ShortlistEntry = {
  poolAddress: string;
  tokenAddress: string;
  symbol: string;
  dexId: string;
  tags: string[];
  reserveInUsd: number;
  volume1hUsd: number;
  priceChange1h: number;
  uniqueBuyers1h: number | null;        // null during scout (DexScreener has no unique buyers). Populated only after verify (GeckoTerminal).
  boostTotalAmount: number;
  cto: boolean;
  buys1h: number;                       // from DexScreener txns.h1 (after mapping fix)
  sells1h: number;
  volumeAcceleration: number | null;    // computed: volume1h / (volume6h / 6)
  buyPressure: number | null;           // computed: buys1h / (buys1h + sells1h)
  shortlistedAt: string;
  archetype: string | null;
  verificationStatus: 'pending' | 'verified' | 'rejected';
};
```

### 10.2 candidate_registry.json

Updated on every candidate state transition.

```typescript
type CandidateRegistry = {
  candidates: Record<string, CandidateEntry>;  // key = tokenAddress
};

type CandidateEntry = {
  tokenAddress: string;
  poolAddress: string;
  symbol: string;
  dexId: string;
  state: 'discovered' | 'shortlisted' | 'verifying' | 'verified' | 'rejected' | 'watching' | 'bought';
  discoveredAt: string;
  lastUpdatedAt: string;
  discoveryTags: string[];
  archetype: string | null;
  verification: VerificationResult | null;
  rejectionReason: string | null;
  ttl: string;                  // ISO timestamp when entry expires
};
```

State machine:
```
discovered -> shortlisted  (daemon scout picks into shortlist)
shortlisted -> verifying   (agent starts verify_candidate)
verifying -> verified      (verify passes)
verifying -> rejected      (safety or organicity fails)
verified -> watching       (agent decides to watch)
verified -> bought         (agent buys)
watching -> bought         (agent buys later)
rejected -> [removed]      (TTL expires)
bought -> [moves to portfolio_state]
```

### 10.3 portfolio_state.json

Updated on every trade and thesis review.

```typescript
type PortfolioState = {
  updatedAt: string;
  positions: Record<string, PositionThesis>;
};

type PositionThesis = {
  tokenAddress: string;
  poolAddress: string;
  symbol: string;
  dexId: string;
  entryPriceUsd: number;
  entryTimestamp: string;
  amountNano: string;
  entrySizePercent: number;
  archetype: string;
  entryReason: string;
  thesisMetrics: {
    entryBuyerDiversity1h: number;
    entryVolume1h: number;
    entryMomentum: string;
  };
  currentPriceUsd: number | null;
  unrealizedPnlPercent: number | null;
  peakPnlPercent: number;             // highest PnL reached (for trailing stop tracking)
  thesisStatus: 'intact' | 'weakening' | 'broken';
  lastReviewedAt: string;
  barriers: TripleBarrierConfig;       // full barrier config (replaces separate tp/sl fields)
  trailingStopActivated: boolean;      // whether trailing stop has been activated
  exitEvents: {
    timestamp: string;
    type: CloseType;                   // uses CloseType enum from VI-A-1
    pnlPercent: number;
    soldPercent: number;
    reason: string;                    // human-readable reason for reflection
  }[];
};
```

### 10.4 playbooks.json

See section IX for format. Versioned with `version` and `updatedAt`.

### 10.5 reflection_log.jsonl

Append-only. Each line = one JSON entry.

```typescript
type ReflectionEntry = {
  timestamp: string;
  type: 'trade_closed' | 'thesis_review' | 'session_summary' | 'lesson_learned';
  trade?: {
    tokenAddress: string;
    symbol: string;
    archetype: string;
    pnlPercent: number;
    holdDuration: string;
    exitReason: string;
    whatWorked: string;
    whatFailed: string;
    lessonForPlaybook: string;
  };
  session?: {
    candidatesReviewed: number;
    tradesExecuted: number;
    marketRegime: string;
    keyObservation: string;
  };
  lesson?: {
    rule: string;
    evidence: string;
    confidence: 'low' | 'medium' | 'high';
    affectsPlaybook: string | null;
  };
};
```

### 10.6 eval_traces/

Directory. Files: `{timestamp}_{action}.json`.

```typescript
type EvalTrace = {
  timestamp: string;
  action: 'verify' | 'buy' | 'sell' | 'review' | 'scout';
  duration_ms: number;
  toolCalls: { name: string; args: unknown; result: unknown; latency_ms: number }[];
  decision: string;
  outcome?: string;  // filled post-factum when trade closes
};
```

### TTL and Cleanup

Daemon runs cleanup once per day:
- candidate_registry: TTL 24 hours for rejected entries, 7 days for bought entries
- eval_traces/: Keep 14 days, delete older
- reflection_log.jsonl: Keep 30 days, archive older to reflection_archive/

---

## XI. Tools

### Existing Tools — No External Changes

| # | Tool | Change |
|---|---|---|
| 1 | tractioneye_read_briefing | Internal: reads from market_state.json. External name unchanged for backward compatibility. Returns extended data: pendingVerifications, openPositionReviews, apiBudgets, playbooks. |
| 2 | tractioneye_analyze_pool | Renamed to tractioneye_verify_candidate. Old name kept as deprecated alias. Now runs 4-call verify pipeline. |
| 3 | tractioneye_buy_token | Internal: safety gate + cooldown check before preview. Accepts optional `barriers` param (TripleBarrierConfig). If not provided, defaults from playbook by archetype. Barriers registered atomically with buy (Action Pattern). |
| 4 | tractioneye_sell_token | No changes. |
| 5 | tractioneye_set_tp_sl | Extended to accept full TripleBarrierConfig (timeLimitSeconds, trailingStop). Used to MODIFY barriers on already-open positions. Not needed at buy time (barriers set via buy_token). |
| 6 | tractioneye_update_screening_config | Cannot change riskPolicy or global position caps. Only scout-layer params. |
| 7 | tractioneye_get_status | No changes. |
| 8 | tractioneye_screen_tokens | No changes. |
| 9 | tractioneye_find | No changes. |
| 10 | tractioneye_get_token_price | No changes. |
| 11 | tractioneye_get_available_tokens | No changes. |
| 12 | tractioneye_get_simulation_results | No changes. |

### New Tools

| # | Tool | Description |
|---|---|---|
| 13 | tractioneye_review_position | Check thesis for an open position: get fresh data, compare with entry snapshot, return verdict (intact/weakening/broken). |
| 14 | tractioneye_record_reflection | Write a reflection entry to the log. Called by agent after closing position or at end of session. |
| 15 | tractioneye_read_risk_policy | Get current risk caps and limits. Agent cannot change hard policy. |
| 16 | tractioneye_read_api_budget | Get current API quota state. Agent knows its budget. |

### verify_candidate Pipeline (replaces analyze_pool)

4 GeckoTerminal calls:
1. `getTokenInfo(tokenAddress)` -> safety + holders
2. `getPoolInfo(poolAddress)` -> liquidity, unique buyers/sellers, volume
3. `getPoolTrades(poolAddress)` -> trade flow, wallet concentration
4. `getPoolOhlcv(poolAddress)` -> price structure

Returns:
```typescript
type VerificationResult = {
  safety: {
    verdict: 'pass' | 'reject' | 'warning';
    reasons: string[];
    isHoneypot: 'yes' | 'unknown' | null;  // API returns string, not boolean
    mintAuthority: boolean;                 // true if authority exists (derived from string | null)
    freezeAuthority: boolean;
    gtScore: number | null;
  };
  organicity: OrganicityVerdict;  // mandatory anti-wash check
  momentum: {
    volumeTrend: 'accelerating' | 'stable' | 'decelerating';
    buyPressure: number;
    priceAction: 'uptrend' | 'sideways' | 'downtrend';
    ohlcv: OhlcvCandle[];
  };
  execution: {
    reserveInUsd: number;
    lockedLiquidityPercent: number | null;
    priceImpactEstimate: 'low' | 'medium' | 'high';
  };
  computedSignals: ComputedSignals;     // volumeAcceleration, buyPressure, buyerAcceleration
  confidence: ConfidenceSummary;        // informational score for agent (NOT a gate)
  meta: {
    poolAddress: string;
    tokenAddress: string;
    dexId: string;
    poolAge: string;
    geckoCallsUsed: number;
    timestamp: string;
  };
};
```

### buy_token Updated Flow

```
Current:  resolve symbol -> preview -> check impact -> execute -> (agent calls set_tp_sl separately)
New:      resolve symbol -> cooldown check -> reuse cached verify result (or getTokenInfo+getPoolInfo if no cache)
          -> checkSafety -> return penalty breakdown to agent -> agent confirms
          -> apply penalty multiplier to amount -> preview -> execute
          -> register barriers in daemon atomically -> write to portfolio_state
```

**Verify result caching**: If verify_candidate was called for this token within the last 5 minutes, buy_token reuses the cached safety/organicity data. This saves 2 GeckoTerminal requests per buy (getTokenInfo + getPoolInfo already called during verify). Cache key = tokenAddress, TTL = 5 minutes.

**Penalty preview**: buy_token returns the penalty breakdown to the agent BEFORE execution:
```typescript
// If penalties apply, buy_token first returns:
{
  status: 'penalties_applied',
  originalAmountNano: '1000000000',
  adjustedAmountNano: '280000000',       // after 0.5 × 0.7 × 0.8 = 0.28
  penalties: [
    { id: 'HIGH_CONCENTRATION', multiplier: 0.5, reason: 'top 10 holders own 65%' },
    { id: 'LOW_HOLDERS', multiplier: 0.7, reason: 'only 42 holders' },
    { id: 'CTO_TOKEN', multiplier: 0.8, reason: 'community takeover token' },
  ],
  finalMultiplier: 0.28,
  proceed: true   // safety passed, trade will execute with adjusted amount
}
// Agent sees the breakdown. Trade proceeds automatically (no second confirmation needed).
// If agent wants to cancel, it can call sell_token immediately after.
```

Cooldown check is in-memory (zero API calls). Barrier registration is in-memory (zero API calls).

---

## XII. Decision Loop

```
1. OBSERVE    — Daemon scout collects cheap DexScreener signals
2. HYPOTHESIZE — Daemon classifies opportunity archetype (deterministic rules)
3. PRIORITIZE  — Select top-N candidates considering: alpha potential, risk budget,
                 gecko budget, open positions, regime diversity
4. VERIFY      — Agent runs verify_candidate (4 GeckoTerminal calls)
5. DECIDE      — Agent makes bounded decision (buy/watch/reject)
6. EXECUTE     — Only through TractionEye kernel (preview -> validate -> execute)
7. MONITOR     — Daemon thesis check + price sentry (continuous)
8. REFLECT     — Agent updates playbooks and evals
```

---

## XIII. DexScreener Batched Price API

Current `getTokenPrices()` makes sequential calls (1 per token). Must be replaced with batch endpoint.

New method:
```typescript
async getTokenPricesBatch(addresses: string[], priority?: RequestPriority): Promise<Map<string, TokenPrice>>
```

Uses `/latest/dex/tokens/{addr1,addr2,...addr30}` — up to 30 addresses in one request. Critical optimization for position monitoring: 8 positions = 1 request instead of 8.

---

## XIV. Eval Block

### Base PnL — from TractionEye Backend (DO NOT duplicate)

TractionEye backend already provides via `GET /agent/strategy` and `GET /agent/portfolio`:
- Realized PnL per token and total (TON)
- Unrealized PnL per token and total (TON)
- Win rate, max drawdown, trades per week
- PnL by period (day, week, month, year)
- Balance, entry price, current value per token

These metrics are consumed via `tractioneye_get_status` tool. We do NOT recalculate them.

### Extended Metrics (calculated by Agent Kit from own data)

```typescript
type EvalMetrics = {
  // Decision quality (from reflection_log + candidate_registry)
  verifyAccuracy: number;         // % of verified candidates that were profitable
  rejectAccuracy: number;         // % of rejected candidates that actually fell
  washDetectionRate: number;      // % of wash tokens caught by anti-wash

  // Close type histogram (from reflection_log — NOT available from TractionEye backend)
  closeTypeCounts: Record<CloseType, number>;  // how many times each close type fired
  // Example: { stop_loss: 12, take_profit: 8, trailing_stop: 5, time_limit: 3, thesis_exit: 2 }
  // If 80% = stop_loss → strategy is failing. If most = trailing_stop → strategy is working well.

  // Per-archetype performance (from playbooks.stats — NOT available from backend)
  archetypeStats: Record<string, { trades: number; winRate: number; avgPnl: number }>;
  // Example: { organic_breakout: { trades: 15, winRate: 73, avgPnl: 12.5 },
  //            paid_attention: { trades: 8, winRate: 25, avgPnl: -3.2 } }

  // Profit factor (derived from reflection_log)
  profitFactor: number;           // sum of profits / sum of losses

  // Operational (from eval_traces)
  avgVerifyLatencyMs: number;
  apiErrorRate: number;
  geckoUsagePercent: number;
  dexUsagePercent: number;

  // Thesis quality (from reflection_log)
  thesisExitRate: number;         // % of positions closed by thesis break
  thesisExitPnl: number;         // avg PnL on thesis exits
  avgHoldDuration: string;

  // Cooldown effectiveness (from cooldown map)
  cooldownPreventedCount: number; // how many re-buys were blocked by cooldown
};
```

### Baseline

Captured at v2 launch from current v1 performance:

```typescript
type Baseline = {
  capturedAt: string;
  period: string;
  metrics: {
    winRate: number;
    avgPnlPercent: number;
    maxDrawdown: number;
    tradesPerWeek: number;
    // Others = null (no data in v1)
  };
};
```

### Eval Report

File: `~/.tractioneye/state/eval_report.json`. Updated daily by daemon.

```typescript
type EvalReport = {
  generatedAt: string;
  period: { from: string; to: string };
  current: EvalMetrics;
  baseline: Baseline;
  comparison: {
    metric: string;
    current: number;
    baseline: number | null;
    delta: number | null;
    trend: 'improving' | 'stable' | 'degrading' | 'no_baseline';
  }[];
  alerts: string[];
};
```

---

## XV. Compatibility with TractionEye Execution

| Aspect | Status | Action |
|---|---|---|
| POST /agent/preview | Compatible | No changes |
| POST /agent/execute | Compatible | No changes |
| GET /agent/operation/{id} | Compatible | No changes (no webhook available, keep polling) |
| GET /agent/portfolio | Compatible | Used for position state sync |
| GET /agent/strategy | Compatible | No changes |
| GET /agent/assets | Compatible | Used for tradability check in safety gate |
| Idempotency key | Compatible | Already implemented |
| Backend rate limits | None | No limiter needed |

Safety gates (honeypot, mint/freeze, position cap) are SDK-side logic. Backend does NOT check on-chain safety signals. This is correct: backend handles execution correctness, SDK handles trading intelligence.

Backend does NOT enforce position caps — this is SDK responsibility. Safety gate in `buy_token` handler checks portfolio before execution.

---

## XVI. Implementation Phases

| Priority | Phase | Effort | Impact |
|---|---|---|---|
| **P0** | DexScreener batched prices + txns.h1/h6 mapping | 1 day | PREREQUISITE: budget math depends on batching |
| **P0** | Safety gates + GeckoTerminal token/pool info + cooldown (persisted) | 2-3 days | Protection from scams + loss cycles |
| **P0** | DexScreener unused fields mapping (dexId, priceNative, boost, cto) | 0.5 days | Free signals |
| **P0** | Triple barrier (replaces TP/SL) + CloseType enum | 2-3 days | Position protection upgrade |
| **P0** | Atomic writes for all JSON state files | 0.5 days | Crash safety |
| **P1** | verify_candidate pipeline (replaces analyze_pool) + verify cache (5min TTL) | 1-2 days | Decision quality |
| **P1** | Action pattern (atomic buy + barriers + penalty preview) | 1 day | No gap between buy and protection |
| **P1** | State layer (6 artifacts + cooldown.json) | 2-3 days | Persistent memory |
| **P1** | Central quota manager + 429 detection callback | 1-2 days | API budget efficiency + defense-in-depth |
| **P2** | Daemon upgrade -> agent runtime (thesis check light/deep split) | 3-5 days | Always-on capability |
| **P2** | DEX-specific playbooks with barrier defaults | 1-2 days | Precision |
| **P3** | New tools (review_position, record_reflection, read_risk_policy, read_api_budget) | 1-2 days | Agent capability |
| **P3** | Trading skill rewrite | 1 day | Align with new architecture |
| **P3** | Eval block + baseline (close type histogram, archetype stats) | 1-2 days | Performance tracking |

Total estimate: 17-27 working days, with incremental delivery — each phase is deployable independently.

### Attribution

**From Hummingbot** (Apache 2.0 license, github.com/hummingbot):
- Triple barrier position management: SL + TP + time limit + trailing stop (from PositionExecutor)
- Action pattern: atomic Create/Stop/Store position actions (from executor_actions)
- CloseType enum: 9 close reasons for auditability (from executor models)
- Cooldown mechanism: prevent re-buying after stop-loss (from DirectionalTradingControllerBase)
- 429 Proxy detection: defense-in-depth rate limit detection (from Gateway RPC interceptor)

**From FreqAI** (concepts only, no code — FreqAI is GPL v3):
- Computed signals: derived metrics from raw data (volumeAcceleration, buyPressure, buyerAcceleration) — concept from FreqAI's feature engineering pipeline
- Confidence summary: aggregate signal quality score as informational input — concept from FreqAI's prediction_confidence

**Evaluated and rejected:**
- FreqAI anomaly detection (Z-score): wrong assumption for meme tokens where anomaly = opportunity
- FreqAI dynamic thresholds (confidenceMultiplier): sample too small at 2-5 trades/day, death spiral risk
- FreqAI ML models (LightGBM, RL): insufficient historical data on TON DEX short-lived tokens
- Hummingbot Quote Cache: TractionEye execution flow doesn't reuse quote data
- Hummingbot MQTT orchestration: premature for single-daemon architecture

---

## XVII. Versioning

### Playbooks and Risk Policy

Both `playbooks.json` and `riskPolicy` in config include:
- `version: number` — incremented on each change
- `updatedAt: string` — ISO timestamp

Rollback is via git (files are committed to repo). No separate rollback mechanism needed at this stage.

---

## XVIII. Pre-Implementation Verification Tasks

These must be completed BEFORE coding begins (10-15 minutes total):

1. **GeckoTerminal pool endpoint**: Fetch `/api/v2/networks/ton/pools/{pool_address}` for a real TON pool. Confirm that `transactions.h1.buyers` field exists. Record the confirmed endpoint path in this spec.

2. **locked_liquidity_percentage on TON**: Fetch the above endpoint for 5-10 known-good TON pools (e.g., TON/USDT on Ston.fi v2). Check if `locked_liquidity_percentage` returns `null` or `0`. If all return `0`, change spec: treat `0` as WARNING (same as null), not HARD REJECT.

3. **is_honeypot on TON meme tokens**: Fetch `/api/v2/networks/ton/tokens/{addr}/info` for 3-5 meme tokens. Confirm that `is_honeypot` returns 'yes'/'unknown'/null (not true/false). Record observed values.

---

## XIX. What NOT To Do

1. Do NOT create 5 separate LLM agents — one agent + structured daemon pipeline
2. Do NOT run LLM every 30-180 seconds — daemon handles microcycles deterministically, LLM only on events/schedule
3. Do NOT change TractionEye backend API — all safety gates are SDK-side
4. Do NOT create a separate "Agent Runtime Daemon" process — extend the existing daemon
5. Do NOT rewrite from scratch — incremental refactoring of existing code
6. Do NOT rename briefing.json immediately — parallel operation first, then deprecation
7. Do NOT remove session lock immediately — run alongside quota manager, then deprecate
