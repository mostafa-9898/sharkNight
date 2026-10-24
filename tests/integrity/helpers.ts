import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '@/data/models';
import { roundTo } from '@/utils/math';

/**
 * Deterministic pseudo-random number generator (Mulberry32) for reproducible integrity tests.
 */
export function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates synthetic OHLCV candles based on seeded random walk with realistic volatility.
 */
export function generateSyntheticCandles(
  count: number,
  rng: () => number,
  startPrice = 100,
  intervalMs = 15 * 60 * 1000,
  startTime = 1600000000000
): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = startPrice;

  for (let i = 0; i < count; i++) {
    const timestamp = startTime + i * intervalMs;
    // Log-normal return step
    const ret = (rng() - 0.495) * 0.02; // slight drift
    const open = currentPrice;
    const close = Math.max(1, roundTo(open * (1 + ret), 4));

    const wickUp = rng() * 0.01;
    const wickDown = rng() * 0.01;
    const high = Math.max(open, close, roundTo(Math.max(open, close) * (1 + wickUp), 4));
    const low = Math.min(open, close, roundTo(Math.min(open, close) * (1 - wickDown), 4));
    const volume = roundTo(100 + rng() * 500, 2);

    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Loads real market slice from fixtures.
 */
export function loadRealFixtureSlice(): Candle[] {
  const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', 'btc_15m_sep3_slice.json');
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Real fixture slice not found at ${fixturePath}`);
  }
  const content = fs.readFileSync(fixturePath, 'utf-8');
  return JSON.parse(content) as Candle[];
}

/**
 * Creates mirror candles:
 * price -> P0^2 / price
 */
export function createMirrorCandles(candles: readonly Candle[], P0 = 100): Candle[] {
  const p0Sq = P0 * P0;
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: roundTo(p0Sq / c.open, 6),
    high: roundTo(p0Sq / c.low, 6),
    low: roundTo(p0Sq / c.high, 6),
    close: roundTo(p0Sq / c.close, 6),
    volume: c.volume,
  }));
}

