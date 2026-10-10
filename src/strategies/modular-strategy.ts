import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from './types';
import { calculateSMA } from '../indicators/sma';
import { calculateEMA } from '../indicators/ema';
import { calculateRSI } from '../indicators/rsi';
import { calculateMACD } from '../indicators/macd';

export interface MAConfig {
  enabled: boolean;
  type: 'ema' | 'sma';
  fastPeriod: number;
  slowPeriod: number;
}

export interface RSIConfig {
  enabled: boolean;
  period: number;
  oversold: number;
  overbought: number;
}

export interface MACDConfigSettings {
  enabled: boolean;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}

export interface ModularStrategyConfig {
  ma?: Partial<MAConfig>;
  rsi?: Partial<RSIConfig>;
  macd?: Partial<MACDConfigSettings>;
}

/**
 * Modular Multi-Indicator Strategy.
 * Allows independent on/off toggling of:
 * - MA (EMA / SMA) Crossover
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 */
export class ModularStrategy implements Strategy {
  readonly name: string;
  readonly description: string;
  readonly requiredCandles: number;

  readonly ma: MAConfig;
  readonly rsi: RSIConfig;
  readonly macd: MACDConfigSettings;

  // Cached precomputed series for the current candles reference
  private cachedCandlesRef: readonly Candle[] | null = null;
  private cachedFastMA: number[] = [];
  private cachedSlowMA: number[] = [];
  private cachedRSI: number[] = [];
  private cachedMACD: { macd: number[]; signal: number[]; histogram: number[] } | null = null;

  constructor(config?: ModularStrategyConfig) {
    this.ma = {
      enabled: config?.ma?.enabled ?? true,
      type: config?.ma?.type ?? 'ema',
      fastPeriod: config?.ma?.fastPeriod ?? 10,
      slowPeriod: config?.ma?.slowPeriod ?? 30,
    };

    this.rsi = {
      enabled: config?.rsi?.enabled ?? false,
      period: config?.rsi?.period ?? 14,
      oversold: config?.rsi?.oversold ?? 30,
      overbought: config?.rsi?.overbought ?? 70,
    };

    this.macd = {
      enabled: config?.macd?.enabled ?? false,
      fastPeriod: config?.macd?.fastPeriod ?? 12,
      slowPeriod: config?.macd?.slowPeriod ?? 26,
      signalPeriod: config?.macd?.signalPeriod ?? 9,
    };

    if (!this.ma.enabled && !this.rsi.enabled && !this.macd.enabled) {
      throw new Error('At least one indicator must be enabled in ModularStrategy');
    }

    if (this.ma.enabled) {
      if (this.ma.fastPeriod <= 0 || this.ma.slowPeriod <= 0) {
        throw new Error('MA periods must be positive integers');
      }
      if (this.ma.fastPeriod >= this.ma.slowPeriod) {
        throw new Error(
          `Fast MA period (${this.ma.fastPeriod}) must be less than Slow MA period (${this.ma.slowPeriod})`
        );
      }
    }

    if (this.rsi.enabled) {
      if (this.rsi.period <= 0) {
        throw new Error('RSI period must be a positive integer');
      }
      if (this.rsi.oversold >= this.rsi.overbought) {
        throw new Error(
          `RSI oversold (${this.rsi.oversold}) must be strictly less than overbought (${this.rsi.overbought})`
        );
      }
    }

    if (this.macd.enabled) {
      if (this.macd.fastPeriod >= this.macd.slowPeriod) {
        throw new Error(
          `MACD fastPeriod (${this.macd.fastPeriod}) must be less than slowPeriod (${this.macd.slowPeriod})`
        );
      }
    }

    let minRequired = 5;
    if (this.ma.enabled) {
      minRequired = Math.max(minRequired, this.ma.slowPeriod + 2);
    }
    if (this.rsi.enabled) {
      minRequired = Math.max(minRequired, this.rsi.period + 3);
    }
    if (this.macd.enabled) {
      minRequired = Math.max(minRequired, this.macd.slowPeriod + this.macd.signalPeriod + 2);
    }

    this.requiredCandles = minRequired;

    const activeList: string[] = [];
    if (this.ma.enabled) activeList.push(`${this.ma.type.toUpperCase()}(${this.ma.fastPeriod}/${this.ma.slowPeriod})`);
    if (this.rsi.enabled) activeList.push(`RSI(${this.rsi.period})`);
    if (this.macd.enabled) activeList.push(`MACD(${this.macd.fastPeriod}/${this.macd.slowPeriod})`);

    this.name = `ModularStrategy_${activeList.join('_')}`;
    this.description = `Trades using dynamic combination of [${activeList.join(', ')}]`;
  }

  private ensureCached(candles: readonly Candle[]): void {
    if (this.cachedCandlesRef === candles) {
      return;
    }

    this.cachedCandlesRef = candles;
    const closes = candles.map((c) => c.close);

    if (this.ma.enabled) {
      this.cachedFastMA =
        this.ma.type === 'ema'
          ? calculateEMA(closes, this.ma.fastPeriod)
          : calculateSMA(closes, this.ma.fastPeriod);

      this.cachedSlowMA =
        this.ma.type === 'ema'
          ? calculateEMA(closes, this.ma.slowPeriod)
          : calculateSMA(closes, this.ma.slowPeriod);
    } else {
      this.cachedFastMA = [];
      this.cachedSlowMA = [];
    }

    if (this.rsi.enabled) {
      this.cachedRSI = calculateRSI(closes, this.rsi.period);
    } else {
      this.cachedRSI = [];
    }

    if (this.macd.enabled) {
      this.cachedMACD = calculateMACD(closes, {
        fastPeriod: this.macd.fastPeriod,
        slowPeriod: this.macd.slowPeriod,
        signalPeriod: this.macd.signalPeriod,
      });
    } else {
      this.cachedMACD = null;
    }
  }

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const candle = candles[currentIndex];
    if (!candle) {
      throw new Error(`Candle at index ${currentIndex} is undefined`);
    }

    if (currentIndex < this.requiredCandles - 1 || candles.length < this.requiredCandles) {
      return {
        action: 'HOLD',
        timestamp: candle.timestamp,
        price: candle.close,
        reason: 'Insufficient historical candles for indicator calculation',
      };
    }

    this.ensureCached(candles);

    // 1. Moving Average Signals
    let maBuy = false;
    let maSell = false;
    let maBullishTrend = false;
    if (this.ma.enabled) {
      const prevFast = this.cachedFastMA[currentIndex - 1];
      const currFast = this.cachedFastMA[currentIndex];
      const prevSlow = this.cachedSlowMA[currentIndex - 1];
      const currSlow = this.cachedSlowMA[currentIndex];

      if (
        Number.isFinite(prevFast) &&
        Number.isFinite(currFast) &&
        Number.isFinite(prevSlow) &&
        Number.isFinite(currSlow)
      ) {
        maBuy = prevFast <= prevSlow && currFast > currSlow;
        maSell = prevFast >= prevSlow && currFast < currSlow;
        maBullishTrend = currFast > currSlow;
      }
    }

    // 2. RSI Signals
    let rsiOversoldBounce = false;
    let rsiOverbought = false;
    let rsiSafeToBuy = true;
    let currRSIVal: number | undefined;
    if (this.rsi.enabled) {
      const currRSI = this.cachedRSI[currentIndex];
      const prevRSI = this.cachedRSI[currentIndex - 1];
      currRSIVal = currRSI;

      if (Number.isFinite(currRSI) && Number.isFinite(prevRSI)) {
        rsiOversoldBounce = prevRSI <= this.rsi.oversold && currRSI > this.rsi.oversold;
        rsiOverbought = currRSI >= this.rsi.overbought;
        rsiSafeToBuy = currRSI < this.rsi.overbought;
      }
    }

    // 3. MACD Signals
    let macdBuy = false;
    let macdSell = false;
    if (this.macd.enabled && this.cachedMACD) {
      const prevMacd = this.cachedMACD.macd[currentIndex - 1];
      const currMacd = this.cachedMACD.macd[currentIndex];
      const prevSig = this.cachedMACD.signal[currentIndex - 1];
      const currSig = this.cachedMACD.signal[currentIndex];

      if (
        Number.isFinite(prevMacd) &&
        Number.isFinite(currMacd) &&
        Number.isFinite(prevSig) &&
        Number.isFinite(currSig)
      ) {
        macdBuy = prevMacd <= prevSig && currMacd > currSig;
        macdSell = prevMacd >= prevSig && currMacd < currSig;
      }
    }

    // Combine Signals Dynamically
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let reason = 'No trigger condition met';

    if (this.ma.enabled && this.rsi.enabled && this.macd.enabled) {
      // All three enabled
      if ((maBuy || macdBuy) && rsiSafeToBuy && maBullishTrend) {
        action = 'BUY';
        reason = `Triple Confirmation: MA/MACD Bullish Cross with RSI (${currRSIVal?.toFixed(1)})`;
      } else if (maSell || macdSell || rsiOverbought) {
        action = 'SELL';
        reason = rsiOverbought
          ? `RSI Overbought (${currRSIVal?.toFixed(1)}) Exit`
          : 'MA / MACD Bearish Exit';
      }
    } else if (this.ma.enabled && this.rsi.enabled) {
      // MA + RSI
      if (maBuy && rsiSafeToBuy) {
        action = 'BUY';
        reason = `Golden Cross (${this.ma.type.toUpperCase()} ${this.ma.fastPeriod}/${this.ma.slowPeriod}) with RSI (${currRSIVal?.toFixed(1)})`;
      } else if (rsiOversoldBounce && maBullishTrend) {
        action = 'BUY';
        reason = `RSI Oversold Bounce (${currRSIVal?.toFixed(1)}) in Bullish Trend`;
      } else if (maSell || rsiOverbought) {
        action = 'SELL';
        reason = rsiOverbought
          ? `RSI Overbought (${currRSIVal?.toFixed(1)} >= ${this.rsi.overbought}) Exit`
          : `Death Cross (${this.ma.type.toUpperCase()} ${this.ma.fastPeriod}/${this.ma.slowPeriod})`;
      }
    } else if (this.ma.enabled && this.macd.enabled) {
      // MA + MACD
      if (maBuy || (macdBuy && maBullishTrend)) {
        action = 'BUY';
        reason = `MA & MACD Momentum Buy`;
      } else if (maSell || macdSell) {
        action = 'SELL';
        reason = `MA / MACD Bearish Cross Exit`;
      }
    } else if (this.rsi.enabled && this.macd.enabled) {
      // RSI + MACD
      if (macdBuy && rsiSafeToBuy) {
        action = 'BUY';
        reason = `MACD Bullish Cross [RSI: ${currRSIVal?.toFixed(1)}]`;
      } else if (macdSell || rsiOverbought) {
        action = 'SELL';
        reason = rsiOverbought ? `RSI Overbought Exit` : `MACD Bearish Cross Exit`;
      }
    } else if (this.ma.enabled) {
      // MA only
      if (maBuy) {
        action = 'BUY';
        reason = `Golden Cross: Fast ${this.ma.type.toUpperCase()} (${this.ma.fastPeriod}) crossed above Slow ${this.ma.type.toUpperCase()} (${this.ma.slowPeriod})`;
      } else if (maSell) {
        action = 'SELL';
        reason = `Death Cross: Fast ${this.ma.type.toUpperCase()} (${this.ma.fastPeriod}) crossed below Slow ${this.ma.type.toUpperCase()} (${this.ma.slowPeriod})`;
      }
    } else if (this.rsi.enabled) {
      // RSI only
      if (rsiOversoldBounce) {
        action = 'BUY';
        reason = `RSI Oversold Recovery (${currRSIVal?.toFixed(1)} crossed above ${this.rsi.oversold})`;
      } else if (rsiOverbought) {
        action = 'SELL';
        reason = `RSI Overbought Exit (${currRSIVal?.toFixed(1)} >= ${this.rsi.overbought})`;
      }
    } else if (this.macd.enabled) {
      // MACD only
      if (macdBuy) {
        action = 'BUY';
        reason = `MACD Bullish Cross`;
      } else if (macdSell) {
        action = 'SELL';
        reason = `MACD Bearish Cross`;
      }
    }

    return {
      action,
      timestamp: candle.timestamp,
      price: candle.close,
      reason,
      metadata: {
        fastMA: this.cachedFastMA[currentIndex],
        slowMA: this.cachedSlowMA[currentIndex],
        rsi: currRSIVal,
        macd: this.cachedMACD?.macd[currentIndex],
        macdSignal: this.cachedMACD?.signal[currentIndex],
        macdHistogram: this.cachedMACD?.histogram[currentIndex],
      },
    };
  }
}

