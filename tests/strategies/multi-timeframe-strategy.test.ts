import { MultiTimeframeStrategy, aggregateCandles, calculateATR } from '../../src/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../../src/backtest/engine';
import type { Candle } from '../../src/data/models';

function createMockCandles(count: number, intervalMinutes = 15, basePrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  const intervalMs = intervalMinutes * 60 * 1000;
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const start = Math.floor(1600000000000 / fourHoursMs) * fourHoursMs;

  for (let i = 0; i < count; i++) {
    // Generate trending waves
    const wave = Math.sin(i / 15) * 4 + (i > count / 2 ? 5 : -2);
    price = Math.max(10, price + wave);
    candles.push({
      timestamp: start + i * intervalMs,
      open: price,
      high: price + 3,
      low: price - 3,
      close: price + 1,
      volume: 1000,
    });
  }

  return candles;
}

describe('MultiTimeframeStrategy', () => {
  it('instantiates with default and custom configurations', () => {
    const sDefault = new MultiTimeframeStrategy();
    expect(sDefault.name).toContain('MTF_Ichimoku');
    expect(sDefault.requiredCandles).toBeGreaterThan(50);

    const sCustom = new MultiTimeframeStrategy({
      tenkan: 7,
      kijun: 22,
      senkouB: 44,
      displacement: 22,
      rsiPeriod: 10,
      stochKPeriod: 9,
    });
    expect(sCustom.tenkan).toBe(7);
    expect(sCustom.kijun).toBe(22);
    expect(sCustom.senkouB).toBe(44);
  });

  it('aggregateCandles bundles LTF candles into HTF candles causally', () => {
    const candles15m = createMockCandles(16, 15); // 16 x 15m = 4 hours
    const aggregated4h = aggregateCandles(candles15m, 4 * 60 * 60 * 1000);

    expect(aggregated4h.length).toBe(1);
    expect(aggregated4h[0].open).toBe(candles15m[0].open);
    expect(aggregated4h[0].close).toBe(candles15m[candles15m.length - 1].close);
    expect(aggregated4h[0].high).toBe(Math.max(...candles15m.map((c) => c.high)));
    expect(aggregated4h[0].low).toBe(Math.min(...candles15m.map((c) => c.low)));
  });

  it('calculateATR calculates correct ATR series', () => {
    const candles = createMockCandles(30, 15);
    const atr = calculateATR(candles, 14);

    expect(atr.length).toBe(candles.length);
    expect(Number.isNaN(atr[12])).toBe(true);
    expect(Number.isFinite(atr[13])).toBe(true);
    expect(atr[20]).toBeGreaterThan(0);
  });

  it('runs cleanly within BacktestEngine with 5% stop and 9/3 trailing', () => {
    const candles = createMockCandles(200, 15, 100);
    const strategy = new MultiTimeframeStrategy();
    const engine = new BacktestEngine();

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      positionSizePercent: 20,
      trailingStop: {
        initialStopPercent: 5,
        stepPercent: 9,
        raisePercent: 3,
      },
    });

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
    expect(result.equity.length).toBe(candles.length);
    expect(Array.isArray(result.trades)).toBe(true);
  });

  it('supports explicit HTF candles and TDR stop', () => {
    const candles15m = createMockCandles(200, 15, 100);
    const candles1h = aggregateCandles(candles15m, 60 * 60 * 1000);
    const candles4h = aggregateCandles(candles15m, 4 * 60 * 60 * 1000);

    const strategy = new MultiTimeframeStrategy({
      htf4hCandles: candles4h,
      htf1hCandles: candles1h,
      useTdrStop: true,
      tdrMultiplier: 1.5,
      initialStopPercent: 3,
    });

    expect(strategy.useTdrStop).toBe(true);
    expect(strategy.tdrMultiplier).toBe(1.5);
    expect(strategy.initialStopPercent).toBe(3);

    const engine = new BacktestEngine();
    const result = engine.run({
      strategy,
      candles: candles15m,
      initialBalance: 10000,
      stopLossPercent: 3,
    });

    expect(result.metrics).toBeDefined();
  });

  it('exitSignal returns false when mode is trailingOnly', () => {
    const candles = createMockCandles(100, 15, 100);
    const strategy = new MultiTimeframeStrategy();

    // In trailingOnly mode, no signal-based exit occurs
    expect(strategy.exitSignal(candles, 50, 'long', 'trailingOnly')).toBe(false);
    expect(strategy.exitSignal(candles, 50, 'short', 'trailingOnly')).toBe(false);
  });

  it('filters out trades when estimated TDR stop exceeds 5%', () => {
    // Create candles with very high volatility (high-low spread = 20 on price 100 -> ATR > 10%)
    const highVolCandles: Candle[] = [];
    const intervalMs = 15 * 60 * 1000;
    const start = 1600000000000;
    for (let i = 0; i < 100; i++) {
      highVolCandles.push({
        timestamp: start + i * intervalMs,
        open: 100,
        high: 115,
        low: 85,
        close: 100,
        volume: 1000,
      });
    }

    const strategy = new MultiTimeframeStrategy({
      useTdrStop: true,
      tdrMultiplier: 1.5, // ATR is ~30 -> 1.5 * 30 / 100 = 45% > 5%
    });

    for (let i = 50; i < highVolCandles.length; i++) {
      const signal = strategy.analyze(highVolCandles, i);
      // Because estimated stop is > 5%, no trade should ever be opened!
      expect(signal.action).toBe('HOLD');
    }
  });

  it('runs cleanly in BacktestEngine with exitMode trailingOnly', () => {
    const candles = createMockCandles(200, 15, 100);
    const strategy = new MultiTimeframeStrategy({
      useTdrStop: true,
      tdrMultiplier: 1.5,
    });
    const engine = new BacktestEngine();

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      positionSizePercent: 20,
      tradeMode: 'long-short',
      exitMode: 'trailingOnly',
      trailingStop: {
        initialStopPercent: 5,
        stepPercent: 9,
        raisePercent: 3,
      },
    });

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
    // Trades should only exit via stopLoss, trailingStop, or end of dataset
    for (const trade of result.trades) {
      expect(['stopLoss', 'trailingStop', 'end', 'takeProfit', 'timeStop']).toContain(trade.exitReason);
      expect(trade.exitReason).not.toBe('reverse');
      expect(trade.exitReason).not.toBe('tkCrossExit');
    }
  });
});
