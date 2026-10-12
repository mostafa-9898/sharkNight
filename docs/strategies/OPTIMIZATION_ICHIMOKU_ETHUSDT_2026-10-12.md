# Ichimoku + RSI Parameter Optimization Report: ETHUSDT

- **Date:** 2026-10-12
- **Symbol:** ETHUSDT
- **Strategy:** Ichimoku (TK Cross) + RSI Zone Confluence
- **Engine:** BacktestEngine (Fee: 0.1%, Position: 100%, Initial Balance: $10,000)
- **Validation:** Chronological split (70% Train, 30% Test, no shuffle)
- **Total Evaluated Combinations:** 2,160
- **Combinations Passing Strict Filter (Train Trades >= 30, Test Trades >= 10, Return > 0):** 123
- **Table Filter Status:** ✅ Strict Filter Passed

> **Disclaimer:** Historical backtest results do not guarantee future performance. Parameter selection should prioritize robust parameter neighborhoods over isolated peaks.

## Top Parameter Combinations (Strict Filter: Train Trades >= 30, Test Trades >= 10)

| Rank | Timeframe | Ichimoku | RSI Buy | RSI Sell | Lookback | Trade Mode | Trailing Stop | Train Ret | Test Ret | Base Test Ret | Diff Ret | Test MaxDD | Test WinRate | Trades (Train/Test) | Test Fees | Test Avg MFE | Test Avg MAE | Calmar | Neighbor Avg | Stability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1h | 9/26/52 | [20,40] | [60,80] | 5 | long-short | 5/10/5 | 2.74% | 112.84% | 147.19% | -34.35% | 13.19% | 69.2% | 38/13 | $382.99 | 12.72% | 2.91% | 8.55 | 70.04% | ✅ Robust |
| 2 | 1h | 9/26/52 | [20,40] | [60,75] | 5 | long-short | 5/10/5 | 2.74% | 112.84% | 147.19% | -34.35% | 13.19% | 69.2% | 38/13 | $382.99 | 12.72% | 2.91% | 8.55 | 67.31% | ✅ Robust |
| 3 | 1h | 9/26/52 | [25,40] | [60,80] | 5 | long-short | 5/10/5 | 2.74% | 112.84% | 147.19% | -34.35% | 13.19% | 69.2% | 38/13 | $382.99 | 12.72% | 2.91% | 8.55 | 67.74% | ✅ Robust |
| 4 | 1h | 9/26/52 | [25,40] | [60,75] | 5 | long-short | 5/10/5 | 2.74% | 112.84% | 147.19% | -34.35% | 13.19% | 69.2% | 38/13 | $382.99 | 12.72% | 2.91% | 8.55 | 65.73% | ✅ Robust |
| 5 | 1h | 10/30/60 | [20,40] | [60,80] | 5 | long-short | 3/3/1.5 | 112.4% | 63.63% | 67.85% | -4.22% | 13.16% | 40% | 37/10 | $240.32 | 11.16% | 2.62% | 4.84 | 39.79% | ✅ Robust |
| 6 | 1h | 10/30/60 | [20,40] | [60,75] | 5 | long-short | 3/3/1.5 | 112.4% | 63.63% | 67.85% | -4.22% | 13.16% | 40% | 37/10 | $240.32 | 11.16% | 2.62% | 4.84 | 38.08% | ✅ Robust |
| 7 | 1h | 10/30/60 | [25,40] | [60,80] | 5 | long-short | 3/3/1.5 | 112.4% | 63.63% | 67.85% | -4.22% | 13.16% | 40% | 37/10 | $240.32 | 11.16% | 2.62% | 4.84 | 36.14% | ✅ Robust |
| 8 | 1h | 10/30/60 | [25,40] | [60,75] | 5 | long-short | 3/3/1.5 | 112.4% | 63.63% | 67.85% | -4.22% | 13.16% | 40% | 37/10 | $240.32 | 11.16% | 2.62% | 4.84 | 35.19% | ✅ Robust |
| 9 | 1h | 10/30/60 | [20,40] | [60,80] | 5 | long-short | 4/2/1 | 80.41% | 54.62% | 67.85% | -13.23% | 14.93% | 40% | 36/10 | $232.43 | 11.16% | 3.23% | 3.66 | 36.48% | ✅ Robust |
| 10 | 1h | 10/30/60 | [20,40] | [60,75] | 5 | long-short | 4/2/1 | 80.41% | 54.62% | 67.85% | -13.23% | 14.93% | 40% | 36/10 | $232.43 | 11.16% | 3.23% | 3.66 | 34.77% | ✅ Robust |
| 11 | 1h | 10/30/60 | [25,40] | [60,80] | 5 | long-short | 4/2/1 | 80.41% | 54.62% | 67.85% | -13.23% | 14.93% | 40% | 36/10 | $232.43 | 11.16% | 3.23% | 3.66 | 33% | ✅ Robust |
| 12 | 1h | 10/30/60 | [25,40] | [60,75] | 5 | long-short | 4/2/1 | 80.41% | 54.62% | 67.85% | -13.23% | 14.93% | 40% | 36/10 | $232.43 | 11.16% | 3.23% | 3.66 | 32.04% | ✅ Robust |
| 13 | 1h | 7/22/44 | [20,40] | [65,80] | 10 | long-short | 5/10/5 | 63.79% | 66.59% | 62.32% | +4.27% | 27.61% | 53.8% | 179/93 | $2254.45 | 3.66% | 2.1% | 2.41 | 31.77% | ✅ Robust |
| 14 | 1h | 7/22/44 | [25,40] | [65,80] | 10 | long-short | 5/10/5 | 63.79% | 66.59% | 62.32% | +4.27% | 27.61% | 53.8% | 179/93 | $2254.45 | 3.66% | 2.1% | 2.41 | 28.12% | ✅ Robust |
| 15 | 1h | 7/22/44 | [20,40] | [65,80] | 10 | long-short | 5/5/2.5 | 70.44% | 63.67% | 62.32% | +1.35% | 27.61% | 53.2% | 180/94 | $2241.07 | 3.68% | 2.09% | 2.31 | 32.15% | ✅ Robust |

## Trailing Stop Contribution Analysis
Each row in the table above explicitly compares the strategy with trailing stop against the exact same configuration **WITHOUT** trailing stop (`Base Test Ret` and `Diff Ret`). This isolates the specific performance contribution of the trailing ratchet mechanism from the underlying indicator confluence.

## Parameter Stability Analysis
- **Robust:** The parameters surrounding this combination (one grid step away in Ichimoku, RSI zones, or Lookback) also generate positive returns on test data.
- **Fragile:** Surrounding parameters generate negative average returns, indicating the combo may be an overfit outlier.