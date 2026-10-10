import { calculateRSI, RSIIndicator } from '@/indicators/rsi';
import type { Candle } from '@/data/models';

describe('RSI (Relative Strength Index)', () => {
  const createMockCandle = (close: number): Candle => ({
    timestamp: 1600000000000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
  });

  describe('calculateRSI', () => {
    it('should return 100 when price only increases (0 losses)', () => {
      const values = [10, 11, 12, 13, 14, 15]; // 5 gains, 0 losses
      const result = calculateRSI(values, 5);

      expect(result).toHaveLength(6);
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[4])).toBe(true);
      expect(result[5]).toBe(100);
    });

    it('should return 0 when price only decreases (0 gains)', () => {
      const values = [15, 14, 13, 12, 11, 10]; // 5 losses, 0 gains
      const result = calculateRSI(values, 5);

      expect(result).toHaveLength(6);
      expect(result[5]).toBe(0);
    });

    it('should return 50 when price is flat (0 gains and 0 losses)', () => {
      const values = [10, 10, 10, 10, 10, 10];
      const result = calculateRSI(values, 5);

      expect(result[5]).toBe(50);
    });

    it('should keep RSI strictly bounded between 0 and 100 on oscillating data', () => {
      const values = [
        44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
        46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
      ];
      const result = calculateRSI(values, 14);

      for (let i = 14; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
        expect(result[i]).toBeLessThanOrEqual(100);
      }
    });

    it('should return empty array for empty inputs', () => {
      expect(calculateRSI([], 14)).toEqual([]);
    });

    it('should return all NaNs when array has fewer elements than period + 1', () => {
      const result = calculateRSI([10, 20, 30], 5);
      expect(result).toHaveLength(3);
      expect(result.every((v) => Number.isNaN(v))).toBe(true);
    });

    it('should throw an error for invalid period', () => {
      expect(() => calculateRSI([10, 20], 0)).toThrow('Period must be a positive integer');
    });
  });

  describe('RSIIndicator Class', () => {
    it('should compute RSI from candles array with proper metadata', () => {
      const values = [10, 11, 12, 13, 14, 15];
      const candles = values.map((v) => createMockCandle(v));
      const indicator = new RSIIndicator(5);

      expect(indicator.name).toBe('RSI_5');
      expect(indicator.requiredPeriod).toBe(6);

      const result = indicator.calculate(candles);
      expect(result.values[5]).toBe(100);
    });
  });
});

