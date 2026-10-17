import type { Candle, TradeSignal } from '../data/models';
import type { ExitMode } from '../backtest/types';

export interface StrategyConfig {
  name: string;
  params: Record<string, unknown>;
}

export interface Strategy {
  readonly name: string;
  readonly description: string;
  readonly requiredCandles: number;
  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal;
  exitSignal?(candles: readonly Candle[], currentIndex: number, side: 'long' | 'short', mode?: ExitMode): boolean;
}

