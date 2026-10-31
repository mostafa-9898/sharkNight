import path from 'path';
import { BacktestEngine } from '../../src/backtest/engine';
import {
  C1L_FULL_CONFIG,
  F3L_FULL_CONFIG,
  F0L_FULL_CONFIG,
} from '../../src/scripts/run-py-c1l';
import {
  loadGzCandles,
  extractStrategyConfig,
} from '../../src/scripts/run-pn3-evaluation';
import { MultiTimeframeStrategy } from '../../src/strategies/multi-timeframe-strategy';
import { roundTo } from '../../src/utils/math';

describe('PY3: C1L Health & Accounting Invariants', () => {
  const dataDir = path.resolve('docs/review/data');
  const btc4h = loadGzCandles(path.join(dataDir, 'BTCUSDT_4h.csv.gz'));
  const btc1h = loadGzCandles(path.join(dataDir, 'BTCUSDT_1h.csv.gz'));

  it('asserts that C1L produces strictly ZERO short trades (100% BUY only)', () => {
    const engine = new BacktestEngine();
    const strat = new MultiTimeframeStrategy({
      ...extractStrategyConfig(C1L_FULL_CONFIG),
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
    });

    const res = engine.run({
      initialBalance: 10000,
      tradeFeePercent: C1L_FULL_CONFIG.tradeFeePercent,
      slippagePercent: C1L_FULL_CONFIG.slippagePercent,
      positionSizePercent: C1L_FULL_CONFIG.positionSizePercent,
      tradeMode: C1L_FULL_CONFIG.tradeMode,
      exitMode: 'trailingOnly',
      trailingStop: C1L_FULL_CONFIG.trailingStop,
      maxOpenPositions: C1L_FULL_CONFIG.maxOpenPositions,
      maxTotalExposurePercent: C1L_FULL_CONFIG.maxTotalExposurePercent,
      allowOppositePositions: C1L_FULL_CONFIG.allowOppositePositions,
      candles: btc4h,
      strategy: strat,
    });

    expect(res.trades.length).toBeGreaterThan(0);
    const shortTrades = res.trades.filter((t) => t.side === 'short');
    expect(shortTrades.length).toBe(0);
    expect(res.trades.every((t) => t.side === 'long')).toBe(true);
  });

  it('asserts that sum of trade PnL equals exactly the balance change', () => {
    const engine = new BacktestEngine();
    const strat = new MultiTimeframeStrategy({
      ...extractStrategyConfig(C1L_FULL_CONFIG),
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
    });

    const initialBalance = 10000;
    const res = engine.run({
      initialBalance,
      tradeFeePercent: C1L_FULL_CONFIG.tradeFeePercent,
      slippagePercent: C1L_FULL_CONFIG.slippagePercent,
      positionSizePercent: C1L_FULL_CONFIG.positionSizePercent,
      tradeMode: C1L_FULL_CONFIG.tradeMode,
      exitMode: 'trailingOnly',
      trailingStop: C1L_FULL_CONFIG.trailingStop,
      maxOpenPositions: C1L_FULL_CONFIG.maxOpenPositions,
      maxTotalExposurePercent: C1L_FULL_CONFIG.maxTotalExposurePercent,
      allowOppositePositions: C1L_FULL_CONFIG.allowOppositePositions,
      candles: btc4h,
      strategy: strat,
    });

    const sumPnl = roundTo(
      res.trades.reduce((sum, t) => sum + t.pnl, 0),
      2
    );
    const balanceChange = roundTo(res.metrics.finalBalance - initialBalance, 2);

    expect(sumPnl).toBe(balanceChange);
    expect(Math.abs(sumPnl - balanceChange)).toBeLessThan(0.01);
  });

  it('asserts that F3L and F0L also enforce long-only mode', () => {
    expect(F3L_FULL_CONFIG.tradeMode).toBe('long-only');
    expect(F0L_FULL_CONFIG.tradeMode).toBe('long-only');
    expect(C1L_FULL_CONFIG.tradeMode).toBe('long-only');
  });
});
