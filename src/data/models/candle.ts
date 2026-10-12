export interface Candle {
  timestamp: number;      // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleRequest {
  symbol: string;          // e.g., 'BTCUSDT'
  interval: CandleInterval;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * Validates whether an unknown object satisfies the Candle interface and logical pricing constraints.
 */
export function isValidCandle(candle: unknown): candle is Candle {
  if (!candle || typeof candle !== 'object') {
    return false;
  }

  const c = candle as Record<string, unknown>;

  if (
    typeof c.timestamp !== 'number' ||
    !Number.isFinite(c.timestamp) ||
    c.timestamp <= 0
  ) {
    return false;
  }

  const numericFields = ['open', 'high', 'low', 'close', 'volume'] as const;
  for (const field of numericFields) {
    if (typeof c[field] !== 'number' || !Number.isFinite(c[field]) || (c[field] as number) < 0) {
      return false;
    }
  }

  const open = c.open as number;
  const high = c.high as number;
  const low = c.low as number;
  const close = c.close as number;

  // Logical checks: low must be lowest, high must be highest
  if (low > high || low > open || low > close || high < open || high < close) {
    return false;
  }

  return true;
}

/**
 * Validates an array of candles. Returns true only if all items are valid.
 */
export function areValidCandles(candles: unknown): candles is Candle[] {
  if (!Array.isArray(candles)) {
    return false;
  }
  return candles.every(isValidCandle);
}

/**
 * Sorts candles chronologically by timestamp in ascending order.
 * Returns a new array, does not mutate the original.
 */
export function sortCandles(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Deduplicates candles based on timestamp, preserving the latest candle for any duplicate timestamp.
 */
export function deduplicateCandles(candles: readonly Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const candle of candles) {
    map.set(candle.timestamp, candle);
  }
  return sortCandles(Array.from(map.values()));
}

/**
 * Returns the duration in milliseconds corresponding to a CandleInterval.
 */
export function getIntervalMs(interval: CandleInterval): number {
  switch (interval) {
    case '1m':
      return 60 * 1000;
    case '5m':
      return 5 * 60 * 1000;
    case '15m':
      return 15 * 60 * 1000;
    case '30m':
      return 30 * 60 * 1000;
    case '1h':
      return 60 * 60 * 1000;
    case '4h':
      return 4 * 60 * 60 * 1000;
    case '1d':
      return 24 * 60 * 60 * 1000;
    case '1w':
      return 7 * 24 * 60 * 60 * 1000;
  }
}

export interface CandleSanityCheck {
  candleCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  minClose: number | null;
  maxClose: number | null;
  gapCount: number; // Count of gaps larger than 1.5 intervals
}

/**
 * Validates and inspects a sequence of candles for data integrity and gaps.
 */
export function performCandleSanityCheck(
  candles: readonly Candle[],
  interval: CandleInterval
): CandleSanityCheck {
  if (candles.length === 0) {
    return {
      candleCount: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      minClose: null,
      maxClose: null,
      gapCount: 0,
    };
  }

  const intervalMs = getIntervalMs(interval);
  let minClose = candles[0].close;
  let maxClose = candles[0].close;
  let gapCount = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.close < minClose) minClose = c.close;
    if (c.close > maxClose) maxClose = c.close;

    if (i > 0) {
      const diff = c.timestamp - candles[i - 1].timestamp;
      // Gap larger than 1.5x interval indicates a missing candle
      if (diff > intervalMs * 1.5) {
        gapCount++;
      }
    }
  }

  return {
    candleCount: candles.length,
    firstTimestamp: candles[0].timestamp,
    lastTimestamp: candles[candles.length - 1].timestamp,
    minClose,
    maxClose,
    gapCount,
  };
}

