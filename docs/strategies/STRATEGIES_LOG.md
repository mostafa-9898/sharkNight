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

_No strategies tested yet. Will be populated in Phase 4._

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
