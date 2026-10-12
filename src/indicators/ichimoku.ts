import type { Candle } from '../data/models';
import type { Indicator, IndicatorResult } from './types';

export interface IchimokuConfig {
  tenkan?: number;
  kijun?: number;
  senkouB?: number;
  displacement?: number;
}

export interface IchimokuResult {
  tenkan: number[];
  kijun: number[];
  senkouA: number[];
  senkouB: number[];
  chikou: number[];
}

/**
 * Calculates Ichimoku Kinko Hyo components:
 * - Tenkan-sen (Conversion Line): (highest high + lowest low over tenkan period) / 2
 * - Kijun-sen (Base Line): (highest high + lowest low over kijun period) / 2
 * - Senkou Span A (Leading Span A): (tenkan + kijun) / 2, shifted forward by displacement
 * - Senkou Span B (Leading Span B): (highest high + lowest low over senkouB period) / 2, shifted forward by displacement
 * - Chikou Span (Lagging Span): close shifted back by displacement
 */
export function calculateIchimoku(
  candles: readonly Candle[],
  config?: IchimokuConfig
): IchimokuResult {
  const tenkanPeriod = config?.tenkan ?? 9;
  const kijunPeriod = config?.kijun ?? 26;
  const senkouBPeriod = config?.senkouB ?? 52;
  const displacement = config?.displacement ?? 26;

  if (
    !Number.isInteger(tenkanPeriod) ||
    !Number.isInteger(kijunPeriod) ||
    !Number.isInteger(senkouBPeriod) ||
    !Number.isInteger(displacement)
  ) {
    throw new Error('All Ichimoku parameters must be integers');
  }

  if (tenkanPeriod <= 0 || kijunPeriod <= 0 || senkouBPeriod <= 0 || displacement <= 0) {
    throw new Error('All Ichimoku parameters must be positive');
  }

  if (tenkanPeriod >= kijunPeriod || kijunPeriod >= senkouBPeriod) {
    throw new Error(
      `Parameters must satisfy tenkan (${tenkanPeriod}) < kijun (${kijunPeriod}) < senkouB (${senkouBPeriod})`
    );
  }

  const length = candles.length;
  const tenkan: number[] = new Array<number>(length).fill(NaN);
  const kijun: number[] = new Array<number>(length).fill(NaN);
  const rawSenkouA: number[] = new Array<number>(length).fill(NaN);
  const rawSenkouB: number[] = new Array<number>(length).fill(NaN);

  const forwardLength = length + displacement;
  const senkouA: number[] = new Array<number>(forwardLength).fill(NaN);
  const senkouB: number[] = new Array<number>(forwardLength).fill(NaN);
  const chikou: number[] = new Array<number>(length).fill(NaN);

  if (length === 0) {
    return { tenkan, kijun, senkouA, senkouB, chikou };
  }

  const getHighLowMid = (endIdx: number, period: number): number => {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    const startIdx = endIdx - period + 1;
    for (let k = startIdx; k <= endIdx; k++) {
      const c = candles[k];
      if (c.high > highestHigh) highestHigh = c.high;
      if (c.low < lowestLow) lowestLow = c.low;
    }
    return (highestHigh + lowestLow) / 2;
  };

  // Calculate Tenkan, Kijun, and raw Senkou spans per candle
  for (let i = 0; i < length; i++) {
    if (i >= tenkanPeriod - 1) {
      tenkan[i] = getHighLowMid(i, tenkanPeriod);
    }
    if (i >= kijunPeriod - 1) {
      kijun[i] = getHighLowMid(i, kijunPeriod);
    }
    if (!Number.isNaN(tenkan[i]) && !Number.isNaN(kijun[i])) {
      rawSenkouA[i] = (tenkan[i] + kijun[i]) / 2;
    }
    if (i >= senkouBPeriod - 1) {
      rawSenkouB[i] = getHighLowMid(i, senkouBPeriod);
    }
  }

  // Senkou Span A & B shifted forward by displacement
  for (let i = 0; i < length; i++) {
    senkouA[i + displacement] = rawSenkouA[i];
    senkouB[i + displacement] = rawSenkouB[i];
  }

  // Chikou Span shifted back by displacement (candle i shows close from candle i + displacement)
  // Last `displacement` entries remain NaN
  for (let i = 0; i < length; i++) {
    if (i + displacement < length) {
      chikou[i] = candles[i + displacement].close;
    } else {
      chikou[i] = NaN;
    }
  }

  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    chikou,
  };
}

export class IchimokuIndicator implements Indicator {
  readonly name: string;
  readonly requiredPeriod: number;
  readonly tenkan: number;
  readonly kijun: number;
  readonly senkouB: number;
  readonly displacement: number;

  constructor(config?: IchimokuConfig) {
    this.tenkan = config?.tenkan ?? 9;
    this.kijun = config?.kijun ?? 26;
    this.senkouB = config?.senkouB ?? 52;
    this.displacement = config?.displacement ?? 26;

    if (this.tenkan >= this.kijun || this.kijun >= this.senkouB) {
      throw new Error(
        `Parameters must satisfy tenkan (${this.tenkan}) < kijun (${this.kijun}) < senkouB (${this.senkouB})`
      );
    }

    this.name = `Ichimoku_${this.tenkan}_${this.kijun}_${this.senkouB}_${this.displacement}`;
    this.requiredPeriod = this.senkouB;
  }

  calculate(candles: readonly Candle[]): IndicatorResult {
    const result = calculateIchimoku(candles, {
      tenkan: this.tenkan,
      kijun: this.kijun,
      senkouB: this.senkouB,
      displacement: this.displacement,
    });

    return {
      values: result.tenkan,
      lines: {
        tenkan: result.tenkan,
        kijun: result.kijun,
        senkouA: result.senkouA,
        senkouB: result.senkouB,
        chikou: result.chikou,
      },
    };
  }
}

