import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle, TradeSignal } from '../data/models';
import type { Trade } from '../backtest/types';
import type { Strategy } from '../strategies/types';
import { MultiTimeframeStrategy, type EdgeCandidate } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';
import { detrendCandlesByYear } from './run-rc4-detrend';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDistinctIndices(total: number, count: number, rng: () => number): number[] {
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

class RandomEntryStrategy implements Strategy {
  readonly name = 'RandomEntryStrategy';
  readonly description = 'Simulated random entry aligned with strict HTF direction';
  readonly requiredCandles = 1;

  constructor(private readonly signals: Map<number, 1 | -1>) {}

  analyze(candles: readonly Candle[], currentIndex: number): TradeSignal {
    const dir = this.signals.get(currentIndex);
    if (dir === 1) {
      return { action: 'BUY', timestamp: candles[currentIndex].timestamp, price: candles[currentIndex].close };
    }
    if (dir === -1) {
      return { action: 'SELL', timestamp: candles[currentIndex].timestamp, price: candles[currentIndex].close };
    }
    return { action: 'HOLD', timestamp: candles[currentIndex]?.timestamp ?? 0, price: candles[currentIndex]?.close ?? 0 };
  }
}

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

function calcPf(trades: Trade[]): number {
  const gp = trades.filter((t) => (t.pnl || 0) > 0).reduce((acc, t) => acc + (t.pnl || 0), 0);
  const gl = Math.abs(trades.filter((t) => (t.pnl || 0) < 0).reduce((acc, t) => acc + (t.pnl || 0), 0));
  return gl > 0 ? roundTo(gp / gl, 2) : gp > 0 ? 99.99 : 0;
}

export interface CandidateRunResult {
  totalReturn: number;
  maxDD: number;
  pf: number;
  trades: number;
  longReturn: number;
  longPf: number;
  longTrades: number;
  shortReturn: number;
  shortPf: number;
  shortTrades: number;
  nullPctTotal: number;
}

export interface MarketCandidateData {
  market: string;
  isOos: boolean;
  baseline: { real: CandidateRunResult; detrended: CandidateRunResult };
  candidates: Record<string, { real: CandidateRunResult; detrended: CandidateRunResult }>;
}

export interface CandidateSummary {
  name: string;
  label: string;
  criteriaA: boolean; // Delta Long > 0 and Delta Short > 0 on detrended
  criteriaB: boolean; // >= 4 of 6 primary and >= 5 of 8 OOS improved
  criteriaC: boolean; // Real maxDD <= 1.2 * baseline maxDD and <= 20%
  criteriaD: boolean; // Real total return >= 0.80 * baseline return
  overallPassed: boolean;
  deltaDetrendedLongAvg: number;
  deltaDetrendedShortAvg: number;
  deltaDetrendedTotalAvg: number;
  primaryPassCount: number;
  oosPassCount: number;
  realTotalReturnAvg: number;
  realMaxDDAvg: number;
  baselineRealReturnAvg: number;
  baselineRealMaxDDAvg: number;
  baselineDetrendedLongAvg: number;
  baselineDetrendedShortAvg: number;
  baselineDetrendedTotalAvg: number;
}

export async function runAl4Candidates() {
  console.log('Running AL4: Edge Candidates Evaluation (A1 to A6) across 14 markets...');
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

  const al2Path = path.resolve('docs/review/alpha_attribution_data.json');
  const al2Data = fs.existsSync(al2Path) ? JSON.parse(fs.readFileSync(al2Path, 'utf-8')) : [];

  const engine = new BacktestEngine();

  const baseEngineConfig = {
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

  // Helper to execute backtest and extract metrics
  const executeBacktest = (
    strategy: Strategy,
    candles: Candle[],
    customEngineConfig: Partial<typeof baseEngineConfig> = {}
  ): CandidateRunResult => {
    const res = engine.run({
      ...baseEngineConfig,
      ...customEngineConfig,
      strategy,
      candles,
    });
    const lTrades = res.trades.filter((t) => t.side === 'long');
    const sTrades = res.trades.filter((t) => t.side === 'short');
    const lPnl = lTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
    const sPnl = sTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);

    return {
      totalReturn: res.metrics.totalPnlPercent,
      maxDD: res.metrics.maxDrawdownPercent,
      pf: calcPf(res.trades),
      trades: res.metrics.totalTrades,
      longReturn: roundTo((lPnl / 10000) * 100, 2),
      longPf: calcPf(lTrades),
      longTrades: lTrades.length,
      shortReturn: roundTo((sPnl / 10000) * 100, 2),
      shortPf: calcPf(sTrades),
      shortTrades: sTrades.length,
      nullPctTotal: 50, // default, updated with null simulations
    };
  };

  // First pass: Run Baseline and Candidates A1 through A5 across all markets
  const marketResults: MarketCandidateData[] = [];

  for (const m of allMarkets) {
    console.log(`Processing candidate backtests for ${m.key}...`);
    const cLtfReal = rawCandles[m.sym][m.tf];
    const c1hReal = rawCandles[m.sym]['1h'];
    const c4hReal = rawCandles[m.sym]['4h'];

    const cLtfDetrend = detrendedCandles[m.sym][m.tf];
    const c1hDetrend = detrendedCandles[m.sym]['1h'];
    const c4hDetrend = detrendedCandles[m.sym]['4h'];

    // 1. Baseline S1
    const stratS1Real = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
    });
    const stratS1Detrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
    });
    const baseReal = executeBacktest(stratS1Real, cLtfReal);
    const baseDetrend = executeBacktest(stratS1Detrend, cLtfDetrend);

    // 2. Candidate A1: ATR Trailing Stop (2.5 / 2.0 / 1.0)
    const stratA1Real = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A1',
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
    });
    const stratA1Detrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A1',
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
    });
    const a1Real = executeBacktest(stratA1Real, cLtfReal);
    const a1Detrend = executeBacktest(stratA1Detrend, cLtfDetrend);

    // 3. Candidate A2: Pullback to Kijun + Stoch cross
    const stratA2Real = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A2',
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
    });
    const stratA2Detrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A2',
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
    });
    const a2Real = executeBacktest(stratA2Real, cLtfReal);
    const a2Detrend = executeBacktest(stratA2Detrend, cLtfDetrend);

    // 4. Candidate A3: Volatility Filter (ATR/Close > 100-bar median)
    const stratA3Real = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A3',
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
    });
    const stratA3Detrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A3',
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
    });
    const a3Real = executeBacktest(stratA3Real, cLtfReal);
    const a3Detrend = executeBacktest(stratA3Detrend, cLtfDetrend);

    // 5. Candidate A4: 1d Strict Alignment
    const stratA4Real = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A4',
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
    });
    const stratA4Detrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A4',
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
    });
    const a4Real = executeBacktest(stratA4Real, cLtfReal);
    const a4Detrend = executeBacktest(stratA4Detrend, cLtfDetrend);

    // 6. Candidate A5: Volatility Position Sizing (Risk 0.5% / stop distance)
    const a5EngineConfig = {
      positionSizePercent: 100,
      riskPerTradePercent: 0.5,
    };
    const a5Real = executeBacktest(stratS1Real, cLtfReal, a5EngineConfig);
    const a5Detrend = executeBacktest(stratS1Detrend, cLtfDetrend, a5EngineConfig);

    // 7. Load L0 Null simulation benchmark from AL2
    const marketL0 = al2Data.find((d: any) => d.market === m.key);
    const nullRealTotal = marketL0?.real?.L0?.totalReturn ?? 0;
    const nullDetrendTotal = marketL0?.detrended?.L0?.totalReturn ?? 0;

    baseReal.nullPctTotal = roundTo(baseReal.totalReturn - nullRealTotal, 2);
    baseDetrend.nullPctTotal = roundTo(baseDetrend.totalReturn - nullDetrendTotal, 2);

    a1Real.nullPctTotal = roundTo(a1Real.totalReturn - nullRealTotal, 2);
    a1Detrend.nullPctTotal = roundTo(a1Detrend.totalReturn - nullDetrendTotal, 2);

    a2Real.nullPctTotal = roundTo(a2Real.totalReturn - nullRealTotal, 2);
    a2Detrend.nullPctTotal = roundTo(a2Detrend.totalReturn - nullDetrendTotal, 2);

    a3Real.nullPctTotal = roundTo(a3Real.totalReturn - nullRealTotal, 2);
    a3Detrend.nullPctTotal = roundTo(a3Detrend.totalReturn - nullDetrendTotal, 2);

    a4Real.nullPctTotal = roundTo(a4Real.totalReturn - nullRealTotal, 2);
    a4Detrend.nullPctTotal = roundTo(a4Detrend.totalReturn - nullDetrendTotal, 2);

    a5Real.nullPctTotal = roundTo(a5Real.totalReturn - nullRealTotal, 2);
    a5Detrend.nullPctTotal = roundTo(a5Detrend.totalReturn - nullDetrendTotal, 2);

    marketResults.push({
      market: m.key,
      isOos: m.isOos,
      baseline: { real: baseReal, detrended: baseDetrend },
      candidates: {
        A1: { real: a1Real, detrended: a1Detrend },
        A2: { real: a2Real, detrended: a2Detrend },
        A3: { real: a3Real, detrended: a3Detrend },
        A4: { real: a4Real, detrended: a4Detrend },
        A5: { real: a5Real, detrended: a5Detrend },
      },
    });
  }

  // Evaluate A1 to A5 performance to pick the top 2 candidates for A6
  const candidateScores: Record<string, { deltaDetrendTotal: number; passCount: number }> = {
    A1: { deltaDetrendTotal: 0, passCount: 0 },
    A2: { deltaDetrendTotal: 0, passCount: 0 },
    A3: { deltaDetrendTotal: 0, passCount: 0 },
    A4: { deltaDetrendTotal: 0, passCount: 0 },
    A5: { deltaDetrendTotal: 0, passCount: 0 },
  };

  for (const cKey of ['A1', 'A2', 'A3', 'A4', 'A5'] as const) {
    for (const m of marketResults) {
      const deltaTotal = m.candidates[cKey].detrended.totalReturn - m.baseline.detrended.totalReturn;
      candidateScores[cKey].deltaDetrendTotal += deltaTotal;
      if (deltaTotal > 0) {
        candidateScores[cKey].passCount++;
      }
    }
  }

  console.log('Candidate Preliminary Detrended Improvements:', candidateScores);

  // Sort candidates by total detrended improvement
  const rankedCandidates = (['A1', 'A2', 'A3', 'A4', 'A5'] as const).sort(
    (a, b) => candidateScores[b].deltaDetrendTotal - candidateScores[a].deltaDetrendTotal
  );
  const topCandidate1 = rankedCandidates[0];
  const topCandidate2 = rankedCandidates[1];
  console.log(`Top 2 candidates selected for A6: ${topCandidate1} and ${topCandidate2}`);

  // Second pass: Run A6 (combination of top 2) across all 14 markets
  for (let i = 0; i < allMarkets.length; i++) {
    const m = allMarkets[i];
    const mRes = marketResults[i];

    const cLtfReal = rawCandles[m.sym][m.tf];
    const c1hReal = rawCandles[m.sym]['1h'];
    const c4hReal = rawCandles[m.sym]['4h'];

    const cLtfDetrend = detrendedCandles[m.sym][m.tf];
    const c1hDetrend = detrendedCandles[m.sym]['1h'];
    const c4hDetrend = detrendedCandles[m.sym]['4h'];

    const a6EngineConfig =
      topCandidate1 === 'A5' || topCandidate2 === 'A5'
        ? { positionSizePercent: 100, riskPerTradePercent: 0.5 }
        : {};

    const stratA6Real = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A6',
      a6Components: [topCandidate1, topCandidate2],
      htf1hCandles: c1hReal,
      htf4hCandles: c4hReal,
    });
    const stratA6Detrend = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      edgeCandidate: 'A6',
      a6Components: [topCandidate1, topCandidate2],
      htf1hCandles: c1hDetrend,
      htf4hCandles: c4hDetrend,
    });

    const a6Real = executeBacktest(stratA6Real, cLtfReal, a6EngineConfig);
    const a6Detrend = executeBacktest(stratA6Detrend, cLtfDetrend, a6EngineConfig);

    mRes.candidates['A6'] = { real: a6Real, detrended: a6Detrend };
  }

  // Compute criteria (الف, ب, ج, د) for each candidate
  const candidateNames: Record<string, string> = {
    A1: 'A1: حد ضرر متحرک پویا بر پایه‌ی ATR',
    A2: 'A2: پول‌بک به کیجون + کراس استوک',
    A3: 'A3: فیلتر رژیم نوسان (ATR/Close > میانه ۱۰۰)',
    A4: 'A4: انطباق روند روزانه (1d Strict)',
    A5: 'A5: تعیین حجم بر پایه‌ی نوسان (Risk 0.5% / Stop)',
    A6: `A6: ترکیب دو کاندیدای برتر (${topCandidate1} + ${topCandidate2})`,
  };

  const candidateSummaries: CandidateSummary[] = [];

  const candidateKeys = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] as const;

  const baselineRealReturnAvg = roundTo(
    marketResults.reduce((sum, m) => sum + m.baseline.real.totalReturn, 0) / marketResults.length,
    2
  );
  const baselineRealMaxDDAvg = roundTo(
    marketResults.reduce((sum, m) => sum + m.baseline.real.maxDD, 0) / marketResults.length,
    2
  );
  const baselineDetrendedLongAvg = roundTo(
    marketResults.reduce((sum, m) => sum + m.baseline.detrended.longReturn, 0) / marketResults.length,
    2
  );
  const baselineDetrendedShortAvg = roundTo(
    marketResults.reduce((sum, m) => sum + m.baseline.detrended.shortReturn, 0) / marketResults.length,
    2
  );
  const baselineDetrendedTotalAvg = roundTo(
    marketResults.reduce((sum, m) => sum + m.baseline.detrended.totalReturn, 0) / marketResults.length,
    2
  );

  for (const cKey of candidateKeys) {
    let primaryPassCount = 0;
    let oosPassCount = 0;
    let totalDetrendedLong = 0;
    let totalDetrendedShort = 0;
    let totalDetrendedTotal = 0;
    let totalRealReturn = 0;
    let totalRealMaxDD = 0;

    let allRealMaxDdOk = true;

    for (const m of marketResults) {
      const cDetrend = m.candidates[cKey].detrended;
      const bDetrend = m.baseline.detrended;
      const cReal = m.candidates[cKey].real;
      const bReal = m.baseline.real;

      totalDetrendedLong += cDetrend.longReturn;
      totalDetrendedShort += cDetrend.shortReturn;
      totalDetrendedTotal += cDetrend.totalReturn;
      totalRealReturn += cReal.totalReturn;
      totalRealMaxDD += cReal.maxDD;

      // Condition: improvement in detrended total return in this market
      const improvedInMarket = cDetrend.totalReturn > bDetrend.totalReturn;
      if (improvedInMarket) {
        if (!m.isOos) primaryPassCount++;
        else oosPassCount++;
      }

      // Check maxDD individual market constraint: <= 1.2 * baseline AND <= 20%
      if (cReal.maxDD > 20.0 || (bReal.maxDD > 0 && cReal.maxDD > bReal.maxDD * 1.2)) {
        allRealMaxDdOk = false;
      }
    }

    const detrendedLongAvg = roundTo(totalDetrendedLong / marketResults.length, 2);
    const detrendedShortAvg = roundTo(totalDetrendedShort / marketResults.length, 2);
    const detrendedTotalAvg = roundTo(totalDetrendedTotal / marketResults.length, 2);
    const realReturnAvg = roundTo(totalRealReturn / marketResults.length, 2);
    const realMaxDDAvg = roundTo(totalRealMaxDD / marketResults.length, 2);

    const deltaDetrendedLongAvg = roundTo(detrendedLongAvg - baselineDetrendedLongAvg, 2);
    const deltaDetrendedShortAvg = roundTo(detrendedShortAvg - baselineDetrendedShortAvg, 2);
    const deltaDetrendedTotalAvg = roundTo(detrendedTotalAvg - baselineDetrendedTotalAvg, 2);

    // شرط (الف): بهبود همزمان دو جهت در داده بدون رانش (Delta Long > 0 و Delta Short > 0)
    const criteriaA = deltaDetrendedLongAvg > 0 && deltaDetrendedShortAvg > 0;

    // شرط (ب): استواری بین‌بازاری (حداقل ۴ از ۶ بازار اصلی و ۵ از ۸ بازار OOS)
    const criteriaB = primaryPassCount >= 4 && oosPassCount >= 5;

    // شرط (ج): کنترل افت سرمایه در بازار واقعی (Real MaxDD <= 1.2 * Baseline AND Real MaxDD <= 20%)
    const criteriaC = realMaxDDAvg <= 1.2 * baselineRealMaxDDAvg && realMaxDDAvg <= 20.0 && allRealMaxDdOk;

    // شرط (د): حفظ توان سودآوری در بازار واقعی (Real Total Return >= 0.80 * Baseline)
    const criteriaD = realReturnAvg >= 0.8 * baselineRealReturnAvg;

    const overallPassed = criteriaA && criteriaB && criteriaC && criteriaD;

    candidateSummaries.push({
      name: cKey,
      label: candidateNames[cKey],
      criteriaA,
      criteriaB,
      criteriaC,
      criteriaD,
      overallPassed,
      deltaDetrendedLongAvg,
      deltaDetrendedShortAvg,
      deltaDetrendedTotalAvg,
      primaryPassCount,
      oosPassCount,
      realTotalReturnAvg: realReturnAvg,
      realMaxDDAvg,
      baselineRealReturnAvg,
      baselineRealMaxDDAvg,
      baselineDetrendedLongAvg,
      baselineDetrendedShortAvg,
      baselineDetrendedTotalAvg,
    });
  }

  // Save JSON data
  const outputJson = {
    metadata: {
      generatedAt: new Date().toISOString(),
      marketsCount: 14,
      primaryCount: 6,
      oosCount: 8,
      topCandidate1,
      topCandidate2,
      baselineRealReturnAvg,
      baselineRealMaxDDAvg,
      baselineDetrendedLongAvg,
      baselineDetrendedShortAvg,
      baselineDetrendedTotalAvg,
    },
    summaries: candidateSummaries,
    markets: marketResults,
  };

  fs.writeFileSync('docs/review/al4_candidates_data.json', JSON.stringify(outputJson, null, 2), 'utf-8');

  // Generate AL4_CANDIDATES.md
  let md = `# گزارش جامع ارزیابی ۶ کاندیدای مزیت استراتژی (AL4)\n\n`;
  md += `این سند گزارش آزمون تجربی و بدون اغماض ۶ کاندیدای پیش‌ثبت‌شده‌ی ارتقای مزیت معاملاتی (A1 تا A6) در **۱۴ بازار رمزارز** (۶ بازار اصلی + ۸ بازار خارج از نمونه OOS) بر روی داده‌های تاریخی واقعی و بدون رانش سالانه (Calendar-Year Detrended) با ارزیابی دقیق معیارهای ۴گانه AL1 است.\n\n`;
  md += `--- \n\n`;

  md += `## ۱. جدول خلاصه ارزیابی معیارهای چهارگانه AL1 برای تمام کاندیداها\n\n`;
  md += `| کاندیدا | شرح | شرط الف (بهبود لانگ و شورت بدون رانش) | شرط ب (استواری: $\\ge 4/6$ اصلی و $\\ge 5/8$ OOS) | شرط ج (افت سرمایه $\\le 1.2\\times$ پایه و $\\le 20\\%$) | شرط د (حفظ بازده $\\ge 80\\%$ پایه) | وضعیت نهایی |\n`;
  md += `|:---:|---|:---:|:---:|:---:|:---:|:---:|\n`;

  for (const s of candidateSummaries) {
    const markA = s.criteriaA ? '✅ PASS' : '❌ FAIL';
    const markB = s.criteriaB ? `✅ PASS (${s.primaryPassCount}/6, ${s.oosPassCount}/8)` : `❌ FAIL (${s.primaryPassCount}/6, ${s.oosPassCount}/8)`;
    const markC = s.criteriaC ? `✅ PASS (${s.realMaxDDAvg}%)` : `❌ FAIL (${s.realMaxDDAvg}%)`;
    const markD = s.criteriaD ? `✅ PASS (${s.realTotalReturnAvg}%)` : `❌ FAIL (${s.realTotalReturnAvg}%)`;
    const finalVerdict = s.overallPassed ? '**✅ PASSED**' : '**❌ REJECTED**';
    md += `| **${s.name}** | ${s.label} | ${markA} (L:${s.deltaDetrendedLongAvg>0?'+':''}${s.deltaDetrendedLongAvg}%, S:${s.deltaDetrendedShortAvg>0?'+':''}${s.deltaDetrendedShortAvg}%) | ${markB} | ${markC} | ${markD} | ${finalVerdict} |\n`;
  }

  md += `\n---\n\n`;
  md += `## ۲. مقایسه آماری میانگین عملکرد در ۱۴ بازار\n\n`;
  md += `| استراتژی / کاندیدا | بازده واقعی % | MaxDD واقعی % | بازده کل بدون رانش % | بازده لانگ بدون رانش % | بازده شورت بدون رانش % | $\\Delta$ بدون رانش کل |\n`;
  md += `|---|:---:|:---:|:---:|:---:|:---:|:---:|\n`;
  md += `| **پایه (S1 Baseline)** | **+${baselineRealReturnAvg}%** | **${baselineRealMaxDDAvg}%** | **${baselineDetrendedTotalAvg}%** | **${baselineDetrendedLongAvg}%** | **${baselineDetrendedShortAvg}%** | **0.00%** |\n`;

  for (const s of candidateSummaries) {
    const deltaSign = s.deltaDetrendedTotalAvg > 0 ? '+' : '';
    const detrendedTotal = roundTo(baselineDetrendedTotalAvg + s.deltaDetrendedTotalAvg, 2);
    const detrendedLong = roundTo(baselineDetrendedLongAvg + s.deltaDetrendedLongAvg, 2);
    const detrendedShort = roundTo(baselineDetrendedShortAvg + s.deltaDetrendedShortAvg, 2);
    md += `| **${s.name}** | ${s.realTotalReturnAvg > 0 ? '+' : ''}${s.realTotalReturnAvg}% | ${s.realMaxDDAvg}% | ${detrendedTotal > 0 ? '+' : ''}${detrendedTotal}% | ${detrendedLong > 0 ? '+' : ''}${detrendedLong}% | ${detrendedShort > 0 ? '+' : ''}${detrendedShort}% | ${deltaSign}${s.deltaDetrendedTotalAvg}% |\n`;
  }

  md += `\n---\n\n`;
  md += `## ۳. تحلیل تک‌تک کاندیداها و ریشه‌یابی علل رد/قبولی\n\n`;

  for (const s of candidateSummaries) {
    md += `### ۳.${candidateSummaries.indexOf(s) + 1}. ${s.label} (${s.name})\n`;
    md += `- **تغییرات بازدهی بدون رانش:** لانگ: ${s.deltaDetrendedLongAvg > 0 ? '+' : ''}${s.deltaDetrendedLongAvg}% | شورت: ${s.deltaDetrendedShortAvg > 0 ? '+' : ''}${s.deltaDetrendedShortAvg}% | کل: ${s.deltaDetrendedTotalAvg > 0 ? '+' : ''}${s.deltaDetrendedTotalAvg}%\n`;
    md += `- **استواری بین بازاری:** موفقیت در ${s.primaryPassCount} از ۶ بازار اصلی و ${s.oosPassCount} از ۸ بازار خارج از نمونه (OOS).\n`;
    md += `- **عملکرد در بازار واقعی:** بازده کل: ${s.realTotalReturnAvg}% (نسبت به پایه ${roundTo((s.realTotalReturnAvg / baselineRealReturnAvg) * 100, 1)}%) | بیشینه افت سرمایه: ${s.realMaxDDAvg}% (نسبت به پایه ${roundTo(s.realMaxDDAvg / baselineRealMaxDDAvg, 2)} برابر).\n`;
    md += `- **علت و نتیجه‌گیری:** `;
    if (s.overallPassed) {
      md += `این کاندیدا توانسته هر ۴ معیار را احراز کند.\n\n`;
    } else {
      const fails: string[] = [];
      if (!s.criteriaA) fails.push('عدم احراز شرط الف (عدم بهبود همزمان لانگ و شورت در داده بدون رانش)');
      if (!s.criteriaB) fails.push('عدم احراز شرط ب (استواری نامناسب در بازارهای اصلی یا OOS)');
      if (!s.criteriaC) fails.push('عدم احراز شرط ج (بیشینه افت سرمایه غیرقابل قبول در برخی بازارها)');
      if (!s.criteriaD) fails.push('عدم احراز شرط د (کاهش بیش از حد بازده بازار واقعی)');
      md += `به دلیل **${fails.join('، ')}** مردود اعلام می‌گردد.\n\n`;
    }
  }

  md += `\n---\n\n`;
  md += `## ۴. جزئیات عملکرد تفکیکی در ۱۴ بازار\n\n`;
  md += `| بازار | نوع | بازده پایه (واقعی / بدون رانش) | A1 (واقعی / رانش) | A2 (واقعی / رانش) | A3 (واقعی / رانش) | A4 (واقعی / رانش) | A5 (واقعی / رانش) | A6 (واقعی / رانش) |\n`;
  md += `|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|\n`;

  for (const m of marketResults) {
    const oosTag = m.isOos ? 'OOS' : 'اصلی';
    const bStr = `${m.baseline.real.totalReturn}% / ${m.baseline.detrended.totalReturn}%`;
    const a1Str = `${m.candidates['A1'].real.totalReturn}% / ${m.candidates['A1'].detrended.totalReturn}%`;
    const a2Str = `${m.candidates['A2'].real.totalReturn}% / ${m.candidates['A2'].detrended.totalReturn}%`;
    const a3Str = `${m.candidates['A3'].real.totalReturn}% / ${m.candidates['A3'].detrended.totalReturn}%`;
    const a4Str = `${m.candidates['A4'].real.totalReturn}% / ${m.candidates['A4'].detrended.totalReturn}%`;
    const a5Str = `${m.candidates['A5'].real.totalReturn}% / ${m.candidates['A5'].detrended.totalReturn}%`;
    const a6Str = `${m.candidates['A6'].real.totalReturn}% / ${m.candidates['A6'].detrended.totalReturn}%`;
    md += `| **${m.market}** | ${oosTag} | ${bStr} | ${a1Str} | ${a2Str} | ${a3Str} | ${a4Str} | ${a5Str} | ${a6Str} |\n`;
  }

  fs.writeFileSync('docs/review/AL4_CANDIDATES.md', md, 'utf-8');
  console.log('AL4 execution complete. Saved docs/review/al4_candidates_data.json and docs/review/AL4_CANDIDATES.md');
}

if (require.main === module) {
  runAl4Candidates().catch((err) => {
    console.error('Error running AL4:', err);
    process.exit(1);
  });
}
