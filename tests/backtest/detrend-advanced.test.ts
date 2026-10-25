import { detrendCandlesCausalPastOnly, stationaryBlockBootstrap, mulberry32 } from '../../src/backtest/detrend-advanced';
import type { Candle } from '../../src/data/models';

function createMockCandles(count: number, trend = 0.001): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  const startTime = 1609459200000; // 2021-01-01
  const ms1h = 3600 * 1000;

  for (let i = 0; i < count; i++) {
    const ret = trend + (Math.sin(i / 10) * 0.005);
    const prev = price;
    price = price * Math.exp(ret);
    const open = prev;
    const close = price;
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    candles.push({
      timestamp: startTime + i * ms1h,
      open,
      high,
      low,
      close,
      volume: 1000,
    });
  }
  return candles;
}

describe('Advanced Detrending & Stationary Block Bootstrap (D2, D3, D4)', () => {
  const candles = createMockCandles(1000, 0.002);

  describe('D2: Causal Past-Only Detrending', () => {
    it('is strictly causal: mutating future candles does not affect earlier detrended candles', () => {
      const dFull = detrendCandlesCausalPastOnly(candles, 30);
      const prefix = candles.slice(0, 500);
      const dPrefix = detrendCandlesCausalPastOnly(prefix, 30);

      expect(dPrefix.length).toBe(500);
      for (let i = 0; i < 500; i++) {
        expect(dPrefix[i].close).toBeCloseTo(dFull[i].close, 2);
        expect(dPrefix[i].open).toBeCloseTo(dFull[i].open, 2);
      }
    });

    it('reduces upward drift over time', () => {
      const d = detrendCandlesCausalPastOnly(candles, 30);
      const origTotalRet = (candles[candles.length - 1].close - candles[0].close) / candles[0].close;
      const detrendTotalRet = (d[d.length - 1].close - d[0].close) / d[0].close;
      expect(detrendTotalRet).toBeLessThan(origTotalRet);
    });
  });

  describe('D3 & D4: Stationary Block Bootstrap', () => {
    it('produces valid OHLC invariants for every candle (low <= open, close <= high)', () => {
      const rng = mulberry32(42);
      const boot = stationaryBlockBootstrap(candles, 20, false, rng);

      expect(boot.length).toBe(candles.length);
      for (let i = 0; i < boot.length; i++) {
        expect(boot[i].low).toBeLessThanOrEqual(boot[i].open + 1e-4);
        expect(boot[i].low).toBeLessThanOrEqual(boot[i].close + 1e-4);
        expect(boot[i].high).toBeGreaterThanOrEqual(boot[i].open - 1e-4);
        expect(boot[i].high).toBeGreaterThanOrEqual(boot[i].close - 1e-4);
      }
    });

    it('D4 zero-drift mode produces near-zero cumulative log return across many paths', () => {
      let cumulativeRetSum = 0;
      const numPaths = 50;
      for (let p = 0; p < numPaths; p++) {
        const rng = mulberry32(100 + p);
        const boot = stationaryBlockBootstrap(candles, 20, true, rng);
        const logRet = Math.log(boot[boot.length - 1].close / boot[0].close);
        cumulativeRetSum += logRet;
      }
      const avgLogRet = cumulativeRetSum / numPaths;
      // Should be centered around 0
      expect(Math.abs(avgLogRet)).toBeLessThan(0.08);
    });

    it('is deterministic with same seed', () => {
      const rng1 = mulberry32(999);
      const boot1 = stationaryBlockBootstrap(candles, 20, false, rng1);

      const rng2 = mulberry32(999);
      const boot2 = stationaryBlockBootstrap(candles, 20, false, rng2);

      for (let i = 0; i < boot1.length; i++) {
        expect(boot1[i].close).toBe(boot2[i].close);
      }
    });
  });
});
