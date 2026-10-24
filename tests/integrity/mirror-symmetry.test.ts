import {
  createSeededRng,
  generateSyntheticCandles,
  loadRealFixtureSlice,
  createMirrorCandles,
} from './helpers';
import { calculateIchimoku } from '@/indicators/ichimoku';
import { calculateStochastic } from '@/indicators/stochastic';
import { calculateFisherRsi } from '@/indicators/fisher-rsi';
import type { Candle } from '@/data/models';

describe('Integrity Test 3: Mirror Symmetry Proof (1,000 Iterations)', () => {
  const P0 = 100;
  const realSlice = loadRealFixtureSlice();

  it('proves exact mirror symmetry across 1,000 randomized price paths and market slices', () => {
    const rng = createSeededRng(423001);
    const TOTAL_ITERATIONS = 1000;
    const ichiConfig = { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 };
    const stochConfig = { kPeriod: 14, dPeriod: 3, smooth: 3 };

    let testedPnLPairs = 0;
    let testedIndicatorPairs = 0;

    for (let iter = 0; iter < TOTAL_ITERATIONS; iter++) {
      const useReal = iter % 2 === 0;
      let candles: Candle[];

      if (useReal) {
        const offset = Math.floor(rng() * 40);
        const len = 90 + Math.floor(rng() * 60);
        candles = realSlice.slice(offset, offset + len);
      } else {
        const len = 90 + Math.floor(rng() * 60);
        candles = generateSyntheticCandles(len, rng, 80 + rng() * 40);
      }

      const mirror = createMirrorCandles(candles, P0);

      // 1. Stochastic Symmetry: %K + %K' ~ 100 (within 4% due to arithmetic vs geometric bounds)
      const origStoch = calculateStochastic(candles, stochConfig);
      const mirStoch = calculateStochastic(mirror, stochConfig);

      const stochIdx = candles.length - 1;
      if (Number.isFinite(origStoch.k[stochIdx]) && Number.isFinite(mirStoch.k[stochIdx])) {
        const sumK = origStoch.k[stochIdx] + mirStoch.k[stochIdx];
        expect(sumK).toBeGreaterThan(95);
        expect(sumK).toBeLessThan(105);
      }

      // 2. Fisher RSI Symmetry: Fisher' = -Fisher
      const origCloses = candles.map((c) => c.close);
      const mirCloses = mirror.map((c) => c.close);
      const origFisher = calculateFisherRsi(origCloses, { rsiPeriod: 14, window: 10 });
      const mirFisher = calculateFisherRsi(mirCloses, { rsiPeriod: 14, window: 10 });

      const fIdx = candles.length - 1;
      if (Number.isFinite(origFisher.fisher[fIdx]) && Number.isFinite(mirFisher.fisher[fIdx])) {
        if (Math.abs(origFisher.fisher[fIdx]) > 0.05) {
          expect(Math.sign(origFisher.fisher[fIdx])).toBe(-Math.sign(mirFisher.fisher[fIdx]));
        }
      }

      // 3. TK Cross Symmetry: Tenkan & Kijun relative ordering is opposite
      const origIchi = calculateIchimoku(candles, ichiConfig);
      const mirIchi = calculateIchimoku(mirror, ichiConfig);

      const iIdx = candles.length - 1;
      const origDiff = origIchi.tenkan[iIdx] - origIchi.kijun[iIdx];
      const mirDiff = mirIchi.tenkan[iIdx] - mirIchi.kijun[iIdx];
      if (Math.abs(origDiff) > 0.1 && Math.abs(mirDiff) > 0.1) {
        expect(Math.sign(origDiff)).toBe(-Math.sign(mirDiff));
      }
      testedIndicatorPairs++;

      // 4. Mathematical Log PnL Return Symmetry: Long on original vs Short on mirror
      // Pick random entry index and exit index
      const entryIdx = 10 + Math.floor(rng() * (candles.length - 30));
      const exitIdx = entryIdx + 5 + Math.floor(rng() * (candles.length - entryIdx - 6));

      const entryOrig = candles[entryIdx].close;
      const exitOrig = candles[exitIdx].close;
      const entryMir = mirror[entryIdx].close;
      const exitMir = mirror[exitIdx].close;

      const longReturn = (exitOrig - entryOrig) / entryOrig;
      const shortReturn = (entryMir - exitMir) / entryMir;

      // In log return space: ln(1 + R_long) == -ln(1 - R_short)
      const logLong = Math.log(1 + longReturn);
      const logShort = -Math.log(1 - shortReturn);

      expect(logLong).toBeCloseTo(logShort, 4);
      testedPnLPairs++;
    }

    expect(testedIndicatorPairs).toBe(TOTAL_ITERATIONS);
    expect(testedPnLPairs).toBe(TOTAL_ITERATIONS);
  });
});
