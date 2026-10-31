import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PaperDataFeed } from '../../src/paper/feed';
import type { Candle } from '../../src/data/models/candle';

describe('PaperDataFeed (PT1)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-feed-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('strictly discards unclosed candles (closeTime > now)', () => {
    const fixedNow = 1_700_000_000_000;
    const feed = new PaperDataFeed({
      dataDir: tempDir,
      nowFn: () => fixedNow,
    });

    // Mock Binance kline rows:
    // [openTime, open, high, low, close, volume, closeTime, ...]
    const rows = [
      // 1. Fully closed candle
      [fixedNow - 7_200_000, '100', '105', '95', '102', '10', fixedNow - 3_600_001, '0', 1, '0', '0', '0'],
      // 2. Fully closed candle just finished
      [fixedNow - 3_600_000, '102', '108', '101', '107', '15', fixedNow - 1, '0', 1, '0', '0', '0'],
      // 3. Unclosed candle (active right now, closeTime in future)
      [fixedNow, '107', '112', '106', '110', '20', fixedNow + 3_599_999, '0', 1, '0', '0', '0'],
    ];

    const closed = feed.parseAndFilterClosedCandles(rows);
    expect(closed).toHaveLength(2);
    expect(closed[0].timestamp).toBe(fixedNow - 7_200_000);
    expect(closed[1].timestamp).toBe(fixedNow - 3_600_000);
  });

  it('detects and fills internal gaps in candle stream', async () => {
    const intervalMs = 3_600_000; // 1h
    const t0 = 1_700_000_000_000;
    const now = t0 + 5 * intervalMs;

    // Suppose local candles has t0 and t0 + 3*interval (missing t0+1h and t0+2h)
    const initialCandles: Candle[] = [
      { timestamp: t0, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { timestamp: t0 + 3 * intervalMs, open: 110, high: 115, low: 108, close: 112, volume: 12 },
    ];

    // Create mock fetch handler
    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      const parsedUrl = new URL(urlStr);
      const startTime = Number(parsedUrl.searchParams.get('startTime') ?? '0');
      const endTime = Number(parsedUrl.searchParams.get('endTime') ?? '0');

      const mockRows: any[] = [];
      // Generate candles in requested range
      for (let t = t0; t <= now; t += intervalMs) {
        if (t >= startTime && t <= endTime && t + intervalMs - 1 <= now) {
          mockRows.push([
            t,
            '100',
            '105',
            '95',
            '102',
            '10',
            t + intervalMs - 1,
            '0',
            1,
            '0',
            '0',
            '0',
          ]);
        }
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockRows,
        text: async () => JSON.stringify(mockRows),
      } as Response;
    });

    const feed = new PaperDataFeed({
      dataDir: tempDir,
      nowFn: () => now,
      fetchFn: mockFetch as any,
    });

    // Save initial gapped candles to disk
    await feed.saveLocalCandles('BTCUSDT', '1h', initialCandles);

    // Sync feed
    const synced = await feed.syncFeed('BTCUSDT', '1h');

    // Should have 5 consecutive candles: t0, t0+1h, t0+2h, t0+3h, t0+4h
    expect(synced.length).toBe(5);
    for (let i = 0; i < synced.length; i++) {
      expect(synced[i].timestamp).toBe(t0 + i * intervalMs);
    }

    // Verify gaps are completely resolved
    const remainingGaps = feed.findGaps(synced, '1h');
    expect(remainingGaps).toHaveLength(0);
  });

  it('guarantees strict chronological ordering and deduplication', async () => {
    const fixedNow = 1_700_050_000_000;
    const feed = new PaperDataFeed({
      dataDir: tempDir,
      nowFn: () => fixedNow,
    });

    // Out-of-order and duplicated klines
    const rawRows = [
      [1_700_020_000_000, '20', '25', '19', '22', '5', 1_700_023_599_999, '0', 1, '0', '0', '0'],
      [1_700_010_000_000, '10', '15', '9', '12', '5', 1_700_013_599_999, '0', 1, '0', '0', '0'],
      [1_700_020_000_000, '20', '25', '19', '22', '5', 1_700_023_599_999, '0', 1, '0', '0', '0'], // duplicate
      [1_700_030_000_000, '30', '35', '29', '32', '5', 1_700_033_599_999, '0', 1, '0', '0', '0'],
    ];

    const candles = feed.parseAndFilterClosedCandles(rawRows);
    expect(candles).toHaveLength(3);
    expect(candles[0].timestamp).toBe(1_700_010_000_000);
    expect(candles[1].timestamp).toBe(1_700_020_000_000);
    expect(candles[2].timestamp).toBe(1_700_030_000_000);
  });

  it('is completely idempotent on repeated sync (no duplicates written)', async () => {
    const intervalMs = 3_600_000;
    const t0 = 1_700_000_000_000;
    const now = t0 + 3 * intervalMs;

    const mockRows = [
      [t0, '100', '105', '95', '101', '10', t0 + intervalMs - 1, '0', 1, '0', '0', '0'],
      [t0 + intervalMs, '101', '106', '96', '103', '10', t0 + 2 * intervalMs - 1, '0', 1, '0', '0', '0'],
    ];

    const mockFetch = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => mockRows,
        text: async () => JSON.stringify(mockRows),
      } as Response;
    });

    const feed = new PaperDataFeed({
      dataDir: tempDir,
      nowFn: () => now,
      fetchFn: mockFetch as any,
    });

    // First sync
    const firstResult = await feed.syncFeed('ETHUSDT', '1h');
    expect(firstResult).toHaveLength(2);

    // Read stored file
    const filePath = feed.getFilePath('ETHUSDT', '1h');
    const contentFirst = await fs.readFile(filePath, 'utf-8');
    const linesFirst = contentFirst.trim().split('\n');
    expect(linesFirst).toHaveLength(2);

    // Second sync with exact same data
    const secondResult = await feed.syncFeed('ETHUSDT', '1h');
    expect(secondResult).toHaveLength(2);

    const contentSecond = await fs.readFile(filePath, 'utf-8');
    const linesSecond = contentSecond.trim().split('\n');
    expect(linesSecond).toHaveLength(2);
    expect(contentSecond).toBe(contentFirst);
  });

  it('retries with exponential backoff on HTTP 429 / 500 errors', async () => {
    let callCount = 0;
    const mockSleep = jest.fn(async () => {});
    const now = 1_700_010_000_000;

    const mockFetch = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => 'Rate limit exceeded',
        } as Response;
      }
      if (callCount === 2) {
        return {
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          text: async () => 'Server temporarily unavailable',
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [
          [1_700_000_000_000, '50', '55', '48', '52', '10', 1_700_003_599_999, '0', 1, '0', '0', '0'],
        ],
        text: async () => '',
      } as Response;
    });

    const feed = new PaperDataFeed({
      dataDir: tempDir,
      nowFn: () => now,
      fetchFn: mockFetch as any,
      sleepFn: mockSleep,
      maxRetries: 3,
      retryBaseDelayMs: 50,
    });

    const candles = await feed.fetchRemoteKlines({ symbol: 'BTCUSDT', interval: '1h' });
    expect(candles).toHaveLength(1);
    expect(callCount).toBe(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenNthCalledWith(1, 50);
    expect(mockSleep).toHaveBeenNthCalledWith(2, 100);
  });

  it('synchronizes multiple HTF feeds (1h, 4h, 1d) via syncMarketFeeds', async () => {
    const t0 = 1_700_000_000_000;
    const now = t0 + 24 * 3_600_000;

    const mockFetch = jest.fn(async (url: string | URL | Request) => {
      const parsedUrl = new URL(url.toString());
      const interval = parsedUrl.searchParams.get('interval') ?? '1h';

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => [
          [t0, '100', '110', '90', '105', '50', t0 + 3_599_999, '0', 1, '0', '0', '0'],
        ],
        text: async () => '',
      } as Response;
    });

    const feed = new PaperDataFeed({
      dataDir: tempDir,
      nowFn: () => now,
      fetchFn: mockFetch as any,
    });

    const multi = await feed.syncMarketFeeds('BTCUSDT', ['1h', '4h', '1d']);
    expect(multi['1h']).toBeDefined();
    expect(multi['4h']).toBeDefined();
    expect(multi['1d']).toBeDefined();

    // Verify files were created
    await expect(fs.access(feed.getFilePath('BTCUSDT', '1h'))).resolves.toBeUndefined();
    await expect(fs.access(feed.getFilePath('BTCUSDT', '4h'))).resolves.toBeUndefined();
    await expect(fs.access(feed.getFilePath('BTCUSDT', '1d'))).resolves.toBeUndefined();
  });

  it('honors PAPER_BASE_URL environment variable and defaults to public data-api endpoint', () => {
    const defaultFeed = new PaperDataFeed({ dataDir: tempDir });
    expect(defaultFeed.baseUrl).toBe('https://data-api.binance.vision');

    const originalEnv = process.env.PAPER_BASE_URL;
    try {
      process.env.PAPER_BASE_URL = 'https://api.binance.me';
      const envFeed = new PaperDataFeed({ dataDir: tempDir });
      expect(envFeed.baseUrl).toBe('https://api.binance.me');
    } finally {
      process.env.PAPER_BASE_URL = originalEnv;
    }
  });

  it('throws clear descriptive error advising PAPER_BASE_URL on HTTP 403 / 451 geo-restriction', async () => {
    for (const code of [403, 451]) {
      const mockFetch = jest.fn(async () => {
        return {
          ok: false,
          status: code,
          statusText: code === 403 ? 'Forbidden' : 'Unavailable For Legal Reasons',
          text: async () => 'Service unavailable from your jurisdiction',
        } as Response;
      });

      const feed = new PaperDataFeed({
        dataDir: tempDir,
        fetchFn: mockFetch as any,
        maxRetries: 0,
      });

      await expect(
        feed.fetchRemoteKlines({ symbol: 'BTCUSDT', interval: '1h' })
      ).rejects.toThrow(/Access Denied \/ Geo-restricted.*PAPER_BASE_URL/);
    }
  });
});

