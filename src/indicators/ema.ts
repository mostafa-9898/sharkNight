import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';
import type { CandleSource } from './sma';

/**
 * Calculates Exponential Moving Average (EMA) for an array of numbers.
 * Uses the SMA of the initial `period` items as the starting seed.
 * Returns an array of the same length with NaN for indices where full period is not yet available.
 */
export function calculateEMA(values: readonly number[], period: number): number[] {
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

  for (let i = 0; i < period - 1; i++) {
    result[i] = NaN;
  }

  // Seed EMA with SMA of first `period` elements
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  const multiplier = 2 / (period + 1);

  for (let i = period; i < length; i++) {
    const currentEma = (values[i] - prevEma) * multiplier + prevEma;
    result[i] = currentEma;
    prevEma = currentEma;
  }

  return result;
}

export class EMAIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly source: CandleSource;

  constructor(period = 14, source: CandleSource = 'close') {
    if (!Number.isInteger(period) || period <= 0) {
      throw new Error(`EMA period must be a positive integer, got ${period}`);
    }
    this.name = `EMA_${period}`;
    this.requiredPeriod = period;
    this.source = source;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const values = candles.map((c) => c[this.source]);
    return {
      values: calculateEMA(values, this.requiredPeriod),
    };
  }
}

