import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import { MultiTimeframeStrategy } from './multi-timeframe-strategy';

export interface StrictHtfBaselineStrategyOptions {
  htf1hCandles?: readonly Candle[];
  htf4hCandles?: readonly Candle[];
  mode?: 'long-only' | 'short-only' | 'long-short';
}

/**
 * Strategy implementation of B4 baseline:
 * - In long-only mode: emits BUY when HTF strict direction is bullish (+1), SELL when non-bullish (0 or -1).
 * - In short-only mode (B4S): emits SELL when HTF strict direction is bearish (-1), BUY when non-bearish (0 or +1).
 * - In long-short mode: emits BUY when bullish (+1), SELL when bearish (-1), HOLD when neutral (0).
 */
export class StrictHtfBaselineStrategy implements Strategy {
  readonly name = 'StrictHtfBaselineStrategy';
  readonly description = 'Baseline B4: Allocates position when HTF 1h & 4h strict Ichimoku trend is aligned';
  readonly requiredCandles = 1;

  readonly mode: 'long-only' | 'short-only' | 'long-short';
  readonly mtfStrategy: MultiTimeframeStrategy;

  constructor(options: StrictHtfBaselineStrategyOptions = {}) {
    this.mode = options.mode ?? 'long-only';
    this.mtfStrategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      htf1hCandles: options.htf1hCandles,
      htf4hCandles: options.htf4hCandles,
    });
  }

  public getStrictHtfDirection(candles: readonly Candle[], index: number): 1 | -1 | 0 {
    return this.mtfStrategy.getStrictHtfDirection(candles, index);
  }

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const dir = this.mtfStrategy.getStrictHtfDirection(candles, currentIndex);
    const candle = candles[currentIndex];
    const timestamp = candle?.timestamp ?? 0;
    const price = candle?.close ?? 0;

    if (this.mode === 'long-only') {
      if (dir === 1) {
        return { action: 'BUY', timestamp, price, reason: 'HTF strict bullish' };
      } else {
        return { action: 'SELL', timestamp, price, reason: 'HTF strict non-bullish' };
      }
    } else if (this.mode === 'short-only') {
      if (dir === -1) {
        return { action: 'SELL', timestamp, price, reason: 'HTF strict bearish' };
      } else {
        return { action: 'BUY', timestamp, price, reason: 'HTF strict non-bearish' };
      }
    } else {
      if (dir === 1) {
        return { action: 'BUY', timestamp, price, reason: 'HTF strict bullish' };
      } else if (dir === -1) {
        return { action: 'SELL', timestamp, price, reason: 'HTF strict bearish' };
      } else {
        return { action: 'HOLD', timestamp, price, reason: 'HTF neutral' };
      }
    }
  }
}
