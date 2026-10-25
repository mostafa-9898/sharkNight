import type { Candle } from '../data/models';
import type { DailyRegimeCalculator } from '../utils/market-regime';
import type { MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import { roundTo } from '../utils/math';

export interface BaselineOptions {
  initialBalance?: number;
  tradeFeePercent?: number;     // e.g. 0.1 for 0.1%
  positionSizePercent?: number; // e.g. 30 for 30% of capital
}

export interface BaselineResult {
  totalReturn: number;
  maxDD: number;
  returnDdRatio: number;
  trades: number;
  avgTimeExposurePercent: number;
  avgCapitalExposurePercent: number;
  return2022: number;
  finalEquity: number;
  equityCurve: number[];
}

function computeMaxDD(equityCurve: readonly number[], initialBalance: number): number {
  let peak = initialBalance;
  let maxDd = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i];
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return roundTo(maxDd, 2);
}

function compute2022Return(candles: readonly Candle[], equityCurve: readonly number[]): number {
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < candles.length && i < equityCurve.length; i++) {
    const yr = new Date(candles[i].timestamp).getUTCFullYear();
    if (yr === 2022) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  if (firstIdx === -1 || lastIdx === -1 || firstIdx === lastIdx) return 0.0;
  const firstEq = equityCurve[firstIdx];
  const lastEq = equityCurve[lastIdx];
  if (firstEq <= 0) return 0.0;
  return roundTo(((lastEq - firstEq) / firstEq) * 100, 2);
}

/**
 * B1: Buy & Hold same size (30% capital in asset from candle 0 and hold throughout).
 */
export function simulateB1(
  candles: readonly Candle[],
  options: BaselineOptions = {}
): BaselineResult {
  if (candles.length === 0) {
    return {
      totalReturn: 0,
      maxDD: 0,
      returnDdRatio: 0,
      trades: 0,
      avgTimeExposurePercent: 0,
      avgCapitalExposurePercent: 0,
      return2022: 0,
      finalEquity: options.initialBalance ?? 10000,
      equityCurve: [],
    };
  }

  const initialBalance = options.initialBalance ?? 10000;
  const feeRate = (options.tradeFeePercent ?? 0.1) / 100;
  const sizePercent = options.positionSizePercent ?? 30;

  let cash = initialBalance;
  const alloc = cash * (sizePercent / 100);
  const entryFee = alloc * feeRate;
  const netInvest = alloc - entryFee;
  const quantity = netInvest / candles[0].close;
  cash -= alloc;

  const equityCurve: number[] = [];
  let capitalExposureSum = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    const grossVal = quantity * close;
    const exitFee = grossVal * feeRate;
    const currentEquity = cash + grossVal - exitFee;
    equityCurve.push(roundTo(currentEquity, 2));
    capitalExposureSum += (grossVal / currentEquity) * 100;
  }

  const lastClose = candles[candles.length - 1].close;
  const finalGross = quantity * lastClose;
  const finalExitFee = finalGross * feeRate;
  const finalEquity = cash + finalGross - finalExitFee;

  const totalReturn = roundTo(((finalEquity - initialBalance) / initialBalance) * 100, 2);
  const maxDD = computeMaxDD(equityCurve, initialBalance);
  const returnDdRatio = maxDD > 0 ? roundTo(totalReturn / maxDD, 2) : totalReturn > 0 ? 99.99 : 0;
  const avgTimeExposurePercent = 100.0;
  const avgCapitalExposurePercent = roundTo(capitalExposureSum / candles.length, 2);
  const return2022 = compute2022Return(candles, equityCurve);

  return {
    totalReturn,
    maxDD,
    returnDdRatio,
    trades: 1,
    avgTimeExposurePercent,
    avgCapitalExposurePercent,
    return2022,
    finalEquity: roundTo(finalEquity, 2),
    equityCurve,
  };
}

/**
 * Common state-machine simulation for condition-based long benchmarks (B2, B3, B4).
 */
function simulateConditionLong(
  candles: readonly Candle[],
  isLongCondition: (index: number) => boolean,
  options: BaselineOptions = {}
): BaselineResult {
  if (candles.length === 0) {
    return {
      totalReturn: 0,
      maxDD: 0,
      returnDdRatio: 0,
      trades: 0,
      avgTimeExposurePercent: 0,
      avgCapitalExposurePercent: 0,
      return2022: 0,
      finalEquity: options.initialBalance ?? 10000,
      equityCurve: [],
    };
  }

  const initialBalance = options.initialBalance ?? 10000;
  const feeRate = (options.tradeFeePercent ?? 0.1) / 100;
  const sizePercent = options.positionSizePercent ?? 30;

  let cash = initialBalance;
  let inPosition = false;
  let quantity = 0;
  let trades = 0;
  let timeExposureCount = 0;
  let capitalExposureSum = 0;
  const equityCurve: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    const shouldBeLong = isLongCondition(i);

    if (shouldBeLong && !inPosition) {
      // Enter long with sizePercent of current available cash
      const alloc = cash * (sizePercent / 100);
      const entryFee = alloc * feeRate;
      const netInvest = alloc - entryFee;
      quantity = netInvest / close;
      cash -= alloc;
      inPosition = true;
      trades++;
    } else if (!shouldBeLong && inPosition) {
      // Exit long to 100% cash
      const grossProceeds = quantity * close;
      const exitFee = grossProceeds * feeRate;
      cash += (grossProceeds - exitFee);
      quantity = 0;
      inPosition = false;
    }

    let currentEquity: number;
    if (inPosition) {
      const grossVal = quantity * close;
      const exitFee = grossVal * feeRate;
      currentEquity = cash + grossVal - exitFee;
      timeExposureCount++;
      capitalExposureSum += (grossVal / currentEquity) * 100;
    } else {
      currentEquity = cash;
    }
    equityCurve.push(roundTo(currentEquity, 2));
  }

  // End of backtest: realize any open position at last close
  if (inPosition) {
    const lastClose = candles[candles.length - 1].close;
    const grossProceeds = quantity * lastClose;
    const exitFee = grossProceeds * feeRate;
    cash += (grossProceeds - exitFee);
    quantity = 0;
    inPosition = false;
  }

  const finalEquity = cash;
  const totalReturn = roundTo(((finalEquity - initialBalance) / initialBalance) * 100, 2);
  const maxDD = computeMaxDD(equityCurve, initialBalance);
  const returnDdRatio = maxDD > 0 ? roundTo(totalReturn / maxDD, 2) : totalReturn > 0 ? 99.99 : 0;
  const avgTimeExposurePercent = roundTo((timeExposureCount / candles.length) * 100, 2);
  const avgCapitalExposurePercent = roundTo(capitalExposureSum / candles.length, 2);
  const return2022 = compute2022Return(candles, equityCurve);

  return {
    totalReturn,
    maxDD,
    returnDdRatio,
    trades,
    avgTimeExposurePercent,
    avgCapitalExposurePercent,
    return2022,
    finalEquity: roundTo(finalEquity, 2),
    equityCurve,
  };
}

/**
 * B2: Long 30% capital when close_1d > SMA200_1d (prior day closed candle), otherwise cash.
 */
export function simulateB2(
  candles: readonly Candle[],
  dailyCalc: DailyRegimeCalculator,
  options: BaselineOptions = {}
): BaselineResult {
  return simulateConditionLong(
    candles,
    (index) => {
      const data = dailyCalc.getDailyDataAt(candles[index].timestamp);
      return data !== null && data.close > data.sma200;
    },
    options
  );
}

/**
 * B3: Long 30% capital when SMA50_1d > SMA200_1d (prior day closed candle), otherwise cash.
 */
export function simulateB3(
  candles: readonly Candle[],
  dailyCalc: DailyRegimeCalculator,
  options: BaselineOptions = {}
): BaselineResult {
  return simulateConditionLong(
    candles,
    (index) => {
      if (typeof dailyCalc.getDailyGoldenCrossAt === 'function') {
        return dailyCalc.getDailyGoldenCrossAt(candles[index].timestamp) === 1;
      }
      const data = dailyCalc.getDailyDataAt(candles[index].timestamp);
      return data !== null && data.sma50 !== undefined && data.sma50 > data.sma200;
    },
    options
  );
}

/**
 * B4: Long 30% capital when HTF strict bullish (same definition as strategy), otherwise cash.
 */
export function simulateB4(
  candles: readonly Candle[],
  strat: MultiTimeframeStrategy,
  options: BaselineOptions = {}
): BaselineResult {
  return simulateConditionLong(
    candles,
    (index) => {
      return strat.getStrictHtfDirection(candles, index) === 1;
    },
    options
  );
}
