import { calculateMACD, MACDIndicator } from '@/indicators/macd';
import type { Candle } from '@/data/models';

describe('MACD (Moving Average Convergence Divergence)', () => {
  const createMockCandle = (close: number): Candle => ({
    timestamp: 1600000000000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  });

  describe('calculateMACD', () => {
    it('should calculate macd, signal, and histogram correctly on small sample', () => {
      // Create series of 15 points with fast=3, slow=6, signal=3
      const values = Array.from({ length: 15 }, (_, i) => 10 + i * 2);
      const result = calculateMACD(values, { fastPeriod: 3, slowPeriod: 6, signalPeriod: 3 });

      expect(result.macd).toHaveLength(15);
      expect(result.signal).toHaveLength(15);
      expect(result.histogram).toHaveLength(15);

      // Slow EMA needs 6 elements (indices 0..5), so macd is valid from index 5
      expect(Number.isNaN(result.macd[4])).toBe(true);
      expect(Number.isNaN(result.macd[5])).toBe(false);

      // Signal line needs 3 valid MACD points (indices 5, 6, 7), so valid from index 7
      expect(Number.isNaN(result.signal[6])).toBe(true);
      expect(Number.isNaN(result.signal[7])).toBe(false);

      // Histogram is MACD - Signal
      expect(result.histogram[7]).toBeCloseTo(result.macd[7] - result.signal[7], 5);
    });

    it('should return empty arrays for empty inputs', () => {
      const result = calculateMACD([]);
      expect(result.macd).toEqual([]);
      expect(result.signal).toEqual([]);
      expect(result.histogram).toEqual([]);
    });

    it('should throw error when fastPeriod >= slowPeriod', () => {
      expect(() => calculateMACD([1, 2, 3], { fastPeriod: 10, slowPeriod: 10 })).toThrow(
        'fastPeriod (10) must be less than slowPeriod (10)'
      );
      expect(() => calculateMACD([1, 2, 3], { fastPeriod: 15, slowPeriod: 10 })).toThrow(
        'fastPeriod (15) must be less than slowPeriod (10)'
      );
    });

    it('should throw error when any period is not a positive integer', () => {
      expect(() => calculateMACD([1, 2, 3], { fastPeriod: 0 })).toThrow(
        'All MACD periods must be positive integers'
      );
    });
  });

  describe('MACDIndicator Class', () => {
    it('should produce IndicatorResult with both values and lines', () => {
      const candles: Candle[] = Array.from({ length: 40 }, (_, i) =>
        createMockCandle(100 + Math.sin(i / 5) * 10)
      );

      const indicator = new MACDIndicator({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
      expect(indicator.name).toBe('MACD_12_26_9');
      expect(indicator.requiredPeriod).toBe(34);

      const result = indicator.calculate(candles);
      expect(result.values).toBeDefined();
      expect(result.lines).toBeDefined();
      expect(result.lines?.macd).toHaveLength(40);
      expect(result.lines?.signal).toHaveLength(40);
      expect(result.lines?.histogram).toHaveLength(40);
    });
  });
});

