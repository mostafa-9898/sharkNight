import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';

export interface StochasticConfig {
  kPeriod?: number; // default 14
  dPeriod?: number; // default 3
  smooth?: number;  // default 3
}

export interface StochasticResult {
  k: number[];
  d: number[];
}

/**
 * Calculates Stochastic Oscillator (%K and %D lines).
 *
 * %K (raw) = ((Close - LowestLow(kPeriod)) / (HighestHigh(kPeriod) - LowestLow(kPeriod))) * 100
 * %K (smoothed) = SMA(raw %K, smooth)
 * %D = SMA(smoothed %K, dPeriod)
 */
export function calculateStochastic(
  candles: readonly Candle[],
  config?: StochasticConfig
): StochasticResult {
  const kPeriod = config?.kPeriod ?? 14;
  const dPeriod = config?.dPeriod ?? 3;
  const smooth = config?.smooth ?? 3;

  if (
    !Number.isInteger(kPeriod) ||
    !Number.isInteger(dPeriod) ||
    !Number.isInteger(smooth)
  ) {
    throw new Error('All Stochastic parameters must be integers');
  }

  if (kPeriod <= 0 || dPeriod <= 0 || smooth <= 0) {
    throw new Error('All Stochastic parameters must be positive');
  }

  const length = candles.length;
  const rawK = new Float64Array(length);
  const k = new Array<number>(length).fill(NaN);
  const d = new Array<number>(length).fill(NaN);

  if (length < kPeriod) {
    return { k, d };
  }

  // Calculate Raw %K
  for (let i = kPeriod - 1; i < length; i++) {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const c = candles[j];
      if (c.low < lowest) lowest = c.low;
      if (c.high > highest) highest = c.high;
    }
    const range = highest - lowest;
    rawK[i] = range > 0 ? ((candles[i].close - lowest) / range) * 100 : 50;
  }

  // Smooth %K
  const smoothStart = kPeriod - 1 + smooth - 1;
  for (let i = smoothStart; i < length; i++) {
    let sum = 0;
    for (let j = i - smooth + 1; j <= i; j++) {
      sum += rawK[j];
    }
    k[i] = sum / smooth;
  }

  // Calculate %D (SMA of %K)
  const dStart = smoothStart + dPeriod - 1;
  for (let i = dStart; i < length; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) {
      sum += k[j];
    }
    d[i] = sum / dPeriod;
  }

  return { k, d };
}

export class StochasticIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly kPeriod: number;
  readonly dPeriod: number;
  readonly smooth: number;

  constructor(config?: StochasticConfig) {
    this.kPeriod = config?.kPeriod ?? 14;
    this.dPeriod = config?.dPeriod ?? 3;
    this.smooth = config?.smooth ?? 3;

    if (this.kPeriod <= 0 || this.dPeriod <= 0 || this.smooth <= 0) {
      throw new Error('All Stochastic parameters must be positive integers');
    }

    this.requiredPeriod = this.kPeriod + this.smooth + this.dPeriod;
    this.name = `Stochastic_${this.kPeriod}_${this.dPeriod}_${this.smooth}`;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const result = calculateStochastic(candles, {
      kPeriod: this.kPeriod,
      dPeriod: this.dPeriod,
      smooth: this.smooth,
    });

    return {
      values: result.k,
      lines: {
        k: result.k,
        d: result.d,
      },
    };
  }
}

