import type { Candle } from '../data/models';

export interface IndicatorResult {
  values: number[];
  // Some indicators produce multiple lines (e.g., MACD, Bollinger Bands)
  lines?: Record<string, number[]>;
}

export interface Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  calculate(candles: readonly Candle[]): IndicatorResult;
}
