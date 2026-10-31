import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import type { ExitMode, TkCrossTraceEvent, CandleFunnelEvent } from '../backtest/types';
import { calculateIchimoku, type IchimokuResult } from '../indicators/ichimoku';
import { calculateStochastic, type StochasticResult } from '../indicators/stochastic';
import { calculateFisherRsi, calculateIftRsi, type FisherRsiResult } from '../indicators/fisher-rsi';
import { confirmedSwings, type ConfirmedSwingsResult, type SwingPoint } from '../indicators/swing';
import { roundTo } from '../utils/math';
import type { DailyRegimeCalculator } from '../utils/market-regime';

export type FisherMode = 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm' | 'cross-confirm' | 'f4';
export type FisherKind = 'fisher' | 'ift';
export type FisherGate = 'none' | 'zone';
export type ShortEntryFilter = 'none' | 'v1_1dBearish' | 'v2_ltfBelowCloud' | 'v3_bearRegime' | 'v4_consecutiveHtf';
export type EdgeCandidate = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6';
export type RegimeVariant = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

export interface MultiTimeframeConfig {
  htfMode?: 'strict';
  entryMode?: 'cross';
  kijunSlopeFilter?: boolean;
  structureFilter?: boolean;
  shortEntryFilter?: ShortEntryFilter;
  attributionLayer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  edgeCandidate?: EdgeCandidate;
  a6Components?: EdgeCandidate[];
  regimeVariant?: RegimeVariant;
  htf4hCandles?: readonly Candle[];
  htf1hCandles?: readonly Candle[];
  daily1dCandles?: readonly Candle[];
  dailyRegimeCalculator?: DailyRegimeCalculator | { getRegimeAt(timestamp: number): 'bull' | 'bear'; getDailyTrendAt?(timestamp: number): 1 | -1 | 0 };
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

export type MultiTimeframeStrategyConfig = MultiTimeframeConfig;

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

  // HTF 1d indicators
  daily1dCandles: readonly Candle[];
  daily1dIchimoku: IchimokuResult;

  // Cached HTF directions
  strictHtfDirections?: Int8Array;
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
  readonly edgeCandidate?: EdgeCandidate;
  readonly a6Components?: EdgeCandidate[];
  readonly regimeVariant?: RegimeVariant;

  readonly initialStopPercent: number;
  readonly useTdrStop: boolean;
  readonly tdrMultiplier: number;

  private explicitHtf4h?: readonly Candle[];
  private explicitHtf1h?: readonly Candle[];
  private explicitDaily1d?: readonly Candle[];
  public readonly dailyRegimeCalculator?: DailyRegimeCalculator | { getRegimeAt(timestamp: number): 'bull' | 'bear'; getDailyTrendAt?(timestamp: number): 1 | -1 | 0 };
  private cached1dIchimoku?: IchimokuResult;

  private indicatorCache = new WeakMap<readonly Candle[], CachedIndicators>();
  private traceCollector?: {
    onTkCross?: (event: TkCrossTraceEvent) => void;
    onCandleFunnel?: (event: CandleFunnelEvent) => void;
  };

  setTraceCollector(collector?: {
    onTkCross?: (event: TkCrossTraceEvent) => void;
    onCandleFunnel?: (event: CandleFunnelEvent) => void;
  }): void {
    this.traceCollector = collector;
  }

  constructor(config?: MultiTimeframeConfig) {
    this.kijunSlopeFilter = config?.kijunSlopeFilter ?? false;
    this.structureFilter = config?.structureFilter ?? false;
    this.shortEntryFilter = config?.shortEntryFilter ?? 'none';
    this.attributionLayer = config?.attributionLayer;
    this.edgeCandidate = config?.edgeCandidate;
    this.a6Components = config?.a6Components;
    this.regimeVariant = config?.regimeVariant;
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

      // 4. Daily 1d Candles & Indicators
      const daily1dCandles =
        this.explicitDaily1d && this.explicitDaily1d.length > 0
          ? this.explicitDaily1d
          : aggregateCandles(candles, 24 * 60 * 60 * 1000);
      const daily1dIchimoku =
        this.cached1dIchimoku && this.explicitDaily1d && this.explicitDaily1d.length > 0
          ? this.cached1dIchimoku
          : calculateIchimoku(daily1dCandles, ichiConfig);

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
        daily1dCandles,
        daily1dIchimoku,
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

  private passesKijunSlope(
    currentIndex: number,
    side: 'long' | 'short',
    ltfKijun: number[]
  ): boolean {
    if (!this.kijunSlopeFilter) return true;
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
    return true;
  }

  private passesStructure(
    candles: readonly Candle[],
    currentIndex: number,
    side: 'long' | 'short',
    cachedSwings?: ConfirmedSwingsResult
  ): boolean {
    if (!this.structureFilter) return true;
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

    return true;
  }

  private passesFilters(
    candles: readonly Candle[],
    currentIndex: number,
    side: 'long' | 'short',
    ltfKijun: number[],
    cachedSwings?: ConfirmedSwingsResult
  ): boolean {
    return (
      this.passesKijunSlope(currentIndex, side, ltfKijun) &&
      this.passesStructure(candles, currentIndex, side, cachedSwings)
    );
  }

  private hadKijunTouchRecent(
    candles: readonly Candle[],
    kijunArr: number[],
    currentIndex: number,
    lookback = 3
  ): boolean {
    for (let offset = 0; offset < lookback; offset++) {
      const idx = currentIndex - offset;
      if (idx >= 0) {
        const c = candles[idx];
        const k = kijunArr[idx];
        if (Number.isFinite(k) && c.low <= k && c.high >= k) {
          return true;
        }
      }
    }
    return false;
  }

  private isAtrAboveMedian(
    candles: readonly Candle[],
    atrArr: number[],
    currentIndex: number,
    window = 100
  ): boolean {
    if (currentIndex < window - 1) return true;
    const currentAtr = atrArr[currentIndex];
    const currentClose = candles[currentIndex].close;
    if (!Number.isFinite(currentAtr) || currentClose <= 0) return true;
    const currentRatio = currentAtr / currentClose;

    const ratios: number[] = [];
    for (let i = currentIndex - window + 1; i <= currentIndex; i++) {
      const a = atrArr[i];
      const c = candles[i].close;
      if (Number.isFinite(a) && c > 0) {
        ratios.push(a / c);
      }
    }
    if (ratios.length < 20) return true;
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
    return currentRatio > median;
  }

  private is1dBearish(timestamp: number, cached?: CachedIndicators): boolean {
    const dailyCandles = cached?.daily1dCandles ?? this.explicitDaily1d;
    const dailyIchimoku = cached?.daily1dIchimoku ?? this.cached1dIchimoku;
    if (!dailyCandles || !dailyIchimoku || dailyCandles.length === 0) {
      return false;
    }
    const dayMs = 86400000;
    let low = 0;
    let high = dailyCandles.length - 1;
    let foundIdx = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (dailyCandles[mid].timestamp + dayMs <= timestamp) {
        foundIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (foundIdx < 0) return false;
    const trend = computeStrictHtfTrend(dailyCandles[foundIdx], dailyIchimoku, foundIdx);
    return trend === -1;
  }

  private is1dBullish(timestamp: number, cached?: CachedIndicators): boolean {
    const dailyCandles = cached?.daily1dCandles ?? this.explicitDaily1d;
    const dailyIchimoku = cached?.daily1dIchimoku ?? this.cached1dIchimoku;
    if (!dailyCandles || !dailyIchimoku || dailyCandles.length === 0) {
      return false;
    }
    const dayMs = 86400000;
    let low = 0;
    let high = dailyCandles.length - 1;
    let foundIdx = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (dailyCandles[mid].timestamp + dayMs <= timestamp) {
        foundIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (foundIdx < 0) return false;
    const trend = computeStrictHtfTrend(dailyCandles[foundIdx], dailyIchimoku, foundIdx);
    return trend === 1;
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
    const cached = this.getIndicators(candles);

    if (!cached.strictHtfDirections) {
      const directions = new Int8Array(candles.length);
      const { htf4hCandles, htf4hIchimoku, htf1hCandles, htf1hIchimoku } = cached;
      const ms4h = 4 * 60 * 60 * 1000;
      const ms1h = 60 * 60 * 1000;

      const n4 = htf4hCandles.length;
      const n1 = htf1hCandles.length;

      const trends4h = new Int8Array(n4);
      for (let j = 0; j < n4; j++) {
        trends4h[j] = computeStrictHtfTrend(htf4hCandles[j], htf4hIchimoku, j);
      }
      const trends1h = new Int8Array(n1);
      for (let j = 0; j < n1; j++) {
        trends1h[j] = computeStrictHtfTrend(htf1hCandles[j], htf1hIchimoku, j);
      }

      let h4Ptr = 0;
      let h1Ptr = 0;

      for (let i = 0; i < candles.length; i++) {
        const ltfMs = this.getLtfMs(candles, i);
        const ltfEndTime = candles[i].timestamp + ltfMs;

        while (h4Ptr + 1 < n4 && htf4hCandles[h4Ptr + 1].timestamp + ms4h <= ltfEndTime) {
          h4Ptr++;
        }
        while (h1Ptr + 1 < n1 && htf1hCandles[h1Ptr + 1].timestamp + ms1h <= ltfEndTime) {
          h1Ptr++;
        }

        const valid4h = n4 > 0 && htf4hCandles[h4Ptr].timestamp + ms4h <= ltfEndTime;
        const valid1h = n1 > 0 && htf1hCandles[h1Ptr].timestamp + ms1h <= ltfEndTime;

        if (valid4h && valid1h) {
          const t4 = trends4h[h4Ptr];
          const t1 = trends1h[h1Ptr];
          if (t4 === 1 && t1 === 1) directions[i] = 1;
          else if (t4 === -1 && t1 === -1) directions[i] = -1;
        }
      }
      cached.strictHtfDirections = directions;
    }

    return (cached.strictHtfDirections[index] ?? 0) as 1 | -1 | 0;
  }

  /**
   * Evaluates macro market regime for candle at `index`:
   * - 'Bull': daily close > SMA200 AND HTF strict is Bullish (+1)
   * - 'Bear': daily close < SMA200 AND HTF strict is Bearish (-1)
   * - 'Neutral': all other cases
   */
  public getMacroRegimeAt(candles: readonly Candle[], index: number): 'Bull' | 'Bear' | 'Neutral' {
    if (index < 0 || index >= candles.length) return 'Neutral';
    const candle = candles[index];
    if (!candle) return 'Neutral';

    const dailyTrend =
      typeof this.dailyRegimeCalculator?.getDailyTrendAt === 'function'
        ? this.dailyRegimeCalculator.getDailyTrendAt(candle.timestamp)
        : this.dailyRegimeCalculator?.getRegimeAt(candle.timestamp) === 'bull'
        ? 1
        : this.dailyRegimeCalculator?.getRegimeAt(candle.timestamp) === 'bear'
        ? -1
        : 0;
    const htfDir = this.getStrictHtfDirection(candles, index);

    if (dailyTrend === 1 && htfDir === 1) return 'Bull';
    if (dailyTrend === -1 && htfDir === -1) return 'Bear';
    return 'Neutral';
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

    const isA1Active = this.edgeCandidate === 'A1' || (this.edgeCandidate === 'A6' && this.a6Components?.includes('A1'));
    const isA2Active = this.edgeCandidate === 'A2' || (this.edgeCandidate === 'A6' && this.a6Components?.includes('A2'));
    const isA3Active = this.edgeCandidate === 'A3' || (this.edgeCandidate === 'A6' && this.a6Components?.includes('A3'));
    const isA4Active = this.edgeCandidate === 'A4' || (this.edgeCandidate === 'A6' && this.a6Components?.includes('A4'));

    if (isA2Active) {
      const kijunTouch = this.hadKijunTouchRecent(candles, ltfIchimoku.kijun, currentIndex, 3);
      bullTrigger = kijunTouch && stochBullCross;
      bullBlockedByOpposite = stochBearCross;
      bearTrigger = kijunTouch && stochBearCross;
      bearBlockedByOpposite = stochBullCross;
    } else if (this.attributionLayer === 'L1') {
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

    const isTkActive = !isA2Active;
    const isStochActive =
      this.attributionLayer === 'L1' ? false : this.fisherMode === 'replace-stoch' ? false : true;
    const isFisherActive =
      this.attributionLayer === 'L1' || this.attributionLayer === 'L2' || isA2Active
        ? false
        : this.fisherMode === 'replace-stoch' ||
          this.fisherMode === 'extra-trigger' ||
          this.fisherMode === 'cross-confirm' ||
          this.fisherMode === 'f4';

    const rawTkLong = isTkActive && tkBullCross;
    const rawStochLong = isStochActive && stochBullCross;
    const rawFisherLong = isFisherActive && fisherEventBull;

    const rawTkShort = isTkActive && tkBearCross;
    const rawStochShort = isStochActive && stochBearCross;
    const rawFisherShort = isFisherActive && fisherEventBear;

    const bullCandidate =
      isA2Active
        ? Boolean(bullTrigger)
        : this.attributionLayer === 'L1'
        ? tkBullCross
        : this.attributionLayer === 'L2'
        ? tkBullCross || stochBullCross
        : this.fisherMode === 'off'
        ? tkBullCross || stochBullCross
        : this.fisherMode === 'extra-trigger'
        ? tkBullCross || stochBullCross || fisherEventBull
        : this.fisherMode === 'replace-stoch'
        ? tkBullCross || fisherEventBull
        : this.fisherMode === 'confirm'
        ? tkBullCross || stochBullCross
        : (tkBullCross || stochBullCross) && fisherEventBull;

    const bearCandidate =
      isA2Active
        ? Boolean(bearTrigger)
        : this.attributionLayer === 'L1'
        ? tkBearCross
        : this.attributionLayer === 'L2'
        ? tkBearCross || stochBearCross
        : this.fisherMode === 'off'
        ? tkBearCross || stochBearCross
        : this.fisherMode === 'extra-trigger'
        ? tkBearCross || stochBearCross || fisherEventBear
        : this.fisherMode === 'replace-stoch'
        ? tkBearCross || fisherEventBear
        : this.fisherMode === 'confirm'
        ? tkBearCross || stochBearCross
        : (tkBearCross || stochBearCross) && fisherEventBear;

    const passHtfLong = bullCandidate && Boolean(effectiveHtfBullish);
    const passKijunSlopeLong = passHtfLong && this.passesKijunSlope(currentIndex, 'long', ltfIchimoku.kijun);
    const passStructureLong = passKijunSlopeLong && this.passesStructure(candles, currentIndex, 'long', cached.ltfSwings);
    const passOppositeBlockLong = passStructureLong && !bullBlockedByOpposite;
    const passFisherConfirmLong = passOppositeBlockLong && (this.fisherMode === 'confirm' ? fisherBullConfirmed : true);

    const passHtfShort = bearCandidate && Boolean(effectiveHtfBearish);
    const passKijunSlopeShort = passHtfShort && this.passesKijunSlope(currentIndex, 'short', ltfIchimoku.kijun);
    const passStructureShort = passKijunSlopeShort && this.passesStructure(candles, currentIndex, 'short', cached.ltfSwings);
    const passOppositeBlockShort = passStructureShort && !bearBlockedByOpposite;
    const passFisherConfirmShort = passOppositeBlockShort && (this.fisherMode === 'confirm' ? fisherBearConfirmed : true);

    const macroRegime = this.regimeVariant ? this.getMacroRegimeAt(candles, currentIndex) : undefined;

    let signalEmittedLong = false;
    let tdrStopPercentLong = 0;
    let atrLong = 0;
    const maxStopPercent = 5.0;

    if (passFisherConfirmLong) {
      let allowed = true;
      if (this.regimeVariant && macroRegime !== 'Bull') allowed = false;
      if (isA3Active && !this.isAtrAboveMedian(candles, ltfAtr, currentIndex, 100)) allowed = false;
      if (isA4Active && !this.is1dBullish(candle.timestamp, cached)) allowed = false;
      atrLong = ltfAtr[currentIndex] || candle.close * 0.02;
      tdrStopPercentLong = roundTo(((atrLong * this.tdrMultiplier) / candle.close) * 100, 2);
      if (this.useTdrStop && tdrStopPercentLong > maxStopPercent) allowed = false;
      if (allowed) {
        signalEmittedLong = true;
      }
    }

    let signalEmittedShort = false;
    let tdrStopPercentShort = 0;
    let atrShort = 0;

    if (passFisherConfirmShort) {
      let allowed = true;
      if (this.regimeVariant === 'G3') allowed = false;
      if (this.regimeVariant && macroRegime !== 'Bear') allowed = false;
      if (isA3Active && !this.isAtrAboveMedian(candles, ltfAtr, currentIndex, 100)) allowed = false;
      if (isA4Active && !this.is1dBearish(candle.timestamp, cached)) allowed = false;
      if (this.shortEntryFilter === 'v1_1dBearish') {
        if (!this.is1dBearish(candle.timestamp, cached)) allowed = false;
      } else if (this.shortEntryFilter === 'v2_ltfBelowCloud') {
        const spanA = ltfIchimoku.senkouA[currentIndex];
        const spanB = ltfIchimoku.senkouB[currentIndex];
        const cloudBottom = Math.min(spanA, spanB);
        if (!Number.isFinite(cloudBottom) || !(candle.close < cloudBottom)) allowed = false;
      } else if (this.shortEntryFilter === 'v3_bearRegime') {
        if (this.dailyRegimeCalculator && this.dailyRegimeCalculator.getRegimeAt(candle.timestamp) !== 'bear') allowed = false;
      } else if (this.shortEntryFilter === 'v4_consecutiveHtf') {
        if (!this.has3ConsecutiveHtfBearish(candle.timestamp, cached, ltfMs)) allowed = false;
      }
      atrShort = ltfAtr[currentIndex] || candle.close * 0.02;
      tdrStopPercentShort = roundTo(((atrShort * this.tdrMultiplier) / candle.close) * 100, 2);
      if (this.useTdrStop && tdrStopPercentShort > maxStopPercent) allowed = false;
      if (allowed) {
        signalEmittedShort = true;
      }
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

    if (this.traceCollector?.onCandleFunnel) {
      this.traceCollector.onCandleFunnel({
        index: currentIndex,
        timestamp: candle.timestamp,
        long: {
          rawTk: rawTkLong,
          rawStoch: rawStochLong,
          rawFisher: rawFisherLong,
          candidate: bullCandidate,
          passHtf: passHtfLong,
          passKijunSlope: passKijunSlopeLong,
          passStructure: passStructureLong,
          passOppositeBlock: passOppositeBlockLong,
          passFisherConfirm: passFisherConfirmLong,
          signalEmitted: signalEmittedLong,
        },
        short: {
          rawTk: rawTkShort,
          rawStoch: rawStochShort,
          rawFisher: rawFisherShort,
          candidate: bearCandidate,
          passHtf: passHtfShort,
          passKijunSlope: passKijunSlopeShort,
          passStructure: passStructureShort,
          passOppositeBlock: passOppositeBlockShort,
          passFisherConfirm: passFisherConfirmShort,
          signalEmitted: signalEmittedShort,
        },
      });
    }

    if (signalEmittedLong) {
      let atrTrailingMeta: Record<string, unknown> = {};
      if (isA1Active) {
        const initialStopPercent = roundTo(((2.5 * atrLong) / candle.close) * 100, 2);
        const trailingStepPercent = roundTo(((2.0 * atrLong) / candle.close) * 100, 2);
        const trailingRaisePercent = roundTo(((1.0 * atrLong) / candle.close) * 100, 2);
        atrTrailingMeta = {
          useAtrTrailing: true,
          initialStopPercent,
          trailingStepPercent,
          trailingRaisePercent,
          stopPrice: roundTo(candle.close * (1 - initialStopPercent / 100), 8),
        };
      }

      const stopMetadata: Record<string, unknown> = this.useTdrStop
        ? {
            useTdrStop: true,
            tdrStopPercent: tdrStopPercentLong,
            stopPrice: roundTo(candle.close * (1 - Math.min(tdrStopPercentLong, maxStopPercent) / 100), 8),
            initialStopPercent: Math.min(tdrStopPercentLong, maxStopPercent),
          }
        : {
            atrStopEstimatePercent: tdrStopPercentLong,
          };

      return {
        action: 'BUY',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: `MTF Bullish (strict): 4h/1h aligned + LTF Cross (tk=${tkBullCross}, stoch=${stochBullCross}, fisher=${fisherEventBull})${this.useTdrStop ? ` + Stop ${Math.min(tdrStopPercentLong, maxStopPercent)}%` : ''}`,
        metadata: {
          stochK: k,
          stochD: d,
          tenkan,
          kijun,
          atr: atrLong,
          confirmations: (tkBullCross ? 1 : 0) + (stochBullCross ? 1 : 0) + (fisherEventBull ? 1 : 0),
          ichiCross: tkBullCross,
          stochCross: stochBullCross,
          fisherCross: fisherEventBull,
          fisherMode: this.fisherMode,
          fisherKind: this.fisherKind,
          fisherGate: this.fisherGate,
          ...stopMetadata,
          ...atrTrailingMeta,
        },
      };
    }

    if (signalEmittedShort) {
      let atrTrailingMeta: Record<string, unknown> = {};
      if (isA1Active) {
        const initialStopPercent = roundTo(((2.5 * atrShort) / candle.close) * 100, 2);
        const trailingStepPercent = roundTo(((2.0 * atrShort) / candle.close) * 100, 2);
        const trailingRaisePercent = roundTo(((1.0 * atrShort) / candle.close) * 100, 2);
        atrTrailingMeta = {
          useAtrTrailing: true,
          initialStopPercent,
          trailingStepPercent,
          trailingRaisePercent,
          stopPrice: roundTo(candle.close * (1 + initialStopPercent / 100), 8),
        };
      }

      const stopMetadata: Record<string, unknown> = this.useTdrStop
        ? {
            useTdrStop: true,
            tdrStopPercent: tdrStopPercentShort,
            stopPrice: roundTo(candle.close * (1 + Math.min(tdrStopPercentShort, maxStopPercent) / 100), 8),
            initialStopPercent: Math.min(tdrStopPercentShort, maxStopPercent),
          }
        : {
            atrStopEstimatePercent: tdrStopPercentShort,
          };

      return {
        action: 'SELL',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: `MTF Bearish (strict): 4h/1h aligned + LTF Cross (tk=${tkBearCross}, stoch=${stochBearCross}, fisher=${fisherEventBear})${this.useTdrStop ? ` + Stop ${Math.min(tdrStopPercentShort, maxStopPercent)}%` : ''}`,
        metadata: {
          stochK: k,
          stochD: d,
          tenkan,
          kijun,
          atr: atrShort,
          confirmations: (tkBearCross ? 1 : 0) + (stochBearCross ? 1 : 0) + (fisherEventBear ? 1 : 0),
          ichiCross: tkBearCross,
          stochCross: stochBearCross,
          fisherCross: fisherEventBear,
          fisherMode: this.fisherMode,
          fisherKind: this.fisherKind,
          fisherGate: this.fisherGate,
          ...stopMetadata,
          ...atrTrailingMeta,
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
