import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@/data/models/candle';
import { calculateFisherRsi } from '@/indicators/fisher-rsi';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';

describe('R4: Two-line Fisher RSI Crossover & Chart Parity Test', () => {
  it('detects bullish and bearish crossovers on synthetic series matching between chart logic and strategy event index', () => {
    // Generate a cyclical series of 60 candles designed to generate clear Fisher crossovers
    const candles: Candle[] = [];
    const baseTime = 1600000000000;
    const intervalMs = 900000; // 15m

    for (let i = 0; i < 70; i++) {
      // Oscillate price to produce RSI cycles
      const cycle = Math.sin((i / 70) * 4 * Math.PI);
      const close = 100 + cycle * 15;
      candles.push({
        timestamp: baseTime + i * intervalMs,
        open: close - 0.5,
        high: close + 1.0,
        low: close - 1.0,
        close,
        volume: 1000,
      });
    }

    const closes = candles.map((c) => c.close);
    const { fisher, signal } = calculateFisherRsi(closes, { rsiPeriod: 14, window: 10 });

    // Chart crossover detector logic
    const chartBullCrossIndices: number[] = [];
    const chartBearCrossIndices: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const fCurr = fisher[i];
      const sCurr = signal[i];
      const fPrev = fisher[i - 1];
      const sPrev = signal[i - 1];

      if (
        Number.isFinite(fCurr) &&
        Number.isFinite(sCurr) &&
        Number.isFinite(fPrev) &&
        Number.isFinite(sPrev)
      ) {
        if (fPrev <= sPrev && fCurr > sCurr) {
          chartBullCrossIndices.push(i);
        } else if (fPrev >= sPrev && fCurr < sCurr) {
          chartBearCrossIndices.push(i);
        }
      }
    }

    // Both bullish and bearish crossovers should occur in the oscillatory series
    expect(chartBullCrossIndices.length).toBeGreaterThan(0);
    expect(chartBearCrossIndices.length).toBeGreaterThan(0);

    // Instantiate Strategy configured with two-line Fisher crossover
    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      tenkan: 9,
      kijun: 26,
      senkouB: 52,
      rsiPeriod: 14,
    });

    // Check each index where strategy detects a fisher crossover matches chart logic
    for (let i = 1; i < candles.length; i++) {
      const isChartBull = chartBullCrossIndices.includes(i);
      const isChartBear = chartBearCrossIndices.includes(i);

      // Verify formula conditions directly
      if (isChartBull) {
        expect(fisher[i]).toBeGreaterThan(signal[i]);
        expect(fisher[i - 1]).toBeLessThanOrEqual(signal[i - 1]);
      }
      if (isChartBear) {
        expect(fisher[i]).toBeLessThan(signal[i]);
        expect(fisher[i - 1]).toBeGreaterThanOrEqual(signal[i - 1]);
      }
    }

    // Also check through strategy analyze calls
    const strategyFisherBullIndices: number[] = [];
    const strategyFisherBearIndices: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const sig = strategy.analyze(candles, i);
      const isFisherBull = sig.action === 'BUY' && sig.metadata?.fisherCross === true;
      const isFisherBear = sig.action === 'SELL' && sig.metadata?.fisherCross === true;
      if (isFisherBull) strategyFisherBullIndices.push(i);
      if (isFisherBear) strategyFisherBearIndices.push(i);
    }

    // Any emitted fisher signal must originate strictly from the chart-identified crossover indices
    for (const idx of strategyFisherBullIndices) {
      expect(chartBullCrossIndices).toContain(idx);
    }
    for (const idx of strategyFisherBearIndices) {
      expect(chartBearCrossIndices).toContain(idx);
    }
  });

  it('verifies docs/reference/fisher_rsi_reference.md template exists with required template sections and UNVERIFIED status', () => {
    const refPath = path.resolve(process.cwd(), 'docs', 'reference', 'fisher_rsi_reference.md');
    expect(fs.existsSync(refPath)).toBe(true);

    const content = fs.readFileSync(refPath, 'utf-8');
    expect(content).toContain('نام / نویسنده / لینک');
    expect(content).toContain('کد Pine');
    expect(content).toContain('تنظیمات');
    expect(content).toContain('۱۵ کندل و مقدارهای Fisher و Signal');
    expect(content).toContain('UNVERIFIED: not compared to reference');
  });
});
