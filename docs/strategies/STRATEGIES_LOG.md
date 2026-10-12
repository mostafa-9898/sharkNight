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
  - **BUY Signal:** Tenkan crosses strictly UP through Kijun (`prevTenkan <= prevKijun && tenkan > kijun`) on current candle close AND RSI is within [buyMin, buyMax] on the current candle OR any of the prior `rsiLookback` candles. Opens a long position (or closes short and reverses to long in `long-short` mode).
  - **SELL Signal:** Tenkan crosses strictly DOWN through Kijun (`prevTenkan >= prevKijun && tenkan < kijun`) on current candle close AND RSI is within [sellMin, sellMax] on current candle OR any of the prior `rsiLookback` candles. Opens a short position (or closes long and reverses to short in `long-short` mode).
  - **HOLD:** No fresh TK cross or RSI outside zone.
- **Engine Features:**
  - Full 1x short accounting (`allocated * (1 - fee) / entryPrice`, mark-to-market continuous equity).
  - Independent engine-level Take-Profit and Stop-Loss evaluated prior to signal processing.
- **Status:** ✅ Active Strategy & Implemented in Dashboard / API

#### Backtest & Optimization Highlights (Real Data, 70/30 Train/Test Split)
- **ETHUSDT (1h):**
  - Parameter Combo: 7/22/44, RSI Buy [20,40], RSI Sell [65,80], Lookback: 10, Mode: `long-short`
  - Train Net Return: **+101.30%** (120 trades) | Test Net Return: **+68.92%** (80 trades)
  - Test Max Drawdown: 39.14% | Calmar: 1.76 | Neighbor Avg Return: 22.88% (✅ Robust)
  - Default Setting (9/26/52, L=10, `long-only`): Train Ret: **+5.68%** | Test Ret: **+20.85%** | Test DD: 15.68% | Calmar: 1.33 (✅ Robust)
- **BTCUSDT (1h):**
  - Parameter Combo: 10/30/60, RSI Buy [20,40], RSI Sell [65,80], Lookback: 10, Mode: `long-only`
  - Train Net Return: **+33.82%** (10 trades) | Test Net Return: **+12.31%** (6 trades)
  - Calmar: 0.40 | Neighbor Avg Return: +4.19% (✅ Robust)
  - Default Setting (9/26/52, L=10, `long-only`): Train Ret: **+1.27%** | Test Ret: **+10.90%** (✅ Robust)
- **Key Empirical Lessons:**
  - Lookback parameter ($L=10$) is essential: with $L=1$ (same candle), signal count is near zero because lagging TK crosses rarely coincide with the exact extreme RSI candle.
  - Setting $L=20$ produces high trade frequency but degrades win rate due to false signals in chop.
  - Asymmetric RSI sell zone threshold [65, 80] vs [60, 80] significantly cuts unprofitable short entries.
- **Reports:**
  - [OPTIMIZATION_ICHIMOKU_BTCUSDT_2026-10-12.md](./OPTIMIZATION_ICHIMOKU_BTCUSDT_2026-10-12.md)
  - [OPTIMIZATION_ICHIMOKU_ETHUSDT_2026-10-12.md](./OPTIMIZATION_ICHIMOKU_ETHUSDT_2026-10-12.md)

---

### [REPLACED] Strategy 1 (Triple Confluence: EMA + MACD + RSI)
- **Type:** Trend Following + Momentum Reversal (EMA + MACD + RSI)
- **Status:** ❌ Deprecated and replaced by Ichimoku + RSI Strategy (`IchimokuRsiStrategy`).
- **Archive Report:** [OPTIMIZATION_BTCUSDT_2026-10-12.md](./OPTIMIZATION_BTCUSDT_2026-10-12.md)
