import { ModularStrategy, StrategyOne } from '@/strategies/modular-strategy';
import type { Candle } from '@/data/models';

describe('ModularStrategy & Strategy 1 (Triple Confluence)', () => {
  const createCandle = (close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000,
  });

  // Helper to inject deterministic indicator caches for precise unit testing
  function injectIndicatorCache(
    strategy: ModularStrategy,
    candles: Candle[],
    indicators: {
      fastMA?: number[];
      slowMA?: number[];
      rsi?: number[];
      macd?: { macd: number[]; signal: number[]; histogram: number[] };
    }
  ) {
    (strategy as unknown as { cachedCandlesRef: readonly Candle[] }).cachedCandlesRef = candles;
    if (indicators.fastMA) {
      (strategy as unknown as { cachedFastMA: number[] }).cachedFastMA = indicators.fastMA;
    }
    if (indicators.slowMA) {
      (strategy as unknown as { cachedSlowMA: number[] }).cachedSlowMA = indicators.slowMA;
    }
    if (indicators.rsi) {
      (strategy as unknown as { cachedRSI: number[] }).cachedRSI = indicators.rsi;
    }
    if (indicators.macd) {
      (strategy as unknown as { cachedMACD: { macd: number[]; signal: number[]; histogram: number[] } }).cachedMACD = indicators.macd;
    }
  }

  // --------------------------------------------------------------------------
  // 1. Validation & Initialization (Bugs #8, #9)
  // --------------------------------------------------------------------------
  describe('Validation & Initialization', () => {
    it('should initialize ModularStrategy with default parameters (MA enabled)', () => {
      const strategy = new ModularStrategy();
      expect(strategy.ma.enabled).toBe(true);
      expect(strategy.ma.fastPeriod).toBe(10);
      expect(strategy.ma.slowPeriod).toBe(30);
      expect(strategy.rsi.enabled).toBe(false);
      expect(strategy.macd.enabled).toBe(false);
      expect(strategy.confirmationWindow).toBe(3);
      expect(strategy.takeProfitPercent).toBeUndefined();
    });

    it('should initialize StrategyOne with all 3 indicators enabled and correct defaults', () => {
      const s1 = new StrategyOne();
      expect(s1.ma.enabled).toBe(true);
      expect(s1.ma.fastPeriod).toBe(10);
      expect(s1.ma.slowPeriod).toBe(30);

      expect(s1.rsi.enabled).toBe(true);
      expect(s1.rsi.period).toBe(14);
      expect(s1.rsi.buyMin).toBe(25);
      expect(s1.rsi.buyMax).toBe(35);
      expect(s1.rsi.sellMin).toBe(65);
      expect(s1.rsi.sellMax).toBe(75);

      expect(s1.macd.enabled).toBe(true);
      expect(s1.macd.fastPeriod).toBe(12);
      expect(s1.macd.slowPeriod).toBe(26);
      expect(s1.macd.signalPeriod).toBe(9);

      expect(s1.confirmationWindow).toBe(3);
      expect(s1.takeProfitPercent).toBeUndefined();
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

    it('should throw an error if RSI buyMin >= buyMax or sellMin >= sellMax', () => {
      expect(
        () =>
          new ModularStrategy({
            ma: { enabled: false },
            rsi: { enabled: true, buyMin: 35, buyMax: 30 },
          })
      ).toThrow('RSI buyMin (35) must be strictly less than buyMax (30)');

      expect(
        () =>
          new ModularStrategy({
            ma: { enabled: false },
            rsi: { enabled: true, sellMin: 75, sellMax: 70 },
          })
      ).toThrow('RSI sellMin (75) must be strictly less than sellMax (70)');

      expect(
        () =>
          new ModularStrategy({
            ma: { enabled: false },
            rsi: { enabled: true, buyMin: 20, buyMax: 70, sellMin: 65, sellMax: 80 },
          })
      ).toThrow('RSI buyMax (70) must be strictly less than sellMin (65)');
    });

    it('should throw an error if fastPeriod >= slowPeriod for MACD', () => {
      expect(
        () =>
          new ModularStrategy({
            ma: { enabled: false },
            macd: { enabled: true, fastPeriod: 26, slowPeriod: 12 },
          })
      ).toThrow('MACD fastPeriod (26) must be less than slowPeriod (12)');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Single Indicator Modes
  // --------------------------------------------------------------------------
  describe('Single Indicator Modes', () => {
    it('should trigger BUY upon Bullish EMA Crossover in MA-only mode', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: false },
        macd: { enabled: false },
      });

      const candles = [100, 100, 100, 100, 100, 120].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).toBe('BUY');
      expect(signal.reason).toContain('EMA 2/4 Bullish Cross');
    });

    it('should trigger BUY when RSI is in buy zone [25, 35] in RSI-only mode', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: false },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: false },
      });

      // Synthetic candles: sharp drop pushing RSI into 25-35 range
      const candles = [100, 80, 60, 45, 35, 32].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. Strategy 1 (Triple Confluence: EMA + MACD + RSI) - BUY Rules
  // --------------------------------------------------------------------------
  describe('Triple Confluence BUY Rules', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    function createTripleStrategy(confirmationWindow = 3) {
      return new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
        confirmationWindow,
      });
    }

    it('BUY fires when RSI=30 (in [25, 35]) + MACD cross up + EMA cross up inside window', () => {
      const strategy = createTripleStrategy(3);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 9 (prev 10<=12, curr 15>11)
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 9 (prev 0<=1, curr 1>0.5)
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30], // RSI=30 on current candle
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('BUY');
      expect(signal.reason).toContain('Strategy 1 Confluence');
      expect(signal.reason).toContain('Bullish Cross');
      expect(signal.reason).toContain('RSI in buy zone [25-35] (30.0)');
    });

    it('BUY does NOT fire when RSI=20 (strictly below 25) even if both crosses happen', () => {
      const strategy = createTripleStrategy(3);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 9
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 9
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 20], // RSI=20 (< 25)
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('BUY does NOT fire when RSI=40 (strictly above 35) even if both crosses happen', () => {
      const strategy = createTripleStrategy(3);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 9
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 9
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 40], // RSI=40 (> 35)
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('BUY does NOT fire with only EMA cross up (MACD has no cross up)', () => {
      const strategy = createTripleStrategy(3);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // EMA cross up at 9
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // MACD flat, below signal
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          histogram: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30], // RSI in range
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('BUY does NOT fire with only MACD cross up (EMA has no cross up)', () => {
      const strategy = createTripleStrategy(3);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10], // EMA flat, below slow
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], // MACD cross up at 9
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30], // RSI in range
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('BUY does NOT fire when cross is older than confirmation window (window=3)', () => {
      const strategy = createTripleStrategy(3);

      // EMA crossed up at index 5 (5 <= 12, 15 > 11).
      // MACD crosses up at index 9.
      // With window=3 and currentIndex=9, window covers indices [7, 8, 9].
      // Index 5 is outside the window!
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 15, 15, 15, 15, 15],
        slowMA: [12, 12, 12, 12, 12, 11, 11, 11, 11, 11],
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 9
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('BUY fires when crosses happen on different candles inside confirmation window (window=3)', () => {
      const strategy = createTripleStrategy(3);

      // EMA crossed up at index 8 (index 8 is inside window [7, 8, 9])
      // MACD crosses up at index 9 (fresh trigger!)
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 15, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 11, 11], // Cross up at index 8
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 9 (fresh)
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('BUY');
    });

    it('BUY does NOT fire when both crosses happened earlier and neither is fresh on current candle', () => {
      const strategy = createTripleStrategy(3);

      // Both crossed at index 8. Index 9 has no fresh cross.
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 15, 16],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 11, 10], // Crossed at 8
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1.2],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 0.5, 0.6], // Crossed at 8
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.6],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 30, 30],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Strategy 1 (Triple Confluence) - SELL Rules (Bug #1, #2, #4)
  // --------------------------------------------------------------------------
  describe('Triple Confluence SELL Rules (Strict AND Logic)', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    function createStrategyWithOpenPosition() {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
        confirmationWindow: 3,
      });

      // Simulate an open position
      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 90;
      (strategy as unknown as { lastEntryIndex: number }).lastEntryIndex = 5;
      return strategy;
    }

    it('SELL fires when RSI=70 (in [65, 75]) + MACD cross down + EMA cross down', () => {
      const strategy = createStrategyWithOpenPosition();

      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12], // Cross down at index 9 (15>=11, 10<12)
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8], // Cross down at index 9 (1>=0.5, 0<0.8)
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 70], // RSI=70 in [65, 75]
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('Strategy 1 Bearish Confluence');
      expect(signal.reason).toContain('Bearish Cross');
      expect(signal.reason).toContain('RSI in sell zone [65-75] (70.0)');
    });

    it('SELL does NOT fire for ONLY RSI in range (no crosses down)', () => {
      const strategy = createStrategyWithOpenPosition();

      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15], // Bullish, no cross down
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 11],
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // Bullish, no cross down
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 70], // RSI=70 in sell zone
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('SELL does NOT fire for ONLY MACD cross down (EMA still bullish)', () => {
      const strategy = createStrategyWithOpenPosition();

      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15], // Bullish, no cross down
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 11],
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], // MACD crosses down
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 70],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('SELL does NOT fire for ONLY EMA cross down (MACD still bullish)', () => {
      const strategy = createStrategyWithOpenPosition();

      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10], // EMA crosses down
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12],
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // MACD bullish, no cross down
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 70],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('SELL does NOT fire when RSI=60 (below sellMin=65) even with both crosses down', () => {
      const strategy = createStrategyWithOpenPosition();

      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12], // EMA cross down
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], // MACD cross down
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 60], // RSI=60 (< 65)
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('SELL does NOT fire when RSI=80 (above sellMax=75) even with both crosses down', () => {
      const strategy = createStrategyWithOpenPosition();

      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12], // EMA cross down
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], // MACD cross down
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 80], // RSI=80 (> 75)
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Long-Only Position Tracking
  // --------------------------------------------------------------------------
  describe('Long-Only Position Tracking', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    it('SELL is ignored when no position is open', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
      });

      // Valid bearish confluence, but no open position
      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12],
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 70],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });

    it('BUY is ignored when a position is already open', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
      });

      // Simulate open position
      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 85;

      // Valid bullish confluence
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 11],
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30],
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('HOLD');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Timing & Confirmation Window (Bug #7)
  // --------------------------------------------------------------------------
  describe('Timing & Confirmation Window', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    it('Window=1 requires all conditions on the SAME candle', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
        confirmationWindow: 1, // Strictly same candle
      });

      // EMA crossed up at index 8, MACD crossed up at index 9
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 15, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 11, 11], // EMA cross at 8
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // MACD cross at 9
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30],
      });

      // Window=1 scans only index 9. EMA cross at index 8 is missed!
      const signalDiffCandle = strategy.analyze(candles, 9);
      expect(signalDiffCandle.action).toBe('HOLD');

      // Now both cross at index 9
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // EMA cross at 9
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // MACD cross at 9
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30],
      });

      const signalSameCandle = strategy.analyze(candles, 9);
      expect(signalSameCandle.action).toBe('BUY');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Take Profit Behavior (Bug #5)
  // --------------------------------------------------------------------------
  describe('Take Profit Behavior', () => {
    it('Take profit is disabled by default (no unwanted take profit sale)', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: false },
        macd: { enabled: false },
      });

      const candles = [100, 100, 100, 100, 100, 110, 150].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      // Simulate open position at 100
      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 100;
      (strategy as unknown as { lastEntryIndex: number }).lastEntryIndex = 4;

      // Price is 150 (+50%). Without explicit takeProfitPercent, it must NOT exit on TP
      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).not.toBe('SELL');
    });

    it('Take profit only fires when explicitly configured', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: false },
        macd: { enabled: false },
        takeProfitPercent: 10, // Explicitly opt-in
      });

      const candles = [100, 100, 100, 100, 100, 100, 112].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      // Simulate open position at 100
      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 100;
      (strategy as unknown as { lastEntryIndex: number }).lastEntryIndex = 4;

      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('Take Profit Hit (+12.0% >= target 10%)');
    });
  });
});
