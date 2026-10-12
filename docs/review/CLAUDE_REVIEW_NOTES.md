# Engineering Review Notes: Ichimoku + RSI Strategy Implementation

## 1. System Header
- **Date:** 2026-10-12T08:54:12.703Z
- **Git Commit:** `0006e8b`
- **Node Version:** `v22.19.0`
- **Operating System:** `win32 10.0.26200 (x64)`
- **Target Repository:** `sharkNight` (Crypto Trading Bot & Backtester)

---

## 2. Reviewer Checklist & Codebase Map
Below is a structured map of changed and newly implemented components:
- **Ichimoku Indicator:** [`src/indicators/ichimoku.ts`](../../src/indicators/ichimoku.ts)
  - High/Low midpoints for Tenkan-sen and Kijun-sen.
  - Forward shifted Senkou Span A and B (length $N + \text{displacement}$).
  - Backward shifted Chikou Span with last `displacement` entries filled with `NaN`.
- **Backtest Engine & 1x Short Accounting:** [`src/backtest/portfolio.ts`](../../src/backtest/portfolio.ts), [`src/backtest/engine.ts`](../../src/backtest/engine.ts), [`src/backtest/types.ts`](../../src/backtest/types.ts)
  - Added `tradeMode: 'long-short' | 'long-only'` (default: `'long-short'`).
  - 1x short accounting without leverage, funding, or liquidation: `quantity = (allocated - fee) / entryPrice`, mark-to-market continuous equity.
  - Engine-level Take-Profit and Stop-Loss checked at candle close prior to signal processing without accidental reversals.
  - Long and short breakdown metrics (`totalTrades`, `winRate`, `totalPnl`).
- **Ichimoku + RSI Strategy:** [`src/strategies/ichimoku-rsi-strategy.ts`](../../src/strategies/ichimoku-rsi-strategy.ts)
  - Stateless trigger: BUY on fresh TK up-cross with RSI in [20,40] within `rsiLookback` candles.
  - SELL on fresh TK down-cross with RSI in [60,80] within `rsiLookback` candles.
  - Indicator array caching per `readonly Candle[]` reference via `WeakMap`.
- **Removed Deprecated Components:**
  - Deleted `src/strategies/modular-strategy.ts` and `tests/strategies/modular-strategy.test.ts`.
  - Deleted `src/app/components/MacdSubChart.tsx`.
- **Dashboard UI & Charting:** [`src/app/page.tsx`](../../src/app/page.tsx), [`src/app/components/CandleChart.tsx`](../../src/app/components/CandleChart.tsx), [`src/app/components/TradesTable.tsx`](../../src/app/components/TradesTable.tsx)
  - Client-side Ichimoku and RSI calculation (zero server dependence for overlays).
  - Custom canvas primitive for Ichimoku Cloud filling (green/red) with forward displacement timestamps.
  - Direction-aware markers for long/short entries, exits, and reversals.
  - Signal Funnel diagnostics display card.
- **Parameter Optimizer:** [`src/scripts/optimize.ts`](../../src/scripts/optimize.ts)
  - 70% train / 30% test chronological walk-forward grid search on real datasets.
  - Parameter stability neighbor analysis (Robust vs. Fragile).
- **Documentation & Review:** [`docs/strategies/STRATEGIES_LOG.md`](../../docs/strategies/STRATEGIES_LOG.md), [`README.md`](../../README.md), [`src/scripts/review-notes.ts`](../../src/scripts/review-notes.ts)

---

## 3. Environment Verification
| Tool | Command | Exit Code | Status | Notes |
|---|---|---|---|---|
| TypeScript Compiler | `npx tsc --noEmit` | 0 | ✅ PASS | Clean type check (0 errors) |
| ESLint | `npm run lint` | 0 | ✅ PASS | > tradebot@0.1.0 lint > eslint src/ tests/ |
| Jest | `npm test` | 0 | ✅ PASS | All tests passed cleanly |

---

## 4. Historical Data Coverage (Real Data Verification)
All backtests and optimization runs use real historical datasets cached in `data/`. Synthetic data is strictly rejected:

| Symbol | Interval | Candle Count | Period Start | Period End | Gaps (>1.5x) | Synthetic Flag |
|---|---|---|---|---|---|---|
| BTCUSDT | 1h | 17,532 | 2024-10-11T20:00:00Z | 2026-10-12T07:00:00Z | 0 | ✅ NO (Real) |
| BTCUSDT | 4h | 4,383 | 2024-10-11T20:00:00Z | 2026-10-12T04:00:00Z | 0 | ✅ NO (Real) |
| ETHUSDT | 1h | 17,532 | 2024-10-11T20:00:00Z | 2026-10-12T07:00:00Z | 0 | ✅ NO (Real) |
| ETHUSDT | 4h | 4,383 | 2024-10-11T20:00:00Z | 2026-10-12T04:00:00Z | 0 | ✅ NO (Real) |

---

## 5. Signal Funnel Analysis (Lookback Impact Proof)
The table below evaluates signal flow across real candle data for `rsiLookback` $\in \{1, 5, 10, 20\}$.
Notice that when $\text{lookback} = 1$ (same-candle confluence only), the lagging nature of the TK cross means the RSI is rarely inside the extreme zone on the exact cross candle, yielding almost 0 trades. Setting $\text{lookback} = 10$ unlocks valid setups where RSI reached the extreme zone recently before the trend confirmation.

| Symbol | TF | Lookback | Total Candles | RSI [20,40] | RSI [60,80] | TK Cross Up | TK Cross Down | BUY Setups | SELL Setups | Executed (Long / Short) |
|---|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT | 1h | 1 | 17,532 | 3,143 | 3,536 | 451 | 454 | 8 | 8 | **3** / **4** |
| BTCUSDT | 1h | 5 | 17,532 | 3,143 | 3,536 | 451 | 454 | 22 | 30 | **12** / **13** |
| BTCUSDT | 1h | 10 | 17,532 | 3,143 | 3,536 | 451 | 454 | 153 | 162 | **92** / **91** |
| BTCUSDT | 1h | 20 | 17,532 | 3,143 | 3,536 | 451 | 454 | 287 | 285 | **186** / **186** |
| BTCUSDT | 4h | 1 | 4,383 | 783 | 934 | 109 | 111 | 1 | 1 | **1** / **1** |
| BTCUSDT | 4h | 5 | 4,383 | 783 | 934 | 109 | 111 | 6 | 6 | **4** / **4** |
| BTCUSDT | 4h | 10 | 4,383 | 783 | 934 | 109 | 111 | 41 | 37 | **20** / **21** |
| BTCUSDT | 4h | 20 | 4,383 | 783 | 934 | 109 | 111 | 73 | 76 | **48** / **48** |
| ETHUSDT | 1h | 1 | 17,532 | 3,177 | 3,492 | 480 | 473 | 9 | 10 | **2** / **2** |
| ETHUSDT | 1h | 5 | 17,532 | 3,177 | 3,492 | 480 | 473 | 38 | 38 | **18** / **18** |
| ETHUSDT | 1h | 10 | 17,532 | 3,177 | 3,492 | 480 | 473 | 150 | 195 | **96** / **96** |
| ETHUSDT | 1h | 20 | 17,532 | 3,177 | 3,492 | 480 | 473 | 304 | 307 | **198** / **199** |
| ETHUSDT | 4h | 1 | 4,383 | 796 | 903 | 109 | 111 | 3 | 0 | **1** / **0** |
| ETHUSDT | 4h | 5 | 4,383 | 796 | 903 | 109 | 111 | 8 | 5 | **4** / **3** |
| ETHUSDT | 4h | 10 | 4,383 | 796 | 903 | 109 | 111 | 38 | 49 | **27** / **27** |
| ETHUSDT | 4h | 20 | 4,383 | 796 | 903 | 109 | 111 | 69 | 77 | **51** / **51** |

---

## 6. Default Backtest Results
Parameters: Tenkan 9, Kijun 26, Senkou B 52, Displacement 26, RSI 14, Buy [20,40], Sell [60,80], Lookback 10, Mode `long-short`, Fee 0.1%, Position 100%, Initial $10,000, No TP/SL.

| Metric | BTCUSDT (1h) | ETHUSDT (1h) |
|---|---|---|
| Total Candles | 17,532 | 17,532 |
| Net PnL ($) | $-8320.74 | $-908.44 |
| Net PnL (%) | -83.21% | -9.08% |
| Buy & Hold Return | 33.57% | 4.65% |
| Max Drawdown (%) | 85.58% | 67.12% |
| Max Drawdown Duration | 16907 candles | 12503 candles |
| Win Rate (Overall) | 42.6% | 49.0% |
| Win Rate (Long / Short) | 47.8% / 37.4% | 45.8% / 52.1% |
| Total Trades | 183 | 192 |
| Long Trades / Short Trades | 92 / 91 | 96 / 96 |
| Profit Factor | 0.51 | 0.98 |
| Sharpe Ratio | -0.18 | 0.04 |

---

## 7. Sample Trade Logs (BTCUSDT 1h Default Backtest)
First 5 and last 5 executed trades:

| # | Side | Entry Time | Entry Price | Exit Time | Exit Price | PnL ($) | PnL (%) | Exit Reason |
|---|---|---|---|---|---|---|---|---|
| 1 | **LONG** | 2024-10-14T01:00:00Z | $62630.8 | 2024-10-15T11:00:00Z | $65400.0 | $421.27 | 4.21% | `reverse` |
| 2 | **SHORT** | 2024-10-15T11:00:00Z | $65400.0 | 2024-10-22T22:00:00Z | $67719.2 | $-379.97 | -3.65% | `reverse` |
| 3 | **LONG** | 2024-10-22T22:00:00Z | $67719.2 | 2024-10-25T07:00:00Z | $67522.9 | $-49.12 | -0.49% | `reverse` |
| 4 | **SHORT** | 2024-10-25T07:00:00Z | $67522.9 | 2024-11-01T15:00:00Z | $69389.0 | $-286.13 | -2.86% | `reverse` |
| 5 | **LONG** | 2024-11-01T15:00:00Z | $69389.0 | 2024-11-01T23:00:00Z | $69495.2 | $-4.58 | -0.05% | `reverse` |
| 179 | **LONG** | 2026-09-13T20:00:00Z | $77339.4 | 2026-09-15T05:00:00Z | $77637.5 | $3.29 | 0.18% | `reverse` |
| 180 | **SHORT** | 2026-09-15T05:00:00Z | $77637.5 | 2026-09-24T18:00:00Z | $84466.5 | $-158.61 | -8.90% | `reverse` |
| 181 | **LONG** | 2026-09-24T18:00:00Z | $84466.5 | 2026-09-27T22:00:00Z | $84198.6 | $-8.39 | -0.52% | `reverse` |
| 182 | **SHORT** | 2026-09-27T22:00:00Z | $84198.6 | 2026-10-09T03:00:00Z | $82423.8 | $32.45 | 2.01% | `reverse` |
| 183 | **LONG** | 2026-10-09T03:00:00Z | $82423.8 | 2026-10-12T07:00:00Z | $84135.3 | $30.86 | 1.87% | `end` |

---

## 8. Automated Self-Checks & Integrity Invariants
The review script performed runtime assertions on strategy invariants:

| Check | Result | Assertion Note |
|---|---|---|
| Indicator Shift Alignment | ✅ PASS | Senkou length: 126 (expected 126), Chikou[73] valid, Chikou[74] NaN |
| Strategy Statelessness | ✅ PASS | Prefix candles[0..i] yields identical signal to full series at index i |
| 1x Short Accounting Direction & Fees | ✅ PASS | 10% drop gives PnL +$990.01, 10% rise gives PnL $-1009.99 |
| Cash Conservation Identity | ✅ PASS | |initialBalance + sum(tradePnl) - finalEquity| = 2.5011e-12 <= 1e-6 |
| Zero Lookahead Bias | ✅ PASS | Mutating future candle index 99 does not alter signals at earlier indices |
| Obsolete Files Cleaned Up | ✅ PASS | modular-strategy: DELETED, MacdSubChart: DELETED |

---

## 9. Parameter Optimization Highlights
### BTCUSDT Parameter Search
| Rank | Timeframe | Ichimoku | RSI Buy | RSI Sell | Lookback | Trade Mode | Train Ret | Train B&H | Test Ret | Test B&H | Test MaxDD | Test WinRate | Trades (Train/Test) | Calmar | Neighbor Avg | Stability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1h | 10/30/60 | [20,35] | [65,80] | 5 | long-short | 20.46% | 8.12% | 2.7% | 23.59% | 4.58% | 100% | 4/1 | 0.59 | 0.91% | ✅ Robust |
| 2 | 1h | 10/30/60 | [20,40] | [65,80] | 10 | long-only | 33.82% | 8.12% | 12.31% | 23.59% | 30.8% | 66.7% | 10/6 | 0.4 | 4.19% | ✅ Robust |
| 3 | 1h | 10/30/60 | [25,40] | [65,80] | 10 | long-only | 33.82% | 8.12% | 12.31% | 23.59% | 30.8% | 66.7% | 10/6 | 0.4 | 6.82% | ✅ Robust |
| 4 | 1h | 9/26/52 | [20,40] | [65,80] | 10 | long-only | 1.27% | 8.12% | 10.9% | 23.59% | 29.2% | 63.2% | 20/19 | 0.37 | 5.41% | ✅ Robust |
| 5 | 1h | 9/26/52 | [25,40] | [65,80] | 10 | long-only | 1.27% | 8.12% | 10.9% | 23.59% | 29.2% | 63.2% | 20/19 | 0.37 | 3.88% | ✅ Robust |
| 6 | 4h | 10/30/60 | [20,35] | [65,80] | 20 | long-only | 6.73% | 8.91% | 6.36% | 24.01% | 24.94% | 83.3% | 22/6 | 0.26 | 0.6% | ✅ Robust |
| 7 | 1h | 7/22/44 | [20,40] | [65,80] | 5 | long-only | 11.05% | 8.12% | 1.9% | 23.59% | 29.34% | 50% | 4/2 | 0.06 | 12.29% | ✅ Robust |
| 8 | 1h | 7/22/44 | [25,40] | [65,80] | 5 | long-only | 11.05% | 8.12% | 1.9% | 23.59% | 29.34% | 50% | 4/2 | 0.06 | 8.33% | ✅ Robust |
| 9 | 1h | 10/30/60 | [20,40] | [65,80] | 10 | long-short | 50.19% | 8.12% | 1.58% | 23.59% | 35.37% | 66.7% | 20/12 | 0.04 | -11.65% | ⚠️ Fragile |
| 10 | 1h | 10/30/60 | [25,40] | [65,80] | 10 | long-short | 50.19% | 8.12% | 1.58% | 23.59% | 35.37% | 66.7% | 20/12 | 0.04 | -7% | ⚠️ Fragile |

### ETHUSDT Parameter Search
| Rank | Timeframe | Ichimoku | RSI Buy | RSI Sell | Lookback | Trade Mode | Train Ret | Train B&H | Test Ret | Test B&H | Test MaxDD | Test WinRate | Trades (Train/Test) | Calmar | Neighbor Avg | Stability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1h | 7/22/44 | [20,40] | [65,80] | 10 | long-short | 101.3% | -19.41% | 68.92% | 30.18% | 39.14% | 58.8% | 120/80 | 1.76 | 22.88% | ✅ Robust |
| 2 | 1h | 7/22/44 | [25,40] | [65,80] | 10 | long-short | 101.3% | -19.41% | 68.92% | 30.18% | 39.14% | 58.8% | 120/80 | 1.76 | 16.2% | ✅ Robust |
| 3 | 1h | 9/26/52 | [20,40] | [60,80] | 10 | long-only | 5.68% | -19.41% | 20.85% | 30.18% | 15.68% | 48.7% | 58/37 | 1.33 | 28.06% | ✅ Robust |
| 4 | 1h | 9/26/52 | [20,40] | [60,75] | 10 | long-only | 5.68% | -19.41% | 20.85% | 30.18% | 15.68% | 48.7% | 58/37 | 1.33 | 28% | ✅ Robust |
| 5 | 1h | 7/22/44 | [20,40] | [65,80] | 10 | long-only | 33.31% | -19.41% | 42.63% | 30.18% | 37.61% | 67.5% | 60/40 | 1.13 | 23.3% | ✅ Robust |
| 6 | 1h | 7/22/44 | [25,40] | [65,80] | 10 | long-only | 33.31% | -19.41% | 42.63% | 30.18% | 37.61% | 67.5% | 60/40 | 1.13 | 20.18% | ✅ Robust |
| 7 | 1h | 7/22/44 | [20,35] | [65,80] | 10 | long-only | 43.02% | -19.41% | 1.47% | 30.18% | 29.83% | 61.5% | 41/26 | 0.05 | 10.47% | ✅ Robust |

## Parameter Stability Analysis
- **Robust:** The parameters surrounding this combination (one grid step away in Ichimoku, RSI zones, or Lookback) also generate positive returns on test data.

---

## 10. Honest Engineering Limitations
- **1x Short Selling Only:** No leverage, margin calls, or liquidation models are simulated. While this provides safe risk bounds, it does not reflect the mechanics of high-leverage perpetual contracts.
- **No Funding Rate Modeling:** Perpetual swap funding payments are omitted. In persistent bull markets, short positions would incur negative funding rates, slightly reducing net short returns.
- **Zero Slippage Assumption:** Fills are executed at the candle close. In live execution, market orders on high-volatility candles may experience minor slippage against the recorded close.
- **TK Cross Latency:** The Tenkan/Kijun cross is inherently a lagging trend trigger. Although the configurable `rsiLookback` window bridges the gap between momentum extremity and trend confirmation, trades are entered after initial directional momentum has begun.