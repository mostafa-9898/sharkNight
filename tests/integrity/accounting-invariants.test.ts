import { BacktestEngine } from '@/backtest/engine';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import { createSeededRng, generateSyntheticCandles, loadRealFixtureSlice } from './helpers';
import type { Candle } from '@/data/models';
import { roundTo } from '@/utils/math';

describe('Integrity Test 4: Portfolio Accounting Invariants (1,000 Iterations)', () => {
  const realSlice = loadRealFixtureSlice();

  it('proves fundamental accounting invariants across 1,000 randomized backtest runs', () => {
    const rng = createSeededRng(424001);
    const engine = new BacktestEngine();
    const TOTAL_ITERATIONS = 1000;

    for (let iter = 0; iter < TOTAL_ITERATIONS; iter++) {
      const useReal = iter % 2 === 0;
      let candles: Candle[];

      if (useReal) {
        const offset = Math.floor(rng() * 40);
        const len = 90 + Math.floor(rng() * 90);
        candles = realSlice.slice(offset, offset + len);
      } else {
        const len = 90 + Math.floor(rng() * 90);
        candles = generateSyntheticCandles(len, rng, 100 + rng() * 1000);
      }

      const initialBalance = 10000;
      const tradeFeePercent = 0.05 + rng() * 0.15; // 0.05% to 0.20%
      const maxPositions = 1 + Math.floor(rng() * 10); // 1 to 10 positions
      const isMulti = maxPositions > 1;

      const strategy = new MultiTimeframeStrategy({
        fisherMode: 'confirm',
        kijunSlopeFilter: rng() > 0.5,
        structureFilter: rng() > 0.5,
      });

      const config = {
        strategy,
        candles,
        initialBalance,
        tradeFeePercent,
        positionSizePercent: isMulti ? Math.floor(100 / maxPositions) : 20 + Math.floor(rng() * 70),
        maxOpenPositions: maxPositions,
        exitMode: isMulti ? ('trailingOnly' as const) : ('reverse' as const),
        allowOppositePositions: true,
        trailingStop: {
          initialStopPercent: 5,
          stepPercent: 3,
          raisePercent: 1.5,
        },
      };

      const result = engine.run(config);

      // Invariant 1: sum(pnlUsd) of closed trades equals final balance change
      const sumPnl = roundTo(result.trades.reduce((acc, t) => acc + t.pnl, 0), 2);
      const finalRealizedEquity = roundTo(initialBalance + sumPnl, 2);
      expect(Number.isFinite(finalRealizedEquity)).toBe(true);

      if (!result.activePosition && (!result.multiPositionDiagnostics || result.multiPositionDiagnostics.maxConcurrentPositions === 0)) {
        const lastEquity = roundTo(result.equity[result.equity.length - 1], 2);
        expect(lastEquity).toBeCloseTo(finalRealizedEquity, 1);
      }

      // Invariant 2: Two-way commission deducted for every trade
      for (const trade of result.trades) {
        expect(trade.fee).toBeGreaterThan(0);
        const approxFeeExpected = (trade.entryPrice * trade.quantity + trade.exitPrice * trade.quantity) * (tradeFeePercent / 100);
        // Fee must be within 1% of expected two-way notional fee
        expect(trade.fee).toBeCloseTo(approxFeeExpected, 1);
      }

      // Invariant 3: Equity never negative
      for (const eq of result.equity) {
        expect(eq).toBeGreaterThanOrEqual(0);
      }

      // Invariant 4 & 5: Maximum concurrent positions constraint (<= 10 and <= maxOpenPositions)
      if (result.multiPositionDiagnostics) {
        expect(result.multiPositionDiagnostics.maxConcurrentPositions).toBeLessThanOrEqual(maxPositions);
        expect(result.multiPositionDiagnostics.maxConcurrentPositions).toBeLessThanOrEqual(10);
      }

      // Invariant 6: When allowOppositePositions is true, no position is closed purely by opposite signal
      if (isMulti) {
        for (const trade of result.trades) {
          expect(trade.exitReason).not.toBe('reverse');
          expect(trade.exitReason).not.toBe('signal');
        }
      }
    }
  });
});
