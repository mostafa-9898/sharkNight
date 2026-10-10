import { calculateSMA, SMAIndicator } from '@/indicators/sma';
import type { Candle } from '@/data/models';

describe('SMA (Simple Moving Average)', () => {
  const createMockCandle = (close: number, high = close + 2): Candle => ({
    timestamp: 1600000000000,
    open: close,
    high,
    low: close - 2,
    close,
    volume: 100,
  });

  describe('calculateSMA', () => {
    it('should calculate accurate SMA on known test sequence', () => {
      const values = [10, 20, 30, 40, 50];
      const result = calculateSMA(values, 3);

      expect(result).toHaveLength(5);
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);
      expect(result[2]).toBe(20);
      expect(result[3]).toBe(30);
      expect(result[4]).toBe(40);
    });

    it('should handle period equal to array length', () => {
      const values = [2, 4, 6];
      const result = calculateSMA(values, 3);
      expect(result[0]).toBeNaN();
      expect(result[1]).toBeNaN();
      expect(result[2]).toBe(4);
    });

    it('should return empty array for empty inputs', () => {
      expect(calculateSMA([], 5)).toEqual([]);
    });

    it('should return all NaNs when array is shorter than period', () => {
      const result = calculateSMA([10, 20], 5);
      expect(result).toHaveLength(2);
      expect(result.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('should throw an error for invalid period', () => {
      expect(() => calculateSMA([1, 2, 3], 0)).toThrow('Period must be a positive integer');
      expect(() => calculateSMA([1, 2, 3], -5)).toThrow('Period must be a positive integer');
      expect(() => calculateSMA([1, 2, 3], 2.5)).toThrow('Period must be a positive integer');
    });
  });

  describe('SMAIndicator Class', () => {
    it('should process candles and return IndicatorResult with proper name', () => {
      const candles: Candle[] = [10, 20, 30, 40, 50].map((v) => createMockCandle(v));
      const indicator = new SMAIndicator(3);

      expect(indicator.name).toBe('SMA_3');
      expect(indicator.requiredPeriod).toBe(3);

      const result = indicator.calculate(candles);
      expect(result.values).toHaveLength(5);
      expect(result.values[4]).toBe(40);
    });

    it('should support alternative candle sources like high', () => {
      const candles: Candle[] = [10, 20, 30, 40, 50].map((v) => createMockCandle(v, v + 5));
      const indicator = new SMAIndicator(3, 'high');

      const result = indicator.calculate(candles);
      // Highs are [15, 25, 35, 45, 55], average of last 3 is (35 + 45 + 55) / 3 = 45
      expect(result.values[4]).toBe(45);
    });
  });
});

