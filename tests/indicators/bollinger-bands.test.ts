import { calculateBollingerBands, BollingerBandsIndicator } from '@/indicators/bollinger-bands';
import type { Candle } from '@/data/models';

describe('Bollinger Bands', () => {
  const createMockCandle = (close: number): Candle => ({
    timestamp: 1600000000000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  });

  describe('calculateBollingerBands', () => {
    it('should calculate identical upper and lower bands when variance is zero', () => {
      const values = [50, 50, 50, 50];
      const result = calculateBollingerBands(values, { period: 3, stdDevMultiplier: 2 });

      expect(result.upper[2]).toBe(50);
      expect(result.middle[2]).toBe(50);
      expect(result.lower[2]).toBe(50);
      expect(result.bandwidth[2]).toBe(0);
      expect(result.percentB[2]).toBe(0.5);
    });

    it('should calculate accurate upper, middle, and lower bands on test sequence', () => {
      const values = [10, 20, 30];
      const result = calculateBollingerBands(values, { period: 3, stdDevMultiplier: 2 });

      // middle = (10 + 20 + 30) / 3 = 20
      // variance = ((10-20)^2 + 0 + (30-20)^2) / 3 = 200 / 3 = 66.6667
      // stdDev = sqrt(66.6667) = 8.16496
      // upper = 20 + 2 * 8.16496 = 36.3299
      // lower = 20 - 2 * 8.16496 = 3.6700
      expect(result.middle[2]).toBe(20);
      expect(result.upper[2]).toBeCloseTo(36.33, 1);
      expect(result.lower[2]).toBeCloseTo(3.67, 1);
      expect(result.upper[2]).toBeGreaterThan(result.middle[2]);
      expect(result.lower[2]).toBeLessThan(result.middle[2]);
    });

    it('should return all NaNs when array is shorter than period', () => {
      const result = calculateBollingerBands([10, 20], { period: 5 });
      expect(result.upper).toHaveLength(2);
      expect(result.upper.every((v) => Number.isNaN(v))).toBe(true);
      expect(result.middle.every((v) => Number.isNaN(v))).toBe(true);
      expect(result.lower.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('should throw an error for invalid period or multiplier', () => {
      expect(() => calculateBollingerBands([1, 2, 3], { period: 1 })).toThrow(
        'Period must be an integer >= 2'
      );
      expect(() => calculateBollingerBands([1, 2, 3], { stdDevMultiplier: 0 })).toThrow(
        'stdDevMultiplier must be a positive number'
      );
      expect(() => calculateBollingerBands([1, 2, 3], { stdDevMultiplier: -1.5 })).toThrow(
        'stdDevMultiplier must be a positive number'
      );
    });
  });

  describe('BollingerBandsIndicator Class', () => {
    it('should compute bands from candles and return rich IndicatorResult', () => {
      const candles: Candle[] = [10, 20, 30, 40, 50].map((v) => createMockCandle(v));
      const indicator = new BollingerBandsIndicator({ period: 3, stdDevMultiplier: 2 });

      expect(indicator.name).toBe('BB_3_2');
      expect(indicator.requiredPeriod).toBe(3);

      const result = indicator.calculate(candles);
      expect(result.values).toHaveLength(5);
      expect(result.lines?.upper).toHaveLength(5);
      expect(result.lines?.middle).toHaveLength(5);
      expect(result.lines?.lower).toHaveLength(5);
      expect(result.lines?.bandwidth).toHaveLength(5);
      expect(result.lines?.percentB).toHaveLength(5);
    });
  });
});

