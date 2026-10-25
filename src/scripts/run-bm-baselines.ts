import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import type { Trade, BacktestConfig } from '../backtest/types';
import { MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';
import { detrendCandlesByYear } from './run-rc4-detrend';
import {
  createDailyRegimeCalculatorFromDailyCandles,
  aggregateToUtcDaily,
  type DailyRegimeCalculator,
} from '../utils/market-regime';
import {
  simulateB1,
  simulateB2,
  simulateB3,
  simulateB4,
  type BaselineResult,
} from '../backtest/simple-baselines';

function loadGzCandles(filePath: string): Candle[] {
  const buf = fs.readFileSync(filePath);
  const uncompressed = zlib.gunzipSync(buf).toString('utf-8');
  const lines = uncompressed.trim().split('\n').slice(1);
  return lines
    .map((l) => {
      const [timestamp, open, high, low, close, volume] = l.split(',');
      return {
        timestamp: Number(timestamp),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function computeS1Exposure(
  candles: Candle[],
  trades: Trade[],
  equityCurve: number[]
): { timeExposurePercent: number; capitalExposurePercent: number } {
  const n = candles.length;
  if (n === 0) return { timeExposurePercent: 0, capitalExposurePercent: 0 };

  const intervals = trades.map((t) => ({
    start: t.entryTime ?? 0,
    end: t.exitTime ?? Infinity,
    qty: t.quantity,
  }));

  let activeTrades: Array<{ end: number; qty: number }> = [];
  let tIdx = 0;
  const sortedIntervals = [...intervals].sort((a, b) => a.start - b.start);

  let timeCount = 0;
  let capitalSum = 0;

  for (let i = 0; i < n; i++) {
    const t = candles[i].timestamp;
    const price = candles[i].close;
    const eq = equityCurve[i] ?? 10000;

    while (tIdx < sortedIntervals.length && sortedIntervals[tIdx].start <= t) {
      activeTrades.push({ end: sortedIntervals[tIdx].end, qty: sortedIntervals[tIdx].qty });
      tIdx++;
    }

    activeTrades = activeTrades.filter((tr) => tr.end >= t);

    if (activeTrades.length > 0) {
      timeCount++;
      let totalQty = 0;
      for (const tr of activeTrades) totalQty += tr.qty;
      const grossVal = totalQty * price;
      capitalSum += (grossVal / eq) * 100;
    }
  }

  return {
    timeExposurePercent: roundTo((timeCount / n) * 100, 2),
    capitalExposurePercent: roundTo(capitalSum / n, 2),
  };
}

function compute2022Return(candles: Candle[], equityCurve: number[]): number {
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < candles.length && i < equityCurve.length; i++) {
    const yr = new Date(candles[i].timestamp).getUTCFullYear();
    if (yr === 2022) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  if (firstIdx === -1 || lastIdx === -1 || firstIdx === lastIdx) return 0.0;
  const firstEq = equityCurve[firstIdx];
  const lastEq = equityCurve[lastIdx];
  if (firstEq <= 0) return 0.0;
  return roundTo(((lastEq - firstEq) / firstEq) * 100, 2);
}

export interface MarketMethodMetrics {
  totalReturn: number;
  maxDD: number;
  returnDdRatio: number;
  timeExposure: number;
  capitalExposure: number;
  trades: number;
  return2022: number;
  detrendReturn: number;
}

export interface MarketRunOutput {
  market: string;
  isOos: boolean;
  methods: Record<string, MarketMethodMetrics>;
}

export interface BaselineComparison {
  benchmark: string;
  strategy: 'S1L' | 'S1LS';
  primaryWins: number;
  oosWins: number;
  primaryPass: boolean;
  oosPass: boolean;
  detrendAvgDiff: number; // S1 detrend avg - Benchmark detrend avg
  detrendPass: boolean;
  overallPass: boolean;
}

export async function runBmBaselines() {
  console.log('=== Starting BM Program: Simple Baselines Evaluation (B1..B4 vs S1L, S1LS) ===');
  const dataDir = path.resolve('docs/review/data');

  const primaryMarkets = [
    { key: 'BTC 15m', sym: 'BTC', tf: '15m', isOos: false },
    { key: 'BTC 1h', sym: 'BTC', tf: '1h', isOos: false },
    { key: 'BTC 4h', sym: 'BTC', tf: '4h', isOos: false },
    { key: 'ETH 15m', sym: 'ETH', tf: '15m', isOos: false },
    { key: 'ETH 1h', sym: 'ETH', tf: '1h', isOos: false },
    { key: 'ETH 4h', sym: 'ETH', tf: '4h', isOos: false },
  ];

  const oosMarkets = [
    { key: 'SOL 1h', sym: 'SOL', tf: '1h', isOos: true },
    { key: 'SOL 4h', sym: 'SOL', tf: '4h', isOos: true },
    { key: 'BNB 1h', sym: 'BNB', tf: '1h', isOos: true },
    { key: 'BNB 4h', sym: 'BNB', tf: '4h', isOos: true },
    { key: 'XRP 1h', sym: 'XRP', tf: '1h', isOos: true },
    { key: 'XRP 4h', sym: 'XRP', tf: '4h', isOos: true },
    { key: 'ADA 1h', sym: 'ADA', tf: '1h', isOos: true },
    { key: 'ADA 4h', sym: 'ADA', tf: '4h', isOos: true },
  ];

  const allMarkets = [...primaryMarkets, ...oosMarkets];
  const allSymbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA'] as const;

  console.log('Loading candle datasets and preparing daily regime calculators...');
  const rawCandles: Record<string, Record<string, Candle[]>> = {};
  const detrendedCandles: Record<string, Record<string, Candle[]>> = {};

  for (const sym of allSymbols) {
    rawCandles[sym] = {};
    detrendedCandles[sym] = {};
    const tfs = sym === 'BTC' || sym === 'ETH' ? ['15m', '1h', '4h'] : ['1h', '4h'];
    for (const tf of tfs) {
      const p = path.join(dataDir, `${sym}USDT_${tf}.csv.gz`);
      if (fs.existsSync(p)) {
        const c = loadGzCandles(p);
        rawCandles[sym][tf] = c;
        detrendedCandles[sym][tf] = detrendCandlesByYear(c);
      }
    }
  }

  const dailyRegimeCalcsReal: Record<string, DailyRegimeCalculator> = {};
  const dailyRegimeCalcsDetrend: Record<string, DailyRegimeCalculator> = {};

  for (const sym of allSymbols) {
    const dailyPath = path.join(dataDir, `${sym}USDT_1d.csv.gz`);
    let dailyReal: Candle[];
    if (fs.existsSync(dailyPath)) {
      dailyReal = loadGzCandles(dailyPath);
    } else {
      dailyReal = aggregateToUtcDaily(rawCandles[sym]['1h']);
    }
    dailyRegimeCalcsReal[sym] = createDailyRegimeCalculatorFromDailyCandles(dailyReal);

    const dailyDetrend = detrendCandlesByYear(dailyReal);
    dailyRegimeCalcsDetrend[sym] = createDailyRegimeCalculatorFromDailyCandles(dailyDetrend);
  }

  const baseEngineConfig: Partial<BacktestConfig> = {
    initialBalance: 10000,
    positionSizePercent: 10,
    maxOpenPositions: 10,
    maxTotalExposurePercent: 30,
    minBarsBetweenEntries: 0,
    allowOppositePositions: true,
    tradeFeePercent: 0.1,
    exitMode: 'trailingOnly',
    trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
  };

  const marketOutputs: MarketRunOutput[] = [];

  for (let mIdx = 0; mIdx < allMarkets.length; mIdx++) {
    const m = allMarkets[mIdx];
    console.log(`[${mIdx + 1}/14] Evaluating baselines and S1 on market ${m.key}...`);

    const cReal = rawCandles[m.sym][m.tf];
    const c1hReal = rawCandles[m.sym]['1h'];
    const c4hReal = rawCandles[m.sym]['4h'];
    const dailyCalcReal = dailyRegimeCalcsReal[m.sym];

    const cDetrend = detrendedCandles[m.sym][m.tf];
    const c1hDetrend = detrendedCandles[m.sym]['1h'];
    const c4hDetrend = detrendedCandles[m.sym]['4h'];
    const dailyCalcDetrend = dailyRegimeCalcsDetrend[m.sym];

    const stratReal = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
      dailyRegimeCalculator: dailyCalcReal,
    });

    const stratDetrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
      dailyRegimeCalculator: dailyCalcDetrend,
    });

    // 1. Simulate B1 (Real & Detrended)
    const b1Real = simulateB1(cReal, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });
    const b1Detrend = simulateB1(cDetrend, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });

    // 2. Simulate B2 (Real & Detrended)
    const b2Real = simulateB2(cReal, dailyCalcReal, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });
    const b2Detrend = simulateB2(cDetrend, dailyCalcDetrend, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });

    // 3. Simulate B3 (Real & Detrended)
    const b3Real = simulateB3(cReal, dailyCalcReal, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });
    const b3Detrend = simulateB3(cDetrend, dailyCalcDetrend, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });

    // 4. Simulate B4 (Real & Detrended)
    const b4Real = simulateB4(cReal, stratReal, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });
    const b4Detrend = simulateB4(cDetrend, stratDetrend, { initialBalance: 10000, tradeFeePercent: 0.1, positionSizePercent: 30 });

    const engine = new BacktestEngine();

    // 5. Simulate S1L (Real & Detrended)
    const resS1LReal = engine.run({
      ...baseEngineConfig,
      candles: cReal,
      strategy: stratReal,
      tradeMode: 'long-only',
    } as BacktestConfig);
    const expS1LReal = computeS1Exposure(cReal, resS1LReal.trades, resS1LReal.equity);
    const ret2022S1L = compute2022Return(cReal, resS1LReal.equity);

    const resS1LDetrend = engine.run({
      ...baseEngineConfig,
      candles: cDetrend,
      strategy: stratDetrend,
      tradeMode: 'long-only',
    } as BacktestConfig);

    // 6. Simulate S1LS (Real & Detrended)
    const resS1LSReal = engine.run({
      ...baseEngineConfig,
      candles: cReal,
      strategy: stratReal,
      tradeMode: 'long-short',
    } as BacktestConfig);
    const expS1LSReal = computeS1Exposure(cReal, resS1LSReal.trades, resS1LSReal.equity);
    const ret2022S1LS = compute2022Return(cReal, resS1LSReal.equity);

    const resS1LSDetrend = engine.run({
      ...baseEngineConfig,
      candles: cDetrend,
      strategy: stratDetrend,
      tradeMode: 'long-short',
    } as BacktestConfig);

    const makeMetrics = (
      real: BaselineResult | { totalReturn: number; maxDD: number; returnDdRatio: number; trades: number },
      timeExp: number,
      capExp: number,
      ret2022: number,
      detrendRet: number
    ): MarketMethodMetrics => ({
      totalReturn: roundTo(real.totalReturn, 2),
      maxDD: roundTo(real.maxDD, 2),
      returnDdRatio: roundTo(real.returnDdRatio, 2),
      timeExposure: roundTo(timeExp, 2),
      capitalExposure: roundTo(capExp, 2),
      trades: real.trades,
      return2022: roundTo(ret2022, 2),
      detrendReturn: roundTo(detrendRet, 2),
    });

    const s1LRealRetDd =
      resS1LReal.metrics.maxDrawdownPercent > 0
        ? roundTo(resS1LReal.metrics.totalPnlPercent / resS1LReal.metrics.maxDrawdownPercent, 2)
        : 0;
    const s1LSRealRetDd =
      resS1LSReal.metrics.maxDrawdownPercent > 0
        ? roundTo(resS1LSReal.metrics.totalPnlPercent / resS1LSReal.metrics.maxDrawdownPercent, 2)
        : 0;

    marketOutputs.push({
      market: m.key,
      isOos: m.isOos,
      methods: {
        B1: makeMetrics(b1Real, b1Real.avgTimeExposurePercent, b1Real.avgCapitalExposurePercent, b1Real.return2022, b1Detrend.totalReturn),
        B2: makeMetrics(b2Real, b2Real.avgTimeExposurePercent, b2Real.avgCapitalExposurePercent, b2Real.return2022, b2Detrend.totalReturn),
        B3: makeMetrics(b3Real, b3Real.avgTimeExposurePercent, b3Real.avgCapitalExposurePercent, b3Real.return2022, b3Detrend.totalReturn),
        B4: makeMetrics(b4Real, b4Real.avgTimeExposurePercent, b4Real.avgCapitalExposurePercent, b4Real.return2022, b4Detrend.totalReturn),
        S1L: makeMetrics(
          {
            totalReturn: resS1LReal.metrics.totalPnlPercent,
            maxDD: resS1LReal.metrics.maxDrawdownPercent,
            returnDdRatio: s1LRealRetDd,
            trades: resS1LReal.trades.length,
          },
          expS1LReal.timeExposurePercent,
          expS1LReal.capitalExposurePercent,
          ret2022S1L,
          resS1LDetrend.metrics.totalPnlPercent
        ),
        S1LS: makeMetrics(
          {
            totalReturn: resS1LSReal.metrics.totalPnlPercent,
            maxDD: resS1LSReal.metrics.maxDrawdownPercent,
            returnDdRatio: s1LSRealRetDd,
            trades: resS1LSReal.trades.length,
          },
          expS1LSReal.timeExposurePercent,
          expS1LSReal.capitalExposurePercent,
          ret2022S1LS,
          resS1LSDetrend.metrics.totalPnlPercent
        ),
      },
    });
  }

  // Aggregate averages across 14 markets
  const methodNames = ['B1', 'B2', 'B3', 'B4', 'S1L', 'S1LS'] as const;
  const avgMetrics: Record<string, MarketMethodMetrics> = {};

  for (const mName of methodNames) {
    let totRet = 0;
    let maxDd = 0;
    let retDd = 0;
    let timeExp = 0;
    let capExp = 0;
    let trades = 0;
    let ret2022 = 0;
    let detRet = 0;

    for (const m of marketOutputs) {
      const met = m.methods[mName];
      totRet += met.totalReturn;
      maxDd += met.maxDD;
      retDd += met.returnDdRatio;
      timeExp += met.timeExposure;
      capExp += met.capitalExposure;
      trades += met.trades;
      ret2022 += met.return2022;
      detRet += met.detrendReturn;
    }

    const n = marketOutputs.length;
    avgMetrics[mName] = {
      totalReturn: roundTo(totRet / n, 2),
      maxDD: roundTo(maxDd / n, 2),
      returnDdRatio: roundTo(retDd / n, 2),
      timeExposure: roundTo(timeExp / n, 2),
      capitalExposure: roundTo(capExp / n, 2),
      trades: roundTo(trades / n, 0),
      return2022: roundTo(ret2022 / 6, 2), // 2022 bear avg across 6 primary markets
      detrendReturn: roundTo(detRet / n, 2),
    };
  }

  // Comparisons: S1L and S1LS vs B1..B4
  const comparisons: BaselineComparison[] = [];
  const benchmarks = ['B1', 'B2', 'B3', 'B4'] as const;
  const strategies = ['S1L', 'S1LS'] as const;

  for (const strat of strategies) {
    for (const bm of benchmarks) {
      let primaryWins = 0;
      let oosWins = 0;

      for (const m of marketOutputs) {
        const sMet = m.methods[strat];
        const bMet = m.methods[bm];

        // Market win: Return/DD strictly better AND maxDD <= 1.2 * benchmark maxDD
        const retDdBetter = sMet.returnDdRatio > bMet.returnDdRatio;
        const maxDdOk = sMet.maxDD <= bMet.maxDD * 1.2;
        const isWin = retDdBetter && maxDdOk;

        if (isWin) {
          if (m.isOos) oosWins++;
          else primaryWins++;
        }
      }

      const primaryPass = primaryWins >= 4;
      const oosPass = oosWins >= 5;
      const detrendDiff = roundTo(avgMetrics[strat].detrendReturn - avgMetrics[bm].detrendReturn, 2);
      const detrendPass = avgMetrics[strat].detrendReturn >= avgMetrics[bm].detrendReturn;
      const overallPass = primaryPass && oosPass && detrendPass;

      comparisons.push({
        benchmark: bm,
        strategy: strat,
        primaryWins,
        oosWins,
        primaryPass,
        oosPass,
        detrendAvgDiff: detrendDiff,
        detrendPass,
        overallPass,
      });
    }
  }

  // Save json data
  const jsonPath = path.resolve('docs/review/bm_data.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ marketOutputs, avgMetrics, comparisons }, null, 2),
    'utf-8'
  );
  console.log(`Saved evaluation data to ${jsonPath}`);

  // Generate markdown report BM_BASELINES.md
  let md = `# گزارش جامع ارزیابی خطوط مبنای ساده و ارزش افزوده‌ی استراتژی (BM_BASELINES - BM1)\n\n`;
  md += `پروتکل پیش‌ثبت‌شده‌ی BM0 بر روی ۱۴ بازار (۶ اصلی و ۸ OOS) با داده‌های واقعی و بدون رانش سالانه (Calendar-Year Detrended) اجرا شد.\n`;
  md += `**تعداد کل آزمون‌های اجراشده:** ۱۴ بازار × ۲ مجموعه‌داده × ۶ روش = **۱۶۸ آزمون بک‌تست کامل**.\n\n`;
  md += `---\n\n`;

  md += `## ۱. جدول تجمیعی مقایسه میانگین شاخص‌ها در ۱۴ بازار\n\n`;
  md += `| روش معاملاتی | بازده واقعی (میانگین) | بیشینه افت سرمایه (MaxDD) | نسبت Return/DD | تماس زمانی (% Time) | تماس سرمایه (% Cap) | میانگین معامله | بازده خرسی ۲۰۲۲ (۶ بازار) | بازده بدون رانش (Detrended) |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const mName of methodNames) {
    const met = avgMetrics[mName];
    const label =
      mName === 'B1'
        ? '**B1 (خرید و هولد ۳۰٪)**'
        : mName === 'B2'
        ? '**B2 (روند روزانه SMA200)**'
        : mName === 'B3'
        ? '**B3 (تقاطع طلایی SMA50/200)**'
        : mName === 'B4'
        ? '**B4 (روند اکید HTF)**'
        : mName === 'S1L'
        ? '**S1L (استراتژی Long-Only)**'
        : '**S1LS (استراتژی Long-Short)**';
    md += `| ${label} | ${met.totalReturn >= 0 ? '+' : ''}${met.totalReturn}% | ${met.maxDD}% | ${met.returnDdRatio} | ${met.timeExposure}% | ${met.capitalExposure}% | ${met.trades} | ${met.return2022 >= 0 ? '+' : ''}${met.return2022}% | ${met.detrendReturn >= 0 ? '+' : ''}${met.detrendReturn}% |\n`;
  }

  md += `\n---\n\n`;
  md += `## ۲. ارزیابی ۳ شرط پیش‌ثبت‌شده‌ی «ارزش افزوده‌ی S1»\n\n`;
  md += `| مقایسه | شرط ۱ و ۲: Return/DD و MaxDD<br>(اصلی ≥۴/۶، OOS ≥۵/۸) | شرط ۳: بازده بدون رانش<br>(میانگین S1 ≥ مبنا) | حکم نهایی ارزش افزوده |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  for (const comp of comparisons) {
    const sLabel = comp.strategy === 'S1L' ? 'S1 Long-Only' : 'S1 Long-Short';
    const bLabel =
      comp.benchmark === 'B1'
        ? 'B1 (Buy&Hold 30%)'
        : comp.benchmark === 'B2'
        ? 'B2 (Daily SMA200)'
        : comp.benchmark === 'B3'
        ? 'B3 (Golden Cross)'
        : 'B4 (HTF Strict)';
    const c12 = `اصلی ${comp.primaryWins}/۶ (${comp.primaryPass ? 'PASS' : 'FAIL'})، OOS ${comp.oosWins}/۸ (${comp.oosPass ? 'PASS' : 'FAIL'})`;
    const c3 = `${comp.detrendAvgDiff >= 0 ? '+' : ''}${comp.detrendAvgDiff}% (${comp.detrendPass ? 'PASS' : 'FAIL'})`;
    const verdict = comp.overallPass ? '**PASS**' : '**FAIL**';
    md += `| **${sLabel} vs ${bLabel}** | ${c12} | ${c3} | ${verdict} |\n`;
  }

  md += `\n---\n\n`;
  md += `## ۳. جدول تفکیکی عملکرد به تفکیک ۱۴ بازار و روش‌ها\n\n`;
  md += `| بازار | نوع | روش | بازده کل % | بیشینه افت سرمایه % | Return/DD | تماس زمان % | تماس سرمایه % | معاملات | بازده ۲۰۲۲ % | بازده Detrended % |\n`;
  md += `| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const m of marketOutputs) {
    for (const mName of methodNames) {
      const met = m.methods[mName];
      md += `| ${m.market} | ${m.isOos ? 'OOS' : 'Primary'} | ${mName} | ${met.totalReturn >= 0 ? '+' : ''}${met.totalReturn}% | ${met.maxDD}% | ${met.returnDdRatio} | ${met.timeExposure}% | ${met.capitalExposure}% | ${met.trades} | ${met.return2022 >= 0 ? '+' : ''}${met.return2022}% | ${met.detrendReturn >= 0 ? '+' : ''}${met.detrendReturn}% |\n`;
    }
  }

  const mdPath = path.resolve('docs/review/BM_BASELINES.md');
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`Saved baseline markdown report to ${mdPath}`);
  console.log('=== BM Baselines Evaluation Completed Successfully ===');
}

if (require.main === module) {
  runBmBaselines().catch((err) => {
    console.error('Error during BM baselines run:', err);
    process.exit(1);
  });
}
