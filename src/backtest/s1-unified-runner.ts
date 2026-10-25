import type { Candle } from '../data/models';
import type { TradeMode, BacktestConfig, BacktestResult } from './types';
import { MultiTimeframeStrategy, type FisherMode, type FisherKind, type FisherGate } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from './engine';
import {
  DEFAULT_FISHER_MODE,
  DEFAULT_FISHER_KIND,
  DEFAULT_FISHER_GATE,
  DEFAULT_ALLOW_OPPOSITE_POSITIONS,
} from '../config/defaults';

export interface S1StandardRunnerOptions {
  candles: readonly Candle[];
  htf1hCandles?: readonly Candle[];
  htf4hCandles?: readonly Candle[];
  tradeMode: TradeMode; // 'long-only' for S1L (S2), 'long-short' for S1LS (S1)
  engine?: BacktestEngine;
  initialBalance?: number;
  positionSizePercent?: number;
  maxOpenPositions?: number;
  maxTotalExposurePercent?: number;
  tradeFeePercent?: number;
  fisherMode?: FisherMode;
  fisherKind?: FisherKind;
  fisherGate?: FisherGate;
}

export interface S1StandardConfig {
  initialBalance: number;
  positionSizePercent: number;
  maxOpenPositions: number;
  maxTotalExposurePercent: number;
  minBarsBetweenEntries: number;
  allowOppositePositions: boolean;
  tradeFeePercent: number;
  tradeMode: TradeMode;
  exitMode: 'trailingOnly';
  trailingStop: {
    initialStopPercent: number;
    stepPercent: number;
    raisePercent: number;
    mode: 'stepped';
  };
}

export function getS1StandardConfig(options: {
  tradeMode: TradeMode;
  initialBalance?: number;
  positionSizePercent?: number;
  maxOpenPositions?: number;
  maxTotalExposurePercent?: number;
  tradeFeePercent?: number;
}): S1StandardConfig {
  return {
    initialBalance: options.initialBalance ?? 10000,
    positionSizePercent: options.positionSizePercent ?? 3,
    maxOpenPositions: options.maxOpenPositions ?? 10,
    maxTotalExposurePercent: options.maxTotalExposurePercent ?? 30,
    minBarsBetweenEntries: 0,
    allowOppositePositions: DEFAULT_ALLOW_OPPOSITE_POSITIONS,
    tradeFeePercent: options.tradeFeePercent ?? 0.1,
    tradeMode: options.tradeMode,
    exitMode: 'trailingOnly',
    trailingStop: {
      initialStopPercent: 5,
      stepPercent: 3,
      raisePercent: 1.5,
      mode: 'stepped',
    },
  };
}

export function createS1StandardStrategy(options: {
  htf1hCandles?: readonly Candle[];
  htf4hCandles?: readonly Candle[];
  fisherMode?: FisherMode;
  fisherKind?: FisherKind;
  fisherGate?: FisherGate;
}): MultiTimeframeStrategy {
  return new MultiTimeframeStrategy({
    htfMode: 'strict',
    entryMode: 'cross',
    fisherMode: options.fisherMode ?? DEFAULT_FISHER_MODE,
    fisherKind: options.fisherKind ?? DEFAULT_FISHER_KIND,
    fisherGate: options.fisherGate ?? DEFAULT_FISHER_GATE,
    htf1hCandles: options.htf1hCandles,
    htf4hCandles: options.htf4hCandles,
    kijunSlopeFilter: true,
    structureFilter: true,
  });
}

export function runS1StandardBacktest(options: S1StandardRunnerOptions): BacktestResult {
  const engine = options.engine ?? new BacktestEngine();
  const strategy = createS1StandardStrategy({
    htf1hCandles: options.htf1hCandles,
    htf4hCandles: options.htf4hCandles,
    fisherMode: options.fisherMode,
    fisherKind: options.fisherKind,
    fisherGate: options.fisherGate,
  });

  const config: BacktestConfig = {
    ...getS1StandardConfig({
      tradeMode: options.tradeMode,
      initialBalance: options.initialBalance,
      positionSizePercent: options.positionSizePercent,
      maxOpenPositions: options.maxOpenPositions,
      maxTotalExposurePercent: options.maxTotalExposurePercent,
      tradeFeePercent: options.tradeFeePercent,
    }),
    candles: options.candles,
    strategy,
  };

  return engine.run(config);
}
