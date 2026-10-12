# Ichimoku + RSI Parameter Optimization Report: ETHUSDT

- **Date:** 2026-10-12
- **Symbol:** ETHUSDT
- **Strategy:** Ichimoku (TK Cross) + RSI Zone Confluence
- **Engine:** BacktestEngine (Fee: 0.1%, Position: 100%, Initial Balance: $10,000)
- **Validation:** Chronological split (70% Train, 30% Test, no shuffle)
- **Total Evaluated Combinations:** 432
- **Combinations Passing Filter (Train Trades >= 30, Test Trades >= 10, Return > 0):** 7

> **Disclaimer:** Historical backtest results do not guarantee future performance. Parameter selection should prioritize robust parameter neighborhoods over isolated peaks.

## Top 15 Parameter Combinations

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
- **Fragile:** Surrounding parameters generate negative average returns, indicating the combo may be an overfit outlier.