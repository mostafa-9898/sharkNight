import { KucoinPublicProvider } from '../data/providers/kucoin-public';
import { JsonStorage } from '../data/storage/json-storage';
import type { CandleInterval } from '../data/models/candle';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const INTERVALS: CandleInterval[] = ['4h', '1h', '15m', '5m', '1m'];

// Estimated 1-year candle targets
const TARGETS_1_YEAR: Record<CandleInterval, number> = {
  '4h': 2200,     // 365 * 6 = 2190
  '1h': 8800,     // 365 * 24 = 8760
  '15m': 35100,   // 365 * 96 = 35040
  '5m': 105200,   // 365 * 288 = 105120
  '1m': 15000,    // 1m is very large, download initial 15k (~10 days) or full
  '30m': 17600,
  '1d': 365,
  '1w': 52,
};

async function download() {
  console.log('====================================================');
  console.log('  TradeBot - Historical Market Data Downloader (1 Year)');
  console.log('====================================================\n');

  const provider = new KucoinPublicProvider();
  const storage = new JsonStorage();

  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

  for (const symbol of SYMBOLS) {
    for (const interval of INTERVALS) {
      if (await storage.hasCandles(symbol, interval)) {
        const existing = await storage.loadCandles(symbol, interval);
        if (existing && existing.length >= 1000) {
          console.log(`  ✔ Already downloaded (${existing.length.toLocaleString()} candles cached). Skipping.\n`);
          continue;
        }
      }

      const targetLimit = TARGETS_1_YEAR[interval];
      console.log(`[Fetching] ${symbol} | ${interval} (Target: ~${targetLimit.toLocaleString()} candles)...`);

      const startTime = Date.now();
      try {
        const candles = await provider.fetchCandles({
          symbol,
          interval,
          startTime: oneYearAgo,
          endTime: now,
          limit: targetLimit,
        });

        if (candles.length > 0) {
          const filePath = await storage.saveCandles(symbol, interval, candles);
          const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `  ✔ Saved ${candles.length.toLocaleString()} candles to ${filePath} (${elapsedSec}s)\n`
          );
        } else {
          console.log(`  ⚠ No candles returned for ${symbol} ${interval}\n`);
        }
      } catch (err) {
        console.error(`  ❌ Failed to download ${symbol} ${interval}: ${(err as Error).message}\n`);
      }
    }
  }

  console.log('All historical downloads completed successfully!');
}

download().catch(console.error);

