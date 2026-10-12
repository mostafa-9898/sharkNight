import type { TradeSignal } from '../data/models';
import type { BacktestConfig, BacktestResult, ExitReason, TradeSide } from './types';
import { VirtualPortfolio } from './portfolio';
import { calculateMetrics } from './metrics';
import { roundTo } from '../utils/math';

interface ActiveTradeState {
  side: TradeSide;
  entryPrice: number;
  highestHigh: number;
  lowestLow: number;
  stopPrice: number | null;
  ratchetSteps: number;
}

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
      trailingStop,
      slippagePercent = 0,
      stopCheckMode = 'intrabar',
    } = config;

    if (!candles || candles.length === 0) {
      throw new Error('Backtest requires at least one candle to execute');
    }

    if (initialBalance <= 0) {
      throw new Error(`Initial balance must be positive, got ${initialBalance}`);
    }

    if (trailingStop !== undefined && stopLossPercent !== undefined) {
      throw new Error('Cannot set both stopLossPercent and trailingStop');
    }

    if (trailingStop !== undefined) {
      if (trailingStop.initialStopPercent <= 0) {
        throw new Error(`trailingStop.initialStopPercent must be positive, got ${trailingStop.initialStopPercent}`);
      }
      if (trailingStop.stepPercent <= 0) {
        throw new Error(`trailingStop.stepPercent must be positive, got ${trailingStop.stepPercent}`);
      }
      if (trailingStop.raisePercent <= 0) {
        throw new Error(`trailingStop.raisePercent must be positive, got ${trailingStop.raisePercent}`);
      }
    }

    if (takeProfitPercent !== undefined && takeProfitPercent <= 0) {
      throw new Error(`takeProfitPercent must be positive, got ${takeProfitPercent}`);
    }

    if (stopLossPercent !== undefined && stopLossPercent <= 0) {
      throw new Error(`stopLossPercent must be positive, got ${stopLossPercent}`);
    }

    if (slippagePercent < 0) {
      throw new Error(`slippagePercent cannot be negative, got ${slippagePercent}`);
    }

    const portfolio = new VirtualPortfolio({
      initialBalance,
      tradeFeePercent,
      positionSizePercent,
    });

    const initTradeState = (side: TradeSide, entryPrice: number): ActiveTradeState => {
      let initialStop: number | null = null;
      if (trailingStop) {
        initialStop =
          side === 'long'
            ? roundTo(entryPrice * (1 - trailingStop.initialStopPercent / 100), 8)
            : roundTo(entryPrice * (1 + trailingStop.initialStopPercent / 100), 8);
      } else if (stopLossPercent !== undefined && stopLossPercent > 0) {
        initialStop =
          side === 'long'
            ? roundTo(entryPrice * (1 - stopLossPercent / 100), 8)
            : roundTo(entryPrice * (1 + stopLossPercent / 100), 8);
      }

      return {
        side,
        entryPrice,
        highestHigh: entryPrice,
        lowestLow: entryPrice,
        stopPrice: initialStop,
        ratchetSteps: 0,
      };
    };

    let tradeState: ActiveTradeState | null = null;
    const equityCurve: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // 1. Check Stop and TP using stop level as of previous candle's close
      if (portfolio.hasOpenPosition() && tradeState) {
        const currentPos = portfolio.getOpenPosition()!;
        const side = currentPos.side;
        const entryPrice = currentPos.entryPrice;
        const currentStopPrice = tradeState.stopPrice;
        let tpPrice: number | null = null;
        if (takeProfitPercent !== undefined && takeProfitPercent > 0) {
          tpPrice =
            side === 'long'
              ? entryPrice * (1 + takeProfitPercent / 100)
              : entryPrice * (1 - takeProfitPercent / 100);
        }

        let stopTriggered = false;
        let tpTriggered = false;
        let baseStopExitPrice = 0;
        let baseTpExitPrice = 0;

        if (stopCheckMode === 'intrabar') {
          if (side === 'long') {
            if (currentStopPrice !== null && candle.low <= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.open <= currentStopPrice ? candle.open : currentStopPrice;
            }
            if (tpPrice !== null && candle.high >= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.open >= tpPrice ? candle.open : tpPrice;
            }
          } else {
            // short
            if (currentStopPrice !== null && candle.high >= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.open >= currentStopPrice ? candle.open : currentStopPrice;
            }
            if (tpPrice !== null && candle.low <= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.open <= tpPrice ? candle.open : tpPrice;
            }
          }
        } else {
          // 'close' mode
          if (side === 'long') {
            if (tpPrice !== null && candle.close >= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.close;
            } else if (currentStopPrice !== null && candle.close <= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.close;
            }
          } else {
            // short
            if (tpPrice !== null && candle.close <= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.close;
            } else if (currentStopPrice !== null && candle.close >= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.close;
            }
          }
        }

        // Conservative rule: If both TP and stop triggered in the same candle, assume stop was hit first
        if (stopTriggered) {
          const exitReason: ExitReason =
            trailingStop && tradeState.ratchetSteps >= 1 ? 'trailingStop' : 'stopLoss';

          // Adverse slippage on exit: selling long slips down, buying short slips up
          const finalExitPrice = roundTo(
            side === 'long'
              ? baseStopExitPrice * (1 - slippagePercent / 100)
              : baseStopExitPrice * (1 + slippagePercent / 100),
            8
          );

          if (side === 'long') {
            if (candle.open <= currentStopPrice!) {
              tradeState.highestHigh = Math.max(tradeState.highestHigh, candle.open);
              tradeState.lowestLow = Math.min(tradeState.lowestLow, candle.low);
            } else {
              tradeState.highestHigh = Math.max(tradeState.highestHigh, candle.high);
              tradeState.lowestLow = Math.min(tradeState.lowestLow, candle.low);
            }
          } else {
            if (candle.open >= currentStopPrice!) {
              tradeState.lowestLow = Math.min(tradeState.lowestLow, candle.open);
              tradeState.highestHigh = Math.max(tradeState.highestHigh, candle.high);
            } else {
              tradeState.lowestLow = Math.min(tradeState.lowestLow, candle.low);
              tradeState.highestHigh = Math.max(tradeState.highestHigh, candle.high);
            }
          }

          const mfe =
            side === 'long'
              ? ((tradeState.highestHigh - entryPrice) / entryPrice) * 100
              : ((entryPrice - tradeState.lowestLow) / entryPrice) * 100;
          const mae =
            side === 'long'
              ? ((entryPrice - tradeState.lowestLow) / entryPrice) * 100
              : ((tradeState.highestHigh - entryPrice) / entryPrice) * 100;

          const exitSignal: TradeSignal = {
            action: side === 'long' ? 'SELL' : 'BUY',
            timestamp: candle.timestamp,
            price: finalExitPrice,
            reason:
              exitReason === 'trailingStop'
                ? `Trailing stop triggered at ${finalExitPrice.toFixed(2)} (step ${tradeState.ratchetSteps})`
                : `Stop loss triggered at ${finalExitPrice.toFixed(2)}`,
          };

          portfolio.closePosition(exitSignal, finalExitPrice, candle.timestamp, exitReason, {
            maxFavorablePercent: mfe,
            maxAdversePercent: mae,
            stopPrice: currentStopPrice!,
            ratchetSteps: tradeState.ratchetSteps,
          });
          tradeState = null;
        } else if (tpTriggered) {
          const exitReason: ExitReason = 'takeProfit';
          const finalExitPrice = roundTo(
            side === 'long'
              ? baseTpExitPrice * (1 - slippagePercent / 100)
              : baseTpExitPrice * (1 + slippagePercent / 100),
            8
          );

          tradeState.highestHigh = Math.max(tradeState.highestHigh, candle.high);
          tradeState.lowestLow = Math.min(tradeState.lowestLow, candle.low);

          const mfe =
            side === 'long'
              ? ((tradeState.highestHigh - entryPrice) / entryPrice) * 100
              : ((entryPrice - tradeState.lowestLow) / entryPrice) * 100;
          const mae =
            side === 'long'
              ? ((entryPrice - tradeState.lowestLow) / entryPrice) * 100
              : ((tradeState.highestHigh - entryPrice) / entryPrice) * 100;

          const exitSignal: TradeSignal = {
            action: side === 'long' ? 'SELL' : 'BUY',
            timestamp: candle.timestamp,
            price: finalExitPrice,
            reason: `Take profit triggered at ${finalExitPrice.toFixed(2)} (+${takeProfitPercent}%)`,
          };

          portfolio.closePosition(exitSignal, finalExitPrice, candle.timestamp, exitReason, {
            maxFavorablePercent: mfe,
            maxAdversePercent: mae,
            stopPrice: currentStopPrice ?? undefined,
            ratchetSteps: tradeState.ratchetSteps,
          });
          tradeState = null;
        }
      }

      // 2. If still open, update favorable extreme with this candle's high/low and ratchet stop for NEXT candle
      if (portfolio.hasOpenPosition() && tradeState) {
        const currentPos = portfolio.getOpenPosition()!;
        tradeState.highestHigh = Math.max(tradeState.highestHigh, candle.high);
        tradeState.lowestLow = Math.min(tradeState.lowestLow, candle.low);

        if (trailingStop) {
          if (currentPos.side === 'long') {
            const mfePercent =
              ((tradeState.highestHigh - currentPos.entryPrice) / currentPos.entryPrice) * 100;
            const n = Math.floor(mfePercent / trailingStop.stepPercent);
            if (n > 0) {
              const candidateStopPercent =
                -trailingStop.initialStopPercent + n * trailingStop.raisePercent;
              const candidateStopPrice = roundTo(
                currentPos.entryPrice * (1 + candidateStopPercent / 100),
                8
              );
              if (tradeState.stopPrice === null || candidateStopPrice > tradeState.stopPrice) {
                tradeState.stopPrice = candidateStopPrice;
              }
              if (n > tradeState.ratchetSteps) {
                tradeState.ratchetSteps = n;
              }
            }
          } else {
            // short
            const mfePercent =
              ((currentPos.entryPrice - tradeState.lowestLow) / currentPos.entryPrice) * 100;
            const n = Math.floor(mfePercent / trailingStop.stepPercent);
            if (n > 0) {
              const candidateStopPercent =
                -trailingStop.initialStopPercent + n * trailingStop.raisePercent;
              const candidateStopPrice = roundTo(
                currentPos.entryPrice * (1 - candidateStopPercent / 100),
                8
              );
              if (tradeState.stopPrice === null || candidateStopPrice < tradeState.stopPrice) {
                tradeState.stopPrice = candidateStopPrice;
              }
              if (n > tradeState.ratchetSteps) {
                tradeState.ratchetSteps = n;
              }
            }
          }
        }
      }

      // 3. Process strategy signal at candle close (even after stop-out)
      const signal = strategy.analyze(candles, i);
      const activePos = portfolio.getOpenPosition();

      if (tradeMode === 'long-short') {
        if (signal.action === 'BUY') {
          if (!activePos) {
            portfolio.openPosition('long', signal, candle.close, candle.timestamp);
            tradeState = initTradeState('long', candle.close);
          } else if (activePos.side === 'short') {
            const mfe = tradeState
              ? ((activePos.entryPrice - tradeState.lowestLow) / activePos.entryPrice) * 100
              : 0;
            const mae = tradeState
              ? ((tradeState.highestHigh - activePos.entryPrice) / activePos.entryPrice) * 100
              : 0;
            portfolio.closePosition(signal, candle.close, candle.timestamp, 'reverse', {
              maxFavorablePercent: mfe,
              maxAdversePercent: mae,
              stopPrice: tradeState?.stopPrice ?? undefined,
              ratchetSteps: tradeState?.ratchetSteps,
            });
            portfolio.openPosition('long', signal, candle.close, candle.timestamp);
            tradeState = initTradeState('long', candle.close);
          }
        } else if (signal.action === 'SELL') {
          if (!activePos) {
            portfolio.openPosition('short', signal, candle.close, candle.timestamp);
            tradeState = initTradeState('short', candle.close);
          } else if (activePos.side === 'long') {
            const mfe = tradeState
              ? ((tradeState.highestHigh - activePos.entryPrice) / activePos.entryPrice) * 100
              : 0;
            const mae = tradeState
              ? ((activePos.entryPrice - tradeState.lowestLow) / activePos.entryPrice) * 100
              : 0;
            portfolio.closePosition(signal, candle.close, candle.timestamp, 'reverse', {
              maxFavorablePercent: mfe,
              maxAdversePercent: mae,
              stopPrice: tradeState?.stopPrice ?? undefined,
              ratchetSteps: tradeState?.ratchetSteps,
            });
            portfolio.openPosition('short', signal, candle.close, candle.timestamp);
            tradeState = initTradeState('short', candle.close);
          }
        }
      } else {
        // 'long-only' mode
        if (signal.action === 'BUY') {
          if (!activePos) {
            portfolio.openPosition('long', signal, candle.close, candle.timestamp);
            tradeState = initTradeState('long', candle.close);
          }
        } else if (signal.action === 'SELL') {
          if (activePos && activePos.side === 'long') {
            const mfe = tradeState
              ? ((tradeState.highestHigh - activePos.entryPrice) / activePos.entryPrice) * 100
              : 0;
            const mae = tradeState
              ? ((activePos.entryPrice - tradeState.lowestLow) / activePos.entryPrice) * 100
              : 0;
            portfolio.closePosition(signal, candle.close, candle.timestamp, 'signal', {
              maxFavorablePercent: mfe,
              maxAdversePercent: mae,
              stopPrice: tradeState?.stopPrice ?? undefined,
              ratchetSteps: tradeState?.ratchetSteps,
            });
            tradeState = null;
          }
        }
      }

      equityCurve.push(portfolio.getTotalEquity(candle.close));
    }

    // 4. Close any remaining open position at conclusion of backtest
    if (portfolio.hasOpenPosition()) {
      const finalCandle = candles[candles.length - 1];
      const pos = portfolio.getOpenPosition()!;
      const exitSignal: TradeSignal = {
        action: pos.side === 'long' ? 'SELL' : 'BUY',
        timestamp: finalCandle.timestamp,
        price: finalCandle.close,
        reason: 'Backtest conclusion: closed remaining open position',
      };
      const mfe =
        pos.side === 'long'
          ? tradeState
            ? ((tradeState.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
            : 0
          : tradeState
            ? ((pos.entryPrice - tradeState.lowestLow) / pos.entryPrice) * 100
            : 0;
      const mae =
        pos.side === 'long'
          ? tradeState
            ? ((pos.entryPrice - tradeState.lowestLow) / pos.entryPrice) * 100
            : 0
          : tradeState
            ? ((tradeState.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
            : 0;

      portfolio.closePosition(exitSignal, finalCandle.close, finalCandle.timestamp, 'end', {
        maxFavorablePercent: mfe,
        maxAdversePercent: mae,
        stopPrice: tradeState?.stopPrice ?? undefined,
        ratchetSteps: tradeState?.ratchetSteps,
      });
      tradeState = null;
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
      trailingStop,
      slippagePercent,
      stopCheckMode,
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

