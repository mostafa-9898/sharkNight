import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { BacktestEngine } from '../backtest/engine';
import { MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import type { Candle } from '../data/models';
import { roundTo } from '../utils/math';

const gunzip = promisify(zlib.gunzip);

interface FilterConfig {
  name: string;
  kijunSlopeFilter: boolean;
  structureFilter: boolean;
}

interface RunResult {
  symbol: string;
  interval: string;
  positionSizePercent: number;
  exitName: string;
  configName: string;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  h1ReturnPercent: number;
  h2ReturnPercent: number;
  returnWithoutBestPercent: number;
  avgHoldingHours: number;
}

async function loadGzCandles(filePath: string): Promise<Candle[]> {
  const compressed = await fs.readFile(filePath);
  const uncompressed = await gunzip(compressed);
  const text = uncompressed.toString('utf-8');
  const lines = text.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [timestamp, open, high, low, close, volume] = line.split(',');
    candles.push({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
}

const CONFIGURATIONS: FilterConfig[] = [
  { name: 'base', kijunSlopeFilter: false, structureFilter: false },
  { name: '+kijunSlope', kijunSlopeFilter: true, structureFilter: false },
  { name: '+structure', kijunSlopeFilter: false, structureFilter: true },
  { name: '+هر دو', kijunSlopeFilter: true, structureFilter: true },
];

async function main(): Promise<void> {
  const dataDir = path.resolve(process.cwd(), 'docs', 'review', 'data');
  const symbols = ['BTC', 'ETH'] as const;
  const intervals = ['15m', '1h', '4h'] as const;
  const sizes = [10, 20] as const;

  console.log('Loading dataset candles from docs/review/data...');
  const candleData: Record<string, { '15m': Candle[]; '1h': Candle[]; '4h': Candle[] }> = {};

  for (const sym of symbols) {
    const pair = `${sym}USDT`;
    console.log(`Loading ${pair} (15m, 1h, 4h)...`);
    const [c15, c1h, c4h] = await Promise.all([
      loadGzCandles(path.join(dataDir, `${pair}_15m.csv.gz`)),
      loadGzCandles(path.join(dataDir, `${pair}_1h.csv.gz`)),
      loadGzCandles(path.join(dataDir, `${pair}_4h.csv.gz`)),
    ]);
    candleData[sym] = { '15m': c15, '1h': c1h, '4h': c4h };
    console.log(`Loaded ${pair}: 15m=${c15.length}, 1h=${c1h.length}, 4h=${c4h.length}`);
  }

  const exitModes = [
    {
      id: 'trailing',
      name: 'Trailing 3/3/1.5 (trailingOnly)',
      engineConfig: {
        exitMode: 'trailingOnly' as const,
        trailingStop: {
          initialStopPercent: 3,
          stepPercent: 3,
          raisePercent: 1.5,
        },
      },
    },
    {
      id: 'reverse',
      name: 'Stop 3% + Reverse',
      engineConfig: {
        stopLossPercent: 3,
        exitMode: 'reverse' as const,
      },
    },
  ];

  const results: RunResult[] = [];
  const engine = new BacktestEngine();
  const initialBalance = 10000;
  const tradeFeePercent = 0.1;

  console.log(`\nRunning comprehensive A/B Matrix (${symbols.length} symbols × ${intervals.length} timeframes × ${sizes.length} sizes × ${exitModes.length} exits × ${CONFIGURATIONS.length} filters = 96 runs)...`);

  for (const sym of symbols) {
    const symCandles = candleData[sym];
    const c1h = symCandles['1h'];
    const c4h = symCandles['4h'];

    for (const interval of intervals) {
      const activeCandles = symCandles[interval];

      for (const size of sizes) {
        for (const exit of exitModes) {
          for (const cfg of CONFIGURATIONS) {
            const strategy = new MultiTimeframeStrategy({
              htfMode: 'strict',
              entryMode: 'cross',
              htf1hCandles: c1h,
              htf4hCandles: c4h,
              kijunSlopeFilter: cfg.kijunSlopeFilter,
              structureFilter: cfg.structureFilter,
            });

            const runConfig = {
              strategy,
              candles: activeCandles,
              initialBalance,
              positionSizePercent: size,
              tradeFeePercent,
              tradeMode: 'long-short' as const,
              ...exit.engineConfig,
            };

            const res = engine.run(runConfig);

            const totalReturn = res.metrics.totalPnlPercent;
            const maxDD = res.metrics.maxDrawdownPercent;
            const totalTrades = res.metrics.totalTrades;

            // Half-period returns
            const midIdx = Math.floor(res.equity.length / 2);
            const eqStart = initialBalance;
            const eqMid = res.equity[midIdx] ?? initialBalance;
            const eqEnd = res.equity[res.equity.length - 1] ?? initialBalance;

            const h1Return = roundTo(((eqMid - eqStart) / eqStart) * 100, 2);
            const h2Return = eqMid > 0 ? roundTo(((eqEnd - eqMid) / eqMid) * 100, 2) : 0;

            // Return without best trade
            let returnWithoutBest = roundTo(totalReturn, 2);
            if (res.trades.length > 0) {
              const sorted = [...res.trades].sort((a, b) => (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0));
              const bestPnl = sorted[0].pnl || 0;
              const pnlWithoutBest = res.metrics.totalPnl - bestPnl;
              returnWithoutBest = roundTo((pnlWithoutBest / initialBalance) * 100, 2);
            }

            // Average holding duration in hours
            let avgHoldingHours = 0;
            if (res.trades.length > 0) {
              const totalMs = res.trades.reduce((sum, t) => {
                const entryT = t.entryTime ?? 0;
                const exitT = t.exitTime ?? entryT;
                return sum + Math.max(0, exitT - entryT);
              }, 0);
              avgHoldingHours = roundTo(totalMs / (res.trades.length * 1000 * 60 * 60), 1);
            }

            const resultItem: RunResult = {
              symbol: sym,
              interval,
              positionSizePercent: size,
              exitName: exit.name,
              configName: cfg.name,
              totalReturnPercent: roundTo(totalReturn, 2),
              maxDrawdownPercent: roundTo(maxDD, 2),
              totalTrades,
              h1ReturnPercent: h1Return,
              h2ReturnPercent: h2Return,
              returnWithoutBestPercent: returnWithoutBest,
              avgHoldingHours,
            };

            results.push(resultItem);

            console.log(
              `[${sym} ${interval}] [Size:${size}%] [${exit.id}] ${cfg.name.padEnd(12)} -> Ret: ${resultItem.totalReturnPercent.toFixed(2)}% | MaxDD: ${resultItem.maxDrawdownPercent.toFixed(2)}% | Trades: ${resultItem.totalTrades} | H1: ${resultItem.h1ReturnPercent.toFixed(2)}% | H2: ${resultItem.h2ReturnPercent.toFixed(2)}% | w/o Best: ${resultItem.returnWithoutBestPercent.toFixed(2)}% | AvgHold: ${resultItem.avgHoldingHours}h`
            );
          }
        }
      }
    }
  }

  // Format Markdown document
  const mdLines: string[] = [
    '# مقایسهٔ جامع A/B فیلترهای استراتژی Multi-Timeframe',
    '',
    'این گزارش نتایج شبیه‌سازی ماتریس کامل A/B را برای فیلترهای اختیاری (`kijunSlope` و `structure`) روی داده‌های تاریخی BTC و ETH در تایم‌فریم‌ها و سایزهای مختلف ارائه می‌کند.',
    '',
    '## شرایط آزمون (تنظیمات ثابت)',
    '- **نمادها**: BTCUSDT و ETHUSDT (داده‌های تاریخی کامل ۶ ساله از `docs/review/data`).',
    '- **تایم‌فریم‌ها**: ۱۵m، ۱h، ۴h (با فیلتر روند HTF سخت‌گیرانه روی ۱h و ۴h).',
    '- **پایه HTF**: حالت `strict` (هم‌جهتی کامل روند ۱h و ۴h با ایچیموکو بدون RSI/Stoch).',
    '- **نوع ورود**: حالت `cross` (تایید با کراس TK یا Stochastic در کندل جاری).',
    '- **کارمزد معاملاتی**: ۰.۱٪ برای هر طرف (ورود و خروج).',
    '- **سرمایه اولیه**: $10,000.',
    '- **سایزهای آزموده شده**: ۱۰٪ و ۲۰٪ از سرمایه.',
    '- **استراتژی‌های خروج**: (۱) `trailingOnly` با استاپ اولیه ۳٪، تریگر ۳٪ و تریل ۱.۵٪؛ (۲) استاپ ثابت ۳٪ + `reverse` روی سیگنال مخالف.',
    '',
    '## ۱. جدول کامل نتایج ماتریس A/B',
    '',
    '| نماد | تایم‌فریم | سایز | استراتژی خروج | فیلتر | بازده کل | Max DD | تعداد معامله | بازده نیمهٔ اول | بازده نیمهٔ دوم | بازده بدون بهترین معامله | میانگین مدت نگه‌داری (ساعت) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];

  for (const r of results) {
    const retFormatted = `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2)}%`;
    const h1Formatted = `${r.h1ReturnPercent >= 0 ? '+' : ''}${r.h1ReturnPercent.toFixed(2)}%`;
    const h2Formatted = `${r.h2ReturnPercent >= 0 ? '+' : ''}${r.h2ReturnPercent.toFixed(2)}%`;
    const woBestFormatted = `${r.returnWithoutBestPercent >= 0 ? '+' : ''}${r.returnWithoutBestPercent.toFixed(2)}%`;

    mdLines.push(
      `| ${r.symbol} | ${r.interval} | ${r.positionSizePercent}% | ${r.exitName} | \`${r.configName}\` | **${retFormatted}** | ${r.maxDrawdownPercent.toFixed(2)}% | ${r.totalTrades} | ${h1Formatted} | ${h2Formatted} | ${woBestFormatted} | ${r.avgHoldingHours}h |`
    );
  }

  // Summary sections for quick readability
  mdLines.push('');
  mdLines.push('## ۲. تفکیک نتایج بر اساس سایز موقعیت');
  mdLines.push('');
  mdLines.push('### الف) سایز ۱۰٪ (پیش‌فرض پیشنهادی حفظ سرمایه)');
  mdLines.push('');
  mdLines.push('| نماد | تایم‌فریم | استراتژی خروج | فیلتر | بازده کل | Max DD | معاملات | بازده بدون بهترین معامله | میانگین نگه‌داری |');
  mdLines.push('|---|---|---|---|---|---|---|---|---|');

  for (const r of results.filter((x) => x.positionSizePercent === 10)) {
    const retFormatted = `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2)}%`;
    const woBestFormatted = `${r.returnWithoutBestPercent >= 0 ? '+' : ''}${r.returnWithoutBestPercent.toFixed(2)}%`;
    mdLines.push(
      `| ${r.symbol} | ${r.interval} | ${r.exitName} | \`${r.configName}\` | **${retFormatted}** | ${r.maxDrawdownPercent.toFixed(2)}% | ${r.totalTrades} | ${woBestFormatted} | ${r.avgHoldingHours}h |`
    );
  }

  mdLines.push('');
  mdLines.push('### ب) سایز ۲۰٪');
  mdLines.push('');
  mdLines.push('| نماد | تایم‌فریم | استراتژی خروج | فیلتر | بازده کل | Max DD | معاملات | بازده بدون بهترین معامله | میانگین نگه‌داری |');
  mdLines.push('|---|---|---|---|---|---|---|---|---|');

  for (const r of results.filter((x) => x.positionSizePercent === 20)) {
    const retFormatted = `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2)}%`;
    const woBestFormatted = `${r.returnWithoutBestPercent >= 0 ? '+' : ''}${r.returnWithoutBestPercent.toFixed(2)}%`;
    mdLines.push(
      `| ${r.symbol} | ${r.interval} | ${r.exitName} | \`${r.configName}\` | **${retFormatted}** | ${r.maxDrawdownPercent.toFixed(2)}% | ${r.totalTrades} | ${woBestFormatted} | ${r.avgHoldingHours}h |`
    );
  }

  const outputPath = path.resolve(process.cwd(), 'docs', 'review', 'AB_FILTERS.md');
  await fs.writeFile(outputPath, mdLines.join('\n') + '\n', 'utf-8');
  console.log(`\nSuccessfully wrote A/B test comparison to ${outputPath}`);
}

main().catch((err) => {
  console.error('Fatal error running A/B filters comparison:', err);
  process.exit(1);
});
