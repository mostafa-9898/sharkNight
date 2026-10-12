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
  /** Lower bound of BUY zone (inclusive). Default 25. */
  buyMin: number;
  /** Upper bound of BUY zone (inclusive). Default 35. */
  buyMax: number;
  /** Lower bound of SELL zone (inclusive). Default 65. */
  sellMin: number;
  /** Upper bound of SELL zone (inclusive). Default 75. */
  sellMax: number;
}

export interface MACDConfigSettings {
  enabled: boolean;
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}

export type ExitMode = 'mirror' | 'emaCross' | 'macdCross';

export interface ModularStrategyConfig {
  ma?: Partial<MAConfig>;
  rsi?: Partial<RSIConfig>;
  macd?: Partial<MACDConfigSettings>;
  confirmationWindow?: number;
  rsiLookback?: number;
  exitMode?: ExitMode;
  /** Optional take-profit percentage. Disabled (undefined) by default. */
  takeProfitPercent?: number;
  /** Optional stop-loss percentage. Disabled (undefined) by default. */
  stopLossPercent?: number;
}

/**
 * Modular Multi-Indicator Strategy (Strategy 1: Triple Confluence Engine).
 *
 * BUY requires ALL enabled indicators to agree (AND):
 *   - RSI in closed [buyMin, buyMax] on at least one of the last rsiLookback candles
 *   - MACD bullish cross within confirmationWindow
 *   - EMA bullish cross within confirmationWindow
 *   At least one cross must be on the current candle (fresh trigger).
 *   State must hold: fast EMA > slow EMA, macd > signal.
 *
 * SELL depends on exitMode:
 *   - 'mirror' (default): AND of EMA bearish cross + MACD bearish cross + RSI in sell zone within rsiLookback
 *   - 'emaCross': EMA bearish cross only
 *   - 'macdCross': MACD bearish cross only
 *
 * Long-only: BUY ignored when position open, SELL ignored when no position.
 */
export class ModularStrategy implements Strategy {
  readonly name: string;
  readonly description: string;
  readonly requiredCandles: number;

  readonly ma: MAConfig;
  readonly rsi: RSIConfig;
  readonly macd: MACDConfigSettings;
  readonly confirmationWindow: number;
  readonly rsiLookback: number;
  readonly exitMode: ExitMode;
  readonly takeProfitPercent: number | undefined;
  readonly stopLossPercent: number | undefined;

  // Position tracking for long-only logic
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
      buyMin: config?.rsi?.buyMin ?? 25,
      buyMax: config?.rsi?.buyMax ?? 35,
      sellMin: config?.rsi?.sellMin ?? 65,
      sellMax: config?.rsi?.sellMax ?? 75,
    };

    this.macd = {
      enabled: config?.macd?.enabled ?? false,
      fastPeriod: config?.macd?.fastPeriod ?? 12,
      slowPeriod: config?.macd?.slowPeriod ?? 26,
      signalPeriod: config?.macd?.signalPeriod ?? 9,
    };

    this.confirmationWindow = Math.max(1, config?.confirmationWindow ?? 6);
    this.rsiLookback = Math.max(1, config?.rsiLookback ?? 10);
    this.exitMode = config?.exitMode ?? 'mirror';
    this.takeProfitPercent = config?.takeProfitPercent;
    this.stopLossPercent = config?.stopLossPercent;

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
      if (this.rsi.buyMin >= this.rsi.buyMax) {
        throw new Error(
          `RSI buyMin (${this.rsi.buyMin}) must be strictly less than buyMax (${this.rsi.buyMax})`
        );
      }
      if (this.rsi.sellMin >= this.rsi.sellMax) {
        throw new Error(
          `RSI sellMin (${this.rsi.sellMin}) must be strictly less than sellMax (${this.rsi.sellMax})`
        );
      }
      if (this.rsi.buyMax >= this.rsi.sellMin) {
        throw new Error(
          `RSI buyMax (${this.rsi.buyMax}) must be strictly less than sellMin (${this.rsi.sellMin})`
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

    // Bug #7 fix: window of N scans exactly N candles [currentIndex - N + 1, currentIndex].
    // The earliest candle in the window is currentIndex - confirmationWindow + 1.
    // Crosses require k-1, so the earliest k we scan is currentIndex - confirmationWindow + 1,
    // but we must ensure k >= 1 so we can read k-1.
    const winStart = Math.max(1, currentIndex - this.confirmationWindow + 1);

    // -------------------------------------------------------------
    // 0A. Take Profit (only if explicitly configured)
    // -------------------------------------------------------------
    if (this.lastEntryPrice !== null && this.takeProfitPercent != null) {
      const pnlPercent = ((currPrice - this.lastEntryPrice) / this.lastEntryPrice) * 100;
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
    }

    // -------------------------------------------------------------
    // 0B. Stop Loss (only if explicitly configured)
    // -------------------------------------------------------------
    if (this.lastEntryPrice !== null && this.stopLossPercent != null) {
      const pnlPercent = ((currPrice - this.lastEntryPrice) / this.lastEntryPrice) * 100;
      if (currPrice <= this.lastEntryPrice * (1 - this.stopLossPercent / 100)) {
        this.lastEntryPrice = null;
        this.lastEntryIndex = -1;
        return {
          action: 'SELL',
          timestamp: candle.timestamp,
          price: currPrice,
          reason: `Stop Loss Hit (${pnlPercent.toFixed(1)}% <= -${this.stopLossPercent}%)`,
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

    // -------------------------------------------------------------
    // 1. Detect crossovers within the confirmation window
    // -------------------------------------------------------------

    // 1A. EMA/SMA Crossovers
    let maCrossUpRecent = false;
    let maCrossDownRecent = false;
    let maCrossUpOnCurrent = false;
    let maCrossDownOnCurrent = false;

    if (this.ma.enabled) {
      for (let k = winStart; k <= currentIndex; k++) {
        const pF = this.cachedFastMA[k - 1];
        const cF = this.cachedFastMA[k];
        const pS = this.cachedSlowMA[k - 1];
        const cS = this.cachedSlowMA[k];
        if (!Number.isFinite(pF) || !Number.isFinite(cF) || !Number.isFinite(pS) || !Number.isFinite(cS)) continue;

        if (pF <= pS && cF > cS) {
          maCrossUpRecent = true;
          if (k === currentIndex) maCrossUpOnCurrent = true;
        }
        if (pF >= pS && cF < cS) {
          maCrossDownRecent = true;
          if (k === currentIndex) maCrossDownOnCurrent = true;
        }
      }
    }

    // 1B. MACD Crossovers
    let macdCrossUpRecent = false;
    let macdCrossDownRecent = false;
    let macdCrossUpOnCurrent = false;
    let macdCrossDownOnCurrent = false;

    if (this.macd.enabled && this.cachedMACD) {
      for (let k = winStart; k <= currentIndex; k++) {
        const pM = this.cachedMACD.macd[k - 1];
        const cM = this.cachedMACD.macd[k];
        const pS = this.cachedMACD.signal[k - 1];
        const cS = this.cachedMACD.signal[k];
        if (!Number.isFinite(pM) || !Number.isFinite(cM) || !Number.isFinite(pS) || !Number.isFinite(cS)) continue;

        if (pM <= pS && cM > cS) {
          macdCrossUpRecent = true;
          if (k === currentIndex) macdCrossUpOnCurrent = true;
        }
        if (pM >= pS && cM < cS) {
          macdCrossDownRecent = true;
          if (k === currentIndex) macdCrossDownOnCurrent = true;
        }
      }
    }

    // 1C. Current state
    const maBullishNow = this.ma.enabled
      && Number.isFinite(this.cachedFastMA[currentIndex])
      && Number.isFinite(this.cachedSlowMA[currentIndex])
      && this.cachedFastMA[currentIndex] > this.cachedSlowMA[currentIndex];

    const maBearishNow = this.ma.enabled
      && Number.isFinite(this.cachedFastMA[currentIndex])
      && Number.isFinite(this.cachedSlowMA[currentIndex])
      && this.cachedFastMA[currentIndex] < this.cachedSlowMA[currentIndex];

    const macdBullishNow = this.macd.enabled && this.cachedMACD
      && Number.isFinite(this.cachedMACD.macd[currentIndex])
      && Number.isFinite(this.cachedMACD.signal[currentIndex])
      && this.cachedMACD.macd[currentIndex] > this.cachedMACD.signal[currentIndex];

    const macdBearishNow = this.macd.enabled && this.cachedMACD
      && Number.isFinite(this.cachedMACD.macd[currentIndex])
      && Number.isFinite(this.cachedMACD.signal[currentIndex])
      && this.cachedMACD.macd[currentIndex] < this.cachedMACD.signal[currentIndex];

    // 1D. RSI zone within rsiLookback window [currentIndex - rsiLookback + 1, currentIndex]
    const rsiStart = Math.max(0, currentIndex - this.rsiLookback + 1);
    let rsiBuyZoneRecent = false;
    let rsiSellZoneRecent = false;
    let lastRsiInBuyZone: number | undefined;
    let lastRsiInSellZone: number | undefined;

    if (this.rsi.enabled) {
      for (let k = rsiStart; k <= currentIndex; k++) {
        const val = this.cachedRSI[k];
        if (Number.isFinite(val)) {
          if (val >= this.rsi.buyMin && val <= this.rsi.buyMax) {
            rsiBuyZoneRecent = true;
            lastRsiInBuyZone = val;
          }
          if (val >= this.rsi.sellMin && val <= this.rsi.sellMax) {
            rsiSellZoneRecent = true;
            lastRsiInSellZone = val;
          }
        }
      }
    }

    // -------------------------------------------------------------
    // 2. Signal Decision Logic
    // -------------------------------------------------------------
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let reason = 'No trigger condition met';

    const needsCross = this.ma.enabled || this.macd.enabled;

    // --- BUY Logic (Long-Only) ---
    // Requires ALL enabled indicators to agree (AND logic)
    let buyConditionsMet = true;
    let hasFreshBuyCross = false;

    if (this.ma.enabled) {
      if (!(maCrossUpRecent && maBullishNow)) buyConditionsMet = false;
      if (maCrossUpOnCurrent) hasFreshBuyCross = true;
    }

    if (this.macd.enabled) {
      if (!(macdCrossUpRecent && macdBullishNow)) buyConditionsMet = false;
      if (macdCrossUpOnCurrent) hasFreshBuyCross = true;
    }

    if (this.rsi.enabled) {
      if (!rsiBuyZoneRecent) buyConditionsMet = false;
    }

    if (buyConditionsMet && (!needsCross || hasFreshBuyCross) && this.lastEntryPrice === null) {
      action = 'BUY';
      reason = this.buildBuyReason(lastRsiInBuyZone ?? currRSIVal);
      this.lastEntryPrice = currPrice;
      this.lastEntryIndex = currentIndex;
    } else if (this.lastEntryPrice !== null) {
      // --- SELL Logic based on exitMode ---
      let sellTriggered = false;
      let sellReason = '';

      if (this.exitMode === 'emaCross') {
        // Exit on EMA cross down only
        if (this.ma.enabled && maCrossDownRecent && maBearishNow && (maCrossDownOnCurrent || !needsCross)) {
          sellTriggered = true;
          sellReason = `${this.ma.type.toUpperCase()} Bearish Cross Exit`;
        }
      } else if (this.exitMode === 'macdCross') {
        // Exit on MACD cross down only
        if (this.macd.enabled && macdCrossDownRecent && macdBearishNow && (macdCrossDownOnCurrent || !needsCross)) {
          sellTriggered = true;
          sellReason = 'MACD Bearish Cross Exit';
        }
      } else {
        // Default 'mirror' mode: AND of cross downs + RSI sell zone within lookback
        let sellConditionsMet = true;
        let hasFreshSellCross = false;

        if (this.ma.enabled) {
          if (!(maCrossDownRecent && maBearishNow)) sellConditionsMet = false;
          if (maCrossDownOnCurrent) hasFreshSellCross = true;
        }

        if (this.macd.enabled) {
          if (!(macdCrossDownRecent && macdBearishNow)) sellConditionsMet = false;
          if (macdCrossDownOnCurrent) hasFreshSellCross = true;
        }

        if (this.rsi.enabled) {
          if (!rsiSellZoneRecent) sellConditionsMet = false;
        }

        if (sellConditionsMet && (!needsCross || hasFreshSellCross)) {
          sellTriggered = true;
          sellReason = this.buildSellReason(lastRsiInSellZone ?? currRSIVal);
        }
      }

      if (sellTriggered) {
        action = 'SELL';
        reason = sellReason;
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

  private buildBuyReason(rsi: number | undefined): string {
    const parts: string[] = [];
    if (this.ma.enabled) parts.push(`${this.ma.type.toUpperCase()} ${this.ma.fastPeriod}/${this.ma.slowPeriod} Bullish Cross`);
    if (this.macd.enabled) parts.push('MACD Bullish Cross');
    if (this.rsi.enabled) parts.push(`RSI in buy zone [${this.rsi.buyMin}-${this.rsi.buyMax}] (${rsi?.toFixed(1) ?? '?'})`);
    if (this.ma.enabled && this.rsi.enabled && this.macd.enabled) {
      return `Strategy 1 Confluence: ${parts.join(' + ')}`;
    }
    return parts.join(' + ') || 'BUY';
  }

  private buildSellReason(rsi: number | undefined): string {
    const parts: string[] = [];
    if (this.ma.enabled) parts.push(`${this.ma.type.toUpperCase()} Bearish Cross`);
    if (this.macd.enabled) parts.push('MACD Bearish Cross');
    if (this.rsi.enabled) parts.push(`RSI in sell zone [${this.rsi.sellMin}-${this.rsi.sellMax}] (${rsi?.toFixed(1) ?? '?'})`);
    if (this.ma.enabled && this.rsi.enabled && this.macd.enabled) {
      return `Strategy 1 Bearish Confluence: ${parts.join(' + ')}`;
    }
    return parts.join(' + ') || 'SELL';
  }
}

/**
 * Strategy 1 (Triple Confluence: EMA Crossover + MACD Crossover + RSI zone).
 * All three indicators enabled with sensible defaults.
 */
export class StrategyOne extends ModularStrategy {
  constructor(config?: ModularStrategyConfig) {
    super({
      ...config,
      ma: { enabled: true, type: 'ema', fastPeriod: 10, slowPeriod: 30, ...config?.ma },
      rsi: { enabled: true, period: 14, buyMin: 25, buyMax: 35, sellMin: 65, sellMax: 75, ...config?.rsi },
      macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, ...config?.macd },
      confirmationWindow: config?.confirmationWindow ?? 6,
      rsiLookback: config?.rsiLookback ?? 10,
      exitMode: config?.exitMode ?? 'mirror',
      takeProfitPercent: config?.takeProfitPercent,
      stopLossPercent: config?.stopLossPercent,
    });
  }
}
