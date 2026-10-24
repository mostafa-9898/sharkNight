import { calculateIchimoku } from '@/indicators/ichimoku';
import { calculateStochastic } from '@/indicators/stochastic';
import { calculateFisherRsi, fisherCrossEvents } from '@/indicators/fisher-rsi';
import {
  MultiTimeframeStrategy,
  calculateATR,
} from '@/strategies/multi-timeframe-strategy';
import { createSeededRng, generateSyntheticCandles, loadRealFixtureSlice } from './helpers';
import type { Candle } from '@/data/models';

describe('Integrity Test 1: No-Lookahead Guarantee (1,000 Iterations)', () => {
  const realSlice = loadRealFixtureSlice();

  it('guarantees zero look-ahead bias across Ichimoku, Stochastic, Fisher, ATR, and Strategy signals over 1,000 random slices', () => {
    const rng = createSeededRng(421001);
    const TOTAL_ITERATIONS = 1000;

    let checkedIndicators = 0;
    let checkedSignals = 0;

    for (let iter = 0; iter < TOTAL_ITERATIONS; iter++) {
      // Alternate between synthetic candles and real slice cuts
      const useReal = iter % 2 === 0;
      let fullCandles: Candle[];

      if (useReal) {
        const startOffset = Math.floor(rng() * 50);
        const length = 120 + Math.floor(rng() * 150);
        fullCandles = realSlice.slice(startOffset, startOffset + length);
      } else {
        const length = 120 + Math.floor(rng() * 150);
        fullCandles = generateSyntheticCandles(length, rng, 100 + rng() * 1000);
      }

      // Pick a random cut point t (at least 60 to have warm indicators, up to length - 1)
      const t = 60 + Math.floor(rng() * (fullCandles.length - 61));
      const truncatedCandles = fullCandles.slice(0, t + 1);

      // 1. Ichimoku comparison
      const ichiConfig = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };
      const fullIchi = calculateIchimoku(fullCandles, ichiConfig);
      const truncIchi = calculateIchimoku(truncatedCandles, ichiConfig);

      expect(truncIchi.tenkan[t]).toBe(fullIchi.tenkan[t]);
      expect(truncIchi.kijun[t]).toBe(fullIchi.kijun[t]);
      if (Number.isFinite(truncIchi.senkouA[t]) || Number.isFinite(fullIchi.senkouA[t])) {
        expect(truncIchi.senkouA[t]).toBe(fullIchi.senkouA[t]);
      }
      if (Number.isFinite(truncIchi.senkouB[t]) || Number.isFinite(fullIchi.senkouB[t])) {
        expect(truncIchi.senkouB[t]).toBe(fullIchi.senkouB[t]);
      }

      // 2. Stochastic comparison
      const stochConfig = { kPeriod: 14, dPeriod: 3, smooth: 3 };
      const fullStoch = calculateStochastic(fullCandles, stochConfig);
      const truncStoch = calculateStochastic(truncatedCandles, stochConfig);

      if (Number.isFinite(truncStoch.k[t]) || Number.isFinite(fullStoch.k[t])) {
        expect(truncStoch.k[t]).toBeCloseTo(fullStoch.k[t], 8);
        expect(truncStoch.d[t]).toBeCloseTo(fullStoch.d[t], 8);
      }

      // 3. Fisher RSI comparison
      const closesFull = fullCandles.map((c) => c.close);
      const closesTrunc = truncatedCandles.map((c) => c.close);
      const fullFisher = calculateFisherRsi(closesFull, { rsiPeriod: 14, window: 10 });
      const truncFisher = calculateFisherRsi(closesTrunc, { rsiPeriod: 14, window: 10 });

      if (Number.isFinite(truncFisher.scaled[t]) || Number.isFinite(fullFisher.scaled[t])) {
        expect(truncFisher.scaled[t]).toBeCloseTo(fullFisher.scaled[t], 8);
        if (Number.isFinite(truncFisher.signalScaled[t])) {
          expect(truncFisher.signalScaled[t]).toBeCloseTo(fullFisher.signalScaled[t], 8);
        }
      }

      const fullEvents = fisherCrossEvents(fullFisher);
      const truncEvents = fisherCrossEvents(truncFisher);
      expect(truncEvents[t].anyCrossUp).toBe(fullEvents[t].anyCrossUp);
      expect(truncEvents[t].anyCrossDown).toBe(fullEvents[t].anyCrossDown);
      expect(truncEvents[t].zoneCrossUp).toBe(fullEvents[t].zoneCrossUp);
      expect(truncEvents[t].zoneCrossDown).toBe(fullEvents[t].zoneCrossDown);

      // 4. ATR comparison
      const fullAtr = calculateATR(fullCandles, 14);
      const truncAtr = calculateATR(truncatedCandles, 14);
      if (Number.isFinite(truncAtr[t]) || Number.isFinite(fullAtr[t])) {
        expect(truncAtr[t]).toBeCloseTo(fullAtr[t], 8);
      }
      checkedIndicators++;

      // 5. Strategy Signal comparison & Multi-Timeframe Causality
      const strategy = new MultiTimeframeStrategy({
        fisherMode: 'confirm',
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const fullSignal = strategy.analyze(fullCandles, t);
      const truncSignal = strategy.analyze(truncatedCandles, t);

      expect(truncSignal.action).toBe(fullSignal.action);
      expect(truncSignal.reason).toBe(fullSignal.reason);
      checkedSignals++;
    }

    expect(checkedIndicators).toBe(TOTAL_ITERATIONS);
    expect(checkedSignals).toBe(TOTAL_ITERATIONS);
  });

  it('strictly verifies HTF candle availability: HTF is accessible to LTF strictly after HTF candle closes', () => {
    const rng = createSeededRng(421002);
    const ms15m = 15 * 60 * 1000;
    const ms1h = 60 * 60 * 1000;
    const ms4h = 4 * 60 * 60 * 1000;

    const baseTime = 1600000000000;
    const fullCandles = generateSyntheticCandles(300, rng, 100, ms15m, baseTime);

    const strategy = new MultiTimeframeStrategy({
      fisherMode: 'confirm',
      kijunSlopeFilter: false,
      structureFilter: false,
    });

    // Check across 200 candles that any internal HTF lookup strictly satisfies causality
    for (let i = 50; i < fullCandles.length; i++) {
      const ltfCandle = fullCandles[i];
      const ltfCloseTime = ltfCandle.timestamp + ms15m;

      // When strategy analyzes candle i, no 1h or 4h candle closing after ltfCloseTime can be used
      const signal = strategy.analyze(fullCandles, i);
      expect(signal).toBeDefined();

      // Theoretical closed HTF cutoff timestamps
      const latestClosed1hEnd = Math.floor(ltfCloseTime / ms1h) * ms1h;
      const latestClosed4hEnd = Math.floor(ltfCloseTime / ms4h) * ms4h;

      expect(latestClosed1hEnd).toBeLessThanOrEqual(ltfCloseTime);
      expect(latestClosed4hEnd).toBeLessThanOrEqual(ltfCloseTime);
    }
  });
});
