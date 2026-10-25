import { MultiTimeframeStrategy } from '@/strategies/multi-timeframe-strategy';
import { BacktestEngine } from '@/backtest/engine';
import type { Candle, TradeSignal } from '@/data/models';
import type { Strategy } from '@/strategies/types';
import type { DailyRegimeCalculator } from '@/utils/market-regime';

describe('RG3 Health Tests: Regime Variants and G1 Gating Guarantees', () => {
  // Mock DailyRegimeCalculator with controllable daily trend
  function createMockRegimeCalc(trend: 1 | -1 | 0): DailyRegimeCalculator {
    return {
      getDailyTrendAt: (_ts: number) => trend,
      getRegimeAt: (_ts: number) => (trend === 1 ? 'bull' : 'bear'),
      getDailyDataAt: (_ts: number) => ({ close: 100, sma200: 90 }),
    };
  }

  // Create minimal synthetic candles
  function createCandles(count: number, startPrice: number = 100): Candle[] {
    const candles: Candle[] = [];
    const baseTime = 1600000000000;
    let price = startPrice;
    for (let i = 0; i < count; i++) {
      candles.push({
        timestamp: baseTime + i * 3600000,
        open: price,
        high: price * 1.01,
        low: price * 0.99,
        close: price,
        volume: 1000,
      });
      price *= 1.001;
    }
    return candles;
  }

  describe('G1 Entry Gating Requirements', () => {
    it('guarantees that in Neutral regime, G1 emits 0 BUY and 0 SELL signals (action is strictly HOLD)', () => {
      const candles = createCandles(100);
      const neutralCalc = createMockRegimeCalc(0); // Neutral daily trend

      const stratG1 = new MultiTimeframeStrategy({
        regimeVariant: 'G1',
        dailyRegimeCalculator: neutralCalc,
      });

      // Analyze every candle index
      for (let i = 50; i < candles.length; i++) {
        const sig = stratG1.analyze(candles, i);
        expect(sig.action).toBe('HOLD');
      }
    });

    it('guarantees that in Bear regime, G1 NEVER emits a BUY signal (0 long entries)', () => {
      const candles = createCandles(100);
      const bearCalc = createMockRegimeCalc(-1); // Bear daily trend

      const stratG1 = new MultiTimeframeStrategy({
        regimeVariant: 'G1',
        dailyRegimeCalculator: bearCalc,
      });

      // Spy on getStrictHtfDirection to force various HTF states
      jest.spyOn(stratG1, 'getStrictHtfDirection').mockReturnValue(-1);

      for (let i = 50; i < candles.length; i++) {
        const sig = stratG1.analyze(candles, i);
        expect(sig.action).not.toBe('BUY');
      }
    });

    it('guarantees that in Bull regime, G1 NEVER emits a SELL signal (0 short entries)', () => {
      const candles = createCandles(100);
      const bullCalc = createMockRegimeCalc(1); // Bull daily trend

      const stratG1 = new MultiTimeframeStrategy({
        regimeVariant: 'G1',
        dailyRegimeCalculator: bullCalc,
      });

      // Spy on getStrictHtfDirection to force bullish HTF
      jest.spyOn(stratG1, 'getStrictHtfDirection').mockReturnValue(1);

      for (let i = 50; i < candles.length; i++) {
        const sig = stratG1.analyze(candles, i);
        expect(sig.action).not.toBe('SELL');
      }
    });
  });

  describe('G3 Long-Only Reference Requirement', () => {
    it('guarantees that G3 NEVER emits a SELL signal under any market regime', () => {
      const candles = createCandles(100);

      for (const trend of [1, -1, 0] as const) {
        const calc = createMockRegimeCalc(trend);
        const stratG3 = new MultiTimeframeStrategy({
          regimeVariant: 'G3',
          dailyRegimeCalculator: calc,
        });

        jest.spyOn(stratG3, 'getStrictHtfDirection').mockReturnValue(-1); // bearish HTF

        for (let i = 50; i < candles.length; i++) {
          const sig = stratG3.analyze(candles, i);
          expect(sig.action).not.toBe('SELL');
        }
      }
    });
  });

  describe('G4 Forced Exit on Opposite Regime Flip', () => {
    it('force-closes open long position when regime flips to Bear with exitReason regimeFlip', () => {
      const engine = new BacktestEngine();
      const candles = createCandles(10);

      let currentRegime: 'Bull' | 'Bear' | 'Neutral' = 'Bull';
      const mockStrategy: Strategy = {
        name: 'MockStrategy',
        description: 'Mock',
        requiredCandles: 1,
        analyze: (cs: readonly Candle[], idx: number): TradeSignal => {
          if (idx === 1) {
            return { action: 'BUY', timestamp: cs[idx].timestamp, price: cs[idx].close };
          }
          return { action: 'HOLD', timestamp: cs[idx].timestamp, price: cs[idx].close };
        },
      };

      // Candle 1: BUY opens long
      // Candle 2: Bull -> still open
      // Candle 3: Regime flips to Bear -> should force-exit with reason regimeFlip
      const getMacroRegime = (_cs: readonly Candle[], idx: number): 'Bull' | 'Bear' | 'Neutral' => {
        if (idx >= 3) return 'Bear';
        return 'Bull';
      };

      const result = engine.run({
        strategy: mockStrategy,
        candles,
        initialBalance: 10000,
        maxOpenPositions: 10,
        allowOppositePositions: true,
        exitMode: 'trailingOnly',
        regimeExit: true,
        getMacroRegime,
      });

      expect(result.trades.length).toBe(1);
      expect(result.trades[0].side).toBe('long');
      expect(result.trades[0].exitReason).toBe('regimeFlip');
      expect(result.trades[0].exitTime).toBe(candles[3].timestamp);
    });

    it('does NOT force-close long position when regime flips to Neutral (only opposite regime Bear)', () => {
      const engine = new BacktestEngine();
      const candles = createCandles(10);

      const mockStrategy: Strategy = {
        name: 'MockStrategy',
        description: 'Mock',
        requiredCandles: 1,
        analyze: (cs: readonly Candle[], idx: number): TradeSignal => {
          if (idx === 1) {
            return { action: 'BUY', timestamp: cs[idx].timestamp, price: cs[idx].close };
          }
          return { action: 'HOLD', timestamp: cs[idx].timestamp, price: cs[idx].close };
        },
      };

      // Candle 3: Regime flips to Neutral -> should NOT force exit
      const getMacroRegime = (_cs: readonly Candle[], idx: number): 'Bull' | 'Bear' | 'Neutral' => {
        if (idx >= 3) return 'Neutral';
        return 'Bull';
      };

      const result = engine.run({
        strategy: mockStrategy,
        candles,
        initialBalance: 10000,
        maxOpenPositions: 10,
        allowOppositePositions: true,
        exitMode: 'trailingOnly',
        regimeExit: true,
        getMacroRegime,
      });

      // Trade was not closed at candle 3; closed only at end of dataset
      expect(result.trades.length).toBe(1);
      expect(result.trades[0].exitReason).toBe('end');
    });

    it('force-closes open short position when regime flips to Bull with exitReason regimeFlip', () => {
      const engine = new BacktestEngine();
      const candles = createCandles(10);

      const mockStrategy: Strategy = {
        name: 'MockStrategy',
        description: 'Mock',
        requiredCandles: 1,
        analyze: (cs: readonly Candle[], idx: number): TradeSignal => {
          if (idx === 1) {
            return { action: 'SELL', timestamp: cs[idx].timestamp, price: cs[idx].close };
          }
          return { action: 'HOLD', timestamp: cs[idx].timestamp, price: cs[idx].close };
        },
      };

      // Candle 3: Regime flips to Bull -> should force-exit short
      const getMacroRegime = (_cs: readonly Candle[], idx: number): 'Bull' | 'Bear' | 'Neutral' => {
        if (idx >= 3) return 'Bull';
        return 'Bear';
      };

      const result = engine.run({
        strategy: mockStrategy,
        candles,
        initialBalance: 10000,
        maxOpenPositions: 10,
        allowOppositePositions: true,
        exitMode: 'trailingOnly',
        regimeExit: true,
        getMacroRegime,
      });

      expect(result.trades.length).toBe(1);
      expect(result.trades[0].side).toBe('short');
      expect(result.trades[0].exitReason).toBe('regimeFlip');
      expect(result.trades[0].exitTime).toBe(candles[3].timestamp);
    });
  });
});
