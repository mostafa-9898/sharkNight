import type { Candle, CandleRequest } from '../models';
import { isValidCandle, sortCandles, deduplicateCandles } from '../models';
import type { DataProvider } from './types';

export interface BinanceProviderOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

// Binance klines row format:
// [0: openTime, 1: open, 2: high, 3: low, 4: close, 5: volume, 6: closeTime, ...]
type BinanceKlineRow = [
  number, // Open time
  string, // Open
  string, // High
  string, // Low
  string, // Close
  string, // Volume
  number, // Close time
  string, // Quote asset volume
  number, // Number of trades
  string, // Taker buy base asset volume
  string, // Taker buy quote asset volume
  string  // Unused
];

const MAX_BINANCE_LIMIT = 1000;
const DEFAULT_BINANCE_LIMIT = 500;

export class BinancePublicProvider implements DataProvider {
  readonly name = 'binance-public';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: BinanceProviderOptions) {
    this.baseUrl = (options?.baseUrl ?? 'https://api.binance.com').replace(/\/+$/, '');
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  /**
   * Fetches historical candlestick data from Binance public API.
   * Automatically handles pagination if limit > 1000 or if a broad time range is provided.
   */
  async fetchCandles(request: CandleRequest): Promise<Candle[]> {
    const symbol = request.symbol.trim().toUpperCase();
    if (!symbol) {
      throw new Error('Symbol cannot be empty');
    }

    const targetLimit = request.limit ?? DEFAULT_BINANCE_LIMIT;
    if (targetLimit <= 0) {
      return [];
    }

    const allCandles: Candle[] = [];
    let currentStartTime = request.startTime;
    const finalEndTime = request.endTime;

    while (allCandles.length < targetLimit) {
      const remainingLimit = targetLimit - allCandles.length;
      const batchLimit = Math.min(remainingLimit, MAX_BINANCE_LIMIT);

      const batchCandles = await this.fetchBatch({
        symbol,
        interval: request.interval,
        startTime: currentStartTime,
        endTime: finalEndTime,
        limit: batchLimit,
      });

      if (batchCandles.length === 0) {
        break;
      }

      allCandles.push(...batchCandles);

      // If fewer candles than requested were returned, we have reached the end of available data
      if (batchCandles.length < batchLimit) {
        break;
      }

      const lastCandle = batchCandles[batchCandles.length - 1];
      // Next batch should start 1ms after the last candle timestamp
      currentStartTime = lastCandle.timestamp + 1;

      // If we passed the requested endTime, stop
      if (finalEndTime !== undefined && currentStartTime > finalEndTime) {
        break;
      }
    }

    return deduplicateCandles(sortCandles(allCandles));
  }

  /**
   * Performs a single HTTP GET request to Binance klines endpoint.
   */
  private async fetchBatch(params: {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit: number;
  }): Promise<Candle[]> {
    const query = new URLSearchParams({
      symbol: params.symbol,
      interval: params.interval,
      limit: params.limit.toString(),
    });

    if (params.startTime !== undefined) {
      query.set('startTime', params.startTime.toString());
    }
    if (params.endTime !== undefined) {
      query.set('endTime', params.endTime.toString());
    }

    const url = `${this.baseUrl}/api/v3/klines?${query.toString()}`;

    let response: Response;
    try {
      response = await this.fetchFn(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch candles from Binance API: ${message}`);
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // Ignore response body read failure
      }
      throw new Error(
        `Binance API error (status ${response.status}): ${errorBody || response.statusText}`
      );
    }

    const rawData = (await response.json()) as unknown;

    if (!Array.isArray(rawData)) {
      throw new Error('Unexpected response format from Binance API: expected an array');
    }

    return this.parseKlineData(rawData);
  }

  /**
   * Parses raw Binance kline rows into verified Candle objects.
   */
  private parseKlineData(rows: unknown[]): Candle[] {
    const candles: Candle[] = [];

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) {
        continue;
      }

      const kline = row as BinanceKlineRow;
      const candle: Candle = {
        timestamp: Number(kline[0]),
        open: Number(kline[1]),
        high: Number(kline[2]),
        low: Number(kline[3]),
        close: Number(kline[4]),
        volume: Number(kline[5]),
      };

      if (isValidCandle(candle)) {
        candles.push(candle);
      }
    }

    return candles;
  }
}

