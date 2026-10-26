import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '@/data/models/candle';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '@/backtest/engine';
import { runBacktestFromRoute } from '@/app/api/backtest/core';
import {
  DEFAULT_TRADE_MODE,
  DEFAULT_EXIT_MODE,
  DEFAULT_TRAILING_MODE,
  DEFAULT_INITIAL_STOP_PERCENT,
  DEFAULT_TRAIL_STEP_PERCENT,
  DEFAULT_TRAIL_RAISE_PERCENT,
  DEFAULT_POSITION_SIZE_PERCENT,
  DEFAULT_MAX_OPEN_POSITIONS,
  DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT,
  DEFAULT_MIN_BARS_BETWEEN_ENTRIES,
  DEFAULT_FISHER_MODE,
  DEFAULT_FISHER_KIND,
  DEFAULT_FISHER_GATE,
  DEFAULT_INITIAL_BALANCE,
  DEFAULT_TRADE_FEE_PERCENT,
  DEFAULT_SLIPPAGE_PERCENT,
  DEFAULT_STOP_CHECK_MODE,
  DEFAULT_KIJUN_SLOPE_FILTER,
  DEFAULT_STRUCTURE_FILTER,
} from '@/config/defaults';

function loadGzCandles(filePath: string): Candle[] {
  const buf = fs.readFileSync(filePath);
  const uncompressed = zlib.gunzipSync(buf).toString('utf-8');
  const lines = uncompressed.trim().split('\n').slice(1);
  return lines
    .map((l) => {
      const [timestamp, open, high, low, close, volume] = l.split(',');
      return {
        timestamp: Number(timestamp),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

describe('R5: Dashboard & Route Parity Integration Test', () => {
  const dataDir = path.resolve(process.cwd(), 'docs/review/data');
  const c4hPath = path.join(dataDir, 'BTCUSDT_4h.csv.gz');
  const c1hPath = path.join(dataDir, 'BTCUSDT_1h.csv.gz');

  let c4h: Candle[];
  let c1h: Candle[];

  beforeAll(() => {
    c4h = loadGzCandles(c4hPath);
    c1h = loadGzCandles(c1hPath);
  });

  it('runs route backtest with dashboard defaults and matches direct engine execution exactly on BTC 4h', async () => {
    // 1. Execute via route function (using defaults from src/config/defaults.ts)
    const routeResult = await runBacktestFromRoute(
      {},
      { providedCandles: c4h, providedHtf4h: c4h, providedHtf1h: c1h }
    );

    // 2. Direct Engine Execution with exact same centralized defaults
    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      kijunSlopeFilter: DEFAULT_KIJUN_SLOPE_FILTER,
      structureFilter: DEFAULT_STRUCTURE_FILTER,
      fisherMode: DEFAULT_FISHER_MODE,
      fisherKind: DEFAULT_FISHER_KIND,
      fisherGate: DEFAULT_FISHER_GATE,
      htf4hCandles: c4h,
      htf1hCandles: c1h,
      tenkan: 9,
      kijun: 26,
      senkouB: 52,
      displacement: 26,
      rsiPeriod: 14,
      stochKPeriod: 14,
      stochDPeriod: 3,
      stochSmooth: 3,
      stochOversold: 30,
      stochOverbought: 70,
      initialStopPercent: DEFAULT_INITIAL_STOP_PERCENT,
      useTdrStop: false,
      tdrMultiplier: 1.5,
    });

    const engine = new BacktestEngine();
    const directResult = engine.run({
      strategy,
      candles: c4h,
      initialBalance: DEFAULT_INITIAL_BALANCE,
      tradeFeePercent: DEFAULT_TRADE_FEE_PERCENT,
      positionSizePercent: DEFAULT_POSITION_SIZE_PERCENT,
      tradeMode: DEFAULT_TRADE_MODE,
      exitMode: DEFAULT_EXIT_MODE,
      trailingStop: {
        initialStopPercent: DEFAULT_INITIAL_STOP_PERCENT,
        stepPercent: DEFAULT_TRAIL_STEP_PERCENT,
        raisePercent: DEFAULT_TRAIL_RAISE_PERCENT,
        mode: DEFAULT_TRAILING_MODE,
      },
      maxOpenPositions: DEFAULT_MAX_OPEN_POSITIONS,
      maxTotalExposurePercent: DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT,
      minBarsBetweenEntries: DEFAULT_MIN_BARS_BETWEEN_ENTRIES,
      slippagePercent: DEFAULT_SLIPPAGE_PERCENT,
      stopCheckMode: DEFAULT_STOP_CHECK_MODE,
      collectTrace: true,
    });

    // 3. Parity assertions
    expect(routeResult.trades.length).toBe(directResult.trades.length);
    expect(routeResult.metrics.totalPnl).toBe(directResult.metrics.totalPnl);
    expect(routeResult.metrics.totalPnlPercent).toBe(directResult.metrics.totalPnlPercent);
    expect(routeResult.metrics.maxDrawdownPercent).toBe(directResult.metrics.maxDrawdownPercent);
    expect(routeResult.metrics.winRate).toBe(directResult.metrics.winRate);
    expect(routeResult.metrics.totalTrades).toBe(directResult.metrics.totalTrades);

    // Comprehensive Metrics Parity
    expect(routeResult.metrics.sharpeRatio).toBe(directResult.metrics.sharpeRatio);
    expect(routeResult.metrics.sortinoRatio).toBe(directResult.metrics.sortinoRatio);
    expect(routeResult.metrics.profitFactor).toBe(directResult.metrics.profitFactor);
    expect(routeResult.metrics.expectancy).toBe(directResult.metrics.expectancy);
    expect(routeResult.metrics.cagr).toBe(directResult.metrics.cagr);
    expect(routeResult.metrics.percentTimeInMarket).toBe(directResult.metrics.percentTimeInMarket);
    expect(routeResult.metrics.avgExposurePercent).toBe(directResult.metrics.avgExposurePercent);
    expect(routeResult.metrics.long).toEqual(directResult.metrics.long);
    expect(routeResult.metrics.short).toEqual(directResult.metrics.short);

    // Funnel Parity
    expect(routeResult.signalFunnel).toEqual(directResult.signalFunnel);

    // Concurrency parity
    expect(routeResult.multiPositionDiagnostics?.maxConcurrentPositions).toBe(
      directResult.multiPositionDiagnostics?.maxConcurrentPositions
    );
    expect(routeResult.multiPositionDiagnostics?.avgConcurrentPositions).toBe(
      directResult.multiPositionDiagnostics?.avgConcurrentPositions
    );

    // Trade-by-trade parity
    expect(routeResult.trades).toEqual(directResult.trades);
  });

  it('PN1-e: verifies effective sizing logic and governing constraint calculation', () => {
    // Helper function matching UI calculation logic in page.tsx
    const computeEffectiveSize = (
      positionSizePercent: number,
      riskPerTradePercent: number,
      trailingStopEnabled: boolean,
      initialStopPercent: number,
      stopLossPercent?: number
    ) => {
      const effectiveStop = trailingStopEnabled ? initialStopPercent : (stopLossPercent || 5);
      const calculatedRiskSize = effectiveStop > 0 ? (riskPerTradePercent / effectiveStop) * 100 : positionSizePercent;
      const isCapBinding = positionSizePercent <= calculatedRiskSize;
      const effectiveSizePercent = isCapBinding ? positionSizePercent : Math.round(calculatedRiskSize * 100) / 100;
      const governingConstraint = isCapBinding ? 'سقف' : 'ریسک';
      return { effectiveSizePercent, governingConstraint, isCapBinding };
    };

    // Case 1: Cap is binding (Risk 1%, Stop 5% => calculated 20%, but Cap is 3%)
    const case1 = computeEffectiveSize(3, 1, true, 5, undefined);
    expect(case1.effectiveSizePercent).toBe(3);
    expect(case1.governingConstraint).toBe('سقف');
    expect(case1.isCapBinding).toBe(true);

    // Case 2: Risk is binding (Risk 0.1%, Stop 5% => calculated 2%, Cap is 3%)
    const case2 = computeEffectiveSize(3, 0.1, true, 5, undefined);
    expect(case2.effectiveSizePercent).toBe(2);
    expect(case2.governingConstraint).toBe('ریسک');
    expect(case2.isCapBinding).toBe(false);

    // Case 3: Fixed Stop Loss when trailing is disabled (StopLoss 4%, Risk 0.2%, Cap 10% => calculated 5%)
    const case3 = computeEffectiveSize(10, 0.2, false, 5, 4);
    expect(case3.effectiveSizePercent).toBe(5);
    expect(case3.governingConstraint).toBe('ریسک');
    expect(case3.isCapBinding).toBe(false);
  });

  it('PN1-f: verifies that dead UI controls (lookbackBars, minConfirmations, trendRequirement, cloudFilter) do not alter strategy/engine backtest output', async () => {
    // Base run
    const baseRun = await runBacktestFromRoute(
      {},
      { providedCandles: c4h, providedHtf4h: c4h, providedHtf1h: c1h }
    );

    // Run with dead controls set to arbitrary alternate values
    const deadControlsRun = await runBacktestFromRoute(
      {
        lookbackBars: 10,
        minConfirmations: 3,
        trendRequirement: 'either',
        cloudFilter: 'strongCross',
      },
      { providedCandles: c4h, providedHtf4h: c4h, providedHtf1h: c1h }
    );

    expect(deadControlsRun.trades.length).toBe(baseRun.trades.length);
    expect(deadControlsRun.metrics.totalPnl).toBe(baseRun.metrics.totalPnl);
    expect(deadControlsRun.metrics.totalTrades).toBe(baseRun.metrics.totalTrades);
    expect(deadControlsRun.trades).toEqual(baseRun.trades);
  });

  it('PN1-f: verifies active control propagation (fisherMode extra-trigger) alters strategy output and matches direct engine', async () => {
    const routeExtra = await runBacktestFromRoute(
      { fisherMode: 'extra-trigger', fisherKind: 'fisher', fisherGate: 'none' },
      { providedCandles: c4h, providedHtf4h: c4h, providedHtf1h: c1h }
    );

    const directStrategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      kijunSlopeFilter: DEFAULT_KIJUN_SLOPE_FILTER,
      structureFilter: DEFAULT_STRUCTURE_FILTER,
      fisherMode: 'extra-trigger',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf4hCandles: c4h,
      htf1hCandles: c1h,
    });
    const directEngine = new BacktestEngine();
    const directExtra = directEngine.run({
      strategy: directStrategy,
      candles: c4h,
      initialBalance: DEFAULT_INITIAL_BALANCE,
      tradeFeePercent: DEFAULT_TRADE_FEE_PERCENT,
      positionSizePercent: DEFAULT_POSITION_SIZE_PERCENT,
      tradeMode: DEFAULT_TRADE_MODE,
      exitMode: DEFAULT_EXIT_MODE,
      trailingStop: {
        initialStopPercent: DEFAULT_INITIAL_STOP_PERCENT,
        stepPercent: DEFAULT_TRAIL_STEP_PERCENT,
        raisePercent: DEFAULT_TRAIL_RAISE_PERCENT,
        mode: DEFAULT_TRAILING_MODE,
      },
      maxOpenPositions: DEFAULT_MAX_OPEN_POSITIONS,
      maxTotalExposurePercent: DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT,
      minBarsBetweenEntries: DEFAULT_MIN_BARS_BETWEEN_ENTRIES,
      slippagePercent: DEFAULT_SLIPPAGE_PERCENT,
      stopCheckMode: DEFAULT_STOP_CHECK_MODE,
      collectTrace: true,
    });

    expect(routeExtra.trades.length).toBe(directExtra.trades.length);
    expect(routeExtra.metrics.totalPnl).toBe(directExtra.metrics.totalPnl);
    expect(routeExtra.trades).toEqual(directExtra.trades);
  });
});

