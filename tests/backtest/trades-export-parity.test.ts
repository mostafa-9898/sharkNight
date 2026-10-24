import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { BacktestEngine } from '../../src/backtest/engine';
import { MultiTimeframeStrategy } from '../../src/strategies/multi-timeframe-strategy';
import { createDailyRegimeCalculator } from '../../src/utils/market-regime';
import {
  formatTradeRow,
  serializeTradeRows,
  parseTradeRows,
  TRADE_CSV_HEADER,
  type TradeCsvRow,
} from '../../src/utils/trade-export';
import type { Candle } from '../../src/data/models';
import { roundTo } from '../../src/utils/math';

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

describe('SH1: Trade Artifact Export and Engine Parity Test', () => {
  it('exports trades with all 15 required columns and verifies sum(pnlUsd) equals engine totalPnl within 0.01 tolerance', () => {
    const dataDir = path.resolve('docs/review/data');
    const btc4hPath = path.join(dataDir, 'BTCUSDT_4h.csv.gz');
    const btc1hPath = path.join(dataDir, 'BTCUSDT_1h.csv.gz');

    if (!fs.existsSync(btc4hPath) || !fs.existsSync(btc1hPath)) {
      return;
    }

    const candles4h = loadGzCandles(btc4hPath);
    const candles1h = loadGzCandles(btc1hPath);

    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf1hCandles: candles1h,
      htf4hCandles: candles4h,
      kijunSlopeFilter: true,
      structureFilter: true,
    });

    const engine = new BacktestEngine();
    const result = engine.run({
      initialBalance: 10000,
      positionSizePercent: 3,
      maxOpenPositions: 10,
      maxTotalExposurePercent: 30,
      minBarsBetweenEntries: 0,
      allowOppositePositions: true,
      tradeFeePercent: 0.1,
      tradeMode: 'long-short',
      exitMode: 'trailingOnly',
      trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      strategy,
      candles: candles4h,
    });

    expect(result.trades.length).toBeGreaterThan(0);

    const regimeCalc = createDailyRegimeCalculator('BTC', dataDir);
    const intervalMs = 4 * 60 * 60 * 1000;

    const rows: TradeCsvRow[] = result.trades.map((t) =>
      formatTradeRow(t, intervalMs, regimeCalc)
    );

    const serialized = serializeTradeRows(rows);
    const parsed = parseTradeRows(serialized);

    expect(parsed.length).toBe(result.trades.length);

    // Verify all 15 columns
    const expectedHeaders = [
      'side',
      'entryTime',
      'exitTime',
      'entryPrice',
      'exitPrice',
      'pnlPct',
      'pnlUsd',
      'exitReason',
      'mfe',
      'mae',
      'bars',
      'concurrentOpenAtEntry',
      'htfDirAtEntry',
      'regime',
      'triggerType',
    ];
    expect(TRADE_CSV_HEADER.split(',')).toEqual(expectedHeaders);

    for (const row of parsed) {
      expect(['long', 'short']).toContain(row.side);
      expect(row.entryTime).toBeGreaterThan(0);
      expect(row.exitTime).toBeGreaterThanOrEqual(row.entryTime);
      expect(row.entryPrice).toBeGreaterThan(0);
      expect(row.exitPrice).toBeGreaterThan(0);
      expect(Number.isFinite(row.pnlPct)).toBe(true);
      expect(Number.isFinite(row.pnlUsd)).toBe(true);
      expect(row.bars).toBeGreaterThanOrEqual(1);
      expect(row.concurrentOpenAtEntry).toBeGreaterThanOrEqual(1);
      expect(['bullish', 'bearish']).toContain(row.htfDirAtEntry);
      expect(['bull', 'bear']).toContain(row.regime);
      expect(['tk', 'stoch', 'fisher']).toContain(row.triggerType);
    }

    // Parity test: sum(pnlUsd) = engine total return (tolerance 0.01)
    const sumPnlUsd = parsed.reduce((sum, r) => sum + r.pnlUsd, 0);
    const diff = Math.abs(sumPnlUsd - result.metrics.totalPnl);
    expect(diff).toBeLessThanOrEqual(0.01);

    // Also check total return percentage matches within 0.01%
    const sumPnlPctOfInitial = (sumPnlUsd / 10000) * 100;
    const pctDiff = Math.abs(sumPnlPctOfInitial - result.metrics.totalPnlPercent);
    expect(pctDiff).toBeLessThanOrEqual(0.01);
  });
});

