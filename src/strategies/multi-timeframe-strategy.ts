import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import type { ExitMode, TkCrossTraceEvent } from '../backtest/types';
import { calculateIchimoku, type IchimokuResult } from '../indicators/ichimoku';
import { calculateStochastic, type StochasticResult } from '../indicators/stochastic';
import { calculateFisherRsi, calculateIftRsi, type FisherRsiResult } from '../indicators/fisher-rsi';
import { confirmedSwings, type ConfirmedSwingsResult, type SwingPoint } from '../indicators/swing';
import { roundTo } from '../utils/math';

export type FisherMode = 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm' | 'cross-confirm' | 'f4';
export type FisherKind = 'fisher' | 'ift';
export type FisherGate = 'none' | 'zone';
export type ShortEntryFilter = 'none' | 'v1_1dBearish' | 'v2_ltfBelowCloud' | 'v3_bearRegime' | 'v4_consecutiveHtf';

export interface MultiTimeframeConfig {
  htfMode?: 'strict';
  entryMode?: 'cross';
  kijunSlopeFilter?: boolean;
  structureFilter?: boolean;
  shortEntryFilter?: ShortEntryFilter;
  attributionLayer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  htf4hCandles?: readonly Candle[];
  htf1hCandles?: readonly Candle[];
  daily1dCandles?: readonly Candle[];
  dailyRegimeCalculator?: { getRegimeAt(timestamp: number): 'bull' | 'bear' };
  ltfIntervalMs?: number;

  fisherMode?: FisherMode;
  fisherKind?: FisherKind;
  fisherGate?: FisherGate;

  // Ichimoku parameters (default: 9, 26, 52, 26)
  tenkan?: number;
  kijun?: number;
  senkouB?: number;
  displacement?: number;

  // RSI Period for Fisher/IFT (default: 14)
  rsiPeriod?: number;

  // Stochastic parameters (default: 14, 3, 3, Oversold: 30, Overbought: 70)
  stochKPeriod?: number;
  stochDPeriod?: number;
  stochSmooth?: number;
  stochOversold?: number;
  stochOverbought?: number;

  // Stop Loss & TDR configuration
  initialStopPercent?: number; // default 5%
  useTdrStop?: boolean;        // default false
  tdrMultiplier?: number;      // default 1.5
}

interface CachedIndicators {
  // LTF indicators
  ltfIchimoku: IchimokuResult;
  ltfStoch: StochasticResult;
  ltfAtr: number[];
  ltfSwings?: ConfirmedSwingsResult;
  ltfFisher?: FisherRsiResult;
  ltfIft?: number[];

  // HTF 4h indicators
  htf4hCandles: readonly Candle[];
  htf4hIchimoku: IchimokuResult;

  // HTF 1h indicators
  htf1hCandles: readonly Candle[];
  htf1hIchimoku: IchimokuResult;
}

/**
 * Resamples lower timeframe candles into higher timeframe candles causally.
 */
export function aggregateCandles(candles: readonly Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return [];

  const aggregated: Candle[] = [];
  let currentBucketStart = Math.floor(candles[0].timestamp / intervalMs) * intervalMs;
  let curOpen = candles[0].open;
  let curHigh = candles[0].high;
  let curLow = candles[0].low;
  let curClose = candles[0].close;
  let curVolume = candles[0].volume;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const bucket = Math.floor(c.timestamp / intervalMs) * intervalMs;

    if (bucket === currentBucketStart) {
      if (c.high > curHigh) curHigh = c.high;
      if (c.low < curLow) curLow = c.low;
      curClose = c.close;
      curVolume += c.volume;
    } else {
      aggregated.push({
        timestamp: currentBucketStart,
        open: curOpen,
        high: curHigh,
        low: curLow,
        close: curClose,
        volume: curVolume,
      });

      currentBucketStart = bucket;
      curOpen = c.open;
      curHigh = c.high;
      curLow = c.low;
      curClose = c.close;
      curVolume = c.volume;
    }
  }

  aggregated.push({
    timestamp: currentBucketStart,
    open: curOpen,
    high: curHigh,
    low: curLow,
    close: curClose,
    volume: curVolume,
  });

  return aggregated;
}

/**
 * Computes standard 14-period ATR
 */
export function calculateATR(candles: readonly Candle[], period = 14): number[] {
  const len = candles.length;
  const atr = new Array<number>(len).fill(NaN);
  if (len < period) return atr;

  let sumTr = 0;
  for (let i = 0; i < len; i++) {
    let tr = candles[i].high - candles[i].low;
    if (i > 0) {
      const prevClose = candles[i - 1].close;
      tr = Math.max(tr, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose));
    }
    if (i < period) {
      sumTr += tr;
      if (i === period - 1) {
        atr[i] = sumTr / period;
      }
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atr;
}

/**
 * Computes strict HTF trend direction for a single HTF candle:
 * +1 if close > cloudTop and tenkan > kijun
 * -1 if close < cloudBottom and tenkan < kijun
 * otherwise 0
 * RSI and Stochastic are strictly NOT used.
 */
export function computeStrictHtfTrend(
  candle: Candle | undefined,
  ichimoku: IchimokuResult,
  idx: number
): number {
  if (idx < 0 || !candle) return 0;
  const spanA = ichimoku.senkouA[idx];
  const spanB = ichimoku.senkouB[idx];
  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);
  const tenkan = ichimoku.tenkan[idx];
  const kijun = ichimoku.kijun[idx];

  if (
    !Number.isFinite(cloudTop) ||
    !Number.isFinite(cloudBottom) ||
    !Number.isFinite(tenkan) ||
    !Number.isFinite(kijun)
  ) {
    return 0;
  }

  if (candle.close > cloudTop && tenkan > kijun) {
    return 1;
  }
  if (candle.close < cloudBottom && tenkan < kijun) {
    return -1;
  }
  return 0;
}

/**
 * Multi-Timeframe Strategy:
 * - Macro & Intermediate Trend: Strict 4h & 1h Ichimoku alignment (Price vs Cloud, TK alignment).
 * - Confirmation: Evaluated on LTF (15m/1h/4h) using cross triggers:
 *   1. Stochastic cross (%K cross %D)
 *   2. Ichimoku TK cross (Tenkan cross Kijun)
 *   3. Fisher RSI / IFT-RSI trigger or confirmation
 * - Look-ahead free and strictly causal.
 */
export class MultiTimeframeStrategy implements Strategy {
  readonly name: string;
  readonly description = 'Multi-timeframe trend (4h/1h strict) with LTF cross trigger (Ichimoku + Stochastic + Fisher RSI/IFT)';
  readonly requiredCandles: number;

  readonly tenkan: number;
  readonly kijun: number;
  readonly senkouB: number;
  readonly displacement: number;

  readonly rsiPeriod: number;

  readonly stochKPeriod: number;
  readonly stochDPeriod: number;
  readonly stochSmooth: number;
  readonly stochOversold: number;
  readonly stochOverbought: number;

  readonly htfMode = 'strict' as const;
  readonly entryMode = 'cross' as const;
  readonly kijunSlopeFilter: boolean;
  readonly structureFilter: boolean;
  readonly ltfIntervalMs?: number;
  readonly fisherMode: FisherMode;
  readonly fisherKind: FisherKind;
  readonly fisherGate: FisherGate;
  readonly shortEntryFilter: ShortEntryFilter;
  readonly attributionLayer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

  readonly initialStopPercent: number;
  readonly useTdrStop: boolean;
  readonly tdrMultiplier: number;

  private explicitHtf4h?: readonly Candle[];
  private explicitHtf1h?: readonly Candle[];
  private explicitDaily1d?: readonly Candle[];
  private dailyRegimeCalculator?: { getRegimeAt(timestamp: number): 'bull' | 'bear' };
  private cached1dIchimoku?: IchimokuResult;

  private indicatorCache = new WeakMap<readonly Candle[], CachedIndicators>();
  private traceCollector?: { onTkCross?: (event: TkCrossTraceEvent) => void };

  setTraceCollector(collector?: { onTkCross?: (event: TkCrossTraceEvent) => void }): void {
    this.traceCollector = collector;
  }

  constructor(config?: MultiTimeframeConfig) {
    this.kijunSlopeFilter = config?.kijunSlopeFilter ?? false;
    this.structureFilter = config?.structureFilter ?? false;
    this.shortEntryFilter = config?.shortEntryFilter ?? 'none';
    this.attributionLayer = config?.attributionLayer;
    this.ltfIntervalMs = config?.ltfIntervalMs;
    this.fisherMode = config?.fisherMode ?? 'replace-stoch';
    this.fisherKind = config?.fisherKind ?? 'fisher';
    this.fisherGate = config?.fisherGate ?? 'none';

    this.explicitHtf4h = config?.htf4hCandles;
    this.explicitHtf1h = config?.htf1hCandles;
    this.explicitDaily1d = config?.daily1dCandles;
    this.dailyRegimeCalculator = config?.dailyRegimeCalculator;

    if (this.explicitDaily1d && this.explicitDaily1d.length > 0) {
      this.cached1dIchimoku = calculateIchimoku(this.explicitDaily1d, {
        tenkan: config?.tenkan ?? 9,
        kijun: config?.kijun ?? 26,
        senkouB: config?.senkouB ?? 52,
        displacement: config?.displacement ?? 26,
      });
    }

    this.tenkan = config?.tenkan ?? 9;
    this.kijun = config?.kijun ?? 26;
    this.senkouB = config?.senkouB ?? 52;
    this.displacement = config?.displacement ?? 26;

    this.rsiPeriod = config?.rsiPeriod ?? 14;

    this.stochKPeriod = config?.stochKPeriod ?? 14;
    this.stochDPeriod = config?.stochDPeriod ?? 3;
    this.stochSmooth = config?.stochSmooth ?? 3;
    this.stochOversold = config?.stochOversold ?? 30;
    this.stochOverbought = config?.stochOverbought ?? 70;

    this.initialStopPercent = config?.initialStopPercent ?? 5;
    this.useTdrStop = config?.useTdrStop ?? false;
    this.tdrMultiplier = config?.tdrMultiplier ?? 1.5;

    this.requiredCandles = Math.max(this.senkouB + this.displacement, this.rsiPeriod + 5, 50);
    this.name = `MTF_Ichimoku_${this.tenkan}_${this.kijun}_Stoch${this.stochKPeriod}`;
  }

  private getIndicators(candles: readonly Candle[]): CachedIndicators {
    let cached = this.indicatorCache.get(candles);
    if (!cached) {
      const ichiConfig = {
        tenkan: this.tenkan,
        kijun: this.kijun,
        senkouB: this.senkouB,
        displacement: this.displacement,
      };

      // 1. LTF Indicators
      const ltfIchimoku = calculateIchimoku(candles, ichiConfig);
      const ltfStoch = calculateStochastic(candles, {
        kPeriod: this.stochKPeriod,
        dPeriod: this.stochDPeriod,
        smooth: this.stochSmooth,
      });
      const ltfAtr = calculateATR(candles, 14);

      // 2. HTF 4h Candles & Indicators
      const htf4hCandles =
        this.explicitHtf4h && this.explicitHtf4h.length > 0
          ? this.explicitHtf4h
          : aggregateCandles(candles, 4 * 60 * 60 * 1000);
      const htf4hIchimoku = calculateIchimoku(htf4hCandles, ichiConfig);

      // 3. HTF 1h Candles & Indicators
      const htf1hCandles =
        this.explicitHtf1h && this.explicitHtf1h.length > 0
          ? this.explicitHtf1h
          : aggregateCandles(candles, 60 * 60 * 1000);
      const htf1hIchimoku = calculateIchimoku(htf1hCandles, ichiConfig);

      const ltfSwings = this.structureFilter ? confirmedSwings(candles, 3) : undefined;

      const ltfCloses = candles.map((c) => c.close);
      const ltfFisher =
        this.fisherMode !== 'off'
          ? calculateFisherRsi(ltfCloses, { rsiPeriod: this.rsiPeriod, window: 10 })
          : undefined;
      const ltfIft =
        this.fisherMode !== 'off'
          ? calculateIftRsi(ltfCloses, { rsiPeriod: this.rsiPeriod, wmaPeriod: 9 })
          : undefined;

      cached = {
        ltfIchimoku,
        ltfStoch,
        ltfAtr,
        ltfSwings,
        ltfFisher,
        ltfIft,
        htf4hCandles,
        htf4hIchimoku,
        htf1hCandles,
        htf1hIchimoku,
      };

      this.indicatorCache.set(candles, cached);
    }
    return cached;
  }

  private getLtfMs(candles: readonly Candle[], currentIndex: number): number {
    if (this.ltfIntervalMs && this.ltfIntervalMs > 0) return this.ltfIntervalMs;
    if (currentIndex > 0) {
      const diff = candles[currentIndex].timestamp - candles[currentIndex - 1].timestamp;
      if (diff > 0 && diff <= 24 * 60 * 60 * 1000) return diff;
    }
    if (candles.length >= 2) {
      const diff = candles[1].timestamp - candles[0].timestamp;
      if (diff > 0 && diff <= 24 * 60 * 60 * 1000) return diff;
    }
    return 15 * 60 * 1000;
  }

  /**
   * Evaluates HTF trend strictly causally up to current LTF timestamp
   */
  private getHtfBias(
    timestamp: number,
    cached: CachedIndicators,
    ltfMs: number = 15 * 60 * 1000
  ): { bullish: boolean; bearish: boolean; htf4hIdx: number; htf1hIdx: number } {
    const { htf4hCandles, htf4hIchimoku, htf1hCandles, htf1hIchimoku } = cached;

    const ms4h = 4 * 60 * 60 * 1000;
    const ms1h = 60 * 60 * 1000;
    const ltfEndTime = timestamp + ltfMs;

    // Find the latest closed 4h candle: htf.timestamp + htfMs <= ltf.timestamp + ltfMs
    let htf4hIdx = -1;
    let low4h = 0;
    let high4h = htf4hCandles.length - 1;
    while (low4h <= high4h) {
      const mid = (low4h + high4h) >> 1;
      if (htf4hCandles[mid].timestamp + ms4h <= ltfEndTime) {
        htf4hIdx = mid;
        low4h = mid + 1;
      } else {
        high4h = mid - 1;
      }
    }

    // Find the latest closed 1h candle: htf.timestamp + htfMs <= ltf.timestamp + ltfMs
    let htf1hIdx = -1;
    let low1h = 0;
    let high1h = htf1hCandles.length - 1;
    while (low1h <= high1h) {
      const mid = (low1h + high1h) >> 1;
      if (htf1hCandles[mid].timestamp + ms1h <= ltfEndTime) {
        htf1hIdx = mid;
        low1h = mid + 1;
      } else {
        high1h = mid - 1;
      }
    }

    if (htf4hIdx < 0 || htf1hIdx < 0) {
      return { bullish: false, bearish: false, htf4hIdx, htf1hIdx };
    }

    const trend4h = computeStrictHtfTrend(htf4hCandles[htf4hIdx], htf4hIchimoku, htf4hIdx);
    const trend1h = computeStrictHtfTrend(htf1hCandles[htf1hIdx], htf1hIchimoku, htf1hIdx);

    // جهت مجاز فقط وقتی غیر صفر است که روند ۱h و ۴h هر دو برابر باشند
    const bullish = trend4h === 1 && trend1h === 1;
    const bearish = trend4h === -1 && trend1h === -1;

    return { bullish, bearish, htf4hIdx, htf1hIdx };
  }

  private passesFilters(
    candles: readonly Candle[],
    currentIndex: number,
    side: 'long' | 'short',
    ltfKijun: number[],
    cachedSwings?: ConfirmedSwingsResult
  ): boolean {
    if (this.kijunSlopeFilter) {
      if (currentIndex < 5) return false;
      const kijunNow = ltfKijun[currentIndex];
      const kijunPast = ltfKijun[currentIndex - 5];
      if (!Number.isFinite(kijunNow) || !Number.isFinite(kijunPast)) return false;

      // long فقط اگر kijun[i] > kijun[i-5]؛ short فقط اگر kijun[i] < kijun[i-5]
      if (side === 'long' && !(kijunNow > kijunPast)) {
        return false;
      }
      if (side === 'short' && !(kijunNow < kijunPast)) {
        return false;
      }
    }

    if (this.structureFilter) {
      const swings = cachedSwings || confirmedSwings(candles, 3, currentIndex);
      const highs = swings.highs;
      const lows = swings.lows;

      let hLast: SwingPoint | undefined;
      let hPrev: SwingPoint | undefined;
      for (let idx = highs.length - 1; idx >= 0; idx--) {
        if (highs[idx].confirmedIndex <= currentIndex) {
          if (!hLast) {
            hLast = highs[idx];
          } else if (!hPrev) {
            hPrev = highs[idx];
            break;
          }
        }
      }

      let lLast: SwingPoint | undefined;
      let lPrev: SwingPoint | undefined;
      for (let idx = lows.length - 1; idx >= 0; idx--) {
        if (lows[idx].confirmedIndex <= currentIndex) {
          if (!lLast) {
            lLast = lows[idx];
          } else if (!lPrev) {
            lPrev = lows[idx];
            break;
          }
        }
      }

      // اگر کمتر از دو pivot داریم، سیگنال نده
      if (!hLast || !hPrev || !lLast || !lPrev) {
        return false;
      }

      // long فقط اگر HH و HL باشد
      if (side === 'long') {
        const isHH = hLast.price > hPrev.price;
        const isHL = lLast.price > lPrev.price;
        if (!isHH || !isHL) {
          return false;
        }
      }

      // short فقط اگر LH و LL باشد
      if (side === 'short') {
        const isLH = hLast.price < hPrev.price;
        const isLL = lLast.price < lPrev.price;
        if (!isLH || !isLL) {
          return false;
        }
      }
    }

    return true;
  }

  private is1dBearish(timestamp: number): boolean {
    if (!this.explicitDaily1d || !this.cached1dIchimoku || this.explicitDaily1d.length === 0) {
      return false;
    }
    const dayMs = 86400000;
    let low = 0;
    let high = this.explicitDaily1d.length - 1;
    let foundIdx = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.explicitDaily1d[mid].timestamp + dayMs <= timestamp) {
        foundIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (foundIdx < 0) return false;
    const trend = computeStrictHtfTrend(this.explicitDaily1d[foundIdx], this.cached1dIchimoku, foundIdx);
    return trend === -1;
  }

  private has3ConsecutiveHtfBearish(timestamp: number, cached: CachedIndicators, ltfMs: number): boolean {
    const ltfEndTime = timestamp + ltfMs;
    const isSub1h = ltfMs < 60 * 60 * 1000;
    const targetCandles = isSub1h ? cached.htf1hCandles : cached.htf4hCandles;
    const targetIchimoku = isSub1h ? cached.htf1hIchimoku : cached.htf4hIchimoku;
    const candleDurationMs = isSub1h ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000;

    let targetIdx = -1;
    let low = 0;
    let high = targetCandles.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (targetCandles[mid].timestamp + candleDurationMs <= ltfEndTime) {
        targetIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (targetIdx < 2) return false;

    for (let offset = 0; offset < 3; offset++) {
      const idx = targetIdx - offset;
      const trend = computeStrictHtfTrend(targetCandles[idx], targetIchimoku, idx);
      if (trend !== -1) return false;
    }
    return true;
  }

  /**
   * Returns strict HTF trend direction for the candle at `index`:
   * +1 if both 1h and 4h closed candles are strictly bullish (close > cloudTop && tenkan > kijun)
   * -1 if both 1h and 4h closed candles are strictly bearish (close < cloudBottom && tenkan < kijun)
   *  0 otherwise
   */
  public getStrictHtfDirection(candles: readonly Candle[], index: number): 1 | -1 | 0 {
    if (index < 0 || index >= candles.length) return 0;
    const candle = candles[index];
    if (!candle) return 0;

    const cached = this.getIndicators(candles);
    const ltfMs = this.getLtfMs(candles, index);
    const ltfEndTime = candle.timestamp + ltfMs;
    const ms4h = 4 * 60 * 60 * 1000;
    const ms1h = 60 * 60 * 1000;

    const { htf4hCandles, htf4hIchimoku, htf1hCandles, htf1hIchimoku } = cached;

    // Find the latest closed 4h candle: htf.timestamp + htfMs <= ltf.timestamp + ltfMs
    let htf4hIdx = -1;
    let low4h = 0;
    let high4h = htf4hCandles.length - 1;
    while (low4h <= high4h) {
      const mid = (low4h + high4h) >> 1;
      if (htf4hCandles[mid].timestamp + ms4h <= ltfEndTime) {
        htf4hIdx = mid;
        low4h = mid + 1;
      } else {
        high4h = mid - 1;
      }
    }

    // Find the latest closed 1h candle: htf.timestamp + htfMs <= ltf.timestamp + ltfMs
    let htf1hIdx = -1;
    let low1h = 0;
    let high1h = htf1hCandles.length - 1;
    while (low1h <= high1h) {
      const mid = (low1h + high1h) >> 1;
      if (htf1hCandles[mid].timestamp + ms1h <= ltfEndTime) {
        htf1hIdx = mid;
        low1h = mid + 1;
      } else {
        high1h = mid - 1;
      }
    }

    if (htf4hIdx < 0 || htf1hIdx < 0) {
      return 0;
    }

    const trend4h = computeStrictHtfTrend(htf4hCandles[htf4hIdx], htf4hIchimoku, htf4hIdx);
    const trend1h = computeStrictHtfTrend(htf1hCandles[htf1hIdx], htf1hIchimoku, htf1hIdx);

    if (trend4h === 1 && trend1h === 1) return 1;
    if (trend4h === -1 && trend1h === -1) return -1;
    return 0;
  }

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const defaultSignal: TradeSignal = {
      action: 'HOLD',
      timestamp: candles[currentIndex]?.timestamp ?? 0,
      price: candles[currentIndex]?.close ?? 0,
    };

    if (currentIndex < 1 || currentIndex >= candles.length || currentIndex < this.requiredCandles) {
      return defaultSignal;
    }

    const candle = candles[currentIndex];

    if (this.attributionLayer === 'L5') {
      const prevDir = this.getStrictHtfDirection(candles, currentIndex - 1);
      const currDir = this.getStrictHtfDirection(candles, currentIndex);
      if (prevDir !== 1 && currDir === 1) {
        return {
          action: 'BUY',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: 'L5: HTF Strict Bullish Start',
        };
      }
      if (prevDir !== -1 && currDir === -1) {
        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: 'L5: HTF Strict Bearish Start',
        };
      }
      return defaultSignal;
    }

    const cached = this.getIndicators(candles);
    const ltfMs = this.getLtfMs(candles, currentIndex);
    const { bullish: htfBullish, bearish: htfBearish } = this.getHtfBias(candle.timestamp, cached, ltfMs);

    const effectiveHtfBullish = this.attributionLayer === 'L4' ? true : htfBullish;
    const effectiveHtfBearish = this.attributionLayer === 'L4' ? true : htfBearish;

    if (!effectiveHtfBullish && !effectiveHtfBearish) {
      return defaultSignal;
    }

    const { ltfIchimoku, ltfStoch, ltfAtr } = cached;

    const tenkan = ltfIchimoku.tenkan[currentIndex];
    const kijun = ltfIchimoku.kijun[currentIndex];
    const prevTenkan = ltfIchimoku.tenkan[currentIndex - 1];
    const prevKijun = ltfIchimoku.kijun[currentIndex - 1];

    const k = ltfStoch.k[currentIndex];
    const d = ltfStoch.d[currentIndex];
    const prevK = ltfStoch.k[currentIndex - 1];
    const prevD = ltfStoch.d[currentIndex - 1];

    const tkBullCross =
      Number.isFinite(tenkan) &&
      Number.isFinite(kijun) &&
      Number.isFinite(prevTenkan) &&
      Number.isFinite(prevKijun) &&
      prevTenkan <= prevKijun &&
      tenkan > kijun;

    const tkBearCross =
      Number.isFinite(tenkan) &&
      Number.isFinite(kijun) &&
      Number.isFinite(prevTenkan) &&
      Number.isFinite(prevKijun) &&
      prevTenkan >= prevKijun &&
      tenkan < kijun;

    const stochBullCross =
      Number.isFinite(k) &&
      Number.isFinite(d) &&
      Number.isFinite(prevK) &&
      Number.isFinite(prevD) &&
      prevK <= prevD &&
      k > d;

    const stochBearCross =
      Number.isFinite(k) &&
      Number.isFinite(d) &&
      Number.isFinite(prevK) &&
      Number.isFinite(prevD) &&
      prevK >= prevD &&
      k < d;

    // Fisher / IFT events
    let fisherEventBull = false;
    let fisherEventBear = false;
    let fisherBullConfirmed = true;
    let fisherBearConfirmed = true;

    if (this.fisherMode !== 'off') {
      const fisherArr = cached.ltfFisher?.fisher;
      const signalArr = cached.ltfFisher?.signal;
      const iftArr = cached.ltfIft;

      const fCurr = fisherArr ? fisherArr[currentIndex] : NaN;
      const sCurr = signalArr ? signalArr[currentIndex] : NaN;
      const fPrev = fisherArr ? fisherArr[currentIndex - 1] : NaN;
      const sPrev = signalArr ? signalArr[currentIndex - 1] : NaN;

      const iftCurr = iftArr ? iftArr[currentIndex] : NaN;
      const iftPrev = iftArr ? iftArr[currentIndex - 1] : NaN;

      const rScore = cached.ltfFisher?.rsiScore ? cached.ltfFisher.rsiScore[currentIndex] : NaN;
      const sVal = cached.ltfFisher?.scaled ? cached.ltfFisher.scaled[currentIndex] : NaN;

      const anyCrossUp =
        Number.isFinite(fCurr) &&
        Number.isFinite(sCurr) &&
        Number.isFinite(fPrev) &&
        Number.isFinite(sPrev) &&
        fPrev <= sPrev &&
        fCurr > sCurr;

      const anyCrossDown =
        Number.isFinite(fCurr) &&
        Number.isFinite(sCurr) &&
        Number.isFinite(fPrev) &&
        Number.isFinite(sPrev) &&
        fPrev >= sPrev &&
        fCurr < sCurr;

      const bullZone =
        (Number.isFinite(rScore) && rScore <= 30) ||
        (Number.isFinite(sVal) && sVal <= 30);

      const bearZone =
        (Number.isFinite(rScore) && rScore >= 70) ||
        (Number.isFinite(sVal) && sVal >= 70);

      const fisherBullCross = this.fisherGate === 'zone' ? anyCrossUp && bullZone : anyCrossUp;
      const fisherBearCross = this.fisherGate === 'zone' ? anyCrossDown && bearZone : anyCrossDown;

      const iftBullCross =
        Number.isFinite(iftCurr) &&
        Number.isFinite(iftPrev) &&
        iftPrev <= -0.5 &&
        iftCurr > -0.5;

      const iftBearCross =
        Number.isFinite(iftCurr) &&
        Number.isFinite(iftPrev) &&
        iftPrev >= 0.5 &&
        iftCurr < 0.5;

      fisherEventBull = this.fisherKind === 'fisher' ? fisherBullCross : iftBullCross;
      fisherEventBear = this.fisherKind === 'fisher' ? fisherBearCross : iftBearCross;

      if (this.fisherMode === 'confirm') {
        fisherBullConfirmed =
          this.fisherKind === 'fisher'
            ? Number.isFinite(fCurr) && Number.isFinite(sCurr) && fCurr > sCurr
            : Number.isFinite(iftCurr) && Number.isFinite(iftPrev) && iftCurr > iftPrev;

        fisherBearConfirmed =
          this.fisherKind === 'fisher'
            ? Number.isFinite(fCurr) && Number.isFinite(sCurr) && fCurr < sCurr
            : Number.isFinite(iftCurr) && Number.isFinite(iftPrev) && iftCurr < iftPrev;
      }

      let hasRecentFisherBullCross = false;
      let hasRecentFisherBearCross = false;
      if (this.fisherMode === 'cross-confirm' || this.fisherMode === 'f4') {
        if (this.fisherKind === 'fisher' && fisherArr && signalArr) {
          for (let offset = 0; offset < 3; offset++) {
            const idx = currentIndex - offset;
            if (idx >= 1) {
              const fc = fisherArr[idx];
              const sc = signalArr[idx];
              const fp = fisherArr[idx - 1];
              const sp = signalArr[idx - 1];
              const crossUp = Number.isFinite(fc) && Number.isFinite(sc) && Number.isFinite(fp) && Number.isFinite(sp) && fp <= sp && fc > sc;
              const crossDown = Number.isFinite(fc) && Number.isFinite(sc) && Number.isFinite(fp) && Number.isFinite(sp) && fp >= sp && fc < sc;
              if (this.fisherGate === 'zone') {
                const rS = cached.ltfFisher?.rsiScore ? cached.ltfFisher.rsiScore[idx] : NaN;
                const sV = cached.ltfFisher?.scaled ? cached.ltfFisher.scaled[idx] : NaN;
                const bZ = (Number.isFinite(rS) && rS <= 30) || (Number.isFinite(sV) && sV <= 30);
                const brZ = (Number.isFinite(rS) && rS >= 70) || (Number.isFinite(sV) && sV >= 70);
                if (crossUp && bZ) hasRecentFisherBullCross = true;
                if (crossDown && brZ) hasRecentFisherBearCross = true;
              } else {
                if (crossUp) hasRecentFisherBullCross = true;
                if (crossDown) hasRecentFisherBearCross = true;
              }
            }
          }
        } else if (this.fisherKind === 'ift' && iftArr) {
          for (let offset = 0; offset < 3; offset++) {
            const idx = currentIndex - offset;
            if (idx >= 1) {
              const ic = iftArr[idx];
              const ip = iftArr[idx - 1];
              const iftUp = Number.isFinite(ic) && Number.isFinite(ip) && ip <= -0.5 && ic > -0.5;
              const iftDown = Number.isFinite(ic) && Number.isFinite(ip) && ip >= 0.5 && ic < 0.5;
              if (iftUp) hasRecentFisherBullCross = true;
              if (iftDown) hasRecentFisherBearCross = true;
            }
          }
        }
        fisherEventBull = hasRecentFisherBullCross;
        fisherEventBear = hasRecentFisherBearCross;
      }
    }

    let bullTrigger = false;
    let bearTrigger = false;
    let bullBlockedByOpposite = false;
    let bearBlockedByOpposite = false;

    if (this.attributionLayer === 'L1') {
      bullTrigger = tkBullCross;
      bullBlockedByOpposite = tkBearCross;
      bearTrigger = tkBearCross;
      bearBlockedByOpposite = tkBullCross;
    } else if (this.attributionLayer === 'L2') {
      bullTrigger = tkBullCross || stochBullCross;
      bullBlockedByOpposite = tkBearCross || stochBearCross;
      bearTrigger = tkBearCross || stochBearCross;
      bearBlockedByOpposite = tkBullCross || stochBullCross;
    } else if (this.fisherMode === 'off') {
      bullTrigger = tkBullCross || stochBullCross;
      bullBlockedByOpposite = tkBearCross || stochBearCross;
      bearTrigger = tkBearCross || stochBearCross;
      bearBlockedByOpposite = tkBullCross || stochBullCross;
    } else if (this.fisherMode === 'extra-trigger') {
      bullTrigger = tkBullCross || stochBullCross || fisherEventBull;
      bullBlockedByOpposite = tkBearCross || stochBearCross || fisherEventBear;
      bearTrigger = tkBearCross || stochBearCross || fisherEventBear;
      bearBlockedByOpposite = tkBullCross || stochBullCross || fisherEventBull;
    } else if (this.fisherMode === 'replace-stoch') {
      bullTrigger = tkBullCross || fisherEventBull;
      bullBlockedByOpposite = tkBearCross || fisherEventBear;
      bearTrigger = tkBearCross || fisherEventBear;
      bearBlockedByOpposite = tkBullCross || fisherEventBull;
    } else if (this.fisherMode === 'confirm') {
      bullTrigger = (tkBullCross || stochBullCross) && fisherBullConfirmed;
      bullBlockedByOpposite = tkBearCross || stochBearCross;
      bearTrigger = (tkBearCross || stochBearCross) && fisherBearConfirmed;
      bearBlockedByOpposite = tkBullCross || stochBullCross;
    } else if (this.fisherMode === 'cross-confirm' || this.fisherMode === 'f4') {
      bullTrigger = (tkBullCross || stochBullCross) && fisherEventBull;
      bullBlockedByOpposite = tkBearCross || stochBearCross;
      bearTrigger = (tkBearCross || stochBearCross) && fisherEventBear;
      bearBlockedByOpposite = tkBullCross || stochBullCross;
    }

    if (this.traceCollector?.onTkCross) {
      if (tkBullCross) {
        const passes = this.passesFilters(candles, currentIndex, 'long', ltfIchimoku.kijun, cached.ltfSwings);
        const emitted = Boolean(htfBullish && bullTrigger && !bullBlockedByOpposite && passes);
        const filterRejection = emitted
          ? undefined
          : !htfBullish
          ? 'cloudFilter'
          : !passes
          ? 'kijunSlopeFilter'
          : 'rsiOutOfZone';
        this.traceCollector.onTkCross({
          index: currentIndex,
          timestamp: candle.timestamp,
          direction: 'up',
          price: candle.close,
          rsi: 50,
          inRsiZone: false,
          filterRejection,
          signalEmitted: emitted,
        });
      } else if (tkBearCross) {
        const passes = this.passesFilters(candles, currentIndex, 'short', ltfIchimoku.kijun, cached.ltfSwings);
        const emitted = Boolean(htfBearish && bearTrigger && !bearBlockedByOpposite && passes);
        const filterRejection = emitted
          ? undefined
          : !htfBearish
          ? 'cloudFilter'
          : !passes
          ? 'kijunSlopeFilter'
          : 'rsiOutOfZone';
        this.traceCollector.onTkCross({
          index: currentIndex,
          timestamp: candle.timestamp,
          direction: 'down',
          price: candle.close,
          rsi: 50,
          inRsiZone: false,
          filterRejection,
          signalEmitted: emitted,
        });
      }
    }

    if (effectiveHtfBullish) {
      // Aligned cross & opposite check
      if (bullBlockedByOpposite || !bullTrigger) {
        return defaultSignal;
      }

      if (!this.passesFilters(candles, currentIndex, 'long', ltfIchimoku.kijun, cached.ltfSwings)) {
        return defaultSignal;
      }

      const atr = ltfAtr[currentIndex] || candle.close * 0.02;
      const tdrStopPercent = roundTo(((atr * this.tdrMultiplier) / candle.close) * 100, 2);
      const maxStopPercent = 5.0;

      if (this.useTdrStop && tdrStopPercent > maxStopPercent) {
        return defaultSignal;
      }

      const stopMetadata: Record<string, unknown> = this.useTdrStop
        ? {
            useTdrStop: true,
            tdrStopPercent,
            stopPrice: roundTo(candle.close * (1 - Math.min(tdrStopPercent, maxStopPercent) / 100), 8),
            initialStopPercent: Math.min(tdrStopPercent, maxStopPercent),
          }
        : {
            atrStopEstimatePercent: tdrStopPercent,
          };

      return {
        action: 'BUY',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: `MTF Bullish (strict): 4h/1h aligned + LTF Cross (tk=${tkBullCross}, stoch=${stochBullCross}, fisher=${fisherEventBull})${this.useTdrStop ? ` + Stop ${Math.min(tdrStopPercent, maxStopPercent)}%` : ''}`,
        metadata: {
          stochK: k,
          stochD: d,
          tenkan,
          kijun,
          atr,
          confirmations: (tkBullCross ? 1 : 0) + (stochBullCross ? 1 : 0) + (fisherEventBull ? 1 : 0),
          ichiCross: tkBullCross,
          stochCross: stochBullCross,
          fisherCross: fisherEventBull,
          fisherMode: this.fisherMode,
          fisherKind: this.fisherKind,
          fisherGate: this.fisherGate,
          ...stopMetadata,
        },
      };
    }

    if (effectiveHtfBearish) {
      // Aligned cross & opposite check
      if (bearBlockedByOpposite || !bearTrigger) {
        return defaultSignal;
      }

      // Check short entry filter (SH4)
      if (this.shortEntryFilter === 'v1_1dBearish') {
        if (!this.is1dBearish(candle.timestamp)) {
          return defaultSignal;
        }
      } else if (this.shortEntryFilter === 'v2_ltfBelowCloud') {
        const spanA = ltfIchimoku.senkouA[currentIndex];
        const spanB = ltfIchimoku.senkouB[currentIndex];
        const cloudBottom = Math.min(spanA, spanB);
        if (!Number.isFinite(cloudBottom) || !(candle.close < cloudBottom)) {
          return defaultSignal;
        }
      } else if (this.shortEntryFilter === 'v3_bearRegime') {
        if (this.dailyRegimeCalculator && this.dailyRegimeCalculator.getRegimeAt(candle.timestamp) !== 'bear') {
          return defaultSignal;
        }
      } else if (this.shortEntryFilter === 'v4_consecutiveHtf') {
        if (!this.has3ConsecutiveHtfBearish(candle.timestamp, cached, ltfMs)) {
          return defaultSignal;
        }
      }

      if (!this.passesFilters(candles, currentIndex, 'short', ltfIchimoku.kijun, cached.ltfSwings)) {
        return defaultSignal;
      }

      const atr = ltfAtr[currentIndex] || candle.close * 0.02;
      const tdrStopPercent = roundTo(((atr * this.tdrMultiplier) / candle.close) * 100, 2);
      const maxStopPercent = 5.0;

      if (this.useTdrStop && tdrStopPercent > maxStopPercent) {
        return defaultSignal;
      }

      const stopMetadata: Record<string, unknown> = this.useTdrStop
        ? {
            useTdrStop: true,
            tdrStopPercent,
            stopPrice: roundTo(candle.close * (1 + Math.min(tdrStopPercent, maxStopPercent) / 100), 8),
            initialStopPercent: Math.min(tdrStopPercent, maxStopPercent),
          }
        : {
            atrStopEstimatePercent: tdrStopPercent,
          };

      return {
        action: 'SELL',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: `MTF Bearish (strict): 4h/1h aligned + LTF Cross (tk=${tkBearCross}, stoch=${stochBearCross}, fisher=${fisherEventBear})${this.useTdrStop ? ` + Stop ${Math.min(tdrStopPercent, maxStopPercent)}%` : ''}`,
        metadata: {
          stochK: k,
          stochD: d,
          tenkan,
          kijun,
          atr,
          confirmations: (tkBearCross ? 1 : 0) + (stochBearCross ? 1 : 0) + (fisherEventBear ? 1 : 0),
          ichiCross: tkBearCross,
          stochCross: stochBearCross,
          fisherCross: fisherEventBear,
          fisherMode: this.fisherMode,
          fisherKind: this.fisherKind,
          fisherGate: this.fisherGate,
          ...stopMetadata,
        },
      };
    }

    return defaultSignal;
  }

  exitSignal(
    candles: readonly Candle[],
    currentIndex: number,
    side: 'long' | 'short',
    mode: ExitMode = 'trailingOnly'
  ): boolean {
    if (mode === 'trailingOnly') {
      return false;
    }

    if (currentIndex < 1 || currentIndex >= candles.length) {
      return false;
    }

    const candle = candles[currentIndex];
    const cached = this.getIndicators(candles);
    const ltfMs = this.getLtfMs(candles, currentIndex);
    const { bullish: htfBullish, bearish: htfBearish } = this.getHtfBias(candle.timestamp, cached, ltfMs);

    // Trend reversal exit
    if (mode === 'reverse' || mode === 'kijun') {
      if (side === 'long' && htfBearish) return true;
      if (side === 'short' && htfBullish) return true;
    }

    // LTF opposite TK cross exit
    if (mode === 'tkCross') {
      const tenkan = cached.ltfIchimoku.tenkan[currentIndex];
      const kijun = cached.ltfIchimoku.kijun[currentIndex];
      const prevTenkan = cached.ltfIchimoku.tenkan[currentIndex - 1];
      const prevKijun = cached.ltfIchimoku.kijun[currentIndex - 1];

      if (side === 'long' && prevTenkan >= prevKijun && tenkan < kijun) return true;
      if (side === 'short' && prevTenkan <= prevKijun && tenkan > kijun) return true;
    }

    return false;
  }
}
