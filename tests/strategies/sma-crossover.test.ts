import { SMACrossoverStrategy } from '@/strategies/sma-crossover';
import type { Candle } from '@/data/models';

describe('SMACrossoverStrategy', () => {
  const createCandle = (close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
  });

  describe('Constructor & Validation', () => {
    it('should initialize with default parameters (fast=10, slow=30)', () => {
      const strategy = new SMACrossoverStrategy();
      expect(strategy.fastPeriod).toBe(10);
      expect(strategy.slowPeriod).toBe(30);
      expect(strategy.requiredCandles).toBe(31);
      expect(strategy.name).toBe('SMA_Crossover_10_30');
    });

    it('should throw an error if fastPeriod >= slowPeriod', () => {
      expect(() => new SMACrossoverStrategy({ fastPeriod: 20, slowPeriod: 20 })).toThrow(
        'fastPeriod (20) must be strictly less than slowPeriod (20)'
      );
      expect(() => new SMACrossoverStrategy({ fastPeriod: 30, slowPeriod: 10 })).toThrow(
        'fastPeriod (30) must be strictly less than slowPeriod (10)'
      );
    });

    it('should throw an error for non-positive or non-integer periods', () => {
      expect(() => new SMACrossoverStrategy({ fastPeriod: 0, slowPeriod: 10 })).toThrow();
      expect(() => new SMACrossoverStrategy({ fastPeriod: 5, slowPeriod: -1 })).toThrow();
    });
  });

  describe('Signal Analysis', () => {
    it('should return HOLD when historical candles are fewer than requiredCandles', () => {
      const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
      const candles = [10, 12, 14].map((p, idx) => createCandle(p, 1000 + idx * 60000));

      const signal = strategy.analyze(candles, 1);
      expect(signal.action).toBe('HOLD');
      expect(signal.reason).toContain('Insufficient');
    });

    it('should trigger a BUY signal upon Golden Cross (Fast crosses above Slow)', () => {
      const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
      // requiredCandles = 5
      // We want:
      // at index 3 (prev): Fast <= Slow
      // at index 4 (curr): Fast > Slow
      //
      // Prices: [100, 100, 100, 100, 120]
      // Index 3:
      //   Fast(2) uses [100, 100] = 100
      //   Slow(4) uses [100, 100, 100, 100] = 100 -> Fast <= Slow (100 <= 100)
      // Index 4:
      //   Fast(2) uses [100, 120] = 110
      //   Slow(4) uses [100, 100, 100, 120] = 105 -> Fast > Slow (110 > 105)
      // Crossover!
      const candles = [100, 100, 100, 100, 120].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, 4);

      expect(signal.action).toBe('BUY');
      expect(signal.price).toBe(120);
      expect(signal.reason).toContain('Golden Cross');
      expect(signal.metadata?.fastSMA).toBe(110);
      expect(signal.metadata?.slowSMA).toBe(105);
      expect(signal.metadata?.prevFastSMA).toBe(100);
      expect(signal.metadata?.prevSlowSMA).toBe(100);
    });

    it('should trigger a SELL signal upon Death Cross (Fast crosses below Slow)', () => {
      const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
      // Prices: [100, 100, 100, 100, 80]
      // Index 3:
      //   Fast(2) uses [100, 100] = 100
      //   Slow(4) uses [100, 100, 100, 100] = 100 -> Fast >= Slow (100 >= 100)
      // Index 4:
      //   Fast(2) uses [100, 80] = 90
      //   Slow(4) uses [100, 100, 100, 80] = 95 -> Fast < Slow (90 < 95)
      // Death Cross!
      const candles = [100, 100, 100, 100, 80].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, 4);

      expect(signal.action).toBe('SELL');
      expect(signal.price).toBe(80);
      expect(signal.reason).toContain('Death Cross');
      expect(signal.metadata?.fastSMA).toBe(90);
      expect(signal.metadata?.slowSMA).toBe(95);
    });

    it('should return HOLD when both remain in existing trend without crossover', () => {
      const strategy = new SMACrossoverStrategy({ fastPeriod: 2, slowPeriod: 4 });
      // Prices continuously rising: [10, 20, 30, 40, 50, 60]
      // At index 4 and index 5, fast is already strictly above slow
      const candles = [10, 20, 30, 40, 50, 60].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, 5);
      expect(signal.action).toBe('HOLD');
      expect(signal.reason).toContain('No crossover');
    });

    it('should throw an error if currentIndex is out of bounds', () => {
      const strategy = new SMACrossoverStrategy();
      expect(() => strategy.analyze([], 0)).toThrow('undefined');
    });
  });
});

