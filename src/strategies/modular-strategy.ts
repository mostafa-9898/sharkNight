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
  tolerance: number;
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
  confirmationWindow?: number;
  takeProfitPercent?: number;
}

/**
 * Modular Multi-Indicator Strategy (Strategy 1: Triple Confluence Engine).
 * Allows dynamic combination of:
 * - MA (EMA / SMA) Crossover
 * - RSI (Relative Strength Index) with tolerance zone
 * - MACD (Moving Average Convergence Divergence) Crossover
 * - Confluence Confirmation Window & Take Profit target
 */
export class ModularStrategy implements Strategy {
  readonly name: string;
  readonly description: string;
  readonly requiredCandles: number;

  readonly ma: MAConfig;
  readonly rsi: RSIConfig;
  readonly macd: MACDConfigSettings;
  readonly confirmationWindow: number;
  readonly takeProfitPercent: number;

  // Position tracking for exit rules and take-profit target
  private lastEntryPrice: number | null = null;
  private lastEntryIndex: number = -1;

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
      tolerance: config?.rsi?.tolerance ?? 5,
    };

    this.macd = {
      enabled: config?.macd?.enabled ?? false,
      fastPeriod: config?.macd?.fastPeriod ?? 12,
      slowPeriod: config?.macd?.slowPeriod ?? 26,
      signalPeriod: config?.macd?.signalPeriod ?? 9,
    };

    this.confirmationWindow = Math.max(1, config?.confirmationWindow ?? 5);
    this.takeProfitPercent = Math.max(0.1, config?.takeProfitPercent ?? 10);

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

    // Reset position state at index 0
    if (currentIndex === 0) {
      this.lastEntryPrice = null;
      this.lastEntryIndex = -1;
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

    const currPrice = candle.close;
    const currRSIVal = this.rsi.enabled ? this.cachedRSI[currentIndex] : undefined;
    const winStart = Math.max(1, currentIndex - this.confirmationWindow);

    // -------------------------------------------------------------
    // 1. Position Exit & Take Profit (if currently in an open position)
    // -------------------------------------------------------------
    if (this.lastEntryPrice !== null) {
      const pnlPercent = ((currPrice - this.lastEntryPrice) / this.lastEntryPrice) * 100;

      // 1A. Take Profit (+10% target or configurable)
      if (currPrice >= this.lastEntryPrice * (1 + this.takeProfitPercent / 100)) {
        this.lastEntryPrice = null;
        this.lastEntryIndex = -1;
        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: currPrice,
          reason: `Take Profit Hit (+${pnlPercent.toFixed(1)}% >= target ${this.takeProfitPercent}%)`,
          metadata: {
            pnlPercent,
            fastMA: this.cachedFastMA[currentIndex],
            slowMA: this.cachedSlowMA[currentIndex],
            rsi: currRSIVal,
            macd: this.cachedMACD?.macd[currentIndex],
            macdSignal: this.cachedMACD?.signal[currentIndex],
          },
        };
      }

      // 1B. Full Strategy 1 Bearish Confluence Exit (opposite of entry)
      if (this.ma.enabled && this.rsi.enabled && this.macd.enabled && this.cachedMACD) {
        let emaCrossDownRecent = false;
        for (let k = winStart; k <= currentIndex; k++) {
          if (this.cachedFastMA[k - 1] >= this.cachedSlowMA[k - 1] && this.cachedFastMA[k] < this.cachedSlowMA[k]) {
            emaCrossDownRecent = true;
            break;
          }
        }
        let macdCrossDownRecent = false;
        for (let k = winStart; k <= currentIndex; k++) {
          if (this.cachedMACD.macd[k - 1] >= this.cachedMACD.signal[k - 1] && this.cachedMACD.macd[k] < this.cachedMACD.signal[k]) {
            macdCrossDownRecent = true;
            break;
          }
        }

        const rsiOverboughtMin = this.rsi.overbought - this.rsi.tolerance;
        let rsiOverboughtMet = false;
        for (let k = winStart; k <= currentIndex; k++) {
          const r = this.cachedRSI[k];
          if (Number.isFinite(r) && (r >= rsiOverboughtMin || r >= this.rsi.overbought)) {
            rsiOverboughtMet = true;
            break;
          }
        }

        const emaBearishNow = this.cachedFastMA[currentIndex] < this.cachedSlowMA[currentIndex];
        const macdBearishNow = this.cachedMACD.macd[currentIndex] < this.cachedMACD.signal[currentIndex];

        if (emaCrossDownRecent && macdCrossDownRecent && rsiOverboughtMet && emaBearishNow && macdBearishNow) {
          this.lastEntryPrice = null;
          this.lastEntryIndex = -1;
          return {
            action: 'SELL',
            timestamp: candle.timestamp,
            price: currPrice,
            reason: `Triple Confluence Bearish Exit (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%): RSI in ~${this.rsi.overbought} zone with Bearish EMA & MACD Crossovers`,
            metadata: {
              pnlPercent,
              fastMA: this.cachedFastMA[currentIndex],
              slowMA: this.cachedSlowMA[currentIndex],
              rsi: currRSIVal,
              macd: this.cachedMACD?.macd[currentIndex],
              macdSignal: this.cachedMACD?.signal[currentIndex],
            },
          };
        }
      }
    }

    // -------------------------------------------------------------
    // 2. Indicator Crossover & Zone Detection
    // -------------------------------------------------------------

    // 2A. MA Crossover & State
    let maBuyNow = false;
    let maSellNow = false;
    let maCrossUpRecent = false;
    let maCrossUpIndex = -1;

    if (this.ma.enabled) {
      for (let k = winStart; k <= currentIndex; k++) {
        const pF = this.cachedFastMA[k - 1];
        const cF = this.cachedFastMA[k];
        const pS = this.cachedSlowMA[k - 1];
        const cS = this.cachedSlowMA[k];
        if (Number.isFinite(pF) && Number.isFinite(cF) && Number.isFinite(pS) && Number.isFinite(cS)) {
          if (pF <= pS && cF > cS) {
            maCrossUpRecent = true;
            maCrossUpIndex = k;
            if (k === currentIndex) maBuyNow = true;
          }
          if (pF >= pS && cF < cS && k === currentIndex) {
            maSellNow = true;
          }
        }
      }
    }
    const maBullishCurrent = this.ma.enabled ? this.cachedFastMA[currentIndex] > this.cachedSlowMA[currentIndex] : false;

    // 2B. RSI Zone & Recovery
    let rsiOversoldZoneMet = false;
    let rsiObservedVal = currRSIVal ?? 50;
    let rsiOversoldBounce = false;
    let rsiOverboughtNow = false;

    if (this.rsi.enabled) {
      const rsiMin = this.rsi.oversold - this.rsi.tolerance;
      const rsiMax = this.rsi.oversold + this.rsi.tolerance;

      for (let k = winStart; k <= currentIndex; k++) {
        const r = this.cachedRSI[k];
        if (Number.isFinite(r)) {
          if ((r >= rsiMin && r <= rsiMax) || r <= this.rsi.oversold) {
            rsiOversoldZoneMet = true;
            rsiObservedVal = r;
            break;
          }
        }
      }

      const currR = this.cachedRSI[currentIndex];
      const prevR = this.cachedRSI[currentIndex - 1];
      if (Number.isFinite(currR) && Number.isFinite(prevR)) {
        rsiOversoldBounce = prevR <= this.rsi.oversold && currR > this.rsi.oversold;
        rsiOverboughtNow = currR >= this.rsi.overbought;
      }
    }

    // 2C. MACD Crossover & State
    let macdBuyNow = false;
    let macdSellNow = false;
    let macdCrossUpRecent = false;
    let macdCrossUpIndex = -1;

    if (this.macd.enabled && this.cachedMACD) {
      for (let k = winStart; k <= currentIndex; k++) {
        const pM = this.cachedMACD.macd[k - 1];
        const cM = this.cachedMACD.macd[k];
        const pS = this.cachedMACD.signal[k - 1];
        const cS = this.cachedMACD.signal[k];
        if (Number.isFinite(pM) && Number.isFinite(cM) && Number.isFinite(pS) && Number.isFinite(cS)) {
          if (pM <= pS && cM > cS) {
            macdCrossUpRecent = true;
            macdCrossUpIndex = k;
            if (k === currentIndex) macdBuyNow = true;
          }
          if (pM >= pS && cM < cS && k === currentIndex) {
            macdSellNow = true;
          }
        }
      }
    }
    const macdBullishCurrent = (this.macd.enabled && this.cachedMACD)
      ? this.cachedMACD.macd[currentIndex] > this.cachedMACD.signal[currentIndex]
      : false;

    // -------------------------------------------------------------
    // 3. Signal Decision Logic
    // -------------------------------------------------------------
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let reason = 'No trigger condition met';

    if (this.ma.enabled && this.rsi.enabled && this.macd.enabled) {
      // Strategy 1: Triple Confluence (EMA cross + MACD cross in window + RSI in zone 30±tol)
      const emaValid = maCrossUpRecent && maBullishCurrent;
      const macdValid = macdCrossUpRecent && macdBullishCurrent;
      const isFreshTrigger = maBuyNow || macdBuyNow || (currentIndex - Math.max(maCrossUpIndex, macdCrossUpIndex) <= 1);

      if (emaValid && macdValid && rsiOversoldZoneMet && isFreshTrigger && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `Strategy 1 Confluence: RSI in zone (~${this.rsi.oversold}±${this.rsi.tolerance}, val: ${rsiObservedVal.toFixed(1)}) with Bullish EMA & MACD Crossovers`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (maSellNow || macdSellNow || rsiOverboughtNow) {
        if (this.lastEntryPrice !== null) {
          action = 'SELL';
          reason = rsiOverboughtNow
            ? `RSI Overbought (${currRSIVal?.toFixed(1)}) Exit`
            : `MA / MACD Bearish Cross Exit`;
          this.lastEntryPrice = null;
          this.lastEntryIndex = -1;
        }
      }
    } else if (this.ma.enabled && this.rsi.enabled) {
      // MA + RSI
      if (maCrossUpRecent && maBullishCurrent && rsiOversoldZoneMet && (maBuyNow || currentIndex - maCrossUpIndex <= 1) && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `Golden Cross (${this.ma.type.toUpperCase()} ${this.ma.fastPeriod}/${this.ma.slowPeriod}) with RSI in ~${this.rsi.oversold} zone (${rsiObservedVal.toFixed(1)})`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (maSellNow || rsiOverboughtNow) {
        if (this.lastEntryPrice !== null) {
          action = 'SELL';
          reason = rsiOverboughtNow ? `RSI Overbought Exit` : `Death Cross Exit`;
          this.lastEntryPrice = null;
          this.lastEntryIndex = -1;
        }
      }
    } else if (this.ma.enabled && this.macd.enabled) {
      // MA + MACD
      if (maCrossUpRecent && macdCrossUpRecent && maBullishCurrent && macdBullishCurrent && (maBuyNow || macdBuyNow) && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `MA & MACD Momentum Bullish Crossover`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (maSellNow || macdSellNow) {
        if (this.lastEntryPrice !== null) {
          action = 'SELL';
          reason = `MA / MACD Bearish Cross Exit`;
          this.lastEntryPrice = null;
          this.lastEntryIndex = -1;
        }
      }
    } else if (this.rsi.enabled && this.macd.enabled) {
      // RSI + MACD
      if (macdCrossUpRecent && macdBullishCurrent && rsiOversoldZoneMet && (macdBuyNow || currentIndex - macdCrossUpIndex <= 1) && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `MACD Bullish Cross with RSI in ~${this.rsi.oversold} zone (${rsiObservedVal.toFixed(1)})`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (macdSellNow || rsiOverboughtNow) {
        if (this.lastEntryPrice !== null) {
          action = 'SELL';
          reason = rsiOverboughtNow ? `RSI Overbought Exit` : `MACD Bearish Cross Exit`;
          this.lastEntryPrice = null;
          this.lastEntryIndex = -1;
        }
      }
    } else if (this.ma.enabled) {
      // MA only
      if (maBuyNow && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `Golden Cross: Fast ${this.ma.type.toUpperCase()} (${this.ma.fastPeriod}) crossed above Slow ${this.ma.type.toUpperCase()} (${this.ma.slowPeriod})`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (maSellNow && this.lastEntryPrice !== null) {
        action = 'SELL';
        reason = `Death Cross: Fast ${this.ma.type.toUpperCase()} (${this.ma.fastPeriod}) crossed below Slow ${this.ma.type.toUpperCase()} (${this.ma.slowPeriod})`;
        this.lastEntryPrice = null;
        this.lastEntryIndex = -1;
      }
    } else if (this.rsi.enabled) {
      // RSI only
      if (rsiOversoldBounce && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `RSI Oversold Recovery (${currRSIVal?.toFixed(1)} crossed above ${this.rsi.oversold})`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (rsiOverboughtNow && this.lastEntryPrice !== null) {
        action = 'SELL';
        reason = `RSI Overbought Exit (${currRSIVal?.toFixed(1)} >= ${this.rsi.overbought})`;
        this.lastEntryPrice = null;
        this.lastEntryIndex = -1;
      }
    } else if (this.macd.enabled) {
      // MACD only
      if (macdBuyNow && this.lastEntryPrice === null) {
        action = 'BUY';
        reason = `MACD Bullish Cross`;
        this.lastEntryPrice = currPrice;
        this.lastEntryIndex = currentIndex;
      } else if (macdSellNow && this.lastEntryPrice !== null) {
        action = 'SELL';
        reason = `MACD Bearish Cross`;
        this.lastEntryPrice = null;
        this.lastEntryIndex = -1;
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

/**
 * Strategy 1 (Triple Confluence: EMA Crossover + MACD Crossover + RSI 30±tol Zone).
 */
export class StrategyOne extends ModularStrategy {
  constructor(config?: ModularStrategyConfig) {
    super({
      ...config,
      ma: { enabled: true, type: 'ema', fastPeriod: 10, slowPeriod: 30, ...config?.ma },
      rsi: { enabled: true, period: 14, oversold: 30, overbought: 70, tolerance: 5, ...config?.rsi },
      macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, ...config?.macd },
      confirmationWindow: config?.confirmationWindow ?? 5,
      takeProfitPercent: config?.takeProfitPercent ?? 10,
    });
  }
}

