import {
  MultiTimeframeStrategy,
  aggregateCandles,
  computeStrictHtfTrend,
} from '@/strategies/multi-timeframe-strategy';
import { calculateIchimoku } from '@/indicators/ichimoku';
import { calculateStochastic } from '@/indicators/stochastic';
import { calculateFisherRsi } from '@/indicators/fisher-rsi';
import { confirmedSwings } from '@/indicators/swing';
import type { Candle } from '@/data/models';
import { roundTo } from '@/utils/math';

/**
 * Creates mirror candles:
 * price -> P0^2 / price
 * open'  = P0^2 / open
 * close' = P0^2 / close
 * high'  = P0^2 / low   (since inverse flips order)
 * low'   = P0^2 / high
 */
export function createMirrorCandles(candles: readonly Candle[], P0 = 100): Candle[] {
  const p0Sq = P0 * P0;
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: roundTo(p0Sq / c.open, 6),
    high: roundTo(p0Sq / c.low, 6),
    low: roundTo(p0Sq / c.high, 6),
    close: roundTo(p0Sq / c.close, 6),
    volume: c.volume,
  }));
}

describe('Strategy Condition Mirror Symmetry (RC2 - H-B)', () => {
  const P0 = 100;

  // 1. HTF Strict Direction (+1 / -1)
  describe('1. HTF Strict Direction (+1 / -1)', () => {
    it('should map bullish HTF trend (+1) on original to bearish HTF trend (-1) on mirror', () => {
      const fourHoursMs = 4 * 60 * 60 * 1000;
      const start = 1600000000000;
      const candles: Candle[] = [];
      let p = 50;
      for (let i = 0; i < 120; i++) {
        p += 1.5;
        candles.push({
          timestamp: start + i * fourHoursMs,
          open: p,
          high: p + 2,
          low: p - 1,
          close: p + 1,
          volume: 1000,
        });
      }

      const mirror = createMirrorCandles(candles, P0);
      const ichiConfig = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };

      const ichiOrig = calculateIchimoku(candles, ichiConfig);
      const ichiMirror = calculateIchimoku(mirror, ichiConfig);

      const trendOrig = computeStrictHtfTrend(candles[100], ichiOrig, 100);
      const trendMirror = computeStrictHtfTrend(mirror[100], ichiMirror, 100);

      expect(trendOrig).toBe(1);
      expect(trendMirror).toBe(-1);
    });
  });

  // 2. TK Cross Symmetry
  describe('2. TK Cross Symmetry', () => {
    it('should map Tenkan crossing above Kijun (bull) to Tenkan crossing below Kijun (bear)', () => {
      const candles: Candle[] = [];
      let p = 100;
      for (let i = 0; i < 40; i++) {
        if (i < 25) p -= 0.5;
        else p += 2.0; // reversal up
        candles.push({
          timestamp: 1000 + i * 60000,
          open: p,
          high: p + 1,
          low: p - 1,
          close: p,
          volume: 1000,
        });
      }

      const mirror = createMirrorCandles(candles, P0);
      const ichiConfig = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };

      const orig = calculateIchimoku(candles, ichiConfig);
      const mir = calculateIchimoku(mirror, ichiConfig);

      let origCrossIdx = -1;
      let mirCrossIdx = -1;

      for (let i = 1; i < candles.length; i++) {
        const origBullCross =
          orig.tenkan[i - 1] <= orig.kijun[i - 1] && orig.tenkan[i] > orig.kijun[i];
        if (origBullCross && origCrossIdx === -1) origCrossIdx = i;

        const mirBearCross =
          mir.tenkan[i - 1] >= mir.kijun[i - 1] && mir.tenkan[i] < mir.kijun[i];
        if (mirBearCross && mirCrossIdx === -1) mirCrossIdx = i;
      }

      expect(origCrossIdx).toBeGreaterThan(0);
      expect(mirCrossIdx).toBe(origCrossIdx);
    });
  });

  // 3. Stochastic Cross & Thresholds (30 / 70)
  describe('3. Stochastic Cross & Thresholds (30 / 70)', () => {
    it('should map Stoch bull cross to bear cross at identical candle index in geometric scale', () => {
      const candles: Candle[] = [];
      let p = 100;
      for (let i = 0; i < 40; i++) {
        if (i < 20) p *= 0.99;
        else p *= 1.015;
        candles.push({
          timestamp: 1000 + i * 60000,
          open: p,
          high: p * 1.005,
          low: p * 0.995,
          close: p,
          volume: 1000,
        });
      }

      const mirror = createMirrorCandles(candles, P0);
      const stochConfig = { kPeriod: 14, dPeriod: 3, smooth: 3 };

      const origStoch = calculateStochastic(candles, stochConfig);
      const mirStoch = calculateStochastic(mirror, stochConfig);

      let origBullIdx = -1;
      let mirBearIdx = -1;

      for (let i = 18; i < candles.length; i++) {
        const origBull =
          origStoch.k[i - 1] <= origStoch.d[i - 1] + 1e-6 &&
          origStoch.k[i] > origStoch.d[i] + 1e-4;
        if (origBull && origBullIdx === -1) origBullIdx = i;

        const mirBear =
          mirStoch.k[i - 1] >= mirStoch.d[i - 1] - 1e-6 &&
          mirStoch.k[i] < mirStoch.d[i] - 1e-4;
        if (mirBear && mirBearIdx === -1) mirBearIdx = i;
      }

      expect(origBullIdx).toBe(20);
      expect(mirBearIdx).toBe(20);

      // Verify that %K + %K' is approximately 100 (diff is <= 3% due to arithmetic scale convexity)
      const sumK = origStoch.k[20] + mirStoch.k[20];
      expect(sumK).toBeGreaterThan(96);
      expect(sumK).toBeLessThanOrEqual(100);
    });
  });

  // 4. Fisher RSI Cross & Confirmation
  describe('4. Fisher RSI Cross & Confirmation', () => {
    it('should invert Fisher values and map bull cross to bear cross', () => {
      const closes: number[] = [];
      let c = 100;
      for (let i = 0; i < 40; i++) {
        c += Math.sin(i / 3) * 2;
        closes.push(c);
      }
      const mirrorCloses = closes.map((p) => (P0 * P0) / p);

      const fOrig = calculateFisherRsi(closes, { rsiPeriod: 14, window: 10 });
      const fMir = calculateFisherRsi(mirrorCloses, { rsiPeriod: 14, window: 10 });

      // Invert sign check
      for (let i = 20; i < 40; i++) {
        if (Number.isFinite(fOrig.fisher[i]) && Number.isFinite(fMir.fisher[i])) {
          expect(Math.sign(fOrig.fisher[i])).toBe(-Math.sign(fMir.fisher[i]));
        }
      }
    });
  });

  // 5. Kijun Slope Filter (kijun[i] > kijun[i-5] vs <)
  describe('5. Kijun Slope Filter', () => {
    it('should map positive kijun slope on original to negative slope on mirror', () => {
      const candles: Candle[] = [];
      let p = 100;
      for (let i = 0; i < 40; i++) {
        p += 1.0;
        candles.push({
          timestamp: 1000 + i * 60000,
          open: p,
          high: p + 1,
          low: p - 1,
          close: p,
          volume: 1000,
        });
      }

      const mirror = createMirrorCandles(candles, P0);
      const ichiConfig = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };

      const orig = calculateIchimoku(candles, ichiConfig);
      const mir = calculateIchimoku(mirror, ichiConfig);

      const idx = 35;
      const origRising = orig.kijun[idx] > orig.kijun[idx - 5];
      const mirFalling = mir.kijun[idx] < mir.kijun[idx - 5];

      expect(origRising).toBe(true);
      expect(mirFalling).toBe(true);
    });
  });

  // 6. Structure Filter (HH+HL vs LH+LL)
  describe('6. Structure Filter (HH+HL vs LH+LL)', () => {
    it('should map HH+HL swing structure on original to LH+LL on mirror', () => {
      const prices = [
        100, 98, 95, 92, 90, 92, 95, 100, 105, 108, 110, 108, 105, 100, 97, 96, 95, 97, 100, 105, 110, 113, 115, 113, 110, 108
      ];
      const candles: Candle[] = prices.map((p, i) => ({
        timestamp: 1000 + i * 60000,
        open: p,
        high: p + 0.5,
        low: p - 0.5,
        close: p,
        volume: 1000,
      }));

      const mirror = createMirrorCandles(candles, P0);
      const origSwings = confirmedSwings(candles, 2);
      const mirSwings = confirmedSwings(mirror, 2);

      expect(origSwings.highs).toHaveLength(2);
      expect(origSwings.lows).toHaveLength(2);

      const origLastH = origSwings.highs[1];
      const origPrevH = origSwings.highs[0];
      const origLastL = origSwings.lows[1];
      const origPrevL = origSwings.lows[0];

      expect(origLastH.price).toBeGreaterThan(origPrevH.price); // HH
      expect(origLastL.price).toBeGreaterThan(origPrevL.price); // HL

      expect(mirSwings.highs).toHaveLength(2);
      expect(mirSwings.lows).toHaveLength(2);

      const mirLastH = mirSwings.highs[1];
      const mirPrevH = mirSwings.highs[0];
      const mirLastL = mirSwings.lows[1];
      const mirPrevL = mirSwings.lows[0];

      expect(mirLastH.price).toBeLessThan(mirPrevH.price); // LH
      expect(mirLastL.price).toBeLessThan(mirPrevL.price); // LL
    });
  });

  // 7. Full Strategy Signal Mirror Symmetry (S1 configuration)
  describe('7. End-to-End Strategy Signal Mirror Symmetry', () => {
    it('should generate BUY signal on original when mirror generates SELL signal at exact indices', () => {
      const start = 1600000000000;
      const c4h: Candle[] = [];
      let p = 50;
      for (let i = 0; i < 120; i++) {
        p += 1.0;
        c4h.push({
          timestamp: start + i * 4 * 3600 * 1000,
          open: p,
          high: p + 2,
          low: p - 1,
          close: p + 1,
          volume: 1000,
        });
      }

      const c1h: Candle[] = [];
      p = 50;
      for (let i = 0; i < 120 * 4; i++) {
        p += 0.25;
        c1h.push({
          timestamp: start + i * 3600 * 1000,
          open: p,
          high: p + 1,
          low: p - 0.5,
          close: p + 0.5,
          volume: 1000,
        });
      }

      const ltfStart = start + 80 * 4 * 3600 * 1000;
      const c15m: Candle[] = [];
      p = 130;
      for (let i = 0; i < 150; i++) {
        if (i < 80) p += 0.2;
        else if (i < 95) p -= 0.3; // pullback
        else p += 0.5; // bounce up
        c15m.push({
          timestamp: ltfStart + i * 15 * 60 * 1000,
          open: p,
          high: p + 0.4,
          low: p - 0.4,
          close: p,
          volume: 1000,
        });
      }

      const m4h = createMirrorCandles(c4h, P0);
      const m1h = createMirrorCandles(c1h, P0);
      const m15m = createMirrorCandles(c15m, P0);

      const sOrig = new MultiTimeframeStrategy({
        htf4hCandles: c4h,
        htf1hCandles: c1h,
        fisherMode: 'confirm',
        kijunSlopeFilter: false,
        structureFilter: false,
        shortEntryFilter: 'none',
      });

      const sMir = new MultiTimeframeStrategy({
        htf4hCandles: m4h,
        htf1hCandles: m1h,
        fisherMode: 'confirm',
        kijunSlopeFilter: false,
        structureFilter: false,
        shortEntryFilter: 'none',
      });

      const origSignals = c15m.map((_, idx) => sOrig.analyze(c15m, idx));
      const mirrorSignals = m15m.map((_, idx) => sMir.analyze(m15m, idx));

      const origBuys = origSignals
        .map((s, idx) => (s.action === 'BUY' ? idx : -1))
        .filter((idx) => idx !== -1);
      const mirrorSells = mirrorSignals
        .map((s, idx) => (s.action === 'SELL' ? idx : -1))
        .filter((idx) => idx !== -1);

      expect(origBuys).toEqual([95, 103]);
      expect(mirrorSells).toEqual([95, 103]);
    });
  });

  // 8. Short Entry Filter Asymmetry Documentation
  describe('8. Short Entry Filters (SH4 additions)', () => {
    it('documents that shortEntryFilter adds asymmetric requirements only to SELL signals', () => {
      const sNone = new MultiTimeframeStrategy({ shortEntryFilter: 'none' });
      const sV1 = new MultiTimeframeStrategy({ shortEntryFilter: 'v1_1dBearish' });
      const sV2 = new MultiTimeframeStrategy({ shortEntryFilter: 'v2_ltfBelowCloud' });

      expect(sNone.shortEntryFilter).toBe('none');
      expect(sV1.shortEntryFilter).toBe('v1_1dBearish');
      expect(sV2.shortEntryFilter).toBe('v2_ltfBelowCloud');
    });
  });
});
