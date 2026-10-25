import { PineTS } from 'pinets';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { runFisherIndependent } from './fisher_independent.mjs';

async function generateFisherPineFixture() {
  console.log('Generating Fisher Pine parity fixture from 500 1h BTC candles...');
  const gzPath = path.resolve('docs/review/data/BTCUSDT_1h.csv.gz');
  const raw = fs.readFileSync(gzPath);
  const unzipped = zlib.gunzipSync(raw).toString('utf-8');
  const lines = unzipped.trim().split('\n');

  const candles: Array<{ openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number }> = [];
  const simpleCandles: Array<{ time: number; close: number }> = [];

  for (let i = 1; i <= Math.min(500, lines.length - 1); i++) {
    const parts = lines[i].split(',');
    const time = parseInt(parts[0], 10);
    const open = parseFloat(parts[1]);
    const high = parseFloat(parts[2]);
    const low = parseFloat(parts[3]);
    const close = parseFloat(parts[4]);
    const volume = parseFloat(parts[5]);

    candles.push({
      openTime: time,
      open,
      high,
      low,
      close,
      volume,
      closeTime: time + 3600000 - 1,
    });
    simpleCandles.push({ time, close });
  }

  // 1. Run pinets
  const pineScript = `//@version=5
indicator("FisherRSI_Compute", overlay=false)

rsi_length = 14
rsi_smoothing = 1
oversold_level = 30
overbought_level = 70
fisher_length = 10
enable_fisher_transform = true
show_fisher_arrows = true

rsi_score = ta.sma(ta.rsi(close, rsi_length), rsi_smoothing)
score = rsi_score

var float fisher_value1 = 0.0
var float fisher_transform = 0.0

fisher_highest = ta.highest(rsi_score, fisher_length)
fisher_lowest = ta.lowest(rsi_score, fisher_length)
fisher_range = fisher_highest - fisher_lowest

fisher_position = fisher_range != 0 ? (rsi_score - fisher_lowest) / fisher_range - 0.5 : 0.0
fisher_value1 := 0.33 * 2 * fisher_position + 0.67 * nz(fisher_value1[1])
fisher_value1 := math.max(math.min(fisher_value1, 0.999), -0.999)
fisher_transform := 0.5 * math.log((1 + fisher_value1) / (1 - fisher_value1)) + 0.5 * nz(fisher_transform[1])
fisher_signal = fisher_transform[1]

fisher_value_scaled = 50 + fisher_transform * 10

fisher_bull_zone = score <= oversold_level or fisher_value_scaled <= oversold_level
fisher_bear_zone = score >= overbought_level or fisher_value_scaled >= overbought_level

fisher_cross_up = show_fisher_arrows and ta.crossover(fisher_transform, fisher_signal) and fisher_bull_zone
fisher_cross_down = show_fisher_arrows and ta.crossunder(fisher_transform, fisher_signal) and fisher_bear_zone

fisher_any_cross_up = ta.crossover(fisher_transform, fisher_signal)
fisher_any_cross_down = ta.crossunder(fisher_transform, fisher_signal)

fisher_scaled = enable_fisher_transform ? fisher_value_scaled : na
fisher_signal_scaled = enable_fisher_transform ? 50 + fisher_signal * 10 : na

plot(fisher_scaled, "fisherScaled")
plot(fisher_signal_scaled, "signalScaled")
plot(fisher_any_cross_up ? 1 : 0, "anyCrossUp")
plot(fisher_any_cross_down ? 1 : 0, "anyCrossDown")
plot(fisher_cross_up ? 1 : 0, "zoneCrossUp")
plot(fisher_cross_down ? 1 : 0, "zoneCrossDown")
`;

  const p = new PineTS(candles);
  await p.ready();
  const ctx = await p.run(pineScript);

  const pinetsFisher = ctx.plots.fisherScaled.data.map((d: any) => d.value);
  const pinetsSignal = ctx.plots.signalScaled.data.map((d: any) => d.value);
  const pinetsAnyUp = ctx.plots.anyCrossUp.data.map((d: any) => d.value === 1);
  const pinetsAnyDown = ctx.plots.anyCrossDown.data.map((d: any) => d.value === 1);
  const pinetsZoneUp = ctx.plots.zoneCrossUp.data.map((d: any) => d.value === 1);
  const pinetsZoneDown = ctx.plots.zoneCrossDown.data.map((d: any) => d.value === 1);

  // 2. Run independent port
  const indep = runFisherIndependent(candles);

  // 3. Verify cross parity between pinets and independent port
  let maxDiff = 0;
  for (let i = 0; i < candles.length; i++) {
    if (Number.isFinite(pinetsFisher[i]) && Number.isFinite(indep.fisherScaled[i])) {
      const d = Math.abs(pinetsFisher[i] - indep.fisherScaled[i]);
      if (d > maxDiff) maxDiff = d;
    }
    if (pinetsAnyUp[i] !== indep.anyCrossUp[i]) {
      throw new Error(`anyCrossUp mismatch at candle ${i}`);
    }
    if (pinetsAnyDown[i] !== indep.anyCrossDown[i]) {
      throw new Error(`anyCrossDown mismatch at candle ${i}`);
    }
    if (pinetsZoneUp[i] !== indep.zoneCrossUp[i]) {
      throw new Error(`zoneCrossUp mismatch at candle ${i}`);
    }
    if (pinetsZoneDown[i] !== indep.zoneCrossDown[i]) {
      throw new Error(`zoneCrossDown mismatch at candle ${i}`);
    }
  }

  console.log(`Pinets vs independent-port verified! Max diff: ${maxDiff}`);

  const expected = [];
  for (let i = 0; i < candles.length; i++) {
    expected.push({
      time: candles[i].openTime,
      fisherScaled: Number.isFinite(pinetsFisher[i]) ? pinetsFisher[i] : null,
      signalScaled: Number.isFinite(pinetsSignal[i]) ? pinetsSignal[i] : null,
      anyCrossUp: pinetsAnyUp[i],
      anyCrossDown: pinetsAnyDown[i],
      zoneCrossUp: pinetsZoneUp[i],
      zoneCrossDown: pinetsZoneDown[i],
    });
  }

  const fixture = {
    source: 'pinets',
    crossVerifiedWith: 'independent-port',
    candlesRange: {
      count: candles.length,
      symbol: 'BTCUSDT',
      timeframe: '1h',
      startTime: candles[0].openTime,
      endTime: candles[candles.length - 1].openTime,
      startDate: new Date(candles[0].openTime).toISOString(),
      endDate: new Date(candles[candles.length - 1].openTime).toISOString(),
    },
    parameters: {
      rsiLength: 14,
      rsiSmoothing: 1,
      fisherLength: 10,
      oversold: 30,
      overbought: 70,
    },
    candles: simpleCandles,
    expected,
  };

  const fixturePath = path.resolve('tests/fixtures/fisher_pine_run.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf-8');
  console.log(`Saved fixture to ${fixturePath}`);
}

generateFisherPineFixture().catch((err) => {
  console.error(err);
  process.exit(1);
});
