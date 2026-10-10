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

## Phase 4: Strategy Engine
- [ ] Implement Strategy runner
- [ ] Implement SMA Crossover strategy (first strategy)
- [ ] Signal generation: BUY, SELL, HOLD
- [ ] Write tests for strategy signal generation
- [ ] Document strategy in STRATEGIES_LOG.md

## Phase 5: Backtesting Engine
- [ ] Implement backtest runner (feeds candles to strategy)
- [ ] Implement virtual portfolio (balance, positions, fees)
- [ ] Implement trade execution simulation
- [ ] Calculate metrics: PnL, Win Rate, Max Drawdown, Sharpe Ratio
- [ ] Generate equity curve
- [ ] Write tests for backtest engine
- [ ] Write tests for portfolio simulation
- [ ] Write tests for metrics calculation

## Phase 6: Results & Reporting
- [ ] Console reporter (pretty-printed backtest results)
- [ ] JSON export of backtest results
- [ ] CSV export of trades
- [ ] Write tests for reporters

---

## Future Phases (Not in current scope)

### Phase 7: Dashboard (Next.js)
- [ ] Setup Next.js app
- [ ] Strategy configuration UI
- [ ] Backtest results visualization with charts

### Phase 8: Paper Trading
- [ ] Real-time data streaming
- [ ] Virtual trading with live prices

### Phase 9: Live Trading
- [ ] Exchange API integration (authenticated)
- [ ] Risk management (Stop Loss, Position Sizing)
- [ ] Order management
- [ ] Monitoring & alerts

---

> Last updated: 2026-10-04
