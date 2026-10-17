import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import type { EntryDiagnostics, ExitMode, TkCrossTraceEvent } from '../backtest/types';
import { calculateIchimoku } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';
import { roundTo } from '../utils/math';

export type CloudFilter = 'off' | 'trend' | 'strongCross';

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
  cloudFilter?: CloudFilter; // default 'off'
  rsiRecoveryCap?: number;   // default undefined (off)
  kijunSlopeFilter?: boolean; // default false
}

interface CachedIndicators {
  tenkan: number[];
  kijun: number[];
  senkouA: number[];
  senkouB: number[];
  rsi: number[];
  relation: Int8Array;
  atr: number[];
  atrPercentiles: number[];
}

function computeAtrAndPercentiles(
  candles: readonly Candle[],
  period = 14,
  windowSize = 500
): { atr: number[]; atrPercentiles: number[] } {
  const len = candles.length;
  const tr = new Float64Array(len);
  const atr = new Array<number>(len).fill(NaN);
  const atrPercentiles = new Array<number>(len).fill(50);

  if (len === 0) return { atr, atrPercentiles };

  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < len; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevC = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }

  let sumTr = 0;
  for (let i = 0; i < len; i++) {
    sumTr += tr[i];
    if (i >= period) {
      sumTr -= tr[i - period];
    }
    if (i >= period - 1) {
      atr[i] = sumTr / period;
    }
  }

  for (let i = period - 1; i < len; i++) {
    const currentAtr = atr[i];
    if (!Number.isFinite(currentAtr)) continue;
    const start = Math.max(period - 1, i - windowSize + 1);
    let countLessOrEqual = 0;
    let validCount = 0;
    for (let k = start; k <= i; k++) {
      const val = atr[k];
      if (Number.isFinite(val)) {
        validCount++;
        if (val <= currentAtr) {
          countLessOrEqual++;
        }
      }
    }
    atrPercentiles[i] = validCount > 0 ? (countLessOrEqual / validCount) * 100 : 50;
  }

  return { atr, atrPercentiles };
}

/**
 * Strategy combining Ichimoku Cloud Tenkan-sen / Kijun-sen crossovers with RSI zone confluence.
 *
 * Rules:
 * - BUY: Tenkan crosses UP through Kijun on current candle AND RSI in [buyMin, buyMax] on signal candle or within rsiLookback.
 * - SELL: Tenkan crosses DOWN through Kijun on current candle AND RSI in [sellMin, sellMax] on signal candle or within rsiLookback.
 * - Cloud filter (optional):
 *   - 'off': no cloud filter.
 *   - 'trend': BUY only if close > cloud top; SELL only if close < cloud bottom.
 *   - 'strongCross': BUY only if TK cross is above cloud; SELL only if TK cross is below cloud.
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
  readonly cloudFilter: CloudFilter;
  readonly rsiRecoveryCap?: number;
  readonly kijunSlopeFilter: boolean;

  private indicatorCache = new WeakMap<readonly Candle[], CachedIndicators>();
  private traceCollector?: { onTkCross?: (event: TkCrossTraceEvent) => void };

  setTraceCollector(collector?: { onTkCross?: (event: TkCrossTraceEvent) => void }): void {
    this.traceCollector = collector;
  }

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
    this.cloudFilter = config?.cloudFilter ?? 'off';
    this.rsiRecoveryCap =
      config?.rsiRecoveryCap !== undefined && Number.isFinite(config.rsiRecoveryCap) && config.rsiRecoveryCap >= 0
        ? config.rsiRecoveryCap
        : undefined;
    this.kijunSlopeFilter = config?.kijunSlopeFilter ?? false;

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
    const cfSuffix = this.cloudFilter !== 'off' ? `_CF${this.cloudFilter}` : '';
    const ksSuffix = this.kijunSlopeFilter ? '_KS' : '';
    this.name = `IchimokuRSI_${this.tenkan}_${this.kijun}_${this.senkouB}_${this.displacement}_RSI${this.rsiPeriod}_L${this.rsiLookback}${cfSuffix}${ksSuffix}`;
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
      const { atr, atrPercentiles } = computeAtrAndPercentiles(candles, 14, 500);

      const len = candles.length;
      const relation = new Int8Array(len);
      for (let i = 0; i < len; i++) {
        const t = ichimoku.tenkan[i];
        const k = ichimoku.kijun[i];
        if (Number.isFinite(t) && Number.isFinite(k)) {
          if (t > k) relation[i] = 1;
          else if (t < k) relation[i] = -1;
          else relation[i] = 0;
        } else {
          relation[i] = 0;
        }
      }

      cached = {
        tenkan: ichimoku.tenkan,
        kijun: ichimoku.kijun,
        senkouA: ichimoku.senkouA,
        senkouB: ichimoku.senkouB,
        rsi,
        relation,
        atr,
        atrPercentiles,
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

    const { tenkan, kijun, senkouA, senkouB, rsi, relation, atr, atrPercentiles } =
      this.getIndicators(candles);

    const currentRelation = relation[currentIndex];
    const currentTenkan = tenkan[currentIndex];
    const currentKijun = kijun[currentIndex];
    const currentRsi = rsi[currentIndex];

    // Must be a valid non-zero relation on the current candle, and finite numbers
    if (
      currentRelation === 0 ||
      !Number.isFinite(currentTenkan) ||
      !Number.isFinite(currentKijun) ||
      !Number.isFinite(currentRsi)
    ) {
      return defaultSignal;
    }

    // Find the last non-zero relation before currentIndex (scan backwards)
    let lastNonZero = 0;
    for (let k = currentIndex - 1; k >= 0; k--) {
      const t = tenkan[k];
      const kj = kijun[k];
      if (!Number.isFinite(t) || !Number.isFinite(kj)) {
        break; // Warmup boundary reached
      }
      const rel = relation[k];
      if (rel !== 0) {
        lastNonZero = rel;
        break;
      }
    }

    // Fresh crossover requires current non-zero relation to be opposite of last non-zero relation
    const crossUp = currentRelation === 1 && lastNonZero === -1;
    const crossDown = currentRelation === -1 && lastNonZero === 1;

    if (!crossUp && !crossDown) {
      return defaultSignal;
    }

    const candle = candles[currentIndex];

    // Independently calculate RSI lookback qualification and hit metadata for the crossover
    const lookbackStart = Math.max(0, currentIndex - this.rsiLookback + 1);
    let rsiHitIndex = -1;
    let rsiHitValue = NaN;

    if (crossUp) {
      for (let k = currentIndex; k >= lookbackStart; k--) {
        const val = rsi[k];
        if (Number.isFinite(val) && val >= this.rsiBuyMin && val <= this.rsiBuyMax) {
          rsiHitIndex = k;
          rsiHitValue = val;
          break;
        }
      }
    } else {
      for (let k = currentIndex; k >= lookbackStart; k--) {
        const val = rsi[k];
        if (Number.isFinite(val) && val >= this.rsiSellMin && val <= this.rsiSellMax) {
          rsiHitIndex = k;
          rsiHitValue = val;
          break;
        }
      }
    }

    const inRsiZone = rsiHitIndex !== -1;
    const rsiHitMetadata = inRsiZone
      ? {
          rsiHitIndex,
          rsiHitValue: roundTo(rsiHitValue, 2),
          rsiHitAge: currentIndex - rsiHitIndex,
        }
      : {};

    // Cloud at currentIndex (plotted at this candle, from displacement candles ago)
    const spanA = senkouA[currentIndex];
    const spanB = senkouB[currentIndex];
    const hasCloud = Number.isFinite(spanA) && Number.isFinite(spanB);
    const cloudTop = hasCloud ? Math.max(spanA, spanB) : NaN;
    const cloudBottom = hasCloud ? Math.min(spanA, spanB) : NaN;

    // Optional Cloud Filter evaluation
    if (this.cloudFilter !== 'off') {
      if (!hasCloud) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: crossUp ? 'up' : 'down',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone,
            filterRejection: 'cloudFilter',
            signalEmitted: false,
            ...rsiHitMetadata,
          });
        }
        return defaultSignal; // Insufficient history to determine cloud
      }

      if (this.cloudFilter === 'trend') {
        if (crossUp && candle.close <= cloudTop) {
          if (this.traceCollector?.onTkCross) {
            this.traceCollector.onTkCross({
              index: currentIndex,
              timestamp: candle.timestamp,
              direction: 'up',
              price: candle.close,
              rsi: roundTo(currentRsi, 2),
              inRsiZone,
              filterRejection: 'cloudFilter',
              signalEmitted: false,
              ...rsiHitMetadata,
            });
          }
          return defaultSignal;
        }
        if (crossDown && candle.close >= cloudBottom) {
          if (this.traceCollector?.onTkCross) {
            this.traceCollector.onTkCross({
              index: currentIndex,
              timestamp: candle.timestamp,
              direction: 'down',
              price: candle.close,
              rsi: roundTo(currentRsi, 2),
              inRsiZone,
              filterRejection: 'cloudFilter',
              signalEmitted: false,
              ...rsiHitMetadata,
            });
          }
          return defaultSignal;
        }
      } else if (this.cloudFilter === 'strongCross') {
        if (crossUp && !(currentTenkan > cloudTop && currentKijun > cloudTop)) {
          if (this.traceCollector?.onTkCross) {
            this.traceCollector.onTkCross({
              index: currentIndex,
              timestamp: candle.timestamp,
              direction: 'up',
              price: candle.close,
              rsi: roundTo(currentRsi, 2),
              inRsiZone,
              filterRejection: 'cloudFilter',
              signalEmitted: false,
              ...rsiHitMetadata,
            });
          }
          return defaultSignal;
        }
        if (crossDown && !(currentTenkan < cloudBottom && currentKijun < cloudBottom)) {
          if (this.traceCollector?.onTkCross) {
            this.traceCollector.onTkCross({
              index: currentIndex,
              timestamp: candle.timestamp,
              direction: 'down',
              price: candle.close,
              rsi: roundTo(currentRsi, 2),
              inRsiZone,
              filterRejection: 'cloudFilter',
              signalEmitted: false,
              ...rsiHitMetadata,
            });
          }
          return defaultSignal;
        }
      }
    }

    // Optional Kijun Slope Filter evaluation
    if (this.kijunSlopeFilter) {
      const prevKijun = currentIndex > 0 ? kijun[currentIndex - 1] : NaN;
      const isRising = Number.isFinite(prevKijun) && currentKijun > prevKijun;
      const isFalling = Number.isFinite(prevKijun) && currentKijun < prevKijun;

      if (crossUp && !isRising) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'up',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone,
            filterRejection: 'kijunSlopeFilter',
            signalEmitted: false,
            ...rsiHitMetadata,
          });
        }
        return defaultSignal;
      }

      if (crossDown && !isFalling) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'down',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone,
            filterRejection: 'kijunSlopeFilter',
            signalEmitted: false,
            ...rsiHitMetadata,
          });
        }
        return defaultSignal;
      }
    }

    if (crossUp) {
      if (!inRsiZone) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'up',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone: false,
            filterRejection: 'rsiOutOfZone',
            signalEmitted: false,
          });
        }
        return defaultSignal;
      }

      if (this.rsiRecoveryCap !== undefined && currentRsi > this.rsiBuyMax + this.rsiRecoveryCap) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'up',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone: true,
            filterRejection: 'rsiRecoveryCap',
            signalEmitted: false,
            ...rsiHitMetadata,
          });
        }
        return defaultSignal;
      }

      const priceVsCloud = !hasCloud
        ? 'inside'
        : candle.close > cloudTop
          ? 'above'
          : candle.close < cloudBottom
            ? 'below'
            : 'inside';
      const tkCrossVsCloud = !hasCloud
        ? 'inside'
        : currentTenkan > cloudTop && currentKijun > cloudTop
          ? 'above'
          : currentTenkan < cloudBottom && currentKijun < cloudBottom
            ? 'below'
            : 'inside';
      const cloudThicknessPercent =
        hasCloud && candle.close > 0
          ? roundTo((Math.abs(cloudTop - cloudBottom) / candle.close) * 100, 2)
          : 0;
      const kijunSlope =
        currentIndex >= 10 && Number.isFinite(kijun[currentIndex - 10]) && kijun[currentIndex - 10] > 0
          ? roundTo(((currentKijun - kijun[currentIndex - 10]) / kijun[currentIndex - 10]) * 100, 2)
          : 0;
      const currentAtr = atr[currentIndex];
      const atrPercentile = roundTo(atrPercentiles[currentIndex] ?? 50, 1);
      const distanceFromKijunAtr =
        Number.isFinite(currentAtr) && currentAtr > 0
          ? roundTo((candle.close - currentKijun) / currentAtr, 2)
          : 0;
      const date = new Date(candle.timestamp);
      const hourOfDayUtc = date.getUTCHours();
      const dayOfWeek = date.getUTCDay();

      const entryDiagnostics: EntryDiagnostics = {
        side: 'long',
        priceVsCloud,
        tkCrossVsCloud,
        cloudThicknessPercent,
        rsiAtEntry: roundTo(currentRsi, 2),
        rsiHitValue: roundTo(rsiHitValue, 2),
        rsiHitAge: currentIndex - rsiHitIndex,
        kijunSlope,
        atrPercentile,
        distanceFromKijunAtr,
        hourOfDayUtc,
        dayOfWeek,
      };

      if (this.traceCollector?.onTkCross) {
        this.traceCollector.onTkCross({
          index: currentIndex,
          timestamp: candle.timestamp,
          direction: 'up',
          price: candle.close,
          rsi: roundTo(currentRsi, 2),
          inRsiZone: true,
          signalEmitted: true,
          ...rsiHitMetadata,
        });
      }

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
          entryDiagnostics,
        },
      };
    } else if (crossDown) {
      if (!inRsiZone) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'down',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone: false,
            filterRejection: 'rsiOutOfZone',
            signalEmitted: false,
          });
        }
        return defaultSignal;
      }

      if (this.rsiRecoveryCap !== undefined && currentRsi < this.rsiSellMin - this.rsiRecoveryCap) {
        if (this.traceCollector?.onTkCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'down',
            price: candle.close,
            rsi: roundTo(currentRsi, 2),
            inRsiZone: true,
            filterRejection: 'rsiRecoveryCap',
            signalEmitted: false,
            ...rsiHitMetadata,
          });
        }
        return defaultSignal;
      }

      const priceVsCloud = !hasCloud
        ? 'inside'
        : candle.close > cloudTop
          ? 'above'
          : candle.close < cloudBottom
            ? 'below'
            : 'inside';
      const tkCrossVsCloud = !hasCloud
        ? 'inside'
        : currentTenkan > cloudTop && currentKijun > cloudTop
          ? 'above'
          : currentTenkan < cloudBottom && currentKijun < cloudBottom
            ? 'below'
            : 'inside';
      const cloudThicknessPercent =
        hasCloud && candle.close > 0
          ? roundTo((Math.abs(cloudTop - cloudBottom) / candle.close) * 100, 2)
          : 0;
      const kijunSlope =
        currentIndex >= 10 && Number.isFinite(kijun[currentIndex - 10]) && kijun[currentIndex - 10] > 0
          ? roundTo(((currentKijun - kijun[currentIndex - 10]) / kijun[currentIndex - 10]) * 100, 2)
          : 0;
      const currentAtr = atr[currentIndex];
      const atrPercentile = roundTo(atrPercentiles[currentIndex] ?? 50, 1);
      const distanceFromKijunAtr =
        Number.isFinite(currentAtr) && currentAtr > 0
          ? roundTo((candle.close - currentKijun) / currentAtr, 2)
          : 0;
      const date = new Date(candle.timestamp);
      const hourOfDayUtc = date.getUTCHours();
      const dayOfWeek = date.getUTCDay();

      const entryDiagnostics: EntryDiagnostics = {
        side: 'short',
        priceVsCloud,
        tkCrossVsCloud,
        cloudThicknessPercent,
        rsiAtEntry: roundTo(currentRsi, 2),
        rsiHitValue: roundTo(rsiHitValue, 2),
        rsiHitAge: currentIndex - rsiHitIndex,
        kijunSlope,
        atrPercentile,
        distanceFromKijunAtr,
        hourOfDayUtc,
        dayOfWeek,
      };

      if (this.traceCollector?.onTkCross) {
        this.traceCollector.onTkCross({
          index: currentIndex,
          timestamp: candle.timestamp,
          direction: 'down',
          price: candle.close,
          rsi: roundTo(currentRsi, 2),
          inRsiZone: true,
          signalEmitted: true,
          ...rsiHitMetadata,
        });
      }

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
          entryDiagnostics,
        },
      };
    }

    return defaultSignal;
  }

  getDiagnostics(candles: readonly Candle[]): {
    tkCrossUpCount: number;
    tkCrossDownCount: number;
    tkCrossEqualityStartCount: number;
  } {
    const { tenkan, kijun, relation } = this.getIndicators(candles);
    let tkCrossUpCount = 0;
    let tkCrossDownCount = 0;
    let tkCrossEqualityStartCount = 0;

    for (let i = this.requiredCandles; i < candles.length; i++) {
      const currentRelation = relation[i];
      if (currentRelation === 0) continue;
      const t = tenkan[i];
      const k = kijun[i];
      if (!Number.isFinite(t) || !Number.isFinite(k)) continue;

      let lastNonZero = 0;
      let prevRelIsZero = false;
      if (i > 0 && relation[i - 1] === 0) {
        prevRelIsZero = true;
      }

      for (let j = i - 1; j >= 0; j--) {
        const tj = tenkan[j];
        const kj = kijun[j];
        if (!Number.isFinite(tj) || !Number.isFinite(kj)) break;
        const rel = relation[j];
        if (rel !== 0) {
          lastNonZero = rel;
          break;
        }
      }

      const crossUp = currentRelation === 1 && lastNonZero === -1;
      const crossDown = currentRelation === -1 && lastNonZero === 1;

      if (crossUp) {
        tkCrossUpCount++;
        if (prevRelIsZero) tkCrossEqualityStartCount++;
      } else if (crossDown) {
        tkCrossDownCount++;
        if (prevRelIsZero) tkCrossEqualityStartCount++;
      }
    }

    return {
      tkCrossUpCount,
      tkCrossDownCount,
      tkCrossEqualityStartCount,
    };
  }

  /**
   * Evaluates whether an active position should exit based on exitMode.
   * Stateless, look-ahead free.
   */
  exitSignal(
    candles: readonly Candle[],
    currentIndex: number,
    side: 'long' | 'short',
    mode: ExitMode = 'tkCross'
  ): boolean {
    if (currentIndex < 1 || currentIndex >= candles.length) {
      return false;
    }

    const indicators = this.getIndicators(candles);
    const { tenkan, kijun, relation } = indicators;

    const currentTenkan = tenkan[currentIndex];
    const currentKijun = kijun[currentIndex];
    if (!Number.isFinite(currentTenkan) || !Number.isFinite(currentKijun)) {
      return false;
    }

    if (mode === 'kijun') {
      const prevKijun = kijun[currentIndex - 1];
      if (!Number.isFinite(prevKijun)) return false;
      const currentClose = candles[currentIndex].close;
      const prevClose = candles[currentIndex - 1].close;

      if (side === 'long') {
        // Exit long when close crosses below Kijun
        return prevClose >= prevKijun && currentClose < currentKijun;
      } else {
        // Exit short when close crosses above Kijun
        return prevClose <= prevKijun && currentClose > currentKijun;
      }
    }

    // Default: 'tkCross' (ANY opposite TK cross, no RSI condition required)
    const currentRelation = relation[currentIndex];
    if (currentRelation === 0) return false;

    let lastNonZero = 0;
    for (let k = currentIndex - 1; k >= 0; k--) {
      const t = tenkan[k];
      const kj = kijun[k];
      if (!Number.isFinite(t) || !Number.isFinite(kj)) break;
      if (relation[k] !== 0) {
        lastNonZero = relation[k];
        break;
      }
    }

    if (side === 'long') {
      // Opposite cross for long is down cross
      return currentRelation === -1 && lastNonZero === 1;
    } else {
      // Opposite cross for short is up cross
      return currentRelation === 1 && lastNonZero === -1;
    }
  }
}
