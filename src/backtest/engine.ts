import type { TradeSignal } from '../data/models';
import type {
  BacktestConfig,
  BacktestResult,
  ExitReason,
  TradeSide,
  EntryDiagnostics,
  BacktestTrace,
  TkCrossTraceEvent,
} from './types';
import { VirtualPortfolio } from './portfolio';
import { calculateMetrics } from './metrics';
import { roundTo } from '../utils/math';

interface ActiveTradeState {
  side: TradeSide;
  entryPrice: number;
  entryIndex: number;
  highestHigh: number;
  lowestLow: number;
  stopPrice: number | null;
  initialStopPercent?: number;
  ratchetSteps: number;
  entryDiagnostics?: EntryDiagnostics;
}

interface TraceableStrategy {
  setTraceCollector?: (collector?: { onTkCross?: (event: TkCrossTraceEvent) => void }) => void;
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
      riskPerTradePercent,
      tradeMode = 'long-short',
      exitMode = 'reverse',
      maxBarsInTrade,
      takeProfitPercent,
      stopLossPercent,
      trailingStop,
      slippagePercent = 0,
      stopCheckMode = 'intrabar',
      collectTrace = false,
    } = config;

    const trace: BacktestTrace = {
      tkCrossEvents: [],
      ignoredSignals: [],
    };

    const traceable = strategy as unknown as TraceableStrategy;
    if (collectTrace && typeof traceable.setTraceCollector === 'function') {
      traceable.setTraceCollector({
        onTkCross: (event: TkCrossTraceEvent) => {
          trace.tkCrossEvents.push(event);
        },
      });
    }

    if (!candles || candles.length === 0) {
      throw new Error('Backtest requires at least one candle to execute');
    }

    if (maxBarsInTrade !== undefined && (!Number.isInteger(maxBarsInTrade) || maxBarsInTrade <= 0)) {
      throw new Error('maxBarsInTrade must be a positive integer');
    }

    if (initialBalance <= 0) {
      throw new Error(`Initial balance must be positive, got ${initialBalance}`);
    }

    if (positionSizePercent <= 0 || positionSizePercent > 100) {
      throw new Error(`positionSizePercent must be between 0 and 100, got ${positionSizePercent}`);
    }

    if (riskPerTradePercent !== undefined) {
      if (riskPerTradePercent <= 0 || riskPerTradePercent > 100) {
        throw new Error(`riskPerTradePercent must be between 0 and 100, got ${riskPerTradePercent}`);
      }
      const initialStop = trailingStop ? trailingStop.initialStopPercent : stopLossPercent;
      if (initialStop === undefined || initialStop <= 0) {
        throw new Error('riskPerTradePercent requires an initial stop loss or trailing stop to be configured');
      }
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

    const computeEffectiveSizePercent = (signalStopPercent?: number): number => {
      if (riskPerTradePercent !== undefined) {
        const stopPercent = signalStopPercent ?? (trailingStop ? trailingStop.initialStopPercent : stopLossPercent!);
        const calculatedSize = (riskPerTradePercent / stopPercent) * 100;
        return Math.min(positionSizePercent, calculatedSize);
      }
      return positionSizePercent;
    };

    const initTradeState = (
      side: TradeSide,
      entryPrice: number,
      entryIndex: number,
      entryDiagnostics?: EntryDiagnostics,
      signalMetadata?: Record<string, unknown>
    ): ActiveTradeState => {
      let initialStop: number | null = null;
      let effectiveStopPercent = trailingStop ? trailingStop.initialStopPercent : stopLossPercent;

      if (
        signalMetadata?.initialStopPercent !== undefined &&
        typeof signalMetadata.initialStopPercent === 'number' &&
        signalMetadata.initialStopPercent > 0
      ) {
        effectiveStopPercent = signalMetadata.initialStopPercent;
      }

      if (
        signalMetadata?.stopPrice !== undefined &&
        typeof signalMetadata.stopPrice === 'number' &&
        signalMetadata.stopPrice > 0
      ) {
        initialStop = signalMetadata.stopPrice;
      } else if (effectiveStopPercent !== undefined && effectiveStopPercent > 0) {
        initialStop =
          side === 'long'
            ? roundTo(entryPrice * (1 - effectiveStopPercent / 100), 8)
            : roundTo(entryPrice * (1 + effectiveStopPercent / 100), 8);
      }

      return {
        side,
        entryPrice,
        entryIndex,
        highestHigh: entryPrice,
        lowestLow: entryPrice,
        stopPrice: initialStop,
        initialStopPercent: effectiveStopPercent,
        ratchetSteps: 0,
        entryDiagnostics,
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
            entryDiagnostics: tradeState.entryDiagnostics,
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
            entryDiagnostics: tradeState.entryDiagnostics,
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
          const tradeInitialStop = tradeState.initialStopPercent ?? trailingStop.initialStopPercent;
          if (currentPos.side === 'long') {
            const mfePercent =
              ((tradeState.highestHigh - currentPos.entryPrice) / currentPos.entryPrice) * 100;
            const n = Math.floor(mfePercent / trailingStop.stepPercent);
            if (n > 0) {
              const candidateStopPercent =
                -tradeInitialStop + n * trailingStop.raisePercent;
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
                -tradeInitialStop + n * trailingStop.raisePercent;
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

      // 2b. Check time stop (maxBarsInTrade) and exit variants (exitMode)
      if (portfolio.hasOpenPosition() && tradeState) {
        const currentPos = portfolio.getOpenPosition()!;
        const barsHeld = i - tradeState.entryIndex;

        let shouldExit = false;
        let exitReason: ExitReason | null = null;
        let exitDescription = '';

        if (maxBarsInTrade !== undefined && barsHeld >= maxBarsInTrade) {
          shouldExit = true;
          exitReason = 'timeStop';
          exitDescription = `Time stop reached (${barsHeld} bars in trade >= max ${maxBarsInTrade})`;
        } else if (exitMode !== 'reverse') {
          if (exitMode === 'tkCross') {
            if (strategy.exitSignal?.(candles, i, currentPos.side, 'tkCross')) {
              shouldExit = true;
              exitReason = 'tkCrossExit';
              exitDescription = `Opposite TK cross exit (${currentPos.side})`;
            }
          } else if (exitMode === 'kijun') {
            if (strategy.exitSignal?.(candles, i, currentPos.side, 'kijun')) {
              shouldExit = true;
              exitReason = 'kijunExit';
              exitDescription = `Kijun cross exit (${currentPos.side})`;
            }
          }
        }

        if (shouldExit && exitReason) {
          const mfe =
            currentPos.side === 'long'
              ? ((tradeState.highestHigh - currentPos.entryPrice) / currentPos.entryPrice) * 100
              : ((currentPos.entryPrice - tradeState.lowestLow) / currentPos.entryPrice) * 100;
          const mae =
            currentPos.side === 'long'
              ? ((currentPos.entryPrice - tradeState.lowestLow) / currentPos.entryPrice) * 100
              : ((tradeState.highestHigh - currentPos.entryPrice) / currentPos.entryPrice) * 100;

          const exitSig: TradeSignal = {
            action: currentPos.side === 'long' ? 'SELL' : 'BUY',
            timestamp: candle.timestamp,
            price: candle.close,
            reason: exitDescription,
          };

          portfolio.closePosition(exitSig, candle.close, candle.timestamp, exitReason, {
            maxFavorablePercent: mfe,
            maxAdversePercent: mae,
            stopPrice: tradeState.stopPrice ?? undefined,
            ratchetSteps: tradeState.ratchetSteps,
            entryDiagnostics: tradeState.entryDiagnostics,
          });
          tradeState = null;
        }
      }

      // 3. Process strategy signal at candle close (even after stop-out)
      const signal = strategy.analyze(candles, i);
      const activePos = portfolio.getOpenPosition();
      const entryDiag = (signal.metadata as { entryDiagnostics?: EntryDiagnostics } | undefined)?.entryDiagnostics;

      const signalStopPercent =
        typeof signal.metadata?.initialStopPercent === 'number'
          ? (signal.metadata.initialStopPercent as number)
          : undefined;

      if (tradeMode === 'long-short') {
        if (signal.action === 'BUY') {
          if (!activePos) {
            portfolio.openPosition('long', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('long', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
          } else if (activePos.side === 'short') {
            if (exitMode === 'trailingOnly') {
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'alreadyInPosition',
                });
              }
            } else {
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
                entryDiagnostics: tradeState?.entryDiagnostics,
              });
              portfolio.openPosition('long', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
              tradeState = initTradeState('long', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
            }
          } else if (activePos.side === 'long') {
            if (collectTrace) {
              trace.ignoredSignals.push({
                index: i,
                timestamp: candle.timestamp,
                signal,
                reason: 'alreadyInPosition',
              });
            }
          }
        } else if (signal.action === 'SELL') {
          if (!activePos) {
            portfolio.openPosition('short', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('short', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
          } else if (activePos.side === 'long') {
            if (exitMode === 'trailingOnly') {
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'alreadyInPosition',
                });
              }
            } else {
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
                entryDiagnostics: tradeState?.entryDiagnostics,
              });
              portfolio.openPosition('short', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
              tradeState = initTradeState('short', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
            }
          } else if (activePos.side === 'short') {
            if (collectTrace) {
              trace.ignoredSignals.push({
                index: i,
                timestamp: candle.timestamp,
                signal,
                reason: 'alreadyInPosition',
              });
            }
          }
        }
      } else {
        // 'long-only' mode
        if (signal.action === 'BUY') {
          if (!activePos) {
            portfolio.openPosition('long', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('long', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
          } else if (activePos.side === 'long') {
            if (collectTrace) {
              trace.ignoredSignals.push({
                index: i,
                timestamp: candle.timestamp,
                signal,
                reason: 'alreadyInPosition',
              });
            }
          }
        } else if (signal.action === 'SELL') {
          if (activePos && activePos.side === 'long') {
            if (exitMode === 'trailingOnly') {
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'longOnlyShortIgnored',
                });
              }
            } else {
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
                entryDiagnostics: tradeState?.entryDiagnostics,
              });
              tradeState = null;
            }
          } else if (!activePos) {
            if (collectTrace) {
              trace.ignoredSignals.push({
                index: i,
                timestamp: candle.timestamp,
                signal,
                reason: 'longOnlyShortIgnored',
              });
            }
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
        entryDiagnostics: tradeState?.entryDiagnostics,
      });
      tradeState = null;
      equityCurve[equityCurve.length - 1] = portfolio.getCash();
    }

    if (collectTrace && typeof traceable.setTraceCollector === 'function') {
      traceable.setTraceCollector(undefined);
    }

    const trades = portfolio.getTrades();
    const metrics = calculateMetrics(trades, initialBalance, equityCurve);

    const configSummary: Omit<BacktestConfig, 'candles'> = {
      strategy: config.strategy,
      initialBalance: config.initialBalance,
      tradeFeePercent,
      positionSizePercent,
      riskPerTradePercent,
      tradeMode,
      takeProfitPercent,
      stopLossPercent,
      trailingStop,
      slippagePercent,
      stopCheckMode,
      collectTrace: config.collectTrace,
    };


    return {
      config: configSummary,
      trades,
      metrics,
      equity: equityCurve,
      activePosition: null,
      trace: collectTrace ? trace : undefined,
    };
  }
}

