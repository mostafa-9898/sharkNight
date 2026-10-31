import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import type { BacktestConfig, TradeMode, TrailingStopConfig } from '../backtest/types';
import type { Strategy } from '../strategies/types';
import {
  MultiTimeframeStrategy,
  type MultiTimeframeStrategyConfig,
  aggregateCandles,
} from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { detrendCandlesCausalPastOnly, mulberry32 } from '../backtest/detrend-advanced';
import { roundTo } from '../utils/math';

export interface PnFullConfig {
  htfMode: 'strict';
  entryMode: 'cross';
  kijunSlopeFilter: boolean;
  structureFilter: boolean;
  stochKPeriod: number;
  stochDPeriod: number;
  stochSmooth: number;
  stochOversold: number;
  stochOverbought: number;
  fisherMode: 'off' | 'extra-trigger' | 'replace-stoch' | 'confirm';
  fisherKind: 'fisher' | 'ift';
  fisherGate: 'none' | 'zone';
  tradeMode: 'long-short' | 'long-only' | 'short-only';
  trailingStop: TrailingStopConfig;
  positionSizePercent: number;
  maxOpenPositions: number;
  maxTotalExposurePercent: number;
  allowOppositePositions: boolean;
  tradeFeePercent: number;
  slippagePercent: number;
}

export const C1_CONFIG: PnFullConfig = {
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
  tradeMode: 'long-short',
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

export const F3_CONFIG: PnFullConfig = {
  ...C1_CONFIG,
  fisherMode: 'confirm',
};

export const F0_CONFIG: PnFullConfig = {
  ...C1_CONFIG,
  fisherMode: 'off',
};

export const C1L_CONFIG: PnFullConfig = {
  ...C1_CONFIG,
  tradeMode: 'long-only',
};

export function extractStrategyConfig(config: PnFullConfig): MultiTimeframeStrategyConfig {
  return {
    htfMode: config.htfMode,
    entryMode: config.entryMode,
    kijunSlopeFilter: config.kijunSlopeFilter,
    structureFilter: config.structureFilter,
    stochKPeriod: config.stochKPeriod,
    stochDPeriod: config.stochDPeriod,
    stochSmooth: config.stochSmooth,
    stochOversold: config.stochOversold,
    stochOverbought: config.stochOverbought,
    fisherMode: config.fisherMode,
    fisherKind: config.fisherKind,
    fisherGate: config.fisherGate,
  };
}

export function loadGzCandles(filePath: string): Candle[] {
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

export function sampleDistinctIndices(total: number, count: number, rng: () => number): number[] {
  if (count <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  if (count < total / 2) {
    const chosen = new Set<number>();
    while (chosen.size < count) {
      chosen.add(Math.floor(rng() * total));
    }
    return Array.from(chosen).sort((a, b) => a - b);
  }
  const arr = Array.from({ length: total }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (total - i));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr.slice(0, count).sort((a, b) => a - b);
}

export class RandomEntryStrategy implements Strategy {
  readonly name = 'RandomEntryStrategy';
  readonly description = 'Simulated random entry aligned with strict HTF direction';
  readonly requiredCandles = 1;
  private readonly signals: Map<number, 1 | -1>;

  constructor(signals: Map<number, 1 | -1>) {
    this.signals = signals;
  }

  analyze(candles: readonly Candle[], currentIndex: number) {
    const dir = this.signals.get(currentIndex);
    if (dir === 1) {
      return {
        action: 'BUY' as const,
        timestamp: candles[currentIndex].timestamp,
        price: candles[currentIndex].close,
      };
    }
    if (dir === -1) {
      return {
        action: 'SELL' as const,
        timestamp: candles[currentIndex].timestamp,
        price: candles[currentIndex].close,
      };
    }
    return {
      action: 'HOLD' as const,
      timestamp: candles[currentIndex]?.timestamp ?? 0,
      price: candles[currentIndex]?.close ?? 0,
    };
  }
}

export function calibrateMultiplier(
  engine: BacktestEngine,
  candles: readonly Candle[],
  eligible: Array<{ idx: number; dir: 1 | -1 }>,
  targetTrades: number,
  simConfig: Partial<BacktestConfig>
): number {
  if (targetTrades <= 0 || eligible.length === 0) return 1.0;
  const calibSeeds = [42, 43, 44, 45, 46];

  const evalMultiplier = (m: number): number => {
    const count = Math.min(eligible.length, Math.max(1, Math.round(targetTrades * m)));
    let totalTrades = 0;
    for (const seed of calibSeeds) {
      const rng = mulberry32(seed);
      const chosen = sampleDistinctIndices(eligible.length, count, rng);
      const sigMap = new Map<number, 1 | -1>();
      for (const itemIdx of chosen) {
        sigMap.set(eligible[itemIdx].idx, eligible[itemIdx].dir);
      }
      const res = engine.run({
        ...simConfig,
        initialBalance: simConfig.initialBalance ?? 10000,
        strategy: new RandomEntryStrategy(sigMap),
        candles,
      });
      totalTrades += res.metrics.totalTrades;
    }
    return totalTrades / calibSeeds.length;
  };

  let bestM = 1.0;
  let bestDiff = Infinity;
  const candidateMs = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0];
  for (const m of candidateMs) {
    const avg = evalMultiplier(m);
    const diff = Math.abs(avg - targetTrades) / targetTrades;
    if (diff < bestDiff) {
      bestDiff = diff;
      bestM = m;
    }
    if (diff <= 0.08) break;
  }
  return bestM;
}

export function iidShuffleCandles(candles: readonly Candle[], rng: () => number): Candle[] {
  const n = candles.length;
  if (n <= 1) return [...candles];

  const increments = new Array(n - 1);
  for (let i = 1; i < n; i++) {
    const prevC = candles[i - 1].close;
    increments[i - 1] = {
      openRatio: candles[i].open / prevC,
      highRatio: candles[i].high / prevC,
      lowRatio: candles[i].low / prevC,
      closeRatio: candles[i].close / prevC,
      volume: candles[i].volume,
    };
  }

  for (let i = increments.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = increments[i];
    increments[i] = increments[j];
    increments[j] = temp;
  }

  const shuffled: Candle[] = new Array(n);
  shuffled[0] = { ...candles[0] };
  let curClose = candles[0].close;

  for (let i = 0; i < increments.length; i++) {
    const inc = increments[i];
    const open = roundTo(curClose * inc.openRatio, 4);
    const high = roundTo(curClose * inc.highRatio, 4);
    const low = roundTo(curClose * inc.lowRatio, 4);
    const close = roundTo(curClose * inc.closeRatio, 4);
    curClose = close;

    shuffled[i + 1] = {
      timestamp: candles[i + 1].timestamp,
      open,
      high,
      low,
      close,
      volume: inc.volume,
    };
  }

  return shuffled;
}

export interface MarketMetrics {
  totalReturn: number;
  maxDD: number;
  retDdRatio: number;
  trades: number;
  winRate: number;
  tradesLong: number;
  tradesShort: number;
  returnLong: number;
  returnShort: number;
  winRateLong: number;
  winRateShort: number;
  maxDdLong?: number;
  maxDdShort?: number;
}

export interface MarketEvaluationRecord {
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
  c1: {
    real: MarketMetrics;
    d2: MarketMetrics;
  };
  f3: {
    real: MarketMetrics;
    d2: MarketMetrics;
  };
  f0: {
    real: MarketMetrics;
    d2: MarketMetrics;
  };
  c1l: {
    real: MarketMetrics;
    d2: MarketMetrics;
  };
  null1: {
    meanReturn: number;
    stdReturn: number;
    p75: number;
    p90: number;
    c1Percentile: number;
  };
  null2: {
    meanReturn: number;
    stdReturn: number;
    p75: number;
    p90: number;
    c1Percentile: number;
  };
  clustering: {
    sameDirectionWithin24Bars: number;
    totalEntries: number;
    clusteringRatio: number;
  };
  concurrency?: {
    maxOpen3: { totalReturn: number; maxDD: number; retDdRatio: number; avgConcurrent: number };
    maxOpen5: { totalReturn: number; maxDD: number; retDdRatio: number; avgConcurrent: number };
    maxOpen10: { totalReturn: number; maxDD: number; retDdRatio: number; avgConcurrent: number };
  };
}

export async function runPn3Evaluation(): Promise<{
  records: MarketEvaluationRecord[];
  criteria: Record<string, boolean>;
  verdict: 'ACCEPTED' | 'REJECTED';
}> {
  console.log('=== Starting PN3 Empirical Evaluation Program ===');
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
  const records: MarketEvaluationRecord[] = [];
  const NULL_PATHS = 200;

  const runBacktest = (
    cfg: PnFullConfig,
    candles: Candle[],
    htf1h: Candle[],
    htf4h: Candle[],
    customMaxOpen?: number
  ): MarketMetrics => {
    const strat = new MultiTimeframeStrategy({
      ...extractStrategyConfig(cfg),
      htf1hCandles: htf1h,
      htf4hCandles: htf4h,
    });

    const res = engine.run({
      candles,
      strategy: strat,
      initialBalance: 10000,
      positionSizePercent: cfg.positionSizePercent,
      maxOpenPositions: customMaxOpen ?? cfg.maxOpenPositions,
      maxTotalExposurePercent: cfg.maxTotalExposurePercent,
      allowOppositePositions: cfg.allowOppositePositions,
      tradeFeePercent: cfg.tradeFeePercent,
      slippagePercent: cfg.slippagePercent,
      tradeMode: cfg.tradeMode,
      exitMode: 'trailingOnly',
      trailingStop: cfg.trailingStop,
    });

    const totalReturn = roundTo(res.metrics.totalPnlPercent, 2);
    const maxDD = roundTo(res.metrics.maxDrawdownPercent, 2);
    const retDdRatio = maxDD > 0 ? roundTo(totalReturn / maxDD, 2) : 0;
    const trades = res.metrics.totalTrades;
    const winRate = roundTo(res.metrics.winRate * 100, 1);

    const tradesLong = res.metrics.long.totalTrades;
    const tradesShort = res.metrics.short.totalTrades;
    const returnLong = roundTo(res.metrics.long.totalPnlPercent, 2);
    const returnShort = roundTo(res.metrics.short.totalPnlPercent, 2);
    const winRateLong = roundTo(res.metrics.long.winRate * 100, 1);
    const winRateShort = roundTo(res.metrics.short.winRate * 100, 1);

    return {
      totalReturn,
      maxDD,
      retDdRatio,
      trades,
      winRate,
      tradesLong,
      tradesShort,
      returnLong,
      returnShort,
      winRateLong,
      winRateShort,
    };
  };

  for (let mIdx = 0; mIdx < allMarkets.length; mIdx++) {
    const m = allMarkets[mIdx];
    console.log(`\n[${mIdx + 1}/14] Running PN3 evaluation on ${m.key}...`);

    const mItem = manifestData.find((entry) => entry.symbol === `${m.sym}USDT` && entry.interval === m.tf);
    if (!mItem) {
      throw new Error(`Market ${m.key} (${m.sym}USDT, ${m.tf}) not found in MANIFEST.json`);
    }

    const rawCandles = loadGzCandles(path.join(dataDir, `${m.sym}USDT_${m.tf}.csv.gz`));
    const raw1h = loadGzCandles(path.join(dataDir, `${m.sym}USDT_1h.csv.gz`));
    const raw4h = loadGzCandles(path.join(dataDir, `${m.sym}USDT_4h.csv.gz`));

    // 1. Direct Backtests on Real data
    const c1Real = runBacktest(C1_CONFIG, rawCandles, raw1h, raw4h);
    const f3Real = runBacktest(F3_CONFIG, rawCandles, raw1h, raw4h);
    const f0Real = runBacktest(F0_CONFIG, rawCandles, raw1h, raw4h);
    const c1lReal = runBacktest(C1L_CONFIG, rawCandles, raw1h, raw4h);

    console.log(`   Real -> C1: ${c1Real.totalReturn}% (DD: ${c1Real.maxDD}%, Tr: ${c1Real.trades}), F3: ${f3Real.totalReturn}% (DD: ${f3Real.maxDD}%), F0: ${f0Real.totalReturn}%, C1L: ${c1lReal.totalReturn}%`);

    // 2. Direct Backtests on D2 (Causal 365d Detrended)
    const d2Candles = detrendCandlesCausalPastOnly(rawCandles, 365);
    const d2_1h = detrendCandlesCausalPastOnly(raw1h, 365);
    const d2_4h = detrendCandlesCausalPastOnly(raw4h, 365);

    const c1D2 = runBacktest(C1_CONFIG, d2Candles, d2_1h, d2_4h);
    const f3D2 = runBacktest(F3_CONFIG, d2Candles, d2_1h, d2_4h);
    const f0D2 = runBacktest(F0_CONFIG, d2Candles, d2_1h, d2_4h);
    const c1lD2 = runBacktest(C1L_CONFIG, d2Candles, d2_1h, d2_4h);

    console.log(`   D2   -> C1: ${c1D2.totalReturn}% (DD: ${c1D2.maxDD}%), F3: ${f3D2.totalReturn}% (DD: ${f3D2.maxDD}%), F0: ${f0D2.totalReturn}%, C1L: ${c1lD2.totalReturn}%`);

    // 3. Null-1: 200 random simulations aligned with HTF strict
    console.log(`   Running Null-1 (200 random simulations)...`);
    const c1Strategy = new MultiTimeframeStrategy({
      ...extractStrategyConfig(C1_CONFIG),
      htf1hCandles: raw1h,
      htf4hCandles: raw4h,
    });

    const eligible: Array<{ idx: number; dir: 1 | -1 }> = [];
    for (let i = 0; i < rawCandles.length; i++) {
      const dir = c1Strategy.getStrictHtfDirection(rawCandles, i);
      if (dir === 1 || dir === -1) eligible.push({ idx: i, dir });
    }

    const simConfig = {
      initialBalance: 10000,
      positionSizePercent: 3,
      maxOpenPositions: 10,
      maxTotalExposurePercent: 30,
      allowOppositePositions: true,
      tradeFeePercent: 0.1,
      tradeMode: 'long-short' as TradeMode,
      exitMode: 'trailingOnly' as const,
      trailingStop: C1_CONFIG.trailingStop,
    };

    const mult = calibrateMultiplier(engine, rawCandles, eligible, c1Real.trades, simConfig);
    const sampleCount = Math.min(eligible.length, Math.max(1, Math.round(c1Real.trades * mult)));

    const null1Returns: number[] = [];
    for (let s = 0; s < NULL_PATHS; s++) {
      const seed = 42 + mIdx * 1000 + s;
      const rng = mulberry32(seed);
      const chosen = sampleDistinctIndices(eligible.length, sampleCount, rng);
      const sigMap = new Map<number, 1 | -1>();
      for (const itemIdx of chosen) {
        sigMap.set(eligible[itemIdx].idx, eligible[itemIdx].dir);
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
    const n1Variance = null1Returns.reduce((sum, r) => sum + Math.pow(r - n1Mean, 2), 0) / null1Returns.length;
    const n1Std = roundTo(Math.sqrt(n1Variance), 2);
    const n1P75 = n1Sorted[Math.floor(0.75 * n1Sorted.length)];
    const n1P90 = n1Sorted[Math.floor(0.9 * n1Sorted.length)];
    const n1Beaten = null1Returns.filter((r) => c1Real.totalReturn > r).length;
    const n1Percentile = roundTo((n1Beaten / NULL_PATHS) * 100, 1);
    console.log(`   Null-1 Percentile: ${n1Percentile}% (Mean: ${n1Mean}%, P75: ${n1P75}%)`);

    // 4. Null-2: 200 i.i.d. shuffle simulations of LTF returns
    console.log(`   Running Null-2 (200 i.i.d. return shuffles)...`);
    const is15m = m.tf === '15m';
    const is1h = m.tf === '1h';
    const null2Returns: number[] = [];

    for (let s = 0; s < NULL_PATHS; s++) {
      if ((s + 1) % 50 === 0 || s === 0) {
        process.stdout.write(`   [Null-2 path ${s + 1}/${NULL_PATHS}] `);
      }
      const seed = 8888 + mIdx * 1000 + s;
      const rng = mulberry32(seed);
      const boot = iidShuffleCandles(rawCandles, rng);
      const boot_1h = is15m ? aggregateCandles(boot, 60 * 60 * 1000) : is1h ? boot : raw1h;
      const boot_4h = aggregateCandles(is15m || is1h ? boot_1h : boot, 4 * 60 * 60 * 1000);

      const bootStrat = new MultiTimeframeStrategy({
        ...extractStrategyConfig(C1_CONFIG),
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
    const n2Variance = null2Returns.reduce((sum, r) => sum + Math.pow(r - n2Mean, 2), 0) / null2Returns.length;
    const n2Std = roundTo(Math.sqrt(n2Variance), 2);
    const n2P75 = n2Sorted[Math.floor(0.75 * n2Sorted.length)];
    const n2P90 = n2Sorted[Math.floor(0.9 * n2Sorted.length)];
    const n2Beaten = null2Returns.filter((r) => c1Real.totalReturn > r).length;
    const n2Percentile = roundTo((n2Beaten / NULL_PATHS) * 100, 1);
    console.log(`   Null-2 Percentile: ${n2Percentile}% (Mean: ${n2Mean}%, P75: ${n2P75}%)`);

    // 5. Position Clustering Analysis (same direction within <= 24 bars)
    // Run full backtest with trades list
    const c1DetailedRes = engine.run({
      candles: rawCandles,
      strategy: c1Strategy,
      initialBalance: 10000,
      positionSizePercent: 3,
      maxOpenPositions: 10,
      maxTotalExposurePercent: 30,
      allowOppositePositions: true,
      tradeFeePercent: 0.1,
      slippagePercent: 0,
      tradeMode: 'long-short',
      exitMode: 'trailingOnly',
      trailingStop: C1_CONFIG.trailingStop,
    });

    const tradesList = c1DetailedRes.trades;
    let clusteredCount = 0;
    for (let t = 1; t < tradesList.length; t++) {
      const prevTrade = tradesList[t - 1];
      const curTrade = tradesList[t];
      if (curTrade.side === prevTrade.side) {
        const curTime = curTrade.entryTime ?? curTrade.entrySignal.timestamp;
        const prevTime = prevTrade.entryTime ?? prevTrade.entrySignal.timestamp;
        const timeDiffMs = curTime - prevTime;
        const intervalMs = m.tf === '15m' ? 15 * 60000 : m.tf === '1h' ? 3600000 : 14400000;
        const barDiff = Math.round(timeDiffMs / intervalMs);
        if (barDiff <= 24) {
          clusteredCount++;
        }
      }
    }
    const clusteringRatio = tradesList.length > 0 ? roundTo((clusteredCount / tradesList.length) * 100, 1) : 0;

    // 6. Concurrency Evaluation for 6 Primary markets
    let concurrencyData: MarketEvaluationRecord['concurrency'] = undefined;
    if (!m.isOos) {
      const runConcurrencyLevel = (maxOpen: number) => {
        const res = engine.run({
          candles: rawCandles,
          strategy: c1Strategy,
          initialBalance: 10000,
          positionSizePercent: 3,
          maxOpenPositions: maxOpen,
          maxTotalExposurePercent: 30,
          allowOppositePositions: true,
          tradeFeePercent: 0.1,
          slippagePercent: 0,
          tradeMode: 'long-short',
          exitMode: 'trailingOnly',
          trailingStop: C1_CONFIG.trailingStop,
        });
        const ret = roundTo(res.metrics.totalPnlPercent, 2);
        const dd = roundTo(res.metrics.maxDrawdownPercent, 2);
        const ratio = dd > 0 ? roundTo(ret / dd, 2) : 0;
        const avgConc = res.trades.length > 0
          ? roundTo(res.trades.reduce((sum, t) => sum + (t.concurrentOpenAtEntry ?? 1), 0) / res.trades.length, 2)
          : 0;
        return { totalReturn: ret, maxDD: dd, retDdRatio: ratio, avgConcurrent: avgConc };
      };

      concurrencyData = {
        maxOpen3: runConcurrencyLevel(3),
        maxOpen5: runConcurrencyLevel(5),
        maxOpen10: runConcurrencyLevel(10),
      };
    }

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
      c1: { real: c1Real, d2: c1D2 },
      f3: { real: f3Real, d2: f3D2 },
      f0: { real: f0Real, d2: f0D2 },
      c1l: { real: c1lReal, d2: c1lD2 },
      null1: {
        meanReturn: n1Mean,
        stdReturn: n1Std,
        p75: n1P75,
        p90: n1P90,
        c1Percentile: n1Percentile,
      },
      null2: {
        meanReturn: n2Mean,
        stdReturn: n2Std,
        p75: n2P75,
        p90: n2P90,
        c1Percentile: n2Percentile,
      },
      clustering: {
        sameDirectionWithin24Bars: clusteredCount,
        totalEntries: tradesList.length,
        clusteringRatio,
      },
      concurrency: concurrencyData,
    });
  }

  // --- EVALUATE ACCEPTANCE CRITERIA ---
  // Condition 1: Return/DD(C1) >= Return/DD(F3) in:
  //   - >= 4 of 5 unseen primary markets (BTC 15m excluded)
  //   - >= 5 of 8 OOS markets
  const unseenPrimary = records.filter((r) => !r.isOos && !r.isSeen);
  const oosRecords = records.filter((r) => r.isOos);
  const unseenPrimaryPassCount = unseenPrimary.filter((r) => r.c1.real.retDdRatio >= r.f3.real.retDdRatio).length;
  const oosPassCount = oosRecords.filter((r) => r.c1.real.retDdRatio >= r.f3.real.retDdRatio).length;
  const crit1_ReturnDD = unseenPrimaryPassCount >= 4 && oosPassCount >= 5;

  // Condition 2: D2 mean return of C1 > F3, and D2 return of C1 > 0 in >= 8 of 14 markets
  const c1D2Mean = roundTo(records.reduce((sum, r) => sum + r.c1.d2.totalReturn, 0) / records.length, 2);
  const f3D2Mean = roundTo(records.reduce((sum, r) => sum + r.f3.d2.totalReturn, 0) / records.length, 2);
  const c1D2PosCount = records.filter((r) => r.c1.d2.totalReturn > 0).length;
  const crit2_D2Robustness = c1D2Mean > f3D2Mean && c1D2PosCount >= 8;

  // Condition 3: Null-1 percentile >= 75 in >= 8/14 AND Null-2 percentile >= 75 in >= 8/14
  const null1Pct75Count = records.filter((r) => r.null1.c1Percentile >= 75).length;
  const null2Pct75Count = records.filter((r) => r.null2.c1Percentile >= 75).length;
  const crit3_NullSignificance = null1Pct75Count >= 8 && null2Pct75Count >= 8;

  // Condition 4: MaxDD <= 20% and <= 1.2x F3 in >= 8 of 13 markets (excluding BTC 15m)
  const unseen13Markets = records.filter((r) => !r.isSeen);
  const ddConditionCount = unseen13Markets.filter((r) => r.c1.real.maxDD <= 20 && r.c1.real.maxDD <= roundTo(1.2 * r.f3.real.maxDD, 2)).length;
  const crit4_RiskDrawdown = ddConditionCount >= 8;

  // Condition 5: C1 short returns > 0 in >= 8 of 14 markets; OR evaluate C1L
  const c1ShortPosCount = records.filter((r) => r.c1.real.returnShort > 0).length;
  const crit5_ShortPositive = c1ShortPosCount >= 8;

  const criteria = {
    crit1_ReturnDD: crit1_ReturnDD,
    crit2_D2Robustness: crit2_D2Robustness,
    crit3_NullSignificance: crit3_NullSignificance,
    crit4_RiskDrawdown: crit4_RiskDrawdown,
    crit5_ShortPositive: crit5_ShortPositive,
  };

  const allPassed = crit1_ReturnDD && crit2_D2Robustness && crit3_NullSignificance && crit4_RiskDrawdown && crit5_ShortPositive;
  const verdict: 'ACCEPTED' | 'REJECTED' = allPassed ? 'ACCEPTED' : 'REJECTED';

  console.log('\n========================================');
  console.log('=== EVALUATION OF ACCEPTANCE CRITERIA ===');
  console.log(`Condition 1 (Return/DD): ${crit1_ReturnDD ? 'PASS' : 'FAIL'} (Unseen Primary: ${unseenPrimaryPassCount}/5, OOS: ${oosPassCount}/8)`);
  console.log(`Condition 2 (D2 Robustness): ${crit2_D2Robustness ? 'PASS' : 'FAIL'} (C1 D2 Mean: ${c1D2Mean}%, F3 D2 Mean: ${f3D2Mean}%, D2 > 0: ${c1D2PosCount}/14)`);
  console.log(`Condition 3 (Null-1 & Null-2): ${crit3_NullSignificance ? 'PASS' : 'FAIL'} (Null-1 >= 75%: ${null1Pct75Count}/14, Null-2 >= 75%: ${null2Pct75Count}/14)`);
  console.log(`Condition 4 (DD Control <=20% & <=1.2x F3): ${crit4_RiskDrawdown ? 'PASS' : 'FAIL'} (${ddConditionCount}/13 markets)`);
  console.log(`Condition 5 (Short Positive): ${crit5_ShortPositive ? 'PASS' : 'FAIL'} (${c1ShortPosCount}/14 markets)`);
  console.log(`FINAL VERDICT: ${verdict}`);
  console.log('========================================\n');

  // Save full data JSON
  const outputDataPath = path.resolve('docs/review/pn_data.json');
  fs.writeFileSync(outputDataPath, JSON.stringify({ records, criteria, verdict }, null, 2), 'utf-8');
  console.log(`Saved full evaluation data to ${outputDataPath}`);

  return { records, criteria, verdict };
}

if (require.main === module) {
  runPn3Evaluation().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
