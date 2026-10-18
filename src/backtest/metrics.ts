import type { Trade, BacktestMetrics, SideMetrics, MfeMaeDistribution, MfeMaeAnalysis } from './types';
import { mean, standardDeviation, roundTo, percentile } from '../utils/math';

function computeSideMetrics(trades: readonly Trade[], initialBalance: number): SideMetrics {
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl < 0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalPnlPercent = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: roundTo(winRate, 4),
    totalPnl: roundTo(totalPnl, 2),
    totalPnlPercent: roundTo(totalPnlPercent, 2),
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
 * Calculates comprehensive backtesting performance metrics, including long/short breakdown.
 */
export function calculateMetrics(
  trades: readonly Trade[],
  initialBalance: number,
  equityCurve: readonly number[]
): BacktestMetrics {
  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl < 0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  const finalBalance =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : initialBalance;
  const totalPnl = finalBalance - initialBalance;
  const totalPnlPercent = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;

  let bestTrade = 0;
  let worstTrade = 0;
  let averageTradeReturn = 0;
  let sharpeRatio = 0;

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
      sharpeRatio = averageTradeReturn / stdDev;
    }
  }

  // Calculate Maximum Drawdown from equity curve
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

  const longTrades = trades.filter((t) => t.side === 'long');
  const shortTrades = trades.filter((t) => t.side === 'short');

  const totalFees = roundTo(trades.reduce((sum, t) => sum + (t.fee ?? 0), 0), 2);
  const totalFeesPercent = initialBalance > 0 ? roundTo((totalFees / initialBalance) * 100, 2) : 0;
  const feeDragPercent = totalFeesPercent;

  const winReturns = trades.filter((t) => t.pnl > 0).map((t) => t.pnlPercent);
  const lossReturns = trades.filter((t) => t.pnl < 0).map((t) => t.pnlPercent);
  const averageWin = winReturns.length > 0 ? roundTo(mean(winReturns), 2) : 0;
  const averageLoss = lossReturns.length > 0 ? roundTo(mean(lossReturns), 2) : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: roundTo(winRate, 4),
    totalPnl: roundTo(totalPnl, 2),
    totalPnlPercent: roundTo(totalPnlPercent, 2),
    maxDrawdown: roundTo(maxDrawdown, 4),
    maxDrawdownPercent: roundTo(maxDrawdown * 100, 2),
    sharpeRatio: roundTo(sharpeRatio, 2),
    averageTradeReturn: roundTo(averageTradeReturn, 2),
    bestTrade: roundTo(bestTrade, 2),
    worstTrade: roundTo(worstTrade, 2),
    finalBalance: roundTo(finalBalance, 2),
    totalFees,
    totalFeesPercent,
    averageWin,
    averageLoss,
    feeDragPercent,
    long: computeSideMetrics(longTrades, initialBalance),
    short: computeSideMetrics(shortTrades, initialBalance),
  };
}

