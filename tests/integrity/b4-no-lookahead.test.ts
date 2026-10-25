import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../../src/data/models';
import { StrictHtfBaselineStrategy } from '../../src/strategies/strict-htf-baseline-strategy';
import { BacktestEngine } from '../../src/backtest/engine';

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

describe('B4 Integrity: Causality and No-Lookahead Invariance', () => {
  const dataDir = path.resolve('docs/review/data');
  let btc15m: Candle[];
  let btc1h: Candle[];
  let btc4h: Candle[];

  beforeAll(() => {
    btc15m = loadGzCandles(path.join(dataDir, 'BTCUSDT_15m.csv.gz'));
    btc1h = loadGzCandles(path.join(dataDir, 'BTCUSDT_1h.csv.gz'));
    btc4h = loadGzCandles(path.join(dataDir, 'BTCUSDT_4h.csv.gz'));
  });

  it('strict HTF status at candle t is invariant to future candle truncation (right-truncation test)', () => {
    const fullStrategy = new StrictHtfBaselineStrategy({
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      mode: 'long-only',
    });

    // Test across diverse cut-off points throughout the dataset
    const testCutoffs = [500, 1000, 5000, 10000, 25000, 50000, 80000];

    for (const cutoff of testCutoffs) {
      if (cutoff >= btc15m.length) continue;
      const cutoffTime = btc15m[cutoff].timestamp + 15 * 60 * 1000;

      // Truncate series up to cutoff
      const sliced15m = btc15m.slice(0, cutoff + 1);
      const sliced1h = btc1h.filter((c) => c.timestamp + 60 * 60 * 1000 <= cutoffTime);
      const sliced4h = btc4h.filter((c) => c.timestamp + 4 * 60 * 60 * 1000 <= cutoffTime);

      const truncatedStrategy = new StrictHtfBaselineStrategy({
        htf1hCandles: sliced1h,
        htf4hCandles: sliced4h,
        mode: 'long-only',
      });

      const fullDir = fullStrategy.getStrictHtfDirection(btc15m, cutoff);
      const truncDir = truncatedStrategy.getStrictHtfDirection(sliced15m, cutoff);

      expect(truncDir).toBe(fullDir);

      const fullSignal = fullStrategy.analyze(btc15m, cutoff);
      const truncSignal = truncatedStrategy.analyze(sliced15m, cutoff);

      expect(truncSignal.action).toBe(fullSignal.action);
      expect(truncSignal.price).toBe(fullSignal.price);
    }
  });

  it('B4 only uses closed HTF candles (closing time <= LTF candle close time)', () => {
    const strategy = new StrictHtfBaselineStrategy({
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      mode: 'long-only',
    });

    // Check first 1000 candles to ensure no HTF candle beyond candle's end time is considered
    for (let i = 200; i < 500; i++) {
      const ltfCloseTime = btc15m[i].timestamp + 15 * 60 * 1000;
      const dir = strategy.getStrictHtfDirection(btc15m, i);
      // Valid direction must be either -1, 0, or 1
      expect([-1, 0, 1]).toContain(dir);

      // Verify HTF candles timestamps available
      const htf1hAvailable = btc1h.filter((c) => c.timestamp + 60 * 60 * 1000 <= ltfCloseTime);
      const htf4hAvailable = btc4h.filter((c) => c.timestamp + 4 * 60 * 60 * 1000 <= ltfCloseTime);

      if (htf1hAvailable.length === 0 || htf4hAvailable.length === 0) {
        expect(dir).toBe(0);
      }
    }
  });

  it('BacktestEngine execution with B4 produces identical trades on truncated prefix', () => {
    const engine = new BacktestEngine();
    const prefixCount = 5000;
    const prefixCandles = btc15m.slice(0, prefixCount);
    const prefixEndTime = prefixCandles[prefixCount - 1].timestamp + 15 * 60 * 1000;

    const prefix1h = btc1h.filter((c) => c.timestamp + 60 * 60 * 1000 <= prefixEndTime);
    const prefix4h = btc4h.filter((c) => c.timestamp + 4 * 60 * 60 * 1000 <= prefixEndTime);

    const stratFull = new StrictHtfBaselineStrategy({
      htf1hCandles: btc1h,
      htf4hCandles: btc4h,
      mode: 'long-only',
    });

    const stratPrefix = new StrictHtfBaselineStrategy({
      htf1hCandles: prefix1h,
      htf4hCandles: prefix4h,
      mode: 'long-only',
    });

    const resFull = engine.run({
      initialBalance: 10000,
      tradeFeePercent: 0.1,
      positionSizePercent: 30,
      tradeMode: 'long-only',
      exitMode: 'reverse',
      candles: btc15m,
      strategy: stratFull,
    });

    const resPrefix = engine.run({
      initialBalance: 10000,
      tradeFeePercent: 0.1,
      positionSizePercent: 30,
      tradeMode: 'long-only',
      exitMode: 'reverse',
      candles: prefixCandles,
      strategy: stratPrefix,
    });

    // All trades completed fully before prefixEndTime should match exactly
    const fullTradesBeforePrefix = resFull.trades.filter(
      (t) => (t.exitTime ?? 0) <= prefixEndTime && t.exitReason !== 'end'
    );
    const prefixTradesBeforeEnd = resPrefix.trades.filter(
      (t) => t.exitReason !== 'end'
    );

    expect(prefixTradesBeforeEnd.length).toBe(fullTradesBeforePrefix.length);
    for (let k = 0; k < prefixTradesBeforeEnd.length; k++) {
      expect(prefixTradesBeforeEnd[k].entryTime).toBe(fullTradesBeforePrefix[k].entryTime);
      expect(prefixTradesBeforeEnd[k].exitTime).toBe(fullTradesBeforePrefix[k].exitTime);
      expect(prefixTradesBeforeEnd[k].entryPrice).toBe(fullTradesBeforePrefix[k].entryPrice);
      expect(prefixTradesBeforeEnd[k].exitPrice).toBe(fullTradesBeforePrefix[k].exitPrice);
      expect(prefixTradesBeforeEnd[k].pnl).toBeCloseTo(fullTradesBeforePrefix[k].pnl, 4);
    }
  });
});
