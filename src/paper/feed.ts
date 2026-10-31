import * as fs from 'fs/promises';
import * as path from 'path';
import type { Candle, CandleInterval } from '../data/models/candle';
import { isValidCandle, sortCandles, deduplicateCandles, getIntervalMs } from '../data/models/candle';

export interface PaperFeedOptions {
  baseUrl?: string;
  dataDir?: string;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

// Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKlineRow = [
  number, // 0: Open time
  string, // 1: Open
  string, // 2: High
  string, // 3: Low
  string, // 4: Close
  string, // 5: Volume
  number, // 6: Close time
  string, // 7: Quote asset volume
  number, // 8: Number of trades
  string, // 9: Taker buy base asset volume
  string, // 10: Taker buy quote asset volume
  string  // 11: Ignore
];

export class PaperDataFeed {
  readonly baseUrl: string;
  readonly dataDir: string;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options?: PaperFeedOptions) {
    this.baseUrl = (options?.baseUrl ?? 'https://api.binance.com').replace(/\/+$/, '');
    this.dataDir = options?.dataDir ?? path.resolve(process.cwd(), 'data/paper');
    this.fetchFn = options?.fetchFn ?? fetch;
    this.nowFn = options?.nowFn ?? Date.now;
    this.maxRetries = options?.maxRetries ?? 1;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 200;
    this.sleepFn = options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Returns standard file path for raw JSONL candle storage:
   * data/paper/{symbol}_{tf}.jsonl
   */
  getFilePath(symbol: string, interval: CandleInterval): string {
    const cleanSym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return path.join(this.dataDir, `${cleanSym}_${interval}.jsonl`);
  }

  /**
   * Loads existing candles from JSONL file.
   * Returns empty array if file does not exist.
   */
  async loadLocalCandles(symbol: string, interval: CandleInterval): Promise<Candle[]> {
    const filePath = this.getFilePath(symbol, interval);
    try {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      const lines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const candles: Candle[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (isValidCandle(parsed)) {
            candles.push(parsed);
          }
        } catch {
          // Skip corrupt single lines
        }
      }

      return deduplicateCandles(sortCandles(candles));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to load paper candles from ${filePath}: ${(err as Error).message}`);
    }
  }

  /**
   * Atomically saves or updates the JSONL candle file.
   * Deduplicates and sorts chronologically before persisting.
   */
  async saveLocalCandles(
    symbol: string,
    interval: CandleInterval,
    candles: readonly Candle[]
  ): Promise<string> {
    const valid = candles.filter(isValidCandle);
    const sorted = deduplicateCandles(sortCandles(valid));
    const filePath = this.getFilePath(symbol, interval);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const lines = sorted.map((c) => JSON.stringify(c));
    const content = lines.length > 0 ? lines.join('\n') + '\n' : '';

    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);

    return filePath;
  }

  /**
   * Fetches raw klines from Binance with exponential backoff and retries.
   * Discards any candle that is not yet closed (closeTime > now).
   */
  async fetchRemoteKlines(params: {
    symbol: string;
    interval: CandleInterval;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<Candle[]> {
    const query = new URLSearchParams({
      symbol: params.symbol.toUpperCase(),
      interval: params.interval,
      limit: (params.limit ?? 1000).toString(),
    });

    if (params.startTime !== undefined) {
      query.set('startTime', params.startTime.toString());
    }
    if (params.endTime !== undefined) {
      query.set('endTime', params.endTime.toString());
    }

    const url = `${this.baseUrl}/api/v3/klines?${query.toString()}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(url);

        if (response.status === 429 || response.status >= 500) {
          const body = await response.text().catch(() => '');
          lastError = new Error(`Binance HTTP ${response.status}: ${body || response.statusText}`);
          if (attempt < this.maxRetries) {
            const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
            await this.sleepFn(delay);
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Binance HTTP ${response.status}: ${body || response.statusText}`);
        }

        const data = (await response.json()) as unknown;
        if (!Array.isArray(data)) {
          throw new Error('Invalid response format: expected array of kline rows');
        }

        return this.parseAndFilterClosedCandles(data);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
          await this.sleepFn(delay);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error('Failed to fetch remote klines after retries');
  }

  /**
   * Parses kline rows and enforces that only closed candles are returned.
   * Candidate candle is closed iff row[6] (closeTime) <= now.
   */
  parseAndFilterClosedCandles(rows: unknown[]): Candle[] {
    const now = this.nowFn();
    const result: Candle[] = [];

    for (const item of rows) {
      if (!Array.isArray(item) || item.length < 7) {
        continue;
      }

      const row = item as BinanceKlineRow;
      const openTime = Number(row[0]);
      const closeTime = Number(row[6]);

      // Strict closed check: if closeTime is in the future, candle is incomplete
      if (closeTime > now) {
        continue;
      }

      const candle: Candle = {
        timestamp: openTime,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      };

      if (isValidCandle(candle)) {
        result.push(candle);
      }
    }

    return deduplicateCandles(sortCandles(result));
  }

  /**
   * Detects internal gaps in candle sequence.
   * A gap is defined when candles[i].timestamp - candles[i-1].timestamp > 1.5 * intervalMs.
   */
  findGaps(candles: readonly Candle[], interval: CandleInterval): Array<{ start: number; end: number }> {
    const intervalMs = getIntervalMs(interval);
    const gaps: Array<{ start: number; end: number }> = [];

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const diff = curr.timestamp - prev.timestamp;

      if (diff > intervalMs * 1.5) {
        gaps.push({
          start: prev.timestamp + intervalMs,
          end: curr.timestamp - 1,
        });
      }
    }

    return gaps;
  }

  /**
   * Synchronizes data feed for a symbol and interval:
   * 1. Loads local candles from JSONL.
   * 2. Detects if storage is empty; if so, bootstraps initial historical batch.
   * 3. Detects internal gaps and fills them.
   * 4. Fetches newly closed candles from the last recorded timestamp up to now.
   * 5. Atomically saves the merged, deduplicated, sorted JSONL file.
   */
  async syncFeed(
    symbol: string,
    interval: CandleInterval,
    options?: { minHistoricalCandles?: number }
  ): Promise<Candle[]> {
    const intervalMs = getIntervalMs(interval);
    const now = this.nowFn();
    const targetMin = options?.minHistoricalCandles ?? 500;

    let candles = await this.loadLocalCandles(symbol, interval);

    // 1. Initial bootstrap if local storage is empty
    if (candles.length === 0) {
      try {
        const fetched = await this.fetchRemoteKlines({
          symbol,
          interval,
          limit: Math.min(targetMin, 1000),
          endTime: now,
        });
        candles = deduplicateCandles(sortCandles(fetched));
      } catch (err) {
        // Fallback to local historical data cache if network is offline or blocked
        const cleanSym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const fallbackPath = path.resolve(process.cwd(), 'data', `${cleanSym}_${interval}.json`);
        try {
          const raw = await fs.readFile(fallbackPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            candles = deduplicateCandles(sortCandles(parsed.slice(-targetMin)));
          }
        } catch {
          throw err;
        }
      }
    }

    // 2. Detect and fill any internal gaps
    try {
      let gaps = this.findGaps(candles, interval);
      for (const gap of gaps) {
        let cursor = gap.start;
        while (cursor <= gap.end) {
          const batch = await this.fetchRemoteKlines({
            symbol,
            interval,
            startTime: cursor,
            endTime: gap.end,
            limit: 1000,
          });

          if (batch.length === 0) {
            break;
          }

          candles = deduplicateCandles(sortCandles([...candles, ...batch]));
          const lastBatchCandle = batch[batch.length - 1];
          if (lastBatchCandle.timestamp + intervalMs <= cursor) {
            break;
          }
          cursor = lastBatchCandle.timestamp + intervalMs;
        }
      }

      // 3. Catch up from the latest candle to current time
      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        let cursor = lastCandle.timestamp + intervalMs;

        // Only fetch if at least one full candle duration has elapsed
        while (cursor + intervalMs - 1 <= now) {
          const batch = await this.fetchRemoteKlines({
            symbol,
            interval,
            startTime: cursor,
            endTime: now,
            limit: 1000,
          });

          if (batch.length === 0) {
            break;
          }

          const prevLen = candles.length;
          candles = deduplicateCandles(sortCandles([...candles, ...batch]));

          // If no new candles were added, stop pagination
          if (candles.length === prevLen) {
            break;
          }

          const lastBatchCandle = batch[batch.length - 1];
          const nextCursor = lastBatchCandle.timestamp + intervalMs;
          if (nextCursor <= cursor) {
            break;
          }
          cursor = nextCursor;

          if (batch.length < 1000) {
            break;
          }
        }
      }
    } catch (networkErr) {
      // When offline or firewalled, proceed with available cached/seeded candles
    }

    // 4. Save and return synchronized candles
    await this.saveLocalCandles(symbol, interval, candles);
    return candles;
  }

  /**
   * Synchronizes primary timeframe and all required higher timeframes (HTF: 1h, 4h, 1d).
   */
  async syncMarketFeeds(
    symbol: string,
    intervals: CandleInterval[] = ['1h', '4h', '1d']
  ): Promise<Record<CandleInterval, Candle[]>> {
    const result: Partial<Record<CandleInterval, Candle[]>> = {};

    for (const interval of intervals) {
      result[interval] = await this.syncFeed(symbol, interval);
    }

    return result as Record<CandleInterval, Candle[]>;
  }
}
