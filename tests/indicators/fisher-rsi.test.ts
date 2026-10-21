import * as fs from 'fs';
import * as path from 'path';
import { calculateFisherRsi, calculateIftRsi, fisherCrossEvents } from '@/indicators/fisher-rsi';

describe('Fisher RSI & IFT-RSI Indicators (Pine Matching)', () => {
  const generateSineWave = (count: number): number[] => {
    const prices: number[] = [];
    for (let i = 0; i < count; i++) {
      // Period of 40 bars with amplitude 10 centered at 100
      prices.push(100 + 10 * Math.sin((i / 40) * 2 * Math.PI));
    }
    return prices;
  };

  describe('calculateFisherRsi (Matching Pine ta.rsi + highest/lowest)', () => {
    it('returns output of same length as input including scaled and signalScaled', () => {
      const data = generateSineWave(100);
      const res = calculateFisherRsi(data);
      expect(res.fisher).toHaveLength(100);
      expect(res.signal).toHaveLength(100);
      expect(res.scaled).toHaveLength(100);
      expect(res.signalScaled).toHaveLength(100);
      expect(res.rsiScore).toHaveLength(100);
    });

    it('begins from first valid RSI bar without artificial extra lookback warm-up', () => {
      const data = generateSineWave(60);
      const rsiPeriod = 14;
      const window = 10;
      const res = calculateFisherRsi(data, { rsiPeriod, window });

      // Before RSI period completes (0 .. rsiPeriod-1), values are NaN
      for (let i = 0; i < rsiPeriod; i++) {
        expect(Number.isNaN(res.fisher[i])).toBe(true);
        expect(Number.isNaN(res.scaled[i])).toBe(true);
      }

      // Exactly at rsiPeriod (14), RSI is valid and Fisher starts immediately
      expect(Number.isFinite(res.fisher[rsiPeriod])).toBe(true);
      expect(Number.isFinite(res.scaled[rsiPeriod])).toBe(true);
      expect(res.scaled[rsiPeriod]).toBeCloseTo(50 + res.fisher[rsiPeriod] * 10, 4);

      // Signal is 1-bar lagged fisher, so it becomes valid on the next bar
      expect(Number.isNaN(res.signal[rsiPeriod])).toBe(true);
      expect(Number.isFinite(res.signal[rsiPeriod + 1])).toBe(true);
      expect(res.signal[rsiPeriod + 1]).toBe(res.fisher[rsiPeriod]);
    });

    it('supports rsiSmoothing SMA smoothing parameter', () => {
      const data = generateSineWave(60);
      const smooth1 = calculateFisherRsi(data, { rsiPeriod: 14, rsiSmoothing: 1 });
      const smooth3 = calculateFisherRsi(data, { rsiPeriod: 14, rsiSmoothing: 3 });

      // Smoothing > 1 should produce different smoothed RSI and Fisher values
      expect(smooth1.rsiScore[20]).not.toBe(smooth3.rsiScore[20]);
      expect(Number.isFinite(smooth3.fisher[20])).toBe(true);
    });

    it('handles constant input without error or crash', () => {
      const constantData = new Array(80).fill(100);
      expect(() => {
        const res = calculateFisherRsi(constantData);
        expect(res.fisher).toHaveLength(80);
        expect(res.signal).toHaveLength(80);
      }).not.toThrow();
    });

    it('crosses over between fisher and signal at turning points for sinusoidal data', () => {
      const data = generateSineWave(200);
      const res = calculateFisherRsi(data, { rsiPeriod: 14, window: 10 });

      let bullishCrosses = 0;
      let bearishCrosses = 0;

      for (let i = 20; i < data.length; i++) {
        if (
          !Number.isNaN(res.fisher[i]) &&
          !Number.isNaN(res.signal[i]) &&
          !Number.isNaN(res.fisher[i - 1]) &&
          !Number.isNaN(res.signal[i - 1])
        ) {
          if (res.fisher[i - 1] <= res.signal[i - 1] && res.fisher[i] > res.signal[i]) {
            bullishCrosses++;
          }
          if (res.fisher[i - 1] >= res.signal[i - 1] && res.fisher[i] < res.signal[i]) {
            bearishCrosses++;
          }
        }
      }

      expect(bullishCrosses).toBeGreaterThanOrEqual(3);
      expect(bearishCrosses).toBeGreaterThanOrEqual(3);
    });
  });

  describe('fisherCrossEvents (H1.5 Unit Tests: zoneCross vs anyCross)', () => {
    it('anyCross fires on every crossover, but zoneCross only fires when RSI or scaled Fisher is in extreme zone', () => {
      // Construct controlled series
      // Index 0..14 warmup
      // Bar 15..17: Crossover occurs while RSI/Fisher is in neutral zone (45 .. 55) -> anyCross=true, zoneCross=false
      // Bar 25..27: Crossover occurs while RSI is deeply oversold (<= 30) -> anyCross=true, zoneCrossUp=true
      // Bar 35..37: Bearish crossover occurs while RSI is deeply overbought (>= 70) -> anyCross=true, zoneCrossDown=true

      const length = 50;
      const fakeResult = {
        fisher: new Array<number>(length).fill(0),
        signal: new Array<number>(length).fill(0),
        scaled: new Array<number>(length).fill(50),
        signalScaled: new Array<number>(length).fill(50),
        rsiScore: new Array<number>(length).fill(50),
      };

      // Bar 20: Bull cross outside zone (neutral: rsi=50, scaled=50)
      fakeResult.fisher[19] = -0.1;
      fakeResult.signal[19] = 0.0;
      fakeResult.fisher[20] = 0.2;
      fakeResult.signal[20] = -0.1;
      fakeResult.rsiScore[20] = 50;
      fakeResult.scaled[20] = 52;

      // Bar 30: Bull cross INSIDE oversold zone (rsi=25 <= 30)
      fakeResult.fisher[29] = -2.5;
      fakeResult.signal[29] = -2.0;
      fakeResult.fisher[30] = -1.8;
      fakeResult.signal[30] = -2.5;
      fakeResult.rsiScore[30] = 25;
      fakeResult.scaled[30] = 32;

      // Bar 40: Bear cross INSIDE overbought zone (scaled=72 >= 70)
      fakeResult.fisher[39] = 2.5;
      fakeResult.signal[39] = 2.0;
      fakeResult.fisher[40] = 1.8;
      fakeResult.signal[40] = 2.5;
      fakeResult.rsiScore[40] = 65;
      fakeResult.scaled[40] = 72; // scaled >= 70 gates the zone!

      const events = fisherCrossEvents(fakeResult, { oversoldLevel: 30, overboughtLevel: 70 });

      // Bar 20: Any cross is true, but zone cross is FALSE
      expect(events[20].anyCrossUp).toBe(true);
      expect(events[20].zoneCrossUp).toBe(false);

      // Bar 30: Any cross is true, AND zoneCrossUp is TRUE (due to rsi <= 30)
      expect(events[30].anyCrossUp).toBe(true);
      expect(events[30].zoneCrossUp).toBe(true);

      // Bar 40: Any cross down is true, AND zoneCrossDown is TRUE (due to scaled >= 70)
      expect(events[40].anyCrossDown).toBe(true);
      expect(events[40].zoneCrossDown).toBe(true);
    });
  });

  describe('Fisher RSI Golden Fixture Parity Test (H1.4)', () => {
    const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', 'fisher_golden.json');
    const hasFixture = fs.existsSync(fixturePath);

    (hasFixture ? it : it.skip)(
      'compares calculateFisherRsi against reference golden benchmark with tolerance 0.05 on scaled',
      () => {
        if (!hasFixture) return;
        const fixtureContent = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        const closes: number[] = fixtureContent.candles.map((c: any) => c.close);
        const expected: Array<{ fisherScaled: number; signalScaled: number }> = fixtureContent.expected;

        const res = calculateFisherRsi(closes, { rsiPeriod: 14, window: 10 });

        for (let i = 0; i < expected.length; i++) {
          if (expected[i].fisherScaled !== undefined && Number.isFinite(expected[i].fisherScaled)) {
            expect(res.scaled[i]).toBeCloseTo(expected[i].fisherScaled, 1); // 0.05 tolerance
          }
          if (expected[i].signalScaled !== undefined && Number.isFinite(expected[i].signalScaled)) {
            expect(res.signalScaled[i]).toBeCloseTo(expected[i].signalScaled, 1);
          }
        }
      }
    );

    if (!hasFixture) {
      it('marks golden fixture test as BLOCKED pending reference benchmark from user', () => {
        // Explicit placeholder noting blocked state per instruction
        expect('BLOCKED: نیاز به داده از کاربر').toBeDefined();
      });
    }
  });

  describe('calculateIftRsi', () => {
    it('returns output of same length as input', () => {
      const data = generateSineWave(100);
      const ift = calculateIftRsi(data);
      expect(ift).toHaveLength(100);
    });

    it('contains NaN during warm-up period', () => {
      const data = generateSineWave(60);
      const rsiPeriod = 14;
      const wmaPeriod = 9;
      const ift = calculateIftRsi(data, { rsiPeriod, wmaPeriod });

      for (let i = 0; i < rsiPeriod + wmaPeriod - 1; i++) {
        expect(Number.isNaN(ift[i])).toBe(true);
      }
      expect(Number.isNaN(ift[rsiPeriod + wmaPeriod - 1])).toBe(false);
      expect(Number.isFinite(ift[rsiPeriod + wmaPeriod - 1])).toBe(true);
    });

    it('strictly outputs values bounded in (-1, 1)', () => {
      const data = generateSineWave(150);
      const ift = calculateIftRsi(data);

      for (const val of ift) {
        if (!Number.isNaN(val)) {
          expect(val).toBeGreaterThan(-1);
          expect(val).toBeLessThan(1);
        }
      }
    });

    it('handles constant input without error or crash', () => {
      const constantData = new Array(80).fill(50);
      expect(() => {
        const ift = calculateIftRsi(constantData);
        expect(ift).toHaveLength(80);
      }).not.toThrow();
    });
  });
});
