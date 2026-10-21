import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { BacktestEngine } from '../backtest/engine';
import { MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import type { Strategy } from '../strategies/types';
import type { Candle, TradeSignal } from '../data/models';
import type { Trade, TradeMode } from '../backtest/types';
import { roundTo } from '../utils/math';
import {
  DEFAULT_TRADE_MODE,
  DEFAULT_TRAILING_MODE,
} from '../config/defaults';

const gunzip = promisify(zlib.gunzip);

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
  if (count <= 0 || total <= 0) return [];
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  if (count < total * 0.2) {
    const chosen = new Set<number>();
    while (chosen.size < count) {
      const idx = Math.floor(rng() * total);
      chosen.add(idx);
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
  private signals: Map<number, 1 | -1>;

  constructor(signals: Map<number, 1 | -1>) {
    this.signals = signals;
  }

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

async function loadGzCandles(filePath: string): Promise<Candle[]> {
  const compressed = await fs.readFile(filePath);
  const uncompressed = await gunzip(compressed);
  const text = uncompressed.toString('utf-8');
  const lines = text.trim().split('\n');
  const candles: Candle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [timestamp, open, high, low, close, volume] = line.split(',');
    candles.push({
      timestamp: Number(timestamp),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    });
  }

  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles;
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

export interface MultiRunRecord {
  market: string;
  cfg: 'M1' | 'M2' | 'M3' | 'M4' | 'M5';
  totalReturn: number;
  maxDD: number;
  trades: number;
  retNoTop3: number;
  retSecondHalf: number;
  avgConcurrency: number;
  maxConcurrency: number;
  pctAtCap: number;
  worstDay: number;
  ret2021?: number;
  ret2022?: number;
  ret2023?: number;
  ret2024?: number;
  ret2025?: number;
  ret2026?: number;
  randomPctile?: number;
  pass?: boolean;
}

export async function runMultiValidation(): Promise<void> {
  console.log('=== Step 4: Multi-Position Evaluation (M1, M2, M3, M4, M5) ===');

  const rootDir = process.cwd();
  const dataDir = path.resolve(rootDir, 'docs', 'review', 'data');
  const outDir = path.resolve(rootDir, 'docs', 'review', 'validation');
  await fs.mkdir(outDir, { recursive: true });

  const primarySymbols = ['BTC', 'ETH'] as const;
  const primaryIntervals = ['15m', '1h', '4h'] as const;
  const oosSymbols = ['SOL', 'BNB', 'XRP', 'ADA'] as const;
  const oosIntervals = ['1h', '4h'] as const;

  const candleStore: Record<string, Record<string, Candle[]>> = {};

  // Load primary BTC, ETH
  for (const sym of primarySymbols) {
    candleStore[sym] = {};
    for (const tf of primaryIntervals) {
      candleStore[sym][tf] = await loadGzCandles(path.join(dataDir, `${sym}USDT_${tf}.csv.gz`));
    }
  }

  // Load OOS coins
  for (const sym of oosSymbols) {
    candleStore[sym] = {};
    for (const tf of oosIntervals) {
      candleStore[sym][tf] = await loadGzCandles(path.join(dataDir, `${sym}USDT_${tf}.csv.gz`));
    }
  }

  const engine = new BacktestEngine();

  const CONFIGS = [
    { id: 'M1' as const, maxOpenPositions: 1, positionSizePercent: 5, maxTotalExposurePercent: 100, minBarsBetweenEntries: 0 },
    { id: 'M2' as const, maxOpenPositions: 3, positionSizePercent: 5, maxTotalExposurePercent: 15, minBarsBetweenEntries: 0 },
    { id: 'M3' as const, maxOpenPositions: 10, positionSizePercent: 5, maxTotalExposurePercent: 50, minBarsBetweenEntries: 0 },
    { id: 'M4' as const, maxOpenPositions: 10, positionSizePercent: 1.5, maxTotalExposurePercent: 15, minBarsBetweenEntries: 0 },
    { id: 'M5' as const, maxOpenPositions: 10, positionSizePercent: 3, maxTotalExposurePercent: 30, minBarsBetweenEntries: 0 },
  ];

  const allRecords: MultiRunRecord[] = [];

  // Markets list: 6 primary + 8 OOS = 14 markets
  interface MarketDef {
    key: string;
    sym: string;
    tf: string;
    isPrimary: boolean;
  }
  const markets: MarketDef[] = [];
  for (const sym of primarySymbols) {
    for (const tf of primaryIntervals) {
      markets.push({ key: `${sym}_${tf}`, sym, tf, isPrimary: true });
    }
  }
  for (const sym of oosSymbols) {
    for (const tf of oosIntervals) {
      markets.push({ key: `${sym}_${tf}`, sym, tf, isPrimary: false });
    }
  }

  for (const m of markets) {
    const symCandles = candleStore[m.sym];
    const c1h = symCandles['1h'];
    const c4h = symCandles['4h'];
    const activeCandles = symCandles[m.tf];

    const makeStrategy = () =>
      new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'replace-stoch',
        fisherKind: 'fisher',
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

    // Second half candles for walk-forward second half return
    const midIdx = Math.floor(activeCandles.length / 2);
    const secondHalfCandles = activeCandles.slice(midIdx);

    for (const cfg of CONFIGS) {
      const baseEngineParams = {
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: cfg.positionSizePercent,
        maxOpenPositions: cfg.maxOpenPositions,
        maxTotalExposurePercent: cfg.maxTotalExposurePercent,
        minBarsBetweenEntries: cfg.minBarsBetweenEntries,
        tradeMode: DEFAULT_TRADE_MODE,
        exitMode: 'trailingOnly' as const,
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: DEFAULT_TRAILING_MODE },
      };

      const fullRes = engine.run({
        ...baseEngineParams,
        strategy: makeStrategy(),
        candles: activeCandles,
      });

      const secondHalfRes = engine.run({
        ...baseEngineParams,
        strategy: makeStrategy(),
        candles: secondHalfCandles,
      });

      const retNoTop3 = calcReturnWithoutTop3(
        fullRes.trades,
        fullRes.metrics.totalPnl,
        baseEngineParams.initialBalance
      );
      const worstDay = calcWorstDay(activeCandles, fullRes.equity);

      const record: MultiRunRecord = {
        market: m.key,
        cfg: cfg.id,
        totalReturn: roundTo(fullRes.metrics.totalPnlPercent, 2),
        maxDD: roundTo(fullRes.metrics.maxDrawdownPercent, 2),
        trades: fullRes.metrics.totalTrades,
        retNoTop3,
        retSecondHalf: roundTo(secondHalfRes.metrics.totalPnlPercent, 2),
        avgConcurrency: fullRes.multiPositionDiagnostics?.avgConcurrentPositions ?? 0,
        maxConcurrency: fullRes.multiPositionDiagnostics?.maxConcurrentPositions ?? 0,
        pctAtCap: fullRes.multiPositionDiagnostics?.percentTimeAtCapacity ?? 0,
        worstDay,
      };

      // Yearly returns 2021-2026 for BTC & ETH 1h and 4h
      if ((m.sym === 'BTC' || m.sym === 'ETH') && (m.tf === '1h' || m.tf === '4h')) {
        const years = [2021, 2022, 2023, 2024, 2025, 2026];
        const yRets: Record<number, number> = {};
        for (const y of years) {
          const yearCandles = activeCandles.filter(
            (c) => new Date(c.timestamp).getUTCFullYear() === y
          );
          if (yearCandles.length > 50) {
            const yRes = engine.run({
              ...baseEngineParams,
              strategy: makeStrategy(),
              candles: yearCandles,
            });
            yRets[y] = roundTo(yRes.metrics.totalPnlPercent, 2);
          } else {
            yRets[y] = 0;
          }
        }
        record.ret2021 = yRets[2021];
        record.ret2022 = yRets[2022];
        record.ret2023 = yRets[2023];
        record.ret2024 = yRets[2024];
        record.ret2025 = yRets[2025];
        record.ret2026 = yRets[2026];
      }

      allRecords.push(record);
      console.log(
        `[${m.key}] ${cfg.id}: Ret=+${record.totalReturn}%, MaxDD=${record.maxDD}%, Trades=${record.trades}, NoTop3=${record.retNoTop3}%, AvgConc=${record.avgConcurrency}, WorstDay=${record.worstDay}%`
      );
    }
  }

  // Random-Entry Null Hypothesis Test for M3 and M5 on 6 BTC/ETH markets
  console.log('\n--- Running Random-Entry Null Tests for M3 and M5 (200 sims) ---');
  for (const targetCfg of ['M3', 'M5'] as const) {
    for (const m of markets.filter((mk) => mk.isPrimary)) {
      const symCandles = candleStore[m.sym];
      const c1h = symCandles['1h'];
      const c4h = symCandles['4h'];
      const activeCandles = symCandles[m.tf];

      const refStrategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'replace-stoch',
        fisherKind: 'fisher',
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const eligibleLongOnly: Array<{ idx: number; dir: 1 | -1 }> = [];
      for (let i = 0; i < activeCandles.length; i++) {
        if (refStrategy.getStrictHtfDirection(activeCandles, i) === 1) {
          eligibleLongOnly.push({ idx: i, dir: 1 });
        }
      }

      const rec = allRecords.find((r) => r.market === m.key && r.cfg === targetCfg)!;
      const targetTrades = rec.trades;

      const simConfig = {
        initialBalance: 10000,
        positionSizePercent: targetCfg === 'M5' ? 3 : 5,
        maxOpenPositions: 10,
        maxTotalExposurePercent: targetCfg === 'M5' ? 30 : 50,
        minBarsBetweenEntries: 0,
        tradeFeePercent: 0.1,
        tradeMode: DEFAULT_TRADE_MODE,
        exitMode: 'trailingOnly' as const,
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: DEFAULT_TRAILING_MODE },
      };

      const multiplier = calibrateMultiplier(engine, activeCandles, eligibleLongOnly, targetTrades, simConfig);
      const sampleCount = Math.min(eligibleLongOnly.length, Math.max(1, Math.round(targetTrades * multiplier)));

      const simReturns: number[] = [];
      for (let s = 0; s < 200; s++) {
        const rng = mulberry32(42 + s);
        const chosen = sampleDistinctIndices(eligibleLongOnly.length, sampleCount, rng);
        const sigMap = new Map<number, 1 | -1>();
        for (const itemIdx of chosen) {
          sigMap.set(eligibleLongOnly[itemIdx].idx, eligibleLongOnly[itemIdx].dir);
        }
        const simRes = engine.run({
          ...simConfig,
          strategy: new RandomEntryStrategy(sigMap),
          candles: activeCandles,
        });
        simReturns.push(roundTo(simRes.metrics.totalPnlPercent, 2));
      }

      const strictlyLower = simReturns.filter((r) => r < rec.totalReturn).length;
      const exactlyEqual = simReturns.filter((r) => r === rec.totalReturn).length;
      const percentile = roundTo(((strictlyLower + 0.5 * exactlyEqual) / 200) * 100, 2);
      rec.randomPctile = percentile;

      await fs.writeFile(
        path.join(outDir, `null_${m.sym}_${m.tf}_${targetCfg}.json`),
        JSON.stringify(
          {
            market: m.key,
            cfg: targetCfg,
            actualReturn: rec.totalReturn,
            percentile,
            sampleCount,
            targetTrades,
            samples: simReturns,
          },
          null,
          2
        ),
        'utf-8'
      );
      console.log(`[${m.key}] ${targetCfg} Null Percentile: ${percentile}% (targetTrades=${targetTrades})`);
    }
  }

  // Evaluate Pass / Fail Criteria for each M (M2, M3, M4, M5) vs M1
  for (const r of allRecords) {
    if (r.cfg === 'M1') {
      r.pass = true; // M1 is baseline
      continue;
    }

    const m1 = allRecords.find((x) => x.market === r.market && x.cfg === 'M1')!;
    const ratioM = r.totalReturn / Math.max(0.01, r.maxDD);
    const ratioM1 = m1.totalReturn / Math.max(0.01, m1.maxDD);

    const c1 = ratioM > ratioM1;
    const c2 = r.maxDD <= 12;
    const c3 = r.retNoTop3 > 0;
    const c4 = r.retSecondHalf > 0;
    const c5 = (r.cfg === 'M3' || r.cfg === 'M5') ? (r.randomPctile ?? 0) >= 90 : true;

    r.pass = c1 && c2 && c3 && c4 && c5;
  }

  // 1. Export docs/review/validation/multi.csv
  const csvHeader =
    'market,cfg,totalReturn,maxDD,trades,retNoTop3,retSecondHalf,avgConcurrency,maxConcurrency,pctAtCap,worstDay,randomPctile,ret2021,ret2022,ret2023,ret2024,ret2025,ret2026,pass\n';
  const csvRows = allRecords
    .map((r) => {
      const pStr = r.pass ? 'PASS' : 'FAIL';
      const pctStr = r.randomPctile !== undefined ? r.randomPctile.toFixed(1) : '';
      const y21 = r.ret2021 !== undefined ? r.ret2021.toFixed(1) : '';
      const y22 = r.ret2022 !== undefined ? r.ret2022.toFixed(1) : '';
      const y23 = r.ret2023 !== undefined ? r.ret2023.toFixed(1) : '';
      const y24 = r.ret2024 !== undefined ? r.ret2024.toFixed(1) : '';
      const y25 = r.ret2025 !== undefined ? r.ret2025.toFixed(1) : '';
      const y26 = r.ret2026 !== undefined ? r.ret2026.toFixed(1) : '';
      return `${r.market},${r.cfg},${r.totalReturn},${r.maxDD},${r.trades},${r.retNoTop3},${r.retSecondHalf},${r.avgConcurrency},${r.maxConcurrency},${r.pctAtCap},${r.worstDay},${pctStr},${y21},${y22},${y23},${y24},${y25},${y26},${pStr}`;
    })
    .join('\n');

  await fs.writeFile(path.join(outDir, 'multi.csv'), csvHeader + csvRows + '\n', 'utf-8');

  // 2. Append Section "Multi-Position" to docs/review/VALIDATION.md
  const validationMdPath = path.resolve(rootDir, 'docs', 'review', 'VALIDATION.md');
  const existingMd = await fs.readFile(validationMdPath, 'utf-8');

  // Check if Multi-Position section already exists; if so, replace it
  const baseMd = existingMd.includes('Multi-Position Evaluation')
    ? existingMd.split(/### \d+\. Multi-Position Evaluation/)[0].trim()
    : existingMd.trim();

  const mdLines: string[] = [baseMd, '', '### 7. Multi-Position Evaluation (M1–M5)'];
  mdLines.push('| Market | Cfg | Ret% | MaxDD% | Trades | NoTop3% | 2ndHalf% | AvgConc | WorstDay% | Pctile | Verdict |');
  mdLines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|');

  // Primary 6 markets first, then OOS summary
  const primaryKeys = ['BTC_15m', 'BTC_1h', 'BTC_4h', 'ETH_15m', 'ETH_1h', 'ETH_4h'];
  for (const m of primaryKeys) {
    for (const cfg of ['M1', 'M2', 'M3', 'M4', 'M5'] as const) {
      const r = allRecords.find((x) => x.market === m && x.cfg === cfg)!;
      const vStr = cfg === 'M1' ? 'BASE' : r.pass ? '**PASS**' : 'FAIL';
      const pctStr = r.randomPctile !== undefined ? `${r.randomPctile.toFixed(0)}%` : '-';
      mdLines.push(
        `| \`${r.market}\` | ${r.cfg} | ${r.totalReturn > 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% | ${r.maxDD.toFixed(1)}% | ${r.trades} | ${r.retNoTop3 > 0 ? '+' : ''}${r.retNoTop3.toFixed(1)}% | ${r.retSecondHalf > 0 ? '+' : ''}${r.retSecondHalf.toFixed(1)}% | ${r.avgConcurrency.toFixed(1)} | ${r.worstDay.toFixed(1)}% | ${pctStr} | ${vStr} |`
      );
    }
  }

  mdLines.push('');
  mdLines.push('### Multi-Position Global Verdict');
  mdLines.push('| Config | Parameters | BTC/ETH Passed (/6) | Global Status |');
  mdLines.push('|---|---|:---:|:---:|');

  for (const cfg of ['M2', 'M3', 'M4', 'M5'] as const) {
    const passedPrimary = allRecords.filter((r) => primaryKeys.includes(r.market) && r.cfg === cfg && r.pass).length;
    const globalPass = passedPrimary >= 4;
    const desc =
      cfg === 'M2'
        ? 'maxPos 3, size 5%, cap 15%'
        : cfg === 'M3'
          ? 'maxPos 10, size 5%, cap 50%'
          : cfg === 'M4'
            ? 'maxPos 10, size 1.5%, cap 15%'
            : 'maxPos 10, size 3%, cap 30%';
    mdLines.push(
      `| **${cfg}** | ${desc} | ${passedPrimary} / 6 | ${globalPass ? '**PASS**' : '**FAIL**'} |`
    );
  }

  const finalMd = mdLines.join('\n') + '\n';
  const finalLineCount = finalMd.split('\n').length;
  console.log(`VALIDATION.md updated. Line count: ${finalLineCount} (budget <= 150)`);

  if (finalLineCount > 150) {
    console.error(`ERROR: VALIDATION.md exceeds 150 lines: ${finalLineCount}`);
  } else {
    await fs.writeFile(validationMdPath, finalMd, 'utf-8');
  }

  console.log('=== Step 4 Complete: multi.csv and VALIDATION.md written ===');
}

if (require.main === module || process.argv[1]?.includes('validate-multi')) {
  runMultiValidation().catch((err) => {
    console.error('Multi-position validation failed:', err);
    process.exit(1);
  });
}

