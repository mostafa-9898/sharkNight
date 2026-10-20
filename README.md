# TradeBot

Crypto trading bot, backtesting engine, multi-position portfolio simulator, and interactive Next.js dashboard.

## Features

- **Strategies:**
  - **Multi-Timeframe Strategy (`MultiTimeframeStrategy`):**
    - **Macro & Intermediate Trend (HTF):** Evaluated strictly causally on 4h & 1h candles using Ichimoku Cloud (Price vs Cloud top/bottom and Tenkan vs Kijun). Both timeframes must strictly agree.
    - **LTF Entry Triggers:** Evaluated on lower timeframe candles via Tenkan/Kijun crossover, Stochastic (%K/%D) crossover, and Fisher RSI / IFT-RSI.
    - **Fisher RSI / IFT-RSI Integration:** Standalone RSI has been deprecated and replaced with Fisher Transform RSI / Inverse Fisher Transform RSI (`fisherMode: 'confirm'`, `fisherKind: 'ift'` by default).
    - **Filters:** Causal Kijun-sen slope filter (`kijunSlopeFilter`) and market structure pivot filter (`structureFilter`).
  - **SMA Crossover Strategy (`SmaCrossoverStrategy`):** Baseline moving-average crossover.
- **Backtesting & Multi-Position Engine (`BacktestEngine`):**
  - **Multi-Position Execution:** Supports concurrent same-direction positions via `maxOpenPositions`, dynamic equity-based allocation, notional exposure limits (`maxTotalExposurePercent`), and minimum bars between entries (`minBarsBetweenEntries`).
  - **Trade Modes:** `long-only` and `long-short` execution.
  - **Advanced Trailing Stops:** Stepped trailing stop with ratchet mechanisms (Candidate D: 3% initial stop, 3% step trigger, 1.5% raise), break-even preservation, intrabar gap modeling, and adverse slippage.
  - **Independent Position Tracking:** Each concurrent position maintains its own ID, entry price, sizing, trailing stop ratchet, and commission.
- **Interactive Dashboard (Next.js / Lightweight-Charts v5):**
  - Candlestick chart with custom canvas primitive for Ichimoku Cloud fill (green / red spans) projected `displacement` candles into the future.
  - Multi-series indicators: Tenkan-sen, Kijun-sen, Senkou A, Senkou B, and Stochastic oscillator.
  - Strategy selector with MTF strict filters and Fisher RSI / IFT-RSI configuration.
  - Execution markers displaying trade entries, exits, side (`BUY`, `SELL`, `TP`, `SL`), and realized PnL.
  - Diagnostics tracking signal funnel, filter attrition, and concurrency stats.
- **Validation & Simulation Suites:**
  - `src/scripts/validate-fisher.ts`: Empirical A/B testing of Fisher & IFT configurations across multi-year datasets.
  - `src/scripts/validate-multi.ts`: Comprehensive multi-position capacity, concurrency, and synthetic/null testing across in-sample and out-of-sample markets.
  - `src/scripts/portfolio.ts`: Portfolio simulation with pooled capital, dynamic capital sizing, and cross-market concurrency control.
  - `src/scripts/backtest-report.ts`: Detailed Sections A-K backtest review report generation with versioned history archiving.

## Setup

```bash
npm install
```

## Usage

```bash
# Run tests (Jest)
npm test

# Check TypeScript types
npx tsc --noEmit

# Run ESLint
npm run lint

# Run Fisher A/B validation
npx tsx src/scripts/validate-fisher.ts

# Run multi-position validation
npm run validate-multi

# Run portfolio simulation
npm run portfolio

# Generate reproducible backtest review report
npm run backtest-report
```

## Strategy Specification: MultiTimeframe (`D*`)

- **HTF Trend (`strict`):**
  - Evaluated on closed 4h and 1h candles strictly before or at the LTF candle timestamp.
  - **Bullish:** `close > max(senkouA, senkouB)` AND `tenkan > kijun` on **both** 4h and 1h.
  - **Bearish:** `close < min(senkouA, senkouB)` AND `tenkan < kijun` on **both** 4h and 1h.
- **LTF Trigger & Confirmation:**
  - **TK Cross:** Tenkan crosses strictly UP (for long) or DOWN (for short) through Kijun.
  - **Stochastic Cross:** %K crosses %D in the direction of the trend.
  - **Fisher RSI / IFT (`I3: confirm / ift`):** Confirms entry direction (`ift[i] > ift[i-1]` for long; `ift[i] < ift[i-1]` for short). Standalone RSI has been superseded by this indicator.
- **Filters:**
  - **Kijun Slope:** `kijun[i] > kijun[i-5]` for long; `kijun[i] < kijun[i-5]` for short.
  - **Market Structure:** Validates higher-highs and higher-lows (HH/HL) for long; lower-highs and lower-lows (LH/LL) for short using causal swing pivots.

## Project Structure

```
src/
├── app/                  # Next.js app, UI dashboard, and backtest API route
├── backtest/             # Multi-position portfolio engine, execution invariants, reports
├── data/                 # Market data providers (Binance, KuCoin) and storage
├── indicators/           # Technical indicators (Ichimoku, Fisher RSI, IFT, Stochastic, ATR, Swings)
├── scripts/              # Validation, portfolio simulation, and report generation
└── strategies/           # MultiTimeframeStrategy and baseline strategies
data/                     # Historical OHLCV JSON datasets and optimization CSVs
docs/
├── review/               # Generated research & validation reports (PORTFOLIO.md, VALIDATION.md, FISHER_AB.md, OSC_LAG.md, etc.)
└── strategies/           # Strategy research and logs
tests/                    # Comprehensive Jest unit, regression, and property test suites
```
