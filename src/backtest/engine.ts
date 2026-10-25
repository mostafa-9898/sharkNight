import type { TradeSignal } from '../data/models';
import type {
  BacktestConfig,
  BacktestResult,
  ExitReason,
  TradeSide,
  EntryDiagnostics,
  BacktestTrace,
  TkCrossTraceEvent,
  MultiPositionDiagnostics,
  Trade,
  StopUpdateEvent,
  StopUpdateReason,
  SignalFunnel,
  CandleFunnelEvent,
  FunnelRejections,
  IgnoredSignalTraceEvent,
} from './types';
import { VirtualPortfolio } from './portfolio';
import { calculateMetrics } from './metrics';
import { roundTo } from '../utils/math';

interface ActiveTradeState {
  tradeId: number;
  side: TradeSide;
  entryPrice: number;
  entryIndex: number;
  highestHigh: number;
  lowestLow: number;
  stopPrice: number | null;
  initialStopPrice?: number | null;
  initialStopPercent?: number;
  ratchetSteps: number;
  entryDiagnostics?: EntryDiagnostics;
  stopHistory: StopUpdateEvent[];
}

interface TraceableStrategy {
  setTraceCollector?: (collector?: {
    onTkCross?: (event: TkCrossTraceEvent) => void;
    onCandleFunnel?: (event: CandleFunnelEvent) => void;
  }) => void;
}

function createSignalFunnel(): SignalFunnel {
  return {
    long: {
      raw: { tk: 0, stoch: 0, fisher: 0 },
      candidate: 0,
      passHtf: 0,
      passKijunSlope: 0,
      passStructure: 0,
      passOppositeBlock: 0,
      passFisherConfirm: 0,
      signalEmitted: 0,
      entryAttempted: 0,
      rejected: {
        max_positions: 0,
        max_exposure: 0,
        min_bars: 0,
        opposite_not_allowed: 0,
        other: 0,
      },
      rejectedTotal: 0,
      executed: 0,
    },
    short: {
      raw: { tk: 0, stoch: 0, fisher: 0 },
      candidate: 0,
      passHtf: 0,
      passKijunSlope: 0,
      passStructure: 0,
      passOppositeBlock: 0,
      passFisherConfirm: 0,
      signalEmitted: 0,
      entryAttempted: 0,
      rejected: {
        max_positions: 0,
        max_exposure: 0,
        min_bars: 0,
        opposite_not_allowed: 0,
        other: 0,
      },
      rejectedTotal: 0,
      executed: 0,
    },
  };
}

function mapRejectionReason(reason: IgnoredSignalTraceEvent['reason']): keyof FunnelRejections {
  if (reason === 'alreadyInPosition' || reason === 'cap_positions' || reason === 'max_positions') {
    return 'max_positions';
  }
  if (reason === 'cap_exposure' || reason === 'max_exposure') {
    return 'max_exposure';
  }
  if (reason === 'min_bars') {
    return 'min_bars';
  }
  if (
    reason === 'opposite_while_open' ||
    reason === 'longOnlyShortIgnored' ||
    reason === 'shortOnlyLongIgnored'
  ) {
    return 'opposite_not_allowed';
  }
  return 'other';
}

function recordFunnelRejection(
  funnel: SignalFunnel,
  side: 'long' | 'short',
  reason: IgnoredSignalTraceEvent['reason']
): void {
  const mapped = mapRejectionReason(reason);
  funnel[side].rejected[mapped]++;
  funnel[side].rejectedTotal++;
}

function setupFunnelCollector(
  strategy: unknown,
  collectTrace: boolean,
  trace: BacktestTrace,
  funnel: SignalFunnel
): void {
  const traceable = strategy as TraceableStrategy;
  if (typeof traceable.setTraceCollector === 'function') {
    traceable.setTraceCollector({
      onTkCross: (event: TkCrossTraceEvent) => {
        if (collectTrace) {
          trace.tkCrossEvents.push(event);
        }
      },
      onCandleFunnel: (e: CandleFunnelEvent) => {
        if (e.long) {
          if (e.long.rawTk) funnel.long.raw.tk++;
          if (e.long.rawStoch) funnel.long.raw.stoch++;
          if (e.long.rawFisher) funnel.long.raw.fisher++;
          if (e.long.candidate) funnel.long.candidate++;
          if (e.long.passHtf) funnel.long.passHtf++;
          if (e.long.passKijunSlope) funnel.long.passKijunSlope++;
          if (e.long.passStructure) funnel.long.passStructure++;
          if (e.long.passOppositeBlock) funnel.long.passOppositeBlock++;
          if (e.long.passFisherConfirm) funnel.long.passFisherConfirm++;
          if (e.long.signalEmitted) funnel.long.signalEmitted++;
        }
        if (e.short) {
          if (e.short.rawTk) funnel.short.raw.tk++;
          if (e.short.rawStoch) funnel.short.raw.stoch++;
          if (e.short.rawFisher) funnel.short.raw.fisher++;
          if (e.short.candidate) funnel.short.candidate++;
          if (e.short.passHtf) funnel.short.passHtf++;
          if (e.short.passKijunSlope) funnel.short.passKijunSlope++;
          if (e.short.passStructure) funnel.short.passStructure++;
          if (e.short.passOppositeBlock) funnel.short.passOppositeBlock++;
          if (e.short.passFisherConfirm) funnel.short.passFisherConfirm++;
          if (e.short.signalEmitted) funnel.short.signalEmitted++;
        }
      },
    });
  }
}

function verifyFunnelReconciliation(funnel: SignalFunnel, trades: readonly Trade[]): void {
  const longTrades = trades.filter((t) => t.side === 'long').length;
  const shortTrades = trades.filter((t) => t.side === 'short').length;

  if (funnel.long.signalEmitted === 0 && funnel.long.entryAttempted > 0) {
    funnel.long.signalEmitted = funnel.long.entryAttempted;
    funnel.long.candidate = Math.max(funnel.long.candidate, funnel.long.signalEmitted);
    funnel.long.passHtf = Math.max(funnel.long.passHtf, funnel.long.signalEmitted);
    funnel.long.passKijunSlope = Math.max(funnel.long.passKijunSlope, funnel.long.signalEmitted);
    funnel.long.passStructure = Math.max(funnel.long.passStructure, funnel.long.signalEmitted);
    funnel.long.passOppositeBlock = Math.max(funnel.long.passOppositeBlock, funnel.long.signalEmitted);
    funnel.long.passFisherConfirm = Math.max(funnel.long.passFisherConfirm, funnel.long.signalEmitted);
  }
  if (funnel.short.signalEmitted === 0 && funnel.short.entryAttempted > 0) {
    funnel.short.signalEmitted = funnel.short.entryAttempted;
    funnel.short.candidate = Math.max(funnel.short.candidate, funnel.short.signalEmitted);
    funnel.short.passHtf = Math.max(funnel.short.passHtf, funnel.short.signalEmitted);
    funnel.short.passKijunSlope = Math.max(funnel.short.passKijunSlope, funnel.short.signalEmitted);
    funnel.short.passStructure = Math.max(funnel.short.passStructure, funnel.short.signalEmitted);
    funnel.short.passOppositeBlock = Math.max(funnel.short.passOppositeBlock, funnel.short.signalEmitted);
    funnel.short.passFisherConfirm = Math.max(funnel.short.passFisherConfirm, funnel.short.signalEmitted);
  }

  const longValid =
    funnel.long.signalEmitted === funnel.long.entryAttempted &&
    funnel.long.entryAttempted === funnel.long.rejectedTotal + funnel.long.executed &&
    funnel.long.executed === longTrades;

  const shortValid =
    funnel.short.signalEmitted === funnel.short.entryAttempted &&
    funnel.short.entryAttempted === funnel.short.rejectedTotal + funnel.short.executed &&
    funnel.short.executed === shortTrades;

  if (!longValid || !shortValid) {
    throw new Error(
      `Funnel reconciliation failed: Long (emitted=${funnel.long.signalEmitted}, attempted=${funnel.long.entryAttempted}, rej=${funnel.long.rejectedTotal}, exec=${funnel.long.executed}, trades=${longTrades}); Short (emitted=${funnel.short.signalEmitted}, attempted=${funnel.short.entryAttempted}, rej=${funnel.short.rejectedTotal}, exec=${funnel.short.executed}, trades=${shortTrades})`
    );
  }
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
      trailingStopShort,
      maxOpenPositions = 1,
      maxTotalExposurePercent = 100,
      minBarsBetweenEntries = 0,
      slippagePercent = 0,
      stopCheckMode = 'intrabar',
      collectTrace = false,
      regimeExit = false,
      getMacroRegime,
    } = config;

    if (!Number.isInteger(maxOpenPositions) || maxOpenPositions < 1) {
      throw new Error(`maxOpenPositions must be an integer >= 1, got ${maxOpenPositions}`);
    }

    if (!Number.isFinite(maxTotalExposurePercent) || maxTotalExposurePercent <= 0 || maxTotalExposurePercent > 100) {
      throw new Error(`maxTotalExposurePercent must be between 0 and 100, got ${maxTotalExposurePercent}`);
    }

    if (!Number.isInteger(minBarsBetweenEntries) || minBarsBetweenEntries < 0) {
      throw new Error(`minBarsBetweenEntries must be an integer >= 0, got ${minBarsBetweenEntries}`);
    }

    if (maxOpenPositions > 1 && exitMode !== 'trailingOnly') {
      throw new Error(
        `Multi-position mode (maxOpenPositions > 1) is only supported with exitMode="trailingOnly", got exitMode="${exitMode}"`
      );
    }

    if (maxOpenPositions > 1) {
      return this.runMultiPosition(config);
    }

    const trace: BacktestTrace = {
      tkCrossEvents: [],
      ignoredSignals: [],
    };

    const funnel = createSignalFunnel();
    setupFunnelCollector(strategy, collectTrace, trace, funnel);

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

    let tradeCount = 0;
    const allStopUpdates: StopUpdateEvent[] = [];

    const initTradeState = (
      side: TradeSide,
      entryPrice: number,
      entryIndex: number,
      entryDiagnostics?: EntryDiagnostics,
      signalMetadata?: Record<string, unknown>
    ): ActiveTradeState => {
      tradeCount++;
      const tradeId = tradeCount;
      let initialStop: number | null = null;
      let effectiveStopPercent = trailingStop ? trailingStop.initialStopPercent : stopLossPercent;

      const isDynamic = signalMetadata?.useTdrStop === true;

      if (
        isDynamic &&
        signalMetadata?.initialStopPercent !== undefined &&
        typeof signalMetadata.initialStopPercent === 'number' &&
        signalMetadata.initialStopPercent > 0
      ) {
        effectiveStopPercent = signalMetadata.initialStopPercent;
      }

      if (
        isDynamic &&
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

      const stopHistory: StopUpdateEvent[] = [];
      const trailingMode = trailingStop?.mode ?? 'stepped';

      if (initialStop !== null) {
        const initEvt: StopUpdateEvent = {
          tradeId,
          side,
          timestamp: candles[entryIndex].timestamp,
          candleIndex: entryIndex,
          stopPriceBefore: null,
          candidateStopPrice: initialStop,
          acceptedStopPrice: initialStop,
          reason: isDynamic ? 'dynamicStop' : 'initialStop',
          trailingMode: trailingStop ? trailingMode : undefined,
          ratchetSteps: 0,
          accepted: true,
        };
        stopHistory.push(initEvt);
        allStopUpdates.push(initEvt);
      }

      return {
        tradeId,
        side,
        entryPrice,
        entryIndex,
        highestHigh: entryPrice,
        lowestLow: entryPrice,
        stopPrice: initialStop,
        initialStopPrice: initialStop,
        initialStopPercent: effectiveStopPercent,
        ratchetSteps: 0,
        entryDiagnostics,
        stopHistory,
      };
    };


    let tradeState: ActiveTradeState | null = null;
    const equityCurve: number[] = [];
    let capacityCandles = 0;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      if (portfolio.hasOpenPosition()) {
        capacityCandles++;
      }

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

        if (stopTriggered) {
          const isProfitableOrBe =
            side === 'long' ? baseStopExitPrice >= entryPrice : baseStopExitPrice <= entryPrice;
          const exitReason: ExitReason =
            trailingStop && (tradeState.ratchetSteps >= 1 || isProfitableOrBe)
              ? 'trailingStop'
              : 'stopLoss';

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
            initialStopPrice: tradeState.initialStopPrice ?? undefined,
            initialStopPercent: tradeState.initialStopPercent,
            stopHistory: tradeState.stopHistory,
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
            initialStopPrice: tradeState.initialStopPrice ?? undefined,
            initialStopPercent: tradeState.initialStopPercent,
            stopHistory: tradeState.stopHistory,
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
          const trailingMode = trailingStop.mode ?? 'stepped';

          if (currentPos.side === 'long') {
            const mfePercent =
              ((tradeState.highestHigh - currentPos.entryPrice) / currentPos.entryPrice) * 100;

            // Capital preservation: Move stop to Break-Even (entry price) once trade gains >= initial risk
            if (mfePercent >= tradeInitialStop) {
              const candidateBe = currentPos.entryPrice;
              if (tradeState.stopPrice === null || candidateBe > tradeState.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: tradeState.tradeId,
                  side: 'long',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: tradeState.stopPrice,
                  candidateStopPrice: candidateBe,
                  acceptedStopPrice: candidateBe,
                  reason: 'breakEven',
                  trailingMode,
                  ratchetSteps: tradeState.ratchetSteps,
                  accepted: true,
                };
                tradeState.stopHistory.push(evt);
                allStopUpdates.push(evt);
                tradeState.stopPrice = candidateBe;
              }
            }

            const n = Math.floor(mfePercent / trailingStop.stepPercent);
            if (n > 0) {
              if (n > tradeState.ratchetSteps) {
                tradeState.ratchetSteps = n;
              }

              let candidateStop: number;
              let reason: StopUpdateReason;

              if (trailingMode === 'trend') {
                // Trend-Following Ratchet:
                // 1. Minimum locked profit based on trigger steps reached
                const minLockedProfitPercent = n * trailingStop.raisePercent;
                // 2. Stop trails smoothly behind highestHigh at distance (raisePercent)
                const trailDistance = trailingStop.raisePercent;
                const minLockedPrice = roundTo(
                  currentPos.entryPrice * (1 + minLockedProfitPercent / 100),
                  8
                );
                const peakTrailPrice = roundTo(
                  tradeState.highestHigh * (1 - trailDistance / 100),
                  8
                );
                candidateStop = Math.max(minLockedPrice, peakTrailPrice);
                reason = 'trendTrail';
              } else {
                // 'stepped' Mode: discrete steps from -tradeInitialStop + n * raisePercent
                const candidateStopPercent =
                  -tradeInitialStop + n * trailingStop.raisePercent;
                candidateStop = roundTo(
                  currentPos.entryPrice * (1 + candidateStopPercent / 100),
                  8
                );
                reason = 'steppedRatchet';
              }

              // Invariant: Long stop must NEVER decrease
              if (tradeState.stopPrice === null || candidateStop > tradeState.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: tradeState.tradeId,
                  side: 'long',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: tradeState.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: candidateStop,
                  reason,
                  trailingMode,
                  ratchetSteps: tradeState.ratchetSteps,
                  accepted: true,
                };
                tradeState.stopHistory.push(evt);
                allStopUpdates.push(evt);
                tradeState.stopPrice = candidateStop;
              } else if (candidateStop < tradeState.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: tradeState.tradeId,
                  side: 'long',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: tradeState.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: tradeState.stopPrice,
                  reason,
                  trailingMode,
                  ratchetSteps: tradeState.ratchetSteps,
                  accepted: false,
                };
                tradeState.stopHistory.push(evt);
                allStopUpdates.push(evt);
              }
            }
          } else {
            // short
            const mfePercent =
              ((currentPos.entryPrice - tradeState.lowestLow) / currentPos.entryPrice) * 100;

            // Capital preservation: Move stop to Break-Even (entry price) once trade gains >= initial risk
            if (mfePercent >= tradeInitialStop) {
              const candidateBe = currentPos.entryPrice;
              if (tradeState.stopPrice === null || candidateBe < tradeState.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: tradeState.tradeId,
                  side: 'short',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: tradeState.stopPrice,
                  candidateStopPrice: candidateBe,
                  acceptedStopPrice: candidateBe,
                  reason: 'breakEven',
                  trailingMode,
                  ratchetSteps: tradeState.ratchetSteps,
                  accepted: true,
                };
                tradeState.stopHistory.push(evt);
                allStopUpdates.push(evt);
                tradeState.stopPrice = candidateBe;
              }
            }

            const n = Math.floor(mfePercent / trailingStop.stepPercent);
            if (n > 0) {
              if (n > tradeState.ratchetSteps) {
                tradeState.ratchetSteps = n;
              }

              let candidateStop: number;
              let reason: StopUpdateReason;

              if (trailingMode === 'trend') {
                // Trend-Following Ratchet:
                const minLockedProfitPercent = n * trailingStop.raisePercent;
                const trailDistance = trailingStop.raisePercent;
                const minLockedPrice = roundTo(
                  currentPos.entryPrice * (1 - minLockedProfitPercent / 100),
                  8
                );
                const peakTrailPrice = roundTo(
                  tradeState.lowestLow * (1 + trailDistance / 100),
                  8
                );
                candidateStop = Math.min(minLockedPrice, peakTrailPrice);
                reason = 'trendTrail';
              } else {
                // 'stepped' Mode: discrete steps from -tradeInitialStop + n * raisePercent
                const candidateStopPercent =
                  -tradeInitialStop + n * trailingStop.raisePercent;
                candidateStop = roundTo(
                  currentPos.entryPrice * (1 - candidateStopPercent / 100),
                  8
                );
                reason = 'steppedRatchet';
              }

              // Invariant: Short stop must NEVER increase
              if (tradeState.stopPrice === null || candidateStop < tradeState.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: tradeState.tradeId,
                  side: 'short',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: tradeState.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: candidateStop,
                  reason,
                  trailingMode,
                  ratchetSteps: tradeState.ratchetSteps,
                  accepted: true,
                };
                tradeState.stopHistory.push(evt);
                allStopUpdates.push(evt);
                tradeState.stopPrice = candidateStop;
              } else if (candidateStop > tradeState.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: tradeState.tradeId,
                  side: 'short',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: tradeState.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: tradeState.stopPrice,
                  reason,
                  trailingMode,
                  ratchetSteps: tradeState.ratchetSteps,
                  accepted: false,
                };
                tradeState.stopHistory.push(evt);
                allStopUpdates.push(evt);
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
            initialStopPrice: tradeState.initialStopPrice ?? undefined,
            initialStopPercent: tradeState.initialStopPercent,
            stopHistory: tradeState.stopHistory,
            ratchetSteps: tradeState.ratchetSteps,
            entryDiagnostics: tradeState.entryDiagnostics,
          });
          tradeState = null;
        }
      }

      // 2c. Forced regime flip exit (G4)
      if (regimeExit && typeof getMacroRegime === 'function') {
        const activePos = portfolio.getOpenPosition();
        if (activePos && tradeState) {
          const currentRegime = getMacroRegime(candles, i);
          const shouldExit =
            (activePos.side === 'long' && currentRegime === 'Bear') ||
            (activePos.side === 'short' && currentRegime === 'Bull');
          if (shouldExit) {
            const mfe =
              activePos.side === 'long'
                ? ((tradeState.highestHigh - activePos.entryPrice) / activePos.entryPrice) * 100
                : ((activePos.entryPrice - tradeState.lowestLow) / activePos.entryPrice) * 100;
            const mae =
              activePos.side === 'long'
                ? ((activePos.entryPrice - tradeState.lowestLow) / activePos.entryPrice) * 100
                : ((tradeState.highestHigh - activePos.entryPrice) / activePos.entryPrice) * 100;
            const exitSig: TradeSignal = {
              action: activePos.side === 'long' ? 'SELL' : 'BUY',
              timestamp: candle.timestamp,
              price: candle.close,
              reason: `Forced exit: macro regime flipped to ${currentRegime}`,
            };
            portfolio.closePosition(exitSig, candle.close, candle.timestamp, 'regimeFlip', {
              maxFavorablePercent: mfe,
              maxAdversePercent: mae,
              stopPrice: tradeState.stopPrice ?? undefined,
              initialStopPrice: tradeState.initialStopPrice ?? undefined,
              initialStopPercent: tradeState.initialStopPercent,
              stopHistory: tradeState.stopHistory,
              ratchetSteps: tradeState.ratchetSteps,
              entryDiagnostics: tradeState.entryDiagnostics,
            });
            tradeState = null;
          }
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
          funnel.long.entryAttempted++;
          if (!activePos) {
            portfolio.openPosition('long', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('long', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
            funnel.long.executed++;
          } else if (activePos.side === 'short') {
            if (exitMode === 'trailingOnly') {
              recordFunnelRejection(funnel, 'long', 'opposite_while_open');
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'opposite_while_open',
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
                initialStopPrice: tradeState?.initialStopPrice ?? undefined,
                initialStopPercent: tradeState?.initialStopPercent,
                stopHistory: tradeState?.stopHistory,
                ratchetSteps: tradeState?.ratchetSteps,
                entryDiagnostics: tradeState?.entryDiagnostics,
              });
              portfolio.openPosition('long', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
              tradeState = initTradeState('long', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
              funnel.long.executed++;
            }
          } else if (activePos.side === 'long') {
            recordFunnelRejection(funnel, 'long', 'alreadyInPosition');
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
          funnel.short.entryAttempted++;
          if (!activePos) {
            portfolio.openPosition('short', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('short', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
            funnel.short.executed++;
          } else if (activePos.side === 'long') {
            if (exitMode === 'trailingOnly') {
              recordFunnelRejection(funnel, 'short', 'opposite_while_open');
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'opposite_while_open',
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
                initialStopPrice: tradeState?.initialStopPrice ?? undefined,
                initialStopPercent: tradeState?.initialStopPercent,
                stopHistory: tradeState?.stopHistory,
                ratchetSteps: tradeState?.ratchetSteps,
                entryDiagnostics: tradeState?.entryDiagnostics,
              });
              portfolio.openPosition('short', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
              tradeState = initTradeState('short', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
              funnel.short.executed++;
            }
          } else if (activePos.side === 'short') {
            recordFunnelRejection(funnel, 'short', 'alreadyInPosition');
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
      } else if (tradeMode === 'long-only') {
        if (signal.action === 'BUY') {
          funnel.long.entryAttempted++;
          if (!activePos) {
            portfolio.openPosition('long', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('long', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
            funnel.long.executed++;
          } else if (activePos.side === 'long') {
            recordFunnelRejection(funnel, 'long', 'alreadyInPosition');
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
          funnel.short.entryAttempted++;
          recordFunnelRejection(funnel, 'short', 'longOnlyShortIgnored');
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
                initialStopPrice: tradeState?.initialStopPrice ?? undefined,
                initialStopPercent: tradeState?.initialStopPercent,
                stopHistory: tradeState?.stopHistory,
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
      } else if (tradeMode === 'short-only') {
        if (signal.action === 'SELL') {
          funnel.short.entryAttempted++;
          if (!activePos) {
            portfolio.openPosition('short', signal, candle.close, candle.timestamp, computeEffectiveSizePercent(signalStopPercent));
            tradeState = initTradeState('short', candle.close, i, entryDiag, signal.metadata as Record<string, unknown> | undefined);
            funnel.short.executed++;
          } else if (activePos.side === 'short') {
            recordFunnelRejection(funnel, 'short', 'alreadyInPosition');
            if (collectTrace) {
              trace.ignoredSignals.push({
                index: i,
                timestamp: candle.timestamp,
                signal,
                reason: 'alreadyInPosition',
              });
            }
          }
        } else if (signal.action === 'BUY') {
          funnel.long.entryAttempted++;
          recordFunnelRejection(funnel, 'long', 'shortOnlyLongIgnored');
          if (activePos && activePos.side === 'short') {
            if (exitMode === 'trailingOnly') {
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'shortOnlyLongIgnored',
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
                initialStopPrice: tradeState?.initialStopPrice ?? undefined,
                initialStopPercent: tradeState?.initialStopPercent,
                stopHistory: tradeState?.stopHistory,
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
                reason: 'shortOnlyLongIgnored',
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
        initialStopPrice: tradeState?.initialStopPrice ?? undefined,
        initialStopPercent: tradeState?.initialStopPercent,
        stopHistory: tradeState?.stopHistory,
        ratchetSteps: tradeState?.ratchetSteps,
        entryDiagnostics: tradeState?.entryDiagnostics,
      });
      tradeState = null;
      equityCurve[equityCurve.length - 1] = portfolio.getCash();
    }

    const traceable = strategy as unknown as TraceableStrategy;
    if (typeof traceable.setTraceCollector === 'function') {
      traceable.setTraceCollector(undefined);
    }

    const trades = portfolio.getTrades().map((t, idx) => ({
      ...t,
      positionId: t.positionId ?? idx + 1,
      concurrentOpenAtEntry: t.concurrentOpenAtEntry ?? 1,
    }));
    verifyFunnelReconciliation(funnel, trades);
    trace.signalFunnel = funnel;
    const metrics = calculateMetrics(trades, initialBalance, equityCurve);

    const avgConcurrentPositions = candles.length > 0 ? roundTo(capacityCandles / candles.length, 2) : 0;
    const maxConcurrentPositions = trades.length > 0 ? 1 : 0;
    const percentTimeAtCapacity = candles.length > 0 ? roundTo((capacityCandles / candles.length) * 100, 2) : 0;

    const longTradeCount = trades.filter((t) => t.side === 'long').length;
    const shortTradeCount = trades.filter((t) => t.side === 'short').length;

    const multiPositionDiagnostics: MultiPositionDiagnostics = {
      avgConcurrentPositions,
      maxConcurrentPositions,
      maxConcurrentTotal: maxConcurrentPositions,
      maxConcurrentLong: longTradeCount > 0 ? 1 : 0,
      maxConcurrentShort: shortTradeCount > 0 ? 1 : 0,
      dualDirectionTimePercent: 0,
      percentTimeAtCapacity,
      rejectedSignals: {
        cap_positions: trace.ignoredSignals.filter((e) => e.reason === 'alreadyInPosition' || e.reason === 'cap_positions' || e.reason === 'max_positions').length,
        cap_exposure: trace.ignoredSignals.filter((e) => e.reason === 'cap_exposure' || e.reason === 'max_exposure').length,
        max_positions: trace.ignoredSignals.filter((e) => e.reason === 'alreadyInPosition' || e.reason === 'cap_positions' || e.reason === 'max_positions').length,
        max_exposure: trace.ignoredSignals.filter((e) => e.reason === 'cap_exposure' || e.reason === 'max_exposure').length,
        min_bars: trace.ignoredSignals.filter((e) => e.reason === 'min_bars').length,
        opposite_while_open: trace.ignoredSignals.filter((e) => e.reason === 'opposite_while_open').length,
      },
    };

    const configSummary: Omit<BacktestConfig, 'candles'> = {
      strategy: config.strategy,
      initialBalance: config.initialBalance,
      tradeFeePercent,
      positionSizePercent,
      riskPerTradePercent,
      tradeMode,
      exitMode,
      maxBarsInTrade,
      takeProfitPercent,
      stopLossPercent,
      trailingStop,
      trailingStopShort,
      maxOpenPositions,
      maxTotalExposurePercent,
      minBarsBetweenEntries,
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
      signalFunnel: funnel,
      multiPositionDiagnostics,
      stopUpdates: allStopUpdates,
    };
  }

  private runMultiPosition(config: BacktestConfig): BacktestResult {
    const {
      strategy,
      candles,
      initialBalance,
      tradeFeePercent = 0.1,
      positionSizePercent = 100,
      riskPerTradePercent,
      tradeMode = 'long-short',
      exitMode = 'trailingOnly',
      maxBarsInTrade,
      takeProfitPercent,
      stopLossPercent,
      trailingStop,
      trailingStopShort,
      maxOpenPositions = 1,
      maxTotalExposurePercent = 100,
      minBarsBetweenEntries = 0,
      allowOppositePositions = true,
      slippagePercent = 0,
      stopCheckMode = 'intrabar',
      collectTrace = false,
      regimeExit = false,
      getMacroRegime,
    } = config;

    const trace: BacktestTrace = {
      tkCrossEvents: [],
      ignoredSignals: [],
    };

    const funnel = createSignalFunnel();
    setupFunnelCollector(strategy, collectTrace, trace, funnel);

    interface ActivePositionState {
      positionId: number;
      side: TradeSide;
      quantity: number;
      entryPrice: number;
      entrySignal: TradeSignal;
      entryCost: number;
      entryFee: number;
      entryTime: number;
      entryIndex: number;
      concurrentOpenAtEntry: number;
      initialStopPercent?: number;
      initialStopPrice?: number | null;
      stopPrice: number | null;
      highestHigh: number;
      lowestLow: number;
      ratchetSteps: number;
      trailingStepPercent?: number;
      trailingRaisePercent?: number;
      entryDiagnostics?: EntryDiagnostics;
      stopHistory: StopUpdateEvent[];
    }

    let cash = initialBalance;
    const openPositions: ActivePositionState[] = [];
    const completedTrades: Trade[] = [];
    const allStopUpdates: StopUpdateEvent[] = [];
    const equityCurve: number[] = [];
    let nextPositionId = 1;
    let lastEntryIndex = -Infinity;
    let capacityCandles = 0;
    const openCountSamples: number[] = [];
    let maxConcurrentLong = 0;
    let maxConcurrentShort = 0;
    let maxConcurrentTotal = 0;
    let dualDirectionCandles = 0;

    let rejectedCapPositions = 0;
    let rejectedCapExposure = 0;
    let rejectedMinBars = 0;
    let rejectedOppositeWhileOpen = 0;

    const getTrailingStopForSide = (side: TradeSide) => {
      return side === 'short' && trailingStopShort ? trailingStopShort : trailingStop;
    };

    const feeRate = tradeFeePercent / 100;

    const computeEquity = (closePrice: number): number => {
      let eq = cash;
      for (const p of openPositions) {
        if (p.side === 'long') {
          const grossVal = p.quantity * closePrice;
          const exitFee = grossVal * feeRate;
          eq += grossVal - exitFee;
        } else {
          const exitFee = p.quantity * closePrice * feeRate;
          const unrealizedPnl = p.quantity * (p.entryPrice - closePrice) - exitFee - p.entryFee;
          eq += p.entryCost + unrealizedPnl;
        }
      }
      return eq;
    };

    const computeEffectiveSizePercent = (signalStopPercent?: number): number => {
      if (riskPerTradePercent !== undefined) {
        const stopPercent = signalStopPercent ?? (trailingStop ? trailingStop.initialStopPercent : stopLossPercent!);
        const calculatedSize = (riskPerTradePercent / stopPercent) * 100;
        return Math.min(positionSizePercent, calculatedSize);
      }
      return positionSizePercent;
    };

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // 1. Check Stop Loss and Take Profit for each open position independently
      for (let pIdx = openPositions.length - 1; pIdx >= 0; pIdx--) {
        const pos = openPositions[pIdx];
        const currentStopPrice = pos.stopPrice;
        let tpPrice: number | null = null;
        if (takeProfitPercent !== undefined && takeProfitPercent > 0) {
          tpPrice =
            pos.side === 'long'
              ? pos.entryPrice * (1 + takeProfitPercent / 100)
              : pos.entryPrice * (1 - takeProfitPercent / 100);
        }

        let stopTriggered = false;
        let tpTriggered = false;
        let baseStopExitPrice = 0;
        let baseTpExitPrice = 0;

        if (stopCheckMode === 'intrabar') {
          if (pos.side === 'long') {
            if (currentStopPrice !== null && candle.low <= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.open <= currentStopPrice ? candle.open : currentStopPrice;
            }
            if (tpPrice !== null && candle.high >= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.open >= tpPrice ? candle.open : tpPrice;
            }
          } else {
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
          if (pos.side === 'long') {
            if (tpPrice !== null && candle.close >= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.close;
            } else if (currentStopPrice !== null && candle.close <= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.close;
            }
          } else {
            if (tpPrice !== null && candle.close <= tpPrice) {
              tpTriggered = true;
              baseTpExitPrice = candle.close;
            } else if (currentStopPrice !== null && candle.close >= currentStopPrice) {
              stopTriggered = true;
              baseStopExitPrice = candle.close;
            }
          }
        }

        if (stopTriggered) {
          const isProfitableOrBe =
            pos.side === 'long' ? baseStopExitPrice >= pos.entryPrice : baseStopExitPrice <= pos.entryPrice;
          const posTrailingStop = getTrailingStopForSide(pos.side);
          const exitReason: ExitReason =
            posTrailingStop && (pos.ratchetSteps >= 1 || isProfitableOrBe) ? 'trailingStop' : 'stopLoss';

          const finalExitPrice = roundTo(
            pos.side === 'long'
              ? baseStopExitPrice * (1 - slippagePercent / 100)
              : baseStopExitPrice * (1 + slippagePercent / 100),
            8
          );

          if (pos.side === 'long') {
            if (candle.open <= currentStopPrice!) {
              pos.highestHigh = Math.max(pos.highestHigh, candle.open);
              pos.lowestLow = Math.min(pos.lowestLow, candle.low);
            } else {
              pos.highestHigh = Math.max(pos.highestHigh, candle.high);
              pos.lowestLow = Math.min(pos.lowestLow, candle.low);
            }
          } else {
            if (candle.open >= currentStopPrice!) {
              pos.lowestLow = Math.min(pos.lowestLow, candle.open);
              pos.highestHigh = Math.max(pos.highestHigh, candle.high);
            } else {
              pos.lowestLow = Math.min(pos.lowestLow, candle.low);
              pos.highestHigh = Math.max(pos.highestHigh, candle.high);
            }
          }

          const mfe =
            pos.side === 'long'
              ? ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
              : ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100;
          const mae =
            pos.side === 'long'
              ? ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100
              : ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100;

          const grossExitValue = pos.quantity * baseStopExitPrice;
          const exitFee = grossExitValue * feeRate;
          const totalFee = pos.entryFee + exitFee;

          let pnl: number;
          let netExitValue: number;
          if (pos.side === 'long') {
            netExitValue = grossExitValue - exitFee;
            pnl = netExitValue - pos.entryCost;
          } else {
            pnl = pos.quantity * (pos.entryPrice - baseStopExitPrice) - exitFee - pos.entryFee;
            netExitValue = pos.entryCost + pnl;
          }
          const pnlPercent = (pnl / pos.entryCost) * 100;
          cash += netExitValue;

          const exitSignal: TradeSignal = {
            action: pos.side === 'long' ? 'SELL' : 'BUY',
            timestamp: candle.timestamp,
            price: finalExitPrice,
            reason:
              exitReason === 'trailingStop'
                ? `Trailing stop triggered at ${finalExitPrice.toFixed(2)} (step ${pos.ratchetSteps})`
                : `Stop loss triggered at ${finalExitPrice.toFixed(2)}`,
          };

          completedTrades.push({
            side: pos.side,
            exitReason,
            entrySignal: pos.entrySignal,
            exitSignal,
            entryPrice: pos.entryPrice,
            exitPrice: finalExitPrice,
            quantity: pos.quantity,
            pnl: roundTo(pnl, 8),
            pnlPercent: roundTo(pnlPercent, 4),
            fee: roundTo(totalFee, 8),
            entryTime: pos.entryTime,
            exitTime: candle.timestamp,
            duration: Math.max(0, candle.timestamp - pos.entryTime),
            maxFavorablePercent: roundTo(mfe, 2),
            maxAdversePercent: roundTo(mae, 2),
            stopPrice: currentStopPrice !== null ? roundTo(currentStopPrice, 4) : undefined,
            initialStopPrice: pos.initialStopPrice !== null && pos.initialStopPrice !== undefined ? roundTo(pos.initialStopPrice, 4) : undefined,
            initialStopPercent: pos.initialStopPercent,
            stopHistory: pos.stopHistory.length > 0 ? [...pos.stopHistory] : undefined,
            ratchetSteps: pos.ratchetSteps,
            entryDiagnostics: pos.entryDiagnostics,
            positionId: pos.positionId,
            concurrentOpenAtEntry: pos.concurrentOpenAtEntry,
          });

          openPositions.splice(pIdx, 1);
        } else if (tpTriggered) {
          const exitReason: ExitReason = 'takeProfit';
          const finalExitPrice = roundTo(
            pos.side === 'long'
              ? baseTpExitPrice * (1 - slippagePercent / 100)
              : baseTpExitPrice * (1 + slippagePercent / 100),
            8
          );

          pos.highestHigh = Math.max(pos.highestHigh, candle.high);
          pos.lowestLow = Math.min(pos.lowestLow, candle.low);

          const mfe =
            pos.side === 'long'
              ? ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
              : ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100;
          const mae =
            pos.side === 'long'
              ? ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100
              : ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100;

          const grossExitValue = pos.quantity * baseTpExitPrice;
          const exitFee = grossExitValue * feeRate;
          const totalFee = pos.entryFee + exitFee;

          let pnl: number;
          let netExitValue: number;
          if (pos.side === 'long') {
            netExitValue = grossExitValue - exitFee;
            pnl = netExitValue - pos.entryCost;
          } else {
            pnl = pos.quantity * (pos.entryPrice - baseTpExitPrice) - exitFee - pos.entryFee;
            netExitValue = pos.entryCost + pnl;
          }
          const pnlPercent = (pnl / pos.entryCost) * 100;
          cash += netExitValue;

          const exitSignal: TradeSignal = {
            action: pos.side === 'long' ? 'SELL' : 'BUY',
            timestamp: candle.timestamp,
            price: finalExitPrice,
            reason: `Take profit triggered at ${finalExitPrice.toFixed(2)} (+${takeProfitPercent}%)`,
          };

          completedTrades.push({
            side: pos.side,
            exitReason,
            entrySignal: pos.entrySignal,
            exitSignal,
            entryPrice: pos.entryPrice,
            exitPrice: finalExitPrice,
            quantity: pos.quantity,
            pnl: roundTo(pnl, 8),
            pnlPercent: roundTo(pnlPercent, 4),
            fee: roundTo(totalFee, 8),
            entryTime: pos.entryTime,
            exitTime: candle.timestamp,
            duration: Math.max(0, candle.timestamp - pos.entryTime),
            maxFavorablePercent: roundTo(mfe, 2),
            maxAdversePercent: roundTo(mae, 2),
            stopPrice: currentStopPrice !== null ? roundTo(currentStopPrice, 4) : undefined,
            initialStopPrice: pos.initialStopPrice !== null && pos.initialStopPrice !== undefined ? roundTo(pos.initialStopPrice, 4) : undefined,
            initialStopPercent: pos.initialStopPercent,
            stopHistory: pos.stopHistory.length > 0 ? [...pos.stopHistory] : undefined,
            ratchetSteps: pos.ratchetSteps,
            entryDiagnostics: pos.entryDiagnostics,
            positionId: pos.positionId,
            concurrentOpenAtEntry: pos.concurrentOpenAtEntry,
          });

          openPositions.splice(pIdx, 1);
        }
      }

      // 2. Update favorable extremes and trailing stop for remaining open positions
      for (const pos of openPositions) {
        pos.highestHigh = Math.max(pos.highestHigh, candle.high);
        pos.lowestLow = Math.min(pos.lowestLow, candle.low);

        const posTrailingStop = getTrailingStopForSide(pos.side);
        if (posTrailingStop) {
          const tradeInitialStop = pos.initialStopPercent ?? posTrailingStop.initialStopPercent;
          const trailingMode = posTrailingStop.mode ?? 'stepped';

          if (pos.side === 'long') {
            const mfePercent = ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100;
            if (mfePercent >= tradeInitialStop) {
              const candidateBe = pos.entryPrice;
              if (pos.stopPrice === null || candidateBe > pos.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: pos.positionId,
                  side: 'long',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: pos.stopPrice,
                  candidateStopPrice: candidateBe,
                  acceptedStopPrice: candidateBe,
                  reason: 'breakEven',
                  trailingMode,
                  ratchetSteps: pos.ratchetSteps,
                  accepted: true,
                };
                pos.stopHistory.push(evt);
                allStopUpdates.push(evt);
                pos.stopPrice = candidateBe;
              }
            }

            const stepPercent = pos.trailingStepPercent ?? posTrailingStop.stepPercent;
            const raisePercent = pos.trailingRaisePercent ?? posTrailingStop.raisePercent;
            const n = Math.floor(mfePercent / stepPercent);
            if (n > 0) {
              if (n > pos.ratchetSteps) {
                pos.ratchetSteps = n;
              }

              let candidateStop: number;
              let reason: StopUpdateReason;

              if (trailingMode === 'trend') {
                const minLockedProfitPercent = n * raisePercent;
                const trailDistance = raisePercent;
                const minLockedPrice = roundTo(pos.entryPrice * (1 + minLockedProfitPercent / 100), 8);
                const peakTrailPrice = roundTo(pos.highestHigh * (1 - trailDistance / 100), 8);
                candidateStop = Math.max(minLockedPrice, peakTrailPrice);
                reason = 'trendTrail';
              } else {
                const candidateStopPercent = -tradeInitialStop + n * raisePercent;
                candidateStop = roundTo(pos.entryPrice * (1 + candidateStopPercent / 100), 8);
                reason = 'steppedRatchet';
              }

              if (pos.stopPrice === null || candidateStop > pos.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: pos.positionId,
                  side: 'long',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: pos.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: candidateStop,
                  reason,
                  trailingMode,
                  ratchetSteps: pos.ratchetSteps,
                  accepted: true,
                };
                pos.stopHistory.push(evt);
                allStopUpdates.push(evt);
                pos.stopPrice = candidateStop;
              } else if (candidateStop < pos.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: pos.positionId,
                  side: 'long',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: pos.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: pos.stopPrice,
                  reason,
                  trailingMode,
                  ratchetSteps: pos.ratchetSteps,
                  accepted: false,
                };
                pos.stopHistory.push(evt);
                allStopUpdates.push(evt);
              }
            }
          } else {
            // short
            const mfePercent = ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100;
            if (mfePercent >= tradeInitialStop) {
              const candidateBe = pos.entryPrice;
              if (pos.stopPrice === null || candidateBe < pos.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: pos.positionId,
                  side: 'short',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: pos.stopPrice,
                  candidateStopPrice: candidateBe,
                  acceptedStopPrice: candidateBe,
                  reason: 'breakEven',
                  trailingMode,
                  ratchetSteps: pos.ratchetSteps,
                  accepted: true,
                };
                pos.stopHistory.push(evt);
                allStopUpdates.push(evt);
                pos.stopPrice = candidateBe;
              }
            }

            const stepPercent = pos.trailingStepPercent ?? posTrailingStop.stepPercent;
            const raisePercent = pos.trailingRaisePercent ?? posTrailingStop.raisePercent;
            const n = Math.floor(mfePercent / stepPercent);
            if (n > 0) {
              if (n > pos.ratchetSteps) {
                pos.ratchetSteps = n;
              }

              let candidateStop: number;
              let reason: StopUpdateReason;

              if (trailingMode === 'trend') {
                const minLockedProfitPercent = n * raisePercent;
                const trailDistance = raisePercent;
                const minLockedPrice = roundTo(pos.entryPrice * (1 - minLockedProfitPercent / 100), 8);
                const peakTrailPrice = roundTo(pos.lowestLow * (1 + trailDistance / 100), 8);
                candidateStop = Math.min(minLockedPrice, peakTrailPrice);
                reason = 'trendTrail';
              } else {
                const candidateStopPercent = -tradeInitialStop + n * raisePercent;
                candidateStop = roundTo(pos.entryPrice * (1 - candidateStopPercent / 100), 8);
                reason = 'steppedRatchet';
              }

              if (pos.stopPrice === null || candidateStop < pos.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: pos.positionId,
                  side: 'short',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: pos.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: candidateStop,
                  reason,
                  trailingMode,
                  ratchetSteps: pos.ratchetSteps,
                  accepted: true,
                };
                pos.stopHistory.push(evt);
                allStopUpdates.push(evt);
                pos.stopPrice = candidateStop;
              } else if (candidateStop > pos.stopPrice) {
                const evt: StopUpdateEvent = {
                  tradeId: pos.positionId,
                  side: 'short',
                  timestamp: candle.timestamp,
                  candleIndex: i,
                  stopPriceBefore: pos.stopPrice,
                  candidateStopPrice: candidateStop,
                  acceptedStopPrice: pos.stopPrice,
                  reason,
                  trailingMode,
                  ratchetSteps: pos.ratchetSteps,
                  accepted: false,
                };
                pos.stopHistory.push(evt);
                allStopUpdates.push(evt);
              }
            }
          }
        }
      }

      // 2b. Time stop (maxBarsInTrade)
      if (maxBarsInTrade !== undefined) {
        for (let pIdx = openPositions.length - 1; pIdx >= 0; pIdx--) {
          const pos = openPositions[pIdx];
          const barsHeld = i - pos.entryIndex;
          if (barsHeld >= maxBarsInTrade) {
            const mfe =
              pos.side === 'long'
                ? ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
                : ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100;
            const mae =
              pos.side === 'long'
                ? ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100
                : ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100;

            const grossExitValue = pos.quantity * candle.close;
            const exitFee = grossExitValue * feeRate;
            const totalFee = pos.entryFee + exitFee;
            let pnl: number;
            let netExitValue: number;
            if (pos.side === 'long') {
              netExitValue = grossExitValue - exitFee;
              pnl = netExitValue - pos.entryCost;
            } else {
              pnl = pos.quantity * (pos.entryPrice - candle.close) - exitFee - pos.entryFee;
              netExitValue = pos.entryCost + pnl;
            }
            cash += netExitValue;

            completedTrades.push({
              side: pos.side,
              exitReason: 'timeStop',
              entrySignal: pos.entrySignal,
              exitSignal: {
                action: pos.side === 'long' ? 'SELL' : 'BUY',
                timestamp: candle.timestamp,
                price: candle.close,
                reason: `Time stop reached (${barsHeld} bars in trade >= max ${maxBarsInTrade})`,
              },
              entryPrice: pos.entryPrice,
              exitPrice: candle.close,
              quantity: pos.quantity,
              pnl: roundTo(pnl, 8),
              pnlPercent: roundTo((pnl / pos.entryCost) * 100, 4),
              fee: roundTo(totalFee, 8),
              entryTime: pos.entryTime,
              exitTime: candle.timestamp,
              duration: Math.max(0, candle.timestamp - pos.entryTime),
              maxFavorablePercent: roundTo(mfe, 2),
              maxAdversePercent: roundTo(mae, 2),
              stopPrice: pos.stopPrice !== null ? roundTo(pos.stopPrice, 4) : undefined,
              initialStopPrice: pos.initialStopPrice !== null && pos.initialStopPrice !== undefined ? roundTo(pos.initialStopPrice, 4) : undefined,
              initialStopPercent: pos.initialStopPercent,
              stopHistory: pos.stopHistory.length > 0 ? [...pos.stopHistory] : undefined,
              ratchetSteps: pos.ratchetSteps,
              entryDiagnostics: pos.entryDiagnostics,
              positionId: pos.positionId,
              concurrentOpenAtEntry: pos.concurrentOpenAtEntry,
            });
            openPositions.splice(pIdx, 1);
          }
        }
      }

      // 2c. Forced regime flip exit (G4)
      if (regimeExit && typeof getMacroRegime === 'function') {
        const currentRegime = getMacroRegime(candles, i);
        for (let pIdx = openPositions.length - 1; pIdx >= 0; pIdx--) {
          const pos = openPositions[pIdx];
          const shouldExit =
            (pos.side === 'long' && currentRegime === 'Bear') ||
            (pos.side === 'short' && currentRegime === 'Bull');

          if (shouldExit) {
            const mfe =
              pos.side === 'long'
                ? ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
                : ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100;
            const mae =
              pos.side === 'long'
                ? ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100
                : ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100;

            const grossExitValue = pos.quantity * candle.close;
            const exitFee = grossExitValue * feeRate;
            const totalFee = pos.entryFee + exitFee;
            let pnl: number;
            let netExitValue: number;
            if (pos.side === 'long') {
              netExitValue = grossExitValue - exitFee;
              pnl = netExitValue - pos.entryCost;
            } else {
              pnl = pos.quantity * (pos.entryPrice - candle.close) - exitFee - pos.entryFee;
              netExitValue = pos.entryCost + pnl;
            }
            cash += netExitValue;

            completedTrades.push({
              side: pos.side,
              exitReason: 'regimeFlip',
              entrySignal: pos.entrySignal,
              exitSignal: {
                action: pos.side === 'long' ? 'SELL' : 'BUY',
                timestamp: candle.timestamp,
                price: candle.close,
                reason: `Forced exit: macro regime flipped to ${currentRegime}`,
              },
              entryPrice: pos.entryPrice,
              exitPrice: candle.close,
              quantity: pos.quantity,
              pnl: roundTo(pnl, 8),
              pnlPercent: roundTo((pnl / pos.entryCost) * 100, 4),
              fee: roundTo(totalFee, 8),
              entryTime: pos.entryTime,
              exitTime: candle.timestamp,
              duration: Math.max(0, candle.timestamp - pos.entryTime),
              maxFavorablePercent: roundTo(mfe, 2),
              maxAdversePercent: roundTo(mae, 2),
              stopPrice: pos.stopPrice !== null ? roundTo(pos.stopPrice, 4) : undefined,
              initialStopPrice:
                pos.initialStopPrice !== null && pos.initialStopPrice !== undefined
                  ? roundTo(pos.initialStopPrice, 4)
                  : undefined,
              initialStopPercent: pos.initialStopPercent,
              stopHistory: pos.stopHistory.length > 0 ? [...pos.stopHistory] : undefined,
              ratchetSteps: pos.ratchetSteps,
              entryDiagnostics: pos.entryDiagnostics,
              positionId: pos.positionId,
              concurrentOpenAtEntry: pos.concurrentOpenAtEntry,
            });
            openPositions.splice(pIdx, 1);
          }
        }
      }

      // 3. Process strategy signal at candle close
      const signal = strategy.analyze(candles, i);
      const entryDiag = (signal.metadata as { entryDiagnostics?: EntryDiagnostics } | undefined)?.entryDiagnostics;
      const signalStopPercent =
        typeof signal.metadata?.initialStopPercent === 'number'
          ? (signal.metadata.initialStopPercent as number)
          : undefined;

      const currentEquity = computeEquity(candle.close);

      const hasLong = openPositions.some((p) => p.side === 'long');
      const hasShort = openPositions.some((p) => p.side === 'short');

      if (signal.action === 'BUY') {
        funnel.long.entryAttempted++;
      } else if (signal.action === 'SELL') {
        funnel.short.entryAttempted++;
      }

      let canOpenDirection: TradeSide | null = null;
      if (tradeMode === 'long-only') {
        if (signal.action === 'SELL') {
          recordFunnelRejection(funnel, 'short', 'longOnlyShortIgnored');
          if (collectTrace) {
            trace.ignoredSignals.push({
              index: i,
              timestamp: candle.timestamp,
              signal,
              reason: 'longOnlyShortIgnored',
            });
          }
        } else if (signal.action === 'BUY') {
          canOpenDirection = 'long';
        }
      } else if (tradeMode === 'short-only') {
        if (signal.action === 'BUY') {
          recordFunnelRejection(funnel, 'long', 'shortOnlyLongIgnored');
          if (collectTrace) {
            trace.ignoredSignals.push({
              index: i,
              timestamp: candle.timestamp,
              signal,
              reason: 'shortOnlyLongIgnored',
            });
          }
        } else if (signal.action === 'SELL') {
          canOpenDirection = 'short';
        }
      } else {
        // long-short:
        if (allowOppositePositions) {
          // Both long and short can be open simultaneously; new signals never close existing positions.
          if (signal.action === 'BUY') {
            canOpenDirection = 'long';
          } else if (signal.action === 'SELL') {
            canOpenDirection = 'short';
          }
        } else {
          // allowOppositePositions === false: legacy behavior for comparison
          if (signal.action === 'BUY') {
            if (hasShort) {
              rejectedOppositeWhileOpen++;
              recordFunnelRejection(funnel, 'long', 'opposite_while_open');
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'opposite_while_open',
                });
              }
            } else {
              canOpenDirection = 'long';
            }
          } else if (signal.action === 'SELL') {
            if (hasLong) {
              rejectedOppositeWhileOpen++;
              recordFunnelRejection(funnel, 'short', 'opposite_while_open');
              if (collectTrace) {
                trace.ignoredSignals.push({
                  index: i,
                  timestamp: candle.timestamp,
                  signal,
                  reason: 'opposite_while_open',
                });
              }
            } else {
              canOpenDirection = 'short';
            }
          }
        }
      }

      if (canOpenDirection !== null) {
        // Check eligibility rules (Rule پ)
        if (openPositions.length >= maxOpenPositions) {
          rejectedCapPositions++;
          recordFunnelRejection(funnel, canOpenDirection, 'cap_positions');
          if (collectTrace) {
            trace.ignoredSignals.push({
              index: i,
              timestamp: candle.timestamp,
              signal,
              reason: 'cap_positions',
            });
          }
        } else if (openPositions.length > 0 && i - lastEntryIndex < minBarsBetweenEntries) {
          rejectedMinBars++;
          recordFunnelRejection(funnel, canOpenDirection, 'min_bars');
          if (collectTrace) {
            trace.ignoredSignals.push({
              index: i,
              timestamp: candle.timestamp,
              signal,
              reason: 'min_bars',
            });
          }
        } else {
          const effectiveSize = computeEffectiveSizePercent(signalStopPercent);
          const allocatedAmount = currentEquity * (effectiveSize / 100);
          const currentTotalNotional = openPositions.reduce((sum, p) => sum + p.quantity * candle.close, 0);
          const newTotalNotional = currentTotalNotional + allocatedAmount;
          const maxAllowedNotional = currentEquity * (maxTotalExposurePercent / 100);

          if (newTotalNotional > maxAllowedNotional + 1e-4 || allocatedAmount > cash) {
            rejectedCapExposure++;
            recordFunnelRejection(funnel, canOpenDirection, 'cap_exposure');
            if (collectTrace) {
              trace.ignoredSignals.push({
                index: i,
                timestamp: candle.timestamp,
                signal,
                reason: 'cap_exposure',
              });
            }
          } else {
            // Open new position!
            funnel[canOpenDirection].executed++;
            const entryFee = allocatedAmount * feeRate;
            const netInvest = allocatedAmount - entryFee;
            const quantity = netInvest / candle.close;
            cash -= allocatedAmount;

            const entryTrailingStop = getTrailingStopForSide(canOpenDirection);
            let effectiveStopPercent = entryTrailingStop ? entryTrailingStop.initialStopPercent : stopLossPercent;
            const signalMeta = signal.metadata as Record<string, unknown> | undefined;
            const isDynamic = signalMeta?.useTdrStop === true || signalMeta?.useAtrTrailing === true;

            if (
              isDynamic &&
              signalMeta?.initialStopPercent !== undefined &&
              typeof signalMeta.initialStopPercent === 'number' &&
              signalMeta.initialStopPercent > 0
            ) {
              effectiveStopPercent = signalMeta.initialStopPercent;
            }

            let initialStop: number | null = null;
            if (
              isDynamic &&
              signalMeta?.stopPrice !== undefined &&
              typeof signalMeta.stopPrice === 'number' &&
              signalMeta.stopPrice > 0
            ) {
              initialStop = signalMeta.stopPrice;
            } else if (effectiveStopPercent !== undefined && effectiveStopPercent > 0) {
              initialStop =
                canOpenDirection === 'long'
                  ? roundTo(candle.close * (1 - effectiveStopPercent / 100), 8)
                  : roundTo(candle.close * (1 + effectiveStopPercent / 100), 8);
            }

            const posId = nextPositionId++;
            const posStopHistory: StopUpdateEvent[] = [];
            const trailingMode = entryTrailingStop?.mode ?? 'stepped';

            if (initialStop !== null) {
              const initEvt: StopUpdateEvent = {
                tradeId: posId,
                side: canOpenDirection,
                timestamp: candle.timestamp,
                candleIndex: i,
                stopPriceBefore: null,
                candidateStopPrice: initialStop,
                acceptedStopPrice: initialStop,
                reason: isDynamic ? 'dynamicStop' : 'initialStop',
                trailingMode: entryTrailingStop ? trailingMode : undefined,
                ratchetSteps: 0,
                accepted: true,
              };
              posStopHistory.push(initEvt);
              allStopUpdates.push(initEvt);
            }

            const trailingStepPercent =
              typeof signalMeta?.trailingStepPercent === 'number'
                ? signalMeta.trailingStepPercent
                : undefined;
            const trailingRaisePercent =
              typeof signalMeta?.trailingRaisePercent === 'number'
                ? signalMeta.trailingRaisePercent
                : undefined;

            const newPos: ActivePositionState = {
              positionId: posId,
              side: canOpenDirection,
              quantity,
              entryPrice: candle.close,
              entrySignal: signal,
              entryCost: allocatedAmount,
              entryFee,
              entryTime: candle.timestamp,
              entryIndex: i,
              concurrentOpenAtEntry: openPositions.length + 1,
              initialStopPercent: effectiveStopPercent,
              initialStopPrice: initialStop,
              stopPrice: initialStop,
              highestHigh: candle.close,
              lowestLow: candle.close,
              ratchetSteps: 0,
              trailingStepPercent,
              trailingRaisePercent,
              entryDiagnostics: entryDiag,
              stopHistory: posStopHistory,
            };

            openPositions.push(newPos);
            lastEntryIndex = i;
          }
        }
      }

      // 4. Record candle metrics
      const countLong = openPositions.filter((p) => p.side === 'long').length;
      const countShort = openPositions.filter((p) => p.side === 'short').length;
      const openCount = openPositions.length;
      openCountSamples.push(openCount);
      if (openCount === maxOpenPositions) {
        capacityCandles++;
      }
      if (countLong > maxConcurrentLong) maxConcurrentLong = countLong;
      if (countShort > maxConcurrentShort) maxConcurrentShort = countShort;
      if (openCount > maxConcurrentTotal) maxConcurrentTotal = openCount;
      if (countLong > 0 && countShort > 0) {
        dualDirectionCandles++;
      }
      equityCurve.push(computeEquity(candle.close));
    }

    // 5. Close remaining open positions at backtest conclusion
    if (openPositions.length > 0) {
      const finalCandle = candles[candles.length - 1];
      for (const pos of openPositions) {
        const mfe =
          pos.side === 'long'
            ? ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100
            : ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100;
        const mae =
          pos.side === 'long'
            ? ((pos.entryPrice - pos.lowestLow) / pos.entryPrice) * 100
            : ((pos.highestHigh - pos.entryPrice) / pos.entryPrice) * 100;

        const grossExitValue = pos.quantity * finalCandle.close;
        const exitFee = grossExitValue * feeRate;
        const totalFee = pos.entryFee + exitFee;
        let pnl: number;
        let netExitValue: number;
        if (pos.side === 'long') {
          netExitValue = grossExitValue - exitFee;
          pnl = netExitValue - pos.entryCost;
        } else {
          pnl = pos.quantity * (pos.entryPrice - finalCandle.close) - exitFee - pos.entryFee;
          netExitValue = pos.entryCost + pnl;
        }
        cash += netExitValue;

        completedTrades.push({
          side: pos.side,
          exitReason: 'end',
          entrySignal: pos.entrySignal,
          exitSignal: {
            action: pos.side === 'long' ? 'SELL' : 'BUY',
            timestamp: finalCandle.timestamp,
            price: finalCandle.close,
            reason: 'Backtest conclusion: closed remaining open position',
          },
          entryPrice: pos.entryPrice,
          exitPrice: finalCandle.close,
          quantity: pos.quantity,
          pnl: roundTo(pnl, 8),
          pnlPercent: roundTo((pnl / pos.entryCost) * 100, 4),
          fee: roundTo(totalFee, 8),
          entryTime: pos.entryTime,
          exitTime: finalCandle.timestamp,
          duration: Math.max(0, finalCandle.timestamp - pos.entryTime),
          maxFavorablePercent: roundTo(mfe, 2),
          maxAdversePercent: roundTo(mae, 2),
          stopPrice: pos.stopPrice !== null ? roundTo(pos.stopPrice, 4) : undefined,
          initialStopPrice: pos.initialStopPrice !== null && pos.initialStopPrice !== undefined ? roundTo(pos.initialStopPrice, 4) : undefined,
          initialStopPercent: pos.initialStopPercent,
          stopHistory: pos.stopHistory.length > 0 ? [...pos.stopHistory] : undefined,
          ratchetSteps: pos.ratchetSteps,
          entryDiagnostics: pos.entryDiagnostics,
          positionId: pos.positionId,
          concurrentOpenAtEntry: pos.concurrentOpenAtEntry,
        });
      }
      openPositions.length = 0;
      equityCurve[equityCurve.length - 1] = cash;
    }

    const traceable = strategy as unknown as TraceableStrategy;
    if (typeof traceable.setTraceCollector === 'function') {
      traceable.setTraceCollector(undefined);
    }

    verifyFunnelReconciliation(funnel, completedTrades);
    trace.signalFunnel = funnel;

    const metrics = calculateMetrics(completedTrades, initialBalance, equityCurve);

    let sumOpenCount = 0;
    for (let k = 0; k < openCountSamples.length; k++) {
      const cnt = openCountSamples[k];
      sumOpenCount += cnt;
    }
    const avgConcurrentPositions = openCountSamples.length > 0
      ? roundTo(sumOpenCount / openCountSamples.length, 2)
      : 0;
    const percentTimeAtCapacity = openCountSamples.length > 0
      ? roundTo((capacityCandles / openCountSamples.length) * 100, 2)
      : 0;
    const dualDirectionTimePercent = openCountSamples.length > 0
      ? roundTo((dualDirectionCandles / openCountSamples.length) * 100, 2)
      : 0;

    const multiPositionDiagnostics: MultiPositionDiagnostics = {
      avgConcurrentPositions,
      maxConcurrentPositions: maxConcurrentTotal,
      maxConcurrentTotal,
      maxConcurrentLong,
      maxConcurrentShort,
      dualDirectionTimePercent,
      percentTimeAtCapacity,
      rejectedSignals: {
        cap_positions: rejectedCapPositions,
        cap_exposure: rejectedCapExposure,
        max_positions: rejectedCapPositions,
        max_exposure: rejectedCapExposure,
        min_bars: rejectedMinBars,
        opposite_while_open: rejectedOppositeWhileOpen,
      },
    };

    const configSummary: Omit<BacktestConfig, 'candles'> = {
      strategy: config.strategy,
      initialBalance: config.initialBalance,
      tradeFeePercent,
      positionSizePercent,
      riskPerTradePercent,
      tradeMode,
      exitMode,
      maxBarsInTrade,
      takeProfitPercent,
      stopLossPercent,
      trailingStop,
      trailingStopShort,
      maxOpenPositions,
      maxTotalExposurePercent,
      minBarsBetweenEntries,
      allowOppositePositions,
      slippagePercent,
      stopCheckMode,
      collectTrace: config.collectTrace,
    };

    return {
      config: configSummary,
      trades: completedTrades,
      metrics,
      equity: equityCurve,
      activePosition: null,
      trace: collectTrace ? trace : undefined,
      signalFunnel: funnel,
      multiPositionDiagnostics,
      stopUpdates: allStopUpdates,
    };
  }
}

