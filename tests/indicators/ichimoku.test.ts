import { calculateIchimoku, IchimokuIndicator } from '@/indicators/ichimoku';
import type { Candle } from '@/data/models';

describe('Ichimoku Indicator', () => {
  const createCandle = (high: number, low: number, close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: (high + low) / 2,
    high,
    low,
    close,
    volume: 100,
  });

  describe('calculateIchimoku', () => {
    it('should compute exact hand-calculated values on small synthetic series', () => {
      // 8 candles:
      // c0: h=10, l=8, c=9
      // c1: h=12, l=6, c=11
      // c2: h=14, l=10, c=13
      // c3: h=16, l=12, c=15
      // c4: h=18, l=14, c=17
      // c5: h=20, l=16, c=19
      // c6: h=22, l=18, c=21
      // c7: h=24, l=20, c=23
      const candles: Candle[] = [
        createCandle(10, 8, 9, 1000),
        createCandle(12, 6, 11, 2000),
        createCandle(14, 10, 13, 3000),
        createCandle(16, 12, 15, 4000),
        createCandle(18, 14, 17, 5000),
        createCandle(20, 16, 19, 6000),
        createCandle(22, 18, 21, 7000),
        createCandle(24, 20, 23, 8000),
      ];

      const config = {
        tenkan: 2,
        kijun: 4,
        senkouB: 6,
        displacement: 3,
      };

      const result = calculateIchimoku(candles, config);

      // Verify array lengths
      expect(result.tenkan).toHaveLength(8);
      expect(result.kijun).toHaveLength(8);
      expect(result.chikou).toHaveLength(8);
      expect(result.senkouA).toHaveLength(8 + 3);
      expect(result.senkouB).toHaveLength(8 + 3);

      // Tenkan (period 2):
      // i=0: NaN
      // i=1: (max(10,12)+min(8,6))/2 = (12+6)/2 = 9 (proves high/low used: close would give 10)
      // i=2: (max(12,14)+min(6,10))/2 = (14+6)/2 = 10
      // i=3: (max(14,16)+min(10,12))/2 = (16+10)/2 = 13
      // i=4: (18+12)/2 = 15
      // i=5: (20+14)/2 = 17
      // i=6: (22+16)/2 = 19
      // i=7: (24+18)/2 = 21
      expect(Number.isNaN(result.tenkan[0])).toBe(true);
      expect(result.tenkan[1]).toBe(9);
      expect(result.tenkan[2]).toBe(10);
      expect(result.tenkan[3]).toBe(13);
      expect(result.tenkan[4]).toBe(15);
      expect(result.tenkan[5]).toBe(17);
      expect(result.tenkan[6]).toBe(19);
      expect(result.tenkan[7]).toBe(21);

      // Kijun (period 4):
      // i=0..2: NaN
      // i=3: candles 0..3: high max(10,12,14,16)=16, low min(8,6,10,12)=6 => 11
      // i=4: candles 1..4: high max(12,14,16,18)=18, low min(6,10,12,14)=6 => 12
      // i=5: candles 2..5: high max(14,16,18,20)=20, low min(10,12,14,16)=10 => 15
      // i=6: candles 3..6: high max(16,18,20,22)=22, low min(12,14,16,18)=12 => 17
      // i=7: candles 4..7: high max(18,20,22,24)=24, low min(14,16,18,20)=14 => 19
      expect(Number.isNaN(result.kijun[0])).toBe(true);
      expect(Number.isNaN(result.kijun[1])).toBe(true);
      expect(Number.isNaN(result.kijun[2])).toBe(true);
      expect(result.kijun[3]).toBe(11);
      expect(result.kijun[4]).toBe(12);
      expect(result.kijun[5]).toBe(15);
      expect(result.kijun[6]).toBe(17);
      expect(result.kijun[7]).toBe(19);

      // Senkou A: rawSenkouA = (tenkan + kijun)/2 shifted forward by displacement (3)
      // Raw at i=3: (13 + 11)/2 = 12 => placed at idx 3 + 3 = 6
      // Raw at i=4: (15 + 12)/2 = 13.5 => placed at idx 7
      // Raw at i=5: (17 + 15)/2 = 16 => placed at idx 8
      // Raw at i=6: (19 + 17)/2 = 18 => placed at idx 9
      // Raw at i=7: (21 + 19)/2 = 20 => placed at idx 10
      for (let idx = 0; idx < 6; idx++) {
        expect(Number.isNaN(result.senkouA[idx])).toBe(true);
      }
      expect(result.senkouA[6]).toBe(12);
      expect(result.senkouA[7]).toBe(13.5);
      expect(result.senkouA[8]).toBe(16);
      expect(result.senkouA[9]).toBe(18);
      expect(result.senkouA[10]).toBe(20);

      // Senkou B: rawSenkouB (period 6) shifted forward by displacement (3)
      // i=0..4: NaN
      // i=5: candles 0..5 => high max=20, low min=6 => (20+6)/2 = 13 => placed at idx 5 + 3 = 8
      // i=6: candles 1..6 => high max=22, low min=6 => (22+6)/2 = 14 => placed at idx 9
      // i=7: candles 2..7 => high max=24, low min=10 => (24+10)/2 = 17 => placed at idx 10
      for (let idx = 0; idx < 8; idx++) {
        expect(Number.isNaN(result.senkouB[idx])).toBe(true);
      }
      expect(result.senkouB[8]).toBe(13);
      expect(result.senkouB[9]).toBe(14);
      expect(result.senkouB[10]).toBe(17);

      // Chikou: candle[i+displacement].close
      // i=0: c3.close = 15
      // i=1: c4.close = 17
      // i=2: c5.close = 19
      // i=3: c6.close = 21
      // i=4: c7.close = 23
      // i=5,6,7 (last 3 = displacement): NaN
      expect(result.chikou[0]).toBe(15);
      expect(result.chikou[1]).toBe(17);
      expect(result.chikou[2]).toBe(19);
      expect(result.chikou[3]).toBe(21);
      expect(result.chikou[4]).toBe(23);
      expect(Number.isNaN(result.chikou[5])).toBe(true);
      expect(Number.isNaN(result.chikou[6])).toBe(true);
      expect(Number.isNaN(result.chikou[7])).toBe(true);
    });

    it('should produce equal lines on a constant series once warmed up', () => {
      const constantCandles = Array.from({ length: 60 }, (_, i) =>
        createCandle(50, 50, 50, 1000 + i * 60000)
      );

      const result = calculateIchimoku(constantCandles, {
        tenkan: 9,
        kijun: 26,
        senkouB: 52,
        displacement: 26,
      });

      // Warmup check:
      expect(Number.isNaN(result.tenkan[7])).toBe(true);
      expect(result.tenkan[8]).toBe(50);
      expect(Number.isNaN(result.kijun[24])).toBe(true);
      expect(result.kijun[25]).toBe(50);

      // Fully warmed up check (at index 55)
      expect(result.tenkan[55]).toBe(50);
      expect(result.kijun[55]).toBe(50);
      expect(result.senkouA[55]).toBe(50);
      expect(Number.isNaN(result.senkouB[76])).toBe(true);
      expect(result.senkouB[77]).toBe(50);
      expect(result.senkouB[85]).toBe(50);
      expect(result.chikou[0]).toBe(50);
    });

    it('should return empty arrays for empty candle input', () => {
      const result = calculateIchimoku([], { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 });
      expect(result.tenkan).toEqual([]);
      expect(result.kijun).toEqual([]);
      expect(result.chikou).toEqual([]);
      expect(result.senkouA).toHaveLength(26);
      expect(result.senkouB).toHaveLength(26);
    });

    it('should validate parameter ordering: tenkan < kijun < senkouB', () => {
      const candles = [createCandle(10, 5, 8)];
      expect(() =>
        calculateIchimoku(candles, { tenkan: 26, kijun: 9, senkouB: 52, displacement: 26 })
      ).toThrow('Parameters must satisfy tenkan');

      expect(() =>
        calculateIchimoku(candles, { tenkan: 9, kijun: 52, senkouB: 26, displacement: 26 })
      ).toThrow('Parameters must satisfy tenkan');
    });

    it('should validate positive integer parameters', () => {
      const candles = [createCandle(10, 5, 8)];
      expect(() =>
        calculateIchimoku(candles, { tenkan: 0, kijun: 26, senkouB: 52, displacement: 26 })
      ).toThrow();
      expect(() =>
        calculateIchimoku(candles, { tenkan: 9.5, kijun: 26, senkouB: 52, displacement: 26 })
      ).toThrow();
    });
  });

  describe('IchimokuIndicator Class', () => {
    it('should wrap calculateIchimoku and provide correct metadata', () => {
      const indicator = new IchimokuIndicator({
        tenkan: 9,
        kijun: 26,
        senkouB: 52,
        displacement: 26,
      });

      expect(indicator.name).toBe('Ichimoku_9_26_52_26');
      expect(indicator.requiredPeriod).toBe(52);

      const candles = Array.from({ length: 60 }, (_, i) =>
        createCandle(50, 50, 50, 1000 + i * 60000)
      );
      const res = indicator.calculate(candles);
      expect(res.values).toBeDefined();
      expect(res.lines?.tenkan).toBeDefined();
      expect(res.lines?.kijun).toBeDefined();
      expect(res.lines?.senkouA).toBeDefined();
      expect(res.lines?.senkouB).toBeDefined();
      expect(res.lines?.chikou).toBeDefined();
    });
  });
});
