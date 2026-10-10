import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';
import { calculateEMA } from './ema';
import type { CandleSource } from './sma';

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export interface MACDConfig {
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
}

/**
 * Calculates Moving Average Convergence Divergence (MACD).
 * - MACD Line: Fast EMA - Slow EMA
 * - Signal Line: EMA of MACD Line
 * - Histogram: MACD Line - Signal Line
 */
export function calculateMACD(
  values: readonly number[],
  config?: MACDConfig
): MACDResult {
  const fastPeriod = config?.fastPeriod ?? 12;
  const slowPeriod = config?.slowPeriod ?? 26;
  const signalPeriod = config?.signalPeriod ?? 9;

  if (
    !Number.isInteger(fastPeriod) ||
    !Number.isInteger(slowPeriod) ||
    !Number.isInteger(signalPeriod) ||
    fastPeriod <= 0 ||
    slowPeriod <= 0 ||
    signalPeriod <= 0
  ) {
    throw new Error('All MACD periods must be positive integers');
  }

  if (fastPeriod >= slowPeriod) {
    throw new Error(`fastPeriod (${fastPeriod}) must be less than slowPeriod (${slowPeriod})`);
  }

  const length = values.length;
  const macd: number[] = new Array<number>(length).fill(NaN);
  const signal: number[] = new Array<number>(length).fill(NaN);
  const histogram: number[] = new Array<number>(length).fill(NaN);

  if (length === 0) {
    return { macd, signal, histogram };
  }

  const fastEMA = calculateEMA(values, fastPeriod);
  const slowEMA = calculateEMA(values, slowPeriod);

  // MACD Line is valid once slow EMA is valid (slowPeriod - 1)
  for (let i = slowPeriod - 1; i < length; i++) {
    macd[i] = fastEMA[i] - slowEMA[i];
  }

  // Calculate Signal Line as EMA of valid MACD line portion
  const validMacdValues = macd.slice(slowPeriod - 1);
  if (validMacdValues.length >= signalPeriod) {
    const rawSignal = calculateEMA(validMacdValues, signalPeriod);
    for (let i = 0; i < rawSignal.length; i++) {
      signal[slowPeriod - 1 + i] = rawSignal[i];
    }
  }

  // Calculate Histogram
  for (let i = 0; i < length; i++) {
    if (!Number.isNaN(macd[i]) && !Number.isNaN(signal[i])) {
      histogram[i] = macd[i] - signal[i];
    }
  }

  return { macd, signal, histogram };
}

export class MACDIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly source: CandleSource;
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly signalPeriod: number;

  constructor(
    config?: MACDConfig,
    source: CandleSource = 'close'
  ) {
    this.fastPeriod = config?.fastPeriod ?? 12;
    this.slowPeriod = config?.slowPeriod ?? 26;
    this.signalPeriod = config?.signalPeriod ?? 9;

    if (this.fastPeriod >= this.slowPeriod) {
      throw new Error(`fastPeriod (${this.fastPeriod}) must be less than slowPeriod (${this.slowPeriod})`);
    }

    this.name = `MACD_${this.fastPeriod}_${this.slowPeriod}_${this.signalPeriod}`;
    this.requiredPeriod = this.slowPeriod + this.signalPeriod - 1;
    this.source = source;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const values = candles.map((c) => c[this.source]);
    const macdResult = calculateMACD(values, {
      fastPeriod: this.fastPeriod,
      slowPeriod: this.slowPeriod,
      signalPeriod: this.signalPeriod,
    });

    return {
      values: macdResult.histogram,
      lines: {
        macd: macdResult.macd,
        signal: macdResult.signal,
        histogram: macdResult.histogram,
      },
    };
  }
}

