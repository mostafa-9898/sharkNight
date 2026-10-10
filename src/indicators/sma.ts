import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';

export type CandleSource = 'open' | 'high' | 'low' | 'close';

/**
 * Calculates Simple Moving Average (SMA) for an array of numbers using an O(N) rolling window.
 * Returns an array of the same length with NaN for indices where full period is not yet available.
 */
export function calculateSMA(values: readonly number[], period: number): number[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`Period must be a positive integer, got ${period}`);
  }

  const length = values.length;
  const result: number[] = new Array<number>(length);

  if (length === 0) {
    return result;
  }

  if (length < period) {
    result.fill(NaN);
    return result;
  }

  // Pre-fill initial elements with NaN
  for (let i = 0; i < period - 1; i++) {
    result[i] = NaN;
  }

  // Compute initial window sum
  let windowSum = 0;
  for (let i = 0; i < period; i++) {
    windowSum += values[i];
  }
  result[period - 1] = windowSum / period;

  // Slide window in O(1) per step
  for (let i = period; i < length; i++) {
    windowSum += values[i] - values[i - period];
    result[i] = windowSum / period;
  }

  return result;
}

export class SMAIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly source: CandleSource;

  constructor(period = 14, source: CandleSource = 'close') {
    if (!Number.isInteger(period) || period <= 0) {
      throw new Error(`SMA period must be a positive integer, got ${period}`);
    }
    this.name = `SMA_${period}`;
    this.requiredPeriod = period;
    this.source = source;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const values = candles.map((c) => c[this.source]);
    return {
      values: calculateSMA(values, this.requiredPeriod),
    };
  }
}

