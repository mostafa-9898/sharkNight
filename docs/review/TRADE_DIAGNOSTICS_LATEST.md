# Trade Diagnostics Report — Latest Backtest Run

> **Canonical Diagnostic Log** | Generated: `2026-10-21T13:23:03.995Z` | Git: `68f2c76` (dirty) | Config Hash: `8add6bec`

---

## Section 1: Run Identity & Reproducibility
| Parameter | Value | Specification Details |
|---|---|---|
| **Run Timestamp (UTC)** | `2026-10-21T13:23:03.995Z` | Deterministic backtest execution |
| **Git Revision** | `68f2c76` | Working tree: `DIRTY` |
| **Strategy** | **MultiTimeframe (strict, cross, fisher=confirm/fisher) (kijunSlopeFilter: disabled, structureFilter: disabled)** | Strategy engine configuration |
| **Symbol & Timeframe** | `BTCUSDT` / `4h` | Higher-timeframe context |
| **Evaluation Type** | **Standard Evaluation Window** | Out-of-sample / In-sample protocol |
| **Effective Data Window** | `2020-09-13T12:26:40Z` → `2020-09-13T18:26:40Z` | Period: `all` |
| **Candle Dataset** | **7** candles | Fingerprint: `709ae6876010f4ad` |
| **Strategy Indicators** | Ichimoku (9, 26, 52, 26) | MTF (strict, cross, Fisher: confirm/fisher) |
| **Filters Applied** | Kijun Slope: `OFF` | Structure: `OFF` |
| **Execution & Trade Mode** | `long-short` / `reverse` | Intrabar stop checking: `intrabar` |
| **Position Sizing & Risk** | Size: **20%** | Risk per trade: **1%** (Initial Capital: $10,000) |
| **Cost Model** | Fee: **0.1%** per side | Adverse exit slippage: **0%** |
| **Stop Loss Policy** | **5.0%** initial stop | Type: Fixed Stop Loss |
| **Trailing Stop Policy** | `DISABLED` (N/A) | Requires --trailingStop to enable |
| **Take Profit Target** | `DISABLED` (N/A) | Uncapped trend-following mode |

## Section 2: Executive Summary & Capital Preservation Diagnostics
| Performance Metric | Recorded Value | Capital Preservation & Risk Metric | Recorded Value |
|---|---|---|---|
| **Initial Account Equity** | $10000.00 | **Maximum Equity Drawdown** | **0.00%** |
| **Final Account Equity** | $10000.00 | **Max Drawdown ($)** | $0.00 |
| **Net Return ($ / %)** | **-$500.00** (**0.00%**) | **Loss Streak (Max Consecutive)** | **1** trades (1 bars / ~0.0 days) |
| **Realized Closed PnL** | -$500.00 | **Market Exposure Ratio** | **14.29%** of total period |
| **Unrealized Open PnL** | $0.00 (No open position) | **Total Fees Paid** | $0.00 (0.00% fee drag) |
| **Total Completed Trades** | **1** (Long: 0 / Short: 0) | **Average Trade Holding Time** | **1** bars (Median: **1**, Max: **1**) |
| **Win Rate** | **0.0%** (0W / 1L) | **Total Profit Given Back** | $1.00 (from peak MFE) |
| **Profit Factor** | **0.00** | **Trailing Stop Trigger Rate** | **0%** (0/1 trades) |
| **Trade Expectancy** | **0.00%** per trade | **Average Win / Average Loss** | **+0.00%** / **0.00%** (Ratio: **N/A**) |

## Section 3: Every Completed Trade (Chronological Log)
> ℹ️ **Table Conventions:**
> - **Risk ($):** Initial cash risk budget at trade entry (`positionValue × initialStopPercent`).
> - **MFE / MAE in R:** Maximum favorable/adverse excursion divided by initial stop distance.
> - **Giveback:** Difference between peak unrealized gain (MFE) and final realized return.

| ID | Side | Entry Time (UTC) | Entry Price | Exit Time (UTC) | Exit Price | Qty | Pos Value | Risk ($) | Init Stop | Exit Reason | Gross PnL | Fee | Net PnL | Return % | MFE (R) | MAE (R) | Giveback % | Trailing Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TR-001 | `LONG` | 2020-09-13T12:26:40Z | $100.00 | 2020-09-13T13:26:40Z | $95.00 | 1.0000 | $100.00 | $5.00 | $95.00 | `stopLoss` | -$5.00 | $0.00 | -$500.00 | **-5.00%** | +1.0% (+0.20R) | -5.0% (-1.00R) | 1.0% | Disabled |

### Open Position at Backtest Conclusion
> ℹ️ **Status:** No open position remained at backtest conclusion. All trades completed natural exits.

## Section 4: Risk, Drawdown & Exposure Diagnostics
### 1. Top Drawdown Periods
| # | Peak Date | Peak Equity | Trough Date | Trough Equity | Max Depth % | Bars to Trough | Recovery Date | Recovery Status |
|---|---|---|---|---|---|---|---|---|
| 1 | 2020-09-13T12:26:40Z | $10000.00 | 2020-09-13T13:26:40Z | $9500.00 | **-5.00%** | 1 bars | Unrecovered | ⚠️ Active Drawdown |

### 2. Exit Reason Distribution
| Exit Reason | Trade Count | Percentage | Cumulative Net PnL | Cumulative Return % | Avg Return % | Avg Holding Bars |
|---|---|---|---|---|---|---|
| `stopLoss` | 1 | 100% | -$500.00 | -5.00% | -5.00% | 1 bars |

### 3. Yearly Performance Breakdown
| Calendar Year | Trade Count | Win Rate | Net PnL ($) | Cumulative Return % | Avg Return % |
|---|---|---|---|---|---|
| **2020** | 1 | 0% | -$500.00 | -5.00% | -5.00% |

## Section 5: Decision & Signal Funnel Diagnostics
> ℹ️ Passive signal tracing was not enabled for this backtest run (`collectTrace: false`).
### 3. Execution & Behavioral Warnings
- [WARNING] Prolonged Underwater Exposure: 1 trades (100%) spent > 70% of holding time in drawdown.

### 4. Invariant Self-Checks
| Invariant Name | Status | Violations | Verification Details |
|---|---|---|---|
| **Cash / Equity Conservation** | ✅ PASS | 0 | |initialBalance + sum(trade.pnl) - finalEquity| = 0.0000e+0 (threshold 1e-5) |
| **Stop Fill Integrity (Intrabar Gap/Slippage)** | ⚠️ INCOMPLETE | 0 | 0/0 checked stop exits verified (1/1 uncheckable due to missing stop price or exit candle) |
| **Trade Non-Overlap (Single Position Invariant)** | ⚪ N/A | 0 | Only 1 trade executed; no adjacent trade pairs exist to evaluate overlap (0 trade pairs) |
| **Trailing Ratchet Step Non-Negativity** | ⚪ N/A | 0 | Trailing stop disabled in configuration (0 applicable trades) |
| **Trailing Stop Monotonicity (Non-Retreating Guard)** | ⚪ N/A | 0 | Trailing stop disabled in configuration (0 applicable trades) |

## Section 6: Reproduction & Report Lifecycle
- **Canonical Diagnostics Report:** `docs/review/TRADE_DIAGNOSTICS_LATEST.md`
- **Automatic Regeneration:** This report automatically refreshes after every supported backtest run:
  ```bash
  npx tsx src/scripts/backtest-report.ts --symbol=BTCUSDT --period=6y
  ```
- **Determinism Guarantee:** Every trade record, execution timestamp, and metric is deterministically derived from dataset fingerprint `709ae6876010f4ad` and config hash `8add6bec`.
