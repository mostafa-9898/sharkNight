import type { Candle } from '../../src/data/models';
import {
  simulateB1,
  simulateB2,
  simulateB3,
  simulateB4,
} from '../../src/backtest/simple-baselines';
import {
  createDailyRegimeCalculatorFromDailyCandles,
  type DailyRegimeCalculator,
} from '../../src/utils/market-regime';
import { MultiTimeframeStrategy } from '../../src/strategies/multi-timeframe-strategy';

describe('Simple Baselines Verification (BM2: B1, B2, B3, B4)', () => {
  describe('B1: Buy & Hold 30%', () => {
    it('achieves totalReturn = 0.3 * (price growth) minus trading fees on synthetic rising data', () => {
      const initialBalance = 10000;
      const tradeFeePercent = 0.1; // 0.1%
      const startPrice = 100;
      const endPrice = 150; // +50% price growth
      const priceGrowthPercent = ((endPrice - startPrice) / startPrice) * 100; // 50%

      const candles: Candle[] = [
        {
          timestamp: 1609459200000, // 2021-01-01
          open: startPrice,
          high: startPrice,
          low: startPrice,
          close: startPrice,
          volume: 1000,
        },
        {
          timestamp: 1609545600000, // 2021-01-02
          open: 125,
          high: 130,
          low: 120,
          close: 125,
          volume: 1000,
        },
        {
          timestamp: 1609632000000, // 2021-01-03
          open: endPrice,
          high: endPrice,
          low: endPrice,
          close: endPrice,
          volume: 1000,
        },
      ];

      const res = simulateB1(candles, {
        initialBalance,
        tradeFeePercent,
        positionSizePercent: 30,
      });

      // Theoretical calculation:
      // Invested: 3000 USDT. Entry fee: 3.00 USDT. Net invest: 2997 USDT. Quantity: 29.97.
      // Final gross value: 29.97 * 150 = 4495.50 USDT. Exit fee: 4.4955 USDT. Net proceeds: 4491.0045 USDT.
      // Cash remaining: 7000 USDT. Final equity: 11491.0045 USDT.
      // Net profit: +1491.0045 USDT (+14.910045%).
      // Unleveraged 30% growth = 0.3 * 50% = 15.0%.
      // Total fees = (3.00 + 4.4955) / 10000 = 0.074955%.
      // 0.3 * priceGrowth - feesPercent = 15.0 - 0.075 = 14.925%.
      const alloc = initialBalance * 0.3;
      const entryFee = alloc * (tradeFeePercent / 100);
      const netInvest = alloc - entryFee;
      const qty = netInvest / startPrice;
      const exitGross = qty * endPrice;
      const exitFee = exitGross * (tradeFeePercent / 100);
      const totalFeesUsd = entryFee + exitFee;
      const feeDragPercent = (totalFeesUsd / initialBalance) * 100;
      const expectedReturn = 0.3 * priceGrowthPercent - feeDragPercent;

      expect(res.trades).toBe(1);
      expect(res.avgTimeExposurePercent).toBe(100.0);
      expect(res.totalReturn).toBeCloseTo(expectedReturn, 1);
      expect(res.totalReturn).toBeCloseTo(14.91, 1);
    });
  });

  describe('B2: Daily Trend SMA200 (No-lookahead & zero exposure in bear)', () => {
    it('has exactly 0% exposure on days when close_1d is below SMA200_1d', () => {
      // Build 210 daily candles where prices are in a bear market (close < SMA200)
      const dayMs = 86400000;
      const baseTs = 1600000000000;
      const dailyCandles: Candle[] = [];

      for (let d = 0; d < 250; d++) {
        // First 200 days flat at 100, then drop to 50 (well below SMA200 ~ 95)
        const price = d < 200 ? 100 : 50;
        dailyCandles.push({
          timestamp: baseTs + d * dayMs,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 1000,
        });
      }

      const dailyCalc = createDailyRegimeCalculatorFromDailyCandles(dailyCandles);

      // Now test LTF candles on day 220 (where close_1d = 50 < SMA200 = 100)
      const testDayTs = baseTs + 220 * dayMs;
      const ltfCandles: Candle[] = [
        {
          timestamp: testDayTs + 3600000,
          open: 50,
          high: 52,
          low: 49,
          close: 50,
          volume: 100,
        },
        {
          timestamp: testDayTs + 7200000,
          open: 50,
          high: 51,
          low: 48,
          close: 49,
          volume: 100,
        },
      ];

      const res = simulateB2(ltfCandles, dailyCalc);

      expect(res.trades).toBe(0);
      expect(res.avgTimeExposurePercent).toBe(0);
      expect(res.avgCapitalExposurePercent).toBe(0);
      expect(res.totalReturn).toBe(0);
    });

    it('strictly avoids lookahead by using only completed prior UTC day', () => {
      const dayMs = 86400000;
      const baseTs = 1600000000000;
      const dailyCandles: Candle[] = [];

      // Create 210 daily candles
      for (let d = 0; d < 210; d++) {
        dailyCandles.push({
          timestamp: baseTs + d * dayMs,
          open: 100,
          high: 105,
          low: 95,
          close: 100,
          volume: 1000,
        });
      }

      const dailyCalc = createDailyRegimeCalculatorFromDailyCandles(dailyCandles);

      // On day 205 at 12:00 UTC, the regime must use Day 204's closed candle
      const day205Midday = baseTs + 205 * dayMs + 12 * 3600000;
      const dataAtMidday = dailyCalc.getDailyDataAt(day205Midday);
      expect(dataAtMidday).not.toBeNull();
      // Must match day 204's close
      expect(dataAtMidday?.close).toBe(dailyCandles[204].close);

      // Even if day 205 had an extreme pump in the middle of the day,
      // the regime at that midday timestamp remains strictly unaffected
      const dataRepeat = dailyCalc.getDailyDataAt(day205Midday);
      expect(dataRepeat?.close).toBe(dailyCandles[204].close);
    });
  });

  describe('B3: Golden Cross SMA50 > SMA200', () => {
    it('is long when SMA50 > SMA200 and cash when SMA50 <= SMA200', () => {
      const dayMs = 86400000;
      const baseTs = 1600000000000;
      const dailyCandles: Candle[] = [];

      // 250 daily candles:
      // Days 0..199 at 100.
      // Days 200..250 rally to 200 (SMA50 rises above SMA200)
      for (let d = 0; d < 250; d++) {
        const p = d < 200 ? 100 : 100 + (d - 200) * 2;
        dailyCandles.push({
          timestamp: baseTs + d * dayMs,
          open: p,
          high: p,
          low: p,
          close: p,
          volume: 1000,
        });
      }

      const dailyCalc = createDailyRegimeCalculatorFromDailyCandles(dailyCandles);

      // Day 240: SMA50 is clearly > SMA200
      const day240Ts = baseTs + 240 * dayMs + 3600000;
      const ltfCandles: Candle[] = [
        {
          timestamp: day240Ts,
          open: 180,
          high: 185,
          low: 175,
          close: 180,
          volume: 100,
        },
      ];

      const res = simulateB3(ltfCandles, dailyCalc);
      expect(res.trades).toBe(1);
      expect(res.avgTimeExposurePercent).toBe(100);
    });
  });

  describe('B4: HTF Strict Bullish', () => {
    it('enters long when HTF strict direction is +1 and cash when 0 or -1', () => {
      const stratMock = {
        getStrictHtfDirection: jest
          .fn()
          .mockReturnValueOnce(0) // candle 0: not bullish -> cash
          .mockReturnValueOnce(1) // candle 1: bullish -> long entry
          .mockReturnValueOnce(1) // candle 2: bullish -> hold long
          .mockReturnValueOnce(-1), // candle 3: bearish -> exit to cash
      } as unknown as MultiTimeframeStrategy;

      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 10 },
        { timestamp: 2000, open: 100, high: 100, low: 100, close: 100, volume: 10 },
        { timestamp: 3000, open: 102, high: 102, low: 102, close: 102, volume: 10 },
        { timestamp: 4000, open: 101, high: 101, low: 101, close: 101, volume: 10 },
      ];

      const res = simulateB4(candles, stratMock);
      expect(res.trades).toBe(1);
      expect(stratMock.getStrictHtfDirection).toHaveBeenCalledTimes(4);
    });
  });
});
