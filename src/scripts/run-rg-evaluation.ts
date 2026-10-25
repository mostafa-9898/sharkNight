import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle, TradeSignal } from '../data/models';
import type { Trade, BacktestConfig } from '../backtest/types';
import type { Strategy } from '../strategies/types';
import { MultiTimeframeStrategy, type RegimeVariant } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';
import { detrendCandlesByYear } from './run-rc4-detrend';
import {
  createDailyRegimeCalculatorFromDailyCandles,
  aggregateToUtcDaily,
  getDailyCandlesForSymbol,
  type DailyRegimeCalculator,
} from '../utils/market-regime';

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

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDistinctIndices(total: number, k: number, rng: () => number): number[] {
  if (k >= total) return Array.from({ length: total }, (_, i) => i);
  const selected = new Set<number>();
  while (selected.size < k) {
    selected.add(Math.floor(rng() * total));
  }
  return Array.from(selected);
}

function calcPf(trades: Trade[]): number {
  const gp = trades.filter((t) => (t.pnl || 0) > 0).reduce((acc, t) => acc + (t.pnl || 0), 0);
  const gl = Math.abs(trades.filter((t) => (t.pnl || 0) < 0).reduce((acc, t) => acc + (t.pnl || 0), 0));
  return gl > 0 ? roundTo(gp / gl, 2) : gp > 0 ? 99.99 : 0;
}

class RandomEntryStrategy implements Strategy {
  readonly name = 'RandomEntryStrategy';
  readonly description = 'Simulated random entry in eligible regime direction';
  readonly requiredCandles = 1;
  constructor(private signals: Int8Array) {}

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const dir = this.signals[currentIndex];
    if (dir === 1) {
      return { action: 'BUY', timestamp: candles[currentIndex].timestamp, price: candles[currentIndex].close };
    }
    if (dir === -1) {
      return { action: 'SELL', timestamp: candles[currentIndex].timestamp, price: candles[currentIndex].close };
    }
    return { action: 'HOLD', timestamp: candles[currentIndex]?.timestamp ?? 0, price: candles[currentIndex]?.close ?? 0 };
  }
}

export interface MetricSet {
  totalReturn: number;
  maxDD: number;
  returnDdRatio: number;
  trades: number;
  longReturn: number;
  longTrades: number;
  shortReturn: number;
  shortTrades: number;
  nullPctTotal: number;
  nullPctLong: number;
  nullPctShort: number;
  return2022?: number;
}

export interface MarketVariantResult {
  market: string;
  isOos: boolean;
  baselineLO: { real: MetricSet; detrended: MetricSet };
  baselineLS: { real: MetricSet; detrended: MetricSet };
  variants: Record<string, { real: MetricSet; detrended: MetricSet }>;
}

export interface VariantSummary {
  variant: string;
  label: string;
  // Criteria
  criteriaA_primaryPass: number;
  criteriaA_oosPass: number;
  criteriaA_passed: boolean;
  criteriaB_detrendAvg: number;
  criteriaB_posMarkets: number;
  criteriaB_passed: boolean;
  criteriaC_violatingMarkets: string[];
  criteriaC_passed: boolean;
  criteriaD_return2022Avg: number;
  criteriaD_passed: boolean;
  overallPassed: boolean;
  // Performance averages
  realReturnAvg: number;
  realMaxDDAvg: number;
  realReturnDdRatioAvg: number;
  detrendReturnAvg: number;
  detrendLongAvg: number;
  detrendShortAvg: number;
  nullPctTotalAvg: number;
  nullPctLongAvg: number;
  nullPctShortAvg: number;
  longTradesAvg: number;
  shortTradesAvg: number;
}

export async function runRgEvaluation() {
  console.log('=== Starting RG Program: Macro Regime Evaluation (G1 to G5) ===');
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

  console.log('Loading raw candle datasets and computing calendar-year detrended series...');
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

  // Prepare daily candles and calculators for both real and detrended
  const dailyRegimeCalcsReal: Record<string, DailyRegimeCalculator> = {};
  const dailyRegimeCalcsDetrend: Record<string, DailyRegimeCalculator> = {};

  for (const sym of allSymbols) {
    const dailyReal = getDailyCandlesForSymbol(sym, dataDir);
    dailyRegimeCalcsReal[sym] = createDailyRegimeCalculatorFromDailyCandles(dailyReal);

    // For detrended daily candles, aggregate from 1h detrended candles
    const detrend1h = detrendedCandles[sym]['1h'];
    const dailyDetrend = aggregateToUtcDaily(detrend1h);
    dailyRegimeCalcsDetrend[sym] = createDailyRegimeCalculatorFromDailyCandles(dailyDetrend);
  }

  const engine = new BacktestEngine();

  const baseEngineConfig: Omit<BacktestConfig, 'strategy' | 'candles'> = {
    initialBalance: 10000,
    positionSizePercent: 3,
    maxOpenPositions: 10,
    maxTotalExposurePercent: 30,
    minBarsBetweenEntries: 0,
    allowOppositePositions: true,
    tradeFeePercent: 0.1,
    exitMode: 'trailingOnly' as const,
    trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' as const },
    tradeMode: 'long-short' as const,
  };

  const compute2022Return = (res: ReturnType<BacktestEngine['run']>, candles: Candle[]): number => {
    const eqCurve = res.equity;
    const points: Array<{ ts: number; eq: number }> = [];
    for (let i = 0; i < candles.length && i < eqCurve.length; i++) {
      const yr = new Date(candles[i].timestamp).getUTCFullYear();
      if (yr === 2022) {
        points.push({ ts: candles[i].timestamp, eq: eqCurve[i] });
      }
    }
    if (points.length < 2) return 0.0;
    const firstEq = points[0].eq;
    const lastEq = points[points.length - 1].eq;
    return roundTo(((lastEq - firstEq) / firstEq) * 100, 2);
  };

  const marketResults: MarketVariantResult[] = [];

  for (let mIdx = 0; mIdx < allMarkets.length; mIdx++) {
    const m = allMarkets[mIdx];
    console.log(`[${mIdx + 1}/14] Processing evaluation for market ${m.key}...`);

    const cLtfReal = rawCandles[m.sym][m.tf];
    const c1hReal = rawCandles[m.sym]['1h'];
    const c4hReal = rawCandles[m.sym]['4h'];
    const dailyCalcReal = dailyRegimeCalcsReal[m.sym];

    const cLtfDetrend = detrendedCandles[m.sym][m.tf];
    const c1hDetrend = detrendedCandles[m.sym]['1h'];
    const c4hDetrend = detrendedCandles[m.sym]['4h'];
    const dailyCalcDetrend = dailyRegimeCalcsDetrend[m.sym];

    // Helper to instantiate strategy
    const makeStrat = (
      candles1h: Candle[],
      candles4h: Candle[],
      dailyCalc: DailyRegimeCalculator,
      variant?: RegimeVariant
    ) => {
      return new MultiTimeframeStrategy({
        kijunSlopeFilter: true,
        structureFilter: true,
        htf1hCandles: candles1h,
        htf4hCandles: candles4h,
        dailyRegimeCalculator: dailyCalc,
        regimeVariant: variant,
      });
    };

    const stratBaseReal = makeStrat(c1hReal, c4hReal, dailyCalcReal);
    const stratBaseDetrend = makeStrat(c1hDetrend, c4hDetrend, dailyCalcDetrend);

    // Precompute eligible candles once per dataset
    const buildEligible = (strat: MultiTimeframeStrategy, candles: Candle[]) => {
      const bull: number[] = [];
      const bear: number[] = [];
      for (let idx = 0; idx < candles.length; idx++) {
        const reg = strat.getMacroRegimeAt(candles, idx);
        if (reg === 'Bull') bull.push(idx);
        else if (reg === 'Bear') bear.push(idx);
      }
      return { bull, bear };
    };

    const eligReal = buildEligible(stratBaseReal, cLtfReal);
    const eligibleAllReal: Array<{ idx: number; dir: 1 | -1 }> = [
      ...eligReal.bull.map((idx) => ({ idx, dir: 1 as const })),
      ...eligReal.bear.map((idx) => ({ idx, dir: -1 as const })),
    ];
    const eligibleG3Real: Array<{ idx: number; dir: 1 | -1 }> = eligReal.bull.map((idx) => ({ idx, dir: 1 as const }));

    const eligDetrend = buildEligible(stratBaseDetrend, cLtfDetrend);
    const eligibleAllDetrend: Array<{ idx: number; dir: 1 | -1 }> = [
      ...eligDetrend.bull.map((idx) => ({ idx, dir: 1 as const })),
      ...eligDetrend.bear.map((idx) => ({ idx, dir: -1 as const })),
    ];
    const eligibleG3Detrend: Array<{ idx: number; dir: 1 | -1 }> = eligDetrend.bull.map((idx) => ({ idx, dir: 1 as const }));

    const evaluateSingleRun = (
      strategy: Strategy,
      candles: Candle[],
      engineOverride: Partial<BacktestConfig> = {},
      eligible: Array<{ idx: number; dir: 1 | -1 }> = [],
      runNullSims: boolean = true
    ): MetricSet => {
      const fullConfig: BacktestConfig = {
        ...baseEngineConfig,
        ...engineOverride,
        strategy,
        candles,
      };

      const res = engine.run(fullConfig);
      const lTrades = res.trades.filter((t) => t.side === 'long');
      const sTrades = res.trades.filter((t) => t.side === 'short');
      const lPnl = lTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
      const sPnl = sTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

      const totRet = res.metrics.totalPnlPercent;
      const maxDD = res.metrics.maxDrawdownPercent;
      const returnDd = maxDD > 0.001 ? roundTo(totRet / maxDD, 2) : roundTo(totRet / 0.01, 2);
      const lRet = roundTo((lPnl / 10000) * 100, 2);
      const sRet = roundTo((sPnl / 10000) * 100, 2);

      let nullPctTotal = 50.0;
      let nullPctLong = 50.0;
      let nullPctShort = 50.0;

      if (runNullSims && res.metrics.totalTrades > 0 && eligible.length > 0) {
        // Calibrate multiplier
        const targetTrades = res.metrics.totalTrades;
        const calibSeeds = [42, 43, 44];
        let bestM = 1.0;
        let bestDiff = Infinity;
        const candidateMs = [0.8, 1.0, 1.3, 1.8];
        const sigArr = new Int8Array(candles.length);

        for (const cm of candidateMs) {
          let simTrades = 0;
          const count = Math.min(eligible.length, Math.max(1, Math.round(targetTrades * cm)));
          for (const seed of calibSeeds) {
            const rng = mulberry32(seed);
            const chosen = sampleDistinctIndices(eligible.length, count, rng);
            sigArr.fill(0);
            for (const itemIdx of chosen) {
              sigArr[eligible[itemIdx].idx] = eligible[itemIdx].dir;
            }
            const simRes = engine.run({
              ...fullConfig,
              strategy: new RandomEntryStrategy(sigArr),
              candles,
            });
            simTrades += simRes.metrics.totalTrades;
          }
          const avgTrd = simTrades / calibSeeds.length;
          const diff = Math.abs(avgTrd - targetTrades) / Math.max(1, targetTrades);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestM = cm;
          }
          if (diff <= 0.08) break;
        }

        // Run 200 Null simulations
        const nullTotals: number[] = [];
        const nullLongs: number[] = [];
        const nullShorts: number[] = [];
        const count = Math.min(eligible.length, Math.max(1, Math.round(targetTrades * bestM)));

        for (let i = 0; i < 200; i++) {
          const seed = 42 + i;
          const rng = mulberry32(seed);
          const chosen = sampleDistinctIndices(eligible.length, count, rng);
          sigArr.fill(0);
          for (const itemIdx of chosen) {
            sigArr[eligible[itemIdx].idx] = eligible[itemIdx].dir;
          }
          const simRes = engine.run({
            ...fullConfig,
            strategy: new RandomEntryStrategy(sigArr),
            candles,
          });
          const sLTrades = simRes.trades.filter((t) => t.side === 'long');
          const sSTrades = simRes.trades.filter((t) => t.side === 'short');
          const sLPnl = sLTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
          const sSPnl = sSTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

          nullTotals.push(simRes.metrics.totalPnlPercent);
          nullLongs.push(roundTo((sLPnl / 10000) * 100, 2));
          nullShorts.push(roundTo((sSPnl / 10000) * 100, 2));
        }

        const calcEmpiricalPct = (arr: number[], val: number) => {
          const strictlyBelow = arr.filter((x) => x < val).length;
          const equal = arr.filter((x) => x === val).length;
          return roundTo(((strictlyBelow + 0.5 * equal) / arr.length) * 100, 1);
        };

        nullPctTotal = calcEmpiricalPct(nullTotals, totRet);
        nullPctLong = calcEmpiricalPct(nullLongs, lRet);
        nullPctShort = calcEmpiricalPct(nullShorts, sRet);
      }

      return {
        totalReturn: totRet,
        maxDD,
        returnDdRatio: returnDd,
        trades: res.metrics.totalTrades,
        longReturn: lRet,
        longTrades: lTrades.length,
        shortReturn: sRet,
        shortTrades: sTrades.length,
        nullPctTotal,
        nullPctLong,
        nullPctShort,
        return2022: compute2022Return(res, candles),
      };
    };

    // 1. Baselines (real and detrended)
    const baseLOReal = evaluateSingleRun(stratBaseReal, cLtfReal, { tradeMode: 'long-only' }, [], false);
    const baseLODetrend = evaluateSingleRun(stratBaseDetrend, cLtfDetrend, { tradeMode: 'long-only' }, [], false);

    const baseLSReal = evaluateSingleRun(stratBaseReal, cLtfReal, { tradeMode: 'long-short' }, [], false);
    const baseLSDetrend = evaluateSingleRun(stratBaseDetrend, cLtfDetrend, { tradeMode: 'long-short' }, [], false);

    // 2. Candidate Variants G1 to G5
    const variantKeys: RegimeVariant[] = ['G1', 'G2', 'G3', 'G4', 'G5'];
    const variantsData: Record<string, { real: MetricSet; detrended: MetricSet }> = {};

    for (const vKey of variantKeys) {
      const stratVReal = makeStrat(c1hReal, c4hReal, dailyCalcReal, vKey);
      const stratVDetrend = makeStrat(c1hDetrend, c4hDetrend, dailyCalcDetrend, vKey);

      let engineOverrideReal: Partial<BacktestConfig> = {};
      let engineOverrideDetrend: Partial<BacktestConfig> = {};

      if (vKey === 'G2') {
        const g2ShortTrailing = { initialStopPercent: 3, stepPercent: 2, raisePercent: 1, mode: 'stepped' as const };
        engineOverrideReal = { trailingStopShort: g2ShortTrailing };
        engineOverrideDetrend = { trailingStopShort: g2ShortTrailing };
      } else if (vKey === 'G3') {
        engineOverrideReal = { tradeMode: 'long-only' };
        engineOverrideDetrend = { tradeMode: 'long-only' };
      } else if (vKey === 'G4') {
        engineOverrideReal = {
          regimeExit: true,
          getMacroRegime: (cs, idx) => stratVReal.getMacroRegimeAt(cs, idx),
        };
        engineOverrideDetrend = {
          regimeExit: true,
          getMacroRegime: (cs, idx) => stratVDetrend.getMacroRegimeAt(cs, idx),
        };
      } else if (vKey === 'G5') {
        engineOverrideReal = { positionSizePercent: 100, riskPerTradePercent: 0.5 };
        engineOverrideDetrend = { positionSizePercent: 100, riskPerTradePercent: 0.5 };
      }

      const eligibleForVReal = vKey === 'G3' ? eligibleG3Real : eligibleAllReal;
      const eligibleForVDetrend = vKey === 'G3' ? eligibleG3Detrend : eligibleAllDetrend;

      const realMetrics = evaluateSingleRun(stratVReal, cLtfReal, engineOverrideReal, eligibleForVReal, true);
      const detrendMetrics = evaluateSingleRun(stratVDetrend, cLtfDetrend, engineOverrideDetrend, eligibleForVDetrend, true);

      variantsData[vKey] = {
        real: realMetrics,
        detrended: detrendMetrics,
      };
    }

    marketResults.push({
      market: m.key,
      isOos: m.isOos,
      baselineLO: { real: baseLOReal, detrended: baseLODetrend },
      baselineLS: { real: baseLSReal, detrended: baseLSDetrend },
      variants: variantsData,
    });
  }

  // Save full evaluation data to JSON
  const jsonPath = path.resolve('docs/review/rg_evaluation_data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(marketResults, null, 2), 'utf-8');
  console.log(`\nEvaluation dataset saved to ${jsonPath}`);

  // Evaluate the 4 criteria across all 5 variants
  const variantLabels: Record<RegimeVariant, string> = {
    G1: 'G1 (Base Regime: Long in Bull, Short in Bear, Neutral off)',
    G2: 'G2 (G1 + Fast Short Trailing 3/2/1)',
    G3: 'G3 (G1 Long-Only Regime Reference)',
    G4: 'G4 (G1 + Forced Exit on Opposite Regime Flip)',
    G5: 'G5 (G1 + Fixed Risk Sizing 0.5%)',
  };

  const summaries: VariantSummary[] = [];

  for (const vKey of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) {
    let primaryPassCountA = 0;
    let oosPassCountA = 0;
    let detrendPosCountB = 0;
    let detrendSumB = 0;
    const violatingMarketsC: string[] = [];
    let return2022SumD = 0;
    let primaryCount2022 = 0;

    let realRetSum = 0;
    let realDDSum = 0;
    let realRatioSum = 0;
    let detrendLongSum = 0;
    let detrendShortSum = 0;
    let nullTotalSum = 0;
    let nullLongSum = 0;
    let nullShortSum = 0;
    let longTradesSum = 0;
    let shortTradesSum = 0;

    for (const mr of marketResults) {
      const vReal = mr.variants[vKey].real;
      const vDetrend = mr.variants[vKey].detrended;
      const baseLO = mr.baselineLO.real;
      const baseLS = mr.baselineLS.real;

      // Criterion (a): Return/DD in real market >= both S1 LO and S1 LS
      const beatsLO = vReal.returnDdRatio >= baseLO.returnDdRatio;
      const beatsLS = vReal.returnDdRatio >= baseLS.returnDdRatio;
      if (beatsLO && beatsLS) {
        if (!mr.isOos) primaryPassCountA++;
        else oosPassCountA++;
      }

      // Criterion (b): Detrended return
      detrendSumB += vDetrend.totalReturn;
      if (vDetrend.totalReturn > 0) {
        detrendPosCountB++;
      }

      // Criterion (c): MaxDD <= 20% and not worse than 1.2 * baseline
      // Baseline maxDD: maximum of LO and LS
      const baselineMaxDD = Math.max(baseLO.maxDD, baseLS.maxDD);
      const isDdViolated = vReal.maxDD > 20.0 || vReal.maxDD > 1.2 * baselineMaxDD;
      if (isDdViolated) {
        violatingMarketsC.push(`${mr.market} (DD=${vReal.maxDD}%, BaseMax=${baselineMaxDD}%)`);
      }

      // Criterion (d): 2022 compound return on primary markets
      if (!mr.isOos && vReal.return2022 !== undefined) {
        return2022SumD += vReal.return2022;
        primaryCount2022++;
      }

      // Aggregates
      realRetSum += vReal.totalReturn;
      realDDSum += vReal.maxDD;
      realRatioSum += vReal.returnDdRatio;
      detrendLongSum += vDetrend.longReturn;
      detrendShortSum += vDetrend.shortReturn;
      nullTotalSum += vReal.nullPctTotal;
      nullLongSum += vReal.nullPctLong;
      nullShortSum += vReal.nullPctShort;
      longTradesSum += vReal.longTrades;
      shortTradesSum += vReal.shortTrades;
    }

    const n = marketResults.length;
    const detrendAvgB = roundTo(detrendSumB / n, 2);
    const return2022AvgD = primaryCount2022 > 0 ? roundTo(return2022SumD / primaryCount2022, 2) : 0;

    const passA = primaryPassCountA >= 4 && oosPassCountA >= 5;
    const passB = detrendAvgB > 0.0 && detrendPosCountB >= 8;
    const passC = violatingMarketsC.length === 0;
    const passD = return2022AvgD >= 0.0;
    const overall = passA && passB && passC && passD;

    summaries.push({
      variant: vKey,
      label: variantLabels[vKey],
      criteriaA_primaryPass: primaryPassCountA,
      criteriaA_oosPass: oosPassCountA,
      criteriaA_passed: passA,
      criteriaB_detrendAvg: detrendAvgB,
      criteriaB_posMarkets: detrendPosCountB,
      criteriaB_passed: passB,
      criteriaC_violatingMarkets: violatingMarketsC,
      criteriaC_passed: passC,
      criteriaD_return2022Avg: return2022AvgD,
      criteriaD_passed: passD,
      overallPassed: overall,
      realReturnAvg: roundTo(realRetSum / n, 2),
      realMaxDDAvg: roundTo(realDDSum / n, 2),
      realReturnDdRatioAvg: roundTo(realRatioSum / n, 2),
      detrendReturnAvg: detrendAvgB,
      detrendLongAvg: roundTo(detrendLongSum / n, 2),
      detrendShortAvg: roundTo(detrendShortSum / n, 2),
      nullPctTotalAvg: roundTo(nullTotalSum / n, 1),
      nullPctLongAvg: roundTo(nullLongSum / n, 1),
      nullPctShortAvg: roundTo(nullShortSum / n, 1),
      longTradesAvg: Math.round(longTradesSum / n),
      shortTradesAvg: Math.round(shortTradesSum / n),
    });
  }

  // Print Summary Table to console
  console.log('\n========================================================================================');
  console.log('                          RG PROGRAM: EVALUATION SUMMARY                                ');
  console.log('========================================================================================');
  for (const s of summaries) {
    console.log(`\nVariant ${s.variant}: ${s.label}`);
    console.log(`  - Condition (a) Real Return/DD >= LO & LS: Primary ${s.criteriaA_primaryPass}/6 (req >=4), OOS ${s.criteriaA_oosPass}/8 (req >=5) -> ${s.criteriaA_passed ? 'PASS' : 'FAIL'}`);
    console.log(`  - Condition (b) Detrended Return: Avg=${s.criteriaB_detrendAvg}% (req >0), Positive=${s.criteriaB_posMarkets}/14 (req >=8) -> ${s.criteriaB_passed ? 'PASS' : 'FAIL'}`);
    console.log(`  - Condition (c) MaxDD <= 20% & <= 1.2x Base: Violations=${s.criteriaC_violatingMarkets.length} -> ${s.criteriaC_passed ? 'PASS' : 'FAIL'}${s.criteriaC_violatingMarkets.length > 0 ? ` (${s.criteriaC_violatingMarkets.join(', ')})` : ''}`);
    console.log(`  - Condition (d) 2022 Bear 6-Market Avg Return: ${s.criteriaD_return2022Avg}% (req >=0) -> ${s.criteriaD_passed ? 'PASS' : 'FAIL'}`);
    console.log(`  ==> OVERALL RESULT: ${s.overallPassed ? 'PASS' : 'FAIL'}`);
    console.log(`  [Metrics] Real Ret: ${s.realReturnAvg}%, MaxDD: ${s.realMaxDDAvg}%, Ret/DD: ${s.realReturnDdRatioAvg}, Detrend Ret: ${s.detrendReturnAvg}% (L: ${s.detrendLongAvg}%, S: ${s.detrendShortAvg}%), Null Pct: Tot ${s.nullPctTotalAvg}%, L ${s.nullPctLongAvg}%, S ${s.nullPctShortAvg}%`);
  }
  console.log('========================================================================================\n');

  return { marketResults, summaries };
}

// Allow CLI execution
if (require.main === module) {
  runRgEvaluation().catch((err) => {
    console.error('Fatal error in runRgEvaluation:', err);
    process.exit(1);
  });
}
