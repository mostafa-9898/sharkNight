import { calculateRSI } from './rsi';

export interface FisherRsiOptions {
  rsiPeriod?: number;
  window?: number;
}

export interface FisherRsiResult {
  fisher: number[];
  signal: number[];
}

export interface IftRsiOptions {
  rsiPeriod?: number;
  wmaPeriod?: number;
}

/**
 * Calculates Fisher Transform of RSI.
 *
 * r[i] = RSI[i]
 * hh/ll = max/min of r over the last `window` bars (including current)
 * norm = hh === ll ? 0 : ((r - ll) / (hh - ll) - 0.5)
 * x[i] = clamp(0.66 * norm + 0.67 * x[i-1], -0.999, 0.999) with x[-1] = 0
 * fisher[i] = 0.5 * ln((1 + x[i]) / (1 - x[i])) + 0.5 * fisher[i-1] with fisher[-1] = 0
 * signal[i] = fisher[i-1]
 */
export function calculateFisherRsi(
  closes: readonly number[],
  options?: FisherRsiOptions
): FisherRsiResult {
  const rsiPeriod = options?.rsiPeriod ?? 14;
  const window = options?.window ?? 10;

  const length = closes.length;
  const fisher: number[] = new Array<number>(length).fill(NaN);
  const signal: number[] = new Array<number>(length).fill(NaN);

  if (length === 0) {
    return { fisher, signal };
  }

  const rsi = calculateRSI(closes, rsiPeriod);
  let prevX = 0;
  let prevFisher = 0;
  const minValidIndex = rsiPeriod + window - 1;

  for (let i = 0; i < length; i++) {
    if (i < minValidIndex || Number.isNaN(rsi[i])) {
      continue;
    }

    let hh = -Infinity;
    let ll = Infinity;
    let windowHasNaN = false;

    for (let w = 0; w < window; w++) {
      const val = rsi[i - window + 1 + w];
      if (Number.isNaN(val)) {
        windowHasNaN = true;
        break;
      }
      if (val > hh) hh = val;
      if (val < ll) ll = val;
    }

    if (windowHasNaN) {
      continue;
    }

    const r = rsi[i];
    const norm = hh === ll ? 0 : (r - ll) / (hh - ll) - 0.5;
    const rawX = 0.66 * norm + 0.67 * prevX;
    const x = Math.max(-0.999, Math.min(0.999, rawX));
    const f = 0.5 * Math.log((1 + x) / (1 - x)) + 0.5 * prevFisher;

    fisher[i] = f;
    signal[i] = Number.isNaN(fisher[i - 1]) ? NaN : fisher[i - 1];

    prevX = x;
    prevFisher = f;
  }

  return { fisher, signal };
}

/**
 * Calculates Inverse Fisher Transform of RSI (IFT-RSI).
 *
 * v1[i] = 0.1 * (RSI[i] - 50)
 * v2 = WMA(v1, wmaPeriod)
 * ift[i] = (exp(2 * v2) - 1) / (exp(2 * v2) + 1) -> mapped to (-1, 1)
 */
export function calculateIftRsi(
  closes: readonly number[],
  options?: IftRsiOptions
): number[] {
  const rsiPeriod = options?.rsiPeriod ?? 14;
  const wmaPeriod = options?.wmaPeriod ?? 9;

  const length = closes.length;
  const ift: number[] = new Array<number>(length).fill(NaN);

  if (length === 0) {
    return ift;
  }

  const rsi = calculateRSI(closes, rsiPeriod);
  const v1: number[] = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    v1[i] = Number.isNaN(rsi[i]) ? NaN : 0.1 * (rsi[i] - 50);
  }

  const weightSum = (wmaPeriod * (wmaPeriod + 1)) / 2;
  const minValidIndex = rsiPeriod + wmaPeriod - 1;

  for (let i = 0; i < length; i++) {
    if (i < minValidIndex) {
      continue;
    }

    let weightedSum = 0;
    let windowHasNaN = false;

    for (let k = 1; k <= wmaPeriod; k++) {
      const val = v1[i - wmaPeriod + k];
      if (Number.isNaN(val)) {
        windowHasNaN = true;
        break;
      }
      weightedSum += k * val;
    }

    if (windowHasNaN) {
      continue;
    }

    const v2 = weightedSum / weightSum;
    const exp2v2 = Math.exp(2 * v2);
    ift[i] = Number.isFinite(exp2v2) ? (exp2v2 - 1) / (exp2v2 + 1) : 1;
  }

  return ift;
}

