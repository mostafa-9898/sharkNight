import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';
import { calculateSMA } from './sma';
import type { CandleSource } from './sma';

export interface BollingerBandsResult {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
  percentB: number[];
}

export interface BollingerBandsConfig {
  period?: number;
  stdDevMultiplier?: number;
}

/**
 * Calculates Bollinger Bands (Upper, Middle, Lower, Bandwidth, %B).
 * Middle Band is the simple moving average.
 * Upper and Lower Bands are offset by `stdDevMultiplier` times the population standard deviation.
 */
export function calculateBollingerBands(
  values: readonly number[],
  config?: BollingerBandsConfig
): BollingerBandsResult {
  const period = config?.period ?? 20;
  const stdDevMultiplier = config?.stdDevMultiplier ?? 2;

  if (!Number.isInteger(period) || period < 2) {
    throw new Error(`Period must be an integer >= 2, got ${period}`);
  }

  if (typeof stdDevMultiplier !== 'number' || stdDevMultiplier <= 0 || !Number.isFinite(stdDevMultiplier)) {
    throw new Error(`stdDevMultiplier must be a positive number, got ${stdDevMultiplier}`);
  }

  const length = values.length;
  const upper: number[] = new Array<number>(length).fill(NaN);
  const middle = calculateSMA(values, period);
  const lower: number[] = new Array<number>(length).fill(NaN);
  const bandwidth: number[] = new Array<number>(length).fill(NaN);
  const percentB: number[] = new Array<number>(length).fill(NaN);

  if (length < period) {
    return { upper, middle, lower, bandwidth, percentB };
  }

  for (let i = period - 1; i < length; i++) {
    const avg = middle[i];

    // Compute standard deviation over the window
    let squaredDiffSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - avg;
      squaredDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(squaredDiffSum / period);

    const up = avg + stdDevMultiplier * stdDev;
    const low = avg - stdDevMultiplier * stdDev;
    const bandSpan = up - low;

    upper[i] = up;
    lower[i] = low;
    bandwidth[i] = avg !== 0 ? bandSpan / avg : 0;
    percentB[i] = bandSpan !== 0 ? (values[i] - low) / bandSpan : 0.5;
  }

  return { upper, middle, lower, bandwidth, percentB };
}

export class BollingerBandsIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly source: CandleSource;
  readonly period: number;
  readonly stdDevMultiplier: number;

  constructor(
    config?: BollingerBandsConfig,
    source: CandleSource = 'close'
  ) {
    this.period = config?.period ?? 20;
    this.stdDevMultiplier = config?.stdDevMultiplier ?? 2;

    if (!Number.isInteger(this.period) || this.period < 2) {
      throw new Error(`Period must be an integer >= 2, got ${this.period}`);
    }

    this.name = `BB_${this.period}_${this.stdDevMultiplier}`;
    this.requiredPeriod = this.period;
    this.source = source;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const values = candles.map((c) => c[this.source]);
    const bb = calculateBollingerBands(values, {
      period: this.period,
      stdDevMultiplier: this.stdDevMultiplier,
    });

    return {
      values: bb.middle,
      lines: {
        upper: bb.upper,
        middle: bb.middle,
        lower: bb.lower,
        bandwidth: bb.bandwidth,
        percentB: bb.percentB,
      },
    };
  }
}

