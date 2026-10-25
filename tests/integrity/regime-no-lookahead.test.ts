import { createDailyRegimeCalculatorFromDailyCandles } from '@/utils/market-regime';
import type { Candle } from '@/data/models';

describe('Integrity Test: Daily Macro Regime No-Lookahead Guarantee', () => {
  // Generate 300 sequential daily candles
  const dayMs = 86400000;
  const baseStart = Date.UTC(2021, 0, 1, 0, 0, 0);

  function createDailySeries(count: number, startPrice: number = 100): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    for (let i = 0; i < count; i++) {
      const open = price;
      const high = open * 1.02;
      const low = open * 0.98;
      const close = open * (1 + (i % 2 === 0 ? 0.01 : -0.008));
      price = close;
      candles.push({
        timestamp: baseStart + i * dayMs,
        open,
        high,
        low,
        close,
        volume: 1000,
      });
    }
    return candles;
  }

  it('guarantees that getDailyTrendAt(t) strictly uses closed daily candles from previous UTC day', () => {
    const dailyCandles = createDailySeries(250);
    const calc = createDailyRegimeCalculatorFromDailyCandles(dailyCandles);

    // Pick day index 220 (well past the 200 SMA warmup)
    const targetDayIndex = 220;
    const targetDayStart = dailyCandles[targetDayIndex].timestamp;

    // Check multiple timestamps throughout target day: hour 0, hour 6, hour 12, hour 23
    const testHours = [0, 1, 6, 12, 18, 23, 23.9];
    for (const h of testHours) {
      const t = targetDayStart + Math.floor(h * 3600000);
      const data = calc.getDailyDataAt(t);

      expect(data).not.toBeNull();
      // Must exactly equal the close of day 219 (the previous closed day), NOT day 220
      expect(data!.close).toBe(dailyCandles[targetDayIndex - 1].close);
      expect(data!.close).not.toBe(dailyCandles[targetDayIndex].close);
    }
  });

  it('guarantees zero lookahead: modifying current day or future days does not alter regime at time t', () => {
    const baseCandles = createDailySeries(240);
    const targetDayIdx = 215;
    const targetTime = baseCandles[targetDayIdx].timestamp + 14 * 3600000; // 14:00 on day 215

    const calcOriginal = createDailyRegimeCalculatorFromDailyCandles(baseCandles);
    const originalTrend = calcOriginal.getDailyTrendAt(targetTime);
    const originalData = calcOriginal.getDailyDataAt(targetTime);

    // Create a modified series where day 215 close is changed drastically, and future days 216..239 are altered
    const modifiedCandles: Candle[] = baseCandles.map((c, idx) => {
      if (idx === targetDayIdx) {
        return { ...c, close: c.close * 10, high: c.high * 10 };
      }
      if (idx > targetDayIdx) {
        return { ...c, close: c.close * 0.1, low: c.low * 0.1 };
      }
      return c;
    });

    const calcModified = createDailyRegimeCalculatorFromDailyCandles(modifiedCandles);
    const modifiedTrend = calcModified.getDailyTrendAt(targetTime);
    const modifiedData = calcModified.getDailyDataAt(targetTime);

    // The regime, close, and sma200 at targetTime must be 100% IDENTICAL
    expect(modifiedTrend).toBe(originalTrend);
    expect(modifiedData!.close).toBe(originalData!.close);
    expect(modifiedData!.sma200).toBeCloseTo(originalData!.sma200, 8);
  });

  it('guarantees zero lookahead: appending future candles does not alter historical regime evaluation', () => {
    const historicalCandles = createDailySeries(220);
    const calcBefore = createDailyRegimeCalculatorFromDailyCandles(historicalCandles);

    const testTime = historicalCandles[210].timestamp + 8 * 3600000;
    const trendBefore = calcBefore.getDailyTrendAt(testTime);
    const dataBefore = calcBefore.getDailyDataAt(testTime);

    // Append 50 more future candles
    const futureCandles = createDailySeries(270);
    const calcAfter = createDailyRegimeCalculatorFromDailyCandles(futureCandles);

    const trendAfter = calcAfter.getDailyTrendAt(testTime);
    const dataAfter = calcAfter.getDailyDataAt(testTime);

    expect(trendAfter).toBe(trendBefore);
    expect(dataAfter!.close).toBe(dataBefore!.close);
    expect(dataAfter!.sma200).toBeCloseTo(dataBefore!.sma200, 8);
  });
});
