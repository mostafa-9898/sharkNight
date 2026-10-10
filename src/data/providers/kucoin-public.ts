import type { Candle, CandleRequest, CandleInterval } from '../models';
import { isValidCandle, sortCandles, deduplicateCandles } from '../models';
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

    const query = new URLSearchParams({
      symbol: kucoinSymbol,
      type: kucoinType,
    });

    if (request.startTime) {
      query.set('startAt', Math.floor(request.startTime / 1000).toString());
    }
    if (request.endTime) {
      query.set('endAt', Math.floor(request.endTime / 1000).toString());
    }

    const url = `${this.baseUrl}/api/v1/market/candles?${query.toString()}`;

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch candles from KuCoin: ${message}`);
    }

    if (!response.ok) {
      throw new Error(`KuCoin API returned status ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as { code: string; msg?: string; data?: unknown[] };

    if (json.code !== '200000' || !Array.isArray(json.data)) {
      throw new Error(`KuCoin API error: ${json.msg || json.code || 'Unknown error'}`);
    }

    const candles: Candle[] = [];

    // KuCoin row: [0: time, 1: open, 2: close, 3: high, 4: low, 5: volume, 6: turnover]
    for (const row of json.data) {
      if (!Array.isArray(row) || row.length < 6) {
        continue;
      }

      const candle: Candle = {
        timestamp: Number(row[0]) * 1000,
        open: Number(row[1]),
        close: Number(row[2]),
        high: Number(row[3]),
        low: Number(row[4]),
        volume: Number(row[5]),
      };

      if (isValidCandle(candle)) {
        candles.push(candle);
      }
    }

    const sorted = sortCandles(candles);
    const deduplicated = deduplicateCandles(sorted);

    if (request.limit && request.limit > 0 && deduplicated.length > request.limit) {
      return deduplicated.slice(-request.limit);
    }

    return deduplicated;
  }
}

