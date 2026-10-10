import { StrategyRunner } from '@/strategies/runner';
import { SMACrossoverStrategy } from '@/strategies/sma-crossover';
import type { Candle } from '@/data/models';

describe('StrategyRunner', () => {
  const createCandle = (close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 500,
  });

  const generateCandles = (prices: number[]): Candle[] =>
    prices.map((p, idx) => createCandle(p, 1000000 + idx * 60000));

  it('should run strategy over all candles returning a signal for each candle', () => {
    const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
    const runner = new StrategyRunner(strategy);
    const candles = generateCandles([10, 10, 10, 10, 20, 25, 10]);

    const signals = runner.run(candles);
    expect(signals).toHaveLength(7);
    expect(signals[0].action).toBe('HOLD');
  });

  it('should filter out HOLD signals and return only actionable BUY / SELL signals', () => {
    const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
    const runner = new StrategyRunner(strategy);

    // Sequence with a Golden Cross at index 4 and Death Cross at index 6
    // [100, 100, 100, 100, 120, 120, 80]
    const candles = generateCandles([100, 100, 100, 100, 120, 120, 80]);

    const actionable = runner.runActionable(candles);
    expect(actionable.length).toBeGreaterThanOrEqual(1);
    expect(actionable.every((s) => s.action === 'BUY' || s.action === 'SELL')).toBe(true);
  });

  it('should evaluate the latest candle in the array', () => {
    const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
    const runner = new StrategyRunner(strategy);
    const candles = generateCandles([100, 100, 100, 100, 120]);

    const latest = runner.evaluateLatest(candles);
    expect(latest.action).toBe('BUY');
    expect(latest.price).toBe(120);
  });

  it('should throw when evaluating latest on empty array', () => {
    const strategy = new SMACrossoverStrategy();
    const runner = new StrategyRunner(strategy);
    expect(() => runner.evaluateLatest([])).toThrow('Cannot evaluate empty candles array');
  });

  it('should accurately summarize signal counts', () => {
    const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
    const runner = new StrategyRunner(strategy);
    const candles = generateCandles([100, 100, 100, 100, 120, 120, 80]);

    const summary = runner.summarize(candles);
    expect(summary.totalCandles).toBe(7);
    expect(summary.totalSignals).toBe(7);
    expect(summary.buyCount + summary.sellCount + summary.holdCount).toBe(7);
  });
});

