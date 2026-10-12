import { IchimokuRsiStrategy } from '@/strategies/ichimoku-rsi-strategy';
import type { Candle } from '@/data/models';

describe('IchimokuRsiStrategy', () => {
  const createCandle = (
    open: number,
    high: number,
    low: number,
    close: number,
    timestamp = 1600000000000
  ): Candle => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume: 1000,
  });

  describe('Validation', () => {
    it('should throw when tenkan >= kijun or kijun >= senkouB', () => {
      expect(() => new IchimokuRsiStrategy({ tenkan: 26, kijun: 9, senkouB: 52 })).toThrow(
        /tenkan.*kijun/
      );
      expect(() => new IchimokuRsiStrategy({ tenkan: 9, kijun: 52, senkouB: 26 })).toThrow(
        /kijun.*senkouB/
      );
    });

    it('should throw when displacement <= 0', () => {
      expect(() => new IchimokuRsiStrategy({ displacement: 0 })).toThrow(/positive/);
    });

    it('should throw when rsiLookback < 1', () => {
      expect(() => new IchimokuRsiStrategy({ rsiLookback: 0 })).toThrow(/rsiLookback/);
    });

    it('should throw when RSI bounds do not satisfy buyMin < buyMax < sellMin < sellMax', () => {
      expect(
        () => new IchimokuRsiStrategy({ rsiBuyMin: 40, rsiBuyMax: 30, rsiSellMin: 60, rsiSellMax: 80 })
      ).toThrow(/buyMin/);
      expect(
        () => new IchimokuRsiStrategy({ rsiBuyMin: 20, rsiBuyMax: 65, rsiSellMin: 60, rsiSellMax: 80 })
      ).toThrow(/buyMax/);
      expect(
        () => new IchimokuRsiStrategy({ rsiBuyMin: 20, rsiBuyMax: 40, rsiSellMin: 85, rsiSellMax: 80 })
      ).toThrow(/sellMin/);
    });
  });

  describe('Signal Generation', () => {
    it('should generate BUY signal on TK cross up with RSI inside [20, 40] on same candle', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 1, // same candle only
      });

      // Candle sequence where on candle 7:
      // prevTenkan (69.5) <= prevKijun (71.5), currentTenkan (76) > currentKijun (75) -> Cross Up!
      // and RSI on candle 7 is in [20, 40]
      const candles: Candle[] = [
        createCandle(100, 100, 100, 100, 1000),
        createCandle(95, 95, 95, 95, 2000),
        createCandle(85, 85, 84, 85, 3000),
        createCandle(75, 75, 74, 75, 4000),
        createCandle(70, 70, 69, 70, 5000),
        createCandle(68, 68, 68, 68, 6000),
        createCandle(70, 71, 70, 70, 7000),
        createCandle(70, 82, 74, 70.3, 8000), // c7: Tenkan 76 > Kijun 75, close 70.3 -> RSI ~36.9 in [20, 40]
      ];

      const signal = strategy.analyze(candles, 7);
      expect(signal.action).toBe('BUY');
      expect(signal.reason).toContain('Ichimoku TK cross up');
      expect(signal.metadata?.rsiHitIndex).toBe(7);
      expect(Number(signal.metadata?.rsiHitValue)).toBeGreaterThanOrEqual(20);
      expect(Number(signal.metadata?.rsiHitValue)).toBeLessThanOrEqual(40);
    });

    it('should generate BUY signal when RSI was in zone on earlier candle within rsiLookback', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 5,
      });

      // Candles: at index 6, RSI is 31.1 (inside [20, 40]). At index 7, TK crosses up and RSI rises to 73.0
      const candles: Candle[] = [
        createCandle(100, 100, 100, 100, 1000),
        createCandle(95, 95, 95, 95, 2000),
        createCandle(85, 85, 84, 85, 3000),
        createCandle(75, 75, 74, 75, 4000),
        createCandle(70, 70, 69, 70, 5000),
        createCandle(68, 68, 68, 68, 6000),
        createCandle(70, 71, 70, 70, 7000), // c6: RSI = 31.1 in [20, 40]
        createCandle(75, 82, 74, 75, 8000), // c7: TK cross up
      ];

      const signal = strategy.analyze(candles, 7);
      expect(signal.action).toBe('BUY');
      expect(signal.reason).toContain('Ichimoku TK cross up');
      expect(signal.metadata).toBeDefined();
      expect(signal.metadata?.rsiHitIndex).toBe(6);
    });

    it('should NOT generate BUY when RSI is out of zone (e.g. 45 or 15)', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 1, // same candle only
      });

      // Constant candles then sudden massive jump: RSI shoots to ~100 (> 40)
      const candles: Candle[] = [
        createCandle(50, 50, 50, 50, 1000),
        createCandle(50, 50, 50, 50, 2000),
        createCandle(50, 50, 50, 50, 3000),
        createCandle(50, 50, 50, 50, 4000),
        createCandle(50, 50, 50, 50, 5000),
        createCandle(50, 50, 50, 50, 6000),
        createCandle(50, 80, 50, 80, 7000), // Massive spike: RSI is 100 (out of [20, 40])
      ];

      const signal = strategy.analyze(candles, 6);
      expect(signal.action).toBe('HOLD');
    });

    it('should NOT generate BUY when in-zone RSI candle is older than rsiLookback', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 1, // Lookback of 1 means candle 6's in-zone RSI won't count for candle 7's cross
      });

      const candles: Candle[] = [
        createCandle(100, 100, 100, 100, 1000),
        createCandle(95, 95, 95, 95, 2000),
        createCandle(85, 85, 84, 85, 3000),
        createCandle(75, 75, 74, 75, 4000),
        createCandle(70, 70, 69, 70, 5000),
        createCandle(68, 68, 68, 68, 6000),
        createCandle(70, 71, 70, 70, 7000), // c6: RSI is 31.1 in [20, 40]
        createCandle(75, 82, 74, 75, 8000), // c7: cross up, but RSI at c7 is 73.0 (outside [20, 40])
      ];

      const signal = strategy.analyze(candles, 7);
      expect(signal.action).toBe('HOLD');
    });

    it('should NOT generate signal on state only (tenkan above kijun without a fresh cross)', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 5,
      });

      const candles: Candle[] = [
        createCandle(100, 100, 100, 100, 1000),
        createCandle(95, 95, 95, 95, 2000),
        createCandle(85, 85, 84, 85, 3000),
        createCandle(75, 75, 74, 75, 4000),
        createCandle(70, 70, 69, 70, 5000),
        createCandle(68, 68, 68, 68, 6000),
        createCandle(70, 71, 70, 70, 7000), // c6: RSI is in zone
        createCandle(75, 82, 74, 75, 8000), // c7: fresh cross up -> BUY
        createCandle(77, 85, 76, 78, 9000), // c8: tenkan still above kijun, but NO cross -> HOLD
      ];

      const signalCross = strategy.analyze(candles, 7);
      expect(signalCross.action).toBe('BUY');

      const signalStateOnly = strategy.analyze(candles, 8);
      expect(signalStateOnly.action).toBe('HOLD');
    });

    it('should generate SELL signal on TK cross down with RSI inside [60, 80]', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiSellMin: 60,
        rsiSellMax: 80,
        rsiLookback: 5,
      });

      // Price rises, RSI hits 68.9 on candle 6, then candle 7 low drops and Tenkan crosses down
      const candles: Candle[] = [
        createCandle(50, 50, 50, 50, 1000),
        createCandle(55, 55, 55, 55, 2000),
        createCandle(65, 65, 66, 65, 3000),
        createCandle(75, 75, 76, 75, 4000),
        createCandle(80, 80, 80, 80, 5000),
        createCandle(82, 82, 82, 82, 6000),
        createCandle(80, 80, 79, 80, 7000), // c6: RSI = 68.9 in [60, 80]
        createCandle(75, 76, 68, 75, 8000), // c7: TK cross down
      ];

      const signal = strategy.analyze(candles, 7);
      expect(signal.action).toBe('SELL');
      expect(signal.reason).toContain('Ichimoku TK cross down');
      expect(signal.metadata?.rsiHitIndex).toBe(6);
    });

    it('should strictly evaluate same-candle only when rsiLookback = 1', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 1, // Only current candle
      });

      // c6: RSI is in zone (31.1), but TK cross happens at c7 where RSI is 73.0 (out of zone)
      const candles: Candle[] = [
        createCandle(100, 100, 100, 100, 1000),
        createCandle(95, 95, 95, 95, 2000),
        createCandle(85, 85, 84, 85, 3000),
        createCandle(75, 75, 74, 75, 4000),
        createCandle(70, 70, 69, 70, 5000),
        createCandle(68, 68, 68, 68, 6000),
        createCandle(70, 71, 70, 70, 7000),
        createCandle(75, 82, 74, 75, 8000),
      ];

      const sig = strategy.analyze(candles, 7);
      expect(sig.action).toBe('HOLD');
    });

    it('should have NO look-ahead: appending future candles never changes earlier signals', () => {
      const strategy = new IchimokuRsiStrategy({
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 2,
        rsiPeriod: 2,
        rsiBuyMin: 20,
        rsiBuyMax: 40,
        rsiLookback: 5,
      });

      const baseCandles: Candle[] = [
        createCandle(100, 100, 100, 100, 1000),
        createCandle(95, 95, 95, 95, 2000),
        createCandle(85, 85, 84, 85, 3000),
        createCandle(75, 75, 74, 75, 4000),
        createCandle(70, 70, 69, 70, 5000),
        createCandle(68, 68, 68, 68, 6000),
        createCandle(70, 71, 70, 70, 7000),
        createCandle(75, 82, 74, 75, 8000),
      ];

      const extendedCandles: Candle[] = [
        ...baseCandles,
        createCandle(90, 95, 85, 92, 9000),
        createCandle(85, 88, 70, 72, 10000),
        createCandle(60, 65, 55, 58, 11000),
      ];

      for (let i = 0; i < baseCandles.length; i++) {
        const signalBase = strategy.analyze(baseCandles, i);
        const signalExtended = strategy.analyze(extendedCandles, i);

        expect(signalBase.action).toBe(signalExtended.action);
        expect(signalBase.reason).toBe(signalExtended.reason);
        if (signalBase.metadata && signalExtended.metadata) {
          expect(signalBase.metadata.tenkan).toBe(signalExtended.metadata.tenkan);
          expect(signalBase.metadata.kijun).toBe(signalExtended.metadata.kijun);
          expect(signalBase.metadata.rsi).toBe(signalExtended.metadata.rsi);
        }
      }
    });

    describe('TK Equality and Plateau Handling (A2)', () => {
      it('should handle equality plateau between two candles then fire real cross once on first candle of new side', () => {
        const strategy = new IchimokuRsiStrategy({
          tenkan: 2,
          kijun: 4,
          senkouB: 6,
          displacement: 2,
          rsiPeriod: 2,
          rsiBuyMin: 40,
          rsiBuyMax: 55,
          rsiSellMin: 60,
          rsiSellMax: 80,
          rsiLookback: 5,
        });

        // i=5: diff = -10 (tenkan < kijun)
        // i=6: diff = -5 (tenkan < kijun)
        // i=7..10: diff = 0 (tenkan === kijun plateau)
        // i=11: diff = +10 (tenkan > kijun breakout)
        // i=12: diff = +10 (tenkan > kijun continuation)
        const candles: Candle[] = [
          createCandle(50, 100, 50, 50, 1000),  // 0
          createCandle(50, 90, 50, 50, 2000),   // 1
          createCandle(50, 80, 50, 50, 3000),   // 2
          createCandle(50, 70, 50, 50, 4000),   // 3
          createCandle(50, 60, 50, 50, 5000),   // 4
          createCandle(50, 60, 50, 50, 6000),   // 5
          createCandle(50, 60, 50, 50, 7000),   // 6
          createCandle(50, 60, 50, 50, 8000),   // 7
          createCandle(50, 80, 50, 50, 9000),   // 8
          createCandle(50, 80, 50, 50, 10000),  // 9
          createCandle(50, 80, 70, 75, 11000),  // 10
          createCandle(50, 80, 70, 75, 12000),  // 11: breakout -> BUY
          createCandle(50, 80, 70, 75, 13000),  // 12: continuation -> HOLD
        ];

        expect(strategy.analyze(candles, 9).action).toBe('HOLD');
        expect(strategy.analyze(candles, 10).action).toBe('HOLD');
        expect(strategy.analyze(candles, 11).action).toBe('BUY');
        expect(strategy.analyze(candles, 12).action).toBe('HOLD');
      });

      it('should not fire a signal on equality plateau without changing side', () => {
        const strategy = new IchimokuRsiStrategy({
          tenkan: 2,
          kijun: 4,
          senkouB: 6,
          displacement: 2,
          rsiPeriod: 2,
          rsiBuyMin: 40,
          rsiBuyMax: 55,
          rsiSellMin: 60,
          rsiSellMax: 80,
          rsiLookback: 5,
        });

        // Sequence where relation is +1, then 0, 0, then +1 again
        const candles: Candle[] = [
          createCandle(50, 50, 50, 50, 1000),
          createCandle(50, 60, 50, 50, 2000),
          createCandle(50, 70, 50, 50, 3000),
          createCandle(50, 80, 50, 50, 4000),
          createCandle(50, 90, 70, 50, 5000), // tenkan > kijun (+1)
          createCandle(50, 90, 70, 50, 6000), // tenkan > kijun (+1)
          createCandle(50, 90, 50, 50, 7000), // tenkan === kijun (0)
          createCandle(50, 90, 50, 50, 8000), // tenkan === kijun (0)
          createCandle(50, 90, 70, 50, 9000), // tenkan > kijun (+1, but side did not change)
        ];

        // Should NOT emit BUY on candle 8 or 9 because previous non-zero relation was already +1
        expect(strategy.analyze(candles, 7).action).toBe('HOLD');
        expect(strategy.analyze(candles, 8).action).toBe('HOLD');
      });

      it('should not emit repeated signals when flapping equal/greater/equal/greater', () => {
        const strategy = new IchimokuRsiStrategy({
          tenkan: 2,
          kijun: 4,
          senkouB: 6,
          displacement: 2,
          rsiPeriod: 2,
          rsiBuyMin: 40,
          rsiBuyMax: 55,
          rsiSellMin: 60,
          rsiSellMax: 80,
          rsiLookback: 5,
        });

        // Sequence: negative, then cross up (+1, fires once on candle 7), then 0, 0, +1
        const candles: Candle[] = [
          createCandle(50, 100, 50, 50, 1000),
          createCandle(50, 90, 50, 50, 2000),
          createCandle(50, 80, 50, 50, 3000),
          createCandle(50, 70, 50, 50, 4000),
          createCandle(50, 60, 50, 50, 5000),
          createCandle(50, 60, 50, 50, 6000),  // 5: tenkan < kijun (-1)
          createCandle(50, 80, 70, 50, 7000),  // 6: equal (0)
          createCandle(50, 80, 70, 50, 8000),  // 7: tenkan > kijun (+1, initial cross up -> BUY)
          createCandle(50, 60, 50, 50, 9000),  // 8: equal (0)
          createCandle(50, 80, 70, 50, 10000), // 9: equal (0)
          createCandle(50, 80, 70, 50, 11000), // 10: greater (+1, flapping without changing side -> HOLD)
        ];

        expect(strategy.analyze(candles, 6).action).toBe('HOLD');
        expect(strategy.analyze(candles, 7).action).toBe('BUY');
        expect(strategy.analyze(candles, 8).action).toBe('HOLD');
        expect(strategy.analyze(candles, 9).action).toBe('HOLD');
        expect(strategy.analyze(candles, 10).action).toBe('HOLD');
      });
    });
  });
});
