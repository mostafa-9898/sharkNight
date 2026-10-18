import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import type { ExitMode, TkCrossTraceEvent } from '../backtest/types';
import { calculateIchimoku, type IchimokuResult } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';
import { calculateStochastic, type StochasticResult } from '../indicators/stochastic';
import { confirmedSwings, type ConfirmedSwingsResult, type SwingPoint } from '../indicators/swing';
import { roundTo } from '../utils/math';

export interface MultiTimeframeConfig {
  htfMode?: 'strict' | 'legacy';
  entryMode?: 'cross' | 'legacy';
  kijunSlopeFilter?: boolean;
  structureFilter?: boolean;
  htf4hCandles?: readonly Candle[];
  htf1hCandles?: readonly Candle[];
  ltfIntervalMs?: number;

  // Ichimoku parameters (default: 9, 26, 52, 26)
  tenkan?: number;
  kijun?: number;
  senkouB?: number;
  displacement?: number;

  // RSI parameters (default: 14, Buy: [20, 50], Sell: [50, 80])
  rsiPeriod?: number;
  rsiBuyMin?: number;
  rsiBuyMax?: number;
  rsiSellMin?: number;
  rsiSellMax?: number;

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

  // Strategy logic
  trendRequirement?: '4h_and_1h' | '4h_only' | 'either';
  requireLtfCloudAlignment?: boolean;
  lookbackBars?: number;       // default 3
  minConfirmations?: number;   // default 2
}

interface CachedIndicators {
  // LTF indicators
  ltfIchimoku: IchimokuResult;
  ltfRsi: number[];
  ltfStoch: StochasticResult;
  ltfAtr: number[];
  ltfSwings?: ConfirmedSwingsResult;

  // HTF 4h indicators
  htf4hCandles: readonly Candle[];
  htf4hIchimoku: IchimokuResult;
  htf4hRsi: number[];
  htf4hStoch: StochasticResult;
  htf4hAtr: number[];

  // HTF 1h indicators
  htf1hCandles: readonly Candle[];
  htf1hIchimoku: IchimokuResult;
  htf1hRsi: number[];
  htf1hStoch: StochasticResult;
  htf1hAtr: number[];
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
 * - Macro & Intermediate Trend: Determined on 4h & 1h using Ichimoku (Price vs Cloud, Cloud Twist, TK alignment).
 * - Confirmation: Evaluated on 15m / 5m using 3 indicators:
 *   1. Stochastic cross in key zone (%K cross %D in oversold <= 30 for Buy / overbought >= 70 for Sell)
 *   2. RSI in pullback/entry range ([20, 50] for Buy / [50, 80] for Sell)
 *   3. Ichimoku LTF confirmation (TK cross / bullish cloud alignment for Buy; bearish for Sell)
 * - Look-ahead free and strictly causal.
 */
export class MultiTimeframeStrategy implements Strategy {
  readonly name: string;
  readonly description = 'Multi-timeframe trend (4h/1h) with 3-indicator LTF confirmation (Ichimoku + RSI + Stochastic)';
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

  readonly stochKPeriod: number;
  readonly stochDPeriod: number;
  readonly stochSmooth: number;
  readonly stochOversold: number;
  readonly stochOverbought: number;

  readonly htfMode: 'strict' | 'legacy';
  readonly entryMode: 'cross' | 'legacy';
  readonly kijunSlopeFilter: boolean;
  readonly structureFilter: boolean;
  readonly ltfIntervalMs?: number;

  readonly trendRequirement: '4h_and_1h' | '4h_only' | 'either';
  readonly requireLtfCloudAlignment: boolean;
  readonly lookbackBars: number;
  readonly minConfirmations: number;

  readonly initialStopPercent: number;
  readonly useTdrStop: boolean;
  readonly tdrMultiplier: number;

  private explicitHtf4h?: readonly Candle[];
  private explicitHtf1h?: readonly Candle[];

  private indicatorCache = new WeakMap<readonly Candle[], CachedIndicators>();
  private traceCollector?: { onTkCross?: (event: TkCrossTraceEvent) => void };

  setTraceCollector(collector?: { onTkCross?: (event: TkCrossTraceEvent) => void }): void {
    this.traceCollector = collector;
  }

  constructor(config?: MultiTimeframeConfig) {
    this.htfMode = config?.htfMode ?? 'strict';
    this.entryMode = config?.entryMode ?? 'cross';
    this.kijunSlopeFilter = config?.kijunSlopeFilter ?? false;
    this.structureFilter = config?.structureFilter ?? false;
    this.ltfIntervalMs = config?.ltfIntervalMs;

    this.explicitHtf4h = config?.htf4hCandles;
    this.explicitHtf1h = config?.htf1hCandles;

    this.tenkan = config?.tenkan ?? 9;
    this.kijun = config?.kijun ?? 26;
    this.senkouB = config?.senkouB ?? 52;
    this.displacement = config?.displacement ?? 26;

    this.rsiPeriod = config?.rsiPeriod ?? 14;
    this.rsiBuyMin = config?.rsiBuyMin ?? 20;
    this.rsiBuyMax = config?.rsiBuyMax ?? 50;
    this.rsiSellMin = config?.rsiSellMin ?? 50;
    this.rsiSellMax = config?.rsiSellMax ?? 80;

    this.stochKPeriod = config?.stochKPeriod ?? 14;
    this.stochDPeriod = config?.stochDPeriod ?? 3;
    this.stochSmooth = config?.stochSmooth ?? 3;
    this.stochOversold = config?.stochOversold ?? 30;
    this.stochOverbought = config?.stochOverbought ?? 70;

    this.trendRequirement = config?.trendRequirement ?? 'either';
    this.requireLtfCloudAlignment = config?.requireLtfCloudAlignment ?? true;
    this.lookbackBars = Math.max(1, config?.lookbackBars ?? 3);
    this.minConfirmations = Math.max(1, Math.min(3, config?.minConfirmations ?? 2));

    this.initialStopPercent = config?.initialStopPercent ?? 5;
    this.useTdrStop = config?.useTdrStop ?? false;
    this.tdrMultiplier = config?.tdrMultiplier ?? 1.5;

    this.requiredCandles = Math.max(this.senkouB + this.displacement, this.rsiPeriod + 5, 50);
    this.name = `MTF_Ichimoku_${this.tenkan}_${this.kijun}_RSI${this.rsiPeriod}_Stoch${this.stochKPeriod}`;
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
      const ltfRsi = calculateRSI(candles.map((c) => c.close), this.rsiPeriod);
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
      const htf4hRsi = calculateRSI(htf4hCandles.map((c) => c.close), this.rsiPeriod);
      const htf4hStoch = calculateStochastic(htf4hCandles, {
        kPeriod: this.stochKPeriod,
        dPeriod: this.stochDPeriod,
        smooth: this.stochSmooth,
      });
      const htf4hAtr = calculateATR(htf4hCandles, 14);

      // 3. HTF 1h Candles & Indicators
      const htf1hCandles =
        this.explicitHtf1h && this.explicitHtf1h.length > 0
          ? this.explicitHtf1h
          : aggregateCandles(candles, 60 * 60 * 1000);
      const htf1hIchimoku = calculateIchimoku(htf1hCandles, ichiConfig);
      const htf1hRsi = calculateRSI(htf1hCandles.map((c) => c.close), this.rsiPeriod);
      const htf1hStoch = calculateStochastic(htf1hCandles, {
        kPeriod: this.stochKPeriod,
        dPeriod: this.stochDPeriod,
        smooth: this.stochSmooth,
      });
      const htf1hAtr = calculateATR(htf1hCandles, 14);

      const ltfSwings = this.structureFilter ? confirmedSwings(candles, 3) : undefined;

      cached = {
        ltfIchimoku,
        ltfRsi,
        ltfStoch,
        ltfAtr,
        ltfSwings,
        htf4hCandles,
        htf4hIchimoku,
        htf4hRsi,
        htf4hStoch,
        htf4hAtr,
        htf1hCandles,
        htf1hIchimoku,
        htf1hRsi,
        htf1hStoch,
        htf1hAtr,
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

    if (this.htfMode === 'strict') {
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

    // Find the latest closed 4h candle strictly before or at timestamp using binary search
    let htf4hIdx = -1;
    let low4h = 0;
    let high4h = htf4hCandles.length - 1;
    while (low4h <= high4h) {
      const mid = (low4h + high4h) >> 1;
      if (htf4hCandles[mid].timestamp + ms4h <= timestamp) {
        htf4hIdx = mid;
        low4h = mid + 1;
      } else {
        high4h = mid - 1;
      }
    }

    // Find the latest closed 1h candle strictly before or at timestamp using binary search
    let htf1hIdx = -1;
    let low1h = 0;
    let high1h = htf1hCandles.length - 1;
    while (low1h <= high1h) {
      const mid = (low1h + high1h) >> 1;
      if (htf1hCandles[mid].timestamp + ms1h <= timestamp) {
        htf1hIdx = mid;
        low1h = mid + 1;
      } else {
        high1h = mid - 1;
      }
    }

    if (htf4hIdx < 0 || htf1hIdx < 0) {
      return { bullish: false, bearish: false, htf4hIdx, htf1hIdx };
    }

    // 4h Trend Evaluation (Ichimoku + RSI + Stochastic + TDR)
    const c4h = htf4hCandles[htf4hIdx];
    const spanA4h = htf4hIchimoku.senkouA[htf4hIdx];
    const spanB4h = htf4hIchimoku.senkouB[htf4hIdx];
    const cloudTop4h = Math.max(spanA4h, spanB4h);
    const cloudBtm4h = Math.min(spanA4h, spanB4h);
    const tenkan4h = htf4hIchimoku.tenkan[htf4hIdx];
    const kijun4h = htf4hIchimoku.kijun[htf4hIdx];

    const rsi4h = cached.htf4hRsi[htf4hIdx];
    const stoch4hK = cached.htf4hStoch.k[htf4hIdx];
    const stoch4hD = cached.htf4hStoch.d[htf4hIdx];

    const ichiBull4h =
      tenkan4h >= kijun4h &&
      (c4h.close >= kijun4h || (!Number.isFinite(cloudTop4h) || c4h.close > cloudTop4h));

    const ichiBear4h =
      tenkan4h <= kijun4h &&
      (c4h.close <= kijun4h || (!Number.isFinite(cloudBtm4h) || c4h.close < cloudBtm4h));

    const rsiBull4h = !Number.isFinite(rsi4h) || rsi4h >= 45;
    const rsiBear4h = !Number.isFinite(rsi4h) || rsi4h <= 55;

    const stochBull4h = !Number.isFinite(stoch4hK) || stoch4hK >= stoch4hD || stoch4hK >= 30;
    const stochBear4h = !Number.isFinite(stoch4hK) || stoch4hK <= stoch4hD || stoch4hK <= 70;

    const isBull4h = ichiBull4h && rsiBull4h && stochBull4h;
    const isBear4h = ichiBear4h && rsiBear4h && stochBear4h;

    // 1h Trend Evaluation (Ichimoku + RSI + Stochastic + TDR)
    const c1h = htf1hCandles[htf1hIdx];
    const spanA1h = htf1hIchimoku.senkouA[htf1hIdx];
    const spanB1h = htf1hIchimoku.senkouB[htf1hIdx];
    const cloudTop1h = Math.max(spanA1h, spanB1h);
    const cloudBtm1h = Math.min(spanA1h, spanB1h);
    const tenkan1h = htf1hIchimoku.tenkan[htf1hIdx];
    const kijun1h = htf1hIchimoku.kijun[htf1hIdx];

    const rsi1h = cached.htf1hRsi[htf1hIdx];
    const stoch1hK = cached.htf1hStoch.k[htf1hIdx];
    const stoch1hD = cached.htf1hStoch.d[htf1hIdx];

    const ichiBull1h =
      tenkan1h >= kijun1h &&
      (c1h.close >= kijun1h || (!Number.isFinite(cloudTop1h) || c1h.close > cloudTop1h));

    const ichiBear1h =
      tenkan1h <= kijun1h &&
      (c1h.close <= kijun1h || (!Number.isFinite(cloudBtm1h) || c1h.close < cloudBtm1h));

    const rsiBull1h = !Number.isFinite(rsi1h) || rsi1h >= 45;
    const rsiBear1h = !Number.isFinite(rsi1h) || rsi1h <= 55;

    const stochBull1h = !Number.isFinite(stoch1hK) || stoch1hK >= stoch1hD || stoch1hK >= 30;
    const stochBear1h = !Number.isFinite(stoch1hK) || stoch1hK <= stoch1hD || stoch1hK <= 70;

    const isBull1h = ichiBull1h && rsiBull1h && stochBull1h;
    const isBear1h = ichiBear1h && rsiBear1h && stochBear1h;

    let bullish = false;
    let bearish = false;

    if (this.trendRequirement === '4h_only') {
      bullish = isBull4h;
      bearish = isBear4h;
    } else if (this.trendRequirement === 'either') {
      // 1h is primary for 15m; if 1h has a clear direction, it takes priority; otherwise 4h macro decides
      if (isBull1h && !isBear1h) {
        bullish = true;
      } else if (isBear1h && !isBull1h) {
        bearish = true;
      } else if (isBull4h && !isBear4h) {
        bullish = true;
      } else if (isBear4h && !isBull4h) {
        bearish = true;
      }
    } else {
      // '4h_and_1h' (default):
      // 1. Both aligned: (isBull4h && isBull1h) => bullish
      // 2. 1h breakout with 4h not strongly dumping: isBull1h && (!isBear4h || c4h.close >= kijun4h)
      // 3. 4h strong trend with 1h dip recovery: isBull4h && !isBear1h
      if (isBull4h && isBull1h) {
        bullish = true;
      } else if (isBear4h && isBear1h) {
        bearish = true;
      } else if (isBull1h && !isBear1h && (!isBear4h || c4h.close >= kijun4h)) {
        bullish = true;
      } else if (isBear1h && !isBull1h && (!isBull4h || c4h.close <= kijun4h)) {
        bearish = true;
      } else if (isBull4h && !isBear1h) {
        bullish = true;
      } else if (isBear4h && !isBull1h) {
        bearish = true;
      }
    }

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
    const cached = this.getIndicators(candles);
    const ltfMs = this.getLtfMs(candles, currentIndex);
    const { bullish: htfBullish, bearish: htfBearish } = this.getHtfBias(candle.timestamp, cached, ltfMs);

    if (!htfBullish && !htfBearish) {
      return defaultSignal;
    }

    if (this.entryMode === 'cross') {
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

      if (this.traceCollector?.onTkCross) {
        if (tkBullCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'up',
            price: candle.close,
            rsi: 50,
            inRsiZone: false,
            signalEmitted: Boolean(htfBullish && !tkBearCross && !stochBearCross),
          });
        } else if (tkBearCross) {
          this.traceCollector.onTkCross({
            index: currentIndex,
            timestamp: candle.timestamp,
            direction: 'down',
            price: candle.close,
            rsi: 50,
            inRsiZone: false,
            signalEmitted: Boolean(htfBearish && !tkBullCross && !stochBearCross),
          });
        }
      }

      if (htfBullish) {
        // Aligned cross: tkBullCross || stochBullCross
        // If opposite cross occurred: do not signal
        if (tkBearCross || stochBearCross || (!tkBullCross && !stochBullCross)) {
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

        const effectiveStopPercent = this.useTdrStop
          ? Math.min(tdrStopPercent, maxStopPercent)
          : this.initialStopPercent;
        const stopPrice = roundTo(candle.close * (1 - effectiveStopPercent / 100), 8);

        return {
          action: 'BUY',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `MTF Bullish (strict): 4h/1h aligned + LTF Cross (tk=${tkBullCross}, stoch=${stochBullCross}) + Stop ${effectiveStopPercent}%`,
          metadata: {
            stochK: k,
            stochD: d,
            tenkan,
            kijun,
            atr,
            tdrStopPercent,
            stopPrice,
            initialStopPercent: effectiveStopPercent,
            confirmations: (tkBullCross ? 1 : 0) + (stochBullCross ? 1 : 0),
            ichiCross: tkBullCross,
            stochCross: stochBullCross,
          },
        };
      }

      if (htfBearish) {
        // Aligned cross: tkBearCross || stochBearCross
        // If opposite cross occurred: do not signal
        if (tkBullCross || stochBullCross || (!tkBearCross && !stochBearCross)) {
          return defaultSignal;
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

        const effectiveStopPercent = this.useTdrStop
          ? Math.min(tdrStopPercent, maxStopPercent)
          : this.initialStopPercent;
        const stopPrice = roundTo(candle.close * (1 + effectiveStopPercent / 100), 8);

        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `MTF Bearish (strict): 4h/1h aligned + LTF Cross (tk=${tkBearCross}, stoch=${stochBearCross}) + Stop ${effectiveStopPercent}%`,
          metadata: {
            stochK: k,
            stochD: d,
            tenkan,
            kijun,
            atr,
            tdrStopPercent,
            stopPrice,
            initialStopPercent: effectiveStopPercent,
            confirmations: (tkBearCross ? 1 : 0) + (stochBearCross ? 1 : 0),
            ichiCross: tkBearCross,
            stochCross: stochBearCross,
          },
        };
      }

      return defaultSignal;
    }

    const { ltfIchimoku, ltfRsi, ltfStoch, ltfAtr } = cached;

    // LTF Indicator values
    const k = ltfStoch.k[currentIndex];
    const d = ltfStoch.d[currentIndex];

    const rsi = ltfRsi[currentIndex];

    const tenkan = ltfIchimoku.tenkan[currentIndex];
    const kijun = ltfIchimoku.kijun[currentIndex];
    const prevTenkan = ltfIchimoku.tenkan[currentIndex - 1];
    const prevKijun = ltfIchimoku.kijun[currentIndex - 1];

    const spanA = ltfIchimoku.senkouA[currentIndex];
    const spanB = ltfIchimoku.senkouB[currentIndex];
    const cloudTop = Math.max(spanA, spanB);
    const cloudBtm = Math.min(spanA, spanB);

    if (
      !Number.isFinite(k) ||
      !Number.isFinite(d) ||
      !Number.isFinite(rsi) ||
      !Number.isFinite(tenkan) ||
      !Number.isFinite(kijun)
    ) {
      return defaultSignal;
    }

    // Scan lookback window for crossover triggers (Ichimoku TK cross & Stochastic cross)
    let ichiBullCross = false;
    let ichiBearCross = false;
    let stochBullCross = false;
    let stochBearCross = false;

    const startBar = Math.max(1, currentIndex - this.lookbackBars + 1);
    for (let c = startBar; c <= currentIndex; c++) {
      // 1. Ichimoku TK cross
      if (ltfIchimoku.tenkan[c - 1] <= ltfIchimoku.kijun[c - 1] && ltfIchimoku.tenkan[c] > ltfIchimoku.kijun[c]) {
        ichiBullCross = true;
      }
      if (ltfIchimoku.tenkan[c - 1] >= ltfIchimoku.kijun[c - 1] && ltfIchimoku.tenkan[c] < ltfIchimoku.kijun[c]) {
        ichiBearCross = true;
      }

      // 2. Stochastic cross
      if (ltfStoch.k[c - 1] <= ltfStoch.d[c - 1] && ltfStoch.k[c] > ltfStoch.d[c]) {
        stochBullCross = true;
      }
      if (ltfStoch.k[c - 1] >= ltfStoch.d[c - 1] && ltfStoch.k[c] < ltfStoch.d[c]) {
        stochBearCross = true;
      }
    }

    // 3. RSI Slope in last lookbackBars closed candles
    const rsiCur = ltfRsi[currentIndex];
    const rsiPrev1 = ltfRsi[currentIndex - 1];
    const rsiPrev2 = currentIndex >= 2 ? ltfRsi[currentIndex - 2] : rsiPrev1;
    const rsiSlopingUp = Number.isFinite(rsiCur) && ((rsiCur > rsiPrev1) || (rsiCur > rsiPrev2));
    const rsiSlopingDown = Number.isFinite(rsiCur) && ((rsiCur < rsiPrev1) || (rsiCur < rsiPrev2));

    // Ichimoku alignment
    const ltfTkCrossUp = prevTenkan <= prevKijun && tenkan > kijun;
    const ltfTkCrossDown = prevTenkan >= prevKijun && tenkan < kijun;
    const ltfCloudBullish = !this.requireLtfCloudAlignment || candle.close >= cloudBtm;
    const ltfCloudBearish = !this.requireLtfCloudAlignment || candle.close <= cloudTop;

    if (this.traceCollector?.onTkCross) {
      if (ltfTkCrossUp) {
        this.traceCollector.onTkCross({
          index: currentIndex,
          timestamp: candle.timestamp,
          direction: 'up',
          price: candle.close,
          rsi: rsiCur,
          inRsiZone: rsiSlopingUp,
          signalEmitted: Boolean(htfBullish && (ichiBullCross || stochBullCross)),
        });
      } else if (ltfTkCrossDown) {
        this.traceCollector.onTkCross({
          index: currentIndex,
          timestamp: candle.timestamp,
          direction: 'down',
          price: candle.close,
          rsi: rsiCur,
          inRsiZone: rsiSlopingDown,
          signalEmitted: Boolean(htfBearish && (ichiBearCross || stochBearCross)),
        });
      }
    }

    // Confluence BUY Signal (HTF Bullish + at least 2 of 3 confirmations in last lookbackBars)
    if (htfBullish) {
      let confirmations = 0;
      if (ichiBullCross || (ltfCloudBullish && tenkan >= kijun)) confirmations++;
      if (stochBullCross) confirmations++;
      if (rsiSlopingUp) confirmations++;

      if (confirmations >= this.minConfirmations && (ichiBullCross || stochBullCross)) {
        if (!this.passesFilters(candles, currentIndex, 'long', ltfIchimoku.kijun, cached.ltfSwings)) {
          return defaultSignal;
        }

        const atr = ltfAtr[currentIndex] || candle.close * 0.02;
        const tdrStopPercent = roundTo(((atr * this.tdrMultiplier) / candle.close) * 100, 2);
        const maxStopPercent = 5.0;

        // User requirement: "اگر برآوردت بیشتر از 5 درصد بود باز نکن پوزیشن رو"
        if (this.useTdrStop && tdrStopPercent > maxStopPercent) {
          return defaultSignal;
        }

        const effectiveStopPercent = this.useTdrStop
          ? Math.min(tdrStopPercent, maxStopPercent)
          : this.initialStopPercent;
        const stopPrice = roundTo(candle.close * (1 - effectiveStopPercent / 100), 8);

        return {
          action: 'BUY',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `MTF Bullish: 4h/1h Trend + LTF ${confirmations}-of-3 Confluence (ichi=${ichiBullCross}, stoch=${stochBullCross}, rsiUp=${rsiSlopingUp}) + Stop ${effectiveStopPercent}%`,
          metadata: {
            stochK: k,
            stochD: d,
            rsi: rsiCur,
            tenkan,
            kijun,
            atr,
            tdrStopPercent,
            stopPrice,
            initialStopPercent: effectiveStopPercent,
            confirmations,
            ichiCross: ichiBullCross,
            stochCross: stochBullCross,
            rsiSlope: rsiSlopingUp,
          },
        };
      }
    }

    // Confluence SELL Signal (HTF Bearish + at least 2 of 3 confirmations in last lookbackBars)
    if (htfBearish) {
      let confirmations = 0;
      if (ichiBearCross || (ltfCloudBearish && tenkan <= kijun)) confirmations++;
      if (stochBearCross) confirmations++;
      if (rsiSlopingDown) confirmations++;

      if (confirmations >= this.minConfirmations && (ichiBearCross || stochBearCross)) {
        if (!this.passesFilters(candles, currentIndex, 'short', ltfIchimoku.kijun, cached.ltfSwings)) {
          return defaultSignal;
        }
        const atr = ltfAtr[currentIndex] || candle.close * 0.02;
        const tdrStopPercent = roundTo(((atr * this.tdrMultiplier) / candle.close) * 100, 2);
        const maxStopPercent = 5.0;

        // User requirement: "اگر برآوردت بیشتر از 5 درصد بود باز نکن پوزیشن رو"
        if (this.useTdrStop && tdrStopPercent > maxStopPercent) {
          return defaultSignal;
        }

        const effectiveStopPercent = this.useTdrStop
          ? Math.min(tdrStopPercent, maxStopPercent)
          : this.initialStopPercent;
        const stopPrice = roundTo(candle.close * (1 + effectiveStopPercent / 100), 8);

        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `MTF Bearish: 4h/1h Trend + LTF ${confirmations}-of-3 Confluence (ichi=${ichiBearCross}, stoch=${stochBearCross}, rsiDown=${rsiSlopingDown}) + Stop ${effectiveStopPercent}%`,
          metadata: {
            stochK: k,
            stochD: d,
            rsi: rsiCur,
            tenkan,
            kijun,
            atr,
            tdrStopPercent,
            stopPrice,
            initialStopPercent: effectiveStopPercent,
            confirmations,
            ichiCross: ichiBearCross,
            stochCross: stochBearCross,
            rsiSlope: rsiSlopingDown,
          },
        };
      }
    }

    return defaultSignal;
  }

  exitSignal(
    candles: readonly Candle[],
    currentIndex: number,
    side: 'long' | 'short',
    mode: ExitMode = 'trailingOnly'
  ): boolean {
    // "پس برای خروج نیازی به سیگنال نیست ، فقط با حالت تریگر کردن استاپ برو جلو"
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
