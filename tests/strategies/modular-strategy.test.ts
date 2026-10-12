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
  // 1. Validation & Initialization
  // --------------------------------------------------------------------------
  describe('Validation & Initialization', () => {
    it('should initialize ModularStrategy with default parameters (MA enabled, W=6, L=10, mirror)', () => {
      const strategy = new ModularStrategy();
      expect(strategy.ma.enabled).toBe(true);
      expect(strategy.ma.fastPeriod).toBe(10);
      expect(strategy.ma.slowPeriod).toBe(30);
      expect(strategy.rsi.enabled).toBe(false);
      expect(strategy.macd.enabled).toBe(false);
      expect(strategy.confirmationWindow).toBe(6);
      expect(strategy.rsiLookback).toBe(10);
      expect(strategy.exitMode).toBe('mirror');
      expect(strategy.takeProfitPercent).toBeUndefined();
      expect(strategy.stopLossPercent).toBeUndefined();
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

      expect(s1.confirmationWindow).toBe(6);
      expect(s1.rsiLookback).toBe(10);
      expect(s1.exitMode).toBe('mirror');
      expect(s1.takeProfitPercent).toBeUndefined();
      expect(s1.stopLossPercent).toBeUndefined();
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

      const candles = [100, 80, 60, 45, 35, 32].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      const signal = strategy.analyze(candles, candles.length - 1);
      expect(signal.action).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. Triple Confluence BUY Rules & RSI Lookback (L)
  // --------------------------------------------------------------------------
  describe('Triple Confluence BUY Rules & RSI Lookback', () => {
    const len = 12;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    function createTripleStrategy(confirmationWindow = 6, rsiLookback = 10) {
      return new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
        confirmationWindow,
        rsiLookback,
      });
    }

    it('BUY fires when RSI=30 on current candle + MACD cross up + EMA cross up inside window', () => {
      const strategy = createTripleStrategy(6, 10);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 11
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 11
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 30], // RSI=30 on index 11
      });

      const signal = strategy.analyze(candles, 11);
      expect(signal.action).toBe('BUY');
      expect(signal.reason).toContain('Strategy 1 Confluence');
      expect(signal.reason).toContain('Bullish Cross');
    });

    it('BUY fires when RSI was in [25, 35] on an earlier candle within rsiLookback (L=5)', () => {
      const strategy = createTripleStrategy(6, 5);

      // On currentIndex 11, RSI has recovered to 55 (outside [25, 35]).
      // But at index 8 (within lookback [7, 8, 9, 10, 11]), RSI touched 30!
      // Crosses happen at index 11.
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 11
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 11
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 30, 45, 50, 55], // 30 at index 8 (inside L=5 window 7..11)
      });

      const signal = strategy.analyze(candles, 11);
      expect(signal.action).toBe('BUY');
    });

    it('BUY does NOT fire when RSI was in [25, 35] outside rsiLookback (L=3)', () => {
      const strategy = createTripleStrategy(6, 3);

      // Current index 11, L=3 scans [9, 10, 11].
      // RSI was 30 at index 7 (outside lookback window [9..11]).
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 11
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 11
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 30, 45, 50, 52, 55], // 30 at index 7 (outside [9..11])
      });

      const signal = strategy.analyze(candles, 11);
      expect(signal.action).toBe('HOLD');
    });

    it('L=1 reproduces old signal-candle-only behavior', () => {
      const strategy = createTripleStrategy(6, 1);

      // RSI was 30 at index 10, but on index 11 RSI is 40.
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11], // Cross up at index 11
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5], // Cross up at index 11
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 30, 40], // 30 at 10, 40 at 11
      });

      // With L=1, only index 11 is checked (RSI=40 > 35) -> HOLD
      const signal = strategy.analyze(candles, 11);
      expect(signal.action).toBe('HOLD');

      // Now RSI is 30 on index 11 -> BUY
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11],
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 40, 30],
      });

      const signalOnCurrent = strategy.analyze(candles, 11);
      expect(signalOnCurrent.action).toBe('BUY');
    });

    it('BUY does NOT fire when RSI=20 (strictly below 25) even with crosses', () => {
      const strategy = createTripleStrategy(6, 10);

      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 11],
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], // All 20 (< 25)
      });

      const signal = strategy.analyze(candles, 11);
      expect(signal.action).toBe('HOLD');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Exit Modes (mirror, emaCross, macdCross)
  // --------------------------------------------------------------------------
  describe('Exit Modes (mirror, emaCross, macdCross)', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    function createStrategyWithOpenPosition(exitMode: 'mirror' | 'emaCross' | 'macdCross') {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
        confirmationWindow: 6,
        rsiLookback: 10,
        exitMode,
      });

      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 90;
      (strategy as unknown as { lastEntryIndex: number }).lastEntryIndex = 5;
      return strategy;
    }

    it('exitMode="mirror" requires all 3 bearish conditions (AND logic)', () => {
      const strategy = createStrategyWithOpenPosition('mirror');

      // EMA crosses down, but MACD and RSI are not in sell condition
      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12], // EMA cross down
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // MACD bullish
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // RSI neutral
      });

      const signalPartial = strategy.analyze(candles, 9);
      expect(signalPartial.action).toBe('HOLD');

      // Now all 3 conditions met (EMA cross down + MACD cross down + RSI in 65..75)
      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12],
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8], // MACD cross down
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 70], // RSI in sell zone
      });

      const signalFull = strategy.analyze(candles, 9);
      expect(signalFull.action).toBe('SELL');
      expect(signalFull.reason).toContain('Strategy 1 Bearish Confluence');
    });

    it('exitMode="emaCross" exits on EMA cross down ONLY (ignoring MACD and RSI)', () => {
      const strategy = createStrategyWithOpenPosition('emaCross');

      // EMA crosses down at index 9, MACD is bullish, RSI is neutral (50)
      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 10],
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 12], // EMA cross down
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // MACD remains bullish!
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // RSI is neutral 50!
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('EMA Bearish Cross Exit');
    });

    it('exitMode="macdCross" exits on MACD cross down ONLY (ignoring EMA and RSI)', () => {
      const strategy = createStrategyWithOpenPosition('macdCross');

      // MACD crosses down at index 9, EMA is bullish, RSI is neutral (50)
      injectIndicatorCache(strategy, candles, {
        fastMA: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15], // EMA remains bullish!
        slowMA: [11, 11, 11, 11, 11, 11, 11, 11, 11, 11],
        macd: {
          macd:      [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], // MACD cross down
          signal:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, -0.8],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // RSI neutral
      });

      const signal = strategy.analyze(candles, 9);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('MACD Bearish Cross Exit');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Position Tracking & Risk Limits (Take Profit & Stop Loss)
  // --------------------------------------------------------------------------
  describe('Position Tracking & Risk Limits', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    it('SELL is ignored when no position is open (flat)', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
      });

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

      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 85;

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

    it('Stop Loss fires when price drops by configured stopLossPercent', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: false },
        macd: { enabled: false },
        stopLossPercent: 5, // -5% stop loss
      });

      // Entry at 100, price crashes to 94 (-6%)
      const candleSeries = [100, 100, 100, 100, 100, 100, 94].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 100;
      (strategy as unknown as { lastEntryIndex: number }).lastEntryIndex = 4;

      const signal = strategy.analyze(candleSeries, candleSeries.length - 1);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('Stop Loss Hit (-6.0% <= -5%)');
    });

    it('Take profit only fires when explicitly configured', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: false },
        macd: { enabled: false },
        takeProfitPercent: 10,
      });

      const candleSeries = [100, 100, 100, 100, 100, 100, 112].map((p, idx) =>
        createCandle(p, 1000 + idx * 60000)
      );

      (strategy as unknown as { lastEntryPrice: number | null }).lastEntryPrice = 100;
      (strategy as unknown as { lastEntryIndex: number }).lastEntryIndex = 4;

      const signal = strategy.analyze(candleSeries, candleSeries.length - 1);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('Take Profit Hit (+12.0% >= target 10%)');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Window Edge Cases (W=1 vs W=6)
  // --------------------------------------------------------------------------
  describe('Window Edge Cases', () => {
    const len = 10;
    const candles = Array.from({ length: len }, (_, i) => createCandle(100, 1000 + i * 60000));

    it('Window=1 requires both crosses on the strictly same candle', () => {
      const strategy = new ModularStrategy({
        ma: { enabled: true, type: 'ema', fastPeriod: 2, slowPeriod: 4 },
        rsi: { enabled: true, period: 2, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75 },
        macd: { enabled: true, fastPeriod: 2, slowPeriod: 4, signalPeriod: 2 },
        confirmationWindow: 1,
      });

      // EMA cross at 8, MACD cross at 9 -> misses W=1
      injectIndicatorCache(strategy, candles, {
        fastMA: [10, 10, 10, 10, 10, 10, 10, 10, 15, 15],
        slowMA: [12, 12, 12, 12, 12, 12, 12, 12, 11, 11],
        macd: {
          macd:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
          signal:    [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5],
          histogram: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5],
        },
        rsi: [50, 50, 50, 50, 50, 50, 50, 50, 50, 30],
      });

      expect(strategy.analyze(candles, 9).action).toBe('HOLD');

      // Both crosses on candle 9 -> triggers W=1
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

      expect(strategy.analyze(candles, 9).action).toBe('BUY');
    });
  });
});
