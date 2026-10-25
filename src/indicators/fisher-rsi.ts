import { calculateRSI } from './rsi';

export interface FisherRsiOptions {
  rsiPeriod?: number;
  rsiSmoothing?: number;
  window?: number;
}

export interface FisherRsiResult {
  fisher: number[];
  signal: number[];
  scaled: number[];
  signalScaled: number[];
  rsiScore: number[];
}

export interface FisherCrossEvent {
  anyCrossUp: boolean;
  anyCrossDown: boolean;
  zoneCrossUp: boolean;
  zoneCrossDown: boolean;
}

export interface FisherCrossOptions {
  oversoldLevel?: number;
  overboughtLevel?: number;
}

export interface IftRsiOptions {
  rsiPeriod?: number;
  wmaPeriod?: number;
}

function computeSmaOnArray(values: readonly number[], period: number): number[] {
  if (period <= 1) return [...values];
  const length = values.length;
  const result: number[] = new Array<number>(length).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < length; i++) {
    const val = values[i];
    if (Number.isNaN(val)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += val;
    count++;
    if (count > period) {
      sum -= values[i - period];
      count--;
    }
    if (count === period) {
      result[i] = sum / period;
    }
  }
  return result;
}

/**
 * Calculates Fisher Transform of RSI matching Pine Script reference.
 *
 * rsi_score = ta.sma(ta.rsi(close, rsi_length), rsi_smoothing)
 * fisher_highest = ta.highest(rsi_score, fisher_length)
 * fisher_lowest = ta.lowest(rsi_score, fisher_length)
 * fisher_position = range != 0 ? (rsi_score - lowest) / range - 0.5 : 0
 * fisher_value1 = clamp(0.33 * 2 * position + 0.67 * nz(fisher_value1[1]), -0.999, 0.999)
 * fisher_transform = 0.5 * ln((1 + value1) / (1 - value1)) + 0.5 * nz(transform[1])
 * fisher_signal = fisher_transform[1]
 * scaled = 50 + fisher_transform * 10
 * signalScaled = 50 + fisher_signal * 10
 */
export function calculateFisherRsi(
  closes: readonly number[],
  options?: FisherRsiOptions
): FisherRsiResult {
  const rsiPeriod = options?.rsiPeriod ?? 14;
  const rsiSmoothing = options?.rsiSmoothing ?? 1;
  const window = options?.window ?? 10;

  const length = closes.length;
  const fisher: number[] = new Array<number>(length).fill(NaN);
  const signal: number[] = new Array<number>(length).fill(NaN);
  const scaled: number[] = new Array<number>(length).fill(NaN);
  const signalScaled: number[] = new Array<number>(length).fill(NaN);
  const rsiScore: number[] = new Array<number>(length).fill(NaN);

  if (length === 0) {
    return { fisher, signal, scaled, signalScaled, rsiScore };
  }

  const rawRsi = calculateRSI(closes, rsiPeriod);
  const smoothedRsi = rsiSmoothing > 1 ? computeSmaOnArray(rawRsi, rsiSmoothing) : rawRsi;

  for (let i = 0; i < length; i++) {
    rsiScore[i] = smoothedRsi[i];
  }

  let prevX = 0;
  let prevFisher = 0;
  let hasValidPredecessor = false;

  for (let i = 0; i < length; i++) {
    const curRsi = smoothedRsi[i];
    if (Number.isNaN(curRsi)) {
      continue;
    }

    let hh = -Infinity;
    let ll = Infinity;
    for (let k = 0; k < window; k++) {
      const idx = i - k;
      if (idx < 0 || Number.isNaN(smoothedRsi[idx])) break;
      const v = smoothedRsi[idx];
      if (v > hh) hh = v;
      if (v < ll) ll = v;
    }

    const range = hh - ll;
    const position = range !== 0 ? (curRsi - ll) / range - 0.5 : 0.0;
    const val1Raw = 0.33 * 2 * position + 0.67 * prevX;
    const val1 = Math.max(-0.999, Math.min(0.999, val1Raw));
    const transform = 0.5 * Math.log((1 + val1) / (1 - val1)) + 0.5 * prevFisher;

    fisher[i] = transform;
    signal[i] = hasValidPredecessor ? prevFisher : NaN;
    scaled[i] = 50 + transform * 10;
    signalScaled[i] = hasValidPredecessor ? 50 + prevFisher * 10 : NaN;

    prevX = val1;
    prevFisher = transform;
    hasValidPredecessor = true;
  }

  return { fisher, signal, scaled, signalScaled, rsiScore };
}

/**
 * Computes Fisher crossover events according to Pine Script reference.
 */
export function fisherCrossEvents(
  fisherResult: FisherRsiResult,
  options?: FisherCrossOptions
): FisherCrossEvent[] {
  const oversoldLevel = options?.oversoldLevel ?? 30;
  const overboughtLevel = options?.overboughtLevel ?? 70;

  const length = fisherResult.fisher.length;
  const events: FisherCrossEvent[] = new Array<FisherCrossEvent>(length);

  for (let i = 0; i < length; i++) {
    const fCurr = fisherResult.fisher[i];
    const sCurr = fisherResult.signal[i];
    const fPrev = i > 0 ? fisherResult.fisher[i - 1] : NaN;
    const sPrev =
      i > 0
        ? Number.isNaN(fisherResult.signal[i - 1]) && Number.isFinite(fPrev)
          ? 0.0
          : fisherResult.signal[i - 1]
        : NaN;

    if (
      i === 0 ||
      Number.isNaN(fCurr) ||
      Number.isNaN(sCurr) ||
      Number.isNaN(fPrev) ||
      Number.isNaN(sPrev)
    ) {
      events[i] = {
        anyCrossUp: false,
        anyCrossDown: false,
        zoneCrossUp: false,
        zoneCrossDown: false,
      };
      continue;
    }

    const anyCrossUp = fCurr > sCurr && fPrev <= sPrev;
    const anyCrossDown = fCurr < sCurr && fPrev >= sPrev;

    const rScore = fisherResult.rsiScore[i];
    const sVal = fisherResult.scaled[i];

    const bullZone =
      (Number.isFinite(rScore) && rScore <= oversoldLevel) ||
      (Number.isFinite(sVal) && sVal <= oversoldLevel);

    const bearZone =
      (Number.isFinite(rScore) && rScore >= overboughtLevel) ||
      (Number.isFinite(sVal) && sVal >= overboughtLevel);

    events[i] = {
      anyCrossUp,
      anyCrossDown,
      zoneCrossUp: anyCrossUp && bullZone,
      zoneCrossDown: anyCrossDown && bearZone,
    };
  }

  return events;
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
