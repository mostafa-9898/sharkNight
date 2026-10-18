import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import type { ExitMode } from '../backtest/types';
import { calculateIchimoku, type IchimokuResult } from '../indicators/ichimoku';
import { calculateRSI } from '../indicators/rsi';
import { calculateStochastic, type StochasticResult } from '../indicators/stochastic';
import { roundTo } from '../utils/math';

export interface MultiTimeframeConfig {
  htf4hCandles?: readonly Candle[];
  htf1hCandles?: readonly Candle[];

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
}

interface CachedIndicators {
  // LTF indicators
  ltfIchimoku: IchimokuResult;
  ltfRsi: number[];
  ltfStoch: StochasticResult;
  ltfAtr: number[];

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

  readonly trendRequirement: '4h_and_1h' | '4h_only' | 'either';
  readonly requireLtfCloudAlignment: boolean;

  readonly initialStopPercent: number;
  readonly useTdrStop: boolean;
  readonly tdrMultiplier: number;

  private explicitHtf4h?: readonly Candle[];
  private explicitHtf1h?: readonly Candle[];

  private indicatorCache = new WeakMap<readonly Candle[], CachedIndicators>();

  constructor(config?: MultiTimeframeConfig) {
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

    this.trendRequirement = config?.trendRequirement ?? '4h_and_1h';
    this.requireLtfCloudAlignment = config?.requireLtfCloudAlignment ?? true;

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

      // 3. HTF 1h Candles & Indicators
      const htf1hCandles =
        this.explicitHtf1h && this.explicitHtf1h.length > 0
          ? this.explicitHtf1h
          : aggregateCandles(candles, 60 * 60 * 1000);
      const htf1hIchimoku = calculateIchimoku(htf1hCandles, ichiConfig);

      cached = {
        ltfIchimoku,
        ltfRsi,
        ltfStoch,
        ltfAtr,
        htf4hCandles,
        htf4hIchimoku,
        htf1hCandles,
        htf1hIchimoku,
      };

      this.indicatorCache.set(candles, cached);
    }
    return cached;
  }

  /**
   * Evaluates HTF trend strictly causally up to current LTF timestamp
   */
  private getHtfBias(
    timestamp: number,
    cached: CachedIndicators
  ): { bullish: boolean; bearish: boolean; htf4hIdx: number; htf1hIdx: number } {
    const { htf4hCandles, htf4hIchimoku, htf1hCandles, htf1hIchimoku } = cached;

    const ms4h = 4 * 60 * 60 * 1000;
    const ms1h = 60 * 60 * 1000;

    // Find the latest closed 4h candle strictly before or at timestamp
    let htf4hIdx = -1;
    for (let k = htf4hCandles.length - 1; k >= 0; k--) {
      if (htf4hCandles[k].timestamp + ms4h <= timestamp) {
        htf4hIdx = k;
        break;
      }
    }

    // Find the latest closed 1h candle strictly before or at timestamp
    let htf1hIdx = -1;
    for (let k = htf1hCandles.length - 1; k >= 0; k--) {
      if (htf1hCandles[k].timestamp + ms1h <= timestamp) {
        htf1hIdx = k;
        break;
      }
    }

    if (htf4hIdx < 0 || htf1hIdx < 0) {
      return { bullish: false, bearish: false, htf4hIdx, htf1hIdx };
    }

    // 4h Trend Evaluation
    const c4h = htf4hCandles[htf4hIdx];
    const spanA4h = htf4hIchimoku.senkouA[htf4hIdx];
    const spanB4h = htf4hIchimoku.senkouB[htf4hIdx];
    const cloudTop4h = Math.max(spanA4h, spanB4h);
    const cloudBtm4h = Math.min(spanA4h, spanB4h);
    const tenkan4h = htf4hIchimoku.tenkan[htf4hIdx];
    const kijun4h = htf4hIchimoku.kijun[htf4hIdx];

    const isBull4h = c4h.close > cloudTop4h && tenkan4h >= kijun4h;
    const isBear4h = c4h.close < cloudBtm4h && tenkan4h <= kijun4h;

    // 1h Trend Evaluation
    const c1h = htf1hCandles[htf1hIdx];
    const spanA1h = htf1hIchimoku.senkouA[htf1hIdx];
    const spanB1h = htf1hIchimoku.senkouB[htf1hIdx];
    const cloudTop1h = Math.max(spanA1h, spanB1h);
    const cloudBtm1h = Math.min(spanA1h, spanB1h);
    const tenkan1h = htf1hIchimoku.tenkan[htf1hIdx];
    const kijun1h = htf1hIchimoku.kijun[htf1hIdx];

    const isBull1h = c1h.close > cloudTop1h && tenkan1h >= kijun1h;
    const isBear1h = c1h.close < cloudBtm1h && tenkan1h <= kijun1h;

    let bullish = false;
    let bearish = false;

    if (this.trendRequirement === '4h_and_1h') {
      bullish = isBull4h && (isBull1h || c1h.close > cloudBtm1h);
      bearish = isBear4h && (isBear1h || c1h.close < cloudTop1h);
    } else if (this.trendRequirement === '4h_only') {
      bullish = isBull4h;
      bearish = isBear4h;
    } else {
      bullish = isBull4h || isBull1h;
      bearish = isBear4h || isBear1h;
    }

    return { bullish, bearish, htf4hIdx, htf1hIdx };
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
    const { bullish: htfBullish, bearish: htfBearish } = this.getHtfBias(candle.timestamp, cached);

    if (!htfBullish && !htfBearish) {
      return defaultSignal;
    }

    const { ltfIchimoku, ltfRsi, ltfStoch, ltfAtr } = cached;

    // LTF Indicator values
    const k = ltfStoch.k[currentIndex];
    const d = ltfStoch.d[currentIndex];
    const prevK = ltfStoch.k[currentIndex - 1];
    const prevD = ltfStoch.d[currentIndex - 1];

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

    // 1. Stochastic Confirmation (crossover in key area)
    const stochCrossUp = prevK <= prevD && k > d && (prevK <= this.stochOversold || k <= this.stochOversold + 10);
    const stochCrossDown =
      prevK >= prevD && k < d && (prevK >= this.stochOverbought || k >= this.stochOverbought - 10);

    // 2. RSI Zone Confirmation
    const rsiBuyValid = rsi >= this.rsiBuyMin && rsi <= this.rsiBuyMax;
    const rsiSellValid = rsi >= this.rsiSellMin && rsi <= this.rsiSellMax;

    // 3. Ichimoku LTF Confirmation
    const ltfTkCrossUp = prevTenkan <= prevKijun && tenkan > kijun;
    const ltfTkCrossDown = prevTenkan >= prevKijun && tenkan < kijun;
    const ltfCloudBullish = !this.requireLtfCloudAlignment || candle.close >= cloudBtm;
    const ltfCloudBearish = !this.requireLtfCloudAlignment || candle.close <= cloudTop;

    // Confluence BUY Signal
    if (htfBullish && stochCrossUp && rsiBuyValid) {
      if (ltfTkCrossUp || (tenkan >= kijun && ltfCloudBullish)) {
        const atr = ltfAtr[currentIndex] || candle.close * 0.02;
        const initialStopPercent = this.initialStopPercent;
        const stopPrice = this.useTdrStop
          ? roundTo(candle.close - atr * this.tdrMultiplier, 8)
          : roundTo(candle.close * (1 - initialStopPercent / 100), 8);

        return {
          action: 'BUY',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `MTF Bullish: 4h/1h Trend + LTF Stoch Cross Up (%K:${roundTo(k, 1)}) + RSI ${roundTo(rsi, 1)} + Ichimoku`,
          metadata: {
            stochK: k,
            stochD: d,
            rsi,
            tenkan,
            kijun,
            atr,
            stopPrice,
            initialStopPercent,
          },
        };
      }
    }

    // Confluence SELL Signal
    if (htfBearish && stochCrossDown && rsiSellValid) {
      if (ltfTkCrossDown || (tenkan <= kijun && ltfCloudBearish)) {
        const atr = ltfAtr[currentIndex] || candle.close * 0.02;
        const initialStopPercent = this.initialStopPercent;
        const stopPrice = this.useTdrStop
          ? roundTo(candle.close + atr * this.tdrMultiplier, 8)
          : roundTo(candle.close * (1 + initialStopPercent / 100), 8);

        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: candle.close,
          reason: `MTF Bearish: 4h/1h Trend + LTF Stoch Cross Down (%K:${roundTo(k, 1)}) + RSI ${roundTo(rsi, 1)} + Ichimoku`,
          metadata: {
            stochK: k,
            stochD: d,
            rsi,
            tenkan,
            kijun,
            atr,
            stopPrice,
            initialStopPercent,
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
    mode: ExitMode = 'reverse'
  ): boolean {
    if (currentIndex < 1 || currentIndex >= candles.length) {
      return false;
    }

    const candle = candles[currentIndex];
    const cached = this.getIndicators(candles);
    const { bullish: htfBullish, bearish: htfBearish } = this.getHtfBias(candle.timestamp, cached);

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
