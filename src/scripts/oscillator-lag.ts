import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Candle } from '../data/models';
import { calculateIchimoku } from '../indicators/ichimoku';
import { calculateStochastic } from '../indicators/stochastic';
import { calculateFisherRsi, calculateIftRsi } from '../indicators/fisher-rsi';
import { confirmedSwings } from '../indicators/swing';
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

function calculateMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : roundTo((sorted[mid - 1] + sorted[mid]) / 2, 1);
}

interface TriggerAnalysis {
  trigger: string;
  market: string;
  medianLag: number;
  noise: number;
  hitPercent: number;
  fav10Percent: number;
}

function analyzeMarket(
  symbol: string,
  interval: string,
  candles: Candle[]
): TriggerAnalysis[] {
  const market = `${symbol} ${interval}`;
  const closes = candles.map((c) => c.close);

  // 1. Calculate Indicators
  const ichi = calculateIchimoku(candles, { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 });
  const stoch = calculateStochastic(candles, { kPeriod: 14, dPeriod: 3, smooth: 3 });
  const { fisher, signal } = calculateFisherRsi(closes, { rsiPeriod: 14, window: 10 });
  const ift = calculateIftRsi(closes, { rsiPeriod: 14, wmaPeriod: 9 });

  const n = candles.length;

  // 2. Identify Bullish Event Indices
  const tkEvents: number[] = [];
  const stochEvents: number[] = [];
  const fisherEvents: number[] = [];
  const iftEvents: number[] = [];

  for (let i = 1; i < n; i++) {
    // TK cross
    if (
      Number.isFinite(ichi.tenkan[i]) &&
      Number.isFinite(ichi.kijun[i]) &&
      Number.isFinite(ichi.tenkan[i - 1]) &&
      Number.isFinite(ichi.kijun[i - 1]) &&
      ichi.tenkan[i - 1] <= ichi.kijun[i - 1] &&
      ichi.tenkan[i] > ichi.kijun[i]
    ) {
      tkEvents.push(i);
    }

    // Stoch cross
    if (
      Number.isFinite(stoch.k[i]) &&
      Number.isFinite(stoch.d[i]) &&
      Number.isFinite(stoch.k[i - 1]) &&
      Number.isFinite(stoch.d[i - 1]) &&
      stoch.k[i - 1] <= stoch.d[i - 1] &&
      stoch.k[i] > stoch.d[i]
    ) {
      stochEvents.push(i);
    }

    // Fisher cross
    if (
      Number.isFinite(fisher[i]) &&
      Number.isFinite(signal[i]) &&
      Number.isFinite(fisher[i - 1]) &&
      Number.isFinite(signal[i - 1]) &&
      fisher[i - 1] <= signal[i - 1] &&
      fisher[i] > signal[i]
    ) {
      fisherEvents.push(i);
    }

    // IFT cross
    if (
      Number.isFinite(ift[i]) &&
      Number.isFinite(ift[i - 1]) &&
      ift[i - 1] <= -0.5 &&
      ift[i] > -0.5
    ) {
      iftEvents.push(i);
    }
  }

  // 3. Confirmed Swings (k=3)
  const swings = confirmedSwings(candles, 3);
  const pivotLows = swings.lows;
  const numPivots = pivotLows.length;

  const triggers = [
    { name: 'TK Cross', events: tkEvents },
    { name: 'Stoch Cross (14,3,3)', events: stochEvents },
    { name: 'Fisher Cross', events: fisherEvents },
    { name: 'IFT Cross', events: iftEvents },
  ];

  const results: TriggerAnalysis[] = [];

  for (const trig of triggers) {
    const events = trig.events;
    const lags: number[] = [];
    let hitCount = 0;

    for (const pl of pivotLows) {
      const j = pl.index;
      // First event strictly after j within 30 bars
      let firstEventAfterJ: number | null = null;
      for (const e of events) {
        if (e > j) {
          if (e - j <= 30) {
            firstEventAfterJ = e;
          }
          break;
        }
      }

      if (firstEventAfterJ !== null) {
        lags.push(firstEventAfterJ - j);
      }

      // Hit in [j, j + 10]
      const hasHit = events.some((e) => e >= j && e <= j + 10);
      if (hasHit) {
        hitCount++;
      }
    }

    // fav10: average price movement (%) from close of event candle to 10 candles later
    let fav10Sum = 0;
    let fav10Count = 0;
    for (const e of events) {
      if (e + 10 < n) {
        const move = ((candles[e + 10].close - candles[e].close) / candles[e].close) * 100;
        fav10Sum += move;
        fav10Count++;
      }
    }

    const medianLag = lags.length > 0 ? calculateMedian(lags) : 0;
    const noise = numPivots > 0 ? roundTo(events.length / numPivots, 2) : 0;
    const hitPercent = numPivots > 0 ? roundTo((hitCount / numPivots) * 100, 1) : 0;
    const fav10Percent = fav10Count > 0 ? roundTo(fav10Sum / fav10Count, 2) : 0;

    results.push({
      trigger: trig.name,
      market,
      medianLag,
      noise,
      hitPercent,
      fav10Percent,
    });
  }

  return results;
}

export async function runOscillatorLagStudy(): Promise<void> {
  const dataDir = path.resolve(__dirname, '../../docs/review/data');
  const marketFiles = [
    { symbol: 'BTC', interval: '1h', file: 'BTCUSDT_1h.csv.gz' },
    { symbol: 'BTC', interval: '4h', file: 'BTCUSDT_4h.csv.gz' },
    { symbol: 'ETH', interval: '1h', file: 'ETHUSDT_1h.csv.gz' },
    { symbol: 'ETH', interval: '4h', file: 'ETHUSDT_4h.csv.gz' },
  ];

  const allResults: TriggerAnalysis[] = [];

  for (const m of marketFiles) {
    const fullPath = path.join(dataDir, m.file);
    const candles = loadGzCandles(fullPath);
    const results = analyzeMarket(m.symbol, m.interval, candles);
    allResults.push(...results);
  }

  // Generate Markdown table
  const lines: string[] = [];
  lines.push('# Oscillator Lag & Noise Study');
  lines.push('');
  lines.push('| Trigger | Market | Median Lag (bars) | Noise (events/pivot) | Hit % (within 10 bars) | Fav10 % (avg 10-bar move) |');
  lines.push('|---|---|---|---|---|---|');

  for (const r of allResults) {
    const favStr = (r.fav10Percent >= 0 ? '+' : '') + r.fav10Percent.toFixed(2) + '%';
    lines.push(
      `| ${r.trigger} | ${r.market} | ${r.medianLag} | ${r.noise.toFixed(2)} | ${r.hitPercent.toFixed(1)}% | ${favStr} |`
    );
  }

  const outPath = path.resolve(__dirname, '../../docs/review/OSC_LAG.md');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`Saved study to ${outPath} (${lines.length} lines)`);
}

if (require.main === module || process.argv[1]?.includes('oscillator-lag')) {
  runOscillatorLagStudy().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

