import type { Trade, BacktestMetrics, SideMetrics, MfeMaeDistribution, MfeMaeAnalysis } from './types';
import { mean, standardDeviation, roundTo, percentile } from '../utils/math';

export interface MetricsCalculationOptions {
  timestamps?: readonly (number | { timestamp: number })[];
  percentTimeInMarket?: number;
  avgExposurePercent?: number;
}

function computeSideMetrics(trades: readonly Trade[], initialBalance: number): SideMetrics {
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl < 0).length;
  const breakEvenTrades = trades.filter((t) => t.pnl === 0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnlPercent = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;

  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + Math.abs(t.pnl), 0);
  const profitFactor = grossLoss > 0
    ? roundTo(grossProfit / grossLoss, 2)
    : grossProfit > 0
    ? 999.99
    : 0;

  const expectancy = totalTrades > 0 ? roundTo(totalPnl / totalTrades, 2) : 0;
  const expectancyPercent = initialBalance > 0 && totalTrades > 0 ? roundTo((expectancy / initialBalance) * 100, 4) : 0;

  const durations = trades.map((t) => t.duration ?? 0);
  const averageDuration = durations.length > 0 ? roundTo(mean(durations), 2) : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    winRate: roundTo(winRate, 4),
    totalPnl: roundTo(totalPnl, 2),
    totalPnlPercent: roundTo(totalPnlPercent, 2),
    profitFactor,
    expectancy,
    expectancyPercent,
    averageDuration,
  };
}

const MFE_THRESHOLDS = [1, 2, 3, 5, 7.5, 10, 15];

function computeDistributionForTrades(trades: readonly Trade[]): MfeMaeDistribution {
  const count = trades.length;
  if (count === 0) {
    const emptyThresholds: Record<string, number> = {};
    for (const thresh of MFE_THRESHOLDS) {
      emptyThresholds[`>=${thresh}%`] = 0;
    }
    return {
      count: 0,
      mfeThresholds: emptyThresholds,
      mfeMedian: 0,
      mfeP75: 0,
      mfeP90: 0,
      maeMedian: 0,
      maeP75: 0,
      maeP90: 0,
    };
  }

  const mfes = trades.map((t) => t.maxFavorablePercent);
  const maes = trades.map((t) => t.maxAdversePercent);

  const thresholds: Record<string, number> = {};
  for (const thresh of MFE_THRESHOLDS) {
    const hits = trades.filter((t) => t.maxFavorablePercent >= thresh).length;
    thresholds[`>=${thresh}%`] = roundTo((hits / count) * 100, 1);
  }

  return {
    count,
    mfeThresholds: thresholds,
    mfeMedian: roundTo(percentile(mfes, 50), 2),
    mfeP75: roundTo(percentile(mfes, 75), 2),
    mfeP90: roundTo(percentile(mfes, 90), 2),
    maeMedian: roundTo(percentile(maes, 50), 2),
    maeP75: roundTo(percentile(maes, 75), 2),
    maeP90: roundTo(percentile(maes, 90), 2),
  };
}

/**
 * Computes MFE / MAE distributions and percentiles across all, long, and short trades.
 */
export function computeMfeMaeAnalysis(trades: readonly Trade[]): MfeMaeAnalysis {
  const longTrades = trades.filter((t) => t.side === 'long');
  const shortTrades = trades.filter((t) => t.side === 'short');

  return {
    all: computeDistributionForTrades(trades),
    long: computeDistributionForTrades(longTrades),
    short: computeDistributionForTrades(shortTrades),
  };
}

/**
 * Calculates comprehensive backtesting performance metrics, including:
 * - Annualized Sharpe from daily equity returns (rf=0)
 * - Sortino ratio from downside daily returns
 * - Calmar ratio (CAGR / maxDD)
 * - CAGR (%)
 * - Trade SQN-like return ratio (unannualized per-trade return ratio)
 * - Profit Factor ($)
 * - Expectancy ($ and % of initial capital)
 * - Payoff ratio (avg win $ / avg loss $)
 * - Consecutive wins and losses (streak count and dollars)
 * - Max drawdown duration (candles & days) and recovery (candles & days)
 * - Percent time in market & avg exposure %
 * - Break-even trades count (pnl === 0)
 * - Long/short breakdown
 * - Fee drag and fees % of gross profit
 */
function computeTradeNotional(t: Trade): number {
  if (t.entryPrice !== undefined && t.quantity !== undefined && t.entryPrice > 0 && t.quantity > 0) {
    return t.entryPrice * t.quantity;
  }
  if (t.pnlPercent !== undefined && t.pnlPercent !== 0 && t.pnl !== undefined) {
    return Math.abs(t.pnl / (t.pnlPercent / 100));
  }
  return 0;
}

function computeTimeWeightedExposure(
  trades: readonly Trade[],
  initialBalance: number,
  equityCurve: readonly number[],
  timestamps?: readonly (number | { timestamp: number })[]
): number | undefined {
  if (trades.length === 0) return 0;
  if (equityCurve.length === 0) return undefined;

  // Case 1: Timestamps array provided and aligns with equityCurve
  if (timestamps && timestamps.length === equityCurve.length && equityCurve.length > 0) {
    const getTs = (idx: number) => {
      const val = timestamps[idx];
      return typeof val === 'number' ? val : val.timestamp;
    };

    let sumExposure = 0;
    for (let i = 0; i < equityCurve.length; i++) {
      const ts = getTs(i);
      const eq = equityCurve[i] > 0 ? equityCurve[i] : initialBalance;
      if (eq <= 0) continue;

      let openNotional = 0;
      for (const t of trades) {
        if (t.entryTime === undefined) continue;
        const entryT = t.entryTime;
        const exitT = t.exitTime ?? entryT;
        const isOpen = exitT === entryT ? ts === entryT : (ts >= entryT && ts < exitT);
        if (isOpen) {
          openNotional += computeTradeNotional(t);
        }
      }
      sumExposure += (openNotional / eq) * 100;
    }
    return roundTo(sumExposure / equityCurve.length, 2);
  }

  // Case 2: Trades with candle index timings [0, equityCurve.length]
  const allTradesHaveIndices = trades.length > 0 && trades.every((t) =>
    t.entryTime !== undefined &&
    t.entryTime >= 0 &&
    t.entryTime < equityCurve.length &&
    (t.exitTime === undefined || (t.exitTime >= 0 && t.exitTime <= equityCurve.length))
  );

  if (allTradesHaveIndices && equityCurve.length > 0) {
    let sumExposure = 0;
    for (let i = 0; i < equityCurve.length; i++) {
      const eq = equityCurve[i] > 0 ? equityCurve[i] : initialBalance;
      if (eq <= 0) continue;

      let openNotional = 0;
      for (const t of trades) {
        const entryIdx = t.entryTime!;
        const exitIdx = t.exitTime ?? (t.duration !== undefined ? entryIdx + t.duration : entryIdx);
        const isOpen = exitIdx === entryIdx ? i === entryIdx : (i >= entryIdx && i < exitIdx);
        if (isOpen) {
          openNotional += computeTradeNotional(t);
        }
      }
      sumExposure += (openNotional / eq) * 100;
    }
    return roundTo(sumExposure / equityCurve.length, 2);
  }

  // When trade timing cannot be reliably matched to equity timeline, return undefined (do NOT fall back to percentTimeInMarket)
  return undefined;
}

function computePercentTimeInMarket(
  trades: readonly Trade[],
  equityCurve: readonly number[],
  timestamps?: readonly (number | { timestamp: number })[]
): number {
  if (trades.length === 0 || equityCurve.length === 0) return 0;

  // Case 1: Timestamps array provided
  if (timestamps && timestamps.length === equityCurve.length && equityCurve.length > 0) {
    const getTs = (idx: number) => {
      const val = timestamps[idx];
      return typeof val === 'number' ? val : val.timestamp;
    };
    let barsWithPos = 0;
    for (let i = 0; i < equityCurve.length; i++) {
      const ts = getTs(i);
      const hasOpen = trades.some((t) => {
        if (t.entryTime === undefined) return false;
        const entryT = t.entryTime;
        const exitT = t.exitTime ?? entryT;
        return exitT === entryT ? ts === entryT : (ts >= entryT && ts < exitT);
      });
      if (hasOpen) barsWithPos++;
    }
    return roundTo((barsWithPos / equityCurve.length) * 100, 2);
  }

  // Case 2: Bar indices
  const allTradesHaveIndices = trades.length > 0 && trades.every((t) =>
    t.entryTime !== undefined &&
    t.entryTime >= 0 &&
    t.entryTime < equityCurve.length &&
    (t.exitTime === undefined || (t.exitTime >= 0 && t.exitTime <= equityCurve.length))
  );

  if (allTradesHaveIndices && equityCurve.length > 0) {
    let barsWithPos = 0;
    for (let i = 0; i < equityCurve.length; i++) {
      const hasOpen = trades.some((t) => {
        const entryIdx = t.entryTime!;
        const exitIdx = t.exitTime ?? (t.duration !== undefined ? entryIdx + t.duration : entryIdx);
        return exitIdx === entryIdx ? i === entryIdx : (i >= entryIdx && i < exitIdx);
      });
      if (hasOpen) barsWithPos++;
    }
    return roundTo((barsWithPos / equityCurve.length) * 100, 2);
  }

  // Fallback: sum durations (capped at 100%)
  const totalBarsInTrade = trades.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  return equityCurve.length > 0
    ? roundTo(Math.min(100, (totalBarsInTrade / equityCurve.length) * 100), 2)
    : 0;
}

export function calculateMetrics(
  trades: readonly Trade[],
  initialBalance: number,
  equityCurve: readonly number[],
  optionsOrCandles?:
    | readonly (number | { timestamp: number })[]
    | MetricsCalculationOptions
): BacktestMetrics {
  let timestamps: readonly (number | { timestamp: number })[] | undefined;
  let percentTimeInMarketOverride: number | undefined;
  let avgExposurePercentOverride: number | undefined;

  if (Array.isArray(optionsOrCandles)) {
    timestamps = optionsOrCandles;
  } else if (optionsOrCandles && typeof optionsOrCandles === 'object') {
    const opts = optionsOrCandles as MetricsCalculationOptions;
    timestamps = opts.timestamps;
    percentTimeInMarketOverride = opts.percentTimeInMarket;
    avgExposurePercentOverride = opts.avgExposurePercent;
  }

  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl < 0).length;
  const breakEvenTrades = trades.filter((t) => t.pnl === 0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  const finalBalance =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : initialBalance;
  const totalPnl = roundTo(finalBalance - initialBalance, 2);
  const totalPnlPercent = initialBalance > 0 ? roundTo((totalPnl / initialBalance) * 100, 2) : 0;

  let bestTrade = 0;
  let worstTrade = 0;
  let averageTradeReturn = 0;
  let tradeReturnRatio = 0;

  if (totalTrades > 0) {
    const returns = trades.map((t) => t.pnlPercent);
    let best = returns[0];
    let worst = returns[0];
    for (let i = 1; i < returns.length; i++) {
      if (returns[i] > best) best = returns[i];
      if (returns[i] < worst) worst = returns[i];
    }
    bestTrade = best;
    worstTrade = worst;
    averageTradeReturn = mean(returns);

    const stdDev = standardDeviation(returns);
    if (stdDev > 0) {
      tradeReturnRatio = averageTradeReturn / stdDev;
    }
  }
  const tradeSqnLike = roundTo(tradeReturnRatio, 2);

  // Maximum Drawdown calculation and episode tracking (for duration & recovery)
  let peak = initialBalance;
  let maxDrawdown = 0;

  for (const equity of equityCurve) {
    if (equity > peak) {
      peak = equity;
    }
    if (peak > 0) {
      const drawdown = (peak - equity) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  // Drawdown episode duration & recovery
  let epPeak = initialBalance;
  let epPeakIdx = 0;
  let epTroughIdx = 0;
  let epMaxDd = 0;

  let bestEpPeakIdx = 0;
  let bestEpTroughIdx = 0;
  let bestEpRecoveryIdx = equityCurve.length > 0 ? equityCurve.length - 1 : 0;
  let bestEpMaxDd = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i];
    if (eq >= epPeak) {
      if (epMaxDd > bestEpMaxDd) {
        bestEpMaxDd = epMaxDd;
        bestEpPeakIdx = epPeakIdx;
        bestEpTroughIdx = epTroughIdx;
        bestEpRecoveryIdx = i;
      }
      epPeak = eq;
      epPeakIdx = i;
      epTroughIdx = i;
      epMaxDd = 0;
    } else {
      const dd = (epPeak - eq) / epPeak;
      if (dd > epMaxDd) {
        epMaxDd = dd;
        epTroughIdx = i;
      }
    }
  }
  if (epMaxDd > bestEpMaxDd) {
    bestEpMaxDd = epMaxDd;
    bestEpPeakIdx = epPeakIdx;
    bestEpTroughIdx = epTroughIdx;
    bestEpRecoveryIdx = equityCurve.length > 0 ? equityCurve.length - 1 : 0;
  }

  const maxDrawdownDurationCandles = Math.max(0, bestEpRecoveryIdx - bestEpPeakIdx);
  const maxDrawdownRecoveryCandles = Math.max(0, bestEpRecoveryIdx - bestEpTroughIdx);

  let maxDrawdownDurationDays = maxDrawdownDurationCandles;
  let maxDrawdownRecoveryDays = maxDrawdownRecoveryCandles;

  if (timestamps && timestamps.length === equityCurve.length && equityCurve.length > 0) {
    const getTs = (idx: number) => {
      const val = timestamps![idx];
      return typeof val === 'number' ? val : val.timestamp;
    };
    maxDrawdownDurationDays = roundTo((getTs(bestEpRecoveryIdx) - getTs(bestEpPeakIdx)) / 86400000, 2);
    maxDrawdownRecoveryDays = roundTo((getTs(bestEpRecoveryIdx) - getTs(bestEpTroughIdx)) / 86400000, 2);
  }

  // Daily returns aggregated by UTC day
  const dailyReturns: number[] = [];
  if (timestamps && timestamps.length === equityCurve.length && equityCurve.length > 0) {
    const dailyEquityMap = new Map<string, number>();
    for (let i = 0; i < equityCurve.length; i++) {
      const val = timestamps[i];
      const ts = typeof val === 'number' ? val : val.timestamp;
      const dateKey = new Date(ts).toISOString().slice(0, 10);
      dailyEquityMap.set(dateKey, equityCurve[i]);
    }
    const dailyValues = Array.from(dailyEquityMap.values());
    let prev = initialBalance;
    for (const curr of dailyValues) {
      if (prev > 0) {
        dailyReturns.push((curr - prev) / prev);
      }
      prev = curr;
    }
  } else if (equityCurve.length > 1) {
    let prev = initialBalance;
    for (const curr of equityCurve) {
      if (prev > 0) {
        dailyReturns.push((curr - prev) / prev);
      }
      prev = curr;
    }
  }

  const meanDailyReturn = dailyReturns.length > 0 ? mean(dailyReturns) : 0;
  const stdDailyReturn = dailyReturns.length > 1 ? standardDeviation(dailyReturns) : 0;

  // Annualized Sharpe ratio (rf = 0)
  const sharpeRatio = stdDailyReturn > 0
    ? roundTo((meanDailyReturn / stdDailyReturn) * Math.sqrt(365), 2)
    : 0;

  // Sortino (downside semi-deviation only)
  const downsideSquared = dailyReturns.map((r) => (r < 0 ? r * r : 0));
  const downsideDev = downsideSquared.length > 0 ? Math.sqrt(mean(downsideSquared)) : 0;
  const sortinoRatio = downsideDev > 0
    ? roundTo((meanDailyReturn / downsideDev) * Math.sqrt(365), 2)
    : 0;

  // CAGR calculation
  let totalDays = 0;
  if (timestamps && timestamps.length > 1) {
    const getTs = (idx: number) => {
      const val = timestamps![idx];
      return typeof val === 'number' ? val : val.timestamp;
    };
    totalDays = (getTs(timestamps.length - 1) - getTs(0)) / 86400000;
  } else {
    totalDays = Math.max(1, dailyReturns.length);
  }

  const years = totalDays / 365.25;
  let cagr = 0;
  if (years > 0 && initialBalance > 0 && finalBalance > 0) {
    cagr = roundTo((Math.pow(finalBalance / initialBalance, 1 / years) - 1) * 100, 2);
  } else if (finalBalance <= 0) {
    cagr = -100;
  }

  // Calmar ratio = CAGR / maxDD
  const calmarRatio = maxDrawdown > 0 ? roundTo((cagr / 100) / maxDrawdown, 2) : 0;

  // Profit Factor ($)
  const grossProfit = roundTo(trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0), 2);
  const grossLoss = roundTo(trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + Math.abs(t.pnl), 0), 2);
  const profitFactor = grossLoss > 0
    ? roundTo(grossProfit / grossLoss, 2)
    : grossProfit > 0
    ? 999.99
    : 0;

  // Expectancy ($ per trade and % of capital)
  const expectancy = totalTrades > 0 ? roundTo(totalPnl / totalTrades, 2) : 0;
  const expectancyPercent = initialBalance > 0 && totalTrades > 0 ? roundTo((expectancy / initialBalance) * 100, 4) : 0;

  // Payoff = avg win $ / avg loss $
  const avgWinDollar = winningTrades > 0 ? grossProfit / winningTrades : 0;
  const avgLossDollar = losingTrades > 0 ? grossLoss / losingTrades : 0;
  const payoffRatio = avgLossDollar > 0 ? roundTo(avgWinDollar / avgLossDollar, 2) : 0;

  // Consecutive wins & losses
  let maxConsecutiveWins = 0;
  let currentWins = 0;
  let maxConsecutiveLosses = 0;
  let currentLosses = 0;
  let maxConsecutiveLossesDollars = 0;
  let currentLossesDollars = 0;

  for (const t of trades) {
    if (t.pnl > 0) {
      currentWins++;
      if (currentWins > maxConsecutiveWins) maxConsecutiveWins = currentWins;
      currentLosses = 0;
      currentLossesDollars = 0;
    } else if (t.pnl < 0) {
      currentLosses++;
      currentLossesDollars += Math.abs(t.pnl);
      if (currentLosses > maxConsecutiveLosses) maxConsecutiveLosses = currentLosses;
      if (currentLossesDollars > maxConsecutiveLossesDollars) {
        maxConsecutiveLossesDollars = currentLossesDollars;
      }
      currentWins = 0;
    } else {
      currentWins = 0;
      currentLosses = 0;
      currentLossesDollars = 0;
    }
  }
  maxConsecutiveLossesDollars = roundTo(maxConsecutiveLossesDollars, 2);

  // Time in market & exposure
  let percentTimeInMarket: number | undefined = percentTimeInMarketOverride;
  let avgExposurePercent: number | undefined = avgExposurePercentOverride;

  if (avgExposurePercent === undefined) {
    avgExposurePercent = computeTimeWeightedExposure(trades, initialBalance, equityCurve, timestamps);
  }

  if (percentTimeInMarket === undefined) {
    percentTimeInMarket = computePercentTimeInMarket(trades, equityCurve, timestamps);
  }

  // Fees
  const totalFees = roundTo(trades.reduce((sum, t) => sum + (t.fee ?? 0), 0), 2);
  const totalFeesPercent = initialBalance > 0 ? roundTo((totalFees / initialBalance) * 100, 2) : 0;
  const feeDragPercent = totalFeesPercent;
  const feesPercentOfGrossProfit = grossProfit > 0 ? roundTo((totalFees / grossProfit) * 100, 2) : 0;

  // Dual Win/Loss returns: % of position size & % of capital
  const winReturns = trades.filter((t) => t.pnl > 0).map((t) => t.pnlPercent);
  const lossReturns = trades.filter((t) => t.pnl < 0).map((t) => t.pnlPercent);
  const averageWin = winReturns.length > 0 ? roundTo(mean(winReturns), 2) : 0;
  const averageLoss = lossReturns.length > 0 ? roundTo(mean(lossReturns), 2) : 0;

  const averageWinCapitalPercent = winningTrades > 0 && initialBalance > 0
    ? roundTo((avgWinDollar / initialBalance) * 100, 2)
    : 0;
  const averageLossCapitalPercent = losingTrades > 0 && initialBalance > 0
    ? roundTo((avgLossDollar / initialBalance) * 100, 2)
    : 0;

  const longTrades = trades.filter((t) => t.side === 'long');
  const shortTrades = trades.filter((t) => t.side === 'short');

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakEvenTrades,
    winRate: roundTo(winRate, 4),
    totalPnl,
    totalPnlPercent,
    maxDrawdown: roundTo(maxDrawdown, 4),
    maxDrawdownPercent: roundTo(maxDrawdown * 100, 2),
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    cagr,
    tradeReturnRatio: roundTo(tradeReturnRatio, 2),
    tradeSqnLike,
    profitFactor,
    expectancy,
    expectancyPercent,
    payoffRatio,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    maxConsecutiveLossesDollars,
    maxDrawdownDurationCandles,
    maxDrawdownDurationDays,
    maxDrawdownRecoveryCandles,
    maxDrawdownRecoveryDays,
    percentTimeInMarket,
    avgExposurePercent,
    averageTradeReturn: roundTo(averageTradeReturn, 2),
    bestTrade: roundTo(bestTrade, 2),
    worstTrade: roundTo(worstTrade, 2),
    finalBalance: roundTo(finalBalance, 2),
    totalFees,
    totalFeesPercent,
    feeDragPercent,
    feesPercentOfGrossProfit,
    averageWin,
    averageLoss,
    averageWinCapitalPercent,
    averageLossCapitalPercent,
    long: computeSideMetrics(longTrades, initialBalance),
    short: computeSideMetrics(shortTrades, initialBalance),
  };
}
