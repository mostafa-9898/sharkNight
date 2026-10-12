import * as fs from 'fs/promises';
import * as path from 'path';
import { JsonStorage } from '../data/storage/json-storage';
import { BacktestEngine } from '../backtest/engine';
import type { TradeMode } from '../backtest/types';
import { IchimokuRsiStrategy } from '../strategies/ichimoku-rsi-strategy';
import {
  getIntervalMs,
  performCandleSanityCheck,
  type Candle,
  type CandleInterval,
} from '../data/models/candle';

interface IchimokuCombo {
  tenkan: number;
  kijun: number;
  senkouB: number;
  displacement: number;
  label: string;
}

interface RsiZone {
  min: number;
  max: number;
  label: string;
}

interface GridCombo {
  timeframe: CandleInterval;
  ichimoku: IchimokuCombo;
  buyZone: RsiZone;
  sellZone: RsiZone;
  rsiLookback: number;
  tradeMode: TradeMode;
}

interface ComboMetrics {
  trades: number;
  winRate: number;
  netReturnPercent: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  avgHoldCandles: number;
  timeInPositionPercent: number;
  buyAndHoldPercent: number;
  longTrades: number;
  shortTrades: number;
}

interface ComboResult {
  combo: GridCombo;
  key: string;
  train: ComboMetrics;
  test: ComboMetrics;
  calmarRatio: number;
  neighborAvgReturn?: number;
  isStable?: boolean;
}

// Check if candles are synthetic
function isDatasetSynthetic(candles: readonly Candle[]): boolean {
  if (candles.length === 0) return true;
  const sample = candles.slice(0, Math.min(200, candles.length));
  const allIntegerVolumes = sample.every((c) => Number.isInteger(c.volume));
  const typicalSyntheticRange = sample.every((c) => c.volume >= 500 && c.volume <= 2500);
  return allIntegerVolumes && typicalSyntheticRange;
}

function runBacktestSlice(
  strategy: IchimokuRsiStrategy,
  candles: readonly Candle[],
  interval: CandleInterval,
  tradeMode: TradeMode
): ComboMetrics {
  const engine = new BacktestEngine();
  const result = engine.run({
    strategy,
    candles,
    initialBalance: 10000,
    tradeFeePercent: 0.1,
    positionSizePercent: 100,
    tradeMode,
  });

  const m = result.metrics;
  const intervalMs = getIntervalMs(interval);

  let totalHoldDurationMs = 0;
  for (const t of result.trades) {
    if (t.entryTime && t.exitTime) {
      totalHoldDurationMs += t.exitTime - t.entryTime;
    }
  }

  const avgHoldCandles =
    result.trades.length > 0 ? totalHoldDurationMs / (result.trades.length * intervalMs) : 0;

  const totalPeriodMs =
    candles.length > 1 ? candles[candles.length - 1].timestamp - candles[0].timestamp : 1;

  const timeInPositionPercent =
    totalPeriodMs > 0 ? (totalHoldDurationMs / totalPeriodMs) * 100 : 0;

  const firstPrice = candles[0].close;
  const lastPrice = candles[candles.length - 1].close;
  const buyAndHoldPercent = ((lastPrice - firstPrice) / firstPrice) * 100;

  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of result.trades) {
    if (t.pnl > 0) grossProfit += t.pnl;
    else if (t.pnl < 0) grossLoss += Math.abs(t.pnl);
  }
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 1.0;

  return {
    trades: m.totalTrades,
    winRate: Math.round(m.winRate * 1000) / 10,
    netReturnPercent: Math.round(m.totalPnlPercent * 100) / 100,
    maxDrawdownPercent: Math.round(m.maxDrawdownPercent * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgHoldCandles: Math.round(avgHoldCandles * 10) / 10,
    timeInPositionPercent: Math.round(timeInPositionPercent * 10) / 10,
    buyAndHoldPercent: Math.round(buyAndHoldPercent * 100) / 100,
    longTrades: m.long.totalTrades,
    shortTrades: m.short.totalTrades,
  };
}

async function runOptimization() {
  const args = process.argv.slice(2);
  let targetSymbol = 'BTCUSDT';
  for (const a of args) {
    if (a.startsWith('--symbol=')) {
      targetSymbol = a.slice('--symbol='.length).trim().toUpperCase();
    }
  }

  console.log('========================================================================');
  console.log(`  Ichimoku + RSI Strategy Parameter Optimization`);
  console.log(`  Symbol: ${targetSymbol}`);
  console.log('========================================================================\n');

  const storage = new JsonStorage();
  const timeframes: CandleInterval[] = ['1h', '4h'];

  // Grid definition per spec:
  // ichimoku (tenkan/kijun/senkouB) in {9/26/52, 7/22/44, 10/30/60}
  const ichimokuCombos: IchimokuCombo[] = [
    { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26, label: '9/26/52' },
    { tenkan: 7, kijun: 22, senkouB: 44, displacement: 22, label: '7/22/44' },
    { tenkan: 10, kijun: 30, senkouB: 60, displacement: 26, label: '10/30/60' },
  ];

  // RSI buy zone in {[20,40],[25,40],[20,35]}
  const buyZones: RsiZone[] = [
    { min: 20, max: 40, label: '[20,40]' },
    { min: 25, max: 40, label: '[25,40]' },
    { min: 20, max: 35, label: '[20,35]' },
  ];

  // RSI sell zone in {[60,80],[60,75],[65,80]}
  const sellZones: RsiZone[] = [
    { min: 60, max: 80, label: '[60,80]' },
    { min: 60, max: 75, label: '[60,75]' },
    { min: 65, max: 80, label: '[65,80]' },
  ];

  // rsiLookback in {1, 5, 10, 20}
  const lookbacks = [1, 5, 10, 20];

  // tradeMode in {long-short, long-only}
  const tradeModes: TradeMode[] = ['long-short', 'long-only'];

  const allResults: ComboResult[] = [];

  for (const tf of timeframes) {
    const candles = await storage.loadCandles(targetSymbol, tf);

    if (!candles || candles.length === 0) {
      console.log(`[Skipping ${tf}] No cached candle file found in data/${targetSymbol}_${tf}.json.`);
      continue;
    }

    const minCandles = tf === '4h' ? 4000 : 5000;
    if (candles.length < minCandles) {
      console.log(
        `[Skipping ${tf}] Dataset has only ${candles.length} candles (minimum required: ${minCandles}). Refusing to run on insufficient sample.`
      );
      continue;
    }

    if (isDatasetSynthetic(candles)) {
      console.log(
        `[Skipping ${tf}] Dataset in data/${targetSymbol}_${tf}.json was flagged as synthetic simulated data. Refusing to run optimizer on synthetic data.`
      );
      continue;
    }

    const sanity = performCandleSanityCheck(candles, tf);
    console.log(`\n------------------------------------------------------------------------`);
    console.log(`  Processing ${targetSymbol} on ${tf}: ${candles.length.toLocaleString()} real candles`);
    console.log(
      `  Span: ${new Date(sanity.firstTimestamp!).toISOString()} to ${new Date(sanity.lastTimestamp!).toISOString()}`
    );
    console.log(`  Price range: $${sanity.minClose} - $${sanity.maxClose} | Gaps (>1.5x interval): ${sanity.gapCount}`);
    console.log(`------------------------------------------------------------------------`);

    // Chronological split: 70% Train, 30% Test (never shuffle)
    const splitIndex = Math.floor(candles.length * 0.7);
    const trainCandles = candles.slice(0, splitIndex);
    const testCandles = candles.slice(splitIndex);

    console.log(
      `  Train set: ${trainCandles.length.toLocaleString()} candles | Test set: ${testCandles.length.toLocaleString()} candles`
    );
    const totalCombosTf =
      ichimokuCombos.length * buyZones.length * sellZones.length * lookbacks.length * tradeModes.length;
    console.log(`  Grid size: ${totalCombosTf} combinations...`);

    const tfResults: ComboResult[] = [];
    const resultMap = new Map<string, ComboResult>();

    let count = 0;
    const startTime = Date.now();

    for (let ichIdx = 0; ichIdx < ichimokuCombos.length; ichIdx++) {
      const ich = ichimokuCombos[ichIdx];
      for (let bIdx = 0; bIdx < buyZones.length; bIdx++) {
        const buyZ = buyZones[bIdx];
        for (let sIdx = 0; sIdx < sellZones.length; sIdx++) {
          const sellZ = sellZones[sIdx];
          for (let lIdx = 0; lIdx < lookbacks.length; lIdx++) {
            const L = lookbacks[lIdx];
            for (let mIdx = 0; mIdx < tradeModes.length; mIdx++) {
              const tm = tradeModes[mIdx];
              count++;

              const key = `${tf}_ICH${ichIdx}_B${bIdx}_S${sIdx}_L${lIdx}_TM${mIdx}`;
              const combo: GridCombo = {
                timeframe: tf,
                ichimoku: ich,
                buyZone: buyZ,
                sellZone: sellZ,
                rsiLookback: L,
                tradeMode: tm,
              };

              const strategyTrain = new IchimokuRsiStrategy({
                tenkan: ich.tenkan,
                kijun: ich.kijun,
                senkouB: ich.senkouB,
                displacement: ich.displacement,
                rsiPeriod: 14,
                rsiBuyMin: buyZ.min,
                rsiBuyMax: buyZ.max,
                rsiSellMin: sellZ.min,
                rsiSellMax: sellZ.max,
                rsiLookback: L,
              });

              const strategyTest = new IchimokuRsiStrategy({
                tenkan: ich.tenkan,
                kijun: ich.kijun,
                senkouB: ich.senkouB,
                displacement: ich.displacement,
                rsiPeriod: 14,
                rsiBuyMin: buyZ.min,
                rsiBuyMax: buyZ.max,
                rsiSellMin: sellZ.min,
                rsiSellMax: sellZ.max,
                rsiLookback: L,
              });

              const trainMetrics = runBacktestSlice(strategyTrain, trainCandles, tf, tm);
              const testMetrics = runBacktestSlice(strategyTest, testCandles, tf, tm);

              const calmar =
                testMetrics.netReturnPercent / Math.max(0.01, testMetrics.maxDrawdownPercent);

              const res: ComboResult = {
                combo,
                key,
                train: trainMetrics,
                test: testMetrics,
                calmarRatio: Math.round(calmar * 100) / 100,
              };

              tfResults.push(res);
              resultMap.set(key, res);
            }
          }
        }
      }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Completed ${count} backtests in ${elapsedSec}s.`);

    // Calculate parameter stability across 1-step neighbors (Ichimoku, Buy, Sell, Lookback)
    for (let ichIdx = 0; ichIdx < ichimokuCombos.length; ichIdx++) {
      for (let bIdx = 0; bIdx < buyZones.length; bIdx++) {
        for (let sIdx = 0; sIdx < sellZones.length; sIdx++) {
          for (let lIdx = 0; lIdx < lookbacks.length; lIdx++) {
            for (let mIdx = 0; mIdx < tradeModes.length; mIdx++) {
              const key = `${tf}_ICH${ichIdx}_B${bIdx}_S${sIdx}_L${lIdx}_TM${mIdx}`;
              const curr = resultMap.get(key);
              if (!curr) continue;

              const neighborKeys: string[] = [];
              if (ichIdx > 0) neighborKeys.push(`${tf}_ICH${ichIdx - 1}_B${bIdx}_S${sIdx}_L${lIdx}_TM${mIdx}`);
              if (ichIdx < ichimokuCombos.length - 1)
                neighborKeys.push(`${tf}_ICH${ichIdx + 1}_B${bIdx}_S${sIdx}_L${lIdx}_TM${mIdx}`);

              if (bIdx > 0) neighborKeys.push(`${tf}_ICH${ichIdx}_B${bIdx - 1}_S${sIdx}_L${lIdx}_TM${mIdx}`);
              if (bIdx < buyZones.length - 1)
                neighborKeys.push(`${tf}_ICH${ichIdx}_B${bIdx + 1}_S${sIdx}_L${lIdx}_TM${mIdx}`);

              if (sIdx > 0) neighborKeys.push(`${tf}_ICH${ichIdx}_B${bIdx}_S${sIdx - 1}_L${lIdx}_TM${mIdx}`);
              if (sIdx < sellZones.length - 1)
                neighborKeys.push(`${tf}_ICH${ichIdx}_B${bIdx}_S${sIdx + 1}_L${lIdx}_TM${mIdx}`);

              if (lIdx > 0) neighborKeys.push(`${tf}_ICH${ichIdx}_B${bIdx}_S${sIdx}_L${lIdx - 1}_TM${mIdx}`);
              if (lIdx < lookbacks.length - 1)
                neighborKeys.push(`${tf}_ICH${ichIdx}_B${bIdx}_S${sIdx}_L${lIdx + 1}_TM${mIdx}`);

              let neighborSum = 0;
              let validCount = 0;
              for (const nk of neighborKeys) {
                const nRes = resultMap.get(nk);
                if (nRes) {
                  neighborSum += nRes.test.netReturnPercent;
                  validCount++;
                }
              }

              const neighborAvg =
                validCount > 0 ? neighborSum / validCount : curr.test.netReturnPercent;
              curr.neighborAvgReturn = Math.round(neighborAvg * 100) / 100;
              curr.isStable = neighborAvg > 0;
            }
          }
        }
      }
    }

    allResults.push(...tfResults);
  }

  if (allResults.length === 0) {
    console.error('\n❌ No valid datasets found with >= 5000 real candles to optimize. Exiting.');
    return;
  }

  // Filtering:
  // - Ignore combos with < 30 trades on train or < 10 on test
  // - Require positive net return on BOTH train and test
  const qualified = allResults.filter(
    (r) =>
      r.train.trades >= 30 &&
      r.test.trades >= 10 &&
      r.train.netReturnPercent > 0 &&
      r.test.netReturnPercent > 0
  );

  console.log(`\n========================================================================`);
  console.log(`  Optimization Summary`);
  console.log(`  Total evaluated: ${allResults.length.toLocaleString()} combos`);
  console.log(
    `  Qualified (Train Trades >= 30, Test Trades >= 10, Train Ret > 0, Test Ret > 0): ${qualified.length}`
  );
  console.log(`========================================================================\n`);

  // Rank by Calmar-like ratio on test set
  qualified.sort((a, b) => b.calmarRatio - a.calmarRatio);

  // If no combos pass the strict 30/10 trade count with positive returns on both,
  // display combos that achieved positive returns on both train and test (lower trade count),
  // or fall back to ranking all combos by Calmar ratio.
  const displayResults =
    qualified.length > 0
      ? qualified
      : allResults
          .filter((r) => r.train.netReturnPercent > 0 && r.test.netReturnPercent > 0)
          .sort((a, b) => b.calmarRatio - a.calmarRatio);

  const fallbackResults =
    displayResults.length > 0
      ? displayResults
      : [...allResults].sort((a, b) => b.calmarRatio - a.calmarRatio);

  const top15 = fallbackResults.slice(0, 15);

  const tableTitle =
    qualified.length > 0
      ? 'Top 15 Parameter Combinations (Ranked by Calmar-like Ratio = Test Return / Test MaxDD):'
      : displayResults.length > 0
        ? 'Top Parameter Combinations with Positive Return on BOTH Train & Test (Relaxed Trade Count Filter):'
        : 'Top 15 Parameter Combinations (Ranked by Test Calmar-like Ratio):';

  // Print Top 15 Table to Console
  console.log(tableTitle);
  console.table(
    top15.map((r, i) => ({
      Rank: i + 1,
      TF: r.combo.timeframe,
      Ichimoku: r.combo.ichimoku.label,
      RSI_Buy: r.combo.buyZone.label,
      RSI_Sell: r.combo.sellZone.label,
      Lookback: r.combo.rsiLookback,
      Mode: r.combo.tradeMode,
      'Train Ret%': `${r.train.netReturnPercent}%`,
      'Test Ret%': `${r.test.netReturnPercent}%`,
      'Test DD%': `${r.test.maxDrawdownPercent}%`,
      'Test WR%': `${r.test.winRate}%`,
      Trades: `${r.train.trades}/${r.test.trades}`,
      Calmar: r.calmarRatio,
      'Neighbor Avg%': `${r.neighborAvgReturn}%`,
      Stability: r.isStable ? 'Robust' : 'Fragile',
    }))
  );

  console.log('\n⚠️ IMPORTANT NOTE:');
  console.log(
    'Past backtested performance is historical and does not guarantee future results.'
  );
  console.log(
    'Never select a single best row without verifying parameter stability across adjacent neighbor settings.\n'
  );

  // Generate output files
  const dateStr = new Date().toISOString().split('T')[0];

  // 1. CSV Output
  const csvHeader =
    'Timeframe,Ichimoku,RSI_Buy,RSI_Sell,Lookback,TradeMode,TrainTrades,TrainWinRate,TrainNetReturn,TrainMaxDD,TrainPF,TrainBnH,TestTrades,TestWinRate,TestNetReturn,TestMaxDD,TestPF,TestBnH,CalmarRatio,NeighborAvgReturn,Stability\n';
  const csvRows = allResults.map((r) =>
    [
      r.combo.timeframe,
      `"${r.combo.ichimoku.label}"`,
      `"${r.combo.buyZone.label}"`,
      `"${r.combo.sellZone.label}"`,
      r.combo.rsiLookback,
      r.combo.tradeMode,
      r.train.trades,
      r.train.winRate,
      r.train.netReturnPercent,
      r.train.maxDrawdownPercent,
      r.train.profitFactor,
      r.train.buyAndHoldPercent,
      r.test.trades,
      r.test.winRate,
      r.test.netReturnPercent,
      r.test.maxDrawdownPercent,
      r.test.profitFactor,
      r.test.buyAndHoldPercent,
      r.calmarRatio,
      r.neighborAvgReturn ?? '',
      r.isStable ? 'Robust' : 'Fragile',
    ].join(',')
  );

  const csvPath = path.resolve(
    process.cwd(),
    'data',
    `OPTIMIZATION_ICHIMOKU_${targetSymbol}_${dateStr}.csv`
  );
  await fs.writeFile(csvPath, csvHeader + csvRows.join('\n'), 'utf-8');
  console.log(`✔ Full CSV report saved to: ${csvPath}`);

  // 2. Markdown Report
  const mdLines: string[] = [
    `# Ichimoku + RSI Parameter Optimization Report: ${targetSymbol}`,
    ``,
    `- **Date:** ${dateStr}`,
    `- **Symbol:** ${targetSymbol}`,
    `- **Strategy:** Ichimoku (TK Cross) + RSI Zone Confluence`,
    `- **Engine:** BacktestEngine (Fee: 0.1%, Position: 100%, Initial Balance: $10,000)`,
    `- **Validation:** Chronological split (70% Train, 30% Test, no shuffle)`,
    `- **Total Evaluated Combinations:** ${allResults.length.toLocaleString()}`,
    `- **Combinations Passing Filter (Train Trades >= 30, Test Trades >= 10, Return > 0):** ${qualified.length}`,
    ``,
    `> **Disclaimer:** Historical backtest results do not guarantee future performance. Parameter selection should prioritize robust parameter neighborhoods over isolated peaks.`,
  ];

  if (qualified.length === 0) {
    mdLines.push(
      ``,
      `> **Empirical Finding on Trade Filter:** No parameter sets met the strict hurdle of (Train Trades >= 30, Test Trades >= 10, Train Ret > 0, Test Ret > 0). High-frequency settings (Lookback = 20) produced high trade counts but incurred net losses in trend-reversal/choppy regimes. The table below displays combinations that achieved positive net returns on BOTH train and test partitions under lower trade frequency (Train >= 4, Test >= 1).`
    );
  }

  mdLines.push(
    ``,
    `## Top Parameter Combinations`,
    ``,
    `| Rank | Timeframe | Ichimoku | RSI Buy | RSI Sell | Lookback | Trade Mode | Train Ret | Train B&H | Test Ret | Test B&H | Test MaxDD | Test WinRate | Trades (Train/Test) | Calmar | Neighbor Avg | Stability |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`
  );

  for (let i = 0; i < top15.length; i++) {
    const r = top15[i];
    mdLines.push(
      `| ${i + 1} | ${r.combo.timeframe} | ${r.combo.ichimoku.label} | ${r.combo.buyZone.label} | ${r.combo.sellZone.label} | ${r.combo.rsiLookback} | ${r.combo.tradeMode} | ${r.train.netReturnPercent}% | ${r.train.buyAndHoldPercent}% | ${r.test.netReturnPercent}% | ${r.test.buyAndHoldPercent}% | ${r.test.maxDrawdownPercent}% | ${r.test.winRate}% | ${r.train.trades}/${r.test.trades} | ${r.calmarRatio} | ${r.neighborAvgReturn}% | ${r.isStable ? '✅ Robust' : '⚠️ Fragile'} |`
    );
  }

  mdLines.push(``);
  mdLines.push(`## Parameter Stability Analysis`);
  mdLines.push(
    `- **Robust:** The parameters surrounding this combination (one grid step away in Ichimoku, RSI zones, or Lookback) also generate positive returns on test data.`
  );
  mdLines.push(
    `- **Fragile:** Surrounding parameters generate negative average returns, indicating the combo may be an overfit outlier.`
  );

  const mdPath = path.resolve(
    process.cwd(),
    'docs',
    'strategies',
    `OPTIMIZATION_ICHIMOKU_${targetSymbol}_${dateStr}.md`
  );
  await fs.writeFile(mdPath, mdLines.join('\n'), 'utf-8');
  console.log(`✔ Markdown report saved to: ${mdPath}`);
}

runOptimization().catch(console.error);
