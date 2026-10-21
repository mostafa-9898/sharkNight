import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '@/data/models/candle';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '@/backtest/engine';
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

describe('H3: Concurrent Opposite Positions (Real Strategy Output)', () => {
  const dataDir = path.resolve(process.cwd(), 'docs/review/data');
  const c15mPath = path.join(dataDir, 'BTCUSDT_15m.csv.gz');
  const c1hPath = path.join(dataDir, 'BTCUSDT_1h.csv.gz');
  const c4hPath = path.join(dataDir, 'BTCUSDT_4h.csv.gz');

  let c15m: Candle[];
  let c1h: Candle[];
  let c4h: Candle[];

  beforeAll(() => {
    c15m = loadGzCandles(c15mPath);
    c1h = loadGzCandles(c1hPath);
    c4h = loadGzCandles(c4hPath);
  });

  const createStrategy = () =>
    new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      kijunSlopeFilter: true,
      structureFilter: true,
      fisherMode: DEFAULT_FISHER_MODE,
      fisherKind: DEFAULT_FISHER_KIND,
      fisherGate: DEFAULT_FISHER_GATE,
      htf1hCandles: c1h,
      htf4hCandles: c4h,
    });

  const baseConfig = {
    initialBalance: DEFAULT_INITIAL_BALANCE,
    tradeFeePercent: DEFAULT_TRADE_FEE_PERCENT,
    positionSizePercent: DEFAULT_POSITION_SIZE_PERCENT,
    maxOpenPositions: DEFAULT_MAX_OPEN_POSITIONS,
    maxTotalExposurePercent: DEFAULT_MAX_TOTAL_EXPOSURE_PERCENT,
    minBarsBetweenEntries: DEFAULT_MIN_BARS_BETWEEN_ENTRIES,
    tradeMode: DEFAULT_TRADE_MODE,
    exitMode: DEFAULT_EXIT_MODE,
    trailingStop: {
      initialStopPercent: DEFAULT_INITIAL_STOP_PERCENT,
      stepPercent: DEFAULT_TRAIL_STEP_PERCENT,
      raisePercent: DEFAULT_TRAIL_RAISE_PERCENT,
      mode: DEFAULT_TRAILING_MODE,
    },
    collectTrace: true,
  };

  it('T-a: when long is open and short signal arrives (allowOppositePositions=true), long is NOT closed and short is opened concurrently', () => {
    const engine = new BacktestEngine();
    const result = engine.run({
      ...baseConfig,
      strategy: createStrategy(),
      candles: c15m,
      allowOppositePositions: true,
    });

    const trades = result.trades;
    // Find overlapping trades in opposite directions: one trade entered before another, and stayed open while second entered
    const overlappingOpposites = trades.filter((t1) => {
      return trades.some((t2) => {
        if (t1.side === t2.side) return false;
        // t2 entered while t1 was open
        return (
          t1.entryTime! < t2.entryTime! &&
          t2.entryTime! < t1.exitTime!
        );
      });
    });

    expect(overlappingOpposites.length).toBeGreaterThan(0);

    // Verify dual direction time and concurrency
    expect(result.multiPositionDiagnostics?.dualDirectionTimePercent).toBeGreaterThan(0);
    expect(result.multiPositionDiagnostics?.maxConcurrentLong).toBeGreaterThanOrEqual(1);
    expect(result.multiPositionDiagnostics?.maxConcurrentShort).toBeGreaterThanOrEqual(1);
  });

  it('T-b: with allowOppositePositions=false, opposite signal does NOT open, existing position is NOT closed, and rejection is recorded', () => {
    const engine = new BacktestEngine();
    const result = engine.run({
      ...baseConfig,
      strategy: createStrategy(),
      candles: c15m,
      allowOppositePositions: false,
    });

    const oppositeRejections =
      result.multiPositionDiagnostics?.rejectedSignals.opposite_while_open ?? 0;
    expect(oppositeRejections).toBeGreaterThan(0);

    // In allowOppositePositions=false mode, dual direction concurrency should be 0
    expect(result.multiPositionDiagnostics?.dualDirectionTimePercent).toBe(0);

    // Also confirm in trace that opposite_while_open events were captured
    const oppositeTraceEvents = result.trace?.ignoredSignals.filter(
      (s) => s.reason === 'opposite_while_open'
    );
    expect(oppositeTraceEvents?.length).toBe(oppositeRejections);
  });

  it('T-c: peak concurrency on BTCUSDT 15m has both long and short active simultaneously', () => {
    const engine = new BacktestEngine();
    const result = engine.run({
      ...baseConfig,
      strategy: createStrategy(),
      candles: c15m,
      allowOppositePositions: true,
    });

    const diag = result.multiPositionDiagnostics;
    expect(diag).toBeDefined();
    expect(diag!.maxConcurrentLong).toBeGreaterThanOrEqual(1);
    expect(diag!.maxConcurrentShort).toBeGreaterThanOrEqual(1);
    expect(diag!.maxConcurrentTotal).toBeGreaterThanOrEqual(2);
    expect(diag!.dualDirectionTimePercent).toBeGreaterThan(0);
    expect(diag!.avgConcurrentPositions).toBeGreaterThan(0);
  });

  it('T-d: verify opposite signal NEVER closes an existing position; exits occur ONLY via stop/trailing/TP/time/end', () => {
    const engine = new BacktestEngine();
    const result = engine.run({
      ...baseConfig,
      strategy: createStrategy(),
      candles: c15m,
      allowOppositePositions: true,
    });

    const allowedExits = new Set(['stopLoss', 'trailingStop', 'takeProfit', 'timeStop', 'end']);
    for (const trade of result.trades) {
      expect(allowedExits.has(trade.exitReason)).toBe(true);
      expect(trade.exitReason).not.toBe('reverse');
      // Exit signal action must be opposing side of entry
      if (trade.side === 'long') {
        expect(trade.exitSignal.action).toBe('SELL');
      } else {
        expect(trade.exitSignal.action).toBe('BUY');
      }
    }
  });
});
