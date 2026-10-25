import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { Candle } from '../../src/data/models/candle';
import { MultiTimeframeStrategy } from '../../src/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../../src/backtest/engine';
import { SignalFunnel } from '../../src/backtest/types';

function loadGzCandles(filePath: string): Candle[] {
  const buf = fs.readFileSync(filePath);
  const text = zlib.gunzipSync(buf).toString('utf-8');
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  const timeIdx = header.indexOf('timestamp');
  const openIdx = header.indexOf('open');
  const highIdx = header.indexOf('high');
  const lowIdx = header.indexOf('low');
  const closeIdx = header.indexOf('close');
  const volIdx = header.indexOf('volume');

  return lines
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const parts = line.split(',');
      return {
        timestamp: Number(parts[timeIdx]),
        open: Number(parts[openIdx]),
        high: Number(parts[highIdx]),
        low: Number(parts[lowIdx]),
        close: Number(parts[closeIdx]),
        volume: Number(parts[volIdx]),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function assertFunnelInvariants(funnel: SignalFunnel, actualTrades: Array<{ side: 'long' | 'short' }>): void {
  for (const dir of ['long', 'short'] as const) {
    const s = funnel[dir];

    // (الف) Monotonic non-increasing counts
    expect(s.candidate).toBeGreaterThanOrEqual(s.passHtf);
    expect(s.passHtf).toBeGreaterThanOrEqual(s.passKijunSlope);
    expect(s.passKijunSlope).toBeGreaterThanOrEqual(s.passStructure);
    expect(s.passStructure).toBeGreaterThanOrEqual(s.passOppositeBlock);
    expect(s.passOppositeBlock).toBeGreaterThanOrEqual(s.passFisherConfirm);
    expect(s.passFisherConfirm).toBeGreaterThanOrEqual(s.signalEmitted);
    expect(s.signalEmitted).toBeGreaterThanOrEqual(s.entryAttempted);
    expect(s.entryAttempted).toBeGreaterThanOrEqual(s.executed);

    // Equality invariant: signalEmitted = entryAttempted
    expect(s.signalEmitted).toBe(s.entryAttempted);

    // Rejection reconciliation: entryAttempted = rejectedTotal + executed
    const sumRejections =
      s.rejected.max_positions +
      s.rejected.max_exposure +
      s.rejected.min_bars +
      s.rejected.opposite_not_allowed +
      s.rejected.other;
    expect(s.rejectedTotal).toBe(sumRejections);
    expect(s.entryAttempted).toBe(s.rejectedTotal + s.executed);

    // Raw trigger presence
    expect(s.raw.tk).toBeGreaterThanOrEqual(0);
    expect(s.raw.stoch).toBeGreaterThanOrEqual(0);
    expect(s.raw.fisher).toBeGreaterThanOrEqual(0);

    // Directional trades match actual trades count
    const actualDirTrades = actualTrades.filter((t) => t.side === dir).length;
    expect(s.executed).toBe(actualDirTrades);
  }

  // (ب) Total executed matches all trades
  const totalExecuted = funnel.long.executed + funnel.short.executed;
  expect(totalExecuted).toBe(actualTrades.length);
}

describe('ST1: Signal Funnel Reconciliation Test', () => {
  const dataDir = path.resolve('docs/review/data');
  let btc15m: Candle[];
  let btc1h: Candle[];
  let btc4h: Candle[];
  let engine: BacktestEngine;

  beforeAll(() => {
    btc15m = loadGzCandles(path.join(dataDir, 'BTCUSDT_15m.csv.gz'));
    btc1h = loadGzCandles(path.join(dataDir, 'BTCUSDT_1h.csv.gz'));
    btc4h = loadGzCandles(path.join(dataDir, 'BTCUSDT_4h.csv.gz'));
    engine = new BacktestEngine();
  });

  it('reconciles MultiTimeframeStrategy S1 multi-position on BTC 15m fixture', () => {
    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      cloudFilter: 'off',
      kijunSlopeFilter: true,
      structureFilter: true,
      htf4hCandles: btc4h,
      htf1hCandles: btc1h,
    });

    const result = engine.run({
      strategy,
      candles: btc15m,
      initialBalance: 10000,
      positionSizePercent: 3,
      maxOpenPositions: 10,
      maxTotalExposurePercent: 30,
      minBarsBetweenEntries: 0,
      allowOppositePositions: true,
      tradeFeePercent: 0.1,
      exitMode: 'trailingOnly',
      trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      tradeMode: 'long-short',
      collectTrace: true,
    });

    expect(result.signalFunnel).toBeDefined();
    assertFunnelInvariants(result.signalFunnel!, result.trades);

    // S1 should have executed trades
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.signalFunnel!.long.executed).toBeGreaterThan(0);
    expect(result.signalFunnel!.short.executed).toBeGreaterThan(0);
  });

  it('reconciles single-position mode on BTC 15m fixture', () => {
    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'replace-stoch',
      fisherKind: 'fisher',
      fisherGate: 'none',
      cloudFilter: 'off',
      kijunSlopeFilter: true,
      structureFilter: true,
      htf4hCandles: btc4h,
      htf1hCandles: btc1h,
    });

    const result = engine.run({
      strategy,
      candles: btc15m,
      initialBalance: 10000,
      positionSizePercent: 10,
      tradeFeePercent: 0.1,
      exitMode: 'trailingOnly',
      trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      tradeMode: 'long-short',
      collectTrace: true,
    });

    expect(result.signalFunnel).toBeDefined();
    assertFunnelInvariants(result.signalFunnel!, result.trades);
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it('reconciles long-only mode with opposite-direction block', () => {
    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      cloudFilter: 'off',
      kijunSlopeFilter: true,
      structureFilter: true,
      htf4hCandles: btc4h,
      htf1hCandles: btc1h,
    });

    const result = engine.run({
      strategy,
      candles: btc15m,
      initialBalance: 10000,
      positionSizePercent: 3,
      maxOpenPositions: 5,
      maxTotalExposurePercent: 15,
      minBarsBetweenEntries: 1,
      allowOppositePositions: false,
      tradeFeePercent: 0.1,
      exitMode: 'trailingOnly',
      trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      tradeMode: 'long-only',
      collectTrace: true,
    });

    expect(result.signalFunnel).toBeDefined();
    assertFunnelInvariants(result.signalFunnel!, result.trades);
    // In long-only mode, short.executed must be 0
    expect(result.signalFunnel!.short.executed).toBe(0);
    // If there were any short signals emitted, they must all be rejected
    expect(result.signalFunnel!.short.entryAttempted).toBe(result.signalFunnel!.short.rejectedTotal);
  });
});
