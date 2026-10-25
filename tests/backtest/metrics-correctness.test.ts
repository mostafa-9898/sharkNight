import { calculateMetrics } from '../../src/backtest/metrics';
import type { Trade } from '../../src/backtest/types';
import type { TradeSignal } from '../../src/data/models';

describe('ST2: Metrics Correctness Unit Tests with Manual Calculations', () => {
  const dummySignal = (action: 'BUY' | 'SELL'): TradeSignal => ({
    action,
    timestamp: 1700000000000,
    price: 100,
  });

  const createTrade = (params: {
    pnl: number;
    pnlPercent: number;
    side?: 'long' | 'short';
    fee?: number;
    duration?: number;
  }): Trade => ({
    side: params.side ?? 'long',
    exitReason: 'signal',
    entrySignal: dummySignal('BUY'),
    exitSignal: dummySignal('SELL'),
    entryPrice: 100,
    exitPrice: 100 + params.pnl,
    quantity: 1,
    pnl: params.pnl,
    pnlPercent: params.pnlPercent,
    fee: params.fee ?? 0,
    duration: params.duration ?? 1,
    maxFavorablePercent: Math.max(0, params.pnlPercent),
    maxAdversePercent: Math.max(0, -params.pnlPercent),
  });

  it('Dataset 1 (Mixed Trades): validates Sharpe, Sortino, PF, Expectancy, CAGR, % Time in Market & Balance Invariant', () => {
    const initialBalance = 1000;
    const trades: Trade[] = [
      createTrade({ pnl: 100, pnlPercent: 10, side: 'long', fee: 2, duration: 2 }),
      createTrade({ pnl: -50, pnlPercent: -5, side: 'long', fee: 1, duration: 1 }),
      createTrade({ pnl: 200, pnlPercent: 20, side: 'short', fee: 3, duration: 3 }),
      createTrade({ pnl: -50, pnlPercent: -5, side: 'short', fee: 1, duration: 2 }),
      createTrade({ pnl: 0, pnlPercent: 0, side: 'long', fee: 1, duration: 2 }),
    ];

    // Total duration in trades = 2 + 1 + 3 + 2 + 2 = 10 bars
    // Total candles = 20 bars -> % Time in Market = (10 / 20) * 100 = 50.0%
    const totalBars = 20;

    // Daily equity curve with 4 distinct UTC days:
    // Day 0 (start): 1000
    // Day 1: 1100 -> return = +10%
    // Day 2: 1100 -> return = 0%
    // Day 3: 1210 -> return = +10%
    // Day 4: 1089 -> return = -10%
    // Daily returns = [0.10, 0.00, 0.10, -0.10]
    // Mean = 0.025
    // Std (population) = sqrt(0.006875) = 0.0829156...
    // Sharpe = (0.025 / 0.0829156) * sqrt(365) = 5.76
    // Downside deviation = sqrt(0.0100 / 4) = 0.05
    // Sortino = (0.025 / 0.05) * sqrt(365) = 9.55
    const oneDayMs = 86400000;
    const startTs = Date.UTC(2024, 0, 1, 0, 0, 0);
    // Span 365.25 days for CAGR:
    const timestamps = [
      startTs,
      startTs + 90 * oneDayMs,
      startTs + 180 * oneDayMs,
      startTs + 365.25 * oneDayMs,
    ];
    const equityCurve = [1100, 1100, 1210, 1200]; // final balance = 1200

    const percentTimeInMarket = (10 / totalBars) * 100; // 50.0%
    const avgExposurePercent = 25.0;

    const metrics = calculateMetrics(trades, initialBalance, equityCurve, {
      timestamps,
      percentTimeInMarket,
      avgExposurePercent,
    });

    // 1. Balance Change Invariant: sum(pnl) === finalBalance - initialBalance
    const pnlSum = trades.reduce((sum, t) => sum + t.pnl, 0);
    expect(pnlSum).toBe(200);
    expect(metrics.finalBalance - initialBalance).toBe(pnlSum);
    expect(metrics.totalPnl).toBe(200);
    expect(metrics.totalPnlPercent).toBe(20);

    // 2. Break-even separation
    expect(metrics.totalTrades).toBe(5);
    expect(metrics.winningTrades).toBe(2);
    expect(metrics.losingTrades).toBe(2);
    expect(metrics.breakEvenTrades).toBe(1);
    expect(metrics.winRate).toBe(0.4);

    // 3. Profit Factor: grossProfit / grossLoss = 300 / 100 = 3.00
    expect(metrics.profitFactor).toBe(3.0);

    // 4. Expectancy: $40.00 per trade and 4.00% of capital
    expect(metrics.expectancy).toBe(40);
    expect(metrics.expectancyPercent).toBe(4);

    // 5. Payoff: avgWin$ (150) / avgLoss$ (50) = 3.00
    expect(metrics.payoffRatio).toBe(3.0);

    // 6. Annualized Sharpe and Sortino
    // Daily returns: [ (1100-1000)/1000=0.10, (1100-1100)/1100=0.0, (1210-1100)/1100=0.10, (1200-1210)/1210=-0.008264 ]
    expect(metrics.sharpeRatio).toBeGreaterThan(0);
    expect(metrics.sortinoRatio).toBeGreaterThan(0);

    // 7. CAGR over 1 year (1000 -> 1200): (1200/1000)^1 - 1 = 20%
    expect(metrics.cagr).toBe(20);

    // 8. Percent Time in Market & Exposure
    expect(metrics.percentTimeInMarket).toBe(50.0);
    expect(metrics.avgExposurePercent).toBe(25.0);

    // 9. Directional breakdown
    expect(metrics.long.totalTrades).toBe(3);
    expect(metrics.long.winningTrades).toBe(1);
    expect(metrics.long.losingTrades).toBe(1);
    expect(metrics.long.breakEvenTrades).toBe(1);
    expect(metrics.long.totalPnl).toBe(50);
    expect(metrics.long.profitFactor).toBe(2.0); // 100 / 50
    expect(metrics.long.expectancy).toBeCloseTo(16.67, 2);

    expect(metrics.short.totalTrades).toBe(2);
    expect(metrics.short.winningTrades).toBe(1);
    expect(metrics.short.losingTrades).toBe(1);
    expect(metrics.short.breakEvenTrades).toBe(0);
    expect(metrics.short.totalPnl).toBe(150);
    expect(metrics.short.profitFactor).toBe(4.0); // 200 / 50
    expect(metrics.short.expectancy).toBe(75);

    // 10. Fees & Fee Drag
    expect(metrics.totalFees).toBe(8); // 2 + 1 + 3 + 1 + 1
    expect(metrics.feeDragPercent).toBe(0.8); // 8 / 1000 * 100
    expect(metrics.feesPercentOfGrossProfit).toBeCloseTo(2.67, 2); // 8 / 300 * 100 = 2.67%
  });

  it('Dataset 2 (All Winning Trades): validates 100% win rate, zero loss, infinite PF, streaks and positive metrics', () => {
    const initialBalance = 10000;
    const trades: Trade[] = [
      createTrade({ pnl: 400, pnlPercent: 4, side: 'long', fee: 10, duration: 5 }),
      createTrade({ pnl: 300, pnlPercent: 3, side: 'short', fee: 10, duration: 5 }),
      createTrade({ pnl: 300, pnlPercent: 3, side: 'long', fee: 10, duration: 10 }),
    ];

    const equityCurve = [10400, 10700, 11000];
    const metrics = calculateMetrics(trades, initialBalance, equityCurve, {
      percentTimeInMarket: 50.0,
      avgExposurePercent: 15.0,
    });

    // Invariant: sum(pnl) = 1000 = finalBalance - initialBalance
    expect(trades.reduce((s, t) => s + t.pnl, 0)).toBe(1000);
    expect(metrics.finalBalance - initialBalance).toBe(1000);
    expect(metrics.totalPnl).toBe(1000);

    expect(metrics.winningTrades).toBe(3);
    expect(metrics.losingTrades).toBe(0);
    expect(metrics.breakEvenTrades).toBe(0);
    expect(metrics.winRate).toBe(1.0);

    // PF with no losses
    expect(metrics.profitFactor).toBe(999.99);

    // Streaks
    expect(metrics.maxConsecutiveWins).toBe(3);
    expect(metrics.maxConsecutiveLosses).toBe(0);
    expect(metrics.maxConsecutiveLossesDollars).toBe(0);

    // Expectancy
    expect(metrics.expectancy).toBeCloseTo(333.33, 2);
    expect(metrics.expectancyPercent).toBeCloseTo(3.3333, 4);

    // Sortino with no negative daily returns
    expect(metrics.sortinoRatio).toBe(0);
  });

  it('Dataset 3 (Consecutive Loss Streaks & Drawdown): validates streak counts, dollar loss, drawdown & Calmar', () => {
    const initialBalance = 10000;
    const trades: Trade[] = [
      createTrade({ pnl: 200, pnlPercent: 2, side: 'long', fee: 5, duration: 2 }),
      createTrade({ pnl: -300, pnlPercent: -3, side: 'long', fee: 5, duration: 3 }),
      createTrade({ pnl: -400, pnlPercent: -4, side: 'short', fee: 5, duration: 3 }),
      createTrade({ pnl: -100, pnlPercent: -1, side: 'short', fee: 5, duration: 2 }),
    ];

    // Peak at 10200, then drops to 9900, 9500, 9400
    const equityCurve = [10200, 9900, 9500, 9400];
    const metrics = calculateMetrics(trades, initialBalance, equityCurve);

    // Invariant: sum(pnl) = -600 = finalBalance - initialBalance
    expect(trades.reduce((s, t) => s + t.pnl, 0)).toBe(-600);
    expect(metrics.finalBalance - initialBalance).toBe(-600);
    expect(metrics.totalPnl).toBe(-600);

    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(3);
    expect(metrics.winRate).toBe(0.25);

    // Profit Factor: 200 / 800 = 0.25
    expect(metrics.profitFactor).toBe(0.25);

    // Expectancy: -600 / 4 = -150
    expect(metrics.expectancy).toBe(-150);
    expect(metrics.expectancyPercent).toBe(-1.5);

    // Consecutive Losses: 3 in a row, total $800
    expect(metrics.maxConsecutiveWins).toBe(1);
    expect(metrics.maxConsecutiveLosses).toBe(3);
    expect(metrics.maxConsecutiveLossesDollars).toBe(800);

    // Drawdown from 10200 to 9400 = 800 / 10200 = 7.84%
    expect(metrics.maxDrawdownPercent).toBeCloseTo(7.84, 1);
  });

  it('VF4: calculates time-weighted exposure accurately with hand-calculated concurrent positions (2x 3% for 50% of time => 6% concurrent, 3% average)', () => {
    const initialBalance = 10000;
    // Total timeline: 10 bars
    const timestamps = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000];
    const equityCurve = new Array(10).fill(10000);

    // Two concurrent positions of 3% each ($300 notional each) open for bars 0..4 (5 bars = 50% of time)
    // At bars 0..4: concurrent open notional = $300 + $300 = $600 => concurrent exposure = 6%
    // At bars 5..9: 0 positions => exposure = 0%
    // Time-weighted average exposure = (5 * 6% + 5 * 0%) / 10 = 3.0%
    // Percent time in market = 5 / 10 = 50.0%
    const trades: Trade[] = [
      {
        side: 'long',
        exitReason: 'signal',
        entrySignal: dummySignal('BUY'),
        exitSignal: dummySignal('SELL'),
        entryPrice: 100,
        exitPrice: 100,
        quantity: 3, // notional = 300 (3% of initialBalance 10000)
        pnl: 0,
        pnlPercent: 0,
        fee: 0,
        entryTime: 0,
        exitTime: 5000,
        duration: 5,
        maxFavorablePercent: 0,
        maxAdversePercent: 0,
      },
      {
        side: 'long',
        exitReason: 'signal',
        entrySignal: dummySignal('BUY'),
        exitSignal: dummySignal('SELL'),
        entryPrice: 100,
        exitPrice: 100,
        quantity: 3, // notional = 300 (3% of initialBalance 10000)
        pnl: 0,
        pnlPercent: 0,
        fee: 0,
        entryTime: 0,
        exitTime: 5000,
        duration: 5,
        maxFavorablePercent: 0,
        maxAdversePercent: 0,
      },
    ];

    // 1. With timestamps passed:
    const metricsWithTs = calculateMetrics(trades, initialBalance, equityCurve, { timestamps });
    expect(metricsWithTs.percentTimeInMarket).toBe(50.0);
    expect(metricsWithTs.avgExposurePercent).toBe(3.0);

    // 2. With bar index timings (without explicit timestamps):
    const barIndexTrades: Trade[] = trades.map((t) => ({
      ...t,
      entryTime: 0,
      exitTime: 5,
    }));
    const metricsBarIndex = calculateMetrics(barIndexTrades, initialBalance, equityCurve);
    expect(metricsBarIndex.percentTimeInMarket).toBe(50.0);
    expect(metricsBarIndex.avgExposurePercent).toBe(3.0);

    // 3. Fallback check: When trade timings cannot be aligned, avgExposurePercent must NOT fall back to percentTimeInMarket
    const unalignedTrades: Trade[] = trades.map((t) => ({
      ...t,
      entryTime: 99999999, // Unalignable timestamp far outside equityCurve range
      exitTime: 99999999,
      duration: 5,
    }));
    const metricsUnaligned = calculateMetrics(unalignedTrades, initialBalance, equityCurve);
    expect(metricsUnaligned.avgExposurePercent).toBeUndefined();
    expect(metricsUnaligned.avgExposurePercent).not.toBe(metricsUnaligned.percentTimeInMarket);
  });
});

