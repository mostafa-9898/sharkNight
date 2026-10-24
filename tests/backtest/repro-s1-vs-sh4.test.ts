import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../../src/data/models';
import { MultiTimeframeStrategy } from '../../src/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../../src/backtest/engine';
import { SH4_VARIANTS } from '../../src/scripts/run-sh4-variants';

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

describe('Reproducibility Parity: S1 vs SH4 (TR3 Baseline)', () => {
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

  const baseConfig = {
    initialBalance: 10000,
    positionSizePercent: 3,
    maxOpenPositions: 10,
    maxTotalExposurePercent: 30,
    minBarsBetweenEntries: 0,
    allowOppositePositions: true,
    tradeFeePercent: 0.1,
    exitMode: 'trailingOnly' as const,
    trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' as const },
    tradeMode: 'long-short' as const,
  };

  it('produces identical metrics between S1 and SH4 TR3 on BTC 15m', () => {
    const s1Strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      kijunSlopeFilter: true,
      structureFilter: true,
    });

    const s1Res = engine.run({
      ...baseConfig,
      strategy: s1Strategy,
      candles: btc15m,
    });

    const tr3Variant = SH4_VARIANTS.find((v) => v.id === 'TR3')!;
    const tr3Strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      kijunSlopeFilter: true,
      structureFilter: true,
      shortEntryFilter: tr3Variant.shortEntryFilter,
    });

    const tr3Res = engine.run({
      ...baseConfig,
      strategy: tr3Strategy,
      candles: btc15m,
      trailingStopShort: tr3Variant.trailingShort,
    });

    expect(tr3Res.metrics.totalPnlPercent).toBe(s1Res.metrics.totalPnlPercent);
    expect(tr3Res.metrics.maxDrawdownPercent).toBe(s1Res.metrics.maxDrawdownPercent);
    expect(tr3Res.metrics.totalTrades).toBe(s1Res.metrics.totalTrades);

    const s1Longs = s1Res.trades.filter((t) => t.side === 'long').length;
    const s1Shorts = s1Res.trades.filter((t) => t.side === 'short').length;
    const tr3Longs = tr3Res.trades.filter((t) => t.side === 'long').length;
    const tr3Shorts = tr3Res.trades.filter((t) => t.side === 'short').length;

    expect(tr3Longs).toBe(s1Longs);
    expect(tr3Shorts).toBe(s1Shorts);
  });

  it('produces identical metrics between S1 and SH4 TR3 on BTC 4h', () => {
    const s1Strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      kijunSlopeFilter: true,
      structureFilter: true,
    });

    const s1Res = engine.run({
      ...baseConfig,
      strategy: s1Strategy,
      candles: btc4h,
    });

    const tr3Variant = SH4_VARIANTS.find((v) => v.id === 'TR3')!;
    const tr3Strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      kijunSlopeFilter: true,
      structureFilter: true,
      shortEntryFilter: tr3Variant.shortEntryFilter,
    });

    const tr3Res = engine.run({
      ...baseConfig,
      strategy: tr3Strategy,
      candles: btc4h,
      trailingStopShort: tr3Variant.trailingShort,
    });

    expect(tr3Res.metrics.totalPnlPercent).toBe(s1Res.metrics.totalPnlPercent);
    expect(tr3Res.metrics.maxDrawdownPercent).toBe(s1Res.metrics.maxDrawdownPercent);
    expect(tr3Res.metrics.totalTrades).toBe(s1Res.metrics.totalTrades);

    const s1Longs = s1Res.trades.filter((t) => t.side === 'long').length;
    const s1Shorts = s1Res.trades.filter((t) => t.side === 'short').length;
    const tr3Longs = tr3Res.trades.filter((t) => t.side === 'long').length;
    const tr3Shorts = tr3Res.trades.filter((t) => t.side === 'short').length;

    expect(tr3Longs).toBe(s1Longs);
    expect(tr3Shorts).toBe(s1Shorts);
  });
});
