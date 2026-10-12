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
      tradeMode = 'long-short',
      takeProfitPercent,
      stopLossPercent,
    } = config;

    if (!candles || candles.length === 0) {
      throw new Error('Backtest requires at least one candle to execute');
    }

    if (initialBalance <= 0) {
      throw new Error(`Initial balance must be positive, got ${initialBalance}`);
    }

    if (takeProfitPercent !== undefined && takeProfitPercent <= 0) {
      throw new Error(`takeProfitPercent must be positive, got ${takeProfitPercent}`);
    }

    if (stopLossPercent !== undefined && stopLossPercent <= 0) {
      throw new Error(`stopLossPercent must be positive, got ${stopLossPercent}`);
    }

    const portfolio = new VirtualPortfolio({
      initialBalance,
      tradeFeePercent,
      positionSizePercent,
    });

    const equityCurve: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // 1. Check TP/SL on current position close BEFORE processing new signal
      let closedViaTpSl = false;
      const currentPos = portfolio.getOpenPosition();

      if (currentPos) {
        if (currentPos.side === 'long') {
          if (
            takeProfitPercent !== undefined &&
            takeProfitPercent > 0 &&
            candle.close >= currentPos.entryPrice * (1 + takeProfitPercent / 100)
          ) {
            const exitSignal: TradeSignal = {
              action: 'SELL',
              timestamp: candle.timestamp,
              price: candle.close,
              reason: `Take profit triggered at ${candle.close} (+${takeProfitPercent}%)`,
            };
            portfolio.closePosition(exitSignal, candle.close, candle.timestamp, 'takeProfit');
            closedViaTpSl = true;
          } else if (
            stopLossPercent !== undefined &&
            stopLossPercent > 0 &&
            candle.close <= currentPos.entryPrice * (1 - stopLossPercent / 100)
          ) {
            const exitSignal: TradeSignal = {
              action: 'SELL',
              timestamp: candle.timestamp,
              price: candle.close,
              reason: `Stop loss triggered at ${candle.close} (-${stopLossPercent}%)`,
            };
            portfolio.closePosition(exitSignal, candle.close, candle.timestamp, 'stopLoss');
            closedViaTpSl = true;
          }
        } else {
          // Short position TP/SL check
          if (
            takeProfitPercent !== undefined &&
            takeProfitPercent > 0 &&
            candle.close <= currentPos.entryPrice * (1 - takeProfitPercent / 100)
          ) {
            const exitSignal: TradeSignal = {
              action: 'BUY',
              timestamp: candle.timestamp,
              price: candle.close,
              reason: `Take profit triggered at ${candle.close} (+${takeProfitPercent}%)`,
            };
            portfolio.closePosition(exitSignal, candle.close, candle.timestamp, 'takeProfit');
            closedViaTpSl = true;
          } else if (
            stopLossPercent !== undefined &&
            stopLossPercent > 0 &&
            candle.close >= currentPos.entryPrice * (1 + stopLossPercent / 100)
          ) {
            const exitSignal: TradeSignal = {
              action: 'BUY',
              timestamp: candle.timestamp,
              price: candle.close,
              reason: `Stop loss triggered at ${candle.close} (-${stopLossPercent}%)`,
            };
            portfolio.closePosition(exitSignal, candle.close, candle.timestamp, 'stopLoss');
            closedViaTpSl = true;
          }
        }
      }

      // 2. Process strategy signal if position was not closed by TP/SL on this candle
      if (!closedViaTpSl) {
        const signal = strategy.analyze(candles, i);
        const activePos = portfolio.getOpenPosition();

        if (tradeMode === 'long-short') {
          if (signal.action === 'BUY') {
            if (!activePos) {
              portfolio.openPosition('long', signal, candle.close, candle.timestamp);
            } else if (activePos.side === 'short') {
              portfolio.closePosition(signal, candle.close, candle.timestamp, 'reverse');
              portfolio.openPosition('long', signal, candle.close, candle.timestamp);
            }
          } else if (signal.action === 'SELL') {
            if (!activePos) {
              portfolio.openPosition('short', signal, candle.close, candle.timestamp);
            } else if (activePos.side === 'long') {
              portfolio.closePosition(signal, candle.close, candle.timestamp, 'reverse');
              portfolio.openPosition('short', signal, candle.close, candle.timestamp);
            }
          }
        } else {
          // 'long-only' mode
          if (signal.action === 'BUY') {
            if (!activePos) {
              portfolio.openPosition('long', signal, candle.close, candle.timestamp);
            }
          } else if (signal.action === 'SELL') {
            if (activePos && activePos.side === 'long') {
              portfolio.closePosition(signal, candle.close, candle.timestamp, 'signal');
            }
          }
        }
      }

      equityCurve.push(portfolio.getTotalEquity(candle.close));
    }

    // 3. Close any remaining open position at conclusion of backtest
    if (portfolio.hasOpenPosition()) {
      const finalCandle = candles[candles.length - 1];
      const pos = portfolio.getOpenPosition()!;
      const exitSignal: TradeSignal = {
        action: pos.side === 'long' ? 'SELL' : 'BUY',
        timestamp: finalCandle.timestamp,
        price: finalCandle.close,
        reason: 'Backtest conclusion: closed remaining open position',
      };
      portfolio.closePosition(exitSignal, finalCandle.close, finalCandle.timestamp, 'end');
      equityCurve[equityCurve.length - 1] = portfolio.getCash();
    }

    const trades = portfolio.getTrades();
    const metrics = calculateMetrics(trades, initialBalance, equityCurve);

    const configSummary: Omit<BacktestConfig, 'candles'> = {
      strategy: config.strategy,
      initialBalance: config.initialBalance,
      tradeFeePercent,
      positionSizePercent,
      tradeMode,
      takeProfitPercent,
      stopLossPercent,
    };

    return {
      config: configSummary,
      trades,
      metrics,
      equity: equityCurve,
      activePosition: null,
    };
  }
}
