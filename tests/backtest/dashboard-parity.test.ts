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
});
