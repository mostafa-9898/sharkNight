import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';

export interface StrategyRunnerSummary {
  totalCandles: number;
  totalSignals: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
}

export class StrategyRunner {
  readonly strategy: Strategy;

  constructor(strategy: Strategy) {
    this.strategy = strategy;
  }

  /**
   * Executes the strategy across all candles in sequence, returning signals for every candle.
   */
  run(candles: readonly Candle[]): TradeSignal[] {
    const signals: TradeSignal[] = [];
    for (let i = 0; i < candles.length; i++) {
      signals.push(this.strategy.analyze(candles, i));
    }
    return signals;
  }

  /**
   * Executes the strategy across all candles, filtering out 'HOLD' actions.
   * Only returns actionable 'BUY' and 'SELL' signals.
   */
  runActionable(candles: readonly Candle[]): TradeSignal[] {
    return this.run(candles).filter((signal) => signal.action !== 'HOLD');
  }

  /**
   * Evaluates the strategy for a single candle (defaults to the latest candle in the array).
   */
  evaluateLatest(candles: readonly Candle[]): TradeSignal {
    if (candles.length === 0) {
      throw new Error('Cannot evaluate empty candles array');
    }
    return this.strategy.analyze(candles, candles.length - 1);
  }

  /**
   * Generates a summary count of all signals produced by this strategy on the given candles.
   */
  summarize(candles: readonly Candle[]): StrategyRunnerSummary {
    const signals = this.run(candles);
    let buyCount = 0;
    let sellCount = 0;
    let holdCount = 0;

    for (const signal of signals) {
      if (signal.action === 'BUY') buyCount++;
      else if (signal.action === 'SELL') sellCount++;
      else holdCount++;
    }

    return {
      totalCandles: candles.length,
      totalSignals: signals.length,
      buyCount,
      sellCount,
      holdCount,
    };
  }
}

