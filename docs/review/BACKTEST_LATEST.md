# Automated Backtest Review Report
Generated: **2026-10-18T05:08:09.043Z** | Config Hash: `f8e53fab`

## Section A: Run Header
| Property | Value |
|---|---|
| **Git Commit** | `7c97d09` (⚠️ dirty) |
| **Symbol / Interval / Period** | `BTCUSDT` / `1h` / `6y` |
| **Total Candles** | 52,596 |
| **Start Time (UTC)** | 2020-10-17T01:00:00Z |
| **End Time (UTC)** | 2026-10-17T12:00:00Z |
| **Dataset Fingerprint** | `006de41a38074c0c` |
| **Data Source** | `cache` ✅ |
| **Config Hash** | `f8e53fab` |

### Full Configuration Parameters
| Parameter Group | Parameter | Value |
|---|---|---|
| Ichimoku | Tenkan / Kijun / SenkouB / Displacement | `9` / `26` / `52` / `26` |
| RSI | Period / Lookback | `14` / `5` |
| RSI Zones | Buy Zone / Sell Zone | `[20, 40]` / `[60, 80]` |
| Cloud Filter | Mode | `trend` |
| RSI Recovery Cap | Value | `+15` |
| Kijun Slope Filter | Status | `enabled` |
| Execution | Trade Mode / Exit Mode | `long-short` / `tkCross` |
| Time Stop | maxBarsInTrade | `none` |
| Fixed Stop / TP | Stop Loss % / Take Profit % | `none` / `none` |
| Trailing Stop | Initial / Step / Raise | `3.5%` / `3%` / `1.5%` |
| Position Sizing | Position Size % / Risk Per Trade % | `20%` / `1%` |
| Fees & Slippage | Fee % / Slippage % / Stop Check Mode | `0.1%` / `0%` / `intrabar` |
| Initial Balance | Starting Capital | `$10000.00` |

## Section B: Summary Metrics
| Metric | Value | Baseline / Context |
|---|---|---|
| **Net Return** | **0.00%** ($0.00) | Initial: $10000.00 → Final: $10000.00 |
| **Buy & Hold Return** | **+619.85%** | Market performance over same candle window |
| **Max Drawdown** | **0.00%** | Peak to trough depth on continuous equity |
| **Total Trades** | **0** | Long: 0 / Short: 0 |
| **Win Rate** | **N/A** | Long: N/A / Short: N/A |
| **Average Win / Loss** | **N/A** / **N/A** | Win/Loss Ratio: N/A |
| **Trade Expectancy** | **N/A** | Undefined (zero executed trades) |
| **Profit Factor** | **N/A** | Gross Profit: $0.00 / Gross Loss: $0.00 (no trades executed) |
| **Total Fees Paid** | **$0.00** (0.00% of capital) | Fee Drag: 0.00% |
| **Avg Holding Duration** | **0 bars** | Total bars in positions: 0 |
| **Time in Market** | **0%** | 0 of 52,596 candles |

## Section C: Automated Warning Flags
- 🚨 **[CRITICAL]** Zero Trades Executed: The backtest executed zero trades. Profitability, expectancy, and risk conclusions cannot be inferred from a zero-trade sample.

## Section D: Signal Funnel
> ℹ️ **Diagnostic Semantics:** **Crosses with RSI in Zone** reflects independent RSI lookback qualification across all candidate TK crossovers, regardless of upstream filter rejections. In contrast, "Signal Attrition & Rejections" reflects exclusive first-rejection attribution in execution order (Cloud Filter → Kijun Slope Filter → RSI Zone → RSI Recovery Cap). Crosses that qualify for RSI may still be rejected earlier by Cloud or Kijun Slope filters.

| Stage | Bullish (BUY) | Bearish (SELL) | Combined |
|---|---|---|---|
| **TK Crossover Events** | 1342 | 1343 | 2685 |
| **Crosses with RSI in Zone** | 89 | 131 | 220 |
| **Signals Emitted** | 0 | 0 | 0 |
| **Signals Executed (Trades)** | 0 | 0 | 0 |

### Signal Attrition & Rejections
- **Rejected Crosses (Did Not Become Signals):** 2685
  - RSI out of zone within lookback: **288**
  - Rejected by Cloud Filter: **1602**
  - Rejected by RSI Recovery Cap: **10**
  - Rejected by Kijun Slope Filter: **785**
- **Ignored Signals (Strategy Emitted but Engine Skipped):** 0
  - Position already open in same direction: **0**
  - Long-only mode rejected short signal: **0**

#### Sample of Rejected TK Crosses (First 8 Events)
| Time (UTC) | Direction | Price | RSI at Cross | Reason Rejected |
|---|---|---|---|---|
| 2020-10-19T09:00:00Z | `DOWN` | $11486.10 | 61.9 | `cloudFilter` |
| 2020-10-19T11:00:00Z | `UP` | $11476.40 | 58.9 | `cloudFilter` |
| 2020-10-19T12:00:00Z | `DOWN` | $11516.40 | 66.5 | `cloudFilter` |
| 2020-10-19T13:00:00Z | `UP` | $11642.80 | 79.4 | `cloudFilter` |
| 2020-10-22T17:00:00Z | `DOWN` | $13043.40 | 64.9 | `cloudFilter` |
| 2020-10-22T19:00:00Z | `UP` | $13071.80 | 66.1 | `kijunSlopeFilter` |
| 2020-10-23T08:00:00Z | `DOWN` | $12920.60 | 51.2 | `cloudFilter` |
| 2020-10-23T10:00:00Z | `UP` | $13040.90 | 58.7 | `kijunSlopeFilter` |

## Section E: Compact Trades Table
| # | Side | Entry Time | Entry Price | Exit Time | Exit Price | Bars | PnL % | Exit Reason | MFE % | MAE % | Giveback % | RSI Age |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Section F: Per-Trade Trajectory Analysis
- **Trades Rebounding After Drawdown:** 0 (N/A)
- **Permanently Underwater Trades:** 0 (N/A)

### Average Unrealized PnL Progression (Winners vs Losers)
| Candle Horizon | All Trades | Winning Trades | Losing Trades |
|---|---|---|---|
| **Bar 1** | N/A (0 trades) | N/A | N/A |
| **Bar 3** | N/A (0 trades) | N/A | N/A |
| **Bar 6** | N/A (0 trades) | N/A | N/A |
| **Bar 12** | N/A (0 trades) | N/A | N/A |
| **Bar 24** | N/A (0 trades) | N/A | N/A |
| **Bar 48** | N/A (0 trades) | N/A | N/A |
| **Bar 96** | N/A (0 trades) | N/A | N/A |

## Section G: Outlier Trades Analysis (Top 10 Worst & Best)
### Top 10 Worst Trades (Largest Losses)
### Top 10 Best Trades (Largest Gains)
## Section H: Open Trade at Backtest Conclusion
ℹ️ **No trades executed.** No trades were executed, no positions were opened, and no forced liquidation was required.

## Section I: Top 5 Drawdown Periods
_No significant drawdown periods detected on the equity curve._

## Section J: Performance Breakdowns
### 1. By Side (Long vs Short)
| Side | Trades | Win Rate | Total Return % | Avg Return % | Profit Factor | Avg Duration |
|---|---|---|---|---|---|---|
| **Long** | 0 | N/A | 0.00% | N/A | N/A | 0 bars |
| **Short** | 0 | N/A | 0.00% | N/A | N/A | 0 bars |

### 2. By Exit Reason
| Exit Reason | Trades | Win Rate | Total Return % | Avg Return % | Avg Duration |
|---|---|---|---|---|---|

### 3. By Year
| Year | Trades | Win Rate | Total Return % | Avg Return % |
|---|---|---|---|---|

### 4. By Price vs Cloud at Entry
| Price Location | Trades | Win Rate | Total Return % | Avg Return % | Long (Trades / WinRate / Ret%) | Short (Trades / WinRate / Ret%) |
|---|---|---|---|---|---|---|
| `above` | 0 | N/A | 0.00% | N/A | 0 / N/A / 0.00% | 0 / N/A / 0.00% |
| `inside` | 0 | N/A | 0.00% | N/A | 0 / N/A / 0.00% | 0 / N/A / 0.00% |
| `below` | 0 | N/A | 0.00% | N/A | 0 / N/A / 0.00% | 0 / N/A / 0.00% |

### 5. By Entry RSI Buckets
| RSI Bucket | Trades | Win Rate | Total Return % | Avg Return % |
|---|---|---|---|---|
| `[20, 30)` | 0 | N/A | 0.00% | N/A |
| `[30, 40)` | 0 | N/A | 0.00% | N/A |
| `[40, 50)` | 0 | N/A | 0.00% | N/A |
| `[50, 60)` | 0 | N/A | 0.00% | N/A |
| `[60, 70)` | 0 | N/A | 0.00% | N/A |
| `[70, 80]` | 0 | N/A | 0.00% | N/A |

## Section K: Invariant Self-Checks
| Invariant Name | Status | Violations | Verification Details |
|---|---|---|---|
| **Cash / Equity Conservation** | ✅ PASS | 0 | |initialBalance + sum(trade.pnl) - finalEquity| = 0.0000e+0 (threshold 1e-5) |
| **Stop Fill Integrity (Intrabar Gap/Slippage)** | ⚪ N/A | 0 | No stop-loss or trailing-stop exits in trade sample (0 applicable trades) |
| **Trade Non-Overlap (Single Position Invariant)** | ⚪ N/A | 0 | No trades executed to evaluate trade overlap (0 trade pairs) |
| **Trailing Ratchet Step Non-Negativity** | ⚪ N/A | 0 | No trades executed to evaluate trailing ratchet steps (0 applicable trades) |
