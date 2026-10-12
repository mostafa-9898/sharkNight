import { KucoinPublicProvider } from '../data/providers/kucoin-public';
import { BinancePublicProvider } from '../data/providers/binance-public';
import { JsonStorage } from '../data/storage/json-storage';
import {
  getIntervalMs,
  performCandleSanityCheck,
  type CandleInterval,
  type Candle,
} from '../data/models/candle';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let symbols = ['BTCUSDT', 'ETHUSDT'];
  let intervals: CandleInterval[] = ['1h', '4h'];
  let years = 2;

  for (const arg of args) {
    if (arg.startsWith('--symbols=')) {
      symbols = arg.slice('--symbols='.length).split(',').map((s) => s.trim().toUpperCase());
    } else if (arg.startsWith('--intervals=')) {
      intervals = arg.slice('--intervals='.length).split(',').map((i) => i.trim() as CandleInterval);
    } else if (arg.startsWith('--years=')) {
      const val = parseFloat(arg.slice('--years='.length));
      if (!isNaN(val) && val > 0) {
        years = val;
      }
    }
  }

  return { symbols, intervals, years };
}

async function download() {
  const { symbols, intervals, years } = parseArgs();

  console.log('====================================================');
  console.log(`  TradeBot - Historical Market Data Downloader (${years} Years)`);
  console.log(`  Symbols:   ${symbols.join(', ')}`);
  console.log(`  Intervals: ${intervals.join(', ')}`);
  console.log('====================================================\n');

  const kucoin = new KucoinPublicProvider();
  const binance = new BinancePublicProvider();
  const storage = new JsonStorage();

  const now = Date.now();
  const requestedStartTime = now - Math.round(years * 365.25 * 24 * 60 * 60 * 1000);
  const requestedSpan = now - requestedStartTime;

  for (const symbol of symbols) {
    for (const interval of intervals) {
      const intervalMs = getIntervalMs(interval);
      const expectedCandles = Math.ceil(requestedSpan / intervalMs);

      // Check existing cache coverage
      if (await storage.hasCandles(symbol, interval)) {
        const existing = await storage.loadCandles(symbol, interval);
        if (existing && existing.length > 0) {
          const firstCandle = existing[0];
          const lastCandle = existing[existing.length - 1];
          const cachedSpan = lastCandle.timestamp - firstCandle.timestamp;

          // Coverage check: must cover at least requested span minus one interval and have >= 85% of expected candles
          const coversRequestedSpan = cachedSpan >= requestedSpan - intervalMs;
          const hasSufficientCount = existing.length >= Math.floor(expectedCandles * 0.85);

          if (coversRequestedSpan && hasSufficientCount) {
            const sanity = performCandleSanityCheck(existing, interval);
            console.log(
              `  ✔ ${symbol} ${interval}: Already cached with full coverage (${existing.length.toLocaleString()} candles).`
            );
            console.log(
              `    Span: ${new Date(sanity.firstTimestamp!).toISOString()} -> ${new Date(sanity.lastTimestamp!).toISOString()}`
            );
            console.log(
              `    Close range: $${sanity.minClose} - $${sanity.maxClose} | Gaps (>1.5x interval): ${sanity.gapCount}\n`
            );
            continue;
          } else {
            console.log(
              `  ℹ ${symbol} ${interval}: Existing cache has insufficient coverage (${existing.length.toLocaleString()} / ~${expectedCandles.toLocaleString()} candles). Refetching full ${years}-year history...`
            );
          }
        }
      }

      console.log(`[Fetching] ${symbol} | ${interval} (Target: ~${expectedCandles.toLocaleString()} candles)...`);
      const fetchStart = Date.now();

      let candles: Candle[] | null = null;
      let usedProvider = '';

      // 1. Try KuCoin first (KuCoin is often accessible from regions where Binance is geo-blocked)
      try {
        candles = await kucoin.fetchCandles({
          symbol,
          interval,
          startTime: requestedStartTime,
          endTime: now,
          limit: expectedCandles,
        });
        if (candles && candles.length > 0) {
          usedProvider = 'KuCoin';
        }
      } catch (err) {
        console.log(`    KuCoin fetch failed: ${(err as Error).message}. Trying Binance...`);
      }

      // 2. If KuCoin failed, try Binance
      if (!candles || candles.length === 0) {
        try {
          candles = await binance.fetchCandles({
            symbol,
            interval,
            startTime: requestedStartTime,
            endTime: now,
            limit: expectedCandles,
          });
          if (candles && candles.length > 0) {
            usedProvider = 'Binance';
          }
        } catch (err) {
          console.log(`    Binance fetch failed: ${(err as Error).message}`);
        }
      }

      if (candles && candles.length > 0) {
        const filePath = await storage.saveCandles(symbol, interval, candles);
        const elapsedSec = ((Date.now() - fetchStart) / 1000).toFixed(1);
        const sanity = performCandleSanityCheck(candles, interval);

        console.log(
          `  ✔ Saved ${candles.length.toLocaleString()} candles via ${usedProvider} to ${filePath} (${elapsedSec}s)`
        );
        console.log(
          `    Span: ${new Date(sanity.firstTimestamp!).toISOString()} -> ${new Date(sanity.lastTimestamp!).toISOString()}`
        );
        console.log(
          `    Close range: $${sanity.minClose} - $${sanity.maxClose} | Gaps (>1.5x interval): ${sanity.gapCount}\n`
        );
      } else {
        console.error(
          `  ❌ Failed to download ${symbol} ${interval}: Both KuCoin and Binance returned no data. Check internet/network connectivity.\n`
        );
      }
    }
  }

  console.log('Historical download run finished.');
}

download().catch(console.error);
