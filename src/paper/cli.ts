import * as path from 'path';
import { PaperDataFeed } from './feed';
import { PaperRunner } from './runner';
import { PaperReporter, PAPER_MARKETS } from './report';
import type { CandleInterval } from '../data/models/candle';

export interface PaperCliOptions {
  dataDir?: string;
  outputDir?: string;
  watchMode?: boolean;
  intervalMs?: number;
  verbose?: boolean;
}

export async function runPaperCycle(options?: PaperCliOptions): Promise<{
  reportPath: string;
  summaryA: any;
  summaryB: any;
}> {
  const dataDir = options?.dataDir ?? path.resolve(process.cwd(), 'data/paper');
  const outputDir = options?.outputDir ?? path.resolve(process.cwd(), 'docs/paper');
  const verbose = options?.verbose ?? true;

  const feed = new PaperDataFeed({ dataDir });
  const runner = new PaperRunner({ dataDir });
  const reporter = new PaperReporter({ dataDir });

  if (verbose) {
    console.log(`[PaperTrading] Starting cycle at ${new Date().toISOString()}...`);
  }

  // 1. Sync public data feeds for all 4 markets and higher timeframes
  const candleMap: Record<string, any[]> = {};
  for (const m of PAPER_MARKETS) {
    if (verbose) {
      console.log(`[PaperTrading] Syncing public closed candles for ${m.symbol} ${m.interval}...`);
    }
    const candles = await feed.syncFeed(m.symbol, m.interval);
    candleMap[`${m.symbol}_${m.interval}`] = candles;
  }

  // Also sync 4h for HTF strict filter if running 1h
  for (const sym of ['BTCUSDT', 'ETHUSDT']) {
    if (!candleMap[`${sym}_4h`]) {
      const candles4h = await feed.syncFeed(sym, '4h' as CandleInterval);
      candleMap[`${sym}_4h`] = candles4h;
    }
  }

  // 2. Process Book A and Book B for each market
  for (const book of ['A', 'B'] as const) {
    for (const m of PAPER_MARKETS) {
      const candles = candleMap[`${m.symbol}_${m.interval}`];
      const htf4h = candleMap[`${m.symbol}_4h`];

      if (candles && candles.length > 0) {
        await runner.processCandles({
          book,
          symbol: m.symbol,
          interval: m.interval,
          candles,
          htf4hCandles: htf4h,
          closePositionsAtEnd: false,
        });
      }
    }
  }

  // 3. Generate latest Markdown report
  const { filePath } = await reporter.generateMarkdownReport({
    outputDir,
    candlesMap: candleMap,
  });

  const [bookA, bookB] = await Promise.all([
    reporter.aggregateBook('A'),
    reporter.aggregateBook('B'),
  ]);

  if (verbose) {
    console.log(`[PaperTrading] Cycle completed successfully.`);
    console.log(
      `   Book A: Equity \$${bookA.summary.currentEquity}, Ret ${bookA.summary.totalReturnPercent}%, DD ${bookA.summary.maxDrawdownPercent}%, Trades ${bookA.summary.totalTrades}, Open ${bookA.summary.openPositionsCount}`
    );
    console.log(
      `   Book B: Equity \$${bookB.summary.currentEquity}, Ret ${bookB.summary.totalReturnPercent}%, DD ${bookB.summary.maxDrawdownPercent}%, Trades ${bookB.summary.totalTrades}, Open ${bookB.summary.openPositionsCount}`
    );
    console.log(`   Report updated at: ${filePath}`);
  }

  return {
    reportPath: filePath,
    summaryA: bookA.summary,
    summaryB: bookB.summary,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isWatch = args.includes('--watch') || args.includes('-w');
  const isOnce = args.includes('--once') || !isWatch;

  // Polling interval in ms (default: 5 minutes = 300,000 ms)
  let intervalMs = 5 * 60 * 1000;
  const intervalArgIdx = args.findIndex((a) => a === '--interval' || a === '-i');
  if (intervalArgIdx >= 0 && args[intervalArgIdx + 1]) {
    const parsedSec = Number(args[intervalArgIdx + 1]);
    if (!isNaN(parsedSec) && parsedSec > 0) {
      intervalMs = parsedSec * 1000;
    }
  }

  if (isOnce) {
    await runPaperCycle();
    process.exit(0);
  }

  if (isWatch) {
    console.log(`[PaperTrading] Daemon running in watch mode (poll every ${intervalMs / 1000}s). Press Ctrl+C to terminate.`);
    await runPaperCycle();

    const timer = setInterval(async () => {
      try {
        await runPaperCycle();
      } catch (err) {
        console.error('[PaperTrading] Error during execution cycle:', err);
      }
    }, intervalMs);

    const shutdown = () => {
      console.log('\n[PaperTrading] Gracefully shutting down...');
      clearInterval(timer);
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[PaperTrading] Fatal error:', err);
    process.exit(1);
  });
}

