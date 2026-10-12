import {
  isValidCandle,
  areValidCandles,
  sortCandles,
  deduplicateCandles,
  getIntervalMs,
  performCandleSanityCheck,
  type Candle,
} from '@/data/models/candle';

describe('Candle Model & Utilities', () => {
  const validCandle: Candle = {
    timestamp: 1700000000000,
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    volume: 1500,
  };

  describe('isValidCandle', () => {
    it('should return true for a well-formed candle', () => {
      expect(isValidCandle(validCandle)).toBe(true);
    });

    it('should return false for null, undefined, or non-object values', () => {
      expect(isValidCandle(null)).toBe(false);
      expect(isValidCandle(undefined)).toBe(false);
      expect(isValidCandle('candle')).toBe(false);
      expect(isValidCandle(123)).toBe(false);
    });

    it('should return false if timestamp is invalid or non-positive', () => {
      expect(isValidCandle({ ...validCandle, timestamp: 0 })).toBe(false);
      expect(isValidCandle({ ...validCandle, timestamp: -1 })).toBe(false);
      expect(isValidCandle({ ...validCandle, timestamp: NaN })).toBe(false);
    });

    it('should return false if any numeric field is missing or negative', () => {
      expect(isValidCandle({ ...validCandle, open: -10 })).toBe(false);
      expect(isValidCandle({ ...validCandle, high: NaN })).toBe(false);
      expect(isValidCandle({ ...validCandle, volume: -5 })).toBe(false);
    });

    it('should return false when price logical relationships are violated', () => {
      // low > high
      expect(isValidCandle({ ...validCandle, low: 120, high: 110 })).toBe(false);
      // low > open
      expect(isValidCandle({ ...validCandle, low: 102, open: 100 })).toBe(false);
      // low > close
      expect(isValidCandle({ ...validCandle, low: 106, close: 105 })).toBe(false);
      // high < open
      expect(isValidCandle({ ...validCandle, high: 98, open: 100 })).toBe(false);
      // high < close
      expect(isValidCandle({ ...validCandle, high: 103, close: 105 })).toBe(false);
    });
  });

  describe('areValidCandles', () => {
    it('should return true when all elements in array are valid candles', () => {
      const candles: Candle[] = [
        validCandle,
        { ...validCandle, timestamp: 1700000060000, close: 108 },
      ];
      expect(areValidCandles(candles)).toBe(true);
    });

    it('should return true for an empty array', () => {
      expect(areValidCandles([])).toBe(true);
    });

    it('should return false if passed non-array', () => {
      expect(areValidCandles(null)).toBe(false);
      expect(areValidCandles({})).toBe(false);
    });

    it('should return false if any item in the array is invalid', () => {
      const mixed = [validCandle, { ...validCandle, open: -1 }];
      expect(areValidCandles(mixed)).toBe(false);
    });
  });

  describe('sortCandles', () => {
    it('should sort candles in ascending order by timestamp', () => {
      const c1 = { ...validCandle, timestamp: 1000 };
      const c2 = { ...validCandle, timestamp: 2000 };
      const c3 = { ...validCandle, timestamp: 3000 };

      const unsorted = [c3, c1, c2];
      const sorted = sortCandles(unsorted);

      expect(sorted.map((c) => c.timestamp)).toEqual([1000, 2000, 3000]);
    });

    it('should not mutate original array', () => {
      const c1 = { ...validCandle, timestamp: 1000 };
      const c2 = { ...validCandle, timestamp: 2000 };
      const original = [c2, c1];

      sortCandles(original);
      expect(original[0].timestamp).toBe(2000);
    });
  });

  describe('deduplicateCandles', () => {
    it('should eliminate duplicate timestamps keeping the latest occurrence', () => {
      const c1 = { ...validCandle, timestamp: 1000, close: 50 };
      const c1Updated = { ...validCandle, timestamp: 1000, close: 55 };
      const c2 = { ...validCandle, timestamp: 2000, close: 60 };

      const deduplicated = deduplicateCandles([c1, c2, c1Updated]);
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].close).toBe(55);
      expect(deduplicated[1].close).toBe(60);
    });
  });

  describe('getIntervalMs & performCandleSanityCheck', () => {
    it('should return correct milliseconds for intervals', () => {
      expect(getIntervalMs('1m')).toBe(60000);
      expect(getIntervalMs('1h')).toBe(3600000);
      expect(getIntervalMs('4h')).toBe(14400000);
      expect(getIntervalMs('1d')).toBe(86400000);
    });

    it('should return empty check for empty candles array', () => {
      const check = performCandleSanityCheck([], '1h');
      expect(check.candleCount).toBe(0);
      expect(check.firstTimestamp).toBeNull();
      expect(check.lastTimestamp).toBeNull();
      expect(check.gapCount).toBe(0);
    });

    it('should correctly detect min/max close and count gaps', () => {
      const candles: Candle[] = [
        { ...validCandle, timestamp: 1000000, close: 100 },
        { ...validCandle, timestamp: 1000000 + 3600000, close: 90 }, // Normal 1h step
        { ...validCandle, timestamp: 1000000 + 3600000 * 3, close: 120 }, // Gap of 2 hours!
      ];

      const check = performCandleSanityCheck(candles, '1h');
      expect(check.candleCount).toBe(3);
      expect(check.firstTimestamp).toBe(1000000);
      expect(check.lastTimestamp).toBe(1000000 + 3600000 * 3);
      expect(check.minClose).toBe(90);
      expect(check.maxClose).toBe(120);
      expect(check.gapCount).toBe(1);
    });
  });
});

