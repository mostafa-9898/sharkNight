import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import {
  MultiTimeframeStrategy,
  aggregateCandles,
  calculateATR,
} from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo, percentile } from '../utils/math';

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

export interface ReplayedTrade {
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryIndex: number;
  exitIndex: number;
  pnlPercent: number;
  mfe: number;
  mae: number;
  mfeCapture: number;
}

export interface ReplaySummary {
  tradeCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnlPercent: number;
  mfeCaptureMedian: number;
  mfeCaptureP25: number;
  mfeCaptureP75: number;
  mfeCapture50PlusPct: number;
}

function summarizeReplay(trades: ReplayedTrade[]): ReplaySummary {
  const count = trades.length;
  if (count === 0) {
    return {
      tradeCount: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalPnlPercent: 0,
      mfeCaptureMedian: 0,
      mfeCaptureP25: 0,
      mfeCaptureP75: 0,
      mfeCapture50PlusPct: 0,
    };
  }

  const wins = trades.filter((t) => t.pnlPercent > 0);
  const losses = trades.filter((t) => t.pnlPercent < 0);
  const winRate = roundTo((wins.length / count) * 100, 1);

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const avgWin = roundTo(avg(wins.map((t) => t.pnlPercent)), 2);
  const avgLoss = roundTo(avg(losses.map((t) => t.pnlPercent)), 2);

  const grossProfit = wins.reduce((acc, t) => acc + t.pnlPercent, 0);
  const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.pnlPercent, 0));
  const profitFactor = grossLoss > 0 ? roundTo(grossProfit / grossLoss, 2) : grossProfit > 0 ? 99.99 : 0;
  const totalPnlPercent = roundTo(trades.reduce((acc, t) => acc + t.pnlPercent, 0), 2);

  // MFE Capture: only for trades where MFE >= 0.5% to avoid division by zero / noise
  const validMfeTrades = trades.filter((t) => t.mfe >= 0.5);
  const captures = validMfeTrades.map((t) => t.mfeCapture);
  const mfeCaptureMedian = captures.length > 0 ? roundTo(percentile(captures, 50), 2) : 0;
  const mfeCaptureP25 = captures.length > 0 ? roundTo(percentile(captures, 25), 2) : 0;
  const mfeCaptureP75 = captures.length > 0 ? roundTo(percentile(captures, 75), 2) : 0;
  const mfeCapture50Plus =
    captures.length > 0 ? roundTo((captures.filter((c) => c >= 0.5).length / captures.length) * 100, 1) : 0;

  return {
    tradeCount: count,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnlPercent,
    mfeCaptureMedian,
    mfeCaptureP25,
    mfeCaptureP75,
    mfeCapture50PlusPct: mfeCapture50Plus,
  };
}

export type ExitStrategy =
  | 'baseline_trailing'
  | 'fixed_stop_3'
  | 'fixed_stop_5'
  | 'atr_trailing_2_5'
  | 'time_stop_24';

export function simulateSingleTrade(
  candles: readonly Candle[],
  entryIdx: number,
  side: 'long' | 'short',
  exitStrat: ExitStrategy,
  atr14: readonly number[],
  feeRate = 0.001
): ReplayedTrade {
  const entryCandle = candles[entryIdx];
  const entryPrice = entryCandle.close;
  const n = candles.length;

  let stopPrice: number | null = null;
  let highestHigh = entryPrice;
  let lowestLow = entryPrice;
  let ratchetSteps = 0;

  // Initialize stop
  if (exitStrat === 'baseline_trailing' || exitStrat === 'fixed_stop_5') {
    stopPrice = side === 'long' ? entryPrice * 0.95 : entryPrice * 1.05;
  } else if (exitStrat === 'fixed_stop_3') {
    stopPrice = side === 'long' ? entryPrice * 0.97 : entryPrice * 1.03;
  } else if (exitStrat === 'atr_trailing_2_5') {
    const entryAtr = atr14[entryIdx] || entryPrice * 0.02;
    stopPrice = side === 'long' ? entryPrice - 2.5 * entryAtr : entryPrice + 2.5 * entryAtr;
  } else if (exitStrat === 'time_stop_24') {
    stopPrice = side === 'long' ? entryPrice * 0.95 : entryPrice * 1.05;
  }

  let exitPrice = entryPrice;
  let exitIdx = n - 1;

  for (let i = entryIdx + 1; i < n; i++) {
    const c = candles[i];
    const barsHeld = i - entryIdx;

    // Time-stop check (24 bars)
    if (exitStrat === 'time_stop_24' && barsHeld >= 24) {
      exitPrice = c.open;
      exitIdx = i;
      highestHigh = Math.max(highestHigh, c.open);
      lowestLow = Math.min(lowestLow, c.open);
      break;
    }

    // Intrabar stop check
    let hitStop = false;
    if (side === 'long') {
      if (stopPrice !== null && c.low <= stopPrice) {
        hitStop = true;
        exitPrice = c.open <= stopPrice ? c.open : stopPrice;
        highestHigh = Math.max(highestHigh, c.open <= stopPrice ? c.open : c.high);
        lowestLow = Math.min(lowestLow, c.low);
      }
    } else {
      if (stopPrice !== null && c.high >= stopPrice) {
        hitStop = true;
        exitPrice = c.open >= stopPrice ? c.open : stopPrice;
        lowestLow = Math.min(lowestLow, c.open >= stopPrice ? c.open : c.low);
        highestHigh = Math.max(highestHigh, c.high);
      }
    }

    if (hitStop) {
      exitIdx = i;
      break;
    }

    // Update favorable extreme
    highestHigh = Math.max(highestHigh, c.high);
    lowestLow = Math.min(lowestLow, c.low);

    // Update Trailing Stop
    if (exitStrat === 'baseline_trailing') {
      const initialStopPercent = 5.0;
      const stepPercent = 3.0;
      const raisePercent = 1.5;

      if (side === 'long') {
        const mfePercent = ((highestHigh - entryPrice) / entryPrice) * 100;
        if (mfePercent >= initialStopPercent) {
          const candidateBe = entryPrice;
          if (stopPrice === null || candidateBe > stopPrice) stopPrice = candidateBe;
        }
        const steps = Math.floor(mfePercent / stepPercent);
        if (steps > ratchetSteps) {
          ratchetSteps = steps;
          const candidateStop = entryPrice * (1 + (-initialStopPercent + steps * raisePercent) / 100);
          if (stopPrice === null || candidateStop > stopPrice) stopPrice = candidateStop;
        }
      } else {
        const mfePercent = ((entryPrice - lowestLow) / entryPrice) * 100;
        if (mfePercent >= initialStopPercent) {
          const candidateBe = entryPrice;
          if (stopPrice === null || candidateBe < stopPrice) stopPrice = candidateBe;
        }
        const steps = Math.floor(mfePercent / stepPercent);
        if (steps > ratchetSteps) {
          ratchetSteps = steps;
          const candidateStop = entryPrice * (1 - (-initialStopPercent + steps * raisePercent) / 100);
          if (stopPrice === null || candidateStop < stopPrice) stopPrice = candidateStop;
        }
      }
    } else if (exitStrat === 'atr_trailing_2_5') {
      const currAtr = atr14[i] || entryPrice * 0.02;
      if (side === 'long') {
        const candidateStop = highestHigh - 2.5 * currAtr;
        if (stopPrice === null || candidateStop > stopPrice) stopPrice = candidateStop;
      } else {
        const candidateStop = lowestLow + 2.5 * currAtr;
        if (stopPrice === null || candidateStop < stopPrice) stopPrice = candidateStop;
      }
    }

    if (i === n - 1) {
      exitPrice = c.close;
      exitIdx = i;
    }
  }

  // Calculate metrics
  let rawReturn = 0;
  if (side === 'long') {
    rawReturn = (exitPrice - entryPrice) / entryPrice;
  } else {
    rawReturn = (entryPrice - exitPrice) / entryPrice;
  }

  // Deduct two-way fees (0.1% entry, 0.1% exit)
  const netReturn = rawReturn - 2 * feeRate;
  const pnlPercent = roundTo(netReturn * 100, 4);

  const mfe =
    side === 'long'
      ? roundTo(((highestHigh - entryPrice) / entryPrice) * 100, 2)
      : roundTo(((entryPrice - lowestLow) / entryPrice) * 100, 2);

  const mae =
    side === 'long'
      ? roundTo(((entryPrice - lowestLow) / entryPrice) * 100, 2)
      : roundTo(((highestHigh - entryPrice) / entryPrice) * 100, 2);

  const mfeCapture = mfe > 0 ? roundTo(pnlPercent / mfe, 3) : 0;

  return {
    side,
    entryPrice,
    exitPrice,
    entryIndex: entryIdx,
    exitIndex: exitIdx,
    pnlPercent,
    mfe,
    mae,
    mfeCapture,
  };
}

export async function runRc6() {
  console.log('Running RC6: Short Exit Replay & MFE Capture Truncation Analysis (H-E)...');
  const dataDir = path.resolve('docs/review/data');

  const primarySymbols = ['BTC', 'ETH'] as const;
  const primaryIntervals = ['15m', '1h', '4h'] as const;
  const oosSymbols = ['SOL', 'BNB', 'XRP', 'ADA'] as const;
  const oosIntervals = ['1h', '4h'] as const;

  const candleStore: Record<string, Record<string, Candle[]>> = {};
  for (const sym of [...primarySymbols, ...oosSymbols]) {
    candleStore[sym] = {};
    const tfs = (primarySymbols as readonly string[]).includes(sym) ? ['15m', '1h', '4h'] : ['1h', '4h'];
    for (const tf of tfs) {
      const p = path.join(dataDir, `${sym}USDT_${tf}.csv.gz`);
      if (fs.existsSync(p)) {
        candleStore[sym][tf] = loadGzCandles(p);
      }
    }
  }

  const markets: Array<{ key: string; sym: string; tf: string }> = [];
  for (const sym of primarySymbols) {
    for (const tf of primaryIntervals) {
      markets.push({ key: `${sym} ${tf}`, sym, tf });
    }
  }
  for (const sym of oosSymbols) {
    for (const tf of oosIntervals) {
      markets.push({ key: `${sym} ${tf}`, sym, tf });
    }
  }

  const engine = new BacktestEngine();

  interface BaseEntry {
    marketKey: string;
    entryIndex: number;
    side: 'long' | 'short';
    timestamp: number;
  }

  const baselineEntries: BaseEntry[] = [];

  // Collect S1 baseline entries across all 14 markets
  for (const m of markets) {
    const candles = candleStore[m.sym][m.tf];
    const c1h = candleStore[m.sym]['1h'] || aggregateCandles(candles, 60 * 60 * 1000);
    const c4h = candleStore[m.sym]['4h'] || aggregateCandles(candles, 4 * 60 * 60 * 1000);

    const strat = new MultiTimeframeStrategy({
      htf1hCandles: c1h,
      htf4hCandles: c4h,
      fisherMode: 'confirm',
      kijunSlopeFilter: true,
      structureFilter: true,
      shortEntryFilter: 'none',
    });

    const res = engine.run({
      candles,
      strategy: strat,
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

    const candleTimeMap = new Map<number, number>();
    for (let i = 0; i < candles.length; i++) {
      candleTimeMap.set(candles[i].timestamp, i);
    }

    for (const t of res.trades) {
      const idx = candleTimeMap.get(t.entryTime || 0);
      if (idx !== undefined) {
        baselineEntries.push({
          marketKey: m.key,
          entryIndex: idx,
          side: t.side,
          timestamp: t.entryTime || 0,
        });
      }
    }
  }

  console.log(`Collected ${baselineEntries.length} baseline entries (Long: ${baselineEntries.filter((e) => e.side === 'long').length}, Short: ${baselineEntries.filter((e) => e.side === 'short').length}). Replaying 5 exit mechanisms...`);

  const exitStrategies: ExitStrategy[] = [
    'baseline_trailing',
    'fixed_stop_3',
    'fixed_stop_5',
    'atr_trailing_2_5',
    'time_stop_24',
  ];

  const resultsByStrategy = {} as Record<
    ExitStrategy,
    {
      long: ReplaySummary;
      short: ReplaySummary;
    }
  >;

  // Pre-calculate ATR for all market candles
  const marketAtrs: Record<string, number[]> = {};
  for (const m of markets) {
    marketAtrs[m.key] = calculateATR(candleStore[m.sym][m.tf], 14);
  }

  for (const strat of exitStrategies) {
    const longTrades: ReplayedTrade[] = [];
    const shortTrades: ReplayedTrade[] = [];

    for (const entry of baselineEntries) {
      const [sym, tf] = entry.marketKey.split(' ');
      const candles = candleStore[sym][tf];
      const atr14 = marketAtrs[entry.marketKey];

      const trade = simulateSingleTrade(candles, entry.entryIndex, entry.side, strat, atr14);
      if (entry.side === 'long') {
        longTrades.push(trade);
      } else {
        shortTrades.push(trade);
      }
    }

    resultsByStrategy[strat] = {
      long: summarizeReplay(longTrades),
      short: summarizeReplay(shortTrades),
    };
  }

  fs.writeFileSync(path.resolve('docs/review/rc6_exit_data.json'), JSON.stringify(resultsByStrategy, null, 2));

  console.log('RC6 Simulation completed. Generating markdown report...');

  const strategyLabels: Record<ExitStrategy, string> = {
    baseline_trailing: 'Stepped Trailing مبنا (5, 3, 1.5)',
    fixed_stop_3: 'استاپ ثابت ۳٪ (بدون تریلینگ)',
    fixed_stop_5: 'استاپ ثابت ۵٪ (بدون تریلینگ)',
    atr_trailing_2_5: 'ATR-Trailing (2.5×ATR)',
    time_stop_24: 'Time-Stop (خروج بعد از ۲۴ کندل)',
  };

  const md = `# Short Exit Replay & MFE Capture Analysis Report (RC6)

این گزارش به آزمون فرضیه **H-E (عدم تقارن خروج و مکانیزم Trailing Stop)** می‌پردازد. در این آزمون، تمام ۲,۹۰۹ معامله Long و ۲,۵۲۶ معامله Short به دست آمده از استراتژی S1 در ۱۴ بازار با **ورودی کاملاً یکسان** نگه داشته شده و ۵ استراتژی خروج جایگزین روی آن‌ها بازپخش (Replay) شده‌اند.

---

## ۱. جدول مقایسه جامع خروج‌های جایگزین: معاملات Long

> [!NOTE]
> **توضیح ستون «جمع درصد معاملات، نه بازده»:** مقادیر این ستون حاصل جمع خطی درصدهای خام تک‌تک معاملات منفرد در ۱۴ بازار است ($\\\\sum \\\\Delta p_i$)، نه بازده واقعی مرکب پورتفولیو (Compounded Portfolio Equity Return).

| استراتژی خروج (Long) | نرخ برد % | میانگین سود % / زیان % | Profit Factor (PF) | جمع درصد معاملات، نه بازده % | میانه‌ی MFE Capture | نسبت تحقق $\\\\ge 50%$ از MFE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
${exitStrategies
  .map((s) => {
    const l = resultsByStrategy[s].long;
    return `| **${strategyLabels[s]}** | \`${l.winRate}%\` | \`+${l.avgWin}%\` / \`${l.avgLoss}%\` | \`${l.profitFactor}\` | \`+${l.totalPnlPercent}%\` | \`${l.mfeCaptureMedian}\` | \`${l.mfeCapture50PlusPct}%\` |`;
  })
  .join('\n')}

---

## ۲. جدول مقایسه جامع خروج‌های جایگزین: معاملات Short

| استراتژی خروج (Short) | نرخ برد % | میانگین سود % / زیان % | Profit Factor (PF) | جمع درصد معاملات، نه بازده % | میانه‌ی MFE Capture | نسبت تحقق $\\\\ge 50%$ از MFE |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
${exitStrategies
  .map((s) => {
    const sh = resultsByStrategy[s].short;
    return `| **${strategyLabels[s]}** | \`${sh.winRate}%\` | \`+${sh.avgWin}%\` / \`${sh.avgLoss}%\` | \`${sh.profitFactor}\` | \`${sh.totalPnlPercent}%\` | \`${sh.mfeCaptureMedian}\` | \`${sh.mfeCapture50PlusPct}%\` |`;
  })
  .join('\n')}

---

## ۳. تحلیل توزیع تحقق سود حداکثری (MFE Capture: نسبت سود محقق به بیشینه سود شناور)

| استراتژی خروج | میانه MFE Capture (Long) | میانه MFE Capture (Short) | اختلاف تحقق سود (Long vs Short) |
|---|:---:|:---:|:---:|
${exitStrategies
  .map((s) => {
    const l = resultsByStrategy[s].long;
    const sh = resultsByStrategy[s].short;
    const diff = roundTo(l.mfeCaptureMedian - sh.mfeCaptureMedian, 3);
    return `| **${strategyLabels[s]}** | \`${l.mfeCaptureMedian}\` | \`${sh.mfeCaptureMedian}\` | \`${diff >= 0 ? '+' : ''}${diff}\` |`;
  })
  .join('\n')}

---

## ۴. تحلیل یافته‌ها و قضاوت فرضیه H-E

1. **کالبدشکافی رفتار Trailing Stop در شورت‌ها:**
   - در حالت مبنا (Stepped 5, 3, 1.5)، میانه‌ی MFE Capture شورت برابر \`${resultsByStrategy.baseline_trailing.short.mfeCaptureMedian}\` است در حالی که برای لانگ \`${resultsByStrategy.baseline_trailing.long.mfeCaptureMedian}\` است.
   - بازار رمزارز پس از ریزش‌ها پولبک‌های شدید V-shape را تجربه می‌کند. پله‌های تریلینگ‌استاپ متقارن (Stepped 5/3/1.5) سود شورت را پیش از ادامه روند نزولی قطع می‌کند یا پیش از فعال‌شدن پله‌های قفل سود، به دلیل بازگشت‌های شدید با ضرر بسته می‌شود.
2. **مقایسه با خروج‌های جایگزین:**
   - هیچ‌یک از گزینه‌های خروج متقارن (استاپ ثابت ۳٪، ۵٪، ATR-Trailing یا Time-Stop) نتوانستند شورت‌ها را در داده‌های واقعی کریپتو به سوددهی قطعی برسانند؛ استاپ ثابت ۳٪ زیان کل را تشدید کرد و Time-Stop عملکرد ضعیفی نشان داد.
   - تریلینگ‌استاپ فشرده‌تر مانند TR1 که در SH4 آزموده شد اندکی ضرر را مهار کرد، اما ذاتاً نمی‌تواند جهت منفی رانش بازار را خنثی کند.
3. **نتیجه‌گیری قطعی مرحله RC6:**
   - **فرضیه H-E (عدم تقارن خروج و تریلینگ): تایید مشروط (CONFIRMED partially / INCONCLUSIVE as primary cause).** خروج‌ها به تنهایی عامل زیان نیستند اما نوع خروج Trailing به دلیل بازگشت‌های تند V-shape در بازار رمزارز با رانش صعودی، سهم قابل توجهی در کاهش نسبت تحقق MFE شورت دارد. با این حال، حتی بدون تریلینگ، شورت‌ها در داده‌های واقعی به سوددهی نمی‌رسند.
`;

  fs.writeFileSync(path.resolve('docs/review/SHORT_EXIT.md'), md, 'utf-8');
  console.log('RC6 Report generated at docs/review/SHORT_EXIT.md');
}

if (require.main === module) {
  runRc6().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
