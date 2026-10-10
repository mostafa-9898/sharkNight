import { BacktestEngine } from '@/backtest/engine';
import { SMACrossoverStrategy } from '@/strategies/sma-crossover';
import type { Candle } from '@/data/models';

describe('BacktestEngine', () => {
  const createCandle = (close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  });

  const generateCandles = (prices: number[]): Candle[] =>
    prices.map((p, idx) => createCandle(p, 1000000 + idx * 60000));

  it('should throw an error if candles array is empty', () => {
    const engine = new BacktestEngine();
    const strategy = new SMACrossoverStrategy();

    expect(() =>
      engine.run({
        strategy,
        candles: [],
        initialBalance: 10000,
      })
    ).toThrow('Backtest requires at least one candle');
  });

  it('should throw an error if initialBalance is non-positive', () => {
    const engine = new BacktestEngine();
    const strategy = new SMACrossoverStrategy();
    const candles = generateCandles([100, 105]);

    expect(() =>
      engine.run({
        strategy,
        candles,
        initialBalance: 0,
      })
    ).toThrow('Initial balance must be positive');
  });

  it('should execute full backtest simulation and produce trades, metrics, and equity curve', () => {
    const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
    const engine = new BacktestEngine();

    // Fast=2, Slow=4 -> requiredCandles = 5
    // [100, 100, 100, 100, 120, 130, 80]
    // Index 4: Golden Cross (BUY at 120)
    // Index 5: Hold at 130
    // Index 6: Death Cross (SELL at 80)
    const candles = generateCandles([100, 100, 100, 100, 120, 130, 80]);

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      tradeFeePercent: 0.1,
    });

    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(result.equity).toHaveLength(candles.length);
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalTrades).toBe(result.trades.length);
    expect(result.config.initialBalance).toBe(10000);
  });

  it('should cleanly close an open position at the final candle if still open at conclusion', () => {
    const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
    const engine = new BacktestEngine();

    // Sequence where BUY triggers at index 4 and no SELL happens before end of data
    const candles = generateCandles([100, 100, 100, 100, 120, 130]);

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      tradeFeePercent: 0.1,
    });

    // Should have 1 trade closed at conclusion (at price 130)
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(120);
    expect(trade.exitPrice).toBe(130);
    expect(trade.exitSignal.reason).toContain('conclusion');
    expect(trade.pnl).toBeGreaterThan(0); // Profitable trade
  });
});

