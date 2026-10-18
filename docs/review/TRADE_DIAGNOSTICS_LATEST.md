# Trade Diagnostics Report — Latest Backtest Run

> **Canonical Diagnostic Log** | Generated: `2026-10-18T09:16:37.846Z` | Git: `20fdd6f` (dirty) | Config Hash: `cf566818`

---

## Section 1: Run Identity & Reproducibility
| Parameter | Value | Specification Details |
|---|---|---|
| **Run Timestamp (UTC)** | `2026-10-18T09:16:37.846Z` | Deterministic backtest execution |
| **Git Revision** | `20fdd6f` | Working tree: `DIRTY` |
| **Symbol & Timeframe** | `BTCUSDT` / `15m` | Higher-timeframe context |
| **Evaluation Type** | **In-Sample Baseline (6y Historical Window)** | Out-of-sample / In-sample protocol |
| **Effective Data Window** | `2020-10-17T18:30:00Z` → `2026-10-18T06:15:00Z` | Period: `all` |
| **Candle Dataset** | **210,384** candles | Fingerprint: `2416041ce5f3a240` |
| **Strategy Indicators** | Ichimoku (9, 26, 52, 26) | RSI (14, Zones: [20, 50] / [51, 80], Lookback: 20) |
| **Filters Applied** | Cloud: `trend` | Kijun Slope: `OFF`, RSI Cap: `N/A` |
| **Execution & Trade Mode** | `long-short` / `trailingOnly` | Intrabar stop checking: `intrabar` |
| **Position Sizing & Risk** | Size: **20%** | Risk per trade: **1%** (Initial Capital: $100) |
| **Cost Model** | Fee: **0.1%** per side | Adverse exit slippage: **0%** |
| **Stop Loss Policy** | **5.0%** initial stop | Type: Stepped Trailing |
| **Trailing Stop Policy** | Step: **9%**, Raise: **3%** | Activates on favorable price movement |
| **Take Profit Target** | `DISABLED` (N/A) | Uncapped trend-following mode |

## Section 2: Executive Summary & Capital Preservation Diagnostics
| Performance Metric | Recorded Value | Capital Preservation & Risk Metric | Recorded Value |
|---|---|---|---|
| **Initial Account Equity** | $100.00 | **Maximum Equity Drawdown** | **41.78%** |
| **Final Account Equity** | $116.73 | **Max Drawdown ($)** | $41.78 |
| **Net Return ($ / %)** | **$16.73** (**+16.73%**) | **Loss Streak (Max Consecutive)** | **6** trades (1554 bars / ~16.2 days) |
| **Realized Closed PnL** | $16.73 | **Market Exposure Ratio** | **90.65%** of total period |
| **Unrealized Open PnL** | $0.01 (+0.06%) | **Total Fees Paid** | $1.68 (1.68% fee drag) |
| **Total Completed Trades** | **35** (Long: 18 / Short: 18) | **Average Trade Holding Time** | **5449.1** bars (Median: **437**, Max: **79564**) |
| **Win Rate** | **25.0%** (9W / 27L) | **Total Profit Given Back** | $159.76 (from peak MFE) |
| **Profit Factor** | **1.76** | **Trailing Stop Trigger Rate** | **34.3%** (12/35 trades) |
| **Trade Expectancy** | **+0.46%** per trade | **Average Win / Average Loss** | **+25.01%** / **-4.75%** (Ratio: **5.27**) |

## Section 3: Every Completed Trade (Chronological Log)
> ℹ️ **Table Conventions:**
> - **Risk ($):** Initial cash risk budget at trade entry (`positionValue × initialStopPercent`).
> - **MFE / MAE in R:** Maximum favorable/adverse excursion divided by initial stop distance.
> - **Giveback:** Difference between peak unrealized gain (MFE) and final realized return.

| ID | Side | Entry Time (UTC) | Entry Price | Exit Time (UTC) | Exit Price | Qty | Pos Value | Risk ($) | Init Stop | Exit Reason | Gross PnL | Fee | Net PnL | Return % | MFE (R) | MAE (R) | Giveback % | Trailing Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TR-001 | `LONG` | 2020-10-31T03:45:00Z | $13488.80 | 2021-05-19T13:00:00Z | $29810.25 | 0.0015 | $19.98 | $1.00 | $12814.36 | `trailingStop` | $24.18 | $0.06 | $24.11 | **+120.56%** | +380.7% (+76.14R) | -2.2% (-0.43R) | 260.1% | Active (step 42) |
| TR-002 | `SHORT` | 2021-05-29T22:15:00Z | $34382.60 | 2021-05-30T07:30:00Z | $36101.73 | 0.0007 | $24.80 | $1.24 | $36101.73 | `stopLoss` | -$1.24 | $0.05 | -$1.29 | **-5.20%** | +2.9% (+0.58R) | -5.4% (-1.08R) | 2.9% | No (req: +9%) |
| TR-003 | `SHORT` | 2021-06-06T15:30:00Z | $36084.30 | 2021-06-09T17:15:00Z | $36805.99 | 0.0007 | $24.54 | $1.23 | $37888.52 | `trailingStop` | -$0.49 | $0.05 | -$0.54 | **-2.20%** | +14.1% (+2.82R) | -2.4% (-0.48R) | 14.1% | Active (step 1) |
| TR-004 | `LONG` | 2021-06-10T15:15:00Z | $37037.00 | 2021-06-12T04:30:00Z | $35185.15 | 0.0007 | $24.43 | $1.22 | $35185.15 | `stopLoss` | -$1.22 | $0.05 | -$1.27 | **-5.19%** | +1.7% (+0.35R) | -5.1% (-1.02R) | 1.7% | No (req: +9%) |
| TR-005 | `LONG` | 2021-06-14T09:00:00Z | $39100.10 | 2021-06-18T10:15:00Z | $37145.10 | 0.0006 | $24.18 | $1.21 | $37145.09 | `stopLoss` | -$1.21 | $0.05 | -$1.26 | **-5.19%** | +5.8% (+1.15R) | -5.2% (-1.04R) | 5.8% | No (req: +9%) |
| TR-006 | `SHORT` | 2021-06-19T07:00:00Z | $35638.60 | 2021-06-24T18:00:00Z | $35282.21 | 0.0007 | $23.93 | $1.20 | $37420.53 | `trailingStop` | $0.24 | $0.05 | $0.19 | **+0.80%** | +19.2% (+3.84R) | -2.4% (-0.48R) | 18.4% | Active (step 2) |
| TR-007 | `LONG` | 2021-07-04T23:30:00Z | $35321.10 | 2021-07-05T11:15:00Z | $33555.04 | 0.0007 | $23.97 | $1.20 | $33555.04 | `stopLoss` | -$1.20 | $0.05 | -$1.25 | **-5.19%** | +0.4% (+0.07R) | -5.0% (-1.00R) | 0.4% | No (req: +9%) |
| TR-008 | `SHORT` | 2021-07-08T12:30:00Z | $32802.60 | 2021-07-11T21:30:00Z | $34442.73 | 0.0007 | $23.72 | $1.19 | $34442.73 | `stopLoss` | -$1.19 | $0.05 | -$1.23 | **-5.20%** | +1.6% (+0.33R) | -5.5% (-1.09R) | 1.6% | No (req: +9%) |
| TR-009 | `SHORT` | 2021-07-19T05:15:00Z | $31672.50 | 2021-07-23T22:30:00Z | $33256.13 | 0.0007 | $23.47 | $1.17 | $33256.13 | `stopLoss` | -$1.17 | $0.05 | -$1.22 | **-5.20%** | +7.6% (+1.52R) | -5.1% (-1.02R) | 7.6% | No (req: +9%) |
| TR-010 | `LONG` | 2021-07-28T13:45:00Z | $39650.20 | 2021-08-03T18:00:00Z | $37667.69 | 0.0006 | $23.23 | $1.16 | $37667.69 | `stopLoss` | -$1.16 | $0.05 | -$1.21 | **-5.19%** | +7.4% (+1.48R) | -5.0% (-1.01R) | 7.4% | No (req: +9%) |
| TR-011 | `LONG` | 2021-08-07T13:30:00Z | $43410.50 | 2021-09-07T15:00:00Z | $43844.61 | 0.0005 | $22.98 | $1.15 | $41239.97 | `trailingStop` | $0.23 | $0.05 | $0.18 | **+0.80%** | +21.9% (+4.38R) | -2.3% (-0.46R) | 21.1% | Active (step 2) |
| TR-012 | `SHORT` | 2021-09-08T10:15:00Z | $46055.10 | 2021-09-15T16:00:00Z | $48357.86 | 0.0005 | $23.02 | $1.15 | $48357.86 | `stopLoss` | -$1.15 | $0.05 | -$1.20 | **-5.20%** | +5.8% (+1.16R) | -5.0% (-1.00R) | 5.8% | No (req: +9%) |
| TR-013 | `LONG` | 2021-10-06T01:00:00Z | $51109.30 | 2021-12-03T20:15:00Z | $53153.67 | 0.0004 | $22.78 | $1.14 | $48553.83 | `trailingStop` | $0.91 | $0.05 | $0.86 | **+3.79%** | +35.1% (+7.01R) | -1.4% (-0.28R) | 31.3% | Active (step 3) |
| TR-014 | `SHORT` | 2021-12-06T12:45:00Z | $48471.80 | 2021-12-06T22:45:00Z | $50895.39 | 0.0005 | $22.95 | $1.15 | $50895.39 | `stopLoss` | -$1.15 | $0.05 | -$1.19 | **-5.20%** | +1.4% (+0.28R) | -5.0% (-1.00R) | 1.4% | No (req: +9%) |
| TR-015 | `SHORT` | 2021-12-10T21:00:00Z | $48310.60 | 2021-12-12T18:15:00Z | $50726.13 | 0.0005 | $22.72 | $1.14 | $50726.13 | `stopLoss` | -$1.14 | $0.05 | -$1.18 | **-5.20%** | +3.3% (+0.66R) | -5.1% (-1.02R) | 3.3% | No (req: +9%) |
| TR-016 | `LONG` | 2021-12-12T22:00:00Z | $50060.00 | 2021-12-13T15:15:00Z | $47557.00 | 0.0004 | $22.48 | $1.12 | $47557.00 | `stopLoss` | -$1.12 | $0.04 | -$1.17 | **-5.19%** | +0.6% (+0.12R) | -5.5% (-1.09R) | 0.6% | No (req: +9%) |
| TR-017 | `SHORT` | 2021-12-17T17:00:00Z | $46952.80 | 2021-12-21T12:30:00Z | $49300.44 | 0.0005 | $22.25 | $1.11 | $49300.44 | `stopLoss` | -$1.11 | $0.05 | -$1.16 | **-5.20%** | +3.1% (+0.62R) | -5.0% (-1.01R) | 3.1% | No (req: +9%) |
| TR-018 | `LONG` | 2021-12-22T01:30:00Z | $48751.90 | 2021-12-29T23:15:00Z | $46314.31 | 0.0005 | $22.02 | $1.10 | $46314.31 | `stopLoss` | -$1.10 | $0.04 | -$1.14 | **-5.19%** | +6.8% (+1.36R) | -5.6% (-1.11R) | 6.8% | No (req: +9%) |
| TR-019 | `SHORT` | 2022-01-05T01:30:00Z | $46261.90 | 2022-02-07T18:00:00Z | $44411.42 | 0.0005 | $21.79 | $1.09 | $48575.00 | `trailingStop` | $0.87 | $0.04 | $0.83 | **+3.80%** | +28.8% (+5.77R) | -1.7% (-0.34R) | 25.0% | Active (step 3) |
| TR-020 | `LONG` | 2022-02-10T20:00:00Z | $44540.40 | 2022-02-11T19:00:00Z | $42313.38 | 0.0005 | $21.95 | $1.10 | $42313.38 | `stopLoss` | -$1.10 | $0.04 | -$1.14 | **-5.19%** | +0.1% (+0.02R) | -5.6% (-1.13R) | 0.1% | No (req: +9%) |
| TR-021 | `SHORT` | 2022-02-20T23:15:00Z | $38587.40 | 2022-02-24T20:00:00Z | $39359.15 | 0.0006 | $21.72 | $1.09 | $40516.77 | `trailingStop` | -$0.43 | $0.04 | -$0.48 | **-2.20%** | +11.1% (+2.21R) | -3.2% (-0.64R) | 11.1% | Active (step 1) |
| TR-022 | `LONG` | 2022-03-01T10:15:00Z | $43095.50 | 2022-03-04T08:30:00Z | $40940.72 | 0.0005 | $21.63 | $1.08 | $40940.72 | `stopLoss` | -$1.08 | $0.04 | -$1.12 | **-5.19%** | +5.3% (+1.05R) | -5.2% (-1.04R) | 5.3% | No (req: +9%) |
| TR-023 | `SHORT` | 2022-03-05T11:30:00Z | $39116.10 | 2022-03-09T03:45:00Z | $41071.90 | 0.0005 | $21.40 | $1.07 | $41071.90 | `stopLoss` | -$1.07 | $0.04 | -$1.11 | **-5.20%** | +5.0% (+1.00R) | -5.9% (-1.19R) | 5.0% | No (req: +9%) |
| TR-024 | `LONG` | 2022-03-09T13:30:00Z | $41823.40 | 2022-03-10T04:30:00Z | $39732.23 | 0.0005 | $21.18 | $1.06 | $39732.23 | `stopLoss` | -$1.06 | $0.04 | -$1.10 | **-5.19%** | +1.8% (+0.36R) | -5.8% (-1.16R) | 1.8% | No (req: +9%) |
| TR-025 | `SHORT` | 2022-03-11T22:45:00Z | $38919.10 | 2022-03-16T02:00:00Z | $40865.06 | 0.0005 | $20.96 | $1.05 | $40865.06 | `stopLoss` | -$1.05 | $0.04 | -$1.09 | **-5.20%** | +3.5% (+0.70R) | -6.7% (-1.33R) | 3.5% | No (req: +9%) |
| TR-026 | `LONG` | 2022-03-17T07:00:00Z | $40812.20 | 2022-04-11T10:00:00Z | $41220.32 | 0.0005 | $20.74 | $1.04 | $38771.59 | `trailingStop` | $0.21 | $0.04 | $0.17 | **+0.80%** | +18.1% (+3.62R) | -1.6% (-0.33R) | 17.3% | Active (step 2) |
| TR-027 | `SHORT` | 2022-04-16T21:00:00Z | $40299.70 | 2022-04-21T10:15:00Z | $42314.68 | 0.0005 | $20.78 | $1.04 | $42314.68 | `stopLoss` | -$1.04 | $0.04 | -$1.08 | **-5.20%** | +4.4% (+0.88R) | -5.2% (-1.04R) | 4.4% | No (req: +9%) |
| TR-028 | `SHORT` | 2022-04-23T06:15:00Z | $39610.90 | 2023-10-23T22:30:00Z | $34461.48 | 0.0005 | $20.56 | $1.03 | $41591.44 | `trailingStop` | $2.67 | $0.04 | $2.63 | **+12.80%** | +60.9% (+12.19R) | -3.0% (-0.60R) | 48.1% | Active (step 6) |
| TR-029 | `LONG` | 2023-10-31T01:45:00Z | $34448.20 | 2026-02-05T20:45:00Z | $62695.72 | 0.0006 | $21.09 | $1.05 | $32725.79 | `trailingStop` | $17.29 | $0.06 | $17.23 | **+81.64%** | +266.3% (+53.26R) | -1.2% (-0.24R) | 184.7% | Active (step 29) |
| TR-030 | `SHORT` | 2026-02-06T02:15:00Z | $64628.30 | 2026-02-06T14:30:00Z | $67859.71 | 0.0004 | $24.53 | $1.23 | $67859.72 | `stopLoss` | -$1.23 | $0.05 | -$1.28 | **-5.20%** | +1.3% (+0.27R) | -5.8% (-1.16R) | 1.3% | No (req: +9%) |
| TR-031 | `SHORT` | 2026-02-11T19:30:00Z | $67791.30 | 2026-03-04T09:00:00Z | $71180.87 | 0.0004 | $24.28 | $1.21 | $71180.87 | `stopLoss` | -$1.21 | $0.05 | -$1.26 | **-5.20%** | +7.8% (+1.56R) | -5.1% (-1.03R) | 7.8% | No (req: +9%) |
| TR-032 | `LONG` | 2026-03-10T19:00:00Z | $70070.10 | 2026-03-27T10:45:00Z | $66566.60 | 0.0003 | $24.02 | $1.20 | $66566.60 | `stopLoss` | -$1.20 | $0.05 | -$1.25 | **-5.19%** | +8.5% (+1.69R) | -5.3% (-1.07R) | 8.5% | No (req: +9%) |
| TR-033 | `LONG` | 2026-04-08T15:00:00Z | $71105.80 | 2026-06-02T09:00:00Z | $69683.68 | 0.0003 | $23.77 | $1.19 | $67550.51 | `trailingStop` | -$0.48 | $0.05 | -$0.52 | **-2.20%** | +16.5% (+3.30R) | -2.3% (-0.45R) | 16.5% | Active (step 1) |
| TR-034 | `SHORT` | 2026-06-03T11:30:00Z | $67153.30 | 2026-08-19T15:15:00Z | $68496.37 | 0.0004 | $23.67 | $1.18 | $70510.97 | `trailingStop` | -$0.47 | $0.05 | -$0.52 | **-2.20%** | +13.9% (+2.78R) | -3.6% (-0.73R) | 13.9% | Active (step 1) |
| TR-035 | `LONG` | 2026-08-28T03:00:00Z | $79885.50 | 2026-09-15T14:30:00Z | $75891.23 | 0.0003 | $23.56 | $1.18 | $75891.22 | `stopLoss` | -$1.18 | $0.05 | -$1.22 | **-5.19%** | +3.0% (+0.60R) | -5.2% (-1.05R) | 3.0% | No (req: +9%) |

### Open Position at Backtest Conclusion
> ⚠️ **OPEN POSITION IDENTIFIED AT DATA END:**
| Attribute | Value | Analysis |
|---|---|---|
| **Position ID** | `TR-36` | Active at final candle |
| **Direction** | `LONG` | Position opened during run |
| **Entry Timestamp / Price** | `2026-09-19T18:30:00Z` / $81500.10 | Original entry execution |
| **Final Historical Price** | $81714.70 | Evaluated at final candle close |
| **Position Size / Value** | 0.0003 ($23.32) | Capital in trade |
| **Unrealized Net PnL** | **$0.01** (**+0.06%**) | Marked-to-market at close |
| **Accounting Status** | **UNCLOSED POSITION** | **Excluded from closed realized trade statistics** |

## Section 4: Risk, Drawdown & Exposure Diagnostics
### 1. Top Drawdown Periods
| # | Peak Date | Peak Equity | Trough Date | Trough Equity | Max Depth % | Bars to Trough | Recovery Date | Recovery Status |
|---|---|---|---|---|---|---|---|---|
| 1 | 2021-04-14T06:00:00Z | $175.74 | 2022-04-26T08:00:00Z | $102.32 | **-41.78%** | 36200 bars | Unrecovered | ⚠️ Active Drawdown |
| 2 | 2021-02-21T19:00:00Z | $166.20 | 2021-02-28T17:45:00Z | $143.82 | **-13.47%** | 667 bars | 2021-03-13T10:00:00Z | ✅ Recovered |
| 3 | 2021-01-08T12:00:00Z | $141.61 | 2021-01-22T01:00:00Z | $123.06 | **-13.10%** | 1300 bars | 2021-02-08T12:45:00Z | ✅ Recovered |
| 4 | 2021-03-13T20:30:00Z | $171.24 | 2021-03-25T13:00:00Z | $154.91 | **-9.53%** | 1122 bars | 2021-04-13T08:15:00Z | ✅ Recovered |
| 5 | 2021-01-03T07:30:00Z | $131.26 | 2021-01-04T10:15:00Z | $122.99 | **-6.30%** | 107 bars | 2021-01-06T04:15:00Z | ✅ Recovered |

### 2. Exit Reason Distribution
| Exit Reason | Trade Count | Percentage | Cumulative Net PnL | Cumulative Return % | Avg Return % | Avg Holding Bars |
|---|---|---|---|---|---|---|
| `trailingStop` | 12 | 34.3% | $44.15 | +216.19% | +18.02% | 14966.7 bars |
| `stopLoss` | 23 | 65.7% | -$27.43 | -119.49% | -5.20% | 483.4 bars |

### 3. Yearly Performance Breakdown
| Calendar Year | Trade Count | Win Rate | Net PnL ($) | Cumulative Return % | Avg Return % |
|---|---|---|---|---|---|
| **2020** | 1 | 100% | $24.11 | +120.56% | +120.56% |
| **2021** | 17 | 17.6% | -$15.07 | -64.35% | -3.79% |
| **2022** | 10 | 30% | -$3.50 | -15.97% | -1.60% |
| **2023** | 1 | 100% | $17.23 | +81.64% | +81.64% |
| **2026** | 6 | 0% | -$6.06 | -25.18% | -4.20% |

## Section 5: Decision & Signal Funnel Diagnostics
### 1. Signal Funnel
| Stage | Bullish (BUY) | Bearish (SELL) | Combined |
|---|---|---|---|
| **TK Crossover Events** | 3116 | 3043 | 6159 |
| **Crosses with RSI in Zone** | 748 | 725 | 1473 |
| **Signals Emitted by Strategy** | 2 | 6 | 8 |
| **Signals Executed into Trades** | 18 | 18 | 36 |

### 2. Filter Rejection Attribution
- **Rejected Crossovers (Did Not Emit Signal):** 6151
  - Cloud Trend Filter (`close vs Cloud`): **0**
  - RSI Out of Zone at Cross & Lookback: **0**
  - RSI Recovery Cap Exceeded: **0**
  - Kijun Slope Filter: **0**
- **Ignored Signals (Strategy Emitted but Engine Skipped):** 376
  - Position Already Open in Same Direction: **376**
  - Long-Only Filter Ignored Short: **0**

### 3. Execution & Behavioral Warnings
- [WARNING] Profit Giveback: 22 trades reached >= +1.5% favorable move but closed at a net loss.
- [WARNING] Prolonged Underwater Exposure: 10 trades (27.8%) spent > 70% of holding time in drawdown.
- [WARNING] Held Across Opposite TK Cross: 36 trades remained open while an opposite TK cross occurred.
- [NOTICE] Forced Exit at Backtest Conclusion: Final trade #36 (long) was closed forcibly by engine because data ended (PnL: $0.01, +0.06%).

### 4. Invariant Self-Checks
| Invariant Name | Status | Violations | Verification Details |
|---|---|---|---|
| **Cash / Equity Conservation** | ✅ PASS | 0 | |initialBalance + sum(trade.pnl) - finalEquity| = 8.5265e-14 (threshold 1e-5) |
| **Stop Fill Integrity (Intrabar Gap/Slippage)** | ✅ PASS | 0 | Exit price was at or better than allowed stopPrice + gap slippage in 35/35 applicable stop trades |
| **Trade Non-Overlap (Single Position Invariant)** | ✅ PASS | 0 | Every trade entered after or simultaneous with prior trade exit (35/35 adjacent pairs verified) |
| **Trailing Ratchet Step Non-Negativity** | ✅ PASS | 0 | Trailing ratchet step count non-negative across all trades (36/36) |

## Section 6: Reproduction & Report Lifecycle
- **Canonical Diagnostics Report:** `docs/review/TRADE_DIAGNOSTICS_LATEST.md`
- **Automatic Regeneration:** This report automatically refreshes after every supported backtest run:
  ```bash
  npx tsx src/scripts/backtest-report.ts --symbol=BTCUSDT --period=all
  ```
- **Determinism Guarantee:** Every trade record, execution timestamp, and metric is deterministically derived from dataset fingerprint `2416041ce5f3a240` and config hash `cf566818`.
