import { BacktestEngine } from '@/backtest/engine';
import type { Strategy } from '@/strategies/types';
import type { Candle, TradeSignal } from '@/data/models';
import { roundTo } from '@/utils/math';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

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
      reason: `Mock ${action} at candle ${index}`,
    };
  }
}

function makeCandle(index: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: 1700000000000 + index * 3600000,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

describe('BacktestEngine entryFill execution option (PU1)', () => {
  const engine = new BacktestEngine();

  // (الف) Entry price = open of next candle with slippage
  describe('(الف) Entry price matches open of t+1 candle with adverse slippage', () => {
    it('executes long signal on candle t at open of t+1 with positive slippage', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107), // Signal BUY at t=1
        makeCandle(2, 110, 115, 108, 112), // Execution at t=2 open
        makeCandle(3, 112, 114, 106, 108),
        makeCandle(4, 108, 110, 105, 107),
      ];

      const strategy = new MockActionStrategy({ 1: 'BUY' });
      const entrySlippagePercent = 0.05;

      const result = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-only',
        entryFill: 'nextOpen',
        entrySlippagePercent,
        tradeFeePercent: 0.1,
      });

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      const expectedFillPrice = roundTo(candles[2].open * (1 + entrySlippagePercent / 100), 8); // 110 * 1.0005 = 110.055
      expect(trade.entryPrice).toBe(expectedFillPrice);
      expect(trade.entryTime).toBe(candles[2].timestamp);
      expect(trade.side).toBe('long');
    });

    it('executes short signal on candle t at open of t+1 with adverse slippage in single and multi-position', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107), // Signal SELL at t=1
        makeCandle(2, 110, 115, 108, 112), // Execution at t=2 open
        makeCandle(3, 112, 114, 106, 108),
        makeCandle(4, 108, 110, 105, 107),
      ];

      const strategy = new MockActionStrategy({ 1: 'SELL' });
      const entrySlippagePercent = 0.05;

      // Single-position mode
      const resultSingle = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'short-only',
        entryFill: 'nextOpen',
        entrySlippagePercent,
        tradeFeePercent: 0.1,
      });

      expect(resultSingle.trades.length).toBe(1);
      const expectedShortFill = roundTo(candles[2].open * (1 - entrySlippagePercent / 100), 8); // 110 * (1 - 0.0005) = 109.945
      expect(resultSingle.trades[0].entryPrice).toBe(expectedShortFill);
      expect(resultSingle.trades[0].entryTime).toBe(candles[2].timestamp);
      expect(resultSingle.trades[0].side).toBe('short');

      // Multi-position mode
      const resultMulti = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'short-only',
        exitMode: 'trailingOnly',
        maxOpenPositions: 3,
        entryFill: 'nextOpen',
        entrySlippagePercent,
        tradeFeePercent: 0.1,
      });

      expect(resultMulti.trades.length).toBe(1);
      expect(resultMulti.trades[0].entryPrice).toBe(expectedShortFill);
      expect(resultMulti.trades[0].entryTime).toBe(candles[2].timestamp);
    });
  });

  // (ب) Signal on last candle is discarded
  describe('(ب) Discarding signal on the final candle', () => {
    it('discards a signal emitted on the last candle in single position mode and reconciles funnel', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107),
        makeCandle(2, 107, 109, 103, 105), // Last candle (t=2)
      ];

      const strategy = new MockActionStrategy({ 2: 'BUY' });

      const result = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-only',
        entryFill: 'nextOpen',
        entrySlippagePercent: 0.05,
      });

      expect(result.trades.length).toBe(0);
      expect(result.signalFunnel!.long.entryAttempted).toBe(1);
      expect(result.signalFunnel!.long.executed).toBe(0);
      expect(result.signalFunnel!.long.rejected.other).toBe(1);
      expect(result.signalFunnel!.long.rejectedTotal).toBe(1);
    });

    it('discards a signal emitted on the last candle in multi position mode and reconciles funnel', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107),
        makeCandle(2, 107, 109, 103, 105), // Last candle (t=2)
      ];

      const strategy = new MockActionStrategy({ 2: 'BUY' });

      const result = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-only',
        exitMode: 'trailingOnly',
        maxOpenPositions: 5,
        entryFill: 'nextOpen',
        entrySlippagePercent: 0.05,
      });

      expect(result.trades.length).toBe(0);
      expect(result.signalFunnel!.long.entryAttempted).toBe(1);
      expect(result.signalFunnel!.long.executed).toBe(0);
      expect(result.signalFunnel!.long.rejected.other).toBe(1);
      expect(result.signalFunnel!.long.rejectedTotal).toBe(1);
    });
  });

  // (ج) Regression parity with entryFill='close'
  describe('(ج) S1 regression parity with entryFill=close', () => {
    it('produces identical results when entryFill is close compared to default omitted', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107),
        makeCandle(2, 107, 115, 104, 114),
        makeCandle(3, 114, 116, 108, 110),
        makeCandle(4, 110, 112, 100, 101),
        makeCandle(5, 101, 105, 98, 103),
      ];

      const strategy = new MockActionStrategy({ 1: 'BUY', 3: 'SELL' });

      const defaultRun = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-short',
        exitMode: 'reverse',
      });

      const explicitCloseRun = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-short',
        exitMode: 'reverse',
        entryFill: 'close',
        entrySlippagePercent: 0,
      });

      expect(defaultRun.trades.length).toBe(explicitCloseRun.trades.length);
      for (let i = 0; i < defaultRun.trades.length; i++) {
        expect(explicitCloseRun.trades[i].entryPrice).toBe(defaultRun.trades[i].entryPrice);
        expect(explicitCloseRun.trades[i].exitPrice).toBe(defaultRun.trades[i].exitPrice);
        expect(explicitCloseRun.trades[i].pnl).toBe(defaultRun.trades[i].pnl);
        expect(explicitCloseRun.trades[i].entryTime).toBe(defaultRun.trades[i].entryTime);
        expect(explicitCloseRun.trades[i].exitTime).toBe(defaultRun.trades[i].exitTime);
      }
      expect(explicitCloseRun.metrics.totalPnl).toBe(defaultRun.metrics.totalPnl);
      expect(explicitCloseRun.metrics.maxDrawdownPercent).toBe(defaultRun.metrics.maxDrawdownPercent);
    });
  });

  // (د) Sum of trade PnL = balance change
  describe('(د) Conservation of equity: sum(trade.pnl) = delta balance', () => {
    it('satisfies sum(pnl) === endingBalance - initialBalance in single-position nextOpen', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107), // BUY
        makeCandle(2, 110, 118, 108, 115), // Enter long at 110*(1+0.0005)
        makeCandle(3, 115, 120, 112, 118),
        makeCandle(4, 118, 122, 114, 116), // SELL
        makeCandle(5, 115, 117, 108, 110), // Enter short at 115*(1-0.0005)
        makeCandle(6, 110, 112, 105, 106),
      ];

      const strategy = new MockActionStrategy({ 1: 'BUY', 4: 'SELL' });

      const result = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-short',
        exitMode: 'reverse',
        entryFill: 'nextOpen',
        entrySlippagePercent: 0.05,
        tradeFeePercent: 0.1,
      });

      expect(result.trades.length).toBeGreaterThanOrEqual(1);
      const sumPnl = result.trades.reduce((acc, t) => acc + t.pnl, 0);
      const deltaBalance = result.metrics.finalBalance - 10000;
      expect(Math.abs(sumPnl - deltaBalance)).toBeLessThan(0.01);
      expect(Math.abs(result.metrics.totalPnl - sumPnl)).toBeLessThan(0.01);
    });

    it('satisfies sum(pnl) === endingBalance - initialBalance in multi-position nextOpen', () => {
      const candles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107), // BUY
        makeCandle(2, 110, 118, 108, 115), // Enter pos 1
        makeCandle(3, 115, 120, 112, 118), // BUY
        makeCandle(4, 118, 122, 114, 116), // Enter pos 2
        makeCandle(5, 116, 117, 108, 110),
        makeCandle(6, 110, 112, 105, 106),
      ];

      const strategy = new MockActionStrategy({ 1: 'BUY', 3: 'BUY' });

      const result = engine.run({
        strategy,
        candles,
        initialBalance: 10000,
        tradeMode: 'long-only',
        exitMode: 'trailingOnly',
        maxOpenPositions: 3,
        positionSizePercent: 20,
        entryFill: 'nextOpen',
        entrySlippagePercent: 0.05,
        tradeFeePercent: 0.1,
      });

      expect(result.trades.length).toBe(2);
      const sumPnl = result.trades.reduce((acc, t) => acc + t.pnl, 0);
      const deltaBalance = result.metrics.finalBalance - 10000;
      expect(Math.abs(sumPnl - deltaBalance)).toBeLessThan(0.01);
      expect(Math.abs(result.metrics.totalPnl - sumPnl)).toBeLessThan(0.01);
    });
  });

  // (ه) No-lookahead: truncating after t+1 leaves trades up to t+1 unchanged
  describe('(ه) No-lookahead property', () => {
    it('truncating future candles after t+1 does not alter trades executed up to t+1', () => {
      const fullCandles: Candle[] = [
        makeCandle(0, 100, 105, 95, 102),
        makeCandle(1, 102, 108, 101, 107), // Signal at t=1
        makeCandle(2, 110, 115, 108, 112), // Execution at t=2
        makeCandle(3, 112, 114, 106, 108),
        makeCandle(4, 108, 110, 105, 107),
        makeCandle(5, 107, 118, 104, 116),
        makeCandle(6, 116, 120, 114, 119),
        makeCandle(7, 119, 125, 115, 120),
      ];

      const strategy = new MockActionStrategy({ 1: 'BUY' });

      const fullResult = engine.run({
        strategy,
        candles: fullCandles,
        initialBalance: 10000,
        tradeMode: 'long-only',
        entryFill: 'nextOpen',
        entrySlippagePercent: 0.05,
      });

      // Truncate to candle 3 (just after execution on candle 2)
      const truncatedCandles = fullCandles.slice(0, 4);
      const truncatedResult = engine.run({
        strategy,
        candles: truncatedCandles,
        initialBalance: 10000,
        tradeMode: 'long-only',
        entryFill: 'nextOpen',
        entrySlippagePercent: 0.05,
      });

      expect(fullResult.trades.length).toBeGreaterThanOrEqual(1);
      expect(truncatedResult.trades.length).toBeGreaterThanOrEqual(1);

      const fullFirstTrade = fullResult.trades[0];
      const truncFirstTrade = truncatedResult.trades[0];

      expect(truncFirstTrade.entryTime).toBe(fullFirstTrade.entryTime);
      expect(truncFirstTrade.entryPrice).toBe(fullFirstTrade.entryPrice);
      expect(truncFirstTrade.side).toBe(fullFirstTrade.side);
      expect(truncFirstTrade.quantity).toBe(fullFirstTrade.quantity);
    });
  });
});
