import { calculateFisherRsi, calculateIftRsi } from '@/indicators/fisher-rsi';

describe('Fisher RSI & IFT-RSI Indicators', () => {
  const generateSineWave = (count: number): number[] => {
    const prices: number[] = [];
    for (let i = 0; i < count; i++) {
      // Period of 40 bars with amplitude 10 centered at 100
      prices.push(100 + 10 * Math.sin((i / 40) * 2 * Math.PI));
    }
    return prices;
  };

  describe('calculateFisherRsi', () => {
    it('returns output of same length as input', () => {
      const data = generateSineWave(100);
      const { fisher, signal } = calculateFisherRsi(data);
      expect(fisher).toHaveLength(100);
      expect(signal).toHaveLength(100);
    });

    it('contains NaN during warm-up period', () => {
      const data = generateSineWave(60);
      const rsiPeriod = 14;
      const window = 10;
      const { fisher, signal } = calculateFisherRsi(data, { rsiPeriod, window });

      // Before warm-up completes, values must be NaN
      for (let i = 0; i < rsiPeriod + window - 1; i++) {
        expect(Number.isNaN(fisher[i])).toBe(true);
      }
      // Once warmed up, fisher becomes a valid finite number
      expect(Number.isNaN(fisher[rsiPeriod + window - 1])).toBe(false);
      expect(Number.isFinite(fisher[rsiPeriod + window - 1])).toBe(true);

      // Signal is 1-bar lagged fisher, so it becomes valid at rsiPeriod + window
      expect(Number.isNaN(signal[rsiPeriod + window - 1])).toBe(true);
      expect(Number.isFinite(signal[rsiPeriod + window])).toBe(true);
    });

    it('handles constant input without error or crash', () => {
      const constantData = new Array(80).fill(100);
      expect(() => {
        const { fisher, signal } = calculateFisherRsi(constantData);
        expect(fisher).toHaveLength(80);
        expect(signal).toHaveLength(80);
      }).not.toThrow();
    });

    it('crosses over between fisher and signal at turning points for sinusoidal data', () => {
      const data = generateSineWave(200);
      const { fisher, signal } = calculateFisherRsi(data, { rsiPeriod: 14, window: 10 });

      let bullishCrosses = 0;
      let bearishCrosses = 0;

      for (let i = 30; i < data.length; i++) {
        if (!Number.isNaN(fisher[i]) && !Number.isNaN(signal[i]) && !Number.isNaN(fisher[i - 1]) && !Number.isNaN(signal[i - 1])) {
          if (fisher[i - 1] <= signal[i - 1] && fisher[i] > signal[i]) {
            bullishCrosses++;
          }
          if (fisher[i - 1] >= signal[i - 1] && fisher[i] < signal[i]) {
            bearishCrosses++;
          }
        }
      }

      // For a sine wave of 200 bars (5 cycles), crosses must occur repeatedly
      expect(bullishCrosses).toBeGreaterThanOrEqual(3);
      expect(bearishCrosses).toBeGreaterThanOrEqual(3);
    });
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

