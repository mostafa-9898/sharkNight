import type { Candle } from '../data/models';

export interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  type: 'high' | 'low';
  confirmedIndex: number;
}

export interface ConfirmedSwingsResult {
  highs: SwingPoint[];
  lows: SwingPoint[];
  all: SwingPoint[];
}

/**
 * Identifies confirmed pivot highs and pivot lows strictly without lookahead.
 *
 * Candle j is a pivot-high if its high >= all its k candles before and after.
 * Candle j is a pivot-low if its low <= all its k candles before and after.
 *
 * A pivot at j is confirmed at candle j + k.
 * At candle i, only pivots with j <= i - k are usable (causal / no lookahead).
 */
export function confirmedSwings(
  candles: readonly Candle[],
  k = 3,
  currentIndex?: number
): ConfirmedSwingsResult {
  const maxIdx = currentIndex !== undefined ? currentIndex : candles.length - 1;
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  const all: SwingPoint[] = [];

  if (k <= 0 || candles.length < 2 * k + 1) {
    return { highs, lows, all };
  }

  const limit = Math.min(candles.length - 1 - k, maxIdx - k);

  for (let j = k; j <= limit; j++) {
    const cur = candles[j];

    // Pivot-high: high >= all k candles before and after
    let isHigh = true;
    for (let m = j - k; m <= j + k; m++) {
      if (m !== j && !(cur.high >= candles[m].high)) {
        isHigh = false;
        break;
      }
    }

    if (isHigh) {
      const pt: SwingPoint = {
        index: j,
        timestamp: cur.timestamp,
        price: cur.high,
        type: 'high',
        confirmedIndex: j + k,
      };
      highs.push(pt);
      all.push(pt);
    }

    // Pivot-low: low <= all k candles before and after
    let isLow = true;
    for (let m = j - k; m <= j + k; m++) {
      if (m !== j && !(cur.low <= candles[m].low)) {
        isLow = false;
        break;
      }
    }

    if (isLow) {
      const pt: SwingPoint = {
        index: j,
        timestamp: cur.timestamp,
        price: cur.low,
        type: 'low',
        confirmedIndex: j + k,
      };
      lows.push(pt);
      all.push(pt);
    }
  }

  all.sort((a, b) => a.index - b.index);

  return { highs, lows, all };
}

