import { calculateMetrics, computeMfeMaeAnalysis } from '@/backtest/metrics';
import type { Trade } from '@/backtest/types';
import type { TradeSignal } from '@/data/models';

describe('Backtest Metrics Calculator', () => {
  const dummySignal = (action: 'BUY' | 'SELL'): TradeSignal => ({
    action,
    timestamp: 1000,
    price: 100,
  });

  const createTrade = (
    pnl: number,
    pnlPercent: number,
    side: 'long' | 'short' = 'long',
    fee = 2,
    mfe = Math.max(0, pnlPercent),
    mae = Math.max(0, -pnlPercent)
  ): Trade => ({
    side,
    exitReason: 'signal',
    entrySignal: dummySignal('BUY'),
    exitSignal: dummySignal('SELL'),
    entryPrice: 100,
    exitPrice: 100 + pnl,
    quantity: 1,
    pnl,
    pnlPercent,
    fee,
    maxFavorablePercent: mfe,
    maxAdversePercent: mae,
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
    expect(metrics.totalFees).toBe(0);
    expect(metrics.totalFeesPercent).toBe(0);
    expect(metrics.averageWin).toBe(0);
    expect(metrics.averageLoss).toBe(0);
    expect(metrics.feeDragPercent).toBe(0);
    expect(metrics.long.totalTrades).toBe(0);
    expect(metrics.short.totalTrades).toBe(0);
  });

  it('should calculate win rate and trade statistics accurately including long/short breakdown', () => {
    const trades: Trade[] = [
      createTrade(100, 10, 'long', 2),
      createTrade(-50, -5, 'long', 2),
      createTrade(200, 20, 'short', 3),
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

    // Fees and Win/Loss metrics
    expect(metrics.totalFees).toBe(7);
    expect(metrics.totalFeesPercent).toBe(0.7);
    expect(metrics.feeDragPercent).toBe(0.7);
    expect(metrics.averageWin).toBe(15);
    expect(metrics.averageLoss).toBe(-5);

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

  it('should compute MFE and MAE analysis accurately across trades', () => {
    const trades: Trade[] = [
      createTrade(100, 10, 'long', 2, 12, 2),
      createTrade(-50, -5, 'long', 2, 3, 6),
      createTrade(200, 20, 'short', 3, 22, 1),
    ];

    const analysis = computeMfeMaeAnalysis(trades);
    expect(analysis.all.count).toBe(3);
    expect(analysis.long.count).toBe(2);
    expect(analysis.short.count).toBe(1);

    // All trades MFEs: [3, 12, 22] -> median is 12
    expect(analysis.all.mfeMedian).toBe(12);
    // All trades MAEs: [1, 2, 6] -> median is 2
    expect(analysis.all.maeMedian).toBe(2);
    // Threshold >= 10%: 12 and 22 -> 2/3 = 66.7%
    expect(analysis.all.mfeThresholds['>=10%']).toBe(66.7);
  });

  it('should handle large trade and equity arrays (100,000 items) without call stack overflow', () => {
    const largeTrades: Trade[] = [];
    for (let i = 0; i < 70000; i++) {
      largeTrades.push(createTrade(1, 0.1, 'long', 0.01));
    }
    const largeEquity = new Array(100000).fill(10000);

    expect(() => {
      const res = calculateMetrics(largeTrades, 10000, largeEquity);
      expect(res.totalTrades).toBe(70000);
      expect(res.bestTrade).toBe(0.1);
      expect(res.worstTrade).toBe(0.1);
    }).not.toThrow();
  });
});
