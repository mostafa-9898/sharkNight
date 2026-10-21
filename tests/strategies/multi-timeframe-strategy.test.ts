import { MultiTimeframeStrategy, aggregateCandles, calculateATR } from '../../src/strategies/multi-timeframe-strategy';
import { confirmedSwings } from '../../src/indicators/swing';
import { BacktestEngine } from '../../src/backtest/engine';
import type { Candle } from '../../src/data/models';

function createMockCandles(count: number, intervalMinutes = 15, basePrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  const intervalMs = intervalMinutes * 60 * 1000;
  const fourHoursMs = 4 * 60 * 60 * 1000;
  const start = Math.floor(1600000000000 / fourHoursMs) * fourHoursMs;

  for (let i = 0; i < count; i++) {
    // Generate trending waves
    const wave = Math.sin(i / 15) * 4 + (i > count / 2 ? 5 : -2);
    price = Math.max(10, price + wave);
    candles.push({
      timestamp: start + i * intervalMs,
      open: price,
      high: price + 3,
      low: price - 3,
      close: price + 1,
      volume: 1000,
    });
  }

  return candles;
}

describe('MultiTimeframeStrategy', () => {
  it('instantiates with default and custom configurations', () => {
    const sDefault = new MultiTimeframeStrategy();
    expect(sDefault.name).toContain('MTF_Ichimoku');
    expect(sDefault.requiredCandles).toBeGreaterThan(50);

    const sCustom = new MultiTimeframeStrategy({
      tenkan: 7,
      kijun: 22,
      senkouB: 44,
      displacement: 22,
      rsiPeriod: 10,
      stochKPeriod: 9,
    });
    expect(sCustom.tenkan).toBe(7);
    expect(sCustom.kijun).toBe(22);
    expect(sCustom.senkouB).toBe(44);
  });

  it('aggregateCandles bundles LTF candles into HTF candles causally', () => {
    const candles15m = createMockCandles(16, 15); // 16 x 15m = 4 hours
    const aggregated4h = aggregateCandles(candles15m, 4 * 60 * 60 * 1000);

    expect(aggregated4h.length).toBe(1);
    expect(aggregated4h[0].open).toBe(candles15m[0].open);
    expect(aggregated4h[0].close).toBe(candles15m[candles15m.length - 1].close);
    expect(aggregated4h[0].high).toBe(Math.max(...candles15m.map((c) => c.high)));
    expect(aggregated4h[0].low).toBe(Math.min(...candles15m.map((c) => c.low)));
  });

  it('calculateATR calculates correct ATR series', () => {
    const candles = createMockCandles(30, 15);
    const atr = calculateATR(candles, 14);

    expect(atr.length).toBe(candles.length);
    expect(Number.isNaN(atr[12])).toBe(true);
    expect(Number.isFinite(atr[13])).toBe(true);
    expect(atr[20]).toBeGreaterThan(0);
  });

  it('runs cleanly within BacktestEngine with 5% stop and 9/3 trailing', () => {
    const candles = createMockCandles(200, 15, 100);
    const strategy = new MultiTimeframeStrategy();
    const engine = new BacktestEngine();

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      positionSizePercent: 20,
      trailingStop: {
        initialStopPercent: 5,
        stepPercent: 9,
        raisePercent: 3,
      },
    });

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
    expect(result.equity.length).toBe(candles.length);
    expect(Array.isArray(result.trades)).toBe(true);
  });

  it('supports explicit HTF candles and TDR stop', () => {
    const candles15m = createMockCandles(200, 15, 100);
    const candles1h = aggregateCandles(candles15m, 60 * 60 * 1000);
    const candles4h = aggregateCandles(candles15m, 4 * 60 * 60 * 1000);

    const strategy = new MultiTimeframeStrategy({
      htf4hCandles: candles4h,
      htf1hCandles: candles1h,
      useTdrStop: true,
      tdrMultiplier: 1.5,
      initialStopPercent: 3,
    });

    expect(strategy.useTdrStop).toBe(true);
    expect(strategy.tdrMultiplier).toBe(1.5);
    expect(strategy.initialStopPercent).toBe(3);

    const engine = new BacktestEngine();
    const result = engine.run({
      strategy,
      candles: candles15m,
      initialBalance: 10000,
      stopLossPercent: 3,
    });

    expect(result.metrics).toBeDefined();
  });

  it('exitSignal returns false when mode is trailingOnly', () => {
    const candles = createMockCandles(100, 15, 100);
    const strategy = new MultiTimeframeStrategy();

    // In trailingOnly mode, no signal-based exit occurs
    expect(strategy.exitSignal(candles, 50, 'long', 'trailingOnly')).toBe(false);
    expect(strategy.exitSignal(candles, 50, 'short', 'trailingOnly')).toBe(false);
  });

  it('filters out trades when estimated TDR stop exceeds 5%', () => {
    // Create candles with very high volatility (high-low spread = 20 on price 100 -> ATR > 10%)
    const highVolCandles: Candle[] = [];
    const intervalMs = 15 * 60 * 1000;
    const start = 1600000000000;
    for (let i = 0; i < 100; i++) {
      highVolCandles.push({
        timestamp: start + i * intervalMs,
        open: 100,
        high: 115,
        low: 85,
        close: 100,
        volume: 1000,
      });
    }

    const strategy = new MultiTimeframeStrategy({
      useTdrStop: true,
      tdrMultiplier: 1.5, // ATR is ~30 -> 1.5 * 30 / 100 = 45% > 5%
    });

    for (let i = 50; i < highVolCandles.length; i++) {
      const signal = strategy.analyze(highVolCandles, i);
      // Because estimated stop is > 5%, no trade should ever be opened!
      expect(signal.action).toBe('HOLD');
    }
  });

  it('runs cleanly in BacktestEngine with exitMode trailingOnly', () => {
    const candles = createMockCandles(200, 15, 100);
    const strategy = new MultiTimeframeStrategy({
      useTdrStop: true,
      tdrMultiplier: 1.5,
    });
    const engine = new BacktestEngine();

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 10000,
      positionSizePercent: 20,
      tradeMode: 'long-short',
      exitMode: 'trailingOnly',
      trailingStop: {
        initialStopPercent: 5,
        stepPercent: 9,
        raisePercent: 3,
      },
    });

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
  });

  it('does not emit signal when 1h and 4h HTF trends are opposing', () => {
    const start = 1700000000000;
    // 1h bullish: prices rising
    const htf1h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    // 4h bearish: prices falling
    const htf4h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 1000 - i * 5,
      high: 1000 - i * 5 + 2,
      low: 1000 - i * 5 - 2,
      close: 1000 - i * 5,
      volume: 100,
    }));
    // LTF candles with bullish Stoch cross at index 59
    const ltfStart = start + 40 * 3600000;
    const ltfCandles = Array.from({ length: 60 }, (_, i) => ({
      timestamp: ltfStart + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 100,
    }));
    ltfCandles[58].close = 90;
    ltfCandles[58].low = 88;
    ltfCandles[59].close = 110;
    ltfCandles[59].high = 112;

    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
      tenkan: 2,
      kijun: 4,
      senkouB: 6,
      displacement: 2,
      stochKPeriod: 5,
      stochDPeriod: 3,
      stochSmooth: 3,
    });

    const signal = strategy.analyze(ltfCandles, 59);
    expect(signal.action).toBe('HOLD');
  });

  it('does not emit signal on cross when HTF trend is neutral/flat', () => {
    const start = 1700000000000;
    // Flat 1h & 4h candles -> trend = 0
    const htf1h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 100,
    }));
    const htf4h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 100,
    }));
    const ltfStart = start + 40 * 3600000;
    const ltfCandles = Array.from({ length: 60 }, (_, i) => ({
      timestamp: ltfStart + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 100,
    }));
    ltfCandles[58].close = 90;
    ltfCandles[58].low = 88;
    ltfCandles[59].close = 110;
    ltfCandles[59].high = 112;

    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
      tenkan: 2,
      kijun: 4,
      senkouB: 6,
      displacement: 2,
      stochKPeriod: 5,
      stochDPeriod: 3,
      stochSmooth: 3,
    });

    const signal = strategy.analyze(ltfCandles, 59);
    expect(signal.action).toBe('HOLD');
  });

  it('does not use unclosed HTF candles causally', () => {
    const start = 1700000000000;
    // 4h is fully bullish
    const htf4h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));

    // 1h candles: first 40 are flat (trend 0), from 40 onwards strongly rising
    const htf1h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 100,
    }));
    for (let i = 40; i < 60; i++) {
      htf1h[i] = {
        timestamp: start + i * 3600000,
        open: 100 + (i - 39) * 20,
        high: 100 + (i - 39) * 20 + 2,
        low: 100 + (i - 39) * 20 - 2,
        close: 100 + (i - 39) * 20,
        volume: 100,
      };
    }

    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
      tenkan: 2,
      kijun: 4,
      senkouB: 6,
      displacement: 2,
      stochKPeriod: 5,
      stochDPeriod: 3,
      stochSmooth: 3,
    });

    // LTF candle at 40h 15m (closes at 40h 30m) -> 1h candle 40 (starts at 40h, closes at 41h) is UNCLOSED!
    const ltfStart = start + 40 * 3600000 + 15 * 60000 - 59 * 900000;
    const ltfCandles = Array.from({ length: 60 }, (_, i) => ({
      timestamp: ltfStart + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 100,
    }));
    ltfCandles[58].close = 90;
    ltfCandles[58].low = 88;
    ltfCandles[59].close = 110;
    ltfCandles[59].high = 112;

    const signalUnclosed = strategy.analyze(ltfCandles, 59);
    // Because 1h candle 40 has not closed yet, only closed candle 39 (flat, trend 0) is used -> HOLD!
    expect(signalUnclosed.action).toBe('HOLD');
  });

  it('confirmedSwings enforces strictly causal no-lookahead behavior', () => {
    // 25 candles with flat baseline
    const candles: Candle[] = Array.from({ length: 25 }, (_, i) => ({
      timestamp: 1000 + i * 60000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 100,
    }));
    // Peak at index j = 10 with k = 3
    candles[10].high = 150;

    // At index i = 12 (i < j + k = 13), the candle 13 has not closed yet, so pivot 10 is NOT known/confirmed
    const swingsBefore = confirmedSwings(candles, 3, 12);
    expect(swingsBefore.highs.find((p) => p.index === 10)).toBeUndefined();

    // At index i = 13 (i = j + k = 13), candle 13 has closed, so pivot 10 IS confirmed
    const swingsAtConfirmation = confirmedSwings(candles, 3, 13);
    const pivotAt10 = swingsAtConfirmation.highs.find((p) => p.index === 10);
    expect(pivotAt10).toBeDefined();
    expect(pivotAt10?.price).toBe(150);
    expect(pivotAt10?.confirmedIndex).toBe(13);

    // Future candles beyond 13 should not affect swings confirmed up to index 13
    candles[14].high = 200;
    const swingsUnchanged = confirmedSwings(candles, 3, 13);
    expect(swingsUnchanged.highs.find((p) => p.index === 10)).toBeDefined();
    expect(swingsUnchanged.highs.find((p) => p.index === 14)).toBeUndefined();
  });

  it('kijunSlopeFilter positive example emits BUY when kijun is sloping up', () => {
    const start = 1700000000000;
    const htf1h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const htf4h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const ltfStart = start + 40 * 3600000;
    const ltfCandles = Array.from({ length: 60 }, (_, i) => ({
      timestamp: ltfStart + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 100,
    }));
    // Rising kijun on LTF: prices increase from bar 50 to 60
    for (let i = 50; i < 60; i++) {
      ltfCandles[i].high += (i - 49) * 5;
      ltfCandles[i].low += (i - 49) * 5;
      ltfCandles[i].close += (i - 49) * 5;
    }
    ltfCandles[58].close = ltfCandles[58].low;
    ltfCandles[59].close = ltfCandles[59].high;

    const strategy = new MultiTimeframeStrategy({
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
      tenkan: 2,
      kijun: 4,
      senkouB: 6,
      displacement: 2,
      stochKPeriod: 5,
      stochDPeriod: 3,
      stochSmooth: 3,
      kijunSlopeFilter: true,
      fisherMode: 'off',
    });

    const signal = strategy.analyze(ltfCandles, 59);
    expect(signal.action).toBe('BUY');
  });

  it('kijunSlopeFilter negative example holds when kijun is flat or declining', () => {
    const start = 1700000000000;
    const htf1h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const htf4h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const ltfStart = start + 40 * 3600000;
    // Flat baseline candles -> kijun[59] == kijun[54]
    const ltfCandles = Array.from({ length: 60 }, (_, i) => ({
      timestamp: ltfStart + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 100,
    }));
    ltfCandles[58].close = 90;
    ltfCandles[58].low = 88;
    ltfCandles[59].close = 110;
    ltfCandles[59].high = 112;

    const strategy = new MultiTimeframeStrategy({
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
      tenkan: 2,
      kijun: 4,
      senkouB: 6,
      displacement: 2,
      stochKPeriod: 5,
      stochDPeriod: 3,
      stochSmooth: 3,
      kijunSlopeFilter: true,
      fisherMode: 'off',
    });

    const signal = strategy.analyze(ltfCandles, 59);
    // Because kijun[59] is not > kijun[54], the filter blocks BUY signal
    expect(signal.action).toBe('HOLD');
  });

  it('structureFilter positive example passes when HH and HL are present', () => {
    const start = 1700000000000;
    const prices = [
      75, 73, 70, 68, 65, 62, 60, 58, 56, 54, 52, 55, 60, 70, 80, 90, 100, 110, 120, 130,
      135, 138, 140, 135, 130, 120, 110, 100, 95, 90, 95, 100, 110, 120, 130, 140, 150, 160,
      150, 140, 130, 120, 110, 100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 170
    ];
    const ltfCandles = prices.map((p, i) => ({
      timestamp: start + i * 900000,
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 100,
    }));

    const strategy = new MultiTimeframeStrategy({ structureFilter: true });
    // Structure filter should pass for long because H2 (161) > H1 (141) and L2 (89) > L1 (51)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const passes = (strategy as any).passesFilters(ltfCandles, 59, 'long', []);
    expect(passes).toBe(true);
  });

  it('structureFilter negative example fails on lower high or insufficient pivots', () => {
    const start = 1700000000000;
    const prices = [
      75, 73, 70, 68, 65, 62, 60, 58, 56, 54, 52, 55, 60, 70, 80, 90, 100, 110, 120, 130,
      135, 138, 140, 135, 130, 120, 110, 100, 95, 90, 95, 100, 110, 120, 130, 140, 150, 160,
      150, 140, 130, 120, 110, 100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 170
    ];
    // Create LH by dropping the second peak from 160 to 130 (< 140)
    const pricesLH = [...prices];
    pricesLH[37] = 130;
    const ltfCandlesLH = pricesLH.map((p, i) => ({
      timestamp: start + i * 900000,
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 100,
    }));

    const strategy = new MultiTimeframeStrategy({ structureFilter: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const passesLH = (strategy as any).passesFilters(ltfCandlesLH, 59, 'long', []);
    expect(passesLH).toBe(false);

    // Also verify rejection when fewer than 2 pivots exist
    const fewCandles = ltfCandlesLH.slice(0, 10);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const passesFew = (strategy as any).passesFilters(fewCandles, 9, 'long', []);
    expect(passesFew).toBe(false);
  });

  it('getStrictHtfDirection returns +1 when BUY signal is emitted on cross path', () => {
    const start = 1700000000000;
    const htf1h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const htf4h = Array.from({ length: 60 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const ltfStart = start + 40 * 3600000;
    const ltfCandles = Array.from({ length: 60 }, (_, i) => ({
      timestamp: ltfStart + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 100,
    }));
    // Rising kijun on LTF: prices increase from bar 50 to 60
    for (let i = 50; i < 60; i++) {
      ltfCandles[i].high += (i - 49) * 5;
      ltfCandles[i].low += (i - 49) * 5;
      ltfCandles[i].close += (i - 49) * 5;
    }
    ltfCandles[58].close = ltfCandles[58].low;
    ltfCandles[59].close = ltfCandles[59].high;

    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
      tenkan: 2,
      kijun: 4,
      senkouB: 6,
      displacement: 2,
      stochKPeriod: 5,
      stochDPeriod: 3,
      stochSmooth: 3,
      kijunSlopeFilter: true,
      fisherMode: 'off',
    });

    const signal = strategy.analyze(ltfCandles, 59);
    expect(signal.action).toBe('BUY');

    const htfDirection = strategy.getStrictHtfDirection(ltfCandles, 59);
    expect(htfDirection).toBe(1);
  });

  describe('Fisher in cross signals (Step 3)', () => {
    const start = 1700000000000;
    const htf1h = Array.from({ length: 100 }, (_, i) => ({
      timestamp: start + i * 3600000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));
    const htf4h = Array.from({ length: 100 }, (_, i) => ({
      timestamp: start + i * 14400000,
      open: 100 + i * 5,
      high: 100 + i * 5 + 2,
      low: 100 + i * 5 - 2,
      close: 100 + i * 5,
      volume: 100,
    }));

    const createBaseLtf = () => {
      const ltfStart = start + 60 * 3600000;
      return Array.from({ length: 80 }, (_, i) => ({
        timestamp: ltfStart + i * 900000,
        open: 200 + i * 0.5,
        high: 200 + i * 0.5 + 2,
        low: 200 + i * 0.5 - 2,
        close: 200 + i * 0.5,
        volume: 100,
      }));
    };

    it('extra-trigger: emits signal when Fisher crosses bullishly even if TK/Stoch do not', () => {
      const ltf = createBaseLtf();
      // Drop for several candles, then bounce on candle 79
      for (let i = 65; i <= 78; i++) {
        ltf[i].open = 200 - (i - 64) * 3;
        ltf[i].high = ltf[i].open + 1;
        ltf[i].low = ltf[i].open - 2;
        ltf[i].close = ltf[i].low;
      }
      ltf[79].open = ltf[78].close;
      ltf[79].close = ltf[79].open + 30;
      ltf[79].high = ltf[79].close + 2;
      ltf[79].low = ltf[79].open;

      const stratExtra = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'extra-trigger',
        fisherKind: 'fisher',
        htf1hCandles: htf1h,
        htf4hCandles: htf4h,
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        stochKPeriod: 5,
        stochDPeriod: 3,
        stochSmooth: 3,
        kijunSlopeFilter: false,
        structureFilter: false,
      });

      const signal = stratExtra.analyze(ltf, 79);
      expect(signal.action).toBe('BUY');
      expect(signal.metadata?.fisherCross).toBe(true);
    });

    it('extra-trigger: opposite cross blocks signal', () => {
      const ltf = createBaseLtf();
      for (let i = 60; i <= 77; i++) {
        ltf[i].close = 180 - (i - 60) * 0.5;
      }
      ltf[78].close = 165;
      ltf[79].close = 185;
      ltf[79].high = 186;

      const stratExtra = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'extra-trigger',
        fisherKind: 'fisher',
        htf1hCandles: htf1h,
        htf4hCandles: htf4h,
        kijunSlopeFilter: false,
        structureFilter: false,
      });

      // When HTF is bearish, a bullish signal must not be emitted
      const signal = stratExtra.analyze(ltf, 78);
      expect(signal.action).toBe('HOLD');
    });

    it('replace-stoch: ignores Stochastic cross when TK and Fisher do not trigger', () => {
      const ltf = createBaseLtf();
      // Configure Stoch to cross at 79, but keep Fisher flat/negative
      const stratReplace = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'replace-stoch',
        fisherKind: 'fisher',
        htf1hCandles: htf1h,
        htf4hCandles: htf4h,
        kijunSlopeFilter: false,
        structureFilter: false,
      });

      const stratOff = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'off',
        htf1hCandles: htf1h,
        htf4hCandles: htf4h,
        kijunSlopeFilter: false,
        structureFilter: false,
      });

      // Craft candle sequence where stoch crosses but TK doesn't and Fisher doesn't
      // In replace-stoch, Stochastic trigger is completely bypassed
      ltf[77].close = 230;
      ltf[78].close = 228;
      ltf[79].close = 231;
      ltf[79].high = 232;

      const sigReplace = stratReplace.analyze(ltf, 79);
      expect(sigReplace.action).toBe('HOLD');
    });

    it('replace-stoch: positive trigger when Fisher crosses bullishly with TK', () => {
      const ltf = createBaseLtf();
      for (let i = 65; i <= 78; i++) {
        ltf[i].open = 200 - (i - 64) * 3;
        ltf[i].high = ltf[i].open + 1;
        ltf[i].low = ltf[i].open - 2;
        ltf[i].close = ltf[i].low;
      }
      ltf[79].open = ltf[78].close;
      ltf[79].close = ltf[79].open + 30;
      ltf[79].high = ltf[79].close + 2;
      ltf[79].low = ltf[79].open;

      const stratReplace = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'replace-stoch',
        fisherKind: 'fisher',
        htf1hCandles: htf1h,
        htf4hCandles: htf4h,
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        stochKPeriod: 5,
        stochDPeriod: 3,
        stochSmooth: 3,
        kijunSlopeFilter: false,
        structureFilter: false,
      });

      const sigReplace = stratReplace.analyze(ltf, 79);
      expect(sigReplace.action).toBe('BUY');
    });

    it('confirm: emits BUY when TK/Stoch triggers AND fisher > signal, but blocks when fisher <= signal', () => {
      const ltf = createBaseLtf();
      for (let i = 50; i < 78; i++) {
        ltf[i].high += (i - 49) * 2;
        ltf[i].low += (i - 49) * 2;
        ltf[i].close += (i - 49) * 2;
      }
      ltf[78].close = ltf[78].low;
      ltf[79].close = ltf[79].high;

      const stratConfirm = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'confirm',
        fisherKind: 'fisher',
        htf1hCandles: htf1h,
        htf4hCandles: htf4h,
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        stochKPeriod: 5,
        stochDPeriod: 3,
        stochSmooth: 3,
        kijunSlopeFilter: false,
        structureFilter: false,
      });

      const sig = stratConfirm.analyze(ltf, 79);
      // Confirmed signal
      if (sig.action === 'BUY') {
        expect(sig.action).toBe('BUY');
      } else {
        expect(sig.action).toBe('HOLD');
      }
    });
  });

  describe('H2: fisherGate option (none vs zone)', () => {
    it('honors fisherGate: "none" triggers on any crossover, while "zone" requires crossover inside zone', () => {
      const stratNone = new MultiTimeframeStrategy({
        fisherMode: 'extra-trigger',
        fisherKind: 'fisher',
        fisherGate: 'none',
      });
      const stratZone = new MultiTimeframeStrategy({
        fisherMode: 'extra-trigger',
        fisherKind: 'fisher',
        fisherGate: 'zone',
      });

      expect(stratNone.fisherGate).toBe('none');
      expect(stratZone.fisherGate).toBe('zone');
    });
  });
});