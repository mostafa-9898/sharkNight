import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle, TradeSignal } from '../data/models';
import type { Strategy } from '../strategies/types';
import { MultiTimeframeStrategy, type FisherMode, type FisherKind } from '../strategies/multi-timeframe-strategy';
import { BacktestEngine } from '../backtest/engine';
import { roundTo } from '../utils/math';

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

interface MarketData {
  symbol: string;
  interval: string;
  key: string;
  candles: Candle[];
  c1h: Candle[];
  c4h: Candle[];
  eligibleLongOnly: { idx: number; dir: 1 | -1 }[];
}

interface ConfigDef {
  id: string;
  fisherMode: FisherMode;
  fisherKind: FisherKind;
}

const CONFIGS: ConfigDef[] = [
  { id: 'D0', fisherMode: 'off', fisherKind: 'fisher' },
  { id: 'F1', fisherMode: 'extra-trigger', fisherKind: 'fisher' },
  { id: 'F2', fisherMode: 'replace-stoch', fisherKind: 'fisher' },
  { id: 'F3', fisherMode: 'confirm', fisherKind: 'fisher' },
  { id: 'I1', fisherMode: 'extra-trigger', fisherKind: 'ift' },
  { id: 'I2', fisherMode: 'replace-stoch', fisherKind: 'ift' },
  { id: 'I3', fisherMode: 'confirm', fisherKind: 'ift' },
];

interface RunResult {
  configId: string;
  marketKey: string;
  totalReturn: number;
  maxDD: number;
  totalTrades: number;
  h2Return: number;
  returnWithoutTop3: number;
  returnOverMaxDD: number;
  nullPercentile: number;
}

export async function runValidateFisher(): Promise<{ winner: ConfigDef; superior: boolean }> {
  const dataDir = path.resolve(__dirname, '../../docs/review/data');
  const symbols = ['BTC', 'ETH'] as const;
  const intervals = ['15m', '1h', '4h'] as const;

  console.log('Loading candles for 6 markets...');
  const candleCache: Record<string, Record<string, Candle[]>> = { BTC: {}, ETH: {} };

  for (const sym of symbols) {
    for (const tf of intervals) {
      candleCache[sym][tf] = loadGzCandles(path.join(dataDir, `${sym}USDT_${tf}.csv.gz`));
    }
  }

  const markets: MarketData[] = [];
  const engine = new BacktestEngine();

  for (const sym of symbols) {
    for (const tf of intervals) {
      const candles = candleCache[sym][tf];
      const c1h = candleCache[sym]['1h'];
      const c4h = candleCache[sym]['4h'];
      const key = `${sym} ${tf}`;

      // Build HTF direction oracle for null simulation
      const baseStrategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: 'off',
        htf1hCandles: c1h,
        htf4hCandles: c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const eligibleLongOnly: { idx: number; dir: 1 | -1 }[] = [];
      for (let i = 0; i < candles.length; i++) {
        const dir = baseStrategy.getStrictHtfDirection(candles, i);
        if (dir === 1) {
          eligibleLongOnly.push({ idx: i, dir: 1 });
        }
      }

      markets.push({
        symbol: sym,
        interval: tf,
        key,
        candles,
        c1h,
        c4h,
        eligibleLongOnly,
      });
    }
  }

  const simEngineConfig = {
    initialBalance: 10000,
    positionSizePercent: 5,
    tradeFeePercent: 0.1,
    tradeMode: 'long-only' as const,
    exitMode: 'trailingOnly' as const,
    trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5 },
    maxOpenPositions: 1,
  };

  const results: Record<string, Record<string, RunResult>> = {};

  for (const cfg of CONFIGS) {
    results[cfg.id] = {};
    console.log(`Evaluating configuration ${cfg.id}...`);

    for (const m of markets) {
      const strategy = new MultiTimeframeStrategy({
        htfMode: 'strict',
        entryMode: 'cross',
        fisherMode: cfg.fisherMode,
        fisherKind: cfg.fisherKind,
        htf1hCandles: m.c1h,
        htf4hCandles: m.c4h,
        kijunSlopeFilter: true,
        structureFilter: true,
      });

      const res = engine.run({
        ...simEngineConfig,
        strategy,
        candles: m.candles,
      });

      const totalReturn = roundTo(res.metrics.totalPnlPercent, 2);
      const maxDD = roundTo(res.metrics.maxDrawdownPercent, 2);
      const totalTrades = res.metrics.totalTrades;

      // H2 Return
      const midIdx = Math.floor(res.equity.length / 2);
      const eqMid = res.equity[midIdx] ?? 10000;
      const eqEnd = res.equity[res.equity.length - 1] ?? 10000;
      const h2Return = eqMid > 0 ? roundTo(((eqEnd - eqMid) / eqMid) * 100, 2) : 0;

      // Return without top 3 trades
      let returnWithoutTop3 = totalReturn;
      if (res.trades.length > 0) {
        const sortedTrades = [...res.trades].sort((a, b) => b.pnl - a.pnl);
        const top3Pnl = sortedTrades.slice(0, 3).reduce((sum, t) => sum + t.pnl, 0);
        returnWithoutTop3 = roundTo(((res.metrics.totalPnl - top3Pnl) / 10000) * 100, 2);
      }

      const returnOverMaxDD = maxDD > 0 ? roundTo(totalReturn / maxDD, 2) : 0;

      // Random Entry Null Test: 200 runs
      const targetTrades = totalTrades;
      const eligible = m.eligibleLongOnly;

      // Calibrate multiplier
      let bestM = 1.0;
      if (targetTrades > 0 && eligible.length > 0) {
        const calibSeeds = [42, 43, 44, 45, 46];
        let bestDiff = Infinity;
        for (const candM of [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]) {
          const count = Math.min(eligible.length, Math.max(1, Math.round(targetTrades * candM)));
          let tSum = 0;
          for (const s of calibSeeds) {
            const rng = mulberry32(s);
            const chosen = sampleDistinctIndices(eligible.length, count, rng);
            const sigMap = new Map<number, 1 | -1>();
            for (const idx of chosen) sigMap.set(eligible[idx].idx, eligible[idx].dir);
            const simRes = engine.run({
              ...simEngineConfig,
              strategy: new RandomEntryStrategy(sigMap),
              candles: m.candles,
            });
            tSum += simRes.metrics.totalTrades;
          }
          const avg = tSum / calibSeeds.length;
          const diff = Math.abs(avg - targetTrades) / targetTrades;
          if (diff < bestDiff) {
            bestDiff = diff;
            bestM = candM;
          }
        }
      }

      const sampleCount = Math.min(eligible.length, Math.max(1, Math.round(targetTrades * bestM)));
      const simReturns: number[] = [];

      for (let s = 0; s < 200; s++) {
        const rng = mulberry32(42 + s);
        const chosen = sampleDistinctIndices(eligible.length, sampleCount, rng);
        const sigMap = new Map<number, 1 | -1>();
        for (const idx of chosen) sigMap.set(eligible[idx].idx, eligible[idx].dir);
        const simRes = engine.run({
          ...simEngineConfig,
          strategy: new RandomEntryStrategy(sigMap),
          candles: m.candles,
        });
        simReturns.push(roundTo(simRes.metrics.totalPnlPercent, 2));
      }

      const countBeaten = simReturns.filter((r) => totalReturn > r).length;
      const nullPercentile = roundTo((countBeaten / 200) * 100, 1);

      results[cfg.id][m.key] = {
        configId: cfg.id,
        marketKey: m.key,
        totalReturn,
        maxDD,
        totalTrades,
        h2Return,
        returnWithoutTop3,
        returnOverMaxDD,
        nullPercentile,
      };

      console.log(
        `  ${cfg.id} on ${m.key.padEnd(8)}: Ret=${totalReturn.toFixed(1)}% MaxDD=${maxDD.toFixed(1)}% Trades=${totalTrades} Ret/DD=${returnOverMaxDD.toFixed(2)} Pct=${nullPercentile}%`
      );
    }
  }

  // Selection Rule Evaluation
  // For each of the 6 Fisher/IFT configs: count markets where return/maxDD > D0.return/maxDD
  const candidateScores: {
    cfg: ConfigDef;
    wins: number;
    avgRetOverDD: number;
    superiorPass: boolean;
  }[] = [];

  const fisherConfigs = CONFIGS.filter((c) => c.id !== 'D0');

  for (const cfg of fisherConfigs) {
    let wins = 0;
    let sumRetOverDD = 0;

    let retOverDDWins = 0;
    let noTop3AllPos = true;
    let h2AllPos = true;
    let nullPctWins = 0;

    for (const m of markets) {
      const d0 = results['D0'][m.key];
      const cur = results[cfg.id][m.key];

      sumRetOverDD += cur.returnOverMaxDD;

      if (cur.returnOverMaxDD > d0.returnOverMaxDD) {
        wins++;
        retOverDDWins++;
      }
      if (cur.returnWithoutTop3 <= 0) {
        noTop3AllPos = false;
      }
      if (cur.h2Return <= 0) {
        h2AllPos = false;
      }
      if (cur.nullPercentile >= d0.nullPercentile) {
        nullPctWins++;
      }
    }

    const avgRetOverDD = sumRetOverDD / markets.length;
    const superiorPass =
      retOverDDWins >= 5 &&
      noTop3AllPos &&
      h2AllPos &&
      nullPctWins >= 5;

    candidateScores.push({
      cfg,
      wins,
      avgRetOverDD,
      superiorPass,
    });
  }

  // Sort candidates by:
  // 1. Most markets beating D0 on return/maxDD (wins)
  // 2. Tiebreaker: highest avgRetOverDD
  candidateScores.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.avgRetOverDD - a.avgRetOverDD;
  });

  const bestCandidate = candidateScores[0];
  const winner = bestCandidate.cfg;
  const isSuperior = bestCandidate.superiorPass;

  console.log(`\n🏆 Winner: ${winner.id} (${winner.fisherMode}/${winner.fisherKind}) with ${bestCandidate.wins}/6 wins, avg Ret/DD = ${bestCandidate.avgRetOverDD.toFixed(2)}`);
  console.log(`Superior: ${isSuperior ? 'Superior' : 'Not superior (default per owner requirement)'}`);

  // Build Markdown Document (<= 100 lines, only table + label)
  const mdLines: string[] = [];
  mdLines.push('# Fisher RSI / IFT A/B Testing & Selection');
  mdLines.push('');
  mdLines.push('## 1. Matrix Results Across BTC & ETH (5% size, 0.1% fee, trailingOnly 3/3/1.5, maxPos 1)');
  mdLines.push('');
  mdLines.push('| Config | Market | Return | MaxDD | Trades | H2 Ret | Ret w/o Top3 | Ret/MaxDD | Null Pct |');
  mdLines.push('|---|---|---|---|---|---|---|---|---|');

  for (const cfg of CONFIGS) {
    for (const m of markets) {
      const r = results[cfg.id][m.key];
      const retStr = (r.totalReturn >= 0 ? '+' : '') + r.totalReturn.toFixed(1) + '%';
      const h2Str = (r.h2Return >= 0 ? '+' : '') + r.h2Return.toFixed(1) + '%';
      const no3Str = (r.returnWithoutTop3 >= 0 ? '+' : '') + r.returnWithoutTop3.toFixed(1) + '%';
      mdLines.push(
        `| ${cfg.id} | ${m.key} | ${retStr} | ${r.maxDD.toFixed(1)}% | ${r.totalTrades} | ${h2Str} | ${no3Str} | ${r.returnOverMaxDD.toFixed(2)} | ${r.nullPercentile.toFixed(1)}% |`
      );
    }
  }

  mdLines.push('');
  mdLines.push('## 2. Selection Scores & Superiority Verification');
  mdLines.push('');
  mdLines.push('| Config | Mode / Kind | Wins vs D0 (Ret/DD) | Avg Ret/MaxDD | Superior Criteria | Selected |');
  mdLines.push('|---|---|---|---|---|---|');

  for (const cs of candidateScores) {
    const isWin = cs.cfg.id === winner.id;
    mdLines.push(
      `| ${cs.cfg.id} | ${cs.cfg.fisherMode}/${cs.cfg.fisherKind} | ${cs.wins}/6 | ${cs.avgRetOverDD.toFixed(2)} | ${cs.superiorPass ? 'PASS' : 'FAIL'} | ${isWin ? '✅ WINNER' : '-'} |`
    );
  }

  mdLines.push('');
  mdLines.push(`**Selected Default Configuration:** \`${winner.id}\` (\`fisherMode: '${winner.fisherMode}'\`, \`fisherKind: '${winner.fisherKind}'\`)`);
  mdLines.push('');
  mdLines.push(
    `**Final Classification:** ${isSuperior ? 'Superior' : 'Not superior (default per owner requirement)'}`
  );

  const outPath = path.resolve(__dirname, '../../docs/review/FISHER_AB.md');
  fs.writeFileSync(outPath, mdLines.join('\n') + '\n', 'utf-8');
  console.log(`Saved report to ${outPath} (${mdLines.length} lines)`);

  return { winner, superior: isSuperior };
}

if (require.main === module || process.argv[1]?.includes('validate-fisher')) {
  runValidateFisher().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

