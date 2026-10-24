import { BacktestEngine } from '@/backtest/engine';
import { VirtualPortfolio } from '@/backtest/portfolio';
import type { Strategy } from '@/strategies/types';
import type { Candle, TradeSignal } from '@/data/models';
import { roundTo } from '@/utils/math';

describe('Engine Short Accounting & Symmetry Verification (RC1 - H-A)', () => {
  class MockSignalStrategy implements Strategy {
    readonly name = 'MockSignalStrategy';
    readonly description = 'Deterministic mock strategy for testing accounting';
    readonly requiredCandles = 1;

    constructor(private readonly signals: Record<number, 'BUY' | 'SELL' | 'HOLD'>) {}

    analyze(candles: readonly Candle[], index: number): TradeSignal {
      const action = this.signals[index] ?? 'HOLD';
      return {
        action,
        timestamp: candles[index].timestamp,
        price: candles[index].close,
        reason: `Mock ${action} at ${index}`,
      };
    }
  }

  const makeCandle = (
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number
  ): Candle => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume: 1000,
  });

  // a) Simple Short vs Mirror Long
  describe('a) Simple Short: PnL and Mirror Long Log-Return Symmetry', () => {
    it('should calculate exact hand-derived PnL for simple short in single and multi position', () => {
      // Entry at index 0 (close: 100), exit at index 1 (close: 90)
      const candles: Candle[] = [
        makeCandle(1000, 100, 102, 98, 100),
        makeCandle(2000, 95, 96, 88, 90),
      ];

      const strategy = new MockSignalStrategy({ 0: 'SELL', 1: 'BUY' });
      const engine = new BacktestEngine();

      // Hand calculation:
      // Initial balance: 10,000, size: 10% => allocatedAmount = 1,000
      // Fee rate: 0.1% = 0.001
      // Entry fee: 1000 * 0.001 = 1.00 USD
      // Net invest: 999.00 USD
      // Quantity: 999 / 100 = 9.99 units
      // Exit price: 90 USD
      // Gross exit value: 9.99 * 90 = 899.10 USD
      // Exit fee: 899.10 * 0.001 = 0.8991 USD
      // Total fee: 1.00 + 0.8991 = 1.8991 USD
      // Gross PnL: 9.99 * (100 - 90) = 99.90 USD
      // Net PnL: 99.90 - 0.8991 - 1.00 = 98.0009 USD
      // Net PnL%: 98.0009 / 1000 * 100 = 9.80009%
      // Final cash: 10,000 + 98.0009 = 10,098.0009 USD

      const result = engine.run({
        candles,
        strategy,
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0.1,
        tradeMode: 'short-only',
        exitMode: 'reverse',
      });

      expect(result.trades).toHaveLength(1);
      const t = result.trades[0];
      expect(t.side).toBe('short');
      expect(t.entryPrice).toBe(100);
      expect(t.exitPrice).toBe(90);
      expect(t.quantity).toBeCloseTo(9.99, 6);
      expect(t.fee).toBeCloseTo(1.8991, 4);
      expect(t.pnl).toBeCloseTo(98.0009, 4);
      expect(t.pnlPercent).toBeCloseTo(9.8001, 3);
      expect(result.metrics.finalBalance).toBeCloseTo(10098, 2);
    });

    it('should satisfy mirror logarithmic return symmetry within 0.01% tolerance', () => {
      // P0 = 100. Mirror transform: p' = P0^2 / p
      // Original series: [100, 90, 80]
      // Mirror series:   [100, 100^2/90 = 111.111111, 100^2/80 = 125.0]
      const P0 = 100;
      const origPrices = [100, 90, 80];
      const mirrorPrices = origPrices.map((p) => (P0 * P0) / p);

      const origCandles: Candle[] = origPrices.map((p, i) =>
        makeCandle(1000 + i * 1000, p, p + 0.5, p - 0.5, p)
      );
      const mirrorCandles: Candle[] = mirrorPrices.map((p, i) =>
        makeCandle(1000 + i * 1000, p, p + 0.5, p - 0.5, p)
      );

      const engine = new BacktestEngine();

      // Zero-fee comparison for mathematical pure symmetry
      const resShort = engine.run({
        candles: origCandles,
        strategy: new MockSignalStrategy({ 0: 'SELL', 2: 'BUY' }),
        initialBalance: 10000,
        positionSizePercent: 100,
        tradeFeePercent: 0,
        tradeMode: 'short-only',
        exitMode: 'reverse',
      });

      const resMirrorLong = engine.run({
        candles: mirrorCandles,
        strategy: new MockSignalStrategy({ 0: 'BUY', 2: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 100,
        tradeFeePercent: 0,
        tradeMode: 'long-only',
        exitMode: 'reverse',
      });

      const tShort = resShort.trades[0];
      const tLong = resMirrorLong.trades[0];

      // Price log return:
      // Short: ln(entry / exit) = ln(100 / 80) = ln(1.25)
      // Long:  ln(exit / entry) = ln(125 / 100) = ln(1.25)
      const shortLogReturn = Math.log(tShort.entryPrice / tShort.exitPrice);
      const longLogReturn = Math.log(tLong.exitPrice / tLong.entryPrice);

      expect(Math.abs(shortLogReturn - longLogReturn)).toBeLessThan(0.0001); // < 0.01%
    });
  });

  // b) Short Stop: Execution price and Gap test
  describe('b) Short Stop: Execution price and gap test', () => {
    it('should exit at exact stop price (not low, not close, not high) when high >= stop', () => {
      // Entry at 100 with initialStopPercent = 5% => stopPrice = 105.00
      // Candle 1: high reaches 106, low is 99, open is 101, close is 102.
      const candles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 101, 106, 99, 102),
      ];

      const engine = new BacktestEngine();
      const res = engine.run({
        candles,
        strategy: new MockSignalStrategy({ 0: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0,
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      expect(res.trades).toHaveLength(1);
      const t = res.trades[0];
      expect(t.exitReason).toBe('stopLoss');
      expect(t.exitPrice).toBe(105); // exactly 105, not low 99 or close 102
    });

    it('should exit at open price when gap opens above stop price', () => {
      // Entry at 100, stop at 105.
      // Candle 1: gap up open at 107.50, high 109, low 106, close 108.
      const candles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 107.5, 109, 106, 108),
      ];

      const engine = new BacktestEngine();
      const res = engine.run({
        candles,
        strategy: new MockSignalStrategy({ 0: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0,
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      expect(res.trades).toHaveLength(1);
      const t = res.trades[0];
      expect(t.exitReason).toBe('stopLoss');
      expect(t.exitPrice).toBe(107.5); // gap open price
    });
  });

  // c) Intrabar Sequence: Stop vs Trailing Ratchet Conflict
  describe('c) Intrabar Sequence: Conservative behavior in conflicting candle', () => {
    it('should evaluate stop loss BEFORE trailing ratchet for both short and long (conservative)', () => {
      // If candle has extreme that hits stop AND extreme that would ratchet trailing:
      // Short: Entry at 100, stop at 105. Candle high is 105.5 (touches stop), low is 92 (would ratchet to step 2).
      const shortCandles: Candle[] = [
        makeCandle(1000, 100, 100.5, 99.5, 100),
        makeCandle(2000, 100, 105.5, 92, 93),
      ];

      // Mirror Long: Entry at 100, stop at 95. Candle low is 94.5 (touches stop), high is 108.7 (would ratchet).
      const longCandles: Candle[] = [
        makeCandle(1000, 100, 100.5, 99.5, 100),
        makeCandle(2000, 100, 108.7, 94.5, 107),
      ];

      const engine = new BacktestEngine();
      const resShort = engine.run({
        candles: shortCandles,
        strategy: new MockSignalStrategy({ 0: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0,
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      const resLong = engine.run({
        candles: longCandles,
        strategy: new MockSignalStrategy({ 0: 'BUY' }),
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0,
        tradeMode: 'long-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      // Both must be stopped out (conservative check first) rather than ratcheting
      expect(resShort.trades[0].exitReason).toBe('stopLoss');
      expect(resShort.trades[0].exitPrice).toBe(105);

      expect(resLong.trades[0].exitReason).toBe('stopLoss');
      expect(resLong.trades[0].exitPrice).toBe(95);
    });
  });

  // d) Stepped Trailing for Short: lowestLow, steps, raise
  describe('d) Stepped Trailing for Short: Mirror behavior of long', () => {
    it('should ratchet stepped stop down identically to how long ratchets stop up', () => {
      // Trailing config: initial 5%, step 3%, raise 1.5%
      // Short: Entry at 100 => initial stop 105.
      // Candle 1: lowestLow drops to 95 (MFE = 5% >= 5% initialStop) => breakEven stop candidate = 100.
      // Candle 2: lowestLow drops to 88 (MFE = 12% => n = floor(12/3) = 4 steps).
      // candidateStopPercent = -5 + 4 * 1.5 = +1.0%
      // candidateStop = 100 * (1 - 1.0/100) = 99.00 USD (locking +1% profit).
      const shortCandles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 99, 100, 95, 96),
        makeCandle(3000, 96, 97, 88, 89),
        makeCandle(4000, 89, 99.5, 88, 90), // Touches 99.00 => exits on trailing stop
      ];

      // Mirror Long:
      // Entry at 100 => initial stop 95.
      // Candle 1: highestHigh rises to 105 (MFE = 5% >= 5%) => BE stop candidate = 100.
      // Candle 2: highestHigh rises to 112 (MFE = 12% => n = 4 steps).
      // candidateStopPercent = -5 + 4 * 1.5 = +1.0% => candidateStop = 101.00 USD.
      // Candle 3: Touches 101.00 => exits on trailing stop.
      const longCandles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 101, 105, 100, 104),
        makeCandle(3000, 104, 112, 103, 111),
        makeCandle(4000, 111, 112, 100.5, 110),
      ];

      const engine = new BacktestEngine();
      const resShort = engine.run({
        candles: shortCandles,
        strategy: new MockSignalStrategy({ 0: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0,
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      const resLong = engine.run({
        candles: longCandles,
        strategy: new MockSignalStrategy({ 0: 'BUY' }),
        initialBalance: 10000,
        positionSizePercent: 10,
        tradeFeePercent: 0,
        tradeMode: 'long-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      expect(resShort.trades).toHaveLength(1);
      expect(resShort.trades[0].exitReason).toBe('trailingStop');
      expect(resShort.trades[0].exitPrice).toBe(99);
      expect(resShort.trades[0].pnlPercent).toBeCloseTo(1.0, 2);

      expect(resLong.trades).toHaveLength(1);
      expect(resLong.trades[0].exitReason).toBe('trailingStop');
      expect(resLong.trades[0].exitPrice).toBe(101);
      expect(resLong.trades[0].pnlPercent).toBeCloseTo(1.0, 2);
    });
  });

  // e) Fees both sides, slippage correct direction
  describe('e) Fees and Slippage: Correct directional application', () => {
    it('should deduct both entry and exit fees and apply adverse slippage correctly for short', () => {
      // Entry at 100, stop at 105.
      // With slippage = 1.0%, exit on stop triggers at base 105 * (1 + 0.01) = 106.05
      const candles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 101, 106, 99, 102),
      ];

      const engine = new BacktestEngine();
      const res = engine.run({
        candles,
        strategy: new MockSignalStrategy({ 0: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 10, // $1000
        tradeFeePercent: 0.2,    // 0.2% each side
        slippagePercent: 1.0,    // 1% adverse slippage on exit
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 5, stepPercent: 3, raisePercent: 1.5, mode: 'stepped' },
      });

      expect(res.trades).toHaveLength(1);
      const t = res.trades[0];
      // For short, adverse exit slippage means buying higher to cover:
      // 105 * (1 + 0.01) = 106.05
      expect(t.exitPrice).toBe(106.05);

      // Entry fee: 1000 * 0.002 = 2.00
      // Net invest: 998.00 => quantity = 9.98
      // Gross exit value at slipped exit 106.05: 9.98 * 106.05 = 1058.379
      // Exit fee: 1058.379 * 0.002 = 2.116758
      // Total fee = 2.00 + 2.116758 = 4.116758
      expect(t.fee).toBeCloseTo(4.116758, 4);
    });
  });

  // f) Size and Exposure: Margin, Mark-to-Market Equity, MaxDD
  describe('f) Size & Exposure: Cash/Margin, Mark-to-Market equity, and MaxDD', () => {
    it('should calculate mark-to-market equity and drawdown accurately during open short', () => {
      // Initial balance 10,000. Size 20% = 2,000 margin. Cash remaining = 8,000.
      // Entry at 100.
      // Candle 1: close 100. Equity = 8000 + 2000 - entryFee - exitFee = 10,000 - fees.
      // Candle 2: close rises to 110 (unfavorable).
      // Loss: qty * (100 - 110) = -200 USD. Equity = ~9,796 USD.
      // Candle 3: close falls to 80 (favorable).
      // Profit: qty * (100 - 80) = +400 USD. Equity = ~10,396 USD.
      const candles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 100, 110.5, 99, 110),
        makeCandle(3000, 110, 111, 79, 80),
      ];

      const engine = new BacktestEngine();
      const res = engine.run({
        candles,
        strategy: new MockSignalStrategy({ 0: 'SELL' }),
        initialBalance: 10000,
        positionSizePercent: 20,
        tradeFeePercent: 0.1,
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 20, stepPercent: 5, raisePercent: 2, mode: 'stepped' },
      });

      // Check equity curve length equals candle count
      expect(res.equity).toHaveLength(3);

      // At candle index 1 (price 110): equity drops due to adverse move
      expect(res.equity[1]).toBeLessThan(res.equity[0]);
      // At candle index 2 (price 80): equity rises due to favorable move
      expect(res.equity[2]).toBeGreaterThan(res.equity[0]);

      // Max drawdown must be strictly positive and reflect the intermediate dip at candle 1
      expect(res.metrics.maxDrawdownPercent).toBeGreaterThan(1.8);
      expect(res.metrics.maxDrawdownPercent).toBeLessThan(2.3);
    });
  });

  // g) allowOppositePositions: Concurrent Long & Short
  describe('g) allowOppositePositions: Concurrent Long and Short Independence', () => {
    it('should maintain independent positions, gross exposure, and independent PnL', () => {
      // Candle 0: Open Long at 100
      // Candle 1: Open Short at 102
      // Candle 2: Price moves to 105 (Long is in profit, Short is in loss)
      const candles: Candle[] = [
        makeCandle(1000, 100, 101, 99, 100),
        makeCandle(2000, 101, 103, 100, 102),
        makeCandle(3000, 103, 106, 102, 105),
      ];

      const strategy = new MockSignalStrategy({ 0: 'BUY', 1: 'SELL' });
      const engine = new BacktestEngine();

      const res = engine.run({
        candles,
        strategy,
        initialBalance: 10000,
        positionSizePercent: 10,
        maxOpenPositions: 5,
        maxTotalExposurePercent: 50,
        allowOppositePositions: true,
        tradeMode: 'long-short',
        exitMode: 'trailingOnly',
        trailingStop: { initialStopPercent: 10, stepPercent: 5, raisePercent: 2, mode: 'stepped' },
      });

      // At backtest end, both positions close at candle 2 close (105)
      expect(res.trades).toHaveLength(2);
      const longTrade = res.trades.find((t) => t.side === 'long')!;
      const shortTrade = res.trades.find((t) => t.side === 'short')!;

      expect(longTrade).toBeDefined();
      expect(shortTrade).toBeDefined();

      // Long entered at 100, exited at 105 => positive PnL
      expect(longTrade.entryPrice).toBe(100);
      expect(longTrade.exitPrice).toBe(105);
      expect(longTrade.pnl).toBeGreaterThan(0);

      // Short entered at 102, exited at 105 => negative PnL
      expect(shortTrade.entryPrice).toBe(102);
      expect(shortTrade.exitPrice).toBe(105);
      expect(shortTrade.pnl).toBeLessThan(0);

      // Concurrency check
      expect(res.multiPositionDiagnostics?.maxConcurrentPositions).toBe(2);
      expect(res.multiPositionDiagnostics?.dualDirectionTimePercent).toBeGreaterThan(0);
    });
  });
});
