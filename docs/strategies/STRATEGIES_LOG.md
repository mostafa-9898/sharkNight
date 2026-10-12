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

### Strategy 1 (Triple Confluence) Optimization - BTCUSDT (2026-10-12)
- **Type:** Trend Following + Momentum Reversal (EMA + MACD + RSI)
- **Data:** Real candles from data/ (1458 combos tested)
- **Validation:** Chronological split (70% Train, 30% Test)
- **Best Ranked Setting:** TF: 1h, EMA: 10/30, W: 6, L: 20, Exit: emaCross, Test Return: 18.62%, Calmar: 2.16
- **Detailed Report:** [OPTIMIZATION_BTCUSDT_2026-10-12.md](./OPTIMIZATION_BTCUSDT_2026-10-12.md)
- **Status:** ✅ Completed Optimization
