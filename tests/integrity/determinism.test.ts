import * as crypto from 'crypto';
import { BacktestEngine } from '@/backtest/engine';
import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import { createSeededRng, generateSyntheticCandles, loadRealFixtureSlice } from './helpers';
import type { Candle } from '@/data/models';

function hashObject(obj: unknown): string {
  const json = JSON.stringify(obj);
  return crypto.createHash('sha256').update(json).digest('hex');
}

describe('Integrity Test 2: Engine & Strategy Determinism (1,000 Iterations)', () => {
  const realSlice = loadRealFixtureSlice();

  it('guarantees 100% deterministic outputs for identical inputs across 1,000 randomized backtest runs', () => {
    const rng = createSeededRng(422001);
    const engine = new BacktestEngine();
    const TOTAL_ITERATIONS = 1000;

    for (let iter = 0; iter < TOTAL_ITERATIONS; iter++) {
      // Create random scenario
      const useReal = iter % 2 === 0;
      let candles: Candle[];

      if (useReal) {
        const offset = Math.floor(rng() * 40);
        const len = 80 + Math.floor(rng() * 100);
        candles = realSlice.slice(offset, offset + len);
      } else {
        const len = 80 + Math.floor(rng() * 100);
        candles = generateSyntheticCandles(len, rng, 100 + rng() * 500);
      }

      const fisherMode = rng() > 0.5 ? 'confirm' : 'replace-stoch';
      const kijunSlopeFilter = rng() > 0.5;
      const structureFilter = rng() > 0.5;

      const stratConfig = {
        fisherMode,
        kijunSlopeFilter,
        structureFilter,
      };

      const btcConfig1 = {
        strategy: new MultiTimeframeStrategy(stratConfig),
        candles,
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: 20,
      };

      const btcConfig2 = {
        strategy: new MultiTimeframeStrategy(stratConfig),
        candles,
        initialBalance: 10000,
        tradeFeePercent: 0.1,
        positionSizePercent: 20,
      };

      const res1 = engine.run(btcConfig1);
      const res2 = engine.run(btcConfig2);

      // Verify trades equality
      expect(res1.trades.length).toBe(res2.trades.length);
      expect(res1.metrics.totalPnl).toBe(res2.metrics.totalPnl);
      expect(res1.metrics.tradeCount).toBe(res2.metrics.tradeCount);
      expect(res1.metrics.maxDrawdownPercent).toBe(res2.metrics.maxDrawdownPercent);

      // Verify full SHA256 parity of serialized trade records
      const hash1 = hashObject(res1.trades);
      const hash2 = hashObject(res2.trades);
      expect(hash1).toBe(hash2);

      // Verify equity curve parity
      const eqHash1 = hashObject(res1.equity);
      const eqHash2 = hashObject(res2.equity);
      expect(eqHash1).toBe(eqHash2);
    }
  });
});
