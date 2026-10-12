# Ichimoku + RSI Parameter Optimization Report: BTCUSDT

- **Date:** 2026-10-12
- **Symbol:** BTCUSDT
- **Strategy:** Ichimoku (TK Cross) + RSI Zone Confluence
- **Engine:** BacktestEngine (Fee: 0.1%, Position: 100%, Initial Balance: $10,000)
- **Validation:** Chronological split (70% Train, 30% Test, no shuffle)
- **Total Evaluated Combinations:** 2,160
- **Combinations Passing Strict Filter (Train Trades >= 30, Test Trades >= 10, Return > 0):** 4
- **Table Filter Status:** ✅ Strict Filter Passed

> **Disclaimer:** Historical backtest results do not guarantee future performance. Parameter selection should prioritize robust parameter neighborhoods over isolated peaks.

## Top Parameter Combinations (Strict Filter: Train Trades >= 30, Test Trades >= 10)

| Rank | Timeframe | Ichimoku | RSI Buy | RSI Sell | Lookback | Trade Mode | Trailing Stop | Train Ret | Test Ret | Base Test Ret | Diff Ret | Test MaxDD | Test WinRate | Trades (Train/Test) | Test Fees | Test Avg MFE | Test Avg MAE | Calmar | Neighbor Avg | Stability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1h | 10/30/60 | [20,40] | [65,80] | 10 | long-only | 3/3/1.5 | 6.26% | 8.09% | 12.31% | -4.22% | 19.97% | 31.3% | 33/16 | $326.6 | 5.45% | 2.53% | 0.41 | 0.34% | ✅ Robust |
| 2 | 1h | 10/30/60 | [25,40] | [65,80] | 10 | long-only | 3/3/1.5 | 6.26% | 8.09% | 12.31% | -4.22% | 19.97% | 31.3% | 33/16 | $326.6 | 5.45% | 2.53% | 0.41 | 3.13% | ✅ Robust |
| 3 | 1h | 10/30/60 | [20,40] | [65,80] | 10 | long-only | 4/2/1 | 28.89% | 7.32% | 12.31% | -4.99% | 22.27% | 35.7% | 31/14 | $287.99 | 6.15% | 2.91% | 0.33 | -0.82% | ⚠️ Fragile |
| 4 | 1h | 10/30/60 | [25,40] | [65,80] | 10 | long-only | 4/2/1 | 28.89% | 7.32% | 12.31% | -4.99% | 22.27% | 35.7% | 31/14 | $287.99 | 6.15% | 2.91% | 0.33 | 1.78% | ✅ Robust |

## Trailing Stop Contribution Analysis
Each row in the table above explicitly compares the strategy with trailing stop against the exact same configuration **WITHOUT** trailing stop (`Base Test Ret` and `Diff Ret`). This isolates the specific performance contribution of the trailing ratchet mechanism from the underlying indicator confluence.

## Parameter Stability Analysis
- **Robust:** The parameters surrounding this combination (one grid step away in Ichimoku, RSI zones, or Lookback) also generate positive returns on test data.
- **Fragile:** Surrounding parameters generate negative average returns, indicating the combo may be an overfit outlier.