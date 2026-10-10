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

