# TradeBot

Crypto trading bot, backtesting engine, parameter optimizer, and interactive Next.js dashboard.

## Features

- **Strategies:**
  - **Ichimoku + RSI Strategy (`IchimokuRsiStrategy`):** Trend-following and momentum confluence strategy based on Tenkan/Kijun crossover on current candle and recent RSI extreme zone hits within a configurable lookback window (`rsiLookback`).
  - **SMA Crossover Strategy (`SmaCrossoverStrategy`):** Baseline moving-average crossover.
- **Backtesting Engine (`BacktestEngine`):**
  - **Trade Modes:** `long-short` (reverses on opposite signals) and `long-only` (flat on sell/stop).
  - **1x Short Selling:** Cash-backed, unleveraged short accounting with mark-to-market continuous equity and realistic maker/taker fees.
  - **Engine-Level TP/SL:** Take-profit and stop-loss evaluated at candle close prior to signal processing without accidental reversals.
  - **Breakdown Metrics:** Long vs. short trade count, win rate, and net PnL breakdown.
- **Interactive Dashboard (Next.js / Lightweight-Charts v5):**
  - Candlestick chart with custom canvas primitive for Ichimoku Cloud fill (green / red spans) projected `displacement` candles into the future.
  - Multi-series indicators: Tenkan-sen, Kijun-sen, Chikou span, Senkou A, Senkou B.
  - Synchronized RSI subchart with visual strategy buy/sell boundary levels.
  - Execution markers displaying side (`BUY`, `SELL`, `TP`, `SL`) and trade exit PnL percentage.
  - Signal Funnel diagnostics explaining zero-trade conditions.
- **Parameter Optimizer (`src/scripts/optimize.ts`):**
  - Chronological 70% train / 30% test walk-forward validation on real multi-year Binance/KuCoin data.
  - Calmar-like ranking and parameter neighborhood stability analysis.
  - Enforces minimum sample size (>= 5,000 1h / 4,000 4h candles) and rejects synthetic data.
- **Review Notes Generator (`src/scripts/review-notes.ts`):**
  - Produces an automated Markdown and JSON self-audit report for reviewers.

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

# Run parameter optimizer
npx tsx src/scripts/optimize.ts --symbol=BTCUSDT
npx tsx src/scripts/optimize.ts --symbol=ETHUSDT

# Generate reviewer notes
npm run review-notes
```

## Strategy Specification: Ichimoku + RSI

- **Indicators:**
  - **Tenkan-sen:** Midpoint of highest high and lowest low over `tenkan` candles (default 9).
  - **Kijun-sen:** Midpoint over `kijun` candles (default 26).
  - **Senkou Span A:** `(Tenkan + Kijun) / 2` shifted forward by `displacement` (default 26).
  - **Senkou Span B:** Midpoint over `senkouB` candles (default 52) shifted forward by `displacement`.
  - **Chikou Span:** Close price shifted backward by `displacement`.
  - **RSI:** Standard Wilder's RSI (default 14).
- **Rules:**
  - **BUY:** Tenkan crosses strictly UP through Kijun on the signal candle AND RSI is inside `[buyMin, buyMax]` (default `[20, 40]`) on the signal candle or within the last `rsiLookback` candles (default 10).
  - **SELL:** Tenkan crosses strictly DOWN through Kijun on the signal candle AND RSI is inside `[sellMin, sellMax]` (default `[60, 80]`) on the signal candle or within the last `rsiLookback` candles.
  - **Lookback Rationale:** Lagging TK crosses rarely coincide with the exact peak RSI extreme. The lookback parameter links the momentum setup to the trend trigger without look-ahead bias.

## Project Structure

```
src/
├── app/                  # Next.js app, UI dashboard, and backtest API route
├── backtest/             # Portfolio accounting, engine, metrics calculation
├── data/                 # Market data providers (Binance, KuCoin) and storage
├── indicators/           # Technical indicators (Ichimoku, RSI, SMA, EMA, MACD, etc.)
├── scripts/              # Optimization and review notes generators
└── strategies/           # Trading strategy implementations
data/                     # Historical OHLCV JSON datasets and optimization CSVs
docs/
├── review/               # Generated review notes (CLAUDE_REVIEW_NOTES.md, last-backtest.json)
└── strategies/           # Optimization reports and strategies log
tests/                    # Jest unit and integration test suites
```
