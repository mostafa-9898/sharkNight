import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { JsonStorage } from '../data/storage/json-storage';
import type { CandleInterval } from '../data/models/candle';

const gzip = promisify(zlib.gzip);

interface TargetConfig {
  symbol: string;
  interval: CandleInterval;
}

interface ManifestEntry {
  symbol: string;
  interval: CandleInterval;
  rows: number;
  firstTimestamp: number;
  lastTimestamp: number;
  sha256: string;
}

interface FileSummary {
  filename: string;
  rows: number;
  sizeKb: string;
}

const TARGETS: TargetConfig[] = [
  { symbol: 'BTCUSDT', interval: '1h' },
  { symbol: 'BTCUSDT', interval: '4h' },
  { symbol: 'BTCUSDT', interval: '1d' },
  { symbol: 'ETHUSDT', interval: '1h' },
  { symbol: 'ETHUSDT', interval: '4h' },
  { symbol: 'ETHUSDT', interval: '1d' },
  { symbol: 'BTCUSDT', interval: '15m' },
  { symbol: 'ETHUSDT', interval: '15m' },
  { symbol: 'BTCUSDT', interval: '5m' },
  { symbol: 'ETHUSDT', interval: '5m' },
  { symbol: 'BTCUSDT', interval: '1m' },
  { symbol: 'ETHUSDT', interval: '1m' },
];

async function main(): Promise<void> {
  const storage = new JsonStorage();
  const outputDir = path.resolve(process.cwd(), 'docs', 'review', 'data');
  await fs.mkdir(outputDir, { recursive: true });

  const manifest: ManifestEntry[] = [];
  const summaries: FileSummary[] = [];

  for (const target of TARGETS) {
    const filenameBase = `${target.symbol}_${target.interval}`;
    const gzFilename = `${filenameBase}.csv.gz`;
    const gzFilePath = path.join(outputDir, gzFilename);

    let candles;
    try {
      candles = await storage.loadCandles(target.symbol, target.interval);
    } catch (err) {
      console.warn(`Warning: Failed to load ${target.symbol}_${target.interval}: ${(err as Error).message}`);
      continue;
    }

    if (!candles || candles.length === 0) {
      console.warn(`Warning: Candle data for ${target.symbol}_${target.interval} not found. Skipping.`);
      continue;
    }

    // Sort ascending by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);

    const rowsCount = candles.length;
    const firstTimestamp = candles[0].timestamp;
    const lastTimestamp = candles[candles.length - 1].timestamp;

    // Build CSV with exact header: timestamp,open,high,low,close,volume
    const lines = ['timestamp,open,high,low,close,volume'];
    for (const c of candles) {
      lines.push(`${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`);
    }
    const csvContent = lines.join('\n') + '\n';

    // Calculate sha256 from uncompressed CSV
    const sha256 = crypto.createHash('sha256').update(csvContent, 'utf-8').digest('hex');

    // Compress CSV with gzip
    const uncompressedBuffer = Buffer.from(csvContent, 'utf-8');
    const compressedBuffer = await gzip(uncompressedBuffer);

    // Save to docs/review/data/
    await fs.writeFile(gzFilePath, compressedBuffer);

    // Append manifest entry
    manifest.push({
      symbol: target.symbol,
      interval: target.interval,
      rows: rowsCount,
      firstTimestamp,
      lastTimestamp,
      sha256,
    });

    const sizeKb = (compressedBuffer.length / 1024).toFixed(2);
    summaries.push({
      filename: gzFilename,
      rows: rowsCount,
      sizeKb,
    });
  }

  // Write docs/review/data/MANIFEST.json
  const manifestPath = path.join(outputDir, 'MANIFEST.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  // Print summary line for each file
  for (const s of summaries) {
    console.log(`${s.filename}: ${s.rows} rows, ${s.sizeKb} KB`);
  }
}

main().catch((err) => {
  console.error('Fatal error during export:', err);
  process.exit(1);
});

