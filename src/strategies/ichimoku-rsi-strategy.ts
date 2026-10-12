import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import { calculateIchimoku } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';

export interface IchimokuRsiConfig {
  tenkan?: number;           // default 9
  kijun?: number;            // default 26
  senkouB?: number;          // default 52
  displacement?: number;     // default 26
  rsiPeriod?: number;        // default 14
  rsiBuyMin?: number;        // default 20
  rsiBuyMax?: number;        // default 40
  rsiSellMin?: number;       // default 60
  rsiSellMax?: number;       // default 80
  rsiLookback?: number;      // default 10
}

interface CachedIndicators {
  tenkan: number[];
  kijun: number[];
  rsi: number[];
}

/**
 * Strategy combining Ichimoku Cloud Tenkan-sen / Kijun-sen crossovers with RSI zone confluence.
 *
 * Rules:
 * - BUY: Tenkan crosses UP through Kijun on current candle AND RSI in [buyMin, buyMax] on signal candle or within rsiLookback.
 * - SELL: Tenkan crosses DOWN through Kijun on current candle AND RSI in [sellMin, sellMax] on signal candle or within rsiLookback.
 * - Stateless regarding portfolio positions: signals are generated purely from indicators.
 */
export class IchimokuRsiStrategy implements Strategy {
  readonly name: string;
  readonly description = 'Ichimoku TK crossover with RSI zone confluence';
  readonly requiredCandles: number;

  readonly tenkan: number;
  readonly kijun: number;
  readonly senkouB: number;
  readonly displacement: number;
  readonly rsiPeriod: number;
  readonly rsiBuyMin: number;
  readonly rsiBuyMax: number;
  readonly rsiSellMin: number;
  readonly rsiSellMax: number;
  readonly rsiLookback: number;

  private indicatorCache = new WeakMap<readonly Candle[], CachedIndicators>();

  constructor(config?: IchimokuRsiConfig) {
    this.tenkan = config?.tenkan ?? 9;
    this.kijun = config?.kijun ?? 26;
    this.senkouB = config?.senkouB ?? 52;
    this.displacement = config?.displacement ?? 26;
    this.rsiPeriod = config?.rsiPeriod ?? 14;
    this.rsiBuyMin = config?.rsiBuyMin ?? 20;
    this.rsiBuyMax = config?.rsiBuyMax ?? 40;
    this.rsiSellMin = config?.rsiSellMin ?? 60;
    this.rsiSellMax = config?.rsiSellMax ?? 80;
    this.rsiLookback = config?.rsiLookback ?? 10;

    // Validation
    if (
      !Number.isInteger(this.tenkan) ||
      !Number.isInteger(this.kijun) ||
      !Number.isInteger(this.senkouB) ||
      !Number.isInteger(this.displacement) ||
      !Number.isInteger(this.rsiPeriod) ||
      !Number.isInteger(this.rsiLookback)
    ) {
      throw new Error('All Ichimoku and RSI periods must be integers');
    }

    if (
      this.tenkan <= 0 ||
      this.kijun <= 0 ||
      this.senkouB <= 0 ||
      this.displacement <= 0 ||
      this.rsiPeriod <= 0
    ) {
      throw new Error('Periods and displacement must be positive integers');
    }

    if (this.tenkan >= this.kijun || this.kijun >= this.senkouB) {
      throw new Error(
        `Parameters must satisfy tenkan (${this.tenkan}) < kijun (${this.kijun}) < senkouB (${this.senkouB})`
      );
    }

    if (this.rsiLookback < 1) {
      throw new Error(`rsiLookback must be at least 1, got ${this.rsiLookback}`);
    }

    if (
      !(
        this.rsiBuyMin < this.rsiBuyMax &&
        this.rsiBuyMax < this.rsiSellMin &&
        this.rsiSellMin < this.rsiSellMax
      )
    ) {
      throw new Error(
        `RSI zones must satisfy buyMin (${this.rsiBuyMin}) < buyMax (${this.rsiBuyMax}) < sellMin (${this.rsiSellMin}) < sellMax (${this.rsiSellMax})`
      );
    }

    this.requiredCandles = Math.max(this.kijun + 1, this.rsiPeriod + 3, 5);
    this.name = `IchimokuRSI_${this.tenkan}_${this.kijun}_${this.senkouB}_${this.displacement}_RSI${this.rsiPeriod}_L${this.rsiLookback}`;
  }

  private getIndicators(candles: readonly Candle[]): CachedIndicators {
    let cached = this.indicatorCache.get(candles);
    if (!cached) {
      const ichimoku = calculateIchimoku(candles, {
        tenkan: this.tenkan,
        kijun: this.kijun,
        senkouB: this.senkouB,
        displacement: this.displacement,
      });
      const closes = candles.map((c) => c.close);
      const rsi = calculateRSI(closes, this.rsiPeriod);

      cached = {
        tenkan: ichimoku.tenkan,
        kijun: ichimoku.kijun,
        rsi,
      };
      this.indicatorCache.set(candles, cached);
    }
    return cached;
  }

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const defaultSignal: TradeSignal = {
      action: 'HOLD',
      timestamp: candles[currentIndex]?.timestamp ?? 0,
      price: candles[currentIndex]?.close ?? 0,
    };

    if (
      currentIndex < 1 ||
      currentIndex >= candles.length ||
      currentIndex < this.requiredCandles
    ) {
      return defaultSignal;
    }

    const { tenkan, kijun, rsi } = this.getIndicators(candles);

    const currentTenkan = tenkan[currentIndex];
    const currentKijun = kijun[currentIndex];
    const prevTenkan = tenkan[currentIndex - 1];
    const prevKijun = kijun[currentIndex - 1];
    const currentRsi = rsi[currentIndex];

    // Ensure all required indicator points are valid finite numbers
    if (
      !Number.isFinite(currentTenkan) ||
      !Number.isFinite(currentKijun) ||
      !Number.isFinite(prevTenkan) ||
      !Number.isFinite(prevKijun) ||
      !Number.isFinite(currentRsi)
    ) {
      return defaultSignal;
    }

    const candle = candles[currentIndex];

    // Check for fresh TK crossover on the current candle
    const crossUp = prevTenkan <= prevKijun && currentTenkan > currentKijun;
    const crossDown = prevTenkan >= prevKijun && currentTenkan < currentKijun;

    if (!crossUp && !crossDown) {
      return defaultSignal;
    }

    const lookbackStart = Math.max(0, currentIndex - this.rsiLookback + 1);

    if (crossUp) {
      // Find most recent candle within lookback where RSI was in [buyMin, buyMax]
      let rsiHitIndex = -1;
      let rsiHitValue = NaN;

      for (let k = currentIndex; k >= lookbackStart; k--) {
        const val = rsi[k];
        if (Number.isFinite(val) && val >= this.rsiBuyMin && val <= this.rsiBuyMax) {
          rsiHitIndex = k;
          rsiHitValue = val;
          break;
        }
      }

      if (rsiHitIndex !== -1) {
        return {
          action: 'BUY',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `Ichimoku TK cross up + RSI ${rsiHitValue.toFixed(1)} in [${this.rsiBuyMin}-${this.rsiBuyMax}]`,
          metadata: {
            tenkan: currentTenkan,
            kijun: currentKijun,
            rsi: currentRsi,
            rsiHitIndex,
            rsiHitValue,
          },
        };
      }
    } else if (crossDown) {
      // Find most recent candle within lookback where RSI was in [sellMin, sellMax]
      let rsiHitIndex = -1;
      let rsiHitValue = NaN;

      for (let k = currentIndex; k >= lookbackStart; k--) {
        const val = rsi[k];
        if (Number.isFinite(val) && val >= this.rsiSellMin && val <= this.rsiSellMax) {
          rsiHitIndex = k;
          rsiHitValue = val;
          break;
        }
      }

      if (rsiHitIndex !== -1) {
        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `Ichimoku TK cross down + RSI ${rsiHitValue.toFixed(1)} in [${this.rsiSellMin}-${this.rsiSellMax}]`,
          metadata: {
            tenkan: currentTenkan,
            kijun: currentKijun,
            rsi: currentRsi,
            rsiHitIndex,
            rsiHitValue,
          },
        };
      }
    }

    return defaultSignal;
  }
}

