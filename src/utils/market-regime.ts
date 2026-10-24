import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import { calculateSMA } from '../indicators/sma';

export interface DailyRegimeCalculator {
  getRegimeAt(timestamp: number): 'bull' | 'bear';
}

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

function aggregateToUtcDaily(candles: readonly Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const dayMs = 86400000;
  const aggregated: Candle[] = [];

  let currentBucketStart = Math.floor(candles[0].timestamp / dayMs) * dayMs;
  let curOpen = candles[0].open;
  let curHigh = candles[0].high;
  let curLow = candles[0].low;
  let curClose = candles[0].close;
  let curVolume = candles[0].volume;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const bucket = Math.floor(c.timestamp / dayMs) * dayMs;
    if (bucket === currentBucketStart) {
      if (c.high > curHigh) curHigh = c.high;
      if (c.low < curLow) curLow = c.low;
      curClose = c.close;
      curVolume += c.volume;
    } else {
      aggregated.push({
        timestamp: currentBucketStart,
        open: curOpen,
        high: curHigh,
        low: curLow,
        close: curClose,
        volume: curVolume,
      });
      currentBucketStart = bucket;
      curOpen = c.open;
      curHigh = c.high;
      curLow = c.low;
      curClose = c.close;
      curVolume = c.volume;
    }
  }

  aggregated.push({
    timestamp: currentBucketStart,
    open: curOpen,
    high: curHigh,
    low: curLow,
    close: curClose,
    volume: curVolume,
  });

  return aggregated;
}

export function createDailyRegimeCalculator(
  symbol: string,
  dataDir: string = path.resolve('docs/review/data')
): DailyRegimeCalculator {
  const p1d = path.join(dataDir, `${symbol}USDT_1d.csv.gz`);
  let dailyCandles: Candle[] = [];

  if (fs.existsSync(p1d)) {
    dailyCandles = loadGzCandles(p1d);
  } else {
    const p1h = path.join(dataDir, `${symbol}USDT_1h.csv.gz`);
    if (!fs.existsSync(p1h)) {
      throw new Error(`Cannot find candle data for ${symbol} to compute daily regime`);
    }
    const h1Candles = loadGzCandles(p1h);
    dailyCandles = aggregateToUtcDaily(h1Candles);
  }

  const closes = dailyCandles.map((c) => c.close);
  const sma200Values = calculateSMA(closes, 200);

  const dayMap = new Map<number, { close: number; sma200: number }>();
  for (let i = 0; i < dailyCandles.length; i++) {
    const sma = sma200Values[i];
    if (sma !== null && !isNaN(sma)) {
      dayMap.set(dailyCandles[i].timestamp, {
        close: dailyCandles[i].close,
        sma200: sma,
      });
    }
  }

  const timestamps = dailyCandles.map((c) => c.timestamp);

  return {
    getRegimeAt(timestamp: number): 'bull' | 'bear' {
      const currentDayStart = Math.floor(timestamp / 86400000) * 86400000;
      let low = 0;
      let high = timestamps.length - 1;
      let foundIdx = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (timestamps[mid] < currentDayStart) {
          foundIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (foundIdx === -1) {
        return 'bear';
      }

      const prevDayTs = timestamps[foundIdx];
      const data = dayMap.get(prevDayTs);
      if (!data) {
        return 'bear';
      }

      return data.close > data.sma200 ? 'bull' : 'bear';
    },
  };
}
