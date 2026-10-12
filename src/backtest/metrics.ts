import type { Trade, BacktestMetrics, SideMetrics } from './types';
import { mean, standardDeviation, roundTo } from '../utils/math';

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
    bestTrade = Math.max(...returns);
    worstTrade = Math.min(...returns);
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
    long: computeSideMetrics(longTrades, initialBalance),
    short: computeSideMetrics(shortTrades, initialBalance),
  };
}
