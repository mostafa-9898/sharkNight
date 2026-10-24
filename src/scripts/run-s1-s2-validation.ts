import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle, TradeSignal } from '../data/models';
import type { Trade, TradeMode } from '../backtest/types';
import type { Strategy } from '../strategies/types';
import { MultiTimeframeStrategy, type FisherMode, type FisherKind } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';
import {
  DEFAULT_FISHER_MODE,
  DEFAULT_FISHER_KIND,
  DEFAULT_FISHER_GATE,
  DEFAULT_ALLOW_OPPOSITE_POSITIONS,
} from '../config/defaults';
import { createDailyRegimeCalculator, type DailyRegimeCalculator } from '../utils/market-regime';
import { formatTradeRow, serializeTradeRows } from '../utils/trade-export';

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
      return {
        action: 'BUY',
        timestamp: candles[currentIndex].timestamp,
        price: candles[currentIndex].close,
      };
    }
    if (dir === -1) {
      return {
        action: 'SELL',
        timestamp: candles[currentIndex].timestamp,
        price: candles[currentIndex].close,
      };
    }
    return {
      action: 'HOLD',
      timestamp: candles[currentIndex]?.timestamp ?? 0,
      price: candles[currentIndex]?.close ?? 0,
    };
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

function calcReturnWithoutTop3(trades: readonly Trade[], totalPnl: number, initialBalance: number): number {
  if (trades.length === 0) return 0;
  const sorted = [...trades].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
  const top3Pnl = sorted.slice(0, 3).reduce((sum, t) => sum + (t.pnl || 0), 0);
  const pnlWithoutTop3 = totalPnl - top3Pnl;
  return roundTo((pnlWithoutTop3 / initialBalance) * 100, 2);
}

function calcWorstDay(candles: readonly Candle[], equityCurve: readonly number[]): number {
  if (candles.length === 0 || equityCurve.length === 0) return 0;
  const dailyEquity = new Map<string, number>();
  for (let i = 0; i < candles.length; i++) {
    const dateStr = new Date(candles[i].timestamp).toISOString().split('T')[0];
    dailyEquity.set(dateStr, equityCurve[i]);
  }

  const dates = Array.from(dailyEquity.keys()).sort();
  let worstDrop = 0;
  for (let i = 1; i < dates.length; i++) {
    const prevEq = dailyEquity.get(dates[i - 1])!;
    const currEq = dailyEquity.get(dates[i])!;
    if (prevEq > 0) {
      const dropPct = ((currEq - prevEq) / prevEq) * 100;
      if (dropPct < worstDrop) {
        worstDrop = dropPct;
      }
    }
  }
  return roundTo(worstDrop, 2);
}

function calibrateMultiplier(
  engine: BacktestEngine,
  candles: readonly Candle[],
  eligible: Array<{ idx: number; dir: 1 | -1 }>,
  targetTrades: number,
  simConfig: {
    initialBalance: number;
    positionSizePercent: number;
    maxOpenPositions: number;
    maxTotalExposurePercent: number;
    minBarsBetweenEntries: number;
    tradeFeePercent: number;
    tradeMode: TradeMode;
    exitMode: 'trailingOnly';
    trailingStop: {
      initialStopPercent: number;
      stepPercent: number;
      raisePercent: number;
      mode?: 'stepped' | 'trend';
    };
  }
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

interface ValidationRecord {
  config: 'S1' | 'S2';
  market: string;
  isOos: boolean;
  totalReturn: number;
  maxDD: number;
  trades: number;
  retNoTop3: number;
  h2Return: number;
  avgConcurrent: number;
  maxConcurrent: number;
  worstDay: number;
  longTrades: number;
  longWinRate: number;
  longReturn: number;
  shortTrades: number;
  shortWinRate: number;
  shortReturn: number;
  nullPercentile: number | null;
}

export async function runValidation() {
  const dataDir = path.resolve('docs/review/data');
  const primarySymbols = ['BTC', 'ETH'] as const;
  const primaryIntervals = ['15m', '1h', '4h'] as const;
  const oosSymbols = ['SOL', 'BNB', 'XRP', 'ADA'] as const;
  const oosIntervals = ['1h', '4h'] as const;

  console.log('Loading candle datasets...');
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

  const engine = new BacktestEngine();

  // Winning Configuration from H_SELECT (H4/H5 evaluation): F3 (confirm / fisher / gate none)
  const winningFisherMode: FisherMode = DEFAULT_FISHER_MODE;
  const winningFisherKind: FisherKind = DEFAULT_FISHER_KIND;
  const winningFisherGate = DEFAULT_FISHER_GATE;

  const baseConfig = {
    initialBalance: 10000,
    positionSizePercent: 3,
    maxOpenPositions: 10,
    maxTotalExposurePercent: 30,
    minBarsBetweenEntries: 0,
    allowOppositePositions: DEFAULT_ALLOW_OPPOSITE_POSITIONS,
    tradeFeePercent: 0.1,
    exitMode: 'trailingOnly' as const,
    trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' as const },
  };

  const csvDir = path.resolve('docs/review/validation');
  if (!fs.existsSync(csvDir)) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  const records: ValidationRecord[] = [];

  const configs: Array<{ id: 'S1' | 'S2'; tradeMode: TradeMode }> = [
    { id: 'S1', tradeMode: 'long-short' },
    { id: 'S2', tradeMode: 'long-only' },
  ];

  interface MarketDef {
    key: string;
    sym: string;
    tf: string;
    isOos: boolean;
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
  const getRegimeCalc = (sym: string): DailyRegimeCalculator => {
    if (!regimeCalcs[sym]) {
      regimeCalcs[sym] = createDailyRegimeCalculator(sym, dataDir);
    }
    return regimeCalcs[sym];
  };

  for (const cfgDef of configs) {
    console.log(`\n================ Running ${cfgDef.id} (${cfgDef.tradeMode}) ================`);

    for (const m of markets) {
      const candles = candleStore[m.sym][m.tf];
      const c1h = candleStore[m.sym]['1h'];
      const c4h = candleStore[m.sym]['4h'];

      const strategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: winningFisherMode,
        fisherKind: winningFisherKind,
        fisherGate: winningFisherGate,
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const simCfg = {
        ...baseConfig,
        tradeMode: cfgDef.tradeMode,
      };

      const res = engine.run({
        ...simCfg,
        strategy,
        candles,
      });

      // Export trade-level compressed CSV with 15 required columns (SH1)
      const tfMinutes = m.tf === '15m' ? 15 : m.tf === '1h' ? 60 : 240;
      const intervalMs = tfMinutes * 60 * 1000;
      const regimeCalc = getRegimeCalc(m.sym);
      const tradeRows = res.trades.map((t) => formatTradeRow(t, intervalMs, regimeCalc));
      const tradeCsvContent = serializeTradeRows(tradeRows);
      const gzTradeBuf = zlib.gzipSync(Buffer.from(tradeCsvContent, 'utf-8'));
      const tradeGzPath1 = path.join(csvDir, `trades_${m.sym}_${m.tf}_${cfgDef.id}.csv.gz`);
      fs.writeFileSync(tradeGzPath1, gzTradeBuf);

      const totalReturn = roundTo(res.metrics.totalPnlPercent, 2);
      const maxDD = roundTo(res.metrics.maxDrawdownPercent, 2);
      const trades = res.metrics.totalTrades;
      const retNoTop3 = calcReturnWithoutTop3(res.trades, res.metrics.totalPnl, 10000);

      // H2 Return
      const midIdx = Math.floor(res.equity.length / 2);
      const eqMid = res.equity[midIdx] ?? 10000;
      const eqEnd = res.equity[res.equity.length - 1] ?? 10000;
      const h2Return = eqMid > 0 ? roundTo(((eqEnd - eqMid) / eqMid) * 100, 2) : 0;

      const avgConcurrent = roundTo(res.multiPositionDiagnostics?.avgConcurrentPositions ?? 0, 2);
      const maxConcurrent = res.multiPositionDiagnostics?.maxConcurrentPositions ?? 0;
      const worstDay = calcWorstDay(candles, res.equity);

      // Direction breakdown
      const longTrades = res.trades.filter((t) => t.side === 'long');
      const shortTrades = res.trades.filter((t) => t.side === 'short');
      const lCount = longTrades.length;
      const sCount = shortTrades.length;
      const lWins = longTrades.filter((t) => (t.pnl || 0) > 0).length;
      const sWins = shortTrades.filter((t) => (t.pnl || 0) > 0).length;
      const lWinRate = lCount > 0 ? roundTo((lWins / lCount) * 100, 1) : 0;
      const sWinRate = sCount > 0 ? roundTo((sWins / sCount) * 100, 1) : 0;
      const lPnl = longTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
      const sPnl = shortTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
      const lRet = roundTo((lPnl / 10000) * 100, 2);
      const sRet = roundTo((sPnl / 10000) * 100, 2);

      // Random Entry Null Test: run for 6 primary markets
      let nullPercentile: number | null = null;
      if (!m.isOos) {
        const eligible: Array<{ idx: number; dir: 1 | -1 }> = [];
        for (let i = 0; i < candles.length; i++) {
          const dir = strategy.getStrictHtfDirection(candles, i);
          if (cfgDef.tradeMode === 'long-short') {
            if (dir === 1 || dir === -1) eligible.push({ idx: i, dir });
          } else {
            if (dir === 1) eligible.push({ idx: i, dir: 1 });
          }
        }

        const mult = calibrateMultiplier(engine, candles, eligible, trades, simCfg);
        const sampleCount = Math.min(eligible.length, Math.max(1, Math.round(trades * mult)));

        const simReturns: number[] = [];
        for (let s = 0; s < 200; s++) {
          const rng = mulberry32(42 + s);
          const chosen = sampleDistinctIndices(eligible.length, sampleCount, rng);
          const sigMap = new Map<number, 1 | -1>();
          for (const itemIdx of chosen) {
            sigMap.set(eligible[itemIdx].idx, eligible[itemIdx].dir);
          }
          const simRes = engine.run({
            ...simCfg,
            strategy: new RandomEntryStrategy(sigMap),
            candles,
          });
          simReturns.push(roundTo(simRes.metrics.totalPnlPercent, 2));
        }

        const beaten = simReturns.filter((r) => totalReturn > r).length;
        nullPercentile = roundTo((beaten / 200) * 100, 1);
      }

      records.push({
        config: cfgDef.id,
        market: m.key,
        isOos: m.isOos,
        totalReturn,
        maxDD,
        trades,
        retNoTop3,
        h2Return,
        avgConcurrent,
        maxConcurrent,
        worstDay,
        longTrades: lCount,
        longWinRate: lWinRate,
        longReturn: lRet,
        shortTrades: sCount,
        shortWinRate: sWinRate,
        shortReturn: sRet,
        nullPercentile,
      });

      console.log(
        `  ${cfgDef.id} ${m.key.padEnd(8)}: Ret=${totalReturn.toFixed(1)}% MaxDD=${maxDD.toFixed(1)}% Trades=${trades} RetNoTop3=${retNoTop3.toFixed(1)}% H2=${h2Return.toFixed(1)}% MaxConc=${maxConcurrent} Null=${nullPercentile !== null ? nullPercentile + '%' : 'N/A'}`
      );
    }
  }

  // Generate CSV
  const csvPath = path.join(csvDir, 's1_s2.csv');

  const csvHeader = [
    'Config',
    'Market',
    'OOS',
    'ReturnPct',
    'MaxDDPct',
    'Trades',
    'RetNoTop3Pct',
    'H2ReturnPct',
    'AvgConcurrent',
    'MaxConcurrent',
    'WorstDayPct',
    'LongTrades',
    'LongWinRate',
    'LongReturnPct',
    'ShortTrades',
    'ShortWinRate',
    'ShortReturnPct',
    'NullPercentile',
  ].join(',');

  const csvRows = records.map((r) =>
    [
      r.config,
      r.market,
      r.isOos ? 'YES' : 'NO',
      r.totalReturn,
      r.maxDD,
      r.trades,
      r.retNoTop3,
      r.h2Return,
      r.avgConcurrent,
      r.maxConcurrent,
      r.worstDay,
      r.longTrades,
      r.longWinRate,
      r.longReturn,
      r.shortTrades,
      r.shortWinRate,
      r.shortReturn,
      r.nullPercentile !== null ? r.nullPercentile : 'N/A',
    ].join(',')
  );

  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n') + '\n', 'utf-8');
  console.log(`Saved CSV to ${csvPath}`);

  // Generate docs/review/VALIDATION.md (compact table only, <= 150 lines, NO commentary)
  const mdLines: string[] = [];
  mdLines.push('# Re-validation Results (S1 vs S2)');
  mdLines.push('');
  mdLines.push('## Primary Markets (BTC & ETH)');
  mdLines.push('| Config | Market | Return % | MaxDD % | Trades | Ret w/o Top3 | H2 Ret % | Avg Conc | Max Conc | Worst Day % | Long (Trd/WR/Ret) | Short (Trd/WR/Ret) | Null Pct |');
  mdLines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');

  for (const r of records.filter((rec) => !rec.isOos)) {
    const longStr = `${r.longTrades}/${r.longWinRate}%/${r.longReturn > 0 ? '+' : ''}${r.longReturn}%`;
    const shortStr = `${r.shortTrades}/${r.shortWinRate}%/${r.shortReturn > 0 ? '+' : ''}${r.shortReturn}%`;
    const nullStr = r.nullPercentile !== null ? `${r.nullPercentile}%` : 'N/A';
    mdLines.push(
      `| **${r.config}** | ${r.market} | ${r.totalReturn > 0 ? '+' : ''}${r.totalReturn}% | ${r.maxDD}% | ${r.trades} | ${r.retNoTop3 > 0 ? '+' : ''}${r.retNoTop3}% | ${r.h2Return > 0 ? '+' : ''}${r.h2Return}% | ${r.avgConcurrent} | ${r.maxConcurrent} | ${r.worstDay}% | ${longStr} | ${shortStr} | ${nullStr} |`
    );
  }

  mdLines.push('');
  mdLines.push('## Out-of-Sample (OOS) Markets (SOL, BNB, XRP, ADA)');
  mdLines.push('| Config | Market | Return % | MaxDD % | Trades | Ret w/o Top3 | H2 Ret % | Avg Conc | Max Conc | Worst Day % | Long (Trd/WR/Ret) | Short (Trd/WR/Ret) |');
  mdLines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');

  for (const r of records.filter((rec) => rec.isOos)) {
    const longStr = `${r.longTrades}/${r.longWinRate}%/${r.longReturn > 0 ? '+' : ''}${r.longReturn}%`;
    const shortStr = `${r.shortTrades}/${r.shortWinRate}%/${r.shortReturn > 0 ? '+' : ''}${r.shortReturn}%`;
    mdLines.push(
      `| **${r.config}** | ${r.market} | ${r.totalReturn > 0 ? '+' : ''}${r.totalReturn}% | ${r.maxDD}% | ${r.trades} | ${r.retNoTop3 > 0 ? '+' : ''}${r.retNoTop3}% | ${r.h2Return > 0 ? '+' : ''}${r.h2Return}% | ${r.avgConcurrent} | ${r.maxConcurrent} | ${r.worstDay}% | ${longStr} | ${shortStr} |`
    );
  }

  const valMdPath = path.resolve('docs/review/VALIDATION.md');
  const valContent = mdLines.join('\n') + '\n';
  fs.writeFileSync(valMdPath, valContent, 'utf-8');
  console.log(`Saved VALIDATION.md to ${valMdPath} (${valContent.split('\n').length} lines)`);
}

if (require.main === module) {
  runValidation().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

