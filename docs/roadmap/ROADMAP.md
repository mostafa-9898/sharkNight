# TradeBot Roadmap

## Phase 1: Project Foundation ✅ (Current)
- [x] Initialize TypeScript project
- [x] Setup Jest testing framework
- [x] Setup ESLint
- [x] Create folder structure
- [x] Define base interfaces & types (Candle, Signal, Strategy, Backtest)
- [x] Create documentation structure

## Phase 2: Data Layer ✅
- [x] Implement Binance Public API data provider
  - Endpoint: `GET /api/v3/klines`
  - No API key required for historical data
  - Support pagination for large datasets
- [x] Define Candle/OHLCV data model validation
- [x] Implement JSON local storage for caching historical data
- [x] Write tests for data provider (with mocked HTTP responses)
- [x] Write tests for JSON storage (read/write/cache invalidation)

## Phase 3: Technical Indicators ✅
- [x] Implement SMA (Simple Moving Average)
- [x] Implement EMA (Exponential Moving Average)
- [x] Implement RSI (Relative Strength Index)
- [x] Implement MACD (Moving Average Convergence Divergence)
- [x] Implement Bollinger Bands
- [x] Write tests for each indicator against known correct values
- [x] Validate edge cases (insufficient data, empty arrays, etc.)

## Phase 4: Strategy Engine ✅
- [x] Implement Strategy runner
- [x] Implement SMA Crossover strategy (first strategy)
- [x] Signal generation: BUY, SELL, HOLD
- [x] Write tests for strategy signal generation
- [x] Document strategy in STRATEGIES_LOG.md

## Phase 5: Backtesting Engine ✅
- [x] Implement backtest runner (feeds candles to strategy)
- [x] Implement virtual portfolio (balance, positions, fees)
- [x] Implement trade execution simulation
- [x] Calculate metrics: PnL, Win Rate, Max Drawdown, Sharpe Ratio
- [x] Generate equity curve
- [x] Write tests for backtest engine
- [x] Write tests for portfolio simulation
- [x] Write tests for metrics calculation

## Phase 6: Results & Reporting
- [x] Console reporter (pretty-printed backtest results)
- [x] JSON export of backtest results
- [ ] CSV export of trades
- [x] Write tests for reporters

---

## Future Phases (Not in current scope)

### Phase 7: Dashboard (Next.js) & Real-Time Terminal ✅
- [x] Setup Next.js app with App Router and dark modern trading theme
- [x] Strategy & market configuration UI (Symbols, Timeframes, SMA periods, Balance, Fees)
- [x] Zero-lag interactive Lightweight-Charts candlestick chart with timeframe pills
- [x] In-memory instant client-side cache for 0ms timeframe switches without page reload
- [x] Real-time active open position monitor (Live Price, Unrealized PnL, Duration)
- [x] 1-Year historical datasets pre-cached on disk for BTCUSDT & ETHUSDT across 4h, 1h, 15m, 5m, 1m
- [x] Performance metrics cards (Total PnL, Win Rate, Max Drawdown, Sharpe Ratio)
- [x] Portfolio equity curve chart
- [x] Complete executed trade history table
- [x] Multi-exchange resilience (Binance with automatic KuCoin fallback)
- [x] Visual loading states and spinner overlays for all async actions

### Phase 8: Paper Trading
- [ ] Real-time data streaming
- [ ] Virtual trading with live prices

### Phase 9: Live Trading
- [ ] Exchange API integration (authenticated)
- [ ] Risk management (Stop Loss, Position Sizing)
- [ ] Order management
- [ ] Monitoring & alerts

---

> Last updated: 2026-10-10
