import type { Candle } from '../data/models';
import { calculateATR } from '../strategies/multi-timeframe-strategy';

export interface CandleFeatures {
  range: number;
  body: number;
  bodyRatio: number;
  upperWick: number;
  lowerWick: number;
  upperWickRatio: number;
  lowerWickRatio: number;
  closePosition: number;
  direction: 1 | -1;
  atr14: number;
}

export interface StructuralLevels {
  kijun?: number;
  cloudTop?: number;
  cloudBottom?: number;
  lastSwingLow?: number;
  lastSwingHigh?: number;
}

export interface PatternResult {
  bull: boolean;
  bear: boolean;
  strength?: number;
}

/**
 * Extracts normalized candle features for candle at index i.
 * atr14 is strictly derived from candle i-1 (prior candle) for causal, lookahead-free evaluation.
 */
export function extractCandleFeatures(
  candles: readonly Candle[],
  index: number,
  precomputedAtr?: readonly number[]
): CandleFeatures {
  if (index < 0 || index >= candles.length) {
    return {
      range: 0,
      body: 0,
      bodyRatio: 0,
      upperWick: 0,
      lowerWick: 0,
      upperWickRatio: 0,
      lowerWickRatio: 0,
      closePosition: 0.5,
      direction: 1,
      atr14: 0,
    };
  }

  const c = candles[index];
  const range = Math.max(0, c.high - c.low);
  const body = Math.abs(c.close - c.open);
  const safeRange = range > 1e-8 ? range : 1e-8;

  const bodyRatio = range > 1e-8 ? body / safeRange : 0;
  const upperWick = Math.max(0, c.high - Math.max(c.open, c.close));
  const lowerWick = Math.max(0, Math.min(c.open, c.close) - c.low);
  const upperWickRatio = range > 1e-8 ? upperWick / safeRange : 0;
  const lowerWickRatio = range > 1e-8 ? lowerWick / safeRange : 0;
  const closePosition = range > 1e-8 ? (c.close - c.low) / safeRange : 0.5;
  const direction: 1 | -1 = c.close >= c.open ? 1 : -1;

  let atr14 = range;
  if (precomputedAtr && index > 0 && !isNaN(precomputedAtr[index - 1])) {
    atr14 = precomputedAtr[index - 1];
  } else if (index >= 14) {
    // Fallback: causal ATR14 of prior candle
    let sumTr = 0;
    for (let j = index - 14; j < index; j++) {
      let tr = candles[j].high - candles[j].low;
      if (j > 0) {
        const prevC = candles[j - 1].close;
        tr = Math.max(tr, Math.abs(candles[j].high - prevC), Math.abs(candles[j].low - prevC));
      }
      sumTr += tr;
    }
    atr14 = sumTr / 14;
  }

  return {
    range,
    body,
    bodyRatio,
    upperWick,
    lowerWick,
    upperWickRatio,
    lowerWickRatio,
    closePosition,
    direction,
    atr14: atr14 > 1e-8 ? atr14 : safeRange,
  };
}

export function calcDistanceToLevel(price: number, levels?: StructuralLevels): number {
  if (!levels) return Infinity;
  let minDiff = Infinity;
  if (levels.kijun !== undefined && !isNaN(levels.kijun)) {
    minDiff = Math.min(minDiff, Math.abs(price - levels.kijun));
  }
  if (levels.cloudTop !== undefined && !isNaN(levels.cloudTop)) {
    minDiff = Math.min(minDiff, Math.abs(price - levels.cloudTop));
  }
  if (levels.cloudBottom !== undefined && !isNaN(levels.cloudBottom)) {
    minDiff = Math.min(minDiff, Math.abs(price - levels.cloudBottom));
  }
  if (levels.lastSwingLow !== undefined && !isNaN(levels.lastSwingLow)) {
    minDiff = Math.min(minDiff, Math.abs(price - levels.lastSwingLow));
  }
  if (levels.lastSwingHigh !== undefined && !isNaN(levels.lastSwingHigh)) {
    minDiff = Math.min(minDiff, Math.abs(price - levels.lastSwingHigh));
  }
  return minDiff;
}

// -------------------------------------------------------------
// 14 Definitive Candlestick Pattern Detectors (Pure Functions)
// -------------------------------------------------------------

/**
 * P1: Hammer / Shooting Star (Pin bar)
 * Bull: lowerWick >= 2*body && lowerWickRatio >= 0.60 && upperWickRatio <= 0.15 && range >= 0.8*ATR
 * Bear: upperWick >= 2*body && upperWickRatio >= 0.60 && lowerWickRatio <= 0.15 && range >= 0.8*ATR
 */
export function detectP1Pin(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 0 || i >= candles.length) return { bull: false, bear: false };
  const f = extractCandleFeatures(candles, i, atr);
  if (f.range < 0.8 * f.atr14 || f.range <= 1e-8) return { bull: false, bear: false };

  const bull =
    f.lowerWick >= 2 * f.body &&
    f.lowerWickRatio >= 0.6 &&
    f.upperWickRatio <= 0.15;

  const bear =
    f.upperWick >= 2 * f.body &&
    f.upperWickRatio >= 0.6 &&
    f.lowerWickRatio <= 0.15;

  return { bull, bear };
}

/**
 * P2: Pin Bar at Level
 * P1 is true AND close within 0.5 ATR of structural level
 */
export function detectP2PinAtLevel(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[],
  levels?: StructuralLevels
): PatternResult {
  const p1 = detectP1Pin(candles, i, atr);
  if (!p1.bull && !p1.bear) return { bull: false, bear: false };
  if (!levels) return { bull: false, bear: false };

  const f = extractCandleFeatures(candles, i, atr);
  const dist = calcDistanceToLevel(candles[i].close, levels);
  const nearLevel = dist <= 0.5 * f.atr14;

  return {
    bull: p1.bull && nearLevel,
    bear: p1.bear && nearLevel,
  };
}

/**
 * P3: Engulfing
 * Body covers prior body completely, opposite direction, bodyRatio >= 0.60, range >= 1.0 ATR
 */
export function detectP3Engulfing(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 1 || i >= candles.length) return { bull: false, bear: false };
  const f = extractCandleFeatures(candles, i, atr);
  if (f.range < 1.0 * f.atr14 || f.bodyRatio < 0.6) return { bull: false, bear: false };

  const cur = candles[i];
  const prev = candles[i - 1];

  const curTop = Math.max(cur.open, cur.close);
  const curBottom = Math.min(cur.open, cur.close);
  const prevTop = Math.max(prev.open, prev.close);
  const prevBottom = Math.min(prev.open, prev.close);

  const coversBody = curTop >= prevTop && curBottom <= prevBottom;
  if (!coversBody) return { bull: false, bear: false };

  const bull = cur.close > cur.open && prev.close < prev.open;
  const bear = cur.close < cur.open && prev.close > prev.open;

  return { bull, bear };
}

/**
 * P4: Piercing Line / Dark Cloud Cover
 * Prior body opposite; opens beyond prior close/low; closes past midpoint of prior body, but not full engulf
 */
export function detectP4PiercingDarkCloud(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 1 || i >= candles.length) return { bull: false, bear: false };
  const cur = candles[i];
  const prev = candles[i - 1];

  const prevMid = (prev.open + prev.close) / 2;

  // Bullish Piercing: prev bearish, cur opens <= prev.close, cur closes > prevMid && cur closes <= prev.open
  const bull =
    prev.close < prev.open &&
    cur.close > cur.open &&
    cur.open <= prev.close &&
    cur.close > prevMid &&
    cur.close <= prev.open;

  // Bearish Dark Cloud: prev bullish, cur opens >= prev.close, cur closes < prevMid && cur closes >= prev.open
  const bear =
    prev.close > prev.open &&
    cur.close < cur.open &&
    cur.open >= prev.close &&
    cur.close < prevMid &&
    cur.close >= prev.open;

  return { bull, bear };
}

/**
 * P5: Harami + Cross
 * Current body inside prior body; prior bodyRatio >= 0.60; opposite direction
 */
export function detectP5Harami(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 1 || i >= candles.length) return { bull: false, bear: false };
  const fPrev = extractCandleFeatures(candles, i - 1, atr);
  if (fPrev.bodyRatio < 0.6) return { bull: false, bear: false };

  const cur = candles[i];
  const prev = candles[i - 1];

  const curTop = Math.max(cur.open, cur.close);
  const curBottom = Math.min(cur.open, cur.close);
  const prevTop = Math.max(prev.open, prev.close);
  const prevBottom = Math.min(prev.open, prev.close);

  const inside = curTop <= prevTop && curBottom >= prevBottom;
  if (!inside) return { bull: false, bear: false };

  const bull = prev.close < prev.open && cur.close >= cur.open;
  const bear = prev.close > prev.open && cur.close <= cur.open;

  return { bull, bear };
}

/**
 * P6: Tweezer Top / Bottom
 * Highs / lows of two candles within 0.1 ATR, opposite directions
 */
export function detectP6Tweezers(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 1 || i >= candles.length) return { bull: false, bear: false };
  const f = extractCandleFeatures(candles, i, atr);
  const cur = candles[i];
  const prev = candles[i - 1];

  // Tweezer Bottom: lows match within 0.1 ATR; prev bear, cur bull
  const bull =
    prev.close < prev.open &&
    cur.close > cur.open &&
    Math.abs(cur.low - prev.low) <= 0.1 * f.atr14;

  // Tweezer Top: highs match within 0.1 ATR; prev bull, cur bear
  const bear =
    prev.close > prev.open &&
    cur.close < cur.open &&
    Math.abs(cur.high - prev.high) <= 0.1 * f.atr14;

  return { bull, bear };
}

/**
 * P7: Inside Bar Breakout
 * Mother candle at i-2; inside bar at i-1; breakout close at i
 */
export function detectP7InsideBarBreakout(
  candles: readonly Candle[],
  i: number
): PatternResult {
  if (i < 2 || i >= candles.length) return { bull: false, bear: false };
  const cur = candles[i];
  const inside = candles[i - 1];
  const mother = candles[i - 2];

  const isInside = inside.high <= mother.high && inside.low >= mother.low;
  if (!isInside) return { bull: false, bear: false };

  const bull = cur.close > mother.high && cur.close > cur.open;
  const bear = cur.close < mother.low && cur.close < cur.open;

  return { bull, bear };
}

/**
 * P8: Outside Bar
 * range > prior range && high >= priorHigh && low <= priorLow; close in top/bottom 25%
 */
export function detectP8OutsideBar(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 1 || i >= candles.length) return { bull: false, bear: false };
  const f = extractCandleFeatures(candles, i, atr);
  const fPrev = extractCandleFeatures(candles, i - 1, atr);

  const cur = candles[i];
  const prev = candles[i - 1];

  const isOutside = f.range > fPrev.range && cur.high >= prev.high && cur.low <= prev.low;
  if (!isOutside) return { bull: false, bear: false };

  const bull = f.closePosition >= 0.75 && cur.close > cur.open;
  const bear = f.closePosition <= 0.25 && cur.close < cur.open;

  return { bull, bear };
}

/**
 * P9: Morning / Evening Star
 * 3-candle pattern: large body, small body (<= 0.3), penetration to midpoint of first
 */
export function detectP9Stars(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 2 || i >= candles.length) return { bull: false, bear: false };
  const f1 = extractCandleFeatures(candles, i - 2, atr);
  const f2 = extractCandleFeatures(candles, i - 1, atr);

  if (f1.bodyRatio < 0.5 || f2.bodyRatio > 0.3) return { bull: false, bear: false };

  const c1 = candles[i - 2];
  const c3 = candles[i];
  const c1Mid = (c1.open + c1.close) / 2;

  // Morning Star: c1 bear, c3 bull closing >= c1Mid
  const bull = c1.close < c1.open && c3.close > c3.open && c3.close >= c1Mid;

  // Evening Star: c1 bull, c3 bear closing <= c1Mid
  const bear = c1.close > c1.open && c3.close < c3.open && c3.close <= c1Mid;

  return { bull, bear };
}

/**
 * P10: Three White Soldiers / Three Black Crows
 * 3 consecutive candles in same direction; each has bodyRatio >= 0.60; sequential closes
 */
export function detectP10ThreeSoldiersCrows(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 2 || i >= candles.length) return { bull: false, bear: false };
  const f0 = extractCandleFeatures(candles, i - 2, atr);
  const f1 = extractCandleFeatures(candles, i - 1, atr);
  const f2 = extractCandleFeatures(candles, i, atr);

  if (f0.bodyRatio < 0.6 || f1.bodyRatio < 0.6 || f2.bodyRatio < 0.6) {
    return { bull: false, bear: false };
  }

  const c0 = candles[i - 2];
  const c1 = candles[i - 1];
  const c2 = candles[i];

  const bull =
    c0.close > c0.open &&
    c1.close > c1.open &&
    c2.close > c2.open &&
    c2.close > c1.close &&
    c1.close > c0.close;

  const bear =
    c0.close < c0.open &&
    c1.close < c1.open &&
    c2.close < c2.open &&
    c2.close < c1.close &&
    c1.close < c0.close;

  return { bull, bear };
}

/**
 * P11: Marubozu after Squeeze
 * Prior 3 candles range < 0.7 ATR; current bodyRatio >= 0.85
 */
export function detectP11MarubozuSqueeze(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[]
): PatternResult {
  if (i < 3 || i >= candles.length) return { bull: false, bear: false };
  const f = extractCandleFeatures(candles, i, atr);
  if (f.bodyRatio < 0.85) return { bull: false, bear: false };

  const f1 = extractCandleFeatures(candles, i - 1, atr);
  const f2 = extractCandleFeatures(candles, i - 2, atr);
  const f3 = extractCandleFeatures(candles, i - 3, atr);

  const squeeze =
    f1.range < 0.7 * f.atr14 &&
    f2.range < 0.7 * f.atr14 &&
    f3.range < 0.7 * f.atr14;

  if (!squeeze) return { bull: false, bear: false };

  const bull = candles[i].close > candles[i].open;
  const bear = candles[i].close < candles[i].open;

  return { bull, bear };
}

/**
 * P12: Doji at Level with Confirmation
 * Prior candle is Doji (bodyRatio <= 0.1) near level (<= 0.5 ATR), current confirms
 */
export function detectP12DojiAtLevel(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[],
  levels?: StructuralLevels
): PatternResult {
  if (i < 1 || i >= candles.length || !levels) return { bull: false, bear: false };
  const fPrev = extractCandleFeatures(candles, i - 1, atr);
  if (fPrev.bodyRatio > 0.1) return { bull: false, bear: false };

  const dist = calcDistanceToLevel(candles[i - 1].close, levels);
  if (dist > 0.5 * fPrev.atr14) return { bull: false, bear: false };

  const cur = candles[i];
  const prev = candles[i - 1];

  const bull = cur.close > prev.high;
  const bear = cur.close < prev.low;

  return { bull, bear };
}

/**
 * P13: Liquidity Sweep (Stop Hunt)
 * Wick pierces beyond confirmed swing point, but closes back inside; range >= 1.0 ATR
 */
export function detectP13LiquiditySweep(
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[],
  levels?: StructuralLevels
): PatternResult {
  if (i < 0 || i >= candles.length || !levels) return { bull: false, bear: false };
  const f = extractCandleFeatures(candles, i, atr);
  if (f.range < 1.0 * f.atr14) return { bull: false, bear: false };

  const cur = candles[i];

  // Bullish: sweeps below swing low, closes above swing low
  const bull =
    levels.lastSwingLow !== undefined &&
    cur.low < levels.lastSwingLow &&
    cur.close > levels.lastSwingLow;

  // Bearish: sweeps above swing high, closes below swing high
  const bear =
    levels.lastSwingHigh !== undefined &&
    cur.high > levels.lastSwingHigh &&
    cur.close < levels.lastSwingHigh;

  return { bull, bear };
}

/**
 * P14: Fakey (Inside Bar False Breakout)
 * Mother at i-2, inside at i-1; candle i breaks mother high/low but closes back inside mother range
 */
export function detectP14Fakey(
  candles: readonly Candle[],
  i: number
): PatternResult {
  if (i < 2 || i >= candles.length) return { bull: false, bear: false };
  const cur = candles[i];
  const inside = candles[i - 1];
  const mother = candles[i - 2];

  const isInside = inside.high <= mother.high && inside.low >= mother.low;
  if (!isInside) return { bull: false, bear: false };

  // Bullish Fakey: false break of mother low (low < mother.low, close > mother.low, close > open)
  const bull = cur.low < mother.low && cur.close > mother.low && cur.close > cur.open;

  // Bearish Fakey: false break of mother high (high > mother.high, close < mother.high, close < open)
  const bear = cur.high > mother.high && cur.close < mother.high && cur.close < cur.open;

  return { bull, bear };
}

export type PatternDetectorFn = (
  candles: readonly Candle[],
  i: number,
  atr?: readonly number[],
  levels?: StructuralLevels
) => PatternResult;

export const CANDLE_PATTERN_DETECTORS: Record<string, PatternDetectorFn> = {
  P1: (c, i, atr) => detectP1Pin(c, i, atr),
  P2: (c, i, atr, lvl) => detectP2PinAtLevel(c, i, atr, lvl),
  P3: (c, i, atr) => detectP3Engulfing(c, i, atr),
  P4: (c, i, atr) => detectP4PiercingDarkCloud(c, i, atr),
  P5: (c, i, atr) => detectP5Harami(c, i, atr),
  P6: (c, i, atr) => detectP6Tweezers(c, i, atr),
  P7: (c, i) => detectP7InsideBarBreakout(c, i),
  P8: (c, i, atr) => detectP8OutsideBar(c, i, atr),
  P9: (c, i, atr) => detectP9Stars(c, i, atr),
  P10: (c, i, atr) => detectP10ThreeSoldiersCrows(c, i, atr),
  P11: (c, i, atr) => detectP11MarubozuSqueeze(c, i, atr),
  P12: (c, i, atr, lvl) => detectP12DojiAtLevel(c, i, atr, lvl),
  P13: (c, i, atr, lvl) => detectP13LiquiditySweep(c, i, atr, lvl),
  P14: (c, i) => detectP14Fakey(c, i),
};
