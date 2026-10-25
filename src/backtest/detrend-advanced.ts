import type { Candle } from '../data/models';
import { roundTo } from '../utils/math';

/**
 * D2: Causal Past-Only Rolling Detrending
 * For each candle i, subtracts the empirical mean log-return of the preceding lookbackDays
 * strictly without looking ahead.
 */
export function detrendCandlesCausalPastOnly(
  candles: readonly Candle[],
  lookbackDays = 365
): Candle[] {
  const n = candles.length;
  if (n <= 1) return [...candles];

  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const logReturns: number[] = new Array(n - 1);
  for (let i = 1; i < n; i++) {
    logReturns[i - 1] = Math.log(candles[i].close / candles[i - 1].close);
  }

  const detrended: Candle[] = [{ ...candles[0] }];

  let windowStart = 0;
  let runningSum = 0;

  for (let i = 1; i < n; i++) {
    const curTime = candles[i].timestamp;
    const cutoff = curTime - lookbackMs;

    // Advance windowStart so that candles[windowStart].timestamp >= cutoff
    while (windowStart < i - 1 && candles[windowStart].timestamp < cutoff) {
      runningSum -= logReturns[windowStart];
      windowStart++;
    }

    const windowCount = Math.max(1, i - 1 - windowStart);
    const meanPastRet = (i > 1 && windowCount > 0) ? runningSum / windowCount : 0;

    const origLogRet = logReturns[i - 1];
    const rPrime = origLogRet - meanPastRet;

    // Update running sum to include current return for subsequent candles
    runningSum += origLogRet;

    const prevC = detrended[i - 1].close;
    const newC = prevC * Math.exp(rPrime);
    const ratio = newC / candles[i].close;
    const prevRatio = prevC / candles[i - 1].close;

    detrended.push({
      timestamp: candles[i].timestamp,
      open: roundTo(candles[i].open * prevRatio, 4),
      high: roundTo(candles[i].high * ratio, 4),
      low: roundTo(candles[i].low * ratio, 4),
      close: roundTo(newC, 4),
      volume: candles[i].volume,
    });
  }

  return detrended;
}

/**
 * Mulberry32 deterministic PRNG
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stationary Block Bootstrap (Politis & Romano, 1994)
 * - meanBlockDays: mean block length in days (geometric distribution)
 * - zeroDrift: if true (D4), subtracts the global mean log-return before resampling
 */
export function stationaryBlockBootstrap(
  candles: readonly Candle[],
  meanBlockDays = 20,
  zeroDrift = false,
  rng: () => number = Math.random
): Candle[] {
  const n = candles.length;
  if (n <= 1) return [...candles];

  const origLogReturns: number[] = new Array(n - 1);
  let sumLogRet = 0;
  for (let i = 1; i < n; i++) {
    const lr = Math.log(candles[i].close / candles[i - 1].close);
    origLogReturns[i - 1] = lr;
    sumLogRet += lr;
  }

  const sampleMean = sumLogRet / (n - 1);
  const returns = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    returns[i] = zeroDrift ? origLogReturns[i] - sampleMean : origLogReturns[i];
  }

  const intervalMs = Math.max(1, candles[1].timestamp - candles[0].timestamp);
  const meanBlockCandles = Math.max(1, Math.round((meanBlockDays * 24 * 60 * 60 * 1000) / intervalMs));
  const p = 1.0 / meanBlockCandles;

  const result: Candle[] = [{ ...candles[0] }];
  let blockIdx = Math.floor(rng() * (n - 1));

  for (let i = 1; i < n; i++) {
    if (i > 1) {
      if (rng() < p) {
        blockIdx = Math.floor(rng() * (n - 1));
      } else {
        blockIdx = (blockIdx + 1) % (n - 1);
      }
    }

    const rStar = returns[blockIdx];
    const prevC = result[i - 1].close;
    const newC = prevC * Math.exp(rStar);

    // Relative ratios from the sampled candle
    const origPrevC = candles[blockIdx].close;
    const origCurrC = candles[blockIdx + 1].close;
    const origO = candles[blockIdx + 1].open;
    const origH = candles[blockIdx + 1].high;
    const origL = candles[blockIdx + 1].low;

    const ratioO = origO / origPrevC;
    const ratioH = origH / origPrevC;
    const ratioL = origL / origPrevC;

    const newO = prevC * ratioO;
    const newH = Math.max(newO, newC, prevC * ratioH);
    const newL = Math.min(newO, newC, prevC * ratioL);

    result.push({
      timestamp: candles[i].timestamp,
      open: roundTo(newO, 4),
      high: roundTo(newH, 4),
      low: roundTo(newL, 4),
      close: roundTo(newC, 4),
      volume: candles[blockIdx + 1].volume,
    });
  }

  return result;
}
