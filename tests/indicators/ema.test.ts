import { calculateEMA, EMAIndicator } from '@/indicators/ema';
import type { Candle } from '@/data/models';

describe('EMA (Exponential Moving Average)', () => {
  const createMockCandle = (close: number): Candle => ({
    timestamp: 1600000000000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  });

  describe('calculateEMA', () => {
    it('should calculate accurate EMA with SMA seeding and smoothing multiplier', () => {
      const values = [10, 20, 30, 40];
      // period = 3, multiplier = 2 / (3 + 1) = 0.5
      // index 2: SMA(10, 20, 30) = 20
      // index 3: (40 - 20) * 0.5 + 20 = 30
      const result = calculateEMA(values, 3);

      expect(result).toHaveLength(4);
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);
      expect(result[2]).toBe(20);
      expect(result[3]).toBe(30);
    });

    it('should return empty array for empty inputs', () => {
      expect(calculateEMA([], 5)).toEqual([]);
    });

    it('should return all NaNs when array is shorter than period', () => {
      const result = calculateEMA([10, 20], 3);
      expect(result).toHaveLength(2);
      expect(result.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('should throw an error for invalid period', () => {
      expect(() => calculateEMA([1, 2, 3], 0)).toThrow('Period must be a positive integer');
      expect(() => calculateEMA([1, 2, 3], -2)).toThrow('Period must be a positive integer');
    });
  });

  describe('EMAIndicator Class', () => {
    it('should process candles and return IndicatorResult with proper properties', () => {
      const candles: Candle[] = [10, 20, 30, 40].map((v) => createMockCandle(v));
      const indicator = new EMAIndicator(3);

      expect(indicator.name).toBe('EMA_3');
      expect(indicator.requiredPeriod).toBe(3);

      const result = indicator.calculate(candles);
      expect(result.values[3]).toBe(30);
    });
  });
});

