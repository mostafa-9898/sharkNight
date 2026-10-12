import type { Candle, CandleRequest, CandleInterval } from '../models/candle';
import { isValidCandle, sortCandles, deduplicateCandles } from '../models/candle';
import type { DataProvider } from './types';

export interface KucoinProviderOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const INTERVAL_MAP: Record<CandleInterval, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1hour',
  '4h': '4hour',
  '1d': '1day',
  '1w': '1week',
};

export class KucoinPublicProvider implements DataProvider {
  readonly name = 'kucoin-public';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: KucoinProviderOptions) {
    this.baseUrl = (options?.baseUrl ?? 'https://api.kucoin.com').replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /**
   * Formats a symbol like BTCUSDT into KuCoin's BTC-USDT format.
   */
  private formatSymbol(symbol: string): string {
    const clean = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.includes('-')) {
      return clean;
    }
    if (clean.endsWith('USDT')) {
      const base = clean.slice(0, -4);
      return `${base}-USDT`;
    }
    return clean;
  }

  async fetchCandles(request: CandleRequest): Promise<Candle[]> {
    const kucoinSymbol = this.formatSymbol(request.symbol);
    const kucoinType = INTERVAL_MAP[request.interval] ?? '1hour';
    const targetLimit = request.limit ?? 1500;
    const startTimeSec = request.startTime ? Math.floor(request.startTime / 1000) : undefined;
    let currentEndSec = request.endTime ? Math.floor(request.endTime / 1000) : Math.floor(Date.now() / 1000);

    const allCandles: Candle[] = [];
    // KuCoin returns up to 1500 candles per batch. For 2 years of 15m (~70,080 candles), we need ~50-80 batches.
    // Calculate maxBatches dynamically with an upper safety ceiling of 500 batches.
    const maxBatches = Math.min(500, Math.max(50, Math.ceil(targetLimit / 1000) + 20));

    for (let batch = 0; batch < maxBatches; batch++) {
      const query = new URLSearchParams({
        symbol: kucoinSymbol,
        type: kucoinType,
        endAt: currentEndSec.toString(),
      });

      if (startTimeSec !== undefined) {
        query.set('startAt', startTimeSec.toString());
      }

      const url = `${this.baseUrl}/api/v1/market/candles?${query.toString()}`;

      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await this.fetchFn(url);
          if (response.status === 429) {
            // Rate limited: wait 1.5s then retry
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }
          break;
        } catch (err) {
          if (attempt === 2) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to fetch candles from KuCoin: ${message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (!response || !response.ok) {
        throw new Error(
          `KuCoin API returned status ${response?.status ?? 'unknown'}: ${response?.statusText ?? 'error'}`
        );
      }

      const json = (await response.json()) as { code: string; msg?: string; data?: unknown[] };

      if (json.code !== '200000') {
        throw new Error(json.msg ?? `KuCoin API error code: ${json.code}`);
      }

      if (!Array.isArray(json.data) || json.data.length === 0) {
        break;
      }

      // Small pacing delay to respect API rate limits
      await new Promise((resolve) => setTimeout(resolve, 150));

      const batchCandles: Candle[] = [];
      let oldestSecInBatch = Infinity;

      for (const row of json.data) {
        if (!Array.isArray(row) || row.length < 6) {
          continue;
        }

        const timeSec = Number(row[0]);
        if (timeSec < oldestSecInBatch) {
          oldestSecInBatch = timeSec;
        }

        const candle: Candle = {
          timestamp: timeSec * 1000,
          open: Number(row[1]),
          close: Number(row[2]),
          high: Number(row[3]),
          low: Number(row[4]),
          volume: Number(row[5]),
        };

        if (isValidCandle(candle)) {
          batchCandles.push(candle);
        }
      }

      allCandles.push(...batchCandles);

      // Stop if reached requested count or startTime reached or no more candles returned
      if (allCandles.length >= targetLimit || (startTimeSec !== undefined && oldestSecInBatch <= startTimeSec)) {
        break;
      }

      // If KuCoin returned fewer than 1500 items, we reached the start of history
      if (json.data.length < 1500) {
        break;
      }

      currentEndSec = oldestSecInBatch - 1;
    }

    const sorted = sortCandles(allCandles);
    const deduplicated = deduplicateCandles(sorted);

    if (request.limit && request.limit > 0 && deduplicated.length > request.limit) {
      return deduplicated.slice(-request.limit);
    }

    return deduplicated;
  }
}

