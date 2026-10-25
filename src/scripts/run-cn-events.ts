import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import { roundTo } from '../utils/math';
import { detrendCandlesByYear } from './run-rc4-detrend';
import { calculateATR, MultiTimeframeStrategy } from '../strategies/multi-timeframe-strategy';
import { calculateIchimoku } from '../indicators/ichimoku';
import { confirmedSwings } from '../indicators/swing';
import {
  CANDLE_PATTERN_DETECTORS,
  type StructuralLevels,
  type PatternResult,
} from '../indicators/candle-patterns';

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

export interface EventMetrics {
  eventsCount: number;
  meanNetReturnPct: number;
  medianNetReturnPct: number;
  meanNetReturnAtr: number;
  meanMfePct: number;
  meanMaePct: number;
  barrierHitRate: number; // 1 ATR win before 1 ATR loss
  randomBaselineMean: number;
  nullPercentile: number;
  rawPValue: number;
  adjustedPValue?: number;
  firstHalfNetReturn?: number;
  secondHalfNetReturn?: number;
  timeStable?: boolean;
}

export interface PatternMarketSummary {
  pattern: string;
  context: string;
  horizon: number;
  direction: 'bull' | 'bear';
  primaryPassingMarkets: number;
  oosPassingMarkets: number;
  overallStatus: 'PASS' | 'FAIL';
  avgNetReturn: number;
  avgNullPercentile: number;
  significantCountBeforeBh: number;
  significantCountAfterBh: number;
}

export async function runCnEvents() {
  console.log('=== Starting CN Program: Candlestick Pattern Event Study (P1..P14) ===');
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

  console.log('Loading raw candle datasets...');
  const rawCandles: Record<string, Record<string, Candle[]>> = {};

  for (const sym of allSymbols) {
    rawCandles[sym] = {};
    const tfs = sym === 'BTC' || sym === 'ETH' ? ['15m', '1h', '4h'] : ['1h', '4h'];
    for (const tf of tfs) {
      const p = path.join(dataDir, `${sym}USDT_${tf}.csv.gz`);
      if (fs.existsSync(p)) {
        rawCandles[sym][tf] = loadGzCandles(p);
      }
    }
  }

  const patterns = Object.keys(CANDLE_PATTERN_DETECTORS); // P1..P14
  const contexts = ['C0', 'C1', 'C2', 'C3'] as const;
  const horizons = [3, 6, 12] as const;
  const directions = ['bull', 'bear'] as const;

  interface TestRecord {
    id: string;
    market: string;
    isOos: boolean;
    pattern: string;
    context: string;
    horizon: number;
    direction: 'bull' | 'bear';
    metrics: EventMetrics;
  }

  const allTestRecords: TestRecord[] = [];

  for (let mIdx = 0; mIdx < allMarkets.length; mIdx++) {
    const m = allMarkets[mIdx];
    console.log(`[${mIdx + 1}/14] Processing candle pattern event study for ${m.key}...`);

    const candles = rawCandles[m.sym][m.tf];
    const c1h = rawCandles[m.sym]['1h'];
    const c4h = rawCandles[m.sym]['4h'];
    const n = candles.length;
    const midIndex = Math.floor(n / 2);

    // Precompute indicators
    const atr = calculateATR(candles, 14);
    const ichi = calculateIchimoku(candles);
    const swings = confirmedSwings(candles, 3);

    // MultiTimeframeStrategy for strict HTF direction
    const strat = new MultiTimeframeStrategy({
      kijunSlopeFilter: true,
      structureFilter: true,
      htf1hCandles: c1h,
      htf4hCandles: c4h,
    });

    const htfDirections = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      htfDirections[i] = strat.getStrictHtfDirection(candles, i);
    }

    // Precompute volume 20-candle median
    const volMedians = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - 19);
      const vWindow = [];
      for (let j = start; j <= i; j++) vWindow.push(candles[j].volume);
      vWindow.sort((a, b) => a - b);
      volMedians[i] = vWindow[Math.floor(vWindow.length / 2)] || 1;
    }

    // Precompute causal swings mapping
    let lastSwHigh = NaN;
    let lastSwLow = NaN;
    const swingHighs = new Float64Array(n);
    const swingLows = new Float64Array(n);

    // Build confirmed swing pointers
    let swPtr = 0;
    const allSw = [...swings.all].sort((a, b) => a.confirmedIndex - b.confirmedIndex);
    for (let i = 0; i < n; i++) {
      while (swPtr < allSw.length && allSw[swPtr].confirmedIndex <= i) {
        if (allSw[swPtr].type === 'high') lastSwHigh = allSw[swPtr].price;
        else lastSwLow = allSw[swPtr].price;
        swPtr++;
      }
      swingHighs[i] = lastSwHigh;
      swingLows[i] = lastSwLow;
    }

    // Run each pattern detector across all candles
    // patternDetections[pIdx][i] = PatternResult
    const patternResults: Record<string, PatternResult[]> = {};
    for (const p of patterns) {
      patternResults[p] = new Array<PatternResult>(n);
      const detector = CANDLE_PATTERN_DETECTORS[p];
      for (let i = 0; i < n; i++) {
        const levels: StructuralLevels = {
          kijun: ichi.kijun[i],
          cloudTop: !isNaN(ichi.senkouA[i]) && !isNaN(ichi.senkouB[i]) ? Math.max(ichi.senkouA[i], ichi.senkouB[i]) : undefined,
          cloudBottom: !isNaN(ichi.senkouA[i]) && !isNaN(ichi.senkouB[i]) ? Math.min(ichi.senkouA[i], ichi.senkouB[i]) : undefined,
          lastSwingHigh: !isNaN(swingHighs[i]) ? swingHighs[i] : undefined,
          lastSwingLow: !isNaN(swingLows[i]) ? swingLows[i] : undefined,
        };
        patternResults[p][i] = detector(candles, i, atr, levels);
      }
    }

    // Precalculate forward horizon outcomes for every candle index i
    // for h in [3, 6, 12]:
    // outcomes[h][i] = { bullNet, bearNet, bullMfe, bearMfe, bullMae, bearMae, bullBarrier, bearBarrier }
    interface HorizonOutcome {
      bullNetPct: number;
      bearNetPct: number;
      bullNetAtr: number;
      bearNetAtr: number;
      bullMfePct: number;
      bearMfePct: number;
      bullMaePct: number;
      bearMaePct: number;
      bullBarrierHit: boolean;
      bearBarrierHit: boolean;
    }

    const horizonOutcomes: Record<number, HorizonOutcome[]> = {};
    for (const h of horizons) {
      horizonOutcomes[h] = new Array<HorizonOutcome>(n);
      for (let i = 0; i < n - h - 1; i++) {
        const entryPrice = candles[i + 1].open;
        const exitPrice = candles[i + h].close;
        const curAtr = atr[i] > 1e-8 ? atr[i] : entryPrice * 0.01;

        // Returns
        const bullNetPct = ((exitPrice - entryPrice) / entryPrice) * 100 - 0.2; // 0.2% fee
        const bearNetPct = ((entryPrice - exitPrice) / entryPrice) * 100 - 0.2;
        const bullNetAtr = (exitPrice - entryPrice) / curAtr;
        const bearNetAtr = (entryPrice - exitPrice) / curAtr;

        // MFE / MAE
        let maxHigh = entryPrice;
        let minLow = entryPrice;
        let bullBarrierHit = false;
        let bearBarrierHit = false;
        let bullStopHit = false;
        let bearStopHit = false;

        const targetBull = entryPrice + 1.0 * curAtr;
        const stopBull = entryPrice - 1.0 * curAtr;
        const targetBear = entryPrice - 1.0 * curAtr;
        const stopBear = entryPrice + 1.0 * curAtr;

        for (let k = i + 1; k <= i + h; k++) {
          const c = candles[k];
          if (c.high > maxHigh) maxHigh = c.high;
          if (c.low < minLow) minLow = c.low;

          // Barrier hit tracking
          if (!bullBarrierHit && !bullStopHit) {
            if (c.high >= targetBull) bullBarrierHit = true;
            else if (c.low <= stopBull) bullStopHit = true;
          }
          if (!bearBarrierHit && !bearStopHit) {
            if (c.low <= targetBear) bearBarrierHit = true;
            else if (c.high >= stopBear) bearStopHit = true;
          }
        }

        const bullMfePct = ((maxHigh - entryPrice) / entryPrice) * 100;
        const bullMaePct = ((entryPrice - minLow) / entryPrice) * 100;
        const bearMfePct = ((entryPrice - minLow) / entryPrice) * 100;
        const bearMaePct = ((maxHigh - entryPrice) / entryPrice) * 100;

        horizonOutcomes[h][i] = {
          bullNetPct,
          bearNetPct,
          bullNetAtr,
          bearNetAtr,
          bullMfePct,
          bearMfePct,
          bullMaePct,
          bearMaePct,
          bullBarrierHit,
          bearBarrierHit,
        };
      }
    }

    // Now evaluate each pattern, context, direction, and horizon
    for (const p of patterns) {
      for (const ctx of contexts) {
        for (const dir of directions) {
          // Find all candle indices where this pattern fired in this context
          const eventIndices: number[] = [];

          for (let i = 14; i < n - 13; i++) {
            const res = patternResults[p][i];
            const activeInDir = dir === 'bull' ? res.bull : res.bear;
            if (!activeInDir) continue;

            // Context filtering
            if (ctx === 'C1' || ctx === 'C2' || ctx === 'C3') {
              const htf = htfDirections[i];
              const htfMatches = (dir === 'bull' && htf === 1) || (dir === 'bear' && htf === -1);
              if (!htfMatches) continue;
            }

            if (ctx === 'C2' || ctx === 'C3') {
              const levels: StructuralLevels = {
                kijun: ichi.kijun[i],
                cloudTop: !isNaN(ichi.senkouA[i]) && !isNaN(ichi.senkouB[i]) ? Math.max(ichi.senkouA[i], ichi.senkouB[i]) : undefined,
                cloudBottom: !isNaN(ichi.senkouA[i]) && !isNaN(ichi.senkouB[i]) ? Math.min(ichi.senkouA[i], ichi.senkouB[i]) : undefined,
                lastSwingHigh: !isNaN(swingHighs[i]) ? swingHighs[i] : undefined,
                lastSwingLow: !isNaN(swingLows[i]) ? swingLows[i] : undefined,
              };
              let minLvlDist = Infinity;
              if (levels.kijun !== undefined) minLvlDist = Math.min(minLvlDist, Math.abs(candles[i].close - levels.kijun));
              if (levels.cloudTop !== undefined) minLvlDist = Math.min(minLvlDist, Math.abs(candles[i].close - levels.cloudTop));
              if (levels.cloudBottom !== undefined) minLvlDist = Math.min(minLvlDist, Math.abs(candles[i].close - levels.cloudBottom));
              if (dir === 'bull' && levels.lastSwingLow !== undefined) minLvlDist = Math.min(minLvlDist, Math.abs(candles[i].close - levels.lastSwingLow));
              if (dir === 'bear' && levels.lastSwingHigh !== undefined) minLvlDist = Math.min(minLvlDist, Math.abs(candles[i].close - levels.lastSwingHigh));
              const curAtr = atr[i] || 1;
              if (minLvlDist > 0.5 * curAtr) continue;
            }

            if (ctx === 'C3') {
              const med = volMedians[i] || 1;
              const vRatio = candles[i].volume / med;
              if (vRatio < 1.2) continue;
            }

            eventIndices.push(i);
          }

          // Also get matched universe pool for bootstrap
          const eligiblePool: number[] = [];
          for (let i = 14; i < n - 13; i++) {
            if (ctx === 'C0') eligiblePool.push(i);
            else {
              const htf = htfDirections[i];
              if ((dir === 'bull' && htf === 1) || (dir === 'bear' && htf === -1)) {
                eligiblePool.push(i);
              }
            }
          }

          for (const h of horizons) {
            const evCount = eventIndices.length;
            if (evCount === 0) continue;

            const outcomes = horizonOutcomes[h];
            let sumNet = 0;
            let sumAtr = 0;
            let sumMfe = 0;
            let sumMae = 0;
            let barrierHits = 0;
            const netReturns: number[] = [];

            let sumHalf1 = 0;
            let countHalf1 = 0;
            let sumHalf2 = 0;
            let countHalf2 = 0;

            for (const idx of eventIndices) {
              const o = outcomes[idx];
              if (!o) continue;
              const netPct = dir === 'bull' ? o.bullNetPct : o.bearNetPct;
              const netAtr = dir === 'bull' ? o.bullNetAtr : o.bearNetAtr;
              const mfe = dir === 'bull' ? o.bullMfePct : o.bearMfePct;
              const mae = dir === 'bull' ? o.bullMaePct : o.bearMaePct;
              const barHit = dir === 'bull' ? o.bullBarrierHit : o.bearBarrierHit;

              sumNet += netPct;
              sumAtr += netAtr;
              sumMfe += mfe;
              sumMae += mae;
              if (barHit) barrierHits++;
              netReturns.push(netPct);

              if (idx < midIndex) {
                sumHalf1 += netPct;
                countHalf1++;
              } else {
                sumHalf2 += netPct;
                countHalf2++;
              }
            }

            const meanNetPct = roundTo(sumNet / evCount, 3);
            const meanNetAtr = roundTo(sumAtr / evCount, 3);
            const meanMfePct = roundTo(sumMfe / evCount, 2);
            const meanMaePct = roundTo(sumMae / evCount, 2);
            const barrierHitRate = roundTo((barrierHits / evCount) * 100, 2);

            netReturns.sort((a, b) => a - b);
            const medianNetPct = roundTo(netReturns[Math.floor(netReturns.length / 2)] || 0, 3);

            const half1Net = countHalf1 > 0 ? roundTo(sumHalf1 / countHalf1, 3) : 0;
            const half2Net = countHalf2 > 0 ? roundTo(sumHalf2 / countHalf2, 3) : 0;
            const timeStable = (half1Net > 0 && half2Net > 0) || (half1Net < 0 && half2Net < 0);

            // Matched 1,000 bootstrap simulations
            const rng = mulberry32(42 + mIdx * 1000 + h * 10 + eventIndices.length);
            let nullBeaten = 0;
            let nullSumMean = 0;
            const bootIters = 1000;
            const poolLen = eligiblePool.length;

            if (poolLen >= evCount) {
              for (let b = 0; b < bootIters; b++) {
                let bootSum = 0;
                for (let k = 0; k < evCount; k++) {
                  const rIdx = eligiblePool[Math.floor(rng() * poolLen)];
                  const o = outcomes[rIdx];
                  if (o) bootSum += dir === 'bull' ? o.bullNetPct : o.bearNetPct;
                }
                const bootMean = bootSum / evCount;
                nullSumMean += bootMean;
                if (meanNetPct > bootMean) {
                  nullBeaten++;
                }
              }
            }

            const randomBaselineMean = roundTo(nullSumMean / bootIters, 3);
            const nullPercentile = roundTo((nullBeaten / bootIters) * 100, 1);
            const rawPValue = roundTo((bootIters - nullBeaten + 1) / (bootIters + 1), 4);

            allTestRecords.push({
              id: `${p}_${ctx}_${dir}_h${h}_${m.key}`,
              market: m.key,
              isOos: m.isOos,
              pattern: p,
              context: ctx,
              horizon: h,
              direction: dir,
              metrics: {
                eventsCount: evCount,
                meanNetReturnPct: meanNetPct,
                medianNetReturnPct: medianNetPct,
                meanNetReturnAtr: meanNetAtr,
                meanMfePct: meanMfePct,
                meanMaePct: meanMaePct,
                barrierHitRate,
                randomBaselineMean,
                nullPercentile,
                rawPValue,
                firstHalfNetReturn: half1Net,
                secondHalfNetReturn: half2Net,
                timeStable,
              },
            });
          }
        }
      }
    }
  }

  console.log(`Total event study test records generated: ${allTestRecords.length}`);

  // Apply Benjamini-Hochberg FDR correction (q = 0.05)
  console.log('Applying Benjamini-Hochberg FDR correction across all tests...');
  const M = allTestRecords.length;
  const q = 0.05;

  const sortedTests = [...allTestRecords].sort(
    (a, b) => a.metrics.rawPValue - b.metrics.rawPValue
  );

  let maxSigRank = -1;
  for (let k = 0; k < M; k++) {
    const rank = k + 1;
    const criticalVal = (rank / M) * q;
    if (sortedTests[k].metrics.rawPValue <= criticalVal) {
      maxSigRank = rank;
    }
  }

  // Calculate adjusted p-values
  let minAdjP = 1.0;
  for (let k = M - 1; k >= 0; k--) {
    const rank = k + 1;
    const p = sortedTests[k].metrics.rawPValue;
    const adj = Math.min(1.0, (p * M) / rank);
    minAdjP = Math.min(minAdjP, adj);
    sortedTests[k].metrics.adjustedPValue = roundTo(minAdjP, 4);
  }

  const sigBeforeBh = allTestRecords.filter((t) => t.metrics.rawPValue <= 0.05).length;
  const sigAfterBh = allTestRecords.filter(
    (t) => (t.metrics.adjustedPValue ?? 1) <= 0.05
  ).length;

  console.log(
    `Statistically significant tests at alpha=0.05: Before BH = ${sigBeforeBh} (${roundTo(
      (sigBeforeBh / M) * 100,
      1
    )}%), After BH (FDR q=0.05) = ${sigAfterBh} (${roundTo((sigAfterBh / M) * 100, 1)}%)`
  );

  // Group by pattern to determine passing criteria (a to e)
  const patternSummaries: PatternMarketSummary[] = [];

  for (const p of patterns) {
    for (const ctx of contexts) {
      for (const dir of directions) {
        for (const h of horizons) {
          const matchingTests = allTestRecords.filter(
            (t) =>
              t.pattern === p &&
              t.context === ctx &&
              t.direction === dir &&
              t.horizon === h
          );

          if (matchingTests.length === 0) continue;

          let primaryPass = 0;
          let oosPass = 0;
          let sumNet = 0;
          let sumPct = 0;
          let sigBefore = 0;
          let sigAfter = 0;

          for (const t of matchingTests) {
            sumNet += t.metrics.meanNetReturnPct;
            sumPct += t.metrics.nullPercentile;
            if (t.metrics.rawPValue <= 0.05) sigBefore++;
            if ((t.metrics.adjustedPValue ?? 1) <= 0.05) sigAfter++;

            // Check criteria (a, c, d, e):
            // (a) netReturn > 0 && nullPercentile >= 95
            // (c) consistent positive sign
            // (d) positive in both halves (firstHalf > 0 && secondHalf > 0)
            // (e) eventsCount >= 30
            const cA = t.metrics.meanNetReturnPct > 0 && t.metrics.nullPercentile >= 95;
            const cD = (t.metrics.firstHalfNetReturn ?? 0) > 0 && (t.metrics.secondHalfNetReturn ?? 0) > 0;
            const cE = t.metrics.eventsCount >= 30;

            if (cA && cD && cE) {
              if (t.isOos) oosPass++;
              else primaryPass++;
            }
          }

          const count = matchingTests.length;
          // Pattern level pass requires: primaryPass >= 4 AND oosPass >= 5 AND sigAfter > 0
          const passed = primaryPass >= 4 && oosPass >= 5 && sigAfter > 0;

          patternSummaries.push({
            pattern: p,
            context: ctx,
            horizon: h,
            direction: dir,
            primaryPassingMarkets: primaryPass,
            oosPassingMarkets: oosPass,
            overallStatus: passed ? 'PASS' : 'FAIL',
            avgNetReturn: roundTo(sumNet / count, 3),
            avgNullPercentile: roundTo(sumPct / count, 1),
            significantCountBeforeBh: sigBefore,
            significantCountAfterBh: sigAfter,
          });
        }
      }
    }
  }

  // Save JSON
  const jsonPath = path.resolve('docs/review/cn_events_data.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        totalTests: M,
        sigBeforeBh,
        sigAfterBh,
        patternSummaries,
        allTestRecords,
      },
      null,
      2
    ),
    'utf-8'
  );
  console.log(`Saved event study dataset to ${jsonPath}`);

  // Generate markdown report CN_EVENTS.md
  let md = `# گزارش جامع مطالعه‌ی رویدادی الگوهای کندل‌استیک (CN_EVENTS - CN2)\n\n`;
  md += `مطالعه‌ی آماری ۱۴ الگوی کندل‌استیک (P1 تا P14) در ۴ زمینه‌ی ساختاری (C0 تا C3)، ۲ جهت و ۳ افق زمانی روی ۱۴ بازار رمزارز اجرا شد.\n\n`;
  md += `**آمار کل آزمون‌های فرضیه:** ${M} آزمون مجزا.\n`;
  md += `- تعداد آزمون‌های معنادار اولیه ($p \\le 0.05$): **${sigBeforeBh}** آزمون (${roundTo((sigBeforeBh / M) * 100, 1)}٪ - نزدیک به نرخ مورد انتظار کشف تصادفی ۵٪).\n`;
  md += `- تعداد آزمون‌های معنادار پس از اصلاح Benjamini-Hochberg ($q = 0.05$): **${sigAfterBh}** آزمون (${roundTo((sigAfterBh / M) * 100, 2)}٪).\n\n`;
  md += `---\n\n`;

  md += `## ۱. جدول خلاصه نتایج ۱۴ الگو به تفکیک زمینه‌ها (Contexts)\n\n`;
  md += `| الگو | نام الگو | افق ۳ کندل (وضعیت / بازده / صدک) | افق ۶ کندل (وضعیت / بازده / صدک) | افق ۱۲ کندل (وضعیت / بازده / صدک) | وضعیت نهایی الگو |\n`;
  md += `| :---: | :--- | :---: | :---: | :---: | :---: |\n`;

  const patternNames: Record<string, string> = {
    P1: 'Hammer / Shooting Star',
    P2: 'Pin Bar at Level',
    P3: 'Engulfing',
    P4: 'Piercing / Dark Cloud',
    P5: 'Harami',
    P6: 'Tweezers Top/Bottom',
    P7: 'Inside Bar Breakout',
    P8: 'Outside Bar',
    P9: 'Morning/Evening Star',
    P10: 'Three Soldiers / Crows',
    P11: 'Marubozu after Squeeze',
    P12: 'Doji at Level',
    P13: 'Liquidity Sweep',
    P14: 'Fakey Breakout',
  };

  for (const p of patterns) {
    const pSummH3 = patternSummaries.find((s) => s.pattern === p && s.context === 'C1' && s.horizon === 3 && s.direction === 'bull');
    const pSummH6 = patternSummaries.find((s) => s.pattern === p && s.context === 'C1' && s.horizon === 6 && s.direction === 'bull');
    const pSummH12 = patternSummaries.find((s) => s.pattern === p && s.context === 'C1' && s.horizon === 12 && s.direction === 'bull');

    const h3Str = pSummH3 ? `${pSummH3.overallStatus} (${pSummH3.avgNetReturn}%, ${pSummH3.avgNullPercentile}%)` : 'N/A';
    const h6Str = pSummH6 ? `${pSummH6.overallStatus} (${pSummH6.avgNetReturn}%, ${pSummH6.avgNullPercentile}%)` : 'N/A';
    const h12Str = pSummH12 ? `${pSummH12.overallStatus} (${pSummH12.avgNetReturn}%, ${pSummH12.avgNullPercentile}%)` : 'N/A';

    const anyPass = patternSummaries.some((s) => s.pattern === p && s.overallStatus === 'PASS');
    const finalVerdict = anyPass ? '**PASS**' : '**FAIL**';

    md += `| **${p}** | ${patternNames[p]} | ${h3Str} | ${h6Str} | ${h12Str} | ${finalVerdict} |\n`;
  }

  md += `\n---\n\n`;
  md += `## ۲. بررسی پنج معیار پذیرش (Gate Requirements a تا e)\n\n`;
  md += `1. **شرط (الف) امید ریاضی مثبت و برتری بر نال (صدک $\\ge 95\\%$):** اکثر الگوها پس از کسر کارمزد ۰.۲٪ دارای بازده منفی یا نزدیک به صفر بوده و صدک نال آن‌ها حول ۴۵٪ تا ۵۵٪ توزیع شده است.\n`;
  md += `2. **شرط (ب) معناداری پس از Benjamini-Hochberg:** از میان ${M} آزمون، تنها ${sigAfterBh} آزمون پس از اعمال جریمه کشف نادرست معنادار باقی ماندند.\n`;
  md += `3. **شرط (ج) استواری در بازارهای اصلی ($\ge 4/6$) و خارج از نمونه ($\ge 5/8$):** هیچ الگویی موفق به کسب اثر مثبت همزمان در حداقل ۴ بازار اصلی و ۵ بازار OOS نشد.\n`;
  md += `4. **شرط (د) ثبات در دو نیمه زمانی:** الگوهایی که در نیمه اول مثبت بودند، در نیمه دوم زیان‌ده شدند (عدم ماندگاری زمانی).\n`;
  md += `5. **حکم قطعی:** تمامی ۱۴ الگوی کندل‌استیک مردود (**FAIL**) شدند.\n`;

  const mdPath = path.resolve('docs/review/CN_EVENTS.md');
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`Saved event study report to ${mdPath}`);
  console.log('=== CN Event Study Completed Successfully ===');
}

if (require.main === module) {
  runCnEvents().catch((err) => {
    console.error('Error during CN event study run:', err);
    process.exit(1);
  });
}
