import type { TradeSignal } from '../data/models';
import type { BacktestConfig, BacktestResult } from './types';
import { VirtualPortfolio } from './portfolio';
import { calculateMetrics } from './metrics';

export class BacktestEngine {
  /**
   * Executes a complete backtest simulation for a given strategy and historical candles.
   */
  run(config: BacktestConfig): BacktestResult {
    const {
      strategy,
      candles,
      initialBalance,
      tradeFeePercent = 0.1,
      positionSizePercent = 100,
    } = config;

    if (!candles || candles.length === 0) {
      throw new Error('Backtest requires at least one candle to execute');
    }

    if (initialBalance <= 0) {
      throw new Error(`Initial balance must be positive, got ${initialBalance}`);
    }

    const portfolio = new VirtualPortfolio({
      initialBalance,
      tradeFeePercent,
      positionSizePercent,
    });

    const equityCurve: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const signal = strategy.analyze(candles, i);

      if (signal.action === 'BUY' && !portfolio.hasOpenPosition()) {
        portfolio.openPosition(signal, candle.close, candle.timestamp);
      } else if (signal.action === 'SELL' && portfolio.hasOpenPosition()) {
        portfolio.closePosition(signal, candle.close, candle.timestamp);
      }

      equityCurve.push(portfolio.getTotalEquity(candle.close));
    }

    // Capture active position status before final auto-close
    let activePosition: import('./types').ActivePosition | null = null;
    if (portfolio.hasOpenPosition()) {
      const openPos = portfolio.getOpenPosition()!;
      const finalCandle = candles[candles.length - 1];
      const grossValue = openPos.quantity * finalCandle.close;
      const exitFee = grossValue * (tradeFeePercent / 100);
      const netValue = grossValue - exitFee;
      const unrealizedPnl = netValue - openPos.entryCost;
      const unrealizedPnlPercent = (unrealizedPnl / openPos.entryCost) * 100;

      activePosition = {
        entrySignal: openPos.entrySignal,
        entryPrice: openPos.entryPrice,
        currentPrice: finalCandle.close,
        quantity: openPos.quantity,
        investedCost: openPos.entryCost,
        entryFee: openPos.entryFee,
        unrealizedPnl,
        unrealizedPnlPercent,
        entryTime: openPos.entryTime,
        duration: Math.max(0, finalCandle.timestamp - openPos.entryTime),
      };

      // Close open position to realize final balance
      const exitSignal: TradeSignal = {
        action: 'SELL',
        timestamp: finalCandle.timestamp,
        price: finalCandle.close,
        reason: 'Backtest conclusion: closed remaining open position',
      };
      portfolio.closePosition(exitSignal, finalCandle.close, finalCandle.timestamp);
      equityCurve[equityCurve.length - 1] = portfolio.getCash();
    }

    const trades = portfolio.getTrades();
    const metrics = calculateMetrics(trades, initialBalance, equityCurve);

    const configSummary: Omit<BacktestConfig, 'candles'> = {
      strategy: config.strategy,
      initialBalance: config.initialBalance,
      tradeFeePercent,
      positionSizePercent,
    };

    return {
      config: configSummary,
      trades,
      metrics,
      equity: equityCurve,
      activePosition,
    };
  }
}
