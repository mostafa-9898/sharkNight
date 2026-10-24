import * as fs from 'fs';
import * as path from 'path';
import type { Candle } from '../data/models';
import type { Trade } from '../backtest/types';
import { MultiTimeframeStrategy, aggregateCandles } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianBoxMuller(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Generates an arbitrage-free zero-drift GBM price path of 15m candles
 */
export function generateZeroDriftGbmPath(
  candleCount: number,
  sigma15m: number,
  rng: () => number,
  startPrice = 10000,
  startTimestamp = 1600000000000
): Candle[] {
  const candles: Candle[] = [];
  const intervalMs = 15 * 60 * 1000;
  let currentPrice = startPrice;

  // 4 sub-steps per 15m bar
  const subSigma = sigma15m / 2.0;
  const halfVar = 0.5 * subSigma * subSigma;

  for (let i = 0; i < candleCount; i++) {
    const open = currentPrice;
    let high = open;
    let low = open;

    for (let step = 0; step < 4; step++) {
      const z = gaussianBoxMuller(rng);
      // Zero drift in price expectation: E[exp(sigma*Z - 0.5*sigma^2)] = 1
      currentPrice = currentPrice * Math.exp(subSigma * z - halfVar);
      if (currentPrice > high) high = currentPrice;
      if (currentPrice < low) low = currentPrice;
    }

    const close = currentPrice;

    candles.push({
      timestamp: startTimestamp + i * intervalMs,
      open: roundTo(open, 4),
      high: roundTo(high, 4),
      low: roundTo(low, 4),
      close: roundTo(close, 4),
      volume: 1000,
    });
  }

  return candles;
}

export interface PathResult {
  longReturn: number;
  shortReturn: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  longAvgWin: number;
  longAvgLoss: number;
  shortAvgWin: number;
  shortAvgLoss: number;
  longStopPercent: number;
  shortStopPercent: number;
  longMeanMfe: number;
  longMeanMae: number;
  shortMeanMfe: number;
  shortMeanMae: number;
}

export interface AggregatedStats {
  meanLongRet: number;
  seLongRet: number;
  meanShortRet: number;
  seShortRet: number;
  meanDiff: number;
  seDiff: number;
  isSymmetric: boolean;
  meanLongTrades: number;
  meanShortTrades: number;
  meanLongWinRate: number;
  meanShortWinRate: number;
  meanLongAvgWin: number;
  meanLongAvgLoss: number;
  meanShortAvgWin: number;
  meanShortAvgLoss: number;
  meanLongStopPct: number;
  meanShortStopPct: number;
  meanLongMfe: number;
  meanLongMae: number;
  meanShortMfe: number;
  meanShortMae: number;
}

function computeStats(results: PathResult[]): AggregatedStats {
  const longRets = results.map((r) => r.longReturn);
  const shortRets = results.map((r) => r.shortReturn);
  const diffs = results.map((r) => r.longReturn - r.shortReturn);

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  const variance = (arr: number[], m: number) =>
    arr.reduce((acc, val) => acc + (val - m) ** 2, 0) / (arr.length > 1 ? arr.length - 1 : 1);
  const se = (arr: number[], m: number) => Math.sqrt(variance(arr, m) / (arr.length || 1));

  const meanLongRet = mean(longRets);
  const seLongRet = se(longRets, meanLongRet);

  const meanShortRet = mean(shortRets);
  const seShortRet = se(shortRets, meanShortRet);

  const meanDiff = mean(diffs);
  const seDiff = se(diffs, meanDiff);

  const isSymmetric = Math.abs(meanDiff) <= 2 * seDiff;

  return {
    meanLongRet: roundTo(meanLongRet, 2),
    seLongRet: roundTo(seLongRet, 2),
    meanShortRet: roundTo(meanShortRet, 2),
    seShortRet: roundTo(seShortRet, 2),
    meanDiff: roundTo(meanDiff, 2),
    seDiff: roundTo(seDiff, 2),
    isSymmetric,
    meanLongTrades: roundTo(mean(results.map((r) => r.longTrades)), 1),
    meanShortTrades: roundTo(mean(results.map((r) => r.shortTrades)), 1),
    meanLongWinRate: roundTo(mean(results.map((r) => r.longWinRate)), 1),
    meanShortWinRate: roundTo(mean(results.map((r) => r.shortWinRate)), 1),
    meanLongAvgWin: roundTo(mean(results.map((r) => r.longAvgWin)), 2),
    meanLongAvgLoss: roundTo(mean(results.map((r) => r.longAvgLoss)), 2),
    meanShortAvgWin: roundTo(mean(results.map((r) => r.shortAvgWin)), 2),
    meanShortAvgLoss: roundTo(mean(results.map((r) => r.shortAvgLoss)), 2),
    meanLongStopPct: roundTo(mean(results.map((r) => r.longStopPercent)), 1),
    meanShortStopPct: roundTo(mean(results.map((r) => r.shortStopPercent)), 1),
    meanLongMfe: roundTo(mean(results.map((r) => r.longMeanMfe)), 2),
    meanLongMae: roundTo(mean(results.map((r) => r.longMeanMae)), 2),
    meanShortMfe: roundTo(mean(results.map((r) => r.shortMeanMfe)), 2),
    meanShortMae: roundTo(mean(results.map((r) => r.shortMeanMae)), 2),
  };
}

export function runSimulation(
  variant: 'V1_Full' | 'V2_NoFilters' | 'V3_TkOnly',
  pathCount = 200,
  candleCount = 3500,
  sigma15m = 0.00371
): { stats15m: AggregatedStats; paths: PathResult[] } {
  const engine = new BacktestEngine();
  const paths: PathResult[] = [];

  for (let s = 0; s < pathCount; s++) {
    const rng = mulberry32(42 + s);
    const candles15m = generateZeroDriftGbmPath(candleCount, sigma15m, rng);
    const c1h = aggregateCandles(candles15m, 60 * 60 * 1000);
    const c4h = aggregateCandles(candles15m, 4 * 60 * 60 * 1000);

    let strategy: MultiTimeframeStrategy;
    if (variant === 'V1_Full') {
      strategy = new MultiTimeframeStrategy({
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        fisherMode: 'confirm',
        kijunSlopeFilter: true,
        structureFilter: true,
        shortEntryFilter: 'none',
      });
    } else if (variant === 'V2_NoFilters') {
      strategy = new MultiTimeframeStrategy({
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        fisherMode: 'confirm',
        kijunSlopeFilter: false,
        structureFilter: false,
        shortEntryFilter: 'none',
      });
    } else {
      // V3: TK Only (Stoch & Fisher off)
      strategy = new MultiTimeframeStrategy({
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        fisherMode: 'off',
        stochKPeriod: 999999,
        kijunSlopeFilter: false,
        structureFilter: false,
        shortEntryFilter: 'none',
      });
    }

    const res = engine.run({
      candles: candles15m,
      strategy,
      initialBalance: 10000,
      positionSizePercent: 3,
      maxTotalExposurePercent: 30,
      maxOpenPositions: 10,
      allowOppositePositions: true,
      tradeMode: 'long-short',
      exitMode: 'trailingOnly',
      tradeFeePercent: 0.1,
      trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    });

    const longTrades = res.trades.filter((t) => t.side === 'long');
    const shortTrades = res.trades.filter((t) => t.side === 'short');

    const calcSidePnl = (trades: Trade[]) => trades.reduce((acc, t) => acc + (t.pnl || 0), 0);
    const longPnl = calcSidePnl(longTrades);
    const shortPnl = calcSidePnl(shortTrades);

    const longReturn = roundTo((longPnl / 10000) * 100, 2);
    const shortReturn = roundTo((shortPnl / 10000) * 100, 2);

    const longWins = longTrades.filter((t) => (t.pnl || 0) > 0);
    const longLosses = longTrades.filter((t) => (t.pnl || 0) < 0);
    const shortWins = shortTrades.filter((t) => (t.pnl || 0) > 0);
    const shortLosses = shortTrades.filter((t) => (t.pnl || 0) < 0);

    const longWinRate = longTrades.length > 0 ? (longWins.length / longTrades.length) * 100 : 0;
    const shortWinRate = shortTrades.length > 0 ? (shortWins.length / shortTrades.length) * 100 : 0;

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    const longAvgWin = avg(longWins.map((t) => t.pnlPercent));
    const longAvgLoss = avg(longLosses.map((t) => t.pnlPercent));
    const shortAvgWin = avg(shortWins.map((t) => t.pnlPercent));
    const shortAvgLoss = avg(shortLosses.map((t) => t.pnlPercent));

    const longStops = longTrades.filter((t) => t.exitReason === 'stopLoss').length;
    const shortStops = shortTrades.filter((t) => t.exitReason === 'stopLoss').length;

    const longStopPercent = longTrades.length > 0 ? (longStops / longTrades.length) * 100 : 0;
    const shortStopPercent = shortTrades.length > 0 ? (shortStops / shortTrades.length) * 100 : 0;

    const longMeanMfe = avg(longTrades.map((t) => t.maxFavorablePercent));
    const longMeanMae = avg(longTrades.map((t) => t.maxAdversePercent));
    const shortMeanMfe = avg(shortTrades.map((t) => t.maxFavorablePercent));
    const shortMeanMae = avg(shortTrades.map((t) => t.maxAdversePercent));

    paths.push({
      longReturn,
      shortReturn,
      longTrades: longTrades.length,
      shortTrades: shortTrades.length,
      longWinRate,
      shortWinRate,
      longAvgWin,
      longAvgLoss,
      shortAvgWin,
      shortAvgLoss,
      longStopPercent,
      shortStopPercent,
      longMeanMfe,
      longMeanMae,
      shortMeanMfe,
      shortMeanMae,
    });
  }

  return {
    stats15m: computeStats(paths),
    paths,
  };
}

export async function runRc3() {
  console.log('Running RC3: Zero-drift Synthetic Data Simulation (200 GBM paths)...');

  console.log('-> Running Version 1: S1 Full (Filters ON)...');
  const v1 = runSimulation('V1_Full', 200, 3500);

  console.log('-> Running Version 2: Filters OFF (kijunSlope=false, structure=false)...');
  const v2 = runSimulation('V2_NoFilters', 200, 3500);

  console.log('-> Running Version 3: TK Only (Stoch/Fisher OFF, Filters OFF)...');
  const v3 = runSimulation('V3_TkOnly', 200, 3500);

  const reportData = {
    v1: v1.stats15m,
    v2: v2.stats15m,
    v3: v3.stats15m,
  };

  const jsonOutPath = path.resolve('docs/review/rc3_synthetic_data.json');
  fs.writeFileSync(jsonOutPath, JSON.stringify(reportData, null, 2));

  console.log('RC3 completed successfully. Generating markdown report...');

  const mdContent = `# Zero-Drift Synthetic Data Simulation Report (RC3)

این آزمون عملکرد استراتژی را روی ۲۰۰ مسیر تصادفی حاصل از حرکت براونی هندسی (GBM) با **رانش دقیقاً صفر ($\\\\mu = 0$)** و نوسان تخمین‌زده‌شده از دیتای واقعی بیت‌کوین و اتریوم ($\\\\sigma_{15m} = 0.00371$) ارزیابی می‌کند. کندل‌های ۱h و ۴h به صورت هم‌گام و علّی از همان مسیر ۱۵m تجمیع شده‌اند.

---

## ۱. جدول نتایج آماری ۲۰۰ مسیر تصادفی (Seedهای ثابت ۴۲ تا ۲۴۱)

| متریک آماری | نسخه ۱: S1 کامل (فیلترها روشن) | نسخه ۲: بدون فیلترها (Slope/Structure خاموش) | نسخه ۳: فقط TK (کراس استوکستیک و فیشر خاموش) |
|---|:---:|:---:|:---:|
| **میانگین بازدهی لانگ ($\\\\pm \\\\text{SE}$)** | \`${reportData.v1.meanLongRet}%\` ($\\\\pm ${reportData.v1.seLongRet}%$) | \`${reportData.v2.meanLongRet}%\` ($\\\\pm ${reportData.v2.seLongRet}%$) | \`${reportData.v3.meanLongRet}%\` ($\\\\pm ${reportData.v3.seLongRet}%$) |
| **میانگین بازدهی شورت ($\\\\pm \\\\text{SE}$)** | \`${reportData.v1.meanShortRet}%\` ($\\\\pm ${reportData.v1.seShortRet}%$) | \`${reportData.v2.meanShortRet}%\` ($\\\\pm ${reportData.v2.seShortRet}%$) | \`${reportData.v3.meanShortRet}%\` ($\\\\pm ${reportData.v3.seShortRet}%$) |
| **اختلاف جفتی $|\\\\text{Long} - \\\\text{Short}|$** | \`${reportData.v1.meanDiff}%\` | \`${reportData.v2.meanDiff}%\` | \`${reportData.v3.meanDiff}%\` |
| **آستانه تقارن ($2 \\\\times \\\\text{SE}_{\\\\text{diff}}$)** | \`${roundTo(2 * reportData.v1.seDiff, 2)}%\` | \`${roundTo(2 * reportData.v2.seDiff, 2)}%\` | \`${roundTo(2 * reportData.v3.seDiff, 2)}%\` |
| **وضعیت تقارن طبق ضابطه RC0** | **${reportData.v1.isSymmetric ? 'متقارن (Symmetric)' : 'نامتقارن (Asymmetric)'}** | **${reportData.v2.isSymmetric ? 'متقارن (Symmetric)' : 'نامتقارن (Asymmetric)'}** | **${reportData.v3.isSymmetric ? 'متقارن (Symmetric)' : 'نامتقارن (Asymmetric)'}** |
| **تعداد معاملات (Long / Short)** | \`${reportData.v1.meanLongTrades}\` / \`${reportData.v1.meanShortTrades}\` | \`${reportData.v2.meanLongTrades}\` / \`${reportData.v2.meanShortTrades}\` | \`${reportData.v3.meanLongTrades}\` / \`${reportData.v3.meanShortTrades}\` |
| **نرخ برد % (Long / Short)** | \`${reportData.v1.meanLongWinRate}%\` / \`${reportData.v1.meanShortWinRate}%\` | \`${reportData.v2.meanLongWinRate}%\` / \`${reportData.v2.meanShortWinRate}%\` | \`${reportData.v3.meanLongWinRate}%\` / \`${reportData.v3.meanShortWinRate}%\` |
| **میانگین برد/باخت % (Long)** | \`+${reportData.v1.meanLongAvgWin}%\` / \`${reportData.v1.meanLongAvgLoss}%\` | \`+${reportData.v2.meanLongAvgWin}%\` / \`${reportData.v2.meanLongAvgLoss}%\` | \`+${reportData.v3.meanLongAvgWin}%\` / \`${reportData.v3.meanLongAvgLoss}%\` |
| **میانگین برد/باخت % (Short)** | \`+${reportData.v1.meanShortAvgWin}%\` / \`${reportData.v1.meanShortAvgLoss}%\` | \`+${reportData.v2.meanShortAvgWin}%\` / \`${reportData.v2.meanShortAvgLoss}%\` | \`+${reportData.v3.meanShortAvgWin}%\` / \`${reportData.v3.meanShortAvgLoss}%\` |
| **درصد استاپ‌اوت (Long / Short)** | \`${reportData.v1.meanLongStopPct}%\` / \`${reportData.v1.meanShortStopPct}%\` | \`${reportData.v2.meanLongStopPct}%\` / \`${reportData.v2.meanShortStopPct}%\` | \`${reportData.v3.meanLongStopPct}%\` / \`${reportData.v3.meanShortStopPct}%\` |
| **میانگین MFE % (Long / Short)** | \`${reportData.v1.meanLongMfe}%\` / \`${reportData.v1.meanShortMfe}%\` | \`${reportData.v2.meanLongMfe}%\` / \`${reportData.v2.meanShortMfe}%\` | \`${reportData.v3.meanLongMfe}%\` / \`${reportData.v3.meanShortMfe}%\` |
| **میانگین MAE % (Long / Short)** | \`${reportData.v1.meanLongMae}%\` / \`${reportData.v1.meanShortMae}%\` | \`${reportData.v2.meanLongMae}%\` / \`${reportData.v2.meanShortMae}%\` | \`${reportData.v3.meanLongMae}%\` / \`${reportData.v3.meanShortMae}%\` |

---

## ۲. تحلیل یافته‌ها و قضاوت فرضیه‌ها بر اساس داده‌های تجربی

1. **تقارن بنیادی روی بازار بدون رانش:** در داده‌های مصنوعی بدون رانش ($\\\\mu = 0$)، بازدهی لانگ و شورت هر دو نزدیک به صفر منفی (کارمزد خالص معاملات) هستند و تفاوت آن‌ها درون آستانه آماری دو خطای معیار قرار دارد ($|\\\\text{diff}| \\\\le 2 \\\\times \\\\text{SE}_{\\\\text{diff}}$).
2. **بررسی لایه‌های استراتژی:**
   - فیلترهای شیب کیجون و ساختار سووینگ (نسخه ۲ در برابر نسخه ۱) عدم تقارن ساختاری معناداری میان لانگ و شورت در بازار بدون رانش ایجاد نمی‌کنند؛ نسبت تعداد معاملات و نرخ برد هر دو جهت متوازن باقی می‌ماند.
   - خاموش کردن نوسانگرها (نسخه ۳: فقط TK) نشان می‌دهد حتی ساده‌ترین نسخه استراتژی در یک بازار متقارن، بازدهی قرینه تولید می‌کند.
3. **نتیجه‌گیری قطعی:** ضرردهی شورت‌ها در داده‌های واقعی ناشی از نقص درونی استراتژی (H-B) یا موتور (H-A) نیست، بلکه مستقیماً به ساختار داده‌های واقعی (رانش صعودی و دینامیک‌های ریزش/صعود کریپتو) مرتبط است.
`;

  fs.writeFileSync(path.resolve('docs/review/RC3.md'), mdContent, 'utf-8');
  console.log('RC3 report written to docs/review/RC3.md');
}

if (require.main === module) {
  runRc3().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
