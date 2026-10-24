import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { createSeededRng } from './helpers';

interface TradeRecord {
  side: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
  exitReason: string;
  mfe: number;
  mae: number;
  bars: number;
  symbol: string;
  timeframe: string;
}

/**
 * Pure standalone mathematical trade return calculator WITHOUT any engine code imports.
 * Accurately models two-way exchange fee deduction (0.1% default spot/perp taker rate).
 */
export function independentRecalculateTrade(
  side: string,
  entryPrice: number,
  exitPrice: number,
  feeRate = 0.001
): { pnlPct: number } {
  if (side.toLowerCase() === 'long') {
    // Long trade:
    // netMultiplier = (1 - feeRate) * (exitPrice / entryPrice) * (1 - feeRate)
    const grossRatio = exitPrice / entryPrice;
    const netMultiplier = (1 - feeRate) * grossRatio * (1 - feeRate);
    const pnlPct = (netMultiplier - 1) * 100;
    return { pnlPct };
  } else {
    // Short trade:
    // (1 - feeRate) * [ 1 - (exitPrice / entryPrice) * (1 + feeRate) ] - feeRate
    const priceRatio = exitPrice / entryPrice;
    const netShortFraction = (1 - feeRate) * (1 - priceRatio * (1 + feeRate)) - feeRate;
    const pnlPct = netShortFraction * 100;
    return { pnlPct };
  }
}

describe('Integrity Test 5: Independent Trade Recalculation (50 Random Trades)', () => {
  it('samples 50 random trades from validation artifacts and verifies 100% parity with standalone pure math', () => {
    const valDir = path.resolve(process.cwd(), 'docs', 'review', 'validation');
    const files = fs
      .readdirSync(valDir)
      .filter((f) => f.startsWith('trades_') && f.endsWith('.csv.gz'));

    expect(files.length).toBeGreaterThan(0);

    const allTrades: TradeRecord[] = [];

    for (const file of files) {
      const parts = file.replace('.csv.gz', '').split('_');
      // e.g. trades_BTC_15m_S1 -> sym=BTC, tf=15m
      const symbol = parts[1] || 'UNKNOWN';
      const timeframe = parts[2] || '15m';

      const buf = fs.readFileSync(path.join(valDir, file));
      const text = zlib.gunzipSync(buf).toString('utf-8');
      const lines = text.trim().split('\n');
      if (lines.length < 2) continue;

      const header = lines[0].split(',').map((h) => h.trim());
      const sideIdx = header.indexOf('side');
      const entryTimeIdx = header.indexOf('entryTime');
      const exitTimeIdx = header.indexOf('exitTime');
      const entryPriceIdx = header.indexOf('entryPrice');
      const exitPriceIdx = header.indexOf('exitPrice');
      const pnlPctIdx = header.indexOf('pnlPct') !== -1 ? header.indexOf('pnlPct') : header.indexOf('pnlPercent');
      const pnlUsdIdx = header.indexOf('pnlUsd');
      const exitReasonIdx = header.indexOf('exitReason');
      const mfeIdx = header.indexOf('mfe') !== -1 ? header.indexOf('mfe') : header.indexOf('mfePercent');
      const maeIdx = header.indexOf('mae') !== -1 ? header.indexOf('mae') : header.indexOf('maePercent');
      const barsIdx = header.indexOf('bars') !== -1 ? header.indexOf('bars') : header.indexOf('barsHeld');

      if (sideIdx === -1 || entryPriceIdx === -1 || exitPriceIdx === -1 || pnlPctIdx === -1) {
        continue;
      }

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        if (cols.length < header.length) continue;

        const entryPrice = Number(cols[entryPriceIdx]);
        const exitPrice = Number(cols[exitPriceIdx]);
        const pnlPct = Number(cols[pnlPctIdx]);

        if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(pnlPct)) {
          continue;
        }

        allTrades.push({
          side: cols[sideIdx],
          entryTime: Number(cols[entryTimeIdx]),
          exitTime: Number(cols[exitTimeIdx]),
          entryPrice,
          exitPrice,
          pnlPct,
          pnlUsd: pnlUsdIdx !== -1 ? Number(cols[pnlUsdIdx]) : 0,
          exitReason: cols[exitReasonIdx],
          mfe: Number(cols[mfeIdx]),
          mae: Number(cols[maeIdx]),
          bars: Number(cols[barsIdx]),
          symbol,
          timeframe,
        });
      }
    }

    expect(allTrades.length).toBeGreaterThanOrEqual(50);

    // Seeded random sample of 50 trades
    const rng = createSeededRng(425001);
    const sampledIndices = new Set<number>();
    while (sampledIndices.size < 50) {
      const idx = Math.floor(rng() * allTrades.length);
      sampledIndices.add(idx);
    }

    let checkedCount = 0;
    for (const idx of sampledIndices) {
      const trade = allTrades[idx];
      const recalculated = independentRecalculateTrade(
        trade.side,
        trade.entryPrice,
        trade.exitPrice,
        0.001 // 0.1% fee
      );

      // Verify that engine trade.pnlPct matches standalone math within rounding tolerance (0.01%)
      expect(Math.abs(recalculated.pnlPct - trade.pnlPct)).toBeLessThanOrEqual(0.01);

      // Verify bar duration causality
      expect(trade.exitTime).toBeGreaterThanOrEqual(trade.entryTime);
      expect(trade.bars).toBeGreaterThanOrEqual(1);

      checkedCount++;
    }

    expect(checkedCount).toBe(50);
  });
});
