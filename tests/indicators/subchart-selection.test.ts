import { calculateRSI } from '@/indicators/rsi';
import { calculateFisherRsi, calculateIftRsi } from '@/indicators/fisher-rsi';
import type { Candle } from '@/data/models/candle';

describe('Oscillator Sub-Chart Data Preparation & Indicator Selection', () => {
  const createMockCandles = (count: number, startPrice = 100): Candle[] => {
    const candles: Candle[] = [];
    let price = startPrice;
    const baseTime = 1600000000000;
    for (let i = 0; i < count; i++) {
      // Simulate realistic oscillatory price movement
      const delta = Math.sin(i / 5) * 2 + (i % 2 === 0 ? 0.5 : -0.5);
      price += delta;
      candles.push({
        timestamp: baseTime + i * 3600000, // 1h intervals
        open: price - 0.2,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1000,
      });
    }
    return candles;
  };

  const candles = createMockCandles(60, 100);
  const closes = candles.map((c) => c.close);

  describe('1. Standard RSI Selection', () => {
    it('should calculate Standard RSI on a 0-100 scale with warm-up NaNs', () => {
      const period = 14;
      const rsi = calculateRSI(closes, period);

      expect(rsi.length).toBe(closes.length);

      // Warm-up values should be NaN
      for (let i = 0; i < period; i++) {
        expect(Number.isNaN(rsi[i])).toBe(true);
      }

      // Valid values should be strictly within [0, 100]
      const validValues = rsi.filter((v) => Number.isFinite(v));
      expect(validValues.length).toBeGreaterThan(0);
      for (const val of validValues) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(100);
      }
    });

    it('should correctly format chart timestamps as UTC integer seconds without fake zeroes', () => {
      const rsi = calculateRSI(closes, 14);
      const chartPoints: { time: number; value: number }[] = [];

      for (let i = 0; i < candles.length; i++) {
        const val = rsi[i];
        if (Number.isFinite(val)) {
          chartPoints.push({
            time: Math.floor(candles[i].timestamp / 1000),
            value: val,
          });
        }
      }

      // Ensure no warm-up NaNs were converted into 0
      expect(chartPoints.length).toBe(candles.length - 14);
      expect(chartPoints[0].time).toBe(Math.floor(candles[14].timestamp / 1000));
      expect(chartPoints[0].value).not.toBe(0);
    });
  });

  describe('2. Fisher RSI Selection', () => {
    it('should calculate Fisher RSI returning both fisher and signal lines with midline 0', () => {
      const rsiPeriod = 14;
      const res = calculateFisherRsi(closes, { rsiPeriod });

      expect(res.fisher.length).toBe(closes.length);
      expect(res.signal.length).toBe(closes.length);

      // Signal line is 1-bar lagged Fisher line
      for (let i = 1; i < res.fisher.length; i++) {
        if (Number.isFinite(res.fisher[i - 1])) {
          expect(res.signal[i]).toBe(res.fisher[i - 1]);
        }
      }

      // Valid values should oscillate around 0 (can be positive and negative)
      const validFisher = res.fisher.filter((v) => Number.isFinite(v));
      expect(validFisher.length).toBeGreaterThan(0);
      const hasPositive = validFisher.some((v) => v > 0);
      const hasNegative = validFisher.some((v) => v < 0);
      expect(hasPositive).toBe(true);
      expect(hasNegative).toBe(true);
    });

    it('should filter warm-up NaNs so neither line plots invalid points', () => {
      const res = calculateFisherRsi(closes, { rsiPeriod: 14 });
      const fisherSeries: { time: number; value: number }[] = [];
      const signalSeries: { time: number; value: number }[] = [];

      for (let i = 0; i < candles.length; i++) {
        const t = Math.floor(candles[i].timestamp / 1000);
        const fv = res.fisher[i];
        const sv = res.signal[i];
        if (Number.isFinite(fv)) fisherSeries.push({ time: t, value: fv });
        if (Number.isFinite(sv)) signalSeries.push({ time: t, value: sv });
      }

      expect(fisherSeries.length).toBeGreaterThan(0);
      expect(signalSeries.length).toBeGreaterThan(0);
      // Signal is lagged by 1 bar, so signalSeries has 1 fewer point or starts 1 bar later
      expect(signalSeries.length).toBe(fisherSeries.length - 1);
    });
  });

  describe('3. IFT-RSI Selection', () => {
    it('should calculate IFT-RSI bounded in (-1, 1) around midline 0', () => {
      const rsiPeriod = 14;
      const ift = calculateIftRsi(closes, { rsiPeriod });

      expect(ift.length).toBe(closes.length);

      const validIft = ift.filter((v) => Number.isFinite(v));
      expect(validIft.length).toBeGreaterThan(0);

      // Inverse Fisher Transform is bounded strictly between -1 and +1
      for (const val of validIft) {
        expect(val).toBeGreaterThanOrEqual(-1.0);
        expect(val).toBeLessThanOrEqual(1.0);
      }

      // Check standard threshold regions (+0.5 overbought, -0.5 oversold)
      const maxVal = Math.max(...validIft);
      const minVal = Math.min(...validIft);
      expect(maxVal).toBeGreaterThan(0);
      expect(minVal).toBeLessThan(0);
    });

    it('should correctly format IFT chart series with correct timestamps', () => {
      const ift = calculateIftRsi(closes, { rsiPeriod: 14 });
      const iftSeries: { time: number; value: number }[] = [];

      for (let i = 0; i < candles.length; i++) {
        const t = Math.floor(candles[i].timestamp / 1000);
        const v = ift[i];
        if (Number.isFinite(v)) {
          iftSeries.push({ time: t, value: v });
        }
      }

      expect(iftSeries.length).toBeGreaterThan(0);
      for (let k = 1; k < iftSeries.length; k++) {
        expect(iftSeries[k].time).toBeGreaterThan(iftSeries[k - 1].time);
      }
    });
  });

  describe('4. Display Selection Independence', () => {
    it('switching display between RSI, Fisher, and IFT does not alter underlying indicator outputs', () => {
      const rsi = calculateRSI(closes, 14);
      const fisher = calculateFisherRsi(closes, { rsiPeriod: 14 });
      const ift = calculateIftRsi(closes, { rsiPeriod: 14 });

      // Ensure each calculation is distinct and self-contained
      expect(rsi).not.toEqual(ift);
      expect(fisher.fisher).not.toEqual(ift);

      // Verify scaling differences: RSI is 0-100, IFT is -1 to 1, Fisher can exceed [-2, 2]
      const validRsi = rsi.filter((v) => Number.isFinite(v));
      const validIft = ift.filter((v) => Number.isFinite(v));
      expect(Math.max(...validRsi)).toBeGreaterThan(20);
      expect(Math.max(...validIft)).toBeLessThanOrEqual(1.0);
    });
  });
});
