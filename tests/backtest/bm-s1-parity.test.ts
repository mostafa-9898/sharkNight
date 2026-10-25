import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../../src/data/models';
import { BacktestEngine } from '../../src/backtest/engine';
import { runS1StandardBacktest } from '../../src/backtest/s1-unified-runner';
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

describe('BM-S1 Parity: BM baselines S1L and S1LS match VALIDATION.md', () => {
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

  // Parity numbers from VALIDATION.md:
  // S2 (long-only / S1L):
  //   BTC 15m: Return = +55.09%, MaxDD = 16.78%, Trades = 334
  //   BTC 4h:  Return = +13.81%, MaxDD = 6.67%,  Trades = 122
  // S1 (long-short / S1LS):
  //   BTC 15m: Return = +37.29%, MaxDD = 16.44%, Trades = 544
  //   BTC 4h:  Return = +10.27%, MaxDD = 7.63%,  Trades = 197

  describe('BTC 15m Parity', () => {
    it('S1L (Long-Only) matches VALIDATION S2 on BTC 15m', () => {
      const res = runS1StandardBacktest({
        engine,
        candles: btc15m,
        htf1hCandles: btc1h,
        htf4hCandles: btc4h,
        tradeMode: 'long-only',
      });

      const ret = roundTo(res.metrics.totalPnlPercent, 2);
      const dd = roundTo(res.metrics.maxDrawdownPercent, 2);
      const trades = res.trades.length;

      expect(ret).toBe(55.09);
      expect(dd).toBe(16.78);
      expect(trades).toBe(334);
    });

    it('S1LS (Long-Short) matches VALIDATION S1 on BTC 15m', () => {
      const res = runS1StandardBacktest({
        engine,
        candles: btc15m,
        htf1hCandles: btc1h,
        htf4hCandles: btc4h,
        tradeMode: 'long-short',
      });

      const ret = roundTo(res.metrics.totalPnlPercent, 2);
      const dd = roundTo(res.metrics.maxDrawdownPercent, 2);
      const trades = res.trades.length;

      expect(ret).toBe(37.29);
      expect(dd).toBe(16.44);
      expect(trades).toBe(544);
    });
  });

  describe('BTC 4h Parity', () => {
    it('S1L (Long-Only) matches VALIDATION S2 on BTC 4h', () => {
      const res = runS1StandardBacktest({
        engine,
        candles: btc4h,
        htf1hCandles: btc1h,
        htf4hCandles: btc4h,
        tradeMode: 'long-only',
      });

      const ret = roundTo(res.metrics.totalPnlPercent, 2);
      const dd = roundTo(res.metrics.maxDrawdownPercent, 2);
      const trades = res.trades.length;

      expect(ret).toBe(13.81);
      expect(dd).toBe(6.67);
      expect(trades).toBe(122);
    });

    it('S1LS (Long-Short) matches VALIDATION S1 on BTC 4h', () => {
      const res = runS1StandardBacktest({
        engine,
        candles: btc4h,
        htf1hCandles: btc1h,
        htf4hCandles: btc4h,
        tradeMode: 'long-short',
      });

      const ret = roundTo(res.metrics.totalPnlPercent, 2);
      const dd = roundTo(res.metrics.maxDrawdownPercent, 2);
      const trades = res.trades.length;

      expect(ret).toBe(10.27);
      expect(dd).toBe(7.63);
      expect(trades).toBe(197);
    });
  });
});
