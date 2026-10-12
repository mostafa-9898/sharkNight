import { calculateMetrics } from '@/backtest/metrics';
import type { Trade } from '@/backtest/types';
import type { TradeSignal } from '@/data/models';

describe('Backtest Metrics Calculator', () => {
  const dummySignal = (action: 'BUY' | 'SELL'): TradeSignal => ({
    action,
    timestamp: 1000,
    price: 100,
  });

  const createTrade = (pnl: number, pnlPercent: number, side: 'long' | 'short' = 'long'): Trade => ({
    side,
    exitReason: 'signal',
    entrySignal: dummySignal('BUY'),
    exitSignal: dummySignal('SELL'),
    entryPrice: 100,
    exitPrice: 100 + pnl,
    quantity: 1,
    pnl,
    pnlPercent,
    fee: 2,
  });

  it('should return safe default metrics when no trades occurred', () => {
    const metrics = calculateMetrics([], 10000, [10000, 10000]);

    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winningTrades).toBe(0);
    expect(metrics.losingTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.totalPnl).toBe(0);
    expect(metrics.totalPnlPercent).toBe(0);
    expect(metrics.maxDrawdown).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
    expect(metrics.finalBalance).toBe(10000);
    expect(metrics.long.totalTrades).toBe(0);
    expect(metrics.short.totalTrades).toBe(0);
  });

  it('should calculate win rate and trade statistics accurately including long/short breakdown', () => {
    const trades: Trade[] = [
      createTrade(100, 10, 'long'),
      createTrade(-50, -5, 'long'),
      createTrade(200, 20, 'short'),
    ];

    const equityCurve = [1000, 1100, 1050, 1250];
    const metrics = calculateMetrics(trades, 1000, equityCurve);

    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winningTrades).toBe(2);
    expect(metrics.losingTrades).toBe(1);
    expect(metrics.winRate).toBeCloseTo(0.6667, 2);
    expect(metrics.bestTrade).toBe(20);
    expect(metrics.worstTrade).toBe(-5);
    expect(metrics.averageTradeReturn).toBeCloseTo(8.33, 1);
    expect(metrics.totalPnl).toBe(250);
    expect(metrics.totalPnlPercent).toBe(25);
    expect(metrics.finalBalance).toBe(1250);

    // Long breakdown
    expect(metrics.long.totalTrades).toBe(2);
    expect(metrics.long.winningTrades).toBe(1);
    expect(metrics.long.losingTrades).toBe(1);
    expect(metrics.long.winRate).toBe(0.5);
    expect(metrics.long.totalPnl).toBe(50);

    // Short breakdown
    expect(metrics.short.totalTrades).toBe(1);
    expect(metrics.short.winningTrades).toBe(1);
    expect(metrics.short.losingTrades).toBe(0);
    expect(metrics.short.winRate).toBe(1);
    expect(metrics.short.totalPnl).toBe(200);
  });

  it('should calculate maximum drawdown correctly from peak to trough', () => {
    // Peak is 1200, lowest after peak is 800 -> Drawdown = (1200 - 800) / 1200 = 33.33%
    const equityCurve = [1000, 1200, 900, 1100, 800, 1000];
    const metrics = calculateMetrics([], 1000, equityCurve);

    expect(metrics.maxDrawdown).toBeCloseTo(0.3333, 2);
    expect(metrics.maxDrawdownPercent).toBeCloseTo(33.33, 1);
  });

  it('should compute a positive Sharpe ratio for profitable trades', () => {
    const trades: Trade[] = [
      createTrade(50, 5),
      createTrade(70, 7),
      createTrade(60, 6),
      createTrade(80, 8),
    ];
    const equity = [1000, 1050, 1120, 1180, 1260];
    const metrics = calculateMetrics(trades, 1000, equity);

    expect(metrics.sharpeRatio).toBeGreaterThan(0);
  });
});
