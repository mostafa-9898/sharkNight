import type { Candle } from '../../src/data/models';
import {
  CANDLE_PATTERN_DETECTORS,
  detectP1Pin,
  detectP2PinAtLevel,
  detectP3Engulfing,
  detectP4PiercingDarkCloud,
  detectP5Harami,
  detectP6Tweezers,
  detectP7InsideBarBreakout,
  detectP8OutsideBar,
  detectP9Stars,
  detectP10ThreeSoldiersCrows,
  detectP11MarubozuSqueeze,
  detectP12DojiAtLevel,
  detectP13LiquiditySweep,
  detectP14Fakey,
  type StructuralLevels,
} from '../../src/indicators/candle-patterns';

describe('Candlestick Patterns Suite (CN1: P1 to P14)', () => {
  const dummyAtr = [10, 10, 10, 10, 10];

  describe('P1: Hammer / Shooting Star', () => {
    it('detects valid Bullish Hammer (positive) and rejects near-boundary wick (negative)', () => {
      // Positive: range 10, open 108, close 109 (body 1), low 100 (lowerWick 8), high 110 (upperWick 1)
      // lowerWick 8 >= 2*body(2) && lowerWickRatio 0.8 >= 0.60 && upperWickRatio 0.1 <= 0.15
      const candlesPos: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
        { timestamp: 2000, open: 108, high: 110, low: 100, close: 109, volume: 100 },
      ];
      const resPos = detectP1Pin(candlesPos, 1, [10, 10]);
      expect(resPos.bull).toBe(true);
      expect(resPos.bear).toBe(false);

      // Negative boundary: lowerWickRatio 0.55 < 0.60 (e.g. open 105, close 107, low 100, high 110 -> lowerWick 5/10 = 0.5)
      const candlesNeg: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
        { timestamp: 2000, open: 105, high: 110, low: 100, close: 107, volume: 100 },
      ];
      const resNeg = detectP1Pin(candlesNeg, 1, [10, 10]);
      expect(resNeg.bull).toBe(false);
      expect(resNeg.bear).toBe(false);
    });

    it('detects valid Bearish Shooting Star', () => {
      // open 102, close 101 (body 1), high 110 (upperWick 8), low 100 (lowerWick 1)
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
        { timestamp: 2000, open: 102, high: 110, low: 100, close: 101, volume: 100 },
      ];
      const res = detectP1Pin(candles, 1, [10, 10]);
      expect(res.bear).toBe(true);
      expect(res.bull).toBe(false);
    });
  });

  describe('P2: Pin Bar at Level', () => {
    it('detects pin bar near structural level and rejects pin bar far from level', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
        { timestamp: 2000, open: 108, high: 110, low: 100, close: 109, volume: 100 },
      ];
      // Near level: kijun = 110 -> dist = |109 - 110| = 1 <= 0.5 * 10 (5)
      const levelsNear: StructuralLevels = { kijun: 110 };
      expect(detectP2PinAtLevel(candles, 1, [10, 10], levelsNear).bull).toBe(true);

      // Far level: kijun = 130 -> dist = 21 > 5
      const levelsFar: StructuralLevels = { kijun: 130 };
      expect(detectP2PinAtLevel(candles, 1, [10, 10], levelsFar).bull).toBe(false);
    });
  });

  describe('P3: Engulfing', () => {
    it('detects Bullish Engulfing and rejects boundary body coverage', () => {
      // Prev bear: open 105, close 102. Cur bull: open 101, close 108 (covers 102..105 completely, body 7 >= 0.6*range 8)
      const candlesPos: Candle[] = [
        { timestamp: 1000, open: 105, high: 106, low: 101, close: 102, volume: 100 },
        { timestamp: 2000, open: 101, high: 109, low: 101, close: 108, volume: 100 },
      ];
      expect(detectP3Engulfing(candlesPos, 1, [8, 8]).bull).toBe(true);

      // Negative: bodyRatio < 0.60 (e.g. range 20, body 8 -> ratio 0.4)
      const candlesNeg: Candle[] = [
        { timestamp: 1000, open: 105, high: 106, low: 101, close: 102, volume: 100 },
        { timestamp: 2000, open: 101, high: 120, low: 100, close: 108, volume: 100 },
      ];
      expect(detectP3Engulfing(candlesNeg, 1, [8, 8]).bull).toBe(false);
    });
  });

  describe('P4: Piercing Line / Dark Cloud', () => {
    it('detects Piercing Line and Dark Cloud Cover', () => {
      // Piercing: prev bear (110 -> 100, mid=105). Cur bull: open 99 <= 100, close 107 > 105 and <= 110
      const candlesBull: Candle[] = [
        { timestamp: 1000, open: 110, high: 111, low: 99, close: 100, volume: 100 },
        { timestamp: 2000, open: 99, high: 108, low: 98, close: 107, volume: 100 },
      ];
      expect(detectP4PiercingDarkCloud(candlesBull, 1, [10, 10]).bull).toBe(true);

      // Dark Cloud: prev bull (100 -> 110, mid=105). Cur bear: open 111 >= 110, close 103 < 105 and >= 100
      const candlesBear: Candle[] = [
        { timestamp: 1000, open: 100, high: 111, low: 99, close: 110, volume: 100 },
        { timestamp: 2000, open: 111, high: 112, low: 102, close: 103, volume: 100 },
      ];
      expect(detectP4PiercingDarkCloud(candlesBear, 1, [10, 10]).bear).toBe(true);
    });
  });

  describe('P5: Harami', () => {
    it('detects Harami and rejects when body is outside prior body', () => {
      // Prev bear (110 -> 100, body=10, range=12, bodyRatio=0.83). Cur bull: 102 -> 106 (inside 100..110)
      const candlesPos: Candle[] = [
        { timestamp: 1000, open: 110, high: 111, low: 99, close: 100, volume: 100 },
        { timestamp: 2000, open: 102, high: 107, low: 101, close: 106, volume: 100 },
      ];
      expect(detectP5Harami(candlesPos, 1, [10, 10]).bull).toBe(true);

      // Outside: close 112 > 110
      const candlesNeg: Candle[] = [
        { timestamp: 1000, open: 110, high: 111, low: 99, close: 100, volume: 100 },
        { timestamp: 2000, open: 102, high: 113, low: 101, close: 112, volume: 100 },
      ];
      expect(detectP5Harami(candlesNeg, 1, [10, 10]).bull).toBe(false);
    });
  });

  describe('P6: Tweezers', () => {
    it('detects Tweezer Bottom when lows match within 0.1 ATR', () => {
      // ATR = 10, 0.1 ATR = 1.0. Prev low = 100.0, Cur low = 100.5 -> diff 0.5 <= 1.0
      const candles: Candle[] = [
        { timestamp: 1000, open: 110, high: 112, low: 100.0, close: 102, volume: 100 },
        { timestamp: 2000, open: 103, high: 110, low: 100.5, close: 108, volume: 100 },
      ];
      expect(detectP6Tweezers(candles, 1, [10, 10]).bull).toBe(true);
    });
  });

  describe('P7: Inside Bar Breakout', () => {
    it('detects breakout of mother bar', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 120, low: 90, close: 110, volume: 100 }, // mother
        { timestamp: 2000, open: 105, high: 115, low: 95, close: 108, volume: 100 }, // inside
        { timestamp: 3000, open: 110, high: 125, low: 108, close: 122, volume: 100 }, // breaks mother high 120
      ];
      expect(detectP7InsideBarBreakout(candles, 2).bull).toBe(true);
    });
  });

  describe('P8: Outside Bar', () => {
    it('detects Outside bar closing in top 25% of range', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 110, low: 95, close: 105, volume: 100 },
        { timestamp: 2000, open: 98, high: 120, low: 90, close: 118, volume: 100 }, // range 30, close 118 in top 25% (>= 112.5)
      ];
      expect(detectP8OutsideBar(candles, 1, [15, 15]).bull).toBe(true);
    });
  });

  describe('P9: Morning / Evening Star', () => {
    it('detects Morning Star 3-candle pattern', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 110, high: 111, low: 99, close: 100, volume: 100 }, // c1 bear
        { timestamp: 2000, open: 98, high: 99, low: 97, close: 98, volume: 100 },    // c2 small
        { timestamp: 3000, open: 99, high: 108, low: 98, close: 106, volume: 100 },   // c3 bull >= mid 105
      ];
      expect(detectP9Stars(candles, 2, [10, 10, 10]).bull).toBe(true);
    });
  });

  describe('P10: Three White Soldiers / Three Black Crows', () => {
    it('detects Three White Soldiers', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 106, low: 99, close: 105, volume: 100 },
        { timestamp: 2000, open: 104, high: 111, low: 103, close: 110, volume: 100 },
        { timestamp: 3000, open: 109, high: 116, low: 108, close: 115, volume: 100 },
      ];
      expect(detectP10ThreeSoldiersCrows(candles, 2, [5, 5, 5]).bull).toBe(true);
    });
  });

  describe('P11: Marubozu after Squeeze', () => {
    it('detects strong Marubozu after 3 compressed candles', () => {
      // ATR = 10, 0.7 ATR = 7.0
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 103, low: 99, close: 102, volume: 100 }, // range 4
        { timestamp: 2000, open: 102, high: 105, low: 101, close: 103, volume: 100 }, // range 4
        { timestamp: 3000, open: 103, high: 106, low: 102, close: 104, volume: 100 }, // range 4
        { timestamp: 4000, open: 104, high: 120, low: 104, close: 119, volume: 100 }, // range 16, body 15 (ratio 0.93)
      ];
      expect(detectP11MarubozuSqueeze(candles, 3, [10, 10, 10, 10]).bull).toBe(true);
    });
  });

  describe('P12: Doji at Level with Confirmation', () => {
    it('detects Doji at level confirmed on next bar', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 105, low: 95, close: 100.2, volume: 100 }, // Doji at 100
        { timestamp: 2000, open: 101, high: 110, low: 100, close: 108, volume: 100 },   // Closes above high 105
      ];
      const levels: StructuralLevels = { kijun: 100 };
      expect(detectP12DojiAtLevel(candles, 1, [10, 10], levels).bull).toBe(true);
    });
  });

  describe('P13: Liquidity Sweep', () => {
    it('detects sweep below swing low closing back inside', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 105, high: 115, low: 90, close: 108, volume: 100 }, // low 90 < swingLow 95, close 108 > 95
      ];
      const levels: StructuralLevels = { lastSwingLow: 95 };
      expect(detectP13LiquiditySweep(candles, 0, [10], levels).bull).toBe(true);
    });
  });

  describe('P14: Fakey', () => {
    it('detects inside bar false breakout', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 120, low: 90, close: 110, volume: 100 }, // mother (90..120)
        { timestamp: 2000, open: 105, high: 115, low: 95, close: 108, volume: 100 }, // inside (95..115)
        { timestamp: 3000, open: 96, high: 108, low: 88, close: 98, volume: 100 },   // sweeps low 88 < 90, closes 98 > 90
      ];
      expect(detectP14Fakey(candles, 2).bull).toBe(true);
    });
  });

  describe('Mathematical Invariants: Mirror Symmetry & No-Lookahead', () => {
    it('preserves mirror symmetry (P0^2 / P transforms bullish signals to bearish signals)', () => {
      const p0 = 100;
      // Hammer candle: open 108, close 109, low 100, high 110
      const orig: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
        { timestamp: 2000, open: 108, high: 110, low: 100, close: 109, volume: 100 },
      ];
      // Invert: P' = 10000 / P.
      // High becomes 10000 / low = 10000 / 100 = 100.
      // Low becomes 10000 / high = 10000 / 110 = 90.91.
      // Open becomes 10000 / 108 = 92.59.
      // Close becomes 10000 / 109 = 91.74.
      // This inverted candle has a huge upper wick (100 - 92.59 = 7.41) and tiny lower wick (91.74 - 90.91 = 0.83) -> Shooting Star!
      const inverted: Candle[] = orig.map((c) => ({
        timestamp: c.timestamp,
        open: (p0 * p0) / c.open,
        close: (p0 * p0) / c.close,
        high: (p0 * p0) / c.low,
        low: (p0 * p0) / c.high,
        volume: c.volume,
      }));

      const resOrig = detectP1Pin(orig, 1, [10, 10]);
      const resInv = detectP1Pin(inverted, 1, [10, 10]);

      expect(resOrig.bull).toBe(true);
      expect(resInv.bear).toBe(true);
    });

    it('guarantees no-lookahead: truncating future candles has zero effect on output at index i', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 100, high: 120, low: 90, close: 110, volume: 100 },
        { timestamp: 2000, open: 105, high: 115, low: 95, close: 108, volume: 100 },
        { timestamp: 3000, open: 110, high: 125, low: 108, close: 122, volume: 100 },
        { timestamp: 4000, open: 150, high: 200, low: 140, close: 190, volume: 1000 }, // future candle
      ];

      const resFull = detectP7InsideBarBreakout(candles, 2);
      const resTruncated = detectP7InsideBarBreakout(candles.slice(0, 3), 2);

      expect(resFull).toEqual(resTruncated);
    });

    it('safely handles zero-range and degenerate candles without throwing or producing NaN', () => {
      const degenCandles: Candle[] = [
        { timestamp: 1000, open: 100, high: 100, low: 100, close: 100, volume: 0 },
        { timestamp: 2000, open: 100, high: 100, low: 100, close: 100, volume: 0 },
      ];

      for (const key of Object.keys(CANDLE_PATTERN_DETECTORS)) {
        const detector = CANDLE_PATTERN_DETECTORS[key];
        expect(() => detector(degenCandles, 1)).not.toThrow();
        const res = detector(degenCandles, 1);
        expect(typeof res.bull).toBe('boolean');
        expect(typeof res.bear).toBe('boolean');
      }
    });
  });
});
