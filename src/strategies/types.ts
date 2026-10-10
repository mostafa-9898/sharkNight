import type { Candle, TradeSignal } from '../data/models';

export interface StrategyConfig {
  name: string;
  params: Record<string, unknown>;
}

export interface Strategy {
  readonly name: string;
  readonly description: string;
  readonly requiredCandles: number;
  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal;
}

