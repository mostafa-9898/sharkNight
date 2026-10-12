# Ichimoku + RSI Parameter Optimization Report: BTCUSDT

- **Date:** 2026-10-12
- **Symbol:** BTCUSDT
- **Strategy:** Ichimoku (TK Cross) + RSI Zone Confluence
- **Engine:** BacktestEngine (Fee: 0.1%, Position: 100%, Initial Balance: $10,000)
- **Validation:** Chronological split (70% Train, 30% Test, no shuffle)
- **Total Evaluated Combinations:** 432
- **Combinations Passing Filter (Train Trades >= 30, Test Trades >= 10, Return > 0):** 0

> **Disclaimer:** Historical backtest results do not guarantee future performance. Parameter selection should prioritize robust parameter neighborhoods over isolated peaks.

> **Empirical Finding on Trade Filter:** No parameter sets met the strict hurdle of (Train Trades >= 30, Test Trades >= 10, Train Ret > 0, Test Ret > 0). High-frequency settings (Lookback = 20) produced high trade counts but incurred net losses in trend-reversal/choppy regimes. The table below displays combinations that achieved positive net returns on BOTH train and test partitions under lower trade frequency (Train >= 4, Test >= 1).

## Top Parameter Combinations

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
| 11 | 4h | 9/26/52 | [20,35] | [65,80] | 20 | long-only | 17.18% | 8.91% | 0.62% | 24.01% | 28.24% | 50% | 23/6 | 0.02 | 0.77% | ✅ Robust |

## Parameter Stability Analysis
- **Robust:** The parameters surrounding this combination (one grid step away in Ichimoku, RSI zones, or Lookback) also generate positive returns on test data.
- **Fragile:** Surrounding parameters generate negative average returns, indicating the combo may be an overfit outlier.