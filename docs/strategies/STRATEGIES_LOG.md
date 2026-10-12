# Strategies Log

This document tracks all trading strategies tested, their parameters, results, and lessons learned.
When a strategy fails or underperforms, the analysis and proposed improvements are documented here.

---

## Strategy Template

When adding a new strategy, copy this template:

```
### Strategy Name
- **Type:** (Trend Following / Mean Reversion / Momentum / etc.)
- **Indicators Used:** (SMA, RSI, etc.)
- **Parameters:** (period: 14, threshold: 70, etc.)
- **Timeframe:** (1h, 4h, 1d)
- **Symbol:** (BTCUSDT, ETHUSDT)

#### Backtest Results
| Metric | Value |
|--------|-------|
| Period | |
| Total Trades | |
| Win Rate | |
| Total PnL | |
| Max Drawdown | |
| Sharpe Ratio | |

#### Analysis
- What worked:
- What didn't work:
- Possible improvements:

#### Status: ✅ Active / ❌ Abandoned / 🔄 Needs Improvement
```

---

## Tested Strategies

### SMA Crossover Strategy
- **Type:** Trend Following (Moving Average Crossover)
- **Indicators Used:** Fast SMA, Slow SMA
- **Default Parameters:** fastPeriod: 10, slowPeriod: 30, source: 'close'
- **Signal Conditions:**
  - **BUY (Golden Cross):** Fast SMA crosses strictly above Slow SMA (`prevFast <= prevSlow && currentFast > currentSlow`)
  - **SELL (Death Cross):** Fast SMA crosses strictly below Slow SMA (`prevFast >= prevSlow && currentFast < currentSlow`)
  - **HOLD:** No crossover or insufficient history
- **Status:** ✅ Tested & Live in Dashboard (Phase 5 & Phase 7)

---

## Failed Strategies & Lessons

_No failures recorded yet._

---

## Ideas & Backlog

- [ ] SMA Crossover (Fast/Slow MA)
- [ ] RSI Overbought/Oversold
- [ ] MACD Signal Line Crossover
- [ ] Bollinger Bands Squeeze
- [ ] Combined: RSI + MA Trend Filter

---

> This is a living document. Update after every backtest run.

### Ichimoku + RSI Strategy (Strategy 1 Replacement)
- **Type:** Trend Following + Momentum Zone Filter (Ichimoku TK Cross + RSI)
- **Indicators Used:** Ichimoku Kinko Hyo (Tenkan-sen, Kijun-sen, Senkou Span A/B, Chikou Span), Relative Strength Index (RSI)
- **Default Parameters:**
  - Tenkan-sen: 9
  - Kijun-sen: 26
  - Senkou Span B: 52
  - Displacement: 26
  - RSI Period: 14
  - RSI Buy Zone: [20, 40]
  - RSI Sell Zone: [60, 80]
  - RSI Lookback: 10
  - Trade Mode: `long-short` (default) or `long-only`
- **Signal Conditions:**
  - **BUY Signal:** Tenkan crosses strictly UP through Kijun (`currentRelation === +1 && lastNonZero === -1`) on current candle close AND RSI is within [buyMin, buyMax] on the current candle OR any of the prior `rsiLookback` candles. Opens a long position (or closes short and reverses to long in `long-short` mode).
  - **SELL Signal:** Tenkan crosses strictly DOWN through Kijun (`currentRelation === -1 && lastNonZero === +1`) on current candle close AND RSI is within [sellMin, sellMax] on current candle OR any of the prior `rsiLookback` candles. Opens a short position (or closes long and reverses to short in `long-short` mode).
  - **HOLD:** No fresh TK cross or RSI outside zone.
- **Engine Features & Accounting:**
  - **Full 1x Short Accounting:** `quantity = (allocated - entryFee) / entryPrice`, mark-to-market continuous equity. Exit PnL: `quantity * (entryPrice - exitPrice) - exitFee - entryFee`.
  - **Engine-Level Exits:** Independent Take-Profit, Stop-Loss, and Trailing Stop evaluated at intrabar candle boundaries prior to signal processing. If position closes flat from a stop, same-candle close signal processing continues to allow new setups.
  - **Dynamic Trailing Stop Ratchet:**
    - Config: `{ initialStopPercent, stepPercent, raisePercent }`, `slippagePercent`, `stopCheckMode: 'intrabar' | 'close'`.
    - Stop starts at `entry * (1 - initialStop/100)` for longs (`(1 + initialStop/100)` for shorts).
    - As favorable excursion ($MFE\%$) grows, stop ratchets forward by `raisePercent` for every completed `stepPercent`: $\text{stop}\% = -\text{initialStop}\% + \lfloor MFE\% / \text{step}\% \rfloor \times \text{raise}\%$.
    - Monotonic: stop never retreats. Checked using the previous candle's stop level against current candle's open/low/high to prevent look-ahead bias.
    - If both TP and Stop touch in the same bar, Stop is conservatively assumed to hit first.
- **Status:** ✅ Active Strategy & Implemented in Dashboard / API

#### Engineering Review Bug Fixes (A1 - A4)
- **A1 (Short Entry Fee Charging):** Previously, short `closePosition` omitted `entryFee` in the net PnL calculation, meaning earlier short-side backtest returns were slightly optimistic (~0.1% fee per short trade). Now verified: 10% price drop on $10,000 short yields +$980.01; 10% rise yields -$1019.99; flat round-trip costs -$19.99 on both sides.
- **A2 (TK Cross from Equality Plateaus):** Replaced `prevTenkan <= prevKijun` with stateful sign-relation scanning (`+1, 0, -1`) back to the last non-zero relation. Eliminated ~45 phantom cross events on BTCUSDT 1h and ~49 on ETHUSDT 1h caused by midpoint equality plateaus.
- **A3 (Optimizer Qualification Filter Enforcement):** Fixed silent fallback where low-trade combos were ranked as "Top". The optimizer now strictly enforces `Train Trades >= 30, Test Trades >= 10, Return > 0`. If none pass, it outputs "NO ROBUST COMBINATION FOUND" and isolates relaxed rows into an explicit informational table with sample-size warnings.
- **A4 (Signal Processing Preserved After Intrabar Stop):** When a trade exits via stop-out or TP on candle $i$, the engine now proceeds to analyze the strategy at candle close, ensuring fresh cross triggers occurring on the same bar are executed rather than lost.

#### Backtest & Optimization Highlights (Real Data, 70/30 Train/Test Split)
- **ETHUSDT (1h):**
  - Parameter Combo: 9/26/52, RSI Buy [20,40], RSI Sell [60,80], Lookback: 5, Trailing Stop: `5/10/5`, Mode: `long-short`
  - Train Net Return: **+2.74%** (38 trades) | Test Net Return: **+112.84%** (13 trades) | Test Max DD: 13.19% | Calmar: 8.55 (✅ Robust)
  - Baseline Without Trailing: Test Net Return: **+147.19%** (Test DD: 22.45%)
  - Parameter Combo: 7/22/44, RSI Buy [20,40], RSI Sell [65,80], Lookback: 10, Trailing Stop: `5/10/5`, Mode: `long-short`
  - Train Net Return: **+63.79%** (179 trades) | Test Net Return: **+66.59%** (93 trades) | Test DD: 27.61% | Calmar: 2.41 (✅ Robust)
  - Note: Trailing stop improves return over baseline (+4.27% diff) while cutting maximum drawdown.
- **BTCUSDT (1h):**
  - Parameter Combo: 10/30/60, RSI Buy [20,40], RSI Sell [65,80], Lookback: 10, Trailing Stop: `3/3/1.5`, Mode: `long-only`
  - Train Net Return: **+6.26%** (33 trades) | Test Net Return: **+8.09%** (16 trades) | Test DD: 19.97% | Calmar: 0.41 (✅ Robust)
  - Baseline Without Trailing: Test Net Return: **+12.31%** (22 trades)
- **Key Empirical Lessons:**
  - Lookback parameter ($L=10$) is essential: with $L=1$ (same candle), signal count is near zero because lagging TK crosses rarely coincide with the exact extreme RSI candle.
  - Setting $L=20$ produces high trade frequency but degrades win rate due to false signals in chop.
  - Asymmetric RSI sell zone threshold [65, 80] vs [60, 80] significantly cuts unprofitable short entries.
  - Trailing stops significantly compress drawdown on high-volatility pairs (e.g. ETHUSDT DD reduced from 67% to 51% on default settings) and limit maximum adverse loss.
- **Reports:**
  - [OPTIMIZATION_ICHIMOKU_BTCUSDT_2026-10-12.md](./OPTIMIZATION_ICHIMOKU_BTCUSDT_2026-10-12.md)
  - [OPTIMIZATION_ICHIMOKU_ETHUSDT_2026-10-12.md](./OPTIMIZATION_ICHIMOKU_ETHUSDT_2026-10-12.md)
  - [CLAUDE_REVIEW_NOTES.md](../review/CLAUDE_REVIEW_NOTES.md)

---

### [REPLACED] Strategy 1 (Triple Confluence: EMA + MACD + RSI)
- **Type:** Trend Following + Momentum Reversal (EMA + MACD + RSI)
- **Status:** ❌ Deprecated and replaced by Ichimoku + RSI Strategy (`IchimokuRsiStrategy`).
- **Archive Report:** [OPTIMIZATION_BTCUSDT_2026-10-12.md](./OPTIMIZATION_BTCUSDT_2026-10-12.md)
