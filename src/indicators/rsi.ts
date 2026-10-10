import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';
import type { CandleSource } from './sma';

/**
 * Calculates Relative Strength Index (RSI) using Wilder's smoothed moving average method.
 * Returns an array of the same length with NaN for indices where the full period is not yet available.
 */
export function calculateRSI(values: readonly number[], period = 14): number[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`Period must be a positive integer, got ${period}`);
  }

  const length = values.length;
  const result: number[] = new Array<number>(length);

  if (length === 0) {
    return result;
  }

  // RSI requires at least period + 1 prices to calculate period price differences
  if (length <= period) {
    result.fill(NaN);
    return result;
  }

  for (let i = 0; i < period; i++) {
    result[i] = NaN;
  }

  // Calculate initial average gain and loss over the first `period` changes
  let initialGainSum = 0;
  let initialLossSum = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) {
      initialGainSum += diff;
    } else {
      initialLossSum += -diff;
    }
  }

  let avgGain = initialGainSum / period;
  let avgLoss = initialLossSum / period;

  const computeRsi = (gain: number, loss: number): number => {
    if (loss === 0) {
      return gain === 0 ? 50 : 100;
    }
    const rs = gain / loss;
    return 100 - 100 / (1 + rs);
  };

  result[period] = computeRsi(avgGain, avgLoss);

  // Apply Wilder's smoothing for subsequent data points
  for (let i = period + 1; i < length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = computeRsi(avgGain, avgLoss);
  }

  return result;
}

export class RSIIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly source: CandleSource;

  constructor(period = 14, source: CandleSource = 'close') {
    if (!Number.isInteger(period) || period <= 0) {
      throw new Error(`RSI period must be a positive integer, got ${period}`);
    }
    this.name = `RSI_${period}`;
    this.requiredPeriod = period + 1; // Needs period + 1 candles for period price changes
    this.source = source;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const values = candles.map((c) => c[this.source]);
    return {
      values: calculateRSI(values, this.requiredPeriod - 1),
    };
  }
}

