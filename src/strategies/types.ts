import type { Candle } from '../data/models';
import type { TradeSignal } from '../data/models';

export interface StrategyConfig {
  name: string;
  params: Record<string, unknown>;
}

export interface Strategy {
  readonly name: string;
  readonly description: string;
  analyze(candles: Candle[], currentIndex: number): TradeSignal;
}
