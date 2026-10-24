import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import type { Trade } from '../backtest/types';
import { BacktestEngine } from '../backtest/engine';
import { MultiTimeframeStrategy, type ShortEntryFilter } from '../strategies/multi-timeframe-strategy';
import { createDailyRegimeCalculator, getDailyCandlesForSymbol, type DailyRegimeCalculator } from '../utils/market-regime';
import { roundTo } from '../utils/math';

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

interface VariantDefinition {
  id: string;
  name: string;
  type: 'trailing' | 'entry';
  trailingShort?: { initialStopPercent: number; stepPercent: number; raisePercent: number; mode: 'stepped' };
  shortEntryFilter: ShortEntryFilter;
}

export const SH4_VARIANTS: VariantDefinition[] = [
  {
    id: 'TR3',
    name: 'Baseline TR (5, 3, 1.5)',
    type: 'trailing',
    trailingShort: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    shortEntryFilter: 'none',
  },
  {
    id: 'TR1',
    name: 'Trailing (3, 2, 1)',
    type: 'trailing',
    trailingShort: { initialStopPercent: 3, stepPercent: 2, raisePercent: 1, mode: 'stepped' },
    shortEntryFilter: 'none',
  },
  {
    id: 'TR2',
    name: 'Trailing (4, 2.5, 1.25)',
    type: 'trailing',
    trailingShort: { initialStopPercent: 4, stepPercent: 2.5, raisePercent: 1.25, mode: 'stepped' },
    shortEntryFilter: 'none',
  },
  {
    id: 'TR4',
    name: 'Trailing (5, 4, 2)',
    type: 'trailing',
    trailingShort: { initialStopPercent: 5, stepPercent: 4, raisePercent: 2, mode: 'stepped' },
    shortEntryFilter: 'none',
  },
  {
    id: 'TR5',
    name: 'Trailing (6, 3, 1.5)',
    type: 'trailing',
    trailingShort: { initialStopPercent: 6, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    shortEntryFilter: 'none',
  },
  {
    id: 'V1',
    name: 'Entry 1d Bearish Confirmation',
    type: 'entry',
    trailingShort: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    shortEntryFilter: 'v1_1dBearish',
  },
  {
    id: 'V2',
    name: 'Entry LTF Price Below Cloud',
    type: 'entry',
    trailingShort: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    shortEntryFilter: 'v2_ltfBelowCloud',
  },
  {
    id: 'V3',
    name: 'Entry Bear Regime Only',
    type: 'entry',
    trailingShort: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    shortEntryFilter: 'v3_bearRegime',
  },
  {
    id: 'V4',
    name: 'Entry 3 Consecutive HTF Bearish',
    type: 'entry',
    trailingShort: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
    shortEntryFilter: 'v4_consecutiveHtf',
  },
];

interface MarketDef {
  key: string;
  sym: string;
  tf: string;
  isOos: boolean;
}

export interface MarketRunResult {
  market: string;
  isOos: boolean;
  totalReturn: number;
  maxDD: number;
  trades: number;
  longTrades: number;
  longPnlUsd: number;
  longWinRate: number;
  shortTrades: number;
  shortPnlUsd: number;
  shortWinRate: number;
}

export interface VariantSummary {
  variantId: string;
  name: string;
  marketResults: Record<string, MarketRunResult>;
  primaryShortImprovedCount: number; // threshold >= 4
  oosShortImprovedCount: number; // threshold >= 5
  totalReturnAll: number;
  totalMaxDDMax: number;
  totalPnlUsdAll: number;
  shortPnlUsdAll: number;
  longPnlUsdAll: number;
  totalReturnPrimary: number;
  shortPnlUsdPrimary: number;
  totalReturnOos: number;
  shortPnlUsdOos: number;
  passesCriterionA: boolean; // >= 4 of 6 primary
  passesCriterionB: boolean; // >= 5 of 8 OOS
  passesCriterionC: boolean; // total return & maxDD not worse by > 1.2x
  accepted: boolean;
}

export async function runSh4Variants() {
  const dataDir = path.resolve('docs/review/data');
  const primarySymbols = ['BTC', 'ETH'] as const;
  const primaryIntervals = ['15m', '1h', '4h'] as const;
  const oosSymbols = ['SOL', 'BNB', 'XRP', 'ADA'] as const;
  const oosIntervals = ['1h', '4h'] as const;

  console.log('Loading candle datasets...');
  const candleStore: Record<string, Record<string, Candle[]>> = {};

  for (const sym of [...primarySymbols, ...oosSymbols]) {
    candleStore[sym] = {};
    const tfs = primarySymbols.includes(sym as any) ? ['15m', '1h', '4h'] : ['1h', '4h'];
    for (const tf of tfs) {
      const p = path.join(dataDir, `${sym}USDT_${tf}.csv.gz`);
      if (fs.existsSync(p)) {
        candleStore[sym][tf] = loadGzCandles(p);
      }
    }
  }

  const markets: MarketDef[] = [];
  for (const sym of primarySymbols) {
    for (const tf of primaryIntervals) {
      markets.push({ key: `${sym} ${tf}`, sym, tf, isOos: false });
    }
  }
  for (const sym of oosSymbols) {
    for (const tf of oosIntervals) {
      markets.push({ key: `${sym} ${tf}`, sym, tf, isOos: true });
    }
  }

  const regimeCalcs: Record<string, DailyRegimeCalculator> = {};
  const dailyCandlesStore: Record<string, Candle[]> = {};

  for (const m of markets) {
    if (!regimeCalcs[m.sym]) {
      regimeCalcs[m.sym] = createDailyRegimeCalculator(m.sym, dataDir);
    }
    if (!dailyCandlesStore[m.sym]) {
      dailyCandlesStore[m.sym] = getDailyCandlesForSymbol(m.sym, dataDir);
    }
  }

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
  };

  const results: Record<string, VariantSummary> = {};

  // 1. Run baseline TR3 first to establish baseline short returns
  console.log('Running all 9 variants across 14 markets...');

  const runVariant = (variant: VariantDefinition): VariantSummary => {
    const marketResults: Record<string, MarketRunResult> = {};

    let totalPnlAll = 0;
    let shortPnlAll = 0;
    let longPnlAll = 0;
    let maxDDMax = 0;

    let primaryPnl = 0;
    let primaryShortPnl = 0;

    let oosPnl = 0;
    let oosShortPnl = 0;

    for (const m of markets) {
      const candles = candleStore[m.sym][m.tf];
      const c1h = candleStore[m.sym]['1h'];
      const c4h = candleStore[m.sym]['4h'];
      const dailyCandles = dailyCandlesStore[m.sym];
      const regCalc = regimeCalcs[m.sym];

      const strategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'confirm',
        fisherKind: 'fisher',
        fisherGate: 'none',
        htf1hCandles: m.tf === '15m' ? c1h : undefined,
        htf4hCandles: m.tf === '15m' || m.tf === '1h' ? c4h : undefined,
        shortEntryFilter: variant.shortEntryFilter,
        daily1dCandles: dailyCandles,
        dailyRegimeCalculator: regCalc,
      });

      const res = engine.run({
        ...baseEngineConfig,
        strategy,
        candles,
        trailingStopShort: variant.trailingShort,
      });

      const totalPnlUsd = res.metrics.totalPnl;
      const longTrades = res.trades.filter((t) => t.side === 'long');
      const shortTrades = res.trades.filter((t) => t.side === 'short');
      const longPnlUsd = roundTo(longTrades.reduce((sum, t) => sum + (t.pnl || 0), 0), 2);
      const shortPnlUsd = roundTo(shortTrades.reduce((sum, t) => sum + (t.pnl || 0), 0), 2);
      const longWins = longTrades.filter((t) => (t.pnl || 0) > 0).length;
      const shortWins = shortTrades.filter((t) => (t.pnl || 0) > 0).length;

      const runRes: MarketRunResult = {
        market: m.key,
        isOos: m.isOos,
        totalReturn: res.metrics.totalPnlPercent,
        maxDD: res.metrics.maxDrawdownPercent,
        trades: res.metrics.totalTrades,
        longTrades: longTrades.length,
        longPnlUsd,
        longWinRate: longTrades.length > 0 ? roundTo((longWins / longTrades.length) * 100, 2) : 0,
        shortTrades: shortTrades.length,
        shortPnlUsd,
        shortWinRate: shortTrades.length > 0 ? roundTo((shortWins / shortTrades.length) * 100, 2) : 0,
      };

      marketResults[m.key] = runRes;

      totalPnlAll += totalPnlUsd;
      shortPnlAll += shortPnlUsd;
      longPnlAll += longPnlUsd;
      if (res.metrics.maxDrawdownPercent > maxDDMax) {
        maxDDMax = res.metrics.maxDrawdownPercent;
      }

      if (!m.isOos) {
        primaryPnl += totalPnlUsd;
        primaryShortPnl += shortPnlUsd;
      } else {
        oosPnl += totalPnlUsd;
        oosShortPnl += shortPnlUsd;
      }
    }

    return {
      variantId: variant.id,
      name: variant.name,
      marketResults,
      primaryShortImprovedCount: 0,
      oosShortImprovedCount: 0,
      totalReturnAll: roundTo((totalPnlAll / (10000 * markets.length)) * 100, 2),
      totalMaxDDMax: roundTo(maxDDMax, 2),
      totalPnlUsdAll: roundTo(totalPnlAll, 2),
      shortPnlUsdAll: roundTo(shortPnlAll, 2),
      longPnlUsdAll: roundTo(longPnlAll, 2),
      totalReturnPrimary: roundTo((primaryPnl / (10000 * 6)) * 100, 2),
      shortPnlUsdPrimary: roundTo(primaryShortPnl, 2),
      totalReturnOos: roundTo((oosPnl / (10000 * 8)) * 100, 2),
      shortPnlUsdOos: roundTo(oosShortPnl, 2),
      passesCriterionA: false,
      passesCriterionB: false,
      passesCriterionC: false,
      accepted: false,
    };
  };

  // Run Baseline TR3 first
  const baselineTR3 = runVariant(SH4_VARIANTS[0]);
  results['TR3'] = baselineTR3;
  console.log(`Baseline TR3 finished. Primary Short PnL: $${baselineTR3.shortPnlUsdPrimary}, OOS Short PnL: $${baselineTR3.shortPnlUsdOos}`);

  // Run other variants
  for (let i = 1; i < SH4_VARIANTS.length; i++) {
    const vDef = SH4_VARIANTS[i];
    console.log(`Running variant ${vDef.id}: ${vDef.name}...`);
    const summary = runVariant(vDef);

    // Evaluate against baseline TR3
    let primImproved = 0;
    for (const m of markets.filter((x) => !x.isOos)) {
      const vShortPnl = summary.marketResults[m.key].shortPnlUsd;
      const bShortPnl = baselineTR3.marketResults[m.key].shortPnlUsd;
      if (vShortPnl > bShortPnl) {
        primImproved++;
      }
    }

    let oosImproved = 0;
    for (const m of markets.filter((x) => x.isOos)) {
      const vShortPnl = summary.marketResults[m.key].shortPnlUsd;
      const bShortPnl = baselineTR3.marketResults[m.key].shortPnlUsd;
      if (vShortPnl > bShortPnl) {
        oosImproved++;
      }
    }

    summary.primaryShortImprovedCount = primImproved;
    summary.oosShortImprovedCount = oosImproved;

    // SH0 Criteria:
    // (a) Short return improves in >= 4 of 6 primary
    const passA = primImproved >= 4;
    // (b) Short return improves in >= 5 of 8 OOS
    const passB = oosImproved >= 5;
    // (c) Total return and total maxDD not worsening by > 1.2x
    // If baseline total return is positive, summary.totalReturnAll >= baseline.totalReturnAll / 1.2
    // If negative, summary.totalPnlUsdAll >= baseline.totalPnlUsdAll * 1.2
    const totalReturnAllowedMin =
      baselineTR3.totalPnlUsdAll > 0
        ? baselineTR3.totalPnlUsdAll / 1.2
        : baselineTR3.totalPnlUsdAll * 1.2;
    const maxDdAllowedMax = baselineTR3.totalMaxDDMax * 1.2;

    const passC = summary.totalPnlUsdAll >= totalReturnAllowedMin && summary.totalMaxDDMax <= maxDdAllowedMax;

    summary.passesCriterionA = passA;
    summary.passesCriterionB = passB;
    summary.passesCriterionC = passC;
    summary.accepted = passA && passB && passC;

    results[vDef.id] = summary;

    console.log(
      `  -> ${vDef.id}: Primary improved: ${primImproved}/6 (pass: ${passA}), OOS improved: ${oosImproved}/8 (pass: ${passB}), Return/DD check: (pass: ${passC}) => Accepted: ${summary.accepted}`
    );
  }

  // Also run long-only comparison for SH5 decision report
  console.log('Running Long-Only baseline for SH5 comparison...');
  const longOnlySummary: Record<string, MarketRunResult> = {};
  let loPnl = 0;
  let loMaxDD = 0;

  for (const m of markets) {
    const candles = candleStore[m.sym][m.tf];
    const c1h = candleStore[m.sym]['1h'];
    const c4h = candleStore[m.sym]['4h'];
    const dailyCandles = dailyCandlesStore[m.sym];
    const regCalc = regimeCalcs[m.sym];

    const strategy = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: 'confirm',
      fisherKind: 'fisher',
      fisherGate: 'none',
      htf1hCandles: m.tf === '15m' ? c1h : undefined,
      htf4hCandles: m.tf === '15m' || m.tf === '1h' ? c4h : undefined,
      shortEntryFilter: 'none',
      daily1dCandles: dailyCandles,
      dailyRegimeCalculator: regCalc,
    });

    const res = engine.run({
      ...baseEngineConfig,
      tradeMode: 'long-only',
      strategy,
      candles,
    });

    loPnl += res.metrics.totalPnl;
    if (res.metrics.maxDrawdownPercent > loMaxDD) {
      loMaxDD = res.metrics.maxDrawdownPercent;
    }

    longOnlySummary[m.key] = {
      market: m.key,
      isOos: m.isOos,
      totalReturn: res.metrics.totalPnlPercent,
      maxDD: res.metrics.maxDrawdownPercent,
      trades: res.metrics.totalTrades,
      longTrades: res.metrics.totalTrades,
      longPnlUsd: res.metrics.totalPnl,
      longWinRate: roundTo(res.metrics.winRate * 100, 2),
      shortTrades: 0,
      shortPnlUsd: 0,
      shortWinRate: 0,
    };
  }

  const outputPayload = {
    evaluatedAt: new Date().toISOString(),
    totalVariantsTested: SH4_VARIANTS.length,
    variants: results,
    longOnly: {
      totalPnlUsdAll: roundTo(loPnl, 2),
      totalReturnAll: roundTo((loPnl / (10000 * markets.length)) * 100, 2),
      totalMaxDDMax: roundTo(loMaxDD, 2),
      marketResults: longOnlySummary,
    },
  };

  const outPath = path.resolve('docs/review/sh4_variants_data.json');
  fs.writeFileSync(outPath, JSON.stringify(outputPayload, null, 2), 'utf-8');
  console.log(`Saved evaluation data to ${outPath}`);

  return outputPayload;
}

if (require.main === module) {
  runSh4Variants().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
