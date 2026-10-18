import { calculateStochastic, StochasticIndicator } from '../../src/indicators/stochastic';
import type { Candle } from '../../src/data/models';

function createMockCandles(count: number, basePrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const change = Math.sin(i / 5) * 5;
    price += change;
    candles.push({
      timestamp: now + i * 60000,
      open: price,
      high: price + 2,
      low: price - 2,
      close: price + 1,
      volume: 1000,
    });
  }

  return candles;
}

describe('Stochastic Indicator', () => {
  it('throws error for invalid parameters', () => {
    const candles = createMockCandles(20);
    expect(() => calculateStochastic(candles, { kPeriod: 0 })).toThrow();
    expect(() => calculateStochastic(candles, { dPeriod: -1 })).toThrow();
    expect(() => calculateStochastic(candles, { smooth: 1.5 })).toThrow();
  });

  it('returns NaNs when candle count is insufficient', () => {
    const candles = createMockCandles(5);
    const result = calculateStochastic(candles, { kPeriod: 14, dPeriod: 3, smooth: 3 });
    expect(result.k.every((v) => Number.isNaN(v))).toBe(true);
    expect(result.d.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('calculates values between 0 and 100 once warmed up', () => {
    const candles = createMockCandles(50);
    const result = calculateStochastic(candles, { kPeriod: 14, dPeriod: 3, smooth: 3 });

    expect(result.k.length).toBe(candles.length);
    expect(result.d.length).toBe(candles.length);

    // Warmup: 14 (k) + 2 (smooth) + 2 (d) = 18 bars
    for (let i = 20; i < candles.length; i++) {
      expect(result.k[i]).toBeGreaterThanOrEqual(0);
      expect(result.k[i]).toBeLessThanOrEqual(100);
      expect(result.d[i]).toBeGreaterThanOrEqual(0);
      expect(result.d[i]).toBeLessThanOrEqual(100);
    }
  });

  it('StochasticIndicator class correctly implements Indicator interface', () => {
    const candles = createMockCandles(30);
    const indicator = new StochasticIndicator({ kPeriod: 14, dPeriod: 3, smooth: 3 });
    const res = indicator.calculate(candles);

    expect(indicator.name).toBe('Stochastic_14_3_3');
    expect(indicator.requiredPeriod).toBe(20);
    expect(res.values).toBeDefined();
    expect(res.lines?.k).toBeDefined();
    expect(res.lines?.d).toBeDefined();
  });
});

