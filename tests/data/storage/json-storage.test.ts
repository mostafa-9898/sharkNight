import * as fs from 'fs/promises';
import * as path from 'path';
import { JsonStorage } from '@/data/storage/json-storage';
import type { Candle } from '@/data/models/candle';

describe('JsonStorage', () => {
  const testDir = path.join(__dirname, '..', '..', '..', 'tests-data-tmp');
  let storage: JsonStorage;

  const sampleCandles: Candle[] = [
    {
      timestamp: 1600000000000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 10,
    },
    {
      timestamp: 1600000060000,
      open: 105,
      high: 115,
      low: 100,
      close: 110,
      volume: 15,
    },
  ];

  beforeAll(async () => {
    storage = new JsonStorage({ baseDir: testDir });
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error if already removed
    }
  });

  it('should generate expected sanitized file path', () => {
    const filePath = storage.getFilePath('btc/usdt', '1h');
    expect(filePath).toBe(path.join(testDir, 'BTCUSDT_1h.json'));
  });

  it('should return null and false when no cache exists', async () => {
    const exists = await storage.hasCandles('ETHUSDT', '15m');
    expect(exists).toBe(false);

    const loaded = await storage.loadCandles('ETHUSDT', '15m');
    expect(loaded).toBeNull();
  });

  it('should save candles and create file on disk', async () => {
    const savedPath = await storage.saveCandles('BTCUSDT', '1h', sampleCandles);
    expect(savedPath).toBe(path.join(testDir, 'BTCUSDT_1h.json'));

    const exists = await storage.hasCandles('BTCUSDT', '1h');
    expect(exists).toBe(true);

    const loaded = await storage.loadCandles('BTCUSDT', '1h');
    expect(loaded).toEqual(sampleCandles);
  });

  it('should merge new candles with existing cached candles without duplicates', async () => {
    const newCandles: Candle[] = [
      // Duplicate of index 1 with updated close
      {
        timestamp: 1600000060000,
        open: 105,
        high: 120,
        low: 100,
        close: 118,
        volume: 25,
      },
      // Completely new candle
      {
        timestamp: 1600000120000,
        open: 118,
        high: 125,
        low: 115,
        close: 122,
        volume: 30,
      },
    ];

    await storage.saveCandles('BTCUSDT', '1h', newCandles);

    const merged = await storage.loadCandles('BTCUSDT', '1h');
    expect(merged).not.toBeNull();
    expect(merged).toHaveLength(3);
    // Updated candle value checked
    expect(merged![1].close).toBe(118);
    // New candle checked
    expect(merged![2].close).toBe(122);
  });

  it('should throw an error when saving invalid candle data', async () => {
    const invalidData = [{ timestamp: -1, open: 100 }] as unknown as Candle[];
    await expect(storage.saveCandles('BTCUSDT', '1h', invalidData)).rejects.toThrow(
      'Invalid candle data provided to saveCandles'
    );
  });

  it('should delete cached file cleanly', async () => {
    const deleted = await storage.deleteCandles('BTCUSDT', '1h');
    expect(deleted).toBe(true);

    const existsAfter = await storage.hasCandles('BTCUSDT', '1h');
    expect(existsAfter).toBe(false);

    // Deleting non-existent file returns false
    const deleteAgain = await storage.deleteCandles('BTCUSDT', '1h');
    expect(deleteAgain).toBe(false);
  });
});

