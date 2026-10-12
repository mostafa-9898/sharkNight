import { mean, standardDeviation, roundTo, percentChange, percentile } from '@/utils/math';

describe('Math Utilities', () => {
  describe('mean', () => {
    it('should calculate the mean of an array of numbers', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });

    it('should return 0 for an empty array', () => {
      expect(mean([])).toBe(0);
    });

    it('should return the number itself for a single element', () => {
      expect(mean([42])).toBe(42);
    });
  });

  describe('standardDeviation', () => {
    it('should calculate standard deviation correctly', () => {
      const result = standardDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.0, 1);
    });

    it('should return 0 for arrays with fewer than 2 elements', () => {
      expect(standardDeviation([])).toBe(0);
      expect(standardDeviation([5])).toBe(0);
    });
  });

  describe('roundTo', () => {
    it('should round to specified decimal places', () => {
      expect(roundTo(3.14159, 2)).toBe(3.14);
      expect(roundTo(3.14159, 4)).toBe(3.1416);
      expect(roundTo(3.14159, 0)).toBe(3);
    });
  });

  describe('percentChange', () => {
    it('should calculate percentage change correctly', () => {
      expect(percentChange(100, 150)).toBe(50);
      expect(percentChange(100, 50)).toBe(-50);
      expect(percentChange(200, 200)).toBe(0);
    });

    it('should return 0 when initial value is 0', () => {
      expect(percentChange(0, 100)).toBe(0);
    });
  });

  describe('percentile', () => {
    it('should return 0 for empty array', () => {
      expect(percentile([], 50)).toBe(0);
    });

    it('should return the element for single element array', () => {
      expect(percentile([10], 50)).toBe(10);
      expect(percentile([10], 90)).toBe(10);
    });

    it('should calculate median (p50), p75, p90 accurately', () => {
      const vals = [10, 20, 30, 40, 50];
      expect(percentile(vals, 0)).toBe(10);
      expect(percentile(vals, 50)).toBe(30);
      expect(percentile(vals, 100)).toBe(50);
      expect(percentile(vals, 25)).toBe(20);
      expect(percentile(vals, 75)).toBe(40);
    });

    it('should interpolate linearly between ranks', () => {
      const vals = [10, 20];
      expect(percentile(vals, 50)).toBe(15);
      expect(percentile(vals, 75)).toBe(17.5);
    });
  });
});

