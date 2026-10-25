import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import { calculateSMA } from '../indicators/sma';

export interface DailyRegimeCalculator {
  getRegimeAt(timestamp: number): 'bull' | 'bear';
  getDailyTrendAt(timestamp: number): 1 | -1 | 0;
  getDailyDataAt(timestamp: number): { close: number; sma200: number } | null;
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

export function aggregateToUtcDaily(candles: readonly Candle[]): Candle[] {
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

export function getDailyCandlesForSymbol(
  symbol: string,
  dataDir: string = path.resolve('docs/review/data')
): Candle[] {
  const p1d = path.join(dataDir, `${symbol}USDT_1d.csv.gz`);
  if (fs.existsSync(p1d)) {
    return loadGzCandles(p1d);
  }
  const p1h = path.join(dataDir, `${symbol}USDT_1h.csv.gz`);
  if (!fs.existsSync(p1h)) {
    throw new Error(`Cannot find candle data for ${symbol} to compute daily regime`);
  }
  const h1Candles = loadGzCandles(p1h);
  return aggregateToUtcDaily(h1Candles);
}

export function createDailyRegimeCalculatorFromDailyCandles(
  dailyCandles: readonly Candle[]
): DailyRegimeCalculator {
  const sorted = [...dailyCandles].sort((a, b) => a.timestamp - b.timestamp);
  const closes = sorted.map((c) => c.close);
  const sma200Values = calculateSMA(closes, 200);

  const dayMap = new Map<number, { close: number; sma200: number }>();
  for (let i = 0; i < sorted.length; i++) {
    const sma = sma200Values[i];
    if (sma !== null && !isNaN(sma)) {
      dayMap.set(sorted[i].timestamp, {
        close: sorted[i].close,
        sma200: sma,
      });
    }
  }

  const timestamps = sorted.map((c) => c.timestamp);

  const getDailyDataAt = (timestamp: number): { close: number; sma200: number } | null => {
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
      return null;
    }

    const prevDayTs = timestamps[foundIdx];
    return dayMap.get(prevDayTs) ?? null;
  };

  return {
    getDailyDataAt,
    getDailyTrendAt(timestamp: number): 1 | -1 | 0 {
      const data = getDailyDataAt(timestamp);
      if (!data) return 0;
      if (data.close > data.sma200) return 1;
      if (data.close < data.sma200) return -1;
      return 0;
    },
    getRegimeAt(timestamp: number): 'bull' | 'bear' {
      const data = getDailyDataAt(timestamp);
      if (!data) return 'bear';
      return data.close > data.sma200 ? 'bull' : 'bear';
    },
  };
}

export function createDailyRegimeCalculator(
  symbol: string,
  dataDir: string = path.resolve('docs/review/data')
): DailyRegimeCalculator {
  const dailyCandles = getDailyCandlesForSymbol(symbol, dataDir);
  return createDailyRegimeCalculatorFromDailyCandles(dailyCandles);
}
