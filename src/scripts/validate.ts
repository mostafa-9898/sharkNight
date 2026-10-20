import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { execSync } from 'child_process';
import { BacktestEngine } from '../backtest/engine';
import { MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import { computeDatasetFingerprint } from '../backtest/report';
import { roundTo } from '../utils/math';
import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from '../strategies/types';
import type { Trade } from '../backtest/types';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// PRNG: mulberry32
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleDistinctIndices(total: number, count: number, rng: () => number): number[] {
  if (count <= 0) return [];
  if (count >= total) {
    return Array.from({ length: total }, (_, i) => i);
  }
  if (count < total / 2) {
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

interface CandidateConfig {
  id: 'A' | 'B' | 'C';
  name: string;
  kijunSlopeFilter: boolean;
  structureFilter: boolean;
  exitMode: 'reverse' | 'trailingOnly';
  stopLossPercent?: number;
  trailingStop?: {
    initialStopPercent: number;
    stepPercent: number;
    raisePercent: number;
  };
}

const CANDIDATES: CandidateConfig[] = [
  {
    id: 'A',
    name: 'Stop 3% + Reverse (Dual Filter)',
    kijunSlopeFilter: true,
    structureFilter: true,
    exitMode: 'reverse',
    stopLossPercent: 3,
  },
  {
    id: 'B',
    name: 'Trailing 3/3/1.5 (Dual Filter)',
    kijunSlopeFilter: true,
    structureFilter: true,
    exitMode: 'trailingOnly',
    trailingStop: { initialStopPercent: 3, stepPercent: 3, raisePercent: 1.5 },
  },
  {
    id: 'C',
    name: 'Control: Stop 3% + Reverse (No Filters)',
    kijunSlopeFilter: false,
    structureFilter: false,
    exitMode: 'reverse',
    stopLossPercent: 3,
  },
];

function calcReturnWithoutBest(trades: readonly Trade[], totalPnl: number, initialBalance: number): number {
  if (trades.length === 0) return 0;
  const sorted = [...trades].sort((a, b) => (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0));
  const bestPnl = sorted[0].pnl || 0;
  const pnlWithoutBest = totalPnl - bestPnl;
  return roundTo((pnlWithoutBest / initialBalance) * 100, 2);
}

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('=== TradeBot Automated Validation Suite ===');

  const rootDir = process.cwd();
  const dataDir = path.resolve(rootDir, 'docs', 'review', 'data');
  const outDir = path.resolve(rootDir, 'docs', 'review', 'validation');
  await fs.mkdir(outDir, { recursive: true });

  const symbols = ['BTC', 'ETH'] as const;
  const intervals = ['15m', '1h', '4h'] as const;
  const initialBalance = 10000;
  const baseFee = 0.1;
  const baseSize = 10;

  // 1. Load Data
  console.log('Loading candles from docs/review/data...');
  const candleData: Record<string, { '15m': Candle[]; '1h': Candle[]; '4h': Candle[] }> = {};
  const fingerprints: Record<string, string> = {};

  for (const sym of symbols) {
    const pair = `${sym}USDT`;
    const [c15, c1h, c4h] = await Promise.all([
      loadGzCandles(path.join(dataDir, `${pair}_15m.csv.gz`)),
      loadGzCandles(path.join(dataDir, `${pair}_1h.csv.gz`)),
      loadGzCandles(path.join(dataDir, `${pair}_4h.csv.gz`)),
    ]);
    candleData[sym] = { '15m': c15, '1h': c1h, '4h': c4h };
    fingerprints[`${sym}_15m`] = computeDatasetFingerprint(c15);
    fingerprints[`${sym}_1h`] = computeDatasetFingerprint(c1h);
    fingerprints[`${sym}_4h`] = computeDatasetFingerprint(c4h);
    console.log(`Loaded ${pair}: 15m=${c15.length}, 1h=${c1h.length}, 4h=${c4h.length}`);
  }

  const engine = new BacktestEngine();

  // Storage for report sections
  interface WalkForwardRow {
    market: string;
    cfg: 'A' | 'B' | 'C';
    testReturn: number;
    testNoBest: number;
    testMaxDD: number;
    testTrades: number;
    trainReturn: number;
    testPass: boolean;
  }
  const walkForwardResults: WalkForwardRow[] = [];

  interface YearlyRow {
    market: string;
    year: number;
    returnPct: number;
    maxDDPct: number;
    trades: number;
  }
  const yearlyResultsA: YearlyRow[] = [];

  interface CostSensRow {
    sym: string;
    tf: string;
    cfg: 'A' | 'B' | 'C';
    feePct: number;
    slipPct: number;
    returnPct: number;
    maxDDPct: number;
    trades: number;
  }
  const costSensResults: CostSensRow[] = [];

  interface NullTestResult {
    market: string;
    cfg: 'A' | 'C';
    actualReturn: number;
    meanNull: number;
    p95Null: number;
    actualPercentile: number;
    samples: number[];
    entriesPerRun: number;
    pass: boolean;
  }
  const nullTestResults: NullTestResult[] = [];

  const splitTimestamps: Record<string, string> = {};

  // Track full run results for export
  const fullRuns: Record<string, { res: ReturnType<typeof engine.run>; candles: Candle[] }> = {};

  console.log('\n--- Running Full Period, Walk-Forward, and Cost Sensitivity Matrix ---');

  for (const sym of symbols) {
    const symCandles = candleData[sym];
    const c1h = symCandles['1h'];
    const c4h = symCandles['4h'];

    for (const tf of intervals) {
      const activeCandles = symCandles[tf];
      const marketKey = `${sym}_${tf}`;

      const midIdx = Math.floor(activeCandles.length / 2);
      const trainCandles = activeCandles.slice(0, midIdx);
      const testCandles = activeCandles.slice(midIdx);
      splitTimestamps[marketKey] = new Date(activeCandles[midIdx].timestamp).toISOString();

      for (const candidate of CANDIDATES) {
        const key = `${marketKey}_${candidate.id}`;

        // Strategy instance with strict HTF
        const makeStrategy = () =>
          new MultiTimeframeStrategy({
            htfMode: 'strict',
            entryMode: 'cross',
            htf1hCandles: c1h,
            htf4hCandles: c4h,
            kijunSlopeFilter: candidate.kijunSlopeFilter,
            structureFilter: candidate.structureFilter,
          });

        const baseEngineConfig = {
          initialBalance,
          positionSizePercent: baseSize,
          tradeFeePercent: baseFee,
          tradeMode: 'long-short' as const,
          exitMode: candidate.exitMode,
          stopLossPercent: candidate.stopLossPercent,
          trailingStop: candidate.trailingStop,
        };

        // 1. Full run
        const fullRes = engine.run({
          ...baseEngineConfig,
          strategy: makeStrategy(),
          candles: activeCandles,
        });
        fullRuns[key] = { res: fullRes, candles: activeCandles };

        // 2. Walk-Forward (Train & Test)
        const trainRes = engine.run({
          ...baseEngineConfig,
          strategy: makeStrategy(),
          candles: trainCandles,
        });
        const testRes = engine.run({
          ...baseEngineConfig,
          strategy: makeStrategy(),
          candles: testCandles,
        });

        const testNoBest = calcReturnWithoutBest(testRes.trades, testRes.metrics.totalPnl, initialBalance);
        const testPass =
          testRes.metrics.totalPnlPercent > 0 &&
          testNoBest > 0 &&
          testRes.metrics.maxDrawdownPercent <= 12;

        walkForwardResults.push({
          market: marketKey,
          cfg: candidate.id,
          testReturn: testRes.metrics.totalPnlPercent,
          testNoBest,
          testMaxDD: testRes.metrics.maxDrawdownPercent,
          testTrades: testRes.metrics.totalTrades,
          trainReturn: trainRes.metrics.totalPnlPercent,
          testPass,
        });

        // 3. Yearly Returns for Candidate A
        if (candidate.id === 'A') {
          const years = [2021, 2022, 2023, 2024, 2025, 2026];
          for (const year of years) {
            const yearCandles = activeCandles.filter(
              (c) => new Date(c.timestamp).getUTCFullYear() === year
            );
            if (yearCandles.length > 50) {
              const yearRes = engine.run({
                ...baseEngineConfig,
                strategy: makeStrategy(),
                candles: yearCandles,
              });
              yearlyResultsA.push({
                market: marketKey,
                year,
                returnPct: yearRes.metrics.totalPnlPercent,
                maxDDPct: yearRes.metrics.maxDrawdownPercent,
                trades: yearRes.metrics.totalTrades,
              });
            } else {
              yearlyResultsA.push({
                market: marketKey,
                year,
                returnPct: 0,
                maxDDPct: 0,
                trades: 0,
              });
            }
          }
        }

        // 4. Cost Sensitivity (Full Period)
        const feeLevels = [0.1, 0.15, 0.2];
        const slipLevels = [0, 0.05];
        for (const fee of feeLevels) {
          for (const slip of slipLevels) {
            const costRes = engine.run({
              ...baseEngineConfig,
              strategy: makeStrategy(),
              candles: activeCandles,
              tradeFeePercent: fee,
              slippagePercent: slip,
            });
            costSensResults.push({
              sym,
              tf,
              cfg: candidate.id,
              feePct: fee,
              slipPct: slip,
              returnPct: costRes.metrics.totalPnlPercent,
              maxDDPct: costRes.metrics.maxDrawdownPercent,
              trades: costRes.metrics.totalTrades,
            });
          }
        }
      }
    }
  }

  // 5. Random-Entry Null Hypothesis Test for A and C
  console.log('\n--- Running Random-Entry Null Hypothesis Tests (200 sims per series) ---');

  for (const sym of symbols) {
    const symCandles = candleData[sym];
    const c1h = symCandles['1h'];
    const c4h = symCandles['4h'];

    for (const tf of intervals) {
      const activeCandles = symCandles[tf];
      const marketKey = `${sym}_${tf}`;

      // Use a strategy instance to pre-calculate strict HTF direction for every candle
      const refStrategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        htf1hCandles: c1h,
        htf4hCandles: c4h,
      });

      const eligible: Array<{ idx: number; dir: 1 | -1 }> = [];
      for (let i = 0; i < activeCandles.length; i++) {
        const dir = refStrategy.getStrictHtfDirection(activeCandles, i);
        if (dir === 1 || dir === -1) {
          eligible.push({ idx: i, dir });
        }
      }

      for (const cfgId of ['A', 'C'] as const) {
        const key = `${marketKey}_${cfgId}`;
        const fullRun = fullRuns[key];
        const actualReturn = fullRun.res.metrics.totalPnlPercent;
        const targetTradeCount = Math.max(1, fullRun.res.metrics.totalTrades);

        const simReturns: number[] = [];
        for (let s = 0; s < 200; s++) {
          const rng = mulberry32(42 + s);
          const chosenIndices = sampleDistinctIndices(eligible.length, targetTradeCount, rng);
          const signalMap = new Map<number, 1 | -1>();
          for (const itemIdx of chosenIndices) {
            const item = eligible[itemIdx];
            signalMap.set(item.idx, item.dir);
          }

          const simStrategy = new RandomEntryStrategy(signalMap);
          const simRes = engine.run({
            strategy: simStrategy,
            candles: activeCandles,
            initialBalance,
            positionSizePercent: baseSize,
            tradeFeePercent: baseFee,
            tradeMode: 'long-short',
            exitMode: 'reverse',
            stopLossPercent: 3,
          });
          simReturns.push(roundTo(simRes.metrics.totalPnlPercent, 2));
        }

        const sortedSims = [...simReturns].sort((a, b) => a - b);
        const meanNull = roundTo(sortedSims.reduce((sum, v) => sum + v, 0) / sortedSims.length, 2);
        const p95Null = sortedSims[Math.floor(sortedSims.length * 0.95)] ?? sortedSims[sortedSims.length - 1];

        // Percentile of actual in distribution: [0..100]
        const strictlyBelow = sortedSims.filter((v) => v < actualReturn).length;
        const equalCount = sortedSims.filter((v) => v === actualReturn).length;
        const actualPercentile = roundTo(((strictlyBelow + 0.5 * equalCount) / sortedSims.length) * 100, 2);

        const pass = actualPercentile >= 90;
        nullTestResults.push({
          market: marketKey,
          cfg: cfgId,
          actualReturn,
          meanNull,
          p95Null,
          actualPercentile,
          samples: simReturns,
          entriesPerRun: targetTradeCount,
          pass,
        });

        // Write raw JSON: null_{SYM}_{TF}_{CFG}.json
        const nullJsonPath = path.join(outDir, `null_${sym}_${tf}_${cfgId}.json`);
        await fs.writeFile(
          nullJsonPath,
          JSON.stringify(
            {
              actualReturn,
              samples: simReturns,
              percentile: actualPercentile,
              seeds: '42+i',
              entriesPerRun: targetTradeCount,
            },
            null,
            2
          ),
          'utf-8'
        );
      }
    }
  }

  // 6. Write Raw Export Files (Step 3.5)
  console.log('\n--- Writing Raw Export Files to docs/review/validation/ ---');

  // 6.1 trades_{SYM}_{TF}_{CFG}.csv.gz
  for (const sym of symbols) {
    for (const tf of intervals) {
      for (const candidate of CANDIDATES) {
        const key = `${sym}_${tf}_${candidate.id}`;
        const runData = fullRuns[key];
        const trades = runData.res.trades;

        const header =
          'entryTime,exitTime,side,entryPrice,exitPrice,pnlPercent,exitReason,barsHeld,mfePercent,maePercent,stopPercentAtEntry,positionSizePercent\n';
        const rows = trades.map((t) => {
          const entryTime = t.entryTime ?? t.entrySignal?.timestamp ?? 0;
          const exitTime = t.exitTime ?? t.exitSignal?.timestamp ?? 0;
          const side = t.side;
          const entryPrice = t.entryPrice;
          const exitPrice = t.exitPrice;
          const pnlPercent = roundTo(t.pnlPercent ?? 0, 4);
          const exitReason = t.exitReason;
          const barsHeld = t.duration ?? 0;
          const mfePercent = roundTo(t.maxFavorablePercent ?? 0, 4);
          const maePercent = roundTo(t.maxAdversePercent ?? 0, 4);
          const stopPercentAtEntry = candidate.id === 'B' ? 3 : 3;
          const positionSizePercent = 10;
          return `${entryTime},${exitTime},${side},${entryPrice},${exitPrice},${pnlPercent},${exitReason},${barsHeld},${mfePercent},${maePercent},${stopPercentAtEntry},${positionSizePercent}`;
        });

        const csvContent = header + rows.join('\n');
        const compressed = await gzip(Buffer.from(csvContent, 'utf-8'));
        await fs.writeFile(path.join(outDir, `trades_${sym}_${tf}_${candidate.id}.csv.gz`), compressed);
      }
    }
  }

  // 6.2 equity_{SYM}_{TF}_{CFG}.csv.gz (Daily closing equity + drawdownPercent)
  for (const sym of symbols) {
    for (const tf of intervals) {
      for (const candidate of CANDIDATES) {
        const key = `${sym}_${tf}_${candidate.id}`;
        const runData = fullRuns[key];
        const candles = runData.candles;
        const equityCurve = runData.res.equity;

        // Daily closing equity map: YYYY-MM-DD -> last equity
        const dailyMap = new Map<string, number>();
        for (let i = 0; i < candles.length; i++) {
          const dateStr = new Date(candles[i].timestamp).toISOString().split('T')[0];
          dailyMap.set(dateStr, equityCurve[i]);
        }

        const sortedDates = Array.from(dailyMap.keys()).sort();
        let runningPeak = initialBalance;
        const rows: string[] = [];

        for (const d of sortedDates) {
          const eq = dailyMap.get(d)!;
          if (eq > runningPeak) runningPeak = eq;
          const ddPercent = runningPeak > 0 ? roundTo(((runningPeak - eq) / runningPeak) * 100, 2) : 0;
          rows.push(`${d},${roundTo(eq, 2)},${ddPercent}`);
        }

        const csvContent = 'date,equity,drawdownPercent\n' + rows.join('\n');
        const compressed = await gzip(Buffer.from(csvContent, 'utf-8'));
        await fs.writeFile(path.join(outDir, `equity_${sym}_${tf}_${candidate.id}.csv.gz`), compressed);
      }
    }
  }

  // 6.3 cost_sensitivity.csv
  const costSensHeader = 'sym,tf,cfg,feePct,slipPct,returnPct,maxDDPercent,trades\n';
  const costSensRows = costSensResults
    .map(
      (r) =>
        `${r.sym},${r.tf},${r.cfg},${r.feePct},${r.slipPct},${roundTo(r.returnPct, 2)},${roundTo(r.maxDDPct, 2)},${r.trades}`
    )
    .join('\n');
  await fs.writeFile(path.join(outDir, 'cost_sensitivity.csv'), costSensHeader + costSensRows, 'utf-8');

  // 6.4 yearly_A.csv
  const yearlyHeader = 'sym,tf,year,returnPct,maxDDPercent,trades\n';
  const yearlyRows = yearlyResultsA
    .map(
      (r) =>
        `${r.market.split('_')[0]},${r.market.split('_')[1]},${r.year},${roundTo(r.returnPct, 2)},${roundTo(r.maxDDPct, 2)},${r.trades}`
    )
    .join('\n');
  await fs.writeFile(path.join(outDir, 'yearly_A.csv'), yearlyHeader + yearlyRows, 'utf-8');

  // 6.5 manifest.json
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    // ignore
  }

  const manifest = {
    gitCommit,
    executionDate: new Date().toISOString(),
    nodeVersion: process.version,
    datasetFingerprints: fingerprints,
    fixedParameters: {
      htfMode: 'strict',
      entryMode: 'cross',
      baseFeePercent: baseFee,
      baseSlippagePercent: 0,
      positionSizePercent: baseSize,
      initialBalance,
      randomEntrySeeds: 'mulberry32 with seed = 42 + i (i=0..199)',
      walkForwardSplitTimestamps: splitTimestamps,
    },
    candidateDefinitions: {
      A: 'Stop 3% + reverse, kijunSlopeFilter: true, structureFilter: true',
      B: 'trailingOnly with 3/3/1.5, kijunSlopeFilter: true, structureFilter: true',
      C: 'Stop 3% + reverse, kijunSlopeFilter: false, structureFilter: false',
    },
  };
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 6.6 engine_notes.md (Strictly <= 40 lines)
  const engineNotes = `# Engine Mechanics & Execution Notes

- **Entry and Exit Execution Price**: Signal entries and reverse exits/entries execute at the current candle's \`close\` price. Intrabar stop-loss and trailing-stop exits execute at \`stopPrice\` (adjusted for slippage) as soon as the intrabar threshold is breached.
- **Stop Execution Price on Gaps**: If the candle opens beyond the stop price (\`open <= stopPrice\` for long or \`open >= stopPrice\` for short), the exit executes at \`candle.open\` to honor adverse price gaps rather than an artificial stop price.
- **Trailing Stop Mechanism**: Favorable price excursions are recorded from intrabar extremes (\`high\` for long, \`low\` for short). The trailing ratchet calculates new stop levels at candle close, and the updated stop becomes active for intrabar checking starting on the next candle.
- **Reverse Orders**: Position liquidation and opposite-direction entry occur atomically within the same candle at \`candle.close\`. Trading fees are assessed on both the closing position notional and the new opening position notional.
- **Slippage Placement**: Slippage is applied adversely to executed exit prices: selling long slips downward (\`exitPrice * (1 - slippagePercent / 100)\`), while covering short slips upward (\`exitPrice * (1 + slippagePercent / 100)\`).
- **Drawdown Calculation**: Maximum Drawdown is calculated across the sequence of candle-close equity values (\`portfolio.getTotalEquity(candle.close)\`) relative to historical peak equity, measuring closed-candle drawdown rather than intrabar equity excursions.
`;
  await fs.writeFile(path.join(outDir, 'engine_notes.md'), engineNotes.trim() + '\n', 'utf-8');

  // 7. Generate docs/review/VALIDATION.md (Strictly <= 150 lines)
  console.log('\n--- Generating docs/review/VALIDATION.md ---');

  // Verdict evaluation
  interface VerdictRow {
    market: string;
    cfg: 'A' | 'B' | 'C';
    c1: boolean; // test return > 0
    c2: boolean; // test return without best > 0
    c3: boolean; // test maxDD <= 12%
    c4: boolean; // cost robust (fee 0.15%, slip 0.05% return > 0)
    c5: boolean; // random entry percentile >= 90 (N/A for B)
    pass: boolean;
  }
  const verdictRows: VerdictRow[] = [];

  for (const wf of walkForwardResults) {
    const costRobustRow = costSensResults.find(
      (r) => `${r.sym}_${r.tf}` === wf.market && r.cfg === wf.cfg && r.feePct === 0.15 && r.slipPct === 0.05
    );
    const c1 = wf.testReturn > 0;
    const c2 = wf.testNoBest > 0;
    const c3 = wf.testMaxDD <= 12;
    const c4 = (costRobustRow?.returnPct ?? 0) > 0;

    let c5 = true;
    if (wf.cfg === 'A' || wf.cfg === 'C') {
      const nullRes = nullTestResults.find((nr) => nr.market === wf.market && nr.cfg === wf.cfg);
      c5 = (nullRes?.actualPercentile ?? 0) >= 90;
    }

    const pass = c1 && c2 && c3 && c4 && c5;
    verdictRows.push({
      market: wf.market,
      cfg: wf.cfg,
      c1,
      c2,
      c3,
      c4,
      c5,
      pass,
    });
  }

  const lines: string[] = [];
  lines.push('# Multi-Timeframe Strategy Validation Report');
  lines.push(`> Generated: **${new Date().toISOString()}** | Commit: \`${gitCommit.slice(0, 8)}\` | Node: \`${process.version}\` | Capital: \$10,000 | Size: 10%`);
  lines.push('');

  // Table 1: Walk-Forward Validation (Test Half)
  lines.push('### 1. Walk-Forward Validation (Test Period)');
  lines.push('| Market | Cfg | Test Ret% | Test NoBest% | Test MaxDD% | Test Trades | Train Ret% | WF Pass |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|');
  for (const r of walkForwardResults) {
    const passStr = r.testPass ? '✅ PASS' : '❌ FAIL';
    lines.push(
      `| \`${r.market}\` | ${r.cfg} | ${r.testReturn > 0 ? '+' : ''}${r.testReturn.toFixed(1)}% | ${r.testNoBest > 0 ? '+' : ''}${r.testNoBest.toFixed(1)}% | ${r.testMaxDD.toFixed(1)}% | ${r.testTrades} | ${r.trainReturn > 0 ? '+' : ''}${r.trainReturn.toFixed(1)}% | ${passStr} |`
    );
  }
  lines.push('');

  // Table 2: Yearly Performance (Candidate A)
  lines.push('### 2. Yearly Returns (Candidate A)');
  lines.push('| Market | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|');
  const marketKeys = ['BTC_15m', 'BTC_1h', 'BTC_4h', 'ETH_15m', 'ETH_1h', 'ETH_4h'];
  for (const m of marketKeys) {
    const cols = [2021, 2022, 2023, 2024, 2025, 2026].map((yr) => {
      const entry = yearlyResultsA.find((y) => y.market === m && y.year === yr);
      const ret = entry ? entry.returnPct : 0;
      return `${ret > 0 ? '+' : ''}${ret.toFixed(1)}%`;
    });
    lines.push(`| \`${m}\` | ${cols.join(' | ')} |`);
  }
  lines.push('');

  // Table 3: Cost Sensitivity Matrix (Full Period)
  lines.push('### 3. Cost Sensitivity Matrix (Full Period Return% / MaxDD%)');
  lines.push('| Market | Cfg | Fee 0.10% / Slip 0 | Fee 0.15% / Slip 0.05% | Fee 0.20% / Slip 0.05% |');
  lines.push('|---|:---:|:---:|:---:|:---:|');
  for (const m of marketKeys) {
    for (const cfg of ['A', 'B', 'C'] as const) {
      const getVal = (fee: number, slip: number) => {
        const row = costSensResults.find(
          (c) => `${c.sym}_${c.tf}` === m && c.cfg === cfg && c.feePct === fee && c.slipPct === slip
        );
        if (!row) return 'N/A';
        const rStr = `${row.returnPct > 0 ? '+' : ''}${row.returnPct.toFixed(1)}%`;
        return `${rStr} (${row.maxDDPct.toFixed(1)}%)`;
      };
      lines.push(`| \`${m}\` | ${cfg} | ${getVal(0.1, 0)} | ${getVal(0.15, 0.05)} | ${getVal(0.2, 0.05)} |`);
    }
  }
  lines.push('');

  // Table 4: Random-Entry Null Hypothesis Test
  lines.push('### 4. Random-Entry Null Hypothesis Test (200 Simulations)');
  lines.push('| Market | Cfg | Actual Ret% | Mean Null% | 95th Pct Null% | Actual Pctile | Null Pass (≥90) |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|');
  for (const nr of nullTestResults) {
    const pStr = nr.pass ? '✅ PASS' : '❌ FAIL';
    lines.push(
      `| \`${nr.market}\` | ${nr.cfg} | ${nr.actualReturn > 0 ? '+' : ''}${nr.actualReturn.toFixed(1)}% | ${nr.meanNull > 0 ? '+' : ''}${nr.meanNull.toFixed(1)}% | ${nr.p95Null > 0 ? '+' : ''}${nr.p95Null.toFixed(1)}% | ${nr.actualPercentile.toFixed(1)}% | ${pStr} |`
    );
  }
  lines.push('');

  // Table 5: Final Verdict Matrix
  lines.push('### 5. Final Verdict Matrix');
  lines.push('| Market | Cfg | C1: Test>0 | C2: NoBest>0 | C3: DD≤12% | C4: CostRobust | C5: Null≥90 | Verdict |');
  lines.push('|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|');
  for (const v of verdictRows) {
    const tick = (b: boolean) => (b ? '✅' : '❌');
    const c5Str = v.cfg === 'B' ? 'N/A' : tick(v.c5);
    const vStr = v.pass ? '**PASS**' : 'FAIL';
    lines.push(
      `| \`${v.market}\` | ${v.cfg} | ${tick(v.c1)} | ${tick(v.c2)} | ${tick(v.c3)} | ${tick(v.c4)} | ${c5Str} | ${vStr} |`
    );
  }
  lines.push('');

  // Summary counts
  lines.push('### Verdict Summary');
  lines.push('| Candidate | Passed Markets (/6) | BTC Viable | ETH Viable | Final Acceptance |');
  lines.push('|---|:---:|:---:|:---:|:---:|');
  for (const cfg of ['A', 'B', 'C'] as const) {
    const rows = verdictRows.filter((r) => r.cfg === cfg);
    const passCount = rows.filter((r) => r.pass).length;
    const btcPass = rows.some((r) => r.market.startsWith('BTC') && r.pass);
    const ethPass = rows.some((r) => r.market.startsWith('ETH') && r.pass);
    const finalOk = passCount >= 2 && btcPass && ethPass;
    lines.push(
      `| **Candidate ${cfg}** | ${passCount} / 6 | ${btcPass ? '✅ Yes' : '❌ No'} | ${ethPass ? '✅ Yes' : '❌ No'} | ${finalOk ? '**ACCEPTED**' : '**REJECTED**'} |`
    );
  }

  const validationMdPath = path.resolve(rootDir, 'docs', 'review', 'VALIDATION.md');
  const finalContent = lines.join('\n') + '\n';
  const lineCount = finalContent.split('\n').length;
  console.log(`VALIDATION.md generated with ${lineCount} lines (budget <= 150).`);

  if (lineCount > 150) {
    console.error(`ERROR: VALIDATION.md exceeds 150 lines: ${lineCount}`);
  }

  await fs.writeFile(validationMdPath, finalContent, 'utf-8');

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Validation Completed in ${elapsedSec}s ===`);
}

main().catch((err) => {
  console.error('Validation script failed:', err);
  process.exit(1);
});

