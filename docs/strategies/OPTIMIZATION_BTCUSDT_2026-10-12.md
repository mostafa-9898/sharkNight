# Parameter Optimization Report: BTCUSDT

> [!WARNING]
> **DEPRECATED / HISTORICAL ARCHIVE:** This report evaluated the deprecated Strategy 1 (EMA + MACD + RSI confluence: `ModularStrategy`).
> Strategy 1 has been replaced by the new Ichimoku (TK cross) + RSI strategy (`IchimokuRsiStrategy`).
> Please refer to the updated report: [OPTIMIZATION_ICHIMOKU_BTCUSDT_2026-10-12.md](file:///c:/Pmine/TradeBot/docs/strategies/OPTIMIZATION_ICHIMOKU_BTCUSDT_2026-10-12.md).
- **Symbol:** BTCUSDT
- **Engine:** BacktestEngine (Fee: 0.1%, Position: 100%, Initial Balance: $10,000)
- **Validation:** Chronological split (70% Train, 30% Test, no shuffle)
- **Total Evaluated Combinations:** 1,458
- **Combinations Passing Filter (Train Trades >= 30, Test Trades >= 10, Return > 0):** 14

> **Disclaimer:** Historical backtest results do not guarantee future performance. Parameter selection should prioritize robust parameter neighborhoods over isolated peaks.

## Top 15 Parameter Combinations

| Rank | Timeframe | EMA | W | L | RSI Buy | RSI Sell | Exit Mode | Train Return | Test Return | Test MaxDD | Test WinRate | Trades (Train/Test) | Calmar Ratio | Neighbor Avg Return | Stability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1h | 10/30 | 6 | 20 | [20,40] | [65,75] | emaCross | 12.65% | 18.62% | 8.62% | 36.4% | 73/33 | 2.16 | 14.89% | ✅ Robust |
| 2 | 1h | 10/30 | 6 | 20 | [20,40] | [60,80] | emaCross | 12.65% | 18.62% | 8.62% | 36.4% | 73/33 | 2.16 | 15.42% | ✅ Robust |
| 3 | 1h | 10/30 | 6 | 20 | [20,40] | [60,75] | emaCross | 12.65% | 18.62% | 8.62% | 36.4% | 73/33 | 2.16 | 14.89% | ✅ Robust |
| 4 | 1h | 10/30 | 6 | 20 | [25,40] | [65,75] | emaCross | 12.65% | 18.62% | 8.62% | 36.4% | 73/33 | 2.16 | 18.88% | ✅ Robust |
| 5 | 1h | 10/30 | 6 | 20 | [25,40] | [60,80] | emaCross | 12.65% | 18.62% | 8.62% | 36.4% | 73/33 | 2.16 | 18.84% | ✅ Robust |
| 6 | 1h | 10/30 | 6 | 20 | [25,40] | [60,75] | emaCross | 12.65% | 18.62% | 8.62% | 36.4% | 73/33 | 2.16 | 18.88% | ✅ Robust |
| 7 | 1h | 10/30 | 10 | 10 | [20,40] | [60,80] | mirror | 20.69% | 13.11% | 21.41% | 41.2% | 44/17 | 0.61 | 11.91% | ✅ Robust |
| 8 | 1h | 10/30 | 10 | 10 | [20,40] | [60,75] | mirror | 20.69% | 13.11% | 21.41% | 41.2% | 44/17 | 0.61 | 12.62% | ✅ Robust |
| 9 | 1h | 10/30 | 10 | 10 | [25,40] | [60,80] | mirror | 20.69% | 13.11% | 21.41% | 41.2% | 44/17 | 0.61 | 15.88% | ✅ Robust |
| 10 | 1h | 10/30 | 10 | 10 | [25,40] | [60,75] | mirror | 20.69% | 13.11% | 21.41% | 41.2% | 44/17 | 0.61 | 17.53% | ✅ Robust |
| 11 | 1h | 9/21 | 6 | 10 | [20,40] | [60,80] | mirror | 0.25% | 2.72% | 28.9% | 45% | 56/20 | 0.09 | 3.49% | ✅ Robust |
| 12 | 1h | 9/21 | 6 | 10 | [20,40] | [60,75] | mirror | 0.25% | 2.72% | 28.9% | 45% | 56/20 | 0.09 | 1.93% | ✅ Robust |
| 13 | 1h | 9/21 | 6 | 10 | [25,40] | [60,80] | mirror | 0.25% | 2.72% | 28.9% | 45% | 56/20 | 0.09 | 3.92% | ✅ Robust |
| 14 | 1h | 9/21 | 6 | 10 | [25,40] | [60,75] | mirror | 0.25% | 2.72% | 28.9% | 45% | 56/20 | 0.09 | 2.18% | ✅ Robust |

## Parameter Stability Analysis
- **Robust:** The parameters surrounding this combination (one grid step away in W, L, RSI bounds, EMA periods) also generate positive returns on test data.
- **Fragile:** Surrounding parameters generate negative average returns, indicating the combo may be an overfit outlier.