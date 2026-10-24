import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle, TradeSignal } from '../data/models';
import type { Trade, TradeMode } from '../backtest/types';
import type { Strategy } from '../strategies/types';
import { MultiTimeframeStrategy, type FisherMode, type FisherKind } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';

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
  private readonly signals: Map<number, 1 | -1>;

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

function calibrateMultiplier(
  engine: BacktestEngine,
  candles: readonly Candle[],
  eligible: Array<{ idx: number; dir: 1 | -1 }>,
  targetTrades: number,
  simConfig: any
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

export async function runHEvaluation() {
  const dataDir = path.resolve('docs/review/data');
  const primarySymbols = ['BTC', 'ETH'] as const;
  const primaryIntervals = ['15m', '1h', '4h'] as const;

  console.log('Loading candle datasets...');
  const candleStore: Record<string, Record<string, Candle[]>> = {};
  for (const sym of primarySymbols) {
    candleStore[sym] = {};
    for (const tf of primaryIntervals) {
      const p = path.join(dataDir, `${sym}USDT_${tf}.csv.gz`);
      if (fs.existsSync(p)) {
        candleStore[sym][tf] = loadGzCandles(p);
      } else {
        throw new Error(`Missing candle dataset: ${p}`);
      }
    }
  }

  const engine = new BacktestEngine();

  const baseConfig = {
    initialBalance: 10000,
    positionSizePercent: 3,
    maxOpenPositions: 10,
    maxTotalExposurePercent: 30,
    minBarsBetweenEntries: 0,
    allowOppositePositions: true,
    tradeFeePercent: 0.1,
    tradeMode: 'long-short' as TradeMode,
    exitMode: 'trailingOnly' as const,
    trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' as const },
  };

  const markets = [
    { key: 'BTC 15m', sym: 'BTC', tf: '15m' },
    { key: 'BTC 1h', sym: 'BTC', tf: '1h' },
    { key: 'BTC 4h', sym: 'BTC', tf: '4h' },
    { key: 'ETH 15m', sym: 'ETH', tf: '15m' },
    { key: 'ETH 1h', sym: 'ETH', tf: '1h' },
    { key: 'ETH 4h', sym: 'ETH', tf: '4h' },
  ];

  type CandidateDef = {
    id: string;
    fisherMode: FisherMode;
    fisherGate: 'none' | 'zone';
  };

  const candidates: CandidateDef[] = [
    { id: 'F0 (off)', fisherMode: 'off', fisherGate: 'none' },
    { id: 'F1-none', fisherMode: 'extra-trigger', fisherGate: 'none' },
    { id: 'F1-zone', fisherMode: 'extra-trigger', fisherGate: 'zone' },
    { id: 'F3-none', fisherMode: 'confirm', fisherGate: 'none' },
    { id: 'F3-zone', fisherMode: 'confirm', fisherGate: 'zone' },
    { id: 'F4-none', fisherMode: 'cross-confirm', fisherGate: 'none' },
    { id: 'F4-zone', fisherMode: 'cross-confirm', fisherGate: 'zone' },
  ];

  interface MarketResult {
    market: string;
    candidate: string;
    totalReturn: number;
    maxDD: number;
    retDdRatio: number;
    trades: number;
    winRate: number;
    nullPercentile: number;
  }

  const allResults: MarketResult[] = [];

  console.log('\n--- Running H4 Candidate Evaluations ---');

  for (const c of candidates) {
    console.log(`\nEvaluating Candidate: ${c.id}`);
    for (const m of markets) {
      const candles = candleStore[m.sym][m.tf];
      const c1h = candleStore[m.sym]['1h'];
      const c4h = candleStore[m.sym]['4h'];

      const strategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: c.fisherMode,
        fisherKind: 'fisher',
        fisherGate: c.fisherGate,
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const res = engine.run({
        ...baseConfig,
        strategy,
        candles,
      });

      const totalReturn = roundTo(res.metrics.totalPnlPercent, 2);
      const maxDD = roundTo(res.metrics.maxDrawdownPercent, 2);
      const retDdRatio = maxDD > 0 ? roundTo(totalReturn / maxDD, 2) : 0;
      const trades = res.metrics.totalTrades;
      const winRate = roundTo(res.metrics.winRate * 100, 1);

      // Run 200 random simulations null distribution
      const eligible: Array<{ idx: number; dir: 1 | -1 }> = [];
      for (let i = 0; i < candles.length; i++) {
        const dir = strategy.getStrictHtfDirection(candles, i);
        if (dir === 1 || dir === -1) eligible.push({ idx: i, dir });
      }

      const mult = calibrateMultiplier(engine, candles, eligible, trades, baseConfig);
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
          ...baseConfig,
          strategy: new RandomEntryStrategy(sigMap),
          candles,
        });
        simReturns.push(roundTo(simRes.metrics.totalPnlPercent, 2));
      }

      const beaten = simReturns.filter((r) => totalReturn > r).length;
      const nullPercentile = roundTo((beaten / 200) * 100, 1);

      allResults.push({
        market: m.key,
        candidate: c.id,
        totalReturn,
        maxDD,
        retDdRatio,
        trades,
        winRate,
        nullPercentile,
      });

      console.log(
        `  ${m.key.padEnd(8)}: Ret = ${String(totalReturn).padStart(7)}% | DD = ${String(maxDD).padStart(5)}% | Ret/DD = ${String(retDdRatio).padStart(5)} | Trades = ${String(trades).padStart(4)} | WR = ${String(winRate).padStart(5)}% | Null% = ${nullPercentile}%`
      );
    }
  }

  // Determine winning candidate from Step 2 under H7 criteria
  const f3Results = allResults.filter((r) => r.candidate === 'F3-none');
  const f3Map = new Map(f3Results.map((r) => [r.market, r]));

  const candidateScores: Record<string, { wins: number; passMarkets: string[] }> = {};
  for (const c of candidates) {
    if (c.id === 'F3-none') continue;
    let wins = 0;
    const passMarkets: string[] = [];
    for (const m of markets) {
      const cRes = allResults.find((r) => r.candidate === c.id && r.market === m.key)!;
      const baseRes = f3Map.get(m.key)!;
      const retDdBetter = cRes.retDdRatio >= baseRes.retDdRatio;
      const ddOk = cRes.maxDD <= roundTo(baseRes.maxDD * 1.2 + 0.001, 2);
      const ddAbsOk = cRes.maxDD <= 20.0;
      if (retDdBetter && ddOk && ddAbsOk) {
        wins++;
        passMarkets.push(m.key);
      }
    }
    candidateScores[c.id] = { wins, passMarkets };
  }

  let winner = candidates.find((c) => c.id === 'F3-none')!;
  let bestWins = 3; // Needs >= 4 to beat default
  for (const c of candidates) {
    if (candidateScores[c.id] && candidateScores[c.id].wins > bestWins) {
      bestWins = candidateScores[c.id].wins;
      winner = c;
    }
  }

  console.log(`\n======================================================`);
  console.log(`H7 Candidate Comparison vs Default F3-none:`);
  for (const [id, score] of Object.entries(candidateScores)) {
    console.log(`  ${id.padEnd(10)}: ${score.wins}/6 wins [${score.passMarkets.join(', ')}]`);
  }
  console.log(`Step 2 Winner: ${winner.id} (mode=${winner.fisherMode}, gate=${winner.fisherGate})`);
  console.log(`======================================================\n`);

  console.log(`\n--- Running H7 (allowOppositePositions true vs false with Winner ${winner.id}) ---`);
  interface OppComparison {
    market: string;
    trueRet: number;
    trueDD: number;
    trueRetDd: number;
    falseRet: number;
    falseDD: number;
    falseRetDd: number;
  }
  const oppResults: OppComparison[] = [];
  for (const m of markets) {
    const candles = candleStore[m.sym][m.tf];
    const c1h = candleStore[m.sym]['1h'];
    const c4h = candleStore[m.sym]['4h'];
    const strat = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: winner.fisherMode,
      fisherKind: 'fisher',
      fisherGate: winner.fisherGate,
      htf1hCandles: c1h,
      htf4hCandles: c4h,
      kijunSlopeFilter: true,
      structureFilter: true,
    });

    const resTrue = engine.run({ ...baseConfig, strategy: strat, candles, allowOppositePositions: true });
    const resFalse = engine.run({ ...baseConfig, strategy: strat, candles, allowOppositePositions: false });

    oppResults.push({
      market: m.key,
      trueRet: roundTo(resTrue.metrics.totalPnlPercent, 2),
      trueDD: roundTo(resTrue.metrics.maxDrawdownPercent, 2),
      trueRetDd: resTrue.metrics.maxDrawdownPercent > 0 ? roundTo(resTrue.metrics.totalPnlPercent / resTrue.metrics.maxDrawdownPercent, 2) : 0,
      falseRet: roundTo(resFalse.metrics.totalPnlPercent, 2),
      falseDD: roundTo(resFalse.metrics.maxDrawdownPercent, 2),
      falseRetDd: resFalse.metrics.maxDrawdownPercent > 0 ? roundTo(resFalse.metrics.totalPnlPercent / resFalse.metrics.maxDrawdownPercent, 2) : 0,
    });
  }

  console.log(`\n--- Running H7 Risk/Cap comparison (3%/30% vs 2%/20% with Winner ${winner.id}) ---`);
  interface RiskComparison {
    market: string;
    baseRet: number;
    baseDD: number;
    baseRetDd: number;
    lowRet: number;
    lowDD: number;
    lowRetDd: number;
  }
  const riskResults: RiskComparison[] = [];
  for (const m of markets) {
    const candles = candleStore[m.sym][m.tf];
    const c1h = candleStore[m.sym]['1h'];
    const c4h = candleStore[m.sym]['4h'];
    const strat = new MultiTimeframeStrategy({
      htfMode: 'strict',
      entryMode: 'cross',
      fisherMode: winner.fisherMode,
      fisherKind: 'fisher',
      fisherGate: winner.fisherGate,
      htf1hCandles: c1h,
      htf4hCandles: c4h,
      kijunSlopeFilter: true,
      structureFilter: true,
    });

    const resBase = engine.run({ ...baseConfig, strategy: strat, candles });
    const resLow = engine.run({
      ...baseConfig,
      positionSizePercent: 2,
      maxTotalExposurePercent: 20,
      strategy: strat,
      candles,
    });

    riskResults.push({
      market: m.key,
      baseRet: roundTo(resBase.metrics.totalPnlPercent, 2),
      baseDD: roundTo(resBase.metrics.maxDrawdownPercent, 2),
      baseRetDd: resBase.metrics.maxDrawdownPercent > 0 ? roundTo(resBase.metrics.totalPnlPercent / resBase.metrics.maxDrawdownPercent, 2) : 0,
      lowRet: roundTo(resLow.metrics.totalPnlPercent, 2),
      lowDD: roundTo(resLow.metrics.maxDrawdownPercent, 2),
      lowRetDd: resLow.metrics.maxDrawdownPercent > 0 ? roundTo(resLow.metrics.totalPnlPercent / resLow.metrics.maxDrawdownPercent, 2) : 0,
    });
  }

  // Dump JSON result
  const output = {
    allResults,
    candidateScores,
    winner: winner.id,
    oppResults,
    riskResults,
  };
  fs.writeFileSync('docs/review/h_eval_data_v2.json', JSON.stringify(output, null, 2));
  console.log('\nWrote docs/review/h_eval_data_v2.json successfully.');
}

runHEvaluation().catch((err) => {
  console.error(err);
  process.exit(1);
});
