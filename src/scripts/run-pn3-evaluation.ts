import type { MultiTimeframeConfig, MultiTimeframeStrategyConfig } from '../strategies/multi-timeframe-strategy';
import type { TrailingStopConfig } from '../backtest/types';

export interface PnFullConfig {
  htfMode: 'strict';
  entryMode: 'cross';
  kijunSlopeFilter: boolean;
  structureFilter: boolean;
  stochKPeriod: number;
  stochDPeriod: number;
  stochSmooth: number;
  stochOversold: number;
  stochOverbought: number;
  fisherMode: 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm';
  fisherKind: 'fisher' | 'ift';
  fisherGate: 'none' | 'zone';
  tradeMode: 'long-short' | 'long-only' | 'short-only';
  trailingStop: TrailingStopConfig;
  positionSizePercent: number;
  maxOpenPositions: number;
  maxTotalExposurePercent: number;
  allowOppositePositions: boolean;
  tradeFeePercent: number;
  slippagePercent: number;
}

export const C1_CONFIG: PnFullConfig = {
  htfMode: 'strict',
  entryMode: 'cross',
  kijunSlopeFilter: true,
  structureFilter: true,
  stochKPeriod: 14,
  stochDPeriod: 3,
  stochSmooth: 3,
  stochOversold: 30,
  stochOverbought: 70,
  fisherMode: 'extra-trigger',
  fisherKind: 'fisher',
  fisherGate: 'none',
  tradeMode: 'long-short',
  trailingStop: {
    initialStopPercent: 5,
    stepPercent: 3,
    raisePercent: 1.5,
    mode: 'stepped',
  },
  positionSizePercent: 3,
  maxOpenPositions: 10,
  maxTotalExposurePercent: 30,
  allowOppositePositions: true,
  tradeFeePercent: 0.1,
  slippagePercent: 0,
};

export const F3_CONFIG: PnFullConfig = {
  ...C1_CONFIG,
  fisherMode: 'confirm',
};

export const F0_CONFIG: PnFullConfig = {
  ...C1_CONFIG,
  fisherMode: 'off',
};

export const C1L_CONFIG: PnFullConfig = {
  ...C1_CONFIG,
  tradeMode: 'long-only',
};

export function extractStrategyConfig(config: PnFullConfig): MultiTimeframeStrategyConfig {
  return {
    htfMode: config.htfMode,
    entryMode: config.entryMode,
    kijunSlopeFilter: config.kijunSlopeFilter,
    structureFilter: config.structureFilter,
    stochKPeriod: config.stochKPeriod,
    stochDPeriod: config.stochDPeriod,
    stochSmooth: config.stochSmooth,
    stochOversold: config.stochOversold,
    stochOverbought: config.stochOverbought,
    fisherMode: config.fisherMode,
    fisherKind: config.fisherKind,
    fisherGate: config.fisherGate,
  };
}
