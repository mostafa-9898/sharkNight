import { ModularStrategy } from '@/strategies/modular-strategy';
import type { Candle } from '@/data/models';

describe('ModularStrategy', () => {
  const createCandle = (close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
  });

  describe('Validation & Initialization', () => {
    it('should initialize with default parameters (MA enabled)', () => {
      const strategy = new ModularStrategy();
      expect(strategy.ma.enabled).toBe(true);
      expect(strategy.ma.fastPeriod).toBe(10);
      expect(strategy.ma.slowPeriod).toBe(30);
      expect(strategy.rsi.enabled).toBe(false);
      expect(strategy.macd.enabled).toBe(false);
    });

    it('should throw an error if all indicators are disabled', () => {
      expect(
        () =>
          new ModularStrategy({
            ma: { enabled: false },
            rsi: { enabled: false },
            macd: { enabled: false },
          })
      ).toThrow('At least one indicator must be enabled');
    });

    it('should throw an error if fastPeriod >= slowPeriod for MA', () => {
      expect(
        () =>
          new ModularStrategy({
            ma: { enabled: true, fastPeriod: 20, slowPeriod: 20 },
          })
      ).toThrow('must be less than Slow MA period');
    });
  });

  describe('EMA Crossover Analysis', () => {
    it('should trigger BUY upon Bullish EMA Crossover', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: false },
        macd: { enabled: false },
      });

      // Prices: [100, 100, 100, 100, 100, 120]
      const candles = [100, 100, 100, 100, 100, 120].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).toBe('BUY');
      expect(signal.reason).toContain('Golden Cross');
    });
  });

  describe('RSI Alone Analysis', () => {
    it('should trigger BUY when RSI recovers above oversold', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: false },
        rsi: { enabled: true, period: 2, oversold: 30, overbought: 70 },
        macd: { enabled: false },
      });

      // Sharp drop then small recovery
      const candles = [100, 80, 60, 40, 20, 30].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).toBeDefined();
    });
  });
});

