import * as fs from 'fs/promises';
import * as path from 'path';
import type { Candle, CandleInterval } from '../models';
import { areValidCandles, deduplicateCandles, sortCandles } from '../models';

export interface JsonStorageOptions {
  baseDir?: string;
}

export class JsonStorage {
  readonly baseDir: string;

  constructor(options?: JsonStorageOptions) {
    this.baseDir = options?.baseDir ?? path.resolve(process.cwd(), 'data');
  }

  /**
   * Generates the file path for a symbol and interval pair.
   */
  getFilePath(symbol: string, interval: CandleInterval): string {
    const sanitizedSymbol = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const filename = `${sanitizedSymbol}_${interval}.json`;
    return path.join(this.baseDir, filename);
  }

  /**
   * Checks whether cached data exists on disk.
   */
  async hasCandles(symbol: string, interval: CandleInterval): Promise<boolean> {
    const filePath = this.getFilePath(symbol, interval);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads candles from JSON storage. Returns null if file does not exist.
   */
  async loadCandles(symbol: string, interval: CandleInterval): Promise<Candle[] | null> {
    const filePath = this.getFilePath(symbol, interval);
    try {
      const rawContent = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(rawContent) as unknown;

      if (!areValidCandles(parsed)) {
        return null;
      }

      return sortCandles(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new Error(`Failed to load candles from ${filePath}: ${(err as Error).message}`);
    }
  }

  /**
   * Saves candles to JSON storage.
   * If existing candles exist for the symbol/interval, merges and deduplicates them.
   */
  async saveCandles(
    symbol: string,
    interval: CandleInterval,
    newCandles: Candle[]
  ): Promise<string> {
    if (!areValidCandles(newCandles)) {
      throw new Error('Invalid candle data provided to saveCandles');
    }

    const filePath = this.getFilePath(symbol, interval);
    await fs.mkdir(this.baseDir, { recursive: true });

    let combined = [...newCandles];
    const existing = await this.loadCandles(symbol, interval);
    if (existing && existing.length > 0) {
      combined = deduplicateCandles([...existing, ...newCandles]);
    } else {
      combined = deduplicateCandles(combined);
    }

    const jsonContent = JSON.stringify(combined, null, 2);
    await fs.writeFile(filePath, jsonContent, 'utf-8');

    return filePath;
  }

  /**
   * Deletes cached candles file. Returns true if deleted, false if file did not exist.
   */
  async deleteCandles(symbol: string, interval: CandleInterval): Promise<boolean> {
    const filePath = this.getFilePath(symbol, interval);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }
}

