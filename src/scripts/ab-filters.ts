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
  exitName: string;
  configName: string;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  h1ReturnPercent: number;
  h2ReturnPercent: number;
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

  console.log('Loading dataset candles from docs/review/data...');
  const candleData: Record<string, { c15: Candle[]; c1h: Candle[]; c4h: Candle[] }> = {};

  for (const sym of symbols) {
    const pair = `${sym}USDT`;
    console.log(`Loading ${pair} (15m, 1h, 4h)...`);
    const [c15, c1h, c4h] = await Promise.all([
      loadGzCandles(path.join(dataDir, `${pair}_15m.csv.gz`)),
      loadGzCandles(path.join(dataDir, `${pair}_1h.csv.gz`)),
      loadGzCandles(path.join(dataDir, `${pair}_4h.csv.gz`)),
    ]);
    candleData[sym] = { c15, c1h, c4h };
    console.log(`Loaded ${pair}: 15m=${c15.length}, 1h=${c1h.length}, 4h=${c4h.length}`);
  }

  const exitModes = [
    {
      id: 'trailing',
      name: 'Trailing Only (Stop 3%, Trailing 3/1.5)',
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
      name: 'Reverse on Opposite Signal (Stop 3%)',
      engineConfig: {
        stopLossPercent: 3,
        exitMode: 'reverse' as const,
      },
    },
  ];

  const results: RunResult[] = [];
  const engine = new BacktestEngine();

  for (const sym of symbols) {
    const { c15, c1h, c4h } = candleData[sym];

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
          candles: c15,
          initialBalance: 10000,
          positionSizePercent: 20,
          tradeFeePercent: 0.1,
          tradeMode: 'long-short' as const,
          ...exit.engineConfig,
        };

        const res = engine.run(runConfig);

        const totalReturn = res.metrics.totalPnlPercent;
        const maxDD = res.metrics.maxDrawdownPercent;
        const totalTrades = res.metrics.totalTrades;

        // Half-period returns
        const midIdx = Math.floor(res.equity.length / 2);
        const eqStart = 10000;
        const eqMid = res.equity[midIdx];
        const eqEnd = res.equity[res.equity.length - 1];

        const h1Return = roundTo(((eqMid - eqStart) / eqStart) * 100, 2);
        const h2Return = roundTo(((eqEnd - eqMid) / eqMid) * 100, 2);

        const resultItem: RunResult = {
          symbol: sym,
          exitName: exit.name,
          configName: cfg.name,
          totalReturnPercent: roundTo(totalReturn, 2),
          maxDrawdownPercent: roundTo(maxDD, 2),
          totalTrades,
          h1ReturnPercent: h1Return,
          h2ReturnPercent: h2Return,
        };

        results.push(resultItem);

        console.log(
          `[${sym}] [${exit.id}] ${cfg.name.padEnd(12)} -> Return: ${resultItem.totalReturnPercent.toFixed(2)}% | MaxDD: ${resultItem.maxDrawdownPercent.toFixed(2)}% | Trades: ${resultItem.totalTrades} | H1: ${resultItem.h1ReturnPercent.toFixed(2)}% | H2: ${resultItem.h2ReturnPercent.toFixed(2)}%`
        );
      }
    }
  }

  // Format Markdown document
  const mdLines: string[] = [
    '# مقایسهٔ A/B فیلترهای استراتژی Multi-Timeframe',
    '',
    'این گزارش مقایسهٔ آزمون A/B فیلترهای اختیاری (`kijunSlope` و `structure`) روی دادههای تاریخی BTC و ETH را نمایش میدهد.',
    '',
    '## شرایط آزمون (تنظیمات ثابت)',
    '- **تایمفریمها**: تایمفریم معاملاتی ۱۵m، تایمفریمهای بالا ۱h و ۴h (دادههای `docs/review/data`).',
    '- **پایه HTF**: حالت `strict` (همجهتی روند ۱h و ۴h با شروط ایچیموکو بدون RSI/Stoch).',
    '- **نوع ورود**: حالت `cross` (کراس TK یا Stochastic در کندل جاری همجهت با HTF).',
    '- **سایز موقعیت**: ۲۰٪ سرمایه در هر معامله.',
    '- **کارمزد**: ۰.۱٪ برای هر طرف (ورود و خروج).',
    '- **سرمایه اولیه**: $10,000.',
    '',
    '## نتایج خروج الف: استاپ ۳٪ با trailing 3/1.5 و trailingOnly',
    '',
    '| نماد | پیکربندی | بازده کل | Max Drawdown | تعداد معامله | بازده نیمهٔ اول | بازده نیمهٔ دوم |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const r of results.filter((x) => x.exitName.includes('Trailing Only'))) {
    const retFormatted = `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2)}%`;
    const h1Formatted = `${r.h1ReturnPercent >= 0 ? '+' : ''}${r.h1ReturnPercent.toFixed(2)}%`;
    const h2Formatted = `${r.h2ReturnPercent >= 0 ? '+' : ''}${r.h2ReturnPercent.toFixed(2)}%`;
    mdLines.push(
      `| ${r.symbol} | \`${r.configName}\` | **${retFormatted}** | ${r.maxDrawdownPercent.toFixed(2)}% | ${r.totalTrades} | ${h1Formatted} | ${h2Formatted} |`
    );
  }

  mdLines.push('');
  mdLines.push('## نتایج خروج ب: استاپ ۳٪ با reverse روی سیگنال مخالف');
  mdLines.push('');
  mdLines.push('| نماد | پیکربندی | بازده کل | Max Drawdown | تعداد معامله | بازده نیمهٔ اول | بازده نیمهٔ دوم |');
  mdLines.push('|---|---|---|---|---|---|---|');

  for (const r of results.filter((x) => x.exitName.includes('Reverse on Opposite'))) {
    const retFormatted = `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2)}%`;
    const h1Formatted = `${r.h1ReturnPercent >= 0 ? '+' : ''}${r.h1ReturnPercent.toFixed(2)}%`;
    const h2Formatted = `${r.h2ReturnPercent >= 0 ? '+' : ''}${r.h2ReturnPercent.toFixed(2)}%`;
    mdLines.push(
      `| ${r.symbol} | \`${r.configName}\` | **${retFormatted}** | ${r.maxDrawdownPercent.toFixed(2)}% | ${r.totalTrades} | ${h1Formatted} | ${h2Formatted} |`
    );
  }

  mdLines.push('');
  mdLines.push('## جدول تجمیعی کامل');
  mdLines.push('');
  mdLines.push('| نماد | استراتژی خروج | فیلتر | بازده کل | Max Drawdown | تعداد معامله | بازده نیمهٔ اول | بازده نیمهٔ دوم |');
  mdLines.push('|---|---|---|---|---|---|---|---|');

  for (const r of results) {
    const retFormatted = `${r.totalReturnPercent >= 0 ? '+' : ''}${r.totalReturnPercent.toFixed(2)}%`;
    const h1Formatted = `${r.h1ReturnPercent >= 0 ? '+' : ''}${r.h1ReturnPercent.toFixed(2)}%`;
    const h2Formatted = `${r.h2ReturnPercent >= 0 ? '+' : ''}${r.h2ReturnPercent.toFixed(2)}%`;
    const exitLabel = r.exitName.includes('Trailing Only') ? 'Trailing 3/1.5 (trailingOnly)' : 'Stop 3% + Reverse';
    mdLines.push(
      `| ${r.symbol} | ${exitLabel} | \`${r.configName}\` | **${retFormatted}** | ${r.maxDrawdownPercent.toFixed(2)}% | ${r.totalTrades} | ${h1Formatted} | ${h2Formatted} |`
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

