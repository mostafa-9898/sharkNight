import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { Candle } from '../data/models';
import type {
  Trade,
  TradeMode,
  TrailingStopConfig,
  BacktestConfig,
} from '../backtest/types';
import {
  MultiTimeframeStrategy,
  MultiTimeframeStrategyConfig,
  aggregateCandles,
} from '../strategies/multi-timeframe-strategy';
import { StrictHtfBaselineStrategy } from '../strategies/strict-htf-baseline-strategy';
import { simulateB1 } from '../backtest/simple-baselines';
import { BacktestEngine } from '../backtest/engine';
import { detrendCandlesCausalPastOnly, mulberry32 } from '../backtest/detrend-advanced';
import { roundTo, mean, percentile } from '../utils/math';
import {
  loadGzCandles,
  sampleDistinctIndices,
  iidShuffleCandles,
  RandomEntryStrategy,
  calibrateMultiplier,
  PnFullConfig,
  extractStrategyConfig,
} from './run-pn3-evaluation';

export const C1L_FULL_CONFIG: PnFullConfig = {
  htfMode: 'strict',
  entryMode: 'cross',
  kijunSlopeFilter: true,
  structureFilter: true,
  stochKPeriod: 14,
  stochDPeriod: 3,
  stochSmooth: 3,
  stochOversold: 30,
  stochOverbought: 70,
  fisherMode: 'extra-trigger',
  fisherKind: 'fisher',
  fisherGate: 'none',
  tradeMode: 'long-only',
  trailingStop: {
    initialStopPercent: 5,
    stepPercent: 3,
    raisePercent: 1.5,
    mode: 'stepped',
  },
  positionSizePercent: 3,
  maxOpenPositions: 10,
  maxTotalExposurePercent: 30,
  allowOppositePositions: true,
  tradeFeePercent: 0.1,
  slippagePercent: 0,
};

export const F3L_FULL_CONFIG: PnFullConfig = {
  ...C1L_FULL_CONFIG,
  fisherMode: 'confirm',
};

export const F0L_FULL_CONFIG: PnFullConfig = {
  ...C1L_FULL_CONFIG,
  fisherMode: 'off',
};

export function computeYearlyReturnAndDD(
  candles: readonly Candle[],
  equityCurve: readonly number[],
  year: number
): { returnPercent: number; maxDDPercent: number } {
  let firstIdx = -1;
  let lastIdx = -1;
  let peak = -Infinity;
  let maxDd = 0;
  for (let i = 0; i < candles.length && i < equityCurve.length; i++) {
    const yr = new Date(candles[i].timestamp).getUTCFullYear();
    if (yr === year) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      const eq = equityCurve[i];
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
    }
  }
  if (firstIdx === -1 || lastIdx === -1) return { returnPercent: 0, maxDDPercent: 0 };
  const firstEq = equityCurve[firstIdx];
  const lastEq = equityCurve[lastIdx];
  const ret = firstEq > 0 ? roundTo(((lastEq - firstEq) / firstEq) * 100, 2) : 0;
  return { returnPercent: ret, maxDDPercent: roundTo(maxDd, 2) };
}

export function compute2022Return(
  candles: readonly Candle[],
  equityCurve: readonly number[]
): number {
  return computeYearlyReturnAndDD(candles, equityCurve, 2022).returnPercent;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return roundTo((sorted[mid - 1] + sorted[mid]) / 2, 2);
}

export function trimmedMean20(values: number[]): number {
  if (values.length <= 6) return roundTo(mean(values), 2);
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.round(values.length * 0.2);
  const trimmed = sorted.slice(k, sorted.length - k);
  if (trimmed.length === 0) return roundTo(mean(values), 2);
  return roundTo(trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length, 2);
}

export interface DetailedMarketMetrics {
  totalReturn: number;
  maxDD: number;
  retDdRatio: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  sharpeRatio: number;
  cagr: number;
  avgConcurrent: number;
  percentTimeInMarket: number;
  return2022: number;
}

export interface PyEvaluationRecord {
  key: string;
  symbol: string;
  interval: string;
  isOos: boolean;
  isSeen: boolean;
  manifestInfo: {
    rows: number;
    firstTimestamp: number;
    lastTimestamp: number;
    sha256: string;
  };
  c1l: {
    real: DetailedMarketMetrics;
    d2: DetailedMarketMetrics;
  };
  f3l: {
    real: DetailedMarketMetrics;
    d2: DetailedMarketMetrics;
  };
  f0l: {
    real: DetailedMarketMetrics;
    d2: DetailedMarketMetrics;
  };
  b4: {
    real: {
      totalReturn: number;
      maxDD: number;
      retDdRatio: number;
      trades: number;
      return2022: number;
    };
  };
  b1: {
    real: {
      totalReturn: number;
      maxDD: number;
      retDdRatio: number;
      trades: number;
      return2022: number;
    };
  };
  null1l: {
    meanReturn: number;
    stdReturn: number;
    p75: number;
    p90: number;
    c1lPercentile: number;
  };
  null2l: {
    meanReturn: number;
    stdReturn: number;
    p75: number;
    p90: number;
    c1lPercentile: number;
  };
  yearly?: Record<string, { returnPercent: number; maxDDPercent: number }>;
}

export interface ConcurrencySensitivityResult {
  market: string;
  maxOpen: number;
  maxExposure: number;
  totalReturn: number;
  maxDD: number;
  retDdRatio: number;
}

export interface SizeSensitivityResult {
  market: string;
  sizePercent: number;
  totalReturn: number;
  maxDD: number;
  retDdRatio: number;
}

export async function runPyEvaluation(): Promise<{
  records: PyEvaluationRecord[];
  concurrencySensitivity: ConcurrencySensitivityResult[];
  sizeSensitivity: SizeSensitivityResult[];
  baselinesComparison: Record<string, { medianRet: number; trimmedRet: number; medianDD: number; trimmedDD: number; medianRetDd: number; trimmedRetDd: number }>;
  criteria: {
    crit1_ReturnDD: boolean;
    crit2_D2Robustness: boolean;
    crit3_NullSignificance: boolean;
    crit4_DrawdownControl: boolean;
  };
  verdict: 'PASS' | 'REJECTED';
}> {
  console.log('=== Starting PY2 Empirical Evaluation Program (C1L vs Baselines) ===\n');
  const dataDir = path.resolve('docs/review/data');
  const manifestPath = path.join(dataDir, 'MANIFEST.json');
  const manifestData: Array<{
    symbol: string;
    interval: string;
    rows: number;
    firstTimestamp: number;
    lastTimestamp: number;
    sha256: string;
  }> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const primaryMarkets = [
    { key: 'BTC 15m', sym: 'BTC', tf: '15m', isOos: false, isSeen: true },
    { key: 'BTC 1h', sym: 'BTC', tf: '1h', isOos: false, isSeen: false },
    { key: 'BTC 4h', sym: 'BTC', tf: '4h', isOos: false, isSeen: false },
    { key: 'ETH 15m', sym: 'ETH', tf: '15m', isOos: false, isSeen: false },
    { key: 'ETH 1h', sym: 'ETH', tf: '1h', isOos: false, isSeen: false },
    { key: 'ETH 4h', sym: 'ETH', tf: '4h', isOos: false, isSeen: false },
  ];

  const oosMarkets = [
    { key: 'SOL 1h', sym: 'SOL', tf: '1h', isOos: true, isSeen: false },
    { key: 'SOL 4h', sym: 'SOL', tf: '4h', isOos: true, isSeen: false },
    { key: 'BNB 1h', sym: 'BNB', tf: '1h', isOos: true, isSeen: false },
    { key: 'BNB 4h', sym: 'BNB', tf: '4h', isOos: true, isSeen: false },
    { key: 'XRP 1h', sym: 'XRP', tf: '1h', isOos: true, isSeen: false },
    { key: 'XRP 4h', sym: 'XRP', tf: '4h', isOos: true, isSeen: false },
    { key: 'ADA 1h', sym: 'ADA', tf: '1h', isOos: true, isSeen: false },
    { key: 'ADA 4h', sym: 'ADA', tf: '4h', isOos: true, isSeen: false },
  ];

  const allMarkets = [...primaryMarkets, ...oosMarkets];
  const engine = new BacktestEngine();
  const records: PyEvaluationRecord[] = [];
  const concurrencySensitivity: ConcurrencySensitivityResult[] = [];
  const sizeSensitivity: SizeSensitivityResult[] = [];
  const NULL_PATHS = 200;

  const runBacktestDetailed = (
    cfg: PnFullConfig,
    candles: Candle[],
    h1: Candle[],
    h4: Candle[]
  ): { metrics: DetailedMarketMetrics; trades: Trade[]; equityCurve: number[] } => {
    const stratConfig = extractStrategyConfig(cfg);
    const strat = new MultiTimeframeStrategy({
      ...stratConfig,
      htf1hCandles: h1,
      htf4hCandles: h4,
    });

    const res = engine.run({
      initialBalance: 10000,
      tradeFeePercent: cfg.tradeFeePercent,
      slippagePercent: cfg.slippagePercent,
      positionSizePercent: cfg.positionSizePercent,
      tradeMode: cfg.tradeMode,
      exitMode: 'trailingOnly',
      trailingStop: cfg.trailingStop,
      maxOpenPositions: cfg.maxOpenPositions,
      maxTotalExposurePercent: cfg.maxTotalExposurePercent,
      allowOppositePositions: cfg.allowOppositePositions,
      candles,
      strategy: strat,
    });

    const m = res.metrics;
    const totalReturn = roundTo(m.totalPnlPercent, 2);
    const maxDD = roundTo(m.maxDrawdownPercent, 2);
    const retDdRatio = maxDD > 0 ? roundTo(totalReturn / maxDD, 2) : totalReturn > 0 ? 99.99 : 0;
    const tradesCount = m.totalTrades;
    const winRate = roundTo(m.winRate * 100, 1);
    const profitFactor = roundTo(m.profitFactor ?? 0, 2);
    const expectancy = roundTo(m.expectancy ?? 0, 2);
    const sharpeRatio = roundTo(m.sharpeRatio ?? 0, 2);
    const cagr = roundTo(m.cagr ?? 0, 2);
    const percentTimeInMarket = roundTo(m.percentTimeInMarket ?? 0, 2);
    const avgConcurrent =
      res.trades.length > 0
        ? roundTo(
            res.trades.reduce((sum, t) => sum + (t.concurrentOpenAtEntry ?? 1), 0) /
              res.trades.length,
            2
          )
        : 0;
    const return2022 = compute2022Return(candles, res.equity);

    return {
      metrics: {
        totalReturn,
        maxDD,
        retDdRatio,
        trades: tradesCount,
        winRate,
        profitFactor,
        expectancy,
        sharpeRatio,
        cagr,
        avgConcurrent,
        percentTimeInMarket,
        return2022,
      },
      trades: res.trades,
      equityCurve: res.equity,
    };
  };

  for (let mIdx = 0; mIdx < allMarkets.length; mIdx++) {
    const m = allMarkets[mIdx];
    console.log(`[${mIdx + 1}/14] Evaluating ${m.key}...`);

    const mItem = manifestData.find(
      (entry) => entry.symbol === `${m.sym}USDT` && entry.interval === m.tf
    );
    if (!mItem) {
      throw new Error(`Market ${m.key} not found in MANIFEST.json`);
    }

    const rawCandles = loadGzCandles(path.join(dataDir, `${m.sym}USDT_${m.tf}.csv.gz`));
    const raw1h = loadGzCandles(path.join(dataDir, `${m.sym}USDT_1h.csv.gz`));
    const raw4h = loadGzCandles(path.join(dataDir, `${m.sym}USDT_4h.csv.gz`));

    // 1. Direct Real Backtests: C1L, F3L, F0L
    const c1lReal = runBacktestDetailed(C1L_FULL_CONFIG, rawCandles, raw1h, raw4h);
    const f3lReal = runBacktestDetailed(F3L_FULL_CONFIG, rawCandles, raw1h, raw4h);
    const f0lReal = runBacktestDetailed(F0L_FULL_CONFIG, rawCandles, raw1h, raw4h);

    console.log(
      `   Real -> C1L: ${c1lReal.metrics.totalReturn}% (DD: ${c1lReal.metrics.maxDD}%, Ret/DD: ${c1lReal.metrics.retDdRatio}, Tr: ${c1lReal.metrics.trades}), F3L: ${f3lReal.metrics.totalReturn}% (DD: ${f3lReal.metrics.maxDD}%), F0L: ${f0lReal.metrics.totalReturn}%`
    );

    // 2. Direct D2 Backtests
    const d2Candles = detrendCandlesCausalPastOnly(rawCandles, 365);
    const d2_1h = detrendCandlesCausalPastOnly(raw1h, 365);
    const d2_4h = detrendCandlesCausalPastOnly(raw4h, 365);

    const c1lD2 = runBacktestDetailed(C1L_FULL_CONFIG, d2Candles, d2_1h, d2_4h);
    const f3lD2 = runBacktestDetailed(F3L_FULL_CONFIG, d2Candles, d2_1h, d2_4h);
    const f0lD2 = runBacktestDetailed(F0L_FULL_CONFIG, d2Candles, d2_1h, d2_4h);

    console.log(
      `   D2   -> C1L: ${c1lD2.metrics.totalReturn}% (DD: ${c1lD2.metrics.maxDD}%), F3L: ${f3lD2.metrics.totalReturn}% (DD: ${f3lD2.metrics.maxDD}%), F0L: ${f0lD2.metrics.totalReturn}%`
    );

    // 3. Baselines: B4 and B1
    const b4Strat = new StrictHtfBaselineStrategy({
      htf1hCandles: raw1h,
      htf4hCandles: raw4h,
      mode: 'long-only',
    });
    const b4Res = engine.run({
      initialBalance: 10000,
      tradeFeePercent: 0.1,
      positionSizePercent: 30,
      tradeMode: 'long-only',
      exitMode: 'reverse',
      candles: rawCandles,
      strategy: b4Strat,
    });
    const b4Return = roundTo(b4Res.metrics.totalPnlPercent, 2);
    const b4MaxDD = roundTo(b4Res.metrics.maxDrawdownPercent, 2);
    const b4RetDd = b4MaxDD > 0 ? roundTo(b4Return / b4MaxDD, 2) : b4Return > 0 ? 99.99 : 0;
    const b4Ret2022 = compute2022Return(rawCandles, b4Res.equity);

    const b1Res = simulateB1(rawCandles, {
      initialBalance: 10000,
      tradeFeePercent: 0.1,
      positionSizePercent: 30,
    });

    // 4. Yearly Breakdown (2020..2026) for BTC and ETH
    let yearlyData: Record<string, { returnPercent: number; maxDDPercent: number }> | undefined;
    if (m.sym === 'BTC' || m.sym === 'ETH') {
      yearlyData = {};
      const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
      for (const yr of years) {
        yearlyData[yr.toString()] = computeYearlyReturnAndDD(
          rawCandles,
          c1lReal.equityCurve,
          yr
        );
      }
    }

    // 5. Concurrency Sensitivity (Primary markets)
    if (!m.isOos) {
      const maxOpenOpts = [3, 5, 10];
      const maxExpOpts = [20, 30];
      for (const mo of maxOpenOpts) {
        for (const exp of maxExpOpts) {
          const cfgSens: PnFullConfig = {
            ...C1L_FULL_CONFIG,
            maxOpenPositions: mo,
            maxTotalExposurePercent: exp,
          };
          const sensRes = runBacktestDetailed(cfgSens, rawCandles, raw1h, raw4h);
          concurrencySensitivity.push({
            market: m.key,
            maxOpen: mo,
            maxExposure: exp,
            totalReturn: sensRes.metrics.totalReturn,
            maxDD: sensRes.metrics.maxDD,
            retDdRatio: sensRes.metrics.retDdRatio,
          });
        }
      }

      // Size Sensitivity (Primary markets)
      const sizes = [1, 2, 3];
      for (const sz of sizes) {
        const cfgSize: PnFullConfig = {
          ...C1L_FULL_CONFIG,
          positionSizePercent: sz,
          maxOpenPositions: 10,
          maxTotalExposurePercent: 30,
        };
        const sizeRes = runBacktestDetailed(cfgSize, rawCandles, raw1h, raw4h);
        sizeSensitivity.push({
          market: m.key,
          sizePercent: sz,
          totalReturn: sizeRes.metrics.totalReturn,
          maxDD: sizeRes.metrics.maxDD,
          retDdRatio: sizeRes.metrics.retDdRatio,
        });
      }
    }

    // 6. Null-1L: 200 random simulations of strict-HTF long entries
    console.log(`   Running Null-1L (200 random long simulations)...`);
    const c1Strat = new MultiTimeframeStrategy({
      ...extractStrategyConfig(C1L_FULL_CONFIG),
      htf1hCandles: raw1h,
      htf4hCandles: raw4h,
    });

    const eligibleLong: Array<{ idx: number; dir: 1 | -1 }> = [];
    for (let i = 0; i < rawCandles.length; i++) {
      const dir = c1Strat.getStrictHtfDirection(rawCandles, i);
      if (dir === 1) {
        eligibleLong.push({ idx: i, dir: 1 });
      }
    }

    const simConfig = {
      initialBalance: 10000,
      positionSizePercent: 3,
      maxOpenPositions: 10,
      maxTotalExposurePercent: 30,
      allowOppositePositions: true,
      tradeFeePercent: 0.1,
      tradeMode: 'long-only' as TradeMode,
      exitMode: 'trailingOnly' as const,
      trailingStop: C1L_FULL_CONFIG.trailingStop,
    };

    const targetTrades = c1lReal.metrics.trades;
    const mult = calibrateMultiplier(engine, rawCandles, eligibleLong, targetTrades, simConfig);
    const sampleCount = Math.min(
      eligibleLong.length,
      Math.max(1, Math.round(targetTrades * mult))
    );

    const null1Returns: number[] = [];
    for (let s = 0; s < NULL_PATHS; s++) {
      const seed = 42 + mIdx * 1000 + s;
      const rng = mulberry32(seed);
      const chosen = sampleDistinctIndices(eligibleLong.length, sampleCount, rng);
      const sigMap = new Map<number, 1 | -1>();
      for (const itemIdx of chosen) {
        sigMap.set(eligibleLong[itemIdx].idx, eligibleLong[itemIdx].dir);
      }
      const simRes = engine.run({
        ...simConfig,
        strategy: new RandomEntryStrategy(sigMap),
        candles: rawCandles,
      });
      null1Returns.push(roundTo(simRes.metrics.totalPnlPercent, 2));
    }

    const n1Sorted = [...null1Returns].sort((a, b) => a - b);
    const n1Mean = roundTo(null1Returns.reduce((a, b) => a + b, 0) / null1Returns.length, 2);
    const n1Variance =
      null1Returns.reduce((sum, r) => sum + Math.pow(r - n1Mean, 2), 0) / null1Returns.length;
    const n1Std = roundTo(Math.sqrt(n1Variance), 2);
    const n1P75 = n1Sorted[Math.floor(0.75 * n1Sorted.length)];
    const n1P90 = n1Sorted[Math.floor(0.9 * n1Sorted.length)];
    const n1Beaten = null1Returns.filter((r) => c1lReal.metrics.totalReturn > r).length;
    const n1Percentile = roundTo((n1Beaten / NULL_PATHS) * 100, 1);
    console.log(`   Null-1L Percentile: ${n1Percentile}% (Mean: ${n1Mean}%, P75: ${n1P75}%)`);

    // 7. Null-2L: 200 i.i.d. shuffle simulations with C1L
    console.log(`   Running Null-2L (200 i.i.d. return shuffles)...`);
    const is15m = m.tf === '15m';
    const is1h = m.tf === '1h';
    const null2Returns: number[] = [];

    for (let s = 0; s < NULL_PATHS; s++) {
      if ((s + 1) % 50 === 0 || s === 0) {
        process.stdout.write(`   [Null-2L path ${s + 1}/${NULL_PATHS}] `);
      }
      const seed = 8888 + mIdx * 1000 + s;
      const rng = mulberry32(seed);
      const boot = iidShuffleCandles(rawCandles, rng);
      const boot_1h = is15m ? aggregateCandles(boot, 60 * 60 * 1000) : is1h ? boot : raw1h;
      const boot_4h = aggregateCandles(is15m || is1h ? boot_1h : boot, 4 * 60 * 60 * 1000);

      const bootStrat = new MultiTimeframeStrategy({
        ...extractStrategyConfig(C1L_FULL_CONFIG),
        htf1hCandles: boot_1h,
        htf4hCandles: boot_4h,
      });

      const bootRes = engine.run({
        ...simConfig,
        strategy: bootStrat,
        candles: boot,
      });
      null2Returns.push(roundTo(bootRes.metrics.totalPnlPercent, 2));
    }
    console.log('');

    const n2Sorted = [...null2Returns].sort((a, b) => a - b);
    const n2Mean = roundTo(null2Returns.reduce((a, b) => a + b, 0) / null2Returns.length, 2);
    const n2Variance =
      null2Returns.reduce((sum, r) => sum + Math.pow(r - n2Mean, 2), 0) / null2Returns.length;
    const n2Std = roundTo(Math.sqrt(n2Variance), 2);
    const n2P75 = n2Sorted[Math.floor(0.75 * n2Sorted.length)];
    const n2P90 = n2Sorted[Math.floor(0.9 * n2Sorted.length)];
    const n2Beaten = null2Returns.filter((r) => c1lReal.metrics.totalReturn > r).length;
    const n2Percentile = roundTo((n2Beaten / NULL_PATHS) * 100, 1);
    console.log(`   Null-2L Percentile: ${n2Percentile}% (Mean: ${n2Mean}%, P75: ${n2P75}%)\n`);

    records.push({
      key: m.key,
      symbol: m.sym,
      interval: m.tf,
      isOos: m.isOos,
      isSeen: m.isSeen,
      manifestInfo: {
        rows: mItem.rows,
        firstTimestamp: mItem.firstTimestamp,
        lastTimestamp: mItem.lastTimestamp,
        sha256: mItem.sha256,
      },
      c1l: { real: c1lReal.metrics, d2: c1lD2.metrics },
      f3l: { real: f3lReal.metrics, d2: f3lD2.metrics },
      f0l: { real: f0lReal.metrics, d2: f0lD2.metrics },
      b4: {
        real: {
          totalReturn: b4Return,
          maxDD: b4MaxDD,
          retDdRatio: b4RetDd,
          trades: b4Res.metrics.totalTrades,
          return2022: b4Ret2022,
        },
      },
      b1: {
        real: {
          totalReturn: b1Res.totalReturn,
          maxDD: b1Res.maxDD,
          retDdRatio: b1Res.returnDdRatio,
          trades: b1Res.trades,
          return2022: b1Res.return2022,
        },
      },
      null1l: {
        meanReturn: n1Mean,
        stdReturn: n1Std,
        p75: n1P75,
        p90: n1P90,
        c1lPercentile: n1Percentile,
      },
      null2l: {
        meanReturn: n2Mean,
        stdReturn: n2Std,
        p75: n2P75,
        p90: n2P90,
        c1lPercentile: n2Percentile,
      },
      yearly: yearlyData,
    });
  }

  // Acceptance Criteria Calculation
  // 1. Condition 1 (Risk-Adjusted Outperformance)
  const unseenPrimary = records.filter((r) => !r.isOos && !r.isSeen);
  const oosRecords = records.filter((r) => r.isOos);
  const p1Wins = unseenPrimary.filter(
    (r) => r.c1l.real.retDdRatio >= r.f3l.real.retDdRatio
  ).length;
  const oosWins = oosRecords.filter(
    (r) => r.c1l.real.retDdRatio >= r.f3l.real.retDdRatio
  ).length;
  const crit1_ReturnDD = p1Wins >= 4 && oosWins >= 5;

  // 2. Condition 2 (D2 Robustness)
  const c1lD2Returns = records.map((r) => r.c1l.d2.totalReturn);
  const f3lD2Returns = records.map((r) => r.f3l.d2.totalReturn);
  const c1lD2Mean = roundTo(mean(c1lD2Returns), 2);
  const f3lD2Mean = roundTo(mean(f3lD2Returns), 2);
  const d2PosCount = records.filter((r) => r.c1l.d2.totalReturn > 0).length;
  const crit2_D2Robustness = c1lD2Mean > f3lD2Mean && d2PosCount >= 10;

  // 3. Condition 3 (Dual Null Significance)
  const n1Passed = records.filter((r) => r.null1l.c1lPercentile >= 75).length;
  const n2Passed = records.filter((r) => r.null2l.c1lPercentile >= 75).length;
  const crit3_NullSignificance = n1Passed >= 8 && n2Passed >= 8;

  // 4. Condition 4 (Drawdown Control)
  const nonSeenRecords = records.filter((r) => !r.isSeen);
  const ddPassCount = nonSeenRecords.filter(
    (r) => r.c1l.real.maxDD <= 20.0 && r.c1l.real.maxDD <= 1.2 * r.f3l.real.maxDD
  ).length;
  const crit4_DrawdownControl = ddPassCount >= 8;

  const verdict: 'PASS' | 'REJECTED' =
    crit1_ReturnDD && crit2_D2Robustness && crit3_NullSignificance && crit4_DrawdownControl
      ? 'PASS'
      : 'REJECTED';

  console.log('========================================');
  console.log('=== EVALUATION OF C1L ACCEPTANCE CRITERIA ===');
  console.log(
    `Condition 1 (Ret/DD >= F3L): ${crit1_ReturnDD ? 'PASS' : 'FAIL'} (Unseen Primary: ${p1Wins}/5, OOS: ${oosWins}/8)`
  );
  console.log(
    `Condition 2 (D2 Robustness): ${crit2_D2Robustness ? 'PASS' : 'FAIL'} (C1L D2 Mean: ${c1lD2Mean}%, F3L D2 Mean: ${f3lD2Mean}%, D2 > 0: ${d2PosCount}/14)`
  );
  console.log(
    `Condition 3 (Dual Null >= 75%): ${crit3_NullSignificance ? 'PASS' : 'FAIL'} (Null-1L: ${n1Passed}/14, Null-2L: ${n2Passed}/14)`
  );
  console.log(
    `Condition 4 (maxDD <= 20% & <= 1.2x F3L): ${crit4_DrawdownControl ? 'PASS' : 'FAIL'} (${ddPassCount}/13 markets)`
  );
  console.log(`FINAL VERDICT: ${verdict}`);
  console.log('========================================\n');

  // Baselines robust comparison
  const computeRobust = (getRet: (r: PyEvaluationRecord) => number, getDd: (r: PyEvaluationRecord) => number) => {
    const rets = records.map(getRet);
    const dds = records.map(getDd);
    const ratios = records.map((r) => {
      const dd = getDd(r);
      const ret = getRet(r);
      return dd > 0 ? roundTo(ret / dd, 2) : 0;
    });
    return {
      medianRet: median(rets),
      trimmedRet: trimmedMean20(rets),
      medianDD: median(dds),
      trimmedDD: trimmedMean20(dds),
      medianRetDd: median(ratios),
      trimmedRetDd: trimmedMean20(ratios),
    };
  };

  const baselinesComparison = {
    c1l: computeRobust((r) => r.c1l.real.totalReturn, (r) => r.c1l.real.maxDD),
    f3l: computeRobust((r) => r.f3l.real.totalReturn, (r) => r.f3l.real.maxDD),
    f0l: computeRobust((r) => r.f0l.real.totalReturn, (r) => r.f0l.real.maxDD),
    b4: computeRobust((r) => r.b4.real.totalReturn, (r) => r.b4.real.maxDD),
    b1: computeRobust((r) => r.b1.real.totalReturn, (r) => r.b1.real.maxDD),
  };

  const fullData = {
    records,
    concurrencySensitivity,
    sizeSensitivity,
    baselinesComparison,
    criteria: {
      crit1_ReturnDD,
      crit2_D2Robustness,
      crit3_NullSignificance,
      crit4_DrawdownControl,
    },
    verdict,
  };

  const outPath = path.resolve('docs/review/py_data.json');
  fs.writeFileSync(outPath, JSON.stringify(fullData, null, 2), 'utf-8');
  console.log(`Saved evaluation data to ${outPath}`);

  return fullData;
}

if (require.main === module) {
  runPyEvaluation().catch((err) => {
    console.error('Fatal error during PY evaluation:', err);
    process.exit(1);
  });
}
