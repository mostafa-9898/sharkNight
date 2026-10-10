import type { Candle, TradeSignal } from '../data/models';
import type { CandleSource } from '../indicators/sma';
import type { Strategy } from './types';

export interface SMACrossoverOptions {
  fastPeriod?: number;
  slowPeriod?: number;
  source?: CandleSource;
}

/**
 * SMA Crossover Strategy (Golden Cross / Death Cross).
 * - Emits BUY when Fast SMA crosses above Slow SMA.
 * - Emits SELL when Fast SMA crosses below Slow SMA.
 * - Emits HOLD in all other conditions.
 */
export class SMACrossoverStrategy implements Strategy {
  readonly name: string;
  readonly description: string;
  readonly requiredCandles: number;
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly source: CandleSource;

  constructor(options?: SMACrossoverOptions) {
    this.fastPeriod = options?.fastPeriod ?? 10;
    this.slowPeriod = options?.slowPeriod ?? 30;
    this.source = options?.source ?? 'close';

    if (!Number.isInteger(this.fastPeriod) || this.fastPeriod <= 0) {
      throw new Error(`fastPeriod must be a positive integer, got ${this.fastPeriod}`);
    }

    if (!Number.isInteger(this.slowPeriod) || this.slowPeriod <= 0) {
      throw new Error(`slowPeriod must be a positive integer, got ${this.slowPeriod}`);
    }

    if (this.fastPeriod >= this.slowPeriod) {
      throw new Error(
        `fastPeriod (${this.fastPeriod}) must be strictly less than slowPeriod (${this.slowPeriod})`
      );
    }

    this.name = `SMA_Crossover_${this.fastPeriod}_${this.slowPeriod}`;
    this.description = `Trades Golden Cross / Death Cross using Fast SMA (${this.fastPeriod}) and Slow SMA (${this.slowPeriod})`;
    // Requires slowPeriod + 1 candles to compute crossover from previous to current candle
    this.requiredCandles = this.slowPeriod + 1;
  }

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const candle = candles[currentIndex];

    if (!candle) {
      throw new Error(`Candle at index ${currentIndex} is undefined`);
    }

    // Not enough candles to determine previous vs current crossover
    if (currentIndex < this.requiredCandles - 1 || candles.length < this.requiredCandles) {
      return {
        action: 'HOLD',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: 'Insufficient historical candles for SMA calculation',
      };
    }

    // Extract price series for the relevant window
    const getSourcePrice = (idx: number) => candles[idx][this.source];

    // Current Fast & Slow SMA (ending at currentIndex)
    let currentFastSum = 0;
    for (let i = currentIndex - this.fastPeriod + 1; i <= currentIndex; i++) {
      currentFastSum += getSourcePrice(i);
    }
    const currentFastSMA = currentFastSum / this.fastPeriod;

    let currentSlowSum = 0;
    for (let i = currentIndex - this.slowPeriod + 1; i <= currentIndex; i++) {
      currentSlowSum += getSourcePrice(i);
    }
    const currentSlowSMA = currentSlowSum / this.slowPeriod;

    // Previous Fast & Slow SMA (ending at currentIndex - 1)
    let prevFastSum = 0;
    for (let i = currentIndex - this.fastPeriod; i <= currentIndex - 1; i++) {
      prevFastSum += getSourcePrice(i);
    }
    const prevFastSMA = prevFastSum / this.fastPeriod;

    let prevSlowSum = 0;
    for (let i = currentIndex - this.slowPeriod; i <= currentIndex - 1; i++) {
      prevSlowSum += getSourcePrice(i);
    }
    const prevSlowSMA = prevSlowSum / this.slowPeriod;

    // Detect Crossover
    const isGoldenCross = prevFastSMA <= prevSlowSMA && currentFastSMA > currentSlowSMA;
    const isDeathCross = prevFastSMA >= prevSlowSMA && currentFastSMA < currentSlowSMA;

    if (isGoldenCross) {
      return {
        action: 'BUY',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: `Golden Cross: Fast SMA (${this.fastPeriod}) crossed above Slow SMA (${this.slowPeriod})`,
        metadata: {
          fastSMA: currentFastSMA,
          slowSMA: currentSlowSMA,
          prevFastSMA,
          prevSlowSMA,
        },
      };
    }

    if (isDeathCross) {
      return {
        action: 'SELL',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: `Death Cross: Fast SMA (${this.fastPeriod}) crossed below Slow SMA (${this.slowPeriod})`,
        metadata: {
          fastSMA: currentFastSMA,
          slowSMA: currentSlowSMA,
          prevFastSMA,
          prevSlowSMA,
        },
      };
    }

    return {
      action: 'HOLD',
      timestamp: candle.timestamp,
      price: candle.close,
      reason: 'No crossover detected',
      metadata: {
        fastSMA: currentFastSMA,
        slowSMA: currentSlowSMA,
      },
    };
  }
}
