import { BacktestEngine } from '@/backtest/engine';
import { SMACrossoverStrategy } from '@/strategies/sma-crossover';
import type { Strategy } from '@/strategies/types';
import type { Candle, TradeSignal } from '@/data/models';

describe('BacktestEngine', () => {
  const createCandle = (close: number, timestamp = 1600000000000): Candle => ({
    timestamp,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  });

  const generateCandles = (prices: number[]): Candle[] =>
    prices.map((p, idx) => createCandle(p, 1000000 + idx * 60000));

  class MockActionStrategy implements Strategy {
    readonly name = 'MockActionStrategy';
    readonly description = 'Mock action strategy for testing';
    readonly requiredCandles = 1;
    private actions: Record<number, 'BUY' | 'SELL' | 'HOLD'>;

    constructor(actions: Record<number, 'BUY' | 'SELL' | 'HOLD'>) {
      this.actions = actions;
    }

    analyze(candles: readonly Candle[], index: number): TradeSignal {
      const action = this.actions[index] ?? 'HOLD';
      return {
        action,
        timestamp: candles[index].timestamp,
        price: candles[index].close,
        reason: `Mock ${action} at ${index}`,
      };
    }
  }

  it('should throw an error if candles array is empty', () => {
    const engine = new BacktestEngine();
    const strategy = new SMACrossoverStrategy();

    expect(() =>
      engine.run({
        strategy,
        candles: [],
        initialBalance: 10000,
      })
    ).toThrow('Backtest requires at least one candle');
  });

  it('should throw an error if initialBalance is non-positive', () => {
    const engine = new BacktestEngine();
    const strategy = new SMACrossoverStrategy();
    const candles = generateCandles([100, 105]);

    expect(() =>
      engine.run({
        strategy,
        candles,
        initialBalance: 0,
      })
    ).toThrow('Initial balance must be positive');
  });

  it('should handle long win and loss with fees in long-only mode', () => {
    const engine = new BacktestEngine();
    // 0: BUY at 100, 1: SELL at 110 (win), 2: BUY at 100, 3: SELL at 90 (loss)
    const candles = generateCandles([100, 110, 100, 90]);
    const strategy = new MockActionStrategy({
      0: 'BUY',
      1: 'SELL',
      2: 'BUY',
      3: 'SELL',
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      tradeMode: 'long-only',
      tradeFeePercent: 0.1,
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].side).toBe('long');
    expect(result.trades[0].pnl).toBeGreaterThan(0);
    expect(result.trades[0].fee).toBeGreaterThan(0);
    expect(result.trades[0].exitReason).toBe('signal');

    expect(result.trades[1].side).toBe('long');
    expect(result.trades[1].pnl).toBeLessThan(0);
    expect(result.trades[1].fee).toBeGreaterThan(0);
    expect(result.trades[1].exitReason).toBe('signal');

    expect(result.metrics.long.winningTrades).toBe(1);
    expect(result.metrics.long.losingTrades).toBe(1);
  });

  it('should handle short win and loss with fees', () => {
    const engine = new BacktestEngine();
    // 0: SELL at 100 (opens short), 1: BUY at 90 (closes short win, opens long), 2: SELL at 100 (closes long win, opens short), 3: BUY at 110 (closes short loss)
    const candles = generateCandles([100, 90, 100, 110]);
    const strategy = new MockActionStrategy({
      0: 'SELL',
      1: 'BUY',
      2: 'SELL',
      3: 'BUY',
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      tradeMode: 'long-short',
      tradeFeePercent: 0.1,
    });

    const shortTrades = result.trades.filter((t) => t.side === 'short');
    expect(shortTrades.length).toBeGreaterThanOrEqual(2);

    // First short: entered 100, exited 90 -> profit
    expect(shortTrades[0].entryPrice).toBe(100);
    expect(shortTrades[0].exitPrice).toBe(90);
    expect(shortTrades[0].pnl).toBeGreaterThan(0);
    expect(shortTrades[0].fee).toBeGreaterThan(0);

    // Second short: entered 100, exited 110 -> loss
    expect(shortTrades[1].entryPrice).toBe(100);
    expect(shortTrades[1].exitPrice).toBe(110);
    expect(shortTrades[1].pnl).toBeLessThan(0);
    expect(shortTrades[1].fee).toBeGreaterThan(0);
  });

  it('should correctly execute reversal on opposite signal in long-short mode with separate fees', () => {
    const engine = new BacktestEngine();
    // Candle 0: BUY at 100 (opens long)
    // Candle 1: SELL at 110 (closes long with reverse, opens short at 110)
    // Candle 2: BUY at 100 (closes short with reverse, opens long at 100)
    // Candle 3: hold at 100 (end of data closes long)
    const candles = generateCandles([100, 110, 100, 100]);
    const strategy = new MockActionStrategy({
      0: 'BUY',
      1: 'SELL',
      2: 'BUY',
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      tradeMode: 'long-short',
      tradeFeePercent: 0.1,
    });

    expect(result.trades).toHaveLength(3);
    // Trade 0: long closed by reversal
    expect(result.trades[0].side).toBe('long');
    expect(result.trades[0].exitReason).toBe('reverse');
    expect(result.trades[0].exitPrice).toBe(110);

    // Trade 1: short closed by reversal
    expect(result.trades[1].side).toBe('short');
    expect(result.trades[1].exitReason).toBe('reverse');
    expect(result.trades[1].entryPrice).toBe(110);
    expect(result.trades[1].exitPrice).toBe(100);

    // Trade 2: long closed at end of backtest
    expect(result.trades[2].side).toBe('long');
    expect(result.trades[2].exitReason).toBe('end');
  });

  it('should ignore duplicate signals for the same side', () => {
    const engine = new BacktestEngine();
    // Consecutive BUY signals; then consecutive SELL signals
    const candles = generateCandles([100, 102, 104, 98, 96]);
    const strategy = new MockActionStrategy({
      0: 'BUY',
      1: 'BUY', // ignored
      2: 'BUY', // ignored
      3: 'SELL', // reversal
      4: 'SELL', // ignored
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      tradeMode: 'long-short',
    });

    // Expect 2 trades: 1 long (reversed at candle 3), 1 short (closed at end of data)
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].side).toBe('long');
    expect(result.trades[0].entryPrice).toBe(100);
    expect(result.trades[0].exitPrice).toBe(98);
    expect(result.trades[1].side).toBe('short');
    expect(result.trades[1].entryPrice).toBe(98);
  });

  it('should respect long-only behavior: ignore SELL when flat and never open short', () => {
    const engine = new BacktestEngine();
    // 0: SELL when flat (should be ignored)
    // 1: BUY (opens long)
    // 2: BUY (ignored)
    // 3: SELL (closes long)
    // 4: SELL when flat (ignored)
    const candles = generateCandles([100, 105, 110, 115, 120]);
    const strategy = new MockActionStrategy({
      0: 'SELL',
      1: 'BUY',
      2: 'BUY',
      3: 'SELL',
      4: 'SELL',
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      tradeMode: 'long-only',
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].side).toBe('long');
    expect(result.trades[0].entryPrice).toBe(105);
    expect(result.trades[0].exitPrice).toBe(115);
    expect(result.metrics.short.totalTrades).toBe(0);
  });

  it('should trigger take profit and stop loss for both long and short positions', () => {
    const engine = new BacktestEngine();

    // Long TP test: enter 100, TP at 5% (>= 105)
    const longTpCandles = generateCandles([100, 102, 106, 107]);
    const longTpStrategy = new MockActionStrategy({ 0: 'BUY' });
    const longTpResult = engine.run({
      strategy: longTpStrategy,
      candles: longTpCandles,
      initialBalance: 1000,
      takeProfitPercent: 5,
    });
    expect(longTpResult.trades).toHaveLength(1);
    expect(longTpResult.trades[0].side).toBe('long');
    expect(longTpResult.trades[0].exitReason).toBe('takeProfit');
    expect(longTpResult.trades[0].exitPrice).toBe(106);

    // Long SL test: enter 100, SL at 3% (<= 97)
    const longSlCandles = generateCandles([100, 99, 96, 95]);
    const longSlResult = engine.run({
      strategy: longTpStrategy,
      candles: longSlCandles,
      initialBalance: 1000,
      stopLossPercent: 3,
    });
    expect(longSlResult.trades).toHaveLength(1);
    expect(longSlResult.trades[0].side).toBe('long');
    expect(longSlResult.trades[0].exitReason).toBe('stopLoss');
    expect(longSlResult.trades[0].exitPrice).toBe(96);

    // Short TP test: enter 100, TP at 5% (<= 95)
    const shortTpCandles = generateCandles([100, 98, 94, 93]);
    const shortStrategy = new MockActionStrategy({ 0: 'SELL' });
    const shortTpResult = engine.run({
      strategy: shortStrategy,
      candles: shortTpCandles,
      initialBalance: 1000,
      takeProfitPercent: 5,
    });
    expect(shortTpResult.trades).toHaveLength(1);
    expect(shortTpResult.trades[0].side).toBe('short');
    expect(shortTpResult.trades[0].exitReason).toBe('takeProfit');
    expect(shortTpResult.trades[0].exitPrice).toBe(94);

    // Short SL test: enter 100, SL at 3% (>= 103)
    const shortSlCandles = generateCandles([100, 101, 104, 105]);
    const shortSlResult = engine.run({
      strategy: shortStrategy,
      candles: shortSlCandles,
      initialBalance: 1000,
      stopLossPercent: 3,
    });
    expect(shortSlResult.trades).toHaveLength(1);
    expect(shortSlResult.trades[0].side).toBe('short');
    expect(shortSlResult.trades[0].exitReason).toBe('stopLoss');
    expect(shortSlResult.trades[0].exitPrice).toBe(104);
  });

  it('should process opposite signal and open opposite position after a stop-out on the same candle (A4)', () => {
    const engine = new BacktestEngine();
    // Candle 0: BUY at 100 (opens long)
    // Candle 1: price drops to 95 (hits 3% SL), and strategy emits SELL (opposite signal)
    // SL closes the long, then SELL opens a short on this candle
    const candles = generateCandles([100, 95, 94]);
    const strategy = new MockActionStrategy({
      0: 'BUY',
      1: 'SELL',
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      stopLossPercent: 3,
      tradeMode: 'long-short',
    });

    // 2 trades: 1 long closed by stopLoss, 1 short opened at candle 1 and closed at end of data
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].side).toBe('long');
    expect(result.trades[0].exitReason).toBe('stopLoss');
    expect(result.trades[0].exitPrice).toBe(95);

    expect(result.trades[1].side).toBe('short');
    expect(result.trades[1].entryPrice).toBe(95);
    expect(result.trades[1].exitPrice).toBe(94);
    expect(result.trades[1].exitReason).toBe('end');
  });

  it('should stay flat after stop-out if no strategy signal is emitted on the same candle (A4)', () => {
    const engine = new BacktestEngine();
    // Candle 0: BUY at 100 (opens long)
    // Candle 1: price drops to 95 (hits 3% SL), no strategy signal (HOLD)
    // Candle 2: price 94 (flat)
    const candles = generateCandles([100, 95, 94]);
    const strategy = new MockActionStrategy({
      0: 'BUY',
    });

    const result = engine.run({
      strategy,
      candles,
      initialBalance: 1000,
      stopLossPercent: 3,
      tradeMode: 'long-short',
    });

    // Exactly 1 trade: the long closed by stopLoss, stays flat thereafter
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].side).toBe('long');
    expect(result.trades[0].exitReason).toBe('stopLoss');
    expect(result.trades[0].exitPrice).toBe(95);
    expect(result.metrics.short.totalTrades).toBe(0);
  });

  it('should maintain continuous equity curve and satisfy PnL identity: sum(pnl) + initialBalance = finalEquity', () => {
    const engine = new BacktestEngine();
    // Complex series with long win, short loss, long loss, and open short at end
    const candles = generateCandles([100, 110, 120, 115, 125, 120]);
    const strategy = new MockActionStrategy({
      0: 'BUY',
      1: 'SELL', // reverse to short at 110
      3: 'BUY',  // reverse to long at 115
      4: 'SELL', // reverse to short at 125
    });

    const initialBalance = 10000;
    const result = engine.run({
      strategy,
      candles,
      initialBalance,
      tradeMode: 'long-short',
      tradeFeePercent: 0.1,
    });

    expect(result.equity).toHaveLength(candles.length);
    // Equity points should all be finite numbers
    expect(result.equity.every((e) => Number.isFinite(e) && e > 0)).toBe(true);

    // Sum of trade PnL + initialBalance must equal final equity (within float tolerance)
    const sumPnl = result.trades.reduce((sum, t) => sum + t.pnl, 0);
    const finalEquity = result.equity[result.equity.length - 1];
    expect(Math.abs(initialBalance + sumPnl - finalEquity)).toBeLessThan(1e-6);

    // Last trade should be closed at end of backtest
    const lastTrade = result.trades[result.trades.length - 1];
    expect(lastTrade.exitReason).toBe('end');
    expect(lastTrade.exitPrice).toBe(120);
  });

  describe('Trailing Stop and Intrabar / Close Stop Execution (Part C)', () => {
    const createExactCandle = (
      open: number,
      high: number,
      low: number,
      close: number,
      idx: number
    ): Candle => ({
      timestamp: 1000000 + idx * 60000,
      open,
      high,
      low,
      close,
      volume: 1000,
    });

    it('should validate trailingStop configuration and reject conflicting stopLossPercent', () => {
      const engine = new BacktestEngine();
      const strategy = new MockActionStrategy({ 0: 'BUY' });
      const candles = generateCandles([100, 105]);

      expect(() =>
        engine.run({
          strategy,
          candles,
          initialBalance: 1000,
          stopLossPercent: 5,
          trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
        })
      ).toThrow('Cannot set both stopLossPercent and trailingStop');

      expect(() =>
        engine.run({
          strategy,
          candles,
          initialBalance: 1000,
          trailingStop: { initialStopPercent: 0, stepPercent: 10, raisePercent: 5 },
        })
      ).toThrow('trailingStop.initialStopPercent must be positive');

      expect(() =>
        engine.run({
          strategy,
          candles,
          initialBalance: 1000,
          trailingStop: { initialStopPercent: 5, stepPercent: -1, raisePercent: 5 },
        })
      ).toThrow('trailingStop.stepPercent must be positive');

      expect(() =>
        engine.run({
          strategy,
          candles,
          initialBalance: 1000,
          slippagePercent: -0.5,
        })
      ).toThrow('slippagePercent cannot be negative');
    });

    it('should execute long trailing stop ratchet sequence exactly as specified', () => {
      const engine = new BacktestEngine();
      // Entry at 100 on candle 0. Initial stop = 95.
      // Candle 1: High 110 (+10%) -> stop ratchets to 100 (0%, break-even)
      // Candle 2: High 120 (+20%) -> stop ratchets to 105 (+5%)
      // Candle 3: High 130 (+30%) -> stop ratchets to 110 (+10%)
      // Candle 4: Low dips to 109 (<= 110) -> exits at 110 with 'trailingStop'
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 110, 99, 108, 1),
        createExactCandle(108, 120, 107, 118, 2),
        createExactCandle(118, 130, 117, 128, 3),
        createExactCandle(128, 128, 109, 112, 4),
      ];

      const strategy = new MockActionStrategy({ 0: 'BUY' });
      const result = engine.run({
        strategy,
        candles,
        initialBalance: 1000,
        trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
      });

      expect(result.trades).toHaveLength(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('long');
      expect(trade.entryPrice).toBe(100);
      expect(trade.exitPrice).toBe(110);
      expect(trade.exitReason).toBe('trailingStop');
      expect(trade.ratchetSteps).toBe(3);
      expect(trade.stopPrice).toBe(110);
      expect(trade.maxFavorablePercent).toBe(30);
      expect(trade.maxAdversePercent).toBe(1);
      expect(trade.pnl).toBeGreaterThan(0);
    });

    it('should execute short trailing stop ratchet sequence symmetrically', () => {
      const engine = new BacktestEngine();
      // Entry short at 100 on candle 0. Initial stop = 105.
      // Candle 1: Low 90 (+10% favorable drop) -> stop ratchets to 100 (0%, break-even)
      // Candle 2: Low 80 (+20% favorable drop) -> stop ratchets to 95 (+5% locked in)
      // Candle 3: Low 70 (+30% favorable drop) -> stop ratchets to 90 (+10% locked in)
      // Candle 4: High rises to 91 (>= 90) -> exits at 90 with 'trailingStop'
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 101, 90, 92, 1),
        createExactCandle(92, 93, 80, 82, 2),
        createExactCandle(82, 83, 70, 72, 3),
        createExactCandle(72, 91, 71, 88, 4),
      ];

      const strategy = new MockActionStrategy({ 0: 'SELL' });
      const result = engine.run({
        strategy,
        candles,
        initialBalance: 1000,
        trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
      });

      expect(result.trades).toHaveLength(1);
      const trade = result.trades[0];
      expect(trade.side).toBe('short');
      expect(trade.entryPrice).toBe(100);
      expect(trade.exitPrice).toBe(90);
      expect(trade.exitReason).toBe('trailingStop');
      expect(trade.ratchetSteps).toBe(3);
      expect(trade.stopPrice).toBe(90);
      expect(trade.maxFavorablePercent).toBe(30);
      expect(trade.maxAdversePercent).toBe(1);
      expect(trade.pnl).toBeGreaterThan(0);
    });

    it('should never move stop backward when price retraces', () => {
      const engine = new BacktestEngine();
      // Candle 0: Enter long at 100, stop 95
      // Candle 1: High 120 (+20%) -> stop ratchets to 105
      // Candle 2: Retraces (high 112, low 106). Stop MUST stay at 105
      // Candle 3: Dips to 104 -> exits at 105
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 120, 99, 115, 1),
        createExactCandle(115, 116, 106, 108, 2),
        createExactCandle(108, 108, 104, 105, 3),
      ];

      const strategy = new MockActionStrategy({ 0: 'BUY' });
      const result = engine.run({
        strategy,
        candles,
        initialBalance: 1000,
        trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
      });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exitPrice).toBe(105);
      expect(result.trades[0].exitReason).toBe('trailingStop');
    });

    it('should fill at the open price if candle gaps past the stop level', () => {
      const engine = new BacktestEngine();
      // Long position: entry 100, initial stop 95. Next candle gaps down to open at 92.
      const longCandles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(92, 93, 90, 91, 1),
      ];
      const longResult = engine.run({
        strategy: new MockActionStrategy({ 0: 'BUY' }),
        candles: longCandles,
        initialBalance: 1000,
        stopLossPercent: 5,
      });
      expect(longResult.trades).toHaveLength(1);
      expect(longResult.trades[0].exitPrice).toBe(92); // filled at open on gap!
      expect(longResult.trades[0].exitReason).toBe('stopLoss');

      // Short position: entry 100, initial stop 105. Next candle gaps up to open at 108.
      const shortCandles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(108, 110, 107, 109, 1),
      ];
      const shortResult = engine.run({
        strategy: new MockActionStrategy({ 0: 'SELL' }),
        candles: shortCandles,
        initialBalance: 1000,
        stopLossPercent: 5,
      });
      expect(shortResult.trades).toHaveLength(1);
      expect(shortResult.trades[0].exitPrice).toBe(108); // filled at open on gap!
      expect(shortResult.trades[0].exitReason).toBe('stopLoss');
    });

    it('should trigger intrabar stop when wick touches stop level even if close recovered', () => {
      const engine = new BacktestEngine();
      // Long entry at 100, stop 95. Next candle: open 100, wick dips to 94 (<= 95), but close recovers to 101.
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 102, 94, 101, 1),
      ];

      const result = engine.run({
        strategy: new MockActionStrategy({ 0: 'BUY' }),
        candles,
        initialBalance: 1000,
        stopLossPercent: 5,
        stopCheckMode: 'intrabar',
      });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exitPrice).toBe(95);
      expect(result.trades[0].exitReason).toBe('stopLoss');
    });

    it('should not look ahead: candle high on current candle cannot save position from same-candle stop trigger', () => {
      const engine = new BacktestEngine();
      // Candle 0: enter long at 100, initial stop 95.
      // Candle 1: open 98, low 94 (hits initial stop 95), high 125 (+25%).
      // Because check uses stop level from previous candle close, position MUST stop out at 95.
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(98, 125, 94, 120, 1),
      ];

      const result = engine.run({
        strategy: new MockActionStrategy({ 0: 'BUY' }),
        candles,
        initialBalance: 1000,
        trailingStop: { initialStopPercent: 5, stepPercent: 10, raisePercent: 5 },
      });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exitPrice).toBe(95);
      expect(result.trades[0].exitReason).toBe('stopLoss'); // 0 ratchet steps reached
      expect(result.trades[0].ratchetSteps).toBe(0);
    });

    it('should conservatively prioritize stop over TP if both are hit within the same candle', () => {
      const engine = new BacktestEngine();
      // Long entry at 100, stop 95 (-5%), TP 110 (+10%).
      // Next candle has low 94 and high 112 (both hit). Conservative rule: stop hit first.
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 112, 94, 102, 1),
      ];

      const result = engine.run({
        strategy: new MockActionStrategy({ 0: 'BUY' }),
        candles,
        initialBalance: 1000,
        stopLossPercent: 5,
        takeProfitPercent: 10,
      });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exitReason).toBe('stopLoss');
      expect(result.trades[0].exitPrice).toBe(95);
    });

    it('should apply slippage adversely on stop and TP exits', () => {
      const engine = new BacktestEngine();
      // Long stop at 100 with 1% slippage -> exit at 99
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 101, 95, 96, 1),
      ];

      const result = engine.run({
        strategy: new MockActionStrategy({ 0: 'BUY' }),
        candles,
        initialBalance: 1000,
        stopLossPercent: 5, // stop is 95
        slippagePercent: 1, // 1% adverse slippage on 95 = 95 * 0.99 = 94.05
      });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exitPrice).toBeCloseTo(94.05, 2);
    });

    it('should support stopCheckMode: close', () => {
      const engine = new BacktestEngine();
      // Candle 1 low dips to 94, but close is 96 (> stop 95) -> should NOT trigger in close mode
      // Candle 2 close is 93 (<= stop 95) -> triggers at close 93
      const candles: Candle[] = [
        createExactCandle(100, 100, 100, 100, 0),
        createExactCandle(100, 101, 94, 96, 1),
        createExactCandle(96, 97, 92, 93, 2),
      ];

      const result = engine.run({
        strategy: new MockActionStrategy({ 0: 'BUY' }),
        candles,
        initialBalance: 1000,
        stopLossPercent: 5,
        stopCheckMode: 'close',
      });

      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exitPrice).toBe(93);
      expect(result.trades[0].exitReason).toBe('stopLoss');
    });
  });
});
